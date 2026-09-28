// 掘金摘要契约回归：覆盖历史文章、草稿回填和 CSDN 摘要预演。
import {afterEach,describe,expect,it,vi} from 'vitest';
import {fetchJuejinDraftByArticleId,fetchJuejinDraftByDraftId} from '../src/source/juejin-api';
import {EditorMetadataCache} from '../src/source/editor-metadata';
import {buildDryRunReport,buildSaveArticleBody} from '../src/targets/csdn-api';
import {defaultSettings} from '../src/core/settings';

const markdown='这是正文开头，与作者填写的自定义摘要完全不同，用于检查摘要来源。';
afterEach(()=>vi.unstubAllGlobals());

describe('掘金摘要读取',()=>{
  it.each([
    {draft:' 草稿手填摘要 ',published:'已发布摘要',expected:'草稿手填摘要'},
    {draft:undefined,published:' 已发布摘要 ',expected:'已发布摘要'},
    {draft:'',published:'旧摘要',expected:''},
    {draft:undefined,published:undefined,expected:undefined}
  ])('草稿摘要=$draft，文章摘要=$published',async({draft,published,expected})=>{
    const fetch=vi.fn(async(input:RequestInfo|URL)=>Response.json({err_no:0,data:String(input).includes('list_by_user')
      ?[{article_info:{article_id:'1',draft_id:'2',brief_content:published}}]
      :{article_draft:{id:'2',title:'摘要测试文章',mark_content:markdown,brief_content:draft}}}));
    vi.stubGlobal('fetch',fetch);
    const article=await fetchJuejinDraftByArticleId('1','test-uuid');
    expect(article.summary).toBe(expected);
    const report=buildDryRunReport(article,defaultSettings);
    expect(report.summaryPreview).toBe(expected||markdown);
    expect(buildSaveArticleBody(article,{markdown,html:'<p>正文</p>',summary:report.summaryPreview}).Description).toBe(expected||markdown);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('按草稿 ID 回填同样读取 brief_content',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>Response.json({err_no:0,data:{article_draft:{mark_content:markdown,brief_content:'作者摘要'}}})));
    expect((await fetchJuejinDraftByDraftId('2','test-uuid')).summary).toBe('作者摘要');
  });
  it('编辑器缓存保留摘要并允许显式清空',()=>{
    const cache=new EditorMetadataCache();
    cache.remember('2',{brief_content:'作者摘要'});
    expect(cache.get('2').summary).toBe('作者摘要');
    cache.remember('2',{brief_content:''});
    expect(cache.get('2').summary).toBe('');
  });
});
