package com.reiro.qingjian.uniimport;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.Dialog;
import android.graphics.Color;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * 通用教务系统课表导入。
 *
 * 思路来自「拾光课程表」（ShiGuangSchedule）：把各校教务系统的适配逻辑写成
 * 独立 JS 脚本，App 提供一个 WebView 让用户登录真实教务系统，再把脚本注入到
 * 已登录的页面里执行。脚本通过 window.shiguangBridgePromise / shiguangBridge
 * 这两个桥对象与 App 交换数据，因此社区写好的脚本可以原样复用。
 *
 * 与清笺原有的 ZwBridge 的区别：ZwBridge 是专为武汉铁路职业技术学院写死的
 * 「抓 HTML → 回传 → JS 侧解析」；本插件是通用通道 —— 解析逻辑全在脚本里，
 * App 只负责桥和界面，新增一所学校只需要换一个脚本，不用改 App。
 *
 * 数据回流：脚本依次调用 saveImportedCourses / saveCourseConfig /
 * savePresetTimeSlots，最后 notifyTaskCompletion，插件把这些汇总成一个
 * JSObject 交回前端，由前端的「确认导入」面板决定覆盖 / 新建 / 合并。
 */
@CapacitorPlugin(name = "UniImport")
public class UniImportPlugin extends Plugin {

    private static final String ASSET_DIR = "uniimport";

    private Dialog dialog;
    private WebView web;
    private PluginCall pending;
    private String adapterName = "教务系统";

    /** 预加载的脚本内容（assets 里读出来的全文）。 */
    private String bridgeInitSrc;
    private String jquerySrc;
    private String adapterSrc;

    private boolean scriptInjected = false;
    private boolean finished = false;

    /** 脚本回传的数据。 */
    private final List<JSONObject> importedCourses = new ArrayList<>();
    private JSONObject courseConfig;
    private JSONArray presetTimeSlots;

    @PluginMethod
    public void open(PluginCall call) {
        final String url = call.getString("url", "");
        final String scriptId = call.getString("scriptId", "");
        final Activity act = getActivity();
        if (act == null) { call.reject("没有可用的 Activity"); return; }
        if (url == null || url.trim().isEmpty()) { call.reject("请输入教务系统网址"); return; }
        if (scriptId == null || scriptId.trim().isEmpty()) { call.reject("未选择教务系统类型"); return; }
        if (pending != null) { call.reject("已经有一个导入会话在进行中"); return; }

        try {
            loadAssets(scriptId.trim());
        } catch (Exception e) {
            call.reject("读取适配脚本失败：" + e.getMessage());
            return;
        }

        pending = call;
        scriptInjected = false;
        finished = false;
        importedCourses.clear();
        courseConfig = null;
        presetTimeSlots = null;

        final String fixedUrl = url.trim();
        act.runOnUiThread(() -> showDialog(act, fixedUrl));
    }

    /**
     * 把内置学校清单回传给网页。
     *
     * 清单随 APK 打包在 assets/uniimport/schools/schools.json 里（来自拾光课程表开源社区），
     * 网页拿不到 assets，所以由这里读出来再传过去；网页侧会缓存，不会每次都调。
     */
    @PluginMethod
    public void listSchools(PluginCall call) {
        try {
            String json = readAsset(ASSET_DIR + "/schools/schools.json");
            JSONObject root = new JSONObject(json);
            JSObject ret = new JSObject();
            ret.put("schools", root.optJSONArray("schools"));
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("读取学校清单失败：" + e.getMessage());
        }
    }

