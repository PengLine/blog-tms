/* 客户端门户：货交出去以后，客户只剩三件事——它现在在哪、会不会迟到、账单对不对。
   所以这一端把四条线各做成闭环：
   下单前算清价（试算报价）→ 下单后看得见（轨迹跟踪）→ 出事后有出口（工单/理赔）→ 钱能对得上（对账支付，消费返积分，积分再换运费）。
   成本、车次装载率、内部扣款这些口径客户无权看，门户层连字段都不取，而不是靠样式藏起来。 */
(function (global) {
    'use strict';

    var TMS = global.TMS = global.TMS || {};
    var util = TMS.util, ui = TMS.ui, db = TMS.db, cfg = TMS.cfg, pg = TMS.pages, po = TMS.portal;
    var esc = util.esc, fmt = util.fmt;
    var ROLE = 'client';

    /* 积分兑换目录：门户唯一的「消费」出口，兑换只写负数流水并扣余额，不生成单据，
       因为发货抵扣在真实系统里靠下一单的折扣实现，这里留的是可核对的台账 */
    var REDEEM = [
        { name: '10 元运费券', points: 100, kind: '券' },
        { name: '30 元运费券', points: 280, kind: '券' },
        { name: '加急服务升级券', points: 350, kind: '服务' },
        { name: '标准件免寄 1 次', points: 500, kind: '服务' },
        { name: '定制木架包装', points: 800, kind: '服务' },
        { name: '冷链保温箱（可复用）', points: 1200, kind: '实物' }
    ];

    /* ---------- 我的口径 ---------- */

    function sess() { return po.session(); }
    function custId() { var s = sess(); return s.customerId || s.orgId || ''; }
    function cust() { return db.get('customers', custId()) || {}; }
    function actorName() { var c = cust(); return sess().name || c.contact || c.shortName || '客户'; }

    function levelOf() {
        var hit = cfg.customerLevels.filter(function (l) { return l.level === cust().level; })[0];
        return hit || cfg.customerLevels[cfg.customerLevels.length - 1];
    }

    function byCreate(a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); }

    /* 原始行只用来取集合，列表一律走 view：客户/时效/优先级等派生字段只有 view 补齐得全 */
    function myRaw() { return db.col('orders').filter(function (o) { return o.customerId === custId(); }); }
    function mine() { return myRaw().map(TMS.order.view).sort(byCreate); }
    function myIdSet() { var m = {}; myRaw().forEach(function (o) { m[o.id] = 1; }); return m; }

    function myReceivables() {
        var ids = myIdSet();
        return db.col('receivables').filter(function (r) {
            return r.status !== 'void' && (r.customerId === custId() || ids[r.orderId]);
        }).sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    }

    function myBills() {
        return db.col('bills').filter(function (b) { return b.customerId === custId(); })
            .sort(function (a, b) { return String(b.period).localeCompare(String(a.period)); });
    }

    function myTickets() {
        var ids = myIdSet(), n = cust().name;
        return db.col('tickets').filter(function (t) { return ids[t.orderId] || (n && t.customer === n); })
            .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
    }

    function myClaims() {
        var ids = myIdSet(), n = cust().name;
        return db.col('claims').filter(function (c) { return ids[c.orderId] || (n && c.customer === n); })
            .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
    }

    function myExceptions() {
        var ids = myIdSet();
        return db.col('exceptions').filter(function (e) { return ids[e.orderId]; })
            .sort(function (a, b) { return String(b.reportedAt).localeCompare(String(a.reportedAt)); });
    }

    /* 应收口径按「账期未核销」算，逾期独立统计：客户最关心的是欠多少、有没有逾期 */
    function debtStats(rows) {
        rows = rows || myReceivables();
        var pending = rows.filter(function (r) { return r.status === 'pending'; });
        var overdue = pending.filter(function (r) { return util.toDate(r.dueDate) < util.now(); });
        return {
            rows: rows,
            pendingCount: pending.length,
            pending: util.money(util.sum(pending, 'amount')),
            overdueCount: overdue.length,
            overdue: util.money(util.sum(overdue, 'amount')),
            paid: util.money(util.sum(rows.filter(function (r) { return r.status === 'paid'; }), 'amount'))
        };
    }

    /* 近 N 天我的签收准时率：以签收流水为准，未签收的不进分母 */
    function onTimeRate(days) {
        var cutoff = util.addDays(util.now(), -((days || 30) - 1)).getTime();
        var signed = myRaw().filter(function (o) {
            return o.status === 'signed' && util.toDate(o.signedAt || o.updatedAt).getTime() >= cutoff;
        });
        if (!signed.length) return { rate: 0, signed: 0, late: 0 };
        var late = signed.filter(TMS.order.isSignedLate).length;
        return { rate: util.round((signed.length - late) / signed.length * 100, 1), signed: signed.length, late: late };
    }

    /* 按自然日统计我的单量/运费，供门户折线图用 */
    function daily(list, days, getter) {
        var start = util.dayStart(util.now()), out = [], map = {};
        for (var i = days - 1; i >= 0; i--) {
            var d = util.addDays(start, -i), key = util.dateKey(d);
            map[key] = 0;
            out.push({ label: fmt.monthDay(d), key: key });
        }
        (list || []).forEach(function (o) {
            var k = util.dateKey(getter ? getter(o) : o.createdAt);
            if (map[k] != null) map[k] += 1;
        });
        out.forEach(function (r) { r.value = map[r.key]; });
        return out;
    }

    function topDest(list, days) {
        var cutoff = util.addDays(util.now(), -((days || 30) - 1)).getTime();
        var g = util.groupBy((list || mine()).filter(function (o) { return util.toDate(o.createdAt).getTime() >= cutoff; }), 'destination');
        return Object.keys(g).map(function (k) {
            return { label: k, value: g[k].length, sub: fmt.money(util.sum(g[k], 'freight')) };
        }).sort(function (a, b) { return b.value - a.value; }).slice(0, 8);
    }

    /* 最新动态：只读我名下单据的扫描流水，按时刻倒序取前 N 条 */
    function myFeed(limit) {
        var orders = {}, list = [];
        myRaw().forEach(function (o) { orders[o.id] = o; });
        db.col('scans').forEach(function (s) { if (orders[s.orderId]) list.push(s); });
        list.sort(function (a, b) { return String(b.opTime).localeCompare(String(a.opTime)); });
        return list.slice(0, limit || 10).map(function (s) {
            return { scan: TMS.order.traceView(s, orders[s.orderId]), order: orders[s.orderId] };
        });
    }

    /* ---------- 报价与下单 ---------- */

    function defaultPayment() {
        var c = cust(), cyc = c.settleCycle || levelOf().settleCycle;
        return cyc === '现付' || !cyc ? '现付' : cyc;
    }

    var QUOTE_FIELDS = [
        { key: 'origin', type: 'city', label: '始发城市', value: '' },
        { key: 'destination', type: 'city', label: '目的城市', placeholder: '输入到达城市' },
        { key: 'service', label: '服务', placeholder: false, options: ui.optionsOf(cfg.serviceLevels), value: '标准' },
        { key: 'goods', label: '品名', placeholder: false, options: ui.optionsOf(TMS.master.GOODS, 'name', 'name'), value: '电子产品' },
        { key: 'pieces', type: 'number', label: '件数', min: 1, value: 1 },
        { key: 'weight', type: 'number', label: '实际重量', unit: 'kg', min: 0.1, value: 5 },
        { key: 'dims', label: '外包装尺寸', placeholder: '60x40x30，多件用 / 分隔' },
        { key: 'payment', label: '付款方式', placeholder: false, options: ui.optionsOf(cfg.paymentMethods) },
        { key: 'cod', type: 'number', label: '代收货款', unit: '元', min: 0 },
        { key: 'declared', type: 'number', label: '保价金额', unit: '元', min: 0 }
    ];

    /* 试算参数：始发城市默认跟随客户档案，付款方式默认跟随结算周期，
       客户改一处表单就把另一处的默认值带出来，报价与下单永远用同一份入参 */
    function quoteInput(filters) {
        var f = filters || {}, c = cust();
        return {
            origin: f.origin || c.city || '上海', destination: f.destination || '',
            service: f.service || '标准', goods: f.goods || '电子产品',
            pieces: Math.max(1, Number(f.pieces) || 1), weight: Math.max(0.1, Number(f.weight) || 0.1),
            dims: f.dims || '', payment: f.payment || defaultPayment(),
            cod: Number(f.cod) || 0, declared: Number(f.declared) || 0
        };
    }

    /* 路由卡片的副标题：先说这一单跨到哪一层，再说怎么走。
       试算表单只收城市，收不到区级，所以这里不提示「缺区级」——
       客户填不了的东西不该当成他的地址有问题 */
    function routeScopeSub(plan, p) {
        if (!plan) return '路由由线路主数据即时给出，下单后不会另起一条线';
        var sc = plan.scope || TMS.network.scopeOfOrder(p);
        var ch = plan.chain || {};
        return esc(ch.from || p.origin) + ' → ' + esc(ch.to || p.destination) + ' · ' +
            ui.badge(esc(sc.name), sc.tone);
    }

    function quoteOf(p) {
        if (!p.destination) return null;
        if (!TMS.master.cityByName(p.origin) || !TMS.master.cityByName(p.destination)) return null;
        return TMS.pricing.quote({
            origin: p.origin, destination: p.destination, service: p.service, goods: p.goods,
            pieces: p.pieces, weight: p.weight, dims: p.dims,
            paymentMethod: p.payment, codAmount: p.cod, declaredValue: p.declared, isInsured: p.declared > 0,
            customerId: custId()
        });
    }

    function quoteTable(q) {
        return ui.table({
            dense: true, sortable: false, keyName: 'label',
            rows: q.breakdown.concat([{ label: '合计（运价卡 ' + q.cardName + ' v' + q.cardVersion + '）', value: q.total }]),
            columns: [
                { key: 'label', label: '计费项', render: function (r) { return esc(r.label); } },
                {
                    key: 'value', label: '金额', align: 'right', render: function (r) {
                        return r.value < 0
                            ? '<span class="tms-money" style="color:var(--tms-success)">' + fmt.money(r.value) + '</span>'
                            : ui.moneyCell(r.value);
                    }
                }
            ]
        });
    }

    /* 四种服务同参数比价：客户最常问「加急贵多少、能快几天」，一次算完给对照 */
    function serviceCompare(p) {
        return cfg.serviceLevels.map(function (svc) {
            var q = TMS.pricing.quote({
                origin: p.origin, destination: p.destination, service: svc, goods: p.goods,
                pieces: p.pieces, weight: p.weight, dims: p.dims,
                paymentMethod: p.payment, codAmount: p.cod, declaredValue: p.declared, isInsured: p.declared > 0,
                customerId: custId()
            });
            var plan = TMS.network.planRoute(p.origin, p.destination, svc);
            return {
                service: svc, total: q.total, chargeable: q.chargeableWeight,
                stdHours: plan ? plan.stdHours : 0, slaHours: plan ? plan.slaHours : 0,
                mode: plan ? plan.mode : '—', promise: plan ? TMS.network.promiseAt(util.now(), plan, svc) : '',
                onQuote: svc === p.service
            };
        });
    }

    /* 下单弹窗：试算页与首页快捷入口共用。参数以「当前报价入参」为底、
       再来一单的历史字段为覆盖，notice 展示的时效与提交后写进单据的时效必须是同一次计算的结果 */
    function orderModal(p, preset) {
        var c = cust(), v = preset || {};
        var P = {
            origin: v.origin || p.origin, destination: v.destination || p.destination,
            service: v.service || p.service, goods: v.goods || p.goods,
            pieces: v.pieces || p.pieces, weight: v.weight || p.weight, dims: v.dims || p.dims,
            payment: v.payment || p.payment, cod: v.cod || p.cod, declared: v.declared || p.declared
        };
        var q = quoteOf(P);
        var plan = q ? TMS.network.planRoute(P.origin, P.destination, P.service) : null;
        ui.formModal({
            title: '自助下单', size: 'lg',
            sub: '按运价卡即时计价，下单即挂应收；揽收由发货地址归属网点受理，无需先联系业务员',
            fields: [
                { key: 'origin', label: '始发城市', type: 'city', value: P.origin, required: true },
                { key: 'destination', label: '目的城市', type: 'city', value: P.destination, required: true },
                { key: 'service', label: '服务', type: 'select', placeholder: false, options: ui.optionsOf(cfg.serviceLevels), value: P.service },
                { key: 'paymentMethod', label: '付款方式', type: 'select', placeholder: false, options: ui.optionsOf(cfg.paymentMethods), value: P.payment },
                { key: 'goods', label: '品名', type: 'select', placeholder: false, options: ui.optionsOf(TMS.master.GOODS, 'name', 'name'), value: P.goods },
                { key: 'pieces', label: '件数', type: 'number', min: 1, value: P.pieces, required: true },
                { key: 'weight', label: '实际重量', type: 'number', unit: 'kg', min: 0.1, value: P.weight, required: true },
                { key: 'dims', label: '外包装尺寸', value: P.dims, placeholder: '长x宽x高（cm），多件用 / 分隔' },
                { key: 'declaredValue', label: '保价金额', type: 'number', unit: '元', min: 0, value: P.declared, tip: '保价费按 3‰ 计' },
                { key: 'codAmount', label: '代收货款', type: 'number', unit: '元', min: 0, value: P.cod, when: 'paymentMethod=到付' },
                { key: 'senderAddress', label: '寄件地址', span: 2, value: c.senderAddress || (c.city || '') + '市工业园区' },
                { key: 'receiverName', label: '收件人', value: v.receiverName || '' },
                { key: 'receiverPhone', label: '收件电话', value: v.receiverPhone || '' },
                { key: 'receiverAddress', label: '收件地址', span: 2, value: v.receiverAddress || '', placeholder: '详细到门牌，末端派送按这段地址分网点' },
                { key: 'remark', label: '备注', type: 'textarea', span: 2, placeholder: '如易碎、需上楼、指定送达时段' }
            ],
            notice: q ? ui.desc([
                { label: '计费重量', value: fmt.kg(q.chargeableWeight) + '（实重 ' + fmt.kg(q.actualWeight) + ' / 体积重 ' + fmt.kg(q.volumetricWeight) + '）' },
                { label: '预估运费', value: '<b class="tms-money">' + fmt.money(q.total) + '</b>' },
                { label: '承诺送达', value: plan ? fmt.dateTime(TMS.network.promiseAt(util.now(), plan, P.service)) : '—' },
                { label: '干线方式', value: plan ? esc(plan.mode) + ' · ' + fmt.km(plan.distanceKm) : '—' }
            ], { inline: true }) : ui.notice('目的城市还没填对，暂无法计价', 'warn'),
            okText: '确认下单',
            onSubmit: function (x) {
                var res = TMS.order.create({
                    customerId: custId(), origin: x.origin, destination: x.destination,
                    goods: x.goods, pieces: x.pieces, weight: x.weight, dims: x.dims,
                    service: x.service, paymentMethod: x.paymentMethod, codAmount: x.codAmount,
                    declaredValue: x.declaredValue, isInsured: Number(x.declaredValue) > 0,
                    senderAddress: x.senderAddress, receiverName: x.receiverName,
                    receiverPhone: x.receiverPhone, receiverAddress: x.receiverAddress,
                    remark: x.remark, contact: c.contact, phone: c.phone,
                    channel: '客户自助', actor: actorName()
                });
                if (!res.ok) return '下单失败：' + res.message;
                ui.toast('下单成功 ' + res.order.waybillNo + '，运费 ' + fmt.money(res.order.freight) + '，等待网点上门揽收', 'success');
            }
        });
    }

    function cancelModal(id) {
        var o = db.get('orders', id);
        if (!o) { ui.toast('订单不存在', 'error'); return; }
        if (o.status === 'signed') { ui.toast('已签收，请走退货', 'warn'); return; }
        ui.formModal({
            title: '取消订单 · ' + o.waybillNo, danger: true,
            sub: '取消即冲销本单应收；件已在干线上的会同步生成拦截退回工单，不会凭空消失',
            fields: [
                { key: 'reason', label: '取消原因', type: 'select', placeholder: false, options: ui.optionsOf(['计划变更', '重复下单', '客户改约', '收方拒收', '价格调整', '其他原因']), value: '计划变更' },
                { key: 'note', label: '补充说明', type: 'textarea', span: 2 }
            ],
            okText: '确认取消',
            onSubmit: function (v) {
                var res = TMS.order.cancel(id, { reason: v.reason + (v.note ? '：' + v.note : ''), operator: actorName() });
                if (!res.ok) return '取消失败：' + res.message;
                if (res.intercepted) ui.toast('该件已在干线上，已发起拦截退回', 'warn');
            }
        });
    }

    function changeModal(id) {
        var o = db.get('orders', id);
        if (!o) { ui.toast('订单不存在', 'error'); return; }
        ui.formModal({
            title: '改单 · ' + o.waybillNo,
            sub: '改地址/服务/重量即时重算运费，差额自动进应收调整；干线后改单需先联系客服拦截',
            fields: [
                { key: 'destination', label: '目的城市', type: 'city', value: o.destination },
                { key: 'service', label: '服务', type: 'select', placeholder: false, options: ui.optionsOf(cfg.serviceLevels), value: o.service },
                { key: 'weight', label: '重量', type: 'number', unit: 'kg', min: 0.1, value: o.weight },
                { key: 'pieces', label: '件数', type: 'number', min: 1, value: o.pieces },
                { key: 'receiverName', label: '收件人', value: o.receiverName || '' },
                { key: 'receiverPhone', label: '收件电话', value: o.receiverPhone || '' },
                { key: 'receiverAddress', label: '收件地址', span: 2, value: o.receiverAddress || '' },
                { key: 'note', label: '改单说明', type: 'textarea', span: 2, placeholder: '会写进轨迹备注，网点与派送员都能看到' }
            ],
            notice: ui.desc([
                { label: '当前运费', value: ui.moneyCell(o.freight) },
                { label: '当前状态', value: pg.statusBadge(o.status) },
                { label: '承诺送达', value: fmt.dateTime(TMS.order.promiseOf(o)) }
            ], { inline: true }),
            okText: '保存并重算运费',
            onSubmit: function (v) {
                var res = TMS.order.change(id, {
                    destination: v.destination, service: v.service, weight: v.weight, pieces: v.pieces,
                    receiverName: v.receiverName, receiverPhone: v.receiverPhone, receiverAddress: v.receiverAddress,
                    note: v.note, operator: actorName()
                });
                if (!res.ok) return '改单失败：' + res.message;
                ui.toast('改单完成，运费变动 ' + fmt.money(res.delta), 'success');
            }
        });
    }

    function ticketModal(orderId) {
        var o = orderId ? db.get('orders', orderId) : null;
        var pool = mine().slice(0, 40);
        ui.formModal({
            title: '提交客服工单',
            sub: '催件/改址/发票/投诉统一进工单池，客服受理与回复结果都会回写在这张单上',
            fields: [
                {
                    key: 'orderId', label: '关联运单', type: 'select', value: o ? o.id : '',
                    options: [{ value: '', label: '不关联具体运单' }].concat(
                        pool.map(function (x) { return { value: x.id, label: x.waybillNo + ' · ' + x.origin + '→' + x.destination }; })),
                    tip: '只列我最近 40 张单'
                },
                { key: 'type', label: '诉求类型', type: 'select', placeholder: false, options: ui.optionsOf(TMS.service.TICKET_TYPES), value: '催件', required: true },
                { key: 'priority', label: '紧急程度', type: 'select', placeholder: false, options: ui.optionsOf(['高', '中', '低']), value: '中' },
                { key: 'content', label: '诉求描述', type: 'textarea', span: 2, required: true, placeholder: '请写清单号、期望时限与联系人' }
            ],
            okText: '提交工单',
            onSubmit: function (v) {
                var res = TMS.service.createTicket({
                    orderId: v.orderId, type: v.type, priority: v.priority, channel: '在线客服',
                    content: v.content, customer: cust().name || '', actor: actorName()
                });
                if (!res) return '提交失败';
                ui.toast('工单已提交（' + res.id + '），客服将在 ' + fmt.dateTime(res.deadline) + ' 前回复', 'success');
            }
        });
    }

    function claimModal(orderId) {
        var o = orderId ? db.get('orders', orderId) : null;
        var pool = mine().filter(function (x) { return x.status === 'signed' || x.status === 'problem'; });
        var suggested = o ? Math.min(Number(o.declaredValue) || 0, Number(o.freight) * 5) : 0;
        ui.formModal({
            title: '申请理赔',
            sub: o ? '货损/遗失提交后由运营端理赔岗审核；未保价按运费 5 倍封顶，保价按声明价值核定' : '选择运单后自动带出保价与限额',
            fields: [
                {
                    key: 'orderId', label: '运单', type: 'select', value: o ? o.id : '',
                    options: [{ value: '', label: '请选择' }].concat(pool.map(function (x) {
                        return { value: x.id, label: x.waybillNo + ' · ' + x.goods + ' · ' + fmt.money(x.freight) };
                    })), required: true
                },
                { key: 'type', label: '理赔类型', type: 'select', placeholder: false, options: ui.optionsOf(['货物破损', '货物遗失', '延迟送达', '错分错发', '包装不当']), value: '货物破损' },
                { key: 'amount', label: '申报金额', type: 'number', unit: '元', min: 0, value: suggested || '', tip: o && o.declaredValue ? '保价 ' + fmt.money(o.declaredValue) : '未保价，上限按运费 5 倍' },
                { key: 'reason', label: '事故说明', type: 'textarea', span: 2, required: true, placeholder: '发现时间、外包装状况、内件损失' },
                { key: 'evidence', label: '凭证', span: 2, placeholder: '照片编号/面单复印件说明' }
            ],
            notice: o ? ui.desc([
                { label: '运单', value: '<span class="tms-mono">' + esc(o.waybillNo) + '</span>' },
                { label: '运费', value: ui.moneyCell(o.freight) },
                { label: '保价', value: o.declaredValue ? fmt.money(o.declaredValue) : '<span class="tms-badge tone-warn">未保价</span>' },
                { label: '赔付上限', value: fmt.money(Math.min(Number(o.declaredValue) || 0, Number(o.freight) * 5) || Number(o.freight) * 5) }
            ], { inline: true }) : '',
            okText: '提交理赔申请',
            onSubmit: function (v) {
                var target = db.get('orders', v.orderId);
                if (!target) return '请选择运单';
                var max = Math.min(Number(target.declaredValue) || 0, Number(target.freight) * 5) || Number(target.freight) * 5;
                if (Number(v.amount) > max) return '申报金额超过本单赔付上限 ' + fmt.money(max);
                var rec = TMS.service.createClaim({
                    orderId: target.id, type: v.type, amount: v.amount, reason: v.reason,
                    evidence: v.evidence, applicant: actorName()
                });
                ui.toast('理赔申请已提交（' + rec.id + '），审核截止 ' + fmt.date(rec.deadline), 'success');
            }
        });
    }

    function payModal(orderId) {
        var o = db.get('orders', orderId);
        if (!o) { ui.toast('订单不存在', 'error'); return; }
        var r = TMS.finance.receivableOf(orderId);
        if (!r) { ui.toast('本单现付，没有待支付账期', 'warn'); return; }
        if (r.status === 'paid') { ui.toast('本单已于 ' + fmt.date(r.paidAt) + ' 结清', 'success'); return; }
        ui.formModal({
            title: '支付运费 · ' + o.waybillNo,
            sub: '支付即核销应收挂账，财务台账同步转为已收；月结单也可在此提前回款',
            fields: [
                { key: 'amount', label: '支付金额', type: 'number', unit: '元', value: r.amount, readonly: true },
                { key: 'way', label: '支付方式', type: 'select', placeholder: false, options: ui.optionsOf(['对公转账', '企业网银', '余额支付', '月结合并支付']), value: '对公转账' },
                { key: 'invoice', label: '回款凭证号', placeholder: '可稍后补录' },
                { key: 'note', label: '付款备注', type: 'textarea', span: 2 }
            ],
            notice: ui.desc([
                { label: '账期截止', value: fmt.date(r.dueDate) + (util.toDate(r.dueDate) < util.now() ? ' <span class="tms-badge tone-danger">已逾期</span>' : '') },
                { label: '付款方式', value: esc(o.paymentMethod) },
                { label: '应收单号', value: '<span class="tms-mono">' + esc(r.id) + '</span>' }
            ], { inline: true }),
            okText: '确认支付',
            onSubmit: function (v) {
                var res = TMS.finance.markReceivablePaid(r.id, { invoiceNo: v.invoice || v.way });
                if (!res) return '支付失败：应收单不存在';
                ui.toast('已支付 ' + fmt.money(res.amount) + '，本单结清' + (v.note ? '（' + v.note + '）' : ''), 'success');
            }
        });
    }

    function profileModal() {
        var c = cust();
        ui.formModal({
            title: '维护企业资料',
            sub: '联系人与寄件地址影响揽收派单；等级、账期与折扣由客户经理在运营端核定',
            fields: [
                { key: 'contact', label: '主联系人', value: c.contact, required: true },
                { key: 'phone', label: '联系电话', value: c.phone },
                { key: 'industry', label: '所属行业', value: c.industry },
                { key: 'city', label: '所在城市', type: 'city', value: c.city },
                { key: 'senderAddress', label: '默认寄件地址', span: 2, value: c.senderAddress },
                { key: 'monthlyVolume', label: '预计月单量', type: 'number', min: 0, value: c.monthlyVolume, tip: '用于客户经理排揽收班次' }
            ],
            okText: '保存',
            onSubmit: function (v) {
                db.update('customers', custId(), v);
                db.commit('customers', custId(), 'customer:update');
                ui.toast('企业资料已更新', 'success');
            }
        });
    }

    function redeemModal() {
        var pts = TMS.people.pointsOf(custId());
        ui.formModal({
            title: '积分兑换',
            sub: '兑换即时扣减余额并生成负数流水，运营端积分台账同步可查；兑换品由客户经理发放',
            fields: [
                {
                    key: 'item', label: '兑换品', type: 'select', placeholder: false,
                    options: ui.optionsOf(REDEEM, 'name', 'name'), value: REDEEM[0].name
                },
                { key: 'points', label: '消耗积分', type: 'number', min: 1, value: REDEEM[0].points, readonly: true },
                { key: 'note', label: '领取方式', span: 2, placeholder: '如：随下单一同交付 / 邮寄到付' }
            ],
            notice: ui.desc([{ label: '当前可用积分', value: '<b>' + fmt.number(pts.balance) + '</b> 分' }], { inline: true }),
            okText: '确认兑换',
            onSubmit: function (v) {
                var item = REDEEM.filter(function (r) { return r.name === v.item; })[0] || REDEEM[0];
                var res = TMS.people.redeemPoints(custId(), item.points, item.name);
                if (!res.ok) return res.message;
                ui.toast('已兑换 ' + item.name + '，剩余积分 ' + res.balance, 'success');
            }
        });
    }

    /* ---------- 动作 ---------- */

    var ACT = {
        'c:new': function () { orderModal(quoteInput(ui.state('c-send').filters)); },
        'c:repeat': function (id) {
            var o = db.get('orders', id);
            if (!o) { ui.toast('订单不存在', 'error'); return; }
            orderModal(quoteInput(ui.state('c-send').filters), {
                origin: o.origin, destination: o.destination, service: o.service, goods: o.goods,
                pieces: o.pieces, weight: o.weight, dims: o.dims, payment: o.paymentMethod,
                cod: Number(o.codAmount) || 0, declared: Number(o.declaredValue) || 0,
                receiverName: o.receiverName, receiverPhone: o.receiverPhone, receiverAddress: o.receiverAddress
            });
        },
        'c:clear': function () { ui.resetState('c-send'); po.refresh(); },
        'c:cancel': cancelModal,
        'c:change': changeModal,
        'c:pay': payModal,
        'c:ticket': ticketModal,
        'c:claim': claimModal,
        'c:profile': profileModal,
        'c:redeem': redeemModal,
        'c:reverse': function (id) {
            var o = db.get('orders', id);
            if (!o) { ui.toast('订单不存在', 'error'); return; }
            ui.confirm({
                title: '申请退货',
                message: '运单 ' + esc(o.waybillNo) + ' 将按原路退回，系统自动建一张反向退件单。',
                detail: '退件运费现付并在下一期账单列示；原单标记为已退回，跟踪轨迹保留。',
                okText: '确认退货'
            }).then(function (yes) {
                if (!yes) return;
                var res = TMS.order.createReverseOrder(id, { operator: actorName(), reason: '客户申请退货' });
                if (!res.ok) { ui.toast('退货失败：' + (res.message || '原单不可退回'), 'error'); return; }
                ui.toast('已生成退件单 ' + (res.reverse ? res.reverse.waybillNo : '') + '，原单转为已退回', 'success');
            });
        },
        'c:track': function (id) {
            var o = db.get('orders', id);
            var code = o ? o.waybillNo : String(id || '');
            TMS.shell.go('c-tracking', code ? { code: code } : {});
        },
        'c:open': function (id) { if (db.get('orders', id)) pg.openOrder(id); },
        'c:go': function (page) { if (page) TMS.shell.go(page); }
    };

    /* ---------- 公共片段 ---------- */

    function clientFooter(id) {
        var o = db.get('orders', id);
        if (!o) return '';
        var btns = [];
        var terminal = TMS.order.isTerminal(o);
        if (!terminal) {
            btns.push(ui.btn('跟踪这件', { size: 'sm', tone: 'primary', act: 'c:track', arg: o.id }));
            btns.push(ui.btn('改单', { size: 'sm', act: 'c:change', arg: o.id }));
            if (o.status !== 'signed') btns.push(ui.btn('取消', { size: 'sm', tone: 'danger', act: 'c:cancel', arg: o.id }));
        }
        if (o.status === 'signed') btns.push(ui.btn('退货', { size: 'sm', act: 'c:reverse', arg: o.id }));
        btns.push(ui.btn('提交工单', { size: 'sm', act: 'c:ticket', arg: o.id }));
        if (o.status === 'problem' || TMS.order.isSignedLate(o) || o.exceptionCount) {
            btns.push(ui.btn('申请理赔', { size: 'sm', tone: 'danger', act: 'c:claim', arg: o.id }));
        }
        btns.push(ui.btn('再来一单', { size: 'sm', act: 'c:repeat', arg: o.id }));
        var r = TMS.finance.receivableOf(o.id);
        if (r && r.status === 'pending') btns.push(ui.btn('支付运费', { size: 'sm', tone: 'primary', act: 'c:pay', arg: o.id }));
        return '<div class="tms-row">' + btns.join('') + '</div>';
    }

    /* 订单列表：客户看得到运费但看不到成本，操作列只留门户能做的事 */
    function orderGrid(ctx, rows, opts) {
        var o = opts || {};
        var chips = pg.statusChips(rows);
        return po.grid(ctx, {
            rows: rows,
            columns: pg.orderColumns({ hide: ['customer', 'profit', 'stuck'] }).concat([
                {
                    key: 'act', label: '操作', sortable: false, width: '150px', render: function (r) {
                        var b = ui.btn('跟踪', { size: 'sm', tone: 'primary', act: 'c:track', arg: r.id });
                        if (!TMS.order.isTerminal(r)) b += ui.btn('改单', { size: 'sm', act: 'c:change', arg: r.id });
                        if (o.deep) b += ui.btn('详情', { size: 'sm', act: 'c:open', arg: r.id });
                        return b;
                    }
                }
            ]),
            state: ctx.state, keyName: 'id', onRow: 'c:open',
            fields: [
                { key: 'q', type: 'search', label: '单号 / 运单号 / 货物 / 收件人' },
                { key: 'status', label: '状态', options: [{ value: '', label: '全部状态' }].concat(ui.statusOptions()) },
                { key: 'service', label: '服务', options: [{ value: '', label: '全部服务' }].concat(ui.optionsOf(cfg.serviceLevels)) },
                { key: 'payment', label: '付款', options: [{ value: '', label: '全部方式' }].concat(ui.optionsOf(cfg.paymentMethods)) }
            ],
            chips: chips.chips, chipsName: chips.chipsName,
            filter: function (r, fs) {
                if (!pg.orderFilter(r, fs)) return false;
                if (o.only && !o.only(r, fs)) return false;
                if (fs.unpaid) {
                    var rec = TMS.finance.receivableOf(r.id);
                    if (!rec || rec.status === 'paid') return false;
                }
                return true;
            },
            search: function (r) { return [r.id, r.waybillNo, r.goods, r.receiverName, r.receiverAddress, r.origin, r.destination].join(' '); },
            valueOf: function (r, k) { return k === 'chargeableWeight' ? r.chargeableWeight : r[k]; },
            title: o.title, sub: o.sub, emptyText: o.emptyText || '这个筛选条件下没有订单',
            pageSize: o.pageSize || 10,
            tools: o.tools
        });
    }

    function orderKpis(rows) {
        var running = rows.filter(function (o) { return ['created', 'collected', 'inbound', 'sorted', 'transit', 'arrived', 'delivering'].indexOf(o.status) > -1; });
        var late = rows.filter(function (o) { return TMS.order.isLate(o); });
        var problem = rows.filter(function (o) { return o.status === 'problem'; });
        var month = rows.filter(function (o) { return util.monthKey(o.createdAt) === util.monthKey(util.now()); });
        var d = debtStats();
        return ui.kpis([
            { label: '我的订单', value: fmt.number(rows.length), sub: '本月新增 ' + month.length + ' 单' },
            { label: '在途', value: fmt.number(running.length), tone: 'brand', sub: problem.length ? '问题件 ' + problem.length : '全部正常' },
            { label: '超承诺时效', value: fmt.number(late.length), tone: late.length ? 'danger' : 'success', sub: '需联系客服的件' },
            { label: '待付运费', value: fmt.money(d.pending), tone: d.overdueCount ? 'warn' : 'info', sub: d.overdueCount ? '其中逾期 ' + fmt.money(d.overdue) : '无逾期' },
            { label: '可用积分', value: fmt.number(TMS.people.pointsOf(custId()).balance), sub: '签收即返，可换运费' }
        ]);
    }

    /* ---------- 首页 ---------- */

    pg.define('c-home', {
        load: function () {
            var rows = mine();
            return {
                rows: rows,
                running: rows.filter(function (o) { return ['created', 'collected', 'inbound', 'sorted', 'transit', 'arrived', 'delivering'].indexOf(o.status) > -1; }),
                late: rows.filter(function (o) { return TMS.order.isLate(o); }),
                problem: rows.filter(function (o) { return o.status === 'problem'; }),
                feed: myFeed(9),
                debt: debtStats(),
                bills: myBills(),
                tickets: myTickets().filter(function (t) { return t.status !== 'resolved' && t.status !== 'closed'; }),
                claims: myClaims().filter(function (c) { return c.status === 'pending'; }),
                exceptions: myExceptions().slice(0, 8),
                perf: onTimeRate(30),
                series: daily(rows, 30),
                dest: topDest(rows, 30),
                points: TMS.people.pointsOf(custId()),
                c: cust()
            };
        },
        drawerFooter: clientFooter,
        render: function (ctx, d) {
            var openTickets = d.tickets.filter(function (t) { return t.status === 'pending'; }).length;
            return po.wrap(ctx, {
                sub: esc(d.c.name || '客户') + ' · ' + esc(d.c.levelName || '散客') + ' · 客服 ' + esc(d.c.contact || '—') + ' ' + esc(d.c.phone || ''),
                actions: ui.btn('寄件下单', { tone: 'primary', act: 'c:new' }) +
                    ui.btn('查件跟踪', { act: 'c:go', arg: 'c-tracking' }) +
                    ui.btn('联系客服', { act: 'c:ticket', arg: '' }),
                body: [
                    orderKpis(d.rows),
                    ui.split('side', [
                        ui.card({
                            title: '需要我处理', sub: '逾期未付、超时效、问题件与待回复工单', flat: true,
                            body: ui.list([
                                d.debt.overdueCount ? {
                                    title: '逾期未付运费 ' + fmt.money(d.debt.overdue),
                                    sub: d.debt.rows.filter(function (r) { return r.status === 'pending' && util.toDate(r.dueDate) < util.now(); })
                                        .slice(0, 3).map(function (r) { return (r.orderId || '') + ' 账期至 ' + fmt.date(r.dueDate); }).join(' · '),
                                    act: 'c:go', arg: 'c-profile', right: ui.badge('待支付', 'danger')
                                } : null,
                                d.late.length ? {
                                    title: '超过承诺时效 ' + d.late.length + ' 件',
                                    sub: d.late.slice(0, 2).map(function (o) { return o.waybillNo + ' 应于 ' + fmt.dateTime(o.expectedAt); }).join(' · '),
                                    act: 'c:go', arg: 'c-order', right: ui.badge('可理赔评估', 'warn')
                                } : null,
                                d.problem.length ? {
                                    title: '问题件 ' + d.problem.length + ' 件',
                                    sub: d.problem.slice(0, 2).map(function (o) { return o.waybillNo + '：' + esc(o.remark || '待网点处理'); }).join(' · '),
                                    act: 'c:go', arg: 'c-order', right: ui.badge('跟进中', 'danger')
                                } : null,
                                openTickets ? {
                                    title: '客服工单待受理 ' + openTickets + ' 张',
                                    sub: '工单提交后由客服在承诺时限内回复',
                                    act: 'c:go', arg: 'c-profile', right: ui.badge('待回复', 'info')
                                } : null,
                                d.claims.length ? {
                                    title: '理赔审核中 ' + d.claims.length + ' 件',
                                    sub: d.claims.slice(0, 2).map(function (c) { return c.id + ' 申报 ' + fmt.money(c.amount) + '，截止 ' + fmt.date(c.deadline); }).join(' · '),
                                    act: 'c:go', arg: 'c-profile', right: ui.badge('审核中', 'warn')
                                } : null
                            ].filter(Boolean), { empty: '<div class="tms-notice success">没有需要你处理的事项，货物都在正常流转</div>' })
                        }),
                        ui.card({
                            title: '最新作业动态', sub: '揽收/入库/分拣/干线/派送每一次扫描都会进这里', flat: true,
                            tools: ui.link('全部跟踪', 'c:go', 'c-tracking'),
                            body: d.feed.length ? ui.list(d.feed.map(function (x) {
                                var t = x.scan;
                                return {
                                    title: esc(t.nodeName) + ' <span class="tms-mono">' + esc(x.order.waybillNo) + '</span> ' + pg.statusBadge(x.order.status),
                                    sub: esc(t.location || '—') + ' · ' + fmt.dateTime(t.opTime) + ' · ' + esc(t.operator || '系统') +
                                        (t.weight ? ' · ' + fmt.kg(t.weight) : '') + (t.remark ? ' · ' + esc(t.remark) : ''),
                                    act: 'c:open', arg: x.order.id,
                                    right: t.isOvertime ? ui.badge('超时', 'warn') : (t.result && t.result !== 'ok' ? ui.badge(esc(t.result), 'danger') : '')
                                };
                            })) : ui.empty('还没有作业动态', '下单并揽收后这里会逐条出现扫描流水')
                        })
                    ]),
                    ui.card({
                        title: '正在路上的件', sub: '按承诺送达时间排序，最急的在最前', flat: true,
                        tools: ui.link('查看全部订单', 'c:go', 'c-order'),
                        body: d.running.length ? ui.table({
                            dense: true, keyName: 'id', rows: d.running.slice(0, 8), onRow: 'c:open',
                            columns: [
                                { key: 'waybillNo', label: '运单号', render: function (r) { return ui.link(esc(r.waybillNo), 'c:open', r.id); } },
                                { key: 'status', label: '状态', render: function (r) { return pg.statusBadge(r.status); } },
                                { key: 'origin', label: '线路', render: function (r) { return esc(r.origin) + ' → ' + esc(r.destination); } },
                                { key: 'goods', label: '货物', render: function (r) { return esc(r.goods) + ' · ' + fmt.number(r.pieces) + ' 件'; } },
                                { key: 'expectedAt', label: '承诺送达', render: function (r) { return '<span class="tms-nowrap">' + fmt.dateTime(r.expectedAt) + '</span>'; } },
                                {
                                    key: 'last', label: '最新位置', render: function (r) {
                                        var tr = TMS.order.traces(r.id);
                                        var last = tr[tr.length - 1];
                                        return last ? esc(last.nodeName) + ' · ' + esc(last.location || '—') : '<span class="tms-dim">等待揽收</span>';
                                    }
                                },
                                {
                                    key: 'act', label: '操作', sortable: false, render: function (r) {
                                        var b = ui.btn('跟踪', { size: 'sm', tone: 'primary', act: 'c:track', arg: r.id });
                                        if (!TMS.order.isTerminal(r)) b += ui.btn('改单', { size: 'sm', act: 'c:change', arg: r.id });
                                        return b;
                                    }
                                }
                            ]
                        }) : ui.empty('没有运输中的订单', '点右上角「寄件下单」新建一票')
                    }),
                    ui.split('2', [
                        ui.card({
                            title: '近 30 天发货量', sub: '按下单日期统计', flat: true,
                            body: TMS.charts.bars({ data: d.series, height: 200, labelEvery: 5, fmt: function (v) { return fmt.number(v); } })
                        }),
                        ui.card({
                            title: '主要流向', sub: '近 30 天单量与运费', flat: true,
                            body: d.dest.length ? TMS.charts.hbars({ data: d.dest, fmt: function (v) { return fmt.number(v) + ' 单'; }, labelWidth: 84 }) : ui.empty('近 30 天没有发货')
                        })
                    ]),
                    ui.split('3', [
                        ui.card({
                            title: '服务表现', flat: true,
                            body: ui.desc([
                                { label: '近 30 天签收', value: fmt.number(d.perf.signed) + ' 单' },
                                { label: '准时签收率', value: po.rateBar(d.perf.rate, 95) },
                                { label: '迟签', value: fmt.number(d.perf.late) + ' 单' },
                                { label: '异常记录', value: fmt.number(myExceptions().length) + ' 条' },
                                { label: '我的等级', value: ui.badge(esc(d.c.levelName || '散客'), 'info') + ' 折扣 ' + fmt.percent(util.round((d.c.discountRate || 0) * 100, 1)) }
                            ])
                        }),
                        ui.card({
                            title: '我的账单', sub: '账期与对账单', flat: true, tools: ui.link('对账明细', 'c:go', 'c-profile'),
                            body: ui.stack([
                                ui.kpis([
                                    { label: '待付', value: fmt.money(d.debt.pending), tone: d.debt.pending ? 'warn' : 'success' },
                                    { label: '已结清', value: fmt.money(d.debt.paid) }
                                ]),
                                d.bills.length ? ui.list(d.bills.slice(0, 4).map(function (b) {
                                    return {
                                        title: esc(b.billNo) + ' ' + pg.statusBadge(b.status, pg.DOC_TEXT),
                                        sub: esc(b.period) + ' · ' + fmt.number(b.itemCount) + ' 笔 · ' + fmt.money(b.totalAmount) +
                                            '（已收 ' + fmt.money(b.receivedAmount) + '）',
                                        act: 'c:go', arg: 'c-profile'
                                    };
                                })) : ui.empty('还没有生成对账单', '月结单签收后由财务按账期出具')
                            ])
                        }),
                        ui.card({
                            title: '积分与权益', flat: true, tools: ui.link('去兑换', 'c:go', 'c-points'),
                            body: ui.stack([
                                ui.kpis([
                                    { label: '可用积分', value: fmt.number(d.points.balance) },
                                    { label: '累计获取', value: fmt.number(util.sum(d.points.rows.filter(function (p) { return p.points > 0; }), 'points')) }
                                ]),
                                ui.notice('运费每 10 元返 1 分，加急 2 倍、冷链 3 倍；签收即计提，兑换在下页', 'info')
                            ])
                        })
                    ])
                ]
            });
        },
        actions: ACT
    });

    /* ---------- 寄件下单 ---------- */

    pg.define('c-send', {
        load: function (ctx) {
            var p = quoteInput(ctx.state.filters);
            return { p: p, q: quoteOf(p), recent: mine().slice(0, 12), c: cust() };
        },
        drawerFooter: clientFooter,
        render: function (ctx, d) {
            var p = d.p, q = d.q;
            var plan = p.destination && TMS.master.cityByName(p.destination) ? TMS.network.planRoute(p.origin, p.destination, p.service) : null;
            return po.wrap(ctx, {
                sub: '报价按运价卡与路由即时计算，下单后价格与时效就写进单据，客服与网点看到的是同一个数',
                actions: ui.btn('清空试算', { act: 'c:clear' }) +
                    ui.btn('按此方案下单', { tone: 'primary', disabled: !q, act: 'c:new' }),
                body: [
                    ui.card({
                        title: '运费试算', sub: '改动任一参数即时重算，无需提交', flat: true,
                        body: ui.stack([
                            ui.filters(QUOTE_FIELDS, ctx.state.filters, { actions: ui.btn('按此方案下单', { tone: 'primary', disabled: !q, act: 'c:new' }) }),
                            q ? ui.stack([
                                ui.kpis([
                                    { label: '预估运费', value: fmt.money(q.total), tone: 'brand', sub: '首重 ' + fmt.money(q.firstFee) + ' / 续重费率 ' + fmt.money(q.contRate) },
                                    { label: '计费重量', value: fmt.kg(q.chargeableWeight), sub: '实重 ' + fmt.kg(q.actualWeight) + ' · 体积重 ' + fmt.kg(q.volumetricWeight) },
                                    { label: '承诺送达', value: plan ? fmt.duration(plan.slaHours) : '—', sub: plan ? '预计 ' + fmt.dateTime(TMS.network.promiseAt(util.now(), plan, p.service)) : '' },
                                    { label: '干线方式', value: esc(plan ? plan.mode : '—'), sub: plan ? fmt.km(plan.distanceKm) + ' · 中转 ' + Math.max(0, (plan.segments || []).length - 1) + ' 次' : '' }
                                ]),
                                ui.split('side', [
                                    q.breakdown.length > 1 ? ui.card({ title: '计价构成', sub: '运价卡 ' + esc(q.cardName) + ' v' + esc(q.cardVersion) + ' · 折算比 ' + q.throwRatio + ' cm³/kg', flat: true, body: quoteTable(q) })
                                        : ui.card({ title: '计价构成', flat: true, body: ui.notice('运费即首重 + 续重，本单无附加项', 'info') }),
                                    ui.stack([
                                        q.minimumApplied ? ui.notice('本单不足最低收费 ' + fmt.money(q.minCharge) + '，已按最低收费计费', 'warn') : '',
                                        q.minTopUp ? ui.notice('该线路舱位成本较高，报价已补足成本底线 ' + fmt.money(q.minTopUp) + '，实际报价 ' + fmt.money(q.total), 'warn') : '',
                                        q.discount ? ui.notice('客户折扣 ' + fmt.percent(util.round(q.discountRate * 100, 1)) + '，本单已减 ' + fmt.money(q.discount), 'success') : '',
                                        q.remote ? ui.notice('目的地属偏远地区，加收偏远附加费 ' + fmt.money(q.remoteFee), 'info') : '',
                                        p.payment === '到付' && p.cod ? ui.notice('代收货款 ' + fmt.money(p.cod) + '，签收后由派送员上划，服务费 ' + fmt.money(q.codServiceFee), 'info') : '',
                                        ui.notice('试算只读运价卡与线路主数据，不写任何单据；点「按此方案下单」才会建单', 'info')
                                    ].filter(Boolean))
                                ])
                            ]) : ui.notice('填写目的城市即可自动计价（当前服务网络覆盖 ' + TMS.master.CITIES.length + ' 个城市）', 'warn')
                        ])
                    }),
                    ui.card({
                        title: '服务与时效对照', sub: '同一票货四种产品的价格与承诺，差异一目了然', flat: true,
                        body: p.destination && TMS.master.cityByName(p.destination) ? ui.table({
                            dense: true, keyName: 'service', sortable: false, rows: serviceCompare(p),
                            columns: [
                                {
                                    key: 'service', label: '产品', render: function (r) {
                                        return '<b>' + esc(r.service) + '</b>' + (r.onQuote ? ' ' + ui.badge('当前', 'brand') : '');
                                    }
                                },
                                { key: 'total', label: '运费', align: 'right', render: function (r) { return ui.moneyCell(r.total); } },
                                { key: 'diff', label: '与当前差额', align: 'right', render: function (r) { return ui.delta(util.round(r.total - (q ? q.total : 0), 2), { unit: ' 元', digits: 2, invert: true }); } },
                                { key: 'mode', label: '干线', render: function (r) { return ui.badge(esc(r.mode), r.mode === '空运' ? 'warn' : 'muted'); } },
                                { key: 'std', label: '标准时长', align: 'right', render: function (r) { return fmt.duration(r.stdHours); } },
                                { key: 'sla', label: '承诺时长', align: 'right', render: function (r) { return fmt.duration(r.slaHours); } },
                                { key: 'promise', label: '预计送达', render: function (r) { return '<span class="tms-nowrap">' + fmt.dateTime(r.promise) + '</span>'; } },
                                {
                                    key: 'act', label: '操作', sortable: false, render: function (r) {
                                        return r.onQuote ? '<span class="tms-dim">已选</span>'
                                            : ui.btn('改用这个', { size: 'sm', act: 'chip', arg: 'service|' + r.service });
                                    }
                                }
                            ]
                        }) : ui.empty('先填目的城市', '填好后这里列出四种服务的报价与时效')
                    }),
                    ui.card({
                        title: '这票货怎么走', sub: routeScopeSub(plan, p), flat: true,
                        body: plan ? ui.timeline(plan.segments.map(function (s) {
                            var sc = TMS.network.segmentScope(s);
                            return {
                                title: esc(String(s.from)) + ' → ' + esc(String(s.to)),
                                time: pg.LEG_TYPE[s.legType] || s.legType || '中转',
                                body: fmt.km(s.km) + ' · 标准 ' + fmt.duration(s.stdHours) + ' · ' + esc(s.mode || '陆运') +
                                    ' · <span class="tms-dim">跨度 ' + esc(sc.name) + '</span>',
                                tone: 'ok'
                            };
                        })) : ui.empty('等待目的城市', '路由段、中转分拨与标准时长都会在这里列出')
                    }),
                    orderGrid(ctx, d.recent, {
                        title: '我的最近订单', sub: '下单成功后立刻出现在这里，可直接跟踪或改单',
                        emptyText: '还没有下过单', deep: true, pageSize: 8,
                        tools: ui.btn('全部订单', { size: 'sm', act: 'c:go', arg: 'c-order' })
                    })
                ]
            });
        },
        actions: ACT
    });

    /* ---------- 订单列表 ---------- */

    pg.define('c-order', {
        load: function () { return { rows: mine(), debt: debtStats() }; },
        drawerFooter: clientFooter,
        render: function (ctx, d) {
            return po.wrap(ctx, {
                sub: '每张单的运费、账期与轨迹都在这里；改单即时重算，取消即冲销应收',
                actions: ui.btn('寄件下单', { tone: 'primary', act: 'c:new' }) +
                    ui.btn('提交工单', { act: 'c:ticket', arg: '' }),
                body: [
                    orderKpis(d.rows),
                    orderGrid(ctx, d.rows, {
                        title: '全部订单', deep: true, pageSize: 12,
                        tools: ui.chips([
                            { label: '全部', value: '' },
                            { label: '仅看待付', value: 'unpaid', count: d.debt.rows.filter(function (r) { return r.status === 'pending'; }).length }
                        ], { name: 'unpaid', value: ctx.state.filters.unpaid || '' })
                    })
                ]
            });
        },
        actions: ACT
    });

    /* ---------- 货物跟踪 ---------- */

    function findMine(code) {
        var list = myRaw();
        var hit = TMS.order.byCode(code, list);
        if (hit) return hit;
        var key = String(code || '').trim().toUpperCase();
        var fuzzy = list.filter(function (o) { return String(o.goods).toUpperCase().indexOf(key) > -1; });
        return fuzzy.length === 1 ? fuzzy[0] : null;
    }

    pg.define('c-tracking', {
        load: function (ctx) {
            if (ctx.params && ctx.params.code && !ctx.state.filters.code) ctx.state.filters.code = ctx.params.code;
            var code = ctx.state.filters.code;
            var order = findMine(code);
            return {
                code: code, order: order,
                matched: !!String(code || '').trim() && !order,
                running: mine().filter(function (o) { return !TMS.order.isTerminal(o); }),
                recent: mine().slice(0, 10)
            };
        },
        drawerFooter: clientFooter,
        render: function (ctx, d) {
            var o = d.order;
            var last = o ? (TMS.order.traces(o.id).slice(-1)[0] || {}) : {};
            var body = [
                ui.card({
                    title: '运单查询', sub: '只查得到本账号名下的单，其他运单号请联系客服', flat: true, tone: 'brand',
                    body: ui.stack([
                        ui.filters([{
                            key: 'code', type: 'search', label: '运单号 / 订单号', value: d.code,
                            placeholder: 'HL 开头的订单号或 12 位运单号', hint: '输入即查，支持单号片段模糊匹配'
                        }], ctx.state.filters, {
                            actions: ui.btn('查最近一件在途', { act: 'chip', arg: 'code|' + ((d.running[0] || d.recent[0] || {}).waybillNo || '') }) +
                                ui.btn('清空', { act: 'chip', arg: 'code|' })
                        }),
                        d.matched ? ui.notice('没有匹配到「' + esc(String(d.code)) + '」，该单可能不属于当前客户账号，或单号片段命中多张单', 'warn') : ''
                    ])
                })
            ];

            if (!o) {
                body.push(ui.split('side', [
                    ui.card({
                        title: '在途件', sub: '还没签收的都在这儿', flat: true,
                        body: d.running.length ? ui.list(d.running.slice(0, 10).map(function (x) {
                            return {
                                title: esc(x.waybillNo) + ' · ' + esc(x.origin) + ' → ' + esc(x.destination) + ' ' + pg.statusBadge(x.status),
                                sub: '承诺 ' + fmt.dateTime(x.expectedAt) + ' · ' + esc(x.goods) + ' · ' + fmt.number(x.pieces) + ' 件 · ' + fmt.kg(x.chargeableWeight),
                                act: 'chip', arg: 'code|' + x.waybillNo,
                                right: TMS.order.isLate(x) ? ui.badge('已超时', 'danger') : ''
                            };
                        })) : ui.empty('没有运输中的订单')
                    }),
                    ui.card({
                        title: '最近下单', flat: true, tools: ui.link('全部订单', 'c:go', 'c-order'),
                        body: d.recent.length ? ui.list(d.recent.slice(0, 10).map(function (x) {
                            return {
                                title: '<span class="tms-mono">' + esc(x.waybillNo) + '</span> ' + pg.statusBadge(x.status),
                                sub: fmt.dateTime(x.createdAt) + ' · ' + esc(x.goods) + ' · ' + fmt.money(x.freight),
                                act: 'chip', arg: 'code|' + x.waybillNo
                            };
                        })) : ui.empty('还没有订单')
                    })
                ]));
            } else {
                var plan = TMS.network.planOf(o);
                var courier = o.courierId ? db.get('employees', o.courierId) : null;
                var dest = db.get('branches', o.destBranchId) || {};
                var signed = o.status === 'signed';
                body.push(ui.card({
                    title: esc(o.waybillNo), sub: esc(o.origin) + ' → ' + esc(o.destination) + ' · ' + esc(o.goods) + ' ' + fmt.number(o.pieces) + ' 件',
                    badge: pg.statusBadge(o.status), flat: true,
                    tone: TMS.order.isLate(o) ? 'danger' : 'brand',
                    body: ui.stack([
                        pg.statusSteps(o),
                        ui.kpis([
                            { label: '当前节点', value: esc(last.nodeName || '等待揽收') },
                            { label: '当前位置', value: esc(last.location || o.origin) },
                            { label: '承诺送达', value: fmt.dateTime(TMS.order.promiseOf(o)), tone: TMS.order.isLate(o) ? 'danger' : 'success' },
                            { label: '运输距离', value: fmt.km(o.distanceKm), sub: esc(plan ? plan.mode : '—') }
                        ])
                    ])
                }));
                body.push(ui.split('side', [
                    ui.card({ title: '作业轨迹', sub: '扫描流水原样呈现，网点补录也会显示在这里', flat: true, body: pg.traceTimeline(o.id) }),
                    ui.stack([
                        ui.card({
                            title: '收货与派送', flat: true,
                            body: ui.desc([
                                { label: '收件人', value: esc(o.receiverName || '—') + ' ' + esc(o.receiverPhone || '') },
                                { label: '收件地址', value: esc(o.receiverAddress || '—') },
                                { label: '派送网点', value: esc(dest.name || '尚未到件') + (dest.phone ? ' · ' + esc(dest.phone) : '') },
                                courier ? { label: '派送员', value: esc(courier.name) + ' · ' + esc(courier.phone || '') } : '',
                                signed ? { label: '签收', value: esc((o.pod || {}).receiver || '已签收') + ((o.pod || {}).podPhoto ? ' 已上传回单' : ' 无回单照片') + ' · ' + fmt.dateTime(o.signedAt) } : '',
                                { label: '运费', value: ui.moneyCell(o.freight) + ' · ' + esc(o.paymentMethod) },
                                { label: '代收货款', value: Number(o.codAmount) > 0 ? fmt.money(o.codAmount) : '—' }
                            ])
                        }),
                        ui.card({
                            title: '这张单还能做什么', flat: true,
                            body: ui.stack([
                                ui.row([
                                    ui.btn('改单', { act: 'c:change', arg: o.id, disabled: TMS.order.isTerminal(o) }),
                                    ui.btn('取消订单', { tone: 'danger', act: 'c:cancel', arg: o.id, disabled: o.status === 'signed' || o.status === 'cancelled' }),
                                    ui.btn('退货', { act: 'c:reverse', arg: o.id, disabled: o.status !== 'signed' })
                                ]),
                                ui.row([
                                    ui.btn('提交工单', { act: 'c:ticket', arg: o.id }),
                                    ui.btn('申请理赔', { tone: 'danger', act: 'c:claim', arg: o.id }),
                                    ui.btn('再来一单', { act: 'c:repeat', arg: o.id })
                                ]),
                                ui.notice('改单在件进入干线前可直接生效并重算运费；干线后需客服先拦截，退回后重新下单', 'info')
                            ])
                        }),
                        ui.card({ title: '路由计划', sub: '与网点/司机看到的是同一条线', flat: true, body: pg.orderPlanPanel(o, plan) })
                    ])
                ]));
            }

            return po.wrap(ctx, { sub: '轨迹来自各环节扫描流水，节点时刻、地点与终端都会如实记录', actions: ui.btn('寄件下单', { tone: 'primary', act: 'c:new' }), body: body });
        },
        actions: ACT
    });

    /* ---------- 网点查询 ---------- */

    pg.define('c-branch', {
        load: function (ctx) {
            var f = ctx.state.filters || {}, c = cust();
            var kw = String(f.q || '').trim().toLowerCase();
            var city = f.city || c.city || '上海';
            var all = db.col('branches');
            /* 关键字做全网搜索、城市做定点浏览，两者互斥：
               叠加过滤会让「上海 + 某个外地网点名」永远是空集，客户只会以为系统坏了 */
            var list = kw
                ? all.filter(function (b) { return (b.name + b.address + b.city + b.hubName + b.manager).toLowerCase().indexOf(kw) > -1; })
                : all.filter(function (b) { return b.city === city; });
            var scope = kw ? '' : city;
            var usedIds = {};
            mine().slice(0, 60).forEach(function (o) { usedIds[o.originBranchId] = 1; usedIds[o.destBranchId] = 1; });
            var hitCity = f.addr ? (TMS.network.cityOfText(f.addr) || c.city || '') : '';
            return {
                city: scope, rows: list, kw: kw, coord: TMS.master.cityByName(scope),
                fence: TMS.network.fenceOfCity(scope, 'branch'),
                hubs: db.col('hubs').filter(function (h) { return h.status === 'active'; }).length,
                branchTotal: db.col('branches').filter(function (b) { return b.status === 'active'; }).length,
                cityCount: util.unique(all.filter(function (b) { return b.status === 'active'; }).map(function (b) { return b.city; })).length,
                used: Object.keys(usedIds).map(function (id) { return db.get('branches', id); }).filter(Boolean),
                addr: f.addr || '', hitCity: hitCity,
                hit: hitCity ? TMS.network.collectBranch(hitCity, f.addr) : null
            };
        },
        render: function (ctx, d) {
            return po.wrap(ctx, {
                sub: '按发货地址定位揽收网点，按到达城市定位派送网点；网点营业时间决定预约揽收的承诺口径',
                actions: ui.btn('寄件下单', { tone: 'primary', act: 'c:new' }),
                body: [
                    ui.kpis([
                        { label: '在网网点', value: fmt.number(d.branchTotal), sub: '覆盖 ' + d.cityCount + ' 个城市' },
                        { label: '分拨中心', value: fmt.number(d.hubs), sub: '干线由分拨间班次承运' },
                        { label: '我的常用网点', value: fmt.number(d.used.length), sub: '近 60 张单实际收派过' },
                        { label: '本城网点', value: fmt.number(d.rows.length), sub: esc(d.city || '全网') }
                    ]),
                    ui.card({
                        title: '揽收网点定位', sub: '输入发货地址，系统按城市与区域分配揽收营业部', flat: true, tone: 'brand',
                        body: ui.stack([
                            ui.filters([
                                { key: 'addr', label: '发货地址', placeholder: '如：上海市青浦区华徐公路 3567 号' },
                                { key: 'city', label: '城市', type: 'city', value: d.city },
                                { key: 'q', type: 'search', label: '网点名称 / 地址关键字' }
                            ], ctx.state.filters),
                            d.hit ? ui.desc([
                                { label: '识别城市', value: esc(d.hitCity || '未识别，按客户所在城市受理') },
                                { label: '揽收网点', value: '<b>' + esc(d.hit.name) + '</b> · ' + esc(d.hit.type) },
                                { label: '地址', value: esc(d.hit.address) },
                                { label: '电话', value: '<span class="tms-mono">' + esc(d.hit.phone) + '</span> · 主管 ' + esc(d.hit.manager) },
                                { label: '营业时间', value: esc(d.hit.openAt) + '–' + esc(d.hit.closeAt) + ' · 日处理 ' + fmt.number(d.hit.dailyCapacity) + ' 件' },
                                { label: '归属分拨', value: esc(d.hit.hubName) }
                            ], { inline: true }) : ui.notice('还没填地址。同一地址始终分配同一网点，方便固定班车揽收', 'info')
                        ])
                    }),
                    ui.split('side', [
                        ui.card({
                            title: esc(d.city || '搜索结果') + '的网点', sub: '直营网点，均可上门揽收', flat: true,
                            body: ui.table({
                                dense: true, keyName: 'id', rows: d.rows.slice(0, 12),
                                columns: [
                                    {
                                        key: 'name', label: '网点', render: function (b) {
                                            return '<b>' + esc(b.name) + '</b> ' + (b.status === 'active' ? '' : ui.badge('暂停营业', 'muted'));
                                        }
                                    },
                                    { key: 'type', label: '类型', render: function (b) { return ui.badge(esc(b.type), b.type === '直营枢纽网点' ? 'brand' : 'muted'); } },
                                    { key: 'address', label: '地址', render: function (b) { return '<span class="tms-dim">' + esc(b.address) + '</span>'; } },
                                    { key: 'phone', label: '电话', render: function (b) { return '<span class="tms-mono">' + esc(b.phone) + '</span>'; } },
                                    { key: 'open', label: '营业', render: function (b) { return esc(b.openAt) + '–' + esc(b.closeAt); } },
                                    { key: 'cap', label: '日处理', align: 'right', render: function (b) { return fmt.number(b.dailyCapacity) + ' 件'; } },
                                    {
                                        key: 'dist', label: '距发货城市', align: 'right',
                                        render: function (b) { return d.coord ? fmt.km(util.distanceKm(d.coord, b)) : '—'; }
                                    }
                                ],
                                emptyText: '这个城市还没有网点'
                            })
                        }),
                        ui.stack([
                            ui.card({
                                title: '电子围栏覆盖', sub: '揽收与派送范围按围栏几何判定，勾出来的边界才算数', flat: true,
                                body: d.fence ? ui.stack([
                                    ui.desc([
                                        { label: '围栏', value: esc(d.fence.name) },
                                        { label: '边界', value: pg.fenceGeomCell(d.fence) },
                                        { label: '覆盖城市', value: util.unique(TMS.network.citiesInFence(d.fence).map(function (x) { return x.name; })).slice(0, 8).join('、') },
                                        { label: '状态', value: ui.badge(pg.GF_STATUS_TEXT[d.fence.status] || d.fence.status, d.fence.status === 'active' ? 'success' : 'warn') }
                                    ])
                                ]) : ui.empty('该城市暂无在用派送围栏', '范围由运营端与网点在围栏地图上勾画维护')
                            }),
                            ui.card({
                                title: '我的收派网点', sub: '近 60 张单实际使用过', flat: true,
                                body: d.used.length ? ui.list(d.used.slice(0, 8).map(function (b) {
                                    return {
                                        title: esc(b.name),
                                        sub: esc(b.address) + ' · ' + esc(b.phone) + ' · ' + esc(b.hubName),
                                        right: '<span class="tms-dim">' + esc(b.city) + '</span>'
                                    };
                                })) : ui.empty('还没有收派记录')
                            })
                        ])
                    ])
                ]
            });
        },
        actions: ACT
    });

    /* ---------- 我的（档案 / 对账 / 工单 / 理赔） ---------- */

    pg.define('c-profile', {
        load: function () {
            var c = cust(), lv = levelOf();
            var rows = mine();
            var debt = debtStats();
            var usage = c.creditLimit ? util.round(debt.pending / c.creditLimit * 100, 1) : 0;
            var last30 = rows.filter(function (o) { return util.toDate(o.createdAt).getTime() >= util.addDays(util.now(), -29).getTime(); }).length;
            var next = cfg.customerLevels.filter(function (x) { return cfg.customerLevels.indexOf(x) < cfg.customerLevels.indexOf(lv); })
                .sort(function (a, b) { return b.creditLimit - a.creditLimit; })[0];
            return {
                c: c, lv: lv, rows: rows, debt: debt, bills: myBills(),
                tickets: myTickets(), claims: myClaims(), exceptions: myExceptions(),
                perf: onTimeRate(30), usage: usage, next: next, last30: last30
            };
        },
        drawerFooter: clientFooter,
        render: function (ctx, d) {
            var c = d.c;
            return po.wrap(ctx, {
                sub: '档案、账期与售后都在这页：合同与折扣由客户经理核定，联系方式与寄件地址可自行维护',
                actions: ui.btn('维护资料', { tone: 'primary', act: 'c:profile' }) +
                    ui.btn('提交工单', { act: 'c:ticket', arg: '' }),
                body: [
                    ui.split('side', [
                        ui.card({
                            title: esc(c.name || '未建档客户'), badge: ui.badge(esc(c.levelName || '散客'), 'info'), flat: true,
                            sub: esc(c.industry || '—') + ' · ' + esc(c.province || '') + esc(c.city || '') + ' · 客户号 ' + esc(c.id || '—'),
                            body: ui.desc([
                                { label: '主联系人', value: esc(c.contact || '—') + ' · ' + esc(c.phone || '—') },
                                { label: '默认寄件地址', value: esc(c.senderAddress || '—') },
                                { label: '合作开始', value: fmt.date(c.registerAt) + ' · 合同 ' + fmt.date(c.contractFrom) + ' 至 ' + fmt.date(c.contractTo) },
                                { label: '结算周期', value: esc(c.settleCycle || d.lv.settleCycle) + ' · 折扣 ' + fmt.percent(util.round((c.discountRate || 0) * 100, 1)) },
                                { label: '预计月单量', value: fmt.number(c.monthlyVolume) + ' 单' },
                                { label: '合作状态', value: c.status === 'suspended' ? ui.badge('已暂停合作', 'muted') : ui.badge('正常合作', 'success') }
                            ])
                        }),
                        ui.card({
                            title: '信用额度', sub: '占用 = 未核销应收', flat: true,
                            body: ui.stack([
                                ui.kpis([
                                    { label: '额度', value: fmt.money(c.creditLimit || 0) },
                                    { label: '已占用', value: fmt.money(d.debt.pending), tone: d.usage > 80 ? 'danger' : 'info' },
                                    { label: '可用', value: fmt.money(Math.max(0, (c.creditLimit || 0) - d.debt.pending)) }
                                ]),
                                ui.progress(d.usage, { tone: d.usage > 80 ? 'danger' : 'brand' }),
                                d.next ? ui.notice('近 30 天实际发货 ' + fmt.number(d.last30) + ' 单（档案预估 ' + fmt.number(c.monthlyVolume) + ' 单）；连续三个月保持该量级可由客户经理提报升级为 ' +
                                    d.next.name + '（折扣 ' + fmt.percent(util.round(d.next.discount * 100, 1)) + '，额度 ' + fmt.money(d.next.creditLimit) + '）', 'info')
                                    : ui.notice('已是最高等级，续约谈判时可申请更优账期与专项运价', 'success')
                            ])
                        })
                    ]),
                    ui.card({
                        title: '费用与账期', sub: '待付即未核销应收，支持在线支付或月结合并回款', flat: true,
                        tools: ui.link('去下单', 'c:go', 'c-send'),
                        body: ui.stack([
                            ui.kpis([
                                { label: '待付运费', value: fmt.money(d.debt.pending), tone: d.debt.pending ? 'warn' : 'success', sub: d.debt.pendingCount + ' 笔' },
                                { label: '逾期', value: fmt.money(d.debt.overdue), tone: d.debt.overdueCount ? 'danger' : 'muted', sub: d.debt.overdueCount + ' 笔' },
                                { label: '已结清', value: fmt.money(d.debt.paid) },
                                { label: '近 30 天准时率', value: fmt.percent(d.perf.rate), tone: d.perf.rate >= 95 ? 'success' : 'warn', sub: d.perf.signed + ' 单签收' }
                            ]),
                            ui.table({
                                dense: true, keyName: 'id', sortable: false,
                                rows: d.debt.rows.filter(function (r) { return r.status !== 'paid'; }).slice(0, 10),
                                columns: [
                                    { key: 'id', label: '应收单', render: function (r) { return '<span class="tms-mono">' + esc(r.id) + '</span>'; } },
                                    { key: 'orderId', label: '运单', render: function (r) { var o = db.get('orders', r.orderId) || {}; return o.waybillNo ? ui.link(esc(o.waybillNo), 'c:open', r.orderId) : '<span class="tms-dim">—</span>'; } },
                                    { key: 'amount', label: '金额', align: 'right', render: function (r) { return ui.moneyCell(r.amount); } },
                                    { key: 'codAmount', label: '代收货款', align: 'right', render: function (r) { return Number(r.codAmount) > 0 ? fmt.money(r.codAmount) : '<span class="tms-dim">—</span>'; } },
                                    { key: 'dueDate', label: '账期', render: function (r) { return '<span class="tms-nowrap">' + fmt.date(r.dueDate) + '</span>'; } },
                                    { key: 'status', label: '状态', render: function (r) { return pg.statusBadge(r.status, pg.DOC_TEXT); } },
                                    {
                                        key: 'act', label: '操作', sortable: false, render: function (r) {
                                            return r.status === 'pending' && r.orderId
                                                ? ui.btn('支付', { size: 'sm', tone: 'primary', act: 'c:pay', arg: r.orderId })
                                                : '<span class="tms-dim">—</span>';
                                        }
                                    }
                                ],
                                emptyText: '没有未结清的应收'
                            })
                        ])
                    }),
                    ui.card({
                        title: '对账单', sub: '财务按账期出具，账单确认后不可再改单', flat: true,
                        body: d.bills.length ? ui.table({
                            dense: true, keyName: 'id', sortable: false, rows: d.bills.slice(0, 12),
                            columns: [
                                { key: 'billNo', label: '账单号', render: function (b) { return '<span class="tms-mono">' + esc(b.billNo) + '</span>'; } },
                                { key: 'period', label: '账期', render: function (b) { return esc(b.period); } },
                                { key: 'itemCount', label: '笔数', align: 'right', render: function (b) { return fmt.number(b.itemCount); } },
                                { key: 'totalAmount', label: '应结', align: 'right', render: function (b) { return ui.moneyCell(b.totalAmount); } },
                                { key: 'receivedAmount', label: '已收', align: 'right', render: function (b) { return ui.moneyCell(b.receivedAmount); } },
                                {
                                    key: 'gap', label: '未结', align: 'right', render: function (b) {
                                        var gap = util.round(Number(b.totalAmount) - Number(b.receivedAmount), 2);
                                        return gap > 0 ? '<span class="tms-money tone-danger">' + fmt.money(gap) + '</span>' : '<span class="tms-dim">结清</span>';
                                    }
                                },
                                { key: 'status', label: '状态', render: function (b) { return pg.statusBadge(b.status, pg.DOC_TEXT); } },
                                { key: 'dueDate', label: '付款截止', render: function (b) { return fmt.date(b.dueDate); } }
                            ]
                        }) : ui.empty('还没有对账单', '月结客户签收后由财务按账期生成')
                    }),
                    ui.split('2', [
                        ui.card({
                            title: '我的工单', sub: '催件/改址/投诉/发票', flat: true,
                            tools: ui.btn('新建工单', { size: 'sm', tone: 'primary', act: 'c:ticket', arg: '' }),
                            body: d.tickets.length ? ui.table({
                                dense: true, keyName: 'id', sortable: false, rows: d.tickets.slice(0, 10),
                                columns: [
                                    { key: 'id', label: '工单', render: function (t) { return '<span class="tms-mono">' + esc(t.id) + '</span>'; } },
                                    { key: 'type', label: '类型', render: function (t) { return esc(t.type); } },
                                    { key: 'content', label: '诉求', render: function (t) { return '<span class="tms-dim">' + esc(String(t.content || '').slice(0, 26)) + '</span>'; } },
                                    { key: 'status', label: '状态', render: function (t) { return pg.statusBadge(t.status, pg.DOC_TEXT); } },
                                    { key: 'deadline', label: '回复时限', render: function (t) { return fmt.dateTime(t.deadline); } },
                                    { key: 'result', label: '处理结果', render: function (t) { return t.result ? esc(String(t.result).slice(0, 24)) : '<span class="tms-dim">待回复</span>'; } }
                                ]
                            }) : ui.empty('还没有提交过工单', '有催件或改址需求时在这里提，客服按 SLA 回复')
                        }),
                        ui.card({
                            title: '我的理赔', sub: '货损与遗失', flat: true,
                            tools: ui.btn('申请理赔', { size: 'sm', tone: 'danger', act: 'c:claim', arg: '' }),
                            body: d.claims.length ? ui.table({
                                dense: true, keyName: 'id', sortable: false, rows: d.claims.slice(0, 10),
                                columns: [
                                    { key: 'id', label: '理赔单', render: function (c) { return '<span class="tms-mono">' + esc(c.id) + '</span>'; } },
                                    { key: 'type', label: '类型', render: function (c) { return esc(c.type); } },
                                    { key: 'amount', label: '申报/核定', align: 'right', render: function (c) { return ui.moneyCell(c.amount); } },
                                    { key: 'status', label: '状态', render: function (c) { return pg.statusBadge(c.status, pg.DOC_TEXT); } },
                                    { key: 'deadline', label: '审核截止', render: function (c) { return fmt.date(c.deadline); } },
                                    { key: 'auditNote', label: '审核意见', render: function (c) { return c.auditNote ? esc(String(c.auditNote).slice(0, 26)) : '<span class="tms-dim">待 ' + esc(c.handler || '理赔专员') + ' 审核</span>'; } },
                                    { key: 'orderId', label: '运单', sortable: false, render: function (c) { return c.orderId ? ui.link('查看', 'c:open', c.orderId) : '—'; } }
                                ]
                            }) : ui.empty('没有理赔记录', '签收发现货损可当场申请')
                        })
                    ]),
                    ui.card({
                        title: '本账号货物异常', sub: '异常由运营与网点处理，处理结果与责任认定同步给客户', flat: true,
                        body: d.exceptions.length ? ui.list(d.exceptions.slice(0, 10).map(function (e) {
                            var o = db.get('orders', e.orderId) || {};
                            return {
                                title: esc(e.type) + ' <span class="tms-mono">' + esc(o.waybillNo || e.orderId || '') + '</span> ' + pg.statusBadge(e.status, pg.DOC_TEXT),
                                sub: esc(String(e.description || '').slice(0, 40)) + ' · 上报 ' + fmt.dateTime(e.reportedAt) +
                                    (e.resolvedAt ? ' · 闭环 ' + fmt.dateTime(e.resolvedAt) : '') + (e.handler ? ' · 受理 ' + esc(e.handler) : ''),
                                act: e.orderId ? 'c:open' : '', arg: e.orderId,
                                right: TMS.service.isOverdue(e) ? ui.badge('超SLA', 'danger') : (e.slaDeadline ? '<span class="tms-dim">限 ' + fmt.dateTime(e.slaDeadline) + '</span>' : '')
                            };
                        })) : ui.empty('名下货物没有异常记录')
                    })
                ]
            });
        },
        actions: ACT
    });

    /* ---------- 积分 ---------- */

    pg.define('c-points', {
        load: function () {
            var pts = TMS.people.pointsOf(custId());
            var rows = pts.rows.slice().sort(function (a, b) { return String(b.createdAt || '').localeCompare(String(a.createdAt || '')); });
            var earned = util.sum(pts.rows.filter(function (p) { return Number(p.points) > 0; }), 'points');
            var used = Math.abs(util.sum(pts.rows.filter(function (p) { return Number(p.points) < 0; }), 'points'));
            var byMonth = util.groupBy(pts.rows, function (p) { return util.monthKey(p.createdAt || util.now()); });
            var trend = Object.keys(byMonth).sort().slice(-6).map(function (k) {
                return { label: k, value: util.round(util.sum(byMonth[k], 'points'), 0) };
            });
            return {
                c: cust(), lv: levelOf(), balance: pts.balance, earned: earned, used: used,
                rows: rows, trend: trend, orders: mine().slice(0, 40),
                freight: util.money(util.sum(myRaw(), 'freight'))
            };
        },
        render: function (ctx, d) {
            var canRedeem = REDEEM.filter(function (r) { return r.points <= d.balance; });
            return po.wrap(ctx, {
                sub: '运费每 10 元返 1 分，加急 2 倍、冷链 3 倍，签收即计提；兑换即时扣减余额并留负数流水',
                actions: ui.btn('立即兑换', { tone: 'primary', disabled: !canRedeem.length, act: 'c:redeem' }) +
                    ui.btn('寄件赚积分', { act: 'c:go', arg: 'c-send' }),
                body: [
                    ui.kpis([
                        { label: '可用积分', value: fmt.number(d.balance), tone: 'brand' },
                        { label: '累计获取', value: fmt.number(d.earned), sub: d.rows.filter(function (p) { return p.points > 0; }).length + ' 笔' },
                        { label: '累计消耗', value: fmt.number(d.used), sub: d.rows.filter(function (p) { return p.points < 0; }).length + ' 笔' },
                        { label: '累计运费', value: fmt.money(d.freight), sub: '全部历史订单' },
                        { label: '我的等级', value: esc(d.c.levelName || '散客'), sub: '折扣 ' + fmt.percent(util.round((d.c.discountRate || 0) * 100, 1)) }
                    ]),
                    ui.split('side', [
                        ui.card({
                            title: '可兑换', sub: '按当前余额筛选，兑换后由客户经理随单发放', flat: true,
                            body: ui.table({
                                dense: true, keyName: 'name', sortable: false, rows: REDEEM,
                                columns: [
                                    { key: 'name', label: '兑换品', render: function (r) { return '<b>' + esc(r.name) + '</b>'; } },
                                    { key: 'kind', label: '类别', render: function (r) { return ui.badge(esc(r.kind), 'muted'); } },
                                    { key: 'points', label: '所需积分', align: 'right', render: function (r) { return fmt.number(r.points) + ' 分'; } },
                                    {
                                        key: 'ok', label: '状态', render: function (r) {
                                            return r.points <= d.balance ? ui.badge('可兑换', 'success')
                                                : '<span class="tms-dim">还需 ' + fmt.number(r.points - d.balance) + ' 分</span>';
                                        }
                                    }
                                ]
                            })
                        }),
                        ui.stack([
                            ui.card({ title: '月度积分变动', flat: true, body: d.trend.length ? TMS.charts.bars({ data: d.trend, height: 190, fmt: function (v) { return fmt.number(v); } }) : ui.empty('暂无积分变动') }),
                            ui.card({
                                title: '获取规则', flat: true,
                                body: ui.desc([
                                    { label: '计提基准', value: '运费 ÷ 10（向下取整，最低 1 分）' },
                                    { label: '服务加成', value: '标准 ×1 · 加急 ×2 · 冷链 ×3' },
                                    { label: '计提时点', value: '签收即入账，取消/退回不计提' },
                                    { label: '散客', value: 'C 级客户不参与积分，建议升级建档' }
                                ])
                            })
                        ])
                    ]),
                    ui.card({
                        title: '积分流水', sub: '正数为获取、负数为兑换，逐条对应运单', flat: true,
                        body: d.rows.length ? ui.table({
                            dense: true, keyName: 'id', sortable: false,
                            rows: d.rows.slice(0, 20),
                            columns: [
                                { key: 'createdAt', label: '时间', render: function (p) { return '<span class="tms-nowrap">' + fmt.dateTime(p.createdAt) + '</span>'; } },
                                {
                                    key: 'points', label: '变动', align: 'right', render: function (p) {
                                        return Number(p.points) > 0
                                            ? '<span class="tms-money tone-success">+' + fmt.number(p.points) + '</span>'
                                            : '<span class="tms-money tone-danger">-' + fmt.number(Math.abs(p.points)) + '</span>';
                                    }
                                },
                                { key: 'reason', label: '事由', render: function (p) { return esc(p.reason || '消费返积分'); } },
                                {
                                    key: 'orderId', label: '关联运单', render: function (p) {
                                        var o = p.orderId ? db.get('orders', p.orderId) : null;
                                        return o ? ui.link(esc(o.waybillNo), 'c:open', o.id) : '<span class="tms-dim">—</span>';
                                    }
                                }
                            ]
                        }) : ui.empty('还没有积分流水', '签收第一票货后即产生积分')
                    })
                ]
            });
        },
        actions: ACT
    });
})(window);
