// 掘金页面集成：新文章在发布成功后同步，历史文章通过统一弹窗立即同步。
import type {Article,PlatformId,SyncTask} from './types';
import {extractArticleId} from './source/juejin-api';
import {CSDN_LOGO,WECHAT_LOGO} from './targets/logos';
import {refreshPlatformSelection,syncReplyState} from './core/sync-dialog';

type EditorSnapshot={title:string;markdown:string;draftId:string;sourceUrl:string;tags?:string[];cover?:string;summary?:string};
type PlatformAuth={platform:PlatformId;name:string;ok:boolean;loggedIn:boolean;loading?:boolean;account?:string;accountId?:string;message?:string};
type SyncSource={kind:'history';articleId:string;title:string};
const READ_EDITOR_EVENT='article-ferry:read-editor';
const SNAPSHOT_ATTRIBUTE='data-article-ferry-editor';
const PUBLISH_EVENT='article-ferry:published';
const PUBLISH_START_EVENT='article-ferry:publish-start';
const PUBLISH_ATTRIBUTE='data-article-ferry-published';
const SYNC_ICON='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 5.5A5.5 5.5 0 0 0 3.2 4L2 5.5M3 10.5A5.5 5.5 0 0 0 12.8 12l1.2-1.5M2 2.8V5.5h2.7M14 13.2v-2.7h-2.7"/></svg>';
const PLATFORM_META:Record<PlatformId,{name:string;badge:string;logo:string;check:string;login:string}>={
  csdn:{name:'CSDN',badge:'博客草稿',logo:CSDN_LOGO,check:'CHECK_CSDN_STATUS',login:'OPEN_CSDN_LOGIN'},
  wechat:{name:'微信公众号',badge:'图文草稿',logo:WECHAT_LOGO,check:'CHECK_WECHAT_STATUS',login:'OPEN_WECHAT_LOGIN'}
};
let autoDefault=true;
let wechatAutoDefault=true;
let syncedIds:Promise<Set<string>>|undefined;
let currentDialogRefresh:(()=>Promise<void>)|null=null;
let currentPublishRefresh:(()=>Promise<void>)|null=null;
let publishPanel:HTMLElement|null=null;
let publishSelected=new Set<PlatformId>();
let publishAuths:PlatformAuth[]=[];
// 请求快照独立于面板生命周期；关闭面板不会丢失已提交的同步意图。
type PendingPublish={article?:Article;error?:string;platforms:PlatformId[];auths:PlatformAuth[];panel:HTMLElement|null;selection:Set<PlatformId>};
const pendingPublishes=new Map<string,PendingPublish>();

function isExtensionAlive():boolean{
  try{
    return typeof chrome!=='undefined'&&Boolean(chrome?.runtime?.id);
  }catch{
    return false;
  }
}

let isTeardown=false;
let globalObserver:MutationObserver|null=null;

function teardownContentScript(){
  if(isTeardown)return;
  isTeardown=true;
  if(globalObserver){
    globalObserver.disconnect();
    globalObserver=null;
  }
  window.removeEventListener('focus',onWindowFocus);
  document.removeEventListener(PUBLISH_EVENT,handleJuejinPublished);
  document.removeEventListener(PUBLISH_START_EVENT,handleJuejinPublishStart);
  pendingPublishes.clear();
  document.querySelector('.jc-sync-dialog-root')?.remove();
}

async function safeSendMessage<T=any>(message:any):Promise<T|undefined>{
  if(!isExtensionAlive()){
    teardownContentScript();
    return undefined;
  }
  try{
    const response=await chrome.runtime.sendMessage(message);
    return response as T;
  }catch(error){
    const errorMsg=String((error as Error)?.message||error);
    if(errorMsg.includes('Extension context invalidated')||!isExtensionAlive()){
      teardownContentScript();
      return undefined;
    }
    throw error;
  }
}

