/* 把 xlsx 解析库内联进 HTML，产出可单文件分发/上传的 清笺课程表.html
   用法: node build-single.js                                     */
const fs = require('fs');
const path = require('path');

const DIR = 'D:/项目归档/CourseTable';
const src = path.join(DIR, 'index.html');
const lib = path.join(DIR, 'xlsx.full.min.js');
const out = path.join(DIR, '清笺课程表.html');

let html = fs.readFileSync(src, 'utf8');
const js = fs.readFileSync(lib, 'utf8');

const TAG = '<script src="xlsx.full.min.js"></script>';
if (html.indexOf(TAG) < 0) { console.error('!! 没找到外链 script 标签，index.html 结构可能变了'); process.exit(1); }
if (js.indexOf('</script') >= 0) { console.error('!! 库里含 </script，需转义后再内联'); process.exit(1); }

// 关键：必须用「函数形式」的替换。
// 若直接传字符串，库源码里的 $& / $` / $' 会被当成反向引用展开，
// 把整段 HTML 和 script 标签注入到库代码中间，导致 <script> 被提前截断。
html = html.replace(TAG, () => '<script>\n' + js + '\n</script>');

// 自检：内联后全文件应当只剩 2 组 script 标签，且不再引用外部文件
const openTags = (html.match(/<script/g) || []).length;
const closeTags = (html.match(/<\/script>/g) || []).length;
const extern = (html.match(/<script[^>]*\ssrc=/g) || []).length;
if (openTags !== 2 || closeTags !== 2 || extern !== 0) {
  console.error('!! 内联自检未通过：<script=' + openTags + ' </script>=' + closeTags + ' 外链=' + extern);
  process.exit(1);
}

fs.writeFileSync(out, html, 'utf8');

const kb = (fs.statSync(out).size / 1024).toFixed(0);
console.log('已生成: ' + out + '  (' + kb + ' KB)');
