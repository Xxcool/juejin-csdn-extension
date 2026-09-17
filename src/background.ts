// 扩展后台协调器：管理登录状态、同步任务和 CSDN 草稿写入。
import {Semaphore} from './core/async';
import {allTasks,clearAllTasks,deleteTask,getArticleDraftMapping,getSettings,migrateStoredTasks,patchTask,preserveTaskMappings,putTask,saveArticleDraftMapping,saveSettings,saveTasks} from './core/store';
import {canDeleteTask,extractCsdnArticleId,findMatchingTask,isActiveTask,isInterruptedTask,isRetryableTask,isUncertainCreateTask} from './core/task';
import {SyncError,classifySyncError} from './core/diagnostic';
import {isSupportedMessage} from './core/message';
import {resolveCsdnCategories,shouldConfirmDraftUpdate} from './core/settings';
import {fetchJuejinDraftByArticleId,fetchJuejinDraftByDraftId} from './source/juejin-api';
import {csdnAdapter} from './targets/csdn';
import {checkCsdnAuth,fetchCsdnArticleState,saveDraftViaApi,validateCsdnArticle} from './targets/csdn-api';
import type {Article,ExtensionSettings,SyncTask,TaskStage} from './types';
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
    const article=await ensureArticleContent(task.article);
    validateCsdnArticle(article);
    const settings=await getSettings();
    await patchTask(task.id,{status:'checking-login',attempts:task.attempts+1,error:undefined,diagnostic:undefined,warnings:undefined,stats:undefined,progress:{current:0,total:0,message:'正在检查 CSDN 登录状态'}});
    const transformed=csdnAdapter.transform(article);
    await patchTask(task.id,{status:'transforming',progress:{current:0,total:0,message:'正在处理文章内容'}});
    stage='authentication';
    if(task.csdnArticleId){
      const state=await fetchCsdnArticleState(task.csdnArticleId);
      if(state==='published')throw new SyncError('该 CSDN 文章已公开发布，为避免覆盖线上文章已阻断同步。如需继续，请删除本条同步记录后另存新草稿。','blocked','draft');
    }
    const result=await saveDraftViaApi(transformed,{
      articleId:task.csdnArticleId,
      categories:resolveCsdnCategories(transformed.tags,settings),
      syncCover:settings.syncCover,
      imageFailurePolicy:settings.imageFailurePolicy,
      onPreparing:()=>{stage='content';},
      onProgress:async progress=>{stage='images';await patchTask(task.id,{status:'transforming',progress});},
      onSaving:async()=>{stage='draft';await patchTask(task.id,{status:'writing',progress:{current:1,total:1,message:task.csdnArticleId?'正在更新 CSDN 草稿':'正在创建 CSDN 草稿'}});}
    });
    await patchTask(task.id,{status:'saved',draftUrl:result.draftUrl,csdnArticleId:result.articleId,warnings:result.warnings,stats:{...result.stats,durationMs:Date.now()-startedAt},progress:undefined});
    await saveArticleDraftMapping(task.article,result.articleId,result.draftUrl);
    await chrome.action.setBadgeBackgroundColor({color:'#1d6744'});
    await chrome.action.setBadgeText({text:'✓'});
    setTimeout(()=>chrome.action.setBadgeText({text:''}),5000);
  }catch(error){
    const diagnostic=classifySyncError(error,stage);
    await patchTask(task.id,{status:diagnostic.category==='login'||diagnostic.category==='blocked'?'needs-user':'failed',error:diagnostic.message,diagnostic,progress:undefined});
    await chrome.action.setBadgeBackgroundColor({color:'#a24332'});
    await chrome.action.setBadgeText({text:'!'});
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

async function create(article:Article){
  const tasks=await allTasks();
  const previous=findMatchingTask(tasks,article);
  const active=previous&&isActiveTask(previous)?previous:undefined;
  if(active)return active;
  const settings=await getSettings();
  const now=new Date().toISOString();
  const mapping=previous?undefined:await getArticleDraftMapping(article);
  const csdnArticleId=previous?.csdnArticleId||extractCsdnArticleId(previous?.draftUrl)||mapping?.csdnArticleId;
  const draftUrl=previous?.draftUrl||mapping?.draftUrl;
  const needsConfirmation=shouldConfirmDraftUpdate(settings,csdnArticleId);
  const task:SyncTask=previous
    ?{...previous,article,status:needsConfirmation?'needs-confirmation':'queued',updatedAt:now,csdnArticleId,error:undefined,diagnostic:undefined,warnings:undefined,stats:undefined,progress:undefined}
    :{id:uid(),article,platform:'csdn',status:needsConfirmation?'needs-confirmation':'queued',createdAt:now,updatedAt:now,attempts:0,csdnArticleId,draftUrl};
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
    error:'上次创建 CSDN 草稿时扩展被中断，无法确认是否已保存。请先检查 CSDN 草稿箱，再决定是否重试。',
    diagnostic:classifySyncError(new Error('上次创建 CSDN 草稿时扩展被中断，无法确认是否已保存。'),'recovery'),
    progress:undefined
  })));
  const interrupted=tasks.filter(isInterruptedTask);
  await Promise.allSettled(interrupted.map(task=>execute(task)));
}

