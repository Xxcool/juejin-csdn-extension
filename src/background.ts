// 扩展后台协调器：管理登录状态、同步任务和 CSDN 草稿写入。
import {allTasks,getSettings,patchTask,putTask,saveSettings,saveTasks} from './core/store';
import {fetchJuejinDraftByArticleId} from './source/juejin-api';
import {csdnAdapter} from './targets/csdn';
import {checkCsdnAuth,saveDraftViaApi} from './targets/csdn-api';
import type {Article,ExtensionSettings,SyncTask} from './types';
import {uid} from './types';

async function execute(task:SyncTask){
  try{
    await patchTask(task.id,{status:'checking-login',attempts:task.attempts+1,error:undefined});
    const article=csdnAdapter.transform(task.article);
    await patchTask(task.id,{status:'transforming'});
    await patchTask(task.id,{status:'writing'});
    const result=await saveDraftViaApi(article);
    await patchTask(task.id,{status:'saved',draftUrl:result.draftUrl});
    await chrome.action.setBadgeBackgroundColor({color:'#1d6744'});
    await chrome.action.setBadgeText({text:'✓'});
    setTimeout(()=>chrome.action.setBadgeText({text:''}),5000);
  }catch(error){
    const message=(error as Error).message;
    await patchTask(task.id,{status:/登录/.test(message)?'needs-user':'failed',error:message});
    await chrome.action.setBadgeBackgroundColor({color:'#a24332'});
    await chrome.action.setBadgeText({text:'!'});
    throw error;
  }
}

async function create(article:Article){
  if(article.title.trim().length<2||article.markdown.trim().length<20)throw new Error('文章标题或正文不完整');
  const tasks=await allTasks();
  const previous=tasks.find(item=>item.article.id===article.id&&item.platform==='csdn');
  const active=previous&&['queued','checking-login','transforming','writing'].includes(previous.status)?previous:undefined;
  if(active)return active;
  const now=new Date().toISOString();
  const task:SyncTask=previous
    ?{...previous,article,status:'queued',updatedAt:now,error:undefined,draftUrl:undefined}
    :{id:uid(),article,platform:'csdn',status:'queued',createdAt:now,updatedAt:now,attempts:0};
  await putTask(task);
  await execute(task);
  return(await allTasks()).find(item=>item.id===task.id)||task;
}

type PendingHistory={articleId:string;title:string;sourceUrl:string;uuid:string;expiresAt:number};

async function openCsdnLogin(){
  await chrome.tabs.create({url:'https://passport.csdn.net/login',active:true});
}

async function syncHistory(request:Omit<PendingHistory,'expiresAt'>){
  const auth=await checkCsdnAuth();
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
  if(!auth.loggedIn)return{ok:true,resumed:false,needsLogin:true};
  await chrome.storage.session.remove('pendingHistory');
  const article=await fetchJuejinDraftByArticleId(pendingHistory.articleId,pendingHistory.uuid,pendingHistory.title);
  return{ok:true,resumed:true,articleId:pendingHistory.articleId,task:await create(article)};
}

chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  (async()=>{
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
        reply({ok:true,task:await create({...article,sourceUrl:message.sourceUrl||article.sourceUrl})});
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
