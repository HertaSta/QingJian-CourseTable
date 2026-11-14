package com.reiro.qingjian.widget;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import com.reiro.qingjian.R;

/**
 * 「本周课表」表体的数据源。
 *
 * AppWidget 里的 RemoteViews 不支持 ScrollView，想真滚动只能用
 * ListView + RemoteViewsService：一行 = 一个节次的横向切片，
 * 滚动手势交给桌面自己去处理，表头另外用一张固定位图。
 */
public class WidgetWeekService extends RemoteViewsService {

    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        int id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,
            AppWidgetManager.INVALID_APPWIDGET_ID);
        return new RowFactory(getApplicationContext(), id);
    }

    static class RowFactory implements RemoteViewsService.RemoteViewsFactory {

        private final Context ctx;
        private final int widgetId;

        private WidgetData data;
        private float den = 2f;
        private int w = 0;
        private int n = 8;
        private float rowH = 0;

        RowFactory(Context ctx, int widgetId) {
            this.ctx = ctx;
            this.widgetId = widgetId;
        }

        @Override
        public void onCreate() {}

        /** 尺寸、数据、主题都可能变，每次绑定前重算一遍（这个回调跑在 binder 线程） */
        @Override
        public void onDataSetChanged() {
            data = WidgetData.load(ctx);
            den = WidgetUpdater.density(ctx);
            int[] s = new int[] {250, 250};
            try {
                AppWidgetManager m = AppWidgetManager.getInstance(ctx);
                if (widgetId != AppWidgetManager.INVALID_APPWIDGET_ID) {
                    s = WidgetUpdater.sizeDp(m.getAppWidgetOptions(widgetId), 250, 180);
                }
            } catch (Throwable ignored) {}
            w = Math.max(1, Math.round(s[0] * den));
            n = WidgetRender.periodCount(data);
            rowH = WidgetRender.weekRowH(Math.max(1, Math.round(s[1] * den)), n, den);
        }

        @Override
        public void onDestroy() {}

        @Override
        public int getCount() {
            return n;
        }

        @Override
        public RemoteViews getViewAt(int pos) {
            if (data == null || pos < 0 || pos >= n) return null;
            Bitmap b = WidgetRender.weekRow(data, w, pos, rowH, n, den);
            if (b == null) return null;

            RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_week_row);
            rv.setImageViewBitmap(R.id.wrowimg, b);
            // 点任意一行都打开 App —— 具体 PendingIntent 由 setPendingIntentTemplate 填进来
            rv.setOnClickFillInIntent(R.id.wrowimg, new Intent());
            return rv;
        }

        @Override
        public RemoteViews getLoadingView() {
            return null;
        }

        @Override
        public int getViewTypeCount() {
            return 1;
        }

        @Override
        public long getItemId(int pos) {
            return pos;
        }

        @Override
        public boolean hasStableIds() {
            return true;
        }
    }
}
