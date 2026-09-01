// 核心同步逻辑回归测试：覆盖任务去重、异步重试、并发上限和 CSDN 请求契约。
import {afterEach,describe,expect,it,vi} from 'vitest';
import {mapConcurrent,retry} from '../src/core/async';
import {deleteTask,getDraftMapping,saveArticleDraftMapping,uniqueTasks} from '../src/core/store';
import {articleIdentityKeys,canDeleteTask,extractCsdnArticleId,findMatchingTask,isActiveTask,isInterruptedTask,isRetryableTask,isUncertainCreateTask} from '../src/core/task';
import {classifySyncError} from '../src/core/diagnostic';
import {isSupportedMessage} from '../src/core/message';
import {defaultSettings,formatCategoryMappings,normalizeSettings,parseCategoryMappings,resolveCsdnCategories,shouldConfirmDraftUpdate} from '../src/core/settings';
import {fetchJuejinDraftByArticleId} from '../src/source/juejin-api';
import {applyImageTransfers,buildSaveArticleBody,checkCsdnAuth,collectExternalImages,enforceImageFailurePolicy,imageExtension,normalizeMarkdown,summarizeImageTransfers,validateCsdnArticle} from '../src/targets/csdn-api';
import type {Article,SyncTask} from '../src/types';

const article:Article={id:'juejin-1',title:'测试文章',markdown:'正文内容足够长，用于测试同步请求。',tags:['TypeScript'],sourceUrl:'https://juejin.cn/post/1'};

afterEach(()=>vi.unstubAllGlobals());

