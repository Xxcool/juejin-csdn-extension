// 核心同步逻辑回归测试：覆盖任务去重、异步重试、并发上限和 CSDN 请求契约。
import {afterEach,describe,expect,it,vi} from 'vitest';
import {mapConcurrent,retry} from '../src/core/async';
import {uniqueTasks} from '../src/core/store';
import {extractCsdnArticleId,isInterruptedTask,isUncertainCreateTask,withPublishedArticleId} from '../src/core/task';
import {fetchJuejinDraftByArticleId} from '../src/source/juejin-api';
import {applyImageTransfers,buildSaveArticleBody,checkCsdnAuth,collectExternalImages,imageExtension,normalizeMarkdown} from '../src/targets/csdn-api';
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

  it('发布成功后使用正式文章 ID 作为同步身份',()=>{
    expect(withPublishedArticleId(article,'https://juejin.cn/post/123456?from=editor')).toMatchObject({id:'123456',sourceUrl:'https://juejin.cn/post/123456?from=editor'});
    expect(withPublishedArticleId(article,'https://juejin.cn/editor/drafts/9')).toMatchObject({id:'juejin-1'});
  });
});

describe('CSDN 内容与保存契约',()=>{
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

    await expect(fetchJuejinDraftByArticleId('target','uuid')).resolves.toMatchObject({id:'target',title:'目标文章'});
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({page_no:2,page_size:100});
  });

  it('将 CSDN 401 识别为未登录，将 403 签名错误识别为接口异常',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('',{status:401})));
    await expect(checkCsdnAuth()).resolves.toMatchObject({ok:true,loggedIn:false});

    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('',{status:403,headers:{'x-ca-error-message':'Invalid Signature'}})));
    await expect(checkCsdnAuth()).resolves.toMatchObject({ok:false,loggedIn:false,message:expect.stringContaining('Invalid Signature')});
  });
});
