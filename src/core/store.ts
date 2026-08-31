import type {ExtensionSettings,SyncTask} from '../types';
const KEY='syncTasks';
const SETTINGS_KEY='settings';
export const defaultSettings:ExtensionSettings={autoSyncAfterPublish:true};
export async function allTasks(){return ((await chrome.storage.local.get(KEY))[KEY]||[]) as SyncTask[];}
export async function saveTasks(tasks:SyncTask[]){await chrome.storage.local.set({[KEY]:tasks.slice(0,200)});}
export async function putTask(task:SyncTask){const tasks=await allTasks();const i=tasks.findIndex(x=>x.id===task.id);if(i>=0)tasks[i]=task;else tasks.unshift(task);await saveTasks(tasks);}
export async function patchTask(id:string,patch:Partial<SyncTask>){const tasks=await allTasks();const task=tasks.find(x=>x.id===id);if(!task)return;Object.assign(task,patch,{updatedAt:new Date().toISOString()});await saveTasks(tasks);return task;}
export async function getSettings(){return {...defaultSettings,...((await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY]||{})} as ExtensionSettings;}
export async function saveSettings(settings:ExtensionSettings){await chrome.storage.local.set({[SETTINGS_KEY]:settings});}