function escapeHtml(value:string){return value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));}
function readSelectedTagsFromDom(){const popup=document.querySelector<HTMLElement>('.publish-popup');if(!popup)return[];return[...new Set([...popup.querySelectorAll<HTMLElement>('[class*="tag"]')].filter(element=>typeof element.className==='string'&&/(?:^|[-\s])(?:active|selected|checked)(?:[-\s]|$)/i.test(element.className)).filter(element=>!element.querySelector('[class*="tag"]')).map(element=>element.textContent?.trim()||'').filter(text=>text.length>=1&&text.length<=30))];}
function readEditorArticle():Article{document.documentElement.removeAttribute(SNAPSHOT_ATTRIBUTE);document.dispatchEvent(new Event(READ_EDITOR_EVENT));const raw=document.documentElement.getAttribute(SNAPSHOT_ATTRIBUTE);document.documentElement.removeAttribute(SNAPSHOT_ATTRIBUTE);if(!raw)throw new Error('无法连接掘金编辑器');const snapshot=JSON.parse(raw) as EditorSnapshot;if(snapshot.title.trim().length<2||snapshot.markdown.trim().length<20)throw new Error('文章标题或正文不完整');return{id:snapshot.draftId||`draft-${Date.now()}`,sourceDraftId:snapshot.draftId||undefined,title:snapshot.title.trim(),markdown:snapshot.markdown,cover:snapshot.cover,summary:snapshot.summary,tags:snapshot.tags?.length?snapshot.tags:readSelectedTagsFromDom(),sourceUrl:snapshot.sourceUrl};}
function getJuejinUuid(){for(const entry of performance.getEntriesByType('resource'))try{const url=new URL(entry.name);const uuid=url.searchParams.get('uuid');if(url.hostname==='api.juejin.cn'&&uuid)return uuid;}catch{}return'';}
async function checkPlatform(platform:PlatformId):Promise<PlatformAuth>{
  const meta=PLATFORM_META[platform];
  if(!isExtensionAlive()){
    teardownContentScript();
    return{platform,name:meta.name,ok:false,loggedIn:false,message:'扩展已重载，请刷新网页'};
  }
  try{
    const result=await safeSendMessage({type:meta.check});
    if(!result){
      return{platform,name:meta.name,ok:false,loggedIn:false,message:'扩展已重载，请刷新网页'};
    }
    return{platform,name:meta.name,ok:result?.ok===true,loggedIn:result?.loggedIn===true,account:result?.account,accountId:result?.accountId,message:result?.message};
  }catch(error){
    return{platform,name:meta.name,ok:false,loggedIn:false,message:(error as Error).message};
  }
}

function platformCard(auth:PlatformAuth,selected:boolean){
  const meta=PLATFORM_META[auth.platform];
  const isLoading=auth.loading===true;
  const isLogged=!isLoading&&auth.loggedIn;
  let statusHtml='';
  if(isLoading){
    statusHtml='<span class="jc-card-status is-checking"><span class="jc-status-spinner"></span><span>检测登录状态…</span></span>';
  }else if(isLogged){
    const accountDisplay=auth.account?`已登录 · ${escapeHtml(auth.account)}`:'已登录 · 账号就绪';
    statusHtml=`<span class="jc-card-status is-logged" title="${escapeHtml(auth.account||'已登录')}"><span class="jc-status-dot"></span><span>${accountDisplay}</span></span>`;
  }else{
    const tip=auth.message?escapeHtml(auth.message):'未登录，需登录后同步';
    statusHtml=`<span class="jc-card-status is-unlogged" title="${tip}"><span class="jc-status-dot"></span><span>${tip}</span></span>`;
  }

  let actionHtml='';
  if(isLoading){
    actionHtml='<span class="jc-action-skeleton"></span>';
  }else if(isLogged){
    actionHtml=`<div class="jc-custom-checkbox ${selected?'is-checked':''}" aria-checked="${selected}" role="checkbox" aria-label="${meta.name} 同步选择"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 8.5 6.5 12 13 4" /></svg></div>`;
  }else{
    actionHtml=`<button class="jc-login-action-btn" type="button" data-platform="${auth.platform}" title="在新标签页前往 ${meta.name} 登录"><span>去登录</span><svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 9.5l7-7M9.5 7.5v-5h-5"/></svg></button>`;
  }

  return `<div class="jc-platform-card ${selected?'is-selected':''} ${isLoading?'is-loading':''} ${isLogged?'is-logged':'is-unlogged'}" data-platform="${auth.platform}" role="button" tabindex="${isLoading?'-1':'0'}" aria-label="${meta.name}，${isLogged?(selected?'已选择':'未选择'):'未登录'}">
    <div class="jc-card-logo"><img src="${meta.logo}" alt="${meta.name} Logo" class="jc-logo-img" /></div>
    <div class="jc-card-content">
      <div class="jc-card-header-row"><b class="jc-card-title">${meta.name}</b><span class="jc-card-badge">${meta.badge}</span></div>
      <div class="jc-card-meta-row">${statusHtml}</div>
    </div>
    <div class="jc-card-control">${actionHtml}</div>
  </div>`;
}

