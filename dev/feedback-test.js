/* 意见反馈专项验收：关于页入口 → 反馈面板 → 邮箱展示 / 复制 / 邮件调起 / 隐私政策同步
   用法：先起 http 服务（python -m http.server 8765），再 node dev/feedback-test.js */
const { spawn } = require('child_process');
const os = require('os'), path = require('path');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9351;
const URL_ = process.argv[2] || 'http://127.0.0.1:8765/index.html';
const MAIL = 'nangongshuo33@gmail.com';
const userDir = path.join(os.tmpdir(), 'edge-fb-' + process.pid + '-' + Date.now());
const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + userDir, URL_], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const ok = [], bad = [];
function check(name, cond, extra) {
  (cond ? ok : bad).push(name);
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra != null ? '  ' + extra : ''));
}

(async () => {
  let t = null;
  for (let i = 0; i < 60 && !t; i++) {
    try { const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json(); t = l.find(x => x.type === 'page' && x.webSocketDebuggerUrl); } catch (e) {}
    if (!t) await sleep(250);
  }
  if (!t) throw new Error('连不上 DevTools');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const waiters = new Map(); const errs = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.text);
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errs.push('[log] ' + m.params.entry.text);
    if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
  };
  const send = (m, p) => new Promise(r => { const i = ++id; waiters.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  const evaluate = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return 'ERR:' + r.result.exceptionDetails.text;
    return r.result.result.value;
  };
  const js = async src => await evaluate('(function(){' + src + '})()');

  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  /* 等 app 自己挂的 __ready 标记，别用固定 sleep——页面没跑完时断言会全假失败 */
  const waitReady = async (ms) => {
    const t0 = Date.now();
    while (Date.now() - t0 < (ms || 15000)) {
      if (await evaluate('window.__ready === true') === true) return true;
      await sleep(120);
    }
    return false;
  };
  const ready = await waitReady();
  if (!ready) { console.error('页面未就绪'); proc.kill(); process.exit(1); }
  await sleep(300);

  console.log('\n【1】关于页出现「意见反馈」入口');
  await js('try{hideSheet()}catch(e){}; renderAbout(); showSheet("#sheetAbout");');
  await sleep(300);
  const hasEntry = await js('return !!document.querySelector("#btnFeedback")');
  check('存在 #btnFeedback', hasEntry === true);
  const entryText = await js('var e=document.querySelector("#btnFeedback"); return e? e.textContent.trim() : ""');
  check('入口文案含「意见反馈」', /意见反馈/.test(entryText), entryText);
  /* 首启会自动弹导入面板，中途可能把 sheet 抢走，所以「打开 + 判定」放在同一次求值里 */
  const aboutOn = await js('try{hideSheet()}catch(e){}; renderAbout(); showSheet("#sheetAbout"); return document.querySelector("#sheetAbout").classList.contains("on")');
  check('关于面板已展开', aboutOn === true);

  console.log('\n【2】点进去打开反馈面板');
  await js('document.querySelector("#btnFeedback").click();');
  await sleep(350);
  const fbOn = await js('return document.querySelector("#sheetFeedback").classList.contains("on")');
  check('#sheetFeedback 已展开', fbOn === true);
  const aboutOff = await js('return !document.querySelector("#sheetAbout").classList.contains("on")');
  check('同时只显示一层（关于已让位）', aboutOff === true);
  const mailText = await js('return document.querySelector("#fbMailText").textContent.trim()');
  check('邮箱地址正确', mailText === MAIL, mailText);
  const verText = await js('return document.querySelector("#fbVer").textContent.trim()');
  check('版本号已回填', verText === '0.1.7', verText);
  const repoText = await js('return document.querySelector("#fbRepoUrl").textContent.trim()');
  check('仓库地址已回填', /github\.com\/HertaSta\/QingJian-CourseTable/.test(repoText), repoText);
  const backBtn = await js('return document.querySelector("#sheetFeedback .sh-head .ibtn[data-back]").dataset.back');
  check('返回按钮指回关于', backBtn === '#sheetAbout', backBtn);

  console.log('\n【3】邮件调起与复制');
  const mailto = await js('return fbMailto()');
  check('mailto 指向开发者邮箱', String(mailto).indexOf('mailto:' + MAIL + '?') === 0, String(mailto).slice(0, 46));
  check('主题带版本号', /subject=.*0\.1\.7/.test(String(mailto)));
  check('正文不带课程数据', !/course|课表数据|tables/i.test(decodeURIComponent(String(mailto))));
  await js('document.querySelector("#btnFbCopy").click();');
  await sleep(250);
  const toastTxt = await js('return document.querySelector("#toast").textContent');
  check('复制后有提示且含邮箱', /nangongshuo33@gmail\.com/.test(toastTxt), toastTxt);

  console.log('\n【4】隐私政策同步');
  await js('renderPrivacy();');
  await sleep(200);
  const pv = await js('return document.querySelector("#pvBody").textContent');
  check('隐私政策含开发者邮箱', pv.indexOf(MAIL) >= 0);
  check('最后更新已改成 10 月 29 日', /2026 年 10 月 29 日/.test(pv));
  check('联网说明改为三个功能', /会联网的功能只有三个/.test(pv));

  console.log('\n【5】运行期错误');
  check('无未捕获异常', errs.length === 0, errs.slice(0, 2).join(' | ') || '(无)');

  console.log('\n通过 ' + ok.length + ' / 失败 ' + bad.length);
  if (bad.length) console.log('失败项：' + bad.join('、'));
  ws.close(); proc.kill();
  try { require('fs').rmSync(userDir, { recursive: true, force: true }); } catch (e) {}
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('测试异常：', e.message); proc.kill(); process.exit(1); });
