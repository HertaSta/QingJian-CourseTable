package com.reiro.qingjian;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.reiro.qingjian.calbridge.CalBridgePlugin;
import com.reiro.qingjian.uniimport.UniImportPlugin;
import com.reiro.qingjian.zwbridge.ZwBridgePlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 自定义插件要在 super.onCreate 之前登记，Capacitor 才会把它挂到 bridge 上
        registerPlugin(ZwBridgePlugin.class);
        registerPlugin(CalBridgePlugin.class);
        registerPlugin(UniImportPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
