/* 生成一份「预置数据」的演示 html，用于截图核对视觉；不参与最终交付 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const XLSX = require('xlsx');

const DIR = path.resolve(__dirname, '..');
const single = fs.readFileSync(path.join(DIR, '清笺课程表.html'), 'utf8');
const srcHtml = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');

// ---- 1) 用 App 自己的解析逻辑跑一遍真实 Excel ----
const code = srcHtml.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1] +
  '\n;window.__t={get S(){return S;},get IMP(){return IMP;}};';
const dom = new JSDOM(srcHtml.replace(/<script src="xlsx\.full\.min\.js"><\/script>/, ''),
  { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
const w = dom.window; w.XLSX = XLSX;
w.eval(code);
const srcFile = process.argv[2];
if (!srcFile) {
  console.error('用法：node dev/make-demo.js <课程表.xlsx>');
  console.error('需要传入一份教务系统导出的课程表文件，用来生成带演示数据的 _demo.html（截图核对用，已脱敏）。');
  process.exit(1);
}
const wb = XLSX.readFile(srcFile, { raw: false });
const ws = wb.Sheets[wb.SheetNames[0]];
const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '', raw: false });
const merges = (ws['!merges'] || []).map(x => ({ r1: x.s.r, c1: x.s.c, r2: x.e.r, c2: x.e.c }));
w.eval('analyze(' + JSON.stringify(aoa) + ',' + JSON.stringify(merges) + ',"demo.xlsx")');
w.eval('doImport()');
const S = w.__t.S;
const main = S.tables && S.tables[0];
const courses = main ? main.courses : S.courses;
const notes = main ? main.notes : S.notes;
const settings = main ? main.settings : S.settings;
// 让「今天」正好落在第 3 周，方便截图核对
settings.termStart = '2026-09-21';
settings.semester = '2026-2027-1';
const periods = JSON.parse(JSON.stringify(settings.periods));

// ---- 演示用：抹掉可能暴露身份的信息（姓名 / 学校 / 班级 / 教师名），只保留课程结构 ----
settings.student = '同学';
settings.school = '示例职业技术学院';
settings.className = '示例班级';
const tmap = {};
const TNAMES = ['张老师', '李老师', '王老师', '赵老师', '陈老师', '刘老师', '杨老师', '周老师'];
let ti = 0;
courses.forEach(c => {
  if (!c.teacher) return;
  if (!tmap[c.teacher]) tmap[c.teacher] = TNAMES[ti++ % TNAMES.length];
  c.teacher = tmap[c.teacher];
});
(notes || []).forEach(n => { if (n.teacher) n.teacher = '张老师'; });
// 教室也换成通用示例（原值含学校楼栋代号）
const rmap = {};
const ROOMS = ['A101 阶梯教室', 'B203 多媒体教室', 'C305 实训室', 'D402 机房', 'E501 语音室'];
let ri = 0;
courses.forEach(c => {
  if (!c.room) return;
  if (!rmap[c.room]) { const r = ROOMS[ri++ % ROOMS.length]; rmap[c.room] = r; }
  c.room = rmap[c.room]; c.roomShort = rmap[c.room];
});

// 第二份课表（演示多课表切换）
const oldSettings = Object.assign({}, JSON.parse(JSON.stringify(settings)), {
  termStart: '2026-03-02', semester: '2025-2026-2', student: '同学', className: '示例班级', school: '示例职业技术学院'
});
const oldCourses = [
  { id: 'o1', name: '经济法基础', teacher: '张老师', room: 'A101 阶梯教室', roomShort: 'A101 阶梯教室', day: 1, s: 1, e: 2, weeks: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16], color: '#3b82f6', note: '' },
  { id: 'o2', name: '统计学原理', teacher: '李老师', room: 'B302 多媒体教室', roomShort: 'B302 多媒体教室', day: 3, s: 3, e: 4, weeks: [1,2,3,4,5,6,7,8], color: '#22c55e', note: '' }
];

const seed = {
  v: 2,
  profile: {
    nickname: '同学',
    avatar: '',
    signature: '',
    birthday: ''
  },
  global: { dark: false, showWeekend: true, remind: 10, bgImage: '', bgDim: 36 },
  tables: [
    { id: 't-main', name: (settings.semester + ' ' + (settings.className || '')).trim(), courses: courses, notes: notes, settings: settings, createdAt: Date.now() },
    { id: 't-old',  name: '上学期 · 2025-2026-2', courses: oldCourses, notes: [], settings: Object.assign({}, oldSettings, { periods: periods }), createdAt: Date.now() - 86400000 }
  ],
  activeId: 't-main'
};
w.close();

// ---- 2) 把数据写进单文件 html（在主脚本之前注入，这样 App 启动即读到） ----
const inject = '<script>try{localStorage.setItem("coursetable.v1",' +
  JSON.stringify(JSON.stringify(seed)) + ');}catch(e){}</script>\n';
// 同样用函数形式替换，避免 $& 被展开
const out = single.replace('<body>', () => '<body>\n' + inject);
fs.writeFileSync(path.join(DIR, '_demo.html'), out, 'utf8');
console.log('演示文件已生成: _demo.html   课程 ' + courses.length + ' 条 / 学期起始 ' + settings.termStart +
            ' / 课表 ' + seed.tables.length + ' 份 / 演示背景：关');
