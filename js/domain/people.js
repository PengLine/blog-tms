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

    /* 库里的历史只有回放的那十几天，账期的自然天数和数据覆盖天数不是一回事。
       指标按账期算、得分按覆盖天数折算成月度当量，否则「历史短」会被读成「全员只干了半月活」 */
    var dataCache = { rev: -1, from: 0 };

    function dataStartMs() {
        var rev = db.rev('orders');
        if (dataCache.rev === rev && dataCache.from) return dataCache.from;
        var min = 0;
        db.col('orders').forEach(function (o) {
            var t = util.toDate(o.createdAt).getTime();
            if (t && (!min || t < min)) min = t;
        });
        dataCache = { rev: rev, from: min };
        return min;
    }

    function coveredDays(from, to) {
        var start = Math.max(util.toDate(from).getTime(), dataStartMs());
        var end = Math.min(util.toDate(to).getTime(), util.now().getTime() + 1);
        if (!start || end <= start) return 1;
        return Math.max(1, Math.min(31, Math.round((end - start) / 86400000)));
    }

    function employeeScope(role, empId, period) {
        var from = period ? util.toDate(period + '-01') : util.addDays(util.now(), -30);
        var to = period ? util.addDays(util.toDate(period + '-01'), 31) : util.now();
        function inPeriod(t) {
            if (!t) return false;
            var d = util.toDate(t).getTime();
            return d >= util.toDate(from).getTime() && d < to.getTime();
        }
        return { from: from, to: to, inPeriod: inPeriod, empId: empId, role: role, days: coveredDays(from, to) };
    }

    /* 网点/分拨主管的作业量归属：本机构作为始发或目的端经手的单。
       分拨主管的 orgId 是枢纽号（HB0001），网点主管是网点号，所以两套字段都要看 */
    function touchesOrg(o, emp) {
        return o.originBranchId === emp.orgId || o.destBranchId === emp.orgId ||
            o.hubFrom === emp.orgId || o.hubTo === emp.orgId;
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
            var orders = db.col('orders').filter(function (o) { return touchesOrg(o, emp) && scope.inPeriod(o.createdAt); });
            var mine = {};
            orders.forEach(function (o) { mine[o.id] = 1; });
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
                // 异常按「本机构经手的单」归口，不是全网网点责任一锅端：否则每个主管都背着别人的扣分
                exceptions: db.col('exceptions').filter(function (e) { return e.responsibleParty === '网点' && mine[e.orderId] && scope.inPeriod(e.reportedAt); }).length,
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
        metrics.windowDays = scope.days;
        return metrics;
    }

    /* 默认账期取最近一个「已关账且有单量」的自然月。月初就按当月核算月度绩效，
       账期里只有一两天的单量，档位会整体塌到 D，改进计划发给谁都不对 */
    function defaultPeriod() {
        var thisMonth = util.monthKey(util.now());
        var months = util.unique(db.col('orders').map(function (o) { return util.monthKey(o.createdAt); })).sort();
        var closed = months.filter(function (m) { return m < thisMonth; });
        return (closed.length ? closed : months).slice(-1)[0] || thisMonth;
    }

    /* 绩效行只存结论（得分/等级），指标与归属读取时反推——每人每期一段快照，
       在 300 人的网络里就是几十 KB 的死数据，而容量是唯一稀缺资源 */
    function computePerformance(empId, period) {
        var emp = db.get('employees', empId);
        if (!emp) return null;
        period = period || defaultPeriod();
        var metrics = computeMetrics(emp, period);
        var score = scoreOf(emp.role, metrics, period);
        var perf = {
            employeeId: emp.id,
            period: period,
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

    /* 单量项按「对标本岗位人均产能」计分：本网络编制比单量大（派送员人均十几票），
       拿绝对票数定档会把整岗打成 D，那是编制问题不是个人问题。
       质量项（及时率、准确率、装载率）仍按行业绝对线，不因单少而放宽 */
    var pcCache = {};

    function countVolume(emp, scope, sidx) {
        if (emp.role === 'deliveryman') {
            return db.col('orders').filter(function (o) { return o.courierId === emp.id && o.status === 'signed' && scope.inPeriod(o.signedAt); }).length;
        }
        if (emp.role === 'sorter') {
            return db.col('sortingTasks').filter(function (t) { return t.operator === emp.name && t.status === 'done' && scope.inPeriod(t.finishedAt); }).length;
        }
        if (emp.role === 'transporter') {
            return db.col('transports').filter(function (t) { return t.driverId === emp.id && scope.inPeriod(t.date || t.createdAt); }).length;
        }
        if (emp.role === 'branch') {
            return db.col('orders').filter(function (o) {
                return touchesOrg(o, emp) &&
                    scope.inPeriod(TMS.order.stageAt(o, 'collected', sidx[o.id]) || o.createdAt);
            }).length;
        }
        return db.col('clockRecords').filter(function (c) { return c.employeeId === emp.id && scope.inPeriod(c.clockIn); }).length;
    }

    /* 人均产能与账期同版本缓存：批量核算 300 人只扫一遍表，不逐人重算同事的均值 */
    function perCapita(role, period) {
        var key = role + '|' + (period || 'roll') + '|' +
            [db.rev('orders'), db.rev('transports'), db.rev('sortingTasks'), db.rev('employees'), db.rev('clockRecords')].join('.');
        if (pcCache[key] !== undefined) return pcCache[key];
        var scope = employeeScope(role, '', period);
        var sidx = TMS.order.scanIndex();
        var list = db.col('employees').filter(function (e) { return e.role === role && e.status === 'active'; });
        var total = 0;
        list.forEach(function (e) { total += countVolume(e, scope, sidx); });
        var out = list.length ? total / list.length : 0;
        if (Object.keys(pcCache).length > 40) pcCache = {};
        pcCache[key] = out;
        return out;
    }

    /* 单量目标取「本岗位人均产能」与「保底工作量」的较高者：
       人均产能回答比同行差多少，保底线回答有没有干活——司机人均 0.5 趟时只看人均，
       跑 1 趟的人就会拿满分，那不叫绩效 */
    var VOL_FLOOR = { deliveryman: 8, sorter: 25, transporter: 3, branch: 15 };

    /* 达成率加权计分：基础分 35（在岗与协作），单量 25，两道质量线各 20/12，封顶 120%。
       扣罚项（异常、事故、迟到）按覆盖天数折算成月当量，与整月口径可比 */
    function scoreOf(role, m, period) {
        var days = Math.max(1, Number(m.windowDays) || 30);
        var f = Math.max(1, Math.min(3, 30 / days));
        var target = Math.max(perCapita(role, period), (VOL_FLOOR[role] || 0) * days / 30) || 1;
        function ach(v, line, w) { return Math.min(1.2, (Number(v) || 0) / line) * w; }
        var s;
        if (role === 'deliveryman') {
            s = 35 + ach(m.signed, target, 25) + (m.signed ? ach(m.onTimeRate, 92, 20) + ach(m.podRate, 85, 12) : 0) - m.exceptions * f * 4;
        } else if (role === 'sorter') {
            s = 35 + ach(m.tasks, target, 25) + (m.tasks ? ach(m.accuracy, 99, 20) + ach(m.efficiency, 25, 12) : 0) - m.exceptions * f * 5;
        } else if (role === 'transporter') {
            s = 35 + ach(m.trips, target, 25) + (m.trips ? ach(m.onTimeRate, 92, 20) + ach(m.loadRate, 70, 12) : 0) - m.accidents * f * 6;
        } else if (role === 'branch') {
            s = 35 + ach(m.collected, target, 25) + (m.collected ? ach(m.onTimeRate, 92, 20) : 0) + ach(m.margin, 25, 12) - Math.min(20, m.exceptions * f * 2);
        } else {
            s = 72 + ach(m.attendanceDays, Math.max(1, days * 0.7), 20) + Math.min(10, m.overtimeHours * f) - m.lateTimes * f * 2;
        }
        return util.round(Math.max(35, Math.min(100, s)), 1);
    }

    function gradeOf(score) {
        return score >= 92 ? 'A+' : (score >= 85 ? 'A' : (score >= 78 ? 'B' : (score >= 70 ? 'C' : 'D')));
    }

    function generatePerformances(period, roles) {
        var month = period || defaultPeriod();      // 账期只解析一次，批量核算不能每人重扫一遍订单
        var list = db.col('employees').filter(function (e) {
            return e.status === 'active' && (!roles || roles.length === 0 || roles.indexOf(e.role) > -1);
        });
        var out = [];
        list.forEach(function (e) {
            if (['sorter', 'transporter', 'deliveryman'].indexOf(e.role) < 0 && e.role !== 'branch') return;
            var p = computePerformance(e.id, month);
            if (p) out.push(p);
        });
        db.commit('performances', '', 'perf:generate');
        return out;
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
        defaultPeriod: defaultPeriod,
        generatePerformances: generatePerformances,
        roleName: roleName, gradeOf: gradeOf,
        evaluate: evaluate, finalizeEvaluation: finalizeEvaluation,
        awardPoints: awardPoints, redeemPoints: redeemPoints, pointsOf: pointsOf
    };
})(window);
