// 多平台弹窗的状态判定：登录刷新不覆盖用户选择，消息受理不等于草稿保存成功。
import type {PlatformId,TaskStatus} from '../types';

export function refreshPlatformSelection(selected:Set<PlatformId>,auths:{platform:PlatformId;loggedIn:boolean}[],defaults:PlatformId[],initialize:boolean){
  for(const auth of auths){
    if(!auth.loggedIn)selected.delete(auth.platform);
    else if(initialize&&defaults.includes(auth.platform))selected.add(auth.platform);
  }
}

export function syncReplyState(result:{ok?:boolean;message?:string;task?:{status:TaskStatus;error?:string}}|undefined){
  if(!result?.ok)throw new Error(result?.message||'同步请求失败');
  const status=result.task?.status;
  if(status==='saved')return{saved:true,message:'已保存草稿'};
  if(status==='needs-confirmation')return{saved:false,message:'等待确认更新，请打开扩展同步记录确认'};
  if(status&&['queued','checking-login','transforming','writing'].includes(status))return{saved:false,message:'任务正在进行，请在扩展同步记录查看结果'};
  throw new Error(result.task?.error||'尚未保存成功，请查看扩展同步记录');
}
