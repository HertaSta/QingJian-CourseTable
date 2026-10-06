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

// 「检查更新」截图用的假响应：让页面以为 GitHub 上发布了更高的 v0.1.4
// （当前 App 版本是 0.1.3，这里必须比它高，否则页面会显示「已是最新」）
const REL = {
  tag_name: 'v0.1.4',
  name: 'v0.1.4',
  body: '## 本次更新\n\n- 设置面板拆成二级分类，一级列表直接显示当前状态\n- 课程块按块高自适应字号，课程名与上课地点优先完整显示\n- 新增「检查更新」，可选国内镜像下载并安装',
  html_url: 'https://github.com/HertaSta/QingJian-CourseTable/releases/tag/v0.1.4',
  assets: [{
    name: 'QingJian-CourseTable-v0.1.4.apk',
    browser_download_url: 'https://github.com/HertaSta/QingJian-CourseTable/releases/download/v0.1.4/QingJian-CourseTable-v0.1.4.apk',
    size: 11795000
  }]
};
const STUB_FETCH = 'window.fetch=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve(' +
  JSON.stringify(REL) + ');}});};';

const OPEN_UPDATE = 'showSheet("#sheetSettings"); document.querySelectorAll("#sheetSettings .setlist .navrow")[4].click(); ' +
  STUB_FETCH + ' document.querySelector("#btnCheckUpdate").click();';

const SHOTS = [
  { name: '01_课表',        js: 'hideSheet(); switchTab("sched"); S.view.week=3; renderAll();' },
  { name: '02_课程详情',    js: 'switchTab("sched"); openDetail(S.courses.find(c=>c.name.indexOf("会计信息")<0).id);' },
  { name: '03_日程',        js: 'hideSheet(); switchTab("today");' },
  { name: '04_学习',        js: 'switchTab("learn");' },
  { name: '05_我的',        js: 'hideSheet(); switchTab("me");' },
  { name: '06_导入向导',    js: 'hideSheet(); switchTab("sched"); openImport();' },
  { name: '07_导入三选项',  js: 'hideSheet(); (function(){var P=JSON.parse(JSON.stringify(DEFAULT_PERIODS));IMP={kind:"biggrid",result:{courses:S.courses.slice(0,12),notes:[],meta:{school:S.settings.school,student:S.settings.student,semester:"2026-2027-1",className:S.settings.className},periods:P}};showImportConfirm();})()' },
  { name: '08_导入教程',    js: 'hideSheet(); openImport(); document.querySelector("#siTut").click();' },
  { name: '09_个人资料',    js: 'hideSheet(); switchTab("me"); openProfile();' },
  { name: '10_切换课程表',  js: 'hideSheet(); openTables();' },
  { name: '11_自定义背景',  js: 'hideSheet(); (function(){var c=document.createElement("canvas");c.width=c.height=160;var g=c.getContext("2d");var gr=g.createLinearGradient(0,0,160,160);gr.addColorStop(0,"#0b8f86");gr.addColorStop(.45,"#27b98b");gr.addColorStop(1,"#8ed06a");g.fillStyle=gr;g.fillRect(0,0,160,160);g.globalAlpha=.35;g.fillStyle="#fff";g.beginPath();g.arc(120,40,46,0,7);g.fill();g.beginPath();g.arc(30,130,60,0,7);g.fill();S.global.bgImage=c.toDataURL("image/jpeg",.9);S.global.bgDim=42;save();applyBackground();switchTab("sched");renderAll();})()' },
  { name: '12_我的',        js: 'hideSheet(); switchTab("me"); S.global.bgImage=""; applyBackground();' },
  { name: '13_设置弹层',    js: 'hideSheet(); switchTab("me"); document.querySelector("#btnSettings").click();' },
  { name: '14_二级_学期与节次', js: 'document.querySelectorAll("#sheetSettings .setlist .navrow")[0].click();' },
  { name: '15_二级_外观',   js: 'showSheet("#sheetSettings"); document.querySelectorAll("#sheetSettings .setlist .navrow")[1].click(); var p=document.querySelector("#themePalette"); if(p) p.scrollIntoView({block:"center"});' },
  { name: '16_二级_数据',   js: 'showSheet("#sheetSettings"); document.querySelectorAll("#sheetSettings .setlist .navrow")[3].click();' },
  { name: '17_二级_检查更新', js: OPEN_UPDATE, wait: 2600 },
  { name: '18_关于与隐私',  js: 'showSheet("#sheetSettings"); document.querySelectorAll("#sheetSettings .setlist .navrow")[5].click();' },
  { name: '19_隐私政策',    js: 'document.querySelector("#btnPrivacy").click();' },
  { name: '20_课表深色',    js: 'hideSheet(); S.global.dark=true; applyTheme(); S.view.week=3; switchTab("sched"); renderAll();' },
  { name: '21_当周无课',    js: 'S.global.dark=false; applyTheme(); S.view.week=17; renderAll();' },
  { name: '22_主题色_海天',  js: 'hideSheet(); S.global.theme={preset:"haixia",a:"#2b6fd6",b:"#38b6d9",c:"#7fd6c9"}; applyTheme(); switchTab("sched"); S.view.week=3; renderAll();' },
  { name: '23_主题色_琥珀',  js: 'hideSheet(); S.global.theme={preset:"hupo",a:"#c2701c",b:"#e1a02b",c:"#f0cf6b"}; applyTheme(); switchTab("sched"); S.view.week=3; renderAll();' }
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

  let id = 0; const waiters = new Map(); let _loads = 0;
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Page.loadEventFired') _loads++;
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
  /* 等新文档加载完（Page.reload 返回时导航可能还没开始，见 feature-test 注释） */
  const beforeLoads = _loads;
  await send('Runtime.evaluate', { expression: 'window.__ready = false; 1', returnByValue: true });
  await send('Page.reload', { ignoreCache: false });
  { const t0 = Date.now(); while (_loads === beforeLoads && Date.now() - t0 < 8000) await sleep(50); }
  for (let i = 0; i < 80; i++) {
    const r = await send('Runtime.evaluate', { expression: 'window.__ready === true', returnByValue: true });
    if (r.result && r.result.result && r.result.result.value === true) break;
    await sleep(150);
  }
  await sleep(400);

  const errs = await send('Runtime.evaluate', { expression: 'String(window.__bootError||"")', returnByValue: true });
  console.log('页面内错误:', errs.result && errs.result.result && errs.result.result.value || '(无)');

  for (const s of SHOTS) {
    const r = await send('Runtime.evaluate', { expression: s.js, returnByValue: true, awaitPromise: false });
    if (r.result && r.result.exceptionDetails) {
      const d = r.result.exceptionDetails;
      const msg = (d.exception && (d.exception.description || d.exception.value)) || d.text || '';
      console.log('  [动作异常]', s.name, String(msg).split('\n')[0]);
    }
    await sleep(s.wait || 600);
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
