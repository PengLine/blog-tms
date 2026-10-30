/**
 * TMS 共享数据层
 * ------------------------------------------------------------
 * 基于 localStorage 的轻量业务数据库，供管理员端所有页面共享。
 * 职责：
 *  1. 首次访问自动生成真实感种子数据（订单/运单/运输/异常/扫描等）
 *  2. 提供统一的增删改查、搜索、筛选、排序、分页能力
 *  3. 维护订单全生命周期状态流转，并自动写入扫描、运输、财务等关联记录
 *  4. 提供各页面所需的统计聚合（KPI、趋势、分布、日报）
 *
 * 所有页面通过 window.TmsStore 访问；数据变更会触发 tms:datachange 事件。
 */
(function (global) {
    'use strict';

    var DB_KEY = 'tmsDB_v3';
    var DB_VERSION = 3;

    /* ============================== 基础工具 ============================== */

    function pad(n, len) {
        return String(n).padStart(len || 2, '0');
    }

    function dateKey(d) {
        var date = d instanceof Date ? d : new Date(d);
        return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
    }

    function dateTimeKey(d) {
        var date = d instanceof Date ? d : new Date(d);
        return dateKey(date) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
    }

    function hash(str) {
        var h = 0;
        for (var i = 0; i < String(str).length; i++) {
            h = (String(str).charCodeAt(i) + ((h << 5) - h)) | 0;
        }
        return Math.abs(h);
    }

    // 固定种子随机数，保证首次生成的演示数据在同一浏览器中稳定
    function mulberry32(seed) {
        return function () {
            seed |= 0;
            seed = (seed + 0x6D2B79F5) | 0;
            var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    var rand = mulberry32(20260122);

    function pick(list) {
        return list[Math.floor(rand() * list.length)];
    }

    function randInt(min, max) {
        return min + Math.floor(rand() * (max - min + 1));
    }

    function money(n) {
        return Math.round(Number(n || 0) * 100) / 100;
    }

    function nowIso() {
        return new Date().toISOString();
    }

    function at(dayOffset, hour, minute) {
        var d = new Date();
        d.setDate(d.getDate() + dayOffset);
        d.setHours(hour == null ? 9 : hour, minute || 0, 0, 0);
        return d.toISOString();
    }

    /* ============================== 字典 ============================== */

    var CITY_PROVINCE = {
        '北京': 'BJ', '上海': 'SH', '广州': 'GZ', '深圳': 'SZ', '杭州': 'HZ',
        '南京': 'NJ', '成都': 'CD', '武汉': 'WH', '西安': 'XA', '苏州': 'SU'
    };

    var CITIES = Object.keys(CITY_PROVINCE);

    var ORDER_FLOW = [
        { key: 'pending', label: '待入库' },
        { key: 'inbound', label: '已入库' },
        { key: 'sorted', label: '已分拣' },
        { key: 'shipping', label: '运输中' },
        { key: 'arrived', label: '已到达' },
        { key: 'delivering', label: '派送中' },
        { key: 'signed', label: '已签收' }
    ];

    var STATUS_LABELS = {
        order: {
            pending: '待入库', inbound: '已入库', sorted: '已分拣', shipping: '运输中',
            arrived: '已到达', delivering: '派送中', signed: '已签收', cancelled: '已取消'
        },
        exception: { pending: '待处理', processing: '处理中', resolved: '已解决', closed: '已关闭' },
        transport: { pending: '待发车', shipping: '运输中', arrived: '已到达', delivering: '派送中', completed: '已完成', cancelled: '已取消' },
        task: { pending: '待处理', processing: '进行中', done: '已完成', cancelled: '已取消' },
        ticket: { pending: '待受理', processing: '处理中', resolved: '已解决', closed: '已关闭' },
        claim: { pending: '待审核', processing: '审核中', approved: '已通过', rejected: '已驳回', paid: '已赔付' },
        finance: { pending: '待结算', settled: '已结算', void: '已作废' },
        employee: { active: '在职', on_leave: '休假', resigned: '离职' },
        vehicle: { online: '在线', transporting: '运输中', maintenance: '维修中', offline: '离线' },
        inventory: { normal: '正常', low: '库存偏低', out: '缺货' },
        capacity: { available: '可用', busy: '满载', expired: '已失效' },
        policy: { active: '生效中', suspended: '已暂停', expired: '已失效' },
        gateway: { active: '启用', inactive: '停用' },
        receivable: { unpaid: '未回款', partial: '部分回款', paid: '已回款', overdue: '已逾期', void: '已作废' },
        bill: { draft: '草稿', confirmed: '已确认', settled: '已结清', disputed: '争议中' },
        payable: { pending: '待结算', settled: '已结算' },
        rate: { active: '生效中', inactive: '已停用' },
        route: { active: '启用', inactive: '停用' }
    };

    var CUSTOMERS = ['杭州云帆电商', '上海优选商贸', '北京恒通科技', '广州南粤百货', '深圳蓝海数码',
        '南京金陵食品', '成都天府家居', '武汉长江医药', '西安丝路文化', '苏州锦绣纺织'];

    var GOODS = ['服装鞋帽', '电子数码', '日用百货', '图书文具', '食品饮料',
        '医疗器械', '家居配件', '汽车配件', '美妆个护', '办公设备'];

    var CARRIERS = ['顺丰物流', '中通快递', '申通快递', '圆通速递', '德邦物流', '京东物流'];

    var NAMES = ['张三', '李四', '王五', '赵六', '孙七', '周八', '吴九', '郑十',
        '陈晨', '刘洋', '黄磊', '林静', '何军', '高敏', '罗强', '梁雪',
        '谢峰', '韩梅', '唐杰', '冯丽', '邓超', '曹阳', '彭飞', '许娜'];

    var DEPARTMENTS = [
        { id: 'dept-1', name: '总部', parentId: '', description: '公司总部' },
        { id: 'dept-2', name: '运营部', parentId: 'dept-1', description: '负责公司运营管理' },
        { id: 'dept-3', name: '客服部', parentId: 'dept-1', description: '负责客户服务' },
        { id: 'dept-4', name: '仓储部', parentId: 'dept-1', description: '负责仓储管理' },
        { id: 'dept-5', name: '运输部', parentId: 'dept-1', description: '负责运输管理' },
        { id: 'dept-6', name: '财务部', parentId: 'dept-1', description: '负责财务管理' },
        { id: 'dept-7', name: '人事部', parentId: 'dept-1', description: '负责人事管理' }
    ];

    var PERMISSIONS = [
        { id: 'perm-1', code: 'user:manage', name: '用户管理', description: '管理系统用户' },
        { id: 'perm-2', code: 'role:manage', name: '角色管理', description: '管理系统角色' },
        { id: 'perm-3', code: 'permission:manage', name: '权限管理', description: '管理系统权限' },
        { id: 'perm-4', code: 'department:manage', name: '部门管理', description: '管理公司部门' },
        { id: 'perm-5', code: 'order:manage', name: '订单管理', description: '管理系统订单' },
        { id: 'perm-6', code: 'fence:manage', name: '围栏管理', description: '管理电子围栏' },
        { id: 'perm-7', code: 'vehicle:manage', name: '车辆管理', description: '管理公司车辆' },
        { id: 'perm-8', code: 'warehouse:manage', name: '仓储管理', description: '管理仓储信息' },
        { id: 'perm-9', code: 'finance:manage', name: '财务管理', description: '管理费用与结算' },
        { id: 'perm-10', code: 'exception:manage', name: '异常管理', description: '处理运输异常' }
    ];

    var ROLES = [
        { id: 'role-1', name: '系统管理员', description: '拥有系统所有权限', permissions: PERMISSIONS.map(function (p) { return p.id; }) },
        { id: 'role-2', name: '运营管理员', description: '负责运营与订单管理', permissions: ['perm-1', 'perm-5', 'perm-6', 'perm-10'] },
        { id: 'role-3', name: '客服专员', description: '负责客户服务与工单', permissions: ['perm-5', 'perm-10'] },
        { id: 'role-4', name: '仓储管理员', description: '负责仓储与库存', permissions: ['perm-4', 'perm-8'] },
        { id: 'role-5', name: '派送员', description: '负责货物派送', permissions: [] },
        { id: 'role-6', name: '财务专员', description: '负责财务结算', permissions: ['perm-9'] }
    ];

    var AREAS = [
        { id: 'area-1', name: '北京朝阳区' }, { id: 'area-2', name: '北京海淀区' },
        { id: 'area-3', name: '上海浦东新区' }, { id: 'area-4', name: '上海闵行区' },
        { id: 'area-5', name: '广州天河区' }, { id: 'area-6', name: '深圳南山区' },
        { id: 'area-7', name: '杭州西湖区' }, { id: 'area-8', name: '南京鼓楼区' }
    ];

    // 偏远/超区城市：收取偏远附加费
    var REMOTE_CITIES = ['西安', '成都', '武汉'];

    // 服务等级 / 付款方式
    var SERVICE_LEVELS = ['标准', '加急', '经济', '冷链'];
    var PAYMENT_METHODS = ['现付', '到付', '月结'];

    // 客户分层与协议折扣（月结大客户享受协议价与账期）
    var CUSTOMER_LEVELS = {
        '杭州云帆电商': { level: 'KA', discount: 0.12, settleCycle: 30 },
        '上海优选商贸': { level: 'KA', discount: 0.10, settleCycle: 30 },
        '北京恒通科技': { level: 'A', discount: 0.06, settleCycle: 45 },
        '广州南粤百货': { level: 'A', discount: 0.06, settleCycle: 30 },
        '深圳蓝海数码': { level: 'B', discount: 0.03, settleCycle: 30 },
        '南京金陵食品': { level: 'B', discount: 0.03, settleCycle: 30 },
        '成都天府家居': { level: 'B', discount: 0.02, settleCycle: 60 },
        '武汉长江医药': { level: 'A', discount: 0.05, settleCycle: 45 },
        '西安丝路文化': { level: 'C', discount: 0, settleCycle: 30 },
        '苏州锦绣纺织': { level: 'C', discount: 0, settleCycle: 30 }
    };

    // 轨迹节点字典（比状态更细，带标准时限 stdHours）
    var TRACE_NODES = [
        { code: 'GOT', name: '揽收', stdHours: 4 },
        { code: 'INBOUND', name: '入库', stdHours: 6 },
        { code: 'SORTING', name: '分拣', stdHours: 8 },
        { code: 'LOADING', name: '装车', stdHours: 4 },
        { code: 'DEPARTURE', name: '发车', stdHours: 2 },
        { code: 'TRANSIT', name: '干线在途', stdHours: 24 },
        { code: 'ARRIVED', name: '到达', stdHours: 6 },
        { code: 'DELIVERING', name: '派送', stdHours: 12 },
        { code: 'SIGNED', name: '签收', stdHours: 0 },
        { code: 'RETURNED', name: '退回', stdHours: 0 },
        { code: 'INTERCEPT', name: '拦截', stdHours: 0 },
        { code: 'OVERAREA', name: '超区', stdHours: 0 },
        { code: 'PROBLEM', name: '问题件', stdHours: 0 }
    ];
    var TRACE_NODE_MAP = {};
    TRACE_NODES.forEach(function (n) { TRACE_NODE_MAP[n.code] = n; });
    // 订单阶段索引 → 轨迹节点
    var STAGE_NODE = ['GOT', 'INBOUND', 'SORTING', 'DEPARTURE', 'ARRIVED', 'DELIVERING', 'SIGNED'];

    /* ============================== 初始化 ============================== */

    var db = null;
    var listeners = [];

    function readDb() {
        try {
            var raw = localStorage.getItem(DB_KEY);
            if (!raw) return null;
            var parsed = JSON.parse(raw);
            if (!parsed || parsed.version !== DB_VERSION) return null;
            return parsed;
        } catch (e) {
            return null;
        }
    }

    function persist() {
        localStorage.setItem(DB_KEY, JSON.stringify(db));
        emit();
    }

    function emit() {
        try {
            document.dispatchEvent(new CustomEvent('tms:datachange', { detail: { at: Date.now() } }));
        } catch (e) { /* 忽略浏览器差异 */ }
        listeners.forEach(function (fn) {
            try { fn(db); } catch (e) { console.error('[TmsStore] listener error', e); }
        });
    }

    function counterNext(entity, prefix) {
        var ymd = dateKey(new Date()).replace(/-/g, '');
        db.meta.counters[entity] = (db.meta.counters[entity] || 0) + 1;
        return prefix + '-' + ymd + pad(db.meta.counters[entity], 3);
    }

    function buildOrderId(origin, customer, timestamp, seq) {
        var code = CITY_PROVINCE[origin] || 'XX';
        var userHash = pad(hash(customer) % 10000, 4);
        var random = pad((hash(customer + origin + seq) % 10000), 4);
        return 'HL' + code + timestamp + userHash + random;
    }

    function buildWaybill(orderId) {
        return 'WB' + pad(hash(orderId) % 10000000000, 10).slice(0, 10) + pad((hash(orderId + 'wb') % 10000), 4);
    }

    /* ============================== 计费引擎 ============================== */

    // 客户协议折扣（月结大客户在协议价基础上再让 2%）
    function discountRateFor(customer, paymentMethod) {
        var lv = CUSTOMER_LEVELS[customer];
        var rate = lv ? lv.discount : 0;
        if (paymentMethod === '月结' && lv) rate = Math.min(0.2, rate + 0.02);
        return Math.round(rate * 1000) / 1000;
    }

    function settleCycleFor(customer) {
        var lv = CUSTOMER_LEVELS[customer];
        return lv ? lv.settleCycle : 30;
    }

    // 构造运价模板（全国兵底 + 主要干线 × 服务等级）
    function buildRateCards() {
        var cards = [];
        var seq = 0;
        var lanes = [['全国', '全国'], ['北京', '上海'], ['上海', '广州'], ['广州', '深圳'],
            ['杭州', '南京'], ['成都', '武汉'], ['深圳', '北京'], ['西安', '成都'], ['苏州', '上海']];
        var serviceCfg = {
            '标准': { first: 12, cont: 3, ratio: 8000, fuel: 0.10, min: 15, remote: 8 },
            '加急': { first: 18, cont: 5, ratio: 6000, fuel: 0.15, min: 25, remote: 12 },
            '经济': { first: 9, cont: 2, ratio: 10000, fuel: 0.08, min: 12, remote: 6 },
            '冷链': { first: 25, cont: 7, ratio: 6000, fuel: 0.18, min: 40, remote: 15 }
        };
        lanes.forEach(function (lane) {
            var isNational = lane[0] === '全国';
            SERVICE_LEVELS.forEach(function (svc) {
                var cfg = serviceCfg[svc];
                var factor = isNational ? 1 : 1.15;
                seq++;
                cards.push({
                    id: 'RC-' + pad(seq, 3),
                    name: lane[0] + '→' + lane[1] + ' · ' + svc + '价',
                    origin: lane[0], destination: lane[1], service: svc,
                    firstWeight: 1, firstPrice: money(cfg.first * factor),
                    continueUnit: 1, continuePrice: money(cfg.cont * factor),
                    throwRatio: cfg.ratio, fuelRate: cfg.fuel, minimum: money(cfg.min * factor),
                    remoteFee: money(cfg.remote), insuredRate: 0.006, codRate: 0.03,
                    status: 'active', updatedAt: at(-1, 10, 0)
                });
            });
        });
        return cards;
    }

    // 选最匹配的运价卡：精确线路+服务 > 精确线路(标准) > 全国+服务 > 全国+标准
    function pickRateCard(cards, origin, destination, service) {
        service = service || '标准';
        function find(o, d, s) {
            for (var i = 0; i < cards.length; i++) {
                if (cards[i].origin === o && cards[i].destination === d && cards[i].service === s) return cards[i];
            }
            return null;
        }
        return find(origin, destination, service)
            || find(origin, destination, '标准')
            || find('全国', '全国', service)
            || find('全国', '全国', '标准')
            || cards[0];
    }

    /**
     * 计费试算核心：输入计费要素，输出完整费用明细
     * @param {object} params {origin,destination,service,weight,volume,dims,declaredValue,isInsured,paymentMethod,customer}
     * @param {Array} [cards] 指定运价卡（种子内传入局部数组，运行时默认 db.rateCards）
     */
    function calcFreight(params, cards) {
        var list = cards || (db && db.rateCards) || [];
        var origin = params.origin || '全国';
        var destination = params.destination || '全国';
        var service = params.service || '标准';
        var weight = Number(params.weight) || 0;
        var card = pickRateCard(list, origin, destination, service) || {};
        var ratio = Number(card.throwRatio) || 8000;
        var firstWeight = Number(card.firstWeight) || 1;

        // 体积重：优先用尺寸(LxWxH cm)，否则用体积(m3)
        var volumetric = 0;
        if (params.dims) {
            var parts = String(params.dims).toLowerCase().split(/[x*×]/);
            if (parts.length === 3) volumetric = (Number(parts[0]) * Number(parts[1]) * Number(parts[2])) / ratio;
        }
        if (!volumetric && Number(params.volume)) volumetric = (Number(params.volume) * 1000000) / ratio;
        volumetric = money(volumetric);

        var chargeable = Math.max(weight, volumetric, firstWeight);

        var firstFee = money(card.firstPrice || 0);
        var continueFee = 0;
        if (chargeable > firstWeight) {
            var steps = Math.ceil((chargeable - firstWeight) / (Number(card.continueUnit) || 1));
            continueFee = money(steps * (Number(card.continuePrice) || 0));
        }
        var base = firstFee + continueFee;
        var minimumApplied = false;
        if (base < (Number(card.minimum) || 0)) { base = Number(card.minimum); minimumApplied = true; }
        base = money(base);

        var fuelFee = money(base * (Number(card.fuelRate) || 0));
        var remoteFee = REMOTE_CITIES.indexOf(destination) > -1 ? money(card.remoteFee || 0) : 0;
        var insured = params.isInsured || Number(params.declaredValue) > 0;
        var insuredFee = insured ? money((Number(params.declaredValue) || 0) * (Number(card.insuredRate) || 0)) : 0;
        var codFee = params.paymentMethod === '到付' ? money(base * (Number(card.codRate) || 0.03)) : 0;

        var subtotal = money(base + fuelFee + remoteFee + insuredFee + codFee);
        var discountRate = discountRateFor(params.customer, params.paymentMethod);
        var discount = money(subtotal * discountRate);
        var total = money(subtotal - discount);

        return {
            cardId: card.id || '', cardName: card.name || '', service: service,
            actualWeight: money(weight), volumetricWeight: volumetric, chargeableWeight: money(chargeable),
            firstFee: firstFee, continueFee: continueFee, minimumApplied: minimumApplied,
            fuelFee: fuelFee, remoteFee: remoteFee, insuredFee: insuredFee, codFee: codFee,
            discountRate: discountRate, discount: discount, total: total,
            breakdown: { 首重: firstFee, 续重: continueFee, 燃油: fuelFee, 偏远: remoteFee, 保价: insuredFee, 到付: codFee, 折扣: -discount }
        };
    }

    /* ============================== 路由与轨迹 ============================== */

    // 构造多段路由（含全国兵底线路）
    function buildRoutes() {
        var defs = [
            ['北京', '上海', '高', '陆运'], ['上海', '广州', '高', '空运'], ['广州', '深圳', '中', '陆运'],
            ['杭州', '南京', '中', '陆运'], ['成都', '武汉', '低', '陆运'], ['深圳', '北京', '高', '空运'],
            ['西安', '成都', '低', '陆运'], ['苏州', '上海', '中', '陆运'], ['全国', '全国', '中', '陆运']
        ];
        var trunkMap = { '陆运': 24, '空运': 12 };
        return defs.map(function (d, i) {
            var isNation = d[0] === '全国';
            var mode = d[3];
            var trunk = trunkMap[mode] || 24;
            var segments = isNation ? [
                { seq: 1, from: '揽收网点', to: '始发分拨', mode: '陆运', stdHours: 6 },
                { seq: 2, from: '始发分拨', to: '目的分拨', mode: mode, stdHours: trunk },
                { seq: 3, from: '目的分拨', to: '派送网点', mode: '陆运', stdHours: 12 }
            ] : [
                { seq: 1, from: d[0], to: d[0] + '分拨中心', mode: '陆运', stdHours: 6 },
                { seq: 2, from: d[0] + '分拨中心', to: d[1] + '分拨中心', mode: mode, stdHours: trunk },
                { seq: 3, from: d[1] + '分拨中心', to: d[1] + '网点', mode: '陆运', stdHours: 8 },
                { seq: 4, from: d[1] + '网点', to: '签收', mode: '陆运', stdHours: 12 }
            ];
            var total = segments.reduce(function (s, x) { return s + x.stdHours; }, 0);
            return {
                id: 'ROUTE-' + pad(i + 1, 3), origin: d[0], destination: d[1], mode: mode, priority: d[2],
                segments: segments, totalStdHours: total, status: 'active', deviationCount: 0
            };
        });
    }

    function findRoute(database, origin, destination) {
        var list = (database || db).routes || [];
        for (var i = 0; i < list.length; i++) {
            if (list[i].origin === origin && list[i].destination === destination) return list[i];
        }
        for (var j = 0; j < list.length; j++) { if (list[j].origin === '全国') return list[j]; }
        return list[0] || null;
    }

    // 按起终点匹配路由，写入 planSegments 与逐段 deadline
    function planRoute(order, database) {
        var route = findRoute(database, order.origin, order.destination);
        if (!route) return;
        order.routeId = route.id;
        var start = new Date(order.createdAt).getTime();
        var acc = 0;
        order.planSegments = route.segments.map(function (s) {
            acc += s.stdHours;
            return {
                seq: s.seq, from: s.from, to: s.to, mode: s.mode, stdHours: s.stdHours,
                deadline: new Date(start + acc * 3600000).toISOString()
            };
        });
    }

    // 根据订单阶段 progression 生成轨迹明细（带节点、地点、超时/偏差标记）
    function buildTraces(order, progression, statusIndex, rng) {
        var traces = [];
        var scanLocs = [order.origin + '揽收点', order.origin + '分拨中心', order.origin + '分拨中心',
            order.origin + '→' + order.destination, order.destination + '中转', order.destination + '网点', order.receiverAddress];
        for (var i = 0; i <= statusIndex && i < STAGE_NODE.length; i++) {
            var node = TRACE_NODE_MAP[STAGE_NODE[i]] || { name: '节点', stdHours: 0 };
            var opTime = progression[i] || order.createdAt;
            var deadline = new Date(new Date(opTime).getTime() + (node.stdHours || 24) * 3600000).toISOString();
            var overtime = i > 0 && i < 6 && statusIndex < 6 && rng() < 0.14;
            var deviant = i >= 2 && i <= 4 && statusIndex >= 3 && statusIndex < 6 && rng() < 0.07;
            traces.push({
                node: STAGE_NODE[i], nodeName: node.name, code: STAGE_NODE[i],
                location: scanLocs[i], opTime: opTime, deadline: deadline,
                isOvertime: overtime, isDeviant: deviant
            });
        }
        return traces;
    }

    /* ============================== 种子数据 ============================== */

    function seed() {
        rand = mulberry32(20260122);

        var transport = [];
        var sorting = [];
        var loading = [];
        var scans = [];
        var exceptions = [];
        var finances = [];
        var tickets = [];
        var claims = [];
        var orders = [];
        var receivables = [];
        var payables = [];
        var bills = [];
        var rateCards = buildRateCards();
        var routes = buildRoutes();
        var tracePool = []; // 汇总全部轨迹（供轨迹中心检索）

        // 员工
        var employees = NAMES.slice(0, 20).map(function (name, i) {
            var dept = DEPARTMENTS[2 + (i % 5)];
            var status = i === 17 ? 'on_leave' : (i === 19 ? 'resigned' : 'active');
            return {
                id: 'EMP-' + pad(i + 1, 3),
                name: name,
                department: dept.name,
                position: ['运营专员', '客服专员', '仓储管理员', '运输调度', '财务专员', '人事专员'][i % 6],
                email: 'emp' + (i + 1) + '@tms.com',
                phone: '138' + pad(10000000 + i * 1379, 8).slice(-8),
                hireDate: '202' + (3 + (i % 3)) + '-' + pad((i % 12) + 1) + '-' + pad((i % 27) + 1),
                status: status,
                salary: 6500 + (i % 6) * 900
            };
        });

        // 车辆
        var vehicles = [];
        var platePrefix = ['京A', '沪B', '粤A', '粤B', '浙A', '苏A'];
        for (var v = 0; v < 14; v++) {
            var vStatus = v < 7 ? 'transporting' : (v < 10 ? 'online' : (v < 12 ? 'maintenance' : 'offline'));
            vehicles.push({
                id: 'VEH-' + pad(v + 1, 3),
                plate: platePrefix[v % platePrefix.length] + pad(12000 + v * 731, 5),
                type: ['卡车', '厢货', '集装箱', '冷链车'][v % 4],
                model: ['解放J6P', '依维柯', '东风天龙', '福田欧曼', '江淮格尔发'][v % 5],
                driver: NAMES[v % NAMES.length],
                branch: CITY_PROVINCE ? CITIES[v % CITIES.length] + '网点' : '总部网点',
                status: vStatus,
                location: CITIES[v % CITIES.length] + '-' + ['朝阳', '浦东', '天河', '南山', '西湖', '鼓楼'][v % 6],
                capacityTon: [5, 8, 12, 20][v % 4],
                mileage: 30000 + v * 4213,
                lastUpdate: at(0, 8 + (v % 10), (v * 7) % 60)
            });
        }

        // 仓库 / 库存
        var warehouseNames = ['北京中心仓', '上海分拨仓', '广州前置仓', '成都区域仓'];
        var inventory = [];
        var materialNames = ['纸箱', '气泡膜', '封箱胶带', '打印面单', '缠绕膜', '托盘', '编织袋', '标签纸',
            '一次性手套', '扫描枪电池', '马克笔', '文件袋'];
        for (var m = 0; m < 12; m++) {
            var stock = randInt(80, 900);
            var safety = randInt(100, 300);
            inventory.push({
                id: 'INV-' + pad(m + 1, 3),
                name: materialNames[m],
                spec: ['中号 400×300×250mm', '50cm×100m', '48mm×100m', '100×150mm', '30cm×300m', '1200×1000mm'][m % 6],
                warehouse: warehouseNames[m % warehouseNames.length],
                location: ['A区-01', 'A区-02', 'B区-03', 'B区-04', 'C区-01', 'C区-02'][m % 6],
                stock: stock,
                safetyStock: safety,
                unit: ['个', '卷', '卷', '卷', '卷', '个'][m % 6],
                status: stock < safety ? 'low' : 'normal',
                updatedAt: at(-(m % 5), 10, (m * 11) % 60)
            });
        }

        var warehouses = warehouseNames.map(function (name, i) {
            return {
                id: 'WH-' + pad(i + 1, 2),
                name: name,
                city: CITIES[i * 2 % CITIES.length],
                manager: NAMES[i],
                area: 3000 + i * 1200,
                usedRate: 55 + i * 9,
                inboundToday: randInt(40, 160),
                outboundToday: randInt(30, 140),
                status: i === 3 ? 'busy' : 'normal'
            };
        });

        // 运力资源
        var capacities = [];
        for (var c = 0; c < 12; c++) {
            var total = [20, 40, 60, 100][c % 4];
            var remain = randInt(2, total);
            capacities.push({
                id: 'CAP-' + pad(c + 1, 3),
                type: ['自有车辆', '外协车辆', '临时仓', '航空仓位'][c % 4],
                name: CITIES[c % CITIES.length] + '线路运力',
                supplier: CARRIERS[c % CARRIERS.length],
                capacity: total,
                remaining: remain,
                status: remain < total * 0.15 ? 'busy' : 'available',
                validUntil: dateKey(new Date(Date.now() + (c + 2) * 86400000 * 15))
            });
        }

        // 电子围栏
        var fenceCenters = [
            ['北京中心仓围栏', 116.407, 39.904, 3000], ['上海浦东分拨围栏', 121.544, 31.221, 2500],
            ['广州天河网点围栏', 113.361, 23.124, 2000], ['深圳南山网点围栏', 113.930, 22.533, 1800],
            ['杭州西湖网点围栏', 120.130, 30.259, 2200], ['成都区域仓围栏', 104.066, 30.572, 2600],
            ['武汉中转场围栏', 114.305, 30.593, 2400], ['西安丝路仓围栏', 108.948, 34.263, 2000]
        ];
        var geofences = fenceCenters.map(function (f, i) {
            return {
                id: 'GF-' + pad(i + 1, 3),
                name: f[0],
                type: i % 3 === 0 ? '仓储围栏' : (i % 3 === 1 ? '网点围栏' : '禁行区域'),
                lng: f[1],
                lat: f[2],
                radius: f[3],
                status: i === 7 ? 'inactive' : 'active',
                createdAt: at(-30 + i, 9, 0)
            };
        });

        // 运营策略 / 路由规则 / 派送地址 / 时效规则 / 改单记录 / 考核指标
        var policies = [
            ['大客户优先派送', '大客户订单', '优先分配运力并插队分拣'],
            ['夜间揽收激励', '全部网点', '20:00 后揽收订单补贴 0.5 元/票'],
            ['异常订单自动升级', '全部订单', '超时 4 小时未处理升级至运营主管'],
            ['生鲜冷链时效保障', '冷链订单', '优先装载，全程温控监控'],
            ['偏远地区加价', '偏远区域', '按距离阶梯收取附加运费'],
            ['退货逆向物流', '售后退货', '48 小时内完成逆向揽收'],
            ['高峰期运力预警', '双十一/618', '运力使用率超 85% 触发预警'],
            ['签收率考核', '派送员', '月签收率低于 95% 触发考核']
        ].map(function (p, i) {
            return {
                id: 'POL-' + pad(i + 1, 3),
                name: p[0], scope: p[1], content: p[2],
                startAt: at(-60 + i * 5, 0, 0),
                endAt: at(120 + i * 10, 23, 59),
                status: i === 5 ? 'suspended' : 'active',
                updatedAt: at(-(i % 7), 14, 0)
            };
        });

        var routingRules = [
            ['北京', '上海', '高', '陆运', '24小时'],
            ['上海', '广州', '高', '空运', '12小时'],
            ['广州', '深圳', '中', '陆运', '8小时'],
            ['杭州', '南京', '中', '陆运', '10小时'],
            ['成都', '武汉', '低', '陆运', '36小时'],
            ['深圳', '北京', '高', '空运', '14小时'],
            ['西安', '成都', '低', '陆运', '30小时'],
            ['苏州', '上海', '中', '陆运', '6小时']
        ].map(function (r, i) {
            return {
                id: 'RUL-' + pad(i + 1, 3),
                origin: r[0], destination: r[1], priority: r[2],
                mode: r[3], duration: r[4], status: 'active',
                updatedAt: at(-(i % 9), 11, 0)
            };
        });

        var addresses = [];
        for (var a = 0; a < 10; a++) {
            addresses.push({
                id: 'ADDR-' + pad(a + 1, 3),
                detail: CITIES[a % CITIES.length] + '市' + ['朝阳区建国路 88 号', '浦东新区张江路 100 号', '天河区体育西路 12 号',
                    '南山区科技园路 6 号', '西湖区文三路 90 号', '鼓楼区中山北路 45 号'][a % 6],
                area: CITIES[a % CITIES.length] + '-' + ['朝阳', '浦东', '天河', '南山', '西湖', '鼓楼'][a % 6],
                manager: NAMES[a],
                status: a === 8 ? 'inactive' : 'active',
                audit: a < 7 ? 'approved' : 'pending',
                createdAt: at(-20 + a, 10, 0)
            });
        }

        var timingRules = routingRules.map(function (r, i) {
            return {
                id: 'TMR-' + pad(i + 1, 3),
                route: r.origin + ' → ' + r.destination,
                mode: r.mode,
                standard: r.duration,
                priority: r.priority,
                status: i === 6 ? 'inactive' : 'active'
            };
        });

        var changeRecords = [];
        for (var ch = 0; ch < 8; ch++) {
            changeRecords.push({
                id: 'CHG-' + pad(ch + 1, 3),
                orderId: 'HL' + CITY_PROVINCE[CITIES[ch % CITIES.length]] + '202601' + pad(10 + ch, 2) + '000000000' + pad(ch + 1, 2),
                reason: ['客户修改收货地址', '客户要求改约时间', '货物信息录入错误', '运费结算方式调整'][ch % 4],
                content: ['收货地址由朝阳区改为海淀区', '派送时间延后 1 天', '重量由 3kg 修正为 5kg', '由到付改为月结'][ch % 4],
                operator: NAMES[ch],
                operatedAt: at(-(ch + 1), 15, (ch * 13) % 60)
            });
        }

        var evalMetrics = [
            ['签收率', '≥ 95%', 30], ['准时率', '≥ 90%', 25], ['异常处理时效', '≤ 4 小时', 15],
            ['客户满意度', '≥ 4.5 分', 15], ['扫描完整率', '≥ 98%', 10], ['投诉率', '≤ 1%', 5]
        ].map(function (e, i) {
            return {
                id: 'KPI-' + pad(i + 1, 2),
                name: e[0], target: e[1], weight: e[2],
                period: '月度', status: i === 5 ? 'inactive' : 'active'
            };
        });

        // 订单主数据
        var orderSeq = 0;
        for (var day = -13; day <= 0; day++) {
            var count = day === 0 ? 8 : randInt(5, 7);
            for (var k = 0; k < count; k++) {
                orderSeq++;
                var origin = pick(CITIES);
                var destination = pick(CITIES.filter(function (x) { return x !== origin; }));
                var customer = pick(CUSTOMERS);
                var goods = pick(GOODS);
                var createdHour = randInt(7, 20);
                var createdAt = at(day, createdHour, randInt(0, 59));
                var weight = randInt(5, 200) / 10;
                var pieces = randInt(1, 6);
                var service = pick(SERVICE_LEVELS);
                var lv = CUSTOMER_LEVELS[customer];
                var paymentMethod = (lv && (lv.level === 'KA' || lv.level === 'A')) ? '月结' : pick(PAYMENT_METHODS);
                var dimL = randInt(20, 60), dimW = randInt(20, 50), dimH = randInt(10, 40);
                var dims = dimL + 'x' + dimW + 'x' + dimH;
                var declared = rand() < 0.35 ? randInt(5, 60) * 100 : 0;
                var orderId = buildOrderId(origin, customer, new Date(createdAt).getTime(), orderSeq);
                var waybillNo = buildWaybill(orderId);
                var charge = calcFreight({
                    origin: origin, destination: destination, service: service, weight: weight,
                    dims: dims, declaredValue: declared, isInsured: declared > 0,
                    paymentMethod: paymentMethod, customer: customer
                }, rateCards);
                var amount = charge.total;

                var expectedAt = new Date(createdAt);
                expectedAt.setDate(expectedAt.getDate() + randInt(1, 3));
                expectedAt.setHours(18, 0, 0, 0);

                var statusIndex;
                if (day <= -5) statusIndex = rand() < 0.9 ? 6 : (rand() < 0.5 ? 4 : 5);
                else if (day <= -2) statusIndex = rand() < 0.6 ? 6 : (rand() < 0.5 ? 5 : 4);
                else if (day === -1) statusIndex = [6, 5, 4, 3, 2][Math.floor(rand() * 5)];
                else statusIndex = [0, 1, 2, 3, 4][Math.floor(rand() * 5)];

                var cancelled = day < -3 && rand() < 0.05;
                var progression = [createdAt];
                var stageHours = [2, 8, 14, 30, 32, 36];
                for (var s = 0; s < 6; s++) {
                    var t = new Date(progression[s]);
                    t.setHours(t.getHours() + stageHours[s] + randInt(0, 3));
                    progression.push(t.toISOString());
                }

                var timeline = [{ status: 'pending', label: '订单创建', time: createdAt, actor: '客户' }];
                for (var ti = 1; ti <= statusIndex; ti++) {
                    timeline.push({
                        status: ORDER_FLOW[ti].key,
                        label: ORDER_FLOW[ti].label,
                        time: progression[ti],
                        actor: ti >= 3 ? '运输调度' : '仓内作业'
                    });
                }

                var signedAt = statusIndex === 6 ? progression[6] : '';
                var order = {
                    id: orderId,
                    waybillNo: waybillNo,
                    customer: customer,
                    contact: NAMES[orderSeq % NAMES.length],
                    phone: '13' + pad(randInt(100000000, 999999999), 9).slice(0, 9),
                    goods: goods,
                    weight: weight,
                    pieces: pieces,
                    service: service,
                    orderType: 'forward',
                    dims: dims,
                    volume: money(dimL * dimW * dimH / 1000000),
                    volumetricWeight: charge.volumetricWeight,
                    chargeableWeight: charge.chargeableWeight,
                    declaredValue: declared,
                    isInsured: declared > 0,
                    paymentMethod: paymentMethod,
                    settleCycle: settleCycleFor(customer),
                    freight: amount,
                    freightBreakdown: charge,
                    rateCardId: charge.cardId,
                    origin: origin,
                    destination: destination,
                    senderAddress: origin + '市' + ['朝阳区', '浦东新区', '天河区', '南山区', '西湖区', '鼓楼区'][orderSeq % 6] + '物流园 ' + randInt(1, 30) + ' 号',
                    receiverAddress: destination + '市' + ['朝阳区', '浦东新区', '天河区', '南山区', '西湖区', '鼓楼区'][(orderSeq + 2) % 6] + '收货路 ' + randInt(1, 100) + ' 号',
                    status: cancelled ? 'cancelled' : ORDER_FLOW[statusIndex].key,
                    createdAt: createdAt,
                    expectedAt: expectedAt.toISOString(),
                    signedAt: signedAt,
                    updatedAt: timeline[timeline.length - 1].time,
                    timeline: timeline,
                    remark: '',
                    receivableStatus: '',
                    routeId: '',
                    planSegments: [],
                    traces: [],
                    slaDeadline: expectedAt.toISOString()
                };
                // 路由计划 + 轨迹明细（取消件不生成）
                if (!cancelled) {
                    planRoute(order, { routes: routes });
                    order.traces = buildTraces(order, progression, statusIndex, rand);
                    order.traces.forEach(function (tr) {
                        tracePool.push({
                            id: 'TRC-S' + pad(tracePool.length + 1, 5),
                            orderId: orderId, waybillNo: waybillNo, customer: customer,
                            origin: origin, destination: destination, status: ORDER_FLOW[statusIndex].key,
                            node: tr.node, nodeName: tr.nodeName, location: tr.location,
                            opTime: tr.opTime, deadline: tr.deadline, isOvertime: tr.isOvertime, isDeviant: tr.isDeviant
                        });
                    });
                }
                orders.push(order);

                if (cancelled) continue;

                // 分拣任务
                sorting.push({
                    id: counterSeed('sorting', 'SRT', orderSeq),
                    orderId: orderId,
                    waybillNo: waybillNo,
                    origin: origin,
                    destination: destination,
                    center: origin + '分拨中心',
                    sorter: NAMES[orderSeq % 10],
                    planAt: progression[1],
                    status: statusIndex >= 2 ? 'done' : (statusIndex === 1 ? 'processing' : 'pending'),
                    missed: statusIndex >= 2 && rand() < 0.12,
                    completedAt: statusIndex >= 2 ? progression[2] : ''
                });

                // 装卸任务
                if (statusIndex >= 2) {
                    loading.push({
                        id: counterSeed('loading', 'LOD', orderSeq),
                        orderId: orderId,
                        waybillNo: waybillNo,
                        type: statusIndex >= 3 ? '装车' : '卸车',
                        place: origin + '分拨中心',
                        vehicleId: vehicles[orderSeq % vehicles.length].id,
                        workers: NAMES[(orderSeq + 3) % NAMES.length] + '、' + NAMES[(orderSeq + 5) % NAMES.length],
                        planAt: progression[2],
                        startAt: statusIndex >= 3 ? progression[3] : '',
                        tons: weight / 1000,
                        equipment: '叉车',
                        status: statusIndex >= 3 ? 'done' : 'processing'
                    });
                }

                // 扫描记录
                var scanTypes = ['入库扫描', '分拣扫描', '出库扫描', '到达扫描', '派送扫描', '签收扫描'];
                for (var si = 1; si <= statusIndex; si++) {
                    scans.push({
                        id: counterSeed('scans', 'SC', orderSeq * 10 + si),
                        scannedAt: progression[si],
                        orderId: orderId,
                        waybillNo: waybillNo,
                        type: scanTypes[si - 1],
                        location: si <= 3 ? origin + '分拨中心' : destination + '网点',
                        device: 'PDA-' + pad((orderSeq % 20) + 1, 2),
                        operator: NAMES[(orderSeq + si) % NAMES.length]
                    });
                }

                // 运输任务
                if (statusIndex >= 3) {
                    var trStatus = statusIndex === 6 ? 'completed' : (statusIndex === 5 ? 'delivering' : (statusIndex === 4 ? 'arrived' : 'shipping'));
                    var carrierName = CARRIERS[orderSeq % CARRIERS.length];
                    transport.push({
                        id: counterSeed('transports', 'TR', orderSeq),
                        orderId: orderId,
                        waybillNo: waybillNo,
                        origin: origin,
                        destination: destination,
                        carrier: carrierName,
                        vehicleId: vehicles[orderSeq % vehicles.length].id,
                        driver: vehicles[orderSeq % vehicles.length].driver,
                        departAt: progression[3],
                        eta: expectedAt.toISOString(),
                        arrivedAt: statusIndex >= 4 ? progression[4] : '',
                        status: trStatus,
                        progress: statusIndex === 6 ? 100 : randInt(30, 90)
                    });
                    // 成本应付：向承运商结算干线运费（按收入约 60% 估算）
                    var settled = statusIndex === 6 && rand() < 0.7;
                    payables.push({
                        id: counterSeed('payables', 'PAY', orderSeq * 2),
                        target: carrierName, targetType: 'carrier', category: '干线运费',
                        refId: orderId, amount: money(amount * 0.6),
                        period: dateKey(new Date(progression[3])),
                        status: settled ? 'settled' : 'pending',
                        settledAt: settled ? (signedAt || nowIso()) : ''
                    });
                }

                // 异常记录
                if (rand() < 0.22) {
                    var exStatus = day <= -3 ? 'resolved' : (day <= -1 ? (rand() < 0.5 ? 'processing' : 'resolved') : 'pending');
                    var exType = pick(['延迟送达', '货物损坏', '信息不符', '地址错误', '丢件', '拒收']);
                    var exParty = pick(['承运商', '网点', '司机', '仓库', '客户']);
                    var exDeduction = exStatus === 'resolved' && exParty !== '客户' ? money(randInt(50, 600)) : 0;
                    exceptions.push({
                        id: counterSeed('exceptions', 'EX', orderSeq),
                        orderId: orderId,
                        waybillNo: waybillNo,
                        type: exType,
                        description: pick(['运输途中车辆故障导致延误', '外包装破损，内件疑似受损', '收件人信息与订单不一致', '收货地址无法定位', '派送后未找到包裹', '收件人拒绝签收']),
                        occurredAt: progression[Math.min(statusIndex, 5)] || createdAt,
                        status: exStatus,
                        handler: exStatus === 'pending' ? '' : NAMES[orderSeq % 10],
                        resolution: exStatus === 'resolved' ? '已与客户协商完成处理' : '',
                        resolvedAt: exStatus === 'resolved' ? at(day + 1, 16, 0) : '',
                        level: pick(['一级', '二级', '三级']),
                        slaDeadline: new Date(new Date(progression[Math.min(statusIndex, 5)] || createdAt).getTime() + 4 * 3600000).toISOString(),
                        escalated: exStatus !== 'resolved' && rand() < 0.2,
                        responsibleParty: exStatus === 'pending' ? '' : exParty,
                        responsible: exStatus === 'pending' ? '' : NAMES[(orderSeq + 2) % NAMES.length],
                        solution: exStatus === 'resolved' ? pick(['补发', '改派', '理赔', '退回']) : '',
                        rootCause: exStatus === 'resolved' ? pick(['操作不规范', '系统对接异常', '天气原因', '客户原因', '包装不合格']) : '',
                        deductionAmount: exDeduction,
                        linkedClaimId: '',
                        linkedTicketId: '',
                        flow: exStatus === 'pending' ? [] : [
                            { time: progression[Math.min(statusIndex, 5)] || createdAt, actor: '系统', action: '异常上报' },
                            { time: at(day + 1, 10, 0), actor: NAMES[orderSeq % 10], action: '受理并定责：' + exParty }
                        ]
                    });
                    // 定责扣款→生成成本应付
                    if (exDeduction > 0) {
                        payables.push({
                            id: counterSeed('payables', 'PAY', 1000 + orderSeq * 2),
                            target: exParty === '司机' ? vehicles[orderSeq % vehicles.length].driver : exParty,
                            targetType: exParty === '司机' ? 'driver' : (exParty === '承运商' ? 'carrier' : 'branch'),
                            category: '异常扣款', refId: orderId, amount: exDeduction,
                            period: dateKey(new Date(at(day + 1, 16, 0))), status: 'pending', settledAt: ''
                        });
                    }
                }

                // 签收→按付款方式生成应收/流水
                if (statusIndex === 6) {
                    if (paymentMethod === '月结') {
                        // 月结：挂应收，收入待回款才置已结算；较早签收的部分置为逾期以丰富账龄
                        var aged = day <= -6;
                        var dueMs = new Date(signedAt).getTime() + (aged ? randInt(2, 5) * 86400000 : settleCycleFor(customer) * 86400000);
                        var dueDate = new Date(dueMs);
                        var recStatus = dueDate < new Date() ? 'overdue' : (rand() < 0.28 ? 'partial' : 'unpaid');
                        order.receivableStatus = recStatus;
                        receivables.push({
                            id: counterSeed('receivables', 'REC', orderSeq), orderId: orderId, customer: customer, amount: amount,
                            paymentMethod: paymentMethod, settleCycle: settleCycleFor(customer),
                            issuedAt: signedAt, dueDate: dueDate.toISOString(), status: recStatus,
                            billId: '', period: dateKey(new Date(signedAt)).slice(0, 7)
                        });
                        finances.push({
                            id: counterSeed('finances', 'FIN', orderSeq * 2),
                            type: 'income', category: '运费收入（月结）', orderId: orderId,
                            amount: amount, status: 'pending', date: signedAt,
                            remark: customer + ' 月结挂账，待回款'
                        });
                    } else {
                        order.receivableStatus = 'paid';
                        finances.push({
                            id: counterSeed('finances', 'FIN', orderSeq * 2),
                            type: 'income', category: '运费收入',
                            orderId: orderId, amount: amount, status: 'settled',
                            date: signedAt, remark: customer + ' ' + paymentMethod + ' 运费结算'
                        });
                    }
                }
            }
        }

        // 每日固定支出
        for (var f = 0; f < 7; f++) {
            finances.push({
                id: counterSeed('finances', 'FIN', 1000 + f * 2),
                type: 'expense', category: f % 2 === 0 ? '车辆油费' : '人员薪资',
                orderId: '', amount: 1800 + f * 320, status: 'settled',
                date: at(-f, 18, 0), remark: f % 2 === 0 ? '干线车辆加油' : '临时装卸人员工资'
            });
        }

        // 按客户 + 账期聚合生成月度账单，并回写 receivable.billId
        var billGroups = {};
        receivables.forEach(function (r) {
            var key = r.customer + '#' + r.period;
            if (!billGroups[key]) billGroups[key] = { customer: r.customer, period: r.period, rows: [] };
            billGroups[key].rows.push(r);
        });
        var billSeq = 0;
        Object.keys(billGroups).forEach(function (key) {
            var g = billGroups[key];
            billSeq++;
            var total = money(g.rows.reduce(function (s, r) { return s + Number(r.amount); }, 0));
            var paidRows = g.rows.filter(function (r) { return r.status === 'paid'; });
            var overdueRows = g.rows.filter(function (r) { return r.status === 'overdue'; });
            var received = money(paidRows.reduce(function (s, r) { return s + Number(r.amount); }, 0));
            var bStatus = overdueRows.length ? 'disputed' : (received >= total && total > 0 ? 'settled' : (g.rows.some(function (r) { return r.status === 'partial' || r.status === 'paid'; }) ? 'confirmed' : 'draft'));
            var billId = counterSeed('bills', 'BILL', billSeq);
            bills.push({
                id: billId,
                billNo: 'BILL' + g.period.replace('-', '') + pad(billSeq, 3),
                customer: g.customer, period: g.period, itemCount: g.rows.length,
                totalAmount: total, receivedAmount: received, status: bStatus,
                dueDate: g.rows[0].dueDate, createdAt: g.rows[0].issuedAt
            });
            g.rows.forEach(function (r) { r.billId = billId; });
        });

        // 服务工单
        for (var t = 0; t < 15; t++) {
            var refOrder = orders[(t * 5) % orders.length];
            tickets.push({
                id: counterSeed('tickets', 'SV', t + 1),
                orderId: refOrder.id,
                customer: refOrder.customer,
                type: pick(['物流查询', '改派申请', '投诉建议', '延误催件', '理赔咨询']),
                priority: pick(['高', '中', '低']),
                content: pick(['客户咨询包裹当前位置', '客户要求更改派送时间', '客户投诉派送员服务态度', '客户催促尽快送达', '客户咨询理赔流程']),
                status: t < 4 ? 'pending' : (t < 9 ? 'processing' : 'resolved'),
                assignee: t < 4 ? '' : NAMES[t % 8],
                createdAt: at(-(t % 6), 9 + (t % 9), (t * 7) % 60),
                resolvedAt: t >= 9 ? at(-(t % 4), 15, 0) : ''
            });
        }

        // 理赔申请
        for (var cl = 0; cl < 9; cl++) {
            var claimOrder = orders[(cl * 7 + 3) % orders.length];
            claims.push({
                id: counterSeed('claims', 'CLM', cl + 1),
                orderId: claimOrder.id,
                customer: claimOrder.customer,
                type: pick(['货物破损', '货物丢失', '延误赔付', '拒收退回']),
                amount: money(claimOrder.freight * (2 + cl % 4)),
                reason: pick(['外包装破损导致内件损坏', '运输途中包裹丢失', '超过承诺时效 24 小时', '客户拒收要求退回运费']),
                status: cl < 3 ? 'pending' : (cl < 6 ? 'processing' : 'approved'),
                applicant: NAMES[cl],
                createdAt: at(-(cl + 1), 10, 0),
                handledAt: cl >= 6 ? at(-(cl % 3), 16, 0) : ''
            });
        }

        // 行政记录
        var adminRecords = [];
        for (var ar = 0; ar < 12; ar++) {
            adminRecords.push({
                id: counterSeed('adminRecords', 'ADM', ar + 1),
                type: pick(['办公用品采购', '差旅报销', '会议安排', '资产领用', '车辆使用']),
                title: pick(['采购打印纸 50 箱', '华东区出差报销', '月度运营例会', '领用扫描枪 2 台', '总部公务用车申请']),
                applicant: NAMES[ar % NAMES.length],
                department: DEPARTMENTS[2 + (ar % 5)].name,
                amount: ar % 3 === 0 ? 0 : randInt(200, 8000),
                status: ar < 3 ? 'pending' : (ar < 9 ? 'approved' : 'completed'),
                createdAt: at(-(ar % 8), 9 + (ar % 8), 0)
            });
        }

        // 考核与绩效
        var evaluations = [];
        for (var e = 0; e < 12; e++) {
            var score = 68 + randInt(0, 30);
            evaluations.push({
                id: counterSeed('evaluations', 'EV', e + 1),
                period: '2026-10',
                employee: employees[e].name,
                department: employees[e].department,
                position: employees[e].position,
                signRate: 88 + randInt(0, 11),
                onTimeRate: 85 + randInt(0, 14),
                satisfaction: money(4 + rand() * 0.9),
                score: score,
                grade: score >= 90 ? 'A' : (score >= 80 ? 'B' : (score >= 70 ? 'C' : 'D')),
                comment: score >= 90 ? '表现优秀，各项指标领先' : (score >= 80 ? '整体良好，个别指标需提升' : '需加强时效与服务质量')
            });
        }

        var performance = employees.slice(0, 12).map(function (emp, i) {
            var ev = evaluations[i];
            return {
                id: 'PER-' + pad(i + 1, 3),
                employee: emp.name,
                department: emp.department,
                position: emp.position,
                orders: 40 + i * 7,
                signed: 35 + i * 6,
                signRate: ev.signRate,
                exceptionCount: i % 5,
                score: ev.score,
                rank: 0,
                period: '2026-10'
            };
        }).sort(function (a, b) { return b.score - a.score; }).map(function (p, i) {
            p.rank = i + 1;
            return p;
        });

        // 用户
        var users = [
            { id: 'user-1', name: '系统管理员', email: 'admin@example.com', phone: '13800000001', departmentId: 'dept-1', roleId: 'role-1', status: 'active', areaId: '' },
            { id: 'user-2', name: '运营经理', email: 'operation@example.com', phone: '13800000002', departmentId: 'dept-2', roleId: 'role-2', status: 'active', areaId: 'area-1' },
            { id: 'user-3', name: '客服专员', email: 'service@example.com', phone: '13800000003', departmentId: 'dept-3', roleId: 'role-3', status: 'active', areaId: 'area-3' },
            { id: 'user-4', name: '仓储管理员', email: 'warehouse@example.com', phone: '13800000004', departmentId: 'dept-4', roleId: 'role-4', status: 'active', areaId: 'area-5' },
            { id: 'user-5', name: '张师傅', email: 'courier1@example.com', phone: '13800000005', departmentId: 'dept-5', roleId: 'role-5', status: 'active', areaId: 'area-1' },
            { id: 'user-6', name: '李师傅', email: 'courier2@example.com', phone: '13800000006', departmentId: 'dept-5', roleId: 'role-5', status: 'active', areaId: 'area-2' },
            { id: 'user-7', name: '财务专员', email: 'finance@example.com', phone: '13800000007', departmentId: 'dept-6', roleId: 'role-6', status: 'active', areaId: '' },
            { id: 'user-8', name: '人事专员', email: 'hr@example.com', phone: '13800000008', departmentId: 'dept-7', roleId: 'role-2', status: 'active', areaId: '' }
        ];

        // 扫描设备
        var devices = [];
        for (var d = 0; d < 8; d++) {
            devices.push({
                id: 'DEV-' + pad(d + 1, 3),
                name: 'PDA 扫描枪 ' + pad(d + 1, 2),
                model: ['斑马 TC52', '霍尼韦尔 8680', '新大陆 N7'][d % 3],
                location: ['北京中心仓', '上海分拨中心', '广州网点', '深圳网点', '杭州网点', '成都仓', '武汉中转场', '西安仓'][d],
                status: d === 6 ? 'maintenance' : 'online',
                lastHeartbeat: at(0, 16, d * 5),
                scansToday: randInt(40, 260)
            });
        }

        var totalCounters = {
            sorting: orders.length, loading: orders.length, scans: orders.length * 10,
            transports: orders.length, exceptions: orders.length, finances: orders.length * 2,
            tickets: 15, claims: 9, adminRecords: 12, evaluations: 12,
            serviceTickets: 15, employees: 20, orders: orders.length,
            rateCards: rateCards.length, routes: routes.length,
            receivables: receivables.length, payables: payables.length, bills: bills.length
        };

        return {
            version: DB_VERSION,
            seededAt: nowIso(),
            meta: { counters: totalCounters },
            users: users,
            roles: ROLES,
            permissions: PERMISSIONS,
            departments: DEPARTMENTS,
            areas: AREAS,
            employees: employees,
            vehicles: vehicles,
            warehouses: warehouses,
            inventory: inventory,
            capacities: capacities,
            geofences: geofences,
            devices: devices,
            policies: policies,
            routingRules: routingRules,
            rateCards: rateCards,
            routes: routes,
            deliveryAddresses: addresses,
            timingRules: timingRules,
            changeRecords: changeRecords,
            evalMetrics: evalMetrics,
            evaluations: evaluations,
            performance: performance,
            adminRecords: adminRecords,
            orders: orders.sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); }),
            transports: transport,
            sortingTasks: sorting,
            loadingTasks: loading,
            scans: scans.sort(function (a, b) { return new Date(b.scannedAt) - new Date(a.scannedAt); }),
            traces: tracePool.sort(function (a, b) { return new Date(b.opTime) - new Date(a.opTime); }),
            exceptions: exceptions.sort(function (a, b) { return new Date(b.occurredAt) - new Date(a.occurredAt); }),
            finances: finances.sort(function (a, b) { return new Date(b.date) - new Date(a.date); }),
            receivables: receivables.sort(function (a, b) { return new Date(b.issuedAt) - new Date(a.issuedAt); }),
            payables: payables.sort(function (a, b) { return new Date(b.period) - new Date(a.period); }),
            bills: bills.sort(function (a, b) { return b.period.localeCompare(a.period); }),
            serviceTickets: tickets.sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); }),
            claims: claims.sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); })
        };
    }

    // 种子数据 ID 计数器（仅初始化时使用）
    var seedCounters = {};
    function counterSeed(entity, prefix, seq) {
        seedCounters[entity] = Math.max(seedCounters[entity] || 0, seq);
        var ref = new Date();
        // 使用订单日期构造，保证列表 ID 与业务时间一致
        var ymd = dateKey(ref).replace(/-/g, '');
        return prefix + '-' + ymd + pad(seq, 4);
    }

    function importLegacyData(initialDb) {
        try {
            var legacyUsers = JSON.parse(localStorage.getItem('tmsUsers') || 'null');
            if (Array.isArray(legacyUsers) && legacyUsers.length) {
                legacyUsers.forEach(function (u) {
                    var exists = initialDb.users.some(function (x) { return x.email === u.email; });
                    if (!exists) {
                        initialDb.users.push({
                            id: u.id || 'user-' + (initialDb.users.length + 1),
                            name: u.name, email: u.email, phone: u.phone || '',
                            departmentId: u.departmentId || 'dept-1',
                            roleId: u.roleId || 'role-5',
                            status: u.status || 'active',
                            areaId: u.areaId || ''
                        });
                    }
                });
            }
        } catch (e) { /* 旧数据不可用时忽略 */ }
    }

    function init(force) {
        if (!db) db = readDb();
        if (!db || force) {
            db = seed();
            if (!force) importLegacyData(db);
            persist();
        }
        return db;
    }

    /* ============================== 通用 CRUD ============================== */

    function ensureInit() {
        if (!db) init();
        return db;
    }

    /**
     * 查询列表
     * @param {string} entity 数据集合名
     * @param {object} options { search, searchFields, filters, sort, page, pageSize }
     * @returns {{rows:Array,total:number,page:number,pageSize:number,pages:number}}
     */
    function list(entity, options) {
        ensureInit();
        var opts = options || {};
        var rows = (db[entity] || []).slice();

        if (opts.filters && Object.keys(opts.filters).length) {
            rows = rows.filter(function (row) {
                return Object.keys(opts.filters).every(function (key) {
                    var val = opts.filters[key];
                    if (val === '' || val == null) return true;
                    if (Array.isArray(val)) return val.indexOf(row[key]) > -1;
                    return String(row[key]) === String(val);
                });
            });
        }

        if (opts.search && String(opts.search).trim()) {
            var q = String(opts.search).trim().toLowerCase();
            var fields = opts.searchFields || Object.keys(rows[0] || {});
            rows = rows.filter(function (row) {
                return fields.some(function (field) {
                    var v = row[field];
                    return v != null && String(v).toLowerCase().indexOf(q) > -1;
                });
            });
        }

        if (opts.sort && opts.sort.key) {
            var key = opts.sort.key;
            var dir = opts.sort.dir === 'asc' ? 1 : -1;
            rows.sort(function (a, b) {
                var av = a[key], bv = b[key];
                if (av == null) return 1;
                if (bv == null) return -1;
                if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
                return String(av).localeCompare(String(bv), 'zh-CN') * dir;
            });
        }

        var total = rows.length;
        var pageSize = opts.pageSize || 0;
        var page = opts.page || 1;
        var pages = pageSize ? Math.max(1, Math.ceil(total / pageSize)) : 1;
        if (pageSize) {
            page = Math.min(Math.max(1, page), pages);
            rows = rows.slice((page - 1) * pageSize, page * pageSize);
        }
        return { rows: rows, total: total, page: page, pageSize: pageSize, pages: pages };
    }

    function get(entity, id) {
        ensureInit();
        return (db[entity] || []).find(function (row) { return String(row.id) === String(id); }) || null;
    }

    function create(entity, data) {
        ensureInit();
        if (!db[entity]) db[entity] = [];
        var prefixMap = {
            exceptions: 'EX', transports: 'TR', serviceTickets: 'SV', claims: 'CLM',
            finances: 'FIN', adminRecords: 'ADM', inventory: 'INV', vehicles: 'VEH',
            capacities: 'CAP', geofences: 'GF', policies: 'POL', routingRules: 'RUL',
            deliveryAddresses: 'ADDR', timingRules: 'TMR', changeRecords: 'CHG',
            evalMetrics: 'KPI', evaluations: 'EV', employees: 'EMP', sortingTasks: 'SRT',
            loadingTasks: 'LOD', scans: 'SC', users: 'user', roles: 'role',
            permissions: 'perm', departments: 'dept',
            rateCards: 'RC', routes: 'ROUTE', receivables: 'REC', payables: 'PAY', bills: 'BILL'
        };
        var record = Object.assign({}, data);
        if (!record.id) {
            record.id = counterNext(entity, prefixMap[entity] || 'TMS');
        }
        if (!record.createdAt && entity !== 'users') record.createdAt = nowIso();
        record.updatedAt = nowIso();
        db[entity].unshift(record);
        persist();
        return record;
    }

    function update(entity, id, patch) {
        ensureInit();
        var row = get(entity, id);
        if (!row) return null;
        Object.assign(row, patch, { updatedAt: nowIso() });
        persist();
        return row;
    }

    function remove(entity, id) {
        ensureInit();
        var arr = db[entity] || [];
        var idx = arr.findIndex(function (row) { return String(row.id) === String(id); });
        if (idx < 0) return false;
        arr.splice(idx, 1);
        persist();
        return true;
    }

    function subscribe(fn) {
        listeners.push(fn);
        return function () {
            listeners = listeners.filter(function (item) { return item !== fn; });
        };
    }

    function reset() {
        localStorage.removeItem(DB_KEY);
        db = null;
        init(true);
        return db;
    }

    /* ============================== 业务流转 ============================== */

    function statusIndex(status) {
        return ORDER_FLOW.findIndex(function (s) { return s.key === status; });
    }

    function addScanRecord(order, type, time, operator) {
        var locations = {
            '入库扫描': order.origin + '分拨中心',
            '分拣扫描': order.origin + '分拨中心',
            '出库扫描': order.origin + '分拨中心',
            '到达扫描': order.destination + '网点',
            '派送扫描': order.destination + '网点',
            '签收扫描': order.receiverAddress
        };
        db.scans.unshift({
            id: counterNext('scans', 'SC'),
            scannedAt: time || nowIso(),
            orderId: order.id,
            waybillNo: order.waybillNo,
            type: type,
            location: locations[type] || order.destination + '网点',
            device: 'PDA-' + pad((hash(order.id) % 20) + 1, 2),
            operator: operator || '系统'
        });
        if (db.scans.length > 500) db.scans.length = 500;
    }

    function ensureSortingTask(order) {
        var task = db.sortingTasks.find(function (t) { return t.orderId === order.id; });
        if (!task) {
            task = {
                id: counterNext('sortingTasks', 'SRT'),
                orderId: order.id,
                waybillNo: order.waybillNo,
                origin: order.origin,
                destination: order.destination,
                center: order.origin + '分拨中心',
                sorter: '待分配',
                planAt: nowIso(),
                missed: false,
                status: 'pending',
                createdAt: nowIso()
            };
            db.sortingTasks.unshift(task);
        }
        return task;
    }

    function ensureLoadingTask(order) {
        var task = db.loadingTasks.find(function (t) { return t.orderId === order.id; });
        if (!task) {
            task = {
                id: counterNext('loadingTasks', 'LOD'),
                orderId: order.id,
                waybillNo: order.waybillNo,
                type: '装车',
                place: order.origin + '分拨中心',
                vehicleId: '',
                workers: '待分配',
                planAt: nowIso(),
                startAt: '',
                tons: order.weight / 1000,
                equipment: '叉车',
                status: 'pending',
                createdAt: nowIso()
            };
            db.loadingTasks.unshift(task);
        }
        return task;
    }

    function ensureTransport(order) {
        var tr = db.transports.find(function (t) { return t.orderId === order.id; });
        if (!tr) {
            var vehicle = db.vehicles.find(function (v) { return v.status === 'online' || v.status === 'transporting'; }) || db.vehicles[0];
            tr = {
                id: counterNext('transports', 'TR'),
                orderId: order.id,
                waybillNo: order.waybillNo,
                origin: order.origin,
                destination: order.destination,
                carrier: CARRIERS[hash(order.id) % CARRIERS.length],
                vehicleId: vehicle ? vehicle.id : '',
                driver: vehicle ? vehicle.driver : '待分配',
                departAt: nowIso(),
                eta: order.expectedAt,
                arrivedAt: '',
                status: 'shipping',
                progress: 0,
                createdAt: nowIso()
            };
            db.transports.unshift(tr);
        }
        return tr;
    }

    function ensureIncome(order) {
        var exists = db.finances.some(function (f) { return f.orderId === order.id && f.type === 'income'; });
        if (!exists) {
            db.finances.unshift({
                id: counterNext('finances', 'FIN'),
                type: 'income',
                category: '运费收入',
                orderId: order.id,
                amount: order.freight,
                status: 'settled',
                date: order.signedAt || nowIso(),
                remark: order.customer + ' 运费结算',
                createdAt: nowIso()
            });
        }
    }

    // 订单阶段 → 轨迹节点码
    var STATUS_NODE = { pending: 'GOT', inbound: 'INBOUND', sorted: 'SORTING', shipping: 'DEPARTURE', arrived: 'ARRIVED', delivering: 'DELIVERING', signed: 'SIGNED' };

    function traceLocation(order, status) {
        if (status === 'inbound' || status === 'sorted' || status === 'shipping') return order.origin + '分拨中心';
        if (status === 'arrived' || status === 'delivering') return order.destination + '网点';
        if (status === 'signed') return order.receiverAddress;
        return order.origin + '揽收点';
    }

    // 写入一条轨迹（同时追加到 order.traces 与全局 db.traces）
    function addTrace(order, nodeCode, time, actor, flags) {
        if (!db.traces) db.traces = [];
        if (!order.traces) order.traces = [];
        var node = TRACE_NODE_MAP[nodeCode] || { name: nodeCode, stdHours: 0 };
        var status = order.status;
        var t = time || nowIso();
        var deadline = node.stdHours ? new Date(new Date(t).getTime() + node.stdHours * 3600000).toISOString() : t;
        var loc = traceLocation(order, status);
        var rec = {
            id: counterNext('traces', 'TRC'),
            orderId: order.id, waybillNo: order.waybillNo, customer: order.customer,
            origin: order.origin, destination: order.destination, status: status,
            node: nodeCode, nodeName: node.name, location: loc, opTime: t, deadline: deadline,
            isOvertime: !!(flags && flags.isOvertime), isDeviant: !!(flags && flags.isDeviant), actor: actor || '系统'
        };
        order.traces.push({ node: nodeCode, nodeName: node.name, location: loc, opTime: t, deadline: deadline, isOvertime: rec.isOvertime, isDeviant: rec.isDeviant });
        db.traces.unshift(rec);
        if (db.traces.length > 2000) db.traces.length = 2000;
    }

    // 签收后结算：月结挂应收，现付/到付直接确认收入
    function ensureSettlement(order) {
        var method = order.paymentMethod || '现付';
        if (method === '月结') {
            var exists = (db.receivables || []).some(function (r) { return r.orderId === order.id; });
            if (!exists) {
                var cycle = settleCycleFor(order.customer);
                var base = order.signedAt || nowIso();
                var due = new Date(new Date(base).getTime() + cycle * 86400000);
                create('receivables', {
                    orderId: order.id, customer: order.customer, amount: order.freight,
                    paymentMethod: method, settleCycle: cycle, issuedAt: base, dueDate: due.toISOString(),
                    status: 'unpaid', billId: '', period: dateKey(new Date(base)).slice(0, 7)
                });
                order.receivableStatus = 'unpaid';
                var incomeExists = db.finances.some(function (f) { return f.orderId === order.id && f.type === 'income'; });
                if (!incomeExists) {
                    db.finances.unshift({
                        id: counterNext('finances', 'FIN'), type: 'income', category: '运费收入（月结）',
                        orderId: order.id, amount: order.freight, status: 'pending', date: base,
                        remark: order.customer + ' 月结挂账，待回款', createdAt: nowIso()
                    });
                }
            }
        } else {
            order.receivableStatus = 'paid';
            ensureIncome(order);
        }
    }

    function applyOrderStatus(order, nextStatus, actor, time) {
        var currentIndex = statusIndex(order.status);
        var nextIndex = statusIndex(nextStatus);
        if (nextIndex < 0 || nextIndex <= currentIndex) return false;

        order.status = nextStatus;
        order.updatedAt = time || nowIso();
        if (!order.timeline) order.timeline = [];
        order.timeline.push({
            status: nextStatus,
            label: STATUS_LABELS.order[nextStatus],
            time: order.updatedAt,
            actor: actor || '系统'
        });
        var nodeCode = STATUS_NODE[nextStatus];
        if (nodeCode) addTrace(order, nodeCode, order.updatedAt, actor);

        if (nextStatus === 'inbound') {
            addScanRecord(order, '入库扫描', order.updatedAt, actor);
            var st = ensureSortingTask(order);
            if (st.status === 'pending') st.status = 'processing';
        }
        if (nextStatus === 'sorted') {
            var st2 = ensureSortingTask(order);
            st2.status = 'done';
            st2.completedAt = order.updatedAt;
            addScanRecord(order, '分拣扫描', order.updatedAt, actor);
            addScanRecord(order, '出库扫描', order.updatedAt, actor);
            ensureLoadingTask(order);
        }
        if (nextStatus === 'shipping') {
            var ld = ensureLoadingTask(order);
            ld.status = 'done';
            ld.startAt = order.updatedAt;
            var tr = ensureTransport(order);
            tr.status = 'shipping';
            tr.departAt = order.updatedAt;
            if (!order.planSegments || !order.planSegments.length) planRoute(order, db);
            addScanRecord(order, '出库扫描', order.updatedAt, actor);
            var vehicle = db.vehicles.find(function (v) { return v.id === tr.vehicleId; });
            if (vehicle) { vehicle.status = 'transporting'; vehicle.lastUpdate = order.updatedAt; }
        }
        if (nextStatus === 'arrived') {
            var tr2 = db.transports.find(function (t) { return t.orderId === order.id; });
            if (tr2) { tr2.status = 'arrived'; tr2.arrivedAt = order.updatedAt; tr2.progress = 100; }
            addScanRecord(order, '到达扫描', order.updatedAt, actor);
        }
        if (nextStatus === 'delivering') {
            var tr3 = db.transports.find(function (t) { return t.orderId === order.id; });
            if (tr3) tr3.status = 'delivering';
            addScanRecord(order, '派送扫描', order.updatedAt, actor);
        }
        if (nextStatus === 'signed') {
            order.signedAt = order.updatedAt;
            var tr4 = db.transports.find(function (t) { return t.orderId === order.id; });
            if (tr4) tr4.status = 'completed';
            addScanRecord(order, '签收扫描', order.updatedAt, actor);
            ensureSettlement(order);
            var vehicle4 = tr4 ? db.vehicles.find(function (v) { return v.id === tr4.vehicleId; }) : null;
            if (vehicle4) { vehicle4.status = 'online'; vehicle4.lastUpdate = order.updatedAt; }
        }
        return true;
    }

    function advanceOrder(orderId, actor) {
        ensureInit();
        var order = get('orders', orderId);
        if (!order) return { ok: false, message: '订单不存在' };
        if (order.status === 'cancelled') return { ok: false, message: '订单已取消，无法推进' };
        var idx = statusIndex(order.status);
        if (idx >= ORDER_FLOW.length - 1) return { ok: false, message: '订单已完成签收' };
        var next = ORDER_FLOW[idx + 1];
        applyOrderStatus(order, next.key, actor || '运营管理员', nowIso());
        persist();
        return { ok: true, status: next.key, label: next.label, order: order };
    }

    function createOrder(data, options) {
        ensureInit();
        var opts = options || {};
        var seq = (db.meta.counters.orders || 0) + 1;
        db.meta.counters.orders = seq;
        var createdAt = nowIso();
        var origin = data.origin || '北京';
        var customer = data.customer || '散客';
        var id = buildOrderId(origin, customer, Date.now(), seq);
        var expectedAt = data.expectedAt || new Date(Date.now() + 2 * 86400000).toISOString();
        var destination = data.destination || '上海';
        var paymentMethod = data.paymentMethod || '现付';
        var service = data.service || '标准';
        // 未显式传运费则调用计费引擎试算（与报价页/新单一致）
        var charge = null;
        if (data.freight == null || data.freight === '') {
            charge = calcFreight({
                origin: origin, destination: destination, service: service, weight: Number(data.weight) || 1,
                dims: data.dims, volume: data.volume, declaredValue: Number(data.declaredValue) || 0,
                isInsured: !!data.isInsured, paymentMethod: paymentMethod, customer: customer
            }, db.rateCards);
        }
        var order = Object.assign({
            id: id,
            waybillNo: buildWaybill(id),
            customer: customer,
            contact: data.contact || customer,
            phone: data.phone || '',
            goods: data.goods || '日用百货',
            weight: Number(data.weight) || 1,
            pieces: Number(data.pieces) || 1,
            service: service,
            orderType: data.orderType || 'forward',
            dims: data.dims || '',
            volume: Number(data.volume) || 0,
            declaredValue: Number(data.declaredValue) || 0,
            isInsured: !!data.isInsured,
            paymentMethod: paymentMethod,
            settleCycle: settleCycleFor(customer),
            freight: charge ? charge.total : (Number(data.freight) || 0),
            freightBreakdown: charge || null,
            rateCardId: charge ? charge.cardId : '',
            volumetricWeight: charge ? charge.volumetricWeight : 0,
            chargeableWeight: charge ? charge.chargeableWeight : (Number(data.weight) || 0),
            receivableStatus: '', routeId: '', planSegments: [], traces: [], slaDeadline: expectedAt,
            origin: origin,
            destination: destination,
            senderAddress: data.senderAddress || origin,
            receiverAddress: data.receiverAddress || destination,
            status: 'pending',
            createdAt: createdAt,
            expectedAt: expectedAt,
            signedAt: '',
            updatedAt: createdAt,
            timeline: [{ status: 'pending', label: '订单创建', time: createdAt, actor: '运营管理员' }],
            remark: data.remark || ''
        }, data, { id: id, waybillNo: buildWaybill(id), createdAt: createdAt, status: 'pending', timeline: [{ status: 'pending', label: '订单创建', time: createdAt, actor: '运营管理员' }] });
        db.orders.unshift(order);
        ensureSortingTask(order);
        planRoute(order, db);
        addTrace(order, 'GOT', createdAt, data.actor || '运营管理员');
        if (opts.autoInbound) applyOrderStatus(order, 'inbound', '系统', nowIso());
        persist();
        return order;
    }

    function cancelOrder(orderId, reason) {
        ensureInit();
        var order = get('orders', orderId);
        if (!order) return false;
        if (order.status === 'signed') return false;
        var hadTransport = (db.transports || []).some(function (t) { return t.orderId === orderId; });
        order.status = 'cancelled';
        order.updatedAt = nowIso();
        if (hadTransport) order.orderType = 'intercept'; // 已发运→拦截件
        order.remark = reason || order.remark || '订单取消';
        if (!order.timeline) order.timeline = [];
        order.timeline.push({ status: 'cancelled', label: hadTransport ? '已拦截取消' : '已取消', time: order.updatedAt, actor: '运营管理员' });
        addTrace(order, hadTransport ? 'INTERCEPT' : 'RETURNED', order.updatedAt, '运营管理员');
        // 联动：作废未核销应收 + 冲销挂账收入 + 释放车辆
        var rec = (db.receivables || []).find(function (r) { return r.orderId === orderId && r.status !== 'paid'; });
        if (rec) rec.status = 'void';
        var inc = db.finances.find(function (f) { return f.orderId === orderId && f.type === 'income' && f.status === 'pending'; });
        if (inc) { inc.status = 'void'; inc.remark = '订单取消冲销'; }
        var tr = (db.transports || []).find(function (t) { return t.orderId === orderId; });
        if (tr) {
            tr.status = 'cancelled';
            var veh = db.vehicles.find(function (v) { return v.id === tr.vehicleId; });
            if (veh && veh.status === 'transporting') { veh.status = 'online'; veh.lastUpdate = order.updatedAt; }
        }
        persist();
        return true;
    }

    // 改单：改址/改约/改重/改线路，涉计费要素变化自动重算并留痕
    function changeOrder(orderId, patch, options) {
        ensureInit();
        var order = get('orders', orderId);
        if (!order) return { ok: false, message: '订单不存在' };
        if (order.status === 'signed' || order.status === 'cancelled') return { ok: false, message: '已签收/已取消订单不可改单' };
        var opts = options || {};
        var before = { receiverAddress: order.receiverAddress, expectedAt: order.expectedAt, weight: order.weight, destination: order.destination };
        var contentParts = [];
        var routeChanged = false;
        if (patch.receiverAddress && patch.receiverAddress !== before.receiverAddress) { order.receiverAddress = patch.receiverAddress; contentParts.push('收货地址改为 ' + patch.receiverAddress); }
        if (patch.expectedAt && patch.expectedAt !== before.expectedAt) { order.expectedAt = patch.expectedAt; order.slaDeadline = patch.expectedAt; contentParts.push('约定时间改为 ' + patch.expectedAt); }
        if (patch.destination && patch.destination !== before.destination) { order.destination = patch.destination; contentParts.push('目的地改为 ' + patch.destination); routeChanged = true; }
        var weightChanged = patch.weight != null && Number(patch.weight) !== Number(before.weight);
        if (weightChanged) { order.weight = Number(patch.weight); contentParts.push('重量改为 ' + patch.weight + 'kg'); }
        if (patch.service) order.service = patch.service;
        if (patch.paymentMethod) order.paymentMethod = patch.paymentMethod;
        var needRecalc = weightChanged || routeChanged || patch.service || patch.paymentMethod;
        if (needRecalc) {
            var charge = calcFreight({
                origin: order.origin, destination: order.destination, service: order.service, weight: order.weight,
                dims: order.dims, volume: order.volume, declaredValue: order.declaredValue, isInsured: order.isInsured,
                paymentMethod: order.paymentMethod, customer: order.customer
            }, db.rateCards);
            order.freight = charge.total; order.freightBreakdown = charge; order.rateCardId = charge.cardId;
            order.volumetricWeight = charge.volumetricWeight; order.chargeableWeight = charge.chargeableWeight;
            if (routeChanged) planRoute(order, db);
            contentParts.push('重算运费为 ' + charge.total + ' 元');
        }
        order.updatedAt = nowIso();
        if (!order.timeline) order.timeline = [];
        order.timeline.push({ status: order.status, label: '改单', time: order.updatedAt, actor: opts.actor || '运营管理员' });
        var rec = create('changeRecords', { orderId: order.id, reason: patch.changeReason || '客户改单', content: contentParts.join('；') || '信息修正', operator: opts.actor || '运营管理员', operatedAt: order.updatedAt });
        persist();
        return { ok: true, order: order, change: rec };
    }

    // 拒收/退货→正向件置退回，生成逆向件（退回始发）
    function createReverseOrder(orderId, reason) {
        ensureInit();
        var order = get('orders', orderId);
        if (!order) return { ok: false, message: '订单不存在' };
        order.status = 'cancelled';
        order.updatedAt = nowIso();
        order.remark = reason || '客户拒收/退货';
        if (!order.timeline) order.timeline = [];
        order.timeline.push({ status: 'cancelled', label: '退回', time: order.updatedAt, actor: '运营管理员' });
        addTrace(order, 'RETURNED', order.updatedAt, '运营管理员');
        var reverse = createOrder({
            origin: order.destination, destination: order.origin,
            customer: order.customer, contact: order.contact, phone: order.phone,
            goods: order.goods, weight: order.weight, pieces: order.pieces,
            service: order.service, paymentMethod: '现付', orderType: 'reverse',
            senderAddress: order.receiverAddress, receiverAddress: order.senderAddress,
            remark: '逆向退货件 · 原单 ' + order.id
        }, {});
        persist();
        return { ok: true, reverse: reverse, forward: order };
    }

    function removeOrder(orderId) {
        ensureInit();
        var ok = remove('orders', orderId);
        if (ok) {
            ['transports', 'sortingTasks', 'loadingTasks', 'exceptions', 'scans', 'traces', 'receivables'].forEach(function (entity) {
                db[entity] = (db[entity] || []).filter(function (row) { return row.orderId !== orderId; });
            });
            persist();
        }
        return ok;
    }

    function createException(data) {
        ensureInit();
        var order = data.orderId ? get('orders', data.orderId) : null;
        var record = create('exceptions', {
            orderId: data.orderId || '',
            waybillNo: order ? order.waybillNo : (data.waybillNo || ''),
            type: data.type || '其他异常',
            description: data.description || '',
            occurredAt: data.occurredAt || nowIso(),
            status: 'pending',
            handler: '', resolution: '', resolvedAt: '',
            level: data.level || '三级',
            slaDeadline: new Date(Date.now() + 4 * 3600000).toISOString(),
            escalated: false, responsibleParty: '', responsible: '', solution: '', rootCause: '',
            deductionAmount: 0, linkedClaimId: '', linkedTicketId: '',
            flow: [{ time: nowIso(), actor: data.actor || '系统', action: '异常上报' }]
        });
        return record;
    }

    function processException(id, handler) {
        ensureInit();
        var row = get('exceptions', id);
        if (!row) return null;
        if (!row.flow) row.flow = [];
        row.flow.push({ time: nowIso(), actor: handler || '运营管理员', action: '受理工单' });
        var updated = update('exceptions', id, { status: 'processing', handler: handler || '运营管理员', flow: row.flow });
        if (row.orderId) {
            var order = get('orders', row.orderId);
            if (order) { order.remark = '存在处理中异常：' + row.type; order.updatedAt = nowIso(); }
        }
        return updated;
    }

    // 定责：指定责任方与扣款金额，同步生成成本应付
    function assignResponsibility(id, data) {
        ensureInit();
        var row = get('exceptions', id);
        if (!row) return null;
        if (!row.flow) row.flow = [];
        var party = data.party || '承运商';
        var deduction = Number(data.deduction) || 0;
        row.flow.push({ time: nowIso(), actor: data.actor || '运营管理员', action: '定责：' + party + (deduction ? '（扣款 ' + deduction + ' 元）' : '') });
        update('exceptions', id, { responsibleParty: party, responsible: data.responsible || row.responsible || '待指派', deductionAmount: deduction, flow: row.flow });
        if (deduction > 0 && party !== '客户') {
            create('payables', {
                target: party === '司机' ? (data.responsible || '司机') : party,
                targetType: party === '司机' ? 'driver' : (party === '承运商' ? 'carrier' : 'branch'),
                category: '异常扣款', refId: row.orderId || row.id, amount: deduction,
                period: dateKey(new Date()), status: 'pending', settledAt: ''
            });
        }
        return get('exceptions', id);
    }

    // 闭环：填写处理方案/根因，可按需联动理赔，并补生成责任方扣款应付
    function closeException(id, data) {
        ensureInit();
        var opts = data || {};
        var row = get('exceptions', id);
        if (!row) return null;
        if (!row.flow) row.flow = [];
        row.flow.push({ time: nowIso(), actor: opts.actor || '运营管理员', action: '闭环：' + (opts.solution || '处理完成') });
        update('exceptions', id, {
            status: 'resolved', resolution: opts.resolution || '已处理完成', resolvedAt: nowIso(),
            handler: row.handler || opts.actor || '运营管理员', solution: opts.solution || row.solution || '改派',
            rootCause: opts.rootCause || row.rootCause || '', flow: row.flow
        });
        if (row.responsibleParty && row.responsibleParty !== '客户' && Number(row.deductionAmount) > 0) {
            var hasPay = (db.payables || []).some(function (p) { return p.refId === (row.orderId || row.id) && p.category === '异常扣款'; });
            if (!hasPay) {
                create('payables', { target: row.responsibleParty, targetType: row.responsibleParty === '司机' ? 'driver' : (row.responsibleParty === '承运商' ? 'carrier' : 'branch'), category: '异常扣款', refId: row.orderId || row.id, amount: Number(row.deductionAmount), period: dateKey(new Date()), status: 'pending', settledAt: '' });
            }
        }
        if (opts.createClaim) {
            var claim = createClaim({ orderId: row.orderId, type: row.type, amount: opts.claimAmount || 0, reason: opts.resolution || row.description });
            update('exceptions', id, { linkedClaimId: claim ? claim.id : '' });
        }
        return get('exceptions', id);
    }

    function escalateException(id) {
        ensureInit();
        var row = get('exceptions', id);
        if (!row) return null;
        if (!row.flow) row.flow = [];
        row.flow.push({ time: nowIso(), actor: '系统', action: '超时升级至运营主管' });
        return update('exceptions', id, { escalated: true, level: '一级', flow: row.flow });
    }

    function resolveException(id, resolution, options) {
        // 保留旧签名兼容：内部转 closeException
        var opts = options || {};
        return closeException(id, {
            resolution: resolution, solution: opts.solution, rootCause: opts.rootCause,
            createClaim: opts.createClaim, claimAmount: opts.claimAmount
        });
    }

    /* ============================== 应收与账单 ============================== */

    function markReceivablePaid(id) {
        ensureInit();
        var r = get('receivables', id);
        if (!r) return null;
        update('receivables', id, { status: 'paid', paidAt: nowIso() });
        var order = r.orderId ? get('orders', r.orderId) : null;
        if (order) order.receivableStatus = 'paid';
        var inc = db.finances.find(function (f) { return f.type === 'income' && f.orderId === r.orderId && f.status === 'pending'; });
        if (inc) { inc.status = 'settled'; inc.date = nowIso(); inc.remark = (r.customer || '') + ' 月结回款核销'; }
        persist();
        return get('receivables', id);
    }

    // 按客户+账期将未归账单的应收聚合为月度账单
    function generateBills(period, customer) {
        ensureInit();
        var rows = (db.receivables || []).filter(function (r) {
            return r.status !== 'void' && !r.billId && (!period || r.period === period) && (!customer || r.customer === customer);
        });
        var byKey = {};
        rows.forEach(function (r) { var k = r.customer + '#' + r.period; (byKey[k] = byKey[k] || []).push(r); });
        var created = [];
        Object.keys(byKey).forEach(function (k) {
            var g = byKey[k];
            var total = money(g.reduce(function (s, r) { return s + Number(r.amount); }, 0));
            var bill = create('bills', {
                billNo: 'BILL' + g[0].period.replace('-', '') + pad((db.meta.counters.bills || 0) % 1000, 3),
                customer: g[0].customer, period: g[0].period, itemCount: g.length,
                totalAmount: total, receivedAmount: 0, status: 'draft', dueDate: g[0].dueDate
            });
            g.forEach(function (r) { r.billId = bill.id; });
            created.push(bill);
        });
        persist();
        return created;
    }

    /* ============================== 轨迹超时/偏差 ============================== */

    function checkTracesOvertime(autoException) {
        ensureInit();
        var now = Date.now();
        var flagged = 0;
        (db.traces || []).forEach(function (tr) {
            if (tr.isOvertime || !tr.deadline || tr.node === 'SIGNED') return;
            var order = get('orders', tr.orderId);
            if (!order || order.status === 'signed' || order.status === 'cancelled') return;
            if (new Date(tr.deadline).getTime() < now) { tr.isOvertime = true; flagged++; }
        });
        if (flagged && autoException) {
            var worst = (db.traces || []).filter(function (t) { return t.isOvertime; }).sort(function (a, b) { return new Date(a.deadline) - new Date(b.deadline); })[0];
            if (worst && worst.orderId) createException({ orderId: worst.orderId, type: '延迟送达', description: '节点[' + worst.nodeName + ']超过标准时限未更新，系统自动预警', level: '二级' });
        }
        if (flagged) persist();
        return flagged;
    }

    function createTicket(data) {
        ensureInit();
        var order = data.orderId ? get('orders', data.orderId) : null;
        return create('serviceTickets', {
            orderId: data.orderId || '',
            customer: data.customer || (order ? order.customer : ''),
            type: data.type || '物流查询',
            priority: data.priority || '中',
            content: data.content || '',
            status: 'pending',
            assignee: data.assignee || '',
            resolvedAt: ''
        });
    }

    function processTicket(id, assignee) {
        return update('serviceTickets', id, { status: 'processing', assignee: assignee || '客服专员' });
    }

    function resolveTicket(id, result) {
        return update('serviceTickets', id, { status: 'resolved', resolvedAt: nowIso(), result: result || '已解决' });
    }

    function createClaim(data) {
        ensureInit();
        var order = data.orderId ? get('orders', data.orderId) : null;
        return create('claims', {
            orderId: data.orderId || '',
            customer: data.customer || (order ? order.customer : ''),
            type: data.type || '货物破损',
            amount: Number(data.amount) || 0,
            reason: data.reason || '',
            status: 'pending',
            applicant: data.applicant || '运营管理员',
            handledAt: ''
        });
    }

    function approveClaim(id) {
        ensureInit();
        var claim = get('claims', id);
        if (!claim) return null;
        update('claims', id, { status: 'approved', handledAt: nowIso() });
        create('finances', {
            type: 'expense',
            category: '理赔支出',
            orderId: claim.orderId,
            amount: claim.amount,
            status: 'settled',
            date: nowIso(),
            remark: claim.customer + ' ' + claim.type + ' 赔付'
        });
        return get('claims', id);
    }

    function updateTransportStatus(id, nextStatus) {
        ensureInit();
        var tr = get('transports', id);
        if (!tr) return { ok: false, message: '运输任务不存在' };
        var statusMap = {
            shipping: 'shipping', arrived: 'arrived', delivered: 'arrived',
            delivering: 'delivering', completed: 'signed', cancelled: 'cancelled'
        };
        tr.status = nextStatus;
        tr.updatedAt = nowIso();
        if (nextStatus === 'arrived' || nextStatus === 'delivered') tr.arrivedAt = nowIso();
        var order = get('orders', tr.orderId);
        if (order) {
            var target = statusMap[nextStatus];
            if (target && target !== 'cancelled' && target !== 'signed') {
                applyOrderStatus(order, target, '运输调度', nowIso());
            } else if (target === 'signed') {
                applyOrderStatus(order, 'arrived', '运输调度', nowIso());
                applyOrderStatus(order, 'delivering', '运输调度', nowIso());
                applyOrderStatus(order, 'signed', '运输调度', nowIso());
            }
        }
        persist();
        return { ok: true, transport: tr };
    }

    function completeSorting(id) {
        ensureInit();
        var task = get('sortingTasks', id);
        if (!task) return null;
        update('sortingTasks', id, { status: 'done', completedAt: nowIso() });
        var order = get('orders', task.orderId);
        if (order && statusIndex(order.status) < 2) {
            applyOrderStatus(order, 'inbound', '分拣员', nowIso());
            applyOrderStatus(order, 'sorted', '分拣员', nowIso());
        }
        persist();
        return get('sortingTasks', id);
    }

    function completeLoading(id) {
        ensureInit();
        var task = get('loadingTasks', id);
        if (!task) return null;
        update('loadingTasks', id, { status: 'done', startAt: task.startAt || nowIso() });
        var order = get('orders', task.orderId);
        if (order && statusIndex(order.status) < 3) {
            ['inbound', 'sorted', 'shipping'].forEach(function (s) {
                if (statusIndex(order.status) < statusIndex(s)) applyOrderStatus(order, s, '装卸班组', nowIso());
            });
        }
        persist();
        return get('loadingTasks', id);
    }

    /* ============================== 统计聚合 ============================== */

    function isSameDay(iso, date) {
        if (!iso) return false;
        return dateKey(iso) === dateKey(date);
    }

    function overview() {
        ensureInit();
        var today = new Date();
        var todayOrders = db.orders.filter(function (o) { return isSameDay(o.createdAt, today); });
        var pendingExceptions = db.exceptions.filter(function (e) { return e.status === 'pending' || e.status === 'processing'; });
        var inTransit = db.transports.filter(function (t) { return t.status === 'shipping' || t.status === 'delivering'; });
        var weekAgo = new Date(Date.now() - 7 * 86400000);
        var expected = db.orders.filter(function (o) { return new Date(o.expectedAt) >= weekAgo && new Date(o.expectedAt) <= today; });
        var signed = db.orders.filter(function (o) { return o.signedAt && new Date(o.signedAt) >= weekAgo; });
        var signRate = expected.length ? Math.min(100, Math.round(signed.length / expected.length * 100)) : 0;
        var revenueToday = db.finances.filter(function (f) {
            return f.type === 'income' && isSameDay(f.date, today);
        }).reduce(function (sum, f) { return sum + Number(f.amount || 0); }, 0);
        return {
            todayOrders: todayOrders.length,
            pendingExceptions: pendingExceptions.length,
            inTransit: inTransit.length,
            signRate: signRate,
            activeUsers: db.users.filter(function (u) { return u.status === 'active'; }).length,
            onlineVehicles: db.vehicles.filter(function (v) { return v.status === 'online' || v.status === 'transporting'; }).length,
            totalVehicles: db.vehicles.length,
            revenueToday: money(revenueToday),
            totalOrders: db.orders.length,
            signedOrders: db.orders.filter(function (o) { return o.status === 'signed'; }).length,
            pendingTickets: db.serviceTickets.filter(function (t) { return t.status === 'pending'; }).length,
            overdueReceivable: money((db.receivables || []).filter(function (r) { return r.status === 'overdue' || (r.status !== 'paid' && r.status !== 'void' && r.dueDate && new Date(r.dueDate) < today); }).reduce(function (s, r) { return s + Number(r.amount || 0); }, 0)),
            overtimeTraces: (db.traces || []).filter(function (t) { return t.isOvertime; }).length,
            escalatedExceptions: (db.exceptions || []).filter(function (e) { return e.escalated && e.status !== 'resolved'; }).length
        };
    }

    function orderTrend(days) {
        ensureInit();
        var n = days || 7;
        var result = [];
        for (var i = n - 1; i >= 0; i--) {
            var d = new Date();
            d.setDate(d.getDate() - i);
            var key = dateKey(d);
            result.push({
                date: key,
                label: (d.getMonth() + 1) + '/' + d.getDate(),
                created: db.orders.filter(function (o) { return dateKey(o.createdAt) === key; }).length,
                signed: db.orders.filter(function (o) { return o.signedAt && dateKey(o.signedAt) === key; }).length
            });
        }
        return result;
    }

    function statusDistribution() {
        ensureInit();
        return ORDER_FLOW.map(function (s) {
            return {
                key: s.key,
                label: s.label,
                value: db.orders.filter(function (o) { return o.status === s.key; }).length
            };
        }).concat([{
            key: 'cancelled',
            label: '已取消',
            value: db.orders.filter(function (o) { return o.status === 'cancelled'; }).length
        }]);
    }

    function exceptionByType() {
        ensureInit();
        var map = {};
        db.exceptions.forEach(function (e) {
            map[e.type] = (map[e.type] || 0) + 1;
        });
        return Object.keys(map).map(function (k) { return { label: k, value: map[k] }; }).sort(function (a, b) { return b.value - a.value; });
    }

    // 订单集合（用于按订单去重统计扫描覆盖）
    function idSet(rows) {
        var set = {};
        (rows || []).forEach(function (r) { if (r && r.id) set[r.id] = true; });
        return set;
    }

    function scannedOrderCount(type, orderSet) {
        var seen = {};
        db.scans.forEach(function (s) {
            if (s.type === type && orderSet[s.orderId]) seen[s.orderId] = true;
        });
        return Object.keys(seen).length;
    }

    function pct(part, total) {
        if (!total) return 0;
        return Math.min(100, Math.round(part / total * 100));
    }

    function dailyStats(days) {
        ensureInit();
        var n = days || 7;
        var result = [];
        for (var i = n - 1; i >= 0; i--) {
            var d = new Date();
            d.setDate(d.getDate() - i);
            var key = dateKey(d);
            var expectedOrders = db.orders.filter(function (o) { return dateKey(o.expectedAt) === key; });
            var signedOrders = expectedOrders.filter(function (o) { return !!o.signedAt; });
            var created = db.orders.filter(function (o) { return dateKey(o.createdAt) === key; });
            var picks = db.sortingTasks.filter(function (t) { return dateKey(t.planAt) === key; });
            var missed = picks.filter(function (t) { return t.missed; });
            var loads = db.loadingTasks.filter(function (t) { return dateKey(t.planAt) === key; });

            // 扫描口径：按订单去重，且只在当日应作业订单范围内统计，避免出现 >100% 的失真指标
            var expectedSet = idSet(expectedOrders);
            var createdSet = idSet(created);
            var pickedSet = idSet(picks.map(function (t) {
                return { id: t.orderId };
            }));
            var inboundScanned = scannedOrderCount('入库扫描', createdSet);
            var outboundScanned = scannedOrderCount('出库扫描', pickedSet);
            var deliveryScanned = scannedOrderCount('派送扫描', expectedSet);

            result.push({
                date: key,
                label: (d.getMonth() + 1) + '/' + d.getDate(),
                expectedSign: expectedOrders.length,
                actualSign: signedOrders.length,
                signRate: pct(signedOrders.length, expectedOrders.length),
                inboundExpected: created.length,
                inboundScanned: inboundScanned,
                inboundRate: pct(inboundScanned, created.length),
                outboundExpected: picks.length,
                outboundScanned: outboundScanned,
                outboundRate: pct(outboundScanned, picks.length),
                deliveryExpected: expectedOrders.length,
                deliveryScanned: deliveryScanned,
                deliveryRate: pct(deliveryScanned, expectedOrders.length),
                missSort: missed.length,
                totalPicked: picks.length,
                missRate: picks.length ? Math.round(missed.length / picks.length * 1000) / 10 : 0,
                forkliftOps: loads.length,
                forkliftTons: Math.round(loads.reduce(function (sum, t) { return sum + (Number(t.tons) || 0); }, 0) * 10) / 10
            });
        }
        return result;
    }

    function vehicleStats() {
        ensureInit();
        return {
            total: db.vehicles.length,
            online: db.vehicles.filter(function (v) { return v.status === 'online'; }).length,
            transporting: db.vehicles.filter(function (v) { return v.status === 'transporting'; }).length,
            maintenance: db.vehicles.filter(function (v) { return v.status === 'maintenance'; }).length,
            offline: db.vehicles.filter(function (v) { return v.status === 'offline'; }).length
        };
    }

    function warehouseStats() {
        ensureInit();
        var stockTotal = db.inventory.reduce(function (sum, m) { return sum + Number(m.stock || 0); }, 0);
        return {
            warehouses: db.warehouses.length,
            items: db.inventory.length,
            lowStock: db.inventory.filter(function (m) { return m.status === 'low'; }).length,
            stockTotal: stockTotal,
            inboundToday: db.warehouses.reduce(function (s, w) { return s + (w.inboundToday || 0); }, 0),
            outboundToday: db.warehouses.reduce(function (s, w) { return s + (w.outboundToday || 0); }, 0)
        };
    }

    function financeSummary(days) {
        ensureInit();
        var n = days || 7;
        var from = new Date(Date.now() - n * 86400000);
        var rows = db.finances.filter(function (f) { return f.date && new Date(f.date) >= from; });
        var income = rows.filter(function (f) { return f.type === 'income'; }).reduce(function (s, f) { return s + Number(f.amount || 0); }, 0);
        var expense = rows.filter(function (f) { return f.type === 'expense'; }).reduce(function (s, f) { return s + Number(f.amount || 0); }, 0);
        return { income: money(income), expense: money(expense), profit: money(income - expense), count: rows.length };
    }

    function financeTrend(days) {
        ensureInit();
        var n = days || 7;
        var result = [];
        for (var i = n - 1; i >= 0; i--) {
            var d = new Date();
            d.setDate(d.getDate() - i);
            var key = dateKey(d);
            result.push({
                date: key,
                label: (d.getMonth() + 1) + '/' + d.getDate(),
                income: money(db.finances.filter(function (f) { return f.type === 'income' && dateKey(f.date) === key; }).reduce(function (s, f) { return s + Number(f.amount || 0); }, 0)),
                expense: money(db.finances.filter(function (f) { return f.type === 'expense' && dateKey(f.date) === key; }).reduce(function (s, f) { return s + Number(f.amount || 0); }, 0))
            });
        }
        return result;
    }

    function employeeStats() {
        ensureInit();
        return {
            total: db.employees.length,
            active: db.employees.filter(function (e) { return e.status === 'active'; }).length,
            onLeave: db.employees.filter(function (e) { return e.status === 'on_leave'; }).length,
            resigned: db.employees.filter(function (e) { return e.status === 'resigned'; }).length
        };
    }

    /* ============================== 新链路统计 ============================== */

    // 计费试算（对外）
    function quote(params) {
        ensureInit();
        return calcFreight(params || {}, db.rateCards);
    }

    // 应收汇总：总额/逾期/回款率/账龄分布
    function billingSummary() {
        ensureInit();
        var now = new Date();
        var rows = (db.receivables || []).filter(function (r) { return r.status !== 'void'; });
        var total = 0, overdue = 0, received = 0;
        var aging = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
        rows.forEach(function (r) {
            var amt = Number(r.amount || 0);
            if (r.status === 'paid') { received += amt; return; }
            total += amt;
            var due = r.dueDate ? new Date(r.dueDate) : now;
            var daysOver = Math.floor((now - due) / 86400000);
            if (daysOver > 0) overdue += amt;
            var bucket = daysOver <= 0 ? '0-30' : (daysOver <= 30 ? '0-30' : (daysOver <= 60 ? '31-60' : (daysOver <= 90 ? '61-90' : '90+')));
            aging[bucket] = money(aging[bucket] + amt);
        });
        var receivableAll = money(total);
        var collectionRate = (receivableAll + received) ? Math.round(received / (receivableAll + received) * 100) : 100;
        return { totalReceivable: receivableAll, overdue: money(overdue), received: money(received), collectionRate: collectionRate, aging: aging, count: rows.length };
    }

    function payableSummary(period) {
        ensureInit();
        var rows = (db.payables || []).filter(function (p) { return !period || p.period === period; });
        var pending = rows.filter(function (p) { return p.status === 'pending'; });
        var settled = rows.filter(function (p) { return p.status === 'settled'; });
        return {
            total: money(rows.reduce(function (s, p) { return s + Number(p.amount || 0); }, 0)),
            pending: money(pending.reduce(function (s, p) { return s + Number(p.amount || 0); }, 0)),
            settled: money(settled.reduce(function (s, p) { return s + Number(p.amount || 0); }, 0)),
            pendingCount: pending.length, count: rows.length
        };
    }

    function routeStats() {
        ensureInit();
        var routes = db.routes || [];
        var avg = routes.length ? Math.round(routes.reduce(function (s, r) { return s + Number(r.totalStdHours || 0); }, 0) / routes.length) : 0;
        var deviation = (db.traces || []).filter(function (t) { return t.isDeviant; });
        var devOrders = {};
        deviation.forEach(function (t) { devOrders[t.orderId] = 1; });
        return { total: routes.length, avgStdHours: avg, deviationTraces: deviation.length, deviationOrders: Object.keys(devOrders).length };
    }

    function traceOvertimeStats() {
        ensureInit();
        var overtime = (db.traces || []).filter(function (t) { return t.isOvertime; });
        var deviant = (db.traces || []).filter(function (t) { return t.isDeviant; });
        var byLane = {};
        overtime.forEach(function (t) { var k = t.origin + '→' + t.destination; byLane[k] = (byLane[k] || 0) + 1; });
        var top = Object.keys(byLane).map(function (k) { return { label: k, value: byLane[k] }; }).sort(function (a, b) { return b.value - a.value; }).slice(0, 6);
        return { overtime: overtime.length, deviant: deviant.length, top: top, escalated: (db.exceptions || []).filter(function (e) { return e.escalated && e.status !== 'resolved'; }).length };
    }

    function orderLifecycleStats() {
        ensureInit();
        var orders = db.orders || [];
        var cancelled = orders.filter(function (o) { return o.status === 'cancelled'; }).length;
        var reverse = orders.filter(function (o) { return o.orderType === 'reverse'; }).length;
        var intercept = orders.filter(function (o) { return o.orderType === 'intercept'; }).length;
        var signed = orders.filter(function (o) { return o.status === 'signed'; }).length;
        return {
            total: orders.length, signed: signed, cancelled: cancelled, reverse: reverse, intercept: intercept,
            cancelRate: orders.length ? Math.round(cancelled / orders.length * 1000) / 10 : 0,
            reverseRate: orders.length ? Math.round(reverse / orders.length * 1000) / 10 : 0
        };
    }

    /* ============================== 对外暴露 ============================== */

    var api = {
        DB_KEY: DB_KEY,
        ORDER_FLOW: ORDER_FLOW,
        labels: STATUS_LABELS,
        dict: {
            cities: CITIES, customers: CUSTOMERS, goods: GOODS, carriers: CARRIERS,
            serviceLevels: SERVICE_LEVELS, paymentMethods: PAYMENT_METHODS, remoteCities: REMOTE_CITIES,
            customerLevels: CUSTOMER_LEVELS, traceNodes: TRACE_NODES, orderFlow: ORDER_FLOW
        },
        init: init,
        reset: reset,
        list: list,
        get: get,
        create: create,
        update: update,
        remove: remove,
        subscribe: subscribe,
        // 业务动作
        advanceOrder: advanceOrder,
        createOrder: createOrder,
        cancelOrder: cancelOrder,
        removeOrder: removeOrder,
        createException: createException,
        processException: processException,
        resolveException: resolveException,
        createTicket: createTicket,
        processTicket: processTicket,
        resolveTicket: resolveTicket,
        createClaim: createClaim,
        approveClaim: approveClaim,
        updateTransportStatus: updateTransportStatus,
        completeSorting: completeSorting,
        completeLoading: completeLoading,
        // 生命周期 / 异常闭环 / 应收
        changeOrder: changeOrder,
        createReverseOrder: createReverseOrder,
        assignResponsibility: assignResponsibility,
        closeException: closeException,
        escalateException: escalateException,
        markReceivablePaid: markReceivablePaid,
        generateBills: generateBills,
        checkTracesOvertime: checkTracesOvertime,
        planRoute: planRoute,
        // 计费
        quote: quote,
        calcFreight: calcFreight,
        // 统计
        overview: overview,
        orderTrend: orderTrend,
        statusDistribution: statusDistribution,
        exceptionByType: exceptionByType,
        dailyStats: dailyStats,
        vehicleStats: vehicleStats,
        warehouseStats: warehouseStats,
        financeSummary: financeSummary,
        financeTrend: financeTrend,
        employeeStats: employeeStats,
        billingSummary: billingSummary,
        payableSummary: payableSummary,
        routeStats: routeStats,
        traceOvertimeStats: traceOvertimeStats,
        orderLifecycleStats: orderLifecycleStats,
        // 工具
        dateKey: dateKey,
        dateTimeKey: dateTimeKey,
        money: money
    };

    global.TmsStore = api;

    // 监听其它标签页的数据变更，保持跨页面数据一致
    global.addEventListener('storage', function (e) {
        if (e.key === DB_KEY) {
            db = readDb();
            emit();
        }
    });

    init();
})(window);
