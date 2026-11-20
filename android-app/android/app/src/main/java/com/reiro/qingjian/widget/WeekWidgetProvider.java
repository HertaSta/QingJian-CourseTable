package com.reiro.qingjian.widget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;

import com.reiro.qingjian.R;

/**
 * 小组件二：本周课表（课表主体的缩小版）。
 *
 * 结构：圆角卡底位图 + 固定表头位图 + ListView（每行一个节次的横向切片）。
 * 高度够就把整周铺满一屏；高度不够时行高固定、由桌面滚动 —— RemoteViews 不支持
 * ScrollView，可滚动只能用 ListView + RemoteViewsService 这条路。
 */
public class WeekWidgetProvider extends AppWidgetProvider {

    private static final int DEF_W = 250;
    private static final int DEF_H = 180;

    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        updateAll(c, m, ids);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context c, AppWidgetManager m, int id, Bundle newOptions) {
        updateAll(c, m, new int[] {id});
    }

    /** 表头上的「上一周 / 下一周」。只改这块卡片的偏移并重画，不打开 App。 */
    @Override
    public void onReceive(Context c, Intent intent) {
        String a = intent == null ? null : intent.getAction();
        if (!WidgetUpdater.ACTION_WEEK_STEP.equals(a)) {
            super.onReceive(c, intent);
            return;
        }
        try {
            int id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,
                AppWidgetManager.INVALID_APPWIDGET_ID);
            int step = intent.getIntExtra(WidgetUpdater.EXTRA_STEP, 0);
            if (id == AppWidgetManager.INVALID_APPWIDGET_ID || step == 0) return;

            WidgetData d = WidgetUpdater.safeLoad(c);
            int cur = WidgetData.offsetOf(c, id);
            int next = cur + step;
            // 允许回看历史周，但最多往回 20 周、往前 30 周，免得点着点着迷路
            if (next < -20) next = -20;
            if (next > 30) next = 30;
            // 超出学期范围就不再往后翻（往前翻不会越过学期结束）
            if (step > 0) {
                int wk = d.weekNo(d.weekMonday(next));
                if (wk > d.totalWeeks) return;
            }
            WidgetData.setOffset(c, id, next);
            updateAll(c, AppWidgetManager.getInstance(c), new int[] {id});
        } catch (Throwable t) {
            // 翻页失败就不翻，别让广播抛回系统
        }
    }

    static void updateAll(Context c, AppWidgetManager m, int[] ids) {
        if (ids == null || ids.length == 0) return;

        // 数据与密度先取好，并且全程兜底：这两步抛异常的话下面一个实例都画不出来
        WidgetData d = WidgetUpdater.safeLoad(c);
        float den = WidgetUpdater.safeDensity(c);

        for (int id : ids) {
            int[] s = WidgetUpdater.safeSize(m, id, DEF_W, DEF_H);
            int w = Math.max(1, Math.round(s[0] * den));
            int h = Math.max(1, Math.round(s[1] * den));
            try {
                int off = WidgetData.offsetOf(c, id);

                RemoteViews rv = new RemoteViews(c.getPackageName(), R.layout.widget_week);
                rv.setImageViewBitmap(R.id.wbgw, WidgetRender.cardBg(d, w, h, den));
                rv.setImageViewBitmap(R.id.wheadH, WidgetRender.weekHead(d, w, den, off));
                rv.setViewVisibility(R.id.wempty, d.synced ? View.GONE : View.VISIBLE);
                rv.setTextColor(R.id.wempty, d.dark ? 0xFF98A2AE : 0xFF77808C);

                // 表体交给 RemoteViewsService，每行一个节次
                Intent svc = new Intent(c, WidgetWeekService.class);
                svc.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
                svc.setData(Uri.parse(svc.toUri(Intent.URI_INTENT_SCHEME)));
                rv.setRemoteAdapter(R.id.wlist, svc);

                PendingIntent open = WidgetUpdater.openApp(c, id);
                rv.setPendingIntentTemplate(R.id.wlist, open);
                rv.setOnClickPendingIntent(R.id.wheadH, open);

                // 表头上叠的两个透明热区：上一周 / 下一周
                rv.setOnClickPendingIntent(R.id.wprev,
                    WidgetUpdater.step(c, WeekWidgetProvider.class,
                        WidgetUpdater.ACTION_WEEK_STEP, id, -1));
                rv.setOnClickPendingIntent(R.id.wnext,
                    WidgetUpdater.step(c, WeekWidgetProvider.class,
                        WidgetUpdater.ACTION_WEEK_STEP, id, 1));

                m.updateAppWidget(id, rv);
            } catch (Throwable t) {
                // 画不出来就退到最小形态：一张卡底 + 「打开 App 同步一次」。
                // 关键是仍然要 updateAppWidget —— 什么都不提交的话，桌面会停在
                // 「载入出现问题」的错误卡上，用户连点进去重新同步的机会都没有。
                fallback(c, m, id, d, w, h, den);
            }
        }

        // 尺寸 / 数据 / 主题 / 翻周变了，通知表体重建（会触发工厂的 onDataSetChanged）
        try {
            m.notifyAppWidgetViewDataChanged(ids, R.id.wlist);
        } catch (Throwable ignored) {}
    }

    /** 只放卡底和提示文字，不挂 ListView —— 这条路径要保证一定画得出来 */
    private static void fallback(Context c, AppWidgetManager m, int id,
                                 WidgetData d, int w, int h, float den) {
        try {
            RemoteViews fb = new RemoteViews(c.getPackageName(), R.layout.widget_week);
            fb.setImageViewBitmap(R.id.wbgw, WidgetRender.cardBg(d, w, h, den));
            fb.setViewVisibility(R.id.wempty, View.VISIBLE);
            fb.setTextColor(R.id.wempty, d.dark ? 0xFF98A2AE : 0xFF77808C);
            fb.setOnClickPendingIntent(R.id.wempty, WidgetUpdater.openApp(c, id));
            m.updateAppWidget(id, fb);
        } catch (Throwable ignored) {}
    }
}