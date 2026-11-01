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

    function trips() { return TMS.db.col('trips'); }

    function hubById(id) {
        var h = master.hubByNameOrId(id);
        return h ? { id: h.id, name: h.name, city: h.city, zone: h.zone } : null;
    }

    var routeCache = {};

    /* 规划路由：命中已维护路由则复用（保证路由页可统计偏差），否则按班次图临时规划 */
    function planRoute(origin, destination, service, options) {
        var opts = options || {};
        var key = origin + '>' + destination + '>' + (service || '标准');
        if (!opts.noCache && routeCache[key]) return routeCache[key];

        var stored = TMS.db.findOne('routes', function (r) {
            return r.status === 'active' && r.origin === origin && r.destination === destination;
        });
        var plan;
        if (stored) {
            plan = {
                routeId: stored.id, mode: stored.mode, priority: stored.priority,
                segments: util.clone(stored.segments), totalStdHours: Number(stored.totalStdHours) || 0,
                distanceKm: Number(stored.distanceKm) || sumKm(stored.segments), source: 'route'
            };
        } else {
            var ob = collectBranch(origin, key), db2 = collectBranch(destination, key);
            var wantMode = service === '加急' ? '空运' : '陆运';
            var segs = master.planSegments(ob, db2, wantMode);
            /* 空运班次不是条条线都有：空运落空就用陆运重出一遍，
               否则整条路由退化成直线估时，标准时长会比真实班线松一大截 */
            if (segs && wantMode === '空运' && segs.mode !== '空运') {
                var land = master.planSegments(ob, db2, '陆运');
                if (land && land.mode === '陆运') segs = land;
            }
            if (!segs) return null;
            plan = {
                routeId: '', mode: segs.mode, priority: segs.priority, segments: segs.segments,
                totalStdHours: segs.totalStdHours, distanceKm: segs.distanceKm, source: 'temp'
            };
        }
        var svc = master.SERVICES.filter(function (s) { return s.name === (service || '标准'); })[0] || master.SERVICES[0];
        var speed = svc.code === 'EXP' ? 0.68 : (svc.code === 'ECO' ? 1.35 : (svc.code === 'CLD' ? 0.9 : 1));
        plan.stdHours = Math.max(12, Math.round(plan.totalStdHours * speed));
        plan.slaHours = Math.max(plan.stdHours + 6, svc.slaHours * (1 + Math.round(plan.distanceKm / 1200) * 0.35));
        plan.slaHours = Math.round(plan.slaHours);
        plan.serviceName = svc.name;
        if (!opts.noCache) routeCache[key] = plan;
        return plan;
    }

    function sumKm(segments) {
        return util.sum(segments || [], 'km');
    }

    /* 订单路由读取：路由段不落在订单行上，按路由主数据即时派生（缓存命中，改线后自然跟随） */
    function planOf(order) {
        if (!order) return null;
        var plan = planRoute(order.origin, order.destination, order.service);
        if (plan) return plan;
        return {
            routeId: order.routeId || '', mode: '陆运', segments: [], source: 'order',
            distanceKm: Number(order.distanceKm) || 0, stdHours: Number(order.stdHours) || 24,
            totalStdHours: Number(order.stdHours) || 24, slaHours: Number(order.slaHours) || 72
        };
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

    /* 同城只要有一条在用围栏就算覆盖：围栏半径只有 1~3 km，而网点坐标就是城市中心，
       所以覆盖判定落在城市粒度上，不是逐点算距离 */
    function fenceOfCity(city) {
        if (!city) return null;
        return TMS.db.col('geofences').filter(function (g) {
            return g.status === 'active' && g.city === city;
        })[0] || null;
    }

    function pointInFence(point, fence) {
        if (!point || !fence || !fence.center) return false;
        return util.distanceKm(fence.center, point) * 1000 <= (Number(fence.radiusM) || 0);
    }

    /* 越界统计只吃「显式写了地点」的流水：常规作业地点由订单+节点派生、根本不落库，
       留下的都是人工改判或异常上报，正好是要拿围栏核对的那批 */
    function fenceAudit(days) {
        var db = TMS.db;
        var cutoff = util.addDays(util.now(), -(days || 30)).getTime();
        var fences = db.col('geofences');
        var activeCity = {};
        fences.forEach(function (g) { if (g.status === 'active') activeCity[g.city] = g; });
        var breaches = {}, unknown = 0, covered = 0, total = 0;
        db.col('scans').forEach(function (s) {
            if (!s.location) return;
            if (util.toDate(s.opTime).getTime() < cutoff) return;
            total++;
            var city = cityOfText(s.location);
            if (!city) { unknown++; return; }
            if (activeCity[city]) { covered++; return; }
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
                if (!g.center) return;
                var km = util.distanceKm(c, g.center);
                if (km < nearKm) { nearKm = km; nearest = g; }
            });
            b.center = { lat: c.lat, lng: c.lng };
            b.fenceCount = b.branches ? Math.ceil(b.branches / 3) : 1;
            b.nearestName = nearest ? nearest.name : '';
            b.nearestKm = Math.round(nearKm);
            b.hub = (master.nearestHub(c) || {}).name || '';
            return b;
        }).filter(Boolean);
        return {
            days: days || 30, total: total, covered: covered, unknown: unknown,
            breaches: util.sortBy(list, 'count', 'desc'),
            fenceCities: Object.keys(activeCity).length, fenceRows: fences.length
        };
    }

    TMS.network = {
        cityOfText: cityOfText, fenceOfCity: fenceOfCity, pointInFence: pointInFence, fenceAudit: fenceAudit,
        cityInfo: cityInfo, hubOf: hubOf, hubById: hubById,
        branchesOf: branchesOf, branch: branch, collectBranch: collectBranch, deliverBranch: deliverBranch,
        planRoute: planRoute, planOf: planOf, tripFor: tripFor, pickVehicle: pickVehicle, loadPlan: loadPlan,
        promiseAt: promiseAt, deviates: deviates, invalidateCache: invalidateCache,
        zones: master.ZONES, cities: master.CITIES
    };
})(window);
