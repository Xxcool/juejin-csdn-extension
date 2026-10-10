import {describe,it,expect} from 'vitest';
import {compileZhihuHtml,collectZhihuImages,replaceZhihuImages,validateZhihuArticle} from '../src/targets/zhihu-content';
import {SyncError} from '../src/core/diagnostic';
import type {Article} from '../src/types';

describe('知乎内容编译器', () => {
  it('标题、段落、列表、引用与分割线转换为标准 HTML', () => {
    const md = `
# 一级标题
## 二级标题

普通段落内容。

- 无序 1
- 无序 2

1. 有序 1
2. 有序 2

> 引用文字

---
`;
    const html = compileZhihuHtml(md);
    expect(html).toContain('<h1>一级标题</h1>');
    expect(html).toContain('<h2>二级标题</h2>');
    expect(html).toContain('<p>普通段落内容。</p>');
    expect(html).toContain('<ul><li>无序 1</li><li>无序 2</li></ul>');
    expect(html).toContain('<ol><li>有序 1</li><li>有序 2</li></ol>');
    expect(html).toContain('<blockquote><p>引用文字</p></blockquote>');
    expect(html).toContain('<hr/>');
  });

  it('代码块与行内代码保留语言标识、换行与特殊字符，不受字面量污染', () => {
    const md = `
行内 \`const a = 1 < 2 && "test";\` 测试

\`\`\`javascript
function hello() {
  console.log("Hello <World> & 'Peace'!");
  return true;
}
\`\`\`
`;
    const html = compileZhihuHtml(md);
    expect(html).toContain('<code>const a = 1 &lt; 2 &amp;&amp; &quot;test&quot;;</code>');
    expect(html).toContain('<pre lang="javascript"><code>function hello() {\n  console.log(&quot;Hello &lt;World&gt; &amp; &#39;Peace&#39;!&quot;);\n  return true;\n}</code></pre>');
  });

  it('GFM 表格转换为知乎 Draft.js 所需的属性结构', () => {
    const md = `
| 标题 A | 标题 B |
| --- | --- |
| 内容 1 | 内容 2 |
| 内容 3 | 内容 4 |
`;
    const html = compileZhihuHtml(md);
    expect(html).toContain('<table data-draft-node="block" data-draft-type="table" data-size="normal">');
    expect(html).toContain('<th>标题 A</th><th>标题 B</th>');
    expect(html).toContain('<td>内容 1</td><td>内容 2</td>');
    expect(html).toContain('<td>内容 3</td><td>内容 4</td>');
  });

  it('安全链接保留 http/https，危险链接剥离协议', () => {
    const md = `[正常链接](https://example.com) 和 [恶意链接](javascript:alert(1))`;
    const html = compileZhihuHtml(md);
    expect(html).toContain('<a href="https://example.com">正常链接</a>');
    expect(html).not.toContain('href="javascript:alert(1)"');
    expect(html).toContain('恶意链接');
  });

  it('Markdown 图片转为知乎 figure 容器', () => {
    const md = `![测试图片](https://example.com/test.png)`;
    const html = compileZhihuHtml(md);
    expect(html).toContain('<figure><img src="https://example.com/test.png" alt="测试图片"/></figure>');
  });

  it('Mermaid 图表正常渲染图片，缺少图片时中止并报错', () => {
    const md = `
\`\`\`mermaid
flowchart TD
    A --> B
\`\`\`
`;
    // 缺少图片映射时抛出明确错误
    expect(() => compileZhihuHtml(md)).toThrow(SyncError);

    // 提供图片映射时成功渲染为 figure img
    const images = new Map([['flowchart TD\n    A --> B', 'data:image/png;base64,mockPng']]);
    const html = compileZhihuHtml(md, {mermaidImages: images});
    expect(html).toContain('<figure><img src="data:image/png;base64,mockPng" alt="Mermaid 图表"/></figure>');
  });

  it('原始 HTML 安全过滤 script、style、iframe 和 on* 事件', () => {
    const md = `
<script>alert(1)</script>
<p onclick="steal()">安全文字</p>
<iframe src="evil.com"></iframe>
`;
    const html = compileZhihuHtml(md);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<iframe>');
    expect(html).not.toContain('onclick');
    expect(html).toContain('安全文字');
  });

  it('图片收集与精准替换，不误伤代码中的伪图片 URL', () => {
    const md = `
![图1](https://example.com/pic1.jpg)
![图2](https://example.com/pic2.png)

\`\`\`markdown
![示例伪图](https://example.com/pic1.jpg)
\`\`\`
`;
    const html = compileZhihuHtml(md);
    const images = collectZhihuImages(html);
    expect(images).toEqual(['https://example.com/pic1.jpg', 'https://example.com/pic2.png']);

    const replacements = new Map([
      ['https://example.com/pic1.jpg', 'https://picx.zhimg.com/v2-pic1.jpg'],
      ['https://example.com/pic2.png', 'https://picx.zhimg.com/v2-pic2.png']
    ]);
    const replaced = replaceZhihuImages(html, replacements);
    expect(replaced).toContain('<figure><img src="https://picx.zhimg.com/v2-pic1.jpg" alt="图1"/></figure>');
    expect(replaced).toContain('<figure><img src="https://picx.zhimg.com/v2-pic2.png" alt="图2"/></figure>');
    // 代码块内的内容不应被当作 img 标签替换掉
    expect(replaced).toContain('![示例伪图](https://example.com/pic1.jpg)');
  });

  it('文章字段验证：标题为空或超长、正文为空或超长', () => {
    const valid: Article = {
      id: 'test-1',
      title: '合规标题',
      markdown: '合规正文内容',
      tags: [],
      sourceUrl: 'https://juejin.cn/post/1'
    };
    expect(() => validateZhihuArticle(valid)).not.toThrow();

    expect(() => validateZhihuArticle({...valid, title: ' '})).toThrow('知乎文章标题不能为空');
    expect(() => validateZhihuArticle({...valid, title: 'a'.repeat(201)})).toThrow('知乎文章标题不能超过 200 个字符');
    expect(() => validateZhihuArticle({...valid, markdown: ' '})).toThrow('知乎文章正文不能为空');
  });

  it('严格安全白名单：剥离危险伪协议、style 属性、未知标签与嵌套注入', () => {
    const md = `
<div style="color:red; background:url(evil.com)" onclick="hack()">
  <span class="bad" id="test">内容</span>
</div>
<object data="malicious.swf"></object>
<svg onload="alert(1)"><circle cx="5" cy="5" r="5"/></svg>
<a href="javascript:void(0)">危险伪协议链接</a>
<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">Data 协议</a>
<img src="http://example.com/valid.png" alt="有效" style="display:none" onerror="evil()" />
`;
    const html = compileZhihuHtml(md);
    expect(html).not.toContain('<div');
    expect(html).not.toContain('style=');
    expect(html).not.toContain('onclick=');
    expect(html).not.toContain('<object');
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('data:text/html');
    expect(html).not.toContain('onerror=');
    expect(html).toContain('<span>内容</span>');
    expect(html).toContain('<figure><img src="http://example.com/valid.png" alt="有效"/></figure>');
  });

  it('公式支持：将块级和行内 LaTeX 正确转换为知乎专栏标准公式节点，且保护代码块中的美元符号', () => {
    const md = `
独立公式块：
$$
f(x) = \\int_{-\\infty}^\\infty \\hat f(\\xi)\\,e^{2 \\pi i \\xi x}\\,d\\xi
$$

行内公式：质能方程是 $E = mc^2$ 说明一切。转义字符 \\$100 保持原样。

\`\`\`bash
echo "$USER" and "$HOME"
\`\`\`
行内代码 \`$variable\` 不被转义。
`;
    const html = compileZhihuHtml(md);
    // 块级公式
    expect(html).toContain('<figure data-size="normal"><img class="eeimg" src="https://www.zhihu.com/equation?tex=');
    expect(html).toContain('data-formula="f(x) = \\int_{-\\infty}^\\infty');
    // 行内公式
    expect(html).toContain('<span class="ztext-math" data-eeimg="1" data-tex="E = mc^2"><img class="eeimg"');
    // 转义的美元符
    expect(html).toContain('$100');
    // 代码块内的 $ 保持原样
    expect(html).toContain('<code>echo &quot;$USER&quot; and &quot;$HOME&quot;</code>');
    expect(html).toContain('<code>$variable</code>');

    // 公式图片不应被当作外链图片收集
    const images = collectZhihuImages(html);
    expect(images.some(src => src.includes('zhihu.com/equation'))).toBe(false);
  });
});
