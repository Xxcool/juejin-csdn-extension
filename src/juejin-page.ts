// 掘金页面主世界桥接：读取编辑器实例中的原始 Markdown，避免从可视 DOM 拼接正文。
const READ_EDITOR_EVENT='article-ferry:read-editor';
const SNAPSHOT_ATTRIBUTE='data-article-ferry-editor';

type CodeMirrorElement=HTMLElement&{CodeMirror?:{getValue():string}};

function editorSnapshot(){
  const titleInput=document.querySelector<HTMLInputElement>('input[placeholder*="文章标题"],textarea[placeholder*="文章标题"]');
  const codeMirror=document.querySelector<CodeMirrorElement>('.CodeMirror')?.CodeMirror;
  const textarea=document.querySelector<HTMLTextAreaElement>('.CodeMirror textarea,textarea.bytemd-hidden');
  const markdown=codeMirror?.getValue()||textarea?.value||'';
  const draftId=location.pathname.match(/\/editor\/drafts\/(\d+)/)?.[1]||'';
  return{title:titleInput?.value.trim()||'',markdown,draftId,sourceUrl:location.href};
}

document.addEventListener(READ_EDITOR_EVENT,()=>{
  document.documentElement.setAttribute(SNAPSHOT_ATTRIBUTE,JSON.stringify(editorSnapshot()));
});
