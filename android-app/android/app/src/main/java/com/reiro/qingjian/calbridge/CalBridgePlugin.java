package com.reiro.qingjian.calbridge;

import android.Manifest;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.provider.CalendarContract;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.TimeZone;

/**
 * 把「日程」写进手机自带的系统日历。
 *
 * 为什么自己写：Capacitor 官方没有日历插件，而系统日历是 ContentProvider
 * （CalendarContract），只能从原生侧访问，WebView 里的 JS 碰不到。
 *
 * 三个能力：
 *   listCalendars —— 列出可写入的日历账户，交给 JS 选一个
 *   createEvent   —— 写入一条事件，可带提前提醒
 *   deleteEvent   —— 按事件 id 删掉（编辑日程时先删旧再建新，避免重复）
 *
 * 权限用 Capacitor 的 @Permission 机制（别名 calendar = 读 + 写），
 * checkPermissions / requestPermissions 由注解处理器自动生成，JS 侧直接调用。
 */
@CapacitorPlugin(
    name = "CalBridge",
    permissions = {
        @Permission(
            alias = "calendar",
            strings = { Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR }
        )
    }
)
public class CalBridgePlugin extends Plugin {

    /** 权限没申请下来时的兜底任务，等 onCalPerm 回调再执行 */
    private Body pendingBody = null;

    private interface Body {
        void run() throws Exception;
    }

    private boolean granted() {
        return getPermissionState("calendar") == PermissionState.GRANTED;
    }

    /** 列出「能写进去」的日历：访问级别至少是「可添加」以上 */
    @PluginMethod
    public void listCalendars(final PluginCall call) {
        withPermission(call, () -> {
            JSArray arr = new JSArray();
            Context ctx = getContext();
            Uri uri = CalendarContract.Calendars.CONTENT_URI;
            String[] proj = new String[] {
                CalendarContract.Calendars._ID,
                CalendarContract.Calendars.CALENDAR_DISPLAY_NAME,
                CalendarContract.Calendars.ACCOUNT_NAME,
                CalendarContract.Calendars.ACCOUNT_TYPE,
                CalendarContract.Calendars.IS_PRIMARY
            };
            String sel = CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL + " >= ?";
            String[] args = new String[] {
                String.valueOf(CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR)
            };
            String order = CalendarContract.Calendars.IS_PRIMARY + " DESC, " +
                           CalendarContract.Calendars.CALENDAR_DISPLAY_NAME + " ASC";
            Cursor c = null;
            try {
                c = ctx.getContentResolver().query(uri, proj, sel, args, order);
                if (c != null) {
                    while (c.moveToNext()) {
                        JSObject o = new JSObject();
                        o.put("id", String.valueOf(c.getLong(0)));
                        o.put("name", nz(c.getString(1)));
                        o.put("account", nz(c.getString(2)));
                        o.put("type", nz(c.getString(3)));
                        // 有些设备上 IS_PRIMARY 列可能是空的，取不到就当作 false
                        boolean primary = false;
                        try { primary = c.getInt(4) == 1; } catch (Exception ignored) {}
                        o.put("isPrimary", primary);
                        arr.put(o);
                    }
                }
            } finally {
                if (c != null) { try { c.close(); } catch (Exception ignored) {} }
            }
            if (arr.length() == 0) {
                call.reject("手机里没有找到可写入的日历账户");
                return;
            }
            JSObject ret = new JSObject();
            ret.put("calendars", arr);
            call.resolve(ret);
        });
    }

