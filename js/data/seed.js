/* 种子引擎：按时间轴「回放」真实作业流程生成运营数据
   不直接造静态快照，而是调用与页面相同的领域动作（下单→揽收→入库→分拣→装车→到件→派送→签收），
   因此订单、扫描、任务、车次、账务、异常天然一致；回放结束后再执行一次巡检生成告警。 */
(function (global) {
    'use strict';

    var TMS = global.TMS = global.TMS || {};
    var util = TMS.util, db = TMS.db, cfg = TMS.cfg;

    var DAYS = 14;          // 回放天数：localStorage 只有 5MB，历史长度必须给行体积让路
    var MIN_TRIP_KG = 600;  // 干线成班最小货量，凑不够继续压货等拼载
    var MAX_TRIP_WAIT_HOURS = 48;   // 待发车次最长压货时间，到点不管装载多少都发
    var TAIL_HOLD_MAX = 12;   // 末班留尾的最大票数：再多就是把整场货压成死库存
    var TAIL_HOLD_DAYS = 3;   // 留尾只取近三天新建的单，压一周才是事故
    var NAMES_SUR = null, NAMES_GIV = null, PHONE = null;
    var BASE_VOLUME = 40;   // 日均基础单量（会乘以淡旺季系数）

    function generate(target) {
        var rand = util.rng(20260122);
        TMS.ids.setRandom(rand);
        var realNow = util.now();
        var realNowMs = realNow.getTime();

        NAMES_SUR = TMS.master.SURNAMES; NAMES_GIV = TMS.master.GIVEN; PHONE = TMS.master.phone;
        var md = TMS.master.install(target, rand);
        var branches = md.branches, customers = md.customers, employees = md.employees;
        var activeCustomers = customers.filter(function (c) { return c.status === 'active'; });
        var custWeights = activeCustomers.map(function (c) { return [c, Math.pow(Math.max(1, c.monthlyVolume), 0.55)]; });
        var couriers = employees.filter(function (e) { return e.role === 'deliveryman' && e.status === 'active'; });
        var sorters = employees.filter(function (e) { return e.role === 'sorter' && e.status === 'active'; });
        var branchStaff = employees.filter(function (e) { return e.role === 'branch' && e.status === 'active'; });
        var couriersByBranch = util.groupBy(couriers, 'orgId');
        var sortersByHub = util.groupBy(sorters, 'orgId');
        // 扫描流水引用设备号，名称由设备档案反查（每条约省 6 字符）
        var devicePool = db.col('devices').map(function (d) { return d.id; });
        if (!devicePool.length) devicePool = ['DEV0001', 'DEV0002'];

        /* ---------- 回放游标 ---------- */

        var forceDepart = false;         // 收尾阶段：待发车次必须发出，历史积压不允许停在分拣场

        function cursorOf(iso) { return util.toDate(iso || util.now()).getTime(); }

        /* ---------- 末班留尾 ---------- */
        /* 收尾把待发班次全部发出，车队是不挂死了，代价是司机端一进来零任务：
           真实分拨到日终总有几票压在待发区等明早首班装卸。这里在演示司机驻场留一小批
           已分拣货不入任何班次，回放结束后按真实建班口径开一个 pending 车次，
           让「装车→铅封→发车→到达→回场」在一线端整条走得通（车次表也是这么用的） */
        var tailDriver = (function () {
            var u = db.col('users').filter(function (x) { return x.role === 'transporter' && x.personId; })[0];
            return u ? db.get('employees', u.personId) : null;
        })();
        var tailHub = tailDriver ? tailDriver.hubId : '';
        var tailFromMs = realNowMs - TAIL_HOLD_DAYS * 86400000;
        var tailHeld = {};

        function holdForTail(o) {
            if (!tailHub || o.hubFrom !== tailHub) return false;
            if (cursorOf(o.createdAt) < tailFromMs) return false;
            // 冷链件只能上冷链班：让它滞留在待发区，明早首班要么拒收、要么恒温断链
            if (o.service === '冷链') return false;
            if (tailHeld[o.id]) return true;
            if (Object.keys(tailHeld).length >= TAIL_HOLD_MAX) return false;
            tailHeld[o.id] = 1;
            return true;
        }

        /* 并班按目的地方向取最重的那一拨：把西安件和杭州件塞进同一台车是假调度，
           装载率与路由都会对不上。车也要按货重挑——为三十公斤货强行派一台车跑六百多公里，
           运力页第一行就是「整车放空跑」，这种班次真实调度不会开 */
        function openTailTrip() {
            if (!tailDriver) return;
            /* 末班留尾开两趟：一趟停在待发车，司机端的装车、铅封、发车才有活可点；
               另一趟直接发车停在在途，车厢在途件、在途明细、本趟指标才不会常年空白。
               真实司机在任何一个时点上都是一手待发、一手在途 */
            var made = [];
            [false, true].forEach(function (anyVehicle) {
                var tr = tailTripOnce(anyVehicle);
                if (tr) made.push(tr);
            });
            if (!made.length) return;
            var dep = new Date(realNowMs - 3 * 3600000);
            util.setNow(dep);
            var rolling = made[made.length - 1];
            TMS.operation.startTransport(rolling.id, { operator: tailDriver.name, at: dep });
            /* 在途那趟里留一条偏离补录：件被错扫进别的分拨，是现场最常见的一种偏离。
               司机端「超时限扫描留痕」与运营端「偏离路由」都只认带 deviant 标记的流水，
               建库里一条没有，这两处就永远是 0，看不出系统真的在管路由偏差 */
            var onboard = TMS.operation.ordersOfTrip(rolling.id);
            var otherHubs = db.col('hubs').filter(function (h) {
                return h.id !== rolling.fromHub && h.id !== rolling.toHub;
            });
            if (onboard.length && otherHubs.length) {
                util.setNow(new Date(dep.getTime() + 3600000));
                var wrong = otherHubs[Math.floor(rand() * otherHubs.length)];
                var offScan = TMS.order.addScan(onboard[0], 'TRANSIT', {
                    location: wrong.name, operator: tailDriver.name,
                    remark: '件误上他线，落 ' + wrong.city + ' 分拨，已补录待改签',
                    at: new Date(dep.getTime() + 3600000), deviant: true
                });
                db.commit('scans', onboard[0].id, 'order:trace');
                if (offScan) offScan.source = 'manual';
            }
            util.setNow(realNow);
        }

        /* allowAnyVehicle：司机本场往往只配一两台车，第二趟得借本场其他可派车，
           否则「待发车 + 在途」这个组态永远凑不出来 */
        function tailTripOnce(allowAnyVehicle) {
            /* 舱位来源是「本场已分拣 + 没挂车次」的全部在库件，留尾只是让它们别被别的班拉走，
               凑载口径与调度页的自动配载一致：一单一目的地，装得下才建班 */
            var rows = db.col('orders').filter(function (o) {
                return o.status === 'sorted' && !o.tripId && o.hubFrom === tailHub && o.service !== '冷链';
            });
            var own = util.sortBy(db.col('vehicles').filter(function (v) {
                return v.driverId === tailDriver.id && v.status === 'available';
            }), 'loadKg', 'asc');
            var vehs = own.length ? own : (allowAnyVehicle ? util.sortBy(db.col('vehicles').filter(function (v) {
                return v.hubId === tailHub && v.status === 'available';
            }), 'loadKg', 'asc') : []);
            if (!rows.length || !vehs.length) return null;
            var group = util.groupBy(rows, function (o) { return o.hubFrom === o.hubTo ? 'C|' + o.destination : 'H|' + o.hubTo; });
            var kg = function (list) { return util.sum(list, function (o) { return Number(o.chargeableWeight) || 0; }); };
            var hubCity = function (id) { return (TMS.master.hubByNameOrId(id) || {}).city || ''; };
            /* 排序看「单位里程能装多重」：末班是台小车，跑同城支线几十公里是合理补班，
               跑一千公里干线就是拿整车成本拉一筐货，运力复盘页会把它标成放空跑 */
            var cand = Object.keys(group).map(function (k) {
                var list = group[k];
                var first = list[0];
                var feeder = first.hubFrom === first.hubTo;
                var dist = feeder
                    ? Math.max(35, util.distanceKm(TMS.master.cityByName(first.origin), TMS.master.cityByName(first.destination)))
                    : Math.max(35, util.distanceKm(TMS.master.cityByName(hubCity(first.hubFrom)), TMS.master.cityByName(hubCity(first.hubTo))));
                /* 干线组一律先查在册班次：挂上班次号的趟次才是「按班发的实绩」，
                   司机端「在册班次对照」与班次准点考核只认这一种；手工建的空班永远对不上班次表 */
                var planned = feeder ? null : TMS.network.tripFor(first.hubFrom, first.hubTo, '陆运');
                return {
                    key: k, list: list, planned: planned, feeder: feeder,
                    kg: util.round(kg(list), 2), dist: dist, fit: util.round(kg(list) / dist, 4)
                };
            }).filter(function (c) {
                return c.list.length >= 2;
            }).sort(function (a, b) {
                return (b.planned ? 1 : 0) - (a.planned ? 1 : 0) || b.fit - a.fit || b.kg - a.kg;
            });
            for (var i = 0; i < cand.length; i++) {
                var picked = cand[i];
                var veh = util.sortBy(vehs.filter(function (v) { return v.loadKg >= picked.kg; }), 'loadKg', 'asc')[0];
                if (!veh) continue;
                var first = picked.list[0];
                var res = TMS.operation.createTrip({
                    tripId: picked.planned ? picked.planned.id : '',
                    fromHub: first.hubFrom, toHub: first.hubTo, feeder: picked.feeder,
                    toCity: picked.feeder ? first.destination : '',
                    distanceKm: picked.dist, orderIds: picked.list.map(function (o) { return o.id; }),
                    vehicleId: veh.id, driverId: tailDriver.id, at: new Date(realNow),
                    departAt: picked.planned ? picked.planned.departAt : undefined,
                    remark: picked.planned
                        ? '按 ' + picked.planned.code + ' 班配载，末班未发出转明早首班'
                        : '末班未发出，留场转明早首班'
                });
                return res.ok ? res.transport : null;
            }
            return null;
        }

        /* ---------- 订单回放 ---------- */

        for (var d = DAYS - 1; d >= 0; d--) {
            var day = util.addDays(realNow, -d);
            var factor = util.seasonFactor(day) * (0.78 + rand() * 0.5);
            var count = Math.max(3, Math.round(BASE_VOLUME * factor * (d === 0 ? 0.45 : 1)));
            for (var i = 0; i < count; i++) simulateOrder(day, i);
        }
        closeOut();
        openTailTrip();

        function pickDest(origin) {
            var oz = (TMS.master.cityByName(origin) || {}).zone;
            var pool = [];
            TMS.master.CITIES.forEach(function (c) {
                pool.push([c.name, c.zone === oz ? 6 : (Math.abs(TMS.master.ZONES.indexOf(c.zone) - TMS.master.ZONES.indexOf(oz)) <= 1 ? 3 : 2)]);
            });
            return util.weighted(pool, rand);
        }

        function dimsFor(weight, goods) {
            var g = TMS.master.GOODS.filter(function (x) { return x.name === goods; })[0] || TMS.master.GOODS[0];
            var volM3 = Math.max(0.001, weight / g.density);
            var cm3 = volM3 * 1000000;
            var side = Math.pow(cm3, 1 / 3);
            var l = Math.max(10, Math.round(side * 1.4 / 5) * 5);
            var w = Math.max(8, Math.round(side * 0.9 / 5) * 5);
            var h = Math.max(6, Math.round(cm3 / (l * w) / 5) * 5);
            return l + 'x' + w + 'x' + h;
        }

        function staffOf(pool, orgId, fallbackRole) {
            var list = pool.filter(function (e) { return !orgId || e.orgId === orgId; });
            if (!list.length) list = pool;
            if (!list.length) return { name: fallbackRole || '作业员', id: '' };
            return util.pick(list, rand);
        }

        function simulateOrder(day) {
            var createdAt = new Date(day.getFullYear(), day.getMonth(), day.getDate(),
                8 + Math.floor(rand() * 13), Math.floor(rand() * 60));
            // 当日订单不得晚于回放时刻，否则建库收尾会留下未来环节时间
            if (createdAt.getTime() > realNowMs) createdAt = new Date(realNowMs - Math.floor(rand() * 180) * 60000);
            util.setNow(createdAt);

            var customer = util.weighted(custWeights, rand);
            var origin = rand() < 0.78 ? customer.city : util.pick(TMS.master.CITIES, rand).name;
            var destination = pickDest(origin);
            if (destination === origin) destination = util.pick(TMS.master.CITIES, rand).name;
            var goods = util.pick(TMS.master.GOODS, rand).name;
            var service = goods === '生鲜冷链' ? '冷链' : util.weighted([['标准', 56], ['经济', 16], ['加急', 20], ['冷链', 8]], rand);
            /* 单量结构：约九成零担小件、5% 大票、2% 厂家整车直发。
               零担凑不满整车靠外协买舱位，大票与整车才是自有车队的活，两者混合才贴近真实运力市场 */
            var profile = rand() < 0.022 ? '整车' : (rand() < 0.07 ? '大票' : '零担');
            if (profile === '整车') service = rand() < 0.5 ? '标准' : '经济';
            var weight = profile === '整车' ? util.round(3000 + Math.pow(rand(), 1.4) * 8000, 2)
                : profile === '大票' ? util.round(320 + Math.pow(rand(), 1.5) * 2600, 2)
                : util.round(0.4 + Math.pow(rand(), 2.1) * 46 + (service === '经济' ? rand() * 30 : 0), 2);
            var pieces = profile === '整车' ? 60 + Math.floor(rand() * 120)
                : profile === '大票' ? 20 + Math.floor(rand() * 60)
                : (weight > 40 ? 3 + Math.floor(rand() * 6) : (weight > 12 ? 1 + Math.floor(rand() * 3) : 1));
            var dims = dimsFor(weight / pieces, goods);
            var declared = rand() < 0.34 ? util.round(TMS.master.GOODS.filter(function (g) { return g.name === goods; })[0].value * (0.6 + rand() * 3.5), 0) : 0;
            var isInsured = declared > 0 && rand() < 0.72;
            var payment = customer.settleCycle === '月结' && rand() < 0.86 ? '月结' : util.weighted([['现付', 70], ['到付', 24], ['月结', 6]], rand);
            var codAmount = payment === '到付' ? util.round((declared || 300) * (0.6 + rand() * 1.8), 0) : 0;
            var sender = staffOf(branchStaff, null, '客户经理');

            var res = TMS.order.create({
                origin: origin, destination: destination, service: service,
                customerId: customer.id, customer: customer.name,
                contact: customer.contact, phone: customer.phone,
                goods: goods, goodsRemark: '', weight: weight, pieces: pieces, dims: dims,
                declaredValue: declared, isInsured: isInsured,
                paymentMethod: payment, codAmount: codAmount,
                channel: customer.level === 'C' ? '线上下单' : '客户经理',
                senderAddress: customer.senderAddress || (origin + '市工业园区 8 号'),
                receiverName: util.pick(NAMES_SUR, rand) + util.pick(NAMES_GIV, rand),
                receiverPhone: PHONE(rand),
                receiverAddress: destination + '市' + util.pick(TMS.master.DISTRICTS, rand) + util.randomDigits(3) + '号',
                remark: rand() < 0.12 ? util.pick(['易碎品，请轻放', '需上门收货，货已备好', '收件人白天不在，请傍晚派送', '需签回单', '木箱包装']) : '',
                createdAt: util.iso(createdAt), actor: sender.name
            });
            if (!res.ok) return;
            walk(res.order, createdAt);
        }

        /* 时间轴推进：按环节标准时效逐级履约，可重复调用（未走完的订单下次继续） */
        function walk(order, createdAt) {
            var id = order.id;
            var live = db.get('orders', id);
            if (!live || TMS.order.isTerminal(live) || live.status === 'problem') return;
            var plan = TMS.network.planOf(live) || {};
            var segs = plan.segments || [];
            var collectH = segs.length ? segs[0].stdHours : 6;
            var trunkH = util.sum(segs.filter(function (s) { return s.legType === 'trunk'; }), 'stdHours') || 24;
            var deliverH = segs.length ? (segs[segs.length - 1].stdHours || plan.stdHours) : 10;
            var cursor = Math.max(cursorOf(createdAt), cursorOf(live.updatedAt || live.createdAt));

            function st() { var x = db.get('orders', id); return x ? x.status : 'cancelled'; }
            /* 游标属于本次推进：maybeProblem 会递归调用 walk，共享游标会串台导致环节时间倒挂 */
            function jump(hours) {
                cursor += Math.max(0.5, hours) * 3600000;
                if (cursor > realNowMs) return false;
                util.setNow(new Date(cursor));
                return true;
            }

            // 揽收：约 1/3 订单复磅调价，贴近实际运费差异来源
            if (st() === 'created') {
                if (!jump(collectH * (0.12 + rand() * 0.3))) return;
                var reweight = rand() < 0.34 ? util.round(Math.max(0.3, live.weight * (0.86 + rand() * 0.32)), 2) : 0;
                var dev = staffOf(couriers, live.originBranchId, '揽收员');
                TMS.order.collect(id, {
                    operator: dev.name, device: util.pick(devicePool, rand),
                    actualWeight: reweight || undefined,
                    location: TMS.order.branchName(live, 'origin'), note: reweight ? '揽收复磅 ' + reweight + 'kg' : ''
                });
            }

            if (st() === 'collected') {
                if (!jump(1.5 + rand() * 3)) return maybeProblem(order, 'inbound');
                TMS.order.inbound(id, { operator: staffOf(branchStaff, live.originBranchId, '作业员').name, device: util.pick(devicePool, rand), location: TMS.order.branchName(live, 'origin') });
            }

            if (st() === 'inbound') {
                if (!jump(collectH * 0.3 + 2 + rand() * 5)) return;
                TMS.order.sort(id, {
                    operator: staffOf(sorters, live.hubFrom, '分拣员').name,
                    chute: 'C' + util.pad(1 + util.hash(live.destination) % 40, 2),
                    device: util.pick(devicePool, rand),
                    location: (TMS.master.hubByNameOrId(live.hubFrom) || {}).name
                });
            }

            // 装车发运：并入同向待发车次，凑满或到点触发发车
            var tr = null;
            if (st() === 'sorted') {
                if (!jump(2 + rand() * 6)) return;
                tr = ensureTrip(order, cursor);
                if (!tr) return;
                tr = db.get('transports', tr.id);
                if (!tr || tr.status === 'pending') return;
            }

            if (st() === 'transit') {
                tr = tr || (live.tripId ? db.get('transports', live.tripId) : null);
                var legH = (tr ? TMS.operation.transitHoursOf(tr) : 0) || trunkH;
                if (!jump(legH * (0.82 + rand() * 0.45))) return;
                if (tr) {
                    if (tr.status === 'pending') TMS.operation.startTransport(tr.id, { operator: TMS.operation.driverOf(tr) || '司机', at: new Date(cursor - 3600000) });
                    TMS.operation.arriveTransport(tr.id, { operator: TMS.operation.driverOf(tr) || '司机', at: new Date(cursor) });
                    // 到件即关闭车次任务：车辆只有回场才回到可派池，
                    // 否则历史车次会把车队一直挂在 busy 上，后面的班次只能全部外协
                    if (tr.status !== 'completed') {
                        TMS.operation.completeTransport(tr.id, { operator: TMS.operation.driverOf(tr) || '司机' });
                    }
                } else {
                    TMS.order.arrive(id, { operator: '到达扫描', note: '干线到达' });
                }
            }

            var courier = null;
            if (st() === 'arrived') {
                // 中段异常注入：破损/错分/温控等在目的分拨被发现，走完整闭环后放行继续派送
                if ((db.get('orders', id).exceptionCount || 0) < 1) maybeProblem(order, 'arrived');
                if (['problem', 'cancelled', 'signed', 'returned'].indexOf(st()) > -1) return;
                if (!jump(1.5 + rand() * 4)) return;
                var courierPool = couriersByBranch[db.get('orders', id).destBranchId] || couriers;
                courier = util.pick(courierPool, rand);
                TMS.order.assignDelivery(id, { courierId: courier.id, courier: courier.name, operator: courier.name + '（自动派单）' });
            }

            // 派送与签收
            if (st() === 'delivering') {
                if (!jump(deliverH * (0.18 + rand() * 0.55))) return;
                var receiverNames = ['本人签收', '前台代收', '家人代收', '同事代收', '门卫代收', '驿站代收'];
                var who = courier || db.get('employees', db.get('orders', id).courierId) || { name: '派送员' };
                TMS.order.sign(id, {
                    receiver: util.pick(receiverNames, rand), receiverPhone: live.receiverPhone || live.phone,
                    photo: rand() < 0.62, note: rand() < 0.3 ? '外包装完好，当面验货' : '',
                    operator: who.name, device: util.pick(devicePool, rand)
                });
                maybeProblem(order, 'signed');
            }
        }

        /* 收尾回放：历史积压必须走完履约链路，运力随车次完成释放，仅保留最近时刻的自然在途 */
        function closeOut() {
            forceDepart = true;
            for (var round = 0; round < 4; round++) {
                var open = db.col('orders').filter(function (o) {
                    return !TMS.order.isTerminal(o) && o.status !== 'problem';
                });
                if (!open.length) break;
                util.sortBy(open, 'createdAt', 'asc').forEach(function (o) { walk(o, util.toDate(o.createdAt)); });
                db.col('transports').forEach(function (t) {
                    if (['arrived', 'loading'].indexOf(t.status) > -1) {
                        util.setNow(new Date(Math.min(cursorOf(t.actualArriveAt) + 3600000, realNowMs)));
                        TMS.operation.completeTransport(t.id, { operator: TMS.operation.driverOf(t) || '司机' });
                    }
                });
            }
            // 长期未发的车次按班次时刻补发，避免车辆被历史车次占用
            db.col('transports').filter(function (t) { return t.status === 'pending'; }).forEach(function (t) {
                var at = Math.min(cursorOf(t.actualDepartAt || t.createdAt), realNowMs);
                util.setNow(new Date(at));
                TMS.operation.startTransport(t.id, { operator: TMS.operation.driverOf(t) || '司机', at: new Date(at) });
            });
            forceDepart = false;
            util.setNow(realNow);
        }

        /* 挂班：同向待发车次优先拼载（可跨天），凑不够起运量就压货等下一波货。
           真实分拨是「等货成班」，不是按班次时刻来一车发一车：
           薄班线按时刻开班会变成一天一车、一车三两票，装载率归零、干线成本失真、车次表成倍膨胀。 */
        function ensureTrip(order, at) {
            var o = db.get('orders', order.id);
            if (!o) return null;
            if (holdForTail(o)) return null;
            var sortedAt = TMS.order.stageAt(o, 'sorted') || util.iso(new Date(at));
            // 起讫落在同一个分拨 = 区域内支线（含同城串线），自有面包车按目的城市执行；跨枢纽才是买舱位的干线
            var feeder = o.hubFrom === o.hubTo;
            var planned = feeder ? null : (TMS.network.tripFor(o.hubFrom, o.hubTo, o.service === '加急' ? '空运' : '陆运')
                || TMS.network.tripFor(o.hubFrom, o.hubTo));
            var tr = db.findOne('transports', function (t) {
                if (t.status !== 'pending' || t.fromHub !== o.hubFrom) return false;
                if (feeder ? t.toCity !== o.destination : (t.toHub !== o.hubTo || t.toCity)) return false;
                if (t.orders >= 40) return false;
                // 不收「游标之后才建」的车次：挂上去发车时间会跳到当前游标前面，环节时间倒挂
                if (cursorOf(t.createdAt) > at) return false;
                // 压货窗口内继续攒货，超时的老车次留给 maybeDepart 发车，不再往里塞单
                if (at - cursorOf(t.createdAt) > MAX_TRIP_WAIT_HOURS * 3600000) return false;
                var cap = TMS.operation.capacityOf(t);
                var kg = t.weight + (Number(o.chargeableWeight) || 0);
                return !cap || kg <= cap * 0.95;
            });
            if (!tr) {
                var waiting = util.sortBy(db.col('orders').filter(function (x) {
                    return x.status === 'sorted' && !x.tripId && !tailHeld[x.id] && x.hubFrom === o.hubFrom &&
                        (feeder ? x.destination === o.destination : x.hubTo === o.hubTo);
                }), 'createdAt', 'asc');
                if (!waiting.some(function (x) { return x.id === o.id; })) waiting.push(o);
                var waitingKg = util.round(util.sum(waiting, function (x) { return Number(x.chargeableWeight) || 0; }), 2);
                // 成班：够起运量，或最老的一票已压到在库上限（时效让位于装载率的反面是压死货）
                var holdH = (at - cursorOf(waiting[0] ? (waiting[0].updatedAt || waiting[0].createdAt) : sortedAt)) / 3600000;
                // 支线按小时级开班，不等凑重：区域内三五票也要当天串走
                var minKg = feeder ? Math.min(MIN_TRIP_KG, 120) : MIN_TRIP_KG;
                if (!forceDepart && waitingKg < minKg && holdH < MAX_TRIP_WAIT_HOURS) return null;
                var created = TMS.operation.createTrip({
                    tripId: planned ? planned.id : '', fromHub: o.hubFrom, toHub: o.hubTo,
                    feeder: feeder, toCity: feeder ? o.destination : '',
                    distanceKm: feeder ? Math.max(35, util.distanceKm(
                        TMS.master.cityByName(o.origin), TMS.master.cityByName(o.destination))) : 0,
                    orderIds: waiting.map(function (x) { return x.id; }),
                    at: new Date(at), departAt: planned ? planned.departAt : undefined
                });
                if (!created.ok) return null;
                tr = created.transport;
            } else {
                o.tripId = tr.id;
                db.touch('orders');
                tr = TMS.operation.recalcTrip(tr);
            }
            return maybeDepart(tr, at);
        }

        function maybeDepart(tr, at) {
            if (!tr || tr.status !== 'pending') return tr ? db.get('transports', tr.id) : null;
            var live = db.get('transports', tr.id);
            var openedAt = cursorOf(live.createdAt);
            var departPlanAt = cursorOf(live.date + 'T' + (live.departAt || '20:00') + ':00');
            var cap = TMS.operation.capacityOf(live);
            var full = cap ? live.weight / cap >= 0.72 : live.weight >= MIN_TRIP_KG * 3;
            var waited = (at - openedAt) / 3600000;
            // 区域内支线「随到随装、装满或到点即发」；干线要凑够起运量，最多压货 MAX_TRIP_WAIT_HOURS
            var feeder = !!live.toCity;
            var minKg = feeder ? 400 : MIN_TRIP_KG;
            var maxWait = feeder ? 8 : MAX_TRIP_WAIT_HOURS;
            var go = forceDepart || full || live.mode === '空运'
                || (at >= departPlanAt && live.weight >= minKg)
                || waited >= maxWait;
            if (go) {
                TMS.operation.startTransport(live.id, {
                    operator: TMS.operation.driverOf(live) || '司机', device: '车载终端',
                    // 发车时间只取「现在」与「成班时间」的较大者：把班次时刻当成未来时间戳写进扫描，
                    // 会让后续环节从更早的游标推进，出现环节时间倒挂与未来值
                    at: new Date(Math.max(at, openedAt))
                });
            }
            return db.get('transports', live.id);
        }

        /* 异常注入：破损/延误/错分等，走完整闭环（受理→定责→扣款→闭环→可选理赔） */
        function maybeProblem(order, reached) {
            if (reached === 'inbound' && rand() < 0.015) {
                TMS.order.cancel(order.id, { reason: util.pick(['客户下单信息有误', '客户取消寄件', '重复下单'], rand), operator: '运营管理员' });
                return true;
            }
            if (reached === 'signed' && rand() < 0.012) {
                TMS.order.createReverseOrder(order.id, { reason: '客户拒收退货', operator: '客服专员' });
                return true;
            }
            var chance = reached === 'signed' ? 0.055 : 0.05;
            if (rand() > chance) return false;
            var id = order.id;
            var type = util.weighted([['货物破损', 26], ['延迟送达', 22], ['错分错发', 14], ['客户拒收', 12], ['包装不当', 9], ['地址不清', 8], ['温控异常', 5], ['违禁品', 4]], rand);
            var level = type === '货物破损' ? '二级' : (type === '温控异常' ? '一级' : '三级');
            var o = db.get('orders', id);
            if (!o || TMS.order.isTerminal(o)) return false;
            TMS.order.markProblem(id, {
                type: type, level: level,
                description: util.pick([
                    '外箱挤压变形，内件疑似受损', '面单模糊需重新补贴', '超出派送范围转第三方',
                    '收件人电话无法接通', '制冷机组故障温度回升', '分拣至错误格口导致延误'
                ], rand),
                operator: util.pick([].concat(couriers, sorters).map(function (e) { return e.name; }), rand),
                location: TMS.order.branchName(o, 'dest') || TMS.order.branchName(o, 'origin')
            });
            var ex = util.sortBy(TMS.service.exceptionsOf(id), 'reportedAt', 'desc')[0];
            if (!ex) return false;
            util.setNow(new Date(Math.min(cursorOf(o.updatedAt) + (4 + rand() * 30) * 3600000, realNowMs)));
            TMS.service.processException(ex.id, util.pick(branchStaff, rand).name);
            var party = util.weighted([['网点', 18], ['分拨中心', 16], ['司机', 12], ['承运商', 20], ['派送员', 16], ['客户', 12], ['系统', 6]], rand);
            var deduction = rand() < 0.55 ? util.round(50 + rand() * 1200, 0) : 0;
            TMS.service.assignResponsibility(ex.id, {
                party: party, deduction: deduction,
                responsible: party === '司机' ? (o.driverName || '待指派') : (party === '派送员' ? (o.courier || '待指派') : party),
                actor: '运营主管'
            });
            TMS.service.closeException(ex.id, {
                solution: util.pick(['补发', '改派', '退款', '折让', '追责扣款'], rand),
                rootCause: util.pick(['包装不规范', '分拣操作失误', '干线甩挂延误', '末端超区', '信息系统地址库过期'], rand),
                resolution: util.pick(['已与客户达成一致补发处理', '已改派并加急派送完成', '按条款折让赔付并结案', '已追偿责任方并闭环'], rand),
                createClaim: type === '货物破损' && rand() < 0.6,
                claimAmount: declaredOf(o) ? util.round(Math.min(declaredOf(o), 200 + rand() * 1800), 0) : util.round(100 + rand() * 500, 0),
                actor: '运营主管'
            });
            // 放行后继续完成剩余履约（问题件多数最终仍会签收）
            var re = db.get('orders', id);
            if (re && re.status === 'problem' && rand() < 0.8 && !TMS.order.isTerminal(re)) {
                TMS.order.releaseProblem(id, { operator: '运营主管', note: '异常闭环后放行继续转运' });
                walk(re, util.toDate(re.createdAt));
            }
            return true;
        }

        function declaredOf(o) { return Number(o.declaredValue) || 0; }

        /* ---------- 计费复核（到货复磅） ---------- */

        var recheckPool = db.col('orders').filter(function (o) { return ['transit', 'arrived', 'delivering', 'signed'].indexOf(o.status) > -1 && rand() < 0.05; });
        recheckPool.forEach(function (o) {
            util.setNow(util.addHours(util.toDate(o.updatedAt || o.createdAt), rand() * 6));
            var actual = util.round(Math.max(0.3, (Number(o.weight) || 1) * (0.82 + rand() * 0.4)), 2);
            TMS.finance.recheckWeight(o.id, {
                actualWeight: actual, dims: o.dims,
                reason: util.pick(['到货复磅', '体积重争议', '客户申诉重量', '分称抽检'], rand),
                operator: util.pick(branchStaff, rand).name
            });
        });

        /* ---------- 考勤、排班 ---------- */
        /* 只给一线作业岗排班打卡，职能岗走系统登录留痕；样本量控制在几十人，
           全员 90 天考勤会把 localStorage 吃掉一整块而业务价值很低。
           样本按岗位取前若干名，但演示账号绑定的档案必须一并进来：
           账号站在样本之外，登录后工作台、打卡、绩效三页全是空的 */
        var demoPeople = {};
        var demoNames = {};
        TMS.cfg.demoAccounts.forEach(function (a) { demoNames[a.username] = 1; });
        db.col('users').forEach(function (u) {
            if (u.personId && demoNames[u.username]) demoPeople[u.personId] = 1;
        });
        function rosterSample(list, n) {
            var head = list.slice(0, n);
            list.forEach(function (e) {
                if (demoPeople[e.id] && head.indexOf(e) === -1) head.push(e);
            });
            return head;
        }
        var rosterPool = [].concat(rosterSample(sorters, 26),
            rosterSample(db.col('employees').filter(function (e) { return e.role === 'transporter' && e.status === 'active'; }), 16),
            rosterSample(couriers, 24), rosterSample(branchStaff, 12));
        for (var sd = 2; sd >= -3; sd--) {
            var shiftDay = util.addDays(realNow, sd);
            util.setNow(util.addDays(shiftDay, 0));
            rosterPool.forEach(function (e) {
                if (rand() > (sd > 0 ? 0.45 : 0.7)) return;
                var def = util.pick(TMS.people.SHIFT_DEFS, rand);
                db.create('shifts', {
                    employeeId: e.id, employee: e.name, role: e.role, date: util.dateKey(shiftDay),
                    shiftCode: def.code, orgId: e.orgId, hubId: e.hubId || '',
                    attendance: sd > 0 ? '计划' : '待确认', remark: ''
                });
            });
        }
        for (var cd = 5; cd >= 0; cd--) {
            var clockDay = util.addDays(realNow, -cd);
            var dow = clockDay.getDay();
            if (dow === 0 && rand() > 0.25) continue;
            rosterPool.forEach(function (e) {
                if (rand() > 0.55) return;
                var inHour = 5 + Math.floor(rand() * 5);
                var at = new Date(clockDay.getFullYear(), clockDay.getMonth(), clockDay.getDate(), inHour, Math.floor(rand() * 59));
                util.setNow(at);
                var res = TMS.people.clockIn({ employeeId: e.id, location: e.orgName || e.city, device: rand() < 0.7 ? '手机 APP' : '工位考勤机' });
                if (!res || !res.ok) return;
                var out = new Date(at.getTime() + (7.5 + rand() * 3.5) * 3600000);
                if (out.getTime() > realNowMs) return;
                util.setNow(out);
                TMS.people.clockOut({ employeeId: e.id, location: e.orgName || e.city });
            });
        }

        /* ---------- 客服工单与月结账单 ---------- */

        for (var tk = DAYS - 1; tk >= 0; tk--) {
            var tDay = util.addDays(realNow, -tk);
            var tCount = 1 + Math.floor(rand() * 3);
            for (var t = 0; t < tCount; t++) {
                util.setNow(new Date(tDay.getFullYear(), tDay.getMonth(), tDay.getDate(), 9 + Math.floor(rand() * 10), Math.floor(rand() * 60)));
                var related = db.col('orders')[Math.floor(rand() * Math.max(1, db.col('orders').length))];
                if (!related) continue;
                var ticket = TMS.service.createTicket({
                    orderId: related.id,
                    type: util.weighted([['物流查询', 34], ['催件', 24], ['改址', 12], ['拒收退货', 8], ['发票问题', 8], ['投诉服务', 9], ['理赔咨询', 5]], rand),
                    priority: util.weighted([['高', 14], ['中', 56], ['低', 30]], rand),
                    content: util.pick(['请提供最新派送进度', '预计何时送达', '收件地址需要变更', '包裹显示异常请核实', '需要开具增值税专用发票', '对派送时效不满意', '破损件理赔材料已上传'], rand),
                    assignee: util.pick(branchStaff, rand).name, channel: util.pick(['在线客服', '电话', '企业微信', '客户经理'], rand),
                    linkException: rand() < 0.18
                });
                var elapsed = 1 + rand() * 20;
                util.setNow(util.addHours(util.toDate(ticket.createdAt), elapsed));
                if (elapsed < 2) continue;
                TMS.service.processTicket(ticket.id, ticket.assignee);
                util.setNow(util.addHours(util.toDate(ticket.createdAt), elapsed + 1 + rand() * 12));
                TMS.service.resolveTicket(ticket.id, util.pick(['已同步最新轨迹并安抚客户', '已改址并通知末端网点', '已提交开票申请', '已协调派送员优先处理', '理赔已受理'], rand), { satisfaction: rand() < 0.86 ? '满意' : '一般', operator: ticket.assignee });
            }
        }

        util.setNow(realNow);
        var periods = util.unique(db.col('receivables').map(TMS.finance.periodOf));
        periods.forEach(function (p) { TMS.finance.generateBills(p); });        // 回款：账期已过的应收按客户分层概率核销
        db.col('receivables').forEach(function (r) {
            if (r.status !== 'pending') return;
            var c = r.customerId ? db.get('customers', r.customerId) : null;
            var payProb = c ? ({ KA: 0.96, A: 0.9, B: 0.78, C: 0.5 })[c.level] : 0.7;
            var duePassed = util.toDate(r.dueDate) < realNow;
            if (duePassed && rand() < payProb) {
                util.setNow(util.addHours(util.toDate(r.dueDate), rand() * 24 * 6));
                TMS.finance.markReceivablePaid(r.id, { invoiceNo: 'INV' + TMS.ids.dayStamp() + util.randomDigits(4) });
            }
        });

        /* ---------- 代收货款上划（签收后 T+3 结算给发货客户） ---------- */

        db.col('codRecords').forEach(function (r) {
            if (r.remitStatus !== 'pending') return;
            var dueAt = util.toDate(util.addHours(r.collectedAt || r.createdAt, 72).getTime() + rand() * 72 * 3600000);
            if (dueAt > realNow || rand() > 0.86) return;
            util.setNow(dueAt);
            TMS.finance.remitCOD(r.id, util.pick(['财务结算组', '资金部'], rand));
        });

        /* ---------- 派送提成 / 分拨操作费应付 + 期间费用计提 ---------- */

        var payablePeriods = util.unique(db.col('receivables').map(TMS.finance.periodOf)
            .concat([util.monthKey(realNow)]));
        payablePeriods.forEach(function (period) {
            // 账期落在月内某一天即可派生 period，应付行不再单独存月份
            var accrualDate = util.dateKey(util.addDays(util.toDate(period + '-01'), 27));
            var signedByCourier = util.groupBy(db.col('orders').filter(function (o) {
                return o.status === 'signed' && o.courierId && util.monthKey(o.signedAt) === period;
            }), 'courierId');
            Object.keys(signedByCourier).forEach(function (cid) {
                var list = signedByCourier[cid];
                var amount = util.money(list.length * cfg.cost.deliverPerOrder * 0.85);
                if (amount <= 0) return;
                db.create('payables', {
                    refId: cid, target: (db.get('employees', cid) || {}).name || '派送员',
                    targetType: 'driver', category: '派送费', amount: amount, date: accrualDate,
                    dueDate: util.dateKey(util.addDays(util.toDate(period + '-01'), 45)),
                    status: 'pending', settledAt: '', remark: list.length + ' 票派送提成'
                }, { stamp: false });
            });
            var hubTasks = util.groupBy(db.col('sortingTasks')
                .filter(function (x) { return x.status === 'done' && util.monthKey(x.finishedAt || x.createdAt) === period; })
                .map(TMS.operation.sortingTaskView), 'hubId');
            Object.keys(hubTasks).forEach(function (hid) {
                var list = hubTasks[hid];
                var pieces = util.sum(list, 'pieces');
                var amount = util.money(pieces * cfg.cost.sortPerPiece);
                if (amount <= 0) return;
                db.create('payables', {
                    refId: hid, target: (db.get('hubs', hid) || {}).name || '分拨中心',
                    targetType: 'branch', category: '操作费', amount: amount, date: accrualDate,
                    dueDate: util.dateKey(util.addDays(util.toDate(period + '-01'), 45)),
                    status: 'pending', settledAt: '', remark: pieces + ' 件分拣操作费'
                }, { stamp: false });
            });
            // 账期已过：绝大部分应付结算，走 settlePayable 让费用同步进损益流水
            db.col('payables').filter(function (p) { return TMS.finance.periodOf(p) === period && p.status === 'pending'; })
                .forEach(function (p) {
                    if (util.toDate(p.dueDate) > realNow || rand() > 0.75) return;
                    util.setNow(util.addHours(util.toDate(p.dueDate), rand() * 24 * 5));
                    TMS.finance.settlePayable(p.id, { operator: '财务结算组' });
                });
        });
        // 场地/班组/车队/系统这类不挂在票上的固定开支按月计提，账面才不只有单票成本
        util.unique(payablePeriods).forEach(function (p) { TMS.finance.accruePeriodExpenses(p); });

        /* ---------- 仓储库存流水 ---------- */

        /* 库存行只存「当前数量」不够：没有出入库凭证就核不出账实差异，也算不出消耗速率与周转天数。
           按「期初建账 → 领用出库 → 补货入库 → 盘点调整」回放一串流水，并让 Σ带符号流水 恰好等于现有存量，
           页面的账实核对必须对得上才是真账。跨仓调拨拆成「一出一入」两条配对流水，同样不落规则之外。
           出库只减库存、不确认费用：包材的单票成本已在计费口径里按订单摊过，这里再入账就是双计。 */
        var USE_TEXT = ['分拨包装领用', '网点耗材领用', '冷链冰袋周转', '面单打印消耗', '托盘周转调用'];
        var mvDate = function (back) { return util.addDays(realNow, -back); };
        db.col('stocks').forEach(function (s) {
            var wh = db.get('warehouses', s.warehouseId) || {};
            var keeper = wh.manager || '仓管员';
            var cur = Math.max(0, Number(s.qty) || 0);
            var ev = [];
            var sumOut = 0, sumIn = 0, adj = 0;
            var nOut = cur > 40 ? 2 + Math.floor(rand() * 2) : 1;
            for (var i = 0; i < nOut; i++) {
                var q = Math.max(1, Math.round(cur * (0.04 + rand() * 0.1)));
                if (sumOut + q > cur * 0.45) break;
                sumOut += q;
                ev.push({ kind: 'out', qty: q, at: mvDate(3 + Math.floor(rand() * 38)),
                    reason: util.pick(USE_TEXT, rand), operator: keeper });
            }
            var nIn = rand() < 0.5 ? 1 : 2;
            for (var j = 0; j < nIn; j++) {
                var qi = Math.max(2, Math.round(cur * (0.1 + rand() * 0.18)));
                // 入库不能把期初压成负数：建仓时不可能「先卖后补」
                if (sumIn + qi > cur + sumOut - 1) break;
                sumIn += qi;
                ev.push({ kind: 'in', qty: qi, at: mvDate(6 + Math.floor(rand() * 34)),
                    reason: '采购到货入库', operator: keeper });
            }
            if (rand() < 0.18 && cur > 30) {
                adj = (rand() < 0.5 ? -1 : 1) * Math.max(1, Math.round(cur * 0.012));
                ev.push({ kind: 'adjust', qty: adj, at: mvDate(1 + Math.floor(rand() * 20)),
                    reason: adj < 0 ? '月度盘点盘亏' : '月度盘点盘盈', operator: keeper });
            }
            ev.push({ kind: 'in', qty: cur + sumOut - sumIn - adj, at: mvDate(46 + Math.floor(rand() * 8)),
                reason: '期初建账', operator: keeper });
            ev.sort(function (a, b) { return a.at.getTime() - b.at.getTime(); });
            ev.forEach(function (m) {
                var at = util.addHours(m.at, 8 + Math.floor(rand() * 10));
                db.create('stockMovements', {
                    kind: m.kind, date: util.dateKey(at), warehouseId: s.warehouseId, materialId: s.materialId,
                    qty: m.qty, reason: m.reason, operator: m.operator, createdAt: util.iso(at)
                }, { stamp: false });
            });
            var last = ev[ev.length - 1];
            if (last) s.updatedAt = util.iso(util.addHours(last.at, 12));
        });

        /* 缺料补货：低库存物料挂一张在途采购单 + 对应供应商应付，
           到货入库时把在途冲平、库存加回、告警自动消除——补货链路在建库阶段就要是活的 */
        db.col('materials').filter(function (m) { return m.stock < m.safeStock; }).forEach(function (m) {
            var need = Math.max(10, Math.round((m.safeStock - m.stock) * 1.4));
            var wh = db.col('warehouses')[Math.floor(rand() * Math.max(1, db.col('warehouses').length))];
            if (!wh) return;
            /* 一部分补货单故意压在 8~20 天前：到货超期是采购日常，
               这样「采购到货超期」巡检与「催到货」动作在建库里就有真实对象可指 */
            var back = rand() < 0.4 ? 8 + Math.floor(rand() * 13) : Math.floor(rand() * 6);
            var at = util.addDays(realNow, -back);
            var sup = db.get('suppliers', m.supplierId) || {};
            var amount = util.money(util.round(need * (Number(m.price) || 1), 2));
            var mv = db.create('stockMovements', {
                kind: 'purchase', date: util.dateKey(at), warehouseId: wh.id, materialId: m.id,
                qty: need, status: 'pending', reason: '安全库存不足，紧急补货',
                operator: wh.manager || '仓管员', createdAt: util.iso(at)
            }, { stamp: false });
            var ap = db.create('payables', {
                refId: m.id, refNo: mv.id, target: sup.name || m.supplier || '物料供应商', targetType: 'supplier',
                category: '物料耗材', amount: amount, date: util.dateKey(at),
                dueDate: util.dateKey(util.addDays(at, sup.settleCycle === '半月结' ? 15 : 30)),
                status: 'pending', settledAt: '', remark: need + (m.unit || '件') + ' ' + m.name + ' 采购在途'
            }, { stamp: false });
            db.update('stockMovements', mv.id, { refId: ap.id });
            m.inTransit = (Number(m.inTransit) || 0) + need;
        });

        /* ---------- 考核与绩效 ---------- */

        /* 绩效账期取最近一个「已关账且有单量」的自然月：月初那几天就把当月拿来算月度绩效，
           全网络会因为单量不足定成 D 档，考核与改进计划全部失真。
           建库过程一直在 setNow 回放历史，这里必须先复位到真实时刻，否则账期跟着最后一张应付单的日期跑 */
        util.setNow(realNow);
        TMS.people.generatePerformances(TMS.people.defaultPeriod());
        /* 考核从绩效行出发：业绩分抄同期绩效，能力与态度是主管的加减分，
           人事结论跟着评定后的档位走——只有真拿到 D 的人才进改进计划。
           取样按得分高低等距抽 26 人（不是只抽头部），改进计划、待评定、已晋升三种状态才有真样本 */
        var perfRows = util.sortBy(db.col('performances'), 'score', 'desc');
        for (var pi = 0; pi < 26 && perfRows.length; pi++) {
            var p = perfRows[Math.round(pi * (perfRows.length - 1) / 25)];
            var k = p.score;
            var a = util.round(60 + rand() * 38, 1), att = util.round(65 + rand() * 33, 1);
            var grade = TMS.people.gradeOf(util.round(k * 0.6 + a * 0.25 + att * 0.15, 1));
            var rec = TMS.people.evaluate({
                employeeId: p.employeeId, period: p.period, kpiScore: k, abilityScore: a, attitudeScore: att,
                evaluator: util.pick(branchStaff, rand).name,
                promotion: pi >= 5 ? (grade === 'D' ? '绩效改进计划'
                    : (['A+', 'A'].indexOf(grade) > -1 && (pi < 10 || rand() < 0.3) ? '晋升候选' : '')) : '',
                comment: grade === 'D' ? util.pick(['错分率偏高，需回炉带教', '签收时效连续掉线，客户催件集中在名下'], rand)
                    : (grade === 'C' ? '履约基本达标，时效波动还需要压'
                        : util.pick(['履约质量稳定，客户零投诉', '旺季抗压表现突出', '主动优化装载率，成本改善明显'], rand)),
                status: 'pending'
            });
            /* 前 5 张留在待评定：能力分与态度分没签字，考核页一进去就有活可干，
               「草稿不定级」这条口径也就不只是文档里的说明 */
            if (pi >= 5) TMS.people.finalizeEvaluation(rec.id, { kpiScore: k, abilityScore: a, attitudeScore: att });
        }

        /* ---------- 审计与系统留痕 ---------- */

        var sampleOrders = db.col('orders').slice(-120);
        sampleOrders.forEach(function (o, i) {
            util.setNow(util.addHours(util.toDate(o.updatedAt), i % 5));
            TMS.audit.log(util.pick(['order.create', 'order.change', 'finance.settle', 'rate.update', 'user.login', 'network.update'], rand),
                'orders', o.id, util.pick(['批量导入客户订单', '调整区域运价卡', '手工核销应收', '维护网点服务范围', '导出月度对账单'], rand),
                util.pick(branchStaff, rand).name);
        });

        /* ---------- 理赔审批 ---------- */

        /* 异常闭环时只建了理赔单，审批这一步从来没人走：
           理赔台账的支出走势、客户「我的理赔」、网点理赔进度因此常年空白，
           而审批才是理赔模块的主流程。按申报时间推进——多数核准落支出、少数驳回、留一批待审批 */
        util.sortBy(db.col('claims'), 'createdAt', 'asc').forEach(function (c) {
            if (c.status !== 'pending') return;
            var roll = rand();
            if (roll > 0.82) return;
            var at = util.addHours(util.toDate(c.createdAt), 8 + rand() * 96);
            if (at.getTime() > realNowMs) at = new Date(realNowMs - Math.floor(rand() * 24) * 3600000);
            util.setNow(at);
            if (roll < 0.68) {
                TMS.service.approveClaim(c.id, {
                    handler: '理赔专员',
                    note: c.isInsured ? '保价足额，按申报价核赔' : '未保价，按运费 5 倍封顶核赔'
                });
            } else {
                TMS.service.rejectClaim(c.id, util.pick(['证据不足，不予赔付', '超出索赔时效', '包装不当由客户自担'], rand), '理赔专员');
            }
        });

        /* ---------- 偏离路由留痕 ---------- */

        /* 错分错发在真实网络里就是「件被扫进了别的分拨」，轨迹上必须留下那条偏离补录；
           回放只建异常、不补录，于是时效监控的「偏离路由」永远 0，
           轨迹表按「仅偏离」筛出来是空的——功能在，数据从来没进过库。
           按异常发生时刻补一条 TRANSIT，地点写错落的那个分拨，走领域接口而不是改库。
           时刻必须落在「已分拣」与「已到件」之间：分拣前谈不上误落他线分拨，
           到件之后再插一条 TRANSIT 会让轨迹时间倒挂、还会造出跳步的假状态。
           异常登记得早或报得晚是常态，所以取异常时刻夹进这段窗口，而不是把单子挑掉——
           挑掉会让围栏越界与偏离轨迹重新变回零，页面又是「功能在、数据不在」 */
        var deviantDone = 0;
        var traceIdx = TMS.order.scanIndex();
        util.sortBy(db.col('exceptions'), 'occurredAt', 'desc').forEach(function (e) {
            if (deviantDone >= 6 || e.type !== '错分错发') return;
            var o = db.get('orders', e.orderId);
            if (!o) return;
            var hops = traceIdx[o.id] || [];
            var sortedAt = TMS.order.stageAt(o, 'sorted', hops);
            if (!sortedAt) return;
            var arrivedAt = TMS.order.stageAt(o, 'arrived', hops);
            var lo = util.toDate(sortedAt).getTime() + 60000;
            var at = util.toDate(e.occurredAt).getTime();
            at = Math.max(lo, arrivedAt ? Math.min(at, util.toDate(arrivedAt).getTime()) : at);
            var wrong = util.pick(db.col('hubs').filter(function (h) {
                return h.id !== o.hubFrom && h.id !== o.hubTo;
            }), rand);
            if (!wrong) return;
            util.setNow(new Date(at));
            TMS.order.addScan(o, 'TRANSIT', {
                location: wrong.name, operator: '分拨作业员',
                remark: '件误落 ' + wrong.city + ' 分拨，改签下一班（人工补录）',
                at: new Date(at), deviant: true
            });
            db.commit('scans', o.id, 'order:trace');
            deviantDone++;
        });

        /* ---------- 围栏外作业留痕 ---------- */
        /* 主数据特意留一座「停用待复核」的围栏当缺口样本，可常规作业的扫描地点由订单派生、并不落库，
           只有显式带 location 的流水才参与围栏判定。于是围栏页的「覆盖缺口」「越界作业明细」
           两张卡常年空着，fence:gap 告警也永远是 0——判定逻辑在，样本数据不在。
           真实成因是终端定位漂移、现场作业在围栏外：按问题件节点补录，只追加流水，不动订单主状态 */
        (function offFenceScan() {
            var gap = db.col('geofences').filter(function (g) { return g.status !== 'active'; })[0];
            if (!gap) return;
            var inGap = {};
            db.col('branches').forEach(function (b) { if (b.city === gap.city) inGap[b.name] = b; });
            if (!Object.keys(inGap).length) return;
            var clock = util.now();
            var realNow = new Date();
            var done = 0;
            util.sortBy(db.col('orders'), 'updatedAt', 'desc').forEach(function (o) {
                if (done >= 8) return;
                if (['cancelled', 'signed', 'returned'].indexOf(o.status) > -1) return;
                var dest = TMS.order.branchName(o, 'dest'), orig = TMS.order.branchName(o, 'origin');
                var where = inGap[dest] ? dest : (inGap[orig] ? orig : '');
                if (!where) return;
                var at = new Date(realNow.getTime() - (3 + rand() * 96) * 3600000);
                util.setNow(at);
                TMS.order.addScan(o, 'PROBLEM', {
                    location: where, operator: '网点作业员', device: 'PDA-9000',
                    remark: '现场扫描点不在 ' + gap.city + ' 作业围栏内（终端定位漂移）', at: at
                });
                db.commit('scans', o.id, 'order:trace');
                done++;
            });
            util.setNow(clock);
        })();

        /* ---------- 在岗快照 ---------- */
        /* 回放收尾会把历史积压一路推到签收，代价是「此刻」没有正在发生的作业：
           一线六端打开工作台全是空态，看不出系统怎么流转。真实分拨在任意时刻同时存在
           待揽收、待分拣、待出港、到件待领取、滞留、待上划货款与未闭环异常。
           这里按演示派送员的驻场网点补一小批在岗单（同城支线，二十票以内），
           每一环都走真实领域动作，扫描流水、轨迹、应收应付与绩效仍然自洽 */
        (function staffOnDuty() {
            function account(role) {
                var acc = cfg.demoAccounts.filter(function (a) { return a.role === role; })[0];
                if (!acc) return null;
                var u = db.findOne('users', function (x) { return x.username === acc.username; });
                return u ? { name: acc.name, orgId: u.orgId, personId: u.personId } : null;
            }
            var courier = account('deliveryman'), clientAcc = account('client');
            var br = courier ? db.get('branches', courier.orgId) : null;
            if (!br || br.status !== 'active') return;
            var hub = br.hubId;
            var customer = clientAcc ? db.get('customers', clientAcc.orgId) : null;
            var hubName = (TMS.master.hubByNameOrId(hub) || {}).name || br.name;
            var myCourier = courier.personId ? db.get('employees', courier.personId) : null;

            /* 收派网点由「地址哈希 % 同城网点数」派生，想让单落在演示网点，
               就得试出一个命中它的地址，而不是建完单再改库里的网点字段 */
            function addrFor(branch, kind) {
                for (var n = 1; n < 240; n++) {
                    var a = branch.city + '示范路' + n + '号';
                    var hit = kind === 'dest'
                        ? TMS.network.deliverBranch(branch.city, a)
                        : TMS.network.collectBranch(branch.city, a);
                    if (hit && hit.id === branch.id) return a;
                }
                return branch.city + '示范路 1 号';
            }
            var fromAddr = addrFor(br, 'origin'), toAddr = addrFor(br, 'dest');
            function ago(hours) { return new Date(realNowMs - hours * 3600000); }
            var seq = 0;

            function newOrder(opt) {
                var at = opt.at || ago(2 + rand() * 8);
                util.setNow(at);
                var goods = opt.goods || util.pick(TMS.master.GOODS, rand).name;
                var weight = opt.weight || util.round(1.5 + rand() * 22, 2);
                var pieces = opt.pieces || (weight > 16 ? 2 : 1);
                var res = TMS.order.create({
                    origin: br.city, destination: br.city, service: opt.service || '标准',
                    customerId: customer ? customer.id : '',
                    customer: customer ? '' : '散客',
                    contact: customer ? customer.contact : '王敏',
                    phone: customer ? customer.phone : PHONE(rand),
                    goods: goods, weight: weight, pieces: pieces, dims: dimsFor(weight / pieces, goods),
                    declaredValue: opt.declared || 0, isInsured: !!opt.declared,
                    paymentMethod: opt.payment || '现付', codAmount: opt.cod || 0,
                    channel: '客户经理',
                    senderAddress: fromAddr,
                    receiverName: util.pick(NAMES_SUR, rand) + util.pick(NAMES_GIV, rand),
                    receiverPhone: PHONE(rand), receiverAddress: toAddr,
                    remark: opt.remark || '', createdAt: util.iso(at),
                    actor: (myCourier && myCourier.name) || '客户经理'
                });
                seq++;
                return res.ok ? res.order : null;
            }

            /* 揽收→入库→分拣：走到哪一格就停在哪一格，停下的那一格正是在岗任务 */
            function advance(o, to) {
                var base = util.toDate(o.createdAt);
                if (to === 'created') return db.get('orders', o.id);
                util.setNow(util.addHours(base, 1 + rand()));
                TMS.order.collect(o.id, {
                    operator: (myCourier && myCourier.name) || '揽收员',
                    device: util.pick(devicePool, rand), location: br.name
                });
                if (to === 'collected') return db.get('orders', o.id);
                util.setNow(util.addHours(base, 2.5 + rand()));
                TMS.order.inbound(o.id, {
                    operator: staffOf(branchStaff, br.id, '作业员').name,
                    device: util.pick(devicePool, rand), location: br.name
                });
                if (to === 'inbound') return db.get('orders', o.id);
                util.setNow(util.addHours(base, 4 + rand()));
                var row = db.get('orders', o.id);
                TMS.order.sort(o.id, {
                    operator: staffOf(sorters, row.hubFrom, '分拣员').name,
                    chute: 'C' + util.pad(1 + Math.floor(rand() * 39), 2),
                    device: util.pick(devicePool, rand), location: hubName
                });
                return db.get('orders', o.id);
            }

            /* 已分拣件装车：停在 departed 是司机端的在途，停在 arrived 是网点端的待领取。
               到件时刻由入参决定，不写死「5 小时前」——滞留、待领取、签收各自要落在
               不同的时间刻度上，写死一个值会让签收比到件还早，时间轴直接倒挂 */
            function shipOut(list, stayTransit, departHours, arriveHours) {
                var rows = list.map(function (o) { return db.get('orders', o.id); })
                    .filter(function (o) { return o && o.status === 'sorted' && !o.tripId; });
                if (rows.length < list.length) return null;
                var dep = ago(departHours);
                /* 快照队列每一格都要留在自己的刻度上：补车时不能顺手把「待领取」「在途」
                   那几格预定好的件拉走，否则后面几次 shipOut 凑不齐人，界面当场空一格 */
                var reserved = {};
                [queues.todo, queues.got, queues.inbound, queues.sorted, queues.transit,
                    queues.arrived, queues.stuck, queues.cod].forEach(function (q) {
                        (q || []).forEach(function (o) { if (o) reserved[o.id] = 1; });
                    });
                var mine = {};
                rows.forEach(function (o) { mine[o.id] = 1; });
                var veh = util.sortBy(db.col('vehicles').filter(function (v) {
                    return v.hubId === hub && v.status === 'available';
                }), 'loadKg', 'asc')[0];
                if (!veh) return null;
                var bar = util.round(veh.loadKg * TMS.cfg.cost.selfLoadMin, 2);
                var kg = util.round(util.sum(rows, 'chargeableWeight'), 2);
                /* 支线一趟只有二三十公斤，硬塞 vehicleId 会绕过 createTrip 的自有/外协改判：
                   四百公斤的接驳车拉 25 公斤，装载率压到 6%，运力复盘判成放空跑。
                   真实调度是凑不满不发——先从本场已分拣、且发车时刻之前就已存在的件里补，
                   补得过 selfLoadMin 才派自有车；补不出来就交回领域层按协议舱位外协，
                   把车位留给真正满载的干线 */
                if (kg < bar) {
                    db.col('orders').forEach(function (o) {
                        if (kg >= bar || rows.length >= 60) return;
                        if (o.status !== 'sorted' || o.tripId || reserved[o.id] || mine[o.id]) return;
                        if (o.hubFrom !== hub && o.hubTo !== hub) return;
                        if (util.toDate(o.createdAt) > dep) return;
                        rows.push(o);
                        mine[o.id] = 1;
                        kg = util.round(kg + (Number(o.chargeableWeight) || 0), 2);
                    });
                }
                util.setNow(dep);
                var res = TMS.operation.createTrip({
                    fromHub: hub, toHub: hub, feeder: true, toCity: br.city,
                    distanceKm: 48, orderIds: rows.map(function (o) { return o.id; }),
                    vehicleId: kg >= bar ? veh.id : '', at: dep, remark: '区域内支线·在岗快照'
                });
                if (!res.ok) return null;
                /* 司机交给领域层反查（先沿用车队档案里的固定驾驶员，本场没有在岗的才兜底），
                   这里硬塞 tailDriver 会把武汉的司机派到上海的支线上。
                   改走舱位就没有司机，交接人是网点那边的人，别冒充司机 */
                var who = res.driver ? res.driver.name : '网点交接员';
                var trId = res.transport.id;
                util.setNow(new Date(dep.getTime() + 1800000));
                TMS.operation.startTransport(trId, { operator: who, at: dep });
                if (stayTransit) return trId;
                var arr = ago(arriveHours);
                util.setNow(arr);
                TMS.operation.arriveTransport(trId, { operator: who, at: arr });
                return trId;
            }

            /* 到件之后：认领即进我的派送列表，签收含代收款的单会挂出待上划货款 */
            function assignOut(o) {
                if (!myCourier) return;
                util.setNow(ago(3 + rand() * 2));
                TMS.order.assignDelivery(o.id, { courierId: myCourier.id, courier: myCourier.name, operator: myCourier.name });
            }

            function signOut(o, hoursAgo, receiver) {
                util.setNow(ago(hoursAgo));
                TMS.order.sign(o.id, {
                    receiver: receiver || '本人签收', receiverPhone: o.receiverPhone || '',
                    photo: rand() < 0.6, note: '', operator: (myCourier && myCourier.name) || '派送员',
                    device: util.pick(devicePool, rand)
                });
            }

            var queues = {
                todo: [], got: [], inbound: [], sorted: [], transit: [],
                arrived: [], stuck: [], cod: [], delivering: []
            };
            function push(list, o, to) {
                if (!o) return;
                list.push(advance(o, to));
            }
            /* 每一格的建单时刻都要比它的动作时刻更早，且装车时刻晚于分拣时刻，
               否则时间轴倒挂，轨迹与滞留时长都算不出东西 */
            for (var q = 0; q < 4; q++) {
                var o1 = newOrder({ at: ago(0.6 + q * 1.4), remark: '需上门收货，货已备好' });
                if (o1) queues.todo.push(o1);
            }
            /* 取走但还没回网点入库：件在派送员手上，揽收台这一格天天都有 */
            push(queues.got, newOrder({ at: ago(5) }), 'collected');
            push(queues.got, newOrder({ at: ago(6.2) }), 'collected');
            push(queues.inbound, newOrder({ at: ago(6) }), 'inbound');
            push(queues.inbound, newOrder({ at: ago(7.5) }), 'inbound');
            for (var s2 = 0; s2 < 3; s2++) push(queues.sorted, newOrder({ at: ago(8 + s2 * 2) }), 'sorted');
            for (var s3 = 0; s3 < 3; s3++) push(queues.transit, newOrder({ at: ago(12 + s3 * 2) }), 'sorted');
            for (var s4 = 0; s4 < 5; s4++) push(queues.arrived, newOrder({ at: ago(22 + s4 * 3) }), 'sorted');
            /* 滞留件按四天前的单造：同城标准的承诺是 72 小时，
               压两天半才派出去的件既进「在库滞留超 48 小时」，也过承诺时效进派送员的超时风险 */
            for (var s5 = 0; s5 < 3; s5++) push(queues.stuck, newOrder({ at: ago(96 + s5 * 4) }), 'sorted');
            for (var s6 = 0; s6 < 2; s6++) push(queues.cod, newOrder({
                at: ago(40 + s6 * 4), payment: '到付', cod: util.round(300 + rand() * 1500, 0),
                declared: 1200, goods: '电子产品'
            }), 'sorted');

            /* 三段车程三种刻度：压库四天多的滞留、今天上午刚到待领取、正在跑的在途。
               真实网点在任意时刻都是这三件货同时在库，缺一段就少一整块看板 */
            shipOut(queues.stuck, false, 90, 88);
            shipOut(queues.arrived, false, 8, 6);
            shipOut(queues.cod, false, 33, 31);
            shipOut(queues.transit, true, 5);

            /* 到件之后：奇偶分一半给我今天送，另一半留在网点等认领 */
            queues.arrived.forEach(function (o, i) {
                var row = db.get('orders', o.id);
                if (!row || row.status !== 'arrived') return;
                if (i % 2 === 0) { assignOut(row); queues.delivering.push(row); }
            });
            /* 代收货款：签收后即应挂在我的名下待上划，未上划的差额按制度算我个人欠公司的。
               先认领再签收，货款记录才认得到派送员 */
            queues.cod.forEach(function (o, i) {
                var row = db.get('orders', o.id);
                if (!row || row.status !== 'arrived') return;
                assignOut(row);
                signOut(row, i ? 20 : 26, i ? '前台代收' : '本人签收');
            });

            /* 压库两天多才派出去的件：认领之后仍在我手上、且早过了承诺时效。
               「超时风险」和「派送中」是同一条记录的两面——件在我名下但已经来不及了 */
            var lateRow = db.get('orders', (queues.stuck[0] || {}).id);
            if (lateRow && lateRow.status === 'arrived' && !lateRow.courierId) {
                assignOut(lateRow);
                queues.delivering.push(lateRow);
            }

            /* 未闭环异常：待受理、已受理未定责、已定责待闭环各留一单，
               异常台与运营端流程看板才有阶段可看，一线端的「我的异常」也不会永远空。
               三条各取自不同环节（待揽收 / 派送中 / 到件待领取），阶段差异才是异常的看点；
               派送员那一条必须挂在自己名下——问题件按 courierId 归人，别人手上的件不算我的 */
            var excTargets = [
                queues.todo[3], queues.delivering[0], queues.arrived[3]
            ];
            excTargets.forEach(function (o, i) {
                if (!o) return;
                util.setNow(ago(2 + i * 3));
                TMS.order.markProblem(o.id, {
                    type: util.pick(['地址不清', '货物破损', '客户拒收', '延迟送达'], rand),
                    level: i === 0 ? '一级' : '二级',
                    description: util.pick(['外箱挤压变形，内件疑似受损', '超承诺时效仍未送达', '收件人拒收并要求退回', '地址不详无法联系'], rand),
                    operator: (myCourier && myCourier.name) || '派送员',
                    location: br.name
                });
                var ex = util.sortBy(TMS.service.exceptionsOf(o.id), 'reportedAt', 'desc')[0];
                if (!ex) return;
                if (i === 0) return;                                   // 待受理
                util.setNow(ago(1 + i));
                TMS.service.processException(ex.id, staffOf(branchStaff, br.id, '客服专员').name);
                if (i === 1) return;                                   // 已受理未定责
                var row = db.get('orders', o.id);
                TMS.service.assignResponsibility(ex.id, {
                    party: '司机', deduction: util.round(80 + rand() * 400, 0),
                    responsible: row.driverName || '待指派', actor: '运营主管'
                });                                          // 已定责待闭环
            });

            /* 客服工单：一单待受理、一单处理中，网点服务台与首页告警都要它 */
            var tkOrder = queues.todo[0] || queues.inbound[0];
            [0, 1].forEach(function (i) {
                var rel = (i ? queues.delivering[0] : tkOrder);
                if (!rel) return;
                util.setNow(ago(1.5 + i * 5));
                var ticket = TMS.service.createTicket({
                    orderId: rel.id,
                    type: i ? '催件' : '物流查询',
                    priority: i ? '高' : '中',
                    content: i ? '这批货今天必须到，请安排加急派送' : '请提供最新派送进度与预计到达时间',
                    assignee: staffOf(branchStaff, br.id, '客服专员').name,
                    channel: '企业微信'
                });
                if (i === 1 && ticket) {
                    util.setNow(ago(0.5));
                    TMS.service.processTicket(ticket.id, ticket.assignee);
                }
            });

            /* 客户与网点的理赔进度：理赔是跟着运单走的，演示客户手上得有可查的单，
               而网点服务台只认「这张单在不在我的进出港范围里」——
               优先用上面刚签收的到付件，它同时满足客户与网点两个口径 */
            var claimOrder = null;
            claimOrder = db.get('orders', (queues.cod[0] || queues.arrived[0] || {}).id);
            if (!claimOrder || claimOrder.status !== 'signed') {
                claimOrder = customer
                    ? db.col('orders').find(function (o) { return o.customerId === customer.id && o.status === 'signed'; })
                    : null;
            }
            if (claimOrder && !db.col('claims').some(function (c) { return c.orderId === claimOrder.id; })) {
                /* 理赔在签收之后申报：破损是收到货才看得见的东西，时序倒过来就成凭据造假 */
                util.setNow(ago(18));
                var cl = TMS.service.createClaim({
                    orderId: claimOrder.id, type: '货物破损',
                    amount: util.round(Math.min(declaredOf(claimOrder) || 600, 200 + rand() * 800), 0),
                    reason: '外包装破损，内件外壳裂损', evidence: '开箱照片 4 张、运单照片 1 张',
                    applicant: (customer && customer.contact) || '客户'
                });
                if (cl && cl.status === 'pending') {
                    util.setNow(ago(6));
                    TMS.service.approveClaim(cl.id, { handler: '理赔专员', note: '保价足额，按申报价核赔' });
                }
            }

            /* 「今日揽收记录」按自然日筛：快照的揽收时刻挂在下单后一两小时，
               零点刚过那半小时里它还落在昨天，网点工作台首屏直接空一格。
               真实网点每天的第一笔揽收就发生在早上，这里把两单待揽收按「刚刚」收掉，
               当天台账与「入库称重」入口当场有对象可点 */
            var dayStart = new Date(realNow); dayStart.setHours(0, 5, 0, 0);
            var pickT0 = Math.max(dayStart.getTime(), realNow.getTime() - 30 * 60000);
            var pickedToday = 0;
            queues.todo.forEach(function (o) {
                if (pickedToday >= 2) return;
                var at = pickT0 + pickedToday * 5 * 60000;
                if (at >= realNow.getTime() - 30000) return;
                var row = db.get('orders', o.id);
                if (!row || row.status !== 'created') return;
                util.setNow(new Date(at));
                TMS.order.collect(o.id, {
                    operator: (myCourier && myCourier.name) || '揽收员',
                    device: util.pick(devicePool, rand), location: br.name
                });
                pickedToday++;
            });
            if (pickedToday) {
                queues.todo = queues.todo.filter(function (x) {
                    var r = db.get('orders', x.id);
                    return r && r.status === 'created';
                });
            }

            util.setNow(realNow);
        })();

        /* 车辆状态与在途车次对齐：避免历史车次长期占用运力 */
        var busyPlates = {};
        db.col('transports').forEach(function (t) {
            if (['departed'].indexOf(t.status) > -1 && util.toDate(t.date) >= util.addDays(realNow, -2)) busyPlates[t.vehicleId] = 1;
        });
        db.col('vehicles').forEach(function (v) {
            if (v.status === 'busy' && !busyPlates[v.id]) v.status = rand() < 0.12 ? 'maintenance' : 'available';
        });

        var piecesByHub = {};
        db.col('sortingTasks').forEach(function (t) {
            var hub = (db.get('orders', t.orderId) || {}).hubFrom;
            if (!hub) return;
            piecesByHub[hub] = (piecesByHub[hub] || 0) + (Number(t.pieces) || 1);
        });
        db.col('hubs').forEach(function (h) {
            h.usedPieces = Math.min(h.capacityPieces, Math.round((piecesByHub[h.id] || 0) * 0.06 + h.capacityPieces * 0.18));
        });

        util.setNow(null);
        TMS.ids.setRandom(null);
        db.persist('seed');
        try { TMS.jobs.sweep(true); } catch (err) { if (console) console.warn('[TMS] 建库巡检失败', err); }
        return target;
    }

    TMS.seed = { generate: generate, DAYS: DAYS, BASE_VOLUME: BASE_VOLUME };
})(window);
