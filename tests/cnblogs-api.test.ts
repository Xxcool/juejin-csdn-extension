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

  it('同步外部封面图并设置 description 与 featuredImage',async()=>{
    const articleWithMeta:Article={
      ...article,
      cover:'https://p1-juejin.byteimg.com/tos-cn-i-k3u1fbpfcp/cover.png',
      summary:'这是掘金的精炼摘要'
    };
    const fetchMock=vi.fn()
      .mockResolvedValueOnce(jsonResponse({spaceUserId:100,displayName:'作者',blogApp:'author'}))
      // 下载外部封面
      .mockResolvedValueOnce(new Response(new Uint8Array([137,80,78,71,13,10,26,10]),{status:200,headers:{'content-type':'image/png'}}))
      // 上传到博客园图床
      .mockResolvedValueOnce(jsonResponse({imageUrl:'https://img2024.cnblogs.com/blog/100/202410/cover.png'}))
      // loadPost
      .mockResolvedValueOnce(jsonResponse({blogPost:{id:-1,postType:1},myConfig:{editor:{id:5}}}))
      // xsrf
      .mockResolvedValueOnce(jsonResponse({headerName:'X-XSRF-TOKEN',requestToken:'csrf-token'}))
      // savePost
      .mockResolvedValueOnce(jsonResponse({id:99,url:'https://www.cnblogs.com/author/p/99.html'}));
    vi.stubGlobal('fetch',fetchMock);

    const result=await saveCnblogsDraft(articleWithMeta,{appendSourceLink:false});
    expect(result.articleId).toBe('99');
    // 检查提交给博客园的 post body
    const saveCall=fetchMock.mock.calls.find(call=>call[0]==='https://i.cnblogs.com/api/posts');
    expect(saveCall).toBeDefined();
    const payload=JSON.parse(String(saveCall![1].body));
    expect(payload.description).toBe('这是掘金的精炼摘要');
    expect(payload.featuredImage).toBe('https://img2024.cnblogs.com/blog/100/202410/cover.png');
  });

  it('将 WebP 源封面转成 PNG 后上传，正文图片仍使用原格式',async()=>{
    const close=vi.fn();
    const drawImage=vi.fn();
    vi.stubGlobal('createImageBitmap',vi.fn(async()=>({width:2,height:2,close})));
    vi.stubGlobal('OffscreenCanvas',class{
      getContext(){return{drawImage};}
      async convertToBlob(){return new Blob([new Uint8Array([137,80,78,71])],{type:'image/png'});}
    });
    const source='https://p1-juejin.byteimg.com/cover.webp';
    const webpResponse=()=>new Response(new Uint8Array([82,73,70,70]),{status:200,headers:{'content-type':'image/webp'}});
    const fetchMock=vi.fn()
      .mockResolvedValueOnce(jsonResponse({spaceUserId:100,blogApp:'author'}))
      .mockResolvedValueOnce(webpResponse())
      .mockResolvedValueOnce(jsonResponse({imageUrl:'https://img2024.cnblogs.com/blog/100/body.webp'}))
      .mockResolvedValueOnce(webpResponse())
      .mockResolvedValueOnce(jsonResponse({imageUrl:'https://img2024.cnblogs.com/blog/100/cover.png'}))
      .mockResolvedValueOnce(jsonResponse({blogPost:{id:-1},myConfig:{editor:{id:5}}}))
      .mockResolvedValueOnce(jsonResponse({headerName:'X-XSRF-TOKEN',requestToken:'csrf-token'}))
      .mockResolvedValueOnce(jsonResponse({id:103}));
    vi.stubGlobal('fetch',fetchMock);

    await saveCnblogsDraft({...article,markdown:`正文\n\n![图片](${source})`,cover:source},{appendSourceLink:false});
    const uploadCalls=fetchMock.mock.calls.filter(call=>call[0]==='https://upload.cnblogs.com/v2/images/cors-upload');
    expect((uploadCalls[0][1].body as FormData).get('image')).toMatchObject({name:'article-ferry.webp',type:'image/webp'});
    expect((uploadCalls[1][1].body as FormData).get('image')).toMatchObject({name:'article-ferry-cover.png',type:'image/png'});
    const saveCall=fetchMock.mock.calls.find(call=>call[0]==='https://i.cnblogs.com/api/posts');
    const payload=JSON.parse(String(saveCall![1].body));
    expect(payload.postBody).toContain('https://img2024.cnblogs.com/blog/100/body.webp');
    expect(payload.featuredImage).toBe('https://img2024.cnblogs.com/blog/100/cover.png');
    expect(drawImage).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('题图上传仍返回 WebP 时跳过题图并警告，正文照常保存',async()=>{
    vi.stubGlobal('createImageBitmap',vi.fn(async()=>({width:2,height:2,close:vi.fn()})));
    vi.stubGlobal('OffscreenCanvas',class{
      getContext(){return{drawImage:vi.fn()};}
      async convertToBlob(){return new Blob(['png'],{type:'image/png'});}
    });
    const fetchMock=vi.fn()
      .mockResolvedValueOnce(jsonResponse({spaceUserId:100,blogApp:'author'}))
      .mockResolvedValueOnce(new Response('webp',{status:200,headers:{'content-type':'image/webp'}}))
      .mockResolvedValueOnce(jsonResponse({imageUrl:'https://img2024.cnblogs.com/blog/100/cover.webp'}))
      .mockResolvedValueOnce(jsonResponse({blogPost:{id:-1},myConfig:{editor:{id:5}}}))
      .mockResolvedValueOnce(jsonResponse({headerName:'X-XSRF-TOKEN',requestToken:'csrf-token'}))
      .mockResolvedValueOnce(jsonResponse({id:104}));
    vi.stubGlobal('fetch',fetchMock);

    const result=await saveCnblogsDraft({...article,cover:'https://p1-juejin.byteimg.com/cover.webp'},{appendSourceLink:false});
    expect(result.warnings.join('\n')).toContain('题图转存失败，已跳过题图');
    expect(result.stats).toMatchObject({imageTotal:1,imageSucceeded:0,imageFailed:1});
    const saveCall=fetchMock.mock.calls.find(call=>call[0]==='https://i.cnblogs.com/api/posts');
    expect(JSON.parse(String(saveCall![1].body)).featuredImage).toBeNull();
  });

  it('封面与正文同图且正文转存结果可作题图时复用，不重复上传，进度计入题图',async()=>{
    const source='https://p1-juejin.byteimg.com/same.png';
    const fetchMock=vi.fn()
      .mockResolvedValueOnce(jsonResponse({spaceUserId:100,blogApp:'author'}))
      .mockResolvedValueOnce(new Response(new Uint8Array([137,80,78,71]),{status:200,headers:{'content-type':'image/png'}}))
      .mockResolvedValueOnce(jsonResponse({imageUrl:'https://img2024.cnblogs.com/blog/100/same.png'}))
      .mockResolvedValueOnce(jsonResponse({blogPost:{id:-1},myConfig:{editor:{id:5}}}))
      .mockResolvedValueOnce(jsonResponse({headerName:'X-XSRF-TOKEN',requestToken:'csrf-token'}))
      .mockResolvedValueOnce(jsonResponse({id:105}));
    vi.stubGlobal('fetch',fetchMock);
    const onProgress=vi.fn();

    const result=await saveCnblogsDraft({...article,markdown:`正文\n\n![图](${source})`,cover:source},{appendSourceLink:false,onProgress});
    expect(fetchMock.mock.calls.filter(call=>call[0]==='https://upload.cnblogs.com/v2/images/cors-upload')).toHaveLength(1);
    expect(result.stats).toMatchObject({imageTotal:1,imageSucceeded:1,imageFailed:0});
    expect(onProgress.mock.calls.map(call=>call[0].total)).toEqual([2,2]);
    const saveCall=fetchMock.mock.calls.find(call=>call[0]==='https://i.cnblogs.com/api/posts');
    expect(JSON.parse(String(saveCall![1].body)).featuredImage).toBe('https://img2024.cnblogs.com/blog/100/same.png');
  });

  it('博客园合格题图地址不上传也不计入转存统计',async()=>{
    const fetchMock=vi.fn()
      .mockResolvedValueOnce(jsonResponse({spaceUserId:100,blogApp:'author'}))
      .mockResolvedValueOnce(jsonResponse({blogPost:{id:-1},myConfig:{editor:{id:5}}}))
      .mockResolvedValueOnce(jsonResponse({headerName:'X-XSRF-TOKEN',requestToken:'csrf-token'}))
      .mockResolvedValueOnce(jsonResponse({id:106}));
    vi.stubGlobal('fetch',fetchMock);

    const result=await saveCnblogsDraft({...article,cover:'https://img2024.cnblogs.com/blog/100/ok.png'},{appendSourceLink:false});
    expect(result.stats).toMatchObject({imageTotal:0,imageSucceeded:0,imageFailed:0});
  });

  it('支持关闭 syncCover 与 autoSummary',async()=>{
    const articleWithMeta:Article={
      ...article,
      cover:'https://p1-juejin.byteimg.com/tos-cn-i-k3u1fbpfcp/cover.png',
      summary:'这是掘金的精炼摘要'
    };
    const fetchMock=vi.fn()
      .mockResolvedValueOnce(jsonResponse({spaceUserId:100,displayName:'作者',blogApp:'author'}))
      .mockResolvedValueOnce(jsonResponse({blogPost:{id:-1,postType:1},myConfig:{editor:{id:5}}}))
      .mockResolvedValueOnce(jsonResponse({headerName:'X-XSRF-TOKEN',requestToken:'csrf-token'}))
      .mockResolvedValueOnce(jsonResponse({id:100,url:'https://www.cnblogs.com/author/p/100.html'}));
    vi.stubGlobal('fetch',fetchMock);

    await saveCnblogsDraft(articleWithMeta,{appendSourceLink:false,syncCover:false,autoSummary:false});
    const saveCall=fetchMock.mock.calls.find(call=>call[0]==='https://i.cnblogs.com/api/posts');
    const payload=JSON.parse(String(saveCall![1].body));
    expect(payload.description).toBe('');
    expect(payload.featuredImage).toBeNull();
  });

  it('博客园域名封面直接绑定为 featuredImage，不重复上传',async()=>{
    const articleWithMeta:Article={
      ...article,
      cover:'https://img2024.cnblogs.com/blog/100/202410/existing.png'
    };
    const fetchMock=vi.fn()
      .mockResolvedValueOnce(jsonResponse({spaceUserId:100,displayName:'作者',blogApp:'author'}))
      .mockResolvedValueOnce(jsonResponse({blogPost:{id:-1,postType:1},myConfig:{editor:{id:5}}}))
      .mockResolvedValueOnce(jsonResponse({headerName:'X-XSRF-TOKEN',requestToken:'csrf-token'}))
      .mockResolvedValueOnce(jsonResponse({id:101,url:'https://www.cnblogs.com/author/p/101.html'}));
    vi.stubGlobal('fetch',fetchMock);

    await saveCnblogsDraft(articleWithMeta,{appendSourceLink:false});
    const saveCall=fetchMock.mock.calls.find(call=>call[0]==='https://i.cnblogs.com/api/posts');
    const payload=JSON.parse(String(saveCall![1].body));
    expect(payload.featuredImage).toBe('https://img2024.cnblogs.com/blog/100/202410/existing.png');
    // 没有额外的图片上传请求
    expect(fetchMock.mock.calls.some(call=>call[0]==='https://upload.cnblogs.com/v2/images/cors-upload')).toBe(false);
  });

  it('明确清空封面时置空题图，未提供封面或关闭同步时保留已有题图',async()=>{
    // 1. 明确清空封面：cover='' 时应清空原有 featuredImage
    const clearedArticle:Article={...article,cover:''};
    const fetchMock1=vi.fn()
      .mockResolvedValueOnce(jsonResponse({spaceUserId:100,displayName:'作者',blogApp:'author'}))
      .mockResolvedValueOnce(jsonResponse({blogPost:{id:88,postType:1,featuredImage:'https://img2024.cnblogs.com/old.png'},myConfig:{editor:{id:5}}}))
      .mockResolvedValueOnce(jsonResponse({headerName:'X-XSRF-TOKEN',requestToken:'csrf-token'}))
      .mockResolvedValueOnce(jsonResponse({id:88,url:'https://www.cnblogs.com/author/p/88.html'}));
    vi.stubGlobal('fetch',fetchMock1);

    await saveCnblogsDraft(clearedArticle,{postId:'88',appendSourceLink:false});
    const saveCall1=fetchMock1.mock.calls.find(call=>call[0]==='https://i.cnblogs.com/api/posts');
    expect(JSON.parse(String(saveCall1![1].body)).featuredImage).toBeNull();

    // 2. 未提供封面：cover=undefined 时保留原有 featuredImage
    const unknownCoverArticle:Article={...article,cover:undefined};
    const fetchMock2=vi.fn()
      .mockResolvedValueOnce(jsonResponse({spaceUserId:100,displayName:'作者',blogApp:'author'}))
      .mockResolvedValueOnce(jsonResponse({blogPost:{id:88,postType:1,featuredImage:'https://img2024.cnblogs.com/old.png'},myConfig:{editor:{id:5}}}))
      .mockResolvedValueOnce(jsonResponse({headerName:'X-XSRF-TOKEN',requestToken:'csrf-token'}))
      .mockResolvedValueOnce(jsonResponse({id:88,url:'https://www.cnblogs.com/author/p/88.html'}));
    vi.stubGlobal('fetch',fetchMock2);

    await saveCnblogsDraft(unknownCoverArticle,{postId:'88',appendSourceLink:false});
    const saveCall2=fetchMock2.mock.calls.find(call=>call[0]==='https://i.cnblogs.com/api/posts');
    expect(JSON.parse(String(saveCall2![1].body)).featuredImage).toBe('https://img2024.cnblogs.com/old.png');

    // 3. 关闭同步：syncCover=false 时保留原有 featuredImage
    const fetchMock3=vi.fn()
      .mockResolvedValueOnce(jsonResponse({spaceUserId:100,displayName:'作者',blogApp:'author'}))
      .mockResolvedValueOnce(jsonResponse({blogPost:{id:88,postType:1,featuredImage:'https://img2024.cnblogs.com/old.png'},myConfig:{editor:{id:5}}}))
      .mockResolvedValueOnce(jsonResponse({headerName:'X-XSRF-TOKEN',requestToken:'csrf-token'}))
      .mockResolvedValueOnce(jsonResponse({id:88,url:'https://www.cnblogs.com/author/p/88.html'}));
    vi.stubGlobal('fetch',fetchMock3);

    await saveCnblogsDraft(clearedArticle,{postId:'88',appendSourceLink:false,syncCover:false});
    const saveCall3=fetchMock3.mock.calls.find(call=>call[0]==='https://i.cnblogs.com/api/posts');
    expect(JSON.parse(String(saveCall3![1].body)).featuredImage).toBe('https://img2024.cnblogs.com/old.png');
  });

  it('短正文缺少源摘要时，自动摘要不混入首发声明文案',async()=>{
    const shortArticle:Article={
      id:'juejin-short',
      title:'短文章测试',
      markdown:'# 简短标题\n\n正文只有两句话。',
      tags:['测试'],
      sourceUrl:'https://juejin.cn/post/123456'
    };
    const fetchMock=vi.fn()
      .mockResolvedValueOnce(jsonResponse({spaceUserId:100,displayName:'作者',blogApp:'author'}))
      .mockResolvedValueOnce(jsonResponse({blogPost:{id:-1,postType:1},myConfig:{editor:{id:5}}}))
      .mockResolvedValueOnce(jsonResponse({headerName:'X-XSRF-TOKEN',requestToken:'csrf-token'}))
      .mockResolvedValueOnce(jsonResponse({id:102,url:'https://www.cnblogs.com/author/p/102.html'}));
    vi.stubGlobal('fetch',fetchMock);

    await saveCnblogsDraft(shortArticle,{appendSourceLink:true});
    const saveCall=fetchMock.mock.calls.find(call=>call[0]==='https://i.cnblogs.com/api/posts');
    const payload=JSON.parse(String(saveCall![1].body));
    expect(payload.description).toBe('简短标题 正文只有两句话。');
    expect(payload.description).not.toContain('本文首发于掘金');
    expect(payload.postBody).toContain('本文首发于掘金');
  });
});
