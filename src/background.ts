// 扩展后台协调器：管理登录状态、同步任务和 CSDN 草稿写入。
import {Semaphore} from './core/async';
import {allTasks,clearAllTasks,deleteTask,getArticleDraftMapping,getSettings,migrateStoredTasks,patchTask,preserveTaskMappings,putTask,saveArticleDraftMapping,saveSettings,saveTasks} from './core/store';
import {canDeleteTask,extractCsdnArticleId,findMatchingTask,isActiveTask,isInterruptedTask,isRetryableTask,isUncertainCreateTask} from './core/task';
import {SyncError,classifySyncError} from './core/diagnostic';
import {isSupportedMessage} from './core/message';
import {buildTaskNotification,showTaskNotification} from './core/notify';
import {HEALTH_CHECK_ALARM,getCachedHealth,isHealthAlert,refreshHealthIfNeeded} from './core/health';
import {resolveCsdnCategories,shouldConfirmDraftUpdate} from './core/settings';
import {fetchJuejinDraftByArticleId,fetchJuejinDraftByDraftId} from './source/juejin-api';
import {csdnAdapter} from './targets/csdn';
import {buildDryRunReport,checkCsdnAuth,fetchCsdnArticleState,fetchCsdnCategories,saveDraftViaApi,validateCsdnArticle} from './targets/csdn-api';
import {checkWechatAuth,requireWechatAccount,saveWechatDraft} from './targets/wechat-api';
import type {Article,ExtensionSettings,PlatformId,SyncTask,TaskStage} from './types';
import {uid} from './types';

const runningTasks=new Set<string>();
/** 全局任务闸门：同一时间最多 2 篇文章在同步，批量重试自动排队，避免触发平台限流。 */
const taskGate=new Semaphore(2);
const JUEJIN_UUID_KEY='juejinUuid';

async function getJuejinUuid(){return((await chrome.storage.local.get(JUEJIN_UUID_KEY))[JUEJIN_UUID_KEY] as string|undefined)||'';}

/**
 * 重试与恢复时任务正文已从 storage 瘦身，按双路径从掘金回填：
 * 有草稿 ID 直查草稿详情；历史文章经 list_by_user 反查后读取。
 */
async function ensureArticleContent(article:Article):Promise<Article>{
  if(article.markdown.trim().length>=20)return article;
  const uuid=await getJuejinUuid();
  if(!uuid)throw new SyncError('本地已清理文章正文，请先打开掘金任意页面后重试','unknown','validation');
  if(article.sourceDraftId){
    const fetched=await fetchJuejinDraftByDraftId(article.sourceDraftId,uuid,article.title);
    return{...fetched,id:article.id,sourceUrl:article.sourceUrl};
  }
  if(/^\d+$/.test(article.id)){
    const fetched=await fetchJuejinDraftByArticleId(article.id,uuid,article.title);
    return{...fetched,sourceUrl:article.sourceUrl||fetched.sourceUrl};
  }
  throw new SyncError('文章正文已清理且缺少掘金草稿标识，请从掘金页面重新发起同步','content','validation');
}

