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
 * 小组件一：今天 + 明天。
 *
 * 结构：圆角卡底位图 + 固定表头位图 + ListView（日期分组、空状态、一节课程各占一行）。
 * 卡片被拉扁时不裁信息，改为少露几行、由桌面滚动 —— 课名、时间、地点、教师任何高度都在。
 * RemoteViews 不支持 ScrollView，可滚动只能用 ListView + RemoteViewsService 这条路。
 */
public class TodayWidgetProvider extends AppWidgetProvider {

    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        updateAll(c, m, ids);
    }

    /** 拉伸后宿主会回调这里，按新尺寸重画表头并让表体重建 */
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
                // 兜底尺寸要和 widget_today_info.xml 里的 minWidth/minHeight 一致，
                // 否则个别桌面拿不到 options 时会按别的尺寸去画，表头与表体对不齐
                int[] s = WidgetUpdater.sizeDp(m.getAppWidgetOptions(id), 250, 110);
                int w = Math.max(1, Math.round(s[0] * den));
                int h = Math.max(1, Math.round(s[1] * den));

                RemoteViews rv = new RemoteViews(c.getPackageName(), R.layout.widget_today);
                rv.setImageViewBitmap(R.id.tbgw, WidgetRender.cardBg(d, w, h, den));
                rv.setImageViewBitmap(R.id.theadH, WidgetRender.todayHead(d, w, den));
                rv.setViewVisibility(R.id.tempty, d.synced ? View.GONE : View.VISIBLE);
                rv.setTextColor(R.id.tempty, d.dark ? 0xFF98A2AE : 0xFF77808C);

                // 表体交给 RemoteViewsService，每行一项
                Intent svc = new Intent(c, WidgetTodayService.class);
                svc.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
                svc.setData(Uri.parse(svc.toUri(Intent.URI_INTENT_SCHEME)));
                rv.setRemoteAdapter(R.id.tlist, svc);

                PendingIntent open = WidgetUpdater.openApp(c, id);
                rv.setPendingIntentTemplate(R.id.tlist, open);
                rv.setOnClickPendingIntent(R.id.theadH, open);

                m.updateAppWidget(id, rv);
            } catch (Throwable ignored) {
                // 单个实例失败不能影响其它同类小组件
            }
        }

        // 尺寸 / 数据 / 主题变了，通知表体重建（会触发工厂的 onDataSetChanged）
        try {
            m.notifyAppWidgetViewDataChanged(ids, R.id.tlist);
        } catch (Throwable ignored) {}
    }
}
