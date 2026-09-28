// 后台消息链路回归：真实任务存储配合模拟平台，验证账号与不确定写入边界。
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {SyncTask} from '../src/types';

const platform=vi.hoisted(()=>({account:'gh_a',loggedIn:true,failure:false,writes:0,lastSummary:undefined as string|undefined}));
vi.mock('../src/targets/wechat-api',async()=>{
  return{
    requireWechatAccount:async(expected?:string)=>{
      const {SyncError}=await import('../src/core/diagnostic');
      if(expected&&expected!==platform.account)throw new SyncError('公众号账号不同','blocked','authentication');
      return platform.account;
    },
    checkWechatAuth:async()=>({ok:true,loggedIn:platform.loggedIn,account:'测试公众号',meta:platform.loggedIn?{userName:platform.account,token:'secret',ticket:'secret-ticket'}:undefined}),
    saveWechatDraft:async(article:{summary?:string})=>{
      const {SyncError}=await import('../src/core/diagnostic');
      platform.writes++;
      platform.lastSummary=article.summary;
      if(platform.failure)throw new SyncError('保存结果不确定','interrupted','draft');
      return{articleId:`draft-${platform.account}`,draftUrl:'https://mp.weixin.qq.com/draft',warnings:[],stats:{imageTotal:0,imageSucceeded:0,imageFailed:0}};
    }
  };
});
vi.mock('../src/core/health',()=>({HEALTH_CHECK_ALARM:'health',refreshHealthIfNeeded:async()=>{},getCachedHealth:async()=>undefined,isHealthAlert:()=>false}));
vi.mock('../src/core/notify',()=>({buildTaskNotification:()=>undefined,showTaskNotification:async()=>{}}));

let store:Record<string,any>;
let sessionStore:Record<string,any>;
let listener:(message:unknown,sender:unknown,reply:(result:any)=>void)=>void;
const article={id:'source',title:'测试文章',markdown:'这是超过二十个字符的文章正文，用于验证后台实际任务链路。',cover:'',tags:[],sourceUrl:'https://juejin.cn/post/1'};
const send=(message:Record<string,unknown>)=>new Promise<any>(resolve=>listener(message,{},resolve));
beforeEach(async()=>{
  vi.resetModules();vi.useFakeTimers();
  platform.account='gh_a';platform.loggedIn=true;platform.failure=false;platform.writes=0;
  store={syncTasks:[]};
  sessionStore={};
  vi.stubGlobal('chrome',{
    storage:{local:{get:async(key:string)=>({[key]:store[key]}),set:async(patch:Record<string,unknown>)=>{Object.assign(store,patch);},remove:async(key:string)=>{delete store[key];}},session:{get:async(keys:string|string[])=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(key=>[key,sessionStore[key]])),set:async(patch:Record<string,unknown>)=>{Object.assign(sessionStore,patch);},remove:async(key:string)=>{delete sessionStore[key];}}},
    runtime:{onMessage:{addListener:(callback:typeof listener)=>{listener=callback;}},getURL:(path:string)=>path},
    action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}},
    tabs:{create:async()=>({})},
    notifications:{onClicked:{addListener:()=>{}}},
    alarms:{get:async()=>({}),onAlarm:{addListener:()=>{}}}
  });
  await import('../src/background');
});
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();});

