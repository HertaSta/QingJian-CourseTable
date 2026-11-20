package com.reiro.qingjian.widget;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import com.reiro.qingjian.R;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

/**
 * 「今天与明天」的表体。
 *
 * 布局是左右两栏：一行 = 左边今天的一节 + 右边明天的一节，两栏永远逐行对齐、
 * 一起上下滚。之所以不用两个独立 ListView：两个列表的滚动互不联动，
 * 手指在左栏划右边不动，看着就像坏了。
 *
 * 之所以不用一张整图：卡片被拉扁时，一张图只能靠砍内容（先砍时间、再砍教室）。
 * 拆成 ListView 之后，每行按内容定高，卡片再扁也只是少露出几行。
 */
public class WidgetTodayService extends RemoteViewsService {

    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        int id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,
            AppWidgetManager.INVALID_APPWIDGET_ID);
        return new RowFactory(getApplicationContext(), id);
    }

    /** 表体的一行：左边今天的一节（可为空）+ 右边明天的一节（可为空） */
    private static class Row {
        WidgetData.Course left;
        WidgetData.Course right;
    }

    static class RowFactory implements RemoteViewsService.RemoteViewsFactory {

        private final Context ctx;
        private final int widgetId;
        private final List<Row> rows = new ArrayList<>();

        private WidgetData data;
        private float den = 1f;
        private int w = 1;
        /** 两边都没课时只放一行空状态提示 */
        private boolean emptyOnly = false;

        RowFactory(Context ctx, int widgetId) {
            this.ctx = ctx;
            this.widgetId = widgetId;
        }

        @Override
        public void onCreate() {
            // onDataSetChanged 会先跑一次，这里不用做事
        }

        @Override
        public void onDataSetChanged() {
            rows.clear();
            emptyOnly = false;
            data = WidgetData.load(ctx);
            den = WidgetUpdater.density(ctx);
            AppWidgetManager m = AppWidgetManager.getInstance(ctx);
            int[] s = WidgetUpdater.sizeDp(m.getAppWidgetOptions(widgetId), 250, 180);
            w = Math.max(1, Math.round(s[0] * den));

            LocalDate today = LocalDate.now();
            List<WidgetData.Course> a = data.coursesOf(today);
            List<WidgetData.Course> b = data.coursesOf(today.plusDays(1));

            int n = Math.max(a.size(), b.size());
            if (n == 0) {
                emptyOnly = true;
                rows.add(new Row());
                return;
            }
            for (int i = 0; i < n; i++) {
                Row r = new Row();
                r.left = i < a.size() ? a.get(i) : null;
                r.right = i < b.size() ? b.get(i) : null;
                rows.add(r);
            }
        }

        @Override
        public void onDestroy() {
            rows.clear();
        }

        @Override
        public int getCount() {
            return rows.size();
        }

        @Override
        public RemoteViews getViewAt(int pos) {
            if (pos < 0 || pos >= rows.size()) return null;
            RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_today_row);

            android.graphics.Bitmap bmp;
            try {
                if (emptyOnly) {
                    bmp = WidgetRender.todayPairEmpty(data, w, den);
                } else {
                    Row r = rows.get(pos);
                    bmp = WidgetRender.todayPairRow(data, r.left, r.right, w, den);
                }
            } catch (Throwable t) {
                return null;
            }
            if (bmp == null) return null;

            rv.setImageViewBitmap(R.id.trowimg, bmp);
            rv.setOnClickFillInIntent(R.id.trowimg, new Intent());
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
