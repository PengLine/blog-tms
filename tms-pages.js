/**
 * TMS 管理员端页面装配
 * ------------------------------------------------------------
 * 将各业务页统一装配为“KPI + 图表 + 可筛选分页表格 + CRUD 操作”的结构。
 * 每个页面只需在 DOMContentLoaded 中调用 TmsPages.render('<pageId>')。
 */
(function (global) {
    'use strict';

    var S = global.TmsStore;
    var U = global.TmsUI;
    var pages = {};

    function define(id, config) {
        pages[id] = config;
    }

    function orderOptions(statuses) {
        return S.list('orders', { sort: { key: 'createdAt', dir: 'desc' }, pageSize: 0 }).rows
            .filter(function (o) { return !statuses || statuses.indexOf(o.status) > -1; })
            .slice(0, 80)
            .map(function (o) {
                return { value: o.id, label: o.id + ' · ' + o.customer + '（' + o.origin + '→' + o.destination + '）' };
            });
    }

    function allOrdersOptions() {
        return S.list('orders', { sort: { key: 'createdAt', dir: 'desc' }, pageSize: 0 }).rows
            .slice(0, 80)
            .map(function (o) {
                return { value: o.id, label: o.id + ' · ' + o.customer };
            });
    }

    function orderLink(orderId) {
        return '<span class="tms-link" data-order-link="' + U.esc(orderId) + '">' + U.esc(orderId) + '</span>';
    }

    function orderDetail(orderId) {
        var order = S.get('orders', orderId);
        if (!order) {
            U.toast('订单不存在', 'error');
            return;
        }
        var typeLabel = { forward: '正向件', reverse: '逆向件', intercept: '拦截件' }[order.orderType] || '正向件';
        var html = U.detailGrid([
            { label: '订单号', value: U.esc(order.id) },
            { label: '运单号', value: U.esc(order.waybillNo) },
            { label: '客户', value: U.esc(order.customer) },
            { label: '订单类型', value: U.badge(typeLabel, order.orderType === 'forward' ? 'info' : (order.orderType === 'reverse' ? 'warn' : 'danger')) },
            { label: '服务等级', value: U.esc(order.service || '标准') },
            { label: '货物', value: U.esc(order.goods) },
            { label: '实际重量', value: U.esc(order.weight) + ' kg' },
            { label: '计费重量', value: (order.chargeableWeight || order.weight) + ' kg' + (order.volumetricWeight ? '（体积重 ' + Math.round(Number(order.volumetricWeight) * 10) / 10 + ' kg）' : '') },
            { label: '件数', value: U.esc(order.pieces) + ' 件' },
            { label: '运费', value: U.fmt.money(order.freight) },
            { label: '付款方式', value: U.esc(order.paymentMethod || '现付') },
            { label: '应收状态', value: order.receivableStatus ? U.statusBadge(order.receivableStatus, 'receivable') : '<span class="tms-muted">未结算</span>' },
            { label: '状态', value: U.statusBadge(order.status, 'order') },
            { label: '始发地', value: U.esc(order.origin) },
            { label: '目的地', value: U.esc(order.destination) },
            { label: '下单时间', value: U.fmt.dateTime(order.createdAt) },
            { label: '预计送达', value: U.fmt.dateTime(order.expectedAt) }
        ]);
        if (order.freightBreakdown) {
            var bd = order.freightBreakdown;
            html += '<div class="tms-panel-head" style="padding:1rem 0 .5rem;border:0"><h3>运费明细</h3></div>' +
                U.detailGrid([
                    { label: '运价卡', value: U.esc(bd.cardName || '-') },
                    { label: '首重', value: U.fmt.money(bd.firstFee) },
                    { label: '续重', value: U.fmt.money(bd.continueFee) + (bd.minimumApplied ? '（触发最低）' : '') },
                    { label: '燃油附加', value: U.fmt.money(bd.fuelFee) },
                    { label: '偏远附加', value: U.fmt.money(bd.remoteFee) },
                    { label: '保价费', value: U.fmt.money(bd.insuredFee) },
                    { label: '到付手续费', value: U.fmt.money(bd.codFee) },
                    { label: '协议折扣', value: bd.discount ? '-' + U.fmt.money(bd.discount) + '（' + Math.round(bd.discountRate * 100) + '%）' : '无' },
                    { label: '合计', value: '<span class="tms-strong">' + U.fmt.money(bd.total) + '</span>' }
                ]);
        }
        var podItems = [];
        if (Number(order.codAmount) > 0) podItems.push({ label: '代收货款', value: U.fmt.money(order.codAmount) + (order.paymentMethod === '到付' ? '（到付代收）' : '') });
        podItems.push({ label: '派送员', value: order.courier ? U.esc(order.courier) : '<span class="tms-muted">未派单</span>' });
        if (order.pod) {
            podItems.push({ label: '签收人', value: U.esc(order.pod.receiver || '-') });
            podItems.push({ label: '回单时间', value: U.fmt.dateTime(order.pod.signedAt) });
            podItems.push({ label: '回单照片', value: order.pod.podPhoto ? U.badge('已上传', 'success') : U.badge('无', 'muted') });
            if (order.pod.podNote) podItems.push({ label: '回单备注', value: U.esc(order.pod.podNote) });
        }
        if (order.courier || order.pod) {
            html += '<div class="tms-panel-head" style="padding:1rem 0 .5rem;border:0"><h3>派送与回单</h3></div>' + U.detailGrid(podItems);
        }
        html += '<div class="tms-panel-head" style="padding:1rem 0 .5rem;border:0"><h3>物流轨迹</h3></div>' + U.timeline(order.timeline || []);
        var m = U.detailModal('订单详情', html);
        m.el.querySelectorAll('[data-act="close"]').forEach(function (btn) {
            btn.addEventListener('click', m.close);
        });
    }

    function bindOrderLinks(root) {
        root.querySelectorAll('[data-order-link]').forEach(function (el) {
            el.addEventListener('click', function (e) {
                e.stopPropagation();
                orderDetail(this.dataset.orderLink);
            });
        });
    }

    function priorityBadge(p) {
        return U.badge(p, p === '高' ? 'danger' : (p === '中' ? 'warn' : 'muted'));
    }

    function gradeBadge(g) {
        return U.badge(g, g === 'A' ? 'success' : (g === 'B' ? 'info' : (g === 'C' ? 'warn' : 'danger')));
    }

    function stockStatus(row) {
        return Number(row.stock) < Number(row.safetyStock) ? 'low' : 'normal';
    }

    function render(id, root) {
        var cfg = pages[id];
        if (!cfg || !root) return;
        root.classList.add('tms-page');
        root.innerHTML = U.pageHeader(cfg.title, cfg.subtitle, '') +
            '<div class="tms-kpis" id="tms-kpis"></div>' +
            (cfg.charts ? '<div class="tms-grid-2" id="tms-charts"></div>' : '') +
            '<div id="tms-extra-before"></div>' +
            '<div class="tms-panel" id="tms-table-panel"></div>' +
            '<div id="tms-extra-after"></div>';
        var page = root;

        function refreshSummary() {
            if (cfg.kpis) U.kpis(page.querySelector('#tms-kpis'), cfg.kpis());
            if (cfg.charts) cfg.charts(page.querySelector('#tms-charts'));
        }

        refreshSummary();
        if (cfg.extraBefore) cfg.extraBefore(page.querySelector('#tms-extra-before'));
        var tableHandle = U.table(page.querySelector('#tms-table-panel'), cfg.table);
        var isRowsMode = cfg.table && (typeof cfg.table.rows === 'function' || Array.isArray(cfg.table.rows));
        if (cfg.extraAfter) cfg.extraAfter(page.querySelector('#tms-extra-after'));
        bindOrderLinks(page);

        S.subscribe(function () {
            refreshSummary();
            // entity 模式的表格会在自身内部订阅自动刷新；rows 模式需在此手动刷新
            if (isRowsMode && tableHandle && tableHandle.refresh) tableHandle.refresh();
            bindOrderLinks(page);
        });
    }

    /* ============================== 异常管理 ============================== */

    define('exception', {
        title: '异常管理',
        subtitle: '监控并处理运输过程中的延迟、破损、丢件等异常，处理结果可联动理赔。',
        kpis: function () {
            var list = S.list('exceptions', { pageSize: 0 }).rows;
            var pending = list.filter(function (x) { return x.status === 'pending'; }).length;
            var processing = list.filter(function (x) { return x.status === 'processing'; }).length;
            var resolved = list.filter(function (x) { return x.status === 'resolved'; }).length;
            return [
                { label: '待处理', value: pending, color: '#ff9800', sub: '需尽快分派处理人' },
                { label: '处理中', value: processing, color: '#2196f3', sub: '已分派，等待闭环' },
                { label: '已解决', value: resolved, color: '#4caf50', sub: '累计闭环异常' },
                { label: '异常总数', value: list.length, color: '#3d4b5c', sub: '全部异常记录' }
            ];
        },
        table: {
            entity: 'exceptions',
            searchPlaceholder: '搜索异常ID/订单号/运单号/类型',
            searchFields: ['id', 'orderId', 'waybillNo', 'type', 'handler'],
            defaultSort: { key: 'occurredAt', dir: 'desc' },
            filters: [
                { key: 'status', label: '全部状态', options: [{ value: 'pending', label: '待处理' }, { value: 'processing', label: '处理中' }, { value: 'resolved', label: '已解决' }] },
                { key: 'type', label: '全部类型', options: ['延迟送达', '货物损坏', '信息不符', '地址错误', '丢件', '拒收'] }
            ],
            columns: [
                { key: 'id', label: '异常ID', width: '150px' },
                { key: 'orderId', label: '订单号', render: function (r) { return orderLink(r.orderId); } },
                { key: 'type', label: '异常类型' },
                { key: 'occurredAt', label: '发生时间', render: function (r) { return U.fmt.dateTime(r.occurredAt); } },
                { key: 'status', label: '状态', render: function (r) { return U.statusBadge(r.status, 'exception'); } },
                { key: 'handler', label: '处理人', render: function (r) { return r.handler ? U.esc(r.handler) : '<span class="tms-muted">未分派</span>'; } }
            ],
            toolbar: [{
                text: '登记异常', className: 'tms-btn tms-btn-primary', onClick: function () {
                    U.formModal({
                        title: '登记异常', width: 620,
                        fields: [
                            { key: 'orderId', label: '关联订单', type: 'select', required: true, options: orderOptions(), placeholder: '请选择订单' },
                            { key: 'type', label: '异常类型', type: 'select', required: true, options: ['延迟送达', '货物损坏', '信息不符', '地址错误', '丢件', '拒收'], placeholder: '请选择类型' },
                            { key: 'description', label: '异常描述', type: 'textarea', full: true, required: true, rows: 3, placeholder: '描述异常发生的时间、地点与影响' }
                        ],
                        submitText: '登记',
                        onSubmit: function (v) {
                            S.createException(v);
                            U.toast('异常已登记，等待处理', 'success');
                        }
                    });
                }
            }],
            actions: [
                {
                    label: '查看', className: 'tms-btn-light', onClick: function (row) {
                        var order = S.get('orders', row.orderId);
                        var html = U.detailGrid([
                            { label: '异常ID', value: U.esc(row.id) },
                            { label: '关联订单', value: U.esc(row.orderId) },
                            { label: '运单号', value: U.esc(row.waybillNo) },
                            { label: '异常类型', value: U.esc(row.type) },
                            { label: '发生时间', value: U.fmt.dateTime(row.occurredAt) },
                            { label: '当前状态', value: U.statusBadge(row.status, 'exception') },
                            { label: '处理人', value: row.handler || '-' },
                            { label: '解决时间', value: row.resolvedAt ? U.fmt.dateTime(row.resolvedAt) : '-' }
                        ]);
                        html += '<div class="tms-note" style="margin-top:1rem">异常描述：' + U.esc(row.description || '-') + '</div>';
                        if (row.resolution) html += '<div class="tms-note" style="margin-top:.6rem">处理结果：' + U.esc(row.resolution) + '</div>';
                        if (order) {
                            html += '<div class="tms-panel-head" style="padding:1rem 0 .5rem;border:0"><h3>订单轨迹</h3></div>' + U.timeline(order.timeline || []);
                        }
                        var m = U.detailModal('异常详情', html);
                        m.el.querySelector('[data-act="close"]').addEventListener('click', m.close);
                    }
                },
                {
                    label: '处理', className: 'tms-btn-warning', show: function (r) { return r.status === 'pending'; },
                    onClick: function (row) {
                        U.formModal({
                            title: '分派异常', width: 480,
                            fields: [{ key: 'handler', label: '处理人', type: 'select', required: true, options: ['运营管理员', '客服主管', '仓储主管', '运输调度'], placeholder: '请选择处理人' }],
                            submitText: '开始处理',
                            onSubmit: function (v) {
                                S.processException(row.id, v.handler);
                                U.toast('已分派给 ' + v.handler, 'success');
                            }
                        });
                    }
                },
                {
                    label: '解决', className: 'tms-btn-success', show: function (r) { return r.status === 'pending' || r.status === 'processing'; },
                    onClick: function (row) {
                        U.formModal({
                            title: '异常闭环', width: 520,
                            fields: [
                                { key: 'resolution', label: '处理结果', type: 'textarea', required: true, full: true, rows: 3, placeholder: '填写与客户协商的处理结果' },
                                { key: 'createClaim', label: '联动理赔', type: 'checkbox', checkboxLabel: '同步创建理赔申请' },
                                { key: 'claimAmount', label: '理赔金额（元）', type: 'number', min: 0, step: 0.01, placeholder: '如勾选联动理赔请填写' }
                            ],
                            submitText: '标记已解决',
                            onSubmit: function (v) {
                                S.resolveException(row.id, v.resolution, {
                                    createClaim: !!v.createClaim,
                                    claimAmount: Number(v.claimAmount) || 0
                                });
                                U.toast(v.createClaim ? '异常已解决，理赔申请已创建' : '异常已解决', 'success');
                            }
                        });
                    }
                }
            ]
        }
    });

    /* ============================== 运输管理 ============================== */

    define('transport', {
        title: '运输管理',
        subtitle: '调度在途运输任务，更新到达与完成状态，订单状态自动联动。',
        kpis: function () {
            var rows = S.list('transports', { pageSize: 0 }).rows;
            return [
                { label: '运输中', value: rows.filter(function (r) { return r.status === 'shipping'; }).length, color: '#2196f3', sub: '干线在途' },
                { label: '已到达', value: rows.filter(function (r) { return r.status === 'arrived'; }).length, color: '#ff9800', sub: '等待派送' },
                { label: '派送中', value: rows.filter(function (r) { return r.status === 'delivering'; }).length, color: '#667eea', sub: '末端配送' },
                { label: '已完成', value: rows.filter(function (r) { return r.status === 'completed'; }).length, color: '#4caf50', sub: '累计完成' }
            ];
        },
        table: {
            entity: 'transports',
            searchPlaceholder: '搜索任务ID/订单号/车牌/司机',
            searchFields: ['id', 'orderId', 'waybillNo', 'origin', 'destination', 'carrier', 'vehicleId', 'driver'],
            defaultSort: { key: 'departAt', dir: 'desc' },
            filters: [
                { key: 'status', label: '全部状态', options: [{ value: 'shipping', label: '运输中' }, { value: 'arrived', label: '已到达' }, { value: 'delivering', label: '派送中' }, { value: 'completed', label: '已完成' }] },
                { key: 'carrier', label: '全部承运商', options: ['顺丰物流', '中通快递', '申通快递', '圆通速递', '德邦物流', '京东物流'] }
            ],
            columns: [
                { key: 'id', label: '运输任务' },
                { key: 'orderId', label: '订单号', render: function (r) { return orderLink(r.orderId); } },
                { key: 'route', label: '线路', render: function (r) { return U.esc(r.origin) + ' → ' + U.esc(r.destination); } },
                { key: 'carrier', label: '承运商' },
                { key: 'vehicleId', label: '车辆', render: function (r) { return U.esc(r.vehicleId) + ' / ' + U.esc(r.driver); } },
                { key: 'departAt', label: '出发时间', render: function (r) { return U.fmt.dateTime(r.departAt); } },
                { key: 'eta', label: '预计到达', render: function (r) { return U.fmt.dateTime(r.eta); } },
                {
                    key: 'progress', label: '进度', render: function (r) {
                        var p = Number(r.progress || 0);
                        return '<div class="tms-progress"><i style="width:' + p + '%"></i></div><span class="tms-muted" style="font-size:.72rem">' + p + '%</span>';
                    }
                },
                { key: 'status', label: '状态', render: function (r) { return U.statusBadge(r.status, 'transport'); } }
            ],
            toolbar: [{
                text: '调度发车', className: 'tms-btn tms-btn-primary', onClick: function () {
                    U.formModal({
                        title: '调度发车', width: 560,
                        fields: [
                            { key: 'orderId', label: '待发运订单', type: 'select', required: true, options: orderOptions(['sorted', 'inbound']), placeholder: '请选择已分拣待发运订单', full: true },
                            { key: 'carrier', label: '承运商', type: 'select', required: true, options: ['顺丰物流', '中通快递', '申通快递', '圆通速递', '德邦物流', '京东物流'], placeholder: '请选择承运商' },
                            { key: 'vehicleId', label: '车辆', type: 'select', required: true, options: S.list('vehicles', { pageSize: 0 }).rows.filter(function (v) { return v.status !== 'maintenance'; }).map(function (v) { return { value: v.id, label: v.plate + ' · ' + v.driver }; }), placeholder: '请选择车辆' }
                        ],
                        submitText: '确认发车',
                        onSubmit: function (v) {
                            var order = S.get('orders', v.orderId);
                            var vehicle = S.get('vehicles', v.vehicleId);
                            S.create('transports', {
                                orderId: order.id, waybillNo: order.waybillNo,
                                origin: order.origin, destination: order.destination,
                                carrier: v.carrier, vehicleId: v.vehicleId,
                                driver: vehicle ? vehicle.driver : '待分配',
                                departAt: new Date().toISOString(), eta: order.expectedAt,
                                status: 'shipping', progress: 0
                            });
                            var guard = 0;
                            while (order.status !== 'shipping' && guard < 6) {
                                S.advanceOrder(order.id, '运输调度');
                                guard++;
                            }
                            U.toast('已调度发车：' + order.id, 'success');
                        }
                    });
                }
            }],
            actions: [
                {
                    label: '查看', className: 'tms-btn-light', onClick: function (row) {
                        var order = S.get('orders', row.orderId);
                        var html = U.detailGrid([
                            { label: '运输任务', value: U.esc(row.id) },
                            { label: '订单号', value: U.esc(row.orderId) },
                            { label: '运单号', value: U.esc(row.waybillNo) },
                            { label: '线路', value: U.esc(row.origin) + ' → ' + U.esc(row.destination) },
                            { label: '承运商', value: U.esc(row.carrier) },
                            { label: '车辆/司机', value: U.esc(row.vehicleId) + ' / ' + U.esc(row.driver) },
                            { label: '出发时间', value: U.fmt.dateTime(row.departAt) },
                            { label: '预计到达', value: U.fmt.dateTime(row.eta) },
                            { label: '状态', value: U.statusBadge(row.status, 'transport') },
                            { label: '进度', value: (row.progress || 0) + '%' }
                        ]);
                        if (order) html += '<div class="tms-panel-head" style="padding:1rem 0 .5rem;border:0"><h3>订单轨迹</h3></div>' + U.timeline(order.timeline || []);
                        var m = U.detailModal('运输任务详情', html);
                        m.el.querySelector('[data-act="close"]').addEventListener('click', m.close);
                    }
                },
                {
                    label: '到达', className: 'tms-btn-warning', show: function (r) { return r.status === 'shipping'; },
                    onClick: function (row) {
                        S.updateTransportStatus(row.id, 'arrived');
                        U.toast('已登记到达：' + row.id, 'success');
                    }
                },
                {
                    label: '完成', className: 'tms-btn-success', show: function (r) { return r.status === 'arrived' || r.status === 'delivering'; },
                    onClick: function (row) {
                        S.updateTransportStatus(row.id, 'completed');
                        U.toast('运输任务已完成，订单已签收', 'success');
                    }
                }
            ]
        }
    });

    /* ============================== 仓储管理 ============================== */

    define('warehouse', {
        title: '仓储管理',
        subtitle: '掌握各仓库容量、今日出入库与库存健康度。',
        kpis: function () {
            var st = S.warehouseStats();
            return [
                { label: '仓库数量', value: st.warehouses, color: '#667eea' },
                { label: '物资种类', value: st.items, color: '#2196f3' },
                { label: '低库存物资', value: st.lowStock, color: '#ff9800', sub: '低于安全库存' },
                { label: '库存总量', value: U.fmt.number(st.stockTotal), color: '#4caf50', sub: '今日入 ' + st.inboundToday + ' / 出 ' + st.outboundToday }
            ];
        },
        table: {
            entity: 'warehouses',
            searchPlaceholder: '搜索仓库/城市/负责人',
            searchFields: ['id', 'name', 'city', 'manager'],
            columns: [
                { key: 'id', label: '仓库ID' },
                { key: 'name', label: '仓库名称' },
                { key: 'city', label: '城市' },
                { key: 'manager', label: '负责人' },
                { key: 'area', label: '面积（㎡）', render: function (r) { return U.fmt.number(r.area); } },
                {
                    key: 'usedRate', label: '使用率', render: function (r) {
                        return '<div class="tms-progress"><i style="width:' + r.usedRate + '%;background:' + (r.usedRate > 85 ? '#ff6b6b' : '#4ecdc4') + '"></i></div><span class="tms-muted" style="font-size:.72rem">' + r.usedRate + '%</span>';
                    }
                },
                { key: 'inboundToday', label: '今日入库' },
                { key: 'outboundToday', label: '今日出库' },
                { key: 'status', label: '状态', render: function (r) { return U.statusBadge(r.status === 'busy' ? 'busy' : 'normal', 'inventory'); } }
            ],
            toolbar: [{
                text: '新增仓库', className: 'tms-btn tms-btn-primary', onClick: function () {
                    U.formModal({
                        title: '新增仓库', fields: [
                            { key: 'name', label: '仓库名称', required: true },
                            { key: 'city', label: '所在城市', type: 'select', required: true, options: ['北京', '上海', '广州', '深圳', '杭州', '南京', '成都', '武汉', '西安', '苏州'], placeholder: '请选择城市' },
                            { key: 'manager', label: '负责人', required: true },
                            { key: 'area', label: '面积（㎡）', type: 'number', required: true, min: 1 },
                            { key: 'usedRate', label: '使用率（%）', type: 'number', min: 0, max: 100, value: 50 },
                            { key: 'inboundToday', label: '今日入库', type: 'number', min: 0, value: 0 },
                            { key: 'outboundToday', label: '今日出库', type: 'number', min: 0, value: 0 }
                        ],
                        onSubmit: function (v) {
                            v.status = Number(v.usedRate) > 85 ? 'busy' : 'normal';
                            S.create('warehouses', v);
                        }
                    });
                }
            }],
            actions: [
                {
                    label: '查看', className: 'tms-btn-light', onClick: function (row) {
                        var items = S.list('inventory', { filters: { warehouse: row.name }, pageSize: 0 }).rows;
                        var html = U.detailGrid([
                            { label: '仓库', value: U.esc(row.name) }, { label: '城市', value: U.esc(row.city) },
                            { label: '负责人', value: U.esc(row.manager) }, { label: '面积', value: U.fmt.number(row.area) + ' ㎡' },
                            { label: '使用率', value: row.usedRate + '%' }, { label: '今日入库', value: row.inboundToday },
                            { label: '今日出库', value: row.outboundToday }, { label: '物资种类', value: items.length }
                        ]);
                        if (items.length) {
                            html += '<div class="tms-panel-head" style="padding:1rem 0 .5rem;border:0"><h3>仓内物资</h3></div>' +
                                '<table class="tms-table"><thead><tr><th>物资</th><th>库存</th><th>安全库存</th><th>状态</th></tr></thead><tbody>' +
                                items.map(function (i) {
                                    return '<tr><td>' + U.esc(i.name) + '</td><td>' + i.stock + ' ' + U.esc(i.unit) + '</td><td>' + i.safetyStock + '</td><td>' + U.statusBadge(i.status, 'inventory') + '</td></tr>';
                                }).join('') + '</tbody></table>';
                        }
                        var m = U.detailModal('仓库详情', html);
                        m.el.querySelector('[data-act="close"]').addEventListener('click', m.close);
                    }
                },
                {
                    label: '编辑', className: 'tms-btn-light', onClick: function (row) {
                        U.formModal({
                            title: '编辑仓库', values: row, fields: [
                                { key: 'name', label: '仓库名称', required: true },
                                { key: 'manager', label: '负责人', required: true },
                                { key: 'area', label: '面积（㎡）', type: 'number', required: true, min: 1 },
                                { key: 'usedRate', label: '使用率（%）', type: 'number', min: 0, max: 100 }
                            ],
                            onSubmit: function (v) {
                                v.status = Number(v.usedRate) > 85 ? 'busy' : 'normal';
                                S.update('warehouses', row.id, v);
                            }
                        });
                    }
                }
            ]
        },
        extraAfter: function (el) {
            el.innerHTML = '<div class="tms-panel"><div class="tms-panel-head"><h3>低库存预警</h3><span class="tms-total">低于安全库存的物资</span></div><div id="low-stock"></div></div>';
            var low = S.list('inventory', { pageSize: 0 }).rows.filter(function (i) { return Number(i.stock) < Number(i.safetyStock); });
            U.table(el.querySelector('#low-stock'), {
                rows: low,
                search: false,
                pageSize: 0,
                columns: [
                    { key: 'name', label: '物资' }, { key: 'warehouse', label: '仓库' },
                    { key: 'stock', label: '当前库存' }, { key: 'safetyStock', label: '安全库存' },
                    { key: 'unit', label: '单位' },
                    { key: 'status', label: '状态', render: function (r) { return U.statusBadge('low', 'inventory'); } }
                ],
                emptyText: '库存健康，暂无预警',
                actions: [{
                    label: '补货', className: 'tms-btn-primary', onClick: function (row) {
                        S.update('inventory', row.id, { stock: Number(row.stock) + 100, status: 'normal' });
                        U.toast('已补货 100 ' + row.unit, 'success');
                    }
                }]
            });
        }
    });

    /* ============================== 车辆管理 ============================== */

    define('vehicle', {
        title: '车辆管理',
        subtitle: '管理自有及外协车辆的运行状态、司机与实时位置。',
        kpis: function () {
            var st = S.vehicleStats();
            return [
                { label: '车辆总数', value: st.total, color: '#3d4b5c' },
                { label: '在线车辆', value: st.online + st.transporting, color: '#4caf50', sub: '其中运输中 ' + st.transporting },
                { label: '维修中', value: st.maintenance, color: '#ff9800' },
                { label: '离线车辆', value: st.offline, color: '#98a4b3' }
            ];
        },
        table: {
            entity: 'vehicles',
            searchPlaceholder: '搜索车牌/司机/当前位置',
            searchFields: ['id', 'plate', 'driver', 'branch', 'location', 'model'],
            filters: [{ key: 'status', label: '全部状态', options: [{ value: 'online', label: '在线' }, { value: 'transporting', label: '运输中' }, { value: 'maintenance', label: '维修中' }, { value: 'offline', label: '离线' }] }],
            columns: [
                { key: 'id', label: '车辆ID' },
                { key: 'plate', label: '车牌号' },
                { key: 'type', label: '类型' },
                { key: 'model', label: '车型' },
                { key: 'driver', label: '司机' },
                { key: 'branch', label: '所属网点' },
                { key: 'status', label: '状态', render: function (r) { return U.statusBadge(r.status, 'vehicle'); } },
                { key: 'location', label: '当前位置' },
                { key: 'lastUpdate', label: '最后更新', render: function (r) { return U.fmt.dateTime(r.lastUpdate); } }
            ],
            toolbar: [{
                text: '新增车辆', className: 'tms-btn tms-btn-primary', onClick: function () {
                    U.formModal({
                        title: '新增车辆', fields: [
                            { key: 'plate', label: '车牌号', required: true, placeholder: '如 京A12345' },
                            { key: 'type', label: '车辆类型', type: 'select', required: true, options: ['卡车', '厢货', '集装箱', '冷链车'], placeholder: '请选择' },
                            { key: 'model', label: '车型', required: true },
                            { key: 'driver', label: '司机', required: true },
                            { key: 'branch', label: '所属网点', required: true },
                            { key: 'capacityTon', label: '载重（吨）', type: 'number', min: 1, value: 8 },
                            { key: 'location', label: '当前位置', value: '总部' },
                            { key: 'status', label: '状态', type: 'select', options: ['online', 'transporting', 'maintenance', 'offline'], value: 'online' }
                        ],
                        onSubmit: function (v) {
                            v.lastUpdate = new Date().toISOString();
                            S.create('vehicles', v);
                        }
                    });
                }
            }],
            actions: [
                {
                    label: '查看', className: 'tms-btn-light', onClick: function (row) {
                        var trips = S.list('transports', { pageSize: 0 }).rows.filter(function (t) { return t.vehicleId === row.id; });
                        var html = U.detailGrid([
                            { label: '车辆ID', value: U.esc(row.id) }, { label: '车牌', value: U.esc(row.plate) },
                            { label: '类型', value: U.esc(row.type) + ' / ' + U.esc(row.model) },
                            { label: '司机', value: U.esc(row.driver) }, { label: '所属网点', value: U.esc(row.branch) },
                            { label: '状态', value: U.statusBadge(row.status, 'vehicle') },
                            { label: '当前位置', value: U.esc(row.location) }, { label: '载重', value: row.capacityTon + ' 吨' },
                            { label: '累计里程', value: U.fmt.number(row.mileage) + ' km' }, { label: '运输任务数', value: trips.length }
                        ]);
                        var m = U.detailModal('车辆详情', html);
                        m.el.querySelector('[data-act="close"]').addEventListener('click', m.close);
                    }
                },
                {
                    label: '编辑', className: 'tms-btn-light', onClick: function (row) {
                        U.formModal({
                            title: '编辑车辆', values: row, fields: [
                                { key: 'plate', label: '车牌号', required: true },
                                { key: 'driver', label: '司机', required: true },
                                { key: 'branch', label: '所属网点', required: true },
                                { key: 'location', label: '当前位置' },
                                { key: 'capacityTon', label: '载重（吨）', type: 'number', min: 1 }
                            ],
                            onSubmit: function (v) {
                                v.lastUpdate = new Date().toISOString();
                                S.update('vehicles', row.id, v);
                            }
                        });
                    }
                },
                {
                    label: '维修', className: 'tms-btn-warning', show: function (r) { return r.status !== 'maintenance'; },
                    onClick: async function (row) {
                        if (await U.confirm({ message: '确认将车辆 ' + row.plate + ' 转入维修状态？', okText: '转入维修' })) {
                            S.update('vehicles', row.id, { status: 'maintenance', lastUpdate: new Date().toISOString() });
                            U.toast('车辆已转入维修', 'success');
                        }
                    }
                },
                {
                    label: '恢复', className: 'tms-btn-success', show: function (r) { return r.status === 'maintenance' || r.status === 'offline'; },
                    onClick: function (row) {
                        S.update('vehicles', row.id, { status: 'online', lastUpdate: new Date().toISOString() });
                        U.toast('车辆已恢复在线', 'success');
                    }
                }
            ]
        }
    });

    /* ============================== 运力管理 ============================== */

    define('capacity', {
        title: '运力管理',
        subtitle: '管理线路运力资源与剩余承载能力，满载时触发预警。',
        kpis: function () {
            var rows = S.list('capacities', { pageSize: 0 }).rows;
            var total = rows.reduce(function (s, r) { return s + Number(r.capacity); }, 0);
            var remain = rows.reduce(function (s, r) { return s + Number(r.remaining); }, 0);
            return [
                { label: '运力资源', value: rows.length, color: '#667eea' },
                { label: '可承载量', value: total, color: '#2196f3' },
                { label: '剩余运力', value: remain, color: '#4caf50', sub: '使用率 ' + (total ? Math.round((total - remain) / total * 100) : 0) + '%' },
                { label: '满载资源', value: rows.filter(function (r) { return r.status === 'busy'; }).length, color: '#ff9800' }
            ];
        },
        table: {
            entity: 'capacities',
            searchPlaceholder: '搜索运力名称/供应商',
            searchFields: ['id', 'name', 'supplier', 'type'],
            filters: [{ key: 'status', label: '全部状态', options: [{ value: 'available', label: '可用' }, { value: 'busy', label: '满载' }] }],
            columns: [
                { key: 'id', label: '运力ID' },
                { key: 'type', label: '资源类型' },
                { key: 'name', label: '资源名称' },
                { key: 'supplier', label: '供应商' },
                { key: 'capacity', label: '可承载量' },
                {
                    key: 'remaining', label: '剩余量', render: function (r) {
                        var ratio = Math.round(Number(r.remaining) / Math.max(1, Number(r.capacity)) * 100);
                        return '<div class="tms-progress"><i style="width:' + ratio + '%;background:' + (ratio < 20 ? '#ff6b6b' : '#4ecdc4') + '"></i></div><span class="tms-muted" style="font-size:.72rem">' + r.remaining + ' / ' + r.capacity + '</span>';
                    }
                },
                { key: 'status', label: '状态', render: function (r) { return U.statusBadge(r.status, 'capacity'); } },
                { key: 'validUntil', label: '有效期至' }
            ],
            toolbar: [{
                text: '新增运力', className: 'tms-btn tms-btn-primary', onClick: function () {
                    U.formModal({
                        title: '新增运力', fields: [
                            { key: 'type', label: '资源类型', type: 'select', required: true, options: ['自有车辆', '外协车辆', '临时仓', '航空仓位'] },
                            { key: 'name', label: '资源名称', required: true },
                            { key: 'supplier', label: '供应商', required: true },
                            { key: 'capacity', label: '可承载量', type: 'number', required: true, min: 1 },
                            { key: 'remaining', label: '剩余量', type: 'number', required: true, min: 0 },
                            { key: 'validUntil', label: '有效期至', type: 'date', required: true }
                        ],
                        onSubmit: function (v) {
                            v.status = Number(v.remaining) < Number(v.capacity) * 0.15 ? 'busy' : 'available';
                            S.create('capacities', v);
                        }
                    });
                }
            }],
            actions: [
                {
                    label: '释放', className: 'tms-btn-success', show: function (r) { return Number(r.remaining) < Number(r.capacity); },
                    onClick: function (row) {
                        S.update('capacities', row.id, { remaining: row.capacity, status: 'available' });
                        U.toast('运力已释放', 'success');
                    }
                },
                {
                    label: '编辑', className: 'tms-btn-light', onClick: function (row) {
                        U.formModal({
                            title: '编辑运力', values: row, fields: [
                                { key: 'name', label: '资源名称', required: true },
                                { key: 'supplier', label: '供应商', required: true },
                                { key: 'capacity', label: '可承载量', type: 'number', required: true, min: 1 },
                                { key: 'remaining', label: '剩余量', type: 'number', required: true, min: 0 },
                                { key: 'validUntil', label: '有效期至', type: 'date' }
                            ],
                            onSubmit: function (v) {
                                v.status = Number(v.remaining) < Number(v.capacity) * 0.15 ? 'busy' : 'available';
                                S.update('capacities', row.id, v);
                            }
                        });
                    }
                }
            ]
        }
    });

    /* ============================== 物资管理 ============================== */

    define('material', {
        title: '内部物资管理',
        subtitle: '管理包装耗材与作业物资库存，支持领用、补货和库存预警。',
        kpis: function () {
            var st = S.warehouseStats();
            return [
                { label: '物资种类', value: st.items, color: '#667eea' },
                { label: '库存总量', value: U.fmt.number(st.stockTotal), color: '#2196f3' },
                { label: '低库存', value: st.lowStock, color: '#ff9800' },
                { label: '仓库覆盖', value: st.warehouses, color: '#4caf50' }
            ];
        },
        table: {
            entity: 'inventory',
            searchPlaceholder: '搜索物资/仓库/库位',
            searchFields: ['id', 'name', 'warehouse', 'location', 'spec'],
            filters: [{ key: 'warehouse', label: '全部仓库', options: ['北京中心仓', '上海分拨仓', '广州前置仓', '成都区域仓'] }],
            columns: [
                { key: 'id', label: '物资ID' },
                { key: 'name', label: '物资名称' },
                { key: 'spec', label: '规格' },
                { key: 'warehouse', label: '仓库' },
                { key: 'location', label: '库位' },
                { key: 'stock', label: '库存', render: function (r) { return U.fmt.number(r.stock) + ' ' + U.esc(r.unit); } },
                { key: 'safetyStock', label: '安全库存' },
                { key: 'status', label: '状态', render: function (r) { return U.statusBadge(stockStatus(r), 'inventory'); } }
            ],
            toolbar: [{
                text: '新增物资', className: 'tms-btn tms-btn-primary', onClick: function () {
                    U.formModal({
                        title: '新增物资', fields: [
                            { key: 'name', label: '物资名称', required: true },
                            { key: 'spec', label: '规格', required: true },
                            { key: 'warehouse', label: '仓库', type: 'select', required: true, options: ['北京中心仓', '上海分拨仓', '广州前置仓', '成都区域仓'] },
                            { key: 'location', label: '库位', required: true },
                            { key: 'stock', label: '初始库存', type: 'number', required: true, min: 0 },
                            { key: 'safetyStock', label: '安全库存', type: 'number', required: true, min: 0 },
                            { key: 'unit', label: '单位', type: 'select', options: ['个', '卷', '箱', '包'], value: '个' }
                        ],
                        onSubmit: function (v) {
                            v.status = Number(v.stock) < Number(v.safetyStock) ? 'low' : 'normal';
                            v.updatedAt = new Date().toISOString();
                            S.create('inventory', v);
                        }
                    });
                }
            }],
            actions: [
                {
                    label: '领用', className: 'tms-btn-warning', onClick: function (row) {
                        U.formModal({
                            title: '物资领用', width: 420,
                            fields: [{ key: 'qty', label: '领用数量（' + row.unit + '）', type: 'number', required: true, min: 1, value: 1 }],
                            submitText: '确认领用',
                            onSubmit: function (v) {
                                var qty = Number(v.qty) || 0;
                                if (qty > Number(row.stock)) throw new Error('领用数量不能超过当前库存');
                                var stock = Number(row.stock) - qty;
                                S.update('inventory', row.id, { stock: stock, status: stock < Number(row.safetyStock) ? 'low' : 'normal', updatedAt: new Date().toISOString() });
                                U.toast('已领用 ' + qty + ' ' + row.unit, 'success');
                            }
                        });
                    }
                },
                {
                    label: '补货', className: 'tms-btn-success', onClick: function (row) {
                        U.formModal({
                            title: '物资补货', width: 420,
                            fields: [{ key: 'qty', label: '补货数量（' + row.unit + '）', type: 'number', required: true, min: 1, value: 50 }],
                            submitText: '确认入库',
                            onSubmit: function (v) {
                                var stock = Number(row.stock) + Number(v.qty);
                                S.update('inventory', row.id, { stock: stock, status: stock < Number(row.safetyStock) ? 'low' : 'normal', updatedAt: new Date().toISOString() });
                                U.toast('补货完成，当前库存 ' + stock, 'success');
                            }
                        });
                    }
                }
            ]
        }
    });

    /* ============================== 客服管理 ============================== */

    define('service', {
        title: '客服管理',
        subtitle: '受理客户咨询、投诉与改派请求，跟踪工单闭环。',
        kpis: function () {
            var rows = S.list('serviceTickets', { pageSize: 0 }).rows;
            return [
                { label: '待受理', value: rows.filter(function (r) { return r.status === 'pending'; }).length, color: '#ff9800' },
                { label: '处理中', value: rows.filter(function (r) { return r.status === 'processing'; }).length, color: '#2196f3' },
                { label: '已解决', value: rows.filter(function (r) { return r.status === 'resolved'; }).length, color: '#4caf50' },
                { label: '工单总数', value: rows.length, color: '#3d4b5c' }
            ];
        },
        table: {
            entity: 'serviceTickets',
            searchPlaceholder: '搜索工单/订单/客户',
            searchFields: ['id', 'orderId', 'customer', 'type', 'content', 'assignee'],
            defaultSort: { key: 'createdAt', dir: 'desc' },
            filters: [
                { key: 'status', label: '全部状态', options: [{ value: 'pending', label: '待受理' }, { value: 'processing', label: '处理中' }, { value: 'resolved', label: '已解决' }] },
                { key: 'priority', label: '全部优先级', options: ['高', '中', '低'] }
            ],
            columns: [
                { key: 'id', label: '工单号' },
                { key: 'orderId', label: '订单号', render: function (r) { return orderLink(r.orderId); } },
                { key: 'customer', label: '客户' },
                { key: 'type', label: '类型' },
                { key: 'priority', label: '优先级', render: function (r) { return priorityBadge(r.priority); } },
                { key: 'content', label: '内容' },
                { key: 'status', label: '状态', render: function (r) { return U.statusBadge(r.status, 'ticket'); } },
                { key: 'assignee', label: '处理人', render: function (r) { return r.assignee || '<span class="tms-muted">未分派</span>'; } },
                { key: 'createdAt', label: '创建时间', render: function (r) { return U.fmt.dateTime(r.createdAt); } }
            ],
            toolbar: [{
                text: '新建工单', className: 'tms-btn tms-btn-primary', onClick: function () {
                    U.formModal({
                        title: '新建服务工单', fields: [
                            { key: 'orderId', label: '关联订单', type: 'select', required: true, options: allOrdersOptions(), full: true },
                            { key: 'type', label: '工单类型', type: 'select', required: true, options: ['物流查询', '改派申请', '投诉建议', '延误催件', '理赔咨询'] },
                            { key: 'priority', label: '优先级', type: 'select', required: true, options: ['高', '中', '低'], value: '中' },
                            { key: 'content', label: '问题描述', type: 'textarea', required: true, full: true, rows: 3 }
                        ],
                        onSubmit: function (v) {
                            S.createTicket(v);
                        }
                    });
                }
            }],
            actions: [
                {
                    label: '受理', className: 'tms-btn-warning', show: function (r) { return r.status === 'pending'; },
                    onClick: function (row) {
                        S.processTicket(row.id, '客服专员');
                        U.toast('工单已受理', 'success');
                    }
                },
                {
                    label: '解决', className: 'tms-btn-success', show: function (r) { return r.status !== 'resolved'; },
                    onClick: function (row) {
                        U.formModal({
                            title: '工单处理结果', width: 520,
                            fields: [{ key: 'result', label: '处理结果', type: 'textarea', required: true, full: true, rows: 3 }],
                            submitText: '标记已解决',
                            onSubmit: function (v) {
                                S.resolveTicket(row.id, v.result);
                                U.toast('工单已解决', 'success');
                            }
                        });
                    }
                },
                {
                    label: '查看', className: 'tms-btn-light', onClick: function (row) {
                        var html = U.detailGrid([
                            { label: '工单号', value: U.esc(row.id) }, { label: '订单号', value: U.esc(row.orderId) },
                            { label: '客户', value: U.esc(row.customer) }, { label: '类型', value: U.esc(row.type) },
                            { label: '优先级', value: priorityBadge(row.priority) }, { label: '状态', value: U.statusBadge(row.status, 'ticket') },
                            { label: '处理人', value: row.assignee || '-' }, { label: '创建时间', value: U.fmt.dateTime(row.createdAt) }
                        ]);
                        html += '<div class="tms-note" style="margin-top:1rem">' + U.esc(row.content) + '</div>';
                        if (row.result) html += '<div class="tms-note" style="margin-top:.6rem">处理结果：' + U.esc(row.result) + '</div>';
                        var m = U.detailModal('工单详情', html);
                        m.el.querySelector('[data-act="close"]').addEventListener('click', m.close);
                    }
                }
            ]
        }
    });

    /* ============================== 理赔管理 ============================== */

    define('claim', {
        title: '理赔管理',
        subtitle: '审核客户理赔申请，通过后自动生成理赔支出流水。',
        kpis: function () {
            var rows = S.list('claims', { pageSize: 0 }).rows;
            var approved = rows.filter(function (r) { return r.status === 'approved'; });
            return [
                { label: '待审核', value: rows.filter(function (r) { return r.status === 'pending'; }).length, color: '#ff9800' },
                { label: '审核中', value: rows.filter(function (r) { return r.status === 'processing'; }).length, color: '#2196f3' },
                { label: '已通过', value: approved.length, color: '#4caf50' },
                { label: '已赔付金额', value: U.fmt.money(approved.reduce(function (s, r) { return s + Number(r.amount); }, 0)), color: '#ff6b6b' }
            ];
        },
        table: {
            entity: 'claims',
            searchPlaceholder: '搜索理赔单/订单/客户',
            searchFields: ['id', 'orderId', 'customer', 'type', 'reason', 'applicant'],
            defaultSort: { key: 'createdAt', dir: 'desc' },
            filters: [
                { key: 'status', label: '全部状态', options: [{ value: 'pending', label: '待审核' }, { value: 'processing', label: '审核中' }, { value: 'approved', label: '已通过' }, { value: 'rejected', label: '已驳回' }] },
                { key: 'type', label: '全部类型', options: ['货物破损', '货物丢失', '延误赔付', '拒收退回'] }
            ],
            columns: [
                { key: 'id', label: '理赔单号' },
                { key: 'orderId', label: '订单号', render: function (r) { return orderLink(r.orderId); } },
                { key: 'customer', label: '客户' },
                { key: 'type', label: '类型' },
                { key: 'amount', label: '申请金额', render: function (r) { return U.fmt.money(r.amount); } },
                { key: 'status', label: '状态', render: function (r) { return U.statusBadge(r.status, 'claim'); } },
                { key: 'applicant', label: '申请人' },
                { key: 'createdAt', label: '申请时间', render: function (r) { return U.fmt.dateTime(r.createdAt); } }
            ],
            toolbar: [{
                text: '新建理赔', className: 'tms-btn tms-btn-primary', onClick: function () {
                    U.formModal({
                        title: '新建理赔申请', fields: [
                            { key: 'orderId', label: '关联订单', type: 'select', required: true, options: allOrdersOptions(), full: true },
                            { key: 'type', label: '理赔类型', type: 'select', required: true, options: ['货物破损', '货物丢失', '延误赔付', '拒收退回'] },
                            { key: 'amount', label: '申请金额（元）', type: 'number', required: true, min: 0, step: 0.01 },
                            { key: 'reason', label: '申请原因', type: 'textarea', required: true, full: true, rows: 3 }
                        ],
                        onSubmit: function (v) {
                            S.createClaim(v);
                        }
                    });
                }
            }],
            actions: [
                {
                    label: '通过', className: 'tms-btn-success', show: function (r) { return r.status === 'pending' || r.status === 'processing'; },
                    onClick: async function (row) {
                        if (await U.confirm({ message: '确认通过理赔申请 ' + row.id + '？通过后将生成 ' + U.fmt.money(row.amount) + ' 赔付支出。', okText: '通过并赔付' })) {
                            S.approveClaim(row.id);
                            U.toast('理赔已通过并生成支出流水', 'success');
                        }
                    }
                },
                {
                    label: '驳回', className: 'tms-btn-danger', show: function (r) { return r.status === 'pending' || r.status === 'processing'; },
                    onClick: function (row) {
                        U.formModal({
                            title: '驳回理赔', width: 480,
                            fields: [{ key: 'reason', label: '驳回原因', type: 'textarea', required: true, full: true, rows: 3 }],
                            submitText: '确认驳回',
                            onSubmit: function (v) {
                                S.update('claims', row.id, { status: 'rejected', handledAt: new Date().toISOString(), rejectReason: v.reason });
                                U.toast('理赔已驳回', 'success');
                            }
                        });
                    }
                },
                {
                    label: '查看', className: 'tms-btn-light', onClick: function (row) {
                        var html = U.detailGrid([
                            { label: '理赔单号', value: U.esc(row.id) }, { label: '订单号', value: U.esc(row.orderId) },
                            { label: '客户', value: U.esc(row.customer) }, { label: '类型', value: U.esc(row.type) },
                            { label: '金额', value: U.fmt.money(row.amount) }, { label: '状态', value: U.statusBadge(row.status, 'claim') },
                            { label: '申请人', value: U.esc(row.applicant) }, { label: '申请时间', value: U.fmt.dateTime(row.createdAt) }
                        ]);
                        html += '<div class="tms-note" style="margin-top:1rem">申请原因：' + U.esc(row.reason || '-') + '</div>';
                        var m = U.detailModal('理赔详情', html);
                        m.el.querySelector('[data-act="close"]').addEventListener('click', m.close);
                    }
                }
            ]
        }
    });

    /* ============================== 财务管理 ============================== */

    define('finance', {
        title: '财务管理',
        subtitle: '汇总运费收入与运营支出，追踪结算与利润。',
        kpis: function () {
            var sum = S.financeSummary(7);
            return [
                { label: '近7日收入', value: U.fmt.money(sum.income), color: '#4caf50', sub: '运费与增值收入' },
                { label: '近7日支出', value: U.fmt.money(sum.expense), color: '#ff6b6b', sub: '油费/薪资/理赔' },
                { label: '近7日利润', value: U.fmt.money(sum.profit), color: '#2196f3', sub: '收入 - 支出' },
                { label: '流水笔数', value: sum.count, color: '#667eea' }
            ];
        },
        charts: function (el) {
            el.innerHTML = '<div class="tms-panel"><div class="tms-panel-head"><h3>近7日收支趋势</h3></div><div class="tms-panel-body" id="finance-chart"></div></div>';
            var trend = S.financeTrend(7);
            U.charts.bar(el.querySelector('#finance-chart'), {
                labels: trend.map(function (t) { return t.label; }),
                series: [
                    { name: '收入', color: '#4ecdc4', data: trend.map(function (t) { return t.income; }) },
                    { name: '支出', color: '#ff8a8a', data: trend.map(function (t) { return t.expense; }) }
                ],
                height: 240
            });
        },
        table: {
            entity: 'finances',
            searchPlaceholder: '搜索流水号/订单/备注',
            searchFields: ['id', 'orderId', 'category', 'remark'],
            defaultSort: { key: 'date', dir: 'desc' },
            filters: [
                { key: 'type', label: '全部类型', options: [{ value: 'income', label: '收入' }, { value: 'expense', label: '支出' }] },
                { key: 'status', label: '全部状态', options: [{ value: 'settled', label: '已结算' }, { value: 'pending', label: '待结算' }, { value: 'void', label: '已作废' }] }
            ],
            columns: [
                { key: 'id', label: '流水号' },
                { key: 'type', label: '类型', render: function (r) { return U.badge(r.type === 'income' ? '收入' : '支出', r.type === 'income' ? 'success' : 'danger'); } },
                { key: 'category', label: '分类' },
                {
                    key: 'source', label: '来源', render: function (r) {
                        var cat = r.category || '', rmk = r.remark || '';
                        if (r.type === 'income') {
                            if (cat.indexOf('复核') > -1) return U.badge('复核补收', 'info');
                            if (cat.indexOf('代收款服务费') > -1) return U.badge('COD服务费', 'warn');
                            if (cat.indexOf('月结') > -1 || rmk.indexOf('月结') > -1) return U.badge('应收核销', 'info');
                            if (rmk.indexOf('到付') > -1) return U.badge('到付收款', 'warn');
                            if (cat.indexOf('运费') > -1) return U.badge('现结收款', 'success');
                            return U.badge('收入', 'muted');
                        }
                        if (cat.indexOf('复核') > -1) return U.badge('复核退费', 'warn');
                        if (cat.indexOf('代收货款上划') > -1) return U.badge('COD上划', 'info');
                        if (cat.indexOf('理赔') > -1) return U.badge('理赔支出', 'danger');
                        if (cat.indexOf('干线') > -1 || cat.indexOf('异常扣款') > -1) return U.badge('应付扣款', 'danger');
                        return U.badge('运营支出', 'muted');
                    }
                },
                { key: 'orderId', label: '关联订单', render: function (r) { return r.orderId ? orderLink(r.orderId) : '<span class="tms-muted">-</span>'; } },
                {
                    key: 'amount', label: '金额（元）', render: function (r) {
                        return '<span class="tms-strong" style="color:' + (r.type === 'income' ? '#2e7d32' : '#c0392b') + '">' +
                            (r.type === 'income' ? '+' : '-') + U.fmt.money(r.amount).replace('¥', '¥') + '</span>';
                    }
                },
                { key: 'status', label: '状态', render: function (r) { return U.statusBadge(r.status, 'finance'); } },
                { key: 'date', label: '发生时间', render: function (r) { return U.fmt.dateTime(r.date); } },
                { key: 'remark', label: '备注' }
            ],
            toolbar: [{
                text: '登记收支', className: 'tms-btn tms-btn-primary', onClick: function () {
                    U.formModal({
                        title: '登记收支流水', fields: [
                            { key: 'type', label: '类型', type: 'select', required: true, options: [{ value: 'income', label: '收入' }, { value: 'expense', label: '支出' }] },
                            { key: 'category', label: '分类', required: true, placeholder: '如 运费收入 / 车辆油费' },
                            { key: 'amount', label: '金额（元）', type: 'number', required: true, min: 0, step: 0.01 },
                            { key: 'orderId', label: '关联订单（可选）', type: 'select', options: allOrdersOptions() },
                            { key: 'date', label: '发生日期', type: 'date', required: true, value: S.dateKey(new Date()) },
                            { key: 'remark', label: '备注', full: true }
                        ],
                        onSubmit: function (v) {
                            v.status = 'settled';
                            v.date = new Date(v.date + 'T12:00:00').toISOString();
                            S.create('finances', v);
                        }
                    });
                }
            }],
            actions: [
                {
                    label: '结算', className: 'tms-btn-success', show: function (r) { return r.status === 'pending'; },
                    onClick: function (row) {
                        S.update('finances', row.id, { status: 'settled', date: new Date().toISOString() });
                        U.toast('流水已结算', 'success');
                    }
                },
                {
                    label: '作废', className: 'tms-btn-danger', show: function (r) { return r.status === 'pending'; },
                    onClick: async function (row) {
                        if (await U.confirm({ message: '确认作废流水 ' + row.id + '？', danger: true, okText: '作废' })) {
                            S.update('finances', row.id, { status: 'void' });
                            U.toast('流水已作废', 'success');
                        }
                    }
                }
            ]
        }
    });

    /* ============================== 行政管理 ============================== */

    define('administration', {
        title: '行政管理',
        subtitle: '管理办公采购、差旅报销与资产领用等行政事项。',
        kpis: function () {
            var rows = S.list('adminRecords', { pageSize: 0 }).rows;
            return [
                { label: '待审批', value: rows.filter(function (r) { return r.status === 'pending'; }).length, color: '#ff9800' },
                { label: '已通过', value: rows.filter(function (r) { return r.status === 'approved'; }).length, color: '#2196f3' },
                { label: '已完成', value: rows.filter(function (r) { return r.status === 'completed'; }).length, color: '#4caf50' },
                { label: '涉及金额', value: U.fmt.money(rows.reduce(function (s, r) { return s + Number(r.amount || 0); }, 0)), color: '#667eea' }
            ];
        },
        table: {
            entity: 'adminRecords',
            searchPlaceholder: '搜索事项/申请人/部门',
            searchFields: ['id', 'title', 'applicant', 'department', 'type'],
            defaultSort: { key: 'createdAt', dir: 'desc' },
            filters: [{ key: 'status', label: '全部状态', options: [{ value: 'pending', label: '待审批' }, { value: 'approved', label: '已通过' }, { value: 'completed', label: '已完成' }] }],
            columns: [
                { key: 'id', label: '记录号' },
                { key: 'type', label: '事项类型' },
                { key: 'title', label: '事项' },
                { key: 'applicant', label: '申请人' },
                { key: 'department', label: '部门' },
                { key: 'amount', label: '金额', render: function (r) { return r.amount ? U.fmt.money(r.amount) : '<span class="tms-muted">-</span>'; } },
                { key: 'status', label: '状态', render: function (r) { return U.badge(r.status === 'pending' ? '待审批' : (r.status === 'approved' ? '已通过' : '已完成'), r.status === 'pending' ? 'warn' : (r.status === 'approved' ? 'info' : 'success')); } },
                { key: 'createdAt', label: '申请时间', render: function (r) { return U.fmt.dateTime(r.createdAt); } }
            ],
            toolbar: [{
                text: '新建事项', className: 'tms-btn tms-btn-primary', onClick: function () {
                    U.formModal({
                        title: '新建行政事项', fields: [
                            { key: 'type', label: '事项类型', type: 'select', required: true, options: ['办公用品采购', '差旅报销', '会议安排', '资产领用', '车辆使用'] },
                            { key: 'title', label: '事项名称', required: true },
                            { key: 'applicant', label: '申请人', required: true },
                            { key: 'department', label: '部门', type: 'select', required: true, options: ['运营部', '客服部', '仓储部', '运输部', '财务部', '人事部'] },
                            { key: 'amount', label: '金额（元）', type: 'number', min: 0, step: 0.01, value: 0 }
                        ],
                        onSubmit: function (v) {
                            v.status = 'pending';
                            S.create('adminRecords', v);
                        }
                    });
                }
            }],
            actions: [
                {
                    label: '通过', className: 'tms-btn-success', show: function (r) { return r.status === 'pending'; },
                    onClick: function (row) {
                        S.update('adminRecords', row.id, { status: 'approved' });
                        U.toast('审批已通过', 'success');
                    }
                },
                {
                    label: '驳回', className: 'tms-btn-danger', show: function (r) { return r.status === 'pending'; },
                    onClick: function (row) {
                        U.formModal({
                            title: '驳回事项', width: 460,
                            fields: [{ key: 'reason', label: '驳回原因', type: 'textarea', required: true, full: true, rows: 3 }],
                            submitText: '确认驳回',
                            onSubmit: function (v) {
                                S.update('adminRecords', row.id, { status: 'rejected', reason: v.reason });
                                U.toast('事项已驳回', 'success');
                            }
                        });
                    }
                }
            ]
        }
    });

    /* ============================== 考核评级 ============================== */

    define('evaluation', {
        title: '考核评级',
        subtitle: '按月度对员工签收率、准时率与满意度进行综合评级。',
        kpis: function () {
            var rows = S.list('evaluations', { pageSize: 0 }).rows;
            var avg = rows.length ? Math.round(rows.reduce(function (s, r) { return s + Number(r.score); }, 0) / rows.length) : 0;
            return [
                { label: '参评人数', value: rows.length, color: '#667eea' },
                { label: '平均得分', value: avg, color: '#2196f3' },
                { label: 'A级人数', value: rows.filter(function (r) { return r.grade === 'A'; }).length, color: '#4caf50' },
                { label: '待改进', value: rows.filter(function (r) { return r.grade === 'D'; }).length, color: '#ff6b6b' }
            ];
        },
        table: {
            entity: 'evaluations',
            searchPlaceholder: '搜索员工/部门/岗位',
            searchFields: ['employee', 'department', 'position', 'period'],
            defaultSort: { key: 'score', dir: 'desc' },
            filters: [{ key: 'grade', label: '全部等级', options: ['A', 'B', 'C', 'D'] }],
            columns: [
                { key: 'period', label: '考核周期' },
                { key: 'employee', label: '员工' },
                { key: 'department', label: '部门' },
                { key: 'position', label: '岗位' },
                { key: 'signRate', label: '签收率', render: function (r) { return r.signRate + '%'; } },
                { key: 'onTimeRate', label: '准时率', render: function (r) { return r.onTimeRate + '%'; } },
                { key: 'satisfaction', label: '满意度', render: function (r) { return Number(r.satisfaction).toFixed(1); } },
                { key: 'score', label: '综合得分', render: function (r) { return '<span class="tms-strong">' + r.score + '</span>'; } },
                { key: 'grade', label: '等级', render: function (r) { return gradeBadge(r.grade); } }
            ],
            toolbar: [{
                text: '发起考核', className: 'tms-btn tms-btn-primary', onClick: function () {
                    U.formModal({
                        title: '发起月度考核', fields: [
                            { key: 'employee', label: '员工', type: 'select', required: true, options: S.list('employees', { pageSize: 0 }).rows.map(function (e) { return { value: e.name, label: e.name + ' · ' + e.department }; }) },
                            { key: 'period', label: '考核周期', required: true, value: '2026-10' },
                            { key: 'signRate', label: '签收率（%）', type: 'number', required: true, min: 0, max: 100, value: 95 },
                            { key: 'onTimeRate', label: '准时率（%）', type: 'number', required: true, min: 0, max: 100, value: 92 },
                            { key: 'satisfaction', label: '满意度（分）', type: 'number', required: true, min: 0, max: 5, step: 0.1, value: 4.6 },
                            { key: 'score', label: '综合得分', type: 'number', required: true, min: 0, max: 100, value: 88 }
                        ],
                        onSubmit: function (v) {
                            var emp = S.list('employees', { pageSize: 0 }).rows.find(function (e) { return e.name === v.employee; });
                            v.department = emp ? emp.department : '';
                            v.position = emp ? emp.position : '';
                            v.grade = v.score >= 90 ? 'A' : (v.score >= 80 ? 'B' : (v.score >= 70 ? 'C' : 'D'));
                            v.comment = v.grade === 'A' ? '表现优秀' : '持续改进';
                            S.create('evaluations', v);
                        }
                    });
                }
            }],
            actions: [{
                label: '查看', className: 'tms-btn-light', onClick: function (row) {
                    var html = U.detailGrid([
                        { label: '员工', value: U.esc(row.employee) }, { label: '部门', value: U.esc(row.department) },
                        { label: '岗位', value: U.esc(row.position) }, { label: '周期', value: U.esc(row.period) },
                        { label: '签收率', value: row.signRate + '%' }, { label: '准时率', value: row.onTimeRate + '%' },
                        { label: '满意度', value: Number(row.satisfaction).toFixed(1) }, { label: '综合得分', value: row.score },
                        { label: '等级', value: gradeBadge(row.grade) }
                    ]);
                    html += '<div class="tms-note" style="margin-top:1rem">评语：' + U.esc(row.comment || '-') + '</div>';
                    var m = U.detailModal('考核详情', html);
                    m.el.querySelector('[data-act="close"]').addEventListener('click', m.close);
                }
            }]
        },
        extraAfter: function (el) {
            el.innerHTML = '<div class="tms-panel"><div class="tms-panel-head"><h3>考核指标配置</h3></div><div id="eval-metrics"></div></div>';
            U.table(el.querySelector('#eval-metrics'), {
                entity: 'evalMetrics', search: false, pageSize: 0,
                columns: [
                    { key: 'name', label: '指标名称' }, { key: 'target', label: '目标值' },
                    { key: 'weight', label: '权重（%）' }, { key: 'period', label: '考核周期' },
                    { key: 'status', label: '状态', render: function (r) { return U.statusBadge(r.status, 'policy'); } }
                ],
                actions: [{
                    label: '停用', className: 'tms-btn-light', show: function (r) { return r.status === 'active'; },
                    onClick: function (row) {
                        S.update('evalMetrics', row.id, { status: 'inactive' });
                        U.toast('指标已停用', 'success');
                    }
                }]
            });
        }
    });

    /* ============================== 绩效管理 ============================== */

    define('performance', {
        title: '绩效管理',
        subtitle: '按员工维度统计单量、签收率与异常，形成绩效排名。',
        kpis: function () {
            var rows = S.list('performance', { pageSize: 0 }).rows;
            var avg = rows.length ? Math.round(rows.reduce(function (s, r) { return s + Number(r.score); }, 0) / rows.length) : 0;
            return [
                { label: '绩效人数', value: rows.length, color: '#667eea' },
                { label: '平均得分', value: avg, color: '#2196f3' },
                { label: '总完成单量', value: rows.reduce(function (s, r) { return s + Number(r.orders); }, 0), color: '#4caf50' },
                { label: '平均签收率', value: (rows.length ? Math.round(rows.reduce(function (s, r) { return s + Number(r.signRate); }, 0) / rows.length) : 0) + '%', color: '#ff9800' }
            ];
        },
        charts: function (el) {
            el.innerHTML = '<div class="tms-panel"><div class="tms-panel-head"><h3>绩效得分排名</h3></div><div class="tms-panel-body" id="perf-chart"></div></div>';
            var rows = S.list('performance', { sort: { key: 'score', dir: 'desc' }, pageSize: 8 }).rows;
            U.charts.bar(el.querySelector('#perf-chart'), {
                labels: rows.map(function (r) { return r.employee; }),
                series: [{ name: '绩效得分', color: '#667eea', data: rows.map(function (r) { return r.score; }) }],
                height: 230
            });
        },
        table: {
            entity: 'performance',
            searchPlaceholder: '搜索员工/部门',
            searchFields: ['employee', 'department', 'position'],
            defaultSort: { key: 'rank', dir: 'asc' },
            pageSize: 10,
            columns: [
                { key: 'rank', label: '排名', render: function (r) { return r.rank <= 3 ? U.badge(String(r.rank), 'success') : String(r.rank); } },
                { key: 'employee', label: '员工' },
                { key: 'department', label: '部门' },
                { key: 'position', label: '岗位' },
                { key: 'orders', label: '完成单量' },
                { key: 'signed', label: '签收单量' },
                { key: 'signRate', label: '签收率', render: function (r) { return r.signRate + '%'; } },
                { key: 'exceptionCount', label: '异常数', render: function (r) { return r.exceptionCount ? U.badge(String(r.exceptionCount), 'warn') : '0'; } },
                { key: 'score', label: '绩效得分', render: function (r) { return '<span class="tms-strong">' + r.score + '</span>'; } }
            ],
            actions: [{
                label: '查看', className: 'tms-btn-light', onClick: function (row) {
                    var html = U.detailGrid([
                        { label: '员工', value: U.esc(row.employee) }, { label: '部门', value: U.esc(row.department) },
                        { label: '岗位', value: U.esc(row.position) }, { label: '排名', value: row.rank },
                        { label: '完成单量', value: row.orders }, { label: '签收单量', value: row.signed },
                        { label: '签收率', value: row.signRate + '%' }, { label: '异常数', value: row.exceptionCount },
                        { label: '绩效得分', value: row.score }
                    ]);
                    var m = U.detailModal('绩效详情', html);
                    m.el.querySelector('[data-act="close"]').addEventListener('click', m.close);
                }
            }]
        }
    });

    /* ============================== 人事管理 ============================== */

    define('hr', {
        title: '人事管理',
        subtitle: '维护员工档案、岗位与在职状态，掌握人员结构。',
        kpis: function () {
            var st = S.employeeStats();
            return [
                { label: '员工总数', value: st.total, color: '#667eea' },
                { label: '在职员工', value: st.active, color: '#4caf50' },
                { label: '休假员工', value: st.onLeave, color: '#ff9800' },
                { label: '离职员工', value: st.resigned, color: '#98a4b3' }
            ];
        },
        table: {
            entity: 'employees',
            searchPlaceholder: '搜索姓名/部门/岗位/电话',
            searchFields: ['id', 'name', 'department', 'position', 'phone', 'email'],
            filters: [
                { key: 'status', label: '全部状态', options: [{ value: 'active', label: '在职' }, { value: 'on_leave', label: '休假' }, { value: 'resigned', label: '离职' }] },
                { key: 'department', label: '全部部门', options: ['运营部', '客服部', '仓储部', '运输部', '财务部', '人事部', '调度中心'] }
            ],
            columns: [
                { key: 'id', label: '员工编号' },
                { key: 'name', label: '姓名' },
                { key: 'department', label: '部门' },
                { key: 'position', label: '岗位' },
                { key: 'phone', label: '联系电话' },
                { key: 'hireDate', label: '入职日期' },
                { key: 'status', label: '状态', render: function (r) { return U.statusBadge(r.status, 'employee'); } },
                { key: 'salary', label: '月薪', render: function (r) { return U.fmt.money(r.salary); } }
            ],
            toolbar: [{
                text: '新增员工', className: 'tms-btn tms-btn-primary', onClick: function () {
                    U.formModal({
                        title: '新增员工', fields: [
                            { key: 'name', label: '姓名', required: true },
                            { key: 'department', label: '部门', type: 'select', required: true, options: ['运营部', '客服部', '仓储部', '运输部', '财务部', '人事部', '调度中心'] },
                            { key: 'position', label: '岗位', required: true },
                            { key: 'phone', label: '联系电话', required: true },
                            { key: 'email', label: '邮箱', type: 'email' },
                            { key: 'hireDate', label: '入职日期', type: 'date', required: true, value: S.dateKey(new Date()) },
                            { key: 'salary', label: '月薪（元）', type: 'number', min: 0, step: 100 },
                            { key: 'status', label: '状态', type: 'select', options: ['active', 'on_leave'], value: 'active' }
                        ],
                        onSubmit: function (v) {
                            S.create('employees', v);
                        }
                    });
                }
            }],
            actions: [
                {
                    label: '编辑', className: 'tms-btn-light', onClick: function (row) {
                        U.formModal({
                            title: '编辑员工', values: row, fields: [
                                { key: 'name', label: '姓名', required: true },
                                { key: 'department', label: '部门', type: 'select', required: true, options: ['运营部', '客服部', '仓储部', '运输部', '财务部', '人事部', '调度中心'] },
                                { key: 'position', label: '岗位', required: true },
                                { key: 'phone', label: '联系电话', required: true },
                                { key: 'salary', label: '月薪（元）', type: 'number', min: 0 },
                                { key: 'status', label: '状态', type: 'select', options: ['active', 'on_leave', 'resigned'] }
                            ],
                            onSubmit: function (v) {
                                S.update('employees', row.id, v);
                            }
                        });
                    }
                },
                {
                    label: '离职', className: 'tms-btn-danger', show: function (r) { return r.status !== 'resigned'; },
                    onClick: async function (row) {
                        if (await U.confirm({ message: '确认将 ' + row.name + ' 标记为离职？', danger: true, okText: '确认离职' })) {
                            S.update('employees', row.id, { status: 'resigned' });
                            U.toast('已更新员工状态', 'success');
                        }
                    }
                }
            ]
        }
    });

    /* ============================== 分拣管理 ============================== */

    define('sorting', {
        title: '分拣管理',
        subtitle: '按目的地分拣包裹，完成后自动推进订单至运输环节。',
        kpis: function () {
            var rows = S.list('sortingTasks', { pageSize: 0 }).rows;
            return [
                { label: '待分拣', value: rows.filter(function (r) { return r.status === 'pending'; }).length, color: '#ff9800' },
                { label: '分拣中', value: rows.filter(function (r) { return r.status === 'processing'; }).length, color: '#2196f3' },
                { label: '已完成', value: rows.filter(function (r) { return r.status === 'done'; }).length, color: '#4caf50' },
                { label: '漏拣任务', value: rows.filter(function (r) { return r.missed; }).length, color: '#ff6b6b' }
            ];
        },
        table: {
            entity: 'sortingTasks',
            searchPlaceholder: '搜索任务/订单/分拣员/目的地',
            searchFields: ['id', 'orderId', 'waybillNo', 'destination', 'center', 'sorter'],
            defaultSort: { key: 'planAt', dir: 'desc' },
            filters: [{ key: 'status', label: '全部状态', options: [{ value: 'pending', label: '待分拣' }, { value: 'processing', label: '分拣中' }, { value: 'done', label: '已完成' }] }],
            columns: [
                { key: 'id', label: '任务ID' },
                { key: 'orderId', label: '订单号', render: function (r) { return orderLink(r.orderId); } },
                { key: 'route', label: '流向', render: function (r) { return U.esc(r.origin) + ' → ' + U.esc(r.destination); } },
                { key: 'center', label: '分拣中心' },
                { key: 'sorter', label: '分拣员' },
                { key: 'planAt', label: '计划时间', render: function (r) { return U.fmt.dateTime(r.planAt); } },
                { key: 'status', label: '状态', render: function (r) { return U.statusBadge(r.status, 'task'); } },
                { key: 'missed', label: '漏拣', render: function (r) { return r.missed ? U.badge('漏拣', 'danger') : '<span class="tms-muted">否</span>'; } }
            ],
            toolbar: [{
                text: '新建分拣任务', className: 'tms-btn tms-btn-primary', onClick: function () {
                    U.formModal({
                        title: '新建分拣任务', fields: [
                            { key: 'orderId', label: '关联订单', type: 'select', required: true, options: orderOptions(['pending', 'inbound']), full: true },
                            { key: 'sorter', label: '分拣员', type: 'select', required: true, options: S.list('employees', { pageSize: 0 }).rows.map(function (e) { return e.name; }) },
                            { key: 'planAt', label: '计划时间', type: 'datetime-local', required: true }
                        ],
                        onSubmit: function (v) {
                            var order = S.get('orders', v.orderId);
                            S.create('sortingTasks', {
                                orderId: order.id, waybillNo: order.waybillNo, origin: order.origin,
                                destination: order.destination, center: order.origin + '分拨中心',
                                sorter: v.sorter, planAt: new Date(v.planAt).toISOString(),
                                status: 'pending', missed: false
                            });
                        }
                    });
                }
            }],
            actions: [
                {
                    label: '完成分拣', className: 'tms-btn-success', show: function (r) { return r.status !== 'done'; },
                    onClick: function (row) {
                        S.completeSorting(row.id);
                        U.toast('分拣完成，订单已进入待发运', 'success');
                    }
                },
                {
                    label: '标记漏拣', className: 'tms-btn-warning', show: function (r) { return !r.missed; },
                    onClick: function (row) {
                        S.update('sortingTasks', row.id, { missed: true });
                        U.toast('已标记为漏拣', 'warning');
                    }
                }
            ]
        }
    });

    /* ============================== 装卸管理 ============================== */

    define('loading', {
        title: '装卸管理',
        subtitle: '管理装卸任务与作业班组，完成后自动推进运输状态。',
        kpis: function () {
            var rows = S.list('loadingTasks', { pageSize: 0 }).rows;
            return [
                { label: '待作业', value: rows.filter(function (r) { return r.status === 'pending'; }).length, color: '#ff9800' },
                { label: '作业中', value: rows.filter(function (r) { return r.status === 'processing'; }).length, color: '#2196f3' },
                { label: '已完成', value: rows.filter(function (r) { return r.status === 'done'; }).length, color: '#4caf50' },
                { label: '累计吨位', value: Math.round(rows.reduce(function (s, r) { return s + Number(r.tons || 0); }, 0) * 10) / 10, color: '#667eea', sub: '吨' }
            ];
        },
        table: {
            entity: 'loadingTasks',
            searchPlaceholder: '搜索任务/订单/作业人员/车辆',
            searchFields: ['id', 'orderId', 'waybillNo', 'place', 'vehicleId', 'workers'],
            defaultSort: { key: 'planAt', dir: 'desc' },
            filters: [{ key: 'status', label: '全部状态', options: [{ value: 'pending', label: '待作业' }, { value: 'processing', label: '作业中' }, { value: 'done', label: '已完成' }] }],
            columns: [
                { key: 'id', label: '任务ID' },
                { key: 'orderId', label: '订单号', render: function (r) { return orderLink(r.orderId); } },
                { key: 'type', label: '类型' },
                { key: 'place', label: '作业地点' },
                { key: 'vehicleId', label: '车辆' },
                { key: 'workers', label: '作业人员' },
                { key: 'planAt', label: '计划时间', render: function (r) { return U.fmt.dateTime(r.planAt); } },
                { key: 'tons', label: '吨位', render: function (r) { return r.tons + ' 吨'; } },
                { key: 'status', label: '状态', render: function (r) { return U.statusBadge(r.status, 'task'); } }
            ],
            toolbar: [{
                text: '新建装卸任务', className: 'tms-btn tms-btn-primary', onClick: function () {
                    U.formModal({
                        title: '新建装卸任务', fields: [
                            { key: 'orderId', label: '关联订单', type: 'select', required: true, options: orderOptions(['sorted', 'inbound']), full: true },
                            { key: 'type', label: '作业类型', type: 'select', required: true, options: ['装车', '卸车'] },
                            { key: 'place', label: '作业地点', required: true },
                            { key: 'vehicleId', label: '车辆', type: 'select', options: S.list('vehicles', { pageSize: 0 }).rows.map(function (v) { return { value: v.id, label: v.plate }; }) },
                            { key: 'workers', label: '作业人员', required: true },
                            { key: 'planAt', label: '计划时间', type: 'datetime-local', required: true }
                        ],
                        onSubmit: function (v) {
                            var order = S.get('orders', v.orderId);
                            S.create('loadingTasks', {
                                orderId: order.id, waybillNo: order.waybillNo, type: v.type, place: v.place,
                                vehicleId: v.vehicleId, workers: v.workers,
                                planAt: new Date(v.planAt).toISOString(), startAt: '',
                                tons: order.weight / 1000, equipment: '叉车', status: 'pending'
                            });
                        }
                    });
                }
            }],
            actions: [
                {
                    label: '开始作业', className: 'tms-btn-warning', show: function (r) { return r.status === 'pending'; },
                    onClick: function (row) {
                        S.update('loadingTasks', row.id, { status: 'processing', startAt: new Date().toISOString() });
                        U.toast('装卸作业已开始', 'success');
                    }
                },
                {
                    label: '完成', className: 'tms-btn-success', show: function (r) { return r.status !== 'done'; },
                    onClick: function (row) {
                        S.completeLoading(row.id);
                        U.toast('装卸完成，订单已推进', 'success');
                    }
                }
            ]
        }
    });

    /* ============================== 扫描管理 ============================== */

    define('scan', {
        title: '扫描管理',
        subtitle: '查看扫描设备状态与全链路扫描记录，支持手动补扫。',
        kpis: function () {
            var today = S.dateKey(new Date());
            var scans = S.list('scans', { pageSize: 0 }).rows;
            var devices = S.list('devices', { pageSize: 0 }).rows;
            return [
                { label: '今日扫描', value: scans.filter(function (s) { return S.dateKey(s.scannedAt) === today; }).length, color: '#4ecdc4' },
                { label: '扫描总量', value: scans.length, color: '#667eea' },
                { label: '在线设备', value: devices.filter(function (d) { return d.status === 'online'; }).length + '/' + devices.length, color: '#4caf50' },
                { label: '异常扫描', value: 0, color: '#ff9800', sub: '设备离线或重复扫描' }
            ];
        },
        extraBefore: function (el) {
            el.innerHTML = '<div class="tms-panel"><div class="tms-panel-head"><h3>扫描设备</h3></div><div id="device-table"></div></div>';
            U.table(el.querySelector('#device-table'), {
                entity: 'devices', search: false, pageSize: 0,
                columns: [
                    { key: 'id', label: '设备ID' }, { key: 'name', label: '设备名称' },
                    { key: 'model', label: '型号' }, { key: 'location', label: '部署位置' },
                    { key: 'status', label: '状态', render: function (r) { return U.badge(r.status === 'online' ? '在线' : '维护中', r.status === 'online' ? 'success' : 'warn'); } },
                    { key: 'scansToday', label: '今日扫描量' },
                    { key: 'lastHeartbeat', label: '心跳时间', render: function (r) { return U.fmt.dateTime(r.lastHeartbeat); } }
                ],
                actions: [{
                    label: '心跳', className: 'tms-btn-light', onClick: function (row) {
                        S.update('devices', row.id, { status: 'online', lastHeartbeat: new Date().toISOString() });
                        U.toast('设备心跳已更新', 'success');
                    }
                }]
            });
        },
        table: {
            entity: 'scans',
            searchPlaceholder: '搜索订单/运单/设备/操作人',
            searchFields: ['orderId', 'waybillNo', 'device', 'operator', 'location', 'type'],
            defaultSort: { key: 'scannedAt', dir: 'desc' },
            pageSize: 12,
            filters: [{ key: 'type', label: '全部类型', options: ['入库扫描', '分拣扫描', '出库扫描', '到达扫描', '派送扫描', '签收扫描'] }],
            columns: [
                { key: 'scannedAt', label: '扫描时间', render: function (r) { return U.fmt.dateTime(r.scannedAt); } },
                { key: 'orderId', label: '订单号', render: function (r) { return orderLink(r.orderId); } },
                { key: 'waybillNo', label: '运单号' },
                { key: 'type', label: '扫描类型' },
                { key: 'location', label: '扫描位置' },
                { key: 'device', label: '设备' },
                { key: 'operator', label: '操作人' }
            ],
            toolbar: [{
                text: '手动补扫', className: 'tms-btn tms-btn-primary', onClick: function () {
                    U.formModal({
                        title: '手动补扫', fields: [
                            { key: 'orderId', label: '关联订单', type: 'select', required: true, options: allOrdersOptions(), full: true },
                            { key: 'type', label: '扫描类型', type: 'select', required: true, options: ['入库扫描', '分拣扫描', '出库扫描', '到达扫描', '派送扫描', '签收扫描'] },
                            { key: 'location', label: '扫描位置', required: true },
                            { key: 'operator', label: '操作人', required: true }
                        ],
                        onSubmit: function (v) {
                            var order = S.get('orders', v.orderId);
                            S.create('scans', {
                                scannedAt: new Date().toISOString(), orderId: order.id, waybillNo: order.waybillNo,
                                type: v.type, location: v.location, device: '手动补录', operator: v.operator
                            });
                        }
                    });
                }
            }],
            actions: [{
                label: '查看订单', className: 'tms-btn-light', onClick: function (row) { orderDetail(row.orderId); }
            }]
        }
    });

    /* ============================== 时效管理 ============================== */

    define('timing', {
        title: '时效管理',
        subtitle: '监控订单承诺时效与实际签收差异，配置线路标准时效规则。',
        kpis: function () {
            var rows = orderTimingRows();
            var signed = rows.filter(function (r) { return r.timing !== '运输中'; });
            var onTime = signed.filter(function (r) { return r.timing === '准时'; }).length;
            var delayed = signed.filter(function (r) { return r.timing === '延误'; }).length;
            return [
                { label: '准时率', value: signed.length ? Math.round(onTime / signed.length * 100) + '%' : '-', color: '#4caf50' },
                { label: '准时订单', value: onTime, color: '#2196f3' },
                { label: '延误订单', value: delayed, color: '#ff6b6b' },
                { label: '在途订单', value: rows.filter(function (r) { return r.timing === '运输中'; }).length, color: '#ff9800' }
            ];
        },
        table: {
            rows: function () { return orderTimingRows(); },
            searchPlaceholder: '搜索订单/运单/城市',
            searchFields: ['orderId', 'waybillNo', 'origin', 'destination', 'customer'],
            defaultSort: { key: 'expectedAt', dir: 'desc' },
            filters: [{ key: 'timing', label: '全部时效', options: ['准时', '延误', '运输中'] }],
            columns: [
                { key: 'orderId', label: '订单号', render: function (r) { return orderLink(r.orderId); } },
                { key: 'waybillNo', label: '运单号' },
                { key: 'route', label: '线路', render: function (r) { return U.esc(r.origin) + ' → ' + U.esc(r.destination); } },
                { key: 'expectedAt', label: '预计送达', render: function (r) { return U.fmt.dateTime(r.expectedAt); } },
                { key: 'actualAt', label: '实际送达', render: function (r) { return r.actualAt ? U.fmt.dateTime(r.actualAt) : '<span class="tms-muted">在途</span>'; } },
                { key: 'timing', label: '时效状态', render: function (r) { return U.badge(r.timing, r.timing === '准时' ? 'success' : (r.timing === '延误' ? 'danger' : 'warn')); } },
                { key: 'delay', label: '延误时长', render: function (r) { return r.delay > 0 ? r.delay + ' 小时' : '-'; } }
            ]
        },
        extraAfter: function (el) {
            el.innerHTML = '<div class="tms-panel"><div class="tms-panel-head"><h3>时效规则</h3></div><div id="timing-rules"></div></div>';
            U.table(el.querySelector('#timing-rules'), {
                entity: 'timingRules',
                search: false,
                pageSize: 0,
                columns: [
                    { key: 'id', label: '规则ID' }, { key: 'route', label: '线路' },
                    { key: 'mode', label: '运输方式' }, { key: 'standard', label: '标准时效' },
                    { key: 'priority', label: '优先级' },
                    { key: 'status', label: '状态', render: function (r) { return U.statusBadge(r.status, 'policy'); } }
                ],
                actions: [
                    {
                        label: '编辑', className: 'tms-btn-light', onClick: function (row) {
                            U.formModal({
                                title: '编辑时效规则', values: row, fields: [
                                    { key: 'route', label: '线路', required: true },
                                    { key: 'mode', label: '运输方式', type: 'select', options: ['陆运', '空运', '铁路'] },
                                    { key: 'standard', label: '标准时效', required: true },
                                    { key: 'priority', label: '优先级', type: 'select', options: ['高', '中', '低'] }
                                ],
                                onSubmit: function (v) {
                                    S.update('timingRules', row.id, v);
                                }
                            });
                        }
                    },
                    {
                        label: '停用', className: 'tms-btn-danger', show: function (r) { return r.status === 'active'; },
                        onClick: function (row) {
                            S.update('timingRules', row.id, { status: 'inactive' });
                            U.toast('规则已停用', 'success');
                        }
                    }
                ]
            });
        }
    });

    function orderTimingRows() {
        return S.list('orders', { sort: { key: 'expectedAt', dir: 'desc' }, pageSize: 0 }).rows
            .filter(function (o) { return o.status !== 'cancelled'; })
            .map(function (o) {
                var expected = new Date(o.expectedAt).getTime();
                var actual = o.signedAt ? new Date(o.signedAt).getTime() : 0;
                var delay = actual ? Math.max(0, Math.round((actual - expected) / 3600000)) : 0;
                var timing = '运输中';
                if (actual) timing = delay > 0 ? '延误' : '准时';
                return {
                    id: o.id,
                    orderId: o.id,
                    waybillNo: o.waybillNo,
                    customer: o.customer,
                    origin: o.origin,
                    destination: o.destination,
                    expectedAt: o.expectedAt,
                    actualAt: o.signedAt,
                    timing: timing,
                    delay: delay
                };
            });
    }

    /* ============================== 新链路页面公共 helper ============================== */

    function orderTypeBadge(o) {
        var t = o.orderType || 'forward';
        var m = { forward: ['正向件', 'info'], reverse: ['逆向件', 'warn'], intercept: ['拦截件', 'danger'] }[t] || ['正向件', 'info'];
        return U.badge(m[0], m[1]);
    }

    function orderTimingCell(o) {
        if (o.status === 'cancelled') return '<span class="tms-muted">已取消</span>';
        var exp = new Date(o.expectedAt).getTime();
        if (o.signedAt) {
            var d = Math.round((new Date(o.signedAt).getTime() - exp) / 3600000);
            return d > 0 ? U.badge('延误' + d + 'h', 'danger') : U.badge('准时', 'success');
        }
        if (Date.now() > exp) return U.badge('超时未收', 'danger');
        return U.badge('时效内', 'info');
    }

    function orderStatusOptions() {
        return S.ORDER_FLOW.map(function (s) { return { value: s.key, label: s.label }; })
            .concat([{ value: 'cancelled', label: '已取消' }]);
    }

    function renderQuoteInto(target, q) {
        if (!q) { target.innerHTML = ''; return; }
        target.innerHTML = U.detailGrid([
            { label: '命中运价卡', value: U.esc(q.cardName || '-') },
            { label: '计费重量', value: q.chargeableWeight + ' kg（实际 ' + q.actualWeight + ' / 体积 ' + q.volumetricWeight + '）' },
            { label: '首重', value: U.fmt.money(q.firstFee) },
            { label: '续重', value: U.fmt.money(q.continueFee) + (q.minimumApplied ? '（触发最低消费）' : '') },
            { label: '燃油附加', value: U.fmt.money(q.fuelFee) },
            { label: '偏远附加', value: U.fmt.money(q.remoteFee) },
            { label: '保价费', value: U.fmt.money(q.insuredFee) },
            { label: '到付手续费', value: U.fmt.money(q.codFee) },
            { label: '协议折扣', value: q.discount ? '-' + U.fmt.money(q.discount) + '（' + Math.round(q.discountRate * 100) + '%）' : '无' },
            { label: '报价合计', value: '<span class="tms-strong">' + U.fmt.money(q.total) + '</span>' }
        ]);
    }

    /* ============================== 订单管理（全生命周期） ============================== */

    define('order', {
        title: '订单管理',
        subtitle: '管理订单全生命周期：新建联动计费、推进流转、改单重算、取消拦截与逆向退货。',
        kpis: function () {
            var st = S.orderLifecycleStats();
            return [
                { label: '订单总量', value: st.total, color: '#667eea', sub: '含全部生命周期' },
                { label: '已签收', value: st.signed, color: '#4caf50', sub: '取消率 ' + st.cancelRate + '% · 逆向率 ' + st.reverseRate + '%' },
                { label: '逆向件', value: st.reverse, color: '#ff9800', sub: '拒收/退货生成' },
                { label: '拦截件', value: st.intercept, color: '#ff6b6b', sub: '已发运后取消' }
            ];
        },
        table: {
            entity: 'orders',
            searchPlaceholder: '搜索订单号/运单号/客户/货物',
            searchFields: ['id', 'waybillNo', 'customer', 'goods', 'origin', 'destination'],
            defaultSort: { key: 'createdAt', dir: 'desc' },
            pageSize: 12,
            filters: [
                { key: 'status', label: '全部状态', options: orderStatusOptions() },
                { key: 'orderType', label: '全部类型', options: [{ value: 'forward', label: '正向件' }, { value: 'reverse', label: '逆向件' }, { value: 'intercept', label: '拦截件' }] }
            ],
            columns: [
                { key: 'id', label: '订单号', render: function (r) { return orderLink(r.id); } },
                { key: 'customer', label: '客户' },
                { key: 'orderType', label: '类型', render: orderTypeBadge },
                { key: 'route', label: '线路', render: function (r) { return U.esc(r.origin) + '→' + U.esc(r.destination); } },
                { key: 'chargeableWeight', label: '计费重', render: function (r) { return (r.chargeableWeight || r.weight) + ' kg'; } },
                { key: 'freight', label: '运费', render: function (r) { return U.fmt.money(r.freight); } },
                { key: 'paymentMethod', label: '付款', render: function (r) { return U.esc(r.paymentMethod || '现付'); } },
                { key: 'status', label: '状态', render: function (r) { return U.statusBadge(r.status, 'order'); } },
                { key: 'expectedAt', label: '时效', render: orderTimingCell }
            ],
            toolbar: [{
                text: '新建订单', className: 'tms-btn tms-btn-primary', onClick: function () {
                    U.formModal({
                        title: '新建订单（自动生成运费）', width: 680,
                        fields: [
                            { key: 'customer', label: '客户', type: 'select', required: true, options: S.dict.customers, placeholder: '请选择客户' },
                            { key: 'goods', label: '货物', type: 'select', required: true, options: S.dict.goods, placeholder: '请选择货物' },
                            { key: 'origin', label: '始发城市', type: 'select', required: true, options: S.dict.cities },
                            { key: 'destination', label: '目的城市', type: 'select', required: true, options: S.dict.cities },
                            { key: 'service', label: '服务等级', type: 'select', required: true, options: S.dict.serviceLevels },
                            { key: 'paymentMethod', label: '付款方式', type: 'select', required: true, options: S.dict.paymentMethods },
                            { key: 'weight', label: '重量(kg)', type: 'number', required: true, min: 0.1, step: 0.1, value: 5 },
                            { key: 'pieces', label: '件数', type: 'number', min: 1, value: 1 },
                            { key: 'dims', label: '尺寸(长x宽x高 cm)', placeholder: '如 40x30x20，用于体积重' },
                            { key: 'declaredValue', label: '声明价值(元)', type: 'number', min: 0, value: 0 },
                            { key: 'codAmount', label: '代收货款(元)', type: 'number', min: 0, value: 0, placeholder: '仅到付件：向收件人代收的货款本金' },
                            { key: 'isInsured', label: '是否保价', type: 'checkbox', checkboxLabel: '按声明价值投保' },
                            { key: 'receiverAddress', label: '收货地址', full: true, placeholder: '详细地址' }
                        ],
                        submitText: '创建订单',
                        onSubmit: function (v) {
                            var order = S.createOrder(v);
                            U.toast('订单已创建 ' + order.id + '，运费 ' + U.fmt.money(order.freight), 'success');
                        }
                    });
                }
            }],
            actions: [
                {
                    label: '推进', className: 'tms-btn-warning', show: function (r) { return r.status !== 'signed' && r.status !== 'cancelled'; },
                    onClick: function (row) {
                        var res = S.advanceOrder(row.id, '运营管理员');
                        U.toast(res.ok ? ('已推进至「' + res.label + '」') : res.message, res.ok ? 'success' : 'error');
                    }
                },
                {
                    label: '改单', className: 'tms-btn-light', show: function (r) { return r.status !== 'signed' && r.status !== 'cancelled'; },
                    onClick: function (row) {
                        U.formModal({
                            title: '订单改单（重算运费）', width: 560, values: row,
                            fields: [
                                { key: 'receiverAddress', label: '收货地址', full: true },
                                { key: 'destination', label: '目的城市', type: 'select', options: S.dict.cities },
                                { key: 'weight', label: '新重量(kg)', type: 'number', min: 0.1, step: 0.1 },
                                { key: 'service', label: '服务等级', type: 'select', options: S.dict.serviceLevels },
                                { key: 'expectedAt', label: '改约送达时间', type: 'date' },
                                { key: 'changeReason', label: '改单原因', full: true, placeholder: '如客户要求改址/改约' }
                            ],
                            submitText: '提交改单',
                            onSubmit: function (v) {
                                var patch = { receiverAddress: v.receiverAddress, destination: v.destination, weight: v.weight, service: v.service, changeReason: v.changeReason };
                                if (v.expectedAt) patch.expectedAt = new Date(v.expectedAt + 'T12:00:00').toISOString();
                                var res = S.changeOrder(row.id, patch);
                                if (res.ok) U.toast('改单成功，最新运费 ' + U.fmt.money(res.order.freight), 'success');
                                else U.toast(res.message, 'error');
                            }
                        });
                    }
                },
                {
                    label: '取消', className: 'tms-btn-danger', show: function (r) { return r.status !== 'signed' && r.status !== 'cancelled'; },
                    onClick: async function (row) {
                        var shipped = ['shipping', 'arrived', 'delivering'].indexOf(row.status) > -1;
                        var msg = shipped ? '该订单已发运，取消将转为「拦截件」并冲销应收/收入，确认？' : '确认取消该订单？相关未核销应收将作废。';
                        if (await U.confirm({ message: msg, danger: true, okText: '取消订单' })) {
                            var ok = S.cancelOrder(row.id, '运营取消');
                            U.toast(ok ? (shipped ? '已拦截取消，运力已释放' : '订单已取消') : '取消失败', ok ? 'success' : 'error');
                        }
                    }
                },
                {
                    label: '转逆向', className: 'tms-btn-light', show: function (r) { return ['arrived', 'delivering', 'signed'].indexOf(r.status) > -1 && (r.orderType || 'forward') === 'forward'; },
                    onClick: async function (row) {
                        if (await U.confirm({ message: '由拒收/退货生成逆向退货件，正向单置退回，确认？', okText: '生成逆向件' })) {
                            var res = S.createReverseOrder(row.id, '客户拒收/退货');
                            U.toast(res.ok ? ('已生成逆向件 ' + res.reverse.id) : res.message, res.ok ? 'success' : 'error');
                        }
                    }
                },
                {
                    label: '复核', className: 'tms-btn-light', show: function (r) { return ['inbound', 'sorted', 'shipping', 'arrived', 'delivering', 'signed'].indexOf(r.status) > -1; },
                    onClick: function (row) {
                        U.formModal({
                            title: '磅重/体积复核 · ' + row.id, width: 560,
                            fields: [
                                { key: 'actualWeight', label: '实际磅重(kg)', type: 'number', required: true, min: 0.1, step: 0.1, value: row.weight },
                                { key: 'dims', label: '实际尺寸(长x宽x高 cm)', placeholder: '如 40x30x20，留空=沿用原尺寸' },
                                { key: 'reason', label: '复核原因', type: 'select', full: true, options: ['到货复磅重量偏大', '体积测量与下单不符', '客户少报重量', '包装增加体积', '实际件数多于申报'] },
                                { key: 'operator', label: '复核人', full: true, placeholder: '操作人姓名' }
                            ],
                            submitText: '提交复核',
                            onSubmit: function (v) {
                                var res = S.recheckWeight(row.id, { actualWeight: v.actualWeight, dims: v.dims, reason: v.reason, operator: v.operator });
                                if (!res.ok) { U.toast(res.message, 'error'); return; }
                                var d = res.delta;
                                U.toast(Math.abs(d) < 0.01 ? ('复核完成，计费无差异（' + U.fmt.money(res.order.freight) + '）')
                                    : ('复核完成：' + (d > 0 ? '补收 ' : '退费 ') + U.fmt.money(Math.abs(d)) + '，最新运费 ' + U.fmt.money(res.order.freight)), 'success');
                            }
                        });
                    }
                },
                { label: '详情', className: 'tms-btn-light', onClick: function (row) { orderDetail(row.id); } }
            ]
        },
        extraAfter: function (el) {
            el.innerHTML = '<div class="tms-panel"><div class="tms-panel-head"><h3>订单生命周期状态分布</h3></div><div class="tms-panel-body" id="order-life-donut"></div></div>';
            var dist = S.statusDistribution();
            U.charts.donut(el.querySelector('#order-life-donut'), {
                data: dist.map(function (d) { return { label: d.label, value: d.value }; })
            });
        }
    });

    /* ============================== 运价管理 + 计费试算 ============================== */

    define('rate', {
        title: '运价管理',
        subtitle: '维护线路×服务等级的运价模板，并使用计费试算工具验证报价拆解。',
        kpis: function () {
            var cards = S.list('rateCards', { pageSize: 0 }).rows;
            var active = cards.filter(function (c) { return c.status === 'active'; });
            var lanes = {};
            cards.forEach(function (c) { if (c.origin !== '全国') lanes[c.origin + c.destination] = 1; });
            return [
                { label: '运价卡', value: cards.length, color: '#667eea', sub: '生效 ' + active.length + ' 张' },
                { label: '覆盖线路', value: Object.keys(lanes).length, color: '#2196f3', sub: '不含全国兜底' },
                { label: '服务等级', value: S.dict.serviceLevels.length, color: '#4ecdc4' },
                { label: '最低消费基准', value: U.fmt.money(active.length ? active[0].minimum : 0), color: '#4caf50', sub: '标准兜底卡' }
            ];
        },
        extraBefore: function (el) {
            el.innerHTML = '<div class="tms-panel"><div class="tms-panel-head"><h3>计费试算工具</h3></div><div class="tms-panel-body">' +
                '<div class="tms-form">' +
                fieldSelect('q-origin', '始发城市', S.dict.cities) +
                fieldSelect('q-dest', '目的城市', S.dict.cities) +
                fieldSelect('q-service', '服务等级', S.dict.serviceLevels) +
                fieldSelect('q-pay', '付款方式', S.dict.paymentMethods) +
                fieldNumber('q-weight', '重量(kg)', 12) +
                fieldText('q-dims', '尺寸(长x宽x高 cm)', '40x30x20') +
                fieldNumber('q-declared', '声明价值(元)', 0) +
                fieldSelect('q-customer', '客户', S.dict.customers) +
                '</div><div style="margin-top:.8rem"><button type="button" class="tms-btn tms-btn-primary" id="q-run">开始试算</button></div>' +
                '<div id="q-result" style="margin-top:1rem"></div></div></div>';
            function fieldSelect(id, label, opts) {
                var html = '<div class="tms-field"><label>' + U.esc(label) + '</label><select id="' + id + '">';
                opts.forEach(function (o) { html += '<option value="' + U.esc(o) + '">' + U.esc(o) + '</option>'; });
                return html + '</select></div>';
            }
            function fieldNumber(id, label, val) {
                return '<div class="tms-field"><label>' + U.esc(label) + '</label><input type="number" id="' + id + '" value="' + val + '" min="0" step="0.1"></div>';
            }
            function fieldText(id, label, ph) {
                return '<div class="tms-field"><label>' + U.esc(label) + '</label><input type="text" id="' + id + '" placeholder="' + U.esc(ph) + '"></div>';
            }
            function run() {
                var q = S.quote({
                    origin: el.querySelector('#q-origin').value,
                    destination: el.querySelector('#q-dest').value,
                    service: el.querySelector('#q-service').value,
                    paymentMethod: el.querySelector('#q-pay').value,
                    weight: Number(el.querySelector('#q-weight').value) || 0,
                    dims: el.querySelector('#q-dims').value,
                    declaredValue: Number(el.querySelector('#q-declared').value) || 0,
                    isInsured: Number(el.querySelector('#q-declared').value) > 0,
                    customer: el.querySelector('#q-customer').value
                });
                renderQuoteInto(el.querySelector('#q-result'), q);
            }
            el.querySelector('#q-run').addEventListener('click', run);
            run();
        },
        table: {
            entity: 'rateCards',
            searchPlaceholder: '搜索运价卡/线路',
            searchFields: ['id', 'name', 'origin', 'destination', 'service'],
            defaultSort: { key: 'id', dir: 'asc' },
            pageSize: 12,
            filters: [{ key: 'service', label: '全部服务', options: S.dict.serviceLevels }],
            columns: [
                { key: 'name', label: '运价卡' },
                { key: 'origin', label: '始发' },
                { key: 'destination', label: '目的' },
                { key: 'service', label: '服务等级' },
                { key: 'firstPrice', label: '首重(1kg)', render: function (r) { return U.fmt.money(r.firstPrice); } },
                { key: 'continuePrice', label: '续重/kg', render: function (r) { return U.fmt.money(r.continuePrice); } },
                { key: 'throwRatio', label: '抛比' },
                { key: 'minimum', label: '最低消费', render: function (r) { return U.fmt.money(r.minimum); } },
                { key: 'status', label: '状态', render: function (r) { return U.statusBadge(r.status, 'rate'); } }
            ],
            toolbar: [{
                text: '新增运价卡', className: 'tms-btn tms-btn-primary', onClick: function () {
                    U.formModal({
                        title: '新增运价卡', width: 600,
                        fields: [
                            { key: 'origin', label: '始发（城市或全国）', type: 'select', required: true, options: ['全国'].concat(S.dict.cities) },
                            { key: 'destination', label: '目的（城市或全国）', type: 'select', required: true, options: ['全国'].concat(S.dict.cities) },
                            { key: 'service', label: '服务等级', type: 'select', required: true, options: S.dict.serviceLevels },
                            { key: 'firstPrice', label: '首重价格', type: 'number', required: true, min: 0, step: 0.5 },
                            { key: 'continuePrice', label: '续重单价', type: 'number', required: true, min: 0, step: 0.5 },
                            { key: 'throwRatio', label: '计抛比', type: 'number', min: 1, step: 100, value: 8000 },
                            { key: 'minimum', label: '最低消费', type: 'number', min: 0, step: 1, value: 15 },
                            { key: 'fuelRate', label: '燃油费率', type: 'number', min: 0, step: 0.01, value: 0.1 },
                            { key: 'remoteFee', label: '偏远附加', type: 'number', min: 0, step: 1, value: 8 }
                        ],
                        submitText: '保存',
                        onSubmit: function (v) {
                            v.name = v.origin + '→' + v.destination + ' · ' + v.service + '价';
                            v.firstWeight = 1; v.continueUnit = 1; v.insuredRate = 0.006; v.codRate = 0.03;
                            v.status = 'active';
                            S.create('rateCards', v);
                            U.toast('运价卡已新增', 'success');
                        }
                    });
                }
            }],
            actions: [
                {
                    label: '编辑', className: 'tms-btn-light', onClick: function (row) {
                        U.formModal({
                            title: '编辑运价卡', width: 600, values: row,
                            fields: [
                                { key: 'service', label: '服务等级', type: 'select', options: S.dict.serviceLevels },
                                { key: 'firstPrice', label: '首重价格', type: 'number', min: 0, step: 0.5 },
                                { key: 'continuePrice', label: '续重单价', type: 'number', min: 0, step: 0.5 },
                                { key: 'throwRatio', label: '计抛比', type: 'number', min: 1, step: 100 },
                                { key: 'minimum', label: '最低消费', type: 'number', min: 0, step: 1 },
                                { key: 'fuelRate', label: '燃油费率', type: 'number', min: 0, step: 0.01 },
                                { key: 'remoteFee', label: '偏远附加', type: 'number', min: 0, step: 1 }
                            ],
                            onSubmit: function (v) {
                                v.name = row.origin + '→' + row.destination + ' · ' + (v.service || row.service) + '价';
                                S.update('rateCards', row.id, v);
                                U.toast('运价卡已更新', 'success');
                            }
                        });
                    }
                },
                {
                    label: '停用', className: 'tms-btn-danger', show: function (r) { return r.status === 'active'; },
                    onClick: function (row) { S.update('rateCards', row.id, { status: 'inactive' }); U.toast('运价卡已停用', 'success'); }
                },
                {
                    label: '启用', className: 'tms-btn-success', show: function (r) { return r.status !== 'active'; },
                    onClick: function (row) { S.update('rateCards', row.id, { status: 'active' }); U.toast('运价卡已启用', 'success'); }
                }
            ]
        }
    });

    /* ============================== 应收结算 ============================== */

    define('receivable', {
        title: '应收结算',
        subtitle: '追踪运费应收与回款账龄，按月/客户聚合账单，核销回款自动冲抵挂账收入。',
        kpis: function () {
            var b = S.billingSummary();
            return [
                { label: '应收总额', value: U.fmt.money(b.totalReceivable), color: '#667eea', sub: '未回款挂账' },
                { label: '逾期金额', value: U.fmt.money(b.overdue), color: '#ff6b6b', sub: '超过到期日' },
                { label: '已回款', value: U.fmt.money(b.received), color: '#4caf50', sub: '累计核销' },
                { label: '回款率', value: b.collectionRate + '%', color: '#2196f3', sub: '共 ' + b.count + ' 笔应收' }
            ];
        },
        charts: function (el) {
            var b = S.billingSummary();
            el.innerHTML = '<div class="tms-panel"><div class="tms-panel-head"><h3>应收账龄分布</h3></div><div class="tms-panel-body" id="aging-chart"></div></div>';
            U.charts.bar(el.querySelector('#aging-chart'), {
                labels: ['0-30天', '31-60天', '61-90天', '90天以上'],
                series: [{ name: '应收金额', color: '#ff9800', data: [b.aging['0-30'], b.aging['31-60'], b.aging['61-90'], b.aging['90+']] }],
                height: 240
            });
        },
        extraBefore: function (el) {
            el.innerHTML = '<div class="tms-panel"><div class="tms-panel-head"><h3>客户账单</h3></div><div id="bill-table"></div></div>';
            U.table(el.querySelector('#bill-table'), {
                entity: 'bills',
                searchPlaceholder: '搜索账单号/客户',
                searchFields: ['billNo', 'customer', 'period'],
                defaultSort: { key: 'period', dir: 'desc' },
                pageSize: 5,
                filters: [{ key: 'status', label: '全部状态', options: [{ value: 'draft', label: '草稿' }, { value: 'confirmed', label: '已确认' }, { value: 'settled', label: '已结清' }, { value: 'disputed', label: '争议中' }] }],
                columns: [
                    { key: 'billNo', label: '账单号' },
                    { key: 'customer', label: '客户' },
                    { key: 'period', label: '账期' },
                    { key: 'itemCount', label: '笔数' },
                    { key: 'totalAmount', label: '账单金额', render: function (r) { return U.fmt.money(r.totalAmount); } },
                    { key: 'receivedAmount', label: '已回款', render: function (r) { return U.fmt.money(r.receivedAmount); } },
                    { key: 'dueDate', label: '到期日', render: function (r) { return U.fmt.date(r.dueDate); } },
                    { key: 'status', label: '状态', render: function (r) { return U.statusBadge(r.status, 'bill'); } }
                ],
                actions: [
                    { label: '确认', className: 'tms-btn-success', show: function (r) { return r.status === 'draft'; }, onClick: function (row) { S.update('bills', row.id, { status: 'confirmed' }); U.toast('账单已确认', 'success'); } },
                    { label: '标记争议', className: 'tms-btn-warning', show: function (r) { return r.status !== 'settled'; }, onClick: function (row) { S.update('bills', row.id, { status: 'disputed' }); U.toast('账单已标记争议', 'success'); } }
                ]
            });
        },
        table: {
            entity: 'receivables',
            searchPlaceholder: '搜索订单号/客户',
            searchFields: ['orderId', 'customer', 'id'],
            defaultSort: { key: 'dueDate', dir: 'asc' },
            pageSize: 12,
            filters: [{ key: 'status', label: '全部状态', options: [{ value: 'unpaid', label: '未回款' }, { value: 'partial', label: '部分回款' }, { value: 'paid', label: '已回款' }, { value: 'overdue', label: '已逾期' }, { value: 'void', label: '已作废' }] }],
            columns: [
                { key: 'id', label: '应收单号' },
                { key: 'orderId', label: '订单号', render: function (r) { return orderLink(r.orderId); } },
                { key: 'customer', label: '客户' },
                { key: 'amount', label: '金额', render: function (r) { return U.fmt.money(r.amount); } },
                { key: 'paymentMethod', label: '付款方式' },
                { key: 'issuedAt', label: '挂账日', render: function (r) { return U.fmt.date(r.issuedAt); } },
                { key: 'dueDate', label: '到期日', render: function (r) { return U.fmt.date(r.dueDate); } },
                { key: 'billId', label: '账单', render: function (r) { return r.billId ? '<span class="tms-muted">已归集</span>' : '<span class="tms-badge tms-badge-muted">未归集</span>'; } },
                { key: 'status', label: '状态', render: function (r) { return U.statusBadge(r.status, 'receivable'); } }
            ],
            toolbar: [{
                text: '生成客户账单', className: 'tms-btn tms-btn-primary', onClick: function () {
                    U.formModal({
                        title: '按账期/客户聚合未归集应收',
                        fields: [
                            { key: 'period', label: '账期(yyyy-MM)', placeholder: '留空=全部当期', full: true },
                            { key: 'customer', label: '客户', type: 'select', options: [''].concat(S.dict.customers), placeholder: '留空=全部客户' }
                        ],
                        submitText: '生成账单',
                        onSubmit: function (v) {
                            var created = S.generateBills(v.period, v.customer);
                            U.toast(created.length ? ('已生成 ' + created.length + ' 张账单') : '没有可归集的应收', created.length ? 'success' : 'info');
                        }
                    });
                }
            }],
            actions: [
                {
                    label: '核销回款', className: 'tms-btn-success', show: function (r) { return r.status !== 'paid' && r.status !== 'void'; },
                    onClick: function (row) {
                        S.markReceivablePaid(row.id);
                        U.toast('应收已核销，挂账收入同步结算', 'success');
                    }
                },
                { label: '查看订单', className: 'tms-btn-light', onClick: function (row) { orderDetail(row.orderId); } }
            ]
        }
    });

    /* ============================== 应付结算（成本应付与结算） ============================== */

    var PAY_TARGET_TYPE = { carrier: '承运商', driver: '司机', branch: '网点' };

    function money(n) { return Math.round((Number(n) || 0) * 100) / 100; }

    define('payable', {
        title: '应付结算',
        subtitle: '管理与承运商/司机/网点的成本应付：干线运费与异常定责扣款，结算后自动生成支出流水。',
        kpis: function () {
            var p = S.payableSummary();
            return [
                { label: '应付总额', value: U.fmt.money(p.total), color: '#667eea', sub: '成本合计' },
                { label: '待结算', value: U.fmt.money(p.pending), color: '#ff9800', sub: p.pendingCount + ' 笔待付' },
                { label: '已结算', value: U.fmt.money(p.settled), color: '#4caf50', sub: '已生成支出流水' },
                { label: '应付笔数', value: p.count, color: '#2196f3', sub: '承运/司机/网点' }
            ];
        },
        charts: function (el) {
            var pb = S.payableBreakdown();
            el.innerHTML = '<div class="tms-panel"><div class="tms-panel-head"><h3>应付结构（按分类）</h3></div><div class="tms-panel-body" id="payable-chart"></div></div>';
            U.charts.donut(el.querySelector('#payable-chart'), {
                data: pb.byCategory.map(function (d) { return { label: d.label, value: d.value }; }),
                formatValue: function (v) { return U.fmt.money(v); }
            });
        },
        extraAfter: function (el) {
            var pb = S.payableBreakdown();
            el.innerHTML = '<div class="tms-panel"><div class="tms-panel-head"><h3>应付金额·按结算对象类型</h3></div><div class="tms-panel-body" id="payable-type-chart"></div></div>';
            U.charts.bar(el.querySelector('#payable-type-chart'), {
                labels: pb.byTargetType.map(function (d) { return d.label; }),
                series: [{ name: '应付金额', color: '#ff8a65', data: pb.byTargetType.map(function (d) { return d.value; }) }],
                height: 240
            });
        },
        table: {
            entity: 'payables',
            searchPlaceholder: '搜索应付单号/对象/订单',
            searchFields: ['id', 'target', 'refId'],
            defaultSort: { key: 'period', dir: 'desc' },
            pageSize: 12,
            filters: [
                { key: 'status', label: '全部状态', options: [{ value: 'pending', label: '待结算' }, { value: 'settled', label: '已结算' }] },
                { key: 'targetType', label: '全部对象', options: [{ value: 'carrier', label: '承运商' }, { value: 'driver', label: '司机' }, { value: 'branch', label: '网点' }] },
                { key: 'category', label: '全部分类', options: [{ value: '干线运费', label: '干线运费' }, { value: '异常扣款', label: '异常扣款' }] }
            ],
            columns: [
                { key: 'id', label: '应付单号' },
                { key: 'target', label: '结算对象' },
                { key: 'targetType', label: '对象类型', render: function (r) { return U.esc(PAY_TARGET_TYPE[r.targetType] || r.targetType || '-'); } },
                { key: 'category', label: '分类' },
                { key: 'refId', label: '关联订单', render: function (r) { return /^HL/.test(r.refId || '') ? orderLink(r.refId) : '<span class="tms-muted">-</span>'; } },
                { key: 'amount', label: '金额', render: function (r) { return U.fmt.money(r.amount); } },
                { key: 'period', label: '账期' },
                { key: 'status', label: '状态', render: function (r) { return U.statusBadge(r.status, 'payable'); } }
            ],
            actions: [
                {
                    label: '结算', className: 'tms-btn-success', show: function (r) { return r.status !== 'settled'; },
                    onClick: function (row) {
                        S.settlePayable(row.id);
                        U.toast('应付已结算，生成 ' + U.fmt.money(row.amount) + ' 支出流水', 'success');
                    }
                },
                { label: '查看订单', className: 'tms-btn-light', show: function (r) { return /^HL/.test(r.refId || ''); }, onClick: function (row) { orderDetail(row.refId); } }
            ]
        }
    });

    /* ============================== 计费复核审计（磅重/体积差异） ============================== */

    define('audit', {
        title: '计费复核',
        subtitle: '记录到货磅重/体积与下单的差异审计，自动重算运费并多退少补，联动应收与财务流水。',
        kpis: function () {
            var rows = S.list('rechecks', { pageSize: 0 }).rows;
            var extra = 0, refund = 0;
            rows.forEach(function (r) { if (r.delta > 0) extra += Number(r.delta); else if (r.delta < 0) refund += Math.abs(Number(r.delta)); });
            return [
                { label: '复核笔数', value: rows.length, color: '#667eea', sub: '审计留痕' },
                { label: '累计补收', value: U.fmt.money(money(extra)), color: '#4caf50', sub: '重量/体积偏大' },
                { label: '累计退费', value: U.fmt.money(money(refund)), color: '#ff6b6b', sub: '重量/体积偏小' },
                { label: '净调整', value: U.fmt.money(money(extra - refund)), color: '#2196f3', sub: '补收 - 退费' }
            ];
        },
        table: {
            entity: 'rechecks',
            searchPlaceholder: '搜索订单号/运单号/客户',
            searchFields: ['orderId', 'waybillNo', 'customer', 'id'],
            defaultSort: { key: 'auditedAt', dir: 'desc' },
            pageSize: 12,
            filters: [{ key: 'type', label: '全部类型', options: [{ value: '补收', label: '补收' }, { value: '退费', label: '退费' }, { value: '一致', label: '无差异' }] }],
            columns: [
                { key: 'id', label: '复核单号' },
                { key: 'orderId', label: '订单号', render: function (r) { return orderLink(r.orderId); } },
                { key: 'customer', label: '客户' },
                { key: 'weight', label: '下单/实磅(kg)', render: function (r) { return r.originalWeight + ' → ' + r.auditedWeight; } },
                { key: 'chargeable', label: '计费重(kg)', render: function (r) { return (r.originalChargeable || '-') + ' → ' + (r.auditedChargeable || '-'); } },
                { key: 'freight', label: '运费变动', render: function (r) { return U.fmt.money(r.originalFreight) + ' → ' + U.fmt.money(r.auditedFreight); } },
                { key: 'delta', label: '差额', render: function (r) { var d = Number(r.delta) || 0; return '<span class="tms-strong" style="color:' + (d > 0 ? '#2e7d32' : d < 0 ? '#c0392b' : '#888') + '">' + (d > 0 ? '+' : d < 0 ? '-' : '') + U.fmt.money(Math.abs(d)).replace('¥', '¥') + '</span>'; } },
                { key: 'type', label: '处理', render: function (r) { return U.badge(r.type, r.type === '补收' ? 'success' : r.type === '退费' ? 'danger' : 'muted'); } },
                { key: 'reason', label: '原因' },
                { key: 'operator', label: '复核人' },
                { key: 'auditedAt', label: '复核时间', render: function (r) { return U.fmt.dateTime(r.auditedAt); } }
            ],
            actions: [
                { label: '查看订单', className: 'tms-btn-light', onClick: function (row) { orderDetail(row.orderId); } }
            ]
        }
    });


    /* ============================== 末端派送与 POD 回单 ============================== */

    var POD_RECEIVERS = ['本人签收', '家人代收', '前台代收', '门卫代收', '同事代收', '驿站代收'];

    define('delivery', {
        title: '派送管理',
        subtitle: '管理末端派送派单与 POD 回单签收：为已到件分配派送员，签收自动联动结算与代收货款。',
        kpis: function () {
            var rows = S.list('orders', { pageSize: 0 }).rows;
            var today = new Date().toDateString();
            return [
                { label: '待派送', value: rows.filter(function (r) { return r.status === 'arrived'; }).length, color: '#ff9800', sub: '已到达待分单' },
                { label: '派送中', value: rows.filter(function (r) { return r.status === 'delivering'; }).length, color: '#667eea', sub: '末端配送中' },
                { label: '今日签收', value: rows.filter(function (r) { return r.status === 'signed' && r.signedAt && new Date(r.signedAt).toDateString() === today; }).length, color: '#4caf50', sub: 'POD 回单' },
                { label: '派送中代收件', value: rows.filter(function (r) { return r.status === 'delivering' && r.paymentMethod === '到付' && Number(r.codAmount) > 0; }).length, color: '#e91e63', sub: '到付需收款' }
            ];
        },
        charts: function (el) {
            var rows = S.list('orders', { pageSize: 0 }).rows;
            var map = { arrived: 0, delivering: 0, signed: 0 };
            rows.forEach(function (r) { if (map[r.status] != null) map[r.status]++; });
            el.innerHTML = '<div class="tms-panel"><div class="tms-panel-head"><h3>派送环节分布</h3></div><div class="tms-panel-body" id="delivery-donut"></div></div>';
            U.charts.donut(el.querySelector('#delivery-donut'), {
                data: [{ label: '待派送', value: map.arrived }, { label: '派送中', value: map.delivering }, { label: '已签收', value: map.signed }]
            });
        },
        table: {
            rows: function () {
                return S.list('orders', { pageSize: 0 }).rows.filter(function (r) {
                    return r.orderType !== 'reverse' && ['arrived', 'delivering', 'signed'].indexOf(r.status) > -1;
                });
            },
            searchPlaceholder: '搜索订单号/运单号/客户/收件人/派送员',
            searchFields: ['id', 'waybillNo', 'customer', 'contact', 'courier'],
            defaultSort: { key: 'updatedAt', dir: 'desc' },
            pageSize: 12,
            filters: [{ key: 'status', label: '全部环节', options: [{ value: 'arrived', label: '待派送' }, { value: 'delivering', label: '派送中' }, { value: 'signed', label: '已签收' }] }],
            columns: [
                { key: 'id', label: '订单号', render: function (r) { return orderLink(r.id); } },
                { key: 'customer', label: '客户（发货）' },
                { key: 'contact', label: '收件人' },
                { key: 'route', label: '目的地', render: function (r) { return U.esc(r.destination); } },
                { key: 'paymentMethod', label: '付款/代收', render: function (r) { var s = U.esc(r.paymentMethod || '现付'); if (r.paymentMethod === '到付' && Number(r.codAmount) > 0) s += ' ' + U.badge('代收 ' + U.fmt.money(r.codAmount), 'danger'); return s; } },
                { key: 'courier', label: '派送员', render: function (r) { return r.courier ? U.esc(r.courier) : '<span class="tms-muted">未派单</span>'; } },
                { key: 'status', label: '状态', render: function (r) { return r.status === 'arrived' ? U.badge('待派送', 'warn') : U.statusBadge(r.status, 'order'); } }
            ],
            actions: [
                {
                    label: '派单', className: 'tms-btn-warning', show: function (r) { return r.status === 'arrived'; },
                    onClick: function (row) {
                        U.formModal({
                            title: '派送派单 · ' + row.id, width: 520,
                            fields: [
                                { key: 'courier', label: '派送员', type: 'select', required: true, options: S.dict.couriers, value: row.courier },
                                { key: 'operator', label: '操作人', full: true, placeholder: '调度姓名' }
                            ],
                            submitText: '确认派单',
                            onSubmit: function (v) {
                                var res = S.assignDelivery(row.id, { courier: v.courier, operator: v.operator });
                                U.toast(res.ok ? ('已指派给 ' + v.courier + '，转入派送中') : res.message, res.ok ? 'success' : 'error');
                            }
                        });
                    }
                },
                {
                    label: 'POD签收', className: 'tms-btn-success', show: function (r) { return r.status === 'delivering'; },
                    onClick: function (row) {
                        var codTip = (row.paymentMethod === '到付' && Number(row.codAmount) > 0)
                            ? '<div class="tms-field" style="grid-column:1/-1"><label>本单为到付代收，签收时需向收件人收取</label><div class="tms-muted">代收货款 ' + U.fmt.money(row.codAmount) + '，另收运费 ' + U.fmt.money(row.freight) + '</div></div>' : '';
                        U.formModal({
                            title: 'POD 回单签收 · ' + row.id, width: 560,
                            fields: [
                                { key: 'receiver', label: '签收人', type: 'select', required: true, options: POD_RECEIVERS },
                                { key: 'receiverPhone', label: '签收人电话', full: true, value: row.phone },
                                { key: 'note', label: '回单备注', type: 'textarea', full: true, rows: 2, placeholder: '如：外包完好，当面验货' },
                                { key: 'photo', label: '电子回单', type: 'checkbox', checkboxLabel: '已上传签收照片/回单' }
                            ],
                            extraHtml: codTip,
                            submitText: '确认签收',
                            onSubmit: function (v) {
                                var res = S.confirmPOD(row.id, { receiver: v.receiver, receiverPhone: v.receiverPhone, note: v.note, photo: v.photo, operator: row.courier });
                                U.toast(res.ok ? ('已签收，回单已归档' + (codTip ? '，代收货款已入待上划台账' : '')) : res.message, res.ok ? 'success' : 'error');
                            }
                        });
                    }
                },
                { label: '详情', className: 'tms-btn-light', onClick: function (row) { orderDetail(row.id); } }
            ]
        }
    });

    /* ============================== 代收货款（COD）上划对账 ============================== */

    define('cod', {
        title: '代收货款',
        subtitle: '追踪到付件向收件人代收的货款：签收时形成待上划负债，上划商家后自动生成支出与服务费收入。',
        kpis: function () {
            var c = S.codSummary();
            return [
                { label: '代收货款总额', value: U.fmt.money(c.goodsTotal), color: '#667eea', sub: c.count + ' 笔代收' },
                { label: '待上划', value: U.fmt.money(c.pendingRemit), color: '#ff9800', sub: c.pendingCount + ' 笔待上划' },
                { label: '已上划商家', value: U.fmt.money(c.remittedTotal), color: '#4caf50', sub: '净额已结' },
                { label: '服务费收入', value: U.fmt.money(c.serviceIncome), color: '#2196f3', sub: '已上划部分' }
            ];
        },
        charts: function (el) {
            var c = S.codSummary();
            el.innerHTML = '<div class="tms-panel"><div class="tms-panel-head"><h3>代收货款上划状态（净额口径·已扣服务费）</h3></div><div class="tms-panel-body" id="cod-donut"></div></div>';
            U.charts.donut(el.querySelector('#cod-donut'), {
                data: [{ label: '待上划', value: c.pendingRemit, color: '#ffb74d' }, { label: '已上划', value: c.remittedTotal, color: '#4caf50' }],
                formatValue: function (v) { return U.fmt.money(v); }
            });
        },
        table: {
            entity: 'codRecords',
            searchPlaceholder: '搜索订单号/运单号/商家/收件人',
            searchFields: ['orderId', 'waybillNo', 'shipper', 'consignee', 'id'],
            defaultSort: { key: 'collectedAt', dir: 'desc' },
            pageSize: 12,
            filters: [{ key: 'remitStatus', label: '全部状态', options: [{ value: 'pending', label: '待上划' }, { value: 'remitted', label: '已上划' }] }],
            columns: [
                { key: 'id', label: '代收单号' },
                { key: 'orderId', label: '订单号', render: function (r) { return orderLink(r.orderId); } },
                { key: 'shipper', label: '商家（应收方）' },
                { key: 'consignee', label: '收件人' },
                { key: 'goodsValue', label: '代收货款', render: function (r) { return U.fmt.money(r.goodsValue); } },
                { key: 'serviceFee', label: '服务费', render: function (r) { return U.fmt.money(r.serviceFee); } },
                { key: 'netPayable', label: '应上划净额', render: function (r) { return '<span class="tms-strong">' + U.fmt.money(r.netPayable) + '</span>'; } },
                { key: 'courier', label: '派送员', render: function (r) { return U.esc(r.courier || '-'); } },
                { key: 'collectedAt', label: '代收时间', render: function (r) { return U.fmt.dateTime(r.collectedAt); } },
                { key: 'remitStatus', label: '状态', render: function (r) { return r.remitStatus === 'remitted' ? U.badge('已上划', 'success') : U.badge('待上划', 'warn'); } }
            ],
            actions: [
                {
                    label: '上划商家', className: 'tms-btn-success', show: function (r) { return r.remitStatus !== 'remitted'; },
                    onClick: function (row) {
                        S.remitCOD(row.id, '财务结算');
                        U.toast('已上划 ' + U.fmt.money(row.netPayable) + ' 给 ' + row.shipper + '，并确认服务费 ' + U.fmt.money(row.serviceFee), 'success');
                    }
                },
                { label: '查看订单', className: 'tms-btn-light', onClick: function (row) { orderDetail(row.orderId); } }
            ]
        }
    });


    /* ============================== 路由管理（多段路由） ============================== */

    function parseSegments(text) {
        var lines = String(text || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
        return lines.map(function (l, i) {
            var parts = l.split('|');
            var ft = String(parts[0] || '').split(/>|->|\u2192/);
            return {
                seq: i + 1,
                from: (ft[0] || '').trim(),
                to: (ft[1] || '').trim(),
                mode: (parts[1] || '陆运').trim(),
                stdHours: Number(parts[2]) || 0
            };
        });
    }

    function segmentsToText(segments) {
        return (segments || []).map(function (s) { return s.from + '>' + s.to + ' | ' + s.mode + ' | ' + s.stdHours; }).join('\n');
    }

    function routeForm(row, isNew) {
        U.formModal({
            title: isNew ? '新增路由' : '编辑路由 · ' + row.id, width: 640,
            values: isNew ? {} : row,
            fields: [
                { key: 'origin', label: '始发（城市或全国）', type: 'select', required: true, options: ['全国'].concat(S.dict.cities) },
                { key: 'destination', label: '目的（城市或全国）', type: 'select', required: true, options: ['全国'].concat(S.dict.cities) },
                { key: 'mode', label: '主干方式', type: 'select', required: true, options: ['陆运', '空运', '铁路'] },
                { key: 'priority', label: '优先级', type: 'select', required: true, options: ['高', '中', '低'] },
                { key: 'segments', label: '路由段（每行：起点>终点 | 方式 | 时效小时）', type: 'textarea', full: true, rows: 6, required: true }
            ],
            submitText: '保存路由',
            onSubmit: function (v) {
                var segs = parseSegments(v.segments);
                var total = segs.reduce(function (s, x) { return s + x.stdHours; }, 0);
                if (isNew) {
                    S.create('routes', { origin: v.origin, destination: v.destination, mode: v.mode, priority: v.priority, segments: segs, totalStdHours: total, status: 'active', deviationCount: 0 });
                    U.toast('路由已新增（' + segs.length + ' 段）', 'success');
                } else {
                    S.update('routes', row.id, { origin: v.origin, destination: v.destination, mode: v.mode, priority: v.priority, segments: segs, totalStdHours: total });
                    U.toast('路由已更新', 'success');
                }
            }
        });
    }

    define('route', {
        title: '路由管理',
        subtitle: '维护线路的多段路由、标准时效与优先级，为订单提供路由计划与偏差基准。',
        kpis: function () {
            var st = S.routeStats();
            return [
                { label: '路由数', value: st.total, color: '#667eea', sub: '含全国兜底' },
                { label: '平均全程时效', value: st.avgStdHours + ' 小时', color: '#2196f3' },
                { label: '偏差轨迹', value: st.deviationTraces, color: '#ff9800', sub: '路由与实际不符' },
                { label: '涉及订单', value: st.deviationOrders, color: '#ff6b6b', sub: '存在路由偏差' }
            ];
        },
        table: {
            entity: 'routes',
            searchPlaceholder: '搜索路由/线路',
            searchFields: ['id', 'origin', 'destination', 'mode'],
            defaultSort: { key: 'totalStdHours', dir: 'asc' },
            filters: [
                { key: 'mode', label: '全部方式', options: ['陆运', '空运', '铁路'] },
                { key: 'priority', label: '全部优先级', options: ['高', '中', '低'] }
            ],
            columns: [
                { key: 'id', label: '路由ID', width: '110px' },
                { key: 'lane', label: '线路', render: function (r) { return U.esc(r.origin) + ' → ' + U.esc(r.destination); } },
                { key: 'mode', label: '主干方式' },
                { key: 'priority', label: '优先级', render: function (r) { return priorityBadge(r.priority); } },
                { key: 'segments', label: '段数', render: function (r) { return (r.segments || []).length + ' 段'; } },
                { key: 'totalStdHours', label: '全程时效', render: function (r) { return r.totalStdHours + ' 小时'; } },
                { key: 'status', label: '状态', render: function (r) { return U.statusBadge(r.status, 'route'); } }
            ],
            toolbar: [{
                text: '新增路由', className: 'tms-btn tms-btn-primary', onClick: function () {
                    routeForm({ segments: [{ from: '揽收网点', to: '始发分拨', mode: '陆运', stdHours: 6 }] }, true);
                }
            }],
            actions: [
                { label: '编辑', className: 'tms-btn-light', onClick: function (row) { routeForm(row, false); } },
                {
                    label: '查看', className: 'tms-btn-light', onClick: function (row) {
                        var segHtml = (row.segments || []).map(function (s) {
                            return '<div class="tms-detail-item"><span>第' + s.seq + '段 · ' + U.esc(s.mode) + '</span><strong>' + U.esc(s.from) + ' → ' + U.esc(s.to) + ' · ' + s.stdHours + 'h</strong></div>';
                        }).join('');
                        var html = U.detailGrid([
                            { label: '线路', value: U.esc(row.origin) + ' → ' + U.esc(row.destination) },
                            { label: '主干方式', value: U.esc(row.mode) },
                            { label: '优先级', value: priorityBadge(row.priority) },
                            { label: '全程时效', value: row.totalStdHours + ' 小时' }
                        ]) + '<div class="tms-panel-head" style="padding:1rem 0 .5rem;border:0"><h3>路由段</h3></div><div class="tms-detail-grid">' + segHtml + '</div>';
                        var m = U.detailModal('路由详情 · ' + row.id, html);
                        m.el.querySelector('[data-act="close"]').addEventListener('click', m.close);
                    }
                },
                { label: '停用', className: 'tms-btn-danger', show: function (r) { return r.status === 'active'; }, onClick: function (row) { S.update('routes', row.id, { status: 'inactive' }); U.toast('路由已停用', 'success'); } },
                { label: '启用', className: 'tms-btn-success', show: function (r) { return r.status !== 'active'; }, onClick: function (row) { S.update('routes', row.id, { status: 'active' }); U.toast('路由已启用', 'success'); } }
            ]
        }
    });

    /* ============================== 轨迹中心 ============================== */

    define('tracking', {
        title: '轨迹中心',
        subtitle: '汇聚全链路轨迹流水，识别超时与路由偏差预警，支持手动补录节点。',
        kpis: function () {
            var st = S.traceOvertimeStats();
            var total = S.list('traces', { pageSize: 0 }).total;
            return [
                { label: '轨迹总量', value: total, color: '#667eea' },
                { label: '超时节点', value: st.overtime, color: '#ff9800', sub: '超标准时限' },
                { label: '偏差节点', value: st.deviant, color: '#ff6b6b', sub: '路由与实际不符' },
                { label: '升级中异常', value: st.escalated, color: '#f44336', sub: '超时自动升级' }
            ];
        },
        extraBefore: function (el) {
            function draw() {
                var list = S.list('traces', { pageSize: 0, sort: { key: 'opTime', dir: 'desc' } }).rows
                    .filter(function (t) { return t.isOvertime || t.isDeviant; }).slice(0, 8);
                var rows = list.map(function (t) {
                    return '<tr><td>' + orderLink(t.orderId) + '</td><td>' + U.esc(t.nodeName) + '</td><td>' + U.esc(t.location || '-') + '</td><td>' + U.fmt.dateTime(t.deadline) + '</td><td>' +
                        (t.isOvertime ? U.badge('超时', 'danger') : '') + ' ' + (t.isDeviant ? U.badge('偏差', 'warn') : '') + '</td></tr>';
                }).join('');
                el.innerHTML = '<div class="tms-panel"><div class="tms-panel-head"><h3>超时 / 偏差预警</h3>' +
                    '<button type="button" class="tms-btn tms-btn-warning" id="trace-scan">触发超时巡检</button></div>' +
                    '<div class="tms-table-wrap"><table class="tms-table"><thead><tr><th>订单号</th><th>节点</th><th>位置</th><th>应完成时间</th><th>标记</th></tr></thead>' +
                    '<tbody>' + (rows || '<tr><td colspan="5" class="tms-empty">当前无超时/偏差预警</td></tr>') + '</tbody></table></div></div>';
                el.querySelector('#trace-scan').addEventListener('click', function () {
                    var n = S.checkTracesOvertime(true);
                    U.toast(n ? ('巡检完成，新增标记 ' + n + ' 个超时节点') : '巡检完成，无新增超时', n ? 'success' : 'info');
                    draw();
                });
                bindOrderLinks(el);
            }
            draw();
            S.subscribe(draw);
        },
        table: {
            entity: 'traces',
            searchPlaceholder: '搜索运单号/订单号/位置',
            searchFields: ['waybillNo', 'orderId', 'location', 'customer', 'nodeName'],
            defaultSort: { key: 'opTime', dir: 'desc' },
            pageSize: 14,
            filters: [
                { key: 'status', label: '全部环节', options: orderStatusOptions() },
                { key: 'isOvertime', label: '全部标记', options: [{ value: 'true', label: '仅超时' }] }
            ],
            columns: [
                { key: 'opTime', label: '操作时间', render: function (r) { return U.fmt.dateTime(r.opTime); } },
                { key: 'orderId', label: '订单号', render: function (r) { return orderLink(r.orderId); } },
                { key: 'nodeName', label: '节点' },
                { key: 'location', label: '位置' },
                { key: 'deadline', label: '应完成', render: function (r) { return U.fmt.dateTime(r.deadline); } },
                {
                    key: 'flag', label: '标记', render: function (r) {
                        var s = '';
                        if (r.isOvertime) s += U.badge('超时', 'danger') + ' ';
                        if (r.isDeviant) s += U.badge('偏差', 'warn') + ' ';
                        return s || '<span class="tms-muted">正常</span>';
                    }
                }
            ],
            toolbar: [{
                text: '补录轨迹节点', className: 'tms-btn tms-btn-primary', onClick: function () {
                    U.formModal({
                        title: '补录轨迹节点', width: 560,
                        fields: [
                            { key: 'orderId', label: '关联订单', type: 'select', required: true, options: allOrdersOptions(), placeholder: '请选择订单', full: true },
                            { key: 'node', label: '轨迹节点', type: 'select', required: true, options: S.dict.traceNodes.map(function (n) { return { value: n.code, label: n.name + '（' + n.code + '）' }; }), placeholder: '请选择节点' },
                            { key: 'location', label: '位置', required: true, placeholder: '如 上海分拨中心' }
                        ],
                        submitText: '补录',
                        onSubmit: function (v) {
                            var order = S.get('orders', v.orderId);
                            var nodeMap = {};
                            S.dict.traceNodes.forEach(function (n) { nodeMap[n.code] = n; });
                            var node = nodeMap[v.node] || { name: v.node, stdHours: 0 };
                            var now = new Date().toISOString();
                            S.create('traces', {
                                orderId: order.id, waybillNo: order.waybillNo, customer: order.customer,
                                origin: order.origin, destination: order.destination, status: order.status,
                                node: v.node, nodeName: node.name, location: v.location, opTime: now,
                                deadline: new Date(new Date(now).getTime() + (node.stdHours || 0) * 3600000).toISOString(),
                                isOvertime: false, isDeviant: false, actor: '运营管理员'
                            });
                            U.toast('轨迹节点已补录', 'success');
                        }
                    });
                }
            }],
            actions: [
                { label: '查看订单', className: 'tms-btn-light', onClick: function (row) { orderDetail(row.orderId); } }
            ]
        }
    });

    /* ============================== 异常工单闭环 ============================== */

    function exceptionLevelBadge(level) {
        return U.badge(level || '三级', level === '一级' ? 'danger' : (level === '二级' ? 'warn' : 'muted'));
    }

    function isExceptionOverdue(e) {
        return e.status !== 'resolved' && e.slaDeadline && new Date(e.slaDeadline) < new Date();
    }

    define('workflow', {
        title: '异常工单闭环',
        subtitle: '异常上报 → 受理 → 定责扣款 → 闭环处置，联动理赔与成本应付，全程 SLA 时效监控。',
        kpis: function () {
            var list = S.list('exceptions', { pageSize: 0 }).rows;
            var pending = list.filter(function (x) { return x.status === 'pending'; }).length;
            var processing = list.filter(function (x) { return x.status === 'processing'; }).length;
            var escalated = list.filter(function (x) { return x.escalated && x.status !== 'resolved'; }).length;
            var overdue = list.filter(isExceptionOverdue).length;
            return [
                { label: '待受理', value: pending, color: '#ff9800' },
                { label: '处理中', value: processing, color: '#2196f3' },
                { label: '超时未闭环', value: overdue, color: '#ff6b6b', sub: '超过 SLA 时限' },
                { label: '升级中', value: escalated, color: '#f44336', sub: '已升级至主管' }
            ];
        },
        extraBefore: function (el) {
            function draw() {
                var top = S.list('exceptions', { pageSize: 0 }).rows
                    .filter(isExceptionOverdue)
                    .sort(function (a, b) { return new Date(a.slaDeadline) - new Date(b.slaDeadline); }).slice(0, 5);
                el.innerHTML = '<div class="tms-panel"><div class="tms-panel-head"><h3>超时未闭环 Top' + (top.length || '') + '</h3></div>' +
                    '<div class="tms-table-wrap"><table class="tms-table"><thead><tr><th>异常ID</th><th>订单</th><th>类型</th><th>级别</th><th>SLA</th><th>操作</th></tr></thead><tbody>' +
                    (top.map(function (e) {
                        return '<tr><td>' + U.esc(e.id) + '</td><td>' + orderLink(e.orderId) + '</td><td>' + U.esc(e.type) + '</td><td>' + exceptionLevelBadge(e.level) + '</td><td>' + U.fmt.dateTime(e.slaDeadline) + '</td>' +
                            '<td class="tms-actions-cell">' + (e.escalated ? U.badge('已升级', 'muted') : '<button type="button" class="tms-btn tms-btn-xs tms-btn-warning" data-esc="' + U.esc(e.id) + '">升级</button>') + '</td></tr>';
                    }).join('') || '<tr><td colspan="6" class="tms-empty">当前无超时未闭环异常</td></tr>') +
                    '</tbody></table></div></div>';
                el.querySelectorAll('[data-esc]').forEach(function (btn) {
                    btn.addEventListener('click', function () {
                        S.escalateException(this.dataset.esc);
                        U.toast('异常已升级并置为一级', 'success');
                        draw();
                    });
                });
                bindOrderLinks(el);
            }
            draw();
            S.subscribe(draw);
        },
        table: {
            entity: 'exceptions',
            searchPlaceholder: '搜索异常ID/订单号/类型',
            searchFields: ['id', 'orderId', 'waybillNo', 'type', 'handler'],
            defaultSort: { key: 'occurredAt', dir: 'desc' },
            pageSize: 12,
            filters: [
                { key: 'status', label: '全部状态', options: [{ value: 'pending', label: '待处理' }, { value: 'processing', label: '处理中' }, { value: 'resolved', label: '已解决' }] },
                { key: 'level', label: '全部级别', options: ['一级', '二级', '三级'] },
                { key: 'type', label: '全部类型', options: ['延迟送达', '货物损坏', '信息不符', '地址错误', '丢件', '拒收'] }
            ],
            columns: [
                { key: 'id', label: '异常ID', width: '130px' },
                { key: 'orderId', label: '订单号', render: function (r) { return orderLink(r.orderId); } },
                { key: 'type', label: '类型' },
                { key: 'level', label: '级别', render: function (r) { return exceptionLevelBadge(r.level); } },
                { key: 'slaDeadline', label: 'SLA', render: function (r) { return (r.slaDeadline ? U.fmt.dateTime(r.slaDeadline) : '-') + (isExceptionOverdue(r) ? ' ' + U.badge('超时', 'danger') : ''); } },
                { key: 'responsibleParty', label: '责任方', render: function (r) { return r.responsibleParty ? U.esc(r.responsibleParty) : '<span class="tms-muted">未定责</span>'; } },
                { key: 'status', label: '状态', render: function (r) { return U.statusBadge(r.status, 'exception'); } }
            ],
            toolbar: [{
                text: '登记异常', className: 'tms-btn tms-btn-primary', onClick: function () {
                    U.formModal({
                        title: '登记异常', width: 620,
                        fields: [
                            { key: 'orderId', label: '关联订单', type: 'select', required: true, options: orderOptions(), placeholder: '请选择订单', full: true },
                            { key: 'type', label: '异常类型', type: 'select', required: true, options: ['延迟送达', '货物损坏', '信息不符', '地址错误', '丢件', '拒收'], placeholder: '请选择类型' },
                            { key: 'level', label: '异常级别', type: 'select', required: true, options: ['一级', '二级', '三级'] },
                            { key: 'description', label: '异常描述', type: 'textarea', full: true, required: true, rows: 3, placeholder: '描述异常发生的时间、地点与影响' }
                        ],
                        submitText: '登记',
                        onSubmit: function (v) {
                            S.createException(v);
                            U.toast('异常已登记，等待受理', 'success');
                        }
                    });
                }
            }],
            actions: [
                {
                    label: '受理', className: 'tms-btn-warning', show: function (r) { return r.status === 'pending'; },
                    onClick: function (row) {
                        U.formModal({
                            title: '受理工单', width: 460,
                            fields: [{ key: 'handler', label: '处理人', type: 'select', required: true, options: ['运营管理员', '客服主管', '仓储主管', '运输调度'], placeholder: '请选择处理人' }],
                            submitText: '开始处理',
                            onSubmit: function (v) { S.processException(row.id, v.handler); U.toast('已受理并分派给 ' + v.handler, 'success'); }
                        });
                    }
                },
                {
                    label: '定责', className: 'tms-btn-light', show: function (r) { return r.status !== 'resolved'; },
                    onClick: function (row) {
                        U.formModal({
                            title: '异常定责', width: 520, values: row,
                            fields: [
                                { key: 'party', label: '责任方', type: 'select', required: true, options: ['承运商', '网点', '司机', '仓库', '客户'] },
                                { key: 'responsible', label: '责任人/单位', placeholder: '如 顺丰物流 / 司机张三' },
                                { key: 'deduction', label: '扣款金额(元)', type: 'number', min: 0, step: 1, value: row.deductionAmount || 0 }
                            ],
                            submitText: '确认定责',
                            onSubmit: function (v) {
                                S.assignResponsibility(row.id, { party: v.party, responsible: v.responsible, deduction: v.deduction });
                                U.toast(v.deduction > 0 && v.party !== '客户' ? '已定责并生成成本应付' : '已定责', 'success');
                            }
                        });
                    }
                },
                {
                    label: '闭环', className: 'tms-btn-success', show: function (r) { return r.status !== 'resolved'; },
                    onClick: function (row) {
                        U.formModal({
                            title: '异常闭环处置', width: 560,
                            fields: [
                                { key: 'solution', label: '处理方案', type: 'select', required: true, options: ['补发', '改派', '理赔', '退回'] },
                                { key: 'rootCause', label: '根本原因', placeholder: '如 中转环节遗漏' },
                                { key: 'resolution', label: '处理结果', type: 'textarea', full: true, required: true, rows: 3 },
                                { key: 'createClaim', label: '同时发起理赔', type: 'checkbox', checkboxLabel: '联动创建理赔单' },
                                { key: 'claimAmount', label: '理赔金额(元)', type: 'number', min: 0, step: 1 }
                            ],
                            submitText: '确认闭环',
                            onSubmit: function (v) {
                                S.closeException(row.id, { solution: v.solution, rootCause: v.rootCause, resolution: v.resolution, createClaim: v.createClaim, claimAmount: Number(v.claimAmount) || 0 });
                                U.toast('异常已闭环' + (v.createClaim ? '，理赔已发起' : ''), 'success');
                            }
                        });
                    }
                },
                {
                    label: '查看', className: 'tms-btn-light', onClick: function (row) {
                        var flowHtml = (row.flow || []).map(function (f) {
                            return '<li><span class="tms-timeline-dot"></span><div><strong>' + U.esc(f.action) + '</strong><p>' + U.fmt.dateTime(f.time) + (f.actor ? ' · ' + U.esc(f.actor) : '') + '</p></div></li>';
                        }).join('');
                        var html = U.detailGrid([
                            { label: '异常类型', value: U.esc(row.type) },
                            { label: '级别', value: exceptionLevelBadge(row.level) },
                            { label: '状态', value: U.statusBadge(row.status, 'exception') },
                            { label: '责任方', value: row.responsibleParty || '-' },
                            { label: '扣款金额', value: row.deductionAmount ? U.fmt.money(row.deductionAmount) : '-' },
                            { label: '处理方案', value: row.solution || '-' },
                            { label: '关联理赔', value: row.linkedClaimId || '-' },
                            { label: 'SLA', value: row.slaDeadline ? U.fmt.dateTime(row.slaDeadline) : '-' }
                        ]);
                        html += '<div class="tms-note" style="margin-top:1rem">异常描述：' + U.esc(row.description || '-') + '</div>';
                        if (row.resolution) html += '<div class="tms-note" style="margin-top:.6rem">处理结果：' + U.esc(row.resolution) + '</div>';
                        if (flowHtml) html += '<div class="tms-panel-head" style="padding:1rem 0 .5rem;border:0"><h3>处理留痕</h3></div><ul class="tms-timeline">' + flowHtml + '</ul>';
                        var m = U.detailModal('异常详情 · ' + row.id, html);
                        m.el.querySelector('[data-act="close"]').addEventListener('click', m.close);
                    }
                }
            ]
        }
    });

    global.TmsPages = {
        define: define,
        render: render,
        orderDetail: orderDetail,
        orderOptions: orderOptions,
        allOrdersOptions: allOrdersOptions
    };
})(window);
