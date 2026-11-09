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
        { name: '嘉兴', prov: '浙江省', code: 'ZJ', zone: '华东', lat: 30.746, lng: 120.755, tier: 2 },
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
        { name: '定西', prov: '甘肃省', code: 'GS', zone: '西北', lat: 35.580, lng: 104.626, tier: 3 },
        { name: '嘉峪关', prov: '甘肃省', code: 'GS', zone: '西北', lat: 39.772, lng: 98.290, tier: 3 },
        { name: '乌鲁木齐', prov: '新疆', code: 'XJ', zone: '西北', lat: 43.826, lng: 87.617, tier: 3 },
        { name: '沈阳', prov: '辽宁省', code: 'LN', zone: '东北', lat: 41.806, lng: 123.432, tier: 2 },
        { name: '大连', prov: '辽宁省', code: 'LN', zone: '东北', lat: 38.914, lng: 121.615, tier: 3 },
        { name: '长春', prov: '吉林省', code: 'JL', zone: '东北', lat: 43.817, lng: 125.323, tier: 3 },
        { name: '哈尔滨', prov: '黑龙江省', code: 'HL', zone: '东北', lat: 45.803, lng: 126.535, tier: 3 }
    ];

    // 偏远/高成本目的地（加收偏远费、时效更长）
    var REMOTE = ['乌鲁木齐', '兰州', '昆明', '贵阳', '海口', '呼和浩特', '哈尔滨', '拉萨'];

    /* 干线只跑一级中转站（跨省/区域分拣中心）：杭州/深圳/郑州这类二级城市在干支分离网络里
       不承担跨区班线，其货量按 zone 归口到一级枢纽。兰州/杭州/南京是省级分拣中心，
       甘肃/浙江/江苏的省内跨市与跨省件都归口到它们， lanes 随 10 座一级枢纽两两直发；
       超长途跨省件允许多个一级枢纽串联（兰州→西安→武汉→南京→杭州），逐段装卸 */
    var HUB_SEEDS = [
        { id: 'HB0001', name: '上海分拨中心', city: '上海', zone: '华东', role: '区域枢纽', level: 1, area: 46000, capacity: 180000 },
        { id: 'HB0002', name: '广州分拨中心', city: '广州', zone: '华南', role: '区域枢纽', level: 1, area: 38000, capacity: 150000 },
        { id: 'HB0003', name: '北京分拨中心', city: '北京', zone: '华北', role: '区域枢纽', level: 1, area: 42000, capacity: 160000 },
        { id: 'HB0004', name: '武汉分拨中心', city: '武汉', zone: '华中', role: '中心枢纽', level: 1, area: 52000, capacity: 200000 },
        { id: 'HB0005', name: '成都分拨中心', city: '成都', zone: '西南', role: '区域枢纽', level: 1, area: 30000, capacity: 110000 },
        { id: 'HB0006', name: '西安分拨中心', city: '西安', zone: '西北', role: '区域枢纽', level: 1, area: 22000, capacity: 80000 },
        { id: 'HB0007', name: '沈阳分拨中心', city: '沈阳', zone: '东北', role: '区域枢纽', level: 1, area: 20000, capacity: 70000 },
        { id: 'HB0008', name: '兰州跨省分拣中心', city: '兰州', zone: '西北', role: '区域枢纽', level: 1, area: 26000, capacity: 90000 },
        { id: 'HB0009', name: '杭州跨省分拣中心', city: '杭州', zone: '华东', role: '区域枢纽', level: 1, area: 34000, capacity: 130000 },
        { id: 'HB0010', name: '南京跨省分拣中心', city: '南京', zone: '华东', role: '区域枢纽', level: 1, area: 30000, capacity: 110000 }
    ];

    /* ---------- 行政区划三级：省 → 市 → 区 ----------
       区名必须是这座城市真的有的，不能是「高新片区」这种放到哪座城都成立的通用词：
       路由要按「区内直送 / 市内跨区 / 省内跨市 / 跨省」分级，靠的就是区名对得上。
       名字一虚构或跨城重复，同城两单就会被判进同一个区，分级表上那一格永远是空的。

       区级坐标是按固定黄金角从城市中心派生偏移出来的（半径约 6~33 公里，同名恒得同坐标），
       只用于标位置与算市内相对远近；电子围栏与地址可派送判定都不读它，那两层认的是勾画边界和文字地址。 */
    var CITY_DISTRICTS = {
        '上海': ['浦东新区', '闵行区', '嘉定区', '松江区', '宝山区', '青浦区', '杨浦区'],
        '杭州': ['西湖区', '拱墅区', '滨江区', '萧山区', '余杭区', '临平区', '钱塘区'],
        '嘉兴': ['南湖区', '秀洲区', '嘉善县', '海盐县', '海宁市', '平湖市', '桐乡市'],
        '宁波': ['海曙区', '江北区', '鄞州区', '镇海区', '北仑区', '奉化区', '余姚市'],
        '南京': ['玄武区', '秦淮区', '建邺区', '鼓楼区', '栖霞区', '江宁区', '浦口区'],
        '苏州': ['姑苏区', '吴中区', '相城区', '昆山市', '太仓市', '吴江区', '工业园区'],
        '无锡': ['梁溪区', '滨湖区', '新吴区', '锡山区', '惠山区', '江阴市', '宜兴市'],
        '合肥': ['蜀山区', '庐阳区', '包河区', '瑶海区', '肥西县', '长丰县', '巢湖市'],
        '青岛': ['市南区', '市北区', '崂山区', '黄岛区', '城阳区', '李沧区', '即墨区'],
        '济南': ['历下区', '市中区', '槐荫区', '天桥区', '历城区', '章丘区', '高新区'],
        '福州': ['鼓楼区', '台江区', '仓山区', '晋安区', '马尾区', '闽侯县', '长乐区'],
        '厦门': ['思明区', '湖里区', '集美区', '海沧区', '同安区', '翔安区'],
        '广州': ['天河区', '越秀区', '白云区', '番禺区', '黄埔区', '花都区', '增城区'],
        '深圳': ['南山区', '福田区', '罗湖区', '宝安区', '龙岗区', '龙华区', '坪山区'],
        /* 东莞、中山这类「直筒子市」下面不设区，只管镇和街道——
           写成区反而露怯，派送分片按镇走才是珠三角的真实做法 */
        '东莞': ['南城街道', '东城街道', '长安镇', '虎门镇', '塘厦镇', '凤岗镇', '万江街道'],
        '佛山': ['禅城区', '南海区', '顺德区', '三水区', '高明区'],
        '南宁': ['青秀区', '西乡塘区', '兴宁区', '江南区', '邕宁区', '良庆区'],
        '海口': ['秀英区', '龙华区', '琼山区', '美兰区'],
        '北京': ['朝阳区', '海淀区', '丰台区', '通州区', '大兴区', '昌平区', '顺义区'],
        '天津': ['和平区', '南开区', '河西区', '滨海新区', '河东区', '西青区', '北辰区'],
        '石家庄': ['长安区', '桥西区', '裕华区', '新华区', '藁城区', '鹿泉区'],
        '太原': ['小店区', '迎泽区', '杏花岭区', '尖草坪区', '万柏林区', '晋源区'],
        '呼和浩特': ['新城区', '回民区', '玉泉区', '赛罕区', '土默特左旗'],
        '武汉': ['武昌区', '洪山区', '江汉区', '汉阳区', '江岸区', '硚口区', '东湖高新区'],
        '郑州': ['金水区', '二七区', '中原区', '管城区', '惠济区', '郑东新区', '高新区'],
        '长沙': ['岳麓区', '芙蓉区', '天心区', '开福区', '雨花区', '望城区'],
        '南昌': ['东湖区', '西湖区', '青山湖区', '红谷滩区', '青云谱区', '新建区'],
        '成都': ['锦江区', '青羊区', '武侯区', '高新区', '金牛区', '成华区', '双流区'],
        '重庆': ['渝中区', '江北区', '南岸区', '渝北区', '沙坪坝区', '九龙坡区', '巴南区'],
        '昆明': ['五华区', '盘龙区', '官渡区', '西山区', '呈贡区', '晋宁区'],
        '贵阳': ['南明区', '云岩区', '观山湖区', '花溪区', '乌当区', '白云区'],
        '西安': ['雁塔区', '碑林区', '莲湖区', '未央区', '高新区', '灞桥区', '长安区'],
        '兰州': ['城关区', '七里河区', '安宁区', '西固区', '红古区'],
        '定西': ['安定区', '通渭县', '陇西县', '渭源县', '临洮县', '漳县', '岷县'],
        /* 嘉峪关是直筒子市：三个行政管理区加三个镇，不设市辖区 */
        '嘉峪关': ['雄关区', '长城区', '镜铁区', '新城镇', '峪泉镇', '文殊镇'],
        '乌鲁木齐': ['天山区', '沙依巴克区', '新市区', '水磨沟区', '米东区'],
        '沈阳': ['和平区', '沈河区', '铁西区', '皇姑区', '浑南区', '大东区', '于洪区'],
        '大连': ['中山区', '西岗区', '沙河口区', '甘井子区', '高新区', '金州区'],
        '长春': ['朝阳区', '南关区', '宽城区', '二道区', '绿园区', '高新区'],
        '哈尔滨': ['南岗区', '道里区', '香坊区', '道外区', '松北区', '平房区']
    };

    /* 上一版凭空造的片区名。老库里的网点名与收件地址还带着它们，
       认区的那条线要能继续认出来，否则升级一次浏览器，历史地址全部判成「缺区级」 */
    var LEGACY_DISTRICTS = ['徐泾镇', '开发区', '高新片区', '城西片区', '临港片区', '空港片区', '保税区', '老城片区'];

    var DISTRICTS = (function () {
        var out = LEGACY_DISTRICTS.slice();
        Object.keys(CITY_DISTRICTS).forEach(function (c) {
            CITY_DISTRICTS[c].forEach(function (n) { if (out.indexOf(n) < 0) out.push(n); });
        });
        return out;
    })();

    var DISTRICT_CACHE = {};

    function districtsOf(city) {
        var c = cityByName(city);
        if (!c) return [];
        if (!DISTRICT_CACHE[c.name]) {
            var names = CITY_DISTRICTS[c.name] || [];
            /* 黄金角 137.5° 铺开、半径按序号递增：同一个区每次重建拿到同一个坐标，
               不会出现「浦东新区」今天在城市东边、明天跑到西边 */
            DISTRICT_CACHE[c.name] = names.map(function (n, i) {
                var ang = i * 2.3999632;
                var rad = 0.05 + 0.22 * (names.length > 1 ? i / (names.length - 1) : 0.5);
                return {
                    name: n, city: c.name, province: c.prov, code: c.code, zone: c.zone, tier: c.tier,
                    lat: Math.round((c.lat + rad * Math.sin(ang)) * 10000) / 10000,
                    lng: Math.round((c.lng + rad * Math.cos(ang) / Math.cos(c.lat * Math.PI / 180)) * 10000) / 10000
                };
            });
        }
        return DISTRICT_CACHE[c.name];
    }

    /* 给一段文字找它所在的区：先在已认出的城市里找，避免「西湖区」在杭州与南昌之间摇摆；
       这座城没有真区名时返回 null，交给调用方决定（老地址的通用片区名由 parse 的兜底循环认领） */
    function matchDistrict(city, text) {
        if (!city) return null;
        var raw = String(text || '').replace(/\s+/g, '');
        if (!raw) return null;
        var hit = null;
        districtsOf(city).forEach(function (d) {
            if (!hit && raw.indexOf(d.name) > -1) hit = d;
        });
        return hit;
    }

    function districtName(city, rand) {
        var list = districtsOf(city);
        return list.length ? util.pick(list, rand).name : util.pick(LEGACY_DISTRICTS, rand);
    }

    function districtPoint(city, name) {
        var hit = null;
        districtsOf(city).forEach(function (d) { if (!hit && d.name === name) hit = d; });
        return hit;
    }

    /* 省表由市表反推，不另写一份：多写一份就会出现「上海市列表里有、省表里没有」这种对不上的角落 */
    var PROVINCES = (function () {
        var byName = {};
        CITIES.forEach(function (c) {
            var p = byName[c.prov] || (byName[c.prov] = { name: c.prov, code: c.code, zones: {}, cities: [] });
            p.cities.push(c.name);
            p.zones[c.zone] = (p.zones[c.zone] || 0) + 1;
        });
        return Object.keys(byName).map(function (k) {
            var p = byName[k];
            p.zone = Object.keys(p.zones).sort(function (a, b) { return p.zones[b] - p.zones[a]; })[0];
            p.zones = undefined;
            /* 一省一城（四个直辖市 + 海南 + 内蒙古）：省内没有「跨市」这一档，
               分级时要直接落到跨省，否则会出现一条永远没有件的「省内跨市」路由 */
            p.singleCity = p.cities.length === 1;
            return p;
        }).sort(function (a, b) { return a.name.localeCompare(b.name, 'zh-CN'); });
    })();

    function provinceOf(city) {
        var c = cityByName(city);
        if (!c) return null;
        var hit = null;
        PROVINCES.forEach(function (p) { if (!hit && p.name === c.prov) hit = p; });
        return hit;
    }

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
                    name: c.name + districtName(c.name, rand) + '营业部',
                    city: c.name, province: c.prov, zone: c.zone, code: c.code,
                    lat: c.lat, lng: c.lng, hubId: hub.id, hubName: hub.name,
                    type: i === 0 ? '直营枢纽网点' : '直营网点',
                    manager: personName(rand, used), phone: phone(rand),
                    address: c.name + '市' + districtName(c.name, rand) + util.pick(['物流大道', '货运路', '振兴街', '环城快速'], rand) + util.randomDigits(3) + '号',
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
                senderAddress: city.name + '市' + districtName(city.name, rand) + '工业园' + util.randomDigits(2) + '号',
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
        // 高价值件空运班次（兰州/杭州/南京升为一级分拣中心后也开航空口岸）
        ['上海', '广州', '北京', '成都', '武汉', '兰州', '杭州', '南京'].forEach(function (c) {
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
                level: h.level || 1, levelName: '一级中转站',
                address: h.city + '市' + districtName(h.city, rand) + '物流大道 1 号',
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

    /* ---------- 多干线智能规划 ----------
       直达未必最优：直达班次密度低时平均候车半天起步，经枢纽两条每天班衔接反而更快；
       加急件还要允许「陆运喂给航空枢纽 + 空运干线」的空陆联运。
       路径在班次图上全部枚举后按策略评分；中转枢纽的卸货/分拣/装货与候车时长
       一并计入标准时长——不算装卸的中转承诺是假承诺 */

    var TRANSFER_OPS = { unload: 1, sort: 2, load: 1 };   // 区域枢纽中转作业标准时长（小时）
    var TRANSFER_SORT_FAST = 1;                           // 中心枢纽分拣线多，转运更快
    var TRANSFER_COST = 260;                              // 每中转一次装卸人工+设备分摊（元/车次）
    var RAIL_COST_PER_KM = 3.4, AIR_COST_PER_KM = 16;     // 铁路/航空干线车次成本口径

    var STRATEGIES = {
        '时效': { name: '时效优先', h: 0.70, c: 0.10, r: 0.20 },
        '成本': { name: '成本优先', h: 0.20, c: 0.60, r: 0.20 },
        '均衡': { name: '均衡推荐', h: 0.45, c: 0.30, r: 0.25 },
        '稳妥': { name: '稳妥优先', h: 0.25, c: 0.15, r: 0.60 }
    };

    function freqPerWeek(days) {
        var s = String(days || '');
        if (s.indexOf('每天') > -1) return 7;
        return Math.max(1, Math.min(7, s ? s.split('/').length : 1));
    }

    /* 平均候车 = 半个发班周期：每天班 12h，周三班 28h；空运一天多班按 6h */
    function waitHoursOf(trip) {
        if (trip.mode === '空运') return 6;
        return Math.round(84 / freqPerWeek(trip.days));
    }

    function transferHoursOf(hub) {
        return TRANSFER_OPS.unload + (hub && hub.role === '中心枢纽' ? TRANSFER_SORT_FAST : TRANSFER_OPS.sort) + TRANSFER_OPS.load;
    }

    /* 班次可能挂在后建的分拨上，主数据里查不到就用班次自带的名称兜底 */
    function hubOfTrip(t, end) {
        var id = end === 'from' ? t.fromHub : t.toHub;
        return hubByNameOrId(id) || {
            id: id, name: t[end + 'HubName'] || id,
            city: t[end === 'from' ? 'fromCity' : 'toCity'] || '', role: ''
        };
    }

    function legCostOf(trip) {
        var km = trip.distanceKm || 0;
        if (trip.mode === '空运') return km * AIR_COST_PER_KM;
        if (trip.mode === '铁路') return km * RAIL_COST_PER_KM;
        return km * vehicleType(trip.vehicleType).costPerKm;
    }

    /* 枚举全部简单路径（不重复经过枢纽），最多 maxTransfers 次中转。
       mode='空运' 要求路径至少含一段空运（允许陆运喂给航空枢纽的联运）；
       '陆运' 排除空运段；其余不限。停用班次不参与规划——规划进一条停开班线，
       承诺时效就成了永远等不到的车 */
    function trunkPaths(trips, fromHub, toHub, mode, maxTransfers) {
        var out = [];
        var maxLegs = Math.max(1, (maxTransfers == null ? 2 : Number(maxTransfers)) + 1);
        var usable = trips.filter(function (t) { return t.status !== 'inactive'; });
        function dfs(hubId, legs, visited, hasAir) {
            if (hubId === toHub.id) {
                if (legs.length && (mode !== '空运' || hasAir)) out.push(legs.slice());
                return;
            }
            if (legs.length >= maxLegs) return;
            usable.forEach(function (t) {
                if (t.fromHub !== hubId || visited[t.toHub]) return;
                if (mode === '陆运' && t.mode === '空运') return;
                visited[t.toHub] = 1;
                legs.push(t);
                dfs(t.toHub, legs, visited, hasAir || t.mode === '空运');
                legs.pop();
                delete visited[t.toHub];
            });
        }
        var v = {};
        v[fromHub.id] = 1;
        dfs(fromHub.id, [], v, false);
        return out;
    }

    /* 一条路径的干线事实：在途/候车/装卸分开计，成本按车次、准点率按连乘。
       每多一次中转多一次装卸差错暴露，准点率再乘 0.97——这是「稳妥」策略能看见的中转代价 */
    function pathMetrics(legs) {
        var transit = 0, km = 0, wait = 0, xferH = 0, cost = 0, rel = 1;
        legs.forEach(function (t, i) {
            transit += t.transitHours;
            km += t.distanceKm || 0;
            wait += waitHoursOf(t);
            cost += legCostOf(t);
            rel *= (t.onTimeRate || 0.95);
            if (i > 0) {
                xferH += transferHoursOf(hubOfTrip(t, 'from'));
                cost += TRANSFER_COST;
                rel *= 0.97;
            }
        });
        return {
            transitHours: transit, km: Math.round(km), waitHours: wait, transferHours: xferH,
            transfers: Math.max(0, legs.length - 1), trunkCost: Math.round(cost),
            reliability: util.round(rel * 100, 1), stdHours: transit + wait + xferH
        };
    }

    /* 评分先归一再加权：时长/成本量纲不同，直接相加会让公里数吃掉准点率。
       同分先选中转少的，再选时长短的——少一次装卸就少一次货损暴露 */
    function scoreCandidates(list, strategy) {
        var w = STRATEGIES[strategy] || STRATEGIES['均衡'];
        var minH = Infinity, minC = Infinity, maxR = 0;
        list.forEach(function (p) {
            minH = Math.min(minH, p.totalStdHours);
            minC = Math.min(minC, p.trunkCost);
            maxR = Math.max(maxR, p.reliability);
        });
        list.forEach(function (p) {
            var h = minH / Math.max(1, p.totalStdHours);
            var c = minC > 0 ? minC / Math.max(1, p.trunkCost) : 1;
            var r = p.reliability / Math.max(1, maxR);
            p.score = util.round((w.h * h + w.c * c + w.r * r) * 100, 1);
        });
        list.sort(function (a, b) {
            return b.score - a.score || a.transfers - b.transfers || a.totalStdHours - b.totalStdHours;
        });
    }

    /* ---------- 中转站分级：一级跨省分拣中心 / 二级城市中转站 / 三级县域中转场 ----------
       一级就是班次图上的枢纽（hubs 表）；二三级是派生节点，不落 hubs 表——
       它们只承担路由链路与装卸口径，不配车不配人，落表反而要养活一套假组织。
       链路按范围分级装配：市内跨区回本城二级，省内跨市归省一级，
       跨省在两个一级之间走干线；县域网点先经三级中转场再上二级 */

    var HUB_LEVELS = { 1: '一级中转站', 2: '二级中转站', 3: '三级中转站' };

    /* 县/县级市才算县域：市辖区与镇街道没有三级中转场这一层 */
    function isCountyDistrict(name) { return /(县|市)$/.test(String(name || '')); }

    function hubNode(h) {
        var c = cityByName(h.city) || {};
        return { name: h.name, level: 1, city: h.city, district: '', lat: c.lat, lng: c.lng, hubId: h.id, role: h.role || '' };
    }

    /* 本城节点：枢纽城市本身就是一级，其余城市派生二级中转站 */
    function cityStation(city) {
        var c = typeof city === 'string' ? cityByName(city) : city;
        if (!c) return null;
        var same = HUB_SEEDS.filter(function (h) { return h.city === c.name; })[0];
        if (same) return hubNode(same);
        return { name: c.name + '中转站', level: 2, city: c.name, district: '', lat: c.lat, lng: c.lng, hubId: '', role: '二级中转站' };
    }

    function countyStation(city, district) {
        var c = typeof city === 'string' ? cityByName(city) : city;
        if (!c || !district) return null;
        var p = districtPoint(c.name, district) || c;
        return { name: c.name + district + '中转场', level: 3, city: c.name, district: district, lat: p.lat, lng: p.lng, hubId: '', role: '三级中转站' };
    }

    /* 一端的中转链（网点起步）：term='hub' 收到一级分拣中心，term='city' 只收到本城节点。
       区县优先级：显式指定的区县 > 网点名里认出的区县；县级才插三级中转场 */
    function endChain(c, branch, hub, district, term) {
        var d = district || (branch ? (matchDistrict(c.name, branch.name || '') || {}).name : '') || '';
        var chain = [{
            name: (branch && branch.name) || (c.name + '网点'), level: 0, city: c.name, district: d,
            lat: c.lat, lng: c.lng, hubId: '', role: ''
        }];
        if (d && isCountyDistrict(d)) chain.push(countyStation(c, d));
        var cs = cityStation(c);
        if (term === 'hub') {
            if (cs.level === 2) chain.push(cs);
            chain.push(hubNode(hub));
        } else {
            chain.push(cs);
        }
        return chain;
    }

    /* 由一条路径装配完整段次：层级支线 + 干线（含中转装卸/候车）+ 层级派送链。
       legs 为 null 是班次图够不到时的直线估算兜底，[] 是同城/同枢纽无干线 */
    function buildPlan(oc, dc, fromHub, toHub, legs, strategy, originBranch, destBranch, opts) {
        var o = opts || {};
        var sameHub = fromHub.id === toHub.id;
        var sameCity = oc.name === dc.name;
        var hubProv = (cityByName(fromHub.city) || {}).prov;
        /* 共享枢纽但枢纽不在本省：省域支线直连两城二级（南京→苏州不绕上海） */
        var viaHub = sameHub && (sameCity || oc.name === fromHub.city || dc.name === toHub.city || hubProv === oc.prov);
        var term = (sameCity || (sameHub && !viaHub)) ? 'city' : 'hub';
        var oChain = endChain(oc, originBranch, fromHub, o.originDistrict, term);
        var dChain = endChain(dc, destBranch, toHub, o.destDistrict, term).reverse();

        var segments = [], seq = 1, prev = null;
        function push(seg) { seg.seq = seq++; segments.push(seg); prev = seg; }
        function kmOf(a, b) { return Math.round(util.distanceKm(a, b) || 0); }
        function driveHours(km) { return km <= 120 ? Math.max(2, Math.round(km / 45) + 1) : transitHours(km, '陆运'); }
        function xferSum(t) { return t.unloadHours + t.sortHours + t.loadHours + t.waitHours; }
        function xferOf(node, wait) {
            return {
                hubId: node.hubId || '', hubName: node.name, city: node.city, level: node.level,
                unloadHours: TRANSFER_OPS.unload,
                sortHours: node.level === 1 ? (node.role === '中心枢纽' ? TRANSFER_SORT_FAST : TRANSFER_OPS.sort) : 1,
                loadHours: TRANSFER_OPS.load, waitHours: wait,
                prevTripId: '', prevTripCode: '', prevArriveAt: ''
            };
        }
        /* 链上相邻节点一段：网点起步是揽收、落到网点是派送，中间全是区域支线。
           站间装卸/候车计入出发段；揽收入仓与派送分拣已含在两端支线时长里，不再重复计 */
        function chainLegs(chain) {
            for (var i = 1; i < chain.length; i++) {
                var a = chain[i - 1], b = chain[i], km = kmOf(a, b);
                var seg = { from: a.name, to: b.name, fromLevel: a.level, toLevel: b.level, mode: '陆运', km: km };
                if (a.level === 0) {
                    seg.legType = 'collect';
                    seg.stdHours = Math.max(3, Math.round(km / 45) + 2);
                } else if (b.level === 0) {
                    seg.legType = 'deliver';
                    seg.stdHours = Math.max(4, Math.round(km / 45) + 6);
                } else {
                    seg.legType = 'feeder';
                    var h = driveHours(km);
                    seg.transitHours = h;
                    if (prev && prev.legType !== 'collect') {
                        seg.transferIn = xferOf(a, 2);
                        seg.waitHours = 2;
                        seg.transferHours = xferSum(seg.transferIn) - 2;
                        h += xferSum(seg.transferIn);
                    }
                    seg.stdHours = h;
                }
                push(seg);
            }
        }

        chainLegs(oChain);
        var m;
        if (legs === null) {
            var km0 = Math.round(util.distanceKm(oc, dc));
            var h0 = transitHours(km0, '陆运');
            m = { transitHours: h0, km: km0, waitHours: 0, transferHours: 0, transfers: 0, trunkCost: Math.round(km0 * vehicleType('MAX').costPerKm), reliability: 90, stdHours: h0 };
            push({ from: fromHub.name, to: toHub.name, fromLevel: 1, toLevel: 1, mode: '陆运', stdHours: h0, legType: 'trunk', km: km0, estimated: true });
        } else if (legs.length) {
            m = pathMetrics(legs);
            legs.forEach(function (t, i) {
                var from = hubOfTrip(t, 'from'), to = hubOfTrip(t, 'to');
                var wait = waitHoursOf(t);
                /* 支线喂进枢纽的货也要卸货分拣再装干线——第一段干线不再因为「干线直达」免掉装卸 */
                var arrived = prev && prev.legType !== 'collect';
                var xfer = arrived ? transferHoursOf(from) : 0;
                var seg = {
                    from: from.name, to: to.name, fromLevel: 1, toLevel: 1, mode: t.mode, legType: 'trunk',
                    km: Math.round(t.distanceKm || 0),
                    stdHours: t.transitHours + wait + xfer,
                    transitHours: t.transitHours, waitHours: wait, transferHours: xfer,
                    tripId: t.id, tripCode: t.code, departAt: t.departAt, arriveAt: t.arriveAt, days: t.days,
                    vehicleType: t.vehicleType, capacityKg: t.capacityKg, onTimeRate: t.onTimeRate
                };
                if (arrived) {
                    seg.transferIn = {
                        hubId: from.id, hubName: from.name, city: from.city, level: 1,
                        unloadHours: TRANSFER_OPS.unload,
                        sortHours: from.role === '中心枢纽' ? TRANSFER_SORT_FAST : TRANSFER_OPS.sort,
                        loadHours: TRANSFER_OPS.load, waitHours: wait,
                        prevTripId: i > 0 ? legs[i - 1].id : '', prevTripCode: i > 0 ? legs[i - 1].code : '', prevArriveAt: i > 0 ? legs[i - 1].arriveAt : ''
                    };
                }
                push(seg);
            });
        } else {
            /* 无干线：同城/同枢纽件。两城二级直连时补一段省域支线 */
            m = { transitHours: 0, km: 0, waitHours: 0, transferHours: 0, transfers: 0, trunkCost: 0, reliability: 100, stdHours: 0 };
            if (sameHub && !viaHub) {
                var a = oChain[oChain.length - 1], b = dChain[0], km = kmOf(a, b);
                var h = driveHours(km);
                var mid = { from: a.name, to: b.name, fromLevel: a.level, toLevel: b.level, mode: '陆运', legType: 'feeder', km: km, transitHours: h };
                if (prev && prev.legType !== 'collect') {
                    mid.transferIn = xferOf(a, 2);
                    mid.waitHours = 2;
                    mid.transferHours = xferSum(mid.transferIn) - 2;
                    h += xferSum(mid.transferIn);
                }
                mid.stdHours = h;
                push(mid);
            }
        }
        chainLegs(dChain);
        if (legs !== null && !legs.length) {
            /* 纯支线方案的在途/装卸/成本按支线段汇总，不能交白卷——规划台要拿这些数评分 */
            var feeders = segments.filter(function (s) { return s.legType === 'feeder'; });
            m.transitHours = util.sum(feeders, 'transitHours');
            m.km = util.sum(feeders, 'km');
            m.waitHours = util.sum(feeders, 'waitHours');
            m.transferHours = util.sum(feeders, 'transferHours');
            m.trunkCost = Math.round(m.km * vehicleType('MID').costPerKm);
            m.reliability = 98;
            m.stdHours = util.sum(feeders, 'stdHours');
        }
        var totalKm = util.sum(segments, 'km');
        var total = util.sum(segments, 'stdHours');
        var modes = {};
        (legs || []).forEach(function (t) { modes[t.mode] = 1; });
        var modeKeys = Object.keys(modes);
        var stationXfers = segments.filter(function (s) { return s.transferIn; }).length;
        return {
            segments: segments, totalStdHours: total, distanceKm: totalKm,
            // 同区件没有干线班次，运输方式按分拨发车的陆运支线计；空陆混跑记联运
            mode: modeKeys.length > 1 ? '联运' : (modeKeys[0] || '陆运'),
            priority: total <= 36 ? '高' : (total <= 60 ? '中' : '低'),
            strategy: strategy, planner: legs === null ? 'estimate' : 'smart2',
            transitHours: m.transitHours, waitHours: m.waitHours, transferHours: m.transferHours,
            transfers: m.transfers, trunkLegs: legs === null ? 1 : legs.length,
            trunkCost: m.trunkCost, reliability: m.reliability,
            label: legs !== null && !legs.length ? (stationXfers ? '省域中转' : '支线直达')
                : (m.transfers === 0 ? '直达' : (m.transfers === 1 ? '一经中转' : (m.transfers === 2 ? '两经中转' : m.transfers + ' 经中转')))
        };
    }

    function planSegments(originBranch, destBranch, trips, mode, opts) {
        var o = opts || {};
        var oc = cityByName(originBranch.city), dc = cityByName(destBranch.city);
        if (!oc || !dc) return null;
        var fromHub = nearestHub(oc), toHub = nearestHub(dc);
        var strategy = STRATEGIES[o.strategy] ? o.strategy : '均衡';
        var candidates = [];
        /* 同区件没有干线段：干支分离下始发分拨直接发车到目的网点。
           省掉这段还去班线表找「A→A」——班线表按设计不存在同城直发，
           中转搜索会绕出一条 A→B→A 的环形假干线（0 公里却背上一整天的标准时长） */
        if (fromHub.id === toHub.id) {
            candidates.push(buildPlan(oc, dc, fromHub, toHub, [], strategy, originBranch, destBranch, o));
        } else {
            trunkPaths(trips, fromHub, toHub, mode, o.maxTransfers).forEach(function (legs) {
                candidates.push(buildPlan(oc, dc, fromHub, toHub, legs, strategy, originBranch, destBranch, o));
            });
            if (!candidates.length) {
                // 空运通道够不到就交给调用方回退陆运，不在这里拿陆运冒充空运
                if (mode === '空运') return null;
                candidates.push(buildPlan(oc, dc, fromHub, toHub, null, strategy, originBranch, destBranch, o));
            }
        }
        scoreCandidates(candidates, strategy);
        var best = candidates[0];
        if (o.withCandidates) best.candidates = candidates;
        return best;
    }

    TMS.master = {
        CITIES: CITIES, ZONES: ZONES, REMOTE: REMOTE, HUBS: HUB_SEEDS,
        GOODS: GOODS, SERVICES: SERVICES, VEHICLE_TYPES: VEHICLE_TYPES,
        DEPARTMENTS: DEPARTMENTS, MATERIALS: MATERIALS, DISTRICTS: DISTRICTS,
        /* 行政区划三级：省表由市表反推，区表带派生坐标（只用于展示与算市内远近） */
        PROVINCES: PROVINCES, CITY_DISTRICTS: CITY_DISTRICTS,
        districtsOf: districtsOf, districtName: districtName, matchDistrict: matchDistrict,
        districtPoint: districtPoint, provinceOf: provinceOf,
        SURNAMES: SURNAMES, GIVEN: GIVEN,
        cityByName: cityByName, hubOfCity: hubOfCity, nearestHub: nearestHub,
        hubByNameOrId: hubByNameOrId, vehicleType: vehicleType,
        HUB_LEVELS: HUB_LEVELS, isCountyDistrict: isCountyDistrict,
        cityStation: cityStation, countyStation: countyStation,
        transitHours: transitHours, distanceKm: util.distanceKm, zoneRoadKm: zoneRoadKm,
        phone: phone, personName: personName,
        branches: function () { return BRANCH_CACHE; },
        customers: function () { return CUSTOMER_CACHE; },
        planSegments: function (o, d, mode, opts) { return planSegments(o, d, dbTrips(), mode, opts); },
        STRATEGIES: STRATEGIES, waitHoursOf: waitHoursOf, transferHoursOf: transferHoursOf,
        trunkPaths: function (fromHub, toHub, mode, maxTransfers) { return trunkPaths(dbTrips(), fromHub, toHub, mode, maxTransfers); },
        install: install,
        buildRoutesFromTrips: buildRoutesFromTrips
    };

    function dbTrips() {
        try { return TMS.db.col('trips'); } catch (err) { return []; }
    }
})(window);
