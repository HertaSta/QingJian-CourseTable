// 临时脚本：抽出 index.html 的内联 JS 做语法校验（不执行）
const fs = require('fs');
const path = process.argv[2];
const html = fs.readFileSync(path, 'utf8');
const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
let m, i = 0, bad = 0;
while ((m = re.exec(html))) {
  i++;
  const code = m[1];
  if (!code.trim()) continue;
  const line = html.slice(0, m.index).split('\n').length;
  try {
    new Function(code);
    console.log(`  块 #${i}（起于第 ${line} 行，${code.length} 字符）: OK`);
  } catch (e) {
    bad++;
    console.log(`  块 #${i}（起于第 ${line} 行）: 语法错误 -> ${e.message}`);
  }
}
console.log(bad ? `\n结果：${bad} 个块有语法错误` : `\n结果：${i} 个内联脚本块全部通过`);
process.exit(bad ? 1 : 0);
