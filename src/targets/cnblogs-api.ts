// 博客园适配器：复用浏览器登录态读取编辑模型、转存图片并只保存为草稿。
import type {Article,TaskProgress} from '../types';
import type {AdapterResult} from './adapter';
import {SyncError} from '../core/diagnostic';
import {applyImageTransfers,collectExternalImages,downloadImageBlob,extractSummary,imageExtension,normalizeMarkdown,summarizeImageTransfers} from './csdn-api';

const ADMIN_ORIGIN='https://i.cnblogs.com';
const UPLOAD_URL='https://upload.cnblogs.com/v2/images/cors-upload';

/**
 * 博客园题图字段的接口契约（编辑器实测）：URL 必须以 jpeg/jpg/gif/png/bmp 结尾，
 * 否则 POST /api/posts 返回 400 {"errors":["无效的图片 Url"]}。图床本身接受 WebP，
 * 因此正文图片可保留 WebP，题图必须单独校验。
 */
const FEATURED_IMAGE_SUFFIX=/\.(?:jpeg|jpg|gif|png|bmp)$/i;
function supportsFeaturedImage(url:string){
  try{
    return/^https?:$/.test(new URL(url).protocol)&&FEATURED_IMAGE_SUFFIX.test(url);
  }catch{return false;}
}

type CnblogsUser={blogApp?:string;blogId?:number;displayName?:string;loginName?:string;spaceUserId?:number};
type CnblogsAuth={ok:boolean;loggedIn:boolean;blogEnabled:boolean;account?:string;accountId?:string;blogApp?:string;message?:string};
type SaveOptions={postId?:string;expectedAccountId?:string;appendSourceLink?:boolean;syncCover?:boolean;autoSummary?:boolean;onPreparing?:()=>void|Promise<void>;onProgress?:(progress:TaskProgress)=>void|Promise<void>;onSaving?:()=>void|Promise<void>};

export function validateCnblogsArticle(article:Article){
  const titleLength=article.title.trim().length;
  if(!titleLength)throw new SyncError('博客园随笔标题不能为空','content','validation');
  if(titleLength>200)throw new SyncError('博客园随笔标题不能超过 200 个字符','content','validation');
  if(!article.markdown.trim())throw new SyncError('博客园随笔正文不能为空','content','validation');
  if(article.markdown.length>5_000_000)throw new SyncError('博客园随笔正文不能超过 5000000 个字符','content','validation');
}

async function adminFetch(path:string,init:RequestInit={}){
  return fetch(ADMIN_ORIGIN+path,{...init,credentials:'include',signal:init.signal??AbortSignal.timeout(30000)});
}

export async function checkCnblogsAuth():Promise<CnblogsAuth>{
  try{
    const response=await adminFetch('/api/user',{method:'GET',signal:AbortSignal.timeout(7000)});
    if(response.status===401||response.status===403||response.status===204)return{ok:true,loggedIn:false,blogEnabled:false};
    if(!response.ok)return{ok:false,loggedIn:false,blogEnabled:false,message:`博客园登录状态检测失败 (${response.status})`};
    const user=await response.json() as CnblogsUser;
    const accountId=String(user.spaceUserId||user.blogId||user.loginName||'');
    return{ok:true,loggedIn:true,blogEnabled:Boolean(user.blogApp),account:user.displayName||user.loginName||user.blogApp,accountId,blogApp:user.blogApp,message:user.blogApp?undefined:'博客园账号已登录，但尚未开通博客'};
  }catch(error){return{ok:false,loggedIn:false,blogEnabled:false,message:(error as Error).message||'博客园登录状态检测失败'};}
}

async function xsrfHeaders(){
  const response=await adminFetch('/api/xsrf',{method:'GET'});
  if(response.status===401||response.status===403)throw new SyncError('请先登录博客园','login','authentication');
  if(!response.ok)throw new SyncError(`博客园安全令牌获取失败 (${response.status})`,'platform-change','authentication');
  const token=await response.json() as {headerName?:string;requestToken?:string};
  if(!token.headerName||!token.requestToken)throw new SyncError('博客园安全令牌响应格式已变化','platform-change','authentication');
  return{'Content-Type':'application/json',[token.headerName]:token.requestToken};
}

async function loadPost(postId?:string){
  const response=await adminFetch(`/api/posts/${postId||-1}`,{method:'GET'});
  if(response.status===401||response.status===403)throw new SyncError('请先登录博客园','login','authentication');
  if(response.status===404&&postId)return null;
  if(!response.ok)throw new SyncError(`博客园编辑模型读取失败 (${response.status})`,'platform-change','draft');
  const result=await response.json() as {blogPost?:Record<string,unknown>;myConfig?:{editor?:{id?:unknown}}};
  if(!result.blogPost)throw new SyncError('博客园编辑模型响应格式已变化','platform-change','draft');
  return result;
}