async function openSyncDialog(source:SyncSource,trigger:HTMLElement){
  document.querySelector('.jc-sync-dialog-root')?.remove();
  const root=document.createElement('div');
  root.className='jc-sync-dialog-root';
  root.innerHTML=`<div class="jc-sync-backdrop"></div>
<section class="jc-sync-dialog" role="dialog" aria-modal="true" aria-labelledby="jc-sync-title" tabindex="-1">
  <header class="jc-dialog-header">
    <div class="jc-dialog-brand">
      <div class="jc-dialog-emblem" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 17l20 0"/><path d="M4 17l2 -6h12l2 6"/><path d="M12 4v7"/><path d="M12 4l5 4h-5"/></svg>
      </div>
      <div class="jc-dialog-titles">
        <h2 id="jc-sync-title">同步到多平台</h2>
        <p>检测平台状态 · 一键同步为对应草稿</p>
      </div>
    </div>
    <div class="jc-header-actions">
      <button class="jc-btn-icon jc-auth-refresh" type="button" title="重新检测平台状态" aria-label="重新检测平台状态">
        <svg class="jc-refresh-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11A8.1 8.1 0 0 0 4.5 9M4 5v4h4M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4"/></svg>
      </button>
      <button class="jc-btn-icon jc-dialog-close" type="button" title="关闭弹窗" aria-label="关闭弹窗">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>
  </header>
  <div class="jc-dialog-body">
    <div class="jc-platform-list" aria-live="polite"></div>
    <div class="jc-sync-note">
      <div class="jc-note-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>
      </div>
      <div class="jc-note-content">
        <b>纯端侧安全摆渡 · 仅保存至草稿箱</b>
        <span>绝不自动公开发布。正文外链图片与源封面将在端侧安全转存至目标平台 CDN。</span>
      </div>
    </div>
  </div>
  <footer class="jc-dialog-footer">
    <div class="jc-footer-status">
      <span class="jc-status-dot"></span>
      <span class="jc-selected-count">正在检测平台状态…</span>
    </div>
    <div class="jc-footer-buttons">
      <button class="jc-dialog-cancel" type="button">取消</button>
      <button class="jc-dialog-confirm" type="button" disabled>
        <span class="jc-confirm-icon-wrap">${SYNC_ICON}</span>
        <span class="jc-confirm-text">确认同步</span>
      </button>
    </div>
  </footer>
</section>`;
  document.body.appendChild(root);

  const dialog=root.querySelector<HTMLElement>('.jc-sync-dialog')!;
  const list=root.querySelector<HTMLElement>('.jc-platform-list')!;
  const confirmButton=root.querySelector<HTMLButtonElement>('.jc-dialog-confirm')!;
  const count=root.querySelector<HTMLElement>('.jc-selected-count')!;
  const footerStatus=root.querySelector<HTMLElement>('.jc-footer-status')!;
  const refreshButton=root.querySelector<HTMLButtonElement>('.jc-auth-refresh')!;

  let auths:PlatformAuth[]=[
    {platform:'csdn',name:'CSDN',ok:true,loggedIn:false,loading:true},
    {platform:'wechat',name:'微信公众号',ok:true,loggedIn:false,loading:true}
  ];
  const selected=new Set<PlatformId>();
  // 提交期间冻结选择与刷新；默认勾选仅在首次检测完成时应用。
  let submitting=false;
  let initialized=false;
  let refreshing=false;

  const close=()=>{
    currentDialogRefresh=null;
    root.remove();
    trigger.focus();
  };

  const updateFooter=()=>{
    const hasSelected=selected.size>0;
    confirmButton.disabled=submitting||refreshing||!hasSelected;
    footerStatus.dataset.hasSelected=hasSelected?'true':'false';
    if(!hasSelected){
      count.textContent='请勾选要同步的目标平台';
    }else{
      count.textContent=`已选择 ${selected.size} 个平台 (${[...selected].map(p=>PLATFORM_META[p].name).join('、')})`;
    }
  };

  const render=()=>{
    list.innerHTML=auths.map(auth=>platformCard(auth,selected.has(auth.platform))).join('');
    updateFooter();

    list.querySelectorAll<HTMLElement>('.jc-platform-card').forEach(card=>{
      card.addEventListener('click',async()=>{
        const platform=card.dataset.platform as PlatformId;
        const auth=auths.find(item=>item.platform===platform);
        if(submitting||refreshing||!auth||auth.loading)return;

        if(!auth.loggedIn){
          if(!isExtensionAlive()){
            teardownContentScript();
            alert('扩展已重新加载或更新，请刷新网页后再试。');
            return;
          }
          await safeSendMessage({type:PLATFORM_META[platform].login});
          return;
        }

        if(selected.has(platform)){
          selected.delete(platform);
        }else{
          selected.add(platform);
        }
        render();
      });

      card.addEventListener('keydown',event=>{
        if(event.key==='Enter'||event.key===' '){
          event.preventDefault();
          card.click();
        }
      });
    });
  };

  const refresh=async(silent=false)=>{
    if(submitting||refreshing)return;
    refreshing=true;
    updateFooter();
    if(!silent){
      auths=[
        {platform:'csdn',name:'CSDN',ok:true,loggedIn:false,loading:true},
        {platform:'wechat',name:'微信公众号',ok:true,loggedIn:false,loading:true}
      ];
      render();
    }
    refreshButton.classList.add('is-spinning');
    try{
      const freshAuths=await Promise.all((['csdn','wechat'] as PlatformId[]).map(checkPlatform));
      auths=freshAuths;
      refreshPlatformSelection(selected,auths,[...(autoDefault?['csdn' as const]:[]),...(wechatAutoDefault?['wechat' as const]:[])],!initialized);
      initialized=true;
    }finally{
      refreshing=false;
      refreshButton.classList.remove('is-spinning');
      render();
    }
  };

  currentDialogRefresh=async()=>{
    await refresh(true);
  };

  root.querySelector('.jc-sync-backdrop')!.addEventListener('click',close);
  root.querySelector('.jc-dialog-close')!.addEventListener('click',close);
  root.querySelector('.jc-dialog-cancel')!.addEventListener('click',close);
  refreshButton.addEventListener('click',()=>void refresh());
  root.addEventListener('keydown',event=>{if(event.key==='Escape')close();});

  confirmButton.addEventListener('click',async()=>{
    if(submitting||refreshing||!selected.size)return;
    if(!isExtensionAlive()){
      teardownContentScript();
      alert('扩展已重新加载或更新，请刷新网页后再试。');
      return;
    }
    submitting=true;
    confirmButton.disabled=true;
    confirmButton.classList.add('is-loading');
    const label=confirmButton.querySelector<HTMLElement>('.jc-confirm-text')!;
    const platforms=[...selected];
    label.textContent=`正在同步到 ${platforms.length} 个平台…`;

    const results=await Promise.all(platforms.map(async platform=>{
      try{
        const wechatAccountId=platform==='wechat'?auths.find(item=>item.platform===platform)?.accountId:undefined;
        if(platform==='wechat'&&!wechatAccountId)throw new Error('无法确认公众号身份，请重新检测登录状态');
        const result=await safeSendMessage({type:'SYNC_HISTORY_ARTICLE',platform,articleId:source.articleId,title:source.title,sourceUrl:`https://juejin.cn/post/${source.articleId}`,uuid:getJuejinUuid(),wechatAccountId});
        if(result===undefined)throw new Error('扩展已重载，请刷新网页后重试');
        const state=syncReplyState(result);
        if(state.saved)rememberSynced(source.articleId,platform);
        return{platform,ok:true,...state};
      }catch(error){
        return{platform,ok:false,saved:false,message:(error as Error).message};
      }
    }));

    const failed=results.filter(item=>!item.ok);
    const pending=results.filter(item=>item.ok&&!item.saved);
    const saved=results.filter(item=>item.saved);
    close();
    setSyncButtonState(trigger,saved.length===results.length?'saved':'idle',`已保存 ${saved.length} 个平台${pending.length?`，${pending.length} 个待处理`:''}${failed.length?`，${failed.length} 个失败`:''}`);
    if(failed.length||pending.length)alert(`文章摆渡：\n${[...failed,...pending].map(item=>`• ${PLATFORM_META[item.platform].name}：${item.message}`).join('\n')}`);
  });

  render();
  dialog.focus();
  await refresh(true);
}

