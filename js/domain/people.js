/* 人力领域：考勤打卡、排班、绩效核算、考核评级、客户积分 */
(function (global) {
    'use strict';

    var TMS = global.TMS = global.TMS || {};
    var util = TMS.util, db = TMS.db;

    var SHIFT_DEFS = [
        { code: 'EARLY', name: '早班', start: '06:00', end: '14:00', hours: 8 },
        { code: 'MID', name: '正常班', start: '09:00', end: '18:00', hours: 9 },
        { code: 'LATE', name: '晚班', start: '14:00', end: '22:00', hours: 8 },
        { code: 'NIGHT', name: '夜班', start: '22:00', end: '06:00', hours: 8 }
    ];

    /* ---------- 考勤 ---------- */

    function todayRecord(empId, date) {
        var day = util.dateKey(date || util.now());
        return db.findOne('clockRecords', function (c) { return c.employeeId === empId && c.date === day; });
    }

    /* 打卡只存"何时何地用什么打的卡"这一事实：
       姓名/归属走员工档案反查，工时/加班/迟到早退/出勤状态由 clockIn+clockOut 即时推算 */
    function clockView(c) {
        if (!c) return null;
        var emp = db.get('employees', c.employeeId) || {};
        var hours = c.clockIn && c.clockOut ? util.round(util.hoursBetween(c.clockIn, c.clockOut), 1) : 0;
        var code = c.shiftCode || guessShift(emp.role);
        var late = !!c.clockIn && isLate(c.clockIn, code);
        var early = !!c.clockOut && hours < 7;
        var overtime = util.round(Math.max(0, hours - 8), 1);
        var out = {
            employee: emp.name || '', role: emp.role || '', orgId: emp.orgId || '', orgName: emp.orgName || '',
            shiftCode: code, location: c.location || emp.orgName || emp.city || '—',
            device: c.device || '手机 APP', workHours: hours, overtimeHours: overtime,
            late: late, earlyLeave: early,
            attendance: late ? (early ? '迟到/早退' : '迟到')
                : (early ? '早退' : (overtime > 0 ? '加班' : '正常'))
        };
        Object.keys(c).forEach(function (k) { if (c[k] !== '' && c[k] != null) out[k] = c[k]; });
        return out;
    }

    function clockIn(data) {
        var d = data || {};
        var emp = db.get('employees', d.employeeId);
        if (!emp) return { ok: false, message: '员工不存在' };
        var day = util.dateKey(d.at || util.now());
        var shift = d.shiftId ? db.get('shifts', d.shiftId) : null;
        var rec = todayRecord(emp.id, day);
        var at = util.iso(d.at || util.now());
        var defaultLocation = emp.orgName || emp.city;
        if (rec && rec.clockIn) return { ok: false, message: '今日已打卡（' + util.fmt.time(rec.clockIn) + '）', record: clockView(rec) };
        if (!rec) {
            rec = db.create('clockRecords', {
                employeeId: emp.id, date: day, clockIn: at, clockOut: '',
                shiftCode: shift ? shift.shiftCode : guessShift(emp.role),
                // 与档案默认值相同的终端/位置不落库，读取时由 clockView 补回
                location: d.location && d.location !== defaultLocation ? d.location : '',
                device: d.device && d.device !== '手机 APP' ? d.device : ''
            }, { stamp: false });
        } else {
            rec.clockIn = at;
            db.commit('clockRecords', rec.id, 'clock:in');
        }
        return { ok: true, record: clockView(rec) };
    }

    function clockOut(data) {
        var d = data || {};
        var rec = todayRecord(d.employeeId, d.at);
        if (!rec) return { ok: false, message: '请先打上班卡' };
        if (rec.clockOut) return { ok: false, message: '今日已下班打卡', record: clockView(rec) };
        rec.clockOut = util.iso(d.at || util.now());
        db.commit('clockRecords', rec.id, 'clock:out');
        return { ok: true, record: clockView(rec) };
    }

    function guessShift(role) {
        if (role === 'sorter') return util.pick(['EARLY', 'LATE', 'NIGHT']);
        if (role === 'transporter') return 'NIGHT';
        return 'MID';
    }

    function isLate(at, shiftCode) {
        var s = SHIFT_DEFS.filter(function (x) { return x.code === shiftCode; })[0] || SHIFT_DEFS[1];
        var d = util.toDate(at);
        var start = s.start.split(':');
        var limit = new Date(d.getFullYear(), d.getMonth(), d.getDate(), +start[0], +start[1]);
        if (s.code === 'NIGHT' && d.getHours() < 6) return false;
        return d.getTime() > limit.getTime() + 600000;
    }

    /* 排班行只存 code，班次名称/起止时间/工时统一从 SHIFT_DEFS 反查（shiftView） */
    function shiftDef(code) {
        return SHIFT_DEFS.filter(function (x) { return x.code === code; })[0] || SHIFT_DEFS[1];
    }

    function shiftView(s) {
        if (!s) return null;
        var def = shiftDef(s.shiftCode);
        var out = {};
        Object.keys(s).forEach(function (k) { out[k] = s[k]; });
        out.shiftName = def.name; out.startAt = def.start; out.endAt = def.end; out.hours = def.hours || 8;
        return out;
    }

    /* ---------- 排班 ---------- */

    function assignShift(data) {
        var d = data || {};
        var def = SHIFT_DEFS.filter(function (s) { return s.code === (d.shiftCode || 'MID'); })[0] || SHIFT_DEFS[1];
        var day = util.dateKey(d.date || util.now());
        var exists = db.findOne('shifts', function (s) { return s.employeeId === d.employeeId && s.date === day; });
        if (exists && !d.force) return { ok: false, message: '该员工 ' + day + ' 已排班（' + def.name + '）', shift: exists };
        if (exists) {
            return db.update('shifts', exists.id, {
                shiftCode: def.code, orgId: d.orgId || exists.orgId,
                hubId: d.hubId || exists.hubId, remark: d.remark || ''
            });
        }
        var emp = db.get('employees', d.employeeId) || {};
        return db.create('shifts', {
            employeeId: emp.id, employee: emp.name, role: emp.role,
            date: day, shiftCode: def.code,
            orgId: d.orgId || emp.orgId, hubId: d.hubId || emp.hubId || '',
            attendance: '待打卡', remark: d.remark || ''
        });
    }

    function roster(date, hubId) {
        var day = util.dateKey(date || util.now());
        var rows = db.col('shifts').filter(function (s) { return s.date === day && (!hubId || s.hubId === hubId); });
        var byCode = util.groupBy(rows, 'shiftCode');
        return SHIFT_DEFS.map(function (def) {
            var list = byCode[def.code] || [];
            return {
                code: def.code, name: def.name, startAt: def.start, endAt: def.end,
                count: list.length, sorters: list.filter(function (s) { return s.role === 'sorter'; }).length,
                drivers: list.filter(function (s) { return s.role === 'transporter'; }).length,
                couriers: list.filter(function (s) { return s.role === 'deliveryman'; }).length,
                employees: list.map(function (s) { return s.employee; })
            };
        });
    }

    /* ---------- 绩效 ---------- */

    function employeeScope(role, empId, period) {
        var from = period ? util.toDate(period + '-01') : util.addDays(util.now(), -30);
        var to = period ? util.addDays(util.toDate(period + '-01'), 31) : util.now();
        function inPeriod(t) {
            if (!t) return false;
            var d = util.toDate(t).getTime();
            return d >= util.toDate(from).getTime() && d < to.getTime();
        }
        return { from: from, to: to, inPeriod: inPeriod, empId: empId, role: role };
    }

    /* 绩效指标即时计算：指标全部可由订单/任务/车次反推，只有得分与等级落库，
       否则每人每期一段中文指标（~140 字符）会把库撑爆 */
    function computeMetrics(emp, period) {
        var scope = employeeScope(emp.role, emp.id, period);
        var sidx = TMS.order.scanIndex();      // 环节时间来自扫描流水，绩效核算按单预分组
        var metrics = {};
        if (emp.role === 'deliveryman') {
            var signed = db.col('orders').filter(function (o) { return o.courierId === emp.id && o.status === 'signed' && scope.inPeriod(o.signedAt); });
            var assigned = db.col('orders').filter(function (o) {
                return o.courierId === emp.id && scope.inPeriod(TMS.order.stageAt(o, 'delivering', sidx[o.id]) || o.createdAt);
            });
            var late = signed.filter(function (o) { return TMS.order.isSignedLate(o); });
            metrics = {
                signed: signed.length, assigned: assigned.length,
                pending: assigned.filter(function (o) { return ['arrived', 'delivering'].indexOf(o.status) > -1; }).length,
                onTimeRate: signed.length ? util.round((signed.length - late.length) / signed.length * 100, 1) : 100,
                podRate: signed.length ? util.round(signed.filter(function (o) { return o.pod && o.pod.podPhoto; }).length / signed.length * 100, 1) : 0,
                codCollected: util.money(util.sum(signed.filter(function (o) { return o.paymentMethod === '到付'; }), 'codAmount')),
                exceptions: db.col('exceptions').filter(function (e) { return e.responsible === emp.name && scope.inPeriod(e.reportedAt); }).length,
                revenue: util.money(util.sum(signed, 'freight')),
                firstAttempt: signed.length ? util.round(Math.max(0, 100 - late.length / signed.length * 100), 1) : 100
            };
        } else if (emp.role === 'sorter') {
            // 件重/标准工时/分拣结果由任务视图按订单重建，绩效口径与作业台保持一致
            var done = db.col('sortingTasks')
                .filter(function (t) { return t.operator === emp.name && t.status === 'done' && scope.inPeriod(t.finishedAt); })
                .map(TMS.operation.sortingTaskView);
            metrics = {
                tasks: done.length, pieces: util.sum(done, 'pieces'), weight: util.round(util.sum(done, 'weight'), 1),
                stdMinutes: util.sum(done, 'stdMinutes'), actualMinutes: util.sum(done, 'actualMinutes'),
                efficiency: done.length ? util.round(util.sum(done, 'pieces') / Math.max(1, util.sum(done, 'actualMinutes') / 60), 1) : 0,
                accuracy: done.length ? util.round(done.filter(function (t) { return !t.result || t.result.indexOf('错分') < 0; }).length / done.length * 100, 2) : 100,
                exceptions: db.col('exceptions').filter(function (e) { return e.responsible === emp.name && scope.inPeriod(e.reportedAt); }).length
            };
        } else if (emp.role === 'transporter') {
            var trips = db.col('transports').filter(function (t) { return t.driverId === emp.id && scope.inPeriod(t.date || t.createdAt); });
            metrics = {
                trips: trips.length, km: util.sum(trips, TMS.operation.distanceOf),
                orders: util.sum(trips, 'orders'), weight: util.round(util.sum(trips, 'weight'), 1),
                loadRate: trips.length ? util.round(util.sum(trips, 'loadRate') / trips.length, 1) : 0,
                onTimeRate: trips.length ? util.round(trips.filter(TMS.operation.isOnTime).length / trips.length * 100, 1) : 100,
                fuelCost: util.money(util.sum(trips, function (t) { return TMS.operation.costView(t).fuel; })),
                accidents: db.col('exceptions').filter(function (e) { return e.responsible === emp.name && scope.inPeriod(e.reportedAt); }).length,
                overtime: util.round(util.sum(trips, function (t) { return TMS.operation.costView(t).days || 1; }) * 0.5, 1)
            };
        } else if (emp.role === 'branch') {
            var branch = db.get('branches', emp.orgId) || {};
            var orders = db.col('orders').filter(function (o) { return (o.originBranchId === emp.orgId || o.destBranchId === emp.orgId) && scope.inPeriod(o.createdAt); });
            var signed = orders.filter(function (o) { return o.status === 'signed'; });
            metrics = {
                branch: branch.name || emp.orgName || '', orders: orders.length,
                collected: orders.filter(function (o) {
                    var at = TMS.order.stageAt(o, 'collected', sidx[o.id]);
                    return at && scope.inPeriod(at);
                }).length,
                revenue: util.money(util.sum(signed, 'freight')),
                cost: util.money(util.sum(signed, function (o) { return o.cost ? o.cost.tot : 0; })),
                onTimeRate: signed.length ? util.round(signed.filter(function (o) { return !TMS.order.isSignedLate(o); }).length / signed.length * 100, 1) : 100,
                exceptions: db.col('exceptions').filter(function (e) { return (e.responsibleParty === '网点') && scope.inPeriod(e.reportedAt); }).length,
                deduction: util.money(util.sum(db.col('payables').filter(function (p) { return p.target === (branch.name || emp.orgName); }), 'amount'))
            };
            metrics.margin = metrics.revenue ? util.round((metrics.revenue - metrics.cost) / metrics.revenue * 100, 1) : 0;
        } else {
            var clock = db.col('clockRecords').filter(function (c) { return c.employeeId === emp.id && scope.inPeriod(c.clockIn); })
                .map(clockView);
            metrics = {
                attendanceDays: clock.length, overtimeHours: util.round(util.sum(clock, 'overtimeHours'), 1),
                lateTimes: clock.filter(function (c) { return c.late; }).length,
                tasks: db.col('auditLogs').filter(function (l) { return l.actor === emp.name && scope.inPeriod(l.at); }).length
            };
        }
        return metrics;
    }

    /* 绩效行只存结论（得分/等级），指标与归属读取时反推——每人每期一段快照，
       在 300 人的网络里就是几十 KB 的死数据，而容量是唯一稀缺资源 */
    function computePerformance(empId, period) {
        var emp = db.get('employees', empId);
        if (!emp) return null;
        var metrics = computeMetrics(emp, period);
        var score = scoreOf(emp.role, metrics);
        var perf = {
            employeeId: emp.id,
            period: period || util.monthKey(util.addDays(util.now(), -30)),
            score: score, grade: gradeOf(score)
        };
        var existed = db.findOne('performances', function (p) { return p.employeeId === emp.id && p.period === perf.period; });
        if (existed) return db.update('performances', existed.id, perf);
        return db.create('performances', perf, { stamp: false });
    }

    /* 指标即时展开：绩效详情/看板读取时按已存的 score 行补齐当期指标与人员归属 */
    function withMetrics(p) {
        if (!p) return null;
        var out = {};
        var emp = db.get('employees', p.employeeId) || {};
        out.employee = emp.name || '';
        out.role = emp.role || '';
        out.orgId = emp.orgId || '';
        out.orgName = emp.orgName || '';
        Object.keys(p).forEach(function (k) { out[k] = p[k]; });
        out.metrics = emp.id ? computeMetrics(emp, p.period) : {};
        return out;
    }

    function scoreOf(role, m) {
        var s = 70;
        if (role === 'deliveryman') {
            s = m.signed * 1.6 + m.onTimeRate * 0.35 + m.podRate * 0.1 + m.firstAttempt * 0.15 - m.exceptions * 4;
        } else if (role === 'sorter') {
            s = m.tasks * 1.4 + m.accuracy * 0.4 + Math.min(30, m.efficiency / 4) - m.exceptions * 5;
        } else if (role === 'transporter') {
            s = m.trips * 3 + m.onTimeRate * 0.4 + Math.min(15, m.loadRate / 8) - m.accidents * 6;
        } else if (role === 'branch') {
            s = Math.min(45, m.revenue / 4000) + m.onTimeRate * 0.35 + Math.min(15, (m.margin || 0) / 2) - Math.min(20, m.exceptions * 2);
        } else {
            s = 72 + m.attendanceDays * 0.8 + Math.min(10, m.overtimeHours) - m.lateTimes * 2;
        }
        return util.round(Math.max(35, Math.min(100, s)), 1);
    }

    function gradeOf(score) {
        return score >= 92 ? 'A+' : (score >= 85 ? 'A' : (score >= 78 ? 'B' : (score >= 70 ? 'C' : 'D')));
    }

    function generatePerformances(period, roles) {
        var list = db.col('employees').filter(function (e) {
            return e.status === 'active' && (!roles || roles.length === 0 || roles.indexOf(e.role) > -1);
        });
        var out = [];
        list.forEach(function (e) {
            if (['sorter', 'transporter', 'deliveryman'].indexOf(e.role) < 0 && e.role !== 'branch') return;
            var p = computePerformance(e.id, period);
            if (p) out.push(p);
        });
        db.commit('performances', '', 'perf:generate');
        return out;
    }

    function performanceSummary(period) {
        var rows = db.col('performances').filter(function (p) { return !period || p.period === period; });
        var byRole = {};
        rows.forEach(function (p) {
            var role = (db.get('employees', p.employeeId) || {}).role || 'other';
            (byRole[role] = byRole[role] || []).push(p);
        });
        return {
            count: rows.length,
            avgScore: rows.length ? util.round(util.sum(rows, 'score') / rows.length, 1) : 0,
            byGrade: ['A+', 'A', 'B', 'C', 'D'].map(function (g) { return { label: g, value: rows.filter(function (p) { return p.grade === g; }).length }; }),
            byRole: Object.keys(byRole).map(function (k) {
                var g = byRole[k];
                return { label: roleName(k), value: g.length, avgScore: util.round(util.sum(g, 'score') / g.length, 1), bottom: withMetrics(util.sortBy(g, 'score', 'asc')[0]) };
            }).sort(function (a, b) { return b.avgScore - a.avgScore; }),
            top: util.sortBy(rows, 'score', 'desc').slice(0, 8).map(withMetrics),
            bottom: util.sortBy(rows, 'score', 'asc').slice(0, 8).map(withMetrics)
        };
    }

    function roleName(r) {
        return ({ admin: '职能管理', branch: '网点/分拨', sorter: '分拣员', transporter: '司机', deliveryman: '派送员', client: '客户' })[r] || r;
    }

    /* ---------- 考核 ---------- */

    function evaluate(data) {
        var d = data || {};
        var emp = db.get('employees', d.employeeId) || {};
        var at = util.iso(util.now());
        var rec = db.create('evaluations', {
            employeeId: emp.id, employee: emp.name, role: emp.role, deptId: emp.deptId, deptName: emp.deptName,
            period: d.period || util.monthKey(util.now()),
            kpiScore: Number(d.kpiScore) || 0, abilityScore: Number(d.abilityScore) || 0, attitudeScore: Number(d.attitudeScore) || 0,
            totalScore: Number(d.totalScore) || 0,
            grade: d.grade || '', evaluator: d.evaluator || 'HR', comment: d.comment || '',
            promotion: d.promotion || '', status: d.status || 'pending', createdAt: at, evaluatedAt: ''
        });
        return rec;
    }

    function finalizeEvaluation(id, data) {
        var e = db.get('evaluations', id);
        if (!e) return null;
        var d = data || {};
        var k = Number(d.kpiScore || e.kpiScore) || 0;
        var a = Number(d.abilityScore || e.abilityScore) || 0;
        var t = Number(d.attitudeScore || e.attitudeScore) || 0;
        var total = util.round(k * 0.6 + a * 0.25 + t * 0.15, 1);
        return db.update('evaluations', id, {
            kpiScore: k, abilityScore: a, attitudeScore: t, totalScore: total,
            grade: gradeOf(total), comment: d.comment || e.comment, promotion: d.promotion || e.promotion,
            evaluator: d.evaluator || e.evaluator, status: 'done', evaluatedAt: util.iso(util.now())
        });
    }

    /* ---------- 客户积分 ---------- */

    /* 积分流水只记「变动」本身：正数为返积分、负数为兑换，余额始终落在 customer.points。
       逐票一行会让会员台账变成全库最重的流水之一，而历史余额可以从票号反查，不必每行冗余存一份 */
    function awardPoints(order, reason) {
        var customer = order.customerId ? db.get('customers', order.customerId) : null;
        if (!customer || customer.level === 'C') return null;
        var base = Math.floor((Number(order.freight) || 0) / 10);
        var bonus = order.service === '加急' ? 2 : (order.service === '冷链' ? 3 : 1);
        var points = Math.max(1, base * bonus);
        var rec = db.create('points', {
            id: TMS.ids.nextFlat('points'),
            customerId: customer.id, orderId: order.id, points: points,
            reason: reason && reason !== '消费返积分' ? reason : ''
        });
        customer.points = (Number(customer.points) || 0) + points;
        db.touch('customers');
        db.commit('points', rec.id, 'points:earn');
        return rec;
    }

    function redeemPoints(customerId, points, item) {
        var c = db.get('customers', customerId);
        if (!c) return { ok: false, message: '客户不存在' };
        if ((Number(c.points) || 0) < points) return { ok: false, message: '积分不足，当前 ' + (c.points || 0) + ' 分' };
        c.points = util.round(c.points - points, 0);
        var rec = db.create('points', {
            id: TMS.ids.nextFlat('points'),
            customerId: c.id, points: -points, reason: '兑换：' + (item || '礼品')
        });
        db.touch('customers');
        db.commit('points', rec.id, 'points:redeem');
        return { ok: true, record: rec, balance: c.points };
    }

    function pointsOf(customerId) {
        var c = db.get('customers', customerId);
        return { balance: c ? (Number(c.points) || 0) : 0, rows: db.col('points').filter(function (p) { return p.customerId === customerId; }) };
    }

    TMS.people = {
        SHIFT_DEFS: SHIFT_DEFS,
        clockIn: clockIn, clockOut: clockOut, todayRecord: todayRecord, clockView: clockView,
        assignShift: assignShift, roster: roster, shiftView: shiftView, shiftDef: shiftDef,
        computePerformance: computePerformance, computeMetrics: computeMetrics, withMetrics: withMetrics,
        generatePerformances: generatePerformances,
        performanceSummary: performanceSummary, roleName: roleName, gradeOf: gradeOf,
        evaluate: evaluate, finalizeEvaluation: finalizeEvaluation,
        awardPoints: awardPoints, redeemPoints: redeemPoints, pointsOf: pointsOf
    };
})(window);
