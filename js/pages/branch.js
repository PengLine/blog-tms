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
    /* ---------- 派送地址（图1 左支 + 图2 维护侧） ---------- */

    /* 网点按城市看自己这一片的地址：branchName 可能因为认不出城市而空着，
       那些恰恰是要网点补齐的，不能因为归属为空就从网点端消失 */
    function adrAll() {
        var city = branch().city || '';
        var name = branch().name || '';
        return util.sortBy(db.col('addresses').filter(function (a) {
            return a.city === city || (!a.city && !a.branchName) || a.branchName === name;
        }).map(function (a) {
            var revs = TMS.address.reviewsOf(a.id);
            var verdicts = revs.filter(function (r) { return r.kind === TMS.address.KIND.review; });
            return {
                id: a.id, phone: a.phone, receiver: a.receiver || '', status: a.status,
                statusLabel: TMS.address.labelOf(a.status), full: (a.city || '') + (a.district || '') + (a.detail || ''),
                detail: a.detail || '', district: a.district || '', city: a.city || '',
                branchName: a.branchName || '', rejectReason: a.rejectReason || '',
                issues: a.issues || [], suggest: a.suggest || '', reviewer: a.reviewer || '',
                rounds: verdicts.length, records: revs.length, maintainCount: a.maintainCount || 1,
                waitHours: TMS.address.holdHours(a), overdue: TMS.address.isOverdue(a),
                approvedAt: a.approvedAt || '', createdAt: a.createdAt, source: a.source || ''
            };
        }), 'waitHours', 'desc');
    }

    function adrMine(list) {
        return (list || adrAll()).filter(function (r) { return r.status !== 'approved'; });
    }

    function adrFilter(r, fs) {
        if (fs.status && r.status !== fs.status) return false;
        if (fs.wait === '1' && !r.overdue) return false;
        return true;
    }

    function adrSearch(r) {
        return [r.phone, r.receiver, r.full, r.branchName, r.rejectReason].join(' ');
    }

    /* 图1 左支跑在网点端：客户打电话问「这个地址你们送不送」，一线当场要给答案 */
    function adrCheckModal(phone) {
        var b = branch();
        ui.formModal({
            title: '查手机号是否可派送', sub: '对应图1 左支：先取维护地址，取不到才落到派送围栏判定',
            fields: [{ key: 'phone', label: '收件手机号', required: true, value: phone || '', placeholder: '11 位手机号', span: 2 }],
            okText: '判定',
            onSubmit: function (v) {
                /* formModal 的 required 只在提交前挡空值，11 位手机号这种格式线要自己判：
                   拿一串垃圾去判定会得到「认不出城市 + 没有围栏」的错误结论，比不给结论更糟 */
                var digits = String(v.phone || '').replace(/\D/g, '');
                if (!/^1[3-9]\d{9}$/.test(digits.slice(-11))) return '请输入 11 位收件手机号';
                var dec = TMS.address.phoneDecision(v.phone);
                var p = dec.parsed || TMS.address.parse('');
                var fence = p.city ? TMS.network.fenceOfCity(p.city, 'branch') : null;
                var rows = [];
                var tone = 'warn';
                if (dec.canDeliver) {
                    tone = 'success';
                    rows = [
                        { label: '结论', value: ui.badge('可派送（按维护地址）', 'success') },
                        { label: '命中地址', value: esc(dec.address.phone) + ' · ' + esc((dec.address.city || '') + (dec.address.district || '') + (dec.address.detail || '')) },
                        { label: '归属网点', value: esc(dec.address.branchName || b.name || '待归属') },
                        { label: '通过时间', value: fmt.dateTime(dec.address.approvedAt) },
                        { label: '备注', value: esc(dec.note) }
                    ];
                } else if (dec.blocked === 'review') {
                    rows = [
                        { label: '结论', value: ui.badge('暂不可按地址派送', 'warn') },
                        { label: '现有记录', value: esc(dec.address.full || dec.address.detail) + ' ' + ui.badge(dec.address.statusLabel || TMS.address.labelOf(dec.address.status), 'warn') },
                        { label: '缺什么', value: (dec.address.issues || []).length ? dec.address.issues.map(function (x) { return ui.badge(esc(x), 'danger'); }).join(' ') : '<span class="tms-dim">—</span>' },
                        { label: '打回原因', value: dec.address.rejectReason ? esc(dec.address.rejectReason) : '<span class="tms-dim">未被审核人标记</span>' },
                        { label: '要走的路', value: '图2：补齐/修改 → 提交 → 运营端复审通过，通过后这个手机号立刻可派' }
                    ];
                } else {
                    rows = [
                        { label: '结论', value: ui.badge('无维护地址，按围栏判定', 'info') },
                        { label: '认出的城市', value: p.city ? esc(p.city) : '<span class="tone-danger">地址里认不出服务城市</span>' },
                        { label: '区/镇', value: p.district ? esc(p.district) : '<span class="tms-dim">未识别</span>' },
                        { label: '门牌', value: p.door ? '已带门牌/楼栋' : '<span class="tone-danger">缺门牌号/楼栋/单元</span>' },
                        { label: '城市派送围栏', value: fence ? esc(fence.name) + '（' + pg.fenceGeomCell(fence) + '）' : '<span class="tone-danger">该市没有在用派送围栏</span>' },
                        { label: '要走的路', value: fence ? '在网内 → 可按派送围栏派；仍需建档的请点「新建地址」提交审核' : '不在任何在用围栏内 → 不可派送需自提，或先补围栏再建档' }
                    ];
                }
                ui.closeTop();
                ui.drawer({
                    title: '派送判定 · ' + esc(String(v.phone).replace(/\D/g, '')),
                    sub: dec.note,
                    body: ui.desc(rows) + ui.notice(tone === 'success'
                        ? '该手机号已有通过审核的派送地址，可直接下单派送。'
                        : '判定依据来自「维护地址 + 电子围栏」两层：地址要先过审核，围栏只管城市覆盖。',
                        tone === 'success' ? 'success' : 'warn')
                });
            }
        });
    }

    function adrFormModal(id) {
        var a = id ? db.get('addresses', id) : null;
        var approved = a && a.status === 'approved';
        var b = branch();
        ui.formModal({
            title: a ? (approved ? '修改已通过地址（需重新过审）' : '修改派送地址') : '新建派送地址',
            sub: a ? esc(a.phone) + ' · ' + esc((a.city || '') + (a.district || '') + (a.detail || '')) + '（' + esc(TMS.address.labelOf(a.status)) + '）'
                : '按手机号建档：城市定归属网点、区镇定片区、门牌定能否送到门口',
            notice: a && approved
                ? '已通过的地址改完会退回「待审核」，改动以审查记录留档，运营端复审通过前这个手机号不能按地址派送。'
                : '缺项可以先提交（系统会给出规范缺口），但审核会打回；被打回的地址由巡检定时通知回本网点。',
            fields: [
                { key: 'phone', label: '收件手机号', required: true, value: a ? a.phone : '', placeholder: '11 位手机号' },
                { key: 'receiver', label: '收件人', value: a ? (a.receiver || '') : '', placeholder: b.name || '' },
                { key: 'address', label: '完整地址', type: 'textarea', rows: 2, span: 2, required: true, value: a ? ((a.city || '') + (a.district || '') + (a.detail || '')) : '', placeholder: '例如 ' + esc((b.city || '城市') + ' + 区/镇 + 街道 + 门牌 + 楼栋单元') },
                { key: 'note', label: '本次说明', span: 2, placeholder: '打回后改了什么，会进审查记录' }
            ],
            okText: a ? '保存并重新提交' : '提交审核',
            onSubmit: function (v) {
                var p = TMS.address.parse(v.address);
                if (!p.city) return '地址里认不出服务城市，无法归属网点：请带上城市名（本网点在 ' + (b.city || '未知城市') + '）';
                var act = po.actor(sess());
                var res = a
                    ? TMS.address.maintain(a.id, { phone: v.phone, receiver: v.receiver, address: v.address, actor: act, force: approved })
                    : TMS.address.create({ phone: v.phone, receiver: v.receiver, address: v.address, actor: act, source: '网点维护' });
                if (!res.ok) return res.message;
                var row = res.row || TMS.address.get(a.id);
                var issues = row.issues || [];
                ui.toast(issues.length ? '已提交，规范体检还有 ' + issues.length + ' 项缺口：' + issues[0] : '已提交，等待运营端审核',
                    issues.length ? 'warn' : 'success');
                if (a) for (var i = 0; i < 2; i++) ui.closeTop();
            }
        });
    }

    pg.define('b-address', {
        sub: '本网点的派送地址簿：提交 → 运营端审核 → 通过后才算可派送依据（图1 左支、图2 状态机）',
        load: function (ctx) {
            var rows = adrAll();
            var mine = adrMine(rows);
            var ok = rows.filter(function (r) { return r.status === 'approved'; });
            return {
                rows: rows, mine: mine, ok: ok, b: branch(),
                phones: util.unique(rows.map(function (r) { return r.phone; })).length,
                reject: rows.filter(function (r) { return r.status === 'revise'; }),
                wait: rows.filter(function (r) { return r.overdue; }).length,
                /* 地址之外的件能不能送，问的是机构派送围栏，不是「本市有没有随便一张围栏」 */
                fence: TMS.network.fenceOfCity((branch().city) || '', 'branch')
            };
        },
        render: function (ctx, d) {
            var b = d.b;
            var kpi = ui.kpis([
                { label: '本网点在档', value: d.rows.length, unit: '条', icon: '⌖', sub: esc(b.city || '城市待定') + ' · 覆盖 ' + d.phones + ' 个手机号' },
                { label: '已通过可派送', value: d.ok.length, unit: '条', icon: '✓', tone: 'success', sub: '占在档 ' + util.pct(d.ok.length, d.rows.length) + '%' },
                { label: '待运营端审核', value: d.rows.filter(function (r) { return r.status === 'pending'; }).length, unit: '条', icon: '◷', tone: 'info', sub: '超 ' + TMS.cfg.sla.addressReviewHours + ' 小时 ' + d.rows.filter(function (r) { return r.status === 'pending' && r.overdue; }).length + ' 条' },
                { label: '打回待我修改', value: d.reject.length, unit: '条', icon: '✎', tone: d.reject.length ? 'danger' : 'success', sub: '超 ' + TMS.cfg.sla.addressFixHours + ' 小时未改 ' + d.rows.filter(function (r) { return r.status === 'revise' && r.overdue; }).length + ' 条' },
                { label: '返工中待复审', value: d.rows.filter(function (r) { return r.status === 'revised'; }).length, unit: '条', icon: '⟳', tone: 'muted', sub: '改完提交即进复审' },
                { label: '本城市在用派送围栏', value: d.fence ? 1 : 0, unit: '张', icon: '⬡', tone: d.fence ? 'success' : 'warn', sub: (d.fence ? esc(d.fence.name) + ' · ' + pg.fenceGeomCell(d.fence) : '没有围栏时地址之外的件只能自提') }
            ]);
            var rejectCard = ui.card({
                title: '被打回的地址', tone: d.reject.length ? 'danger' : '', flat: true,
                tools: d.reject.length ? ui.btn('全部去修改', { size: 'sm', tone: 'primary', act: 'badr:fixAll' }) : '',
                body: d.reject.length ? ui.list(d.reject.slice(0, 8).map(function (r) {
                    return {
                        title: '<span class="tms-mono">' + esc(r.phone) + '</span> ' + ui.badge(r.statusLabel, 'danger', { dot: true }) +
                            (r.overdue ? ' ' + ui.badge('压了 ' + r.waitHours + ' 小时', 'warn') : ''),
                        sub: esc(r.full) + '<br>打回原因：' + esc(r.rejectReason || '未写明'),
                        act: 'badr:edit', arg: r.id,
                        right: ui.btn('修改', { size: 'sm', tone: 'primary', act: 'badr:edit', arg: r.id })
                    };
                })) : ui.empty('没有被打回的地址', '提交后运营端若判定不规范，会退回这里并写明缺什么', '✓'),
                foot: '图2：打回 → 生成审核记录 → 巡检定时通知到「有维护地址权限的人」，本网点就是收件人'
            });
            return po.wrap(ctx, {
                actions: ui.btn('查是否可派送', { act: 'badr:check', icon: '⌕' }) +
                    ui.btn('新建地址', { tone: 'primary', act: 'badr:new', icon: '+' }),
                sub: esc(b.name || '本网点') + ' · 在档 ' + d.rows.length + ' 条 · 待办 ' + d.mine.length + ' 条（其中超阈值 ' + d.wait + ' 条）',
                body: [
                    kpi,
                    po.grid(ctx, {
                        title: '本网点派送地址', sub: '点行看审核与审查记录；一条地址 = 一个手机号下的一条可派送记录',
                        rows: d.rows, keyName: 'id', onRow: 'badr:open', searchKey: 'q',
                        search: adrSearch, filter: adrFilter, unit: '条', pageSize: 10,
                        fields: [
                            { key: 'q', type: 'search', label: '手机号 / 地址 / 收件人' },
                            { key: 'status', label: '状态', options: [{ value: '', label: '全部状态' }].concat(TMS.address.FLOW.map(function (s) { return { value: s, label: TMS.address.labelOf(s) }; })) },
                            { key: 'wait', label: '超阈值', options: [{ value: '', label: '不限时长' }, { value: '1', label: '只看超阈值' }] }
                        ],
                        chips: [{ label: '全部', value: '', count: d.rows.length }].concat(TMS.address.FLOW.map(function (s) {
                            return { label: TMS.address.labelOf(s), value: s, count: d.rows.filter(function (r) { return r.status === s; }).length };
                        })),
                        chipsName: 'status',
                        tools: ui.btn('新建地址', { size: 'sm', tone: 'primary', act: 'badr:new', icon: '+' }),
                        columns: [
                            {
                                key: 'phone', label: '手机号 / 收件人', width: '146px', render: function (r) {
                                    return '<span class="tms-mono">' + esc(r.phone) + '</span><div class="tms-dim">' + (r.receiver ? esc(r.receiver) : '未填收件人') + '</div>';
                                }
                            },
                            {
                                key: 'full', label: '派送地址', render: function (r) {
                                    return ui.link(esc(r.full || '（地址待补）'), 'badr:open', r.id) +
                                        (r.branchName ? '' : '<div class="tone-danger">未能归属网点，请补齐城市</div>') +
                                        (r.rejectReason ? '<div class="tone-danger">打回：' + esc(r.rejectReason) + '</div>' : '');
                                }
                            },
                            {
                                key: 'status', label: '状态', width: '104px', sortable: false, render: function (r) {
                                    return ui.badge(r.statusLabel, { pending: 'warn', revise: 'danger', revised: 'info', approved: 'success' }[r.status], { dot: true });
                                }
                            },
                            {
                                key: 'waitHours', label: '停留', align: 'right', width: '92px', render: function (r) {
                                    return '<span class="' + (r.overdue ? 'tone-danger' : '') + '">' + r.waitHours + ' 小时</span>';
                                }
                            },
                            {
                                key: 'rounds', label: '轮次', align: 'right', width: '96px', render: function (r) {
                                    return r.rounds ? r.rounds + ' 轮 · ' + r.records + ' 记录' : '<span class="tms-dim">' + r.maintainCount + ' 次提交</span>';
                                }
                            },
                            {
                                key: 'ops', label: '操作', align: 'right', width: '116px', sortable: false, render: function (r) {
                                    if (r.status === 'approved') return ui.link('发起复审', 'badr:edit', r.id);
                                    return ui.link('修改', 'badr:edit', r.id) + ' ' + ui.link('催审', 'badr:urge', r.id);
                                }
                            }
                        ],
                        emptyText: '本网点还没有派送地址', emptySub: '点「新建地址」按手机号建档，提交后由运营端审核'
                    }),
                    rejectCard,
                    ui.card({
                        title: '口径说明', flat: true,
                        body: ui.desc([
                            { label: '为什么要先审', value: '地址是一线按手机号取到的派送依据。没过审就拿来派，等于把一个没核过的字符串直接送到派送员手上，错一次就是一趟空跑' },
                            { label: '网点能做什么', value: '新建、修改、催审、发起复审；「通过 / 打回」是运营端的动作（address:review），本网点没有这两个按钮，也不该有' },
                            { label: '被打回之后', value: '状态进「待修改」，改完提交自动进「已修改」等复审；已修改再被打回会退回待修改并重新计轮次，每一轮都有留痕' },
                            { label: '已通过为什么还要复审', value: '点「发起复审」会把状态退回待审核并留一份审查快照——地址搬了家、门牌写错，历史结论不能替现在背书' },
                            { label: '判定链', value: '图1 左支：有通过地址 → 可派送；有地址没通过 → 先改先审；没有地址 → 看机构派送围栏，不在网内就「不可派送需自提」' },
                            { label: '时限', value: '待审核超 ' + TMS.cfg.sla.addressReviewHours + ' 小时催运营端，打回后超 ' + TMS.cfg.sla.addressFixHours + ' 小时算本网点滞留' }
                        ])
                    })
                ]
            });
        },
        actions: {
            'badr:open': function (id) { pg.addressDrawer(id, { edit: 'badr:edit', reopen: 'badr:edit', orders: 'badr:orders' }); },
            'badr:new': function () { adrFormModal(''); },
            'badr:edit': function (id) { adrFormModal(id); },
            'badr:check': function () { adrCheckModal(''); },
            'badr:urge': function (id) {
                var r = adrAll().filter(function (x) { return x.id === id; })[0];
                if (!r) return;
                if (r.status === 'approved') { ui.toast('该地址已通过审核，无需催审', 'info'); return; }
                ui.toast('已向运营端催审：' + r.phone + '（停留 ' + r.waitHours + ' 小时）', 'success');
                TMS.audit.log('address.maintain', 'addresses', id, '网点催审 ' + r.phone + '，当前「' + r.statusLabel + '」已 ' + r.waitHours + ' 小时', po.actor(sess()));
            },
            'badr:fixAll': function () {
                var list = adrAll().filter(function (r) { return r.status === 'revise'; });
                if (!list.length) { ui.toast('没有待修改的地址', 'info'); return; }
                adrFormModal(list[0].id);
            },
            'badr:orders': function (phone) { TMS.shell.go('b-order', { q: String(phone).slice(-4) }); }
        }
    });

    /* ---------- 派送围栏（图1 里的两层：机构派送围栏 + 派送员编号围栏） ----------
       网点勾不出到货围栏：那张圈挂的是分拨场地，属于总部规划的干线前提。
       本城这两层却是网点自己的事——送不送、谁去送，勾错一线就跑空，所以这一页只列本城、只许本城。
       判定与建档全部走 registry + network：与运营端同一套几何、同一份字典，
       两端各写一遍就会出现「运营端说可派送、网点端说要自提」 */

    var GF_ALLOW = TMS.cfg.fence.BRANCH_TYPES;
    var bGfMap = null;

    function gfCity() { return branch().city || ''; }

    function gfMine() {
        var city = gfCity();
        if (!city) return [];
        return db.col('geofences').filter(function (g) {
            return g.city === city && GF_ALLOW.indexOf(g.type) > -1;
        });
    }

    /* 编号围栏挂的是人，人属于网点；本城别的网点的格子照常显示在地图上，但只有它的归属网点能改 */
    function gfMineEditable(list) {
        return (list || gfMine()).filter(function (g) {
            if (g.type === 'branch') return true;
            var e = db.get('employees', g.refId);
            return !e || e.orgId === orgId();
        });
    }

    function gfStaff() {
        return db.col('employees').filter(function (e) {
            return e.role === 'deliveryman' && e.status === 'active' && e.orgId === orgId();
        }).map(function (e) {
            var fences = TMS.network.fencesOfCourier(e.id);
            var assigned = db.col('orders').filter(function (o) {
                return o.courierId === e.id && ['delivering', 'signed'].indexOf(o.status) > -1;
            }).length;
            return {
                id: e.id, name: e.name, badge: e.badge, position: e.position || '派送员',
                fences: fences.length, fenceNames: fences.map(function (g) { return g.name; }),
                areaKm2: util.round(util.sum(fences, 'areaKm2'), 2), assigned: assigned
            };
        });
    }

    /* 页内状态兜住绘制类型与选中项：深链、上一版残留的码都可能带进认不出的值 */
    function gfState() {
        var st = ui.state('b-geofence');
        if (GF_ALLOW.indexOf(st.gfDrawType) < 0) st.gfDrawType = 'branch';
        if (st.gfSelected && !db.get('geofences', st.gfSelected)) st.gfSelected = '';
        return st;
    }

    function gfForm(id, opts) {
        var o = opts || {};
        pg.fenceFormModal(id, {
            points: o.points, type: o.type, city: gfCity(), cityLock: true, allowTypes: GF_ALLOW,
            days: 30, actor: po.actor(sess())
        });
    }

    /* 选中一张围栏：只重画地图、只改那一块详情，不整页刷新——
       刷新会销毁重建 Leaflet 实例，用户刚拖平的视野立刻飞回全国 */
    function gfPick(id) {
        var st = gfState();
        st.gfSelected = st.gfSelected === id ? '' : id;
        var g = st.gfSelected ? db.get('geofences', st.gfSelected) : null;
        if (bGfMap) { bGfMap.sync(gfMine(), st.gfSelected); if (g) bGfMap.focusFence(g); }
        var box = document.querySelector('[data-gf-focus]');
        if (!box) return;
        if (!g) { box.innerHTML = ui.empty('没有选中围栏', '在地图上点一块边界，或在下面表格里点围栏名'); return; }
        var own = gfMineEditable([g]).length > 0;
        box.innerHTML = ui.stack([
            ui.desc([
                { label: '围栏', value: esc(g.name) + ' ' + ui.idCell(g.id, '') },
                { label: '回答的问题', value: esc(TMS.cfg.fence.ASKS[g.type] || g.type) },
                { label: '绑定对象', value: esc(pg.fenceRefName(g)) },
                { label: '图形', value: pg.fenceGeomCell(g) },
                { label: '罩住城市', value: (function () {
                    var c = TMS.network.citiesInFence(g);
                    return c.length ? esc(util.unique(c.map(function (x) { return x.name; })).join('、')) : ui.badge('一座也没有', 'danger');
                })() },
                { label: '状态', value: pg.statusBadge(g.status, TMS.cfg.fence.STATUS) + (own ? '' : ' ' + ui.badge('归属其他网点', 'muted')) }
            ]),
            '<div class="tms-row">' + ui.btn('打开详情', { tone: 'primary', size: 'sm', act: 'bgf:open', arg: g.id }) +
            (own ? ui.btn('在这张上改边界', { size: 'sm', act: 'bgf:redraw', arg: g.id }) +
                ui.btn(g.status === 'active' ? '停用' : '启用', { size: 'sm', act: 'bgf:toggle', arg: g.id })
                : '<span class="tms-dim">不是本网点勾的，只能看</span>') + '</div>'
        ]);
    }

    function gfRedraw(id) {
        var g = db.get('geofences', id);
        if (!g) return;
        if (!gfMineEditable([g]).length) { ui.toast('这张围栏不归属本网点，改不了', 'warn'); return; }
        var st = gfState();
        st.gfSelected = id;
        if (!bGfMap || bGfMap.offline) {
            ui.toast('地图组件没加载出来，这次改不了边界；可以编辑档案里的半径', 'warn');
            return;
        }
        bGfMap.sync(gfMine(), id);
        bGfMap.focusFence(g);
        bGfMap.startDraft(TMS.network.fenceRing(g));
        ui.closeTop();
        ui.toast('已带入「' + g.name + '」的 ' + (TMS.network.fenceRing(g) || []).length + ' 个顶点，拖完点「闭合保存」', 'info');
    }

    /* 详情弹窗：网点端只看本城，所以口径说明里不写「罩住几座城市」这种全网数字 */
    function gfDetail(id) {
        var g = db.get('geofences', id);
        if (!g) { ui.toast('未找到围栏 ' + id, 'warn'); return; }
        var geo = TMS.network.geometryOf(g);
        var own = gfMineEditable([g]).length > 0;
        var cities = util.unique(TMS.network.citiesInFence(g).map(function (x) { return x.name; }));
        var probe = pg.fenceProbe(g.city, GF_ALLOW);
        var courier = g.type === 'courier' ? db.get('employees', g.refId) : null;
        var mates = courier ? TMS.network.fencesOfCourier(courier.id) : [];
        var body = [
            ui.kpis([
                { label: '顶点', value: geo.points, unit: geo.kind === 'polygon' ? '个' : '未勾', tone: geo.kind === 'polygon' ? 'success' : 'muted', sub: geo.kind === 'polygon' ? '闭合多边形' : '退回半径判定' },
                { label: geo.kind === 'polygon' ? '勾画面积' : '覆盖半径', value: geo.kind === 'polygon' ? geo.areaKm2 : util.round(geo.radiusM / 1000, 2), unit: geo.kind === 'polygon' ? 'km²' : 'km', tone: 'warn' },
                { label: '罩住城市', value: cities.length, unit: '座', tone: cities.length ? 'success' : 'danger', sub: '按顶点环判定' },
                { label: '本城网点', value: db.col('branches').filter(function (b) { return b.city === g.city; }).length, unit: '个', tone: 'muted' }
            ]),
            ui.card({
                title: '这块边界在回答哪个问题', sub: (TMS.cfg.fence.LABEL[g.type] || g.type) + '：' + TMS.cfg.fence.ASKS[g.type], flat: true,
                body: probe ? ui.list(probe.rows.map(function (r) {
                    return {
                        title: esc(r.ask) + ' ' + r.verdict,
                        sub: esc(r.fence && r.fence.id === g.id ? '本围栏：' + r.fence.name : r.note),
                        right: r.fence ? ui.link('看围栏', 'bgf:open', r.fence.id, { tone: 'ghost' }) : '<span class="tms-dim">未命中</span>'
                    };
                })) : ui.empty('该市不在城市档案里', '围栏挂在一个认不出的城市上，需要运营端重划')
            }),
            ui.card({
                title: '围栏档案', sub: '城市由几何重心反查，不是手填那格说了算', flat: true,
                body: ui.desc([
                    { label: '绑定对象', value: esc(pg.fenceRefName(g)) + (g.refId ? ' ' + ui.idCell(g.refId, '') : '') },
                    { label: '所在城市', value: esc(g.city) + ' · ' + (geo.center ? geo.center.lat + ', ' + geo.center.lng : '无圆心') },
                    { label: '图形', value: pg.fenceGeomCell(g) },
                    { label: '罩住的城市', value: cities.length ? esc(cities.join('、')) : ui.badge('一座也没有', 'danger') },
                    { label: '状态', value: pg.statusBadge(g.status, TMS.cfg.fence.STATUS) },
                    { label: '备注', value: g.note ? esc(g.note) : '<span class="tms-dim">无</span>' },
                    { label: '最近改动', value: g.updatedAt ? fmt.dateTime(g.updatedAt) : '<span class="tms-dim">未记录</span>' }
                ])
            })
        ];
        if (courier) {
            body.push(ui.card({
                title: courier.name + ' 名下编号围栏', sub: mates.length + ' 张 · 一个派送员可以管几片，但一个点只该落进一格', flat: true,
                body: ui.table({
                    dense: true, keyName: 'id', rows: mates,
                    columns: [
                        { key: 'name', label: '片区', sortable: false, render: function (x) { return ui.link(esc(x.name), 'bgf:open', x.id); } },
                        { key: 'shape', label: '图形', sortable: false, render: function (x) { return pg.fenceGeomCell(x); } },
                        { key: 'status', label: '状态', sortable: false, render: function (x) { return pg.statusBadge(x.status, TMS.cfg.fence.STATUS); } }
                    ]
                })
            }));
        }
        var foot = '';
        if (own) {
            foot += ui.btn('改边界', { tone: 'primary', act: 'bgf:redraw', arg: g.id });
            if (geo.kind !== 'polygon') foot += ui.btn('调整半径', { act: 'bgf:resize', arg: g.id });
            foot += ui.btn(g.status === 'active' ? '停用' : '启用', { act: 'bgf:toggle', arg: g.id }) +
                ui.btn('编辑档案', { act: 'bgf:edit', arg: g.id }) +
                ui.btn('删除', { tone: 'danger', act: 'bgf:remove', arg: g.id });
        } else {
            foot += '<span class="tms-dim">这张不由本网点维护</span>';
        }
        ui.modal({ title: g.name, sub: (TMS.cfg.fence.LABEL[g.type] || g.type) + ' · ' + g.city + ' · ' + pg.fenceGeomCell(g), body: ui.stack(body), footer: foot + ui.btn('关闭', { act: 'ui:close' }) });
    }

    function gfToggle(id) {
        var g = db.get('geofences', id);
        if (!g) return;
        if (!gfMineEditable([g]).length) { ui.toast('这张围栏不归属本网点', 'warn'); return; }
        var res = TMS.network.saveFence({ id: id, status: g.status === 'active' ? 'disabled' : 'active' }, po.actor(sess()));
        if (!res.ok) { ui.toast(res.message, 'warn'); return; }
        var out = TMS.jobs.run('fenceCoverage').out || {};
        ui.toast('已' + (g.status === 'active' ? '停用' : '启用') + '，本城判定立即生效；缺派送围栏的城市剩 ' + out.gap + ' 座', 'success');
        TMS.shell.refresh();
    }

    function gfRemove(id) {
        var g = db.get('geofences', id);
        if (!g) { ui.toast('未找到围栏 ' + id, 'warn'); return; }
        if (!gfMineEditable([g]).length) { ui.toast('这张围栏不归属本网点，删不掉', 'warn'); return; }
        ui.confirm({
            title: '删除围栏「' + g.name + '」',
            message: '删除不可逆：本城的收件点会立刻判成「不在派送范围内」，绑定它的派送员编号也会跟着失效。',
            detail: (TMS.cfg.fence.LABEL[g.type] || g.type) + ' · ' + pg.fenceGeomCell(g) +
                '<br>只是暂时不想让它参与判定的话，用「停用」——停用保留边界，随时能启用。',
            danger: true
        }).then(function (yes) {
            if (!yes) return;
            var res = TMS.network.removeFence(id, po.actor(sess()));
            if (!res.ok) { ui.toast(res.message, 'warn'); return; }
            var out = TMS.jobs.run('fenceCoverage').out || {};
            ui.toast('已删除围栏，当前缺派送围栏的城市 ' + out.gap + ' 座', 'success');
            TMS.shell.refresh();
        });
    }

    /* 一线接电话最常见的问题：这个地址你们送不送、送到谁手上。
       地址解析只到城市粒度（站点没有地理编码），所以答的是「这个城市这一格」，
       并把答案的边界摊开给人看，而不是只回一句能/不能 */
    function gfCheckModal(addr) {
        ui.formModal({
            title: '查一个地址落在哪一格', sub: '图1 两层判定：先看在不在机构派送围栏里，再看落进哪位派送员的编号围栏',
            fields: [{ key: 'addr', label: '收件地址', required: true, span: 2, value: addr || '', placeholder: '例：' + (gfCity() || '本城') + 'XX区XX路88号' }],
            okText: '判定',
            onSubmit: function (v) {
                var p = TMS.address.parse(v.addr);
                var city = p.city || '';
                if (!city) return '地址里认不出城市名，请写成「城市 + 区 + 路」的完整地址';
                var rows = [{ label: '解析到', value: esc(city) + ' ' + esc(p.district || '') + ' ' + esc(p.detail || '') }];
                if (city !== gfCity()) {
                    rows.push({ label: '归属', value: ui.badge('不是本网点的服务城市', 'warn') + '<span class="tms-dim"> 本网点只维护 ' + esc(gfCity() || '城市待定') + ' 的边界，外市件由目的城市网点负责</span>' });
                }
                var pr = pg.fenceProbe(city, GF_ALLOW);
                if (!pr) { rows.push({ label: '判定', value: ui.badge('认不出这座城市', 'danger') }); }
                else pr.rows.forEach(function (r) {
                    rows.push({ label: r.ask, value: r.verdict + '<div class="tms-dim">' + esc(r.note) + '</div>' });
                });
                ui.modal({
                    title: '判定结果 · ' + esc(city),
                    sub: '样本点取城市质心：' + pr.point.lat + ', ' + pr.point.lng,
                    body: ui.desc(rows),
                    footer: (pr.rows[0] && pr.rows[0].fence ? ui.btn('改这块边界', { tone: 'primary', size: 'sm', act: 'bgf:redraw', arg: pr.rows[0].fence.id }) : '') +
                        ui.btn('关', { act: 'ui:close' })
                });
            }
        });
    }

    pg.define('b-geofence', {
        sub: '本城的派送围栏与派送员编号围栏：在地图上勾出来，不是填一个半径（图1 左支、右支各管一层）',
        load: function (ctx) {
            var city = gfCity();
            var list = gfMine();
            var staff = gfStaff();
            var branchFences = list.filter(function (g) { return g.type === 'branch'; });
            var courierFences = list.filter(function (g) { return g.type === 'courier'; });
            var active = list.filter(function (g) { return g.status === 'active'; });
            return {
                city: city, all: list, active: active, branchFences: branchFences, courierFences: courierFences,
                staff: staff, unbound: staff.filter(function (e) { return !e.fences; }),
                legacy: list.filter(function (g) { return g.legacyBox || (g.note || '').indexOf('自动生成') > -1; }),
                drawn: list.filter(function (g) { return TMS.network.fenceRing(g); }).length,
                audit: TMS.network.fenceAudit(30), b: branch()
            };
        },
        afterRender: function (ctx, root) {
            var host = root && root.querySelector('[data-map="1"]');
            if (bGfMap) { try { bGfMap.destroy(); } catch (e) { } bGfMap = null; }
            if (!host) return;
            var st = ctx.state;
            bGfMap = TMS.map.mount(host, {
                fences: gfMine(),
                selected: st.gfSelected || '',
                editable: true,
                onPick: function (id) { gfPick(id); },
                onDraw: function (points) {
                    var sel = st.gfSelected ? db.get('geofences', st.gfSelected) : null;
                    gfForm(sel ? sel.id : '', { points: points, type: sel ? sel.type : gfState().gfDrawType });
                }
            });
        },
        render: function (ctx, d) {
            var st = gfState();
            var probe = d.city ? pg.fenceProbe(d.city, GF_ALLOW) : null;
            var sendRow = probe ? probe.rows.filter(function (r) { return r.type === 'branch'; })[0] : null;
            var bindRow = probe ? probe.rows.filter(function (r) { return r.type === 'courier'; })[0] : null;
            var kpi = ui.kpis([
                {
                    label: '本城在用围栏', value: d.active.length, unit: '张', icon: '⬡',
                    tone: d.active.length ? 'success' : 'danger',
                    sub: esc(d.city || '城市待定') + ' · ' + d.drawn + '/' + d.all.length + ' 张已勾边界'
                },
                {
                    label: TMS.cfg.fence.LABEL.branch, value: d.branchFences.filter(function (g) { return g.status === 'active'; }).length,
                    unit: '张', icon: '⛶', tone: d.branchFences.length ? 'brand' : 'danger',
                    sub: d.branchFences.length ? '送不送就是这张图说的' : '没有它，本城收件点一律判成需自提'
                },
                {
                    label: TMS.cfg.fence.LABEL.courier, value: d.courierFences.filter(function (g) { return g.status === 'active'; }).length,
                    unit: '张', icon: '⑂', tone: d.courierFences.length ? 'success' : 'warn',
                    sub: '本网点 ' + d.staff.length + ' 名派送员 · ' + d.unbound.length + ' 名没格子'
                },
                {
                    label: '没勾片区的派送员', value: d.unbound.length, unit: '人', icon: '☐',
                    tone: d.unbound.length ? 'warn' : 'success',
                    sub: '他们的件全部退回「需手动指定派送编号」'
                },
                {
                    label: '旧版自动边界', value: d.legacy.length, unit: '张', icon: '✎',
                    tone: d.legacy.length ? 'warn' : 'muted',
                    sub: d.legacy.length ? '升级前按圆心画的方框，请到现场重勾' : '边界都是现场勾的'
                },
                {
                    label: '本城越界作业', value: (d.audit.breaches.filter(function (x) { return x.city === d.city; })[0] || { count: 0 }).count,
                    unit: '次', icon: '⚠', tone: d.city ? ((d.audit.breaches.filter(function (x) { return x.city === d.city; })[0] || { count: 0 }).count ? 'danger' : 'success') : 'muted',
                    sub: '近 30 天登记地点写在围栏之外的扫描'
                }
            ]);
            var drawTypes = GF_ALLOW.map(function (t) {
                return ui.btn(TMS.cfg.fence.LABEL[t], { tone: st.gfDrawType === t ? 'primary' : 'ghost', size: 'sm', act: 'bgf:dtype', arg: t });
            }).join(' ');
            var mapCard = ui.card({
                title: '本城围栏地图', icon: '⬡',
                sub: '先选类型再勾边界 · 点地图落顶点，拖红色手柄改顶点 · 地图打不开时下方台账照旧可维护',
                tools: ui.btn('新建当前类型围栏', { tone: 'primary', size: 'sm', act: 'bgf:new', arg: st.gfDrawType, icon: '+' }) +
                    ui.btn('查地址归属', { size: 'sm', act: 'bgf:check', icon: '⌕' }),
                body: '<div class="tms-row" style="margin:0 0 8px"><span class="tms-dim">这次要勾的是</span> ' + drawTypes +
                    '<span class="tms-dim">｜' + esc(TMS.cfg.fence.ASKS[st.gfDrawType]) + '｜只能勾 ' + esc(d.city || '城市待定') + ' 的范围</span></div>' +
                    TMS.map.box({ hint: '当前类型：' + TMS.cfg.fence.LABEL[st.gfDrawType] + ' · 点地图依次落点，≥' + TMS.cfg.fence.minPoints + ' 点后可闭合保存' }) +
                    '<div data-gf-focus>' + (st.gfSelected && db.get('geofences', st.gfSelected) ? '' : ui.empty('没有选中围栏', '在地图上点一块边界，或在下面表格里点围栏名')) + '</div>'
            });
            var judgeCard = ui.card({
                title: '本城现在的判定', icon: '⑂',
                sub: probe ? '这两条答案直接决定客户下单与派单时看到的提示' : '网点档案里还没写服务城市',
                body: probe ? ui.list(probe.rows.map(function (r) {
                    return {
                        title: esc(r.ask) + ' ' + r.verdict,
                        sub: esc(r.note),
                        right: r.fence ? ui.link('看围栏', 'bgf:open', r.fence.id, { tone: 'ghost' }) : '<span class="tms-dim">未命中</span>'
                    };
                })) : ui.empty('说不清本城的范围', '先补网点档案里的服务城市，或在地图上勾一张机构派送围栏'),
                foot: probe ? '<span class="tms-dim">这两条答案此刻正被下游读到：下单页' +
                    (sendRow && sendRow.fence ? '把本城收件点判为可派送' : '把本城收件点判为只能自提') +
                    '，派单时' + (bindRow && bindRow.fence ? '落进格子就自动绑编号' : '落不进格子，全部退回人工指定') + '</span>' : ''
            });
            var staffCard = ui.card({
                title: '派送员的片区', icon: '☐',
                sub: d.staff.length + ' 名在册派送员 · 一格都没有的人，派单时全靠人工指',
                tools: d.unbound.length ? ui.btn('先给「' + d.unbound[0].name + '」勾一格', { tone: 'primary', size: 'sm', act: 'bgf:courier', arg: d.unbound[0].id }) : '',
                body: d.staff.length ? ui.table({
                    dense: true, keyName: 'id', rows: d.staff,
                    columns: [
                        { key: 'name', label: '派送员', sortable: false, render: function (e) { return '<b>' + esc(e.name) + '</b> <span class="tms-dim">' + esc(e.badge || '') + ' · ' + esc(e.position) + '</span>'; } },
                        {
                            key: 'fences', label: '编号围栏', align: 'right', width: '104px', sortable: false,
                            render: function (e) { return e.fences ? ui.badge(e.fences + ' 张 · ' + e.areaKm2 + ' km²', 'success') : ui.badge('一格都没有', 'warn'); }
                        },
                        {
                            key: 'fenceNames', label: '片区', sortable: false,
                            render: function (e) {
                                return e.fenceNames.length ? e.fenceNames.map(function (n, i) {
                                    return ui.link(esc(n), 'bgf:open', (TMS.network.fencesOfCourier(e.id)[i] || {}).id, { tone: 'ghost' });
                                }).join(' ') : '<span class="tms-dim">未勾画</span>';
                            }
                        },
                        { key: 'assigned', label: '在途/已签收', align: 'right', width: '116px', sortable: false, render: function (e) { return fmt.number(e.assigned) + ' 单'; } },
                        {
                            key: 'ops', label: '操作', align: 'right', width: '104px', sortable: false,
                            render: function (e) {
                                return gfMineEditable(db.col('geofences').filter(function (g) { return g.type === 'courier' && g.refId === e.id; })).length
                                    ? ui.link('改片区', 'bgf:redraw', (TMS.network.fencesOfCourier(e.id)[0] || {}).id, { tone: 'ghost' })
                                    : ui.link('勾一格', 'bgf:courier', e.id, { tone: 'ghost' });
                            }
                        }
                    ]
                }) : ui.empty('本网点没有在册派送员', '人事异动由运营端发起；这里只勾他们已经负责的片区')
            });
            var listCard = po.grid(ctx, {
                title: '本城围栏台账', sub: '勾过的按顶点环判定，只填半径的按圆判定；状态决定是否参与判定',
                rows: d.all, keyName: 'id', onRow: 'bgf:open', searchKey: 'q',
                search: function (r) { return [r.id, r.name, r.city, pg.fenceRefName(r)].join(' '); },
                filter: function (r, f) {
                    if (f.type && r.type !== f.type) return false;
                    if (f.shape === 'polygon' && !TMS.network.fenceRing(r)) return false;
                    if (f.shape === 'circle' && TMS.network.fenceRing(r)) return false;
                    return true;
                },
                fields: [
                    { key: 'q', type: 'search', label: '编号 / 名称 / 绑定对象' },
                    {
                        key: 'type', label: '类型', options: [{ value: '', label: '全部类型' }].concat(GF_ALLOW.map(function (t) {
                            return { value: t, label: TMS.cfg.fence.LABEL[t] };
                        }))
                    },
                    {
                        key: 'shape', label: '图形', options: [
                            { value: '', label: '全部图形' }, { value: 'polygon', label: '勾画边界' }, { value: 'circle', label: '半径圆' }
                        ]
                    }
                ],
                chips: [{ label: '全部', value: '', count: d.all.length }].concat(
                    ['active', 'disabled', 'draft'].map(function (s) {
                        return { label: TMS.cfg.fence.STATUS[s], value: s, count: d.all.filter(function (g) { return g.status === s; }).length };
                    })),
                chipsName: 'status',
                tools: ui.btn('新建围栏', { size: 'sm', tone: 'primary', act: 'bgf:new', arg: st.gfDrawType, icon: '+' }),
                columns: [
                    {
                        key: 'name', label: '围栏', render: function (r) {
                            return ui.link(esc(r.name), 'bgf:open', r.id) +
                                '<div class="tms-dim">' + esc(TMS.cfg.fence.LABEL[r.type] || r.type) + ' · ' + esc(pg.fenceRefName(r)) + '</div>' +
                                (r.legacyBox ? '<div class="tone-danger">旧版自动画的方框，建议重勾</div>' : '');
                        }
                    },
                    {
                        key: 'areaKm2', label: '图形', width: '150px', render: function (r) {
                            var geo = TMS.network.geometryOf(r);
                            return (geo.kind === 'polygon' ? ui.badge('勾画', 'success') : ui.badge('半径', 'muted')) +
                                '<div class="tms-dim">' + esc(pg.fenceGeomCell(r)) + '</div>';
                        }
                    },
                    {
                        key: 'status', label: '状态', width: '104px', sortable: false,
                        render: function (r) { return pg.statusBadge(r.status, TMS.cfg.fence.STATUS); }
                    },
                    {
                        key: 'updatedAt', label: '最近改动', align: 'right', width: '132px',
                        render: function (r) { return r.updatedAt ? '<span class="tms-nowrap">' + fmt.dateTime(r.updatedAt) + '</span>' : '<span class="tms-dim">—</span>'; }
                    },
                    {
                        key: 'ops', label: '操作', align: 'right', width: '168px', sortable: false, render: function (r) {
                            if (!gfMineEditable([r]).length) return '<span class="tms-dim">归属其他网点</span>';
                            return ui.link('勾边界', 'bgf:redraw', r.id, { tone: 'ghost' }) + ' ' +
                                ui.link('编辑', 'bgf:edit', r.id, { tone: 'ghost' }) + ' ' +
                                ui.link(r.status === 'active' ? '停用' : '启用', 'bgf:toggle', r.id, { tone: 'ghost' });
                        }
                    }
                ],
                emptyText: d.city ? '本城还没有围栏' : '网点档案没写服务城市',
                emptySub: d.city ? '在地图上勾一块边界，本网点才答得出「这个地址送不送」' : '先由运营端补齐网点档案的城市'
            });
            return po.wrap(ctx, {
                actions: ui.btn('新建围栏', { tone: 'primary', act: 'bgf:new', arg: st.gfDrawType, icon: '+' }) +
                    ui.btn('查地址归属', { act: 'bgf:check', icon: '⌕' }),
                sub: esc(d.b.name || '本网点') + ' · 服务城市 ' + esc(d.city || '待定') + ' · 在用 ' + d.active.length +
                    ' 张 · ' + d.drawn + '/' + d.all.length + ' 张已勾边界 · 未挂片区派送员 ' + d.unbound.length + ' 人',
                body: [
                    kpi, mapCard, ui.split('2', [judgeCard, staffCard]), listCard,
                    ui.card({
                        title: '口径说明', flat: true,
                        body: ui.desc([
                            { label: '这一页只管两层', value: '图1 的到货围栏挂在分拨场地上，是总部规划的干线前提，网点改不动也不该改；本网点能勾的是「送不送」的机构派送围栏和「谁去送」的派送员编号围栏' },
                            { label: '为什么只能勾本城', value: '边界决定的是本网点的揽派范围，勾到邻市去就会替别的网点做出派送承诺。城市一栏锁死在网点档案的服务城市上' },
                            { label: '勾画怎么算', value: '顶点环用射线法判点在不在内，面积按纬度收缩后的鞋带公式算。只填半径的围栏退回圆判定，两者在判定上等价，所以老围栏不必一次改完' },
                            { label: '半径和边界只能选一个', value: '勾过边界的围栏，半径不再参与判定，只当展示——所以那张围栏的详情里不会出现「调整半径」这个假入口' },
                            { label: '改完会怎样', value: '保存即写回并重跑覆盖巡检：本城收件点的可派送判定、派单时的自动绑编号、客户端「电子围栏覆盖」那一栏当场跟着变，不用等第二天' },
                            { label: '编号围栏为什么重要', value: '它对应图1 右支中间那一格：收件点落进谁的格子就自动绑谁的编号。一格都没有时，这些派送员的每一件都要人工指派——不是系统算不出，是没人告诉它这片归谁' },
                            { label: '停用而不是删除', value: '停用保留边界、随时能启用，只是不再参与判定；删除会让本城的收件点立刻判成需自提，边界数据也找不回来' },
                            { label: '地图打不开怎么办', value: '围栏不依赖地图也能维护：台账里的编辑入口照样能改名称、绑定、半径与状态，勾画等设备能连到 CDN 再补' }
                        ])
                    })
                ]
            });
        },
        actions: {
            'bgf:open': function (id) { if (db.get('geofences', id)) gfDetail(id); },
            'bgf:edit': function (id) { if (db.get('geofences', id)) gfForm(id); },
            'bgf:new': function (type) { gfForm('', { type: GF_ALLOW.indexOf(type) > -1 ? type : gfState().gfDrawType }); },
            'bgf:redraw': function (id) { if (id) gfRedraw(id); },
            'bgf:toggle': function (id) { if (id) gfToggle(id); },
            'bgf:remove': function (id) { if (id) gfRemove(id); },
            'bgf:resize': function (id) {
                var g = db.get('geofences', id);
                if (!g) return;
                if (!gfMineEditable([g]).length) { ui.toast('这张围栏不归属本网点', 'warn'); return; }
                var cities = util.unique(TMS.network.citiesInFence(g).map(function (x) { return x.name; }));
                pg.fenceResizeModal(id, {
                    actor: po.actor(sess()),
                    sub: '当前 ' + fmt.number(g.radiusM) + ' m，罩住 ' + (cities.length ? cities.join('、') : '一座城市也没有'),
                    notice: '半径只在这张围栏没勾边界时参与判定；要贴合真实范围，请在地图上勾。'
                });
            },
            'bgf:dtype': function (type) {
                if (GF_ALLOW.indexOf(type) < 0) return;
                var st = gfState();
                st.gfDrawType = type;
                if (bGfMap) bGfMap.sync(gfMine(), st.gfSelected || '');
                ui.toast('接下来勾画的是' + TMS.cfg.fence.LABEL[type] + '：' + TMS.cfg.fence.ASKS[type], 'info');
            },
            'bgf:check': function () { gfCheckModal(''); },
            /* 给一名还没片区的派送员起一张编号围栏：名称与绑定直接带好人，
               省得在表单里手打工号——绑错人等于把件交给不送这条线的人 */
            'bgf:courier': function (empId) {
                var e = db.get('employees', empId);
                if (!e || e.role !== 'deliveryman') { ui.toast('要绑的对象不是在册派送员', 'warn'); return; }
                var st = gfState();
                st.gfDrawType = 'courier';
                st.gfSelected = '';
                pg.fenceFormModal('', {
                    type: 'courier', city: gfCity(), cityLock: true, allowTypes: GF_ALLOW, days: 30,
                    actor: po.actor(sess()), preset: { name: e.name + '（' + (e.badge || e.id) + '）责任片区', refId: e.id }
                });
            }
        }
    });

    pg.define('b-system', {
        load: function () {
            var b = branch(), hub = hubId();
            return {
                b: b, hub: db.get('hubs', hub) || {},
                staff: db.col('employees').filter(function (e) { return e.orgId === b.id; }),
                devices: db.col('devices').filter(function (x) { return x.orgId === b.id; }),
                fence: TMS.network.fenceOfCity(b.city, 'branch'),
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
                                { label: '本城派送围栏', value: esc(d.fence.name || d.fence.city || b.city) },
                                { label: '边界', value: pg.fenceGeomCell(d.fence) },
                                { label: '围栏状态', value: ui.badge(esc(pg.GF_STATUS_TEXT[d.fence.status] || d.fence.status), d.fence.status === 'active' ? 'success' : 'warn') }
                            ], { inline: true }) : ui.notice('本网点所在城市没有在用派送围栏，超范围的收件地址只能到网点自提', 'warn'),
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
