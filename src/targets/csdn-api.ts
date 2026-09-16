// CSDN 草稿 API 适配器：清洗 Markdown、转存图片，并直接保存到草稿箱。
import {marked} from 'marked';
import type {Article,ImageFailurePolicy,TaskErrorCategory,TaskProgress} from '../types';
import {mapConcurrent,retry} from '../core/async';
import {SyncError} from '../core/diagnostic';
import type {AdapterResult} from './adapter';

const API='https://bizapi.csdn.net/blog-console-api/v3/mdeditor/saveArticle';
// CSDN Web 编辑器公开下发的客户端签名参数，不属于用户账号凭据，也无法在浏览器扩展中保密。
const CSDN_WEB_API_KEY='203803574';
const CSDN_WEB_SIGNING_KEY='9znpamsyl2c7cdrr9sas0le9vbc3r6ba';

/** 按 CSDN Markdown 编辑器的标题规则在发起网络请求前拦截无效内容。 */
export function validateCsdnArticle(article:Article){
  const title=article.title.trim();
  if(title.length<5)throw new SyncError('CSDN 标题至少需要 5 个字符，请修改掘金标题后重新同步','content','validation');
  if(title.length>100)throw new SyncError('CSDN 标题最多允许 100 个字符，请缩短掘金标题后重新同步','content','validation');
  if(article.markdown.trim().length<20)throw new SyncError('文章正文不完整，暂无法同步到 CSDN','content','validation');
}

/** HTTP 状态码到错误类别的映射；未覆盖的状态码交由调用方给定兜底类别。 */
function statusErrorCategory(status:number):TaskErrorCategory|undefined{
  if(status===401)return'login';
  if(status===429)return'rate-limit';
  if(status>=500)return'network';
  return undefined;
}

type UploadSignature={filePath:string;host:string;accessId:string;policy:string;signature:string;callbackUrl:string;callbackBody:string;callbackBodyType:string;customParam:{rtype:string;filePath:string;isAudit:number;'x-image-app':string;type:string;'x-image-suffix':string;username:string}};

function nonce(){return crypto.randomUUID();}

