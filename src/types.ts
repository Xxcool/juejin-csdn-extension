export type PlatformId='csdn';
export type Article={id:string;title:string;markdown:string;summary?:string;cover?:string;tags:string[];sourceUrl:string};
export type TaskStatus='queued'|'checking-login'|'transforming'|'writing'|'saved'|'failed'|'needs-user';
export type SyncTask={id:string;article:Article;platform:PlatformId;status:TaskStatus;createdAt:string;updatedAt:string;draftUrl?:string;error?:string;attempts:number};
export type PlatformState={id:PlatformId;name:string;loggedIn:'unknown'|'yes'|'no'};
export type ExtensionSettings={autoSyncAfterPublish:boolean};
export const uid=()=>crypto.randomUUID();
