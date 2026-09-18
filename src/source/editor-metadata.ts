// 编辑器草稿元信息缓存：按草稿 ID 隔离，空值表示用户主动清除，undefined 表示尚未读取。
type DraftMetadata={tags?:{tag_name?:string}[];cover_image?:string;brief?:string};
export class EditorMetadataCache{
  private drafts=new Map<string,{tags:string[];cover?:string;summary?:string}>();
  remember(id:string,draft:DraftMetadata){
    if(!id)return;
    const value=this.drafts.get(id)||{tags:[]};
    if(Array.isArray(draft.tags))value.tags=draft.tags.map(tag=>tag.tag_name||'').filter(Boolean);
    if(typeof draft.cover_image==='string')value.cover=draft.cover_image;
    if(typeof draft.brief==='string')value.summary=draft.brief;
    this.drafts.set(id,value);
  }
  get(id:string){return this.drafts.get(id)||{tags:[],cover:undefined,summary:undefined};}
}
