// 离屏渲染边界测试：模拟 DOM/Canvas，检查多行标签保真、错误反馈及共享容器串行化。
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

const engine=vi.hoisted(()=>({initialize:vi.fn(),render:vi.fn()}));
vi.mock('mermaid',()=>({default:engine}));
let listener:(message:unknown,sender:unknown,reply:(result:any)=>void)=>void;
let rasterSources:string[];
const svg="<svg width='100%' height='100%' viewBox='0 0 200 100'><text><tspan>第一行</tspan><tspan dy='16'>第二行</tspan></text></svg>";
const send=()=>new Promise<any>(resolve=>listener({target:'offscreen',type:'RENDER_MERMAID',code:'flowchart TD\nA-->B'},{},resolve));

beforeEach(async()=>{
  vi.resetModules();engine.initialize.mockReset();engine.render.mockReset();
  engine.render.mockResolvedValue({svg});rasterSources=[];
  const container={innerHTML:''};
  vi.stubGlobal('chrome',{runtime:{onMessage:{addListener:(callback:typeof listener)=>{listener=callback;}}}});
  vi.stubGlobal('document',{getElementById:()=>container,createElement:()=>({width:0,height:0,getContext:()=>({fillRect:()=>{},drawImage:()=>{}}),toDataURL:()=> 'data:image/png;base64,png'})});
  vi.stubGlobal('Image',class{
    onload?:()=>void;
    set src(value:string){rasterSources.push(decodeURIComponent(value.split(',')[1]));queueMicrotask(()=>this.onload?.());}
  });
  await import('../src/offscreen');
});
afterEach(()=>vi.unstubAllGlobals());

describe('离屏图表渲染',()=>{
  it('使用 SVG 文本标签并保留 tspan 换行，按 viewBox 设置尺寸',async()=>{
    expect(engine.initialize).toHaveBeenCalledWith(expect.objectContaining({htmlLabels:false,flowchart:{htmlLabels:false}}));
    expect(await send()).toMatchObject({ok:true});
    expect(rasterSources[0]).toContain("<tspan>第一行</tspan><tspan dy='16'>第二行</tspan>");
    expect(rasterSources[0]).toContain("width='200'");
    expect(rasterSources[0]).toContain("height='100'");
  });
  it('无法保真转换的 HTML 标签明确报错，不压平成图片',async()=>{
    engine.render.mockResolvedValue({svg:'<svg><foreignObject><div>第一行<br/>第二行</div></foreignObject></svg>'});
    expect(await send()).toMatchObject({ok:false,error:expect.stringContaining('无法保真')});
    expect(rasterSources).toHaveLength(0);
  });
  it('并发请求串行使用共享容器',async()=>{
    let release!:(result:{svg:string})=>void;
    engine.render.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
    const first=send(),second=send();
    await Promise.resolve();await Promise.resolve();
    expect(engine.render).toHaveBeenCalledTimes(1);
    release({svg});
    expect(await first).toMatchObject({ok:true});
    expect(await second).toMatchObject({ok:true});
    expect(engine.render).toHaveBeenCalledTimes(2);
  });
  it('一次语法错误不会阻塞后续图表',async()=>{
    engine.render.mockRejectedValueOnce(new Error('语法错误'));
    expect(await send()).toMatchObject({ok:false,error:'语法错误'});
    expect(await send()).toMatchObject({ok:true});
  });
});
