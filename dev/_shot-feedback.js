/* 一次性截图：设置 → 关于 → 意见反馈 面板
   用法：先起 http 服务，再 node dev/_shot-feedback.js [输出路径] */
const { spawn } = require('child_process');
const os = require('os'), path = require('path'), fs = require('fs');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9361;
const OUT = process.argv[2] || path.join(__dirname, '..', '_shot_反馈面板.png');
const userDir = path.join(os.tmpdir(), 'edge-shotfb-' + process.pid);
const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + userDir,
  'http://127.0.0.1:8765/index.html'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let t = null;
  for (let i = 0; i < 60 && !t; i++) {
    try { const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json(); t = l.find(x => x.type === 'page' && x.webSocketDebuggerUrl); } catch (e) {}
    if (!t) await sleep(250);
  }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const w = new Map();
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && w.has(m.id)) { w.get(m.id)(m); w.delete(m.id); } };
  const send = (m, p) => new Promise(r => { const i = ++id; w.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  const ev = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    return r.result && r.result.exceptionDetails ? 'ERR' : r.result.result.value;
  };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  for (let i = 0; i < 100; i++) { if (await ev('window.__ready===true') === true) break; await sleep(120); }
  /* 首启会自动弹「导入课程表」，等它弹完再抢回镜头，否则截到的是导入面板 */
  await sleep(2200);
  await ev('try{hideSheet()}catch(e){}; try{renderAbout()}catch(e){}; try{renderFeedback()}catch(e){}; showSheet("#sheetFeedback"); 1');
  await sleep(900);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
  console.log('已截图 ->', OUT);
  ws.close(); proc.kill();
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (e) {}
  process.exit(0);
})().catch(e => { console.error(e.message); proc.kill(); process.exit(1); });
