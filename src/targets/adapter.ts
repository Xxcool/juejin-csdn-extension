import type {Article,PlatformId} from '../types';
export type AdapterResult={draftUrl:string;articleId:string;warnings:string[]};
export interface PlatformAdapter{id:PlatformId;name:string;editorUrl:string;transform(article:Article):Article;}