async function runTask(task:SyncTask){
  const startedAt=Date.now();
  let stage:TaskStage='validation';
  try{
    if(task.platform==='wechat'){
      if(!task.wechatAccountId)throw new SyncError('旧微信任务未绑定公众号，已阻止自动恢复，请从掘金重新发起并核对旧草稿','blocked','authentication');
      await requireWechatAccount(task.wechatAccountId);
    }
    let article=await ensureArticleContent(task.article);
    // 发布面板的封面可能尚未被主世界缓存捕获；微信正式同步前按草稿详情补齐封面、摘要和标签。
    if(task.platform==='wechat'&&article.cover===undefined&&article.sourceDraftId){
      const uuid=await getJuejinUuid();
      if(uuid){
        const fresh=await fetchJuejinDraftByDraftId(article.sourceDraftId,uuid,article.title);
        article={...article,cover:fresh.cover||'',summary:article.summary??fresh.summary,tags:article.tags.length?article.tags:fresh.tags};
      }
      else throw new SyncError('尚未读取源草稿封面，请刷新掘金编辑器并保存草稿后重试','content','validation');
    }
    if(task.platform==='csdn')validateCsdnArticle(article);
    const settings=await getSettings();
    const platformName=task.platform==='wechat'?'微信公众号':'CSDN';
    await patchTask(task.id,{status:'checking-login',attempts:task.attempts+1,error:undefined,diagnostic:undefined,warnings:undefined,stats:undefined,progress:{current:0,total:0,message:`正在检查${platformName}登录状态`}});
    const transformed=task.platform==='csdn'?csdnAdapter.transform(article):article;
    await patchTask(task.id,{status:'transforming',progress:{current:0,total:0,message:'正在处理文章内容'}});
    stage='authentication';
    if(task.platform==='csdn'&&task.csdnArticleId){
      const state=await fetchCsdnArticleState(task.csdnArticleId);
      if(state==='published')throw new SyncError('该 CSDN 文章已公开发布，为避免覆盖线上文章已阻断同步。如需继续，请删除本条同步记录后另存新草稿。','blocked','draft');
    }
    const isUpdate=task.platform==='wechat'?!!task.wechatAppMsgId:!!task.csdnArticleId;
    const callbacks={
      onPreparing:()=>{stage='content';},
      onProgress:async(progress:SyncTask['progress'])=>{stage='images';if(progress)await patchTask(task.id,{status:'transforming',progress});},
      onSaving:async()=>{stage='draft';await patchTask(task.id,{status:'writing',progress:{current:1,total:1,message:isUpdate?`正在更新${platformName}草稿`:`正在创建${platformName}草稿`}});}
    };
    const result=task.platform==='wechat'?await saveWechatDraft(transformed,{...callbacks,appMsgId:task.wechatAppMsgId,accountId:task.wechatAccountId}):await saveDraftViaApi(transformed,{
      articleId:task.csdnArticleId,
      categories:resolveCsdnCategories(transformed.tags,settings),
      syncCover:settings.syncCover,
      autoSummary:settings.autoSummary,
      appendSourceLink:settings.appendSourceLink,
      imageFailurePolicy:settings.imageFailurePolicy,
      onPreparing:callbacks.onPreparing,
      onProgress:callbacks.onProgress,
      onSaving:callbacks.onSaving
    });
    await patchTask(task.id,{status:'saved',draftUrl:result.draftUrl,...(task.platform==='wechat'?{wechatAppMsgId:result.articleId}:{csdnArticleId:result.articleId}),warnings:result.warnings,stats:{...result.stats,durationMs:Date.now()-startedAt},progress:undefined});
    await saveArticleDraftMapping(task.article,result.articleId,result.draftUrl,task.platform,task.wechatAccountId);
    await chrome.action.setBadgeBackgroundColor({color:'#1d6744'});
    await chrome.action.setBadgeText({text:'✓'});
    setTimeout(()=>chrome.action.setBadgeText({text:''}),5000);
    // task 局部变量仍是入参旧状态（patchTask 只写 storage），必须显式标记 saved，否则成功通知永不触发。
    const notification=buildTaskNotification({...task,status:'saved',draftUrl:result.draftUrl,stats:{...result.stats,durationMs:Date.now()-startedAt}},Date.now()-startedAt);
    if(notification)await showTaskNotification(notification);
  }catch(error){
    const diagnostic=classifySyncError(error,stage);
    const failedTask:SyncTask={...task,status:['login','blocked','interrupted'].includes(diagnostic.category)?'needs-user':'failed',error:diagnostic.message,diagnostic};
    await patchTask(task.id,{status:failedTask.status,error:diagnostic.message,diagnostic,progress:undefined});
    await chrome.action.setBadgeBackgroundColor({color:'#a24332'});
    await chrome.action.setBadgeText({text:'!'});
    const notification=buildTaskNotification(failedTask,Date.now()-startedAt);
    if(notification)await showTaskNotification(notification);
    throw error;
  }
}

