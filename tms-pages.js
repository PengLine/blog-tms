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
        var html = U.detailGrid([
            { label: '订单号', value: U.esc(order.id) },
            { label: '运单号', value: U.esc(order.waybillNo) },
            { label: '客户', value: U.esc(order.customer) },
            { label: '货物', value: U.esc(order.goods) },
            { label: '重量', value: U.esc(order.weight) + ' kg' },
            { label: '件数', value: U.esc(order.pieces) + ' 件' },
            { label: '运费', value: U.fmt.money(order.freight) },
            { label: '状态', value: U.statusBadge(order.status, 'order') },
            { label: '始发地', value: U.esc(order.origin) },
            { label: '目的地', value: U.esc(order.destination) },
            { label: '下单时间', value: U.fmt.dateTime(order.createdAt) },
            { label: '预计送达', value: U.fmt.dateTime(order.expectedAt) }
        ]);
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
        U.table(page.querySelector('#tms-table-panel'), cfg.table);
        if (cfg.extraAfter) cfg.extraAfter(page.querySelector('#tms-extra-after'));
        bindOrderLinks(page);

        S.subscribe(function () {
            refreshSummary();
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

    global.TmsPages = {
        define: define,
        render: render,
        orderDetail: orderDetail,
        orderOptions: orderOptions,
        allOrdersOptions: allOrdersOptions
    };
})(window);
