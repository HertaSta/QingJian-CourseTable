/* 安卓原生行为模拟测试
   在页面加载前注入一个假的 window.Capacitor（带一个内存版虚拟文件系统），验证：
   ① isNative() 判定       ② 导出走 Filesystem+Share 而不是 <a download>
   ③ 返回键分层处理        ④ 状态栏跟着主题色变
   ⑤ 数据持久化：localStorage 被系统回收后，能从 App 私有文件恢复
   ⑥ 选图走系统相册        ⑦ 检查更新：镜像优先下载 + 拉起系统安装器
   用法: node dev/native-test.js [url]
*/
const { spawn } = require('child_process');
const os = require('os'), path = require('path');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9338;
const URL_ = process.argv[2] || 'http://127.0.0.1:8765/%E6%B8%85%E7%AC%BA%E8%AF%BE%E7%A8%8B%E8%A1%A8.html';
const userDir = path.join(os.tmpdir(), 'edge-native-' + process.pid + '-' + Date.now());
const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + userDir, URL_], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const ok = [], bad = [];
function check(name, cond, extra) {
  (cond ? ok : bad).push(name);
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra != null ? '  → ' + extra : ''));
}

// 在页面里注入的假 Capacitor：带一个只存在于内存的虚拟文件系统（模拟 App 私有目录）
const FAKE = `
window.__calls = [];
window.__vfs = window.__vfs || {};
window.__pickReject = null;
// 1x1 的 jpeg，用来模拟「从系统相册选了一张图」
window.__pickB64 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/APn+iiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA//2Q==';
window.Capacitor = {
  isNativePlatform: function () { return true; },
  getPlatform: function () { return 'android'; },
  Plugins: {
    Filesystem: {
      writeFile: function (o) {
        window.__calls.push(['Filesystem.writeFile', o.path, o.directory, (o.data || '').length]);
        if (o.directory === 'DATA') window.__vfs[o.path] = o.data;
        return Promise.resolve({ uri: 'file:///data/' + (o.directory || 'CACHE') + '/' + o.path });
      },
      readFile: function (o) {
        window.__calls.push(['Filesystem.readFile', o.path, o.directory]);
        if (o.directory === 'DATA' && window.__vfs[o.path] != null) return Promise.resolve({ data: window.__vfs[o.path] });
        return Promise.reject(new Error('File does not exist'));
      },
      downloadFile: function (o) {
        var q = window.__dlQueue || [];
        var step = q.length ? q.shift() : { size: window.__dlSize || 0 };
        window.__calls.push(['Filesystem.downloadFile', o.url, o.path, o.directory]);
        window.__lastDlSize = step.size || 0;
        if (step.fail) return Promise.reject(new Error('镜像不可用'));
        return Promise.resolve({ path: 'file:///data/user/0/com.reiro.qingjian/cache/' + o.path });
      },
      stat: function (o) {
        window.__calls.push(['Filesystem.stat', o.path, o.directory]);
        return Promise.resolve({ size: window.__lastDlSize || 0 });
      },
      deleteFile: function (o) {
        window.__calls.push(['Filesystem.deleteFile', o.path, o.directory]);
        return Promise.resolve();
      },
      addListener: function (ev, cb) {
        window.__calls.push(['Filesystem.addListener', ev]);
        window.__lastProgressCb = cb;
        return Promise.resolve({ remove: function () { window.__calls.push(['Filesystem.removeListener', ev]); return Promise.resolve(); } });
      }
    },
    FileOpener: {
      open: function (o) {
        window.__calls.push(['FileOpener.open', o.filePath, o.contentType]);
        if (window.__openReject) return Promise.reject(new Error(window.__openReject));
        return Promise.resolve();
      }
    },
    Share: {
      share: function (o) {
        window.__calls.push(['Share.share', o.title, o.url]);
        return Promise.resolve({ activityType: 'android' });
      }
    },
    StatusBar: {
      setBackgroundColor: function (o) { window.__calls.push(['StatusBar.setBackgroundColor', o.color]); return Promise.resolve(); },
      setStyle: function (o) { window.__calls.push(['StatusBar.setStyle', o.style]); return Promise.resolve(); }
    },
    Camera: {
      pickImages: function (o) {
        window.__calls.push(['Camera.pickImages', o.limit, o.resultType]);
        if (window.__pickReject) return Promise.reject(new Error(window.__pickReject));
        return Promise.resolve({ photos: [{ format: 'jpeg', base64String: window.__pickB64 }] });
      }
    },
    App: {
      _ls: {},
      addListener: function (ev, cb) {
        window.__calls.push(['App.addListener', ev]);
        (this._ls[ev] = this._ls[ev] || []).push(cb);
        return { remove: function () {} };
      },
      exitApp: function () { window.__calls.push(['App.exitApp']); return Promise.resolve(); }
    }
  }
};
`;