async function execute(task:SyncTask){
  if(runningTasks.has(task.id))return;
  runningTasks.add(task.id);
  try{
    await taskGate.run(()=>runTask(task));
  }finally{runningTasks.delete(task.id);}
}

async function create(article:Article,platform:PlatformId='csdn',expectedAccountId?:string){
  const wechatAccountId=platform==='wechat'?await requireWechatAccount(expectedAccountId):undefined;
  const tasks=await allTasks();
  const previous=findMatchingTask(tasks,article,platform,wechatAccountId);
  if(previous?.diagnostic?.category==='interrupted')throw new SyncError('上次写入结果尚未确认，请先检查目标草稿箱，再在同步记录中确认重试','interrupted','draft');
  if(platform==='wechat'&&(findMatchingTask(tasks,article,'wechat')?.wechatAppMsgId||await getArticleDraftMapping(article,'wechat'))){
    throw new SyncError('发现未绑定账号的旧微信草稿映射，已阻止自动覆盖，请先核对旧草稿归属','blocked','authentication');
  }
  const active=previous&&isActiveTask(previous)?previous:undefined;
  if(active)return active;
  const settings=await getSettings();
  const now=new Date().toISOString();
  const mapping=!previous?await getArticleDraftMapping(article,platform,wechatAccountId):undefined;
  const csdnArticleId=platform==='csdn'?(previous?.csdnArticleId||extractCsdnArticleId(previous?.draftUrl)||mapping?.csdnArticleId):undefined;
  const wechatAppMsgId=platform==='wechat'?(previous?.wechatAppMsgId||mapping?.wechatAppMsgId):undefined;
  const draftUrl=previous?.draftUrl||mapping?.draftUrl;
  const targetId=platform==='csdn'?csdnArticleId:wechatAppMsgId;
  const needsConfirmation=shouldConfirmDraftUpdate(settings,targetId);
  const task:SyncTask=previous
    ?{...previous,article,status:needsConfirmation?'needs-confirmation':'queued',updatedAt:now,csdnArticleId,wechatAppMsgId,error:undefined,diagnostic:undefined,warnings:undefined,stats:undefined,progress:undefined}
    :{id:uid(),article,platform,wechatAccountId,status:needsConfirmation?'needs-confirmation':'queued',createdAt:now,updatedAt:now,attempts:0,csdnArticleId,wechatAppMsgId,draftUrl};
  await putTask(task);
  if(needsConfirmation)return task;
  await execute(task);
  return(await allTasks()).find(item=>item.id===task.id)||task;
}

/** Service Worker 被回收或浏览器重启后，重新执行尚未结束的持久化任务。 */
async function recoverInterruptedTasks(){
  const tasks=await allTasks();
  const uncertain=tasks.filter(isUncertainCreateTask);
  await Promise.all(uncertain.map(task=>patchTask(task.id,{
    status:'needs-user',
    error:`上次创建${task.platform==='wechat'?'微信公众号':'CSDN'}草稿时扩展被中断，无法确认是否已保存。请先检查目标草稿箱，再决定是否重试。`,
    diagnostic:classifySyncError(new Error('上次创建草稿时扩展被中断，无法确认是否已保存。'),'recovery'),
    progress:undefined
  })));
  const interrupted=tasks.filter(isInterruptedTask);
  await Promise.allSettled(interrupted.map(task=>execute(task)));
}

/** 启动序：先完成 storage 瘦身迁移，再恢复中断任务（恢复的任务经双路径回填正文）。 */
const recovery=migrateStoredTasks().then(()=>recoverInterruptedTasks());

type PendingHistory={articleId:string;title:string;sourceUrl:string;uuid:string;platform:PlatformId;wechatAccountId?:string;expiresAt:number};

async function openCsdnLogin(){
  await chrome.tabs.create({url:'https://passport.csdn.net/login',active:true});
}

async function openWechatLogin(){await chrome.tabs.create({url:'https://mp.weixin.qq.com/',active:true});}

