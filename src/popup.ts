// 插件弹窗交互：双 Tab 仪表盘导航、平台登录状态、同步历史与设置管理。
import type {ExtensionSettings,SyncTask,TaskStatus} from './types';
import {categoryLabels,stageLabels} from './core/diagnostic';
import {defaultSettings,formatCategoryMappings,normalizeSettings,parseCategoryMappings} from './core/settings';

const $=<T extends HTMLElement>(selector:string)=>document.querySelector<T>(selector)!;
let loginStatus:'checking'|'logged-in'|'logged-out'|'error'='checking';
let checkSequence=0;
let historyFilter:'all'|'saved'|'failed'|'working'='all';
let currentSettings:ExtensionSettings=defaultSettings;
let currentTab:'history'|'settings'='history';

const labels:Record<TaskStatus,string>={
  saved:'同步成功',
  failed:'同步失败',
  'needs-user':'需要处理',
  'needs-confirmation':'等待确认',
  queued:'等待同步',
  'checking-login':'检查登录',
  transforming:'处理内容',
  writing:'保存草稿'
};

let toastTimer=0;
function toast(message:string){
  const element=$('#toast');
  element.textContent=message;
  element.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer=window.setTimeout(()=>element.classList.remove('show'),2400);
}

function switchTab(tab:'history'|'settings'){
  currentTab=tab;
  document.querySelectorAll<HTMLButtonElement>('.tab-button').forEach(button=>{
    const isActive=button.dataset.tab===tab;
    button.classList.toggle('active',isActive);
    button.setAttribute('aria-selected',String(isActive));
  });
  const thumb=$('#spring-thumb');
  if(thumb){
    thumb.style.transform=tab==='settings'?'translateX(calc(100% + 2px))':'translateX(0)';
  }
  const historyPane=$('#pane-history');
  const settingsPane=$('#pane-settings');
  historyPane.classList.toggle('active',tab==='history');
  settingsPane.classList.toggle('active',tab==='settings');
  historyPane.hidden=tab!=='history';
  settingsPane.hidden=tab!=='settings';
  if(tab==='history')void loadTasks();
  if(tab==='settings')void loadSettings();
}

async function checkLogin(){
  const current=++checkSequence;
  const pill=$('#login-state');
  const text=$('#login-text');
  loginStatus='checking';
  pill.className='platform-pill checking';
  pill.title='正在检测 CSDN 登录状态…';
  text.textContent='检测中…';
  try{
    const result=await Promise.race([
      chrome.runtime.sendMessage({type:'CHECK_CSDN_STATUS'}),
      new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('检测超时')),7000))
    ]);
    if(current!==checkSequence)return;
    if(result?.loggedIn){
      loginStatus='logged-in';
      pill.className='platform-pill logged';
      pill.title='CSDN 已登录，点击可刷新状态';
      text.textContent=result.account?`CSDN: ${result.account} ✓`:'CSDN 已登录 ✓';
    }else if(result?.ok){
      loginStatus='logged-out';
      pill.className='platform-pill login-link';
      pill.title='CSDN 未登录，点击前往登录';
      text.textContent='CSDN 未登录 ↗';
    }else throw new Error(result?.message||'检测失败');
  }catch(error){
    if(current!==checkSequence)return;
    loginStatus='error';
    pill.className='platform-pill error';
    pill.title='登录状态检测失败，点击重试';
    text.textContent='CSDN 检测失败 ↻';
    toast((error as Error).message);
  }
}

function escapeHtml(value:string){
  return value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
}

function formatDate(value:string){
  return new Date(value).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).replaceAll('/','-');
}

function formatDuration(durationMs:number){
  if(durationMs<1000)return`${durationMs} 毫秒`;
  if(durationMs<60000)return`${(durationMs/1000).toFixed(1)} 秒`;
  return`${Math.floor(durationMs/60000)} 分 ${Math.round(durationMs%60000/1000)} 秒`;
}

function statusKind(task:SyncTask){
  if(task.status==='saved')return task.warnings?.length?'warning':'success';
  if(task.status==='failed'||task.status==='needs-user')return'failure';
  if(task.status==='needs-confirmation')return'warning';
  return'working';
}

