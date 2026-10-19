/* =========================================================================
 * 通用教务导入 —— JS 桥初始化脚本
 *
 * 来源：拾光课程表（ShiGuangSchedule）的 WebBridgeProtocol.kt / JS_BRIDGE_INIT。
 * 作用：把 window.shiguangBridgePromise（异步）与 window.shiguangBridge（同步）
 *       挂到页面上，适配脚本据此与 App 通信。
 *
 * 通信协议（与拾光完全一致，故仓库里的现成适配脚本可原样运行）：
 *   JS  → Native : _shiguangNativeBridge.postMessage(JSON.stringify({
 *                       action, callbackId, payload
 *                   }))，其中 payload 又是一层 JSON 字符串
 *   Native → JS  : window._shiguangNativeCallback(callbackId, isSuccess, resultRawJs)
 *                   resultRawJs 是「裸 JS 表达式」：true / false / 0 / null / "文本"
 *
 * 本文件由 UniImportPlugin 在注入适配脚本之前执行；重复注入会被标记幂等。
 * ========================================================================= */
(function() {
    if (window._shiguangBridgeInjected) return;
    window._shiguangBridgeInjected = true;

    var callbacks = {};
    var callbackCounter = 0;

    /** 动态获取当前可用的 Native 发送管道（Android 侧为 _shiguangNativeBridge）。 */
    function postRawMessage(msg) {
        if (window._shiguangNativeBridge && typeof window._shiguangNativeBridge.postMessage === 'function') {
            window._shiguangNativeBridge.postMessage(msg);
            return;
        }
        if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.shiguangBridge) {
            window.webkit.messageHandlers.shiguangBridge.postMessage(msg);
            return;
        }
        if (typeof window.cefQuery === 'function') {
            window.cefQuery({ request: msg });
            return;
        }
        console.warn("[ShiguangBridge] Native bridge unavailable:", msg);
    }

    /** 通用底层管道：把请求统一转成 JSON 发给 Native。 */
    function postMessageToNative(action, payload, callbackId) {
        var msg = JSON.stringify({
            action: action,
            callbackId: callbackId || null,
            payload: payload ? JSON.stringify(payload) : null
        });
        postRawMessage(msg);
    }

    /** Native 异步逻辑完成后的响应全局入口。 */
    window._shiguangNativeCallback = function(callbackId, isSuccess, result) {
        var cb = callbacks[callbackId];
        if (cb) {
            if (isSuccess) {
                cb.resolve(result);
            } else {
                cb.reject(result);
            }
            delete callbacks[callbackId];
        }
    };

    // 1. 异步 Promise 调用的 JS 接口
    var shiguangBridgePromise = {
        showAlert: function(titleText, contentText, confirmText) {
            return new Promise(function(resolve, reject) {
                var id = 'cb_' + (++callbackCounter) + '_' + Date.now();
                callbacks[id] = { resolve: resolve, reject: reject };
                postMessageToNative('showAlert', {
                    titleText: titleText || '',
                    contentText: contentText || '',
                    confirmText: confirmText || null
                }, id);
            });
        },
        showPrompt: function(titleText, tipText, defaultText, validatorJsFunction) {
            return new Promise(function(resolve, reject) {
                var id = 'cb_' + (++callbackCounter) + '_' + Date.now();
                callbacks[id] = { resolve: resolve, reject: reject };
                postMessageToNative('showPrompt', {
                    titleText: titleText || '',
                    tipText: tipText || '',
                    defaultText: defaultText || '',
                    validatorJsFunction: validatorJsFunction || ''
                }, id);
            });
        },
        showSingleSelection: function(titleText, items, defaultSelectedIndex) {
            return new Promise(function(resolve, reject) {
                var id = 'cb_' + (++callbackCounter) + '_' + Date.now();
                callbacks[id] = { resolve: resolve, reject: reject };
                var itemsJson = (typeof items === 'string') ? items : JSON.stringify(items || []);
                postMessageToNative('showSingleSelection', {
                    titleText: titleText || '',
                    itemsJsonString: itemsJson,
                    defaultSelectedIndex: defaultSelectedIndex !== undefined ? defaultSelectedIndex : -1
                }, id);
            });
        },
        saveImportedCourses: function(coursesJsonString) {
            return new Promise(function(resolve, reject) {
                var id = 'cb_' + (++callbackCounter) + '_' + Date.now();
                callbacks[id] = { resolve: resolve, reject: reject };
                postMessageToNative('saveImportedCourses', { coursesJsonString: coursesJsonString }, id);
            });
        },
        saveCourseConfig: function(configJsonString) {
            return new Promise(function(resolve, reject) {
                var id = 'cb_' + (++callbackCounter) + '_' + Date.now();
                callbacks[id] = { resolve: resolve, reject: reject };
                postMessageToNative('saveCourseConfig', { configJsonString: configJsonString }, id);
            });
        },
        savePresetTimeSlots: function(timeSlotsJsonString) {
            return new Promise(function(resolve, reject) {
                var id = 'cb_' + (++callbackCounter) + '_' + Date.now();
                callbacks[id] = { resolve: resolve, reject: reject };
                postMessageToNative('savePresetTimeSlots', { timeSlotsJsonString: timeSlotsJsonString }, id);
            });
        },
        saveComboSchedule: function(comboScheduleJsonString) {
            return new Promise(function(resolve, reject) {
                var id = 'cb_' + (++callbackCounter) + '_' + Date.now();
                callbacks[id] = { resolve: resolve, reject: reject };
                var comboJson = (typeof comboScheduleJsonString === 'string') ? comboScheduleJsonString : JSON.stringify(comboScheduleJsonString || {});
                postMessageToNative('saveComboSchedule', { comboScheduleJsonString: comboJson }, id);
            });
        }
    };

    // 2. 单向/同步调用的 JS 接口
    var shiguangBridge = {
        showToast: function(message) {
            postMessageToNative('showToast', { message: message });
        },
        notifyTaskCompletion: function() {
            postMessageToNative('notifyTaskCompletion');
        }
    };

    // 3. 挂载全局对象
    window.shiguangBridgePromise = shiguangBridgePromise;
    window.shiguangBridge = shiguangBridge;

    // 旧版兼容接口
    window.AndroidBridgePromise = shiguangBridgePromise;
    window.AndroidBridge = shiguangBridge;
})();
