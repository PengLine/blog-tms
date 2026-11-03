/* 页面注册器：路由注册表 + 列表管线 + 订单共用视图
   六十多个页面真正重复的不是内容而是骨架：菜单要点得开、列表要筛选排序分页、
   订单要看进度和轨迹。这些收在一处，页面只声明「列定义 + 过滤谓词 + 动作」。
   注册表同时被外壳（取页面定义）与冒烟脚本（查菜单是否漏注册）读取，是菜单与页面的对账入口 */
(function (global) {
    'use strict';

    var TMS = global.TMS = global.TMS || {};
    var util = TMS.util, ui = TMS.ui, cfg = TMS.cfg, db = TMS.db;
    var esc = util.esc, fmt = util.fmt;

    var defs = {};

    /* ---------- 注册表 ---------- */

    /* 菜单里的 file 是页面归属的唯一来源：注册时反查补齐，
       避免同一个页面在 rbac 和页面定义里写两个文件名而漂移 */
    var MENU_FILE = {};
    var MENU_PERM = {};
    var MENU_LABEL = {};
    /* 两种菜单形状都要吃：运营端是 {group,items} 分组，角色端是平铺的条目数组 */
    function collectMenu(list) {
        (list || []).forEach(function (g) {
            var items = g.items || [g];
            items.forEach(function (it) {
                if (!it || !it.id) return;
                if (!MENU_FILE[it.id]) MENU_FILE[it.id] = it.file;
                if (it.perm) MENU_PERM[it.id] = it.perm;
                if (it.label && !MENU_LABEL[it.id]) MENU_LABEL[it.id] = it.label;
            });
        });
    }
    collectMenu(TMS.rbac.ADMIN_MENU);
    Object.keys(TMS.rbac.PORTAL_MENU).forEach(function (role) {
        collectMenu(TMS.rbac.PORTAL_MENU[role]);
    });

    /* define(id, def)
       def = { file, title, sub, perm, icon, load(ctx), render(ctx, data), actions, afterRender, bare, live }
       - file：所属 HTML；菜单项自动反查，子页（如 order-detail）必须显式登记
       - perm：同理由菜单项反查补齐，页面不必重复声明，避免「菜单能看见但页面不校验权限」
       - load/render：load 只取数，render 只拼 HTML，异常由外壳兜住并渲染成错误卡
       - actions：页内动作表，与外壳动作合并后交给 ui 委托
       - bare：不套外壳 chrome（登录页、纯文档页）；live:false 关闭数据变更自动刷新 */
    function define(id, def) {
        var d = def || {};
        d.id = id;
        d.file = d.file || MENU_FILE[id] || '';
        d.perm = d.perm || MENU_PERM[id] || '';
        d.title = d.title || MENU_LABEL[id] || id;
        if (!d.render) {
            d.render = function () {
                return ui.empty('页面「' + id + '」尚未实现内容', '请在 js/pages/ 下补全 render');
            };
        }
        defs[id] = d;
        return d;
    }

    function get(id) { return defs[id] || null; }
    function all() { return Object.keys(defs).map(function (k) { return defs[k]; }); }

    function menuIds(role) {
        var list = role === 'admin'
            ? TMS.rbac.ADMIN_MENU.reduce(function (a, g) { return a.concat(g.items); }, [])
            : TMS.rbac.portalMenu(role);
        return list.map(function (it) { return it.id; });
    }

    /* 该角色已经能真正打开的页面（菜单 ∩ 已注册） */
    function byRole(role) {
        return menuIds(role).filter(function (id) { return !!defs[id]; }).map(function (id) { return defs[id]; });
    }

    /* 菜单里点了没有页面的 id —— 冒烟脚本用它保证「菜单点得开」 */
    function unregistered(role) {
        return menuIds(role).filter(function (id) { return !defs[id]; });
    }

    /* 各角色收到单号后应该落在哪个页面：运营端查订单、网点查本网点单据、
       分拣员回扫描台、司机回发车页、派送员回任务列表、客户看自己的订单 */
    var ORDER_LANDING = {
        admin: 'order', branch: 'b-order', sorter: 's-scan',
        transporter: 't-departure', deliveryman: 'd-tasks', client: 'c-order'
    };

    function orderPageFor(role) {
        var id = ORDER_LANDING[role];
        return id && defs[id] ? id : (cfg.roles[role] ? cfg.roles[role].home : 'overview');
    }

    /* ---------- 列表管线 ---------- */

    function filtersOf(state) {
        if (!state.filters) state.filters = {};
        return state.filters;
    }

    /* 排序值由页面提供：金额、关联客户名、倒计时这些都不是行上的原始字段 */
    function sortRows(rows, state, valueOf) {
        var key = state.sort;
        if (!key || !rows.length) return rows;
        var dir = state.dir === 'asc' ? 1 : -1;
        var get = valueOf || function (row, k) { return row[k]; };
        return rows.slice().sort(function (a, b) {
            var x = get(a, key), y = get(b, key);
            if (x == null) x = '';
            if (y == null) y = '';
            if (typeof x === 'number' && typeof y === 'number') return x === y ? 0 : (x > y ? dir : -dir);
            /* ISO 时间串按字典序即时间序，无需 new Date；中文按 locale 比较更贴近肉眼预期 */
            x = String(x); y = String(y);
            if (x === y) return 0;
            return (x > y ? 1 : -1) * dir;
        });
    }

    /* 页码越界要收回：筛选后行数变少，留在第 5 页会渲染出空表 */
    function paginate(rows, state, pageSize) {
        var size = Number(state.pageSize) || Number(pageSize) || cfg.pageSize;
        var pages = Math.max(1, Math.ceil(rows.length / size));
        state.pageSize = size;
        state.total = rows.length;
        state.pages = pages;
        state.page = Math.min(Math.max(1, Number(state.page) || 1), pages);
        return rows.slice((state.page - 1) * size, state.page * size);
    }

    function markSort(columns, state) {
        return (columns || []).map(function (c) {
            if (!c.key || c.key !== state.sort) return c;
            var copy = {};
            Object.keys(c).forEach(function (k) { copy[k] = c[k]; });
            copy.sorted = true;
            copy.dir = state.dir === 'asc' ? 'asc' : 'desc';
            return copy;
        });
    }

    /* 移动端与窄屏把同一份列定义降级成卡片，避免出现横向滚动的大表 */
    function isCompact() {
        var layout = TMS.shell && TMS.shell.state ? TMS.shell.state.chromeLayout : '';
        if (layout === 'mobile') return true;
        return (global.innerWidth || 1280) < 860;
    }

    /* 每个列表都要有自己的状态：一页放两张表（网点「揽收」页的待揽收 + 今日已揽）时，
       共用一份 state 的后果是在上面搜索框打字会把下面那张不相干的表一起筛没，
       翻页也会互相拽着走。键取页面 + 卡片标题，同名标题必须显式给 stateKey */
    function stateKeyOf(o) {
        if (o.stateKey) return o.stateKey;
        var page = (TMS.shell && TMS.shell.state && TMS.shell.state.pageId) || 'page';
        return page + ':' + (o.title || 'grid');
    }

    /* 列表本身就带搜索能力（o.search）却没给筛选字段时，搜索框也得露面：
       只有表格没有输入口的列表，用户只会认为「这页不能查」 */
    function fieldsOf(o) {
        var fields = (o.fields || []).slice();
        var hasSearch = fields.some(function (f) { return f.type === 'search' || f.key === 'q'; });
        if (!hasSearch && o.search) {
            fields.unshift({ key: 'q', type: 'search', label: o.searchLabel || '关键字', placeholder: o.searchLabel || '输入关键字筛选' });
        }
        return fields;
    }

    /* grid({ rows, columns, state, stateKey, keyName, onRow, filter, search, searchKey, valueOf,
             fields, chips, chipsName, tools, title, sub, unit, sizeOptions, pageSize, dense, zebra, emptyText, emptySub })
       —— 列表页的全部管线：筛选 → 搜索 → 排序 → 分页 → 表格/卡片 → 分页条
       控件永远排在列表之上，分页条永远在列表之下 */
    function grid(o) {
        var key = stateKeyOf(o);
        var state = ui.useState(key, o.state);
        var fs = filtersOf(state);
        var rows = o.rows || [];
        if (o.filter) rows = rows.filter(function (r) { return o.filter(r, fs, state); });
        var q = String(fs[o.searchKey || 'q'] || '').trim().toLowerCase();
        if (q) {
            var hay = o.search || function (r) { return [r.id, r.waybillNo, r.customer, r.goods].join(' '); };
            rows = rows.filter(function (r) { return String(hay(r) || '').toLowerCase().indexOf(q) > -1; });
        }
        rows = sortRows(rows, state, o.valueOf);
        var view = paginate(rows, state, o.pageSize);
        state.rows = view;
        var cols = markSort(o.columns, state);
        var body = isCompact()
            ? ui.cards({
                columns: cols, rows: view, onRow: o.onRow, keyName: o.keyName,
                badge: o.badge, actions: o.actions,
                emptyText: o.emptyText || '没有符合条件的数据', emptySub: o.emptySub
            })
            : ui.table({
                columns: cols, rows: view, onRow: o.onRow, keyName: o.keyName,
                dense: o.dense, zebra: o.zebra === false ? false : true,
                emptyText: o.emptyText || '没有符合条件的数据', emptySub: o.emptySub
            });
        var fields = fieldsOf(o);
        var head = fields.length ? ui.filters(fields, fs, { actions: o.tools })
            : (o.tools ? '<div class="tms-row" style="justify-content:flex-end;margin-bottom:10px">' + ui.out(o.tools) + '</div>' : '');
        var chips = o.chips ? '<div class="tms-chips">' +
            ui.chips(o.chips, { name: o.chipsName, value: fs[o.chipsName || ''] }) + '</div>' : '';
        var foot = (state.total > state.pageSize || state.page > 1)
            ? ui.pager(state, { unit: o.unit, sizeOptions: o.sizeOptions, label: '共' }) : '';
        var inner = '<div class="tms-grid" data-sk="' + esc(key) + '">' + head + chips + body + foot + '</div>';
        return o.title ? ui.card({ title: o.title, sub: o.sub, flat: true, body: inner }) : inner;
    }

    /* 状态标签行：列表页最常用的「全部 + 各状态」快捷筛选 */
    function statusChips(rows, name) {
        var counts = util.countBy(rows, 'status');
        var list = [{ label: '全部', value: '', count: rows.length }];
        cfg.orderFlow.forEach(function (s) {
            if (counts[s]) list.push({ label: cfg.orderLabels[s], value: s, count: counts[s] });
        });
        ['problem', 'returned', 'cancelled'].forEach(function (s) {
            if (counts[s]) list.push({ label: cfg.orderLabels[s], value: s, count: counts[s] });
        });
        return { chips: list, chipsName: name || 'status' };
    }

    /* ---------- 角色数据可见范围 ---------- */

    /* 角色端过滤口径统一在这里：网点看进出港、分拣看本场分拨、
       司机看挂到自己身上的车次、派送员看派给自己的单、客户只看自己下的单。
       口径散在各页面里迟早出现「司机看到别人的趟」这类越权观感 */
    function orderScope(session) {
        var role = session.role, org = session.orgId, person = session.personId;
        if (role === 'admin') return function () { return true; };
        if (role === 'branch') {
            return function (o) { return !!org && (o.originBranchId === org || o.destBranchId === org); };
        }
        if (role === 'sorter') {
            return function (o) { return !!org && (o.hubFrom === org || o.hubTo === org); };
        }
        if (role === 'client') {
            var cid = session.customerId || org;
            return function (o) { return !!cid && o.customerId === cid; };
        }
        var trips = {};
        if (role === 'transporter') {
            if (person) {
                db.col('transports').forEach(function (t) { if (t.driverId === person) trips[t.id] = true; });
            }
            return function (o) { return !!o.tripId && !!trips[o.tripId]; };
        }
        if (role === 'deliveryman') {
            return function (o) { return !!person && o.courierId === person; };
        }
        return function () { return true; };
    }

    function scopedOrders(session) {
        var fn = orderScope(session);
        return db.col('orders').filter(fn).map(TMS.order.view);
    }

    /* ---------- 订单共用视图 ---------- */

    var FLOW = cfg.orderFlow;

    /* 各环节标准工时累计：用来把总承诺切成逐环节的参照线 */
    var STAGE_CUM = (function () {
        var acc = 0;
        return FLOW.map(function (s) { acc += cfg.nodeOf(cfg.stageNode[s]).stdHours || 1; return acc; });
    })();
    var STAGE_TOTAL_STD = STAGE_CUM[STAGE_CUM.length - 1] || 1;

    /* 系统没有逐环节承诺落库，「揽收压了 20 小时」这类判断需要参照线：
       按标准工时占比切分总承诺，是最不撒谎的近似 */
    function stageDueAt(order, i, slaHours) {
        return util.iso(util.addHours(order.createdAt, Math.round(STAGE_CUM[i] / STAGE_TOTAL_STD * slaHours)));
    }

    function statusSteps(order) {
        var times = TMS.order.stageTimes(order);
        var sla = Math.max(4, util.hoursBetween(order.createdAt, TMS.order.promiseOf(order)));
        var closed = TMS.order.isTerminal(order);
        var firstPending = -1;
        for (var i = 0; i < FLOW.length; i++) {
            if (!times[FLOW[i]]) { firstPending = i; break; }
        }
        var nowMs = util.now().getTime();
        return ui.steps(FLOW.map(function (stage, idx) {
            var at = times[stage];
            var dueMs = util.toDate(stageDueAt(order, idx, sla)).getTime();
            var state, time;
            if (at) {
                state = util.toDate(at).getTime() > dueMs ? 'late' : 'done';
                time = fmt.dateTime(at);
            } else if (idx === firstPending && !closed) {
                state = nowMs > dueMs ? 'late' : 'current';
                time = '<span class="tms-dim">' + (nowMs > dueMs ? '应 ' : '约 ') + fmt.dateTime(new Date(dueMs)) + '</span>';
            } else {
                state = 'todo';
                time = '<span class="tms-dim">预计 ' + fmt.dateTime(new Date(dueMs)) + '</span>';
            }
            return { label: cfg.orderLabels[stage], time: time, state: state };
        }));
    }

    /* 轨迹时间轴：扫描流水只存事实，名称/设备/超时判定全由 order.traceView 派生 */
    function traceTimeline(orderId) {
        var rows = TMS.order.traces(orderId);
        if (!rows.length) return ui.empty('暂无作业轨迹', '揽收、入库、分拣、干线、派送各环节扫描都会在此留痕');
        return ui.timeline(rows.map(function (t) {
            var bad = t.result && t.result !== 'ok';
            var meta = [];
            if (t.weight != null) meta.push('重量 ' + fmt.kg(t.weight));
            meta.push('终端 ' + esc(t.device || '—'));
            meta.push('操作 ' + esc(t.operator || '系统'));
            if (t.remark) meta.push(esc(t.remark));
            return {
                title: esc(t.nodeName) + '<span class="tms-dim"> · ' + esc(t.location || '—') + '</span>',
                time: fmt.dateTime(t.opTime) + (t.isOvertime ? ' <span class="tms-badge tone-warn">超时</span>' : ''),
                badge: bad ? ui.badge(esc(t.result), 'danger') : '',
                body: meta.join('<span class="tms-dim"> · </span>'),
                tone: bad ? 'err' : t.isOvertime ? 'warn' : 'ok'
            };
        }));
    }

    function orderInfo(order) {
        var v = TMS.order.view(order);
        var trip = TMS.order.tripOf(order);
        return ui.desc([
            { label: '运单号', value: '<span class="tms-mono">' + esc(order.waybillNo) + '</span>' },
            { label: '订单号', value: ui.idCell(order.id, 'order:open') },
            { label: '状态', value: ui.statusBadge(order.status) + (order.orderType === 'reverse' ? ' ' + ui.badge('退件', 'muted') : '') },
            { label: '客户', value: esc(v.customer) + (v.customerLevel ? ' ' + ui.badge(v.customerLevel, 'info') : '') },
            { label: '结算', value: esc(v.settleCycle) + ' · ' + esc(order.paymentMethod || '') + (order.receivableStatus ? ' ' + statusBadge(order.receivableStatus) : '') },
            { label: '服务/优先级', value: esc(order.service) + ' · ' + esc(v.priority) },
            { label: '线路', value: esc(order.origin) + ' → ' + esc(order.destination) + '（' + fmt.km(order.distanceKm) + '）' },
            { label: '寄/收', value: esc(v.originBranch) + ' 揽收 · ' + esc(v.destBranch) + ' 派送' },
            { label: '货物', value: esc(order.goods) + ' ' + fmt.number(order.pieces) + ' 件 · ' + fmt.kg(order.weight) + '（计费 ' + fmt.kg(order.chargeableWeight) + '）' },
            { label: '收件人', value: esc(order.receiverName) + ' ' + esc(order.receiverPhone || '') },
            { label: '收货地址', value: esc(order.receiverAddress || '') },
            { label: '时效', value: '承诺 ' + fmt.dateTime(TMS.order.promiseOf(order)) + '（标准 ' + fmt.duration(v.stdHours) + '）' },
            { label: '签收', value: order.signedAt ? fmt.dateTime(order.signedAt) + (TMS.order.isSignedLate(order) ? ' ' + ui.badge('超时签收', 'warn') : ' ' + ui.badge('准时', 'success')) : '<span class="tms-dim">未签收</span>' },
            { label: '执行', value: (v.driverName || v.plateNo ? '司机 ' + esc(v.driverName || '—') + ' · ' + esc(v.plateNo || '—') : '<span class="tms-dim">未挂车</span>') +
                ' / 派送 ' + esc(order.courier || '未指派') + (trip ? ' / 车次 ' + esc(TMS.operation.labelOf(trip)) : '') },
            { label: '备注', value: order.remark ? esc(order.remark) : '<span class="tms-dim">—</span>' }
        ]);
    }

    function orderFeePanel(order) {
        var rows = TMS.pricing.feeRows(order);
        if (!rows.length) return ui.empty('暂无费用明细', '该单尚未计费');
        var total = Number(order.freight) || 0;
        return ui.split('2', [
            ui.card({
                title: '应收费用', sub: '运价卡 + 增值项逐条拆解', flat: true,
                body: ui.list(rows.map(function (r) {
                    return { title: esc(r.label), right: '<span class="tms-money">' + fmt.money(r.value) + '</span>' };
                }))
            }),
            ui.card({
                title: '计费口径', sub: '抛比与折扣按客户档案派生', flat: true,
                body: ui.stack([
                    ui.kv('计费重', fmt.kg(order.chargeableWeight)),
                    ui.kv('实重 / 体积重', fmt.kg(order.weight) + ' / ' + fmt.kg(util.round(TMS.order.volumeOf(order) / cfg.billing.defaultThrowRatio, 2))),
                    ui.kv('报价合计', '<span class="tms-money strong">' + fmt.money(total) + '</span>', { total: true }),
                    order.codAmount ? ui.kv('代收货款', fmt.money(order.codAmount) + '（服务费率 ' + fmt.percent(cfg.billing.codServiceRate * 100) + '）') : ''
                ])
            })
        ]);
    }

    function orderCostPanel(order) {
        var c = TMS.pricing.costRows(order);
        if (!c.total && !c.revenue) return ui.empty('暂无成本数据', '重建演示数据后由成本中心按车次与单价折算');
        return ui.stack([
            ui.kpis([
                { label: '收入', value: fmt.money(c.revenue), tone: 'info' },
                { label: '全成本', value: fmt.money(c.total), tone: 'warn', sub: '干线 ' + fmt.money(c.linehaul) + ' / 操作 ' + fmt.money(c.operation) },
                { label: '毛利', value: fmt.money(c.profit), tone: c.profit >= 0 ? 'success' : 'danger' },
                { label: '毛利率', value: fmt.percent(c.margin), tone: c.margin >= 20 ? 'success' : c.margin >= 8 ? 'warn' : 'danger' }
            ]),
            ui.card({
                title: '成本构成', sub: '干线口径 ' + esc(c.linehaulBasis) + '（干线里程 ' + fmt.km(c.trunkKm) + '，中转 ' + c.hubPasses + ' 次）',
                flat: true,
                body: TMS.charts.donut({
                    data: c.items.map(function (r) { return { label: r.label, value: r.value }; }),
                    inner: true, legend: true
                })
            })
        ], 'sm');
    }

    function orderPlanPanel(order, plan) {
        if (!plan || !plan.segments) return ui.empty('暂无路由计划');
        return ui.stack([
            ui.desc([
                { label: '路由', value: ui.idCell(plan.routeId || '', '') + ' · ' + esc(plan.serviceName || order.service) },
                { label: '运输方式', value: ui.badge(esc(plan.mode || '陆运'), plan.mode === '陆运' ? 'info' : 'brand') },
                { label: '总里程 / 标准时长', value: fmt.km(plan.distanceKm) + ' · ' + fmt.duration(plan.stdHours) },
                { label: '承诺时效', value: fmt.duration(plan.slaHours) + '（含分拣与派送冗余）' }
            ], { inline: true }),
            ui.table({
                dense: true, keyName: 'seq',
                columns: [
                    { key: 'seq', label: '段次', width: '58px', render: function (s) { return ui.rank(s.seq); } },
                    { key: 'legType', label: '环节', render: function (s) { return ui.badge(LEG_TYPE[s.legType] || s.legType, s.legType === 'trunk' ? 'brand' : 'muted'); } },
                    { key: 'from', label: '起点' },
                    { key: 'to', label: '终点' },
                    { key: 'mode', label: '方式' },
                    { key: 'km', label: '里程', align: 'right', render: function (s) { return fmt.km(s.km); } },
                    { key: 'stdHours', label: '标准时长', align: 'right', render: function (s) { return fmt.duration(s.stdHours); } }
                ],
                rows: plan.segments
            })
        ]);
    }

    var LEG_TYPE = { collect: '揽收支线', trunk: '干线', deliver: '派送支线', feeder: '区域支线' };

    function orderWorkPanel(detail) {
        return ui.stack([
            ui.card({
                title: '货物子单', sub: (detail.packages || []).length + ' 件', flat: true,
                body: ui.table({
                    dense: true, keyName: 'no', emptyText: '该单未拆子件',
                    columns: [
                        { key: 'no', label: '子单号', render: function (p) { return '<span class="tms-mono">' + esc(p.no) + '</span>'; } },
                        { key: 'weight', label: '重量', align: 'right', render: function (p) { return fmt.kg(p.weight); } },
                        { key: 'status', label: '状态', render: function (p) { return ui.statusBadge(p.status, cfg.orderLabels[p.status] || p.status); } }
                    ],
                    rows: detail.packages
                })
            }),
            ui.card({
                title: '作业单据', sub: '分拣 / 装卸 / 车次', flat: true,
                body: orderTaskList(detail.tasks)
            })
        ]);
    }

    /* 作业单只存 ID：分拣口、装卸班次、车次执行方都在这里即时反查，
       tasksOfOrder 返回的是原始行，直接渲染会露出 hubFrom/vehicleId 这类内部编码 */
    function hubName(id) {
        var h = id ? TMS.master.hubByNameOrId(id) : null;
        return h ? h.name : (id || '—');
    }

    /* 状态中文字典：订单主状态走 cfg.orderLabels，车次与各类单据的英文键在这里补齐。
       每张单据页面各自抄一遍映射，迟早抄出第五种「processing」 */
    var TRIP_TEXT = {
        pending: '待发车', loading: '装车中', departed: '在途', arrived: '已到达',
        completed: '已完成', cancelled: '已取消', done: '已完成'
    };
    var DOC_TEXT = {
        pending: '待处理', processing: '处理中', resolved: '已闭环', closed: '已关闭', escalated: '已升级',
        unpaid: '未收', overdue: '逾期', partial: '部分核销', settled: '已结算', paid: '已收', void: '已作废',
        remitted: '已上划', draft: '草稿', confirmed: '已确认', approved: '已审', rejected: '已驳回',
        submitted: '已提交', pending_review: '待复核', done: '已完成', active: '在职', inactive: '离职',
        online: '在线', offline: '离线', idle: '待命', fault: '故障', maintenance: '维保中',
        normal: '正常', low: '低于安全库存', out: '缺货', expired: '已过期', leased: '租赁', scrapped: '报废',
        suspended: '已停用', on_leave: '休假中', resigned: '已离职'
    };

    function statusText(status, dict) {
        return cfg.orderLabels[status] || (dict || DOC_TEXT)[status] || String(status == null ? '—' : status);
    }

    function statusBadge(status, dict) {
        return ui.statusBadge(status, statusText(status, dict));
    }

    function orderTaskList(tasks) {
        var t = tasks || { sorting: [], loading: [], transport: [] };
        var items = [];
        (t.sorting || []).forEach(function (x) {
            items.push({
                title: '分拣 ' + esc(x.line || '') + ' 线 / ' + esc(x.chute || '待分配') + ' 口',
                sub: esc(hubName(x.hubId)) + ' · ' + fmt.number(x.pieces || 1) + ' 件 ' + fmt.kg(x.weight || 0) +
                    ' · 标准 ' + (x.stdMinutes || 0) + ' 分钟' + (x.actualMinutes ? ' / 实际 ' + x.actualMinutes + ' 分钟' : ''),
                right: ui.badge(x.status === 'done' ? '已完成' : '进行中', x.status === 'done' ? 'success' : 'info') +
                    (x.operator ? '<div class="tms-dim">' + esc(x.operator) + '</div>' : '')
            });
        });
        (t.loading || []).forEach(function (x) {
            items.push({
                title: '装卸 ' + esc(x.containerNo || x.id),
                sub: esc(hubName(x.hubId)) + ' · 车次 ' + esc(x.tripCode || '') + ' · ' + fmt.number(x.pieces || 0) + ' 件 ' + fmt.kg(x.weight || 0) +
                    (x.actualMinutes ? ' · 实际 ' + x.actualMinutes + ' 分钟' : ''),
                right: ui.badge(x.status === 'done' ? '已装车' : '待装车', x.status === 'done' ? 'success' : 'info')
            });
        });
        (t.transport || []).forEach(function (x) {
            var tr = TMS.operation.tripView(x);
            items.push({
                title: '车次 ' + esc(tr.code), act: 'transport:open', arg: tr.id,
                sub: esc(hubName(tr.fromHub)) + ' → ' + esc(hubName(tr.toHub)) + ' · ' + esc(tr.plate || '外协') +
                    ' · 司机 ' + esc(tr.driver || '—') + ' · 发车 ' + esc(tr.departedAt || tr.date || '') +
                    ' · ' + fmt.km(tr.distanceKm) + '（装载 ' + fmt.kg(tr.weight || 0) + '）',
                right: statusBadge(tr.status, TRIP_TEXT) +
                    (tr.costPerKg ? '<div class="tms-dim">' + fmt.money(tr.costPerKg) + ' 元/kg</div>' : '')
            });
        });
        return items.length ? ui.list(items) : ui.empty('暂无关联作业单', '货物进入分拣台与装车口后会自动生成');
    }

    function orderDocPanel(detail) {
        var order = detail.order;
        var cod = Number(order.codAmount) > 0 ? db.findOne('codRecords', function (r) { return r.orderId === order.id; }) : null;
        var r = detail.receivable;
        return ui.stack([
            ui.card({
                title: '异常工单', sub: (detail.exception || []).length + ' 张', flat: true,
                body: (detail.exception || []).length ? ui.list(detail.exception.map(function (e) {
                    return {
                        title: esc(e.type) + ' ' + statusBadge(e.status),
                        sub: esc(e.description || '') + ' · 上报 ' + fmt.dateTime(e.reportedAt) + ' · ' + esc(e.source || '') +
                            ' · 受理 ' + esc(e.handler || '待分配') + (e.responsible ? ' · 责任 ' + esc(e.responsible) : ''),
                        right: TMS.service.isOverdue(e) ? ui.badge('超SLA', 'danger') :
                            (e.deductionAmount ? '<div class="tms-dim">扣款 ' + fmt.money(e.deductionAmount) + '</div>' : '')
                    };
                })) : ui.empty('本单无异常')
            }),
            ui.card({
                title: '资金单据', sub: '应收账期 / 代收货款 / 签收凭证', flat: true,
                body: ui.stack([
                    r ? ui.desc([
                        { label: '应收单号', value: ui.idCell(r.id, '') },
                        { label: '应收金额', value: '<span class="tms-money">' + fmt.money(r.amount) + '</span>' },
                        { label: '状态', value: statusBadge(r.status) + (r.paidAt ? ' 核销于 ' + fmt.date(r.paidAt) : ' 账期至 ' + fmt.date(r.dueDate)) },
                        r.billId ? { label: '对账单', value: ui.idCell(r.billId, '') + (r.invoiceNo ? ' · 发票 ' + esc(r.invoiceNo) : '') } : ''
                    ], { inline: true }) : ui.notice('本单现付，不产生应收账期', 'info'),
                    cod ? ui.desc([
                        { label: '代收货款', value: fmt.money(cod.goodsValue) + '（服务费 ' + fmt.money(cod.serviceFee) + '，应付客户 ' + fmt.money(cod.netPayable) + '）' },
                        { label: '代收人', value: esc(cod.courier || '—') + ' · 收款 ' + fmt.dateTime(cod.collectedAt) },
                        { label: '上划', value: statusBadge(cod.remitStatus) + (cod.remittedAt ? ' · ' + fmt.dateTime(cod.remittedAt) : ' · 仍在派送员账户') }
                    ], { inline: true }) : (Number(order.codAmount) > 0 ? ui.notice('货款已登记，代收流水尚未生成', 'warn') : ''),
                    order.pod ? ui.desc([
                        { label: '签收人', value: esc(order.pod.receiver || order.receiverName || '本人') + (order.pod.receiverPhone ? ' · ' + esc(order.pod.receiverPhone) : '') },
                        { label: '签收时间', value: fmt.dateTime(order.signedAt) + (order.pod.podPhoto ? ' · 已上传凭证照片' : ' · 无凭证照片') },
                        { label: '派送备注', value: esc(order.pod.podNote || '—') }
                    ], { inline: true }) : ''
                ])
            })
        ]);
    }

    /* ---------- 订单详情抽屉 ---------- */

    var TABS = [
        { value: 'trace', label: '履约轨迹' },
        { value: 'fee', label: '费用' },
        { value: 'cost', label: '成本' },
        { value: 'plan', label: '路由' },
        { value: 'work', label: '货物与作业' },
        { value: 'doc', label: '关联单据' }
    ];

    /* 抽屉页签按角色裁剪：成本页是干线分摊、间接摊销这类内部口径，
       网点关心的是自己交接得对不对，客户关心的是运费为什么是这个数，
       给他们看「这单我们赚多少」既不合规也没有意义 */
    var TAB_ALLOW = { cost: ['admin'] };

    function roleOfSession() {
        var s = TMS.shell && TMS.shell.state && TMS.shell.state.session;
        return (s && s.role) || 'admin';
    }

    function visibleTabs() {
        var role = roleOfSession();
        return TABS.filter(function (t) { return !TAB_ALLOW[t.value] || TAB_ALLOW[t.value].indexOf(role) > -1; });
    }

    var drawer = null;

    function tabBody(detail, tab) {
        if (tab === 'fee') return orderFeePanel(detail.order);
        if (tab === 'cost') return orderCostPanel(detail.order);
        if (tab === 'plan') return orderPlanPanel(detail.order, detail.plan);
        if (tab === 'work') return orderWorkPanel(detail);
        if (tab === 'doc') return orderDocPanel(detail);
        return traceTimeline(detail.order.id);
    }

    function renderTabSlot() {
        if (!drawer) return;
        var slot = drawer.el.querySelector('[data-order-slot]');
        if (!slot) return;
        slot.innerHTML = '<div class="tms-row" style="margin-bottom:12px">' +
            ui.chips(visibleTabs().map(function (t) { return { label: t.label, value: t.value, on: t.value === drawer.tab }; }),
                { act: 'order:tab' }) + '</div>' + tabBody(drawer.detail, drawer.tab);
    }

    /* 抽屉底部的业务按钮由「当前页」决定：
       同一张运单在运营端可以改单/登记异常，在客户端只能看，硬编码在 openOrder 里就会到处都长出越权按钮 */
    function footerOfCurrentPage(orderId) {
        var s = TMS.shell && TMS.shell.state;
        var def = s ? defs[s.pageId] : null;
        return def && def.drawerFooter ? def.drawerFooter(orderId) : '';
    }

    /* openOrder(id, opts)：任意页面点单号都能拉开同一份详情，
       抽屉里再按角色跳到自己的列表页（运营端 order / 网点 b-order …）。
       opts.footer 由调用页追加动作按钮——详情是共用组件，业务动作属于打开它的页面。
       入参先过 TMS.order.byCode：单元格里挂的动作有不少直接把列表上那一列（运单号）当参数传进来，
       只认订单号就会让「点了有单号的行却报找不到」，而单号本身在页面上是看得见的 */
    function openOrder(id, opts) {
        var o = opts || {};
        var hit = TMS.order.byCode(id);
        var detail = hit ? TMS.order.detail(hit.id) : null;
        if (!detail) { ui.toast('未找到订单 ' + id, 'warn'); return null; }
        if (drawer) drawer.close();
        var order = detail.order;
        var v = TMS.order.view(order);
        var handle = ui.drawer({
            title: esc(order.waybillNo),
            sub: esc(v.customer) + ' · ' + esc(order.origin) + ' → ' + esc(order.destination) + ' · ' + esc(order.service),
            body: ui.stack([
                ui.card({
                    title: '履约进度', flat: true,
                    sub: TMS.order.isLate(order) ? '<span class="tms-badge tone-danger">已超承诺时效</span>' : fmt.duration(v.stdHours) + ' 标准时效',
                    body: statusSteps(order)
                }),
                ui.card({ title: '订单档案', sub: '只存事实，环节时间由扫描流水派生', flat: true, body: orderInfo(order) }),
                '<div data-order-slot></div>'
            ]),
            footer: (o.footer != null ? o.footer : footerOfCurrentPage(order.id)) +
                ui.btn('到列表页查看', { size: 'sm', act: 'order:landing', arg: order.id }) +
                ui.btn('复制单号', { size: 'sm', act: 'order:copy', arg: order.waybillNo }) +
                ui.btn('关闭', { act: 'ui:close' }),
            onClose: function () { if (drawer === handle) drawer = null; }
        });
        handle.detail = detail;
        handle.tab = o.tab || 'trace';
        /* 深链/调用方指定了本页角色看不见的页签时收回默认页签，不然空白区会渲染出越权内容 */
        if (!visibleTabs().some(function (t) { return t.value === handle.tab; })) handle.tab = 'trace';
        drawer = handle;
        renderTabSlot();
        return handle;
    }

    function closeOrder() {
        if (drawer) { var h = drawer; drawer = null; h.close(); }
    }

    /* 深链落地：#order?orderId=HL… 自动展开详情抽屉。
       state._deep 记录已消费的单号，否则每次数据刷新都会把刚关掉的抽屉再弹出来 */
    function deepLink(ctx) {
        var id = ctx.params && (ctx.params.orderId || (ctx.params.id && /^HL/.test(ctx.params.id) ? ctx.params.id : ''));
        if (!id || !db.get('orders', id)) return false;
        var st = ctx.state;
        if (st._deep === id) return false;
        st._deep = id;
        openOrder(id);
        return true;
    }

    /* 抽屉里的通用动作挂在 shell.actions 而不是页面 actions：
       抽屉跨页面存活，页面动作表每次渲染都会重建，挂在这里才不会被抹掉 */
    var shared = {
        'order:open': function (id) { openOrder(id); },
        'order:tab': function (tab) {
            if (!drawer) return;
            if (!visibleTabs().some(function (t) { return t.value === tab; })) return;
            drawer.tab = tab;
            renderTabSlot();
        },
        'order:landing': function (id) {
            var s = TMS.auth.current();
            if (!s) return;
            closeOrder();
            TMS.shell.go(orderPageFor(s.role), { orderId: id });
        },
        'order:copy': function (text) {
            try {
                if (global.navigator && navigator.clipboard) navigator.clipboard.writeText(String(text));
                ui.toast('已复制 ' + text, 'success');
            } catch (err) { ui.toast('复制失败，请手工选取单号', 'warn'); }
        }
    };

    /* 订单列表列：六个角色端共用同一份列序，差异只在于藏掉哪几列
       （客户看不到成本毛利、分拣员不需要费用列），hide 传列 key 即可 */
    function orderColumns(opts) {
        var o = opts || {};
        var openAct = o.rowAct || 'order:open';
        var cols = [
            { key: 'id', label: '订单号', render: function (r) { return ui.idCell(r.id, openAct); } },
            { key: 'status', label: '状态', width: '92px', render: function (r) { return ui.statusBadge(r.status); } },
            { key: 'customer', label: '客户', render: function (r) { return esc(r.customer) + (r.customerLevel ? ' ' + ui.badge(r.customerLevel, 'info') : ''); } },
            { key: 'origin', label: '线路', render: function (r) { return esc(r.origin) + ' → ' + esc(r.destination); } },
            { key: 'service', label: '服务', width: '76px', render: function (r) { return ui.badge(esc(r.service), r.service === '加急' ? 'warn' : r.service === '冷链' ? 'brand' : 'muted'); } },
            { key: 'goods', label: '货物', render: function (r) { return esc(r.goods) + ' · ' + fmt.number(r.pieces) + ' 件'; } },
            { key: 'chargeableWeight', label: '计费重', align: 'right', render: function (r) { return fmt.kg(r.chargeableWeight); } },
            { key: 'freight', label: '运费', align: 'right', render: function (r) { return ui.moneyCell(r.freight); } },
            { key: 'profit', label: '毛利', align: 'right', render: function (r) { return ui.moneyCell(r.profit); } },
            {
                key: 'expectedAt', label: '承诺时效', render: function (r) {
                    return '<span class="tms-nowrap">' + fmt.dateTime(r.expectedAt) + '</span> ' +
                        (r.status === 'signed' ? (TMS.order.isSignedLate(r) ? ui.badge('超时签收', 'warn') : ui.badge('准时', 'success'))
                            : TMS.order.isLate(r) ? ui.badge('已超时', 'danger') : '');
                }
            },
            { key: 'stuck', label: '滞留', align: 'right', render: function (r) { return fmt.duration(TMS.order.stuckHours(r)); } },
            { key: 'courier', label: '派送员', render: function (r) { return esc(r.courier || '—'); } }
        ];
        var hide = o.hide || [];
        return cols.filter(function (c) { return hide.indexOf(c.key) < 0; });
    }

    /* 订单常用筛选栏：搜索 + 状态 + 服务 + 支付方式 + 优先级 */
    function orderFields(opts) {
        var o = opts || {};
        var fields = [
            { key: 'q', type: 'search', label: o.searchLabel || '单号 / 客户 / 货物' }
        ];
        if (!o.hideStatus) fields.push({ key: 'status', label: '状态', options: [{ value: '', label: '全部状态' }].concat(ui.statusOptions()) });
        if (!o.hideService) fields.push({ key: 'service', label: '服务', options: [{ value: '', label: '全部服务' }].concat(ui.optionsOf(cfg.serviceLevels)) });
        if (!o.hidePayment) fields.push({ key: 'payment', label: '付款', options: [{ value: '', label: '全部方式' }].concat(ui.optionsOf(cfg.paymentMethods)) });
        if (o.customerFilter) {
            fields.push({ key: 'customerId', label: '客户', options: [{ value: '', label: '全部客户' }].concat(ui.optionsOf(db.col('customers'), 'id', 'name')) });
        }
        return fields;
    }

    /* 常用过滤谓词：与 orderFields 成对出现，页面不必重复写筛选逻辑 */
    function orderFilter(r, fs) {
        if (fs.status && r.status !== fs.status) return false;
        if (fs.service && r.service !== fs.service) return false;
        if (fs.payment && r.paymentMethod !== fs.payment) return false;
        if (fs.customerId && r.customerId !== fs.customerId) return false;
        if (fs.zone && r.originZone !== fs.zone) return false;
        return true;
    }

    /* 派送地址详情抽屉（运营端与网点端共用）：图2 的「审核记录 + 审查记录」双留痕要按时间轴摊开，
       两个端各写一遍必然漂移。按钮挂哪些动作由页面传进来——网点端只有「修改」，
       通过与打回是审核人的动作，传给网点端就等于给它一条越权路径 */
    var ADR_TONE = { pending: 'warn', revise: 'danger', revised: 'info', approved: 'success' };

    function addressDrawer(id, opts) {
        var o = opts || {};
        var a = TMS.address.get(id);
        if (!a) { ui.toast('地址记录不存在', 'warn'); return; }
        var revs = TMS.address.reviewsOf(id);
        var verdicts = revs.filter(function (r) { return r.kind === TMS.address.KIND.review; });
        var issues = a.issues || [];
        var wait = TMS.address.holdHours(a);
        var over = TMS.address.isOverdue(a);
        var full = (a.city || '') + (a.district || '') + (a.detail || '');
        var items = revs.map(function (x) {
            var roleName = ((cfg.roles || {})[x.actorRole] || {}).name || x.actorRole;
            var snap = x.snapshot;
            return {
                title: esc(x.action) + ' ' + ui.badge(x.kind, x.kind === TMS.address.KIND.review ? 'brand' : 'muted') +
                    (x.result ? ' ' + ui.badge(x.result, x.result === '通过' ? 'success' : 'danger') : ''),
                time: fmt.dateTime(x.at),
                tone: x.result === '打回' ? 'err' : (x.result === '通过' ? 'ok' : (x.toStatus === 'pending' ? 'warn' : '')),
                body: esc(x.actor) + (roleName ? '（' + esc(roleName) + '）' : '') + ' · 第 ' + x.rounds + ' 轮' +
                    (x.fromStatus && x.toStatus ? '　' + esc(TMS.address.labelOf(x.fromStatus)) + ' → ' + esc(TMS.address.labelOf(x.toStatus)) : '') +
                    (x.reason ? '<br>理由：' + esc(x.reason) : '') +
                    (x.note ? '<br>' + esc(x.note) : '') +
                    (snap ? '<br><span class="tms-dim">留档：' + esc(snap.phone) + ' · ' + esc((snap.city || '') + (snap.district || '') + (snap.detail || '')) + '</span>' : '')
            };
        });
        var at = TMS.address.FLOW.indexOf(a.status);
        var steps = ui.steps(TMS.address.FLOW.map(function (s, i) {
            var cur = i === at;
            return {
                label: TMS.address.labelOf(s),
                state: i < at || (cur && a.status === 'approved') ? 'done' : (cur ? (over ? 'late' : 'current') : 'todo'),
                time: cur ? (a.status === 'approved' ? fmt.dateTime(a.approvedAt) : (over ? '超时限 ' : '停留 ') + wait + ' 小时')
                    : (i === 1 && a.rejectReason ? esc(a.rejectReason) : '')
            };
        }));
        var head = ui.desc([
            { label: '状态', value: ui.badge(TMS.address.labelOf(a.status), ADR_TONE[a.status], { dot: true }) + (over ? ' ' + ui.badge('超时限', 'danger') : '') },
            { label: '手机号', value: '<span class="tms-mono">' + esc(a.phone) + '</span>　' + esc(a.receiver || '未填收件人') },
            { label: '地址', value: esc(full) },
            { label: '归属网点', value: a.branchName ? esc(a.branchName) : '<span class="tone-danger">认不出服务城市，无法归属</span>' },
            { label: '规范化体检', value: issues.length ? issues.map(function (x) { return ui.badge(esc(x), 'danger'); }).join(' ') : ui.badge('要素齐全，可派送', 'success') },
            { label: '建议写法', value: a.suggest ? '<span class="tms-dim">' + esc(a.suggest) + '</span>' : '<span class="tms-dim">—</span>' },
            { label: '提交 / 审核', value: (a.maintainCount || 1) + ' 次提交 · ' + verdicts.length + ' 轮结论 · ' + revs.length + ' 条留痕' },
            { label: '来源', value: esc(a.source || '网点维护') + (a.owner ? '（' + esc(a.owner) + '）' : '') + ' · 建档 ' + fmt.dateTime(a.createdAt) }
        ]);
        var foot = '';
        /* 图2 里「待修改」不是能被审核的状态——它只能等网点改完变成「已修改」。
           这里少判一次，按钮点下去就会被领域层拒绝，等于给了条死路 */
        var reviewable = a.status === 'pending' || a.status === 'revised';
        if (reviewable && o.pass) foot += ui.btn('审核通过', { size: 'sm', tone: 'primary', act: o.pass, arg: id });
        if (reviewable && o.reject) foot += ui.btn('打回修改', { size: 'sm', tone: 'danger', act: o.reject, arg: id });
        if (a.status === 'approved' && o.reopen) foot += ui.btn('发起复审', { size: 'sm', act: o.reopen, arg: id });
        if (o.edit) foot += ui.btn('修改内容', { size: 'sm', act: o.edit, arg: id });
        if (o.orders) foot += ui.link('该号在途单', o.orders, a.phone, { tone: 'ghost' });
        if (o.del) foot += ui.btn('删除档案', { size: 'sm', tone: 'ghost', act: o.del, arg: id });
        ui.drawer({
            title: '派送地址 · ' + esc(a.phone),
            sub: esc(full) + ' · 审核与审查双记录',
            body: head + steps + ui.timeline(items),
            footer: foot + ui.btn('关闭', { size: 'sm', act: 'ui:close' })
        });
    }

    /* ---------- 电子围栏：图形摘要、图1 判定演示与建档表单 ----------
       运营端和网点端要的是同一套东西（同一份字典、同一条判定链、同一个校验），
       各写一遍就会出现「运营端说可派送、网点端说要自提」。
       差异只有范围：网点端传 city，档案下拉与本城绑定、城市不让改 */
    var GF_TEXT = cfg.fence.LABEL;

    function fenceRefName(g) {
        if (!g || !g.refId) return '不绑定场地';
        if (g.refName) return g.refName;
        if (g.type === 'courier') {
            var e = db.get('employees', g.refId);
            return e ? e.name + '（' + e.badge + '）' : g.refId;
        }
        if (g.type === 'branch') {
            var b = db.get('branches', g.refId);
            return b ? b.name : g.refId;
        }
        var h = TMS.master.hubByNameOrId(g.refId);
        return h ? h.name : g.refId;
    }

    /* 绑定对象的取值域跟着类型走：编号围栏只能挂派送员。
       city 传进来时只列本城档案——网点勾的围栏罩不住外市的派送员 */
    function fenceRefOptions(type, city) {
        var scoped = function (rows, label) {
            var list = city ? rows.filter(function (x) { return x.city === city; }) : rows;
            return [{ value: '', label: label }].concat(ui.optionsOf(util.sortBy(list, 'id'), 'id', 'name'));
        };
        if (type === 'courier') {
            return scoped(db.col('employees').filter(function (x) {
                return x.role === 'deliveryman' && x.status === 'active';
            }), '（必须绑一位在册派送员）');
        }
        if (type === 'branch') return scoped(db.col('branches'), '不绑定（按城市布点）');
        return [{ value: '', label: '不绑定场地' }].concat(ui.optionsOf(db.col('hubs'), 'id', 'name'));
    }

    function fenceGeomCell(g) {
        var geo = TMS.network.geometryOf(g);
        return geo.kind === 'polygon'
            ? geo.points + ' 点勾画 · ' + geo.areaKm2 + ' km²'
            : '半径圆 · ' + util.round(geo.radiusM / 1000, 2) + ' km';
    }

    /* 图1 的三条问句各自要一张围栏来回答，合成一个「覆盖/没覆盖」就看不出漏在哪一环。
       types 传子集时只列那几行——网点端没有分拨围栏，给它看「无到货围栏」是添乱 */
    function fenceProbe(city, types) {
        var point = TMS.master.cityByName(city);
        if (!point) return null;
        var list = types || cfg.fence.TYPES;
        var rows = [];
        if (list.indexOf('hub') > -1) {
            var hub = TMS.network.fenceAt(point, 'hub');
            rows.push({
                ask: cfg.fence.ASKS.hub, fence: hub, type: 'hub',
                verdict: hub ? ui.badge('到货围栏内', 'success') : ui.badge('无到货围栏', 'muted'),
                note: hub ? fenceRefName(hub) + ' · ' + hub.city : '该市没有分拨场地围栏，到件扫描无法核验是否入库'
            });
        }
        if (list.indexOf('branch') > -1) {
            var br = TMS.network.fenceAt(point, 'branch');
            rows.push({
                ask: cfg.fence.ASKS.branch, fence: br, type: 'branch',
                verdict: br ? ui.badge('可派送', 'success') : ui.badge('不可派送 · 需自提', 'danger'),
                note: br ? fenceRefName(br) + ' · ' + fenceGeomCell(br) : '该市没有在用的机构派送围栏，收件点只能到网点自提'
            });
        }
        if (list.indexOf('courier') > -1) {
            var cf = TMS.network.courierFenceAt(point);
            rows.push({
                ask: cfg.fence.ASKS.courier, fence: cf && cf.fence, type: 'courier',
                verdict: cf ? ui.badge('自动绑编号', 'success') : ui.badge('需手动指定派送编号', 'warn'),
                note: cf ? cf.courier.name + '（' + cf.courier.badge + '）· ' + cf.fence.name
                    : '收件点不在任何派送员编号围栏内，派单时会退回人工指定'
            });
        }
        return { city: city, point: point, rows: rows };
    }

    /* 建档表单。类型不进这张表：它决定「绑定对象」的取值域（分拨 / 网点 / 派送员），
       在同一次提交里改类型会让下拉选项和已选值打架。要换类型就删了重建——
       围栏本来就三类各管一件事，混着改等于把图1 的三层判定揉回一层。
       allowTypes 是给网点端的护栏：越出允许范围的类型直接退回默认可建类型 */
    function fenceFormModal(id, opts) {
        var o = opts || {};
        var g = id ? db.get('geofences', id) : null;
        var allow = o.allowTypes || cfg.fence.TYPES;
        var want = (g && g.type) || o.type || 'branch';
        var type = allow.indexOf(want) > -1 ? want : allow[0];
        var typeLabel = GF_TEXT[type] || ('未知类型 ' + type);
        var ask = cfg.fence.ASKS[type] || '这张围栏管哪一段作业';
        var points = o.points || null;
        var geo = points
            ? { kind: 'polygon', points: points.length, areaKm2: util.ringAreaKm2(points), radiusM: 0 }
            : TMS.network.geometryOf(g || {});
        var presetCity = o.city || (g && g.city) || '';
        /* 勾画带进来的顶点已经确定了位置，城市先按重心反查预填：
           让人再手选一次，选出来的还是 saveFence 马上改掉的那个值 */
        var drawnAt = points ? TMS.network.nearestCity(util.ringCentroid(points)) : null;
        if (!presetCity && drawnAt) presetCity = drawnAt.city.name;
        var suggest = (function () {
            var b = TMS.network.fenceAudit(Math.max(7, Number(o.days) || 7)).breaches
                .filter(function (x) { return x.city === presetCity; })[0];
            return b ? b.radiusM : (type === 'hub' ? 2000 : type === 'courier' ? 1500 : 25000);
        })();
        /* 城市反查：勾画过的围栏由 saveFence 按几何重心复核，这里只保证没勾边界时城市是真的 */
        ui.formModal({
            title: (g ? '编辑围栏「' + g.name + '」' : '新建' + typeLabel),
            sub: ask + (points ? ' · 已带入 ' + points.length + ' 个勾画顶点' : ''),
            notice: points
                ? '勾画边界约 <b>' + geo.areaKm2 + ' km²</b>' + (presetCity ? '，重心离 <b>' + presetCity + '</b> 最近' : '') +
                '，保存后按顶点环判定，半径不再参与计算。'
                : (g ? '改半径会立刻改变覆盖判定与越界告警。' : '也可以先在地图上勾边界，闭合后再回到这里补名称与绑定。'),
            values: {
                name: (g && g.name) || (o.preset && o.preset.name) || (presetCity ? presetCity + typeLabel : ''),
                city: presetCity, refId: (g && g.refId) || (o.preset && o.preset.refId) || '',
                radiusM: (g && g.radiusM) || suggest, status: (g && g.status) || 'active', note: (g && g.note) || ''
            },
            fields: [
                { key: 'name', label: '围栏名称', required: true, span: 2, placeholder: '例：' + (typeLabel + '福州') },
                o.cityLock
                    ? { key: 'city', label: '所在城市', readonly: true, tip: '本网点只能维护' + presetCity + '的围栏；勾画过的围栏还会按几何重心复核城市' }
                    : { key: 'city', label: '所在城市', type: 'city', required: true, tip: '圆心取该城市质心；勾画过的围栏会按几何重心反查城市，不认手填' },
                {
                    key: 'refId', label: '绑定对象', type: 'select', options: fenceRefOptions(type, o.cityLock ? presetCity : ''),
                    required: type === 'hub' || type === 'courier', span: 2,
                    placeholder: type === 'courier' ? '（必须绑一位在册派送员）' : '不绑定场地'
                },
                {
                    key: 'radiusM', label: '覆盖半径', type: 'number', min: 100, max: 120000, step: 500, unit: '米',
                    readonly: !!points, tip: points ? '已勾边界，半径仅作展示' : '没勾边界时它就是这个围栏的全部形状'
                },
                { key: 'status', label: '状态', type: 'select', placeholder: false, options: Object.keys(cfg.fence.STATUS).map(function (k) { return { value: k, label: cfg.fence.STATUS[k] }; }) },
                { key: 'note', label: '备注', type: 'textarea', span: 2, rows: 2, placeholder: '为什么这样勾：争议、待复核、与邻市边界怎么分…' }
            ],
            okText: g ? '保存并重跑巡检' : '建立并重跑巡检',
            onSubmit: function (v) {
                var res = TMS.network.saveFence({
                    id: g && g.id, name: v.name, city: o.cityLock ? presetCity : v.city, type: type, refId: v.refId,
                    radiusM: Math.max(100, Number(v.radiusM) || 0), status: v.status, note: v.note, polygon: points
                }, o.actor || '系统');
                if (!res.ok) return res.message;
                var out = TMS.jobs.run('fenceCoverage').out || {};
                ui.toast((g ? '已更新围栏' : '已建立围栏') + '，' + res.row.city + ' 越界告警核销 ' + (out.resolved || 0) +
                    ' 条，仍缺派送围栏的城市 ' + out.gap + ' 座', 'success');
                TMS.shell.refresh();
                if (o.onDone) o.onDone(res.row);
            }
        });
    }

    /* 半径单独调只给没勾边界的围栏：已勾画的半径不参与判定，给它一条改半径的入口等于骗人。
       sub / notice 由页面按自己的口径传：运营端说「罩住几座城市」，网点端只能说「罩住本城没有」 */
    function fenceResizeModal(id, opts) {
        var o = opts || {};
        var g = db.get('geofences', id);
        if (!g) { ui.toast('未找到围栏 ' + id, 'warn'); return; }
        if (TMS.network.fenceRing(g)) { ui.toast('这张围栏已勾过边界，半径不再参与判定，请改边界', 'info'); return; }
        ui.formModal({
            title: '调整 ' + g.name + ' 的覆盖半径',
            sub: o.sub || ('当前 ' + fmt.number(g.radiusM) + ' m，按圆判定罩住的作业点会随这里变化'),
            notice: o.notice || '',
            values: { radiusM: g.radiusM },
            fields: [{ key: 'radiusM', label: '覆盖半径', type: 'number', required: true, min: 300, max: 120000, step: 500, unit: '米', span: 2 }],
            okText: '保存并重跑巡检',
            onSubmit: function (v) {
                var res = TMS.network.saveFence({ id: id, radiusM: Math.max(300, Number(v.radiusM) || 0) }, o.actor || '系统');
                if (!res.ok) return res.message;
                var out = TMS.jobs.run('fenceCoverage').out || {};
                ui.toast('已调整半径，仍缺派送围栏的城市 ' + out.gap + ' 座', 'success');
                TMS.shell.refresh();
                if (o.onDone) o.onDone(res.row);
            }
        });
    }

    var registry = {
        define: define, get: get, all: all, byRole: byRole, unregistered: unregistered,
        orderPageFor: orderPageFor, MENU_FILE: MENU_FILE,
        /* 列表管线 */
        filtersOf: filtersOf, sortRows: sortRows, paginate: paginate, grid: grid,
        statusChips: statusChips, isCompact: isCompact,
        /* 角色可见范围 */
        orderScope: orderScope, scopedOrders: scopedOrders,
        /* 订单共用视图 */
        statusSteps: statusSteps, traceTimeline: traceTimeline, orderInfo: orderInfo,
        orderFeePanel: orderFeePanel, orderCostPanel: orderCostPanel, orderPlanPanel: orderPlanPanel,
        orderWorkPanel: orderWorkPanel, orderDocPanel: orderDocPanel, orderTaskList: orderTaskList,
        orderColumns: orderColumns, orderFields: orderFields, orderFilter: orderFilter,
        addressDrawer: addressDrawer,
        /* 电子围栏共用视图与建档（运营端 / 网点端） */
        fenceRefName: fenceRefName, fenceRefOptions: fenceRefOptions, fenceGeomCell: fenceGeomCell,
        fenceProbe: fenceProbe, fenceFormModal: fenceFormModal, fenceResizeModal: fenceResizeModal,
        GF_TEXT: GF_TEXT, GF_STATUS_TEXT: cfg.fence.STATUS,
        openOrder: openOrder, closeOrder: closeOrder, deepLink: deepLink, TABS: TABS, visibleTabs: visibleTabs, LEG_TYPE: LEG_TYPE,
        /* 状态字典与档案反查 */
        statusText: statusText, statusBadge: statusBadge, TRIP_TEXT: TRIP_TEXT, DOC_TEXT: DOC_TEXT, hubName: hubName
    };

    if (TMS.shell && TMS.shell.actions) {
        Object.keys(shared).forEach(function (k) { TMS.shell.actions[k] = shared[k]; });
    }
    registry.shared = shared;

    TMS.pages = registry;
})(window);
