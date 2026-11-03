/* 事件总线：领域动作发布业务事件，页面与巡检任务订阅 */
(function (global) {
    'use strict';

    var TMS = global.TMS = global.TMS || {};

    var handlers = {};

    function on(event, fn) {
        (handlers[event] = handlers[event] || []).push(fn);
        return function () { off(event, fn); };
    }

    function once(event, fn) {
        var wrap = function (payload) { off(event, wrap); fn(payload); };
        return on(event, wrap);
    }

    function off(event, fn) {
        var list = handlers[event];
        if (!list) return;
        var i = list.indexOf(fn);
        if (i > -1) list.splice(i, 1);
    }

    function emit(event, payload) {
        var list = handlers[event];
        if (!list || !list.length) return;
        // 复制一份，允许回调内部再 on/off
        list.slice().forEach(function (fn) {
            try { fn(payload, event); } catch (err) { reportError(err, event); }
        });
    }

    function reportError(err, scope) {
        if (global.console && console.error) console.error('[TMS] 事件 ' + (scope || '') + ' 处理失败：', err);
    }

    TMS.bus = { on: on, once: once, off: off, emit: emit };

    /* 跨标签页同步：另一个页签写入后重新载入内存库并广播 */
    global.addEventListener('storage', function (e) {
        if (e.key === TMS.cfg.storage.key) {
            TMS.db.reload();
            TMS.bus.emit('data:external');
        }
    });
})(window);
