// 同步任务的纯逻辑辅助函数：兼容旧记录并识别需要恢复的中断状态。
import type {SyncTask} from '../types';

export function extractCsdnArticleId(draftUrl?:string){
  if(!draftUrl)return undefined;
  try{return new URL(draftUrl).searchParams.get('articleId')||undefined;}catch{return undefined;}
}

export function isInterruptedTask(task:SyncTask){
  return['queued','checking-login','transforming','writing'].includes(task.status);
}