(async () => {
  let t = null;
  for (let i = 0; i < 60 && !t; i++) {
    try { const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json(); t = l.find(x => x.type === 'page' && x.webSocketDebuggerUrl); } catch (e) {}
    if (!t) await sleep(250);
  }
  if (!t) throw new Error('连不上 DevTools');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const waiters = new Map(); const errs = []; let _loads = 0;
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.text + ' :: ' + ((m.params.exceptionDetails.exception || {}).description || ''));
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errs.push('[log] ' + m.params.entry.text);
    if (m.method === 'Page.loadEventFired') _loads++;
    if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
  };
  const send = (m, p) => new Promise(r => { const i = ++id; waiters.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  const evaluate = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return 'ERR:' + r.result.exceptionDetails.text;
    return r.result.result.value;
  };
  const pressBack = () => evaluate("(Capacitor.Plugins.App._ls.backButton||[]).forEach(function(f){f();}); 1");
  /* 等启动完成：轮询 app 自己挂的 __ready 标记，避免固定 sleep 抖动 */
  const waitReady = async (ms) => {
    const t0 = Date.now();
    while (Date.now() - t0 < (ms || 15000)) {
      if (await evaluate('window.__ready === true') === true) return true;
      await sleep(150);
    }
    return false;
  };
  /* 重新加载并等「新文档」就绪：reload 返回时导航可能还没开始，
     直接 waitReady 会读到旧文档残留的 __ready；先把它置 false 再等 loadEventFired。 */
  const reloadAndReady = async () => {
    const before = _loads;
    await evaluate('window.__ready = false; 1');
    await send('Page.reload');
    const t0 = Date.now();
    while (_loads === before && Date.now() - t0 < 8000) await sleep(50);
    return waitReady();
  };

  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE });
  await reloadAndReady();

  console.log('\n【1】原生环境识别');
  check('识破在安卓 App 里运行', await evaluate('isNative()') === true);
  check('给 <html> 打上 native-app 类', await evaluate("document.documentElement.classList.contains('native-app')") === true);
  const al = await evaluate("JSON.stringify(__calls.filter(c=>c[0]==='App.addListener'))");
  check('返回键监听已注册', /"backButton"/.test(al), al);
  check('前后台切换监听已注册', /"appStateChange"/.test(al), al);
  const sb1 = await evaluate("JSON.stringify(__calls.filter(c=>c[0].indexOf('StatusBar')===0))");
  check('状态栏按浅色主题着色（浅色浅底）', /StatusBar.setBackgroundColor","#f[0-9a-f]{5}/.test(sb1) && /StatusBar.setStyle","LIGHT/.test(sb1), sb1);

  console.log('\n【2】导出：必须走系统分享，而不是 <a download>');
  await evaluate("__calls.length=0; dl(new Blob(['hello 中文'],{type:'text/plain'}), '测试文件.txt'); 1");
  await sleep(400);
  const c2 = await evaluate("JSON.stringify(__calls)");
  check('调用了 Filesystem.writeFile', /Filesystem.writeFile","测试文件.txt","CACHE/.test(c2), c2);
  check('调用了 Share.share', /Share.share","测试文件.txt"/.test(c2));
  check('分享地址是 file:// 形式', /file:\/\/\/data\/CACHE\/测试文件.txt/.test(c2));

  console.log('\n【3】导出模板 / 备份 / 日历 / 图片 都走原生通道');
  // ICS 导出要求课表里至少有一门课，先塞一条
  await evaluate(`activeTable().courses = [{id:'x1',name:'测试课',teacher:'张老师',room:'A101',day:1,s:1,e:2,weeks:[1,2,3],color:'#0b8f86',note:''}];
    S.settings.periods = JSON.parse(JSON.stringify(DEFAULT_PERIODS)); S.settings.termStart='2026-09-07'; 1`);
  for (const [label, expr] of [
    ['下载导入模板', 'downloadTemplate()'],
    ['导出 JSON 备份', "dl(new Blob(['{}'],{type:'application/json'}),'清笺课程表备份_20261006.json')"],
    ['导出 ICS 日历', "exportICS()"],
    ['导出课表图片', 'exportPNG()']
  ]) {
    await evaluate("__calls.length=0; 1");
    await evaluate(expr + '; 1');
    await sleep(700);
    const c = await evaluate("JSON.stringify(__calls)");
    check(label + ' 走原生分享', /Filesystem.writeFile/.test(c) && /Share.share/.test(c), c.slice(0, 150));
  }

  console.log('\n【4】返回键分层处理');
  // ① 有弹层 → 关掉
  await evaluate("switchTab('sched'); openImport(); 1");
  await sleep(300);
  await pressBack();
  await sleep(300);
  check('有弹层时：先关弹层', await evaluate("document.querySelectorAll('#sheetImport.on').length") === 0);
  // ①-1 导入教程 → 先回导入界面，再按一次才关
  await evaluate("switchTab('sched'); openImport(); document.querySelector('#siTut').click(); 1");
  await sleep(300);
  check('教程已打开', await evaluate("document.querySelector('#sheetTutorial').classList.contains('on')") === true);
  await pressBack();
  await sleep(300);
  check('教程页：先退回导入界面', await evaluate("document.querySelector('#sheetImport').classList.contains('on')") === true &&
    await evaluate("document.querySelector('#sheetTutorial').classList.contains('on')") === false);
  await pressBack();
  await sleep(300);
  check('导入界面再按一次：关闭弹层', await evaluate("document.querySelectorAll('.sheet.on').length") === 0);
  // ①-2 二级设置页 → 先回设置列表，再按一次才关
  await evaluate("switchTab('me'); document.querySelector('#btnSettings').click(); 1");
  await sleep(300);
  await evaluate("document.querySelector('#sheetSettings .setlist .navrow[data-go=\"#sheetData\"]').click(); 1");
  await sleep(300);
  await pressBack();
  await sleep(300);
  check('二级设置页：先退回设置列表', await evaluate("document.querySelector('#sheetSettings').classList.contains('on')") === true &&
    await evaluate("document.querySelector('#sheetData').classList.contains('on')") === false);
  await pressBack();
  await sleep(300);
  check('设置列表再按一次：关闭弹层', await evaluate("document.querySelectorAll('.sheet.on').length") === 0);
  // ② 不在课表页 → 回课表页
  await evaluate("switchTab('me'); 1");
  await pressBack();
  await sleep(300);
  check('非课表页：回到课表页', await evaluate("S.view.tab") === 'sched');
  // ③ 当周不是本周 → 先回本周
  await evaluate("switchTab('sched'); S.view.week=9; renderAll(); 1");
  await evaluate("__calls.length=0; 1");
  await pressBack();
  await sleep(300);
  check('看别的周：先回本周', await evaluate("S.view.week") === (await evaluate('Math.max(1, nowWeek())')));
  check('回本周不会退出 App', await evaluate("__calls.filter(c=>c[0]==='App.exitApp').length") === 0);
  // ④ 再按一次 → 退出
  await evaluate("__calls.length=0; 1");
  await pressBack();
  await sleep(300);
  check('再按一次：退出 App', await evaluate("__calls.filter(c=>c[0]==='App.exitApp').length") === 1);

  console.log('\n【5】深色模式跟着切状态栏');
  await evaluate("__calls.length=0; S.global.dark=true; applyTheme(); 1");
  await sleep(250);
  const sb2 = await evaluate("JSON.stringify(__calls.filter(c=>c[0].indexOf('StatusBar')===0))");
  check('深色主题状态栏变深色', /StatusBar.setBackgroundColor","#0b1513/.test(sb2) && /StatusBar.setStyle","DARK/.test(sb2), sb2);
  await evaluate("S.global.dark=false; applyTheme(); 1");

  console.log('\n【6】数据持久化：localStorage 被系统回收后仍能恢复');
  await evaluate(`S.profile.nickname='回收测试'; S.profile.signature='sig-9';
    activeTable().name='回收测试表';
    activeTable().courses=[{id:'p1',name:'持久化课',teacher:'',room:'',day:2,s:3,e:4,weeks:[1],color:'#0b8f86',note:''}];
    save(); 1`);
  await sleep(1000);   // 等去抖 + 异步写入
  const c6 = await evaluate("JSON.stringify(__calls.filter(c=>c[0]==='Filesystem.writeFile'&&c[2]==='DATA'))");
  check('状态已写进 App 私有目录 DATA', /qingjian-state\.json","DATA/.test(c6), c6.slice(0, 170));
  const vfs = await evaluate('JSON.stringify(window.__vfs)');
  check('私有文件里确实有可恢复的数据', /qingjian-state\.json/.test(vfs) && vfs.length > 80);

  // 模拟：系统把 WebView 的 localStorage 回收掉，然后 App 重新启动
  await evaluate('localStorage.clear(); 1');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__vfs = ' + vfs + ';' });
  await reloadAndReady();
  check('重启后 localStorage 仍为空', await evaluate("localStorage.getItem('coursetable.v1')") === null);
  check('从私有文件恢复了昵称', await evaluate('S.profile.nickname') === '回收测试');
  check('从私有文件恢复了签名', await evaluate('S.profile.signature') === 'sig-9');
  check('从私有文件恢复了课表名', await evaluate('activeTable().name') === '回收测试表');
  check('从私有文件恢复了课程', await evaluate("activeTable().courses.length") === 1 && await evaluate("activeTable().courses[0].name") === '持久化课');

  /* ---------- 7. 选图走系统相册 ---------- */
  console.log('\n【7】选图：安卓调起系统相册，不弹文件管理');
  await evaluate("window.__inputClicks = 0; (function () { var c = HTMLInputElement.prototype.click; HTMLInputElement.prototype.click = function () { window.__inputClicks++; return c.apply(this, arguments); }; })(); 1");
  await evaluate("window.__pickReject = null; switchTab('me'); 1");
  await sleep(200);
  await evaluate("document.querySelector('#btnSettings').click(); 1");
  await sleep(350);
  await evaluate("document.querySelector('#sheetSettings .setlist .navrow[data-go=\"#sheetLook\"]').click(); 1");
  await sleep(350);
  check('进二级「外观」页', await evaluate("document.querySelector('#sheetLook').classList.contains('on')") === true);
  await evaluate("document.querySelector('#btnBgPick').click(); 1");
  await sleep(800);
  const pk1 = await evaluate("JSON.stringify((window.__calls || []).filter(function (c) { return c[0] === 'Camera.pickImages'; }))");
  check('点「从相册选择」调起系统相册', JSON.parse(pk1 || '[]').length >= 1, pk1);
  check('相册返回的图片被处理成背景图', await evaluate("!!S.global.bgImage") === true);
  check('走相册时不弹文件选择框', await evaluate('window.__inputClicks') === 0, String(await evaluate('window.__inputClicks')));

  await evaluate("S.global.bgImage = ''; window.__pickReject = 'User cancelled photos app'; document.querySelector('#btnBgPick').click(); 1");
  await sleep(500);
  check('在相册里取消 → 不弹文件选择框', await evaluate('window.__inputClicks') === 0, String(await evaluate('window.__inputClicks')));

  await evaluate("window.__pickReject = 'Not implemented on android'; document.querySelector('#btnBgPick').click(); 1");
  await sleep(500);
  check('插件不可用时回退到文件选择', await evaluate('window.__inputClicks') === 1, String(await evaluate('window.__inputClicks')));
  await evaluate("window.__pickReject = null; hideSheet(); 1");

  /* ---------- 8. 检查更新：原生下载 + 拉起系统安装器 ---------- */
  console.log('\n【8】检查更新：原生下载 + 拉起系统安装器');
  const APSIZE = 11798843;
  await evaluate(`window.__dlQueue=[]; window.__dlSize=` + APSIZE + `; window.__lastDlSize=0; window.__openReject=null;
    window.__fetchLog=[];
    window.fetch=function(u){ window.__fetchLog.push(String(u));
      return Promise.resolve({ ok:true, status:200, json:function(){ return Promise.resolve({
        tag_name:'v9.9.9',
        html_url:'https://github.com/HertaSta/QingJian-CourseTable/releases/tag/v9.9.9',
        body:'## 更新\\n\\n- 测试用说明',
        assets:[{ name:'QingJian-CourseTable-v9.9.9.apk', size:` + APSIZE + `,
                  browser_download_url:'https://github.com/HertaSta/QingJian-CourseTable/releases/download/v9.9.9/a.apk',
                  digest:'sha256:deadbeef' }] }); } });
    }; 1`);
  await evaluate("hideSheet(); switchTab('me'); showSheet('#sheetUpdate'); document.querySelector('#btnCheckUpdate').click(); 1");
  await sleep(600);
  check('安卓端能发现新版本', await evaluate('UPD.state') === 'found', await evaluate('UPD.state'));

  // ① 正常路径：镜像优先 → 下载 → 校验体积 → 拉起安装器
  await evaluate("__calls.length=0; window.__dlQueue=[]; document.querySelector('#btnDoUpdate').click(); 1");
  await sleep(800);
  const dl1 = JSON.parse(await evaluate("JSON.stringify(__calls.filter(function(c){return c[0]==='Filesystem.downloadFile';}))"));
  const st1 = await evaluate("JSON.stringify(__calls.filter(function(c){return c[0]==='Filesystem.stat';}))");
  const op1 = JSON.parse(await evaluate("JSON.stringify(__calls.filter(function(c){return c[0]==='FileOpener.open';}))"));
  check('走原生 Filesystem 下载', dl1.length === 1, JSON.stringify(dl1));
  check('下载优先走镜像而不是直连', dl1[0][1].indexOf(await evaluate('UPDATE_MIRRORS[0]')) === 0, dl1[0][1]);
  check('下载到 CACHE 目录', dl1[0][3] === 'CACHE' && /qingjian-update\.apk$/.test(dl1[0][2]), dl1[0][2] + '/' + dl1[0][3]);
  check('下载后按体积核对', /\"CACHE\"/.test(st1), st1);
  check('拉起系统安装器', op1.length === 1 && op1[0][2] === 'application/vnd.android.package-archive', JSON.stringify(op1));
  check('交给安装器的是下载到的文件', /qingjian-update\.apk$/.test(op1[0][1]), op1[0][1]);
  check('安装完成后状态置为 ready', await evaluate('UPD.state') === 'ready', await evaluate('UPD.state'));
  const pl1 = await evaluate("JSON.stringify(__calls.filter(function(c){return c[0]==='Filesystem.addListener'||c[0]==='Filesystem.removeListener';}))");
  check('下载时注册进度监听、结束后注销', /progress/.test(pl1) && /removeListener/.test(pl1), pl1);
  await evaluate("window.__lastProgressCb && window.__lastProgressCb({bytes: 5899421, contentLength: 11798843}); 1");
  check('进度事件换算成百分比', await evaluate('UPD.progress') === 50, String(await evaluate('UPD.progress')));

  // ② 镜像坏了 / 拿到错误页 → 自动换下一个源
  await evaluate(`__calls.length=0; window.__dlQueue=[{fail:true},{size:512},{size:` + APSIZE + `}];
    document.querySelector('#btnDoUpdate').click(); 1`);
  await sleep(900);
  const dl2 = JSON.parse(await evaluate("JSON.stringify(__calls.filter(function(c){return c[0]==='Filesystem.downloadFile';}))"));
  const del2 = await evaluate("__calls.filter(function(c){return c[0]==='Filesystem.deleteFile';}).length");
  const op2 = await evaluate("__calls.filter(function(c){return c[0]==='FileOpener.open';}).length");
  check('第一个源失败会自动换下一个', dl2.length === 3, '尝试了 ' + dl2.length + ' 个地址');
  check('逐个源按顺序回退', dl2[0][1].indexOf(await evaluate('UPDATE_MIRRORS[0]')) === 0
    && dl2[1][1].indexOf(await evaluate('UPDATE_MIRRORS[1]')) === 0, dl2.map(d => d[1]).join('\n    '));
  check('体积不符视为失败并删掉半包', del2 === 1, 'deleteFile ' + del2 + ' 次');
  check('换源后仍能装成功', op2 === 1 && await evaluate('UPD.state') === 'ready');

  // ③ 全部源都失败 → 状态回退到 found，不误拉安装器
  await evaluate(`__calls.length=0; window.__dlSize=0; UPD.state='found';
    window.__dlQueue=new Array(UPDATE_MIRRORS.length + 1).fill({fail:true});
    document.querySelector('#btnDoUpdate').click(); 1`);
  await sleep(1000);
  check('所有源都失败时状态回到 found', await evaluate('UPD.state') === 'found', await evaluate('UPD.state'));
  check('失败时不误拉安装器', await evaluate("__calls.filter(function(c){return c[0]==='FileOpener.open';}).length") === 0);
  check('失败原因写进 UPD.error', (await evaluate('String(UPD.error)')).length > 0, await evaluate('String(UPD.error)'));

  await evaluate("hideSheet(); 1");

  console.log('\n【9】运行期错误');
  const real = errs.filter(e => !/favicon|net::ERR_FILE|Failed to load resource/i.test(e));
  check('无脚本异常', real.length === 0, real.slice(0, 3).join(' | '));

  console.log('\n========== 结果：' + ok.length + ' 通过 / ' + bad.length + ' 失败 ==========');
  if (bad.length) console.log('失败项：\n  ' + bad.join('\n  '));
  try { proc.kill(); } catch (e) {}
  ws.close();
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('测试异常：', e.message); try { proc.kill(); } catch (_) {} process.exit(1); });
