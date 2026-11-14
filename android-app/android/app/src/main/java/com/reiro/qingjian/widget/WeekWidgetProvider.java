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

    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        updateAll(c, m, ids);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context c, AppWidgetManager m, int id, Bundle newOptions) {
        updateAll(c, m, new int[] {id});
    }

    static void updateAll(Context c, AppWidgetManager m, int[] ids) {
        if (ids == null || ids.length == 0) return;
        WidgetData d = WidgetData.load(c);
        float den = WidgetUpdater.density(c);

        for (int id : ids) {
            try {
                int[] s = WidgetUpdater.sizeDp(m.getAppWidgetOptions(id), 250, 180);
                int w = Math.max(1, Math.round(s[0] * den));
                int h = Math.max(1, Math.round(s[1] * den));

                RemoteViews rv = new RemoteViews(c.getPackageName(), R.layout.widget_week);
                rv.setImageViewBitmap(R.id.wbgw, WidgetRender.cardBg(d, w, h, den));
                rv.setImageViewBitmap(R.id.wheadH, WidgetRender.weekHead(d, w, den));
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

                m.updateAppWidget(id, rv);
            } catch (Throwable ignored) {
                // 单个实例失败不能影响其它同类小组件
            }
        }

        // 尺寸 / 数据 / 主题变了，通知表体重建（会触发工厂的 onDataSetChanged）
        try {
            m.notifyAppWidgetViewDataChanged(ids, R.id.wlist);
        } catch (Throwable ignored) {}
    }
}