async function hmacSha256(message:string){
  const encoder=new TextEncoder();
  const key=await crypto.subtle.importKey('raw',encoder.encode(CSDN_WEB_SIGNING_KEY),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature=await crypto.subtle.sign('HMAC',key,encoder.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

async function signedHeaders(path:string,method:'GET'|'POST'){
  const requestNonce=nonce();
  const signText=method==='GET'
    ?`GET\n*/*\n\n\n\nx-ca-key:${CSDN_WEB_API_KEY}\nx-ca-nonce:${requestNonce}\n${path}`
    :`POST\n*/*\n\napplication/json\n\nx-ca-key:${CSDN_WEB_API_KEY}\nx-ca-nonce:${requestNonce}\n${path}`;
  const headers:Record<string,string>={accept:'*/*','x-ca-key':CSDN_WEB_API_KEY,'x-ca-nonce':requestNonce,'x-ca-signature':await hmacSha256(signText),'x-ca-signature-headers':'x-ca-key,x-ca-nonce'};
  if(method==='POST')headers['content-type']='application/json';
  return headers;
}

/** 通过 CSDN 编辑器使用的签名接口确认登录状态。 */
export async function checkCsdnAuth(){
  const path='/blog-console-api/v3/editor/getBaseInfo';
  try{
    const response=await fetch(`https://bizapi.csdn.net${path}`,{method:'GET',credentials:'include',headers:await signedHeaders(path,'GET'),signal:AbortSignal.timeout(6000)});
    if(response.status===401)return{ok:true,loggedIn:false};
    if(!response.ok){
      const detail=response.headers.get('x-ca-error-message')||await response.text().catch(()=>'');
      return{ok:false,loggedIn:false,message:`CSDN 接口鉴权异常 (${response.status})${detail?`：${detail.slice(0,120)}`:''}`};
    }
    const result=await response.json() as {code?:number;data?:{name?:string;nickname?:string}};
    const loggedIn=result.code===200&&!!result.data?.name;
    return{ok:true,loggedIn,account:loggedIn?(result.data?.nickname||result.data?.name):undefined};
  }catch(error){
    return{ok:false,loggedIn:false,message:(error as Error).message||'CSDN 登录状态检测失败'};
  }
}

export type CsdnArticleState='draft'|'published'|'unknown';

/**
 * 写入前查询 CSDN 文章当前状态：编辑器加载接口按 pubStatus / status 区分草稿与已发布。
 * 查询失败时返回 unknown（放行更新），避免状态接口波动阻断正常草稿同步。
 */
export async function fetchCsdnArticleState(articleId:string):Promise<CsdnArticleState>{
  const path=`/blog-console-api/v3/editor/getArticle?id=${encodeURIComponent(articleId)}`;
  try{
    const response=await fetch(`https://bizapi.csdn.net${path}`,{method:'GET',credentials:'include',headers:await signedHeaders(path,'GET'),signal:AbortSignal.timeout(8000)});
    if(!response.ok)return'unknown';
    const result=await response.json() as {code?:number;data?:{status?:number;pubStatus?:string}};
    if(result.code!==200||!result.data)return'unknown';
    if(typeof result.data.pubStatus==='string'&&result.data.pubStatus)return result.data.pubStatus==='draft'?'draft':'published';
    if(typeof result.data.status==='number')return result.data.status===2?'draft':'published';
    return'unknown';
  }catch{
    return'unknown';
  }
}

const CONTAINER_KINDS:Record<string,{emoji:string;label:string}>={
  tips:{emoji:'💡',label:'提示'},
  info:{emoji:'ℹ️',label:'说明'},
  note:{emoji:'📝',label:'笔记'},
  warning:{emoji:'⚠️',label:'注意'},
  danger:{emoji:'🚨',label:'警告'},
  success:{emoji:'✅',label:'成功'}
};

/** 掘金 ::: 容器语法转译为通用 Markdown 引用块，避免 CSDN 编辑器出现字面量乱码；代码围栏内的 ::: 保持原样。 */
export function sanitizeJuejinContainers(markdown:string):string{
  const lines=markdown.split('\n');
  const output:string[]=[];
  let inFence=false;
  let fenceMarker='';
  let container:{header:string;body:string[]}|null=null;
  const flushContainer=()=>{
    if(!container)return;
    output.push(container.header);
    output.push(...(container.body.length?container.body:['>']));
    container=null;
  };
  for(const line of lines){
    if(container){
      if(/^ {0,3}:::[ \t]*$/.test(line)){flushContainer();continue;}
      container.body.push(line.trim()?`> ${line}`:'>');
      continue;
    }
    const fence=line.match(/^ {0,3}(`{3,}|~{3,})/);
    if(fence){
      if(!inFence){inFence=true;fenceMarker=fence[1][0];}
      else if(fence[1][0]===fenceMarker){inFence=false;fenceMarker='';}
      output.push(line);
      continue;
    }
    if(!inFence){
      const open=line.match(/^ {0,3}:::[ \t]*([A-Za-z\u4e00-\u9fa5][\w\u4e00-\u9fa5-]*)?[ \t]*(.*)$/);
      if(open&&open[1]){
        const meta=CONTAINER_KINDS[open[1].toLowerCase()]||{emoji:'ℹ️',label:open[1]};
        container={header:`> ${meta.emoji} ${meta.label}：${open[2].trim()}`,body:[]};
        continue;
      }
    }
    output.push(line);
  }
  flushContainer();
  return output.join('\n');
}

/** 去掉掘金导出主题元数据，统一为 CSDN 支持的 Markdown 围栏，并转译掘金特有容器语法。 */
export function normalizeMarkdown(source:string){
  let markdown=source.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
  const frontmatter=markdown.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
  if(frontmatter&&/^(?:theme|highlight)\s*:/m.test(frontmatter[1]))markdown=markdown.slice(frontmatter[0].length);
  markdown=markdown.replace(/^(?:(?:theme|highlight)\s*:[^\n]*\n){1,2}(?:\n)?/,'');
  markdown=markdown.replace(/^(\s*)~~~([^\n]*)$/gm,'$1```$2');
  markdown=sanitizeJuejinContainers(markdown);
  return markdown.trim();
}

export function imageExtension(src:string,blob:Blob){
  const pathExtension=src.match(/\.([a-zA-Z0-9]+)(?:[?#]|$)/)?.[1]?.toLowerCase();
  if(pathExtension&&['jpg','jpeg','png','gif','webp'].includes(pathExtension))return pathExtension;
  const mimeExtension:Record<string,string>={'image/jpeg':'jpg','image/png':'png','image/gif':'gif','image/webp':'webp'};
  return mimeExtension[blob.type.toLowerCase()]||'jpg';
}

async function uploadImageToCsdn(src:string){
  // 掘金私有 CDN 的签名链接仍需当前登录会话；其他外链图片不携带站点凭据。
  const hostname=new URL(src).hostname;
  const credentials:RequestCredentials=hostname.endsWith('-private.juejin.cn')?'include':'omit';
  const imageResponse=await fetch(src,{credentials});
  if(!imageResponse.ok)throw new SyncError(`图片下载失败 (${imageResponse.status})：${src}`,statusErrorCategory(imageResponse.status)??'content','images');
  const imageBlob=await imageResponse.blob();
  if(!imageBlob.type.startsWith('image/'))throw new SyncError(`图片地址返回了非图片内容：${src}`,'content','images');
  const extension=imageExtension(src,imageBlob);
  const signaturePath='/resource-api/v1/image/direct/upload/signature';
  const signatureResponse=await fetch(`https://bizapi.csdn.net${signaturePath}`,{method:'POST',credentials:'include',headers:await signedHeaders(signaturePath,'POST'),body:JSON.stringify({imageTemplate:'',appName:'direct_blog_markdown',imageSuffix:extension})});
  if(!signatureResponse.ok)throw new SyncError(`获取 CSDN 图片上传凭证失败 (${signatureResponse.status})`,statusErrorCategory(signatureResponse.status)??'platform-change','images');
  const signatureResult=await signatureResponse.json() as {code?:number;msg?:string;message?:string;data?:UploadSignature};
  if(signatureResult.code!==200||!signatureResult.data)throw new SyncError(signatureResult.msg||signatureResult.message||'获取 CSDN 图片上传凭证失败','platform-change','images');

  const upload=signatureResult.data;
  const custom=upload.customParam;
  const form=new FormData();
  form.append('key',upload.filePath);
  form.append('policy',upload.policy);
  form.append('signature',upload.signature);
  form.append('callbackBody',upload.callbackBody);
  form.append('callbackBodyType',upload.callbackBodyType);
  form.append('callbackUrl',upload.callbackUrl);
  form.append('AccessKeyId',upload.accessId);
  form.append('x:rtype',custom.rtype);
  form.append('x:filePath',custom.filePath);
  form.append('x:isAudit',String(custom.isAudit));
  form.append('x:x-image-app',custom['x-image-app']);
  form.append('x:type',custom.type);
  form.append('x:x-image-suffix',custom['x-image-suffix']);
  form.append('x:username',custom.username);
  form.append('file',imageBlob,`image.${extension}`);
  const uploadResponse=await fetch(upload.host,{method:'POST',body:form});
  if(!uploadResponse.ok)throw new SyncError(`上传图片到 CSDN 失败 (${uploadResponse.status})`,statusErrorCategory(uploadResponse.status)??'network','images');
  const uploadResult=await uploadResponse.json() as {code?:number;msg?:string;message?:string;data?:{imageUrl?:string}};
  if(uploadResult.code!==200||!uploadResult.data?.imageUrl)throw new SyncError(uploadResult.msg||uploadResult.message||'上传图片到 CSDN 失败','platform-change','images');
  return uploadResult.data.imageUrl;
}

export function collectExternalImages(markdown:string){
  const urls=new Set<string>();
  const markdownImage=/!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))/g;
  const htmlImage=/<img\b[^>]*\bsrc=["']([^"']+)["']/gi;
  for(const match of markdown.matchAll(markdownImage))urls.add(match[1]||match[2]);
  for(const match of markdown.matchAll(htmlImage))urls.add(match[1]);
  return[...urls].filter(src=>{
    try{
      const url=new URL(src);
      return /^https?:$/.test(url.protocol)&&!/(?:^|\.)csdn\.net$|(?:^|\.)csdnimg\.cn$/i.test(url.hostname);
    }catch{return false;}
  });
}

/** CSDN 无法稳定读取掘金 CDN，保存前将正文和封面图片转存到 CSDN。 */
type SaveDraftOptions={articleId?:string;categories?:string[];syncCover?:boolean;imageFailurePolicy?:ImageFailurePolicy;onPreparing?:()=>void|Promise<void>;onProgress?:(progress:TaskProgress)=>void|Promise<void>;onSaving?:()=>void|Promise<void>};
type ImageTransfer={src:string;target?:string;error?:string;errorCategory?:TaskErrorCategory};

export function summarizeImageTransfers(transfers:ImageTransfer[]){
  return{imageTotal:transfers.length,imageSucceeded:transfers.filter(item=>item.target).length,imageFailed:transfers.filter(item=>item.error).length};
}

export function enforceImageFailurePolicy(transfers:ImageTransfer[],policy:ImageFailurePolicy='continue'){
  const failed=transfers.filter(item=>item.error);
  if(policy==='abort'&&failed.length)throw new SyncError(`有 ${failed.length} 张图片转存失败，已按设置终止同步：${failed[0].error}`,failed[0].errorCategory??'content','images');
}

export function applyImageTransfers(markdown:string,cover:string|undefined,transfers:ImageTransfer[]){
  const replacements=new Map(transfers.filter(item=>item.target).map(item=>[item.src,item.target!]));
  for(const [src,target] of replacements)markdown=markdown.split(src).join(target);
  const warnings=transfers.filter(item=>item.error).map(item=>{
    const location=cover===item.src&&!markdown.includes(item.src)?'封面':'正文图片';
    const action=location==='封面'?'已忽略':'已保留原链接';
    return`${location}转存失败，${action}：${item.src}（${item.error}）`;
  });
  return{markdown,cover:cover?replacements.get(cover):undefined,warnings};
}

async function prepareArticle(article:Article,options:SaveDraftOptions){
  let markdown=normalizeMarkdown(article.markdown);
  const images=collectExternalImages(markdown);
  const cover=options.syncCover===false?undefined:article.cover;
  if(cover&&!images.includes(cover))images.push(cover);
  let completed=0;
  if(images.length)await options.onProgress?.({current:0,total:images.length,message:`准备转存 ${images.length} 张图片`});
  const transfers=await mapConcurrent(images,3,async src=>{
    let result:ImageTransfer;
    try{result={src,target:await retry(()=>uploadImageToCsdn(src))};}
    catch(error){
      result={src,error:(error as Error).message,errorCategory:error instanceof SyncError?error.category:undefined};
    }
    finally{
      completed++;
      await options.onProgress?.({current:completed,total:images.length,message:`正在转存图片 ${completed}/${images.length}`});
    }
    return result;
  });
  enforceImageFailurePolicy(transfers,options.imageFailurePolicy);
  const transferred=applyImageTransfers(markdown,cover,transfers);
  const html=marked.parse(transferred.markdown,{async:false,gfm:true,breaks:false}) as string;
  return{...transferred,html,stats:summarizeImageTransfers(transfers)};
}

export function buildSaveArticleBody(article:Article,prepared:{markdown:string;html:string;cover?:string},articleId?:string,categories:string[]=[]){
  return{title:article.title,markdowncontent:prepared.markdown+'\n',content:prepared.html+'\n',readType:'public',level:0,tags:article.tags?.join(',')||'',status:2,categories:[...new Set(categories.map(item=>item.trim()).filter(Boolean))].join(','),type:'original',original_link:'',authorized_status:false,not_auto_saved:'1',source:'pc_mdeditor',cover_images:prepared.cover?[prepared.cover]:[],cover_type:prepared.cover?1:0,is_new:articleId?0:1,...(articleId?{id:articleId}:{}),vote_id:0,resource_id:'',pubStatus:'draft',creation_statement:0,creator_activity_id:''};
}

/** 调用 CSDN 保存草稿 API。 */
export async function saveDraftViaApi(article:Article,options:SaveDraftOptions={}):Promise<AdapterResult>{
  validateCsdnArticle(article);
  const auth=await checkCsdnAuth();
  if(!auth.ok)throw new SyncError(auth.message||'CSDN 登录状态检测失败','platform-change','authentication');
  if(!auth.loggedIn)throw new SyncError('请先登录 CSDN','login','authentication');
  await options.onPreparing?.();
  const prepared=await prepareArticle(article,options);
  const body=buildSaveArticleBody(article,prepared,options.articleId,options.categories);
  await options.onSaving?.();
  const response=await fetch(API,{method:'POST',credentials:'include',headers:await signedHeaders('/blog-console-api/v3/mdeditor/saveArticle','POST'),body:JSON.stringify(body)});
  if(!response.ok){
    const text=await response.text().catch(()=>'');
    throw new SyncError('CSDN API 请求失败 ('+response.status+')'+(text?': '+text.slice(0,120):''),statusErrorCategory(response.status)??'platform-change','draft');
  }
  const result=await response.json() as {code?:number;msg?:string;message?:string;data?:{id?:string;article_id?:string;url?:string}};
  if(result.code!==200&&result.code!==0)throw new SyncError(result.msg||result.message||'CSDN 返回错误码 '+result.code,'platform-change','draft');
  const articleId=result.data?.id||result.data?.article_id;
  const draftUrl=result.data?.url||(articleId?'https://editor.csdn.net/md/?articleId='+articleId:'');
  if(!draftUrl||!articleId)throw new SyncError('CSDN 已保存草稿，但没有返回草稿标识','platform-change','draft');
  return{draftUrl,articleId:String(articleId),warnings:prepared.warnings,stats:prepared.stats};
}
