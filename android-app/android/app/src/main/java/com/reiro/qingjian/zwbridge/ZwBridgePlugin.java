package com.reiro.qingjian.zwbridge;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.Dialog;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 从教务系统直接读取课表。
 *
 * 为什么要自己写插件：官方的 @capacitor/inappbrowser 只能「显示」网页，
 * 既不提供 executeScript 也不提供 postMessage（1.x / 2.x / 4.x 都没有），
 * 拿不到页面里的数据。课表接口又必须带登录态 cookie，只能在同一个 WebView 里取。
 *
 * 做法：弹一个全屏 Dialog，里面放一个独立 WebView 打开教务系统；
 * 用户手动登录（本插件不接触账号密码）；检测到已进入教务系统后，
 * 在这个 WebView 上下文里 fetch 课表接口，把 HTML 回传给 JS 侧解析。
 */
@CapacitorPlugin(name = "ZwBridge")
public class ZwBridgePlugin extends Plugin {

    private Dialog dialog;
    private WebView web;
    private PluginCall pending;
    private boolean grabbing = false;

    @PluginMethod
    public void openAndGrab(PluginCall call) {
        final String url = call.getString("url", "http://jwxt.wru.edu.cn/jsxsd/");
        final String apiPath = call.getString("apiPath", "/jsxsd/xskb/xskb_list.do");
        final Activity act = getActivity();
        if (act == null) { call.reject("没有可用的 Activity"); return; }

        // 同一时间只允许一个会话
        if (pending != null) { call.reject("已经有一个读取会话在进行中"); return; }
        pending = call;
        grabbing = false;

        act.runOnUiThread(() -> showDialog(act, url, apiPath));
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void showDialog(final Activity act, final String url, final String apiPath) {
        dialog = new Dialog(act);
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);

        LinearLayout root = new LinearLayout(act);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);

        // 顶部条：标题 + 「读取课表」+ 关闭
        LinearLayout bar = new LinearLayout(act);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setBackgroundColor(0xFF1F6F63);
        int pad = dp(10);
        bar.setPadding(pad, pad, pad, pad);

        TextView title = new TextView(act);
        title.setText("登录教务系统");
        title.setTextColor(Color.WHITE);
        title.setTextSize(16f);
        LinearLayout.LayoutParams tp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        title.setLayoutParams(tp);
        bar.addView(title);

        Button grabBtn = new Button(act);
        grabBtn.setText("读取课表");
        grabBtn.setAllCaps(false);
        bar.addView(grabBtn);

        Button closeBtn = new Button(act);
        closeBtn.setText("关闭");
        closeBtn.setAllCaps(false);
        bar.addView(closeBtn);

