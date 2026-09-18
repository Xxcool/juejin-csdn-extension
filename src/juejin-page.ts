// 掘金页面主世界桥接：读取 Markdown，并按草稿身份缓存标签、封面和摘要。
import {EditorMetadataCache} from './source/editor-metadata';
const READ_EDITOR_EVENT='article-ferry:read-editor';
const SNAPSHOT_ATTRIBUTE='data-article-ferry-editor';
const DRAFT_TAG_ENDPOINT=/article_draft\/(?:save|detail)/;

type CodeMirrorElement=HTMLElement&{CodeMirror?:{getValue():string}};
type DraftPayload={data?:{article_draft?:{id?:string;tags?:{tag_name?:string}[];cover_image?:string;brief?:string};tags?:{tag_name?:string}[];cover_image?:string;brief?:string}};

const metadata=new EditorMetadataCache();
const currentDraftId=()=>location.pathname.match(/\/editor\/drafts\/(\d+)/)?.[1]||'';

function rememberTags(url:string,text:string,requestDraftId:string){
  if(!DRAFT_TAG_ENDPOINT.test(url))return;
  try{
    const draft=JSON.parse(text) as DraftPayload;
    const value=draft.data?.article_draft||draft.data;
    if(value)metadata.remember(draft.data?.article_draft?.id||requestDraftId,value);
  }catch{}
}

/** 只读观测编辑器自身的草稿保存/读取响应，拿到与发布面板一致的标签名。 */
function observeDraftApi(){
  if(!('__articleFerryHooked' in window)){
    Object.defineProperty(window,'__articleFerryHooked',{value:true,enumerable:false});
    const originalFetch=window.fetch.bind(window);
    window.fetch=async(input,init)=>{
      const requestDraftId=currentDraftId();
      const response=await originalFetch(input,init);
      try{
        const url=input instanceof Request?input.url:String(input);
        if(DRAFT_TAG_ENDPOINT.test(url))rememberTags(url,await response.clone().text(),requestDraftId);
      }catch{}
      return response;
    };
    const originalOpen=XMLHttpRequest.prototype.open;
    const originalSend=XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open=function(this:XMLHttpRequest&{__ferryUrl?:string},method:string,url:string|URL,...rest:unknown[]){
      this.__ferryUrl=String(url);
      return originalOpen.apply(this,[method,url,...rest] as Parameters<typeof originalOpen>);
    };
    XMLHttpRequest.prototype.send=function(this:XMLHttpRequest&{__ferryUrl?:string},...args:unknown[]){
      const requestDraftId=currentDraftId();
      this.addEventListener('load',()=>{
        try{rememberTags(this.__ferryUrl||'',this.responseText,requestDraftId);}catch{}
      });
      return originalSend.apply(this,args as Parameters<typeof originalSend>);
    };
  }
}

function editorSnapshot(){
  const titleInput=document.querySelector<HTMLInputElement>('input[placeholder*="文章标题"],textarea[placeholder*="文章标题"]');
  const codeMirror=document.querySelector<CodeMirrorElement>('.CodeMirror')?.CodeMirror;
  const textarea=document.querySelector<HTMLTextAreaElement>('.CodeMirror textarea,textarea.bytemd-hidden');
  const markdown=codeMirror?.getValue()||textarea?.value||'';
  const draftId=location.pathname.match(/\/editor\/drafts\/(\d+)/)?.[1]||'';
  return{title:titleInput?.value.trim()||'',markdown,draftId,sourceUrl:location.href,...metadata.get(draftId)};
}

observeDraftApi();
document.addEventListener(READ_EDITOR_EVENT,()=>{
  document.documentElement.setAttribute(SNAPSHOT_ATTRIBUTE,JSON.stringify(editorSnapshot()));
});
