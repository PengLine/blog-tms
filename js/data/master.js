/* 主数据：城市网络、分拨中心、网点、客户、员工、车辆、班次、服务产品、运价卡、物料、设备
   全部确定性生成（固定随机种子），保证每次重建库得到同一套基础档案 */
(function (global) {
    'use strict';

    var TMS = global.TMS = global.TMS || {};
    var util = TMS.util;

    /* ---------- 行政区域 ---------- */

    var ZONES = ['华东', '华南', '华北', '华中', '西南', '西北', '东北'];

    // code: 省级缩写（订单号前两位）  tier: 1 一线 2 新一线/强二线 3 三线及以下
    var CITIES = [
        { name: '上海', prov: '上海市', code: 'SH', zone: '华东', lat: 31.230, lng: 121.474, tier: 1 },
        { name: '杭州', prov: '浙江省', code: 'ZJ', zone: '华东', lat: 30.274, lng: 120.155, tier: 1 },
        { name: '宁波', prov: '浙江省', code: 'ZJ', zone: '华东', lat: 29.868, lng: 118.786, tier: 2 },
        { name: '南京', prov: '江苏省', code: 'JS', zone: '华东', lat: 32.060, lng: 118.797, tier: 2 },
        { name: '苏州', prov: '江苏省', code: 'JS', zone: '华东', lat: 31.299, lng: 120.585, tier: 2 },
        { name: '无锡', prov: '江苏省', code: 'JS', zone: '华东', lat: 31.491, lng: 120.312, tier: 3 },
        { name: '合肥', prov: '安徽省', code: 'AH', zone: '华东', lat: 31.821, lng: 117.227, tier: 2 },
        { name: '青岛', prov: '山东省', code: 'SD', zone: '华东', lat: 36.067, lng: 120.383, tier: 2 },
        { name: '济南', prov: '山东省', code: 'SD', zone: '华东', lat: 36.651, lng: 117.121, tier: 2 },
        { name: '福州', prov: '福建省', code: 'FJ', zone: '华东', lat: 26.074, lng: 119.296, tier: 3 },
        { name: '厦门', prov: '福建省', code: 'FJ', zone: '华东', lat: 24.479, lng: 118.089, tier: 2 },
        { name: '广州', prov: '广东省', code: 'GD', zone: '华南', lat: 23.129, lng: 113.264, tier: 1 },
        { name: '深圳', prov: '广东省', code: 'GD', zone: '华南', lat: 22.543, lng: 114.058, tier: 1 },
        { name: '东莞', prov: '广东省', code: 'GD', zone: '华南', lat: 23.021, lng: 113.752, tier: 2 },
        { name: '佛山', prov: '广东省', code: 'GD', zone: '华南', lat: 23.022, lng: 113.122, tier: 2 },
        { name: '南宁', prov: '广西省', code: 'GX', zone: '华南', lat: 22.817, lng: 108.366, tier: 3 },
        { name: '海口', prov: '海南省', code: 'HI', zone: '华南', lat: 20.044, lng: 110.199, tier: 3 },
        { name: '北京', prov: '北京市', code: 'BJ', zone: '华北', lat: 39.904, lng: 116.407, tier: 1 },
        { name: '天津', prov: '天津市', code: 'TJ', zone: '华北', lat: 39.130, lng: 117.200, tier: 2 },
        { name: '石家庄', prov: '河北省', code: 'HE', zone: '华北', lat: 38.043, lng: 114.515, tier: 3 },
        { name: '太原', prov: '山西省', code: 'SX', zone: '华北', lat: 37.870, lng: 112.549, tier: 3 },
        { name: '呼和浩特', prov: '内蒙古', code: 'NM', zone: '华北', lat: 40.842, lng: 111.750, tier: 3 },
        { name: '武汉', prov: '湖北省', code: 'HB', zone: '华中', lat: 30.593, lng: 114.305, tier: 1 },
        { name: '郑州', prov: '河南省', code: 'HA', zone: '华中', lat: 34.747, lng: 113.625, tier: 2 },
        { name: '长沙', prov: '湖南省', code: 'HN', zone: '华中', lat: 28.228, lng: 112.939, tier: 2 },
        { name: '南昌', prov: '江西省', code: 'JX', zone: '华中', lat: 28.682, lng: 115.858, tier: 3 },
        { name: '成都', prov: '四川省', code: 'SC', zone: '西南', lat: 30.573, lng: 104.067, tier: 1 },
        { name: '重庆', prov: '重庆市', code: 'CQ', zone: '西南', lat: 29.563, lng: 106.551, tier: 1 },
        { name: '昆明', prov: '云南省', code: 'YN', zone: '西南', lat: 25.039, lng: 102.709, tier: 3 },
        { name: '贵阳', prov: '贵州省', code: 'GZ', zone: '西南', lat: 26.647, lng: 106.630, tier: 3 },
        { name: '西安', prov: '陕西省', code: 'SN', zone: '西北', lat: 34.341, lng: 108.940, tier: 2 },
        { name: '兰州', prov: '甘肃省', code: 'GS', zone: '西北', lat: 36.061, lng: 103.834, tier: 3 },
        { name: '乌鲁木齐', prov: '新疆', code: 'XJ', zone: '西北', lat: 43.826, lng: 87.617, tier: 3 },
        { name: '沈阳', prov: '辽宁省', code: 'LN', zone: '东北', lat: 41.806, lng: 123.432, tier: 2 },
        { name: '大连', prov: '辽宁省', code: 'LN', zone: '东北', lat: 38.914, lng: 121.615, tier: 3 },
        { name: '长春', prov: '吉林省', code: 'JL', zone: '东北', lat: 43.817, lng: 125.323, tier: 3 },
        { name: '哈尔滨', prov: '黑龙江省', code: 'HL', zone: '东北', lat: 45.803, lng: 126.535, tier: 3 }
    ];

    // 偏远/高成本目的地（加收偏远费、时效更长）
    var REMOTE = ['乌鲁木齐', '兰州', '昆明', '贵阳', '海口', '呼和浩特', '哈尔滨', '拉萨'];

    /* 干线只跑大区枢纽：杭州/深圳/郑州这类二级分拨在干支分离网络里不承担跨区班线，
       其货量按 zone 归口到上海/广州/武汉， lanes 从 90 条收到 42 条，
       单条班线才有密度——否则一天一车、一车一单，装载率与干线成本都会失真 */
    var HUB_SEEDS = [
        { id: 'HB0001', name: '上海分拨中心', city: '上海', zone: '华东', role: '区域枢纽', area: 46000, capacity: 180000 },
        { id: 'HB0002', name: '广州分拨中心', city: '广州', zone: '华南', role: '区域枢纽', area: 38000, capacity: 150000 },
        { id: 'HB0003', name: '北京分拨中心', city: '北京', zone: '华北', role: '区域枢纽', area: 42000, capacity: 160000 },
        { id: 'HB0004', name: '武汉分拨中心', city: '武汉', zone: '华中', role: '中心枢纽', area: 52000, capacity: 200000 },
        { id: 'HB0005', name: '成都分拨中心', city: '成都', zone: '西南', role: '区域枢纽', area: 30000, capacity: 110000 },
        { id: 'HB0006', name: '西安分拨中心', city: '西安', zone: '西北', role: '区域枢纽', area: 22000, capacity: 80000 },
        { id: 'HB0007', name: '沈阳分拨中心', city: '沈阳', zone: '东北', role: '区域枢纽', area: 20000, capacity: 70000 }
    ];

    var DISTRICTS = ['浦东新区', '闵行区', '徐泾镇', '开发区', '高新片区', '城西片区', '临港片区', '空港片区', '保税区', '老城片区'];

    var GOODS = [
        { name: '电子产品', density: 220, fragility: 0.18, value: 1800 },
        { name: '服装鞋帽', density: 120, fragility: 0.02, value: 420 },
        { name: '家居百货', density: 180, fragility: 0.08, value: 660 },
        { name: '食品饮料', density: 620, fragility: 0.05, value: 260 },
        { name: '医药器械', density: 300, fragility: 0.12, value: 3200 },
        { name: '五金机电', density: 900, fragility: 0.04, value: 1500 },
        { name: '美妆个护', density: 400, fragility: 0.15, value: 980 },
        { name: '图书文具', density: 500, fragility: 0.03, value: 180 },
        { name: '生鲜冷链', density: 520, fragility: 0.22, value: 760 },
        { name: '工业配件', density: 1100, fragility: 0.06, value: 2600 }
    ];

    var SERVICES = [
        { code: 'STD', name: '标准', multiplier: 1.00, throwRatio: 6000, slaHours: 72, features: '公路干线为主，性价比最优' },
        { code: 'EXP', name: '加急', multiplier: 1.68, throwRatio: 8000, slaHours: 48, features: '航空/高铁优先舱位，48 小时送达' },
        { code: 'ECO', name: '经济', multiplier: 0.76, throwRatio: 5000, slaHours: 120, features: '整车拼载，时效宽松' },
        { code: 'CLD', name: '冷链', multiplier: 1.95, throwRatio: 6000, slaHours: 48, features: '全程温控 2–8℃，生鲜/医药专用' }
    ];

    var VEHICLE_TYPES = [
        { code: 'CAB', name: '微面接驳车', loadKg: 400, volumeM3: 4.5, lengthM: 2.9, costPerKm: 1.1 },
        { code: 'MIC', name: '依维柯接驳车', loadKg: 800, volumeM3: 12, lengthM: 3.8, costPerKm: 1.9 },
        { code: 'VAN', name: '新能源面车', loadKg: 1000, volumeM3: 8, lengthM: 3.2, costPerKm: 1.6 },
        { code: 'MINI', name: '4.2 米厢车', loadKg: 1500, volumeM3: 18, lengthM: 4.2, costPerKm: 3.1 },
        { code: 'MID', name: '6.8 米厢车', loadKg: 5000, volumeM3: 40, lengthM: 6.8, costPerKm: 4.2 },
        { code: 'MAX', name: '9.6 米厢车', loadKg: 12000, volumeM3: 55, lengthM: 9.6, costPerKm: 5.6 },
        { code: 'TRL', name: '13.5 米半挂', loadKg: 25000, volumeM3: 85, lengthM: 13.5, costPerKm: 7.4 }
    ];

    var DEPARTMENTS = [
        { id: 'DEP0001', name: '运营管理部', parentId: '', manager: '张运营' },
        { id: 'DEP0002', name: '运输调度部', parentId: 'DEP0001', manager: '陈调度' },
        { id: 'DEP0003', name: '分拨作业部', parentId: 'DEP0001', manager: '刘分拨' },
        { id: 'DEP0004', name: '网点服务部', parentId: 'DEP0001', manager: '李网点' },
        { id: 'DEP0005', name: '财务部', parentId: '', manager: '黄会计' },
        { id: 'DEP0006', name: '客服中心', parentId: 'DEP0004', manager: '吴客服' },
        { id: 'DEP0007', name: '市场部', parentId: '', manager: '郑市场' },
        { id: 'DEP0008', name: '人事行政部', parentId: '', manager: '冯人事' },
        { id: 'DEP0009', name: '信息技术部', parentId: '', manager: '褚技术' }
    ];

    var SURNAMES = ['张', '王', '李', '赵', '刘', '陈', '杨', '黄', '周', '吴', '徐', '孙', '马', '朱', '胡', '郭', '何', '林', '罗', '郑', '梁', '谢', '宋', '唐', '许', '邓', '冯', '韩', '曹', '彭'];
    var GIVEN = ['伟', '芳', '娜', '敏', '静', '磊', '浩', '文', '辉', '成', '康', '欣', '宇', '杰', '峰', '涛', '超', '婷', '雪', '倩', '强', '斌', '宁', '磊', '岩', '彬', '璐', '爽', '捷', '萌'];

    var MATERIALS = [
        { name: '标准纸箱 3 号', unit: '个', price: 2.8, stock: 4200, safe: 1500 },
        { name: '标准纸箱 6 号', unit: '个', price: 1.6, stock: 6800, safe: 2000 },
        { name: '气泡膜', unit: '卷', price: 18.5, stock: 320, safe: 120 },
        { name: '缠绕膜', unit: '卷', price: 26.0, stock: 260, safe: 100 },
        { name: '电子面单（热敏）', unit: '卷', price: 9.9, stock: 85, safe: 200 },
        { name: '冷链冰袋', unit: '个', price: 1.2, stock: 3600, safe: 1200 },
        { name: '托盘 1.2m', unit: '块', price: 95.0, stock: 430, safe: 150 },
        { name: '封箱胶带', unit: '卷', price: 4.5, stock: 1500, safe: 600 }
    ];

    var INDUSTRIES = ['电商零售', '制造业', '医药健康', '生鲜食品', '服装纺织', '3C 数码', '家居家装', '快消品'];

    /* ---------- 工具 ---------- */

    function randFactory(seed) {
        return util.rng(seed);
    }

    function personName(rand, used) {
        for (var i = 0; i < 40; i++) {
            var n = util.pick(SURNAMES, rand) + util.pick(GIVEN, rand) + (rand() > 0.6 ? util.pick(GIVEN, rand) : '');
            if (!used[n]) { used[n] = 1; return n; }
        }
        return '员工' + Object.keys(used).length;
    }

    function phone(rand) {
        var head = ['138', '139', '136', '150', '151', '158', '159', '176', '180', '186', '188', '199'];
        return util.pick(head, rand) + util.randomDigits(8);
    }

    function cityByName(name) {
        for (var i = 0; i < CITIES.length; i++) if (CITIES[i].name === name) return CITIES[i];
        return null;
    }

    function hubOfCity(city) {
        var c = typeof city === 'string' ? cityByName(city) : city;
        if (!c) return HUB_SEEDS[0];
        var same = HUB_SEEDS.filter(function (h) { return h.city === c.name; });
        if (same.length) return same[0];
        var sameZone = HUB_SEEDS.filter(function (h) { return h.zone === c.zone; });
        var best = sameZone[0] || HUB_SEEDS[0];
        var bestD = util.distanceKm(c, cityByName(best.city));
        sameZone.forEach(function (h) {
            var d = util.distanceKm(c, cityByName(h.city));
            if (d < bestD) { best = h; bestD = d; }
        });
        return best;
    }

    function nearestHub(city) { return hubOfCity(city); }

    function hubByNameOrId(key) {
        if (!key) return null;
        for (var i = 0; i < HUB_SEEDS.length; i++) if (HUB_SEEDS[i].id === key || HUB_SEEDS[i].name === key || HUB_SEEDS[i].city === key) return HUB_SEEDS[i];
        return null;
    }

    /* 里程 → 干线时长：陆运按 55 km/h 日均（含装卸），空运按航班 5h 地面 6h */
    function transitHours(km, mode) {
        if (mode === '空运') return Math.round(9 + km / 700);
        if (mode === '铁路') return Math.round(8 + km / 68);
        return Math.max(4, Math.round(6 + km / 52));
    }

    /* ---------- 主数据构建 ---------- */

    function buildBranches(rand, used) {
        var out = [];
        var seq = 1;
        CITIES.forEach(function (c, ci) {
            var count = c.tier === 1 ? 3 : (c.tier === 2 ? 2 : 1);
            for (var i = 0; i < count; i++) {
                var hub = hubOfCity(c);
                out.push({
                    id: 'BR' + util.pad(seq, 4),
                    name: c.name + util.pick(DISTRICTS, rand) + '营业部',
                    city: c.name, province: c.prov, zone: c.zone, code: c.code,
                    lat: c.lat, lng: c.lng, hubId: hub.id, hubName: hub.name,
                    type: i === 0 ? '直营枢纽网点' : '直营网点',
                    manager: personName(rand, used), phone: phone(rand),
                    address: c.name + '市' + util.pick(DISTRICTS, rand) + util.pick(['物流大道', '货运路', '振兴街', '环城快速'], rand) + util.randomDigits(3) + '号',
                    area: util.round(200 + rand() * 800, 0),
                    staffCount: 3 + Math.floor(rand() * 12),
                    status: rand() > 0.06 ? 'active' : 'inactive',
                    openAt: '08:00', closeAt: c.tier === 1 ? '21:00' : '19:00',
                    dailyCapacity: 400 + Math.floor(rand() * 1600)
                });
                seq++;
            }
        });
        return out;
    }

    function buildCustomers(rand, used) {
        var out = [];
        var brands = ['优品', '星辰', '恒信', '万家', '云上', '极光', '博远', '锦程', '天成', '乐家', '海纳', '九州', '青禾', '南方', '北辰', '中原', '东方', '金穗', '旺达', '盛世'];
        var suffix = ['电子商务', '贸易', '科技', '供应链', '服饰', '食品', '医疗器械', '家居用品'];
        for (var i = 0; i < 34; i++) {
            var city = util.pick(CITIES, rand);
            var lv = util.weighted([['KA', 3], ['A', 6], ['B', 9], ['C', 16]], rand);
            var level = LV(lv);
            out.push({
                id: 'CU' + util.pad(i + 1, 4),
                name: util.pick(brands, rand) + util.pick(suffix, rand) + '有限公司',
                shortName: 'C' + util.pad(i + 1, 3),
                level: lv, levelName: level.name,
                industry: util.pick(INDUSTRIES, rand),
                city: city.name, province: city.prov, code: city.code, zone: city.zone,
                contact: personName(rand, used), phone: phone(rand), email: '',
                settleCycle: level.settleCycle, discountRate: level.discount,
                creditLimit: level.creditLimit,
                monthlyVolume: lv === 'KA' ? 3000 + Math.floor(rand() * 6000) : (lv === 'A' ? 900 + Math.floor(rand() * 2000) : (lv === 'B' ? 200 + Math.floor(rand() * 600) : 5 + Math.floor(rand() * 40))),
                contractFrom: util.dateKey(util.addDays(util.now(), -Math.floor(rand() * 300))),
                contractTo: util.dateKey(util.addDays(util.now(), 30 + Math.floor(rand() * 400))),
                status: rand() > 0.08 ? 'active' : 'suspended',
                registerAt: util.dateKey(util.addDays(util.now(), -Math.floor(200 + rand() * 1200))),
                senderAddress: city.name + '市' + util.pick(DISTRICTS, rand) + '工业园' + util.randomDigits(2) + '号',
                balance: 0
            });
        }
        return out;
    }

    function LV(level) {
        var found = TMS.cfg.customerLevels.filter(function (l) { return l.level === level; })[0];
        return found || TMS.cfg.customerLevels[3];
    }

    function buildEmployees(rand, used, branches) {
        var out = [];
        var seq = 1;
        function push(role, deptId, orgId, orgName, extra) {
            var e = {
                id: 'EMP' + util.pad(seq, 4),
                name: personName(rand, used),
                role: role, deptId: deptId, deptName: deptName(deptId),
                orgId: orgId || deptId, orgName: orgName || '',
                position: extra.position, phone: phone(rand),
                entryAt: util.dateKey(util.addDays(util.now(), -Math.floor(30 + rand() * 1500))),
                status: rand() > 0.05 ? 'active' : (rand() > 0.5 ? 'on_leave' : 'resigned'),
                salary: extra.salary, badge: 'HT' + util.pad(1000 + seq, 4),
                city: extra.city || '', plateNo: extra.plateNo || '', hubId: extra.hubId || '', branchId: extra.branchId || ''
            };
            seq++;
            out.push(e);
            return e;
        }
        // 总部职能岗
        DEPARTMENTS.forEach(function (d) {
            for (var i = 0; i < 3; i++) {
                push('admin', d.id, d.id, d.name, { position: i === 0 ? '主管' : '专员', salary: 8000 + Math.floor(rand() * 9000) });
            }
        });
        // 分拨中心作业岗
        HUB_SEEDS.forEach(function (h) {
            var city = cityByName(h.city);
            for (var i = 0; i < 5; i++) {
                push('sorter', 'DEP0003', h.id, h.name, { position: i === 0 ? '分拣组长' : '分拣员', salary: 5200 + Math.floor(rand() * 2600), city: h.city, hubId: h.id });
            }
            push('branch', 'DEP0001', h.id, h.name, { position: '分拨主管', salary: 11000, city: h.city, hubId: h.id });
        });
        // 网点：网点主管 + 派送员
        branches.forEach(function (b) {
            push('branch', 'DEP0004', b.id, b.name, { position: '网点主管', salary: 9000 + Math.floor(rand() * 3000), city: b.city, branchId: b.id });
            var couriers = Math.max(2, Math.round(b.staffCount / 5));
            for (var i = 0; i < couriers; i++) {
                push('deliveryman', 'DEP0004', b.id, b.name, { position: i === 0 ? '派送组长' : '派送员', salary: 4800 + Math.floor(rand() * 2400), city: b.city, branchId: b.id });
            }
        });
        // 司机（车队）
        for (var i = 0; i < 46; i++) {
            var hh = util.pick(HUB_SEEDS, rand);
            push('transporter', 'DEP0002', 'DEP0002', '运输调度部', { position: rand() > 0.5 ? '干线司机' : '支线司机', salary: 7000 + Math.floor(rand() * 4500), city: hh.city, hubId: hh.id });
        }
        return out;
    }

    function deptName(id) {
        var d = DEPARTMENTS.filter(function (x) { return x.id === id; })[0];
        return d ? d.name : '';
    }

    /* 车队按分拨吞吐配场：运力总量摊到各场，余数按小数部分从大到小补齐，凑满整台车 */
    function hubVehicleQuota(total) {
        var capSum = HUB_SEEDS.reduce(function (s, h) { return s + h.capacity; }, 0);
        var out = {}, used = 0;
        var parts = HUB_SEEDS.map(function (h) {
            var exact = total * h.capacity / capSum;
            var n = Math.floor(exact);
            used += n;
            out[h.id] = n;
            return { id: h.id, frac: exact - n };
        });
        parts.sort(function (a, b) { return b.frac - a.frac; })
            .slice(0, total - used)
            .forEach(function (p) { out[p.id]++; });
        return out;
    }

    function buildVehicles(rand, activeEmployees) {
        var drivers = activeEmployees.filter(function (e) { return e.role === 'transporter' && e.status === 'active'; });
        /* 车跟人同场：每台车优先绑驻场本分拨的司机，跨场派车留给调度页手工改。
           否则档案里会出现「沈阳司机名下车停上海场」，司机端的车次与车辆两页永远对不上号 */
        var byHub = {};
        drivers.forEach(function (e) {
            if (!e.hubId) return;
            (byHub[e.hubId] = byHub[e.hubId] || []).push(e);
        });
        /* 运力按场配，不是随机停放：上海场一天进港十几车、西安场一天两三车，
           车队均匀撒在七个场上的结果就是忙场去借邻场的车、闲场整月不动，
           装载率、司机趟次和车队利用率三处一起失真 */
        var quota = hubVehicleQuota(46);
        var letters = ['沪', '粤', '京', '鄂', '川', '陕', '辽', '浙', '苏', '鲁'];
        var out = [];
        HUB_SEEDS.forEach(function (hub) {
            for (var k = 0; k < quota[hub.id]; k++) {
                // 中小件快运车队以 4.2 米及以下为主，干线大车靠外协零担补充，避免「几十吨自有运力只拉一吨货」的失真
                var type = util.weighted([['CAB', 9], ['MIC', 8], ['VAN', 10], ['MINI', 12], ['MID', 13], ['MAX', 7], ['TRL', 4]], rand);
                var vt = vehicleType(type);
                out.push({
                    id: 'VEH' + util.pad(out.length + 1, 4),
                    plate: util.pick(letters, rand) + util.pick(['A', 'B', 'C', 'D', 'E', 'F'], rand) + util.randomDigits(5),
                    typeCode: type, typeName: vt.name, loadKg: vt.loadKg, volumeM3: vt.volumeM3, lengthM: vt.lengthM, costPerKm: vt.costPerKm,
                    hubId: hub.id, hubName: hub.name,
                    driverId: '', driver: '', driverPhone: '',
                    status: rand() > 0.12 ? (rand() > 0.3 ? 'available' : 'busy') : (rand() > 0.5 ? 'maintenance' : 'offline'),
                    odometer: 20000 + Math.floor(rand() * 380000),
                    insuredTo: util.dateKey(util.addDays(util.now(), Math.floor(30 + rand() * 300))),
                    nextCheckAt: util.dateKey(util.addDays(util.now(), Math.floor(5 + rand() * 120))),
                    fuelType: type === 'VAN' ? '电' : '柴油',
                    // 冷链车队是自有多温车队的一小部分：只有带冷藏机组的车能接冷链班次
                    coldBox: out.length % 6 === 0,
                    purchaseAt: util.dateKey(util.addDays(util.now(), -Math.floor(365 + rand() * 1400)))
                });
            }
        });
        /* 本场最小的车交给本场排在最前的司机：支线按「就小」派车，首班天然落在他身上。
           一线演示账号要有活可干，靠运气排班迟早让司机端点开是空工作台 */
        var loose = 0;
        HUB_SEEDS.forEach(function (hub) {
            var list = out.filter(function (v) { return v.hubId === hub.id; })
                .sort(function (a, b) { return a.loadKg - b.loadKg; });
            var pool = byHub[hub.id] || [];
            list.forEach(function (v, i) {
                var drv = pool.length ? pool[i % pool.length] : drivers[loose++ % Math.max(1, drivers.length)];
                if (!drv) return;
                v.driverId = drv.id;
                v.driver = drv.name;
                v.driverPhone = drv.phone;
            });
        });
        return out;
    }

    function vehicleType(code) {
        return VEHICLE_TYPES.filter(function (t) { return t.code === code; })[0] || VEHICLE_TYPES[0];
    }

    /* 干线班次：枢纽之间按距离排布，直发 + 经中心枢纽中转 */
    function buildTrips(rand) {
        var out = [];
        var seq = 1;
        function add(fromHub, toHub, mode, freq) {
            var km = util.distanceKm(cityByName(fromHub.city), cityByName(toHub.city));
            if (!km) return;
            var depart = 18 + Math.floor(rand() * 5);
            var hours = transitHours(km, mode);
            out.push({
                id: 'TRP' + util.pad(seq, 4),
                code: fromHub.city + '—' + toHub.city + ' ' + (mode === '陆运' ? '干线' : mode),
                fromHub: fromHub.id, fromHubName: fromHub.name, fromCity: fromHub.city,
                toHub: toHub.id, toHubName: toHub.name, toCity: toHub.city,
                mode: mode, distanceKm: km, transitHours: hours,
                departAt: util.pad(depart % 24) + ':' + util.pick(['00', '30'], rand),
                arriveAt: util.pad(((depart % 24) + hours) % 24) + ':' + util.pick(['00', '30'], rand),
                days: freq, vehicleType: mode === '空运' ? '-' : (km > 900 ? 'TRL' : (km > 400 ? 'MAX' : 'MID')),
                capacityKg: mode === '空运' ? 4000 : (km > 900 ? 25000 : 12000),
                onTimeRate: util.round(0.9 + rand() * 0.08, 3),
                status: rand() > 0.05 ? 'active' : 'inactive'
            });
            seq++;
        }
        // 枢纽环形直发
        for (var i = 0; i < HUB_SEEDS.length; i++) {
            for (var j = 0; j < HUB_SEEDS.length; j++) {
                if (i === j) continue;
                var a = HUB_SEEDS[i], b = HUB_SEEDS[j];
                var km = util.distanceKm(cityByName(a.city), cityByName(b.city));
                if (km < 120) continue;
                if (a.zone === b.zone) add(a, b, '陆运', '每天');
                else if (km <= 1100) add(a, b, '陆运', '每天');
                else if (km <= 2000) add(a, b, '陆运', '周二/四/六');
                else add(a, b, '铁路', '周一/三/五');
            }
        }
        // 高价值件空运班次
        ['上海', '广州', '北京', '成都', '武汉'].forEach(function (c) {
            var from = hubByNameOrId(c);
            HUB_SEEDS.forEach(function (to) {
                if (to.id === from.id) return;
                if (util.distanceKm(cityByName(from.city), cityByName(to.city)) > 1200) add(from, to, '空运', '每天');
            });
        });
        return out;
    }

    /* 运价卡：区域间 × 服务产品，快运以「首重 + 续重 × 里程系数」计价
       里程系数取区域代表城市公路里程，保证同区便宜、跨区贵的真实价差 */
    var ZONE_REP = { 华东: '上海', 华南: '广州', 华北: '北京', 华中: '武汉', 西南: '成都', 西北: '西安', 东北: '沈阳' };
    var zoneKmCache = null;

    function zoneRoadKm(from, to) {
        if (from === to) return 240;
        if (!zoneKmCache) {
            zoneKmCache = {};
            ZONES.forEach(function (a) {
                ZONES.forEach(function (b) {
                    var straight = util.distanceKm(cityByName(ZONE_REP[a]), cityByName(ZONE_REP[b]));
                    zoneKmCache[a + '>' + b] = Math.max(180, Math.round(straight * 1.32));
                });
            });
        }
        return zoneKmCache[from + '>' + to] || 900;
    }

    function buildRateCards(rand) {
        var out = [];
        var seq = 1;
        // 首重价（元/票，含 5kg 起重）与续重单价（元/kg），按始发区域成本水平取值
        var firstBase = { 华东: 26, 华南: 28, 华北: 29, 华中: 27, 西南: 32, 西北: 36, 东北: 34 };
        var contBase = { 华东: 1.22, 华南: 1.28, 华北: 1.32, 华中: 1.24, 西南: 1.45, 西北: 1.62, 东北: 1.52 };
        ZONES.forEach(function (from) {
            ZONES.forEach(function (to) {
                SERVICES.forEach(function (svc) {
                    var km = zoneRoadKm(from, to);
                    var dist = Math.max(0.6, Math.min(2.6, km / 900));
                    var pair = (firstBase[from] + firstBase[to]) / 2;
                    var pairCont = (contBase[from] + contBase[to]) / 2;
                    var first = util.round(pair * svc.multiplier * (0.82 + 0.18 * dist), 0);
                    var firstWeight = svc.code === 'CLD' ? 3 : 5;
                    out.push({
                        id: 'RC' + util.pad(seq, 4),
                        name: from + '→' + to + ' ' + svc.name + '运价',
                        originZone: from, destinationZone: to,
                        origin: '全国', destination: '全国',
                        service: svc.name,
                        lineKm: km,
                        firstWeight: firstWeight,
                        firstFee: first,
                        continueFee: util.round(pairCont * svc.multiplier * dist, 2),
                        minCharge: util.round(TMS.cfg.billing.minCharge * svc.multiplier * (0.85 + 0.15 * dist), 0),
                        throwRatio: svc.throwRatio,
                        fuelRate: util.round(0.055 + rand() * 0.035, 3),
                        insuredRate: TMS.cfg.billing.insuredRate,
                        codRate: TMS.cfg.billing.codRate,
                        remoteSurcharge: svc.name === '经济' ? 0 : TMS.cfg.billing.remoteSurcharge,
                        validFrom: util.dateKey(util.addDays(util.now(), -120)),
                        validTo: util.dateKey(util.addDays(util.now(), 240)),
                        status: 'active',
                        version: '2026Q4'
                    });
                    seq++;
                });
            });
        });
        // 同城/省内短驳专项运价
        SERVICES.slice(0, 2).forEach(function (svc) {
            out.push({
                id: 'RC' + util.pad(seq, 4), name: '同城直送 ' + svc.name + '运价',
                originZone: '华东', destinationZone: '华东', origin: '上海', destination: '上海',
                service: svc.name, lineKm: 45, firstWeight: 3, firstFee: 15, continueFee: 1.35, minCharge: 18,
                throwRatio: svc.throwRatio, fuelRate: 0.05, insuredRate: TMS.cfg.billing.insuredRate,
                codRate: TMS.cfg.billing.codRate, remoteSurcharge: 0,
                validFrom: util.dateKey(util.addDays(util.now(), -60)), validTo: util.dateKey(util.addDays(util.now(), 300)),
                status: 'active', version: '2026Q4'
            });
            seq++;
        });
        return out;
    }

    function buildDevices(rand) {
        var out = [];
        var models = ['PDA-9000', 'PDA-7500', '固定式扫描门', '高拍仪', '称重一体机', 'DWS 体积测量'];
        var i = 1;
        HUB_SEEDS.forEach(function (h) {
            for (var k = 0; k < 3; k++) {
                out.push(device(i++, h.id, h.name, util.pick(models, rand), h.city));
            }
        });
        var branchesSample = BRANCH_CACHE.slice(0, 24);
        branchesSample.forEach(function (b) {
            out.push(device(i++, b.id, b.name, util.pick(['PDA-9000', 'PDA-7500', '称重一体机'], rand), b.city));
        });
        return out;
    }

    function device(seq, orgId, owner, model, city) {
        var r = randFactory(20260101 + seq);
        var status = util.weighted([['online', 74], ['busy', 14], ['offline', 8], ['fault', 4]], r);
        return {
            id: 'DEV' + util.pad(seq, 4),
            name: model + '-' + util.pad(seq, 3),
            model: model, orgId: orgId, ownerName: owner, city: city,
            serial: 'SN' + util.randomDigits(10),
            status: status,
            battery: status === 'offline' ? 0 : 20 + Math.floor(r() * 80),
            firmware: 'v2.' + (3 + Math.floor(r() * 6)) + '.' + Math.floor(r() * 9),
            lastSyncAt: util.iso(util.addHours(util.now(), -Math.floor(r() * 8))),
            scanCount30d: 2000 + Math.floor(r() * 40000),
            errorRate: util.round(r() * 0.02, 4)
        };
    }

    /* 围栏是「勾」出来的边界，不是「圆心 + 半径」，环的画法统一收在 util.blobRing */
    function fenceRing(rand, anchor, radiusM) {
        return util.blobRing(anchor, radiusM, rand);
    }

    /* center/areaKm2 一律反算自顶点环，不另写一份：
       圆心与形状各写一套数，就会出现「地图上看它在圈内、判定说它在圈外」 */
    function makeFence(rand, seq, base, radiusM) {
        var ring = fenceRing(rand, base.center, radiusM);
        return {
            id: 'GF' + util.pad(seq, 4),
            name: base.name, type: base.type, refId: base.refId, refName: base.refName, city: base.city,
            shape: 'polygon', polygon: ring, center: util.ringCentroid(ring), areaKm2: util.ringAreaKm2(ring),
            radiusM: radiusM, status: 'active', alertCount: Math.floor(rand() * base.alertMax),
            updatedAt: util.iso(util.addDays(util.now(), -Math.floor(rand() * base.backdateDays)))
        };
    }

    function buildGeofences(employees) {
        var out = [];
        var r = randFactory(777);
        HUB_SEEDS.forEach(function (h) {
            out.push(makeFence(r, out.length + 1, {
                name: h.name + '电子围栏', type: 'hub', refId: h.id, refName: h.name, city: h.city,
                center: cityByName(h.city), alertMax: 26, backdateDays: 40
            }, 1200 + Math.floor(r() * 1500)));
        });
        /* 到货围栏只罩得住枢纽自己那片场地：网点所在城市没有派送围栏时，
           客户端「电子围栏覆盖」和网点设置页永远显示暂无，巡检也会把每个作业城市都报成越界。
           揽收/派送范围按围栏几何判定，那就让每个开点的城市都勾一座自己的派送围栏——
           枢纽城市也要：图1 左支问的是「送不送」，分拨所在城市当然送，只是它另一件事（到没到）由到货围栏回答 */
        var hubCity = {};
        HUB_SEEDS.forEach(function (h) { hubCity[h.city] = 1; });
        var done = {};
        var cityBranchCount = {};
        BRANCH_CACHE.forEach(function (x) { if (x.city) cityBranchCount[x.city] = (cityBranchCount[x.city] || 0) + 1; });
        BRANCH_CACHE.forEach(function (b) {
            if (!b.city || done[b.city]) return;
            done[b.city] = 1;
            out.push(makeFence(r, out.length + 1, {
                name: b.city + '派送围栏', type: 'branch', refId: b.id, refName: b.city + '网点群', city: b.city,
                center: cityByName(b.city), alertMax: 9, backdateDays: 30
            }, hubCity[b.city] ? 6000 + Math.floor(r() * 3000) : 3000 + Math.floor(r() * 4000)));
        });
        /* 全站都覆盖 = 这页两张卡常年空着，看不出围栏在防什么。
           留一座「停用待复核」的作业城市当缺口样本：候选按网点数从多到少试，
           要挑停用之后本市确实再没有任何在用围栏罩住的那一座——
           相邻城市的围栏边缘伸过来时，随便停用一座并不会产生越界流水 */
        function coveredByOther(city, exceptIdx) {
            var c = cityByName(city);
            if (!c) return false;
            for (var i = 0; i < out.length; i++) {
                if (i === exceptIdx || out[i].status !== 'active') continue;
                if (util.pointInRing(c, out[i].polygon)) return true;
            }
            return false;
        }
        var gapIdx = -1, gapBranches = -1;
        out.forEach(function (g, gi) {
            if (g.type !== 'branch') return;
            var cnt = cityBranchCount[g.city] || 0;
            if (cnt > gapBranches && !coveredByOther(g.city, gi)) { gapBranches = cnt; gapIdx = gi; }
        });
        if (gapIdx > -1) {
            out[gapIdx].status = 'disabled';
            out[gapIdx].note = '边界争议，停用待复核';
            out[gapIdx].updatedAt = util.iso(util.addDays(util.now(), -3));
        }

        /* 第三类：给派送员勾的编号围栏（图1 右支）。
           一名派送员一格、落在所在城市派送围栏内部偏出去的位置，
           这样收件点落进谁的格子就自动绑谁，落不进才需要人工指定。
           每 5 座城故意留空、缺口城市也不给——全绑上就看不出「需手动指定派送编号」那条支线了 */
        var fencedCity = {};
        out.forEach(function (g) { if (g.status === 'active' && g.type !== 'courier') fencedCity[g.city] = g; });
        var couriers = {};
        (employees || []).forEach(function (e) {
            if (e.role !== 'deliveryman' || e.status !== 'active' || !fencedCity[e.city]) return;
            (couriers[e.city] || (couriers[e.city] = [])).push(e);
        });
        Object.keys(couriers).sort().forEach(function (city, ci) {
            if (ci % 5 === 4) return;
            var host = fencedCity[city];
            var picked = couriers[city].slice(0, hubCity[city] ? 2 : 1);
            picked.forEach(function (e, ei) {
                var shift = host.radiusM * 0.55;
                var ang = (Math.PI * 2 / picked.length) * ei + r() * 0.6;
                out.push(makeFence(r, out.length + 1, {
                    name: e.name + '（' + e.badge + '）责任片区', type: 'courier', refId: e.id, refName: e.name, city: city,
                    alertMax: 5, backdateDays: 21,
                    center: {
                        lat: host.center.lat + shift * Math.sin(ang) / 111320,
                        lng: host.center.lng + shift * Math.cos(ang) / (111320 * Math.cos(host.center.lat * Math.PI / 180))
                    }
                }, 700 + Math.floor(r() * 900)));
            });
        });
        return out;
    }

    function buildWarehouses(rand) {
        var out = [];
        /* 每个分拨一座仓：少一座，该分拨下的网点「库存」页就会退化到第一座仓（上海中央仓），
           账实不符在一线端最先被看出来 */
        HUB_SEEDS.forEach(function (h, i) {
            out.push({
                id: 'WH' + util.pad(i + 1, 4), name: h.city + '中央仓', hubId: h.id, city: h.city,
                type: i < 2 ? '自营仓' : '租赁仓', areaM2: h.area,
                usedArea: util.round(h.area * (0.4 + rand() * 0.45), 0),
                capacityPieces: h.capacity, usedPieces: Math.floor(h.capacity * (0.3 + rand() * 0.5)),
                manager: '仓管' + (i + 1), status: 'active', costPerM2: util.round(0.8 + rand() * 1.4, 2)
            });
        });
        return out;
    }

    function buildCarriersSuppliers(rand) {
        var carriers = ['顺达快运', '中原干线运输', '粤强物流', '西南骏程', '北方冷藏运输', '江东城际运输', '云途航空物流'];
        var out = carriers.map(function (n, i) {
            return {
                id: 'CAR' + util.pad(i + 1, 4), name: n, type: i === 6 ? '空运' : (i === 4 ? '冷链' : '陆运'),
                contact: '调度' + (i + 1), phone: phone(rand),
                settleCycle: util.pick(['月结', '半月结'], rand),
                rate: util.round(0.72 + rand() * 0.22, 3),
                onTimeRate: util.round(0.86 + rand() * 0.12, 3),
                damageRate: util.round(rand() * 0.006, 4),
                contractTo: util.dateKey(util.addDays(util.now(), Math.floor(60 + rand() * 400))),
                // 冷链与空运全网只签了这一家协议方：停摆就等于产品无法交付，在册即视为常开
                status: (i === 4 || i === 6) ? 'active' : (rand() > 0.12 ? 'active' : 'suspended')
            };
        });
        var supNames = ['安捷包装', '恒泰耗材', '鑫源托盘', '蓝海冷链设备', '锐捷条码'];
        var suppliers = supNames.map(function (n, i) {
            return { id: 'SUP' + util.pad(i + 1, 4), name: n, category: i === 3 ? '设备' : '包材', contact: '采购对接' + (i + 1), phone: phone(rand), settleCycle: '月结', status: 'active' };
        });
        return { carriers: carriers.length ? out : [], suppliers: suppliers };
    }

    /* ---------- 安装到库 ---------- */

    var BRANCH_CACHE = [];
    var CUSTOMER_CACHE = [];

    function install(db, seedRandom) {
        var rand = seedRandom || Math.random;
        var used = {};
        var branches = buildBranches(rand, used);
        BRANCH_CACHE = branches;
        var customers = buildCustomers(rand, used);
        CUSTOMER_CACHE = customers;
        var employees = buildEmployees(rand, used, branches);
        /* 演示账号落档：绑定到真实一线员工/客户档案，账号名直接写回档案，
           这样派送单、打卡、绩效、车次上的名字与登录身份是同一个，角色端不会看到空工作台。
           必须在 buildVehicles 之前完成，否则车辆行缓存的司机名会落后于账号 */
        var identities = bindDemoIdentities(employees, customers);
        var vehicles = buildVehicles(rand, employees);
        var cs = buildCarriersSuppliers(rand);

        db.data.hubs = HUB_SEEDS.map(function (h) {
            var c = cityByName(h.city);
            return {
                id: h.id, name: h.name, city: h.city, zone: h.zone, role: h.role,
                address: h.city + '市' + util.pick(DISTRICTS, rand) + '物流大道 1 号',
                lat: c.lat, lng: c.lng, areaM2: h.area, capacityPieces: h.capacity,
                usedPieces: Math.floor(h.capacity * (0.28 + rand() * 0.5)),
                manager: h.name.replace('分拨中心', '') + '主管', phone: phone(rand),
                status: rand() > 0.08 ? 'active' : 'maintenance',
                sortLines: 4 + Math.floor(rand() * 8),
                updatedAt: util.iso(util.now())
            };
        });
        db.data.branches = branches;
        db.data.customers = customers;
        db.data.employees = employees;
        db.data.vehicles = vehicles;
        db.data.trips = buildTrips(rand);
        db.data.rateCards = buildRateCards(rand);
        db.data.routes = buildRoutesFromTrips(db.data.trips, branches, rand);
        db.data.carriers = cs.carriers;
        db.data.suppliers = cs.suppliers;
        db.data.warehouses = buildWarehouses(rand);
        var materials = MATERIALS.map(function (m, i) {
            return {
                id: 'MAT' + util.pad(i + 1, 4), name: m.name, unit: m.unit, price: m.price,
                stock: 0, safeStock: m.safe, supplierId: 'SUP' + util.pad(1 + (i % 5), 4),
                supplier: sup(i), status: 'normal', updatedAt: util.iso(util.now())
            };
        });
        function sup(i) { var names = ['安捷包装', '恒泰耗材', '鑫源托盘', '蓝海冷链设备', '锐捷条码']; return names[i % names.length]; }
        /* 仓库存量才是事实，物料档案的合计是派生值：
           两边各写一套随机数会造出「总库存 4200 / 各仓相加 730」的假账 */
        db.data.stocks = db.data.warehouses.map(function (w, wi) {
            return MATERIALS.map(function (m, mi) {
                return {
                    id: 'STK' + util.pad(wi * 10 + mi + 1, 5), warehouseId: w.id, warehouseName: w.name,
                    materialId: materials[mi].id, material: m.name, unit: m.unit,
                    qty: Math.floor(m.stock / 6 * (0.3 + rand())), safeQty: Math.floor(m.safe / 6),
                    updatedAt: util.iso(util.addHours(util.now(), -Math.floor(rand() * 48)))
                };
            });
        }).reduce(function (a, b) { return a.concat(b); }, []);
        materials.forEach(function (mat) {
            mat.stock = db.data.stocks.reduce(function (s, r) { return s + (r.materialId === mat.id ? r.qty : 0); }, 0);
            mat.status = mat.stock < mat.safeStock ? 'low' : 'normal';
        });
        db.data.materials = materials;
        db.data.devices = buildDevices(rand);
        db.data.geofences = buildGeofences(db.data.employees);
        db.data.departments = DEPARTMENTS.map(function (d) { return util.clone(d); });
        db.data.roles = Object.keys(TMS.cfg.roles).map(function (k) {
            return {
                id: 'ROL' + util.pad(Object.keys(TMS.cfg.roles).indexOf(k) + 1, 4),
                code: k, name: TMS.cfg.roles[k].name,
                permissionCodes: TMS.rbac.permissionsFor(k),
                builtin: true, status: 'active',
                userCount: db.data.employees.filter(function (e) { return e.role === k; }).length
            };
        });
        db.data.permissions = TMS.rbac.PERMISSIONS.map(function (p, i) {
            return { id: 'PER' + util.pad(i + 1, 4), code: p.code, name: p.name, module: p.module };
        });
        db.data.users = buildUsers(rand, employees, identities);
        db.data.goods = util.clone(GOODS);
        db.data.services = util.clone(SERVICES);
        db.data.vehicleTypes = util.clone(VEHICLE_TYPES);
        db.data.cities = util.clone(CITIES);
        return { branches: branches, customers: customers, employees: employees, vehicles: vehicles, identities: identities };
    }

    /* 演示账号 → 真实档案绑定。
       选取规则刻意落在各岗位「排班打卡样本」的前列（见 js/data/seed.js rosterPool）：
       种子引擎只给每类岗位的前若干名生成考勤与绩效，绑在样本之外的账号登录后，
       工作台、打卡、绩效三页全是空的——账号必须站在有数据的人身上。 */
    function bindDemoIdentities(employees, customers) {
        var out = {};
        var usedIds = {};

        function pick(roleKey, extraFilter) {
            var live = employees.filter(function (e) {
                return e.role === roleKey && e.status === 'active' && !usedIds[e.id];
            });
            var pool = extraFilter ? live.filter(extraFilter) : live;
            // 收窄条件挑不到人（档案分布随机）就退回同岗位任意在职者，账号宁可普通也不能空工作台
            var e = pool[0] || live[0];
            if (!e) return null;
            usedIds[e.id] = true;
            return e;
        }

        TMS.cfg.demoAccounts.forEach(function (a) {
            if (a.role === 'admin') {
                var mgr = employees.filter(function (e) { return e.role === 'admin' && e.orgId === 'DEP0001'; })[0];
                out.admin = { orgId: 'DEP0001', orgName: '运营管理部', personId: mgr ? mgr.id : '' };
                if (mgr) { mgr.name = a.name; mgr.status = 'active'; }
                return;
            }
            if (a.role === 'client') {
                /* 客户账号挂在有稳定发量的重点客户上：散客单量太少，门户查不到几条轨迹 */
                var c = customers.filter(function (x) { return x.status === 'active' && (x.level === 'A' || x.level === 'KA'); })[0]
                    || customers.filter(function (x) { return x.status === 'active'; })[0];
                if (c) {
                    c.contact = a.name;
                    out.client = { orgId: c.id, orgName: c.name, customerId: c.id, contact: a.name };
                }
                return;
            }
            /* 网点管理员要的是「网点主管」，分拨主管虽然同为 branch 岗，但归属分拨中心；
               司机要的是「自有支线最多那个场的头班司机」——运力按吞吐配场后，
               最大吞吐的分拨天天有车，挂在冷场上的司机账号点开就是空工作台 */
            var extra = null;
            if (a.role === 'branch') extra = function (x) { return !!x.branchId; };
            if (a.role === 'transporter') {
                var topHub = HUB_SEEDS.slice().sort(function (x, y) { return y.capacity - x.capacity; })[0];
                extra = function (x) { return x.hubId === topHub.id; };
            }
            var e = pick(a.role, extra);
            if (e) {
                e.name = a.name;
                e.status = 'active';
                out[a.role] = { orgId: e.orgId, orgName: e.orgName, personId: e.id, employeeNo: e.badge, position: e.position };
            }
        });
        return out;
    }

    function buildUsers(rand, employees, identities) {
        var out = [];
        var roleAccounts = TMS.cfg.demoAccounts;
        roleAccounts.forEach(function (a, i) {
            var idn = (identities || {})[a.role] || {};
            var person = idn.personId ? employees.filter(function (e) { return e.id === idn.personId; })[0] : null;
            out.push({
                id: 'USR' + util.pad(i + 1, 4), username: a.username, name: person ? person.name : a.name, role: a.role,
                passwordHash: 'h:' + util.hash(a.password),
                orgId: idn.orgId || 'DEP0001', orgName: idn.orgName || '运营管理部',
                personId: idn.personId || '', customerId: idn.customerId || '',
                phone: person ? person.phone : phone(rand),
                status: 'active', lastLoginAt: util.iso(util.addHours(util.now(), -i)),
                createdAt: util.dateKey(util.addDays(util.now(), -200 + i))
            });
        });
        // 关键岗位同步为系统账号，贴近真实：员工档案与登录账号一一对应
        var bound = {};
        out.forEach(function (u) { if (u.personId) bound[u.personId] = true; });
        employees.filter(function (e) { return e.status === 'active' && !bound[e.id] && (e.role === 'branch' || e.role === 'deliveryman' || e.role === 'transporter' || e.role === 'sorter'); })
            .slice(0, 60).forEach(function (e, i) {
                out.push({
                    id: 'USR' + util.pad(100 + i, 4), username: e.id.toLowerCase(), name: e.name, role: e.role,
                    passwordHash: 'h:' + util.hash('123456'),
                    orgId: e.orgId, orgName: e.orgName, personId: e.id, phone: e.phone,
                    status: 'active', lastLoginAt: util.iso(util.addDays(util.now(), -Math.floor(rand() * 10))),
                    createdAt: e.entryAt
                });
            });
        return out;
    }

    /* 干线路由：以班次图为骨架，产出「起城市 → 目的城市」的多段路由 */
    function buildRoutesFromTrips(trips, branches, rand) {
        var out = [];
        var seq = 1;
        var laneSeen = {};
        branches.forEach(function (b) {
            if (rand() > 0.42) return;
            var dest = util.pick(branches, rand);
            if (dest.city === b.city) return;
            var key = b.zone + '>' + dest.zone;
            if (laneSeen[key] && rand() > 0.25) return;
            laneSeen[key] = 1;
            var plan = planSegments(b, dest, trips, '陆运');
            if (!plan) return;
            out.push({
                id: 'RT' + util.pad(seq, 4),
                origin: b.city, destination: dest.city,
                originZone: b.zone, destinationZone: dest.zone,
                mode: plan.mode, priority: plan.priority,
                segments: plan.segments, totalStdHours: plan.totalStdHours,
                distanceKm: plan.distanceKm,
                deviationCount: 0, status: 'active',
                updatedAt: util.iso(util.now())
            });
            seq++;
        });
        // 全国兜底路由
        ['标准', '加急'].forEach(function (svc, i) {
            var plan = planSegments({ city: '上海', zone: '华东' }, { city: '成都', zone: '西南' }, trips, '陆运');
            out.push({
                id: 'RT' + util.pad(seq + i, 4), origin: '全国', destination: '全国',
                originZone: '华东', destinationZone: '西南', mode: '陆运', priority: '低',
                segments: (plan ? plan.segments : []).map(function (s) { return util.clone(s); }),
                totalStdHours: plan ? plan.totalStdHours : 60, distanceKm: plan ? plan.distanceKm : 1960,
                deviationCount: 0, status: 'active', updatedAt: util.iso(util.now()), isFallback: true
            });
        });
        return out;
    }

    function hubTripBetween(trips, fromHubId, toHubId, mode) {
        var list = trips.filter(function (t) { return t.fromHub === fromHubId && t.toHub === toHubId && (!mode || t.mode === mode); });
        if (list.length) return list[0];
        list = trips.filter(function (t) { return t.fromHub === fromHubId && t.toHub === toHubId; });
        return list[0] || null;
    }

    /* 找一段（最多一次中转）干线，返回 [{from,to,mode,stdHours}] */
    function trunkLegs(trips, fromHub, toHub, mode) {
        var direct = hubTripBetween(trips, fromHub.id, toHub.id, mode);
        if (direct) {
            return [{ trip: direct, from: fromHub, to: toHub, mode: direct.mode, stdHours: direct.transitHours }];
        }
        var best = null;
        trips.filter(function (t) { return t.fromHub === fromHub.id && (!mode || t.mode === mode); }).forEach(function (t) {
            var mid = HUB_SEEDS.filter(function (h) { return h.id === t.toHub; })[0];
            var next = hubTripBetween(trips, mid.id, toHub.id, mode);
            if (!next) return;
            var legs = [
                { trip: t, from: fromHub, to: mid, mode: t.mode, stdHours: t.transitHours },
                { trip: next, from: mid, to: toHub, mode: next.mode, stdHours: next.transitHours }
            ];
            var total = t.transitHours + next.transitHours;
            if (!best || total < best.total) best = { legs: legs, total: total };
        });
        return best ? best.legs : null;
    }

    function planSegments(originBranch, destBranch, trips, mode) {
        var oc = cityByName(originBranch.city), dc = cityByName(destBranch.city);
        if (!oc || !dc) return null;
        var fromHub = nearestHub(oc), toHub = nearestHub(dc);
        /* 同区件没有干线段：干支分离下始发分拨直接发车到目的网点。
           省掉这段还去班线表找「A→A」——班线表按设计不存在同城直发，
           中转搜索会绕出一条 A→B→A 的环形假干线（0 公里却背上一整天的标准时长） */
        var legs = fromHub.id === toHub.id ? [] : trunkLegs(trips, fromHub, toHub, mode);
        if (!legs) {
            // 兜底：按直线距离估算时长
            var km = util.distanceKm(oc, dc);
            legs = [{ from: fromHub, to: toHub, mode: '陆运', stdHours: transitHours(km, '陆运') }];
        }
        var segments = [];
        var seq = 1;
        var collectKm = util.distanceKm(oc, cityByName(fromHub.city)) || 20;
        segments.push({
            seq: seq++, from: originBranch.name || (oc.name + '揽收'), to: fromHub.name,
            mode: '陆运', stdHours: Math.max(3, Math.round(collectKm / 45) + 2), legType: 'collect', km: Math.round(collectKm)
        });
        legs.forEach(function (leg) {
            segments.push({
                seq: seq++, from: leg.from.name, to: leg.to.name, mode: leg.mode,
                stdHours: leg.stdHours, legType: 'trunk',
                km: Math.round(util.distanceKm(cityByName(leg.from.city), cityByName(leg.to.city)))
            });
        });
        var lastKm = util.distanceKm(cityByName(toHub.city), dc) || 25;
        segments.push({
            seq: seq++, from: toHub.name, to: destBranch.name || (dc.name + '派送'),
            mode: '陆运', stdHours: Math.max(4, Math.round(lastKm / 45) + 6), legType: 'deliver', km: Math.round(lastKm)
        });
        var totalKm = util.sum(segments, 'km');
        var total = util.sum(segments, 'stdHours');
        return {
            segments: segments, totalStdHours: total, distanceKm: totalKm,
            // 同区件没有干线班次，运输方式按分拨发车的陆运支线计
            mode: legs.length ? legs[0].mode : '陆运',
            priority: total <= 36 ? '高' : (total <= 60 ? '中' : '低')
        };
    }

    TMS.master = {
        CITIES: CITIES, ZONES: ZONES, REMOTE: REMOTE, HUBS: HUB_SEEDS,
        GOODS: GOODS, SERVICES: SERVICES, VEHICLE_TYPES: VEHICLE_TYPES,
        DEPARTMENTS: DEPARTMENTS, MATERIALS: MATERIALS, DISTRICTS: DISTRICTS,
        SURNAMES: SURNAMES, GIVEN: GIVEN,
        cityByName: cityByName, hubOfCity: hubOfCity, nearestHub: nearestHub,
        hubByNameOrId: hubByNameOrId, vehicleType: vehicleType,
        transitHours: transitHours, distanceKm: util.distanceKm, zoneRoadKm: zoneRoadKm,
        phone: phone, personName: personName,
        branches: function () { return BRANCH_CACHE; },
        customers: function () { return CUSTOMER_CACHE; },
        planSegments: function (o, d, mode) { return planSegments(o, d, dbTrips(), mode); },
        install: install,
        buildRoutesFromTrips: buildRoutesFromTrips
    };

    function dbTrips() {
        try { return TMS.db.col('trips'); } catch (err) { return []; }
    }
})(window);
