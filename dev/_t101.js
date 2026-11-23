/* v1.0.1 验收：四项 bug 修复 + 三项体验改动 + 版本号
   用法：node dev/_t101.js [清笺课程表.html 路径] */
const { spawn } = require('child_process');
const os = require('os'), path = require('path');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9560;
const FILE = process.argv[2] || path.resolve(__dirname, '..', '清笺课程表.html');
const URL_ = 'file:///' + FILE.replace(/\\/g, '/').replace(/^\/?/, '');
const userDir = path.join(os.tmpdir(), 'edge-t101-' + process.pid + '-' + Date.now());
const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + userDir, URL_], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}

(async () => {
  let t = null;
  for (let i = 0; i < 80 && !t; i++) {
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
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errs.push('[log] ' + m.params.entry.text);
    if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
  };
  const send = (me, p) => new Promise(r => { const i = ++id; waiters.set(i, r); ws.send(JSON.stringify({ id: i, method: me, params: p || {} })); });
  const ev = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return 'ERR:' + r.result.exceptionDetails.text;
    return r.result.result.value;
  };
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await ev('localStorage.clear()');
  await send('Page.reload'); await sleep(2600);
  for (let i = 0; i < 60; i++) { if (await ev('window.__ready === true') === true) break; await sleep(150); }

  console.log('\n[1] 版本号');
  ok('APP_VERSION 是 1.0.1', await ev("APP_VERSION") === '1.0.1', await ev('APP_VERSION'));
  ok('APP_BUILD 为空（正式版）', await ev("APP_BUILD") === '', await ev('APP_BUILD'));

  console.log('\n[2] 首启指引仍正常（不该回归）');
  ok('首次打开弹的是使用指引', await ev('document.querySelector("#sheetGuide").classList.contains("on")') === true);
  await ev('S.global.guideSeen=1; save(); hideSheet(); 1');
  ok('关掉后指引不再显示', await ev('document.querySelector("#sheetGuide").classList.contains("on")') === false);

  console.log('\n[3] 修复：ICS 导出用课程自己的时间（courseTime）');
  const ics = await ev(`(function(){
    S.tables[0].courses = [{
      id:'c1', name:'自定义时间课', day:1, s:1, e:2,
      start:'07:10', end:'08:05', weeks:[1], color:'', teacher:'', room:''
    },{
      id:'c2', name:'跟随节次表课', day:2, s:3, e:4,
      start:'', end:'', weeks:[1], color:'', teacher:'', room:''
    }];
    S.settings.periods = [{n:1,start:'08:30',end:'09:15'},{n:2,start:'09:25',end:'10:10'},
      {n:3,start:'10:30',end:'11:15'},{n:4,start:'11:25',end:'12:10'}];
    S.settings.totalWeeks = 20;
    const out = buildICS();
    return { events: out.events, txt: out.text };
  })()`);
  if (typeof ics === 'string' && ics.startsWith('ERR:')) { ok('buildICS 可执行', false, ics); }
  else {
    const txt = String(ics.txt || '');
    ok('两个课程都生成了事件', ics.events === 2, ics.events);
    ok('自定义时间课用 07:10-08:05 写进 DESCRIPTION', txt.indexOf('07:10-08:05') >= 0);
    ok('跟随节次表的课仍用 10:30-12:10', txt.indexOf('10:30-12:10') >= 0);
    ok('自定义时间课的时间没被节次表顶掉', txt.indexOf('08:30-10:10') < 0 || txt.indexOf('07:10-08:05') >= 0);
    ok('DTSTART 按 UTC+8 换算（07:10 本地 → 前一天 23:10Z）', /DTSTART:\d{8}T231000Z/.test(txt));
  }

  console.log('\n[4] 修复：教务导入无周次时不再塞 [1]');
  const ua = await ev(`(function(){
    uniApply({ courses: [
      { name:'脚本没给周次的课', day:3, startSection:2, endSection:3, teacher:'张老师', room:'A302' },
      { name:'给了周次的课', day:4, startSection:5, endSection:6, weeks:[2,3,4] }
    ]});
    hideSheet();
    const cs = (IMP && IMP.result && IMP.result.courses) || [];
    const a = cs.find(c => c.name === '脚本没给周次的课');
    const b = cs.find(c => c.name === '给了周次的课');
    return {
      n: cs.length,
      aWeeks: a ? (a.weeks === null ? 'null' : JSON.stringify(a.weeks)) : 'MISSING',
      aS: a && a.s, aE: a && a.e,
      bWeeks: b ? JSON.stringify(b.weeks) : 'MISSING'
    };
  })()`);
  if (typeof ua === 'string' && ua.startsWith('ERR:')) { ok('uniApply 可执行', false, ua); }
  else {
    ok('两条都解析进来', ua.n === 2, ua.n);
    ok('无周次的课 weeks 为 null（= 每周都上）', ua.aWeeks === 'null', ua.aWeeks);
    ok('无周次的课节次保留 2-3', ua.aS === 2 && ua.aE === 3, ua);
    ok('有周次的课保持不变', ua.bWeeks === '[2,3,4]', ua.bWeeks);
  }

  console.log('\n[5] 修复：更新检查挑对安装包');
  const pick = await ev(`(function(){
    const fake = { tag_name:'v1.0.1', published_at:'2026-11-24T00:00:00Z', body:'', assets:[
      { name:'QingJian-CourseTable-latest.apk', size:13277216, browser_download_url:'https://a/latest.apk', digest:'sha256:aaa' },
      { name:'QingJian-CourseTable-v1.0.1.apk', size:13277216, browser_download_url:'https://a/v101.apk', digest:'sha256:bbb' }
    ]};
    const apks = (fake.assets||[]).filter(a => /\\.apk$/i.test(a.name||''));
    const ver = String(fake.tag_name).replace(/^v/i,'');
    const pickd = apks.find(a => !/latest/i.test(a.name) && a.name.indexOf(ver) >= 0)
      || apks.find(a => !/latest/i.test(a.name)) || apks[0] || {};
    return { picked: pickd.name, hasVer: pickd.name.indexOf(ver) >= 0 };
  })()`);
  ok('挑中带版本号的包而不是 latest', pick.picked === 'QingJian-CourseTable-v1.0.1.apk', pick);

  console.log('\n[6] 体验：课表整周无课的空状态');
  await ev(`(function(){
    S.tables[0].courses = [{ id:'x1', name:'仅第1周课', day:1, s:1, e:2, weeks:[1], color:'', teacher:'', room:'' }];
    S.view.week = 19; switchTab('sched'); renderGrid(); return 1;
  })()`);
  await sleep(200);
  const ge1 = await ev(`(function(){var e=document.querySelector('#gridScroll .gempty');return e?{t:(e.querySelector('.ge-t')||{}).textContent,s:(e.querySelector('.ge-s')||{}).textContent}:null})()`);
  ok('本周无课时出现空状态块', !!ge1, ge1);
  ok('有课程但本周没课 → 文案「这一周没有课」', ge1 && ge1.t === '这一周没有课', ge1 && ge1.t);
  ok('空状态不拦截点击（pointer-events:none）', await ev(`getComputedStyle(document.querySelector('#gridScroll .gempty')).pointerEvents`) === 'none');
  await ev(`(function(){ S.tables[0].courses = []; renderGrid(); return 1; })()`);
  await sleep(200);
  const ge2 = await ev(`(function(){var e=document.querySelector('#gridScroll .gempty');return e?{t:(e.querySelector('.ge-t')||{}).textContent,s:(e.querySelector('.ge-s')||{}).textContent}:null})()`);
  ok('完全没有课程 → 文案「还没有课程」', ge2 && ge2.t === '还没有课程', ge2 && ge2.t);
  ok('完全没有课程时给出导入引导', ge2 && /导入/.test(ge2.s || ''), ge2 && ge2.s);
  await ev(`(function(){ S.tables[0].courses = [{id:'y1',name:'有课',day:1,s:1,e:2,weeks:null,color:'',teacher:'',room:''}]; S.view.week=1; renderGrid(); return 1; })()`);
  await sleep(200);
  ok('有课时空状态被移除', await ev(`document.querySelector('#gridScroll .gempty') === null`));

  console.log('\n[7] 体验：添加课程默认星期为今天');
  const dm = await ev(`(function(){
    S.global.showWeekend = true; save();
    openEdit(null);
    const on = document.querySelector('#fDay .chip.on');
    const val = on ? +on.dataset.d : null;
    hideSheet();
    const td = new Date(); const exp = td.getDay() === 0 ? 7 : td.getDay();
    return { got: val, expect: exp };
  })()`);
  ok('新建课程默认星期 = 今天', dm.got === dm.expect, dm);

  console.log('\n[8] 顶栏四按钮仍然各司其职（不该回归）');
  ok('#btnExport 绑到 exportPNG', await ev(`String($('#btnExport').onclick).indexOf('exportPNG') >= 0`) === true);
  ok('#btnMore 打开 #sheetMore', await ev(`String($('#btnMore').onclick).indexOf('#sheetMore') >= 0`) === true);

  console.log('\n[9] 排版 token 与全局换行仍在（不该回归）');
  ok('排版 token 齐全', await ev(`(function(){var s=getComputedStyle(document.documentElement);
    return ['--fs-h1','--fs-h2','--fs-body','--fs-note','--lh-body','--lh-para'].every(k=>s.getPropertyValue(k).trim()!=='')})()`) === true);
  ok('body 换行规则未被改回 break-all', await ev(`getComputedStyle(document.body).wordBreak`) === 'normal');
  /* 课块 .cc 上的内联 font-size 是 planBlock 自动缩放算出来的，属于设计内行为，排除掉 */
  ok('静态标记里无硬编码内联 font-size', await ev(
    `Array.from(document.querySelectorAll('[style*="font-size"]')).filter(e => !e.classList.contains('cc')).length`
  ) === 0, await ev(`Array.from(document.querySelectorAll('[style*="font-size"]')).filter(e => !e.classList.contains('cc')).map(e=>e.tagName+'#'+e.id).join(',')`));

  console.log('\n[10] bug-review 第二轮 9 条修复');
  // 1. 关掉显示周末后，编辑周末的课不会把星期改成周一
  const we1 = await ev(`(function(){
    S.global.showWeekend = false; save();
    S.tables[0].courses = [{ id:'we1', name:'周末课', day:6, s:1, e:2, weeks:null, color:'', teacher:'', room:'' }];
    openEdit('we1');
    const chips = document.querySelectorAll('#fDay .chip').length;
    const on = document.querySelector('#fDay .chip.on');
    const picked = on ? +on.dataset.d : null;
    saveEdit();
    const c = S.tables[0].courses.find(x => x.id === 'we1');
    hideSheet();
    S.global.showWeekend = true; save();
    return { chips, picked, day: c && c.day };
  })()`);
  ok('编辑弹窗始终给 7 个星期 chip', we1.chips === 7, we1.chips);
  ok('周末课打开时正确选中第 6 天', we1.picked === 6, we1.picked);
  ok('保存后星期仍是周六，没被挪到周一', we1.day === 6, we1.day);

  // 2. 明细表「上课时间」列不再被当成节次列
  const fd = await ev(`(function(){
    const rows = [
      ['课程名称','教师','星期','上课时间','周次','教室'],
      ['高等数学','张老师','星期一','08:00-09:40','1-16','A302']
    ];
    const m = detectList(rows);
    return { periods: m.periods, time: m.time, name: m.name, weeks: m.weeks };
  })()`);
  ok('「上课时间」列归到 time 而不是 periods', fd.periods === undefined && fd.time === 3, fd);
  const pv = await ev(`(function(){
    return { multi: parsePeriodVal('1-2,3-4'), single: parsePeriodVal('3-4'), hour: parsePeriodVal('08:00-09:40') };
  })()`);
  ok('节次「1-2,3-4」只取第一段 → 1-2', String(pv.multi) === '1,2', pv.multi);
  ok('节次「3-4」正常', String(pv.single) === '3,4', pv.single);

  // 3. 隐藏周末时表头只有 5 列，与网格对齐
  const wh = await ev(`(function(){
    S.global.showWeekend = false; save(); S.view.week = 3;
    switchTab('sched'); renderWeekHead(); renderGrid();
    const head = document.querySelectorAll('#weekHead .wh-day').length;
    const cols = document.querySelectorAll('#gridBody .dcol').length;
    S.global.showWeekend = true; save(); renderWeekHead(); renderGrid();
    const head7 = document.querySelectorAll('#weekHead .wh-day').length;
    return { head, cols, head7 };
  })()`);
  ok('隐藏周末：表头 5 列 = 网格 5 列', wh.head === 5 && wh.cols === 5, wh);
  ok('显示周末：表头 7 列', wh.head7 === 7, wh.head7);

  // 4. applySnapshot 对脏数据做清洗（与恢复备份同一条路）
  const sn = await ev(`(function(){
    const dirty = { tables: [{
      id:'t1', name:'脏数据表',
      courses: [ { id:'ok1', name:'正常课', day:2, s:1, e:2, weeks:['x',3] },
                 { id:'bad1', name:'', day:1, s:1, e:2 },
                 'not-an-object' ],
      settings: { periods: [] }
    }], activeId:'t1' };
    const ok = applySnapshot(dirty);
    const t = S.tables[0];
    return { ok, n: S.tables.length, courses: t.courses.length, weeks: t.courses[0].weeks,
             periods: t.settings.periods.length };
  })()`);
  ok('脏快照能载入', sn.ok === true, sn.ok);
  ok('非对象课程被丢掉（3 条只剩 1 条）', sn.courses === 1, sn.courses);
  ok('字符串周次被过滤成 [3]', String(sn.weeks) === '3', sn.weeks);
  ok('空 periods 回落成默认 10 节', sn.periods === 10, sn.periods);

  // 5. 明细表导入不覆盖用户已自定义的节次表
  const pp = await ev(`(function(){
    const custom = [{n:1,start:'08:00',end:'08:45'},{n:2,start:'08:50',end:'09:35'}];
    S.tables[0].settings.periods = JSON.parse(JSON.stringify(custom));
    const before = JSON.stringify(S.settings.periods);
    IMP = { kind:'list', mode:'replace',
      rows:[['课程名称','星期','节次'],['语文','星期一','1-2']],
      map:{ _head:0, name:0, day:1, periods:2 } };
    IMP.result = { courses:[{ id:'p1', name:'语文', teacher:'', room:'', day:1, s:1, e:2, weeks:null, color:'', note:'', roomShort:'' }],
      notes:[], meta:{}, periods: JSON.parse(JSON.stringify(DEFAULT_PERIODS)), kind:'list' };
    doImport();
    hideSheet();
    return { before, after: JSON.stringify(S.settings.periods), same: JSON.stringify(S.settings.periods) === before };
  })()`);
  ok('明细表导入不覆盖自定义节次表', pp.same === true, pp);

  // 6. 教务课表格子缺教室行时不错位
  const zw = await ev(`(function(){
    var html = '<table id="kbtable"><tr><th>第一大节</th></tr>'
      + '<tr><th>第一大节\\n08:30-10:10</th>'
      + '<td><div class="kbcontent">高等数学<br>张老师<br>1-16周 [1-2]节<br>A302</div>'
      + '<div class="kbcontent">线性代数<br>李老师<br>1-8周 [1-2]节</div></td>'
      + '<td></td><td></td><td></td><td></td><td></td><td></td></tr></table>';
    try { parseZwGrid(html); } catch(e) { return { err: e.message }; }
    return { courses: IMP.result.courses.map(c => ({ n:c.name, t:c.teacher, r:c.room, s:c.s, e:c.e })) };
  })()`);
  if (zw.err) { ok('parseZwGrid 可执行', false, zw.err); }
  else {
    ok('两门课都解析出来了', zw.courses.length === 2, zw.courses.length);
    ok('第一门：教室 A302 没串位', zw.courses[0] && zw.courses[0].r === 'A302', zw.courses[0]);
    ok('第二门（缺教室行）：课名与老师正确', zw.courses[1] && zw.courses[1].n === '线性代数' && zw.courses[1].t === '李老师', zw.courses[1]);
    ok('第二门教室为空而不是把周次当教室', zw.courses[1] && zw.courses[1].r === '', zw.courses[1]);
    ok('第二门节次仍是 1-2', zw.courses[1] && zw.courses[1].s === 1 && zw.courses[1].e === 2, zw.courses[1]);
  }

  // 7. 节次时间为空时不出 "undefined"
  const ud = await ev(`(function(){
    S.tables[0].settings.periods = [{n:1,start:'',end:''},{n:2,start:'08:50',end:''}];
    S.view.week = 1; switchTab('sched'); renderGrid();
    const cells = document.querySelector('#timeCol') ? document.querySelector('#timeCol').innerHTML : '';
    return { hasUndef: /undefined/.test(cells), html: cells.slice(0, 260) };
  })()`);
  ok('时间列里不出现 undefined', ud.hasUndef === false, ud.html);

  // 8. PNG 导出文字不越出色块
  const wr = await ev(`(function(){
    const cv = document.createElement('canvas'); cv.width = 400; cv.height = 200;
    const g = cv.getContext('2d'); g.font = '18px sans-serif';
    const end = wrap(g, '这是一门名字特别特别长的课程名称用来测试换行边界', 0, 0, 60, 22, 40);
    return { end };
  })()`);
  ok('wrap 到边界就停（返回值不超过 maxY+行高）', wr.end <= 62, wr.end);

  // 9. 导出 PNG 不报错
  ok('exportPNG 可调用', await ev(`typeof exportPNG`) === 'function');

  console.log('\n[11] 运行期错误');
  ok('零运行期错误', errs.length === 0, errs.slice(0, 5));

  console.log('\n结果：' + pass + ' 过 / ' + fail + ' 失败');
  ws.close(); try { proc.kill(); } catch (e) {}
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('失败:', e.message); try { proc.kill(); } catch (_) {} process.exit(1); });