function taskCard(task:SyncTask){
  const kind=statusKind(task);
  const stateLabel=task.status==='saved'&&task.warnings?.length?'同步成功，有警告':labels[task.status];
  const cover=task.article.cover?`<img src="${escapeHtml(task.article.cover)}" alt="">`:'';
  const actions=[];
  if(task.draftUrl)actions.push(`<button class="history-action btn-action-primary" data-open="${escapeHtml(task.draftUrl)}">草稿 ↗</button>`);
  if(task.status==='needs-confirmation')actions.push(`<button class="history-action confirm btn-action-confirm" data-confirm="${escapeHtml(task.id)}">确认更新</button>`);
  if(['failed','needs-user'].includes(task.status))actions.push(`<button class="history-action retry btn-action-retry" data-retry="${escapeHtml(task.id)}">重试</button>`);
  if(!['queued','checking-login','transforming','writing'].includes(task.status))actions.push(`<button class="history-action delete btn-action-delete" data-delete="${escapeHtml(task.id)}" title="删除本地记录" aria-label="删除本地记录"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button>`);
  const action=`<span class="task-actions">${actions.join('')}</span>`;
  const error=task.error?`<p class="platform-error" title="${escapeHtml(task.error)}">${escapeHtml(task.error)}</p>`:'';
  const diagText=task.diagnostic?`${task.article.title} [${task.diagnostic.category} - ${task.diagnostic.stage}]: ${task.diagnostic.message} (${task.diagnostic.suggestion})`:'';
  const diagnostic=task.diagnostic?`<div class="task-diagnostic"><div class="diagnostic-header"><b>${categoryLabels[task.diagnostic.category]} · ${stageLabels[task.diagnostic.stage]}</b><button class="btn-copy-diag" data-copy-diag="${escapeHtml(diagText)}">复制诊断</button></div><span>${escapeHtml(task.diagnostic.suggestion)}</span></div>`:'';
  const warning=task.warnings?.length?`<p class="platform-warning" title="${escapeHtml(task.warnings.join('\n'))}">${escapeHtml(task.warnings.join('；'))}</p>`:'';
  const stats=task.stats?`耗时 <strong>${formatDuration(task.stats.durationMs)}</strong><i>·</i>图片 <strong>${task.stats.imageSucceeded}/${task.stats.imageTotal}</strong>${task.stats.imageFailed?`<i>·</i><strong>${task.stats.imageFailed}</strong> 失败`:''}`:'';
  const progressPercent=task.progress?.total?Math.min(100,Math.max(0,Math.round(task.progress.current/task.progress.total*100))):0;
  const progress=task.progress?`<div class="task-progress-box">
    <div class="progress-info">
      <span class="progress-msg">${escapeHtml(task.progress.message||'正在同步中…')}</span>
      <span class="progress-percent">${task.progress.total?`${progressPercent}%`:'进行中…'}</span>
    </div>
    <p class="task-progress ${task.progress.total?'':'indeterminate'}"><span style="width:${task.progress.total?progressPercent:35}%"></span></p>
  </div>`:'';
  return`<div class="history-card ${kind}">
    <div class="task-main-row">
      <span class="history-cover">${cover}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></span>
      <div class="task-info">
        <b class="task-title" title="${escapeHtml(task.article.title)}">${escapeHtml(task.article.title)}</b>
        <div class="task-meta">
          <span class="state-tag ${kind}">${stateLabel}</span>
          <span>·</span>
          <span>${formatDate(task.updatedAt)}</span>
        </div>
      </div>
    </div>
    ${progress}
    ${error}
    ${diagnostic}
    ${warning}
    <div class="task-bottom-row">
      <div class="task-stats">${stats||'<span>CSDN 草稿同步</span>'}</div>
      ${action}
    </div>
  </div>`;
}

