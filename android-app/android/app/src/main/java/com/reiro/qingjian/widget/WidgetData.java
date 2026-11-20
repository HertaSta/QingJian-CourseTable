package com.reiro.qingjian.widget;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

/**
 * 桌面小组件的数据层。
 *
 * 网页侧每次保存课表时，通过 WidgetBridge 把一份「渲染需要的原始数据」推过来
 * （学期起始、节次时间、课程列表），存进 SharedPreferences。
 *
 * 刻意不在网页侧算好「今天有哪些课」再推：那样隔天就必须重新打开 App 才能更新。
 * 这里存的是原始数据，周次和当天课程都由小组件自己按系统日期现算，
 * 所以哪怕好几天没开 App，桌面上的小组件照样准确。
 */
public class WidgetData {

    private static final String PREF = "qingjian_widget";
    private static final String KEY = "payload";

    /** 与网页侧 PALETTE 保持一致，课程没带颜色时按顺序兜底 */
    private static final int[] FALLBACK = {
        0xFF22C55E, 0xFF14B8A6, 0xFF06B6D4, 0xFF0EA5E9, 0xFF3B82F6, 0xFF8B5CF6,
        0xFFA855F7, 0xFFEC4899, 0xFFF43F5E, 0xFFFF4D6D, 0xFFFF7A3D, 0xFFF5A524
    };

    public String tableName = "我的课程表";
    public String termStart = "";
    public int totalWeeks = 20;
    public boolean showWeekend = true;
    public boolean dark = false;
    public int accent = 0xFF0B8F86;
    /** 卡片不透明度 0~1（设置页可调，网页侧传 40~100 的整数） */
    public float alpha = 0.93f;

    public final List<Period> periods = new ArrayList<>();
    public final List<Course> courses = new ArrayList<>();

    /** 是否已经收到过一次网页侧的数据（用于区分「从没同步过」和「课表本来就是空的」） */
    public boolean synced = false;

    public static class Period {
        public int n;
        public String start = "";
        public String end = "";
    }

    public static class Course {
        public String name = "";
        public String room = "";
        public String teacher = "";
        public int day = 1;          // 1=周一 … 7=周日
        public int s = 1;            // 起始节
        public int e = 1;            // 结束节
        /** 这节课自己设的钟点（在 App 里单独改过节次时间）。空 = 跟随节次表 */
        public String start = "";
        public String end = "";
        public List<Integer> weeks = null;   // null / 空 = 每周都上
        public int color = 0xFF22C55E;
    }

