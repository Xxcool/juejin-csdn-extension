// 知乎专栏文章内容编译器：将掘金 Markdown 转换为知乎草稿接口接受的 HTML 结构。
import {Marked,Renderer} from 'marked';
import {normalizeMarkdown} from './csdn-api';
import {resolveMermaidDiagram} from '../core/mermaid-render';
import {SyncError} from '../core/diagnostic';
import type {Article} from '../types';

export function escapeHtml(value:string){
  return value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
}

export function validateZhihuArticle(article:Article){
  const titleLength=article.title.trim().length;
  if(!titleLength)throw new SyncError('知乎文章标题不能为空','content','validation');
  if(titleLength>200)throw new SyncError('知乎文章标题不能超过 200 个字符','content','validation');
  if(!article.markdown.trim())throw new SyncError('知乎文章正文不能为空','content','validation');
  if(article.markdown.length>5_000_000)throw new SyncError('知乎文章正文不能超过 5000000 个字符','content','validation');
}

/** 允许的富文本安全标签白名单 */
const ALLOWED_TAGS = new Set([
  'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'pre', 'code', 'strong', 'b', 'em', 'i',
  'u', 'del', 's', 'sub', 'sup', 'span', 'mark',
  'ul', 'ol', 'li', 'table', 'tbody', 'thead', 'tr', 'th', 'td',
  'a', 'img', 'figure', 'figcaption'
]);

