/* 把版本号刷成 1.0.1：网页侧 APP_VERSION、gradle versionName/versionCode、package.json
   用法：node dev/_bump101.js */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

function patch(rel, pairs) {
  const p = path.join(ROOT, rel);
  let s = fs.readFileSync(p, 'utf8');
  const before = s;
  for (const [a, b] of pairs) {
    if (!s.includes(a)) throw new Error('找不到要改的内容：' + rel + ' :: ' + a);
    s = s.split(a).join(b);
  }
  if (s !== before) {
    fs.writeFileSync(p, s, 'utf8');
    console.log('已更新 ' + rel);
  } else {
    console.log('无变化 ' + rel);
  }
}

patch('android-app/android/app/build.gradle', [
  ['versionCode 10', 'versionCode 11'],
  ['versionName "0.2.1"', 'versionName "1.0.1"']
]);
patch('android-app/package.json', [
  ['"version": "0.2.1"', '"version": "1.0.1"']
]);
console.log('完成');