async function loadTasks(){
  try{
    const result=await chrome.runtime.sendMessage({type:'GET_TASKS'});
    const all=((result?.tasks||[]) as SyncTask[]).sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt));
    const tasks=all.filter(task=>historyFilter==='all'||(historyFilter==='saved'?task.status==='saved':historyFilter==='failed'?['failed','needs-user'].includes(task.status):['queued','checking-login','transforming','writing','needs-confirmation'].includes(task.status)));
    const list=$('#task-list');
    $('#history-count').textContent=historyFilter==='all'?`${all.length} 篇`:`${tasks.length}/${all.length} 篇`;
    const badge=$('#history-badge');
    badge.textContent=String(all.length);
    const clearButton=$<HTMLButtonElement>('#history-clear');
    clearButton.disabled=!all.length;
    $<HTMLButtonElement>('#history-retry-all').disabled=!all.some(task=>['failed','needs-user'].includes(task.status));
    if(!tasks.length){
      list.innerHTML=`<div class="empty-state-view harbor-empty-view">
        <div class="harbor-beacon-stage">
          <div class="water-ripple"></div>
          <div class="harbor-boat-card">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M2 17l20 0"/>
              <path d="M4 17l2 -6h12l2 6"/>
              <path d="M12 5v6"/>
              <path d="M12 5l6 3.5h-6"/>
            </svg>
            <span class="beacon-star"></span>
          </div>
        </div>
        <h2 class="empty-headline harbor-headline">${all.length?'当前筛选下无记录':'准备就绪，开启摆渡'}</h2>
        <p class="empty-subtext harbor-subtext">${all.length?'可尝试切换上方的状态筛选条件。':'在掘金发文时开启同步勾选，文章与图片将如期摆渡至目标草稿箱。'}</p>
        ${all.length?'':`<button id="btn-goto-juejin" class="btn-launch-juejin btn-embark">
          <span>前往掘金文章管理</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M7 17l9.2-9.2M17 17V8H8"/></svg>
        </button>
        <div class="guide-card">
          <div class="guide-card-header">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
            <span>只需 3 步完成摆渡</span>
          </div>
          <div class="guide-steps">
            <div class="guide-step-item">
              <span class="step-num-pill">1</span>
              <span class="step-title">掘金写完</span>
              <span class="step-desc">正常撰写并发布</span>
            </div>
            <div class="guide-step-item">
              <span class="step-num-pill">2</span>
              <span class="step-title">勾选同步</span>
              <span class="step-desc">面板开启 CSDN</span>
            </div>
            <div class="guide-step-item">
              <span class="step-num-pill">3</span>
              <span class="step-title">草稿直达</span>
              <span class="step-desc">打开草稿箱确认</span>
            </div>
          </div>
        </div>`}
      </div>`;
      $('#btn-goto-juejin')?.addEventListener('click',()=>void chrome.tabs.create({url:'https://juejin.cn/creator/content/article/essays?status=all',active:true}));
      return;
    }
    list.innerHTML=tasks.map(taskCard).join('');
    list.querySelectorAll<HTMLImageElement>('.history-cover img').forEach(image=>image.addEventListener('error',()=>image.remove()));
    list.querySelectorAll<HTMLButtonElement>('[data-open]').forEach(button=>button.addEventListener('click',()=>void chrome.tabs.create({url:button.dataset.open,active:true})));
    list.querySelectorAll<HTMLButtonElement>('[data-copy-diag]').forEach(button=>button.addEventListener('click',async()=>{
      const text=button.dataset.copyDiag||'';
      if(!text)return;
      try{
        await navigator.clipboard.writeText(text);
        toast('诊断信息已复制到剪贴板');
      }catch{
        toast('复制失败，请手动复制');
      }
    }));
    list.querySelectorAll<HTMLButtonElement>('[data-retry]').forEach(button=>button.addEventListener('click',async()=>{
      button.disabled=true;
      button.textContent='重试中…';
      const retry=await chrome.runtime.sendMessage({type:'RETRY_TASK',id:button.dataset.retry});
      if(!retry?.ok)toast(retry?.message||'重新同步失败');
      else toast('已重新发起同步');
      setTimeout(()=>void loadTasks(),600);
    }));
    list.querySelectorAll<HTMLButtonElement>('[data-confirm]').forEach(button=>button.addEventListener('click',async()=>{
      button.disabled=true;
      button.textContent='更新中…';
      const result=await chrome.runtime.sendMessage({type:'CONFIRM_TASK_UPDATE',id:button.dataset.confirm});
      if(!result?.ok)toast(result?.message||'确认更新失败');
      else toast('已确认更新草稿');
      setTimeout(()=>void loadTasks(),500);
    }));
    list.querySelectorAll<HTMLButtonElement>('[data-delete]').forEach(button=>button.addEventListener('click',async()=>{
      if(!confirm('确定删除这条本地同步记录吗？此操作不会删除 CSDN 草稿。'))return;
      const result=await chrome.runtime.sendMessage({type:'DELETE_TASK',id:button.dataset.delete});
      if(!result?.ok)toast(result?.message||'删除失败');
      else{toast('本地记录已删除');await loadTasks();}
    }));
  }catch(error){toast((error as Error).message);}
}

