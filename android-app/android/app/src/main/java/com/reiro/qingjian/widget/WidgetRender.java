package com.reiro.qingjian.widget;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.text.TextPaint;
import android.text.TextUtils;

import java.time.LocalDate;
import java.util.List;

/**
 * 小组件的绘制层。
 *
 * 两种小组件都画成一张位图（RemoteViews 里只有一个 ImageView）：
 * 一是排版完全可控；二是「可拉伸」实现起来最简单——宿主改尺寸时会回调
 * onAppWidgetOptionsChanged，我们按新的宽高重新画一张就行。
 *
 * 卡片底的不透明度由设置页的「小组件不透明度」控制（d.alpha）。
 */
public class WidgetRender {

    private static final String[] DAY_CN = {"一", "二", "三", "四", "五", "六", "日"};

    /* ---------------- 配色 ---------------- */

    static class Theme {
        int card, primary, secondary, tertiary, line, accent, accentSoft, chipText;
        float den;
        boolean dark;

        static Theme of(WidgetData d, float den) {
            Theme t = new Theme();
            t.den = den;
            t.dark = d.dark;
            t.card = cardColor(d, d.alpha);
            if (d.dark) {
                t.primary = 0xFFF3F5F8;
                t.secondary = 0xFF98A2AE;
                t.tertiary = 0xFF6F7885;
                t.line = 0x22FFFFFF;
                t.chipText = 0xFFFFFFFF;
            } else {
                t.primary = 0xFF1B1F24;
                t.secondary = 0xFF77808C;
                t.tertiary = 0xFF9AA2AD;
                t.line = 0x17000000;
                t.chipText = 0xFFFFFFFF;
            }
            t.accent = d.accent;
            t.accentSoft = withAlpha(d.accent, d.dark ? 0x33 : 0x1F);
            return t;
        }

        /** alpha 0~1 的白（或深灰）卡底 */
        static int cardColor(WidgetData d, float alpha) {
            float a = Math.max(0.25f, Math.min(1f, alpha));
            int A = Math.round(a * 255f) << 24;
            return A | (d.dark ? 0x1C1F24 : 0xFFFFFF);
        }
    }

    /* ================================================================
       小组件一：今天 + 明天（左右两栏，见下方 todayHead / todayPairRow /
       todayPairEmpty / drawCell）

       早先这里是 twoDays()：把两天的课画成一张整图，高度一压窄就只能
       靠 drawDayColumn() 砍内容——先砍时间、再砍教室，最后只剩课名。
       现在改成「表头位图 + ListView 行」，一行 = 左今天一格 + 右明天一格，
       行高按内容定，卡片再扁也只是少露几行、由桌面滚动。
       ================================================================ */

    /* ================================================================
       小组件二：本周课表（课表主体的缩小版，可上下滚动）

       拆成三块：
         · weekHead()  固定表头（日期 + 星期行），不参与滚动
         · weekRow()   表体的一个节次切片，由 ListView 逐行承载
         · cardBg()    圆角卡底，垫在 ListView 下面（RemoteViews 没法给容器加圆角）
       跨节课程块在行边界不画圆角，上下两片拼起来就是一块连续的颜色。
       ================================================================ */

    static final float WEEK_PAD = 10f, WEEK_GUT = 32f, WEEK_HEAD = 52f;
    /** 表体底部留白，与 widget_week.xml 里 ListView 的 paddingBottom 保持一致 */
    static final float WEEK_BOTTOM = 14f;

    /**
     * 左侧节次列的实际宽度（px）。
     * 4×3 的小组件只有 250dp 宽，减去 10dp 边距和 32dp 节次列，每列只剩 28dp,
     * 「毛泽东思想概论」这种长课名会被截成两个字。窄卡片时把节次列收窄，把地方还给星期列。
     */
    static float gutPx(int w, float den) {
        float dpW = w / den;
        // 节次列也再收窄一点：它只放「节号 / 开始 / 结束」三个短串，
        // 收窄 3~6dp 就能给 7 天各多腾出 1dp —— 字能大一号是划算的
        float g = dpW < 280 ? 22f : (dpW < 340 ? 26f : WEEK_GUT);
        return dp(den, g);
    }

