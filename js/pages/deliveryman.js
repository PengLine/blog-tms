/* 派送员端：一个骑手的收入、绩效和货损责任全押在「今天签了多少、有没有按时、POD 齐不齐」上，
   所以这一端只回答三个问题——下一单送哪儿、这一单怎么签、签完的钱怎么交回去。
   代收货款不上划就是骑手个人欠公司的钱，所以「上划」和「签收」一样是必须按的按钮。 */
(function (global) {
    'use strict';

    var TMS = global.TMS = global.TMS || {};
    var util = TMS.util, ui = TMS.ui, db = TMS.db, pg = TMS.pages, po = TMS.portal;
    var esc = util.esc, fmt = util.fmt;
    var ROLE = 'deliveryman';

    /* ---------- 我这一份口径 ---------- */

    function sess() { return po.session(); }
    function pid() { return sess().personId || (po.me() || {}).id || ''; }
    function orgId() { return sess().orgId || ''; }
    function branch() { return db.get('branches', orgId()) || {}; }
    function name() { return po.actor(sess()); }
    function today() { return util.dateKey(util.now()); }

    /* 我名下的单：courierId 是我；待领取的是「到了我网点但还没人认领」的件 */
    function mine() { return pg.scopedOrders(sess()); }

    function atMyBranch(list) {
        return (list || mine()).filter(function (o) { return o.destBranchId === orgId(); });
    }

    function claimable() {
        return db.col('orders').filter(function (o) {
            return o.destBranchId === orgId() && o.status === 'arrived' && !o.courierId;
        }).map(TMS.order.view);
    }

    function todoCollect() {
        return db.col('orders').filter(function (o) {
            return o.originBranchId === orgId() && o.status === 'created';
        }).map(TMS.order.view);
    }

    /* 我揽走的件：认扫描流水上的揽收节点，不认「我是不是这单的派送员」——
       同一个人上门取件和末端送件是两桩活，取件时间只有 GOT 流水说了算 */
    function collectedByMe(days) {
        var cutoff = util.addDays(util.now(), -((days || 1) - 1)).getTime();
        var gotAt = {};
        db.col('scans').forEach(function (s) {
            if (s.node === 'GOT' && s.operator === name() && util.toDate(s.opTime).getTime() >= cutoff) gotAt[s.orderId] = s.opTime;
        });
        return db.col('orders').filter(function (o) { return gotAt[o.id]; })
            .map(function (o) {
                var v = TMS.order.view(o);
                v.gotAt = gotAt[o.id];
                return v;
            })
            .sort(function (a, b) { return String(b.gotAt).localeCompare(String(a.gotAt)); });
    }

    /* 代收货款：codRecords 上的 courier 是名字，稳妥起见按「我的单」反查 */
    function myCod() {
        var ids = {};
        db.col('orders').forEach(function (o) { if (o.courierId === pid()) ids[o.id] = true; });
        return db.col('codRecords').filter(function (r) {
            return ids[r.orderId] || r.courier === name();
        }).sort(function (a, b) { return String(b.collectedAt).localeCompare(String(a.collectedAt)); });
    }

    function myExceptions(days) {
        var cutoff = util.addDays(util.now(), -(days || 30)).getTime(), s = sess();
        var ids = {};
        db.col('orders').forEach(function (o) { if (o.courierId === pid() || o.originBranchId === orgId()) ids[o.id] = true; });
        return db.col('exceptions').filter(function (e) {
            return e.reportedAt && util.toDate(e.reportedAt).getTime() >= cutoff &&
                (ids[e.orderId] || e.reporter === s.name || e.responsible === s.name);
        }).sort(function (a, b) { return String(b.reportedAt).localeCompare(String(a.reportedAt)); });
    }

    /* 片区：收件地址上的第一个行政区划就是骑手嘴里的「片区」，不另建一张表 */
    function districtOf(o) {
        var addr = String(o.receiverAddress || '');
        var m = addr.match(/[\u4e00-\u9fa5]{2,6}(区|县|市)/);
        return m ? m[0] : (o.destination || '未知') + '城区';
    }

    function rowActions(r) {
        var out = po.stageButtons(r, ROLE);
        if (r.status === 'problem') out += ui.btn('退回', { size: 'sm', tone: 'danger', act: 'd:reverse', arg: r.id });
        if (r.status === 'delivering' && Number(r.codAmount) > 0) out += ui.btn('货款', { size: 'sm', act: 'd:cod', arg: r.id });
        return out;
    }

    function orderGrid(ctx, rows, opts) {
        var o = opts || {};
        var chips = pg.statusChips(rows);
        return po.grid(ctx, {
            rows: rows,
            columns: pg.orderColumns({ hide: o.hide || ['profit', 'customer'] }).concat([
                { key: 'act', label: '操作', sortable: false, width: '150px', render: o.rowActions || rowActions }
            ]),
            state: ctx.state, keyName: 'id', onRow: 'd:open',
            fields: pg.orderFields({ searchLabel: o.searchLabel || '单号 / 收件人 / 地址', hidePayment: true }),
            chips: chips.chips, chipsName: chips.chipsName,
            filter: function (r, fs) { return pg.orderFilter(r, fs) && (!o.only || o.only(r, fs)); },
            search: function (r) { return [r.id, r.waybillNo, r.receiverName, r.receiverAddress, r.goods, r.customer].join(' '); },
            title: o.title, sub: o.sub, tools: o.tools, pageSize: o.pageSize,
            emptyText: o.emptyText || '这个筛选下没有件'
        });
    }

    /* ---------- 动作 ---------- */

    function collectOrderModal(customerId) {
        var b = branch();
        var pool = db.col('customers').filter(function (c) { return c.status === 'active' && (!b.city || c.city === b.city); });
        ui.formModal({
            title: '上门揽收开单', sub: '骑手上门取件：现场按实际重量计价，揽收即建应收，回网点入库复重',
            size: 'lg',
            fields: [
                {
                    key: 'customerId', label: '客户', options: [{ value: '', label: '散客（无档案）' }].concat(
                        pool.map(function (c) { return { value: c.id, label: c.name + '（' + c.levelName + '）' }; })),
                    value: customerId || '', tip: '选客户自动带出地址与结算方式'
                },
                { key: 'service', label: '服务', type: 'select', placeholder: false, options: ui.optionsOf(TMS.cfg.serviceLevels), value: '标准' },
                { key: 'destination', label: '目的城市', type: 'city', required: true },
                { key: 'goods', label: '品名', value: '文件', required: true },
                { key: 'pieces', label: '件数', type: 'number', min: 1, value: 1, required: true },
                { key: 'weight', label: '申报重量', type: 'number', unit: 'kg', min: 0.1, value: 3, required: true, tip: '现场复磅后按实重计价' },
                { key: 'dims', label: '外包装尺寸', placeholder: '长x宽x高（cm），多件用 / 分隔' },
                { key: 'paymentMethod', label: '付款方式', type: 'select', placeholder: false, options: ui.optionsOf(TMS.cfg.paymentMethods), value: '现付' },
                { key: 'codAmount', label: '代收货款', type: 'number', unit: '元', min: 0, when: 'paymentMethod=到付' },
                { key: 'contact', label: '寄件联系人' },
                { key: 'phone', label: '寄件电话' },
                { key: 'senderAddress', label: '取件地址', span: 2, value: b.address || '' },
                { key: 'receiverName', label: '收件人' },
                { key: 'receiverPhone', label: '收件电话' },
                { key: 'receiverAddress', label: '收件地址', span: 2 },
                { key: 'remark', label: '备注', type: 'textarea', span: 2, placeholder: '如件数多需带纸箱、需带发票' }
            ],
            okText: '开单并取件',
            onSubmit: function (v) {
                var cust = v.customerId ? db.get('customers', v.customerId) : null;
                var res = TMS.order.create({
                    customerId: v.customerId, origin: b.city || v.destination, destination: v.destination,
                    goods: v.goods, pieces: v.pieces, weight: v.weight, dims: v.dims,
                    service: v.service, paymentMethod: v.paymentMethod, codAmount: v.codAmount,
                    contact: v.contact || (cust ? cust.contact : ''), phone: v.phone || (cust ? cust.phone : ''),
                    senderAddress: v.senderAddress || (cust ? cust.senderAddress : ''),
                    receiverName: v.receiverName, receiverPhone: v.receiverPhone, receiverAddress: v.receiverAddress,
                    remark: v.remark, actor: name(), channel: '快递员上门'
                });
                if (!res.ok) return '开单失败：' + res.message;
                var got = TMS.order.collect(res.order.id, {
                    operator: name(), device: po.device(sess()), actualWeight: v.weight,
                    note: '上门揽收' + (v.remark ? '：' + v.remark : '')
                });
                if (!got || !got.ok) return '开单成功但揽收失败：' + (got && got.message || '');
                ui.toast('已取件 ' + res.order.waybillNo + '，运费 ' + fmt.money(res.order.freight) + '，回网点入库', 'success');
            }
        });
    }

    var ACT = (function () {
        var out = {};
        [po.workActions, po.clockActions, po.exActions].forEach(function (src) {
            Object.keys(src).forEach(function (k) { out[k] = src[k]; });
        });
        var extra = {
            'd:new': collectOrderModal,
            'd:contact': function (customerId) { collectOrderModal(customerId); },
            'd:claim': function (id) { po.assignModal(id); },
            'd:sign': function (id) { po.signModal(id); },
            'd:report': function (id) { po.problemModal(id); },
            'd:reverse': function (id) {
                var o = db.get('orders', id);
                if (!o) { ui.toast('订单不存在', 'error'); return; }
                ui.confirm({
                    title: '拒收/退回 · ' + esc(o.waybillNo),
                    message: '原单标记退回，并按反向路线生成退件单，退货运费现付。',
                    detail: '客户拒收要先进异常工单留原因；已收现金的必须先把代收货款上划，退回才不冲资金账。',
                    okText: '确认退回'
                }).then(function (yes) {
                    if (!yes) return;
                    po.run('退回', TMS.order.createReverseOrder(id, { operator: name(), reason: '末端拒收退回' }));
                });
            },
            'd:cod': function (orderId) {
                var rec = db.findOne('codRecords', function (r) { return r.orderId === orderId; });
                if (!rec) { ui.toast('这张单没有代收货款记录', 'warn'); return; }
                po.refresh();
                ui.toast(rec.remitStatus === 'remitted' ? '货款已于 ' + fmt.dateTime(rec.remittedAt) + ' 上划' : '请到「派送」页代收货款区上划', rec.remitStatus === 'remitted' ? 'success' : 'warn');
            },
            'd:remit': function (id) {
                var r = db.get('codRecords', id);
                if (!r) { ui.toast('代收记录不存在', 'error'); return; }
                if (r.remitStatus === 'remitted') { ui.toast('该笔已上划', 'warn'); return; }
                ui.confirm({
                    title: '代收货款上划',
                    message: '将「' + esc(r.waybillNo) + '」代收 ' + fmt.money(r.goodsValue) + ' 上划给发货方 ' + esc(r.shipper || '客户') + '。',
                    detail: '净额 ' + fmt.money(r.netPayable) + '（扣服务费 ' + fmt.money(r.serviceFee) + '）计一笔往来支出，服务费同时确认收入。',
                    okText: '确认上划'
                }).then(function (yes) {
                    if (!yes) return;
                    var res = TMS.finance.remitCOD(id, name());
                    if (!res) { ui.toast('上划失败', 'error'); return; }
                    ui.toast('已上划，现金账与资金流水同步入账', 'success');
                });
            },
            'd:remitAll': function () {
                var pend = myCod().filter(function (r) { return r.remitStatus !== 'remitted'; });
                if (!pend.length) { ui.toast('没有待上划的代收货款', 'warn'); return; }
                ui.confirm({
                    title: '批量上划代收货款',
                    message: '共 ' + pend.length + ' 笔，净额合计 ' + fmt.money(util.sum(pend, 'netPayable')) + '。',
                    detail: '逐笔落往来支出与服务费收入；已上划的自动跳过，不会重复开账。',
                    okText: '全部上划'
                }).then(function (yes) {
                    if (!yes) return;
                    var done = 0;
                    pend.forEach(function (r) { if (TMS.finance.remitCOD(r.id, name())) done++; });
                    ui.toast('已上划 ' + done + ' 笔', done ? 'success' : 'warn');
                });
            },
            'd:open': function (id) { if (id) pg.openOrder(id); },
            'd:go': function (page) { if (page) TMS.shell.go(page); }
        };
        Object.keys(extra).forEach(function (k) { out[k] = extra[k]; });
        return out;
    })();

    /* 异常台额外挂客服工单动作：代客建单与受理结单在同一页闭环 */
    var ACT_WITH_TICKETS = (function () {
        var out = {};
        Object.keys(ACT).forEach(function (k) { out[k] = ACT[k]; });
        Object.keys(po.ticketActions).forEach(function (k) { out[k] = po.ticketActions[k]; });
        return out;
    })();

    /* ---------- 工作台 ---------- */

    pg.define('d-home', {
        load: function () {
            var rows = mine();
            var run = rows.filter(function (o) { return o.status === 'delivering'; });
            var signed = rows.filter(function (o) { return o.status === 'signed' && util.dateKey(TMS.order.stageAt(o, 'signed')) === today(); });
            var cod = myCod();
            var pend = cod.filter(function (r) { return r.remitStatus !== 'remitted'; });
            return {
                claim: claimable(), run: run, signed: signed,
                collect: todoCollect(), cod: cod, pend: pend,
                exceptions: myExceptions(14),
                rec: TMS.people.todayRecord(pid()),
                emp: po.me() || {}, b: branch()
            };
        },
        drawerFooter: function (id) { return po.footerFor(ROLE, id); },
        render: function (ctx, d) {
            var canIn = !d.rec || !d.rec.clockIn;
            var nextStop = d.run.concat(d.claim).sort(function (a, b) { return String(a.expectedAt).localeCompare(String(b.expectedAt)); });
            return po.wrap(ctx, {
                sub: esc(d.b.name || '派送网点') + ' · ' + esc(d.emp.position || '派送员') + ' ' + esc(name()) +
                    ' · 待领 ' + d.claim.length + ' 件',
                actions: ui.btn(canIn ? '上班打卡' : '已打卡', { tone: canIn ? 'primary' : 'default', act: 'clock:in', disabled: !canIn }) +
                    ui.btn('揽收开单', { act: 'd:new' }),
                body: [
                    po.todayStrip(mine().concat(d.claim), ROLE),
                    ui.card({
                        title: '今日派送顺序', sub: '按承诺时效排队，先送快要超时的', tools: ui.link('全部任务', 'd:go', 'd-tasks'), flat: true,
                        body: po.taskCards(nextStop.slice(0, 6), ROLE, { emptyText: '今天没有待派送件', emptySub: '到件在「进港」交接后会自动出现在这里' })
                    }),
                    ui.split('side', [
                        ui.card({
                            title: '到件待领取', sub: '到了我网点、还没人认领', tools: ui.btn('批量看', { size: 'sm', act: 'd:go', arg: 'd-tasks' }), flat: true,
                            body: d.claim.length ? ui.list(d.claim.slice(0, 6).map(function (o) {
                                return {
                                    title: esc(o.waybillNo) + ' · ' + esc(o.receiverName || '收件人') + ' ' + pg.statusBadge(o.status),
                                    sub: esc(districtOf(o)) + '｜' + esc(o.receiverAddress || '') + '｜承诺 ' + fmt.dateTime(o.expectedAt),
                                    act: 'd:open', arg: o.id,
                                    right: ui.btn('领取', { size: 'sm', tone: 'primary', act: 'd:claim', arg: o.id })
                                };
                            })) : ui.empty('没有待领取的件')
                        }),
                        ui.card({
                            title: '代收货款', sub: '签收收的现金必须上划，否则挂在我个人名下', tools: ui.btn('全部上划', { size: 'sm', tone: 'primary', act: 'd:remitAll' }), flat: true,
                            body: d.pend.length ? ui.stack([
                                ui.kpis([
                                    { label: '待上划', value: fmt.money(util.sum(d.pend, 'netPayable')), tone: 'danger', sub: d.pend.length + ' 笔' },
                                    { label: '已上划', value: fmt.money(util.sum(d.cod.filter(function (r) { return r.remitStatus === 'remitted'; }), 'netPayable')), tone: 'success' }
                                ]),
                                ui.list(d.pend.slice(0, 5).map(function (r) {
                                    return {
                                        title: esc(r.waybillNo) + ' · ' + fmt.money(r.netPayable),
                                        sub: esc('代收 ' + fmt.money(r.goodsValue) + '｜服务费 ' + fmt.money(r.serviceFee) + '｜' + esc(r.shipper || '散客')) ,
                                        act: 'd:open', arg: r.orderId,
                                        right: ui.btn('上划', { size: 'sm', tone: 'primary', act: 'd:remit', arg: r.id })
                                    };
                                }))
                            ]) : ui.empty('没有待上划的货款', '签收含代收款的单后会自动挂到这里')
                        })
                    ]),
                    ui.card({
                        title: '待揽收预约', sub: '客户下单等上门取件', tools: ui.link('揽收台', 'd:go', 'd-collection'), flat: true,
                        body: d.collect.length ? ui.list(d.collect.slice(0, 5).map(function (o) {
                            return {
                                title: esc(o.waybillNo) + ' · ' + esc(o.customer || '散客') + '（' + fmt.number(o.pieces) + ' 件 / ' + fmt.kg(o.weight) + '）',
                                sub: esc(o.senderAddress || o.origin) + '｜' + esc(o.contact || '') + ' ' + esc(o.phone || ''),
                                act: 'd:open', arg: o.id,
                                right: ui.btn('上门揽收', { size: 'sm', tone: 'primary', act: 'work:collect', arg: o.id })
                            };
                        })) : ui.empty('没有待揽收的预约件')
                    }),
                    ui.card({
                        title: '我的异常', sub: '近 14 天，跟催即升级到运营主管', tools: ui.link('异常台', 'd:go', 'd-exception'), flat: true,
                        body: ui.list(d.exceptions.slice(0, 5).map(function (e) {
                            return {
                                title: esc(e.type) + ' · ' + pg.statusBadge(e.status, pg.DOC_TEXT) + (TMS.service.isOverdue(e) ? ' ' + ui.badge('SLA 超时', 'danger') : ''),
                                sub: esc(fmt.dateTime(e.reportedAt)) + '｜' + esc(e.description || ''),
                                act: e.orderId ? 'd:open' : '', arg: e.orderId,
                                right: e.orderId ? ui.link('运单', 'd:open', e.orderId) : ''
                            };
                        }), { empty: '近 14 天我手上没有异常' })
                    })
                ]
            });
        },
        actions: ACT
    });

    /* ---------- 派送任务 ---------- */

    pg.define('d-tasks', {
        load: function (ctx) {
            var seg = ctx.state.seg || 'run';
            var rows = mine();
            var claim = claimable();
            var signedDays = mine().filter(function (o) {
                var at = TMS.order.stageAt(o, 'signed');
                return o.status === 'signed' && at && util.dateKey(at) >= util.dateKey(util.addDays(util.now(), -6));
            });
            var map = {
                run: rows.filter(function (o) { return o.status === 'delivering'; }),
                claim: claim,
                signed: signedDays,
                problem: rows.filter(function (o) { return o.status === 'problem'; })
            };
            return {
                seg: seg, rows: map[seg] || [], counts: {
                    run: map.run.length, claim: claim.length, signed: map.signed.length, problem: map.problem.length
                },
                signed7: map.signed, cod: myCod(), late: rows.filter(function (o) { return TMS.order.isLate(o); })
            };
        },
        drawerFooter: function (id) { return po.footerFor(ROLE, id); },
        render: function (ctx, d) {
            var pod = d.signed7.filter(function (o) { return o.pod && o.pod.podPhoto; }).length;
            var onTime = d.signed7.filter(function (o) { return !TMS.order.isSignedLate(o); }).length;
            var pend = d.cod.filter(function (r) { return r.remitStatus !== 'remitted'; });
            return po.wrap(ctx, {
                sub: '领取 → 派送 → POD 签收 → 代收货款上划，四步都走完这张单才算真正闭环',
                badge: ui.seg([
                    { value: 'run', label: '派送中 ' + d.counts.run },
                    { value: 'claim', label: '待领取 ' + d.counts.claim },
                    { value: 'signed', label: '近 7 天签收 ' + d.counts.signed },
                    { value: 'problem', label: '问题件 ' + d.counts.problem }
                ], d.seg),
                body: [
                    ui.kpis([
                        { label: '派送中', value: d.counts.run, unit: '单', tone: 'warn', sub: '待签收' },
                        { label: '近 7 天签收', value: d.counts.signed, unit: '单', tone: 'success', sub: '一次妥投 ' + fmt.percent(d.signed7.length ? onTime / d.signed7.length * 100 : 100) },
                        { label: 'POD 完整率', value: fmt.percent(d.signed7.length ? pod / d.signed7.length * 100 : 0), tone: 'brand', sub: pod + ' / ' + d.signed7.length + ' 单有回单照片' },
                        { label: '货款待上划', value: fmt.money(util.sum(pend, 'netPayable')), tone: pend.length ? 'danger' : 'muted', sub: pend.length + ' 笔' }
                    ]),
                    d.seg === 'signed' ? po.grid(ctx, {
                        rows: d.rows, keyName: 'id', title: '签收记录', sub: '时效与 POD 直接进绩效，缺照片只影响 POD 完整率',
                        columns: [
                            { key: 'waybillNo', label: '运单', render: function (o) { return ui.idCell(o.id, 'd:open', { short: true }); } },
                            { key: 'receiverName', label: '签收人', render: function (o) { return esc((o.pod && o.pod.receiver) || o.receiverName || '—'); } },
                            { key: 'pod', label: '回单', render: function (o) { return o.pod && o.pod.podPhoto ? ui.badge('照片齐全', 'success') : ui.badge('缺照片', 'warn'); } },
                            { key: 'expectedAt', label: '承诺', render: function (o) { return '<span class="tms-nowrap">' + fmt.dateTime(o.expectedAt) + '</span>'; } },
                            {
                                key: 'timing', label: '时效', render: function (o) {
                                    return TMS.order.isSignedLate(o) ? ui.badge('超时签收', 'danger') : ui.badge('准时', 'success');
                                }
                            },
                            { key: 'codAmount', label: '代收', align: 'right', render: function (o) { return Number(o.codAmount) ? ui.moneyCell(o.codAmount) : '<span class="tms-dim">—</span>'; } },
                            { key: 'remit', label: '货款状态', render: function (o) { return codState(o); } },
                            { key: 'freight', label: '运费', align: 'right', render: function (o) { return ui.moneyCell(o.freight); } },
                            { key: 'signedAt', label: '签收时间', render: function (o) { return ui.timeCell(TMS.order.stageAt(o, 'signed')); } }
                        ],
                        search: function (o) { return [o.id, o.waybillNo, o.receiverName, o.goods].join(' '); },
                        valueOf: function (o, k) { return k === 'signedAt' ? TMS.order.stageAt(o, 'signed') : o[k]; },
                        pageSize: 10, emptyText: '近 7 天没有签收'
                    }) : d.seg === 'claim' ? orderGrid(ctx, d.rows, {
                        title: '到件待领取', sub: '网点进港后件即在此排队，领取后承诺时效开始追我',
                        rowActions: function (r) {
                            return ui.btn('领取派送', { size: 'sm', tone: 'primary', act: 'd:claim', arg: r.id }) +
                                ui.btn('上报异常', { size: 'sm', act: 'd:report', arg: r.id });
                        },
                        emptyText: '没有待领取的到件'
                    }) : d.seg === 'problem' ? orderGrid(ctx, d.rows, {
                        title: '问题件', sub: '闭环需运营端受理，可跟催升级；确认无法投递的走退回',
                        tools: ui.btn('上报异常', { size: 'sm', tone: 'danger', act: 'd:report', arg: '' }),
                        emptyText: '手上没有问题件'
                    }) : ui.stack([
                        orderGrid(ctx, d.rows, {
                            title: '派送中', sub: '按承诺时效排序，签收即结算',
                            tools: ui.btn('按路线排序查看', { size: 'sm', act: 'd:go', arg: 'd-areas' }),
                            emptyText: '没有派送中的件', emptySub: '在「待领取」页领用后即进入派送中'
                        }),
                        ui.card({
                            title: '超时风险', sub: '已过承诺时间仍未签收，客户投诉与考核扣分都从这里起', flat: true,
                            body: d.late.length ? po.taskCards(d.late.slice(0, 5), ROLE, { emptyText: '没有超时件' }) : ui.empty('没有超时件', '时效全部在承诺内')
                        }),
                        ui.card({
                            title: '代收货款台账', sub: '签收收的现金挂在台账，上划后进资金流水并与发货方结清',
                            tools: ui.btn('全部上划', { size: 'sm', tone: 'primary', act: 'd:remitAll' }), flat: true,
                            body: po.grid(ctx, {
                                rows: d.cod, keyName: 'id',
                                columns: [
                                    { key: 'waybillNo', label: '运单', render: function (r) { return ui.idCell(r.orderId, 'd:open', { short: true }); } },
                                    { key: 'shipper', label: '发货方', render: function (r) { return esc(r.shipper || '散客'); } },
                                    { key: 'goodsValue', label: '代收额', align: 'right', render: function (r) { return ui.moneyCell(r.goodsValue); } },
                                    { key: 'serviceFee', label: '服务费', align: 'right', render: function (r) { return fmt.money(r.serviceFee); } },
                                    { key: 'netPayable', label: '应上划', align: 'right', render: function (r) { return '<b>' + fmt.money(r.netPayable) + '</b>'; } },
                                    { key: 'collectedAt', label: '收款时间', render: function (r) { return ui.timeCell(r.collectedAt); } },
                                    { key: 'remitStatus', label: '状态', render: function (r) { return pg.statusBadge(r.remitStatus, pg.DOC_TEXT); } },
                                    {
                                        key: 'act', label: '操作', sortable: false, render: function (r) {
                                            return r.remitStatus === 'remitted'
                                                ? '<span class="tms-dim">' + fmt.dateTime(r.remittedAt) + ' 已上划</span>'
                                                : ui.btn('上划', { size: 'sm', tone: 'primary', act: 'd:remit', arg: r.id });
                                        }
                                    }
                                ],
                                search: function (r) { return [r.waybillNo, r.shipper, r.consignee].join(' '); },
                                pageSize: 6, emptyText: '没有代收货款记录'
                            })
                        })
                    ])
                ]
            });
        },
        actions: ACT
    });

    function codState(o) {
        if (!Number(o.codAmount)) return '<span class="tms-dim">无代收</span>';
        var r = db.findOne('codRecords', function (x) { return x.orderId === o.id; });
        if (!r) return ui.badge('未建台账', 'warn');
        return r.remitStatus === 'remitted' ? ui.badge('已上划', 'success') : ui.badge('待上划', 'danger');
    }

    /* ---------- 揽收台 ---------- */

    pg.define('d-collection', {
        load: function () {
            var wait = todoCollect();
            var got = collectedByMe(7);
            var todayGot = got.filter(function (o) { return util.dateKey(TMS.order.stageAt(o, 'collected')) === today(); });
            return {
                wait: wait, got: got, todayGot: todayGot,
                inbound: got.filter(function (o) { return o.status === 'collected'; }),
                declared: util.round(util.sum(got, 'weight'), 2),
                charged: util.round(util.sum(got, 'chargeableWeight'), 2),
                freight: util.money(util.sum(got, 'freight'))
            };
        },
        drawerFooter: function (id) { return po.footerFor(ROLE, id); },
        render: function (ctx, d) {
            var diff = util.round(d.charged - d.declared, 2);
            return po.wrap(ctx, {
                sub: '上门取件即计价：现场复磅与申报不符按实重重开应收，回网点入库才算交给分拨',
                actions: ui.btn('揽收开单', { tone: 'primary', act: 'd:new' }),
                body: [
                    ui.kpis([
                        { label: '待揽收预约', value: d.wait.length, unit: '单', tone: d.wait.length ? 'warn' : 'success', sub: '客户等上门' },
                        { label: '近 7 天揽收', value: d.got.length, unit: '单', tone: 'brand', sub: '今日 ' + d.todayGot.length + ' 单' },
                        { label: '揽收运费', value: fmt.money(d.freight), tone: 'info', sub: '开单即挂应收' },
                        { label: '计重偏差', value: fmt.kg(diff), tone: diff > 0.01 ? 'warn' : 'muted', sub: '计费重 ' + fmt.kg(d.charged) + ' / 申报 ' + fmt.kg(d.declared) }
                    ]),
                    orderGrid(ctx, d.wait, {
                        title: '待揽收预约', sub: '按下单时间排队，超时未取件会计入网点揽收时效',
                        rowActions: function (r) {
                            return ui.btn('上门揽收', { size: 'sm', tone: 'primary', act: 'work:collect', arg: r.id }) +
                                ui.btn('复磅揽收', { size: 'sm', act: 'work:weigh', arg: r.id }) +
                                ui.btn('异常', { size: 'sm', tone: 'danger', act: 'd:report', arg: r.id });
                        },
                        emptyText: '没有待揽收的预约件', emptySub: '点右上「揽收开单」可为散客现场开单'
                    }),
                    orderGrid(ctx, d.inbound, {
                        title: '已揽收待入库', sub: '件在我手上，回网点点入库称重才交给分拨',
                        rowActions: function (r) {
                            return ui.btn('入库称重', { size: 'sm', tone: 'primary', act: 'work:inbound', arg: r.id }) +
                                ui.btn('复磅', { size: 'sm', act: 'work:weigh', arg: r.id });
                        },
                        emptyText: '没有已揽收待入库的件'
                    }),
                    ui.card({
                        title: '近 7 天揽收记录', sub: '取件时间来自扫描流水，申报与计费重的差即复磅调整', flat: true,
                        body: po.grid(ctx, {
                            rows: d.got, keyName: 'id',
                            columns: [
                                { key: 'waybillNo', label: '运单', render: function (o) { return ui.idCell(o.id, 'd:open', { short: true }); } },
                                { key: 'customer', label: '客户', render: function (o) { return esc(o.customer || '散客'); } },
                                { key: 'destination', label: '去向', render: function (o) { return esc(o.destination); } },
                                { key: 'goods', label: '品名/件', render: function (o) { return esc(o.goods) + ' · ' + fmt.number(o.pieces) + ' 件'; } },
                                { key: 'weight', label: '申报', align: 'right', render: function (o) { return fmt.kg(o.weight); } },
                                { key: 'chargeableWeight', label: '计费', align: 'right', render: function (o) { return fmt.kg(o.chargeableWeight); } },
                                { key: 'freight', label: '运费', align: 'right', render: function (o) { return ui.moneyCell(o.freight); } },
                                { key: 'status', label: '进度', render: function (o) { return pg.statusBadge(o.status); } },
                                { key: 'got', label: '取件时间', render: function (o) { return ui.timeCell(TMS.order.stageAt(o, 'collected')); } }
                            ],
                            search: function (o) { return [o.id, o.waybillNo, o.customer, o.goods].join(' '); },
                            pageSize: 8, dense: true, emptyText: '近 7 天没有揽收记录'
                        })
                    })
                ]
            });
        },
        actions: ACT
    });

    /* ---------- 异常台 ---------- */

    pg.define('d-exception', {
        load: function () {
            var rows = myExceptions(60);
            var open = rows.filter(function (e) { return ['pending', 'processing', 'escalated'].indexOf(e.status) > -1; });
            var closed = rows.filter(function (e) { return ['resolved', 'closed'].indexOf(e.status) > -1; });
            return {
                rows: rows, open: open, closed: closed,
                overdue: rows.filter(TMS.service.isOverdue),
                problems: mine().filter(function (o) { return o.status === 'problem'; }),
                tickets: db.col('tickets').filter(function (t) {
                    var o = t.orderId ? db.get('orders', t.orderId) : null;
                    return (o && (o.courierId === pid() || o.destBranchId === orgId())) || t.customer === name();
                }).sort(function (a, b) { return String(b.createdAt || b.deadline).localeCompare(String(a.createdAt || a.deadline)); })
            };
        },
        drawerFooter: function (id) { return po.footerFor(ROLE, id); },
        render: function (ctx, d) {
            return po.wrap(ctx, {
                sub: '上报即挂起主状态：运营端闭环才放行，跟催升级走主管队列，破损可发起理赔',
                actions: ui.btn('上报异常', { tone: 'danger', act: 'd:report', arg: '' }),
                body: [
                    ui.kpis([
                        { label: '未闭环', value: d.open.length, unit: '件', tone: d.open.length ? 'warn' : 'success', sub: '待受理/处理中/已升级' },
                        { label: 'SLA 超时', value: d.overdue.length, unit: '件', tone: d.overdue.length ? 'danger' : 'muted', sub: '一级 2 小时、二级 6 小时' },
                        { label: '手上问题件', value: d.problems.length, unit: '单', tone: d.problems.length ? 'danger' : 'muted', sub: '主状态已挂起' },
                        { label: '近 60 天已闭环', value: d.closed.length, unit: '件', tone: 'info', sub: '含方案与扣责' }
                    ]),
                    po.grid(ctx, {
                        rows: d.open.concat(d.closed), keyName: 'id', title: '我的异常工单', sub: '我上报的与我派送件的，都按上报时间倒序',
                        columns: po.exceptionColumns(),
                        search: function (e) { return [e.type, e.waybillNo, e.orderId, e.description, e.handler].join(' '); },
                        filter: function (e, fs) { return !fs.st || (['pending', 'processing', 'escalated'].indexOf(e.status) > -1 ? e.status : 'closed') === fs.st; },
                        fields: [
                            { key: 'q', type: 'search', label: '运单 / 类型 / 描述' },
                            {
                                key: 'st', label: '状态', options: [
                                    { value: '', label: '全部' }, { value: 'pending', label: '待受理' },
                                    { value: 'processing', label: '处理中' }, { value: 'escalated', label: '已升级' }, { value: 'closed', label: '已闭环' }
                                ]
                            }
                        ],
                        pageSize: 8, emptyText: '没有异常工单', emptySub: '派送现场发现问题，点右上「上报异常」建单'
                    }),
                    ui.split('side', [
                        ui.card({
                            title: '我手上的问题件', sub: '放行需运营端闭环，退回由我发起逆向单', flat: true,
                            body: d.problems.length ? po.taskCards(d.problems.slice(0, 6), ROLE, { emptyText: '没有问题件' }) : ui.empty('没有问题件')
                        }),
                        ui.card({
                            title: '客户工单', sub: '催件/改址/投诉，受理并回复即结单', tools: ui.btn('代客建单', { size: 'sm', act: 'cs:new' }), flat: true,
                            body: d.tickets.length ? ui.table({
                                dense: true, keyName: 'id', rows: d.tickets.slice(0, 8), sortable: false,
                                columns: [
                                    { key: 'id', label: '工单', render: function (t) { return '<span class="tms-mono">' + esc(t.id) + '</span>'; } },
                                    { key: 'type', label: '类型', render: function (t) { return esc(t.type); } },
                                    { key: 'content', label: '诉求', render: function (t) { return '<span class="tms-nowrap">' + dim(t.content) + '</span>'; } },
                                    { key: 'priority', label: '优先级', render: function (t) { return ui.badge(esc(t.priority), t.priority === '高' ? 'danger' : t.priority === '中' ? 'warn' : 'muted'); } },
                                    { key: 'status', label: '状态', render: function (t) { return pg.statusBadge(t.status, pg.DOC_TEXT); } },
                                    {
                                        key: 'act', label: '操作', render: function (t) {
                                            if (t.status === 'pending') return ui.btn('受理', { size: 'sm', act: 'cs:accept', arg: t.id });
                                            if (t.status === 'processing') return ui.btn('结单', { size: 'sm', tone: 'primary', act: 'cs:resolve', arg: t.id });
                                            return '<span class="tms-dim">已结单</span>';
                                        }
                                    }
                                ]
                            }) : ui.empty('没有关联的客户工单')
                        })
                    ])
                ]
            });
        },
        actions: ACT_WITH_TICKETS
    });

    function dim(v) { return po.dim(v); }

    /* ---------- 责任区域 ---------- */

    pg.define('d-areas', {
        load: function () {
            var b = branch(), city = b.city || '';
            var rows = mine().concat(atMyBranch(db.col('orders').filter(function (o) { return o.destBranchId === orgId(); }).map(TMS.order.view)));
            var byDistrict = util.groupBy(rows, districtOf);
            var districts = Object.keys(byDistrict).map(function (k) {
                var list = byDistrict[k];
                var signed = list.filter(function (o) { return o.status === 'signed'; });
                return {
                    district: k, orders: list.length,
                    pieces: util.sum(list, 'pieces'), weight: util.round(util.sum(list, 'chargeableWeight'), 1),
                    revenue: util.money(util.sum(signed, 'freight')),
                    onTime: signed.length ? util.round(signed.filter(function (o) { return !TMS.order.isSignedLate(o); }).length / signed.length * 100, 1) : 100,
                    exceptions: list.filter(function (o) { return o.status === 'problem'; }).length,
                    late: list.filter(function (o) { return TMS.order.isLate(o); }).length,
                    top: (list[0] || {}).receiverAddress || ''
                };
            }).sort(function (a, b2) { return b2.orders - a.orders; });
            var mates = db.col('employees').filter(function (e) {
                return e.role === 'deliveryman' && e.status === 'active' && e.orgId === orgId();
            }).map(function (e) {
                var list = db.col('orders').filter(function (o) { return o.courierId === e.id; });
                var signed = list.filter(function (o) { return o.status === 'signed'; });
                return {
                    id: e.id, name: e.name, phone: e.phone, city: e.city, position: e.position,
                    orders: list.length, signed: signed.length,
                    onTime: signed.length ? util.round(signed.filter(function (o) { return !TMS.order.isSignedLate(o); }).length / signed.length * 100, 1) : 0
                };
            }).sort(function (a, b2) { return b2.signed - a.signed; });
            return {
                b: b, fence: TMS.network.fenceOfCity(city), districts: districts, mates: mates,
                peers: TMS.stats.orgStats(orgId(), 30), hub: db.get('hubs', b.hubId) || {},
                customers: db.col('customers').filter(function (c) { return c.city === city && c.status === 'active'; })
            };
        },
        drawerFooter: function (id) { return po.footerFor(ROLE, id); },
        render: function (ctx, d) {
            var f = d.fence;
            return po.wrap(ctx, {
                sub: '片区来自收件地址的行政区划，围栏用于判定「扫描地点是不是在我的城市」，不是给我划地盘',
                body: [
                    ui.card({
                        title: '责任网点与围栏', sub: esc(d.b.name || '—'), flat: true,
                        body: ui.desc([
                            { label: '网点', value: esc(d.b.name || '—') + '（' + esc(d.b.code || orgId()) + '）' },
                            { label: '归属分拨', value: esc(d.hub.name || '—') + ' · ' + esc(d.hub.city || '') },
                            { label: '服务范围', value: esc(d.b.city || '') + ' ' + esc(d.b.province || '') + ' · ' + esc(d.b.zone || '') + '区' },
                            { label: '营业时间', value: esc(d.b.openAt || '—') + ' – ' + esc(d.b.closeAt || '—') },
                            { label: '日处理能力', value: fmt.number(d.b.dailyCapacity || 0) + ' 件' },
                            { label: '电子围栏', value: f ? esc(f.name) + ' · 半径 ' + fmt.number(Math.round((f.radiusM || 0) / 100) / 10) + ' km · 告警 ' + fmt.number(f.alertCount || 0) + ' 次' : '<span class="tms-dim">该城市没有生效围栏</span>' },
                            { label: '近 30 天经手', value: fmt.number(d.peers.orders) + ' 单 · 及时率 ' + fmt.percent(d.peers.onTimeRate) },
                            { label: '片区同事', value: fmt.number(d.mates.length) + ' 名派送员' }
                        ], { inline: true })
                    }),
                    ui.card({
                        title: '我的片区画像', sub: '按收件地址行政区划聚合，含时效与异常密度', flat: true,
                        body: po.grid(ctx, {
                            rows: d.districts, keyName: 'district',
                            columns: [
                                { key: 'district', label: '片区', render: function (r) { return '<b>' + esc(r.district) + '</b>'; } },
                                { key: 'orders', label: '单量', align: 'right', render: function (r) { return fmt.number(r.orders) + ' 单'; } },
                                { key: 'pieces', label: '件/重', align: 'right', render: function (r) { return fmt.number(r.pieces) + ' 件 / ' + fmt.kg(r.weight); } },
                                { key: 'revenue', label: '收入', align: 'right', render: function (r) { return ui.moneyCell(r.revenue); } },
                                { key: 'onTime', label: '及时率', render: function (r) { return po.rateBar(r.onTime, 95); } },
                                { key: 'late', label: '超时', align: 'right', render: function (r) { return r.late ? ui.badge(r.late + ' 单', 'danger') : '<span class="tms-dim">0</span>'; } },
                                { key: 'exceptions', label: '问题件', align: 'right', render: function (r) { return r.exceptions ? ui.badge(r.exceptions + ' 单', 'warn') : '<span class="tms-dim">0</span>'; } },
                                { key: 'top', label: '样例地址', render: function (r) { return '<span class="tms-dim">' + esc(String(r.top || '').slice(0, 22)) + '</span>'; } }
                            ],
                            search: function (r) { return r.district; },
                            valueOf: function (r, k) { return r[k]; },
                            pageSize: 8, emptyText: '我名下还没有派送记录'
                        })
                    }),
                    ui.split('side', [
                        ui.card({
                            title: '同网点派送员', sub: '派送量与及时率同期口径', flat: true,
                            body: ui.table({
                                dense: true, keyName: 'id', rows: d.mates, sortable: false,
                                columns: [
                                    { key: 'name', label: '派送员', render: function (m) { return esc(m.name) + (m.id === pid() ? ' ' + ui.badge('本人', 'brand') : ''); } },
                                    { key: 'position', label: '岗位', render: function (m) { return dim(m.position); } },
                                    { key: 'orders', label: '经手', align: 'right', render: function (m) { return fmt.number(m.orders) + ' 单'; } },
                                    { key: 'signed', label: '签收', align: 'right', render: function (m) { return fmt.number(m.signed) + ' 单'; } },
                                    { key: 'onTime', label: '及时率', render: function (m) { return po.rateBar(m.onTime, 95); } },
                                    { key: 'phone', label: '电话', render: function (m) { return dim(m.phone); } }
                                ]
                            })
                        }),
                        ui.card({
                            title: '片区客户', sub: '同城在册客户，点「上门揽收」直接开单', tools: ui.link('通讯录', 'd:go', 'd-contacts'), flat: true,
                            body: ui.list(d.customers.slice(0, 8).map(function (c) {
                                return {
                                    title: esc(c.name) + ' ' + ui.badge(esc(c.levelName || c.level), 'muted'),
                                    sub: esc(c.contact || '') + ' ' + esc(c.phone || '') + '｜' + esc(c.senderAddress || c.city),
                                    act: 'd:contact', arg: c.id,
                                    right: ui.btn('揽收', { size: 'sm', tone: 'primary', act: 'd:contact', arg: c.id })
                                };
                            }), { empty: '同城没有在册客户' })
                        })
                    ])
                ]
            });
        },
        actions: ACT
    });

    /* ---------- 客户通讯录 ---------- */

    pg.define('d-contacts', {
        load: function () {
            var ids = {};
            mine().forEach(function (o) { if (o.customerId) ids[o.customerId] = (ids[o.customerId] || 0) + 1; });
            atMyBranch(db.col('orders').filter(function (o) { return o.destBranchId === orgId(); }).map(TMS.order.view)).forEach(function (o) {
                if (o.customerId) ids[o.customerId] = (ids[o.customerId] || 0) + 1;
            });
            var rows = db.col('customers').filter(function (c) { return ids[c.id]; }).map(function (c) {
                var orders = db.col('orders').filter(function (o) { return o.customerId === c.id && (o.courierId === pid() || o.destBranchId === orgId() || o.originBranchId === orgId()); });
                var signed = orders.filter(function (o) { return o.status === 'signed'; });
                var rec = db.findOne('codRecords', function (r) { return r.shipperId === c.id; });
                return {
                    id: c.id, name: c.name, level: c.levelName || c.level, contact: c.contact, phone: c.phone,
                    address: c.senderAddress || c.city, settleCycle: c.settleCycle, status: c.status,
                    hits: ids[c.id], orders: orders.length, signed: signed.length,
                    revenue: util.money(util.sum(signed, 'freight')),
                    lastAt: (orders.slice().sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); })[0] || {}).createdAt || '',
                    codPending: rec && rec.remitStatus !== 'remitted' ? rec.netPayable : 0,
                    points: Number(c.points) || 0
                };
            }).sort(function (a, b) { return b.orders - a.orders; });
            return { rows: rows, me: po.me() || {} };
        },
        drawerFooter: function (id) { return po.footerFor(ROLE, id); },
        render: function (ctx, d) {
            return po.wrap(ctx, {
                sub: '通讯录只列与我发生过业务的客户：上门揽收、催件回复、货款对账都从这一页起步',
                actions: ui.btn('揽收开单', { tone: 'primary', act: 'd:new' }),
                body: [
                    ui.kpis([
                        { label: '联系客户', value: d.rows.length, unit: '家', tone: 'brand', sub: '与我有单据往来' },
                        { label: 'KA/重点', value: d.rows.filter(function (c) { return c.level === '战略客户' || c.level === '重点客户'; }).length, unit: '家', tone: 'info' },
                        { label: '月结客户', value: d.rows.filter(function (c) { return c.settleCycle === '月结'; }).length, unit: '家', tone: 'muted', sub: '运费挂账不现收' },
                        { label: '待付货款', value: fmt.money(util.sum(d.rows, 'codPending')), tone: 'warn', sub: '代收未上划部分' }
                    ]),
                    po.grid(ctx, {
                        rows: d.rows, keyName: 'id', title: '我的客户', sub: '近 7 天/全量单量按我能看到的单据统计',
                        columns: [
                            { key: 'name', label: '客户', render: function (c) { return '<b>' + esc(c.name) + '</b>'; } },
                            { key: 'level', label: '等级', render: function (c) { return ui.badge(esc(c.level || '散客'), c.level === '战略客户' ? 'danger' : c.level === '重点客户' ? 'warn' : 'muted'); } },
                            { key: 'contact', label: '联系人', render: function (c) { return esc(c.contact || '—'); } },
                            { key: 'phone', label: '电话', render: function (c) { return '<span class="tms-mono">' + esc(c.phone || '—') + '</span>'; } },
                            { key: 'address', label: '地址', render: function (c) { return '<span class="tms-dim">' + esc(String(c.address || '').slice(0, 24)) + '</span>'; } },
                            { key: 'orders', label: '单量', align: 'right', render: function (c) { return fmt.number(c.orders) + ' 单'; } },
                            { key: 'signed', label: '签收', align: 'right', render: function (c) { return fmt.number(c.signed) + ' 单'; } },
                            { key: 'revenue', label: '收入', align: 'right', render: function (c) { return ui.moneyCell(c.revenue); } },
                            { key: 'lastAt', label: '最近往来', render: function (c) { return c.lastAt ? ui.timeCell(c.lastAt) : '<span class="tms-dim">—</span>'; } },
                            { key: 'status', label: '状态', render: function (c) { return pg.statusBadge(c.status, pg.DOC_TEXT); } },
                            {
                                key: 'act', label: '操作', sortable: false, render: function (c) {
                                    return ui.btn('上门揽收', { size: 'sm', tone: 'primary', act: 'd:contact', arg: c.id });
                                }
                            }
                        ],
                        fields: [
                            { key: 'q', type: 'search', label: '客户 / 联系人 / 电话' },
                            {
                                key: 'level', label: '等级', options: [{ value: '', label: '全部等级' }].concat(
                                    util.unique(d.rows.map(function (c) { return c.level; })).filter(Boolean).map(function (l) { return { value: l, label: l }; }))
                            }
                        ],
                        filter: function (c, fs) { return !fs.level || c.level === fs.level; },
                        search: function (c) { return [c.name, c.contact, c.phone, c.address].join(' '); },
                        pageSize: 10, emptyText: '还没有客户往来', emptySub: '揽收开单选客户后即进入通讯录'
                    })
                ]
            });
        },
        actions: ACT
    });

    /* ---------- 打卡 / 排班 / 绩效 ---------- */

    pg.define('d-clock', po.clockDef());
    pg.define('d-performance', po.perfDef());
})(window);
