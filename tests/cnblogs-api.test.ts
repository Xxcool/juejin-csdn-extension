import {afterEach,describe,expect,it,vi} from 'vitest';
import {checkCnblogsAuth,saveCnblogsDraft,validateCnblogsArticle} from '../src/targets/cnblogs-api';
import type {Article} from '../src/types';

const article:Article={id:'juejin-1',title:'博客园草稿测试',markdown:'# 正文\n\n测试内容',tags:['TypeScript'],sourceUrl:'https://juejin.cn/post/1'};
const jsonResponse=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});

afterEach(()=>vi.unstubAllGlobals());

describe('博客园适配器',()=>{
  it('区分未登录与已登录但未开通博客',async()=>{
    const fetchMock=vi.fn()
      .mockResolvedValueOnce(new Response(null,{status:204}))
      .mockResolvedValueOnce(jsonResponse({spaceUserId:100,displayName:'作者',blogApp:''}));
    vi.stubGlobal('fetch',fetchMock);
    await expect(checkCnblogsAuth()).resolves.toMatchObject({ok:true,loggedIn:false,blogEnabled:false});
    await expect(checkCnblogsAuth()).resolves.toMatchObject({ok:true,loggedIn:true,blogEnabled:false,accountId:'100'});
  });

  it('复用新建模型并显式保存为 Markdown 草稿',async()=>{
    const fetchMock=vi.fn()
      .mockResolvedValueOnce(jsonResponse({spaceUserId:100,displayName:'作者',blogApp:'author'}))
      .mockResolvedValueOnce(jsonResponse({blogPost:{id:-1,postType:1,isAllowComments:true},myConfig:{editor:{id:5}}}))
      .mockResolvedValueOnce(jsonResponse({headerName:'X-XSRF-TOKEN',requestToken:'csrf-token'}))
      .mockResolvedValueOnce(jsonResponse({id:88,url:'https://www.cnblogs.com/author/p/88.html'}));
    vi.stubGlobal('fetch',fetchMock);
    const onSaving=vi.fn();
    const result=await saveCnblogsDraft(article,{appendSourceLink:false,onSaving});
    expect(result).toMatchObject({articleId:'88',draftUrl:'https://i.cnblogs.com/posts/edit;postId=88'});
    expect(onSaving).toHaveBeenCalledOnce();
    const [url,init]=fetchMock.mock.calls[3] as [string,RequestInit];
    expect(url).toBe('https://i.cnblogs.com/api/posts');
    expect(init.headers).toMatchObject({'Content-Type':'application/json','X-XSRF-TOKEN':'csrf-token'});
    expect(JSON.parse(String(init.body))).toMatchObject({id:-1,title:article.title,postBody:article.markdown,tags:article.tags,isMarkdown:true,isDraft:true,isPublished:false,usingEditorId:5,isAllowComments:true});
  });

  it('在请求 CSRF 令牌成功后才进入写入状态',async()=>{
    const fetchMock=vi.fn()
      .mockResolvedValueOnce(jsonResponse({spaceUserId:100,blogApp:'author'}))
      .mockResolvedValueOnce(jsonResponse({blogPost:{id:-1},myConfig:{editor:{id:5}}}))
      .mockRejectedValueOnce(new Error('network down'));
    vi.stubGlobal('fetch',fetchMock);
    const onSaving=vi.fn();
    await expect(saveCnblogsDraft(article,{onSaving})).rejects.toThrow('network down');
    expect(onSaving).not.toHaveBeenCalled();
  });

  it('在调用远端前校验标题和正文边界',()=>{
    expect(()=>validateCnblogsArticle({...article,title:' '})).toThrow('标题不能为空');
    expect(()=>validateCnblogsArticle({...article,title:'x'.repeat(201)})).toThrow('不能超过 200');
    expect(()=>validateCnblogsArticle({...article,markdown:' '})).toThrow('正文不能为空');
  });
});
