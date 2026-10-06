/* 复现：课程块内容溢出 / 显示不完整。用真实 Excel 走 App 自己的解析器，然后量化每个课程块。 */
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9339;
const URL_ = process.argv[2] || 'http://127.0.0.1:8765/index.html';
const XLSX_FILE = process.argv[3] || process.env.COURSE_XLSX || '';
const WEEK = +(process.argv[4] || 5);
if (!XLSX_FILE) {
  console.error('用法：node dev/_repro.js <index.html 地址> <课程表.xlsx> [周次]');
  console.error('例：  node dev/_repro.js http://127.0.0.1:8765/index.html ./我的课表.xlsx 3');
  console.error('课程表路径也可以改用环境变量 COURSE_XLSX 传入。');
  process.exit(1);
}
const OUTDIR = path.join(__dirname, '_bugshots');

const userDir = path.join(os.tmpdir(), 'edge-repro-' + process.pid + '-' + Date.now());
const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + userDir, '--hide-scrollbars', URL_], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let target = null;
  for (let i = 0; i < 80 && !target; i++) {
    try { const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
          target = l.find(t => t.type === 'page' && t.webSocketDebuggerUrl); } catch (e) {}
    if (!target) await sleep(250);
  }
  if (!target) throw new Error('连不上 DevTools');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const waiters = new Map(); const errs = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text);
    if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
  };
  const send = (method, params) => new Promise(r => { const i = ++id; waiters.set(i, r); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return 'ERR:' + r.result.exceptionDetails.text;
    return r.result.result.value;
  };

  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 406, height: 904, deviceScaleFactor: 3, mobile: true,
    screenOrientation: { type: 'portraitPrimary', angle: 0 } });
  await send('Page.reload', {});
  await sleep(2500);

  const b64 = fs.readFileSync(XLSX_FILE).toString('base64');
  await ev(`(function(){var s=atob(${JSON.stringify(b64)});var u=new Uint8Array(s.length);for(var i=0;i<s.length;i++)u[i]=s.charCodeAt(i);
    handleFile(new File([u],'t.xlsx'));return 1;})()`);
  await sleep(1200);

  // 导入确认页截图
  let shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUTDIR, 'repro_00_import.png'), Buffer.from(shot.result.data, 'base64'));

  await ev(`IMP.mode='replace'; doImport(); switchTab('sched'); S.view.week=${WEEK}; renderAll(); 1`);
  await sleep(900);

  // 解析结果总览
  const dump = await ev(`JSON.stringify(S.courses.map(c=>({d:c.day,s:c.s,e:c.e,n:c.name,r:c.room,t:c.teacher,w:c.weeks&&c.weeks.length})),null,0)`);
  console.log('=== 解析出的课程 (' + JSON.parse(dump).length + ' 门) ===');
  JSON.parse(dump).forEach(c => console.log(`  周${c.d} ${c.s}-${c.e}节 | 名:${c.n} | 室:${c.r} | 师:${c.t} | 周数:${c.w}`));

  // 量化每个课程块：内容是否超出块高、子元素是否被压缩、末行是否被裁
  const CHECK = `(function(){
    var out=[], bad=0;
    [].slice.call(document.querySelectorAll('#gridBody .cc')).forEach(function(el){
      var cb=el.getBoundingClientRect();
      var cs=getComputedStyle(el);
      var pt=parseFloat(cs.paddingTop), pb=parseFloat(cs.paddingBottom);
      var kids=[].slice.call(el.children);
      var R=function(x){return {t:x.getBoundingClientRect().top,b:x.getBoundingClientRect().bottom,h:x.getBoundingClientRect().height};};
      var first=R(kids[0]), last=R(kids[kids.length-1]);
      var spill=0;
      // .nm / .rn 是 -webkit-line-clamp 元素，scrollHeight>clientHeight 属正常（行尾省略号）；
      // 只检查不参与 clamp 的容器，它们一旦溢出就会把末行切半。
      kids.forEach(function(k){
        if (k.classList.contains('nm')) return;
        spill=Math.max(spill, k.scrollHeight - k.clientHeight);
      });
      var topOK = first.t >= cb.top + pt - 0.6;
      var botOK = last.b <= cb.bottom - pb + 0.6;
      var nm=el.querySelector('.nm'), rm=el.querySelector('.rm'), tc=el.querySelector('.tc');
      var ok = topOK && botOK && spill<=1.5;   // 1.5px 内属小数行高取整，不会碰到字的墨迹
      if(!ok) bad++;
      out.push({ ok:ok, h:Math.round(cb.height*100)/100,
        nm: nm?nm.textContent:null, nmH: nm?Math.round(nm.getBoundingClientRect().height*100)/100:0,
        nmLines:nm?nm.style.webkitLineClamp:null,
        rc: el.querySelector('.rc')?el.querySelector('.rc').textContent:null,
        rn: el.querySelector('.rn')?el.querySelector('.rn').textContent:null,
        rnClamp: el.querySelector('.rn')?el.querySelector('.rn').style.webkitLineClamp:null,
        rnH: rm?Math.round(rm.getBoundingClientRect().height*100)/100:null,
        tc: tc?tc.textContent:null,
        topSlack: Math.round((first.t-(cb.top+pt))*100)/100,
        botSlack: Math.round(((cb.bottom-pb)-last.b)*100)/100,
        spill: Math.round(spill*100)/100, topOK:topOK, botOK:botOK });
    });
    return JSON.stringify({bad:bad, total:out.length, items:out});
  })()`;
  async function checkBlocks(label) {
    const m = JSON.parse(await ev(CHECK));
    console.log('\n=== ' + label + '：' + m.total + ' 块，异常 ' + m.bad + ' 块 ===');
    m.items.forEach(b => {
      const f = b.ok ? '✓' : '❌';
      console.log(`  ${f} 块高${b.h} 名「${b.nm}」名行${b.nmLines}(实高${b.nmH}) | 房号「${b.rc}」| 房间名「${b.rn}」限${b.rnClamp}行(实高${b.rnH}) | 师「${b.tc}」`);
      if (!b.ok) console.log(`       上留${b.topSlack} 下留${b.botSlack} 内部溢出${b.spill} topOK=${b.topOK} botOK=${b.botOK}`);
    });
    return m;
  }
  await checkBlocks('默认字号');

  // 把字体整体放大到 1.3 倍（模拟系统字号调大 / WebView 文本缩放），再验一次
  await ev(`(function(){var s=document.createElement('style');s.id='zzScale';
    s.textContent='.cc .nm{font-size:13.65px}.cc .rm{font-size:11.05px}.cc .tc{font-size:11.7px}';
    document.head.appendChild(s); renderAll(); return 1;})()`);
  await sleep(500);
  const sc = await checkBlocks('字体放大 1.3 倍');
  const shot3 = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUTDIR, 'repro_02_bigfont.png'), Buffer.from(shot3.result.data, 'base64'));
  await ev(`document.getElementById('zzScale').remove(); renderAll(); 1`);
  await sleep(300);

  const shot2 = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUTDIR, 'repro_01_grid.png'), Buffer.from(shot2.result.data, 'base64'));
  console.log('\n截图: dev/_bugshots/repro_01_grid.png');
  if (errs.length) console.log('页面异常:', errs.slice(0, 3).join(' | '));
  ws.close(); proc.kill(); process.exit(0);
})().catch(e => { console.error('失败:', e.message); try { proc.kill(); } catch (_) {} process.exit(1); });