        root.addView(bar, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        // 一个非常薄的进度提示条
        final TextView tip = new TextView(act);
        tip.setText("请登录你的账号，登录后会自动读取课表");
        tip.setTextSize(12f);
        tip.setPadding(pad, dp(6), pad, dp(6));
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

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(web, true);

        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String u) {
                // 每次页面加载完成都试一次：不在登录页就抓课表
                if (u != null && u.contains("cas.wru.edu.cn")) {
                    tip.setText("请登录你的账号，登录后会自动读取课表");
                    return;
                }
                if (u != null && u.contains("/jsxsd/")) {
                    tip.setText("已进入教务系统，正在读取课表…");
                    // 稍等一下，让页面自己的初始化逻辑跑完
                    view.postDelayed(() -> tryGrab(view, apiPath, tip), 900);
                }
            }
        });

        root.addView(web, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        dialog.setContentView(root);

        Window w = dialog.getWindow();
        if (w != null) {
            w.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
            w.setBackgroundDrawableResource(android.R.color.white);
        }
        dialog.setCanceledOnTouchOutside(false);
        dialog.setOnCancelListener(d -> finish(null, "已取消"));
        dialog.show();
        if (w != null) {
            w.setLayout(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT);
        }

        grabBtn.setOnClickListener(v -> tryGrab(web, apiPath, tip));
        closeBtn.setOnClickListener(v -> dismiss(null, "已取消"));

        web.loadUrl(url);
    }

    /** 在课表页上下文里 fetch 接口，把 HTML 回传。 */
    private void tryGrab(final WebView view, String apiPath, TextView tip) {
        if (grabbing || pending == null) return;
        grabbing = true;
        String js =
            "(function(){try{" +
            "  var x=new XMLHttpRequest();" +
            "  x.open('GET','" + apiPath + "',false);" +
            "  x.withCredentials=true;" +
            "  x.send(null);" +
            "  if(x.status===200 && x.responseText.indexOf('kbtable')>=0){" +
            "    return JSON.stringify({ok:true,html:x.responseText});" +
            "  }" +
            "  return JSON.stringify({ok:false,status:x.status,hasTable:x.responseText.indexOf('kbtable')>=0});" +
            "}catch(e){return JSON.stringify({ok:false,err:String(e)});}})()";
        view.evaluateJavascript(js, value -> {
            grabbing = false;
            String raw = unquoteJsonString(value);
            if (raw == null) return;
            if (raw.contains("\"ok\":true")) {
                String html = extractJsonString(raw, "html");
                if (html != null && !html.isEmpty()) {
                    JSObject ret = new JSObject();
                    ret.put("html", html);
                    dismiss(ret, null);
                    return;
                }
            }
            // 没拿到：可能还没登录，或者课表页没打开
            if (tip != null) tip.setText("暂时读不到课表，请确认已登录并已进入「学期理论课表」，再点「读取课表」");
        });
    }

    /** evaluateJavascript 的回调值是「JSON 字符串的 JSON 字面量」，先脱一层引号与转义。 */
    private String unquoteJsonString(String v) {
        if (v == null || v.equals("null")) return null;
        String s = v.trim();
        if (s.startsWith("\"") && s.endsWith("\"") && s.length() >= 2) {
            s = s.substring(1, s.length() - 1);
            s = s.replace("\\\\", "\\").replace("\\\"", "\"").replace("\\n", "\n").replace("\\r", "\r");
        }
        return s;
    }

    /** 从 {ok:true,html:"..."} 里取 html 字段（按 JSON 转义规则还原）。 */
    private String extractJsonString(String json, String key) {
        String marker = "\"" + key + "\":\"";
        int i = json.indexOf(marker);
        if (i < 0) return null;
        i += marker.length();
        StringBuilder sb = new StringBuilder();
        for (int p = i; p < json.length(); p++) {
            char c = json.charAt(p);
            if (c == '\\' && p + 1 < json.length()) {
                char n = json.charAt(++p);
                switch (n) {
                    case 'n': sb.append('\n'); break;
                    case 'r': sb.append('\r'); break;
                    case 't': sb.append('\t'); break;
                    case 'b': sb.append('\b'); break;
                    case 'f': sb.append('\f'); break;
                    case 'u':
                        if (p + 4 < json.length()) {
                            try { sb.append((char) Integer.parseInt(json.substring(p + 1, p + 5), 16)); p += 4; }
                            catch (Exception e) { sb.append(n); }
                        }
                        break;
                    default: sb.append(n);
                }
            } else if (c == '"') {
                break;
            } else {
                sb.append(c);
            }
        }
        return sb.toString();
    }

    private void dismiss(JSObject result, String cancelled) {
        if (dialog != null) { try { dialog.dismiss(); } catch (Exception ignored) {} dialog = null; }
        if (web != null) {
            try { web.stopLoading(); web.destroy(); } catch (Exception ignored) {}
            web = null;
        }
        PluginCall c = pending;
        pending = null;
        if (c == null) return;
        if (result != null) c.resolve(result);
        else c.reject(cancelled == null ? "已取消" : cancelled);
    }

    private void finish(JSObject result, String cancelled) { dismiss(result, cancelled); }

    /** 用户按系统返回键时，先关掉这个弹窗。 */
    public boolean handleBack() {
        if (dialog != null && dialog.isShowing()) { dismiss(null, "已取消"); return true; }
        return false;
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
