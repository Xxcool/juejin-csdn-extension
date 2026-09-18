import { build } from 'esbuild';
import fs from 'node:fs/promises';
const watch = process.argv.includes('--watch');
const release = process.argv.includes('--release');
await fs.rm('dist', { recursive: true, force: true });
await fs.mkdir('dist', { recursive: true });
await Promise.all(['manifest.json','rules.json','LICENSE','assets/logo.svg','assets/logo-16.png','assets/logo-32.png','assets/logo-48.png','assets/logo-128.png','assets/platform-csdn.png','assets/platform-wechat.png','src/popup.html','src/popup.css','src/juejin-content.css'].map(async file => fs.copyFile(file, `dist/${file.split('/').pop()}`)));
const options={entryPoints:{background:'src/background.ts','juejin-page':'src/juejin-page.ts','juejin-content':'src/juejin-content.ts',popup:'src/popup.ts'},bundle:true,format:'esm',target:'chrome120',outdir:'dist',sourcemap:!release};
if(watch){const {context}=await import('esbuild');const ctx=await context(options);await ctx.watch();console.log('Watching…');}else{await build(options);console.log('Built dist/');}