    /** 从 assets 里读出适配脚本清单、桥初始化脚本和 jQuery 兜底。 */
    private void loadAssets(String scriptId) throws Exception {
        // 先按学校 id 找（schools.json，两百多所），找不到再回退到四类通用脚本
        String scriptFile = null;
        try {
            JSONObject root = new JSONObject(readAsset(ASSET_DIR + "/schools/schools.json"));
            JSONArray arr = root.optJSONArray("schools");
            if (arr != null) {
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject a = arr.optJSONObject(i);
                    if (a != null && scriptId.equals(a.optString("id"))) {
                        scriptFile = "schools/" + a.optString("script", "");
                        adapterName = a.optString("sub", a.optString("name", scriptId));
                        break;
                    }
                }
            }
        } catch (Exception ignored) {
            // 没有内置学校清单时静默回退
        }
        if (scriptFile == null || scriptFile.isEmpty()) {
            JSONObject root = new JSONObject(readAsset(ASSET_DIR + "/adapters.json"));
            JSONArray arr = root.optJSONArray("adapters");
            if (arr != null) {
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject a = arr.optJSONObject(i);
                    if (a != null && scriptId.equals(a.optString("id"))) {
                        scriptFile = a.optString("script", "");
                        adapterName = a.optString("name", scriptId);
                        break;
                    }
                }
            }
        }
        if (scriptFile == null || scriptFile.isEmpty()) {
            throw new Exception("找不到适配脚本「" + scriptId + "」");
        }
        adapterSrc = readAsset(ASSET_DIR + "/" + scriptFile);
        bridgeInitSrc = readAsset(ASSET_DIR + "/bridge_init.js");
        try {
            jquerySrc = readAsset(ASSET_DIR + "/jquery.min.js");
        } catch (Exception ignored) {
            jquerySrc = null;
        }
    }

    private String readAsset(String path) throws Exception {
        StringBuilder sb = new StringBuilder();
        InputStream in = null;
        BufferedReader br = null;
        try {
            in = getContext().getAssets().open(path);
            br = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
            String line;
            while ((line = br.readLine()) != null) {
                sb.append(line).append('\n');
            }
        } finally {
            if (br != null) { try { br.close(); } catch (Exception ignored) {} }
            if (in != null) { try { in.close(); } catch (Exception ignored) {} }
        }
        return sb.toString();
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void showDialog(final Activity act, final String url) {
        dialog = new Dialog(act);
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);

        LinearLayout root = new LinearLayout(act);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);

        // 顶部条：标题 + 「执行导入」+ 关闭
        LinearLayout bar = new LinearLayout(act);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setBackgroundColor(0xFF1F6F63);
        int pad = dp(10);
        bar.setPadding(pad, pad, pad, pad);

        TextView title = new TextView(act);
        title.setText(adapterName);
        title.setTextColor(Color.WHITE);
        title.setTextSize(16f);
        LinearLayout.LayoutParams tp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        title.setLayoutParams(tp);
        bar.addView(title);

        Button runBtn = new Button(act);
        runBtn.setText("执行导入");
        runBtn.setAllCaps(false);
        bar.addView(runBtn);

        Button closeBtn = new Button(act);
        closeBtn.setText("关闭");
        closeBtn.setAllCaps(false);
        bar.addView(closeBtn);

        root.addView(bar, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        final TextView tip = new TextView(act);
        tip.setText("请先登录教务系统，并打开课表页面，然后点「执行导入」");
        tip.setTextSize(12f);
        tip.setPadding(pad, dp(8), pad, dp(8));
        tip.setBackgroundColor(0xFFEFEFEF);
        root.addView(tip, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        web = new WebView(act);
        WebSettings ws = web.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setDatabaseEnabled(true);
        ws.setLoadWithOverviewMode(true);
        ws.setUseWideViewPort(true);
        ws.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        // 让页面里的同源 fetch / XHR 能带上登录态 cookie
        android.webkit.CookieManager cm = android.webkit.CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(web, true);

        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String u) {
                // 换页后允许再执行一次导入（用户可能从首页跳到了课表页）
                scriptInjected = false;
                if (tip != null) tip.setText("已打开页面：" + hostOf(u) + "　打开课表页后点「执行导入」");
            }
        });
        // 适配脚本通过这个对象把消息发给 App
        web.addJavascriptInterface(new NativeBridge(), "_shiguangNativeBridge");

        root.addView(web, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        dialog.setContentView(root);

        Window w = dialog.getWindow();
        if (w != null) {
            w.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
            w.setBackgroundDrawableResource(android.R.color.white);
        }
        dialog.setCanceledOnTouchOutside(false);
        dialog.setOnCancelListener(d -> dismiss(null, "已取消"));
        // 返回键先关掉这个窗口，而不是直接退出应用
        dialog.setOnKeyListener((d, keyCode, event) -> {
            if (keyCode == KeyEvent.KEYCODE_BACK && event.getAction() == KeyEvent.ACTION_UP) {
                dismiss(null, "已取消");
                return true;
            }
            return false;
        });
        dialog.show();
        if (w != null) {
            w.setLayout(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT);
        }

        runBtn.setOnClickListener(v -> injectAdapter(tip));
        closeBtn.setOnClickListener(v -> dismiss(null, "已取消"));

        web.loadUrl(url);
    }

    private String hostOf(String u) {
        if (u == null) return "";
        try {
            java.net.URI uri = java.net.URI.create(u);
            return uri.getHost() == null ? u : uri.getHost();
        } catch (Exception e) {
            return u;
        }
    }

    /**
     * 注入顺序：桥 →（必要时）jQuery → 适配脚本。
     * 同一个 WebView 上的 evaluateJavascript 按调用顺序执行，所以桥一定先于脚本就位。
     */
    private void injectAdapter(final TextView tip) {
        if (web == null) return;
        if (scriptInjected) {
            toast("导入已在进行中，请稍候");
            return;
        }
        scriptInjected = true;
        if (tip != null) tip.setText("正在执行导入脚本…");

        web.evaluateJavascript(bridgeInitSrc, null);

        // 部分教务系统页面自带 jQuery，部分不带；正方脚本依赖 jQuery，缺了就补一份
        web.evaluateJavascript(
                "(function(){try{return ((typeof window.jQuery!=='undefined'&&window.jQuery.fn)||(typeof window.$!=='undefined'&&window.$.fn))?'true':'false';}catch(e){return 'false';}})()",
                res -> {
                    boolean hasJq = "true".equals(unquote(res));
                    Runnable runAdapter = () -> {
                        if (web == null) return;
                        web.evaluateJavascript(adapterSrc, null);
                        // 允许稍后重试：流程失败时用户可以再点一次「执行导入」
                        web.postDelayed(() -> scriptInjected = false, 1500);
                    };
                    if (!hasJq && jquerySrc != null && !jquerySrc.isEmpty()) {
                        web.evaluateJavascript(jquerySrc, null);
                        web.postDelayed(runAdapter, 120);
                    } else {
                        web.postDelayed(runAdapter, 60);
                    }
                });
    }

    /* ============================================================
       桥：接收脚本消息
       ============================================================ */

    private class NativeBridge {
        @JavascriptInterface
        public void postMessage(String raw) {
            if (raw == null || finished) return;
            try {
                JSONObject msg = new JSONObject(raw);
                final String action = msg.optString("action", "");
                final String callbackId = msg.optString("callbackId", null);
                String payloadStr = msg.isNull("payload") ? null : msg.optString("payload");
                JSONObject payload = new JSONObject();
                if (payloadStr != null && !payloadStr.isEmpty()) {
                    try { payload = new JSONObject(payloadStr); } catch (Exception ignored) {}
                }
                handleAction(action, callbackId, payload);
            } catch (Exception e) {
                // 解析不了的消息直接丢弃，不能让脚本把 App 带崩
            }
        }
    }

    private void handleAction(String action, final String callbackId, JSONObject payload) {
        final Activity act = getActivity();
        switch (action) {
            case "showToast":
                if (act != null) act.runOnUiThread(() -> toast(payload.optString("message", "")));
                break;

            case "showAlert": {
                if (act == null) { rejectCallback(callbackId, "没有可用的界面"); return; }
                act.runOnUiThread(() -> {
                    new android.app.AlertDialog.Builder(act)
                            .setTitle(payload.optString("titleText", "提示"))
                            .setMessage(payload.optString("contentText", ""))
                            .setCancelable(true)
                            .setPositiveButton(payload.optString("confirmText", "确定"), (d, w) -> resolveCallback(callbackId, "true"))
                            .setNegativeButton("取消", (d, w) -> resolveCallback(callbackId, "false"))
                            .setOnCancelListener(d -> resolveCallback(callbackId, "false"))
                            .show();
                });
                break;
            }

            case "showPrompt": {
                if (act == null) { rejectCallback(callbackId, "没有可用的界面"); return; }
                act.runOnUiThread(() -> showPromptDialog(act, callbackId, payload));
                break;
            }

            case "showSingleSelection": {
                if (act == null) { rejectCallback(callbackId, "没有可用的界面"); return; }
                act.runOnUiThread(() -> showSingleSelectionDialog(act, callbackId, payload));
                break;
            }

            case "saveImportedCourses": {
                String coursesJson = payload.optString("coursesJsonString", "[]");
                try {
                    JSONArray arr = new JSONArray(coursesJson);
                    for (int i = 0; i < arr.length(); i++) {
                        JSONObject c = arr.optJSONObject(i);
                        if (c != null) importedCourses.add(c);
                    }
                    resolveCallback(callbackId, "true");
                } catch (Exception e) {
                    rejectCallback(callbackId, "课程数据解析失败：" + e.getMessage());
                }
                break;
            }

            case "saveCourseConfig": {
                String configJson = payload.optString("configJsonString", "{}");
                try {
                    courseConfig = new JSONObject(configJson);
                    resolveCallback(callbackId, "true");
                } catch (Exception e) {
                    rejectCallback(callbackId, "课表配置解析失败：" + e.getMessage());
                }
                break;
            }

            case "savePresetTimeSlots": {
                String slotsJson = payload.optString("timeSlotsJsonString", "[]");
                try {
                    presetTimeSlots = new JSONArray(slotsJson);
                    resolveCallback(callbackId, "true");
                } catch (Exception e) {
                    rejectCallback(callbackId, "节次时间解析失败：" + e.getMessage());
                }
                break;
            }

            case "saveComboSchedule":
                // 组合作息是拾光的扩展能力，清笺暂时不支持，明确拒绝而不是静默吞掉
                rejectCallback(callbackId, "当前版本不支持导入组合作息方案");
                break;

            case "notifyTaskCompletion":
                if (act != null) act.runOnUiThread(this::completeTask);
                break;

            default:
                if (callbackId != null) rejectCallback(callbackId, "未知的操作：" + action);
                break;
        }
    }

    /** 输入框：支持脚本自带校验函数（返回非空且非 false 视为校验未过）。 */
    private void showPromptDialog(Activity act, final String callbackId, JSONObject payload) {
        final EditText input = new EditText(act);
        input.setInputType(InputType.TYPE_CLASS_TEXT);
        input.setText(payload.optString("defaultText", ""));
        String tipText = payload.optString("tipText", "");
        if (!tipText.isEmpty()) input.setHint(tipText);
        int pad = dp(12);
        FrameLayout box = new FrameLayout(act);
        box.setPadding(pad, pad, pad, 0);
        box.addView(input, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        final String validator = payload.optString("validatorJsFunction", "");

        new android.app.AlertDialog.Builder(act)
                .setTitle(payload.optString("titleText", "请输入"))
                .setView(box)
                .setCancelable(true)
                .setPositiveButton("确定", (d, w) -> {
                    final String value = input.getText().toString();
                    if (validator == null || validator.trim().isEmpty()) {
                        resolveCallback(callbackId, jsString(value));
                        return;
                    }
                    if (web == null) { resolveCallback(callbackId, jsString(value)); return; }
                    web.evaluateJavascript(
                            "(function(){try{return String(" + validator + "(" + jsString(value) + "));}catch(e){return '';}})()",
                            res -> {
                                String v = unquote(res);
                                if (v == null || v.isEmpty() || "false".equalsIgnoreCase(v) || "null".equals(v)) {
                                    resolveCallback(callbackId, jsString(value));
                                } else {
                                    // 校验未过：把校验器返回的提示显示出来，让用户改完再提交
                                    toast(v);
                                }
                            });
                })
                .setNegativeButton("取消", (d, w) -> resolveCallback(callbackId, "null"))
                .setOnCancelListener(d -> resolveCallback(callbackId, "null"))
                .show();
    }

    private void showSingleSelectionDialog(Activity act, final String callbackId, JSONObject payload) {
        String title = payload.optString("titleText", "请选择");
        int defIdx = payload.optInt("defaultSelectedIndex", -1);
        final String[] items;
        try {
            JSONArray arr = new JSONArray(payload.optString("itemsJsonString", "[]"));
            items = new String[arr.length()];
            for (int i = 0; i < arr.length(); i++) items[i] = arr.optString(i, "");
        } catch (Exception e) {
            rejectCallback(callbackId, "选项列表解析失败");
            return;
        }
        if (items.length == 0) {
            rejectCallback(callbackId, "没有可选项");
            return;
        }
        final int[] chosen = { defIdx >= 0 && defIdx < items.length ? defIdx : 0 };
        new android.app.AlertDialog.Builder(act)
                .setTitle(title)
                .setSingleChoiceItems(items, chosen[0], (d, w) -> chosen[0] = w)
                .setCancelable(true)
                .setPositiveButton("确定", (d, w) -> resolveCallback(callbackId, String.valueOf(chosen[0])))
                .setNegativeButton("取消", (d, w) -> resolveCallback(callbackId, "null"))
                .setOnCancelListener(d -> resolveCallback(callbackId, "null"))
                .show();
    }

    /* ============================================================
       桥：把结果回给脚本
       ============================================================ */

    /** resolve：resultRawJs 必须是合法的 JS 表达式（true / false / 0 / null / "文本"）。 */
    private void resolveCallback(final String callbackId, final String resultRawJs) {
        if (callbackId == null || web == null) return;
        final String js = "window._shiguangNativeCallback('" + callbackId + "', true, " + resultRawJs + ");";
        runOnUi(js);
    }

    /** reject：用带 message 字段的对象，脚本里 error.message 才能取到原因。 */
    private void rejectCallback(final String callbackId, final String message) {
        if (callbackId == null || web == null) return;
        final String js = "window._shiguangNativeCallback('" + callbackId + "', false, {message:" + jsString(message) + "});";
        runOnUi(js);
    }

    private void runOnUi(final String js) {
        final Activity act = getActivity();
        if (act == null) return;
        act.runOnUiThread(() -> {
            if (web != null) {
                try { web.evaluateJavascript(js, null); } catch (Exception ignored) {}
            }
        });
    }

    /* ============================================================
       收尾
       ============================================================ */

    /** 脚本走完流程：把收集到的数据交给前端。 */
    private void completeTask() {
        if (finished) return;
        if (importedCourses.isEmpty()) {
            dismiss(null, "没有导入任何课程");
            return;
        }
        JSObject ret = new JSObject();
        JSArray courses = new JSArray();
        for (JSONObject c : importedCourses) {
            JSObject o = new JSObject();
            o.put("name", c.optString("name", ""));
            o.put("teacher", c.optString("teacher", ""));
            o.put("position", c.optString("position", ""));
            o.put("day", c.optInt("day", 1));
            o.put("startSection", c.optInt("startSection", 1));
            o.put("endSection", c.optInt("endSection", c.optInt("startSection", 1)));
            JSONArray wk = c.optJSONArray("weeks");
            JSArray weeks = new JSArray();
            if (wk != null) {
                for (int i = 0; i < wk.length(); i++) weeks.put(wk.optInt(i, 1));
            } else {
                weeks.put(1);
            }
            o.put("weeks", weeks);
            if (!c.isNull("credit")) o.put("credit", c.optDouble("credit", 0));
            courses.put(o);
        }
        ret.put("courses", courses);
        if (courseConfig != null) {
            JSObject cfg = new JSObject();
            cfg.put("semesterStartDate", courseConfig.optString("semesterStartDate", ""));
            ret.put("config", cfg);
        }
        if (presetTimeSlots != null && presetTimeSlots.length() > 0) {
            JSArray slots = new JSArray();
            for (int i = 0; i < presetTimeSlots.length(); i++) {
                JSONObject s = presetTimeSlots.optJSONObject(i);
                if (s == null) continue;
                JSObject o = new JSObject();
                o.put("number", s.optInt("number", i + 1));
                o.put("startTime", s.optString("startTime", ""));
                o.put("endTime", s.optString("endTime", ""));
                slots.put(o);
            }
            ret.put("timeSlots", slots);
        }
        ret.put("adapterName", adapterName);
        dismiss(ret, null);
    }

    private void dismiss(JSObject result, String cancelled) {
        finished = true;
        if (dialog != null) {
            try { dialog.dismiss(); } catch (Exception ignored) {}
            dialog = null;
        }
        if (web != null) {
            try {
                web.stopLoading();
                web.removeJavascriptInterface("_shiguangNativeBridge");
                web.destroy();
            } catch (Exception ignored) {}
            web = null;
        }
        PluginCall c = pending;
        pending = null;
        if (c == null) return;
        if (result != null) c.resolve(result);
        else c.reject(cancelled == null ? "已取消" : cancelled);
    }

    private void toast(final String msg) {
        final Activity act = getActivity();
        if (act == null) return;
        act.runOnUiThread(() -> {
            if (msg != null && !msg.isEmpty()) {
                Toast.makeText(act, msg, Toast.LENGTH_SHORT).show();
            }
        });
    }

    /** evaluateJavascript 的返回值是「JSON 字面量」，脱掉外层引号与转义。 */
    private String unquote(String v) {
        if (v == null || v.equals("null")) return null;
        String s = v.trim();
        if (s.length() >= 2 && s.startsWith("\"") && s.endsWith("\"")) {
            s = s.substring(1, s.length() - 1);
            s = s.replace("\\\\", "\u0000").replace("\\\"", "\"").replace("\\n", "\n")
                 .replace("\\r", "\r").replace("\\t", "\t").replace("\u0000", "\\");
        }
        return s;
    }

    /** 把任意文本编码成可安全嵌进 JS 源码的字符串字面量。 */
    private String jsString(String s) {
        if (s == null) return "null";
        StringBuilder sb = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                case '\b': sb.append("\\b"); break;
                case '\f': sb.append("\\f"); break;
                case '<': sb.append("\\u003c"); break;
                case '>': sb.append("\\u003e"); break;
                case '&': sb.append("\\u0026"); break;
                case '\u2028': sb.append("\\u2028"); break;
                case '\u2029': sb.append("\\u2029"); break;
                default:
                    if (c < 0x20) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
            }
        }
        sb.append('"');
        return sb.toString();
    }

    private int dp(int v) {
        return Math.round(getActivity().getResources().getDisplayMetrics().density * v);
    }

    @Override
    protected void handleOnDestroy() {
        dismiss(null, "页面已关闭");
        super.handleOnDestroy();
    }
}