function renderSettings(settings:ExtensionSettings){
  $<HTMLInputElement>('#auto-sync').checked=settings.autoSyncAfterPublish;
  $<HTMLInputElement>('#sync-cover').checked=settings.syncCover;
  $<HTMLInputElement>('#confirm-update').checked=settings.confirmDraftUpdate;
  $<HTMLSelectElement>('#image-failure').value=settings.imageFailurePolicy;
  $<HTMLInputElement>('#default-category').value=settings.defaultCsdnCategory;
  $<HTMLTextAreaElement>('#category-mappings').value=formatCategoryMappings(settings.categoryMappings);
}

async function saveSettingsFromForm(){
  currentSettings=normalizeSettings({
    autoSyncAfterPublish:$<HTMLInputElement>('#auto-sync').checked,
    syncCover:$<HTMLInputElement>('#sync-cover').checked,
    confirmDraftUpdate:$<HTMLInputElement>('#confirm-update').checked,
    imageFailurePolicy:$<HTMLSelectElement>('#image-failure').value,
    defaultCsdnCategory:$<HTMLInputElement>('#default-category').value,
    categoryMappings:parseCategoryMappings($<HTMLTextAreaElement>('#category-mappings').value)
  });
  const result=await chrome.runtime.sendMessage({type:'SAVE_SETTINGS',settings:currentSettings});
  if(!result?.ok){toast(result?.message||'设置保存失败');return;}
  renderSettings(currentSettings);
  toast('设置已保存');
}

async function loadSettings(){
  const result=await chrome.runtime.sendMessage({type:'GET_SETTINGS'});
  currentSettings=normalizeSettings(result?.settings);
  renderSettings(currentSettings);
}

document.querySelectorAll<HTMLButtonElement>('.tab-button').forEach(button=>{
  button.addEventListener('click',()=>switchTab(button.dataset.tab as 'history'|'settings'));
  button.addEventListener('keydown',event=>{
    if(event.key==='ArrowRight'||event.key==='ArrowLeft'){
      event.preventDefault();
      const target=button.dataset.tab==='history'?'settings':'history';
      const targetBtn=$<HTMLButtonElement>(`.tab-button[data-tab="${target}"]`);
      targetBtn?.focus();
      switchTab(target);
    }
  });
});

$('#login-state').addEventListener('click',()=>{
  if(loginStatus==='logged-out')void chrome.runtime.sendMessage({type:'OPEN_CSDN_LOGIN'});
  else void checkLogin();
});

document.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach(button=>button.addEventListener('click',()=>{
  historyFilter=button.dataset.filter as typeof historyFilter;
  document.querySelectorAll('[data-filter]').forEach(item=>item.classList.toggle('active',item===button));
  void loadTasks();
}));

$<HTMLButtonElement>('#history-retry-all').addEventListener('click',async()=>{
  const result=await chrome.runtime.sendMessage({type:'RETRY_FAILED_TASKS'});
  if(!result?.ok){toast(result?.message||'批量重试失败');return;}
  toast(result.count?`已重试 ${result.count} 个失败任务`:'没有可重试任务');
  setTimeout(()=>void loadTasks(),500);
});

$<HTMLButtonElement>('#history-clear').addEventListener('click',async()=>{
  if(!confirm('确定清空全部同步历史吗？此操作不会删除 CSDN 草稿。'))return;
  const result=await chrome.runtime.sendMessage({type:'CLEAR_TASKS'});
  if(!result?.ok){toast(result?.message||'清空失败');return;}
  toast('同步历史已清空');
  await loadTasks();
});

['#auto-sync','#sync-cover','#confirm-update','#image-failure'].forEach(selector=>$(selector).addEventListener('change',()=>void saveSettingsFromForm()));
['#default-category','#category-mappings'].forEach(selector=>$(selector).addEventListener('change',()=>void saveSettingsFromForm()));

chrome.storage.onChanged.addListener((changes,area)=>{
  if(area==='local'&&changes.syncTasks&&$('#pane-history').classList.contains('active'))void loadTasks();
});

try{
  const version=chrome.runtime.getManifest()?.version;
  if(version){
    const versionEl=$('#app-version');
    if(versionEl)versionEl.textContent=`版本 v${version}`;
    const brandVersionEl=$('#brand-version');
    if(brandVersionEl)brandVersionEl.textContent=`v${version}`;
  }
}catch{}

void loadTasks();
void loadSettings();
void checkLogin();

