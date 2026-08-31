// 掘金页面集成：新文章发布前暂存 Markdown，并在本人文章列表菜单中提供历史同步入口。
import type {Article} from './types';
import {extractArticleId} from './source/juejin-api';

type LoginState='checking'|'logged-in'|'logged-out'|'error';
type EditorSnapshot={title:string;markdown:string;draftId:string;sourceUrl:string};

const READ_EDITOR_EVENT='article-ferry:read-editor';
const SNAPSHOT_ATTRIBUTE='data-article-ferry-editor';
const HISTORY_SYNC_ICON='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 5.5A5.5 5.5 0 0 0 3.2 4L2 5.5M3 10.5A5.5 5.5 0 0 0 12.8 12l1.2-1.5M2 2.8V5.5h2.7M14 13.2v-2.7h-2.7"/></svg>';
let autoDefault=true;
let syncEnabled=false;
let awaitingPublish=false;
let loginState:LoginState='checking';
let loginCheckSequence=0;
const wiredButtons=new WeakSet<HTMLButtonElement>();

function getNewEditorContext(){
  const rightBox=document.querySelector<HTMLElement>('.right-box');
  if(!rightBox)return null;
  const publishPopup=rightBox.querySelector<HTMLElement>('.publish-popup');
  const actionButton=publishPopup?.querySelector<HTMLButtonElement>(':scope > button');
  const actionText=actionButton?.innerText.trim()||'';
  if(!/发布/.test(actionText)||/更新/.test(actionText))return null;
  const draftButton=[...rightBox.querySelectorAll<HTMLButtonElement>(':scope > button')]
    .find(button=>button.classList.contains('btn-drafts')||/草稿箱/.test(button.innerText));
  return draftButton?{rightBox,publishPopup,draftButton}:null;
}

function readEditorArticle():Article{
  document.documentElement.removeAttribute(SNAPSHOT_ATTRIBUTE);
  document.dispatchEvent(new Event(READ_EDITOR_EVENT));
  const raw=document.documentElement.getAttribute(SNAPSHOT_ATTRIBUTE);
  document.documentElement.removeAttribute(SNAPSHOT_ATTRIBUTE);
  if(!raw)throw new Error('无法连接掘金编辑器');
  const snapshot=JSON.parse(raw) as EditorSnapshot;
  if(snapshot.title.trim().length<2||snapshot.markdown.trim().length<20)throw new Error('文章标题或正文不完整');
  return{
    id:snapshot.draftId||`draft-${Date.now()}`,
    title:snapshot.title.trim(),
    markdown:snapshot.markdown,
    tags:[],
    sourceUrl:snapshot.sourceUrl
  };
}

function publishSucceeded(){
  return !!extractArticleId(location.href)||/发布成功|发布完成|审核中/.test(document.body.innerText);
}

function startPublishConfirmation(){
  if(awaitingPublish)return;
  awaitingPublish=true;
  const started=Date.now();
  const timer=setInterval(()=>{
    if(publishSucceeded()){
      clearInterval(timer);
      awaitingPublish=false;
      chrome.runtime.sendMessage({type:'CONFIRM_PUBLISH',sourceUrl:location.href}).catch(()=>{});
    }else if(Date.now()-started>60000){
      clearInterval(timer);
      awaitingPublish=false;
      chrome.runtime.sendMessage({type:'CLEAR_STAGED_ARTICLE'}).catch(()=>{});
    }
  },500);
}

function showStageError(message:string){
  const hint=document.querySelector<HTMLElement>('.jc-sync-option small');
  if(hint)hint.textContent=`同步未启动：${message}`;
}

function wireFinalPublish(panel:HTMLElement){
  const button=[...panel.querySelectorAll<HTMLButtonElement>('.footer button,button')]
    .find(element=>/确定并发布/.test(element.innerText));
  if(!button||wiredButtons.has(button))return;
  wiredButtons.add(button);
  button.addEventListener('click',()=>{
    if(!syncEnabled)return;
    try{
      const article=readEditorArticle();
      startPublishConfirmation();
      chrome.runtime.sendMessage({type:'STAGE_ARTICLE',article}).then(result=>{
        if(!result?.ok)showStageError(result?.message||'暂存失败');
      }).catch(error=>showStageError(error.message));
    }catch(error){
      showStageError((error as Error).message);
    }
  },true);
}

function renderLoginState(){
  const option=document.querySelector<HTMLElement>('.jc-sync-option');
  const input=option?.querySelector<HTMLInputElement>('input');
  const hint=option?.querySelector<HTMLElement>('small');
  if(!option||!input||!hint)return;
  if(loginState==='logged-in'){
    input.disabled=false;
    if(!option.dataset.initialized){
      input.checked=autoDefault;
      option.dataset.initialized='true';
    }
    syncEnabled=input.checked;
    hint.textContent='同步到 CSDN 草稿箱';
  }else{
    input.checked=false;
    input.disabled=true;
    syncEnabled=false;
    hint.textContent=loginState==='checking'?'检测 CSDN 登录状态…':loginState==='logged-out'?'点击登录 CSDN':'登录状态检测失败，点击重试';
  }
}

async function updateCsdnState(){
  if(!document.querySelector('.jc-sync-option'))return;
  const sequence=++loginCheckSequence;
  loginState='checking';
  renderLoginState();
  try{
    const result=await chrome.runtime.sendMessage({type:'CHECK_CSDN_STATUS'});
    if(sequence!==loginCheckSequence)return;
    loginState=result?.loggedIn?'logged-in':result?.ok?'logged-out':'error';
  }catch{
    if(sequence!==loginCheckSequence)return;
    loginState='error';
  }
  renderLoginState();
}

