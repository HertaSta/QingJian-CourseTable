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
 * 之所以不用一张整图：卡片被拉扁时，一张图只能靠砍内容（先砍时间、再砍教室）。
 * 拆成 ListView 之后，每行按内容定高，卡片再扁也只是少露出几行，
 * 上下滚一下课名、时间、地点、教师照样都在。
 *
 * 行只有三种：日期分组标题、空状态提示、一节课程。
 */
public class WidgetTodayService extends RemoteViewsService {

    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        int id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,
            AppWidgetManager.INVALID_APPWIDGET_ID);
        return new RowFactory(getApplicationContext(), id);
    }

    /** 表体的一行 */
    private static class Row {
        static final int DAY = 0, EMPTY = 1, COURSE = 2;
        int type;
        String label;          // DAY 用：「今天」/「明天」
        LocalDate date;        // DAY 用
        boolean today;         // DAY 用：是否是今天
        String text;           // EMPTY 用
        WidgetData.Course course; // COURSE 用
    }

    static class RowFactory implements RemoteViewsService.RemoteViewsFactory {

        private final Context ctx;
        private final int widgetId;
        private final List<Row> rows = new ArrayList<>();

        private WidgetData data;
        private float den = 1f;
        private int w = 1;

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
            data = WidgetData.load(ctx);
            den = WidgetUpdater.density(ctx);
            AppWidgetManager m = AppWidgetManager.getInstance(ctx);
            int[] s = WidgetUpdater.sizeDp(m.getAppWidgetOptions(widgetId), 250, 180);
            w = Math.max(1, Math.round(s[0] * den));

            LocalDate today = LocalDate.now();
            LocalDate tomorrow = today.plusDays(1);
            addDay("今天", today, true);
            addDay("明天", tomorrow, false);
        }

        private void addDay(String label, LocalDate date, boolean isToday) {
            Row day = new Row();
            day.type = Row.DAY;
            day.label = label;
            day.date = date;
            day.today = isToday;
            rows.add(day);

            List<WidgetData.Course> list = data.coursesOf(date);
            if (list.isEmpty()) {
                Row e = new Row();
                e.type = Row.EMPTY;
                e.text = isToday ? "今天没课" : "明天没课";
                rows.add(e);
                return;
            }
            for (WidgetData.Course co : list) {
                Row r = new Row();
                r.type = Row.COURSE;
                r.course = co;
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

            Row r = rows.get(pos);
            android.graphics.Bitmap bmp;
            try {
                if (r.type == Row.DAY) {
                    bmp = WidgetRender.todayDayRow(data, r.label, r.date, w, den, r.today);
                } else if (r.type == Row.EMPTY) {
                    bmp = WidgetRender.todayEmptyRow(data, r.text, w, den);
                } else {
                    bmp = WidgetRender.todayCourseRow(data, r.course, w, den);
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
