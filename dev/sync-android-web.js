/* 把交付用的单文件「清笺课程表.html」同步到安卓壳工程的 www/index.html
   用法: node dev/sync-android-web.js
   改完 index.html 后要依次跑： build-single.js  →  sync-android-web.js  →  cap sync android */
const fs = require('fs');
const path = require('path');

const DIR = 'D:/项目归档/CourseTable';
const src = path.join(DIR, '清笺课程表.html');
const wwwDir = path.join(DIR, 'android-app', 'www');
const dst = path.join(wwwDir, 'index.html');

if (!fs.existsSync(src)) {
  console.error('!! 找不到 ' + src + '，先跑 build-single.js');
  process.exit(1);
}
const html = fs.readFileSync(src, 'utf8');
if (/<script[^>]*\ssrc=/.test(html)) {
  console.error('!! 单文件里还有外部 script 引用，安卓 WebView 会加载失败');
  process.exit(1);
}
fs.mkdirSync(wwwDir, { recursive: true });
fs.writeFileSync(dst, html, 'utf8');
console.log('已同步 -> ' + dst + '  (' + (Buffer.byteLength(html) / 1024).toFixed(0) + ' KB)');
