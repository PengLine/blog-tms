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
        { key: 'purchaseOverdue', name: '采购到货超期', run: purchaseOverdue },
        { key: 'deviceHealth', name: '扫描设备健康', run: deviceHealth },
        { key: 'fenceCoverage', name: '电子围栏覆盖缺口', run: fenceCoverage },
        { key: 'tripDeparture', name: '班次未按时发车', run: tripDeparture },
        { key: 'slaBacklog', name: '压单预警', run: slaBacklog },
        { key: 'perfGuard', name: '绩效改进计划跟踪', run: perfGuard },
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

    /* 条件型告警必须双向收口：本轮命中的补建，本轮不再命中的自动核销。
       只建不关的告警会永远挂在「未处理」上，看板数字与真实风险脱钩，巡检也就失去意义。 */
    function resolveGone(prefix, active, note) {
        var n = 0;
        db.col('alerts').forEach(function (a) {
            if (a.status !== 'open' || String(a.key).indexOf(prefix) !== 0 || active[a.key]) return;
            db.update('alerts', a.id, { status: 'resolved', resolvedAt: util.iso(util.now()), resolveNote: note || '条件已消除，自动核销' });
            n++;
        });
        return n;
    }

    function keysOf(list, prefix) {
        var out = {};
        list.forEach(function (x) { out[prefix + x.id] = 1; });
        return out;
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
        });
        /* 逾期按客户汇总后再判信用：额度是「客户整体欠了多少」，逐条应收各算一遍会重复触发冻结 */
        var byCustomer = util.groupBy(rows, 'customerId');
        var freezeKeys = {};
        db.col('customers').forEach(function (c) {
            if (!c.id) return;
            var overdueTotal = util.money(util.sum(byCustomer[c.id] || [], 'amount'));
            if (c.creditLimit && overdueTotal > c.creditLimit) {
                freezeKeys['customer:credit:' + c.id] = 1;
                if (c.status !== 'suspended') {
                    db.update('customers', c.id, { status: 'suspended', suspendReason: '逾期 ' + util.money(overdueTotal) + ' 超信用额度 ' + c.creditLimit });
                    addAlert({ key: 'customer:credit:' + c.id, level: 'danger', title: '客户信用冻结', message: c.name + ' 逾期金额超信用额度，已暂停下单', category: 'finance', entity: 'customers', refId: c.id, owner: '财务部' });
                }
            } else if (c.status === 'suspended' && String(c.suspendReason || '').indexOf('逾期') === 0) {
                /* 回款后必须自动解冻：逾期都清了还挂着冻结，客户会在页面上永远下不了单 */
                db.update('customers', c.id, { status: 'active', suspendReason: '' });
                closeAlert('customer:credit:' + c.id, '逾期金额回落至信用额度内，自动恢复');
            }
        });
        return {
            overdue: rows.length, amount: util.money(util.sum(rows, 'amount')),
            resolved: resolveGone('ar:overdue:', keysOf(rows, 'ar:overdue:'), '应收已核销'),
            unfrozen: resolveGone('customer:credit:', freezeKeys, '信用已恢复')
        };
    }

    function vehicleMaintenance() {
        var due = db.col('vehicles').filter(function (v) { return v.nextCheckAt && util.toDate(v.nextCheckAt) <= util.addDays(util.now(), 7); });
        due.forEach(function (v) {
            addAlert({ key: 'vehicle:maintenance:' + v.id, level: 'warn', title: '车辆保养到期', message: v.plate + '（' + v.typeName + '）保养到期日 ' + v.nextCheckAt + '，里程 ' + v.odometer + ' km', category: 'asset', entity: 'vehicles', refId: v.id, owner: '车队长' });
        });
        return { due: due.length, resolved: resolveGone('vehicle:maintenance:', keysOf(due, 'vehicle:maintenance:'), '保养计划已顺延') };
    }

    /* 物料档案的 stock 是各仓存量加总的派生值，状态也从库存重新判定；
       回补到安全线以上的物料要顺手核销告警，否则「库存不足」会永远挂在台账上 */
    function materialStock() {
        var byMat = {};
        db.col('stocks').forEach(function (s) { byMat[s.materialId] = (byMat[s.materialId] || 0) + (Number(s.qty) || 0); });
        var low = [], recovered = [];
        db.col('materials').forEach(function (m) {
            /* 停用是人的决定，不是库存算出来的：巡检不许把 obsolete 改回 normal，
               否则物料页刚停用，一轮巡检就复活 */
            if (m.status === 'obsolete') return;
            var stock = byMat[m.id] != null ? byMat[m.id] : (Number(m.stock) || 0);
            if (stock !== m.stock) { m.stock = stock; db.touch('materials'); }
            var st = stock <= 0 ? 'out' : (stock < m.safeStock ? 'low' : 'normal');
            if (m.status !== st) { m.status = st; db.touch('materials'); }
            if (st === 'normal') recovered.push(m); else low.push(m);
        });
        low.forEach(function (m) {
            addAlert({ key: 'material:low:' + m.id, level: m.status === 'out' ? 'danger' : 'warn', title: '物料库存不足', message: m.name + ' 现存 ' + m.stock + m.unit + '，安全库存 ' + m.safeStock + m.unit, category: 'asset', entity: 'materials', refId: m.id, owner: '仓储部' });
        });
        return { low: low.length, resolved: resolveGone('material:low:', keysOf(low, 'material:low:'), recovered.length + ' 项库存已回补至安全线') };
    }

    /* 采购在途超期：下单挂账后约定天数没到货就报警，到货入库当场自动核销。
       只看未收齐的凭证——已到货的行早就进了库存，再报就是噪音 */
    function purchaseOverdue() {
        var late = [];
        db.col('stockMovements').forEach(function (m) {
            if (m.kind !== 'purchase') return;
            if (m.status && m.status !== 'pending' && m.status !== 'partial') return;
            if (util.hoursBetween(m.date || m.createdAt, util.now()) < 7 * 24) return;
            late.push(m);
        });
        late.forEach(function (m) {
            var mat = db.get('materials', m.materialId) || {};
            var wh = db.get('warehouses', m.warehouseId) || {};
            var days = Math.round(util.hoursBetween(m.date || m.createdAt, util.now()) / 24);
            var left = Math.max(0, (Number(m.qty) || 0) - (Number(m.receivedQty) || 0));
            addAlert({
                key: 'purchase:late:' + m.id, level: days > 14 ? 'danger' : 'warn', title: '采购到货超期',
                message: (mat.name || m.materialId) + ' 采购单 ' + m.id + ' 下单 ' + days + ' 天仍未到货，' +
                    '缺 ' + left + (mat.unit || '') + '，收货仓 ' + (wh.name || m.warehouseId) + '，应付已挂账',
                category: 'asset', entity: 'stockMovements', refId: m.id, owner: (wh.manager || '仓储部')
            });
        });
        return {
            late: late.length,
            resolved: resolveGone('purchase:late:', keysOf(late, 'purchase:late:'), '采购单已到货入库，在途冲平')
        };
    }

    function deviceHealth() {
        var bad = db.col('devices').filter(function (d) { return d.status === 'fault' || (d.status === 'offline' && util.hoursBetween(d.lastSyncAt, util.now()) > 12); });
        bad.forEach(function (d) {
            addAlert({ key: 'device:' + d.id, level: d.status === 'fault' ? 'danger' : 'warn', title: '扫描设备异常', message: d.name + '（' + d.model + '）' + (d.status === 'fault' ? '上报故障' : '离线超 12 小时') + '，归属 ' + d.ownerName, category: 'system', entity: 'devices', refId: d.id, owner: '信息技术部' });
        });
        return { faulty: bad.length, resolved: resolveGone('device:', keysOf(bad, 'device:'), '设备已恢复上报') };
    }

    /* 围栏覆盖缺口：作业城市的扫描地点落在任何在用围栏之外就报警，补一张同城围栏即自动核销。
       围栏不是画图好看——它管的是「这个城市的作业地点有没有被系统认定过」，
       所以判据取城市粒度：半径只有 1~3 km，而网点坐标本身就是城市中心，逐点算必然全是越界 */
    function fenceCoverage(days) {
        var audit = TMS.network.fenceAudit(days || 30);
        var active = {};
        audit.breaches.forEach(function (b) {
            active['fence:gap:' + b.city] = 1;
            addAlert({
                key: 'fence:gap:' + b.city, level: b.count > 40 ? 'danger' : 'warn',
                title: '作业城市无电子围栏',
                message: b.city + ' 近 ' + audit.days + ' 天有 ' + b.count + ' 次扫描写在围栏外，' +
                    '该市 ' + b.branches + ' 个网点归属 ' + (b.hub || '未指派分拨') +
                    '，建议补一张半径 ' + Math.round(b.radiusM / 1000) + ' km 的城市围栏（最近在用围栏 ' +
                    (b.nearestName || '无') + '，相距 ' + (b.nearestKm || '—') + ' km）',
                category: 'system', entity: 'geofences', refId: '', owner: '信息技术部'
            });
        });
        return {
            gap: audit.breaches.length,
            resolved: resolveGone('fence:gap:', active, '该作业城市已建立在用围栏，越界告警自动核销')
        };
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
        return { late: late.length, resolved: resolveGone('trip:late:', keysOf(late, 'trip:late:'), '班次已发车或已取消') };
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

    /* 11. 绩效改进计划：考核定 D 档的人挂一张改进计划，之后只看业绩不看口头承诺——
       最新一期绩效回到合格线（70 分，即 people.gradeOf 的 C 档下限）就把结论改写为「已达标解除」，
       告警同轮核销。不自动解除的话这个人会永远挂在未处理告警上，改进期也就成了摆设 */
    function perfGuard() {
        var latestEval = {}, latestPerf = {};
        db.col('evaluations').forEach(function (e) {
            var cur = latestEval[e.employeeId];
            if (!cur || String(cur.period) < String(e.period)) latestEval[e.employeeId] = e;
        });
        db.col('performances').forEach(function (p) {
            var cur = latestPerf[p.employeeId];
            if (!cur || String(cur.period) < String(p.period)) latestPerf[p.employeeId] = p;
        });
        var guarding = [], released = 0;
        Object.keys(latestEval).forEach(function (empId) {
            var e = latestEval[empId];
            if (e.promotion !== '绩效改进计划' || e.status !== 'done') return;
            var emp = db.get('employees', empId);
            if (!emp) return;
            var perf = latestPerf[empId];
            if (perf && Number(perf.score) >= 70) {
                db.update('evaluations', e.id, { promotion: '绩效改进计划（已达标解除）', releasedAt: util.iso(util.now()) });
                released++;
                return;
            }
            guarding.push({ e: e, emp: emp, perf: perf });
        });
        var active = {};
        guarding.forEach(function (g) {
            var key = 'perf:guard:' + g.e.employeeId;
            active[key] = 1;
            var score = g.perf ? Number(g.perf.score) : null;
            addAlert({
                key: key, level: score != null && score >= 60 ? 'warn' : 'danger',
                title: '绩效改进计划未达标',
                message: g.emp.name + '（' + TMS.people.roleName(g.emp.role) + '）' + g.e.period + ' 考核定 ' + g.e.grade +
                    ' 档列入改进计划，最新一期绩效 ' + (score == null ? '仍无核算结果' : score + ' 分（' + g.perf.period + '）') +
                    '，回到 70 分自动解除',
                category: 'operation', entity: 'evaluations', refId: g.e.id, owner: '人力资源部'
            });
        });
        return {
            guarding: guarding.length, released: released,
            resolved: resolveGone('perf:guard:', active, '改进期内最新绩效已回到合格线，考核结论与告警同步解除')
        };
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
