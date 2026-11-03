/* 计费引擎：运价卡匹配、体积重换算、附加费、客户折扣、成本归集与毛利测算 */
(function (global) {
    'use strict';

    var TMS = global.TMS = global.TMS || {};
    var util = TMS.util, cfg = TMS.cfg;

    function cards() {
        return TMS.db.col('rateCards');
    }

    function zoneOf(city) {
        var c = TMS.master.cityByName(city);
        return c ? c.zone : '华东';
    }

    function cityInfo(city) {
        return TMS.master.cityByName(city) || { name: city, zone: '华东', tier: 2, code: 'SH', lat: 0, lng: 0 };
    }

    /* 运价卡匹配优先级：城市专线 > 区域 × 服务 > 全国兜底 */
    function matchCard(origin, destination, service) {
        var list = cards();
        var exact = list.filter(function (c) {
            return c.status === 'active' && c.origin === origin && c.destination === destination && c.service === service;
        })[0];
        if (exact) return exact;
        var oz = zoneOf(origin), dz = zoneOf(destination);
        var zone = list.filter(function (c) {
            return c.status === 'active' && c.originZone === oz && c.destinationZone === dz && c.service === service;
        })[0];
        if (zone) return zone;
        var byService = list.filter(function (c) { return c.status === 'active' && c.service === service; })[0];
        return byService || list[0];
    }

    /* 体积：dims 形如 60x40x30（cm），支持多件；未填 dims 时按重量反推（货物密度） */
    function volumeCm3(dims, pieces, weight, goodsName) {
        var count = Math.max(1, Number(pieces) || 1);
        var m = /^(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)$/i.exec(String(dims || '').trim());
        if (m) return Number(m[1]) * Number(m[2]) * Number(m[3]) * count;
        var goods = TMS.master.GOODS.filter(function (g) { return g.name === goodsName; })[0];
        var density = goods ? goods.density : 200;           // kg/m³
        return (Number(weight) || 0) / density * 1000000;
    }

    function discountFor(customer, paymentMethod) {
        var rate = 0;
        if (customer) {
            rate = Number(customer.discountRate) || 0;
            if (customer.level === 'KA') rate += 0.02;      // 战略客户季度返点
        }
        if (paymentMethod === '月结') rate += 0.02;
        if (paymentMethod === '到付') rate -= 0.01;          // 到付资金占用成本
        return util.round(Math.max(0, Math.min(rate, 0.22)), 3);
    }

    /* 续重单价：运价卡单价 × 量大折扣，再托底到「外协采购价 × 最低加成」。
       快运行业对大票货量都谈阶梯价，但商务报价不能低过成本线，否则整车业务必然亏本。 */
    var BULK_TIER = [[6000, 0.62], [3000, 0.70], [1500, 0.78], [500, 0.86]];

    function contRateOf(card, chargeable, lineKm) {
        var rate = Number(card.continueFee) || 0;
        for (var i = 0; i < BULK_TIER.length; i++) {
            if (chargeable >= BULK_TIER[i][0]) { rate = util.round(rate * BULK_TIER[i][1], 2); break; }
        }
        if (chargeable >= 500) {
            var floor = util.round(ltlRateFor(chargeable, lineKm, 1) * cfg.cost.bulkMinMarkup, 2);
            if (rate < floor) rate = floor;
        }
        return rate;
    }

    /* 单票全成本估算（报价托底用）：口径与 costOf 一致，但下单时还没配载，
       干线按外协采购单价折算——最低一票是车次级的，不能摊到单票头上，否则小件会被顶到百元成本 */
    function estimateCost(chargeable, pieces, lineKm, service, passes) {
        var c = cfg.cost;
        var kg = Math.max(0.1, Number(chargeable) || 0.1);
        var pcs = Math.max(1, Number(pieces) || 1);
        var km = Math.max(40, Number(lineKm) || 400);
        var trunk = kg * ltlRateFor(kg, km, 1);
        var handling = kg * c.hubHandlingPerKg * (Number(passes) || 2);
        var work = c.collectPerOrder + kg * c.firstMilePerKg + pcs * (c.sortPerPiece + c.packagingPerPiece)
            + c.deliverPerOrder + kg * c.lastMilePerKg;
        var overhead = c.overheadPerOrder + kg * c.overheadPerKg;
        var factor = service === '冷链' ? 1.22 : (service === '加急' ? 1.08 : 1);
        return util.money((trunk + handling + work + overhead) * factor);
    }

    /* 计费口径的唯一来源：下单报价与订单/账单反查共用同一段公式。
       公式只有一份，明细就不必逐单存库——订单只需要运价卡号与成交续重单价两个历史锚点，
       其余附加费、折扣、托底补足都能由「卡 + 单」即时重建，每单省 ~70 字符 */
    function feeParts(card, core) {
        var c = cfg.billing;
        var service = core.service || '标准';
        var pieces = Math.max(1, Number(core.pieces) || 1);
        var chargeable = util.round(Number(core.chargeable) || 0, 2);
        var contRate = Number(core.contRate) || contRateOf(card, chargeable, core.lineKm);
        var extraKg = util.round(Math.max(0, chargeable - (Number(card.firstWeight) || 0)), 2);
        var base = Number(card.firstFee) || 0;
        var continueFee = util.money(extraKg * contRate);
        var minCharge = Number(card.minCharge) || c.minCharge;
        var subtotal = util.money(base + continueFee);
        var minimumApplied = subtotal < minCharge;
        if (minimumApplied) subtotal = minCharge;

        var fuelRate = Number(card.fuelRate) || 0;
        var fuelFee = util.money(subtotal * fuelRate);
        var remote = TMS.master.REMOTE.indexOf(core.destination) > -1;
        var remoteFee = remote ? (Number(card.remoteSurcharge) || c.remoteSurcharge) : 0;
        var insuredFee = core.isInsured ? util.money(Math.max(0, Number(core.declaredValue) || 0) * (Number(card.insuredRate) || c.insuredRate)) : 0;
        var isCod = core.paymentMethod === '到付';
        var codFee = isCod ? util.money(subtotal * (Number(card.codRate) || c.codRate)) : 0;
        var codServiceFee = isCod && Number(core.codAmount) > 0
            ? util.money(Math.max(c.codMinService, Number(core.codAmount) * c.codServiceRate)) : 0;

        var discountRate = discountFor(core.customer, core.paymentMethod);
        var gross = util.money(subtotal + fuelFee + remoteFee + insuredFee + codFee + codServiceFee);
        var discount = util.money(gross * discountRate);
        var total = util.money(gross - discount);
        /* 商务托底价：运价卡最低收费与「单票成本 × 最低加成」取高，
           阶梯折扣与 KA 返点可以让报价贴着成本走，但不能穿过成本线 */
        var estCost = estimateCost(chargeable, pieces, core.lineKm, service, core.passes);
        var costFloor = util.money(estCost * (1 + (Number(cfg.cost.quoteMinMargin) || 0)));
        var floor = Math.max(minCharge, costFloor);
        var minTopUp = total < floor ? util.money(floor - total) : 0;
        total = util.money(total + minTopUp);

        var breakdown = [
            { label: (card.name || '基础运价') + '（首重 ' + card.firstWeight + 'kg ' + util.fmt.money(base) +
                '，续重 ' + util.round(extraKg, 2) + 'kg × ' + util.fmt.money(contRate) +
                (chargeable >= 500 && contRate < Number(card.continueFee) ? '，量大折扣' : '') + '）', value: util.money(base + continueFee) },
            { label: '最低消费补差（' + util.fmt.money(minCharge) + ' 起收）', value: minimumApplied ? util.money(minCharge - (base + continueFee)) : 0 },
            { label: '燃油附加（' + util.round(fuelRate * 100, 1) + '%）', value: fuelFee },
            { label: '偏远地区附加费', value: remoteFee },
            { label: '保价费（' + util.round((Number(card.insuredRate) || c.insuredRate) * 1000, 1) + '‰ × ' + util.fmt.money(core.declaredValue) + '）', value: insuredFee },
            { label: '到付手续费（' + util.round((Number(card.codRate) || c.codRate) * 100, 1) + '%）', value: codFee },
            { label: '代收货款服务费', value: codServiceFee },
            { label: '客户折扣（' + util.round(discountRate * 100, 1) + '%）', value: -discount },
            { label: '最低收费补足', value: minTopUp }
        ].filter(function (b) { return b.value !== 0; });

        return {
            contRate: contRate, extraKg: extraKg, firstFee: base, continueFee: continueFee,
            lineKm: Number(core.lineKm) || 0,
            minCharge: minCharge, minimumApplied: minimumApplied, subtotal: subtotal,
            fuelRate: fuelRate, fuelFee: fuelFee, remote: remote, remoteFee: remoteFee,
            insuredFee: insuredFee, codFee: codFee, codServiceFee: codServiceFee,
            discountRate: discountRate, discount: discount, gross: gross,
            minTopUp: minTopUp, estCost: estCost, costFloor: costFloor,
            total: total, breakdown: breakdown
        };
    }

    function quote(params, options) {
        var p = params || {};
        var opts = options || {};
        var service = p.service || '标准';
        var card = opts.card || matchCard(p.origin, p.destination, service);
        var svc = TMS.master.SERVICES.filter(function (s) { return s.name === service; })[0] || TMS.master.SERVICES[0];
        var weight = util.round(Math.max(0, Number(p.weight) || 0), 2);
        var pieces = Math.max(1, Number(p.pieces) || 1);
        var ratio = Number(card.throwRatio) || svc.throwRatio || cfg.billing.defaultThrowRatio;
        var vol = volumeCm3(p.dims, pieces, weight, p.goods);
        var volumetric = util.round(vol / ratio, 2);
        var chargeable = util.round(Math.max(weight, volumetric, card.firstWeight), 2);

        var customer = opts.customer || null;
        if (!customer && p.customerId) customer = TMS.db.get('customers', p.customerId);
        if (!customer && p.customer) customer = TMS.db.findOne('customers', function (c) { return c.name === p.customer || c.shortName === p.customer; });

        /* 托底与量价折扣的成本基准取实际路由的干线里程，不是运价卡的区域对直线里程：
           两者能差出 30%~50%，用卡面里程保底会把大票卖到成本线以下，签收后必然亏本 */
        var routeKm = 0;
        if (TMS.network) {
            var plan = TMS.network.planOf({ origin: p.origin, destination: p.destination, service: service });
            routeKm = trunkKmOf(plan) || (plan && plan.distanceKm) || 0;
        }
        var lineKm = Math.max(Number(card.lineKm) || 0, routeKm);

        var parts = feeParts(card, {
            service: service, chargeable: chargeable, pieces: pieces, destination: p.destination,
            declaredValue: p.declaredValue, isInsured: p.isInsured, paymentMethod: p.paymentMethod,
            codAmount: p.codAmount, customer: customer, lineKm: lineKm, passes: opts.passes
        });

        return {
            cardId: card.id, cardName: card.name, cardVersion: card.version,
            service: service, throwRatio: ratio,
            actualWeight: weight, pieces: pieces, volumeCm3: util.round(vol, 0),
            volumetricWeight: volumetric, chargeableWeight: chargeable,
            firstFee: parts.firstFee, continueFee: parts.continueFee, contRate: parts.contRate,
            lineKm: parts.lineKm,
            minimumApplied: parts.minimumApplied, minCharge: parts.minCharge,
            fuelRate: parts.fuelRate, fuelFee: parts.fuelFee, remote: parts.remote, remoteFee: parts.remoteFee,
            insuredFee: parts.insuredFee, codFee: parts.codFee, codServiceFee: parts.codServiceFee,
            discountRate: parts.discountRate, discount: parts.discount, minTopUp: parts.minTopUp,
            estCost: parts.estCost, costFloor: parts.costFloor,
            gross: parts.gross,
            total: parts.total, breakdown: parts.breakdown,
            zone: zoneOf(p.origin) + '→' + zoneOf(p.destination)
        };
    }

    /* 作业成本归集：干线（车次实际分摊优先）+ 中转装卸 + 两端作业 + 间接分摊，输出毛利与毛利率 */
    function trunkKmOf(plan) {
        var segs = (plan && plan.segments) || [];
        var trunk = segs.filter(function (s) { return s.legType === 'trunk'; });
        return util.sum(trunk, 'km') || (plan && plan.distanceKm) || 0;
    }

    /* 成本构成键压缩存储（每单 13 个中文键会多背 ~0.2KB）：
       lh 干线 / hd 中转装卸 / cl 揽收 / sc 分拣 / dl 派送 / pk 包材 / oh 间接 / op 作业合计 /
       tot 总成本 / mg 毛利率 / tp 干线公里 / hp 中转次数 / bs 干线口径(0 标准 1 自有分摊 2 外协) */
    var BASIS = ['', '自有车次分摊', '外协零担'];
    function basisName(cost) { return BASIS[(cost || {}).bs] || '标准干线'; }

    function costOf(order, plan) {
        var c = cfg.cost, db = TMS.db;
        var kg = Number(order.chargeableWeight) || Number(order.weight) || 0;
        var pieces = Math.max(1, Number(order.pieces) || 1);
        var p = plan || (TMS.network ? TMS.network.planOf(order) : null);
        var km = p && p.distanceKm ? p.distanceKm : (Number(order.distanceKm) || 600);
        var trunkKm = p ? trunkKmOf(p) : km;
        var tr = order.tripId ? db.get('transports', order.tripId) : null;
        var linehaul = util.money(kg * trunkKm * c.linehaulPerKgKm);
        var basis = 0;
        var tripKg = tr ? TMS.operation.costPerKgOf(tr) : 0;
        if (tr && tripKg > 0) {
            // 分摊封顶在「这票货单独买舱位」的自采价：班次没装满是调度的空驶损失，
            // 该留在运力分析里，不该由车上唯一一票货买单，否则单票毛利率会算出 -250% 的鬼数
            var selfBuy = ltlRateFor(kg, trunkKm, 1);
            linehaul = util.money(kg * Math.min(tripKg, selfBuy || tripKg));
            basis = tr.dispatchType === 'ltl' ? 2 : 1;
        }
        var passes = Math.max(1, ((p && p.segments) || []).length ? ((p.segments || []).length - 1) : 2);
        var handling = util.money(kg * c.hubHandlingPerKg * passes);
        var collect = util.money(c.collectPerOrder + kg * c.firstMilePerKg);
        var deliver = util.money((c.deliverPerOrder + kg * c.lastMilePerKg) * (TMS.master.REMOTE.indexOf(order.destination) > -1 ? 1.25 : 1));
        var sortCost = util.money(pieces * c.sortPerPiece);
        var packaging = util.money(pieces * c.packagingPerPiece);
        var overhead = util.money(c.overheadPerOrder + kg * c.overheadPerKg);
        var service = order.service === '冷链' ? 1.22 : (order.service === '加急' ? 1.08 : 1);
        var work = util.money(collect + sortCost + deliver + packaging);
        var operation = util.money(handling + work + overhead);
        var direct = util.money(linehaul + operation);
        var total = util.money(direct * service);
        var revenue = util.money(Number(order.freight) || 0);
        return {
            lh: linehaul, hd: handling, cl: collect, sc: sortCost, dl: deliver,
            pk: packaging, oh: overhead, op: operation, tot: total, bs: basis,
            mg: revenue > 0 ? util.round((revenue - total) / revenue * 100, 1) : 0,
            tp: Math.round(trunkKm), hp: passes
        };
    }

    /* 单票成本落库只留「结论」：成本合计 + 干线口径。
       构成明细（干线/装卸/揽派/包材/间接）由 costOf 按车次分摊与费率即时重建——
       详情页一屏算一单，聚合口径全部读 cost.tot，每单可省 ~100 字符 */
    function leanCost(cost) {
        return { tot: (cost || {}).tot || 0, bs: (cost || {}).bs || 0 };
    }

    function costTotalOf(o) { return Number((o && o.cost || {}).tot) || 0; }

    /* 成本回写：下单报价时车次还不存在，干线只能按标准单价估算；
       配载/发车之后车次的真实采购价才落地，车上每一票的分摊都得跟着改。
       不回写就会一辈子挂着估算成本，账面毛利率与运力决策口径永远对不上 */
    function refreshCost(order) {
        var o = typeof order === 'string' ? TMS.db.get('orders', order) : order;
        if (!o || o.status === 'cancelled') return o;
        var lean = leanCost(costOf(o, TMS.network ? TMS.network.planOf(o) : null));
        var cur = o.cost || {};
        if (cur.tot !== lean.tot || cur.bs !== lean.bs) {
            o.cost = lean;
            TMS.db.touch('orders');
        }
        return o;
    }

    function marginOf(o) {
        var rev = Number(o && o.freight) || 0;
        if (!rev) return 0;
        return util.round((rev - costTotalOf(o)) / rev * 100, 1);
    }

    /* 展示层展开：传订单，即时重建带中文标签的单票成本明细（毛利口径与 grossAnalysis 一致） */
    function costRows(order) {
        var c = costOf(order);
        var rev = Number((order || {}).freight) || 0;
        var tot = Number(c.tot) || 0;
        return {
            items: [
                { label: '干线运输（' + (BASIS[c.bs] || '标准干线') + '）', value: c.lh || 0 },
                { label: '分拨中转装卸', value: c.hd || 0 },
                { label: '上门揽收', value: c.cl || 0 },
                { label: '分拣操作', value: c.sc || 0 },
                { label: '末端派送', value: c.dl || 0 },
                { label: '包装材料', value: c.pk || 0 },
                { label: '间接分摊', value: c.oh || 0 }
            ].filter(function (r) { return r.value; }),
            linehaul: c.lh || 0, operation: c.op || 0, total: tot,
            revenue: rev, profit: util.money(rev - tot),
            margin: rev > 0 ? util.round((rev - tot) / rev * 100, 1) : (c.mg || 0),
            linehaulBasis: basisName(c), trunkKm: c.tp, hubPasses: c.hp
        };
    }

    /* 外协零担/空运舱位成本：按公斤计费，承运商类型决定系数。
       采购价同样有量档——整车级大票能拿到协议折扣，小票则要付最低票运费，
       这两条约束决定了「自有整车 vs 外协零担」的盈亏平衡点。 */
    var LTL_BULK = [[3000, 0.8], [1000, 0.9]];

    function ltlRate(distanceKm, factor) {
        var c = cfg.cost;
        var km = Math.max(40, Number(distanceKm) || 400);
        return util.round((c.ltlBasePerKg + c.ltlPerKgKm * km) * (factor || 1), 3);
    }

    /* 采购实付单价：挂牌价再走量档。报价托底必须用这个口径，
       否则大票按挂牌价保底、采购按折扣价结算，整车业务凭空多出二三十个点毛利，
       账面毛利率会被十几票大货拉到失真 */
    function ltlRateFor(weightKg, distanceKm, factor) {
        var rate = ltlRate(distanceKm, factor);
        var kg = Math.max(1, Number(weightKg) || 1);
        for (var i = 0; i < LTL_BULK.length; i++) {
            if (kg >= LTL_BULK[i][0]) return util.round(rate * LTL_BULK[i][1], 3);
        }
        return rate;
    }

    function ltlCost(weightKg, distanceKm, carrier) {
        var c = cfg.cost;
        var kg = Math.max(1, Number(weightKg) || 1);
        var km = Math.max(40, Number(distanceKm) || 400);
        var type = carrier ? carrier.type : '陆运';
        var factor = type === '空运' ? c.airCostFactor : (type === '冷链' ? c.coldCostFactor : 1);
        var rate = ltlRateFor(kg, km, factor);
        var discount = carrier ? util.round(Math.max(0, 1 - Number(carrier.rate) / 0.95) * 0.12, 3) : 0;   // 长期协议折扣
        var total = Math.max(cfg.cost.ltlMinTicket, util.money(kg * rate * (1 - discount)));
        return { fuel: 0, toll: 0, driver: 0, fixed: 0, total: util.money(total), kg: kg, ratePerKg: rate, carrier: carrier ? carrier.name : '', carrierId: carrier ? carrier.id : '', days: 1, km: Math.round(km), discount: discount };
    }

    /* 车次成本：自有=车型公里成本（油/路/桥/胎维）+ 司机补贴 + 车辆日折旧；外协=零担/舱位按公斤报价。
       公里成本取自车型主数据，大车贵、新能源面车便宜，避免「大车拉小货」在成本上不体现 */
    function tripCost(trip, distanceKm, options) {
        var c = cfg.cost;
        var opts = options || {};
        var km = Number(distanceKm) || (trip && trip.distanceKm) || 0;
        if (opts.outsourced) return ltlCost(opts.weight, km, opts.carrier);
        var vt = TMS.master.vehicleType((trip && trip.vehicleTypeCode) || 'MAX');
        var airFactor = trip && trip.mode === '空运' ? c.airCostFactor : 1;
        var perKm = util.round(vt.costPerKm * airFactor, 2);
        var variable = util.money(km * perKm);
        var days = Math.max(1, Math.round(km / 520));
        var driver = util.money(c.driverAllowance * days);
        var fixed = util.money(c.vehicleFixed * days);
        var fuel = util.money(variable * 0.6);
        return {
            fuel: fuel, toll: util.money(variable - fuel), driver: driver, fixed: fixed,
            total: util.money(variable + driver + fixed), km: km, days: days,
            vehicleType: vt.code, costPerKm: perKm
        };
    }

    /* 整车盈亏平衡公斤数：自有车次成本 ÷ 外协零担单价，调度据此决定这条线路今天自己发车还是买舱位 */
    function breakEvenKg(vehicleTypeCode, distanceKm, mode) {
        var self = tripCost({ vehicleTypeCode: vehicleTypeCode, mode: mode || '陆运', distanceKm: distanceKm }, distanceKm);
        var ltl = ltlCost(1000, distanceKm, null);
        return util.round(self.total / Math.max(0.05, ltl.ratePerKg), 0);
    }

    /* 落库精简：一单计费只留「运价卡号 + 成交续重单价」两个历史锚点。
       卡号锁定当时生效的价格版本，成交单价锁定量折扣结果，
       附加费/折扣/托底全部按 feeParts 重建，冒烟校验要求重建合计与实收运费逐单相等 */
    function leanFees(q) {
        return { cardId: q.cardId, contRate: q.contRate, km: q.lineKm };
    }

    /* 费用行重建：订单详情/账单/改单页共用，金额必须与订单运费逐行加总相等 */
    function feeRows(order) {
        var f = (order && order.fees) || {};
        var card = (f.cardId ? TMS.db.get('rateCards', f.cardId) : null) ||
            matchCard(order.origin, order.destination, order.service);
        var parts = feeParts(card, {
            service: order.service, chargeable: Number(order.chargeableWeight) || Number(order.weight) || 0,
            pieces: order.pieces, destination: order.destination, declaredValue: order.declaredValue,
            isInsured: order.isInsured, paymentMethod: order.paymentMethod, codAmount: order.codAmount,
            customer: order.customerId ? TMS.db.get('customers', order.customerId) : null,
            contRate: f.contRate, lineKm: f.km || card.lineKm
        });
        return parts.breakdown;
    }

    /* 报价落单：运价、计费重量一次性写回订单，避免各调用点重复展开明细。
       体积重/实际重/成本合计等可反推项不落库，读取端走 weightOf/volumeOf/profitOf */
    function applyQuote(order, q) {
        order.freight = q.total;
        order.fees = leanFees(q);
        order.weight = q.actualWeight;
        order.chargeableWeight = q.chargeableWeight;
        order.cost = leanCost(costOf(order, TMS.network ? TMS.network.planOf(order) : null));
        TMS.db.touch('orders');
        // 车次存的是装载聚合值而不是引用：复磅/计费复核改了计费重量，必须回头重算所在车次
        if (order.tripId && TMS.operation) TMS.operation.recalcTrip(order.tripId);
        return order;
    }

    /* 重报价：把订单当前事实（含代收货款）还原成报价入参。
       codAmount 漏传会让复磅/改单后的重报价凭空丢掉代收服务费，实收与反查明细从此对不上 */
    function reprice(order, patch) {
        var merged = {};
        Object.keys(order).forEach(function (k) { merged[k] = order[k]; });
        Object.keys(patch || {}).forEach(function (k) { merged[k] = patch[k]; });
        var q = quote({
            origin: merged.origin, destination: merged.destination, service: merged.service,
            weight: merged.weight, pieces: merged.pieces, dims: merged.dims, goods: merged.goods,
            declaredValue: merged.declaredValue, isInsured: merged.isInsured,
            paymentMethod: merged.paymentMethod, codAmount: merged.codAmount, customerId: merged.customerId
        });
        return q;
    }

    TMS.pricing = {
        matchCard: matchCard, quote: quote, costOf: costOf, costRows: costRows,
        tripCost: tripCost, ltlCost: ltlCost, ltlRate: ltlRate, contRateOf: contRateOf,
        breakEvenKg: breakEvenKg, basisName: basisName,
        discountFor: discountFor, volumeCm3: volumeCm3, reprice: reprice, trunkKmOf: trunkKmOf,
        leanFees: leanFees, feeRows: feeRows, applyQuote: applyQuote, estimateCost: estimateCost,
        leanCost: leanCost, costTotalOf: costTotalOf, marginOf: marginOf, refreshCost: refreshCost,
        zoneOf: zoneOf, cityInfo: cityInfo, cards: cards
    };
})(window);