    /**
     * 表头右上角两个翻周按钮的尺寸与位置（px）。
     * 表头位图里画箭头，layout 里同一位置叠两个透明可点控件——
     * RemoteViews 没法给一张 ImageView 的局部区域单独挂点击，只能这样配合。
     *
     * 从 26×20dp 放大到 32×32dp：原来那对细条太难点中，手指一偏就落到表头上，
     * 表头是「点开 App」的热区，于是变成「想翻周，结果跳进了 App」。
     * 现在按钮面积是原来的 2 倍，箭头也更大，命中率高得多。
     */
    static final float WEEK_BTN = 32f, WEEK_BTN_GAP = 4f, WEEK_BTN_TOP = 4f, WEEK_BTN_END = 8f;

    /** 第 i 个按钮（0=上一周, 1=下一周）的矩形 */
    static RectF weekBtnRect(int w, float den, int i) {
        float end = dp(den, WEEK_BTN_END);
        float bw = dp(den, WEEK_BTN);
        float gap = dp(den, WEEK_BTN_GAP);
        float right = w - end - (1 - i) * (bw + gap);
        float top = dp(den, WEEK_BTN_TOP);
        return new RectF(right - bw, top, right, top + bw);
    }

    /** 表头位图：顶栏（周次 + 日期区间 + 翻周按钮）+ 星期行。高度固定 WEEK_HEAD dp。 */
    public static Bitmap weekHead(WidgetData d, int w, float den, int offset) {
        if (w <= 0) return null;
        int hh = Math.round(dp(den, WEEK_HEAD));
        Bitmap bmp = Bitmap.createBitmap(w, hh, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(bmp);
        Theme t = Theme.of(d, den);

        LocalDate monday = d.weekMonday(offset);
        int wk = d.weekNo(monday);
        float pad = dp(den, WEEK_PAD);
        int cols = d.showWeekend ? 7 : 5;
        float gut = gutPx(w, den);
        float gx = pad + gut;
        float cw = (w - pad - gx) / cols;

        // ── 顶栏左：周次 + 日期区间。右侧留给两个翻周按钮
        float btnCy = dp(den, WEEK_BTN_TOP) + dp(den, WEEK_BTN) / 2f;
        float textRight = weekBtnRect(w, den, 0).left - dp(den, 6);
        Paint wkP = text(den, 12f, t.accent, true);
        String wkStr = (wk >= 1 && wk <= d.totalWeeks) ? ("第 " + wk + " 周") : "未开学";
        c.drawText(wkStr, pad, btnCy - (wkP.ascent() + wkP.descent()) / 2f, wkP);

        Paint rangeP = text(den, 9.2f, t.tertiary, false);
        LocalDate sunday = monday.plusDays(cols - 1);
        String range = (monday.getMonthValue() + "/" + monday.getDayOfMonth())
            + "-" + (sunday.getMonthValue() + "/" + sunday.getDayOfMonth());
        float rangeX = pad + wkP.measureText(wkStr) + dp(den, 7);
        if (rangeX + rangeP.measureText(range) <= textRight) {
            c.drawText(range, rangeX, btnCy - (rangeP.ascent() + rangeP.descent()) / 2f, rangeP);
        }

        // ── 顶栏右：上一周 / 下一周。
        // 按钮画成「半透明底 + 1dp 描边」的实心块，边界清楚，用户一眼知道该点哪儿；
        // 尺寸从 26×20dp 放大到 32×32dp，箭头从 13 号放大到 17 号。
        Paint arrowP = text(den, 17f, t.secondary, true);
        Paint arrowOn = text(den, 17f, t.accent, true);
        Paint btnBg = fill(withAlpha(t.dark ? 0xFFFFFF : 0x000000, t.dark ? 0x1E : 0x12));
        Paint btnLine = stroke(den, 1f, t.line);
        String[] arrows = {"\u2039", "\u203A"};
        for (int i = 0; i < 2; i++) {
            RectF r = weekBtnRect(w, den, i);
            float br = dp(den, 8);
            c.drawRoundRect(r, br, br, btnBg);
            c.drawRoundRect(r, br, br, btnLine);
            // 已经是最新一周时，「下一周」用强调色提示可以往后翻
            Paint p = (i == 1 && offset < 0) ? arrowOn : arrowP;
            c.drawText(arrows[i],
                r.centerX() - p.measureText(arrows[i]) / 2f,
                r.centerY() - (p.ascent() + p.descent()) / 2f, p);
        }

        Paint lineP = stroke(den, 1f, t.line);
        float sep = dp(den, WEEK_BTN_TOP) + dp(den, WEEK_BTN) + dp(den, 2);
        c.drawLine(pad, sep, w - pad, sep, lineP);

        // ── 星期行：「一 16」合成一行。原来分两行是为了塞得下，
        // 但那样每行都只有 8dp 高、字小得看不清；合成一行反而能放大到 10.2 号。
        int dow = LocalDate.now().getDayOfWeek().getValue();
        Paint dayP = text(den, 10.2f, t.secondary, true);
        Paint dayOn = text(den, 10.2f, t.accent, true);
        float dayBase = hh - dp(den, 4f);
        for (int i = 0; i < cols; i++) {
            float cx = gx + i * cw + cw / 2f;
            // 只有看的是本周时，才把今天高亮
            boolean isToday = offset == 0 && (i + 1) == dow;
            String s = (isToday ? "今" : DAY_CN[i]) + " " + monday.plusDays(i).getDayOfMonth();
            drawCentered(c, s, cx, dayBase, isToday ? dayOn : dayP);
        }
        c.drawLine(pad, hh - dp(den, 0.5f), w - pad, hh - dp(den, 0.5f), lineP);
        c.drawLine(gx - dp(den, 0.5f), sep, gx - dp(den, 0.5f), hh, lineP);
        return bmp;
    }

    /**
     * 表体每行的行高（px）。
     * 高度够就把整周铺满一屏（不出现滚动）；不够就压到最小行高，多出来的交给 ListView 滚。
     *
     * 最小行高从 22dp 抬到 44dp：22dp 一行时时间、教室两行根本放不下，只能丢信息。
     * 卡片被拉扁时宁可少露几节、让用户滚一下，也要把「几点、在哪、谁上」写全。
     */
    static float weekRowH(int h, int n, float den) {
        // 卡片够高（>=240dp）就把行高抬到 62dp：那时横向空间也宽，
        // 一行能写三行课名，长课名（「数据结构与算法」）就不用被截。
        // 代价是少露两行节次——反正已经可以滚，信息完整优先。
        float minRow = (h >= dp(den, 240)) ? dp(den, 62) : dp(den, 52);
        float bodyH = Math.max(minRow, h - dp(den, WEEK_HEAD) - dp(den, WEEK_BOTTOM));
        float rh = bodyH / Math.max(1, n);
        return Math.max(minRow, Math.min(dp(den, 76), rh));
    }

    /** 表体第 index 行：一个节次的横向切片，宽度与表头一致。offset 为翻周偏移（0=本周）。 */
    public static Bitmap weekRow(WidgetData d, int w, int index, float rowH, int n, float den, int offset) {
        if (w <= 0 || rowH <= 0 || index < 0 || index >= n) return null;
        int hh = Math.round(rowH);
        Bitmap bmp = Bitmap.createBitmap(w, hh, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(bmp);
        Theme t = Theme.of(d, den);

        LocalDate monday = d.weekMonday(offset);
        float pad = dp(den, WEEK_PAD);
        int cols = d.showWeekend ? 7 : 5;
        float gut = gutPx(w, den);
        float gx = pad + gut;
        float cw = (w - pad - gx) / cols;

        // ── 今天那一列淡底（只有看本周时才标今天）
        int todayIdx = LocalDate.now().getDayOfWeek().getValue() - 1;
        if (offset == 0 && todayIdx >= 0 && todayIdx < cols) {
            c.drawRect(gx + todayIdx * cw, 0, gx + (todayIdx + 1) * cw, hh, fill(t.accentSoft));
        }

        // ── 底部横向分隔线（叠起来正好是每条节次线）
        Paint lineP = stroke(den, 1f, t.line);
        c.drawLine(pad, hh - dp(den, 0.5f), w - pad, hh - dp(den, 0.5f), lineP);

        // ── 左侧节次列：序号 + 开始时间 + 结束时间（窄的时候自动缩字号，绝不越界压到课程块上）
        WidgetData.Period per = (index < d.periods.size()) ? d.periods.get(index) : null;
        Paint noP = text(den, 9.4f, t.secondary, true);
        Paint stP = text(den, 7.6f, t.tertiary, false);
        float gutW = gutPx(w, den);
        float gutCx = pad + gutW / 2f;
        float cy = hh / 2f;

        c.save();
        c.clipRect(pad, 0, pad + gutW, hh);
        String noStr = String.valueOf(per != null ? per.n : index + 1);
        String stStr = (per != null && per.start != null) ? per.start : "";
        String enStr = (per != null && per.end != null) ? per.end : "";
        // 三行都画得下时才画起止时间；行高不够就只留节号（宁可少一行，也不叠字）
        boolean showTime = rowH >= dp(den, 32) && !(stStr.isEmpty() && enStr.isEmpty());
        if (showTime) {
            drawCentered(c, noStr, gutCx, cy - dp(den, 9f), noP);
            drawCentered(c, stStr, gutCx, cy + dp(den, 1.5f), stP);
            drawCentered(c, enStr, gutCx, cy + dp(den, 9.5f), stP);
        } else {
            drawCentered(c, noStr, gutCx, cy - dp(den, 1.5f), noP);
            if (!stStr.isEmpty() && rowH >= dp(den, 20)) {
                drawCentered(c, stStr, gutCx, cy + dp(den, 7.5f), stP);
            }
        }
        c.restore();

        if (!d.synced) return bmp;

        // ── 课程块
        int p = index + 1;                       // 本行对应的节次（1 基）
        // 250dp 宽的卡片分到 7 天，每列只有 30dp 左右，7.9f 的字只能挤下两个字。
        // 列窄时把课名字号收缩到「至少放得下三个字」，下限 6.2f，再窄就交给省略号。
        // 字号从 7.9 抬到 9.2：原来那号字在 1080p 手机上基本看不清。
        // 下限仍保留收缩（列窄时缩到 7.8），但「放得下三个字」从硬指标改成软目标，
        // 真正的兜底交给「允许折行 + 行高加大 + 列表可滚」，不再靠省略号硬截。
        float nameSz = 9.2f;
        float innerW0 = cw - dp(den, 7);
        Paint probe = text(den, nameSz, t.chipText, true);
        while (nameSz > 7.8f && probe.measureText("毛泽东") > innerW0) {
            nameSz -= 0.3f;
            probe.setTextSize(nameSz * den);
        }
        Paint nameP = probe;
        float lineH = dp(den, 10.6f);
        float rad = dp(den, 4);

        for (int i = 0; i < cols; i++) {
            float x = gx + i * cw;
            for (WidgetData.Course co : d.coursesOf(monday.plusDays(i))) {
                if (co.s > p || co.e < p) continue;

                boolean first = (p == co.s);     // 跨节块的第一行
                boolean last = (p == co.e);      // 跨节块的最后一行
                float top = first ? dp(den, 1.5f) : 0;
                float bot = last ? dp(den, 1.5f) : 0;
                float hgt = rowH - top - bot;
                if (hgt <= 0) continue;

                RectF r = new RectF(x + dp(den, 1), top, x + cw - dp(den, 1), top + hgt);
                Path path = new Path();
                path.addRoundRect(r, new float[] {
                    first ? rad : 0, first ? rad : 0,      // 左上
                    first ? rad : 0, first ? rad : 0,      // 右上
                    last ? rad : 0, last ? rad : 0,        // 右下
                    last ? rad : 0, last ? rad : 0         // 左下
                }, Path.Direction.CW);
                c.drawPath(path, fill(co.color));

                // 续行只铺色，文字只在块的第一行写一次
                if (!first) continue;

                c.save();
                c.clipRect(r);
                float bx = x + dp(den, 3);
                float innerW = cw - dp(den, 7);
                // 单元格按「课名 / @教室 / 教师」三行排（参考主流课表 App 的格子）：
                // 时间已经挪到左边节次栏（开始+结束都写了），格子里不再重复，
                // 这样省下的高度正好够单独写教师。
                // 先扣掉「教室 + 教师」两行要占的高度，剩下的才给课名，
                // 这样行高一旦富裕就自动多显示一行课名，而不是把地点挤掉。
                float subReserve = dp(den, 18f);
                int maxName = Math.max(1, Math.min(3,
                    (int) ((hgt - dp(den, 5) - subReserve) / lineH)));
                List<String> lines = wrapText(co.name, nameP, innerW, maxName);
                float ty = top + dp(den, 8.5f);
                for (String ln : lines) {
                    c.drawText(ln, bx, ty, nameP);
                    ty += lineH;
                }
                Paint subP = text(den, 7.8f, 0xE4FFFFFF, false);
                float subH = dp(den, 9f);
                // 教室单独占行、前面带 @，和课名区分开。
                // 「JXL I 602 数据金融大数据实验室」这种长名字一行放不下就折两行——
                // 地点信息比课名更不能省，省略号截掉后半截等于没写。
                // 顺序是「缩字号保整串 → 仍放不下才折两行」：折行会变成「@A30 / 2」这种断码，
                // 比小一号难认得多。
                String roomTxt = (co.room != null) ? co.room.trim() : "";
                if (!roomTxt.isEmpty()) {
                    String rs = "@" + roomTxt;
                    Paint roomP = fitPaint(rs, subP, innerW, 6.4f, den);
                    if (roomP.measureText(rs) <= innerW) {
                        if (ty <= top + hgt - dp(den, 1f)) {
                            c.drawText(rs, bx, ty, roomP);
                            ty += subH;
                        }
                    } else {
                        for (String ln : wrapText(rs, roomP, innerW, 2)) {
                            if (ty > top + hgt - dp(den, 1f)) break;
                            c.drawText(ln, bx, ty, roomP);
                            ty += subH;
                        }
                    }
                }
                // 教师再占一行。同样先缩字号，真的放不下才省略（教室比教师更难从别处知道）
                String tcTxt = (co.teacher != null) ? co.teacher.trim() : "";
                if (!tcTxt.isEmpty() && ty <= top + hgt - dp(den, 1f)) {
                    Paint tcP = fitPaint(tcTxt, subP, innerW, 6.4f, den);
                    c.drawText(ellipsize(tcTxt, tcP, innerW), bx, ty, tcP);
                }
                c.restore();
            }
        }
        return bmp;
    }

    /* ================================================================
       小组件一（列表版）：今天 + 明天

       原来整块是一张位图，高度一压窄就只能砍信息——先砍时间、再砍教室，
       最后只剩一个课名。现在拆成「固定表头位图 + ListView 课程行」：
       卡片再扁也只是少露出几行，上下滚一下，课名、时间、地点、教师照样齐。
       ================================================================ */

    /** 「今天与明天」两栏表头：第一行学期 + 日期/周次，第二行 今天 | 明天 */
    static final float PAIR_HEAD = 52f;

    public static Bitmap todayHead(WidgetData d, int w, float den) {
        if (w <= 0) return null;
        int hh = Math.round(dp(den, PAIR_HEAD));
        Bitmap bmp = Bitmap.createBitmap(w, hh, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(bmp);
        Theme t = Theme.of(d, den);

        LocalDate today = LocalDate.now();
        int wk = d.weekNo(today);
        float pad = dp(den, 12f);
        float mid = w / 2f;

        // ── 第一行：左学期名，右「日期 + 第几周 + 星期」
        Paint nameP = text(den, 13.4f, t.primary, true);
        String tn = (d.tableName == null || d.tableName.isEmpty()) ? "我的课程表" : d.tableName;
        c.drawText(ellipsize(tn, nameP, w / 2f - pad), pad, dp(den, 18f), nameP);

        Paint metaP = text(den, 9.2f, t.tertiary, false);
        String wkStr = (wk >= 1 && wk <= d.totalWeeks) ? ("第" + wk + "周") : "";
        String meta = (today.getMonthValue() + "." + today.getDayOfMonth()
            + (wkStr.isEmpty() ? "" : " " + wkStr)
            + " 周" + DAY_CN[today.getDayOfWeek().getValue() - 1]);
        c.drawText(meta, w - pad - metaP.measureText(meta), dp(den, 18f), metaP);

        // ── 第二行：两栏标题
        LocalDate tomorrow = today.plusDays(1);
        Paint labL = text(den, 11.6f, t.accent, true);
        Paint labR = text(den, 11.6f, t.secondary, true);
        c.drawText("今天", pad, dp(den, 38f), labL);
        c.drawText("明天", mid + pad, dp(den, 38f), labR);

        Paint dateP = text(den, 9f, t.tertiary, false);
        float x1 = pad + labL.measureText("今天") + dp(den, 6);
        c.drawText(today.getMonthValue() + "/" + today.getDayOfMonth(), x1, dp(den, 38f), dateP);
        float x2 = mid + pad + labR.measureText("明天") + dp(den, 6);
        c.drawText(tomorrow.getMonthValue() + "/" + tomorrow.getDayOfMonth(), x2, dp(den, 38f), dateP);

        Paint lineP = stroke(den, 1f, t.line);
        // 中缝竖线从顶贯到底，把两栏彻底分开
        c.drawLine(mid, dp(den, 2f), mid, hh, lineP);
        c.drawLine(pad, hh - dp(den, 0.5f), w - pad, hh - dp(den, 0.5f), lineP);
        return bmp;
    }

    /* ---------------- 「今天与明天」两栏格子 ---------------- */

    private static Paint cellTimeP(float den) { return text(den, 9f, 0xEEFFFFFF, false); }
    private static Paint cellNameP(float den) { return text(den, 11.4f, 0xFFFFFFFF, true); }
    private static Paint cellSubP(float den) { return text(den, 9.2f, 0xE2FFFFFF, false); }

    /** 左右两栏的格子几何（左起、宽度）。中缝留 5dp，两侧各 8dp 内边距。 */
    private static float[] cellBox(int w, float den, boolean left) {
        float padX = dp(den, 8f);
        float midGap = dp(den, 5f);
        float mid = w / 2f;
        if (left) return new float[] {padX, mid - padX - midGap};
        float x = mid + midGap;
        return new float[] {x, w - padX - x};
    }

    /** 一个格子要占多高：时间 1 行 + 课名 1~2 行 + 教室 1 行 + 教师 1 行 */
    private static float cellNeed(WidgetData d, WidgetData.Course co, float cw, float den) {
        if (co == null) return 0;
        float inner = cw - dp(den, 14);
        float timeH = dp(den, 12f);
        float nameH = dp(den, 15f);
        float subH = dp(den, 11.5f);
        float need = dp(den, 6f) + timeH;
        need += wrapText(co.name, cellNameP(den), inner, 2).size() * nameH;
        if (co.room != null && !co.room.trim().isEmpty()) need += subH;
        if (co.teacher != null && !co.teacher.trim().isEmpty()) need += subH;
        return need + dp(den, 6f);
    }

    /**
     * 画一格：底色是一整块课色，里面从上到下写 时间 / 课名 / @教室 / 教师。
     * 和「本周课表」的格子保持同一套视觉——这是用户明确要求的样式。
     */
    private static void drawCell(Canvas c, WidgetData d, WidgetData.Course co,
                                 float x, float y, float cw, float hh, float den) {
        if (co == null || cw <= 0 || hh <= 0) return;
        RectF r = new RectF(x, y, x + cw, y + hh);
        c.drawRoundRect(r, dp(den, 8f), dp(den, 8f), fill(co.color));

        float bx = x + dp(den, 7f);
        float inner = cw - dp(den, 14);
        c.save();
        c.clipRect(r);

        float ty = y + dp(den, 6f);
        Paint timeP = cellTimeP(den);
        String tm = d.timeRange(co);
        if (!tm.isEmpty()) {
            c.drawText(ellipsize(tm, timeP, inner), bx, ty - timeP.ascent(), timeP);
        }
        ty += dp(den, 12f);

        Paint nameP = cellNameP(den);
        float nameH = dp(den, 15f);
        for (String ln : wrapText(co.name, nameP, inner, 2)) {
            if (ty - nameP.ascent() > y + hh) break;
            c.drawText(ln, bx, ty - nameP.ascent(), nameP);
            ty += nameH;
        }

        Paint subP = cellSubP(den);
        float subH = dp(den, 11.5f);
        String room = (co.room == null) ? "" : co.room.trim();
        if (!room.isEmpty()) {
            for (String ln : wrapText("@" + room, subP, inner, 2)) {
                if (ty - subP.ascent() > y + hh - dp(den, 1f)) break;
                c.drawText(ln, bx, ty - subP.ascent(), subP);
                ty += subH;
            }
        }
        String tc = (co.teacher == null) ? "" : co.teacher.trim();
        if (!tc.isEmpty() && ty - subP.ascent() <= y + hh - dp(den, 1f)) {
            c.drawText(ellipsize(tc, subP, inner), bx, ty - subP.ascent(), subP);
        }
        c.restore();
    }

    /**
     * 表体一整行 = 左边今天的一节 + 右边明天的一节（任一为空则该格留白）。
     * 这样两栏永远逐行对齐、一起滚动，比两个独立 ListView 稳当。
     */
    public static Bitmap todayPairRow(WidgetData d, WidgetData.Course a, WidgetData.Course b,
                                      int w, float den) {
        if (w <= 0 || (a == null && b == null)) return null;

        float[] lb = cellBox(w, den, true);
        float[] rb = cellBox(w, den, false);
        float need = Math.max(cellNeed(d, a, lb[1], den), cellNeed(d, b, rb[1], den));
        int hh = Math.round(Math.max(dp(den, 36f), need));

        Bitmap bmp = Bitmap.createBitmap(w, hh, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(bmp);
        float gapY = dp(den, 2f);
        Theme t = Theme.of(d, den);
        drawCell(c, d, a, lb[0], gapY, lb[1], hh - gapY * 2, den);
        drawCell(c, d, b, rb[0], gapY, rb[1], hh - gapY * 2, den);
        // 只有一天有课时，空的那一半给一句提示，否则看着像渲染漏了
        Paint hideHint = text(den, 9f, t.tertiary, false);
        if (a == null) halfHint(c, hideHint, lb[0], lb[1], hh, "没课啦");
        if (b == null) halfHint(c, hideHint, rb[0], rb[1], hh, "没课啦");
        return bmp;
    }

    private static void halfHint(Canvas c, Paint p, float x, float cw, float hh, String s) {
        c.drawText(s, x + (cw - p.measureText(s)) / 2f,
            hh / 2f - (p.ascent() + p.descent()) / 2f, p);
    }

    /** 两边都没课时的一行：「今天没课」/「明天没课」左右各一句（带个表情，别太干） */
    public static Bitmap todayPairEmpty(WidgetData d, int w, float den) {
        if (w <= 0) return null;
        int hh = Math.round(dp(den, 76f));
        Bitmap bmp = Bitmap.createBitmap(w, hh, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(bmp);
        Theme t = Theme.of(d, den);
        float[] lb = cellBox(w, den, true);
        float[] rb = cellBox(w, den, false);

        Paint faceP = text(den, 10f, t.tertiary, false);
        Paint p = text(den, 9.4f, t.tertiary, false);
        String face = "( ˘•ω•˘ )";
        String l = "今天没有课啦", r = "明天没有课啦";

        float y1 = hh / 2f - dp(den, 10f);
        float y2 = hh / 2f + dp(den, 10f);
        c.drawText(face, lb[0] + (lb[1] - faceP.measureText(face)) / 2f, y1 - faceP.ascent(), faceP);
        c.drawText(face, rb[0] + (rb[1] - faceP.measureText(face)) / 2f, y1 - faceP.ascent(), faceP);
        c.drawText(l, lb[0] + (lb[1] - p.measureText(l)) / 2f, y2 - p.ascent(), p);
        c.drawText(r, rb[0] + (rb[1] - p.measureText(r)) / 2f, y2 - p.ascent(), p);
        return bmp;
    }

    /** 只画一张圆角卡底，垫在 ListView 下面当背景 */
    public static Bitmap cardBg(WidgetData d, int w, int h, float den) {
        if (w <= 0 || h <= 0) return null;
        Bitmap bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(bmp);
        card(c, w, h, Theme.of(d, den));
        return bmp;
    }

    /* ---------------- 绘图小工具 ---------------- */

    /** 节次总数：优先用配置的节次表，其次按课程的最大结束节兜底 */
    static int periodCount(WidgetData d) {
        int n = d.periods.size();
        for (WidgetData.Course c : d.courses) n = Math.max(n, c.e);
        if (n <= 0) return 8;
        return Math.min(n, 14);
    }

    private static void card(Canvas c, int w, int h, Theme t) {
        float r = dp(t.den, 20);
        c.drawRoundRect(new RectF(0, 0, w, h), r, r, fill(t.card));
    }

    private static void drawCentered(Canvas c, String s, float cx, float baseline, Paint p) {
        c.drawText(s, cx - p.measureText(s) / 2f, baseline, p);
    }

    /**
     * 在 [minSz, 当前字号] 之间找「能把整串放下」的最大字号。
     * 250dp 卡里每列只有 30dp 左右，「@A302」或三个字的教师名在 7.8 号下放不下；
     * 这种短串一旦折行就变成「@A30 / 2」，比小一号更难认，所以宁可缩 1~2 号保住整串。
     * 都放不下时返回 minSz，交给调用方折行或省略。
     */
    private static Paint fitPaint(String s, Paint base, float maxW, float minSz, float den) {
        Paint p = new Paint(base);
        float sz = p.getTextSize() / den;
        while (sz > minSz && p.measureText(s) > maxW) {
            sz -= 0.3f;
            p.setTextSize(sz * den);
        }
        return p;
    }

    private static String ellipsize(String s, Paint p, float maxW) {
        if (s == null) return "";
        if (maxW <= 0) return "";
        return TextUtils.ellipsize(s, new TextPaint(p), maxW, TextUtils.TruncateAt.END).toString();
    }

    /** 逐字折行，超过 maxLines 时末行加省略号 */
    static java.util.List<String> wrapText(String s, Paint p, float maxW, int maxLines) {
        java.util.List<String> out = new java.util.ArrayList<>();
        if (s == null || s.isEmpty() || maxW <= 0) return out;
        StringBuilder line = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            String ch = s.substring(i, i + 1);
            if (p.measureText(line.toString() + ch) > maxW && line.length() > 0) {
                out.add(line.toString());
                line.setLength(0);
                if (out.size() == maxLines) return out;
            }
            line.append(ch);
        }
        if (out.size() < maxLines && line.length() > 0) out.add(line.toString());
        if (out.size() == maxLines) {
            StringBuilder joined = new StringBuilder();
            for (String x : out) joined.append(x);
            if (joined.length() < s.length()) {
                String last = out.get(maxLines - 1);
                while (last.length() > 1 && p.measureText(last + "…") > maxW) {
                    last = last.substring(0, last.length() - 1);
                }
                out.set(maxLines - 1, last + "…");
            }
        }
        return out;
    }

    private static Paint text(float den, float sizeDp, int color, boolean bold) {
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setColor(color);
        p.setTextSize(sizeDp * den);
        p.setTypeface(Typeface.create("sans-serif", bold ? Typeface.BOLD : Typeface.NORMAL));
        return p;
    }

    private static Paint fill(int color) {
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setColor(color);
        p.setStyle(Paint.Style.FILL);
        return p;
    }

    private static Paint stroke(float den, float widthDp, int color) {
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setColor(color);
        p.setStrokeWidth(Math.max(1f, widthDp * den));
        p.setStyle(Paint.Style.STROKE);
        return p;
    }

    private static float dp(float den, float v) { return v * den; }

    private static int withAlpha(int color, int alpha) {
        return (color & 0x00FFFFFF) | (alpha << 24);
    }
}
