/* 网点端（营业部）：一个网点的一天只关心三件事——
   件有没有从我这儿出去、外面的件有没有到我这儿、到我这儿的件有没有按时送到客户手里。
   所以进出港是主场，库存与异常是配套，经营页只是把同一批事实按钱再读一遍。
   业务规则一律在 TMS.order / TMS.operation 里，这一层只做「取我这份 + 给该按的按钮」 */
(function (global) {
    'use strict';

    var TMS = global.TMS = global.TMS || {};
    var util = TMS.util, ui = TMS.ui, db = TMS.db, pg = TMS.pages, po = TMS.portal;
    var esc = util.esc, fmt = util.fmt;
    var ROLE = 'branch';

    /* ---------- 本网点口径 ---------- */

    function sess() { return po.session(); }
    function orgId() { return sess().orgId || ''; }
    function branch() { return db.get('branches', orgId()) || {}; }
    function hubId() { return branch().hubId || ''; }
    function today() { return util.dateKey(util.now()); }

    function allOrders() { return pg.scopedOrders(sess()); }
    function outs(list) { return (list || allOrders()).filter(function (o) { return o.originBranchId === orgId(); }); }
    function ins(list) { return (list || allOrders()).filter(function (o) { return o.destBranchId === orgId(); }); }

    /* 网点手上的活：出港件看自己有没有交接干净，进港件看有没有及时派出去 */
    function todoList(list) {
        return (list || allOrders()).filter(function (o) {
            if (o.status === 'problem') return o.originBranchId === orgId() || o.destBranchId === orgId();
            if (['created', 'collected', 'inbound', 'sorted'].indexOf(o.status) > -1) return o.originBranchId === orgId();
            if (['arrived', 'delivering'].indexOf(o.status) > -1) return o.destBranchId === orgId();
            return false;
        });
    }

    function didToday(o, stage) {
        var at = TMS.order.stageAt(o, stage);
        return !!at && util.dateKey(at) === today();
    }

    /* 车次按本网点归属分拨取，只给「今天要发/刚到我场」的两拨 */
    function hubTrips(days) {
        var hub = hubId(), cutoff = util.dateKey(util.addDays(util.now(), -(days || 1)));
        return db.col('transports').filter(function (t) {
            return (t.fromHub === hub || t.toHub === hub) && String(t.date) >= cutoff;
        }).map(TMS.operation.tripView)
            .sort(function (a, b) { return String(b.date + b.departAt).localeCompare(String(a.date + a.departAt)); });
    }

    function tripLine(t) {
        return pg.hubName(t.fromHub) + ' → ' + (t.toHub ? pg.hubName(t.toHub) : t.toCity || '支线') ;
    }

    function loadingTask(trId) {
        return db.findOne('loadingTasks', function (t) { return t.transportId === trId && t.status !== 'done'; });
    }

    /* ---------- 动作 ---------- */

    function newOrderModal() {
        var b = branch();
        var pool = db.col('customers').filter(function (c) { return c.status === 'active'; });
        ui.formModal({
            title: '上门揽收开单', sub: '网点代客下单：按运价卡即时计价，开单即建应收，揽收即入流程',
            size: 'lg',
            fields: [
                { key: 'customerId', label: '客户', type: 'select', options: ui.optionsOf(pool, 'id', 'name'), value: (pool[0] || {}).id, tip: '散客可留空' },
                { key: 'service', label: '服务', type: 'select', placeholder: false, options: ui.optionsOf(TMS.cfg.serviceLevels), value: '标准' },
                { key: 'origin', label: '始发城市', type: 'city', value: b.city || '上海', required: true },
                { key: 'destination', label: '目的城市', type: 'city', required: true },
                { key: 'goods', label: '品名', value: '文件', required: true },
                { key: 'pieces', label: '件数', type: 'number', min: 1, value: 1, required: true },
                { key: 'weight', label: '重量', type: 'number', unit: 'kg', min: 0.1, value: 5, required: true },
                { key: 'dims', label: '外包装尺寸', placeholder: '长x宽x高（cm），多件用 / 分隔' },
                { key: 'paymentMethod', label: '付款方式', type: 'select', placeholder: false, options: ui.optionsOf(TMS.cfg.paymentMethods), value: '现付' },
                { key: 'codAmount', label: '代收货款', type: 'number', unit: '元', min: 0, when: 'paymentMethod=到付' },
                { key: 'declaredValue', label: '保价金额', type: 'number', unit: '元', min: 0 },
                { key: 'senderAddress', label: '寄件地址', span: 2, value: b.address || '' },
                { key: 'receiverName', label: '收件人' },
                { key: 'receiverPhone', label: '收件电话' },
                { key: 'receiverAddress', label: '收件地址', span: 2 },
                { key: 'remark', label: '备注', type: 'textarea', span: 2 }
            ],
            okText: '开单并揽收',
            onSubmit: function (v) {
                var res = TMS.order.create({
                    customerId: v.customerId, origin: v.origin, destination: v.destination,
                    goods: v.goods, pieces: v.pieces, weight: v.weight, dims: v.dims,
                    service: v.service, paymentMethod: v.paymentMethod, codAmount: v.codAmount,
                    declaredValue: v.declaredValue, isInsured: !!v.declaredValue,
                    senderAddress: v.senderAddress, receiverName: v.receiverName,
                    receiverPhone: v.receiverPhone, receiverAddress: v.receiverAddress,
                    remark: v.remark, actor: po.actor(sess()), channel: '网点代客'
                });
                if (!res.ok) return '开单失败：' + res.message;
                var id = res.order.id;
                TMS.order.collect(id, { operator: po.actor(sess()), device: po.device(sess()), actualWeight: v.weight, note: '网点上门揽收' });
                ui.toast('已开单并揽收 ' + res.order.waybillNo + '，运费 ' + fmt.money(res.order.freight), 'success');
            }
        });
    }

    function cancelModal(id) {
        var o = db.get('orders', id);
        if (!o) { ui.toast('订单不存在', 'error'); return; }
        ui.formModal({
            title: '取消订单 · ' + o.waybillNo,
            sub: o.status === 'signed' ? '已签收不可取消，请走退货' : '取消即冲销应收；已在干线上的件同时发起拦截退回',
            danger: true,
            fields: [
                { key: 'reason', label: '取消原因', type: 'select', placeholder: false, options: ui.optionsOf(['客户取消', '地址不可达', '违禁品', '重复下单', '客户拒付运费']), value: '客户取消' },
                { key: 'note', label: '补充说明', type: 'textarea', span: 2 }
            ],
            okText: '确认取消',
            onSubmit: function (v) {
                var res = TMS.order.cancel(id, { reason: v.reason + (v.note ? '：' + v.note : ''), operator: po.actor(sess()) });
                if (!po.run('取消', res)) return '取消失败：' + (res && res.message || '');
                if (res.intercepted) ui.toast('该件已在干线，已生成拦截退回工单', 'warn');
            }
        });
    }

    function changeModal(id) {
        var o = db.get('orders', id);
        if (!o) { ui.toast('订单不存在', 'error'); return; }
        ui.formModal({
            title: '改单 · ' + o.waybillNo,
            sub: '改地址/服务即时重算运价，差额自动进应收调整；干线后改单需先拦截',
            fields: [
                { key: 'destination', label: '目的城市', type: 'city', value: o.destination },
                { key: 'receiverAddress', label: '收件地址', value: o.receiverAddress || '', span: 2 },
                { key: 'receiverName', label: '收件人', value: o.receiverName || '' },
                { key: 'receiverPhone', label: '收件电话', value: o.receiverPhone || '' },
                { key: 'service', label: '服务', type: 'select', options: ui.optionsOf(TMS.cfg.serviceLevels), value: o.service },
                { key: 'weight', label: '重量', type: 'number', unit: 'kg', value: o.weight },
                { key: 'note', label: '改单说明', type: 'textarea', span: 2 }
            ],
            okText: '保存并重算运费',
            onSubmit: function (v) {
                var res = TMS.order.change(id, {
                    destination: v.destination, receiverAddress: v.receiverAddress, receiverName: v.receiverName,
                    receiverPhone: v.receiverPhone, service: v.service, weight: v.weight,
                    note: v.note, operator: po.actor(sess())
                });
                if (!res.ok) return '改单失败：' + res.message;
                ui.toast('改单完成，运费变动 ' + fmt.money(res.delta), 'success');
            }
        });
    }

    /* 出港交接：已分拣件挂到同向车次。
       先拼载「同日同向还没发的车次」，装不下或没有班才新建，避免一城开出五个半空车 */
    function loadOrder(id) {
        var o = db.get('orders', id);
        if (!o) { ui.toast('订单不存在', 'error'); return; }
        if (o.tripId) { ui.toast('该单已挂 ' + ((db.get('transports', o.tripId) || {}).id || o.tripId), 'warn'); return; }
        if (o.status !== 'sorted') { ui.toast('需先分拣落格才能装车交接', 'warn'); return; }
        var hub = o.hubFrom || hubId();
        var ride = db.col('transports').filter(function (t) {
            return t.fromHub === hub && t.toHub === o.hubTo && ['pending', 'loading'].indexOf(t.status) > -1 &&
                (Number(t.weight) || 0) + Number(o.chargeableWeight || 0) <= TMS.operation.capacityOf(t);
        })[0];
        var res;
        if (ride) {
            o.tripId = ride.id;
            db.touch('orders');
            TMS.operation.recalcTrip(ride);
            db.commit('transports', ride.id, 'trip:attach');
            res = { ok: true, transport: ride, attached: true };
        } else {
            var trip = TMS.network.tripFor(hub, o.hubTo);
            res = TMS.operation.createTrip({
                tripId: trip ? trip.id : '', fromHub: hub, toHub: o.hubTo, orderIds: [id]
            });
        }
        if (!po.run('装车交接', res)) return ui.toast('装车失败：' + (res && res.message || '无可用车次'), 'error');
        ui.toast('已挂入 ' + TMS.operation.labelOf(res.transport) + '，等司机发车', 'success');
    }

    function requisitionModal(materialId) {
        var wh = db.findOne('warehouses', function (w) { return w.hubId === hubId(); }) || db.col('warehouses')[0] || {};
        if (!wh.id) { ui.toast('本网点归属分拨没有仓位档案', 'error'); return; }
        var mats = db.col('materials').filter(function (m) { return m.status !== 'obsolete'; });
        ui.formModal({
            title: '包材领用', sub: '领用即出库：库存行、流水台账、物料档案三张表一起改，少改一张就是假账',
            fields: [
                { key: 'materialId', label: '物料', type: 'select', placeholder: false, options: ui.optionsOf(mats, 'id', 'name'), value: materialId || (mats[0] || {}).id },
                { key: 'qty', label: '领用数量', type: 'number', min: 1, value: 1, required: true },
                { key: 'reason', label: '用途', value: '网点日常揽收包材' }
            ],
            okText: '确认领用',
            onSubmit: function (v) {
                /* 库存三张表的写入只有一份实现（运营端「仓储库存」），
                   网点端再抄一遍就会抄出两套账实口径 */
                var res = TMS.pages.admin.postMovement({
                    kind: 'out', warehouseId: wh.id, materialId: v.materialId,
                    qty: Number(v.qty), reason: v.reason, operator: po.actor(sess()), link: orgId()
                });
                if (!res.ok) return '领用失败：' + res.message;
                var m = db.get('materials', v.materialId) || {};
                ui.toast('已出库 ' + m.name + ' ' + v.qty + ' ' + (m.unit || '') + '，现存 ' + m.stock, 'success');
            }
        });
    }

    var ACT = (function () {
        var out = {};
        [po.workActions, po.exActions, po.ticketActions].forEach(function (src) {
            Object.keys(src).forEach(function (k) { out[k] = src[k]; });
        });
        var extra = {
            'b:new': newOrderModal,
            'b:cancel': cancelModal,
            'b:change': changeModal,
            'b:reverse': function (id) {
                var o = db.get('orders', id);
                if (!o) return;
                ui.confirm({
                    title: '生成逆向退货件',
                    message: '运单 ' + esc(o.waybillNo) + ' 将原单标记退回，并按反向路线新建一张退件单。',
                    detail: '退件运费现付，原单应收冲销后进理赔/退回台账；正向件的在途扫描不受影响。',
                    okText: '确认退货'
                }).then(function (yes) {
                    if (!yes) return;
                    po.run('退货', TMS.order.createReverseOrder(id, { operator: po.actor(sess()), reason: '网点受理退货' }));
                });
            },
            'b:load': loadOrder,
            'b:dispatch': function () {
                var hub = hubId();
                var res = TMS.operation.dispatch(hub, { minOrders: 1 });
                if (!res.ok) { ui.toast(res.message || '没有待装车的已分拣件', 'warn'); return; }
                ui.toast('自动配载生成 ' + res.created.length + ' 个车次', 'success');
            },
            'b:finishload': function (trId) {
                var task = loadingTask(trId);
                var tr = db.get('transports', trId);
                if (!tr) { ui.toast('车次不存在', 'error'); return; }
                if (!task) { ui.toast('该车次装卸任务已完成', 'warn'); return; }
                po.run('装车交接完成', TMS.operation.finishLoading(task.id, { operator: po.actor(sess()) + '（装卸组）' }));
            },
            'b:collectHub': function (id) {
                var o = db.get('orders', id);
                if (!o) return;
                po.run('入库称重', TMS.order.inbound(id, { operator: po.actor(sess()), device: po.device(sess()), weight: o.weight, note: '网点入库复重' }));
            },
            'b:requisition': requisitionModal,
            'b:sync': function (devId) {
                var d = db.get('devices', devId);
                if (!d) return;
                db.update('devices', devId, { lastSyncAt: util.iso(util.now()), status: d.status === 'fault' ? 'fault' : 'online', battery: Math.max(15, Number(d.battery) - 3) });
                db.commit('devices', devId, 'device:sync');
                po.refresh();
                ui.toast(d.name + ' 已同步（电量 ' + d.battery + '%）', 'success');
            },
            'b:profile': function () {
                var b = branch();
                ui.formModal({
                    title: '维护网点档案', sub: '营业时间与日容量影响预约揽收的承诺口径',
                    fields: [
                        { key: 'name', label: '网点名称', value: b.name, required: true },
                        { key: 'manager', label: '网点主管', value: b.manager },
                        { key: 'phone', label: '客服电话', value: b.phone },
                        { key: 'address', label: '地址', value: b.address, span: 2 },
                        { key: 'openAt', label: '开始营业', value: b.openAt, placeholder: '08:00' },
                        { key: 'closeAt', label: '结束营业', value: b.closeAt, placeholder: '20:00' },
                        { key: 'dailyCapacity', label: '日处理能力', type: 'number', unit: '件', min: 0, value: b.dailyCapacity },
                        { key: 'area', label: '场地面积', type: 'number', unit: '㎡', min: 0, value: b.area },
                        { key: 'status', label: '营业状态', type: 'select', placeholder: false, options: [{ value: 'active', label: '正常营业' }, { value: 'inactive', label: '暂停营业' }], value: b.status }
                    ],
                    okText: '保存',
                    onSubmit: function (v) {
                        db.update('branches', orgId(), v);
                        db.commit('branches', orgId(), 'branch:update');
                        ui.toast('网点档案已更新', 'success');
                    }
                });
            },
            'b:go': function (page) { if (page) TMS.shell.go(page); }
        };
        Object.keys(extra).forEach(function (k) { out[k] = extra[k]; });
        return out;
    })();

    /* ---------- 公共片段 ---------- */

    function orderActions(r) {
        var out = po.stageButtons(r, ROLE);
        if (r.status === 'created') out += ui.btn('取消', { size: 'sm', act: 'b:cancel', arg: r.id, tone: 'danger' });
        if (!TMS.order.isTerminal(r)) out += ui.btn('改单', { size: 'sm', act: 'b:change', arg: r.id });
        if (r.status === 'sorted' && !r.tripId) out += ui.btn('装车交接', { size: 'sm', tone: 'primary', act: 'b:load', arg: r.id });
        return out;
    }

    /* 列表页统一的「状态 + 服务 + 关键字」筛选 */
    function orderGrid(ctx, rows, opts) {
        var o = opts || {};
        var chips = pg.statusChips(rows);
        return po.grid(ctx, {
            rows: rows,
            columns: pg.orderColumns({ hide: o.hide || ['profit', 'stuck'] }).concat([
                { key: 'act', label: '操作', sortable: false, width: '168px', render: o.rowActions || orderActions }
            ]),
            keyName: 'id', onRow: 'order:open',
            fields: o.fields || pg.orderFields({ searchLabel: o.searchLabel || '单号 / 运单号 / 客户 / 货物' }),
            chips: chips.chips, chipsName: chips.chipsName,
            filter: function (r, fs) { return pg.orderFilter(r, fs) && (!o.only || o.only(r, fs)); },
            search: function (r) { return [r.id, r.waybillNo, r.customer, r.goods, r.receiverName, r.senderAddress].join(' '); },
            valueOf: function (r, k) { return k === 'customer' ? r.customer : (k === 'profit' ? r.profit : r[k]); },
            tools: o.tools, title: o.title, sub: o.sub, emptyText: o.emptyText || '这个筛选条件下没有件', pageSize: o.pageSize
        });
    }

    function tripGrid(ctx, rows, opts) {
        var o = opts || {};
        return po.grid(ctx, {
            rows: rows, keyName: 'id',
            columns: [
                { key: 'code', label: '车次', render: function (t) { return ui.link(esc(t.code), 'b:go', o.page || 'b-outbound'); } },
                { key: 'line', label: '线路', render: function (t) { return '<span class="tms-nowrap">' + esc(tripLine(t)) + '</span>'; } },
                { key: 'status', label: '状态', render: function (t) { return pg.statusBadge(t.status, pg.TRIP_TEXT); } },
                { key: 'orders', label: '单/件', align: 'right', render: function (t) { return fmt.number(t.orders) + ' / ' + fmt.number(t.pieces); } },
                { key: 'weight', label: '重量', align: 'right', render: function (t) { return fmt.kg(t.weight); } },
                { key: 'loadRate', label: '装载率', align: 'right', render: function (t) { return po.rateBar(Number(t.loadRate) || 0, 100); } },
                { key: 'departAt', label: '计划发车', render: function (t) { return '<span class="tms-nowrap">' + esc(t.date) + ' ' + esc(t.departAt) + '</span>'; } },
                {
                    key: 'act', label: '操作', sortable: false, render: function (t) {
                        var task = loadingTask(t.id);
                        var btns = '';
                        if (task && t.status !== 'departed' && t.status !== 'arrived') btns += ui.btn('完成装车', { size: 'sm', tone: 'primary', act: 'b:finishload', arg: t.id });
                        return btns || '<span class="tms-dim">' + (t.status === 'pending' ? '待装卸' : '在途/已完成') + '</span>';
                    }
                }
            ],
            search: function (t) { return t.code + ' ' + tripLine(t) + ' ' + (t.plate || '') + ' ' + (t.driver || ''); },
            fields: o.fields, tools: o.tools, title: o.title, sub: o.sub,
            emptyText: o.emptyText || '本网点归属分拨近两日没有车次', emptySub: o.emptySub, pageSize: o.pageSize || 6
        });
    }

    /* ---------- 工作台 ---------- */

    pg.define('b-home', {
        load: function (ctx) {
            var s = sess(), list = allOrders(), os = TMS.stats.orgStats(s.orgId, Math.min(30, ctx.days || 7));
            return {
                list: list, os: os, todo: todoList(list), trips: hubTrips(1),
                outToday: outs(list).filter(function (o) { return didToday(o, 'collected') || didToday(o, 'inbound'); }),
                inToday: ins(list).filter(function (o) { return didToday(o, 'arrived'); }),
                waiting: ins(list).filter(function (o) { return o.status === 'arrived'; }),
                aged: list.filter(function (o) { return !TMS.order.isTerminal(o) && TMS.order.stuckHours(o) > 24; }),
                ex: db.col('exceptions').filter(function (e) {
                    var o = e.orderId ? db.get('orders', e.orderId) : null;
                    return o && (o.originBranchId === s.orgId || o.destBranchId === s.orgId) && e.status !== 'resolved';
                }),
                alerts: db.col('alerts').filter(function (a) { return a.status === 'open'; }).slice(0, 5),
                staff: db.col('employees').filter(function (e) { return e.orgId === s.orgId && e.status === 'active'; })
            };
        },
        drawerFooter: function (id) { return po.footerFor(ROLE, id); },
        render: function (ctx, d) {
            var b = branch(), os = d.os;
            return po.wrap(ctx, {
                sub: esc(b.name || '网点工作台') + ' · ' + esc(b.city || '') + ' · 营业 ' + esc(b.openAt || '08:00') + '–' + esc(b.closeAt || '20:00') +
                    ' · 归属分拨 ' + esc(pg.hubName(hubId())),
                actions: ui.btn('上门揽收开单', { tone: 'primary', act: 'b:new' }),
                body: [
                    ui.kpis([
                        { label: '今日出港揽收', value: d.outToday.length, unit: '单', tone: 'brand', sub: '近' + os.days + '天共 ' + os.outbound + ' 单' },
                        { label: '今日进港到件', value: d.inToday.length, unit: '单', tone: 'info', sub: '待派 ' + d.waiting.length + ' 单' },
                        { label: '滞留超 24 小时', value: d.aged.length, unit: '单', tone: d.aged.length ? 'danger' : 'muted', sub: '压单先看这里' },
                        { label: '未闭环异常', value: d.ex.length, unit: '件', tone: d.ex.length ? 'warn' : 'muted', sub: '扣款 ' + fmt.money(util.sum(d.ex, 'deductionAmount')) }
                    ]),
                    /* 桌面端的工作台用列表而不是作业卡片：按钮还是那一步该做的事，
                       但能排序、能搜、能翻页，主管坐在工位上要的是这个 */
                    orderGrid(ctx, d.todo, {
                        title: '今日待办', sub: '按当前环节给的按钮就是这一步该做的事，点完即留痕',
                        tools: ui.link('全部订单', 'b:go', 'b-order'), pageSize: 8,
                        fields: [{ key: 'q', type: 'search', label: '关键字', placeholder: '单号 / 运单号 / 客户 / 货物' }],
                        hide: ['profit', 'stuck', 'courier', 'freight', 'chargeableWeight', 'customer'],
                        emptyText: '手上的件都清了', emptySub: '进港件到齐后这里就空了'
                    }),
                    tripGrid(ctx, d.trips, {
                        title: '本分拨车次', sub: '今天要与干线交接的车次', page: 'b-outbound',
                        tools: ui.link('出港交接', 'b:go', 'b-outbound'), pageSize: 5,
                        emptyText: '近两日没有车次', emptySub: '可在「出港」页一键配载生成'
                    }),
                    ui.card({
                        title: '异常与告警', sub: '工单在运营端闭环后这里自动消掉', flat: true,
                        body: ui.stack([
                            d.ex.length ? ui.list(d.ex.slice(0, 4).map(function (e) {
                                return {
                                    title: esc(e.type) + ' ' + ui.badge(esc(e.level), e.level === '一级' ? 'danger' : 'warn'),
                                    sub: esc((e.orderId || '无单') + ' · ' + esc(e.description || '')),
                                    right: TMS.service.isOverdue(e) ? ui.badge('超 SLA', 'danger') : ui.badge(esc(e.status === 'pending' ? '待受理' : '处理中'), 'muted'),
                                    act: 'b:go', arg: 'b-service'
                                };
                            })) : ui.empty('没有未闭环异常'),
                            d.alerts.length ? ui.notice(d.alerts.map(function (a) { return esc(a.message || a.title || a.type); }).join('；'), 'warn', '系统告警') : ''
                        ])
                    }),
                    ui.card({
                        title: '网点概况', flat: true,
                        body: ui.desc([
                            { label: '主管', value: esc(b.manager || '—') + ' · ' + esc(b.phone || '') },
                            { label: '在岗人数', value: fmt.number(d.staff.length) + ' 人（编制 ' + fmt.number(b.staffCount || 0) + '）' },
                            { label: '日容量', value: fmt.number(b.dailyCapacity || 0) + ' 件 · 场地 ' + fmt.number(b.area || 0) + ' ㎡' },
                            { label: '近' + os.days + '天签收', value: fmt.number(os.signed) + ' 单 · 准时率 ' + fmt.percent(os.onTimeRate) },
                            { label: '近' + os.days + '天营收', value: fmt.money(os.revenue) + ' · 毛利 ' + fmt.money(os.profit) },
                            { label: '在库件', value: fmt.number(os.inTransit) + ' 单在途/在场' }
                        ], { inline: true })
                    })
                ]
            });
        },
        actions: ACT
    });

    /* ---------- 揽收 ---------- */

    pg.define('b-collect', {
        load: function () {
            var list = outs();
            return {
                waiting: list.filter(function (o) { return o.status === 'created'; }),
                collected: list.filter(function (o) { return didToday(o, 'collected'); }),
                problem: list.filter(function (o) { return o.status === 'problem'; }),
                week: outs(list.filter(function (o) { return TMS.order.stageAt(o, 'collected'); }))
                    .filter(function (o) { return util.toDate(TMS.order.stageAt(o, 'collected')).getTime() >= util.addDays(util.now(), -7).getTime(); })
            };
        },
        drawerFooter: function (id) { return po.footerFor(ROLE, id); },
        render: function (ctx, d) {
            var weight = util.round(util.sum(d.week, 'chargeableWeight'), 1);
            var est = util.round(util.sum(d.week, function (o) { return Number(o.weight) || 0; }), 1);
            return po.wrap(ctx, {
                sub: '上门揽收 → 复磅计价 → 入库称重，三步都在这一页；申报与实际不符以复磅重重新计价',
                actions: ui.btn('新建揽收单', { tone: 'primary', act: 'b:new' }),
                body: [
                    ui.kpis([
                        { label: '待揽收', value: d.waiting.length, unit: '单', tone: d.waiting.length ? 'warn' : 'success', sub: '客户已下单未取件' },
                        { label: '今日已揽', value: d.collected.length, unit: '单', tone: 'brand', sub: fmt.kg(util.sum(d.collected, 'chargeableWeight')) },
                        { label: '近 7 天揽收', value: d.week.length, unit: '单', tone: 'info', sub: '计费重 ' + fmt.kg(weight) },
                        { label: '计重偏差', value: est ? util.round((weight - est) / est * 100, 1) : 0, unit: '%', tone: 'muted', sub: '计费重相对申报重' }
                    ]),
                    orderGrid(ctx, d.waiting, {
                        title: '待揽收', sub: '按承诺时效倒排，越紧的越在前',
                        hide: ['profit', 'courier', 'chargeableWeight'],
                        searchLabel: '单号 / 客户 / 寄件地址 / 收件人',
                        emptyText: '没有待揽收的单', emptySub: '点右上「新建揽收单」上门代客下单',
                        rowActions: function (r) {
                            return ui.btn('揽收', { size: 'sm', tone: 'primary', act: 'work:collect', arg: r.id }) +
                                ui.btn('复磅', { size: 'sm', act: 'work:weigh', arg: r.id }) +
                                ui.btn('异常', { size: 'sm', act: 'work:problem', arg: r.id }) +
                                ui.btn('取消', { size: 'sm', tone: 'danger', act: 'b:cancel', arg: r.id });
                        }
                    }),
                    orderGrid(ctx, d.collected, {
                        title: '今日揽收记录', sub: '揽收时间来自扫描流水，可直接进入入库称重',
                        hide: ['profit', 'courier'], pageSize: 6,
                        emptyText: '今天还没有揽收动作',
                        only: function () { return true; },
                        rowActions: function (r) {
                            return r.status === 'collected'
                                ? ui.btn('入库称重', { size: 'sm', tone: 'primary', act: 'b:collectHub', arg: r.id })
                                : ui.link('查看', 'order:open', r.id);
                        }
                    })
                ]
            });
        },
        actions: ACT
    });

    /* ---------- 进港 ---------- */

    pg.define('b-inbound', {
        load: function () {
            var list = ins();
            return {
                transit: list.filter(function (o) { return o.status === 'transit'; }),
                arrived: list.filter(function (o) { return o.status === 'arrived'; }),
                delivering: list.filter(function (o) { return o.status === 'delivering'; }),
                signed: list.filter(function (o) { return o.status === 'signed' && didToday(o, 'signed'); }),
                aged: list.filter(function (o) { return ['arrived', 'delivering'].indexOf(o.status) > -1 && TMS.order.stuckHours(o) > 12; }),
                trips: hubTrips(1).filter(function (t) { return t.toHub === hubId(); })
            };
        },
        drawerFooter: function (id) { return po.footerFor(ROLE, id); },
        render: function (ctx, d) {
            return po.wrap(ctx, {
                sub: '干线到达后先做到件扫描，再指派派送；到件不指派就是压单，指派了不签收就是超时',
                body: [
                    ui.kpis([
                        { label: '在途来件', value: d.transit.length, unit: '单', tone: 'info', sub: '车次未到' },
                        { label: '到件待派', value: d.arrived.length, unit: '单', tone: d.arrived.length ? 'warn' : 'success', sub: '到了没派' },
                        { label: '派送中', value: d.delivering.length, unit: '单', tone: 'brand', sub: '已指派骑手' },
                        { label: '今日签收', value: d.signed.length, unit: '单', tone: 'success', sub: '超时滞留 ' + d.aged.length + ' 单' }
                    ]),
                    orderGrid(ctx, d.arrived.concat(d.transit), {
                        title: '进港件', sub: '待派件排在前面，在途件只做预告',
                        hide: ['profit', 'chargeableWeight'],
                        emptyText: '没有进港件',
                        rowActions: function (r) {
                            if (r.status === 'arrived') return ui.btn('指派派送', { size: 'sm', tone: 'primary', act: 'work:assign', arg: r.id }) + ui.btn('异常', { size: 'sm', act: 'work:problem', arg: r.id });
                            if (r.status === 'delivering') return ui.btn('改派', { size: 'sm', tone: 'warn', act: 'work:recall', arg: r.id });
                            return ui.btn('到件扫描', { size: 'sm', tone: 'primary', act: 'work:arrive', arg: r.id });
                        }
                    }),
                    orderGrid(ctx, d.aged, {
                        title: '滞留预警', sub: '到/派环节停超过 12 小时的件，超时风险从这里开始',
                        hide: ['profit', 'expectedAt'], pageSize: 5, emptyText: '没有滞留件',
                        rowActions: function (r) {
                            return ui.btn('催派', { size: 'sm', tone: 'warn', act: r.status === 'arrived' ? 'work:assign' : 'work:recall', arg: r.id }) +
                                ui.btn('上报异常', { size: 'sm', act: 'work:problem', arg: r.id });
                        }
                    }),
                    ui.card({
                        title: '进港车次', sub: '本分拨为到达站的近期车次', flat: true,
                        body: d.trips.length ? ui.list(d.trips.slice(0, 6).map(function (t) {
                            return {
                                title: esc(t.code) + ' ' + pg.statusBadge(t.status, pg.TRIP_TEXT),
                                sub: esc(tripLine(t)) + ' · ' + fmt.number(t.orders) + ' 单 / ' + fmt.kg(t.weight) + ' · ' + esc(t.date) + ' ' + esc(t.departAt),
                                right: t.onTime === false ? ui.badge('晚点', 'warn') : ui.badge('计划', 'muted')
                            };
                        })) : ui.empty('暂无进港车次')
                    })
                ]
            });
        },
        actions: ACT
    });

    /* ---------- 出港 ---------- */

    pg.define('b-outbound', {
        load: function (ctx) {
            var list = outs();
            return {
                pre: list.filter(function (o) { return ['collected', 'inbound'].indexOf(o.status) > -1; }),
                sorted: list.filter(function (o) { return o.status === 'sorted' && !o.tripId; }),
                handed: list.filter(function (o) { return !!o.tripId && ['sorted', 'transit'].indexOf(o.status) > -1; }),
                trips: hubTrips(Math.max(2, Math.round((ctx.days || 7) / 3)))
            };
        },
        drawerFooter: function (id) { return po.footerFor(ROLE, id); },
        render: function (ctx, d) {
            var departed = d.trips.filter(function (t) { return ['departed', 'arrived', 'completed'].indexOf(t.status) > -1; });
            return po.wrap(ctx, {
                sub: '分拣落格 → 挂入车次 → 装卸完成 → 司机发车；网点只负责前三步，发车是运输端动作',
                actions: ui.btn('一键配载', { tone: 'primary', act: 'b:dispatch' }),
                body: [
                    ui.kpis([
                        { label: '待分拣交接', value: d.pre.length, unit: '单', tone: d.pre.length ? 'warn' : 'success', sub: '已入库未落格' },
                        { label: '待装车', value: d.sorted.length, unit: '单', tone: 'brand', sub: fmt.kg(util.sum(d.sorted, 'chargeableWeight')) },
                        { label: '已挂车次', value: d.handed.length, unit: '单', tone: 'info', sub: '等发车' },
                        { label: '近期已发运', value: departed.length, unit: '车次', tone: 'success', sub: '本分拨发出' }
                    ]),
                    orderGrid(ctx, d.pre.concat(d.sorted), {
                        title: '待出港', sub: '分拣落格后才有资格装车，跳步会被状态机拒绝',
                        hide: ['profit', 'courier', 'expectedAt'],
                        emptyText: '没有待出港的件',
                        rowActions: function (r) {
                            if (r.status === 'sorted') return ui.btn('装车交接', { size: 'sm', tone: 'primary', act: 'b:load', arg: r.id }) + ui.btn('异常', { size: 'sm', act: 'work:problem', arg: r.id });
                            return ui.btn('分拣交接', { size: 'sm', tone: 'primary', act: 'work:sort', arg: r.id }) + ui.btn('异常', { size: 'sm', act: 'work:problem', arg: r.id });
                        }
                    }),
                    tripGrid(ctx, d.trips, { title: '本分拨车次', sub: '装载率低于阈值说明在拉空车，可等下一班拼载', emptyText: '近两日没有车次' })
                ]
            });
        },
        actions: ACT
    });

    /* ---------- 订单 ---------- */

    pg.define('b-order', {
        load: function () { return { rows: allOrders() }; },
        drawerFooter: function (id) { return po.footerFor(ROLE, id); },
        render: function (ctx, d) {
            var st = util.countBy(d.rows, 'status');
            return po.wrap(ctx, {
                sub: '本网点作为寄件方或收件方的全部订单，成本毛利不对一线展示',
                actions: ui.btn('新建揽收单', { tone: 'primary', act: 'b:new' }),
                body: [
                    ui.kpis([
                        { label: '本网点订单', value: d.rows.length, unit: '单', tone: 'brand', sub: '出港 ' + outs(d.rows).length + ' / 进港 ' + ins(d.rows).length },
                        { label: '未闭环', value: d.rows.filter(function (o) { return !TMS.order.isTerminal(o); }).length, unit: '单', tone: 'warn', sub: '问题件 ' + (st.problem || 0) },
                        { label: '已签收', value: st.signed || 0, unit: '单', tone: 'success', sub: '超时签收 ' + d.rows.filter(function (o) { return TMS.order.isSignedLate(o); }).length },
                        { label: '取消/退回', value: (st.cancelled || 0) + (st.returned || 0), unit: '单', tone: 'muted', sub: '逆向也留痕' }
                    ]),
                    orderGrid(ctx, d.rows, {
                        hide: ['profit'], pageSize: 12, title: '订单列表',
                        tools: ui.btn('导出本网点视图', { size: 'sm', act: 'shell:export' }),
                        emptyText: '本网点还没有订单'
                    })
                ]
            });
        },
        actions: ACT
    });

    /* ---------- 库存 ---------- */

    pg.define('b-stock', {
        load: function () {
            var hub = hubId();
            var wh = db.findOne('warehouses', function (w) { return w.hubId === hub; }) || db.col('warehouses')[0] || {};
            var stocks = db.col('stocks').filter(function (s) { return s.warehouseId === wh.id; }).map(function (s) {
                var m = db.get('materials', s.materialId) || {};
                var row = util.clone(s);
                row.material = s.material || m.name;
                row.unit = s.unit || m.unit || '件';
                row.price = Number(m.price) || 0;
                row.status = m.status || 'normal';
                row.safeQty = Number(s.safeQty) || 0;
                row.low = (Number(s.qty) || 0) < row.safeQty;
                row.value = util.money((Number(s.qty) || 0) * row.price);
                return row;
            });
            var mv = db.col('stockMovements').filter(function (x) { return x.warehouseId === wh.id; })
                .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
            /* 在库件：网点 physically 还压着的货，用订单状态算而不是仓库表，
               否则「库存有 200 件、订单查不到」这种假账在一线端最先被看见 */
            var held = allOrders().filter(function (o) {
                return ['collected', 'inbound', 'sorted', 'arrived', 'problem'].indexOf(o.status) > -1;
            });
            return { wh: wh, stocks: stocks, mv: mv, held: held, buckets: util.countBy(held, 'status') };
        },
        drawerFooter: function (id) { return po.footerFor(ROLE, id); },
        render: function (ctx, d) {
            var st = d.stocks;
            return po.wrap(ctx, {
                sub: '包材库存看归属分拨的仓位，在库件看自己手上未发未派的实际货',
                actions: ui.btn('包材领用', { tone: 'primary', act: 'b:requisition' }),
                body: [
                    ui.kpis([
                        { label: '在库件', value: d.held.length, unit: '单', tone: 'brand', sub: fmt.number(util.sum(d.held, 'pieces')) + ' 件货' },
                        { label: '超 24 小时压件', value: d.held.filter(function (o) { return TMS.order.stuckHours(o) > 24; }).length, unit: '单', tone: 'warn', sub: '先清这些' },
                        { label: '包材低于安全库存', value: st.filter(function (s) { return s.low; }).length, unit: '项', tone: 'danger', sub: '仓：' + esc(d.wh.name || '未绑定') },
                        { label: '包材结存', value: fmt.money(util.sum(st, 'value')), tone: 'success', sub: st.length + ' 个 SKU' }
                    ]),
                    ui.card({
                        title: '在库件分布', sub: '按当前环节拆分：未发运的出港件 + 未派送的进港件 + 问题件', flat: true,
                        body: d.held.length ? ui.stack([
                            ui.meter(['collected', 'inbound', 'sorted', 'arrived', 'problem'].filter(function (k) { return d.buckets[k]; }).map(function (k) {
                                return { value: d.buckets[k], color: k === 'problem' ? 'var(--tms-danger)' : 'var(--tms-brand)' };
                            })),
                            ui.desc(TMS.cfg.orderFlow.concat(['problem']).filter(function (k) { return d.buckets[k]; }).map(function (k) {
                                return { label: TMS.cfg.orderLabels[k], value: d.buckets[k] + ' 单' };
                            }), { inline: true }),
                            ui.list(d.held.filter(function (o) { return TMS.order.stuckHours(o) > 24; }).slice(0, 6).map(function (o) {
                                return {
                                    title: ui.idCell(o.id, 'order:open', { short: true }) + ' ' + ui.statusBadge(o.status),
                                    sub: esc(o.origin) + '→' + esc(o.destination) + ' · 滞留 ' + fmt.duration(TMS.order.stuckHours(o)),
                                    right: ui.btn(o.originBranchId === orgId() ? '出港' : '催派', {
                                        size: 'sm', tone: o.originBranchId === orgId() ? 'primary' : 'warn',
                                        act: o.originBranchId === orgId() ? (o.status === 'sorted' ? 'b:load' : 'work:sort') : 'work:assign', arg: o.id
                                    })
                                };
                            }))
                        ]) : ui.empty('网点手上没有在库件', '进出港都交接干净了')
                    }),
                    po.grid(ctx, {
                        rows: st, keyName: 'id', title: '包材库存', sub: '领用直接出库，安全库存与物料档案合计同步',
                        columns: [
                            { key: 'material', label: '物料', render: function (s) { return esc(s.material) + ' ' + ui.badge(esc(s.status === 'low' ? '偏低' : s.status === 'out' ? '断货' : '正常'), s.status === 'normal' ? 'success' : s.status === 'low' ? 'warn' : 'danger'); } },
                            { key: 'qty', label: '现存', align: 'right', render: function (s) { return (s.low ? '<span class="tone-danger">' : '') + fmt.number(s.qty) + ' ' + esc(s.unit) + (s.low ? '</span>' : ''); } },
                            { key: 'safeQty', label: '安全库存', align: 'right', render: function (s) { return fmt.number(s.safeQty); } },
                            { key: 'value', label: '结存金额', align: 'right', render: function (s) { return fmt.money(s.value); } },
                            { key: 'warehouseName', label: '仓位', render: function (s) { return '<span class="tms-nowrap">' + esc(s.warehouseName || d.wh.name || '—') + '</span>'; } },
                            { key: 'act', label: '操作', sortable: false, render: function (s) { return ui.btn('领用', { size: 'sm', act: 'b:requisition', arg: s.materialId }); } }
                        ],
                        search: function (s) { return s.material + ' ' + (s.warehouseName || ''); },
                        emptyText: '该仓位没有包材库存行', emptySub: '采购收货在运营端「仓储库存」发起'
                    }),
                    po.grid(ctx, {
                        rows: d.mv, keyName: 'id', title: '库存流水', sub: '领用/收货/调整都在这里留痕，账实不符回查看这页',
                        columns: [
                            { key: 'createdAt', label: '时间', render: function (m) { return ui.timeCell(m.createdAt); } },
                            { key: 'kind', label: '类型', render: function (m) { return ui.badge(esc({ in: '入库', out: '出库', adjust: '调整', purchase: '采购' }[m.kind] || m.kind), m.kind === 'out' ? 'warn' : 'muted'); } },
                            { key: 'materialId', label: '物料', render: function (m) { return esc((db.get('materials', m.materialId) || {}).name || m.materialId); } },
                            { key: 'qty', label: '数量', align: 'right', render: function (m) { return (m.kind === 'out' || m.qty < 0 ? '-' : '') + fmt.number(Math.abs(m.qty)); } },
                            { key: 'operator', label: '操作人', render: function (m) { return esc(m.operator || '—'); } },
                            { key: 'reason', label: '事由', render: function (m) { return esc(m.reason || '—'); } }
                        ],
                        search: function (m) { return m.id + ' ' + (m.reason || '') + ' ' + (m.operator || ''); },
                        pageSize: 8, emptyText: '这个窗口没有库存流水'
                    })
                ]
            });
        },
        actions: ACT
    });

    /* ---------- 分拣（网点侧交接台） ---------- */

    pg.define('b-sorting', {
        load: function () {
            var hub = hubId();
            return {
                rows: outs().filter(function (o) { return ['collected', 'inbound', 'sorted'].indexOf(o.status) > -1; }),
                board: TMS.operation.sortingBoard(hub)
            };
        },
        drawerFooter: function (id) { return po.footerFor(ROLE, id); },
        render: function (ctx, d) {
            return po.wrap(ctx, {
                sub: '网点只做「交接入分拣线」和「按格口核对」，格口分拣本身归分拨分拣员',
                body: [
                    ui.card({
                        title: '格口看板', sub: pg.hubName(hubId()) + ' 未完成的分拣任务', flat: true,
                        body: d.board.length ? ui.table({
                            dense: true, keyName: 'chute', rows: d.board.slice(0, 10), sortable: false,
                            columns: [
                                { key: 'chute', label: '格口', render: function (r) { return ui.badge(esc(r.chute), 'brand'); } },
                                { key: 'tasks', label: '任务', align: 'right' },
                                { key: 'pieces', label: '件数', align: 'right' },
                                { key: 'weight', label: '计费重', align: 'right', render: function (r) { return fmt.kg(r.weight); } },
                                { key: 'urgent', label: '加急', align: 'right', render: function (r) { return r.urgent ? ui.badge(r.urgent + ' 单', 'warn') : '0'; } },
                                { key: 'destinations', label: '去向', render: function (r) { return esc((r.destinations || []).join('、')); } }
                            ]
                        }) : ui.empty('本分拨没有待分拣任务')
                    }),
                    orderGrid(ctx, d.rows, {
                        title: '待分拣交接', hide: ['profit', 'courier', 'chargeableWeight'], pageSize: 10,
                        emptyText: '没有待交接的件',
                        rowActions: function (r) {
                            if (r.status === 'sorted') return ui.link('已落格 · 去装车', 'b:go', 'b-outbound');
                            return ui.btn('入库称重', { size: 'sm', act: 'b:collectHub', arg: r.id }) +
                                ui.btn('分拣交接', { size: 'sm', tone: 'primary', act: 'work:sort', arg: r.id });
                        }
                    })
                ]
            });
        },
        actions: ACT
    });

    /* ---------- 异常与客服 ---------- */

    pg.define('b-service', {
        load: function () {
            var s = sess();
            var scope = pg.orderScope(s);
            var ids = {};
            allOrders().forEach(function (o) { ids[o.id] = true; });
            var tickets = db.col('tickets').filter(function (t) { return !t.orderId || ids[t.orderId] || t.customer === s.orgName; })
                .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
            return {
                ex: po.exceptionRows('mine'),
                tickets: tickets,
                claims: db.col('claims').filter(function (c) { return ids[c.orderId]; })
                    .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); })
            };
        },
        drawerFooter: function (id) { return po.footerFor(ROLE, id); },
        render: function (ctx, d) {
            var open = d.ex.filter(function (e) { return e.status !== 'resolved'; });
            var pending = d.tickets.filter(function (t) { return t.status === 'pending' || t.status === 'processing'; });
            var sc = util.countBy(d.tickets, 'status');
            return po.wrap(ctx, {
                sub: '异常工单受理 → 跟催升级 → 运营端闭环；客服工单受理 → 回复结单，结果回写订单备注',
                actions: ui.btn('新建工单', { tone: 'primary', act: 'cs:new' }) + ui.btn('上报异常', { act: 'work:problem', arg: '' }),
                body: [
                    ui.kpis([
                        { label: '未闭环异常', value: open.length, unit: '件', tone: open.length ? 'danger' : 'success', sub: '超 SLA ' + d.ex.filter(TMS.service.isOverdue).length + ' 件' },
                        { label: '待处理工单', value: pending.length, unit: '单', tone: pending.length ? 'warn' : 'success', sub: '已结 ' + (sc.resolved || 0) + ' 单' },
                        { label: '异常扣款', value: fmt.money(util.sum(open, 'deductionAmount')), tone: 'muted', sub: '责任认定后进应付' },
                        { label: '在谈理赔', value: d.claims.filter(function (c) { return c.status === 'pending'; }).length, unit: '笔', tone: 'info', sub: '运营端审批' }
                    ]),
                    po.grid(ctx, {
                        rows: d.ex, keyName: 'id', title: '异常工单', sub: '本网点进出港件的异常，一级 2 小时、二级 6 小时未受理自动升级',
                        columns: po.exceptionColumns(), pageSize: 8,
                        search: function (e) { return e.id + ' ' + (e.orderId || '') + ' ' + e.type + ' ' + (e.description || '') + ' ' + (e.handler || ''); },
                        emptyText: '没有异常工单'
                    }),
                    po.grid(ctx, {
                        rows: d.tickets, keyName: 'id', title: '客服工单', sub: '催件/改址/投诉，结单即回写订单',
                        columns: [
                            { key: 'id', label: '工单', render: function (t) { return ui.idCell(t.id, 'noop', { short: true }); } },
                            { key: 'type', label: '类型', render: function (t) { return esc(t.type); } },
                            { key: 'orderId', label: '运单', render: function (t) { return t.orderId ? ui.idCell(t.orderId, 'order:open', { short: true }) : '<span class="tms-dim">无单</span>'; } },
                            { key: 'content', label: '诉求', render: function (t) { return '<span class="tms-nowrap">' + esc(t.content || '') + '</span>'; } },
                            { key: 'priority', label: '优先级', render: function (t) { return ui.badge(esc(t.priority || '中'), t.priority === '高' ? 'danger' : t.priority === '中' ? 'warn' : 'muted'); } },
                            { key: 'status', label: '状态', render: function (t) { return pg.statusBadge(t.status, pg.DOC_TEXT); } },
                            { key: 'deadline', label: '处理时限', render: function (t) { return ui.timeCell(t.deadline || t.createdAt); } },
                            {
                                key: 'act', label: '操作', sortable: false, render: function (t) {
                                    if (t.status === 'pending') return ui.btn('受理', { size: 'sm', tone: 'primary', act: 'cs:accept', arg: t.id });
                                    if (t.status === 'processing') return ui.btn('结单', { size: 'sm', tone: 'primary', act: 'cs:resolve', arg: t.id });
                                    return ui.link('查看结果', 'order:open', t.orderId || '');
                                }
                            }
                        ],
                        search: function (t) { return t.id + ' ' + (t.orderId || '') + ' ' + t.type + ' ' + (t.content || ''); },
                        pageSize: 8, emptyText: '没有客服工单'
                    }),
                    ui.card({
                        title: '理赔进度', sub: '破损/丢失先立异常，理赔金额由运营端审批', flat: true,
                        body: d.claims.length ? ui.list(d.claims.slice(0, 6).map(function (c) {
                            return {
                                title: esc(c.id) + ' ' + ui.badge(esc(c.status || '待审'), c.status === 'paid' ? 'success' : 'muted'),
                                sub: esc((c.orderId || '') + ' · ' + (c.reason || '')),
                                right: fmt.money(c.amount || c.applyAmount || 0)
                            };
                        })) : ui.empty('本网点没有理赔记录')
                    })
                ]
            });
        },
        actions: ACT
    });

    /* ---------- 网点经营 ---------- */

    pg.define('b-operation', {
        load: function (ctx) {
            var days = Math.max(7, ctx.days || 30);
            return {
                os: TMS.stats.orgStats(orgId(), days),
                rows: allOrders(),
                cod: db.col('codRecords').filter(function (c) {
                    var o = db.get('orders', c.orderId);
                    return o && (o.originBranchId === orgId() || o.destBranchId === orgId());
                }),
                staff: db.col('employees').filter(function (e) { return e.orgId === orgId() && e.status === 'active'; })
            };
        },
        drawerFooter: function (id) { return po.footerFor(ROLE, id); },
        render: function (ctx, d) {
            var os = d.os, b0 = branch();
            var codOpen = d.cod.filter(function (c) { return c.remitStatus !== 'remitted'; });
            return po.wrap(ctx, {
                sub: '口径与运营端「经营报表」同源（TMS.stats.orgStats），网点端只是把它按本网点切一刀',
                body: [
                    ui.kpis([
                        { label: '揽收单量', value: os.outbound, unit: '单', tone: 'brand', sub: '近 ' + os.days + ' 天' },
                        { label: '签收单量', value: os.signed, unit: '单', tone: 'success', sub: '准时率 ' + fmt.percent(os.onTimeRate) },
                        { label: '营收', value: fmt.money(os.revenue), tone: 'info', sub: '票均 ' + fmt.money(os.avgFreight) },
                        { label: '毛利', value: fmt.money(os.profit), unit: '', tone: os.profit >= 0 ? 'success' : 'danger', sub: '毛利率 ' + fmt.percent(os.margin) }
                    ]),
                    ui.card({
                        title: '单量与营收趋势', sub: os.org + ' · 近 ' + os.days + ' 天', flat: true,
                        body: TMS.charts.line({
                            labels: os.trend.map(function (t) { return t.label; }), height: 210,
                            series: [
                                { name: '下单量', data: os.trend.map(function (t) { return t.orders; }) },
                                { name: '签收量', data: os.trend.map(function (t) { return t.signed; }), color: 'var(--tms-success)' }
                            ]
                        })
                    }),
                    ui.split('2', [
                        ui.card({
                            title: '服务结构', sub: '加急/冷链占比决定干线班次与温控成本', flat: true,
                            body: TMS.charts.donut({ data: os.byService.map(function (s) { return { label: s.label, value: s.orders }; }), height: 210 })
                        }),
                        ui.card({
                            title: '重量与成本', flat: true,
                            body: ui.stack([
                                ui.desc([
                                    { label: '计费重合计', value: fmt.kg(os.weight) },
                                    { label: '干线+派送成本', value: fmt.money(os.cost) },
                                    { label: '异常扣款', value: fmt.money(os.deduction) },
                                    { label: '在途未闭环', value: os.inTransit + ' 单' },
                                    { label: '压单/超时', value: os.backlog + ' 单' }
                                ]),
                                ui.meter([
                                    { value: os.cost, color: 'var(--tms-warn)' },
                                    { value: Math.max(0, os.profit), color: 'var(--tms-success)' },
                                    { value: os.deduction, color: 'var(--tms-danger)' }
                                ])
                            ])
                        })
                    ]),
                    ui.card({
                        title: '重点客户', sub: '按本网点贡献营收排序', flat: true,
                        body: os.topCustomers.length ? ui.table({
                            dense: true, keyName: 'label', rows: os.topCustomers, sortable: false,
                            columns: [
                                { key: 'label', label: '客户', render: function (c) { return esc(c.label); } },
                                { key: 'orders', label: '单量', align: 'right' },
                                { key: 'revenue', label: '营收', align: 'right', render: function (c) { return fmt.money(c.revenue); } },
                                { key: 'margin', label: '毛利率', align: 'right', render: function (c) { return fmt.percent(c.margin); } }
                            ]
                        }) : ui.empty('近 ' + os.days + ' 天没有成交客户')
                    }),
                    po.grid(ctx, {
                        rows: d.cod, keyName: 'id', title: '代收货款', sub: '到付件签收后生成待上划记录，上划进财务流水',
                        columns: [
                            { key: 'id', label: '记录', render: function (c) { return ui.idCell(c.id, 'noop', { short: true }); } },
                            { key: 'orderId', label: '运单', render: function (c) { return ui.idCell(c.orderId, 'order:open', { short: true }); } },
                            { key: 'goodsValue', label: '代收货款', align: 'right', render: function (c) { return fmt.money(c.goodsValue); } },
                            { key: 'serviceFee', label: '手续费', align: 'right', render: function (c) { return fmt.money(c.serviceFee); } },
                            { key: 'netPayable', label: '应上划', align: 'right', render: function (c) { return fmt.money(c.netPayable); } },
                            { key: 'remitStatus', label: '状态', render: function (c) { return pg.statusBadge(c.remitStatus, pg.DOC_TEXT); } },
                            { key: 'courier', label: '收款人', render: function (c) { return esc(c.courier || '—'); } },
                            { key: 'collectedAt', label: '代收时间', render: function (c) { return ui.timeCell(c.collectedAt); } }
                        ],
                        pageSize: 6, emptyText: '没有代收货款记录',
                        tools: ui.badge('待上划 ' + codOpen.length + ' 笔 · ' + fmt.money(util.sum(codOpen, 'netPayable')), codOpen.length ? 'warn' : 'success')
                    }),
                    ui.card({
                        title: '人手与产能', sub: '人效=网点签收量/在岗人数，异常与压单先看是不是缺人', flat: true,
                        body: ui.stack([
                            ui.desc([
                                { label: '在岗人数', value: fmt.number(d.staff.length) + ' 人' },
                                { label: '人均签收', value: d.staff.length ? util.round(os.signed / d.staff.length, 1) + ' 单/人' : '—' },
                                { label: '日处理设计', value: b0.dailyCapacity ? fmt.number(b0.dailyCapacity) + ' 件/日' : '—' }
                            ], { inline: true }),
                            ui.list(d.staff.slice(0, 6).map(function (e) {
                                return {
                                    title: esc(e.name) + ' ' + ui.badge(esc(TMS.people.roleName(e.role)), 'muted'),
                                    sub: esc(e.position || '') + ' · ' + esc(e.phone || ''),
                                    right: fmt.number(d.rows.filter(function (o) { return o.courier === e.name; }).length) + ' 单'
                                };
                            }))
                        ])
                    })
                ]
            });
        },
        actions: ACT
    });

    /* ---------- 网点设置 ---------- */
    pg.define('b-system', {
        load: function () {
            var b = branch(), hub = hubId();
            return {
                b: b, hub: db.get('hubs', hub) || {},
                staff: db.col('employees').filter(function (e) { return e.orgId === b.id; }),
                devices: db.col('devices').filter(function (x) { return x.location === b.name || x.location === b.id; }),
                fence: TMS.network.fenceOfCity(b.city),
                lanes: db.col('trips').filter(function (t) { return t.fromHub === hub || t.toHub === hub; })
            };
        },
        drawerFooter: function (id) { return po.footerFor(ROLE, id); },
        render: function (ctx, d) {
            var b = d.b;
            return po.wrap(ctx, {
                sub: '档案改了，下游的承诺跟着改：营业时间影响预约揽收，日容量影响压单告警阈值',
                actions: ui.btn('编辑网点档案', { tone: 'primary', act: 'b:profile' }),
                body: [
                    ui.card({
                        title: '网点档案', flat: true,
                        body: ui.desc([
                            { label: '名称', value: esc(b.name) },
                            { label: '编号', value: esc(b.id) + ' / ' + esc(b.code || '') },
                            { label: '类型', value: esc(b.type || '直营网点') },
                            { label: '状态', value: ui.badge(b.status === 'active' ? '正常营业' : '暂停营业', b.status === 'active' ? 'success' : 'warn') },
                            { label: '主管', value: esc(b.manager || '—') + ' · ' + esc(b.phone || '') },
                            { label: '地址', value: esc(b.address || '—') },
                            { label: '营业时间', value: esc(b.openAt) + '–' + esc(b.closeAt) },
                            { label: '日容量', value: fmt.number(b.dailyCapacity || 0) + ' 件' },
                            { label: '场地', value: fmt.number(b.area || 0) + ' ㎡' },
                            { label: '归属分拨', value: esc(d.hub.name || pg.hubName(d.hub.id || '')) + '（' + esc(d.hub.capacityPieces ? fmt.number(d.hub.capacityPieces) + ' 件仓位' : '—') + '）' }
                        ], { inline: true })
                    }),
                    po.grid(ctx, {
                        rows: d.staff, keyName: 'id', title: '网点人员', sub: '人事异动在运营端「人事管理」发起，这里只核编制',
                        columns: [
                            { key: 'name', label: '姓名', render: function (e) { return esc(e.name) + ' ' + ui.badge(esc(TMS.people.roleName(e.role)), e.role === 'deliveryman' ? 'brand' : 'muted'); } },
                            { key: 'position', label: '岗位', render: function (e) { return esc(e.position || '—'); } },
                            { key: 'phone', label: '联系方式', render: function (e) { return esc(e.phone || '—'); } },
                            { key: 'entryAt', label: '入职', render: function (e) { return '<span class="tms-nowrap">' + esc(e.entryAt || '') + '</span>'; } },
                            { key: 'status', label: '状态', render: function (e) { return ui.badge(esc({ active: '在职', on_leave: '休假', resigned: '离职' }[e.status] || e.status), e.status === 'active' ? 'success' : e.status === 'on_leave' ? 'warn' : 'muted'); } },
                            { key: 'act', label: '今日', sortable: false, render: function (e) { var r = TMS.people.todayRecord(e.id); return r && r.clockIn ? ui.badge('已打卡', 'success') : ui.badge('未打卡', 'warn'); } }
                        ],
                        search: function (e) { return e.name + ' ' + (e.position || '') + ' ' + (e.phone || ''); },
                        emptyText: '网点还没有员工档案', pageSize: 10
                    }),
                    po.grid(ctx, {
                        rows: d.devices, keyName: 'id', title: '扫描设备', sub: '同步即上报在线与电量，故障机只能由运营端维修工单闭环',
                        columns: [
                            { key: 'name', label: '设备', render: function (x) { return esc(x.name || x.id); } },
                            { key: 'model', label: '型号', render: function (x) { return esc(x.model || '—'); } },
                            { key: 'status', label: '状态', render: function (x) { return ui.badge(esc({ online: '在线', offline: '离线', fault: '故障' }[x.status] || x.status), x.status === 'online' ? 'success' : x.status === 'fault' ? 'danger' : 'muted'); } },
                            { key: 'battery', label: '电量', align: 'right', render: function (x) { return ui.progress(Number(x.battery) || 0, { thin: true, tone: (Number(x.battery) || 0) < 20 ? 'danger' : 'success' }) + ' ' + fmt.number(x.battery || 0) + '%'; } },
                            { key: 'lastSyncAt', label: '最近同步', render: function (x) { return ui.timeCell(x.lastSyncAt); } },
                            { key: 'act', label: '操作', sortable: false, render: function (x) { return ui.btn('同步', { size: 'sm', act: 'b:sync', arg: x.id }); } }
                        ],
                        emptyText: '本网点没有登记扫描设备', pageSize: 6
                    }),
                    ui.card({
                        title: '服务区域与线路', sub: '围栏与干线班次决定本网点能不能承诺时效', flat: true,
                        body: ui.stack([
                            d.fence ? ui.desc([
                                { label: '城市围栏', value: esc(d.fence.name || d.fence.city || b.city) },
                                { label: '覆盖半径', value: fmt.number(Math.round(d.fence.radiusKm || 0)) + ' km' },
                                { label: '围栏状态', value: ui.badge(esc(d.fence.status || 'active'), 'success') }
                            ], { inline: true }) : ui.notice('本网点所在城市暂无电子围栏，揽收超范围不会被拦截', 'warn'),
                            d.lanes.length ? ui.table({
                                dense: true, keyName: 'id', rows: d.lanes.slice(0, 8), sortable: false,
                                columns: [
                                    { key: 'code', label: '班次', render: function (t) { return esc(t.code || t.id); } },
                                    { key: 'from', label: '起', render: function (t) { return esc(pg.hubName(t.fromHub)); } },
                                    { key: 'to', label: '讫', render: function (t) { return esc(pg.hubName(t.toHub)); } },
                                    { key: 'departAt', label: '发车', render: function (t) { return esc(t.departAt || '') + ' ' + esc(t.days || ''); } },
                                    { key: 'mode', label: '方式', render: function (t) { return ui.badge(esc(t.mode || '陆运'), 'muted'); } },
                                    { key: 'status', label: '状态', render: function (t) { return ui.badge(t.status === 'active' ? '执行中' : '停用', t.status === 'active' ? 'success' : 'muted'); } }
                                ]
                            }) : ui.empty('本分拨没有干线班次')
                        ])
                    })
                ]
            });
        },
        actions: ACT
    });
})(window);