    public static WidgetData load(Context ctx) {
        SharedPreferences sp = ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE);
        String raw = sp.getString(KEY, null);
        WidgetData d = parse(raw);
        d.synced = raw != null && !raw.trim().isEmpty();
        // 明暗跟随系统，不用 App 里的设置：桌面上别的卡片都是系统主题，
        // 小组件要是跟着 App 走，就会出现 App 深色 + 系统浅色时「白底黑块」的割裂感。
        d.dark = isNight(ctx);
        return d;
    }

    /** 系统当前是不是深色（跟随系统设置 / 自动深色，不看 App 内的开关） */
    public static boolean isNight(Context ctx) {
        try {
            int mode = ctx.getResources().getConfiguration().uiMode
                & android.content.res.Configuration.UI_MODE_NIGHT_MASK;
            return mode == android.content.res.Configuration.UI_MODE_NIGHT_YES;
        } catch (Throwable t) {
            return true;
        }
    }

    public static void save(Context ctx, JSONObject obj) {
        SharedPreferences sp = ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE);
        sp.edit().putString(KEY, obj == null ? "{}" : obj.toString()).apply();
    }

    /* ---------------- 「本周课表」翻页偏移 ---------------- */

    /**
     * 每个小组件实例各自的翻页偏移（0 = 本周，1 = 下周 …）。
     * 存在这里而不是数据快照里：翻页是「这台桌面上这块卡片」的临时状态，
     * 不该被网页下次同步数据时冲掉。
     */
    private static String offsetKey(int id) { return "week_offset_" + id; }

    public static int offsetOf(Context ctx, int widgetId) {
        return ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE).getInt(offsetKey(widgetId), 0);
    }

    public static void setOffset(Context ctx, int widgetId, int offset) {
        ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE)
            .edit().putInt(offsetKey(widgetId), offset).apply();
    }

    /** 数据是否为空（用户还没在 App 里同步过一次） */
    public boolean isEmpty() { return courses.isEmpty(); }

    public static WidgetData parse(String json) {
        WidgetData d = new WidgetData();
        if (json == null || json.trim().isEmpty()) return d;
        try {
            JSONObject o = new JSONObject(json);
            d.tableName = o.optString("tableName", d.tableName);
            d.termStart = o.optString("termStart", "");
            d.totalWeeks = Math.max(1, o.optInt("totalWeeks", 20));
            d.showWeekend = o.optBoolean("showWeekend", true);
            d.dark = o.optBoolean("dark", false);
            d.accent = parseColor(o.optString("accent", ""), d.accent);
            d.alpha = Math.max(0.40f, Math.min(1f, o.optInt("alpha", 93) / 100f));

            JSONArray ps = o.optJSONArray("periods");
            if (ps != null) {
                for (int i = 0; i < ps.length(); i++) {
                    JSONObject p = ps.optJSONObject(i);
                    if (p == null) continue;
                    Period pe = new Period();
                    pe.n = p.optInt("n", i + 1);
                    pe.start = p.optString("start", "");
                    pe.end = p.optString("end", "");
                    d.periods.add(pe);
                }
            }

            JSONArray cs = o.optJSONArray("courses");
            if (cs != null) {
                for (int i = 0; i < cs.length(); i++) {
                    JSONObject p = cs.optJSONObject(i);
                    if (p == null) continue;
                    Course c = new Course();
                    c.name = p.optString("name", "").trim();
                    if (c.name.isEmpty()) continue;
                    c.room = p.optString("room", "");
                    c.teacher = p.optString("teacher", "");
                    c.day = clamp(p.optInt("day", 1), 1, 7);
                    c.s = Math.max(1, p.optInt("s", 1));
                    c.e = Math.max(c.s, p.optInt("e", c.s));
                    c.start = p.optString("start", "");
                    c.end = p.optString("end", "");
                    JSONArray ws = p.optJSONArray("weeks");
                    if (ws != null && ws.length() > 0) {
                        c.weeks = new ArrayList<>();
                        for (int k = 0; k < ws.length(); k++) c.weeks.add(ws.optInt(k, 0));
                    }
                    int col = parseColor(p.optString("color", ""), 0);
                    c.color = col != 0 ? col : FALLBACK[i % FALLBACK.length];
                    d.courses.add(c);
                }
            }
        } catch (Exception ignored) {
            // 数据损坏时退回空表，小组件显示「打开 App 同步一次」而不是崩溃
        }
        return d;
    }

    /* ---------------- 日期 / 周次 ---------------- */

    public LocalDate termStartDate() {
        try {
            if (termStart != null && termStart.length() >= 8) return LocalDate.parse(termStart.trim());
        } catch (Exception ignored) {}
        return null;
    }

    private static LocalDate mondayOf(LocalDate d) {
        return d.minusDays(d.getDayOfWeek().getValue() - 1L);
    }

    /**
     * 某周显示的周一：本周（今天所在周）加上 offset 周。
     * offset=0 是本周，1 是下周，-1 是上周。小组件表头/表体共用这一份算法，
     * 免得表头写着「下周」而格子还是本周的课。
     */
    public LocalDate weekMonday(int offset) {
        return mondayOf(LocalDate.now()).plusWeeks(offset);
    }

    /** 某天属于第几周（与网页侧 nowWeek 同一套算法）。学期未开始时可能 <= 0。 */
    public int weekNo(LocalDate date) {
        LocalDate ts = termStartDate();
        if (ts == null) return 1;
        long days = ChronoUnit.DAYS.between(mondayOf(ts), mondayOf(date));
        return (int) Math.round(days / 7.0) + 1;
    }

    private static boolean activeInWeek(Course c, int week) {
        if (c.weeks == null || c.weeks.isEmpty()) return true;
        return c.weeks.contains(week);
    }

    /** 某天的课程，按开始节次排序 */
    public List<Course> coursesOf(LocalDate date) {
        int dow = date.getDayOfWeek().getValue();   // 1=周一 … 7=周日
        int wk = weekNo(date);
        List<Course> out = new ArrayList<>();
        for (Course c : courses) {
            if (c.day != dow) continue;
            if (!activeInWeek(c, wk)) continue;
            out.add(c);
        }
        Collections.sort(out, new Comparator<Course>() {
            @Override public int compare(Course a, Course b) {
                if (a.s != b.s) return a.s - b.s;
                return a.e - b.e;
            }
        });
        return out;
    }

    /** 从今天起往后找第一节还要上的课（今天没有课时用），找不到返回 null */
    public Next nextCourse(LocalDate from, boolean skipToday) {
        for (int i = skipToday ? 1 : 0; i <= 8; i++) {
            LocalDate d = from.plusDays(i);
            int wk = weekNo(d);
            if (wk < 1 || wk > totalWeeks) continue;
            List<Course> list = coursesOf(d);
            if (!list.isEmpty()) {
                Next n = new Next();
                n.date = d;
                n.course = list.get(0);
                return n;
            }
        }
        return null;
    }

    public static class Next {
        public LocalDate date;
        public Course course;
    }

    /* ---------------- 节次时间 ---------------- */

    public String startOf(int periodNo) {
        for (Period p : periods) if (p.n == periodNo) return p.start;
        return "";
    }

    public String endOf(int periodNo) {
        for (Period p : periods) if (p.n == periodNo) return p.end;
        return "";
    }

    /** "08:30-09:15"；取不到时间时返回空串 */
    public String timeRange(Course c) {
        // 课程自己带了钟点就用它（在 App 里单独改过这节课的时间），否则按节次表推
        String a = (c.start != null && !c.start.isEmpty()) ? c.start : startOf(c.s);
        String b = (c.end != null && !c.end.isEmpty()) ? c.end : endOf(c.e);
        if (a.isEmpty() && b.isEmpty()) return "";
        if (b.isEmpty()) return a;
        if (a.isEmpty()) return b;
        return a + "-" + b;
    }

    /* ---------------- 杂项 ---------------- */

    public static int parseColor(String hex, int def) {
        try {
            String h = hex == null ? "" : hex.trim();
            if (h.startsWith("#")) h = h.substring(1);
            if (h.length() == 3) {
                h = "" + h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
            }
            if (h.length() != 6) return def;
            return Color.rgb(
                Integer.parseInt(h.substring(0, 2), 16),
                Integer.parseInt(h.substring(2, 4), 16),
                Integer.parseInt(h.substring(4, 6), 16));
        } catch (Exception e) {
            return def;
        }
    }

    private static int clamp(int v, int lo, int hi) {
        return v < lo ? lo : (v > hi ? hi : v);
    }
}
