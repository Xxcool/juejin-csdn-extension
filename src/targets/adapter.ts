import type {Article,PlatformId,TaskStats} from '../types';
export type AdapterResult={draftUrl:string;articleId:string;warnings:string[];stats:Omit<TaskStats,'durationMs'>};
export interface PlatformAdapter{id:PlatformId;name:string;editorUrl:string;transform(article:Article):Article;}
