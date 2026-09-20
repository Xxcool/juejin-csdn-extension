// 掘金发布响应识别：只接受真实发布接口的业务成功响应，供主世界桥接与测试复用。
export type JuejinPublishSuccess={draftId:string;articleId:string};

const PUBLISH_PATH='/content_api/v1/article/publish';

function parseBody(body:unknown){
  if(typeof body==='string')try{return JSON.parse(body) as Record<string,unknown>;}catch{return undefined;}
  if(body instanceof URLSearchParams)return Object.fromEntries(body);
  return body&&typeof body==='object'&&!('arrayBuffer' in body)?body as Record<string,unknown>:undefined;
}

export function isJuejinPublishRequest(url:string,method='GET'){
  try{
    const parsed=new URL(url,typeof location==='undefined'?'https://juejin.cn':location.origin);
    return method.toUpperCase()==='POST'&&(parsed.hostname==='api.juejin.cn'||parsed.hostname==='juejin.cn')&&parsed.pathname===PUBLISH_PATH;
  }catch{return false;}
}

export function parseJuejinPublishSuccess(url:string,method:string,requestBody:unknown,status:number,responseText:string):JuejinPublishSuccess|undefined{
  if(!isJuejinPublishRequest(url,method)||status<200||status>=300)return undefined;
  try{
    const request=parseBody(requestBody);
    const response=JSON.parse(responseText) as {err_no?:number;data?:{article_id?:string|number;draft_id?:string|number}};
    const draftId=String(response.data?.draft_id||request?.draft_id||'');
    const articleId=String(response.data?.article_id||'');
    return response.err_no===0&&draftId&&draftId!=='0'&&articleId&&articleId!=='0'?{draftId,articleId}:undefined;
  }catch{return undefined;}
}