    /** 写入一条日程。begin / end 是 "YYYY-MM-DDTHH:mm:ss"，按手机本地时区解释。 */
    @PluginMethod
    public void createEvent(final PluginCall call) {
        final String calIdRaw = call.getString("calendarId");
        final String title    = nz(call.getString("title"));
        final String begin    = nz(call.getString("begin"));
        final String end      = nz(call.getString("end"));
        final String location = nz(call.getString("location"));
        final String desc     = nz(call.getString("description"));
        Integer rm = call.getInt("remindMinutes", 0);
        final int remind = rm == null ? 0 : rm;
        if (title.isEmpty()) { call.reject("日程名称为空"); return; }
        if (begin.isEmpty()) { call.reject("日程缺少开始时间"); return; }

        withPermission(call, () -> {
            long calId = parseLong(calIdRaw, -1L);
            if (calId < 0) { call.reject("未指定要写入的日历"); return; }

            long startMs = toMillis(begin);
            long endMs = end.isEmpty() ? 0L : toMillis(end);
            if (startMs <= 0) { call.reject("开始时间的格式无法识别"); return; }
            // 结束早于开始（跨天）或没填时兜底成一小时，避免写出非法区间
            if (endMs <= startMs) { endMs = startMs + 60L * 60L * 1000L; }

            ContentValues v = new ContentValues();
            v.put(CalendarContract.Events.DTSTART, startMs);
            v.put(CalendarContract.Events.DTEND, endMs);
            v.put(CalendarContract.Events.TITLE, title);
            v.put(CalendarContract.Events.DESCRIPTION, desc);
            v.put(CalendarContract.Events.EVENT_LOCATION, location);
            v.put(CalendarContract.Events.CALENDAR_ID, calId);
            v.put(CalendarContract.Events.EVENT_TIMEZONE, TimeZone.getDefault().getID());
            v.put(CalendarContract.Events.HAS_ALARM, remind > 0 ? 1 : 0);

            Uri u = getContext().getContentResolver().insert(CalendarContract.Events.CONTENT_URI, v);
            if (u == null) { call.reject("写入日历失败，系统没有返回结果"); return; }
            long id;
            try { id = Long.parseLong(u.getLastPathSegment()); }
            catch (Exception e) { call.reject("写入日历失败：返回的 id 无法识别"); return; }

            // 提醒独立一张表。写失败不影响事件本身，所以单独 try 掉。
            if (remind > 0) {
                try {
                    ContentValues rv = new ContentValues();
                    rv.put(CalendarContract.Reminders.EVENT_ID, id);
                    rv.put(CalendarContract.Reminders.MINUTES, remind);
                    rv.put(CalendarContract.Reminders.METHOD, CalendarContract.Reminders.METHOD_ALERT);
                    getContext().getContentResolver().insert(CalendarContract.Reminders.CONTENT_URI, rv);
                } catch (Exception ignored) {}
            }

            JSObject ret = new JSObject();
            ret.put("id", String.valueOf(id));
            call.resolve(ret);
        });
    }

    /** 按事件 id 删除。已经不存在时也按成功处理。 */
    @PluginMethod
    public void deleteEvent(final PluginCall call) {
        final String idRaw = call.getString("id");
        withPermission(call, () -> {
            long id = parseLong(idRaw, -1L);
            if (id < 0) {
                call.resolve(new JSObject());
                return;
            }
            Uri u = ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, id);
            int n = getContext().getContentResolver().delete(u, null, null);
            JSObject ret = new JSObject();
            ret.put("deleted", n);
            call.resolve(ret);
        });
    }

    /** 有权限就直接干活，没有先弹系统授权框，授权通过后接着干。 */
    private void withPermission(final PluginCall call, final Body body) {
        if (granted()) {
            run(call, body);
            return;
        }
        // 只有「确实没权限」时才会走到这里，所以 requestPermissionForAlias
        // 必定会走回调，不会出现「直接 resolve 而不触发回调」的情况。
        pendingBody = body;
        if (getActivity() == null) {
            pendingBody = null;
            call.reject("当前没有可用的界面");
            return;
        }
        getActivity().runOnUiThread(() ->
            requestPermissionForAlias("calendar", call, "onCalPerm"));
    }

    @PermissionCallback
    private void onCalPerm(PluginCall call) {
        Body b = pendingBody;
        pendingBody = null;
        if (granted() && b != null) {
            run(call, b);
        } else {
            call.reject("没有获得日历权限，请在系统设置里允许本应用访问日历");
        }
    }

    /** ContentResolver 的读写都不要放在主线程上。 */
    private void run(final PluginCall call, final Body body) {
        new Thread(() -> {
            try {
                body.run();
            } catch (Exception e) {
                String m = e.getMessage();
                call.reject(m == null || m.isEmpty() ? "系统日历操作失败" : m);
            }
        }).start();
    }

    private static String nz(String s) { return s == null ? "" : s; }

    private static long parseLong(String s, long def) {
        if (s == null) return def;
        try { return Long.parseLong(s.trim()); } catch (Exception e) { return def; }
    }

    /** "yyyy-MM-dd'T'HH:mm(:ss)" → 本地时区毫秒。失败返回 -1。 */
    private static long toMillis(String s) {
        if (s == null || s.isEmpty()) return -1L;
        String t = s.trim();
        try {
            LocalDateTime dt = (t.length() <= 16)
                ? LocalDateTime.parse(t + ":00")
                : LocalDateTime.parse(t);
            return dt.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();
        } catch (Exception e) {
            return -1L;
        }
    }
}
