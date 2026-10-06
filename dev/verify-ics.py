# -*- coding: utf-8 -*-
"""用 icalendar 实跑解析导出的 .ics，核对事件、时间与折行。"""
import sys, re, os
from datetime import datetime, timezone, timedelta
from icalendar import Calendar

# 默认优先核对「真实课表」导出的文件（dev/make-ics.js 生成），没有再退回 feature-test 的合成数据
_default = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '_real_out.ics')
if not os.path.exists(_default):
    _default = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '_test_out.ics')
path = sys.argv[1] if len(sys.argv) > 1 else _default
print('核对文件      :', os.path.basename(path))
raw = open(path, 'rb').read()

print('文件大小      :', len(raw), '字节')
print('BOM           :', '有(!)' if raw[:3] == b'\xef\xbb\xbf' else '无')
print('CRLF 行尾     :', '是' if b'\r\n' in raw else '否')
print('裸露 LF       :', len(re.findall(rb'(?<!\r)\n', raw)), '处（应为 0）')

cal = Calendar.from_ical(raw)     # 关键：真实解析一遍
print('解析结果      : 成功（icalendar 未报错）')
print('PRODID        :', str(cal.get('PRODID')))
print('CALSCALE      :', str(cal.get('CALSCALE')))
print('X-WR-CALNAME  :', str(cal.get('X-WR-CALNAME')))
print('VTIMEZONE     :', '存在(!)' if 'VTIMEZONE' in raw.decode('utf-8', 'ignore') else '无（符合要求）')

events = [c for c in cal.walk('VEVENT')]
print('事件总数      :', len(events))

missing = []
for e in events:
    for k in ('UID', 'DTSTAMP', 'DTSTART', 'DTEND', 'SUMMARY'):
        if k not in e:
            missing.append((str(e.get('SUMMARY')), k))
print('必填字段缺失  :', missing if missing else '无')

# 抽样打印前 3 条
for e in events[:3]:
    ds = e.decoded('DTSTART'); de = e.decoded('DTEND')
    print('  ·', str(e.get('SUMMARY')))
    print('     时间(UTC) :', ds.strftime('%Y-%m-%d %H:%M'), '→', de.strftime('%Y-%m-%d %H:%M'))
    print('     换算北京 :', (ds.astimezone(timezone(timedelta(hours=8)))).strftime('%Y-%m-%d %H:%M'),
          '→', (de.astimezone(timezone(timedelta(hours=8)))).strftime('%H:%M'))
    print('     地点      :', str(e.get('LOCATION')))
    print('     描述      :', str(e.get('DESCRIPTION')).replace('\n', ' / '))

# ---- 不变量校验（对任意真实导出都成立，不依赖具体课名 / 周次，避免数据一变就误报）----

# ① 每条事件的时长必须为正：守住 splitRange 在跨度装不下 n 节时算出负数时间的缺陷
bad_dur = []
for e in events:
    ds = e.decoded('DTSTART'); de = e.decoded('DTEND')
    if de <= ds:
        bad_dur.append((str(e.get('SUMMARY')), ds.strftime('%Y-%m-%d %H:%M'), de.strftime('%H:%M')))
print('时长非正的事件:', bad_dur[:3] if bad_dur else '无（全部 DTEND > DTSTART）')

# ② 同一门课、同一时刻不应出现两条：查出重复导出
seen = {}
dups = []
for e in events:
    k = (str(e.get('SUMMARY')), e.decoded('DTSTART'))
    if k in seen:
        dups.append((k[0], k[1].strftime('%Y-%m-%d %H:%M')))
    seen[k] = 1
print('重复的事件    :', dups[:3] if dups else '无')

# ③ 样例课程若在，仅作信息展示（不硬编码周次，真实课表同一门课可能分布在多个星期/大节）
sample = [e for e in events if str(e.get('SUMMARY')) == '企业财务会计Ⅰ']
if sample:
    from collections import Counter
    by_day = Counter()
    for e in sample:
        m = re.search(r'星期(\S)', str(e.get('DESCRIPTION')))
        by_day[m.group(1) if m else '?'] += 1
    print('企业财务会计Ⅰ :', len(sample), '次，按星期分布', dict(by_day))
else:
    print('企业财务会计Ⅰ : 未出现 —— 本次输入不是真实课表导出的数据，跳过样例展示')

# 校验折行：所有物理行 ≤75 字节
lines = raw.split(b'\r\n')
over = [(i, len(l)) for i, l in enumerate(lines) if len(l) > 75]
print('超 75 字节的行 :', over if over else '无（全部合规）')

# 校验多字节字符没被切断：解码后不应出现替换字符
txt = raw.decode('utf-8')
print('UTF-8 解码    :', '成功，无乱码' if '\ufffd' not in txt else '失败(!)')

# 折行还原后，超长字段应能完整拼回（不依赖具体课名）
joined = re.sub(rb'\r\n ', b'', raw)
lost = [str(e.get('SUMMARY')) for e in events
        if len(str(e.get('SUMMARY')).encode('utf-8')) > 75
        and str(e.get('SUMMARY')).encode('utf-8') not in joined]
print('折行还原      :', '所有超长字段都完整' if not lost else '丢失(!) ' + str(lost[:3]))
print('\n结论：', '全部通过 ✓' if not missing and not over and not lost and not bad_dur and not dups else '有问题，见上')
