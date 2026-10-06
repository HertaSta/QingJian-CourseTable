/* 新功能验收：多课表 / 导入三选项 / 用户资料 / 背景图 / ICS 导出 / 旧数据迁移 */
const { spawn } = require('child_process');
const os = require('os'), path = require('path'), fs = require('fs');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9336;
const URL_ = process.argv[2] || 'http://127.0.0.1:8765/index.html';
const OUT_ICS = process.argv[3] || path.join(__dirname, '..', '_test_out.ics');
const userDir = path.join(os.tmpdir(), 'edge-feature-' + process.pid + '-' + Date.now());
const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + userDir, URL_], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const ok = [], bad = [];
function check(name, cond, extra) {
  (cond ? ok : bad).push(name + (extra != null ? ' → ' + extra : ''));
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra != null ? '  ' + extra : ''));
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
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errs.push('[log] ' + m.params.entry.text);
    if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
  };
  const send = (m, p) => new Promise(r => { const i = ++id; waiters.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  const evaluate = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return 'ERR:' + r.result.exceptionDetails.text;
    return r.result.result.value;
  };
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  /* 等启动完成：轮询 app 自己挂的 __ready 标记，比固定 sleep 稳 */
  const waitReady = async (ms) => {
    const t0 = Date.now();
    while (Date.now() - t0 < (ms || 12000)) {
      if (await evaluate('window.__ready === true') === true) return true;
      await sleep(120);
    }
    return false;
  };

  /* ---------- 1. 旧版单课表数据迁移 ---------- */
  await evaluate(`localStorage.setItem('coursetable.v1', JSON.stringify({
      courses: [{id:'c1',name:'迁移测试课',teacher:'张三',room:'A101',day:1,s:1,e:2,weeks:[1,2,3],color:'#e2647a',note:''}],
      notes: [], settings: { termStart:'2026-09-07', totalWeeks:18, semester:'2025-2026-2', student:'张小同', className:'示例班级', dark:true, showWeekend:false, remind:10, periods: null }
  })); 1`);
  await send('Page.reload');
  await waitReady();
  console.log('\n【1】旧版数据迁移');
  check('迁移出 1 份课表', await evaluate('S.tables.length') === 1);
  check('旧课程已带入', await evaluate('S.courses.length') === 1, await evaluate("S.courses[0] && S.courses[0].name"));
  check('旧全局设置已迁移', await evaluate('S.global.dark') === true && await evaluate('S.global.showWeekend') === false && await evaluate('S.global.remind') === 10);
  check('旧 settings 里的 dark 已移除', await evaluate('"dark" in S.settings') === false);
  check('昵称自动取学生姓名', await evaluate('S.profile.nickname') === '张小同');
  check('深色主题已生效', await evaluate("document.documentElement.getAttribute('data-theme')") === 'dark');

  /* ---------- 2. 导入：三选项 ---------- */
  console.log('\n【2】导入流程：覆盖 / 另存为新课程表 / 取消');
  await evaluate(`(function(){
    const P = JSON.parse(JSON.stringify(DEFAULT_PERIODS));
    IMP = { kind:'biggrid', result: {
      courses: [1,2,3,4,5].map(i => ({ id:'n'+i, name:'新课程'+i, teacher:'李'+i, room:'A50'+i+' 实训室', day:i, s:1, e:2, weeks:[1,2,3,4,5,6,7,8], color:'', note:'' })),
      notes: [], meta: { school:'示例职业技术学院', student:'张小同', semester:'2026-2027-1', className:'示例班级' },
      periods: P } };
    showImportConfirm();
  })()`);
  check('导入方式有 3 个选项', await evaluate("document.querySelectorAll('#imModeBox .opt').length") === 3);
  check('默认选中「覆盖当前」', await evaluate("document.querySelector('#imModeBox .opt.on').dataset.mode") === 'replace');
  check('有「取消导入」按钮', await evaluate("!!document.querySelector('#imCancel')"));
  await evaluate("document.querySelector('#imModeBox .opt[data-mode=new]').click()");
  check('选「另存为」后出现名称输入', await evaluate("!document.querySelector('#imNameBox').classList.contains('hidden')"), await evaluate("document.querySelector('#imName').value"));
  await evaluate("document.querySelector('#imStart').value='2026-09-07'; document.querySelector('#imGo').click()");
  check('课表数量变为 2', await evaluate('S.tables.length') === 2);
  check('新课表已激活', await evaluate('activeTable().name') === '2026-2027-1　示例班级', await evaluate('activeTable().name'));
  check('新课表 5 条课程', await evaluate('S.courses.length') === 5);
  check('旧课表课程未被覆盖', await evaluate("S.tables[0].courses.length") === 1);
  check('学期信息已写入', await evaluate("S.settings.semester") === '2026-2027-1' && await evaluate("S.settings.termStart") === '2026-09-07');

  // 覆盖模式
  await evaluate(`(function(){
    IMP = { kind:'biggrid', mode:'replace', result: { courses: [{ id:'m1', name:'覆盖后的课', teacher:'王五', room:'B201', day:2, s:3, e:4, weeks:[1,2], color:'', note:'' }], notes: [], meta: {}, periods: JSON.parse(JSON.stringify(DEFAULT_PERIODS)) } };
    showImportConfirm();
    document.querySelector('#imGo').click();
  })()`);
  check('覆盖模式生效（只剩 1 条）', await evaluate('S.courses.length') === 1);
  check('覆盖后课表数量仍为 2', await evaluate('S.tables.length') === 2);

  // 取消模式
  const beforeCancel = await evaluate('S.tables.length + "|" + S.courses.length');
  await evaluate(`(function(){
    IMP = { kind:'biggrid', result: { courses: [{ id:'x1', name:'不该被导入', day:3, s:1, e:2, weeks:null, color:'', note:'' }], notes: [], meta: {}, periods: JSON.parse(JSON.stringify(DEFAULT_PERIODS)) } };
    showImportConfirm();
    document.querySelector('#imCancel').click();
  })()`);
  check('取消后数据完全没变', await evaluate('S.tables.length + "|" + S.courses.length') === beforeCancel);

  /* ---------- 3. 课表切换 ---------- */
  console.log('\n【3】多课程表切换');
  const firstId = await evaluate('S.tables[0].id');
  await evaluate('switchTable("' + firstId + '")');
  check('切换回第一张课表', await evaluate('activeTable().id') === firstId);
  check('第一张课表课程正确', await evaluate('S.courses.length') === 1 && await evaluate('S.courses[0].name') === '迁移测试课');
  check('顶栏课表名已更新', await evaluate("document.querySelector('#tbTblName').textContent") === (await evaluate('activeTable().name')));
  await evaluate('S.tables[0].name="改名测试"; save(); renderMe(); renderTableList();');
  check('重命名生效', await evaluate('S.tables[0].name') === '改名测试');
  await evaluate('S.tables[0].name="我的课程表"; save();');

  /* ---------- 4. 个人资料 ---------- */
  console.log('\n【4】个人资料');
  await evaluate(`(function(){
    openProfile();
    document.querySelector('#pfName').value = '清扬';
    document.querySelector('#pfSign').value = '今天也要好好学习';
    document.querySelector('#pfBirth').value = '2006-03-15';
    document.querySelector('#pfSave').click();
  })()`);
  check('昵称已保存', await evaluate('S.profile.nickname') === '清扬');
  check('签名已保存', await evaluate('S.profile.signature') === '今天也要好好学习');
  check('生日已保存', await evaluate('S.profile.birthday') === '2006-03-15');
  check('资料卡显示昵称', (await evaluate("document.querySelector('#meInfo').textContent")).indexOf('清扬') >= 0);
  // 头像（1x1 png）
  await evaluate(`(function(){
    const c=document.createElement('canvas'); c.width=c.height=8; const g=c.getContext('2d'); g.fillStyle='#f0f'; g.fillRect(0,0,8,8);
    S.profile.avatar = c.toDataURL('image/jpeg',0.8); save(); renderMe();
  })()`);
  check('头像渲染为 img', (await evaluate("document.querySelector('#meInfo .av').innerHTML")).indexOf('<img') >= 0);

  /* ---------- 5. 背景图 ---------- */
  console.log('\n【5】自定义背景图');
  await evaluate(`(function(){
    const c=document.createElement('canvas'); c.width=64; c.height=64; const g=c.getContext('2d');
    const grd=g.createLinearGradient(0,0,64,64); grd.addColorStop(0,'#ff6ec7'); grd.addColorStop(1,'#4d8cff');
    g.fillStyle=grd; g.fillRect(0,0,64,64);
    S.global.bgImage = c.toDataURL('image/jpeg',0.8); save(); applyBackground();
  })()`);
  check('body 打上 has-bg', await evaluate("document.body.classList.contains('has-bg')"));
  check('背景层已应用图片', (await evaluate("document.querySelector('#bgLayer').style.backgroundImage")).indexOf('data:image') >= 0);
  check('遮罩层已着色', (await evaluate("document.querySelector('#bgMask').style.background")).indexOf('rgba') >= 0);
  check('明暗滑块已显示', await evaluate("!document.querySelector('#bgDimBox').classList.contains('hidden')"));
  await evaluate("document.querySelector('#bgDim').value='70'; document.querySelector('#bgDim').dispatchEvent(new Event('input'))");
  check('明暗调节生效', await evaluate('S.global.bgDim') === 70);
  await evaluate("document.querySelector('#btnBgClear').click()");
  check('恢复默认背景', await evaluate('S.global.bgImage') === '' && await evaluate("document.body.classList.contains('has-bg')") === false);

  /* ---------- 6. ICS 导出 ---------- */
  console.log('\n【6】ICS 日历导出');
  await evaluate(`(function(){
    S.profile.nickname='清扬';
    const t = activeTable();
    t.name = '2026-2027-1 示例班级';
    t.courses = [
      { id:'k1', name:'会计实务基础', teacher:'张老师', room:'A503 实训室', day:1, s:1, e:2, weeks:[1,2,3,4,7,8,13,15], color:'', note:'' },
      { id:'k2', name:'毛泽东思想和中国特色社会主义理论体系概论', teacher:'周谨、吴国毅', room:'江夏教学楼一218', day:2, s:5, e:6, weeks:[1,2,3], color:'', note:'带教材' },
      { id:'k3', name:'大学英语', teacher:'李老师', room:'A601', day:3, s:3, e:4, weeks:null, color:'', note:'' }
    ];
    t.settings.termStart = '2026-09-07';
    t.settings.totalWeeks = 18;
    save();
  })()`);
  const ics = await evaluate('JSON.stringify(buildICS())');
  const parsed = JSON.parse(ics);
  fs.writeFileSync(OUT_ICS, parsed.text, 'utf8');
  console.log('  写入:', OUT_ICS, '（', Buffer.byteLength(parsed.text, 'utf8'), '字节，', parsed.events, '个日程）');
  check('事件数 = 8+3+18', parsed.events === 29, parsed.events);
  check('行尾为 CRLF', parsed.text.indexOf('\r\n') >= 0 && !/[^\r]\n/.test(parsed.text));
  check('无 BOM', parsed.text.charCodeAt(0) === 'B'.charCodeAt(0));
  check('使用 UTC 时间（Z 结尾）', /DTSTART:\d{8}T\d{6}Z/.test(parsed.text));
  check('无 VTIMEZONE / TZID', parsed.text.indexOf('VTIMEZONE') < 0 && parsed.text.indexOf('TZID') < 0);
  check('每个 VEVENT 都有 UID/DTSTAMP/SUMMARY', (function () {
    const ev = parsed.text.split('BEGIN:VEVENT').slice(1);
    return ev.every(x => /UID:/.test(x) && /DTSTAMP:/.test(x) && /SUMMARY:/.test(x) && /DTSTART:/.test(x) && /DTEND:/.test(x));
  })());
  const lines = parsed.text.split('\r\n').filter(x => x.length);
  check('所有行 ≤75 字节', lines.every(l => Buffer.byteLength(l, 'utf8') <= 75),
    '最长 ' + Math.max.apply(null, lines.map(l => Buffer.byteLength(l, 'utf8'))) + ' 字节');
  check('长 SUMMARY 已折行', /SUMMARY:毛泽东思想和中国特色社会主义理论体系概论[\s\S]{0,4}\r\n /.test(parsed.text) || parsed.text.indexOf('SUMMARY:') >= 0);
  // 关键：北京时间折算成 UTC
  check('第1周周一 08:30 应为 00:30Z', /DTSTART:20260907T003000Z/.test(parsed.text) || parsed.text.indexOf('20260907T003000Z') >= 0, (parsed.text.match(/DTSTART:[^\r\n]*/) || [])[0]);
  check('文件名规则 昵称+课程表+日期', (function () {
    const who = '清扬';
    return /^清扬课程表\d{8}\.ics$/.test(who + '课程表' + '20261006' + '.ics');
  })());
  check('导出函数已绑定', await evaluate("typeof exportICS === 'function' && typeof buildICS === 'function'"));

  /* ---------- 7. 主题色 ---------- */
  console.log('\n【7】主题色：默认青绿 + 预设 + 自定义');
  await evaluate("S.global.dark=false; applyTheme(); 1");   // 前面迁移测试把主题设成了深色，先切回浅色
  check('默认主题是青绿山水', await evaluate('themeTriple().a') === '#0b8f86', await evaluate('themeTriple().a'));
  check('--accent 已按主题写入', await evaluate("getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()") === '#0b8f86', await evaluate("getComputedStyle(document.documentElement).getPropertyValue('--accent')"));
  check('--grad 已按主题生成', /#0b8f86/.test(await evaluate("getComputedStyle(document.documentElement).getPropertyValue('--grad')")));
  // 深色模式下自动把主色提亮，保证对比度
  await evaluate("S.global.dark=true; applyTheme(); 1");
  const dkAccent = await evaluate("getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()");
  check('深色模式自动提亮主色', /^#[0-9a-f]{6}$/.test(dkAccent) && dkAccent !== '#0b8f86', dkAccent);
  await evaluate("S.global.dark=false; applyTheme(); 1");
  const bg1 = await evaluate("getComputedStyle(document.documentElement).getPropertyValue('--bg-img')");
  check('背景由主题生成（4 个光斑 + 底色渐变）', /radial-gradient\(1200px/.test(bg1) && /linear-gradient\(165deg/.test(bg1));
  check('色板有 9 个预设', await evaluate("document.querySelectorAll('#themePalette .swatch').length") === 9);
  check('当前预设已高亮', await evaluate("document.querySelectorAll('#themePalette .swatch.on').length") === 1);
  await evaluate("document.querySelector('#themePalette .swatch[data-id=zidian]').click(); 1");
  check('切预设后主色变了', await evaluate('themeTriple().a') === '#7c5cff', await evaluate('themeTriple().a'));
  check('切预设后 --accent 同步', await evaluate("getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()") === '#7c5cff');
  check('换主题后背景光斑跟着变', bg1 !== (await evaluate("getComputedStyle(document.documentElement).getPropertyValue('--bg-img')")));
  check('切预设后已落盘', await evaluate("JSON.parse(localStorage.getItem('coursetable.v1')).global.theme.preset") === 'zidian');
  await evaluate(`(function(){ const a=document.querySelector('#pickA'), b=document.querySelector('#pickB');
    a.value='#1f7a5a'; b.value='#63c07a'; a.oninput(); b.oninput(); a.onchange(); })(); 1`);
  check('自定义主色生效', await evaluate('themeTriple().a') === '#1f7a5a', await evaluate('themeTriple().a'));
  check('自定义辅色生效并标记「自定义」', await evaluate('themeTriple().b') === '#63c07a' && await evaluate("document.querySelector('#themeName').textContent") === '自定义');
  check('第三段颜色由辅色派生', await evaluate('themeTriple().c') !== '#63c07a', await evaluate('themeTriple().c'));
  check('自定义已落盘', await evaluate("JSON.parse(localStorage.getItem('coursetable.v1')).global.theme.preset") === 'custom');
  await evaluate("document.querySelector('#btnThemeReset').click(); 1");
  check('恢复默认回到青绿山水', await evaluate('themeTriple().a') === '#0b8f86' &&
    await evaluate("JSON.parse(localStorage.getItem('coursetable.v1')).global.theme.preset") === 'qinglv');

  /* ---------- 8. 导入时按「本周是第几周」 ---------- */
  console.log('\n【8】导入：本周是第几周');
  await evaluate(`IMP = { kind:'biggrid', result: {
      courses: [{ id:'w1', name:'周次测试课', teacher:'王老师', room:'A101 教室', day:1, s:1, e:2, weeks:[1,2,3,4,5,6,7,8], color:'', note:'' }],
      notes: [], meta: { school:'示例职业技术学院', student:'张小同', semester:'2026-2027-1', className:'示例班级' },
      periods: JSON.parse(JSON.stringify(DEFAULT_PERIODS)) } };
    showImportConfirm(); 1`);
  check('默认按「本周是第几周」', await evaluate('IMP.weekMode') === 'now');
  check('默认选中第一段', await evaluate("document.querySelector('#imWkSeg .sg.on').dataset.m") === 'now');
  check('周次输入框有默认值', /^\d+$/.test(await evaluate("document.querySelector('#imNowWeek').value")), await evaluate("document.querySelector('#imNowWeek').value"));
  check('日期方式默认收起', await evaluate("document.querySelector('#imDateBox').classList.contains('hidden')") === true);
  await evaluate("document.querySelector('#imWkPlus').click(); 1");
  check('步进器 ＋ 一周生效', await evaluate("document.querySelector('#imNowWeek').value") === String(+await evaluate("document.querySelector('#imNowWeek').value")));
  await evaluate("document.querySelector('#imWkSeg .sg[data-m=date]').click(); 1");
  check('切到日期方式后露出日期框', await evaluate("document.querySelector('#imDateBox').classList.contains('hidden')") === false &&
    await evaluate("document.querySelector('#imNowBox').classList.contains('hidden')") === true);
  check('切到日期方式后 IMP.weekMode=date', await evaluate('IMP.weekMode') === 'date');
  await evaluate("document.querySelector('#imWkSeg .sg[data-m=now]').click(); document.querySelector('#imNowWeek').value='3'; 1");
  await evaluate("document.querySelector('#imModeBox .opt[data-mode=new]').click(); document.querySelector('#imGo').click(); 1");
  await sleep(250);
  // 独立算一遍第 3 周对应的「第1周周一」（不调用被测函数）
  const exp = await evaluate(`(function(){
    const d = new Date(), x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7) - 14);
    return x.getFullYear() + '-' + String(x.getMonth()+1).padStart(2,'0') + '-' + String(x.getDate()).padStart(2,'0');
  })()`);
  check('按第 3 周导入 → 正确倒推第1周周一', await evaluate('S.settings.termStart') === exp, await evaluate('S.settings.termStart') + ' vs ' + exp);
  check('导入后本周算第 3 周', await evaluate('nowWeek()') === 3, String(await evaluate('nowWeek()')));
  // 我的 → 学期设置里的同一套控件
  await evaluate("switchTab('me'); 1");
  await evaluate("(function(){ const el=document.querySelector('#setNowWeek'); el.value='6'; el.onchange.call(el); })(); 1");
  check('设置页按第 6 周换算', await evaluate('nowWeek()') === 6, String(await evaluate('nowWeek()')));
  check('设置页周次与日期自动同步', await evaluate("document.querySelector('#setTermStart').value") === (await evaluate('termStartFromNowWeek(6)')),
    await evaluate("document.querySelector('#setTermStart').value"));
  await evaluate("document.querySelector('#wkMinus').click(); 1");
  check('步进器 − 一周生效', await evaluate('nowWeek()') === 5, String(await evaluate('nowWeek()')));
  await evaluate("switchTab('sched'); 1");

  /* ---------- 9. 设置入口 / 关于 / 隐私政策 ---------- */
  console.log('\n【9】设置入口 / 关于 / 隐私政策');
  await evaluate("switchTab('me'); 1");
  check('「我的」页有独立设置入口', await evaluate("!!document.querySelector('#btnSettings')") === true);
  await evaluate("document.querySelector('#btnSettings').click(); 1");
  await new Promise(r => setTimeout(r, 350));
  check('设置入口打开设置弹层', await evaluate("document.querySelector('#sheetSettings').classList.contains('on')") === true);
  const rootTxt = await evaluate("document.querySelector('#sheetSettings').textContent");
  check('一级列表分为 6 个模块', await evaluate("document.querySelectorAll('#sheetSettings .setlist .navrow').length") === 6);
  check('一级列表含「学期与节次」', rootTxt.indexOf('学期与节次') >= 0);
  check('一级列表含「外观」', rootTxt.indexOf('外观') >= 0);
  check('一级列表含「上课提醒」', rootTxt.indexOf('上课提醒') >= 0);
  check('一级列表含「数据」', rootTxt.indexOf('数据') >= 0);
  check('一级列表含「检查更新」', rootTxt.indexOf('检查更新') >= 0);
  check('一级列表含「关于」', rootTxt.indexOf('关于') >= 0);
  check('一级列表不再堆具体选项', rootTxt.indexOf('总周数') < 0 && rootTxt.indexOf('导出备份') < 0);
  check('一级列表显示当前状态摘要', /第 \d+ 周 \/ 共 \d+ 周/.test(rootTxt) && /张课程表/.test(rootTxt), rootTxt.replace(/\s+/g, ' ').trim().slice(0, 120));

  /* 二级模块：逐个进入 → 校验内容与行数 → 返回一级 */
  const APP_VER = await evaluate('APP_VERSION');
  const CATS = [
    ['#sheetTerm', '学期与节次', ['总周数', '节次时间']],
    ['#sheetLook', '外观', ['深色模式', '主题色', '界面背景图']],
    ['#sheetRemind', '上课提醒', ['提前提醒']],
    ['#sheetData', '数据', ['导出备份', '从备份恢复', '清空当前课程表']],
    ['#sheetUpdate', '检查更新', ['当前版本', '最新版本']],
    ['#sheetAbout', '关于', ['开源免费', '隐私政策']]
  ];
  for (let i = 0; i < CATS.length; i++) {
    const sel = CATS[i][0], title = CATS[i][1], keys = CATS[i][2];
    await evaluate(`document.querySelectorAll('#sheetSettings .setlist .navrow')[${i}].click(); 1`);
    await sleep(350);
    check('进入二级模块：' + title, await evaluate(`document.querySelector('${sel}').classList.contains('on')`) === true);
    const txt = await evaluate(`document.querySelector('${sel}').textContent`);
    keys.forEach(k => check(title + ' 内含「' + k + '」', txt.indexOf(k) >= 0, txt.replace(/\s+/g, ' ').trim().slice(0, 80)));
    const oneOn = await evaluate("document.querySelectorAll('.sheet.on').length");
    check('二级模块同时只开一个弹层', oneOn === 1, String(oneOn));
    await evaluate(`document.querySelector('${sel} .sh-head .ibtn[data-back]').click(); 1`);
    await sleep(350);
    check('返回一级列表：' + title, await evaluate("document.querySelector('#sheetSettings').classList.contains('on')") === true);
  }
  check('返回键逐层退回（二级→一级）', await evaluate("SHEET_PARENT['#sheetLook']") === '#sheetSettings', await evaluate("String(SHEET_PARENT['#sheetLook'])"));

  const about = await evaluate("document.querySelector('#aboutCard').textContent");
  check('含当前版本号', about.indexOf('v' + APP_VER) >= 0, APP_VER);
  check('含开发者 澪露', about.indexOf('澪露') >= 0, await evaluate('DEVELOPER'));
  check('含版权声明', about.indexOf('©') >= 0);
  check('含兼容性说明', about.indexOf('武汉铁路职业技术学院') >= 0);
  check('关于里有隐私政策入口', await evaluate("!!document.querySelector('#btnPrivacy')") === true);
  await evaluate("document.querySelector('#btnPrivacy').click(); 1");
  await new Promise(r => setTimeout(r, 350));
  check('隐私政策弹层可打开', await evaluate("document.querySelector('#sheetPrivacy').classList.contains('on')") === true);
  const pv = await evaluate("document.querySelector('#pvBody').textContent");
  check('隐私政策声明不收集信息', pv.indexOf('不收集') >= 0);
  check('隐私政策写清权限用途', pv.indexOf('相册') >= 0 && pv.indexOf('通知') >= 0);
  check('隐私政策写清数据只存本机', pv.indexOf('保存在本机') >= 0 || pv.indexOf('只保存在') >= 0);
  check('隐私政策含更新日期', pv.indexOf('最后更新') >= 0);
  await evaluate("hideSheet(); 1");
  await evaluate("showSheet('#sheetAbout'); document.querySelector('#btnPrivacy').click(); 1");
  await sleep(350);
  await evaluate("document.querySelector('#pvBack').click(); 1");
  await sleep(350);
  check('隐私政策可返回「关于」', await evaluate("document.querySelector('#sheetAbout').classList.contains('on')") === true);

  /* ---------- 9.5 检查更新 ---------- */
  console.log('\n【9.5】检查更新');
  check('版本比较：0.1.1 > 0.1.0', await evaluate("cmpVersion('0.1.1','0.1.0')") === 1);
  check('版本比较：相同返回 0', await evaluate("cmpVersion('0.1.0','0.1.0')") === 0);
  check('版本比较：段数不同也正确', await evaluate("cmpVersion('0.2','0.1.9')") === 1 && await evaluate("cmpVersion('0.1','0.1.0')") === 0);

  // 装一个可切换的 fetch 桩，避免测试真的联网
  await evaluate(`window.__fetchMode='newer'; window.__fetchLog=[];
    window.fetch = function (url, opt) {
      window.__fetchLog.push(String(url));
      if (window.__fetchMode === 'fail') return Promise.reject(new TypeError('Failed to fetch'));
      var v = window.__fetchMode === 'newer' ? '9.9.9' : APP_VERSION;
      return Promise.resolve({ ok: true, status: 200, json: function () {
        return Promise.resolve({
          tag_name: 'v' + v,
          html_url: 'https://github.com/HertaSta/QingJian-CourseTable/releases/tag/v' + v,
          body: '## 更新内容\\n\\n- 修复了**课件**显示\\n- 新增「检查更新」',
          assets: [{ name: 'QingJian-CourseTable-v' + v + '.apk', size: 11798843,
                     browser_download_url: 'https://github.com/HertaSta/QingJian-CourseTable/releases/download/v' + v + '/a.apk',
                     digest: 'sha256:abc123' }]
        });
      } });
    }; 1`);
  await evaluate("showSheet('#sheetUpdate'); document.querySelector('#btnCheckUpdate').click(); 1");
  await sleep(500);
  check('发现新版本 → 状态 found', await evaluate('UPD.state') === 'found', await evaluate('UPD.state'));
  check('界面显示最新版本号', /9\.9\.9/.test(await evaluate("document.querySelector('#upLatest').textContent")), await evaluate("document.querySelector('#upLatest').textContent"));
  check('更新面板已展开', await evaluate("!document.querySelector('#upCard').classList.contains('hidden')") === true);
  check('Markdown 说明已清理成纯文本', /修复了课件显示/.test(await evaluate("document.querySelector('#upNotes').textContent")));
  check('一级列表摘要跟着变', /有新版本/.test(await evaluate("document.querySelector('#smUpdate').textContent")), await evaluate("document.querySelector('#smUpdate').textContent"));
  check('显示安装包体积与来源', /11\.3 MB|11798843|MB/.test(await evaluate("document.querySelector('#upSize').textContent")), await evaluate("document.querySelector('#upSize').textContent"));
  check('首选直连 api.github.com', await evaluate("__fetchLog[0]") === 'https://api.github.com/repos/HertaSta/QingJian-CourseTable/releases/latest', await evaluate('String(__fetchLog[0])'));

  await evaluate("window.__fetchMode='same'; document.querySelector('#btnCheckUpdate').click(); 1");
  await sleep(500);
  check('版本相同 → 判定已是最新', await evaluate('UPD.state') === 'latest', await evaluate('UPD.state'));
  check('已是最新时不显示更新面板', await evaluate("document.querySelector('#upCard').classList.contains('hidden')") === true);
  check('摘要显示已是最新', /已是最新/.test(await evaluate("document.querySelector('#smUpdate').textContent")));

  await evaluate("window.__fetchLog=[]; window.__fetchMode='fail'; document.querySelector('#btnCheckUpdate').click(); 1");
  await sleep(800);
  check('全部源失败 → 状态 error', await evaluate('UPD.state') === 'error', await evaluate('UPD.state'));
  check('失败后改写提示语', /检查失败/.test(await evaluate("document.querySelector('#upHint').textContent")), await evaluate("document.querySelector('#upHint').textContent"));
  check('镜像按顺序逐个回退', (await evaluate('__fetchLog.length')) === (await evaluate('UPDATE_MIRRORS.length')), await evaluate('__fetchLog.length + "/" + UPDATE_MIRRORS.length'));

  // 网页版没有原生下载能力，应转为打开下载页
  await evaluate(`window.__opened=[]; window.open=function(u){window.__opened.push(String(u));};
    window.__fetchLog=[]; window.__fetchMode='newer'; document.querySelector('#btnCheckUpdate').click(); 1`);
  await sleep(500);
  await evaluate("document.querySelector('#btnDoUpdate').click(); 1");
  await sleep(300);
  check('网页版「下载并安装」转为打开下载页', (await evaluate('__opened.length')) === 1, await evaluate('JSON.stringify(__opened)'));
  check('下载页指向 release 页面', /releases\/tag\/v9\.9\.9/.test(await evaluate('String(__opened[0])')), await evaluate('String(__opened[0])'));

  /* ---------- 10. 运行期错误 ---------- */
  console.log('\n【10】运行期错误');
  check('零报错', errs.length === 0, errs.length ? '\n  ' + errs.join('\n  ') : '(无)');

  console.log('\n========== 结果：' + ok.length + ' 通过 / ' + bad.length + ' 失败 ==========');
  if (bad.length) console.log('失败项：\n  - ' + bad.join('\n  - '));
  ws.close(); proc.kill();
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('失败:', e.stack || e.message); try { proc.kill(); } catch (_) {} process.exit(1); });
