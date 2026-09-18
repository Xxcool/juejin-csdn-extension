// v1.0 review 回归：验证写入安全、账号隔离、内容保真和弹窗状态，不访问真实平台。
import {afterEach,describe,expect,it,vi} from 'vitest';
import {saveWechatDraft} from '../src/targets/wechat-api';
import {collectWechatImageUrls,compileWechatHtml,replaceWechatImageUrls} from '../src/targets/wechat-content';
import {deleteTask,getArticleDraftMapping,saveArticleDraftMapping,uniqueTasks} from '../src/core/store';
import {findMatchingTask,isRetryableTask} from '../src/core/task';
import {refreshPlatformSelection,syncReplyState} from '../src/core/sync-dialog';
import {EditorMetadataCache} from '../src/source/editor-metadata';
import {fetchJuejinDraftByArticleId} from '../src/source/juejin-api';
import type {Article,PlatformId,SyncTask} from '../src/types';

const article:Article={id:'source-1',title:'测试同步文章',markdown:'这是一篇超过二十个字符的测试文章，用于验证微信同步行为。',tags:[],sourceUrl:'https://juejin.cn/post/1'};
const meta=(account='gh_a')=>`{t:"123",ticket:"ticket",user_name:"${account}",nick_name:"测试公众号"}`;
function mockWechat(write:()=>Response|Promise<Response>,accounts=['gh_a','gh_a']){
  let authCount=0;
  return vi.fn(async(input:RequestInfo|URL)=>{
    const url=String(input);
    if(url==='https://mp.weixin.qq.com/')return new Response(meta(accounts[Math.min(authCount++,accounts.length-1)]));
    if(url.includes('operate_appmsg'))return write();
    if(url.includes('filetransfer'))return Response.json({base_resp:{err_msg:'ok'},cdn_url:'https://mmbiz.qpic.cn/transferred',content:'10'});
    if(url.includes('cropimage'))return Response.json({base_resp:{err_msg:'ok'},result:[1,2,3].map(id=>({cdnurl:`https://mmbiz.qpic.cn/c${id}`,file_id:id,width:100,height:100}))});
    return new Response(new Blob(['image'],{type:'image/png'}));
  });
}
const success=()=>Response.json({appMsgId:'draft-1',base_resp:{ret:0,err_msg:'ok'}});
afterEach(()=>vi.unstubAllGlobals());

