/* 服务领域：异常工单闭环、客服工单、理赔 */
(function (global) {
    'use strict';

    var TMS = global.TMS = global.TMS || {};
    var util = TMS.util, db = TMS.db, cfg = TMS.cfg;

    var EXCEPTION_TYPES = ['货物破损', '货物遗失', '延迟送达', '错分错发', '客户拒收', '包装不当', '地址不清', '车辆故障', '温控异常', '违禁品', '其他异常'];
    var LEVELS = ['一级', '二级', '三级'];
    var PARTIES = ['网点', '分拨中心', '司机', '承运商', '派送员', '客户', '系统'];
    var SOLUTIONS = ['补发', '改派', '退款', '折让', '理赔', '追责扣款', '客户自行承担'];
    var TICKET_TYPES = ['物流查询', '催件', '改址', '拒收退货', '发票问题', '投诉服务', '理赔咨询', '其他'];

    /* ---------- 异常工单 ---------- */

    function createException(data) {
        var d = data || {};
        var order = d.orderId ? db.get('orders', d.orderId) : null;
        var level = LEVELS.indexOf(d.level) > -1 ? d.level : '三级';
        var slaHours = level === '一级' ? 2 : (level === '二级' ? 6 : cfg.sla.exceptionHours);
        var at = d.at ? util.toDate(d.at) : util.now();
        var rec = db.create('exceptions', {
            orderId: order ? order.id : (d.orderId || ''),
            waybillNo: order ? order.waybillNo : (d.waybillNo || ''),
            customer: TMS.order.customerName(order) || d.customer || '',
            type: EXCEPTION_TYPES.indexOf(d.type) > -1 ? d.type : '其他异常',
            description: d.description || '',
            occurredAt: util.iso(at), reportedAt: util.iso(at),
            source: d.source || (d.actor ? '人工上报' : '系统预警'),
            reporter: d.actor || '作业员',
            status: 'pending', handler: '', level: level,
            slaDeadline: util.iso(util.addHours(at, slaHours)), slaHours: slaHours,
            escalated: false, escalateAt: '',
            responsibleParty: '', responsible: '', deductionAmount: 0,
            solution: '', rootCause: '', resolution: '', resolvedAt: '',
            linkedClaimId: '', linkedTicketId: '', relatedOrder: order ? order.destination : '',
            flow: [{ time: util.iso(at), actor: d.actor || '系统', action: '异常上报' }]
        });
        if (order) {
            order.exceptionCount = (order.exceptionCount || 0) + 1;
            order.remark = (order.remark ? order.remark + '；' : '') + '异常：' + rec.type;
            db.touch('orders');
            db.commit('orders', order.id, 'exception:link');
        }
        TMS.audit.log('exception.create', 'exceptions', rec.id, rec.type + '（' + rec.level + '）关联 ' + (rec.orderId || '无'), rec.reporter);
        db.commit('exceptions', rec.id, 'exception:create');
        TMS.bus.emit('exception:created', { exception: rec });
        return rec;
    }

    function processException(id, handler, data) {
        var row = db.get('exceptions', id);
        if (!row) return null;
        if (row.status !== 'pending') return { ok: false, message: '工单已受理，当前状态：' + row.status };
        pushFlow(row, (handler || '运营管理员'), '受理工单');
        row.status = 'processing';
        row.handler = handler || '运营管理员';
        row.acceptedAt = util.iso(util.now());
        if (data && data.level && LEVELS.indexOf(data.level) > -1) row.level = data.level;
        db.commit('exceptions', id, 'exception:accept');
        return db.get('exceptions', id);
    }

    /* 定责：责任方 + 扣款金额 → 同步生成成本应付 */
    function assignResponsibility(id, data) {
        var row = db.get('exceptions', id);
        if (!row) return null;
        var d = data || {};
        var party = PARTIES.indexOf(d.party) > -1 ? d.party : (d.party || '承运商');
        var deduction = util.money(Number(d.deduction) || 0);
        pushFlow(row, d.actor || '运营管理员', '定责：' + party + (deduction ? '（扣款 ' + deduction + ' 元）' : ''));
        row.responsibleParty = party;
        row.responsible = d.responsible || row.responsible || '待指派';
        row.deductionAmount = deduction;
        row.responsibilityAt = util.iso(util.now());
        if (deduction > 0 && party !== '客户') {
            var existed = db.findOne('payables', function (p) { return p.refId === row.id && p.category === '异常扣款'; });
            if (!existed) {
                TMS.finance.createPayable({
                    target: row.responsible || party, targetType: partyType(party),
                    category: '异常扣款', refId: row.id, refNo: row.id,
                    amount: deduction, period: util.monthKey(util.now()),
                    dueDate: util.dateKey(util.addDays(util.now(), 30)),
                    status: 'pending', settledAt: '', remark: row.type + ' 定责扣款'
                });
            }
        }
        if (row.orderId) {
            var o = db.get('orders', row.orderId);
            if (o) { o.exceptionDeduction = util.money((Number(o.exceptionDeduction) || 0) + deduction); db.touch('orders'); }
        }
        db.commit('exceptions', id, 'exception:responsibility');
        TMS.audit.log('exception.assign', 'exceptions', id, '定责 ' + party + ' 扣款 ' + deduction, d.actor || '运营管理员');
        return row;
    }

    function partyType(party) {
        return party === '司机' ? 'driver' : (party === '派送员' ? 'driver' : (party === '承运商' ? 'carrier' : 'branch'));
    }

    /* 闭环：根因 + 方案 + 可选联动理赔 */
    function closeException(id, data) {
        var row = db.get('exceptions', id);
        if (!row) return null;
        var d = data || {};
        if (row.status === 'resolved') return row;
        pushFlow(row, d.actor || '运营管理员', '闭环：' + (d.solution || '处理完成'));
        row.status = 'resolved';
        row.resolution = d.resolution || '已处理完成';
        row.solution = SOLUTIONS.indexOf(d.solution) > -1 ? d.solution : (d.solution || row.solution || '改派');
        row.rootCause = d.rootCause || row.rootCause || '作业疏漏';
        row.resolvedAt = util.iso(util.now());
        row.handler = row.handler || d.actor || '运营管理员';
        row.closeOperator = d.actor || '运营管理员';
        if (row.responsibleParty && row.responsibleParty !== '客户' && Number(row.deductionAmount) > 0) {
            var hasPay = db.findOne('payables', function (p) { return p.refId === row.id && p.category === '异常扣款'; });
            if (!hasPay) {
                TMS.finance.createPayable({
                    target: row.responsible || row.responsibleParty, targetType: partyType(row.responsibleParty),
                    category: '异常扣款', refId: row.id, refNo: row.id, amount: Number(row.deductionAmount),
                    period: util.monthKey(util.now()), dueDate: util.dateKey(util.addDays(util.now(), 30)),
                    status: 'pending', settledAt: '', remark: row.type + ' 闭环扣款'
                });
            }
        }
        if (d.createClaim) {
            var claim = createClaim({
                orderId: row.orderId, type: row.type, amount: d.claimAmount || 0,
                reason: d.resolution || row.description, applicant: d.actor || '运营管理员', exceptionId: row.id
            });
            row.linkedClaimId = claim ? claim.id : '';
        }
        // 放行被挂起的订单
        if (row.orderId) {
            var o = db.get('orders', row.orderId);
            if (o && o.status === 'problem' && !d.keepHold) TMS.order.releaseProblem(row.orderId, { operator: d.actor || '运营管理员', note: '异常闭环放行' });
        }
        db.commit('exceptions', id, 'exception:close');
        TMS.audit.log('exception.close', 'exceptions', id, row.resolution, d.actor || '运营管理员');
        return row;
    }

    function escalateException(id, reason) {
        var row = db.get('exceptions', id);
        if (!row || row.escalated || row.status === 'resolved') return row;
        pushFlow(row, '系统', reason || '超时升级至运营主管');
        row.escalated = true;
        row.level = '一级';
        row.escalateAt = util.iso(util.now());
        db.update('exceptions', id, row);
        db.commit('exceptions', id, 'exception:escalate');
        return row;
    }

    function pushFlow(row, actor, action) {
        if (!row.flow) row.flow = [];
        row.flow.push({ time: util.iso(util.now()), actor: actor || '系统', action: action });
    }

    function exceptionsOf(orderId) {
        return db.col('exceptions').filter(function (e) { return e.orderId === orderId; });
    }

    function isOverdue(e) {
        return e.status !== 'resolved' && e.slaDeadline && util.toDate(e.slaDeadline) < util.now();
    }

    function exceptionStats() {
        var rows = db.col('exceptions');
        var resolved = rows.filter(function (e) { return e.status === 'resolved'; });
        var onTime = resolved.filter(function (e) { return !e.slaDeadline || util.toDate(e.resolvedAt) <= util.toDate(e.slaDeadline); });
        return {
            total: rows.length,
            pending: rows.filter(function (e) { return e.status === 'pending'; }).length,
            processing: rows.filter(function (e) { return e.status === 'processing'; }).length,
            resolved: resolved.length,
            overdue: rows.filter(isOverdue).length,
            escalated: rows.filter(function (e) { return e.escalated && e.status !== 'resolved'; }).length,
            closeRate: rows.length ? util.round(resolved.length / rows.length * 100, 1) : 0,
            slaRate: resolved.length ? util.round(onTime.length / resolved.length * 100, 1) : 100,
            avgCloseHours: resolved.length ? util.round(util.sum(resolved, function (e) { return util.hoursBetween(e.reportedAt || e.occurredAt, e.resolvedAt); }) / resolved.length, 1) : 0,
            deduction: util.money(util.sum(rows, 'deductionAmount')),
            byType: Object.keys(util.groupBy(rows, 'type')).map(function (k) { return { label: k, value: util.groupBy(rows, 'type')[k].length }; }).sort(function (a, b) { return b.value - a.value; }),
            byParty: Object.keys(util.groupBy(rows.filter(function (r) { return r.responsibleParty; }), 'responsibleParty')).map(function (k) {
                var g = util.groupBy(rows.filter(function (r) { return r.responsibleParty; }), 'responsibleParty')[k];
                return { label: k, count: g.length, amount: util.money(util.sum(g, 'deductionAmount')) };
            }).sort(function (a, b) { return b.count - a.count; })
        };
    }

    /* ---------- 客服工单 ---------- */

    function createTicket(data) {
        var d = data || {};
        var order = d.orderId ? db.get('orders', d.orderId) : null;
        var rec = db.create('tickets', {
            orderId: order ? order.id : (d.orderId || ''),
            waybillNo: order ? order.waybillNo : '',
            customer: TMS.order.customerName(order) || d.customer || '',
            type: TICKET_TYPES.indexOf(d.type) > -1 ? d.type : '其他',
            priority: ['高', '中', '低'].indexOf(d.priority) > -1 ? d.priority : '中',
            content: d.content || '', channel: d.channel || '在线客服',
            status: 'pending', assignee: d.assignee || '',
            createdAt: util.iso(util.now()), deadline: util.iso(util.addHours(util.now(), cfg.sla.complaintHours)),
            resolvedAt: '', result: '', satisfaction: ''
        });
        if (d.linkException) {
            var ex = createException({ orderId: rec.orderId, type: '延迟送达', description: '客服工单转异常：' + rec.content, level: rec.priority === '高' ? '二级' : '三级', actor: rec.assignee || '客服专员' });
            rec.linkedExceptionId = ex.id;
            db.commit('tickets', rec.id, 'ticket:link');
        }
        db.commit('tickets', rec.id, 'ticket:create');
        return rec;
    }

    function processTicket(id, assignee) {
        var t = db.get('tickets', id);
        if (!t) return null;
        var row = db.update('tickets', id, { status: 'processing', assignee: assignee || '客服专员', acceptedAt: util.iso(util.now()) });
        db.commit('tickets', id, 'ticket:accept');
        return row;
    }

    function resolveTicket(id, result, data) {
        var t = db.get('tickets', id);
        if (!t) return null;
        var d = data || {};
        var at = util.iso(util.now());
        db.update('tickets', id, {
            status: 'resolved', resolvedAt: at, result: result || '已解决',
            satisfaction: d.satisfaction || '待回访', closeOperator: d.operator || '客服专员'
        });
        db.commit('tickets', id, 'ticket:resolve');
        return db.get('tickets', id);
    }

    function ticketStats() {
        var rows = db.col('tickets');
        var resolved = rows.filter(function (t) { return t.status === 'resolved'; });
        return {
            total: rows.length,
            pending: rows.filter(function (t) { return t.status === 'pending'; }).length,
            processing: rows.filter(function (t) { return t.status === 'processing'; }).length,
            resolved: resolved.length,
            overdue: rows.filter(function (t) { return t.status !== 'resolved' && util.toDate(t.deadline) < util.now(); }).length,
            resolveRate: rows.length ? util.round(resolved.length / rows.length * 100, 1) : 0,
            avgHours: resolved.length ? util.round(util.sum(resolved, function (t) { return util.hoursBetween(t.createdAt, t.resolvedAt); }) / resolved.length, 1) : 0,
            byType: Object.keys(util.groupBy(rows, 'type')).map(function (k) { return { label: k, value: util.groupBy(rows, 'type')[k].length }; }).sort(function (a, b) { return b.value - a.value; })
        };
    }

    /* ---------- 理赔 ---------- */

    function createClaim(data) {
        var d = data || {};
        var order = d.orderId ? db.get('orders', d.orderId) : null;
        var rec = db.create('claims', {
            orderId: order ? order.id : (d.orderId || ''),
            waybillNo: order ? order.waybillNo : '',
            customer: TMS.order.customerName(order) || d.customer || '',
            type: d.type || '货物破损',
            declaredValue: order ? order.declaredValue : 0,
            isInsured: order ? order.isInsured : false,
            amount: util.money(Number(d.amount) || 0),
            reason: d.reason || '', evidence: d.evidence || '',
            status: 'pending', applicant: d.applicant || '运营管理员',
            exceptionId: d.exceptionId || '',
            createdAt: util.iso(util.now()), deadline: util.dateKey(util.addDays(util.now(), cfg.sla.claimDays)),
            handledAt: '', handler: '', auditNote: ''
        });
        db.commit('claims', rec.id, 'claim:create');
        TMS.audit.log('claim.create', 'claims', rec.id,
            rec.type + ' 申报 ' + util.money(rec.amount) + ' 关联 ' + (rec.orderId || '无单'), rec.applicant);
        return rec;
    }

    /* 审批通过：生成赔付支出，未保价按运费 5 倍封顶（贴近行业条款） */
    function approveClaim(id, data) {
        var c = db.get('claims', id);
        if (!c) return null;
        if (c.status !== 'pending') return { ok: false, message: '理赔单已处理：' + c.status };
        var d = data || {};
        var order = c.orderId ? db.get('orders', c.orderId) : null;
        var payout = util.money(Number(d.amount) || c.amount || 0);
        if (!c.isInsured && order) {
            var cap = util.money(Math.min(payout, Math.max(order.freight * 5, 200)));
            payout = cap;
        }
        var at = util.iso(util.now());
        db.update('claims', id, { status: 'approved', amount: payout, handledAt: at, handler: d.handler || '理赔专员', auditNote: d.note || (c.isInsured ? '按保价金额赔付' : '未保价，按运费 5 倍封顶赔付') });
        TMS.finance.finRow('expense', '理赔支出', {
            orderId: c.orderId, refId: c.id, amount: payout, date: at,
            remark: c.type + ' 赔付 ' + util.fmt.money(payout)
        });
        if (order) order.claimAmount = util.money((Number(order.claimAmount) || 0) + payout);
        db.commit('claims', id, 'claim:approve');
        TMS.audit.log('claim.approve', 'claims', id, '赔付 ' + payout, d.handler || '理赔专员');
        return db.get('claims', id);
    }

    function rejectClaim(id, note, handler) {
        var c = db.get('claims', id);
        if (!c) return null;
        var row = db.update('claims', id, { status: 'rejected', handledAt: util.iso(util.now()), handler: handler || '理赔专员', auditNote: note || '证据不足，不予赔付' });
        db.commit('claims', id, 'claim:reject');
        TMS.audit.log('claim.reject', 'claims', id, row.auditNote, row.handler);
        return row;
    }

    function claimStats() {
        var rows = db.col('claims');
        var approved = rows.filter(function (c) { return c.status === 'approved'; });
        return {
            total: rows.length, pending: rows.filter(function (c) { return c.status === 'pending'; }).length,
            approved: approved.length, rejected: rows.filter(function (c) { return c.status === 'rejected'; }).length,
            amount: util.money(util.sum(approved, 'amount')),
            pendingAmount: util.money(util.sum(rows.filter(function (c) { return c.status === 'pending'; }), 'amount')),
            rate: rows.length ? util.round(approved.length / rows.length * 100, 1) : 0,
            damageRate: db.col('orders').length ? util.round(rows.filter(function (c) { return c.type === '货物破损'; }).length / db.col('orders').length * 100, 2) : 0,
            byType: Object.keys(util.groupBy(rows, 'type')).map(function (k) {
                var g = util.groupBy(rows, 'type')[k];
                return { label: k, count: g.length, amount: util.money(util.sum(g.filter(function (c) { return c.status === 'approved'; }), 'amount')) };
            }).sort(function (a, b) { return b.count - a.count; })
        };
    }

    TMS.service = {
        EXCEPTION_TYPES: EXCEPTION_TYPES, LEVELS: LEVELS, PARTIES: PARTIES, SOLUTIONS: SOLUTIONS, TICKET_TYPES: TICKET_TYPES,
        createException: createException, processException: processException, assignResponsibility: assignResponsibility,
        closeException: closeException, escalateException: escalateException, exceptionsOf: exceptionsOf,
        isOverdue: isOverdue, exceptionStats: exceptionStats,
        createTicket: createTicket, processTicket: processTicket, resolveTicket: resolveTicket, ticketStats: ticketStats,
        createClaim: createClaim, approveClaim: approveClaim, rejectClaim: rejectClaim, claimStats: claimStats
    };
})(window);
