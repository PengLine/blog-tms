/* 运行时装配：按依赖顺序注入模块（无构建工具、file:// 可直开），并完成建库、巡检与启动
   用法：页面只需 <script src="js/boot.js?v=token"></script> 与 TMS.start(portal, pageId) */
(function (global) {
    'use strict';

    var TMS = global.TMS = global.TMS || {};

    var MODULES = [
        'js/core/config.js',
        'js/core/utils.js',
        'js/core/bus.js',
        'js/core/db.js',
        'js/core/ids.js',
        'js/core/auth.js',
        'js/core/rbac.js',
        'js/data/master.js',
        'js/domain/pricing.js',
        'js/domain/network.js',
        'js/data/seed.js',
        'js/domain/order.js',
        'js/domain/operation.js',
        'js/domain/finance.js',
        'js/domain/service.js',
        'js/domain/people.js',
        'js/domain/stats.js',
        'js/domain/audit.js',
        'js/domain/jobs.js',
        'js/ui/kit.js',
        'js/ui/charts.js',
        'js/ui/shell.js',
        'js/pages/registry.js',
        'js/pages/portal.js',
        'js/pages/admin.js',
        'js/pages/branch.js',
        'js/pages/sorter.js',
        'js/pages/transporter.js',
        'js/pages/deliveryman.js',
        'js/pages/client.js'
    ];

    /* 缓存 token 跟随 boot.js 自身：python tools/gen_pages.py --token v=xxx 改一处即可全量刷新所有页面外壳 */
    function token() {
        var self = global.document && document.currentScript;
        var src = self ? self.getAttribute('src') : '';
        var m = /[?&]v=([\w-]+)/.exec(src || '');
        return m ? 'v=' + m[1] : '';
    }

    function inject() {
        var t = token();
        var doc = global.document;
        if (!doc) return;
        MODULES.forEach(function (path) {
            doc.write('<script src="' + path + (t ? '?' + t : '') + '"><\/script>');
        });
    }

    /* schema 迁移登记：版本号 → 升级函数（缺登记则重建种子）
       v7 刻意不登记迁移：演示账号要重新绑定到真实员工/客户档案（personId/customerId），
       绑定关系在建库时随主数据一起生成，老库里那批假组织号无法就地补齐，直接重建最干净 */
    TMS.migrations = {
        5: function (db) {
            // 由 v4 演示库升级：补齐新增字段，轨迹叙述统一由扫描流水承载，删除冗余 timeline
            (db.data.orders || []).forEach(function (o) {
                if (!o.orderType) o.orderType = 'forward';
                delete o.timeline;
            });
        },
        6: function (db) {
            /* v5 → v6：行宽压缩。环节时间改由扫描流水派生，费用/成本/车次成本只存反查所需的键，
               绩效指标、班次名称、打卡归属等可推导字段不再逐行落库 */
            var STAGES = ['collectedAt', 'inboundAt', 'sortedAt', 'transitAt', 'arrivedAt', 'deliveringAt'];
            var COST_KEYS = { linehaul: 'lh', handling: 'hd', collect: 'cl', sortCost: 'sc', deliver: 'dl', packaging: 'pk', overhead: 'oh', operation: 'op', total: 'tot', margin: 'mg', linehaulKm: 'tp', hubPasses: 'hp' };
            (db.data.orders || []).forEach(function (o) {
                delete o.plan; delete o.freightBreakdown;
                STAGES.forEach(function (k) { delete o[k]; });
                var c = o.cost;
                if (c && c.lh === undefined) {
                    var lean = {};
                    Object.keys(COST_KEYS).forEach(function (k) { if (c[k] !== undefined) lean[COST_KEYS[k]] = c[k]; });
                    o.cost = lean;
                }
            });
            (db.data.transports || []).forEach(function (t) {
                delete t.orderIds;
                var c = t.cost;
                if (c && c.t === undefined) t.cost = { t: c.total || 0, km: c.km || 0, d: c.days || 1, r: c.ratePerKg || '' };
            });
            (db.data.finances || []).forEach(function (f) { if (!f.date) f.date = f.createdAt; });
            (db.data.receivables || []).forEach(function (r) {
                if (!r.date) r.date = r.createdAt;
                delete r.waybillNo; delete r.customerLevel; delete r.signedAt;
            });
            (db.data.performances || []).forEach(function (p) { delete p.metrics; });
            (db.data.shifts || []).forEach(function (s) { delete s.shiftName; delete s.startAt; delete s.endAt; delete s.hours; delete s.location; });
            (db.data.clockRecords || []).forEach(function (c) { delete c.role; delete c.orgId; delete c.orgName; delete c.earlyLeave; });
        },
        /* v7 → v8：仓储加「库存流水」台账。老库只有各仓当前存量，没有凭证链就无从核对账实，
           所以把现有存量落成一条期初建账入库，之后的出入库/调整都在这条链上做增减 */
        8: function (db, TMS) {
            var util = TMS.util;
            var counters = db.counters || (db.counters = {});
            var today = util.dateKey(util.now());
            var rows = db.data.stockMovements || (db.data.stockMovements = []);
            counters['@stockMovements'] = counters['@stockMovements'] || 0;
            (db.data.stocks || []).forEach(function (s) {
                counters['@stockMovements']++;
                rows.push({
                    id: 'SMV' + util.pad(counters['@stockMovements'], 6),
                    kind: 'in', date: today, warehouseId: s.warehouseId, materialId: s.materialId,
                    qty: Number(s.qty) || 0, reason: '期初建账（v8 升级）', operator: '系统',
                    createdAt: util.iso(util.now())
                });
            });
            (db.data.materials || []).forEach(function (m) { m.inTransit = 0; });
        }
    };

    function ready() {
        if (!TMS.db || !TMS.seed) {
            if (global.console) console.error('[TMS] 模块未加载完成，请检查 js/boot.js 的 MODULES 清单');
            return false;
        }
        TMS.db.load();
        if (!TMS.db.isSeeded()) TMS.db.reseed();
        return true;
    }

    function start(portal, pageId, rootSelector) {
        if (!ready()) return;
        var session = TMS.auth.require(TMS.cfg.roles[portal] ? portal : null);
        if (!session) return;
        // 定时任务模拟：进入页面先跑一轮 SLA 巡检，产出超时/升级/告警
        try { TMS.jobs.sweep(); } catch (err) { if (console) console.error('[TMS] 巡检失败', err); }
        var root = document.querySelector(rootSelector || '.content');
        if (!root) return;
        TMS.shell.mount({ portal: portal, pageId: pageId, root: root, session: session });
    }

    /* 演示数据维护：重建 / 导出 / 容量查看，供系统监控页调用 */
    function maintenance() {
        return {
            rebuild: function () { TMS.db.reset(); TMS.db.reseed(); TMS.bus.emit('data:change', { reason: 'rebuild' }); },
            info: function () { return TMS.db.info(); },
            export: function () { return JSON.stringify(TMS.db.load(), null, 2); }
        };
    }

    TMS.boot = { inject: inject, start: start, ready: ready, modules: MODULES };
    TMS.maintenance = maintenance();

    /* 未捕获异常统一提示，避免页面白屏无反馈 */
    global.addEventListener('error', function (e) {
        if (TMS.ui && TMS.ui.toast) TMS.ui.toast('运行时异常：' + (e.message || '未知错误'), 'error', 5000);
    });

    inject();
})(window);
