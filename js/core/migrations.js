/* schema 迁移登记：版本号 → 升级函数（缺登记则重建种子）
   由 js/core/db.js 在载入老库时逐级回放，所以本文件只描述「数据怎么变」，不碰外壳与加载顺序。
   v7 刻意不登记迁移：演示账号要重新绑定到真实员工/客户档案（personId/customerId），
   绑定关系在建库时随主数据一起生成，老库里那批假组织号无法就地补齐，直接重建最干净 */
(function (global) {
    'use strict';

    var TMS = global.TMS = global.TMS || {};

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
        },
        /* v8 → v9：网点端从手持作业壳换成桌面后台壳，侧栏里要多一格「分拣交接」。
           权限的单一事实是 roles 行（用户权限页改的就是它），所以这里补的是出厂行，
           而且只在权限串仍等于 v8 默认时才动——主管自己勾过的组合保持原样 */
        9: function (db, TMS) {
            var V8_BRANCH = ['overview:view', 'order:view', 'order:create', 'order:advance', 'order:change',
                'tracking:view', 'scan:operate', 'loading:operate', 'exception:create', 'service:handle',
                'cod:remit', 'customer:manage', 'warehouse:manage', 'report:view', 'evaluation:manage'];
            (db.data.roles || []).forEach(function (r) {
                if (!r.builtin || r.code !== 'branch') return;
                var cur = r.permissionCodes || [];
                if (cur.length !== V8_BRANCH.length) return;
                if (!V8_BRANCH.every(function (c) { return cur.indexOf(c) > -1; })) return;
                r.permissionCodes = TMS.rbac.defaultPerms('branch');
                r.updatedAt = TMS.util.iso(TMS.util.now());
                r.actor = 'v9 桌面端升级';
            });
        }
    };
})(window);
