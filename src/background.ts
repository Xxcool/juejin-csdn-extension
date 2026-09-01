// 扩展后台协调器：管理登录状态、同步任务和 CSDN 草稿写入。
import {allTasks,getSettings,patchTask,putTask,saveSettings,saveTasks} from './core/store';
import {extractCsdnArticleId,isInterruptedTask,isUncertainCreateTask,withPublishedArticleId} from './core/task';
import {classifySyncError} from './core/diagnostic';
import {isSupportedMessage} from './core/message';
import {fetchJuejinDraftByArticleId} from './source/juejin-api';
import {csdnAdapter} from './targets/csdn';
import {checkCsdnAuth,saveDraftViaApi} from './targets/csdn-api';
import type {Article,ExtensionSettings,SyncTask,TaskStage} from './types';
import {uid} from './types';

const runningTasks=new Set<string>();

async function execute(task:SyncTask){
  if(runningTasks.has(task.id))return;
  runningTasks.add(task.id);
  const startedAt=Date.now();
  let stage:TaskStage='authentication';
  try{
    await patchTask(task.id,{status:'checking-login',attempts:task.attempts+1,error:undefined,diagnostic:undefined,warnings:undefined,stats:undefined,progress:{current:0,total:0,message:'正在检查 CSDN 登录状态'}});
    const article=csdnAdapter.transform(task.article);
    await patchTask(task.id,{status:'transforming',progress:{current:0,total:0,message:'正在处理文章内容'}});
    stage='authentication';
    const result=await saveDraftViaApi(article,{
      articleId:task.csdnArticleId,
      onPreparing:()=>{stage='content';},
      onProgress:async progress=>{stage='images';await patchTask(task.id,{status:'transforming',progress});},
      onSaving:async()=>{stage='draft';await patchTask(task.id,{status:'writing',progress:{current:1,total:1,message:task.csdnArticleId?'正在更新 CSDN 草稿':'正在创建 CSDN 草稿'}});}
    });
    await patchTask(task.id,{status:'saved',draftUrl:result.draftUrl,csdnArticleId:result.articleId,warnings:result.warnings,stats:{...result.stats,durationMs:Date.now()-startedAt},progress:undefined});
    await chrome.action.setBadgeBackgroundColor({color:'#1d6744'});
    await chrome.action.setBadgeText({text:'✓'});
    setTimeout(()=>chrome.action.setBadgeText({text:''}),5000);
  }catch(error){
    const diagnostic=classifySyncError(error,stage);
    await patchTask(task.id,{status:diagnostic.category==='login'?'needs-user':'failed',error:diagnostic.message,diagnostic,progress:undefined});
    await chrome.action.setBadgeBackgroundColor({color:'#a24332'});
    await chrome.action.setBadgeText({text:'!'});
    throw error;
  }finally{runningTasks.delete(task.id);}
}

async function create(article:Article){
  if(article.title.trim().length<2||article.markdown.trim().length<20)throw new Error('文章标题或正文不完整');
  const tasks=await allTasks();
  const previous=tasks.find(item=>item.article.id===article.id&&item.platform==='csdn');
  const active=previous&&['queued','checking-login','transforming','writing'].includes(previous.status)?previous:undefined;
  if(active)return active;
  const now=new Date().toISOString();
  const task:SyncTask=previous
    ?{...previous,article,status:'queued',updatedAt:now,csdnArticleId:previous.csdnArticleId||extractCsdnArticleId(previous.draftUrl),error:undefined,diagnostic:undefined,warnings:undefined,stats:undefined,progress:undefined}
    :{id:uid(),article,platform:'csdn',status:'queued',createdAt:now,updatedAt:now,attempts:0};
  await putTask(task);
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

const recovery=recoverInterruptedTasks();

type PendingHistory={articleId:string;title:string;sourceUrl:string;uuid:string;expiresAt:number};

async function openCsdnLogin(){
  await chrome.tabs.create({url:'https://passport.csdn.net/login',active:true});
}

async function syncHistory(request:Omit<PendingHistory,'expiresAt'>){
  const auth=await checkCsdnAuth();
  if(!auth.ok)throw new Error(auth.message||'CSDN 登录状态检测失败');
  if(!auth.loggedIn){
    await chrome.storage.session.set({pendingHistory:{...request,expiresAt:Date.now()+10*60*1000}});
    await openCsdnLogin();
    return{ok:false,needsLogin:true,message:'请先登录 CSDN，返回掘金后将继续同步'};
  }
  const article=await fetchJuejinDraftByArticleId(request.articleId,request.uuid,request.title);
  return{ok:true,articleId:request.articleId,task:await create(article)};
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
    if(message.type==='STAGE_ARTICLE'){
      await chrome.storage.session.set({stagedArticle:{article:message.article,sourceTabId:sender.tab?.id,expiresAt:Date.now()+120000}});
      reply({ok:true});
    }else if(message.type==='CLEAR_STAGED_ARTICLE'){
      await chrome.storage.session.remove('stagedArticle');
      reply({ok:true});
    }else if(message.type==='CONFIRM_PUBLISH'){
      const {stagedArticle}=await chrome.storage.session.get('stagedArticle');
      const sameTab=stagedArticle?.sourceTabId===undefined||stagedArticle.sourceTabId===sender.tab?.id;
      if(stagedArticle?.article&&stagedArticle.expiresAt>Date.now()&&sameTab){
        await chrome.storage.session.remove('stagedArticle');
        const article=stagedArticle.article as Article;
        reply({ok:true,task:await create(withPublishedArticleId(article,String(message.sourceUrl||article.sourceUrl)))});
      }else reply({ok:false,message:'没有待确认文章'});
    }else if(message.type==='CHECK_CSDN_STATUS'){
      reply(await checkCsdnAuth());
    }else if(message.type==='OPEN_CSDN_LOGIN'){
      await openCsdnLogin();
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
    }else if(message.type==='CLEAR_TASKS'){
      await saveTasks([]);
      reply({ok:true});
    }
  })().catch(error=>reply({ok:false,message:error.message}));
  return true;
});