function createNewArticleOption(){
  const option=document.createElement('label');
  option.className='jc-sync-option jc-editor-sync-control';
  option.innerHTML='<input type="checkbox"><span class="jc-check">✓</span><span class="jc-sync-copy"><b>除掘金外还需同步</b><small>检测 CSDN 登录状态…</small></span>';
  const input=option.querySelector<HTMLInputElement>('input')!;
  input.addEventListener('change',()=>syncEnabled=input.checked);
  option.addEventListener('click',()=>{
    if(loginState==='logged-out')void chrome.runtime.sendMessage({type:'OPEN_CSDN_LOGIN'});
    else if(loginState==='error')void updateCsdnState();
  });
  return option;
}

function injectEditorIntegration(){
  const context=getNewEditorContext();
  if(!context){
    document.querySelectorAll('.jc-editor-sync-control').forEach(element=>element.remove());
    syncEnabled=false;
    return;
  }
  let control=context.rightBox.querySelector<HTMLElement>(':scope > .jc-editor-sync-control');
  if(!control){
    control=createNewArticleOption();
    context.rightBox.insertBefore(control,context.draftButton);
    updateCsdnState();
  }
  const panel=context.publishPopup?.querySelector<HTMLElement>('.panel');
  if(panel)wireFinalPublish(panel);
}

function getJuejinUuid(){
  for(const entry of performance.getEntriesByType('resource')){
    try{
      const url=new URL(entry.name);
      const uuid=url.searchParams.get('uuid');
      if(url.hostname==='api.juejin.cn'&&uuid)return uuid;
    }catch{}
  }
  return'';
}

function setHistoryButtonState(button:HTMLElement,state:'idle'|'working'|'login'|'saved',message=''){
  button.dataset.state=state;
  const label=button.querySelector<HTMLElement>('.jc-history-label');
  if(label)label.textContent=state==='working'?'正在同步…':state==='login'?'登录后继续同步':state==='saved'?'已保存到 CSDN ✓':message||'同步到 CSDN';
}

async function syncHistoryArticle(button:HTMLLIElement){
  if(button.dataset.state==='working')return;
  setHistoryButtonState(button,'working');
  const articleId=button.dataset.articleId!;
  try{
    const result=await chrome.runtime.sendMessage({
      type:'SYNC_HISTORY_ARTICLE',
      articleId,
      title:button.dataset.title||'',
      sourceUrl:`https://juejin.cn/post/${articleId}`,
      uuid:getJuejinUuid()
    });
    if(result?.needsLogin){
      setHistoryButtonState(button,'login');
      return;
    }
    if(!result?.ok)throw new Error(result?.message||'同步失败');
    setHistoryButtonState(button,'saved');
  }catch(error){
    setHistoryButtonState(button,'idle');
    alert(`文章摆渡：${(error as Error).message}`);
  }
}

function injectHistoryMenus(){
  document.querySelectorAll<HTMLUListElement>('.content-main li.item.more > ul.more-list').forEach(menu=>{
    if(menu.querySelector('.jc-history-sync'))return;
    const menuText=menu.innerText;
    if(!/编辑/.test(menuText)||!/删除/.test(menuText))return;
    const content=menu.closest<HTMLElement>('.content-main');
    const link=content?.querySelector<HTMLAnchorElement>('a[href^="/post/"]');
    const articleId=link?extractArticleId(link.href):null;
    if(!articleId)return;
    const item=document.createElement('li');
    item.className='item jc-history-sync';
    item.dataset.articleId=articleId;
    item.dataset.title=link?.getAttribute('title')||link?.textContent?.trim()||'';
    item.dataset.state='idle';
    item.innerHTML=`${HISTORY_SYNC_ICON}<span class="jc-history-label">同步到 CSDN</span>`;
    item.addEventListener('click',event=>{
      event.preventDefault();
      event.stopPropagation();
      void syncHistoryArticle(item);
    });
    const deleteItem=menu.querySelector(':scope > li.delete');
    menu.insertBefore(item,deleteItem);
  });
}

async function resumePendingHistory(){
  try{
    const result=await chrome.runtime.sendMessage({type:'RESUME_PENDING_HISTORY'});
    if(!result?.ok){
      if(result?.message)alert(`文章摆渡：${result.message}`);
      return;
    }
    if(!result.resumed)return;
    const button=[...document.querySelectorAll<HTMLLIElement>('.jc-history-sync')]
      .find(item=>item.dataset.articleId===String(result.articleId));
    if(button)setHistoryButtonState(button,'saved');
  }catch{}
}

function inject(){
  injectEditorIntegration();
  injectHistoryMenus();
}

chrome.runtime.sendMessage({type:'GET_SETTINGS'}).then(result=>{
  autoDefault=result?.settings?.autoSyncAfterPublish!==false;
  inject();
  new MutationObserver(inject).observe(document.documentElement,{childList:true,subtree:true,characterData:true});
});

// 发布后发生页面跳转时，新页面仅在后台确有暂存文章时完成同步，不会同步普通浏览的文章。
if(/\/(?:post|spost)\//.test(location.pathname)){
  void chrome.runtime.sendMessage({type:'CONFIRM_PUBLISH',sourceUrl:location.href});
}

window.addEventListener('focus',()=>{
  void updateCsdnState();
  void resumePendingHistory();
});
