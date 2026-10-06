/* 用 CDP 精确模拟手机视口截图（Edge 在本机有最小窗口宽度，--window-size 不可靠） */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9333;
const URL_ = process.argv[2] || 'http://127.0.0.1:8765/_demo.html';
const OUT = process.argv[3] || 'D:/项目归档/CourseTable';
const DPR = 3, VW = 390, VH = 844;

const SHOTS = [
  { name: '01_课表',        js: 'hideSheet(); switchTab("sched"); S.view.week=3; renderAll();' },
  { name: '02_课程详情',    js: 'switchTab("sched"); openDetail(S.courses.find(c=>c.name.indexOf("会计信息")<0).id);' },
  { name: '03_日程',        js: 'hideSheet(); switchTab("today");' },
  { name: '04_学习',        js: 'switchTab("learn");' },
  { name: '05_我的',        js: 'hideSheet(); switchTab("me");' },
  { name: '06_导入向导',    js: 'hideSheet(); switchTab("sched"); openImport();' },
  { name: '07_导入三选项',  js: 'hideSheet(); (function(){var P=JSON.parse(JSON.stringify(DEFAULT_PERIODS));IMP={kind:"biggrid",result:{courses:S.courses.slice(0,12),notes:[],meta:{school:S.settings.school,student:S.settings.student,semester:"2026-2027-1",className:S.settings.className},periods:P}};showImportConfirm();})()' },
  { name: '08_个人资料',    js: 'hideSheet(); switchTab("me"); openProfile();' },
  { name: '09_切换课程表',  js: 'hideSheet(); openTables();' },
  { name: '10_自定义背景',  js: 'hideSheet(); (function(){var c=document.createElement("canvas");c.width=c.height=160;var g=c.getContext("2d");var gr=g.createLinearGradient(0,0,160,160);gr.addColorStop(0,"#0b8f86");gr.addColorStop(.45,"#27b98b");gr.addColorStop(1,"#8ed06a");g.fillStyle=gr;g.fillRect(0,0,160,160);g.globalAlpha=.35;g.fillStyle="#fff";g.beginPath();g.arc(120,40,46,0,7);g.fill();g.beginPath();g.arc(30,130,60,0,7);g.fill();S.global.bgImage=c.toDataURL("image/jpeg",.9);S.global.bgDim=42;save();applyBackground();switchTab("sched");renderAll();})()' },
  { name: '11_我的',        js: 'hideSheet(); switchTab("me"); S.global.bgImage=""; applyBackground();' },
  { name: '12_设置弹层',    js: 'document.querySelector("#btnSettings").click(); document.querySelector("#sheetSettings").querySelector(".sh-body").scrollTop=0;' },
  { name: '13_关于与隐私',  js: 'document.querySelector("#sheetSettings").querySelector(".sh-body").scrollTop=99999;' },
  { name: '14_隐私政策',    js: 'document.querySelector("#btnPrivacy").click();' },
  { name: '15_课表深色',    js: 'hideSheet(); S.global.dark=true; applyTheme(); S.view.week=3; switchTab("sched"); renderAll();' },
  { name: '16_当周无课',    js: 'S.global.dark=false; applyTheme(); S.view.week=17; renderAll();' },
  { name: '17_主题色',      js: 'hideSheet(); switchTab("me"); document.querySelector("#btnSettings").click(); var p=document.querySelector("#themePalette"); if(p) p.scrollIntoView({block:"center"});' },
  { name: '18_主题色_海天',  js: 'hideSheet(); S.global.theme={preset:"haixia",a:"#2b6fd6",b:"#38b6d9",c:"#7fd6c9"}; applyTheme(); switchTab("sched"); S.view.week=3; renderAll();' },
  { name: '19_主题色_琥珀',  js: 'hideSheet(); S.global.theme={preset:"hupo",a:"#c2701c",b:"#e1a02b",c:"#f0cf6b"}; applyTheme(); switchTab("sched"); S.view.week=3; renderAll();' }
];

const userDir = path.join(os.tmpdir(), 'edge-shot-' + process.pid + '-' + Date.now());
const proc = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + userDir,
  '--hide-scrollbars', URL_
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getPageTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const list = await r.json();
      const p = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (p) return p;
    } catch (e) {}
    await sleep(250);
  }
  throw new Error('没等到 DevTools 端口');
}

(async () => {
  const target = await getPageTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let id = 0; const waiters = new Map();
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
  };
  const send = (method, params) => new Promise(res => {
    const i = ++id; waiters.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params: params || {} }));
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: VW, height: VH, deviceScaleFactor: DPR, mobile: true,
    screenOrientation: { type: 'portraitPrimary', angle: 0 }
  });
  await send('Page.reload', { ignoreCache: false });
  await sleep(2500);

  const errs = await send('Runtime.evaluate', { expression: 'String(window.__bootError||"")', returnByValue: true });
  console.log('页面内错误:', errs.result && errs.result.result && errs.result.result.value || '(无)');

  for (const s of SHOTS) {
    const r = await send('Runtime.evaluate', { expression: s.js, returnByValue: true, awaitPromise: false });
    if (r.result && r.result.exceptionDetails) console.log('  [动作异常]', s.name, JSON.stringify(r.result.exceptionDetails.text || ''));
    await sleep(600);
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const buf = Buffer.from(shot.result.data, 'base64');
    const f = path.join(OUT, 'shot_' + s.name + '.png');
    fs.writeFileSync(f, buf);
    console.log('  ✓ ' + f + '  (' + (buf.length / 1024).toFixed(0) + 'KB)');
  }

  ws.close();
  proc.kill();
  process.exit(0);
})().catch(e => { console.error('失败:', e.message); try { proc.kill(); } catch (_) {} process.exit(1); });
