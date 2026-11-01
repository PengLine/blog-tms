/* 财务领域：应收/应付、账单、结算、代收货款、成本归集与毛利 */
(function (global) {
    'use strict';

    var TMS = global.TMS = global.TMS || {};
    var util = TMS.util, db = TMS.db, cfg = TMS.cfg;

    /* ---------- 应收 ---------- */

    /* 账期（YYYY-MM）不落库：单据的发生日期即事实，月份读取时派生。
       三类台账（应收/应付/流水）每行省 17 字符，1400 行就是 24KB 容量 */
    function periodOf(row) {
        if (!row) return '';
        if (row.period) return row.period;
        return util.monthKey(row.date || row.createdAt || row.signedAt || util.now());
    }

    function ensureReceivable(order) {
        var exists = db.findOne('receivables', function (r) { return r.orderId === order.id && r.status !== 'void'; });
        if (exists) return exists;
        var customer = order.customerId ? db.get('customers', order.customerId) : null;
        var cycle = order.paymentMethod === '到付' ? '现付' : (customer ? customer.settleCycle : TMS.order.settleCycleOf(order));
        var due = util.dateKey(util.addDays(util.toDate(order.createdAt), cycle === '月结' ? 45 : (cycle === '半月结' ? 20 : 7)));
        // 运单号/客户名/等级/签收时间/结算周期由 orderId 反查订单与客户档案，应收行只留对账与账龄要素
        return db.create('receivables', {
            orderId: order.id,
            customerId: order.customerId,
            amount: order.freight, codAmount: order.codAmount || 0,
            dueDate: due, status: 'pending', paidAt: '', billId: '', invoiceNo: '',
            date: order.createdAt
        }, { stamp: false });
    }

    function receivableOf(orderId) {
        return db.col('receivables').filter(function (r) { return r.orderId === orderId && r.status !== 'void'; })[0] || null;
    }

    function voidReceivable(order, reason) {
        var r = receivableOf(order.id);
        if (!r) return null;
        db.update('receivables', r.id, { status: 'void', voidReason: reason || '订单取消', updatedAt: util.iso(util.now()) });
        order.receivableStatus = 'void';
        db.touch('orders');
        return r;
    }

    function adjustReceivable(order, delta, reason) {
        if (Math.abs(Number(delta) || 0) < 0.01) return null;
        var r = receivableOf(order.id);
        if (!r) { if (order.paymentMethod !== '现付') r = ensureReceivable(order); else return incomeRow(order, delta, reason || '改单'); }
        if (r) {
            r.amount = util.money(Number(r.amount) + Number(delta));
            r.adjustNote = (r.adjustNote ? r.adjustNote + '；' : '') + (reason || '调整') + ' ' + util.money(delta);
            db.commit('receivables', r.id, 'ar:adjust');
        }
        return r;
    }

    /* 财务流水统一入口：客户/运单号由 orderId 派生，行只留记账要素；
       date 即业务发生时间，不再重复写 createdAt（流水体量最大，字段越少可回放天数越长）
       nature='往来' 标记资金过账（代收款上划），不重复计入损益；
       红冲行 amount 取正数落库、由 signed 标记方向，汇总时按方向冲减 */
    function finRow(type, category, data) {
        var d = data || {};
        var at = d.date || util.iso(util.now());
        var value = Number(d.amount) || 0;
        var row = {
            type: type, category: category, amount: util.money(Math.abs(value)),
            status: d.status || 'settled', date: at,
            orderId: d.orderId || '', refId: d.refId || '', remark: d.remark || ''
        };
        if (value < 0) row.signed = '红冲';
        if (d.nature) row.nature = d.nature;
        if (d.customer && !d.orderId) row.customer = d.customer;
        return db.create('finances', row, { stamp: false });
    }

    /* 损益口径：红冲取负、往来流水剔除 */
    function isLedger(f) { return f.nature !== '往来'; }
    function ledgerValue(f) { return (f.signed ? -Number(f.amount) || 0 : Number(f.amount) || 0); }

    function incomeRow(order, amount, remark, status) {
        return finRow('income', '运费收入', {
            orderId: order.id, amount: amount, status: status,
            remark: remark + ' ' + util.fmt.money(Math.abs(amount))
        });
    }

    /* 签收结算：按付款方式落收入与应收状态。
       成本不进流水——每票两条同额支出会把账本撑爆且与应付重复；
       单票成本留在 order.cost 上做分摊口径毛利，账面费用按供应商结算入账（见 settlePayable / 期间费用计提） */
    function settleOrder(order) {
        var at = order.signedAt || util.iso(util.now());
        if (order.paymentMethod === '现付') {
            if (!db.findOne('finances', function (f) { return f.orderId === order.id && f.type === 'income'; })) {
                finRow('income', '运费收入', { orderId: order.id, amount: order.freight, date: at, remark: '现付件揽收即收款' });
            }
            order.receivableStatus = 'paid';
        } else if (order.paymentMethod === '到付') {
            finRow('income', '运费收入', { orderId: order.id, amount: order.freight, date: at, remark: '派送时向收件人收取运费' });
            var r = receivableOf(order);
            if (r) db.update('receivables', r.id, { status: 'paid', paidAt: at });
            order.receivableStatus = 'paid';
            if (Number(order.codAmount) > 0) createCODRecord(order, at);
        } else {
            var r2 = receivableOf(order);
            if (!r2) r2 = ensureReceivable(order);
            if (r2) db.update('receivables', r2.id, { amount: order.freight, status: 'pending', signedAt: at });
            finRow('income', '运费收入', {
                orderId: order.id, amount: order.freight, status: 'pending', date: at,
                remark: (order.paymentMethod || '月结') + '挂账，待账期回款核销'
            });
            order.receivableStatus = 'pending';
        }
        db.touch('orders');
        db.commit('orders', order.id, 'order:settle');
        return order;
    }

    function markReceivablePaid(id, data) {
        var r = db.get('receivables', id);
        if (!r) return null;
        var d = data || {};
        var at = util.iso(util.now());
        db.update('receivables', id, { status: 'paid', paidAt: at, invoiceNo: d.invoiceNo || r.invoiceNo || '' });
        var order = r.orderId ? db.get('orders', r.orderId) : null;
        if (order) { order.receivableStatus = 'paid'; db.touch('orders'); }
        // 核销挂账收入
        var inc = db.findOne('finances', function (f) { return f.orderId === r.orderId && f.type === 'income' && f.status === 'pending'; });
        if (inc) { inc.status = 'settled'; inc.remark = '账期回款核销'; db.touch('finances'); }
        else finRow('income', '运费收入', { orderId: r.orderId, amount: r.amount, date: at, remark: '账期回款' });
        db.commit('receivables', id, 'ar:paid');
        return db.get('receivables', id);
    }

    /* 账单：把某客户某账期未入账应收聚合为月度对账单 */
    function generateBills(period, customerId) {
        var rows = db.col('receivables').filter(function (r) {
            return r.status !== 'void' && !r.billId && (!period || periodOf(r) === period) && (!customerId || r.customerId === customerId);
        });
        var byKey = util.groupBy(rows, function (r) { return (r.customerId || 'NA') + '#' + periodOf(r); });
        var created = [];
        Object.keys(byKey).forEach(function (k) {
            var g = byKey[k];
            var total = util.money(util.sum(g, 'amount'));
            var paid = util.money(util.sum(g.filter(function (r) { return r.status === 'paid'; }), 'amount'));
            var bill = db.create('bills', {
                billNo: 'BILL' + periodOf(g[0]).replace('-', '') + util.pad((db.counters().billsSeq = (db.counters().billsSeq || 0) + 1), 3),
                customerId: g[0].customerId, customer: TMS.order.customerName(g[0]), period: periodOf(g[0]),
                itemCount: g.length, totalAmount: total, receivedAmount: paid,
                status: paid >= total && total > 0 ? 'settled' : (paid > 0 ? 'partial' : 'draft'),
                dueDate: g[0].dueDate, issuedAt: util.iso(util.now()), remark: ''
            });
            g.forEach(function (r) { r.billId = bill.id; db.touch('receivables'); });
            created.push(bill);
        });
        db.commit('bills', '', 'bill:generate');
        return created;
    }

    function confirmBill(id) {
        var b = db.get('bills', id);
        if (!b) return null;
        return db.update('bills', id, { status: 'confirmed', confirmedAt: util.iso(util.now()) });
    }

    /* ---------- 应付 ---------- */

    /* 车次费用入账：自有车次只落可变成本（油费/路桥），司机趟费挂在应付上按结算入账；
       车辆折旧属车队固定开支，由期间费用计提，避免与车次可变成本重复计损。
       外协舱位整笔走应付，不再单独落车次流水。 */
    function recordTripExpense(tr) {
        if (!tr || tr.dispatchType === 'ltl') return null;
        var view = TMS.operation.costView(tr);
        var amount = util.money(view.total - (view.driver || 0) - (view.fixed || 0));
        if (amount <= 0) return null;
        var exists = db.findOne('finances', function (f) { return f.refId === tr.id && f.category === '干线运输'; });
        if (exists) return exists;
        return finRow('expense', '干线运输', {
            refId: tr.id, amount: amount, date: tr.actualDepartAt || util.iso(util.now()),
            remark: '自有车次' + TMS.operation.labelOf(tr) + ' 可变成本（' + view.km + 'km 油费/路桥）'
        });
    }

    function createTripPayable(transport) {
        var tr = transport;
        var own = tr.dispatchType !== 'ltl';
        var view = TMS.operation.costView(tr);
        var amount = own ? util.money(view.driver || 0) : util.money(view.total);
        if (amount <= 0) return null;
        var carrier = !own && tr.carrierId ? db.get('carriers', tr.carrierId) : null;
        // refNo/车次标签由 refId 反查车次，应付行只留结算要素
        return db.create('payables', {
            refId: tr.id,
            target: own ? (TMS.operation.driverOf(tr) || '自有车队') : (carrier ? carrier.name : '外协承运商'),
            targetType: own ? 'driver' : 'carrier',
            targetId: own ? tr.driverId : (carrier ? carrier.id : ''),
            category: own ? '司机趟费' : '干线运输', amount: amount,
            date: util.dateKey(tr.date || util.now()),
            dueDate: util.dateKey(util.addDays(util.now(), 30)),
            status: 'pending', settledAt: '', operator: ''
        });
    }

    function createPayable(data) {
        return db.create('payables', data);
    }

    function settlePayable(id, data) {
        var p = db.get('payables', id);
        if (!p) return null;
        if (p.status === 'settled') return p;
        var at = util.iso(util.now());
        db.update('payables', id, { status: 'settled', settledAt: at, operator: (data || {}).operator || '财务结算' });
        // 账面费用按供应商结算入账：外协舱位、司机趟费、操作费、派送费、异常扣款
        finRow('expense', p.category, {
            orderId: /^HL/.test(p.refId || '') ? p.refId : '', refId: p.id, amount: p.amount, date: at,
            remark: '应付结算：' + p.target + '（' + (p.refNo || p.category) + '）'
        });
        db.commit('payables', id, 'ap:settle');
        return db.get('payables', id);
    }

    /* 期间费用计提：场地/人工/折旧/系统这类不挂在票上的固定开支，按月入账，
       真实账本的支出结构就是「供应商结算 + 期间费用」两块 */
    var PERIOD_COSTS = [
        { category: '场地租金', per: 'hub', rate: 46000, label: '分拨场地租赁与物业' },
        { category: '装卸人工', per: 'hub', rate: 32000, label: '分拨固定班组人工' },
        { category: '车辆折旧', per: 'vehicle', rate: 4300, label: '自有车队折旧与保险' },
        { category: '系统运维', per: 'fixed', rate: 26000, label: 'TMS/仓储系统与云资源' },
        { category: '客服人工', per: 'fixed', rate: 34000, label: '客服中心与理赔组人力' }
    ];

    /* 期间费用按台账实际覆盖天数折算计提。
       演示库只有二十几天流水，若按整月计提，跨月的窗口会把两个月租金一次性压进损益，
       账面必然倒挂；真实财务月结本来就按自然月出，这里等比折算同一个口径。 */
    function coveredDays(period) {
        var days = util.unique(db.col('finances').filter(function (f) {
            return periodOf(f) === period;
        }).map(function (f) { return util.dateKey(f.date); }));
        var monthDays = daysInMonth(period);
        return Math.max(1, Math.min(monthDays, days.length));
    }

    function daysInMonth(period) {
        var ym = String(period).split('-');
        var y = Number(ym[0]), m = Number(ym[1]);
        return m ? new Date(y, m, 0).getDate() : 30;
    }

    function accruePeriodExpenses(period) {
        var p = period || util.monthKey(util.now());
        var rows = [];
        var ratio = coveredDays(p) / daysInMonth(p);
        PERIOD_COSTS.forEach(function (spec) {
            var exists = db.findOne('finances', function (f) { return f.category === spec.category && periodOf(f) === p; });
            if (exists) return;
            var units = spec.per === 'hub' ? db.col('hubs').length : (spec.per === 'vehicle' ? db.col('vehicles').length : 1);
            var amount = util.money(units * spec.rate * ratio);
            rows.push(finRow('expense', spec.category, {
                amount: amount, date: util.iso(util.now()), refId: p,
                remark: spec.label + '（' + units + ' × ' + util.fmt.money(spec.rate) + ' × ' + util.round(ratio * 100, 0) + '%）'
            }));
        });
        if (rows.length) db.persist('finance:accrue');
        return rows;
    }

    function payableBreakdown() {
        var rows = db.col('payables');
        var byCat = util.groupBy(rows, 'category');
        var byType = util.groupBy(rows, 'targetType');
        var label = { carrier: '承运商', driver: '司机', branch: '网点', supplier: '供应商' };
        return {
            byCategory: Object.keys(byCat).map(function (k) { return { label: k, value: util.money(util.sum(byCat[k], 'amount')), count: byCat[k].length }; })
                .sort(function (a, b) { return b.value - a.value; }),
            byTargetType: Object.keys(byType).map(function (k) { return { label: label[k] || k || '其他', value: util.money(util.sum(byType[k], 'amount')), count: byType[k].length }; })
                .sort(function (a, b) { return b.value - a.value; }),
            total: util.money(util.sum(rows, 'amount')),
            pending: util.money(util.sum(rows.filter(function (r) { return r.status === 'pending'; }), 'amount')),
            settled: util.money(util.sum(rows.filter(function (r) { return r.status === 'settled'; }), 'amount'))
        };
    }

    /* ---------- 代收货款 ---------- */

    function createCODRecord(order, at) {
        var exists = db.findOne('codRecords', function (r) { return r.orderId === order.id; });
        if (exists) return exists;
        var gv = Number(order.codAmount) || 0;
        var fee = util.money(Math.max(cfg.billing.codMinService, gv * cfg.billing.codServiceRate));
        return db.create('codRecords', {
            orderId: order.id, waybillNo: order.waybillNo,
            shipper: TMS.order.customerName(order), shipperId: order.customerId,
            consignee: (order.pod && order.pod.receiver) || order.receiverName || '收件人',
            goodsValue: gv, serviceFee: fee, netPayable: util.money(gv - fee),
            collectedAt: at || order.signedAt || util.iso(util.now()),
            courier: order.courier || '', remitStatus: 'pending', remittedAt: '', operator: '', remark: ''
        });
    }

    function remitCOD(id, operator) {
        var r = db.get('codRecords', id);
        if (!r) return null;
        if (r.remitStatus === 'remitted') return r;
        var at = util.iso(util.now());
        db.update('codRecords', id, { remitStatus: 'remitted', remittedAt: at, operator: operator || '财务结算' });
        // 上划的是客户货款（代收负债），非公司支出；服务费才是收入
        finRow('expense', '代收货款上划', {
            orderId: r.orderId, refId: r.id, amount: r.netPayable, date: at, nature: '往来',
            remark: '上划给' + r.shipper
        });
        if (Number(r.serviceFee) > 0) {
            finRow('income', '代收款服务费', { orderId: r.orderId, refId: r.id, amount: r.serviceFee, date: at, remark: 'COD 服务费收入' });
        }
        db.commit('codRecords', id, 'cod:remit');
        return db.get('codRecords', id);
    }

    function codSummary() {
        var rows = db.col('codRecords');
        var remitted = rows.filter(function (r) { return r.remitStatus === 'remitted'; });
        var pending = rows.filter(function (r) { return r.remitStatus !== 'remitted'; });
        return {
            goodsTotal: util.money(util.sum(rows, 'goodsValue')),
            pendingRemit: util.money(util.sum(pending, 'netPayable')),
            remittedTotal: util.money(util.sum(remitted, 'netPayable')),
            serviceIncome: util.money(util.sum(remitted, 'serviceFee')),
            count: rows.length, pendingCount: pending.length
        };
    }

    /* ---------- 计费复核 ---------- */

    function recheckWeight(orderId, data) {
        var order = db.get('orders', orderId);
        if (!order) return { ok: false, message: '订单不存在' };
        if (order.status === 'cancelled') return { ok: false, message: '已取消订单不可复核' };
        var d = data || {};
        var originalWeight = Number(order.weight) || 0;
        var originalChargeable = Number(order.chargeableWeight) || originalWeight;
        var originalFreight = Number(order.freight) || 0;
        var q = TMS.pricing.reprice(order, { weight: Number(d.actualWeight) || originalWeight, dims: d.dims || order.dims });
        var delta = util.money(q.total - originalFreight);
        order.weight = q.actualWeight; order.dims = d.dims || order.dims;
        order.auditedAt = util.iso(util.now()); order.updatedAt = order.auditedAt;
        TMS.pricing.applyQuote(order, q);
        var rec = db.create('rechecks', {
            orderId: order.id, waybillNo: order.waybillNo, customer: TMS.order.customerName(order),
            originalWeight: originalWeight, auditedWeight: q.actualWeight,
            originalChargeable: originalChargeable, auditedChargeable: q.chargeableWeight,
            originalFreight: originalFreight, auditedFreight: q.total,
            delta: delta, type: Math.abs(delta) < 0.01 ? '一致' : (delta > 0 ? '补收' : '退费'),
            reason: d.reason || '到货复磅', operator: d.operator || '运营管理员', auditedAt: order.auditedAt
        });
        if (Math.abs(delta) >= 0.01) {
            finRow('income', delta > 0 ? '运费复核补收' : '运费复核退费', {
                orderId: order.id, amount: delta, date: order.auditedAt,
                remark: delta > 0 ? '向客户补收' : '退还客户'
            });
            var rece = receivableOf(order.id);
            if (rece && rece.status !== 'paid') { rece.amount = q.total; db.touch('receivables'); }
            else if (rece && rece.status === 'paid') {
                rece.amount = q.total; rece.adjustNote = '复核后已' + (delta > 0 ? '补收' : '退费') + ' ' + util.money(Math.abs(delta));
                db.touch('receivables');
            }
        }
        TMS.audit.log('order.recheck', 'orders', order.id, '计费复核：' + originalWeight + 'kg → ' + q.actualWeight + 'kg，运费 ' + originalFreight + ' → ' + q.total, d.operator || '运营管理员');
        db.commit('rechecks', rec.id, 'recheck');
        return { ok: true, recheck: rec, delta: delta, order: order };
    }

    /* ---------- 汇总 ---------- */

    function financeSummary(period) {
        var rows = db.col('finances').filter(function (f) {
            return isLedger(f) && (!period || periodOf(f) === period);
        });
        var income = rows.filter(function (f) { return f.type === 'income'; });
        var expense = rows.filter(function (f) { return f.type === 'expense'; });
        var inc = util.money(util.sum(income, ledgerValue));
        var exp = util.money(util.sum(expense, ledgerValue));
        var byCat = util.groupBy(rows, 'category');
        return {
            income: inc, expense: exp, profit: util.money(inc - exp),
            margin: inc ? util.round((inc - exp) / inc * 100, 1) : 0,
            pendingIncome: util.money(util.sum(income.filter(function (f) { return f.status === 'pending'; }), ledgerValue)),
            byCategory: Object.keys(byCat).map(function (k) {
                var g = byCat[k];
                return {
                    label: k,
                    income: util.money(util.sum(g.filter(function (x) { return x.type === 'income'; }), ledgerValue)),
                    expense: util.money(util.sum(g.filter(function (x) { return x.type === 'expense'; }), ledgerValue))
                };
            }).sort(function (a, b) { return (b.income + b.expense) - (a.income + a.expense); }).slice(0, 10)
        };
    }

    function financeTrend(days) {
        var out = [];
        var n = days || 14;
        for (var i = n - 1; i >= 0; i--) {
            var key = util.dateKey(util.addDays(util.now(), -i));
            var rows = db.col('finances').filter(function (f) { return isLedger(f) && util.dateKey(f.date) === key; });
            out.push({
                label: util.fmt.monthDay(key),
                income: util.money(util.sum(rows.filter(function (f) { return f.type === 'income'; }), ledgerValue)),
                expense: util.money(util.sum(rows.filter(function (f) { return f.type === 'expense'; }), ledgerValue))
            });
        }
        return out;
    }

    function receivableSummary() {
        var rows = db.col('receivables');
        var overdue = rows.filter(function (r) { return r.status === 'pending' && util.toDate(r.dueDate) < util.now(); });
        /* 结算周期不落库：客户改周期、订单改付款方式都会立刻影响账期口径 */
        var cycleOf = function (r) {
            var c = r.customerId ? db.get('customers', r.customerId) : null;
            if (c && c.settleCycle) return c.settleCycle;
            return TMS.order.settleCycleOf(r.orderId ? db.get('orders', r.orderId) : null);
        };
        var byCycle = util.groupBy(rows, cycleOf);
        return {
            total: util.money(util.sum(rows, 'amount')),
            pending: util.money(util.sum(rows.filter(function (r) { return r.status === 'pending'; }), 'amount')),
            paid: util.money(util.sum(rows.filter(function (r) { return r.status === 'paid'; }), 'amount')),
            overdue: util.money(util.sum(overdue, 'amount')),
            overdueCount: overdue.length,
            count: rows.length,
            byCycle: Object.keys(byCycle).map(function (k) {
                var g = byCycle[k];
                return { label: k, value: util.money(util.sum(g, 'amount')), pending: util.money(util.sum(g.filter(function (r) { return r.status === 'pending'; }), 'amount')) };
            }).sort(function (a, b) { return b.value - a.value; })
        };
    }

    function grossAnalysis() {
        var rows = db.col('orders').filter(function (o) { return o.status === 'signed' && o.cost; });
        var revenue = util.money(util.sum(rows, 'freight'));
        var cost = util.money(util.sum(rows, TMS.pricing.costTotalOf));
        var byZone = util.groupBy(rows, function (o) { return TMS.pricing.zoneOf(o.origin); });
        return {
            revenue: revenue, cost: cost, profit: util.money(revenue - cost),
            margin: revenue ? util.round((revenue - cost) / revenue * 100, 1) : 0,
            orders: rows.length,
            avgFreight: rows.length ? util.round(revenue / rows.length, 2) : 0,
            avgCost: rows.length ? util.round(cost / rows.length, 2) : 0,
            byZone: Object.keys(byZone).map(function (k) {
                var g = byZone[k];
                var rev = util.money(util.sum(g, 'freight'));
                var cst = util.money(util.sum(g, TMS.pricing.costTotalOf));
                return { label: k, revenue: rev, cost: cst, margin: rev ? util.round((rev - cst) / rev * 100, 1) : 0 };
            }).sort(function (a, b) { return b.revenue - a.revenue; }),
            worst: util.sortBy(rows, TMS.pricing.marginOf, 'asc').slice(0, 5)
                .map(function (o) {
                    return {
                        id: o.id, waybillNo: o.waybillNo, customer: TMS.order.customerName(o), origin: o.origin,
                        destination: o.destination, service: o.service, weight: o.chargeableWeight,
                        freight: o.freight, cost: TMS.pricing.costTotalOf(o), margin: TMS.pricing.marginOf(o)
                    };
                })
        };
    }

    TMS.finance = {
        periodOf: periodOf,
        ensureReceivable: ensureReceivable, receivableOf: receivableOf, voidReceivable: voidReceivable,
        adjustReceivable: adjustReceivable, settleOrder: settleOrder, markReceivablePaid: markReceivablePaid,
        generateBills: generateBills, confirmBill: confirmBill,
        createTripPayable: createTripPayable, recordTripExpense: recordTripExpense,
        createPayable: createPayable, settlePayable: settlePayable,
        accruePeriodExpenses: accruePeriodExpenses,
        payableBreakdown: payableBreakdown,
        createCODRecord: createCODRecord, remitCOD: remitCOD, codSummary: codSummary,
        recheckWeight: recheckWeight, financeSummary: financeSummary, financeTrend: financeTrend,
        receivableSummary: receivableSummary, grossAnalysis: grossAnalysis,
        finRow: finRow, incomeRow: incomeRow, ledgerValue: ledgerValue, isLedger: isLedger
    };
})(window);
