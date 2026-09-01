// CSDN 草稿 API 适配器：清洗 Markdown、转存图片，并直接保存到草稿箱。
import {marked} from 'marked';
import type {Article} from '../types';
import type {AdapterResult} from './adapter';

const API='https://bizapi.csdn.net/blog-console-api/v3/mdeditor/saveArticle';
// CSDN Web 编辑器公开下发的客户端签名参数，不属于用户账号凭据，也无法在浏览器扩展中保密。
const CSDN_WEB_API_KEY='203803574';
const CSDN_WEB_SIGNING_KEY='9znpamsyl2c7cdrr9sas0le9vbc3r6ba';

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
    if(!response.ok)return{ok:true,loggedIn:false};
    const result=await response.json() as {code?:number;data?:{name?:string;nickname?:string}};
    const loggedIn=result.code===200&&!!result.data?.name;
    return{ok:true,loggedIn,account:loggedIn?(result.data?.nickname||result.data?.name):undefined};
  }catch(error){
    return{ok:false,loggedIn:false,message:(error as Error).message||'CSDN 登录状态检测失败'};
  }
}

/** 去掉掘金导出主题元数据，并统一为 CSDN 支持的 Markdown 围栏。 */
function normalizeMarkdown(source:string){
  let markdown=source.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
  const frontmatter=markdown.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
  if(frontmatter&&/^(?:theme|highlight)\s*:/m.test(frontmatter[1]))markdown=markdown.slice(frontmatter[0].length);
  markdown=markdown.replace(/^(?:(?:theme|highlight)\s*:[^\n]*\n){1,2}(?:\n)?/,'');
  markdown=markdown.replace(/^(\s*)~~~([^\n]*)$/gm,'$1```$2');
  return markdown.trim();
}

function imageExtension(src:string,blob:Blob){
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
  if(!imageResponse.ok)throw new Error(`图片下载失败 (${imageResponse.status})：${src}`);
  const imageBlob=await imageResponse.blob();
  if(!imageBlob.type.startsWith('image/'))throw new Error(`图片地址返回了非图片内容：${src}`);
  const extension=imageExtension(src,imageBlob);
  const signaturePath='/resource-api/v1/image/direct/upload/signature';
  const signatureResponse=await fetch(`https://bizapi.csdn.net${signaturePath}`,{method:'POST',credentials:'include',headers:await signedHeaders(signaturePath,'POST'),body:JSON.stringify({imageTemplate:'',appName:'direct_blog_markdown',imageSuffix:extension})});
  if(!signatureResponse.ok)throw new Error(`获取 CSDN 图片上传凭证失败 (${signatureResponse.status})`);
  const signatureResult=await signatureResponse.json() as {code?:number;msg?:string;message?:string;data?:UploadSignature};
  if(signatureResult.code!==200||!signatureResult.data)throw new Error(signatureResult.msg||signatureResult.message||'获取 CSDN 图片上传凭证失败');

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
  if(!uploadResponse.ok)throw new Error(`上传图片到 CSDN 失败 (${uploadResponse.status})`);
  const uploadResult=await uploadResponse.json() as {code?:number;msg?:string;message?:string;data?:{imageUrl?:string}};
  if(uploadResult.code!==200||!uploadResult.data?.imageUrl)throw new Error(uploadResult.msg||uploadResult.message||'上传图片到 CSDN 失败');
  return uploadResult.data.imageUrl;
}

function collectExternalImages(markdown:string){
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
async function prepareArticle(article:Article){
  let markdown=normalizeMarkdown(article.markdown);
  const images=collectExternalImages(markdown);
  if(article.cover&&!images.includes(article.cover))images.push(article.cover);
  const replacements=new Map<string,string>();
  for(const src of images)replacements.set(src,await uploadImageToCsdn(src));
  for(const [src,target] of replacements)markdown=markdown.split(src).join(target);
  const cover=article.cover?replacements.get(article.cover)||article.cover:undefined;
  const html=marked.parse(markdown,{async:false,gfm:true,breaks:false}) as string;
  return{markdown,html,cover};
}

/** 调用 CSDN 保存草稿 API。 */
export async function saveDraftViaApi(article:Article):Promise<AdapterResult>{
  const auth=await checkCsdnAuth();
  if(!auth.loggedIn)throw new Error('请先登录 CSDN');
  const prepared=await prepareArticle(article);
  const body={title:article.title,markdowncontent:prepared.markdown+'\n',content:prepared.html+'\n',readType:'public',level:0,tags:article.tags?.join(',')||'',status:2,categories:'',type:'original',original_link:'',authorized_status:false,not_auto_saved:'1',source:'pc_mdeditor',cover_images:prepared.cover?[prepared.cover]:[],cover_type:1,is_new:1,vote_id:0,resource_id:'',pubStatus:'draft',creation_statement:0,creator_activity_id:''};
  const response=await fetch(API,{method:'POST',credentials:'include',headers:await signedHeaders('/blog-console-api/v3/mdeditor/saveArticle','POST'),body:JSON.stringify(body)});
  if(!response.ok){
    const text=await response.text().catch(()=>'');
    throw new Error('CSDN API 请求失败 ('+response.status+')'+(text?': '+text.slice(0,120):''));
  }
  const result=await response.json() as {code?:number;msg?:string;message?:string;data?:{id?:string;article_id?:string;url?:string}};
  if(result.code!==200&&result.code!==0)throw new Error(result.msg||result.message||'CSDN 返回错误码 '+result.code);
  const articleId=result.data?.id||result.data?.article_id;
  const draftUrl=result.data?.url||(articleId?'https://editor.csdn.net/md/?articleId='+articleId:'');
  if(!draftUrl)throw new Error('CSDN 已保存草稿，但没有返回草稿地址');
  return{draftUrl};
}
