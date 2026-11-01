/* 定时任务：真实项目由后台调度器执行，这里在进入页面时按同一套规则回放，保证看板数据自洽 */
(function (global) {
    'use strict';

    var TMS = global.TMS = global.TMS || {};
    var util = TMS.util, db = TMS.db, cfg = TMS.cfg;

    var RULES = [
        { key: 'traceOvertime', name: '轨迹超时巡检', run: traceOvertime },
        { key: 'exceptionEscalate', name: '异常工单超时升级', run: escalateOverdue },
        { key: 'receivableOverdue', name: '应收逾期与信用管控', run: receivableOverdue },
        { key: 'vehicleMaintenance', name: '车辆保养到期', run: vehicleMaintenance },
        { key: 'materialStock', name: '物料安全库存', run: materialStock },
        { key: 'deviceHealth', name: '扫描设备健康', run: deviceHealth },
        { key: 'tripDeparture', name: '班次未按时发车', run: tripDeparture },
        { key: 'slaBacklog', name: '压单预警', run: slaBacklog },
        { key: 'purgeAlerts', name: '告警归档清理', run: purgeAlerts }
    ];

    function addAlert(data) {
        var d = data || {};
        if (!d.key) return null;
        var existing = db.findOne('alerts', function (a) { return a.key === d.key && a.status === 'open'; });
        if (existing) {
            existing.hitCount = (existing.hitCount || 1) + 1;
            existing.lastAt = util.iso(util.now());
            db.touch('alerts');
            return existing;
        }
        return db.create('alerts', {
            key: d.key, level: d.level || 'warn', title: d.title, message: d.message,
            category: d.category || 'system', entity: d.entity || '', refId: d.refId || '',
            owner: d.owner || '系统管理员', status: 'open', hitCount: 1,
            firstAt: util.iso(util.now()), lastAt: util.iso(util.now()), resolvedAt: ''
        });
    }

    function closeAlert(key, note) {
        var a = db.findOne('alerts', function (x) { return x.key === key && x.status === 'open'; });
        if (!a) return null;
        return db.update('alerts', a.id, { status: 'resolved', resolvedAt: util.iso(util.now()), resolveNote: note || '自动恢复' });
    }

    /* 1. 节点超时：单条订单只看最后一个节点——前序节点的时限已被后续扫描证明达成。
       超时不落库标记，读取时由 TMS.order.traceView 派生，这里只负责补建异常工单 */
    function traceOvertime() {
        var nowMs = util.now().getTime();
        var idx = TMS.order.scanIndex();
        var flagged = 0, created = 0;
        Object.keys(idx).forEach(function (orderId) {
            var o = db.get('orders', orderId);
            if (!o || ['signed', 'cancelled', 'returned'].indexOf(o.status) > -1) return;
            var list = idx[orderId];
            var s = list && list[list.length - 1];
            if (!s || s.node === 'SIGNED') return;
            var due = TMS.order.scanDue(s);
            if (due >= nowMs) return;
            flagged++;
            var hours = (nowMs - due) / 3600000;
            if (hours > 12) {
                var already = db.col('exceptions').some(function (e) {
                    return e.orderId === o.id && e.type === '延迟送达' && util.hoursBetween(e.reportedAt, util.now()) < 24;
                });
                if (!already) {
                    TMS.service.createException({
                        orderId: o.id, type: '延迟送达', level: hours > 24 ? '二级' : '三级',
                        description: '节点[' + cfg.nodeOf(s.node).name + ']超标准时限 ' + util.round(hours, 1) + ' 小时未更新，系统自动预警',
                        source: '系统预警', actor: '超时巡检任务'
                    });
                    created++;
                }
            }
        });
        return { overtime: flagged, exceptions: created };
    }

    /* 2. 异常工单 SLA 超时升级 */
    function escalateOverdue() {
        var n = 0;
        db.col('exceptions').forEach(function (e) {
            if (e.status === 'resolved' || e.escalated || !e.slaDeadline) return;
            if (util.hoursBetween(e.slaDeadline, util.now()) > cfg.sla.escalteHours) {
                TMS.service.escalateException(e.id, '超过 SLA ' + cfg.sla.escalteHours + ' 小时，自动升级运营主管');
                n++;
            }
        });
        if (n) addAlert({ key: 'exception:escalated', level: 'danger', title: '异常工单批量升级', message: n + ' 张工单超时升级至运营主管', category: 'service' });
        return { escalated: n };
    }

    /* 3. 应收逾期：生成告警并对超限客户信用挂起 */
    function receivableOverdue() {
        var rows = db.col('receivables').filter(function (r) { return r.status === 'pending' && util.toDate(r.dueDate) < util.now(); });
        rows.forEach(function (r) {
            addAlert({
                key: 'ar:overdue:' + r.id, level: util.hoursBetween(r.dueDate, util.now()) > 24 * 10 ? 'danger' : 'warn',
                title: '应收逾期', message: TMS.order.customerName(r) + ' 单号 ' + r.orderId + ' 逾期 ' + Math.round(util.hoursBetween(r.dueDate, util.now()) / 24) + ' 天，金额 ' + util.fmt.money(r.amount),
                category: 'finance', entity: 'receivables', refId: r.id, owner: '财务部'
            });
            var c = r.customerId ? db.get('customers', r.customerId) : null;
            if (c) {
                var overdueTotal = util.sum(db.col('receivables').filter(function (x) {
                    return x.customerId === c.id && x.status === 'pending' && util.toDate(x.dueDate) < util.now();
                }), 'amount');
                if (c.creditLimit && overdueTotal > c.creditLimit) {
                    if (c.status !== 'suspended') {
                        db.update('customers', c.id, { status: 'suspended', suspendReason: '逾期 ' + util.money(overdueTotal) + ' 超信用额度 ' + c.creditLimit });
                        addAlert({ key: 'customer:credit:' + c.id, level: 'danger', title: '客户信用冻结', message: c.name + ' 逾期金额超信用额度，已暂停下单', category: 'finance', entity: 'customers', refId: c.id, owner: '财务部' });
                    }
                } else if (c.status === 'suspended' && String(c.suspendReason || '').indexOf('逾期') === 0) {
                    db.update('customers', c.id, { status: 'active', suspendReason: '' });
                    closeAlert('customer:credit:' + c.id, '逾期金额回落，自动恢复');
                }
            }
        });
        return { overdue: rows.length, amount: util.money(util.sum(rows, 'amount')) };
    }

    function vehicleMaintenance() {
        var due = db.col('vehicles').filter(function (v) { return v.nextCheckAt && util.toDate(v.nextCheckAt) <= util.addDays(util.now(), 7); });
        due.forEach(function (v) {
            addAlert({ key: 'vehicle:maintenance:' + v.id, level: 'warn', title: '车辆保养到期', message: v.plate + '（' + v.typeName + '）保养到期日 ' + v.nextCheckAt + '，里程 ' + v.odometer + ' km', category: 'asset', entity: 'vehicles', refId: v.id, owner: '车队长' });
        });
        return { due: due.length };
    }

    function materialStock() {
        var low = db.col('materials').filter(function (m) { return m.stock < m.safeStock; });
        low.forEach(function (m) {
            m.status = m.stock <= 0 ? 'out' : 'low';
            db.touch('materials');
            addAlert({ key: 'material:low:' + m.id, level: m.stock <= 0 ? 'danger' : 'warn', title: '物料库存不足', message: m.name + ' 现存 ' + m.stock + m.unit + '，安全库存 ' + m.safeStock + m.unit, category: 'asset', entity: 'materials', refId: m.id, owner: '仓储部' });
        });
        return { low: low.length };
    }

    function deviceHealth() {
        var bad = db.col('devices').filter(function (d) { return d.status === 'fault' || (d.status === 'offline' && util.hoursBetween(d.lastSyncAt, util.now()) > 12); });
        bad.forEach(function (d) {
            addAlert({ key: 'device:' + d.id, level: d.status === 'fault' ? 'danger' : 'warn', title: '扫描设备异常', message: d.name + '（' + d.model + '）' + (d.status === 'fault' ? '上报故障' : '离线超 12 小时') + '，归属 ' + d.ownerName, category: 'system', entity: 'devices', refId: d.id, owner: '信息技术部' });
        });
        return { faulty: bad.length };
    }

    function tripDeparture() {
        var late = db.col('transports').filter(function (t) {
            if (t.status !== 'pending' || !t.date) return false;
            var planned = util.toDate(t.date + 'T' + (t.departAt || '20:00') + ':00');
            return util.now().getTime() - planned.getTime() > 3600000;
        });
        late.forEach(function (t) {
            addAlert({ key: 'trip:late:' + t.id, level: 'warn', title: '班次未按时发车', message: TMS.operation.labelOf(t) + ' 计划 ' + t.departAt + ' 发车，仍有 ' + t.orders + ' 单未装车发出', category: 'transport', entity: 'transports', refId: t.id, owner: '运输调度部' });
        });
        return { late: late.length };
    }

    function slaBacklog() {
        var rows = db.col('orders').filter(function (o) {
            return !TMS.order.isTerminal(o) && TMS.order.stuckHours(o) > 24;
        });
        if (rows.length) {
            addAlert({
                key: 'sla:backlog', level: rows.length > 20 ? 'danger' : 'warn', title: '压单预警',
                message: rows.length + ' 个订单滞留超 24 小时，最久 ' + Math.round(util.sum(rows, function (o) { return TMS.order.stuckHours(o); }) / rows.length) + ' 小时',
                category: 'operation', owner: '运营管理部'
            });
        } else closeAlert('sla:backlog', '滞留订单已清零');
        return { backlog: rows.length };
    }

    function purgeAlerts() {
        var removed = db.removeWhere('alerts', function (a) {
            return a.status === 'resolved' && util.hoursBetween(a.resolvedAt, util.now()) > 24 * 30;
        });
        return { removed: removed };
    }

    /* 入口：进入任意页面时执行一次，同一时间窗内不重复（避免频繁刷新导致数据漂移） */
    function sweep(force) {
        var last = db.load().lastSweepAt;
        if (!force && last && util.hoursBetween(last, util.now()) < 0.2) return { skipped: true };
        var result = { skipped: false, jobs: [], alerts: 0 };
        RULES.forEach(function (r) {
            try {
                var out = r.run() || {};
                result.jobs.push({ key: r.key, name: r.name, out: out });
            } catch (err) {
                if (console) console.error('[TMS] 任务失败 ' + r.name, err);
                result.jobs.push({ key: r.key, name: r.name, error: String(err && err.message || err) });
            }
        });
        result.alerts = db.col('alerts').filter(function (a) { return a.status === 'open'; }).length;
        db.load().lastSweepAt = util.iso(util.now());
        db.persist('sweep');
        TMS.bus.emit('jobs:swept', result);
        return result;
    }

    TMS.jobs = {
        RULES: RULES, sweep: sweep, addAlert: addAlert, closeAlert: closeAlert,
        run: function (key) {
            var r = RULES.filter(function (x) { return x.key === key; })[0];
            if (!r) return { ok: false, message: '未知任务：' + key };
            var out = r.run() || {};
            db.persist('job:' + key);
            return { ok: true, name: r.name, out: out };
        }
    };
})(window);