function setSyncButtonState(button:HTMLElement,state:'idle'|'saved',message=''){button.dataset.state=state;const label=button.querySelector<HTMLElement>('.jc-history-label');if(label)label.textContent=message||'同步多平台';if(state==='saved')window.setTimeout(()=>{if(button.isConnected)setSyncButtonState(button,'idle');},3000);}

function resetPublishSelection(){
  publishPanel=null;
  publishSelected=new Set();
  publishAuths=[];
  currentPublishRefresh=null;
}

function findPublishPanel(){
  return[...document.querySelectorAll<HTMLElement>('.publish-popup .panel, .panel')].find(panel=>{
    const title=panel.querySelector<HTMLElement>(':scope > .title')?.textContent?.trim()||'';
    return/(?:发布|更新)文章/.test(title)&&panel.querySelector(':scope > .footer');
  })||null;
}

function injectPublishIntegration(){
  const panel=findPublishPanel();
  if(!panel){if(publishPanel&&!publishPanel.isConnected)resetPublishSelection();return;}
  if(panel!==publishPanel){resetPublishSelection();publishPanel=panel;}
  if(panel.querySelector('.jc-publish-sync-field'))return;
  const footer=panel.querySelector<HTMLElement>(':scope > .footer');
  if(!footer)return;
  const field=document.createElement('div');
  field.className='form-item jc-publish-sync-field';
  const sampleItem=panel.querySelector('.form-item');
  const scopeAttr=sampleItem?[...sampleItem.attributes].find(a=>a.name.startsWith('data-v-'))?.name:null;
  if(scopeAttr)field.setAttribute(scopeAttr,'');
  field.innerHTML=`<div class="label"${scopeAttr?` ${scopeAttr}`:''}>多平台同步：</div><div class="form-item-content jc-publish-sync-content"${scopeAttr?` ${scopeAttr}`:''}>
    <div class="jc-publish-platforms" aria-live="polite">
      <label class="jc-publish-platform is-unlogged" data-platform="csdn">
        <input type="checkbox" class="jc-platform-input" data-platform="csdn" disabled />
        <span class="jc-platform-checkbox" aria-hidden="true">✓</span>
        <img src="${CSDN_LOGO}" class="jc-platform-icon" alt="" />
        <span class="jc-platform-name">CSDN</span>
        <span class="jc-platform-status"><span class="jc-publish-spinner"></span></span>
      </label>
      <label class="jc-publish-platform is-unlogged" data-platform="wechat">
        <input type="checkbox" class="jc-platform-input" data-platform="wechat" disabled />
        <span class="jc-platform-checkbox" aria-hidden="true">✓</span>
        <img src="${WECHAT_LOGO}" class="jc-platform-icon" alt="" />
        <span class="jc-platform-name">微信公众号</span>
        <span class="jc-platform-status"><span class="jc-publish-spinner"></span></span>
      </label>
    </div>
    <div class="jc-publish-sync-tip">掘金发布成功后自动保存至所选平台的草稿箱</div>
  </div>`;
  panel.insertBefore(field,footer);

  let refreshing=false;

  (['csdn','wechat'] as PlatformId[]).forEach(platform=>{
    const card=field.querySelector<HTMLLabelElement>(`.jc-publish-platform[data-platform="${platform}"]`)!;
    const input=card.querySelector<HTMLInputElement>('.jc-platform-input')!;

    input.addEventListener('change',()=>{
      if(input.checked){
        publishSelected.add(platform);
      }else{
        publishSelected.delete(platform);
      }
      card.classList.toggle('is-selected',input.checked);
    });

    card.addEventListener('click',event=>{
      if(!isExtensionAlive()){
        teardownContentScript();
        return;
      }
      const target=event.target as HTMLElement;
      if(target.closest('.jc-publish-login')){
        event.preventDefault();
        void safeSendMessage({type:PLATFORM_META[platform].login});
        return;
      }
      const auth=publishAuths.find(item=>item.platform===platform);
      if(!auth?.loggedIn&&!refreshing){
        event.preventDefault();
        void safeSendMessage({type:PLATFORM_META[platform].login});
      }
    });
  });

  const updateCardAuth=(auth:PlatformAuth)=>{
    const card=field.querySelector<HTMLLabelElement>(`.jc-publish-platform[data-platform="${auth.platform}"]`);
    if(!card)return;
    const input=card.querySelector<HTMLInputElement>('.jc-platform-input')!;
    const status=card.querySelector<HTMLElement>('.jc-platform-status')!;

    if(auth.loading){
      input.disabled=true;
      status.innerHTML='<span class="jc-publish-spinner"></span>';
    }else if(auth.loggedIn){
      input.disabled=false;
      status.innerHTML='';
      card.classList.remove('is-unlogged');
      card.classList.add('is-ready');
      input.checked=publishSelected.has(auth.platform);
      card.classList.toggle('is-selected',input.checked);
    }else{
      input.disabled=true;
      input.checked=false;
      publishSelected.delete(auth.platform);
      card.classList.remove('is-selected','is-ready');
      card.classList.add('is-unlogged');
      status.innerHTML=`<button type="button" class="jc-publish-login" data-login="${auth.platform}" title="前往 ${PLATFORM_META[auth.platform].name} 登录">去登录 ↗</button>`;
    }
  };

  const refresh=async()=>{
    if(refreshing||!isExtensionAlive())return;
    refreshing=true;
    // 加载态只更新界面，保留上次确认的账号供已选平台创建请求快照。
    (['csdn','wechat'] as PlatformId[]).forEach(platform=>updateCardAuth({platform,name:PLATFORM_META[platform].name,ok:true,loggedIn:false,loading:true}));
    try{
      const freshAuths=await Promise.all((['csdn','wechat'] as PlatformId[]).map(checkPlatform));
      // 旧面板或已移除字段的检测结果不得覆盖当前选择与账号。
      if(publishPanel!==panel||!field.isConnected||currentPublishRefresh!==refresh)return;
      publishAuths=freshAuths;
      publishAuths.forEach(updateCardAuth);
    }finally{
      refreshing=false;
    }
  };

  currentPublishRefresh=refresh;
  void refresh();
}