/** 彻底安全清洗原始 HTML：采用严格的标签白名单和属性白名单，杜绝 XSS、恶意样式及伪协议。 */
export function sanitizeZhihuRawHtml(raw: string): string {
  if (!raw) return '';

  // 1. 彻底删除已知高危标签及其内部包含的所有内容
  let clean = raw.replace(/<(script|style|iframe|object|embed|applet|svg|math|form|input|button|select|textarea|link|meta|base)\b[\s\S]*?<\/\1>/gi, '');
  // 自闭合高危标签
  clean = clean.replace(/<(link|meta|base|input)\b[^>]*\/?>/gi, '');

  // 2. 逐标签净化
  return clean.replace(/<\/?([a-z0-9_-]+)\b([^>]*)>/gi, (fullTag, rawTagName: string, rawAttrs: string) => {
    const isClosing = fullTag.startsWith('</');
    const tagName = rawTagName.toLowerCase();

    // 不在白名单内的未知或危险标签直接剥离
    if (!ALLOWED_TAGS.has(tagName)) {
      return '';
    }

    if (isClosing) {
      return `</${tagName}>`;
    }

    // 白名单标签的属性过滤
    if (tagName === 'a') {
      const hrefMatch = rawAttrs.match(/\bhref=["']([^"']*)["']/i);
      const href = hrefMatch ? hrefMatch[1].trim() : '';
      if (/^https?:\/\//i.test(href)) {
        return `<a href="${escapeHtml(href)}">`;
      }
      return '<a>';
    }

    if (tagName === 'img') {
      const srcMatch = rawAttrs.match(/\bsrc=["']([^"']*)["']/i);
      const altMatch = rawAttrs.match(/\balt=["']([^"']*)["']/i);
      const src = srcMatch ? srcMatch[1].trim() : '';
      const alt = altMatch ? altMatch[1] : '';
      if (/^(?:https?:\/\/|data:image\/)/i.test(src)) {
        return `<figure><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"/></figure>`;
      }
      return '';
    }

    if (tagName === 'ol') {
      const startMatch = rawAttrs.match(/\bstart=["']?(\d+)["']?/i);
      return startMatch ? `<ol start="${startMatch[1]}">` : '<ol>';
    }

    if (tagName === 'pre') {
      const langMatch = rawAttrs.match(/\blang=["']([a-z0-9_-]+)["']/i);
      return langMatch ? `<pre lang="${escapeHtml(langMatch[1])}">` : '<pre>';
    }

    if (tagName === 'table') {
      return `<table data-draft-node="block" data-draft-type="table" data-size="normal">`;
    }

    // 其余标签一律剥离所有属性（无 style、无 on* 事件）
    return `<${tagName}>`;
  });
}

/** 构建知乎专栏标准块级公式节点 */
export function buildZhihuBlockEquation(tex: string): string {
  const cleanTex = tex.trim();
  const encoded = encodeURIComponent(cleanTex);
  const escaped = escapeHtml(cleanTex);
  return `<figure data-size="normal"><img class="eeimg" src="https://www.zhihu.com/equation?tex=${encoded}" alt="${escaped}" data-formula="${escaped}" data-eeimg="1"/></figure>`;
}

/** 构建知乎专栏标准行内公式节点 */
export function buildZhihuInlineEquation(tex: string): string {
  const cleanTex = tex.trim();
  const encoded = encodeURIComponent(cleanTex);
  const escaped = escapeHtml(cleanTex);
  return `<span class="ztext-math" data-eeimg="1" data-tex="${escaped}"><img class="eeimg" src="https://www.zhihu.com/equation?tex=${encoded}" alt="${escaped}" data-formula="${escaped}" data-eeimg="1"/></span>`;
}

export function compileZhihuHtml(markdown:string,options?:{mermaidImages?:Map<string,string>}):string{
  // 暂存代码和公式字面量，防止 HTML 清洗或 markdown 转换篡改
  const literals:string[]=[];
  const preserveLiteral=(html:string)=>`%%ZHIHU_LITERAL_${literals.push(html)-1}%%`;

  let text = normalizeMarkdown(markdown);

  // 1. 保护代码块（包括 Mermaid 代码块与普通 pre 代码块）
  text = text.replace(/(?:^|\n)(```|~~~)([^\n]*)\n([\s\S]*?)\n\1/g, (_match, _fence, langStr, code) => {
    const lang = (langStr || '').trim();
    const {isDiagram,renderCode} = resolveMermaidDiagram(lang, code);
    if(isDiagram){
      const imageUrl=options?.mermaidImages?.get(renderCode);
      if(imageUrl){
        return '\n\n' + preserveLiteral(`<figure><img src="${escapeHtml(imageUrl)}" alt="Mermaid 图表"/></figure>`) + '\n\n';
      }
      throw new SyncError('Mermaid 图表缺少渲染图片，已停止生成缺图正文','content','content');
    }
    const language=lang.split(/\s+/)[0]||'';
    const langAttr=language?` lang="${escapeHtml(language)}"`:'';
    return '\n\n' + preserveLiteral(`<pre${langAttr}><code>${escapeHtml(code)}</code></pre>`) + '\n\n';
  });

  // 2. 保护行内代码
  text = text.replace(/`([^`\n]+)`/g, (_match, inlineCode) => {
    return preserveLiteral(`<code>${escapeHtml(inlineCode)}</code>`);
  });

  // 3. 提取块级数学公式 $$ ... $$
  text = text.replace(/(?:^|\n)\$\$\s*([\s\S]+?)\s*\$\$(?:\n|$)/g, (_match, tex) => {
    return '\n\n' + preserveLiteral(buildZhihuBlockEquation(tex)) + '\n\n';
  });

  // 4. 提取行内数学公式 $...$（避免价格等 \$ 转义或单纯的 $1 变量）
  // 匹配非转义的 $，两边非空格，中间不跨换行
  text = text.replace(/(?<!\\)\$(?!\s)([^\$\n]+?)(?<!\s)\$(?!\d)/g, (_match, tex) => {
    return preserveLiteral(buildZhihuInlineEquation(tex));
  });

  // 5. 还原转义的 \$ 字符
  text = text.replace(/\\\$/g, '$');

  const renderer=new Renderer();

  renderer.heading=function({tokens,depth}){
    const text=this.parser.parseInline(tokens);
    const validDepth=Math.min(Math.max(depth,1),6);
    return`<h${validDepth}>${text}</h${validDepth}>`;
  };

  renderer.paragraph=function({tokens}){
    return`<p>${this.parser.parseInline(tokens)}</p>`;
  };

  renderer.blockquote=function({tokens}){
    return`<blockquote>${this.parser.parse(tokens)}</blockquote>`;
  };

  renderer.strong=function({tokens}){
    return`<strong>${this.parser.parseInline(tokens)}</strong>`;
  };

  renderer.em=function({tokens}){
    return`<em>${this.parser.parseInline(tokens)}</em>`;
  };

  renderer.del=function({tokens}){
    return`<del>${this.parser.parseInline(tokens)}</del>`;
  };

  renderer.link=function({tokens,href}){
    const target=(href||'').trim();
    const label=this.parser.parseInline(tokens);
    if(/^https?:\/\//i.test(target)){
      return`<a href="${escapeHtml(target)}">${label}</a>`;
    }
    return label;
  };

  renderer.image=function({href,text}){
    return`<figure><img src="${escapeHtml(href)}" alt="${escapeHtml(text||'')}"/></figure>`;
  };

  renderer.hr=function(){
    return'<hr/>';
  };

  renderer.list=function(token){
    const tag=token.ordered?'ol':'ul';
    const start=token.ordered&&token.start&&token.start!==1?` start="${token.start}"`:'';
    let body='';
    for(let i=0;i<token.items.length;i++)body+=this.listitem(token.items[i]);
    return`<${tag}${start}>${body}</${tag}>`;
  };

  renderer.listitem=function(item){
    let content='';
    if(item.tokens){
      content=item.tokens.map(token=>{
        if(token.type==='text'||token.type==='paragraph'){
          return token.tokens?this.parser.parseInline(token.tokens):escapeHtml(token.text||'');
        }
        return this.parser.parse([token]);
      }).join('');
    }else{
      content=escapeHtml(item.text||'');
    }
    return`<li>${content}</li>`;
  };

  renderer.table=function(token){
    const cell=(item:(typeof token.header)[number])=>{
      const tag=item.header?'th':'td';
      return`<${tag}>${this.parser.parseInline(item.tokens)}</${tag}>`;
    };
    const headerRow=`<tr>${token.header.map(cell).join('')}</tr>`;
    const bodyRows=token.rows.map(row=>`<tr>${row.map(cell).join('')}</tr>`).join('');
    return`<table data-draft-node="block" data-draft-type="table" data-size="normal"><tbody>${headerRow}${bodyRows}</tbody></table>`;
  };

  renderer.tablerow=function({text}){return`<tr>${text}</tr>`;};
  renderer.tablecell=function(token){
    const tag=token.header?'th':'td';
    return`<${tag}>${this.parser.parseInline(token.tokens)}</${tag}>`;
  };

  renderer.html=function({text}){
    return sanitizeZhihuRawHtml(text);
  };

  const marked=new Marked({renderer,gfm:true,breaks:false});
  let parsed = marked.parse(text) as string;

  // 移除 marked 自动给独立块级占位符包裹的多余 <p> 标签
  parsed = parsed.replace(/<p>\s*(%%ZHIHU_LITERAL_\d+%%)\s*<\/p>/g, '$1');

  // 还原字面量（代码块与公式）
  parsed = parsed.replace(/%%ZHIHU_LITERAL_(\d+)%%/g, (_match, index) => {
    return literals[Number(index)] || '';
  });

  return parsed;
}

/** 收集知乎 HTML 中包含的所有图片地址（自动跳过知乎官方公式图和本域 CDN 图）。 */
export function collectZhihuImages(html:string):string[]{
  const matches=[...html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gi)];
  return[...new Set(matches.map(m=>m[1].replace(/&amp;/g,'&')))].filter(src => {
    try {
      if (/^data:image\//i.test(src)) return true;
      const hostname = new URL(src).hostname.toLowerCase();
      if (hostname.endsWith('zhihu.com') || hostname.endsWith('zhimg.com')) {
        return false;
      }
    } catch {}
    return true;
  });
}

/** 替换知乎 HTML 中的图片地址为转存后的知乎 CDN 地址。 */
export function replaceZhihuImages(html:string,replacements:Map<string,string>):string{
  return html.replace(/(<img\b[^>]*\bsrc=")([^"]+)(")/gi,(match,prefix,source,suffix)=>{
    const normalizedSrc=source.replace(/&amp;/g,'&');
    const target=replacements.get(normalizedSrc);
    return target?`${prefix}${escapeHtml(target)}${suffix}`:match;
  });
}
