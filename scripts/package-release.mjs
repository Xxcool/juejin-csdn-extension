// 生成可供 GitHub Release 下载的 Chrome 扩展 ZIP，压缩包根目录直接包含 manifest.json。
import fs from 'node:fs';
import path from 'node:path';
import {ZipArchive} from 'archiver';

const packageJson=JSON.parse(fs.readFileSync('package.json','utf8'));
const manifest=JSON.parse(fs.readFileSync('dist/manifest.json','utf8'));
if(packageJson.version!==manifest.version)throw new Error('package.json 与 manifest.json 版本不一致');

fs.mkdirSync('release',{recursive:true});
const target=path.resolve('release',`article-ferry-v${manifest.version}.zip`);
const output=fs.createWriteStream(target);
const archive=new ZipArchive({zlib:{level:9}});
const completed=new Promise((resolve,reject)=>{
  output.on('close',resolve);
  output.on('error',reject);
  archive.on('error',reject);
});
archive.pipe(output);
archive.directory('dist',false);
await archive.finalize();
await completed;
console.log(`Created ${target} (${archive.pointer()} bytes)`);
