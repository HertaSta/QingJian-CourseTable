/* 用真实 Excel 走一遍 handleFile → doImport → buildICS，导出一份 .ics 供 verify-ics.py 做格式核对（不触发真实下载）。
   用法：node dev/make-ics.js <页面URL> <Excel路径> [输出路径]  —— 需先起 http.server。 */
const { spawn } = require('child_process');
const os = require('os'), path = require('path'), fs = require('fs');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9371;
const URL_ = process.argv[2] || 'http://127.0.0.1:8765/index.html';
const XLSX_FILE = process.argv[3];
const OUT = process.argv[4] || path.join(__dirname, '..', '_real_out.ics');
const userDir = path.join(os.tmpdir(), 'edge-mkics-' + process.pid + '-' + Date.now());
const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + userDir, URL_], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let t = null;
  for (let i = 0; i < 60 && !t; i++) {
    try { const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json(); t = l.find(x => x.type === 'page' && x.webSocketDebuggerUrl); } catch (e) {}
    if (!t) await sleep(250);
  }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const waiters = new Map(); let _loads = 0;
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Page.loadEventFired') _loads++;
    if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
  };
  const send = (m, p) => new Promise(r => { const i = ++id; waiters.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  const ev = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return 'ERR:' + r.result.exceptionDetails.text;
    return r.result.result.value;
  };
  await send('Runtime.enable'); await send('Page.enable');
  const before = _loads;
  await ev('window.__ready = false; 1');
  await send('Page.reload');
  { const t0 = Date.now(); while (_loads === before && Date.now() - t0 < 8000) await sleep(50); }
  for (let i = 0; i < 100; i++) { if (await ev('window.__ready === true') === true) break; await sleep(120); }

  const b64 = fs.readFileSync(XLSX_FILE).toString('base64');
  await ev(`(function(){var s=atob(${JSON.stringify(b64)});var u=new Uint8Array(s.length);for(var i=0;i<s.length;i++)u[i]=s.charCodeAt(i);
    handleFile(new File([u],'t.xlsx'));return 1;})()`);
  await sleep(1200);
  // 走「覆盖当前」把解析结果落进当前课表，再合成 ics 文本
  await ev("IMP.mode='replace'; doImport(); 1");
  await sleep(1200);
  const r = await ev("(function(){var o=buildICS();window.__icsText=o.text;return o.events;})()");
  const text = await ev('window.__icsText');
  fs.writeFileSync(OUT, text, 'utf8');
  console.log('已生成', OUT, '事件数 =', r, '字节 =', Buffer.byteLength(text, 'utf8'));
  ws.close(); proc.kill(); process.exit(0);
})();