function handleJuejinPublishStart(){
  if(!isExtensionAlive()||!publishSelected.size)return;
  const raw=document.documentElement.getAttribute(PUBLISH_ATTRIBUTE);
  if(!raw)return;
  let requestId:string;
  try{requestId=JSON.parse(raw).requestId;}catch{return;}
  if(!requestId||pendingPublishes.has(requestId))return;
  const pending:PendingPublish={platforms:[...publishSelected],auths:publishAuths.map(auth=>({...auth})),panel:publishPanel,selection:publishSelected};
  try{pending.article=readEditorArticle();}catch(error){pending.error=(error as Error).message;}
  pendingPublishes.set(requestId,pending);
}

function handleJuejinPublished(){
  if(!isExtensionAlive()){
    teardownContentScript();
    return;
  }
  const raw=document.documentElement.getAttribute(PUBLISH_ATTRIBUTE);
  document.documentElement.removeAttribute(PUBLISH_ATTRIBUTE);
  if(!raw)return;
  let published:{requestId:string;draftId?:string;articleId?:string};
  try{published=JSON.parse(raw) as typeof published;}catch{return;}
  const pending=pendingPublishes.get(published.requestId);
  pendingPublishes.delete(published.requestId);
  if(!pending||!published.draftId||!published.articleId)return;
  const {platforms,auths}=pending;
  // 只消费对应请求的选择，不能清空用户新打开面板中的选择。
  if(publishPanel===pending.panel&&publishSelected===pending.selection){
    publishSelected.clear();
    publishPanel?.querySelectorAll<HTMLInputElement>('.jc-platform-input').forEach(input=>{input.checked=false;});
    publishPanel?.querySelectorAll<HTMLElement>('.jc-publish-platform').forEach(card=>{card.classList.remove('is-selected');});
  }
  try{
    const snapshot=pending.article;
    if(!snapshot)throw new Error(pending.error||'无法读取发布前的文章快照');
    if(snapshot.sourceDraftId&&snapshot.sourceDraftId!==published.draftId)throw new Error('发布响应与提交草稿不一致，已取消多平台同步');
    const article={...snapshot,id:published.articleId,sourceDraftId:published.draftId,sourceUrl:`https://juejin.cn/post/${published.articleId}`};
    const requests=platforms.map(async platform=>{
      const wechatAccountId=platform==='wechat'?auths.find(item=>item.platform===platform)?.accountId:undefined;
      if(platform==='wechat'&&!wechatAccountId)throw new Error('微信公众号身份已失效，请从文章列表重新同步');
      const result=await safeSendMessage({type:'SYNC_NEW_ARTICLE',platform,article,wechatAccountId});
      if(result===undefined)throw new Error('扩展已重载，请刷新网页后从文章列表重试');
      return{platform,...syncReplyState(result)};
    });
    void Promise.allSettled(requests).then(results=>{
      const problems=results.flatMap((result,index)=>result.status==='rejected'?[`• ${PLATFORM_META[platforms[index]].name}：${result.reason instanceof Error?result.reason.message:String(result.reason)}`]:result.value.saved?[]:[`• ${PLATFORM_META[result.value.platform].name}：${result.value.message}`]);
      if(problems.length)alert(`掘金已发布，多平台同步需要处理：\n${problems.join('\n')}`);
    });
  }catch(error){alert(`掘金已发布，但未触发多平台同步：${(error as Error).message}`);}
}

