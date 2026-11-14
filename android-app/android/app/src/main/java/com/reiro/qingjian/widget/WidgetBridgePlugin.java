package com.reiro.qingjian.widget;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

/**
 * 网页 ↔ 桌面小组件的数据桥。
 *
 * 网页侧每次保存课表时调用 setData，把「学期起始、节次时间、课程列表」原样推过来。
 * 这里只负责落盘并让小组件重画，具体「今天第几周、有没有课」由小组件自己按日期现算，
 * 这样隔几天不开 App，桌面上的内容也不会过期。
 */
@CapacitorPlugin(name = "WidgetBridge")
public class WidgetBridgePlugin extends Plugin {

    @PluginMethod
    public void setData(PluginCall call) {
        try {
            JSObject data = call.getObject("data");
            JSONObject obj = (data == null) ? new JSONObject() : new JSONObject(data.toString());
            WidgetData.save(getContext(), obj);
            WidgetUpdater.refreshAll(getContext());
            call.resolve();
        } catch (Exception e) {
            call.reject("小组件数据写入失败");
        }
    }

    /** 清空（清空课表 / 恢复空数据时用） */
    @PluginMethod
    public void clear(PluginCall call) {
        try {
            WidgetData.save(getContext(), new JSONObject());
            WidgetUpdater.refreshAll(getContext());
            call.resolve();
        } catch (Exception e) {
            call.reject("小组件数据清理失败");
        }
    }
}
