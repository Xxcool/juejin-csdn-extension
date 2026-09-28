// 扩展后台协调器：管理登录状态、同步任务和 CSDN 草稿写入。
import {Semaphore} from './core/async';
import {allTasks,clearAllTasks,deleteTask,finishSavedTask,getArticleDraftMapping,getSettings,migrateStoredTasks,patchTask,preserveTaskMappings,putTask,removeArticleDraftMapping,saveSettings,saveTasks} from './core/store';
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
 * 摘要仍使用提交时已保存的值（包括空字符串），不被较晚的草稿修改覆盖。
 */
async function ensureArticleContent(article:Article):Promise<Article>{
  if(article.markdown.trim().length>=20)return article;
  const uuid=await getJuejinUuid();
  if(!uuid)throw new SyncError('本地已清理文章正文，请先打开掘金任意页面后重试','unknown','validation');
  if(article.sourceDraftId){
    const fetched=await fetchJuejinDraftByDraftId(article.sourceDraftId,uuid,article.title);
    return{...fetched,id:article.id,sourceUrl:article.sourceUrl,summary:article.summary??fetched.summary};
  }
  if(/^\d+$/.test(article.id)){
    const fetched=await fetchJuejinDraftByArticleId(article.id,uuid,article.title);
    return{...fetched,sourceUrl:article.sourceUrl||fetched.sourceUrl,summary:article.summary??fetched.summary};
  }
  throw new SyncError('文章正文已清理且缺少掘金草稿标识，请从掘金页面重新发起同步','content','validation');
}

async function runTask(task:SyncTask){
  const startedAt=Date.now();
  let stage:TaskStage='validation';
  let savedResult:Awaited<ReturnType<typeof saveDraftViaApi>>|undefined;
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
    let csdnArticleId=task.csdnArticleId;
    const clearCsdnTarget=async()=>{
      csdnArticleId=undefined;
      await patchTask(task.id,{csdnArticleId:undefined,draftUrl:undefined});
      await removeArticleDraftMapping(task.article,'csdn');
    };
    if(task.platform==='csdn'&&csdnArticleId){
      const state=await fetchCsdnArticleState(csdnArticleId);
      if(state==='unauthorized')throw new SyncError('请先登录 CSDN，再更新已有草稿','login','authentication');
      if(state==='published')throw new SyncError('该 CSDN 文章已公开发布，为避免覆盖线上文章已阻断同步。如需继续，请删除本条同步记录后另存新草稿。','blocked','draft');
      if(state==='unknown')throw new SyncError('无法确认 CSDN 文章仍是草稿，已暂停更新，请稍后重试','blocked','draft');
      if(state==='missing'){
        // 明确被删除的旧草稿改为新建；先清除旧 ID，使中断恢复按“不确定新建”处理。
        await clearCsdnTarget();
      }
    }
    const isUpdate=()=>task.platform==='wechat'?!!task.wechatAppMsgId:!!csdnArticleId;
    const callbacks={
      onPreparing:()=>{stage='content';},
      onProgress:async(progress:SyncTask['progress'])=>{stage='images';if(progress)await patchTask(task.id,{status:'transforming',progress});},
      onSaving:async()=>{stage='draft';await patchTask(task.id,{status:'writing',progress:{current:1,total:1,message:isUpdate()?`正在更新${platformName}草稿`:`正在创建${platformName}草稿`}});}
    };
    const result=task.platform==='wechat'?await saveWechatDraft(transformed,{...callbacks,appMsgId:task.wechatAppMsgId,accountId:task.wechatAccountId}):await saveDraftViaApi(transformed,{
      articleId:csdnArticleId,
      categories:resolveCsdnCategories(transformed.tags,settings),
      syncCover:settings.syncCover,
      autoSummary:settings.autoSummary,
      appendSourceLink:settings.appendSourceLink,
      imageFailurePolicy:settings.imageFailurePolicy,
      onPreparing:callbacks.onPreparing,
      onProgress:callbacks.onProgress,
      onSaving:callbacks.onSaving,
      onDowngradeToCreate:clearCsdnTarget
    });
    savedResult=result;
    await finishSavedTask(task.id,result.articleId,result.draftUrl,{draftUrl:result.draftUrl,...(task.platform==='wechat'?{wechatAppMsgId:result.articleId}:{csdnArticleId:result.articleId}),warnings:result.warnings,stats:{...result.stats,durationMs:Date.now()-startedAt},progress:undefined,error:undefined,diagnostic:undefined});
    // 徽标是保存后的附属操作，失败不能把已落盘的远端成功改写成同步失败。
    try{
      await chrome.action.setBadgeBackgroundColor({color:'#1d6744'});
      await chrome.action.setBadgeText({text:'✓'});
      setTimeout(()=>void chrome.action.setBadgeText({text:''}).catch(()=>{}),5000);
    }catch(error){console.warn('草稿已保存，但扩展徽标更新失败：',error);}
    // task 局部变量仍是入参旧状态（patchTask 只写 storage），必须显式标记 saved，否则成功通知永不触发。
    const notification=buildTaskNotification({...task,status:'saved',draftUrl:result.draftUrl,stats:{...result.stats,durationMs:Date.now()-startedAt}},Date.now()-startedAt);
    if(notification)await showTaskNotification(notification);
  }catch(error){
    if(savedResult){
      // 远端已返回草稿 ID；即使首次本地写入失败，也不能允许按“新建失败”自动重试。
      const diagnostic=classifySyncError(new SyncError('草稿已在目标平台保存，但本地结果记录失败。请先检查目标草稿箱','interrupted','recovery'),'recovery');
      try{await patchTask(task.id,{status:'needs-user',draftUrl:savedResult.draftUrl,...(task.platform==='wechat'?{wechatAppMsgId:savedResult.articleId}:{csdnArticleId:savedResult.articleId}),error:diagnostic.message,diagnostic,progress:undefined});}
      catch(recordError){console.warn('草稿已保存，但本地任务记录仍无法写入：',recordError);}
      throw error;
    }
    const diagnostic=classifySyncError(error,stage);
    const failedTask:SyncTask={...task,status:['login','blocked','interrupted'].includes(diagnostic.category)?'needs-user':'failed',error:diagnostic.message,diagnostic};
    await patchTask(task.id,{status:failedTask.status,error:diagnostic.message,diagnostic,progress:undefined});
    try{await chrome.action.setBadgeBackgroundColor({color:'#a24332'});await chrome.action.setBadgeText({text:'!'});}catch{}
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
/** 登录续传队列只在后台串行读改写，避免两个平台同时要求登录时相互覆盖。 */
const pendingHistoryGate=new Semaphore(1);
const pendingHistoryKey=(request:PendingHistory)=>`${request.platform}:${request.wechatAccountId||''}:${request.articleId}`;
async function readPendingHistories(){
  const data=await chrome.storage.session.get(['pendingHistories','pendingHistory']) as {pendingHistories?:PendingHistory[];pendingHistory?:PendingHistory};
  const requests=Array.isArray(data.pendingHistories)?data.pendingHistories:[];
  if(data.pendingHistory&&!requests.some(item=>pendingHistoryKey(item)===pendingHistoryKey(data.pendingHistory!)))requests.push(data.pendingHistory);
  return requests.filter(item=>item.expiresAt>Date.now());
}
async function savePendingHistories(requests:PendingHistory[]){
  await chrome.storage.session.set({pendingHistories:requests});
  await chrome.storage.session.remove('pendingHistory');
}

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
    await pendingHistoryGate.run(async()=>{
      const pending={...request,expiresAt:Date.now()+10*60*1000};
      const requests=(await readPendingHistories()).filter(item=>pendingHistoryKey(item)!==pendingHistoryKey(pending));
      requests.push(pending);
      await savePendingHistories(requests);
    });
    await (request.platform==='wechat'?openWechatLogin():openCsdnLogin());
    return{ok:false,needsLogin:true,message:`请先登录${name}，返回掘金后将继续同步`};
  }
  const article=await fetchJuejinDraftByArticleId(request.articleId,request.uuid,request.title);
  return{ok:true,articleId:request.articleId,platform:request.platform,task:await create(article,request.platform,request.wechatAccountId)};
}

