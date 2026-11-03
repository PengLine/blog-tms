/* 分拣员端：本场分拨的件在我手上只停留几个小时，所以这一端的全部内容就是
   「扫到 → 落格 → 交给干线」。任务量、准确率、件/小时效率直接进绩效，
   所以页面必须把「今天干了多少」摆在最显眼的位置，而不是让人自己去报表里翻。 */
(function (global) {
    'use strict';

    var TMS = global.TMS = global.TMS || {};
    var util = TMS.util, ui = TMS.ui, db = TMS.db, pg = TMS.pages, po = TMS.portal;
    var esc = util.esc, fmt = util.fmt;
    var ROLE = 'sorter';

    function sess() { return po.session(); }
    function hub() { return sess().orgId || (po.me(sess()) || {}).hubId || ''; }
    function name() { return po.actor(sess()); }
    function today() { return util.dateKey(util.now()); }

    /* 本场分拣任务：任务行不存枢纽，格口看板用 sortingTaskView 反查订单的 hubFrom */
    function hubTasks() {
        var h = hub();
        return db.col('sortingTasks').map(TMS.operation.sortingTaskView)
            .filter(function (t) { return t && t.hubId === h; });
    }

    function myScans(days) {
        var cutoff = util.addDays(util.now(), -(days || 1)).getTime(), me = name();
        return db.col('scans').filter(function (s) {
            return s.operator === me && util.toDate(s.opTime).getTime() >= cutoff;
        }).sort(function (a, b) { return String(b.opTime).localeCompare(String(a.opTime)); });
    }

    function scanRows(list) {
        return list.slice(0, 60).map(function (s, i) {
            var v = TMS.order.traceView(s, db.get('orders', s.orderId));
            v.k = s.orderId + '#' + s.opTime + '#' + i;
            return v;
        });
    }

    function chuteOf(order) {
        return 'C' + util.pad(1 + util.hash(order.destination || '') % 40, 2);
    }

    /* ---------- 动作 ---------- */

    /* 扫描台的核心动作：给一个单号，把它推到本岗位该推的那一步。
       不猜规则，跳步一律交给状态机报错——一线端「扫了没反应」最常见的根因就是前端自己判了一遍状态 */
    function scan(id) {
        var key = String(id || '').trim();
        if (!key) {
            var fs = (ui.state('s-scan') || {}).filters || {};
            key = String(fs.code || '').trim();
        }
        if (!key) { ui.toast('请先扫描或输入运单号', 'warn'); return; }
        var o = TMS.order.byCode(key);
        if (!o) { ui.toast('查无此单：' + key + '（不在作业范围或片段命中多张）', 'error'); return; }
        if (o.status === 'inbound') {
            po.run('分拣落格', TMS.order.sort(o.id, { operator: name(), device: po.device(sess()), chute: chuteOf(o) }));
            return;
        }
        if (o.status === 'sorted') { ui.toast('该单已落格 ' + chuteOf(o) + '，等干线装车', 'success'); pg.openOrder(o.id); return; }
        if (TMS.order.isTerminal(o)) { ui.toast('该单已终态（' + TMS.order.LABEL[o.status] + '），不再分拣', 'warn'); pg.openOrder(o.id); return; }
        /* 还没到本场的件先顺推一格留下扫描痕迹，跳步由状态机自己拒绝——
           一线端「扫了没反应」多半是前端自己抄了一遍状态判断 */
        po.run('扫描登记', TMS.order.advance(o.id, { operator: name(), device: po.device(sess()), note: '分拣员扫描登记' }));
    }

    /* 格口批量落格只处理本场任务：sortChute 是全站口径，网点/分拨各自点会互相抢件 */
    function batchChute(chute) {
        var c = String(chute || '').trim();
        if (!c) { ui.toast('请选择格口', 'warn'); return; }
        var list = hubTasks().filter(function (t) { return t.chute === c && t.status !== 'done'; });
        if (!list.length) { ui.toast('格口 ' + c + ' 没有本场待分拣任务', 'warn'); return; }
        var done = 0, fail = 0;
        list.forEach(function (t) {
            var res = TMS.order.sort(t.orderId, { operator: name(), device: po.device(sess()), chute: c });
            if (res && res.ok) done++; else fail++;
        });
        ui.toast('格口 ' + c + ' 落格 ' + done + ' 单' + (fail ? '，失败 ' + fail + ' 单' : ''), fail ? 'warn' : 'success');
    }

    var ACT = (function () {
        var out = {};
        [po.workActions, po.clockActions, po.exActions].forEach(function (src) {
            Object.keys(src).forEach(function (k) { out[k] = src[k]; });
        });
        var extra = {
            's:scan': scan,
            's:batch': batchChute,
            'srt:start': function (id) {
                if (!id) { ui.toast('任务不存在', 'error'); return; }
                if (!TMS.operation.startSorting(id, { operator: name(), at: util.now() })) { ui.toast('开始分拣失败：任务记录不存在', 'error'); return; }
                ui.toast('开始分拣，工时从此刻起算', 'success');
            },
            'srt:finish': function (id) {
                var t = db.get('sortingTasks', id);
                if (!t) { ui.toast('任务不存在', 'error'); return; }
                var view = TMS.operation.sortingTaskView(t);
                po.run('完成分拣', TMS.order.sort(t.orderId, {
                    operator: name(), device: po.device(sess()), chute: view.chute, note: '按任务单落格'
                }));
            },
            'srt:mis': function (id) {
                var t = db.get('sortingTasks', id);
                if (!t) return;
                var view = TMS.operation.sortingTaskView(t);
                ui.formModal({
                    title: '错分登记 · ' + (view.waybillNo || t.orderId),
                    sub: '实际格口与默认格口不符才落库，错分件即时上报异常并计入分拣准确率',
                    fields: [
                        { key: 'chute', label: '实际格口', value: view.chute, required: true },
                        { key: 'reason', label: '错分原因', type: 'select', placeholder: false, options: ui.optionsOf(['面单不清', '线路变更', '人工误投', '设备误判']) },
                        { key: 'note', label: '说明', type: 'textarea', span: 2 }
                    ],
                    okText: '登记并重新落格',
                    onSubmit: function (v) {
                        var res = TMS.order.sort(t.orderId, {
                            operator: name(), device: po.device(sess()), chute: v.chute, note: '错分纠正：' + v.reason
                        });
                        if (!res || !res.ok) return '登记失败：' + (res && res.message || '');
                        TMS.order.markProblem(t.orderId, {
                            type: '分拣错误', level: '三级', description: '默认 ' + view.chute + ' 实投 ' + v.chute + '：' + (v.note || v.reason),
                            operator: name(), actor: name()
                        });
                        ui.toast('错分已登记，异常工单已生成', 'success');
                    }
                });
            },
            's:open': function (id) { if (id) pg.openOrder(id); },
            'b:go': function (page) { if (page) TMS.shell.go(page); }
        };
        Object.keys(extra).forEach(function (k) { out[k] = extra[k]; });
        return out;
    })();

    /* ---------- 工作台 ---------- */

    pg.define('s-home', {
        load: function () {
            var tasks = hubTasks();
            var open = tasks.filter(function (t) { return t.status !== 'done'; });
            var doneToday = tasks.filter(function (t) { return t.status === 'done' && util.dateKey(t.finishedAt) === today(); });
            var scans = scanRows(myScans(1));
            var emp = po.me() || {};
            return {
                emp: emp, open: open, doneToday: doneToday, scans: scans,
                board: TMS.operation.sortingBoard(hub()),
                waiting: pg.scopedOrders(sess()).filter(function (o) { return o.status === 'inbound'; }),
                rec: TMS.people.todayRecord(emp.id),
                shift: emp.id ? db.findOne('shifts', function (x) { return x.employeeId === emp.id && x.date === today(); }) : null
            };
        },
        drawerFooter: function (id) { return po.footerFor(ROLE, id); },
        render: function (ctx, d) {
            var pieces = util.sum(d.doneToday, 'pieces'), minutes = util.sum(d.doneToday, 'actualMinutes');
            var emp = d.emp, canIn = !d.rec || !d.rec.clockIn;
            return po.wrap(ctx, {
                sub: esc(pg.hubName(hub())) + ' · ' + esc(emp.position || '分拣员') + ' ' + esc(name()) +
                    (d.shift ? ' · ' + esc(TMS.people.shiftView(d.shift).shiftName) : ' · 今日未排班'),
                actions: ui.btn(canIn ? '上班打卡' : '已打卡', { tone: canIn ? 'primary' : 'default', act: 'clock:in', disabled: !canIn }) +
                    ui.btn('扫描台', { act: 'b:go', arg: 's-scan' }),
                body: [
                    ui.kpis([
                        { label: '待分拣任务', value: d.open.length, unit: '个', tone: d.open.length ? 'warn' : 'success', sub: fmt.number(util.sum(d.open, 'pieces')) + ' 件' },
                        { label: '今日已分拣', value: d.doneToday.length, unit: '单', tone: 'brand', sub: fmt.number(pieces) + ' 件' },
                        { label: '今日效率', value: minutes ? util.round(pieces / (minutes / 60), 1) : 0, unit: '件/小时', tone: 'info', sub: '用工 ' + fmt.number(minutes) + ' 分钟' },
                        { label: '今日扫描流水', value: d.scans.length, unit: '条', tone: 'muted', sub: '含落格与中转登记' }
                    ]),
                    ui.card({
                        title: '待办件', sub: '本场已入库、等我落格的件', tools: ui.link('全部', 'b:go', 's-sorting'), flat: true,
                        body: po.taskCards(d.waiting.slice(0, 6), ROLE, { emptyText: '本场没有待分拣件', emptySub: '入库件到达后会自动出现在这里' })
                    }),
                    ui.card({
                        title: '格口看板', sub: '未完成任务按格口聚合，先清加急与大户', tools: ui.btn('按格口批量落格', { size: 'sm', tone: 'primary', act: 's:batch', arg: '' }), flat: true,
                        body: d.board.length ? ui.table({
                            dense: true, keyName: 'chute', rows: d.board.slice(0, 8), sortable: false,
                            columns: [
                                { key: 'chute', label: '格口', render: function (r) { return ui.badge(esc(r.chute), 'brand'); } },
                                { key: 'tasks', label: '任务', align: 'right' },
                                { key: 'pieces', label: '件数', align: 'right' },
                                { key: 'weight', label: '计费重', align: 'right', render: function (r) { return fmt.kg(r.weight); } },
                                { key: 'urgent', label: '加急', align: 'right', render: function (r) { return r.urgent ? ui.badge(r.urgent + ' 单', 'warn') : '<span class="tms-dim">0</span>'; } },
                                { key: 'destinations', label: '去向', render: function (r) { return esc((r.destinations || []).join('、')); } },
                                { key: 'act', label: '操作', sortable: false, render: function (r) { return ui.btn('落格', { size: 'sm', act: 's:batch', arg: r.chute }); } }
                            ]
                        }) : ui.empty('本场没有待分拣任务')
                    }),
                    ui.card({
                        title: '我的扫描记录', sub: '今日流水，绩效按这一份重算', tools: ui.link('打卡', 'b:go', 's-clock'), flat: true,
                        body: scanTable(d.scans.slice(0, 6))
                    })
                ]
            });
        },
        actions: ACT
    });

    function scanTable(rows) {
        if (!rows.length) return ui.empty('今天还没有扫描记录', '在扫描台扫一张面单即开始留痕');
        return ui.table({
            dense: true, keyName: 'k', rows: rows, sortable: false,
            columns: [
                { key: 'opTime', label: '时间', render: function (r) { return '<span class="tms-nowrap">' + fmt.time(r.opTime) + '</span>'; } },
                { key: 'nodeName', label: '节点', render: function (r) { return esc(r.nodeName); } },
                { key: 'orderId', label: '运单', render: function (r) { return ui.idCell(r.orderId, 'order:open', { short: true }); } },
                { key: 'location', label: '地点', render: function (r) { return esc(r.location || '—'); } },
                { key: 'result', label: '结果', render: function (r) { return r.result === 'ok' ? ui.badge('正常', 'success') : ui.badge(esc(r.result), 'danger'); } },
                { key: 'isDeviant', label: '校验', render: function (r) { return r.isDeviant ? ui.badge('超时限', 'warn') : '<span class="tms-dim">按时</span>'; } }
            ]
        });
    }

    /* ---------- 扫描台 ---------- */

    pg.define('s-scan', {
        load: function (ctx) {
            var link = ctx.params && ctx.params.orderId ? db.get('orders', ctx.params.orderId) : null;
            var rows = pg.scopedOrders(sess());
            return {
                link: link,
                inbound: rows.filter(function (o) { return o.status === 'inbound'; }),
                sorted: rows.filter(function (o) { return o.status === 'sorted'; }),
                scans: scanRows(myScans(1))
            };
        },
        drawerFooter: function (id) { return po.footerFor(ROLE, id); },
        render: function (ctx, d) {
            var o = d.link;
            return po.wrap(ctx, {
                sub: '扫面单即推进一步：本场入库件直接落格，还没到本场的件只登记轨迹不改环节',
                body: [
                    ui.card({
                        title: '扫描枪', flat: true, tone: 'brand',
                        body: ui.stack([
                            ui.filters([{
                                key: 'code', type: 'search', label: '运单号 / 订单号', value: o ? (o.waybillNo || o.id) : '',
                                placeholder: '扫描或输入 HL 开头的单号', hint: '支持 HL 订单号与 12 位运单号'
                            }], ctx.state.filters, {
                                actions: ui.btn('扫描并落格', { tone: 'primary', act: 's:scan' }) +
                                    ui.btn('查这张单', { act: 's:open', arg: o ? o.id : '' })
                            }),
                            o ? pg.statusSteps(o) : ui.notice('也可以直接点下方待办件的按钮，效果与扫描一致', 'info')
                        ])
                    }),
                    ui.kpis([
                        { label: '本场待分拣', value: d.inbound.length, unit: '单', tone: 'warn', sub: '已入库未落格' },
                        { label: '已落格待发', value: d.sorted.length, unit: '单', tone: 'brand', sub: '交干线装车' },
                        { label: '今日我的扫描', value: d.scans.length, unit: '条', tone: 'info', sub: '全部进绩效口径' },
                        { label: '超时限流水', value: d.scans.filter(function (r) { return r.isDeviant; }).length, unit: '条', tone: 'danger', sub: '需要复盘' }
                    ]),
                    ui.card({
                        title: '待分拣件', sub: '点「分拣落格」即按目的城市推定格口', flat: true,
                        body: po.taskCards(d.inbound.slice(0, 8), ROLE, { emptyText: '没有待分拣的件' })
                    }),
                    ui.card({ title: '今日扫描流水', sub: '倒序，最近一条在最上', flat: true, body: scanTable(d.scans.slice(0, 12)) })
                ]
            });
        },
        actions: ACT
    });

    /* ---------- 分拣任务 ---------- */

    pg.define('s-sorting', {
        load: function () {
            var t = hubTasks();
            return {
                pending: t.filter(function (x) { return x.status === 'pending'; }),
                running: t.filter(function (x) { return x.status === 'processing'; }),
                done: t.filter(function (x) { return x.status === 'done'; })
                    .sort(function (a, b) { return String(b.finishedAt).localeCompare(String(a.finishedAt)); }),
                board: TMS.operation.sortingBoard(hub())
            };
        },
        drawerFooter: function (id) { return po.footerFor(ROLE, id); },
        render: function (ctx, d) {
            var std = util.sum(d.pending.concat(d.running), 'stdMinutes');
            var used = util.sum(d.done, 'actualMinutes');
            return po.wrap(ctx, {
                sub: '任务由入库扫描自动生成，线别与格口按订单推导；开始/完成都会写回实际用工，效率与准确率同时进绩效',
                body: [
                    ui.kpis([
                        { label: '待开始', value: d.pending.length, unit: '个', tone: 'warn', sub: '标准工时 ' + fmt.number(std) + ' 分钟' },
                        { label: '分拣中', value: d.running.length, unit: '个', tone: 'brand', sub: '先做完再开新的' },
                        { label: '已完成', value: d.done.length, unit: '个', tone: 'success', sub: '实际用工 ' + fmt.number(used) + ' 分钟' },
                        { label: '工时效率', value: used ? util.round(util.sum(d.done, 'pieces') / (used / 60), 1) : 0, unit: '件/小时', tone: 'info', sub: '今日口径' }
                    ]),
                    po.grid(ctx, {
                        rows: d.running.concat(d.pending), keyName: 'id', state: ctx.state,
                        title: '未完成任务', sub: '加急与高优先排在前面',
                        columns: taskColumns(),
                        search: function (t) { return [t.id, t.orderId, t.waybillNo, t.customer, t.origin, t.destination, t.chute].join(' '); },
                        filter: function (t, fs) { return !fs.line || t.line === fs.line; },
                        fields: [
                            { key: 'q', type: 'search', label: '运单 / 客户 / 格口' },
                            { key: 'line', label: '线别', options: [{ value: '', label: '全线别' }].concat(ui.optionsOf(util.unique(d.pending.map(function (t) { return t.line; })))) }
                        ],
                        valueOf: function (t, k) { return k === 'priority' ? (t.priority === '高' ? 1 : 0) : t[k]; },
                        pageSize: 10, emptyText: '本场没有未完成的分拣任务'
                    }),
                    po.grid(ctx, {
                        rows: d.done, keyName: 'id', state: ctx.state, title: '今日完成', sub: '实际格口与默认格口不一致即为错分',
                        columns: [
                            { key: 'waybillNo', label: '运单', render: function (t) { return ui.idCell(t.orderId, 'order:open', { short: true }); } },
                            { key: 'chute', label: '格口', render: function (t) { return ui.badge(esc(t.chute), 'brand'); } },
                            { key: 'result', label: '结果', render: function (t) { return esc(t.result || '正常分拣'); } },
                            { key: 'pieces', label: '件数', align: 'right' },
                            { key: 'stdMinutes', label: '标准', align: 'right', render: function (t) { return fmt.number(t.stdMinutes) + ' 分'; } },
                            { key: 'actualMinutes', label: '实际', align: 'right', render: function (t) { return fmt.number(t.actualMinutes) + ' 分'; } },
                            {
                                key: 'diff', label: '工时差', align: 'right', render: function (t) {
                                    var p = t.stdMinutes ? util.round((t.actualMinutes - t.stdMinutes) / t.stdMinutes * 100, 0) : 0;
                                    return ui.delta(p, { unit: '%', invert: true });
                                }
                            },
                            { key: 'finishedAt', label: '完成时间', render: function (t) { return ui.timeCell(t.finishedAt); } }
                        ],
                        search: function (t) { return [t.orderId, t.waybillNo, t.chute].join(' '); },
                        pageSize: 8, emptyText: '今天还没有完成的分拣任务'
                    })
                ]
            });
        },
        actions: ACT
    });

    function taskColumns() {
        return [
            { key: 'waybillNo', label: '运单', render: function (t) { return ui.idCell(t.orderId, 'order:open', { short: true }) + ' <span class="tms-dim">' + esc(t.waybillNo || '') + '</span>'; } },
            { key: 'customer', label: '客户', render: function (t) { return esc(t.customer || '散客'); } },
            { key: 'line', label: '线别', render: function (t) { return ui.badge(esc(t.line), 'muted'); } },
            { key: 'chute', label: '格口', render: function (t) { return ui.badge(esc(t.chute), 'brand'); } },
            { key: 'destination', label: '去向', render: function (t) { return esc(t.origin) + '→' + esc(t.destination); } },
            { key: 'pieces', label: '件/重', align: 'right', render: function (t) { return fmt.number(t.pieces) + ' 件 / ' + fmt.kg(t.weight); } },
            { key: 'priority', label: '优先', render: function (t) { return t.priority === '高' ? ui.badge('加急', 'warn') : '<span class="tms-dim">普通</span>'; } },
            { key: 'status', label: '状态', render: function (t) { return pg.statusBadge(t.status, pg.DOC_TEXT); } },
            { key: 'stdMinutes', label: '标准工时', align: 'right', render: function (t) { return fmt.number(t.stdMinutes) + ' 分'; } },
            {
                key: 'act', label: '操作', sortable: false, render: function (t) {
                    if (t.status === 'processing') return ui.btn('完成落格', { size: 'sm', tone: 'primary', act: 'srt:finish', arg: t.id });
                    return ui.btn('开始分拣', { size: 'sm', tone: 'primary', act: 'srt:start', arg: t.id }) +
                        ui.btn('错分', { size: 'sm', act: 'srt:mis', arg: t.id });
                }
            }
        ];
    }

    /* ---------- 打卡 / 排班 / 绩效与一线同构，直接复用共用件 ---------- */

    pg.define('s-schedule', po.scheduleDef());
    pg.define('s-clock', po.clockDef());
    pg.define('s-performance', po.perfDef());
})(window);