function syncedArticleIds(){
  if(!isExtensionAlive()){
    teardownContentScript();
    return Promise.resolve(new Set<string>());
  }
  if(!syncedIds)try{
    syncedIds=safeSendMessage({type:'GET_TASKS'}).then(result=>{
      const ids=new Set<string>();
      for(const task of((result?.tasks||[]) as SyncTask[]))if(task.status==='saved'){
        if(task.article?.id)ids.add(`${task.platform}:${task.article.id}`);
        const sourceId=task.article?.sourceUrl?extractArticleId(task.article.sourceUrl):'';
        if(sourceId)ids.add(`${task.platform}:${sourceId}`);
      }
      return ids;
    }).catch(()=>{
      syncedIds=undefined;
      return new Set<string>();
    });
  }catch{
    return Promise.resolve(new Set<string>());
  }
  return syncedIds;
}

function rememberSynced(articleId:string,platform:PlatformId){void syncedArticleIds().then(ids=>ids.add(`${platform}:${articleId}`));}

async function markSyncedButtons(){
  const buttons=document.querySelectorAll<HTMLElement>('.jc-history-sync,.jc-creator-sync');
  if(!buttons.length||!isExtensionAlive())return;
  const ids=await syncedArticleIds();
  buttons.forEach(button=>{
    const articleId=button.dataset.articleId||'';
    if(button.dataset.state==='idle'&&(ids.has(`csdn:${articleId}`)||ids.has(`wechat:${articleId}`)))setSyncButtonState(button,'saved','已同步，可再次选择');
  });
}

