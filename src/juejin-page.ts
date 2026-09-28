// 掘金页面主世界桥接：读取 Markdown，并按草稿身份缓存标签、封面和摘要。
import {EditorMetadataCache} from './source/editor-metadata';
import {isJuejinPublishRequest,parseJuejinPublishSuccess} from './source/juejin-publish';
const READ_EDITOR_EVENT='article-ferry:read-editor';
const SNAPSHOT_ATTRIBUTE='data-article-ferry-editor';
const PUBLISH_EVENT='article-ferry:published';
const PUBLISH_START_EVENT='article-ferry:publish-start';
const PUBLISH_ATTRIBUTE='data-article-ferry-published';
const DRAFT_TAG_ENDPOINT=/article_draft\/(?:save|detail)/;

type CodeMirrorElement=HTMLElement&{CodeMirror?:{getValue():string}};
type DraftPayload={data?:{article_draft?:{id?:string;tags?:{tag_name?:string}[];cover_image?:string;brief_content?:string};tags?:{tag_name?:string}[];cover_image?:string;brief_content?:string}};

const metadata=new EditorMetadataCache();
let publishSequence=0;
const currentDraftId=()=>location.pathname.match(/\/editor\/drafts\/(\d+)/)?.[1]||'';

function rememberTags(url:string,text:string,requestDraftId:string){
  if(!DRAFT_TAG_ENDPOINT.test(url))return;
  try{
    const draft=JSON.parse(text) as DraftPayload;
    const value=draft.data?.article_draft||draft.data;
    if(value)metadata.remember(draft.data?.article_draft?.id||requestDraftId,value);
  }catch{}
}

/** 请求发出前同步通知隔离世界，冻结本次选择和编辑器内容。 */
function beginPublish(url:string,method:string){
  if(!isJuejinPublishRequest(url,method))return undefined;
  const requestId=String(++publishSequence);
  console.log('[文章摆渡] 侦测到掘金发布请求:',url,{requestId});
  document.documentElement.setAttribute(PUBLISH_ATTRIBUTE,JSON.stringify({requestId}));
  document.dispatchEvent(new Event(PUBLISH_START_EVENT));
  document.documentElement.removeAttribute(PUBLISH_ATTRIBUTE);
  return requestId;
}

function finishPublish(requestId:string|undefined,success?:ReturnType<typeof parseJuejinPublishSuccess>){
  if(!requestId)return;
  console.log('[文章摆渡] 掘金发布请求结束:',{requestId,success});
  document.documentElement.setAttribute(PUBLISH_ATTRIBUTE,JSON.stringify({requestId,...success}));
  document.dispatchEvent(new Event(PUBLISH_EVENT));
  document.documentElement.removeAttribute(PUBLISH_ATTRIBUTE);
}

/** 只读观测编辑器自身的草稿保存/读取响应，拿到与发布面板一致的标签名。 */
function observeDraftApi(){
  if(!('__articleFerryHooked' in window)){
    Object.defineProperty(window,'__articleFerryHooked',{value:true,enumerable:false});
    const originalFetch=window.fetch.bind(window);
    window.fetch=async(input,init)=>{
      const requestDraftId=currentDraftId();
      const url=input instanceof Request?input.url:String(input);
      const method=init?.method||(input instanceof Request?input.method:'GET');
      let requestBody:unknown=init?.body;
      if(requestBody===undefined&&input instanceof Request)try{requestBody=input.clone().text().catch(()=>undefined);}catch{}
      const requestId=beginPublish(url,method);
      let success:ReturnType<typeof parseJuejinPublishSuccess>;
      try{
        const response=await originalFetch(input,init);
        try{
          if(DRAFT_TAG_ENDPOINT.test(url))rememberTags(url,await response.clone().text(),requestDraftId);
          if(requestId){
            const body=await requestBody;
            const text=await response.clone().text();
            success=parseJuejinPublishSuccess(url,method,body,response.status,text,requestDraftId);
          }
        }catch(err){console.warn('[文章摆渡] 解析发布响应异常 (fetch):',err);}
        return response;
      }finally{
        // HTTP、业务及网络失败均释放本次快照，不触发同步。
        finishPublish(requestId,success);
      }
    };
    const originalOpen=XMLHttpRequest.prototype.open;
    const originalSend=XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open=function(this:XMLHttpRequest&{__ferryUrl?:string;__ferryMethod?:string},method:string,url:string|URL,...rest:unknown[]){
      this.__ferryUrl=String(url);
      this.__ferryMethod=method;
      return originalOpen.apply(this,[method,url,...rest] as Parameters<typeof originalOpen>);
    };
    XMLHttpRequest.prototype.send=function(this:XMLHttpRequest&{__ferryUrl?:string;__ferryMethod?:string},...args:unknown[]){
      const requestDraftId=currentDraftId();
      const body=args[0];
      const url=this.__ferryUrl||'';
      const method=this.__ferryMethod||'GET';
      const requestId=beginPublish(url,method);
      const onEnd=()=>{
        let success:ReturnType<typeof parseJuejinPublishSuccess>;
        try{
          const text=typeof this.response==='string'?this.response:JSON.stringify(this.response);
          rememberTags(url,text,requestDraftId);
          success=parseJuejinPublishSuccess(url,method,body,this.status,text,requestDraftId);
        }catch(err){console.warn('[文章摆渡] 解析发布响应异常 (XHR):',err);}
        finishPublish(requestId,success);
      };
      this.addEventListener('loadend',onEnd,{once:true});
      try{
        return originalSend.apply(this,args as Parameters<typeof originalSend>);
      }catch(error){
        this.removeEventListener('loadend',onEnd);
        finishPublish(requestId);
        throw error;
      }
    };
  }
}

function editorSnapshot(){
  const titleInput=document.querySelector<HTMLInputElement>('input[placeholder*="文章标题"],textarea[placeholder*="文章标题"]');
  const codeMirror=document.querySelector<CodeMirrorElement>('.CodeMirror')?.CodeMirror;
  const textarea=document.querySelector<HTMLTextAreaElement>('.CodeMirror textarea,textarea.bytemd-hidden');
  const markdown=codeMirror?.getValue()||textarea?.value||'';
  const urlDraftId=location.pathname.match(/\/editor\/drafts\/(\d+)/)?.[1]||'';
  const draftId=urlDraftId||metadata.getLatestId();
  const cached=metadata.get(draftId);
  const summary=document.querySelector<HTMLTextAreaElement>('.panel .summary textarea')?.value?.trim();
  const cover=document.querySelector<HTMLImageElement>('.panel .preview-image')?.src;
  const coverControl=[...document.querySelectorAll<HTMLElement>('.panel .form-item')].find(item=>/封面/.test(item.querySelector('.label')?.textContent||''));
  return{
    title:titleInput?.value.trim()||'',
    markdown,
    draftId,
    sourceUrl:location.href,
    ...cached,
    // 确认封面控件已渲染但没有预览时才认定用户清空；控件缺失仍回退草稿缓存。
    cover:cover??(coverControl?'':cached.cover),
    summary:summary??cached.summary
  };
}

observeDraftApi();
document.addEventListener(READ_EDITOR_EVENT,()=>{
  document.documentElement.setAttribute(SNAPSHOT_ATTRIBUTE,JSON.stringify(editorSnapshot()));
});
