// 插件弹窗交互：管理页面导航、平台登录状态、同步历史和设置。
import type {ExtensionSettings,SyncTask,TaskStatus} from './types';
import {categoryLabels,stageLabels} from './core/diagnostic';
import {defaultSettings,formatCategoryMappings,normalizeSettings,parseCategoryMappings} from './core/settings';

const $=<T extends HTMLElement>(selector:string)=>document.querySelector<T>(selector)!;
const pages=['home','platform','history','settings'];
let loginStatus:'checking'|'logged-in'|'logged-out'|'error'='checking';
let checkSequence=0;
let historyFilter:'all'|'saved'|'failed'|'working'='all';
let currentSettings:ExtensionSettings=defaultSettings;

const labels:Record<TaskStatus,string>={
  saved:'同步成功',
  failed:'同步失败',
  'needs-user':'等待登录',
  'needs-confirmation':'等待确认',
  queued:'等待同步',
  'checking-login':'检查登录',
  transforming:'处理内容',
  writing:'保存草稿'
};

function toast(message:string){
  const element=$('#toast');
  element.textContent=message;
  element.classList.add('show');
  setTimeout(()=>element.classList.remove('show'),2600);
}

function show(page:string){
  pages.forEach(id=>$('#'+id).classList.toggle('active',id===page));
  const home=page==='home';
  $('#app-header').classList.toggle('subpage',!home);
  $('#back').classList.toggle('hidden',home);
  $('#header-brand').classList.toggle('hidden',!home);
  $('#page-title').textContent=home?'文章摆渡':({platform:'平台管理',history:'同步历史',settings:'设置'} as Record<string,string>)[page];
  if(page==='history')void loadTasks();
  if(page==='platform')void checkLogin();
}

async function checkLogin(){
  const current=++checkSequence;
  const state=$('#login-state');
  loginStatus='checking';
  state.className='checking';
  state.textContent='检测中…';
  try{
    const result=await Promise.race([
      chrome.runtime.sendMessage({type:'CHECK_CSDN_STATUS'}),
      new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('检测超时')),7000))
    ]);
    if(current!==checkSequence)return;
    if(result?.loggedIn){
      loginStatus='logged-in';
      state.className='logged';
      state.textContent=result.account||'已登录';
      $('#platform-summary').textContent='CSDN 已登录，可以同步';
    }else if(result?.ok){
      loginStatus='logged-out';
      state.className='login-link';
      state.textContent='去登录 ↗';
      $('#platform-summary').textContent='CSDN 未登录，请先登录';
    }else throw new Error(result?.message||'检测失败');
  }catch(error){
    if(current!==checkSequence)return;
    loginStatus='error';
    state.className='login-link';
    state.textContent='检测失败';
    $('#platform-summary').textContent='登录状态检测失败，点击重试';
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
  if(task.draftUrl)actions.push(`<button class="history-action" data-open="${escapeHtml(task.draftUrl)}">草稿 ↗</button>`);
  if(task.status==='needs-confirmation')actions.push(`<button class="history-action confirm" data-confirm="${escapeHtml(task.id)}">确认更新</button>`);
  if(['failed','needs-user'].includes(task.status))actions.push(`<button class="history-action retry" data-retry="${escapeHtml(task.id)}">重试</button>`);
  if(!['queued','checking-login','transforming','writing'].includes(task.status))actions.push(`<button class="history-action delete" data-delete="${escapeHtml(task.id)}" aria-label="删除本地记录">删除</button>`);
  const action=`<span class="history-actions">${actions.join('')}</span>`;
  const error=task.error?`<p class="platform-error">${escapeHtml(task.error)}</p>`:'';
  const diagnostic=task.diagnostic?`<div class="task-diagnostic"><b>${categoryLabels[task.diagnostic.category]} · ${stageLabels[task.diagnostic.stage]}</b><span>${escapeHtml(task.diagnostic.suggestion)}</span></div>`:'';
  const warning=task.warnings?.length?`<p class="platform-warning" title="${escapeHtml(task.warnings.join('\n'))}">${escapeHtml(task.warnings.join('；'))}</p>`:'';
  const stats=task.stats?`<p class="task-stats">耗时 ${formatDuration(task.stats.durationMs)}<i>·</i>图片 ${task.stats.imageSucceeded}/${task.stats.imageTotal} 成功${task.stats.imageFailed?`，${task.stats.imageFailed} 失败`:''}</p>`:'';
  const progress=task.progress?`<p class="task-progress"><span style="width:${task.progress.total?Math.round(task.progress.current/task.progress.total*100):12}%"></span></p>`:'';
  return`<details class="history-card" open>
    <summary>
      <span class="history-cover">${cover}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5h8l4 4V20.5H6zM14 3.5v4h4M9 12h6M9 15.5h6"/></svg></span>
      <span class="history-copy"><b title="${escapeHtml(task.article.title)}">${escapeHtml(task.article.title)}</b><small><strong class="${kind}">${stateLabel}</strong><i>·</i>${formatDate(task.updatedAt)}</small>${progress}</span>
      <span class="history-chevron" aria-hidden="true"></span>
    </summary>
    <div class="platform-result ${kind}">
      <span class="result-icon" aria-hidden="true">${kind==='success'?'✓':kind==='failure'?'×':kind==='warning'?'!':'·'}</span>
      <span class="platform-result-copy"><b>CSDN</b>${stats}${error}${diagnostic}${warning}</span>
      <span class="platform-state">${task.progress?escapeHtml(task.progress.message):stateLabel}</span>
      ${action}
    </div>
  </details>`;
}

