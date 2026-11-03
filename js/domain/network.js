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
        zones: master.ZONES, cities: master.CITIES
    };
})(window);
