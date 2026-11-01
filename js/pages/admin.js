/* 运营端（admin）页面集：35 个菜单页全部注册在这里
   页面只声明「取数 + 列定义 + 动作」，筛选/排序/分页/详情抽屉/状态字典由 js/pages/registry.js 提供，
   任何聚合口径都从 js/domain/* 读取——页面里出现 sum/groupBy 就是漂移的开始 */
(function (global) {
    'use strict';

    var TMS = global.TMS = global.TMS || {};
    var util = TMS.util, ui = TMS.ui, db = TMS.db, cfg = TMS.cfg, ch = TMS.charts, pg = TMS.pages;
    var esc = util.esc, fmt = util.fmt;

    /* ---------- 页面骨架 ---------- */

    function ctxTitle(ctx) {
        var d = pg.get(ctx.pageId);
        return d ? d.title : ctx.pageId;
    }

    function wrap(ctx, o) {
        o = o || {};
        return ui.page({
            title: o.title || ctxTitle(ctx), sub: o.sub, badge: o.badge, actions: o.actions,
            body: ui.stack(o.body || [])
        });
    }

    /* grid(ctx, {...})：把外壳按 pageId 保管的 state 注入列表管线 */
    function grid(ctx, o) {
        o.state = o.state || ctx.state;
        return pg.grid(o);
    }

    function statusBadge(v, dict) { return pg.statusBadge(v, dict); }

    function idLink(v, act) { return ui.idCell(v, act || 'order:open'); }

    /* 空值统一成淡灰破折号，避免页面各处重复写三元 */
    function dim(v) { return v == null || v === '' ? '<span class="tms-dim">—</span>' : esc(v); }

    /* 动作回调只收到 (arg, el)，没有 ctx（ctx 是渲染期的东西，点击时早已换页）。
       导出、重跑取数这类需要页面上下文的动作统一从这里现取一份等价 ctx */
    function curCtx() {
        var s = TMS.shell.current();
        return {
            shell: s, session: s.session, params: s.params, days: s.days, layout: s.layout,
            pageId: s.pageId, role: s.session && s.session.role, state: ui.state(s.pageId)
        };
    }

    /* ui.progress 的 tone 是给「越低越好」的指标设计的（超阈值变红），
       及时率/达成率这类越高越好的百分比必须显式给 tone，否则 98% 会显示成红色 */
    function rateBar(v, opts) {
        var o = opts || {};
        var x = Number(v) || 0;
        var good = o.target == null ? 92 : o.target;
        var tone = x >= good ? 'success' : (x >= good - 12 ? 'warn' : 'danger');
        return ui.progress(x, { thin: true, tone: tone }) +
            '<span class="tms-dim" style="font-size:11px"> ' + fmt.percent(x) + '</span>';
    }

    function pctBar(v, opts) {
        var o = opts || {};
        return ui.progress(v, o) + '<span class="tms-dim" style="font-size:11px"> ' + fmt.percent(v) + '</span>';
    }

    /* 下拉字典取的是「某列的去重值」，util.unique 只吃值数组，
       直接把行数组丢进去会得到一串 [object Object] 选项 */
    function colUnique(pool, key) {
        return util.unique(db.col(pool).map(function (r) { return r[key]; })).sort();
    }

    /* 同一批状态键在客户语境与员工语境里意思不同（active 到底是「在职」还是「合作中」），
       字典按对象覆盖，不塞进全局 DOC_TEXT */
    var CUSTOMER_TEXT = { active: '合作中', suspended: '已停用', expired: '合同到期' };

    /* db.create/update 只动内存，不提交就不落 localStorage、也不广播刷新；
       页面直接写档案表一律走这里，否则表现为「保存成功但刷新就丢」 */
    function saveRow(pool, row, reason) {
        db.commit(pool, row && row.id, reason || pool);
        return row;
    }

    /* ui.optionsOf 只吃数组，{key: 文案} 形式的状态/类型字典要自己摊平成 {value,label} */
    function dictOptions(dict) {
        return Object.keys(dict).map(function (k) { return { value: k, label: dict[k] }; });
    }

    /* 动作表合并（页面动作 + 跨页共享动作），ES5 环境下不依赖 Object.assign */
    function merge() {
        var out = {};
        for (var i = 0; i < arguments.length; i++) {
            var src = arguments[i] || {};
            Object.keys(src).forEach(function (k) { out[k] = src[k]; });
        }
        return out;
    }

    /* 弹窗按钮只能带一个动作名与一个参数，页面级动作必须挂在会打开该弹窗的页面里；
       挂不全的表现是「点了没反应」，所以这几条统一导出给各页合并 */
    var custActions = {
        'cust:open': function (id) { customerModal(id); },
        'cust:orders': function (id) {
            ui.closeTop();
            TMS.shell.go('order', { customerId: id });
        },
        'cust:edit': function (id) { customerFormModal(id); }
    };

    /* 仓储与物料两套账互相引用：仓库弹窗里点物料、物料弹窗里点仓库、在途单里点应付。
       ui.actions 每次渲染只装配「共享 + 当前页」，所以这一整套统一导出，两个页面各自合并 */
    var stockActions = {
        'wh:open': function (id) { whModal(id); },
        'wh:edit': function (id) { whFormModal(id); },
        'wh:new': function () { whFormModal(''); },
        'wh:in': function (id) { whInOutModal(id, 'in'); },
        'wh:out': function (id) { whInOutModal(id, 'out'); },
        'wh:count': function (id) { whCountModal(id); },
        'wh:transfer': function (id) { whTransferModal(id); },
        'wh:recalc': function (id) { recalcUsage(id); },
        'wh:urge': function (id) { urgeOrder(id); },
        'wh:exception': function (id) { exceptionFromStock(id); },
        'wh:buy': function (arg) { purchaseEntry(arg); },
        'wh:buys': function () { purchaseListModal(); },
        'smv:recv': function (id) { receiveMovement(id); },
        'mat:open': function (id) { materialModal(id); },
        'mat:edit': function (id) { materialFormModal(id); },
        'mat:count': function (id) { materialCountModal(id); },
        'mat:buy': function (id) { purchaseEntry(id); },
        'mat:buys': function () { purchaseListModal(); },
        'ap:open': gotoPayable
    };

    /* ---------- CSV 导出 ---------- */

    function csvCell(v) {
        var s = v == null ? '' : String(v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }

    function toCsv(cols, rows) {
        var head = cols.map(function (c) { return csvCell(c.label); }).join(',');
        var body = rows.map(function (r) {
            return cols.map(function (c) {
                var v = c.value ? c.value(r) : r[c.key];
                return csvCell(v == null ? '' : v);
            }).join(',');
        });
        return [head].concat(body).join('\n');
    }

    function download(name, text) {
        var blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
        var a = document.createElement('a');
        a.href = global.URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        ui.toast('已导出 ' + name + '（' + text.split('\n').length + ' 行）', 'success');
    }

    /* 取当前列表页的全量结果（不是本页）导出：state 已在最近一次 render 里落好筛选条件 */
    function exportGrid(o, pageId) {
        var ctx = curCtx();
        if (pageId) ctx.pageId = pageId;
        var state = ui.state(ctx.pageId), fs = pg.filtersOf(state);
        var rows = (o.rows || []).slice();
        if (o.filter) rows = rows.filter(function (r) { return o.filter(r, fs, state); });
        var q = String(fs[o.searchKey || 'q'] || '').trim().toLowerCase();
        if (q && o.search) rows = rows.filter(function (r) { return String(o.search(r) || '').toLowerCase().indexOf(q) > -1; });
        if (!rows.length) { ui.toast('当前筛选没有数据', 'warn'); return; }
        download(o.name || (ctx.pageId + '.csv'), toCsv(o.cols, rows));
    }

    /* ---------- 一、运营总览 ---------- */

    pg.define('overview', {
        sub: '订单 · 财务 · 时效 · 异常四张脸的同一时刻快照，时间窗在顶栏切换',
        load: function (ctx) {
            var days = ctx.days;
            return {
                days: days,
                ov: TMS.stats.overview(days),
                trend: TMS.stats.orderTrend(days),
                timing: TMS.stats.timingStats(days),
                ranks: TMS.stats.customerRanking(8),
                alerts: util.sortBy(db.col('alerts').filter(function (a) { return a.status === 'open'; }), 'lastAt', 'desc').slice(0, 8),
                orders: TMS.stats.ordersWithin(days),
                trips: TMS.operation.tripStats(days),
                ledger: TMS.finance.financeSummary()
            };
        },
        render: function (ctx, d) {
            var ov = d.ov, ts = d.trips;
            var byStatus = util.countBy(d.orders, 'status');
            var donut = cfg.orderFlow.map(function (s) {
                return { label: cfg.orderLabels[s], value: byStatus[s] || 0 };
            }).concat([
                { label: cfg.orderLabels.problem, value: byStatus.problem || 0 },
                { label: cfg.orderLabels.returned, value: byStatus.returned || 0 },
                { label: cfg.orderLabels.cancelled, value: byStatus.cancelled || 0 }
            ]).filter(function (x) { return x.value; });

            var kpi = ui.kpis([
                { label: d.days + ' 日订单', value: fmt.number(ov.orders), unit: '单', tone: 'brand', icon: '▦', sub: '全库 ' + fmt.number(ov.totalOrders) + ' 单' },
                { label: '签收收入', value: fmt.money(ov.revenue), tone: 'success', icon: '¥', sub: '成本 ' + fmt.money(ov.cost) },
                { label: '毛利率', value: ov.margin, unit: '%', tone: ov.margin >= 25 ? 'success' : 'warn', icon: '％', sub: '账面净利 ' + fmt.money(d.ledger.profit) },
                { label: '签收及时率', value: ov.onTimeRate, unit: '%', tone: ov.onTimeRate >= 92 ? 'success' : 'danger', icon: '◷', sub: '超时签收 ' + (ov.signed - Math.round(ov.signed * ov.onTimeRate / 100)) + ' 单' },
                { label: '在途积压', value: fmt.number(ov.backlog), unit: '单', tone: ov.overdue ? 'warn' : 'muted', icon: '⛴', sub: '已超承诺 ' + ov.overdue + ' 单' },
                { label: '未闭环异常', value: ov.openExceptions, unit: '张', tone: ov.openExceptions > 3 ? 'danger' : 'muted', icon: '⚠', sub: '全库异常率 ' + ov.exceptionRate + '%' },
                { label: '应收未收', value: fmt.money(ov.receivable.pending), tone: ov.receivable.overdue > 0 ? 'danger' : 'info', icon: '↗', sub: '逾期 ' + fmt.money(ov.receivable.overdue) + ' / ' + ov.receivable.overdueCount + ' 笔' },
                { label: '代收货待上划', value: fmt.money(ov.cod.pendingRemit), tone: 'warn', icon: '↧', sub: ov.cod.pendingCount + ' 笔未清' }
            ]);

            var trendCard = ui.card({
                title: '业务与收入趋势', sub: '柱：签收收入 · 线：下单量（' + d.days + ' 日）', flat: true,
                body: ch.combo({
                    labels: d.trend.map(function (x) { return x.label; }),
                    bars: d.trend.map(function (x) { return x.revenue; }),
                    line: d.trend.map(function (x) { return x.orders; }),
                    barName: '收入', lineName: '订单', height: 260,
                    fmt: function (v) { return fmt.money(v); }
                })
            });

            var mixCard = ui.card({
                title: '订单结构', sub: '按主状态分布，切片可直接读单量', flat: true,
                body: ch.donut({
                    data: donut, height: 250, center: { label: d.days + ' 日订单', value: fmt.number(ov.orders) },
                    fmt: function (v) { return v + ' 单'; }
                })
            });

            var timingCard = ui.card({
                title: '履约时效', sub: '承诺口径 = 路由标准工时 + 服务加成', flat: true,
                body: ch.gauge({ value: ov.onTimeRate, height: 150, okAt: 92, warnAt: 80, label: '签收及时率', tone: ov.onTimeRate >= 92 ? undefined : (ov.onTimeRate >= 80 ? 'warn' : 'danger') }) +
                    ui.desc([
                        { label: '平均全链路', value: fmt.duration(ov.avgHours) },
                        { label: '标准承诺', value: fmt.duration(d.timing.promisedHours) },
                        { label: '超时效在途', value: ov.overdue ? '<span class="tms-badge tone-danger">' + ov.overdue + ' 单</span>' : '<span class="tms-badge tone-success">无</span>' },
                        { label: '扫描留痕', value: fmt.number(ov.scanCount) + ' 条 / 单均 ' + ov.scanRate + ' 条' }
                    ], { inline: true })
            });

            var transportCard = ui.card({
                title: '运输执行', sub: '自有整车与外协零担的成本择优结果', flat: true,
                body: ui.split('2', [
                    ui.stack([
                        ui.kv('车次总数', ts.total + ' 班'),
                        ui.kv('自有 / 外协', ts.self + ' / ' + ts.ltl),
                        ui.kv('平均装载率', pctBar(ts.avgLoadRate, { okAt: 55, warnAt: 80 })),
                        ui.kv('在途 / 已到', ts.departed + ' / ' + ts.arrived)
                    ]),
                    ui.stack([
                        ui.kv('承运重量', fmt.kg(ts.weight)),
                        ui.kv('累计里程', fmt.km(ts.km)),
                        ui.kv('单公斤干线成本', fmt.money(ts.costPerKg)),
                        ui.kv('班次准点率', fmt.percent(ts.onTimeRate))
                    ])
                ])
            });

            var alertCard = ui.card({
                title: '未闭环告警', sub: 'SLA 巡检自动登记，点击确认即关闭', flat: true,
                tools: ui.btn('巡检一轮', { size: 'sm', act: 'ov:sweep', icon: '⟳' }),
                body: d.alerts.length ? ui.list(d.alerts.map(function (a) {
                    return {
                        title: ui.badge(a.level === 'danger' ? '严重' : a.level === 'error' ? '严重' : '警告',
                            a.level === 'danger' || a.level === 'error' ? 'danger' : 'warn') + ' ' + esc(a.title),
                        sub: esc(a.message) + ' · ' + esc(a.owner || '') + ' · 最近 ' + fmt.dateTime(a.lastAt) + ' · 命中 ' + (a.hitCount || 1) + ' 次',
                        act: 'ov:alert', arg: a.key,
                        right: a.refId ? ui.link(esc(db.meta(a.entity || '').label || '详情'), 'alert:goto', a.entity + '|' + a.refId) : ''
                    };
                })) : ui.empty('暂无未闭环告警', '巡检每 12 分钟自动跑一轮：超时、滞留、逾期、设备与库存', '✓')
            });

            var rankCard = ui.card({
                title: '客户贡献 TOP', sub: '收入、毛利与未收风险并列看', flat: true,
                body: ui.table({
                    dense: true, zebra: true,
                    columns: [
                        { key: 'name', label: '客户', render: function (r) { return ui.link(esc(r.name), 'cust:open', r.id) + ' ' + ui.badge(r.level, 'info'); } },
                        { key: 'orders', label: '单量', align: 'right' },
                        { key: 'revenue', label: '收入', align: 'right', render: function (r) { return ui.moneyCell(r.revenue); } },
                        { key: 'margin', label: '毛利率', align: 'right', render: function (r) { return fmt.percent(r.margin); } },
                        { key: 'arPending', label: '未收', align: 'right', render: function (r) { return r.overdue ? '<span class="tms-badge tone-danger">' + fmt.money(r.overdue) + '</span>' : ui.moneyCell(r.arPending, {}); } }
                    ],
                    rows: d.ranks
                })
            });

            return wrap(ctx, {
                sub: '建库于 ' + fmt.dateTime(db.load().seededAt) + ' · 库容量 ' + (db.info().bytes / 1048576).toFixed(2) + ' MB',
                actions: ui.btn('导出运营简报', { size: 'sm', act: 'ov:export', icon: '⤓' }),
                body: [kpi, ui.split('2', [trendCard, ui.stack([mixCard, timingCard])]),
                ui.split('2', [transportCard, alertCard]),
                ui.split('2', [rankCard, grossCard(d)])]
            });
        },
        actions: merge(custActions, {
            'ov:sweep': function () {
                var r = TMS.jobs.sweep(true);
                ui.toast('巡检完成：' + (r.jobs || []).length + ' 项任务，当前未闭环告警 ' + r.alerts + ' 条', 'success');
            },
            'ov:alert': function (key) {
                TMS.jobs.closeAlert(key, (TMS.auth.current() || {}).name + ' 于仪表盘确认');
                ui.toast('告警已确认', 'success');
            },
            'ov:export': function () {
                var ov = pg.get('overview').load(curCtx()).ov || {};
                download('运营简报-' + util.dateKey(util.now()) + '.csv', toCsv([
                    { label: '指标', key: 'k' }, { label: '数值', key: 'v' }
                ], [
                    { k: '统计窗口(天)', v: ov.days }, { k: '订单量', v: ov.orders },
                    { k: '签收量', v: ov.signed }, { k: '签收收入', v: ov.revenue },
                    { k: '履约成本', v: ov.cost }, { k: '毛利率(%)', v: ov.margin },
                    { k: '签收及时率(%)', v: ov.onTimeRate }, { k: '在途积压', v: ov.backlog },
                    { k: '超时订单', v: ov.overdue }, { k: '未闭环异常', v: ov.openExceptions },
                    { k: '应收未收', v: ov.receivable && ov.receivable.pending },
                    { k: '应收逾期', v: ov.receivable && ov.receivable.overdue },
                    { k: '代收待上划', v: ov.cod && ov.cod.pendingRemit },
                    { k: '车次单公斤成本', v: ov.trips && ov.trips.costPerKg }
                ]));
            }
        }),
        afterRender: function (ctx) { pg.deepLink(ctx); }
    });

    /* 毛利率结构卡：总收入-总成本-毛利额，配大区横向对比 */
    function grossCard(d) {
        var g = d.ov.gross || {};
        return ui.card({
            title: '毛利结构', sub: '按始发大区拆解（已签收单，成本含干线/中转/两端作业/间接）', flat: true,
            body: ui.stack([
                ui.meter((g.byZone || []).slice(0, 6).map(function (z, i) {
                    return { value: Math.max(0, z.revenue - z.cost), color: ch.color(i) };
                })),
                ch.hbars({
                    data: (g.byZone || []).map(function (z) { return { label: z.label, value: z.margin }; }),
                    rowH: 26, labelWidth: 96, valueWidth: 70,
                    fmt: function (v) { return fmt.percent(v); }
                }),
                ui.desc([
                    { label: '收入合计', value: ui.moneyCell(g.revenue, { strong: true }) },
                    { label: '成本合计', value: ui.moneyCell(g.cost) },
                    { label: '毛利', value: '<span class="tms-money strong">' + fmt.money(g.profit) + '</span>（' + fmt.percent(g.margin) + '）' },
                    { label: '单票均值', value: '运费 ' + fmt.money(g.avgFreight) + ' / 成本 ' + fmt.money(g.avgCost) }
                ], { inline: true })
            ])
        });
    }

    /* ---------- 二、经营报表 ---------- */

    pg.define('operation', {
        sub: '收入-成本-利润三张表：账本口径与单据口径并列，差异可追到每一票',
        load: function (ctx) {
            var days = ctx.days;
            return {
                trend: TMS.finance.financeTrend(30),
                ledger: TMS.finance.financeSummary(),
                gross: TMS.finance.grossAnalysis(),
                ranks: TMS.stats.customerRanking(20),
                byService: TMS.stats.breakdown('service', 30),
                byPayment: TMS.stats.breakdown('paymentMethod', 30),
                byChannel: TMS.stats.breakdown('channel', 30),
                ov: TMS.stats.overview(days),
                period: util.monthKey(util.now())
            };
        },
        render: function (ctx, d) {
            var g = d.gross, led = d.ledger;
            var signed = db.col('orders').filter(function (o) { return o.status === 'signed'; });
            var kgTot = util.round(util.sum(signed.filter(function (o) { return o.cost; }), 'chargeableWeight'), 1);

            var pnl = ui.card({
                title: '损益表（当月账本）', sub: '流水口径：' + d.period + ' · 只计已确认收入与已入账支出', flat: true,
                body: ui.table({
                    dense: true, zebra: true,
                    columns: [
                        { key: 'label', label: '科目', render: function (r) { return esc(r.label); } },
                        { key: 'income', label: '收入', align: 'right', render: function (r) { return r.income ? ui.moneyCell(r.income) : '<span class="tms-dim">—</span>'; } },
                        { key: 'expense', label: '支出', align: 'right', render: function (r) { return r.expense ? ui.moneyCell(r.expense) : '<span class="tms-dim">—</span>'; } },
                        {
                            key: 'net', label: '净额', align: 'right', render: function (r) {
                                var net = util.round((r.income || 0) - (r.expense || 0), 2);
                                return '<span class="tms-money' + (net < 0 ? ' tone-danger' : '') + '">' + fmt.money(net) + '</span>';
                            }
                        },
                        {
                            key: 'share', label: '占收入', align: 'right', render: function (r) {
                                return led.income ? fmt.percent(util.round(((r.income || 0) + (r.expense || 0)) / led.income * 100, 1)) : '—';
                            }
                        }
                    ],
                    rows: led.byCategory
                }),
                foot: ui.kv('当期净利', '<span class="tms-money strong">' + fmt.money(led.profit) + '</span> · 毛利率 ' + fmt.percent(led.margin) +
                    (led.pendingIncome ? ' · 待确认收入 ' + fmt.money(led.pendingIncome) : ''), { total: true })
            });

            var trendCard = ui.card({
                title: '收支走势（30 日）', sub: '账本流水按日聚合，收入含运费/增值，支出含干线/末端/理赔', flat: true,
                body: ch.line({
                    labels: d.trend.map(function (x) { return x.label; }),
                    series: [
                        { name: '收入', data: d.trend.map(function (x) { return x.income; }) },
                        { name: '支出', data: d.trend.map(function (x) { return x.expense; }) }
                    ],
                    height: 260, fmt: function (v) { return fmt.money(v); }
                })
            });

            function dimCard(title, sub, rows, keyName) {
                return ui.card({
                    title: title, sub: sub, flat: true,
                    body: ui.table({
                        dense: true,
                        columns: [
                            { key: 'label', label: keyName || '维度' },
                            { key: 'orders', label: '单量', align: 'right' },
                            { key: 'signed', label: '签收', align: 'right' },
                            { key: 'revenue', label: '收入', align: 'right', render: function (r) { return ui.moneyCell(r.revenue); } },
                            { key: 'weight', label: '计费重', align: 'right', render: function (r) { return fmt.kg(r.weight); } },
                            {
                                key: 'margin', label: '毛利率', align: 'right', render: function (r) {
                                    return ui.badge(fmt.percent(r.margin), r.margin >= 25 ? 'success' : r.margin >= 15 ? 'warn' : 'danger');
                                }
                            }
                        ],
                        rows: rows
                    })
                });
            }

            var worst = ui.card({
                title: '亏损单与低毛利单', sub: '成本按车次实际分摊，负毛利多为低装载车次或长距小件', flat: true,
                body: ui.table({
                    dense: true,
                    columns: [
                        { key: 'waybillNo', label: '运单号', render: function (r) { return idLink(r.id); } },
                        { key: 'customer', label: '客户' },
                        { key: 'origin', label: '线路', render: function (r) { return esc(r.origin) + ' → ' + esc(r.destination); } },
                        { key: 'service', label: '服务' },
                        { key: 'weight', label: '计费重', align: 'right', render: function (r) { return fmt.kg(r.weight); } },
                        { key: 'freight', label: '运费', align: 'right', render: function (r) { return ui.moneyCell(r.freight); } },
                        { key: 'cost', label: '成本', align: 'right', render: function (r) { return ui.moneyCell(r.cost); } },
                        {
                            key: 'margin', label: '毛利率', align: 'right', render: function (r) {
                                return '<span class="' + (r.margin < 0 ? 'tms-badge tone-danger' : 'tms-dim') + '">' + fmt.percent(r.margin) + '</span>';
                            }
                        }
                    ],
                    rows: g.worst
                })
            });

            var costStruct = ui.card({
                title: '单票成本构成', sub: '全成本 = 干线 + 中转装卸 + 揽收 + 分拣 + 派送 + 包材 + 间接', flat: true,
                body: (function () {
                    var rows = signed.slice(0, 200).map(function (o) { return TMS.pricing.costOf(o); });
                    var keys = [['lh', '干线运输'], ['hd', '中转装卸'], ['cl', '上门揽收'], ['sc', '分拣操作'], ['dl', '末端派送'], ['pk', '包装材料'], ['oh', '间接分摊']];
                    var parts = keys.map(function (k, i) {
                        return { label: k[1], value: util.round(util.sum(rows, k[0]) / Math.max(1, rows.length), 2), color: ch.color(i) };
                    });
                    var tot = util.sum(parts, 'value');
                    return ch.hbars({
                        data: parts, rowH: 30, labelWidth: 108, valueWidth: 92,
                        fmt: function (v) { return fmt.money(v) + ' · ' + fmt.percent(util.round(v / (tot || 1) * 100, 1)); }
                    }) + ui.notice('单票全成本 ' + fmt.money(tot) + '，均运费 ' + fmt.money(g.avgFreight || 0) +
                        '，商务托底要求不低于成本 ×1.2', 'info');
                })()
            });

            return wrap(ctx, {
                actions: ui.btn('导出经营报表', { size: 'sm', act: 'rp:export', icon: '⤓' }) +
                    ui.btn('计提期间费用', { size: 'sm', act: 'rp:accrue', icon: '✓' }),
                body: [
                    ui.kpis([
                        { label: '账本收入', value: fmt.money(led.income), tone: 'success', sub: '流水 ' + db.col('finances').length + ' 条' },
                        { label: '账本支出', value: fmt.money(led.expense), tone: 'danger' },
                        { label: '当期净利', value: fmt.money(led.profit), tone: led.profit >= 0 ? 'brand' : 'danger', sub: '净利率 ' + fmt.percent(led.margin) },
                        { label: '单据毛利', value: fmt.money(g.profit), tone: 'info', sub: '毛利率 ' + fmt.percent(g.margin) + '（已签收 ' + g.orders + ' 单）' },
                        { label: '单票运费', value: fmt.money(g.avgFreight), sub: '单票成本 ' + fmt.money(g.avgCost) },
                        { label: '单公斤收入', value: fmt.money(kgTot ? util.round(g.revenue / kgTot, 2) : 0), sub: '均计费重 ' + fmt.kg(g.orders ? util.round(kgTot / g.orders, 1) : 0) }
                    ]),
                    ui.split('side', [trendCard, pnl]),
                    ui.split('2', [dimCard('按服务层级', '加急/冷链溢价能否覆盖成本', d.byService, '服务'), dimCard('按付款方式', '到付占用现金流，月结沉淀应收', d.byPayment, '付款')]),
                    ui.split('2', [costStruct, worst]),
                    ui.card({
                        title: '客户经营榜', sub: '收入、毛利、未收与异常并列，用于商务复盘', flat: true,
                        body: grid(ctx, {
                            rows: d.ranks, keyName: 'id', onRow: 'cust:open',
                            search: function (r) { return r.name + ' ' + r.city + ' ' + r.industry; },
                            fields: [
                                { key: 'q', type: 'search', label: '客户 / 城市 / 行业' },
                                { key: 'level', label: '等级', options: [{ value: '', label: '全部等级' }].concat(ui.optionsOf(cfg.customerLevels, 'level', 'level')) },
                                { key: 'cycle', label: '结算', options: [{ value: '', label: '全部账期' }].concat(ui.optionsOf(colUnique('customers', 'settleCycle'))) }
                            ],
                            filter: function (r, fs) {
                                if (fs.level && r.level !== fs.level) return false;
                                if (fs.cycle && r.settleCycle !== fs.cycle) return false;
                                return true;
                            },
                            unit: '位客户', pageSize: 10,
                            columns: [
                                { key: 'name', label: '客户', render: function (r, i) { return ui.rank(i + 1) + ' ' + esc(r.name) + ' ' + ui.badge(r.level, 'info'); } },
                                { key: 'city', label: '城市' },
                                { key: 'industry', label: '行业', render: function (r) { return dim(r.industry); } },
                                { key: 'orders', label: '单量', align: 'right' },
                                { key: 'revenue', label: '收入', align: 'right', render: function (r) { return ui.moneyCell(r.revenue); } },
                                { key: 'profit', label: '毛利', align: 'right', render: function (r) { return ui.moneyCell(r.profit); } },
                                { key: 'margin', label: '毛利率', align: 'right', render: function (r) { return fmt.percent(r.margin); } },
                                { key: 'arPending', label: '未收', align: 'right', render: function (r) { return ui.moneyCell(r.arPending); } },
                                { key: 'overdue', label: '逾期', align: 'right', render: function (r) { return r.overdue ? '<span class="tms-badge tone-danger">' + fmt.money(r.overdue) + '</span>' : '<span class="tms-dim">—</span>'; } },
                                { key: 'exceptions', label: '异常', align: 'right', render: function (r) { return r.exceptions ? ui.badge(r.exceptions + ' 起', 'warn') : '<span class="tms-dim">0</span>'; } }
                            ]
                        })
                    })
                ]
            });
        },
        actions: merge(custActions, {
            'rp:accrue': function () {
                var rows = TMS.finance.accruePeriodExpenses(util.monthKey(util.now()));
                ui.toast('期间费用计提完成：新增 ' + (rows && rows.length ? rows.length : 0) + ' 笔（场地/人力/系统按覆盖天数折算）', 'success');
            },
            'rp:export': function () {
                var led = TMS.finance.financeSummary();
                var rows = led.byCategory.map(function (c) {
                    return { label: c.label, income: c.income, expense: c.expense, net: util.round(c.income - c.expense, 2) };
                });
                download('经营报表-' + util.monthKey(util.now()) + '.csv',
                    toCsv([{ label: '科目', key: 'label' }, { label: '收入', key: 'income' }, { label: '支出', key: 'expense' }, { label: '净额', key: 'net' }], rows));
            }
        })
    });

    /* ---------- 三、时效监控 ---------- */

    pg.define('timing', {
        sub: '承诺达成与分段耗时：环节时间来自扫描流水，不是页面自己编的表',
        load: function (ctx) {
            var days = ctx.days;
            return {
                t: TMS.stats.timingStats(days),
                life: TMS.stats.lifecycleStats(days),
                orders: util.sortBy(db.col('orders').filter(function (o) { return !TMS.order.isTerminal(o); }), function (o) { return TMS.order.stuckHours(o); }, 'desc'),
                lateSigned: util.sortBy(db.col('orders').filter(function (o) { return o.status === 'signed' && TMS.order.isSignedLate(o); }), 'signedAt', 'desc'),
                days: days
            };
        },
        render: function (ctx, d) {
            var t = d.t;
            var backlog = d.orders.filter(function (o) { return TMS.order.isLate(o); });

            var segCard = ui.card({
                title: '分段耗时', sub: '均值为实际观测，P90 用于定位尾部卡点（' + d.days + ' 日已签收）', flat: true,
                body: ch.bars({
                    data: d.life.map(function (x) { return { label: x.label, value: x.avgHours, color: x.p90Hours > x.avgHours * 2 ? '#d98207' : undefined }; }),
                    height: 250, fmt: function (v) { return fmt.duration(v); }
                }) + ui.table({
                    dense: true,
                    columns: [
                        { key: 'label', label: '环节' },
                        { key: 'count', label: '样本', align: 'right', render: function (r) { return r.count + ' 单'; } },
                        { key: 'avgHours', label: '均值', align: 'right', render: function (r) { return fmt.duration(r.avgHours); } },
                        { key: 'p90Hours', label: 'P90', align: 'right', render: function (r) { return fmt.duration(r.p90Hours); } },
                        { key: 'maxHours', label: '最长', align: 'right', render: function (r) { return fmt.duration(r.maxHours); } },
                        {
                            key: 'tail', label: '尾部倍数', align: 'right', render: function (r) {
                                var x = r.avgHours ? util.round(r.maxHours / r.avgHours, 1) : 0;
                                return ui.badge('×' + x, x > 4 ? 'danger' : x > 2.5 ? 'warn' : 'muted');
                            }
                        }
                    ],
                    rows: d.life
                })
            });

            var dimTable = function (title, sub, rows) {
                return ui.card({
                    title: title, sub: sub, flat: true,
                    body: ui.table({
                        dense: true, zebra: true,
                        columns: [
                            { key: 'label', label: '维度' },
                            { key: 'count', label: '签收单', align: 'right' },
                            {
                                key: 'onTime', label: '及时率', render: function (r) {
                                    return rateBar(r.onTime, { target: 92 });
                                }
                            },
                            { key: 'avgHours', label: '实际均时', align: 'right', render: function (r) { return fmt.duration(r.avgHours); } }
                        ],
                        rows: rows
                    })
                });
            };

            var breachCard = ui.card({
                title: '已超承诺在途单', sub: '滞留时长 = 距上一次作业留痕；优先处理 TOP 与超时最久', flat: true,
                tools: ui.btn('导出', { size: 'sm', act: 'tm:export' }),
                body: grid(ctx, {
                    rows: d.orders.map(TMS.order.view),
                    onRow: 'order:open', searchKey: 'q',
                    search: function (r) { return [r.id, r.waybillNo, r.customer, r.goods, r.destination].join(' '); },
                    filter: function (r, fs) {
                        if (fs.only === 'late' && !TMS.order.isLate(r)) return false;
                        if (fs.zone && r.originZone !== fs.zone) return false;
                        if (fs.status && r.status !== fs.status) return false;
                        return true;
                    },
                    fields: [
                        { key: 'q', type: 'search', label: '单号 / 客户 / 目的地' },
                        { key: 'only', label: '只看超时', options: [{ value: '', label: '全部在途' }, { value: 'late', label: '仅超承诺' }] },
                        { key: 'status', label: '环节', options: [{ value: '', label: '全部环节' }].concat(cfg.orderFlow.slice(1, 7).map(function (s) { return { value: s, label: cfg.orderLabels[s] }; })) },
                        { key: 'zone', label: '始发大区', options: [{ value: '', label: '全部大区' }].concat(ui.optionsOf(TMS.master.ZONES)) }
                    ],
                    unit: '单', pageSize: 10,
                    valueOf: function (r, k) {
                        if (k === 'stuck') return TMS.order.stuckHours(r);
                        if (k === 'lateRate') return util.hoursBetween(TMS.order.promiseOf(r), util.now());
                        return r[k];
                    },
                    columns: [
                        { key: 'id', label: '运单号', render: function (r) { return '<span class="tms-mono">' + esc(r.waybillNo) + '</span>'; } },
                        { key: 'customer', label: '客户', render: function (r) { return esc(r.customer) + ' ' + ui.badge(r.customerLevel, 'info'); } },
                        { key: 'origin', label: '线路', render: function (r) { return esc(r.origin) + ' → ' + esc(r.destination); } },
                        { key: 'status', label: '当前环节', render: function (r) { return ui.statusBadge(r.status); } },
                        { key: 'expectedAt', label: '承诺时效', render: function (r) { return '<span class="tms-nowrap">' + fmt.dateTime(r.expectedAt) + '</span>'; } },
                        { key: 'stuck', label: '滞留', align: 'right', render: function (r) { return fmt.duration(TMS.order.stuckHours(r)); } },
                        {
                            key: 'lateRate', label: '超承诺', align: 'right', render: function (r) {
                                var h = util.hoursBetween(TMS.order.promiseOf(r), util.now());
                                return TMS.order.isLate(r) ? '<span class="tms-badge tone-danger">超 ' + util.round(h, 1) + 'h</span>' : '<span class="tms-dim">未超</span>';
                            }
                        },
                        { key: 'scanCount', label: '留痕', align: 'right', render: function (r) { return r.scanCount + ' 次'; } },
                        { key: 'courier', label: '派送员', render: function (r) { return dim(r.courier); } }
                    ]
                })
            });

            return wrap(ctx, {
                body: [
                    ui.kpis([
                        { label: '签收及时率', value: t.onTimeRate, unit: '%', tone: t.onTimeRate >= 92 ? 'success' : 'warn', icon: '◷', sub: '超时签收 ' + t.late + ' / ' + t.signed + ' 单' },
                        { label: '实际均时', value: fmt.duration(t.avgHours), tone: 'brand', sub: '承诺 ' + fmt.duration(t.promisedHours) },
                        { label: '超承诺在途', value: t.slaBreaching, unit: '单', tone: t.slaBreaching ? 'danger' : 'success' },
                        { label: '最长滞留', value: d.orders.length ? fmt.duration(TMS.order.stuckHours(d.orders[0])) : '—', sub: d.orders.length ? esc(TMS.order.customerName(d.orders[0])) : '无在途单' }
                    ]),
                    ui.split('2', [segCard, ui.stack([
                        ui.card({
                            title: '承诺达成', sub: '扇形越大越接近目标 92%', flat: true,
                            body: ch.gauge({ value: t.onTimeRate, height: 160, okAt: 92, warnAt: 80, label: '签收及时率' })
                        }),
                        dimCard2(t)
                    ])]),
                    ui.split('2', [dimTable('按服务层级', '加急件时效最敏感，均值差距即产品风险', t.byService), dimTable('按目的大区', '同大区内部线路不含干线', t.byZone)]),
                    breachCard,
                    ui.card({
                        title: '超时签收复盘', sub: '已签收但超出承诺：用于理赔与责任认定', flat: true,
                        body: d.lateSigned.length ? ui.list(d.lateSigned.slice(0, 10).map(function (o) {
                            var v = TMS.order.view(o);
                            var over = util.round(util.hoursBetween(TMS.order.promiseOf(o), o.signedAt), 1);
                            return {
                                title: '<span class="tms-mono">' + esc(o.waybillNo) + '</span> ' + ui.badge('超 ' + over + ' 小时', 'danger'),
                                sub: esc(v.customer) + ' · ' + esc(o.origin) + ' → ' + esc(o.destination) + ' · 承诺 ' +
                                    fmt.dateTime(v.expectedAt) + ' · 实际 ' + fmt.dateTime(o.signedAt) + ' · 派送 ' + esc(o.courier || '—'),
                                act: 'order:open', arg: o.id,
                                right: '<div class="tms-dim">' + fmt.money(o.freight) + '</div>'
                            };
                        })) : ui.empty('当期没有超时签收', '时效表现良好', '✓')
                    })
                ]
            });
        },
        actions: {
            'tm:export': function () {
                var rows = db.col('orders').filter(function (o) { return !TMS.order.isTerminal(o); }).map(TMS.order.view);
                exportGrid({
                    rows: rows, name: '时效监控-' + util.dateKey(util.now()) + '.csv',
                    search: function (r) { return [r.id, r.waybillNo, r.customer, r.goods, r.destination].join(' '); },
                    filter: function (r, fs) {
                        if (fs.only === 'late' && !TMS.order.isLate(r)) return false;
                        if (fs.zone && r.originZone !== fs.zone) return false;
                        if (fs.status && r.status !== fs.status) return false;
                        return true;
                    },
                    cols: [
                        { label: '运单号', key: 'waybillNo' }, { label: '客户', key: 'customer' },
                        { label: '始发', key: 'origin' }, { label: '目的', key: 'destination' },
                        { label: '环节', value: function (r) { return cfg.orderLabels[r.status]; } },
                        { label: '承诺时效', key: 'expectedAt' },
                        { label: '滞留小时', value: function (r) { return TMS.order.stuckHours(r); } },
                        { label: '派送员', key: 'courier' }
                    ]
                });
            }
        }
    });

    function dimCard2(t) {
        var gap = util.round(t.avgHours - t.promisedHours, 1);
        return ui.card({
            title: '承诺 vs 实际', sub: '差值为正即整体慢于承诺', flat: true,
            body: ch.compare({
                data: [
                    { label: '承诺时效', value: t.promisedHours, target: t.promisedHours, text: fmt.duration(t.promisedHours) },
                    { label: '实际时效', value: t.avgHours, target: t.promisedHours, text: fmt.duration(t.avgHours) }
                ], rowH: 34
            }) + ui.notice(gap > 0
                ? '整体慢于承诺 ' + fmt.duration(gap) + '，主要卡点在干线在途与末端派送'
                : '整体快于承诺 ' + fmt.duration(Math.abs(gap)) + '，时效余量可作为加急产品卖点',
                gap > 0 ? 'warn' : 'success')
        });
    }

    /* ---------- 四、系统监控 ---------- */

    pg.define('monitor', {
        sub: '存储容量 · 定时巡检 · 扫描终端 · 告警台账 · 审计链，运维视角看这一个页面就够了',
        load: function () {
            var info = db.info();
            return {
                s: TMS.stats.systemStats(),
                info: info,
                collections: Object.keys(info.rows).filter(function (k) { return info.rows[k]; })
                    .sort(function (a, b) { return info.rows[b] - info.rows[a]; })
                    .map(function (k) { return { name: k, label: db.meta(k).label || k, rows: info.rows[k], rev: db.rev(k) }; }),
                alerts: util.sortBy(db.col('alerts'), 'lastAt', 'desc').slice(0, 30),
                jobs: db.load().lastSweepAt,
                verify: TMS.audit.verify(),
                devices: db.col('devices')
            };
        },
        render: function (ctx, d) {
            var s = d.s, soft = cfg.storage.softLimitBytes, hard = cfg.storage.hardLimitBytes;
            var usedPct = util.round(s.dbBytes / hard * 100, 1);
            var archived = db.archiveStats();

            var storageCard = ui.card({
                title: '存储与容量治理', sub: '唯一稀缺资源是 localStorage 配额，超出即按天裁剪流水、再按优先级归档', flat: true,
                tools: ui.btn('重建演示数据', { size: 'sm', tone: 'danger', act: 'shell:rebuild' }) + ui.btn('导出全库', { size: 'sm', act: 'shell:export' }),
                body: ui.stack([
                    ui.progress(s.dbBytes / 1048576, { max: hard / 1048576, thin: true }),
                    ui.desc([
                        { label: '库容量', value: (s.dbBytes / 1048576).toFixed(2) + ' MB / 硬阈 ' + (hard / 1048576).toFixed(1) + ' MB（' + usedPct + '%）' },
                        { label: '软阈值', value: (soft / 1048576).toFixed(1) + ' MB，超过则先裁剪流水表最旧记录' },
                        { label: '总行数', value: fmt.number(d.info.total) + ' 行 · schema v' + d.info.schema },
                        { label: '序列计数器', value: s.counters + ' 个（当日单据流水号）' },
                        { label: '归档情况', value: archived.length ? archived.map(function (a) { return (db.meta(a.name).label || a.name) + ' ' + a.count + ' 行'; }).join('、') : '<span class="tms-badge tone-success">未触发归档</span>' },
                        { label: '建库时间', value: fmt.dateTime(s.seededAt) }
                    ], { inline: true }),
                    ui.table({
                        dense: true,
                        columns: [
                            { key: 'label', label: '集合', render: function (r) { return esc(r.label) + ' <span class="tms-dim tms-mono">' + esc(r.name) + '</span>'; } },
                            { key: 'rows', label: '行数', align: 'right', render: function (r) { return fmt.number(r.rows); } },
                            { key: 'pct', label: '占比', align: 'right', render: function (r) { return fmt.percent(util.round(r.rows / Math.max(1, d.info.total) * 100, 1)); } },
                            { key: 'rev', label: '修订次数', align: 'right', render: function (r) { return r.rev ? ui.badge(r.rev + ' 次', 'info') : '<span class="tms-dim">—</span>'; } },
                            { key: 'trim', label: '保留窗口', align: 'right', render: function (r) { return db.meta(r.name).trim ? db.meta(r.name).trim + ' 天' : '<span class="tms-dim">全量</span>'; } }
                        ],
                        rows: d.collections.slice(0, 12)
                    })
                ])
            });

            var jobCard = ui.card({
                title: '定时巡检任务', sub: '真实系统里这些是 crontab；演示环境在每次进入页面时按时间窗补跑', flat: true,
                tools: ui.btn('立即全量巡检', { size: 'sm', act: 'mo:sweep', icon: '⟳' }),
                body: ui.table({
                    dense: true, zebra: true,
                    columns: [
                        { key: 'name', label: '任务' },
                        { key: 'key', label: '标识', render: function (r) { return '<span class="tms-mono tms-dim">' + esc(r.key) + '</span>'; } },
                        { key: 'act', label: '动作', align: 'right', render: function (r) { return ui.link('单独执行', 'mo:job', r.key); } }
                    ],
                    rows: TMS.jobs.RULES
                }),
                foot: '<span class="tms-dim">上次巡检 ' + (d.jobs ? fmt.dateTime(d.jobs) : '尚未执行') + '</span>'
            });

            var deviceCard = ui.card({
                title: '扫描终端健康', sub: 'PDA / 固定扫描门 / 高拍仪：离线超 12 小时即登记告警', flat: true,
                body: ui.split('2', [
                    ui.stack([
                        ui.kpis([
                            { label: '终端总数', value: s.devices.total, tone: 'brand' },
                            { label: '在线', value: s.devices.online, tone: 'success' },
                            { label: '故障', value: s.devices.fault, tone: s.devices.fault ? 'danger' : 'muted' },
                            { label: '低电量', value: s.devices.lowBattery, tone: s.devices.lowBattery ? 'warn' : 'muted' }
                        ]),
                        ui.table({
                            dense: true,
                            columns: [
                                { key: 'label', label: '终端', render: function (r) { return esc(r.label); } },
                                { key: 'count', label: '扫描量', align: 'right', render: function (r) { return fmt.number(r.count); } },
                                { key: 'errors', label: '异常', align: 'right', render: function (r) { return r.errors ? ui.badge(r.errors + ' 次', 'warn') : '<span class="tms-dim">0</span>'; } }
                            ],
                            rows: TMS.stats.scanStats(ctx.days).byDevice.slice(0, 8)
                        })
                    ]),
                    ui.card({
                        title: '最久未同步', sub: '按最后同步时间升序', flat: true,
                        body: ui.list(s.idleDevices.map(function (x) {
                            return {
                                title: esc(x.name) + ' ' + pg.statusBadge(x.status),
                                sub: esc(x.model) + ' · ' + esc(x.ownerName || '未分配') + ' · 最后同步 ' + fmt.dateTime(x.lastSyncAt),
                                act: 'mo:device', arg: x.id
                            };
                        }))
                    })
                ])
            });

            var alertCard = ui.card({
                title: '告警台账', sub: '去重累计命中次数，确认即关闭', flat: true,
                tools: ui.btn('全部确认', { size: 'sm', act: 'alert:readAll' }),
                body: grid(ctx, {
                    rows: d.alerts, keyName: 'key',
                    search: function (r) { return r.title + ' ' + r.message + ' ' + r.owner; },
                    filter: function (r, fs) {
                        if (fs.status && r.status !== fs.status) return false;
                        if (fs.level && r.level !== fs.level) return false;
                        if (fs.category && r.category !== fs.category) return false;
                        return true;
                    },
                    fields: [
                        { key: 'q', type: 'search', label: '标题 / 内容 / 责任人' },
                        { key: 'status', label: '状态', options: [{ value: '', label: '全部' }, { value: 'open', label: '未闭环' }, { value: 'resolved', label: '已确认' }] },
                        { key: 'level', label: '级别', options: [{ value: '', label: '全部' }, { value: 'danger', label: '严重' }, { value: 'warn', label: '警告' }, { value: 'info', label: '提示' }] },
                        { key: 'category', label: '类别', options: [{ value: '', label: '全部类别' }].concat(ui.optionsOf(colUnique('alerts', 'category'))) }
                    ],
                    unit: '条告警', pageSize: 8,
                    columns: [
                        { key: 'title', label: '告警', render: function (r) { return esc(r.title) + ' <span class="tms-dim">' + esc(r.message) + '</span>'; } },
                        { key: 'level', label: '级别', render: function (r) { return ui.badge(r.level === 'danger' ? '严重' : r.level === 'warn' ? '警告' : '提示', r.level === 'danger' ? 'danger' : r.level === 'warn' ? 'warn' : 'info'); } },
                        { key: 'category', label: '类别' },
                        { key: 'owner', label: '责任部门' },
                        { key: 'hitCount', label: '命中', align: 'right', render: function (r) { return (r.hitCount || 1) + ' 次'; } },
                        { key: 'lastAt', label: '最近', render: function (r) { return ui.timeCell(r.lastAt); } },
                        { key: 'status', label: '状态', render: function (r) { return statusBadge(r.status); } },
                        {
                            key: 'act', label: '操作', sortable: false, align: 'right', render: function (r) {
                                return r.status === 'open' ? ui.link('确认', 'alert:read', r.key) : '<span class="tms-dim">' + fmt.dateTime(r.resolvedAt) + '</span>';
                            }
                        }
                    ]
                })
            });

            return wrap(ctx, {
                body: [
                    ui.kpis([
                        { label: '库容量', value: (s.dbBytes / 1048576).toFixed(2), unit: 'MB', tone: s.dbBytes > soft ? 'danger' : 'success', icon: '▤', sub: '阈值占用 ' + usedPct + '%' },
                        { label: '数据行数', value: fmt.number(s.dbRows), tone: 'brand', sub: '其中轨迹 ' + fmt.number(db.col('scans').length) + ' 条' },
                        { label: '未闭环告警', value: s.alerts.open, unit: '条', tone: s.alerts.open ? 'warn' : 'success', icon: '⚠', sub: '累计 ' + s.alerts.total + ' 条' },
                        { label: '终端在线率', value: s.devices.total ? util.round(s.devices.online / s.devices.total * 100, 1) : 0, unit: '%', tone: 'info', sub: s.devices.fault + ' 台故障' },
                        { label: '审计日志', value: fmt.number(s.audit), sub: d.verify.ok ? '哈希链完整' : '<span class="tms-badge tone-danger">链断裂</span>' },
                        { label: '系统用户', value: s.users.total, sub: '活跃 ' + s.users.active + ' 个' }
                    ]),
                    storageCard,
                    ui.split('2', [jobCard, deviceCard]),
                    alertCard,
                    ui.card({
                        title: '审计链校验', sub: '每条日志带 prev + 内容哈希，事后改库必定露馅', flat: true,
                        tools: ui.btn('重新校验', { size: 'sm', act: 'mo:verify' }),
                        body: (d.verify.ok
                            ? ui.notice('全链 ' + d.verify.count + ' 条日志校验通过，锚点 ' + esc(db.load().auditAnchor || 'GENESIS'), 'success', '未被篡改')
                            : ui.notice('第 ' + d.verify.index + ' 条起断链：' + esc(d.verify.message), 'danger', '需要核查数据被外部修改的路径')) +
                            ui.list(db.col('auditLogs').slice(-6).reverse().map(function (l) {
                                return {
                                    title: '<span class="tms-mono tms-dim">' + esc(l.id) + '</span> ' + esc(TMS.audit.ACTIONS[l.action] || l.action),
                                    sub: esc(l.entity) + ' · ' + esc(l.refId || '—') + ' · ' + esc(l.detail || '') + ' · ' + esc(l.actor) + ' · ' + fmt.dateTime(l.at),
                                    right: '<span class="tms-dim tms-mono">' + esc(l.hash) + '</span>'
                                };
                            }))
                    })
                ]
            });
        },
        actions: {
            'mo:sweep': function () {
                var r = TMS.jobs.sweep(true);
                var errs = (r.jobs || []).filter(function (x) { return x.error; });
                ui.toast(errs.length ? '巡检有 ' + errs.length + ' 项异常：' + errs[0].error : '巡检完成，未闭环告警 ' + r.alerts + ' 条',
                    errs.length ? 'error' : 'success');
            },
            'mo:job': function (key) {
                var out = TMS.jobs.run(key);
                ui.toast(out.ok ? (out.name + '：' + describeJob(out.out)) : (out.message || '执行失败'), out.ok ? 'success' : 'error');
            },
            'mo:verify': function () {
                var v = TMS.audit.verify();
                ui.toast(v.ok ? ('审计链完整（' + v.count + ' 条）') : ('断链：' + v.message), v.ok ? 'success' : 'error');
            },
            'mo:device': function (id) { deviceModal(id); }
        }
    });

    function describeJob(out) {
        if (!out) return '无变更';
        var keys = Object.keys(out);
        if (!keys.length) return '无变更';
        return keys.map(function (k) {
            var v = out[k];
            return k + '=' + (Array.isArray(v) ? v.length : v);
        }).join('，');
    }

    /* 扫描终端档案（监控页与各角色端共用） */
    function deviceModal(id) {
        var dev = db.get('devices', id);
        if (!dev) { ui.toast('设备不存在', 'warn'); return; }
        var owner = dev.ownerId ? db.get('employees', dev.ownerId) : null;
        var scans = db.col('scans').filter(function (s) { return s.device === dev.name || s.deviceId === dev.id; });
        ui.modal({
            title: esc(dev.name), size: 'wide',
            sub: esc(dev.model) + ' · ' + esc(dev.serial || '') + ' · 归属 ' + esc(dev.ownerName || '未分配'),
            body: ui.split('2', [
                ui.card({
                    title: '终端档案', flat: true,
                    body: ui.desc([
                        { label: '设备编号', value: '<span class="tms-mono">' + esc(dev.id) + '</span>' },
                        { label: '型号', value: esc(dev.model) },
                        { label: '状态', value: statusBadge(dev.status) },
                        { label: '电量', value: ui.progress(dev.battery, { thin: true, tone: dev.battery >= 50 ? 'success' : (dev.battery >= 20 ? 'warn' : 'danger') }) + ' ' + dev.battery + '%' },
                        { label: '固件', value: esc(dev.firmware || '—') },
                        { label: '最后同步', value: fmt.dateTime(dev.lastSyncAt) },
                        { label: '30 日扫描', value: fmt.number(dev.scanCount30d || scans.length) },
                        { label: '异常率', value: fmt.percent(dev.errorRate || 0) },
                        { label: '持机人', value: owner ? esc(owner.name) + ' · ' + esc(owner.position || '') : dim(dev.ownerName) }
                    ])
                }),
                ui.card({
                    title: '最近扫描', sub: '按时间倒序 12 条', flat: true,
                    body: ui.list(scans.slice(-12).reverse().map(function (s) {
                        var o = db.get('orders', s.orderId) || {};
                        return {
                            title: esc(cfg.nodeOf(s.node).name) + ' ' + (s.result && s.result !== 'ok' ? ui.badge(esc(s.result), 'danger') : ''),
                            sub: '<span class="tms-mono">' + esc(o.waybillNo || s.orderId) + '</span> · ' + fmt.dateTime(s.opTime) + ' · ' + esc(s.location || ''),
                            act: s.orderId ? 'order:open' : '', arg: s.orderId
                        };
                    }))
                })
            ]),
            footer: ui.btn('关闭', { act: 'ui:close' })
        });
    }

    /* 客户档案弹窗在「经营报表」与「客户合同」两处都要用，放在这里共享 */
    function customerModal(id) {
        var c = db.get('customers', id);
        if (!c) { ui.toast('客户不存在', 'warn'); return; }
        var orders = db.col('orders').filter(function (o) { return o.customerId === c.id; });
        var signed = orders.filter(function (o) { return o.status === 'signed'; });
        var ar = db.col('receivables').filter(function (r) { return r.customerId === c.id; });
        var pending = ar.filter(function (r) { return r.status === 'pending'; });
        var overdueAmt = util.money(util.sum(pending.filter(function (r) { return util.toDate(r.dueDate) < util.now(); }), 'amount'));
        var points = TMS.people.pointsOf(c.id);
        ui.modal({
            title: esc(c.name), size: 'wide',
            sub: esc(c.levelName || '') + ' · ' + esc(c.city) + ' · ' + esc(c.industry || '') + ' · ' + esc(c.settleCycle || ''),
            body: ui.split('2', [
                ui.card({
                    title: '合同与信用', flat: true,
                    body: ui.desc([
                        { label: '客户编号', value: '<span class="tms-mono">' + esc(c.id) + '</span>' },
                        { label: '等级', value: ui.badge(c.level, 'info') + ' ' + esc(c.levelName || '') },
                        { label: '联系人', value: esc(c.contact || '—') + ' ' + esc(c.phone || '') },
                        { label: '合同期', value: fmt.date(c.contractFrom) + ' → ' + fmt.date(c.contractTo) },
                        { label: '折扣', value: fmt.percent(util.round((c.discountRate || 0) * 100, 1)) },
                        { label: '信用额度', value: fmt.money(c.creditLimit) + '（逾期 ' + fmt.money(overdueAmt) + '）' },
                        { label: '月均票量', value: fmt.number(c.monthlyVolume || 0) + ' 单' },
                        { label: '状态', value: statusBadge(c.status, CUSTOMER_TEXT) },
                        { label: '寄件地址', value: esc(c.senderAddress || '—') }
                    ])
                }),
                ui.card({
                    title: '经营表现', sub: '全生命周期，不受时间窗影响', flat: true,
                    body: ui.stack([
                        ui.kpis([
                            { label: '累计单量', value: fmt.number(orders.length) },
                            { label: '签收', value: fmt.number(signed.length), tone: 'success' },
                            { label: '收入', value: fmt.money(util.sum(signed, 'freight')), tone: 'brand' },
                            { label: '毛利', value: fmt.money(util.money(util.sum(signed, TMS.order.profitOf))), tone: 'info' }
                        ]),
                        ui.desc([
                            { label: '未收账款', value: fmt.money(util.money(util.sum(pending, 'amount'))) + '（' + pending.length + ' 笔）' },
                            { label: '应收总额', value: fmt.money(util.money(util.sum(ar, 'amount'))) },
                            { label: '异常票数', value: orders.reduce(function (s, o) { return s + (o.exceptionCount || 0); }, 0) + ' 起' },
                            { label: '积分余额', value: fmt.number(points.balance) + ' 分 · 流水 ' + points.rows.length + ' 条' }
                        ], { inline: true })
                    ])
                })
            ]),
            footer: ui.btn('查看订单', { tone: 'primary', size: 'sm', act: 'cust:orders', arg: c.id }) +
                ui.btn('编辑档案', { size: 'sm', act: 'cust:edit', arg: c.id }) +
                ui.btn('关闭', { act: 'ui:close' })
        });
    }

    /* ---------- 客户档案编辑表单 ---------- */

    function customerFormModal(id) {
        var c = id ? db.get('customers', id) : null;
        ui.formModal({
            title: c ? '编辑客户档案' : '新增客户',
            sub: c ? esc(c.name) + ' · ' + esc(c.id) : '合同期与信用额度决定后续账期与限额拦截',
            values: c || { level: 'B', settleCycle: '半月结', status: 'active' },
            fields: [
                { key: 'name', label: '客户名称', required: true },
                { key: 'shortName', label: '简称' },
                { key: 'level', label: '客户等级', type: 'select', options: ui.optionsOf(cfg.customerLevels, 'level', 'level'), required: true },
                { key: 'industry', label: '行业', type: 'select', options: [{ value: '', label: '请选择' }].concat(ui.optionsOf(colUnique('customers', 'industry'))) },
                { key: 'city', label: '所在城市', type: 'city', required: true },
                { key: 'contact', label: '联系人' },
                { key: 'phone', label: '联系电话' },
                { key: 'settleCycle', label: '结算周期', type: 'select', options: ui.optionsOf(colUnique('customers', 'settleCycle')) },
                { key: 'creditLimit', label: '信用额度', type: 'number' },
                { key: 'monthlyVolume', label: '月均票量', type: 'number' },
                { key: 'contractFrom', label: '合同起始', type: 'date' },
                { key: 'contractTo', label: '合同到期', type: 'date' },
                { key: 'status', label: '状态', type: 'select', options: [{ value: 'active', label: '合作中' }, { value: 'suspended', label: '已停用' }] },
                { key: 'senderAddress', label: '默认寄件地址', type: 'textarea', rows: 2 }
            ],
            okText: c ? '保存' : '创建',
            onSubmit: function (data) {
                if (!data.name) return '客户名称不能为空';
                if (!data.city) return '所在城市不能为空';
                var level = cfg.customerLevels.filter(function (l) { return l.level === data.level; })[0];
                var patch = {
                    name: data.name, shortName: data.shortName, level: data.level,
                    levelName: level ? level.name : '', industry: data.industry,
                    city: data.city, contact: data.contact, phone: data.phone,
                    settleCycle: data.settleCycle || (level ? level.settleCycle : '现付'),
                    discountRate: level ? level.discount : 0,
                    creditLimit: Number(data.creditLimit || (level ? level.creditLimit : 0)),
                    monthlyVolume: Number(data.monthlyVolume) || 0,
                    contractFrom: data.contractFrom, contractTo: data.contractTo,
                    status: data.status, senderAddress: data.senderAddress
                };
                var res = c ? db.update('customers', c.id, patch) : db.create('customers', patch);
                saveRow('customers', res, '客户档案变更');
                ui.toast(c ? ('已更新客户「' + res.name + '」') : ('已新建客户「' + res.name + '」，等级 ' + res.level), 'success');
            }
        });
    }

    /* ---------- 五、订单管理 ---------- */

    /* 跨页跳转带进来的筛选只落一次：
       每次刷新都按参数回写会把用户手工改回来的条件又按回去 */
    function applyParamFilter(ctx, keys) {
        var st = ctx.state, fs = pg.filtersOf(st);
        st._param = st._param || {};
        (keys || []).forEach(function (k) {
            var v = ctx.params && ctx.params[k];
            if (!v || st._param[k] === v) return;
            st._param[k] = v;
            fs[k] = v;
            st.page = 1;
        });
    }

    function actor() { return (TMS.auth.current() || {}).name || '运营管理员'; }

    /* 下单前先出价：报价与落单分成两步，避免表单里点一次「试算」就多一张真单 */
    var draftOrder = null;

    function orderFormFields() {
        return [
            { key: 'customerId', label: '客户', type: 'select', options: [{ value: '', label: '散客（无档案）' }].concat(ui.optionsOf(db.col('customers'), 'id', 'name')) },
            { key: 'origin', label: '始发城市', type: 'city', required: true, value: '上海' },
            { key: 'destination', label: '目的城市', type: 'city', required: true },
            { key: 'service', label: '服务方式', type: 'select', required: true, options: ui.optionsOf(cfg.serviceLevels), value: '标准' },
            { key: 'weight', label: '实际重量(kg)', type: 'number', required: true, min: 0.1, value: 20 },
            { key: 'pieces', label: '件数', type: 'number', required: true, min: 1, value: 1 },
            { key: 'dims', label: '外尺寸(长×宽×高 cm)', placeholder: '40x30x25，多件可写 40x30x25*2' },
            { key: 'goods', label: '货物品名', type: 'select', options: ui.optionsOf(TMS.master.GOODS, 'name', 'name') },
            { key: 'paymentMethod', label: '付款方式', type: 'select', options: ui.optionsOf(cfg.paymentMethods), value: '现付' },
            { key: 'codAmount', label: '代收货款(元)', type: 'number', min: 0 },
            { key: 'declaredValue', label: '声明价值(元)', type: 'number', min: 0 },
            { key: 'isInsured', label: '投保保价', type: 'checkbox' },
            { key: 'receiverName', label: '收件人' },
            { key: 'receiverPhone', label: '收件电话' },
            { key: 'receiverAddress', label: '收件地址', type: 'textarea', rows: 2 },
            { key: 'remark', label: '备注', type: 'textarea', rows: 2 }
        ];
    }

    function quoteParams(d) {
        return {
            origin: d.origin, destination: d.destination, service: d.service,
            weight: Number(d.weight) || 0, pieces: Number(d.pieces) || 1, dims: d.dims,
            goods: d.goods, declaredValue: d.declaredValue, isInsured: d.isInsured,
            paymentMethod: d.codAmount > 0 ? '到付' : d.paymentMethod, codAmount: d.codAmount,
            customerId: d.customerId
        };
    }

    function newOrderModal() {
        ui.formModal({
            title: '新建运单', size: 'wide',
            sub: '运价卡、抛比与折扣按客户档案即时匹配，确认后才生成单据号',
            fields: orderFormFields(),
            footNote: '散客无档案时按标准价出单；到付需填代收货款，否则自动改回现付',
            okText: '计算报价',
            onSubmit: function (data, handle) {
                if (!data.destination) return '请填写目的城市';
                if (!TMS.master.cityByName(data.destination)) return '目的城市不在服务网络内：' + data.destination;
                if (!TMS.master.cityByName(data.origin)) return '始发城市不在服务网络内：' + data.origin;
                if (!(Number(data.weight) > 0)) return '重量必须大于 0';
                draftOrder = data;
                handle.close();
                quoteModal();
            }
        });
    }

    function quoteModal() {
        var d = draftOrder || {};
        var q = TMS.pricing.quote(quoteParams(d), { customer: d.customerId ? db.get('customers', d.customerId) : null });
        if (!q.cardId) { ui.toast('没有匹配的运价卡，请先在运价卡页维护', 'error'); return; }
        ui.modal({
            title: '报价确认', size: 'wide', dismiss: false,
            sub: esc(q.cardName) + ' ' + esc(q.cardVersion) + ' · ' + esc(q.origin || '') + ' → ' + esc(q.destination) + ' · ' + esc(q.service),
            body: ui.stack([
                ui.split('2', [
                    ui.card({
                        title: '计费口径', flat: true,
                        body: ui.desc([
                            { label: '实重', value: fmt.kg(q.actualWeight) },
                            { label: '体积重', value: fmt.kg(q.volumetricWeight) + '（抛比 1/' + q.throwRatio + '）' },
                            { label: '计费重', value: '<b>' + fmt.kg(q.chargeableWeight) + '</b> 取大' },
                            { label: '件数', value: q.pieces + ' 件' },
                            { label: '体积', value: util.round(q.volumeCm3, 0) + ' cm³' },
                            { label: '干线里程', value: fmt.km(q.lineKm) }
                        ])
                    }),
                    ui.card({
                        title: '费用明细', sub: '与订单详情的应收口径同源', flat: true,
                        body: ui.table({
                            dense: true,
                            columns: [
                                { key: 'label', label: '项目' },
                                {
                                    key: 'value', label: '金额', align: 'right', render: function (r) {
                                        return '<span class="tms-money' + (r.value < 0 ? ' tone-success' : '') + '">' + fmt.money(r.value) + '</span>';
                                    }
                                }
                            ],
                            rows: q.breakdown
                        }),
                        foot: ui.kv('合计应收', '<span class="tms-money strong">' + fmt.money(q.total) + '</span>' +
                            (q.minTopUp ? ' <span class="tms-badge tone-warn">含托底补足 ' + fmt.money(q.minTopUp) + '</span>' : ''), { total: true })
                    })
                ]),
                q.minTopUp ? ui.notice('该票按阶梯折扣算出的价格低于成本托底线（预计成本 ' + fmt.money(q.estCost) + ' × 最低加成），系统已自动补足至可交付价。', 'warn', '触发商务托底价') : '',
                d.paymentMethod === '到付' && !(Number(d.codAmount) > 0)
                    ? ui.notice('到付未填代收货款，出单时会自动改回现付，避免资金流无法闭环。', 'info') : ''
            ]),
            footer: ui.btn('确认下单', { tone: 'primary', size: 'sm', act: 'ord:create' }) +
                ui.btn('返回修改', { size: 'sm', act: 'ui:close' })
        });
    }

    pg.define('order', {
        sub: '全渠道订单统一台账：建单、推进、拦截、改单都走领域服务，页面不直接改状态字段',
        load: function (ctx) {
            applyParamFilter(ctx, ['customerId', 'status', 'destination', 'origin', 'q']);
            var rows = db.col('orders').map(TMS.order.view);
            var open = rows.filter(function (o) { return !TMS.order.isTerminal(o); });
            var today = util.dateKey(util.now());
            return {
                rows: rows,
                k: {
                    today: rows.filter(function (o) { return String(o.createdAt).slice(0, 10) === today; }).length,
                    open: open.length,
                    late: open.filter(function (o) { return TMS.order.isLate(o); }).length,
                    problem: rows.filter(function (o) { return o.status === 'problem'; }).length,
                    delivering: rows.filter(function (o) { return o.status === 'delivering'; }).length,
                    cod: open.filter(function (o) { return o.paymentMethod === '到付'; }).length,
                    terminal: rows.length - open.length
                }
            };
        },
        render: function (ctx, d) {
            var sc = pg.statusChips(d.rows);
            var k = d.k;
            var st = ctx.state;
            var linked = (ctx.params && ctx.params.customerId && st.filters && st.filters.customerId)
                ? db.get('customers', st.filters.customerId) : null;
            return wrap(ctx, {
                sub: linked ? ('已按客户筛选：' + esc(linked.name) + '（' + esc(linked.level) + ' · ' + esc(linked.settleCycle) + '）') : ctxTitleSub(ctx),
                actions: ui.btn('新建运单', { tone: 'primary', size: 'sm', act: 'ord:new', icon: '＋' }) +
                    ui.btn('导出当前筛选', { size: 'sm', act: 'ord:export', icon: '⤓' }),
                body: [
                    ui.kpis([
                        { label: '今日新单', value: fmt.number(k.today), icon: '＋', tone: 'brand', sub: '全渠道建单量' },
                        { label: '未闭环', value: fmt.number(k.open), icon: '▦', sub: '在途 + 派送 + 问题件' },
                        { label: '已超承诺', value: fmt.number(k.late), icon: '⚠', tone: k.late ? 'danger' : 'success', sub: '需要干预' },
                        { label: '问题件', value: fmt.number(k.problem), icon: '✖', tone: k.problem ? 'warn' : 'muted', sub: '冻结推进，待放行' },
                        { label: '派送中', value: fmt.number(k.delivering), icon: '⛶', tone: 'info', sub: '末端在途' },
                        { label: '到付在管', value: fmt.number(k.cod), icon: '↧', sub: '含代收货款，上划前挂在派送环节' },
                        { label: '已闭环', value: fmt.number(k.terminal), icon: '✓', tone: 'success', sub: '签收 / 取消 / 退回' }
                    ]),
                    ui.card({
                        title: '订单台账', sub: '点击任意行展开全链路详情（轨迹 · 费用 · 成本 · 作业单 · 资金）', flat: true,
                        body: grid(ctx, {
                            rows: d.rows, keyName: 'id', onRow: 'order:open', searchKey: 'q',
                            search: function (r) { return [r.id, r.waybillNo, r.customer, r.goods, r.origin, r.destination, r.courier, r.receiverName].join(' '); },
                            fields: pg.orderFields({ customerFilter: true, searchLabel: '单号 / 客户 / 货物 / 收件人' }).concat([
                                { key: 'zone', label: '始发大区', options: [{ value: '', label: '全部大区' }].concat(ui.optionsOf(TMS.master.ZONES)) },
                                { key: 'only', label: '风险视图', options: [{ value: '', label: '全部订单' }, { value: 'late', label: '仅超承诺' }, { value: 'stuck', label: '滞留超 24h' }, { value: 'undelivered', label: '到港未签收' }, { value: 'cod', label: '有代收货款' }, { value: 'insured', label: '已保价' }] }
                            ]),
                            filter: function (r, fs) {
                                if (!pg.orderFilter(r, fs)) return false;
                                if (fs.only === 'late' && !TMS.order.isLate(r)) return false;
                                if (fs.only === 'stuck' && TMS.order.stuckHours(r) < 24) return false;
                                if (fs.only === 'undelivered' && ['arrived', 'delivering'].indexOf(r.status) < 0) return false;
                                if (fs.only === 'cod' && !(Number(r.codAmount) > 0)) return false;
                                if (fs.only === 'insured' && !r.isInsured) return false;
                                return true;
                            },
                            chips: sc.chips, chipsName: sc.chipsName,
                            unit: '单', pageSize: 12, dense: true,
                            columns: pg.orderColumns().concat([
                                { key: 'ops', label: '操作', sortable: false, align: 'right', width: '170px', render: orderRowOps }
                            ])
                        })
                    })
                ]
            });
        },
        actions: orderPageActions(),
        drawerFooter: function (orderId) {
            var o = db.get('orders', orderId);
            if (!o || TMS.order.isTerminal(o)) return '';
            return ui.btn('改单', { size: 'sm', act: 'ord:change', arg: orderId }) +
                (o.status === 'problem'
                    ? ui.btn('放行', { size: 'sm', tone: 'primary', act: 'ord:release', arg: orderId })
                    : ui.btn('登记异常', { size: 'sm', tone: 'danger', act: 'ord:problem', arg: orderId }));
        },
        afterRender: function (ctx) { pg.deepLink(ctx); }
    });

    function ctxTitleSub(ctx) {
        var total = db.col('orders').length;
        return '共 ' + fmt.number(total) + ' 张运单 · 状态推进由扫描流水派生，时间窗在顶栏切换（' + ctx.days + ' 日报表口径）';
    }

    /* 行内动作只给「下一步」，不给全量按钮：
       12 个状态 × 8 个动作的按钮矩阵没人能看懂，也一定会有人点出非法流转 */
    function orderRowOps(r) {
        if (TMS.order.isTerminal(r)) return ui.link('详情', 'order:open', r.id, { tone: 'ghost' });
        var out = [];
        if (r.status === 'problem') out.push(ui.link('放行', 'ord:release', r.id, { tone: 'primary' }));
        else out.push(ui.link('推进至' + (cfg.orderLabels[nextStatus(r.status)] || '下一环节'), 'ord:advance', r.id));
        if (!r.exceptionCount) out.push(ui.link('异常', 'ord:problem', r.id, { tone: 'danger' }));
        if (['signed', 'cancelled'].indexOf(r.status) < 0) out.push(ui.link('拦截', 'ord:cancel', r.id, { tone: 'ghost' }));
        return out.join(' ');
    }

    function nextStatus(status) {
        var i = TMS.order.statusIndex(status);
        return i > -1 && i < cfg.orderFlow.length - 1 ? cfg.orderFlow[i + 1] : '';
    }

    function orderPageActions() {
        var acts = {
            'ord:new': function () { newOrderModal(); },
            'ord:create': function () {
                var d = draftOrder || {};
                ui.closeTop();
                var res = TMS.order.create({
                    customerId: d.customerId, origin: d.origin, destination: d.destination,
                    service: d.service, weight: d.weight, pieces: d.pieces, dims: d.dims, goods: d.goods,
                    declaredValue: d.declaredValue, isInsured: d.isInsured,
                    paymentMethod: Number(d.codAmount) > 0 ? '到付' : d.paymentMethod, codAmount: d.codAmount,
                    receiverName: d.receiverName, receiverPhone: d.receiverPhone, receiverAddress: d.receiverAddress,
                    remark: d.remark, actor: actor()
                });
                if (!res.ok) { ui.toast(res.message, 'error'); return; }
                draftOrder = null;
                ui.toast('已生成运单 ' + res.order.waybillNo + '，应收 ' + fmt.money(res.order.freight), 'success');
                pg.openOrder(res.order.id);
            },
            'ord:advance': function (id) {
                var o = db.get('orders', id);
                if (!o) return;
                var next = nextStatus(o.status);
                ui.confirm({
                    title: '推进到「' + (cfg.orderLabels[next] || next) + '」',
                    message: '运单 ' + esc(o.waybillNo) + ' 将留下一次作业留痕，环节时间取当前时刻。',
                    detail: next === 'signed'
                        ? '签收会同步核销应收、结算派送员工资并给客户返积分，演示环境可直接点以查看闭环账务。'
                        : '后续环节仍需在对应作业台扫描，这里只推进当前一步。',
                    okText: '确认推进'
                }).then(function (yes) {
                    if (!yes) return;
                    var res = TMS.order.advance(id, { operator: actor() });
                    ui.toast(res.ok ? ((res.order ? cfg.orderLabels[res.order.status] : '已推进') + ' · 留痕成功') : res.message, res.ok ? 'success' : 'error');
                });
            },
            'ord:problem': function (id) {
                var o = db.get('orders', id);
                if (!o) return;
                ui.formModal({
                    title: '登记异常并冻结运单', sub: esc(o.waybillNo) + ' · ' + esc(o.origin) + ' → ' + esc(o.destination),
                    fields: [
                        { key: 'type', label: '异常类型', type: 'select', required: true, options: ui.optionsOf(TMS.service.EXCEPTION_TYPES) },
                        { key: 'level', label: '等级', type: 'select', options: ui.optionsOf(TMS.service.EXCEPTION_LEVELS), value: '二级' },
                        { key: 'description', label: '情况描述', type: 'textarea', rows: 3, required: true },
                        { key: 'location', label: '发生地点', value: o.destination }
                    ],
                    okText: '生成异常工单',
                    onSubmit: function (data) {
                        var res = TMS.order.markProblem(id, {
                            type: data.type, level: data.level, description: data.description,
                            location: data.location, operator: actor(), actor: actor()
                        });
                        ui.toast(res.ok ? '运单已冻结，异常工单 ' + (res.exception ? res.exception.id : '') + ' 已派发' : (res.message || '登记失败'), res.ok ? 'success' : 'error');
                    }
                });
            },
            'ord:release': function (id) {
                var o = db.get('orders', id);
                if (!o) return;
                var open = db.col('exceptions').filter(function (e) { return e.orderId === id && e.status !== 'resolved'; });
                ui.formModal({
                    title: '问题件放行', sub: esc(o.waybillNo) + ' · 冻结前环节 ' + (cfg.orderLabels[o.problemFrom] || o.problemFrom || '—'),
                    fields: [
                        { key: 'solution', label: '处理方案', type: 'select', required: true, options: ui.optionsOf(TMS.service.SOLUTIONS) },
                        { key: 'note', label: '放行说明', type: 'textarea', rows: 3, required: true }
                    ],
                    footNote: open.length ? ('该单仍有 ' + open.length + ' 张未闭环工单，放行会一并标记为已闭环') : '工单已闭环',
                    okText: '恢复流转',
                    onSubmit: function (data) {
                        var res = TMS.order.releaseProblem(id, { operator: actor(), solution: data.solution, note: data.note });
                        ui.toast(res.ok ? '运单已恢复流转' : (res.message || '放行失败'), res.ok ? 'success' : 'error');
                    }
                });
            },
            'ord:cancel': function (id) {
                var o = db.get('orders', id);
                if (!o) return;
                ui.formModal({
                    title: '拦截取消', sub: esc(o.waybillNo) + ' · 当前环节 ' + (cfg.orderLabels[o.status] || o.status),
                    danger: true, okText: '确认拦截',
                    fields: [
                        { key: 'reason', label: '拦截原因', type: 'select', required: true, options: [{ value: '', label: '请选择' }].concat(ui.optionsOf(['客户取消订单', '地址无法送达', '货物不符合运输要求', '重复下单', '客户拒收', '超期未处理'])) },
                        { key: 'note', label: '补充说明', type: 'textarea', rows: 2 }
                    ],
                    footNote: '拦截会自动冲销该单未收应收；已发运的运单同时生成逆向拦截单',
                    onSubmit: function (data) {
                        var res = TMS.order.cancel(id, { reason: data.reason + (data.note ? '：' + data.note : ''), operator: actor(), location: o.destination });
                        ui.toast(res.ok
                            ? ('运单已拦截' + (res.intercepted ? '，并生成逆向拦截单' : '，应收已冲销'))
                            : res.message, res.ok ? 'success' : 'error');
                    }
                });
            },
            'ord:change': function (id) {
                var o = db.get('orders', id);
                if (!o) return;
                ui.formModal({
                    title: '改单', sub: esc(o.waybillNo) + ' · 修改后自动重报价并重排路由',
                    size: 'wide',
                    values: o,
                    fields: [
                        { key: 'destination', label: '目的城市', type: 'city' },
                        { key: 'service', label: '服务方式', type: 'select', options: ui.optionsOf(cfg.serviceLevels) },
                        { key: 'weight', label: '重量(kg)', type: 'number', min: 0.1 },
                        { key: 'pieces', label: '件数', type: 'number', min: 1 },
                        { key: 'receiverName', label: '收件人' },
                        { key: 'receiverPhone', label: '收件电话' },
                        { key: 'receiverAddress', label: '收件地址', type: 'textarea', rows: 2 },
                        { key: 'declaredValue', label: '声明价值', type: 'number' },
                        { key: 'remark', label: '备注', type: 'textarea', rows: 2 },
                        { key: 'force', label: '已进入干线仍要改单', type: 'checkbox' }
                    ],
                    okText: '提交改单',
                    onSubmit: function (data) {
                        var res = TMS.order.change(id, data);
                        ui.toast(res.ok ? ('改单成功，运费调整 ' + fmt.money(res.delta || 0)) : res.message, res.ok ? 'success' : 'error');
                    }
                });
            },
            'ord:export': function () {
                exportGrid({
                    rows: db.col('orders').map(TMS.order.view),
                    name: '订单台账-' + util.dateKey(util.now()) + '.csv',
                    searchKey: 'q',
                    search: function (r) { return [r.id, r.waybillNo, r.customer, r.goods, r.origin, r.destination, r.courier, r.receiverName].join(' '); },
                    filter: function (r, fs) { return pg.orderFilter(r, fs); },
                    cols: [
                        { label: '运单号', key: 'waybillNo' }, { label: '订单号', key: 'id' },
                        { label: '客户', key: 'customer' }, { label: '等级', key: 'customerLevel' },
                        { label: '状态', value: function (r) { return cfg.orderLabels[r.status]; } },
                        { label: '始发', key: 'origin' }, { label: '目的', key: 'destination' },
                        { label: '服务', key: 'service' }, { label: '件数', key: 'pieces' },
                        { label: '实重', key: 'weight' }, { label: '计费重', key: 'chargeableWeight' },
                        { label: '运费', key: 'freight' }, { label: '成本', value: function (r) { return TMS.pricing.costTotalOf(r); } },
                        { label: '毛利', key: 'profit' },
                        { label: '付款方式', key: 'paymentMethod' }, { label: '代收货款', key: 'codAmount' },
                        { label: '承诺时效', key: 'expectedAt' }, { label: '派送员', key: 'courier' },
                        { label: '创建时间', key: 'createdAt' }
                    ]
                });
            }
        };
        return merge(custActions, acts);
    }

    /* ---------- 六、路由管理 ---------- */

    /* 段次表：routes.segments 与订单路由计划面板同构，列定义只写一次 */
    function segmentTable(segs) {
        return ui.table({
            dense: true, keyName: 'seq', rows: segs || [], emptyText: '该路由没有段次明细',
            columns: [
                { key: 'seq', label: '段次', width: '58px', sortable: false, render: function (s) { return ui.rank(s.seq); } },
                { key: 'legType', label: '环节', width: '92px', render: function (s) { return ui.badge(pg.LEG_TYPE[s.legType] || s.legType, s.legType === 'trunk' ? 'brand' : 'muted'); } },
                { key: 'from', label: '起点' },
                { key: 'to', label: '终点' },
                { key: 'mode', label: '方式', width: '70px' },
                { key: 'km', label: '里程', align: 'right', width: '84px', render: function (s) { return fmt.km(s.km); } },
                { key: 'stdHours', label: '标准时长', align: 'right', width: '92px', render: function (s) { return fmt.duration(s.stdHours); } }
            ]
        });
    }

    /* 路由上的干线班次：段次里 trunk 的起讫名即班次表的分拨名 */
    function tripsOfRoute(r) {
        var legs = (r.segments || []).filter(function (s) { return s.legType === 'trunk'; });
        if (!legs.length) return [];
        return db.col('trips').filter(function (t) {
            return legs.some(function (l) { return l.from === t.fromHubName && l.to === t.toHubName; });
        });
    }

    function routeModal(id) {
        var r = db.get('routes', id);
        if (!r) { ui.toast('路由不存在', 'warn'); return; }
        var segs = r.segments || [];
        var trips = tripsOfRoute(r);
        var trunk = segs.filter(function (s) { return s.legType === 'trunk'; });
        var byHub = util.round(util.sum(trunk, 'stdHours'), 1);
        ui.modal({
            title: esc(r.origin) + ' → ' + esc(r.destination),
            size: 'wide',
            sub: esc(r.id) + ' · ' + esc(r.originZone) + ' → ' + esc(r.destinationZone) + ' · ' +
                esc(r.mode) + ' · ' + (r.isFallback ? '全国兜底路由' : '由班次表推导'),
            body: ui.stack([
                ui.desc([
                    { label: '标准时长', value: fmt.duration(r.totalStdHours) },
                    { label: '总里程', value: fmt.km(r.distanceKm) },
                    { label: '段数', value: segs.length + ' 段（干线 ' + trunk.length + ' 段）' },
                    { label: '干线占比', value: r.totalStdHours ? fmt.percent(util.round(byHub / r.totalStdHours * 100, 1)) : '—' },
                    { label: '优先级', value: ui.badge(esc(r.priority), r.priority === '高' ? 'warn' : 'muted') },
                    { label: '偏离轨迹', value: (r.deviationCount || 0) + ' 条' },
                    { label: '状态', value: statusBadge(r.status) },
                    { label: '最近重算', value: fmt.dateTime(r.updatedAt) }
                ], { inline: true }),
                ui.card({ title: '段次明细', sub: '揽收/干线/派送三段的时长与里程决定承诺时效', flat: true, body: segmentTable(segs) }),
                trips.length
                    ? ui.card({
                        title: '挂靠班次', sub: trips.length + ' 条（干线段按分拨对搜索班次表）', flat: true,
                        body: ui.table({
                            dense: true, keyName: 'id', rows: trips.slice(0, 12),
                            columns: [
                                { key: 'code', label: '班次' },
                                { key: 'mode', label: '方式', width: '70px' },
                                { key: 'departAt', label: '发车', width: '84px' },
                                { key: 'arriveAt', label: '到达', width: '84px' },
                                { key: 'days', label: '频次', width: '84px' },
                                { key: 'transitHours', label: '在途', align: 'right', width: '78px', render: function (t) { return fmt.duration(t.transitHours); } },
                                { key: 'onTimeRate', label: '准点率', align: 'right', width: '86px', render: function (t) { return rateBar(util.round((t.onTimeRate || 0) * 100, 1), { target: 92 }); } }
                            ]
                        })
                    })
                    : ui.notice('该路由没有干线段（同城/同区件），或班次的分拨配对已变更', 'info')
            ]),
            footer: ui.btn('按班次重算', { tone: 'primary', size: 'sm', act: 'rt:check', arg: r.id }) +
                ui.btn('关闭', { act: 'ui:close' })
        });
    }

    /* 重算：用当前班次表重新推导段次，把漂移写回路由表并留审计。
       班次调整后不重算，路由上的标准时长就是过期承诺，时效看板会集体失真 */
    function recomputeRoute(id) {
        var r = db.get('routes', id);
        if (!r) { ui.toast('路由不存在', 'warn'); return; }
        var plan = TMS.master.planSegments(
            { city: r.origin, zone: r.originZone }, { city: r.destination, zone: r.destinationZone }, r.mode);
        if (!plan) { ui.toast('起讫城市不在主数据内，无法重算', 'warn'); return; }
        var dHours = util.round((plan.totalStdHours || 0) - (r.totalStdHours || 0), 1);
        var dKm = Math.round((plan.distanceKm || 0) - (r.distanceKm || 0));
        var dSegs = (plan.segments || []).length - (r.segments || []).length;
        if (!dHours && !dKm && !dSegs) { ui.toast(r.id + ' 与当前班次表一致，无需重算', 'success'); return; }
        ui.confirm({
            title: '重算路由 ' + r.id,
            message: '标准时长 ' + fmt.duration(r.totalStdHours) + ' → ' + fmt.duration(plan.totalStdHours),
            detail: '里程 ' + fmt.km(r.distanceKm) + ' → ' + fmt.km(plan.distanceKm) +
                ' · 段数 ' + (r.segments || []).length + ' → ' + (plan.segments || []).length +
                '<br>改的是「后续新单的承诺」，已生成运单的时间承诺随单快照，不受影响。',
            okText: '确认重算'
        }).then(function (yes) {
            if (!yes) return;
            db.update('routes', r.id, {
                mode: plan.mode, priority: plan.priority, segments: plan.segments,
                totalStdHours: plan.totalStdHours, distanceKm: plan.distanceKm, status: 'active'
            });
            saveRow('routes', r, '路由重算');
            TMS.audit.log('network.update', 'routes', r.id,
                r.origin + '→' + r.destination + ' 标准时长 ' + fmt.duration(r.totalStdHours) + '→' + fmt.duration(plan.totalStdHours), actor());
            ui.toast(r.id + ' 已重算：时长 ' + (dHours >= 0 ? '+' : '') + dHours + 'h / 里程 ' + (dKm >= 0 ? '+' : '') + dKm + 'km', 'success');
        });
    }

    pg.define('route', {
        sub: '干支分离：路由是班次的派生物，改班次要重算路由，改路由不回写已生成的运单',
        load: function (ctx) {
            var rs = TMS.stats.routeStats();
            var rows = db.col('routes');
            return {
                rs: rs, rows: rows,
                dist: (function () {
                    var buckets = [{ label: '≤24h', value: 0 }, { label: '24-48h', value: 0 }, { label: '48-72h', value: 0 }, { label: '>72h', value: 0 }];
                    rows.forEach(function (r) {
                        var h = Number(r.totalStdHours) || 0;
                        buckets[h <= 24 ? 0 : h <= 48 ? 1 : h <= 72 ? 2 : 3].value++;
                    });
                    return buckets;
                })(),
                deviants: util.sortBy(rows, 'deviationCount', 'desc').slice(0, 8)
            };
        },
        render: function (ctx, d) {
            var kpi = ui.kpis([
                { label: '路由总数', value: d.rs.total, unit: '条', tone: 'brand', icon: '⇄', sub: '生效 ' + d.rs.active + ' 条' },
                { label: '平均标准时长', value: util.round(d.rs.avgStdHours, 1), unit: '小时', icon: '◷', sub: '含揽收与派送支线' },
                { label: '平均里程', value: fmt.number(d.rs.avgDistance), unit: 'km', icon: '⤳', sub: '全网路由均值' },
                { label: '偏离轨迹', value: d.rs.deviationTraces, unit: '条', tone: d.rs.deviationTraces ? 'warn' : 'muted', icon: '⚠', sub: '涉及 ' + d.rs.deviationOrders + ' 单' }
            ]);
            var modeCard = ui.card({
                title: '运输方式结构', sub: '空运只覆盖长距离高服务，其余走陆运干线', flat: true,
                body: ch.donut({ data: d.rs.byMode, height: 230, fmt: function (v) { return v + ' 条'; } })
            });
            var distCard = ui.card({
                title: '标准时长分布', sub: '时长桶反映网络覆盖度，>72h 多为西部/东北长线', flat: true,
                body: ch.bars({ data: d.dist, height: 230, fmt: function (v) { return v + ' 条'; } })
            });
            var devCard = ui.card({
                title: '偏离最多的路由', sub: '偏离 = 扫描到的实际分拨与计划不符，通常是班次变更未重算', flat: true,
                body: ch.hbars({
                    data: d.deviants.map(function (r) { return { label: r.origin + '→' + r.destination, value: r.deviationCount || 0 }; }),
                    rowH: 26, labelWidth: 130, valueWidth: 60, fmt: function (v) { return v + ' 次'; }
                })
            });
            return wrap(ctx, {
                actions: ui.btn('导出路由', { size: 'sm', act: 'rt:export', icon: '⤓' }),
                body: [kpi, ui.split('2', [modeCard, distCard]), devCard, grid(ctx, {
                    rows: d.rows, keyName: 'id', onRow: 'rt:open', searchKey: 'q',
                    search: function (r) { return [r.id, r.origin, r.destination, r.originZone, r.destinationZone, r.mode].join(' '); },
                    fields: [
                        { key: 'q', type: 'search', label: '城市 / 路由号', placeholder: '上海 / RT0001' },
                        { key: 'zone', label: '始发大区', options: [{ value: '', label: '全部大区' }].concat(ui.optionsOf(TMS.master.ZONES)) },
                        { key: 'mode', label: '方式', options: [{ value: '', label: '全部方式' }].concat(ui.optionsOf(colUnique('routes', 'mode'))) },
                        { key: 'dev', label: '偏离', options: [{ value: '', label: '全部' }, { value: '1', label: '有偏离' }] }
                    ],
                    filter: function (r, fs) {
                        if (fs.zone && r.originZone !== fs.zone) return false;
                        if (fs.mode && r.mode !== fs.mode) return false;
                        if (fs.dev === '1' && !(r.deviationCount || 0)) return false;
                        return true;
                    },
                    columns: [
                        { key: 'id', label: '路由号', width: '92px', render: function (r) { return idLink(r.id, 'rt:open'); } },
                        { key: 'origin', label: '起讫', render: function (r) { return esc(r.origin) + ' → ' + esc(r.destination); } },
                        { key: 'originZone', label: '大区', width: '110px', render: function (r) { return esc(r.originZone) + ' → ' + esc(r.destinationZone); } },
                        { key: 'mode', label: '方式', width: '70px', render: function (r) { return ui.badge(esc(r.mode), r.mode === '空运' ? 'brand' : 'muted'); } },
                        { key: 'segments', label: '段数', align: 'right', width: '68px', render: function (r) { return (r.segments || []).length; } },
                        { key: 'totalStdHours', label: '标准时长', align: 'right', width: '92px', render: function (r) { return fmt.duration(r.totalStdHours); } },
                        { key: 'distanceKm', label: '里程', align: 'right', width: '84px', render: function (r) { return fmt.km(r.distanceKm); } },
                        { key: 'deviationCount', label: '偏离', align: 'right', width: '68px', render: function (r) { return r.deviationCount ? ui.badge(r.deviationCount, 'warn') : '<span class="tms-dim">0</span>'; } },
                        { key: 'status', label: '状态', width: '80px', render: function (r) { return statusBadge(r.status); } },
                        { key: 'ops', label: '操作', width: '112px', sortable: false, render: function (r) { return ui.link('重算', 'rt:check', r.id, { tone: 'ghost' }); } }
                    ]
                })]
            });
        },
        actions: {
            'rt:open': function (id) { routeModal(id); },
            'rt:check': function (id) { ui.closeTop(); recomputeRoute(id); },
            'rt:export': function () {
                exportGrid({
                    rows: db.col('routes'), name: '路由清单.csv',
                    search: function (r) { return [r.id, r.origin, r.destination, r.originZone, r.mode].join(' '); },
                    cols: [
                        { label: '路由号', key: 'id' }, { label: '始发', key: 'origin' }, { label: '目的', key: 'destination' },
                        { label: '始发大区', key: 'originZone' }, { label: '目的大区', key: 'destinationZone' },
                        { label: '方式', key: 'mode' }, { label: '优先级', key: 'priority' },
                        { label: '段数', value: function (r) { return (r.segments || []).length; } },
                        { label: '标准时长', key: 'totalStdHours' }, { label: '里程', key: 'distanceKm' },
                        { label: '偏离次数', key: 'deviationCount' },
                        { label: '段次明细', value: function (r) { return (r.segments || []).map(function (s) { return s.from + '-' + s.to; }).join(' > '); } }
                    ]
                });
            }
        }
    });

    /* ---------- 七、轨迹中心 ---------- */

    /* 扫描流水读取时派生成轨迹视图：节点名、默认终端、应完成时限都不落库 */
    function traceRows(days, limit) {
        var cutoff = util.addDays(util.now(), -(days || 7)).getTime();
        var idx = TMS.order.scanIndex();
        return db.col('scans')
            .filter(function (s) { return util.toDate(s.opTime).getTime() >= cutoff; })
            .sort(function (a, b) { return a.opTime < b.opTime ? 1 : -1; })
            .slice(0, limit || 1200)
            .map(function (s) {
                var list = idx[s.orderId] || [];
                var i = list.indexOf(s);
                return TMS.order.traceView(s, db.get('orders', s.orderId), i > -1 ? list[i + 1] : null);
            });
    }

    pg.define('tracking', {
        sub: '轨迹是扫描流水的读视图：节点名、操作终端、应完成时限全部读取时派生',
        load: function (ctx) {
            var ts = TMS.stats.traceStats(ctx.days);
            return {
                ts: ts, rows: traceRows(ctx.days, 1200),
                backlog: pg.scopedOrders(ctx.session).filter(function (o) { return o.status === 'transit' || o.status === 'arrived'; })
            };
        },
        render: function (ctx, d) {
            var ts = d.ts;
            var kpi = ui.kpis([
                { label: '扫描流水', value: fmt.number(ts.total), unit: '条', tone: 'brand', icon: '⌕', sub: '覆盖 ' + fmt.number(ts.indexed) + ' 张运单' },
                { label: '超时扫描', value: ts.overtime, unit: '条', tone: ts.overtime ? 'danger' : 'success', icon: '◷', sub: '下一环节未及时更新' },
                { label: '偏离路由', value: ts.deviant, unit: '条', tone: ts.deviant ? 'warn' : 'muted', icon: '⇄', sub: '实际分拨与计划不符' },
                { label: '异常结果', value: ts.exceptionResult, unit: '条', tone: ts.exceptionResult ? 'warn' : 'muted', icon: '⚠', sub: '拒扫 / 破损 / 无法识别' }
            ]);
            var nodeCard = ui.card({
                title: '节点扫描量', sub: '作业集中在哪一环，滞留就发生在哪一环', flat: true,
                body: ch.bars({ data: ts.byNode.slice(0, 10), height: 230, fmt: function (v) { return fmt.number(v) + ' 条'; } })
            });
            var deviceCard = ui.card({
                title: '终端扫描排行', sub: '偏离默认终端的流水才会改写设备名', flat: true,
                body: ch.hbars({
                    data: ts.byDevice.slice(0, 10), rowH: 26, labelWidth: 132, valueWidth: 66,
                    fmt: function (v) { return fmt.number(v); }
                })
            });
            var lateCard = ui.card({
                title: '超时流水 TOP', sub: ts.overtime ? '按发生时间排序，前 20 条' : '当前时间窗没有超时扫描', flat: true,
                body: ts.overtimeList.length ? ui.table({
                    dense: true, keyName: 'orderId', rows: ts.overtimeList.slice(0, 20),
                    columns: [
                        { key: 'orderId', label: '运单', sortable: false, render: function (v) { return idLink(v.orderId); } },
                        { key: 'nodeName', label: '节点', width: '96px' },
                        { key: 'opTime', label: '实际扫描', width: '128px', render: function (v) { return ui.timeCell(v.opTime); } },
                        { key: 'deadline', label: '应完成', width: '128px', render: function (v) { return '<span class="tms-dim">' + esc(fmt.dateTime(v.deadline)) + '</span>'; } },
                        { key: 'device', label: '终端', width: '104px' }
                    ]
                }) : ui.empty('没有超时扫描', '时间窗内全部作业均在标准时限内更新')
            });
            return wrap(ctx, {
                actions: ui.btn('导出轨迹', { size: 'sm', act: 'tk:export', icon: '⤓' }) +
                    ui.btn('去补录', { size: 'sm', act: 'tk:scan' }),
                body: [kpi, ui.split('2', [nodeCard, deviceCard]), lateCard, grid(ctx, {
                    rows: d.rows, keyName: 'orderId', searchKey: 'q', pageSize: 20,
                    search: function (v) { return [v.orderId, v.waybillNo, v.nodeName, v.location, v.operator, v.device].join(' '); },
                    fields: [
                        { key: 'q', type: 'search', label: '单号 / 节点 / 终端', placeholder: 'HL… / 分拨分拣 / PDA-9000' },
                        { key: 'node', label: '节点', options: [{ value: '', label: '全部节点' }].concat(ui.optionsOf(cfg.traceNodes, 'code', 'name')) },
                        { key: 'flag', label: '标记', options: [{ value: '', label: '全部' }, { value: 'late', label: '仅超时' }, { value: 'deviant', label: '仅偏离' }, { value: 'bad', label: '仅异常结果' }] }
                    ],
                    filter: function (v, fs) {
                        if (fs.node && v.node !== fs.node) return false;
                        if (fs.flag === 'late') return v.isOvertime;
                        if (fs.flag === 'deviant') return v.isDeviant;
                        if (fs.flag === 'bad') return v.result !== 'ok';
                        return true;
                    },
                    columns: [
                        { key: 'orderId', label: '运单', render: function (v) { return idLink(v.orderId) + ' <span class="tms-dim">' + esc(v.waybillNo) + '</span>'; } },
                        { key: 'nodeName', label: '节点', width: '96px', render: function (v) { return ui.badge(esc(v.nodeName), v.status ? 'info' : 'muted'); } },
                        { key: 'location', label: '地点', width: '120px', render: function (v) { return dim(v.location); } },
                        { key: 'operator', label: '操作方', width: '96px' },
                        { key: 'device', label: '终端', width: '104px', render: function (v) { return '<span class="tms-dim">' + esc(v.device) + '</span>'; } },
                        { key: 'weight', label: '称重', align: 'right', width: '84px', render: function (v) { return v.weight == null ? '<span class="tms-dim">—</span>' : fmt.kg(v.weight); } },
                        { key: 'opTime', label: '扫描时间', width: '132px', render: function (v) { return ui.timeCell(v.opTime); } },
                        { key: 'flag', label: '标记', width: '104px', sortable: false, render: function (v) {
                            if (v.result !== 'ok') return ui.badge(esc(v.result), 'danger');
                            if (v.isOvertime) return ui.badge('超时', 'warn');
                            if (v.isDeviant) return ui.badge('偏离', 'warn');
                            return '<span class="tms-dim">正常</span>';
                        } }
                    ],
                    emptyText: '时间窗内没有符合条件的扫描', emptySub: '顶栏切换时间窗，或到扫描记录页手工补录'
                })]
            });
        },
        actions: merge(pg.shared, {
            'tk:export': function () {
                var ctx = curCtx();
                var fs = pg.filtersOf(ctx.state);
                var rows = traceRows(ctx.days, 5000).filter(function (v) {
                    if (fs.node && v.node !== fs.node) return false;
                    if (fs.flag === 'late') return v.isOvertime;
                    if (fs.flag === 'deviant') return v.isDeviant;
                    if (fs.flag === 'bad') return v.result !== 'ok';
                    return true;
                });
                if (!rows.length) { ui.toast('当前筛选没有轨迹', 'warn'); return; }
                download('轨迹流水.csv', toCsv([
                    { label: '订单号', key: 'orderId' }, { label: '运单号', key: 'waybillNo' },
                    { label: '节点', key: 'nodeName' }, { label: '状态', key: 'status' },
                    { label: '地点', key: 'location' }, { label: '操作方', key: 'operator' },
                    { label: '终端', key: 'device' }, { label: '重量', key: 'weight' },
                    { label: '扫描时间', key: 'opTime' }, { label: '应完成', key: 'deadline' },
                    { label: '超时', value: function (r) { return r.isOvertime ? '是' : ''; } },
                    { label: '偏离', value: function (r) { return r.isDeviant ? '是' : ''; } },
                    { label: '结果', key: 'result' }, { label: '备注', key: 'remark' }
                ], rows));
            },
            'tk:scan': function () { TMS.shell.go('scan'); }
        })
    });

    /* ---------- 八、扫描记录 ---------- */

    /* 手工补录：扫描流水是环节时间与轨迹的唯一事实来源，
       漏扫必须能补，但补录要留操作方与备注，绝不能做成「随便改状态」的后门 */
    function scanFormModal() {
        ui.formModal({
            title: '补录扫描流水', size: 'wide',
            sub: '按单号补写作业痕迹：只追加流水，不改订单主状态',
            notice: '补录用于设备离线、漏扫等真实场景。节点时间一旦写入即参与时效与轨迹计算，请核对现场记录。',
            fields: [
                { key: 'orderId', label: '订单号', type: 'text', required: true, placeholder: 'HLAH20261029…', hint: '支持订单号或运单号' },
                { key: 'node', label: '作业节点', type: 'select', required: true, options: [{ value: '', label: '请选择' }].concat(ui.optionsOf(cfg.traceNodes, 'code', 'name')) },
                { key: 'at', label: '作业时间', type: 'datetime', hint: '留空即取当前时刻' },
                { key: 'location', label: '作业地点', type: 'text', placeholder: '武汉分拨中心' },
                { key: 'operator', label: '操作方', type: 'text', value: actor() },
                { key: 'device', label: '终端', type: 'select', options: [{ value: '', label: '节点默认终端' }].concat(ui.optionsOf(db.col('devices'), 'id', 'name')) },
                { key: 'weight', label: '称重(kg)', type: 'number', min: 0, hint: '仅称重节点需要，留空表示与计费重一致' },
                { key: 'result', label: '扫描结果', type: 'select', options: ui.optionsOf(['ok', '货物破损', '面单无法识别', '重复扫描', '拒收']) },
                { key: 'remark', label: '备注', type: 'textarea', rows: 2 }
            ],
            okText: '写入流水',
            onSubmit: function (data) {
                var key = String(data.orderId || '').trim();
                var o = db.get('orders', key) || db.findOne('orders', function (x) { return x.waybillNo === key; });
                if (!o) return '找不到单号 ' + key;
                if (!data.node) return '请选择作业节点';
                var scan = TMS.order.addScan(o, data.node, {
                    at: data.at || undefined, location: data.location, operator: data.operator,
                    device: data.device, weight: data.weight === '' ? undefined : data.weight,
                    result: data.result, remark: data.remark
                });
                TMS.audit.log('order.advance', 'orders', o.id,
                    '补录扫描 ' + cfg.nodeOf(scan.node).name + ' @' + scan.opTime, actor());
                ui.toast('已补录 ' + cfg.nodeOf(scan.node).name + ' · ' + o.id, 'success');
            }
        });
    }

    /* 扫描台账行：join 订单与节点字典，行本身没有单号/客户/节点名这些派生字段 */
    function scanRows(days) {
        var cutoff = util.addDays(util.now(), -(days || 7)).getTime();
        return db.col('scans').filter(function (s) { return util.toDate(s.opTime).getTime() >= cutoff; })
            .map(function (s) {
                var o = db.get('orders', s.orderId);
                var node = cfg.nodeOf(s.node);
                return {
                    id: s.orderId + '@' + s.opTime, scan: s, order: o, node: node, orderId: s.orderId,
                    waybillNo: o ? o.waybillNo : '', status: o ? o.status : '',
                    customer: o ? TMS.order.customerName(o) : '',
                    location: s.location || '', operator: s.operator || '系统',
                    device: TMS.order.deviceLabelOf(s), result: s.result || 'ok',
                    weight: s.weight, opTime: s.opTime, due: TMS.order.scanDeadline(s),
                    remark: s.remark || '', nodeName: node.name
                };
            })
            .sort(function (a, b) { return a.opTime < b.opTime ? 1 : -1; });
    }

    pg.define('scan', {
        sub: '扫描台账与手工补录：流水只追加、从不回改，纠错靠补一条更正流水',
        load: function (ctx) {
            return { ss: TMS.stats.scanStats(ctx.days), rows: scanRows(ctx.days) };
        },
        render: function (ctx, d) {
            var ss = d.ss;
            var kpi = ui.kpis([
                { label: '时间窗流水', value: fmt.number(ss.total), unit: '条', tone: 'brand', icon: '⌕', sub: '正常 ' + fmt.number(ss.ok) + ' 条' },
                { label: '异常结果', value: ss.exception, unit: '条', tone: ss.exception ? 'warn' : 'success', icon: '⚠', sub: '占比 ' + fmt.percent(ss.total ? util.round(ss.exception / ss.total * 100, 2) : 0) },
                { label: '在用终端', value: ss.byDevice.length, unit: '台', icon: '▣', sub: '默认终端不入排行' },
                { label: '作业节点', value: ss.byNode.length, unit: '个', icon: '◈', sub: '节点字典 ' + cfg.traceNodes.length + ' 项' }
            ]);
            var nodeCard = ui.card({
                title: '节点作业量', sub: '按扫描次数排序，识别作业瓶颈', flat: true,
                body: ch.hbars({ data: ss.byNode.slice(0, 10), rowH: 26, labelWidth: 116, valueWidth: 66, fmt: function (v) { return fmt.number(v); } })
            });
            var devCard = ui.card({
                title: '终端异常率', sub: '异常条数高的终端优先安排巡检', flat: true,
                body: ui.table({
                    dense: true, keyName: 'label', rows: ss.byDevice.slice(0, 8),
                    columns: [
                        { key: 'label', label: '终端' },
                        { key: 'count', label: '扫描', align: 'right', width: '76px', render: function (r) { return fmt.number(r.count); } },
                        { key: 'errors', label: '异常', align: 'right', width: '76px', render: function (r) { return r.errors ? ui.badge(r.errors, 'warn') : '<span class="tms-dim">0</span>'; } },
                        { key: 'rate', label: '异常率', align: 'right', width: '86px', sortable: false, render: function (r) { return '<span class="tms-dim">' + fmt.percent(r.count ? util.round(r.errors / r.count * 100, 2) : 0) + '</span>'; } }
                    ]
                })
            });
            return wrap(ctx, {
                actions: ui.btn('补录流水', { tone: 'primary', size: 'sm', act: 'sc:add', icon: '＋' }) +
                    ui.btn('导出台账', { size: 'sm', act: 'sc:export', icon: '⤓' }),
                body: [kpi, ui.split('2', [nodeCard, devCard]), grid(ctx, {
                    rows: d.rows, keyName: 'id', searchKey: 'q', pageSize: 20,
                    search: function (r) { return [r.orderId, r.waybillNo, r.customer, r.nodeName, r.location, r.operator, r.device, r.remark].join(' '); },
                    fields: [
                        { key: 'q', type: 'search', label: '单号 / 终端 / 地点', placeholder: 'HL… / PDA-9000 / 武汉' },
                        { key: 'node', label: '节点', options: [{ value: '', label: '全部节点' }].concat(ui.optionsOf(cfg.traceNodes, 'code', 'name')) },
                        { key: 'result', label: '结果', options: [{ value: '', label: '全部' }, { value: 'ok', label: '正常' }, { value: 'bad', label: '异常' }] }
                    ],
                    filter: function (r, fs) {
                        if (fs.node && r.scan.node !== fs.node) return false;
                        if (fs.result === 'ok' && r.result !== 'ok') return false;
                        if (fs.result === 'bad' && r.result === 'ok') return false;
                        return true;
                    },
                    columns: [
                        { key: 'opTime', label: '作业时间', width: '132px', render: function (r) { return ui.timeCell(r.opTime); } },
                        { key: 'orderId', label: '运单', render: function (r) { return idLink(r.orderId) + (r.customer ? ' <span class="tms-dim">' + esc(r.customer) + '</span>' : ''); } },
                        { key: 'node', label: '节点', width: '100px', render: function (r) { return ui.badge(esc(r.nodeName), r.node.stage === 'signed' ? 'success' : 'info'); } },
                        { key: 'location', label: '地点', width: '128px', render: function (r) { return dim(r.location); } },
                        { key: 'operator', label: '操作方', width: '96px' },
                        { key: 'device', label: '终端', width: '112px', render: function (r) { return '<span class="tms-dim">' + esc(r.device) + '</span>'; } },
                        { key: 'weight', label: '称重', align: 'right', width: '84px', render: function (r) { return r.weight == null ? '<span class="tms-dim">—</span>' : fmt.kg(r.weight); } },
                        { key: 'result', label: '结果', width: '110px', render: function (r) { return r.result === 'ok' ? '<span class="tms-dim">正常</span>' : ui.badge(esc(r.result), 'danger'); } },
                        { key: 'remark', label: '备注', render: function (r) { return dim(r.remark); } }
                    ],
                    emptyText: '时间窗内没有扫描流水', emptySub: '可点「补录流水」按单号补写'
                })]
            });
        },
        actions: merge(pg.shared, {
            'sc:add': function () { scanFormModal(); },
            'sc:export': function () {
                exportGrid({
                    rows: scanRows(curCtx().days), name: '扫描台账.csv', searchKey: 'q',
                    search: function (r) { return [r.orderId, r.waybillNo, r.customer, r.nodeName, r.location, r.operator, r.device].join(' '); },
                    filter: function (r, fs) {
                        if (fs.node && r.scan.node !== fs.node) return false;
                        if (fs.result === 'ok' && r.result !== 'ok') return false;
                        if (fs.result === 'bad' && r.result === 'ok') return false;
                        return true;
                    },
                    cols: [
                        { label: '作业时间', key: 'opTime' }, { label: '订单号', key: 'orderId' },
                        { label: '运单号', key: 'waybillNo' }, { label: '客户', key: 'customer' },
                        { label: '节点', key: 'nodeName' }, { label: '地点', key: 'location' },
                        { label: '操作方', key: 'operator' }, { label: '终端', key: 'device' },
                        { label: '称重', key: 'weight' }, { label: '应完成', key: 'due' },
                        { label: '结果', key: 'result' }, { label: '备注', key: 'remark' }
                    ]
                });
            }
        })
    });

    /* ---------- 九、分拣管理 ---------- */

    /* 格口号是派生值（orderId 哈希），落库只存偏离默认的少数行，
       所以看板必须按视图聚合，不能直接 groupBy 任务表 */
    function sortingRows() {
        return db.col('sortingTasks').map(TMS.operation.sortingTaskView).filter(Boolean);
    }

    function chuteModal(chute) {
        var list = sortingRows().filter(function (t) { return t.chute === chute && t.status !== 'done'; });
        ui.modal({
            title: esc('格口 ' + chute),
            sub: list.length + ' 件待分拣 · 合计 ' + fmt.kg(util.sum(list, 'weight')) + ' · 目的 ' +
                util.unique(list.map(function (t) { return t.destination; })).slice(0, 4).join('、'),
            body: ui.table({
                dense: true, keyName: 'id', rows: list.slice(0, 40),
                columns: [
                    { key: 'orderId', label: '运单', sortable: false, render: function (t) { return idLink(t.orderId); } },
                    { key: 'destination', label: '目的', width: '84px' },
                    { key: 'pieces', label: '件数', align: 'right', width: '64px' },
                    { key: 'weight', label: '计费重', align: 'right', width: '84px', render: function (t) { return fmt.kg(t.weight); } },
                    { key: 'priority', label: '优先级', width: '72px', render: function (t) { return ui.badge(esc(t.priority), t.priority === '高' ? 'warn' : 'muted'); } },
                    { key: 'status', label: '状态', width: '84px', render: function (t) { return statusBadge(t.status); } }
                ]
            }),
            footer: ui.btn('整格口过站', { tone: 'primary', size: 'sm', act: 'st:chute', arg: chute }) +
                ui.btn('关闭', { act: 'ui:close' })
        });
    }

    function sortFinishModal(id) {
        var t = TMS.operation.sortingTaskView(db.get('sortingTasks', id));
        if (!t) { ui.toast('任务不存在', 'warn'); return; }
        ui.formModal({
            title: '完成分拣', sub: esc(t.orderId) + ' · ' + esc(t.origin) + ' → ' + esc(t.destination),
            values: { operator: t.operator || '分拣员', chute: t.chute, actualMinutes: t.stdMinutes },
            fields: [
                { key: 'operator', label: '分拣员', type: 'text' },
                { key: 'chute', label: '实际格口', type: 'text', hint: '与推荐格口不一致才写入流水' },
                { key: 'actualMinutes', label: '实际用工(分钟)', type: 'number', min: 1 },
                { key: 'result', label: '分拣结果', type: 'select', options: ui.optionsOf(['正常分拣', '错分纠正', '件损上报', '面单补打']) },
                { key: 'at', label: '完成时间', type: 'datetime', hint: '留空取当前时刻' }
            ],
            okText: '提交',
            onSubmit: function (data) {
                var res = TMS.operation.finishSortingTask(id, {
                    operator: data.operator, chute: data.chute, actualMinutes: Number(data.actualMinutes) || undefined,
                    result: data.result, at: data.at || undefined
                });
                ui.toast(res ? ('分拣完成：实际用工 ' + res.actualMinutes + ' 分钟（标准 ' + t.stdMinutes + '）') : '任务不存在',
                    res ? 'success' : 'error');
            }
        });
    }

    pg.define('sorting', {
        sub: '分拣是干线的前置：格口看板按目的分拨聚合，过站即推 sorted 并生成装车候选',
        load: function (ctx) {
            var rows = sortingRows();
            var open = rows.filter(function (t) { return t.status !== 'done'; });
            var done = rows.filter(function (t) { return t.status === 'done'; });
            var today = util.dateKey(util.now());
            return {
                rows: rows, board: TMS.operation.sortingBoard(''),
                hubs: db.col('hubs'),
                k: {
                    open: open.length, pieces: util.sum(open, 'pieces'), chutes: TMS.operation.sortingBoard('').length,
                    done: done.length, today: done.filter(function (t) { return (t.finishedAt || '').slice(0, 10) === today; }).length,
                    stdMin: util.round(open.length ? util.sum(open, 'stdMinutes') / open.length : 0, 1),
                    realMin: util.round(done.length ? util.sum(done, 'actualMinutes') / done.length : 0, 1),
                    errors: rows.filter(function (t) { return t.result && t.result !== '正常分拣'; }).length
                }
            };
        },
        render: function (ctx, d) {
            var k = d.k;
            var kpi = ui.kpis([
                { label: '待分拣任务', value: k.open, unit: '单', tone: k.open > 60 ? 'warn' : 'brand', icon: '⛁', sub: fmt.number(k.pieces) + ' 件在格口前' },
                { label: '今日完成', value: k.today, unit: '单', tone: 'success', icon: '✓', sub: '累计完成 ' + k.done + ' 单' },
                { label: '在用格口', value: k.chutes, unit: '个', icon: '▦', sub: '按目的分拨自动分线' },
                { label: '单均用工', value: k.realMin, unit: '分钟', tone: k.realMin > k.stdMin ? 'warn' : 'success', icon: '◷', sub: '标准 ' + k.stdMin + ' 分钟' },
                { label: '异常分拣', value: k.errors, unit: '单', tone: k.errors ? 'danger' : 'muted', icon: '⚠', sub: '错分/件损/补打面单' }
            ]);
            var boardCard = ui.card({
                title: '格口看板', sub: '积压最多的格口先清，整格口过站不必逐件扫描', flat: true,
                body: ui.table({
                    dense: true, keyName: 'chute', rows: d.board.slice(0, 10), onRow: 'st:chute',
                    emptyText: '格口已清空', emptySub: '当前没有待分拣任务',
                    columns: [
                        { key: 'chute', label: '格口', render: function (b) { return '<b>' + esc(b.chute) + '</b>'; } },
                        { key: 'hubId', label: '分拨', width: '120px', render: function (b) { return esc(pg.hubName(b.hubId)); } },
                        { key: 'tasks', label: '待分拣', align: 'right', width: '84px' },
                        { key: 'pieces', label: '件数', align: 'right', width: '76px' },
                        { key: 'weight', label: '重量', align: 'right', width: '96px', render: function (b) { return fmt.kg(b.weight); } },
                        { key: 'urgent', label: '加急', align: 'right', width: '72px', render: function (b) { return b.urgent ? ui.badge(b.urgent, 'warn') : '<span class="tms-dim">0</span>'; } },
                        { key: 'destinations', label: '主要目的', sortable: false, render: function (b) { return '<span class="tms-dim">' + esc(b.destinations.join('、')) + '</span>'; } }
                    ]
                })
            });
            return wrap(ctx, {
                actions: ui.btn('导出发分选', { size: 'sm', act: 'st:export', icon: '⤓' }),
                body: [kpi, boardCard, grid(ctx, {
                    rows: d.rows, keyName: 'id', searchKey: 'q', pageSize: 20,
                    search: function (t) { return [t.orderId, t.waybillNo, t.customer, t.origin, t.destination, t.chute, t.operator].join(' '); },
                    fields: [
                        { key: 'q', type: 'search', label: '单号 / 客户 / 格口', placeholder: 'HL… / 格口 L3' },
                        { key: 'hub', label: '分拨', options: [{ value: '', label: '全部分拨' }].concat(ui.optionsOf(d.hubs, 'id', 'name')) },
                        { key: 'status', label: '任务状态', options: [{ value: '', label: '全部' }].concat(ui.optionsOf(['pending', 'processing', 'done'])) },
                        { key: 'prio', label: '优先级', options: [{ value: '', label: '全部' }, { value: '高', label: '仅加急' }] }
                    ],
                    filter: function (t, fs) {
                        if (fs.hub && t.hubId !== fs.hub) return false;
                        if (fs.status && t.status !== fs.status) return false;
                        if (fs.prio === '高' && t.priority !== '高') return false;
                        return true;
                    },
                    columns: [
                        { key: 'id', label: '任务号', width: '128px', render: function (t) { return idLink(t.id, 'st:open'); } },
                        { key: 'orderId', label: '运单', render: function (t) { return idLink(t.orderId) + (t.customer ? ' <span class="tms-dim">' + esc(t.customer) + '</span>' : ''); } },
                        { key: 'line', label: '分拣线', width: '76px' },
                        { key: 'chute', label: '格口', width: '70px' },
                        { key: 'destination', label: '目的', width: '84px', render: function (t) { return esc(t.origin) + ' → ' + esc(t.destination); } },
                        { key: 'pieces', label: '件数', align: 'right', width: '64px' },
                        { key: 'stdMinutes', label: '标准/实际', align: 'right', width: '104px', render: function (t) {
                            return t.actualMinutes
                                ? esc(t.actualMinutes) + ' <span class="tms-dim">/ ' + t.stdMinutes + '</span>'
                                : '<span class="tms-dim">— / ' + t.stdMinutes + '</span>';
                        } },
                        { key: 'priority', label: '优先', width: '68px', render: function (t) { return ui.badge(esc(t.priority), t.priority === '高' ? 'warn' : 'muted'); } },
                        { key: 'status', label: '状态', width: '84px', render: function (t) { return statusBadge(t.status); } },
                        { key: 'ops', label: '操作', width: '116px', sortable: false, render: function (t) {
                            if (t.status === 'done') return ui.link('查看', 'st:open', t.id, { tone: 'ghost' });
                            if (t.status === 'processing') return ui.link('完成', 'st:finish', t.id, { tone: 'ghost' });
                            return ui.link('开始', 'st:start', t.id, { tone: 'ghost' });
                        } }
                    ],
                    emptyText: '没有符合条件的分拣任务'
                })]
            });
        },
        actions: {
            'st:open': function (id) {
                var t = db.get('sortingTasks', id);
                if (!t) { ui.toast('分拣任务不存在或已归档', 'warn'); return; }
                chuteModal(TMS.operation.sortingTaskView(t).chute);
            },
            'st:chute': function (chute) { chuteModal(chute); },
            'st:start': function (id) {
                TMS.operation.startSorting(id, { operator: actor() });
                ui.toast('任务 ' + id + ' 已开始分拣', 'success');
            },
            'st:finish': function (id) { sortFinishModal(id); },
            'st:export': function () {
                exportGrid({
                    name: '分拣任务.csv',
                    cols: [
                        { label: '任务号', key: 'id' }, { label: '订单号', key: 'orderId' }, { label: '运单号', key: 'waybillNo' },
                        { label: '客户', key: 'customer' }, { label: '始发', key: 'origin' }, { label: '目的', key: 'destination' },
                        { label: '分拣线', key: 'line' }, { label: '格口', key: 'chute' }, { label: '件数', key: 'pieces' },
                        { label: '计费重', key: 'weight' }, { label: '标准分钟', key: 'stdMinutes' }, { label: '实际分钟', key: 'actualMinutes' },
                        { label: '优先级', key: 'priority' }, { label: '状态', key: 'status' },
                        { label: '分拣员', key: 'operator' }, { label: '结果', key: 'result' }, { label: '完成时间', key: 'finishedAt' }
                    ]
                });
            }
        }
    });

    /* ---------- 十、装卸作业 ---------- */

    function loadingModal(id) {
        var t = TMS.operation.loadingTaskView(db.get('loadingTasks', id));
        if (!t) { ui.toast('任务不存在', 'warn'); return; }
        var tr = db.get('transports', t.transportId);
        ui.modal({
            title: esc('装卸 ' + t.id),
            sub: esc(t.tripCode) + ' · ' + esc(pg.hubName(t.hubId)) + ' 发运 · 车厢 ' + esc(t.containerNo),
            body: ui.stack([
                ui.desc([
                    { label: '状态', value: statusBadge(t.status) },
                    { label: '装卸量', value: fmt.number(t.pieces) + ' 件 / ' + fmt.kg(t.weight) },
                    { label: '体积', value: util.round(t.volumeM3, 2) + ' m³' },
                    { label: '关联订单', value: t.orders + ' 单' },
                    { label: '标准工时', value: t.stdMinutes + ' 分钟' },
                    { label: '实际用工', value: t.actualMinutes ? t.actualMinutes + ' 分钟' : '—' },
                    { label: '装卸组', value: dim(t.operator) },
                    { label: '完成时间', value: t.finishedAt ? fmt.dateTime(t.finishedAt) : '—' }
                ], { inline: true }),
                tr ? ui.notice('车次 ' + esc(tr.id) + ' 当前状态：' + esc(pg.TRIP_TEXT[tr.status] || tr.status) +
                    ' · 装载率 ' + fmt.percent(tr.loadRate || 0), tr.status === 'pending' ? 'info' : 'success') : ''
            ]),
            footer: t.status === 'done' ? ui.btn('关闭', { act: 'ui:close' })
                : ui.btn('登记完成', { tone: 'primary', size: 'sm', act: 'ld:finish', arg: t.id }) + ui.btn('关闭', { act: 'ui:close' })
        });
    }

    function loadingFinishModal(id) {
        var t = TMS.operation.loadingTaskView(db.get('loadingTasks', id));
        if (!t) { ui.toast('任务不存在', 'warn'); return; }
        ui.formModal({
            title: '登记装卸完成', sub: esc(t.tripCode) + ' · 标准工时 ' + t.stdMinutes + ' 分钟',
            values: { operator: t.operator || '装卸组长' },
            fields: [
                { key: 'operator', label: '装卸组长', type: 'text' },
                { key: 'actualMinutes', label: '实际用工(分钟)', type: 'number', min: 1, value: t.stdMinutes },
                { key: 'damageCount', label: '件损数量', type: 'number', min: 0, hint: '大于 0 会同时进入异常台账' },
                { key: 'photo', label: '已上传装车照片', type: 'checkbox' }
            ],
            okText: '提交',
            onSubmit: function (data) {
                var res = TMS.operation.finishLoading(id, {
                    operator: data.operator, actualMinutes: Number(data.actualMinutes) || undefined,
                    damageCount: Number(data.damageCount) || undefined, photo: data.photo
                });
                if (res && Number(data.damageCount) > 0) {
                    var tr = db.get('transports', t.transportId);
                    var first = tr ? TMS.operation.ordersOfTrip(tr.id)[0] : null;
                    if (first) TMS.order.markProblem(first.id, { type: '货物破损', description: '装车件损 ' + data.damageCount + ' 件', operator: data.operator });
                }
                ui.toast(res ? ('装卸完成：实际 ' + res.actualMinutes + ' 分钟') : '任务不存在', res ? 'success' : 'error');
            }
        });
    }

    pg.define('loading', {
        sub: '装卸挂车次不挂单件：一车一次任务，件损按车次首单登记进异常台账',
        load: function (ctx) {
            var rows = db.col('loadingTasks').map(TMS.operation.loadingTaskView).filter(Boolean);
            var done = rows.filter(function (t) { return t.status === 'done'; });
            var open = rows.filter(function (t) { return t.status !== 'done'; });
            return {
                rows: rows,
                waiting: db.col('transports').filter(function (tr) { return tr.status === 'pending'; }),
                k: {
                    open: open.length, done: done.length,
                    pieces: util.sum(open, 'pieces'), weight: util.round(util.sum(open, 'weight'), 1),
                    stdMin: util.round(open.length ? util.sum(open, 'stdMinutes') / open.length : 0, 1),
                    realMin: util.round(done.length ? util.sum(done, 'actualMinutes') / done.length : 0, 1),
                    damage: util.sum(rows, 'damageCount')
                }
            };
        },
        render: function (ctx, d) {
            var k = d.k;
            var kpi = ui.kpis([
                { label: '待装卸任务', value: k.open, unit: '次', tone: k.open ? 'warn' : 'success', icon: '⛃', sub: fmt.number(k.pieces) + ' 件待发' },
                { label: '已完成', value: k.done, unit: '次', tone: 'success', icon: '✓', sub: '累计件损 ' + k.damage + ' 件' },
                { label: '待装卸重量', value: fmt.number(k.weight), unit: 'kg', icon: '⚖', sub: '按车次装载量汇总' },
                { label: '单均用工', value: k.realMin, unit: '分钟', tone: k.realMin > k.stdMin ? 'warn' : 'success', icon: '◷', sub: '标准 ' + k.stdMin + ' 分钟' }
            ]);
            var pendCard = d.waiting.length ? ui.card({
                title: '待发车次的装卸准备', sub: '未建任务的_pending 车次可直接派装卸组', flat: true,
                body: ui.table({
                    dense: true, keyName: 'id', rows: d.waiting.slice(0, 8),
                    columns: [
                        { key: 'id', label: '车次', sortable: false, render: function (tr) { return idLink(tr.id, 'ld:trip'); } },
                        { key: 'fromHub', label: '起讫', render: function (tr) { return esc(pg.hubName(tr.fromHub)) + ' → ' + esc(pg.hubName(tr.toHub)); } },
                        { key: 'departAt', label: '计划发车', width: '96px' },
                        { key: 'orders', label: '订单', align: 'right', width: '72px' },
                        { key: 'pieces', label: '件数', align: 'right', width: '72px' },
                        { key: 'weight', label: '重量', align: 'right', width: '96px', render: function (tr) { return fmt.kg(tr.weight); } },
                        { key: 'ops', label: '操作', width: '104px', sortable: false, render: function (tr) { return ui.link('派装卸组', 'ld:create', tr.id, { tone: 'ghost' }); } }
                    ]
                })
            }) : ui.card({ title: '待发车次', body: ui.empty('没有待发车车次', '所有车次均已完成装卸') });
            return wrap(ctx, {
                actions: ui.btn('导出装卸', { size: 'sm', act: 'ld:export', icon: '⤓' }),
                body: [kpi, pendCard, grid(ctx, {
                    rows: d.rows, keyName: 'id', searchKey: 'q', pageSize: 20,
                    search: function (t) { return [t.id, t.transportId, t.tripCode, t.containerNo, t.operator].join(' '); },
                    fields: [
                        { key: 'q', type: 'search', label: '任务号 / 车次 / 箱号', placeholder: 'LDG… / TRP… / CTR…' },
                        { key: 'hub', label: '发运分拨', options: [{ value: '', label: '全部分拨' }].concat(ui.optionsOf(db.col('hubs'), 'id', 'name')) },
                        { key: 'status', label: '状态', options: [{ value: '', label: '全部' }].concat(ui.optionsOf(['pending', 'processing', 'done'])) }
                    ],
                    filter: function (t, fs) {
                        if (fs.hub && t.hubId !== fs.hub) return false;
                        if (fs.status && t.status !== fs.status) return false;
                        return true;
                    },
                    columns: [
                        { key: 'id', label: '任务号', width: '128px', render: function (t) { return idLink(t.id, 'ld:open'); } },
                        { key: 'transportId', label: '车次', render: function (t) { return idLink(t.transportId, 'ld:trip') + ' <span class="tms-dim">' + esc(t.tripCode) + '</span>'; } },
                        { key: 'hubId', label: '发运分拨', width: '128px', render: function (t) { return esc(pg.hubName(t.hubId)); } },
                        { key: 'containerNo', label: '车厢', width: '92px' },
                        { key: 'orders', label: '订单', align: 'right', width: '72px' },
                        { key: 'pieces', label: '件数', align: 'right', width: '72px' },
                        { key: 'weight', label: '重量', align: 'right', width: '96px', render: function (t) { return fmt.kg(t.weight); } },
                        { key: 'stdMinutes', label: '标准/实际', align: 'right', width: '104px', render: function (t) {
                            return t.actualMinutes ? esc(t.actualMinutes) + ' <span class="tms-dim">/ ' + t.stdMinutes + '</span>'
                                : '<span class="tms-dim">— / ' + t.stdMinutes + '</span>';
                        } },
                        { key: 'damageCount', label: '件损', align: 'right', width: '72px', render: function (t) { return t.damageCount ? ui.badge(t.damageCount, 'danger') : '<span class="tms-dim">0</span>'; } },
                        { key: 'status', label: '状态', width: '84px', render: function (t) { return statusBadge(t.status); } },
                        { key: 'ops', label: '操作', width: '104px', sortable: false, render: function (t) {
                            return t.status === 'done' ? ui.link('查看', 'ld:open', t.id, { tone: 'ghost' }) : ui.link('登记完成', 'ld:finish', t.id, { tone: 'ghost' });
                        } }
                    ]
                })]
            });
        },
        actions: merge(pg.shared, {
            'ld:open': function (id) { loadingModal(id); },
            'ld:trip': function (id) { tripModal(id); },
            'ld:finish': function (id) { loadingFinishModal(id); },
            'ld:create': function (transportId) {
                var t = TMS.operation.createLoadingTask({ transportId: transportId });
                db.commit('loadingTasks', t && t.id, 'loading:create');
                ui.toast(t ? ('已派装卸组：' + t.id) : '车次不存在或已有任务', t ? 'success' : 'warn');
            },
            'ld:export': function () {
                exportGrid({
                    name: '装卸任务.csv',
                    cols: [
                        { label: '任务号', key: 'id' }, { label: '车次', key: 'transportId' }, { label: '班次', key: 'tripCode' },
                        { label: '分拨', value: function (t) { return pg.hubName(t.hubId); } }, { label: '车厢', key: 'containerNo' },
                        { label: '订单数', key: 'orders' }, { label: '件数', key: 'pieces' }, { label: '重量', key: 'weight' },
                        { label: '体积m3', key: 'volumeM3' }, { label: '标准分钟', key: 'stdMinutes' }, { label: '实际分钟', key: 'actualMinutes' },
                        { label: '件损', key: 'damageCount' }, { label: '状态', value: function (t) { return pg.TRIP_TEXT[t.status] || t.status; } },
                        { label: '装卸组', key: 'operator' }, { label: '完成时间', key: 'finishedAt' }
                    ]
                });
            }
        })
    });

    /* ---------- 十一、车次调度 ---------- */

    /* 车次详情是装卸、派送、财务三个页面共同的落点，函数放在页面外供跨页动作复用 */
    function tripModal(id) {
        var tr = db.get('transports', id);
        if (!tr) { ui.toast('车次不存在', 'warn'); return; }
        var v = TMS.operation.tripView(tr);
        var cv = TMS.operation.costView(tr);
        var orders = TMS.operation.ordersOfTrip(id);
        ui.modal({
            title: esc(v.code), size: 'wide',
            sub: esc(pg.hubName(tr.fromHub)) + ' → ' + esc(pg.hubName(tr.toHub)) + (tr.toCity ? '（' + esc(tr.toCity) + '）' : '') +
                ' · ' + esc(v.status ? (pg.TRIP_TEXT[tr.status] || tr.status) : '') + ' · ' + esc(tr.dispatchType === 'ltl' ? '外协零担舱位' : '自有整车'),
            body: ui.stack([
                ui.desc([
                    { label: '车次号', value: ui.idCell(tr.id, '') },
                    { label: '执行方', value: esc(v.carrier || (v.plate + ' / ' + v.driver)) },
                    { label: '车型', value: dim(v.vt) },
                    { label: '载重 / 容量', value: fmt.kg(v.capacityKg) },
                    { label: '装载率', value: rateBar(tr.loadRate || 0, { target: 70 }) },
                    { label: '订单 / 件数', value: orders.length + ' 单 · ' + fmt.number(tr.pieces) + ' 件' },
                    { label: '实载重量', value: fmt.kg(tr.weight) },
                    { label: '体积', value: util.round(v.volumeM3, 2) + ' m³' },
                    { label: '里程 / 在途', value: fmt.km(v.distanceKm) + ' · ' + fmt.duration(v.transitHours) },
                    { label: '计划发车', value: esc(tr.departAt) },
                    { label: '实际发车', value: v.departedAt ? fmt.dateTime(v.departedAt) : '—' },
                    { label: '实际到达', value: v.completedAt ? fmt.dateTime(v.completedAt) : '—' },
                    { label: '准点', value: v.onTime ? ui.badge('准点', 'success') : ui.badge('晚点', 'warn') },
                    { label: '单公斤成本', value: fmt.money(v.costPerKg) + ' /kg' },
                    { label: '车次总成本', value: ui.moneyCell(cv.total, { strong: true }) },
                    { label: '在途上报', value: v.position ? esc(v.position) + ' · ' + fmt.dateTime(v.lastReportAt) : '—' }
                ], { inline: true }),
                ui.card({
                    title: '成本构成', sub: cv.basis + '（自有按里程反算油/路/桥/司机/折旧，外协只记采购价）', flat: true,
                    body: cv.kg
                        ? ui.desc([
                            { label: '采购单价', value: fmt.money(cv.ratePerKg) + ' /kg' },
                            { label: '实载', value: fmt.kg(cv.kg) },
                            { label: '结算金额', value: ui.moneyCell(cv.total, { strong: true }) }
                        ], { inline: true })
                        : ui.meter([
                            { value: cv.fuel, color: ch.color(0) }, { value: cv.toll, color: ch.color(1) },
                            { value: cv.driver, color: ch.color(2) }, { value: cv.fixed, color: ch.color(3) }
                        ]) + ui.table({
                            dense: true, keyName: 'k',
                            rows: [
                                { k: '燃油', v: cv.fuel }, { k: '路桥', v: cv.toll },
                                { k: '司机', v: cv.driver }, { k: '折旧保险', v: cv.fixed }
                            ],
                            columns: [
                                { key: 'k', label: '成本项', sortable: false },
                                { key: 'v', label: '金额', align: 'right', sortable: false, render: function (r) { return ui.moneyCell(r.v); } },
                                { key: 'p', label: '占比', align: 'right', sortable: false, render: function (r) { return '<span class="tms-dim">' + fmt.percent(cv.total ? util.round(r.v / cv.total * 100, 1) : 0) + '</span>'; } }
                            ]
                        })
                }),
                ui.card({
                    title: '在车订单', sub: orders.length + ' 单（装载量与成本由订单侧反算）', flat: true,
                    body: ui.table({
                        dense: true, keyName: 'id', rows: orders.slice(0, 30),
                        columns: [
                            { key: 'id', label: '运单', sortable: false, render: function (o) { return idLink(o.id); } },
                            { key: 'destination', label: '目的', width: '84px' },
                            { key: 'service', label: '服务', width: '76px' },
                            { key: 'pieces', label: '件数', align: 'right', width: '64px' },
                            { key: 'chargeableWeight', label: '计费重', align: 'right', width: '90px', render: function (o) { return fmt.kg(o.chargeableWeight); } },
                            { key: 'freight', label: '运费', align: 'right', width: '96px', render: function (o) { return ui.moneyCell(o.freight); } },
                            { key: 'status', label: '状态', width: '84px', render: function (o) { return ui.statusBadge(o.status); } }
                        ]
                    })
                })
            ]),
            footer: tripFootBtns(tr) + ui.btn('关闭', { act: 'ui:close' })
        });
    }

    /* 车次按钮按状态机出：pending 才能发车、departed 才能到达，
       把不可用的动作摆在弹窗里点了才报错，等于把状态机推到用户脸上 */
    function tripFootBtns(tr) {
        var s = tr.status;
        if (s === 'pending') return ui.btn('确认发车', { tone: 'primary', size: 'sm', act: 'tp:depart', arg: tr.id }) +
            ui.btn('在途上报', { size: 'sm', act: 'tp:report', arg: tr.id });
        if (s === 'loading') return ui.btn('确认发车', { tone: 'primary', size: 'sm', act: 'tp:depart', arg: tr.id });
        if (s === 'departed') return ui.btn('登记到达', { tone: 'primary', size: 'sm', act: 'tp:arrive', arg: tr.id }) +
            ui.btn('在途上报', { size: 'sm', act: 'tp:report', arg: tr.id }) +
            ui.btn('上报异常', { tone: 'danger', size: 'sm', act: 'tp:exc', arg: tr.id });
        if (s === 'arrived') return ui.btn('回场完成', { tone: 'primary', size: 'sm', act: 'tp:complete', arg: tr.id });
        return '';
    }

    function dispatchModal() {
        var hubs = db.col('hubs');
        var waiting = db.col('orders').filter(function (o) { return o.status === 'sorted'; });
        var byHub = util.countBy(waiting, 'hubFrom');
        ui.formModal({
            title: '自动配载建车次', size: 'wide',
            sub: '按「已分拣 + 同一目的分拨」凑载，自有整车与外协舱位取成本低点',
            extra: ui.table({
                dense: true, keyName: 'hub',
                rows: hubs.map(function (h) { return { hub: h.name, n: byHub[h.id] || 0, mode: '' }; }).filter(function (r) { return r.n; }),
                columns: [
                    { key: 'hub', label: '发运分拨', sortable: false },
                    { key: 'n', label: '待装车单量', align: 'right', sortable: false, render: function (r) { return ui.badge(r.n, r.n > 20 ? 'warn' : 'info'); } }
                ]
            }),
            values: { minOrders: 2, limit: 40 },
            fields: [
                { key: 'hubId', label: '发运分拨', type: 'select', options: [{ value: '', label: '全部分拨（按目的枢纽分组）' }].concat(ui.optionsOf(hubs, 'id', 'name')) },
                { key: 'minOrders', label: '起载票数', type: 'number', min: 1, hint: '少于该票数不建班，避免为三五个件开整车' },
                { key: 'limit', label: '单车上限', type: 'number', min: 1 },
                { key: 'mode', label: '指定方式', type: 'select', options: [{ value: '', label: '按班次与货量自动' }].concat(ui.optionsOf(['陆运', '空运', '冷链'])) }
            ],
            okText: '执行配载',
            onSubmit: function (data) {
                var res = TMS.operation.dispatch(data.hubId || '', {
                    minOrders: Number(data.minOrders) || 2, limit: Number(data.limit) || 40,
                    mode: data.mode || undefined
                });
                if (!res.ok) return res.message;
                ui.toast(res.created.length + ' 个车次已建，装载量与成本按实载重算', 'success');
            }
        });
    }

    pg.define('transport', {
        sub: '车次是运力的执行单位：自有整车与外协舱位取成本低点，装载率与成本由在车订单反算',
        load: function (ctx) {
            applyParamFilter(ctx, ['hub', 'type', 'q']);
            var rows = db.col('transports').map(TMS.operation.tripView).filter(Boolean)
                .sort(function (a, b) { return (a.date + a.departAt) < (b.date + b.departAt) ? 1 : -1; });
            var ts = TMS.operation.tripStats(ctx.days);
            var win = rows.filter(function (t) { return util.toDate(t.date || t.createdAt).getTime() >= util.addDays(util.now(), -ctx.days).getTime(); });
            return {
                rows: rows, ts: ts,
                byStatus: util.countBy(rows, 'status'),
                trend: (function () {
                    var g = util.groupBy(win, 'date');
                    return Object.keys(g).sort().map(function (k) {
                        return { label: k.slice(5), cost: util.round(util.sum(g[k], TMS.operation.costTotal), 0), weight: util.round(util.sum(g[k], 'weight'), 1) };
                    });
                })(),
                loadRank: util.sortBy(win.filter(function (t) { return t.dispatchType !== 'ltl'; }), 'loadRate', 'desc').slice(0, 8),
                costRank: util.sortBy(win, 'costPerKg', 'desc').slice(0, 8)
            };
        },
        render: function (ctx, d) {
            var ts = d.ts;
            var kpi = ui.kpis([
                { label: '时间窗车次', value: ts.total, unit: '次', tone: 'brand', icon: '⛴', sub: '在途 ' + ts.departed + ' · 已达 ' + ts.arrived },
                { label: '自有 / 外协', value: ts.self + ' / ' + ts.ltl, icon: '⇄', sub: '外协占比 ' + fmt.percent(ts.total ? util.round(ts.ltl / ts.total * 100, 1) : 0) },
                { label: '干线货量', value: fmt.number(ts.weight), unit: 'kg', icon: '⚖', sub: fmt.number(ts.orders) + ' 单 / ' + fmt.km(ts.km) },
                { label: '单公斤干线成本', value: fmt.money(ts.costPerKg), unit: '/kg', tone: ts.costPerKg > 1.2 ? 'warn' : 'success', icon: '¥', sub: '车次成本合计 ' + fmt.money(ts.cost) },
                { label: '自有平均装载率', value: ts.avgLoadRate, unit: '%', tone: ts.avgLoadRate < 60 ? 'danger' : 'success', icon: '▦', sub: '低于 60% 即大车拉小货' },
                { label: '车次准点率', value: ts.onTimeRate, unit: '%', tone: ts.onTimeRate >= 92 ? 'success' : 'warn', icon: '◷', sub: '按班次在途时长判定' }
            ]);
            var trendCard = ui.card({
                title: '车次成本与货量', sub: '柱：车次成本 · 线：实载重量（' + ctx.days + ' 日）', flat: true,
                body: ch.combo({
                    labels: d.trend.map(function (x) { return x.label; }),
                    bars: d.trend.map(function (x) { return x.cost; }),
                    line: d.trend.map(function (x) { return x.weight; }),
                    barName: '车次成本', lineName: '实载 kg', height: 250,
                    fmt: function (v) { return fmt.money(v); }
                })
            });
            var loadCard = ui.card({
                title: '自有车次装载率 TOP', sub: '装载率决定自有整车是否比买舱位划算', flat: true,
                body: ch.hbars({
                    data: d.loadRank.map(function (t) { return { label: t.code, value: t.loadRate || 0 }; }),
                    rowH: 26, labelWidth: 150, valueWidth: 66, fmt: function (v) { return fmt.percent(v); }
                })
            });
            var costCard = ui.card({
                title: '单公斤成本最高', sub: '成本异常的车次多为小票长线，应改走外协零担', flat: true,
                body: ch.hbars({
                    data: d.costRank.map(function (t) { return { label: t.code, value: t.costPerKg || 0 }; }),
                    rowH: 26, labelWidth: 150, valueWidth: 76, fmt: function (v) { return fmt.money(v); }
                })
            });
            return wrap(ctx, {
                actions: ui.btn('自动配载', { tone: 'primary', size: 'sm', act: 'tp:dispatch', icon: '＋' }) +
                    ui.btn('导出车次', { size: 'sm', act: 'tp:export', icon: '⤓' }),
                body: [kpi, trendCard, ui.split('2', [loadCard, costCard]), grid(ctx, {
                    rows: d.rows, keyName: 'id', onRow: 'tp:open', searchKey: 'q', pageSize: 20,
                    search: function (t) { return [t.id, t.code, t.plate, t.driver, t.carrier, t.fromHub, t.toHub, t.toCity].join(' '); },
                    fields: [
                        { key: 'q', type: 'search', label: '车次 / 班次 / 车牌', placeholder: 'TRP… / 沪A12345' },
                        { key: 'status', label: '状态', options: [{ value: '', label: '全部状态' }].concat(ui.optionsOf(Object.keys(pg.TRIP_TEXT))) },
                        { key: 'hub', label: '发运分拨', options: [{ value: '', label: '全部分拨' }].concat(ui.optionsOf(db.col('hubs'), 'id', 'name')) },
                        { key: 'type', label: '运力', options: [{ value: '', label: '全部' }, { value: 'self', label: '自有整车' }, { value: 'ltl', label: '外协舱位' }] }
                    ],
                    filter: function (t, fs) {
                        if (fs.status && t.status !== fs.status) return false;
                        if (fs.hub && t.fromHub !== fs.hub) return false;
                        if (fs.type && t.dispatchType !== fs.type) return false;
                        return true;
                    },
                    columns: [
                        { key: 'id', label: '车次', width: '128px', render: function (t) { return idLink(t.id, 'tp:open'); } },
                        { key: 'code', label: '班次 / 线路', render: function (t) { return esc(t.code) + (t.toCity ? ' <span class="tms-dim">' + esc(t.toCity) + '</span>' : ''); } },
                        { key: 'dispatchType', label: '运力', width: '92px', render: function (t) { return ui.badge(t.dispatchType === 'ltl' ? '外协舱位' : '自有整车', t.dispatchType === 'ltl' ? 'info' : 'brand'); } },
                        { key: 'mode', label: '方式', width: '70px' },
                        { key: 'plate', label: '执行方', render: function (t) { return t.dispatchType === 'ltl' ? dim(t.carrier) : esc(t.plate) + ' <span class="tms-dim">' + esc(t.driver) + '</span>'; } },
                        { key: 'orders', label: '单/件', align: 'right', width: '84px', render: function (t) { return t.orders + ' / ' + t.pieces; } },
                        { key: 'weight', label: '实载', align: 'right', width: '96px', render: function (t) { return fmt.kg(t.weight); } },
                        { key: 'loadRate', label: '装载率', align: 'right', width: '104px', render: function (t) { return t.dispatchType === 'ltl' ? '<span class="tms-dim">—</span>' : rateBar(t.loadRate || 0, { target: 70 }); } },
                        { key: 'costPerKg', label: '成本/kg', align: 'right', width: '96px', render: function (t) { return fmt.money(t.costPerKg); } },
                        { key: 'departedAt', label: '发车', width: '128px', sortable: false, render: function (t) { return t.departedAt ? ui.timeCell(t.departedAt) : '<span class="tms-dim">计划 ' + esc(t.departAt) + '</span>'; } },
                        { key: 'status', label: '状态', width: '84px', render: function (t) { return statusBadge(t.status, pg.TRIP_TEXT); } },
                        { key: 'ops', label: '操作', width: '112px', sortable: false, render: function (t) {
                            if (t.status === 'pending' || t.status === 'loading') return ui.link('发车', 'tp:depart', t.id, { tone: 'ghost' });
                            if (t.status === 'departed') return ui.link('到达', 'tp:arrive', t.id, { tone: 'ghost' });
                            if (t.status === 'arrived') return ui.link('回场', 'tp:complete', t.id, { tone: 'ghost' });
                            return ui.link('详情', 'tp:open', t.id, { tone: 'ghost' });
                        } }
                    ],
                    emptyText: '没有符合条件的车次'
                })]
            });
        },
        actions: merge(custActions, {
            'tp:open': function (id) { tripModal(id); },
            'tp:dispatch': function () { dispatchModal(); },
            'tp:depart': function (id) {
                var tr = db.get('transports', id);
                if (!tr) return;
                ui.confirm({
                    title: '确认发车 ' + id,
                    message: '装载重量在此刻封口，外协采购账单按实载结算',
                    detail: esc(TMS.operation.labelOf(tr)) + ' · ' + fmt.kg(tr.weight) + ' / ' + tr.orders + ' 单 · 装载率 ' + fmt.percent(tr.loadRate || 0) +
                        '<br>在车订单将统一推进到「运输中」并补发车扫描。',
                    okText: '确认发车'
                }).then(function (yes) {
                    if (!yes) return;
                    var res = TMS.operation.startTransport(id, { operator: actor() });
                    ui.toast(res.ok ? ('车次已发车，' + TMS.operation.ordersOfTrip(id).length + ' 单进入在途') : res.message,
                        res.ok ? 'success' : 'error');
                });
            },
            'tp:arrive': function (id) {
                var res = TMS.operation.arriveTransport(id, { operator: actor() });
                ui.toast(res.ok ? '车次已到达目的分拨，订单推进到「已到达」' : res.message, res.ok ? 'success' : 'error');
            },
            'tp:complete': function (id) {
                var tr = TMS.operation.completeTransport(id, { operator: actor() });
                ui.toast(tr ? '车次回场完成，车辆已释放为可用' : '车次不存在', tr ? 'success' : 'error');
            },
            'tp:report': function (id) {
                var tr = db.get('transports', id);
                if (!tr) return;
                ui.formModal({
                    title: '在途上报', sub: esc(TMS.operation.labelOf(tr)) + ' · 已报 ' + fmt.km(tr.reportedKm) + '，累计里程写回车辆档案',
                    values: { location: tr.position || '' },
                    fields: [
                        { key: 'location', label: '当前位置', type: 'text', placeholder: '济南服务区' },
                        { key: 'km', label: '本次里程(km)', type: 'number', min: 0 },
                        { key: 'fuel', label: '加油(L)', type: 'number', min: 0 },
                        { key: 'restKm', label: '司机休息', type: 'checkbox' },
                        { key: 'operator', label: '上报人', type: 'text', value: TMS.operation.driverOf(tr) || actor() }
                    ],
                    okText: '上报',
                    onSubmit: function (data) {
                        var res = TMS.operation.reportPosition(id, {
                            location: data.location, km: Number(data.km) || undefined,
                            fuel: Number(data.fuel) || undefined, restKm: data.restKm ? 1 : undefined
                        });
                        ui.toast(res.ok ? ('已上报：' + data.location + ' · 累计 ' + fmt.km(res.transport.reportedKm)) : res.message,
                            res.ok ? 'success' : 'error');
                    }
                });
            },
            'tp:exc': function (id) {
                var tr = db.get('transports', id);
                if (!tr) return;
                var list = TMS.operation.ordersOfTrip(id);
                ui.formModal({
                    title: '车次异常上报', sub: esc(TMS.operation.labelOf(tr)) + ' · 同时在异常台账建单',
                    fields: [
                        { key: 'type', label: '异常类型', type: 'select', required: true, options: [{ value: '', label: '请选择' }].concat(ui.optionsOf(TMS.service.EXCEPTION_TYPES)) },
                        { key: 'level', label: '等级', type: 'select', options: ui.optionsOf(TMS.service.LEVELS) },
                        { key: 'orderId', label: '受影响订单', type: 'select', options: [{ value: '', label: '车次整体（不指定单）' }].concat(ui.optionsOf(list, 'id', 'id')) },
                        { key: 'description', label: '现场描述', type: 'textarea', rows: 3, required: true }
                    ],
                    okText: '上报',
                    onSubmit: function (data) {
                        var res = TMS.operation.reportTripException(id, {
                            type: data.type, level: data.level, orderId: data.orderId || undefined,
                            description: data.description, operator: actor()
                        });
                        ui.toast(res.ok ? ('已上报异常 ' + (res.exception && res.exception.id)) : '上报失败', res.ok ? 'success' : 'error');
                    }
                });
            },
            'tp:export': function () {
                exportGrid({
                    name: '车次台账.csv',
                    cols: [
                        { label: '车次号', key: 'id' }, { label: '班次', key: 'code' }, { label: '日期', key: 'date' },
                        { label: '发车', key: 'departAt' }, { label: '方式', key: 'mode' },
                        { label: '运力', value: function (t) { return t.dispatchType === 'ltl' ? '外协舱位' : '自有整车'; } },
                        { label: '执行方', value: function (t) { return t.dispatchType === 'ltl' ? t.carrier : (t.plate + ' ' + t.driver); } },
                        { label: '发运分拨', value: function (t) { return pg.hubName(t.fromHub); } },
                        { label: '目的分拨', value: function (t) { return pg.hubName(t.toHub); } },
                        { label: '订单数', key: 'orders' }, { label: '件数', key: 'pieces' }, { label: '实载kg', key: 'weight' },
                        { label: '装载率', key: 'loadRate' }, { label: '里程', key: 'distanceKm' },
                        { label: '成本', value: function (t) { return TMS.operation.costTotal(t); } },
                        { label: '单公斤成本', key: 'costPerKg' },
                        { label: '状态', value: function (t) { return pg.TRIP_TEXT[t.status] || t.status; } },
                        { label: '准点', value: function (t) { return t.onTime ? '准点' : '晚点'; } }
                    ]
                });
            }
        }),
        drawerFooter: function (orderId) {
            var o = db.get('orders', orderId);
            if (!o || !o.tripId) return '';
            return ui.btn('车次 ' + o.tripId, { size: 'sm', act: 'tp:open', arg: o.tripId });
        }
    });

    /* ---------- 十二、末端派送 ---------- */

    function courierOptions(city) {
        var list = db.col('employees').filter(function (e) {
            return e.role === 'deliveryman' && e.status === 'active' && (!city || !e.city || e.city === city);
        });
        if (!list.length) list = db.col('employees').filter(function (e) { return e.role === 'deliveryman' && e.status === 'active'; });
        return ui.optionsOf(list.slice(0, 60), 'id', 'name');
    }

    function assignModal(orderId) {
        var o = db.get('orders', orderId);
        if (!o) return;
        ui.formModal({
            title: '派单', sub: esc(o.waybillNo) + ' · ' + esc(o.destination) + ' → ' + esc(TMS.order.branchName(o, 'dest') || o.receiverAddress),
            fields: [
                { key: 'courierId', label: '派送员', type: 'select', required: true, options: [{ value: '', label: '请选择' }].concat(courierOptions(o.destination)) },
                { key: 'deliveryEta', label: '预计送达', type: 'datetime', hint: '留空即取承诺时效' },
                { key: 'note', label: '派单备注', type: 'textarea', rows: 2 }
            ],
            okText: '确认派单',
            onSubmit: function (data) {
                var res = TMS.order.assignDelivery(orderId, { courierId: data.courierId, deliveryEta: data.deliveryEta || undefined, note: data.note, operator: actor() });
                if (!res.ok) return res.message;
                ui.toast('已派给 ' + (res.order.courier || '派送员') + '，订单进入派送中', 'success');
            }
        });
    }

    function signModal(orderId) {
        var o = db.get('orders', orderId);
        if (!o) return;
        ui.formModal({
            title: '签收回单（POD）', size: 'wide',
            sub: esc(o.waybillNo) + ' · 收件人 ' + esc(o.receiverName) + ' · ' + esc(o.receiverAddress),
            notice: o.codAmount > 0
                ? '本单代收货款 ' + fmt.money(o.codAmount) + '，签收即生成上划台账'
                : '回单信息一旦写入即参与时效与派送员绩效计算',
            values: { receiver: '本人签收' },
            fields: [
                { key: 'receiver', label: '签收人', type: 'select', required: true, options: ui.optionsOf(['本人签收', '同事代收', '前台代收', '家人代收', '物业代收', '驿站代收']) },
                { key: 'receiverPhone', label: '联系电话', type: 'text', value: o.receiverPhone },
                { key: 'note', label: '回单备注', type: 'textarea', rows: 2 },
                { key: 'photo', label: '已上传签收照片', type: 'checkbox' },
                { key: 'at', label: '签收时间', type: 'datetime', hint: '留空取当前时刻' }
            ],
            okText: '确认签收',
            onSubmit: function (data) {
                var res = TMS.order.sign(orderId, {
                    receiver: data.receiver, receiverPhone: data.receiverPhone, note: data.note,
                    photo: data.photo, at: data.at || undefined, operator: o.courier || actor()
                });
                if (!res.ok) return res.message;
                ui.toast('签收完成' + (TMS.order.isSignedLate(res.order) ? '（已超承诺时效，计入不及时率）' : '（时效达成）'),
                    TMS.order.isSignedLate(res.order) ? 'warn' : 'success');
            }
        });
    }

    pg.define('delivery', {
        sub: '末端是成本与口碑的交汇点：派单、POD 回单、代收货款在上划台账闭环',
        load: function (ctx) {
            var all = db.col('orders');
            var wait = all.filter(function (o) { return o.status === 'arrived'; });
            var going = all.filter(function (o) { return o.status === 'delivering'; });
            var today = util.dateKey(util.now());
            var signed = all.filter(function (o) { return o.status === 'signed'; });
            var signedToday = signed.filter(function (o) { return (o.signedAt || '').slice(0, 10) === today; });
            var byCourier = util.groupBy(going.concat(signedToday), 'courier');
            return {
                rows: wait.concat(going).concat(util.sortBy(signedToday, 'signedAt', 'desc').slice(0, 40)),
                k: {
                    wait: wait.length, going: going.length, signedToday: signedToday.length,
                    cod: util.money(util.sum(going.filter(function (o) { return o.codAmount > 0; }), 'codAmount')),
                    late: going.filter(function (o) { return TMS.order.isLate(o); }).length,
                    podPhoto: signed.length ? util.round(signed.filter(function (o) { return o.pod && o.pod.podPhoto; }).length / signed.length * 100, 1) : 0,
                    stuck: util.round(going.length ? util.sum(going, TMS.order.stuckHours) / going.length : 0, 1)
                },
                couriers: Object.keys(byCourier).filter(function (c) { return c; }).map(function (c) {
                    return { label: c, value: byCourier[c].length, kg: util.round(util.sum(byCourier[c], 'chargeableWeight'), 1) };
                }).sort(function (a, b) { return b.value - a.value; }).slice(0, 10),
                zones: (function () {
                    var g = util.groupBy(wait.concat(going), 'destination');
                    return Object.keys(g).map(function (k) { return { label: k, value: g[k].length }; })
                        .sort(function (a, b) { return b.value - a.value; }).slice(0, 10);
                })()
            };
        },
        render: function (ctx, d) {
            var k = d.k;
            var kpi = ui.kpis([
                { label: '待派送', value: k.wait, unit: '单', tone: k.wait > 40 ? 'warn' : 'brand', icon: '⛶', sub: '已到目的网点未派单' },
                { label: '派送中', value: k.going, unit: '单', icon: '⇢', sub: '平均滞留 ' + k.stuck + ' 小时' },
                { label: '今日签收', value: k.signedToday, unit: '单', tone: 'success', icon: '✓', sub: '超时 ' + k.late + ' 单' },
                { label: '待收货款', value: fmt.money(k.cod), unit: '', tone: k.cod ? 'warn' : 'muted', icon: '↧', sub: '签收后进入上划台账' },
                { label: 'POD 拍照率', value: k.podPhoto, unit: '%', tone: k.podPhoto >= 60 ? 'success' : 'warn', icon: '☐', sub: '影响理赔举证能力' }
            ]);
            var courierCard = ui.card({
                title: '派送员在手单量', sub: '今日签收 + 派送中，按人排行', flat: true,
                body: d.couriers.length ? ch.hbars({
                    data: d.couriers.map(function (c) { return { label: c.label, value: c.value }; }),
                    rowH: 26, labelWidth: 92, valueWidth: 66, fmt: function (v) { return v + ' 单'; }
                }) : ui.empty('当前没有派送中的单')
            });
            var zoneCard = ui.card({
                title: '目的城市积压', sub: '按待派 + 派送中合计，识别末端运力缺口', flat: true,
                body: ch.bars({ data: d.zones, height: 230, fmt: function (v) { return v + ' 单'; } })
            });
            return wrap(ctx, {
                actions: ui.btn('导出派送台账', { size: 'sm', act: 'dv:export', icon: '⤓' }),
                body: [kpi, ui.split('2', [courierCard, zoneCard]), grid(ctx, {
                    rows: d.rows.map(function (o) { return TMS.order.view(o); }),
                    keyName: 'id', onRow: 'order:open', searchKey: 'q', pageSize: 20,
                    fields: [
                        { key: 'q', type: 'search', label: '单号 / 收件人 / 派送员' },
                        { key: 'status', label: '环节', options: [{ value: '', label: '全部' }, { value: 'arrived', label: '待派送' }, { value: 'delivering', label: '派送中' }, { value: 'signed', label: '今日签收' }] },
                        { key: 'cod', label: '货款', options: [{ value: '', label: '全部' }, { value: '1', label: '仅代收货款' }] }
                    ],
                    filter: function (r, fs) {
                        if (fs.status && r.status !== fs.status) return false;
                        if (fs.cod === '1' && !(r.codAmount > 0)) return false;
                        return true;
                    },
                    /* 派生列（滞留小时、收件人）不在行对象上，排序取值要自己补 */
                    valueOf: function (r, k) {
                        if (k === 'stuck') return TMS.order.stuckHours(r);
                        if (k === 'receiver') return r.receiverName;
                        return r[k];
                    },
                    columns: [
                        { key: 'id', label: '运单', render: function (r) { return idLink(r.id) + ' <span class="tms-dim">' + esc(r.customer) + '</span>'; } },
                        { key: 'destination', label: '目的网点', render: function (r) { return esc(r.destination) + ' <span class="tms-dim">' + esc(r.courier || '未派单') + '</span>'; } },
                        { key: 'receiver', label: '收件人', render: function (r) { return esc(r.receiverName) + '<br><span class="tms-dim">' + esc(r.receiverPhone) + '</span>'; } },
                        { key: 'pieces', label: '件/重', align: 'right', width: '104px', render: function (r) { return r.pieces + ' 件 · ' + fmt.kg(r.chargeableWeight); } },
                        { key: 'expectedAt', label: '承诺时效', width: '128px', render: function (r) { return ui.timeCell(r.expectedAt); } },
                        { key: 'stuck', label: '滞留', align: 'right', width: '84px', render: function (r) {
                            var h = TMS.order.stuckHours(r);
                            return h > 24 ? ui.badge(Math.round(h) + 'h', 'danger') : '<span class="tms-dim">' + Math.round(h) + 'h</span>';
                        } },
                        { key: 'codAmount', label: '代收货款', align: 'right', width: '104px', render: function (r) { return r.codAmount > 0 ? ui.moneyCell(r.codAmount) : '<span class="tms-dim">—</span>'; } },
                        { key: 'status', label: '状态', width: '84px', render: function (r) { return ui.statusBadge(r.status); } },
                        { key: 'ops', label: '操作', width: '128px', sortable: false, render: function (r) {
                            if (r.status === 'arrived') return ui.link('派单', 'dv:assign', r.id, { tone: 'ghost' });
                            if (r.status === 'delivering') return ui.link('签收', 'dv:sign', r.id, { tone: 'ghost' }) + ' ' + ui.link('异常', 'dv:problem', r.id, { tone: 'ghost' });
                            return ui.link('回单', 'order:open', r.id, { tone: 'ghost' });
                        } }
                    ],
                    emptyText: '末端没有待处理的单'
                })]
            });
        },
        actions: merge(pg.shared, {
            'dv:assign': function (id) { assignModal(id); },
            'dv:sign': function (id) { signModal(id); },
            'dv:problem': function (id) {
                var o = db.get('orders', id);
                if (!o) return;
                ui.formModal({
                    title: '派送异常登记', sub: esc(o.waybillNo) + ' · ' + esc(o.receiverAddress),
                    fields: [
                        { key: 'type', label: '异常类型', type: 'select', required: true, options: [{ value: '', label: '请选择' }].concat(ui.optionsOf(TMS.service.EXCEPTION_TYPES)) },
                        { key: 'level', label: '等级', type: 'select', options: ui.optionsOf(TMS.service.LEVELS) },
                        { key: 'description', label: '现场描述', type: 'textarea', rows: 3, required: true }
                    ],
                    okText: '登记',
                    onSubmit: function (data) {
                        var res = TMS.order.markProblem(id, { type: data.type, level: data.level, description: data.description, operator: actor(), location: o.destination });
                        ui.toast(res.ok ? ('已挂起为问题件，异常单 ' + res.exception.id) : res.message, res.ok ? 'success' : 'error');
                    }
                });
            },
            'dv:export': function () {
                exportGrid({
                    name: '末端派送.csv',
                    cols: [
                        { label: '订单号', key: 'id' }, { label: '运单号', key: 'waybillNo' }, { label: '客户', key: 'customer' },
                        { label: '目的城市', key: 'destination' }, { label: '收件人', key: 'receiverName' }, { label: '电话', key: 'receiverPhone' },
                        { label: '地址', key: 'receiverAddress' }, { label: '派送员', key: 'courier' },
                        { label: '件数', key: 'pieces' }, { label: '计费重', key: 'chargeableWeight' },
                        { label: '代收货款', key: 'codAmount' }, { label: '承诺时效', key: 'expectedAt' },
                        { label: '签收时间', key: 'signedAt' },
                        { label: '环节', value: function (r) { return cfg.orderLabels[r.status] || r.status; } }
                    ]
                });
            }
        }),
        drawerFooter: function (orderId) {
            var o = db.get('orders', orderId);
            if (!o) return '';
            if (o.status === 'arrived') return ui.btn('派单', { tone: 'primary', size: 'sm', act: 'dv:assign', arg: o.id });
            if (o.status === 'delivering') return ui.btn('签收回单', { tone: 'primary', size: 'sm', act: 'dv:sign', arg: o.id });
            return '';
        }
    });

    /* ---------- 十二、异常工单 ---------- */

    /* 同一批状态键在异常/工单/理赔三种台账里说法不同，字典按对象覆盖 */
    var EXC_TEXT = { pending: '待受理', processing: '处理中', resolved: '已闭环' };
    var TICKET_TEXT = { pending: '待受理', processing: '处理中', resolved: '已办结' };
    var CLAIM_TEXT = { pending: '待审批', approved: '已核准', rejected: '已驳回' };
    var LEVEL_TONE = { '一级': 'danger', '二级': 'warn', '三级': 'info' };

    /* 定责默认责任方：先看运单挂起前卡在哪一段，退化到异常类型的经验归属 */
    var PARTY_BY_STAGE = {
        collected: '网点', inbound: '分拨中心', sorted: '分拨中心', transit: '承运商',
        arrived: '网点', delivering: '派送员', signed: '派送员'
    };
    var PARTY_BY_TYPE = {
        '延迟送达': '分拨中心', '错分错发': '分拨中心', '货物破损': '分拨中心', '温控异常': '承运商',
        '车辆故障': '承运商', '货物遗失': '网点', '包装不当': '网点', '客户拒收': '客户',
        '地址不清': '客户', '违禁品': '客户', '其他异常': '网点'
    };

    function levelBadge(level) { return ui.badge(esc(level || '未定级'), LEVEL_TONE[level] || 'muted'); }

    /* SLA 倒计时、四段耗时、是否超期都是读取时派生：工单只落几个事实时间点 */
    function excView(e) {
        var o = e.orderId ? db.get('orders', e.orderId) : null;
        var reportedAt = e.reportedAt || e.occurredAt || e.createdAt;
        var closed = e.status === 'resolved';
        return {
            raw: e, id: e.id, orderId: e.orderId || '', waybillNo: e.waybillNo || '',
            customer: e.customer || '', type: e.type || '其他异常', level: e.level || '三级',
            status: e.status || 'pending', source: e.source || '人工上报', reporter: e.reporter || '',
            handler: e.handler || '', description: e.description || '', reportedAt: reportedAt,
            slaDeadline: e.slaDeadline || '', slaHours: Number(e.slaHours) || cfg.sla.exceptionHours,
            escalated: !!e.escalated, escalateAt: e.escalateAt || '',
            party: e.responsibleParty || '', responsible: e.responsible || '',
            deduction: Number(e.deductionAmount) || 0,
            solution: e.solution || '', rootCause: e.rootCause || '',
            resolution: e.resolution || '', acceptedAt: e.acceptedAt || '',
            responsibilityAt: e.responsibilityAt || '', resolvedAt: e.resolvedAt || '',
            claimId: e.linkedClaimId || '', flow: e.flow || [], closed: closed,
            left: e.slaDeadline ? util.hoursBetween(util.now(), e.slaDeadline) : 0,
            overdue: !closed && !!e.slaDeadline && util.toDate(e.slaDeadline) < util.now(),
            orderStatus: o ? o.status : '', orderCity: o ? o.destination : '',
            orderStage: o ? (o.problemFrom || o.status) : '', held: !!o && o.status === 'problem',
            acceptHours: e.acceptedAt ? util.hoursBetween(reportedAt, e.acceptedAt) : null,
            dutyHours: e.responsibilityAt ? util.hoursBetween(e.acceptedAt || reportedAt, e.responsibilityAt) : null,
            closeHours: e.resolvedAt ? util.hoursBetween(reportedAt, e.resolvedAt) : null
        };
    }

    function excRows(days) {
        var rows = db.col('exceptions').map(excView);
        if (days) {
            var cutoff = util.addDays(util.now(), -days).getTime();
            rows = rows.filter(function (r) { return util.toDate(r.reportedAt).getTime() >= cutoff; });
        }
        return util.sortBy(rows, function (r) { return r.reportedAt; }, 'desc');
    }

    function slaCell(r) {
        if (r.closed) {
            var used = r.closeHours || 0;
            return used <= r.slaHours
                ? '<span class="tms-dim">' + esc(fmt.duration(used)) + ' 闭环</span>'
                : ui.badge('超 ' + esc(fmt.duration(used - r.slaHours)) + ' 闭环', 'warn');
        }
        if (!r.slaDeadline) return '<span class="tms-dim">未设时限</span>';
        var left = r.left;
        if (left < 0) return ui.badge('超时 ' + esc(fmt.duration(-left)), 'danger');
        if (left < r.slaHours * 0.4) return ui.badge('仅剩 ' + esc(fmt.duration(left)), 'warn');
        return '<span class="tms-dim">剩 ' + esc(fmt.duration(left)) + '</span>';
    }

    function defaultParty(r) {
        return PARTY_BY_STAGE[r.orderStage] || PARTY_BY_TYPE[r.type] || '网点';
    }

    /* 责任对象默认从运单反查：谁在那一段经手，就先写谁，改一格比填三格快 */
    function dutyTargetOf(r, party) {
        var p = party || defaultParty(r);
        var o = r.orderId ? db.get('orders', r.orderId) : null;
        if (!o) return r.customer || '';
        if (p === '派送员') return o.courier || '';
        var tr = TMS.order.tripOf(o);
        if (p === '司机') return tr ? (TMS.operation.crewOf(tr).driverName || '') : '';
        if (p === '承运商') return tr && tr.carrierId ? ((db.get('carriers', tr.carrierId) || {}).name || '') : '';
        if (p === '分拨中心') return pg.hubName(o.hubTo || o.hubFrom);
        if (p === '网点') return TMS.order.branchName(o, r.orderStage === 'collected' ? 'origin' : 'dest');
        if (p === '客户') return TMS.order.customerName(o) || o.contact || '';
        return '';
    }

    function exceptionModal(id) {
        var e = db.get('exceptions', id);
        if (!e) { ui.toast('异常工单不存在', 'warn'); return; }
        var r = excView(e);
        var claim = r.claimId ? db.get('claims', r.claimId) : null;
        var payable = db.findOne('payables', function (p) { return p.refId === r.id && p.category === '异常扣款'; });
        ui.modal({
            title: esc(r.type) + ' <span class="tms-mono tms-dim">' + esc(r.id) + '</span>',
            sub: esc(r.customer || '无客户') + ' · ' + esc(r.waybillNo || '未关联运单') + ' · ' + statusBadge(r.status, EXC_TEXT),
            size: 'wide',
            body: ui.stack([
                ui.desc([
                    { label: '异常等级', value: levelBadge(r.level) + ' <span class="tms-dim">SLA ' + r.slaHours + ' 小时</span>' },
                    { label: 'SLA 时钟', value: slaCell(r) },
                    { label: '上报来源', value: esc(r.source) + ' / ' + esc(r.reporter || '—') },
                    { label: '受理人', value: dim(r.handler) },
                    { label: '发生时间', value: fmt.dateTime(r.raw.occurredAt || r.reportedAt) },
                    { label: '上报时间', value: fmt.dateTime(r.reportedAt) },
                    { label: '责任方', value: r.party ? esc(r.party) + ' / ' + esc(r.responsible || '待指派') : '<span class="tms-dim">未定责</span>' },
                    { label: '定责扣款', value: r.deduction ? ui.moneyCell(r.deduction, { strong: true }) : '<span class="tms-dim">—</span>' },
                    { label: '处理方案', value: dim(r.solution) },
                    { label: '根因', value: dim(r.rootCause) },
                    { label: '闭环结论', value: dim(r.resolution) },
                    { label: '闭环时间', value: r.resolvedAt ? fmt.dateTime(r.resolvedAt) : '<span class="tms-dim">未闭环</span>' }
                ], { inline: true }),
                ui.card({
                    title: '现场描述', flat: true,
                    body: '<div style="line-height:1.75">' + esc(r.description || '（未填写）') + '</div>'
                }),
                ui.card({
                    title: '处理流水', sub: '每一步都带操作人，闭环可回溯', flat: true,
                    body: ui.timeline((r.flow || []).map(function (f, i) {
                        return {
                            title: esc(f.action) + (f.actor ? ' <span class="tms-dim">' + esc(f.actor) + '</span>' : ''),
                            time: esc(fmt.dateTime(f.time)),
                            tone: i === 0 ? 'err' : (f.action && String(f.action).indexOf('升级') > -1 ? 'warn' : 'ok')
                        };
                    }))
                }),
                ui.card({
                    title: '闭环联动', sub: '异常工单不是终点：扣款进应付、赔付进理赔、运单要放行', flat: true,
                    body: ui.desc([
                        { label: '运单', value: r.orderId ? ui.idCell(r.waybillNo || r.orderId, 'order:open') + ' <span class="tms-dim">' + esc(pg.statusText(r.orderStatus) || '') + '</span>' + (r.held ? ' ' + ui.badge('问题件挂起', 'danger') : '') : '<span class="tms-dim">未关联</span>' },
                        { label: '异常扣款应付', value: payable ? ui.idCell(payable.id, 'ui:close') + ' ' + ui.moneyCell(payable.amount) + ' <span class="tms-dim">' + esc(pg.DOC_TEXT[payable.status] || payable.status) + '</span>' : (r.deduction > 0 ? ui.badge('扣款未入账', 'danger') : '<span class="tms-dim">无扣款</span>') },
                        { label: '联动理赔单', value: claim ? ui.idCell(claim.id, 'cl:open') + ' ' + ui.moneyCell(claim.amount) + ' <span class="tms-dim">' + esc(CLAIM_TEXT[claim.status] || claim.status) + '</span>' : (r.claimId ? ui.badge('理赔单已失效', 'warn') : '<span class="tms-dim">未立案</span>') }
                    ], { inline: true })
                })
            ]),
            footer: excFootBtns(r) + ui.btn('关闭', { act: 'ui:close' })
        });
    }

    /* 按钮按工单状态出：待受理先受理、未定责先定责、定责完才谈闭环 */
    function excFootBtns(r) {
        var out = '';
        if (r.status === 'pending') out += ui.btn('受理工单', { tone: 'primary', size: 'sm', act: 'ex:accept', arg: r.id });
        if (!r.closed) {
            out += r.party
                ? ui.btn('闭环归档', { tone: 'primary', size: 'sm', act: 'ex:close', arg: r.id })
                : ui.btn('定责', { tone: 'primary', size: 'sm', act: 'ex:duty', arg: r.id });
            if (!r.escalated) out += ui.btn('升级', { tone: 'danger', size: 'sm', act: 'ex:esc', arg: r.id });
            out += ui.btn(r.claimId ? '查看理赔' : '转理赔', { size: 'sm', act: 'ex:claim', arg: r.id });
        }
        if (r.orderId) out += ui.btn('运单详情', { size: 'sm', act: 'order:open', arg: r.orderId });
        return out;
    }

    function excAcceptModal(id) {
        var e = db.get('exceptions', id);
        if (!e) { ui.toast('异常工单不存在', 'warn'); return; }
        var r = excView(e);
        ui.formModal({
            title: '受理异常工单', sub: esc(r.id) + ' · ' + esc(r.type),
            notice: '受理后 SLA 继续计时。提级会同步压缩时限，一级 2 小时、二级 6 小时。',
            values: { handler: actor(), level: r.level || '三级' },
            fields: [
                { key: 'handler', label: '受理人', type: 'text', required: true },
                { key: 'level', label: '异常等级', type: 'select', options: ui.optionsOf(TMS.service.LEVELS), hint: '按影响面定级，等级决定时限与升级路径' }
            ],
            okText: '受理',
            onSubmit: function (data) {
                var res = TMS.service.processException(id, data.handler, { level: data.level });
                if (!res) return '工单不存在';
                if (res.ok === false) return res.message;
                ui.toast('已受理：' + res.id + ' · ' + res.handler, 'success');
            }
        });
    }

    function excDutyModal(id) {
        var e = db.get('exceptions', id);
        if (!e) { ui.toast('异常工单不存在', 'warn'); return; }
        var r = excView(e);
        ui.formModal({
            title: '异常定责', sub: esc(r.id) + ' · ' + esc(r.type) + ' · ' + esc(r.customer || '无客户'),
            notice: '定责即记账：扣款金额大于 0 会自动生成一条「异常扣款」应付，等财务结算入账。',
            values: { party: r.party || defaultParty(r), responsible: r.responsible || dutyTargetOf(r, r.party), deduction: r.deduction || '', actor: actor() },
            fields: [
                { key: 'party', label: '责任方', type: 'select', required: true, options: ui.optionsOf(TMS.service.PARTIES) },
                { key: 'responsible', label: '责任对象', type: 'text', required: true, hint: '网点 / 分拨 / 承运商 / 司机 / 派送员名称' },
                { key: 'deduction', label: '扣款金额', type: 'number', min: 0, step: '0.01', unit: '元' },
                { key: 'actor', label: '定责人', type: 'text', required: true }
            ],
            okText: '确认定责',
            onSubmit: function (data) {
                var res = TMS.service.assignResponsibility(id, {
                    party: data.party, responsible: data.responsible,
                    deduction: data.deduction, actor: data.actor
                });
                if (!res) return '工单不存在';
                ui.toast('已定责 ' + data.party + '，扣款 ' + fmt.money(Number(data.deduction) || 0), 'success');
            }
        });
    }

    function excCloseModal(id) {
        var e = db.get('exceptions', id);
        if (!e) { ui.toast('异常工单不存在', 'warn'); return; }
        var r = excView(e);
        var o = r.orderId ? db.get('orders', r.orderId) : null;
        ui.formModal({
            title: '异常闭环归档', sub: esc(r.id) + ' · ' + esc(r.type),
            notice: '闭环三件事：定根因与方案、按需联动理赔、放行挂起运单。不勾选放行时运单继续停在问题件。',
            values: {
                solution: r.solution || '改派', rootCause: r.rootCause || '作业疏漏',
                resolution: r.resolution || '', claimAmount: claimSuggest(r), actor: actor(),
                keepHold: false, createClaim: false
            },
            fields: [
                { key: 'solution', label: '处理方案', type: 'select', required: true, options: ui.optionsOf(TMS.service.SOLUTIONS) },
                { key: 'rootCause', label: '根因归类', type: 'select', required: true, options: ui.optionsOf(['作业疏漏', '设备故障', '系统缺陷', '客户原因', '天气与交通', '承运商履约', '包装不合格', '道路阻断']) },
                { key: 'resolution', label: '闭环结论', type: 'textarea', rows: 3, required: true, placeholder: '最终如何处理、客户是否认可' },
                { key: 'createClaim', label: '同步生成理赔单', type: 'checkbox' },
                { key: 'claimAmount', label: '理赔申报金额', type: 'number', min: 0, step: '0.01', unit: '元', hint: o ? (o.isInsured ? '已保价，声明价值 ' + fmt.money(o.declaredValue || 0) : '未保价，审批按运费 5 倍封顶 ' + fmt.money(Math.max((o.freight || 0) * 5, 200))) : '未关联运单，按实报金额受理' },
                { key: 'keepHold', label: '运单继续挂起', type: 'checkbox', hint: o && o.status === 'problem' ? '当前运单为问题件' : '仅当运单被挂起时生效' },
                { key: 'actor', label: '闭环人', type: 'text', required: true }
            ],
            okText: '闭环归档',
            onSubmit: function (data) {
                var res = TMS.service.closeException(id, {
                    solution: data.solution, rootCause: data.rootCause, resolution: data.resolution,
                    createClaim: !!data.createClaim, claimAmount: data.claimAmount,
                    keepHold: !!data.keepHold, actor: data.actor
                });
                if (!res) return '工单不存在';
                ui.toast('已闭环：' + res.id + (res.linkedClaimId ? '，理赔单 ' + res.linkedClaimId : ''), 'success');
            }
        });
    }

    function excNewModal(orderId) {
        ui.formModal({
            title: '登记异常', sub: '异常台账入口：先定性，再受理、定责、闭环',
            notice: '勾选挂起会把运单置为问题件并停在当前环节，闭环后自动放行；不挂起则只留痕不影响履约。',
            values: { orderId: orderId || '', level: '三级', reporter: actor(), hold: false },
            fields: [
                { key: 'orderId', label: '运单号', type: 'text', placeholder: 'HL… 或 WB…', hint: '留空表示无单异常（场地、设备类）' },
                { key: 'type', label: '异常类型', type: 'select', required: true, options: ui.optionsOf(TMS.service.EXCEPTION_TYPES) },
                { key: 'level', label: '等级', type: 'select', required: true, options: ui.optionsOf(TMS.service.LEVELS) },
                { key: 'description', label: '现场描述', type: 'textarea', rows: 3, required: true, span: 2 },
                { key: 'hold', label: '挂起运单为问题件', type: 'checkbox' },
                { key: 'reporter', label: '上报人', type: 'text', required: true }
            ],
            okText: '登记',
            onSubmit: function (data) {
                var key = String(data.orderId || '').trim();
                var o = key ? (db.get('orders', key) || db.findOne('orders', function (x) { return x.waybillNo === key; })) : null;
                if (key && !o) return '找不到运单 ' + key;
                if (o && data.hold) {
                    if (TMS.order.isTerminal(o)) return '运单已是终态，不能挂起';
                    var res = TMS.order.markProblem(o.id, {
                        type: data.type, level: data.level, description: data.description,
                        operator: data.reporter, location: o.destination
                    });
                    if (!res.ok) return res.message;
                    ui.toast('已挂起并登记工单 ' + res.exception.id, 'success');
                } else {
                    var rec = TMS.service.createException({
                        orderId: o ? o.id : '', waybillNo: o ? o.waybillNo : key,
                        type: data.type, level: data.level, description: data.description,
                        source: '人工上报', actor: data.reporter
                    });
                    ui.toast('异常工单已登记：' + rec.id, 'success');
                }
            }
        });
    }

    /* 异常工单动作表：exception 与 workflow 两页共用同一套弹窗，按钮才不会被换页抹掉 */
    var excActions = {
        'ex:open': function (id) { exceptionModal(id); },
        'ex:accept': function (id) { excAcceptModal(id); },
        'ex:duty': function (id) { excDutyModal(id); },
        'ex:close': function (id) { excCloseModal(id); },
        'ex:new': function () { excNewModal(); },
        'ex:order': function (id) { ui.closeTop(); pg.openOrder(id); },
        'ex:esc': function (id) {
            var e = db.get('exceptions', id);
            if (!e) { ui.toast('工单不存在', 'warn'); return; }
            ui.confirm({
                title: '升级异常工单', danger: true,
                message: '升级后等级置为一级并记入处理流水，同时向运营主管推送告警。',
                detail: esc(e.id) + ' · ' + esc(e.type) + ' · 当前 ' + esc(e.level)
            }).then(function (yes) {
                if (!yes) return;
                var res = TMS.service.escalateException(id, actor() + ' 手动升级至运营主管');
                ui.toast(res ? (res.escalated ? '已升级：' + res.id : '该工单此前已升级') : '工单不存在或已闭环',
                    res && res.escalated ? 'success' : 'warn');
            });
        },
        'ex:claim': function (id) {
            var e = db.get('exceptions', id);
            if (!e) return;
            if (e.linkedClaimId && db.get('claims', e.linkedClaimId)) { ui.closeTop(); claimModal(e.linkedClaimId); return; }
            ui.closeTop();
            claimNewModal({ orderId: e.orderId, type: e.type, reason: e.description, amount: claimSuggest(excView(e)), exceptionId: e.id });
        }
    };

    pg.define('exception', {
        sub: '异常上报 → 受理 → 定责 → 闭环四步台账，SLA 与时段耗时全部读取时派生',
        load: function (ctx) {
            applyParamFilter(ctx, ['status', 'level', 'flag', 'orderId']);
            return { st: TMS.service.exceptionStats(), rows: excRows(0), days: ctx.days };
        },
        render: function (ctx, d) {
            var st = d.st;
            var open = d.rows.filter(function (r) { return !r.closed; });
            var kpi = ui.kpis([
                { label: '待受理', value: st.pending, unit: '单', tone: st.pending ? 'danger' : 'success', icon: '⚠', sub: '升级中 ' + st.escalated + ' 单' },
                { label: '处理中', value: st.processing, unit: '单', tone: 'warn', icon: '◈', sub: '未闭环合计 ' + open.length + ' 单' },
                { label: '超 SLA', value: st.overdue, unit: '单', tone: st.overdue ? 'danger' : 'success', icon: '◷', sub: '闭环时限 ' + cfg.sla.exceptionHours + ' 小时起' },
                { label: '闭环率', value: st.closeRate, unit: '%', tone: st.closeRate >= 70 ? 'success' : 'warn', icon: '✓', sub: '已闭环 ' + st.resolved + ' 单' },
                { label: 'SLA 达成', value: st.slaRate, unit: '%', tone: st.slaRate >= 90 ? 'success' : 'warn', icon: '◎', sub: '平均闭环 ' + fmt.duration(st.avgCloseHours) },
                { label: '定责扣款', value: fmt.money(st.deduction), tone: 'brand', icon: '¥', sub: '已生成异常扣款应付' }
            ]);
            var typeCard = ui.card({
                title: '异常类型分布', sub: '破损与延误最能反映作业质量，占比突变要回查环节 SOP', flat: true,
                body: st.byType.length
                    ? ch.bars({ data: st.byType.slice(0, 8), height: 240, fmt: function (v) { return v + ' 单'; } })
                    : ui.empty('暂无异常记录', '作业全程零异常，或时间窗内未发生异常')
            });
            var partyCard = ui.card({
                title: '责任方与扣款', sub: '定责结果直接决定应付对象，扣款走结算不冲减运费', flat: true,
                body: st.byParty.length ? ui.table({
                    dense: true, keyName: 'label', rows: st.byParty,
                    columns: [
                        { key: 'label', label: '责任方', render: function (r) { return esc(r.label) + ' ' + ui.badge(r.count + ' 单', 'muted'); } },
                        { key: 'amount', label: '扣款', align: 'right', render: function (r) { return ui.moneyCell(r.amount); } },
                        {
                            key: 'share', label: '金额占比', align: 'right', width: '132px', sortable: false, render: function (r) {
                                return rateBar(st.deduction ? util.round(r.amount / st.deduction * 100, 1) : 0, { target: 100 });
                            }
                        }
                    ]
                }) : ui.empty('尚未定责', '待受理工单需先在异常台账完成定责')
            });
            var slaCard = ui.card({
                title: '闭环时效', sub: '已闭环工单在 SLA 内归档的比例', flat: true,
                body: ch.gauge({ value: st.slaRate, height: 170, label: 'SLA 达成率' }) +
                    ui.desc([
                        { label: '平均闭环时长', value: fmt.duration(st.avgCloseHours) },
                        { label: '升级未闭环', value: st.escalated + ' 单' },
                        { label: '超 SLA 未闭环', value: st.overdue + ' 单' }
                    ], { inline: true })
            });
            return wrap(ctx, {
                actions: ui.btn('登记异常', { size: 'sm', act: 'ex:new', icon: '＋' }) +
                    ui.btn('导出工单', { size: 'sm', act: 'ex:export', icon: '⤓' }),
                body: [kpi, ui.split('2', [typeCard, partyCard]), slaCard, grid(ctx, {
                    rows: d.rows, keyName: 'id', onRow: 'ex:open', searchKey: 'q', pageSize: 20,
                    search: function (r) { return [r.id, r.orderId, r.waybillNo, r.customer, r.type, r.description, r.responsible].join(' '); },
                    chips: [
                        { label: '全部', value: '', count: d.rows.length },
                        { label: '超 SLA', value: 'overdue', count: st.overdue },
                        { label: '未定责', value: 'noduty', count: d.rows.filter(function (r) { return !r.party; }).length },
                        { label: '升级中', value: 'esc', count: d.rows.filter(function (r) { return r.escalated && !r.closed; }).length }
                    ], chipsName: 'flag',
                    fields: [
                        { key: 'q', type: 'search', label: '工单 / 运单 / 客户 / 描述', placeholder: 'EX… / WB… / 客户名' },
                        { key: 'status', label: '状态', options: [{ value: '', label: '全部' }].concat(ui.optionsOf(['pending', 'processing', 'resolved'])) },
                        { key: 'level', label: '等级', options: [{ value: '', label: '全部' }].concat(ui.optionsOf(TMS.service.LEVELS)) },
                        { key: 'type', label: '类型', options: [{ value: '', label: '全部类型' }].concat(ui.optionsOf(TMS.service.EXCEPTION_TYPES)) },
                        { key: 'party', label: '责任方', options: [{ value: '', label: '全部' }].concat(ui.optionsOf(TMS.service.PARTIES)) },
                        { key: 'window', label: '上报时间', options: [{ value: '', label: '不限' }, { value: '1', label: '24 小时内' }, { value: '3', label: '3 天内' }, { value: '7', label: '7 天内' }] }
                    ],
                    filter: function (r, fs) {
                        if (fs.status && r.status !== fs.status) return false;
                        if (fs.level && r.level !== fs.level) return false;
                        if (fs.type && r.type !== fs.type) return false;
                        if (fs.party && r.party !== fs.party) return false;
                        if (fs.orderId && r.orderId !== fs.orderId) return false;
                        if (fs.flag === 'overdue' && !r.overdue) return false;
                        if (fs.flag === 'noduty' && r.party) return false;
                        if (fs.flag === 'esc' && !(r.escalated && !r.closed)) return false;
                        if (fs.window) {
                            var days = Number(fs.window);
                            if (util.hoursBetween(r.reportedAt, util.now()) > days * 24) return false;
                        }
                        return true;
                    },
                    valueOf: function (r, k) {
                        if (k === 'sla') return r.closed ? r.closeHours || 0 : r.left;
                        if (k === 'duty') return r.party || '';
                        return r[k];
                    },
                    columns: [
                        { key: 'id', label: '工单号', width: '132px', render: function (r) { return idLink(r.id, 'ex:open'); } },
                        { key: 'waybillNo', label: '运单 / 客户', render: function (r) { return r.orderId ? idLink(r.orderId, 'ex:order') : '<span class="tms-dim">无单异常</span>'; } },
                        { key: 'type', label: '异常类型', width: '104px', render: function (r) { return esc(r.type) + ' ' + levelBadge(r.level); } },
                        { key: 'description', label: '现场描述', render: function (r) { return '<span class="tms-dim">' + esc(String(r.description || '').slice(0, 26)) + '</span>'; } },
                        { key: 'source', label: '来源', width: '96px', render: function (r) { return esc(r.source) + '<br><span class="tms-dim">' + esc(r.reporter) + '</span>'; } },
                        { key: 'reportedAt', label: '上报时间', width: '128px', render: function (r) { return ui.timeCell(r.reportedAt); } },
                        { key: 'sla', label: 'SLA', width: '116px', align: 'right', render: function (r) { return slaCell(r); } },
                        { key: 'duty', label: '责任方', width: '116px', render: function (r) { return r.party ? esc(r.party) + '<br><span class="tms-dim">' + esc(r.responsible || '待指派') + '</span>' : '<span class="tms-dim">未定责</span>'; } },
                        { key: 'deduction', label: '扣款', width: '104px', align: 'right', render: function (r) { return r.deduction ? ui.moneyCell(r.deduction) : '<span class="tms-dim">—</span>'; } },
                        { key: 'status', label: '状态', width: '92px', render: function (r) { return statusBadge(r.status, EXC_TEXT) + (r.escalated ? ui.badge('升级', 'danger') : ''); } },
                        {
                            key: 'ops', label: '操作', width: '116px', sortable: false, render: function (r) {
                                if (r.closed) return ui.link('查看', 'ex:open', r.id, { tone: 'ghost' });
                                if (r.status === 'pending') return ui.link('受理', 'ex:accept', r.id, { tone: 'ghost' });
                                return ui.link(r.party ? '闭环' : '定责', r.party ? 'ex:close' : 'ex:duty', r.id, { tone: 'ghost' });
                            }
                        }
                    ],
                    emptyText: '没有符合条件的异常工单', emptySub: '放宽筛选，或到闭环看板检查流程断点'
                })]
            });
        },
        actions: merge(pg.shared, excActions, {
            'ex:export': function () {
                exportGrid({
                    name: '异常工单.csv', rows: excRows(0),
                    cols: [
                        { label: '工单号', key: 'id' }, { label: '订单号', key: 'orderId' }, { label: '运单号', key: 'waybillNo' },
                        { label: '客户', key: 'customer' }, { label: '异常类型', key: 'type' }, { label: '等级', key: 'level' },
                        { label: '现场描述', key: 'description' }, { label: '来源', key: 'source' }, { label: '上报人', key: 'reporter' },
                        { label: '上报时间', key: 'reportedAt' }, { label: 'SLA时限h', key: 'slaHours' }, { label: '截止时间', key: 'slaDeadline' },
                        { label: '是否升级', value: function (r) { return r.escalated ? '是' : ''; } },
                        { label: '责任方', key: 'party' }, { label: '责任对象', key: 'responsible' }, { label: '扣款', key: 'deduction' },
                        { label: '处理方案', key: 'solution' }, { label: '根因', key: 'rootCause' }, { label: '闭环结论', key: 'resolution' },
                        { label: '受理时长h', value: function (r) { return r.acceptHours == null ? '' : util.round(r.acceptHours, 1); } },
                        { label: '定责时长h', value: function (r) { return r.dutyHours == null ? '' : util.round(r.dutyHours, 1); } },
                        { label: '闭环时长h', value: function (r) { return r.closeHours == null ? '' : util.round(r.closeHours, 1); } },
                        { label: '状态', value: function (r) { return EXC_TEXT[r.status] || r.status; } },
                        { label: '闭环时间', key: 'resolvedAt' }, { label: '关联理赔', key: 'claimId' }
                    ]
                });
            }
        }),
        drawerFooter: function (orderId) {
            var open = db.col('exceptions').filter(function (e) { return e.orderId === orderId && e.status !== 'resolved'; });
            if (!open.length) return ui.btn('登记异常', { size: 'sm', act: 'ex:new', arg: orderId });
            return ui.btn('异常 ' + open.length + ' 条待处理', { size: 'sm', tone: 'danger', act: 'ex:open', arg: open[0].id });
        }
    });

    /* ---------- 十三、闭环看板 ---------- */

    /* 看板的价值不在再列一遍工单，而在把断链找出来：
       定了责没入账、闭了环没放行、超了时没升级、挂了指赔单却没理赔台账 */
    function wfGaps(rows) {
        var payIdx = {};
        db.col('payables').forEach(function (p) { if (p.category === '异常扣款') payIdx[p.refId] = true; });
        var gaps = [];
        (rows || []).forEach(function (r) {
            if (r.deduction > 0 && !payIdx[r.id]) {
                gaps.push({ key: r.id + ':pay', id: r.id, kind: '扣款未入账', tone: 'danger', detail: r.type + ' 定责扣款 ' + fmt.money(r.deduction) + ' 未生成应付' + (r.closed ? '，工单已闭环' : ''), act: 'wf:payable', arg: r.id, actText: '补建应付' });
            }
            if (r.closed && r.held) {
                gaps.push({ key: r.id + ':hold', id: r.id, kind: '运单未放行', tone: 'warn', detail: '异常已闭环，运单 ' + (r.waybillNo || r.orderId) + ' 仍挂起为问题件', act: 'wf:release', arg: r.orderId, actText: '放行运单' });
            }
            if (!r.closed && r.overdue && !r.escalated) {
                gaps.push({ key: r.id + ':esc', id: r.id, kind: '超时未升级', tone: 'danger', detail: r.type + ' 已超 SLA ' + fmt.duration(-r.left) + '，未升级至运营主管', act: 'ex:esc', arg: r.id, actText: '立即升级' });
            }
            if (r.claimId && !db.get('claims', r.claimId)) {
                gaps.push({ key: r.id + ':claim', id: r.id, kind: '理赔断链', tone: 'danger', detail: '工单挂了指赔单 ' + r.claimId + '，理赔台账查无此单', act: 'ex:open', arg: r.id, actText: '查看工单' });
            }
        });
        return gaps;
    }

    /* 四段停留时长：上报→受理→定责→闭环，哪一段最长就补哪一段的班 */
    function wfStages(rows) {
        function avg(list, key) {
            var v = list.filter(function (r) { return r[key] != null; }).map(function (r) { return r[key]; });
            return v.length ? util.round(util.sum(v) / v.length, 1) : 0;
        }
        return [
            { label: '受理响应', value: avg(rows, 'acceptHours'), std: 1, count: rows.filter(function (r) { return r.acceptHours != null; }).length },
            { label: '定责耗时', value: avg(rows, 'dutyHours'), std: 2, count: rows.filter(function (r) { return r.dutyHours != null; }).length },
            { label: '闭环耗时', value: avg(rows, 'closeHours'), std: 4, count: rows.filter(function (r) { return r.closeHours != null; }).length }
        ];
    }

    pg.define('workflow', {
        sub: '异常处理闭环的流水线视角：漏斗、时段耗时、断链清单，一屏看清卡在哪',
        load: function (ctx) {
            applyParamFilter(ctx, ['status', 'level']);
            var all = excRows(0);
            var rows = all.filter(function (r) { return util.hoursBetween(r.reportedAt, util.now()) <= Math.max(ctx.days, 1) * 24; });
            var accepted = all.filter(function (r) { return r.acceptedAt; });
            var dutyed = all.filter(function (r) { return r.party; });
            var closed = all.filter(function (r) { return r.closed; });
            var gaps = wfGaps(all);
            return {
                st: TMS.service.exceptionStats(), all: all, rows: rows, gaps: gaps, stages: wfStages(all),
                cols: [
                    { key: 'pending', title: '待受理', tone: 'danger', rows: all.filter(function (r) { return r.status === 'pending'; }) },
                    { key: 'noduty', title: '已受理未定责', tone: 'warn', rows: all.filter(function (r) { return r.status === 'processing' && !r.party; }) },
                    { key: 'duty', title: '已定责待闭环', tone: 'info', rows: all.filter(function (r) { return r.status === 'processing' && r.party; }) },
                    { key: 'closed', title: '近 7 日已闭环', tone: 'success', rows: closed.filter(function (r) { return util.hoursBetween(r.resolvedAt, util.now()) <= 7 * 24; }) }
                ],
                funnel: [
                    { label: '异常上报', value: all.length },
                    { label: '受理响应', value: accepted.length },
                    { label: '完成定责', value: dutyed.length },
                    { label: '闭环归档', value: closed.length },
                    { label: '扣款入账', value: util.sum(all, 'deduction') > 0 ? dutyed.filter(function (r) { return r.deduction > 0; }).length : 0 }
                ]
            };
        },
        render: function (ctx, d) {
            var st = d.st;
            var kpi = ui.kpis([
                { label: '在办工单', value: st.pending + st.processing, unit: '单', tone: 'warn', icon: '⟳', sub: '全库 ' + d.all.length + ' 单' },
                { label: '断链条目', value: d.gaps.length, unit: '项', tone: d.gaps.length ? 'danger' : 'success', icon: '⚠', sub: '扣款 / 放行 / 升级 / 理赔' },
                { label: '闭环率', value: st.closeRate, unit: '%', tone: st.closeRate >= 70 ? 'success' : 'warn', icon: '✓', sub: '已闭环 ' + st.resolved + ' 单' },
                { label: '平均闭环', value: st.avgCloseHours, unit: '小时', tone: st.avgCloseHours > cfg.sla.exceptionHours ? 'warn' : 'success', icon: '◷', sub: '默认时限 ' + cfg.sla.exceptionHours + ' 小时' },
                { label: '定责覆盖', value: d.all.length ? util.round(d.all.filter(function (r) { return r.party; }).length / d.all.length * 100, 1) : 0, unit: '%', tone: 'brand', icon: '⌖', sub: '未定责即无法入账' }
            ]);
            var funnelCard = ui.card({
                title: '闭环漏斗', sub: '每一步掉多少人，就是流程哪一段在丢单', flat: true,
                body: ch.funnel({ data: d.funnel, rowH: 36 })
            });
            var stageCard = ui.card({
                title: '各环节停留时长', sub: '与标准时限对比，超标环节要补班组或改排班', flat: true,
                body: ch.compare({
                    data: d.stages.map(function (s) { return { label: s.label, value: s.value, target: s.std, text: s.value + 'h / 标准 ' + s.std + 'h' }; }),
                    rowH: 34
                }) + ui.table({
                    dense: true, zebra: false, keyName: 'label', rows: d.stages,
                    columns: [
                        { key: 'label', label: '环节' },
                        { key: 'count', label: '样本', align: 'right', render: function (s) { return s.count + ' 单'; } },
                        { key: 'value', label: '均值', align: 'right', render: function (s) { return fmt.duration(s.value); } },
                        { key: 'std', label: '标准', align: 'right', render: function (s) { return '<span class="tms-dim">' + s.std + ' 小时</span>'; } }
                    ]
                })
            });
            var board = ui.split('2', d.cols.map(function (c) {
                return ui.card({
                    title: c.title, icon: '▤', sub: c.rows.length + ' 单', tone: c.tone === 'success' ? '' : c.tone,
                    flat: true,
                    body: c.rows.length ? ui.list(c.rows.slice(0, 8).map(function (r) {
                        return {
                            act: 'ex:open', arg: r.id,
                            title: esc(r.type) + ' ' + levelBadge(r.level) + (r.escalated ? ' ' + ui.badge('升级', 'danger') : ''),
                            sub: esc(r.waybillNo || r.orderId || '无单异常') + ' · ' + esc(r.customer || '散客') + ' · ' + esc(fmt.dateTime(r.reportedAt)),
                            right: slaCell(r)
                        };
                    })) + (c.rows.length > 8 ? '<div class="tms-dim" style="padding:6px 2px">其余 ' + (c.rows.length - 8) + ' 单见异常工单台账</div>' : '')
                        : ui.empty('该阶段没有工单', '闭环顺畅')
                });
            }));
            var gapCard = d.gaps.length ? ui.card({
                title: '闭环断链清单', sub: '系统层面能补的立即补，补不了的按工单追人', tone: 'danger', flat: true,
                tools: ui.btn('执行超时升级巡检', { size: 'sm', act: 'wf:sweep', icon: '⟳' }),
                body: ui.table({
                    dense: true, keyName: 'key', rows: d.gaps.slice(0, 40),
                    columns: [
                        { key: 'id', label: '工单', width: '132px', render: function (g) { return idLink(g.id, 'ex:open'); } },
                        { key: 'kind', label: '断链类型', width: '104px', render: function (g) { return ui.badge(esc(g.kind), g.tone); } },
                        { key: 'detail', label: '说明', render: function (g) { return esc(g.detail); } },
                        { key: 'act', label: '处理', align: 'right', width: '104px', sortable: false, render: function (g) { return ui.link(g.actText, g.act, g.arg, { tone: 'ghost' }); } }
                    ]
                })
            }) : ui.card({ title: '闭环断链清单', tone: 'success', flat: true, body: ui.empty('流程闭环完整', '定责扣款、运单放行、超时升级、理赔联动均无缺口') });
            return wrap(ctx, {
                sub: '上报 → 受理 → 定责 → 闭环的流水线，断链在这里被点名',
                actions: ui.btn('异常台账', { size: 'sm', act: 'wf:ledger' }) +
                    ui.btn('导出闭环台账', { size: 'sm', act: 'wf:export', icon: '⤓' }),
                body: [kpi, ui.split('2', [funnelCard, stageCard]), board, gapCard, grid(ctx, {
                    rows: d.rows, keyName: 'id', onRow: 'ex:open', searchKey: 'q', pageSize: 15,
                    search: function (r) { return [r.id, r.waybillNo, r.customer, r.type, r.handler, r.responsible].join(' '); },
                    fields: [
                        { key: 'q', type: 'search', label: '工单 / 运单 / 处理人' },
                        { key: 'stage', label: '流程阶段', options: [{ value: '', label: '全部阶段' }, { value: 'pending', label: '待受理' }, { value: 'noduty', label: '受理未定责' }, { value: 'duty', label: '定责待闭环' }, { value: 'closed', label: '已闭环' }] },
                        { key: 'level', label: '等级', options: [{ value: '', label: '全部' }].concat(ui.optionsOf(TMS.service.LEVELS)) }
                    ],
                    filter: function (r, fs) {
                        if (fs.level && r.level !== fs.level) return false;
                        if (fs.stage === 'pending') return r.status === 'pending';
                        if (fs.stage === 'noduty') return r.status === 'processing' && !r.party;
                        if (fs.stage === 'duty') return r.status === 'processing' && r.party;
                        if (fs.stage === 'closed') return r.closed;
                        return true;
                    },
                    valueOf: function (r, k) {
                        if (k === 'aging') return r.closed ? -1 : util.hoursBetween(r.reportedAt, util.now());
                        if (k === 'path') return (r.acceptHours == null ? 0 : 1) + (r.dutyHours == null ? 0 : 1) + (r.closed ? 1 : 0);
                        return r[k];
                    },
                    columns: [
                        { key: 'id', label: '工单', width: '132px', render: function (r) { return idLink(r.id, 'ex:open'); } },
                        { key: 'type', label: '异常', render: function (r) { return esc(r.type) + ' ' + levelBadge(r.level); } },
                        { key: 'waybillNo', label: '运单', render: function (r) { return r.orderId ? idLink(r.orderId, 'ex:order') : '<span class="tms-dim">无单</span>'; } },
                        {
                            key: 'path', label: '闭环进度', width: '180px', render: function (r) {
                                return ui.steps([
                                    { label: '上报', state: 'done', time: esc(fmt.dateTime(r.reportedAt)) },
                                    { label: '受理', state: r.acceptedAt ? 'done' : r.overdue ? 'late' : 'todo', time: r.acceptedAt ? esc(r.handler || '') : '—' },
                                    { label: '定责', state: r.party ? 'done' : 'todo', time: r.party ? esc(r.party) : '—' },
                                    { label: '闭环', state: r.closed ? 'done' : 'todo', time: r.closed ? esc(fmt.date(r.resolvedAt)) : '—' }
                                ]);
                            }
                        },
                        { key: 'aging', label: '已挂起', align: 'right', width: '92px', render: function (r) { return r.closed ? '<span class="tms-dim">已归档</span>' : ui.badge(esc(fmt.duration(util.hoursBetween(r.reportedAt, util.now()))), r.overdue ? 'danger' : 'muted'); } },
                        { key: 'sla', label: 'SLA', width: '112px', align: 'right', render: function (r) { return slaCell(r); } },
                        { key: 'ops', label: '操作', width: '104px', sortable: false, render: function (r) { return r.closed ? ui.link('复盘', 'ex:open', r.id, { tone: 'ghost' }) : ui.link(r.party ? '闭环' : r.status === 'pending' ? '受理' : '定责', r.party ? 'ex:close' : r.status === 'pending' ? 'ex:accept' : 'ex:duty', r.id, { tone: 'ghost' }); } }
                    ],
                    emptyText: '时间窗内没有异常工单', emptySub: '顶栏切长时间窗，或到异常台账看全量'
                })]
            });
        },
        actions: merge(pg.shared, excActions, {
            'wf:ledger': function () { TMS.shell.go('exception'); },
            'wf:sweep': function () {
                var a = TMS.jobs.run('traceOvertime');
                var b = TMS.jobs.run('exceptionEscalate');
                ui.toast((a.ok ? a.name + '：' + describeJob(a.out) : a.message) + '；' + (b.ok ? b.name + '：' + describeJob(b.out) : b.message), a.ok && b.ok ? 'success' : 'error');
            },
            'wf:payable': function (id) {
                var e = db.get('exceptions', id);
                if (!e) { ui.toast('工单不存在', 'warn'); return; }
                if (db.findOne('payables', function (p) { return p.refId === e.id && p.category === '异常扣款'; })) { ui.toast('该扣款已入应付', 'info'); return; }
                var p = TMS.finance.createPayable({
                    target: e.responsible || e.responsibleParty || '承运商',
                    targetType: e.responsibleParty === '承运商' ? 'carrier' : (e.responsibleParty === '司机' || e.responsibleParty === '派送员') ? 'driver' : 'branch',
                    category: '异常扣款', refId: e.id, refNo: e.id, amount: Number(e.deductionAmount) || 0,
                    period: util.monthKey(util.now()), dueDate: util.dateKey(util.addDays(util.now(), 30)),
                    status: 'pending', remark: e.type + ' 定责扣款（看板补建）'
                });
                db.commit('payables', p && p.id, 'exception:repair-payable');
                TMS.audit.log('exception.assign', 'exceptions', e.id, '补建异常扣款应付 ' + (p ? p.id : ''), actor());
                ui.toast(p ? '已补建应付 ' + p.id : '补建失败', p ? 'success' : 'error');
            },
            'wf:release': function (orderId) {
                var res = TMS.order.releaseProblem(orderId, { operator: actor(), note: '闭环看板补放行' });
                if (res.ok) TMS.audit.log('order.advance', 'orders', orderId, '异常闭环后放行问题件', actor());
                ui.toast(res.ok ? '运单已放行继续转运' : res.message, res.ok ? 'success' : 'warn');
            },
            'wf:export': function () {
                exportGrid({
                    name: '异常闭环看板.csv', rows: excRows(0),
                    cols: [
                        { label: '工单号', key: 'id' }, { label: '运单号', key: 'waybillNo' }, { label: '异常类型', key: 'type' },
                        { label: '等级', key: 'level' }, { label: '上报时间', key: 'reportedAt' },
                        { label: '受理时间', key: 'acceptedAt' }, { label: '定责时间', key: 'responsibilityAt' },
                        { label: '闭环时间', key: 'resolvedAt' }, { label: '责任方', key: 'party' }, { label: '扣款', key: 'deduction' },
                        { label: '是否升级', value: function (r) { return r.escalated ? '是' : ''; } },
                        { label: '状态', value: function (r) { return EXC_TEXT[r.status] || r.status; } }
                    ]
                });
            }
        })
    });

    /* ---------- 十四、客服工单 ---------- */

    function ticketView(t) {
        var o = t.orderId ? db.get('orders', t.orderId) : null;
        var closed = t.status === 'resolved' || t.status === 'closed';
        var hours = t.resolvedAt ? util.hoursBetween(t.createdAt, t.resolvedAt) : util.hoursBetween(t.createdAt, util.now());
        return {
            raw: t, id: t.id, orderId: t.orderId || '', waybillNo: t.waybillNo || '',
            customer: t.customer || '', type: t.type || '其他', priority: t.priority || '中',
            content: t.content || '', channel: t.channel || '在线客服', status: t.status || 'pending',
            assignee: t.assignee || '', createdAt: t.createdAt, deadline: t.deadline || '',
            acceptedAt: t.acceptedAt || '', resolvedAt: t.resolvedAt || '', result: t.result || '',
            satisfaction: t.satisfaction || '', closeOperator: t.closeOperator || '',
            exceptionId: t.linkedExceptionId || '', orderStatus: o ? o.status : '',
            closed: closed, hours: hours,
            left: t.deadline ? util.hoursBetween(util.now(), t.deadline) : 0,
            overdue: !closed && !!t.deadline && util.toDate(t.deadline) < util.now()
        };
    }

    function ticketRows(days) {
        var rows = db.col('tickets').map(ticketView);
        if (days) {
            var cutoff = util.addDays(util.now(), -days).getTime();
            rows = rows.filter(function (t) { return util.toDate(t.createdAt).getTime() >= cutoff; });
        }
        return util.sortBy(rows, function (t) { return t.createdAt; }, 'desc');
    }

    var PRIORITY_TONE = { '高': 'danger', '中': 'warn', '低': 'muted' };

    function ticketModal(id) {
        var t = db.get('tickets', id);
        if (!t) { ui.toast('工单不存在', 'warn'); return; }
        var v = ticketView(t);
        var ex = v.exceptionId ? db.get('exceptions', v.exceptionId) : null;
        var sat = v.satisfaction ? util.round({ '满意': 100, '一般': 60, '不满': 20 }[v.satisfaction] || 50, 0) : 0;
        ui.modal({
            title: esc(v.type) + ' <span class="tms-mono tms-dim">' + esc(v.id) + '</span>',
            sub: esc(v.customer || '散客') + ' · ' + esc(v.channel) + ' · ' + statusBadge(v.status, TICKET_TEXT),
            size: 'wide',
            body: ui.stack([
                ui.desc([
                    { label: '优先级', value: ui.badge(esc(v.priority), PRIORITY_TONE[v.priority] || 'muted') },
                    { label: '时限', value: v.closed ? esc(fmt.duration(v.hours)) + ' 办结' : (v.left < 0 ? ui.badge('超时 ' + esc(fmt.duration(-v.left)), 'danger') : ui.badge('剩 ' + esc(fmt.duration(v.left)), v.left < 6 ? 'warn' : 'info')) },
                    { label: '受理客服', value: dim(v.assignee) },
                    { label: '创建时间', value: fmt.dateTime(v.createdAt) },
                    { label: '受理时间', value: v.acceptedAt ? fmt.dateTime(v.acceptedAt) : '<span class="tms-dim">未受理</span>' },
                    { label: '办结时间', value: v.resolvedAt ? fmt.dateTime(v.resolvedAt) : '<span class="tms-dim">未办结</span>' },
                    { label: '满意度', value: v.satisfaction ? esc(v.satisfaction) + ' ' + (sat ? pctBar(sat, { thin: true }) : '') : '<span class="tms-dim">待回访</span>' },
                    { label: '关联异常', value: ex ? ui.idCell(ex.id, 'ex:open') + ' <span class="tms-dim">' + esc(ex.type) + '</span>' : '<span class="tms-dim">未转异常</span>' }
                ], { inline: true }),
                ui.card({ title: '客户诉求', flat: true, body: '<div style="line-height:1.75">' + esc(v.content || '（未填写）') + '</div>' }),
                ui.card({
                    title: '处理记录', flat: true,
                    body: ui.timeline([
                        { title: '客户来电/留言', time: esc(fmt.dateTime(v.createdAt)), tone: 'err', body: esc(v.channel) + ' 渠道受理' },
                        v.acceptedAt ? { title: '客服受理', time: esc(fmt.dateTime(v.acceptedAt)), body: esc(v.assignee || '—') } : { title: '尚未受理', time: '待处理', tone: 'warn' },
                        v.resolvedAt ? { title: '办结：' + (v.result || '已解决'), time: esc(fmt.dateTime(v.resolvedAt)), body: esc(v.closeOperator || '') + ' · 满意度 ' + esc(v.satisfaction || '待回访') } : { title: '待办结', time: '—', tone: 'warn' }
                    ])
                })
            ]),
            footer: (v.status === 'pending' ? ui.btn('受理', { tone: 'primary', size: 'sm', act: 'cs:accept', arg: v.id }) : '') +
                (!v.closed ? ui.btn('办结回访', { tone: 'primary', size: 'sm', act: 'cs:resolve', arg: v.id }) : '') +
                (!v.exceptionId && v.orderId ? ui.btn('转异常工单', { tone: 'danger', size: 'sm', act: 'cs:exc', arg: v.id }) : '') +
                (v.exceptionId ? ui.btn('查看异常工单', { size: 'sm', act: 'ex:open', arg: v.exceptionId }) : '') +
                (v.orderId ? ui.btn('运单详情', { size: 'sm', act: 'order:open', arg: v.orderId }) : '') +
                ui.btn('关闭', { act: 'ui:close' })
        });
    }

    function ticketResolveModal(id) {
        var t = db.get('tickets', id);
        if (!t) return;
        var v = ticketView(t);
        ui.formModal({
            title: '工单办结与回访', sub: esc(v.id) + ' · ' + esc(v.type) + ' · ' + esc(v.customer || '散客'),
            notice: '办结即写入满意度，满意度进入客服绩效；超过时限的工单即使办结也记为超时。',
            values: { operator: v.assignee || actor(), satisfaction: '满意' },
            fields: [
                { key: 'result', label: '处理结果', type: 'textarea', rows: 3, required: true, span: 2, placeholder: '如何答复客户、后续动作' },
                { key: 'operator', label: '办结客服', type: 'text', required: true },
                { key: 'satisfaction', label: '回访满意度', type: 'select', required: true, options: ui.optionsOf(['满意', '一般', '不满', '待回访']) },
                { key: 'toException', label: '同步转异常工单', type: 'checkbox', hint: '适用于货损、延误等需要追责的场景' }
            ],
            okText: '办结',
            onSubmit: function (data) {
                var res = TMS.service.resolveTicket(id, data.result, { satisfaction: data.satisfaction, operator: data.operator });
                if (!res) return '工单不存在';
                if (data.toException) {
                    var ex = TMS.service.createException({
                        orderId: res.orderId, description: '客服工单转异常：' + (res.content || '') + '；处理结论：' + data.result,
                        level: res.priority === '高' ? '二级' : '三级', actor: data.operator, source: '客服上报'
                    });
                    db.update('tickets', id, { linkedExceptionId: ex.id });
                    db.commit('tickets', id, 'ticket:link-exception');
                }
                ui.toast('工单已办结，满意度记为' + data.satisfaction, 'success');
            }
        });
    }

    function ticketNewModal(orderId) {
        var cs = db.col('employees').filter(function (p) { return p.deptName === '客服中心' && p.status === 'active'; });
        ui.formModal({
            title: '登记客服工单', sub: '客户来电、在线咨询、投诉统一进这条台账',
            notice: '工单时限按 SLA 自动倒排；勾选转异常会同时建立异常工单并双向关联。',
            values: { orderId: orderId || '', priority: '中', channel: '电话', assignee: actor() },
            fields: [
                { key: 'orderId', label: '运单号', type: 'text', placeholder: 'HL… 或 WB…', hint: '咨询类工单可留空' },
                { key: 'customer', label: '客户名称', type: 'text', placeholder: '关联运单后自动取货主名', hint: '无单工单建议填写，便于按客户汇总投诉' },
                { key: 'type', label: '工单类型', type: 'select', required: true, options: ui.optionsOf(TMS.service.TICKET_TYPES) },
                { key: 'priority', label: '优先级', type: 'select', required: true, options: ui.optionsOf(['高', '中', '低']) },
                { key: 'channel', label: '受理渠道', type: 'select', required: true, options: ui.optionsOf(['电话', '在线客服', '微信', '邮件', '来访', '平台转办']) },
                { key: 'assignee', label: '受理客服', type: 'select', required: true, options: ui.optionsOf(cs.length ? cs : db.col('users').slice(0, 8), 'name', 'name') },
                { key: 'content', label: '客户诉求', type: 'textarea', rows: 3, required: true, span: 2 },
                { key: 'toException', label: '同步转异常工单', type: 'checkbox' }
            ],
            okText: '登记',
            onSubmit: function (data) {
                var key = String(data.orderId || '').trim();
                var o = key ? (db.get('orders', key) || db.findOne('orders', function (x) { return x.waybillNo === key; })) : null;
                if (key && !o) return '找不到运单 ' + key;
                var rec = TMS.service.createTicket({
                    orderId: o ? o.id : '', type: data.type, priority: data.priority,
                    content: data.content, channel: data.channel, assignee: data.assignee,
                    customer: o ? '' : (data.customer || '')
                });
                if (data.toException && o) {
                    var ex = TMS.service.createException({
                        orderId: o.id, description: '客服工单转异常：' + data.content,
                        level: data.priority === '高' ? '二级' : '三级', actor: data.assignee, source: '客服上报'
                    });
                    db.update('tickets', rec.id, { linkedExceptionId: ex.id });
                    db.commit('tickets', rec.id, 'ticket:link-exception');
                }
                ui.toast('工单已登记：' + rec.id + '，时限 ' + fmt.dateTime(rec.deadline), 'success');
            }
        });
    }

    pg.define('service', {
        sub: '客服工单台账：诉求受理、时限督办、满意度回访与转异常联动',
        load: function (ctx) {
            applyParamFilter(ctx, ['status', 'type']);
            var rows = ticketRows(0);
            var ts = TMS.service.ticketStats();
            var sat = util.countBy(rows.filter(function (t) { return t.satisfaction; }), 'satisfaction');
            return {
                ts: ts, rows: rows, sat: sat,
                byChannel: Object.keys(util.countBy(rows, 'channel')).map(function (k) { return { label: k, value: util.countBy(rows, 'channel')[k] }; }).sort(function (a, b) { return b.value - a.value; }),
                byPriority: Object.keys(util.countBy(rows, 'priority')).map(function (k) { return { label: k, value: util.countBy(rows, 'priority')[k] }; }),
                byAgent: Object.keys(util.groupBy(rows.filter(function (t) { return t.assignee; }), 'assignee')).map(function (k) {
                    var g = util.groupBy(rows.filter(function (t) { return t.assignee; }), 'assignee')[k];
                    return { label: k, value: g.length, avg: util.round(util.sum(g, function (t) { return t.hours; }) / g.length, 1) };
                }).sort(function (a, b) { return b.value - a.value; }),
                good: (sat['满意'] || 0), mid: (sat['一般'] || 0), bad: (sat['不满'] || 0)
            };
        },
        render: function (ctx, d) {
            var ts = d.ts;
            var satTotal = d.good + d.mid + d.bad;
            var kpi = ui.kpis([
                { label: '工单总量', value: ts.total, unit: '单', tone: 'brand', icon: '☏', sub: '时间窗由顶栏控制' },
                { label: '待受理', value: ts.pending, unit: '单', tone: ts.pending ? 'danger' : 'success', icon: '○', sub: '处理中 ' + ts.processing + ' 单' },
                { label: '超时未办结', value: ts.overdue, unit: '单', tone: ts.overdue ? 'danger' : 'success', icon: '◷', sub: 'SLA ' + cfg.sla.complaintHours + ' 小时' },
                { label: '办结率', value: ts.resolveRate, unit: '%', tone: ts.resolveRate >= 80 ? 'success' : 'warn', icon: '✓', sub: '已办结 ' + ts.resolved + ' 单' },
                { label: '平均办结', value: ts.avgHours, unit: '小时', tone: 'info', icon: '◔', sub: '从创建到回访' },
                { label: '客户满意', value: satTotal ? util.round(d.good / satTotal * 100, 1) : 0, unit: '%', tone: 'success', icon: '☑', sub: '一般 ' + d.mid + ' / 不满 ' + d.bad }
            ]);
            var typeCard = ui.card({
                title: '诉求类型分布', sub: '催件与查件占比高，说明轨迹推送不到位', flat: true,
                body: ts.byType.length
                    ? ch.bars({ data: ts.byType, height: 230, fmt: function (v) { return v + ' 单'; } })
                    : ui.empty('暂无客服工单', '客户零投诉')
            });
            var channelCard = ui.card({
                title: '受理渠道结构', sub: '电话占比高通常意味着自助查询体验不足', flat: true,
                body: ch.donut({ data: d.byChannel, height: 230, center: { value: String(ts.total), label: '工单' } })
            });
            var agentCard = ui.card({
                title: '客服工作量', sub: '接单量与平均办结时长同屏，识别既慢又忙的班组', flat: true,
                body: d.byAgent.length ? ui.table({
                    dense: true, keyName: 'label', rows: d.byAgent.slice(0, 8),
                    columns: [
                        { key: 'label', label: '客服', render: function (r, i) { return ui.rank(i + 1) + esc(r.label); } },
                        { key: 'value', label: '接单', align: 'right', width: '72px', render: function (r) { return r.value + ' 单'; } },
                        { key: 'avg', label: '平均办结', align: 'right', width: '96px', render: function (r) { return fmt.duration(r.avg); } }
                    ]
                }) : ui.empty('尚无受理记录')
            });
            var satCard = ui.card({
                title: '满意度回访', sub: '满意度直接进入客服绩效与申诉复核', flat: true,
                body: (satTotal ? ui.meter([
                    { value: d.good, color: '#2e9e5b' }, { value: d.mid, color: '#d98207' }, { value: d.bad, color: '#d43b3b' }
                ]) : '') + ui.desc([
                    { label: '满意', value: d.good + ' 单 · ' + fmt.percent(satTotal ? util.round(d.good / satTotal * 100, 1) : 0) },
                    { label: '一般', value: d.mid + ' 单' },
                    { label: '不满意', value: d.bad + ' 单', },
                    { label: '待回访', value: ts.resolved - satTotal + ' 单' }
                ], { inline: true }) + (d.bad ? ui.notice('有 ' + d.bad + ' 单不满意回访，建议逐单复盘并回访补救', 'warn', '需复核') : ui.notice('回访结果无不满意记录', 'success'))
            });
            return wrap(ctx, {
                actions: ui.btn('登记工单', { size: 'sm', act: 'cs:new', icon: '＋' }) +
                    ui.btn('导出工单', { size: 'sm', act: 'cs:export', icon: '⤓' }),
                body: [kpi, ui.split('2', [typeCard, channelCard]), ui.split('2', [agentCard, satCard]), grid(ctx, {
                    rows: d.rows, keyName: 'id', onRow: 'cs:open', searchKey: 'q', pageSize: 20,
                    search: function (t) { return [t.id, t.waybillNo, t.customer, t.type, t.content, t.assignee].join(' '); },
                    chips: [
                        { label: '全部', value: '', count: d.rows.length },
                        { label: '待受理', value: 'pending', count: ts.pending },
                        { label: '处理中', value: 'processing', count: ts.processing },
                        { label: '超时', value: 'overdue', count: ts.overdue }
                    ], chipsName: 'flag',
                    fields: [
                        { key: 'q', type: 'search', label: '工单 / 运单 / 客户 / 诉求', placeholder: 'CS… / WB… / 客户名' },
                        { key: 'status', label: '状态', options: [{ value: '', label: '全部' }].concat(ui.optionsOf(['pending', 'processing', 'resolved'])) },
                        { key: 'type', label: '类型', options: [{ value: '', label: '全部类型' }].concat(ui.optionsOf(TMS.service.TICKET_TYPES)) },
                        { key: 'priority', label: '优先级', options: [{ value: '', label: '全部' }].concat(ui.optionsOf(['高', '中', '低'])) },
                        { key: 'channel', label: '渠道', options: [{ value: '', label: '全部渠道' }].concat(ui.optionsOf(d.byChannel, 'label', 'label')) },
                        { key: 'assignee', label: '客服', options: [{ value: '', label: '全部' }].concat(ui.optionsOf(util.unique(d.rows.map(function (t) { return t.assignee; })))) }
                    ],
                    filter: function (t, fs) {
                        if (fs.status && t.status !== fs.status) return false;
                        if (fs.type && t.type !== fs.type) return false;
                        if (fs.priority && t.priority !== fs.priority) return false;
                        if (fs.channel && t.channel !== fs.channel) return false;
                        if (fs.assignee && t.assignee !== fs.assignee) return false;
                        if (fs.orderId && t.orderId !== fs.orderId) return false;
                        if (fs.flag === 'overdue') return t.overdue;
                        if (fs.flag && t.status !== fs.flag) return false;
                        return true;
                    },
                    valueOf: function (t, k) {
                        if (k === 'sla') return t.closed ? t.hours : t.left;
                        if (k === 'rank') return { '高': 3, '中': 2, '低': 1 }[t.priority] || 0;
                        return t[k];
                    },
                    columns: [
                        { key: 'id', label: '工单号', width: '132px', render: function (t) { return idLink(t.id, 'cs:open'); } },
                        { key: 'waybillNo', label: '运单 / 客户', render: function (t) { return (t.orderId ? idLink(t.orderId, 'cs:order') : '<span class="tms-dim">无单咨询</span>') + ' <span class="tms-dim">' + esc(t.customer || '散客') + '</span>'; } },
                        { key: 'type', label: '诉求类型', width: '104px' },
                        { key: 'rank', label: '优先级', width: '76px', render: function (t) { return ui.badge(esc(t.priority), PRIORITY_TONE[t.priority] || 'muted'); } },
                        { key: 'content', label: '内容摘要', render: function (t) { return '<span class="tms-dim">' + esc(String(t.content || '').slice(0, 24)) + '</span>'; } },
                        { key: 'channel', label: '渠道', width: '88px' },
                        { key: 'createdAt', label: '创建时间', width: '128px', render: function (t) { return ui.timeCell(t.createdAt); } },
                        {
                            key: 'sla', label: '时限', width: '104px', align: 'right', render: function (t) {
                                if (t.closed) return '<span class="tms-dim">' + esc(fmt.duration(t.hours)) + ' 办结</span>';
                                return t.left < 0 ? ui.badge('超时 ' + esc(fmt.duration(-t.left)), 'danger') : ui.badge('剩 ' + esc(fmt.duration(t.left)), t.left < 6 ? 'warn' : 'info');
                            }
                        },
                        { key: 'assignee', label: '客服', width: '88px', render: function (t) { return dim(t.assignee); } },
                        { key: 'satisfaction', label: '满意度', width: '84px', render: function (t) { return t.satisfaction ? ui.badge(esc(t.satisfaction), t.satisfaction === '满意' ? 'success' : t.satisfaction === '不满' ? 'danger' : 'muted') : '<span class="tms-dim">待回访</span>'; } },
                        { key: 'status', label: '状态', width: '92px', render: function (t) { return statusBadge(t.status, TICKET_TEXT); } },
                        {
                            key: 'ops', label: '操作', width: '104px', sortable: false, render: function (t) {
                                if (t.status === 'pending') return ui.link('受理', 'cs:accept', t.id, { tone: 'ghost' });
                                if (!t.closed) return ui.link('办结', 'cs:resolve', t.id, { tone: 'ghost' });
                                return ui.link('查看', 'cs:open', t.id, { tone: 'ghost' });
                            }
                        }
                    ],
                    emptyText: '没有符合条件的客服工单', emptySub: '放宽筛选，或登记一条新工单'
                })]
            });
        },
        actions: merge(pg.shared, excActions, {
            'cs:open': function (id) { ticketModal(id); },
            'cs:new': function () { ticketNewModal(); },
            'cs:order': function (id) { ui.closeTop(); pg.openOrder(id); },
            'cs:accept': function (id) {
                var t = db.get('tickets', id);
                if (!t) { ui.toast('工单不存在', 'warn'); return; }
                if (t.status !== 'pending') { ui.toast('工单已受理', 'info'); return; }
                var res = TMS.service.processTicket(id, actor());
                ui.toast(res ? '已受理并转处理中' : '受理失败', res ? 'success' : 'error');
            },
            'cs:resolve': function (id) { ticketResolveModal(id); },
            'cs:exc': function (id) {
                var t = db.get('tickets', id);
                if (!t) return;
                if (t.linkedExceptionId) { exceptionModal(t.linkedExceptionId); return; }
                if (!t.orderId) { ui.toast('该工单未关联运单，无法转异常', 'warn'); return; }
                ui.confirm({
                    title: '客服工单转异常', message: '按工单内容建立异常工单并双向关联，进入定责与闭环流程。',
                    detail: esc(t.id) + ' · ' + esc(t.type) + ' · ' + esc(t.waybillNo || t.orderId)
                }).then(function (yes) {
                    if (!yes) return;
                    var ex = TMS.service.createException({
                        orderId: t.orderId, description: '客服工单转异常：' + (t.content || ''),
                        level: t.priority === '高' ? '二级' : '三级', actor: t.assignee || actor(), source: '客服上报'
                    });
                    db.update('tickets', id, { linkedExceptionId: ex.id });
                    db.commit('tickets', id, 'ticket:link-exception');
                    ui.toast('已转异常工单：' + ex.id, 'success');
                    exceptionModal(ex.id);
                });
            },
            'cs:export': function () {
                exportGrid({
                    name: '客服工单.csv', rows: ticketRows(0),
                    cols: [
                        { label: '工单号', key: 'id' }, { label: '订单号', key: 'orderId' }, { label: '运单号', key: 'waybillNo' },
                        { label: '客户', key: 'customer' }, { label: '诉求类型', key: 'type' }, { label: '优先级', key: 'priority' },
                        { label: '内容', key: 'content' }, { label: '渠道', key: 'channel' },
                        { label: '状态', value: function (t) { return TICKET_TEXT[t.status] || t.status; } },
                        { label: '受理客服', key: 'assignee' }, { label: '创建时间', key: 'createdAt' }, { label: '时限', key: 'deadline' },
                        { label: '受理时间', key: 'acceptedAt' }, { label: '办结时间', key: 'resolvedAt' },
                        { label: '耗时小时', value: function (t) { return util.round(t.hours, 1); } },
                        { label: '处理结果', key: 'result' }, { label: '满意度', key: 'satisfaction' }, { label: '关联异常', key: 'exceptionId' }
                    ]
                });
            }
        }),
        drawerFooter: function (orderId) {
            var open = db.col('tickets').filter(function (t) { return t.orderId === orderId && t.status === 'pending'; });
            return ui.btn(open.length ? ('客服工单 ' + open.length + ' 单待受理') : '登记客服工单',
                { size: 'sm', tone: open.length ? 'warn' : '', act: open.length ? 'cs:open' : 'cs:new', arg: open.length ? open[0].id : orderId });
        }
    });

    /* ---------- 十五、理赔管理 ---------- */

    /* 理赔条款：保价按声明价值赔，未保价按运费 5 倍且不低于 200 封顶，
       金额上限在受理时就提示，避免审批人现场按条款心算 */
    function claimRule(order) {
        if (!order) return { cap: 0, basis: '未关联运单，按实报金额受理' };
        if (order.isInsured) {
            var dv = Number(order.declaredValue) || 0;
            return { cap: dv, basis: '已保价，声明价值 ' + fmt.money(dv) + '，按实际损失与声明价值孰低赔付' };
        }
        var cap = util.money(Math.max((Number(order.freight) || 0) * 5, 200));
        return { cap: cap, basis: '未保价，按运费 5 倍封顶赔付（' + fmt.money(order.freight || 0) + ' × 5，不低于 200）' };
    }

    function claimSuggest(r) {
        var o = r && r.orderId ? db.get('orders', r.orderId) : null;
        var rule = claimRule(o);
        var amount = r && r.deduction ? r.deduction : (o ? Number(o.declaredValue) || util.money((Number(o.freight) || 0) * 2) : 0);
        return rule.cap ? util.money(Math.min(amount, rule.cap)) : util.money(amount);
    }

    function claimView(c) {
        var o = c.orderId ? db.get('orders', c.orderId) : null;
        var rule = claimRule(o);
        return {
            raw: c, id: c.id, orderId: c.orderId || '', waybillNo: c.waybillNo || '',
            customer: c.customer || '', type: c.type || '货物破损', amount: Number(c.amount) || 0,
            reason: c.reason || '', status: c.status || 'pending', applicant: c.applicant || '',
            createdAt: c.createdAt, deadline: c.deadline || '', handledAt: c.handledAt || '',
            handler: c.handler || '', auditNote: c.auditNote || '', evidence: c.evidence || '',
            exceptionId: c.exceptionId || '', declaredValue: c.declaredValue || (o ? Number(o.declaredValue) || 0 : 0),
            insured: !!c.isInsured || !!(o && o.isInsured), cap: rule.cap, basis: rule.basis,
            freight: o ? Number(o.freight) || 0 : 0, orderStatus: o ? o.status : '',
            days: c.deadline ? util.hoursBetween(util.now(), util.toDate(c.deadline + 'T23:59')) : 0
        };
    }

    function claimRows(days) {
        var rows = db.col('claims').map(claimView);
        if (days) {
            var cutoff = util.addDays(util.now(), -days).getTime();
            rows = rows.filter(function (c) { return util.toDate(c.createdAt).getTime() >= cutoff; });
        }
        return util.sortBy(rows, function (c) { return c.createdAt; }, 'desc');
    }

    function claimModal(id) {
        var c = db.get('claims', id);
        if (!c) { ui.toast('理赔单不存在', 'warn'); return; }
        var v = claimView(c);
        var payout = db.findOne('finances', function (f) { return f.refId === v.id && f.category === '理赔支出'; });
        ui.modal({
            title: esc(v.type) + ' <span class="tms-mono tms-dim">' + esc(v.id) + '</span>',
            sub: esc(v.customer || '散客') + ' · ' + esc(v.waybillNo || '无运单') + ' · ' + statusBadge(v.status, CLAIM_TEXT),
            size: 'wide',
            body: ui.stack([
                ui.desc([
                    { label: '申报金额', value: ui.moneyCell(v.amount, { strong: true }) },
                    { label: '保价', value: v.insured ? ui.badge('已保价', 'success') + ' 声明价值 ' + fmt.money(v.declaredValue) : ui.badge('未保价', 'warn') },
                    { label: '赔付上限', value: fmt.money(v.cap) },
                    { label: '核定金额', value: v.status === 'approved' ? ui.moneyCell(v.amount, { strong: true }) : '<span class="tms-dim">未核定</span>' },
                    { label: '运费', value: fmt.money(v.freight) },
                    { label: '理赔时效', value: v.deadline ? fmt.date(v.deadline) + (v.days < 0 && v.status === 'pending' ? ' ' + ui.badge('已过期', 'danger') : ' ' + ui.badge('剩 ' + util.round(Math.max(v.days, 0), 0) + ' 天', v.days < 3 ? 'warn' : 'info')) : '—' },
                    { label: '申请人', value: esc(v.applicant || '—') },
                    { label: '申请时间', value: fmt.dateTime(v.createdAt) },
                    { label: '理赔处理人', value: dim(v.handler) },
                    { label: '处理时间', value: v.handledAt ? fmt.dateTime(v.handledAt) : '<span class="tms-dim">未处理</span>' }
                ], { inline: true }),
                ui.notice(esc(v.basis), v.insured ? 'info' : 'warn', '赔付条款'),
                ui.card({ title: '出险说明', flat: true, body: '<div style="line-height:1.75">' + esc(v.reason || '（未填写）') + '</div>' + (v.evidence ? '<div class="tms-dim" style="margin-top:6px">证据材料：' + esc(v.evidence) + '</div>' : '') }),
                ui.card({
                    title: '关联单据', flat: true,
                    body: ui.desc([
                        { label: '运单', value: v.orderId ? ui.idCell(v.waybillNo || v.orderId, 'order:open') + ' <span class="tms-dim">' + esc(pg.statusText(v.orderStatus)) + '</span>' : '<span class="tms-dim">未关联</span>' },
                        { label: '异常工单', value: v.exceptionId ? ui.idCell(v.exceptionId, 'ex:open') : '<span class="tms-dim">无</span>' },
                        { label: '赔付支出', value: payout ? ui.idCell(payout.id, 'ui:close') + ' ' + ui.moneyCell(payout.amount) + ' <span class="tms-dim">' + esc(payout.status === 'settled' ? '已入账' : payout.status) + '</span>' : (v.status === 'approved' ? ui.badge('支出未入账', 'danger') : '<span class="tms-dim">审批通过后入账</span>') }
                    ], { inline: true })
                }),
                v.auditNote ? ui.card({ title: '审核意见', flat: true, body: esc(v.auditNote) }) : ''
            ]),
            footer: (v.status === 'pending'
                ? ui.btn('核准赔付', { tone: 'primary', size: 'sm', act: 'cl:approve', arg: v.id }) +
                ui.btn('驳回', { tone: 'danger', size: 'sm', act: 'cl:reject', arg: v.id })
                : '') + ui.btn('关闭', { act: 'ui:close' })
        });
    }

    function claimApproveModal(id) {
        var c = db.get('claims', id);
        if (!c) return;
        var v = claimView(c);
        var suggest = v.cap ? util.money(Math.min(v.amount, v.cap)) : v.amount;
        ui.formModal({
            title: '核准理赔赔付', sub: esc(v.id) + ' · ' + esc(v.type) + ' · ' + esc(v.customer || '散客'),
            notice: '条款：' + esc(v.basis) + '。核准后按核定金额生成一笔「理赔支出」并计入运单成本。',
            values: { amount: suggest, handler: actor(), note: v.insured ? '按保价金额赔付' : '按运费 5 倍封顶赔付' },
            fields: [
                { key: 'amount', label: '核定赔付金额', type: 'number', required: true, min: 0, step: '0.01', unit: '元', hint: '申报 ' + fmt.money(v.amount) + '，条款上限 ' + fmt.money(v.cap) },
                { key: 'handler', label: '理赔处理人', type: 'text', required: true },
                { key: 'note', label: '审核意见', type: 'textarea', rows: 3, required: true, span: 2 }
            ],
            okText: '核准并入账',
            onSubmit: function (data) {
                if (Number(data.amount) <= 0) return '赔付金额必须大于 0';
                if (v.cap && Number(data.amount) > v.cap) return '超出条款上限 ' + fmt.money(v.cap) + '，请复核后按上限录入';
                var res = TMS.service.approveClaim(id, { amount: data.amount, handler: data.handler, note: data.note });
                if (!res) return '理赔单不存在';
                if (res.ok === false) return res.message;
                ui.toast('已核准 ' + fmt.money(res.amount) + '，理赔支出已入账', 'success');
            }
        });
    }

    function claimRejectModal(id) {
        var c = db.get('claims', id);
        if (!c) return;
        var v = claimView(c);
        ui.formModal({
            title: '驳回理赔', sub: esc(v.id) + ' · ' + esc(v.type),
            notice: '驳回不做账务处理，运单成本与财务流水均不变化；请写明证据缺项，便于客户补件。',
            values: { handler: actor(), note: '证据不足，不予赔付' },
            fields: [
                { key: 'handler', label: '理赔处理人', type: 'text', required: true },
                { key: 'note', label: '驳回理由', type: 'textarea', rows: 3, required: true, span: 2 }
            ],
            okText: '驳回', danger: true,
            onSubmit: function (data) {
                var res = TMS.service.rejectClaim(id, data.note, data.handler);
                if (!res) return '理赔单不存在';
                ui.toast('已驳回：' + res.id, 'warn');
            }
        });
    }

    function claimNewModal(seed) {
        var s = seed || {};
        ui.formModal({
            title: '建立理赔单', sub: '货损货差理赔受理，审批通过后进入支出账',
            notice: '金额受条款约束：保价按声明价值孰低，未保价按运费 5 倍且不低于 200 封顶。',
            values: {
                orderId: s.orderId || '', type: s.type || '货物破损', amount: s.amount || '',
                reason: s.reason || '', applicant: s.applicant || actor(), exceptionId: s.exceptionId || ''
            },
            fields: [
                { key: 'orderId', label: '运单号', type: 'text', required: true, placeholder: 'HL… 或 WB…' },
                { key: 'type', label: '出险类型', type: 'select', required: true, options: ui.optionsOf(TMS.service.EXCEPTION_TYPES) },
                { key: 'amount', label: '申报金额', type: 'number', required: true, min: 0, step: '0.01', unit: '元' },
                { key: 'applicant', label: '申请人', type: 'text', required: true },
                { key: 'reason', label: '出险说明', type: 'textarea', rows: 3, required: true, span: 2 },
                { key: 'exceptionId', label: '关联异常工单', type: 'text', hint: '留空则由异常台账反向立案时自动关联' }
            ],
            okText: '立案',
            onSubmit: function (data) {
                var key = String(data.orderId || '').trim();
                var o = db.get('orders', key) || db.findOne('orders', function (x) { return x.waybillNo === key; });
                if (!o) return '找不到运单 ' + key;
                var rule = claimRule(o);
                if (rule.cap && Number(data.amount) > rule.cap) {
                    ui.toast('申报超上限，已按条款调整为 ' + fmt.money(rule.cap), 'warn');
                }
                var rec = TMS.service.createClaim({
                    orderId: o.id, type: data.type, amount: rule.cap ? Math.min(Number(data.amount), rule.cap) : data.amount,
                    reason: data.reason, applicant: data.applicant, exceptionId: data.exceptionId
                });
                if (data.exceptionId) {
                    var ex = db.get('exceptions', data.exceptionId);
                    if (ex) { ex.linkedClaimId = rec.id; db.commit('exceptions', ex.id, 'claim:link-exception'); }
                }
                ui.toast('理赔单已建立：' + rec.id + '，时效至 ' + rec.deadline, 'success');
            }
        });
    }

    pg.define('claim', {
        sub: '理赔审批台账：条款上限、赔付入账与异常工单双向可追',
        load: function (ctx) {
            applyParamFilter(ctx, ['status', 'orderId']);
            var rows = claimRows(0);
            var cs = TMS.service.claimStats();
            var payouts = db.col('finances').filter(function (f) { return f.category === '理赔支出'; });
            var byDay = {};
            payouts.forEach(function (f) {
                var k = util.dateKey(util.toDate(f.date));
                byDay[k] = (byDay[k] || 0) + Number(f.amount) || 0;
            });
            var trend = [];
            for (var i = 13; i >= 0; i--) {
                var key = util.dateKey(util.addDays(util.now(), -i));
                trend.push({ label: util.fmt.monthDay(key), value: util.money(byDay[key] || 0) });
            }
            return {
                cs: cs, rows: rows, trend: trend, payouts: payouts,
                insured: rows.filter(function (c) { return c.insured; }).length,
                uninsured: rows.filter(function (c) { return !c.insured; }).length,
                overCap: rows.filter(function (c) { return c.status === 'pending' && c.cap && c.amount > c.cap; }).length,
                expiring: rows.filter(function (c) { return c.status === 'pending' && c.days <= 3; }).length
            };
        },
        render: function (ctx, d) {
            var cs = d.cs;
            var kpi = ui.kpis([
                { label: '理赔单量', value: cs.total, unit: '件', tone: 'brand', icon: '¥', sub: '运单出险率 ' + fmt.percent(cs.damageRate) },
                { label: '待审批', value: cs.pending, unit: '件', tone: cs.pending ? 'warn' : 'success', icon: '○', sub: '申报合计 ' + fmt.money(cs.pendingAmount) },
                { label: '已核准', value: cs.approved, unit: '件', tone: 'success', icon: '✓', sub: fmt.money(cs.amount) + ' 已入账' },
                { label: '已驳回', value: cs.rejected, unit: '件', tone: cs.rejected ? 'muted' : 'success', icon: '✕', sub: '通过率 ' + fmt.percent(cs.rate) },
                { label: '超上限待核', value: d.overCap, unit: '件', tone: d.overCap ? 'danger' : 'success', icon: '⚖', sub: '申报额已超条款上限' },
                { label: '临期理赔', value: d.expiring, unit: '件', tone: d.expiring ? 'warn' : 'success', icon: '◷', sub: '时效 3 日内到期' }
            ]);
            var typeCard = ui.card({
                title: '出险类型与赔付', sub: '破损与遗失吃掉多少毛利，决定包装与交接改造优先级', flat: true,
                body: cs.byType.length ? ui.table({
                    dense: true, keyName: 'label', rows: cs.byType,
                    columns: [
                        { key: 'label', label: '类型', render: function (r) { return esc(r.label) + ' ' + ui.badge(r.count + ' 件', 'muted'); } },
                        { key: 'amount', label: '已赔', align: 'right', render: function (r) { return r.amount ? ui.moneyCell(r.amount) : '<span class="tms-dim">—</span>'; } },
                        {
                            key: 'share', label: '赔付占比', align: 'right', width: '132px', sortable: false, render: function (r) {
                                return rateBar(cs.amount ? util.round(r.amount / cs.amount * 100, 1) : 0, { target: 100 });
                            }
                        }
                    ]
                }) : ui.empty('暂无理赔记录', '全程零货损货差')
            });
            var trendCard = ui.card({
                title: '赔付支出走势', sub: '理赔支出一旦核准即进财务流水', flat: true,
                body: d.payouts.length
                    ? ch.line({ data: d.trend, height: 230, area: true, fmt: function (v) { return fmt.money(v); } })
                    : ui.empty('尚无赔付入账', '核准后自动生成支出')
            });
            var insuredCard = ui.card({
                title: '保价结构', sub: '未保价件按运费 5 倍封顶，客户赔付体验差，是保价营销的直接依据', flat: true,
                body: ch.donut({
                    data: [{ label: '已保价', value: d.insured }, { label: '未保价', value: d.uninsured }],
                    height: 230, center: { value: String(d.rows.length), label: '理赔单' }
                }) + ui.desc([
                    { label: '保价覆盖', value: rateBar(d.rows.length ? util.round(d.insured / d.rows.length * 100, 1) : 0, { target: 60 }) },
                    { label: '全库保价单', value: db.col('orders').filter(function (o) { return o.isInsured; }).length + ' 单' }
                ], { inline: true })
            });
            return wrap(ctx, {
                actions: ui.btn('建立理赔', { size: 'sm', act: 'cl:new', icon: '＋' }) +
                    ui.btn('导出理赔台账', { size: 'sm', act: 'cl:export', icon: '⤓' }),
                body: [kpi, ui.split('2', [typeCard, trendCard]), insuredCard, grid(ctx, {
                    rows: d.rows, keyName: 'id', onRow: 'cl:open', searchKey: 'q', pageSize: 20,
                    search: function (c) { return [c.id, c.waybillNo, c.orderId, c.customer, c.type, c.reason, c.applicant].join(' '); },
                    chips: [
                        { label: '全部', value: '', count: d.rows.length },
                        { label: '待审批', value: 'pending', count: cs.pending },
                        { label: '已核准', value: 'approved', count: cs.approved },
                        { label: '已驳回', value: 'rejected', count: cs.rejected }
                    ], chipsName: 'status',
                    fields: [
                        { key: 'q', type: 'search', label: '理赔号 / 运单 / 客户', placeholder: 'CL… / WB… / 客户名' },
                        { key: 'type', label: '出险类型', options: [{ value: '', label: '全部类型' }].concat(ui.optionsOf(TMS.service.EXCEPTION_TYPES)) },
                        { key: 'insured', label: '保价', options: [{ value: '', label: '全部' }, { value: '1', label: '仅保价件' }, { value: '0', label: '仅未保价件' }] }
                    ],
                    filter: function (c, fs) {
                        if (fs.status && c.status !== fs.status) return false;
                        if (fs.type && c.type !== fs.type) return false;
                        if (fs.orderId && c.orderId !== fs.orderId) return false;
                        if (fs.insured === '1' && !c.insured) return false;
                        if (fs.insured === '0' && c.insured) return false;
                        return true;
                    },
                    valueOf: function (c, k) { return k === 'deadline' ? c.deadline : c[k]; },
                    columns: [
                        { key: 'id', label: '理赔号', width: '128px', render: function (c) { return idLink(c.id, 'cl:open'); } },
                        { key: 'waybillNo', label: '运单 / 客户', render: function (c) { return (c.orderId ? idLink(c.orderId, 'cl:order') : '<span class="tms-dim">无单</span>') + ' <span class="tms-dim">' + esc(c.customer || '散客') + '</span>'; } },
                        { key: 'type', label: '出险类型', width: '104px' },
                        { key: 'amount', label: '申报金额', align: 'right', width: '104px', render: function (c) { return ui.moneyCell(c.amount, { strong: c.status === 'pending' }); } },
                        {
                            key: 'insured', label: '保价 / 上限', width: '132px', sortable: false, render: function (c) {
                                return (c.insured ? ui.badge('保价', 'success') : ui.badge('未保价', 'warn')) +
                                    ' <span class="tms-dim">' + fmt.money(c.cap) + '</span>';
                            }
                        },
                        {
                            key: 'result', label: '核定金额', align: 'right', width: '104px', sortable: false, render: function (c) {
                                if (c.status === 'approved') return ui.moneyCell(c.amount, { strong: true });
                                if (c.status === 'rejected') return '<span class="tms-dim">已驳回</span>';
                                return c.cap && c.amount > c.cap ? ui.badge('超上限', 'danger') : '<span class="tms-dim">待核</span>';
                            }
                        },
                        { key: 'applicant', label: '申请人', width: '96px', render: function (c) { return dim(c.applicant); } },
                        { key: 'createdAt', label: '申请时间', width: '128px', render: function (c) { return ui.timeCell(c.createdAt); } },
                        {
                            key: 'deadline', label: '理赔时效', width: '104px', sortable: false, render: function (c) {
                                if (c.status !== 'pending') return '<span class="tms-dim">' + esc(c.handledAt ? fmt.date(c.handledAt) : '—') + '</span>';
                                return c.days < 0 ? ui.badge('已过期', 'danger') : ui.badge('剩 ' + util.round(Math.max(c.days, 0), 0) + ' 天', c.days <= 3 ? 'warn' : 'info');
                            }
                        },
                        { key: 'status', label: '状态', width: '84px', render: function (c) { return statusBadge(c.status, CLAIM_TEXT); } },
                        {
                            key: 'ops', label: '操作', width: '104px', sortable: false, render: function (c) {
                                return c.status === 'pending'
                                    ? ui.link('核准', 'cl:approve', c.id, { tone: 'ghost' }) + ' ' + ui.link('驳回', 'cl:reject', c.id, { tone: 'ghost' })
                                    : ui.link('查看', 'cl:open', c.id, { tone: 'ghost' });
                            }
                        }
                    ],
                    emptyText: '没有符合条件的理赔单', emptySub: '理赔由异常闭环联动立案，可先去异常工单转理赔'
                })]
            });
        },
        actions: merge(pg.shared, excActions, {
            'cl:open': function (id) { claimModal(id); },
            'cl:new': function () { claimNewModal(); },
            'cl:approve': function (id) { claimApproveModal(id); },
            'cl:reject': function (id) { claimRejectModal(id); },
            'cl:order': function (id) { ui.closeTop(); pg.openOrder(id); },
            'cl:export': function () {
                exportGrid({
                    name: '理赔台账.csv', rows: claimRows(0),
                    cols: [
                        { label: '理赔号', key: 'id' }, { label: '订单号', key: 'orderId' }, { label: '运单号', key: 'waybillNo' },
                        { label: '客户', key: 'customer' }, { label: '出险类型', key: 'type' }, { label: '申报金额', key: 'amount' },
                        { label: '是否保价', value: function (c) { return c.insured ? '保价' : '未保价'; } },
                        { label: '声明价值', key: 'declaredValue' }, { label: '条款上限', key: 'cap' }, { label: '运费', key: 'freight' },
                        { label: '状态', value: function (c) { return CLAIM_TEXT[c.status] || c.status; } },
                        { label: '申请人', key: 'applicant' }, { label: '申请时间', key: 'createdAt' }, { label: '时效截止', key: 'deadline' },
                        { label: '处理人', key: 'handler' }, { label: '处理时间', key: 'handledAt' }, { label: '审核意见', key: 'auditNote' },
                        { label: '关联异常', key: 'exceptionId' }, { label: '出险说明', key: 'reason' }
                    ]
                });
            }
        }),
        drawerFooter: function (orderId) {
            var o = db.get('orders', orderId);
            if (!o) return '';
            var pending = db.col('claims').filter(function (c) { return c.orderId === orderId && c.status === 'pending'; });
            if (pending.length) return ui.btn('理赔待审批 ' + pending.length + ' 件', { size: 'sm', tone: 'warn', act: 'cl:open', arg: pending[0].id });
            return ui.btn('建立理赔单', { size: 'sm', act: 'cl:new', arg: orderId });
        }
    });

    /* ---------- 十六、运价卡 ---------- */

    var RT_TEXT = { active: '生效中', inactive: '已停用' };

    function zoneCity(zone) {
        var hit = TMS.master.CITIES.filter(function (x) { return x.zone === zone; })[0];
        return hit ? hit.name : '上海';
    }

    /* 卡面续重价对「外协采购挂牌价 × 最低加成」体检：穿过这条线的卡，成交一票亏一票。
       采购价来自 cfg.cost 的零担公式，与销售价同源不同口径，所以必须逐卡比对而不是看毛利率 */
    function cardEcom(card) {
        var buy = TMS.pricing.ltlRate(Number(card.lineKm) || 0, 1);
        var floor = util.round(buy * (Number(cfg.cost.bulkMinMarkup) || 1.2), 2);
        var cont = Number(card.continueFee) || 0;
        return { buy: buy, floor: floor, cont: cont, gap: util.round(cont - floor, 3), safe: cont >= floor };
    }

    function cardView(c, use) {
        var e = cardEcom(c);
        var u = use || { count: 0, weight: 0, revenue: 0, cost: 0, signed: 0 };
        var days = Math.round(util.hoursBetween(util.now(), util.toDate(c.validTo)) / 24);
        return {
            id: c.id, name: c.name, service: c.service, version: c.version || '',
            origin: c.origin, destination: c.destination,
            originZone: c.originZone, destinationZone: c.destinationZone,
            lineType: c.origin === '全国' ? '区域卡' : '城市专线',
            line: c.origin === '全国' ? (c.originZone + '→' + c.destinationZone) : (c.origin + '→' + c.destination),
            lineKm: Number(c.lineKm) || 0, firstWeight: Number(c.firstWeight) || 0,
            firstFee: Number(c.firstFee) || 0, cont: e.cont, minCharge: Number(c.minCharge) || 0,
            throwRatio: Number(c.throwRatio) || cfg.billing.defaultThrowRatio,
            fuelRate: util.round((Number(c.fuelRate) || 0) * 100, 1),
            insuredRate: Number(c.insuredRate) || cfg.billing.insuredRate,
            codRate: Number(c.codRate) || cfg.billing.codRate,
            remoteFee: Number(c.remoteSurcharge) || 0,
            validFrom: c.validFrom, validTo: c.validTo, status: c.status,
            days: days, expired: days < 0, soon: days >= 0 && days <= 30,
            buy: e.buy, floor: e.floor, gap: e.gap, safe: e.safe,
            dealCount: u.count, dealWeight: util.round(u.weight, 1),
            revenue: util.money(u.revenue), cost: util.money(u.cost),
            margin: u.revenue ? util.round((u.revenue - u.cost) / u.revenue * 100, 1) : null
        };
    }

    /* 成交口径一次成索引：196 张卡逐张扫订单会得到 27 万次比对，读一次全库分组即可 */
    function rtRows() {
        var idx = {};
        db.col('orders').forEach(function (o) {
            var k = (o.fees && o.fees.cardId) || '';
            if (!k) return;
            var g = idx[k] || (idx[k] = { count: 0, weight: 0, revenue: 0, cost: 0, signed: 0 });
            g.count++;
            g.weight += Number(o.chargeableWeight) || 0;
            if (o.status === 'signed') { g.signed++; g.revenue += Number(o.freight) || 0; g.cost += TMS.pricing.costTotalOf(o); }
        });
        return db.col('rateCards').map(function (c) { return cardView(c, idx[c.id]); });
    }

    function cardDeals(id, limit) {
        return util.sortBy(db.col('orders').filter(function (o) { return o.fees && o.fees.cardId === id; }), 'createdAt', 'desc')
            .map(TMS.order.view).slice(0, limit || 8);
    }

    /* 卡片经济性要用同一条公式复现：给一张 100kg 标准样票，报价与成本一次算清 */
    function cardSample(c) {
        var params = {
            origin: c.origin === '全国' ? zoneCity(c.originZone) : c.origin,
            destination: c.destination === '全国' ? zoneCity(c.destinationZone) : c.destination,
            service: c.service, weight: 100, pieces: 1, paymentMethod: '现付'
        };
        var q = TMS.pricing.quote(params, { card: c });
        q.sampleFrom = params.origin;
        q.sampleTo = params.destination;
        return q;
    }

    function rtModal(id) {
        var c = db.get('rateCards', id);
        if (!c) return;
        var v = cardView(c);
        var q = cardSample(c);
        var deals = cardDeals(id, 8);
        ui.modal({
            title: '运价卡 ' + esc(c.name), size: 'wide',
            sub: esc(v.line) + ' · ' + esc(v.service) + ' · ' + esc(v.version) + ' · ' + statusBadge(v.status, RT_TEXT),
            body: ui.stack([
                ui.split('2', [
                    ui.card({
                        title: '卡面价目', sub: '首重含 ' + v.firstWeight + 'kg，续重按计费重量阶梯打折', flat: true,
                        body: ui.desc([
                            { label: '首重价', value: fmt.money(v.firstFee) + ' / ' + v.firstWeight + 'kg' },
                            { label: '续重价', value: '<b>' + fmt.money(v.cont) + '</b> /kg' },
                            { label: '最低收费', value: fmt.money(v.minCharge) },
                            { label: '体积抛比', value: '1 : ' + v.throwRatio },
                            { label: '燃油附加', value: fmt.percent(v.fuelRate) },
                            { label: '保价费率', value: fmt.percent(util.round(v.insuredRate * 100, 2)) },
                            { label: '到付手续费', value: fmt.percent(util.round(v.codRate * 100, 1)) },
                            { label: '偏远附加', value: v.remoteFee ? fmt.money(v.remoteFee) : '不收' },
                            { label: '干线里程', value: fmt.km(v.lineKm) },
                            { label: '有效期', value: esc(v.validFrom) + ' ~ ' + esc(v.validTo) }
                        ])
                    }),
                    ui.card({
                        title: '经济性体检', sub: '销售价与外协采购价的差额就是这票货能挣的下限', flat: true,
                        body: ui.desc([
                            { label: '采购挂牌价', value: fmt.money(v.buy) + ' /kg' },
                            { label: '最低限价', value: fmt.money(v.floor) + ' /kg（采购价 × ' + cfg.cost.bulkMinMarkup + '）' },
                            { label: '卡面安全垫', value: v.gap >= 0 ? '<span class="tms-money tone-success">+' + fmt.money(v.gap) + '</span>' : '<span class="tms-money tone-danger">' + fmt.money(v.gap) + '</span>' },
                            { label: '近端成交', value: v.dealCount + ' 单 · ' + fmt.kg(v.dealWeight) },
                            { label: '签收收入', value: fmt.money(v.revenue) },
                            { label: '实际毛利率', value: v.margin == null ? '<span class="tms-dim">暂无签收单</span>' : rateBar(v.margin, { target: cfg.cost.targetMargin || 18 }) }
                        ]),
                        foot: v.safe ? ui.notice('卡面续重价高于最低限价，量价折扣打满也不会穿过成本线。', 'success')
                            : ui.notice('卡面续重价比最低限价低 ' + fmt.money(-v.gap) + '/kg，KA 折扣叠加后必亏。建议调到 ' + fmt.money(v.floor) + ' 以上，或把这条线路改为外协采购。', 'danger', '低于成本线')
                    })
                ]),
                ui.card({
                    title: '样票复现', sub: '100kg · 1 件 · 现付：' + esc(q.sampleFrom) + ' → ' + esc(q.sampleTo) + '，费用行由计费引擎实时重建', flat: true,
                    body: ui.split('3', [
                        ui.card({ title: '计费重量', flat: true, body: ui.desc([
                            { label: '实重', value: fmt.kg(q.actualWeight) },
                            { label: '体积重', value: fmt.kg(q.volumetricWeight) },
                            { label: '计费重', value: '<b>' + fmt.kg(q.chargeableWeight) + '</b>' }
                        ]) }),
                        ui.card({ title: '费用行', flat: true, body: ui.table({
                            dense: true, zebra: false, keyName: 'label', rows: q.breakdown,
                            columns: [
                                { key: 'label', label: '项目', className: 'nowrap' },
                                { key: 'value', label: '金额', align: 'right', render: function (r) { return '<span class="tms-money' + (r.value < 0 ? ' tone-success' : '') + '">' + fmt.money(r.value) + '</span>'; } }
                            ]
                        }) }),
                        ui.card({ title: '成本与毛利', flat: true, body: ui.desc([
                            { label: '预计成本', value: fmt.money(q.estCost) },
                            { label: '托底价格', value: fmt.money(q.costFloor) },
                            { label: '应收合计', value: '<b>' + fmt.money(q.total) + '</b>' },
                            { label: '样票毛利', value: fmt.money(util.money(q.total - q.estCost)) },
                            { label: '托底补足', value: q.minTopUp ? fmt.money(q.minTopUp) : '未触发' }
                        ]) })
                    ])
                }),
                ui.card({
                    title: '近期成交', sub: '按该卡出票的最近 ' + deals.length + ' 单', flat: true,
                    body: deals.length ? ui.table({
                        dense: true, keyName: 'id', rows: deals,
                        columns: [
                            { key: 'id', label: '运单', width: '128px', render: function (o) { return idLink(o.id); } },
                            { key: 'customer', label: '客户', render: function (o) { return esc(o.customer || '散客') + ' <span class="tms-dim">' + esc(o.service) + '</span>'; } },
                            { key: 'chargeableWeight', label: '计费重', align: 'right', width: '92px', render: function (o) { return fmt.kg(o.chargeableWeight); } },
                            { key: 'freight', label: '运费', align: 'right', width: '96px', render: function (o) { return ui.moneyCell(o.freight); } },
                            { key: 'contRate', label: '成交续重', align: 'right', width: '96px', render: function (o) { return fmt.money((o.fees || {}).contRate || 0); } },
                            { key: 'status', label: '状态', width: '84px', render: function (o) { return ui.statusBadge(o.status); } }
                        ]
                    }) : ui.empty('这张卡还没有出过票', '新卡需在下单报价时被匹配到才会产生成交')
                })
            ]),
            footer: ui.btn('调价', { tone: 'primary', size: 'sm', act: 'rt:edit', arg: id }) +
                ui.btn(v.status === 'active' ? '停用' : '启用', { size: 'sm', act: 'rt:toggle', arg: id }) +
                ui.btn('按此卡试算', { size: 'sm', act: 'rt:trial', arg: id }) +
                ui.btn('关闭', { size: 'sm', act: 'ui:close' })
        });
    }

    /* 调价：续重价跌破成本线必须写依据，价格政策的口子不能悄悄开 */
    function rtEditModal(id) {
        var c = db.get('rateCards', id);
        if (!c) return;
        var e = cardEcom(c);
        ui.formModal({
            title: '调整运价卡', sub: esc(c.name) + ' · 干线 ' + fmt.km(c.lineKm),
            size: 'wide',
            notice: '外协采购挂牌价 ' + fmt.money(e.buy) + '/kg，最低限价 ' + fmt.money(e.floor) + '/kg。' +
                '改价只影响之后新出的票，历史订单按下单时锁定的卡号与成交单价重算。',
            values: {
                firstFee: Number(c.firstFee) || 0, continueFee: e.cont, minCharge: Number(c.minCharge) || 0,
                fuelPct: util.round((Number(c.fuelRate) || 0) * 100, 1), throwRatio: Number(c.throwRatio) || cfg.billing.defaultThrowRatio,
                remoteFee: Number(c.remoteSurcharge) || 0, validTo: c.validTo, status: c.status, operator: actor()
            },
            fields: [
                { key: 'firstFee', label: '首重价(元)', type: 'number', min: 0, required: true, span: 1 },
                { key: 'continueFee', label: '续重价(元/kg)', type: 'number', min: 0, step: 0.01, required: true, hint: '最低限价 ' + fmt.money(e.floor) },
                { key: 'minCharge', label: '最低收费(元)', type: 'number', min: 0, required: true },
                { key: 'fuelPct', label: '燃油附加(%)', type: 'number', min: 0, step: 0.1, hint: '按小票运费百分比收取' },
                { key: 'throwRatio', label: '体积抛比', type: 'number', min: 1000, step: 500, hint: '6000 即 1m³ 折 167kg' },
                { key: 'remoteFee', label: '偏远附加(元)', type: 'number', min: 0 },
                { key: 'validTo', label: '有效期至', type: 'date', required: true },
                { key: 'status', label: '卡状态', type: 'select', options: [{ value: 'active', label: '生效中' }, { value: 'inactive', label: '停用' }] },
                { key: 'reason', label: '调价依据', type: 'textarea', rows: 2, span: 2, placeholder: '油价联动、大客户协议、线路亏损治理…' }
            ],
            okText: '保存并生效',
            onSubmit: function (data) {
                var cont = util.round(Number(data.continueFee) || 0, 2);
                var reason = String(data.reason || '').trim();
                if (cont < e.floor && reason.length < 4) {
                    return '续重价 ' + fmt.money(cont) + ' 低于最低限价 ' + fmt.money(e.floor) + '，请填写至少 4 个字的调价依据备查';
                }
                var before = '首重 ' + fmt.money(c.firstFee) + ' / 续重 ' + fmt.money(c.continueFee);
                db.update('rateCards', id, {
                    firstFee: util.round(Number(data.firstFee) || 0, 2), continueFee: cont,
                    minCharge: util.round(Number(data.minCharge) || 0, 2),
                    fuelRate: util.round((Number(data.fuelPct) || 0) / 100, 4),
                    throwRatio: Number(data.throwRatio) || cfg.billing.defaultThrowRatio,
                    remoteSurcharge: Number(data.remoteFee) || 0,
                    validTo: data.validTo, status: data.status,
                    version: '调价 ' + util.dateKey(util.now()), adjustNote: reason, adjustedBy: data.operator || actor()
                });
                db.commit('rateCards', id, 'rate:edit');
                TMS.audit.log('rate.update', 'rateCards', id,
                    c.name + '：' + before + ' → 首重 ' + fmt.money(data.firstFee) + ' / 续重 ' + fmt.money(cont) + (reason ? '（' + reason + '）' : ''),
                    data.operator || actor());
                ui.toast('运价卡已更新，新单立即按新价出票', 'success');
            }
        });
    }

    function rtNewModal() {
        var zoneOpts = ui.optionsOf(TMS.master.ZONES);
        ui.formModal({
            title: '新建运价卡', sub: '区域卡兜底、城市专线优先，报价时按「专线 > 区域 > 服务」匹配',
            size: 'wide',
            notice: '续重价建议不低于「外协采购价 × ' + cfg.cost.bulkMinMarkup + '」；系统会按里程自动算出这条线。',
            values: { service: '标准', firstWeight: 5, throwRatio: cfg.billing.defaultThrowRatio, minCharge: cfg.billing.minCharge, fuelPct: 8, days: 365 },
            fields: [
                { key: 'kind', label: '卡类型', type: 'select', required: true, options: [{ value: 'zone', label: '区域对区域' }, { value: 'city', label: '城市专线' }] },
                { key: 'service', label: '服务方式', type: 'select', required: true, options: ui.optionsOf(cfg.serviceLevels) },
                { key: 'originZone', label: '始发区域', type: 'select', options: zoneOpts },
                { key: 'destinationZone', label: '目的区域', type: 'select', options: zoneOpts },
                { key: 'origin', label: '始发城市', type: 'city', placeholder: '城市专线必填' },
                { key: 'destination', label: '目的城市', type: 'city', placeholder: '城市专线必填' },
                { key: 'lineKm', label: '干线里程(km)', type: 'number', min: 1, hint: '留空按区域直线里程推算' },
                { key: 'firstWeight', label: '首重(kg)', type: 'number', min: 1, required: true },
                { key: 'firstFee', label: '首重价(元)', type: 'number', min: 0, required: true },
                { key: 'continueFee', label: '续重价(元/kg)', type: 'number', min: 0, step: 0.01, required: true },
                { key: 'minCharge', label: '最低收费(元)', type: 'number', min: 0 },
                { key: 'throwRatio', label: '体积抛比', type: 'number', min: 1000, step: 500 },
                { key: 'fuelPct', label: '燃油附加(%)', type: 'number', min: 0, step: 0.1 },
                { key: 'remoteFee', label: '偏远附加(元)', type: 'number', min: 0 },
                { key: 'days', label: '有效天数', type: 'number', min: 1, required: true },
                { key: 'reason', label: '立卡说明', type: 'textarea', rows: 2, span: 2, required: true }
            ],
            okText: '建卡',
            onSubmit: function (data) {
                var isCity = data.kind === 'city';
                if (isCity && (!data.origin || !data.destination)) return '城市专线必须填写始发与目的城市';
                if (!isCity && (!data.originZone || !data.destinationZone)) return '区域卡必须选择始发与目的区域';
                var oz = isCity ? TMS.pricing.zoneOf(data.origin) : data.originZone;
                var dz = isCity ? TMS.pricing.zoneOf(data.destination) : data.destinationZone;
                var km = Number(data.lineKm) || TMS.master.zoneRoadKm(oz, dz);
                var floor = util.round(TMS.pricing.ltlRate(km, 1) * (Number(cfg.cost.bulkMinMarkup) || 1.2), 2);
                var cont = util.round(Number(data.continueFee) || 0, 2);
                if (cont < floor && String(data.reason || '').length < 4) return '续重价低于最低限价 ' + fmt.money(floor) + '，请在立卡说明里写清依据';
                var svc = TMS.master.SERVICES.filter(function (s) { return s.name === data.service; })[0] || TMS.master.SERVICES[0];
                var rec = db.create('rateCards', {
                    name: (isCity ? (data.origin + '→' + data.destination) : (oz + '→' + dz)) + ' ' + data.service + '运价',
                    origin: isCity ? data.origin : '全国', destination: isCity ? data.destination : '全国',
                    originZone: oz, destinationZone: dz, service: data.service, lineKm: Math.round(km),
                    firstWeight: Number(data.firstWeight) || 5, firstFee: util.round(Number(data.firstFee) || 0, 2),
                    continueFee: cont, minCharge: util.round(Number(data.minCharge) || cfg.billing.minCharge, 2),
                    throwRatio: Number(data.throwRatio) || svc.throwRatio || cfg.billing.defaultThrowRatio,
                    fuelRate: util.round((Number(data.fuelPct) || 0) / 100, 4),
                    insuredRate: cfg.billing.insuredRate, codRate: cfg.billing.codRate,
                    remoteSurcharge: Number(data.remoteFee) || 0,
                    validFrom: util.dateKey(util.now()), validTo: util.dateKey(util.addDays(util.now(), Number(data.days) || 365)),
                    status: 'active', version: '新卡 ' + util.dateKey(util.now()), adjustNote: data.reason
                });
                db.commit('rateCards', rec.id, 'rate:create');
                TMS.audit.log('rate.update', 'rateCards', rec.id, '新建运价卡 ' + rec.name + '：续重 ' + fmt.money(cont) + '/kg，' + data.reason, actor());
                ui.toast('运价卡已建立：' + rec.id + (cont < floor ? '（低于成本线，报价托底会自动兜住）' : ''), 'success');
            }
        });
    }

    /* 试算：报价器不写库，商务对客报价、投标核价都用它，托底与折扣一次性看全 */
    function rtTrialModal(seed) {
        var s = seed || {};
        ui.formModal({
            title: '运价试算', sub: '只出价不落单：报价与下单共用同一套计费公式',
            size: 'wide',
            values: {
                origin: s.origin || '上海', destination: s.destination || '广州', service: s.service || '标准',
                weight: s.weight || 100, pieces: s.pieces || 1, paymentMethod: '现付', customer: actor()
            },
            fields: [
                { key: 'origin', label: '始发城市', type: 'city', required: true },
                { key: 'destination', label: '目的城市', type: 'city', required: true },
                { key: 'service', label: '服务方式', type: 'select', required: true, options: ui.optionsOf(cfg.serviceLevels) },
                { key: 'customerId', label: '客户', type: 'select', options: [{ value: '', label: '散客（标准价）' }].concat(ui.optionsOf(db.col('customers'), 'id', 'name')), hint: '折扣、KA 返点按档案自动叠加' },
                { key: 'weight', label: '实际重量(kg)', type: 'number', min: 0.1, required: true },
                { key: 'pieces', label: '件数', type: 'number', min: 1, required: true },
                { key: 'dims', label: '外尺寸(长×宽×高 cm)', placeholder: '60x40x30，多件写 60x40x30*2' },
                { key: 'paymentMethod', label: '付款方式', type: 'select', options: ui.optionsOf(cfg.paymentMethods) },
                { key: 'codAmount', label: '代收货款(元)', type: 'number', min: 0 },
                { key: 'declaredValue', label: '声明价值(元)', type: 'number', min: 0 },
                { key: 'isInsured', label: '投保保价', type: 'checkbox' },
                { key: 'goods', label: '货物品名', type: 'select', options: ui.optionsOf(TMS.master.GOODS, 'name', 'name') }
            ],
            okText: '试算',
            onSubmit: function (data) {
                if (!TMS.master.cityByName(data.origin)) return '始发城市不在服务网络内：' + data.origin;
                if (!TMS.master.cityByName(data.destination)) return '目的城市不在服务网络内：' + data.destination;
                var q = TMS.pricing.quote(quoteParams(data));
                if (!q.cardId) return '没有可用运价卡，请先建卡';
                trialShow(q, data);
            }
        });
    }

    function trialShow(q, d) {
        var margin = util.money(q.total - q.estCost);
        ui.modal({
            title: '试算结果', size: 'wide',
            sub: esc(q.cardName) + ' ' + esc(q.cardVersion) + ' · 计费重 ' + fmt.kg(q.chargeableWeight) + ' · ' + esc(q.zone),
            body: ui.stack([
                ui.split('3', [
                    ui.card({ title: '计费口径', flat: true, body: ui.desc([
                        { label: '实重', value: fmt.kg(q.actualWeight) },
                        { label: '体积重', value: fmt.kg(q.volumetricWeight) + '（1/' + q.throwRatio + '）' },
                        { label: '计费重', value: '<b>' + fmt.kg(q.chargeableWeight) + '</b>' },
                        { label: '干线里程', value: fmt.km(q.lineKm) },
                        { label: '最低收费', value: fmt.money(q.minCharge) + (q.minimumApplied ? '（已顶格）' : '') }
                    ]) }),
                    ui.card({ title: '费用行', flat: true, body: ui.table({
                        dense: true, zebra: false, keyName: 'label', rows: q.breakdown,
                        columns: [
                            { key: 'label', label: '项目' },
                            { key: 'value', label: '金额', align: 'right', render: function (r) { return '<span class="tms-money' + (r.value < 0 ? ' tone-success' : '') + '">' + fmt.money(r.value) + '</span>'; } }
                        ]
                    }) }),
                    ui.card({ title: '盈利预测', flat: true, body: ui.desc([
                        { label: '应收', value: '<b>' + fmt.money(q.total) + '</b>' },
                        { label: '预计成本', value: fmt.money(q.estCost) },
                        { label: '预计毛利', value: margin >= 0 ? '<span class="tms-money tone-success">' + fmt.money(margin) + '</span>' : '<span class="tms-money tone-danger">' + fmt.money(margin) + '</span>' },
                        { label: '毛利率', value: rateBar(q.total ? util.round(margin / q.total * 100, 1) : 0, { target: 15 }) },
                        { label: '成本托底', value: fmt.money(q.costFloor) }
                    ]) })
                ]),
                q.minTopUp ? ui.notice('按卡面价与折扣算出的 ' + fmt.money(util.money(q.gross - q.discount)) + ' 低于成本托底线，系统补足 ' + fmt.money(q.minTopUp) + '。这票的真实下限由采购价决定，不是由运价卡决定。', 'warn', '触发商务托底价') : '',
                ui.notice('试算不落库。要用这组参数出单，请到订单管理页新建运单。', 'info')
            ]),
            footer: ui.btn('换个参数再算', { size: 'sm', act: 'rt:quote' }) + ui.btn('关闭', { tone: 'primary', size: 'sm', act: 'ui:close' })
        });
    }

    pg.define('rate', {
        sub: '运价卡台账：区域卡与城市专线、量价阶梯、成本线体检与报价试算',
        load: function (ctx) {
            applyParamFilter(ctx, ['service']);
            var rows = rtRows();
            var bySvc = util.groupBy(rows, 'service');
            var deals = util.sum(rows, 'dealCount');
            return {
                rows: rows, deals: deals,
                zones: TMS.master.ZONES,
                std: rows.filter(function (r) { return r.service === '标准' && r.lineType === '区域卡'; }),
                services: Object.keys(bySvc).map(function (k) {
                    var g = bySvc[k];
                    var rev = util.money(util.sum(g, 'revenue')), cost = util.money(util.sum(g, 'cost'));
                    return {
                        service: k, count: g.length,
                        firstFee: util.round(util.sum(g, 'firstFee') / g.length, 2),
                        cont: util.round(util.sum(g, 'cont') / g.length, 2),
                        buy: util.round(util.sum(g, 'buy') / g.length, 2),
                        minCharge: util.round(util.sum(g, 'minCharge') / g.length, 2),
                        throwRatio: g[0].throwRatio,
                        dealCount: util.sum(g, 'dealCount'),
                        revenue: rev, margin: rev ? util.round((rev - cost) / rev * 100, 1) : null,
                        risk: g.filter(function (r) { return !r.safe; }).length
                    };
                }).sort(function (a, b) { return b.dealCount - a.dealCount; }),
                risky: rows.filter(function (r) { return r.status === 'active' && (!r.safe || r.expired || r.soon); }),
                used: util.sortBy(rows.filter(function (r) { return r.dealCount > 0; }), 'dealCount', 'desc').slice(0, 8),
                dead: rows.filter(function (r) { return r.status === 'active' && r.dealCount === 0; }).length
            };
        },
        render: function (ctx, d) {
            var act = d.rows.filter(function (r) { return r.status === 'active'; });
            var kpi = ui.kpis([
                { label: '运价卡', value: d.rows.length, unit: '张', icon: '≡', tone: 'brand', sub: '生效 ' + act.length + ' 张 / 停用 ' + (d.rows.length - act.length) + ' 张' },
                { label: '低于成本线', value: act.filter(function (r) { return !r.safe; }).length, unit: '张', tone: act.filter(function (r) { return !r.safe; }).length ? 'danger' : 'success', icon: '⚠', sub: '续重价 < 采购价 × ' + cfg.cost.bulkMinMarkup },
                { label: '30 日内到期', value: act.filter(function (r) { return r.soon; }).length, unit: '张', tone: 'warn', icon: '◷', sub: '到期未续按兜底卡报价' },
                { label: '卡面成交', value: d.deals, unit: '单', icon: '✓', tone: 'info', sub: '零成交 ' + d.dead + ' 张，考虑合并' },
                { label: '标准卡均续重', value: act.filter(function (r) { return r.service === '标准'; }).length ? util.round(util.sum(act.filter(function (r) { return r.service === '标准'; }), 'cont') / act.filter(function (r) { return r.service === '标准'; }).length, 2) : 0, unit: '元/kg', icon: '¥', sub: '全区域卡算数均值' },
                { label: '签收收入', value: fmt.money(util.sum(d.rows, 'revenue')), icon: '▤', tone: 'success', sub: '按卡归集的已签收运费' }
            ]);
            var matrix = {};
            d.std.forEach(function (r) { matrix[r.originZone + '>' + r.destinationZone] = r.cont; });
            var heatCard = ui.card({
                title: '区域续重价矩阵', sub: '标准服务区域卡 · 元/kg，颜色越深越贵；对角线同城最便宜，跨省冷链西北最高', flat: true,
                body: ch.heat({
                    cols: d.zones, cell: 42,
                    rows: d.zones.map(function (z) {
                        return { label: z + '发', values: d.zones.map(function (t) { return matrix[z + '>' + t] || 0; }) };
                    })
                })
            });
            var svcCard = ui.card({
                title: '服务维度价目', sub: '同一条线路，标准/加急/冷链的价差就是产品溢价', flat: true,
                body: ui.table({
                    dense: true, keyName: 'service', rows: d.services,
                    columns: [
                        { key: 'service', label: '服务', render: function (r) { return esc(r.service) + ' <span class="tms-dim">抛比 1/' + r.throwRatio + '</span>'; } },
                        { key: 'count', label: '卡数', align: 'right', width: '60px' },
                        { key: 'firstFee', label: '首重均价', align: 'right', width: '88px', render: function (r) { return fmt.money(r.firstFee); } },
                        { key: 'cont', label: '续重均价', align: 'right', width: '96px', render: function (r) { return fmt.money(r.cont) + '/kg'; } },
                        { key: 'buy', label: '采购均价', align: 'right', width: '96px', render: function (r) { return '<span class="tms-dim">' + fmt.money(r.buy) + '/kg</span>'; } },
                        { key: 'dealCount', label: '成交', align: 'right', width: '68px' },
                        { key: 'margin', label: '毛利率', align: 'right', width: '128px', sortable: false, render: function (r) { return r.margin == null ? '<span class="tms-dim">—</span>' : rateBar(r.margin, { target: 18 }); } },
                        { key: 'risk', label: '风险卡', align: 'right', width: '72px', render: function (r) { return r.risk ? ui.badge(r.risk + ' 张', 'danger') : '<span class="tms-dim">无</span>'; } }
                    ]
                })
            });
            var riskCard = ui.card({
                title: '调价清单', sub: '跌破成本线、已过期、30 日内到期的生效卡', tone: d.risky.length ? 'warn' : 'success', flat: true,
                tools: d.risky.length ? ui.btn('批量按成本线补齐', { size: 'sm', act: 'rt:fixall' }) : '',
                body: d.risky.length ? ui.list(d.risky.slice(0, 10).map(function (r) {
                    return {
                        act: 'rt:edit', arg: r.id,
                        title: esc(r.name) + ' ' + (r.safe ? '' : ui.badge('低 ' + fmt.money(-r.gap) + '/kg', 'danger')) + (r.expired ? ' ' + ui.badge('已过期', 'warn') : (r.soon ? ' ' + ui.badge('剩 ' + r.days + ' 天', 'warn') : '')),
                        sub: esc(r.service) + ' · 干线 ' + fmt.km(r.lineKm) + ' · 卡面 ' + fmt.money(r.cont) + ' 采购 ' + fmt.money(r.buy) + ' 限价 ' + fmt.money(r.floor),
                        right: '<span class="tms-dim">' + r.dealCount + ' 单成交</span>'
                    };
                })) + (d.risky.length > 10 ? '<div class="tms-dim" style="padding:6px 2px">另有 ' + (d.risky.length - 10) + ' 张见下方台账</div>' : '')
                    : ui.empty('所有生效卡都在成本线以上', '价格政策健康')
            });
            var dealCard = ui.card({
                title: '主力卡 TOP8', sub: '按成交单量排序，头部卡的价格变动影响面最大', flat: true,
                body: ui.table({
                    dense: true, keyName: 'id', rows: d.used,
                    columns: [
                        { key: 'id', label: '运价卡', render: function (r, i) { return ui.rank(i + 1) + idLink(r.id, 'rt:open') + ' <span class="tms-dim">' + esc(r.service) + '</span>'; } },
                        { key: 'dealCount', label: '成交', align: 'right', width: '68px' },
                        { key: 'revenue', label: '收入', align: 'right', width: '100px', render: function (r) { return ui.moneyCell(r.revenue); } },
                        { key: 'margin', label: '毛利率', align: 'right', width: '120px', sortable: false, render: function (r) { return r.margin == null ? '<span class="tms-dim">—</span>' : rateBar(r.margin, { target: 18 }); } }
                    ]
                })
            });
            return wrap(ctx, {
                actions: ui.btn('报价试算', { size: 'sm', act: 'rt:quote', icon: '∑' }) +
                    ui.btn('新建运价卡', { tone: 'primary', size: 'sm', act: 'rt:new', icon: '＋' }) +
                    ui.btn('导出台账', { size: 'sm', act: 'rt:export', icon: '⤓' }),
                body: [kpi, ui.split('2', [heatCard, svcCard]), ui.split('2', [riskCard, dealCard]), grid(ctx, {
                    rows: d.rows, keyName: 'id', onRow: 'rt:open', searchKey: 'q', pageSize: 20,
                    search: function (r) { return [r.id, r.name, r.service, r.line, r.originZone, r.destinationZone, r.version].join(' '); },
                    chips: [
                        { label: '全部', value: '', count: d.rows.length },
                        { label: '低于成本线', value: 'risk', count: d.rows.filter(function (r) { return r.status === 'active' && !r.safe; }).length },
                        { label: '临期/过期', value: 'due', count: d.rows.filter(function (r) { return r.status === 'active' && (r.soon || r.expired); }).length },
                        { label: '零成交', value: 'dead', count: d.rows.filter(function (r) { return r.status === 'active' && !r.dealCount; }).length },
                        { label: '已停用', value: 'off', count: d.rows.filter(function (r) { return r.status !== 'active'; }).length }
                    ], chipsName: 'flag',
                    fields: [
                        { key: 'q', type: 'search', label: '卡号 / 线路 / 名称' },
                        { key: 'service', label: '服务', options: [{ value: '', label: '全部服务' }].concat(ui.optionsOf(cfg.serviceLevels)) },
                        { key: 'originZone', label: '始发区域', options: [{ value: '', label: '全部区域' }].concat(ui.optionsOf(TMS.master.ZONES)) },
                        { key: 'lineType', label: '卡型', options: [{ value: '', label: '全部' }, { value: '区域卡', label: '区域卡' }, { value: '城市专线', label: '城市专线' }] }
                    ],
                    filter: function (r, fs) {
                        if (fs.service && r.service !== fs.service) return false;
                        if (fs.originZone && r.originZone !== fs.originZone) return false;
                        if (fs.lineType && r.lineType !== fs.lineType) return false;
                        if (fs.flag === 'risk') return r.status === 'active' && !r.safe;
                        if (fs.flag === 'due') return r.status === 'active' && (r.soon || r.expired);
                        if (fs.flag === 'dead') return r.status === 'active' && !r.dealCount;
                        if (fs.flag === 'off') return r.status !== 'active';
                        return true;
                    },
                    valueOf: function (r, k) {
                        if (k === 'gap') return r.gap;
                        if (k === 'days') return r.days;
                        if (k === 'margin') return r.margin == null ? -999 : r.margin;
                        return r[k];
                    },
                    columns: [
                        { key: 'id', label: '卡号', width: '108px', render: function (r) { return idLink(r.id, 'rt:open'); } },
                        { key: 'line', label: '线路 / 服务', render: function (r) { return esc(r.line) + ' <span class="tms-badge tone-info">' + esc(r.service) + '</span> <span class="tms-dim">' + esc(r.lineType) + '</span>'; } },
                        { key: 'firstFee', label: '首重', align: 'right', width: '96px', render: function (r) { return fmt.money(r.firstFee) + '<span class="tms-dim">/' + r.firstWeight + 'kg</span>'; } },
                        { key: 'cont', label: '续重价', align: 'right', width: '96px', render: function (r) { return fmt.money(r.cont) + '/kg'; } },
                        {
                            key: 'gap', label: '成本垫', align: 'right', width: '108px', render: function (r) {
                                return r.gap >= 0 ? '<span class="tms-dim">+' + util.round(r.gap, 2) + '</span>' : ui.badge(util.round(r.gap, 2) + ' 亏', 'danger');
                            }
                        },
                        { key: 'minCharge', label: '最低收', align: 'right', width: '84px', render: function (r) { return fmt.money(r.minCharge); } },
                        { key: 'throwRatio', label: '抛比', align: 'right', width: '76px', render: function (r) { return '1:' + r.throwRatio; } },
                        { key: 'fuelRate', label: '燃油', align: 'right', width: '68px', render: function (r) { return fmt.percent(r.fuelRate); } },
                        { key: 'dealCount', label: '成交', align: 'right', width: '68px', render: function (r) { return r.dealCount ? r.dealCount + ' 单' : '<span class="tms-dim">0</span>'; } },
                        { key: 'margin', label: '毛利率', align: 'right', width: '76px', render: function (r) { return r.margin == null ? '<span class="tms-dim">—</span>' : fmt.percent(r.margin); }, value: null },
                        { key: 'validTo', label: '有效期', width: '128px', render: function (r) { return esc(r.validFrom) + '<br><span class="tms-dim">' + esc(r.validTo) + (r.expired ? ' 已过期' : (r.soon ? ' 剩 ' + r.days + ' 天' : '')) + '</span>'; } },
                        { key: 'status', label: '状态', width: '76px', render: function (r) { return statusBadge(r.status, RT_TEXT); } },
                        { key: 'ops', label: '操作', width: '116px', sortable: false, render: function (r) {
                            return ui.link('调价', 'rt:edit', r.id, { tone: 'ghost' }) + ' ' + ui.link(r.status === 'active' ? '停用' : '启用', 'rt:toggle', r.id, { tone: 'ghost' });
                        } }
                    ],
                    emptyText: '没有符合条件的运价卡', emptySub: '清一下筛选，或新建一张卡'
                })]
            });
        },
        actions: merge(pg.shared, {
            'rt:open': function (id) { rtModal(id); },
            'rt:edit': function (id) { rtEditModal(id); },
            'rt:new': function () { rtNewModal(); },
            'rt:quote': function () { rtTrialModal(); },
            'rt:trial': function (id) {
                var c = db.get('rateCards', id);
                if (!c) return;
                ui.closeTop();
                rtTrialModal({
                    origin: c.origin === '全国' ? zoneCity(c.originZone) : c.origin,
                    destination: c.destination === '全国' ? zoneCity(c.destinationZone) : c.destination,
                    service: c.service, weight: 100
                });
            },
            'rt:toggle': function (id) {
                var c = db.get('rateCards', id);
                if (!c) return;
                var next = c.status === 'active' ? 'inactive' : 'active';
                var use = cardView(c).dealCount;
                ui.confirm({
                    title: next === 'active' ? '启用运价卡' : '停用运价卡',
                    message: esc(c.name) + ' 将改为「' + (RT_TEXT[next] || next) + '」。',
                    detail: next === 'inactive'
                        ? '停用后该线路按同服务兜底卡报价，历史 ' + use + ' 单成交仍按原卡号重建费用。'
                        : '启用后新单立即匹配这张卡。'
                }).then(function (yes) {
                    if (!yes) return;
                    db.update('rateCards', id, { status: next, adjustedBy: actor(), adjustNote: next === 'inactive' ? '运营停用' : '运营启用' });
                    db.commit('rateCards', id, 'rate:toggle');
                    TMS.audit.log('rate.update', 'rateCards', id, c.name + ' 状态改为 ' + (RT_TEXT[next] || next), actor());
                    ui.toast('已' + (next === 'active' ? '启用' : '停用') + '：' + c.name, 'success');
                });
            },
            'rt:fixall': function () {
                var rows = rtRows().filter(function (r) { return r.status === 'active' && !r.safe; });
                if (!rows.length) { ui.toast('没有低于成本线的生效卡', 'info'); return; }
                ui.confirm({
                    title: '按成本线批量补价', danger: true,
                    message: '共 ' + rows.length + ' 张卡的续重价低于最低限价，将统一抬到限价并保留 2% 议价空间。',
                    detail: rows.slice(0, 5).map(function (r) { return esc(r.name) + '：' + fmt.money(r.cont) + ' → ' + fmt.money(util.round(r.floor * 1.02, 2)); }).join('<br>') + (rows.length > 5 ? '<br>…' : ''),
                    okText: '全部抬到限价'
                }).then(function (yes) {
                    if (!yes) return;
                    var n = 0;
                    db.batch(function () {
                        rows.forEach(function (r) {
                            var target = util.round(r.floor * 1.02, 2);
                            db.update('rateCards', r.id, {
                                continueFee: target, version: '成本线修正 ' + util.dateKey(util.now()),
                                adjustNote: '系统按采购价 × ' + cfg.cost.bulkMinMarkup + ' × 1.02 修正', adjustedBy: actor()
                            });
                            n++;
                        });
                    }, 'rate:fixall');
                    TMS.audit.log('rate.update', 'rateCards', '', '批量修正 ' + n + ' 张低于成本线的运价卡', actor());
                    ui.toast('已修正 ' + n + ' 张运价卡', 'success');
                });
            },
            'rt:export': function () {
                exportGrid({
                    name: '运价卡台账.csv', rows: rtRows(),
                    cols: [
                        { label: '卡号', key: 'id' }, { label: '名称', key: 'name' }, { label: '卡型', key: 'lineType' },
                        { label: '线路', key: 'line' }, { label: '服务', key: 'service' }, { label: '干线里程km', key: 'lineKm' },
                        { label: '首重kg', key: 'firstWeight' }, { label: '首重价', key: 'firstFee' }, { label: '续重价', key: 'cont' },
                        { label: '最低收费', key: 'minCharge' }, { label: '抛比', key: 'throwRatio' }, { label: '燃油%', key: 'fuelRate' },
                        { label: '采购价', key: 'buy' }, { label: '最低限价', key: 'floor' }, { label: '安全垫', key: 'gap' },
                        { label: '成交单量', key: 'dealCount' }, { label: '签收收入', key: 'revenue' }, { label: '毛利率', key: 'margin' },
                        { label: '生效日', key: 'validFrom' }, { label: '到期日', key: 'validTo' },
                        { label: '状态', value: function (r) { return RT_TEXT[r.status] || r.status; } }, { label: '版本', key: 'version' }
                    ]
                });
            }
        }, custActions, excActions)
    });

    /* ---------- 十七、代收货款 ---------- */

    var COD_TEXT = { pending: '待上划', remitted: '已上划' };
    /* 代收货款 T+3 上划是行业通行的资金承诺，超过就是占用客户货款 */
    var COD_DUE_DAYS = 3;

    function codView(r) {
        var o = r.orderId ? db.get('orders', r.orderId) : null;
        var collected = util.toDate(r.collectedAt || r.createdAt);
        var dueAt = util.addDays(collected, COD_DUE_DAYS);
        var dueHours = util.hoursBetween(r.remitStatus === 'remitted' ? util.toDate(r.remittedAt) : util.now(), dueAt);
        var feeRate = Number(r.goodsValue) > 0 ? util.round((Number(r.serviceFee) || 0) / r.goodsValue * 100, 2) : 0;
        return {
            id: r.id, orderId: r.orderId, waybillNo: r.waybillNo || (o ? o.waybillNo : ''),
            shipper: r.shipper || TMS.order.customerName(o) || '散客', shipperId: r.shipperId || '',
            consignee: r.consignee || '', courier: r.courier || '',
            goodsValue: Number(r.goodsValue) || 0, serviceFee: Number(r.serviceFee) || 0,
            netPayable: Number(r.netPayable) || 0, feeRate: feeRate,
            collectedAt: r.collectedAt || '', remittedAt: r.remittedAt || '',
            remitStatus: r.remitStatus || 'pending', operator: r.operator || '', remark: r.remark || '',
            dueAt: util.dateKey(dueAt), dueHours: dueHours,
            overdue: r.remitStatus !== 'remitted' && dueHours < 0,
            ageDays: util.round(Math.max(0, util.hoursBetween(collected, util.now())) / 24, 1),
            remitted: r.remitStatus === 'remitted'
        };
    }

    function codRows(days) {
        var rows = db.col('codRecords').map(codView);
        if (days && Number(days) > 0) {
            rows = rows.filter(function (r) { return util.hoursBetween(r.collectedAt, util.now()) <= Number(days) * 24; });
        }
        return util.sortBy(rows, 'collectedAt', 'desc');
    }

    /* COD 台账最容易漏的是「签收时没落代收记录」：派送员收了钱、系统没账，上划就少一笔 */
    function codGaps() {
        var have = {};
        db.col('codRecords').forEach(function (r) { have[r.orderId] = true; });
        var missing = db.col('orders').filter(function (o) {
            return Number(o.codAmount) > 0 && !have[o.id] && ['signed', 'delivering', 'arrived'].indexOf(o.status) > -1;
        });
        var stranded = db.col('codRecords').filter(function (r) {
            return r.remitStatus === 'remitted' && !db.findOne('finances', function (f) { return f.refId === r.id; });
        });
        var overNet = db.col('codRecords').filter(function (r) {
            return util.money((Number(r.goodsValue) || 0) - (Number(r.serviceFee) || 0)) !== (Number(r.netPayable) || 0);
        });
        return { missing: missing, stranded: stranded, overNet: overNet };
    }

    function codModal(id) {
        var r = db.get('codRecords', id);
        if (!r) return;
        var v = codView(r);
        var o = v.orderId ? db.get('orders', v.orderId) : null;
        var flows = db.col('finances').filter(function (f) { return f.refId === id || (v.orderId && f.orderId === v.orderId && f.type === 'expense' && f.category === '代收货款上划'); });
        ui.modal({
            title: '代收货款 ' + esc(v.id), size: 'wide',
            sub: esc(v.waybillNo) + ' · 货主 ' + esc(v.shipper) + ' · ' + statusBadge(v.remitStatus, COD_TEXT) + (v.overdue ? ' ' + ui.badge('已超 T+' + COD_DUE_DAYS, 'danger') : ''),
            body: ui.stack([
                ui.split('2', [
                    ui.card({ title: '货款与服务费', flat: true, body: ui.desc([
                        { label: '代收货款', value: '<b class="tms-money strong">' + fmt.money(v.goodsValue) + '</b>' },
                        { label: '服务费', value: fmt.money(v.serviceFee) + '（' + fmt.percent(v.feeRate) + '）' },
                        { label: '应上划净额', value: fmt.money(v.netPayable) },
                        { label: '收款时间', value: esc(fmt.dateTime(v.collectedAt)) },
                        { label: '承诺上划', value: 'T+' + COD_DUE_DAYS + ' · ' + esc(v.dueAt) },
                        { label: '派送员', value: dim(v.courier) },
                        { label: '收件人', value: dim(v.consignee) },
                        { label: '上划时间', value: v.remittedAt ? esc(fmt.dateTime(v.remittedAt)) : '<span class="tms-badge tone-warn">待上划</span>' },
                        { label: '经办', value: dim(v.operator) }
                    ]) }),
                    ui.card({ title: '关联单据', sub: '代收货款是负债，不是收入；服务费才是', flat: true, body: ui.desc([
                        { label: '运单', value: v.orderId ? idLink(v.orderId) : '<span class="tms-dim">无单</span>' },
                        { label: '付款方式', value: o ? esc(o.paymentMethod || '到付') : '<span class="tms-dim">—</span>' },
                        { label: '运单状态', value: o ? ui.statusBadge(TMS.order.view(o).status) : '<span class="tms-dim">—</span>' },
                        { label: '运单应收', value: o ? fmt.money(o.freight) : '—' },
                        { label: '财务流水', value: flows.length ? flows.length + ' 笔' : '<span class="tms-badge tone-warn">未入账</span>' },
                        { label: '货主档案', value: v.shipperId ? esc((db.get('customers', v.shipperId) || {}).name || v.shipperId) : '<span class="tms-dim">散客</span>' }
                    ]), foot: flows.length ? ui.table({
                        dense: true, zebra: false, keyName: 'id', rows: flows,
                        columns: [
                            { key: 'category', label: '科目' },
                            { key: 'type', label: '方向', width: '68px', render: function (f) { return ui.badge(f.type === 'income' ? '收入' : '支出', f.type === 'income' ? 'success' : 'muted'); } },
                            { key: 'amount', label: '金额', align: 'right', width: '100px', render: function (f) { return fmt.money(f.signed ? -Number(f.amount) : f.amount); } },
                            { key: 'date', label: '时间', width: '120px', render: function (f) { return esc(fmt.dateTime(f.date)); } }
                        ]
                    }) : '' }),
                ]),
                v.overdue ? ui.notice('这笔货款已超 T+' + COD_DUE_DAYS + ' 承诺，占用了货主资金 ' + fmt.money(v.netPayable) + '。行业里代收款逾期是客诉与合同违约的高发点，建议立即上划。', 'danger', '上划逾期') : ''
            ]),
            footer: v.remitted ? ui.btn('关闭', { size: 'sm', act: 'ui:close' })
                : ui.btn('立即上划', { tone: 'primary', size: 'sm', act: 'cod:remit', arg: id }) + ui.btn('关闭', { size: 'sm', act: 'ui:close' })
        });
    }

    function codRemitModal(id) {
        var r = db.get('codRecords', id);
        if (!r) return;
        var v = codView(r);
        ui.formModal({
            title: '代收款上划', sub: esc(v.waybillNo) + ' · 上划给 ' + esc(v.shipper), danger: v.overdue,
            notice: '净额 ' + fmt.money(v.netPayable) + ' 计入「往来」不占损益；服务费 ' + fmt.money(v.serviceFee) + ' 计入代收收入。',
            values: { operator: actor(), voucher: 'TR' + TMS.ids.dayStamp() + util.randomDigits(4), account: (v.shipper || '') + ' 对公账户' },
            fields: [
                { key: 'voucher', label: '转账凭证号', required: true, span: 2 },
                { key: 'account', label: '收款账户', required: true, span: 2 },
                { key: 'amount', label: '上划净额', type: 'static', value: fmt.money(v.netPayable) },
                { key: 'fee', label: '本次扣服务费', type: 'static', value: fmt.money(v.serviceFee) },
                { key: 'operator', label: '经办人', required: true },
                { key: 'remark', label: '备注', type: 'textarea', rows: 2, span: 2 }
            ],
            okText: '确认上划',
            onSubmit: function (data) {
                var res = TMS.finance.remitCOD(id, data.operator || actor());
                if (!res) return '上划失败，记录不存在';
                db.update('codRecords', id, { voucher: data.voucher, account: data.account, remark: data.remark || res.remark || '' });
                db.commit('codRecords', id, 'cod:voucher');
                TMS.audit.log('cod.remit', 'codRecords', id, v.shipper + ' 上划 ' + fmt.money(v.netPayable) + ' 凭证 ' + data.voucher, data.operator || actor());
                ui.toast('已上划 ' + fmt.money(v.netPayable) + '，服务费 ' + fmt.money(v.serviceFee) + ' 入账', 'success');
            }
        });
    }

    /* 按货主批量上划：真实财务不会一笔一笔转账，都是按客户一天一批 */
    function codBatchModal(shipperId) {
        var rows = db.col('codRecords').filter(function (r) {
            return r.remitStatus !== 'remitted' && (!shipperId || r.shipperId === shipperId);
        }).map(codView);
        if (!rows.length) { ui.toast('当前没有待上划的代收款', 'info'); return; }
        var total = util.money(util.sum(rows, 'netPayable'));
        var fee = util.money(util.sum(rows, 'serviceFee'));
        var key = 'cod:batch:' + (shipperId || 'all');
        ui.modal({
            title: '代收款批量上划', size: 'wide', dismiss: false,
            sub: (shipperId ? esc((db.get('customers', shipperId) || {}).name || shipperId) : '全部待上划货主') +
                ' · ' + rows.length + ' 笔 · 净额 ' + fmt.money(total) + ' · 服务费 ' + fmt.money(fee),
            body: ui.stack([
                ui.table({
                    dense: true, keyName: 'id', rows: rows.slice(0, 30),
                    columns: [
                        { key: 'id', label: '代收单', width: '128px', render: function (r) { return idLink(r.id, 'cod:open'); } },
                        { key: 'waybillNo', label: '运单', render: function (r) { return idLink(r.orderId); } },
                        { key: 'shipper', label: '货主', width: '140px' },
                        { key: 'goodsValue', label: '货款', align: 'right', width: '104px', render: function (r) { return fmt.money(r.goodsValue); } },
                        { key: 'serviceFee', label: '服务费', align: 'right', width: '96px', render: function (r) { return '<span class="tms-dim">' + fmt.money(r.serviceFee) + '</span>'; } },
                        { key: 'netPayable', label: '净额', align: 'right', width: '104px', render: function (r) { return ui.moneyCell(r.netPayable); } },
                        { key: 'dueAt', label: '承诺日', width: '96px', render: function (r) { return r.overdue ? ui.badge('逾期 ' + esc(fmt.date(r.dueAt)), 'danger') : esc(r.dueAt); } }
                    ]
                }),
                rows.length > 30 ? '<div class="tms-dim" style="font-size:12px">仅列前 30 笔，确认将对全部 ' + rows.length + ' 笔执行上划</div>' : '',
                ui.notice('批量上划按每笔的承诺服务费逐笔入账，凭证号统一为本次批次号，便于财务按批对账。', 'info')
            ]),
            footer: ui.btn('确认上划 ' + rows.length + ' 笔（' + fmt.money(total) + '）', { tone: 'primary', size: 'sm', act: 'cod:batchRun', arg: shipperId || 'all' }) +
                ui.btn('取消', { size: 'sm', act: 'ui:close' })
        });
    }

    pg.define('cod', {
        sub: '代收货款台账：签收时代收、T+3 上划货主、服务费计收入，资金过账不占损益',
        load: function (ctx) {
            applyParamFilter(ctx, ['shipperId']);
            var rows = codRows(ctx.days);
            var all = codRows(0);
            var cs = TMS.finance.codSummary();
            var gaps = codGaps();
            var byShipper = util.groupBy(all.filter(function (r) { return !r.remitted; }), 'shipperId');
            var days = {};
            all.filter(function (r) { return r.remitted; }).forEach(function (r) {
                var k = util.dateKey(util.toDate(r.remittedAt));
                var g = days[k] || (days[k] = { net: 0, fee: 0 });
                g.net += r.netPayable; g.fee += r.serviceFee;
            });
            var trend = [];
            for (var i = Math.max(6, Number(ctx.days) || 7) - 1; i >= 0; i--) {
                var key = util.dateKey(util.addDays(util.now(), -i));
                var g = days[key] || { net: 0, fee: 0 };
                trend.push({ label: util.fmt.monthDay(key), value: g.fee });
            }
            return {
                rows: rows, all: all, cs: cs, gaps: gaps, trend: trend,
                shippers: Object.keys(byShipper).map(function (k) {
                    var g = byShipper[k];
                    return {
                        shipperId: k, name: g[0].shipper, count: g.length,
                        net: util.money(util.sum(g, 'netPayable')), fee: util.money(util.sum(g, 'serviceFee')),
                        overdue: g.filter(function (r) { return r.overdue; }).length,
                        oldest: util.round(Math.max.apply(null, g.map(function (r) { return -r.dueHours; })) / 24, 1)
                    };
                }).sort(function (a, b) { return b.net - a.net; }),
                overdue: all.filter(function (r) { return r.overdue; }),
                today: rows.filter(function (r) { return util.dateKey(util.toDate(r.collectedAt)) === util.dateKey(util.now()); }),
                feeRate: cs.goodsTotal ? util.round(cs.serviceIncome / cs.remitedTotal * 100, 2) : 0
            };
        },
        render: function (ctx, d) {
            var cs = d.cs;
            var kpi = ui.kpis([
                { label: '代收总额', value: fmt.money(cs.goodsTotal), unit: cs.count + ' 笔', icon: '↧', tone: 'brand', sub: '签收时向收件人收取的货款' },
                { label: '待上划', value: fmt.money(cs.pendingRemit), unit: cs.pendingCount + ' 笔', tone: cs.pendingCount ? 'warn' : 'success', icon: '○', sub: '挂在账上的代收负债' },
                { label: '逾期 T+' + COD_DUE_DAYS, value: d.overdue.length, unit: '笔', tone: d.overdue.length ? 'danger' : 'success', icon: '⚠', sub: fmt.money(util.sum(d.overdue, 'netPayable')) + ' 已占款' },
                { label: '已上划', value: fmt.money(cs.remittedTotal), tone: 'success', icon: '✓', sub: '上划后释放负债' },
                { label: '服务费收入', value: fmt.money(cs.serviceIncome), icon: '¥', tone: 'info', sub: '实际费率 ' + fmt.percent(d.feeRate) },
                { label: '漏建记录', value: d.gaps.missing.length, unit: '单', tone: d.gaps.missing.length ? 'danger' : 'success', icon: '⛑', sub: '签收有代收货款但无台账' }
            ]);
            var shipperCard = ui.card({
                title: '货主待上划排行', sub: '一天一批，逾期最久的先处理', flat: true,
                body: d.shippers.length ? ui.table({
                    dense: true, keyName: 'shipperId', rows: d.shippers.slice(0, 8),
                    columns: [
                        { key: 'name', label: '货主', render: function (r, i) { return ui.rank(i + 1) + esc(r.name) + (r.overdue ? ' ' + ui.badge('逾期 ' + r.overdue, 'danger') : ''); } },
                        { key: 'count', label: '笔数', align: 'right', width: '64px' },
                        { key: 'net', label: '待上划净额', align: 'right', width: '120px', render: function (r) { return ui.moneyCell(r.net); } },
                        { key: 'oldest', label: '最久占款', align: 'right', width: '96px', render: function (r) { return r.oldest > COD_DUE_DAYS ? ui.badge(util.round(r.oldest, 0) + ' 天', 'danger') : '<span class="tms-dim">' + util.round(r.oldest, 0) + ' 天</span>'; } },
                        { key: 'ops', label: '操作', align: 'right', width: '72px', sortable: false, render: function (r) { return ui.link('整批', 'cod:batch', r.shipperId, { tone: 'ghost' }); } }
                    ]
                }) : ui.empty('没有待上划的货款', '代收款已全部结清')
            });
            var gapCard = ui.card({
                title: '资金完整性', sub: '代收台账、财务流水与运单三方对账', tone: (d.gaps.missing.length + d.gaps.stranded.length + d.gaps.overNet.length) ? 'danger' : 'success', flat: true,
                tools: (d.gaps.missing.length || d.gaps.overNet.length) ? ui.btn('一键补齐台账', { size: 'sm', act: 'cod:sync', icon: '⟳' }) : '',
                body: ui.list([
                    {
                        title: '签收有代收货款、台账无记录', act: d.gaps.missing.length ? 'cod:sync' : '',
                        sub: d.gaps.missing.length ? '漏建 ' + d.gaps.missing.length + ' 单，合计代收 ' + fmt.money(util.sum(d.gaps.missing, 'codAmount')) + '，派送员收的现款无人对上划' : '逐单核对无缺口',
                        right: d.gaps.missing.length ? ui.badge(d.gaps.missing.length + ' 单', 'danger') : ui.badge('一致', 'success')
                    },
                    {
                        title: '上划后财务流水缺失', act: d.gaps.stranded.length ? 'fin:open' : '',
                        sub: d.gaps.stranded.length ? d.gaps.stranded.length + ' 笔上划记录查不到资金流水，需补记「往来」' : '上划逐笔入流水',
                        right: d.gaps.stranded.length ? ui.badge(d.gaps.stranded.length + ' 笔', 'danger') : ui.badge('一致', 'success')
                    },
                    {
                        title: '净额 ≠ 货款 − 服务费', act: d.gaps.overNet.length ? 'cod:sync' : '',
                        sub: d.gaps.overNet.length ? d.gaps.overNet.length + ' 笔算不平，通常是复磅后运费与服务费联动重算未回写' : '全部按公式校验通过',
                        right: d.gaps.overNet.length ? ui.badge(d.gaps.overNet.length + ' 笔', 'warn') : ui.badge('一致', 'success')
                    }
                ])
            });
            var trendCard = ui.card({
                title: '代收服务费走势', sub: '服务费是按货款比例收的纯毛利，代收款体量决定这块收益', flat: true,
                body: ch.line({ data: d.trend, height: 230, area: true, name: '代收服务费', fmt: function (v) { return fmt.money(v); } })
            });
            return wrap(ctx, {
                actions: ui.btn('批量上划', { tone: 'primary', size: 'sm', act: 'cod:batch', arg: '', icon: '⇪' }) +
                    ui.btn('导出台账', { size: 'sm', act: 'cod:export', icon: '⤓' }),
                body: [kpi, ui.split('2', [shipperCard, gapCard]), trendCard, grid(ctx, {
                    rows: d.rows, keyName: 'id', onRow: 'cod:open', searchKey: 'q', pageSize: 20,
                    search: function (r) { return [r.id, r.orderId, r.waybillNo, r.shipper, r.consignee, r.courier].join(' '); },
                    chips: [
                        { label: '全部', value: '', count: d.rows.length },
                        { label: '待上划', value: 'pending', count: d.rows.filter(function (r) { return !r.remitted; }).length },
                        { label: '逾期', value: 'overdue', count: d.rows.filter(function (r) { return r.overdue; }).length },
                        { label: '已上划', value: 'remitted', count: d.rows.filter(function (r) { return r.remitted; }).length }
                    ], chipsName: 'flag',
                    fields: [
                        { key: 'q', type: 'search', label: '代收单 / 运单 / 货主 / 派送员' },
                        { key: 'shipperId', label: '货主', options: [{ value: '', label: '全部货主' }].concat(ui.optionsOf(d.all.map(function (r) { return { id: r.shipperId, name: r.shipper }; }).filter(function (x) { return x.id; }), 'id', 'name')) },
                        { key: 'min', label: '货款下限', type: 'search', options: [{ value: '', label: '不限' }, { value: '1000', label: '≥ 1000' }, { value: '3000', label: '≥ 3000' }, { value: '5000', label: '≥ 5000' }] }
                    ],
                    filter: function (r, fs) {
                        if (fs.shipperId && r.shipperId !== fs.shipperId) return false;
                        if (fs.min && !(r.goodsValue >= Number(fs.min))) return false;
                        if (fs.flag === 'pending') return !r.remitted;
                        if (fs.flag === 'remitted') return r.remitted;
                        if (fs.flag === 'overdue') return r.overdue;
                        return true;
                    },
                    valueOf: function (r, k) {
                        if (k === 'age') return r.ageDays;
                        if (k === 'due') return -r.dueHours;
                        return r[k];
                    },
                    columns: [
                        { key: 'id', label: '代收单', width: '128px', render: function (r) { return idLink(r.id, 'cod:open'); } },
                        { key: 'waybillNo', label: '运单 / 货主', render: function (r) { return idLink(r.orderId) + '<br><span class="tms-dim">' + esc(r.shipper) + '</span>'; } },
                        { key: 'consignee', label: '收件人', render: function (r) { return esc(r.consignee || '—') + ' <span class="tms-dim">' + esc(r.courier || '') + '</span>'; } },
                        { key: 'goodsValue', label: '代收货款', align: 'right', width: '112px', render: function (r) { return ui.moneyCell(r.goodsValue, { strong: !r.remitted }); } },
                        { key: 'serviceFee', label: '服务费', align: 'right', width: '96px', render: function (r) { return fmt.money(r.serviceFee) + '<br><span class="tms-dim">' + fmt.percent(r.feeRate) + '</span>'; } },
                        { key: 'netPayable', label: '应上划净额', align: 'right', width: '116px', render: function (r) { return '<b class="tms-money">' + fmt.money(r.netPayable) + '</b>'; } },
                        { key: 'collectedAt', label: '收款时间', width: '128px', render: function (r) { return ui.timeCell(r.collectedAt); } },
                        { key: 'age', label: '账龄', align: 'right', width: '80px', render: function (r) { return r.remitted ? '<span class="tms-dim">' + util.round(r.ageDays, 0) + ' 天</span>' : (r.ageDays > COD_DUE_DAYS ? ui.badge(util.round(r.ageDays, 0) + ' 天', 'danger') : util.round(r.ageDays, 0) + ' 天'); } },
                        { key: 'remitStatus', label: '状态', width: '84px', render: function (r) { return statusBadge(r.remitStatus, COD_TEXT); } },
                        { key: 'ops', label: '操作', width: '104px', sortable: false, render: function (r) {
                            return r.remitted ? ui.link('凭证', 'cod:open', r.id, { tone: 'ghost' })
                                : ui.link('上划', 'cod:remit', r.id, { tone: 'ghost' });
                        } }
                    ],
                    emptyText: '时间窗内没有代收货款', emptySub: '顶栏切长时间窗，或到订单管理筛「到付」'
                })]
            });
        },
        actions: merge(pg.shared, custActions, excActions, {
            'cod:open': function (id) { codModal(id); },
            'cod:remit': function (id) { codRemitModal(id); },
            'cod:batch': function (shipperId) { codBatchModal(shipperId || ''); },
            'cod:batchRun': function (scope) {
                var rows = db.col('codRecords').filter(function (r) {
                    return r.remitStatus !== 'remitted' && (scope === 'all' || !scope || r.shipperId === scope);
                });
                if (!rows.length) { ui.toast('没有待上划的记录', 'warn'); return; }
                var voucher = 'BATCH' + TMS.ids.dayStamp() + util.randomDigits(3);
                var total = 0;
                db.batch(function () {
                    rows.forEach(function (r) {
                        var res = TMS.finance.remitCOD(r.id, actor());
                        if (res) {
                            db.update('codRecords', r.id, { voucher: voucher, batch: true });
                            db.touch('codRecords');
                            total += Number(r.netPayable) || 0;
                        }
                    });
                }, 'cod:batch');
                TMS.audit.log('cod.remit', 'codRecords', '', '批量上划 ' + rows.length + ' 笔，凭证 ' + voucher + '，净额 ' + fmt.money(util.money(total)), actor());
                ui.toast('已上划 ' + rows.length + ' 笔 · ' + fmt.money(util.money(total)) + '（批次 ' + voucher + '）', 'success');
                ui.closeTop();
            },
            'cod:sync': function () {
                var g = codGaps();
                var n = 0, fixed = 0;
                db.batch(function () {
                    g.missing.forEach(function (o) {
                        var rec = TMS.finance.createCODRecord(o, o.signedAt || util.iso(util.now()));
                        if (rec && rec.id) n++;
                    });
                    g.overNet.forEach(function (r) {
                        var fee = util.money(Math.max(cfg.billing.codMinService, (Number(r.goodsValue) || 0) * cfg.billing.codServiceRate));
                        db.update('codRecords', r.id, { serviceFee: fee, netPayable: util.money((Number(r.goodsValue) || 0) - fee) });
                        db.touch('codRecords');
                        fixed++;
                    });
                }, 'cod:sync');
                TMS.audit.log('cod.remit', 'codRecords', '', '代收款台账体检：补建 ' + n + ' 笔、修正 ' + fixed + ' 笔', actor());
                ui.toast('补建代收台账 ' + n + ' 笔，修正净额口径 ' + fixed + ' 笔', n + fixed ? 'success' : 'info');
            },
            'cod:export': function () {
                exportGrid({
                    name: '代收货款台账.csv', rows: codRows(0),
                    cols: [
                        { label: '代收单', key: 'id' }, { label: '订单号', key: 'orderId' }, { label: '运单号', key: 'waybillNo' },
                        { label: '货主', key: 'shipper' }, { label: '收件人', key: 'consignee' }, { label: '派送员', key: 'courier' },
                        { label: '代收货款', key: 'goodsValue' }, { label: '服务费', key: 'serviceFee' }, { label: '净额', key: 'netPayable' },
                        { label: '收款时间', key: 'collectedAt' }, { label: '承诺上划', key: 'dueAt' }, { label: '账龄天', key: 'ageDays' },
                        { label: '状态', value: function (r) { return COD_TEXT[r.remitStatus] || r.remitStatus; } },
                        { label: '上划时间', key: 'remittedAt' }, { label: '经办', key: 'operator' }, { label: '凭证', key: 'voucher' }
                    ]
                });
            },
            'fin:open': function () { TMS.shell.go('finance'); }
        }),
        drawerFooter: function (orderId) {
            var rec = db.col('codRecords').filter(function (r) { return r.orderId === orderId; })[0];
            if (rec) return ui.btn('代收款 ' + fmt.money(Number(rec.netPayable) || 0) + ' · ' + (COD_TEXT[rec.remitStatus] || rec.remitStatus), { size: 'sm', tone: rec.remitStatus === 'remitted' ? '' : 'warn', act: 'cod:open', arg: rec.id });
            var o = db.get('orders', orderId);
            if (o && Number(o.codAmount) > 0) return ui.btn('补建代收台账', { size: 'sm', tone: 'warn', act: 'cod:sync' });
            return '';
        }
    });

    /* ---------- 十八、财务流水 ---------- */

    var FIN_STATUS = { settled: '已入账', pending: '挂账待收', void: '已作废' };
    var FIN_CATEGORIES = ['运费收入', '运费复核补收', '运费复核退费', '代收款服务费', '理赔追偿',
        '干线运输', '司机趟费', '操作费', '派送费', '异常扣款', '代收货款上划', '理赔支出', '包装物料',
        '场地租金', '装卸人工', '车辆折旧', '系统运维', '客服人工', '其他支出'];

    function finView(f) {
        var o = f.orderId ? db.get('orders', f.orderId) : null;
        var amount = Number(f.amount) || 0;
        /* 红冲不改科目，只把方向翻过来：一笔负向的收入就是退费 */
        var sign = (f.type === 'income' ? 1 : -1) * (f.signed ? -1 : 1);
        return {
            id: f.id, type: f.type, category: f.category, amount: amount,
            value: util.money(sign * amount), status: f.status || 'settled',
            date: f.date || f.createdAt || '', day: util.dateKey(util.toDate(f.date || f.createdAt)),
            orderId: f.orderId || '', refId: f.refId || '', waybillNo: o ? o.waybillNo : '',
            customer: o ? TMS.order.customerName(o) : (f.customer || ''),
            remark: f.remark || '', nature: f.nature || '', reverse: !!f.signed,
            ledger: f.nature !== '往来', income: f.type === 'income',
            cash: util.money((f.status || 'settled') === 'settled' ? sign * amount : 0)
        };
    }

    /* 科目汇总：环形图只看规模，方向由「收入/支出」两个池子自己决定，
       所以这里取绝对值合计，避免支出池算出一个负中心值 */
    function topCats(rows) {
        var g = util.groupBy(rows, 'category');
        return Object.keys(g)
            .map(function (k) { return { label: k, value: util.money(util.sum(g[k], 'amount')), count: g[k].length }; })
            .sort(function (a, b) { return b.value - a.value; });
    }

    function finRows(days) {
        var rows = db.col('finances').map(finView);
        if (days && Number(days) > 0) {
            rows = rows.filter(function (r) { return util.hoursBetween(r.date, util.now()) <= Number(days) * 24; });
        }
        return util.sortBy(rows, 'date', 'desc');
    }

    /* 账务完整性三方核对：单据、应收应付、流水必须一一对应，
       任何一处「状态改了但钱没动」都会在月结时变成解释不清的差异 */
    function finGaps() {
        var refCount = {};
        db.col('finances').forEach(function (f) { if (f.refId) refCount[f.refId] = (refCount[f.refId] || 0) + 1; });
        var hasIncome = {};
        db.col('finances').forEach(function (f) { if (f.type === 'income' && f.orderId) hasIncome[f.orderId] = true; });
        var settledNoFlow = db.col('payables').filter(function (p) { return p.status === 'settled' && !refCount[p.id]; });
        var signedNoIncome = db.col('orders').filter(function (o) {
            return o.status === 'signed' && !hasIncome[o.id] && Number(o.freight) > 0;
        });
        var mismatch = db.col('receivables').filter(function (r) {
            if (r.status !== 'pending' || !r.orderId) return false;
            return db.findOne('finances', function (f) { return f.orderId === r.orderId && f.type === 'income' && f.status === 'settled'; }) ? true : false;
        });
        return { settledNoFlow: settledNoFlow, signedNoIncome: signedNoIncome, mismatch: mismatch };
    }

    function finModal(id) {
        var f = db.get('finances', id);
        if (!f) return;
        var v = finView(f);
        var ref = v.refId ? (db.get('payables', v.refId) || db.get('codRecords', v.refId) || db.get('claims', v.refId) || db.get('transports', v.refId)) : null;
        ui.modal({
            title: '财务流水 ' + esc(v.id),
            sub: esc(v.category) + ' · ' + (v.income ? '收入' : '支出') + ' ' + fmt.money(v.value) + ' · ' + statusBadge(v.status, FIN_STATUS),
            body: ui.stack([
                ui.split('2', [
                    ui.card({ title: '记账要素', flat: true, body: ui.desc([
                        { label: '方向', value: v.income ? ui.badge('收入', 'success') : ui.badge('支出', 'muted') },
                        { label: '科目', value: esc(v.category) },
                        { label: '金额', value: '<b class="tms-money strong">' + fmt.money(v.value) + '</b>' },
                        { label: '发生时间', value: esc(fmt.dateTime(v.date)) },
                        { label: '入账状态', value: statusBadge(v.status, FIN_STATUS) },
                        { label: '损益口径', value: v.ledger ? '计入损益' : ui.badge('资金过账，不计损益', 'info') },
                        { label: '冲销标记', value: v.reverse ? ui.badge('红冲', 'danger') : '<span class="tms-dim">正常</span>' }
                    ]) }),
                    ui.card({ title: '关联单据', flat: true, body: ui.desc([
                        { label: '运单', value: v.orderId ? idLink(v.orderId) : '<span class="tms-dim">不挂单</span>' },
                        { label: '客户', value: dim(v.customer) },
                        { label: '来源单据', value: v.refId ? esc(v.refId) : '<span class="tms-dim">—</span>' },
                        { label: '来源单据', value: ref ? esc(ref.category || ref.type || ref.id || '') : dim('') },
                        { label: '摘要', value: dim(v.remark) }
                    ]) })
                ]),
                v.ledger ? '' : ui.notice('代收货款上划还的是客户的钱，属于负债减少而不是费用，因此不占损益口径；只有服务费那笔进收入。', 'info', '为什么这笔不计入利润')
            ]),
            footer: v.ledger && !v.reverse
                ? ui.btn('红冲这笔', { tone: 'danger', size: 'sm', act: 'fin:reverse', arg: id }) + ui.btn('关闭', { size: 'sm', act: 'ui:close' })
                : ui.btn('关闭', { size: 'sm', act: 'ui:close' })
        });
    }

    function finReverseModal(id) {
        var f = db.get('finances', id);
        if (!f) return;
        var v = finView(f);
        ui.formModal({
            title: '红冲流水', sub: esc(v.id) + ' · ' + esc(v.category) + ' ' + fmt.money(v.value), danger: true,
            notice: '红冲不删除原记录，而是追加一条同科目负向流水，两条都在账上——这样审计追溯时能看到完整修改链。',
            values: { reason: '', operator: actor(), amount: fmt.money(v.value) + ' → 冲减后 ' + fmt.money(-v.value) },
            fields: [
                { key: 'amount', label: '冲销金额', type: 'static' },
                { key: 'operator', label: '经办人', required: true },
                { key: 'reason', label: '冲销原因', type: 'textarea', rows: 2, span: 2, required: true }
            ],
            okText: '确认红冲',
            onSubmit: function (data) {
                if (String(data.reason || '').trim().length < 4) return '冲销原因至少 4 个字，这是审计口径的硬要求';
                var rec = TMS.finance.finRow(f.type, f.category, {
                    amount: -Number(f.amount), orderId: f.orderId, refId: f.id, date: util.iso(util.now()),
                    remark: '红冲 ' + f.id + '：' + data.reason, status: f.status
                });
                if (f.nature === '往来') db.update('finances', rec.id, { nature: '往来' });
                db.commit('finances', rec.id, 'fin:reverse');
                TMS.audit.log('finance.settle', 'finances', rec.id, '红冲 ' + f.id + ' ' + fmt.money(-Number(f.amount)) + '：' + data.reason, data.operator || actor());
                ui.toast('已红冲 ' + fmt.money(Number(f.amount)) + '，原记录保留', 'success');
            }
        });
    }

    function finNewModal() {
        ui.formModal({
            title: '手工记账', sub: '只补系统没覆盖到的收支，能用业务动作生成的不要手记',
            notice: '手工流水会立刻改变利润与现金口径，请写清依据；代收货款上划请选「往来」性质。',
            values: { type: 'income', category: '其他支出', date: util.iso(util.now()), nature: '损益', operator: actor() },
            fields: [
                { key: 'type', label: '方向', type: 'select', required: true, options: [{ value: 'income', label: '收入' }, { value: 'expense', label: '支出' }] },
                { key: 'category', label: '科目', type: 'select', required: true, options: ui.optionsOf(FIN_CATEGORIES) },
                { key: 'amount', label: '金额(元)', type: 'number', min: 0.01, required: true },
                { key: 'date', label: '发生时间', type: 'datetime', required: true },
                { key: 'orderId', label: '关联运单', placeholder: 'HL… 可留空' },
                { key: 'customer', label: '对方单位', placeholder: '不挂单时填写' },
                { key: 'nature', label: '性质', type: 'select', options: [{ value: '损益', label: '计入损益' }, { value: '往来', label: '资金过账（不计损益）' }] },
                { key: 'operator', label: '经办人', required: true },
                { key: 'remark', label: '摘要', type: 'textarea', rows: 2, span: 2, required: true }
            ],
            okText: '入账',
            onSubmit: function (data) {
                var key = String(data.orderId || '').trim();
                var o = key ? (db.get('orders', key) || db.findOne('orders', function (x) { return x.waybillNo === key; })) : null;
                if (key && !o) return '找不到运单 ' + key;
                var amt = Number(data.amount) || 0;
                if (amt <= 0) return '金额必须大于 0';
                var rec = TMS.finance.finRow(data.type, data.category, {
                    amount: amt, date: data.date, orderId: o ? o.id : '', customer: o ? '' : (data.customer || ''),
                    remark: data.remark + '（手工记账，经办 ' + (data.operator || actor()) + '）',
                    nature: data.nature === '往来' ? '往来' : undefined
                });
                db.commit('finances', rec.id, 'fin:manual');
                TMS.audit.log('finance.settle', 'finances', rec.id, '手工' + (data.type === 'income' ? '收入' : '支出') + ' ' + data.category + ' ' + fmt.money(amt) + '：' + data.remark, data.operator || actor());
                ui.toast('已入账 ' + fmt.money(amt) + '（' + rec.id + '）', 'success');
            }
        });
    }

    pg.define('finance', {
        sub: '损益账本：收入按单据发生、支出按供应商结算与期间计提，红冲与往来流水单独口径',
        load: function (ctx) {
            applyParamFilter(ctx, ['orderId', 'category']);
            var rows = finRows(ctx.days);
            var all = finRows(0);
            var sum = TMS.finance.financeSummary();
            var trend = TMS.finance.financeTrend(Math.max(7, Number(ctx.days) || 7));
            var gaps = finGaps();
            var exp = all.filter(function (f) { return f.ledger && !f.income && f.value < 0; });
            var inc = all.filter(function (f) { return f.ledger && f.income && f.value > 0; });
            return {
                rows: rows, all: all, sum: sum, trend: trend, gaps: gaps,
                cash: util.money(util.sum(rows, 'cash')),
                byExpense: topCats(exp), byIncome: topCats(inc),
                accrue: all.filter(function (f) { return ['场地租金', '装卸人工', '车辆折旧', '系统运维', '客服人工'].indexOf(f.category) > -1; }),
                reverses: all.filter(function (f) { return f.reverse; }),
                passThrough: util.money(util.sum(all.filter(function (f) { return !f.ledger; }), 'amount')),
                big: util.sortBy(rows, 'amount', 'desc').slice(0, 6)
            };
        },
        render: function (ctx, d) {
            var kpi = ui.kpis([
                { label: '窗口收入', value: fmt.money(util.sum(d.rows.filter(function (f) { return f.income && f.value > 0; }), 'value')), icon: '↗', tone: 'success', sub: '全库 ' + fmt.money(d.sum.income) },
                { label: '窗口支出', value: fmt.money(util.sum(d.rows.filter(function (f) { return !f.income && !f.reverse; }), 'amount')), icon: '↘', tone: 'warn', sub: '全库 ' + fmt.money(d.sum.expense) },
                { label: '净利', value: fmt.money(d.sum.profit), icon: '◎', tone: d.sum.profit >= 0 ? 'brand' : 'danger', sub: '毛利率 ' + fmt.percent(d.sum.margin) },
                { label: '挂账收入', value: fmt.money(d.sum.pendingIncome), icon: '○', tone: d.sum.pendingIncome ? 'warn' : 'success', sub: '月结件待账期核销' },
                { label: '往来过账', value: fmt.money(d.passThrough), icon: '⇄', tone: 'muted', sub: '代收款上划，不计损益' },
                { label: '账务缺口', value: d.gaps.signedNoIncome.length + d.gaps.settledNoFlow.length + d.gaps.mismatch.length, unit: '项', tone: (d.gaps.signedNoIncome.length + d.gaps.settledNoFlow.length + d.gaps.mismatch.length) ? 'danger' : 'success', icon: '⚠', sub: '单据与流水未对齐' }
            ]);
            var trendCard = ui.card({
                title: '收支走势', sub: '柱：收入 · 线：支出（红冲按负向计入，故支出线可能下穿）', flat: true,
                body: ch.combo({
                    labels: d.trend.map(function (x) { return x.label; }),
                    bars: d.trend.map(function (x) { return x.income; }),
                    line: d.trend.map(function (x) { return x.expense; }),
                    barName: '收入', lineName: '支出', height: 260, fmt: function (v) { return fmt.money(v); }
                })
            });
            var catCard = ui.card({
                title: '科目损益表', sub: 'financeSummary 口径：红冲取负、往来剔除', flat: true,
                body: ui.table({
                    dense: true, keyName: 'label', rows: d.sum.byCategory,
                    columns: [
                        { key: 'label', label: '科目' },
                        { key: 'income', label: '收入', align: 'right', width: '112px', render: function (r) { return r.income ? fmt.money(r.income) : '<span class="tms-dim">—</span>'; } },
                        { key: 'expense', label: '支出', align: 'right', width: '112px', render: function (r) { return r.expense ? fmt.money(r.expense) : '<span class="tms-dim">—</span>'; } },
                        { key: 'net', label: '净额', align: 'right', width: '112px', sortable: false, render: function (r) {
                            var net = util.money(r.income - r.expense);
                            return '<span class="tms-money' + (net >= 0 ? ' tone-success' : ' tone-danger') + '">' + fmt.money(net) + '</span>';
                        } }
                    ]
                })
            });
            var structCard = ui.card({
                title: '支出结构', sub: d.byExpense.length ? '干线与人工之外，期间计提是第二大块' : '', flat: true,
                body: d.byExpense.length ? ch.donut({
                    data: d.byExpense, height: 240, limit: 8,
                    center: { value: fmt.money(util.sum(d.byExpense, 'value')), label: '支出合计' },
                    fmt: function (v) { return fmt.money(v); }
                }) : ui.empty('窗口内没有支出')
            });
            var gapCard = ui.card({
                title: '账实核对', sub: '签收必落收入、结算必落支出、核销必改状态', tone: 'danger', flat: true,
                tools: ui.btn('一键补齐流水', { size: 'sm', act: 'fin:repair', icon: '⟳' }),
                body: ui.list([
                    {
                        title: '已签收但无运费收入流水', act: d.gaps.signedNoIncome.length ? 'fin:repair' : '',
                        sub: d.gaps.signedNoIncome.length ? d.gaps.signedNoIncome.length + ' 单，应补收入 ' + fmt.money(util.sum(d.gaps.signedNoIncome, 'freight')) + '（结算动作未执行或被中断）' : '签收单逐单有收入流水',
                        right: d.gaps.signedNoIncome.length ? ui.badge(d.gaps.signedNoIncome.length + ' 单', 'danger') : ui.badge('平', 'success')
                    },
                    {
                        title: '已结算应付无支出流水', act: d.gaps.settledNoFlow.length ? 'fin:repair' : '',
                        sub: d.gaps.settledNoFlow.length ? d.gaps.settledNoFlow.length + ' 笔，账面少记 ' + fmt.money(util.sum(d.gaps.settledNoFlow, 'amount')) + '，利润虚高' : '应付结算与支出流水一一对应',
                        right: d.gaps.settledNoFlow.length ? ui.badge(d.gaps.settledNoFlow.length + ' 笔', 'danger') : ui.badge('平', 'success')
                    },
                    {
                        title: '收入已核销但应收仍挂账', act: d.gaps.mismatch.length ? 'fin:repair' : '',
                        sub: d.gaps.mismatch.length ? d.gaps.mismatch.length + ' 笔应收状态未同步，账龄会一直算逾期' : '回款核销状态一致',
                        right: d.gaps.mismatch.length ? ui.badge(d.gaps.mismatch.length + ' 笔', 'warn') : ui.badge('平', 'success')
                    },
                    {
                        title: '红冲流水', sub: d.reverses.length ? d.reverses.length + ' 笔，合计冲销 ' + fmt.money(util.sum(d.reverses, 'amount')) + '（占收入 ' + fmt.percent(d.sum.income ? util.round(util.sum(d.reverses, 'amount') / d.sum.income * 100, 1) : 0) + '）' : '没有手工冲销',
                        right: d.reverses.length ? ui.badge(d.reverses.length + ' 笔', 'warn') : ui.badge('无', 'success')
                    }
                ])
            });
            var accrueCard = ui.card({
                title: '期间费用计提', sub: '场地/班组/车队/系统按覆盖天数折算入账，不挂在票上', flat: true,
                tools: ui.btn('计提本月未入账项', { size: 'sm', act: 'fin:accrue', icon: '＋' }),
                body: d.accrue.length ? ui.table({
                    dense: true, keyName: 'id', rows: util.sortBy(d.accrue, 'date', 'desc').slice(0, 6),
                    columns: [
                        { key: 'category', label: '科目' },
                        { key: 'amount', label: '金额', align: 'right', width: '116px', render: function (r) { return ui.moneyCell(r.amount); } },
                        { key: 'refId', label: '账期', width: '88px', render: function (r) { return dim(r.refId); } },
                        { key: 'remark', label: '计提口径', render: function (r) { return '<span class="tms-dim">' + esc(r.remark) + '</span>'; } }
                    ]
                }) : ui.empty('尚未计提期间费用', '点右上「计提本月未入账项」')
            });
            return wrap(ctx, {
                actions: ui.btn('手工记账', { tone: 'primary', size: 'sm', act: 'fin:new', icon: '＋' }) +
                    ui.btn('导出流水', { size: 'sm', act: 'fin:export', icon: '⤓' }),
                body: [kpi, trendCard, ui.split('2', [catCard, structCard]), ui.split('2', [gapCard, accrueCard]), grid(ctx, {
                    rows: d.rows, keyName: 'id', onRow: 'fin:open', searchKey: 'q', pageSize: 20,
                    search: function (r) { return [r.id, r.orderId, r.waybillNo, r.customer, r.category, r.remark, r.refId].join(' '); },
                    chips: [
                        { label: '全部', value: '', count: d.rows.length },
                        { label: '收入', value: 'income', count: d.rows.filter(function (r) { return r.income; }).length },
                        { label: '支出', value: 'expense', count: d.rows.filter(function (r) { return !r.income; }).length },
                        { label: '挂账', value: 'pending', count: d.rows.filter(function (r) { return r.status === 'pending'; }).length },
                        { label: '红冲/往来', value: 'special', count: d.rows.filter(function (r) { return r.reverse || !r.ledger; }).length }
                    ], chipsName: 'flag',
                    fields: [
                        { key: 'q', type: 'search', label: '流水号 / 运单 / 客户 / 摘要' },
                        { key: 'category', label: '科目', options: [{ value: '', label: '全部科目' }].concat(ui.optionsOf(d.all.map(function (r) { return r.category; }).filter(function (v, i, a) { return v && a.indexOf(v) === i; }), 'name', 'name')) },
                        { key: 'status', label: '入账状态', options: [{ value: '', label: '全部' }].concat(ui.optionsOf(Object.keys(FIN_STATUS))) },
                        { key: 'min', label: '金额下限', options: [{ value: '', label: '不限' }, { value: '200', label: '≥ 200' }, { value: '1000', label: '≥ 1000' }, { value: '5000', label: '≥ 5000' }] }
                    ],
                    filter: function (r, fs) {
                        if (fs.category && r.category !== fs.category) return false;
                        if (fs.status && r.status !== fs.status) return false;
                        if (fs.orderId && r.orderId !== fs.orderId) return false;
                        if (fs.min && !(r.amount >= Number(fs.min))) return false;
                        if (fs.flag === 'income') return r.income;
                        if (fs.flag === 'expense') return !r.income;
                        if (fs.flag === 'pending') return r.status === 'pending';
                        if (fs.flag === 'special') return !!(r.reverse || !r.ledger);
                        return true;
                    },
                    valueOf: function (r, k) { return k === 'value' ? r.value : r[k]; },
                    columns: [
                        { key: 'id', label: '流水号', width: '116px', render: function (r) { return idLink(r.id, 'fin:open'); } },
                        { key: 'type', label: '方向', width: '68px', render: function (r) { return ui.badge(r.income ? '收入' : '支出', r.reverse ? 'danger' : (r.income ? 'success' : 'muted')); } },
                        { key: 'category', label: '科目', width: '116px', render: function (r) { return esc(r.category) + (r.ledger ? '' : ' <span class="tms-dim">往来</span>'); } },
                        { key: 'value', label: '金额', align: 'right', width: '116px', render: function (r) { return '<span class="tms-money strong' + (r.value < 0 ? ' tone-danger' : (r.income ? ' tone-success' : '')) + '">' + fmt.money(r.value) + '</span>'; } },
                        { key: 'customer', label: '客户 / 运单', render: function (r) { return r.orderId ? (idLink(r.orderId) + ' <span class="tms-dim">' + esc(r.customer || '') + '</span>') : (dim(r.customer) + ' <span class="tms-dim">' + esc(r.refId || '') + '</span>'); } },
                        { key: 'status', label: '状态', width: '96px', render: function (r) { return statusBadge(r.status, FIN_STATUS); } },
                        { key: 'remark', label: '摘要', render: function (r) { return '<span class="tms-dim">' + esc(r.remark || '') + '</span>'; } },
                        { key: 'date', label: '发生时间', width: '128px', render: function (r) { return ui.timeCell(r.date); } },
                        { key: 'ops', label: '操作', width: '96px', sortable: false, render: function (r) {
                            return r.ledger && !r.reverse ? ui.link('红冲', 'fin:reverse', r.id, { tone: 'ghost' }) : ui.link('查看', 'fin:open', r.id, { tone: 'ghost' });
                        } }
                    ],
                    emptyText: '时间窗内没有财务流水', emptySub: '顶栏切长时间窗，或到应收/应付页做结算动作'
                })]
            });
        },
        actions: merge(pg.shared, custActions, excActions, {
            'fin:open': function (id) { finModal(id); },
            'fin:new': function () { finNewModal(); },
            'fin:reverse': function (id) { finReverseModal(id); },
            'fin:accrue': function () {
                var period = util.monthKey(util.now());
                var rows = TMS.finance.accruePeriodExpenses(period);
                if (!rows.length) { ui.toast(period + ' 的五项期间费用已全部入账，无需重复计提', 'info'); return; }
                TMS.audit.log('finance.settle', 'finances', '', period + ' 期间费用计提 ' + rows.length + ' 笔，合计 ' + fmt.money(util.sum(rows, 'amount')), actor());
                ui.toast('已计提 ' + rows.length + ' 笔期间费用：' + rows.map(function (r) { return r.category; }).join('、'), 'success');
            },
            'fin:repair': function () {
                var g = finGaps();
                if (!g.signedNoIncome.length && !g.settledNoFlow.length && !g.mismatch.length) {
                    ui.toast('账实已核对平：签收有收入、结算有支出、核销有状态', 'success');
                    return;
                }
                var n = 0;
                db.batch(function () {
                    g.signedNoIncome.forEach(function (o) { TMS.finance.settleOrder(o); n++; });
                    g.settledNoFlow.forEach(function (p) {
                        TMS.finance.finRow('expense', p.category, {
                            amount: Number(p.amount) || 0, date: p.settledAt || util.iso(util.now()), refId: p.id,
                            orderId: /^HL/.test(p.refId || '') ? p.refId : '', remark: '应付结算补记：' + p.target + '（' + p.category + '）'
                        });
                        db.touch('finances');
                        n++;
                    });
                    g.mismatch.forEach(function (r) {
                        db.update('receivables', r.id, { status: 'paid', paidAt: r.paidAt || util.iso(util.now()) });
                        db.touch('receivables');
                        var o = r.orderId ? db.get('orders', r.orderId) : null;
                        if (o) { o.receivableStatus = 'paid'; db.touch('orders'); }
                        n++;
                    });
                }, 'fin:repair');
                TMS.audit.log('finance.settle', 'finances', '', '账实核对补记 ' + n + ' 笔（收入 ' + g.signedNoIncome.length + ' / 支出 ' + g.settledNoFlow.length + ' / 状态 ' + g.mismatch.length + '）', actor());
                ui.toast('已补齐 ' + n + ' 笔流水与状态，利润口径已更新', 'success');
            },
            'fin:export': function () {
                exportGrid({
                    name: '财务流水.csv', rows: finRows(0),
                    cols: [
                        { label: '流水号', key: 'id' }, { label: '方向', value: function (r) { return r.income ? '收入' : '支出'; } },
                        { label: '科目', key: 'category' }, { label: '金额', key: 'value' }, { label: '计入损益', value: function (r) { return r.ledger ? '是' : '否（往来）'; } },
                        { label: '红冲', value: function (r) { return r.reverse ? '是' : ''; } },
                        { label: '订单号', key: 'orderId' }, { label: '运单号', key: 'waybillNo' }, { label: '客户', key: 'customer' },
                        { label: '来源单据', key: 'refId' }, { label: '状态', value: function (r) { return FIN_STATUS[r.status] || r.status; } },
                        { label: '发生时间', key: 'date' }, { label: '摘要', key: 'remark' }
                    ]
                });
            }
        }),
        drawerFooter: function (orderId) {
            var rows = db.col('finances').filter(function (f) { return f.orderId === orderId; });
            if (!rows.length) return ui.btn('补记该单结算流水', { size: 'sm', tone: 'warn', act: 'fin:repair' });
            var net = util.money(util.sum(rows, TMS.finance.ledgerValue));
            return ui.btn('该单流水 ' + rows.length + ' 笔 · 净 ' + fmt.money(net), { size: 'sm', act: 'fin:open', arg: rows[0].id });
        }
    });

    /* ---------- 十九、应收对账 ---------- */

    var AR_TEXT = { pending: '待回款', paid: '已回款', void: '已作废' };
    var BILL_TEXT = { draft: '待确认', confirmed: '已确认', partial: '部分回款', settled: '已结清' };
    var AR_BUCKETS = ['未到期', '逾期 1-30 天', '逾期 31-60 天', '逾期 60 天以上'];

    function arCycleOf(r) {
        var c = r.customerId ? db.get('customers', r.customerId) : null;
        if (c && c.settleCycle) return c.settleCycle;
        return TMS.order.settleCycleOf(r.orderId ? db.get('orders', r.orderId) : null);
    }

    function arView(r) {
        var o = r.orderId ? db.get('orders', r.orderId) : null;
        var c = r.customerId ? db.get('customers', r.customerId) : null;
        var overDays = util.round(util.hoursBetween(util.toDate(r.dueDate), util.now()) / 24, 1);
        var bucket = r.status !== 'pending' ? '' : (overDays <= 0 ? '未到期' : (overDays <= 30 ? '逾期 1-30 天' : (overDays <= 60 ? '逾期 31-60 天' : '逾期 60 天以上')));
        return {
            id: r.id, orderId: r.orderId, customerId: r.customerId || '',
            waybillNo: o ? o.waybillNo : '', customer: c ? c.name : TMS.order.customerName(o) || '散客',
            level: c ? c.level : '', contact: c ? c.contact : '', phone: c ? c.phone : '',
            amount: Number(r.amount) || 0, codAmount: Number(r.codAmount) || 0,
            cycle: arCycleOf(r), status: r.status || 'pending',
            date: r.date || r.createdAt || '', dueDate: r.dueDate || '',
            overDays: r.status === 'pending' ? overDays : 0, bucket: bucket,
            over: r.status === 'pending' && overDays > 0,
            paidAt: r.paidAt || '', billId: r.billId || '', invoiceNo: r.invoiceNo || '',
            urgedAt: r.urgedAt || '', urgeNote: r.urgeNote || '',
            note: r.adjustNote || '', voidReason: r.voidReason || '',
            period: TMS.finance.periodOf(r),
            freight: o ? Number(o.freight) || 0 : 0,
            diff: o ? util.money((Number(r.amount) || 0) - (Number(o.freight) || 0)) : 0,
            signed: !!o && o.status === 'signed'
        };
    }

    function arRows(days) {
        var rows = db.col('receivables').map(arView);
        if (days && Number(days) > 0) {
            rows = rows.filter(function (r) { return util.hoursBetween(r.date, util.now()) <= Number(days) * 24; });
        }
        return util.sortBy(rows, 'dueDate', 'asc');
    }

    /* 客户维度聚合：授信占用与逾期分布都是客户级风险，不是单票级 */
    function arCustomers(rows) {
        var byId = util.groupBy(rows.filter(function (r) { return r.status === 'pending'; }), 'customerId');
        var out = [];
        Object.keys(byId).forEach(function (id) {
            var g = byId[id];
            var c = id ? db.get('customers', id) : null;
            var over = g.filter(function (r) { return r.over; });
            var limit = Number((c || {}).creditLimit) || 0;
            var total = util.money(util.sum(g, 'amount'));
            out.push({
                customerId: id, name: c ? c.name : (g[0].customer || '散客'), level: c ? c.level : '',
                cycle: g[0].cycle, contact: c ? c.contact : '', phone: c ? c.phone : '',
                count: g.length, amount: total, overCount: over.length,
                overAmount: util.money(util.sum(over, 'amount')),
                maxOver: over.length ? util.round(Math.max.apply(null, over.map(function (r) { return r.overDays; })), 0) : 0,
                limit: limit, usage: limit ? util.round(total / limit * 100, 1) : null
            });
        });
        return util.sortBy(out, 'amount', 'desc');
    }

    function arModal(id) {
        var r = db.get('receivables', id);
        if (!r) return;
        var v = arView(r);
        var o = v.orderId ? db.get('orders', v.orderId) : null;
        var c = v.customerId ? db.get('customers', v.customerId) : null;
        var open = c ? db.col('receivables').filter(function (x) { return x.customerId === c.id && x.status === 'pending'; }) : [];
        var inc = db.col('finances').filter(function (f) { return f.orderId === v.orderId && f.type === 'income'; });
        ui.modal({
            title: '应收 ' + esc(v.id), size: 'wide',
            sub: esc(v.waybillNo || '无单应收') + ' · ' + esc(v.customer) + ' · ' + statusBadge(v.status, AR_TEXT),
            body: ui.stack([
                ui.split('2', [
                    ui.card({ title: '账期要素', flat: true, body: ui.desc([
                        { label: '应收金额', value: '<b class="tms-money strong">' + fmt.money(v.amount) + '</b>' },
                        { label: '结算周期', value: esc(v.cycle) },
                        { label: '发生日期', value: esc(fmt.date(v.date)) },
                        { label: '到期日', value: esc(v.dueDate) + (v.over ? ' ' + ui.badge('逾期 ' + v.overDays + ' 天', v.overDays > 60 ? 'danger' : 'warn') : '') },
                        { label: '回款时间', value: v.paidAt ? esc(fmt.dateTime(v.paidAt)) : '<span class="tms-dim">未回款</span>' },
                        { label: '发票号', value: dim(v.invoiceNo) },
                        { label: '账单号', value: dim(v.billId) },
                        { label: '调整记录', value: dim(v.note) }
                    ]) }),
                    ui.card({
                        title: '客户信用', sub: c ? '按全库未核销应收算占用' : '散客不做授信', flat: true,
                        body: ui.desc([
                            { label: '客户等级', value: c ? esc(c.level) + ' · ' + esc(c.levelName || '') : '<span class="tms-dim">散客</span>' },
                            { label: '联系人', value: c ? esc(c.contact || '—') + ' ' + esc(c.phone || '') : '<span class="tms-dim">—</span>' },
                            { label: '合同期', value: c ? esc(c.contractFrom || '') + ' ~ ' + esc(c.contractTo || '') : '<span class="tms-dim">—</span>' },
                            { label: '未回款笔数', value: open.length + ' 笔' },
                            { label: '未回款合计', value: fmt.money(util.money(util.sum(open, 'amount'))) },
                            { label: '授信额度', value: c ? fmt.money(c.creditLimit) : '<span class="tms-dim">不适用</span>' },
                            { label: '授信占用', value: c && Number(c.creditLimit) > 0 ? rateBar(util.round(util.sum(open, 'amount') / c.creditLimit * 100, 1), { target: 80 }) : '<span class="tms-dim">—</span>' }
                        ])
                    })
                ]),
                ui.card({
                    title: '运费与流水', sub: '应收必须等于运费（复核调整除外），差额说明改单未同步', flat: true,
                    body: ui.desc([
                        { label: '运单运费', value: o ? fmt.money(v.freight) : '<span class="tms-dim">无单</span>' },
                        { label: '应收金额', value: fmt.money(v.amount) },
                        { label: '差额', value: v.diff ? '<span class="tms-money tone-warn">' + fmt.money(v.diff) + '</span>' : '一致' },
                        { label: '收入流水', value: inc.length ? inc.length + ' 笔 · ' + fmt.money(util.sum(inc, TMS.finance.ledgerValue)) : '<span class="tms-badge tone-warn">未入账</span>' },
                        { label: '代收货款', value: v.codAmount ? fmt.money(v.codAmount) : '<span class="tms-dim">无</span>' }
                    ], { inline: true })
                }),
                v.diff ? ui.notice('应收 ' + fmt.money(v.amount) + ' 与运单运费 ' + fmt.money(v.freight) + ' 差 ' + fmt.money(v.diff) + '。计费复核与改单会走调整通道，属正常；若没有调整记录，需要按运单重算。', 'warn', '金额不一致') : ''
            ]),
            footer: (v.status === 'pending'
                ? ui.btn('登记回款', { tone: 'primary', size: 'sm', act: 'ar:pay', arg: id }) + ui.btn('金额调整', { size: 'sm', act: 'ar:adjust', arg: id })
                : ui.btn('查看运单', { size: 'sm', act: 'ar:order', arg: id })) +
                ui.btn('关闭', { size: 'sm', act: 'ui:close' })
        });
    }

    function arPayModal(id) {
        var r = db.get('receivables', id);
        if (!r) return;
        var v = arView(r);
        ui.formModal({
            title: '登记回款', sub: esc(v.customer) + ' · 应收 ' + fmt.money(v.amount) + ' · 到期 ' + esc(v.dueDate),
            notice: '核销会把挂账收入改成已结算，同时释放客户授信占用。',
            values: { invoiceNo: 'INV' + TMS.ids.dayStamp() + util.randomDigits(4), amount: v.amount, method: '银行转账', operator: actor() },
            fields: [
                { key: 'amount', label: '回款金额', type: 'static' },
                { key: 'method', label: '回款方式', type: 'select', options: ui.optionsOf(['银行转账', '承兑汇票', '现金', '余额抵扣', '第三方代收']) },
                { key: 'invoiceNo', label: '发票 / 回单号', required: true },
                { key: 'operator', label: '经办人', required: true },
                { key: 'remark', label: '备注', type: 'textarea', rows: 2, span: 2 }
            ],
            okText: '确认核销',
            onSubmit: function (data) {
                var res = TMS.finance.markReceivablePaid(id, { invoiceNo: data.invoiceNo });
                if (!res) return '应收记录不存在';
                TMS.audit.log('finance.settle', 'receivables', id, v.customer + ' 回款核销 ' + fmt.money(v.amount) + '（' + data.method + ' ' + data.invoiceNo + '）' + (data.remark ? '：' + data.remark : ''), data.operator || actor());
                ui.toast('已核销 ' + fmt.money(v.amount) + '，发票 ' + data.invoiceNo, 'success');
            }
        });
    }

    function arAdjustModal(id) {
        var r = db.get('receivables', id);
        if (!r) return;
        var v = arView(r);
        ui.formModal({
            title: '应收金额调整', sub: esc(v.id) + ' · 当前 ' + fmt.money(v.amount),
            danger: true,
            notice: '调整额直接改应收行并写入备注；先扣后方（差异为正表示补收客户）。运单在途时优先走「计费复核」，那样订单与应收一起改。',
            values: { amount: v.amount, reason: '', operator: actor() },
            fields: [
                { key: 'amount', label: '当前应收', type: 'static' },
                { key: 'delta', label: '调整金额(元)', type: 'number', step: 0.01, required: true, hint: '正数补收、负数减免' },
                { key: 'reason', label: '调整原因', type: 'textarea', rows: 2, span: 2, required: true, placeholder: '燃油附加漏计 / 大客户协议折让 / 货损减免…' },
                { key: 'operator', label: '经办人', required: true }
            ],
            okText: '提交调整',
            onSubmit: function (data) {
                var delta = util.round(Number(data.delta) || 0, 2);
                if (!delta) return '调整金额不能为 0';
                var after = util.money(v.amount + delta);
                if (after < 0) return '调整后应收为负，请改走「红冲 + 重开」';
                var o = v.orderId ? db.get('orders', v.orderId) : null;
                if (o) {
                    TMS.finance.adjustReceivable(o, delta, data.reason);
                } else {
                    db.update('receivables', id, {
                        amount: after,
                        adjustNote: (v.note ? v.note + '；' : '') + data.reason + ' ' + fmt.money(delta)
                    });
                    db.commit('receivables', id, 'ar:adjust');
                }
                TMS.audit.log('finance.settle', 'receivables', id, v.customer + ' 应收调整 ' + fmt.money(delta) + '：' + data.reason, data.operator || actor());
                ui.toast('已调整为 ' + fmt.money(after) + '（原 ' + fmt.money(v.amount) + '）', 'success');
            }
        });
    }

    /* 账单生成是「按客户 × 账期」的批处理，页面上要能看到将要生成的分组规模 */
    function arBillModal(seed) {
        var periods = util.unique(db.col('receivables').map(TMS.finance.periodOf)).sort();
        var unbilled = db.col('receivables').filter(function (r) { return r.status !== 'void' && !r.billId; });
        var scope = seed && seed.customerId ? unbilled.filter(function (r) { return r.customerId === seed.customerId; }) : unbilled;
        var groups = util.groupBy(scope, function (r) { return (r.customerId || 'NA') + '#' + TMS.finance.periodOf(r); });
        ui.formModal({
            title: '生成对账账单', sub: '未入账单的应收按「客户 × 账期」合并为一张月度对账单',
            notice: '将生成 ' + Object.keys(groups).length + ' 张账单，覆盖 ' + scope.length + ' 笔应收、合计 ' + fmt.money(util.money(util.sum(scope, 'amount'))) + '。已挂账单的应收不会重复入账。',
            values: { period: seed && seed.period ? seed.period : (periods.length ? periods[periods.length - 1] : util.monthKey(util.now())), customerId: (seed && seed.customerId) || '' },
            fields: [
                { key: 'period', label: '账期', type: 'select', required: true, options: ui.optionsOf(periods.length ? periods : [util.monthKey(util.now())], 'name', 'name') },
                { key: 'customerId', label: '客户', type: 'select', options: [{ value: '', label: '该账期全部客户' }].concat(ui.optionsOf(db.col('customers'), 'id', 'name')) },
                { key: 'remark', label: '账单备注', type: 'textarea', rows: 2, span: 2 }
            ],
            okText: '生成账单',
            onSubmit: function (data) {
                var created = TMS.finance.generateBills(data.period, data.customerId || '');
                if (!created.length) return '该账期没有可入账的未挂账应收';
                var total = util.money(util.sum(created, 'totalAmount'));
                TMS.audit.log('finance.settle', 'bills', '', data.period + ' 生成账单 ' + created.length + ' 张，合计 ' + fmt.money(total) + (data.remark ? '：' + data.remark : ''), actor());
                ui.toast('已生成 ' + created.length + ' 张账单，合计 ' + fmt.money(total), 'success');
            }
        });
    }

    function billModal(id) {
        var b = db.get('bills', id);
        if (!b) return;
        var items = db.col('receivables').filter(function (r) { return r.billId === b.id; }).map(arView);
        var c = b.customerId ? db.get('customers', b.customerId) : null;
        ui.modal({
            title: '对账单 ' + esc(b.billNo), size: 'wide',
            sub: esc(b.customer || '散客') + ' · 账期 ' + esc(b.period) + ' · ' + statusBadge(b.status, BILL_TEXT),
            body: ui.stack([
                ui.split('2', [
                    ui.card({ title: '账单要素', flat: true, body: ui.desc([
                        { label: '账单金额', value: '<b class="tms-money strong">' + fmt.money(b.totalAmount) + '</b>' },
                        { label: '已回款', value: fmt.money(b.receivedAmount) },
                        { label: '待回款', value: fmt.money(util.money((Number(b.totalAmount) || 0) - (Number(b.receivedAmount) || 0))) },
                        { label: '笔数', value: b.itemCount + ' 笔' },
                        { label: '付款到期', value: esc(b.dueDate || '') },
                        { label: '出账时间', value: esc(fmt.dateTime(b.issuedAt)) },
                        { label: '客户等级', value: c ? esc(c.level) + ' · ' + esc(c.settleCycle) : '<span class="tms-dim">散客</span>' },
                        { label: '备注', value: dim(b.remark) }
                    ]) }),
                    ui.card({ title: '回款进度', flat: true, body: ui.desc([
                        { label: '回款比例', value: pctBar(b.totalAmount ? util.round((Number(b.receivedAmount) || 0) / b.totalAmount * 100, 1) : 0, { tone: 'success' }) },
                        { label: '逾期笔数', value: items.filter(function (r) { return r.over; }).length + ' 笔' },
                        { label: '逾期金额', value: fmt.money(util.money(util.sum(items.filter(function (r) { return r.over; }), 'amount'))) },
                        { label: '已开票', value: items.filter(function (r) { return r.invoiceNo; }).length + ' / ' + items.length + ' 笔' }
                    ]), foot: ui.btn('按账单逐笔核销', { size: 'sm', act: 'ar:billSettle', arg: b.id }) })
                ]),
                ui.card({
                    title: '账单明细', sub: '共 ' + items.length + ' 笔，逐笔可回查运单', flat: true,
                    body: items.length ? ui.table({
                        dense: true, keyName: 'id', rows: items.slice(0, 20),
                        columns: [
                            { key: 'id', label: '应收', width: '116px', render: function (r) { return idLink(r.id, 'ar:open'); } },
                            { key: 'waybillNo', label: '运单', render: function (r) { return r.orderId ? idLink(r.orderId) : '<span class="tms-dim">—</span>'; } },
                            { key: 'amount', label: '金额', align: 'right', width: '104px', render: function (r) { return fmt.money(r.amount); } },
                            { key: 'dueDate', label: '到期', width: '96px' },
                            { key: 'status', label: '状态', width: '84px', render: function (r) { return statusBadge(r.status, AR_TEXT); } },
                            { key: 'invoiceNo', label: '发票', width: '120px', render: function (r) { return dim(r.invoiceNo); } }
                        ]
                    }) : ui.empty('账单没有明细', '应收被作废')
                })
            ]),
            footer: b.status === 'draft' ? ui.btn('确认账单', { tone: 'primary', size: 'sm', act: 'ar:confirm', arg: b.id }) + ui.btn('关闭', { size: 'sm', act: 'ui:close' })
                : ui.btn('关闭', { size: 'sm', act: 'ui:close' })
        });
    }

    /* 催款单：逾期客户一屏列全，抄送客户经理，是财务每天真在做的事 */
    function urgeModal() {
        var rows = arRows(0).filter(function (r) { return r.over; });
        var byCustomer = arCustomers(rows);
        ui.modal({
            title: '逾期催款清单', size: 'wide',
            sub: rows.length + ' 笔逾期 · 合计 ' + fmt.money(util.money(util.sum(rows, 'amount'))) + ' · 涉及 ' + byCustomer.length + ' 个客户',
            body: ui.stack([
                byCustomer.length ? ui.table({
                    keyName: 'customerId', rows: byCustomer,
                    columns: [
                        { key: 'name', label: '客户', render: function (r, i) { return ui.rank(i + 1) + esc(r.name) + ' ' + ui.badge(r.level || 'C', 'info') + ' <span class="tms-dim">' + esc(r.cycle) + '</span>'; } },
                        { key: 'contact', label: '对接人', width: '150px', render: function (r) { return dim(r.contact) + '<br><span class="tms-dim">' + dim(r.phone) + '</span>'; } },
                        { key: 'overCount', label: '逾期笔数', align: 'right', width: '88px' },
                        { key: 'overAmount', label: '逾期金额', align: 'right', width: '120px', render: function (r) { return ui.moneyCell(r.overAmount); } },
                        { key: 'maxOver', label: '最长逾期', align: 'right', width: '96px', render: function (r) { return r.maxOver > 60 ? ui.badge(r.maxOver + ' 天', 'danger') : ui.badge(r.maxOver + ' 天', 'warn'); } },
                        { key: 'ops', label: '操作', align: 'right', width: '92px', sortable: false, render: function (r) { return ui.link('看应收', 'ar:customer', r.customerId, { tone: 'ghost' }); } }
                    ]
                }) : ui.empty('当前没有逾期应收', '账期健康'),
                ui.notice('逾期 60 天以上的客户建议暂停揽收或转法务；KA 客户逾期优先走客户经理沟通，不要直接停服。', 'warn', '催收口径')
            ]),
            footer: ui.btn('导出催款清单', { tone: 'primary', size: 'sm', act: 'ar:exportOver' }) + ui.btn('关闭', { size: 'sm', act: 'ui:close' })
        });
    }

    pg.define('receivable', {
        sub: '应收台账与账龄：按客户算授信占用，按账期出对账单，逾期按天催',
        load: function (ctx) {
            applyParamFilter(ctx, ['customerId', 'orderId']);
            var rows = arRows(0);
            var rs = TMS.finance.receivableSummary();
            var bills = util.sortBy(db.col('bills'), 'issuedAt', 'desc');
            var pending = rows.filter(function (r) { return r.status === 'pending'; });
            var buckets = AR_BUCKETS.map(function (b) {
                var g = pending.filter(function (r) { return r.bucket === b; });
                return { label: b, value: util.money(util.sum(g, 'amount')), count: g.length };
            });
            var risk = rs.byCycle.map(function (x) {
                var g = pending.filter(function (r) { return r.cycle === x.label; });
                return { label: x.label, value: x.value, count: g.length, overdue: util.money(util.sum(g.filter(function (r) { return r.over; }), 'amount')) };
            });
            return {
                rows: rows, rs: rs, bills: bills, buckets: buckets, byCycle: risk,
                custs: arCustomers(pending),
                window: arRows(ctx.days),
                unbilled: rows.filter(function (r) { return r.status !== 'void' && !r.billId; }).length,
                worst: util.sortBy(pending.filter(function (r) { return r.over; }), 'overDays', 'desc').slice(0, 6),
                diff: rows.filter(function (r) { return r.signed && Math.abs(r.diff) >= 0.01; })
            };
        },
        render: function (ctx, d) {
            var rs = d.rs;
            var kpi = ui.kpis([
                { label: '应收总额', value: fmt.money(rs.total), unit: rs.count + ' 笔', icon: '↗', tone: 'brand', sub: '含已核销，按发生口径累计' },
                { label: '待回款', value: fmt.money(rs.pending), unit: d.rows.filter(function (r) { return r.status === 'pending'; }).length + ' 笔', tone: 'warn', icon: '○', sub: '挂账未收，占用授信' },
                { label: '已回款', value: fmt.money(rs.paid), tone: 'success', icon: '✓', sub: '回款率 ' + fmt.percent(rs.total ? util.round(rs.paid / rs.total * 100, 1) : 0) },
                { label: '逾期', value: fmt.money(rs.overdue), unit: rs.overdueCount + ' 笔', tone: rs.overdueCount ? 'danger' : 'success', icon: '⚠', sub: '到期未收，进入催收' },
                { label: '60 天以上', value: fmt.money(util.sum(d.rows.filter(function (r) { return r.bucket === '逾期 60 天以上'; }), 'amount')), icon: '☠', tone: 'danger', sub: '坏账风险敞口' },
                { label: '未出账', value: d.unbilled, unit: '笔', tone: d.unbilled ? 'warn' : 'success', icon: '▤', sub: '账单已出 ' + d.bills.length + ' 张' }
            ]);
            var bucketCard = ui.card({
                title: '账龄分布', sub: '按待回款金额的逾期天数分档', flat: true,
                body: ch.bars({ data: d.buckets, height: 230, fmt: function (v) { return fmt.money(v); } })
            });
            var cycleCard = ui.card({
                title: '结算周期与逾期', sub: '月结件占款最久，是账龄结构的主因', flat: true,
                body: ui.table({
                    dense: true, keyName: 'label', rows: d.byCycle,
                    columns: [
                        { key: 'label', label: '周期' },
                        { key: 'count', label: '待回款', align: 'right', width: '84px' },
                        { key: 'value', label: '应收', align: 'right', width: '116px', render: function (r) { return ui.moneyCell(r.value); } },
                        { key: 'overdue', label: '其中逾期', align: 'right', width: '116px', render: function (r) { return r.overdue ? ui.moneyCell(r.overdue) : '<span class="tms-dim">—</span>'; } },
                        { key: 'rate', label: '逾期占比', align: 'right', width: '120px', sortable: false, render: function (r) { return rateBar(r.value ? util.round(r.overdue / r.value * 100, 1) : 0, { target: 100 }); } }
                    ]
                })
            });
            var custCard = ui.card({
                title: '客户授信占用', sub: '未回款合计对授信额度，超额度先停发货再谈账期', flat: true,
                tools: ui.btn('逾期催款清单', { size: 'sm', act: 'ar:urge', icon: '☏' }),
                body: d.custs.length ? ui.table({
                    dense: true, keyName: 'customerId', rows: d.custs.slice(0, 8),
                    columns: [
                        { key: 'name', label: '客户', render: function (r, i) { return ui.rank(i + 1) + idLink(r.customerId, 'ar:customer') + ' ' + ui.badge(r.level || 'C', 'info'); } },
                        { key: 'count', label: '笔数', align: 'right', width: '64px' },
                        { key: 'amount', label: '未回款', align: 'right', width: '116px', render: function (r) { return ui.moneyCell(r.amount); } },
                        { key: 'limit', label: '授信', align: 'right', width: '104px', render: function (r) { return r.limit ? fmt.money(r.limit) : '<span class="tms-dim">无</span>'; } },
                        { key: 'usage', label: '占用', align: 'right', width: '116px', sortable: false, render: function (r) {
                            if (r.usage == null) return '<span class="tms-dim">现付不授信</span>';
                            return (r.usage > 100 ? ui.badge(util.round(r.usage, 0) + '% 超额', 'danger') : (r.usage > 80 ? ui.badge(util.round(r.usage, 0) + '%', 'warn') : '<span>' + fmt.percent(r.usage) + '</span>'));
                        } },
                        { key: 'overCount', label: '逾期', align: 'right', width: '68px', render: function (r) { return r.overCount ? ui.badge(r.overCount, 'danger') : '<span class="tms-dim">0</span>'; } }
                    ]
                }) : ui.empty('没有挂账客户', '全部现结')
            });
            var billCard = ui.card({
                title: '对账单', sub: '按客户 × 账期出账，确认后进催收流程', flat: true,
                tools: ui.btn('生成账单', { size: 'sm', tone: 'primary', act: 'ar:bill', icon: '＋' }),
                body: d.bills.length ? ui.table({
                    dense: true, keyName: 'id', rows: d.bills.slice(0, 8),
                    columns: [
                        { key: 'billNo', label: '账单号', render: function (b) { return idLink(b.id, 'ar:billOpen') + ' <span class="tms-dim">' + esc(b.billNo) + '</span>'; } },
                        { key: 'customer', label: '客户', render: function (b) { return dim(b.customer) + ' <span class="tms-dim">' + esc(b.period) + '</span>'; } },
                        { key: 'itemCount', label: '笔数', align: 'right', width: '64px' },
                        { key: 'totalAmount', label: '账单额', align: 'right', width: '112px', render: function (b) { return ui.moneyCell(b.totalAmount); } },
                        { key: 'receivedAmount', label: '已回款', align: 'right', width: '112px', render: function (b) { return fmt.money(b.receivedAmount); } },
                        { key: 'status', label: '状态', width: '92px', render: function (b) { return statusBadge(b.status, BILL_TEXT); } }
                    ]
                }) : ui.empty('还没有生成对账单', '点右上「生成账单」按账期出账')
            });
            return wrap(ctx, {
                actions: ui.btn('生成账单', { tone: 'primary', size: 'sm', act: 'ar:bill', icon: '＋' }) +
                    ui.btn('逾期催款', { size: 'sm', act: 'ar:urge', icon: '☏' }) +
                    ui.btn('导出对账明细', { size: 'sm', act: 'ar:export', icon: '⤓' }),
                body: [kpi, ui.split('2', [bucketCard, cycleCard]), ui.split('2', [custCard, billCard]), grid(ctx, {
                    rows: d.rows, keyName: 'id', onRow: 'ar:open', searchKey: 'q', pageSize: 20,
                    search: function (r) { return [r.id, r.orderId, r.waybillNo, r.customer, r.billId, r.invoiceNo].join(' '); },
                    chips: [
                        { label: '全部', value: '', count: d.rows.length },
                        { label: '待回款', value: 'pending', count: d.rows.filter(function (r) { return r.status === 'pending'; }).length },
                        { label: '已逾期', value: 'over', count: d.rows.filter(function (r) { return r.over; }).length },
                        { label: '未出账', value: 'unbilled', count: d.rows.filter(function (r) { return r.status !== 'void' && !r.billId; }).length },
                        { label: '已回款', value: 'paid', count: d.rows.filter(function (r) { return r.status === 'paid'; }).length }
                    ], chipsName: 'flag',
                    fields: [
                        { key: 'q', type: 'search', label: '应收 / 运单 / 客户 / 账单' },
                        { key: 'customerId', label: '客户', options: [{ value: '', label: '全部客户' }].concat(ui.optionsOf(d.custs, 'customerId', 'name')) },
                        { key: 'cycle', label: '结算周期', options: [{ value: '', label: '全部' }].concat(ui.optionsOf(rs.byCycle.map(function (x) { return x.label; }))) },
                        { key: 'bucket', label: '账龄', options: [{ value: '', label: '全部账龄' }].concat(ui.optionsOf(AR_BUCKETS)) }
                    ],
                    filter: function (r, fs) {
                        if (fs.customerId && r.customerId !== fs.customerId) return false;
                        if (fs.cycle && r.cycle !== fs.cycle) return false;
                        if (fs.bucket && r.bucket !== fs.bucket) return false;
                        if (fs.orderId && r.orderId !== fs.orderId) return false;
                        if (fs.flag === 'pending') return r.status === 'pending';
                        if (fs.flag === 'paid') return r.status === 'paid';
                        if (fs.flag === 'over') return r.over;
                        if (fs.flag === 'unbilled') return r.status !== 'void' && !r.billId;
                        return true;
                    },
                    valueOf: function (r, k) {
                        if (k === 'overDays') return r.overDays;
                        if (k === 'customer') return r.customer;
                        return r[k];
                    },
                    columns: [
                        { key: 'id', label: '应收', width: '116px', render: function (r) { return idLink(r.id, 'ar:open'); } },
                        { key: 'customer', label: '客户 / 运单', render: function (r) { return esc(r.customer) + '<br><span class="tms-dim">' + esc(r.waybillNo || '无单') + '</span>'; } },
                        { key: 'amount', label: '应收金额', align: 'right', width: '112px', render: function (r) { return ui.moneyCell(r.amount, { strong: r.status === 'pending' }); } },
                        { key: 'cycle', label: '周期', width: '76px', render: function (r) { return esc(r.cycle) + (r.diff ? ' ' + ui.badge('差 ' + util.round(r.diff, 0), 'warn') : ''); } },
                        { key: 'date', label: '发生', width: '96px', render: function (r) { return '<span class="tms-dim">' + esc(fmt.date(r.date)) + '</span>'; } },
                        { key: 'dueDate', label: '到期', width: '96px', render: function (r) { return esc(r.dueDate); } },
                        { key: 'overDays', label: '账龄', align: 'right', width: '96px', render: function (r) {
                            if (r.status !== 'pending') return '<span class="tms-dim">已结</span>';
                            return r.over ? ui.badge(util.round(r.overDays, 0) + ' 天逾期', r.overDays > 60 ? 'danger' : 'warn') : '<span class="tms-dim">剩 ' + util.round(-r.overDays, 0) + ' 天</span>';
                        } },
                        { key: 'billId', label: '账单', width: '108px', render: function (r) { return r.billId ? idLink(r.billId, 'ar:billOpen') : ui.badge('未出账', 'muted'); } },
                        { key: 'invoiceNo', label: '发票', width: '120px', render: function (r) { return dim(r.invoiceNo); } },
                        { key: 'status', label: '状态', width: '88px', render: function (r) { return statusBadge(r.status, AR_TEXT); } },
                        { key: 'ops', label: '操作', width: '128px', sortable: false, render: function (r) {
                            if (r.status === 'pending') return ui.link('核销', 'ar:pay', r.id, { tone: 'ghost' }) + ' ' + ui.link('调整', 'ar:adjust', r.id, { tone: 'ghost' });
                            return ui.link('回查', 'ar:open', r.id, { tone: 'ghost' });
                        } }
                    ],
                    emptyText: '没有符合条件的应收', emptySub: '清一下筛选，或先完成签收结算'
                })]
            });
        },
        actions: merge(pg.shared, custActions, excActions, {
            'ar:open': function (id) { arModal(id); },
            'ar:pay': function (id) { arPayModal(id); },
            'ar:adjust': function (id) { arAdjustModal(id); },
            'ar:bill': function () { arBillModal(); },
            'ar:urge': function () { urgeModal(); },
            'ar:billOpen': function (id) { billModal(id); },
            'ar:customer': function (id) {
                ui.closeTop();
                if (!id || id === 'NA') { ui.toast('散客应收没有客户档案', 'info'); return; }
                var st = TMS.ui.state('receivable');
                st.filters = st.filters || {};
                st.filters.customerId = id;
                st.page = 1;
                TMS.shell.refresh();
            },
            'ar:confirm': function (id) {
                var b = db.get('bills', id);
                if (!b) return;
                TMS.finance.confirmBill(id);
                db.commit('bills', id, 'bill:confirm');
                TMS.audit.log('finance.settle', 'bills', id, '确认对账单 ' + b.billNo + '（' + b.customer + ' ' + fmt.money(b.totalAmount) + '）', actor());
                ui.toast('账单 ' + b.billNo + ' 已确认，可发送客户对账', 'success');
            },
            'ar:billSettle': function (id) {
                var b = db.get('bills', id);
                if (!b) return;
                var rows = db.col('receivables').filter(function (r) { return r.billId === id && r.status === 'pending'; });
                if (!rows.length) { ui.toast('该账单没有待回款明细', 'info'); return; }
                ui.confirm({
                    title: '按账单批量核销', danger: true,
                    message: '将核销账单 ' + esc(b.billNo) + ' 的 ' + rows.length + ' 笔应收，合计 ' + fmt.money(util.money(util.sum(rows, 'amount'))) + '。',
                    detail: '批量核销用于客户已整单付款的场景，发票号统一记为账单号；单笔付款请逐笔登记，便于账龄追溯。',
                    okText: '全部核销'
                }).then(function (yes) {
                    if (!yes) return;
                    var n = 0;
                    db.batch(function () {
                        rows.forEach(function (r) {
                            TMS.finance.markReceivablePaid(r.id, { invoiceNo: b.billNo });
                            n++;
                        });
                    }, 'ar:billSettle');
                    TMS.finance.confirmBill(id);
                    db.commit('bills', id, 'bill:settle');
                    TMS.audit.log('finance.settle', 'bills', id, '账单 ' + b.billNo + ' 批量核销 ' + n + ' 笔', actor());
                    ui.toast('已核销 ' + n + ' 笔应收', 'success');
                    ui.closeTop();
                });
            },
            'ar:exportOver': function () {
                exportGrid({
                    name: '逾期应收催款清单.csv', rows: arRows(0).filter(function (r) { return r.over; }),
                    cols: [
                        { label: '应收', key: 'id' }, { label: '运单号', key: 'waybillNo' }, { label: '客户', key: 'customer' },
                        { label: '等级', key: 'level' }, { label: '联系人', key: 'contact' }, { label: '电话', key: 'phone' },
                        { label: '结算周期', key: 'cycle' }, { label: '金额', key: 'amount' }, { label: '到期日', key: 'dueDate' },
                        { label: '逾期天数', key: 'overDays' }, { label: '账龄档', key: 'bucket' }, { label: '账单', key: 'billId' }
                    ]
                });
            },
            'ar:export': function () {
                exportGrid({
                    name: '应收对账明细.csv', rows: arRows(0),
                    cols: [
                        { label: '应收', key: 'id' }, { label: '订单号', key: 'orderId' }, { label: '运单号', key: 'waybillNo' },
                        { label: '客户', key: 'customer' }, { label: '等级', key: 'level' }, { label: '结算周期', key: 'cycle' },
                        { label: '应收金额', key: 'amount' }, { label: '代收货款', key: 'codAmount' },
                        { label: '发生日期', key: 'date' }, { label: '到期日', key: 'dueDate' },
                        { label: '逾期天数', value: function (r) { return r.over ? r.overDays : 0; } },
                        { label: '账龄档', key: 'bucket' },
                        { label: '状态', value: function (r) { return AR_TEXT[r.status] || r.status; } },
                        { label: '回款时间', key: 'paidAt' }, { label: '发票', key: 'invoiceNo' }, { label: '账单', key: 'billId' },
                        { label: '调整备注', key: 'note' }
                    ]
                });
            }
        }),
        drawerFooter: function (orderId) {
            var r = TMS.finance.receivableOf(orderId);
            if (!r) return '';
            var v = arView(r);
            return ui.btn('应收 ' + fmt.money(v.amount) + ' · ' + (AR_TEXT[v.status] || v.status) + (v.over ? '（逾期 ' + util.round(v.overDays, 0) + ' 天）' : ''),
                { size: 'sm', tone: v.over ? 'danger' : (v.status === 'pending' ? 'warn' : ''), act: 'ar:open', arg: r.id });
        }
    });

    /* ---------- 二十、成本应付 ---------- */

    var AP_TEXT = { pending: '待结算', settled: '已结算', void: '已作废' };
    var AP_TARGET = { carrier: '外协承运商', driver: '司机/派送员', branch: '网点/分拨', supplier: '供应商' };
    var AP_CATEGORIES = ['干线运输', '司机趟费', '操作费', '派送费', '异常扣款', '包装物料',
        '维修保养', '场地租金', '装卸人工', '车辆折旧', '系统运维', '客服人工', '其他支出'];
    var AP_BUCKETS = ['未到期', '逾期 1-30 天', '逾期 31-60 天', '逾期 60 天以上'];

    /* 应付来源五花八门（车次、分拨、员工、异常、供应商），单据号前缀就是类型判别器。
       台账只存 refId，回源查最新状态：车次改派、员工调岗都不用回头补账 */
    function apRef(p) {
        var id = p.refId || '';
        var pool = /^TRP/.test(id) ? 'transports' : /^HB/.test(id) ? 'hubs' : /^EMP/.test(id) ? 'employees'
            : /^EX/.test(id) ? 'exceptions' : /^SUP/.test(id) ? 'suppliers' : /^CAR/.test(id) ? 'carriers'
                : /^BR/.test(id) ? 'branches' : /^VEH/.test(id) ? 'vehicles' : /^MAT/.test(id) ? 'materials' : '';
        var row = pool ? db.get(pool, id) : null;
        var label = id;
        if (pool === 'transports' && row) label = TMS.operation.labelOf(row);
        else if (row) label = row.name || row.code || row.title || id;
        else if (/^\d{4}-\d{2}$/.test(id)) label = id + ' 期间计提';
        else if (!id) label = '手工计提';
        return { pool: pool, row: row, id: id, label: label };
    }

    /* 来源单据的关键信息在弹窗里就地展开，比跳到别的页面再翻一遍有用 */
    function apRefRows(ref) {
        var r = ref.row;
        if (!r) return [];
        if (ref.pool === 'transports') {
            var view = TMS.operation.costView(r);
            return [
                { label: '线路', value: esc(TMS.operation.labelOf(r)) },
                { label: '调度方式', value: esc(r.dispatchType === 'ltl' ? '外协零担舱位' : '自有整车') },
                { label: '承运商', value: r.carrierId ? esc((db.get('carriers', r.carrierId) || {}).name || r.carrierId) : dim('') },
                { label: '司机', value: esc(TMS.operation.driverOf(r) || '—') },
                { label: '状态', value: statusBadge(r.status, pg.TRIP_TEXT) },
                { label: '里程/天数', value: (view.km || 0) + ' km / ' + (view.days || 1) + ' 天' },
                { label: '车次总成本', value: fmt.money(view.total) }
            ];
        }
        if (ref.pool === 'exceptions') {
            return [
                { label: '异常类型', value: esc(r.type || '') },
                { label: '责任方', value: esc(r.responsibleParty || '待定责') },
                { label: '扣款', value: fmt.money(r.deductionAmount || 0) },
                { label: '状态', value: statusBadge(r.status) },
            ];
        }
        if (ref.pool === 'employees' || ref.pool === 'hubs' || ref.pool === 'branches' ||
            ref.pool === 'carriers' || ref.pool === 'suppliers') {
            return [
                { label: '名称', value: esc(r.name || '') },
                { label: '编码', value: esc(r.code || r.id) },
                r.city ? { label: '所在城市', value: esc(r.city) } : null,
                r.department || r.deptName ? { label: '归属', value: esc(r.department || r.deptName) } : null,
                r.phone ? { label: '联系方式', value: esc(r.phone) } : null
            ].filter(Boolean);
        }
        return [];
    }

    function apView(p) {
        var ref = apRef(p);
        var amount = Number(p.amount) || 0;
        var dueDays = p.dueDate ? util.round(util.hoursBetween(util.now(), util.toDate(p.dueDate)) / 24, 1) : null;
        var over = p.status === 'pending' && dueDays != null && dueDays < 0;
        var overDays = over ? util.round(-dueDays, 0) : 0;
        var flowId = '';
        db.col('finances').forEach(function (f) { if (!flowId && f.refId === p.id) flowId = f.id; });
        return {
            id: p.id, refId: ref.id, refLabel: ref.label, refPool: ref.pool,
            target: p.target || '', targetId: p.targetId || '', targetType: p.targetType || '',
            targetText: AP_TARGET[p.targetType] || p.targetType || '其他',
            category: p.category || '其他支出', amount: amount,
            date: p.date || '', dueDate: p.dueDate || '', dueDays: dueDays,
            status: p.status || 'pending', settledAt: p.settledAt || '', operator: p.operator || '',
            remark: p.remark || '', settled: p.status === 'settled', over: over, overDays: overDays,
            bucket: !over ? AP_BUCKETS[0] : (overDays <= 30 ? AP_BUCKETS[1] : (overDays <= 60 ? AP_BUCKETS[2] : AP_BUCKETS[3])),
            age: util.round(util.hoursBetween(p.date || p.createdAt, util.toDate(p.settledAt || util.now())) / 24, 1),
            flowId: flowId, missing: p.status === 'settled' && !flowId
        };
    }

    function apRows(days) {
        var rows = db.col('payables').map(apView);
        if (days && Number(days) > 0) {
            rows = rows.filter(function (r) { return util.hoursBetween(r.date, util.now()) <= Number(days) * 24; });
        }
        return util.sortBy(rows, r2OverKey, 'desc');
    }
    function r2OverKey(r) { return (r.over ? 1e12 : 0) + Number(r.amount); }

    /* 成本侧账实核对：车次发了但没挂应付、应付结算了但没落支出流水，
       这两类差异在真实月结里分别表现为「成本漏提」和「利润虚高」 */
    function apGaps() {
        var anyRef = {};
        db.col('payables').forEach(function (p) { if (p.refId) anyRef[p.refId] = true; });
        var flowRef = {};
        db.col('finances').forEach(function (f) { if (f.refId) flowRef[f.refId] = true; });
        var noPayable = db.col('transports').filter(function (tr) {
            if (['departed', 'arrived', 'done'].indexOf(tr.status) < 0 || anyRef[tr.id]) return false;
            var view = TMS.operation.costView(tr);
            return view.total > 0;
        });
        var settledNoFlow = db.col('payables').filter(function (p) { return p.status === 'settled' && !flowRef[p.id]; });
        var noDue = db.col('payables').filter(function (p) { return !p.dueDate && p.status === 'pending'; });
        var zero = db.col('payables').filter(function (p) { return !(Number(p.amount) > 0); });
        return { noPayable: noPayable, settledNoFlow: settledNoFlow, noDue: noDue, zero: zero };
    }

    function apModal(id) {
        var p = db.get('payables', id);
        if (!p) { ui.toast('应付单不存在或已归档', 'warn'); return; }
        var v = apView(p);
        var ref = apRef(v);
        ui.modal({
            title: '应付 ' + esc(v.id), size: 'wide',
            sub: esc(v.category) + ' · ' + esc(v.target) + ' · ' + fmt.money(v.amount) + ' ' + statusBadge(v.status, AP_TEXT),
            body: ui.split('side', [
                ui.stack([
                    ui.desc([
                        { label: '结算对象', value: esc(v.target) + ' ' + ui.badge(v.targetText, 'info') },
                        { label: '费用科目', value: esc(v.category) },
                        { label: '应付金额', value: '<b class="tms-money strong">' + fmt.money(v.amount) + '</b>' },
                        { label: '计提日期', value: esc(v.date) + '（账龄 ' + v.age + ' 天）' },
                        { label: '到期日', value: v.dueDate ? esc(v.dueDate) + (v.over ? ' ' + ui.badge('逾期 ' + v.overDays + ' 天', 'danger') : ' ' + ui.badge('剩 ' + Math.max(0, util.round(v.dueDays, 0)) + ' 天', 'muted')) : dim('未约定账期') },
                        { label: '结算时间', value: v.settledAt ? fmt.dateTime(v.settledAt) + ' · ' + esc(v.operator) : dim('未结算') },
                        { label: '支出流水', value: v.flowId ? ui.link(esc(v.flowId), 'fin:open') : (v.settled ? ui.badge('缺流水', 'danger') : dim('结算后生成')) },
                        { label: '摘要', value: dim(v.remark) }
                    ]),
                    v.missing ? ui.notice('这张应付已标记结算，但没有对应的支出流水。补记后账面支出才会与应付口径一致。', 'warn', '结算与流水不一致') : ''
                ]),
                ui.stack([
                    ui.card({ title: '来源单据', sub: esc(ref.label), flat: true, body: apRefRows(ref).length ? ui.desc(apRefRows(ref)) : ui.empty('没有可追溯的来源单据', '手工计提或来源记录已归档') }),
                    ui.card({ title: '同类应付', sub: esc(v.category) + ' 近 6 笔', flat: true, body: ui.table({
                        dense: true, keyName: 'id',
                        rows: util.sortBy(db.col('payables').filter(function (x) {
                            return x.category === v.category && x.id !== v.id;
                        }).map(apView), 'date', 'desc').slice(0, 6),
                        columns: [
                            { key: 'id', label: '单号', width: '108px', render: function (r) { return ui.idCell(r.id, 'ap:open'); } },
                            { key: 'target', label: '对象' },
                            { key: 'amount', label: '金额', align: 'right', width: '92px', render: function (r) { return fmt.money(r.amount); } },
                            { key: 'status', label: '状态', align: 'right', width: '78px', sortable: false, render: function (r) { return statusBadge(r.status, AP_TEXT); } }
                        ]
                    }) })
                ])
            ]),
            footer: (v.settled ? '' : ui.btn('登记结算', { tone: 'primary', act: 'ap:settle', arg: v.id, icon: '✓' })) +
                (v.missing ? ui.btn('补记支出流水', { tone: 'warn', act: 'ap:flowfix', arg: v.id, icon: '⟳' }) : '') +
                ui.btn('调整账期', { act: 'ap:due', arg: v.id }) +
                (ref.pool ? ui.btn('看来源页', { tone: 'ghost', act: 'ap:ref', arg: ref.pool }) : '')
        });
    }

    function apSettleModal(id) {
        var p = db.get('payables', id);
        if (!p) return;
        var v = apView(p);
        if (v.settled) { ui.toast('该应付已结算', 'info'); return; }
        ui.formModal({
            title: '登记结算', sub: esc(v.id) + ' · ' + esc(v.target) + ' ' + fmt.money(v.amount),
            notice: '结算会同步生成一条「' + esc(v.category) + '」支出流水，账面成本与应付台账同时收口，不留单边挂账。',
            values: { operator: actor(), account: '基本户-招行 6225', voucher: '', date: util.iso(util.now()), payAmount: v.amount },
            fields: [
                { key: 'payAmount', label: '结算金额(元)', type: 'static' },
                { key: 'account', label: '付款账户', required: true },
                { key: 'voucher', label: '付款凭证号', placeholder: '银行回单/网银流水号', hint: '真实对账要靠凭证号回溯，留空审计会打回' },
                { key: 'date', label: '结算时间', type: 'datetime', required: true },
                { key: 'operator', label: '经办人', required: true },
                { key: 'remark', label: '备注', type: 'textarea', rows: 2, span: 2 }
            ],
            okText: '确认结算',
            onSubmit: function (data) {
                if (String(data.account || '').trim().length < 2) return '请填写付款账户';
                TMS.finance.settlePayable(v.id, { operator: data.operator || actor() });
                var flow = db.findOne('finances', function (f) { return f.refId === v.id; });
                if (flow) db.update('finances', flow.id, {
                    date: data.date || util.iso(util.now()),
                    remark: (flow.remark || '') + (data.voucher ? ' · 凭证 ' + data.voucher : '') + (data.remark ? ' · ' + data.remark : '')
                });
                if (flow) db.commit('finances', flow.id, 'ap:settleFlow');
                db.commit('payables', v.id, 'ap:settle');
                TMS.audit.log('finance.settle', 'payables', v.id,
                    '结算应付 ' + esc(v.target) + ' ' + fmt.money(v.amount) + '（' + v.category + '）' + (data.voucher ? '，凭证 ' + data.voucher : ''),
                    data.operator || actor());
                ui.toast('已结算 ' + fmt.money(v.amount) + '，支出流水同步入账', 'success');
                for (var i = 0; i < 2; i++) TMS.ui.closeTop();
            }
        });
    }

    /* 批量结算：真实财务按「对象 + 账期」打包付款，不是逐票点；
       这里先出预览清单，确认后才落账，避免一屏误触把全月应付结掉 */
    function apBatchModal(preset) {
        var pend = db.col('payables').filter(function (p) { return p.status === 'pending'; }).map(apView);
        if (!pend.length) { ui.toast('没有待结算应付', 'info'); return; }
        var targets = util.unique(pend.map(function (r) { return r.target; })).sort();
        var cats = util.unique(pend.map(function (r) { return r.category; })).sort();
        var want = preset || {};
        ui.formModal({
            title: '批量结算', sub: '当前待结算 ' + pend.length + ' 笔 / ' + fmt.money(util.sum(pend, 'amount')),
            notice: '预览只读，确认后才逐笔走 settlePayable 并生成支出流水；逾期单据排在前面。',
            values: { target: want.target || '', category: want.category || '', onlyOver: false, limit: 30, operator: actor() },
            fields: [
                { key: 'target', label: '结算对象', type: 'select', options: [{ value: '', label: '全部对象' }].concat(ui.optionsOf(targets)) },
                { key: 'category', label: '费用科目', type: 'select', options: [{ value: '', label: '全部科目' }].concat(ui.optionsOf(cats)) },
                { key: 'onlyOver', label: '仅逾期单据', type: 'checkbox' },
                { key: 'limit', label: '本次最多结算(笔)', type: 'number', min: 1, max: 200 },
                { key: 'operator', label: '经办人', required: true }
            ],
            okText: '按条件结算',
            onSubmit: function (data) {
                var rows = pend.filter(function (r) {
                    if (data.target && r.target !== data.target) return false;
                    if (data.category && r.category !== data.category) return false;
                    if (data.onlyOver && !r.over) return false;
                    return true;
                });
                if (!rows.length) return '当前条件没有可结算的应付';
                rows = util.sortBy(rows, 'overDays', 'desc').slice(0, Math.max(1, Number(data.limit) || 30));
                var total = util.money(util.sum(rows, 'amount'));
                rows.forEach(function (r) {
                    TMS.finance.settlePayable(r.id, { operator: data.operator || actor() });
                });
                TMS.audit.log('finance.settle', 'payables', '',
                    '批量结算 ' + rows.length + ' 笔应付，合计 ' + fmt.money(total) + (data.onlyOver ? '（仅逾期）' : ''),
                    data.operator || actor());
                ui.toast('已批量结算 ' + rows.length + ' 笔 / ' + fmt.money(total), 'success');
                for (var i = 0; i < 2; i++) TMS.ui.closeTop();
            }
        });
    }

    /* 不挂在票上的成本也能进台账（如临时包车、外包耗材），但必须写清依据 */
    function apNewModal() {
        ui.formModal({
            title: '手工计提应付', sub: '用于系统没自动生成的成本单据',
            notice: '手工应付结算后同样生成支出流水。自动计提的司机趟费、操作费请优先用「补建车次应付」，别手抄。',
            values: { targetType: 'supplier', category: '其他支出', date: util.dateKey(util.now()), term: 30, operator: actor() },
            fields: [
                { key: 'target', label: '结算对象', required: true, placeholder: '承运商/供应商/网点名称' },
                { key: 'targetType', label: '对象类型', type: 'select', required: true, options: ui.optionsOf(Object.keys(AP_TARGET).map(function (k) { return { v: k, t: AP_TARGET[k] }; }), 'v', 't') },
                { key: 'category', label: '费用科目', type: 'select', required: true, options: ui.optionsOf(AP_CATEGORIES) },
                { key: 'amount', label: '金额(元)', type: 'number', min: 0.01, required: true },
                { key: 'date', label: '计提日期', type: 'date', required: true },
                { key: 'term', label: '账期(天)', type: 'number', min: 0, max: 180, hint: '到期日 = 计提日 + 账期' },
                { key: 'operator', label: '经办人', required: true },
                { key: 'remark', label: '依据说明', type: 'textarea', rows: 2, span: 2, required: true, placeholder: '合同条款/临时包车单据号等' }
            ],
            okText: '计提',
            onSubmit: function (data) {
                var amt = util.money(Number(data.amount) || 0);
                if (amt <= 0) return '金额必须大于 0';
                if (String(data.remark || '').trim().length < 4) return '请写清计提依据，至少 4 个字';
                var term = Math.max(0, Number(data.term) || 0);
                var rec = TMS.finance.createPayable({
                    target: String(data.target || '').trim(), targetType: data.targetType,
                    category: data.category, refId: '', amount: amt,
                    date: data.date || util.dateKey(util.now()),
                    dueDate: util.dateKey(util.addDays(util.toDate(data.date || util.dateKey(util.now())), term)),
                    status: 'pending', settledAt: '', remark: data.remark + '（手工计提，经办 ' + (data.operator || actor()) + '）'
                });
                db.commit('payables', rec.id, 'ap:manual');
                TMS.audit.log('finance.accrual', 'payables', rec.id, '手工计提应付 ' + rec.target + ' ' + fmt.money(amt) + '：' + data.remark, data.operator || actor());
                ui.toast('已计提 ' + rec.id + ' · ' + fmt.money(amt), 'success');
                for (var i = 0; i < 2; i++) TMS.ui.closeTop();
            }
        });
    }

    function apDueModal(id) {
        var p = db.get('payables', id);
        if (!p) return;
        var v = apView(p);
        ui.formModal({
            title: '调整账期', sub: esc(v.id) + ' · ' + esc(v.target) + ' ' + fmt.money(v.amount),
            danger: true,
            notice: '账期改动会重算逾期与现金排程，必须留原因——供应商扯皮时这是唯一凭据。',
            values: { term: 30, reason: '', operator: actor(), due: v.dueDate },
            fields: [
                { key: 'due', label: '当前到期日', type: 'static' },
                { key: 'term', label: '顺延天数', type: 'number', min: -90, max: 180, required: true, hint: '负数表示要求提前付款' },
                { key: 'reason', label: '调整原因', type: 'textarea', rows: 2, span: 2, required: true },
                { key: 'operator', label: '经办人', required: true }
            ],
            okText: '保存新账期',
            onSubmit: function (data) {
                var d = Number(data.term);
                if (!isFinite(d) || d === 0) return '顺延天数不能为 0';
                if (String(data.reason || '').trim().length < 4) return '请填写调整原因';
                var base = util.toDate(v.dueDate || util.dateKey(util.now()));
                var next = util.dateKey(util.addDays(base, d));
                db.update('payables', v.id, { dueDate: next });
                db.commit('payables', v.id, 'ap:due');
                TMS.audit.log('finance.due', 'payables', v.id, '账期 ' + (v.dueDate || '未约定') + ' → ' + next + '：' + data.reason, data.operator || actor());
                ui.toast('到期日调整为 ' + next, 'success');
                for (var i = 0; i < 2; i++) TMS.ui.closeTop();
            }
        });
    }

    /* 车次已发但没建应付 = 成本漏提；已结算但没流水 = 账面少一笔支出。
       两个修复动作都复用领域方法，不在页面里手写金额 */
    function apRepair(kind) {
        var g = apGaps();
        var done = 0;
        if (kind === 'trip') {
            db.batch(function () {
                g.noPayable.forEach(function (tr) {
                    var rec = TMS.finance.createTripPayable(tr);
                    if (rec) { db.commit('payables', rec.id, 'ap:syncTrip'); done++; }
                });
            }, 'ap:sync');
            ui.toast(done ? '已补建 ' + done + ' 张车次应付' : '没有漏建的车次应付', done ? 'success' : 'info');
        } else if (kind === 'flow') {
            db.batch(function () {
                g.settledNoFlow.forEach(function (p) {
                    var rec = TMS.finance.finRow('expense', p.category || '其他支出', {
                        amount: Number(p.amount) || 0, refId: p.id,
                        date: p.settledAt || util.iso(util.now()), status: 'settled',
                        remark: '应付结算补记：' + (p.target || '') + '（' + (p.category || '') + '）'
                    });
                    db.commit('finances', rec.id, 'ap:flowfix');
                    done++;
                });
            }, 'ap:flowfix');
            ui.toast(done ? '已补记 ' + done + ' 笔支出流水' : '应付与流水一致', done ? 'success' : 'info');
        } else {
            var period = util.monthKey(util.now());
            var rows = TMS.finance.accruePeriodExpenses(period);
            db.persist('ap:accrue');
            ui.toast(rows.length ? '已计提 ' + period + ' 期间费用 ' + rows.length + ' 项' : period + ' 期间费用已计提', rows.length ? 'success' : 'info');
        }
        TMS.shell.refresh();
    }

    pg.define('payable', {
        sub: '成本应付：车次/操作/派送按业务发生自动计提，结算即生成支出流水，逾期与账期排程一目了然',
        load: function (ctx) {
            applyParamFilter(ctx, ['category', 'target', 'q']);
            var rows = apRows(ctx.days);
            var all = apRows(0);
            var br = TMS.finance.payableBreakdown();
            var pend = all.filter(function (r) { return !r.settled; });
            var over = all.filter(function (r) { return r.over; });
            var due7 = all.filter(function (r) { return !r.settled && r.dueDays != null && r.dueDays >= 0 && r.dueDays <= 7; });
            var gaps = apGaps();
            var byTarget = util.groupBy(pend, 'target');
            var exposure = Object.keys(byTarget).map(function (k) {
                var g = byTarget[k];
                return {
                    label: k || '未填对象', value: util.money(util.sum(g, 'amount')), count: g.length,
                    over: util.money(util.sum(g.filter(function (r) { return r.over; }), 'amount')),
                    maxOver: Math.max.apply(null, [0].concat(g.map(function (r) { return r.overDays; }))),
                    cats: util.unique(g.map(function (r) { return r.category; })).join('、')
                };
            }).sort(function (a, b) { return b.value - a.value; }).slice(0, 8);
            var bucketVals = AP_BUCKETS.map(function (b) { return util.money(util.sum(over.filter(function (r) { return r.bucket === b; }), 'amount')); });
            return {
                rows: rows, all: all, br: br, pend: pend, over: over, due7: due7, gaps: gaps,
                exposure: exposure, bucketVals: bucketVals,
                accrual: all.filter(function (r) { return ['场地租金', '装卸人工', '车辆折旧', '系统运维', '客服人工', '包装物料'].indexOf(r.category) > -1; }),
                big: util.sortBy(pend, 'amount', 'desc').slice(0, 6),
                byCat: br.byCategory.slice(0, 8),
                trend: TMS.finance.financeTrend(Math.max(7, Number(ctx.days) || 7))
            };
        },
        render: function (ctx, d) {
            var gapCount = d.gaps.noPayable.length + d.gaps.settledNoFlow.length + d.gaps.noDue.length + d.gaps.zero.length;
            var kpi = ui.kpis([
                { label: '待结算', value: fmt.money(util.sum(d.pend, 'amount')), unit: d.pend.length + ' 笔', tone: d.pend.length ? 'warn' : 'success', icon: '↘', sub: '全库应付合计 ' + fmt.money(d.br.total) },
                { label: '已结算', value: fmt.money(d.br.settled), unit: '元', icon: '✓', tone: 'success', sub: '已同步生成支出流水' },
                { label: '逾期未付', value: fmt.money(util.sum(d.over, 'amount')), unit: d.over.length + ' 笔', tone: d.over.length ? 'danger' : 'success', icon: '⚠', sub: '最久 ' + (d.over.length ? Math.max.apply(null, d.over.map(function (r) { return r.overDays; })) : 0) + ' 天' },
                { label: '7 天内到期', value: fmt.money(util.sum(d.due7, 'amount')), unit: d.due7.length + ' 笔', tone: d.due7.length ? 'warn' : 'muted', icon: '◷', sub: '现金排程口径' },
                { label: '成本集中度', value: d.exposure.length ? fmt.percent(d.exposure.slice(0, 3).reduce(function (a, x) { return a + x.value; }, 0) / (util.sum(d.pend, 'amount') || 1) * 100) : '—', icon: '◎', sub: 'TOP3 对象占待结算比' },
                { label: '计提缺口', value: gapCount, unit: '项', tone: gapCount ? 'danger' : 'success', icon: '⚑', sub: '车次漏建 / 流水缺失' }
            ]);
            var trendCard = ui.card({
                title: '结算与账龄', flat: true,
                sub: '左：按科目拆分待结算/已结算 · 右：逾期分档（金额）',
                body: ui.split('2', [
                    ch.stacked({
                        labels: d.br.byCategory.map(function (x) { return x.label; }),
                        series: [
                            { name: '已结算', data: d.br.byCategory.map(function (x) { return util.money(util.sum(d.all.filter(function (r) { return r.category === x.label && r.settled; }), 'amount')); }) },
                            { name: '待结算', data: d.br.byCategory.map(function (x) { return util.money(util.sum(d.all.filter(function (r) { return r.category === x.label && !r.settled; }), 'amount')); }) }
                        ],
                        height: 250, fmt: function (v) { return fmt.money(v); }
                    }),
                    ui.stack([
                        ui.desc(AP_BUCKETS.map(function (b, i) {
                            return { label: b, value: '<b class="tms-money' + (i && d.bucketVals[i] > 0 ? ' tone-danger' : '') + '">' + fmt.money(d.bucketVals[i]) + '</b>' };
                        })),
                        ui.notice(d.over.length ? '逾期未付共 ' + fmt.money(util.sum(d.over, 'amount')) + '，' + d.over.length + ' 笔；先处理 60 天以上档，供应商一旦停服影响的是全网时效。' : '当前没有逾期未付应付，账期健康。', d.over.length ? 'warn' : 'success', '账期排程')
                    ])
                ], '2')
            });
            var exposureCard = ui.card({
                title: '对象应付排行', sub: '待结算口径 · 含逾期占比与涉及科目', flat: true,
                body: d.exposure.length ? ch.hbars({
                    data: d.exposure.map(function (x) {
                        return { label: x.label, value: x.value, sub: x.count + ' 笔' + (x.over > 0 ? ' · 逾期 ' + fmt.money(x.over) : '') };
                    }),
                    height: 260, fmt: function (v) { return fmt.money(v); }, rowH: 30
                }) : ui.empty('没有待结算应付')
            });
            var gapCard = ui.card({
                title: '成本完整性', sub: '车次结算、期间计提与流水对齐三方核对', tone: gapCount ? 'danger' : '', flat: true,
                tools: gapCount ? ui.btn('全部可修复项', { size: 'sm', tone: 'ghost' }) : '',
                body: ui.list([
                    {
                        title: '车次已发但没建应付 ' + ui.badge(d.gaps.noPayable.length + ' 张', d.gaps.noPayable.length ? 'danger' : 'success'),
                        sub: d.gaps.noPayable.length ? '外协舱位与自有趟费在发车时挂账，漏建等于当月成本少提：' + d.gaps.noPayable.slice(0, 3).map(function (t) { return TMS.operation.labelOf(t); }).join('、') : '车次与应付台账一致',
                        act: d.gaps.noPayable.length ? 'ap:sync' : '', right: d.gaps.noPayable.length ? ui.btn('补建', { size: 'sm', tone: 'warn', act: 'ap:sync' }) : ''
                    },
                    {
                        title: '已结算但缺支出流水 ' + ui.badge(d.gaps.settledNoFlow.length + ' 笔', d.gaps.settledNoFlow.length ? 'danger' : 'success'),
                        sub: d.gaps.settledNoFlow.length ? '账面支出会低于实际付款，毛利虚高：' + d.gaps.settledNoFlow.slice(0, 3).map(function (p) { return p.id; }).join('、') : '应付与流水逐笔对应',
                        act: d.gaps.settledNoFlow.length ? 'ap:flowfix' : '', right: d.gaps.settledNoFlow.length ? ui.btn('补记流水', { size: 'sm', tone: 'warn', act: 'ap:flowfix' }) : ''
                    },
                    {
                        title: '未约定账期 ' + ui.badge(d.gaps.noDue.length + ' 笔', d.gaps.noDue.length ? 'warn' : 'success'),
                        sub: d.gaps.noDue.length ? '没有到期日就无法排现金，逐张点「调整账期」补上' : '全部待结算应付都有到期日',
                        act: d.gaps.noDue.length ? 'ap:due' : '', arg: d.gaps.noDue.length ? d.gaps.noDue[0].id : '',
                        right: d.gaps.noDue.length ? ui.btn('去补账期', { size: 'sm', tone: 'ghost', act: 'ap:open', arg: d.gaps.noDue[0].id }) : ''
                    },
                    {
                        title: '本期期间费用计提 ' + ui.badge(d.accrual.length + ' 笔', d.accrual.length ? 'success' : 'warn'),
                        sub: '场地、人工、折旧、系统不挂在票上，按月计提才不会出现「只有单票成本」的假账；当前已计提 ' + fmt.money(util.sum(d.accrual, 'amount')),
                        right: ui.btn('计提本月', { size: 'sm', tone: 'ghost', act: 'ap:accrue' })
                    }
                ].filter(function (x) { return x.title; }))
            });
            var bigCard = ui.card({
                title: '大额待结算', sub: '按金额排序，优先排款', flat: true,
                body: d.big.length ? ui.table({
                    dense: true, keyName: 'id', rows: d.big,
                    columns: [
                        { key: 'id', label: '应付单', width: '120px', render: function (r) { return ui.idCell(r.id, 'ap:open'); } },
                        { key: 'target', label: '对象', render: function (r) { return esc(r.target) + ' <span class="tms-dim">' + esc(r.targetText) + '</span>'; } },
                        { key: 'category', label: '科目', width: '96px' },
                        { key: 'amount', label: '金额', align: 'right', width: '108px', render: function (r) { return ui.moneyCell(r.amount); } },
                        { key: 'dueDate', label: '到期', align: 'right', width: '112px', sortable: false, render: function (r) { return r.over ? ui.badge('逾期 ' + r.overDays + ' 天', 'danger') : esc(r.dueDate || '—'); } },
                        { key: 'ops', label: '', align: 'right', width: '68px', sortable: false, render: function (r) { return ui.link('结算', 'ap:settle', r.id, { tone: 'ghost' }); } }
                    ]
                }) : ui.empty('没有待结算应付')
            });
            var rows = function (r, fs) {
                if (fs.category && r.category !== fs.category) return false;
                if (fs.target && r.target !== fs.target) return false;
                var c = fs.status || '';
                if (c === 'pending' && r.settled) return false;
                if (c === 'settled' && !r.settled) return false;
                if (c === 'over' && !r.over) return false;
                if (c === 'due7' && !(r.dueDays >= 0 && r.dueDays <= 7 && !r.settled)) return false;
                if (c === 'gap' && !r.missing) return false;
                return true;
            };
            var listCard = grid(ctx, {
                title: '应付台账', sub: d.all.length + ' 张应付单（窗口内 ' + d.rows.length + ' 张）',
                rows: d.rows, keyName: 'id', dense: true,
                filter: function (r, fs) { return rows(r, fs); },
                search: function (r) { return [r.id, r.target, r.category, r.refId, r.refLabel, r.remark].join(' '); },
                valueOf: function (r, k) { return k === 'overDays' ? r.overDays : (k === 'dueDays' ? (r.dueDays == null ? -1e9 : r.dueDays) : (k === 'age' ? r.age : r[k])); },
                chips: [
                    { label: '全部', value: '', count: d.rows.length },
                    { label: '待结算', value: 'pending', count: d.rows.filter(function (r) { return !r.settled; }).length },
                    { label: '已逾期', value: 'over', count: d.rows.filter(function (r) { return r.over; }).length },
                    { label: '7 天内到期', value: 'due7', count: d.rows.filter(function (r) { return r.dueDays >= 0 && r.dueDays <= 7 && !r.settled; }).length },
                    { label: '缺流水', value: 'gap', count: d.rows.filter(function (r) { return r.missing; }).length },
                    { label: '已结算', value: 'settled', count: d.rows.filter(function (r) { return r.settled; }).length }
                ], chipsName: 'status',
                fields: [
                    { key: 'category', label: '科目', options: [{ value: '', label: '全部科目' }].concat(ui.optionsOf(AP_CATEGORIES)) },
                    { key: 'target', label: '结算对象', options: [{ value: '', label: '全部对象' }].concat(ui.optionsOf(util.unique(d.all.map(function (r) { return r.target; })).sort())) }
                ],
                tools: ui.btn('批量结算', { size: 'sm', tone: 'primary', act: 'ap:batch', icon: '⛁' }) +
                    ui.btn('手工计提', { size: 'sm', act: 'ap:new', icon: '+' }) +
                    ui.btn('导出', { size: 'sm', tone: 'ghost', act: 'ap:export', icon: '↓' }),
                columns: [
                    { key: 'id', label: '应付单', width: '118px', render: function (r) { return ui.idCell(r.id, 'ap:open'); } },
                    { key: 'target', label: '结算对象', render: function (r) {
                        return esc(r.target) + '<div class="tms-dim">' + esc(r.targetText) + ' · ' + esc(r.refLabel) + '</div>';
                    } },
                    { key: 'category', label: '科目', width: '92px', render: function (r) { return ui.badge(r.category, r.settled ? 'muted' : 'info'); } },
                    { key: 'amount', label: '金额', align: 'right', width: '112px', render: function (r) { return ui.moneyCell(r.amount); } },
                    { key: 'date', label: '计提', align: 'right', width: '96px', render: function (r) { return ui.timeCell(r.date); } },
                    { key: 'dueDays', label: '账期', align: 'right', width: '112px', render: function (r) {
                        if (r.settled) return '<span class="tms-dim">' + esc(fmt.date(r.settledAt)) + ' 结清</span>';
                        if (r.dueDate == null || r.dueDate === '') return ui.badge('未约定', 'warn');
                        return r.over ? ui.badge('逾期 ' + r.overDays + ' 天', 'danger')
                            : '<span class="' + (r.dueDays <= 7 ? 'tone-warn' : 'tms-dim') + '">剩 ' + util.round(r.dueDays, 0) + ' 天</span>';
                    } },
                    { key: 'status', label: '状态', align: 'right', width: '86px', sortable: false, render: function (r) { return statusBadge(r.status, AP_TEXT) + (r.missing ? ' ' + ui.badge('缺流水', 'danger') : ''); } },
                    { key: 'ops', label: '操作', align: 'right', width: '108px', sortable: false, render: function (r) {
                        return r.settled ? ui.link('详情', 'ap:open', r.id, { tone: 'ghost' })
                            : ui.link('结算', 'ap:settle', r.id) + ' ' + ui.link('账期', 'ap:due', r.id, { tone: 'ghost' });
                    } }
                ],
                emptyText: '没有符合条件的应付单'
            });
            var catCard = ui.card({
                title: '科目构成', sub: '应付台账全量口径', flat: true,
                body: ch.donut({
                    data: d.byCat.map(function (x) { return { label: x.label, value: x.value }; }),
                    height: 240, limit: 8, center: { value: fmt.money(d.br.total), label: '应付合计' },
                    fmt: function (v) { return fmt.money(v); }
                })
            });
            return wrap(ctx, {
                actions: ui.btn('批量结算', { tone: 'primary', act: 'ap:batch', icon: '⛁' }) + ui.btn('手工计提', { act: 'ap:new', icon: '+' }),
                body: [kpi, trendCard, ui.split('2', [exposureCard, gapCard]), ui.split('2', [bigCard, catCard]), listCard]
            });
        },
        actions: {
            'ap:open': function (id) { apModal(id); },
            'ap:settle': function (id) { apSettleModal(id); },
            'ap:batch': function () { apBatchModal(); },
            'ap:new': function () { apNewModal(); },
            'ap:due': function (id) { apDueModal(id); },
            'ap:sync': function () { apRepair('trip'); },
            'ap:flowfix': function (id) {
                if (id) {
                    var p = db.get('payables', id);
                    if (!p) return;
                    var rec = TMS.finance.finRow('expense', p.category || '其他支出', {
                        amount: Number(p.amount) || 0, refId: p.id, date: p.settledAt || util.iso(util.now()),
                        status: 'settled', remark: '应付结算补记：' + (p.target || '') + '（' + (p.category || '') + '）'
                    });
                    db.commit('finances', rec.id, 'ap:flowfix');
                    TMS.audit.log('finance.settle', 'finances', rec.id, '补记应付 ' + p.id + ' 支出流水 ' + fmt.money(p.amount), actor());
                    ui.toast('已补记 ' + fmt.money(p.amount), 'success');
                    TMS.shell.refresh();
                    return;
                }
                apRepair('flow');
            },
            'ap:accrue': function () { apRepair('accrue'); },
            'ap:ref': function (pool) {
                var page = pool === 'transports' ? 'transport' : (pool === 'exceptions' ? 'exception' : (pool === 'employees' ? 'hr' : ''));
                if (!page) { ui.toast('该来源暂无独立页面', 'info'); return; }
                ui.closeTop();
                TMS.shell.go(page);
            },
            'ap:export': function () {
                exportGrid({
                    name: '成本应付.csv', rows: apRows(0),
                    filter: function (r, fs) {
                        if (fs.category && r.category !== fs.category) return false;
                        if (fs.target && r.target !== fs.target) return false;
                        return true;
                    },
                    cols: [
                        { key: 'id', label: '应付单' }, { key: 'target', label: '结算对象' },
                        { key: 'targetText', label: '对象类型' }, { key: 'category', label: '科目' },
                        { key: 'amount', label: '金额' }, { key: 'date', label: '计提日期' },
                        { key: 'dueDate', label: '到期日' },
                        { key: 'overDays', label: '逾期天数', value: function (r) { return r.over ? r.overDays : 0; } },
                        { key: 'status', label: '状态', value: function (r) { return AP_TEXT[r.status] || r.status; } },
                        { key: 'settledAt', label: '结算时间' }, { key: 'operator', label: '经办人' },
                        { key: 'refLabel', label: '来源单据' }, { key: 'remark', label: '摘要' }
                    ]
                });
            }
        }
    });

    /* ---------- 二十一、计费复核 ---------- */

    var RC_TYPES = { '补收': 'danger', '退费': 'warn', '一致': 'success' };
    var RC_REASONS = ['到货复磅', '体积抽盘', '客户争议', '计费异常追查', '大客户定期对账', '抽检'];

    /* 复核流水没有 refId（领域层按订单落账），按订单 + 科目 + 发生时间回查 */
    function rcFlowId(r) {
        var cat = r.delta > 0 ? '运费复核补收' : (r.delta < 0 ? '运费复核退费' : '');
        if (!cat) return '';
        var hit = db.findOne('finances', function (f) {
            return f.orderId === r.orderId && f.category === cat && util.dateKey(f.date) === util.dateKey(r.auditedAt);
        });
        return hit ? hit.id : '';
    }

    function rcView(r) {
        var ow = Number(r.originalWeight) || 0, aw = Number(r.auditedWeight) || 0;
        var of = Number(r.originalFreight) || 0, af = Number(r.auditedFreight) || 0;
        var delta = util.money(af - of);
        return {
            id: r.id, orderId: r.orderId, waybillNo: r.waybillNo, customer: r.customer || '',
            originalWeight: ow, auditedWeight: aw, weightGap: util.round(aw - ow, 2),
            weightPct: ow ? util.round((aw - ow) / ow * 100, 1) : 0,
            originalChargeable: Number(r.originalChargeable) || 0, auditedChargeable: Number(r.auditedChargeable) || 0,
            originalFreight: of, auditedFreight: af, delta: delta,
            type: r.type || (Math.abs(delta) < 0.01 ? '一致' : (delta > 0 ? '补收' : '退费')),
            reason: r.reason || '', operator: r.operator || '', auditedAt: r.auditedAt || r.createdAt || '',
            day: util.dateKey(util.toDate(r.auditedAt || r.createdAt)),
            flowId: rcFlowId(r),
            chargeGap: util.round((Number(r.auditedChargeable) || 0) - (Number(r.originalChargeable) || 0), 2)
        };
    }

    function rcRows(days) {
        var rows = db.col('rechecks').map(rcView);
        if (days && Number(days) > 0) {
            rows = rows.filter(function (r) { return util.hoursBetween(r.auditedAt, util.now()) <= Number(days) * 24; });
        }
        return util.sortBy(rows, 'auditedAt', 'desc');
    }

    /* 待复核队列：先用「体积重 vs 声明实重」这条不依赖路由的廉价规则筛掉绝大多数正常票，
       只对真嫌疑票跑一次完整报价——复磅台每天回传的也就是这一小撮 */
    function rcQueue(days) {
        var ratio = Number(cfg.billing.defaultThrowRatio) || 6000;
        var pool = db.col('orders').filter(function (o) {
            if (o.status === 'cancelled' || o.auditedAt) return false;
            if (days && Number(days) > 0 && util.hoursBetween(o.createdAt, util.now()) > Number(days) * 24) return false;
            return Number(o.weight) > 0;
        });
        var suspects = pool.map(function (o) {
            var vol = util.round(TMS.pricing.volumeCm3(o.dims, o.pieces, o.weight, o.goods) / ratio, 2);
            var act = Number(o.weight) || 0;
            var gap = util.round(vol - act, 2);
            return { o: o, vol: vol, act: act, gap: gap, pct: act ? util.round(gap / act * 100, 1) : 0 };
        }).filter(function (x) {
            return x.gap > Math.max(2, x.act * 0.12) || x.pct > 25;
        });
        suspects.sort(function (a, b) { return b.gap - a.gap; });
        return suspects.slice(0, 60).map(function (x) {
            var o = x.o;
            var suggest = util.round(Math.max(x.vol, Number(o.chargeableWeight) || 0, x.act), 2);
            var base = TMS.pricing.reprice(o, {});
            var after = suggest > x.act ? TMS.pricing.reprice(o, { weight: suggest }) : base;
            return {
                id: o.id, waybillNo: o.waybillNo, customer: TMS.order.customerName(o),
                origin: o.origin, destination: o.destination, service: o.service, goods: o.goods,
                pieces: Number(o.pieces) || 1, dims: o.dims || '', hasDims: !!o.dims,
                declaredWeight: x.act, volumetricWeight: x.vol, gapKg: x.gap, gapPct: x.pct,
                suggestWeight: suggest, declaredFreight: util.money(Number(o.freight) || 0),
                quoteFreight: util.money(base.total), suggestFreight: util.money(after.total),
                delta: util.money(after.total - base.total), chargeable: Number(o.chargeableWeight) || 0,
                status: o.status, createdAt: o.createdAt,
                margin: util.money(base.total - (Number(o.cost && o.cost.t) || 0))
            };
        }).sort(function (a, b) { return b.delta - a.delta; });
    }

    function rcGaps(rows) {
        var noFlow = rows.filter(function (r) { return Math.abs(r.delta) >= 0.01 && !r.flowId; });
        var drift = [];
        rows.forEach(function (r) {
            var o = db.get('orders', r.orderId);
            if (!o) return;
            var rec = TMS.finance.receivableOf(o.id);
            if (rec && Math.abs((Number(rec.amount) || 0) - (Number(o.freight) || 0)) >= 0.01) {
                drift.push({ id: r.id, orderId: o.id, waybillNo: o.waybillNo, receivableId: rec.id, receivableAmount: util.money(Number(rec.amount) || 0), freight: util.money(Number(o.freight) || 0) });
            }
        });
        var stale = rows.filter(function (r) {
            var o = db.get('orders', r.orderId);
            return !!o && Math.abs((Number(o.freight) || 0) - r.auditedFreight) >= 0.01;
        });
        return { noFlow: noFlow, drift: drift, stale: stale };
    }

    function rcModal(id) {
        var r = db.get('rechecks', id);
        if (!r) { ui.toast('复核记录不存在或已归档', 'warn'); return; }
        var v = rcView(r);
        var o = db.get('orders', v.orderId);
        var q = o ? TMS.pricing.reprice(o, {}) : null;
        ui.modal({
            title: '复核 ' + esc(v.id), size: 'wide',
            sub: '<span class="tms-mono">' + esc(v.waybillNo) + '</span> · ' + esc(v.customer) + ' · ' +
                ui.badge(v.type, RC_TYPES[v.type] || 'muted') + ' ' + (Math.abs(v.delta) >= 0.01 ? fmt.money(v.delta) : '无差额'),
            body: ui.stack([
                ui.split('2', [
                    ui.card({ title: '复核前', flat: true, body: ui.desc([
                        { label: '声明实重', value: v.originalWeight + ' kg' },
                        { label: '计费重', value: v.originalChargeable + ' kg' },
                        { label: '原运费', value: fmt.money(v.originalFreight) },
                        { label: '品名/件数', value: esc((o ? o.goods : '') || '—') + ' · ' + (o ? (Number(o.pieces) || 1) : 1) + ' 件' },
                        { label: '尺寸', value: o && o.dims ? esc(o.dims) : dim('未登记（按品名密度折算体积）') }
                    ]) }),
                    ui.card({ title: '复核后', tone: Math.abs(v.delta) >= 0.01 && v.delta < 0 ? 'danger' : '', flat: true, body: ui.desc([
                        { label: '复磅实重', value: v.auditedWeight + ' kg ' + (v.weightGap ? ui.badge((v.weightGap > 0 ? '+' : '') + v.weightGap + ' kg（' + (v.weightPct > 0 ? '+' : '') + v.weightPct + '%）', v.weightGap > 0 ? 'danger' : 'success') : '') },
                        { label: '计费重', value: v.auditedChargeable + ' kg' },
                        { label: '复核后运费', value: fmt.money(v.auditedFreight) },
                        { label: '运费差额', value: '<b class="tms-money strong ' + (v.delta > 0 ? 'tone-success' : (v.delta < 0 ? 'tone-danger' : '')) + '">' + (Math.abs(v.delta) < 0.01 ? '无调整' : fmt.money(v.delta)) + '</b>' },
                        { label: '复核理由', value: esc(v.reason || '—') + ' · ' + esc(v.operator || '—') }
                    ]) })
                ]),
                ui.desc([
                    { label: '复核时间', value: fmt.dateTime(v.auditedAt) },
                    { label: '结算流水', value: v.flowId ? ui.link(esc(v.flowId), 'fin:open') : (Math.abs(v.delta) >= 0.01 ? ui.badge('缺流水', 'danger') : dim('无差额不需流水')) },
                    { label: '当前运费', value: o ? fmt.money(o.freight) : dim('订单已归档') },
                    q ? { label: '现价卡复算', value: fmt.money(q.total) + ' <span class="tms-dim">（体积重 ' + q.volumetricWeight + ' kg / 计费重 ' + q.chargeableWeight + ' kg）</span>' } : null
                ].filter(Boolean)),
                o ? ui.notice('该票当前状态 ' + (TMS.cfg.orderLabels[o.status] || o.status) + '，付款方式 ' +
                    esc(o.paymentMethod || '') + '，应收 ' + fmt.money((TMS.finance.receivableOf(o.id) || {}).amount || 0) +
                    '。复核只改计费口径，收款动作仍走应收对账页。', 'info', '收款口径') : ''
            ]),
            footer: ui.btn('看订单', { tone: 'primary', act: 'order:open', arg: v.orderId }) +
                (o && !o.cancelled ? ui.btn('再复核一次', { act: 'rc:run', arg: v.orderId }) : '') +
                (Math.abs(v.delta) >= 0.01 && !v.flowId ? ui.btn('补记流水', { tone: 'warn', act: 'rc:flowfix', arg: v.id }) : '')
        });
    }

    function rcRunModal(orderId) {
        var o = db.get('orders', orderId);
        if (!o) { ui.toast('订单不存在或已归档', 'warn'); return; }
        if (o.status === 'cancelled') { ui.toast('已取消订单不可复核', 'warn'); return; }
        var ratio = Number(cfg.billing.defaultThrowRatio) || 6000;
        var act = Number(o.weight) || 0;
        var vol = util.round(TMS.pricing.volumeCm3(o.dims, o.pieces, act, o.goods) / ratio, 2);
        var suggest = util.round(Math.max(act, vol), 2);
        var preview = suggest > act ? TMS.pricing.reprice(o, { weight: suggest }) : null;
        var delta = preview ? util.money(preview.total - (Number(o.freight) || 0)) : 0;
        ui.formModal({
            title: '登记复磅', sub: '<span class="tms-mono">' + esc(o.waybillNo) + '</span> · ' + esc(TMS.order.customerName(o)),
            notice: '当前声明 ' + act + ' kg，体积重 ' + vol + ' kg（抛比 ' + ratio + '）。' +
                (preview ? '按 ' + suggest + ' kg 复磅，运费 ' + fmt.money(o.freight) + ' → ' + fmt.money(preview.total) + '，' +
                    (delta > 0 ? '向客户补收 ' : '退还客户 ') + fmt.money(Math.abs(delta))
                    : '体积重未超过实重，按计费重规则不会产生差额，复核仅用于留痕'),
            values: {
                actualWeight: suggest, dims: o.dims || '', reason: RC_REASONS[0],
                operator: actor(), waybill: o.waybillNo
            },
            fields: [
                { key: 'waybill', label: '运单号', type: 'static' },
                { key: 'actualWeight', label: '复磅实重(kg)', type: 'number', min: 0.01, required: true, hint: '计费重取实重与体积重大者' },
                { key: 'dims', label: '外箱尺寸(长x宽x高 cm)', placeholder: '如 60x40x40', hint: '留空则按品名密度折算体积' },
                { key: 'reason', label: '复核理由', type: 'select', required: true, options: ui.optionsOf(RC_REASONS) },
                { key: 'operator', label: '复核人', required: true }
            ],
            okText: '确认复核',
            onSubmit: function (data) {
                var res = TMS.finance.recheckWeight(o.id, {
                    actualWeight: Number(data.actualWeight) || act,
                    dims: String(data.dims || '').trim(),
                    reason: data.reason || RC_REASONS[0],
                    operator: data.operator || actor()
                });
                if (!res.ok) return res.message || '复核失败';
                var d = res.delta;
                ui.closeTop();
                ui.toast(Math.abs(d) < 0.01 ? '复核完成，运费无变化' :
                    '复核完成，' + (d > 0 ? '补收 ' : '退费 ') + fmt.money(Math.abs(d)), Math.abs(d) < 0.01 ? 'info' : 'success');
                rcModal(res.recheck.id);
            }
        });
    }

    /* 复磅台批量回传：按建议计费重一次性收口嫌疑票，真实系统里这是分拨扫描线的自动复磅 */
    function rcBatch(queue, limit) {
        var picked = queue.slice(0, Math.max(1, Number(limit) || 10));
        var done = 0, sum = 0;
        db.batch(function () {
            picked.forEach(function (x) {
                var res = TMS.finance.recheckWeight(x.id, {
                    actualWeight: x.suggestWeight, dims: x.dims, reason: '体积抽盘（批量复磅）', operator: actor()
                });
                if (res && res.ok) { done++; sum = util.money(sum + (res.delta || 0)); }
            });
        }, 'recheck:batch');
        TMS.audit.log('order.recheck', 'rechecks', '', '批量复磅 ' + done + ' 票，净差额 ' + fmt.money(sum), actor());
        return { done: done, sum: sum, tried: picked.length };
    }

    pg.define('audit', {
        sub: '计费复核：体积重与声明实重比对生成嫌疑队列，复磅后自动补收/退费并同步应收，差额逐笔对流水',
        load: function (ctx) {
            var rows = rcRows(ctx.days);
            var all = rcRows(0);
            var queue = rcQueue(ctx.days);
            var gaps = rcGaps(all);
            var signed = db.col('orders').filter(function (o) { return o.status === 'signed'; });
            var byDay = util.groupBy(rows, 'day');
            var days = util.sortBy(Object.keys(byDay).map(function (k) {
                return {
                    label: k.slice(5),
                    add: util.money(util.sum(byDay[k].filter(function (r) { return r.delta > 0; }), 'delta')),
                    back: util.money(util.sum(byDay[k].filter(function (r) { return r.delta < 0; }), 'delta'))
                };
            }), 'label', 'asc');
            var byCustomer = util.groupBy(rows, 'customer');
            var topCustomers = Object.keys(byCustomer).map(function (k) {
                var g = byCustomer[k];
                return {
                    label: k || '散客', value: util.money(util.sum(g, 'delta')), count: g.length,
                    pct: util.round(util.sum(g, 'weightPct') / g.length, 1),
                    back: util.money(util.sum(g.filter(function (r) { return r.delta < 0; }), 'delta'))
                };
            }).sort(function (a, b) { return Math.abs(b.value) - Math.abs(a.value); }).slice(0, 8);
            var byReason = util.countBy(rows, 'reason');
            return {
                rows: rows, all: all, queue: queue, gaps: gaps, days: days, topCustomers: topCustomers,
                byReason: Object.keys(byReason).map(function (k) { return { label: k || '未填', value: byReason[k] }; })
                    .sort(function (a, b) { return b.value - a.value; }),
                add: util.money(util.sum(rows.filter(function (r) { return r.delta > 0; }), 'delta')),
                back: util.money(util.sum(rows.filter(function (r) { return r.delta < 0; }), 'delta')),
                cover: signed.length ? util.round(util.unique(all.map(function (r) { return r.orderId; })).length / signed.length * 100, 1) : 0,
                avgPct: rows.length ? util.round(util.sum(rows, 'weightPct') / rows.length, 1) : 0,
                queueSum: util.money(util.sum(queue, 'delta')),
                big: queue.slice(0, 8)
            };
        },
        render: function (ctx, d) {
            var gapCount = d.gaps.noFlow.length + d.gaps.drift.length + d.gaps.stale.length;
            var kpi = ui.kpis([
                { label: '窗口复核', value: d.rows.length, unit: '票', icon: '✓', tone: d.rows.length ? 'brand' : 'muted', sub: '全库 ' + d.all.length + ' 票留痕' },
                { label: '补收', value: fmt.money(d.add), icon: '↗', tone: d.add ? 'success' : 'muted', sub: '体积重超声明实重' },
                { label: '退费', value: fmt.money(Math.abs(d.back)), icon: '↘', tone: d.back ? 'danger' : 'muted', sub: '多收退回，账上取负' },
                { label: '净影响', value: fmt.money(util.money(d.add + d.back)), icon: '◎', tone: (d.add + d.back) >= 0 ? 'success' : 'warn', sub: '直接进财务流水' },
                { label: '嫌疑待复核', value: d.queue.length, unit: '票', tone: d.queue.length > 30 ? 'warn' : 'muted', icon: '⚖', sub: '潜在补收 ' + fmt.money(d.queueSum) },
                { label: '均重偏差', value: fmt.percent(d.avgPct), icon: 'σ', tone: Math.abs(d.avgPct) > 15 ? 'warn' : 'muted', sub: '签收票复核覆盖 ' + fmt.percent(d.cover) }
            ]);
            var trendCard = ui.card({
                title: '补收与退费', sub: '柱：补收金额 · 线：退费金额（按复核日）', flat: true,
                body: d.days.length ? ch.combo({
                    labels: d.days.map(function (x) { return x.label; }),
                    bars: d.days.map(function (x) { return x.add; }),
                    line: d.days.map(function (x) { return Math.abs(x.back); }),
                    barName: '补收', lineName: '退费', height: 250, fmt: function (v) { return fmt.money(v); }
                }) : ui.empty('窗口内没有复核记录', '在下方队列里挑一票登记复磅')
            });
            var queueCard = ui.card({
                title: '复磅嫌疑队列',
                sub: '体积重超声明实重 2 kg 或 12% 以上即入队，按可补收金额排序（展示前 8 票，台账看全量）',
                tools: d.queue.length ? ui.btn('批量复磅 TOP10', { size: 'sm', tone: 'primary', act: 'rc:batch', icon: '⚡' }) : '',
                body: d.queue.length ? ui.table({
                    dense: true, keyName: 'id', rows: d.big,
                    columns: [
                        { key: 'waybillNo', label: '运单', width: '128px', render: function (r) { return idLink(r.id) + ' <span class="tms-mono tms-dim">' + esc(r.waybillNo.slice(-6)) + '</span>'; } },
                        { key: 'customer', label: '客户', render: function (r) {
                            return esc(r.customer) + '<div class="tms-dim">' + esc(r.origin + '→' + r.destination) + ' · ' + esc(r.goods || '') + ' ' + r.pieces + ' 件' + (r.hasDims ? '' : ' · 无尺寸') + '</div>';
                        } },
                        { key: 'declaredWeight', label: '声明/体积重', align: 'right', width: '124px', render: function (r) {
                            return r.declaredWeight + ' / ' + r.volumetricWeight + ' kg<div class="tms-dim">偏差 ' + ui.badge('+' + r.gapPct + '%', 'warn') + '</div>';
                        } },
                        { key: 'suggestWeight', label: '建议计费重', align: 'right', width: '104px', render: function (r) { return '<b>' + r.suggestWeight + '</b> kg'; } },
                        { key: 'delta', label: '可补收', align: 'right', width: '104px', render: function (r) { return '<span class="tms-money strong tone-success">' + fmt.money(r.delta) + '</span>'; } },
                        { key: 'ops', label: '操作', align: 'right', width: '86px', sortable: false, render: function (r) {
                            return ui.link('复磅', 'rc:run', r.id) + (r.margin < 0 ? ' ' + ui.badge('亏本票', 'danger') : '');
                        } }
                    ]
                }) : ui.empty('没有嫌疑票', '声明实重与体积重基本一致，或已全部复核', '✓')
            });
            var custCard = ui.card({
                title: '低报客户', sub: '按复核净影响排序，正值=补收多', flat: true,
                body: d.topCustomers.length ? ch.hbars({
                    data: d.topCustomers.map(function (x) {
                        return { label: x.label, value: Math.abs(x.value), sub: x.count + ' 票 · 均偏差 ' + (x.pct > 0 ? '+' : '') + x.pct + '%' };
                    }),
                    height: 250, rowH: 30, fmt: function (v) { return fmt.money(v); }
                }) : ui.empty('窗口内没有复核记录')
            });
            var reasonCard = ui.card({
                title: '复核理由与账实核对', sub: '差额必落流水、运费必同步应收', flat: true,
                tools: gapCount ? ui.btn('一键修复 ' + gapCount + ' 项', { size: 'sm', tone: 'warn', act: 'rc:repair', icon: '⟳' }) : '',
                body: ui.stack([
                    d.byReason.length ? ui.list(d.byReason.slice(0, 5).map(function (x) {
                        return { title: esc(x.label), sub: x.value + ' 票', right: '<div class="tms-dim">' + fmt.percent(util.round(x.value / Math.max(1, d.all.length) * 100, 1)) + '</div>' };
                    })) : ui.empty('还没有复核留痕', '复核是快运最容易漏收的口子'),
                    ui.desc([
                        { label: '差额缺流水', value: d.gaps.noFlow.length ? ui.badge(d.gaps.noFlow.length + ' 笔', 'danger') : ui.badge('0', 'success') },
                        { label: '应收未同步', value: d.gaps.drift.length ? ui.badge(d.gaps.drift.length + ' 笔', 'warn') : ui.badge('0', 'success') },
                        { label: '运费与复核不符', value: d.gaps.stale.length ? ui.badge(d.gaps.stale.length + ' 票', 'warn') : ui.badge('0', 'success') }
                    ])
                ])
            });
            var listCard = grid(ctx, {
                title: '复核台账', sub: d.all.length + ' 条复核留痕（窗口内 ' + d.rows.length + ' 条）',
                rows: d.rows, keyName: 'id', dense: true,
                filter: function (r, fs) {
                    if (fs.type && r.type !== fs.type) return false;
                    if (fs.reason && r.reason !== fs.reason) return false;
                    var c = fs.chip || '';
                    if (c === 'gap' && !(Math.abs(r.delta) >= 0.01 && !r.flowId)) return false;
                    if (c === 'over' && !(r.weightPct > 20)) return false;
                    if (c === 'net' && Math.abs(r.delta) < 0.01) return false;
                    return true;
                },
                search: function (r) { return [r.id, r.waybillNo, r.customer, r.reason, r.operator].join(' '); },
                valueOf: function (r, k) { return k === 'weightGap' ? r.weightGap : (k === 'weightPct' ? r.weightPct : r[k]); },
                chips: [
                    { label: '全部', value: '', count: d.rows.length },
                    { label: '有差额', value: 'net', count: d.rows.filter(function (r) { return Math.abs(r.delta) >= 0.01; }).length },
                    { label: '偏差超 20%', value: 'over', count: d.rows.filter(function (r) { return r.weightPct > 20; }).length },
                    { label: '缺流水', value: 'gap', count: d.rows.filter(function (r) { return Math.abs(r.delta) >= 0.01 && !r.flowId; }).length }
                ], chipsName: 'chip',
                fields: [
                    { key: 'type', label: '结果', options: [{ value: '', label: '全部' }].concat(ui.optionsOf(['补收', '退费', '一致'])) },
                    { key: 'reason', label: '理由', options: [{ value: '', label: '全部理由' }].concat(ui.optionsOf(util.unique(d.all.map(function (r) { return r.reason; })).filter(Boolean).sort())) }
                ],
                tools: ui.btn('按单号复核', { size: 'sm', act: 'rc:pick', icon: '⌕' }) +
                    ui.btn('导出', { size: 'sm', tone: 'ghost', act: 'rc:export', icon: '↓' }),
                columns: [
                    { key: 'id', label: '复核单', width: '112px', render: function (r) { return ui.idCell(r.id, 'rc:open'); } },
                    { key: 'waybillNo', label: '运单/客户', render: function (r) {
                        return idLink(r.orderId) + '<div class="tms-dim">' + esc(r.customer) + ' · ' + esc(r.reason || '') + '</div>';
                    } },
                    { key: 'originalWeight', label: '声明重', align: 'right', width: '92px', render: function (r) { return r.originalWeight + ' kg'; } },
                    { key: 'weightGap', label: '复磅偏差', align: 'right', width: '104px', render: function (r) {
                        if (!r.weightGap) return '<span class="tms-dim">一致</span>';
                        return '<span class="' + (r.weightGap > 0 ? 'tone-danger' : 'tone-success') + '">' + (r.weightGap > 0 ? '+' : '') + r.weightGap + ' kg</span>' +
                            '<div class="tms-dim">' + (r.weightPct > 0 ? '+' : '') + r.weightPct + '%</div>';
                    } },
                    { key: 'auditedChargeable', label: '计费重', align: 'right', width: '92px', render: function (r) { return r.auditedChargeable + ' kg'; } },
                    { key: 'originalFreight', label: '原运费', align: 'right', width: '100px', render: function (r) { return '<span class="tms-dim">' + fmt.money(r.originalFreight) + '</span>'; } },
                    { key: 'delta', label: '差额', align: 'right', width: '108px', render: function (r) {
                        if (Math.abs(r.delta) < 0.01) return statusBadge('一致', undefined);
                        return '<span class="tms-money strong ' + (r.delta > 0 ? 'tone-success' : 'tone-danger') + '">' + fmt.money(r.delta) + '</span>' +
                            (r.flowId ? '' : ' ' + ui.badge('缺流水', 'danger'));
                    } },
                    { key: 'auditedAt', label: '复核时间', align: 'right', width: '124px', render: function (r) { return ui.timeCell(r.auditedAt); } },
                    { key: 'ops', label: '操作', align: 'right', width: '96px', sortable: false, render: function (r) {
                        return ui.link('详情', 'rc:open', r.id, { tone: 'ghost' }) + ' ' + ui.link('再复核', 'rc:run', r.orderId, { tone: 'ghost' });
                    } }
                ],
                emptyText: '窗口内没有复核记录', emptySub: '下方队列里有嫌疑票可直接登记复磅'
            });
            return wrap(ctx, {
                actions: ui.btn('按单号复核', { tone: 'primary', act: 'rc:pick', icon: '⌕' }) +
                    (d.queue.length ? ui.btn('批量复磅 TOP10', { act: 'rc:batch', icon: '⚡' }) : ''),
                body: [kpi, queueCard, ui.split('2', [trendCard, custCard]), reasonCard, listCard]
            });
        },
        actions: {
            'rc:open': function (id) { rcModal(id); },
            'rc:run': function (id) { rcRunModal(id); },
            'rc:pick': function () {
                ui.formModal({
                    title: '按单号复核', sub: '扫描枪/客服工单里拿到的运单号直接进',
                    fields: [{ key: 'waybillNo', label: '运单号', required: true, placeholder: 'HL2026…', hint: '支持运单号或订单号' }],
                    values: { waybillNo: '' }, okText: '下一步',
                    onSubmit: function (data) {
                        var key = String(data.waybillNo || '').trim();
                        var o = db.get('orders', key) || db.findOne('orders', function (x) { return x.waybillNo === key; });
                        if (!o) return '找不到运单 ' + esc(key);
                        ui.closeTop();
                        rcRunModal(o.id);
                    }
                });
            },
            'rc:batch': function () {
                var q = rcQueue(curCtx().days);
                if (!q.length) { ui.toast('当前没有嫌疑票', 'info'); return; }
                var top = q.slice(0, 10);
                ui.confirm({
                    title: '批量复磅', okText: '按建议计费重复磅',
                    message: '将对 ' + top.length + ' 票按体积重直接登记复磅，预计净补收 ' + fmt.money(util.sum(top, 'delta')) + '。',
                    detail: '批量动作等同分拨复磅台回传，逐票生成复核留痕、差额流水与应收同步；客户月结前建议只做抽盘，别一次性改完。'
                }).then(function (yes) {
                    if (!yes) return;
                    var res = rcBatch(q, 10);
                    ui.toast('已复磅 ' + res.done + ' 票，净差额 ' + fmt.money(res.sum), 'success');
                    TMS.shell.refresh();
                });
            },
            'rc:flowfix': function (id) {
                var r = db.get('rechecks', id);
                if (!r) return;
                var v = rcView(r);
                if (Math.abs(v.delta) < 0.01) { ui.toast('该复核无差额，不需流水', 'info'); return; }
                var rec = TMS.finance.finRow('income', v.delta > 0 ? '运费复核补收' : '运费复核退费', {
                    orderId: v.orderId, amount: v.delta, date: v.auditedAt || util.iso(util.now()),
                    remark: '补记复核 ' + v.id + ' 差额'
                });
                db.commit('finances', rec.id, 'recheck:flowfix');
                TMS.audit.log('order.recheck', 'finances', rec.id, '补记复核 ' + v.id + ' 差额流水 ' + fmt.money(v.delta), actor());
                ui.toast('已补记 ' + fmt.money(v.delta), 'success');
                TMS.shell.refresh();
            },
            'rc:repair': function () {
                var gaps = rcGaps(rcRows(0));
                var total = gaps.noFlow.length + gaps.drift.length + gaps.stale.length;
                if (!total) { ui.toast('复核台账与流水、应收一致', 'info'); return; }
                ui.confirm({
                    title: '复核账实修复', danger: true, okText: '执行修复',
                    message: '将处理 ' + total + ' 项差异：补记 ' + gaps.noFlow.length + ' 笔差额流水、同步 ' + gaps.drift.length + ' 笔应收金额、回写 ' + gaps.stale.length + ' 票订单运费。',
                    detail: '三类差异都源于复核落库后下游没跟账。修复走领域方法逐笔提交，不会改动原始留痕。'
                }).then(function (yes) {
                    if (!yes) return;
                    var n = 0;
                    db.batch(function () {
                        gaps.noFlow.forEach(function (r) {
                            if (Math.abs(r.delta) < 0.01) return;
                            var rec = TMS.finance.finRow('income', r.delta > 0 ? '运费复核补收' : '运费复核退费', {
                                orderId: r.orderId, amount: r.delta, date: r.auditedAt, remark: '补记复核 ' + r.id + ' 差额'
                            });
                            db.commit('finances', rec.id, 'recheck:flowfix');
                            n++;
                        });
                        gaps.drift.forEach(function (x) {
                            db.update('receivables', x.receivableId, { amount: x.freight, adjustNote: '复核后同步运费口径' });
                            db.commit('receivables', x.receivableId, 'recheck:ar');
                            n++;
                        });
                        gaps.stale.forEach(function (r) {
                            var o = db.get('orders', r.orderId);
                            if (!o) return;
                            db.update('orders', o.id, { freight: r.auditedFreight, chargeableWeight: r.auditedChargeable, weight: r.auditedWeight });
                            db.commit('orders', o.id, 'recheck:order');
                            var rec = TMS.finance.receivableOf(o.id);
                            if (rec && rec.status !== 'paid') { db.update('receivables', rec.id, { amount: r.auditedFreight }); db.commit('receivables', rec.id, 'recheck:ar2'); }
                            n++;
                        });
                    }, 'recheck:repair');
                    TMS.audit.log('order.recheck', 'rechecks', '', '复核账实修复 ' + n + ' 项差异', actor());
                    ui.toast('已修复 ' + n + ' 项差异', 'success');
                    TMS.shell.refresh();
                });
            },
            'rc:export': function () {
                exportGrid({
                    name: '计费复核.csv', rows: rcRows(0),
                    filter: function (r, fs) { return !fs.type || r.type === fs.type; },
                    cols: [
                        { key: 'id', label: '复核单' }, { key: 'waybillNo', label: '运单号' },
                        { key: 'customer', label: '客户' }, { key: 'orderId', label: '订单号' },
                        { key: 'originalWeight', label: '声明实重' }, { key: 'auditedWeight', label: '复磅实重' },
                        { key: 'weightGap', label: '重量偏差' }, { key: 'weightPct', label: '偏差%' },
                        { key: 'originalChargeable', label: '原计费重' }, { key: 'auditedChargeable', label: '复核计费重' },
                        { key: 'originalFreight', label: '原运费' }, { key: 'auditedFreight', label: '复核后运费' },
                        { key: 'delta', label: '差额' }, { key: 'type', label: '结果' },
                        { key: 'reason', label: '理由' }, { key: 'operator', label: '复核人' },
                        { key: 'auditedAt', label: '复核时间' },
                        { key: 'flowId', label: '结算流水', value: function (r) { return r.flowId || (Math.abs(r.delta) >= 0.01 ? '缺失' : ''); } }
                    ]
                });
            }
        }
    });


    /* ---------- 二十二、网络规划 ---------- */

    var BRANCH_TEXT = { active: '营业中', suspended: '已停用', closed: '已撤并' };
    var HUB_TEXT = { active: '运行中', expanding: '扩容中', closed: '已停用' };

    /* 网点日均吞吐用「近 30 天揽派票量 / 30」现算，别用 dailyCapacity 反推——
       容量是档案值，常年不改，只有真实货量才说明它够不够用 */
    function branchView(b, net) {
        var daily = util.round(((net.outbound[b.id] || 0).length + (net.inbound[b.id] || 0).length) / 30, 1);
        var cap = Number(b.dailyCapacity) || 0;
        return {
            id: b.id, name: b.name, city: b.city, province: b.province, zone: b.zone, code: b.code,
            type: b.type || '直营网点', manager: b.manager || '', phone: b.phone || '', address: b.address || '',
            hubId: b.hubId, hubName: b.hubName || '', area: Number(b.area) || 0, staff: Number(b.staffCount) || 0,
            openAt: b.openAt || '', closeAt: b.closeAt || '', capacity: cap, status: b.status || 'active',
            outbound: (net.outbound[b.id] || []).length, inbound: (net.inbound[b.id] || []).length,
            daily: daily, load: cap ? util.round(daily / cap * 100, 1) : 0,
            perStaff: b.staffCount ? util.round(daily / b.staffCount, 1) : 0,
            areaPer: b.area ? util.round(cap / b.area, 1) : 0,
            revenue: util.money(util.sum((net.outbound[b.id] || []).concat(net.inbound[b.id] || []).filter(function (o) { return o.status === 'signed'; }), 'freight')),
            exceptions: (net.outbound[b.id] || []).concat(net.inbound[b.id] || []).reduce(function (s, o) { return s + (o.exceptionCount || 0); }, 0)
        };
    }

    function branchNet(days) {
        var list = TMS.stats.ordersWithin(days || 30);
        return {
            orders: list,
            outbound: util.groupBy(list, 'originBranchId'),
            inbound: util.groupBy(list, 'destBranchId')
        };
    }

    function networkGaps(rows, hubs) {
        var covered = {};
        db.col('branches').filter(function (b) { return b.status === 'active'; })
            .forEach(function (b) { covered[b.city] = true; });
        var blank = TMS.master.CITIES.filter(function (c) { return !covered[c.name]; });
        var overloaded = rows.filter(function (r) { return r.load > 100; });
        var idle = rows.filter(function (r) { return r.status === 'active' && r.daily === 0; });
        var burst = hubs.filter(function (x) { return x.utilization > 90; });
        var noHubBranch = rows.filter(function (r) { return r.hubId && !db.get('hubs', r.hubId); });
        var staffless = rows.filter(function (r) { return r.staff <= 2 && r.daily > 20; });
        return { blank: blank, overloaded: overloaded, idle: idle, burst: burst, noHubBranch: noHubBranch, staffless: staffless };
    }

    function hubModal(id) {
        var h = db.get('hubs', id);
        if (!h) { ui.toast('分拨中心不存在', 'warn'); return; }
        var ns = TMS.stats.networkStats(30);
        var row = ns.hubs.filter(function (x) { return x.id === h.id; })[0] || { tasks: 0, pieces: 0, utilization: 0 };
        var branches = db.col('branches').filter(function (b) { return b.hubId === h.id; });
        var lanes = db.col('trips').filter(function (t) { return t.fromHub === h.id || t.toHub === h.id; });
        var vehicles = db.col('vehicles').filter(function (v) { return v.hubId === h.id; });
        var orders = db.col('orders').filter(function (o) { return o.hubFrom === h.id || o.hubTo === h.id; });
        ui.modal({
            title: esc(h.name), size: 'wide',
            sub: esc(h.city) + ' · ' + esc(h.zone) + ' · ' + esc(h.role) + ' ' + statusBadge(h.status, HUB_TEXT),
            body: ui.split('side', [
                ui.stack([
                    ui.desc([
                        { label: '分拨编码', value: '<span class="tms-mono">' + esc(h.id) + '</span>' },
                        { label: '场地面积', value: fmt.number(h.areaM2) + ' m²' },
                        { label: '分拣线', value: (h.sortLines || 0) + ' 条' },
                        { label: '设计产能', value: fmt.number(h.capacityPieces) + ' 件/月' },
                        { label: '当前占用', value: fmt.number(h.usedPieces) + ' 件 · ' + ui.badge(fmt.percent(row.utilization) + ' 负荷', row.utilization > 90 ? 'danger' : (row.utilization > 70 ? 'warn' : 'success')) },
                        { label: '窗口分拣任务', value: row.tasks + ' 单 / ' + fmt.number(row.pieces) + ' 件' },
                        { label: '负责人', value: esc(h.manager || '—') + ' ' + esc(h.phone || '') },
                        { label: '地址', value: dim(h.address) }
                    ]),
                    ui.progress(row.utilization, { label: '产能占用', tone: row.utilization > 90 ? 'danger' : 'brand' })
                ]),
                ui.stack([
                    ui.card({
                        title: '网络关系', flat: true, body: ui.kpis([
                            { label: '归属网点', value: branches.length, unit: '个' },
                            { label: '干线班线', value: lanes.length, unit: '条' },
                            { label: '驻场车辆', value: vehicles.length, unit: '台' },
                            { label: '经手订单', value: orders.length, unit: '票' }
                        ])
                    }),
                    ui.card({
                        title: '覆盖网点', sub: '按揽收量排序', flat: true, body: branches.length ? ui.table({
                            dense: true, keyName: 'id', rows: util.sortBy(branches.map(function (b) {
                                return { id: b.id, name: b.name, city: b.city, dailyCapacity: b.dailyCapacity, status: b.status };
                            }), 'dailyCapacity', 'desc').slice(0, 8),
                            columns: [
                                { key: 'name', label: '网点', render: function (r) { return ui.link(esc(r.name), 'nw:branch', r.id); } },
                                { key: 'city', label: '城市', width: '80px' },
                                { key: 'dailyCapacity', label: '日容量', align: 'right', width: '84px', render: function (r) { return fmt.number(r.dailyCapacity); } }
                            ]
                        }) : ui.empty('该分拨暂无归属网点')
                    })
                ])
            ]),
            footer: ui.btn('维护分拨', { tone: 'primary', act: 'nw:hubEdit', arg: h.id }) +
                ui.btn('看车次', { act: 'nw:trip', arg: h.id })
        });
    }

    function hubEditModal(id) {
        var h = id ? db.get('hubs', id) : null;
        ui.formModal({
            title: h ? '维护分拨中心' : '新增分拨中心', sub: h ? esc(h.name) : '新枢纽需要配套产能与班次',
            values: h ? {
                name: h.name, city: h.city, zone: h.zone, role: h.role, areaM2: h.areaM2,
                capacityPieces: h.capacityPieces, sortLines: h.sortLines, manager: h.manager,
                phone: h.phone, address: h.address, status: h.status
            } : { city: '上海', zone: '华东', role: '区域枢纽', status: 'active', sortLines: 3, areaM2: 20000, capacityPieces: 60000 },
            fields: [
                { key: 'name', label: '分拨名称', required: true },
                { key: 'city', label: '所在城市', type: 'city', required: true },
                { key: 'zone', label: '所属大区', type: 'select', options: ui.optionsOf(TMS.master.ZONES) },
                { key: 'role', label: '枢纽层级', type: 'select', options: ui.optionsOf(['中心枢纽', '区域枢纽', '二级分拨']) },
                { key: 'areaM2', label: '场地面积(m²)', type: 'number', min: 100 },
                { key: 'capacityPieces', label: '月产能(件)', type: 'number', min: 1000, hint: '爆仓预警按占用/产能计算' },
                { key: 'sortLines', label: '分拣线(条)', type: 'number', min: 1, max: 20 },
                { key: 'manager', label: '负责人' },
                { key: 'phone', label: '联系电话' },
                { key: 'status', label: '状态', type: 'select', options: [{ value: 'active', label: '运行中' }, { value: 'expanding', label: '扩容中' }, { value: 'closed', label: '已停用' }] },
                { key: 'address', label: '地址', span: 2 }
            ],
            okText: '保存',
            onSubmit: function (data) {
                var city = TMS.network.cityInfo(data.city);
                var patch = {
                    name: String(data.name || '').trim(), city: city.name, zone: data.zone || city.zone,
                    role: data.role, areaM2: Number(data.areaM2) || 0, capacityPieces: Number(data.capacityPieces) || 0,
                    sortLines: Number(data.sortLines) || 1, manager: data.manager || '', phone: data.phone || '',
                    address: data.address || '', status: data.status, lat: city.lat, lng: city.lng
                };
                if (!patch.name) return '请填写分拨名称';
                var res = h ? db.update('hubs', h.id, patch) : db.create('hubs', patch);
                saveRow('hubs', res, 'hub:edit');
                TMS.network.invalidateCache();
                TMS.audit.log('network.update', 'hubs', res.id, (h ? '维护' : '新增') + '分拨 ' + res.name + '，产能 ' + fmt.number(res.capacityPieces) + ' 件', data.manager || actor());
                ui.toast('已保存分拨「' + res.name + '」', 'success');
                for (var i = 0; i < 2; i++) TMS.ui.closeTop();
            }
        });
    }

    function branchModal(id) {
        var b = db.get('branches', id);
        if (!b) { ui.toast('网点不存在', 'warn'); return; }
        var net = branchNet(30);
        var v = branchView(b, net);
        var trend = [];
        for (var i = 13; i >= 0; i--) {
            var key = util.dateKey(util.addDays(util.now(), -i));
            trend.push({
                label: key.slice(5),
                value: net.orders.filter(function (o) {
                    return (o.originBranchId === b.id || o.destBranchId === b.id) && util.dateKey(util.toDate(o.createdAt)) === key;
                }).length
            });
        }
        var staff = db.col('employees').filter(function (e) { return e.branchId === b.id; });
        var probs = net.orders.filter(function (o) { return (o.originBranchId === b.id || o.destBranchId === b.id) && o.status === 'problem'; });
        ui.modal({
            title: esc(v.name), size: 'wide',
            sub: esc(v.city) + ' · ' + esc(v.zone) + ' · ' + esc(v.type) + ' ' + statusBadge(v.status, BRANCH_TEXT),
            body: ui.split('side', [
                ui.stack([
                    ui.desc([
                        { label: '网点编码', value: '<span class="tms-mono">' + esc(v.id) + '</span>' },
                        { label: '归属分拨', value: v.hubId ? ui.link(esc(v.hubName || v.hubId), 'nw:hub', v.hubId) : dim('未挂分拨') },
                        { label: '营业时间', value: esc(v.openAt) + ' – ' + esc(v.closeAt) },
                        { label: '负责人', value: esc(v.manager || '—') + ' ' + esc(v.phone || '') },
                        { label: '场地/人员', value: v.area + ' m² / ' + v.staff + ' 人' },
                        { label: '日容量', value: fmt.number(v.capacity) + ' 件' },
                        { label: '日均吞吐', value: v.daily + ' 件（近 30 天揽派合计）' },
                        { label: '容量负荷', value: ui.badge(fmt.percent(v.load), v.load > 100 ? 'danger' : (v.load > 80 ? 'warn' : 'success')) + ' <span class="tms-dim">人均 ' + v.perStaff + ' 件/天</span>' },
                        { label: '地址', value: dim(v.address) }
                    ]),
                    v.load > 100 ? ui.notice('按近 30 天真实货量，该网点每天超出设计容量 ' + util.round(v.daily - v.capacity, 1) + ' 件，需要扩容或分流到同城网点。', 'danger', '容量超载') : ''
                ]),
                ui.stack([
                    ui.card({ title: '近 14 天吞吐', sub: '揽收 + 派送合计', flat: true, body: ch.line({ data: trend, height: 190, area: true, fmt: function (x) { return x + ' 件'; } }) }),
                    ui.card({ title: '经营口径', flat: true, body: ui.kpis([
                        { label: '揽收', value: v.outbound, unit: '票' },
                        { label: '派送', value: v.inbound, unit: '票' },
                        { label: '签收收入', value: fmt.money(v.revenue), tone: 'brand' },
                        { label: '异常', value: v.exceptions, unit: '起', tone: v.exceptions ? 'warn' : 'success' }
                    ]) })
                ])
            ]),
            footer: ui.btn('维护网点', { tone: 'primary', act: 'nw:branchEdit', arg: v.id }) +
                ui.btn('看在揽订单', { act: 'nw:orders', arg: v.id }) +
                (probs.length ? ui.btn('在途异常 ' + probs.length + ' 票', { tone: 'danger', act: 'nw:problem', arg: v.id }) : '')
        });
    }

    function branchEditModal(id) {
        var b = id ? db.get('branches', id) : null;
        ui.formModal({
            title: b ? '维护网点' : '新增网点', sub: b ? esc(b.name) : '新网点默认挂到所在城市分拨',
            notice: '改容量会立刻改变超载判定，改归属分拨会影响路由规划——保存后系统会清掉路由缓存。',
            values: b ? {
                name: b.name, city: b.city, type: b.type, manager: b.manager, phone: b.phone,
                hubId: b.hubId, area: b.area, staffCount: b.staffCount, dailyCapacity: b.dailyCapacity,
                openAt: b.openAt, closeAt: b.closeAt, status: b.status, address: b.address
            } : { city: '上海', type: '直营枢纽网点', status: 'active', openAt: '08:00', closeAt: '19:00', area: 200, staffCount: 5, dailyCapacity: 500 },
            fields: [
                { key: 'name', label: '网点名称', required: true },
                { key: 'city', label: '所在城市', type: 'city', required: true },
                { key: 'hubId', label: '归属分拨', type: 'select', options: [{ value: '', label: '自动按城市匹配' }].concat(ui.optionsOf(db.col('hubs'), 'id', 'name')) },
                { key: 'type', label: '网点类型', type: 'select', options: ui.optionsOf(colUnique('branches', 'type')) },
                { key: 'manager', label: '负责人' },
                { key: 'phone', label: '联系电话' },
                { key: 'area', label: '场地面积(m²)', type: 'number', min: 10 },
                { key: 'staffCount', label: '编制人数', type: 'number', min: 1 },
                { key: 'dailyCapacity', label: '日容量(件)', type: 'number', min: 10, required: true },
                { key: 'openAt', label: '开始营业', value: '08:00' },
                { key: 'closeAt', label: '结束营业', value: '19:00' },
                { key: 'status', label: '状态', type: 'select', options: [{ value: 'active', label: '营业中' }, { value: 'suspended', label: '已停用' }, { value: 'closed', label: '已撤并' }] },
                { key: 'address', label: '地址', span: 2 }
            ],
            okText: '保存',
            onSubmit: function (data) {
                var city = TMS.network.cityInfo(data.city);
                var hub = data.hubId ? db.get('hubs', data.hubId) : null;
                var patch = {
                    name: String(data.name || '').trim(), city: city.name, province: city.prov, zone: city.zone, code: city.code,
                    lat: city.lat, lng: city.lng, type: data.type, manager: data.manager || '', phone: data.phone || '',
                    hubId: hub ? hub.id : ((TMS.network.hubOf(city.name) || {}).id || ''),
                    hubName: hub ? hub.name : ((TMS.network.hubOf(city.name) || {}).name || ''),
                    area: Number(data.area) || 0, staffCount: Number(data.staffCount) || 1,
                    dailyCapacity: Number(data.dailyCapacity) || 0, openAt: data.openAt, closeAt: data.closeAt,
                    status: data.status, address: data.address || ''
                };
                if (!patch.name) return '请填写网点名称';
                if (patch.dailyCapacity <= 0) return '日容量必须大于 0';
                var res = b ? db.update('branches', b.id, patch) : db.create('branches', patch);
                saveRow('branches', res, 'branch:edit');
                TMS.network.invalidateCache();
                TMS.audit.log('network.update', 'branches', res.id, (b ? '维护' : '新增') + '网点 ' + res.name + '，日容量 ' + res.dailyCapacity + ' 件，归属 ' + res.hubName, actor());
                ui.toast('已保存网点「' + res.name + '」', 'success');
                for (var i = 0; i < 2; i++) TMS.ui.closeTop();
            }
        });
    }

    pg.define('network', {
        sub: '网络规划：分拨产能、网点容量与干线班次三方对照，空白市场与超载点在体检里直接列出',
        load: function (ctx) {
            applyParamFilter(ctx, ['zone', 'city']);
            var net = branchNet(Math.max(30, Number(ctx.days) || 7));
            var rows = db.col('branches').map(function (b) { return branchView(b, net); });
            var ns = TMS.stats.networkStats(Math.max(30, Number(ctx.days) || 7));
            var hubRows = ns.hubs.map(function (h) {
                return {
                    id: h.id, name: h.name, city: h.city, zone: h.zone, role: h.role, status: h.status,
                    sortLines: h.sortLines, tasks: h.tasks, pieces: h.pieces,
                    capacityPieces: h.capacityPieces, usedPieces: h.usedPieces, utilization: h.utilization
                };
            });
            var gaps = networkGaps(rows, hubRows);
            var matrix = TMS.master.ZONES.map(function (from) {
                return {
                    label: from,
                    values: TMS.master.ZONES.map(function (to) {
                        return net.orders.filter(function (o) {
                            return TMS.pricing.zoneOf(o.origin) === from && TMS.pricing.zoneOf(o.destination) === to;
                        }).length;
                    })
                };
            });
            var lanes = db.col('trips').filter(function (t) { return t.status === 'active'; });
            return {
                rows: rows, hubs: hubRows, gaps: gaps, matrix: matrix, net: net, lanes: lanes,
                active: rows.filter(function (r) { return r.status === 'active'; }),
                cityCover: util.unique(rows.filter(function (r) { return r.status === 'active'; }).map(function (r) { return r.city; })).length,
                totalCity: TMS.master.CITIES.length,
                top: util.sortBy(rows, 'daily', 'desc').slice(0, 8),
                dailyTotal: util.round(util.sum(rows, 'daily'), 0),
                laneByHub: lanes.length
            };
        },
        render: function (ctx, d) {
            var gapCount = d.gaps.blank.length + d.gaps.overloaded.length + d.gaps.burst.length + d.gaps.idle.length;
            var kpi = ui.kpis([
                { label: '网点', value: d.rows.length, unit: '个', icon: '⌖', sub: '营业中 ' + d.active.length + ' 个' },
                { label: '分拨中心', value: d.hubs.length, unit: '座', icon: '⛁', sub: '分拣线 ' + util.sum(d.hubs, 'sortLines') + ' 条' },
                { label: '干线班线', value: d.lanes.length, unit: '条', icon: '⇄', sub: '活动班次 ' + d.laneByHub + ' 条' },
                { label: '城市覆盖', value: fmt.percent(util.round(d.cityCover / Math.max(1, d.totalCity) * 100, 1)), icon: '◎', tone: d.gaps.blank.length ? 'warn' : 'success', sub: d.cityCover + '/' + d.totalCity + ' 城，空白 ' + d.gaps.blank.length },
                { label: '日均吞吐', value: fmt.number(d.dailyTotal), unit: '件', icon: '↕', tone: 'brand', sub: '窗口 ' + d.net.orders.length + ' 票在算' },
                { label: '网络体检', value: gapCount, unit: '项', tone: gapCount ? 'warn' : 'success', icon: '⚑', sub: '超载 ' + d.gaps.overloaded.length + ' · 爆仓 ' + d.gaps.burst.length }
            ]);
            var hubCard = ui.card({
                title: '分拨产能', sub: '占用件数 / 月产能，>90% 触发扩容评审', flat: true,
                tools: ui.btn('新增分拨', { size: 'sm', act: 'nw:hubNew', icon: '+' }),
                body: ui.table({
                    dense: true, keyName: 'id', rows: util.sortBy(d.hubs, 'utilization', 'desc'),
                    columns: [
                        { key: 'name', label: '分拨', render: function (r) { return ui.link(esc(r.name), 'nw:hub', r.id) + '<div class="tms-dim">' + esc(r.city) + ' · ' + esc(r.role) + '</div>'; } },
                        { key: 'sortLines', label: '线', align: 'right', width: '54px' },
                        { key: 'tasks', label: '任务', align: 'right', width: '72px', render: function (r) { return fmt.number(r.tasks); } },
                        { key: 'pieces', label: '件量', align: 'right', width: '88px', render: function (r) { return fmt.number(r.pieces); } },
                        { key: 'utilization', label: '产能占用', align: 'right', width: '156px', render: function (r) { return pctBar(r.utilization, { tone: r.utilization > 90 ? 'danger' : 'brand' }); } }
                    ]
                })
            });
            var matrixCard = ui.card({
                title: '区域流向矩阵', sub: '窗口内揽派票数：对角线是同城直送', flat: true,
                body: ch.heat({
                    cols: TMS.master.ZONES, rows: d.matrix, cell: 42
                })
            });
            var topCard = ui.card({
                title: '网点吞吐 TOP8', sub: '近 30 天日均件量', flat: true,
                body: ch.hbars({
                    data: d.top.map(function (r) { return { label: r.name, value: r.daily, sub: '负荷 ' + fmt.percent(r.load) }; }),
                    height: 250, rowH: 30, fmt: function (v) { return util.round(v, 0) + ' 件'; }
                })
            });
            var gapCard = ui.card({
                title: '网络体检', sub: '档案与真实货量对不上就是规划失误', tone: d.gaps.overloaded.length || d.gaps.burst.length ? 'danger' : '', flat: true,
                body: ui.list([
                    {
                        title: '未覆盖城市 ' + ui.badge(d.gaps.blank.length + ' 个', d.gaps.blank.length ? 'warn' : 'success'),
                        sub: d.gaps.blank.length ? d.gaps.blank.slice(0, 8).map(function (c) { return esc(c.name + '(' + c.zone + ')'); }).join('、') + (d.gaps.blank.length > 8 ? ' 等' : '') : '主数据城市已全部有网点',
                        right: d.gaps.blank.length ? ui.btn('去开网点', { size: 'sm', tone: 'ghost', act: 'nw:branchNew' }) : ''
                    },
                    {
                        title: '容量超载网点 ' + ui.badge(d.gaps.overloaded.length + ' 个', d.gaps.overloaded.length ? 'danger' : 'success'),
                        sub: d.gaps.overloaded.length ? d.gaps.overloaded.slice(0, 5).map(function (r) { return esc(r.name + ' ' + fmt.percent(r.load)); }).join('、') : '所有网点日均吞吐都在设计容量内',
                        right: d.gaps.overloaded.length ? ui.btn('调容量', { size: 'sm', tone: 'warn', act: 'nw:branchEdit', arg: d.gaps.overloaded[0].id }) : ''
                    },
                    {
                        title: '爆仓风险分拨 ' + ui.badge(d.gaps.burst.length + ' 座', d.gaps.burst.length ? 'danger' : 'success'),
                        sub: d.gaps.burst.length ? d.gaps.burst.map(function (h) { return esc(h.name + ' ' + fmt.percent(h.utilization)); }).join('、') + '，建议加线或分流' : '分拨产能占用均低于 90%',
                        right: d.gaps.burst.length ? ui.btn('扩容', { size: 'sm', tone: 'warn', act: 'nw:hubEdit', arg: d.gaps.burst[0].id }) : ''
                    },
                    {
                        title: '零吞吐营业网点 ' + ui.badge(d.gaps.idle.length + ' 个', d.gaps.idle.length ? 'warn' : 'success'),
                        sub: d.gaps.idle.length ? d.gaps.idle.slice(0, 5).map(function (r) { return esc(r.name); }).join('、') + '：档案在营但窗口内没有一票，考虑撤并或转代理' : '在营网点全部有业务量'
                    },
                    {
                        title: '人效偏低网点 ' + ui.badge(d.gaps.staffless.length + ' 个', d.gaps.staffless.length ? 'warn' : 'success'),
                        sub: d.gaps.staffless.length ? d.gaps.staffless.slice(0, 5).map(function (r) { return esc(r.name + ' ' + r.perStaff + ' 件/人'); }).join('、') : '小网点未出现高负荷'
                    }
                ])
            });
            var listCard = grid(ctx, {
                title: '网点台账', sub: d.rows.length + ' 个网点（容量、编制、真实吞吐对照）',
                rows: d.rows, keyName: 'id', dense: true,
                filter: function (r, fs) {
                    if (fs.zone && r.zone !== fs.zone) return false;
                    if (fs.city && r.city !== fs.city) return false;
                    if (fs.type && r.type !== fs.type) return false;
                    var c = fs.chip || '';
                    if (c === 'over' && r.load <= 100) return false;
                    if (c === 'idle' && !(r.status === 'active' && r.daily === 0)) return false;
                    if (c === 'stop' && r.status === 'active') return false;
                    if (c === 'hub' && r.hubId !== fs.hub) return false;
                    return true;
                },
                search: function (r) { return [r.id, r.name, r.city, r.manager, r.hubName].join(' '); },
                valueOf: function (r, k) { return k === 'load' ? r.load : (k === 'daily' ? r.daily : (k === 'perStaff' ? r.perStaff : r[k])); },
                chips: [
                    { label: '全部', value: '', count: d.rows.length },
                    { label: '超载', value: 'over', count: d.gaps.overloaded.length },
                    { label: '零吞吐', value: 'idle', count: d.gaps.idle.length },
                    { label: '停用/撤并', value: 'stop', count: d.rows.filter(function (r) { return r.status !== 'active'; }).length }
                ], chipsName: 'chip',
                fields: [
                    { key: 'zone', label: '大区', options: [{ value: '', label: '全部大区' }].concat(ui.optionsOf(TMS.master.ZONES)) },
                    { key: 'city', label: '城市', options: [{ value: '', label: '全部城市' }].concat(ui.optionsOf(util.unique(d.rows.map(function (r) { return r.city; })).sort())) },
                    { key: 'type', label: '类型', options: [{ value: '', label: '全部类型' }].concat(ui.optionsOf(colUnique('branches', 'type'))) }
                ],
                tools: ui.btn('新增网点', { size: 'sm', tone: 'primary', act: 'nw:branchNew', icon: '+' }) +
                    ui.btn('导出', { size: 'sm', tone: 'ghost', act: 'nw:export', icon: '↓' }),
                columns: [
                    { key: 'name', label: '网点', render: function (r) {
                        return ui.link(esc(r.name), 'nw:branch', r.id) + '<div class="tms-dim">' + esc(r.city) + ' · ' + esc(r.type) + ' · ' + esc(r.hubName || '未挂分拨') + '</div>';
                    } },
                    { key: 'zone', label: '大区', width: '72px' },
                    { key: 'manager', label: '负责人', width: '104px', render: function (r) { return dim(r.manager); } },
                    { key: 'staff', label: '人数', align: 'right', width: '68px', render: function (r) { return r.staff + ' 人'; } },
                    { key: 'daily', label: '日均吞吐', align: 'right', width: '96px', render: function (r) { return r.daily + ' 件'; } },
                    { key: 'capacity', label: '容量', align: 'right', width: '84px', render: function (r) { return '<span class="tms-dim">' + fmt.number(r.capacity) + '</span>'; } },
                    { key: 'load', label: '负荷', align: 'right', width: '150px', render: function (r) {
                        return pctBar(r.load, { tone: r.load > 100 ? 'danger' : (r.load > 80 ? 'warn' : 'success') });
                    } },
                    { key: 'exceptions', label: '异常', align: 'right', width: '68px', render: function (r) { return r.exceptions ? ui.badge(r.exceptions + ' 起', 'warn') : '<span class="tms-dim">0</span>'; } },
                    { key: 'status', label: '状态', align: 'right', width: '84px', sortable: false, render: function (r) { return statusBadge(r.status, BRANCH_TEXT); } },
                    { key: 'ops', label: '操作', align: 'right', width: '104px', sortable: false, render: function (r) {
                        return ui.link('详情', 'nw:branch', r.id, { tone: 'ghost' }) + ' ' + ui.link('维护', 'nw:branchEdit', r.id, { tone: 'ghost' });
                    } }
                ],
                emptyText: '没有符合条件的网点'
            });
            return wrap(ctx, {
                actions: ui.btn('新增网点', { tone: 'primary', act: 'nw:branchNew', icon: '+' }) + ui.btn('新增分拨', { act: 'nw:hubNew', icon: '+' }),
                body: [kpi, hubCard, ui.split('2', [matrixCard, topCard]), gapCard, listCard]
            });
        },
        actions: {
            'nw:branch': function (id) { branchModal(id); },
            'nw:branchEdit': function (id) { branchEditModal(id); },
            'nw:branchNew': function () { branchEditModal(''); },
            'nw:hub': function (id) { hubModal(id); },
            'nw:hubEdit': function (id) { hubEditModal(id); },
            'nw:hubNew': function () { hubEditModal(''); },
            'nw:trip': function (hubId) {
                ui.closeTop();
                TMS.shell.go('transport', { hub: hubId });
            },
            'nw:orders': function (id) { ui.closeTop(); TMS.shell.go('order', { branchId: id }); },
            'nw:problem': function (id) { ui.closeTop(); TMS.shell.go('exception', { branchId: id }); },
            'nw:export': function () {
                exportGrid({
                    name: '网络台账.csv', rows: db.col('branches').map(function (b) { return branchView(b, branchNet(30)); }),
                    filter: function (r, fs) { return !fs.zone || r.zone === fs.zone; },
                    cols: [
                        { key: 'id', label: '网点编码' }, { key: 'name', label: '网点' }, { key: 'city', label: '城市' },
                        { key: 'zone', label: '大区' }, { key: 'type', label: '类型' }, { key: 'hubName', label: '归属分拨' },
                        { key: 'manager', label: '负责人' }, { key: 'phone', label: '电话' },
                        { key: 'staff', label: '编制' }, { key: 'area', label: '面积m²' },
                        { key: 'capacity', label: '日容量' }, { key: 'daily', label: '日均吞吐' },
                        { key: 'load', label: '负荷%' }, { key: 'perStaff', label: '人均件量' },
                        { key: 'outbound', label: '揽收票' }, { key: 'inbound', label: '派送票' },
                        { key: 'revenue', label: '签收收入' }, { key: 'exceptions', label: '异常起' },
                        { key: 'status', label: '状态', value: function (r) { return BRANCH_TEXT[r.status] || r.status; } },
                        { key: 'address', label: '地址' }
                    ]
                });
            }
        }
    });

    /* ---------- 二十三、客户合同 ---------- */

    var SETTLE_TEXT = { 现付: '现结', 到付: '货到收款', 半月结: 'T+15', 月结: 'T+30', 季结: 'T+90' };

    function custView(c, agg) {
        var a = agg[c.id] || { orders: [], signed: [], revenue: 0, profit: 0, ar: 0, over: 0, exc: 0 };
        var limit = Number(c.creditLimit) || 0;
        var to = util.toDate(c.contractTo);
        var leftDays = util.round(util.hoursBetween(util.now(), to) / 24, 0);
        var level = cfg.customerLevels.filter(function (l) { return l.level === c.level; })[0] || { discount: 0, creditLimit: 0, settleCycle: c.settleCycle };
        return {
            id: c.id, name: c.name, shortName: c.shortName || '', level: c.level || 'C',
            levelName: c.levelName || (level.name || ''), industry: c.industry || '', city: c.city || '',
            province: c.province || '', zone: c.zone || '', contact: c.contact || '', phone: c.phone || '',
            email: c.email || '', settleCycle: c.settleCycle || '现付', settleText: SETTLE_TEXT[c.settleCycle] || c.settleCycle || '现付',
            discount: util.round((Number(c.discountRate) || 0) * 100, 1), creditLimit: limit,
            monthlyVolume: Number(c.monthlyVolume) || 0, contractFrom: c.contractFrom || '', contractTo: c.contractTo || '',
            leftDays: leftDays, expiring: leftDays <= 60 && leftDays >= 0, expired: leftDays < 0,
            status: c.status || 'active', points: Number(c.points) || 0, senderAddress: c.senderAddress || '',
            orders: a.orders.length, signed: a.signed.length, revenue: a.revenue, profit: a.profit,
            margin: a.revenue ? util.round(a.profit / a.revenue * 100, 1) : 0,
            avgFreight: a.signed.length ? util.round(a.revenue / a.signed.length, 2) : 0,
            arPending: a.ar, overdue: a.over, exceptions: a.exc,
            excRate: a.orders.length ? util.round(a.exc / a.orders.length * 100, 1) : 0,
            usage: limit ? util.round(a.ar / limit * 100, 1) : 0,
            overLimit: limit > 0 && a.ar > limit,
            late: a.signed.filter(function (o) { return TMS.order.isSignedLate(o); }).length,
            onTime: a.signed.length ? util.round((a.signed.length - a.signed.filter(function (o) { return TMS.order.isSignedLate(o); }).length) / a.signed.length * 100, 1) : 100
        };
    }

    /* 客户聚合一次算完：分级/排行/台账都读同一份，避免同一指标在页面上出现两个值 */
    function custAgg() {
        var byCust = util.groupBy(db.col('orders'), 'customerId');
        var arBy = util.groupBy(db.col('receivables'), 'customerId');
        var agg = {};
        db.col('customers').forEach(function (c) {
            var list = byCust[c.id] || [];
            var signed = list.filter(function (o) { return o.status === 'signed'; });
            var ar = arBy[c.id] || [];
            var pend = ar.filter(function (r) { return r.status === 'pending'; });
            agg[c.id] = {
                orders: list, signed: signed,
                revenue: util.money(util.sum(signed, 'freight')),
                profit: util.money(util.sum(signed, TMS.order.profitOf)),
                ar: util.money(util.sum(pend, 'amount')),
                over: util.money(util.sum(pend.filter(function (r) { return util.toDate(r.dueDate) < util.now(); }), 'amount')),
                exc: list.reduce(function (s, o) { return s + (o.exceptionCount || 0); }, 0)
            };
        });
        return agg;
    }

    function custGaps(rows) {
        var expiredActive = rows.filter(function (r) { return r.expired && r.status === 'active'; });
        var levelOff = rows.filter(function (r) {
            var std = cfg.customerLevels.filter(function (l) { return l.level === r.level; })[0];
            return !!std && util.round(r.discount, 1) !== util.round(std.discount * 100, 1);
        });
        var creditOff = rows.filter(function (r) {
            var std = cfg.customerLevels.filter(function (l) { return l.level === r.level; })[0];
            return !!std && std.creditLimit > 0 && !r.creditLimit;
        });
        var noContact = rows.filter(function (r) { return !r.contact || !r.phone; });
        var zero = rows.filter(function (r) { return r.status === 'active' && !r.orders; });
        return { expiredActive: expiredActive, levelOff: levelOff, creditOff: creditOff, noContact: noContact, zero: zero };
    }

    function custCreditModal(id) {
        var c = db.get('customers', id);
        if (!c) return;
        var v = custView(c, custAgg());
        ui.formModal({
            title: '调整授信', sub: esc(v.name) + ' · 当前额度 ' + fmt.money(v.creditLimit), danger: v.overLimit,
            notice: '授信是「未收账款上限」，不是评级。调低不会立即停发，但逾期客户必须先收回额度再放新单。',
            values: { creditLimit: v.creditLimit, reason: '', operator: actor() },
            fields: [
                { key: 'creditLimit', label: '新授信额度(元)', type: 'number', min: 0, required: true, hint: '当前未收 ' + fmt.money(v.arPending) + '，逾期 ' + fmt.money(v.overdue) },
                { key: 'reason', label: '调整依据', type: 'textarea', rows: 2, span: 2, required: true, placeholder: '回款记录/新增合同量/风控要求' },
                { key: 'operator', label: '经办人', required: true }
            ],
            okText: '保存额度',
            onSubmit: function (data) {
                var limit = util.money(Number(data.creditLimit) || 0);
                if (String(data.reason || '').trim().length < 4) return '请填写调整依据';
                db.update('customers', c.id, { creditLimit: limit });
                saveRow('customers', c, 'customer:credit');
                TMS.audit.log('customer.credit', 'customers', c.id, '授信 ' + fmt.money(v.creditLimit) + ' → ' + fmt.money(limit) + '：' + data.reason, data.operator || actor());
                ui.toast('已更新授信额度为 ' + fmt.money(limit), 'success');
                for (var i = 0; i < 2; i++) TMS.ui.closeTop();
            }
        });
    }

    function custContractModal(id) {
        var c = db.get('customers', id);
        if (!c) return;
        var v = custView(c, custAgg());
        var std = cfg.customerLevels.filter(function (l) { return l.level === c.level; })[0] || {};
        ui.formModal({
            title: '续签合同', sub: esc(v.name) + ' · 现合同 ' + fmt.date(v.contractFrom) + ' → ' + fmt.date(v.contractTo),
            notice: '折扣与账期都会直接改报价：折扣走 discountRate，账期决定应收到期日。等级变更建议同步标准折扣。',
            values: {
                level: c.level, discountRate: v.discount, settleCycle: c.settleCycle,
                from: v.contractFrom || util.dateKey(util.now()), to: util.dateKey(util.addDays(util.now(), 365)),
                monthlyVolume: v.monthlyVolume, status: c.status, operator: actor()
            },
            fields: [
                { key: 'level', label: '客户等级', type: 'select', required: true, options: ui.optionsOf(cfg.customerLevels, 'level', 'level') },
                { key: 'discountRate', label: '协议折扣(%)', type: 'number', min: 0, max: 40, required: true, hint: '等级标准 ' + util.round((std.discount || 0) * 100, 1) + '%' },
                { key: 'settleCycle', label: '结算周期', type: 'select', required: true, options: ui.optionsOf(Object.keys(SETTLE_TEXT)) },
                { key: 'monthlyVolume', label: '承诺月均票量', type: 'number', min: 0 },
                { key: 'from', label: '合同起始', type: 'date', required: true },
                { key: 'to', label: '合同到期', type: 'date', required: true },
                { key: 'status', label: '合作状态', type: 'select', options: [{ value: 'active', label: '合作中' }, { value: 'suspended', label: '已停用' }] },
                { key: 'operator', label: '经办人', required: true }
            ],
            okText: '续签',
            onSubmit: function (data) {
                var from = util.toDate(data.from), to = util.toDate(data.to);
                if (!data.from || !data.to) return '请填写合同起止日期';
                if (to.getTime() <= from.getTime()) return '到期日期必须晚于起始日期';
                var disc = util.round(Number(data.discountRate) || 0, 1);
                var std2 = cfg.customerLevels.filter(function (l) { return l.level === data.level; })[0] || {};
                if (disc > util.round((std2.discount || 0) * 100, 1) + 3 && disc > 0) {
                    return '折扣 ' + disc + '% 超过 ' + data.level + ' 级标准 ' + util.round((std2.discount || 0) * 100, 1) + '% 三以上，请先走商务审批';
                }
                db.update('customers', c.id, {
                    level: data.level, levelName: std2.name || c.levelName,
                    discountRate: util.round(disc / 100, 4), settleCycle: data.settleCycle,
                    monthlyVolume: Number(data.monthlyVolume) || 0,
                    contractFrom: util.dateKey(from), contractTo: util.dateKey(to), status: data.status
                });
                saveRow('customers', c, 'customer:contract');
                TMS.audit.log('customer.contract', 'customers', c.id,
                    '续签合同 ' + util.dateKey(from) + '→' + util.dateKey(to) + '，等级 ' + data.level + '，折扣 ' + disc + '%，账期 ' + data.settleCycle,
                    data.operator || actor());
                ui.toast('已续签「' + c.name + '」至 ' + util.dateKey(to), 'success');
                for (var i = 0; i < 2; i++) TMS.ui.closeTop();
            }
        });
    }

    /* 客户催收：逾期是客户级风险，逐票催没有意义——按客户拉清单、定口径、登记动作 */
    function custUrgeStance(maxOver) {
        if (maxOver > 60) return { tone: 'danger', text: '逾期超 60 天：先冻结赊账揽收，转法务发函，回款前只接现付单。' };
        if (maxOver > 30) return { tone: 'danger', text: '逾期超 30 天：暂停月结额度，要求承诺回款日并转货到付款。' };
        if (maxOver > 0) return { tone: 'warn', text: '账期内刚逾期：由客户经理电话催收，登记承诺付款日即可，不必停服。' };
        return { tone: 'success', text: '无逾期：按账期正常对账，催收动作留空。' };
    }

    function custUrgeModal(id) {
        var c = db.get('customers', id);
        if (!c) { ui.toast('客户不存在', 'warn'); return; }
        var rows = arRows(0).filter(function (r) { return r.customerId === id && r.status === 'pending'; });
        var over = rows.filter(function (r) { return r.over; });
        var maxOver = over.length ? util.round(Math.max.apply(null, over.map(function (r) { return r.overDays; })), 0) : 0;
        var stance = custUrgeStance(maxOver);
        var limit = Number(c.creditLimit) || 0;
        var pendingAmount = util.money(util.sum(rows, 'amount'));
        ui.modal({
            title: '催收 · ' + esc(c.name), size: 'wide',
            sub: c.settleCycle + ' · ' + (c.contact || '无联系人') + (c.phone ? ' · ' + c.phone : '') + ' ' + statusBadge(c.status, CUSTOMER_TEXT),
            body: ui.stack([
                ui.kpis([
                    { label: '未回款', value: fmt.money(pendingAmount), sub: rows.length + ' 笔' },
                    { label: '其中逾期', value: fmt.money(util.money(util.sum(over, 'amount'))), tone: over.length ? 'danger' : '', sub: over.length + ' 笔' },
                    { label: '最长逾期', value: maxOver + ' 天', tone: maxOver > 30 ? 'danger' : (maxOver > 0 ? 'warn' : '') },
                    { label: '授信占用', value: limit ? fmt.percent(util.round(pendingAmount / limit * 100, 1)) : '未设额度', tone: limit && pendingAmount > limit ? 'danger' : '', sub: limit ? '额度 ' + fmt.money(limit) : '月结客户应有额度' }
                ]),
                rows.length ? ui.table({
                    dense: true, keyName: 'id', rows: util.sortBy(rows, 'dueDate', 'asc'),
                    columns: [
                        { key: 'waybillNo', label: '运单号', render: function (r) { return esc(r.waybillNo || r.orderId) + ' <span class="tms-dim">' + esc(r.period) + '</span>'; } },
                        { key: 'amount', label: '应收', align: 'right', width: '104px', render: function (r) { return ui.moneyCell(r.amount); } },
                        { key: 'date', label: '记账日', width: '96px' },
                        { key: 'dueDate', label: '到期日', width: '96px' },
                        { key: 'overDays', label: '逾期', align: 'right', width: '84px', render: function (r) { return r.over ? ui.badge(util.round(r.overDays, 0) + ' 天', r.overDays > 60 ? 'danger' : 'warn') : '<span class="tms-dim">账期内</span>'; } },
                        { key: 'urgedAt', label: '最近催收', width: '110px', render: function (r) { return r.urgedAt ? esc(r.urgedAt) + (r.urgeNote ? ' <span class="tms-dim">' + esc(r.urgeNote) + '</span>' : '') : '<span class="tms-dim">未催收</span>'; } }
                    ]
                }) : ui.empty('该客户没有未回款应收', '账期已结清'),
                ui.notice(stance.text, stance.tone, '催收口径')
            ]),
            footer: ui.btn('登记催收动作', { tone: 'primary', size: 'sm', act: 'cust:urgeLog', arg: c.id }) +
                ui.btn('看应收台账', { size: 'sm', act: 'cust:ar', arg: c.id }) +
                ui.btn('关闭', { size: 'sm', act: 'ui:close' })
        });
    }

    function custUrgeLogModal(id) {
        var c = db.get('customers', id);
        if (!c) { ui.toast('客户不存在', 'warn'); return; }
        var rows = arRows(0).filter(function (r) { return r.customerId === id && r.status === 'pending'; });
        if (!rows.length) { ui.toast('该客户没有未回款应收，无需催收', 'info'); return; }
        var over = rows.filter(function (r) { return r.over; });
        ui.formModal({
            title: '登记催收', sub: esc(c.name) + ' · ' + rows.length + ' 笔未回款（其中 ' + over.length + ' 笔逾期）',
            fields: [
                { key: 'method', label: '催收方式', type: 'select', required: true, options: ui.optionsOf(['电话', '邮件', '上门', '对账会', '法务函']) },
                { key: 'result', label: '客户反馈', type: 'select', required: true, options: ui.optionsOf(['承诺付款', '部分付款', '争议挂起', '无回应']) },
                { key: 'promiseDate', label: '承诺付款日', type: 'date', tip: '「承诺付款」必填，到期未回款自动升级催收档位' },
                { key: 'amount', label: '本次承诺回款', type: 'number', min: 0, unit: '元' },
                { key: 'note', label: '备注', type: 'textarea', placeholder: '争议内容、对接人、下一步动作' },
                { key: 'operator', label: '经办人', required: true }
            ],
            values: { operator: actor(), amount: util.money(util.sum(over, 'amount')) },
            okText: '登记并写回台账',
            onSubmit: function (data) {
                if (data.result === '承诺付款' && !data.promiseDate) return '承诺付款必须填承诺付款日';
                if (!data.method || !data.result) return '请选择催收方式和客户反馈';
                var day = util.dateKey(util.now());
                var text = data.method + '·' + data.result + (data.promiseDate ? '·承诺 ' + data.promiseDate : '') + (data.note ? '·' + data.note : '');
                db.batch(function () {
                    rows.forEach(function (r) {
                        db.update('receivables', r.id, { urgedAt: day, urgeNote: text });
                        saveRow('receivables', { id: r.id }, 'customer:urge');
                    });
                }, 'customer:urge');
                TMS.audit.log('customer.urge', 'customers', c.id,
                    text + '，覆盖 ' + rows.length + ' 笔未回款 ' + fmt.money(util.money(util.sum(rows, 'amount'))),
                    data.operator || actor());
                ui.toast('已登记催收，写回 ' + rows.length + ' 笔应收', 'success');
                for (var i = 0; i < 2; i++) TMS.ui.closeTop();
            }
        });
    }

    pg.define('customer', {
        sub: '客户合同：等级/折扣/账期/授信四项契约口径，配合真实票量、毛利与回款表现一起看',
        load: function (ctx) {
            applyParamFilter(ctx, ['level', 'zone']);
            var agg = custAgg();
            var rows = db.col('customers').map(function (c) { return custView(c, agg); });
            var gaps = custGaps(rows);
            var byLevel = util.groupBy(rows, 'level');
            var levels = cfg.customerLevels.map(function (l) {
                var g = byLevel[l.level] || [];
                return {
                    label: l.level + ' ' + l.name, value: util.money(util.sum(g, 'revenue')), count: g.length,
                    discount: util.round(l.discount * 100, 1), cycle: l.settleCycle, limit: l.creditLimit,
                    profit: util.money(util.sum(g, 'profit')), ar: util.money(util.sum(g, 'arPending'))
                };
            });
            var byCycle = util.groupBy(rows, 'settleCycle');
            var cycles = Object.keys(byCycle).map(function (k) {
                var g = byCycle[k];
                return {
                    label: k, count: g.length, revenue: util.money(util.sum(g, 'revenue')),
                    ar: util.money(util.sum(g, 'arPending')), over: util.money(util.sum(g, 'overdue')),
                    margin: util.sum(g, 'revenue') ? util.round(util.sum(g, 'profit') / util.sum(g, 'revenue') * 100, 1) : 0
                };
            }).sort(function (a, b) { return b.ar - a.ar; });
            var top = util.sortBy(rows, 'revenue', 'desc').slice(0, 8);
            var risk = util.sortBy(rows.filter(function (r) { return r.overdue > 0 || r.overLimit; }), 'overdue', 'desc').slice(0, 8);
            return {
                rows: rows, gaps: gaps, levels: levels, cycles: cycles, top: top, risk: risk, agg: agg,
                active: rows.filter(function (r) { return r.status === 'active'; }),
                expiring: rows.filter(function (r) { return r.expiring; }),
                expired: rows.filter(function (r) { return r.expired; }),
                revenue: util.money(util.sum(rows, 'revenue')), profit: util.money(util.sum(rows, 'profit')),
                ar: util.money(util.sum(rows, 'arPending')), over: util.money(util.sum(rows, 'overdue'))
            };
        },
        render: function (ctx, d) {
            var margin = d.revenue ? util.round(d.profit / d.revenue * 100, 1) : 0;
            var kpi = ui.kpis([
                { label: '客户数', value: d.rows.length, unit: '家', icon: '☗', sub: '合作中 ' + d.active.length + ' 家' },
                { label: '累计收入', value: fmt.money(d.revenue), tone: 'brand', icon: '↗', sub: '毛利 ' + fmt.money(d.profit) + ' · ' + fmt.percent(margin) },
                { label: '未回款', value: fmt.money(d.ar), unit: '元', tone: d.ar ? 'warn' : 'success', icon: '○', sub: '占用授信 ' + fmt.percent(util.round(d.ar / Math.max(1, util.sum(d.rows, 'creditLimit')) * 100, 1)) },
                { label: '逾期客户', value: d.risk.filter(function (r) { return r.overdue > 0; }).length, unit: '家', tone: d.over ? 'danger' : 'success', icon: '⚠', sub: '逾期金额 ' + fmt.money(d.over) },
                { label: '合同将到期', value: d.expiring.length, unit: '家', tone: d.expiring.length ? 'warn' : 'muted', icon: '◷', sub: '60 天内，已过期 ' + d.expired.length },
                { label: '契约体检', value: d.gaps.levelOff.length + d.gaps.expiredActive.length + d.gaps.creditOff.length + d.gaps.noContact.length, unit: '项', tone: 'muted', icon: '⚑', sub: '折扣/额度/联系人不一致' }
            ]);
            var levelCard = ui.card({
                title: '等级契约', sub: '标准折扣与实际收入对照', flat: true,
                body: ui.table({
                    dense: true, keyName: 'label', rows: d.levels,
                    columns: [
                        { key: 'label', label: '等级' },
                        { key: 'count', label: '家数', align: 'right', width: '68px' },
                        { key: 'discount', label: '标准折扣', align: 'right', width: '88px', render: function (r) { return fmt.percent(r.discount); } },
                        { key: 'cycle', label: '标准账期', width: '84px' },
                        { key: 'value', label: '收入', align: 'right', width: '112px', render: function (r) { return ui.moneyCell(r.value); } },
                        { key: 'profit', label: '毛利', align: 'right', width: '108px', render: function (r) { return fmt.money(r.profit); } },
                        { key: 'ar', label: '未回款', align: 'right', width: '108px', render: function (r) { return r.ar ? fmt.money(r.ar) : '<span class="tms-dim">—</span>'; } }
                    ]
                })
            });
            var cycleCard = ui.card({
                title: '账期与现金流', sub: '到付/月结占用现金的差别', flat: true,
                body: ui.table({
                    dense: true, keyName: 'label', rows: d.cycles,
                    columns: [
                        { key: 'label', label: '结算周期', render: function (r) { return esc(r.label) + ' <span class="tms-dim">' + esc(SETTLE_TEXT[r.label] || '') + '</span>'; } },
                        { key: 'count', label: '客户', align: 'right', width: '68px' },
                        { key: 'revenue', label: '收入', align: 'right', width: '112px', render: function (r) { return fmt.money(r.revenue); } },
                        { key: 'ar', label: '未回款', align: 'right', width: '108px', render: function (r) { return fmt.money(r.ar); } },
                        { key: 'over', label: '其中逾期', align: 'right', width: '108px', render: function (r) { return r.over ? '<span class="tone-danger">' + fmt.money(r.over) + '</span>' : '<span class="tms-dim">—</span>'; } },
                        { key: 'margin', label: '毛利率', align: 'right', width: '132px', render: function (r) { return rateBar(r.margin, { target: 18 }); } }
                    ]
                })
            });
            var topCard = ui.card({
                title: '收入 TOP8 客户', sub: '按签收运费', flat: true,
                body: ch.hbars({
                    data: d.top.map(function (r) { return { label: r.shortName || r.name, value: r.revenue, sub: r.orders + ' 票 · 毛利 ' + fmt.percent(r.margin) }; }),
                    height: 260, rowH: 30, fmt: function (v) { return fmt.money(v); }
                })
            });
            var riskCard = ui.card({
                title: '风险客户', sub: '逾期或超授信', tone: d.risk.length ? 'danger' : '', flat: true,
                tools: d.risk.length ? ui.btn('导出风险清单', { size: 'sm', tone: 'ghost', act: 'cust:exportRisk', icon: '↓' }) : '',
                body: d.risk.length ? ui.list(d.risk.map(function (r) {
                    return {
                        title: esc(r.name) + ' ' + ui.badge(r.level, 'info') + (r.overLimit ? ' ' + ui.badge('超授信 ' + fmt.percent(r.usage), 'danger') : '') + (r.overdue ? ' ' + ui.badge('逾期 ' + fmt.money(r.overdue), 'danger') : ''),
                        sub: r.orders + ' 票 · 收入 ' + fmt.money(r.revenue) + ' · 未回款 ' + fmt.money(r.arPending) + ' · 及时率 ' + fmt.percent(r.onTime) + ' · 异常 ' + r.exceptions + ' 起',
                        act: 'cust:open', arg: r.id,
                        right: '<div class="tms-row" style="gap:6px">' + ui.link('授信', 'cust:credit', r.id, { tone: 'ghost' }) + ui.link('催收', 'cust:urge', r.id, { tone: 'ghost' }) + '</div>'
                    };
                })) : ui.empty('没有逾期或超授信客户', '回款表现健康', '✓')
            });
            var gapCard = ui.card({
                title: '契约体检', sub: '合同条款与等级标准、实际业务三方对齐', flat: true,
                body: ui.list([
                    {
                        title: '合同已过期但仍在合作 ' + ui.badge(d.gaps.expiredActive.length + ' 家', d.gaps.expiredActive.length ? 'danger' : 'success'),
                        sub: d.gaps.expiredActive.length ? d.gaps.expiredActive.slice(0, 5).map(function (r) { return esc(r.name + '(' + r.contractTo + ')'); }).join('、') : '无过期未续签客户',
                        right: d.gaps.expiredActive.length ? ui.btn('批量续签', { size: 'sm', tone: 'warn', act: 'cust:renew' }) : ''
                    },
                    {
                        title: '折扣偏离等级标准 ' + ui.badge(d.gaps.levelOff.length + ' 家', d.gaps.levelOff.length ? 'warn' : 'success'),
                        sub: d.gaps.levelOff.length ? d.gaps.levelOff.slice(0, 5).map(function (r) { return esc(r.name + ' ' + r.discount + '%'); }).join('、') + '：低于/高于标准折扣都要留商务审批记录' : '全部按等级标准折扣签约'
                    },
                    {
                        title: '等级应有授信却为 0 ' + ui.badge(d.gaps.creditOff.length + ' 家', d.gaps.creditOff.length ? 'warn' : 'success'),
                        sub: d.gaps.creditOff.length ? '月结客户没有额度等于没有风控上限：' + d.gaps.creditOff.slice(0, 5).map(function (r) { return esc(r.name); }).join('、') : '月结类客户均已设授信额度'
                    },
                    {
                        title: '缺联系人或电话 ' + ui.badge(d.gaps.noContact.length + ' 家', d.gaps.noContact.length ? 'warn' : 'success'),
                        sub: d.gaps.noContact.length ? '异常与理赔无法回访，投诉会直接升级' : '客户联系方式完整'
                    },
                    {
                        title: '零业务量在营客户 ' + ui.badge(d.gaps.zero.length + ' 家', d.gaps.zero.length ? 'muted' : 'success'),
                        sub: d.gaps.zero.length ? '占用合同与对账资源，建议转休眠或撤并' : '在营客户均有业务'
                    }
                ])
            });
            var listCard = grid(ctx, {
                title: '客户台账', sub: d.rows.length + ' 家客户（合同条款 + 经营表现）',
                rows: d.rows, keyName: 'id', dense: true,
                filter: function (r, fs) {
                    if (fs.level && r.level !== fs.level) return false;
                    if (fs.zone && r.zone !== fs.zone) return false;
                    if (fs.settleCycle && r.settleCycle !== fs.settleCycle) return false;
                    if (fs.industry && r.industry !== fs.industry) return false;
                    var c = fs.chip || '';
                    if (c === 'expire' && !(r.expiring || r.expired)) return false;
                    if (c === 'risk' && !(r.overdue > 0 || r.overLimit)) return false;
                    if (c === 'stop' && r.status === 'active') return false;
                    if (c === 'top' && !(r.margin >= 20 && r.revenue > 0)) return false;
                    return true;
                },
                search: function (r) { return [r.id, r.name, r.shortName, r.contact, r.phone, r.city, r.industry].join(' '); },
                valueOf: function (r, k) { return k === 'margin' ? r.margin : (k === 'usage' ? r.usage : (k === 'leftDays' ? r.leftDays : (k === 'onTime' ? r.onTime : r[k]))); },
                chips: [
                    { label: '全部', value: '', count: d.rows.length },
                    { label: '将/已到期', value: 'expire', count: d.rows.filter(function (r) { return r.expiring || r.expired; }).length },
                    { label: '风险客户', value: 'risk', count: d.rows.filter(function (r) { return r.overdue > 0 || r.overLimit; }).length },
                    { label: '高毛利', value: 'top', count: d.rows.filter(function (r) { return r.margin >= 20 && r.revenue > 0; }).length },
                    { label: '停用', value: 'stop', count: d.rows.filter(function (r) { return r.status !== 'active'; }).length }
                ], chipsName: 'chip',
                fields: [
                    { key: 'level', label: '等级', options: [{ value: '', label: '全部等级' }].concat(ui.optionsOf(cfg.customerLevels, 'level', 'level')) },
                    { key: 'zone', label: '大区', options: [{ value: '', label: '全部大区' }].concat(ui.optionsOf(TMS.master.ZONES)) },
                    { key: 'settleCycle', label: '结算周期', options: [{ value: '', label: '全部周期' }].concat(ui.optionsOf(Object.keys(SETTLE_TEXT))) },
                    { key: 'industry', label: '行业', options: [{ value: '', label: '全部行业' }].concat(ui.optionsOf(colUnique('customers', 'industry'))) }
                ],
                tools: ui.btn('新增客户', { size: 'sm', tone: 'primary', act: 'cust:new', icon: '+' }) +
                    ui.btn('导出', { size: 'sm', tone: 'ghost', act: 'cust:export', icon: '↓' }),
                columns: [
                    { key: 'name', label: '客户', render: function (r) {
                        return ui.link(esc(r.name), 'cust:open', r.id) + '<div class="tms-dim">' + esc(r.city) + ' · ' + esc(r.industry || '未填行业') + ' · ' + esc(r.contact || '无联系人') + '</div>';
                    } },
                    { key: 'level', label: '等级', width: '84px', render: function (r) { return ui.badge(r.level, r.level === 'KA' ? 'brand' : 'info') + '<div class="tms-dim">' + esc(r.levelName) + '</div>'; } },
                    { key: 'settleCycle', label: '账期', width: '84px', render: function (r) { return esc(r.settleCycle) + '<div class="tms-dim">' + esc(r.settleText) + '</div>'; } },
                    { key: 'discount', label: '折扣', align: 'right', width: '72px', render: function (r) { return r.discount ? fmt.percent(r.discount) : '<span class="tms-dim">—</span>'; } },
                    { key: 'orders', label: '票量', align: 'right', width: '92px', render: function (r) { return r.orders + ' 票<div class="tms-dim">均 ' + fmt.money(r.avgFreight) + '</div>'; } },
                    { key: 'revenue', label: '收入', align: 'right', width: '112px', render: function (r) { return ui.moneyCell(r.revenue); } },
                    { key: 'margin', label: '毛利率', align: 'right', width: '132px', render: function (r) { return r.revenue ? rateBar(r.margin, { target: 18 }) : '<span class="tms-dim">—</span>'; } },
                    { key: 'usage', label: '授信占用', align: 'right', width: '132px', render: function (r) {
                        if (!r.creditLimit) return r.arPending ? ui.badge('无额度欠 ' + fmt.money(r.arPending), 'warn') : '<span class="tms-dim">不适用</span>';
                        return pctBar(Math.min(150, r.usage), { tone: r.overLimit ? 'danger' : (r.usage > 80 ? 'warn' : 'success') });
                    } },
                    { key: 'leftDays', label: '合同到期', align: 'right', width: '108px', render: function (r) {
                        if (r.expired) return ui.badge('过期 ' + (-r.leftDays) + ' 天', 'danger');
                        if (r.expiring) return ui.badge('剩 ' + r.leftDays + ' 天', 'warn');
                        return '<span class="tms-dim">' + esc(fmt.date(r.contractTo)) + '</span>';
                    } },
                    { key: 'ops', label: '操作', align: 'right', width: '118px', sortable: false, render: function (r) {
                        return ui.link('档案', 'cust:open', r.id, { tone: 'ghost' }) + ' ' + ui.link('续签', 'cust:contract', r.id, { tone: 'ghost' });
                    } }
                ],
                emptyText: '没有符合条件的客户'
            });
            return wrap(ctx, {
                actions: ui.btn('新增客户', { tone: 'primary', act: 'cust:new', icon: '+' }) +
                    (d.expiring.length ? ui.btn('到期待办 ' + d.expiring.length, { act: 'cust:renew', icon: '◷' }) : ''),
                body: [kpi, ui.split('2', [topCard, riskCard]), ui.split('2', [levelCard, cycleCard]), gapCard, listCard]
            });
        },
        actions: {
            'cust:open': function (id) { customerModal(id); },
            'cust:edit': function (id) { customerFormModal(id); },
            'cust:new': function () { customerFormModal(''); },
            'cust:credit': function (id) { custCreditModal(id); },
            'cust:urge': function (id) { custUrgeModal(id); },
            'cust:urgeLog': function (id) { custUrgeLogModal(id); },
            'cust:ar': function (id) { ui.closeTop(); TMS.shell.go('receivable', { customerId: id }); },
            'cust:contract': function (id) { custContractModal(id); },
            'cust:orders': function (id) { ui.closeTop(); TMS.shell.go('order', { customerId: id }); },
            'cust:renew': function () {
                var rows = custView2();
                if (!rows.length) { ui.toast('没有需要续签的客户', 'info'); return; }
                ui.confirm({
                    title: '续签到期合同', okText: '续签一年',
                    message: '将把 ' + rows.length + ' 家「合同已过期或 60 天内到期」的在营客户到期日顺延一年。',
                    detail: '只改 contractTo 并留审计痕迹，折扣、账期、等级都不动——商务条款变更仍要走单家续签。'
                }).then(function (yes) {
                    if (!yes) return;
                    var to = util.dateKey(util.addDays(util.now(), 365));
                    db.batch(function () {
                        rows.forEach(function (r) {
                            db.update('customers', r.id, { contractTo: to, status: 'active' });
                            db.commit('customers', r.id, 'customer:renew');
                        });
                    }, 'customer:renewAll');
                    TMS.audit.log('customer.contract', 'customers', '', '批量续签 ' + rows.length + ' 家至 ' + to, actor());
                    ui.toast('已批量续签 ' + rows.length + ' 家', 'success');
                    TMS.shell.refresh();
                });
            },
            'cust:export': function () { exportCust(custAllRows()); },
            'cust:exportRisk': function () {
                var rows = custAllRows().filter(function (r) { return r.overdue > 0 || r.overLimit; });
                exportCust(rows, '客户风险清单.csv');
            }
        },
        drawerFooter: function (orderId) {
            var o = db.get('orders', orderId);
            if (!o || !o.customerId) return '';
            var c = db.get('customers', o.customerId);
            if (!c) return '';
            return ui.btn('客户档案 ' + esc(c.name), { size: 'sm', act: 'cust:open', arg: c.id });
        }
    });

    /* 客户页两处用到同一份「视图 + 排序」，抽出来免得口径漂移 */
    function custAllRows() {
        var agg = custAgg();
        return util.sortBy(db.col('customers').map(function (c) { return custView(c, agg); }), 'revenue', 'desc');
    }
    function custView2() {
        return custAllRows().filter(function (r) { return r.status === 'active' && (r.expiring || r.expired); });
    }
    function exportCust(rows, name) {
        if (!rows.length) { ui.toast('当前筛选没有数据', 'warn'); return; }
        download(name || '客户合同.csv', toCsv([
            { key: 'id', label: '客户编号' }, { key: 'name', label: '客户名称' }, { key: 'level', label: '等级' },
            { key: 'industry', label: '行业' }, { key: 'city', label: '城市' }, { key: 'zone', label: '大区' },
            { key: 'contact', label: '联系人' }, { key: 'phone', label: '电话' },
            { key: 'settleCycle', label: '结算周期' }, { key: 'discount', label: '折扣%' },
            { key: 'creditLimit', label: '授信额度' }, { key: 'arPending', label: '未回款' },
            { key: 'overdue', label: '逾期金额' },
            { key: 'usage', label: '授信占用%' }, { key: 'orders', label: '票量' }, { key: 'signed', label: '签收票' },
            { key: 'revenue', label: '收入' }, { key: 'profit', label: '毛利' }, { key: 'margin', label: '毛利率%' },
            { key: 'onTime', label: '及时率%' }, { key: 'exceptions', label: '异常起' },
            { key: 'contractFrom', label: '合同起始' }, { key: 'contractTo', label: '合同到期' },
            { key: 'status', label: '状态', value: function (r) { return CUSTOMER_TEXT[r.status] || r.status; } },
            { key: 'monthlyVolume', label: '承诺月均' }, { key: 'points', label: '积分' }
        ], rows));
    }

    /* 台账详情里会挂别的页面的单号链接，而 ui.actions 每次渲染只装配「共享动作 + 当前页动作」。
       跳转用的 tp:open / ap:open 必须在打开这份弹窗的那一页再注册一次，否则点了没反应。 */
    function gotoTrip(id) { ui.closeTop(); TMS.shell.go('transport', { q: id }); }
    function gotoPayable(id) { ui.closeTop(); TMS.shell.go('payable', { q: id }); }

    /* ---------- 二十四、车辆管理 ---------- */
    var VEH_TEXT = { available: '待命', busy: '在途', maintenance: '保养中', offline: '停运' };
    var MAINT_ITEMS = ['常规保养', '轮胎更换', '刹车系统检修', '冷藏机组检修', '事故维修', '年检'];
    var FUEL_TYPES = ['柴油', '电', '天然气', '油电混动'];
    var VEH_RUN = ['pending', 'loading', 'departed', 'arrived'];

    /* 车队利用率只能从车次反算：车辆档案不存「用过几次」，一存就开始过期 */
    function vehTripIndex(days) {
        var cutoff = util.addDays(util.now(), -(days || 30)).getTime();
        return util.groupBy(db.col('transports').filter(function (t) {
            return t.vehicleId && util.toDate(t.date || t.createdAt).getTime() >= cutoff;
        }), 'vehicleId');
    }

    function vehApIndex() {
        return util.groupBy(db.col('payables').filter(function (p) {
            return /^VEH/.test(String(p.refId || ''));
        }), 'refId');
    }

    function vehView(v, tripsById, apById) {
        var mine = tripsById[v.id] || [];
        var vt = TMS.master.vehicleType(v.typeCode);
        var km = util.round(util.sum(mine, TMS.operation.distanceOf), 0);
        var cost = util.money(util.sum(mine, TMS.operation.costTotal));
        var weight = util.round(util.sum(mine, function (t) { return Number(t.weight) || 0; }), 1);
        var loadRateAvg = mine.length ? util.round(util.sum(mine, function (t) { return Number(t.loadRate) || 0; }) / mine.length, 1) : 0;
        var drv = v.driverId ? db.get('employees', v.driverId) : null;
        var ap = apById[v.id] || [];
        var insDays = v.insuredTo ? Math.round(util.hoursBetween(util.now(), util.toDate(v.insuredTo)) / 24) : -1;
        var mtDays = v.nextCheckAt ? Math.round(util.hoursBetween(util.now(), util.toDate(v.nextCheckAt)) / 24) : -1;
        return {
            id: v.id, plate: v.plate, typeCode: v.typeCode, typeName: v.typeName || vt.name,
            loadKg: Number(v.loadKg) || 0, volumeM3: Number(v.volumeM3) || 0,
            lengthM: Number(v.lengthM) || 0, costPerKm: Number(v.costPerKm) || 0,
            hubId: v.hubId, hubName: v.hubName || (db.get('hubs', v.hubId) || {}).name || '',
            driverId: v.driverId || '', driver: drv ? drv.name : (v.driver || ''),
            driverPhone: drv ? drv.phone : (v.driverPhone || ''),
            driverRole: drv ? drv.role : '', driverStatus: drv ? drv.status : '',
            driverOk: !!drv && drv.role === 'transporter' && drv.status === 'active',
            status: v.status || 'available', odometer: Number(v.odometer) || 0,
            insuredTo: v.insuredTo || '', insDays: insDays,
            nextCheckAt: v.nextCheckAt || '', mtDays: mtDays,
            fuelType: v.fuelType || '柴油', coldBox: !!v.coldBox, purchaseAt: v.purchaseAt || '',
            ageMonths: v.purchaseAt ? Math.round(util.hoursBetween(util.toDate(v.purchaseAt), util.now()) / 24 / 30.4) : 0,
            trips: mine.length, km: km, cost: cost, weight: weight,
            avgLoad: loadRateAvg,
            costPerKg: weight ? util.round(cost / weight, 2) : 0,
            apCount: ap.length, apAmount: util.money(util.sum(ap, 'amount')),
            apOpen: util.money(util.sum(ap.filter(function (p) { return p.status === 'pending'; }), 'amount')),
            idle: (v.status || 'available') === 'available' && !mine.length,
            drift: (Number(v.loadKg) || 0) !== vt.loadKg || (Number(v.volumeM3) || 0) !== vt.volumeM3 ||
                (Number(v.costPerKm) || 0) !== vt.costPerKm || (Number(v.lengthM) || 0) !== vt.lengthM
        };
    }

    function vehRows(days) {
        var t = vehTripIndex(days || 30), a = vehApIndex();
        return db.col('vehicles').map(function (v) { return vehView(v, t, a); });
    }

    /* 车挂在「在途」但名下没有未完行车次：回场动作漏了，车辆永远调度不到 */
    function vehStuckRows(rows) {
        var running = {};
        db.col('transports').filter(function (t) {
            return t.vehicleId && VEH_RUN.indexOf(t.status) > -1;
        }).forEach(function (t) { running[t.vehicleId] = t.id; });
        return rows.filter(function (r) { return r.status === 'busy' && !running[r.id]; });
    }

    function vehGaps(rows) {
        return {
            insExpired: rows.filter(function (r) { return r.insDays < 0; }),
            insSoon: rows.filter(function (r) { return r.insDays >= 0 && r.insDays <= 30; }),
            maintDue: rows.filter(function (r) { return r.mtDays >= 0 && r.mtDays <= 15; }),
            driverBad: rows.filter(function (r) { return r.driverId && !r.driverOk; }),
            noDriver: rows.filter(function (r) { return !r.driverId; }),
            idle: rows.filter(function (r) { return r.idle; }),
            drift: rows.filter(function (r) { return r.drift; }),
            overloaded: rows.filter(function (r) { return r.trips >= 3 && r.avgLoad > 95; }),
            wasted: rows.filter(function (r) { return r.trips >= 3 && r.avgLoad < 40; })
        };
    }

    function vehTripsTable(mine) {
        if (!mine.length) return ui.empty('窗口内没有自有车次', '该车可能由外协舱位替代，或仍在待命');
        return ui.table({
            dense: true, keyName: 'id', rows: mine,
            columns: [
                { key: 'id', label: '车次', width: '126px', render: function (t) { return idLink(t.id, 'tp:open'); } },
                { key: 'code', label: '线路', render: function (t) { return esc(t.code) + (t.toCity ? ' <span class="tms-dim">' + esc(t.toCity) + '</span>' : ''); } },
                { key: 'weight', label: '实载', align: 'right', width: '92px', render: function (t) { return fmt.kg(t.weight); } },
                { key: 'loadRate', label: '装载率', align: 'right', width: '150px', render: function (t) { return rateBar(t.loadRate || 0, { target: 70 }); } },
                { key: 'distanceKm', label: '里程', align: 'right', width: '92px', render: function (t) { return fmt.number(t.distanceKm) + ' km'; } },
                { key: 'costPerKg', label: '成本/kg', align: 'right', width: '92px', render: function (t) { return fmt.money(t.costPerKg); } },
                { key: 'status', label: '状态', align: 'right', width: '84px', sortable: false, render: function (t) { return statusBadge(t.status, pg.TRIP_TEXT); } }
            ]
        });
    }

    function vehModal(id) {
        var v = db.get('vehicles', id);
        if (!v) { ui.toast('车辆不存在', 'warn'); return; }
        var r = vehView(v, vehTripIndex(30), vehApIndex());
        var mine = util.sortBy((vehTripIndex(30)[v.id] || []).map(TMS.operation.tripView), 'date', 'desc').slice(0, 12);
        var aps = util.sortBy((vehApIndex()[v.id] || []).map(apView), 'date', 'desc');
        var tips = [];
        if (r.drift) tips.push('档案载运参数与车型主数据不一致，调度按档案算装载率会失真');
        if (r.driverId && !r.driverOk) tips.push('固定司机「' + r.driver + '」已不在岗，车次派单会落到临时司机身上');
        if (r.insDays < 0) tips.push('保险已过期，车辆不得上路');
        else if (r.insDays <= 30) tips.push('保险 ' + r.insDays + ' 天后到期，先续保再排长线');
        if (r.mtDays >= 0 && r.mtDays <= 15) tips.push('距下次保养 ' + r.mtDays + ' 天，可提前预约');
        if (r.trips >= 3 && r.avgLoad < 40) tips.push('平均装载率仅 ' + fmt.percent(r.avgLoad) + '，这条线更适合买舱位或换小车型');
        ui.modal({
            title: esc(r.plate), size: 'wide',
            sub: esc(r.typeName) + ' · ' + esc(r.hubName) + ' · 固定司机 ' + esc(r.driver || '未指定') + ' ' + statusBadge(r.status, VEH_TEXT),
            body: ui.stack([
                ui.kpis([
                    { label: '近 30 天车次', value: r.trips, unit: '班', sub: '累计 ' + fmt.number(r.km) + ' km' },
                    { label: '干线成本', value: fmt.money(r.cost), tone: 'brand', sub: r.trips ? '单车次 ' + fmt.money(util.money(r.cost / r.trips)) : '窗口内未发车' },
                    { label: '平均装载率', value: fmt.percent(r.avgLoad), tone: r.avgLoad > 95 ? 'warn' : (r.avgLoad < 40 ? 'danger' : 'success'), sub: fmt.number(r.weight) + ' kg 实载' },
                    { label: '单公斤成本', value: fmt.money(r.costPerKg), sub: '档案公里成本 ' + fmt.money(r.costPerKm) },
                    { label: '待结算维保单', value: fmt.money(r.apOpen), tone: r.apOpen ? 'warn' : '', sub: aps.length + ' 张应付' }
                ]),
                ui.desc([
                    { label: '车牌', value: esc(r.plate) + (r.coldBox ? ' ' + ui.badge('带冷藏机组', 'accent') : '') },
                    { label: '车型', value: esc(r.typeName) + ' <span class="tms-dim">' + esc(r.typeCode) + ' · ' + r.lengthM + ' 米</span>' },
                    { label: '载运参数', value: fmt.number(r.loadKg) + ' kg / ' + r.volumeM3 + ' m³' },
                    { label: '归属分拨', value: esc(r.hubName || '未归属') },
                    { label: '固定司机', value: r.driverId ? (esc(r.driver) + ' ' + ui.badge(r.driverStatus === 'active' && r.driverRole === 'transporter' ? '在岗' : '异常', r.driverOk ? 'success' : 'danger') + ' <span class="tms-dim">' + esc(r.driverPhone) + '</span>') : dim('未指定') },
                    { label: '里程表', value: fmt.number(r.odometer) + ' km' },
                    { label: '保险到期', value: esc(r.insuredTo) + (r.insDays >= 0 ? ' <span class="tms-dim">剩 ' + r.insDays + ' 天</span>' : ' ' + ui.badge('已过期', 'danger')) },
                    { label: '下次保养', value: esc(r.nextCheckAt) + (r.mtDays >= 0 ? ' <span class="tms-dim">剩 ' + r.mtDays + ' 天</span>' : ' ' + ui.badge('已逾期', 'danger')) },
                    { label: '动力/车龄', value: esc(r.fuelType) + ' · ' + (r.ageMonths ? r.ageMonths + ' 个月' : '未登记购入日') },
                    { label: '购入日期', value: dim(r.purchaseAt) }
                ]),
                tips.length ? ui.notice('<div>' + tips.map(function (t) { return '· ' + esc(t); }).join('<br>') + '</div>', 'warn', '档案体检') : '',
                ui.card({ title: '近 30 天自有车次', sub: '装载率由在车订单反算，不是司机手填', flat: true, body: vehTripsTable(mine) }),
                ui.card({
                    title: '维保应付', sub: aps.length ? aps.length + ' 张，合计 ' + fmt.money(r.apAmount) : '无维保费挂账', flat: true,
                    body: aps.length ? ui.table({
                        dense: true, keyName: 'id', rows: aps.slice(0, 8),
                        columns: [
                            { key: 'id', label: '应付单', width: '132px', render: function (p) { return idLink(p.id, 'ap:open'); } },
                            { key: 'target', label: '服务商' },
                            { key: 'amount', label: '金额', align: 'right', width: '110px', render: function (p) { return ui.moneyCell(p.amount); } },
                            { key: 'dueDate', label: '到期', width: '104px' },
                            { key: 'status', label: '状态', align: 'right', width: '88px', sortable: false, render: function (p) { return statusBadge(p.status, AP_TEXT); } }
                        ]
                    }) : ui.empty('没有维保单', '保养费用不落应付，车队成本就会少算一块')
                })
            ]),
            footer: ui.btn('编辑档案', { size: 'sm', act: 'veh:edit', arg: v.id }) +
                ui.btn('登记保养', { size: 'sm', act: 'veh:maint', arg: v.id }) +
                ui.btn('改派司机', { size: 'sm', act: 'veh:driver', arg: v.id }) +
                ui.btn('看该车车次', { size: 'sm', tone: 'ghost', act: 'veh:trips', arg: v.id }) +
                ui.btn('关闭', { size: 'sm', act: 'ui:close' })
        });
    }

    function driverOptions(hubId, keep) {
        var pool = db.col('employees').filter(function (e) { return e.role === 'transporter' && e.status === 'active'; });
        var mine = pool.filter(function (e) { return e.hubId === hubId; });
        var rest = pool.filter(function (e) { return e.hubId !== hubId; });
        var opts = mine.concat(rest).slice(0, 60).map(function (e) {
            return { value: e.id, label: e.name + '（' + e.id + ' · ' + (e.hubId === hubId ? '本枢纽' : e.city) + '）' };
        });
        if (keep && !opts.some(function (o) { return o.value === keep; })) {
            var cur = db.get('employees', keep);
            if (cur) opts.unshift({ value: cur.id, label: cur.name + '（' + cur.id + ' · 当前）' });
        }
        return opts;
    }

    function vehFormModal(id) {
        var v = id ? db.get('vehicles', id) : null;
        ui.formModal({
            title: v ? '维护车辆档案' : '新增车辆',
            sub: v ? esc(v.plate) + ' · 载重/容积/公里成本按车型主数据重算，档案不允许手工漂移' : '新车按车型主数据生成载运参数，保存后即可参与调度择优',
            notice: '载运参数不开放手填：车型主数据改了，这里跟着重算。真实车队台账最常見的坑就是「司机把载重改成 8 吨」，装载率和成本从此对不上。',
            fields: [
                { key: 'plate', label: '车牌', required: true, placeholder: '沪A12345' },
                { key: 'typeCode', label: '车型', type: 'select', required: true, options: ui.optionsOf(TMS.master.VEHICLE_TYPES, 'code', 'name') },
                { key: 'hubId', label: '归属分拨', type: 'select', required: true, options: [{ value: '', label: '请选择' }].concat(ui.optionsOf(db.col('hubs'), 'id', 'name')) },
                { key: 'driverId', label: '固定司机', type: 'select', options: [{ value: '', label: '暂不指定（调度时随机在岗司机）' }].concat(driverOptions(v ? v.hubId : '', v ? v.driverId : '')), hint: '一车一司机是排班结果，改派请走「改派司机」留痕' },
                { key: 'status', label: '状态', type: 'select', required: true, options: Object.keys(VEH_TEXT).map(function (k) { return { value: k, label: VEH_TEXT[k] }; }) },
                { key: 'odometer', label: '里程表', type: 'number', min: 0, unit: 'km', required: true },
                { key: 'insuredTo', label: '保险到期', type: 'date', required: true },
                { key: 'nextCheckAt', label: '下次保养', type: 'date', required: true },
                { key: 'fuelType', label: '动力', type: 'select', options: ui.optionsOf(FUEL_TYPES) },
                { key: 'coldBox', label: '配冷藏机组', type: 'checkbox' },
                { key: 'purchaseAt', label: '购入日期', type: 'date' },
                { key: 'operator', label: '经办人', required: true }
            ],
            values: v ? {
                plate: v.plate, typeCode: v.typeCode, hubId: v.hubId, driverId: v.driverId || '',
                status: v.status || 'available', odometer: v.odometer, insuredTo: v.insuredTo,
                nextCheckAt: v.nextCheckAt, fuelType: v.fuelType, coldBox: !!v.coldBox,
                purchaseAt: v.purchaseAt, operator: actor()
            } : {
                status: 'available', fuelType: '柴油', odometer: 0, coldBox: false, operator: actor(),
                insuredTo: util.dateKey(util.addDays(util.now(), 365)),
                nextCheckAt: util.dateKey(util.addDays(util.now(), 90)),
                purchaseAt: util.dateKey(util.now())
            },
            okText: '保存档案',
            onSubmit: function (data) {
                var plate = String(data.plate || '').trim().toUpperCase();
                if (!plate) return '车牌必填';
                if (db.col('vehicles').some(function (x) { return String(x.plate).toUpperCase() === plate && x.id !== (v ? v.id : ''); })) {
                    return '车牌 ' + plate + ' 已在车队档案里';
                }
                var vt = TMS.master.vehicleType(data.typeCode);
                if (!vt || vt.code !== data.typeCode) return '车型不在主数据内';
                var hub = db.get('hubs', data.hubId);
                if (!hub) return '归属分拨必须存在';
                var drv = data.driverId ? db.get('employees', data.driverId) : null;
                if (data.driverId && (!drv || drv.status !== 'active')) return '指定司机不存在或已离职';
                var ins = util.toDate(data.insuredTo), mt = util.toDate(data.nextCheckAt);
                if (isNaN(ins)) return '保险到期日期不合法';
                if (ins.getTime() < util.dayStart(util.now()).getTime()) return '保险到期日已过：请先登记续保再改档案';
                if (isNaN(mt) || mt.getTime() < util.dayStart(util.now()).getTime()) return '下次保养日期不能早于今天：到期车请走「登记保养」';
                var odom = Math.round(Number(data.odometer) || 0);
                if (odom < 0) return '里程表不能是负数';
                if (v && odom < (Number(v.odometer) || 0)) return '里程表回拨了：低于档案读数 ' + fmt.number(v.odometer) + ' km，请核对车牌';
                var buy = data.purchaseAt ? util.toDate(data.purchaseAt) : null;
                if (buy && isNaN(buy)) return '购入日期不合法';
                var patch = {
                    plate: plate, typeCode: vt.code, typeName: vt.name, loadKg: vt.loadKg,
                    volumeM3: vt.volumeM3, lengthM: vt.lengthM, costPerKm: vt.costPerKm,
                    hubId: hub.id, hubName: hub.name,
                    driverId: drv ? drv.id : '', driver: drv ? drv.name : '', driverPhone: drv ? drv.phone : '',
                    status: data.status, odometer: odom, insuredTo: util.dateKey(ins), nextCheckAt: util.dateKey(mt),
                    fuelType: data.fuelType || '柴油', coldBox: !!data.coldBox,
                    purchaseAt: buy ? util.dateKey(buy) : ''
                };
                var saved = v ? (db.update('vehicles', v.id, patch), db.get('vehicles', v.id)) : db.create('vehicles', patch);
                saveRow('vehicles', saved, 'vehicle:save');
                TMS.audit.log('vehicle.update', 'vehicles', saved.id,
                    (v ? '维护' : '新增') + '车辆 ' + saved.plate + '（' + saved.typeName + '·' + fmt.number(saved.loadKg) + 'kg），归属 ' + saved.hubName +
                    '，固定司机 ' + (saved.driver || '未指定'), data.operator || actor());
                ui.toast('已保存车辆 ' + saved.plate, 'success');
                for (var i = 0; i < 2; i++) TMS.ui.closeTop();
            }
        });
    }

    function vehMaintModal(id) {
        var v = db.get('vehicles', id);
        if (!v) { ui.toast('车辆不存在', 'warn'); return; }
        ui.formModal({
            title: '登记保养/维修', sub: esc(v.plate) + ' · ' + esc(v.typeName) + ' · 里程表 ' + fmt.number(v.odometer) + ' km',
            notice: '费用当场挂应付（科目「维修保养」，账期 30 天）：车修了但账上没单据，车队成本永远算不平，承运商对账时也追不回这笔。',
            fields: [
                { key: 'item', label: '项目', type: 'select', required: true, options: ui.optionsOf(MAINT_ITEMS) },
                { key: 'vendor', label: '维修服务商', required: true, placeholder: '例如 青岛鑫达汽修' },
                { key: 'odometer', label: '进场里程表', type: 'number', min: 0, unit: 'km', required: true, tip: '不得低于档案读数' },
                { key: 'fee', label: '费用', type: 'number', min: 0, unit: '元', required: true },
                { key: 'nextAt', label: '下次保养日期', type: 'date', required: true },
                { key: 'back', label: '修完直接复车', type: 'checkbox', hint: '勾选后状态回到「待命」，可立即被调度择优选中' },
                { key: 'operator', label: '经办人', required: true }
            ],
            values: {
                operator: actor(), odometer: v.odometer, nextAt: util.dateKey(util.addDays(util.now(), 90)),
                fee: v.typeCode === 'TRL' || v.typeCode === 'MAX' ? 2800 : 1200
            },
            okText: '登记并挂应付',
            onSubmit: function (data) {
                var odom = Math.round(Number(data.odometer) || 0);
                if (odom < (Number(v.odometer) || 0)) return '里程表低于档案读数：先确认没录错车牌';
                var fee = util.money(Number(data.fee) || 0);
                if (!(fee > 0)) return '请填写大于 0 的维修费用';
                var next = util.toDate(data.nextAt);
                if (isNaN(next) || next.getTime() <= util.now().getTime()) return '下次保养日期必须晚于今天';
                var vendor = String(data.vendor || '').trim();
                if (!vendor) return '维修服务商必填';
                var apId = db.batch(function () {
                    db.update('vehicles', v.id, {
                        odometer: odom, nextCheckAt: util.dateKey(next), status: data.back ? 'available' : v.status
                    });
                    db.commit('vehicles', v.id, 'vehicle:maint');
                    var ap = TMS.finance.createPayable({
                        refId: v.id, refNo: v.plate, target: vendor, targetType: 'supplier',
                        category: '维修保养', amount: fee, date: util.iso(util.now()),
                        dueDate: util.dateKey(util.addDays(util.now(), 30)), status: 'pending',
                        remark: data.item + '（' + v.plate + '）'
                    });
                    db.commit('payables', ap.id, 'vehicle:maint');
                    return ap.id;
                }, 'vehicle:maint');
                TMS.audit.log('vehicle.maint', 'vehicles', v.id,
                    data.item + '，进场里程 ' + fmt.number(odom) + ' km，费用 ' + fmt.money(fee) + '，应付 ' + apId + ' 挂「' + vendor + '」',
                    data.operator || actor());
                ui.toast('已登记' + data.item + '，应付 ' + fmt.money(fee) + ' 待结算', 'success');
                for (var i = 0; i < 2; i++) TMS.ui.closeTop();
            }
        });
    }

    function vehDriverModal(id) {
        var v = db.get('vehicles', id);
        if (!v) { ui.toast('车辆不存在', 'warn'); return; }
        var cur = v.driverId ? db.get('employees', v.driverId) : null;
        ui.formModal({
            title: '改派固定司机', sub: esc(v.plate) + ' · 当前 ' + (cur ? cur.name + '（' + cur.status + '）' : '未指定'),
            fields: [
                { key: 'driverId', label: '新司机', type: 'select', required: true, options: [{ value: '', label: '请选择' }].concat(driverOptions(v.hubId, v.driverId)) },
                { key: 'reason', label: '改派原因', type: 'select', required: true, options: ui.optionsOf(['辞职离岗', '调岗', '车辆调配', '疲劳轮休', '档案纠错']) },
                { key: 'operator', label: '经办人', required: true }
            ],
            values: { operator: actor() },
            okText: '改派',
            onSubmit: function (data) {
                var d = db.get('employees', data.driverId);
                if (!d || d.role !== 'transporter' || d.status !== 'active') return '只能指派在岗的运输司机';
                if (d.id === v.driverId) return '新司机与当前固定司机相同';
                var busy = db.col('transports').some(function (t) {
                    return t.driverId === d.id && VEH_RUN.indexOf(t.status) > -1;
                });
                db.update('vehicles', v.id, { driverId: d.id, driver: d.name, driverPhone: d.phone });
                saveRow('vehicles', v, 'vehicle:driver');
                TMS.audit.log('vehicle.driver', 'vehicles', v.id,
                    '固定司机 ' + ((cur || {}).name || '无') + ' → ' + d.name + '（' + data.reason + '）' + (busy ? '；该司机仍有在途车次，需同步改派' : ''),
                    data.operator || actor());
                ui.toast(busy ? ('已改派 ' + d.name + '，注意他名下还有在途车次') : ('已改派 ' + d.name), busy ? 'warn' : 'success');
                for (var i = 0; i < 2; i++) TMS.ui.closeTop();
            }
        });
    }

    pg.define('vehicle', {
        sub: '自有车队档案与真实使用对照：装载率从车次反算，保险保养到期、司机在岗、车型漂移都在体检里列出',
        load: function (ctx) {
            applyParamFilter(ctx, ['hub', 'typeCode']);
            var days = Math.max(7, Number(ctx.days) || 30);
            var rows = vehRows(days);
            var gaps = vehGaps(rows);
            var stuck = vehStuckRows(rows);
            var selfAll = db.col('transports').filter(function (t) { return t.dispatchType !== 'ltl'; });
            var win = selfAll.filter(function (t) {
                return util.toDate(t.date || t.createdAt).getTime() >= util.addDays(util.now(), -days).getTime();
            });
            var byType = TMS.master.VEHICLE_TYPES.map(function (t) {
                var g = rows.filter(function (r) { return r.typeCode === t.code; });
                var used = g.filter(function (r) { return r.trips > 0; });
                var trips = util.sum(g, 'trips');
                return {
                    code: t.code, name: t.name, count: g.length, used: used.length,
                    loadKg: t.loadKg, costPerKm: t.costPerKm, trips: trips,
                    km: util.round(util.sum(g, 'km'), 0), cost: util.money(util.sum(g, 'cost')),
                    weight: util.round(util.sum(g, 'weight'), 1),
                    perVehicle: g.length ? util.round(trips / g.length, 1) : 0,
                    avgLoad: trips ? util.round(util.sum(g, function (r) { return r.avgLoad * r.trips; }) / trips, 1) : 0,
                    costPerKg: util.sum(g, 'weight') ? util.round(util.sum(g, 'cost') / util.sum(g, 'weight'), 2) : 0
                };
            });
            var trend = (function () {
                var g = util.groupBy(selfAll, function (t) { return util.dateKey(util.toDate(t.date || t.createdAt)); });
                var out = [];
                for (var i = 13; i >= 0; i--) {
                    var k = util.dateKey(util.addDays(util.now(), -i));
                    var day = g[k] || [];
                    out.push({ label: fmt.monthDay(k), value: day.length, cost: util.money(util.sum(day, TMS.operation.costTotal)) });
                }
                return out;
            })();
            return {
                rows: rows, gaps: gaps, stuck: stuck, byType: byType, trend: trend, win: win,
                used: rows.filter(function (r) { return r.trips > 0; }).length,
                trips: util.sum(rows, 'trips'), km: util.round(util.sum(rows, 'km'), 0),
                cost: util.money(util.sum(rows, 'cost')), weight: util.round(util.sum(rows, 'weight'), 1),
                apOpen: util.money(util.sum(rows, 'apOpen')),
                ltlShare: (function () {
                    var all = db.col('transports').filter(function (t) {
                        return util.toDate(t.date || t.createdAt).getTime() >= util.addDays(util.now(), -days).getTime();
                    });
                    var ltl = all.filter(function (t) { return t.dispatchType === 'ltl'; });
                    return all.length ? util.round(ltl.length / all.length * 100, 1) : 0;
                })(),
                gapCount: gaps.insExpired.length + gaps.insSoon.length + gaps.maintDue.length +
                    gaps.driverBad.length + gaps.drift.length + stuck.length
            };
        },
        render: function (ctx, d) {
            var kpi = ui.kpis([
                { label: '自有车辆', value: d.rows.length, unit: '台', icon: '⛟', sub: '跑过车次 ' + d.used + ' 台' },
                { label: '窗口内车次', value: d.trips, unit: '班', icon: '⇄', tone: 'brand', sub: fmt.number(d.km) + ' km · ' + fmt.number(d.weight) + ' kg' },
                { label: '干线成本', value: fmt.money(d.cost), icon: '¥', sub: '单公斤 ' + fmt.money(d.weight ? util.round(d.cost / d.weight, 2) : 0) },
                { label: '外协舱位占比', value: fmt.percent(d.ltlShare), icon: '⛰', tone: d.ltlShare > 85 ? 'warn' : '', sub: '自有留不足一成说明车队闲置' },
                { label: '维保未结', value: fmt.money(d.apOpen), icon: '⚒', tone: d.apOpen ? 'warn' : '', sub: '挂应付待财务结算' },
                { label: '档案体检', value: d.gapCount, unit: '项', icon: '⚑', tone: d.gapCount ? 'warn' : 'success', sub: '卡在「在途」' + d.stuck.length + ' 台' }
            ]);
            var typeCard = ui.card({
                title: '车型结构与产出', sub: '台数、真实班次、装载率、单公斤成本——大车没活儿就是资产浪费', flat: true,
                body: ui.table({
                    dense: true, keyName: 'code', rows: d.byType.filter(function (r) { return r.count; }),
                    columns: [
                        { key: 'name', label: '车型', render: function (r) { return esc(r.name) + ' <span class="tms-dim">' + esc(r.code) + '</span>'; } },
                        { key: 'count', label: '台数', align: 'right', width: '70px' },
                        { key: 'used', label: '动过', align: 'right', width: '70px', render: function (r) { return r.used + '/' + r.count; } },
                        { key: 'loadKg', label: '载重', align: 'right', width: '92px', render: function (r) { return fmt.number(r.loadKg) + ' kg'; } },
                        { key: 'trips', label: '班次', align: 'right', width: '76px', render: function (r) { return fmt.number(r.trips); } },
                        { key: 'perVehicle', label: '台均班次', align: 'right', width: '96px' },
                        { key: 'avgLoad', label: '装载率', align: 'right', width: '150px', render: function (r) { return rateBar(r.avgLoad, { target: 70 }); } },
                        { key: 'costPerKg', label: '成本/kg', align: 'right', width: '96px', render: function (r) { return r.costPerKg ? fmt.money(r.costPerKg) : '<span class="tms-dim">—</span>'; } }
                    ]
                })
            });
            var trendCard = ui.card({
                title: '自有运力投放', sub: '近 14 天自有整车班次数与干线成本', flat: true,
                body: ch.line({ data: d.trend, height: 230, area: true, fmt: function (v) { return v + ' 班'; } })
            });
            var utilCard = ui.card({
                title: '台均班次 TOP10', sub: '窗口内实际跑起来的车', flat: true,
                body: ch.hbars({
                    data: util.sortBy(d.rows, 'trips', 'desc').filter(function (r) { return r.trips; }).slice(0, 10)
                        .map(function (r) { return { label: r.plate, value: r.trips, sub: fmt.percent(r.avgLoad) + ' 装载 · ' + fmt.number(r.km) + ' km' }; }),
                    height: 260, rowH: 26, fmt: function (v) { return v + ' 班'; }
                })
            });
            var gapCard = ui.card({
                title: '车队体检', sub: '档案、执行方、财务三张表对不上，就是成本失真的来源',
                tone: d.gapCount ? 'danger' : '', flat: true,
                body: ui.list([
                    {
                        title: '保险过期 ' + ui.badge(d.gaps.insExpired.length + ' 台', d.gaps.insExpired.length ? 'danger' : 'success'),
                        sub: d.gaps.insExpired.length ? d.gaps.insExpired.slice(0, 5).map(function (r) { return esc(r.plate + '(' + r.insuredTo + ')'); }).join('、') + '：不得排线，先续保' : '全部车辆在保',
                        right: d.gaps.insExpired.length ? ui.btn('去续保', { size: 'sm', tone: 'danger', act: 'veh:edit', arg: d.gaps.insExpired[0].id }) : ''
                    },
                    {
                        title: '保险 30 天内到期 ' + ui.badge(d.gaps.insSoon.length + ' 台', d.gaps.insSoon.length ? 'warn' : 'success'),
                        sub: d.gaps.insSoon.length ? d.gaps.insSoon.slice(0, 6).map(function (r) { return esc(r.plate + ' 剩 ' + r.insDays + ' 天'); }).join('、') : '近期无到期'
                    },
                    {
                        title: '15 天内该保养 ' + ui.badge(d.gaps.maintDue.length + ' 台', d.gaps.maintDue.length ? 'warn' : 'success'),
                        sub: d.gaps.maintDue.length ? '预约维保并当场挂应付：' + d.gaps.maintDue.slice(0, 5).map(function (r) { return esc(r.plate); }).join('、') : '无临期保养',
                        right: d.gaps.maintDue.length ? ui.btn('登记保养', { size: 'sm', tone: 'warn', act: 'veh:maint', arg: d.gaps.maintDue[0].id }) : ''
                    },
                    {
                        title: '固定司机不在岗 ' + ui.badge(d.gaps.driverBad.length + ' 台', d.gaps.driverBad.length ? 'danger' : 'success'),
                        sub: d.gaps.driverBad.length ? d.gaps.driverBad.slice(0, 5).map(function (r) { return esc(r.plate + '→' + (r.driver || '空')); }).join('、') + '：派单会落到临时司机，趟费应付也容易挂空' : '在册司机全部在岗',
                        right: d.gaps.driverBad.length ? ui.btn('改派', { size: 'sm', tone: 'warn', act: 'veh:driver', arg: d.gaps.driverBad[0].id }) : ''
                    },
                    {
                        title: '未指定固定司机 ' + ui.badge(d.gaps.noDriver.length + ' 台', d.gaps.noDriver.length ? 'muted' : 'success'),
                        sub: d.gaps.noDriver.length ? '调度每次随机取人，司机里程绩效与趟费都要靠车次兜底' : '全部车辆已一车一司机'
                    },
                    {
                        title: '载运参数偏离主数据 ' + ui.badge(d.gaps.drift.length + ' 台', d.gaps.drift.length ? 'warn' : 'success'),
                        sub: d.gaps.drift.length ? '装载率、择优成本都按档案载重算，漂移一台整条线失真' : '全部与车型主数据一致',
                        right: d.gaps.drift.length ? ui.btn('按主数据对齐', { size: 'sm', act: 'veh:sync' }) : ''
                    },
                    {
                        title: '状态卡「在途」但无未完成车次 ' + ui.badge(d.stuck.length + ' 台', d.stuck.length ? 'danger' : 'success'),
                        sub: d.stuck.length ? '车次回场没写回车状态，这些车再也选不进调度池：' + d.stuck.slice(0, 5).map(function (r) { return esc(r.plate); }).join('、') : '车辆状态与车次执行一致',
                        right: d.stuck.length ? ui.btn('释放复车', { size: 'sm', tone: 'warn', act: 'veh:release' }) : ''
                    },
                    {
                        title: '大车拉小货 ' + ui.badge(d.gaps.wasted.length + ' 台', d.gaps.wasted.length ? 'warn' : 'success'),
                        sub: d.gaps.wasted.length ? d.gaps.wasted.slice(0, 5).map(function (r) { return esc(r.plate + ' ' + fmt.percent(r.avgLoad)); }).join('、') + '：这三成货量买舱位更省，别整车放空跑' : '在用车辆装载率健康',
                        right: d.gaps.wasted.length ? ui.btn('运力对照', { size: 'sm', tone: 'ghost', act: 'veh:compare' }) : ''
                    },
                    {
                        title: '长期闲置 ' + ui.badge(d.gaps.idle.length + ' 台', d.gaps.idle.length ? 'muted' : 'success'),
                        sub: d.gaps.idle.length ? '待命且窗口内零车次：折旧、保险、场地照付，考虑转租或处置' : '无闲置车辆'
                    }
                ])
            });
            var listCard = grid(ctx, {
                title: '车辆台账', rows: d.rows, keyName: 'id', dense: true, onRow: 'veh:open', searchKey: 'q',
                filter: function (r, fs) {
                    if (fs.hub && r.hubId !== fs.hub) return false;
                    if (fs.typeCode && r.typeCode !== fs.typeCode) return false;
                    if (fs.status && r.status !== fs.status) return false;
                    var c = fs.chip || '';
                    if (c === 'idle' && !r.idle) return false;
                    if (c === 'due' && !((r.mtDays >= 0 && r.mtDays <= 15) || (r.insDays >= 0 && r.insDays <= 30) || r.insDays < 0)) return false;
                    if (c === 'bad' && !(r.drift || (r.driverId && !r.driverOk))) return false;
                    if (c === 'cold' && !r.coldBox) return false;
                    return true;
                },
                search: function (r) { return [r.id, r.plate, r.driver, r.hubName, r.typeName].join(' '); },
                valueOf: function (r, k) { return k === 'costPerKg' ? r.costPerKg : r[k]; },
                chips: [
                    { label: '全部', value: '', count: d.rows.length },
                    { label: '临期', value: 'due', count: d.rows.filter(function (r) { return (r.mtDays >= 0 && r.mtDays <= 15) || r.insDays <= 30; }).length },
                    { label: '档案异常', value: 'bad', count: d.rows.filter(function (r) { return r.drift || (r.driverId && !r.driverOk); }).length },
                    { label: '冷链车', value: 'cold', count: d.rows.filter(function (r) { return r.coldBox; }).length },
                    { label: '闲置', value: 'idle', count: d.gaps.idle.length }
                ], chipsName: 'chip',
                fields: [
                    { key: 'q', type: 'search', label: '车牌 / 司机', placeholder: '沪A12345 / 张师傅' },
                    { key: 'hub', label: '归属分拨', options: [{ value: '', label: '全部分拨' }].concat(ui.optionsOf(db.col('hubs'), 'id', 'name')) },
                    { key: 'typeCode', label: '车型', options: [{ value: '', label: '全部车型' }].concat(ui.optionsOf(TMS.master.VEHICLE_TYPES, 'code', 'name')) },
                    { key: 'status', label: '状态', options: [{ value: '', label: '全部状态' }].concat(Object.keys(VEH_TEXT).map(function (k) { return { value: k, label: VEH_TEXT[k] }; })) }
                ],
                tools: ui.btn('新增车辆', { size: 'sm', tone: 'primary', act: 'veh:new', icon: '+' }) +
                    ui.btn('导出', { size: 'sm', tone: 'ghost', act: 'veh:export', icon: '↓' }),
                columns: [
                    {
                        key: 'plate', label: '车辆', render: function (r) {
                            return ui.link(esc(r.plate), 'veh:open', r.id) + ' ' + (r.coldBox ? ui.badge('冷链', 'accent') : '') +
                                '<div class="tms-dim">' + esc(r.typeName) + ' · ' + esc(r.hubName) + '</div>';
                        }
                    },
                    {
                        key: 'driver', label: '固定司机', width: '128px', render: function (r) {
                            return r.driverId ? (dim(r.driver) + (r.driverOk ? '' : ' ' + ui.badge('不在岗', 'danger'))) : '<span class="tms-dim">未指定</span>';
                        }
                    },
                    { key: 'loadKg', label: '载重', align: 'right', width: '92px', render: function (r) { return fmt.number(r.loadKg) + ' kg'; } },
                    { key: 'trips', label: '班次', align: 'right', width: '76px', render: function (r) { return r.trips ? fmt.number(r.trips) : '<span class="tms-dim">0</span>'; } },
                    { key: 'km', label: '里程', align: 'right', width: '96px', render: function (r) { return fmt.number(r.km); } },
                    { key: 'avgLoad', label: '装载率', align: 'right', width: '150px', render: function (r) { return r.trips ? rateBar(r.avgLoad, { target: 70 }) : '<span class="tms-dim">—</span>'; } },
                    { key: 'costPerKg', label: '成本/kg', align: 'right', width: '96px', render: function (r) { return r.costPerKg ? fmt.money(r.costPerKg) : '<span class="tms-dim">—</span>'; } },
                    {
                        key: 'mtDays', label: '保养/保险', align: 'right', width: '124px', render: function (r) {
                            return (r.mtDays < 0 ? ui.badge('保养逾期', 'danger') : ui.badge('保养 ' + r.mtDays + '天', r.mtDays <= 15 ? 'warn' : 'muted')) + ' ' +
                                (r.insDays < 0 ? ui.badge('脱保', 'danger') : ui.badge('保险 ' + r.insDays + '天', r.insDays <= 30 ? 'warn' : 'muted'));
                        }
                    },
                    { key: 'status', label: '状态', align: 'right', width: '84px', sortable: false, render: function (r) { return statusBadge(r.status, VEH_TEXT); } },
                    {
                        key: 'ops', label: '操作', align: 'right', width: '116px', sortable: false, render: function (r) {
                            return ui.link('保养', 'veh:maint', r.id, { tone: 'ghost' }) + ' ' +
                                ui.link('编辑', 'veh:edit', r.id, { tone: 'ghost' }) + ' ' +
                                ui.link('车次', 'veh:trips', r.id, { tone: 'ghost' });
                        }
                    }
                ],
                emptyText: '没有符合条件的车辆'
            });
            return wrap(ctx, {
                actions: ui.btn('新增车辆', { tone: 'primary', act: 'veh:new', icon: '+' }) +
                    ui.btn('档案体检修复', { act: 'veh:sync', icon: '⚑' }),
                body: [kpi, ui.split('2', [trendCard, utilCard]), typeCard, gapCard, listCard]
            });
        },
        actions: {
            'veh:open': function (id) { vehModal(id); },
            'veh:edit': function (id) { vehFormModal(id); },
            'veh:new': function () { vehFormModal(''); },
            'veh:maint': function (id) { vehMaintModal(id); },
            'veh:driver': function (id) { vehDriverModal(id); },
            'tp:open': gotoTrip,
            'ap:open': gotoPayable,
            'veh:trips': function (id) {
                var v = db.get('vehicles', id);
                ui.closeTop();
                TMS.shell.go('transport', { q: v ? v.plate : '' });
            },
            'veh:compare': function () { ui.closeTop(); TMS.shell.go('capacity'); },
            'veh:release': function () {
                var rows = vehStuckRows(vehRows(30));
                if (!rows.length) { ui.toast('没有卡在「在途」的车辆', 'info'); return; }
                ui.confirm({
                    title: '释放 ' + rows.length + ' 台车回「待命」',
                    message: '这些车状态是在途，但名下已没有未完成车次。',
                    detail: rows.slice(0, 8).map(function (r) { return esc(r.plate); }).join('、') +
                        '<br>不回场就等于自断运力：调度择优永远选不到它们。'
                }).then(function (yes) {
                    if (!yes) return;
                    db.batch(function () {
                        rows.forEach(function (r) {
                            db.update('vehicles', r.id, { status: 'available' });
                            db.commit('vehicles', r.id, 'vehicle:release');
                        });
                    }, 'vehicle:release');
                    TMS.audit.log('vehicle.release', 'vehicles', '', '释放 ' + rows.length + ' 台无在途车次的车辆回待命', actor());
                    ui.toast('已释放 ' + rows.length + ' 台车辆', 'success');
                    TMS.shell.refresh();
                });
            },
            'veh:sync': function () {
                var rows = vehRows(30);
                var drift = rows.filter(function (r) { return r.drift; });
                var stuck = vehStuckRows(rows);
                if (!drift.length && !stuck.length) { ui.toast('车队档案与主数据、车次执行都一致', 'success'); return; }
                ui.confirm({
                    title: '车队档案对齐', okText: '执行修复',
                    message: '载运参数漂移 ' + drift.length + ' 台，状态卡死 ' + stuck.length + ' 台。',
                    detail: '载重、容积、车长、公里成本一律按车型主数据重算；在途状态只释放确实没有未完成车次的车辆。'
                }).then(function (yes) {
                    if (!yes) return;
                    db.batch(function () {
                        drift.forEach(function (r) {
                            var vt = TMS.master.vehicleType(r.typeCode);
                            db.update('vehicles', r.id, {
                                typeName: vt.name, loadKg: vt.loadKg, volumeM3: vt.volumeM3,
                                lengthM: vt.lengthM, costPerKm: vt.costPerKm
                            });
                            db.commit('vehicles', r.id, 'vehicle:sync');
                        });
                        stuck.forEach(function (r) {
                            db.update('vehicles', r.id, { status: 'available' });
                            db.commit('vehicles', r.id, 'vehicle:release');
                        });
                    }, 'vehicle:sync');
                    TMS.audit.log('vehicle.sync', 'vehicles', '',
                        '按主数据对齐载运参数 ' + drift.length + ' 台，释放待命 ' + stuck.length + ' 台', actor());
                    ui.toast('已对齐 ' + drift.length + ' 台、释放 ' + stuck.length + ' 台', 'success');
                    TMS.shell.refresh();
                });
            },
            'veh:export': function () {
                exportGrid({
                    name: '车队台账.csv', rows: vehRows(30),
                    filter: function (r, fs) { return !fs.hub || r.hubId === fs.hub; },
                    cols: [
                        { key: 'id', label: '车辆编号' }, { key: 'plate', label: '车牌' },
                        { key: 'typeName', label: '车型' }, { key: 'loadKg', label: '载重kg' },
                        { key: 'volumeM3', label: '容积m3' }, { key: 'costPerKm', label: '公里成本' },
                        { key: 'hubName', label: '归属分拨' }, { key: 'driver', label: '固定司机' },
                        { key: 'driverOk', label: '司机在岗', value: function (r) { return r.driverOk ? '是' : '否'; } },
                        { key: 'status', label: '状态', value: function (r) { return VEH_TEXT[r.status] || r.status; } },
                        { key: 'odometer', label: '里程表' }, { key: 'trips', label: '窗口班次' },
                        { key: 'km', label: '窗口里程' }, { key: 'weight', label: '窗口货重' },
                        { key: 'avgLoad', label: '平均装载率%' }, { key: 'costPerKg', label: '单公斤成本' },
                        { key: 'apAmount', label: '累计维保应付' }, { key: 'apOpen', label: '待结算维保' },
                        { key: 'insuredTo', label: '保险到期' }, { key: 'nextCheckAt', label: '下次保养' },
                        { key: 'fuelType', label: '动力' }, { key: 'coldBox', label: '冷藏机组', value: function (r) { return r.coldBox ? '有' : '无'; } },
                        { key: 'purchaseAt', label: '购入日期' }, { key: 'ageMonths', label: '车龄月' }
                    ]
                });
            }
        }
    });

    /* ---------- 二十五、运力资源 ---------- */
    var CAR_TEXT = { active: '协议中', suspended: '已暂停' };
    var CAR_MODES = ['陆运', '冷链', '空运'];
    var BALANCE_KMS = [200, 500, 900, 1400, 2000];

    /* 协议折扣来自 rate 系数：ltlCost 里 (1 - rate/0.95) * 12% 是唯一口径，页面不许另编一套 */
    function carDiscount(c) {
        var rate = Number((c || {}).rate);
        if (!rate) return 0;
        return util.round(Math.max(0, 1 - rate / 0.95) * 0.12 * 100, 1);
    }

    function capBestCarrier(mode) {
        var pool = db.col('carriers').filter(function (c) {
            return c.status === 'active' && (mode === '冷链' || mode === '空运' ? c.type === mode : c.type !== '空运' && c.type !== '冷链');
        });
        /* sortBy 不原地排序，必须接住返回值 */
        return (util.sortBy(pool, 'rate', 'asc') || [])[0] || null;
    }

    /* 某个运输方式只剩一家协议方：停摆就等于这条产品线交不了货，必须在页面上顶出来 */
    function capExclusiveRows() {
        return CAR_MODES.map(function (m) {
            var pool = db.col('carriers').filter(function (c) { return c.status === 'active' && c.type === m; });
            return { mode: m, count: pool.length, carriers: pool.map(function (c) { return c.name; }) };
        });
    }

    function capTransports(days) {
        var cutoff = util.addDays(util.now(), -(days || 30)).getTime();
        return db.col('transports').filter(function (t) {
            return util.toDate(t.date || t.createdAt).getTime() >= cutoff;
        });
    }

    function carView(c, byCarrier) {
        var mine = byCarrier[c.id] || [];
        var weight = util.round(util.sum(mine, function (t) { return Number(t.weight) || 0; }), 1);
        var cost = util.money(util.sum(mine, TMS.operation.costTotal));
        var onTime = mine.length ? util.round(mine.filter(TMS.operation.isOnTime).length / mine.length * 100, 1) : null;
        var aps = db.col('payables').filter(function (p) { return p.refId === c.id; });
        var open = aps.filter(function (p) { return p.status === 'pending'; });
        var over = open.filter(function (p) { return util.toDate(p.dueDate) < util.now(); });
        var contractDays = c.contractTo ? Math.round(util.hoursBetween(util.now(), util.toDate(c.contractTo)) / 24) : -1;
        var bookOnTime = util.round((Number(c.onTimeRate) || 0) * 100, 1);
        return {
            id: c.id, name: c.name, type: c.type, contact: c.contact || '', phone: c.phone || '',
            settleCycle: c.settleCycle || '月结', rate: Number(c.rate) || 0, discount: carDiscount(c),
            status: c.status || 'active', contractTo: c.contractTo || '', contractDays: contractDays,
            trips: mine.length, orders: util.sum(mine, 'orders'), weight: weight, cost: cost,
            perKg: weight ? util.round(cost / weight, 2) : 0,
            km: util.round(util.sum(mine, TMS.operation.distanceOf), 0),
            onTime: onTime, bookOnTime: bookOnTime, drift: onTime != null ? util.round(onTime - bookOnTime, 1) : null,
            late: mine.filter(function (t) { return !TMS.operation.isOnTime(t); }).length,
            damageRate: util.round((Number(c.damageRate) || 0) * 1000, 2),
            apCount: aps.length, apOpen: util.money(util.sum(open, 'amount')), apOver: util.money(util.sum(over, 'amount')),
            idle: !mine.length
        };
    }

    function carRows(days) {
        var by = util.groupBy(capTransports(days || 30).filter(function (t) { return t.carrierId; }), 'carrierId');
        return db.col('carriers').map(function (c) { return carView(c, by); });
    }

    /* 整车/舱位择优复盘：两种方式都算一遍成本，把调度当初选错的那笔差价找出来 */
    function capReview(rows, limit) {
        var out = [];
        var pool = rows.filter(function (t) {
            return (Number(t.weight) || 0) > 0 && TMS.operation.distanceOf(t) > 0 && t.status !== 'cancelled';
        });
        pool.slice(0, limit || 140).forEach(function (t) {
            var w = Number(t.weight) || 0, km = TMS.operation.distanceOf(t);
            var real = TMS.operation.costView(t);
            if (!real.total) return;
            if (t.dispatchType === 'ltl') {
                var v = TMS.network.pickVehicle(w, w * 4200, Number(t.pieces) || 1);
                var selfCost = TMS.pricing.tripCost({ vehicleTypeCode: v.code, mode: t.mode, distanceKm: km }, km);
                var loadPct = v.loadKg ? util.round(w / v.loadKg * 100, 1) : 0;
                var save = util.money(real.total - selfCost.total);
                if (save > Math.max(40, real.total * 0.06) && loadPct >= cfg.cost.selfLoadMin * 100) {
                    out.push({
                        id: t.id, code: TMS.operation.labelOf(t), mode: t.mode, weight: w, km: km,
                        chose: '外协舱位', choseCost: real.total, alt: '自有 ' + v.name, altCost: selfCost.total,
                        save: save, load: loadPct, perKg: util.round(real.total / w, 2),
                        reason: '装载率能到 ' + fmt.percent(loadPct) + '，整车计价比按公斤买舱位便宜'
                    });
                }
            } else {
                var carrier = capBestCarrier(t.mode);
                var ltl = TMS.pricing.ltlCost(w, km, carrier);
                var save2 = util.money(ltl.total - real.total);
                if (save2 > Math.max(40, real.total * 0.06)) {
                    out.push({
                        id: t.id, code: TMS.operation.labelOf(t), mode: t.mode, weight: w, km: km,
                        chose: '自有整车', choseCost: real.total, alt: '外协舱位（' + ((carrier || {}).name || '无协议方') + '）',
                        altCost: ltl.total, save: save2, load: Number(t.loadRate) || 0, perKg: util.round(real.total / w, 2),
                        reason: '整车放空跑：实载 ' + fmt.kg(w) + ' 摊在 ' + fmt.km(km) + ' 上，单公斤 ' + fmt.money(real.total / w)
                    });
                }
            }
        });
        return util.sortBy(out, 'save', 'desc').slice(0, 40);
    }

    function capGaps(rows) {
        var modes = capExclusiveRows();
        return {
            expired: rows.filter(function (r) { return r.contractDays < 0; }),
            expiring: rows.filter(function (r) { return r.contractDays >= 0 && r.contractDays <= 60; }),
            drift: rows.filter(function (r) { return r.drift != null && r.drift < -5; }),
            idle: rows.filter(function (r) { return r.status === 'active' && r.idle; }),
            apOver: rows.filter(function (r) { return r.apOver > 0; }),
            single: modes.filter(function (m) { return m.count <= 1; }),
            none: modes.filter(function (m) { return m.count === 0; })
        };
    }

    /* 班线图：直达 + 一次中转，是路由规划的底账；线路连通性只能从班次表算 */
    function laneIndex() {
        var trips = db.col('trips').filter(function (t) { return t.status === 'active'; });
        var direct = {};
        trips.forEach(function (t) { direct[t.fromHub + '>' + t.toHub] = t; });
        var hubs = db.col('hubs');
        var byFrom = util.groupBy(trips, 'fromHub');
        var byTo = util.groupBy(trips, 'toHub');
        var pairs = [];
        hubs.forEach(function (a) {
            hubs.forEach(function (b) {
                if (a.id === b.id) return;
                var key = a.id + '>' + b.id;
                if (direct[key]) { pairs.push({ from: a, to: b, trip: direct[key], hops: 1 }); return; }
                var best = null;
                (byFrom[a.id] || []).forEach(function (t1) {
                    var next = direct[t1.toHub + '>' + b.id];
                    if (!next) return;
                    var total = (Number(t1.transitHours) || 0) + (Number(next.transitHours) || 0);
                    if (!best || total < best.total) best = { t1: t1, t2: next, total: total };
                });
                pairs.push({ from: a, to: b, hops: best ? 2 : 0, via: best });
            });
        });
        return {
            trips: trips, direct: direct, pairs: pairs, byFrom: byFrom, byTo: byTo,
            noDirect: pairs.filter(function (p) { return p.hops !== 1; }),
            unreachable: pairs.filter(function (p) { return p.hops === 0; })
        };
    }

    function carModal(id) {
        var c = db.get('carriers', id);
        if (!c) { ui.toast('承运商不存在', 'warn'); return; }
        var v = carRows(30).filter(function (x) { return x.id === id; })[0];
        var mine = util.sortBy(capTransports(30).filter(function (t) { return t.carrierId === id; })
            .map(TMS.operation.tripView), 'date', 'desc').slice(0, 10);
        var aps = util.sortBy(db.col('payables').filter(function (p) { return p.refId === id; }), 'date', 'desc');
        var risk = [];
        if (v.contractDays < 0) risk.push('协议已到期仍在挂单：结算价失去依据，先续约再放货');
        else if (v.contractDays <= 60) risk.push('协议 ' + v.contractDays + ' 天后到期，续约谈判以实测准点率为准');
        if (v.drift != null && v.drift < -5) risk.push('实测准点率比档案低 ' + Math.abs(v.drift) + ' 个百分点，档案在服务评价里失真');
        if (v.apOver > 0) risk.push('有 ' + fmt.money(v.apOver) + ' 应付逾期，继续放货等于给它融资');
        var only = db.col('carriers').filter(function (x) { return x.status === 'active' && x.type === c.type; }).length;
        if ((c.type === '冷链' || c.type === '空运') && only <= 1) risk.push(c.type + ' 全网只有这一家协议方，停摆即断供：需要有备份承运商或应急外采方案');
        ui.modal({
            title: esc(v.name), size: 'wide',
            sub: esc(v.type) + ' 协议方 · ' + esc(v.settleCycle) + ' · 对接 ' + esc(v.contact || '—') + ' ' + statusBadge(v.status, CAR_TEXT),
            body: ui.stack([
                ui.kpis([
                    { label: '窗口车次', value: v.trips, unit: '班', sub: fmt.number(v.orders) + ' 单 / ' + fmt.number(v.weight) + ' kg' },
                    { label: '舱位支出', value: fmt.money(v.cost), tone: 'brand', sub: fmt.number(v.km) + ' km' },
                    { label: '成交单价', value: fmt.money(v.perKg), unit: '/kg', sub: '协议折扣 ' + fmt.percent(v.discount) },
                    { label: '实测准点', value: v.onTime == null ? '—' : fmt.percent(v.onTime), tone: v.drift != null && v.drift < -5 ? 'danger' : 'success', sub: '档案 ' + fmt.percent(v.bookOnTime) },
                    { label: '未结应付', value: fmt.money(v.apOpen), tone: v.apOver ? 'danger' : '', sub: v.apOver ? '其中逾期 ' + fmt.money(v.apOver) : '无逾期' }
                ]),
                ui.desc([
                    { label: '运输方式', value: esc(v.type) },
                    { label: '联系方式', value: dim(v.contact) + ' <span class="tms-dim">' + dim(v.phone) + '</span>' },
                    { label: '结算周期', value: esc(v.settleCycle) },
                    { label: '协议系数', value: v.rate + ' <span class="tms-dim">折扣 ' + fmt.percent(v.discount) + '，系数越低越省</span>' },
                    { label: '档案货损率', value: fmt.percent(v.damageRate / 10) + ' <span class="tms-dim">' + v.damageRate + ' ‰</span>' },
                    { label: '合同到期', value: esc(v.contractTo) + (v.contractDays >= 0 ? ' <span class="tms-dim">剩 ' + v.contractDays + ' 天</span>' : ' ' + ui.badge('已过期', 'danger')) },
                    { label: '迟到车次', value: v.late ? ui.badge(v.late + ' 班迟到', 'warn') : '窗口内全部准点' }
                ]),
                risk.length ? ui.notice(risk.map(function (t) { return '· ' + esc(t); }).join('<br>'), 'warn', '合作风险') : '',
                ui.card({ title: '近期舱位车次', sub: '外协零担按公斤结算，装载率不适用', flat: true, body: mine.length ? ui.table({
                    dense: true, keyName: 'id', rows: mine,
                    columns: [
                        { key: 'id', label: '车次', width: '126px', render: function (t) { return idLink(t.id, 'tp:open'); } },
                        { key: 'code', label: '线路' },
                        { key: 'weight', label: '实载', align: 'right', width: '96px', render: function (t) { return fmt.kg(t.weight); } },
                        { key: 'distanceKm', label: '里程', align: 'right', width: '92px', render: function (t) { return fmt.number(t.distanceKm); } },
                        { key: 'costPerKg', label: '成交单价', align: 'right', width: '104px', render: function (t) { return fmt.money(t.costPerKg); } },
                        { key: 'onTime', label: '准点', align: 'right', width: '84px', sortable: false, render: function (t) { return t.onTime ? '<span class="tone-success">准点</span>' : ui.badge('迟到', 'danger'); } }
                    ]
                }) : ui.empty('窗口内没有舱位车次', '可评估把自有线路转成买舱位') }),
                ui.card({
                    title: '应付与结算', sub: aps.length ? aps.length + ' 张，未结 ' + fmt.money(v.apOpen) : '无挂账', flat: true,
                    body: aps.length ? ui.table({
                        dense: true, keyName: 'id', rows: aps.slice(0, 8),
                        columns: [
                            { key: 'id', label: '应付单', width: '134px', render: function (p) { return idLink(p.id, 'ap:open'); } },
                            { key: 'category', label: '科目', width: '110px' },
                            { key: 'amount', label: '金额', align: 'right', width: '110px', render: function (p) { return ui.moneyCell(p.amount); } },
                            { key: 'dueDate', label: '到期', width: '104px' },
                            { key: 'status', label: '状态', align: 'right', width: '92px', sortable: false, render: function (p) { return statusBadge(p.status, AP_TEXT); } }
                        ]
                    }) : ui.empty('没有应付', '舱位费用不落账，运力成本就无法核对')
                })
            ]),
            footer: ui.btn('议价/续约', { tone: 'primary', size: 'sm', act: 'cap:contract', arg: c.id }) +
                ui.btn('结算到期应付', { size: 'sm', act: 'cap:settle', arg: c.id }) +
                ui.btn('看车次', { size: 'sm', tone: 'ghost', act: 'cap:trips', arg: c.id }) +
                ui.btn('关闭', { size: 'sm', act: 'ui:close' })
        });
    }

    function carFormModal(id) {
        var c = id ? db.get('carriers', id) : null;
        ui.formModal({
            title: c ? '维护承运商协议' : '新增协议承运商',
            sub: c ? esc(c.name) + ' · 改协议价即改零担报价，历史车次成本不追溯' : '新协议方落地后才会进入调度择优的候选池',
            notice: '冷链与空运是全网稀缺运力：如果这是该方式唯一在册协议方，暂停合作会让对应产品直接无法交付。',
            fields: [
                { key: 'name', label: '名称', required: true },
                { key: 'type', label: '运输方式', type: 'select', required: true, options: ui.optionsOf(CAR_MODES) },
                { key: 'contact', label: '对接人', required: true },
                { key: 'phone', label: '联系电话', required: true },
                { key: 'settleCycle', label: '结算周期', type: 'select', options: ui.optionsOf(['现结', '半月结', '月结', '季结']) },
                { key: 'rate', label: '协议系数', type: 'number', step: '0.001', min: 0.6, max: 0.95, required: true, tip: '0.600~0.950，越低折扣越大', hint: '折后价 = 零担基准价 ×（1 − 折扣）' },
                { key: 'contractTo', label: '合同到期', type: 'date', required: true },
                { key: 'status', label: '合作状态', type: 'select', options: Object.keys(CAR_TEXT).map(function (k) { return { value: k, label: CAR_TEXT[k] }; }) },
                { key: 'operator', label: '经办人', required: true }
            ],
            values: c ? {
                name: c.name, type: c.type, contact: c.contact, phone: c.phone, settleCycle: c.settleCycle,
                rate: c.rate, contractTo: c.contractTo, status: c.status, operator: actor()
            } : { type: '陆运', settleCycle: '月结', rate: 0.88, status: 'active', operator: actor(), contractTo: util.dateKey(util.addDays(util.now(), 365)) },
            okText: '保存协议',
            onSubmit: function (data) {
                var name = String(data.name || '').trim();
                if (!name) return '名称必填';
                if (db.col('carriers').some(function (x) { return x.name === name && x.id !== (c ? c.id : ''); })) return '同名承运商已存在';
                var rate = util.round(Number(data.rate) || 0, 3);
                if (!(rate >= 0.6 && rate <= 0.95)) return '协议系数必须落在 0.600~0.950，超出区间报价就脱离成本模型了';
                var to = util.toDate(data.contractTo);
                if (isNaN(to)) return '合同到期日期不合法';
                if (!data.contact || !data.phone) return '对接人与联系电话必填：出险联系不上承运商是最贵的等待';
                var onlyLeft = db.col('carriers').filter(function (x) {
                    return x.status === 'active' && x.type === data.type && x.id !== (c ? c.id : '');
                }).length;
                if (data.status !== 'active' && (data.type === '冷链' || data.type === '空运') && onlyLeft === 0) {
                    return data.type + ' 没有其他在册协议方，暂停后冷链件与航空件无人可派';
                }
                var patch = {
                    name: name, type: data.type, contact: String(data.contact).trim(), phone: String(data.phone).trim(),
                    settleCycle: data.settleCycle, rate: rate, contractTo: util.dateKey(to), status: data.status
                };
                var saved = c ? (db.update('carriers', c.id, patch), db.get('carriers', c.id)) : db.create('carriers', patch);
                saveRow('carriers', saved, 'carrier:save');
                TMS.audit.log('carrier.update', 'carriers', saved.id,
                    (c ? '维护' : '新增') + '协议方 ' + saved.name + '（' + saved.type + '），系数 ' + saved.rate +
                    '，账期 ' + saved.settleCycle + '，合同至 ' + saved.contractTo + '，状态 ' + (CAR_TEXT[saved.status] || saved.status),
                    data.operator || actor());
                ui.toast('已保存协议方「' + saved.name + '」', 'success');
                for (var i = 0; i < 2; i++) TMS.ui.closeTop();
            }
        });
    }

    function carContractModal(id) {
        var c = db.get('carriers', id);
        if (!c) { ui.toast('承运商不存在', 'warn'); return; }
        var v = carView(c, util.groupBy(capTransports(30).filter(function (t) { return t.carrierId === c.id; }), 'carrierId'));
        ui.formModal({
            title: '议价与续约', sub: esc(c.name) + ' · 现合同至 ' + esc(c.contractTo) + '，实测准点 ' + (v.onTime == null ? '无数据' : fmt.percent(v.onTime)),
            notice: '议价依据用实测数据，不用感觉：成交单价、迟到班次、逾期应付都在这轮谈判里算账。',
            fields: [
                { key: 'rate', label: '新协议系数', type: 'number', step: '0.001', min: 0.6, max: 0.95, required: true },
                { key: 'contractTo', label: '新到期日', type: 'date', required: true },
                { key: 'onTimeRate', label: '档案准点率', type: 'number', step: '0.001', min: 0, max: 1, tip: '按窗口实测回填，别让档案常年挂着 0.95', hint: v.onTime == null ? '窗口内无车次，可留空' : ('实测 ' + util.round(v.onTime / 100, 3)) },
                { key: 'clause', label: '附加条款', type: 'textarea', rows: 3, placeholder: '旺季保舱、迟到赔付、货损免赔额' },
                { key: 'operator', label: '经办人', required: true }
            ],
            values: { rate: c.rate, contractTo: util.dateKey(util.addDays(util.now(), 365)), operator: actor() },
            okText: '签新约',
            onSubmit: function (data) {
                var rate = util.round(Number(data.rate) || 0, 3);
                if (!(rate >= 0.6 && rate <= 0.95)) return '协议系数必须落在 0.600~0.950';
                var to = util.toDate(data.contractTo);
                if (isNaN(to) || to.getTime() <= util.now().getTime()) return '新到期日必须晚于今天';
                var patch = { rate: rate, contractTo: util.dateKey(to) };
                if (data.onTimeRate !== '' && data.onTimeRate != null) {
                    var ot = util.round(Number(data.onTimeRate), 3);
                    if (!(ot >= 0 && ot <= 1)) return '准点率要填 0~1 的小数';
                    patch.onTimeRate = ot;
                }
                if (data.clause) patch.clause = String(data.clause).trim();
                db.update('carriers', c.id, patch);
                saveRow('carriers', c, 'carrier:contract');
                TMS.audit.log('carrier.contract', 'carriers', c.id,
                    '议价 ' + c.rate + ' → ' + rate + '，续约至 ' + util.dateKey(to) +
                    (patch.onTimeRate ? '，档案准点率更新为 ' + patch.onTimeRate : '') +
                    (patch.clause ? '，条款：' + patch.clause : ''), data.operator || actor());
                ui.toast('已与「' + c.name + '」重签协议', 'success');
                for (var i = 0; i < 2; i++) TMS.ui.closeTop();
            }
        });
    }

    function reviewModal(rows) {
        ui.modal({
            title: '运力择优复盘', size: 'wide',
            sub: rows.length ? rows.length + ' 个车次的另一种运力更省，合计可省 ' + fmt.money(util.money(util.sum(rows, 'save'))) : '窗口内没有明显选错运力的车次',
            body: ui.stack([
                rows.length ? ui.table({
                    dense: true, keyName: 'id', rows: rows,
                    columns: [
                        { key: 'code', label: '车次', render: function (r) { return ui.link(esc(r.code), 'tp:open', r.id) + '<div class="tms-dim">' + esc(r.reason) + '</div>'; } },
                        { key: 'weight', label: '实载', align: 'right', width: '92px', render: function (r) { return fmt.kg(r.weight); } },
                        { key: 'km', label: '里程', align: 'right', width: '86px', render: function (r) { return fmt.number(r.km); } },
                        { key: 'chose', label: '实际选择', width: '128px', render: function (r) { return esc(r.chose) + '<div class="tms-dim">' + fmt.money(r.choseCost) + '</div>'; } },
                        { key: 'alt', label: '更省方案', width: '150px', render: function (r) { return esc(r.alt) + '<div class="tms-dim">' + fmt.money(r.altCost) + '</div>'; } },
                        { key: 'load', label: '可达装载率', align: 'right', width: '104px', render: function (r) { return rateBar(r.load, { target: 70 }); } },
                        { key: 'save', label: '可省', align: 'right', width: '108px', render: function (r) { return '<b class="tone-success">' + fmt.money(r.save) + '</b>'; } }
                    ]
                }) : ui.empty('没有明显错配', '两条运力路径的差价都在容差内'),
                ui.notice('整车按「公里成本 + 司机补贴 + 日折旧」计价，装不满就是纯亏；零担按公斤报价还有最低一票。差价超过 6% 且装载率能到 ' + fmt.percent(cfg.cost.selfLoadMin * 100) + ' 以上才计入本表，否则属于合理容差。', '', '算账口径')
            ]),
            footer: ui.btn('导出复盘清单', { size: 'sm', tone: 'ghost', act: 'cap:exportReview' }) +
                ui.btn('关闭', { size: 'sm', act: 'ui:close' })
        });
    }

    function laneModal(hubId) {
        var h = db.get('hubs', hubId);
        if (!h) { ui.toast('分拨不存在', 'warn'); return; }
        var lx = laneIndex();
        var out = lx.trips.filter(function (t) { return t.fromHub === hubId; });
        var inn = lx.trips.filter(function (t) { return t.toHub === hubId; });
        var table = function (list, label) {
            return ui.card({
                title: label, sub: list.length + ' 条活动班次', flat: true,
                body: list.length ? ui.table({
                    dense: true, keyName: 'id', rows: list,
                    columns: [
                        { key: 'code', label: '班次', render: function (t) { return esc(t.code); } },
                        { key: 'mode', label: '方式', width: '72px' },
                        { key: 'departAt', label: '发车', width: '80px' },
                        { key: 'transitHours', label: '干线时长', align: 'right', width: '96px', render: function (t) { return fmt.duration(t.transitHours); } },
                        { key: 'distanceKm', label: '里程', align: 'right', width: '92px', render: function (t) { return fmt.number(t.distanceKm); } },
                        { key: 'capacityKg', label: '舱位', align: 'right', width: '104px', render: function (t) { return fmt.number(t.capacityKg) + ' kg'; } },
                        { key: 'onTimeRate', label: '准点', align: 'right', width: '84px', render: function (t) { return fmt.percent(util.round((Number(t.onTimeRate) || 0) * 100, 1)); } }
                    ]
                }) : ui.empty('没有班次', '这条方向的件都要绕行')
            });
        };
        ui.modal({
            title: esc(h.name) + ' 班线图', size: 'wide',
            sub: '发出 ' + out.length + ' 条 · 到达 ' + inn.length + ' 条 · 分拣线 ' + (h.sortLines || 0) + ' 条',
            body: ui.stack([table(out, '发出班次'), table(inn, '到达班次')]),
            footer: ui.btn('关发车次调度', { size: 'sm', act: 'cap:goTransport', arg: h.id }) + ui.btn('关闭', { size: 'sm', act: 'ui:close' })
        });
    }

    pg.define('capacity', {
        sub: '运力资源：自有整车与协议承运商舱位两条路径的真实成本对照，含班线图与运力择优复盘',
        load: function (ctx) {
            applyParamFilter(ctx, ['type', 'status']);
            var days = Math.max(7, Number(ctx.days) || 30);
            var rows = carRows(days);
            var win = capTransports(days);
            var ltl = win.filter(function (t) { return t.dispatchType === 'ltl'; });
            var self = win.filter(function (t) { return t.dispatchType !== 'ltl'; });
            var lx = laneIndex();
            var byHub = db.col('hubs').map(function (h) {
                var o = lx.byFrom[h.id] || [], i = lx.byTo[h.id] || [];
                return {
                    id: h.id, name: h.name, city: h.city, zone: h.zone, out: o.length, inn: i.length,
                    capacityKg: util.round(util.sum(o, 'capacityKg'), 0),
                    avgHours: o.length ? util.round(util.sum(o, 'transitHours') / o.length, 1) : 0,
                    onTime: o.length ? util.round(util.sum(o, 'onTimeRate') / o.length * 100, 1) : 0
                };
            });
            var balance = TMS.master.VEHICLE_TYPES.filter(function (t) { return t.loadKg >= 1500; }).map(function (t) {
                return {
                    label: t.name, code: t.code,
                    values: BALANCE_KMS.map(function (km) { return TMS.pricing.breakEvenKg(t.code, km, '陆运'); })
                };
            });
            var ltlCost = util.money(util.sum(ltl, TMS.operation.costTotal));
            var selfCost = util.money(util.sum(self, TMS.operation.costTotal));
            var ltlKg = util.round(util.sum(ltl, function (t) { return Number(t.weight) || 0; }), 1);
            var selfKg = util.round(util.sum(self, function (t) { return Number(t.weight) || 0; }), 1);
            var selfLoad = self.length ? util.round(util.sum(self, function (t) { return Number(t.loadRate) || 0; }) / self.length, 1) : 0;
            var gaps = capGaps(rows);
            var modes = capExclusiveRows();
            return {
                rows: rows, win: win, lx: lx, byHub: byHub, balance: balance,
                gaps: gaps, modes: modes,
                ltlCount: ltl.length, selfCount: self.length,
                ltlCost: ltlCost, selfCost: selfCost, ltlPerKg: ltlKg ? util.round(ltlCost / ltlKg, 2) : 0,
                selfPerKg: selfKg ? util.round(selfCost / selfKg, 2) : 0, selfLoad: selfLoad,
                ltlShare: win.length ? util.round(ltl.length / win.length * 100, 1) : 0,
                apOpen: util.money(util.sum(rows, 'apOpen')), apOver: util.money(util.sum(rows, 'apOver')),
                gapCount: gaps.expired.length + gaps.expiring.length + gaps.drift.length +
                    gaps.apOver.length + gaps.single.length + gaps.none.length
            };
        },
        render: function (ctx, d) {
            var kpi = ui.kpis([
                { label: '协议承运商', value: d.rows.length, unit: '家', icon: '⛰', sub: '在营 ' + d.rows.filter(function (r) { return r.status === 'active'; }).length + ' 家' },
                { label: '窗口舱位车次', value: d.ltlCount, unit: '班', icon: '▦', tone: 'brand', sub: '占总车次 ' + fmt.percent(d.ltlShare) },
                { label: '舱位单价', value: fmt.money(d.ltlPerKg), unit: '/kg', icon: '¥', sub: '支出 ' + fmt.money(d.ltlCost) },
                { label: '自有单价', value: fmt.money(d.selfPerKg), unit: '/kg', icon: '⛟', tone: d.selfPerKg > d.ltlPerKg ? 'warn' : 'success', sub: d.selfCount + ' 班 · 装载率 ' + fmt.percent(d.selfLoad) },
                { label: '活动班次', value: d.lx.trips.length, unit: '条', icon: '⇄', sub: '无直达线路 ' + d.lx.noDirect.length + ' 对' },
                { label: '运力体检', value: d.gapCount, unit: '项', icon: '⚑', tone: d.gapCount ? 'warn' : 'success', sub: '逾期未付 ' + fmt.money(d.apOver) }
            ]);
            var priceCard = ui.card({
                title: '整车盈亏平衡公斤数', sub: '行是车型、列是里程，数值是「自有至少装到这么多公斤才比买舱位划算」', flat: true,
                tools: ui.btn('择优复盘', { size: 'sm', act: 'cap:review', icon: '⚖' }),
                body: ch.heat({ cols: BALANCE_KMS.map(function (k) { return k + ' km'; }), rows: d.balance, cell: 44 })
            });
            var mixCard = ui.card({
                title: '两条运力路径对照', sub: '同一窗口内的真实成交单价差', flat: true,
                body: ui.stack([
                    ch.compare({
                        rowH: 34,
                        data: [
                            { label: '舱位 元/kg', value: d.ltlPerKg, target: d.selfPerKg, text: fmt.money(d.ltlPerKg), color: '#1668dc' },
                            { label: '自有 元/kg', value: d.selfPerKg, target: d.ltlPerKg, text: fmt.money(d.selfPerKg), color: d.selfPerKg > d.ltlPerKg ? '#d33b3b' : '#2e9e5b' }
                        ]
                    }),
                    ui.meter([
                        { value: d.ltlCost, color: '#1668dc' },
                        { value: d.selfCost, color: '#2e9e5b' }
                    ]),
                    ui.desc([
                        { label: '外协支出', value: fmt.money(d.ltlCost) + '（' + d.ltlCount + ' 班）' },
                        { label: '自有支出', value: fmt.money(d.selfCost) + '（' + d.selfCount + ' 班 · 装载率 ' + fmt.percent(d.selfLoad) + '）' },
                        { label: '合计干线成本', value: fmt.money(util.money(d.ltlCost + d.selfCost)) }
                    ], { inline: true })
                ])
            });
            var hubCard = ui.card({
                title: '枢纽班线覆盖', sub: '发出/到达班次数与平均干线时长，点进去看具体班次', flat: true,
                body: ui.table({
                    dense: true, keyName: 'id', rows: util.sortBy(d.byHub, 'out', 'desc'),
                    columns: [
                        { key: 'name', label: '分拨', render: function (r) { return ui.link(esc(r.name), 'cap:lane', r.id) + '<div class="tms-dim">' + esc(r.city) + ' · ' + esc(r.zone) + '</div>'; } },
                        { key: 'out', label: '发出', align: 'right', width: '84px', render: function (r) { return r.out ? fmt.number(r.out) + ' 条' : ui.badge('无发出班次', 'danger'); } },
                        { key: 'inn', label: '到达', align: 'right', width: '84px', render: function (r) { return fmt.number(r.inn) + ' 条'; } },
                        { key: 'capacityKg', label: '日舱位', align: 'right', width: '112px', render: function (r) { return fmt.number(r.capacityKg) + ' kg'; } },
                        { key: 'avgHours', label: '均时长', align: 'right', width: '96px', render: function (r) { return r.avgHours ? fmt.duration(r.avgHours) : '<span class="tms-dim">—</span>'; } },
                        { key: 'onTime', label: '班次准点', align: 'right', width: '150px', render: function (r) { return r.onTime ? rateBar(r.onTime, { target: 92 }) : '<span class="tms-dim">—</span>'; } }
                    ]
                })
            });
            var gapCard = ui.card({
                title: '运力体检', sub: '稀缺运力、过期协议、服务档案漂移——三样都会直接反映在成本上',
                tone: d.gapCount ? 'danger' : '', flat: true,
                body: ui.list([
                    {
                        title: '协议 60 天内到期 ' + ui.badge(d.gaps.expiring.length + ' 家', d.gaps.expiring.length ? 'warn' : 'success'),
                        sub: d.gaps.expiring.length ? d.gaps.expiring.slice(0, 5).map(function (r) { return esc(r.name + ' 剩 ' + r.contractDays + ' 天'); }).join('、') : '全部协议余量充足',
                        right: d.gaps.expiring.length ? ui.btn('去续约', { size: 'sm', tone: 'warn', act: 'cap:contract', arg: d.gaps.expiring[0].id }) : ''
                    },
                    {
                        title: '协议已过期 ' + ui.badge(d.gaps.expired.length + ' 家', d.gaps.expired.length ? 'danger' : 'success'),
                        sub: d.gaps.expired.length ? d.gaps.expired.map(function (r) { return esc(r.name + '(' + r.contractTo + ')'); }).join('、') + '：过期还能挂单说明协议没有真在管' : '无过期协议',
                        right: d.gaps.expired.length ? ui.btn('立即续签', { size: 'sm', tone: 'danger', act: 'cap:contract', arg: d.gaps.expired[0].id }) : ''
                    },
                    {
                        title: '服务档案漂移 ' + ui.badge(d.gaps.drift.length + ' 家', d.gaps.drift.length ? 'warn' : 'success'),
                        sub: d.gaps.drift.length ? d.gaps.drift.slice(0, 5).map(function (r) { return esc(r.name + ' 实测 ' + fmt.percent(r.onTime) + '/档案 ' + fmt.percent(r.bookOnTime)); }).join('、') + '：档案好看但实际迟到，评价与议价都要重算' : '实测准点率不低于档案 5 个点',
                        right: d.gaps.drift.length ? ui.btn('回填档案', { size: 'sm', act: 'cap:fixRate' }) : ''
                    },
                    {
                        title: '稀缺运力 ' + ui.badge(d.gaps.single.length + ' 类只有一家', d.gaps.single.length ? 'danger' : 'success'),
                        sub: d.gaps.single.length ? d.gaps.single.map(function (m) { return esc(m.mode + '：' + (m.carriers[0] || '无')); }).join('、') + '：停摆即断供，需要有备份协议方' : '冷链/空运均有可替换协议方',
                        right: d.gaps.none.length ? ui.btn('补签运力', { size: 'sm', tone: 'danger', act: 'cap:new' }) : ''
                    },
                    {
                        title: '逾期应付 ' + ui.badge(fmt.money(d.apOver), d.apOver ? 'danger' : 'success'),
                        sub: d.apOver ? '逾期未付还继续放货，等于替承运商融资，议价地位也会丢' : '舱位结算及时',
                        right: d.apOver ? ui.btn('去成本应付', { size: 'sm', tone: 'ghost', act: 'cap:goPayable' }) : ''
                    },
                    {
                        title: '无直达班次线路 ' + ui.badge(d.lx.noDirect.length + ' 对', d.lx.noDirect.length ? 'warn' : 'success'),
                        sub: d.lx.unreachable.length ? '其中 ' + d.lx.unreachable.length + ' 对连一次中转都排不出来，只能落地分拨拼车：' + d.lx.unreachable.slice(0, 4).map(function (p) { return esc(p.from.city + '→' + p.to.city); }).join('、') : '所有城市对都能直达或一次中转',
                        right: d.lx.unreachable.length ? ui.btn('去加线', { size: 'sm', tone: 'warn', act: 'cap:goNetwork' }) : ''
                    },
                    {
                        title: '在营但窗口无成交 ' + ui.badge(d.gaps.idle.length + ' 家', d.gaps.idle.length ? 'muted' : 'success'),
                        sub: d.gaps.idle.length ? d.gaps.idle.slice(0, 5).map(function (r) { return esc(r.name); }).join('、') + '：占协议资源不产出，可下调份额或退出' : '协议方均有份额'
                    }
                ])
            });
            var listCard = grid(ctx, {
                title: '承运商协议台账', sub: '档案价与窗口成交价并列，差得远就是没在管', rows: d.rows, keyName: 'id',
                dense: true, onRow: 'cap:carrier', searchKey: 'q',
                filter: function (r, fs) {
                    if (fs.type && r.type !== fs.type) return false;
                    if (fs.status && r.status !== fs.status) return false;
                    var c = fs.chip || '';
                    if (c === 'risk' && !(r.contractDays <= 60 || (r.drift != null && r.drift < -5) || r.apOver > 0)) return false;
                    if (c === 'idle' && r.trips) return false;
                    if (c === 'late' && !(r.late > 0)) return false;
                    return true;
                },
                search: function (r) { return [r.id, r.name, r.contact, r.phone, r.type].join(' '); },
                chips: [
                    { label: '全部', value: '', count: d.rows.length },
                    { label: '有风险', value: 'risk', count: d.rows.filter(function (r) { return r.contractDays <= 60 || (r.drift != null && r.drift < -5) || r.apOver > 0; }).length },
                    { label: '窗口无成交', value: 'idle', count: d.gaps.idle.length },
                    { label: '有迟到班次', value: 'late', count: d.rows.filter(function (r) { return r.late > 0; }).length }
                ], chipsName: 'chip',
                fields: [
                    { key: 'q', type: 'search', label: '承运商 / 对接人', placeholder: '顺达快运 / 调度1' },
                    { key: 'type', label: '运输方式', options: [{ value: '', label: '全部方式' }].concat(ui.optionsOf(CAR_MODES)) },
                    { key: 'status', label: '状态', options: [{ value: '', label: '全部状态' }].concat(Object.keys(CAR_TEXT).map(function (k) { return { value: k, label: CAR_TEXT[k] }; })) }
                ],
                tools: ui.btn('新增协议方', { size: 'sm', tone: 'primary', act: 'cap:new', icon: '+' }) +
                    ui.btn('导出', { size: 'sm', tone: 'ghost', act: 'cap:export', icon: '↓' }),
                columns: [
                    {
                        key: 'name', label: '承运商', render: function (r) {
                            return ui.link(esc(r.name), 'cap:carrier', r.id) + ' ' + ui.badge(r.type, r.type === '空运' ? 'info' : (r.type === '冷链' ? 'accent' : 'muted')) +
                                '<div class="tms-dim">' + esc(r.settleCycle) + ' · 对接 ' + esc(r.contact || '—') + '</div>';
                        }
                    },
                    { key: 'trips', label: '班次', align: 'right', width: '76px', render: function (r) { return r.trips ? fmt.number(r.trips) : '<span class="tms-dim">0</span>'; } },
                    { key: 'weight', label: '货重', align: 'right', width: '104px', render: function (r) { return fmt.number(r.weight) + ' kg'; } },
                    { key: 'cost', label: '舱位支出', align: 'right', width: '120px', render: function (r) { return r.cost ? fmt.money(r.cost) : '<span class="tms-dim">—</span>'; } },
                    { key: 'perKg', label: '成交单价', align: 'right', width: '104px', render: function (r) { return r.perKg ? fmt.money(r.perKg) : '<span class="tms-dim">—</span>'; } },
                    { key: 'discount', label: '协议折扣', align: 'right', width: '104px', render: function (r) { return fmt.percent(r.discount) + ' <span class="tms-dim">' + r.rate + '</span>'; } },
                    {
                        key: 'onTime', label: '准点（实测/档案）', align: 'right', width: '160px', render: function (r) {
                            if (r.onTime == null) return '<span class="tms-dim">无数据 / ' + fmt.percent(r.bookOnTime) + '</span>';
                            return (r.drift < -5 ? '<span class="tone-danger">' : '') + fmt.percent(r.onTime) + (r.drift < -5 ? '</span>' : '') +
                                ' <span class="tms-dim">/ ' + fmt.percent(r.bookOnTime) + '</span>' + (r.late ? ' ' + ui.badge(r.late + ' 迟', 'warn') : '');
                        }
                    },
                    { key: 'apOpen', label: '未结应付', align: 'right', width: '124px', render: function (r) { return r.apOpen ? (fmt.money(r.apOpen) + (r.apOver ? ' ' + ui.badge('逾期', 'danger') : '')) : '<span class="tms-dim">—</span>'; } },
                    {
                        key: 'contractTo', label: '合同到期', align: 'right', width: '128px', render: function (r) {
                            return esc(r.contractTo) + ' ' + (r.contractDays < 0 ? ui.badge('已过期', 'danger') : (r.contractDays <= 60 ? ui.badge('剩 ' + r.contractDays + ' 天', 'warn') : ''));
                        }
                    },
                    { key: 'status', label: '状态', align: 'right', width: '88px', sortable: false, render: function (r) { return statusBadge(r.status, CAR_TEXT); } },
                    {
                        key: 'ops', label: '操作', align: 'right', width: '124px', sortable: false, render: function (r) {
                            return ui.link('协议', 'cap:contract', r.id, { tone: 'ghost' }) + ' ' +
                                ui.link('结算', 'cap:settle', r.id, { tone: 'ghost' }) + ' ' +
                                ui.link('车次', 'cap:trips', r.id, { tone: 'ghost' });
                        }
                    }
                ],
                emptyText: '没有符合条件的承运商'
            });
            return wrap(ctx, {
                actions: ui.btn('新增协议方', { tone: 'primary', act: 'cap:new', icon: '+' }) +
                    ui.btn('运力择优复盘', { act: 'cap:review', icon: '⚖' }),
                body: [kpi, ui.split('2', [priceCard, mixCard]), hubCard, gapCard, listCard]
            });
        },
        actions: {
            'cap:carrier': function (id) { carModal(id); },
            'cap:edit': function (id) { carFormModal(id); },
            'cap:new': function () { carFormModal(''); },
            'cap:contract': function (id) { carContractModal(id); },
            'cap:lane': function (hubId) { laneModal(hubId); },
            'tp:open': gotoTrip,
            'ap:open': gotoPayable,
            'cap:review': function () {
                var ctx = curCtx();
                reviewModal(capReview(capTransports(Math.max(7, Number(ctx.days) || 14)), 140));
            },
            'cap:trips': function (id) {
                var c = db.get('carriers', id);
                ui.closeTop();
                TMS.shell.go('transport', { q: c ? c.name : '' });
            },
            'cap:goTransport': function (hubId) { ui.closeTop(); TMS.shell.go('transport', { hub: hubId }); },
            'cap:goPayable': function () { ui.closeTop(); TMS.shell.go('payable'); },
            'cap:goNetwork': function () { ui.closeTop(); TMS.shell.go('network'); },
            'cap:settle': function (id) {
                var c = db.get('carriers', id);
                if (!c) { ui.toast('承运商不存在', 'warn'); return; }
                var rows = db.col('payables').filter(function (p) {
                    return p.refId === id && p.status === 'pending' && util.toDate(p.dueDate) <= util.now();
                });
                if (!rows.length) { ui.toast(c.name + ' 没有到期未付的应付', 'info'); return; }
                var total = util.money(util.sum(rows, 'amount'));
                ui.confirm({
                    title: '结算 ' + c.name + ' 的到期应付', okText: '确认结算',
                    message: rows.length + ' 张到期应付，合计 ' + fmt.money(total),
                    detail: '结算当场生成支出流水，运力成本与财务账同步；未到期单据保持待结算。'
                }).then(function (yes) {
                    if (!yes) return;
                    var n = 0;
                    db.batch(function () {
                        rows.forEach(function (p) { if (TMS.finance.settlePayable(p.id, { operator: actor() })) n++; });
                    }, 'carrier:settle');
                    TMS.audit.log('carrier.settle', 'carriers', c.id, '结算到期应付 ' + n + ' 张共 ' + fmt.money(total), actor());
                    ui.toast('已结算 ' + n + ' 张，' + fmt.money(total), 'success');
                    TMS.shell.refresh();
                });
            },
            'cap:fixRate': function () {
                var rows = carRows(30).filter(function (r) { return r.drift != null && Math.abs(r.drift) > 2; });
                if (!rows.length) { ui.toast('档案准点率与实测一致，无需回填', 'info'); return; }
                ui.confirm({
                    title: '按实测回填服务档案', okText: '回填 ' + rows.length + ' 家',
                    message: rows.length + ' 家承运商的档案准点率与窗口实测差 2 个百分点以上。',
                    detail: rows.slice(0, 8).map(function (r) { return esc(r.name + ' ' + fmt.percent(r.bookOnTime) + '→' + fmt.percent(r.onTime)); }).join('<br>') +
                        '<br>档案是议价与份额分配的依据，常年不回填就等于用过期数据做决策。'
                }).then(function (yes) {
                    if (!yes) return;
                    db.batch(function () {
                        rows.forEach(function (r) {
                            db.update('carriers', r.id, { onTimeRate: util.round(r.onTime / 100, 3) });
                            db.commit('carriers', r.id, 'carrier:rate');
                        });
                    }, 'carrier:rate');
                    TMS.audit.log('carrier.rate', 'carriers', '', '按近 30 天实测回填 ' + rows.length + ' 家承运商准点率档案', actor());
                    ui.toast('已回填 ' + rows.length + ' 家档案', 'success');
                    TMS.shell.refresh();
                });
            },
            'cap:export': function () { exportCars(carRows(30)); },
            'cap:exportReview': function () {
                var ctx = curCtx();
                exportCars(capReview(capTransports(Math.max(7, Number(ctx.days) || 14)), 140), '运力择优复盘.csv', true);
            }
        }
    });

    function exportCars(rows, name, isReview) {
        if (isReview) {
            return exportGrid({
                name: name || '运力择优复盘.csv', rows: rows,
                cols: [
                    { key: 'id', label: '车次' }, { key: 'code', label: '线路' }, { key: 'mode', label: '方式' },
                    { key: 'weight', label: '实载kg' }, { key: 'km', label: '里程' },
                    { key: 'chose', label: '实际选择' }, { key: 'choseCost', label: '实际成本' },
                    { key: 'alt', label: '更省方案' }, { key: 'altCost', label: '方案成本' },
                    { key: 'save', label: '可省' }, { key: 'load', label: '装载率%' }, { key: 'reason', label: '判定依据' }
                ]
            });
        }
        return exportGrid({
            name: name || '承运商协议台账.csv', rows: rows,
            cols: [
                { key: 'id', label: '编号' }, { key: 'name', label: '承运商' }, { key: 'type', label: '方式' },
                { key: 'contact', label: '对接人' }, { key: 'phone', label: '电话' }, { key: 'settleCycle', label: '账期' },
                { key: 'rate', label: '协议系数' }, { key: 'discount', label: '协议折扣%' },
                { key: 'trips', label: '窗口班次' }, { key: 'orders', label: '在车单量' },
                { key: 'weight', label: '货重kg' }, { key: 'km', label: '里程' }, { key: 'cost', label: '舱位支出' },
                { key: 'perKg', label: '成交单价' }, { key: 'onTime', label: '实测准点%' }, { key: 'bookOnTime', label: '档案准点%' },
                { key: 'late', label: '迟到班次' }, { key: 'damageRate', label: '货损‰' },
                { key: 'apCount', label: '应付张数' }, { key: 'apOpen', label: '未结应付' }, { key: 'apOver', label: '逾期应付' },
                { key: 'contractTo', label: '合同到期' },
                { key: 'status', label: '状态', value: function (r) { return CAR_TEXT[r.status] || r.status; } }
            ]
        });
    }

    /* ---------- 二十六、仓储库存 ---------- */
    var WH_TEXT = { active: '在用', closed: '停用' };
    var WH_TYPES = ['自营仓', '租赁仓', '分拨仓中仓'];
    var MOV_TEXT = { in: '入库', out: '领用出库', adjust: '盘点调整', purchase: '采购在途' };
    var OUT_USES = ['分拨包装领用', '网点耗材领用', '冷链冰袋周转', '面单打印消耗', '托盘周转调用'];
    var IN_SOURCES = ['采购到货', '退货回库', '仓间调拨入', '盘盈入账'];
    var AGE_BUCKETS = ['24 小时内', '1~3 天', '3~7 天', '超 7 天'];

    /* 库存流水是唯一事实：in 加、out 减、adjust 带符号、purchase 只是凭证不动库存（到货才入账）。
       库存行只存当前数量，任何一次改动都必须有对应流水，否则账实核对就是空话 */
    function mvSigned(m) {
        if (m.kind === 'out') return -(Number(m.qty) || 0);
        if (m.kind === 'in' || m.kind === 'adjust') return Number(m.qty) || 0;
        return 0;
    }

    function stockCtx(days) {
        var win = util.addDays(util.now(), -(days || 30)).getTime();
        var ctx = { days: days || 30, ledger: {}, byWh: {}, byMat: {}, pending: [], total: 0 };
        db.col('stockMovements').forEach(function (m) {
            ctx.total++;
            var k = m.warehouseId + '|' + m.materialId;
            ctx.ledger[k] = (ctx.ledger[k] || 0) + mvSigned(m);
            if (m.kind === 'purchase' && m.status === 'pending') ctx.pending.push(m);
            if (util.toDate(m.date || m.createdAt).getTime() < win) return;
            (ctx.byWh[m.warehouseId] || (ctx.byWh[m.warehouseId] = [])).push(m);
            (ctx.byMat[m.materialId] || (ctx.byMat[m.materialId] = [])).push(m);
        });
        return ctx;
    }

    function mvOf(list, days) {
        var cutoff = util.addDays(util.now(), -(days || 30)).getTime();
        return util.sortBy(list.filter(function (m) {
            return util.toDate(m.date || m.createdAt).getTime() >= cutoff;
        }), 'createdAt', 'desc');
    }

    /* 在库货物从订单状态反算：停在「已入库」就是压在原分拨库，停在「已到件」就是压在目的分拨库。
       仓库档案里的 usedPieces 是上次盘点写下的静态数，两个数对不上说明账面早已失真 */
    function goodsByHub() {
        var idx = TMS.order.scanIndex();
        var out = {};
        db.col('orders').forEach(function (o) {
            var hub = '', at = '';
            if (o.status === 'inbound') { hub = o.hubFrom; at = TMS.order.stageAt(o, 'inbound', idx[o.id]); }
            else if (o.status === 'arrived') { hub = o.hubTo; at = TMS.order.stageAt(o, 'arrived', idx[o.id]); }
            if (!hub) return;
            var hours = Math.max(0, util.hoursBetween(at || o.updatedAt || o.createdAt, util.now()));
            var g = out[hub] || (out[hub] = { hubId: hub, orders: [], pieces: 0, weight: 0, buckets: [0, 0, 0, 0], aged: 0, maxHours: 0 });
            g.pieces += Number(o.pieces) || 1;
            g.weight += Number(o.chargeableWeight) || 0;
            g.buckets[hours < 24 ? 0 : (hours < 72 ? 1 : (hours < 168 ? 2 : 3))]++;
            if (hours > 48) g.aged++;
            if (hours > g.maxHours) g.maxHours = hours;
            g.orders.push({
                id: o.id, origin: o.origin, destination: o.destination, service: o.service,
                customer: TMS.order.customerName(o), pieces: Number(o.pieces) || 1,
                weight: util.round(Number(o.chargeableWeight) || 0, 1), hours: util.round(hours, 1),
                status: o.status, statusText: pg.statusText(o.status)
            });
        });
        Object.keys(out).forEach(function (k) { out[k].orders = util.sortBy(out[k].orders, 'hours', 'desc'); });
        return out;
    }

    function whStockRows(warehouseId, ctx) {
        return db.col('stocks').filter(function (s) { return s.warehouseId === warehouseId; }).map(function (s) {
            var m = db.get('materials', s.materialId) || {};
            var mv = (ctx.byWh[warehouseId] || []).filter(function (x) { return x.materialId === s.materialId; });
            var qty = Number(s.qty) || 0, safe = Number(s.safeQty) || 0;
            var outQty = util.sum(mv.filter(function (x) { return x.kind === 'out'; }), 'qty');
            var perDay = outQty / (ctx.days || 30);
            var book = ctx.ledger[warehouseId + '|' + s.materialId];
            return {
                id: s.id, warehouseId: warehouseId, materialId: s.materialId,
                material: s.material || m.name || '', unit: s.unit || m.unit || '件',
                qty: qty, safeQty: safe, low: qty < safe, price: Number(m.price) || 0,
                value: util.money(qty * (Number(m.price) || 0)),
                outQty: util.round(outQty, 1),
                turnDays: perDay > 0 ? util.round(qty / perDay, 1) : null,
                /* 流水只在建账时快照过的仓才有值，undefined 表示这条库存行还没有凭证 */
                diff: book == null ? null : util.round(book - qty, 1),
                updatedAt: s.updatedAt || '', matStatus: m.status || 'normal', matPrice: Number(m.price) || 0
            };
        });
    }

    function whView(w, ctx, goods) {
        var stocks = whStockRows(w.id, ctx);
        var g = (w.hubId && goods[w.hubId]) || { orders: [], pieces: 0, weight: 0, buckets: [0, 0, 0, 0], aged: 0, maxHours: 0 };
        var mv = ctx.byWh[w.id] || [];
        var usedPieces = Number(w.usedPieces) || 0;
        var areaRate = w.areaM2 ? util.round((Number(w.usedArea) || 0) / w.areaM2 * 100, 1) : 0;
        var pieceRate = w.capacityPieces ? util.round(usedPieces / w.capacityPieces * 100, 1) : 0;
        return {
            id: w.id, name: w.name, city: w.city || '', type: w.type || '自营仓', status: w.status || 'active',
            manager: w.manager || '', hubId: w.hubId || '', hubName: w.hubId ? pg.hubName(w.hubId) : '',
            areaM2: Number(w.areaM2) || 0, usedArea: Number(w.usedArea) || 0, areaRate: areaRate,
            capacityPieces: Number(w.capacityPieces) || 0, usedPieces: usedPieces, pieceRate: pieceRate,
            costPerM2: Number(w.costPerM2) || 0, rent: util.money((Number(w.areaM2) || 0) * (Number(w.costPerM2) || 0) * 30),
            stockRows: stocks, stockValue: util.money(util.sum(stocks, 'value')),
            lowCount: stocks.filter(function (s) { return s.low; }).length,
            diffRows: stocks.filter(function (s) { return s.diff != null && Math.abs(s.diff) > 0.5; }),
            inQty: util.round(util.sum(mv.filter(function (x) { return x.kind === 'in'; }), 'qty'), 1),
            outQty: util.round(util.sum(mv.filter(function (x) { return x.kind === 'out'; }), 'qty'), 1),
            moves: mv.length,
            goodsOrders: g.orders.length, goodsPieces: g.pieces, goodsWeight: util.round(g.weight, 1),
            goodsAged: g.aged, goodsMax: util.round(g.maxHours, 0), buckets: g.buckets, goodsList: g.orders,
            pieceDrift: Math.round(g.pieces - usedPieces),
            pieceDriftPct: usedPieces ? util.round(Math.abs(g.pieces - usedPieces) / usedPieces * 100, 1) : (g.pieces ? 100 : 0)
        };
    }

    function whRows(days) {
        var ctx = stockCtx(days || 30), goods = goodsByHub();
        return db.col('warehouses').map(function (w) { return whView(w, ctx, goods); });
    }

    function whGaps(rows) {
        return {
            low: rows.filter(function (r) { return r.lowCount; }),
            diff: rows.filter(function (r) { return r.diffRows.length; }),
            overload: rows.filter(function (r) { return r.areaRate >= 88 || r.pieceRate >= 88; }),
            drift: rows.filter(function (r) { return r.goodsOrders && r.pieceDriftPct > 15; }),
            aged: rows.filter(function (r) { return r.goodsAged > 0; }),
            closed: rows.filter(function (r) { return r.status !== 'active' && (r.stockValue > 0 || r.goodsOrders > 0); }),
            noHub: rows.filter(function (r) { return !r.hubId; })
        };
    }

    /* 物料档案的合计/状态/在途都是派生值，改动库存后统一走这里重算，避免三处口径各写一遍 */
    function syncMaterial(materialId) {
        var m = db.get('materials', materialId);
        if (!m) return null;
        var stock = util.sum(db.col('stocks').filter(function (s) { return s.materialId === materialId; }), 'qty');
        var transit = util.sum(db.col('stockMovements').filter(function (x) {
            return x.materialId === materialId && x.kind === 'purchase' && x.status === 'pending';
        }), 'qty');
        stock = Math.round(stock);
        transit = Math.round(transit);
        /* 停用是采购决策不是库存结论，重算合计不能把它冲回 normal */
        var status = m.status === 'obsolete' ? 'obsolete' : (stock <= 0 ? 'out' : (stock < (Number(m.safeStock) || 0) ? 'low' : 'normal'));
        db.update('materials', materialId, { stock: stock, inTransit: transit, status: status, updatedAt: util.iso(util.now()) });
        return db.get('materials', materialId);
    }

    function stockRowOf(warehouseId, materialId, safeQty) {
        var s = db.findOne('stocks', function (x) { return x.warehouseId === warehouseId && x.materialId === materialId; });
        if (s) return s;
        var mat = db.get('materials', materialId) || {};
        return db.create('stocks', {
            warehouseId: warehouseId, warehouseName: (db.get('warehouses', warehouseId) || {}).name || '',
            materialId: materialId, material: mat.name || materialId, unit: mat.unit || '件',
            qty: 0, safeQty: Math.round(Number(safeQty) || 0), updatedAt: util.iso(util.now())
        });
    }

    /* 记一笔库存变动：流水 + 库存行 + 物料档案三张表一起改，任何一步失败都不能只写一半 */
    function postMovement(entry) {
        var whId = entry.warehouseId, matId = entry.materialId;
        var stock = stockRowOf(whId, matId, Math.round((Number((db.get('materials', matId) || {}).safeStock) || 0) / Math.max(1, db.col('warehouses').length)));
        var qty = Number(entry.qty) || 0;
        var signed = entry.kind === 'out' ? -qty : qty;
        var next = Math.round((Number(stock.qty) || 0) + (entry.kind === 'purchase' ? 0 : signed));
        if (next < 0) return { ok: false, message: ((db.get('materials', matId) || {}).name || matId) + ' 现存 ' + (Number(stock.qty) || 0) + '，不够出库' };
        var mv = db.create('stockMovements', {
            kind: entry.kind, date: util.dateKey(entry.at || util.now()), warehouseId: whId, materialId: matId,
            qty: entry.kind === 'adjust' ? signed : qty, reason: entry.reason || '', operator: entry.operator || actor(),
            link: entry.link || '', refId: entry.refId || '', status: entry.status || '',
            createdAt: util.iso(entry.at || util.now())
        }, { stamp: false });
        if (entry.kind !== 'purchase') {
            db.update('stocks', stock.id, { qty: next, updatedAt: util.iso(entry.at || util.now()) });
            db.commit('stocks', stock.id, 'stock:mv');
        }
        saveRow('stockMovements', mv, 'stock:mv');
        syncMaterial(matId);
        return { ok: true, movement: mv, stock: db.get('stocks', stock.id) };
    }

    function movementOptions(warehouseId) {
        return db.col('stockMovements').filter(function (m) {
            return m.kind === 'purchase' && m.status === 'pending' && (!warehouseId || m.warehouseId === warehouseId);
        }).map(function (m) {
            var mat = db.get('materials', m.materialId) || {};
            return { value: m.id, label: m.id + ' ' + (mat.name || m.materialId) + ' ×' + m.qty };
        });
    }

    function warehouseOptions(keep) {
        var list = db.col('warehouses').filter(function (w) { return w.status === 'active' || w.id === keep; });
        return list.map(function (w) { return { value: w.id, label: w.name }; });
    }

    function whStockTable(rows) {
        if (!rows.length) return ui.empty('该仓暂无库存行', '可从「物料管理」页发起采购补货');
        return ui.table({
            dense: true, keyName: 'id', rows: rows,
            columns: [
                { key: 'material', label: '物料', render: function (s) { return ui.link(esc(s.material), 'mat:open', s.materialId); } },
                { key: 'qty', label: '现存', align: 'right', width: '92px', render: function (s) { return (s.low ? '<span class="tone-danger">' : '') + fmt.number(s.qty) + ' ' + esc(s.unit) + (s.low ? '</span>' : ''); } },
                { key: 'safeQty', label: '安全库存', align: 'right', width: '96px', render: function (s) { return fmt.number(s.safeQty) + ' ' + esc(s.unit); } },
                { key: 'outQty', label: '窗口领用', align: 'right', width: '104px', render: function (s) { return fmt.number(s.outQty) + ' ' + esc(s.unit); } },
                { key: 'turnDays', label: '周转天数', align: 'right', width: '96px', render: function (s) { return s.turnDays == null ? '<span class="tms-dim">无领用</span>' : fmt.number(s.turnDays) + ' 天'; } },
                { key: 'diff', label: '账实差异', align: 'right', width: '96px', render: function (s) { return s.diff == null ? '<span class="tms-dim">无凭证</span>' : (Math.abs(s.diff) > 0.5 ? ui.badge(fmt.number(s.diff), 'danger') : '<span class="tms-dim">0</span>'); } },
                { key: 'value', label: '库存金额', align: 'right', width: '108px', render: function (s) { return fmt.money(s.value); } },
                { key: 'updatedAt', label: '最近变动', align: 'right', width: '112px', render: function (s) { return s.updatedAt ? fmt.date(s.updatedAt) : '<span class="tms-dim">—</span>'; } }
            ]
        });
    }

    function mvTable(list, limit) {
        if (!list.length) return ui.empty('窗口内没有出入库流水', '库存只做静态快照，账实差异就无从追查');
        return ui.table({
            dense: true, keyName: 'id', rows: list.slice(0, limit || 10),
            columns: [
                { key: 'id', label: '凭证', width: '116px', render: function (m) { return ui.idCell(m.id); } },
                { key: 'kind', label: '类型', width: '92px', render: function (m) { return ui.badge(MOV_TEXT[m.kind] || m.kind, m.kind === 'out' ? 'info' : (m.kind === 'in' ? 'success' : (m.kind === 'purchase' ? 'accent' : 'warn'))); } },
                { key: 'materialId', label: '物料', render: function (m) { return ui.link(esc((db.get('materials', m.materialId) || {}).name || m.materialId), 'mat:open', m.materialId); } },
                { key: 'qty', label: '数量', align: 'right', width: '92px', render: function (m) { return (m.kind === 'out' ? '-' : (m.qty < 0 ? '' : '+')) + fmt.number(Math.abs(m.qty)); } },
                { key: 'reason', label: '事由', render: function (m) { return esc(m.reason || '—'); } },
                { key: 'operator', label: '经办', width: '92px', render: function (m) { return esc(m.operator || '—'); } },
                { key: 'date', label: '日期', align: 'right', width: '100px' }
            ]
        });
    }

    function whModal(id) {
        var w = db.get('warehouses', id);
        if (!w) { ui.toast('仓库不存在', 'warn'); return; }
        var ctx = stockCtx(30);
        var r = whView(w, ctx, goodsByHub());
        var mv = ctx.byWh[w.id] || [];
        var risks = [];
        if (r.diffRows.length) risks.push(r.diffRows.length + ' 项库存与流水对不上：档案数是被人工改过的，先盘点调平再谈补货');
        if (r.lowCount) risks.push(r.lowCount + ' 项低于分仓安全库存，断料当天分拨就得停线');
        if (r.goodsAged) risks.push(r.goodsAged + ' 票货在库超 48 小时（最久 ' + r.goodsMax + ' 小时），滞留件既不产生收入还占库位');
        if (r.areaRate >= 88 || r.pieceRate >= 88) risks.push('库容占用已达 ' + fmt.percent(Math.max(r.areaRate, r.pieceRate)) + '，再来一票旺季货就爆仓');
        if (r.goodsOrders && r.pieceDriftPct > 15) risks.push('档案占用 ' + fmt.number(r.usedPieces) + ' 件 vs 实际在库 ' + fmt.number(r.goodsPieces) + ' 件，账面偏差 ' + fmt.percent(r.pieceDriftPct));
        if (r.status !== 'active' && (r.stockValue > 0 || r.goodsOrders > 0)) risks.push('仓库已停用但仍有库存与在库货物，货找不到责任人');
        ui.modal({
            title: esc(r.name), size: 'wide',
            sub: esc(r.type) + ' · ' + esc(r.city || '—') + ' · 对接分拨 ' + esc(r.hubName || '未归属') + ' · 仓管 ' + esc(r.manager || '—') + ' ' + statusBadge(r.status, WH_TEXT),
            body: ui.stack([
                ui.kpis([
                    { label: '面积占用', value: fmt.percent(r.areaRate), tone: r.areaRate >= 88 ? 'danger' : '', sub: fmt.number(r.usedArea) + ' / ' + fmt.number(r.areaM2) + ' m²' },
                    { label: '库位件数', value: fmt.percent(r.pieceRate), tone: r.pieceRate >= 88 ? 'danger' : '', sub: fmt.number(r.usedPieces) + ' / ' + fmt.number(r.capacityPieces) + ' 件' },
                    { label: '在库货物', value: fmt.number(r.goodsOrders), unit: '单', tone: r.goodsAged ? 'warn' : '', sub: fmt.number(r.goodsPieces) + ' 件 / ' + fmt.kg(r.goodsWeight) },
                    { label: '耗材库存值', value: fmt.money(r.stockValue), tone: 'brand', sub: r.lowCount ? ui.badge(r.lowCount + ' 项告急', 'danger') : '库存充足' },
                    { label: '月仓租测算', value: fmt.money(r.rent), sub: fmt.money(r.costPerM2) + '/m²·天 × ' + fmt.number(r.areaM2) + ' m²' }
                ]),
                risks.length ? ui.notice(risks.map(function (t) { return '· ' + esc(t); }).join('<br>'), 'warn', '本仓体检') : '',
                ui.card({ title: '耗材库存', sub: r.stockRows.length + ' 个品类 · 现存合计 ' + fmt.number(util.sum(r.stockRows, 'qty')) , flat: true, body: whStockTable(r.stockRows) }),
                ui.card({
                    title: '在库货物', sub: r.goodsOrders ? r.goodsOrders + ' 单待出库，最久 ' + r.goodsMax + ' 小时' : '当前没有在库货物', flat: true,
                    body: r.goodsList.length ? ui.table({
                        dense: true, keyName: 'id', rows: r.goodsList.slice(0, 8),
                        columns: [
                            { key: 'id', label: '单号', width: '150px', render: function (o) { return ui.idCell(o.id, 'order:open'); } },
                            { key: 'customer', label: '客户', render: function (o) { return esc(o.customer || '—'); } },
                            { key: 'statusText', label: '状态', width: '92px' },
                            { key: 'pieces', label: '件数', align: 'right', width: '72px' },
                            { key: 'weight', label: '重量', align: 'right', width: '92px', render: function (o) { return fmt.kg(o.weight); } },
                            { key: 'hours', label: '在库时长', align: 'right', width: '104px', render: function (o) { return o.hours > 48 ? ui.badge(Math.round(o.hours) + ' 小时', 'danger') : fmt.number(o.hours) + ' 小时'; } }
                        ]
                    }) : ui.empty('没有滞留货物', '在库件数从订单状态实时反算')
                }),
                ui.card({ title: '近期出入库流水', sub: '窗口 ' + ctx.days + ' 天 · ' + mv.length + ' 笔', flat: true, body: mvTable(mv, 10) })
            ]),
            footer: ui.btn('入库单', { tone: 'primary', size: 'sm', act: 'wh:in', arg: w.id }) +
                ui.btn('领用出库', { size: 'sm', act: 'wh:out', arg: w.id }) +
                ui.btn('盘点调账', { size: 'sm', act: 'wh:count', arg: w.id }) +
                ui.btn('调拨转仓', { size: 'sm', act: 'wh:transfer', arg: w.id }) +
                ui.btn('按在库重算占用', { size: 'sm', tone: 'ghost', act: 'wh:recalc', arg: w.id }) +
                ui.btn('编辑档案', { size: 'sm', tone: 'ghost', act: 'wh:edit', arg: w.id }) +
                ui.btn('关闭', { size: 'sm', act: 'ui:close' })
        });
    }

    function whFormModal(id) {
        var w = id ? db.get('warehouses', id) : null;
        ui.formModal({
            title: w ? '维护仓库档案' : '新增仓库',
            sub: w ? esc(w.name) + ' · 库容与仓租只影响成本测算，不动库存事实' : '仓库必须挂在分拨中心下面，否则在库货物无法归位',
            notice: '「档案占用」是盘点写入的静态数，「实际在库」由订单状态实时反算；台账页会把两者差异顶出来，别靠手填保持一致。',
            fields: [
                { key: 'name', label: '仓库名称', required: true },
                { key: 'hubId', label: '归属分拨', type: 'select', required: true, options: ui.optionsOf(db.col('hubs'), 'id', 'name') },
                { key: 'type', label: '仓库类型', type: 'select', required: true, options: ui.optionsOf(WH_TYPES) },
                { key: 'manager', label: '仓管负责人', required: true },
                { key: 'areaM2', label: '建筑面积', type: 'number', min: 1, required: true, unit: 'm²' },
                { key: 'usedArea', label: '已用面积', type: 'number', min: 0, required: true, unit: 'm²' },
                { key: 'capacityPieces', label: '库容件数', type: 'number', min: 1, required: true, unit: '件' },
                { key: 'usedPieces', label: '档案占用件数', type: 'number', min: 0, required: true, unit: '件' },
                { key: 'costPerM2', label: '仓租单价', type: 'number', min: 0.1, step: '0.01', required: true, unit: '元/m²·天', tip: '按天计租，页面折算月度成本' },
                { key: 'status', label: '状态', type: 'select', options: Object.keys(WH_TEXT).map(function (k) { return { value: k, label: WH_TEXT[k] }; }) }
            ],
            values: w ? {
                name: w.name, hubId: w.hubId, type: w.type, manager: w.manager, areaM2: w.areaM2,
                usedArea: w.usedArea, capacityPieces: w.capacityPieces, usedPieces: w.usedPieces,
                costPerM2: w.costPerM2, status: w.status
            } : { type: '自营仓', status: 'active', areaM2: 6000, usedArea: 3000, capacityPieces: 60000, usedPieces: 20000, costPerM2: 1.2 },
            okText: '保存仓库',
            onSubmit: function (data) {
                var name = String(data.name || '').trim();
                if (!name) return '仓库名称必填';
                if (db.col('warehouses').some(function (x) { return x.name === name && x.id !== (w ? w.id : ''); })) return '同名仓库已存在';
                var area = Number(data.areaM2) || 0, used = Number(data.usedArea) || 0;
                if (area <= 0) return '建筑面积必须大于 0';
                if (used > area) return '已用面积不能超过建筑面积';
                var cap = Number(data.capacityPieces) || 0, up = Number(data.usedPieces) || 0;
                if (cap <= 0) return '库容件数必须大于 0';
                if (up > cap) return '档案占用件数不能超过库容';
                if (!(Number(data.costPerM2) > 0)) return '仓租单价必须大于 0，否则成本测算会把这仓算成免费';
                var hub = db.get('hubs', data.hubId);
                if (!hub) return '请选择归属分拨';
                var patch = {
                    name: name, hubId: hub.id, city: hub.city, type: data.type, manager: String(data.manager).trim(),
                    areaM2: area, usedArea: used, capacityPieces: cap, usedPieces: up,
                    costPerM2: util.round(Number(data.costPerM2), 2), status: data.status
                };
                var saved = w ? (db.update('warehouses', w.id, patch), db.get('warehouses', w.id)) : db.create('warehouses', patch);
                saveRow('warehouses', saved, 'wh:save');
                TMS.audit.log('warehouse.update', 'warehouses', saved.id,
                    (w ? '维护' : '新增') + '仓库 ' + saved.name + '（' + saved.type + '，' + fmt.number(saved.areaM2) + ' m²，库容 ' + fmt.number(saved.capacityPieces) + ' 件），仓管 ' + saved.manager,
                    actor());
                ui.toast('已保存仓库「' + saved.name + '」', 'success');
                for (var i = 0; i < 2; i++) TMS.ui.closeTop();
            }
        });
    }

    function whInOutModal(id, kind, materialId) {
        var w = db.get('warehouses', id);
        if (!w) { ui.toast('仓库不存在', 'warn'); return; }
        var rows = whStockRows(w.id, stockCtx(30));
        var opts = rows.map(function (s) { return { value: s.materialId, label: s.material + '（现存 ' + fmt.number(s.qty) + s.unit + '）' }; });
        if (!opts.length) { ui.toast('该仓还没有库存品类', 'warn'); return; }
        var isIn = kind === 'in';
        ui.formModal({
            title: isIn ? '入库单' : '领用出库',
            sub: esc(w.name) + ' · ' + (isIn ? '到货、回库、盘盈都走入库，库存与流水同时更新' : '出库只减库存，费用在采购结算时确认，避免与单票包材成本双计'),
            fields: [{ key: 'materialId', label: '物料', type: 'select', required: true, options: opts, value: opts[0].value },
                { key: 'qty', label: isIn ? '入库数量' : '出库数量', type: 'number', min: 1, required: true },
                { key: 'reason', label: isIn ? '入库来源' : '领用用途', type: 'select', required: true, options: ui.optionsOf(isIn ? IN_SOURCES : OUT_USES) }]
                /* 只有入库才允许冲在途采购单；出库挂采购流水会把同一张单据销两次 */
                .concat(isIn ? [{ key: 'apId', label: '关联采购流水', type: 'select', options: [{ value: '', label: '不关联' }].concat(movementOptions(w.id)) }] : [])
                .concat([{ key: 'remark', label: '备注', span: 2, placeholder: '批次、托盘号、领用班组' },
                    { key: 'operator', label: '经办人', required: true, value: actor() }]),
            values: { materialId: materialId && opts.some(function (o) { return o.value === materialId; }) ? materialId : opts[0].value, qty: 1, operator: actor() },
            okText: isIn ? '确认入库' : '确认出库',
            onSubmit: function (data) {
                var qty = Math.round(Number(data.qty) || 0);
                if (qty <= 0) return '数量必须大于 0';
                var mat = db.get('materials', data.materialId) || {};
                var link = data.apId ? db.get('stockMovements', data.apId) : null;
                if (link && link.materialId !== data.materialId) return '关联的采购单和这个物料不是同一个，请先按采购单入库';
                var res = { ok: false };
                db.batch(function () {
                    if (isIn) {
                        res = postMovement({
                            kind: 'in', warehouseId: w.id, materialId: data.materialId, qty: qty,
                            reason: data.reason + (data.remark ? '：' + data.remark : ''), operator: data.operator
                        });
                        if (!res.ok) return;
                        if (link) {
                            var left = Math.max(0, (Number(link.qty) || 0) - qty);
                            db.update('stockMovements', link.id, {
                                status: left ? 'partial' : 'received', receivedQty: (Number(link.receivedQty) || 0) + qty,
                                receivedAt: util.iso(util.now())
                            });
                            db.commit('stockMovements', link.id, 'purchase:receive');
                            syncMaterial(data.materialId);
                        }
                    } else {
                        res = postMovement({
                            kind: 'out', warehouseId: w.id, materialId: data.materialId, qty: qty,
                            reason: data.reason + (data.remark ? '（' + data.remark + '）' : ''), operator: data.operator
                        });
                    }
                }, isIn ? 'stock:in' : 'stock:out');
                if (!res.ok) { ui.toast(res.message || '操作失败', 'error'); return; }
                var after = db.get('materials', data.materialId) || {};
                TMS.audit.log(isIn ? 'stock.in' : 'stock.out', 'warehouses', w.id,
                    w.name + ' ' + (isIn ? '入库' : '出库') + ' ' + (mat.name || '') + ' ' + fmt.number(qty) + (mat.unit || '') +
                    '（事由：' + data.reason + '），现存 ' + fmt.number(after.stock || 0) + (after.inTransit ? '，在途 ' + fmt.number(after.inTransit) : ''),
                    data.operator || actor());
                if (isIn && (Number(after.stock) || 0) >= (Number(after.safeStock) || 0)) {
                    TMS.jobs.run('materialStock');
                    if ((Number(after.stock) || 0) >= (Number(after.safeStock) || 0)) ui.toast((mat.name || '') + ' 库存已回补至安全线，告警自动核销', 'success');
                }
                ui.toast(isIn ? '已入库 ' + fmt.number(qty) + (mat.unit || '') : '已出库 ' + fmt.number(qty) + (mat.unit || ''), 'success');
                for (var i = 0; i < 2; i++) TMS.ui.closeTop();
            }
        });
    }

    function whCountModal(id) {
        var w = db.get('warehouses', id);
        if (!w) { ui.toast('仓库不存在', 'warn'); return; }
        var rows = whStockRows(w.id, stockCtx(30));
        if (!rows.length) { ui.toast('该仓没有库存品类可盘点', 'warn'); return; }
        var values = { operator: actor() };
        rows.forEach(function (s) { values['q_' + s.materialId] = s.qty; });
        ui.formModal({
            title: '盘点单 · ' + esc(w.name),
            sub: rows.length + ' 个品类 · 填「实盘数量」，系统按差额生成盘点流水并调平库存',
            notice: '盘点差异不直接改库存数字，而是记一条带符号的调整流水：账实核对时任何人都能顺着这条凭证查到是谁、哪天、为什么调的。',
            fields: rows.map(function (s) {
                return {
                    key: 'q_' + s.materialId, label: s.material + '（账面 ' + fmt.number(s.qty) + ' ' + s.unit + '）',
                    type: 'number', min: 0, required: true, unit: s.unit,
                    hint: s.low ? '<span class="tone-danger">低于分仓安全库存 ' + fmt.number(s.safeQty) + '</span>' : ('安全库存 ' + fmt.number(s.safeQty))
                };
            }).concat([{ key: 'memo', label: '盘点说明', type: 'textarea', rows: 2, span: 2, placeholder: '盘点组、差异原因、是否复点' },
                { key: 'operator', label: '盘点人', required: true }]),
            values: values, okText: '提交盘点',
            onSubmit: function (data) {
                var diffs = [];
                rows.forEach(function (s) {
                    var real = Math.round(Number(data['q_' + s.materialId]));
                    if (isNaN(real) || real < 0) return;
                    if (real !== s.qty) diffs.push({ id: s.materialId, delta: real - s.qty, name: s.material, unit: s.unit });
                });
                if (!diffs.length) { ui.toast('账实一致，本次盘点无需调整', 'info'); return; }
                db.batch(function () {
                    diffs.forEach(function (d) {
                        postMovement({
                            kind: 'adjust', warehouseId: w.id, materialId: d.id, qty: d.delta,
                            reason: '盘点调整' + (data.memo ? '：' + data.memo : ''), operator: data.operator || actor()
                        });
                    });
                }, 'stock:count');
                TMS.audit.log('stock.count', 'warehouses', w.id,
                    w.name + ' 盘点调整 ' + diffs.length + ' 项：' + diffs.map(function (d) { return d.name + ' ' + (d.delta > 0 ? '+' : '') + d.delta; }).join('、'),
                    data.operator || actor());
                ui.toast('盘点已入账，' + diffs.length + ' 项差异留痕', 'success');
                for (var i = 0; i < 2; i++) TMS.ui.closeTop();
            }
        });
    }

    function whTransferModal(id) {
        var w = db.get('warehouses', id);
        if (!w) { ui.toast('仓库不存在', 'warn'); return; }
        var rows = whStockRows(w.id, stockCtx(30)).filter(function (s) { return s.qty > 0; });
        var targets = db.col('warehouses').filter(function (x) { return x.id !== w.id; });
        if (!rows.length || !targets.length) { ui.toast('没有可调拨的库存或目标仓', 'warn'); return; }
        ui.formModal({
            title: '仓间调拨 · 从 ' + esc(w.name),
            sub: '调拨拆成「一出一入」两条配对流水，两边各自的账实核对才不会破洞',
            fields: [
                { key: 'materialId', label: '物料', type: 'select', required: true, options: rows.map(function (s) { return { value: s.materialId, label: s.material + '（现存 ' + fmt.number(s.qty) + s.unit + '）' }; }) },
                { key: 'toId', label: '调入仓', type: 'select', required: true, options: ui.optionsOf(targets, 'id', 'name') },
                { key: 'qty', label: '调拨数量', type: 'number', min: 1, required: true },
                { key: 'reason', label: '调拨原因', type: 'select', options: ui.optionsOf(['旺季分流', '就近补料', '退仓归集', '库位腾挪']) },
                { key: 'operator', label: '经办人', required: true, value: actor() }
            ],
            values: { qty: 1, operator: actor() }, okText: '确认调拨',
            onSubmit: function (data) {
                var qty = Math.round(Number(data.qty) || 0);
                if (qty <= 0) return '数量必须大于 0';
                if (data.toId === w.id) return '调入仓不能是自己';
                var mat = db.get('materials', data.materialId) || {};
                var link = TMS.ids.nextFlat('stockMovements', 'TL');
                var res = { ok: true };
                db.batch(function () {
                    res = postMovement({
                        kind: 'out', warehouseId: w.id, materialId: data.materialId, qty: qty,
                        reason: '调拨出仓（' + (data.reason || '库间调剂') + '）→ ' + ((db.get('warehouses', data.toId) || {}).name || data.toId),
                        operator: data.operator, link: link
                    });
                    if (!res.ok) return;
                    postMovement({
                        kind: 'in', warehouseId: data.toId, materialId: data.materialId, qty: qty,
                        reason: '调拨入仓（' + (data.reason || '库间调剂') + '）← ' + w.name,
                        operator: data.operator, link: link
                    });
                }, 'stock:transfer');
                if (!res.ok) { ui.toast(res.message || '调拨失败', 'error'); return; }
                TMS.audit.log('stock.transfer', 'warehouses', w.id,
                    w.name + ' → ' + ((db.get('warehouses', data.toId) || {}).name || data.toId) + ' 调拨 ' + (mat.name || '') + ' ' + fmt.number(qty) + (mat.unit || '') + '，配对单号 ' + link,
                    data.operator || actor());
                ui.toast('调拨完成，配对单号 ' + link, 'success');
                for (var i = 0; i < 2; i++) TMS.ui.closeTop();
            }
        });
    }

    /* 采购补货：在途凭证 + 供应商应付同时生成，到货入库才冲减在途、加回库存 */
    function purchaseModal(materialId, warehouseId) {
        var m = materialId ? db.get('materials', materialId) : null;
        var mats = db.col('materials');
        var sups = db.col('suppliers');
        var whs = db.col('warehouses').filter(function (w) { return w.status === 'active'; });
        if (!mats.length || !sups.length || !whs.length) { ui.toast('缺少物料/供应商/仓库档案，无法下采购单', 'warn'); return; }
        var stock = m ? (Number(m.stock) || 0) : 0;
        var safe = m ? (Number(m.safeStock) || 0) : 0;
        var transit = m ? (Number(m.inTransit) || 0) : 0;
        var suggest = m ? Math.max(10, Math.round((safe * 1.5 - stock - transit) / 10) * 10) : 50;
        ui.formModal({
            title: m ? '补货下单 · ' + esc(m.name) : '补货下单',
            sub: m ? ('现存 ' + fmt.number(stock) + (m.unit || '') + ' · 安全库存 ' + fmt.number(safe) + ' · 在途 ' + fmt.number(transit)) : '选择物料后按安全库存给出建议量',
            notice: '采购当场只挂「在途凭证 + 供应商应付」，库存数量要等到货入库才增加——账期在下单时确认，货权在到货时确认。',
            fields: [
                { key: 'materialId', label: '物料', type: 'select', required: true, options: ui.optionsOf(mats, 'id', 'name'), disabled: !!m },
                { key: 'warehouseId', label: '收货仓', type: 'select', required: true, options: ui.optionsOf(whs, 'id', 'name') },
                { key: 'supplierId', label: '供应商', type: 'select', required: true, options: ui.optionsOf(sups, 'id', 'name') },
                { key: 'qty', label: '采购数量', type: 'number', min: 1, required: true, hint: '建议 ' + fmt.number(suggest) + '（补到安全库存 1.5 倍）' },
                { key: 'price', label: '成交单价', type: 'number', min: 0.01, step: '0.01', required: true, unit: '元' },
                { key: 'cycle', label: '结算账期', type: 'select', options: ui.optionsOf(['现结', '半月结', '月结', '季结']) },
                { key: 'reason', label: '采购事由', type: 'select', options: ui.optionsOf(['安全库存不足', '旺季提前备货', '新网点开业', '设备改造耗材']) },
                { key: 'operator', label: '经办人', required: true, value: actor() }
            ],
            values: {
                materialId: m ? m.id : mats[0].id, warehouseId: warehouseId || whs[0].id,
                supplierId: (m && m.supplierId) || sups[0].id, qty: suggest,
                price: m ? (Number(m.price) || 1) : 1, cycle: '月结', reason: '安全库存不足'
            },
            okText: '生成采购单',
            onSubmit: function (data) {
                var mat = db.get('materials', data.materialId);
                var wh = db.get('warehouses', data.warehouseId);
                var sup = db.get('suppliers', data.supplierId);
                if (!mat || !wh || !sup) return '物料、收货仓或供应商不存在';
                var qty = Math.round(Number(data.qty) || 0);
                var price = util.round(Number(data.price) || 0, 2);
                if (qty <= 0) return '采购数量必须大于 0';
                if (price <= 0) return '成交单价必须大于 0';
                if (mat.status === 'obsolete') return (mat.name || '') + ' 已停用，不能继续采购';
                var amount = util.money(qty * price);
                var days = data.cycle === '现结' ? 0 : (data.cycle === '半月结' ? 15 : (data.cycle === '季结' ? 90 : 30));
                var result = { mv: null, ap: null };
                db.batch(function () {
                    result.mv = postMovement({
                        kind: 'purchase', warehouseId: wh.id, materialId: mat.id, qty: qty,
                        reason: data.reason + ' · ' + sup.name, operator: data.operator, status: 'pending'
                    }).movement;
                    if (!result.mv) return;
                    result.ap = TMS.finance.createPayable({
                        refId: mat.id, refNo: result.mv.id, target: sup.name, targetType: 'supplier',
                        category: '物料耗材', amount: amount, date: util.dateKey(util.now()),
                        dueDate: util.dateKey(util.addDays(util.now(), days)),
                        status: 'pending', settledAt: '', remark: fmt.number(qty) + (mat.unit || '') + ' ' + mat.name + ' 采购'
                    });
                    db.update('stockMovements', result.mv.id, { refId: result.ap ? result.ap.id : '' });
                    saveRow('stockMovements', result.mv, 'purchase:ap');
                    syncMaterial(mat.id);
                }, 'stock:purchase');
                TMS.audit.log('stock.purchase', 'materials', mat.id,
                    mat.name + ' 向 ' + sup.name + ' 采购 ' + fmt.number(qty) + (mat.unit || '') + '，单价 ' + fmt.money(price) +
                    '，合计 ' + fmt.money(amount) + '，账期 ' + data.cycle + '，收货仓 ' + wh.id,
                    data.operator || actor());
                ui.toast('采购单已生成，应付挂账 ' + fmt.money(amount), 'success');
                for (var i = 0; i < 2; i++) TMS.ui.closeTop();
            }
        });
    }

    function purchaseListModal() {
        var ctx = stockCtx(30);
        var rows = ctx.pending.map(function (m) {
            var mat = db.get('materials', m.materialId) || {};
            var wh = db.get('warehouses', m.warehouseId) || {};
            var left = (Number(m.qty) || 0) - (Number(m.receivedQty) || 0);
            return {
                id: m.id, material: mat.name || m.materialId, materialId: m.materialId, unit: mat.unit || '件',
                qty: Number(m.qty) || 0, left: Math.max(0, left), whName: wh.name || m.warehouseId,
                date: m.date || '', amount: util.money(left * (Number(mat.price) || 0)), apId: m.refId || '',
                operator: m.operator || '', reason: m.reason || ''
            };
        });
        if (!rows.length) { ui.toast('没有在途采购单', 'info'); return; }
        ui.modal({
            title: '在途采购单', size: 'wide',
            sub: rows.length + ' 张未到货 · 合计 ' + fmt.money(util.money(util.sum(rows, 'amount'))),
            body: ui.card({
                title: '待到货清单', sub: '到货入库当场冲减在途、加回库存，并联动物料告警核销', flat: true,
                body: ui.table({
                    dense: true, keyName: 'id', rows: rows,
                    columns: [
                        { key: 'id', label: '采购流水', width: '120px', render: function (r) { return ui.idCell(r.id); } },
                        { key: 'material', label: '物料', render: function (r) { return ui.link(esc(r.material), 'mat:open', r.materialId); } },
                        { key: 'whName', label: '收货仓', width: '140px' },
                        { key: 'qty', label: '下单量', align: 'right', width: '92px', render: function (r) { return fmt.number(r.qty) + ' ' + esc(r.unit); } },
                        { key: 'left', label: '未到货', align: 'right', width: '92px', render: function (r) { return '<b class="tone-warn">' + fmt.number(r.left) + '</b>'; } },
                        { key: 'amount', label: '未到货金额', align: 'right', width: '116px', render: function (r) { return fmt.money(r.amount); } },
                        { key: 'date', label: '下单日', align: 'right', width: '100px' },
                        { key: 'apId', label: '应付', width: '120px', render: function (r) { return r.apId ? idLink(r.apId, 'ap:open') : '<span class="tms-dim">未挂账</span>'; } },
                        { key: 'ops', label: '操作', align: 'right', width: '88px', sortable: false, render: function (r) { return ui.link('到货入库', 'smv:recv', r.id, { tone: 'ghost' }); } }
                    ]
                })
            }),
            footer: ui.btn('继续补货下单', { tone: 'primary', size: 'sm', act: 'mat:buy', arg: rows[0].materialId }) +
                ui.btn('关闭', { size: 'sm', act: 'ui:close' })
        });
    }

    function receiveMovement(movementId) {
        var mv = db.get('stockMovements', movementId);
        if (!mv || mv.kind !== 'purchase') { purchaseListModal(); return false; }
        if (mv.status === 'received') { ui.toast('这张采购单已经到货入库了', 'info'); return false; }
        var mat = db.get('materials', mv.materialId) || {};
        var left = Math.max(0, (Number(mv.qty) || 0) - (Number(mv.receivedQty) || 0));
        if (!left) { ui.toast('采购单没有未到货数量', 'warn'); return false; }
        ui.formModal({
            title: '采购到货入库', sub: esc(mat.name || '') + ' · 下单 ' + fmt.number(mv.qty) + '，未到货 ' + fmt.number(left),
            notice: '支持分批到货：本次入库量小于未到货量时，采购单保持部分到货，剩余数量继续挂在途。',
            fields: [
                { key: 'qty', label: '本次到货数量', type: 'number', min: 1, required: true, value: left, unit: mat.unit || '件' },
                { key: 'reason', label: '入库来源', type: 'select', options: ui.optionsOf(IN_SOURCES), value: '采购到货' },
                { key: 'operator', label: '收货人', required: true, value: actor() }
            ],
            okText: '确认收货',
            onSubmit: function (data) {
                var qty = Math.round(Number(data.qty) || 0);
                if (qty <= 0) return '数量必须大于 0';
                if (qty > left) return '本次到货不能超过未到货数量 ' + left;
                db.batch(function () {
                    postMovement({
                        kind: 'in', warehouseId: mv.warehouseId, materialId: mv.materialId, qty: qty,
                        reason: (data.reason || '采购到货') + '（' + mv.id + '）', operator: data.operator, link: mv.id
                    });
                    var rest = left - qty;
                    db.update('stockMovements', mv.id, {
                        status: rest ? 'partial' : 'received', receivedQty: (Number(mv.receivedQty) || 0) + qty, receivedAt: util.iso(util.now())
                    });
                    db.commit('stockMovements', mv.id, 'purchase:receive');
                    syncMaterial(mv.materialId);
                }, 'purchase:receive');
                var after = db.get('materials', mv.materialId) || {};
                TMS.audit.log('purchase.receive', 'stockMovements', mv.id,
                    (after.name || mat.name || '') + ' 到货入库 ' + fmt.number(qty) + (mat.unit || '') + '，仓内现存 ' + fmt.number(after.stock || 0) + '，在途 ' + fmt.number(after.inTransit || 0),
                    data.operator || actor());
                TMS.jobs.run('materialStock');
                ui.toast('已收货 ' + fmt.number(qty) + (mat.unit || '') + '，在途已冲减', 'success');
                for (var i = 0; i < 2; i++) TMS.ui.closeTop();
            }
        });
        return true;
    }

    function goodsTable(rows, limit) {
        if (!rows.length) return ui.empty('全网没有在库滞留货物', '在库件数由订单状态实时反算');
        return ui.table({
            dense: true, keyName: 'id', rows: rows.slice(0, limit || 10),
            columns: [
                { key: 'id', label: '单号', width: '150px', render: function (o) { return ui.idCell(o.id, 'order:open'); } },
                { key: 'hubName', label: '所在分拨', render: function (o) { return esc(o.hubName); } },
                { key: 'route', label: '线路', width: '150px', render: function (o) { return esc(o.origin + ' → ' + o.destination); } },
                { key: 'customer', label: '客户', render: function (o) { return esc(o.customer || '—'); } },
                { key: 'statusText', label: '状态', width: '92px' },
                { key: 'pieces', label: '件', align: 'right', width: '64px' },
                { key: 'hours', label: '在库时长', align: 'right', width: '104px', render: function (o) { return o.hours > 48 ? ui.badge(Math.round(o.hours) + ' 小时', 'danger') : fmt.number(o.hours) + ' 小时'; } },
                { key: 'ops', label: '操作', align: 'right', width: '120px', sortable: false, render: function (o) { return ui.link('催派', 'wh:urge', o.id, { tone: 'ghost' }) + ' ' + ui.link('转异常', 'wh:exception', o.id, { tone: 'ghost' }); } }
            ]
        });
    }

    /* 补货入口只挂一个动作名，但按钮可能出现在物料行、也可能出现在仓库行：
       按单据号前缀分派，从物料进来时自动落到覆盖倍数最低的那个仓，免得仓管来回猜 */
    function purchaseEntry(arg) {
        var id = String(arg || '');
        if (/^MAT/.test(id)) {
            var worst = '', worstRate = Infinity;
            db.col('stocks').forEach(function (s) {
                if (s.materialId !== id) return;
                var w = db.get('warehouses', s.warehouseId) || {};
                if (w.status !== 'active') return;
                var rate = (Number(s.qty) || 0) / Math.max(1, Number(s.safeQty) || 1);
                if (rate < worstRate) { worstRate = rate; worst = s.warehouseId; }
            });
            purchaseModal(id, worst);
        } else if (/^WH/.test(id)) purchaseModal('', id);
        else purchaseModal('', '');
    }

    /* 催派 / 转异常都要「此刻还压在第几个仓、压了多久」，
       窗口取数早已过期，一律按订单现态重算，否则会把已出库的单也催一遍 */
    function stockGoods(orderId) {
        var o = db.get('orders', orderId);
        if (!o) return null;
        var hub = o.status === 'inbound' ? o.hubFrom : (o.status === 'arrived' ? o.hubTo : '');
        if (!hub) return null;
        var idx = TMS.order.scanIndex();
        var at = TMS.order.stageAt(o, o.status, idx[o.id]);
        var wh = db.findOne('warehouses', function (x) { return x.hubId === hub; });
        return {
            order: o, hubId: hub, hubName: pg.hubName(hub), whId: wh ? wh.id : '',
            hours: util.round(Math.max(0, util.hoursBetween(at || o.updatedAt || o.createdAt, util.now())), 1)
        };
    }

    function urgeOrder(orderId) {
        var g = stockGoods(orderId);
        if (!g) { ui.toast('该单已不在库，无需催派', 'info'); return; }
        var t = TMS.service.createTicket({
            orderId: g.order.id, type: '催件', priority: g.hours > 168 ? '高' : '中',
            content: '货物滞留 ' + g.hubName + ' 已 ' + Math.round(g.hours) + ' 小时（' + pg.statusText(g.order.status) + '），要求当班排出库并回传新的时效承诺',
            channel: '系统', assignee: actor()
        });
        ui.toast('已生成催件工单 ' + t.id + '，时限 ' + fmt.dateTime(t.deadline), 'success');
        TMS.shell.refresh();
    }

    function exceptionFromStock(orderId) {
        var g = stockGoods(orderId);
        if (!g) { ui.toast('该单已不在库，无需转异常', 'info'); return; }
        var ex = TMS.service.createException({
            orderId: g.order.id, type: '延迟送达', level: g.hours > 168 ? '一级' : '二级',
            description: g.hubName + ' 在库滞留 ' + Math.round(g.hours) + ' 小时未出库，责任环节：分拨仓储',
            actor: actor(), source: '仓储上报'
        });
        ui.toast('已转异常 ' + ex.id + '（' + ex.level + '），处理时限 ' + ex.slaHours + ' 小时', 'success');
        TMS.shell.refresh();
    }

    /* 档案占用是盘点写死的静态数；库里真实积压从订单反算，两者长期不挨着就是假账，
       这里按现态一次性对齐，并把这次改写留痕（不然没人知道数字为什么突然变了） */
    function recalcUsage(id) {
        var w = db.get('warehouses', id);
        if (!w) { ui.toast('仓库不存在', 'warn'); return; }
        var g = goodsByHub()[w.hubId];
        var pieces = g ? g.pieces : 0;
        if (pieces === (Number(w.usedPieces) || 0)) { ui.toast('档案占用与在库货物本来就一致', 'info'); return; }
        ui.confirm({
            title: '按在库货物重算档案占用',
            message: w.name + '：档案 ' + fmt.number(w.usedPieces) + ' 件 → 实际 ' + fmt.number(pieces) + ' 件。',
            detail: '只改库位占用这一个数，不动库存流水。差异超过 15% 的仓会一直挂在体检里，直到有人承认哪个数才是真的。'
        }).then(function (yes) {
            if (!yes) return;
            db.update('warehouses', id, { usedPieces: pieces });
            db.commit('warehouses', id, 'wh:recalc');
            TMS.audit.log('warehouse.recalc', 'warehouses', id,
                w.name + ' 档案占用由 ' + fmt.number(w.usedPieces) + ' 件按在库货物重算为 ' + fmt.number(pieces) + ' 件', actor());
            ui.toast('已重算占用，差异登记在审计日志', 'success');
            TMS.shell.refresh();
        });
    }

    /* 库存覆盖倍数矩阵：横着看一个仓缺哪些料，竖着看一种料缺在哪个仓。
       绝对数量没法跨品类比（纸箱四万个和托盘四百块共用一张色阶会失真），所以画倍数 */
    function stockMatrix(whs, matAggList) {
        return {
            cols: whs.map(function (w) { return String(w.city || w.name || w.id).replace('中央仓', ''); }),
            rows: matAggList.map(function (a) {
                return {
                    label: a.material.split(' ')[0] + '(' + a.unit + ')',
                    values: whs.map(function (w) {
                        var cellv = a.byWh[w.id];
                        if (!cellv) return 0;
                        return cellv.safe > 0 ? Math.min(9, util.round(cellv.qty / cellv.safe, 1)) : (cellv.qty > 0 ? 9 : 0);
                    })
                };
            })
        };
    }

    pg.define('warehouse', {
        sub: '仓库档案 · 耗材库存 · 在库货物三张脸对齐：每笔出入库都要有流水，账实差异当场顶出来',
        load: function (ctx) {
            applyParamFilter(ctx, ['hub', 'type', 'q']);
            var days = Math.max(7, Number(ctx.days) || 30);
            var sk = stockCtx(days);
            var goods = goodsByHub();
            var rows = db.col('warehouses').map(function (w) { return whView(w, sk, goods); });
            var gaps = whGaps(rows);
            var whs = db.col('warehouses');

            var agg = {};
            db.col('stocks').forEach(function (s) {
                var m = db.get('materials', s.materialId) || {};
                var a = agg[s.materialId] || (agg[s.materialId] = {
                    id: s.materialId, material: s.material || m.name || s.materialId,
                    unit: s.unit || m.unit || '件', price: Number(m.price) || 0,
                    qty: 0, safeQty: 0, value: 0, lowWh: 0, emptyWh: 0, byWh: {}
                });
                var q = Math.round(Number(s.qty) || 0), safe = Math.round(Number(s.safeQty) || 0);
                a.qty += q; a.safeQty += safe; a.value = util.money(a.value + q * a.price);
                if (safe > 0 && q < safe) a.lowWh++;
                if (q <= 0) a.emptyWh++;
                a.byWh[s.warehouseId] = { qty: q, safe: safe };
            });
            var matRows = util.sortBy(Object.keys(agg).map(function (k) {
                var a = agg[k];
                a.cover = a.safeQty > 0 ? util.round(a.qty / a.safeQty, 2) : 0;
                return a;
            }), 'value', 'desc');

            var aged = [];
            Object.keys(goods).forEach(function (hubId) {
                goods[hubId].orders.forEach(function (o) {
                    if (o.hours <= 48) return;
                    o.hubId = hubId; o.hubName = pg.hubName(hubId);
                    aged.push(o);
                });
            });
            aged = util.sortBy(aged, 'hours', 'desc');

            var goodsTot = { orders: 0, pieces: 0, weight: 0, aged: 0, buckets: [0, 0, 0, 0] };
            Object.keys(goods).forEach(function (k) {
                var g = goods[k];
                goodsTot.orders += g.orders.length; goodsTot.pieces += g.pieces;
                goodsTot.weight += g.weight; goodsTot.aged += g.aged;
                g.buckets.forEach(function (v, i) { goodsTot.buckets[i] += v; });
            });

            var pending = sk.pending;
            return {
                days: days, rows: rows, gaps: gaps, sk: sk, matRows: matRows,
                matrix: stockMatrix(whs, matRows),
                aged: aged, goodsTot: goodsTot, pending: pending, mv: mvOf(db.col('stockMovements'), days),
                rent: util.money(util.sum(rows, 'rent')), stockValue: util.money(util.sum(rows, 'stockValue')),
                maxHours: aged.length ? Math.round(aged[0].hours) : 0,
                perPiece: goodsTot.pieces ? util.round(util.money(util.sum(rows, 'rent')) / 30 / goodsTot.pieces, 2) : 0,
                gapCount: gaps.low.length + gaps.diff.length + gaps.overload.length + gaps.drift.length +
                    gaps.aged.length + gaps.closed.length + gaps.noHub.length
            };
        },
        render: function (ctx, d) {
            var kpi = ui.kpis([
                { label: '在册仓库', value: d.rows.length, unit: '座', icon: '⛅', sub: '在用 ' + d.rows.filter(function (r) { return r.status === 'active'; }).length + ' · 未挂分拨 ' + d.gaps.noHub.length },
                { label: '库位占用', value: fmt.percent(d.rows.length ? util.round(util.sum(d.rows, 'usedPieces') / Math.max(1, util.sum(d.rows, 'capacityPieces')) * 100, 1) : 0), icon: '⛁', tone: d.gaps.overload.length ? 'warn' : '', sub: '临爆仓 ' + d.gaps.overload.length + ' 座' },
                { label: '在库货物', value: fmt.number(d.goodsTot.pieces), unit: '件', icon: '⛰', tone: d.goodsTot.aged ? 'danger' : '', sub: d.goodsTot.orders + ' 单待出库 · 滞留 ' + d.goodsTot.aged + ' 票' },
                { label: '耗材库存值', value: fmt.money(d.stockValue), icon: '¥', tone: 'brand', sub: d.matRows.filter(function (r) { return r.lowWh; }).length + ' 个品类有仓告急' },
                { label: '月仓租测算', value: fmt.money(d.rent), icon: '⌂', sub: '件均 ' + fmt.money(d.perPiece) + '/天' },
                { label: '在途采购', value: d.pending.length, unit: '张', icon: '⇄', tone: d.pending.length ? 'warn' : '', sub: '到货入库才冲减、才加库存' },
                { label: '台账体检', value: d.gapCount, unit: '项', icon: '⚑', tone: d.gapCount ? 'warn' : 'success', sub: '账实差异 ' + d.gaps.diff.length + ' 座' }
            ]);
            var capCard = ui.card({
                title: '库容、档案与真实在库对照', flat: true,
                sub: '「档案占用」是盘点写下的静态数，「实际在库」从订单状态实时反算，偏差超过 15% 就是账面失真',
                body: ui.table({
                    dense: true, keyName: 'id', rows: d.rows,
                    columns: [
                        {
                            key: 'name', label: '仓库', render: function (r) {
                                return ui.link(esc(r.name), 'wh:open', r.id) + '<div class="tms-dim">' + esc(r.type) + ' · ' + esc(r.hubName || '未归属分拨') + '</div>';
                            }
                        },
                        { key: 'areaRate', label: '面积占用', align: 'right', width: '160px', render: function (r) { return rateBar(r.areaRate, { target: 75 }); } },
                        { key: 'pieceRate', label: '库位占用', align: 'right', width: '160px', render: function (r) { return rateBar(r.pieceRate, { target: 75 }); } },
                        {
                            key: 'usedPieces', label: '档案 / 实际在库', align: 'right', width: '150px', render: function (r) {
                                return fmt.number(r.usedPieces) + ' / ' + fmt.number(r.goodsPieces) +
                                    (r.goodsOrders && r.pieceDriftPct > 15 ? ' ' + ui.badge(fmt.percent(r.pieceDriftPct), 'danger') : '');
                            }
                        },
                        {
                            key: 'goodsAged', label: '滞留超 48h', align: 'right', width: '120px', render: function (r) {
                                return r.goodsAged ? ui.badge(r.goodsAged + ' 票 · 最久 ' + r.goodsMax + 'h', 'danger') : '<span class="tms-dim">无</span>';
                            }
                        },
                        { key: 'stockValue', label: '耗材值', align: 'right', width: '110px', render: function (r) { return fmt.money(r.stockValue); } },
                        {
                            key: 'lowCount', label: '告急 / 差异', align: 'right', width: '124px', render: function (r) {
                                return (r.lowCount ? ui.badge(r.lowCount + ' 告急', 'warn') : '<span class="tms-dim">库存足</span>') + ' ' +
                                    (r.diffRows.length ? ui.badge(r.diffRows.length + ' 差异', 'danger') : '');
                            }
                        },
                        {
                            key: 'ops', label: '操作', align: 'right', width: '150px', sortable: false, render: function (r) {
                                return ui.link('入库', 'wh:in', r.id, { tone: 'ghost' }) + ' ' +
                                    ui.link('盘点', 'wh:count', r.id, { tone: 'ghost' }) + ' ' +
                                    ui.link('重算占用', 'wh:recalc', r.id, { tone: 'ghost' });
                            }
                        }
                    ]
                })
            });
            var matrixCard = ui.card({
                title: '库存覆盖倍数', sub: '现存 ÷ 分仓安全库存；<1 的格子这个仓当天就断料，≥4 是压资金', flat: true,
                body: ch.heat({ cols: d.matrix.cols, rows: d.matrix.rows, cell: 44, max: 4 })
            });
            var valueCard = ui.card({
                title: '品类库存与周转', sub: '按库存金额排序；倍数长期高于 6 的品类就是在囤货', flat: true,
                body: ch.hbars({
                    data: d.matRows.map(function (r) {
                        return { label: r.material.split(' ')[0], value: util.money(r.value), sub: fmt.number(r.qty) + r.unit + ' · 覆盖 ' + r.cover + ' 倍' };
                    }),
                    limit: 8, rowH: 26, fmt: function (v) { return fmt.money(v); }
                })
            });
            var gapCard = ui.card({
                title: '仓储体检', sub: '库存、库容、货物、档案四本账对不上，仓租与断料就都算不清',
                tone: d.gapCount ? 'danger' : '', flat: true,
                body: ui.list([
                    {
                        title: '低于分仓安全库存 ' + ui.badge(d.gaps.low.length + ' 座', d.gaps.low.length ? 'warn' : 'success'),
                        sub: d.gaps.low.length ? d.gaps.low.slice(0, 5).map(function (r) { return esc(r.name + '（' + r.lowCount + ' 项）'); }).join('、') + '：包材用完当天分拨停线' : '全网耗材库存都在安全线上',
                        right: d.gaps.low.length ? ui.btn('发起补货', { size: 'sm', tone: 'warn', act: 'wh:buy', arg: '' }) : ''
                    },
                    {
                        title: '账实核对不平 ' + ui.badge(d.gaps.diff.length + ' 座', d.gaps.diff.length ? 'danger' : 'success'),
                        sub: d.gaps.diff.length ? '库存行数字与流水累计对不上，说明有人绕过出入库直接改了档案：' + d.gaps.diff.slice(0, 5).map(function (r) { return esc(r.name); }).join('、') : '每个仓的现存都能顺着流水推回来',
                        right: d.gaps.diff.length ? ui.btn('盘点调平', { size: 'sm', tone: 'danger', act: 'wh:count', arg: d.gaps.diff[0].id }) : ''
                    },
                    {
                        title: '库容临爆 ' + ui.badge(d.gaps.overload.length + ' 座', d.gaps.overload.length ? 'warn' : 'success'),
                        sub: d.gaps.overload.length ? d.gaps.overload.slice(0, 5).map(function (r) { return esc(r.name + ' ' + fmt.percent(Math.max(r.areaRate, r.pieceRate))); }).join('、') + '：旺季再进一票就得占用通道，事故与错分概率同步上升' : '库容余量健康',
                        right: d.gaps.overload.length ? ui.btn('调拨分流', { size: 'sm', tone: 'warn', act: 'wh:transfer', arg: d.gaps.overload[0].id }) : ''
                    },
                    {
                        title: '档案与在库偏差 >15% ' + ui.badge(d.gaps.drift.length + ' 座', d.gaps.drift.length ? 'warn' : 'success'),
                        sub: d.gaps.drift.length ? d.gaps.drift.slice(0, 5).map(function (r) { return esc(r.name + '（' + fmt.number(r.usedPieces) + '→' + fmt.number(r.goodsPieces) + ' 件）'); }).join('、') : '档案占用与订单反算一致',
                        right: d.gaps.drift.length ? ui.btn('按在库重算', { size: 'sm', act: 'wh:recalc', arg: d.gaps.drift[0].id }) : ''
                    },
                    {
                        title: '在库滞留超 48 小时 ' + ui.badge(d.goodsTot.aged + ' 票', d.goodsTot.aged ? 'danger' : 'success'),
                        sub: d.goodsTot.aged ? '最久 ' + d.maxHours + ' 小时；既不产生收入又占库位，还直接把时效达成率拖下去' : '没有超时滞留',
                        right: d.aged.length ? ui.btn('催派最早一票', { size: 'sm', tone: 'danger', act: 'wh:urge', arg: d.aged[0].id }) : ''
                    },
                    {
                        title: '停用仓仍有存货 ' + ui.badge(d.gaps.closed.length + ' 座', d.gaps.closed.length ? 'danger' : 'success'),
                        sub: d.gaps.closed.length ? d.gaps.closed.map(function (r) { return esc(r.name); }).join('、') + '：停用的仓没人收货，货在这里等于失踪' : '停用仓都已清场',
                        right: d.gaps.closed.length ? ui.btn('恢复档案', { size: 'sm', tone: 'warn', act: 'wh:edit', arg: d.gaps.closed[0].id }) : ''
                    },
                    {
                        title: '未归属分拨的仓库 ' + ui.badge(d.gaps.noHub.length + ' 座', d.gaps.noHub.length ? 'muted' : 'success'),
                        sub: d.gaps.noHub.length ? '这些仓收不到在库货物画像，滞留件无法归位到任何责任人' : '每座仓都挂在分拨中心上'
                    }
                ])
            });
            var agedCard = ui.card({
                title: '在库滞留货物', flat: true,
                sub: d.aged.length ? d.aged.length + ' 票压过 48 小时，窗口 ' + d.days + ' 天' : '当前没有超时滞留',
                tools: ui.btn('全部滞留清单', { size: 'sm', tone: 'ghost', act: 'wh:goOrders' }),
                body: goodsTable(d.aged, 8)
            });
            var bucketsCard = ui.card({
                title: '在库时长分布', sub: '越往右的柱子越是积压，健康结构应该压在 24 小时内', flat: true,
                body: ch.bars({
                    data: AGE_BUCKETS.map(function (label, i) { return { label: label, value: d.goodsTot.buckets[i] }; }),
                    height: 210, fmt: function (v) { return v + ' 单'; }
                })
            });
            var mvCard = ui.card({
                title: '近期出入库流水', sub: '窗口 ' + d.days + ' 天 · ' + d.mv.length + ' 笔 · 全库 ' + d.sk.total + ' 笔凭证', flat: true,
                tools: ui.btn('导出流水', { size: 'sm', tone: 'ghost', act: 'wh:exportMv' }),
                body: mvTable(d.mv, 8)
            });
            var buyCard = ui.card({
                title: '在途采购与到货', flat: true,
                sub: (function () {
                    var open = util.sum(d.pending, function (m) {
                        var mat = db.get('materials', m.materialId) || {};
                        return Math.max(0, (Number(m.qty) || 0) - (Number(m.receivedQty) || 0)) * (Number(mat.price) || 0);
                    });
                    return d.pending.length
                        ? d.pending.length + ' 张未到货 · 挂账金额 ' + fmt.money(util.money(open))
                        : '没有在途采购单，补货从「物料管理」页发起';
                })(),
                tools: d.pending.length ? ui.btn('全部在途单', { size: 'sm', tone: 'ghost', act: 'wh:buys' }) : '',
                body: d.pending.length ? ui.table({
                    dense: true, keyName: 'id', rows: d.pending.slice(0, 8),
                    columns: [
                        { key: 'id', label: '采购流水', width: '118px', render: function (m) { return ui.idCell(m.id); } },
                        { key: 'materialId', label: '物料', render: function (m) { return ui.link(esc((db.get('materials', m.materialId) || {}).name || m.materialId), 'mat:open', m.materialId); } },
                        { key: 'warehouseId', label: '收货仓', render: function (m) { return esc((db.get('warehouses', m.warehouseId) || {}).name || m.warehouseId); } },
                        { key: 'qty', label: '未到货', align: 'right', width: '92px', render: function (m) { return '<b class="tone-warn">' + fmt.number(Math.max(0, (Number(m.qty) || 0) - (Number(m.receivedQty) || 0))) + '</b>'; } },
                        { key: 'reason', label: '事由', render: function (m) { return esc(m.reason || '—'); } },
                        { key: 'date', label: '下单日', align: 'right', width: '100px' },
                        { key: 'refId', label: '应付', width: '112px', render: function (m) { return m.refId ? idLink(m.refId, 'ap:open') : '<span class="tms-dim">未挂账</span>'; } },
                        { key: 'ops', label: '操作', align: 'right', width: '84px', sortable: false, render: function (m) { return ui.link('到货入库', 'smv:recv', m.id, { tone: 'ghost' }); } }
                    ]
                }) : ui.empty('没有在途采购单', '库存低于安全线时从物料页下单，下单即挂供应商应付')
            });
            var listCard = grid(ctx, {
                title: '仓库台账', rows: d.rows, keyName: 'id', dense: true, onRow: 'wh:open', searchKey: 'q',
                filter: function (r, fs) {
                    if (fs.hub && r.hubId !== fs.hub) return false;
                    if (fs.type && r.type !== fs.type) return false;
                    if (fs.status && r.status !== fs.status) return false;
                    var c = fs.chip || '';
                    if (c === 'low' && !r.lowCount) return false;
                    if (c === 'diff' && !r.diffRows.length) return false;
                    if (c === 'full' && !(r.areaRate >= 88 || r.pieceRate >= 88)) return false;
                    if (c === 'aged' && !r.goodsAged) return false;
                    return true;
                },
                search: function (r) { return [r.id, r.name, r.city, r.hubName, r.manager, r.type].join(' '); },
                chips: [
                    { label: '全部', value: '', count: d.rows.length },
                    { label: '耗材告急', value: 'low', count: d.gaps.low.length },
                    { label: '账实不平', value: 'diff', count: d.gaps.diff.length },
                    { label: '临爆仓', value: 'full', count: d.gaps.overload.length },
                    { label: '有滞留', value: 'aged', count: d.gaps.aged.length }
                ], chipsName: 'chip',
                fields: [
                    { key: 'q', type: 'search', label: '仓库 / 仓管', placeholder: '上海中央仓 / 仓管1' },
                    { key: 'hub', label: '归属分拨', options: [{ value: '', label: '全部分拨' }].concat(ui.optionsOf(db.col('hubs'), 'id', 'name')) },
                    { key: 'type', label: '仓库类型', options: [{ value: '', label: '全部类型' }].concat(ui.optionsOf(WH_TYPES)) },
                    { key: 'status', label: '状态', options: [{ value: '', label: '全部状态' }].concat(Object.keys(WH_TEXT).map(function (k) { return { value: k, label: WH_TEXT[k] }; })) }
                ],
                tools: ui.btn('新增仓库', { size: 'sm', tone: 'primary', act: 'wh:new', icon: '+' }) +
                    ui.btn('在途采购单', { size: 'sm', act: 'wh:buys', icon: '⇄' }) +
                    ui.btn('库存明细', { size: 'sm', tone: 'ghost', act: 'wh:exportStock', icon: '↓' }) +
                    ui.btn('导出', { size: 'sm', tone: 'ghost', act: 'wh:export', icon: '↓' }),
                columns: [
                    {
                        key: 'name', label: '仓库', render: function (r) {
                            return ui.link(esc(r.name), 'wh:open', r.id) +
                                '<div class="tms-dim">' + esc(r.type) + ' · ' + esc(r.city || '—') + ' · 仓管 ' + esc(r.manager || '—') + '</div>';
                        }
                    },
                    { key: 'hubName', label: '归属分拨', width: '130px', render: function (r) { return r.hubId ? ui.link(esc(r.hubName), 'wh:goOrders', r.id) : '<span class="tms-dim">未归属</span>'; } },
                    { key: 'areaM2', label: '面积', align: 'right', width: '110px', render: function (r) { return fmt.number(r.areaM2) + ' m²'; } },
                    { key: 'areaRate', label: '面积占用', align: 'right', width: '150px', render: function (r) { return rateBar(r.areaRate, { target: 75 }); } },
                    { key: 'pieceRate', label: '库位占用', align: 'right', width: '150px', render: function (r) { return rateBar(r.pieceRate, { target: 75 }); } },
                    { key: 'goodsPieces', label: '在库货物', align: 'right', width: '130px', render: function (r) { return fmt.number(r.goodsPieces) + ' 件' + (r.goodsAged ? ' ' + ui.badge(r.goodsAged + ' 超时', 'danger') : ''); } },
                    { key: 'stockValue', label: '耗材值', align: 'right', width: '110px', render: function (r) { return fmt.money(r.stockValue); } },
                    { key: 'moves', label: '窗口流水', align: 'right', width: '104px', render: function (r) { return r.moves ? fmt.number(r.moves) + ' 笔' : '<span class="tms-dim">无凭证</span>'; } },
                    { key: 'rent', label: '月仓租', align: 'right', width: '116px', render: function (r) { return fmt.money(r.rent); } },
                    { key: 'status', label: '状态', align: 'right', width: '84px', sortable: false, render: function (r) { return statusBadge(r.status, WH_TEXT); } },
                    {
                        key: 'ops', label: '操作', align: 'right', width: '168px', sortable: false, render: function (r) {
                            return ui.link('入库', 'wh:in', r.id, { tone: 'ghost' }) + ' ' +
                                ui.link('出库', 'wh:out', r.id, { tone: 'ghost' }) + ' ' +
                                ui.link('盘点', 'wh:count', r.id, { tone: 'ghost' }) + ' ' +
                                ui.link('编辑', 'wh:edit', r.id, { tone: 'ghost' });
                        }
                    }
                ],
                emptyText: '没有符合条件的仓库'
            });
            return wrap(ctx, {
                actions: ui.btn('补货下单', { tone: 'primary', act: 'wh:buy', arg: '', icon: '+' }) +
                    ui.btn('物料管理', { act: 'wh:goMaterial', icon: '⛔' }),
                sub: '窗口 ' + d.days + ' 天 · ' + d.sk.total + ' 笔库存凭证 · 月仓租测算 ' + fmt.money(d.rent) + '（件均 ' + fmt.money(d.perPiece) + '/天）',
                body: [kpi, capCard, ui.split('2', [matrixCard, valueCard]), ui.split('2', [gapCard, bucketsCard]), ui.split('2', [agedCard, buyCard]), ui.split('2', [mvCard, ui.card({ title: '口径说明', flat: true, body: ui.desc([
                    { label: '库存事实', value: '库存行只存数量，任何增减都必须有一条流水' },
                    { label: '采购口径', value: '下单只挂「在途凭证 + 供应商应付」，到货入库才加库存、才冲在途' },
                    { label: '出库口径', value: '领用出库只减库存；包材成本已进单票成本，不再重复确认费用' },
                    { label: '盘点口径', value: '差异写带符号的调整流水，不直接改档案数，责任与时间留在凭证上' },
                    { label: '调拨口径', value: '一出一入两条配对流水，两个仓各自的账实核对都不会破洞' },
                    { label: '在库货物', value: '从订单状态实时反算，与耗材库存是两套账，偏差顶在体检里' }
                ], { inline: false })})]), listCard]
            });
        },
        actions: merge(stockActions, {
            'wh:goMaterial': function () { ui.closeTop(); TMS.shell.go('material'); },
            'wh:goOrders': function (id) {
                var w = id ? db.get('warehouses', id) : null;
                ui.closeTop();
                /* 订单台账没有分拨维度，用仓库所在城市落到城市口径上，
                   比跳过去让人在一万行里海搜快 */
                TMS.shell.go('order', w ? { q: w.city || pg.hubName(w.hubId) || '' } : { status: 'inbound' });
            },
            'wh:export': function () {
                exportGrid({
                    name: '仓库台账.csv', rows: whRows(Math.max(7, Number(curCtx().days) || 30)), searchKey: 'q',
                    search: function (r) { return [r.id, r.name, r.city, r.hubName, r.manager, r.type].join(' '); },
                    cols: [
                        { key: 'id', label: '仓库编号' }, { key: 'name', label: '仓库名称' },
                        { key: 'type', label: '类型' }, { key: 'city', label: '城市' },
                        { key: 'hubName', label: '归属分拨' }, { key: 'manager', label: '仓管' },
                        { key: 'areaM2', label: '建筑面积(m²)' }, { key: 'usedArea', label: '已用面积(m²)' },
                        { key: 'areaRate', label: '面积占用(%)' },
                        { key: 'capacityPieces', label: '库容(件)' }, { key: 'usedPieces', label: '档案占用(件)' },
                        { key: 'goodsPieces', label: '实际在库(件)' }, { key: 'goodsOrders', label: '在库单数' },
                        { key: 'goodsAged', label: '滞留超48h(票)' },
                        { key: 'stockValue', label: '耗材库存值' }, { key: 'lowCount', label: '告急品类' },
                        { key: 'moves', label: '窗口流水' }, { key: 'rent', label: '月仓租' },
                        { key: 'status', label: '状态', value: function (r) { return WH_TEXT[r.status] || r.status; } }
                    ]
                }, 'warehouse');
            },
            'wh:exportStock': function () {
                var rows = [];
                var sk = stockCtx(Math.max(7, Number(curCtx().days) || 30));
                db.col('warehouses').forEach(function (w) {
                    whStockRows(w.id, sk).forEach(function (s) {
                        s.warehouseName = w.name; rows.push(s);
                    });
                });
                if (!rows.length) { ui.toast('还没有库存行', 'warn'); return; }
                download('库存明细.csv', toCsv([
                    { key: 'warehouseName', label: '仓库' }, { key: 'material', label: '物料' },
                    { key: 'unit', label: '单位' }, { key: 'qty', label: '现存' }, { key: 'safeQty', label: '分仓安全库存' },
                    { key: 'outQty', label: '窗口领用' }, { key: 'turnDays', label: '周转天数' },
                    { key: 'diff', label: '账实差异' }, { key: 'value', label: '库存金额' },
                    { key: 'updatedAt', label: '最近变动' }
                ], rows));
            },
            'wh:exportMv': function () {
                var list = mvOf(db.col('stockMovements'), Math.max(7, Number(curCtx().days) || 30));
                if (!list.length) { ui.toast('窗口内没有出入库流水', 'warn'); return; }
                download('库存流水.csv', toCsv([
                    { key: 'id', label: '凭证号' }, { key: 'date', label: '日期' },
                    { key: 'kind', label: '类型', value: function (m) { return MOV_TEXT[m.kind] || m.kind; } },
                    { key: 'warehouseId', label: '仓库', value: function (m) { return (db.get('warehouses', m.warehouseId) || {}).name || m.warehouseId; } },
                    { key: 'materialId', label: '物料', value: function (m) { return (db.get('materials', m.materialId) || {}).name || m.materialId; } },
                    { key: 'qty', label: '数量' }, { key: 'reason', label: '事由' },
                    { key: 'operator', label: '经办' }, { key: 'link', label: '配对单号' },
                    { key: 'refId', label: '关联应付' }, { key: 'status', label: '状态' }
                ], list));
            }
        })
    });

    /* ---------- 二十七、物料管理 ---------- */

    var MAT_TEXT = { normal: '正常', low: '告急', out: '断货', obsolete: '停用' };

    /* 物料档案里的 stock 是各仓相加的派生值，读取时重算而不是写入时同步：
       库存行改了档案忘了改，巡检下一轮也会把它拽回来 */
    function matView(m, sk, days, orderCount) {
        var rows = db.col('stocks').filter(function (s) { return s.materialId === m.id; });
        var price = Number(m.price) || 0;
        var qty = Math.round(util.sum(rows, 'qty'));
        var safe = Math.round(util.sum(rows, 'safeQty'));
        var mv = sk.byMat[m.id] || [];
        var outQty = Math.round(util.sum(mv.filter(function (x) { return x.kind === 'out'; }), 'qty'));
        var inQty = Math.round(util.sum(mv.filter(function (x) { return x.kind === 'in'; }), 'qty'));
        var adjQty = util.round(util.sum(mv.filter(function (x) { return x.kind === 'adjust'; }), 'qty'), 1);
        var pendingMv = db.col('stockMovements').filter(function (x) {
            return x.materialId === m.id && x.kind === 'purchase' &&
                (!x.status || x.status === 'pending' || x.status === 'partial');
        });
        var transit = Math.round(util.sum(pendingMv, function (x) {
            return Math.max(0, (Number(x.qty) || 0) - (Number(x.receivedQty) || 0));
        }));
        var book = 0, hasBook = false;
        rows.forEach(function (s) {
            var b = sk.ledger[s.warehouseId + '|' + m.id];
            if (b != null) { hasBook = true; book += b; }
        });
        var ap = db.col('payables').filter(function (p) { return p.refId === m.id && p.status !== 'settled'; });
        var late = pendingMv.filter(function (x) { return util.hoursBetween(x.date || x.createdAt, util.now()) > 7 * 24; });
        var perDay = outQty / Math.max(1, days);
        return {
            id: m.id, name: m.name, unit: m.unit || '件', price: price, status: m.status || 'normal',
            supplier: m.supplier || '', supplierId: m.supplierId || '',
            safeStock: Number(m.safeStock) || 0, qty: qty, stockRows: rows,
            value: util.money(qty * price), cover: safe > 0 ? util.round(qty / safe, 2) : 0,
            lowWh: rows.filter(function (s) { return (Number(s.safeQty) || 0) > 0 && (Number(s.qty) || 0) < (Number(s.safeQty) || 0); }).length,
            emptyWh: rows.filter(function (s) { return (Number(s.qty) || 0) <= 0; }).length,
            outQty: outQty, inQty: inQty, adjQty: adjQty, outValue: util.money(outQty * price),
            turnDays: perDay > 0 ? Math.round(qty / perDay) : null,
            transit: transit, transitValue: util.money(transit * price), pendingCount: pendingMv.length,
            lateCount: late.length, lateDays: late.length ? Math.round(util.hoursBetween(late[0].date || late[0].createdAt, util.now()) / 24) : 0,
            apOpen: util.money(util.sum(ap, 'amount')), apCount: ap.length,
            diff: hasBook ? util.round(book - qty, 1) : null,
            suggest: Math.max(0, Math.round((Math.max(safe, m.safeStock || 0) * 1.5 - qty - transit) / 10) * 10),
            perOrder: orderCount ? util.round(outQty * price / orderCount, 3) : 0,
            lastAt: mv.length ? (mv[0].date || '') : ''
        };
    }

    function matRowsOf(days) {
        var sk = stockCtx(days);
        var orderCount = TMS.stats.ordersWithin(days).length;
        return db.col('materials').map(function (m) { return matView(m, sk, days, orderCount); });
    }

    function matGaps(rows) {
        return {
            out: rows.filter(function (r) { return r.status === 'out'; }),
            low: rows.filter(function (r) { return r.status === 'low'; }),
            over: rows.filter(function (r) { return r.cover >= 6 && r.status !== 'obsolete'; }),
            late: rows.filter(function (r) { return r.lateCount; }),
            drift: rows.filter(function (r) { return r.diff != null && Math.abs(r.diff) > 0.5; }),
            orphan: rows.filter(function (r) { return r.transit > 0 && !r.apCount; }),
            obsolete: rows.filter(function (r) { return r.status === 'obsolete' && r.qty > 0; })
        };
    }

    function materialModal(id) {
        var m = db.get('materials', id);
        if (!m) { ui.toast('物料不存在', 'warn'); return; }
        var days = Math.max(7, Number(curCtx().days) || 30);
        var r = matView(m, stockCtx(days), days, TMS.stats.ordersWithin(days).length);
        var mv = util.sortBy(db.col('stockMovements').filter(function (x) { return x.materialId === m.id; }), 'createdAt', 'desc');
        var ap = db.col('payables').filter(function (p) { return p.refId === m.id; });
        var risks = [];
        if (r.status === 'out') risks.push('全网断货：分拨当天就没箱可用，必须立刻下单并指定收货仓');
        if (r.status === 'low') risks.push('现存 ' + fmt.number(r.qty) + r.unit + ' 低于安全库存 ' + fmt.number(r.safeStock) + '，覆盖只剩 ' + r.cover + ' 倍');
        if (r.transit > 0 && r.lateCount) risks.push('在途 ' + fmt.number(r.transit) + r.unit + '，最早一张采购单已挂 ' + r.lateDays + ' 天未到货');
        if (r.transit > 0 && !r.apCount) risks.push('有在途数量却没有未结应付：货到就变成没有成本归属的库存');
        if (r.diff != null && Math.abs(r.diff) > 0.5) risks.push('各仓流水累计与现存相加差 ' + fmt.number(r.diff) + r.unit + '，说明有人绕过出入库直接改过档案');
        if (r.cover >= 6) risks.push('覆盖 ' + r.cover + ' 倍，按窗口领用速度够压 ' + r.turnDays + ' 天，属于囤占资金');
        if (r.status === 'obsolete' && r.qty > 0) risks.push('已停用但各仓还有 ' + fmt.number(r.qty) + r.unit + '，要么清完要么恢复档案');
        ui.modal({
            title: esc(r.name), size: 'wide',
            sub: esc(r.unit) + ' · 单价 ' + fmt.money(r.price) + ' · 供应商 ' + esc(r.supplier || '未指定') + ' · ' + statusBadge(r.status, MAT_TEXT),
            body: ui.stack([
                ui.kpis([
                    { label: '全网现存', value: fmt.number(r.qty), unit: r.unit, tone: r.status === 'normal' ? '' : (r.status === 'out' ? 'danger' : 'warn'), sub: '安全库存 ' + fmt.number(r.safeStock) },
                    { label: '库存金额', value: fmt.money(r.value), icon: '¥', sub: '覆盖 ' + r.cover + ' 倍安全线' },
                    { label: '窗口领用', value: fmt.number(r.outQty), unit: r.unit, sub: '折 ' + fmt.money(r.outValue) + ' · 摊票 ' + fmt.money(r.perOrder) },
                    { label: '周转天数', value: r.turnDays == null ? '无领用' : r.turnDays, unit: r.turnDays == null ? '' : '天', tone: r.cover >= 6 ? 'warn' : '', sub: '按日均消耗 ' + fmt.number(r.outQty / days) + ' ' + r.unit + ' 折算' },
                    { label: '在途采购', value: fmt.number(r.transit), unit: r.unit, tone: r.lateCount ? 'danger' : (r.transit ? 'accent' : ''), sub: r.pendingCount + ' 张未到货 · ' + fmt.money(r.transitValue) },
                    { label: '未结应付', value: fmt.money(r.apOpen), icon: '⌁', tone: r.apOpen ? 'warn' : '', sub: r.apCount + ' 张挂账待财务结算' }
                ]),
                risks.length ? ui.notice(risks.map(function (t) { return '· ' + esc(t); }).join('<br>'), 'warn', '补货体检') : '',
                ui.card({
                    title: '分仓分布', sub: r.stockRows.length + ' 个仓 · 库存行是事实，档案合计是派生', flat: true,
                    body: ui.table({
                        dense: true, keyName: 'id', rows: r.stockRows,
                        columns: [
                            { key: 'warehouseId', label: '仓库', render: function (s) { return ui.link(esc(s.warehouseName || (db.get('warehouses', s.warehouseId) || {}).name || s.warehouseId), 'wh:open', s.warehouseId); } },
                            { key: 'qty', label: '现存', align: 'right', width: '110px', render: function (s) { return (s.low ? '<b class="tone-danger">' : '') + fmt.number(s.qty) + ' ' + esc(s.unit) + (s.low ? '</b>' : ''); } },
                            { key: 'safeQty', label: '分仓安全库存', align: 'right', width: '128px', render: function (s) { return fmt.number(s.safeQty); } },
                            { key: 'ops2', label: '覆盖', align: 'right', width: '150px', sortable: false, render: function (s) { return rateBar(s.safeQty ? util.round(s.qty / s.safeQty * 100, 1) : 0, { target: 100 }); } },
                            { key: 'updatedAt', label: '最近变动', align: 'right', width: '112px', render: function (s) { return s.updatedAt ? fmt.date(s.updatedAt) : '<span class="tms-dim">—</span>'; } }
                        ]
                    })
                }),
                ui.card({ title: '采购应付挂账', sub: ap.length ? ap.length + ' 张 · 未结 ' + fmt.money(r.apOpen) : '该物料没有采购挂账', flat: true,
                    body: ap.length ? ui.table({
                        dense: true, keyName: 'id', rows: ap.slice(0, 6),
                        columns: [
                            { key: 'id', label: '应付单', width: '120px', render: function (p) { return ui.idCell(p.id, 'ap:open'); } },
                            { key: 'target', label: '供应商' },
                            { key: 'amount', label: '金额', align: 'right', width: '110px', render: function (p) { return fmt.money(p.amount); } },
                            { key: 'refNo', label: '采购流水', width: '120px', render: function (p) { return ui.idCell(p.refNo); } },
                            { key: 'dueDate', label: '到期', align: 'right', width: '104px' },
                            { key: 'status', label: '状态', align: 'right', width: '88px', render: function (p) { return p.status === 'settled' ? ui.badge('已结', 'success') : (util.toDate(p.dueDate) < util.now() ? ui.badge('逾期', 'danger') : ui.badge('未结', 'warn')); } }
                        ]
                    }) : ui.empty('没有采购挂账', '下单会同时生成在途凭证与供应商应付') }),
                ui.card({ title: '出入库流水', sub: '全量 ' + mv.length + ' 笔', flat: true, body: mvTable(mv, 10) })
            ]),
            footer: ui.btn('补货下单', { tone: 'primary', size: 'sm', act: 'mat:buy', arg: m.id }) +
                ui.btn('发起盘点', { size: 'sm', act: 'mat:count', arg: m.id }) +
                ui.btn('编辑档案', { size: 'sm', tone: 'ghost', act: 'mat:edit', arg: m.id }) +
                ui.btn('关闭', { size: 'sm', act: 'ui:close' })
        });
    }

    function materialFormModal(id) {
        var m = id ? db.get('materials', id) : null;
        var sups = db.col('suppliers');
        ui.formModal({
            title: m ? '维护物料档案' : '新增物料',
            sub: m ? esc(m.name) + ' · 档案只定义单价与安全线，数量一律由库存行与流水决定' : '新建物料后各仓会生成 0 存量行，从「仓储库存」页入库即有凭证',
            notice: '「现存合计」「在途」在本页都是读取时重算的派生值；停用物料不会被安全库存巡检改回正常。',
            fields: [
                { key: 'name', label: '物料名称', required: true },
                { key: 'unit', label: '计量单位', required: true, placeholder: '个 / 卷 / 块' },
                { key: 'price', label: '参考单价', type: 'number', min: 0.01, step: '0.01', required: true, unit: '元', tip: '库存金额与采购应付都按这个单价测算' },
                { key: 'safeStock', label: '全网安全库存', type: 'number', min: 0, required: true, hint: '分仓安全库存按仓数均摊' },
                { key: 'supplierId', label: '主供应商', type: 'select', options: [{ value: '', label: '暂不指定' }].concat(ui.optionsOf(sups, 'id', 'name')) },
                { key: 'status', label: '状态', type: 'select', options: Object.keys(MAT_TEXT).map(function (k) { return { value: k, label: MAT_TEXT[k] }; }) }
            ],
            values: m ? { name: m.name, unit: m.unit, price: m.price, safeStock: m.safeStock, supplierId: m.supplierId, status: m.status } :
                { unit: '个', price: 1, safeStock: 500, status: 'normal', supplierId: sups.length ? sups[0].id : '' },
            okText: '保存物料',
            onSubmit: function (data) {
                var name = String(data.name || '').trim();
                if (!name) return '物料名称必填';
                if (db.col('materials').some(function (x) { return x.name === name && x.id !== (m ? m.id : ''); })) return '同名物料已存在';
                if (!(Number(data.price) > 0)) return '参考单价必须大于 0，否则库存金额与采购应付都会算成零';
                if ((Number(data.safeStock) || 0) <= 0) return '安全库存必须大于 0，否则断料也不会告警';
                var sup = data.supplierId ? db.get('suppliers', data.supplierId) : null;
                var patch = {
                    name: name, unit: String(data.unit || '件').trim(), price: util.round(Number(data.price), 2),
                    safeStock: Math.round(Number(data.safeStock)), status: data.status || 'normal',
                    supplierId: sup ? sup.id : '', supplier: sup ? sup.name : ''
                };
                var saved;
                db.batch(function () {
                    saved = m ? (db.update('materials', m.id, patch), db.get('materials', m.id)) : db.create('materials', patch);
                    if (!m) db.update('materials', saved.id, { inTransit: 0 });
                    /* 安全库存改了，各仓的分仓线跟着均摊重切，否则仓级覆盖倍数还按老线报警 */
                    var whs = db.col('warehouses');
                    var per = Math.max(1, Math.round((Number(saved.safeStock) || 0) / Math.max(1, whs.length)));
                    /* 新物料先铺 0 存量行：没有库存行的物料在仓储页看不到，
                       也永远等不到第一笔入库凭证 */
                    if (!m) whs.forEach(function (w) { stockRowOf(w.id, saved.id, per); });
                    db.col('stocks').filter(function (s) { return s.materialId === saved.id; }).forEach(function (s) {
                        db.update('stocks', s.id, { safeQty: per, material: saved.name, unit: saved.unit, warehouseName: (db.get('warehouses', s.warehouseId) || {}).name || s.warehouseName });
                        db.commit('stocks', s.id, 'material:syncStock');
                    });
                    syncMaterial(saved.id);
                    db.commit('materials', saved.id, 'material:save');
                }, 'material:save');
                TMS.audit.log('material.update', 'materials', saved.id,
                    (m ? '维护' : '新增') + '物料 ' + saved.name + '（' + saved.unit + '，单价 ' + fmt.money(saved.price) +
                    '，安全库存 ' + fmt.number(saved.safeStock) + '，供应商 ' + (saved.supplier || '未指定') + '）', actor());
                ui.toast('已保存物料「' + saved.name + '」，' + db.col('warehouses').length + ' 个仓的分仓安全线同步为 ' + fmt.number(Math.max(1, Math.round(saved.safeStock / Math.max(1, db.col('warehouses').length)))));
                for (var i = 0; i < 2; i++) TMS.ui.closeTop();
            }
        });
    }

    /* 从物料页直接盘某个仓：先让人选仓，再把该仓盘点单打开 */
    function materialCountModal(id) {
        var m = db.get('materials', id);
        if (!m) { ui.toast('物料不存在', 'warn'); return; }
        var rows = db.col('stocks').filter(function (s) { return s.materialId === id; });
        if (!rows.length) { ui.toast('该物料还没有库存行', 'info'); return; }
        if (rows.length === 1) { whCountModal(rows[0].warehouseId); return; }
        ui.formModal({
            title: '选择盘点仓库 · ' + esc(m.name),
            sub: '盘点单以仓为单位开，一次把整仓品类一起过秤，避免同一仓被多次改写',
            fields: [{ key: 'whId', label: '仓库', type: 'select', required: true, placeholder: false,
                options: rows.map(function (s) { return { value: s.warehouseId, label: (s.warehouseName || s.warehouseId) + '（现存 ' + fmt.number(s.qty) + m.unit + '）' }; }) }],
            values: { whId: rows[0].warehouseId }, okText: '开盘点单',
            onSubmit: function (data) {
                ui.closeTop();
                whCountModal(data.whId);
            }
        });
    }

    pg.define('material', {
        sub: '耗材档案与补货链路：库存行是事实、流水是凭证、在途是承诺、应付是成本，四条线互相核对',
        load: function (ctx) {
            applyParamFilter(ctx, ['status', 'supplierId', 'q']);
            var days = Math.max(7, Number(ctx.days) || 30);
            var rows = matRowsOf(days);
            var gaps = matGaps(rows);
            var whs = db.col('warehouses');
            var sk = stockCtx(days), goods = goodsByHub();
            var byWh = whs.map(function (w) {
                var r = whView(w, sk, goods);
                return { id: w.id, name: w.name, city: w.city, qty: util.round(util.sum(r.stockRows, 'qty'), 1), value: r.stockValue, low: r.lowCount };
            });
            var trend = (function () {
                var ledger = db.col('stockMovements').filter(function (m) { return m.kind === 'out'; });
                var g = util.groupBy(ledger, function (m) { return util.dateKey(util.toDate(m.date || m.createdAt)); });
                var priceOf = {};
                db.col('materials').forEach(function (m) { priceOf[m.id] = Number(m.price) || 0; });
                var out = [];
                for (var i = 13; i >= 0; i--) {
                    var k = util.dateKey(util.addDays(util.now(), -i));
                    var day = g[k] || [];
                    out.push({ label: fmt.monthDay(k), value: util.money(util.sum(day, function (m) { return (Number(m.qty) || 0) * (priceOf[m.materialId] || 0); })) });
                }
                return out;
            })();
            return {
                days: days, rows: rows, gaps: gaps, byWh: byWh, trend: trend,
                value: util.money(util.sum(rows, 'value')),
                outValue: util.money(util.sum(rows, 'outValue')),
                transit: util.money(util.sum(rows, 'transitValue')),
                apOpen: util.money(util.sum(rows, 'apOpen')),
                perOrder: util.round(util.sum(rows, 'perOrder'), 3),
                orders: TMS.stats.ordersWithin(days).length,
                gapCount: gaps.out.length + gaps.low.length + gaps.late.length + gaps.drift.length + gaps.orphan.length + gaps.obsolete.length
            };
        },
        render: function (ctx, d) {
            var kpi = ui.kpis([
                { label: '在册物料', value: d.rows.length, unit: '种', icon: '⛔', sub: '告急 ' + d.gaps.low.length + ' · 断货 ' + d.gaps.out.length },
                { label: '库存金额', value: fmt.money(d.value), icon: '¥', tone: 'brand', sub: '停用仍有存货 ' + d.gaps.obsolete.length + ' 种' },
                { label: '窗口领用', value: fmt.money(d.outValue), icon: '⇣', sub: d.orders + ' 票摊薄 ' + fmt.money(d.perOrder) + '/票' },
                { label: '在途采购', value: fmt.money(d.transit), icon: '⇄', tone: d.gaps.late.length ? 'danger' : '', sub: '超期未到 ' + d.gaps.late.length + ' 种' },
                { label: '供应商未结应付', value: fmt.money(d.apOpen), icon: '⌁', tone: d.apOpen ? 'warn' : '', sub: '有在途却没挂账 ' + d.gaps.orphan.length + ' 种' },
                { label: '补货体检', value: d.gapCount, unit: '项', icon: '⚑', tone: d.gapCount ? 'warn' : 'success', sub: '账实差异 ' + d.gaps.drift.length + ' 种' }
            ]);
            var whCard = ui.card({
                title: '各仓耗材规模', sub: '同一个品类在不同仓的松紧完全不同，补货要落到具体的仓', flat: true,
                body: ui.table({
                    dense: true, keyName: 'id', rows: d.byWh,
                    columns: [
                        { key: 'name', label: '仓库', render: function (r) { return ui.link(esc(r.name), 'wh:open', r.id); } },
                        { key: 'city', label: '城市', width: '110px' },
                        { key: 'qty', label: '现存合计', align: 'right', width: '128px', render: function (r) { return fmt.number(r.qty); } },
                        { key: 'value', label: '库存金额', align: 'right', width: '128px', render: function (r) { return fmt.money(r.value); } },
                        { key: 'low', label: '告急品类', align: 'right', width: '116px', render: function (r) { return r.low ? ui.badge(r.low + ' 项', 'warn') : '<span class="tms-dim">无</span>'; } }
                    ]
                })
            });
            var trendCard = ui.card({
                title: '包材领用金额', sub: '近 14 天出库折算金额（成本已在单票口径，这里只做消耗监控）', flat: true,
                body: ch.line({ data: d.trend, height: 220, area: true, fmt: function (v) { return fmt.money(v); } })
            });
            var coverCard = ui.card({
                title: '覆盖倍数与囤占', sub: '现存 ÷ 安全库存；<1 断料，≥6 囤资金', flat: true,
                body: ch.compare({
                    data: util.sortBy(d.rows, 'cover', 'desc').slice(0, 8).map(function (r) {
                        return { label: r.name.split(' ')[0], value: r.cover, target: 1.5, text: fmt.number(r.qty) + ' ' + r.unit, color: r.cover < 1 ? '#d93a3a' : (r.cover >= 6 ? '#e58a1a' : '#1668dc') };
                    }),
                    rowH: 26
                })
            });
            var gapCard = ui.card({
                title: '补货体检', sub: '断料、囤货、在途超期、挂账缺失四种钱和料的问题一次摊开',
                tone: d.gapCount ? 'danger' : '', flat: true,
                body: ui.list([
                    {
                        title: '全网断货 ' + ui.badge(d.gaps.out.length + ' 种', d.gaps.out.length ? 'danger' : 'success'),
                        sub: d.gaps.out.length ? d.gaps.out.map(function (r) { return esc(r.name); }).join('、') + '：分拨当天就没得用，只能临时外采' : '没有断货品项',
                        right: d.gaps.out.length ? ui.btn('立即补货', { size: 'sm', tone: 'danger', act: 'mat:buy', arg: d.gaps.out[0].id }) : ''
                    },
                    {
                        title: '低于安全线 ' + ui.badge(d.gaps.low.length + ' 种', d.gaps.low.length ? 'warn' : 'success'),
                        sub: d.gaps.low.length ? d.gaps.low.slice(0, 5).map(function (r) { return esc(r.name + '（' + fmt.number(r.qty) + '/' + fmt.number(r.safeStock) + r.unit + '）'); }).join('、') : '全部品项在安全线上',
                        right: d.gaps.low.length ? ui.btn('库存台账', { size: 'sm', act: 'mat:goWarehouse' }) : ''
                    },
                    {
                        title: '采购超期未到货 ' + ui.badge(d.gaps.late.length + ' 种', d.gaps.late.length ? 'danger' : 'success'),
                        sub: d.gaps.late.length ? d.gaps.late.slice(0, 5).map(function (r) { return esc(r.name + '（挂 ' + r.lateDays + ' 天）'); }).join('、') + '：应付已按账期确认，货却没进仓，账实两头都虚' : '在途采购都在约定时间内',
                        right: d.gaps.late.length ? ui.btn('在途单催收', { size: 'sm', tone: 'danger', act: 'mat:buys' }) : ''
                    },
                    {
                        title: '有在途却没有应付 ' + ui.badge(d.gaps.orphan.length + ' 种', d.gaps.orphan.length ? 'warn' : 'success'),
                        sub: d.gaps.orphan.length ? d.gaps.orphan.map(function (r) { return esc(r.name); }).join('、') + '：到货即入库却没有成本归属，这批耗材永远不进损益' : '每张在途单都挂着未结应付',
                        right: d.gaps.orphan.length ? ui.btn('重挂应付', { size: 'sm', tone: 'warn', act: 'mat:repair' }) : ''
                    },
                    {
                        title: '账实核对不平 ' + ui.badge(d.gaps.drift.length + ' 种', d.gaps.drift.length ? 'danger' : 'success'),
                        sub: d.gaps.drift.length ? d.gaps.drift.slice(0, 5).map(function (r) { return esc(r.name + '（差 ' + fmt.number(r.diff) + r.unit + '）'); }).join('、') : '每种物料都能顺着流水推回现存',
                        right: d.gaps.drift.length ? ui.btn('盘点调平', { size: 'sm', tone: 'danger', act: 'mat:count', arg: d.gaps.drift[0].id }) : ''
                    },
                    {
                        title: '超储囤货（覆盖 ≥6 倍） ' + ui.badge(d.gaps.over.length + ' 种', d.gaps.over.length ? 'warn' : 'success'),
                        sub: d.gaps.over.length ? d.gaps.over.slice(0, 5).map(function (r) { return esc(r.name + ' ' + r.cover + ' 倍'); }).join('、') + '：占用资金和库位，先停采、跨仓调拨消化' : '没有明显囤占'
                    },
                    {
                        title: '停用但仍有存货 ' + ui.badge(d.gaps.obsolete.length + ' 种', d.gaps.obsolete.length ? 'muted' : 'success'),
                        sub: d.gaps.obsolete.length ? d.gaps.obsolete.map(function (r) { return esc(r.name + '（' + fmt.number(r.qty) + r.unit + '）'); }).join('、') : '停用物料都已清仓'
                    }
                ])
            });
            var buyCard = ui.card({
                title: '在途采购与应付核对', flat: true,
                sub: (function () { var n = util.sum(d.rows, 'pendingCount'); return n ? n + ' 张未到货凭证 · 下单即挂供应商应付，到货入库才加库存' : '没有在途采购单'; })(),
                tools: d.rows.some(function (r) { return r.transit > 0; }) ? ui.btn('全部在途单', { size: 'sm', tone: 'ghost', act: 'mat:buys' }) : '',
                body: d.rows.filter(function (r) { return r.transit > 0 || r.apCount; }).length ? ui.table({
                    dense: true, keyName: 'id',
                    rows: d.rows.filter(function (r) { return r.transit > 0 || r.apCount; }),
                    columns: [
                        { key: 'name', label: '物料', render: function (r) { return ui.link(esc(r.name), 'mat:open', r.id) + '<div class="tms-dim">' + esc(r.supplier || '未指定供应商') + '</div>'; } },
                        { key: 'qty', label: '现存', align: 'right', width: '104px', render: function (r) { return fmt.number(r.qty) + ' ' + esc(r.unit); } },
                        { key: 'transit', label: '在途', align: 'right', width: '104px', render: function (r) { return r.transit ? '<b class="tone-accent">' + fmt.number(r.transit) + '</b>' : '<span class="tms-dim">0</span>'; } },
                        { key: 'suggest', label: '建议补至', align: 'right', width: '104px', render: function (r) { return r.suggest ? fmt.number(r.suggest) + ' ' + esc(r.unit) : '<span class="tms-dim">够</span>'; } },
                        { key: 'transitValue', label: '在途金额', align: 'right', width: '116px', render: function (r) { return fmt.money(r.transitValue); } },
                        { key: 'apOpen', label: '未结应付', align: 'right', width: '116px', render: function (r) { return r.apOpen ? fmt.money(r.apOpen) : '<span class="tms-dim">未挂账</span>'; } },
                        { key: 'lateCount', label: '超期', align: 'right', width: '92px', render: function (r) { return r.lateCount ? ui.badge(r.lateDays + ' 天', 'danger') : '<span class="tms-dim">按时</span>'; } },
                        { key: 'ops', label: '操作', align: 'right', width: '124px', sortable: false, render: function (r) { return ui.link('补货', 'mat:buy', r.id, { tone: 'ghost' }) + ' ' + ui.link('盘点', 'mat:count', r.id, { tone: 'ghost' }); } }
                    ]
                }) : ui.empty('没有在途采购与挂账', '从台账行点「补货」下单，系统会同时生成在途凭证和供应商应付')
            });
            var listCard = grid(ctx, {
                title: '物料台账', rows: d.rows, keyName: 'id', dense: true, onRow: 'mat:open', searchKey: 'q',
                filter: function (r, fs) {
                    if (fs.status && r.status !== fs.status) return false;
                    if (fs.supplierId && r.supplierId !== fs.supplierId) return false;
                    var c = fs.chip || '';
                    if (c === 'need' && !(r.status === 'low' || r.status === 'out')) return false;
                    if (c === 'transit' && !r.transit) return false;
                    if (c === 'late' && !r.lateCount) return false;
                    if (c === 'over' && r.cover < 6) return false;
                    return true;
                },
                search: function (r) { return [r.id, r.name, r.supplier, r.unit].join(' '); },
                chips: [
                    { label: '全部', value: '', count: d.rows.length },
                    { label: '待补货', value: 'need', count: d.gaps.low.length + d.gaps.out.length },
                    { label: '有在途', value: 'transit', count: d.rows.filter(function (r) { return r.transit > 0; }).length },
                    { label: '超期未到', value: 'late', count: d.gaps.late.length },
                    { label: '超储', value: 'over', count: d.gaps.over.length }
                ], chipsName: 'chip',
                fields: [
                    { key: 'q', type: 'search', label: '物料 / 供应商', placeholder: '纸箱 / 安捷包装' },
                    { key: 'status', label: '状态', options: [{ value: '', label: '全部状态' }].concat(Object.keys(MAT_TEXT).map(function (k) { return { value: k, label: MAT_TEXT[k] }; })) },
                    { key: 'supplierId', label: '供应商', options: [{ value: '', label: '全部供应商' }].concat(ui.optionsOf(db.col('suppliers'), 'id', 'name')) }
                ],
                tools: ui.btn('新增物料', { size: 'sm', tone: 'primary', act: 'mat:new', icon: '+' }) +
                    ui.btn('在途采购单', { size: 'sm', act: 'mat:buys', icon: '⇄' }) +
                    ui.btn('导出', { size: 'sm', tone: 'ghost', act: 'mat:export', icon: '↓' }),
                columns: [
                    {
                        key: 'name', label: '物料', render: function (r) {
                            return ui.link(esc(r.name), 'mat:open', r.id) +
                                '<div class="tms-dim">' + esc(r.unit) + ' · ' + fmt.money(r.price) + ' · ' + esc(r.supplier || '未指定供应商') + '</div>';
                        }
                    },
                    { key: 'qty', label: '现存', align: 'right', width: '112px', render: function (r) { return (r.status === 'out' ? '<b class="tone-danger">' : (r.status === 'low' ? '<b class="tone-warn">' : '')) + fmt.number(r.qty) + '</b> ' + esc(r.unit); } },
                    { key: 'safeStock', label: '安全库存', align: 'right', width: '104px', render: function (r) { return fmt.number(r.safeStock); } },
                    { key: 'cover', label: '覆盖倍数', align: 'right', width: '120px', render: function (r) { return r.cover < 1 ? ui.badge(r.cover + ' 倍', 'danger') : (r.cover >= 6 ? ui.badge(r.cover + ' 倍', 'warn') : fmt.number(r.cover) + ' 倍'); } },
                    { key: 'value', label: '库存金额', align: 'right', width: '116px', render: function (r) { return fmt.money(r.value); } },
                    { key: 'outQty', label: '窗口领用', align: 'right', width: '116px', render: function (r) { return r.outQty ? fmt.number(r.outQty) + ' · ' + fmt.money(r.outValue) : '<span class="tms-dim">无领用</span>'; } },
                    { key: 'turnDays', label: '周转', align: 'right', width: '92px', render: function (r) { return r.turnDays == null ? '<span class="tms-dim">—</span>' : r.turnDays + ' 天'; } },
                    { key: 'transit', label: '在途', align: 'right', width: '96px', render: function (r) { return r.transit ? fmt.number(r.transit) + (r.lateCount ? ' ' + ui.badge('超期', 'danger') : '') : '<span class="tms-dim">—</span>'; } },
                    { key: 'diff', label: '账实差异', align: 'right', width: '104px', render: function (r) { return r.diff == null ? '<span class="tms-dim">无凭证</span>' : (Math.abs(r.diff) > 0.5 ? ui.badge(fmt.number(r.diff), 'danger') : '<span class="tms-dim">0</span>'); } },
                    { key: 'status', label: '状态', align: 'right', width: '84px', sortable: false, render: function (r) { return statusBadge(r.status, MAT_TEXT); } },
                    {
                        key: 'ops', label: '操作', align: 'right', width: '152px', sortable: false, render: function (r) {
                            return ui.link('补货', 'mat:buy', r.id, { tone: 'ghost' }) + ' ' +
                                ui.link('盘点', 'mat:count', r.id, { tone: 'ghost' }) + ' ' +
                                ui.link('编辑', 'mat:edit', r.id, { tone: 'ghost' });
                        }
                    }
                ],
                emptyText: '没有符合条件的物料'
            });
            return wrap(ctx, {
                actions: ui.btn('新增物料', { tone: 'primary', act: 'mat:new', icon: '+' }) +
                    ui.btn('重算档案合计', { act: 'mat:sync', icon: '⚑' }),
                sub: '窗口 ' + d.days + ' 天 · ' + d.orders + ' 票分摊包材 ' + fmt.money(d.perOrder) + '/票 · 库存金额 ' + fmt.money(d.value),
                body: [kpi, ui.split('2', [trendCard, coverCard]), whCard, ui.split('2', [gapCard, buyCard]), listCard]
            });
        },
        actions: merge(stockActions, {
            'mat:new': function () { materialFormModal(''); },
            'mat:goWarehouse': function () { ui.closeTop(); TMS.shell.go('warehouse'); },
            'mat:sync': function () {
                var drift = [];
                db.col('materials').forEach(function (m) {
                    var sum = Math.round(util.sum(db.col('stocks').filter(function (s) { return s.materialId === m.id; }), 'qty'));
                    if (sum !== (Number(m.stock) || 0)) drift.push({ id: m.id, from: m.stock, to: sum, name: m.name });
                });
                if (!drift.length) { ui.toast('物料档案合计与各仓库存行完全一致', 'success'); return; }
                ui.confirm({
                    title: '按库存行重算 ' + drift.length + ' 个物料档案',
                    message: '档案合计与「各仓相加」对不上。',
                    detail: drift.slice(0, 8).map(function (r) { return esc(r.name + '：' + fmt.number(r.from) + ' → ' + fmt.number(r.to)); }).join('<br>') +
                        '<br>库存行是事实，档案合计只是派生数，重算不改任何一张流水。'
                }).then(function (yes) {
                    if (!yes) return;
                    db.batch(function () { drift.forEach(function (r) { syncMaterial(r.id); }); }, 'material:sync');
                    TMS.audit.log('material.sync', 'materials', '', '按库存行重算物料合计 ' + drift.length + ' 项', actor());
                    ui.toast('已重算 ' + drift.length + ' 项物料合计', 'success');
                    TMS.shell.refresh();
                });
            },
            'mat:repair': function () {
                var orphans = matRowsOf(Math.max(7, Number(curCtx().days) || 30)).filter(function (r) { return r.transit > 0 && !r.apCount; });
                if (!orphans.length) { ui.toast('每张在途采购都已经挂了应付', 'success'); return; }
                ui.confirm({
                    title: '补挂 ' + orphans.length + ' 项在途采购应付',
                    message: '有在途数量却没有未结应付，货到就直接进库存、成本无处归集。',
                    detail: orphans.slice(0, 8).map(function (r) { return esc(r.name + ' 在途 ' + fmt.number(r.transit) + r.unit + '，折 ' + fmt.money(r.transitValue)); }).join('<br>') +
                        '<br>补挂按档案单价 × 在途量计，供应商取物料主供应商，账期默认月结。'
                }).then(function (yes) {
                    if (!yes) return;
                    var created = [];
                    db.batch(function () {
                        orphans.forEach(function (r) {
                            var mv = db.findOne('stockMovements', function (x) {
                                return x.materialId === r.id && x.kind === 'purchase' && (!x.status || x.status === 'pending' || x.status === 'partial');
                            });
                            if (!mv) return;
                            var ap = TMS.finance.createPayable({
                                refId: r.id, refNo: mv.id, target: r.supplier || '物料供应商', targetType: 'supplier',
                                category: '物料耗材', amount: util.money(r.transit * r.price), date: util.dateKey(mv.date || util.now()),
                                dueDate: util.dateKey(util.addDays(util.toDate(mv.date || util.now()), 30)),
                                status: 'pending', remark: fmt.number(r.transit) + r.unit + ' ' + r.name + ' 采购在途补挂'
                            });
                            if (ap) { db.update('stockMovements', mv.id, { refId: ap.id }); db.commit('stockMovements', mv.id, 'purchase:repair'); created.push(r.name); }
                        });
                    }, 'material:repair');
                    if (!created.length) { ui.toast('没有找到可补挂的在途凭证', 'warn'); return; }
                    TMS.audit.log('purchase.repair', 'materials', '', '补挂在途采购应付：' + created.join('、'), actor());
                    ui.toast('已补挂 ' + created.length + ' 张供应商应付', 'success');
                    TMS.shell.refresh();
                });
            },
            'mat:export': function () {
                exportGrid({
                    name: '物料台账.csv', rows: matRowsOf(Math.max(7, Number(curCtx().days) || 30)), searchKey: 'q',
                    search: function (r) { return [r.id, r.name, r.supplier, r.unit].join(' '); },
                    cols: [
                        { key: 'id', label: '物料编号' }, { key: 'name', label: '物料名称' }, { key: 'unit', label: '单位' },
                        { key: 'price', label: '参考单价' }, { key: 'qty', label: '全网现存' }, { key: 'safeStock', label: '安全库存' },
                        { key: 'cover', label: '覆盖倍数' }, { key: 'value', label: '库存金额' },
                        { key: 'outQty', label: '窗口领用' }, { key: 'outValue', label: '领用金额' },
                        { key: 'turnDays', label: '周转天数' }, { key: 'transit', label: '在途数量' },
                        { key: 'apOpen', label: '未结应付' }, { key: 'diff', label: '账实差异' },
                        { key: 'supplier', label: '供应商' },
                        { key: 'status', label: '状态', value: function (r) { return MAT_TEXT[r.status] || r.status; } }
                    ]
                }, 'material');
            }
        })
    });

    /* ---------- 二十八、电子围栏 ---------- */

    /* 围栏表只存几何与归属（圆心、半径、绑定对象、状态），覆盖 / 越界 / 命中一律读时现算：
       扫描流水每天在长，把统计落库等于第二天就开始说谎 */
    var GF_TYPE_TEXT = { hub: '分拨场地围栏', city: '城市作业围栏' };
    var GF_STATUS_TEXT = { active: '在用', draft: '草稿', disabled: '已停用' };

    function gfRefName(g) {
        if (!g.refId) return '不绑定场地';
        var h = TMS.master.hubByNameOrId(g.refId);
        return h ? h.name : g.refId;
    }

    /* 每座城市归第一张罩住它的在用围栏所有：归属唯一，命中数才不会在两张围栏间重复计 */
    function gfOwners() {
        var map = {};
        TMS.master.CITIES.forEach(function (c) {
            var g = TMS.network.fenceOfCity(c.name);
            if (g) map[c.name] = g.id;
        });
        return map;
    }

    /* 一次遍历扫描流水，同时得出「每张围栏命中多少」「哪些城市没人管」，
       页面三块区域共用这份结果，避免各算各的口径对不上 */
    function gfScanStats(days) {
        var owners = gfOwners();
        var cutoff = util.addDays(util.now(), -days).getTime();
        var byFence = {}, byCity = {}, orphan = [], located = 0;
        db.col('scans').forEach(function (s) {
            if (!s.location) return;
            if (util.toDate(s.opTime).getTime() < cutoff) return;
            located++;
            var city = TMS.network.cityOfText(s.location);
            if (!city) return;
            byCity[city] = (byCity[city] || 0) + 1;
            var fid = owners[city];
            if (!fid) { orphan.push({ city: city, scan: s }); return; }
            var b = byFence[fid] || (byFence[fid] = { hit: 0, lastAt: '', orders: {} });
            b.hit++;
            if (s.orderId) b.orders[s.orderId] = 1;
            if (!b.lastAt || String(s.opTime) > String(b.lastAt)) b.lastAt = s.opTime;
        });
        return { owners: owners, byFence: byFence, byCity: byCity, orphan: orphan, located: located };
    }

    /* 半径是这张表上唯一能改变结论的参数：调小会放走边缘城市，调大会顺手罩住邻市 */
    function gfRadiusEffect(g) {
        var c = TMS.master.cityByName(g.city);
        var inside = [], outside = [];
        TMS.master.CITIES.forEach(function (x) {
            if (!c) return;
            var km = util.distanceKm(c, x);
            if (TMS.network.pointInFence(x, g)) inside.push({ city: x.name, km: util.round(km, 1) });
            else outside.push({ city: x.name, km: util.round(km, 1) });
        });
        outside.sort(function (a, b) { return a.km - b.km; });
        return { inside: inside, nearMiss: outside.slice(0, 3) };
    }

    function gfModal(id) {
        var g = db.get('geofences', id);
        if (!g) { ui.toast('未找到围栏 ' + id, 'warn'); return; }
        var days = Math.max(7, Number(curCtx().days) || 7);
        var stats = gfScanStats(days);
        var st = stats.byFence[id] || { hit: 0, lastAt: '', orders: {} };
        var eff = gfRadiusEffect(g);
        var branches = db.col('branches').filter(function (b) { return b.city === g.city; });
        var orderIds = Object.keys(st.orders).slice(0, 6);
        ui.modal({
            title: g.name,
            sub: (GF_TYPE_TEXT[g.type] || g.type) + ' · ' + g.city + ' · 半径 ' + fmt.number(g.radiusM) + ' m',
            body: ui.stack([
                ui.kpis([
                    { label: '罩住城市', value: eff.inside.length, unit: '座', tone: eff.inside.length ? 'success' : 'danger', sub: '圆心在本市质心' },
                    { label: '窗口命中', value: st.hit, unit: '次', tone: 'brand', sub: '近 ' + days + ' 天写在地点的流水' },
                    { label: '涉及订单', value: Object.keys(st.orders).length, unit: '票', tone: 'info' },
                    { label: '半径', value: util.round(Number(g.radiusM) / 1000, 2), unit: 'km', tone: 'warn', sub: '决定覆盖范围' },
                    { label: '同城网点', value: branches.length, unit: '个', tone: 'muted' },
                    { label: '同城终端', value: db.col('devices').filter(function (d) { return d.city === g.city; }).length, unit: '台', tone: 'muted' }
                ]),
                ui.card({
                    title: '覆盖判定', sub: '城市质心到圆心的距离与半径对照，超出即算越界', flat: true,
                    body: ui.desc([
                        { label: '绑定对象', value: esc(gfRefName(g)) + (g.refId ? ' ' + ui.idCell(g.refId, '') : '') },
                        { label: '围栏状态', value: statusBadge(g.status, GF_STATUS_TEXT) },
                        { label: '罩住的城市', value: eff.inside.length ? util.unique(eff.inside.map(function (x) { return x.city; })).join('、') : ui.badge('一座也没有', 'danger') },
                        { label: '半径外最近城市', value: eff.nearMiss.length ? eff.nearMiss.map(function (x) { return esc(x.city) + ' ' + x.km + ' km'; }).join(' · ') : '—' },
                        { label: '最近命中', value: st.lastAt ? fmt.dateTime(st.lastAt) : '<span class="tms-dim">窗口内无地点流水</span>' },
                        { label: '建档时间', value: g.updatedAt ? fmt.dateTime(g.updatedAt) : '<span class="tms-dim">未记录</span>' }
                    ]),
                    foot: orderIds.length ? '<div class="tms-row">' + orderIds.map(function (o) {
                        return ui.link((db.get('orders', o) || {}).waybillNo || o, 'order:open', o, { tone: 'ghost' });
                    }).join(' ') + '<span class="tms-dim">等 ' + Object.keys(st.orders).length + ' 票在本围栏内作业</span></div>' : ''
                }),
                ui.card({
                    title: '同城网点', sub: branches.length + ' 个 · 网点坐标即城市质心，因此同城网点必然同进同出', flat: true,
                    body: ui.table({
                        dense: true, keyName: 'id', emptyText: '该市暂无登记网点',
                        columns: [
                            { key: 'id', label: '编号', render: function (b) { return ui.idCell(b.id, ''); } },
                            { key: 'name', label: '网点' },
                            { key: 'type', label: '类型' },
                            { key: 'hubName', label: '归属分拨' },
                            { key: 'staffCount', label: '人数', align: 'right' },
                            { key: 'status', label: '状态', render: function (b) { return b.status === 'active' ? ui.badge('营业', 'success') : ui.badge('停业', 'muted'); } }
                        ],
                        rows: branches.slice(0, 8)
                    })
                })
            ]),
            footer: ui.btn('调整半径', { tone: 'primary', act: 'gf:resize', arg: g.id }) +
                ui.btn(g.status === 'active' ? '停用' : '启用', { act: 'gf:toggle', arg: g.id }) +
                ui.btn('编辑档案', { act: 'gf:edit', arg: g.id }) +
                ui.btn('关闭', { act: 'ui:close' })
        });
    }

    /* 圆心不接受手填：手填经纬度迟早和 cities 表分家，城市一选圆心就定 */
    function gfFormModal(id, presetCity) {
        var g = id ? db.get('geofences', id) : null;
        var hubOptions = ui.optionsOf(db.col('hubs'), 'id', 'name');
        ui.formModal({
            title: g ? '编辑围栏 ' + g.name : '新建电子围栏',
            sub: g ? '改半径会立刻改变覆盖判定与越界告警' : '城市作业围栏建议 20~40 km，分拨场地围栏 1~3 km',
            notice: g ? '' : '新围栏落库后立刻重跑「电子围栏覆盖缺口」巡检：该城市的越界告警当场核销，不需要等下一轮。',
            values: g ? {
                name: g.name, city: g.city, type: g.type, refId: g.refId || '',
                radiusM: g.radiusM, status: g.status
            } : {
                name: presetCity ? presetCity + '作业围栏' : '', city: presetCity || '', type: 'city',
                refId: '', radiusM: (function () {
                    var a = TMS.network.fenceAudit(Math.max(7, Number(curCtx().days) || 7));
                    var b = a.breaches.filter(function (x) { return x.city === presetCity; })[0];
                    return b ? b.radiusM : 25000;
                })(),
                status: 'active'
            },
            fields: [
                { key: 'name', label: '围栏名称', required: true, span: 2, placeholder: '例：福州作业围栏' },
                { key: 'city', label: '所在城市', type: 'city', required: true, tip: '圆心取该城市质心，不可手填经纬度' },
                { key: 'type', label: '围栏类型', type: 'select', options: dictOptions(GF_TYPE_TEXT) },
                { key: 'refId', label: '绑定分拨', type: 'select', options: [{ value: '', label: '不绑定（城市作业围栏）' }].concat(hubOptions) },
                { key: 'radiusM', label: '覆盖半径', type: 'number', required: true, min: 300, max: 120000, step: 500, unit: '米', tip: '城市质心到圆心的距离小于半径即算覆盖' },
                { key: 'status', label: '状态', type: 'select', options: dictOptions(GF_STATUS_TEXT) }
            ],
            okText: g ? '保存并重跑巡检' : '建立并重跑巡检',
            onSubmit: function (v) {
                var city = TMS.master.cityByName(v.city);
                if (!city) return '城市「' + v.city + '」不在城市档案里，请先在主数据里补';
                var patch = {
                    name: v.name, city: v.city, type: v.type, refId: v.type === 'hub' ? v.refId : '',
                    radiusM: Math.max(300, Number(v.radiusM) || 0), status: v.status,
                    center: { lat: city.lat, lng: city.lng }, updatedAt: util.iso(util.now())
                };
                var saved;
                db.batch(function () {
                    saved = g ? db.update('geofences', g.id, patch) : db.create('geofences', patch);
                    if (saved) db.commit('geofences', saved.id, 'geofence:save');
                }, 'geofence:save');
                if (!saved) return '保存失败';
                TMS.audit.log(g ? 'geofence.update' : 'geofence.create', 'geofences', saved.id,
                    saved.name + ' 半径 ' + saved.radiusM + ' m', actor());
                var out = TMS.jobs.run('fenceCoverage').out || {};
                ui.toast((g ? '已更新围栏' : '已建立围栏') + '，' + v.city + ' 越界告警核销 ' + (out.resolved || 0) +
                    ' 条，剩余缺口 ' + out.gap + ' 座城市', 'success');
                TMS.shell.refresh();
            }
        });
    }

    /* 半径单独调：这是围栏上唯一「改了立刻变结论」的参数，给它一条独立入口 */
    function gfResizeModal(id) {
        var g = db.get('geofences', id);
        if (!g) return;
        var eff = gfRadiusEffect(g);
        ui.formModal({
            title: '调整 ' + g.name + ' 的覆盖半径',
            sub: '当前 ' + fmt.number(g.radiusM) + ' m，罩住 ' + eff.inside.length + ' 座城市',
            notice: eff.nearMiss.length ? '半径外最近的是 ' + eff.nearMiss[0].city + '（' + eff.nearMiss[0].km +
                ' km），放大到该距离以上即可一并覆盖。' : '',
            values: { radiusM: g.radiusM },
            fields: [{ key: 'radiusM', label: '覆盖半径', type: 'number', required: true, min: 300, max: 120000, step: 500, unit: '米', span: 2 }],
            okText: '保存并重跑巡检',
            onSubmit: function (v) { gfApply(id, { radiusM: Math.max(300, Number(v.radiusM) || 0) }, '半径'); }
        });
    }

    function gfApply(id, patch, what) {
        var g = db.get('geofences', id);
        if (!g) return;
        db.batch(function () {
            db.update('geofences', id, patch);
            db.commit('geofences', id, 'geofence:' + what);
        }, 'geofence:' + what);
        TMS.audit.log('geofence.update', 'geofences', id, g.name + ' 调整' + what, actor());
        var out = TMS.jobs.run('fenceCoverage').out || {};
        ui.toast('已调整' + what + '，越界缺口剩 ' + out.gap + ' 座城市，本轮核销 ' + (out.resolved || 0) + ' 条告警', 'success');
        TMS.shell.refresh();
    }

    /* 批量补围栏：按缺口从大到小建城市作业围栏，半径用审计给出的建议值。
       一次建完再跑巡检，所以告警是一次性核销掉一批，而不是建一张响一轮 */
    function gfBulkCover() {
        var days = Math.max(7, Number(curCtx().days) || 7);
        var audit = TMS.network.fenceAudit(days);
        var targets = audit.breaches.slice(0, 10);
        if (!targets.length) { ui.toast('所有作业城市都已在围栏覆盖内', 'success'); return; }
        ui.confirm({
            title: '为 ' + targets.length + ' 座缺口城市建立作业围栏',
            message: '这些城市的扫描地点写在任何在用围栏之外，系统无法判定作业是否合规。',
            detail: targets.map(function (b) {
                return esc(b.city + '：越界 ' + b.count + ' 次 / ' + b.branches + ' 个网点，建议半径 ' + Math.round(b.radiusM / 1000) + ' km');
            }).join('<br>') + '<br>建完立即重跑巡检，覆盖到的城市告警当场核销。'
        }).then(function (yes) {
            if (!yes) return;
            var created = [];
            db.batch(function () {
                targets.forEach(function (b) {
                    var c = TMS.master.cityByName(b.city);
                    if (!c) return;
                    var row = db.create('geofences', {
                        name: b.city + '作业围栏', type: 'city', refId: '', city: b.city,
                        center: { lat: c.lat, lng: c.lng }, radiusM: b.radiusM,
                        status: 'active', updatedAt: util.iso(util.now())
                    });
                    if (row) { db.commit('geofences', row.id, 'geofence:bulk'); created.push(row.name); }
                });
            }, 'geofence:bulk');
            if (!created.length) { ui.toast('没有可建立的城市', 'warn'); return; }
            TMS.audit.log('geofence.bulk', 'geofences', '', '批量建立作业围栏：' + created.join('、'), actor());
            var out = TMS.jobs.run('fenceCoverage').out || {};
            ui.toast('已建立 ' + created.length + ' 张围栏，核销 ' + (out.resolved || 0) + ' 条越界告警，剩 ' + out.gap + ' 座城市缺口', 'success');
            TMS.shell.refresh();
        });
    }

    /* 越界不是画个红点就完事：拿它开一张异常工单，责任落到分拨，闭环走异常页那套定责、扣款与理赔。
       动作只带订单号，越界城市从这单的扫描里现算——拼 "订单|城市" 的参数串改一个字段就错位，
       且要和 fenceAudit 同口径，所以只认显式写了 location 的流水 */
    function gfException(orderId) {
        var o = db.get('orders', orderId);
        if (!o) { ui.toast('未找到订单 ' + orderId + '，无法登记越界异常', 'warn'); return; }
        var hit = null;
        db.col('scans').forEach(function (s) {
            if (hit || s.orderId !== orderId || !s.location) return;
            var c = TMS.network.cityOfText(s.location);
            if (c && !TMS.network.fenceOfCity(c)) hit = { city: c, node: s.node, at: s.opTime, location: s.location };
        });
        if (!hit) { ui.toast(o.waybillNo + ' 的作业地点已都能对应到在用围栏，无需登记异常', 'info'); return; }
        var res = TMS.service.createException({
            orderId: orderId, type: '其他异常', level: '三级',
            description: '作业环节 ' + cfg.nodeOf(hit.node).name + ' 登记地点「' + hit.location +
                '」解析为 ' + hit.city + '，不在任何电子围栏内，无法核验该环节是否真实发生在归属场地，需复核网点布点与操作规范',
            actor: actor(), source: '围栏预警'
        });
        if (!res) { ui.toast('异常工单创建失败', 'danger'); return; }
        ui.toast('已就 ' + hit.city + ' 越界作业登记异常工单 ' + res.id, 'success');
        TMS.shell.refresh();
    }

    var gfActions = {
        'gf:open': function (id) { gfModal(id); },
        'gf:edit': function (id) { gfFormModal(id); },
        'gf:new': function () { gfFormModal(''); },
        'gf:cover': function (city) { gfFormModal('', city); },
        'gf:bulk': function () { gfBulkCover(); },
        'gf:resize': function (id) { gfResizeModal(id); },
        'gf:toggle': function (id) {
            var g = db.get('geofences', id);
            if (!g) return;
            gfApply(id, { status: g.status === 'active' ? 'disabled' : 'active', updatedAt: util.iso(util.now()) },
                g.status === 'active' ? '停用' : '启用');
        },
        'gf:audit': function () {
            var out = TMS.jobs.run('fenceCoverage').out || {};
            ui.toast('巡检完成：' + out.gap + ' 座城市存在越界作业，核销 ' + (out.resolved || 0) + ' 条已消除的告警', 'info');
            TMS.shell.refresh();
        },
        'gf:exception': function (orderId) { gfException(orderId); },
        'gf:goOrders': function (city) { ui.closeTop(); TMS.shell.go('order', { q: city }); }
    };

    /* 「重复布点」借用 status 这一列筛选位：它不是状态而是归属冲突，单独一档 */
    function gfRowFilter(r, fs) {
        if (fs.status === 'redundant') { if (!r.redundant) return false; }
        else if (fs.status && r.status !== fs.status) return false;
        if (fs.type && r.type !== fs.type) return false;
        if (fs.city && r.city !== fs.city) return false;
        return true;
    }

    /* 台账行 + 越界明细一次算完，页面取数与 CSV 导出共用同一份结果：
       导出走另一条取数路径迟早和表格对不上号 */
    function gfView(days) {
        var audit = TMS.network.fenceAudit(days);
        var stats = gfScanStats(days);
        var rows = db.col('geofences').map(function (g) {
            var st = stats.byFence[g.id] || { hit: 0, lastAt: '', orders: {} };
            var eff = gfRadiusEffect(g);
            var same = db.col('branches').filter(function (b) { return b.city === g.city; });
            return {
                id: g.id, name: g.name, type: g.type, city: g.city, status: g.status,
                radiusM: Number(g.radiusM) || 0, refId: g.refId || '', refName: gfRefName(g),
                coverCount: eff.inside.length, coverNames: util.unique(eff.inside.map(function (x) { return x.city; })),
                nearMiss: eff.nearMiss.length ? eff.nearMiss[0].city + ' ' + eff.nearMiss[0].km + ' km' : '',
                staff: util.sum(same, 'staffCount'), branchCount: same.length,
                devices: db.col('devices').filter(function (d) { return d.city === g.city; }).length,
                hit: st.hit, orderCount: Object.keys(st.orders).length, lastAt: st.lastAt,
                redundant: g.status === 'active' && !!stats.owners[g.city] && stats.owners[g.city] !== g.id,
                updatedAt: g.updatedAt || ''
            };
        });
        var orphanTickets = {};
        var orphan = util.sortBy(stats.orphan, function (x) { return x.scan.opTime; }, 'desc');
        orphan.forEach(function (x) { if (x.scan.orderId) orphanTickets[x.scan.orderId] = 1; });
        return {
            days: days, audit: audit, rows: rows, stats: stats, gaps: audit.breaches,
            orphan: orphan, orphanTickets: Object.keys(orphanTickets).length,
            alerts: db.col('alerts').filter(function (a) { return a.status === 'open' && String(a.key).indexOf('fence:gap:') === 0; })
        };
    }

    pg.define('geofence', {
        sub: '围栏决定「这个城市的作业地点算不算在网内」：缺口由巡检自动报警，补齐围栏当场自动核销',
        load: function (ctx) {
            applyParamFilter(ctx, ['type', 'city', 'q']);
            return gfView(ctx.days);
        },
        render: function (ctx, d) {
            var a = d.audit;
            var kpi = ui.kpis([
                { label: '围栏总数', value: d.rows.length, unit: '张', tone: 'brand', sub: '在用 ' + a.activeRows + ' 张' },
                { label: '覆盖城市', value: a.coveredCities, unit: '/ ' + a.cityCount, tone: 'success', sub: '城市质心落在任一在用围栏内' },
                { label: '缺口城市', value: d.gaps.length, unit: '座', tone: d.gaps.length ? 'danger' : 'success', sub: '窗口内有越界作业的城市' },
                { label: '带地点扫描', value: a.total, unit: '次', tone: 'info', sub: '常规作业地点由订单派生，不落库' },
                { label: '围栏内命中', value: a.covered, unit: '次', tone: 'brand', sub: '占比 ' + util.pct(a.covered, a.total) + '%，另有 ' + a.unknown + ' 次地点认不出城市' },
                { label: '越界作业', value: d.orphan.length, unit: '次', tone: d.orphan.length ? 'danger' : 'success', sub: '涉及 ' + d.orphanTickets + ' 票' },
                { label: '未决告警', value: d.alerts.length, unit: '条', tone: d.alerts.length ? 'warn' : 'success', sub: '补齐围栏即自动核销' }
            ]);
            var gapCard = ui.card({
                title: '覆盖缺口', sub: '越界次数从多到少 · 点「补围栏」直接带城市建档', icon: '⬡',
                tools: ui.btn('批量补前 10 座城市', { tone: 'primary', act: 'gf:bulk', icon: '⚑' }) +
                    ui.btn('重跑巡检', { act: 'gf:audit', icon: '⟳' }),
                body: d.gaps.length ? ui.list(d.gaps.slice(0, 10).map(function (b) {
                    return {
                        title: esc(b.city) + ' ' + ui.badge(b.count + ' 次越界', b.count > 40 ? 'danger' : 'warn'),
                        sub: b.branches + ' 个网点归属 ' + esc(b.hub || '未指派分拨') +
                            ' · 最近在用围栏 ' + esc(b.nearestName || '无') + '（' + b.nearestKm + ' km）' +
                            ' · 建议半径 ' + Math.round(b.radiusM / 1000) + ' km · 涉及 ' + b.orders.length + ' 票可抽查',
                        right: ui.link('补围栏', 'gf:cover', b.city, { tone: 'ghost' })
                    };
                })) : ui.empty('所有作业城市都已在围栏内', '近 ' + d.days + ' 天没有任何扫描写在覆盖范围之外'),
                foot: d.gaps.length > 10 ? '<span class="tms-dim">另有 ' + (d.gaps.length - 10) + ' 座城市未列出，合计越界 ' +
                    util.sum(d.gaps.slice(10), 'count') + ' 次</span>' : ''
            });
            var cityCard = ui.card({
                title: '越界城市分布', sub: '近 ' + d.days + ' 天写在围栏外的扫描次数', flat: true,
                body: ch.bars({
                    data: d.gaps.slice(0, 12).map(function (b) { return { label: b.city, value: b.count }; }),
                    height: 230, barWidth: 26
                })
            });
            var orphanCard = ui.card({
                title: '越界作业明细', sub: d.orphan.length + ' 条 · 最多列 60 条，可按城市继续筛',
                tools: ui.btn('导出缺口', { act: 'gf:exportGap', icon: '⤓', size: 'sm' }),
                body: d.orphan.length ? ui.table({
                    dense: true, keyName: 'key',
                    columns: [
                        { key: 'city', label: '城市', width: '86px', sortable: false, render: function (r) { return '<b>' + esc(r.city) + '</b>'; } },
                        { key: 'order', label: '运单', sortable: false, render: function (r) { var o = db.get('orders', r.scan.orderId) || {}; return ui.idCell(o.waybillNo || r.scan.orderId, 'order:open'); } },
                        { key: 'node', label: '环节', sortable: false, render: function (r) { return ui.badge(esc(cfg.nodeOf(r.scan.node).name), 'muted'); } },
                        { key: 'location', label: '登记地点', sortable: false, render: function (r) { return esc(r.scan.location); } },
                        { key: 'opTime', label: '时间', align: 'right', sortable: false, render: function (r) { return '<span class="tms-nowrap">' + fmt.dateTime(r.scan.opTime) + '</span>'; } },
                        { key: 'operator', label: '操作人', sortable: false, render: function (r) { return dim(r.scan.operator); } },
                        {
                            key: 'ops', label: '操作', align: 'right', sortable: false, render: function (r) {
                                return r.scan.orderId ? ui.link('转异常', 'gf:exception', r.scan.orderId, { tone: 'ghost' }) : '<span class="tms-dim">无关联单</span>';
                            }
                        }
                    ],
                    rows: d.orphan.slice(0, 60).map(function (r, i) { return { key: i, city: r.city, scan: r.scan }; })
                }) : ui.empty('窗口内没有越界作业', '所有带地点的扫描都能对应到在用围栏')
            });
            var listCard = grid(ctx, {
                title: '围栏台账', sub: '半径决定覆盖、状态决定是否参与判定',
                rows: d.rows, searchKey: 'q',
                search: function (r) { return [r.id, r.name, r.city, r.refName].join(' '); },
                fields: [
                    { key: 'q', type: 'search', label: '编号 / 名称 / 城市' },
                    { key: 'type', label: '类型', options: [{ value: '', label: '全部类型' }].concat(dictOptions(GF_TYPE_TEXT)) },
                    { key: 'city', label: '城市', type: 'city', placeholder: '城市名，留空为全部' }
                ],
                filter: gfRowFilter,
                chips: [
                    { label: '全部', value: '', count: d.rows.length },
                    { label: '在用', value: 'active', count: util.countBy(d.rows, 'status').active || 0 },
                    { label: '已停用', value: 'disabled', count: util.countBy(d.rows, 'status').disabled || 0 },
                    { label: '重复布点', value: 'redundant', count: d.rows.filter(function (r) { return r.redundant; }).length }
                ],
                chipsName: 'status',
                tools: ui.btn('新建围栏', { tone: 'primary', act: 'gf:new', icon: '+' }) +
                    ui.btn('导出台账', { act: 'gf:export', icon: '⤓' }),
                columns: [
                    {
                        key: 'name', label: '围栏', render: function (r) {
                            return ui.link(esc(r.name), 'gf:open', r.id) +
                                '<div class="tms-dim">' + esc(GF_TYPE_TEXT[r.type] || r.type) + ' · ' + esc(r.refName) + '</div>';
                        }
                    },
                    { key: 'city', label: '城市', width: '86px' },
                    { key: 'radiusM', label: '半径', align: 'right', width: '92px', render: function (r) { return util.round(r.radiusM / 1000, 2) + ' km'; } },
                    { key: 'coverCount', label: '罩住城市', align: 'right', width: '104px', render: function (r) { return r.coverCount ? ui.badge(r.coverCount + ' 座', r.coverCount > 1 ? 'success' : 'muted') : ui.badge('未覆盖', 'danger'); } },
                    { key: 'branchCount', label: '同城网点', align: 'right', width: '100px', render: function (r) { return r.branchCount + ' 个 · ' + r.staff + ' 人'; } },
                    { key: 'hit', label: '窗口命中', align: 'right', width: '104px', render: function (r) { return r.hit ? fmt.number(r.hit) + ' 次' : '<span class="tms-dim">无流水</span>'; } },
                    { key: 'orderCount', label: '涉及订单', align: 'right', width: '96px', render: function (r) { return r.orderCount ? fmt.number(r.orderCount) : '<span class="tms-dim">—</span>'; } },
                    { key: 'lastAt', label: '最近命中', align: 'right', width: '132px', render: function (r) { return r.lastAt ? '<span class="tms-nowrap">' + fmt.dateTime(r.lastAt) + '</span>' : '<span class="tms-dim">—</span>'; } },
                    {
                        key: 'status', label: '状态', width: '112px', sortable: false, render: function (r) {
                            return statusBadge(r.status, GF_STATUS_TEXT) + (r.redundant ? ' ' + ui.badge('重复', 'warn') : '');
                        }
                    },
                    {
                        key: 'ops', label: '操作', align: 'right', width: '168px', sortable: false, render: function (r) {
                            return ui.link('半径', 'gf:resize', r.id, { tone: 'ghost' }) + ' ' +
                                ui.link('编辑', 'gf:edit', r.id, { tone: 'ghost' }) + ' ' +
                                ui.link(r.status === 'active' ? '停用' : '启用', 'gf:toggle', r.id, { tone: 'ghost' });
                        }
                    }
                ],
                emptyText: '没有符合条件的围栏'
            });
            return wrap(ctx, {
                actions: ui.btn('新建围栏', { tone: 'primary', act: 'gf:new', icon: '+' }) +
                    ui.btn('批量补缺口', { act: 'gf:bulk', icon: '⚑' }),
                sub: '窗口 ' + d.days + ' 天 · ' + fmt.number(a.total) + ' 次带地点扫描 · ' +
                    a.coveredCities + '/' + a.cityCount + ' 座城市在网内 · ' + d.gaps.length + ' 座城市越界',
                body: [kpi, ui.split('2', [gapCard, cityCard]), orphanCard, listCard, ui.card({
                    title: '口径说明', flat: true,
                    body: ui.desc([
                        { label: '为什么只统计带地点的扫描', value: '常规环节的地点由订单与节点派生、根本不落库；显式写了 location 的都是人工改判或异常上报，正是需要拿围栏核对的那批（本窗口 ' + a.total + ' 条）' },
                        { label: '覆盖怎么判', value: '城市质心到圆心的距离 ≤ 半径即算覆盖。同城网点在档案里共用城市质心，逐点算距离得到的是同一个答案，因此判定落在城市粒度' },
                        { label: '半径有什么用', value: '它是围栏上唯一能改变结论的参数：调小会放走边缘城市，调大可顺手罩住邻市（例如 25 km 能同时管住广佛）' },
                        { label: '缺口怎么消', value: '「电子围栏覆盖缺口」巡检按城市建告警（键 fence:gap:城市），补一张覆盖该城市的在用围栏后重跑巡检即自动核销，不需要手工关单。巡检固定按近 30 天窗口跑，与顶栏时间窗无关，所以页面显示的缺口城市数与告警数可能有几天差' },
                        { label: '重复布点', value: '同一城市被多张在用围栏罩住时，命中数只归第一张，其余标「重复」提示可以停用' },
                        { label: '越界了怎么办', value: '明细里可一键转异常工单，走异常页那套定责、扣款与理赔闭环；围栏本身不改订单状态' }
                    ])
                })]
            });
        },
        actions: merge(gfActions, {
            'gf:export': function () {
                var d = gfView(Math.max(7, Number(curCtx().days) || 7));
                exportGrid({
                    name: '电子围栏台账.csv', rows: d.rows, searchKey: 'q', filter: gfRowFilter,
                    search: function (r) { return [r.id, r.name, r.city, r.refName].join(' '); },
                    cols: [
                        { key: 'id', label: '围栏编号' }, { key: 'name', label: '名称' },
                        { key: 'type', label: '类型', value: function (r) { return GF_TYPE_TEXT[r.type] || r.type; } },
                        { key: 'city', label: '城市' }, { key: 'refName', label: '绑定分拨' },
                        { key: 'radiusM', label: '半径(米)' },
                        { key: 'coverCount', label: '罩住城市数' },
                        { key: 'coverNames', label: '罩住城市', value: function (r) { return (r.coverNames || []).join('、'); } },
                        { key: 'nearMiss', label: '半径外最近城市' },
                        { key: 'branchCount', label: '同城网点' }, { key: 'staff', label: '同城员工' },
                        { key: 'devices', label: '同城终端' },
                        { key: 'hit', label: '窗口命中' }, { key: 'orderCount', label: '涉及订单' },
                        { key: 'lastAt', label: '最近命中' },
                        { key: 'status', label: '状态', value: function (r) { return GF_STATUS_TEXT[r.status] || r.status; } }
                    ]
                }, 'geofence');
            },
            'gf:exportGap': function () {
                exportGrid({
                    name: '围栏覆盖缺口.csv', rows: gfView(Math.max(7, Number(curCtx().days) || 7)).gaps, searchKey: 'q',
                    cols: [
                        { key: 'city', label: '城市' }, { key: 'count', label: '越界次数' },
                        { key: 'branches', label: '网点数' }, { key: 'hub', label: '归属分拨' },
                        { key: 'nearestName', label: '最近在用围栏' }, { key: 'nearestKm', label: '相距(km)' },
                        { key: 'radiusM', label: '建议半径(米)' }
                    ]
                }, 'geofence');
            }
        })
    });

    /* ---------- 二十九、人事管理 ---------- */

    /* 员工档案是「人」的唯一事实源：登录账号（users.personId）、排班（shifts）、打卡（clockRecords）、
       绩效（performances）、考核（evaluations）、固定司机（vehicles.driverId）全部反向挂在档案 id 上。
       人事页不另建花名册，只做「档案与下游对象」的一致性核对——缺口列出来就得能就地补掉，
       否则这张页和一张报表没有区别 */

    var EMP_STATUS_TEXT = { active: '在职', on_leave: '休假', resigned: '离职' };
    var EMP_ROLE_LIST = ['admin', 'branch', 'sorter', 'transporter', 'deliveryman'];
    /* 一线作业岗才有单量/件数可加权，职能岗的绩效只能拿出勤折算，不纳入批量核算 */
    var FRONT_ROLES = ['branch', 'sorter', 'transporter', 'deliveryman'];
    var TRIP_OPEN_STATUS = ['pending', 'loading', 'departed'];
    var INIT_PASSWORD = '123456';

    /* computeMetrics 返回的键随岗位而变，页面用同一套字典渲染，未登记的键按普通数值出 */
    var METRIC_TEXT = {
        signed: '签收票', assigned: '派下票', pending: '在途未收', onTimeRate: '签收及时率',
        podRate: 'POD 回单率', codCollected: '代收货款', exceptions: '名下异常', revenue: '签收收入',
        firstAttempt: '首派成功率', tasks: '任务量', pieces: '作业件数', weight: '作业重量',
        stdMinutes: '标准工时', actualMinutes: '实际工时', efficiency: '时均件', accuracy: '分拣准确率',
        trips: '执行车次', km: '干线里程', orders: '载运订单', loadRate: '平均装载率',
        fuelCost: '油费成本', accidents: '责任事故', overtime: '出差天数', branch: '归属网点',
        collected: '揽收票', cost: '签收成本', deduction: '名下扣款', margin: '网点毛利',
        attendanceDays: '出勤天数', overtimeHours: '加班时长', lateTimes: '迟到早退'
    };
    var METRIC_MONEY = { codCollected: 1, revenue: 1, fuelCost: 1, cost: 1, deduction: 1 };
    var METRIC_RATE = { onTimeRate: 1, podRate: 1, firstAttempt: 1, accuracy: 1, loadRate: 1, margin: 1 };
    var METRIC_UNIT = {
        signed: '票', assigned: '票', pending: '票', tasks: '项', pieces: '件', weight: 'kg',
        stdMinutes: '分钟', actualMinutes: '分钟', efficiency: '件/时', km: 'km', orders: '单',
        trips: '趟', exceptions: '起', accidents: '起', overtime: '天', attendanceDays: '天',
        overtimeHours: '小时', lateTimes: '次', collected: '票'
    };

    function empRoleOptions() {
        return EMP_ROLE_LIST.map(function (r) { return { value: r, label: TMS.people.roleName(r) }; });
    }

    function metricCell(key, v) {
        if (v == null || v === '') return '<span class="tms-dim">—</span>';
        if (key === 'branch') return esc(String(v));
        if (METRIC_MONEY[key]) return fmt.money(v);
        if (METRIC_RATE[key]) return fmt.percent(v);
        if (typeof v === 'number') {
            return fmt.number(util.round(v, 2)) +
                (METRIC_UNIT[key] ? ' <span class="tms-dim">' + esc(METRIC_UNIT[key]) + '</span>' : '');
        }
        return esc(String(v));
    }

    /* 工龄按月：30.6 天一月，够档案阅读用，不值得为此引一套日期库 */
    function empTenure(entryAt) {
        if (!entryAt) return 0;
        return util.round(Math.max(0, util.hoursBetween(entryAt, util.now()) / 734), 1);
    }

    function dayAt(day, hhmm) {
        var d = util.toDate(day + 'T' + hhmm + ':00');
        return isNaN(d) ? util.iso(util.now()) : util.iso(d);
    }

    /* 一次遍历把档案下游的所有对象索引好，台账、缺口、部门、导出共用同一份口径 */
    function hrIndex(days) {
        var period = util.monthKey(util.now());
        var cutoff = util.addDays(util.now(), -days).getTime();
        var today = util.dateKey(util.now());
        var out = {
            period: period, userBy: {}, clockBy: {}, perfBy: {}, evalBy: {},
            evalPending: 0, clockKeys: {}, missedShifts: [],
            openByCourier: {}, openByDriver: {}, platesByDriver: {}
        };
        db.col('users').forEach(function (u) {
            if (u.personId && !out.userBy[u.personId]) out.userBy[u.personId] = u;
        });
        db.col('clockRecords').forEach(function (c) {
            out.clockKeys[c.employeeId + '|' + c.date] = c;
            var b = out.clockBy[c.employeeId] || (out.clockBy[c.employeeId] = { win: 0, lastAt: '', open: 0, late: 0, hours: 0 });
            if (util.toDate(c.clockIn).getTime() >= cutoff) b.win++;
            if (!c.clockOut) b.open++;
            if (String(c.clockIn) > String(b.lastAt)) b.lastAt = c.clockIn;
            if (TMS.people.clockView(c).late) b.late++;
            b.hours = util.round(b.hours + (TMS.people.clockView(c).workHours || 0), 1);
        });
        db.col('performances').forEach(function (p) {
            var cur = out.perfBy[p.employeeId];
            if (!cur || String(p.period) > String(cur.period)) out.perfBy[p.employeeId] = p;
        });
        db.col('evaluations').forEach(function (x) {
            var cur = out.evalBy[x.employeeId];
            if (!cur || String(x.createdAt) > String(cur.createdAt)) out.evalBy[x.employeeId] = x;
            if (x.status === 'pending') out.evalPending++;
        });
        /* 有排班没打卡＝漏卡。打卡是事实、排班是计划，两者对不上就是考勤缺口，
           补卡后这条立刻从缺口里消失，绩效里的出勤天数同口径变化 */
        db.col('shifts').forEach(function (s) {
            if (String(s.date) > today || out.clockKeys[s.employeeId + '|' + s.date]) return;
            if (!db.get('employees', s.employeeId)) return;
            out.missedShifts.push(s);
        });
        out.missedShifts = util.sortBy(out.missedShifts, 'date', 'desc');
        db.col('orders').forEach(function (o) {
            if (o.courierId && !TMS.order.isTerminal(o)) out.openByCourier[o.courierId] = (out.openByCourier[o.courierId] || 0) + 1;
        });
        db.col('transports').forEach(function (t) {
            if (t.driverId && TRIP_OPEN_STATUS.indexOf(t.status) > -1) out.openByDriver[t.driverId] = (out.openByDriver[t.driverId] || 0) + 1;
        });
        db.col('vehicles').forEach(function (v) {
            if (!v.driverId) return;
            (out.platesByDriver[v.driverId] = out.platesByDriver[v.driverId] || []).push(v.plate);
        });
        return out;
    }

    function hrRows(days, idx) {
        idx = idx || hrIndex(days);
        var period = idx.period;
        return db.col('employees').map(function (e) {
            var c = idx.clockBy[e.id] || { win: 0, lastAt: '', open: 0, late: 0, hours: 0 };
            var u = idx.userBy[e.id];
            var p = idx.perfBy[e.id];
            var ev = idx.evalBy[e.id];
            var busy = idx.openByCourier[e.id] || 0;
            var trips = idx.openByDriver[e.id] || 0;
            return {
                id: e.id, name: e.name, role: e.role, roleName: TMS.people.roleName(e.role),
                position: e.position || '', deptId: e.deptId || '', deptName: e.deptName || '',
                orgId: e.orgId || '', orgName: e.orgName || '', city: e.city || '', phone: e.phone || '',
                badge: e.badge || '', entryAt: e.entryAt || '', tenure: empTenure(e.entryAt),
                status: e.status, salary: Number(e.salary) || 0, plateNo: e.plateNo || '',
                hubId: e.hubId || '', branchId: e.branchId || '',
                userId: u ? u.id : '', username: u ? u.username : '', userStatus: u ? (u.status || 'active') : '',
                noAccount: !u && e.status !== 'resigned',
                liveAccount: !!u && e.status === 'resigned' && (u.status || 'active') !== 'inactive',
                clockDays: c.win, clockLate: c.late, clockHours: c.hours, openClock: c.open, lastClockAt: c.lastAt,
                score: p ? Number(p.score) : 0, grade: p ? p.grade : '', perfPeriod: p ? p.period : '',
                hasPerf: !!(p && p.period === period),
                isFront: FRONT_ROLES.indexOf(e.role) > -1,
                evalTotal: ev ? Number(ev.totalScore) : 0, evalStatus: ev ? ev.status : '', evalPeriod: ev ? ev.period : '',
                busyOrders: busy, busyTrips: trips, plates: (idx.platesByDriver[e.id] || []).join('、'),
                leftOver: e.status !== 'active' && (busy > 0 || trips > 0)
            };
        });
    }

    function hrRowFilter(r, fs) {
        if (fs.role && r.role !== fs.role) return false;
        if (fs.deptId && r.deptId !== fs.deptId) return false;
        if (fs.status && r.status !== fs.status) return false;
        var c = fs.chip || '';
        if (c === 'noaccount' && !r.noAccount) return false;
        if (c === 'liveaccount' && !r.liveAccount) return false;
        if (c === 'noperf' && !(r.isFront && r.status === 'active' && !r.hasPerf)) return false;
        if (c === 'noclock' && !(r.isFront && r.clockDays === 0)) return false;
        if (c === 'leftover' && !r.leftOver) return false;
        return true;
    }

    /* 缺口按「补掉之后下游会怎么变」排序：账号决定能不能登录，绩效决定工资，漏卡决定出勤天数 */
    function hrGaps(rows, idx) {
        return {
            noAccount: rows.filter(function (r) { return r.noAccount && r.isFront; }),
            liveAccount: rows.filter(function (r) { return r.liveAccount; }),
            noPerf: rows.filter(function (r) { return r.isFront && r.status === 'active' && !r.hasPerf; }),
            noclock: rows.filter(function (r) { return r.isFront && r.clockDays === 0; }),
            missedShifts: idx.missedShifts,
            evalPending: idx.evalPending,
            leftOver: rows.filter(function (r) { return r.leftOver; })
        };
    }

    function hrDepts(rows) {
        var by = util.groupBy(rows, 'deptId');
        return db.col('departments').map(function (d) {
            var list = by[d.id] || [];
            var active = list.filter(function (r) { return r.status === 'active'; });
            return {
                id: d.id, name: d.name, manager: d.manager, parentId: d.parentId || '',
                total: list.length, active: active.length,
                front: list.filter(function (r) { return r.isFront; }).length,
                noAccount: list.filter(function (r) { return r.noAccount && r.isFront; }).length,
                salary: util.money(util.sum(active, 'salary'))
            };
        }).filter(function (x) { return x.total; }).sort(function (a, b) { return b.total - a.total; });
    }

    /* users.personId 指向员工 id、登录名统一取工号小写，口令走 util.hash 前缀 h:，
       与种子引擎建的账号完全同构——这样新开的账号在用户权限页和登录页都是真账号 */
    function hrCreateAccount(emp) {
        var dup = db.findOne('users', function (u) { return u.personId === emp.id || u.username === String(emp.id).toLowerCase(); });
        if (dup) return { created: false, row: dup };
        var saved;
        db.batch(function () {
            saved = db.create('users', {
                username: String(emp.id).toLowerCase(), name: emp.name, role: emp.role,
                passwordHash: 'h:' + util.hash(INIT_PASSWORD), orgId: emp.orgId, orgName: emp.orgName,
                personId: emp.id, phone: emp.phone, status: 'active',
                createdAt: emp.entryAt || util.dateKey(util.now())
            });
            db.commit('users', saved.id, 'user:create');
        }, 'user:create');
        TMS.audit.log('user.manage', 'users', saved.id, '为 ' + emp.name + '（' + emp.id + '）开通登录账号 ' + saved.username + '，初始口令 ' + INIT_PASSWORD, actor());
        return { created: true, row: saved };
    }

    /* 离职不只是档案上改一个字：登录必须同时关掉，否则工号还在、密码还在，门户还进得去。
       auth.verify 只认 status !== 'inactive' 的行，所以停用统一写 inactive */
    function hrSyncAccount(user, status, reason) {
        if (!user) return null;
        var want = status === 'resigned' ? 'inactive' : 'active';
        if ((user.status || 'active') === want) return null;
        var saved;
        db.batch(function () {
            saved = db.update('users', user.id, { status: want, disabledReason: want === 'inactive' ? reason || '离职停号' : null });
            db.commit('users', saved.id, 'user:status');
        }, 'user:status');
        TMS.audit.log('user.manage', 'users', user.id, user.username + ' 账号' + (want === 'inactive' ? '停用：' : '恢复：') + reason, actor());
        return saved;
    }

    /* 车牌是档案与车队之间唯一的连接：填了就把自己写成该车的固定驾驶员（一车一司机），
       调度派单默认沿用；清空车牌则解除绑定 */
    function hrBindVehicle(emp, plateNo) {
        var plate = String(plateNo || '').trim();
        var old = emp.plateNo ? db.findOne('vehicles', function (v) { return v.plate === emp.plateNo && v.driverId === emp.id; }) : null;
        if (old) db.update('vehicles', old.id, { driverId: null, driver: null, driverPhone: null });
        if (!plate) return old ? '解绑 ' + emp.plateNo : '';
        var v = db.findOne('vehicles', function (x) { return x.plate === plate; });
        if (!v) return '车牌「' + plate + '」不在车辆档案里，绑定未生效';
        db.update('vehicles', v.id, { driverId: emp.id, driver: emp.name, driverPhone: emp.phone });
        return '已将 ' + plate + ' 的固定驾驶员设为 ' + emp.name;
    }

    function empFormModal(id) {
        var e = id ? db.get('employees', id) : null;
        var deptOptions = ui.optionsOf(db.col('departments'), 'id', 'name');
        var hubOptions = ui.optionsOf(db.col('hubs'), 'id', 'name');
        var branchOptions = ui.optionsOf(db.col('branches'), 'id', 'name');
        ui.formModal({
            title: e ? '编辑员工档案 ' + e.name : '新增员工档案',
            sub: e ? '工号 ' + e.id + ' · 工牌 ' + (e.badge || '—') + ' · 入职 ' + (e.entryAt || '—') : '归属由「部门 / 分拨 / 网点」推导，不手填',
            notice: e ? '' : '勾选同步开通账号后，该员工即可用 ' + '工号小写' + ' / ' + INIT_PASSWORD + ' 登录对应门户。',
            values: e ? {
                name: e.name, role: e.role, deptId: e.deptId, position: e.position, phone: e.phone,
                city: e.city, entryAt: e.entryAt, status: e.status, salary: e.salary, plateNo: e.plateNo || '',
                hubId: e.hubId || '', branchId: e.branchId || '', account: false
            } : {
                name: '', role: 'sorter', deptId: 'DEP0003', position: '分拣员', phone: '', city: '',
                entryAt: util.dateKey(util.now()), status: 'active', salary: 6000, plateNo: '',
                hubId: '', branchId: '', account: true
            },
            fields: [
                { key: 'name', label: '姓名', required: true, placeholder: '例：林知远' },
                { key: 'role', label: '岗位', type: 'select', required: true, options: empRoleOptions(), hint: '决定绩效口径与可见菜单' },
                { key: 'deptId', label: '所属部门', type: 'select', required: true, options: deptOptions },
                { key: 'position', label: '职务', required: true, placeholder: '例：干线司机 / 派送组长' },
                { key: 'hubId', label: '归属分拨', type: 'select', options: [{ value: '', label: '不限' }].concat(hubOptions), hint: '分拣员、司机按分拨排班与派车' },
                { key: 'branchId', label: '归属网点', type: 'select', options: [{ value: '', label: '不限' }].concat(branchOptions), hint: '网点主管、派送员按网点分单' },
                { key: 'city', label: '常驻城市', type: 'city' },
                { key: 'phone', label: '手机号', required: true, placeholder: '11 位手机号', maxlength: 11 },
                { key: 'entryAt', label: '入职日期', type: 'date', required: true },
                { key: 'status', label: '在职状态', type: 'select', required: true, options: dictOptions(EMP_STATUS_TEXT) },
                { key: 'salary', label: '月薪酬', type: 'number', min: 0, max: 200000, step: 100, unit: '元' },
                { key: 'plateNo', label: '驾驶车牌', placeholder: '例：沪A12345', hint: '填了就把自己设为该车的固定驾驶员' },
                { key: 'account', label: '同步开通登录账号', type: 'checkbox' }
            ],
            okText: e ? '保存档案' : '建档',
            onSubmit: function (v) {
                if (!/^1[3-9]\d{9}$/.test(String(v.phone || ''))) return '手机号格式不对：需要 11 位且以 1 开头';
                var org = hrOrgOf(v.role, v.deptId, v.hubId, v.branchId);
                var patch = {
                    name: String(v.name || '').trim(), role: v.role, deptId: v.deptId,
                    deptName: (db.get('departments', v.deptId) || {}).name || '',
                    position: v.position, phone: v.phone, city: v.city, entryAt: v.entryAt,
                    status: v.status, salary: Number(v.salary) || 0, plateNo: String(v.plateNo || '').trim(),
                    orgId: org.orgId, orgName: org.orgName, hubId: org.hubId, branchId: org.branchId
                };
                if (e && e.status !== 'resigned' && v.status === 'resigned') {
                    return '离职请走台账里的「状态流转」：那里会同时停登录账号并清点名下在途单据';
                }
                var saved;
                db.batch(function () {
                    saved = e ? db.update('employees', e.id, patch) : db.create('employees', patch);
                    if (saved) db.commit('employees', saved.id, 'employee:save');
                }, 'employee:save');
                if (!saved) return '保存失败';
                var bindNote = hrBindVehicle(e || saved, v.plateNo);
                var accNote = '';
                if (!e || v.account) {
                    var res = hrCreateAccount(saved);
                    accNote = res.created ? '，账号 ' + res.row.username + ' 已开通' : '';
                }
                if (e) hrSyncAccount(hrUserOf(e.id), v.status, '档案状态改为' + EMP_STATUS_TEXT[v.status]);
                TMS.audit.log('hr.manage', 'employees', saved.id, (e ? '更新档案' : '新建档案') + ' ' + saved.name + '·' + saved.position +
                    (bindNote ? '；' + bindNote : '') + accNote, actor());
                ui.toast('已保存 ' + saved.name + ' 的档案' + bindNote + accNote, 'success');
                TMS.shell.refresh();
            }
        });
    }

    /* 归属推导：职能岗挂部门、一线岗挂分拨或网点，两者都填了以角色为准，
       避免出现 orgId 指向部门而 hubId 指向分拨的双头档案 */
    function hrOrgOf(role, deptId, hubId, branchId) {
        if (role === 'admin') {
            var d = db.get('departments', deptId);
            return { orgId: deptId, orgName: d ? d.name : '', hubId: '', branchId: '' };
        }
        if (role === 'branch' && branchId) {
            var b = db.get('branches', branchId);
            return { orgId: branchId, orgName: b ? b.name : '', hubId: '', branchId: branchId };
        }
        if (role === 'deliveryman' && branchId) {
            var bb = db.get('branches', branchId);
            return { orgId: branchId, orgName: bb ? bb.name : '', hubId: '', branchId: branchId };
        }
        if (hubId) {
            var h = db.get('hubs', hubId);
            return { orgId: hubId, orgName: h ? h.name : '', hubId: hubId, branchId: '' };
        }
        if (branchId) {
            var x = db.get('branches', branchId);
            return { orgId: branchId, orgName: x ? x.name : '', hubId: '', branchId: branchId };
        }
        return { orgId: deptId, orgName: (db.get('departments', deptId) || {}).name || '', hubId: '', branchId: '' };
    }

    function hrUserOf(empId) {
        return db.findOne('users', function (u) { return u.personId === empId; });
    }

    function hrShiftOf(empId, day) {
        return db.findOne('shifts', function (s) { return s.employeeId === empId && s.date === day; });
    }

    /* 补卡：写进与打卡机同构的 clockRecords 行，并把 device 标成 HR 补录，
       留下「这条不是本人打的」的痕迹，审计时能区分补录与漏卡 */
    function hrSaveClock(empId, day, inAt, outAt, device) {
        if (!inAt) return '上班时间必填：没有上班卡的记录在考勤口径里等于没出勤';
        var inDate = util.dateKey(util.toDate(inAt));
        if (inDate !== day) return '上班卡时间（' + inDate + '）与补录日期（' + day + '）不在同一天';
        if (outAt && util.toDate(outAt).getTime() <= util.toDate(inAt).getTime()) return '下班卡必须晚于上班卡';
        var rec = db.findOne('clockRecords', function (c) { return c.employeeId === empId && c.date === day; });
        var shift = hrShiftOf(empId, day);
        var saved;
        db.batch(function () {
            if (rec) {
                saved = db.update('clockRecords', rec.id, { clockIn: util.iso(util.toDate(inAt)), clockOut: outAt ? util.iso(util.toDate(outAt)) : null });
            } else {
                saved = db.create('clockRecords', {
                    employeeId: empId, date: day, clockIn: util.iso(util.toDate(inAt)),
                    clockOut: outAt ? util.iso(util.toDate(outAt)) : '',
                    shiftCode: shift ? shift.shiftCode : 'MID', device: device || 'HR 补录'
                }, { stamp: false });
            }
            db.commit('clockRecords', saved.id, 'clock:patch');
            if (shift) {
                var v = TMS.people.clockView(db.get('clockRecords', saved.id));
                db.update('shifts', shift.id, { attendance: v ? v.attendance : '已打卡' });
                db.commit('shifts', shift.id, 'clock:patch');
            }
        }, 'clock:patch');
        var view = TMS.people.clockView(saved);
        TMS.audit.log('hr.manage', 'employees', empId, '补录 ' + day + ' 考勤：' + fmt.time(saved.clockIn) +
            (saved.clockOut ? ' — ' + fmt.time(saved.clockOut) : ' 未打下班卡') + '（' + view.attendance + '）', actor());
        return null;
    }

    function empClockModal(id, presetDate) {
        var e = db.get('employees', id);
        if (!e) { ui.toast('未找到员工 ' + id, 'warn'); return; }
        var day = presetDate || util.dateKey(util.now());
        var rec = db.findOne('clockRecords', function (c) { return c.employeeId === e.id && c.date === day; });
        var shift = hrShiftOf(e.id, day);
        var def = TMS.people.shiftDef(shift ? shift.shiftCode : 'MID');
        var recent = util.sortBy(db.col('clockRecords').filter(function (c) { return c.employeeId === e.id; }), 'date', 'desc').slice(0, 6);
        ui.formModal({
            title: '考勤补录 · ' + e.name,
            sub: day + ' · ' + (shift ? '排班 ' + def.name + '（' + def.start + '—' + def.end + '）' : '该日无排班，按正常班默认工时'),
            notice: rec ? '该日已有打卡记录：上班 ' + fmt.time(rec.clockIn) + (rec.clockOut ? '、下班 ' + fmt.time(rec.clockOut) : '、下班未打') + '。补录会覆盖原时间并在审计日志留下痕迹。'
                : '该日排了班却没有打卡流水，绩效里的出勤天数按打卡记录计，漏卡会直接压低得分。',
            values: {
                date: day,
                clockInAt: rec ? rec.clockIn : dayAt(day, def.start),
                clockOutAt: rec && rec.clockOut ? rec.clockOut : (rec ? '' : dayAt(day, def.end)),
                device: rec && rec.device ? rec.device : 'HR 补录'
            },
            fields: [
                { key: 'date', label: '补录日期', type: 'date', required: true },
                { key: 'clockInAt', label: '上班卡时间', type: 'datetime', required: true },
                { key: 'clockOutAt', label: '下班卡时间', type: 'datetime', hint: '留空表示当日只打了上班卡' },
                { key: 'device', label: '补录来源', type: 'select', options: [{ value: 'HR 补录', label: 'HR 补录' }, { value: '工位考勤机', label: '工位考勤机' }, { value: '手机 APP', label: '手机 APP' }] }
            ],
            okText: '写入考勤',
            onSubmit: function (v) {
                var err = hrSaveClock(e.id, v.date, v.clockInAt, v.clockOutAt, v.device);
                if (err) return err;
                ui.toast('已补录 ' + e.name + ' ' + v.date + ' 的考勤，出勤口径与绩效同步更新', 'success');
                TMS.shell.refresh();
            },
            extra: recent.length ? '<div class="span-2">' + ui.card({
                title: '最近考勤', flat: true,
                body: ui.table({
                    dense: true, keyName: 'id', rows: recent.map(TMS.people.clockView),
                    columns: [
                        { key: 'date', label: '日期', sortable: false },
                        { key: 'shiftName', label: '班次', sortable: false },
                        { key: 'clockIn', label: '上班', sortable: false, render: function (r) { return fmt.time(r.clockIn); } },
                        { key: 'clockOut', label: '下班', sortable: false, render: function (r) { return r.clockOut ? fmt.time(r.clockOut) : '<span class="tms-dim">未打</span>'; } },
                        { key: 'workHours', label: '工时', sortable: false, align: 'right' },
                        { key: 'attendance', label: '判定', sortable: false, render: function (r) { return ui.badge(r.attendance, r.attendance === '正常' ? 'success' : r.attendance === '加班' ? 'info' : 'warn'); } }
                    ]
                })
            }) + '</div>' : ''
        });
    }

    function empShiftModal(id) {
        var e = db.get('employees', id);
        if (!e) { ui.toast('未找到员工 ' + id, 'warn'); return; }
        var day = util.dateKey(util.now());
        var existed = hrShiftOf(e.id, day);
        var history = util.sortBy(db.col('shifts').filter(function (s) { return s.employeeId === e.id; }), 'date', 'desc').slice(0, 6);
        ui.formModal({
            title: '排班 · ' + e.name,
            sub: e.position + ' · ' + (e.orgName || e.deptName || '未归属') + (existed ? ' · 今日已排 ' + TMS.people.shiftDef(existed.shiftCode).name : ''),
            notice: '排班是计划，打卡是事实：排了班没打卡会进「漏打卡」缺口，补卡后两边同时收口。',
            values: {
                date: day, shiftCode: existed ? existed.shiftCode : TMS.people.shiftDef('MID').code,
                hubId: e.hubId || '', remark: '', force: false
            },
            fields: [
                { key: 'date', label: '排班日期', type: 'date', required: true },
                { key: 'shiftCode', label: '班次', type: 'select', required: true, options: ui.optionsOf(TMS.people.SHIFT_DEFS, 'code', 'name') },
                { key: 'hubId', label: '作业分拨', type: 'select', options: [{ value: '', label: '按档案归属' }].concat(ui.optionsOf(db.col('hubs'), 'id', 'name')) },
                { key: 'remark', label: '备注', placeholder: '例：替班、旺季加开' },
                { key: 'force', label: '该日已有排班时覆盖', type: 'checkbox' }
            ],
            okText: '排班',
            onSubmit: function (v) {
                var def = TMS.people.shiftDef(v.shiftCode);
                var res = TMS.people.assignShift({
                    employeeId: e.id, date: v.date, shiftCode: v.shiftCode,
                    orgId: e.orgId, hubId: v.hubId || e.hubId, remark: v.remark, force: !!v.force
                });
                if (res && res.ok === false) return res.message + '（勾选覆盖可改排）';
                db.batch(function () {
                    db.commit('shifts', res.id, 'shift:assign');
                }, 'shift:assign');
                TMS.audit.log('hr.manage', 'employees', e.id, v.date + ' 排 ' + def.name + '（' + def.start + '—' + def.end + '）' + (v.remark ? '：' + v.remark : ''), actor());
                ui.toast('已为 ' + e.name + ' 排 ' + v.date + ' ' + def.name, 'success');
                TMS.shell.refresh();
            },
            extra: history.length ? '<div class="span-2">' + ui.list(history.map(function (s) {
                var sv = TMS.people.shiftView(s);
                var clock = db.findOne('clockRecords', function (c) { return c.employeeId === s.employeeId && c.date === s.date; });
                return {
                    title: sv.date + ' ' + sv.shiftName + ' ' + sv.startAt + '—' + sv.endAt,
                    sub: sv.hubId ? '分拨 ' + ((db.get('hubs', sv.hubId) || {}).name || sv.hubId) : '按档案归属',
                    right: ui.badge(clock ? '已打卡' : (sv.date > util.dateKey(util.now()) ? '计划' : '漏卡'), clock ? 'success' : sv.date > util.dateKey(util.now()) ? 'info' : 'warn')
                };
            })) + '</div>' : ''
        });
    }

    function empStatusModal(id) {
        var e = db.get('employees', id);
        if (!e) { ui.toast('未找到员工 ' + id, 'warn'); return; }
        var u = hrUserOf(e.id);
        var idx = hrIndex(7);
        var busy = idx.openByCourier[e.id] || 0;
        var trips = idx.openByDriver[e.id] || 0;
        ui.formModal({
            title: '状态流转 · ' + e.name,
            sub: '当前 ' + EMP_STATUS_TEXT[e.status] + ' · 工号 ' + e.id + (u ? ' · 账号 ' + u.username : ' · 未开账号'),
            notice: busy || trips ? '名下还有 ' + busy + ' 票未签收、' + trips + ' 趟未跑完，改状态前请先走订单页与调度页改派。'
                : '名下已无在途单据，可以安全流转。',
            values: { status: e.status, reason: '' },
            fields: [
                { key: 'status', label: '新状态', type: 'radio', options: dictOptions(EMP_STATUS_TEXT) },
                { key: 'reason', label: '流转事由', required: true, span: 2, placeholder: '例：转正 / 产假 / 主动离职' }
            ],
            okText: '流转',
            danger: e.status !== 'resigned',
            onSubmit: function (v) {
                if (v.status === e.status) return '状态没有变化';
                if (v.status === 'resigned' && (busy || trips)) return '名下仍有在途单据，先改派再离职：派送 ' + busy + ' 票 / 车次 ' + trips + ' 趟';
                var saved;
                db.batch(function () {
                    saved = db.update('employees', e.id, { status: v.status });
                    db.commit('employees', e.id, 'employee:status');
                }, 'employee:status');
                var acc = hrSyncAccount(u, v.status, v.reason);
                TMS.audit.log('hr.manage', 'employees', e.id, e.name + ' 状态 ' + EMP_STATUS_TEXT[e.status] + '→' + EMP_STATUS_TEXT[v.status] +
                    '：' + v.reason + (acc ? '（账号 ' + u.username + (v.status === 'resigned' ? ' 已停用' : ' 已恢复') + '）' : ''), actor());
                ui.toast('已流转为' + EMP_STATUS_TEXT[v.status] + (acc ? '，登录账号同步' + (v.status === 'resigned' ? '停用' : '恢复') : ''), 'success');
                TMS.shell.refresh();
            }
        });
    }

    function hrAccountModal(id) {
        var e = db.get('employees', id);
        if (!e) { ui.toast('未找到员工 ' + id, 'warn'); return; }
        var u = hrUserOf(e.id);
        if (!u) {
            ui.confirm({
                title: '为 ' + e.name + ' 开通登录账号',
                message: '登录名 ' + String(e.id).toLowerCase() + '，初始口令 ' + INIT_PASSWORD + '，角色随档案岗位（' + TMS.people.roleName(e.role) + '）。',
                detail: '开通后该员工可登录对应门户，看到的任务、打卡、绩效全部由 personId 反查到自己。',
                okText: '开通'
            }).then(function (yes) {
                if (!yes) return;
                var res = hrCreateAccount(e);
                ui.toast(res.created ? '账号 ' + res.row.username + ' 已开通，初始口令 ' + INIT_PASSWORD : '该员工已有账号 ' + res.row.username, res.created ? 'success' : 'info');
                TMS.shell.refresh();
            });
            return;
        }
        ui.modal({
            title: '登录账号 · ' + u.username,
            sub: e.name + ' · ' + TMS.people.roleName(u.role) + ' · ' + (u.orgName || '未归属'),
            body: ui.stack([
                ui.desc([
                    { label: '账号', value: '<span class="tms-mono">' + esc(u.id) + '</span> ' + esc(u.username) },
                    { label: '状态', value: statusBadge(u.status || 'active', { active: '可登录', inactive: '已停用', locked: '已锁定' }) },
                    { label: '绑定档案', value: ui.idCell(e.id, 'emp:open') + ' <span class="tms-dim">' + esc(e.position || '') + '</span>' },
                    { label: '登录门户', value: esc((cfg.roles[u.role] || {}).portal || '—') },
                    { label: '最近登录', value: u.lastLoginAt ? fmt.dateTime(u.lastLoginAt) : '<span class="tms-dim">从未登录</span>' },
                    { label: '开通时间', value: u.createdAt ? fmt.date(u.createdAt) : '<span class="tms-dim">—</span>' },
                    { label: '权限', value: TMS.rbac.permissionsFor(u.role).length + ' 个权限点（按角色授权，可在用户权限页调整）' }
                ]),
                ui.notice(e.status === 'resigned'
                    ? '该员工档案已是「离职」：账号应处于停用状态，否则工号密码仍然能登进门户。'
                    : '停用写 users.status=inactive，登录校验查不到启用行即拒绝；重置口令会把初始口令改回 ' + INIT_PASSWORD + '。',
                    e.status === 'resigned' && (u.status || 'active') !== 'inactive' ? 'danger' : 'info')
            ]),
            footer: ui.btn('重置为初始口令', { tone: 'primary', size: 'sm', act: 'emp:resetPwd', arg: u.id }) +
                ui.btn((u.status || 'active') === 'inactive' ? '恢复登录' : '停用账号', { size: 'sm', act: 'emp:toggleUser', arg: u.id }) +
                ui.btn('去用户权限页', { size: 'sm', tone: 'ghost', act: 'hr:goUser', arg: u.id }) +
                ui.btn('关闭', { act: 'ui:close' })
        });
    }

    function empModal(id) {
        var e = db.get('employees', id);
        if (!e) { ui.toast('未找到员工 ' + id, 'warn'); return; }
        var idx = hrIndex(Math.max(7, Number(curCtx().days) || 7));
        var u = idx.userBy[e.id];
        var p = idx.perfBy[e.id];
        var ev = idx.evalBy[e.id];
        var period = idx.period;
        var metrics = TMS.people.computeMetrics(e, period);
        var clockRows = util.sortBy(db.col('clockRecords').filter(function (c) { return c.employeeId === e.id; }), 'date', 'desc')
            .slice(0, 8).map(TMS.people.clockView);
        var c = idx.clockBy[e.id] || { win: 0, late: 0, hours: 0, open: 0, lastAt: '' };
        var kpi = ui.kpis([
            { label: '本期得分', value: p && p.period === period ? p.score : '—', unit: p && p.period === period ? p.grade : '', tone: p && p.period === period ? (p.grade === 'D' ? 'danger' : 'brand') : 'muted', sub: period },
            { label: '窗口出勤', value: c.win, unit: '天', tone: c.win ? 'info' : 'warn', sub: '累计 ' + c.hours + ' 工时' },
            { label: '迟到早退', value: c.late, unit: '次', tone: c.late ? 'warn' : 'success', sub: '按班次开始时间判' },
            { label: '工龄', value: empTenure(e.entryAt), unit: '月', tone: 'muted', sub: '入职 ' + fmt.date(e.entryAt) },
            { label: '月薪酬', value: fmt.money(e.salary || 0), tone: 'success', sub: EMP_STATUS_TEXT[e.status] },
            { label: '登录账号', value: u ? '已开通' : '未开通', tone: u ? 'brand' : 'danger', sub: u ? u.username : '在岗却进不了系统' }
        ]);
        ui.modal({
            size: 'wide',
            title: e.name + ' · ' + (e.position || TMS.people.roleName(e.role)),
            sub: e.id + ' · 工牌 ' + (e.badge || '—') + ' · ' + (e.deptName || '—') + (e.orgName ? ' / ' + e.orgName : '') + ' · ' + (e.phone || '无电话'),
            body: ui.stack([
                kpi,
                ui.split('2', [
                    ui.card({
                        title: '档案与下游', flat: true,
                        body: ui.desc([
                            { label: '在职状态', value: statusBadge(e.status, EMP_STATUS_TEXT) },
                            { label: '岗位', value: esc(TMS.people.roleName(e.role)) + ' <span class="tms-dim">' + esc(e.role) + '</span>' },
                            { label: '常驻城市', value: dim(e.city) },
                            { label: '驾驶车牌', value: e.plateNo ? esc(e.plateNo) + (idx.platesByDriver[e.id] ? ' ' + ui.badge('已绑固定驾驶员', 'success') : ' ' + ui.badge('车辆档案未回绑', 'warn')) : '<span class="tms-dim">未登记</span>' },
                            { label: '最近打卡', value: c.lastAt ? fmt.dateTime(c.lastAt) : '<span class="tms-dim">窗口内无打卡</span>' },
                            { label: '本期绩效', value: p && p.period === period ? (p.score + ' 分 ' + ui.badge(p.grade, p.grade === 'D' ? 'danger' : p.score >= 85 ? 'success' : 'info')) : '<span class="tms-badge tone-warn">待生成</span>' },
                            { label: '最近考核', value: ev ? (ev.totalScore + ' 分 · ' + esc(ev.period) + ' · ' + (ev.status === 'done' ? '已定级' : '待评定')) : '<span class="tms-dim">无</span>' },
                            { label: '名下在途', value: (idx.openByCourier[e.id] || 0) + ' 票待签收 / ' + (idx.openByDriver[e.id] || 0) + ' 趟未跑完' }
                        ])
                    }),
                    ui.card({
                        title: '本期作业指标', sub: '读取时由订单 / 任务 / 车次反推，不落库', flat: true,
                        body: ui.desc(Object.keys(metrics).map(function (k) {
                            return { label: METRIC_TEXT[k] || k, value: metricCell(k, metrics[k]) };
                        }))
                    })
                ]),
                ui.card({
                    title: '最近考勤', sub: clockRows.length ? '共 ' + (idx.clockBy[e.id] ? idx.clockBy[e.id].win : 0) + ' 天在窗口内' : '', flat: true,
                    body: clockRows.length ? ui.table({
                        dense: true, keyName: 'id', rows: clockRows,
                        columns: [
                            { key: 'date', label: '日期', sortable: false },
                            { key: 'shiftName', label: '班次', sortable: false },
                            { key: 'clockIn', label: '上班', sortable: false, render: function (r) { return fmt.time(r.clockIn); } },
                            { key: 'clockOut', label: '下班', sortable: false, render: function (r) { return r.clockOut ? fmt.time(r.clockOut) : '<span class="tms-dim">未打</span>'; } },
                            { key: 'workHours', label: '工时', sortable: false, align: 'right' },
                            { key: 'attendance', label: '判定', sortable: false, render: function (r) { return ui.badge(r.attendance, r.attendance === '正常' ? 'success' : r.attendance === '加班' ? 'info' : 'warn'); } },
                            { key: 'device', label: '终端', sortable: false },
                            { key: 'location', label: '地点', sortable: false }
                        ]
                    }) : ui.empty('还没有打卡流水', '一线作业岗可在上方「补卡」按日补录')
                })
            ]),
            footer: ui.btn('编辑档案', { tone: 'primary', act: 'emp:edit', arg: e.id }) +
                ui.btn('排班', { act: 'emp:shift', arg: e.id }) +
                ui.btn('补卡', { act: 'emp:clock', arg: e.id }) +
                ui.btn('核算本期绩效', { act: 'emp:perf', arg: e.id }) +
                ui.btn('状态流转', { act: 'emp:status', arg: e.id }) +
                ui.btn('账号', { act: 'emp:account', arg: e.id }) +
                ui.btn('关闭', { tone: 'ghost', act: 'ui:close' })
        });
    }

    function deptModal(deptId) {
        var d = db.get('departments', deptId);
        if (!d) { ui.toast('未找到部门 ' + deptId, 'warn'); return; }
        var rows = hrRows(7).filter(function (r) { return r.deptId === deptId; });
        var byStatus = util.countBy(rows, 'status');
        ui.modal({
            size: 'wide',
            title: d.name,
            sub: '部门负责人 ' + (d.manager || '—') + (d.parentId ? ' · 上级 ' + ((db.get('departments', d.parentId) || {}).name || d.parentId) : ' · 一级部门') + ' · 在册 ' + rows.length + ' 人',
            body: ui.stack([
                ui.desc([
                    { label: '在职结构', value: EMP_STATUS_TEXT.active + ' ' + (byStatus.active || 0) + ' · ' + EMP_STATUS_TEXT.on_leave + ' ' + (byStatus.on_leave || 0) + ' · ' + EMP_STATUS_TEXT.resigned + ' ' + (byStatus.resigned || 0) },
                    { label: '缺登录账号', value: rows.filter(function (r) { return r.noAccount && r.isFront; }).length + ' 人' },
                    { label: '离职未停号', value: rows.filter(function (r) { return r.liveAccount; }).length + ' 人' },
                    { label: '月度薪酬', value: fmt.money(util.sum(rows.filter(function (r) { return r.status === 'active'; }), 'salary')) }
                ]),
                ui.table({
                    dense: true, keyName: 'id', rows: rows.slice(0, 14), onRow: 'emp:open',
                    columns: [
                        { key: 'id', label: '工号', sortable: false, render: function (r) { return ui.idCell(r.id, 'emp:open'); } },
                        { key: 'name', label: '姓名', sortable: false },
                        { key: 'position', label: '职务', sortable: false },
                        { key: 'status', label: '状态', sortable: false, render: function (r) { return statusBadge(r.status, EMP_STATUS_TEXT); } },
                        { key: 'username', label: '账号', sortable: false, render: function (r) { return r.username ? '<span class="tms-mono">' + esc(r.username) + '</span>' : '<span class="tms-badge tone-danger">未开通</span>'; } },
                        { key: 'clockDays', label: '出勤', sortable: false, align: 'right' },
                        { key: 'grade', label: '绩效', sortable: false, render: function (r) { return r.hasPerf ? (r.score + ' ' + ui.badge(r.grade, r.grade === 'D' ? 'danger' : 'info')) : '<span class="tms-dim">待生成</span>'; } }
                    ]
                }),
                rows.length > 14 ? '<div class="tms-dim" style="font-size:12px">仅列前 14 人，全量请用台账筛选到本部门后导出</div>' : ''
            ]),
            footer: ui.btn('在台账中筛出本部门', { tone: 'primary', act: 'hr:deptFilter', arg: d.id }) +
                ui.btn('关闭', { act: 'ui:close' })
        });
    }

    /* 离职人员名下还有活：这是人事最容易漏的一环。
       单子挂在已停用的账号上，派送端永远刷不出任务，压单预警也只会归到网点头上 */
    function hrBusyModal() {
        var idx = hrIndex(7);
        var rows = hrRows(7, idx).filter(function (r) { return r.leftOver; });
        ui.modal({
            size: 'wide',
            title: '非在岗人员名下在途',
            sub: rows.length + ' 人 · 待签收 ' + util.sum(rows, 'busyOrders') + ' 票 · 未跑完 ' + util.sum(rows, 'busyTrips') + ' 趟',
            body: rows.length ? ui.table({
                dense: true, keyName: 'id', rows: rows, onRow: 'emp:open',
                columns: [
                    { key: 'id', label: '工号', sortable: false, render: function (r) { return ui.idCell(r.id, 'emp:open'); } },
                    { key: 'name', label: '姓名/岗位', sortable: false, render: function (r) { return esc(r.name) + ' <span class="tms-dim">' + esc(r.roleName) + ' · ' + esc(r.orgName || r.deptName) + '</span>'; } },
                    { key: 'status', label: '状态', sortable: false, render: function (r) { return statusBadge(r.status, EMP_STATUS_TEXT); } },
                    { key: 'busyOrders', label: '待签收', sortable: false, align: 'right', render: function (r) { return r.busyOrders ? ui.badge(r.busyOrders + ' 票', 'danger') : '—'; } },
                    { key: 'busyTrips', label: '未跑完车次', sortable: false, align: 'right', render: function (r) { return r.busyTrips ? ui.badge(r.busyTrips + ' 趟', 'warn') : '—'; } },
                    { key: 'username', label: '账号', sortable: false, render: function (r) { return r.userStatus === 'inactive' ? ui.badge('已停用', 'muted') : ui.badge('仍可登录', 'danger'); } },
                    { key: 'act', label: '处理', sortable: false, render: function (r) {
                        return (r.busyOrders ? ui.link('看订单', 'hr:goOrders', r.id, { tone: 'ghost' }) : '') +
                            (r.busyTrips ? ui.link('看车次', 'hr:goTrips', r.id, { tone: 'ghost' }) : '') +
                            ui.link('状态流转', 'emp:status', r.id, { tone: 'ghost' });
                    } }
                ]
            }) : ui.empty('没有非在岗人员背着在途单', '档案、账号、任务三者当前一致')
        });
    }

    var hrActions = {
        'emp:open': function (id) { empModal(id); },
        'emp:edit': function (id) { empFormModal(id); },
        'emp:new': function () { empFormModal(''); },
        'emp:shift': function (id) { empShiftModal(id); },
        'emp:clock': function (id) { empClockModal(id); },
        'emp:status': function (id) { empStatusModal(id); },
        'emp:account': function (id) { hrAccountModal(id); },
        'dept:open': function (id) { deptModal(id); },
        'hr:deptFilter': function (id) {
            var st = ui.state('hr');
            pg.filtersOf(st).deptId = id;
            st.page = 1;
            TMS.ui.closeTop();
            TMS.shell.refresh();
        },
        /* 绩效是「读时算、落结论」：得分与等级进 performances，指标每次读都从订单反推，
           所以重跑一次就是把当期快照刷新一次，不会产生第二行 */
        'emp:perf': function (id) {
            if (!id) return;
            var e = db.get('employees', id);
            if (!e) { ui.toast('未找到员工 ' + id, 'warn'); return; }
            var period = util.monthKey(util.now());
            var row = TMS.people.computePerformance(id, period);
            db.batch(function () { db.commit('performances', row.id, 'perf:calc'); }, 'perf:calc');
            TMS.audit.log('perf.calc', 'employees', id, e.name + ' ' + period + ' 绩效 ' + row.score + ' 分（' + row.grade + '）', actor());
            ui.toast(e.name + ' ' + period + ' 绩效：' + row.score + ' 分 · ' + row.grade, row.grade === 'D' ? 'warn' : 'success');
            TMS.shell.refresh();
        },
        'hr:bulkAccount': function () {
            var idx = hrIndex(7);
            var list = db.col('employees').filter(function (e) {
                return e.status === 'active' && FRONT_ROLES.indexOf(e.role) > -1 && !idx.userBy[e.id];
            });
            if (!list.length) { ui.toast('在岗一线人员已全部开通账号', 'info'); return; }
            ui.confirm({
                title: '批量开通登录账号',
                message: list.length + ' 名在岗一线人员还没有账号，将按工号小写开通、初始口令 ' + INIT_PASSWORD + '。',
                detail: '账号会绑定 personId，登录后只看到自己网点的单、自己的班次与绩效。',
                okText: '开通 ' + list.length + ' 个'
            }).then(function (yes) {
                if (!yes) return;
                var n = 0;
                db.batch(function () {
                    list.forEach(function (e) { if (hrCreateAccount(e).created) n++; });
                }, 'user:bulk');
                ui.toast('已开通 ' + n + ' 个账号，初始口令 ' + INIT_PASSWORD, 'success');
                TMS.shell.refresh();
            });
        },
        'hr:bulkDisable': function () {
            var rows = hrRows(7).filter(function (r) { return r.liveAccount; });
            if (!rows.length) { ui.toast('没有离职但还能登录的账号', 'info'); return; }
            var n = 0;
            db.batch(function () {
                rows.forEach(function (r) { if (hrSyncAccount(db.get('users', r.userId), 'resigned', '离职自动停号')) n++; });
            }, 'user:bulkDisable');
            ui.toast('已停用 ' + n + ' 个离职账号，这些用户名再登录会被拒绝', 'success');
            TMS.shell.refresh();
        },
        'hr:runPerf': function () {
            var period = util.monthKey(util.now());
            var rows = TMS.people.generatePerformances(period);
            TMS.audit.log('perf.calc', 'performances', '', period + ' 批量核算 ' + rows.length + ' 人一线绩效', actor());
            var d = rows.filter(function (x) { return x.grade === 'D'; });
            ui.toast(period + ' 绩效已核算 ' + rows.length + ' 人' + (d.length ? '，其中 ' + d.length + ' 人 D 档待绩效改进' : ''), d.length ? 'warn' : 'success');
            TMS.shell.refresh();
        },
        'hr:busy': function () { hrBusyModal(); },
        'hr:goUser': function (id) {
            TMS.ui.closeTop();
            TMS.shell.go('user', { q: id ? (db.get('users', id) || {}).username : '' });
        },
        'hr:goOrders': function (id) {
            var e = db.get('employees', id);
            if (!e) return;
            TMS.ui.closeTop();
            TMS.shell.go('order', { q: e.name });
        },
        'hr:goTrips': function (id) {
            var e = db.get('employees', id);
            if (!e) return;
            TMS.ui.closeTop();
            TMS.shell.go('transport', { q: e.name });
        },
        'hr:goEval': function () {
            TMS.ui.closeTop();
            TMS.shell.go('evaluation', { chip: 'pending' });
        },
        'hr:goVehicle': function () {
            TMS.ui.closeTop();
            TMS.shell.go('vehicle');
        },
        'emp:resetPwd': function (id) {
            var u = db.get('users', id);
            if (!u) return;
            ui.confirm({ title: '重置口令', message: u.username + ' 的口令将重置为 ' + INIT_PASSWORD + '。', okText: '重置', danger: true })
                .then(function (yes) {
                    if (!yes) return;
                    db.batch(function () {
                        db.update('users', u.id, { passwordHash: 'h:' + util.hash(INIT_PASSWORD) });
                        db.commit('users', u.id, 'user:resetPwd');
                    }, 'user:resetPwd');
                    TMS.audit.log('user.manage', 'users', u.id, '重置 ' + u.username + ' 登录口令', actor());
                    ui.toast('已重置为初始口令 ' + INIT_PASSWORD, 'success');
                });
        },
        'emp:toggleUser': function (id) {
            var u = db.get('users', id);
            if (!u) return;
            var off = (u.status || 'active') !== 'inactive';
            db.batch(function () {
                db.update('users', u.id, { status: off ? 'inactive' : 'active', disabledReason: off ? '手工停用' : null });
                db.commit('users', u.id, 'user:status');
            }, 'user:status');
            TMS.audit.log('user.manage', 'users', u.id, u.username + (off ? ' 停用' : ' 恢复'), actor());
            ui.toast(u.username + (off ? ' 已停用，登录会被拒绝' : ' 已恢复登录'), 'success');
            TMS.shell.refresh();
        }
    };

    pg.define('hr', {
        sub: '员工档案 · 登录账号 · 排班打卡 · 绩效考核的一致性核对与补齐',
        load: function (ctx) {
            applyParamFilter(ctx, ['role', 'deptId', 'q']);
            var idx = hrIndex(ctx.days);
            var rows = hrRows(ctx.days, idx);
            return { days: ctx.days, idx: idx, rows: rows, gaps: hrGaps(rows, idx), depts: hrDepts(rows) };
        },
        render: function (ctx, d) {
            var rows = d.rows, g = d.gaps, idx = d.idx;
            var byStatus = util.countBy(rows, 'status');
            var activeRows = rows.filter(function (r) { return r.status === 'active'; });
            var front = rows.filter(function (r) { return r.isFront; });
            var covered = front.filter(function (r) { return r.clockDays > 0; }).length;
            var kpi = ui.kpis([
                { label: '在册人力', value: fmt.number(rows.length), unit: '人', tone: 'brand', icon: '☗', sub: '在职 ' + (byStatus.active || 0) + ' · 休假 ' + (byStatus.on_leave || 0) + ' · 离职 ' + (byStatus.resigned || 0) },
                { label: '缺登录账号', value: g.noAccount.length, unit: '人', tone: g.noAccount.length ? 'danger' : 'success', sub: '在岗一线，进不了系统' },
                { label: '离职未停号', value: g.liveAccount.length, unit: '个', tone: g.liveAccount.length ? 'warn' : 'success', sub: '工号密码仍可用' },
                { label: idx.period + ' 绩效', value: rows.filter(function (r) { return r.hasPerf; }).length, unit: '人', tone: 'info', sub: '待补 ' + g.noPerf.length + ' 人' },
                { label: '漏打卡班次', value: g.missedShifts.length, unit: '条', tone: g.missedShifts.length ? 'warn' : 'success', sub: '有排班无流水' },
                { label: '月度薪酬', value: fmt.money(util.sum(activeRows, 'salary')), tone: 'success', sub: '在职 ' + activeRows.length + ' 人口径' }
            ]);
            var roleCard = ui.card({
                title: '岗位结构', flat: true,
                sub: '一线作业 ' + front.length + ' 人 · 占 ' + fmt.percent(util.pct(front.length, rows.length)) + ' · 窗口内出勤覆盖 ' + fmt.percent(util.pct(covered, front.length)),
                body: ch.hbars({
                    data: util.sortBy(EMP_ROLE_LIST.map(function (r) {
                        return { label: TMS.people.roleName(r), value: rows.filter(function (x) { return x.role === r; }).length };
                    }), 'value', 'desc'),
                    rowH: 26, labelWidth: 92, valueWidth: 56
                })
            });
            var deptCard = ui.card({
                title: '部门人力', sub: d.depts.length + ' 个部门有编制 · 点开看名册与缺口', flat: true,
                body: ui.table({
                    dense: true, keyName: 'id', rows: d.depts, onRow: 'dept:open', emptyText: '没有部门档案',
                    columns: [
                        { key: 'name', label: '部门', sortable: false, render: function (r) { return '<b>' + esc(r.name) + '</b><div class="tms-dim">' + esc(r.id) + ' · 负责人 ' + esc(r.manager || '—') + '</div>'; } },
                        { key: 'total', label: '在册', sortable: false, align: 'right' },
                        { key: 'active', label: '在职', sortable: false, align: 'right' },
                        { key: 'front', label: '一线', sortable: false, align: 'right' },
                        { key: 'noAccount', label: '缺账号', sortable: false, align: 'right', render: function (r) { return r.noAccount ? ui.badge(r.noAccount, 'danger') : '0'; } },
                        { key: 'salary', label: '月薪酬', sortable: false, align: 'right' }
                    ]
                })
            });
            var gapItems = [];
            if (g.noAccount.length) gapItems.push({
                title: g.noAccount.length + ' 名在岗一线没有登录账号',
                sub: '账号绑 personId 后，派送/分拣/司机门户才看得到自己的任务：例 ' + g.noAccount.slice(0, 3).map(function (r) { return esc(r.name); }).join('、'),
                right: ui.btn('批量开通', { size: 'sm', tone: 'primary', act: 'hr:bulkAccount' })
            });
            if (g.liveAccount.length) gapItems.push({
                title: g.liveAccount.length + ' 个离职账号仍可登录',
                sub: '例 ' + g.liveAccount.slice(0, 3).map(function (r) { return esc(r.username); }).join('、') + '，停用后登录立即被拒',
                right: ui.btn('批量停用', { size: 'sm', tone: 'danger', act: 'hr:bulkDisable' })
            });
            if (g.noPerf.length) gapItems.push({
                title: g.noPerf.length + ' 名一线人员本期未出绩效',
                sub: idx.period + '：得分从订单、车次、任务流水即时反推，跑一次即落一行快照',
                right: ui.btn('批量核算', { size: 'sm', act: 'hr:runPerf' })
            });
            if (g.missedShifts.length) gapItems.push({
                title: g.missedShifts.length + ' 个班次排了班却没有打卡流水',
                sub: '例 ' + g.missedShifts.slice(0, 3).map(function (s) { return esc((s.employee || '') + ' ' + s.date); }).join('、'),
                right: ui.btn('补第一条', { size: 'sm', act: 'emp:clock', arg: g.missedShifts[0].employeeId })
            });
            if (g.evalPending) gapItems.push({
                title: g.evalPending + ' 条考核待评定',
                sub: '考核定三级分（业绩 60% + 能力 25% + 态度 15%），定级后写入 D 档改进计划',
                right: ui.btn('去考核页', { size: 'sm', tone: 'ghost', act: 'hr:goEval' })
            });
            if (g.leftOver.length) gapItems.push({
                title: g.leftOver.length + ' 名非在岗人员背着在途单',
                sub: '单子挂在停用账号上，作业端永远刷不出来，需要改派后再流转状态',
                right: ui.btn('查看清单', { size: 'sm', tone: 'warn', act: 'hr:busy' })
            });
            var gapCard = ui.card({
                title: '待补的缺口', sub: gapItems.length ? gapItems.length + ' 项，均可就地闭环' : '档案与下游一致', flat: true,
                body: gapItems.length ? ui.list(gapItems) : ui.empty('没有缺口', '账号、绩效、考勤、在途单四项都对得上')
            });
            var listCard = grid(ctx, {
                title: '员工台账', sub: rows.length + ' 人 · 窗口近 ' + d.days + ' 天出勤',
                rows: rows, keyName: 'id', dense: true, onRow: 'emp:open', searchKey: 'q', pageSize: 20,
                filter: hrRowFilter,
                search: function (r) { return [r.id, r.name, r.badge, r.phone, r.position, r.deptName, r.orgName, r.city, r.username, r.plateNo].join(' '); },
                chips: [
                    { label: '全部', value: '', count: rows.length },
                    { label: '缺账号', value: 'noaccount', count: g.noAccount.length },
                    { label: '离职未停号', value: 'liveaccount', count: g.liveAccount.length },
                    { label: '本期无绩效', value: 'noperf', count: g.noPerf.length },
                    { label: '窗口无出勤', value: 'noclock', count: rows.filter(function (r) { return r.isFront && r.clockDays === 0; }).length },
                    { label: '非在岗有在途', value: 'leftover', count: g.leftOver.length }
                ], chipsName: 'chip',
                fields: [
                    { key: 'role', label: '岗位', options: [{ value: '', label: '全部岗位' }].concat(empRoleOptions()) },
                    { key: 'deptId', label: '部门', options: [{ value: '', label: '全部部门' }].concat(ui.optionsOf(db.col('departments'), 'id', 'name')) },
                    { key: 'status', label: '在职状态', options: [{ value: '', label: '全部' }].concat(dictOptions(EMP_STATUS_TEXT)) }
                ],
                tools: ui.btn('导出考勤', { size: 'sm', tone: 'ghost', act: 'hr:exportClock', icon: '↓' }) +
                    ui.btn('导出台账', { size: 'sm', tone: 'ghost', act: 'hr:export', icon: '↓' }),
                columns: [
                    { key: 'id', label: '工号', width: '96px', render: function (r) { return ui.idCell(r.id, 'emp:open'); } },
                    { key: 'name', label: '姓名 / 职务', width: '168px', render: function (r) { return '<b>' + esc(r.name) + '</b><div class="tms-dim">' + esc(r.roleName) + ' · ' + esc(r.position) + '</div>'; } },
                    { key: 'deptName', label: '部门 / 归属', sortable: false, render: function (r) { return esc(r.deptName || '—') + '<div class="tms-dim">' + esc(r.orgName || '未归属') + (r.city ? ' · ' + esc(r.city) : '') + '</div>'; } },
                    { key: 'status', label: '状态', width: '80px', sortable: false, render: function (r) { return statusBadge(r.status, EMP_STATUS_TEXT); } },
                    { key: 'username', label: '登录账号', width: '120px', render: function (r) {
                        if (!r.userId) return r.noAccount ? ui.link('未开通', 'emp:account', r.id, { tone: 'danger' }) : '<span class="tms-dim">—</span>';
                        return '<span class="tms-mono">' + esc(r.username) + '</span>' + (r.liveAccount ? ' ' + ui.badge('应停用', 'danger') : '');
                    } },
                    { key: 'clockDays', label: '窗口出勤', width: '104px', align: 'right', render: function (r) {
                        return r.clockDays ? (r.clockDays + ' 天' + (r.clockLate ? ' ' + ui.badge('迟 ' + r.clockLate, 'warn') : '')) : (r.isFront ? ui.badge('无', 'warn') : '<span class="tms-dim">职能岗</span>');
                    } },
                    { key: 'score', label: idx.period + ' 绩效', width: '108px', align: 'right', render: function (r) {
                        return r.hasPerf ? (r.score + ' ' + ui.badge(r.grade, r.grade === 'D' ? 'danger' : r.score >= 85 ? 'success' : 'info')) : '<span class="tms-dim">待生成</span>';
                    } },
                    { key: 'evalTotal', label: '最近考核', width: '96px', align: 'right', render: function (r) {
                        return r.evalTotal ? (r.evalTotal + ' <span class="tms-dim">' + esc(r.evalStatus === 'done' ? '已定级' : '待评定') + '</span>') : '<span class="tms-dim">—</span>';
                    } },
                    { key: 'ops', label: '操作', width: '152px', sortable: false, render: function (r) {
                        return ui.link('编辑', 'emp:edit', r.id, { tone: 'ghost' }) + ui.link('排班', 'emp:shift', r.id, { tone: 'ghost' }) + ui.link('补卡', 'emp:clock', r.id, { tone: 'ghost' });
                    } }
                ],
                emptyText: '没有符合条件的员工'
            });
            return wrap(ctx, {
                actions: ui.btn('新增员工', { tone: 'primary', act: 'emp:new', icon: '+' }) +
                    ui.btn('批量开账号', { act: 'hr:bulkAccount', icon: '⚿' }),
                sub: '在册 ' + rows.length + ' 人 · 在职 ' + (byStatus.active || 0) + ' · ' + idx.period + ' 已出绩效 ' + rows.filter(function (r) { return r.hasPerf; }).length + ' 人',
                body: [kpi, ui.split('2', [roleCard, gapCard]), deptCard, listCard, ui.card({
                    title: '口径说明', flat: true,
                    body: ui.desc([
                        { label: '账号怎么绑', value: 'users.personId 指向员工 id，登录名统一为工号小写（' + 'emp0001' + ' 这种），初始口令 ' + INIT_PASSWORD + '；档案与账号同名同人，用户权限页看到的列表和这里完全一致' },
                        { label: '离职为什么连带停号', value: 'auth.verify 只认 status 不为 inactive 的行，离职流转把账号写成 inactive，下一次登录直接被拒；反向恢复同样在状态流转里做' },
                        { label: '出勤看什么', value: 'clockRecords 一行一天，工时/加班/迟到都由上下班卡推算；考勤流水只为一线作业样本落库（全量 90 天会把 localStorage 吃掉一整块），职能岗以登录留痕代替' },
                        { label: '漏打卡怎么判', value: '某员工某天有排班行却没有同日打卡行。补录后这条立即从缺口消失，排班行的状态同步改判，出勤天数进入绩效' },
                        { label: '绩效为什么只算一线', value: '得分公式按派送、分拣、司机、网点四类口径写死，需要单量/件数/里程加权；职能岗没有可加权的作业流水，批量核算不覆盖，可在个人档案里单独算' },
                        { label: '车牌的作用', value: '填车牌即把车辆档案的固定驾驶员改成本人（一车一司机），调度派单默认沿用；清空车牌自动解绑。车辆页会校验固定司机是否仍在岗' },
                        { label: '在途单为什么要拦离职', value: '单子挂在停用账号上，派送端刷不出任务、签收率也会算到离职人头上。状态流转要求先改派，改派走订单页与调度页' }
                    ])
                })]
            });
        },
        actions: merge(hrActions, {
            'hr:export': function () {
                var idx = hrIndex(Math.max(7, Number(curCtx().days) || 7));
                exportGrid({
                    name: '员工台账.csv', rows: hrRows(Math.max(7, Number(curCtx().days) || 7), idx), searchKey: 'q', filter: hrRowFilter,
                    search: function (r) { return [r.id, r.name, r.badge, r.phone, r.position, r.deptName, r.orgName, r.city, r.username, r.plateNo].join(' '); },
                    cols: [
                        { key: 'id', label: '工号' }, { key: 'name', label: '姓名' }, { key: 'badge', label: '工牌' },
                        { key: 'roleName', label: '岗位' }, { key: 'position', label: '职务' },
                        { key: 'deptName', label: '部门' }, { key: 'orgName', label: '归属机构' }, { key: 'city', label: '常驻城市' },
                        { key: 'phone', label: '手机号' }, { key: 'entryAt', label: '入职日期' },
                        { key: 'tenure', label: '工龄(月)' },
                        { key: 'status', label: '在职状态', value: function (r) { return EMP_STATUS_TEXT[r.status] || r.status; } },
                        { key: 'salary', label: '月薪酬' },
                        { key: 'username', label: '登录账号' },
                        { key: 'userStatus', label: '账号状态', value: function (r) { return r.userStatus === 'inactive' ? '已停用' : (r.userId ? '正常' : '未开通'); } },
                        { key: 'clockDays', label: '窗口出勤天数' }, { key: 'clockLate', label: '迟到早退' },
                        { key: 'perfPeriod', label: '绩效期' }, { key: 'score', label: '绩效得分' }, { key: 'grade', label: '等级' },
                        { key: 'evalPeriod', label: '考核期' }, { key: 'evalTotal', label: '考核总分' },
                        { key: 'evalStatus', label: '考核状态', value: function (r) { return r.evalStatus === 'done' ? '已定级' : (r.evalStatus ? '待评定' : ''); } },
                        { key: 'plateNo', label: '驾驶车牌' },
                        { key: 'busyOrders', label: '名下待签收' }, { key: 'busyTrips', label: '名下未跑完车次' }
                    ]
                }, 'hr');
            },
            'hr:exportClock': function () {
                var cutoff = util.addDays(util.now(), -(Math.max(7, Number(curCtx().days) || 7))).getTime();
                exportGrid({
                    name: '考勤明细.csv', searchKey: 'q',
                    rows: db.col('clockRecords').filter(function (c) { return util.toDate(c.clockIn).getTime() >= cutoff; })
                        .map(TMS.people.clockView),
                    search: function (r) { return [r.employee, r.orgName, r.date, r.location].join(' '); },
                    cols: [
                        { key: 'employeeId', label: '工号' }, { key: 'employee', label: '姓名' },
                        { key: 'role', label: '岗位', value: function (r) { return TMS.people.roleName(r.role); } },
                        { key: 'orgName', label: '归属' }, { key: 'date', label: '日期' },
                        { key: 'shiftName', label: '班次' },
                        { key: 'clockIn', label: '上班卡', value: function (r) { return fmt.dateTime(r.clockIn); } },
                        { key: 'clockOut', label: '下班卡', value: function (r) { return r.clockOut ? fmt.dateTime(r.clockOut) : ''; } },
                        { key: 'workHours', label: '工时' }, { key: 'overtimeHours', label: '加班时长' },
                        { key: 'attendance', label: '出勤判定' }, { key: 'device', label: '终端' }, { key: 'location', label: '打卡地点' }
                    ]
                }, 'hr');
            }
        })
    });

    TMS.pages.admin = {
        wrap: wrap, grid: grid, toCsv: toCsv, download: download, exportGrid: exportGrid,
        curCtx: curCtx, rateBar: rateBar, actor: actor, applyParamFilter: applyParamFilter,
        merge: merge, colUnique: colUnique, custActions: custActions, excActions: excActions,
        describeJob: describeJob, claimSuggest: claimSuggest, claimRule: claimRule,
        excRows: excRows, excView: excView, ticketRows: ticketRows, claimRows: claimRows,
        exceptionModal: exceptionModal, ticketModal: ticketModal, claimModal: claimModal,
        claimNewModal: claimNewModal, excNewModal: excNewModal, ticketNewModal: ticketNewModal,
        customerModal: customerModal, customerFormModal: customerFormModal,
        deviceModal: deviceModal, dim: dim, orderFormFields: orderFormFields, quoteParams: quoteParams,
        EXC_TEXT: EXC_TEXT, TICKET_TEXT: TICKET_TEXT, CLAIM_TEXT: CLAIM_TEXT, slaCell: slaCell,
        levelBadge: levelBadge, statusBadge: statusBadge, pctBar: pctBar, dutyTargetOf: dutyTargetOf,
        defaultParty: defaultParty, wfGaps: wfGaps,
        whRows: whRows, whView: whView, whGaps: whGaps, stockCtx: stockCtx, mvOf: mvOf,
        goodsByHub: goodsByHub, goodsTable: goodsTable, postMovement: postMovement, syncMaterial: syncMaterial,
        stockRowOf: stockRowOf, whStockRows: whStockRows, purchaseEntry: purchaseEntry,
        whModal: whModal, whFormModal: whFormModal, whInOutModal: whInOutModal, whCountModal: whCountModal,
        whTransferModal: whTransferModal, purchaseModal: purchaseModal, purchaseListModal: purchaseListModal,
        receiveMovement: receiveMovement, WH_TEXT: WH_TEXT, WH_TYPES: WH_TYPES, MOV_TEXT: MOV_TEXT,
        matView: matView, matRowsOf: matRowsOf, matGaps: matGaps, MAT_TEXT: MAT_TEXT,
        materialModal: materialModal, materialFormModal: materialFormModal,
        materialCountModal: materialCountModal, stockActions: stockActions, gfActions: gfActions
    };
})(window);