async function loadTasks(){
  try{
    const result=await chrome.runtime.sendMessage({type:'GET_TASKS'});
    const all=((result?.tasks||[]) as SyncTask[]).sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt));
    const tasks=all.filter(task=>historyFilter==='all'||(historyFilter==='saved'?task.status==='saved':historyFilter==='failed'?['failed','needs-user'].includes(task.status):['queued','checking-login','transforming','writing','needs-confirmation'].includes(task.status)));
    const list=$('#task-list');
    $('#history-count').textContent=historyFilter==='all'?`最近 ${all.length} 条记录`:`筛选出 ${tasks.length} 条`;
    $('#history-summary').textContent=all.length?`已有 ${all.length} 条同步记录`:'暂无同步记录';
    const clearButton=$<HTMLButtonElement>('#history-clear');
    clearButton.disabled=!all.length;
    $<HTMLButtonElement>('#history-retry-all').disabled=!all.some(task=>['failed','needs-user'].includes(task.status));
    if(!tasks.length){
      list.innerHTML=`<div class="empty"><svg viewBox="0 0 48 48"><path d="M8 17h32v22H8zM8 17l5-8h22l5 8M18 25h12v5H18z"/></svg>${all.length?'当前筛选下暂无记录':'暂无同步记录'}</div>`;
      return;
    }
    list.innerHTML=tasks.map(taskCard).join('');
    list.querySelectorAll<HTMLImageElement>('.history-cover img').forEach(image=>image.addEventListener('error',()=>image.remove()));
    list.querySelectorAll<HTMLButtonElement>('[data-open]').forEach(button=>button.addEventListener('click',()=>void chrome.tabs.create({url:button.dataset.open,active:true})));
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

document.querySelectorAll<HTMLElement>('[data-page]').forEach(button=>button.addEventListener('click',()=>show(button.dataset.page!)));
$('#back').addEventListener('click',()=>show('home'));
$('#platform-refresh').addEventListener('click',()=>void checkLogin());
$('#login-state').addEventListener('click',()=>loginStatus==='error'?void checkLogin():loginStatus==='logged-out'?void chrome.runtime.sendMessage({type:'OPEN_CSDN_LOGIN'}):undefined);
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
  if(area==='local'&&changes.syncTasks&&$('#history').classList.contains('active'))void loadTasks();
});
void loadTasks();
void loadSettings();
void checkLogin();
