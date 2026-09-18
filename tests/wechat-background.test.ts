// 后台消息链路回归：真实任务存储配合模拟平台，验证账号与不确定写入边界。
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {SyncTask} from '../src/types';

const platform=vi.hoisted(()=>({account:'gh_a',failure:false,writes:0}));
vi.mock('../src/targets/wechat-api',async()=>{
  return{
    requireWechatAccount:async(expected?:string)=>{
      const {SyncError}=await import('../src/core/diagnostic');
      if(expected&&expected!==platform.account)throw new SyncError('公众号账号不同','blocked','authentication');
      return platform.account;
    },
    checkWechatAuth:async()=>({ok:true,loggedIn:true,account:'测试公众号',meta:{userName:platform.account,token:'secret',ticket:'secret-ticket'}}),
    saveWechatDraft:async()=>{
      const {SyncError}=await import('../src/core/diagnostic');
      platform.writes++;
      if(platform.failure)throw new SyncError('保存结果不确定','interrupted','draft');
      return{articleId:`draft-${platform.account}`,draftUrl:'https://mp.weixin.qq.com/draft',warnings:[],stats:{imageTotal:0,imageSucceeded:0,imageFailed:0}};
    }
  };
});
vi.mock('../src/core/health',()=>({HEALTH_CHECK_ALARM:'health',refreshHealthIfNeeded:async()=>{},getCachedHealth:async()=>undefined,isHealthAlert:()=>false}));
vi.mock('../src/core/notify',()=>({buildTaskNotification:()=>undefined,showTaskNotification:async()=>{}}));

let store:Record<string,any>;
let listener:(message:unknown,sender:unknown,reply:(result:any)=>void)=>void;
const article={id:'source',title:'测试文章',markdown:'这是超过二十个字符的文章正文，用于验证后台实际任务链路。',cover:'',tags:[],sourceUrl:'https://juejin.cn/post/1'};
const send=(message:Record<string,unknown>)=>new Promise<any>(resolve=>listener(message,{},resolve));
beforeEach(async()=>{
  vi.resetModules();vi.useFakeTimers();
  platform.account='gh_a';platform.failure=false;platform.writes=0;
  store={syncTasks:[]};
  vi.stubGlobal('chrome',{
    storage:{local:{get:async(key:string)=>({[key]:store[key]}),set:async(patch:Record<string,unknown>)=>{Object.assign(store,patch);}},session:{get:async()=>({}),set:async()=>{},remove:async()=>{}}},
    runtime:{onMessage:{addListener:(callback:typeof listener)=>{listener=callback;}},getURL:(path:string)=>path},
    action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}},
    notifications:{onClicked:{addListener:()=>{}}},
    alarms:{get:async()=>({}),onAlarm:{addListener:()=>{}}}
  });
  await import('../src/background');
});
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();});

describe('后台微信同步消息',()=>{
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
});
