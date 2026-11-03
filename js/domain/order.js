/* 订单领域：状态机、揽收/改单/拦截/退回、轨迹派生、履约时效
   约定：所有状态推进只能经由本模块，页面不得直接改 status，保证单据一致性 */
(function (global) {
    'use strict';

    var TMS = global.TMS = global.TMS || {};
    var util = TMS.util, cfg = TMS.cfg, db = TMS.db;

    var FLOW = cfg.orderFlow;
    var LABEL = cfg.orderLabels;

    function statusIndex(status) {
        var i = FLOW.indexOf(status);
        return i < 0 ? 99 : i;
    }

    function isTerminal(order) {
        return ['signed', 'cancelled', 'returned'].indexOf(order.status) > -1;
    }

    function can(order, status) {
        return statusIndex(order.status) < statusIndex(status);
    }

    /* ---------- 派生读取（行内不落库的字段统一从这里取） ----------
       订单行只存事实，客户名/等级/结算周期、区域、承诺时效、体积重、优先级都能由
       客户档案、路由、运价卡反推；老库行仍带这些字段时优先用存量值，保证迁移前后同口径 */

    function partyOf(o) {
        if (!o) return null;
        return (o.customerId && db.get('customers', o.customerId)) || null;
    }

    /* 客户名解析：订单/积分/应收/工单行只存 customerId，名称读取时反查客户档案。
       行内若仍带 customer（老库或人工录入的散客单）则以存量为准 */
    function customerName(row) {
        if (!row) return '';
        if (row.customer) return row.customer;
        var id = row.customerId || (row.orderId ? (partyOf(db.get('orders', row.orderId)) || {}).id : '') || '';
        return (id && (db.get('customers', id) || {}).name) || '散客';
    }

    function customerLevel(row) {
        if (!row) return 'C';
        if (row.customerLevel) return row.customerLevel;
        var id = row.customerId || (row.orderId ? (partyOf(db.get('orders', row.orderId)) || {}).id : '') || '';
        return (id && (db.get('customers', id) || {}).level) || 'C';
    }

    function settleCycleOf(o) {
        if (!o) return '现付';
        return o.settleCycle || (partyOf(o) || {}).settleCycle || '现付';
    }

    function priorityOf(o) {
        if (!o) return '中';
        return o.priority || (o.service === '加急' ? '高' : (o.service === '经济' ? '低' : '中'));
    }

    function orderTypeOf(o) {
        return (o && o.orderType) || 'forward';
    }

    function volumeOf(o) {
        if (!o) return 0;
        if (o.volumeCm3) return Number(o.volumeCm3) || 0;
        return TMS.pricing.volumeCm3(o.dims, o.pieces, o.weight, o.goods);
    }

    /* 承诺时效：createdAt + 路由标准工时（服务级加成已在路由派生里算过），改线后自动跟随 */
    function promiseOf(o) {
        if (!o) return '';
        if (o.expectedAt) return o.expectedAt;
        var plan = TMS.network.planOf(o);
        return TMS.network.promiseAt(o.createdAt, plan, o.service);
    }

    function stdHoursOf(o) {
        if (!o) return 24;
        if (o.stdHours) return Number(o.stdHours) || 24;
        var plan = TMS.network.planOf(o);
        return (plan && plan.stdHours) || 24;
    }

    function profitOf(o) {
        if (!o) return 0;
        if (o.profit != null) return Number(o.profit) || 0;
        return util.money((Number(o.freight) || 0) - ((o.cost || {}).tot || 0));
    }

    function scanCountOf(o) {
        if (!o) return 0;
        if (o.scanCount) return Number(o.scanCount) || 0;
        var rows = scanIndex()[o.id];
        return rows ? rows.length : 0;
    }

    /* 网点/司机/车牌：订单已存 originBranchId/destBranchId/tripId，名称读时反查档案即可 */
    function branchRow(o, which) {
        if (!o) return null;
        return db.get('branches', which === 'dest' ? o.destBranchId : o.originBranchId) || null;
    }

    function branchName(o, which) {
        if (!o) return '';
        var stored = which === 'dest' ? o.destBranch : o.originBranch;
        return stored || (branchRow(o, which) || {}).name || '';
    }

    function tripOf(o) {
        return (o && o.tripId) ? db.get('transports', o.tripId) : null;
    }

    /* 干线执行方：车次行只存 vehicleId/driverId/carrierId，名称统一由作业域反查 */
    function crewOf(o) {
        var tr = tripOf(o);
        if (!tr) return { driverName: (o && o.driverName) || '', plateNo: (o && o.plateNo) || '' };
        return TMS.operation.crewOf(tr);
    }

    /* 子母件：真实网络里一件一个子单号，件数与母单号即可反推，不必为每件货留一行 */
    function packagesOf(o) {
        var n = Math.max(1, Number(o && o.pieces) || 1);
        if (!o || !o.waybillNo) return [];
        var kg = util.round((Number(o.chargeableWeight) || 0) / n, 2);
        var out = [];
        for (var i = 1; i <= n; i++) {
            out.push({ no: o.waybillNo + '-' + util.pad(i, 2), orderId: o.id, weight: kg, status: LABEL[o.status], index: i });
        }
        return out;
    }

    /* ---------- 下单 ---------- */

    function create(data) {
        var d = data || {};
        var customer = d.customerId ? db.get('customers', d.customerId) : null;
        if (!customer && d.customer) customer = db.findOne('customers', function (c) { return c.name === d.customer; });
        var origin = d.origin || (customer ? customer.city : '上海');
        var destination = d.destination;
        if (!destination) return { ok: false, message: '缺少目的城市' };
        if (!TMS.master.cityByName(destination)) return { ok: false, message: '目的城市不在服务网络内：' + destination };
        if (!TMS.master.cityByName(origin)) return { ok: false, message: '始发城市不在服务网络内：' + origin };

        var service = d.service || '标准';
        var payment = d.paymentMethod || (customer && customer.settleCycle === '月结' ? '月结' : '现付');
        if (payment === '到付' && !(Number(d.codAmount) > 0) && !d.allowCodWithoutGoods) {
            // 到付必须有代收货款，否则按现付处理，避免资金流无法闭环
            payment = '现付';
        }
        var weight = util.round(Math.max(0.1, Number(d.weight) || 1), 2);
        var pieces = Math.max(1, Number(d.pieces) || 1);
        var goods = d.goods || util.pick(TMS.master.GOODS).name;
        var ob = TMS.network.collectBranch(origin, d.senderAddress || origin);
        var dbb = TMS.network.deliverBranch(destination, d.receiverAddress || destination);
        var plan = TMS.network.planRoute(origin, destination, service);
        if (!plan) return { ok: false, message: '无法规划路由，请检查网络维护' };

        var q = TMS.pricing.quote({
            origin: origin, destination: destination, service: service, weight: weight, pieces: pieces,
            dims: d.dims, goods: goods, declaredValue: d.declaredValue, isInsured: !!d.isInsured,
            paymentMethod: payment, codAmount: d.codAmount, customerId: customer ? customer.id : ''
        }, { customer: customer });

        var province = (TMS.network.cityInfo(origin).code) || 'SH';
        var orderId = TMS.ids.buildOrderId(province, customer ? customer.id : (d.phone || 'guest'));
        var createdAt = d.createdAt ? util.iso(d.createdAt) : util.iso(util.now());

        var order = db.create('orders', {
            id: orderId,
            waybillNo: TMS.ids.buildWaybill(orderId),
            orderType: d.orderType === 'reverse' ? 'reverse' : '',
            customerId: customer ? customer.id : '',
            customer: customer ? '' : (d.customer || '散客'),
            contact: d.contact || (customer ? customer.contact : '收件人'),
            phone: d.phone || (customer ? customer.phone : ''),
            channel: d.channel || (customer && customer.level !== 'C' ? '客户经理' : '线上下单'),
            goods: goods, goodsRemark: d.goodsRemark || '',
            pieces: pieces, weight: weight, dims: d.dims || '',
            chargeableWeight: q.chargeableWeight,
            service: service, declaredValue: Number(d.declaredValue) || '', isInsured: d.isInsured ? true : '',
            paymentMethod: payment,
            codAmount: payment === '到付' ? (Number(d.codAmount) || 0) : '',
            freight: q.total, fees: TMS.pricing.leanFees(q),
            origin: origin, destination: destination,
            // 网点/枢纽只存 ID，名称与 hubId 读取时反查档案；子单号由件数+运单号推，不落包裹表
            originBranchId: ob ? ob.id : '', destBranchId: dbb ? dbb.id : '',
            hubFrom: ob ? ob.hubId : '', hubTo: dbb ? dbb.hubId : '',
            senderAddress: d.senderAddress || (customer ? customer.senderAddress : '') || (origin + '市工业园区 1 号'),
            receiverName: d.receiverName || d.contact || '收件人',
            receiverAddress: d.receiverAddress || (destination + '市' + util.pick(TMS.master.DISTRICTS) + util.randomDigits(3) + '号'),
            receiverPhone: d.receiverPhone || d.phone || '',
            status: 'created',
            // 环节时间统一由扫描流水派生，订单行只留创建/更新/签收三个时间点；
            // 承诺时效/_zone/标准工时/体积重由 createdAt + 路由 + 运价卡即时反推，不落库
            createdAt: createdAt, updatedAt: createdAt, signedAt: '',
            routeId: plan.routeId, distanceKm: plan.distanceKm,
            courierId: '', courier: '', tripId: '',
            pod: null, remark: d.remark || '',
            receivableStatus: payment === '现付' ? 'paid' : 'pending',
            exceptionCount: '', cost: null
        }, { id: orderId });

        order.cost = TMS.pricing.leanCost(TMS.pricing.costOf(order, plan));
        db.persist('order:create');

        addScan(order, 'CREATED', {
            location: ob ? ob.name : origin, operator: d.actor || (customer ? customer.shortName : '线上下单'),
            weight: weight, source: 'system'
        });
        if (payment !== '现付') TMS.finance.ensureReceivable(order);
        db.commit('orders', order.id, 'order:create');
        TMS.bus.emit('order:created', { order: order });
        return { ok: true, order: order, quote: q };
    }

    /* ---------- 状态推进内核 ---------- */

    /* 环节时间兜正：车次成班、班次时刻、异常回填这些「外部时钟」可能落后于本单已留下的作业痕迹，
       任何状态戳与扫描时间都不得早于上一笔，否则轨迹会出现先发车后分拣、先签收后上报的倒挂 */
    function anchorAt(o, at) {
        var iso = util.iso(at || util.now());
        return (o && o.updatedAt && util.toDate(iso) < util.toDate(o.updatedAt)) ? o.updatedAt : iso;
    }

    /* 统一推进：校验顺序 → 落状态 → 记扫描（环节时间只存在扫描行）→ 派生作业与账务 */
    function moveTo(orderId, status, opts) {
        var o = db.get('orders', orderId);
        if (!o) return { ok: false, message: '订单不存在' };
        var opt = opts || {};
        if (isTerminal(o)) return { ok: false, message: '订单已' + (LABEL[o.status] || o.status) + '，不可再操作' };
        if (o.status === 'problem' && !opt.force) return { ok: false, message: '问题件需先处理异常才能继续推进' };
        if (statusIndex(status) < 0) return { ok: false, message: '非法状态：' + status };
        if (o.status === status) return { ok: false, message: '订单已处于「' + (LABEL[status] || status) + '」' };
        if (statusIndex(o.status) >= statusIndex(status)) {
            return { ok: false, message: '当前状态「' + (LABEL[o.status] || o.status) + '」不允许回退到「' + (LABEL[status] || status) + '」' };
        }
        // 顺序校验：跳过中间环节需要显式 allowSkip（如批量补录）
        if (!opt.allowSkip && statusIndex(status) > statusIndex(o.status) + 1) {
            var miss = FLOW.slice(statusIndex(o.status) + 1, statusIndex(status));
            return { ok: false, message: '需先完成：' + miss.map(function (s) { return LABEL[s]; }).join(' → ') };
        }

        var at = anchorAt(o, opt.at ? util.toDate(opt.at) : util.now());
        var from = o.status;
        o.status = status;
        o.updatedAt = at;

        var node = cfg.stageNode[status];
        var weighing = cfg.weighNodes.indexOf(node) > -1;
        // 称重环节只在复磅与申报不符时留实际重量，其余环节读订单计费重即可
        var weighed = weighing && opt.weight != null
            && util.round(Number(opt.weight) || 0, 2) !== util.round(Number(o.chargeableWeight || o.weight) || 0, 2)
            ? opt.weight : undefined;
        if (status === 'signed') {
            o.signedAt = at;
            // POD 只留偏离默认的签收证据：默认「本人签收、无备注、无照片」不落字段
            var pod = {};
            if (opt.receiver && opt.receiver !== '本人签收') pod.receiver = opt.receiver;
            if (opt.receiverPhone && opt.receiverPhone !== o.receiverPhone) pod.receiverPhone = opt.receiverPhone;
            if (opt.note) pod.podNote = opt.note;
            if (opt.photo) pod.podPhoto = true;
            o.pod = pod;
        }
        db.touch('orders');
        addScan(o, node, {
            // 常规作业地点由「订单 + 节点」派生，只有人工改判/异常扫描才把地点操作人写进流水
            location: opt.location && opt.location !== locationFor(o, status) ? opt.location : '',
            operator: opt.operator, device: opt.device,
            weight: weighed,
            result: opt.result, remark: opt.note || '', at: at
        });
        db.persist('order:move');
        if (from !== status) TMS.operation.onStage(o, from, status, opt);
        if (status === 'signed') TMS.finance.settleOrder(o);
        // 返积分在签收后计提：取消、退回、问题件不该留下会员权益
        if (status === 'signed') TMS.people.awardPoints(o);
        db.commit('orders', o.id, 'order:move');
        TMS.bus.emit('order:moved', { order: o, from: from, to: status });
        return { ok: true, order: o };
    }

    function locationFor(o, status) {
        if (status === 'collected' || status === 'inbound') return branchName(o, 'origin') || o.origin;
        if (status === 'sorted' || status === 'transit') return (TMS.master.hubByNameOrId(o.hubFrom) || {}).name || o.origin;
        if (status === 'arrived') return (TMS.master.hubByNameOrId(o.hubTo) || {}).name || o.destination;
        if (status === 'delivering' || status === 'signed') return branchName(o, 'dest') || o.destination;
        return o.origin;
    }

    /* 叙述性动作（放行、改单、拦截）也写成扫描节点，轨迹只有一条读取路径 */
    function noteScan(o, nodeCode, opt, at, location) {
        var d = opt || {};
        return addScan(o, nodeCode, {
            location: location, operator: d.operator, device: d.device,
            remark: d.label ? (d.label + ((d.note || d.reason) ? '：' + (d.note || d.reason) : '')) : (d.note || ''),
            result: d.result, at: at, deviant: d.deviant
        });
    }

    /* 扫描流水：全链路作业留痕，也是轨迹与各环节时间的唯一事实来源。
       行只存事实（谁/何时/在哪/什么节点），节点名、操作方、应完成时间读取时派生；
       默认操作方/设备/结果不落库，单条流水从 ~185B 压到 ~96B，30 天全量才装得进 localStorage */
    function addScan(o, nodeCode, data) {
        var d = data || {};
        var node = cfg.nodeOf(nodeCode);
        // 未显式给时刻的异常/退货流水走默认时钟，同样不得早于本单已有的作业痕迹
        var at = d.at ? util.iso(d.at) : anchorAt(o);
        // 流水只追加、从不按主键回查，故不落单据号：省下的字符全部还给订单与车次
        var scan = { orderId: o.id, node: node.code, opTime: at };
        // 干线在途时长随路线而变，其余节点的应完成时限由 traceNodes 字典派生，不必逐条存库
        if (nodeCode === 'DEPARTURE') {
            var leg = trunkHours(o);
            if (leg && leg !== nextStdHours(nodeCode)) scan.dueH = leg;
        }
        if (d.weight != null) scan.weight = util.round(Number(d.weight) || 0, 2);
        if (d.remark) scan.remark = d.remark;
        if (d.location) scan.location = d.location;
        if (d.operator && d.operator !== '系统') scan.operator = d.operator;
        if (d.device && d.device !== node.term) scan.device = d.device;
        if (d.result && d.result !== 'ok') scan.result = d.result;
        if (d.hubId) scan.hubId = d.hubId;
        if (d.branchId) scan.branchId = d.branchId;
        if (d.deviant) scan.isDeviant = true;
        db.create('scans', scan, { stamp: false, id: false });
        return scan;
    }

    /* 本节点应完成时间 = 扫描时刻 + 下一环节标准耗时（干线在发车时按实际在途时长落 dueH） */
    function scanDueHours(s) {
        return Number(s.dueH) || nextStdHours(s.node);
    }

    function scanDeadline(s) {
        return util.iso(util.addHours(util.toDate(s.opTime), scanDueHours(s)));
    }

    function scanDue(s) {
        return util.toDate(s.opTime).getTime() + scanDueHours(s) * 3600000;
    }

    /* 下一环节标准耗时：取自 traceNodes 顺序字典，字典顺序即作业顺序 */
    var NEXT_HOURS = null;
    function nextStdHours(nodeCode) {
        if (!NEXT_HOURS) {
            NEXT_HOURS = {};
            cfg.traceNodes.forEach(function (n, i) {
                NEXT_HOURS[n.code] = (cfg.traceNodes[i + 1] || {}).stdHours || 8;
            });
        }
        return NEXT_HOURS[nodeCode] || 8;
    }

    /* 干线实际在途小时：发车扫描据此设定到达时限 */
    function trunkHours(o) {
        var plan = TMS.network.planOf(o);
        var segs = (plan && plan.segments) || [];
        var hours = util.sum(segs.filter(function (s) { return s.legType === 'trunk'; }), 'stdHours');
        return hours || (plan && plan.stdHours) || 0;
    }

    /* 环节时间派生：订单行不再冗余存 6 个阶段时间戳，页面与统计统一从扫描流水取。
       ISO 时间串可按字典序比较，派生时不需要 new Date。
       stageTimes 返回 { created, collected, inbound, sorted, transit, arrived, delivering, signed } */
    function stageTimes(order, rows) {
        var list = rows || db.col('scans').filter(function (s) { return s.orderId === order.id; });
        var out = { created: order.createdAt };
        for (var i = 0; i < list.length; i++) {
            var stage = cfg.nodeOf(list[i].node).stage;
            if (stage && (!out[stage] || list[i].opTime < out[stage])) out[stage] = list[i].opTime;
        }
        if (order.signedAt) out.signed = order.signedAt;
        return out;
    }

    function stageAt(order, status, rows) {
        if (!order) return '';
        if (status === 'created') return order.createdAt;
        if (status === 'signed') return order.signedAt || '';
        return stageTimes(order, rows)[status] || '';
    }

    /* 流水按单预分组：绩效/时效这类全表统计用它，避免每单重扫一遍 scans。
       扫描行只追加不修改，故按集合版本号缓存分组结果 */
    var scanCache = { rev: -1, map: null };

    function scanIndex() {
        var rev = db.rev('scans');
        if (scanCache.map && scanCache.rev === rev) return scanCache.map;
        var map = {};
        db.col('scans').forEach(function (s) {
            var list = map[s.orderId];
            if (!list) map[s.orderId] = [s];
            else list.push(s);
        });
        Object.keys(map).forEach(function (k) {
            var list = map[k];
            if (list.length > 1) list.sort(function (a, b) { return a.opTime < b.opTime ? -1 : (a.opTime > b.opTime ? 1 : 0); });
        });
        scanCache = { rev: rev, map: map };
        return map;
    }

    /* 轨迹视图：页面统一读取这里，扫描行只存事实、这里补全展示字段。
       超时判定同样派生——下一节点晚于本节点应完成时间即超时，未走完的单看当前时刻 */
    function scanIsOvertime(s, next, order) {
        if (s.isOvertime) return true;
        var due = scanDue(s);
        if (next) return util.toDate(next.opTime).getTime() > due;
        if (!order || ['signed', 'cancelled', 'returned'].indexOf(order.status) > -1) return false;
        return util.now().getTime() > due;
    }

    /* 扫描终端：流水存设备号（DEV0007），名称读取时反查设备档案；
       设备号缺省即该节点的默认终端，人工补录/异常扫描才写显式值 */
    function deviceLabelOf(s, node) {
        if (!s || !s.device) return (node || cfg.nodeOf(s && s.node)).term || 'PDA-9000';
        if (s.device.indexOf('DEV') === 0) return (db.get('devices', s.device) || {}).name || s.device;
        return s.device;      // 老库/人工录入的 free-text 终端标签
    }

    function traceView(s, order, next) {
        var node = cfg.nodeOf(s.node);
        return {
            orderId: s.orderId, waybillNo: order ? order.waybillNo : '',
            node: s.node, nodeName: node.name, status: node.stage,
            location: s.location || (order ? locationFor(order, node.stage || 'created') : ''),
            // 设备只存偏离默认终端的少数流水，默认终端由节点字典派生
            operator: s.operator || '系统', device: deviceLabelOf(s, node), opTime: s.opTime,
            deadline: scanDeadline(s), isOvertime: scanIsOvertime(s, next, order), isDeviant: !!s.isDeviant,
            result: s.result || 'ok', remark: s.remark || '',
            // 称重节点未存重量即代表与订单计费重一致
            weight: s.weight != null ? s.weight : (cfg.weighNodes.indexOf(s.node) > -1 && order
                ? (Number(order.chargeableWeight) || Number(order.weight) || 0) : undefined),
            planTo: expectedTo(order, s.node)
        };
    }

    function scansOf(orderId) {
        return util.sortBy(db.col('scans').filter(function (s) { return s.orderId === orderId; }), 'opTime', 'asc');
    }

    function traces(orderId) {
        var o = db.get('orders', orderId);
        var rows = scansOf(orderId);
        return rows.map(function (s, i) { return traceView(s, o, rows[i + 1]); });
    }

    function expectedTo(order, node) {
        if (!order) return '';
        var map = { CREATED: '下单', GOT: '揽收网点', INBOUND: '始发网点', SORTING: '始发分拨', DEPARTURE: '干线发出', ARRIVED: '目的分拨', DELIVERING: '派送网点', SIGNED: '收件人' };
        return map[node] || '';
    }

    /* ---------- 业务动作 ---------- */

    function advance(orderId, opts) {
        var o = db.get('orders', orderId);
        if (!o) return { ok: false, message: '订单不存在' };
        var i = statusIndex(o.status);
        if (i < 0 || i >= FLOW.length - 1) return { ok: false, message: '订单已处于终态：' + (LABEL[o.status] || o.status) };
        return moveTo(orderId, FLOW[i + 1], opts || {});
    }

    function collect(orderId, data) {
        var d = data || {};
        var o = db.get('orders', orderId);
        if (!o) return { ok: false, message: '订单不存在' };
        if (Number(d.actualWeight) > 0) {
            var q = TMS.pricing.reprice(o, { weight: d.actualWeight, dims: d.dims || o.dims });
            var delta = util.money(q.total - Number(o.freight));
            TMS.pricing.applyQuote(o, q);
            if (Math.abs(delta) >= 0.01) o.remark = (o.remark ? o.remark + '；' : '') + '揽收复磅运费调整 ' + delta + ' 元';
            db.touch('orders');
        }
        return moveTo(orderId, 'collected', { operator: d.operator || '揽收员', weight: o.weight, device: d.device, location: d.location || branchName(o, 'origin') || o.origin, note: d.note });
    }

    function inbound(orderId, data) {
        var d = data || {};
        return moveTo(orderId, 'inbound', {
            operator: d.operator || '网点作业员', device: d.device,
            location: d.location || (db.get('branches', (db.get('orders', orderId) || {}).originBranchId) || {}).name,
            weight: d.weight, note: d.note
        });
    }

    function sort(orderId, data) {
        var d = data || {};
        var o = db.get('orders', orderId);
        var res = moveTo(orderId, 'sorted', {
            operator: d.operator || '分拣员', device: d.device, chute: d.chute,
            location: d.location || (TMS.master.hubByNameOrId(o ? o.hubFrom : '') || {}).name,
            note: d.note
        });
        // 格口由分拣任务承接（偏离默认格口才落库），订单行不复制
        return res;
    }

    function depart(orderId, data) {
        var d = data || {};
        var o = db.get('orders', orderId);
        if (!o) return { ok: false, message: '订单不存在' };
        var res = moveTo(orderId, 'transit', {
            operator: d.operator || d.driver || '司机', location: d.location || (TMS.master.hubByNameOrId(o.hubFrom) || {}).name,
            device: d.device, note: d.note
        });
        return res;
    }

    function arrive(orderId, data) {
        var d = data || {};
        var o = db.get('orders', orderId);
        if (!o) return { ok: false, message: '订单不存在' };
        return moveTo(orderId, 'arrived', {
            operator: d.operator || '到达扫描', location: d.location || (TMS.master.hubByNameOrId(o.hubTo) || {}).name, note: d.note
        });
    }

    /* 图1 的两条判定链在派单这一步收口，判定不落库而是现算：
       地址审核状态和围栏边界都是会变的，把结论冻在订单上就等于留下一个会说谎的字段。
       左支「送不送」：先按收件手机号取审通过的维护地址，没有再问机构派送围栏罩不罩得住收件点；
       右支「谁去送」：单上已有编号直接结束，没有就看收件点落进哪位派送员的编号围栏。
       收件点用目的城市质心——演示数据没有区级地理编码，判定本身仍是射线法打在勾画的边界上 */
    function dispatchOf(order) {
        var o = typeof order === 'string' ? db.get('orders', order) : order;
        if (!o) return null;
        var point = TMS.master.cityByName(o.destination);
        var addr = TMS.address.phoneDecision(o.receiverPhone, o.receiverAddress);
        var bound = !!o.courierId;
        var hit = bound ? null : TMS.network.courierFenceAt(point);
        var near = hit || bound ? null : TMS.network.nearestCourierFence(point, o.destination);
        var nearEmp = near && near.courier ? near.courier : null;
        return {
            orderId: o.id, city: o.destination, point: point,
            canDeliver: addr.canDeliver, deliverVia: addr.via, deliverNote: addr.note,
            blocked: addr.blocked || '',
            courierId: bound ? o.courierId : (hit ? hit.courier.id : ''),
            courier: bound ? o.courier : (hit ? hit.courier.name : ''),
            courierVia: bound ? '已有派送编号' : (hit ? '编号围栏自动绑定' : '需手动指定派送编号'),
            fenceName: hit ? hit.fence.name : '',
            /* 罩不住任何片区时给的是「离收件点最近的那片」，只预填不代填 */
            suggestId: nearEmp ? nearEmp.id : '',
            suggest: nearEmp ? nearEmp.name : '',
            suggestFence: near ? near.fence.name : '', suggestKm: near ? near.km : 0
        };
    }

    function assignDelivery(orderId, data) {
        var d = data || {};
        var o = db.get('orders', orderId);
        if (!o) return { ok: false, message: '订单不存在' };
        if (statusIndex(o.status) < statusIndex('arrived')) return { ok: false, message: '订单需先到达目的网点才可派送' };
        /* 调度点了人就按点的算；没点人才让编号围栏说话（图1 右支的「在围栏内 → 绑定派送编号」）。
           围栏里那个人必须是本城在册派送员，否则宁可回到人工指定 */
        var auto = (!d.courierId && !d.courier) ? dispatchOf(o) : null;
        var courier = d.courierId ? db.get('employees', d.courierId) : findCourier(d.courier || (auto && auto.courierId) || '', o.destination);
        if (courier) { o.courierId = courier.id; o.courier = courier.name; }
        if (d.deliveryEta) o.deliveryEta = d.deliveryEta;
        db.touch('orders');
        return moveTo(orderId, 'delivering', { operator: d.operator || '网点调度', courier: o.courier, note: d.note, location: branchName(o, 'dest') || o.destination });
    }

    function findCourier(name, city) {
        if (!name) return null;
        var list = db.col('employees').filter(function (e) { return e.role === 'deliveryman' && (e.name === name || e.id === name); });
        if (!list.length) list = db.col('employees').filter(function (e) { return e.role === 'deliveryman' && e.status === 'active' && (!city || e.city === city); });
        return list[0] || null;
    }

    /* 单号解析的唯一入口：输入框统一标「运单号」，但操作员手里可能是 HL 订单号、WB 运单号、
       抄单抄错的片段，甚至只有收件人手机后四位。此前每个页面各自手抄一遍
       `db.get(订单号) || 再 findOne(运单号)`，漏抄的那几处就把真实存在的单报成「订单不存在」。
       只认唯一命中：片段或后四位撞出多张时返回 null，让调用方去列表里筛，不替用户猜一张。 */
    function byCode(code, rows) {
        var key = String(code == null ? '' : code).trim();
        if (!key) return null;
        var up = key.toUpperCase();
        var list = rows || db.col('orders');
        var hits = list.filter(function (o) {
            return String(o.id).toUpperCase() === up || String(o.waybillNo || '').toUpperCase() === up;
        });
        if (hits.length === 1) return hits[0];
        if (hits.length > 1) return hits[0];
        /* 手机后四位要脱掉分隔符再比：档案里有「138-0000-1234」这种写法 */
        var tail = up.replace(/\D/g, '');
        var fuzzy = list.filter(function (o) {
            if (tail.length === 4) return String(o.receiverPhone || '').replace(/\D/g, '').slice(-4) === tail;
            return String(o.id).toUpperCase().indexOf(up) > -1 || String(o.waybillNo || '').toUpperCase().indexOf(up) > -1;
        });
        return fuzzy.length === 1 ? fuzzy[0] : null;
    }

    function sign(orderId, data) {
        var d = data || {};
        var o = db.get('orders', orderId);
        if (!o) return { ok: false, message: '订单不存在' };
        if (o.status !== 'delivering') return { ok: false, message: '需先进入派送中才能签收' };
        return moveTo(orderId, 'signed', {
            operator: d.operator || o.courier || '派送员', receiver: d.receiver, receiverPhone: d.receiverPhone,
            note: d.note, photo: d.photo, device: d.device, location: branchName(o, 'dest') || o.destination
        });
    }

    /* 异常件：挂起主状态并生成异常工单 */
    function markProblem(orderId, data) {
        var d = data || {};
        var o = db.get('orders', orderId);
        if (!o) return { ok: false, message: '订单不存在' };
        if (isTerminal(o)) return { ok: false, message: '终态订单不可标记异常' };
        var prevStage = o.status;
        o.problemFrom = prevStage;
        o.status = 'problem';
        o.updatedAt = anchorAt(o);
        o.exceptionCount = (o.exceptionCount || 0) + 1;
        db.touch('orders');
        addScan(o, 'PROBLEM', { location: d.location || o.origin, operator: d.operator || '作业员', remark: d.description, result: 'exception' });
        var ex = TMS.service.createException({
            orderId: o.id, type: d.type || '其他异常', description: d.description || '',
            level: d.level || (d.type === '货物破损' ? '二级' : '三级'), actor: d.actor || d.operator || '作业员'
        });
        db.commit('orders', o.id, 'order:problem');
        TMS.bus.emit('order:problem', { order: o, exception: ex });
        return { ok: true, order: o, exception: ex };
    }

    function releaseProblem(orderId, data) {
        var d = data || {};
        var o = db.get('orders', orderId);
        if (!o || o.status !== 'problem') return { ok: false, message: '该订单不是问题件' };
        var back = o.problemFrom || 'inbound';
        o.status = back;
        o.problemFrom = '';
        o.updatedAt = anchorAt(o);
        noteScan(o, 'RELEASE', { operator: d.operator || '运营管理员', label: '问题件放行', note: d.note || '继续转运' }, o.updatedAt, d.location || branchName(o, 'origin'));
        db.commit('orders', o.id, 'order:release');
        return { ok: true, order: o };
    }

    /* 取消/拦截：已发运的订单走拦截流程，产生逆向件 */
    function cancel(orderId, data) {
        var d = data || {};
        var o = db.get('orders', orderId);
        if (!o) return { ok: false, message: '订单不存在' };
        if (o.status === 'signed') return { ok: false, message: '已签收订单不可取消，请走退货流程' };
        if (o.status === 'cancelled') return { ok: false, message: '订单已取消' };
        var needIntercept = statusIndex(o.status) >= statusIndex('transit');
        o.status = 'cancelled';
        o.cancelledAt = anchorAt(o);
        o.updatedAt = o.cancelledAt;
        o.remark = (o.remark ? o.remark + '；' : '') + (d.reason || '客户下单取消');
        db.touch('orders');
        addScan(o, 'INTERCEPT', {
            location: d.location || o.origin, operator: d.operator || '运营管理员',
            remark: (needIntercept ? '拦截退回：' : '取消订单：') + (d.reason || '客户下单取消'), result: 'exception'
        });
        TMS.finance.voidReceivable(o, needIntercept ? '拦截取消' : '下单取消');
        if (needIntercept) TMS.operation.openIntercept(o, d);
        db.commit('orders', o.id, 'order:cancel');
        return { ok: true, order: o, intercepted: needIntercept };
    }

    /* 改单：地址/服务/重量变更 → 重算运费并留痕 */
    function change(orderId, data) {
        var d = data || {};
        var o = db.get('orders', orderId);
        if (!o) return { ok: false, message: '订单不存在' };
        if (isTerminal(o)) return { ok: false, message: '终态订单不可改单' };
        if (statusIndex(o.status) >= statusIndex('transit') && !d.force) {
            return { ok: false, message: '订单已进入干线运输，改单需先拦截或走异常流程' };
        }
        var before = { freight: o.freight, weight: o.weight, service: o.service, receiverAddress: o.receiverAddress, destination: o.destination };
        var patch = {};
        ['service', 'weight', 'pieces', 'dims', 'destination', 'receiverAddress', 'receiverName', 'receiverPhone', 'contact', 'phone', 'declaredValue', 'isInsured', 'paymentMethod', 'codAmount', 'remark'].forEach(function (k) {
            if (d[k] != null && d[k] !== '') patch[k] = d[k];
        });
        Object.keys(patch).forEach(function (k) { o[k] = patch[k]; });
        var q = TMS.pricing.reprice(o, {});
        if (patch.destination && patch.destination !== before.destination) {
            var dest = TMS.network.deliverBranch(o.destination, o.receiverAddress || o.destination);
            if (dest) { o.destBranchId = dest.id; o.hubTo = dest.hubId; }
        }
        TMS.pricing.applyQuote(o, q);
        // 改线后重取路由：区域/标准工时/承诺时效均由 planOf 即时派生，不必回写冗余字段
        var plan = TMS.network.planOf(o);
        if (plan) { o.routeId = plan.routeId; o.distanceKm = plan.distanceKm; }
        o.updatedAt = anchorAt(o);
        var delta = util.money(o.freight - before.freight);
        noteScan(o, 'CHANGE', {
            operator: d.operator || '运营管理员',
            label: '改单' + (Math.abs(delta) < 0.01 ? '（运费不变）' : (delta > 0 ? '（补收 ' + delta + '）' : '（退费 ' + Math.abs(delta) + '）')),
            note: d.note || Object.keys(patch).join('、')
        }, o.updatedAt, branchName(o, 'origin'));
        db.touch('orders');
        TMS.finance.adjustReceivable(o, delta, '改单');
        db.commit('orders', o.id, 'order:change');
        return { ok: true, order: o, delta: delta, quote: q };
    }

    /* 逆向退货件：原单退回，生成反向订单 */
    function createReverseOrder(orderId, data) {
        var d = data || {};
        var o = db.get('orders', orderId);
        if (!o) return { ok: false, message: '订单不存在' };
        o.status = 'returned';
        o.returnedAt = anchorAt(o);
        o.updatedAt = o.returnedAt;
        db.touch('orders');
        addScan(o, 'RETURNED', { location: branchName(o, 'dest') || o.destination, operator: d.operator || '运营管理员', remark: '退货发起：' + (d.reason || '客户拒收/退货'), result: 'exception' });
        var res = create({
            origin: o.destination, destination: o.origin,
            customerId: o.customerId, customer: o.customer, contact: o.contact, phone: o.phone,
            goods: o.goods, weight: o.weight, pieces: o.pieces, service: o.service,
            paymentMethod: '现付', orderType: 'reverse',
            senderAddress: o.receiverAddress, receiverAddress: o.senderAddress,
            receiverName: o.contact || '发货人',
            remark: '逆向退货件 · 原单 ' + o.id, actor: d.operator || '运营管理员'
        });
        if (res.ok) {
            res.order.reverseOf = o.id;
            o.reverseOrderId = res.order.id;
            db.commit('orders', res.order.id, 'order:reverse');
        }
        db.commit('orders', o.id, 'order:returned');
        return { ok: true, forward: o, reverse: res.order };
    }

    function update(orderId, patch) { return db.update('orders', orderId, patch); }

    function detail(orderId) {
        var o = db.get('orders', orderId);
        if (!o) return null;
        return {
            order: o, traces: traces(orderId), plan: TMS.network.planOf(o), feeRows: TMS.pricing.feeRows(o),
            packages: packagesOf(o),
            tasks: TMS.operation.tasksOfOrder(orderId), exception: TMS.service.exceptionsOf(orderId),
            receivable: TMS.finance.receivableOf(orderId)
        };
    }

    /* 列表视图：页面统一读这里，派生字段（客户/区域/时效/优先级/成本毛利）一次补齐；
       老库行若仍带这些字段，则以存量值覆盖派生值 */
    function view(o) {
        if (!o) return null;
        var crew = crewOf(o);
        var out = {
            customer: customerName(o), customerLevel: customerLevel(o), settleCycle: settleCycleOf(o),
            priority: priorityOf(o), orderType: orderTypeOf(o), volumeCm3: util.round(volumeOf(o), 0),
            originZone: TMS.pricing.zoneOf(o.origin), destinationZone: TMS.pricing.zoneOf(o.destination),
            expectedAt: promiseOf(o), stdHours: stdHoursOf(o), profit: profitOf(o), scanCount: scanCountOf(o),
            originBranch: branchName(o, 'origin'), destBranch: branchName(o, 'dest'),
            driverName: crew.driverName, plateNo: crew.plateNo
        };
        Object.keys(o).forEach(function (k) { out[k] = o[k]; });
        return out;
    }

    /* 当前滞留时长（小时）：用于压单/超时看板 */
    function stuckHours(o) {
        if (isTerminal(o)) return 0;
        return util.round(util.hoursBetween(o.updatedAt || o.createdAt, util.now()), 1);
    }

    function isLate(o) {
        return !isTerminal(o) && util.toDate(promiseOf(o)).getTime() < util.now().getTime();
    }

    function isSignedLate(o) {
        return o.status === 'signed' && util.toDate(o.signedAt).getTime() > util.toDate(promiseOf(o)).getTime();
    }

    function statusOptions() {
        return FLOW.concat(['problem', 'returned', 'cancelled']).map(function (k) { return { value: k, label: LABEL[k] }; });
    }

    TMS.order = {
        create: create, moveTo: moveTo, advance: advance,
        collect: collect, inbound: inbound, sort: sort, depart: depart, arrive: arrive,
        assignDelivery: assignDelivery, sign: sign, markProblem: markProblem, releaseProblem: releaseProblem,
        dispatchOf: dispatchOf,
        cancel: cancel, change: change, createReverseOrder: createReverseOrder,
        traces: traces, detail: detail, update: update, view: view,
        statusIndex: statusIndex, isTerminal: isTerminal, isLate: isLate, isSignedLate: isSignedLate,
        stuckHours: stuckHours, statusOptions: statusOptions, LABEL: LABEL, FLOW: FLOW,
        customerName: customerName, customerLevel: customerLevel, partyOf: partyOf, priorityOf: priorityOf,
        orderTypeOf: orderTypeOf, volumeOf: volumeOf, promiseOf: promiseOf, stdHoursOf: stdHoursOf,
        profitOf: profitOf, scanCountOf: scanCountOf, settleCycleOf: settleCycleOf,
        branchRow: branchRow, branchName: branchName, tripOf: tripOf, crewOf: crewOf, packagesOf: packagesOf,
        findCourier: findCourier, byCode: byCode, addScan: addScan, traceView: traceView, noteScan: noteScan,
        scanDeadline: scanDeadline, scanDue: scanDue, scanDueHours: scanDueHours,
        scansOf: scansOf, scanIndex: scanIndex, stageAt: stageAt, stageTimes: stageTimes,
        deviceLabelOf: deviceLabelOf
    };
})(window);