export async function fetchCnblogsPostState(postId:string){
  const auth=await checkCnblogsAuth();
  if(!auth.ok)return'unknown' as const;
  if(!auth.loggedIn)return'unauthorized' as const;
  const result=await loadPost(postId);
  if(!result)return'missing' as const;
  return result.blogPost?.isDraft===true?'draft' as const:'published' as const;
}

async function uploadImage(src:string){
  const blob=await downloadImageBlob(src);
  const form=new FormData();
  form.append('image',blob,`article-ferry.${imageExtension(src,blob)}`);
  form.append('app','blog');
  form.append('uploadType','Paste');
  const response=await fetch(UPLOAD_URL,{method:'POST',credentials:'include',body:form,signal:AbortSignal.timeout(30000)});
  const text=await response.text();
  if(!response.ok)throw new Error(`博客园图片上传失败 (${response.status})`);
  let result:{imageUrl?:string};
  try{result=JSON.parse(text) as {imageUrl?:string};}catch{throw new Error('博客园图片上传响应无法解析');}
  if(!result.imageUrl)throw new Error('博客园图片上传响应缺少地址');
  return result.imageUrl;
}

/** 博客园正文支持 WebP，但随笔题图只接受常见旧格式后缀；按实际像素转成 PNG 再上传。 */
async function uploadFeaturedImage(src:string){
  const blob=await downloadImageBlob(src);
  let uploadBlob=blob;
  let extension=imageExtension(src,blob);
  if(!['image/png','image/jpeg','image/gif','image/bmp'].includes(blob.type)||!['png','jpeg','jpg','gif','bmp'].includes(extension)){
    const bitmap=await createImageBitmap(blob);
    try{
      const canvas=new OffscreenCanvas(bitmap.width,bitmap.height);
      const context=canvas.getContext('2d');
      if(!context)throw new Error('题图转换失败：无法创建绘图上下文');
      context.drawImage(bitmap,0,0);
      uploadBlob=await canvas.convertToBlob({type:'image/png'});
      extension='png';
    }finally{bitmap.close();}
  }
  const form=new FormData();
  form.append('image',uploadBlob,`article-ferry-cover.${extension}`);
  form.append('app','blog');
  form.append('uploadType','Paste');
  const response=await fetch(UPLOAD_URL,{method:'POST',credentials:'include',body:form,signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error(`博客园题图上传失败 (${response.status})`);
  let result:{imageUrl?:string};
  try{result=await response.json() as {imageUrl?:string};}catch{throw new Error('博客园题图上传响应无法解析');}
  const url=result.imageUrl;
  if(!url||!supportsFeaturedImage(url))throw new Error('博客园题图上传后返回了不受支持的图片地址');
  return url;
}

export async function saveCnblogsDraft(article:Article,options:SaveOptions={}):Promise<AdapterResult>{
  validateCnblogsArticle(article);
  const auth=await checkCnblogsAuth();
  if(!auth.ok)throw new SyncError(auth.message||'博客园登录状态检测失败','platform-change','authentication');
  if(!auth.loggedIn)throw new SyncError('请先登录博客园','login','authentication');
  if(!auth.blogEnabled)throw new SyncError('博客园账号尚未开通博客，请先在博客园完成开通','blocked','authentication');
  if(options.expectedAccountId&&auth.accountId!==options.expectedAccountId)throw new SyncError('当前博客园账号与任务创建时不一致，已阻止覆盖草稿','blocked','authentication');
  await options.onPreparing?.();
  let markdown=normalizeMarkdown(article.markdown);
  // 摘要基于注入首发声明之前的正文提取，避免声明文案混入摘要
  const summary=options.autoSummary===false?'':((article.summary&&article.summary.trim())||extractSummary(markdown));
  if(options.appendSourceLink!==false&&article.sourceUrl)markdown+=`\n\n---\n\n本文首发于掘金：[查看原文](${article.sourceUrl})`;

  // 封面处理：严格区分“关闭同步”、“封面未知”、“明确清空”与“有新封面”
  let resolveFeaturedImage=(modelFeatured?:string|null)=>modelFeatured??null;
  let coverToUpload:string|undefined;
  let coverIsExternal=false;

  if(options.syncCover!==false&&article.cover!==undefined){
    const trimmedCover=article.cover.trim();
    if(!trimmedCover){
      // 明确清空封面
      resolveFeaturedImage=()=>null;
    }else{
      coverToUpload=trimmedCover;
      try{coverIsExternal=!/(?:^|\.)cnblogs\.com$/i.test(new URL(trimmedCover).hostname);}catch{coverIsExternal=false;}
    }
  }

  const images=collectExternalImages(markdown).filter(src=>{
    try{return!/(?:^|\.)cnblogs\.com$/i.test(new URL(src).hostname);}catch{return false;}
  });
  // 题图需要上传的情形：外链封面，或博客园域名但后缀不满足题图契约（如 .webp）。
  const coverNeedsUpload=!!coverToUpload&&(coverIsExternal||!supportsFeaturedImage(coverToUpload));
  const total=images.length+(coverNeedsUpload?1:0);
  const transfers:{src:string;target?:string;error?:string}[]=[];
  for(let index=0;index<images.length;index++){
    try{transfers.push({src:images[index],target:await uploadImage(images[index])});}
    catch(error){transfers.push({src:images[index],error:(error as Error).message});break;}
    await options.onProgress?.({current:index+1,total,message:`正在转存图片 ${index+1}/${total}`});
  }
  const failed=transfers.find(item=>item.error);
  if(failed)throw new SyncError(`图片转存失败，已停止保存博客园草稿：${failed.error}`,'content','images');
  const transferred=applyImageTransfers(markdown,undefined,transfers);
  markdown=transferred.markdown;
  const warnings=[...transferred.warnings];

  if(coverToUpload){
    // 封面与正文是同一张图且正文转存结果已满足题图契约时直接复用，避免重复上传。
    const reused=transfers.find(item=>item.src===coverToUpload&&item.target&&supportsFeaturedImage(item.target))?.target;
    if(reused){
      resolveFeaturedImage=()=>reused;
      if(coverNeedsUpload)await options.onProgress?.({current:total,total,message:`正在转存图片 ${total}/${total}`});
    }else if(!coverNeedsUpload){
      resolveFeaturedImage=()=>coverToUpload!;
    }else{
      await options.onProgress?.({current:total,total,message:`正在转存题图 ${total}/${total}`});
      try{
        const finalCover=await uploadFeaturedImage(coverToUpload);
        resolveFeaturedImage=()=>finalCover;
        transfers.push({src:coverToUpload,target:finalCover});
      }catch(error){
        // 题图属于附属信息：失败时保留博客园现有题图并提示，不因此丢弃已转存的正文。
        const message=(error as Error).message;
        transfers.push({src:coverToUpload,error:message});
        warnings.push(`题图转存失败，已跳过题图，请在博客园手动设置：${message}`);
      }
    }
  }

  let model=await loadPost(options.postId);
  if(!model&&options.postId)model=await loadPost();
  if(!model)throw new SyncError('无法读取博客园新建随笔模型','platform-change','draft');
  const blogPost={
    ...model.blogPost,
    title:article.title,
    postBody:markdown,
    tags:article.tags||[],
    isMarkdown:true,
    isDraft:true,
    isPublished:false,
    id:options.postId?Number(options.postId):model.blogPost?.id,
    description:summary,
    featuredImage:resolveFeaturedImage(model.blogPost?.featuredImage as string|null|undefined)
  };
  const body={...blogPost,usingEditorId:model.myConfig?.editor?.id};
  const headers=await xsrfHeaders();
  await options.onSaving?.();
  let response:Response;
  try{response=await adminFetch('/api/posts',{method:'POST',headers,body:JSON.stringify(body)});}
  catch(error){if(error instanceof SyncError)throw error;throw new SyncError('无法确认博客园草稿是否已保存，请先检查草稿箱','interrupted','draft');}
  const text=await response.text();
  if(!response.ok)throw new SyncError(`博客园草稿保存失败 (${response.status})${text?`：${text.slice(0,160)}`:''}`,response.status===401||response.status===403?'login':'platform-change','draft');
  let saved:{id?:number|string;url?:string};
  try{saved=JSON.parse(text) as {id?:number|string;url?:string};}catch{throw new SyncError('博客园已响应保存请求，但结果无法解析，请检查草稿箱','interrupted','draft');}
  const id=String(saved.id||'');
  if(!id)throw new SyncError('博客园保存响应缺少草稿标识，请检查草稿箱','interrupted','draft');
  return{articleId:id,draftUrl:`${ADMIN_ORIGIN}/posts/edit;postId=${id}`,warnings,stats:summarizeImageTransfers(transfers)};
}