describe('微信写入安全',()=>{
  it.each([400,401,429,500])('更新返回 %i 不会降级新建',async status=>{
    const fetch=mockWechat(()=>Response.json({base_resp:{ret:-1,err_msg:'rejected'}},{status}));
    vi.stubGlobal('fetch',fetch);
    await expect(saveWechatDraft(article,{appMsgId:'old',accountId:'gh_a'})).rejects.toBeDefined();
    const writes=fetch.mock.calls.filter(([url])=>String(url).includes('operate_appmsg'));
    expect(writes).toHaveLength(1);
    expect(String(writes[0][0])).toContain('sub=edit');
  });
  it.each(['network','json','empty','missing-id'])('新建 %s 响应不确定时禁止批量重试',async kind=>{
    vi.stubGlobal('fetch',mockWechat(()=>{
      if(kind==='network')throw new TypeError('Failed to fetch');
      if(kind==='json')return new Response('<html>gateway</html>');
      return Response.json(kind==='empty'?{}:{base_resp:{ret:0}});
    }));
    await expect(saveWechatDraft(article)).rejects.toMatchObject({category:'interrupted',stage:'draft'});
    expect(isRetryableTask({status:'needs-user',diagnostic:{category:'interrupted'}} as SyncTask)).toBe(false);
  });
  it('初始账号不匹配时不上传也不写入',async()=>{
    const fetch=mockWechat(success);
    vi.stubGlobal('fetch',fetch);
    await expect(saveWechatDraft(article,{accountId:'gh_b'})).rejects.toMatchObject({category:'blocked'});
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('最终保存前切换账号时阻断写入',async()=>{
    const fetch=mockWechat(success,['gh_a','gh_b']);
    vi.stubGlobal('fetch',fetch);
    await expect(saveWechatDraft(article,{accountId:'gh_a'})).rejects.toMatchObject({category:'blocked'});
    expect(fetch.mock.calls.some(([url])=>String(url).includes('operate_appmsg'))).toBe(false);
  });
  it('旧草稿无账号绑定时禁止猜测归属',async()=>{
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
    await expect(saveWechatDraft(article,{appMsgId:'legacy'})).rejects.toMatchObject({category:'blocked'});
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([false,true])('无封面文章可以保存，正文有图=%s',async withImage=>{
    const fetch=mockWechat(success);vi.stubGlobal('fetch',fetch);
    const result=await saveWechatDraft({...article,markdown:article.markdown+(withImage?'\n\n![图](https://example.com/a.png)':'')});
    expect(result.articleId).toBe('draft-1');
    expect(result.stats.imageTotal).toBe(withImage?1:0);
    expect(result.warnings).toHaveLength(0);
    expect(fetch.mock.calls.some(([url])=>String(url).includes('cropimage'))).toBe(false);
  });
  it('有封面时仍完整上传裁剪，失败不伪装成功',async()=>{
    vi.stubGlobal('createImageBitmap',vi.fn(async()=>({width:1600,height:900,close:()=>{}})));
    const fetch=mockWechat(success);vi.stubGlobal('fetch',fetch);
    expect((await saveWechatDraft({...article,cover:'https://example.com/cover.png'})).stats.imageTotal).toBe(1);
    expect(fetch.mock.calls.some(([url])=>String(url).includes('cropimage'))).toBe(true);
  });
});

describe('内容保真和元信息隔离',()=>{
  it('使用用户提供的微信原生结构，逐行保留空行和缩进',()=>{
    const html=compileWechatHtml('```js\nimport React from "react";\n\nfunction demo() {\n\treturn 1;\n}\n```');
    expect(html).toContain('<section class="code-snippet__js"><pre class="code-snippet__js code-snippet code-snippet_nowrap" data-lang="javascript" data-layout-id="null">');
    expect(html.match(/<code><span leaf="">/g)).toHaveLength(5);
    expect(html).toContain('<code><span leaf="">&nbsp;</span></code>');
    expect(html).toContain('<code><span leaf="">&nbsp;&nbsp;&nbsp;&nbsp;return&nbsp;1;</span></code>');
    expect(html).not.toContain('<br');
    expect(html).not.toContain('>code</p>');
  });
  it.each([['kotlin','kotlin'],['ts title="demo"','typescript'],['',''],['html','html']])('语言标记 %s 不被固定成示例的 kotlin', (language,expected)=>{
    const html=compileWechatHtml('```'+language+'\nconst value = 1;\n```');
    expect(html).toContain(`data-lang="${expected}"`);
  });
  it('原生代码行可还原 JSX、比较符、引号和连续缩进，不注入标签',()=>{
    const code='async loadStations() {\n  if (this.loading) return;\n\n  const view = <Panel value="a & b" />;\n  if (a < b && b > 0) return view;\n}';
    const html=compileWechatHtml('```javascript\n'+code+'\n```');
    const restored=[...html.matchAll(/<code><span leaf="">([\s\S]*?)<\/span><\/code>/g)].map(([,line])=>line==='&nbsp;'?'':line.replace(/&nbsp;/g,' ').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&')).join('\n');
    expect(restored).toBe(code);
    expect(html).not.toContain('<Panel');
    expect(html).not.toContain('code-snippet__keyword');
  });
  it('代码围栏和行内代码中的 HTML 保持原样且不作为图片上传',()=>{
    const html=compileWechatHtml('```html\n<script>alert(1)</script>\n<style>.x{color:red}</style>\n<img src="https://example.com/code.png">\n```\n\n`<img src="https://example.com/inline.png">`');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('.x{color:red}');
    expect(html).toContain('&lt;img&nbsp;src=&quot;https://example.com/code.png&quot;&gt;');
    expect(collectWechatImageUrls(html)).toEqual([]);
  });
  it('实际 HTML 脚本不透传，HTML 图片仍可转存',()=>{
    const html=compileWechatHtml('<script>alert(1)</script>\n\n<img src="https://example.com/a.png" onerror="alert(1)">');
    expect(html).not.toContain('alert(1)');
    expect(collectWechatImageUrls(html)).toEqual(['https://example.com/a.png']);
  });
  it('参考链接去重编号，图片替换不修改代码与参考地址',()=>{
    const url='https://example.com/a.png';
    const html=compileWechatHtml(`[文档](${url}) [同一文档](${url})\n\n![图片](${url})\n\n\`${url}\``);
    expect(html).toContain('参考链接');
    expect(html.match(/<sup>\[1\]<\/sup>/g)).toHaveLength(2);
    const replaced=replaceWechatImageUrls(html,new Map([[url,'https://mmbiz.qpic.cn/a']]));
    expect(collectWechatImageUrls(replaced)).toEqual(['https://mmbiz.qpic.cn/a']);
    expect(replaced).toContain(`[1] ${url}`);
    expect(replaced).toContain(`${url}</code>`);
  });
  it('清空封面摘要生效，切换草稿不串用，晚到响应留在原草稿',()=>{
    const cache=new EditorMetadataCache();
    cache.remember('a',{cover_image:'a.jpg',brief:'摘要'});
    expect(cache.get('b').cover).toBeUndefined();
    cache.remember('b',{cover_image:'',brief:''});
    cache.remember('a',{cover_image:'late-a.jpg'});
    expect(cache.get('b')).toMatchObject({cover:'',summary:''});
    cache.remember('a',{cover_image:'',brief:''});
    expect(cache.get('a')).toMatchObject({cover:'',summary:''});
  });
  it('历史草稿明确无封面时，不回退到文章列表的旧封面',async()=>{
    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>Response.json({err_no:0,data:String(input).includes('list_by_user')
      ?[{article_info:{article_id:'1',draft_id:'draft-1',cover_image:'old-cover.jpg'}}]
      :{article_draft:{id:'draft-1',mark_content:article.markdown,cover_image:''}}})));
    expect((await fetchJuejinDraftByArticleId('1','uuid')).cover).toBe('');
  });
});

describe('任务身份与弹窗结果',()=>{
  it('两个公众号映射及删除后的映射各自保留',async()=>{
    const store:Record<string,unknown>={};
    vi.stubGlobal('chrome',{storage:{local:{get:async(key:string)=>({[key]:store[key]}),set:async(patch:Record<string,unknown>)=>Object.assign(store,patch)}}});
    await saveArticleDraftMapping(article,'draft-a',undefined,'wechat','gh_a');
    await saveArticleDraftMapping(article,'draft-b',undefined,'wechat','gh_b');
    expect(await getArticleDraftMapping(article,'wechat','gh_a')).toMatchObject({wechatAppMsgId:'draft-a'});
    expect(await getArticleDraftMapping(article,'wechat','gh_b')).toMatchObject({wechatAppMsgId:'draft-b'});
    expect(await getArticleDraftMapping(article,'wechat')).toBeUndefined();
    const tasks=['gh_a','gh_b'].map((wechatAccountId,index)=>({id:wechatAccountId,article,platform:'wechat',wechatAccountId,wechatAppMsgId:`draft-${index}`,status:'saved',updatedAt:new Date().toISOString()} as SyncTask));
    expect(uniqueTasks(tasks)).toHaveLength(2);
    expect(findMatchingTask(tasks,article,'wechat','gh_b')?.id).toBe('gh_b');
    store.syncTasks=tasks;await deleteTask('gh_a');
    expect(await getArticleDraftMapping(article,'wechat','gh_a')).toMatchObject({wechatAppMsgId:'draft-0'});
  });
  it('只有 saved 状态计入成功，等待确认与进行中不计入',()=>{
    expect(syncReplyState({ok:true,task:{status:'saved'}}).saved).toBe(true);
    for(const status of ['needs-confirmation','queued','checking-login','transforming','writing'] as const)expect(syncReplyState({ok:true,task:{status}}).saved).toBe(false);
    expect(()=>syncReplyState({ok:true,task:{status:'failed',error:'失败'}})).toThrow('失败');
    expect(()=>syncReplyState({ok:true})).toThrow();
  });
  it('登录刷新保留取消勾选，登录失效移除选项，恢复后不偷偷重选',()=>{
    const selected=new Set<PlatformId>();
    const auths=[{platform:'csdn' as const,loggedIn:true},{platform:'wechat' as const,loggedIn:true}];
    refreshPlatformSelection(selected,auths,['csdn','wechat'],true);
    selected.delete('wechat');
    refreshPlatformSelection(selected,auths,['csdn','wechat'],false);
    expect([...selected]).toEqual(['csdn']);
    refreshPlatformSelection(selected,[{platform:'csdn',loggedIn:false}],['csdn'],false);
    refreshPlatformSelection(selected,auths,['csdn','wechat'],false);
    expect(selected.size).toBe(0);
  });
});
