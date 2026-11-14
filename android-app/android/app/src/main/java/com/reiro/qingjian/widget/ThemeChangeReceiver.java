package com.reiro.qingjian.widget;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * 系统切换深色 / 浅色时重画小组件。
 *
 * 小组件的明暗现在跟随系统（见 WidgetData.isNight），但 RemoteViews 不会因为
 * 系统换主题自己重画——不接这个广播的话，用户切到浅色后小组件还停留在旧配色，
 * 直到下次 App 同步或桌面重新加载才更新。
 */
public class ThemeChangeReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String a = intent.getAction();
        if (Intent.ACTION_CONFIGURATION_CHANGED.equals(a)) {
            WidgetUpdater.refreshAll(context);
        }
    }
}