async function resumePendingHistory(){
  return pendingHistoryGate.run(async()=>{
    let requests=await readPendingHistories();
    await savePendingHistories(requests);
    const results:{articleId:string;platform:PlatformId;task:SyncTask}[]=[];
    const errors:{articleId:string;platform:PlatformId;message:string}[]=[];
    for(const request of [...requests]){
      const auth=request.platform==='wechat'?await checkWechatAuth():await checkCsdnAuth();
      if(!auth.ok){errors.push({articleId:request.articleId,platform:request.platform,message:auth.message||'目标平台登录状态检测失败'});continue;}
      if(!auth.loggedIn)continue;
      let article:Article|undefined;
      try{
        article=await fetchJuejinDraftByArticleId(request.articleId,request.uuid,request.title);
        const task=await create(article,request.platform,request.wechatAccountId);
        results.push({articleId:request.articleId,platform:request.platform,task});
      }catch(error){
        errors.push({articleId:request.articleId,platform:request.platform,message:(error as Error).message||'恢复同步失败'});
        // 任务已落盘（即使目标平台写入失败）时，交由任务记录处理，避免登录续传再次自动执行。
        if(!article||!findMatchingTask(await allTasks(),article,request.platform,request.wechatAccountId))continue;
      }
      requests=requests.filter(item=>pendingHistoryKey(item)!==pendingHistoryKey(request));
      await savePendingHistories(requests);
    }
    return{ok:true,resumed:results.length>0,results,errors,needsLogin:requests.length>0};
  });
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
  if(message?.target&&message.target!=='background')return;
  if(!isSupportedMessage(message))return;
  (async()=>{
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
      else if(task){
        if(message.asNew){
          if(task.platform==='wechat')task.wechatAppMsgId=undefined;
          else task.csdnArticleId=undefined;
          task.draftUrl=undefined;
          await removeArticleDraftMapping(task.article,task.platform,task.wechatAccountId);
          await patchTask(task.id,{wechatAppMsgId:undefined,csdnArticleId:undefined,draftUrl:undefined,error:undefined,diagnostic:undefined,status:'queued'});
        }
        void execute(task).catch(()=>{});
        reply({ok:true});
      }else reply({ok:false,message:'任务不存在'});
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
      else{await deleteTask(task.id,{removeMapping:Boolean(message.removeMapping)});reply({ok:true});}
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
