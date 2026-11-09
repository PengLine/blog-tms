/* schema 迁移登记：版本号 → 升级函数（缺登记则重建种子）
   由 js/core/db.js 在载入老库时逐级回放，所以本文件只描述「数据怎么变」，不碰外壳与加载顺序。
   v7 刻意不登记迁移：演示账号要重新绑定到真实员工/客户档案（personId/customerId），
   绑定关系在建库时随主数据一起生成，老库里那批假组织号无法就地补齐，直接重建最干净 */
(function (global) {
    'use strict';

    var TMS = global.TMS = global.TMS || {};

    TMS.migrations = {
        5: function (db) {
            // 由 v4 演示库升级：补齐新增字段，轨迹叙述统一由扫描流水承载，删除冗余 timeline
            (db.data.orders || []).forEach(function (o) {
                if (!o.orderType) o.orderType = 'forward';
                delete o.timeline;
            });
        },
        6: function (db) {
            /* v5 → v6：行宽压缩。环节时间改由扫描流水派生，费用/成本/车次成本只存反查所需的键，
               绩效指标、班次名称、打卡归属等可推导字段不再逐行落库 */
            var STAGES = ['collectedAt', 'inboundAt', 'sortedAt', 'transitAt', 'arrivedAt', 'deliveringAt'];
            var COST_KEYS = { linehaul: 'lh', handling: 'hd', collect: 'cl', sortCost: 'sc', deliver: 'dl', packaging: 'pk', overhead: 'oh', operation: 'op', total: 'tot', margin: 'mg', linehaulKm: 'tp', hubPasses: 'hp' };
            (db.data.orders || []).forEach(function (o) {
                delete o.plan; delete o.freightBreakdown;
                STAGES.forEach(function (k) { delete o[k]; });
                var c = o.cost;
                if (c && c.lh === undefined) {
                    var lean = {};
                    Object.keys(COST_KEYS).forEach(function (k) { if (c[k] !== undefined) lean[COST_KEYS[k]] = c[k]; });
                    o.cost = lean;
                }
            });
            (db.data.transports || []).forEach(function (t) {
                delete t.orderIds;
                var c = t.cost;
                if (c && c.t === undefined) t.cost = { t: c.total || 0, km: c.km || 0, d: c.days || 1, r: c.ratePerKg || '' };
            });
            (db.data.finances || []).forEach(function (f) { if (!f.date) f.date = f.createdAt; });
            (db.data.receivables || []).forEach(function (r) {
                if (!r.date) r.date = r.createdAt;
                delete r.waybillNo; delete r.customerLevel; delete r.signedAt;
            });
            (db.data.performances || []).forEach(function (p) { delete p.metrics; });
            (db.data.shifts || []).forEach(function (s) { delete s.shiftName; delete s.startAt; delete s.endAt; delete s.hours; delete s.location; });
            (db.data.clockRecords || []).forEach(function (c) { delete c.role; delete c.orgId; delete c.orgName; delete c.earlyLeave; });
        },
        /* v7 → v8：仓储加「库存流水」台账。老库只有各仓当前存量，没有凭证链就无从核对账实，
           所以把现有存量落成一条期初建账入库，之后的出入库/调整都在这条链上做增减 */
        8: function (db, TMS) {
            var util = TMS.util;
            var counters = db.counters || (db.counters = {});
            var today = util.dateKey(util.now());
            var rows = db.data.stockMovements || (db.data.stockMovements = []);
            counters['@stockMovements'] = counters['@stockMovements'] || 0;
            (db.data.stocks || []).forEach(function (s) {
                counters['@stockMovements']++;
                rows.push({
                    id: 'SMV' + util.pad(counters['@stockMovements'], 6),
                    kind: 'in', date: today, warehouseId: s.warehouseId, materialId: s.materialId,
                    qty: Number(s.qty) || 0, reason: '期初建账（v8 升级）', operator: '系统',
                    createdAt: util.iso(util.now())
                });
            });
            (db.data.materials || []).forEach(function (m) { m.inTransit = 0; });
        },
        /* v8 → v9：网点端从手持作业壳换成桌面后台壳，侧栏里要多一格「分拣交接」。
           权限的单一事实是 roles 行（用户权限页改的就是它），所以这里补的是出厂行，
           而且只在权限串仍等于 v8 默认时才动——主管自己勾过的组合保持原样 */
        9: function (db, TMS) {
            var V8_BRANCH = ['overview:view', 'order:view', 'order:create', 'order:advance', 'order:change',
                'tracking:view', 'scan:operate', 'loading:operate', 'exception:create', 'service:handle',
                'cod:remit', 'customer:manage', 'warehouse:manage', 'report:view', 'evaluation:manage'];
            (db.data.roles || []).forEach(function (r) {
                if (!r.builtin || r.code !== 'branch') return;
                var cur = r.permissionCodes || [];
                if (cur.length !== V8_BRANCH.length) return;
                if (!V8_BRANCH.every(function (c) { return cur.indexOf(c) > -1; })) return;
                r.permissionCodes = TMS.rbac.defaultPerms('branch');
                r.updatedAt = TMS.util.iso(TMS.util.now());
                r.actor = 'v9 桌面端升级';
            });
        },
        /* v10：派送地址档案 + 审核记录两张表，以及网点角色的「维护/审核」权限。
           老库只有结构没有数据，但迁移函数跑在 TMS.db 就绪之前（此刻只能用参数上的原始对象，
           调不了 create/review 这些领域接口），所以这里只打标记，
           真正的建档由 boot.ready 在建库后一次性补齐——标记用完即清，用户自己清空地址不会被复活 */
        10: function (db, TMS) {
            var V9_BRANCH = ['overview:view', 'order:view', 'order:create', 'order:advance', 'order:change',
                'tracking:view', 'scan:operate', 'loading:operate', 'sorting:operate', 'exception:create',
                'service:handle', 'cod:remit', 'customer:manage', 'warehouse:manage', 'report:view', 'evaluation:manage'];
            (db.data.roles || []).forEach(function (r) {
                if (!r.builtin || r.code !== 'branch') return;
                var cur = r.permissionCodes || [];
                if (cur.length !== V9_BRANCH.length) return;
                if (!V9_BRANCH.every(function (c) { return cur.indexOf(c) > -1; })) return;
                r.permissionCodes = TMS.rbac.defaultPerms('branch');
                r.updatedAt = TMS.util.iso(TMS.util.now());
                r.actor = 'v10 派送地址';
            });
            if (!Array.isArray(db.data.addresses)) db.data.addresses = [];
            if (!Array.isArray(db.data.addressReviews)) db.data.addressReviews = [];
            if (!db.data.addresses.length && (db.data.orders || []).length) db.pendingAddressBackfill = 1;
        },
        /* v11：围栏改成现场勾画的多边形，并新增「派送员编号围栏」这一类。
           老库的围栏是代码按圆心 ± 固定经纬度差生成的正方形——四个角严丝合缝拼在一起，
           一眼就是凑数的，所以这里不偷偷重画，只补齐派生字段并在备注里留话：
           这类围栏照旧能用（几何判定不认形状认顶点），但界面会提示重新勾边界。
           编号围栏要读在职派送员、按城市布点，迁移此刻还没有 db.create，
           所以和 v10 的地址一样只打标记，真正的建档交给 boot.ready */
        11: function (db, TMS) {
            var V10_BRANCH = ['overview:view', 'order:view', 'order:create', 'order:advance', 'order:change',
                'tracking:view', 'scan:operate', 'loading:operate', 'sorting:operate', 'exception:create',
                'service:handle', 'cod:remit', 'customer:manage', 'warehouse:manage', 'report:view',
                'evaluation:manage', 'address:manage'];
            (db.data.roles || []).forEach(function (r) {
                if (!r.builtin || r.code !== 'branch') return;
                var cur = r.permissionCodes || [];
                if (cur.length !== V10_BRANCH.length) return;
                if (!V10_BRANCH.every(function (c) { return cur.indexOf(c) > -1; })) return;
                r.permissionCodes = TMS.rbac.defaultPerms('branch');
                r.updatedAt = TMS.util.iso(TMS.util.now());
                r.actor = 'v11 围栏勾画';
            });
            var util = TMS.util;
            var rows = db.data.geofences || (db.data.geofences = []);
            var legacyBox = 0;
            rows.forEach(function (g) {
                /* 停用的写法从 inactive 改成 disabled：状态字典只有一份，
                   留着两套就等于每个页面都要记得「inactive 也算停用」，迟早漏 */
                if (g.status === 'inactive') { g.status = 'disabled'; g.note = g.note || '边界争议，停用待复核'; }
                var ring = Array.isArray(g.polygon) ? g.polygon.filter(function (p) { return p && p.lat != null && p.lng != null; }) : [];
                if (ring.length >= 3) {
                    g.shape = 'polygon';
                    g.center = util.ringCentroid(ring);
                    g.areaKm2 = util.ringAreaKm2(ring);
                    /* 四个顶点、两个纬度两个经度——那是代码画的方框，不是人勾的边界 */
                    if (ring.length === 4) {
                        var lats = util.unique(ring.map(function (p) { return p.lat; }));
                        var lngs = util.unique(ring.map(function (p) { return p.lng; }));
                        if (lats.length === 2 && lngs.length === 2) {
                            g.legacyBox = 1;
                            g.note = g.note || '旧版按圆心自动生成的方框边界，请到现场重勾';
                            legacyBox++;
                        }
                    }
                } else {
                    g.shape = 'circle';
                    delete g.polygon;
                    g.areaKm2 = util.round(Math.PI * Math.pow(Number(g.radiusM) || 0, 2) / 1e6, 2);
                }
            });
            var hasCourier = rows.some(function (g) { return g.type === 'courier'; });
            var couriers = (db.data.employees || []).filter(function (e) { return e.role === 'deliveryman' && e.status === 'active'; });
            if (!hasCourier && couriers.length) db.pendingCourierFence = 1;
        },
        /* v12：派送员拿到「派送地址维护」。老库里没改过出厂权限的角色直接换成新默认，
           改过的人尊重他的选择不动——和 v10/v11 同一个套路：只升级「还是出厂值」的那一份 */
        12: function (db, TMS) {
            var V11_COURIER = ['overview:view', 'order:view', 'order:create', 'tracking:view', 'scan:operate',
                'delivery:operate', 'delivery:pod', 'cod:remit', 'exception:create', 'report:view'];
            (db.data.roles || []).forEach(function (r) {
                if (!r.builtin || r.code !== 'deliveryman') return;
                var cur = r.permissionCodes || [];
                if (cur.length !== V11_COURIER.length) return;
                if (!V11_COURIER.every(function (c) { return cur.indexOf(c) > -1; })) return;
                r.permissionCodes = TMS.rbac.defaultPerms('deliveryman');
                r.updatedAt = TMS.util.iso(TMS.util.now());
                r.actor = 'v12 派送员维护地址';
            });
        },
        /* v13：中转站分级（一级跨省分拣中心/二级城市中转站/三级县域中转场）。
           兰州/杭州升为一级枢纽，定西/嘉峪关/嘉兴开城补网点；只增不改业务单——
           已有订单的 hubFrom/hubTo 是随单快照，已有路由段次照旧，重算才走新链路。
           网点归口随最近一级枢纽刷新，这是「路由是班次派生物」的既定口径，不算动用户数据 */
        13: function (db, TMS) {
            var util = TMS.util, master = TMS.master;
            var rand = util.rng(20261108);
            var data = db.data;
            data.cities = util.clone(master.CITIES);

            /* 一级枢纽补齐：老 7 座补 level 字段，兰州/杭州建档（冻结在 v13 的九座，南京归 v14） */
            var hubs = data.hubs || (data.hubs = []);
            hubs.forEach(function (h) { if (!h.level) { h.level = 1; h.levelName = '一级中转站'; } });
            master.HUBS.filter(function (h) { return h.id !== 'HB0010'; }).forEach(function (seed) {
                if (hubs.some(function (h) { return h.id === seed.id; })) return;
                var c = master.cityByName(seed.city);
                hubs.push({
                    id: seed.id, name: seed.name, city: seed.city, zone: seed.zone, role: seed.role,
                    level: 1, levelName: '一级中转站',
                    address: seed.city + '市' + master.districtsOf(seed.city)[0].name + '物流大道 1 号',
                    lat: c.lat, lng: c.lng, areaM2: seed.area, capacityPieces: seed.capacity,
                    usedPieces: Math.floor(seed.capacity * (0.28 + rand() * 0.5)),
                    manager: seed.city + '主管', phone: master.phone(rand),
                    status: 'active', sortLines: 4 + Math.floor(rand() * 8),
                    updatedAt: util.iso(util.now())
                });
            });

            /* 新城市开网点：定西/嘉峪关各 1、嘉兴 2，区县刻意落在真实县/县级市上，
               三级中转场在真实数据里就有样本（定西陇西县、嘉兴海宁市） */
            var branches = data.branches || (data.branches = []);
            var brSeq = branches.reduce(function (m, b) { return Math.max(m, parseInt(String(b.id).replace(/\D/g, ''), 10) || 0); }, 0);
            var openings = [
                { city: '定西', districts: ['陇西县'] },
                { city: '嘉峪关', districts: ['雄关区'] },
                { city: '嘉兴', districts: ['南湖区', '海宁市'] }
            ];
            openings.forEach(function (op) {
                var c = master.cityByName(op.city);
                op.districts.forEach(function (d, i) {
                    if (branches.some(function (b) { return b.city === op.city && (b.name || '').indexOf(d) > -1; })) return;
                    var hub = master.hubOfCity(c);
                    brSeq++;
                    branches.push({
                        id: 'BR' + util.pad(brSeq, 4), name: op.city + d + '营业部',
                        city: c.name, province: c.prov, zone: c.zone, code: c.code,
                        lat: c.lat, lng: c.lng, hubId: hub.id, hubName: hub.name,
                        type: i === 0 ? '直营枢纽网点' : '直营网点',
                        manager: master.personName(rand, {}), phone: master.phone(rand),
                        address: c.name + '市' + d + '物流大道' + util.randomDigits(3) + '号',
                        area: util.round(200 + rand() * 800, 0), staffCount: 3 + Math.floor(rand() * 12),
                        status: 'active', openAt: '08:00', closeAt: '19:00',
                        dailyCapacity: 400 + Math.floor(rand() * 1600)
                    });
                });
            });
            /* 归口刷新：一级枢纽变了的城市，网点跟着改挂 */
            branches.forEach(function (b) {
                var hub = master.hubOfCity(b.city);
                if (hub && b.hubId !== hub.id) { b.hubId = hub.id; b.hubName = hub.name; }
            });

            /* 新枢纽班线：只补涉及兰州/杭州的_lane，老 7 座之间的班次与用户改过的行一律不动 */
            var trips = data.trips || (data.trips = []);
            var trSeq = trips.reduce(function (m, t) { return Math.max(m, parseInt(String(t.id).replace(/\D/g, ''), 10) || 0); }, 0);
            function addTrip(a, b, mode, freq) {
                var km = util.distanceKm(master.cityByName(a.city), master.cityByName(b.city));
                if (!km) return;
                if (trips.some(function (t) { return t.fromHub === a.id && t.toHub === b.id && t.mode === mode; })) return;
                var depart = 18 + Math.floor(rand() * 5);
                var hours = master.transitHours(km, mode);
                trSeq++;
                trips.push({
                    id: 'TRP' + util.pad(trSeq, 4),
                    code: a.city + '—' + b.city + ' ' + (mode === '陆运' ? '干线' : mode),
                    fromHub: a.id, fromHubName: a.name, fromCity: a.city,
                    toHub: b.id, toHubName: b.name, toCity: b.city,
                    mode: mode, distanceKm: km, transitHours: hours,
                    departAt: util.pad(depart % 24) + ':' + util.pick(['00', '30'], rand),
                    arriveAt: util.pad(((depart % 24) + hours) % 24) + ':' + util.pick(['00', '30'], rand),
                    days: freq, vehicleType: mode === '空运' ? '-' : (km > 900 ? 'TRL' : (km > 400 ? 'MAX' : 'MID')),
                    capacityKg: mode === '空运' ? 4000 : (km > 900 ? 25000 : 12000),
                    onTimeRate: util.round(0.9 + rand() * 0.08, 3), status: 'active'
                });
            }
            var newHubs = master.HUBS.filter(function (h) { return h.id === 'HB0008' || h.id === 'HB0009'; });
            newHubs.forEach(function (nh) {
                master.HUBS.forEach(function (other) {
                    if (other.id === nh.id) return;
                    var km = util.distanceKm(master.cityByName(nh.city), master.cityByName(other.city));
                    if (km < 120) return;
                    var freq = nh.zone === other.zone || km <= 1100 ? '每天' : (km <= 2000 ? '周二/四/六' : '周一/三/五');
                    var mode = nh.zone !== other.zone && km > 2000 ? '铁路' : '陆运';
                    addTrip(nh, other, mode, freq);
                    addTrip(other, nh, mode, freq);
                });
            });
            ['上海', '广州', '北京', '成都', '武汉', '兰州', '杭州'].forEach(function (fromCity) {
                var from = master.hubByNameOrId(fromCity);
                master.HUBS.forEach(function (to) {
                    if (to.id === from.id) return;
                    if (from.id !== 'HB0008' && from.id !== 'HB0009' && to.id !== 'HB0008' && to.id !== 'HB0009') return;
                    if (util.distanceKm(master.cityByName(from.city), master.cityByName(to.city)) > 1200) addTrip(from, to, '空运', '每天');
                });
            });

            /* 示例链路落路由表：定西↔嘉峪关（省内经兰州）、嘉峪关↔嘉兴（跨省经兰州/杭州）。
               段次按当前班次图规划，层级中转站完整可见；同 OD 已有路由则不覆盖 */
            var routes = data.routes || (data.routes = []);
            var rtSeq = routes.reduce(function (m, r) { return Math.max(m, parseInt(String(r.id).replace(/\D/g, ''), 10) || 0); }, 0);
            [['定西', '嘉峪关'], ['嘉峪关', '定西'], ['嘉峪关', '嘉兴'], ['嘉兴', '嘉峪关']].forEach(function (od) {
                if (routes.some(function (r) { return r.origin === od[0] && r.destination === od[1]; })) return;
                var oc = master.cityByName(od[0]), dc = master.cityByName(od[1]);
                var plan = master.planSegments({ city: od[0], name: od[0] + '网点' }, { city: od[1], name: od[1] + '网点' }, '陆运', { strategy: '均衡' });
                if (!plan) return;
                rtSeq++;
                routes.push({
                    id: 'RT' + util.pad(rtSeq, 4), origin: od[0], destination: od[1],
                    originZone: oc.zone, destinationZone: dc.zone,
                    mode: plan.mode, priority: plan.priority, segments: plan.segments,
                    totalStdHours: plan.totalStdHours, distanceKm: plan.distanceKm,
                    planner: 'smart2', strategy: '均衡', transfers: (plan.segments || []).filter(function (s) { return s.transferIn; }).length,
                    trunkLegs: plan.trunkLegs, trunkCost: plan.trunkCost, reliability: plan.reliability,
                    deviationCount: 0, status: 'active', updatedAt: util.iso(util.now())
                });
            });
        },
        /* v14：南京升为一级跨省分拣中心（华东），超长途跨省件支持多枢纽串联——
           嘉峪关→嘉兴 可走 兰州→西安→武汉→南京→杭州 四段干线，中途枢纽逐段装卸。
           只增不改业务单：南京建档、涉及南京的班线补齐、网点归口按最近一级枢纽刷新 */
        14: function (db, TMS) {
            var util = TMS.util, master = TMS.master;
            var rand = util.rng(20261109);
            var data = db.data;
            var hubs = data.hubs || (data.hubs = []);
            var seed = master.hubByNameOrId('HB0010');
            if (seed && !hubs.some(function (h) { return h.id === seed.id; })) {
                var c = master.cityByName(seed.city);
                hubs.push({
                    id: seed.id, name: seed.name, city: seed.city, zone: seed.zone, role: seed.role,
                    level: 1, levelName: '一级中转站',
                    address: seed.city + '市' + master.districtsOf(seed.city)[0].name + '物流大道 1 号',
                    lat: c.lat, lng: c.lng, areaM2: seed.area, capacityPieces: seed.capacity,
                    usedPieces: Math.floor(seed.capacity * (0.28 + rand() * 0.5)),
                    manager: seed.city + '主管', phone: master.phone(rand),
                    status: 'active', sortLines: 4 + Math.floor(rand() * 8),
                    updatedAt: util.iso(util.now())
                });
            }
            var branches = data.branches || (data.branches = []);
            branches.forEach(function (b) {
                var hub = master.hubOfCity(b.city);
                if (hub && b.hubId !== hub.id) { b.hubId = hub.id; b.hubName = hub.name; }
            });

            var trips = data.trips || (data.trips = []);
            var trSeq = trips.reduce(function (m, t) { return Math.max(m, parseInt(String(t.id).replace(/\D/g, ''), 10) || 0); }, 0);
            function addTrip(a, b, mode, freq) {
                var km = util.distanceKm(master.cityByName(a.city), master.cityByName(b.city));
                if (!km) return;
                if (trips.some(function (t) { return t.fromHub === a.id && t.toHub === b.id && t.mode === mode; })) return;
                var depart = 18 + Math.floor(rand() * 5);
                var hours = master.transitHours(km, mode);
                trSeq++;
                trips.push({
                    id: 'TRP' + util.pad(trSeq, 4),
                    code: a.city + '—' + b.city + ' ' + (mode === '陆运' ? '干线' : mode),
                    fromHub: a.id, fromHubName: a.name, fromCity: a.city,
                    toHub: b.id, toHubName: b.name, toCity: b.city,
                    mode: mode, distanceKm: km, transitHours: hours,
                    departAt: util.pad(depart % 24) + ':' + util.pick(['00', '30'], rand),
                    arriveAt: util.pad(((depart % 24) + hours) % 24) + ':' + util.pick(['00', '30'], rand),
                    days: freq, vehicleType: mode === '空运' ? '-' : (km > 900 ? 'TRL' : (km > 400 ? 'MAX' : 'MID')),
                    capacityKg: mode === '空运' ? 4000 : (km > 900 ? 25000 : 12000),
                    onTimeRate: util.round(0.9 + rand() * 0.08, 3), status: 'active'
                });
            }
            if (seed) {
                master.HUBS.forEach(function (other) {
                    if (other.id === seed.id) return;
                    var km = util.distanceKm(master.cityByName(seed.city), master.cityByName(other.city));
                    if (km < 120) return;
                    var freq = seed.zone === other.zone || km <= 1100 ? '每天' : (km <= 2000 ? '周二/四/六' : '周一/三/五');
                    var mode = seed.zone !== other.zone && km > 2000 ? '铁路' : '陆运';
                    addTrip(seed, other, mode, freq);
                    addTrip(other, seed, mode, freq);
                });
                ['上海', '广州', '北京', '成都', '武汉', '兰州', '杭州', '南京'].forEach(function (fromCity) {
                    var from = master.hubByNameOrId(fromCity);
                    master.HUBS.forEach(function (to) {
                        if (to.id === from.id) return;
                        if (from.id !== 'HB0010' && to.id !== 'HB0010') return;
                        if (util.distanceKm(master.cityByName(from.city), master.cityByName(to.city)) > 1200) addTrip(from, to, '空运', '每天');
                    });
                });
            }
        }
    };
})(window);
