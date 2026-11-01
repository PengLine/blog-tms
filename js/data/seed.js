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

        /* ---------- 订单回放 ---------- */

        for (var d = DAYS - 1; d >= 0; d--) {
            var day = util.addDays(realNow, -d);
            var factor = util.seasonFactor(day) * (0.78 + rand() * 0.5);
            var count = Math.max(3, Math.round(BASE_VOLUME * factor * (d === 0 ? 0.45 : 1)));
            for (var i = 0; i < count; i++) simulateOrder(day, i);
        }
        closeOut();

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
                    return x.status === 'sorted' && !x.tripId && x.hubFrom === o.hubFrom &&
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
           全员 90 天考勤会把 localStorage 吃掉一整块而业务价值很低 */
        var rosterPool = [].concat(sorters.slice(0, 26),
            db.col('employees').filter(function (e) { return e.role === 'transporter' && e.status === 'active'; }).slice(0, 16),
            couriers.slice(0, 24), branchStaff.slice(0, 12));
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

        /* ---------- 考核与绩效 ---------- */

        var perfPeriods = util.unique(db.col('orders').map(function (o) { return util.monthKey(o.createdAt); })).slice(-1);
        perfPeriods.forEach(function (p) { TMS.people.generatePerformances(p); });
        util.sortBy(db.col('performances'), 'score', 'desc').slice(0, 26).forEach(function (p) {
            var k = util.round(60 + rand() * 40, 1), a = util.round(60 + rand() * 40, 1), att = util.round(65 + rand() * 35, 1);
            var rec = TMS.people.evaluate({
                employeeId: p.employeeId, period: p.period, kpiScore: k, abilityScore: a, attitudeScore: att,
                evaluator: util.pick(branchStaff, rand).name, promotion: rand() < 0.12 ? '晋升候选' : (p.score < 68 ? '绩效改进计划' : ''),
                comment: util.pick(['履约质量稳定，客户零投诉', '旺季抗压表现突出', '错分率偏高需辅导', '主动优化装载率，成本改善明显'], rand),
                status: 'pending'
            });
            TMS.people.finalizeEvaluation(rec.id, { kpiScore: k, abilityScore: a, attitudeScore: att });
        });

        /* ---------- 审计与系统留痕 ---------- */

        var sampleOrders = db.col('orders').slice(-120);
        sampleOrders.forEach(function (o, i) {
            util.setNow(util.addHours(util.toDate(o.updatedAt), i % 5));
            TMS.audit.log(util.pick(['order.create', 'order.change', 'finance.settle', 'rate.update', 'user.login', 'network.update'], rand),
                'orders', o.id, util.pick(['批量导入客户订单', '调整区域运价卡', '手工核销应收', '维护网点服务范围', '导出月度对账单'], rand),
                util.pick(branchStaff, rand).name);
        });

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
