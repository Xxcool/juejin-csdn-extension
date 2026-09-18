// 微信公众号内容编译器：将掘金 Markdown 重新渲染为微信编辑器可稳定保存的内联样式 HTML。
import {Marked,Renderer} from 'marked';
import {normalizeMarkdown} from './csdn-api';

const COLORS={text:'#2b2b2b',muted:'#666666',accent:'#1d6744',border:'#dfe6e2',soft:'#f5f7f6',code:'#f6f8fa'};

function escapeHtml(value:string){return value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));}

/** 普通正文使用内联样式；代码块保留微信编辑器专用的结构和 class。 */
export function compileWechatHtml(markdown:string){
  // 仅处理解析后的 HTML 节点，不修改围栏代码与行内代码中的标签示例。
  const references:string[]=[];
  const renderer=new Renderer();
  renderer.heading=function({tokens,depth}){
    const text=this.parser.parseInline(tokens);
    if(depth===1)return`<h1 style="margin:32px 0 16px;font-size:24px;line-height:1.45;color:${COLORS.text};font-weight:700;">${text}</h1>`;
    if(depth===2)return`<h2 style="margin:30px 0 14px;padding-left:12px;border-left:4px solid ${COLORS.accent};font-size:21px;line-height:1.5;color:${COLORS.text};font-weight:700;">${text}</h2>`;
    return`<h3 style="margin:24px 0 12px;font-size:18px;line-height:1.55;color:${COLORS.text};font-weight:700;">${text}</h3>`;
  };
  renderer.paragraph=function({tokens}){return`<p style="margin:16px 0;font-size:16px;line-height:1.8;color:${COLORS.text};letter-spacing:0.02em;">${this.parser.parseInline(tokens)}</p>`;};
  renderer.blockquote=function({tokens}){return`<blockquote style="margin:20px 0;padding:12px 16px;border-left:4px solid ${COLORS.accent};background:${COLORS.soft};color:${COLORS.muted};">${this.parser.parse(tokens)}</blockquote>`;};
  renderer.code=function({text,lang}){
    // 按微信“插入代码”样本逐行输出 code/leaf，不能用一个 code 包住整段正文。
    const lines=text.replace(/\r\n?/g,'\n').split('\n').map(line=>{
      let column=0;
      const expanded=Array.from(line).map(char=>{
        if(char==='\t'){const width=4-column%4;column+=width;return' '.repeat(width);}
        column++;return char;
      }).join('');
      return`<code><span leaf="">${escapeHtml(expanded).replace(/ /g,'&nbsp;')||'&nbsp;'}</span></code>`;
    }).join('');
    // 围栏后可附带标题等元信息，仅首个标记是语言；未标注时不猜测语言。
    const language=lang?.trim().split(/\s+/)[0]||'';
    const normalizedLanguage=({js:'javascript',ts:'typescript'} as Record<string,string>)[language]||language;
    return`<section class="code-snippet__js"><pre class="code-snippet__js code-snippet code-snippet_nowrap" data-lang="${escapeHtml(normalizedLanguage)}" data-layout-id="null">${lines}</pre></section>`;
  };
  renderer.codespan=function({text}){return`<code style="padding:2px 5px;border-radius:3px;background:${COLORS.code};color:#c7254e;font-size:0.9em;font-family:Menlo,Consolas,monospace;">${escapeHtml(text)}</code>`;};
  renderer.strong=function({tokens}){return`<strong style="font-weight:700;color:${COLORS.text};">${this.parser.parseInline(tokens)}</strong>`;};
  renderer.em=function({tokens}){return`<em style="font-style:italic;">${this.parser.parseInline(tokens)}</em>`;};
  renderer.del=function({tokens}){return`<span style="text-decoration:line-through;color:${COLORS.muted};">${this.parser.parseInline(tokens)}</span>`;};
  renderer.link=function({tokens,href}){
    let number=references.indexOf(href)+1;
    if(!number)number=references.push(href);
    return`<span style="color:${COLORS.accent};text-decoration:underline;">${this.parser.parseInline(tokens)}</span><sup>[${number}]</sup>`;
  };
  renderer.image=function({href,text}){return`<p style="margin:22px 0;text-align:center;"><img src="${escapeHtml(href)}" alt="${escapeHtml(text)}" style="display:block;max-width:100%;height:auto;margin:0 auto;" /></p>`;};
  renderer.hr=function(){return`<hr style="margin:28px 0;border:0;border-top:1px solid ${COLORS.border};" />`;};
  renderer.list=function(token){
    const tag=token.ordered?'ol':'ul';
    const start=token.ordered&&token.start&&token.start!==1?` start="${token.start}"`:'';
    let body='';
    for(let i=0;i<token.items.length;i++)body+=this.listitem(token.items[i]);
    return`<${tag}${start} style="margin:16px 0;padding-left:2em;color:${COLORS.text};">${body}</${tag}>`;
  };
  renderer.listitem=function(item){const content=item.tokens?this.parser.parse(item.tokens):escapeHtml(item.text||'');return`<li style="margin:8px 0;font-size:16px;line-height:1.75;">${content}</li>`;};
  renderer.table=function(token){
    const cell=(item:(typeof token.header)[number])=>{const tag=item.header?'th':'td';const background=item.header?`background:${COLORS.soft};font-weight:700;`:'';return`<${tag} style="padding:8px 10px;border:1px solid ${COLORS.border};${background}text-align:${item.align||'left'};">${this.parser.parseInline(item.tokens)}</${tag}>`;};
    const header=`<tr>${token.header.map(cell).join('')}</tr>`;
    const body=token.rows.map(row=>`<tr>${row.map(cell).join('')}</tr>`).join('');
    return`<section style="margin:20px 0;overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:14px;line-height:1.6;"><thead>${header}</thead><tbody>${body}</tbody></table></section>`;
  };
  renderer.tablerow=function({text}){return`<tr>${text}</tr>`;};
  renderer.tablecell=function(token){const tag=token.header?'th':'td';const background=token.header?`background:${COLORS.soft};font-weight:700;`:'';return`<${tag} style="padding:8px 10px;border:1px solid ${COLORS.border};${background}text-align:${token.align||'left'};">${this.parser.parseInline(token.tokens)}</${tag}>`;};
  renderer.html=function({text}){
    // 原始 HTML 不透传属性；图片只保留地址，其余标签保留可见文本。
    const safe=text.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi,'');
    return safe.split(/(<img\b[^>]*>)/gi).map(part=>{
      const src=part.match(/^<img\b[^>]*\bsrc=["']([^"']+)["']/i)?.[1];
      if(src)return`<img src="${escapeHtml(src.replace(/&amp;/g,'&'))}" style="display:block;max-width:100%;height:auto;margin:22px auto;" />`;
      return escapeHtml(part.replace(/<[^>]*>/g,''));
    }).join('');
  };
  const marked=new Marked({renderer,gfm:true,breaks:false});
  const html=marked.parse(normalizeMarkdown(markdown));
  const footnotes=references.length?`<section style="margin-top:28px;font-size:13px;word-break:break-all;"><p>参考链接</p>${references.map((url,index)=>`<p>[${index+1}] ${escapeHtml(url)}</p>`).join('')}</section>`:'';
  return`<section style="margin:0 6px;font-size:16px;line-height:1.8;color:${COLORS.text};word-break:break-word;">${html}${footnotes}</section>`;
}

export function collectWechatImageUrls(html:string){
  return[...new Set([...html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gi)].map(match=>match[1].replace(/&amp;/g,'&')))];
}

export function replaceWechatImageUrls(html:string,replacements:Map<string,string>){
  return html.replace(/(<img\b[^>]*\bsrc=")([^"]+)(")/gi,(match,prefix,source,suffix)=>{
    const target=replacements.get(source.replace(/&amp;/g,'&'));
    return target?`${prefix}${escapeHtml(target)}${suffix}`:match;
  });
}