describe('后台微信同步消息',()=>{
  it.each(['提交时的摘要',''])('重试回填正文时保留提交时摘要 %s',async summary=>{
    await send({type:'SYNC_NEW_ARTICLE',platform:'wechat',article:{...article,sourceDraftId:'2',summary},wechatAccountId:'gh_a'});
    const task=store.syncTasks[0];
    expect(task.article.markdown).toBe('');
    task.status='failed';store.juejinUuid='test-uuid';
    vi.stubGlobal('fetch',vi.fn(async()=>Response.json({err_no:0,data:{article_draft:{mark_content:article.markdown,brief_content:'后来修改的摘要',cover_image:''}}})));
    expect(await send({type:'RETRY_TASK',id:task.id})).toMatchObject({ok:true});
    await vi.waitFor(()=>expect(platform.writes).toBe(2));
    expect(platform.lastSummary).toBe(summary);
  });
  it('任务与映射绑定当前公众号，同一篇文章在另一账号单独建档',async()=>{
    const first=await send({type:'SYNC_NEW_ARTICLE',platform:'wechat',article,wechatAccountId:'gh_a'});
    expect(first.task).toMatchObject({status:'saved',wechatAccountId:'gh_a',wechatAppMsgId:'draft-gh_a'});
    platform.account='gh_b';
    const second=await send({type:'SYNC_NEW_ARTICLE',platform:'wechat',article,wechatAccountId:'gh_b'});
    expect(second.task).toMatchObject({status:'saved',wechatAccountId:'gh_b',wechatAppMsgId:'draft-gh_b'});
    expect(store.syncTasks).toHaveLength(2);
    expect(store['wechatDraftMapping:gh_a:source'].wechatAppMsgId).toBe('draft-gh_a');
    expect(store['wechatDraftMapping:gh_b:source'].wechatAppMsgId).toBe('draft-gh_b');
  });
  it('弹窗检测后账号切换，入队前拒绝写入',async()=>{
    platform.account='gh_b';
    expect((await send({type:'SYNC_NEW_ARTICLE',platform:'wechat',article,wechatAccountId:'gh_a'})).ok).toBe(false);
    expect(platform.writes).toBe(0);
  });
  it('需要确认时返回待确认，不实际保存',async()=>{
    store.settings={confirmDraftUpdate:true};
    store['wechatDraftMapping:gh_a:source']={articleId:'source',wechatAccountId:'gh_a',wechatAppMsgId:'existing'};
    const result=await send({type:'SYNC_NEW_ARTICLE',platform:'wechat',article,wechatAccountId:'gh_a'});
    expect(result).toMatchObject({ok:true,task:{status:'needs-confirmation'}});
    expect(platform.writes).toBe(0);
  });
  it('不确定写入暂停，批量重试及重复同步不再次写入',async()=>{
    platform.failure=true;
    const message={type:'SYNC_NEW_ARTICLE',platform:'wechat',article,wechatAccountId:'gh_a'};
    expect((await send(message)).ok).toBe(false);
    const task=store.syncTasks[0] as SyncTask;
    expect(task).toMatchObject({status:'needs-user',diagnostic:{category:'interrupted'}});
    expect(await send({type:'RETRY_FAILED_TASKS'})).toMatchObject({count:0});
    expect((await send({type:'RETRY_TASK',id:task.id})).ok).toBe(false);
    expect((await send(message)).ok).toBe(false);
    expect(platform.writes).toBe(1);
  });
  it('未绑定账号的旧草稿映射不被自动沿用或覆盖',async()=>{
    store['wechatDraftMapping:source']={articleId:'source',wechatAppMsgId:'legacy'};
    const result=await send({type:'SYNC_NEW_ARTICLE',platform:'wechat',article,wechatAccountId:'gh_a'});
    expect(result).toMatchObject({ok:false,message:expect.stringContaining('旧微信草稿映射')});
    expect(platform.writes).toBe(0);
  });
  it('登录状态只返回展示与绑定信息，不下发上传票据',async()=>{
    const result=await send({type:'CHECK_WECHAT_STATUS'});
    expect(result).toMatchObject({loggedIn:true,accountId:'gh_a'});
    expect(result).not.toHaveProperty('meta');
    expect(JSON.stringify(result)).not.toContain('secret');
  });
  it('发往 offscreen 的离屏渲染消息不被 background 拦截回复',async()=>{
    let replyCalled=false;
    const reply=vi.fn(()=>{replyCalled=true;});
    listener({target:'offscreen',type:'PING'},{},reply);
    expect(replyCalled).toBe(false);
    expect(reply).not.toHaveBeenCalled();

    listener({target:'offscreen',type:'RENDER_MERMAID',code:'flowchart TD\nA-->B'},{},reply);
    expect(replyCalled).toBe(false);
  });

  it('远端已保存而本地任务首次落盘失败时，保留草稿 ID 并阻止批量重建',async()=>{
    const originalSet=chrome.storage.local.set;
    let failed=false;
    (chrome.storage.local as any).set=async(patch:Record<string,any>)=>{
      if(!failed&&patch.syncTasks?.[0]?.status==='saved'){failed=true;throw new Error('storage temporarily unavailable');}
      return originalSet(patch);
    };
    expect((await send({type:'SYNC_NEW_ARTICLE',platform:'wechat',article,wechatAccountId:'gh_a'})).ok).toBe(false);
    expect(store.syncTasks[0]).toMatchObject({status:'needs-user',wechatAppMsgId:'draft-gh_a',diagnostic:{category:'interrupted'}});
    expect(await send({type:'RETRY_FAILED_TASKS'})).toMatchObject({count:0});
    expect(platform.writes).toBe(1);
  });

  it('徽标写入失败不把已保存的任务改为失败',async()=>{
    (chrome.action as any).setBadgeText=async()=>{throw new Error('badge unavailable');};
    const result=await send({type:'SYNC_NEW_ARTICLE',platform:'wechat',article,wechatAccountId:'gh_a'});
    expect(result.task).toMatchObject({status:'saved',wechatAppMsgId:'draft-gh_a'});
    expect(store.syncTasks[0].status).toBe('saved');
    expect(store['wechatDraftMapping:gh_a:source']).toMatchObject({wechatAppMsgId:'draft-gh_a'});
  });

  it('多篇历史文章等待登录时排队，源站读取失败后请求仍可恢复',async()=>{
    platform.loggedIn=false;
    const request=(articleId:string)=>({type:'SYNC_HISTORY_ARTICLE',platform:'wechat',articleId,title:`文章 ${articleId}`,sourceUrl:`https://juejin.cn/post/${articleId}`,uuid:'uuid',wechatAccountId:'gh_a'});
    expect((await send(request('1'))).needsLogin).toBe(true);
    expect((await send(request('2'))).needsLogin).toBe(true);
    expect(sessionStore.pendingHistories).toHaveLength(2);
    platform.loggedIn=true;
    vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('掘金暂不可用');}));
    const failed=await send({type:'RESUME_PENDING_HISTORY'});
    expect(failed.errors).toHaveLength(2);
    expect(sessionStore.pendingHistories).toHaveLength(2);
    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>Response.json({err_no:0,data:String(input).includes('list_by_user')
      ?[1,2].map(id=>({article_info:{article_id:String(id),draft_id:String(id)}}))
      :{article_draft:{mark_content:article.markdown,cover_image:''}}})));
    const resumed=await send({type:'RESUME_PENDING_HISTORY'});
    expect(resumed.results).toHaveLength(2);
    expect(sessionStore.pendingHistories).toEqual([]);
    expect(platform.writes).toBe(2);
  });
  it('登录续传已创建任务但目标写入失败时，不在下次页面唤醒重复执行',async()=>{
    platform.loggedIn=false;
    await send({type:'SYNC_HISTORY_ARTICLE',platform:'wechat',articleId:'1',title:'历史文章',sourceUrl:'https://juejin.cn/post/1',uuid:'uuid',wechatAccountId:'gh_a'});
    platform.loggedIn=true;
    platform.failure=true;
    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>Response.json({err_no:0,data:String(input).includes('list_by_user')
      ?[{article_info:{article_id:'1',draft_id:'1'}}]
      :{article_draft:{mark_content:article.markdown,cover_image:''}}})));
    const first=await send({type:'RESUME_PENDING_HISTORY'});
    expect(first.errors).toHaveLength(1);
    expect(sessionStore.pendingHistories).toEqual([]);
    expect(store.syncTasks[0]).toMatchObject({status:'needs-user',diagnostic:{category:'interrupted'}});
    await send({type:'RESUME_PENDING_HISTORY'});
    expect(platform.writes).toBe(1);
  });

  it('CSDN 已有文章状态不明时暂停更新，不发送保存请求',async()=>{
    const csdnArticle={...article,title:'足够长的测试文章'};
    store.syncTasks=[{id:'csdn-old',article:csdnArticle,platform:'csdn',status:'saved',createdAt:'2026-09-01T00:00:00Z',updatedAt:'2026-09-01T00:00:00Z',attempts:1,csdnArticleId:'old-1'}];
    const fetch=vi.fn(async()=>new Response('',{status:503}));
    vi.stubGlobal('fetch',fetch);
    expect((await send({type:'SYNC_NEW_ARTICLE',platform:'csdn',article:csdnArticle})).ok).toBe(false);
    expect(store.syncTasks[0]).toMatchObject({status:'needs-user',csdnArticleId:'old-1',diagnostic:{category:'blocked'}});
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('CSDN 明确返回旧草稿不存在时按新建保存，中断恢复不沿用旧 ID',async()=>{
    const csdnArticle={...article,title:'足够长的测试文章'};
    store.syncTasks=[{id:'csdn-old',article:csdnArticle,platform:'csdn',status:'saved',createdAt:'2026-09-01T00:00:00Z',updatedAt:'2026-09-01T00:00:00Z',attempts:1,csdnArticleId:'old-1'}];
    store['csdnDraftMapping:source']={articleId:'source',csdnArticleId:'old-1'};
    const writes:Record<string,unknown>[]=[];
    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);
      if(url.includes('getArticle'))return new Response('该文章不存在',{status:404});
      if(url.includes('getBaseInfo'))return Response.json({code:200,data:{name:'tester'}});
      if(url.includes('saveArticle')){writes.push(JSON.parse(String(init?.body)));return Response.json({code:200,data:{id:'new-2'}});}
      throw new Error(`unexpected request: ${url}`);
    }));
    const result=await send({type:'SYNC_NEW_ARTICLE',platform:'csdn',article:csdnArticle});
    expect(result).toMatchObject({ok:true});
    expect(result.task).toMatchObject({status:'saved',csdnArticleId:'new-2'});
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({is_new:1});
    expect(writes[0]).not.toHaveProperty('id');
    expect(store['csdnDraftMapping:source']).toMatchObject({csdnArticleId:'new-2'});
  });

  it('CSDN 更新请求才发现旧草稿已删除时，新建前先清除任务旧 ID',async()=>{
    const csdnArticle={...article,title:'足够长的测试文章'};
    store.syncTasks=[{id:'csdn-old',article:csdnArticle,platform:'csdn',status:'saved',createdAt:'2026-09-01T00:00:00Z',updatedAt:'2026-09-01T00:00:00Z',attempts:1,csdnArticleId:'old-1'}];
    store['csdnDraftMapping:source']={articleId:'source',csdnArticleId:'old-1'};
    let saveCount=0;
    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);
      if(url.includes('getArticle'))return Response.json({code:200,data:{pubStatus:'draft'}});
      if(url.includes('getBaseInfo'))return Response.json({code:200,data:{name:'tester'}});
      if(url.includes('saveArticle')){
        saveCount++;
        if(saveCount===1)return new Response('该文章不存在',{status:400});
        expect(store.syncTasks[0]).toMatchObject({status:'writing',csdnArticleId:undefined});
        expect(store['csdnDraftMapping:source']).toBeUndefined();
        expect(JSON.parse(String(init?.body))).toMatchObject({is_new:1});
        return Response.json({code:200,data:{id:'new-3'}});
      }
      throw new Error(`unexpected request: ${url}`);
    }));
    const result=await send({type:'SYNC_NEW_ARTICLE',platform:'csdn',article:csdnArticle});
    expect(result.task).toMatchObject({status:'saved',csdnArticleId:'new-3'});
    expect(saveCount).toBe(2);
  });
});
