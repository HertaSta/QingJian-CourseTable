/* 启动雷电模拟器之前必须先跑这个：本机物理内存只有 15.3 GB，模拟器配置 memorySize=2048 + 4 核，
   宿主再叠加 LdVBoxHeadless 的开销，留给模拟器的余量不够时它会边启动边崩（VBox 日志里是
   "Giving up catch-up attempt at a 60 000 000 000 ns lag"，表现就是永远不 boot_completed）。
   门槛：空闲物理内存 >= 4 GB 且 空闲虚拟内存（含页面文件）>= 4 GB。
   不满足就退出码 2，不要启动模拟器，改用 Edge headless + CDP 做网页侧验证。
   用法：node dev\_memcheck.js        只报告
        node dev\_memcheck.js --gate   不满足时退出码 2（脚本串联用）
*/
const { execFileSync } = require('child_process');

const MIN_FREE_PHYS_GB = 4.0;
const MIN_FREE_VIRT_GB = 4.0;

function readMem() {
  const ps = [
    '$os = Get-CimInstance Win32_OperatingSystem;',
    '"{0}|{1}|{2}" -f ($os.FreePhysicalMemory/1MB), ($os.TotalVisibleMemorySize/1MB), ($os.FreeVirtualMemory/1MB)',
  ].join(' ');
  const out = execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' }).trim();
  const [freePhys, totalPhys, freeVirt] = out.split('|').map(Number);
  return { freePhys, totalPhys, freeVirt };
}

const m = readMem();
const gb = n => Math.round(n * 10) / 10;
const okPhys = m.freePhys >= MIN_FREE_PHYS_GB;
const okVirt = m.freeVirt >= MIN_FREE_VIRT_GB;
const pass = okPhys && okVirt;

console.log('内存检查（启动雷电模拟器前）');
console.log(`  空闲物理内存 : ${gb(m.freePhys)} GB / 共 ${gb(m.totalPhys)} GB（门槛 ${MIN_FREE_PHYS_GB} GB）${okPhys ? ' OK' : ' 不足'}`);
console.log(`  空闲虚拟内存 : ${gb(m.freeVirt)} GB（门槛 ${MIN_FREE_VIRT_GB} GB）${okVirt ? ' OK' : ' 不足'}`);
if (pass) {
  console.log('  结论：可以启动模拟器');
} else {
  console.log('  结论：不要启动模拟器 —— 内存在此环境下会让它启动到一半崩掉。');
  console.log('        改用 Edge headless + CDP 做网页侧验证，APK 侧只做静态校验（aapt2 + 解包比对）。');
}

if (process.argv.includes('--gate') && !pass) process.exit(2);
