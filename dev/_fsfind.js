/* 找出运行时残留的内联 font-size */
const { spawn } = require('child_process');
const os = require('os'), path = require('path');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9562;
const FILE = process.argv[2] || path.resolve(__dirname, '..', '清笺课程表.html');
const URL_ = 'file:///' + FILE.replace(/\\/g, '/').replace(/^\/?/, '');
const userDir = path.join(os.tmpdir(), 'edge-fs-' + process.pid + '-' + Date.now());
const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + userDir, URL_], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  let t = null;
  for (let i = 0; i < 80 && !t; i++) {
    try { const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json(); t = l.find(x => x.type === 'page' && x.webSocketDebuggerUrl); } catch (e) {}
    if (!t) await sleep(250);
  }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const waiters = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); } };
  const send = (me, p) => new Promise(r => { const i = ++id; waiters.set(i, r); ws.send(JSON.stringify({ id: i, method: me, params: p || {} })); });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result && r.result.exceptionDetails) return 'ERR:' + r.result.exceptionDetails.text; return r.result.result.value; };
  await send('Runtime.enable'); await send('Page.enable');
  await sleep(2500);
  console.log(await ev(`JSON.stringify(Array.from(document.querySelectorAll('[style*="font-size"]')).map(e => e.tagName + '#' + e.id + '.' + e.className + ' :: ' + e.getAttribute('style').slice(0,160)), null, 1)`));
  ws.close(); proc.kill(); process.exit(0);
})().catch(e => { console.error(e.message); try { proc.kill(); } catch (_) {} process.exit(1); });
