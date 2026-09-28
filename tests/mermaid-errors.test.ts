// Mermaid 错误传递回归：区分明确渲染失败与暂时通信故障，并保留图表序号。
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {renderAllMermaidBlocks,renderMermaidToPng} from '../src/core/mermaid-render';
import {saveWechatDraft} from '../src/targets/wechat-api';

let render:ReturnType<typeof vi.fn>;
beforeEach(()=>{
  render=vi.fn();
  vi.stubGlobal('chrome',{
    runtime:{getContexts:async()=>[{}],getURL:(path:string)=>path,
      sendMessage:(message:any,reply:any)=>message.type==='PING'?reply({ok:true}):render(message,reply)},
    offscreen:{createDocument:async()=>{}}
  });
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});

describe('Mermaid 错误反馈',()=>{
  it.each(['图表包含无法保真转换的 HTML 标签','Parse error on line 3:\nUnexpected token'])('具体错误直接抛出：%s',async error=>{
    render.mockImplementation((_message,reply)=>queueMicrotask(()=>reply({ok:false,error})));
    await expect(renderMermaidToPng('flowchart TD\nA-->')).rejects.toThrow(error);
    expect(render).toHaveBeenCalledTimes(1);
  });
  it('批量渲染保留失败图表序号与原始原因',async()=>{
    render.mockImplementationOnce((_message,reply)=>reply({ok:true,dataUrl:'data:image/png;base64,ok'}))
      .mockImplementation((_message,reply)=>reply({ok:false,error:'语法错误：缺少节点'}));
    await expect(renderAllMermaidBlocks('```mermaid\nflowchart TD\nA-->B\n```\n\n```mermaid\nflowchart TD\nC-->\n```')).rejects.toThrow('第 2 个 Mermaid 图表渲染失败：语法错误：缺少节点');
  });
  it('通信失败仍重试，恢复后返回图片',async()=>{
    render.mockImplementationOnce((_message,reply)=>reply(undefined))
      .mockImplementationOnce(()=>{throw new Error('消息通道未就绪');})
      .mockImplementation((_message,reply)=>reply({ok:true,dataUrl:'data:image/png;base64,ok'}));
    expect(await renderMermaidToPng('flowchart TD\nA-->B')).toBe('data:image/png;base64,ok');
    expect(render).toHaveBeenCalledTimes(3);
  });
  it('已存在的离屏文档失去响应时关闭并重建',async()=>{
    let ready=false;
    const closeDocument=vi.fn(async()=>{});
    const createDocument=vi.fn(async()=>{ready=true;});
    vi.stubGlobal('chrome',{
      runtime:{getContexts:async()=>[{}],getURL:(path:string)=>path,
        sendMessage:(message:any,reply:any)=>message.type==='PING'?reply({ok:ready}):reply({ok:true,dataUrl:'data:image/png;base64,recovered'})},
      offscreen:{createDocument,closeDocument}
    });
    await expect(renderMermaidToPng('flowchart TD\nA-->B')).resolves.toBe('data:image/png;base64,recovered');
    expect(closeDocument).toHaveBeenCalledTimes(1);
    expect(createDocument).toHaveBeenCalledTimes(1);
  });
  it('并发图表请求只创建一次离屏文档',async()=>{
    let release!:()=>void;
    let ready=false;
    const creating=new Promise<void>(resolve=>{release=()=>{ready=true;resolve();};});
    const createDocument=vi.fn(()=>creating);
    vi.stubGlobal('chrome',{
      runtime:{getContexts:async()=>[],getURL:(path:string)=>path,
        sendMessage:(message:any,reply:any)=>message.type==='PING'?reply({ok:ready}):reply({ok:true,dataUrl:'data:image/png;base64,ok'})},
      offscreen:{createDocument}
    });
    const first=renderMermaidToPng('flowchart TD\nA-->B');
    const second=renderMermaidToPng('flowchart TD\nC-->D');
    await vi.waitFor(()=>expect(createDocument).toHaveBeenCalledTimes(1));
    release();
    await expect(Promise.all([first,second])).resolves.toEqual(['data:image/png;base64,ok','data:image/png;base64,ok']);
    expect(createDocument).toHaveBeenCalledTimes(1);
  });
  it('没有具体原因的失败仍返回通用提示',async()=>{
    render.mockImplementation((_message,reply)=>reply({ok:false}));
    await expect(renderAllMermaidBlocks('```mermaid\nflowchart TD\nA-->B\n```')).rejects.toThrow('第 1 个 Mermaid 图表渲染失败，请检查图表语法或重新加载扩展后重试');
    expect(render).toHaveBeenCalledTimes(3);
  });
  it('超时重试三次后结束，不悬挂任务',async()=>{
    vi.useFakeTimers();
    render.mockImplementation(()=>{});
    const result=renderMermaidToPng('flowchart TD\nA-->B');
    await vi.runAllTimersAsync();
    expect(await result).toBeUndefined();
    expect(render).toHaveBeenCalledTimes(3);
  });
  it('微信保存向上反馈具体原因，并在写入前停止',async()=>{
    render.mockImplementation((_message,reply)=>reply({ok:false,error:'图表包含无法保真转换的 HTML 标签'}));
    const fetch=vi.fn(async()=>new Response('{t:"123",ticket:"test",user_name:"gh_a",nick_name:"test"}'));
    vi.stubGlobal('fetch',fetch);
    await expect(saveWechatDraft({id:'test',title:'测试图表',markdown:'这是一篇图表错误测试文章。\n\n```mermaid\nflowchart TD\nA-->B\n```',tags:[],sourceUrl:''})).rejects.toMatchObject({
      category:'content',stage:'content',message:expect.stringContaining('第 1 个 Mermaid 图表渲染失败：图表包含无法保真转换的 HTML 标签')
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
