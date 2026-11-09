/* 网络与路由服务：网点/分拨查询、干线班次匹配、路由规划与时效承诺、车辆装载选择 */
(function (global) {
    'use strict';

    var TMS = global.TMS = global.TMS || {};
    var util = TMS.util, master = TMS.master;

    function cityInfo(name) { return master.cityByName(name) || master.CITIES[0]; }

    function hubOf(city) { return master.hubOfCity(cityInfo(city)); }

    function branchesOf(city) {
        return TMS.db.col('branches').filter(function (b) { return b.city === city && b.status === 'active'; });
    }

    function branch(id) { return TMS.db.get('branches', id); }

    /* 揽收网点：优先按区域 hash 稳定分配，保证同一城市多次调用结果一致 */
    function collectBranch(city, key) {
        var list = branchesOf(city);
        if (!list.length) list = TMS.db.col('branches').filter(function (b) { return b.city === city; });
        if (!list.length) list = TMS.db.col('branches');
        var idx = list.length > 1 ? (util.hash(String(key || city)) % list.length) : 0;
        return list[idx] || list[0];
    }

    /* 派送网点：目的城市的直营网点 */
    function deliverBranch(city, key) { return collectBranch(city, (key || '') + '-d'); }

    /* 区县级规划网点：优先用本城区县名命中的真实网点，没有就按「城市+区县+网点」派生。
       规划台允许从某县发往某县，网点名必须落在该县，三级中转场才挂得上 */
    function districtBranch(city, district, key) {
        if (!district) return collectBranch(city, key);
        var hit = null;
        branchesOf(city).forEach(function (b) { if (!hit && (b.name || '').indexOf(district) > -1) hit = b; });
        return hit || { name: city + district + '网点', city: city, district: district };
    }

    function trips() { return TMS.db.col('trips'); }


    var routeCache = {};

    /* ---------- 路由范围分级：省 / 市 / 区 ----------
       分级只回答「这一单跨到哪一层」，一碰时效与运价口径都不碰：
       stdHours 仍由班次图算、slaHours 仍由距离与产品推、成本仍读 segments 的干线公里。
       区内直送那档会把同城两段并成一段，但合并只做「相加」，总时长与总里程一分不变。 */
    var SCOPE = {
        intra: { code: 'intra', name: '区内直送', level: 4, tone: 'success', chain: '同一区/镇', hint: '揽收点与收件点落在同一行政区，直取直送不回分拨' },
        city: { code: 'city', name: '市内跨区', level: 3, tone: 'brand', chain: '同城跨区', hint: '同城不同区，取件后回本城分拨再发派送' },
        prov: { code: 'prov', name: '省内跨市', level: 2, tone: 'warn', chain: '同省跨市', hint: '同省不同城，走省域内的干线班次' },
        cross: { code: 'cross', name: '跨省', level: 1, tone: 'danger', chain: '跨省干线', hint: '跨省的件必经干线班线，可能多次中转' },
        unknown: { code: 'unknown', name: '范围待定', level: 0, tone: 'muted', chain: '认不出起止', hint: '起止端有一头不在网络城市里，需人工核对' }
    };
    var SCOPE_ORDER = ['intra', 'city', 'prov', 'cross', 'unknown'];

    /* 段跨度：一段线路自己跨到哪一层，与整单分级不是一回事
       （跨省单的两端支线仍是「市内」段，把它们混成一列就看不出干线到底背了多少量） */
    var SEG_SCOPE = {
        same: { code: 'same', name: '市内', tone: 'success' },
        prov: { code: 'prov', name: '省内跨市', tone: 'warn' },
        cross: { code: 'cross', name: '跨省', tone: 'danger' },
        unknown: { code: 'unknown', name: '待定', tone: 'muted' }
    };

    function scopeWrap(code, sub, needDistrict) {
        var s = SCOPE[code];
        return {
            code: s.code, name: s.name, level: s.level, tone: s.tone, chain: s.chain, hint: s.hint,
            sub: sub || '', needDistrict: !!needDistrict
        };
    }

    /* 一端的三级归属：城市取自路由起止，区取自地址文本。
       区认不出就留空而不是猜一个——猜中会把同城两单误判成区内直送，
       那种单子实际还要跨片区回分拨，界面却说「直送」，等于给了条假近路 */
    function endLevels(city, text) {
        var name = master.cityByName(city) ? String(city) : cityOfText(text);
        var c = master.cityByName(name);
        if (!c) return { city: name || '', province: '', zone: '', district: '', known: false };
        var d = master.matchDistrict(c.name, text || '');
        return { city: c.name, province: c.prov, zone: c.zone, district: d ? d.name : '', known: true };
    }

    function scopeOf(od, dd) {
        if (!od || !dd || !od.known || !dd.known) return scopeWrap('unknown');
        if (od.city === dd.city) {
            if (od.district && od.district === dd.district) return scopeWrap('intra', od.district);
            /* 同城但认不出区：只能报到「市内跨区」这一档，同时把缺数据标出来——
               缺区级不代表它不是区内直送，代表这条单的地址该补全 */
            return scopeWrap('city', od.district && dd.district ? od.district + ' → ' + dd.district : '区级未填',
                !(od.district && dd.district));
        }
        if (od.province === dd.province) return scopeWrap('prov', od.province);
        /* 跨省再分一刀同大区/跨大区：华东→华南与华东→华东的干线成本根本不是一个量级，
           只看「跨省」这一格会把两种件混在同一个 KPI 里 */
        return scopeWrap('cross', od.zone === dd.zone ? '同大区跨省' : '跨大区跨省');
    }

    function orderLevels(order) {
        var o = order || {};
        return { from: endLevels(o.origin, o.senderAddress), to: endLevels(o.destination, o.receiverAddress) };
    }

    function scopeOfOrder(order) {
        var l = orderLevels(order);
        return scopeOf(l.from, l.to);
    }

    /* 三级链路文本：「上海市 浦东新区」，缺区级就只报到市，留白让页面自己标「缺区级」 */
    function chainOf(lv) {
        if (!lv || !lv.known) return lv && lv.city ? lv.city + '（不在网络）' : '—';
        return lv.province + ' ' + lv.city + (lv.district ? ' · ' + lv.district : '');
    }

    function cityOfPlace(name) { return cityOfText(name); }

    function segmentScope(seg) {
        var a = cityOfPlace(seg.from), b = cityOfPlace(seg.to);
        if (!a || !b) return SEG_SCOPE.unknown;
        if (a === b) return SEG_SCOPE.same;
        var ca = master.cityByName(a), cb = master.cityByName(b);
        if (!ca || !cb) return SEG_SCOPE.unknown;
        return ca.prov === cb.prov ? SEG_SCOPE.prov : SEG_SCOPE.cross;
    }

    /* 分级统计：管理端看板与「哪些单判不出范围」的巡检共用这一个口径。
       两处各算一遍迟早会出现「看板 12 单、列表筛出 15 单」 */
    function scopeStats(rows) {
        var counts = {};
        SCOPE_ORDER.forEach(function (k) { counts[k] = 0; });
        (rows || []).forEach(function (o) { counts[scopeOfOrder(o).code]++; });
        var total = (rows || []).length;
        return {
            total: total,
            items: SCOPE_ORDER.map(function (k) {
                return {
                    code: k, name: SCOPE[k].name, tone: SCOPE[k].tone, level: SCOPE[k].level,
                    hint: SCOPE[k].hint, count: counts[k], pct: total ? util.round(counts[k] / total * 100, 1) : 0
                };
            }),
            by: counts,
            /* 落到干线上的量 = 跨城的两档；单看跨省会低估网络压力 */
            crossCity: counts.prov + counts.cross,
            known: total - counts.unknown,
            unresolved: counts.unknown
        };
    }

    /* 区内直送合并：同城同区的件不先送分拨再倒回来，揽收车直取直送。
       这里不问分拨在哪座城：本网络里不少城市的最近分拨落在邻城（乌鲁木齐的货拉到西安分拨再回来），
       区内件照这条线画出来就是「取件后出市再回本城」，那是跨城件的走法，不是区内件的。
       合并只做相加，总时长与总里程原样保留，承诺时效与成本口径一分不动 */
    function collapseIntra(plan) {
        var segs = plan.segments || [];
        if (segs.length < 2) return;
        plan.segments = [{
            seq: 1, from: segs[0].from, to: segs[segs.length - 1].to, mode: '陆运',
            stdHours: util.sum(segs, 'stdHours'), km: util.sum(segs, 'km'), legType: 'direct'
        }];
    }

    /* 服务产品 → 规划策略：加急抢时效、经济拼成本、冷链少中转少暴露，标准走均衡 */
    var SERVICE_STRATEGY = { '加急': '时效', '经济': '成本', '冷链': '稳妥', '标准': '均衡' };

    /* 规划路由：命中已维护路由则复用（保证路由页可统计偏差），否则按班次图智能规划 */
    function planRoute(origin, destination, service, options) {
        var opts = options || {};
        var levels = opts.levels || { from: endLevels(origin, ''), to: endLevels(destination, '') };
        /* 缓存键带上区级归属：区内直送与市内跨区的段结构不同，
           只按城市对缓存会让先算的那一条决定后来所有同城单长什么样 */
        var key = origin + '>' + destination + '>' + (service || '标准') +
            '>' + (levels.from.district || '') + '~' + (levels.to.district || '') +
            '>' + (opts.strategy || '') + '~' + (opts.maxTransfers == null ? '' : opts.maxTransfers);
        if (!opts.noCache && routeCache[key]) return routeCache[key];

        var stored = TMS.db.findOne('routes', function (r) {
            return r.status === 'active' && r.origin === origin && r.destination === destination;
        });
        var plan;
        if (stored) {
            plan = {
                routeId: stored.id, mode: stored.mode, priority: stored.priority,
                segments: util.clone(stored.segments), totalStdHours: Number(stored.totalStdHours) || 0,
                distanceKm: Number(stored.distanceKm) || sumKm(stored.segments), source: 'route',
                planner: stored.planner || '', strategy: stored.strategy || '',
                trunkCost: Number(stored.trunkCost) || 0, reliability: Number(stored.reliability) || 0
            };
        } else {
            var ob = collectBranch(origin, key), db2 = collectBranch(destination, key);
            var wantMode = service === '加急' ? '空运' : '陆运';
            var strategy = opts.strategy || SERVICE_STRATEGY[service] || '均衡';
            var segOpts = { strategy: strategy, maxTransfers: opts.maxTransfers, originDistrict: levels.from.district, destDistrict: levels.to.district };
            var segs = master.planSegments(ob, db2, wantMode, segOpts);
            /* 空运通道不是条条线都有：没有含空运段的路径就用陆运时效优先重出一遍，
               否则整条路由退化成直线估时，标准时长会比真实班线松一大截 */
            if (!segs && wantMode === '空运') {
                segs = master.planSegments(ob, db2, '陆运', { strategy: '时效', maxTransfers: opts.maxTransfers, originDistrict: segOpts.originDistrict, destDistrict: segOpts.destDistrict });
            }
            if (!segs) return null;
            plan = {
                routeId: '', mode: segs.mode, priority: segs.priority, segments: segs.segments,
                totalStdHours: segs.totalStdHours, distanceKm: segs.distanceKm, source: 'temp',
                planner: segs.planner, strategy: segs.strategy,
                transitHours: segs.transitHours, waitHours: segs.waitHours, transferHours: segs.transferHours,
                trunkCost: segs.trunkCost, reliability: segs.reliability
            };
        }
        var svc = master.SERVICES.filter(function (s) { return s.name === (service || '标准'); })[0] || master.SERVICES[0];
        var speed = svc.code === 'EXP' ? 0.68 : (svc.code === 'ECO' ? 1.35 : (svc.code === 'CLD' ? 0.9 : 1));
        plan.stdHours = Math.max(12, Math.round(plan.totalStdHours * speed));
        plan.slaHours = Math.max(plan.stdHours + 6, svc.slaHours * (1 + Math.round(plan.distanceKm / 1200) * 0.35));
        plan.slaHours = Math.round(plan.slaHours);
        plan.serviceName = svc.name;
        attachScope(plan, levels);
        if (!opts.noCache) routeCache[key] = plan;
        return plan;
    }

    /* 分级结论挂在读出来的 plan 上，不落库：改地址不用重刷历史单，
       口径也只有一个——planOf 什么时候算都是这一套 */
    function attachScope(plan, levels) {
        plan.levels = levels;
        plan.scope = scopeOf(levels.from, levels.to);
        plan.chain = { from: chainOf(levels.from), to: chainOf(levels.to) };
        if (plan.scope.code === 'intra') collapseIntra(plan);
        (plan.segments || []).forEach(function (s) {
            var sc = segmentScope(s);
            s.scopeCode = sc.code;
            s.scopeName = sc.name;
            s.scopeTone = sc.tone;
        });
        plan.scopeSegmentCount = (plan.segments || []).filter(function (s) {
            return s.scopeCode === 'cross' || s.scopeCode === 'prov';
        }).length;
        plan.trunkLegs = (plan.segments || []).filter(function (s) { return s.legType === 'trunk'; }).length;
        plan.transfers = transferOps(plan);
        return plan;
    }

    /* 中途枢纽装卸计划：从相邻段的衔接点派生（干线与区域支线同口径）。
       新规划的段次自带 transferIn 与班次事实；老路由段没有这些字段，
       按分拨名回查班次表补齐——装卸/候车时长不能因为路由是旧规划就凭空消失。
       支线段只在自带 transferIn 时才出装卸计划：揽收后的第一段支线，入仓作业已含在揽收时长里 */
    function transferOps(plan) {
        var segs = ((plan && plan.segments) || []).filter(function (s) { return s.legType === 'trunk' || s.legType === 'feeder'; });
        var ops = [];
        for (var i = 1; i < segs.length; i++) {
            var prev = segs[i - 1], cur = segs[i];
            if (prev.to !== cur.from) continue;   // 段不衔接（估算/旧数据）就不编造装卸
            if (cur.legType === 'feeder' && !cur.transferIn) continue;
            var t = cur.transferIn || {};
            var hub = master.hubByNameOrId(cur.from);
            var trip = cur.tripId ? TMS.db.get('trips', cur.tripId) : TMS.db.findOne('trips', function (x) {
                return x.fromHubName === cur.from && x.toHubName === cur.to;
            });
            var prevTrip = prev.tripId ? TMS.db.get('trips', prev.tripId) : TMS.db.findOne('trips', function (x) {
                return x.fromHubName === prev.from && x.toHubName === prev.to;
            });
            var unload = t.unloadHours || 1;
            var sort = t.sortHours || (hub && hub.role === '中心枢纽' ? 1 : 2);
            var load = t.loadHours || 1;
            var wait = t.waitHours != null ? t.waitHours :
                (cur.waitHours != null ? cur.waitHours : (trip ? master.waitHoursOf(trip) : (cur.legType === 'feeder' ? 2 : 12)));
            ops.push({
                seq: ops.length + 1, hub: cur.from, hubId: t.hubId || (hub && hub.id) || '',
                city: t.city || (hub && hub.city) || cityOfText(cur.from) || '',
                level: t.level || (hub ? 1 : 0),
                prevTripCode: t.prevTripCode || prev.tripCode || (prevTrip && prevTrip.code) || (prev.legType === 'feeder' ? '区域支线班车' : ''),
                nextTripCode: cur.tripCode || (trip && trip.code) || (cur.legType === 'feeder' ? '区域支线班车' : ''),
                arriveAt: t.prevArriveAt || prev.arriveAt || (prevTrip && prevTrip.arriveAt) || '',
                departAt: cur.departAt || (trip && trip.departAt) || '',
                unloadHours: unload, sortHours: sort, loadHours: load, waitHours: wait,
                totalHours: unload + sort + load + wait,
                dockIn: 'D' + (util.hash(cur.from + '#in' + (prev.tripId || prev.seq)) % 8 + 1),
                dockOut: 'D' + (util.hash(cur.from + '#out' + (cur.tripId || cur.seq)) % 8 + 1)
            });
        }
        return ops;
    }

    /* 规划台：同一 OD 的全部可行方案同场评分，供调度对比采纳。
       与 planRoute 的「命中已维护路由就复用」不同——这里永远看当前班次图，
       否则班次调整后规划台还在推荐旧路由，对比就成了摆饰 */
    function planOptions(origin, destination, service, options) {
        var opts = options || {};
        var svc = master.SERVICES.filter(function (s) { return s.name === (service || '标准'); })[0] || master.SERVICES[0];
        var strategy = master.STRATEGIES[opts.strategy] ? opts.strategy : (SERVICE_STRATEGY[svc.name] || '均衡');
        var mode = opts.mode || (svc.code === 'EXP' ? '空运' : '陆运');
        var key = origin + '>' + destination;
        var ob = districtBranch(origin, opts.originDistrict, key), db2 = districtBranch(destination, opts.destDistrict, key);
        var mo = { strategy: strategy, maxTransfers: opts.maxTransfers, withCandidates: true, originDistrict: opts.originDistrict, destDistrict: opts.destDistrict };
        var best = master.planSegments(ob, db2, mode, mo);
        var airFallback = false;
        if (!best && mode === '空运') {
            airFallback = true;
            best = master.planSegments(ob, db2, '陆运', { strategy: '时效', maxTransfers: opts.maxTransfers, withCandidates: true, originDistrict: opts.originDistrict, destDistrict: opts.destDistrict });
        }
        if (!best) return null;
        var levels = { from: endLevels(origin, opts.originDistrict || ''), to: endLevels(destination, opts.destDistrict || '') };
        var list = best.candidates || [best];
        list.forEach(function (p) {
            p.origin = origin;
            p.destination = destination;
            p.originDistrict = opts.originDistrict || '';
            p.destDistrict = opts.destDistrict || '';
            attachScope(p, levels);
        });
        return {
            origin: origin, destination: destination, service: svc.name,
            strategy: best.strategy || strategy, mode: mode, airFallback: airFallback,
            candidates: list, best: best
        };
    }

    /* 采纳方案落路由表：同 OD 已有路由就改段次（保留偏离计数），没有则建档。
       段次克隆后落库，规划台里的候选对象不被路由行反向引用 */
    function adoptRoutePlan(plan, actor) {
        if (!plan || !(plan.segments || []).length) return { ok: false, message: '方案没有段次，无法采纳' };
        if (!plan.origin || !plan.destination) return { ok: false, message: '方案缺少起讫城市' };
        var db = TMS.db;
        var old = db.findOne('routes', function (r) { return r.origin === plan.origin && r.destination === plan.destination; });
        var patch = {
            origin: plan.origin, destination: plan.destination,
            originDistrict: plan.originDistrict || '', destDistrict: plan.destDistrict || '',
            originZone: (master.cityByName(plan.origin) || {}).zone || '',
            destinationZone: (master.cityByName(plan.destination) || {}).zone || '',
            mode: plan.mode, priority: plan.priority, segments: util.clone(plan.segments),
            totalStdHours: plan.totalStdHours, distanceKm: plan.distanceKm,
            planner: plan.planner || 'smart2', strategy: plan.strategy || '',
            transfers: plan.transfers ? plan.transfers.length : (plan.trunkLegs > 0 ? plan.trunkLegs - 1 : 0),
            trunkLegs: plan.trunkLegs || 0, trunkCost: plan.trunkCost || 0,
            reliability: plan.reliability || 0, status: 'active'
        };
        var row;
        if (old) {
            db.update('routes', old.id, patch);
            row = old;
        } else {
            patch.deviationCount = 0;
            row = db.create('routes', patch);
        }
        db.commit('routes', row.id, '采纳智能路由');
        TMS.audit.log(old ? 'network.update' : 'network.create', 'routes', row.id,
            plan.origin + '→' + plan.destination + ' 采纳' + (plan.label || '') + '方案：' +
            (plan.trunkLegs || 0) + ' 段干线 / ' + patch.transfers + ' 次中转装卸', actor);
        invalidateCache();
        return { ok: true, id: row.id, created: !old };
    }

    function sumKm(segments) {
        return util.sum(segments || [], 'km');
    }

    /* 订单路由读取：路由段不落在订单行上，按路由主数据即时派生（缓存命中，改线后自然跟随） */
    function planOf(order) {
        if (!order) return null;
        var plan = planRoute(order.origin, order.destination, order.service, { levels: orderLevels(order) });
        if (plan) return plan;
        var fallback = {
            routeId: order.routeId || '', mode: '陆运', segments: [], source: 'order',
            distanceKm: Number(order.distanceKm) || 0, stdHours: Number(order.stdHours) || 24,
            totalStdHours: Number(order.stdHours) || 24, slaHours: Number(order.slaHours) || 72
        };
        return attachScope(fallback, orderLevels(order));
    }

    /* 干线班次匹配：给车次调度用（同段取最早发车的活动班次） */
    function tripFor(fromHubId, toHubId, mode) {
        var list = trips().filter(function (t) {
            return t.status === 'active' && t.fromHub === fromHubId && t.toHub === toHubId && (!mode || t.mode === mode);
        });
        util.sortBy(list, 'departAt', 'asc');
        return list[0] || null;
    }

    /* 装载选择：按重量+体积挑最小可容纳车型，避免大车拉小货 */
    function pickVehicle(weight, volumeCm3, pieces) {
        var needKg = Math.max(1, Number(weight) || 1);
        var needM3 = Math.max(0.01, (Number(volumeCm3) || 0) / 1000000);
        var list = master.VEHICLE_TYPES.slice().sort(function (a, b) { return a.loadKg - b.loadKg; });
        for (var i = 0; i < list.length; i++) {
            if (list[i].loadKg >= needKg && list[i].volumeM3 >= needM3) return list[i];
        }
        return list[list.length - 1];
    }

    /* 车次装载：从待运订单里按目的枢纽凑载，返回 {orders, weight, volume, pieces} */
    function loadPlan(candidateOrders, vehicle) {
        var v = vehicle || master.vehicleType('MAX');
        var out = { orders: [], weight: 0, volumeM3: 0, pieces: 0 };
        candidateOrders.forEach(function (o) {
            var w = Number(o.chargeableWeight || o.weight) || 0;
            var vol = TMS.order.volumeOf(o) / 1000000;
            if (out.weight + w > v.loadKg * 0.95 || out.volumeM3 + vol > v.volumeM3 * 0.92) return;
            out.orders.push(o);
            out.weight = util.round(out.weight + w, 2);
            out.volumeM3 = util.round(out.volumeM3 + vol, 3);
            out.pieces += Number(o.pieces) || 1;
        });
        out.capacityKg = v.loadKg;
        out.loadRate = v.loadKg ? util.round(out.weight / v.loadKg * 100, 1) : 0;
        out.vehicle = v;
        return out;
    }

    /* 时效承诺：下单时给客户的预计送达时间 */
    function promiseAt(createdAt, plan, service) {
        var hours = (plan && plan.slaHours) || 72;
        if (service === '冷链') hours -= 6;
        return util.iso(util.addHours(util.toDate(createdAt), hours));
    }

    /* 偏差判定：实际轨迹节点与计划路由段不一致（错分/绕转） */
    function deviates(plan, fromName, toName) {
        if (!plan || !plan.segments) return false;
        for (var i = 0; i < plan.segments.length; i++) {
            var s = plan.segments[i];
            if (String(s.from).indexOf(String(fromName || '').slice(0, 2)) > -1 &&
                String(s.to).indexOf(String(toName || '').slice(0, 2)) === -1) return true;
        }
        return false;
    }

    function invalidateCache() { routeCache = {}; }

    /* ---------- 电子围栏 ---------- */

    /* 围栏按城市名片判定归属：扫描地点写的是「哈尔滨浦东新区营业部」这类网点/分拨名，
       取文本里能命中的最长城市名作为作业城市；命中不了就是地点写得没法核对。
       必须取最长匹配，短名先命中会把「吉林」算进「辽宁省」这类前缀冲突里。 */
    function cityOfText(text) {
        var s = String(text || '');
        if (!s) return '';
        var best = '';
        master.CITIES.forEach(function (c) {
            if (s.indexOf(c.name) > -1 && c.name.length > best.length) best = c.name;
        });
        return best;
    }

    /* ---------- 电子围栏：几何判定与三类围栏（图1） ---------- */

    /* 覆盖判定按几何算：勾过多边形的围栏走射线法，只填了半径的走圆判定。
       多边形优先是因为现场勾出来的边界本来就不是圆——「沿江往东三公里」用一个圆去套，
       要么把对岸不送的件圈进来，要么把自己这片边缘漏掉。
       半径是没勾边界时的兜底：老数据、快速建圈、只知圆心不知形状的场地都靠它 */
    function fenceRing(g) {
        var p = g && g.polygon;
        return Array.isArray(p) && p.length >= (cfg().fence.minPoints) ? p : null;
    }

    function pointInFence(point, fence) {
        if (!point || !fence || point.lat == null) return false;
        var ring = fenceRing(fence);
        if (ring) return util.pointInRing(point, ring);
        if (!fence.center) return false;
        return util.distanceKm(fence.center, point) * 1000 <= (Number(fence.radiusM) || 0);
    }

    /* 命中围栏要按类型问：城市罩在「机构派送围栏」里，不代表它被某个「到货围栏」罩住。
       两类混在同一个函数里判，页面上「到货缺口」和「派送缺口」就会永远相等 */
    function fencesOf(type) {
        var all = TMS.db.col('geofences');
        if (!type || type === 'any') return all.filter(function (g) { return g.status === 'active'; });
        return all.filter(function (g) { return g.status === 'active' && g.type === type; });
    }

    function fencesAt(point, type) {
        if (!point) return [];
        return fencesOf(type).filter(function (g) { return pointInFence(point, g); });
    }

    function fenceAt(point, type) {
        var hit = fencesAt(point, type);
        return hit.length ? hit[0] : null;
    }

    /* 不传类型时保持老行为：任意一张在用围栏罩住即算覆盖（覆盖缺口巡检用的就是这个口径） */
    function fenceOfCity(city, type) {
        var c = typeof city === 'string' ? master.cityByName(city) : city;
        if (!c) return null;
        if (type === undefined) {
            var hit = null;
            TMS.db.col('geofences').forEach(function (g) {
                if (hit || g.status !== 'active') return;
                if (pointInFence(c, g)) hit = g;
            });
            return hit;
        }
        return fenceAt(c, type);
    }

    /* 一张围栏罩住了哪些城市：勾画与改半径的直接后果，围栏详情要拿它说话 */
    function citiesInFence(fence) {
        if (!fence) return [];
        return master.CITIES.filter(function (c) { return pointInFence(c, fence); });
    }

    /* 图形摘要只算一次，页面列表和详情共用：面积用鞋带公式，圆心取顶点均值。
       没勾边界的围栏面积取 π r²——台账要按面积排序，半径圆报 0 就会永远沉在末尾 */
    function geometryOf(g) {
        var ring = fenceRing(g);
        var radius = Number((g || {}).radiusM) || 0;
        return {
            kind: ring ? 'polygon' : 'circle',
            points: ring ? ring.length : 0,
            areaKm2: ring ? util.ringAreaKm2(ring) : util.round(Math.PI * radius * radius / 1e6, 2),
            center: ring ? util.ringCentroid(ring) : ((g && g.center) || null),
            radiusM: radius
        };
    }

    /* 图1 右支：先取派送编号，取不到就退化成「先看人工指定」；
       这里补的是中间那格——收件点落进了哪位派送员的编号围栏，就自动绑那位。
       不落在任何编号围栏里时必须由人指定：系统猜一个跨城的派送员，
       件到了才发现不归他送，比不绑更糟 */
    function courierFenceAt(point) {
        var g = fenceAt(point, 'courier');
        if (!g) return null;
        var e = TMS.db.get('employees', g.refId);
        if (!e) return null;
        return { fence: g, courier: e };
    }

    /* 收件点罩不进任何片区时，最近的那张只能当候选，不能当结论：
       本演示的收件点是城市质心，一个城区分成几片时质心必然只落在其中一片，
       其余城市系统给出的就是「离市中心最近的派送员」——派单弹层据此默认勾选，
       但必须由调度确认，把判不准写成自动绑就是把错单派出去 */
    function nearestCourierFence(point, city) {
        if (!point) return null;
        var best = null, bestKm = Infinity;
        fencesOf('courier').forEach(function (g) {
            if (city && g.city !== city) return;
            var c = g.center || geometryOf(g).center;
            if (!c) return;
            var km = util.distanceKm(point, c);
            if (km < bestKm) { bestKm = km; best = g; }
        });
        if (!best) return null;
        return { fence: best, courier: TMS.db.get('employees', best.refId) || null, km: util.round(bestKm, 1) };
    }

    /* 一名派送员当前挂着哪些在用编号围栏：一个派送员可以有多个片区（城东/城西），
       但一个点只该落进一名派送员的围栏，勾重了要能在界面上看出来 */
    function fencesOfCourier(empId) {
        return TMS.db.col('geofences').filter(function (g) {
            return g.type === 'courier' && g.refId === empId && g.status === 'active';
        });
    }

    function fenceLabel(g) {
        if (!g) return '';
        return (cfg().fence.LABEL[g.type] || g.type) + '·' + (g.name || g.id);
    }

    /* 离某个点最近的服务城市：勾画出来的边界不一定压在质心上，建档表单和落库都要靠它反查归属 */
    function nearestCity(point) {
        if (!point || point.lat == null) return null;
        var near = null, km = Infinity;
        master.CITIES.forEach(function (c) {
            var d = util.distanceKm(point, c);
            if (d < km) { km = d; near = c; }
        });
        return near ? { city: near, km: util.round(km, 1) } : null;
    }

    /* 落库前把图形事实算齐：顶点、圆心、面积、所在城市。
       城市按圆心就近反查而不是照抄用户选的——勾在杭州边上却挂着「上海」的围栏，
       覆盖巡检会把它当上海的缺口一直报， nobody 看得懂 */
    function normalizeShape(patch) {
        var ring = Array.isArray(patch.polygon) ? patch.polygon.filter(function (p) { return p && p.lat != null && p.lng != null; }) : [];
        var out = util.clone(patch);
        if (ring.length) {
            out.polygon = ring;
            out.center = util.ringCentroid(ring);
            out.areaKm2 = util.ringAreaKm2(ring);
            out.shape = 'polygon';
        } else {
            delete out.polygon;
            out.shape = 'circle';
            /* 半径围栏必须有圆心才判得了点：没给圆心就按所属城市中心落，
               否则这张圈在 pointInFence 里永远返回 false，等于勾了个不存在的地方 */
            out.center = out.center || util.clone(master.cityByName(out.city)) || null;
            out.areaKm2 = util.round(Math.PI * Math.pow(Number(out.radiusM) || 0, 2) / 1e6, 2);
        }
        if (out.center) {
            var near = nearestCity(out.center);
            if (near) out.city = near.city.name;
        }
        return out;
    }

    function saveFence(patch, actor) {
        var cfgF = cfg().fence, db = TMS.db;
        var id = patch.id;
        var old = id ? db.get('geofences', id) : null;
        if (id && !old) return { ok: false, message: '围栏不存在：' + id };
        var type = patch.type || (old && old.type) || 'branch';
        if (cfgF.TYPES.indexOf(type) < 0) return { ok: false, message: '未知围栏类型：' + type };
        if (!String(patch.name || (old && old.name) || '').trim()) return { ok: false, message: '围栏名称不能为空' };
        var pts = Array.isArray(patch.polygon) ? patch.polygon : null;
        if (pts && (pts.length < cfgF.minPoints || pts.length > cfgF.maxPoints)) {
            return { ok: false, message: '勾画需要 ' + cfgF.minPoints + '~' + cfgF.maxPoints + ' 个顶点，当前 ' + pts.length + ' 个' };
        }
        var radius = Number(patch.radiusM != null ? patch.radiusM : (old && old.radiusM));
        if (!pts && !(radius > 0)) return { ok: false, message: '要么勾出边界，要么给一个大于 0 的半径' };
        if (type === 'courier') {
            var rid = patch.refId != null ? patch.refId : (old && old.refId);
            var e = rid ? db.get('employees', rid) : null;
            if (!e) return { ok: false, message: '编号围栏必须绑定一位在册员工' };
            if (e.role !== 'deliveryman') return { ok: false, message: e.name + ' 是' + (e.role || '其他角色') + '，不能挂派送员编号围栏' };
        }
        var body = normalizeShape({
            name: String(patch.name || (old && old.name)).trim(), type: type, city: patch.city || (old && old.city) || '',
            refId: patch.refId != null ? patch.refId : (old && old.refId) || '', status: patch.status || (old && old.status) || 'active',
            radiusM: Math.round(radius || cfgF.defaultRadiusM), polygon: pts, note: patch.note != null ? patch.note : (old && old.note) || ''
        });
        var row;
        if (old) {
            row = db.update('geofences', old.id, body);
            if (row) db.commit('geofences', row.id, 'geofence:save');
        } else {
            row = db.create('geofences', body);
            if (row) db.commit('geofences', row.id, 'geofence:save');
        }
        if (!row) return { ok: false, message: '围栏未能落库' };
        if (TMS.audit) TMS.audit.log(old ? 'geofence.update' : 'geofence.create', 'geofences', row.id,
            (old ? '调整' : '新建') + fenceLabel(row) + (body.shape === 'polygon' ? '（勾画 ' + body.polygon.length + ' 点 / ' + body.areaKm2 + ' km²）' : '（半径 ' + body.radiusM + ' m）'), actor || '系统');
        invalidateCache();
        return { ok: true, row: row, shape: body.shape };
    }

    function removeFence(id, actor) {
        var g = TMS.db.get('geofences', id);
        if (!g) return { ok: false, message: '围栏不存在：' + id };
        TMS.db.remove('geofences', id);
        if (TMS.audit) TMS.audit.log('geofence.remove', 'geofences', id, '删除' + fenceLabel(g), actor || '系统');
        invalidateCache();
        return { ok: true, row: g };
    }

    /* v11 老库补建档：升级前的库只有到货/派送两类围栏，编号围栏一条没有，
       图1 右支会永远停在「需手动指定派送编号」。这里按在册派送员在派送围栏内部补一格，
       收件点落进谁的格子就自动绑谁。刻意每五座城留空一座——全绑上就看不出那条支线了。
       编号围栏必须待在宿主围栏里面，否则「落进编号围栏却不在派送围栏内」这种自相矛盾
       的件会天天出现，所以每次落点都用几何反查校一遍，罩不住就缩 */
    function backfillCourierFences() {
        var db = TMS.db;
        var host = {};
        db.col('geofences').forEach(function (g) {
            if (g.status === 'active' && g.type !== 'courier' && g.city && !host[g.city]) host[g.city] = g;
        });
        var byCity = {};
        db.col('employees').forEach(function (e) {
            if (e.role !== 'deliveryman' || e.status !== 'active' || !host[e.city]) return;
            (byCity[e.city] = byCity[e.city] || []).push(e);
        });
        var cities = util.unique(db.col('geofences').filter(function (g) {
            return byCity[g.city];
        }).map(function (g) { return g.city; })).sort();
        var created = 0, skipped = 0;
        cities.forEach(function (city, ci) {
            if (ci % 5 === 4) return;
            var h = host[city];
            var hc = (h && (h.center || geometryOf(h).center)) || null;
            if (!hc) return;
            var span = Math.max(600, Number((h && h.radiusM) || 3000) * 0.5);
            (byCity[city] || []).slice(0, 2).forEach(function (e, ei) {
                var ang = Math.PI * ei + (ei ? 2.1 : 0.4);
                var fit = 0;
                /* 圆心外移和半径一起缩：只缩半径会让小格子仍停在宿主边界上 */
                for (var f = 1; f >= 0.2 && !fit; f *= 0.6) {
                    var off = span * 0.5 * f;
                    var pt = {
                        lat: hc.lat + off * Math.sin(ang) / 111320,
                        lng: hc.lng + off * Math.cos(ang) / (111320 * Math.cos(hc.lat * Math.PI / 180))
                    };
                    var ring = util.blobRing(pt, Math.max(300, span * 0.26 * f));
                    /* 一个顶点漏出宿主围栏就等于把这条片区的件判给送不到的人 */
                    if (ring.every(function (p) { return pointInFence(p, h); })) fit = { ring: ring, radius: span * 0.26 * f };
                }
                if (!fit) { skipped++; return; }
                if (saveFence({
                    name: e.name + '（' + (e.badge || e.id) + '）责任片区', type: 'courier',
                    city: city, refId: e.id, radiusM: Math.round(fit.radius), polygon: fit.ring,
                    status: 'active', note: '升级补建档，边界待现场重勾'
                }, 'v11 补建档').ok) created++;
            });
        });
        return { created: created, skipped: skipped, cities: cities.length };
    }

    function cfg() { return TMS.cfg; }    /* 越界统计只吃「显式写了地点」的流水：常规作业地点由订单+节点派生、根本不落库，
       留下的都是人工改判或异常上报，正好是要拿围栏核对的那批 */
    function fenceAudit(days) {
        var db = TMS.db;
        var cutoff = util.addDays(util.now(), -(days || 30)).getTime();
        var fences = db.col('geofences');
        var coveredCache = {};
        function coveredBy(city) {
            if (coveredCache[city] === undefined) coveredCache[city] = fenceOfCity(city);
            return coveredCache[city];
        }
        var breaches = {}, unknown = 0, covered = 0, total = 0;
        db.col('scans').forEach(function (s) {
            if (!s.location) return;
            if (util.toDate(s.opTime).getTime() < cutoff) return;
            total++;
            var city = cityOfText(s.location);
            if (!city) { unknown++; return; }
            if (coveredBy(city)) { covered++; return; }
            var b = breaches[city] || (breaches[city] = {
                city: city, count: 0, orders: [], nodes: {},
                branches: db.col('branches').filter(function (x) { return x.city === city; }).length
            });
            b.count++;
            b.nodes[s.node] = (b.nodes[s.node] || 0) + 1;
            if (b.orders.length < 4 && s.orderId) b.orders.push(s.orderId);
        });
        var list = Object.keys(breaches).map(function (k) {
            var b = breaches[k];
            var c = master.cityByName(b.city);
            if (!c) return null;
            var nearest = null, nearKm = Infinity;
            fences.forEach(function (g) {
                if (!g.center || g.status !== 'active') return;
                var km = util.distanceKm(c, g.center);
                if (km < nearKm) { nearKm = km; nearest = g; }
            });
            b.center = { lat: c.lat, lng: c.lng };
            /* 建议半径：罩住本市质心是底线，再把最近的在用围栏纳进半程，
               一张 25 km 的城市围栏能顺手管住广佛这类近距城市群，比一城一张更贴近实际布点 */
            b.radiusM = Math.max(6000, Math.min(60000, Math.round(nearKm * 500 / 500) * 500));
            b.nearestName = nearest ? nearest.name : '';
            b.nearestKm = Math.round(nearKm);
            b.hub = (master.nearestHub(c) || {}).name || '';
            return b;
        }).filter(Boolean);
        return {
            days: days || 30, total: total, covered: covered, unknown: unknown,
            breaches: util.sortBy(list, 'count', 'desc'),
            coveredCities: master.CITIES.filter(function (x) { return !!fenceOfCity(x); }).length,
            cityCount: master.CITIES.length,
            fenceRows: fences.length,
            activeRows: fences.filter(function (g) { return g.status === 'active'; }).length
        };
    }

    /* 图1 的三个问题一次问完，页面与巡检共读这一份口径：
       到货——分拨落点有没有被在用到货围栏罩住，没有就是「件到了但系统没认定过这块场地」；
       派送——收件点有没有落在机构派送围栏内，没有就是「这城的件只能到网点自提」；
       编号——本城有在册派送员、有在用派送围栏，却一张编号围栏都没勾，就是「每件都要人工指派」。
       收件点取城市质心：演示数据没有区级地理编码，射线法打在勾画边界上的精度就到城市这一格，
       所以缺口按城市报、不按单票报，免得把「判不了」写成「判错」 */
    function fenceGaps(days) {
        var cutoff = util.addDays(util.now(), -(days || 30)).getTime();
        var scanCount = {};
        TMS.db.col('scans').forEach(function (s) {
            if (!s.location || util.toDate(s.opTime).getTime() < cutoff) return;
            var c = cityOfText(s.location);
            if (c) scanCount[c] = (scanCount[c] || 0) + 1;
        });
        var byCity = { deliveryman: {}, branchCount: {}, staff: {} };
        TMS.db.col('employees').forEach(function (e) {
            if (e.role === 'deliveryman' && e.status === 'active') byCity.deliveryman[e.city] = (byCity.deliveryman[e.city] || 0) + 1;
        });
        TMS.db.col('branches').forEach(function (b) {
            byCity.branchCount[b.city] = (byCity.branchCount[b.city] || 0) + 1;
            byCity.staff[b.city] = (byCity.staff[b.city] || 0) + (Number(b.staffCount) || 0);
        });
        /* 在用围栏按城市计数：一张城市都没有才算缺口，
           勾了但罩不住质心的属于「边界画错了」，由 legacyBox 与覆盖巡检那两格说话 */
        var drawn = { hub: {}, branch: {}, courier: {} };
        fencesOf('any').forEach(function (g) {
            if (drawn[g.type]) drawn[g.type][g.city] = (drawn[g.type][g.city] || 0) + 1;
        });
        var hubs = master.HUBS.map(function (h) {
            var f = fenceAt(master.cityByName(h.city), 'hub');
            return {
                id: h.id, hub: h.name, city: h.city, zone: h.zone,
                fence: f ? f.id : '', fenceName: f ? f.name : '',
                drawn: !!f && !!fenceRing(f), missing: !f
            };
        });
        var rows = master.CITIES.map(function (c) {
            var branch = fenceOfCity(c, 'branch');
            var couriers = byCity.deliveryman[c.name] || 0;
            var courierFences = drawn.courier[c.name] || 0;
            return {
                city: c.name, zone: c.zone, scans: scanCount[c.name] || 0,
                branches: byCity.branchCount[c.name] || 0, staff: byCity.staff[c.name] || 0,
                couriers: couriers, hubFences: drawn.hub[c.name] || 0,
                branchFences: drawn.branch[c.name] || 0, courierFences: courierFences,
                branchFence: branch ? branch.id : '', branchName: branch ? branch.name : '',
                deliverMissing: !branch,
                courierMissing: !courierFences && couriers > 0 && !!branch
            };
        });
        var legacy = TMS.db.col('geofences').filter(function (g) { return g.status === 'active' && g.legacyBox; });
        return {
            days: days || 30, rows: rows, hubs: hubs, legacy: legacy,
            hubGap: hubs.filter(function (h) { return h.missing; }),
            /* 没人扫描也没网点的城市不算派送缺口：报了也没人来补勾 */
            deliverGap: rows.filter(function (r) { return r.deliverMissing && (r.scans > 0 || r.branches > 0); }),
            courierGap: rows.filter(function (r) { return r.courierMissing; })
        };
    }

    TMS.network = {
        cityOfText: cityOfText, fenceOfCity: fenceOfCity, pointInFence: pointInFence,
        citiesInFence: citiesInFence, fenceAudit: fenceAudit, fenceGaps: fenceGaps, nearestCity: nearestCity,
        fenceRing: fenceRing, fencesOf: fencesOf, fencesAt: fencesAt, fenceAt: fenceAt,
        geometryOf: geometryOf, courierFenceAt: courierFenceAt, nearestCourierFence: nearestCourierFence, fencesOfCourier: fencesOfCourier,
        saveFence: saveFence, removeFence: removeFence, fenceLabel: fenceLabel,
        backfillCourierFences: backfillCourierFences,
        cityInfo: cityInfo, hubOf: hubOf,
        branchesOf: branchesOf, branch: branch, collectBranch: collectBranch, deliverBranch: deliverBranch,
        planRoute: planRoute, planOf: planOf, tripFor: tripFor, pickVehicle: pickVehicle, loadPlan: loadPlan,
        promiseAt: promiseAt, deviates: deviates, invalidateCache: invalidateCache,
        /* 多干线智能规划：候选对比 / 中途枢纽装卸 / 采纳落库 */
        planOptions: planOptions, transferOps: transferOps, adoptRoutePlan: adoptRoutePlan,
        SERVICE_STRATEGY: SERVICE_STRATEGY, STRATEGIES: master.STRATEGIES,
        /* 范围分级：省市区三级归属与「这一单跨到哪一层」的唯一口径 */
        SCOPE: SCOPE, SCOPE_ORDER: SCOPE_ORDER, SEG_SCOPE: SEG_SCOPE,
        endLevels: endLevels, scopeOf: scopeOf, scopeOfOrder: scopeOfOrder,
        scopeStats: scopeStats, segmentScope: segmentScope,
        zones: master.ZONES, cities: master.CITIES
    };
})(window);
