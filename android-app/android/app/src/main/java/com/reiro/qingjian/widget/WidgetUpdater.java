package com.reiro.qingjian.widget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.util.DisplayMetrics;
import android.widget.RemoteViews;

import com.reiro.qingjian.MainActivity;
import com.reiro.qingjian.R;

/** 两个小组件共用的刷新 / 推送逻辑 */
public class WidgetUpdater {

    /** 把两种小组件全部重画一遍（数据变化、开机、尺寸变化都走这里） */
    public static void refreshAll(Context c) {
        try {
            AppWidgetManager m = AppWidgetManager.getInstance(c);
            int[] a = m.getAppWidgetIds(new ComponentName(c, TodayWidgetProvider.class));
            TodayWidgetProvider.updateAll(c, m, a);
            int[] b = m.getAppWidgetIds(new ComponentName(c, WeekWidgetProvider.class));
            WeekWidgetProvider.updateAll(c, m, b);
        } catch (Throwable ignored) {}
    }

    /** 位图按 dp × density 画，密度过高的设备上限制一下，免得单张小部件位图太吃内存 */
    static float density(Context c) {
        DisplayMetrics dm = c.getResources().getDisplayMetrics();
        float d = dm.density;
        if (d <= 0) d = 2f;
        return Math.min(d, 2.75f);
    }

    /** 当前分配到的尺寸（dp）。取 MIN 值——那是竖屏下的实际可用宽高 */
    static int[] sizeDp(Bundle o, int defW, int defH) {
        int w = defW, h = defH;
        if (o != null) {
            int mw = o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
            int mh = o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0);
            if (mw > 0) w = mw;
            if (mh > 0) h = mh;
        }
        // 极小尺寸会让排版没地方放，给个下限
        return new int[] {Math.max(w, 120), Math.max(h, 70)};
    }

    /**
     * 读数据时兜一层：SharedPreferences 里的 JSON 万一写坏了（断电、存储满），
     * load() 会抛异常。这时候宁可画一张「打开 App 同步一次」的空卡，
     * 也不能让整个 onUpdate 崩掉 —— onUpdate 抛异常的话，桌面会一直停在
     * 「载入出现问题」那张错误卡上，用户连点都点不开。
     */
    static WidgetData safeLoad(Context c) {
        try {
            return WidgetData.load(c);
        } catch (Throwable t) {
            return new WidgetData();
        }
    }

    static float safeDensity(Context c) {
        try {
            return density(c);
        } catch (Throwable t) {
            return 2f;
        }
    }

    static int[] safeSize(AppWidgetManager m, int id, int defW, int defH) {
        try {
            return sizeDp(m.getAppWidgetOptions(id), defW, defH);
        } catch (Throwable t) {
            return new int[] {defW, defH};
        }
    }

    /** 点小组件打开 App。两种小组件共用，用 widgetId 区分 PendingIntent，避免互相覆盖。 */
    static PendingIntent openApp(Context c, int id) {
        Intent it = new Intent(c, MainActivity.class);
        it.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(c, id, it,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /* ---------------- 翻周 / 翻页按钮 ---------------- */

    /** 「本周课表」翻一周 */
    static final String ACTION_WEEK_STEP = "com.reiro.qingjian.widget.WEEK_STEP";
    /** 「今天与明天」翻一周（同星期几，日期跳 7 天） */
    static final String ACTION_DAY_STEP = "com.reiro.qingjian.widget.DAY_STEP";
    static final String EXTRA_STEP = "step";

    /**
     * 翻页按钮的 PendingIntent。必须是 broadcast（发回 provider 自己），
     * 不能是 activity —— 翻页只改这张卡片的显示，不该把 App 拉到前台。
     */
    static PendingIntent step(Context c, Class<?> cls, String action, int id, int step) {
        Intent it = new Intent(c, cls);
        it.setAction(action);
        it.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        it.putExtra(EXTRA_STEP, step);
        // requestCode 必须每个 (实例, 按钮) 唯一，否则两个箭头会共用同一份 PendingIntent
        int rc = id * 8 + (step > 0 ? 1 : 0);
        return PendingIntent.getBroadcast(c, rc, it,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** 把画好的位图塞进 RemoteViews 并提交；整块点一下打开 App（「今天与明天」用） */
    static void push(Context c, AppWidgetManager m, int id, Bitmap bmp, boolean isWeek) {
        if (bmp == null) return;
        RemoteViews rv = new RemoteViews(c.getPackageName(), R.layout.widget_image);
        rv.setImageViewBitmap(R.id.wimg, bmp);
        try {
            rv.setContentDescription(R.id.wroot, c.getString(
                isWeek ? R.string.widget_week_name : R.string.widget_today_name));
        } catch (Throwable ignored) {}

        rv.setOnClickPendingIntent(R.id.wroot, openApp(c, id));

        m.updateAppWidget(id, rv);
    }

    private WidgetUpdater() {}
}
