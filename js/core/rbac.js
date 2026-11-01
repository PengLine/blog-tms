/* RBAC：角色 → 权限点 → 菜单/路由守卫 的单一事实来源 */
(function (global) {
    'use strict';

    var TMS = global.TMS = global.TMS || {};

    /* 权限点字典（页面与按钮都挂在这里，新增功能先登记权限） */
    var PERMISSIONS = [
        { code: 'overview:view', name: '运营总览', module: '总览' },
        { code: 'report:view', name: '经营报表', module: '总览' },
        { code: 'order:view', name: '订单查看', module: '订单' },
        { code: 'order:create', name: '订单创建/揽收', module: '订单' },
        { code: 'order:advance', name: '订单推进', module: '订单' },
        { code: 'order:change', name: '改单/拦截', module: '订单' },
        { code: 'order:audit', name: '计费复核', module: '结算' },
        { code: 'route:view', name: '路由查看', module: '订单' },
        { code: 'route:manage', name: '路由维护', module: '订单' },
        { code: 'tracking:view', name: '轨迹查看', module: '订单' },
        { code: 'tracking:fix', name: '轨迹补录', module: '订单' },
        { code: 'scan:operate', name: '扫描作业', module: '作业' },
        { code: 'sorting:operate', name: '分拣作业', module: '作业' },
        { code: 'loading:operate', name: '装卸作业', module: '作业' },
        { code: 'transport:view', name: '车次查看', module: '作业' },
        { code: 'transport:dispatch', name: '调度发车', module: '作业' },
        { code: 'delivery:operate', name: '派送作业', module: '作业' },
        { code: 'delivery:pod', name: 'POD 签收', module: '作业' },
        { code: 'cod:remit', name: '代收货款上划', module: '结算' },
        { code: 'exception:create', name: '异常上报', module: '异常' },
        { code: 'exception:handle', name: '异常受理/定责', module: '异常' },
        { code: 'exception:close', name: '异常闭环', module: '异常' },
        { code: 'service:handle', name: '客服工单处理', module: '异常' },
        { code: 'claim:approve', name: '理赔审批', module: '异常' },
        { code: 'rate:manage', name: '运价卡维护', module: '结算' },
        { code: 'finance:view', name: '财务查看', module: '结算' },
        { code: 'finance:settle', name: '收付结算', module: '结算' },
        { code: 'customer:manage', name: '客户与合同', module: '网络' },
        { code: 'network:manage', name: '网点与分拨', module: '网络' },
        { code: 'vehicle:manage', name: '车辆管理', module: '网络' },
        { code: 'warehouse:manage', name: '仓储物料', module: '网络' },
        { code: 'hr:manage', name: '人事管理', module: '组织' },
        { code: 'user:manage', name: '用户权限', module: '组织' },
        { code: 'evaluation:manage', name: '考核绩效', module: '组织' },
        { code: 'geofence:manage', name: '电子围栏', module: '系统' },
        { code: 'monitor:view', name: '系统监控', module: '系统' },
        { code: 'data:reset', name: '数据重建', module: '系统' }
    ];

    var ALL = PERMISSIONS.map(function (p) { return p.code; });

    var ROLE_PERMS = {
        admin: ['*'],
        branch: ['overview:view', 'order:view', 'order:create', 'order:advance', 'order:change', 'tracking:view',
            'scan:operate', 'loading:operate', 'exception:create', 'service:handle', 'cod:remit',
            'customer:manage', 'warehouse:manage', 'report:view', 'evaluation:manage'],
        sorter: ['overview:view', 'order:view', 'tracking:view', 'scan:operate', 'sorting:operate',
            'loading:operate', 'exception:create', 'report:view'],
        transporter: ['overview:view', 'order:view', 'tracking:view', 'scan:operate', 'loading:operate',
            'transport:view', 'exception:create', 'report:view'],
        deliveryman: ['overview:view', 'order:view', 'order:create', 'tracking:view', 'scan:operate',
            'delivery:operate', 'delivery:pod', 'cod:remit', 'exception:create', 'report:view'],
        client: ['order:view', 'order:create', 'tracking:view']
    };

    /* 运营端菜单：外壳按 role + 权限过滤渲染 */
    var ADMIN_MENU = [
        { group: '运营总览', items: [
            { id: 'overview', file: 'tms-index.html', label: '运营仪表盘', icon: '◎', perm: 'overview:view' },
            { id: 'operation', file: 'tms-operation.html', label: '经营报表', icon: '▤', perm: 'report:view' },
            { id: 'timing', file: 'tms-timing.html', label: '时效监控', icon: '◷', perm: 'report:view' },
            { id: 'monitor', file: 'tms-monitor.html', label: '系统监控', icon: '♨', perm: 'monitor:view' }
        ] },
        { group: '订单履约', items: [
            { id: 'order', file: 'tms-order.html', label: '订单管理', icon: '▦', perm: 'order:view' },
            { id: 'route', file: 'tms-route.html', label: '路由管理', icon: '⇄', perm: 'route:view' },
            { id: 'tracking', file: 'tms-tracking.html', label: '轨迹中心', icon: '◈', perm: 'tracking:view' },
            { id: 'scan', file: 'tms-scan.html', label: '扫描记录', icon: '⌕', perm: 'scan:operate' }
        ] },
        { group: '运输作业', items: [
            { id: 'sorting', file: 'tms-sorting.html', label: '分拣管理', icon: '⛁', perm: 'sorting:operate' },
            { id: 'loading', file: 'tms-loading.html', label: '装卸作业', icon: '⛃', perm: 'loading:operate' },
            { id: 'transport', file: 'tms-transport.html', label: '车次调度', icon: '⛴', perm: 'transport:view' },
            { id: 'delivery', file: 'tms-delivery.html', label: '末端派送', icon: '⛶', perm: 'delivery:operate' }
        ] },
        { group: '异常与客服', items: [
            { id: 'exception', file: 'tms-exception.html', label: '异常工单', icon: '⚠', perm: 'exception:handle' },
            { id: 'workflow', file: 'tms-workflow.html', label: '闭环看板', icon: '⟳', perm: 'exception:handle' },
            { id: 'service', file: 'tms-service.html', label: '客服工单', icon: '☏', perm: 'service:handle' },
            { id: 'claim', file: 'tms-claim.html', label: '理赔管理', icon: '¥', perm: 'claim:approve' }
        ] },
        { group: '计费结算', items: [
            { id: 'rate', file: 'tms-rate.html', label: '运价卡', icon: '≡', perm: 'rate:manage' },
            { id: 'cod', file: 'tms-cod.html', label: '代收货款', icon: '↧', perm: 'cod:remit' },
            { id: 'finance', file: 'tms-finance.html', label: '财务流水', icon: '▥', perm: 'finance:view' },
            { id: 'receivable', file: 'tms-receivable.html', label: '应收对账', icon: '↗', perm: 'finance:view' },
            { id: 'payable', file: 'tms-payable.html', label: '成本应付', icon: '↘', perm: 'finance:settle' },
            { id: 'audit', file: 'tms-audit.html', label: '计费复核', icon: '✓', perm: 'order:audit' }
        ] },
        { group: '网络与运力', items: [
            { id: 'network', file: 'tms-network.html', label: '网络规划', icon: '⊞', perm: 'network:manage' },
            { id: 'customer', file: 'tms-customer.html', label: '客户合同', icon: '☗', perm: 'customer:manage' },
            { id: 'vehicle', file: 'tms-vehicle.html', label: '车辆管理', icon: '⛟', perm: 'vehicle:manage' },
            { id: 'capacity', file: 'tms-capacity.html', label: '运力资源', icon: '⛰', perm: 'vehicle:manage' },
            { id: 'warehouse', file: 'tms-warehouse.html', label: '仓储库存', icon: '⛅', perm: 'warehouse:manage' },
            { id: 'material', file: 'tms-material.html', label: '物料管理', icon: '⛔', perm: 'warehouse:manage' },
            { id: 'geofence', file: 'tms-geofence.html', label: '电子围栏', icon: '⬡', perm: 'geofence:manage' }
        ] },
        { group: '组织与绩效', items: [
            { id: 'hr', file: 'tms-hr.html', label: '人事管理', icon: '☗', perm: 'hr:manage' },
            { id: 'user', file: 'tms-user.html', label: '用户权限', icon: '⚿', perm: 'user:manage' },
            { id: 'evaluation', file: 'tms-evaluation.html', label: '员工考核', icon: '★', perm: 'evaluation:manage' },
            { id: 'performance', file: 'tms-performance.html', label: '绩效看板', icon: '♙', perm: 'evaluation:manage' },
            { id: 'administration', file: 'tms-administration.html', label: '行政管理', icon: '⛁', perm: 'hr:manage' },
            { id: 'architecture', file: 'tms-architecture.html', label: '架构说明', icon: '⛓', perm: 'monitor:view' }
        ] }
    ];

    /* 角色端导航：移动外壳底部标签 + 更多功能列表 */
    var PORTAL_MENU = {
        branch: [
            { id: 'b-home', file: 'branch-index.html', label: '工作台', icon: '◎', tab: true },
            { id: 'b-collect', file: 'branch-collection.html', label: '揽收', icon: '↗', tab: true, perm: 'order:create' },
            { id: 'b-inbound', file: 'branch-inbound.html', label: '进港', icon: '⇩', tab: true, perm: 'scan:operate' },
            { id: 'b-outbound', file: 'branch-outbound.html', label: '出港', icon: '⇧', tab: true, perm: 'loading:operate' },
            { id: 'b-order', file: 'branch-order.html', label: '订单', icon: '▦', tab: true, perm: 'order:view' },
            { id: 'b-stock', file: 'branch-inventory.html', label: '库存', icon: '⛁', perm: 'warehouse:manage' },
            { id: 'b-sorting', file: 'branch-sorting.html', label: '分拣', icon: '⛃', perm: 'sorting:operate' },
            { id: 'b-service', file: 'branch-service.html', label: '异常客服', icon: '⚠', perm: 'exception:create' },
            { id: 'b-operation', file: 'branch-operation.html', label: '网点经营', icon: '▤', perm: 'report:view' },
            { id: 'b-system', file: 'branch-system.html', label: '网点设置', icon: '⚿', perm: 'customer:manage' }
        ],
        sorter: [
            { id: 's-home', file: 'sorter-index.html', label: '工作台', icon: '◎', tab: true },
            { id: 's-scan', file: 'sorter-scan.html', label: '扫描', icon: '⌕', tab: true, perm: 'scan:operate' },
            { id: 's-sorting', file: 'sorter-sorting.html', label: '分拣', icon: '⛁', tab: true, perm: 'sorting:operate' },
            { id: 's-schedule', file: 'sorter-schedule.html', label: '排班', icon: '◷', tab: true },
            { id: 's-clock', file: 'sorter-clock.html', label: '打卡', icon: '⏱', tab: true },
            { id: 's-performance', file: 'sorter-performance.html', label: '绩效', icon: '★', perm: 'report:view' }
        ],
        transporter: [
            { id: 't-home', file: 'transporter-index.html', label: '工作台', icon: '◎', tab: true },
            { id: 't-loading', file: 'transporter-loading.html', label: '装车', icon: '⛃', tab: true, perm: 'loading:operate' },
            { id: 't-departure', file: 'transporter-departure.html', label: '发车', icon: '⇨', tab: true, perm: 'transport:view' },
            { id: 't-route', file: 'transporter-route.html', label: '线路', icon: '⇄', tab: true },
            { id: 't-clock', file: 'transporter-clock.html', label: '打卡', icon: '⏱', tab: true },
            { id: 't-performance', file: 'transporter-performance.html', label: '绩效', icon: '★', perm: 'report:view' },
            { id: 't-schedule', file: 'transporter-schedule.html', label: '排班', icon: '◷', perm: 'transport:view' }
        ],
        deliveryman: [
            { id: 'd-home', file: 'deliveryman-index.html', label: '工作台', icon: '◎', tab: true },
            { id: 'd-tasks', file: 'deliveryman-tasks.html', label: '派送', icon: '▦', tab: true, perm: 'delivery:operate' },
            { id: 'd-collection', file: 'deliveryman-collection.html', label: '揽收', icon: '↗', tab: true, perm: 'order:create' },
            { id: 'd-exception', file: 'deliveryman-exception.html', label: '异常', icon: '⚠', tab: true, perm: 'exception:create' },
            { id: 'd-clock', file: 'deliveryman-clock.html', label: '打卡', icon: '⏱', tab: true },
            { id: 'd-performance', file: 'deliveryman-performance.html', label: '绩效', icon: '★', perm: 'report:view' },
            { id: 'd-areas', file: 'deliveryman-areas.html', label: '责任区域', icon: '⬡' },
            { id: 'd-contacts', file: 'deliveryman-contacts.html', label: '客户通讯录', icon: '☏' }
        ],
        client: [
            { id: 'c-home', file: 'client-index.html', label: '首页', icon: '◎', tab: true },
            { id: 'c-send', file: 'client-send.html', label: '寄件', icon: '✈', tab: true, perm: 'order:create' },
            { id: 'c-order', file: 'client-order.html', label: '订单', icon: '▦', tab: true, perm: 'order:view' },
            { id: 'c-tracking', file: 'client-tracking.html', label: '跟踪', icon: '◈', tab: true, perm: 'tracking:view' },
            { id: 'c-branch', file: 'client-branch.html', label: '网点', icon: '⌖' },
            { id: 'c-profile', file: 'client-profile.html', label: '我的', icon: '☗', tab: true },
            { id: 'c-points', file: 'client-points.html', label: '积分', icon: '★' }
        ]
    };

    function permissionsFor(roleKey) {
        if (roleKey === 'admin') return ['*'];
        return (ROLE_PERMS[roleKey] || []).slice();
    }

    function modules() {
        var out = {};
        PERMISSIONS.forEach(function (p) { (out[p.module] = out[p.module] || []).push(p); });
        return out;
    }

    function adminMenu(session) {
        var roleKey = session ? session.role : 'admin';
        var perms = permissionsFor(roleKey);
        var result = [];
        ADMIN_MENU.forEach(function (g) {
            var items = g.items.filter(function (it) {
                return perms.indexOf('*') > -1 || perms.indexOf(it.perm) > -1;
            });
            if (items.length) result.push({ group: g.group, items: items });
        });
        return result;
    }

    function portalMenu(roleKey) {
        return (PORTAL_MENU[roleKey] || []).slice();
    }

    function findMenu(roleKey, pageId) {
        var list = roleKey === 'admin' ? ADMIN_MENU.reduce(function (a, g) { return a.concat(g.items); }, []) : portalMenu(roleKey);
        for (var i = 0; i < list.length; i++) if (list[i].id === pageId) return list[i];
        return null;
    }

    /* 路由守卫：文件与角色不匹配时回退到该角色首页 */
    function guard(roleKey, file) {
        var home = roleKey === 'admin' ? 'tms-index.html' : ((portalMenu(roleKey)[0] || {}).file || 'index.html');
        var list = roleKey === 'admin' ? ADMIN_MENU.reduce(function (a, g) { return a.concat(g.items); }, []) : portalMenu(roleKey);
        if (!list.length) return { ok: false, redirect: 'index.html' };
        for (var i = 0; i < list.length; i++) {
            if (list[i].file === file) {
                var perm = list[i].perm;
                if (perm && !TMS.auth.can(perm)) return { ok: false, redirect: home };
                return { ok: true, item: list[i] };
            }
        }
        return { ok: false, redirect: home };
    }

    TMS.rbac = {
        PERMISSIONS: PERMISSIONS,
        ROLE_PERMS: ROLE_PERMS,
        ADMIN_MENU: ADMIN_MENU,
        PORTAL_MENU: PORTAL_MENU,
        permissionsFor: permissionsFor,
        modules: modules,
        adminMenu: adminMenu,
        portalMenu: portalMenu,
        findMenu: findMenu,
        guard: guard
    };
})(window);