function wireHistoryButton(button:HTMLElement){
  button.addEventListener('click',event=>{
    event.preventDefault();
    event.stopPropagation();
    if(!isExtensionAlive()){
      teardownContentScript();
      alert('扩展已重新加载或更新，请刷新网页后再试。');
      return;
    }
    void openSyncDialog({kind:'history',articleId:button.dataset.articleId!,title:button.dataset.title||''},button);
  });
}

function injectHistoryMenus(){
  document.querySelectorAll<HTMLUListElement>('.content-main li.item.more > ul.more-list').forEach(menu=>{
    if(menu.querySelector('.jc-history-sync'))return;
    if(!/编辑/.test(menu.innerText)||!/删除/.test(menu.innerText))return;
    const content=menu.closest<HTMLElement>('.content-main');
    const link=content?.querySelector<HTMLAnchorElement>('a[href^="/post/"]');
    const articleId=link?extractArticleId(link.href):null;
    if(!articleId)return;
    const item=document.createElement('li');
    item.className='item jc-history-sync';
    item.dataset.articleId=articleId;
    item.dataset.title=link?.getAttribute('title')||link?.textContent?.trim()||'';
    item.dataset.state='idle';
    item.innerHTML=`${SYNC_ICON}<span class="jc-history-label">同步多平台</span>`;
    wireHistoryButton(item);
    menu.insertBefore(item,menu.querySelector(':scope > li.delete'));
  });
}

