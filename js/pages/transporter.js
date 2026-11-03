/* 司机端（运输执行）：一条干线的一天是「装车 → 封舱 → 发车 → 在途上报 → 到达 → 回场交接」，
   每一步都会改写车次状态、订单环节与车辆档案，任何一步漏做，车就永远挂在「在途」、
   货永远不到目的地、车辆永远显示占用。所以这一端不提供「只看不做」的页面：
   每张车次卡上的按钮，都是把这条趟往闭环推进一格。 */
(function (global) {
    'use strict';

    var TMS = global.TMS = global.TMS || {};
    var util = TMS.util, ui = TMS.ui, db = TMS.db, pg = TMS.pages, po = TMS.portal;
    var esc = util.esc, fmt = util.fmt;
    var op = TMS.operation;
    var ROLE = 'transporter';

    /* ---------- 我这一份口径 ---------- */

    function sess() { return po.session(); }
    function emp() { return po.me() || {}; }
    function pid() { return sess().personId || emp().id || ''; }
    function name() { return po.actor(sess()); }
    function today() { return util.dateKey(util.now()); }
    function hub() { return emp().hubId || sess().hubId || ''; }

    /* 我的车次：只认 driverId 挂到我头上的自有整车趟次。
       外协零担买的是舱位，执行方是承运商，司机端不该看到别人的车 */
    function myRaw(days) {
        var p = pid();
        var cutoff = days ? util.dateKey(util.addDays(util.now(), -days)) : '';
        return db.col('transports').filter(function (t) {
            return t.driverId === p && (!cutoff || String(t.date) >= cutoff);
        }).map(op.tripView)
            .sort(function (a, b) { return String(b.date + (b.departAt || '')).localeCompare(String(a.date + (a.departAt || ''))); });
    }

    function myOpen() {
        return myRaw(30).filter(function (t) { return ['pending', 'loading', 'departed', 'arrived'].indexOf(t.status) > -1; });
    }

    function tripOf(id) {
        var tr = db.get('transports', id);
        return tr && tr.driverId === pid() ? op.tripView(tr) : null;
    }

    /* 装卸任务一条车次只有一条未完成；建班即生成，发车会自动补完，手动做则留人工口径 */
    function loadingOf(trId) {
        return db.findOne('loadingTasks', function (t) { return t.transportId === trId && t.status !== 'done'; });
    }

    function myLoadingTasks(days) {
        var ids = {};
        myRaw(days || 30).forEach(function (t) { ids[t.id] = true; });
        return db.col('loadingTasks').filter(function (t) { return ids[t.transportId]; })
            .map(op.loadingTaskView)
            .sort(function (a, b) { return String(b.finishedAt || '').localeCompare(String(a.finishedAt || '')); });
    }

    function ordersOn(trId) {
        return op.ordersOfTrip(trId).map(TMS.order.view);
    }

    /* 车上件的问题件：异常单没有司机字段，只能经车次→订单反查 */
    function myExceptions(days) {
        var mine = {}, cutoff = util.addDays(util.now(), -(days || 30)).getTime();
        myRaw(days || 60).forEach(function (t) {
            op.ordersOfTrip(t.id).forEach(function (o) { mine[o.id] = true; });
        });
        return db.col('exceptions').filter(function (e) {
            return (e.orderId && mine[e.orderId]) || e.reporter === name();
        }).filter(function (e) {
            return util.toDate(e.reportedAt).getTime() >= cutoff;
        }).sort(function (a, b) { return String(b.reportedAt).localeCompare(String(a.reportedAt)); });
    }

    /* 我的固定配车：车队档案的 driverId 是排班结果，司机端只读，改车找运营 */
    function myVehicles() {
        var p = pid();
        return db.col('vehicles').filter(function (v) { return v.driverId === p; });
    }

    function tripLine(t) {
        return pg.hubName(t.fromHub) + ' → ' + (t.toHub ? pg.hubName(t.toHub) : (t.toCity || '支线'));
    }

    /* 一趟的进度：装卸 → 发车 → 在途 → 到达 → 回场，缺哪步就只给哪步的按钮 */
    function tripStages(t) {
        var items = [
            { label: '装车交接', time: t.loadedAt ? fmt.time(t.loadedAt) : (loadingOf(t.id) ? '待装卸' : '已完成'), state: loadingOf(t.id) ? 'todo' : 'done' },
            { label: '发车', time: t.departedAt ? fmt.dateTime(t.departedAt) : '待发车', state: t.departedAt ? 'done' : (t.status === 'pending' ? 'current' : 'todo') },
            { label: '在途', time: t.lastReportAt ? fmt.dateTime(t.lastReportAt) : '', state: t.status === 'departed' ? 'current' : (t.departedAt ? 'done' : 'todo') },
            { label: '到达', time: t.actualArriveAt ? fmt.dateTime(t.actualArriveAt) : '待到达', state: t.actualArriveAt ? 'done' : (t.status === 'departed' ? 'current' : 'todo') },
            { label: '回场交接', time: t.completedAt ? fmt.dateTime(t.completedAt) : '待回场', state: t.status === 'completed' ? 'done' : 'todo' }
        ];
        return ui.steps(items);
    }

    function stageButtonsFor(t) {
        var out = '';
        var open = loadingOf(t.id);
        if (t.status === 'pending' || t.status === 'loading') {
            if (open) out += ui.btn('完成装车', { size: 'sm', tone: 'primary', act: 't:load', arg: t.id });
            out += ui.btn('确认发车', { size: 'sm', tone: 'primary', act: 't:depart', arg: t.id });
        } else if (t.status === 'departed') {
            out += ui.btn('位置上报', { size: 'sm', act: 't:pos', arg: t.id });
            out += ui.btn('到达扫描', { size: 'sm', tone: 'primary', act: 't:arrive', arg: t.id });
            out += ui.btn('异常上报', { size: 'sm', tone: 'danger', act: 't:ex', arg: t.id });
        } else if (t.status === 'arrived') {
            out += ui.btn('回场交接', { size: 'sm', tone: 'primary', act: 't:back', arg: t.id });
        }
        return out;
    }

    function tripCard(t) {
        var cost = op.costView(t);
        return ui.card({
            title: esc(t.code), sub: esc(tripLine(t)) + ' · 计划 ' + esc(t.date) + ' ' + esc(t.departAt || '') + ' · ' + esc(t.mode || '陆运'),
            tone: t.status === 'departed' ? 'brand' : t.status === 'pending' || t.status === 'loading' ? 'warn' : 'muted',
            tools: pg.statusBadge(t.status, pg.TRIP_TEXT),
            body: ui.stack([
                tripStages(t),
                ui.desc([
                    { label: '货量', value: fmt.number(t.orders) + ' 单 / ' + fmt.number(t.pieces) + ' 件 / ' + fmt.kg(t.weight) },
                    { label: '装载率', value: po.rateBar(Number(t.loadRate) || 0, 100) },
                    { label: '里程', value: fmt.km(op.distanceOf(t)) + ' · 在途 ' + fmt.duration(op.transitHoursOf(t)) },
                    { label: '成本', value: fmt.money(cost.total) + '（' + cost.basis + '，' + fmt.money(op.costPerKgOf(t)) + '/kg）' },
                    { label: '在途上报', value: t.lastReportAt ? esc(t.position || '已上报') + ' · ' + fmt.dateTime(t.lastReportAt) + '<br>累计 ' + fmt.km(t.reportedKm) + ' · 油耗 ' + (Number(t.fuelUsed) || 0) + ' L' : '<span class="tms-dim">尚未上报</span>' },
                    { label: '施封/备注', value: dimOr(t.sealNo) + (t.remark ? ' · ' + esc(t.remark) : '') }
                ], { inline: true }),
                '<div class="tms-row">' + stageButtonsFor(t) +
                ui.btn('车厢清单', { size: 'sm', act: 't:go', arg: 't-loading' }) +
                '</div>'
            ])
        });
    }

    function dimOr(v) { return v ? esc(v) : '<span class="tms-dim">—</span>'; }

    /* ---------- 动作 ---------- */

    /* 挂单：把本场已分拣、还没挂车的件拼到我还没发的车次上。
       车厢还有多少载重由 capacityOf 现算，装不下就拒绝，不做「先挂上去再说」 */
    function attachOrder(orderId) {
        var o = db.get('orders', orderId);
        if (!o) { ui.toast('运单不存在', 'error'); return; }
        if (o.tripId) { ui.toast('该单已挂 ' + op.labelOf(db.get('transports', o.tripId)), 'warn'); return; }
        if (o.status !== 'sorted') { ui.toast('需先由分拨分拣落格才能装车', 'warn'); return; }
        var pool = myOpen().filter(function (t) {
            return (t.status === 'pending' || t.status === 'loading') && t.fromHub === o.hubFrom;
        });
        if (!pool.length) {
            ui.toast('我在 ' + pg.hubName(o.hubFrom) + ' 没有待发车车次，请等运营配载或先建班', 'warn');
            return;
        }
        ui.formModal({
            title: '装车挂单 · ' + o.waybillNo,
            sub: '一单只能属于一个车次；挂载后重量、装载率、单公斤成本即时重算',
            fields: [
                {
                    key: 'transportId', label: '挂入车次', type: 'select', placeholder: false,
                    options: pool.map(function (t) {
                        return { value: t.id, label: t.code + '｜' + tripLine(t) + '｜余 ' + fmt.kg(Math.max(0, (t.capacityKg || 0) - (t.weight || 0))) };
                    })
                },
                { key: 'note', label: '装卸备注', placeholder: '如大件靠里、易碎朝上' }
            ],
            okText: '确认装车',
            onSubmit: function (v) {
                var tr = db.get('transports', v.transportId);
                if (!tr) return '车次不存在';
                var left = op.capacityOf(tr) - (Number(tr.weight) || 0);
                if (left < Number(o.chargeableWeight || 0)) {
                    return '车厢余量 ' + fmt.kg(left) + '，装不下 ' + fmt.kg(o.chargeableWeight) + '，请换车次或分批';
                }
                o.tripId = tr.id;
                db.touch('orders');
                op.recalcTrip(tr);
                if (v.note) { tr.remark = ((tr.remark || '') + ' ' + o.waybillNo + '：' + v.note).trim(); db.touch('transports'); }
                db.commit('transports', tr.id, 'trip:attach');
                ui.toast('已挂入 ' + op.labelOf(tr) + '，装载率 ' + fmt.percent(tr.loadRate), 'success');
            }
        });
    }

    var ACT = (function () {
        var out = {};
        [po.workActions, po.clockActions, po.exActions].forEach(function (src) {
            Object.keys(src).forEach(function (k) { out[k] = src[k]; });
        });
        var extra = {
            't:load': function (trId) {
                var t = tripOf(trId), task = loadingOf(trId);
                if (!t) { ui.toast('车次不存在或不属于我', 'error'); return; }
                if (!task) { ui.toast('该车次装卸任务已完成', 'warn'); return; }
                ui.formModal({
                    title: '装车交接 · ' + t.code,
                    sub: '件数核对与施封号是理赔与货损追溯的原始凭证，交接完成后发车即封舱',
                    fields: [
                        { key: 'pieces', label: '应装件数', type: 'static', value: t.pieces, render: function (v) { return fmt.number(v) + ' 件 / ' + fmt.kg(t.weight); } },
                        { key: 'actual', label: '实装件数', type: 'number', min: 0, value: t.pieces, required: true, tip: '与应装不符必须留痕，差异自动登记异常' },
                        { key: 'sealNo', label: '铅封号', value: t.sealNo || '', required: true, placeholder: '车厢铅封编号' },
                        { key: 'minutes', label: '实际用工', type: 'number', unit: '分钟', min: 1, value: op.loadingTaskView(task).stdMinutes },
                        { key: 'damage', label: '破损件数', type: 'number', min: 0, value: 0 },
                        { key: 'note', label: '交接说明', type: 'textarea', span: 2 }
                    ],
                    okText: '确认交接',
                    onSubmit: function (v) {
                        var act = Number(v.actual) || 0;
                        if (act !== Number(t.pieces)) {
                            TMS.service.createException({
                                orderId: (ordersOn(trId)[0] || {}).id, type: '货物破损', level: '三级',
                                description: '装车件数不符：应装 ' + t.pieces + ' 件，实装 ' + act + ' 件（车次 ' + t.code + '）',
                                actor: name(), responsible: name()
                            });
                        }
                        var res = op.finishLoading(task.id, {
                            operator: name(), actualMinutes: Number(v.minutes) || 0,
                            damageCount: Number(v.damage) || 0, photo: !!v.note
                        });
                        if (!res) return '交接失败：装卸任务不存在';
                        var tr = db.get('transports', trId);
                        db.update('transports', trId, { sealNo: v.sealNo, loadedAt: util.iso(util.now()), loadNote: v.note || '' });
                        db.touch('transports');
                        if (tr && tr.status === 'pending') { tr.status = 'loading'; db.touch('transports'); }
                        ui.toast('装车交接完成，铅封 ' + v.sealNo, 'success');
                    }
                });
            },
            't:attach': attachOrder,
            't:depart': function (trId) {
                var t = tripOf(trId);
                if (!t) { ui.toast('车次不存在或不属于我', 'error'); return; }
                var open = loadingOf(trId);
                ui.confirm({
                    title: '确认发车 · ' + t.code,
                    message: fmt.number(t.orders) + ' 单 / ' + fmt.kg(t.weight) + ' 将随车出发，车上每一件同步推进到「干线在途」。',
                    detail: open ? '还有未完成装卸，发车会自动按标准工时补完交接。' : '发车即封舱：外协舱位按实载重量生成采购账单，自有车次同步挂油费路桥与司机趟费。',
                    okText: '发车'
                }).then(function (yes) {
                    if (!yes) return;
                    po.run('发车', op.startTransport(trId, { operator: name(), device: po.device(sess()) }));
                });
            },
            't:arrive': function (trId) {
                var t = tripOf(trId);
                if (!t) { ui.toast('车次不存在或不属于我', 'error'); return; }
                po.run('到达扫描', op.arriveTransport(trId, { operator: name(), device: po.device(sess()) }));
            },
            't:back': function (trId) {
                var t = tripOf(trId);
                if (!t) { ui.toast('车次不存在或不属于我', 'error'); return; }
                po.run('回场交接', op.completeTransport(trId, { operator: name() }));
            },
            't:pos': function (trId) {
                var t = tripOf(trId);
                if (!t) { ui.toast('车次不存在或不属于我', 'error'); return; }
                var plan = op.distanceOf(t);
                ui.formModal({
                    title: '在途上报 · ' + t.code,
                    sub: '里程累加会写回车辆里程表，位置与时间进车次留痕，异常追溯按这份回放',
                    fields: [
                        { key: 'location', label: '当前位置', type: 'city', value: t.toCity || '', required: true, placeholder: '当前所在城市' },
                        { key: 'km', label: '本次里程', type: 'number', unit: 'km', min: 0, value: 40, tip: '计划全程 ' + fmt.km(plan) },
                        { key: 'fuel', label: '加油量', type: 'number', unit: 'L', min: 0, value: 0 },
                        { key: 'rest', label: '休息区停靠', type: 'checkbox', value: '' },
                        { key: 'note', label: '路况说明', type: 'textarea', span: 2, placeholder: '拥堵/天气/查验等' }
                    ],
                    okText: '上报',
                    onSubmit: function (v) {
                        var res = op.reportPosition(trId, {
                            location: v.location + (v.note ? '（' + v.note + '）' : ''),
                            km: Number(v.km), fuel: Number(v.fuel), restKm: v.rest ? 1 : '',
                            operator: name()
                        });
                        if (!res.ok) return '上报失败：' + res.message;
                        var acc = Number(res.transport.reportedKm) || 0;
                        if (plan && acc > plan * 1.1) ui.toast('已上报，但累计里程 ' + fmt.km(acc) + ' 超过计划 ' + fmt.km(plan) + '，请复核', 'warn');
                        else ui.toast('已上报：累计 ' + fmt.km(acc) + ' / 计划 ' + fmt.km(plan), 'success');
                    }
                });
            },
            't:ex': function (trId) {
                var t = tripOf(trId);
                if (!t) { ui.toast('车次不存在或不属于我', 'error'); return; }
                var rows = ordersOn(trId);
                ui.formModal({
                    title: '车次异常上报 · ' + t.code,
                    sub: '挂具体运单则该单转问题件并冻结后续环节；只报车次的作为路况留痕计入车次异常数',
                    fields: [
                        {
                            key: 'orderId', label: '涉及运单', type: 'select',
                            options: [{ value: '', label: '整趟（不指定单）' }].concat(rows.slice(0, 60).map(function (o) {
                                return { value: o.id, label: o.waybillNo + '｜' + o.goods + '｜' + o.destination };
                            }))
                        },
                        { key: 'type', label: '异常类型', type: 'select', placeholder: false, options: ui.optionsOf(TMS.service.EXCEPTION_TYPES) },
                        { key: 'level', label: '紧急等级', type: 'select', placeholder: false, options: ui.optionsOf(TMS.service.LEVELS), value: '三级' },
                        { key: 'description', label: '现场情况', type: 'textarea', required: true, span: 2, placeholder: '事故/恶劣天气/车辆故障/货物散落等，写明是否影响时效' }
                    ],
                    okText: '提交',
                    onSubmit: function (v) {
                        var res = op.reportTripException(trId, {
                            orderId: v.orderId, type: v.type, level: v.level,
                            description: v.description, operator: name()
                        });
                        if (!res.ok) return '上报失败：车次不存在';
                        ui.toast(v.orderId ? '已挂异常，该单转问题件等运营闭环' : '车次异常已留痕', 'success');
                    }
                });
            },
            't:open': function (id) { if (id) pg.openOrder(id); },
            't:go': function (page) { if (page) TMS.shell.go(page); }
        };
        Object.keys(extra).forEach(function (k) { out[k] = extra[k]; });
        return out;
    })();

    /* ---------- 工作台 ---------- */

    pg.define('t-home', {
        load: function () {
            var trips = myRaw(7);
            var open = trips.filter(function (t) { return ['pending', 'loading', 'departed', 'arrived'].indexOf(t.status) > -1; });
            var month = util.monthKey(util.now());
            var done = myRaw(120).filter(function (t) { return t.status === 'completed' && util.monthKey(t.date) === month; });
            return {
                emp: emp(), trips: trips, open: open,
                todayTrips: trips.filter(function (t) { return t.date === today(); }),
                running: trips.filter(function (t) { return t.status === 'departed'; }),
                vehicles: myVehicles(), exceptions: myExceptions(14),
                monthKm: util.round(util.sum(done, op.distanceOf), 0),
                monthCost: util.round(util.sum(done, op.costTotal), 0),
                rec: TMS.people.todayRecord(pid()),
                metrics: pid() ? TMS.people.computeMetrics(emp(), TMS.people.defaultPeriod()) : {}
            };
        },
        drawerFooter: function (id) { return po.footerFor(ROLE, id); },
        render: function (ctx, d) {
            var v = d.vehicles[0];
            var canIn = !d.rec || !d.rec.clockIn;
            var m = d.metrics || {};
            return po.wrap(ctx, {
                sub: esc(name()) + ' · ' + (v ? esc(v.plate) + '（' + esc(v.typeName || '') + '）' : '暂无固定配车') +
                    ' · ' + esc(pg.hubName(d.emp.hubId || '')),
                actions: ui.btn(canIn ? '上班打卡' : '已打卡', { tone: canIn ? 'primary' : 'default', act: 'clock:in', disabled: !canIn }) +
                    ui.btn('发车管理', { act: 't:go', arg: 't-departure' }),
                body: [
                    ui.kpis([
                        { label: '今日车次', value: d.todayTrips.length, unit: '趟', tone: 'brand', sub: '待装 ' + d.todayTrips.filter(function (t) { return ['pending', 'loading'].indexOf(t.status) > -1; }).length + ' 趟' },
                        { label: '在途', value: d.running.length, unit: '趟', tone: d.running.length ? 'warn' : 'muted', sub: '未到达' },
                        { label: '待回场', value: d.open.filter(function (t) { return t.status === 'arrived'; }).length, unit: '趟', tone: 'danger', sub: '回场才释放车辆' },
                        { label: '本月里程', value: d.monthKm, unit: 'km', tone: 'info', sub: '趟费成本 ' + fmt.money(d.monthCost) }
                    ]),
                    ui.card({
                        title: '今天这一趟', sub: '按顺序把车次推到回场，每推一步车上货物同步走环节', flat: true,
                        body: d.open.length ? ui.stack(d.open.slice(0, 3).map(tripCard))
                            : ui.empty('今天没有排到我的车次', '运营端「运力调度」建班派车后会立刻出现在这里')
                    }),
                    ui.split('side', [
                        ui.card({
                            title: '车厢在途件', sub: '我拉的单，扫到即推进', tools: ui.link('全部', 't:go', 't-departure'), flat: true,
                            body: po.taskCards(
                                d.running.reduce(function (a, t) { return a.concat(ordersOn(t.id).filter(function (o) { return o.status === 'transit'; })); }, []).slice(0, 5),
                                ROLE, { emptyText: '在途车次里没有待推进的件' })
                        }),
                        ui.card({
                            title: '本趟指标', sub: '账期即时重算，与绩效页同源', flat: true,
                            body: ui.desc([
                                { label: '执行车次', value: fmt.number(m.trips) + ' 次' },
                                { label: '干线里程', value: fmt.km(m.km) },
                                { label: '运输单量', value: fmt.number(m.orders) + ' 单 / ' + fmt.kg(m.weight) },
                                { label: '平均装载率', value: po.rateBar(Number(m.loadRate) || 0, 90) },
                                { label: '班次准点率', value: po.rateBar(Number(m.onTimeRate) || 0, 95) },
                                { label: '事故异常', value: (m.accidents ? ui.badge(fmt.number(m.accidents) + ' 件', 'danger') : ui.badge('无事故', 'success')) },
                                { label: '账期覆盖', value: (m.windowDays || 0) + ' 天 · 在岗 ' + (m.attendanceDays || 0) + ' 天' }
                            ])
                        })
                    ]),
                    ui.card({
                        title: '车辆与证件', sub: '里程表随在途上报累加，保养/保险临期由运营端维保跟进', flat: true,
                        body: d.vehicles.length ? ui.table({
                            dense: true, keyName: 'id', rows: d.vehicles, sortable: false,
                            columns: [
                                { key: 'plate', label: '车牌', render: function (r) { return '<b class="tms-mono">' + esc(r.plate) + '</b>'; } },
                                { key: 'typeName', label: '车型', render: function (r) { return esc(r.typeName || r.typeCode) + ' · ' + fmt.kg(r.loadKg); } },
                                { key: 'status', label: '状态', render: function (r) { return pg.statusBadge(r.status, pg.DOC_TEXT); } },
                                { key: 'odometer', label: '里程表', align: 'right', render: function (r) { return fmt.km(r.odometer); } },
                                { key: 'nextCheckAt', label: '下次保养', render: function (r) { return esc(r.nextCheckAt); } },
                                { key: 'insuredTo', label: '保险到期', render: function (r) { return esc(r.insuredTo); } },
                                { key: 'coldBox', label: '冷链', render: function (r) { return r.coldBox ? ui.badge('带冷藏机组', 'info') : '<span class="tms-dim">常温</span>'; } }
                            ]
                        }) : ui.empty('车队档案里没有把我配到车上', '运营端「车辆管理」设置固定驾驶员后本趟里程与趟费才归到我名下')
                    }),
                    ui.card({
                        title: '我拉过的件上的异常', sub: '近 14 天，跟催即升级到运营主管', tools: ui.link('排班', 't:go', 't-schedule'), flat: true,
                        body: ui.list(d.exceptions.slice(0, 6).map(function (e) {
                            return {
                                title: esc(e.type) + ' · ' + pg.statusBadge(e.status, pg.DOC_TEXT),
                                sub: esc(fmt.dateTime(e.reportedAt)) + '｜' + esc(e.description || ''),
                                act: e.orderId ? 't:open' : '', arg: e.orderId,
                                right: e.orderId ? ui.link('运单', 't:open', e.orderId) : ''
                            };
                        }), { empty: '近 14 天我执行的线路没有异常' })
                    })
                ]
            });
        },
        actions: ACT
    });

    /* ---------- 装车 ---------- */

    pg.define('t-loading', {
        load: function (ctx) {
            var seg = ctx.state.seg || 'open';
            var trips = myRaw(30);
            var wait = trips.filter(function (t) { return ['pending', 'loading'].indexOf(t.status) > -1; });
            var h = hub();
            return {
                seg: seg, wait: wait,
                arrived: trips.filter(function (t) { return t.status === 'departed'; }),
                tasks: myLoadingTasks(30),
                doneTasks: myLoadingTasks(30).filter(function (x) { return x.status === 'done'; }),
                openTasks: myLoadingTasks(30).filter(function (x) { return x.status !== 'done'; }),
                /* 能挂到我车上的件：本场已分拣、还没挂车次的 */
                loose: db.col('orders').filter(function (o) {
                    return o.status === 'sorted' && !o.tripId && (!h || o.hubFrom === h);
                }).map(TMS.order.view)
            };
        },
        drawerFooter: function (id) { return po.footerFor(ROLE, id); },
        render: function (ctx, d) {
            var std = util.sum(d.openTasks, 'stdMinutes'), used = util.sum(d.doneTasks, 'actualMinutes');
            return po.wrap(ctx, {
                sub: '装车不是搬货，是把件从「分拨待发」搬进「车次舱位」：件数、铅封、破损都会成为货损追溯的原始凭证',
                badge: ui.seg([{ value: 'open', label: '待装车 ' + d.wait.length }, { value: 'loose', label: '待挂单 ' + d.loose.length }, { value: 'log', label: '装卸台账' }], d.seg),
                body: [
                    ui.kpis([
                        { label: '待装车车次', value: d.wait.length, unit: '趟', tone: d.wait.length ? 'warn' : 'success', sub: fmt.number(util.sum(d.wait, 'orders')) + ' 单在舱' },
                        { label: '待挂运单', value: d.loose.length, unit: '单', tone: d.loose.length ? 'brand' : 'muted', sub: '本场已分拣未挂车' },
                        { label: '未完成装卸', value: d.openTasks.length, unit: '个', tone: d.openTasks.length ? 'danger' : 'success', sub: '标准工时 ' + fmt.number(std) + ' 分钟' },
                        { label: '近 30 天装卸', value: d.doneTasks.length, unit: '次', tone: 'info', sub: '实际用工 ' + fmt.number(used) + ' 分钟' }
                    ]),
                    d.seg === 'log' ? po.grid(ctx, {
                        rows: d.doneTasks, keyName: 'id', title: '装卸台账', sub: '车次装载交接留痕，工时与破损进绩效与理赔',
                        columns: [
                            { key: 'tripCode', label: '车次', render: function (r) { return esc(r.tripCode || '—'); } },
                            { key: 'containerNo', label: '舱位', render: function (r) { return '<span class="tms-mono">' + esc(r.containerNo) + '</span>'; } },
                            { key: 'pieces', label: '件/重', align: 'right', render: function (r) { return fmt.number(r.pieces) + ' 件 / ' + fmt.kg(r.weight); } },
                            { key: 'orders', label: '单数', align: 'right' },
                            { key: 'stdMinutes', label: '标准', align: 'right', render: function (r) { return fmt.number(r.stdMinutes) + ' 分'; } },
                            { key: 'actualMinutes', label: '实际', align: 'right', render: function (r) { return fmt.number(r.actualMinutes) + ' 分'; } },
                            { key: 'eff', label: '工时差', align: 'right', render: function (r) { return ui.delta(r.stdMinutes ? util.round((r.actualMinutes - r.stdMinutes) / r.stdMinutes * 100, 0) : 0, { unit: '%', invert: true }); } },
                            { key: 'damageCount', label: '破损', align: 'right', render: function (r) { return Number(r.damageCount) ? ui.badge(r.damageCount + ' 件', 'danger') : '<span class="tms-dim">无</span>'; } },
                            { key: 'finishedAt', label: '完成时间', render: function (r) { return ui.timeCell(r.finishedAt); } }
                        ],
                        search: function (r) { return [r.tripCode, r.containerNo, r.orderId].join(' '); },
                        pageSize: 8, emptyText: '近 30 天没有装卸台账'
                    }) : d.seg === 'loose' ? po.grid(ctx, {
                        rows: d.loose, keyName: 'id', title: '待挂运单', sub: '本场已分拣、还没挂车次的件；一单只能挂一个车次',
                        columns: [
                            { key: 'waybillNo', label: '运单', render: function (o) { return ui.idCell(o.id, 't:open', { short: true }) + ' <span class="tms-dim">' + esc(o.waybillNo) + '</span>'; } },
                            { key: 'customer', label: '客户', render: function (o) { return esc(o.customer || '散客'); } },
                            { key: 'line', label: '方向', render: function (o) { return '<span class="tms-nowrap">' + esc(o.origin) + '→' + esc(o.destination) + '</span>'; } },
                            { key: 'hubTo', label: '目的分拨', render: function (o) { return esc(pg.hubName(o.hubTo)); } },
                            { key: 'pieces', label: '件/重', align: 'right', render: function (o) { return fmt.number(o.pieces) + ' 件 / ' + fmt.kg(o.chargeableWeight); } },
                            { key: 'priority', label: '优先', render: function (o) { return o.priority === '高' ? ui.badge('加急', 'warn') : '<span class="tms-dim">普通</span>'; } },
                            { key: 'expectedAt', label: '承诺', render: function (o) { return '<span class="tms-nowrap">' + fmt.dateTime(o.expectedAt) + '</span>'; } },
                            {
                                key: 'act', label: '操作', sortable: false, render: function (o) {
                                    return ui.btn('装车挂单', { size: 'sm', tone: 'primary', act: 't:attach', arg: o.id });
                                }
                            }
                        ],
                        search: function (o) { return [o.id, o.waybillNo, o.customer, o.goods, o.destination].join(' '); },
                        pageSize: 10, emptyText: '本场没有待挂车的件', emptySub: '分拣落格后件会自动进入这里'
                    }) : ui.stack([
                        d.wait.length ? ui.stack(d.wait.map(tripCard)) : ui.empty('我没有待装车的车次', '可在「发车」页看已完成趟次，或让运营端「运力调度」配载建班'),
                        po.grid(ctx, {
                            rows: ordersOn((d.wait[0] || {}).id || ''), keyName: 'id',
                            title: d.wait.length ? ('车厢清单 · ' + esc(d.wait[0].code)) : '车厢清单',
                            sub: '装载明细由 orders.tripId 反查，与车次重量、装载率同一个口径',
                            columns: pg.orderColumns({ hide: ['profit', 'stuck', 'courier', 'scope'] }).concat([
                                { key: 'act', label: '操作', sortable: false, render: function (o) { return ui.btn('看单', { size: 'sm', act: 't:open', arg: o.id }); } }
                            ]),
                            search: function (o) { return [o.id, o.waybillNo, o.customer, o.goods].join(' '); },
                            onRow: 't:open', pageSize: 8, emptyText: '先选一个待装车次'
                        })
                    ])
                ]
            });
        },
        actions: ACT
    });

    /* ---------- 发车 ---------- */

    pg.define('t-departure', {
        load: function (ctx) {
            var seg = ctx.state.seg || 'open';
            var all = myRaw(seg === 'done' ? 90 : 30);
            var open = all.filter(function (t) { return ['pending', 'loading', 'departed', 'arrived'].indexOf(t.status) > -1; });
            var done = all.filter(function (t) { return ['completed', 'cancelled'].indexOf(t.status) > -1; });
            return {
                seg: seg, open: open, done: done,
                rows: (seg === 'done' ? done : open).map(function (t) {
                    t.canRun = t.status === 'departed';
                    t.planKm = op.distanceOf(t);
                    t.restStops = t.restStops || 0;
                    return t;
                }),
                running: open.filter(function (t) { return t.status === 'departed'; }),
                onTime: open.concat(done).length ? util.round(open.concat(done).filter(op.isOnTime).length / (open.concat(done).length) * 100, 1) : 0
            };
        },
        drawerFooter: function (id) { return po.footerFor(ROLE, id); },
        render: function (ctx, d) {
            return po.wrap(ctx, {
                sub: '发车、到达、回场各自落一个时间戳，准点率与趟费成本全部由这三个戳反推，页面不存二次结论',
                badge: ui.seg([{ value: 'open', label: '在跑 ' + d.open.length }, { value: 'done', label: '历史趟次' }], d.seg),
                body: [
                    ui.kpis([
                        { label: '待发车', value: d.open.filter(function (t) { return ['pending', 'loading'].indexOf(t.status) > -1; }).length, unit: '趟', tone: 'warn' },
                        { label: '在途', value: d.running.length, unit: '趟', tone: 'brand', sub: '未到达' },
                        { label: '待回场', value: d.open.filter(function (t) { return t.status === 'arrived'; }).length, unit: '趟', tone: 'danger', sub: '车辆仍占用中' },
                        { label: '准点率', value: fmt.percent(d.onTime), tone: d.onTime >= 95 ? 'success' : 'warn', sub: '近 30 天口径' }
                    ]),
                    d.seg === 'open' ? ui.stack(d.open.slice(0, 4).map(tripCard)) : '',
                    d.seg === 'open' ? po.grid(ctx, {
                        rows: d.running, keyName: 'id', title: '在途明细', sub: '位置/里程/油耗来自车载终端上报',
                        columns: [
                            { key: 'code', label: '车次', render: function (t) { return esc(t.code); } },
                            { key: 'position', label: '最后位置', render: function (t) { return dimOr(t.position); } },
                            { key: 'lastReportAt', label: '上报时间', render: function (t) { return t.lastReportAt ? ui.timeCell(t.lastReportAt) : '<span class="tone-warn">尚未上报</span>'; } },
                            { key: 'reportedKm', label: '已跑/计划', align: 'right', render: function (t) { return fmt.km(t.reportedKm) + ' / ' + fmt.km(op.distanceOf(t)); } },
                            {
                                key: 'prog', label: '进度', render: function (t) {
                                    return ui.progress(op.distanceOf(t) ? Math.min(100, (Number(t.reportedKm) || 0) / op.distanceOf(t) * 100) : 0, { thin: true, tone: 'brand' });
                                }
                            },
                            { key: 'fuelUsed', label: '油耗', align: 'right', render: function (t) { return (Number(t.fuelUsed) || 0) + ' L'; } },
                            { key: 'restStops', label: '停靠', align: 'right', render: function (t) { return fmt.number(t.restStops || 0) + ' 次'; } },
                            { key: 'exceptionCount', label: '异常', align: 'right', render: function (t) { return Number(t.exceptionCount) ? ui.badge(t.exceptionCount + ' 件', 'danger') : '<span class="tms-dim">无</span>'; } },
                            { key: 'act', label: '操作', sortable: false, render: function (t) { return stageButtonsFor(t); } }
                        ],
                        search: function (t) { return t.code + ' ' + (t.position || ''); },
                        pageSize: 6, emptyText: '没有在途车次', emptySub: '在「工作台」点确认发车后即进入在途'
                    }) : po.grid(ctx, {
                        rows: d.done, keyName: 'id', title: '历史趟次', sub: '近 90 天，发车到回场的时间戳决定准点判定',
                        columns: [
                            { key: 'code', label: '车次', render: function (t) { return esc(t.code); } },
                            { key: 'line', label: '线路', render: function (t) { return '<span class="tms-nowrap">' + esc(tripLine(t)) + '</span>'; } },
                            { key: 'status', label: '状态', render: function (t) { return pg.statusBadge(t.status, pg.TRIP_TEXT); } },
                            { key: 'orders', label: '单/件', align: 'right', render: function (t) { return fmt.number(t.orders) + ' / ' + fmt.number(t.pieces); } },
                            { key: 'weight', label: '载重', align: 'right', render: function (t) { return fmt.kg(t.weight); } },
                            { key: 'loadRate', label: '装载率', align: 'right', render: function (t) { return fmt.percent(t.loadRate); } },
                            { key: 'distanceKm', label: '里程', align: 'right', render: function (t) { return fmt.km(t.distanceKm); } },
                            { key: 'cost', label: '趟费', align: 'right', render: function (t) { return ui.moneyCell(op.costTotal(t)); } },
                            { key: 'onTime', label: '准点', render: function (t) { return t.onTime ? ui.badge('准点', 'success') : ui.badge('晚点', 'warn'); } },
                            { key: 'departedAt', label: '发车', render: function (t) { return ui.timeCell(t.departedAt); } },
                            { key: 'completedAt', label: '回场', render: function (t) { return ui.timeCell(t.completedAt); } }
                        ],
                        search: function (t) { return t.code + ' ' + tripLine(t) + ' ' + (t.plate || ''); },
                        valueOf: function (t, k) { return k === 'cost' ? op.costTotal(t) : (k === 'distanceKm' ? op.distanceOf(t) : t[k]); },
                        pageSize: 10, emptyText: '近 90 天没有已完成的趟次'
                    })
                ]
            });
        },
        actions: ACT
    });

    /* ---------- 线路 ---------- */

    pg.define('t-route', {
        load: function () {
            var mine = myRaw(120);
            var byLine = {};
            /* 跨度桶：司机看到的「这条线跨到哪一层」按趟次计，与按线路计是两个数——
               一条长线跑一趟和跑十趟对网络的压力不同，绩效台账认的是趟次 */
            var spans = { same: 0, prov: 0, cross: 0, unknown: 0 };
            mine.forEach(function (t) {
                var fromName = pg.hubName(t.fromHub);
                var toName = t.toHub ? pg.hubName(t.toHub) : (t.toCity || '支线');
                var key = fromName + ' → ' + toName;
                var span = TMS.network.segmentScope({ from: fromName, to: toName });
                spans[span.code] = (spans[span.code] || 0) + 1;
                var g = byLine[key] || (byLine[key] = { line: key, trips: 0, km: 0, weight: 0, orders: 0, load: [], onTime: 0, cost: 0, mode: t.mode, code: t.code, span: span.code, spanName: span.name });
                g.trips++;
                g.km += op.distanceOf(t);
                g.weight += Number(t.weight) || 0;
                g.orders += Number(t.orders) || 0;
                g.cost += op.costTotal(t);
                g.load.push(Number(t.loadRate) || 0);
                if (op.isOnTime(t)) g.onTime++;
            });
            var lines = Object.keys(byLine).map(function (k) {
                var g = byLine[k];
                g.avgLoad = g.load.length ? util.round(util.sum(g.load) / g.load.length, 1) : 0;
                g.onTimeRate = g.trips ? util.round(g.onTime / g.trips * 100, 1) : 0;
                g.costPerKg = g.weight ? util.round(g.cost / g.weight, 2) : 0;
                return g;
            }).sort(function (a, b) { return b.km - a.km; });
            /* 班次表：跑过的线路对应的在册班次，用来说明「这条线本该几点发、跑多久」 */
            var plans = {};
            mine.forEach(function (t) {
                if (!t.tripId) return;
                var p = db.get('trips', t.tripId);
                if (p && !plans[p.id]) plans[p.id] = p;
            });
            var deviants = [];
            mine.forEach(function (t) {
                op.ordersOfTrip(t.id).forEach(function (o) {
                    TMS.order.scansOf(o.id).forEach(function (s) {
                        if (s.isDeviant) deviants.push({ scan: s, order: TMS.order.view(o), trip: t });
                    });
                });
            });
            deviants.sort(function (a, b) { return String(b.scan.opTime).localeCompare(String(a.scan.opTime)); });
            return { lines: lines, spans: spans, mine: mine, planRows: Object.keys(plans).map(function (k) { return plans[k]; }).slice(0, 20), deviants: deviants.slice(0, 20), vehicles: myVehicles() };
        },
        drawerFooter: function (id) { return po.footerFor(ROLE, id); },
        render: function (ctx, d) {
            var totalKm = util.round(util.sum(d.lines, 'km'), 0);
            return po.wrap(ctx, {
                sub: '线路页只回答两件事：我常跑哪些线、这条线该几点发跑多久；偏离判定的依据是扫描流水的时刻与地点，不是我说了算',
                body: [
                    ui.kpis([
                        { label: '跑过的线路', value: d.lines.length, unit: '条', tone: 'brand', sub: '近 120 天口径' },
                        { label: '跨省趟次', value: d.spans.cross, unit: '趟', tone: d.spans.cross ? 'info' : 'muted', sub: '市内 ' + d.spans.same + ' 趟 / 省内跨市 ' + d.spans.prov + ' 趟' },
                        { label: '累计里程', value: totalKm, unit: 'km', tone: 'info', sub: fmt.number(d.mine.length) + ' 趟' },
                        { label: '单公里成本', value: util.round(totalKm ? util.sum(d.lines, 'cost') / totalKm : 0, 2), unit: '元/km', tone: 'muted' },
                        { label: '超时限扫描', value: d.deviants.length, unit: '条', tone: d.deviants.length ? 'danger' : 'success', sub: '需复盘环节耗时' }
                    ]),
                    ui.card({
                        title: '我的线路画像', sub: '按累计里程排序，装载率与准点率同时进绩效', flat: true,
                        body: d.lines.length ? ui.stack([
                            TMS.charts.hbars({
                                data: d.lines.slice(0, 8).map(function (l) {
                                    return { label: l.line, value: Math.round(l.km), sub: l.trips + ' 趟 · 准点 ' + l.onTimeRate + '%' };
                                }),
                                fmt: function (v) { return fmt.km(v); }, labelWidth: 150
                            }),
                            po.grid(ctx, {
                                rows: d.lines, keyName: 'line',
                                columns: [
                                    { key: 'line', label: '线路', render: function (l) { return '<b>' + esc(l.line) + '</b> <span class="tms-dim">' + esc(l.mode) + '</span>'; } },
                                    { key: 'spanName', label: '跨度', render: function (l) { return ui.badge(esc(l.spanName), TMS.network.SEG_SCOPE[l.span].tone); } },
                                    { key: 'trips', label: '我执行', align: 'right', render: function (l) { return fmt.number(l.trips) + ' 趟'; } },
                                    { key: 'km', label: '累计里程', align: 'right', render: function (l) { return fmt.km(l.km); } },
                                    { key: 'orders', label: '运单', align: 'right', render: function (l) { return fmt.number(l.orders) + ' 单'; } },
                                    { key: 'weight', label: '载重', align: 'right', render: function (l) { return fmt.kg(l.weight); } },
                                    { key: 'avgLoad', label: '平均装载率', render: function (l) { return po.rateBar(l.avgLoad, 90); } },
                                    { key: 'onTimeRate', label: '准点率', render: function (l) { return po.rateBar(l.onTimeRate, 95); } },
                                    { key: 'costPerKg', label: '元/kg', align: 'right', render: function (l) { return fmt.money(l.costPerKg); } }
                                ],
                                search: function (l) { return l.line + ' ' + l.mode + ' ' + l.spanName; },
                                valueOf: function (l, k) { return k === 'km' ? l.km : l[k]; },
                                pageSize: 8, dense: true, emptyText: '近 120 天没有执行记录'
                            })
                        ]) : ui.empty('还没有跑过车次')
                    }),
                    ui.card({
                        title: '在册班次对照', sub: '我的趟次挂在班次上，计划发车时刻与标准在途时长按此考核', flat: true,
                        body: d.planRows.length ? ui.table({
                            dense: true, keyName: 'id', rows: d.planRows, sortable: false,
                            columns: [
                                { key: 'code', label: '班次', render: function (p) { return esc(p.code); } },
                                { key: 'distanceKm', label: '公里', align: 'right', render: function (p) { return fmt.km(p.distanceKm); } },
                                { key: 'transitHours', label: '标准在途', align: 'right', render: function (p) { return fmt.duration(p.transitHours); } },
                                { key: 'departAt', label: '计划发车', render: function (p) { return esc(p.departAt) + ' → ' + esc(p.arriveAt); } },
                                { key: 'freq', label: '频次', render: function (p) { return esc(p.days); } },
                                { key: 'vehicleType', label: '目标车型', render: function (p) { return ui.badge(esc(p.vehicleType), 'muted'); } },
                                { key: 'onTimeRate', label: '线路准点', render: function (p) { return fmt.percent(util.round((Number(p.onTimeRate) || 0) * 100, 1)); } },
                                { key: 'status', label: '状态', render: function (p) { return pg.statusBadge(p.status, pg.DOC_TEXT); } }
                            ]
                        }) : ui.empty('我的车次没有关联在册班次', '运营端手工建班的趟次只做实绩，不参与班次准点考核')
                    }),
                    ui.split('side', [
                        ui.card({
                            title: '超时限扫描留痕', sub: '环节耗时超过标准即标记，需说明原因', flat: true,
                            body: ui.list(d.deviants.slice(0, 8).map(function (x) {
                                return {
                                    title: esc(TMS.order.deviceLabelOf(x.scan)) + ' · ' + esc(x.order.waybillNo || x.order.id),
                                    sub: esc(fmt.dateTime(x.scan.opTime)) + '｜' + esc(x.scan.location || pg.hubName(x.scan.node)) + (x.scan.remark ? '｜' + esc(x.scan.remark) : ''),
                                    act: 't:open', arg: x.order.id,
                                    right: ui.badge('超时限', 'warn')
                                };
                            }), { empty: '我的线上没有超时限扫描' })
                        }),
                        ui.card({
                            title: '配车与车辆状态', flat: true,
                            body: d.vehicles.length ? ui.desc(d.vehicles.map(function (v) {
                                return { label: v.plate, value: esc(v.typeName || v.typeCode) + '｜载重 ' + fmt.kg(v.loadKg) + '｜里程表 ' + fmt.km(v.odometer) + '｜' + pg.statusBadge(v.status, pg.DOC_TEXT) };
                            })) : ui.empty('暂无固定配车')
                        })
                    ])
                ]
            });
        },
        actions: ACT
    });

    /* ---------- 打卡 / 排班 / 绩效：与分拣、派送同构 ---------- */

    pg.define('t-schedule', po.scheduleDef());
    pg.define('t-clock', po.clockDef());
    pg.define('t-performance', po.perfDef());
})(window);
