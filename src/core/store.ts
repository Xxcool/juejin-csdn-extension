import type {CsdnDraftMapping,ExtensionSettings,SyncTask} from '../types';
import {defaultSettings,normalizeSettings} from './settings';
import {articleIdentityKeys} from './task';
const KEY='syncTasks';
const SETTINGS_KEY='settings';
const MAPPING_PREFIX='csdnDraftMapping:';

/** 持久化前剔除文章正文：任务历史仅保留元信息，防止 storage.local 冲破配额；重试时经掘金双路径回填。 */
export function toStorageTask(task:SyncTask):SyncTask{
  return task.article?.markdown?{...task,article:{...task.article,markdown:''}}:task;
}

/** 升级迁移：清理历史记录中已存在的全量 Markdown 正文。 */
export async function migrateStoredTasks():Promise<boolean>{
  const raw=((await chrome.storage.local.get(KEY))[KEY]||[]) as SyncTask[];
  if(!raw.some(task=>task.article?.markdown))return false;
  await saveTasks(raw);
  return true;
}

/** 同一平台的同一篇文章只展示和保留最近一次同步状态。 */
export function uniqueTasks(tasks:SyncTask[]){
  const identities=new Set<string>();
  return[...tasks]
    .sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt))
    .filter(task=>{
      const identity=`${task.platform}:${task.article.id}`;
      if(identities.has(identity))return false;
      identities.add(identity);
      return true;
    });
}

export async function allTasks(){return uniqueTasks(((await chrome.storage.local.get(KEY))[KEY]||[]) as SyncTask[]);}
export async function saveTasks(tasks:SyncTask[]){await chrome.storage.local.set({[KEY]:tasks.slice(0,200).map(toStorageTask)});}
export async function saveDraftMapping(articleId:string,csdnArticleId:string,draftUrl?:string){
  await chrome.storage.local.set({[MAPPING_PREFIX+articleId]:{articleId,csdnArticleId,draftUrl,updatedAt:new Date().toISOString()}});
}
export async function getDraftMapping(articleId:string){return(await chrome.storage.local.get(MAPPING_PREFIX+articleId))[MAPPING_PREFIX+articleId] as CsdnDraftMapping|undefined;}
export async function saveArticleDraftMapping(article:SyncTask['article'],csdnArticleId:string,draftUrl?:string){
  for(const identity of articleIdentityKeys(article))await saveDraftMapping(identity,csdnArticleId,draftUrl);
}
export async function getArticleDraftMapping(article:SyncTask['article']){
  for(const identity of articleIdentityKeys(article)){
    const mapping=await getDraftMapping(identity);
    if(mapping)return mapping;
  }
  return undefined;
}
export async function preserveTaskMappings(tasks:SyncTask[]){
  for(const task of tasks)if(task.csdnArticleId)await saveArticleDraftMapping(task.article,task.csdnArticleId,task.draftUrl);
}
export async function deleteTask(id:string){
  const tasks=await allTasks();
  const task=tasks.find(item=>item.id===id);
  if(task?.csdnArticleId)await saveArticleDraftMapping(task.article,task.csdnArticleId,task.draftUrl);
  await saveTasks(tasks.filter(item=>item.id!==id));
}
export async function putTask(task:SyncTask){const tasks=await allTasks();const i=tasks.findIndex(x=>x.id===task.id);if(i>=0)tasks[i]=task;else tasks.unshift(task);await saveTasks(tasks);}
export async function patchTask(id:string,patch:Partial<SyncTask>){const tasks=await allTasks();const task=tasks.find(x=>x.id===id);if(!task)return;Object.assign(task,patch,{updatedAt:new Date().toISOString()});await saveTasks(tasks);return task;}
export async function getSettings(){return normalizeSettings({...defaultSettings,...((await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY]||{})});}
export async function saveSettings(settings:ExtensionSettings){await chrome.storage.local.set({[SETTINGS_KEY]:normalizeSettings(settings)});}