/** 启动序：先完成 storage 瘦身迁移，再恢复中断任务（恢复的任务经双路径回填正文）。 */
const recovery=migrateStoredTasks().then(()=>recoverInterruptedTasks());

type PendingHistory={articleId:string;title:string;sourceUrl:string;uuid:string;expiresAt:number};

async function openCsdnLogin(){
  await chrome.tabs.create({url:'https://passport.csdn.net/login',active:true});
}

async function syncHistory(request:Omit<PendingHistory,'expiresAt'>){
  if(request.uuid)await chrome.storage.local.set({[JUEJIN_UUID_KEY]:request.uuid});
  const auth=await checkCsdnAuth();
  if(!auth.ok)throw new Error(auth.message||'CSDN 登录状态检测失败');
  if(!auth.loggedIn){
    await chrome.storage.session.set({pendingHistory:{...request,expiresAt:Date.now()+10*60*1000}});
    await openCsdnLogin();
    return{ok:false,needsLogin:true,message:'请先登录 CSDN，返回掘金后将继续同步'};
  }
  const article=await fetchJuejinDraftByArticleId(request.articleId,request.uuid,request.title);
  const previous=findMatchingTask(await allTasks(),article);
  const mapping=previous?undefined:await getArticleDraftMapping(article);
  const updated=!!(previous?.csdnArticleId||extractCsdnArticleId(previous?.draftUrl)||mapping?.csdnArticleId);
  return{ok:true,articleId:request.articleId,updated,task:await create(article)};
}

async function resumePendingHistory(){
  const {pendingHistory}=await chrome.storage.session.get('pendingHistory') as {pendingHistory?:PendingHistory};
  if(!pendingHistory||pendingHistory.expiresAt<=Date.now()){
    await chrome.storage.session.remove('pendingHistory');
    return{ok:true,resumed:false};
  }
  const auth=await checkCsdnAuth();
  if(!auth.ok)throw new Error(auth.message||'CSDN 登录状态检测失败');
  if(!auth.loggedIn)return{ok:true,resumed:false,needsLogin:true};
  await chrome.storage.session.remove('pendingHistory');
  const article=await fetchJuejinDraftByArticleId(pendingHistory.articleId,pendingHistory.uuid,pendingHistory.title);
  return{ok:true,resumed:true,articleId:pendingHistory.articleId,task:await create(article)};
}

chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  (async()=>{
    if(!isSupportedMessage(message)){reply({ok:false,message:'不支持的扩展消息'});return;}
    await recovery;
    if(message.type==='SYNC_NEW_ARTICLE'){
      reply({ok:true,task:await create(message.article as Article)});
    }else if(message.type==='CHECK_CSDN_STATUS'){
      reply(await checkCsdnAuth());
    }else if(message.type==='OPEN_CSDN_LOGIN'){
      await openCsdnLogin();
      reply({ok:true});
    }else if(message.type==='REPORT_JUEJIN_UUID'){
      const uuid=String(message.uuid||'');
      if(uuid)await chrome.storage.local.set({[JUEJIN_UUID_KEY]:uuid});
      reply({ok:true});
    }else if(message.type==='SYNC_HISTORY_ARTICLE'){
      reply(await syncHistory({articleId:String(message.articleId),title:String(message.title||''),sourceUrl:String(message.sourceUrl||''),uuid:String(message.uuid||'')}));
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
      if(task){void execute(task).catch(()=>{});reply({ok:true});}else reply({ok:false,message:'任务不存在'});
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
    }
  })().catch(error=>reply({ok:false,message:error.message}));
  return true;
});
