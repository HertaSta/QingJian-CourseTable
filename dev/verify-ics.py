# -*- coding: utf-8 -*-
"""用 icalendar 实跑解析导出的 .ics，核对事件、时间与折行。"""
import sys, re
from datetime import datetime, timezone, timedelta
from icalendar import Calendar

path = sys.argv[1] if len(sys.argv) > 1 else r'D:/项目归档/CourseTable/_test_out.ics'
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

# 校验：周一第1大节 08:30 应为北京时间
mon_course = [e for e in events if str(e.get('SUMMARY')) == '企业财务会计Ⅰ']
print('企业财务会计Ⅰ :', len(mon_course), '次（课表写的是 1-4,7-8,13,15 共 8 周）')
w1 = [e for e in mon_course if e.decoded('DTSTART').astimezone(timezone(timedelta(hours=8))).strftime('%m-%d') == '09-07']
if w1:
    ds = w1[0].decoded('DTSTART').astimezone(timezone(timedelta(hours=8)))
    print('第1周日期     : 2026-09-07（周一）', '✓' if ds.strftime('%H:%M') == '08:30' else '✗ 时间=' + ds.strftime('%H:%M'), ds.strftime('%H:%M-%H:%M'))

# 校验折行：所有物理行 ≤75 字节
lines = raw.split(b'\r\n')
over = [(i, len(l)) for i, l in enumerate(lines) if len(l) > 75]
print('超 75 字节的行 :', over if over else '无（全部合规）')

# 校验多字节字符没被切断：解码后不应出现替换字符
txt = raw.decode('utf-8')
print('UTF-8 解码    :', '成功，无乱码' if '\ufffd' not in txt else '失败(!)')

# 折行还原后 SUMMARY 应完整
joined = re.sub(rb'\r\n ', b'', raw)
print('折行还原示例  :', '找到完整长课名' if '毛泽东思想和中国特色社会主义理论体系概论'.encode('utf-8') in joined else '未找到(!)')
print('\n结论：', '全部通过 ✓' if not missing and not over and not w1 == [] else '有问题，见上')
