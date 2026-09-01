// 同步任务的纯逻辑辅助函数：兼容旧记录并识别需要恢复的中断状态。
import type {SyncTask} from '../types';

export function articleIdentityKeys(article:SyncTask['article']){
  return[...new Set([article.id,article.sourceDraftId].filter((value):value is string=>!!value))];
}

export function findMatchingTask(tasks:SyncTask[],article:SyncTask['article']){
  const identities=new Set(articleIdentityKeys(article));
  return tasks.find(task=>articleIdentityKeys(task.article).some(identity=>identities.has(identity))&&task.platform==='csdn');
}

export function extractCsdnArticleId(draftUrl?:string){
  if(!draftUrl)return undefined;
  try{return new URL(draftUrl).searchParams.get('articleId')||undefined;}catch{return undefined;}
}

export function isInterruptedTask(task:SyncTask){
  return['queued','checking-login','transforming'].includes(task.status)||(task.status==='writing'&&!!task.csdnArticleId);
}

/** 新建草稿写入中断后无法判断服务端是否成功，自动重试可能产生重复草稿。 */
export function isUncertainCreateTask(task:SyncTask){
  return task.status==='writing'&&!task.csdnArticleId;
}

export function isActiveTask(task:SyncTask){return['queued','checking-login','transforming','writing'].includes(task.status);}
export function isRetryableTask(task:SyncTask){return['failed','needs-user'].includes(task.status);}
export function canDeleteTask(task:SyncTask){return!isActiveTask(task);}