describe('异步控制',()=>{
  it('失败后按次数重试并返回最终结果',async()=>{
    const operation=vi.fn().mockRejectedValueOnce(new Error('temporary')).mockResolvedValue('ok');
    await expect(retry(operation,3,0)).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('限制并发并保持结果顺序',async()=>{
    let active=0;
    let peak=0;
    const result=await mapConcurrent([1,2,3,4],2,async value=>{
      active++;
      peak=Math.max(peak,active);
      await new Promise(resolve=>setTimeout(resolve,5));
      active--;
      return value*2;
    });
    expect(result).toEqual([2,4,6,8]);
    expect(peak).toBe(2);
  });
});

describe('任务历史',()=>{
  it('同一平台文章只保留更新时间最近的任务',()=>{
    const base:SyncTask={id:'old',article,platform:'csdn',status:'failed',createdAt:'2026-09-01T00:00:00Z',updatedAt:'2026-09-01T00:00:00Z',attempts:1};
    const latest:SyncTask={...base,id:'latest',status:'saved',updatedAt:'2026-09-01T01:00:00Z'};
    expect(uniqueTasks([base,latest])).toEqual([latest]);
  });

  it('从旧版草稿链接迁移 CSDN ID 并区分可恢复与不确定任务',()=>{
    expect(extractCsdnArticleId('https://editor.csdn.net/md/?articleId=123')).toBe('123');
    const task:SyncTask={id:'working',article,platform:'csdn',status:'writing',createdAt:'2026-09-01T00:00:00Z',updatedAt:'2026-09-01T00:00:00Z',attempts:1};
    expect(isInterruptedTask(task)).toBe(false);
    expect(isUncertainCreateTask(task)).toBe(true);
    expect(isInterruptedTask({...task,csdnArticleId:'123'})).toBe(true);
    expect(isInterruptedTask({...task,status:'saved'})).toBe(false);
  });

  it('通过 draft_id 识别新建与历史流程中的同一篇文章',()=>{
    const newArticle={...article,id:'draft-9',sourceDraftId:'draft-9'};
    const historyArticle={...article,id:'article-123',sourceDraftId:'draft-9'};
    const task:SyncTask={id:'saved',article:newArticle,platform:'csdn',status:'saved',createdAt:'2026-09-01T00:00:00Z',updatedAt:'2026-09-01T00:00:00Z',attempts:1,csdnArticleId:'456'};
    expect(articleIdentityKeys(historyArticle)).toEqual(['article-123','draft-9']);
    expect(findMatchingTask([task],historyArticle)).toBe(task);
  });

  it('识别活动、可重试和可删除任务',()=>{
    const base:SyncTask={id:'task',article,platform:'csdn',status:'queued',createdAt:'2026-09-01T00:00:00Z',updatedAt:'2026-09-01T00:00:00Z',attempts:0};
    expect(isActiveTask(base)).toBe(true);
    expect(canDeleteTask(base)).toBe(false);
    expect(isRetryableTask({...base,status:'failed'})).toBe(true);
    expect(canDeleteTask({...base,status:'needs-confirmation'})).toBe(true);
  });

  it('删除历史记录时独立保留草稿映射',async()=>{
    const task:SyncTask={id:'saved',article,platform:'csdn',status:'saved',createdAt:'2026-09-01T00:00:00Z',updatedAt:'2026-09-01T00:00:00Z',attempts:1,csdnArticleId:'123',draftUrl:'https://editor.csdn.net/md/?articleId=123'};
    const storage:Record<string,unknown>={syncTasks:[task]};
    vi.stubGlobal('chrome',{storage:{local:{get:vi.fn(async(key:string)=>({[key]:storage[key]})),set:vi.fn(async(value:Record<string,unknown>)=>Object.assign(storage,value))}}});
    await deleteTask(task.id);
    expect(storage.syncTasks).toEqual([]);
    await expect(getDraftMapping(article.id)).resolves.toMatchObject({csdnArticleId:'123',draftUrl:task.draftUrl});
  });

  it('为正式文章 ID 和 draft_id 保存同一份草稿映射',async()=>{
    const storage:Record<string,unknown>={};
    vi.stubGlobal('chrome',{storage:{local:{get:vi.fn(async(key:string)=>({[key]:storage[key]})),set:vi.fn(async(value:Record<string,unknown>)=>Object.assign(storage,value))}}});
    const historyArticle={...article,id:'article-123',sourceDraftId:'draft-9'};
    await saveArticleDraftMapping(historyArticle,'456','https://editor.csdn.net/md/?articleId=456');
    await expect(getDraftMapping('article-123')).resolves.toMatchObject({csdnArticleId:'456'});
    await expect(getDraftMapping('draft-9')).resolves.toMatchObject({csdnArticleId:'456'});
  });
});

describe('同步设置',()=>{
  it('为旧设置补齐 0.4 默认值',()=>{
    expect(normalizeSettings({autoSyncAfterPublish:false})).toEqual({...defaultSettings,autoSyncAfterPublish:false});
  });

  it('解析分类映射并按标签匹配、去重',()=>{
    const mappings=parseCategoryMappings('JavaScript = 前端\nTypeScript=前端\n后端 = 后端\n无效行');
    expect(formatCategoryMappings(mappings)).toBe('JavaScript = 前端\nTypeScript = 前端\n后端 = 后端');
    expect(resolveCsdnCategories(['typescript','后端'],{...defaultSettings,defaultCsdnCategory:'其他',categoryMappings:mappings})).toEqual(['前端','后端']);
    expect(resolveCsdnCategories(['产品'],{...defaultSettings,defaultCsdnCategory:'其他',categoryMappings:mappings})).toEqual(['其他']);
  });

  it('仅在开启设置且已有草稿标识时等待确认',()=>{
    expect(shouldConfirmDraftUpdate({...defaultSettings,confirmDraftUpdate:true},'123')).toBe(true);
    expect(shouldConfirmDraftUpdate({...defaultSettings,confirmDraftUpdate:true})).toBe(false);
    expect(shouldConfirmDraftUpdate(defaultSettings,'123')).toBe(false);
  });
});

describe('后台消息与失败诊断',()=>{
  it('只接受已声明的扩展消息',()=>{
    expect(isSupportedMessage({type:'GET_TASKS'})).toBe(true);
    expect(isSupportedMessage({type:'SYNC_NEW_ARTICLE'})).toBe(true);
    expect(isSupportedMessage({type:'CONFIRM_PUBLISH'})).toBe(false);
    expect(isSupportedMessage({type:'UNKNOWN'})).toBe(false);
    expect(isSupportedMessage(null)).toBe(false);
  });

  it('区分登录、限流、网络和平台接口异常',()=>{
    expect(classifySyncError(new Error('请先登录 CSDN'),'authentication')).toMatchObject({category:'login',stage:'authentication'});
    expect(classifySyncError(new Error('请求失败 (429)'),'draft')).toMatchObject({category:'rate-limit'});
    expect(classifySyncError(new Error('Failed to fetch'),'images')).toMatchObject({category:'network'});
    expect(classifySyncError(new Error('Invalid Signature'),'authentication')).toMatchObject({category:'platform-change'});
    expect(classifySyncError(new Error('CSDN API 请求失败 (403)'),'draft')).toMatchObject({category:'platform-change'});
    expect(classifySyncError(new Error('CSDN API 请求失败 (400): 标题过短'),'draft')).toMatchObject({category:'content'});
  });

  it('对诊断内容中的敏感查询参数脱敏',()=>{
    expect(classifySyncError(new Error('失败 https://example.com/?token=secret&x=1'),'network').message).toContain('token=***');
  });
});

describe('CSDN 内容与保存契约',()=>{
  it('发送请求前按 CSDN 的 5~100 字标题规则校验',()=>{
    const completeArticle={...article,markdown:'这是长度超过二十个字符的完整正文内容，用于验证发送前的内容校验。'};
    expect(()=>validateCsdnArticle({...completeArticle,title:'测试'})).toThrow('至少需要 5 个字符');
    expect(()=>validateCsdnArticle({...completeArticle,title:'这是有效标题'})).not.toThrow();
  });

  it('清理掘金主题元数据并统一代码围栏',()=>{
    expect(normalizeMarkdown('---\ntheme: juejin\nhighlight: atom-one-dark\n---\n~~~ts\nconst a=1\n~~~')).toBe('```ts\nconst a=1\n```');
  });

  it('收集 Markdown 与 HTML 外链图片并排除 CSDN 图片',()=>{
    const markdown='![a](https://img.example.com/a.png)\n<img src="https://img.example.com/b.webp">\n![](https://img-blog.csdnimg.cn/c.png)';
    expect(collectExternalImages(markdown)).toEqual(['https://img.example.com/a.png','https://img.example.com/b.webp']);
  });

  it('根据地址或 MIME 识别图片扩展名',()=>{
    expect(imageExtension('https://example.com/a.png?x=1',new Blob([],{type:'image/jpeg'}))).toBe('png');
    expect(imageExtension('https://example.com/image',new Blob([],{type:'image/webp'}))).toBe('webp');
  });

  it('已有草稿使用 id 更新，新文章使用 is_new=1',()=>{
    const prepared={markdown:'markdown',html:'<p>markdown</p>'};
    expect(buildSaveArticleBody(article,prepared)).toMatchObject({is_new:1});
    expect(buildSaveArticleBody(article,prepared,'123')).toMatchObject({id:'123',is_new:0});
    expect(buildSaveArticleBody(article,prepared,undefined,['前端','前端','后端'])).toMatchObject({categories:'前端,后端'});
  });

  it('转存部分失败时保留正文原图并忽略失败封面',()=>{
    const source='正文 ![](https://img.example.com/body.png)';
    const result=applyImageTransfers(source,'https://img.example.com/cover.png',[
      {src:'https://img.example.com/body.png',error:'403'},
      {src:'https://img.example.com/cover.png',error:'timeout'}
    ]);
    expect(result.markdown).toBe(source);
    expect(result.cover).toBeUndefined();
    expect(result.warnings).toEqual([
      expect.stringContaining('正文图片转存失败，已保留原链接'),
      expect.stringContaining('封面转存失败，已忽略')
    ]);
    expect(summarizeImageTransfers([
      {src:'a',target:'uploaded-a'},
      {src:'b',error:'403'}
    ])).toEqual({imageTotal:2,imageSucceeded:1,imageFailed:1});
    expect(()=>enforceImageFailurePolicy([{src:'b',error:'403'}],'abort')).toThrow('已按设置终止同步');
    expect(()=>enforceImageFailurePolicy([{src:'b',error:'403'}],'continue')).not.toThrow();
  });
});

describe('平台 API 边界',()=>{
  it('翻页查找超过首批 100 篇的掘金文章',async()=>{
    const firstPage=Array.from({length:100},(_,index)=>({article_info:{article_id:String(index),draft_id:`draft-${index}`}}));
    const fetchMock=vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({err_no:0,err_msg:'',data:firstPage}),{status:200}))
      .mockResolvedValueOnce(new Response(JSON.stringify({err_no:0,err_msg:'',data:[{article_info:{article_id:'target',draft_id:'draft-target',title:'目标文章'}}]}),{status:200}))
      .mockResolvedValueOnce(new Response(JSON.stringify({err_no:0,err_msg:'',data:{article_draft:{id:'draft-target',title:'目标文章',mark_content:'这是足够长的 Markdown 正文，用于验证分页读取。',tags:[]}}}),{status:200}));
    vi.stubGlobal('fetch',fetchMock);

    await expect(fetchJuejinDraftByArticleId('target','uuid')).resolves.toMatchObject({id:'target',sourceDraftId:'draft-target',title:'目标文章'});
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({page_no:2,page_size:100});
  });

  it('将 CSDN 401 识别为未登录，将 403 签名错误识别为接口异常',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('',{status:401})));
    await expect(checkCsdnAuth()).resolves.toMatchObject({ok:true,loggedIn:false});

    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('',{status:403,headers:{'x-ca-error-message':'Invalid Signature'}})));
    await expect(checkCsdnAuth()).resolves.toMatchObject({ok:false,loggedIn:false,message:expect.stringContaining('Invalid Signature')});
  });
});
