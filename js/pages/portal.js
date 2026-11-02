/* 角色端共用件：一线五端重复的从来不是内容，而是「我的一天」这套骨架——
   今天干什么活、干完怎么留痕、留完能不能打卡看绩效。
   打卡 / 排班 / 绩效 / 异常上报 / 单据推进按钮在这里实现一次，
   各角色 bundle 只声明取数口径与页面编排；口径写第二遍迟早和运营端对不上 */
(function (global) {
    'use strict';

    var TMS = global.TMS = global.TMS || {};
    var util = TMS.util, ui = TMS.ui, db = TMS.db, cfg = TMS.cfg, pg = TMS.pages;
    var esc = util.esc, fmt = util.fmt;

    /* ---------- 骨架 ---------- */

    function wrap(ctx, o) {
        o = o || {};
        return ui.page({
            title: o.title || (pg.get(ctx.pageId) || {}).title || ctx.pageId,
            sub: o.sub, badge: o.badge, actions: o.actions,
            body: ui.stack(o.body || [])
        });
    }

    function grid(ctx, o) {
        o.state = o.state || ctx.state;
        return pg.grid(o);
    }

    function dim(v) { return (v == null || v === '') ? '<span class="tms-dim">—</span>' : esc(v); }

    function current() { return TMS.shell.current(); }

    function session() { var s = current(); return (s && s.session) || {}; }

    /* 一线页面的主角是「登录人」而不是组织。personId 缺失（手工建的账号、老库升级）
       时回落到同名在职档案，宁可空工作台也不能让司机看到别人的趟 */
    function me(ctx) {
        var s = (ctx && ctx.session) || session();
        if (s.personId) return db.get('employees', s.personId);
        return db.findOne('employees', function (e) { return e.role === s.role && e.name === s.name && e.status === 'active'; });
    }

    function actor(ctx) { var s = (ctx && ctx.session) || session(); return s.name || '作业员'; }

    /* 一线终端名进扫描流水，运营端才能区分「PDA 正常作业」与「后台手工补录」 */
    function device(ctx) {
        var s = (ctx && ctx.session) || session();
        return ({ sorter: '分拨PDA', transporter: '车载终端', deliveryman: '骑手PDA', branch: '网点PDA' })[s.role] || '移动终端';
    }

    /* 领域动作的返回值统一收口：{ok:false,message} 不Toast 就等于「点了没反应」 */
    function run(label, res) {
        if (!res) { ui.toast(label + '失败：单据不存在', 'error'); return false; }
        if (res.ok === false) { ui.toast(label + '失败：' + res.message, 'error'); return false; }
        ui.toast(label + '完成', 'success');
        return true;
    }

    function refresh() { TMS.shell.refresh(); }

    /* 达成条：越高越好的指标必须显式给 tone，ui.progress 默认色是给「越低越好」用的 */
    function rateBar(v, target) {
        var x = Number(v) || 0, good = target == null ? 92 : target;
        return ui.progress(x, { thin: true, tone: x >= good ? 'success' : (x >= good - 12 ? 'warn' : 'danger') }) +
            '<span class="tms-dim" style="font-size:11px"> ' + fmt.percent(x) + '</span>';
    }

    /* ---------- 单据推进（一线共用动作条） ---------- */

    /* 按「角色 + 当前状态」给出这一步该按的按钮。
       状态机本身在 TMS.order 里兜底（跳步/回退/问题件挂起都会报错），
       这里只负责少给按钮，不负责改规则——规则写两份迟早放行一条非法状态 */
    function stageButtons(order, role) {
        var s = order.status, out = [];
        function b(act, label, tone) { out.push(ui.btn(label, { size: 'sm', tone: tone, act: act, arg: order.id })); }
        if (role === 'branch') {
            if (s === 'created') b('work:collect', '揽收', 'primary');
            else if (s === 'collected') b('work:inbound', '入库称重', 'primary');
            else if (s === 'inbound') b('work:sort', '分拣交接', 'primary');
            else if (s === 'arrived') b('work:assign', '指派派送', 'primary');
            else if (s === 'delivering') b('work:recall', '改派', 'warn');
            else if (s === 'problem') b('work:release', '放行继续转运', 'primary');
        } else if (role === 'sorter') {
            if (s === 'inbound') b('work:sort', '分拣落格', 'primary');
        } else if (role === 'transporter') {
            if (s === 'inbound' || s === 'sorted') b('work:depart', '装车发运', 'primary');
            else if (s === 'transit') b('work:arrive', '到达扫描', 'primary');
        } else if (role === 'deliveryman') {
            if (s === 'arrived') b('work:assign', '领取派送', 'primary');
            else if (s === 'delivering') b('work:sign', 'POD 签收', 'primary');
        }
        if (s !== 'signed' && s !== 'cancelled' && s !== 'returned') {
            b('work:problem', '上报异常', s === 'problem' ? '' : 'danger');
        }
        return out.join('');
    }

    /* 抽屉底栏：同一张单在不同端能干什么，由打开它的那一页决定 */
    function footerFor(role, orderId) {
        var o = db.get('orders', orderId);
        if (!o) return '';
        return '<div class="tms-row">' + stageButtons(o, role) + '</div>';
    }

    function signModal(orderId) {
        var o = db.get('orders', orderId);
        if (!o) { ui.toast('订单不存在', 'error'); return; }
        var cod = Number(o.codAmount) > 0;
        ui.formModal({
            title: 'POD 签收 · ' + o.waybillNo,
            sub: '签收即结算：运费入账、代收货款进上划台账、消费积分同步计提',
            fields: [
                { key: 'receiver', label: '签收人', value: '本人签收', required: true },
                { key: 'receiverPhone', label: '签收电话', value: o.receiverPhone || '', placeholder: '选填，与收件人不一致时必填' },
                { key: 'photo', label: '回单照片', type: 'select', options: [{ value: '', label: '未上传' }, { value: '1', label: '已拍照上传' }], tip: '有照片才算完整 POD' },
                { key: 'note', label: '签收备注', type: 'textarea', placeholder: '如放置前台/门卫' }
            ],
            notice: cod ? ui.notice('本单含代收货款 ' + fmt.money(o.codAmount) + '，签收后自动生成待上划记录', 'warn') : '',
            okText: '确认签收',
            onSubmit: function (v) {
                var res = TMS.order.sign(orderId, {
                    receiver: v.receiver, receiverPhone: v.receiverPhone,
                    photo: !!v.photo, note: v.note, operator: actor(), device: device()
                });
                if (!run('签收', res)) return '签收未成功：' + (res && res.message || '');
            }
        });
    }

    function problemModal(orderId) {
        var o = orderId ? db.get('orders', orderId) : null;
        ui.formModal({
            title: o ? '异常上报 · ' + o.waybillNo : '异常上报',
            sub: '上报后订单挂起为问题件，需运营端闭环才放行',
            fields: [
                { key: 'orderId', label: '运单号', value: o ? o.id : '', required: !o, placeholder: o ? '' : '输入 HL 开头的订单号' },
                { key: 'type', label: '异常类型', type: 'select', options: ui.optionsOf(TMS.service.EXCEPTION_TYPES), required: true },
                { key: 'level', label: '紧急等级', type: 'select', options: ui.optionsOf(TMS.service.LEVELS), value: '三级',
                    tip: '一级 2 小时、二级 6 小时、三级按 SLA 自动升级' },
                { key: 'description', label: '情况描述', type: 'textarea', required: true, span: 2 }
            ],
            okText: '提交工单',
            onSubmit: function (v) {
                var id = o ? o.id : String(v.orderId || '').trim();
                if (!id) return '请填写运单号';
                var res = TMS.order.markProblem(id, {
                    type: v.type, level: v.level, description: v.description,
                    operator: actor(), actor: actor()
                });
                if (!run('异常上报', res)) return '上报失败：' + (res && res.message || '运单不存在');
            }
        });
    }

    function assignModal(orderId) {
        var o = db.get('orders', orderId);
        if (!o) { ui.toast('订单不存在', 'error'); return; }
        var s = session();
        var pool = db.col('employees').filter(function (e) {
            return e.role === 'deliveryman' && e.status === 'active' && (!o.destination || e.city === o.destination);
        });
        if (!pool.length) pool = db.col('employees').filter(function (e) { return e.role === 'deliveryman' && e.status === 'active'; });
        var self = s.role === 'deliveryman' && s.personId;
        ui.formModal({
            title: (s.role === 'deliveryman' ? '领取派送 · ' : '指派派送 · ') + o.waybillNo,
            sub: '到达件指派后进入派送中，承诺时效按签收考核追溯',
            fields: [
                {
                    key: 'courierId', label: '派送员', type: 'select', placeholder: false,
                    options: pool.map(function (e) { return { value: e.id, label: e.name + '（' + (e.city || '') + '）' }; }),
                    value: self ? s.personId : (o.courierId || (pool[0] || {}).id)
                },
                { key: 'deliveryEta', label: '预约上门时间', type: 'datetime', value: util.iso(util.addHours(util.now(), 6)).slice(0, 16) },
                { key: 'note', label: '调度备注', type: 'textarea', placeholder: '如客户要求晚间派送' }
            ],
            okText: '确认派送',
            onSubmit: function (v) {
                var res = TMS.order.assignDelivery(orderId, {
                    courierId: v.courierId, deliveryEta: v.deliveryEta, note: v.note, operator: actor()
                });
                if (!run('派送指派', res)) return '指派失败：' + (res && res.message || '');
            }
        });
    }

    /* 一线动作全部挂在 shell.actions：抽屉跨页面存活，页面动作表每次渲染都会重建 */
    var workActions = {
        'work:collect': function (id) { run('揽收', TMS.order.collect(id, { operator: actor(), device: device() })); },
        'work:weigh': function (id) {
            var o = db.get('orders', id);
            if (!o) return;
            ui.formModal({
                title: '揽收复磅 · ' + o.waybillNo,
                sub: '实际重量与申报不符时按复磅重重新计价，差额记入应收调整',
                fields: [
                    { key: 'actualWeight', label: '实际重量', type: 'number', unit: 'kg', required: true, value: o.weight },
                    { key: 'dims', label: '外包装尺寸', value: o.dims || '', placeholder: '长x宽x高（cm），多件用 / 分隔' },
                    { key: 'note', label: '备注', type: 'textarea' }
                ],
                onSubmit: function (v) {
                    var res = TMS.order.collect(id, {
                        operator: actor(), device: device(), actualWeight: v.actualWeight,
                        dims: v.dims, note: '复磅：' + (v.note || '')
                    });
                    if (!run('复磅揽收', res)) return '复磅失败：' + (res && res.message || '');
                }
            });
        },
        'work:inbound': function (id) { run('入库', TMS.order.inbound(id, { operator: actor(), device: device() })); },
        'work:sort': function (id) {
            var o = db.get('orders', id);
            if (!o) return;
            var chute = 'C' + util.pad(1 + util.hash(o.destination || '') % 40, 2);
            run('分拣', TMS.order.sort(id, { operator: actor(), device: device(), chute: chute }));
        },
        'work:depart': function (id) {
            var o = db.get('orders', id);
            if (!o) return;
            if (!o.tripId) { ui.toast('该单尚未挂车次，请先到「发车」页建班', 'warn'); return; }
            var tr = db.get('transports', o.tripId);
            if (tr && ['pending', 'loading'].indexOf(tr.status) > -1) {
                run('发车', TMS.operation.startTransport(tr.id, { operator: actor(), device: device() }));
                return;
            }
            run('干线扫描', TMS.order.depart(id, { operator: actor(), device: device() }));
        },
        'work:arrive': function (id) {
            var o = db.get('orders', id);
            if (!o) return;
            var tr = o.tripId ? db.get('transports', o.tripId) : null;
            if (tr && tr.status === 'departed') {
                run('到达', TMS.operation.arriveTransport(tr.id, { operator: actor(), device: device() }));
                return;
            }
            run('到件扫描', TMS.order.arrive(id, { operator: actor(), device: device() }));
        },
        'work:assign': function (id) { assignModal(id); },
        'work:recall': function (id) { assignModal(id); },
        'work:sign': function (id) { signModal(id); },
        'work:problem': function (id) { problemModal(id); },
        'work:release': function (id) {
            run('问题件放行', TMS.order.releaseProblem(id, { operator: actor(), note: '网点确认继续转运' }));
        },
        'work:open': function (id) { pg.openOrder(id); }
    };

    /* ---------- 打卡页（分拣 / 司机 / 派送共用） ---------- */

    function clockRows(empId, days) {
        var cutoff = util.addDays(util.now(), -(days || 30)).getTime();
        return db.col('clockRecords')
            .filter(function (c) { return c.employeeId === empId && util.toDate(c.clockIn).getTime() >= cutoff; })
            .map(TMS.people.clockView)
            .sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    }

    var clockActions = {
        'clock:in': function () {
            var emp = me();
            if (!emp) { ui.toast('账号未绑定员工档案', 'error'); return; }
            run('上班打卡', TMS.people.clockIn({ employeeId: emp.id, location: emp.orgName || emp.city, device: '手机 APP' }));
        },
        'clock:out': function () {
            var emp = me();
            if (!emp) { ui.toast('账号未绑定员工档案', 'error'); return; }
            run('下班打卡', TMS.people.clockOut({ employeeId: emp.id }));
        },
        'shift:take': function (date) {
            var emp = me();
            if (!emp) { ui.toast('账号未绑定员工档案', 'error'); return; }
            ui.formModal({
                title: '调整班次', sub: '改的是排班本身：打卡迟到判定、绩效在岗口径都跟着走',
                fields: [
                    { key: 'date', label: '日期', type: 'date', value: date || util.dateKey(util.now()), required: true },
                    { key: 'shiftCode', label: '班次', type: 'select', placeholder: false, options: TMS.people.SHIFT_DEFS.map(function (s) { return { value: s.code, label: s.name + ' ' + s.startAt + '–' + s.endAt }; }) },
                    { key: 'remark', label: '原因', type: 'textarea', span: 2 }
                ],
                okText: '保存',
                onSubmit: function (v) {
                    var res = TMS.people.assignShift({
                        employeeId: emp.id, date: v.date, shiftCode: v.shiftCode,
                        orgId: emp.orgId, hubId: emp.hubId, remark: v.remark, force: true
                    });
                    if (!res) return '排班保存失败';
                    ui.toast('班次已调整', 'success');
                }
            });
        }
    };

    function clockDef() {
        return {
            load: function (ctx) {
                var emp = me(ctx) || {};
                var rec = emp.id ? TMS.people.todayRecord(emp.id) : null;
                return {
                    emp: emp, rec: rec, view: TMS.people.clockView(rec),
                    shift: emp.id ? db.findOne('shifts', function (x) {
                        return x.employeeId === emp.id && x.date === util.dateKey(util.now());
                    }) : null,
                    history: emp.id ? clockRows(emp.id, 30) : []
                };
            },
            render: function (ctx, d) {
                var emp = d.emp;
                if (!emp.id) return wrap(ctx, { body: [ui.card({ body: ui.empty('当前账号未绑定员工档案', '请在「用户权限」页为该账号挂接在职员工') })] });
                var hist = d.history;
                var days = hist.length;
                var late = hist.filter(function (c) { return c.late; }).length;
                var ot = util.round(util.sum(hist, 'overtimeHours'), 1);
                var sh = d.shift ? TMS.people.shiftView(d.shift) : null;
                var canIn = !d.rec || !d.rec.clockIn;
                var canOut = !!d.rec && !!d.rec.clockIn && !d.rec.clockOut;
                var rec = d.view;
                return wrap(ctx, {
                    sub: '出勤统计取近 30 天流水，班次与迟到判定按排班时刻表即时推算',
                    body: [
                        ui.card({
                            title: '打卡', sub: sh ? (sh.shiftName + ' ' + sh.startAt + '–' + sh.endAt) : '今日未排班，按岗位默认班次判定',
                            flat: false,
                            body: ui.stack([
                                ui.desc([
                                    { label: '班次', value: sh ? (sh.shiftName + '（' + sh.startAt + ' – ' + sh.endAt + '）') : '<span class="tms-dim">未排班 · ' + TMS.people.shiftDef(rec ? rec.shiftCode : 'MID').name + '口径</span>' },
                                    { label: '上班', value: d.rec && d.rec.clockIn ? fmt.dateTime(d.rec.clockIn) : '<span class="tms-dim">未打</span>' },
                                    { label: '下班', value: d.rec && d.rec.clockOut ? fmt.dateTime(d.rec.clockOut) : '<span class="tms-dim">未打</span>' },
                                    { label: '今日工时', value: rec ? fmt.duration(rec.workHours) + (rec.overtimeHours ? '（加班 ' + rec.overtimeHours + ' 小时）' : '') : '<span class="tms-dim">—</span>' },
                                    { label: '出勤状态', value: rec ? ui.badge(esc(rec.attendance), rec.late || rec.earlyLeave ? 'warn' : 'success') : '<span class="tms-dim">—</span>' }
                                ], { inline: true }),
                                '<div class="tms-row">' +
                                ui.btn(canIn ? '上班打卡' : '已打上班卡', { tone: 'primary', act: canIn ? 'clock:in' : 'noop', disabled: !canIn }) +
                                ui.btn(canOut ? '下班打卡' : (d.rec && d.rec.clockOut ? '已打下班卡' : '下班打卡'), { act: canOut ? 'clock:out' : 'noop', disabled: !canOut, tone: canOut ? '' : 'muted' }) +
                                ui.btn('调整今日班次', { act: 'shift:take', arg: util.dateKey(util.now()) }) +
                                '</div>',
                                ui.notice('打卡时间即服务器时间（演示环境为本机时钟），工时/加班/迟到全部由打卡流水反推，页面不存二次结论', 'info')
                            ])
                        }),
                        ui.kpis([
                            { label: '出勤天数', value: days, unit: '天', tone: 'info', sub: '近 30 天' },
                            { label: '累计工时', value: util.round(util.sum(hist, 'workHours'), 1), unit: '小时', tone: 'brand' },
                            { label: '加班', value: ot, unit: '小时', tone: ot > 0 ? 'warn' : 'muted' },
                            { label: '迟到/早退', value: late, unit: '次', tone: late ? 'danger' : 'success' }
                        ]),
                        grid(ctx, {
                            rows: hist, title: '近 30 天考勤流水', sub: '共 ' + hist.length + ' 条',
                            columns: [
                                { key: 'date', label: '日期', render: function (r) { return esc(r.date); } },
                                { key: 'clockIn', label: '上班', render: function (r) { return fmt.time(r.clockIn); } },
                                { key: 'clockOut', label: '下班', render: function (r) { return r.clockOut ? fmt.time(r.clockOut) : '<span class="tms-dim">未打</span>'; } },
                                { key: 'shiftName', label: '班次', render: function (r) { return ui.badge(TMS.people.shiftDef(r.shiftCode).name, 'muted'); } },
                                { key: 'workHours', label: '工时', align: 'right', render: function (r) { return fmt.duration(r.workHours); } },
                                { key: 'overtimeHours', label: '加班', align: 'right', render: function (r) { return r.overtimeHours ? fmt.duration(r.overtimeHours) : '<span class="tms-dim">—</span>'; } },
                                { key: 'attendance', label: '状态', render: function (r) { return ui.badge(esc(r.attendance), r.late || r.earlyLeave ? 'warn' : 'success'); } },
                                { key: 'device', label: '终端', render: function (r) { return dim(r.device); } }
                            ],
                            search: function (r) { return r.date + ' ' + r.attendance; },
                            emptyText: '近 30 天没有打卡记录', emptySub: '点击上方「上班打卡」即建立当日记录'
                        })
                    ]
                });
            },
            actions: clockActions
        };
    }

    /* ---------- 绩效页 ---------- */

    function perfDef() {
        return {
            load: function (ctx) {
                var emp = me(ctx) || {};
                var period = ctx.state.period || TMS.people.defaultPeriod();
                var perf = emp.id ? TMS.people.computePerformance(emp.id, period) : null;
                var rows = emp.id ? db.col('performances').filter(function (p) { return p.employeeId === emp.id; })
                    .sort(function (a, b) { return String(b.period).localeCompare(String(a.period)); }) : [];
                return {
                    emp: emp, period: period, perf: perf,
                    metrics: perf ? TMS.people.computeMetrics(emp, period) : {},
                    rows: rows,
                    peer: peerAverage(emp.role, period)
                };
            },
            render: function (ctx, d) {
                if (!d.emp.id) return wrap(ctx, { body: [ui.card({ body: ui.empty('当前账号未绑定员工档案') })] });
                var m = d.metrics || {};
                var labels = METRIC_LABELS[d.emp.role] || METRIC_LABELS.other;
                var cards = labels.map(function (l) {
                    var v = m[l.key];
                    if (v == null) return '';
                    return { label: l.label, value: l.type === 'pct' ? fmt.percent(v) : (l.type === 'money' ? fmt.money(v) : fmt.number(v)), unit: l.unit, tone: l.tone };
                }).filter(Boolean);
                var s = d.perf || { score: 0, grade: '—' };
                return wrap(ctx, {
                    sub: '绩效为月度账：指标即时重算，库里只存得分与档位',
                    actions: ui.btn('切换账期', { size: 'sm', act: 'perf:period', arg: d.period }) +
                        ui.btn('重算本期', { size: 'sm', tone: 'primary', act: 'perf:recalc', arg: d.period }),
                    body: [
                        ui.split('side', [
                            ui.card({
                                title: d.period + ' 得分', sub: '同岗位均分 ' + d.peer, flat: true,
                                body: ui.stack([
                                    TMS.charts.gauge({ value: s.score, label: '综合得分', okAt: 85, warnAt: 70, height: 170 }),
                                    ui.row([
                                        ui.kpi({ label: '档位', value: esc(s.grade), tone: gradeTone(s.grade) }),
                                        ui.kpi({ label: '同岗均分', value: d.peer, tone: 'info' })
                                    ])
                                ])
                            }),
                            ui.card({
                                title: '计分口径', flat: true,
                                body: ui.notice(METHOD[d.emp.role] || METHOD.other, 'info')
                            })
                        ]),
                        ui.card({ title: '当期指标', sub: '账期覆盖 ' + (m.windowDays || 0) + ' 天', flat: true, body: ui.kpis(cards) }),
                        grid(ctx, {
                            rows: d.rows, title: '历史账期', sub: '仅存结论，指标读当期即时重算',
                            columns: [
                                { key: 'period', label: '账期' },
                                { key: 'score', label: '得分', align: 'right', render: function (r) { return '<b>' + r.score + '</b>'; } },
                                { key: 'grade', label: '档位', render: function (r) { return ui.badge(esc(r.grade), gradeTone(r.grade)); } },
                                {
                                    key: 'act', label: '', sortable: false, render: function (r) {
                                        return ui.link('查看当期', 'perf:open', r.period);
                                    }
                                }
                            ],
                            pageSize: 6,
                            emptyText: '还没有历史账期'
                        })
                    ]
                });
            },
            actions: {
                'perf:period': function () {
                    var months = util.unique(db.col('orders').map(function (o) { return util.monthKey(o.createdAt); })).sort().reverse();
                    ui.formModal({
                        title: '切换账期', sub: '可选月份来自订单数据，历史月已关账',
                        fields: [{ key: 'period', label: '账期', type: 'select', placeholder: false, options: ui.optionsOf(months) }],
                        okText: '查看',
                        onSubmit: function (v) {
                            ui.state(current().pageId).period = v.period;
                            refresh();
                        }
                    });
                },
                'perf:recalc': function (period) {
                    var emp = me();
                    if (!emp) { ui.toast('账号未绑定员工档案', 'error'); return; }
                    var res = TMS.people.computePerformance(emp.id, period);
                    run('绩效核算', res ? { ok: true } : { ok: false, message: '未找到员工档案' });
                },
                'perf:open': function (period) {
                    ui.state(current().pageId).period = period;
                    refresh();
                }
            }
        };
    }

    function gradeTone(g) {
        return g === 'A+' || g === 'A' ? 'success' : g === 'B' ? 'info' : g === 'C' ? 'warn' : g === 'D' ? 'danger' : 'muted';
    }

    function peerAverage(role, period) {
        var rows = db.col('performances').filter(function (p) {
            return p.period === period && (db.get('employees', p.employeeId) || {}).role === role;
        });
        return rows.length ? util.round(util.sum(rows, 'score') / rows.length, 1) : 0;
    }

    var METRIC_LABELS = {
        deliveryman: [
            { key: 'assigned', label: '派送单量', unit: '单' },
            { key: 'signed', label: '签收', unit: '单', tone: 'success' },
            { key: 'pending', label: '在途待派', unit: '单', tone: 'warn' },
            { key: 'onTimeRate', label: '及时率', type: 'pct' },
            { key: 'podRate', label: 'POD 完整率', type: 'pct' },
            { key: 'firstAttempt', label: '一次妥投率', type: 'pct' },
            { key: 'codCollected', label: '代收货款', type: 'money' },
            { key: 'revenue', label: '创造收入', type: 'money' },
            { key: 'exceptions', label: '异常', unit: '件', tone: 'danger' }
        ],
        sorter: [
            { key: 'tasks', label: '分拣任务', unit: '单' },
            { key: 'pieces', label: '件数', unit: '件' },
            { key: 'weight', label: '重量', unit: 'kg' },
            { key: 'efficiency', label: '效率', unit: '件/小时' },
            { key: 'accuracy', label: '准确率', type: 'pct' },
            { key: 'stdMinutes', label: '标准工时', unit: '分钟' },
            { key: 'actualMinutes', label: '实际工时', unit: '分钟' },
            { key: 'exceptions', label: '异常', unit: '件', tone: 'danger' }
        ],
        transporter: [
            { key: 'trips', label: '执行车次', unit: '次' },
            { key: 'km', label: '干线里程', unit: 'km' },
            { key: 'orders', label: '运输单量', unit: '单' },
            { key: 'weight', label: '载货重量', unit: 'kg' },
            { key: 'loadRate', label: '装载率', type: 'pct' },
            { key: 'onTimeRate', label: '班次准点率', type: 'pct' },
            { key: 'fuelCost', label: '油费成本', type: 'money' },
            { key: 'accidents', label: '事故异常', unit: '件', tone: 'danger' }
        ],
        branch: [
            { key: 'orders', label: '经手单量', unit: '单' },
            { key: 'collected', label: '揽收', unit: '单' },
            { key: 'revenue', label: '收入', type: 'money' },
            { key: 'cost', label: '成本', type: 'money' },
            { key: 'margin', label: '毛利率', type: 'pct' },
            { key: 'onTimeRate', label: '及时率', type: 'pct' },
            { key: 'exceptions', label: '本网点异常', unit: '件', tone: 'danger' }
        ],
        other: [
            { key: 'attendanceDays', label: '出勤', unit: '天' },
            { key: 'overtimeHours', label: '加班', unit: '小时' },
            { key: 'lateTimes', label: '迟到', unit: '次', tone: 'warn' },
            { key: 'tasks', label: '系统操作', unit: '次' }
        ]
    };

    var METHOD = {
        deliveryman: '基础分 35（在岗与协作）＋ 单量达成 25（对标本岗位人均产能与保底量取高）＋ 及时率 20 ＋ POD 完整率 12，异常每件按账期天数折算扣 4 分，封顶 120% 达成。',
        sorter: '基础分 35 ＋ 任务量达成 25（对标本分拨人均）＋ 分拣准确率 20 ＋ 件/小时效率 12，错分与异常按件扣分。',
        transporter: '基础分 35 ＋ 车次数达成 25（对标车队人均）＋ 班次准点率 20 ＋ 装载率 12，事故每件扣 6 分（按覆盖天数折算）。',
        branch: '基础分 35 ＋ 揽收量达成 25（对标同区网点人均）＋ 及时率 20 ＋ 网点毛利率 12，本网点经手异常每件扣 2 分，上限 20。',
        other: '基础分 72 ＋ 出勤达成 20 ＋ 加班封顶 10 － 迟到折算，职能岗不按单量计分。'
    };

    /* ---------- 排班页（分拣 / 司机） ---------- */

    function scheduleDef() {
        return {
            load: function (ctx) {
                var emp = me(ctx) || {};
                var days = [];
                for (var i = 0; i < 7; i++) {
                    var d = util.addDays(util.now(), i);
                    var key = util.dateKey(d);
                    var s = emp.id ? db.findOne('shifts', function (x) { return x.employeeId === emp.id && x.date === key; }) : null;
                    days.push({ date: key, weekday: WEEK[d.getDay()], shift: s ? TMS.people.shiftView(s) : null });
                }
                var hub = emp.hubId || (emp.orgId && /^HB/.test(emp.orgId) ? emp.orgId : '');
                return {
                    emp: emp, days: days,
                    board: TMS.people.roster(util.dateKey(util.now()), hub),
                    hub: hub
                };
            },
            render: function (ctx, d) {
                if (!d.emp.id) return wrap(ctx, { body: [ui.card({ body: ui.empty('当前账号未绑定员工档案') })] });
                var week = ui.table({
                    dense: true, keyName: 'date', rows: d.days, sortable: false,
                    columns: [
                        { key: 'date', label: '日期', render: function (r) { return esc(r.date) + ' <span class="tms-dim">' + esc(r.weekday) + '</span>'; } },
                        {
                            key: 'shift', label: '班次', render: function (r) {
                                return r.shift ? ui.badge(r.shift.shiftName + ' ' + r.shift.startAt + '–' + r.shift.endAt, 'brand') : '<span class="tms-dim">未排班</span>';
                            }
                        },
                        { key: 'remark', label: '备注', render: function (r) { return dim(r.shift && r.shift.remark); } },
                        {
                            key: 'act', label: '操作', sortable: false, render: function (r) {
                                return ui.btn(r.shift ? '改班' : '排班', { size: 'sm', act: 'shift:take', arg: r.date });
                            }
                        }
                    ]
                });
                return wrap(ctx, {
                    sub: '班次影响打卡迟到判定与绩效在岗口径；换班即改的是排班行本身',
                    body: [
                        ui.card({ title: '我的排班', sub: '未来 7 天', flat: true, body: week }),
                        ui.card({
                            title: '本场排班看板', sub: d.hub ? pg.hubName(d.hub) : '按岗位默认班次统计', flat: true,
                            body: ui.table({
                                dense: true, keyName: 'code', rows: d.board, sortable: false,
                                columns: [
                                    { key: 'name', label: '班次', render: function (r) { return ui.badge(esc(r.name) + ' ' + r.startAt + '–' + r.endAt, 'brand'); } },
                                    { key: 'count', label: '在岗', align: 'right' },
                                    { key: 'sorters', label: '分拣', align: 'right' },
                                    { key: 'drivers', label: '司机', align: 'right' },
                                    { key: 'couriers', label: '派送', align: 'right' },
                                    {
                                        key: 'employees', label: '名单', render: function (r) {
                                            return r.employees.length ? esc(r.employees.slice(0, 8).join('、')) + (r.employees.length > 8 ? ' 等' + r.employees.length + ' 人' : '') : '<span class="tms-dim">无人排班</span>';
                                        }
                                    }
                                ]
                            })
                        })
                    ]
                });
            },
            actions: clockActions
        };
    }

    var WEEK = ['日', '一', '二', '三', '四', '五', '六'];

    /* ---------- 异常工单面板（派送端 / 网点端共用） ---------- */

    function exceptionRows(scope) {
        var s = session();
        var rows = db.col('exceptions');
        if (scope === 'mine') {
            rows = rows.filter(function (e) {
                return e.reporter === s.name || e.responsible === s.name ||
                    (e.orderId && (s.role === 'deliveryman' ? (db.get('orders', e.orderId) || {}).courierId === s.personId
                        : (db.get('orders', e.orderId) || {}).originBranchId === s.orgId || (db.get('orders', e.orderId) || {}).destBranchId === s.orgId));
            });
        }
        return rows.sort(function (a, b) { return String(b.reportedAt).localeCompare(String(a.reportedAt)); });
    }

    function exceptionColumns() {
        return [
            { key: 'type', label: '异常', render: function (e) { return esc(e.type) + ' ' + pg.statusBadge(e.level === '一级' ? 'escalated' : e.status, pg.DOC_TEXT); } },
            { key: 'waybillNo', label: '运单', render: function (e) { return e.orderId ? ui.idCell(e.orderId, 'order:open') : '<span class="tms-dim">无单</span>'; } },
            { key: 'description', label: '情况', render: function (e) { return '<span class="tms-nowrap">' + dim(e.description) + '</span>'; } },
            { key: 'level', label: '等级', render: function (e) { return ui.badge(esc(e.level), e.level === '一级' ? 'danger' : e.level === '二级' ? 'warn' : 'muted'); } },
            { key: 'slaDeadline', label: 'SLA', render: function (e) { return TMS.service.isOverdue(e) ? '<span class="tone-danger">' + fmt.dateTime(e.slaDeadline) + '</span>' : fmt.dateTime(e.slaDeadline); } },
            { key: 'handler', label: '受理人', render: function (e) { return dim(e.handler); } },
            {
                key: 'act', label: '操作', sortable: false, render: function (e) {
                    var s = session();
                    var btns = '';
                    if (e.status === 'pending' && TMS.auth.can('service:handle')) btns += ui.btn('受理', { size: 'sm', act: 'ex:accept', arg: e.id });
                    if (e.status !== 'resolved' && e.orderId) btns += ui.btn('跟催', { size: 'sm', tone: 'warn', act: 'ex:urge', arg: e.id });
                    return btns || '<span class="tms-dim">已闭环</span>';
                }
            }
        ];
    }

    var exActions = {
        'ex:accept': function (id) {
            var res = TMS.service.processException(id, actor());
            run('工单受理', res && res.ok === false ? res : (res ? { ok: true } : null));
        },
        'ex:urge': function (id) {
            var e = db.get('exceptions', id);
            if (!e) return;
            if (e.escalated) { ui.toast('该工单已升级，等待运营主管处理', 'warn'); return; }
            var res = TMS.service.escalateException(id, '一线跟催升级：' + actor());
            run('跟催升级', res ? { ok: true } : { ok: false, message: '工单不存在' });
        }
    };

    /* ---------- 客服工单（网点端） ---------- */

    function ticketModal(orderId) {
        var o = orderId ? db.get('orders', orderId) : null;
        ui.formModal({
            title: '新建客服工单', sub: '催件/改址/投诉统一进工单池，处理结果回写订单备注',
            fields: [
                { key: 'orderId', label: '运单号', value: o ? o.id : '', placeholder: '可留空（非订单类工单）' },
                { key: 'type', label: '工单类型', type: 'select', options: ui.optionsOf(TMS.service.TICKET_TYPES), required: true },
                { key: 'priority', label: '优先级', type: 'select', placeholder: false, options: ui.optionsOf(['高', '中', '低']), value: '中' },
                { key: 'channel', label: '来源渠道', type: 'select', placeholder: false, options: ui.optionsOf(['客户来电', '在线客服', '网点代报', '系统回访']), value: '网点代报' },
                { key: 'content', label: '诉求描述', type: 'textarea', required: true, span: 2 }
            ],
            okText: '提交',
            onSubmit: function (v) {
                var res = TMS.service.createTicket({
                    orderId: v.orderId, type: v.type, priority: v.priority,
                    channel: v.channel, content: v.content, customer: o ? TMS.order.customerName(o) : '', actor: actor()
                });
                if (!res) return '提交失败';
                ui.toast('工单已提交：' + (res.id || ''), 'success');
            }
        });
    }

    var ticketActions = {
        'cs:accept': function (id) {
            var res = TMS.service.processTicket(id, actor());
            run('工单受理', res ? { ok: true } : { ok: false, message: '工单不存在或已受理' });
        },
        'cs:resolve': function (id) {
            ui.formModal({
                title: '回复并结单', fields: [
                    { key: 'result', label: '处理结果', type: 'textarea', required: true, span: 2 },
                    { key: 'satisfaction', label: '客户满意度', type: 'select', placeholder: false, options: ui.optionsOf(['满意', '一般', '不满意']), value: '满意' }
                ],
                okText: '结单',
                onSubmit: function (v) {
                    var res = TMS.service.resolveTicket(id, v.result, { satisfaction: v.satisfaction, operator: actor() });
                    if (!res) return '结单失败';
                    ui.toast('工单已结单', 'success');
                }
            });
        },
        'cs:new': function () { ticketModal(''); }
    };

    /* ---------- 移动端任务卡 ---------- */

    /* PDA 视角不铺大表：一张卡 = 一票活 + 这一步该按的按钮。
       列定义仍复用 pg.orderColumns 的口径，卡片只挑一线关心的四项 */
    function taskCards(rows, role, opts) {
        var o = opts || {};
        if (!rows.length) return ui.empty(o.emptyText || '今天没有待办', o.emptySub);
        return '<div class="tms-cards">' + rows.map(function (r) {
            var order = db.get('orders', r.id) || r;
            var late = TMS.order.isLate(order);
            return '<article class="tms-datacard">' +
                '<div class="tms-datacard-head">' +
                '<span class="tms-title">' + ui.idCell(r.id, 'order:open', { short: true }) + '</span>' +
                ui.statusBadge(order.status) + (late ? ui.badge('超时', 'danger') : '') +
                '</div>' +
                '<div class="tms-datacard-grid">' +
                '<div>线路<b>' + esc(r.origin) + '→' + esc(r.destination) + '</b></div>' +
                '<div>货物<b>' + esc(r.goods) + ' · ' + fmt.number(r.pieces) + ' 件</b></div>' +
                '<div>收件<b>' + esc(order.receiverName || r.customer || '—') + '</b></div>' +
                '<div>地址<b>' + esc(order.receiverAddress || '—') + '</b></div>' +
                '<div>承诺<b>' + fmt.dateTime(r.expectedAt || '') + (late ? ' 已超时' : '') + '</b></div>' +
                (r.courier ? '<div>派送<b>' + esc(r.courier) + '</b></div>' : '') +
                '</div>' +
                '<div class="tms-datacard-foot">' + stageButtons(order, role) + '</div>' +
                '</article>';
        }).join('') + '</div>';
    }

    /* 一线工作台顶部的「今日进度」四格，五端同构 */
    function todayStrip(rows, role) {
        var done = rows.filter(function (o) { return o.status === 'signed'; }).length;
        var pending = rows.filter(function (o) { return ['arrived', 'delivering', 'inbound', 'collected', 'sorted', 'transit'].indexOf(o.status) > -1; }).length;
        var late = rows.filter(function (o) { return TMS.order.isLate(o); }).length;
        var ex = rows.filter(function (o) { return o.status === 'problem'; }).length;
        var byStage = util.countBy(rows, 'status');
        return ui.kpis([
            { label: '在手工单', value: pending, unit: '单', tone: 'warn', sub: role === 'deliveryman' ? '待领取/待签收' : '未闭环' },
            { label: '今日完成', value: done, unit: '单', tone: 'success', sub: '签收量' },
            { label: '超时风险', value: late, unit: '单', tone: late ? 'danger' : 'muted', sub: '已超承诺时效' },
            { label: '问题件', value: ex, unit: '单', tone: ex ? 'danger' : 'muted', sub: (byStage.problem || 0) + ' 挂起' }
        ]);
    }

    var portal = {
        wrap: wrap, grid: grid, dim: dim, me: me, actor: actor, device: device,
        run: run, refresh: refresh, rateBar: rateBar, session: session,
        stageButtons: stageButtons, footerFor: footerFor, taskCards: taskCards, todayStrip: todayStrip,
        signModal: signModal, problemModal: problemModal, assignModal: assignModal,
        workActions: workActions,
        clockDef: clockDef, perfDef: perfDef, scheduleDef: scheduleDef,
        clockActions: clockActions,
        METRIC_LABELS: METRIC_LABELS, gradeTone: gradeTone, WEEK: WEEK,
        exceptionRows: exceptionRows, exceptionColumns: exceptionColumns, exActions: exActions,
        ticketModal: ticketModal, ticketActions: ticketActions,
        clockRows: clockRows
    };

    if (TMS.shell && TMS.shell.actions) {
        Object.keys(workActions).forEach(function (k) { TMS.shell.actions[k] = workActions[k]; });
    }

    TMS.portal = portal;
})(window);
