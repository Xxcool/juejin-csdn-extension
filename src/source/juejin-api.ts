// 掘金创作者 API：从已发布文章映射到草稿，并读取原始 Markdown。
import type {Article} from '../types';

const API_BASE='https://api.juejin.cn/content_api/v1';

type ApiResponse<T>={err_no:number;err_msg:string;data:T};
type ArticleListItem={article_info?:{article_id?:string;draft_id?:string;title?:string;cover_image?:string};tags?:{tag_name?:string}[]};
type DraftDetail={article_draft?:{id?:string;title?:string;mark_content?:string;cover_image?:string;tags?:{tag_name?:string}[]}};

async function post<T>(path:string,body:unknown,uuid:string):Promise<T>{
  if(!uuid)throw new Error('无法读取掘金请求标识，请刷新文章列表后重试');
  const query=new URLSearchParams({aid:'2608',uuid,spider:'0'});
  const response=await fetch(`${API_BASE}${path}?${query}`,{
    method:'POST',
    credentials:'include',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(body)
  });
  if(!response.ok)throw new Error(`掘金 API 请求失败 (${response.status})`);
  const result=await response.json() as ApiResponse<T>;
  if(result.err_no!==0)throw new Error(result.err_msg||'掘金返回错误');
  return result.data;
}

/** 根据文章 ID 找到创作者草稿并读取原始 Markdown。 */
export async function fetchJuejinDraftByArticleId(articleId:string,uuid:string,titleFallback=''):Promise<Article>{
  const articles=await post<ArticleListItem[]>('/article/list_by_user',{
    page_no:1,
    page_size:100,
    audit_status:null,
    status:null
  },uuid);
  const entry=articles.find(item=>String(item.article_info?.article_id||'')===articleId);
  const draftId=entry?.article_info?.draft_id;
  if(!draftId)throw new Error('未在掘金创作者文章中找到对应草稿');

  const detail=await post<DraftDetail>('/article_draft/detail',{draft_id:String(draftId)},uuid);
  const draft=detail.article_draft;
  const markdown=draft?.mark_content?.trim()||'';
  if(markdown.length<20)throw new Error('掘金草稿正文为空或过短');

  return{
    id:articleId,
    title:draft?.title?.trim()||entry?.article_info?.title?.trim()||titleFallback,
    markdown,
    tags:(draft?.tags||entry?.tags||[]).map(tag=>tag.tag_name||'').filter(Boolean),
    cover:draft?.cover_image||entry?.article_info?.cover_image||undefined,
    sourceUrl:`https://juejin.cn/post/${articleId}`
  };
}

export function extractArticleId(url:string):string|null{
  return url.match(/\/post\/(\d+)/)?.[1]||null;
}