async function syncHistory(request:Omit<PendingHistory,'expiresAt'>){
  if(request.uuid)await chrome.storage.local.set({[JUEJIN_UUID_KEY]:request.uuid});
  const auth=request.platform==='wechat'?await checkWechatAuth():await checkCsdnAuth();
  const name=request.platform==='wechat'?'微信公众平台':'CSDN';
  if(!auth.ok)throw new Error(auth.message||`${name}登录状态检测失败`);
  if(!auth.loggedIn){
    await chrome.storage.session.set({pendingHistory:{...request,expiresAt:Date.now()+10*60*1000}});
    await (request.platform==='wechat'?openWechatLogin():openCsdnLogin());
    return{ok:false,needsLogin:true,message:`请先登录${name}，返回掘金后将继续同步`};
  }
  const article=await fetchJuejinDraftByArticleId(request.articleId,request.uuid,request.title);
  return{ok:true,articleId:request.articleId,platform:request.platform,task:await create(article,request.platform,request.wechatAccountId)};
}

async function resumePendingHistory(){
  const {pendingHistory}=await chrome.storage.session.get('pendingHistory') as {pendingHistory?:PendingHistory};
  if(!pendingHistory||pendingHistory.expiresAt<=Date.now()){
    await chrome.storage.session.remove('pendingHistory');
    return{ok:true,resumed:false};
  }
  const auth=pendingHistory.platform==='wechat'?await checkWechatAuth():await checkCsdnAuth();
  if(!auth.ok)throw new Error(auth.message||'目标平台登录状态检测失败');
  if(!auth.loggedIn)return{ok:true,resumed:false,needsLogin:true};
  await chrome.storage.session.remove('pendingHistory');
  const article=await fetchJuejinDraftByArticleId(pendingHistory.articleId,pendingHistory.uuid,pendingHistory.title);
  return{ok:true,resumed:true,articleId:pendingHistory.articleId,platform:pendingHistory.platform,task:await create(article,pendingHistory.platform,pendingHistory.wechatAccountId)};
}

/** 同步预演：回填正文后执行内容分析，但不转存图片、不写入 CSDN。 */
async function dryRunTask(id:string){
  const task=(await allTasks()).find(item=>item.id===id);
  if(!task)return{ok:false,message:'任务不存在'};
  try{
    const article=await ensureArticleContent(task.article);
    const settings=await getSettings();
    return{ok:true,report:buildDryRunReport(article,settings)};
  }catch(error){
    return{ok:false,message:(error as Error).message||'预演失败'};
  }
}

chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  (async()=>{
    if(!isSupportedMessage(message)){reply({ok:false,message:'不支持的扩展消息'});return;}
    await recovery;
    if(message.type==='SYNC_NEW_ARTICLE'){
      const platform=message.platform==='wechat'?'wechat':'csdn';
      reply({ok:true,task:await create(message.article as Article,platform,typeof message.wechatAccountId==='string'?message.wechatAccountId:undefined)});
    }else if(message.type==='CHECK_CSDN_STATUS'){
      reply(await checkCsdnAuth());
    }else if(message.type==='OPEN_CSDN_LOGIN'){
      await openCsdnLogin();
      reply({ok:true});
    }else if(message.type==='CHECK_WECHAT_STATUS'){
      const {meta,...auth}=await checkWechatAuth();
      reply({...auth,accountId:meta?.userName});
    }else if(message.type==='OPEN_WECHAT_LOGIN'){
      await openWechatLogin();reply({ok:true});
    }else if(message.type==='REPORT_JUEJIN_UUID'){
      const uuid=String(message.uuid||'');
      if(uuid)await chrome.storage.local.set({[JUEJIN_UUID_KEY]:uuid});
      reply({ok:true});
    }else if(message.type==='SYNC_HISTORY_ARTICLE'){
      reply(await syncHistory({articleId:String(message.articleId),title:String(message.title||''),sourceUrl:String(message.sourceUrl||''),uuid:String(message.uuid||''),platform:message.platform==='wechat'?'wechat':'csdn',wechatAccountId:typeof message.wechatAccountId==='string'?message.wechatAccountId:undefined}));
    }else if(message.type==='RESUME_PENDING_HISTORY'){
      reply(await resumePendingHistory());
    }else if(message.type==='GET_TASKS'){
      reply({ok:true,tasks:await allTasks()});
    }else if(message.type==='GET_SETTINGS'){
      reply({ok:true,settings:await getSettings()});
    }else if(message.type==='SAVE_SETTINGS'){
      await saveSettings(message.settings as ExtensionSettings);
      reply({ok:true});
    }else if(message.type==='RETRY_TASK'){
      const task=(await allTasks()).find(item=>item.id===message.id);
      if(task?.diagnostic?.category==='interrupted'&&message.confirmUncertain!==true){reply({ok:false,message:'请先检查草稿箱并明确确认重试，避免重复创建'});}
      else if(task){void execute(task).catch(()=>{});reply({ok:true});}else reply({ok:false,message:'任务不存在'});
    }else if(message.type==='CONFIRM_TASK_UPDATE'){
      const task=(await allTasks()).find(item=>item.id===message.id);
      if(!task){reply({ok:false,message:'任务不存在'});}
      else if(task.status!=='needs-confirmation'){reply({ok:false,message:'任务不需要确认'});}
      else{void execute(task).catch(()=>{});reply({ok:true});}
    }else if(message.type==='RETRY_FAILED_TASKS'){
      const tasks=(await allTasks()).filter(isRetryableTask);
      tasks.forEach(task=>void execute(task).catch(()=>{}));
      reply({ok:true,count:tasks.length});
    }else if(message.type==='DELETE_TASK'){
      const task=(await allTasks()).find(item=>item.id===message.id);
      if(!task){reply({ok:false,message:'任务不存在'});}
      else if(runningTasks.has(task.id)||!canDeleteTask(task)){reply({ok:false,message:'进行中的任务不能删除'});}
      else{await deleteTask(task.id);reply({ok:true});}
    }else if(message.type==='CLEAR_TASKS'){
      await clearAllTasks();
      reply({ok:true});
    }else if(message.type==='FETCH_CSDN_CATEGORIES'){
      reply(await fetchCsdnCategories());
    }else if(message.type==='DRY_RUN_TASK'){
      reply(await dryRunTask(String(message.id)));
    }else if(message.type==='GET_HEALTH_STATUS'){
      const status=await getCachedHealth();
      reply({ok:true,status,alert:isHealthAlert(status)});
    }
  })().catch(error=>reply({ok:false,message:error.message}));
  return true;
});

/** 系统通知点击：成功任务直达草稿编辑页，失败任务打开扩展面板查看诊断。 */
chrome.notifications?.onClicked?.addListener(notificationId=>{
  void (async()=>{
    try{
      const tasks=await allTasks();
      const task=tasks.find(item=>item.id===notificationId);
      await chrome.notifications.clear(notificationId).catch(()=>{});
      if(task?.draftUrl)await chrome.tabs.create({url:task.draftUrl,active:true});
      else await chrome.tabs.create({url:chrome.runtime.getURL('popup.html'),active:true});
    }catch{
      // 扩展上下文失效时静默忽略
    }
  })();
});

/** 远程健康检查：启动即刷新一次（12 小时缓存内跳过网络请求），此后每 12 小时强制刷新；失败静默保留旧缓存。 */
try{
  // SW 每次唤醒都会重跑顶层代码：同名 alarm 重复 create 会清空重置计时，必须先确认不存在再创建。
  void (async()=>{
    try{
      if(!await chrome.alarms.get(HEALTH_CHECK_ALARM))await chrome.alarms.create(HEALTH_CHECK_ALARM,{periodInMinutes:720});
    }catch{
      // alarms 权限缺失时跳过定时检查，不影响核心同步
    }
  })();
  chrome.alarms.onAlarm.addListener(alarm=>{
    if(alarm.name===HEALTH_CHECK_ALARM)void refreshHealthIfNeeded(true);
  });
  void refreshHealthIfNeeded();
}catch{
  // alarms 权限缺失时跳过定时检查，不影响核心同步
}
