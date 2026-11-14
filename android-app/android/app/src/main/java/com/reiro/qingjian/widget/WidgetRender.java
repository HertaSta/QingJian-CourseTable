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
       小组件一：今天 + 明天（列表版，见下方 todayHead / todayDayRow /
       todayEmptyRow / todayCourseRow）

       早先这里是 twoDays()：把两天的课画成一张整图，高度一压窄就只能
       靠 drawDayColumn() 砍内容——先砍时间、再砍教室，最后只剩课名。
       现在改成「表头位图 + ListView 行」，行高按内容定，卡片再扁也只是
       少露几行、由桌面滚动，课名 / 时间 / 地点 / 教师任何高度都完整。
       ================================================================ */

    /* ================================================================
       小组件二：本周课表（课表主体的缩小版，可上下滚动）

       拆成三块：
         · weekHead()  固定表头（日期 + 星期行），不参与滚动
         · weekRow()   表体的一个节次切片，由 ListView 逐行承载
         · cardBg()    圆角卡底，垫在 ListView 下面（RemoteViews 没法给容器加圆角）
       跨节课程块在行边界不画圆角，上下两片拼起来就是一块连续的颜色。
       ================================================================ */

    static final float WEEK_PAD = 10f, WEEK_GUT = 32f, WEEK_HEAD = 48f;
    /** 表体底部留白，与 widget_week.xml 里 ListView 的 paddingBottom 保持一致 */
    static final float WEEK_BOTTOM = 14f;

    /**
     * 左侧节次列的实际宽度（px）。
     * 4×3 的小组件只有 250dp 宽，减去 10dp 边距和 32dp 节次列，每列只剩 28dp,
     * 「毛泽东思想概论」这种长课名会被截成两个字。窄卡片时把节次列收窄，把地方还给星期列。
     */
    static float gutPx(int w, float den) {
        float dpW = w / den;
        float g = dpW < 280 ? 25f : (dpW < 340 ? 29f : WEEK_GUT);
        return dp(den, g);
    }

    /** 表头位图：顶栏日期 + 星期行。高度固定 WEEK_HEAD dp。 */
    public static Bitmap weekHead(WidgetData d, int w, float den) {
        if (w <= 0) return null;
        int hh = Math.round(dp(den, WEEK_HEAD));
        Bitmap bmp = Bitmap.createBitmap(w, hh, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(bmp);
        Theme t = Theme.of(d, den);

        LocalDate today = LocalDate.now();
        int wk = d.weekNo(today);
        LocalDate monday = today.minusDays(today.getDayOfWeek().getValue() - 1L);
        float pad = dp(den, WEEK_PAD);
        int cols = d.showWeekend ? 7 : 5;
        float gut = gutPx(w, den);
        float gx = pad + gut;
        float cw = (w - pad - gx) / cols;

        Paint dateP = text(den, 12f, t.primary, true);
        String ds = today.getMonthValue() + "/" + today.getDayOfMonth();
        c.drawText(ds, pad, dp(den, 17), dateP);
        Paint subP = text(den, 9f, t.tertiary, false);
        c.drawText("周" + DAY_CN[today.getDayOfWeek().getValue() - 1],
            pad + dateP.measureText(ds) + dp(den, 6), dp(den, 17), subP);

        Paint wkP = text(den, 9f, t.accent, true);
        String wkStr = (wk >= 1 && wk <= d.totalWeeks) ? ("第 " + wk + " 周") : "未开学";
        c.drawText(wkStr, w - pad - wkP.measureText(wkStr), dp(den, 17), wkP);

        Paint lineP = stroke(den, 1f, t.line);
        c.drawLine(pad, dp(den, 23), w - pad, dp(den, 23), lineP);

        int dow = today.getDayOfWeek().getValue();
        Paint dayP = text(den, 8.6f, t.secondary, true);
        Paint dayOn = text(den, 8.6f, t.accent, true);
        Paint numP = text(den, 7.6f, t.tertiary, false);
        Paint numOn = text(den, 7.6f, t.accent, false);
        for (int i = 0; i < cols; i++) {
            float cx = gx + i * cw + cw / 2f;
            boolean isToday = (i + 1) == dow;
            drawCentered(c, isToday ? "今" : DAY_CN[i], cx, dp(den, 35), isToday ? dayOn : dayP);
            drawCentered(c, String.valueOf(monday.plusDays(i).getDayOfMonth()), cx, dp(den, 45),
                isToday ? numOn : numP);
        }
        c.drawLine(pad, hh - dp(den, 0.5f), w - pad, hh - dp(den, 0.5f), lineP);
        c.drawLine(gx - dp(den, 0.5f), dp(den, 25), gx - dp(den, 0.5f), hh, lineP);
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
        float bodyH = Math.max(dp(den, 44), h - dp(den, WEEK_HEAD) - dp(den, WEEK_BOTTOM));
        float rh = bodyH / Math.max(1, n);
        return Math.max(dp(den, 44), Math.min(dp(den, 58), rh));
    }

    /** 表体第 index 行：一个节次的横向切片，宽度与表头一致。 */
    public static Bitmap weekRow(WidgetData d, int w, int index, float rowH, int n, float den) {
        if (w <= 0 || rowH <= 0 || index < 0 || index >= n) return null;
        int hh = Math.round(rowH);
        Bitmap bmp = Bitmap.createBitmap(w, hh, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(bmp);
        Theme t = Theme.of(d, den);

        LocalDate today = LocalDate.now();
        LocalDate monday = today.minusDays(today.getDayOfWeek().getValue() - 1L);
        float pad = dp(den, WEEK_PAD);
        int cols = d.showWeekend ? 7 : 5;
        float gut = gutPx(w, den);
        float gx = pad + gut;
        float cw = (w - pad - gx) / cols;

        // ── 今天那一列淡底
        int todayIdx = today.getDayOfWeek().getValue() - 1;
        if (todayIdx >= 0 && todayIdx < cols) {
            c.drawRect(gx + todayIdx * cw, 0, gx + (todayIdx + 1) * cw, hh, fill(t.accentSoft));
        }

        // ── 底部横向分隔线（叠起来正好是每条节次线）
        Paint lineP = stroke(den, 1f, t.line);
        c.drawLine(pad, hh - dp(den, 0.5f), w - pad, hh - dp(den, 0.5f), lineP);

        // ── 左侧节次列：序号 + 开始时间（窄的时候自动缩字号，绝不越界压到课程块上）
        WidgetData.Period per = (index < d.periods.size()) ? d.periods.get(index) : null;
        Paint noP = text(den, 8.8f, t.secondary, true);
        Paint stP = text(den, 7f, t.tertiary, false);
        float gutW = gutPx(w, den);
        float gutCx = pad + gutW / 2f;
        float cy = hh / 2f;

        c.save();
        c.clipRect(pad, 0, pad + gutW, hh);
        drawCentered(c, String.valueOf(per != null ? per.n : index + 1), gutCx, cy - dp(den, 1.5f), noP);
        if (per != null && per.start != null && !per.start.isEmpty() && rowH >= dp(den, 20)) {
            float limit = gutW - dp(den, 3);
            float sz = 7f;
            while (sz > 5.2f && stP.measureText(per.start) > limit) {
                sz -= 0.3f;
                stP.setTextSize(sz * den);
            }
            drawCentered(c, per.start, gutCx, cy + dp(den, 8.5f), stP);
        }
        c.restore();

        if (!d.synced) return bmp;

        // ── 课程块
        int p = index + 1;                       // 本行对应的节次（1 基）
        // 250dp 宽的卡片分到 7 天，每列只有 30dp 左右，7.9f 的字只能挤下两个字。
        // 列窄时把课名字号收缩到「至少放得下三个字」，下限 6.2f，再窄就交给省略号。
        float nameSz = 7.9f;
        float innerW0 = cw - dp(den, 7);
        Paint probe = text(den, nameSz, t.chipText, true);
        while (nameSz > 6.2f && probe.measureText("毛泽东") > innerW0) {
            nameSz -= 0.3f;
            probe.setTextSize(nameSz * den);
        }
        Paint nameP = probe;
        Paint roomP = text(den, 6.9f, 0xE0FFFFFF, false);
        float lineH = dp(den, 8.8f);
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
                // 行高够就先把「时间」这一行留出来，课名最多占两行；行高不够才把时间让掉。
                // 7 天列在 250dp 宽的卡片里每列只有 30dp 左右，时间串（08:30-10:10）根本放不下，
                // 硬塞只会被截成「08:30-10…」这种半截东西。所以：块宽够才画整串，不够就不画——
                // 左边节次栏已经有开始时间，少这一行不丢信息，反而是更干净。
                String tm = d.timeRange(co);
                Paint tmP = text(den, 6.6f, 0xD8FFFFFF, false);
                boolean tmFits = !tm.isEmpty() && tmP.measureText(tm) <= innerW;
                float tmReserve = (rowH >= dp(den, 34) && tmFits) ? dp(den, 7.4f) : 0;
                int maxName = Math.max(1, Math.min(2,
                    (int) ((hgt - dp(den, 4) - tmReserve) / lineH)));
                List<String> lines = wrapText(co.name, nameP, innerW, maxName);
                float ty = top + dp(den, 8.5f);
                for (String ln : lines) {
                    c.drawText(ln, bx, ty, nameP);
                    ty += lineH;
                }
                if (tmReserve > 0 && ty + dp(den, 1) <= top + hgt) {
                    c.drawText(tm, bx, ty + dp(den, 1), tmP);
                    ty += tmReserve;
                }
                // 教室放不下时退回教师名——一块空白格子里写个教师也比什么都没有强
                String sub = (co.room != null && !co.room.isEmpty()) ? co.room : co.teacher;
                if (sub != null && !sub.isEmpty() && ty <= top + hgt - dp(den, 2)) {
                    c.drawText(ellipsize(sub, roomP, innerW), bx, ty + dp(den, 1), roomP);
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

    /** 表头（日期 + 周次）固定高度，不参与滚动 */
    static final float TODAY_HEAD = 38f;


    public static Bitmap todayHead(WidgetData d, int w, float den) {
        if (w <= 0) return null;
        int hh = Math.round(dp(den, TODAY_HEAD));
        Bitmap bmp = Bitmap.createBitmap(w, hh, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(bmp);
        Theme t = Theme.of(d, den);

        LocalDate today = LocalDate.now();
        int wk = d.weekNo(today);
        float pad = dp(den, 14);

        Paint dateP = text(den, 14f, t.primary, true);
        String ds = today.getMonthValue() + "/" + today.getDayOfMonth();
        float base = dp(den, 19);
        c.drawText(ds, pad, base, dateP);

        Paint subP = text(den, 9.5f, t.tertiary, false);
        c.drawText("周" + DAY_CN[today.getDayOfWeek().getValue() - 1],
            pad + dateP.measureText(ds) + dp(den, 7), base, subP);

        if (wk >= 1 && wk <= d.totalWeeks) {
            Paint cp = text(den, 10.5f, t.accent, true);
            String chip = "第 " + wk + " 周";
            float cw = cp.measureText(chip) + dp(den, 14);
            float chh = dp(den, 20);
            float cx = w - pad - cw;
            float cy = dp(den, 6);
            c.drawRoundRect(new RectF(cx, cy, cx + cw, cy + chh), chh / 2f, chh / 2f, fill(t.accentSoft));
            c.drawText(chip, cx + dp(den, 7),
                cy + chh / 2f - (cp.ascent() + cp.descent()) / 2f, cp);
        }

        c.drawLine(pad, hh - dp(den, 0.5f), w - pad, hh - dp(den, 0.5f), stroke(den, 1f, t.line));
        return bmp;
    }

    /** 分组小标题行：「今天 11/15」 */
    public static Bitmap todayDayRow(WidgetData d, String label, LocalDate date,
                                     int w, float den, boolean isToday) {
        if (w <= 0) return null;
        int hh = Math.round(dp(den, 26));
        Bitmap bmp = Bitmap.createBitmap(w, hh, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(bmp);
        Theme t = Theme.of(d, den);
        float pad = dp(den, 14);

        Paint lab = text(den, 11.5f, isToday ? t.accent : t.secondary, true);
        float base = hh / 2f - (lab.ascent() + lab.descent()) / 2f;
        c.drawText(label, pad, base, lab);

        Paint dp2 = text(den, 9.5f, t.tertiary, false);
        float x = pad + lab.measureText(label) + dp(den, 7);
        c.drawText(date.getMonthValue() + "/" + date.getDayOfMonth(),
            x, hh / 2f - (dp2.ascent() + dp2.descent()) / 2f, dp2);
        return bmp;
    }

    /** 空状态行：「今天没课」 */
    public static Bitmap todayEmptyRow(WidgetData d, String text, int w, float den) {
        if (w <= 0) return null;
        int hh = Math.round(dp(den, 28));
        Bitmap bmp = Bitmap.createBitmap(w, hh, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(bmp);
        Theme t = Theme.of(d, den);
        Paint p = text(den, 9.5f, t.tertiary, false);
        c.drawText(text, dp(den, 14), hh / 2f - (p.ascent() + p.descent()) / 2f, p);
        return bmp;
    }

    /**
     * 一节课程。课名最多折三行、地点与教师最多折两行，全部写完再据此定行高——
     * 宁可这一行高一点、让列表多滚两下，也不把「在哪个教室、谁上的」丢掉。
     */
    public static Bitmap todayCourseRow(WidgetData d, WidgetData.Course co, int w, float den) {
        if (w <= 0 || co == null) return null;
        Theme t = Theme.of(d, den);

        float padX = dp(den, 14);
        float barW = dp(den, 3.5f);
        float gap = dp(den, 10);
        float textX = padX + barW + gap;
        float textW = Math.max(dp(den, 40), w - padX - textX);

        // 行高必须比字号大：之前写成 9.8dp 比 12.5sp 的字还小，课名和「教室 · 教师」直接叠在一起
        float nameLineH = dp(den, 16f);
        float metaLineH = dp(den, 12.5f);
        float padTop = dp(den, 6.5f);
        float padBot = dp(den, 6.5f);

        Paint nameP = text(den, 12.5f, t.primary, true);
        Paint timeP = text(den, 9f, t.secondary, false);
        Paint metaP = text(den, 8.8f, t.tertiary, false);

        String tm = d.timeRange(co);
        float timeW = tm.isEmpty() ? 0 : (timeP.measureText(tm) + dp(den, 10));
        List<String> names = wrapText(co.name, nameP, textW - timeW, 3);

        String meta = joinMeta(co.room, co.teacher);
        List<String> metas = meta.isEmpty()
            ? java.util.Collections.<String>emptyList()
            : wrapText(meta, metaP, textW, 2);

        float nameTop = padTop;
        float metaTop = nameTop + names.size() * nameLineH;
        float need = metaTop + metas.size() * metaLineH + padBot;
        int hh = Math.max(Math.round(dp(den, 34)), Math.round(need));

        Bitmap bmp = Bitmap.createBitmap(w, hh, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(bmp);

        // 左侧色条
        float barTop = padTop;
        float barH = Math.min(hh - padTop - padBot, dp(den, 32));
        c.drawRoundRect(new RectF(padX, barTop, padX + barW, barTop + barH),
            dp(den, 2), dp(den, 2), fill(co.color));

        float base = nameTop - nameP.ascent();
        for (String ln : names) {
            c.drawText(ln, textX, base, nameP);
            base += nameLineH;
        }

        if (!tm.isEmpty()) {
            float opts = (nameP.getTextSize() - timeP.getTextSize()) * 0.55f;
            c.drawText(tm, w - padX - timeP.measureText(tm),
                nameTop - timeP.ascent() + opts, timeP);
        }

        float mbase = metaTop - metaP.ascent();
        for (String ln : metas) {
            c.drawText(ln, textX, mbase, metaP);
            mbase += metaLineH;
        }
        return bmp;
    }

    /** 「教室 · 教师」，缺一个就只写另一个，两个都空返回空串 */
    static String joinMeta(String room, String teacher) {
        String a = (room == null) ? "" : room.trim();
        String b = (teacher == null) ? "" : teacher.trim();
        if (a.isEmpty()) return b;
        if (b.isEmpty()) return a;
        return a + " · " + b;
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