function injectCreatorCenterSync(){
  if(!location.pathname.startsWith('/creator/content/article'))return;
  document.querySelectorAll<HTMLElement>('.byte-dropdown').forEach(dropdown=>{
    const cell=dropdown.parentElement;
    if(!cell||cell.querySelector('.jc-creator-sync'))return;
    let row:HTMLElement|null=dropdown;
    let link:HTMLAnchorElement|null=null;
    while(row&&row!==document.body){
      if(row.querySelectorAll('.byte-dropdown').length>1)break;
      if(row instanceof HTMLAnchorElement&&row.href.includes('/post/')){link=row;break;}
      link=row.querySelector('a[href*="/post/"]');
      if(link)break;
      row=row.parentElement;
    }
    if(!link)return;
    const articleId=extractArticleId(link.href);
    if(!articleId)return;
    const button=document.createElement('button');
    button.type='button';
    button.className='jc-creator-sync';
    button.dataset.articleId=articleId;
    button.dataset.title=link.getAttribute('title')||link.querySelector<HTMLElement>('.title')?.textContent?.trim()||'';
    button.dataset.state='idle';
    button.title='选择平台并同步草稿';
    button.innerHTML=`${SYNC_ICON}<span class="jc-history-label">同步多平台</span>`;
    wireHistoryButton(button);
    cell.insertBefore(button,dropdown);
  });
}

async function resumePendingHistory(){
  if(!isExtensionAlive()){
    teardownContentScript();
    return;
  }
  try{
    const result=await safeSendMessage({type:'RESUME_PENDING_HISTORY'});
    if(!result?.ok){
      if(result?.message)alert(`文章摆渡：${result.message}`);
      return;
    }
    if(result.resumed){
      const state=syncReplyState(result);
      if(state.saved)rememberSynced(String(result.articleId),result.platform||'csdn');
      else alert(`文章摆渡：${state.message}`);
      syncedIds=undefined;
      void markSyncedButtons();
    }
  }catch{}
}

function inject(){
  if(!isExtensionAlive()){
    teardownContentScript();
    return;
  }
  document.querySelectorAll('.jc-editor-sync-control,.jc-sync-option').forEach(element=>element.remove());
  injectPublishIntegration();
  injectHistoryMenus();
  injectCreatorCenterSync();
  void markSyncedButtons();
}

let injectScheduled=false;
function scheduleInject(){
  if(!isExtensionAlive()){
    teardownContentScript();
    return;
  }
  if(injectScheduled)return;
  injectScheduled=true;
  requestAnimationFrame(()=>{
    injectScheduled=false;
    if(!isExtensionAlive()){
      teardownContentScript();
      return;
    }
    inject();
  });
}

function reportJuejinUuid(){
  if(!isExtensionAlive()){
    teardownContentScript();
    return;
  }
  const uuid=getJuejinUuid();
  if(uuid)void safeSendMessage({type:'REPORT_JUEJIN_UUID',uuid}).catch(()=>{});
}

function onWindowFocus(){
  if(!isExtensionAlive()){
    teardownContentScript();
    return;
  }
  reportJuejinUuid();
  void resumePendingHistory();
  syncedIds=undefined;
  void markSyncedButtons();
  if(currentDialogRefresh)void currentDialogRefresh();
  if(currentPublishRefresh)void currentPublishRefresh();
}

if(isExtensionAlive()){
  void safeSendMessage({type:'GET_SETTINGS'}).then(result=>{
    if(!isExtensionAlive())return;
    autoDefault=result?.settings?.autoSyncAfterPublish!==false;
    wechatAutoDefault=result?.settings?.wechatAutoSync!==false;
    reportJuejinUuid();
    inject();
    globalObserver=new MutationObserver(scheduleInject);
    globalObserver.observe(document.documentElement,{childList:true,subtree:true});
  }).catch(()=>{});

  document.addEventListener(PUBLISH_EVENT,handleJuejinPublished);
  document.addEventListener(PUBLISH_START_EVENT,handleJuejinPublishStart);
  window.addEventListener('focus',onWindowFocus);
}
