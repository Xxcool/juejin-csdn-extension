// 插件弹窗交互：管理页面导航、平台登录状态、同步历史和设置。
import type {SyncTask,TaskStatus} from './types';

const $=<T extends HTMLElement>(selector:string)=>document.querySelector<T>(selector)!;
const pages=['home','platform','history','settings'];
let loginStatus:'checking'|'logged-in'|'logged-out'|'error'='checking';
let checkSequence=0;

const labels:Record<TaskStatus,string>={
  saved:'同步成功',
  failed:'同步失败',
  'needs-user':'等待登录',
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

function statusKind(task:SyncTask){
  if(task.status==='saved')return task.warnings?.length?'warning':'success';
  if(task.status==='failed'||task.status==='needs-user')return'failure';
  return'working';
}

function taskCard(task:SyncTask){
  const kind=statusKind(task);
  const stateLabel=task.status==='saved'&&task.warnings?.length?'同步成功，有警告':labels[task.status];
  const cover=task.article.cover?`<img src="${escapeHtml(task.article.cover)}" alt="">`:'';
  const action=task.draftUrl
    ?`<button class="history-action" data-open="${escapeHtml(task.draftUrl)}">查看草稿 <span>↗</span></button>`
    :(['failed','needs-user'].includes(task.status)?`<button class="history-action retry" data-retry="${escapeHtml(task.id)}">重新同步</button>`:'');
  const error=task.error?`<p class="platform-error">${escapeHtml(task.error)}</p>`:'';
  const warning=task.warnings?.length?`<p class="platform-warning" title="${escapeHtml(task.warnings.join('\n'))}">${escapeHtml(task.warnings.join('；'))}</p>`:'';
  const progress=task.progress?`<p class="task-progress"><span style="width:${task.progress.total?Math.round(task.progress.current/task.progress.total*100):12}%"></span></p>`:'';
  return`<details class="history-card" open>
    <summary>
      <span class="history-cover">${cover}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5h8l4 4V20.5H6zM14 3.5v4h4M9 12h6M9 15.5h6"/></svg></span>
      <span class="history-copy"><b title="${escapeHtml(task.article.title)}">${escapeHtml(task.article.title)}</b><small><strong class="${kind}">${stateLabel}</strong><i>·</i>${formatDate(task.updatedAt)}</small>${progress}</span>
      <span class="history-chevron" aria-hidden="true"></span>
    </summary>
    <div class="platform-result ${kind}">
      <span class="result-icon" aria-hidden="true">${kind==='success'?'✓':kind==='failure'?'×':kind==='warning'?'!':'·'}</span>
      <span class="platform-result-copy"><b>CSDN</b>${error}${warning}</span>
      <span class="platform-state">${task.progress?escapeHtml(task.progress.message):stateLabel}</span>
      ${action}
    </div>
  </details>`;
}

async function loadTasks(){
  try{
    const result=await chrome.runtime.sendMessage({type:'GET_TASKS'});
    const tasks=((result?.tasks||[]) as SyncTask[]).sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt));
    const list=$('#task-list');
    $('#history-count').textContent=`最近 ${tasks.length} 条记录`;
    $('#history-summary').textContent=tasks.length?`已有 ${tasks.length} 条同步记录`:'暂无同步记录';
    const clearButton=$<HTMLButtonElement>('#history-clear');
    clearButton.disabled=!tasks.length;
    if(!tasks.length){
      list.innerHTML='<div class="empty"><svg viewBox="0 0 48 48"><path d="M8 17h32v22H8zM8 17l5-8h22l5 8M18 25h12v5H18z"/></svg>暂无同步记录</div>';
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
  }catch(error){toast((error as Error).message);}
}

document.querySelectorAll<HTMLElement>('[data-page]').forEach(button=>button.addEventListener('click',()=>show(button.dataset.page!)));
$('#back').addEventListener('click',()=>show('home'));
$('#platform-refresh').addEventListener('click',()=>void checkLogin());
$('#login-state').addEventListener('click',()=>loginStatus==='error'?void checkLogin():loginStatus==='logged-out'?void chrome.runtime.sendMessage({type:'OPEN_CSDN_LOGIN'}):undefined);
$<HTMLButtonElement>('#history-clear').addEventListener('click',async()=>{
  if(!confirm('确定清空全部同步历史吗？此操作不会删除 CSDN 草稿。'))return;
  const result=await chrome.runtime.sendMessage({type:'CLEAR_TASKS'});
  if(!result?.ok){toast(result?.message||'清空失败');return;}
  toast('同步历史已清空');
  await loadTasks();
});
const autoSync=$<HTMLInputElement>('#auto-sync');
autoSync.addEventListener('change',async()=>{
  await chrome.runtime.sendMessage({type:'SAVE_SETTINGS',settings:{autoSyncAfterPublish:autoSync.checked}});
  toast('设置已保存');
});
chrome.runtime.sendMessage({type:'GET_SETTINGS'}).then(result=>autoSync.checked=result?.settings?.autoSyncAfterPublish!==false);
chrome.storage.onChanged.addListener((changes,area)=>{
  if(area==='local'&&changes.syncTasks&&$('#history').classList.contains('active'))void loadTasks();
});
void loadTasks();
void checkLogin();
