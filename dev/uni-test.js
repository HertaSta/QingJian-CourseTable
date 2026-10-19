/* 通用教务导入（多校适配）测试
   覆盖两件事：
   ① 桥协议 fidelity：assets/uniimport/bridge_init.js 注入页面后，
      window.shiguangBridgePromise / shiguangBridge 发出的消息格式
      必须和拾光课程表一致（否则社区脚本跑不起来），且 Native 回调能正确 resolve/reject。
   ② 数据落地：uniApply() 把脚本回传的课程转成课表结构，走统一的「确认导入」面板后落库。

   用法: node dev/uni-test.js [url]
*/
const { spawn } = require('child_process');
const os = require('os'), path = require('path'), fs = require('fs');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9340;
const URL_ = process.argv[2] || 'http://127.0.0.1:8765/%E6%B8%85%E7%AC%BA%E8%AF%BE%E7%A8%8B%E8%A1%A8.html';
const BRIDGE_SRC = fs.readFileSync(path.join(__dirname, '..', 'android-app', 'android', 'app', 'src', 'main', 'assets', 'uniimport', 'bridge_init.js'), 'utf8');
const userDir = path.join(os.tmpdir(), 'edge-uni-' + process.pid + '-' + Date.now());
const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + userDir, URL_], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const ok = [], bad = [];
function check(name, cond, extra) {
  (cond ? ok : bad).push(name);
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra != null ? '  → ' + extra : ''));
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
    if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.text + ' :: ' + ((m.params.exceptionDetails.exception || {}).description || ''));
    if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
  };
  const send = (m, p) => new Promise(r => { const i = ++id; waiters.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  const evaluate = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return 'ERR:' + r.result.exceptionDetails.text;
    return r.result.result.value;
  };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  const waitReady = async (ms) => {
    const t0 = Date.now();
    while (Date.now() - t0 < (ms || 12000)) {
      if (await evaluate('window.__ready === true') === true) return true;
      await sleep(120);
    }
    return false;
  };
  await waitReady();
  await sleep(700);
  await evaluate(`hideSheet(); 1`);

  /* ============================================================
     ① 桥协议 fidelity
     ============================================================ */
  console.log('\n【1】桥协议（bridge_init.js）');

  // 先装一个假的 Native 管道，再把桥脚本注进页面
  await evaluate(`window.__nativeMsgs = [];
    window._shiguangNativeBridge = { postMessage: function (m) { window.__nativeMsgs.push(m); } }; 1`);
  await evaluate(BRIDGE_SRC);

  check('桥对象已挂载', await evaluate("typeof window.shiguangBridgePromise === 'object' && typeof window.shiguangBridge === 'object'"));
  check('旧版兼容接口也挂载了', await evaluate("typeof window.AndroidBridgePromise === 'object' && typeof window.AndroidBridge === 'object'"));

  // showAlert
  await evaluate("window.__p = window.shiguangBridgePromise.showAlert('课表导入','请先登录','开始导入'); 1");
  let msg = JSON.parse(await evaluate("window.__nativeMsgs[window.__nativeMsgs.length-1]"));
  check('showAlert 消息格式', msg.action === 'showAlert' && !!msg.callbackId, JSON.stringify(msg).slice(0, 90));
  const alertCb = msg.callbackId;
  check('showAlert payload 字段', (() => { try { const p = JSON.parse(msg.payload); return p.titleText === '课表导入' && p.contentText === '请先登录' && p.confirmText === '开始导入'; } catch (e) { return false; } })());
  await evaluate("window._shiguangNativeCallback('" + alertCb + "', true, true); 1");
  check('showAlert 确认后 resolve true', await evaluate("window.__p.then(v => 'resolved:' + v)") === 'resolved:true');
  await evaluate("window.__p2 = window.shiguangBridgePromise.showAlert('t','c','ok'); 1");
  await evaluate("window._shiguangNativeCallback('" + JSON.parse(await evaluate("window.__nativeMsgs[window.__nativeMsgs.length-1]")).callbackId + "', true, false); 1");
  check('showAlert 取消后 resolve false', await evaluate("window.__p2.then(v => 'resolved:' + v)") === 'resolved:false');

  // showSingleSelection
  await evaluate("window.__p3 = window.shiguangBridgePromise.showSingleSelection('选择学年学期', JSON.stringify(['2025-2026-1','2026-2027-1']), 1); 1");
  msg = JSON.parse(await evaluate("window.__nativeMsgs[window.__nativeMsgs.length-1]"));
  check('showSingleSelection 消息格式', msg.action === 'showSingleSelection' && !!msg.callbackId);
  check('showSingleSelection 默认项', (() => { try { const p = JSON.parse(msg.payload); return p.defaultSelectedIndex === 1 && JSON.parse(p.itemsJsonString)[0] === '2025-2026-1'; } catch (e) { return false; } })());
  await evaluate("window._shiguangNativeCallback('" + msg.callbackId + "', true, 0); 1");
  check('showSingleSelection 返回下标 0', await evaluate("window.__p3.then(v => 'resolved:' + v)") === 'resolved:0');

  // saveImportedCourses
  const sampleCourses = JSON.stringify([{ name: '高等数学', teacher: '张老师', position: 'A101', day: 1, startSection: 1, endSection: 2, weeks: [1, 2, 3] }]);
  await evaluate("window.__p4 = window.shiguangBridgePromise.saveImportedCourses(" + JSON.stringify(sampleCourses) + "); 1");
  msg = JSON.parse(await evaluate("window.__nativeMsgs[window.__nativeMsgs.length-1]"));
  check('saveImportedCourses 消息格式', msg.action === 'saveImportedCourses');
  check('saveImportedCourses 原样带回 JSON 字符串', msg.payload && JSON.parse(msg.payload).coursesJsonString === sampleCourses);
  await evaluate("window._shiguangNativeCallback('" + msg.callbackId + "', true, true); 1");
  check('saveImportedCourses resolve true', await evaluate("window.__p4.then(v => 'resolved:' + v)") === 'resolved:true');

  // saveCourseConfig / savePresetTimeSlots
  await evaluate("window.__p5 = window.shiguangBridgePromise.saveCourseConfig(JSON.stringify({semesterStartDate:'2026-09-07'})); 1");
  msg = JSON.parse(await evaluate("window.__nativeMsgs[window.__nativeMsgs.length-1]"));
  check('saveCourseConfig 消息格式', msg.action === 'saveCourseConfig' && JSON.parse(msg.payload).configJsonString.indexOf('2026-09-07') >= 0);
  await evaluate("window.__p6 = window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify([{number:1,startTime:'08:00',endTime:'08:45'}])); 1");
  msg = JSON.parse(await evaluate("window.__nativeMsgs[window.__nativeMsgs.length-1]"));
  check('savePresetTimeSlots 消息格式', msg.action === 'savePresetTimeSlots');

  // 同步接口（这两条没有 callbackId）
  const before = await evaluate("window.__nativeMsgs.length");
  await evaluate("window.shiguangBridge.showToast('正在抓取'); window.shiguangBridge.notifyTaskCompletion(); 1");
  msg = JSON.parse(await evaluate("window.__nativeMsgs[window.__nativeMsgs.length-2]"));
  check('showToast 是同步调用且无 callbackId', msg.action === 'showToast' && (msg.callbackId === null || msg.callbackId === undefined) && JSON.parse(msg.payload).message === '正在抓取');
  const after = await evaluate("window.__nativeMsgs.length");
  check('notifyTaskCompletion 也发出了一条', after === before + 2);
  msg = JSON.parse(await evaluate("window.__nativeMsgs[window.__nativeMsgs.length-1]"));
  check('notifyTaskCompletion 没有 payload', msg.action === 'notifyTaskCompletion' && (msg.payload === null || msg.payload === undefined));

  // reject 走 catch
  // 先挂一个空的 catch：否则 reject 的瞬间 promise 没有 handler，浏览器会记一次
  // 「Uncaught (in promise)」，最后那条「运行期无脚本异常」就会被这条自己污染的断言误判。
  await evaluate("window.__p7 = window.shiguangBridgePromise.saveImportedCourses('[]'); window.__p7.catch(function(){}); 1");
  const cb7 = JSON.parse(await evaluate("window.__nativeMsgs[window.__nativeMsgs.length-1]")).callbackId;
  await evaluate("window._shiguangNativeCallback('" + cb7 + "', false, {message:'写入失败'}); 1");
  check('reject 时脚本 catch 能取到 message', await evaluate("window.__p7.then(() => 'resolved').catch(e => 'rejected:' + e.message)") === 'rejected:写入失败');

  check('运行期无脚本异常', errs.length === 0, errs[0] || '');

  /* ============================================================
     ② 数据落地
     ============================================================ */
  console.log('\n【2】数据落地（uniApply → 确认导入）');

  // 造一个干净的课表环境
  await evaluate(`localStorage.removeItem('coursetable.v2'); 1`);
  await send('Page.reload');
  await sleep(400);
  await waitReady();

  const apply = await evaluate(`(function () {
    try {
      uniApply({
        adapterName: '正方教务系统',
        courses: [
          { name: '高等数学',   teacher: '张老师', position: 'A101 阶梯教室', day: 1, startSection: 1, endSection: 2, weeks: [1,2,3,4,5] },
          { name: '大学英语',   teacher: '李老师', position: 'B203 语音室',   day: 2, startSection: 3, endSection: 4, weeks: [6,7,8] },
          { name: '体育锻炼',   teacher: '',       position: '',             day: 5, startSection: 7, endSection: 8, weeks: [1] }
        ],
        timeSlots: [
          { number: 1, startTime: '08:00', endTime: '08:45' },
          { number: 2, startTime: '08:55', endTime: '09:40' },
          { number: 3, startTime: '10:00', endTime: '10:45' }
        ],
        config: { semesterStartDate: '2026-09-07' }
      });
      return 'ok';
    } catch (e) { return 'ERR:' + e.message; }
  })()`);
  check('uniApply 无异常执行', apply === 'ok', apply);

  const mapped = await evaluate(`(function () {
    var c = IMP.result.courses[0];
    return JSON.stringify({ n: IMP.result.courses.length, name: c.name, teacher: c.teacher, room: c.room,
      day: c.day, s: c.s, e: c.e, weeks: c.weeks, roomShort: c.roomShort, kind: IMP.kind, fname: IMP.fname });
  })()`);
  const m = JSON.parse(mapped);
  check('课程条数正确', m.n === 3, String(m.n));
  check('position → room', m.room === 'A101 阶梯教室', m.room);
  check('startSection → s / endSection → e', m.s === 1 && m.e === 2);
  check('星期 / 周次原样保留', m.day === 1 && m.weeks.join(',') === '1,2,3,4,5');
  // 注意：shortRoom() 会把「楼代号 + 房号」拆开（A101 → 「A 101」），这是课表块里
  // 显示房间简称的既有行为，与「从教务系统直接导入」走的是同一条路
  check('教室简称已生成', m.roomShort === 'A 101 阶梯教室', m.roomShort);
  check('导入来源标记为 uni', m.kind === 'uni' && m.fname === '正方教务系统');

  check('节次时间转成了 periods', await evaluate("IMP.result.periods.length === 3 && IMP.result.periods[0].n === 1 && IMP.result.periods[0].start === '08:00'"));
  check('开学日期被记为 fixedStart', await evaluate("IMP.fixedStart === '2026-09-07'"));
  check('确认面板已打开', await evaluate("document.querySelector('#sheetImport').classList.contains('on')") === true);
  check('有开学日期时不再问「本周是第几周」', await evaluate("!!document.querySelector('#imWkSeg')") === false);
  check('面板上显示了开学日期', String(await evaluate("document.querySelector('#siBody').textContent")).indexOf('2026-09-07') >= 0);
  check('课程预览表已渲染', await evaluate("document.querySelectorAll('#siBody .prev table tr').length") === 4);

  // 走完导入
  const landed = await evaluate(`(function () {
    try {
      doImport();
      var tb = activeTable();
      return JSON.stringify({
        count: tb.courses.length,
        termStart: tb.settings.termStart,
        periods: tb.settings.periods.length,
        first: tb.courses[0] ? { name: tb.courses[0].name, room: tb.courses[0].room, s: tb.courses[0].s, e: tb.courses[0].e } : null
      });
    } catch (e) { return 'ERR:' + e.message; }
  })()`);
  const L = JSON.parse(landed);
  check('导入后课程落库', L.count === 3, String(L.count));
  check('开学日期写进了设置', L.termStart === '2026-09-07', L.termStart);
  check('节次时间写进了设置', L.periods === 3, String(L.periods));
  check('落库的课程字段完整', L.first && L.first.name === '高等数学' && L.first.room === 'A101 阶梯教室' && L.first.s === 1 && L.first.e === 2);

  /* ---- 合并模式：脚本重复导入不应产生重复课 ---- */
  const merge = await evaluate(`(function () {
    IMP = { kind: 'uni', fixedStart: '2026-09-07', mode: 'merge',
      result: { courses: [
        { id: 'x1', name: '高等数学', teacher: '张老师', room: 'A101 阶梯教室', day: 1, s: 1, e: 2, weeks: [1,2,3,4,5], color: '', note: '', roomShort: 'A101 阶梯教室' },
        { id: 'x2', name: '线性代数', teacher: '王老师', room: 'C305 机房',   day: 3, s: 5, e: 6, weeks: [1,2,3],     color: '', note: '', roomShort: 'C305 机房' }
      ], notes: [], meta: { semester: '', student: '', className: '' }, periods: [], kind: 'grid' } };
    doImport();
    var tb = activeTable();
    return JSON.stringify({ count: tb.courses.length, names: tb.courses.map(function (c) { return c.name; }) });
  })()`);
  const MG = JSON.parse(merge);
  check('合并导入不重复添加相同课程', MG.count === 4, MG.names.join(' / '));
  check('合并导入追加了新课程', MG.names.indexOf('线性代数') >= 0);

  check('运行期无脚本异常', errs.length === 0, errs[0] || '');

  /* ============================================================
     ③ 学校选择 + 两条链路的分发
        本校也平铺在清单里（不置顶、不做特殊标注），点它走 ZwBridge
        清单学校 / 其他学校 → UniImport + 适配脚本
        学校清单由插件从 assets 读出，前端不写死
     ============================================================ */
  console.log('\n【3】学校选择与导入分发');

  // 假装是原生 App：两个插件都装上，只记录调用参数，不真的弹 WebView。
  // 学校清单用一份三条的假数据，覆盖「有网址 / 有网址 / 缺网址」三种情况。
  await evaluate(`window.Capacitor = {
      isNativePlatform: function () { return true; },
      Plugins: {
        ZwBridge: { openAndGrab: function (o) { window.__zwArgs = o; return new Promise(function () {}); } },
        UniImport: {
          open: function (o) {
            window.__uniArgs = o;
            return new Promise(function (res, rej) { window.__uniResolve = res; window.__uniReject = rej; });
          },
          listSchools: function () {
            return Promise.resolve({ schools: [
              { id: 'BUPT_01', name: '北京邮电大学', sub: '北京邮电大学本科教务', initial: 'B',
                url: 'https://jwgl.bupt.edu.cn/jsxsd/', script: 'BUPT/bupt_01.js', desc: '', cat: 'BACHELOR_AND_ASSOCIATE' },
              { id: 'CQU_01', name: '重庆大学', sub: '重庆大学教务', initial: 'C',
                url: 'https://jw.cqu.edu.cn/', script: 'CQU/cqu.js', desc: '', cat: 'BACHELOR_AND_ASSOCIATE' },
              { id: 'NOURL_01', name: '无网址示例大学', sub: '缺教务网址', initial: 'W',
                url: '', script: 'X/x.js', desc: '', cat: 'GENERAL_TOOL' }
            ]});
          }
        }
      }
    };
    window.__zwArgs = null; window.__uniArgs = null;
    localStorage.removeItem('qj_uni_url'); 1`);

  // 全新环境下，应用启动 500ms 后会自动打开「导入」面板（新手引导），
  // 它会把被测的学校面板顶掉。这里屏蔽这次自动打开 —— 它不是被测对象。
  await evaluate(`window.openImport = function () {}; 1`);
  await evaluate(`UNI_SCHOOLS = []; UNI_Q = ''; UNI_SCHOOL = ''; openUniImport(); 1`);
  await sleep(150);   // 等 listSchools 的 Promise 回来后重绘
  check('面板标题是「从教务系统导入」', await evaluate(`document.querySelector('#uniTitle').textContent`) === '从教务系统导入');
  check('学校清单由插件提供（前端未写死）', await evaluate(`UNI_SCHOOLS.length`) === 3);
  check('列表 = 本校 + 本科 / 高职 2 所 + 其他学校（只显示当前页签的类别）',
    await evaluate(`document.querySelectorAll('#uniSchools .opt').length`) === 4);
  check('打开面板时默认不预选任何学校', await evaluate(
    `document.querySelectorAll('#uniSchools .opt.on').length`) === 0);
  check('默认不展开「其他学校」表单', await evaluate(`document.querySelector('#uniOther').style.display`) === 'none');
  check('本校不再置顶（首位是按首字母排的第一所学校）',
    await evaluate(`document.querySelector('#uniSchools .opt').dataset.id`) === 'BUPT_01');
  check('本校并入普通列表（不置顶、排在「其他学校」之前）', await evaluate(
    `(function(){var r=[].slice.call(document.querySelectorAll('#uniSchools .opt')).map(function(e){return e.dataset.id;});` +
    `return r[0] !== 'wru' && r.indexOf('wru') === r.length - 2;})()`) === true);
  check('本校行也带教务系统类别备注', String(await evaluate(
    `document.querySelector('#uniSchools .opt[data-id="wru"]').textContent`)).indexOf('本科') >= 0);
  check('清单学校行也带类别备注', String(await evaluate(
    `document.querySelector('#uniSchools .opt[data-id="BUPT_01"]').textContent`)).indexOf('本科') >= 0);
  check('面板里不再叫用户点「打印」', String(await evaluate(`document.querySelector('#uniBody').textContent`)).indexOf('打印') < 0);
  check('按首字母分组', await evaluate(
    `[].slice.call(document.querySelectorAll('#uniSchools .flabel')).map(function (e) { return e.textContent; }).join('')`
  ) === 'BCW');
  check('首字母排在列表里', String(await evaluate(`document.querySelector('#uniSchools').textContent`)).indexOf('北京邮电大学') > 0);

  // 类别页签：本科 / 高职 · 研究生 · 通用系统
  check('学校按类别分成三个页签', await evaluate(`document.querySelectorAll('#uniTabs .sg').length`) === 3);
  check('默认停在「本科 / 高职」页',
    await evaluate(`document.querySelector('#uniTabs .sg.on').dataset.cat`) === 'BACHELOR_AND_ASSOCIATE');
  check('「通用系统」页签下才看得到通用工具类学校', await evaluate(
    `(function () {
       document.querySelector('#uniTabs .sg[data-cat="GENERAL_TOOL"]').click();
       var ids = [].map.call(document.querySelectorAll('#uniSchools .opt'), function (e) { return e.dataset.id; });
       var seen = ids.indexOf('NOURL_01') >= 0 && ids.indexOf('BUPT_01') < 0;
       document.querySelector('#uniTabs .sg[data-cat="BACHELOR_AND_ASSOCIATE"]').click();
       return seen;
     })()`) === true);
  check('切回本科页后恢复原来的学校', await evaluate(
    `[].map.call(document.querySelectorAll('#uniSchools .opt'), function (e) { return e.dataset.id; }).indexOf('BUPT_01') >= 0`) === true);
  // 搜索跨类别检索 —— 当前在本科页，也该搜得到通用工具类的学校
  await evaluate(`var q = document.querySelector('#uniQ'); q.value = '无网址'; q.dispatchEvent(new Event('input')); 1`);
  check('搜索跨类别检索（不受当前页签限制）', await evaluate(
    `[].map.call(document.querySelectorAll('#uniSchools .opt'), function (e) { return e.dataset.id; }).indexOf('NOURL_01') >= 0`) === true);
  await evaluate(`var q = document.querySelector('#uniQ'); q.value = ''; q.dispatchEvent(new Event('input')); 1`);

  // 面板不该长成一堵墙：列表自己限高滚动，点一行就走，不必翻到底找按钮
  check('学校列表是独立滚动区', await evaluate(
    `getComputedStyle(document.querySelector('#uniSchools')).overflowY`) === 'auto');
  check('列表限高，不撑满整屏', await evaluate(
    `parseFloat(getComputedStyle(document.querySelector('#uniSchools')).maxHeight) > 0`) === true);
  check('能直接打开的行右侧带箭头', await evaluate(
    `document.querySelectorAll('#uniSchools .opt .go').length`) === 3);
  check('本校行也带「点开即走」箭头', await evaluate(
    `!!document.querySelector('#uniSchools .opt[data-id="wru"] .go')`) === true);
  check('「其他学校」仍是单选圈（要先填网址）', await evaluate(
    `!!document.querySelector('#uniSchools .opt[data-id="other"] .rd')`) === true);
  check('「打开教务系统」按钮收进「其他学校」表单，不再排在列表末尾', await evaluate(
    `var g = document.querySelector('#uniGo');
     !!g && !!g.closest('#uniOther')`) === true);

  // 搜索：按学校名过滤，「其他学校」始终保留（本校与其它学校一样参与过滤）
  await evaluate(`var q = document.querySelector('#uniQ'); q.value = '邮电'; q.dispatchEvent(new Event('input')); 1`);
  check('搜索按学校名过滤', await evaluate(`document.querySelectorAll('#uniSchools .opt').length`) === 2);
  check('搜索时不再分组', await evaluate(`document.querySelectorAll('#uniSchools .flabel').length`) === 0);
  await evaluate(`var q = document.querySelector('#uniQ'); q.value = 'bupt'; q.dispatchEvent(new Event('input')); 1`);
  check('搜索也能按学校代号匹配', await evaluate(`document.querySelectorAll('#uniSchools .opt').length`) === 2);
  await evaluate(`var q = document.querySelector('#uniQ'); q.value = ''; q.dispatchEvent(new Event('input')); 1`);

  // 刷新列表的三条路径都要管用：安卓 WebView 里中文候选词是 compositionend 那一刻才写进
  // value 的，而且常常不补发 input 事件；用回车选词也会被输入法自己吃掉。
  // 全都只绑 input 的话，就会「字打完了列表不动，删掉一个字才刷新」。
  await evaluate(`var q = document.querySelector('#uniQ'); q.value = ''; q.dispatchEvent(new Event('input')); 1`);
  const uniFullCount = await evaluate(`document.querySelectorAll('#uniSchools .opt').length`);

  await evaluate(`var q = document.querySelector('#uniQ'); q.value = '邮电'; q.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })); 1`);
  check('输入法选词（compositionend）也能刷新结果', await evaluate(
    `document.querySelectorAll('#uniSchools .opt').length`) === 2);

  await evaluate(`var q = document.querySelector('#uniQ'); q.value = ''; q.dispatchEvent(new Event('input')); 1`);
  await evaluate(`var q = document.querySelector('#uniQ'); q.value = '邮电'; q.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); 1`);
  check('回车确认也能刷新结果', await evaluate(
    `document.querySelectorAll('#uniSchools .opt').length`) === 2);

  await evaluate(`var q = document.querySelector('#uniQ'); q.value = ''; q.dispatchEvent(new Event('input')); 1`);
  await evaluate(`var q = document.querySelector('#uniQ'); q.value = '邮电'; q.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })); 1`);
  check('回车选词（isComposing）不当成搜索确认，让给输入法', await evaluate(
    `document.querySelectorAll('#uniSchools .opt').length`) === uniFullCount);
  await evaluate(`var q = document.querySelector('#uniQ'); q.value = ''; q.dispatchEvent(new Event('input')); 1`);

  // 点一下清单里的学校 → 立即打开，用学校自带的教务网址与脚本（不用再点按钮）
  await evaluate(`window.__uniArgs = null; document.querySelector('#uniSchools .opt[data-id="BUPT_01"]').click(); 1`);
  check('点学校即选中', await evaluate(`UNI_SCHOOL`) === 'BUPT_01');
  check('点学校即打开教务系统', await evaluate(`!!window.__uniArgs`));
  check('点学校不展开网址表单', await evaluate(`document.querySelector('#uniOther').style.display`) === 'none');
  check('打开教务系统时学校列表仍留在下面（取消后能直接换一所）',
    await evaluate(`document.querySelector('#sheetUni').classList.contains('on')`) === true);
  check('网址取学校自带的教务地址',
    await evaluate(`window.__uniArgs && window.__uniArgs.url`) === 'https://jwgl.bupt.edu.cn/jsxsd/');
  check('脚本 id 用学校的 adapter_id',
    await evaluate(`window.__uniArgs && window.__uniArgs.scriptId`) === 'BUPT_01');

  // 点错了学校、在教务系统窗口里按返回键 → 插件回「已取消」。
  // 这时应该回到刚才的学校列表（面板一直留在下面），而不是被丢回课表页，也不该弹错误提示。
  await evaluate(`window.__toast = []; window.__origToast = toast;
    window.toast = function (m) { window.__toast.push(String(m)); }; 1`);
  await evaluate(`window.__uniReject && window.__uniReject(new Error('已取消')); 1`);
  await sleep(120);
  check('取消后学校列表还在（可以直接换一所）',
    await evaluate(`document.querySelector('#sheetUni').classList.contains('on')`) === true);
  check('取消后选中的学校仍保留，能够直接改选',
    await evaluate(`document.querySelector('#uniSchools .opt[data-id="BUPT_01"]').classList.contains('on')`) === true);
  check('取消不弹「未完成 / 失败」这类报错',
    await evaluate(`window.__toast.filter(function (m) { return /未完成|失败/.test(m); }).length`) === 0,
    await evaluate(`JSON.stringify(window.__toast)`));
  await evaluate(`window.toast = window.__origToast; 1`);

  // 学校没配网址时不能开窗口，避免打开一个空白页（这所在「通用系统」页签下）
  await evaluate(`window.__uniArgs = null; openUniImport(); 1`);
  await sleep(120);
  await evaluate(`document.querySelector('#uniTabs .sg[data-cat="GENERAL_TOOL"]').click();
    document.querySelector('#uniSchools .opt[data-id="NOURL_01"]').click(); 1`);
  check('缺网址的学校不打开教务系统', await evaluate(`window.__uniArgs === null`));
  await evaluate(`UNI_CAT = 'BACHELOR_AND_ASSOCIATE'; 1`);   // 复位到本科页，后面还要点本校

  // 切到「其他学校」
  await evaluate(`openUniImport(); 1`);
  await sleep(120);
  await evaluate(`window.__uniArgs = null; window.__zwArgs = null;
    document.querySelector('#uniSchools .opt[data-id="other"]').click(); 1`);
  check('切换后选中其他学校', await evaluate(`UNI_SCHOOL`) === 'other');
  check('「其他学校」不直接开窗口（要先填网址）',
    await evaluate(`window.__uniArgs === null && window.__zwArgs === null`));
  check('展开系统类型与网址表单', await evaluate(`document.querySelector('#uniOther').style.display`) !== 'none');
  check('系统类型有 4 项', await evaluate(`document.querySelectorAll('#uniTypes .opt').length`) === 4);
  check('默认系统类型是正方', await evaluate(`UNI_PICK`) === 'zhengfang');
  await evaluate(`document.querySelector('#uniTypes .opt[data-id="urp"]').click(); 1`);
  check('可切换系统类型', await evaluate(`UNI_PICK`) === 'urp');
  check('提示文案跟着系统类型走', String(await evaluate(`document.querySelector('#uniHint').textContent`)).indexOf('课表视图') >= 0);

  // 没填网址时不应该打开插件（输入框会记住上次用过的网址，这里先清空）
  await evaluate(`window.__uniArgs = null; window.__zwArgs = null;
    document.querySelector('#uniUrl').value = ''; uniOpen(); 1`);
  check('没填网址时不打开教务系统', await evaluate(`window.__uniArgs === null && window.__zwArgs === null`));

  // 填了网址 → 走通用脚本通道
  await evaluate(`document.querySelector('#uniUrl').value = 'http://jwxt.example.edu.cn'; uniOpen(); 1`);
  check('其他学校走 UniImport 通道', await evaluate(`!!window.__uniArgs`));
  check('带上了选中的系统类型', await evaluate(`window.__uniArgs && window.__uniArgs.scriptId`) === 'urp');
  check('网址原样传下去', await evaluate(`window.__uniArgs && window.__uniArgs.url`) === 'http://jwxt.example.edu.cn');
  check('网址被记住了', await evaluate(`localStorage.getItem('qj_uni_url')`) === 'http://jwxt.example.edu.cn');

  // 切回本校 → 走 ZwBridge 通道（点了直接进教务，不再弹跳转提醒）
  await evaluate(`window.__uniArgs = null; window.__zwArgs = null; openUniImport(); 1`);
  await sleep(120);
  await evaluate(`document.querySelector('#uniSchools .opt[data-id="wru"]').click(); 1`);
  check('切回本校', await evaluate(`UNI_SCHOOL`) === 'wru');
  check('点本校直接进教务系统（不再弹跳转提醒）',
    await evaluate(`!!(window.__zwArgs && window.__zwArgs.url)`) === true);
  check('跳转前提醒弹层已彻底移除', await evaluate(`!document.querySelector('#zwModal')`) === true);
  check('走 ZwBridge 且指向武铁教务', String(await evaluate(`window.__zwArgs && window.__zwArgs.url`)).indexOf('jwxt.wru.edu.cn') >= 0);
  check('ZwBridge 带上课表接口路径', await evaluate(`window.__zwArgs && window.__zwArgs.apiPath`) === '/jsxsd/xskb/xskb_list.do');
  check('本校不碰通用脚本通道', await evaluate(`window.__uniArgs === null`));

  check('运行期无脚本异常', errs.length === 0, errs[0] || '');

  console.log('\n========== 结果：' + ok.length + ' 通过 / ' + bad.length + ' 失败 ==========');
  if (bad.length) { bad.forEach(b => console.log('  失败：' + b)); process.exitCode = 1; }
  proc.kill();
})().catch(e => { console.error('测试脚本异常：', e); process.exit(1); });
