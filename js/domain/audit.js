/* 审计领域：关键操作留痕，哈希链保证日志不可篡改 */
(function (global) {
    'use strict';

    var TMS = global.TMS = global.TMS || {};
    var util = TMS.util, db = TMS.db;

    var ACTIONS = {
        'order.create': '创建订单', 'order.change': '订单改单', 'order.cancel': '订单取消',
        'order.advance': '状态推进', 'order.recheck': '计费复核',
        'exception.create': '异常上报', 'exception.assign': '异常定责', 'exception.close': '异常闭环',
        'claim.approve': '理赔审批', 'finance.settle': '收付结算', 'cod.remit': '代收款上划',
        'rate.update': '运价调整', 'user.login': '用户登录', 'user.manage': '账号变更',
        'hr.manage': '人事变更', 'perf.calc': '绩效核算',
        'network.update': '网络变更', 'vehicle.manage': '车辆变更', 'data.rebuild': '数据重建',
        'address.maintain': '派送地址维护', 'address.review': '派送地址审核'
    };

    function lastHash() {
        var rows = db.col('auditLogs');
        // 裁剪过的日志以锚点续链，未裁剪则从创世块起链
        return rows.length ? rows[rows.length - 1].hash : (db.load().auditAnchor || 'GENESIS');
    }

    /* 写入审计：prev 链 + 内容 hash，任何事后修改都会在校验时暴露 */
    function log(action, entity, refId, detail, actor, extra) {
        var at = util.iso(util.now());
        var prev = lastHash();
        var payload = [prev, action, entity, refId, at, actor, detail].join('|');
        var rec = {
            at: at, action: action, actionName: ACTIONS[action] || action,
            entity: entity, refId: refId || '', detail: detail || '',
            actor: actor || (TMS.auth.current() || {}).name || '系统',
            role: (TMS.auth.current() || {}).role || 'system',
            prev: prev, hash: 'h' + util.pad(util.hash(payload), 10),
            ip: (extra && extra.ip) || '10.20.' + (1 + util.hash(String(refId)) % 200) + '.' + (2 + util.hash(String(actor || 'x')) % 250)
        };
        db.create('auditLogs', rec);
        if (!db.batchDepth()) db.persist('audit');
        return rec;
    }

    function list(opts) {
        return db.list('auditLogs', opts || {});
    }

    /* 校验哈希链，返回第一个断点；锚点是最近一次裁剪前最后一条的哈希，未裁剪时为 GENESIS */
    function verify() {
        var rows = db.col('auditLogs');
        var anchor = db.load().auditAnchor || 'GENESIS';
        var prev = anchor;
        for (var i = 0; i < rows.length; i++) {
            var r = rows[i];
            if (r.prev !== prev) return { ok: false, index: i, message: '链断裂于 ' + r.id };
            var expect = 'h' + util.pad(util.hash([r.prev, r.action, r.entity, r.refId, r.at, r.actor, r.detail].join('|')), 10);
            if (r.hash !== expect) return { ok: false, index: i, message: '内容被篡改：' + r.id };
            prev = r.hash;
        }
        return { ok: true, count: rows.length };
    }

    function actionOptions() {
        return Object.keys(ACTIONS).map(function (k) { return { value: k, label: ACTIONS[k] }; });
    }

    TMS.audit = { ACTIONS: ACTIONS, log: log, list: list, verify: verify, actionOptions: actionOptions };
})(window);
