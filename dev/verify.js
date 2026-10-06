/* 验收：单独打开「清笺课程表.html」，确认零报错、首屏弹出导入向导、核心函数就绪 */
const { spawn } = require('child_process');
const os = require('os'), path = require('path');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9334;
const URL_ = process.argv[2] || 'http://127.0.0.1:8765/%E8%AF%BE%E7%A8%8B%E8%A1%A8.html';
const userDir = path.join(os.tmpdir(), 'edge-verify-profile');
const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + userDir, URL_], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

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
    if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.text + ' :: ' + (m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || ''));
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errs.push('[log] ' + m.params.entry.text);
    if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
  };
  const send = (m, p) => new Promise(r => { const i = ++id; waiters.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.reload'); await sleep(2500);

  const ev = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r.result && r.result.exceptionDetails) return 'ERR:' + r.result.exceptionDetails.text;
    return r.result.result.value;
  };
  console.log('XLSX 库加载   :', await ev('typeof XLSX'));
  console.log('版本         :', await ev('XLSX && XLSX.version'));
  console.log('核心函数      :', await ev('[typeof analyze, typeof doImport, typeof renderAll, typeof exportPNG].join(",")'));
  console.log('导入向导已弹出 :', await ev('document.querySelector("#sheetImport").classList.contains("on")'));
  console.log('底部导航项数  :', await ev('document.querySelectorAll(".tab").length'));
  console.log('课表网格已渲染 :', await ev('document.querySelectorAll("#gridBody .dcol").length + " 天列 / " + document.querySelectorAll("#gridBody .tcell").length + " 节"'));
  console.log('内置节次      :', await ev('S.settings.periods.map(p=>p.n+":"+p.start+"-"+p.end).join(" ")'));
  console.log('localStorage  :', await ev('(()=>{try{localStorage.setItem("__t","1");const v=localStorage.getItem("__t");localStorage.removeItem("__t");return v==="1"?"可用（数据能存住）":"读写异常"}catch(e){return "不可用："+e.name}})()'));
  console.log('运行期错误    :', errs.length ? '\n  ' + errs.join('\n  ') : '(无)');
  ws.close(); proc.kill(); process.exit(0);
})().catch(e => { console.error('失败:', e.message); try { proc.kill(); } catch (_) {} process.exit(1); });
