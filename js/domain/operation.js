/* 作业领域：分拣任务、装卸任务、车次调度与在途、状态机副作用挂接 */
(function (global) {
    'use strict';

    var TMS = global.TMS = global.TMS || {};
    var util = TMS.util, db = TMS.db;

    /* ---------- 状态机副作用 ---------- */

    /* 车次与订单的关系由订单行的 tripId 维护（单一事实源），
       车次不再冗余存 orderIds 数组——40 个单号要 900B，且补载/改单极易写歪 */
    function ordersOfTrip(tripId) {
        if (!tripId) return [];
        return db.col('orders').filter(function (o) { return o.tripId === tripId; });
    }

    /* ---------- 车次派生读取 ----------
       车次行只存调度事实（挂哪个班次、用哪台车、装了多少货、花了多少钱），
       车牌/司机名/承运商名/载重/单号标签都由外键反查，一车 40 单的冗余文本比订单还贵 */

    function vehicleOf(tr) {
        return (tr && tr.vehicleId) ? db.get('vehicles', tr.vehicleId) : null;
    }

    function capacityOf(tr) {
        if (!tr) return 0;
        if (tr.capacityKg) return Number(tr.capacityKg) || 0;
        var v = vehicleOf(tr);
        return v ? Number(v.loadKg) || 0 : 0;
    }

    function plateOf(tr) {
        if (!tr) return '';
        if (tr.plate) return tr.plate;
        var v = vehicleOf(tr);
        return v ? v.plate : '';
    }

    function vehicleTypeOf(tr) {
        var v = vehicleOf(tr);
        return tr.vt || (v ? v.typeCode : '');
    }

    function driverOf(tr) {
        if (!tr) return '';
        if (tr.driver) return tr.driver;
        var e = tr.driverId ? db.get('employees', tr.driverId) : null;
        return e ? e.name : '';
    }

    /* 在岗校验：档案里的司机可能已离职/休假，取到人不取到状态 */
    function onDuty(empId) {
        if (!empId) return null;
        var e = db.get('employees', empId);
        return (e && e.role === 'transporter' && e.status === 'active') ? e : null;
    }

    function carrierOf(tr) {
        if (!tr) return '';
        if (tr.carrier) return tr.carrier;
        var c = tr.carrierId ? db.get('carriers', tr.carrierId) : null;
        return c ? c.name : '';
    }

    /* 车次标签：城市对 + 日期，页面与流水备注共用一个口径 */
    function labelOf(tr) {
        if (!tr) return '';
        if (tr.code) return tr.code;
        var from = (TMS.master.hubByNameOrId(tr.fromHub) || {}).city || tr.fromHub;
        var to = tr.toCity || (TMS.master.hubByNameOrId(tr.toHub) || {}).city || tr.toHub;
        return from + '→' + to + ' ' + (tr.date || '');
    }

    /* 车次执行方：自有整车显示司机+车牌，外协舱位只有承运商 */
    function crewOf(tr) {
        var ltl = tr && tr.dispatchType === 'ltl';
        return { driverName: ltl ? carrierOf(tr) : driverOf(tr), plateNo: ltl ? '' : plateOf(tr) };
    }

    function costPerKgOf(tr) {
        if (!tr) return 0;
        if (tr.costPerKg) return Number(tr.costPerKg) || 0;
        var w = Number(tr.weight) || 0;
        return w ? util.round(costTotal(tr) / w, 2) : 0;
    }

    function departTimeOf(tr) {
        return (tr && (tr.departedAt || tr.actualDepartAt)) || '';
    }

    function completeTimeOf(tr) {
        if (!tr) return '';
        if (['arrived', 'completed'].indexOf(tr.status) < 0) return '';
        return tr.completedAt || tr.gateInAt || tr.actualArriveAt || '';
    }

    /* 里程只有一个来源：成本行的 km（下单时按班次/城市对算好），distanceKm 是老库行的存量字段 */
    function distanceOf(tr) {
        if (!tr) return 0;
        return Number(tr.distanceKm) || Number((tr.cost || {}).km) || 0;
    }

    /* 干线时长：班次计划优先，其次按公里均速反推——车次行不再逐条存 transitHours */
    function transitHoursOf(tr) {
        if (!tr) return 0;
        if (tr.transitHours) return Number(tr.transitHours) || 0;
        var plan = tr.tripId ? db.get('trips', tr.tripId) : null;
        if (plan && plan.transitHours) return Number(plan.transitHours) || 0;
        return Math.max(2, Math.round(distanceOf(tr) / 52));
    }

    /* 准点判定不入库：实际到达与「班次时刻 + 干线时长 + 4 小时容差」比对即可，
       一车次的 onTime 布尔值写进库里既会过期又要维护 */
    function isOnTime(tr) {
        if (!tr) return true;
        if (tr.onTime !== undefined) return tr.onTime !== false;
        if (!tr.actualArriveAt || tr.status === 'pending' || tr.status === 'departed') return true;
        var plan = util.toDate((tr.date || '') + 'T' + (tr.departAt || '20:00') + ':00');
        return util.toDate(tr.actualArriveAt) <= util.addHours(plan, transitHoursOf(tr) + 4);
    }

    function volumeOfTrip(tr) {
        if (!tr) return 0;
        if (tr.volumeM3) return Number(tr.volumeM3) || 0;
        return util.round(util.sum(ordersOfTrip(tr.id), TMS.order.volumeOf) / 1000000, 3);
    }

    /* 列表/详情视图：页面统一读这里，补齐名称类派生字段（存量行自带的字段优先） */
    function tripView(tr) {
        if (!tr) return null;
        var crew = crewOf(tr);
        var out = {
            code: labelOf(tr), capacityKg: capacityOf(tr), plate: crew.plateNo,
            driver: crew.driverName, carrier: carrierOf(tr) || '', vt: vehicleTypeOf(tr),
            costPerKg: costPerKgOf(tr), departedAt: departTimeOf(tr), completedAt: completeTimeOf(tr),
            distanceKm: distanceOf(tr), transitHours: transitHoursOf(tr), onTime: isOnTime(tr),
            volumeM3: volumeOfTrip(tr)
        };
        Object.keys(tr).forEach(function (k) { out[k] = tr[k]; });
        out.completedAt = completeTimeOf(tr);
        out.onTime = isOnTime(tr);
        return out;
    }

    function onStage(order, from, status, opt) {
        var o = order;
        if (status === 'inbound') {
            createSortingTask(o);
        } else if (status === 'sorted') {
            var task = db.findOne('sortingTasks', function (t) { return t.orderId === o.id && t.status !== 'done'; });
            if (task) finishSortingTask(task.id, {
                operator: (opt || {}).operator || o.courier || '分拣员',
                chute: (opt || {}).chute, at: o.updatedAt
            });
        } else if (status === 'transit') {
            attachToTripOrAuto(o);
        } else if (status === 'arrived') {
            var tr = db.get('transports', o.tripId);
            if (tr) {
                // 到达/派送进度不在车次行上记计数器：订单侧状态即事实，countWaiting 反查即可
                if (countWaiting(tr) === 0) updateTripStatus(tr, 'arrived');
            }
        } else if (status === 'signed') {
            var tr3 = db.get('transports', o.tripId);
            if (tr3 && tr3.status !== 'cancelled') maybeCompleteTrip(tr3);
        }
    }

    function countWaiting(tr) {
        return ordersOfTrip(tr.id).filter(function (o) { return o.status === 'transit'; }).length;
    }

    function maybeCompleteTrip(tr) {
        var rows = ordersOfTrip(tr.id);
        if (!rows.length) return;
        var allDone = rows.every(function (o) { return ['signed', 'cancelled', 'returned', 'problem'].indexOf(o.status) > -1; });
        if (allDone) updateTripStatus(tr, 'completed');
    }

    /* ---------- 分拣任务 ---------- */

    /* 任务行只存派工与执行结果；线别/格口/件重/标准工时/优先级都是「订单 + 哈希」的函数，
       读取时由 sortingTaskView 重建——500 条任务行冗余的 10 个派生字段就是 60KB 容量 */
    function chuteOf(order) {
        return 'C' + util.pad(1 + util.hash(order.destination || '') % 40, 2);
    }

    function stdMinutesOf(pieces) {
        return Math.max(4, Math.round((Number(pieces) || 1) * 2.5));
    }

    function sortingTaskView(t) {
        if (!t) return null;
        var o = db.get('orders', t.orderId) || {};
        var out = {
            line: 'L' + (1 + (util.hash(t.orderId) % 8)),
            chute: chuteOf(o),
            hubId: o.hubFrom || '',
            pieces: Number(o.pieces) || 1,
            weight: Number(o.chargeableWeight || o.weight) || 0,
            stdMinutes: stdMinutesOf(o.pieces),
            priority: TMS.order.priorityOf(o),
            result: t.status === 'done' ? '正常分拣' : '',
            waybillNo: o.waybillNo || '', origin: o.origin || '', destination: o.destination || '',
            customer: TMS.order.customerName(o),
            startedAt: t.finishedAt && t.actualMinutes
                ? util.iso(util.addHours(util.toDate(t.finishedAt), -t.actualMinutes / 60)) : ''
        };
        Object.keys(t).forEach(function (k) { if (t[k] !== '' && t[k] != null) out[k] = t[k]; });
        return out;
    }

    function createSortingTask(order) {
        var exists = db.findOne('sortingTasks', function (t) { return t.orderId === order.id && t.status !== 'done'; });
        if (exists) return exists;
        // 运单号/客户/目的城市由 orderId 反查订单，作业任务只存派工与执行要素
        return db.create('sortingTasks', {
            orderId: order.id, status: 'pending', operator: '', finishedAt: '', actualMinutes: 0
        });
    }

    function startSorting(id, data) {
        var t = db.get('sortingTasks', id);
        if (!t) return null;
        var at = (data && data.at) || util.now();
        util.setNow(at);
        var res = db.update('sortingTasks', id, { status: 'processing', operator: (data && data.operator) || '分拣员' });
        db.commit('sortingTasks', id, 'sorting:start');
        util.setNow(null);
        return res;
    }

    function finishSortingTask(id, data) {
        var t = db.get('sortingTasks', id);
        if (!t) return null;
        var d = data || {};
        var finished = d.at ? util.toDate(d.at) : util.now();
        var view = sortingTaskView(t);
        /* 实际用工分钟：页面开始分拣时用真实秒差，历史补录按标准工时±30% 浮动，
            startedAt 不再单独存库——它就是 finishedAt 减去 actualMinutes */
        var actual = d.actualMinutes || (t.startedAt
            ? Math.max(1, Math.round(util.hoursBetween(util.toDate(t.startedAt), finished) * 60))
            : Math.max(1, Math.round(view.stdMinutes * (0.7 + (util.hash(t.orderId + finished.toISOString().slice(0, 10)) % 60) / 100))));
        return db.update('sortingTasks', id, {
            status: 'done', finishedAt: util.iso(finished), startedAt: null,
            actualMinutes: actual, operator: d.operator || t.operator || '分拣员',
            // 格口/结果偏离默认才落库
            chute: d.chute && d.chute !== view.chute ? d.chute : '',
            result: d.result && d.result !== '正常分拣' ? d.result : ''
        });
    }

    /* 分拣作业台：按格口汇总待分拣量，贴近真实 PDA 视角 */
    function sortingBoard(hubId) {
        var rows = db.col('sortingTasks')
            .filter(function (t) { return t.status !== 'done' && (!hubId || sortingTaskView(t).hubId === hubId); })
            .map(sortingTaskView);
        var byChute = util.groupBy(rows, 'chute');
        return Object.keys(byChute).map(function (c) {
            var list = byChute[c];
            return {
                chute: c, hubId: list[0].hubId, tasks: list.length,
                pieces: util.sum(list, 'pieces'), weight: util.round(util.sum(list, 'weight'), 2),
                urgent: list.filter(function (t) { return t.priority === '高'; }).length,
                destinations: util.unique(list.map(function (t) { return t.destination; })).filter(Boolean).slice(0, 6)
            };
        }).sort(function (a, b) { return b.pieces - a.pieces; });
    }

    /* 批量分拣：一次把某格口全部件推过 sorted 状态 */
    function sortChute(chute, data) {
        var d = data || {};
        var list = db.col('sortingTasks').filter(function (t) { return sortingTaskView(t).chute === chute && t.status !== 'done'; });
        var done = 0, failed = [];
        list.forEach(function (t) {
            var res = TMS.order.sort(t.orderId, { operator: d.operator || '分拣员', chute: chute, device: d.device, note: d.note });
            if (res.ok) done++; else failed.push(t.orderId + '：' + res.message);
        });
        return { ok: failed.length === 0, done: done, total: list.length, failed: failed };
    }

    /* ---------- 装卸任务（按车次） ---------- */

    /* 与分拣任务同理：箱号/装卸量/标准工时都是车次事实的函数，读取时重建 */
    function loadingTaskView(t) {
        if (!t) return null;
        var tr = db.get('transports', t.transportId) || {};
        var out = {
            containerNo: 'CTR' + util.pad(1 + util.hash(t.transportId) % 900, 3),
            hubId: tr.fromHub || '', tripCode: tr.id ? labelOf(tr) : '',
            orders: Number(tr.orders) || 0, pieces: Number(tr.pieces) || 0,
            weight: Number(tr.weight) || 0, volumeM3: volumeOfTrip(tr),
            stdMinutes: Math.max(20, Math.round((Number(tr.weight) || 0) / 800 + (Number(tr.pieces) || 1) * 2)),
            startedAt: t.finishedAt && t.actualMinutes
                ? util.iso(util.addHours(util.toDate(t.finishedAt), -t.actualMinutes / 60)) : ''
        };
        Object.keys(t).forEach(function (k) { if (t[k] !== '' && t[k] != null) out[k] = t[k]; });
        return out;
    }

    function createLoadingTask(data) {
        var d = data || {};
        var tr = db.get('transports', d.transportId);
        if (!tr) return null;
        return db.create('loadingTasks', {
            transportId: tr.id, status: 'pending', operator: '',
            finishedAt: '', actualMinutes: 0, damageCount: '', photo: ''
        });
    }

    function finishLoading(id, data) {
        var t = db.get('loadingTasks', id);
        if (!t) return null;
        var d = data || {};
        var at = util.now();
        var std = loadingTaskView(t).stdMinutes;
        var actual = d.actualMinutes || Math.max(10, std + Math.round((Math.random() - 0.4) * 20));
        return db.update('loadingTasks', id, {
            status: 'done', operator: d.operator || '装卸组长', startedAt: null,
            finishedAt: util.iso(at), actualMinutes: actual,
            damageCount: d.damageCount ? d.damageCount : null, photo: d.photo ? true : null
        });
    }

    /* ---------- 车次 ---------- */

    function updateTripStatus(tr, status) {
        tr.status = status;
        if (status === 'departed') tr.actualDepartAt = tr.actualDepartAt || util.iso(util.now());
        // 到达即完成时间：车次回场后不再另盖一个 completedAt，同一件事库里只留一个戳
        if (status === 'arrived') tr.actualArriveAt = tr.actualArriveAt || util.iso(util.now());
        if (status === 'completed') {
            var v = db.get('vehicles', tr.vehicleId);
            if (v && v.status === 'busy') { v.status = 'available'; db.touch('vehicles'); }
        }
        db.touch('transports');
        return tr;
    }

    /* 车次成本行压缩存储：{ t 合计, km 里程, d 天数, r 单公斤采购价(外协) }；
       油/路/桥/司机/折旧等构成由车型与里程即时反算（costView），
       一台车次的成本明细不必在库里写六遍 */
    function costTotal(tr) { return Number((tr && tr.cost || {}).t) || 0; }

    function costView(tr) {
        var cost = (tr && tr.cost) || {};
        if (!cost.t) return { total: 0, fuel: 0, toll: 0, driver: 0, fixed: 0, km: cost.km || 0, days: cost.d || 1, ratePerKg: cost.r || 0 };
        if (tr.dispatchType === 'ltl') {
            var kg = Number(tr.weight) || 0;
            return {
                total: cost.t, km: cost.km || 0, days: cost.d || 1, kg: kg,
                ratePerKg: cost.r || (kg ? util.round(cost.t / kg, 3) : 0),
                fuel: 0, toll: 0, driver: 0, fixed: 0, basis: '外协舱位'
            };
        }
        var calc = TMS.pricing.tripCost({ vehicleTypeCode: vehicleTypeOf(tr), mode: tr.mode, distanceKm: cost.km }, cost.km);
        return {
            total: cost.t, km: cost.km || 0, days: cost.d || 1,
            fuel: calc.fuel, toll: calc.toll, driver: calc.driver, fixed: calc.fixed,
            costPerKm: calc.costPerKm, vehicleType: calc.vehicleType, basis: '自有整车'
        };
    }

    /* 运力择优建车次：把「自有整车」和「外协零担买舱位」两条路径的成本都算出来取低者。
       零担按公斤报价、自有按里程+天数计价，货量小、里程长时自有车次会把单公斤干线成本顶到十几元，
       这类线路真实网络里就是买舱位；自有车辆留给满载干线、冷链专车和区域内支线串线。
       d.feeder = 区域内支线（起讫同一分拨，按目的城市拆线），零担最低一票摊在三五票货上不经济，固定自有执行。
       人工指定车辆（d.vehicleId）视为调度决策，不再被算法改派。 */
    function createTrip(data) {
        var d = data || {};
        var trip = d.tripId ? db.get('trips', d.tripId) : null;
        var fromHub = trip ? trip.fromHub : d.fromHub;
        var toHub = trip ? trip.toHub : d.toHub;
        // 已挂车的单不再被抢载：一单只能属于一个车次，否则车次货量会重复计入运力统计
        var orders = (d.orderIds || []).map(function (id) { return db.get('orders', id); })
            .filter(function (o) { return o && o.status === 'sorted' && !o.tripId; });
        if (!orders.length) return { ok: false, message: '没有可装车的已分拣订单' };
        var weight = util.round(util.sum(orders, 'chargeableWeight'), 2);
        var volumeM3 = util.round(util.sum(orders, TMS.order.volumeOf) / 1000000, 3);
        var pieces = util.sum(orders, 'pieces');
        // 运输方式：班次给定的方式优先，但混进冷链件必须按冷链专车执行，否则温控承诺落空
        var mode = trip ? trip.mode : '陆运';
        if (orders.some(function (o) { return o.service === '冷链'; })) mode = '冷链';
        var distance = Number(d.distanceKm) || (trip && trip.distanceKm) || util.distanceKm(
            TMS.master.cityByName((TMS.master.hubByNameOrId(fromHub) || {}).city),
            TMS.master.cityByName((TMS.master.hubByNameOrId(toHub) || {}).city)) || 400;

        var want = TMS.network.pickVehicle(weight, volumeM3 * 1000000, pieces);
        // 就近就小原则：优先目标车型、本枢纽发车、载重刚好够用，避免大车拉小货
        var pool = db.col('vehicles').filter(function (v) {
            return v.status === 'available' && v.loadKg >= weight && (mode !== '冷链' || v.coldBox);
        }).map(function (v) {
            return { v: v, score: v.loadKg + (v.typeCode === want.code ? 0 : 6000) + (v.hubId === fromHub ? 0 : 2500) };
        }).sort(function (a, b) { return a.score - b.score; });
        var vehicle = d.vehicleId ? db.get('vehicles', d.vehicleId) : (pool.length ? pool[0].v : null);
        if (vehicle && vehicle.loadKg < weight) vehicle = null;
        var carrier = pickCarrier(mode);
        var selfCost = vehicle ? TMS.pricing.tripCost({
            vehicleTypeCode: vehicle.typeCode, mode: mode, distanceKm: distance
        }, distance) : null;
        var ltl = carrier ? TMS.pricing.ltlCost(weight, distance, carrier) : null;
        // 自有整车按整车计价（公里成本+司机+折旧），装不满就是纯亏：
        // 单公斤干线成本会被三五公斤的小票顶到几十元，真实调度一律改买舱位
        var viable = !!vehicle && (!vehicle.loadKg || weight / vehicle.loadKg >= TMS.cfg.cost.selfLoadMin);
        // 冷链的约束是「执行方必须有冷链运力」，不是「必须自己拉」：
        // 车位池已按 coldBox 过滤，外协侧 pickCarrier 只取冷链协议方；
        // 为三五百公斤冻品派一台冷藏车跑上千公里，成本是买舱位的四倍，真实调度不会这么干
        var selfWins = !ltl || (selfCost && selfCost.total <= ltl.total && viable) || (!!d.feeder && viable);
        var outsourced = !!d.outsourced || (!!ltl && !!vehicle && !d.vehicleId && !selfWins) || !vehicle;
        // 支线等不到自有车位时退回外协；两种方式都没有则宁可压班，也不虚构执行方
        if (outsourced && !carrier) return { ok: false, message: '无空闲' + mode + '运力，且没有匹配的协议承运商' };

        var id = TMS.ids.next('transports');
        var cost = outsourced ? ltl : selfCost;
        var driver = null;
        if (!outsourced) {
            /* 一车一司机：车队档案里的固定驾驶员是排班的结果，优先沿用；
               人工派单（d.driverId）视为调度决策，覆盖默认搭配。
               车次不落司机不是小事——调度页无人可派、趟费应付挂空 targetId、司机绩效的干线里程永远是 0 */
            driver = onDuty(d.driverId) || onDuty(vehicle.driverId);
            if (!driver) {
                driver = db.findOne('employees', function (e) {
                    return e.role === 'transporter' && e.status === 'active' && e.hubId === vehicle.hubId;
                }) || db.findOne('employees', function (e) {
                    return e.role === 'transporter' && e.status === 'active';
                });
            }
        }
        var transport = db.create('transports', {
            id: id,
            date: util.dateKey(d.at || util.now()),
            tripId: trip ? trip.id : '',
            mode: mode, dispatchType: outsourced ? 'ltl' : 'self',
            fromHub: fromHub, toHub: toHub,
            // 区域内支线才有目的城市（起讫同一分拨，按城市拆线）；跨区干线留空
            toCity: d.feeder ? (d.toCity || orders[0].destination) : '',
            // 车辆/承运商/司机只存 ID，车牌、载重、姓名读取时反查档案
            vehicleId: outsourced ? '' : vehicle.id,
            carrierId: outsourced ? carrier.id : '',
            driverId: driver ? driver.id : '',
            // 装载量（单数/件数/重量/体积/装载率）不落库，一律由订单侧 recalcTrip 反算；
            // 里程与干线时长同理：cost.km 一个字段就够，其余按公里速度反推
            departAt: d.departAt || (trip ? trip.departAt : util.pad(new Date().getHours()) + ':00'),
            status: 'pending',
            cost: { t: util.money(cost.total), km: Math.round(distance), d: cost.days || 1, r: outsourced ? cost.ratePerKg : '' },
            exceptionCount: '', position: '', lastReportAt: '', remark: d.remark || ''
        }, { id: id });
        if (!outsourced) { vehicle.status = 'busy'; db.touch('vehicles'); }
        orders.forEach(function (o) {
            // 外协舱位没有我司司机/车牌，订单端由 tripId 反查车次即可知道执行方
            o.tripId = transport.id;
            db.touch('orders');
        });
        recalcTrip(transport);
        createLoadingTask({ transportId: id });
        // 自有车次的司机趟费与货量无关，建班即可挂账；外协采购要等发车时实载重量封口
        if (!outsourced) TMS.finance.createTripPayable(transport);
        db.commit('transports', id, 'trip:create');
        return { ok: true, transport: transport, vehicle: outsourced ? null : vehicle, driver: driver, outsourced: outsourced };
    }

    /* 外协承运商：按运输方式匹配在册协议承运商，无可用承运商则只能自有发车 */
    function pickCarrier(mode) {
        var type = mode === '空运' ? '空运' : (mode === '冷链' ? '冷链' : '陆运');
        return db.findOne('carriers', function (c) { return c.status === 'active' && c.type === type; });
    }

    /* 自动配载：把某枢纽积压的已分拣订单按目的枢纽凑整车 */
    function dispatch(hubId, options) {
        var opts = options || {};
        var waiting = db.col('orders').filter(function (o) {
            return o.status === 'sorted' && (!hubId || o.hubFrom === hubId);
        });
        if (!waiting.length) return { ok: false, message: '当前无待装车订单', created: [] };
        var byDest = util.groupBy(waiting, 'hubTo');
        var created = [];
        Object.keys(byDest).forEach(function (destHub) {
            var list = util.sortBy(byDest[destHub], 'createdAt', 'asc');
            if (list.length < (opts.minOrders || 2)) return;
            var trip = TMS.network.tripFor(hubId, destHub, opts.mode);
            var picked = list.slice(0, opts.limit || 40);
            var res = createTrip({
                tripId: trip ? trip.id : '', fromHub: hubId, toHub: destHub,
                orderIds: picked.map(function (o) { return o.id; }),
                vehicleId: opts.vehicleId, driverId: opts.driverId
            });
            if (res.ok) created.push(res.transport);
        });
        return { ok: created.length > 0, created: created, message: created.length ? ('生成 ' + created.length + ' 个车次') : '装载量不足或未匹配班次' };
    }

    /* 车次装载/成本重算：订单与车次的关系只认 orders.tripId，装载率与单公斤成本随之派生 */
    function recalcTrip(trip) {
        var tr = typeof trip === 'string' ? db.get('transports', trip) : trip;
        if (!tr) return null;
        var rows = ordersOfTrip(tr.id);
        tr.orders = rows.length;
        tr.pieces = util.sum(rows, 'pieces');
        tr.weight = util.round(util.sum(rows, 'chargeableWeight'), 2);
        tr.loadRate = capacityOf(tr) ? util.round(tr.weight / capacityOf(tr) * 100, 1) : 0;
        // 外协零担按实付重量结算：发车前货越攒越多，采购价必须跟着走，
        // 否则重量翻几倍而成本停在建班那一刻，单票干线会被摊成几分钱一公斤的假成本
        if (tr.dispatchType === 'ltl' && tr.carrierId && ['pending', 'loading'].indexOf(tr.status) > -1) {
            var km = Number((tr.cost || {}).km) || 0;
            var buy = TMS.pricing.ltlCost(tr.weight, km, db.get('carriers', tr.carrierId));
            tr.cost = { t: util.money(buy.total), km: km, d: buy.days || 1, r: buy.ratePerKg };
        }
        db.touch('transports');
        // 车次成本一变，车上每票的单票成本同步重算：干线分摊只认实际车次，不认下单时的估算
        rows.forEach(function (o) { TMS.pricing.refreshCost(o); });
        return tr;
    }

    /* 订单到点后自动挂班：若已有同向在途车次则拼载，否则暂不推进干线 */
    function attachToTripOrAuto(order) {
        var tr = order.tripId ? db.get('transports', order.tripId) : null;
        if (!tr) return null;
        recalcTrip(tr);
        if (tr.status === 'pending' || tr.status === 'loading') startTransport(tr.id, { operator: driverOf(tr) || '司机' });
        return tr;
    }

    function startTransport(id, data) {
        var tr = db.get('transports', id);
        if (!tr) return { ok: false, message: '车次不存在' };
        if (['departed', 'arrived', 'completed'].indexOf(tr.status) > -1) return { ok: false, message: '车次已发车' };
        var d = data || {};
        var at = d.at ? util.toDate(d.at) : util.now();
        tr.actualDepartAt = util.iso(at);
        // 发车即封舱：外协按实载重量结算的采购价在这一步定稿，之后的装载变动不再改账
        recalcTrip(tr);
        updateTripStatus(tr, 'departed');
        ordersOfTrip(id).forEach(function (o) {
            if (o.status === 'cancelled' || o.status === 'signed') return;
            if (TMS.order.statusIndex(o.status) < TMS.order.statusIndex('transit')) {
                TMS.order.moveTo(o.id, 'transit', {
                    operator: d.operator || driverOf(tr) || '司机', allowSkip: true, at: at,
                    device: d.device || '车载终端'
                });
            }
        });
        var lt = db.findOne('loadingTasks', function (t) { return t.transportId === id && t.status !== 'done'; });
        if (lt) finishLoading(lt.id, { operator: d.operator || '装卸组' });
        // 外协采购账单在重量封口后才成立：建班时挂账会按半车货开单，与实付成本对不上
        if (tr.dispatchType === 'ltl' && !db.findOne('payables', function (p) { return p.refId === tr.id; })) {
            TMS.finance.createTripPayable(tr);
        }
        TMS.finance.recordTripExpense(tr);
        db.commit('transports', id, 'trip:depart');
        TMS.bus.emit('trip:departed', { transport: tr });
        return { ok: true, transport: tr };
    }

    function arriveTransport(id, data) {
        var tr = db.get('transports', id);
        if (!tr) return { ok: false, message: '车次不存在' };
        var d = data || {};
        var at = d.at ? util.toDate(d.at) : util.now();
        tr.actualArriveAt = util.iso(at);
        updateTripStatus(tr, 'arrived');
        ordersOfTrip(id).forEach(function (o) {
            if (['cancelled', 'signed', 'returned', 'problem'].indexOf(o.status) > -1) return;
            if (TMS.order.statusIndex(o.status) < TMS.order.statusIndex('arrived')) {
                TMS.order.moveTo(o.id, 'arrived', {
                    operator: d.operator || driverOf(tr) || '司机', allowSkip: true, at: at,
                    device: d.device || '固定式扫描门'
                });
            }
        });
        db.commit('transports', id, 'trip:arrive');
        return { ok: true, transport: tr };
    }

    function completeTransport(id, data) {
        var tr = db.get('transports', id);
        if (!tr) return null;
        if (tr.status === 'arrived' || tr.status === 'departed') arriveTransport(id, data);
        updateTripStatus(tr, 'completed');
        db.commit('transports', id, 'trip:complete');
        return tr;
    }

    /* 在途上报：位置、异常、油耗；里程累计写回车辆档案 */
    function reportPosition(id, data) {
        var tr = db.get('transports', id);
        if (!tr) return { ok: false, message: '车次不存在' };
        var d = data || {};
        tr.position = d.location || tr.position;
        tr.lastReportAt = util.iso(util.now());
        if (Number(d.km) > 0) {
            tr.reportedKm = util.round((Number(tr.reportedKm) || 0) + Number(d.km), 1);
            var v = db.get('vehicles', tr.vehicleId);
            if (v) { v.odometer = Math.round((v.odometer || 0) + Number(d.km)); db.touch('vehicles'); }
        }
        if (Number(d.fuel) > 0) tr.fuelUsed = util.round((Number(tr.fuelUsed) || 0) + Number(d.fuel), 1);
        if (d.restKm) tr.restStops = (tr.restStops || 0) + 1;
        updateTripStatus(tr, tr.status === 'pending' ? 'departed' : tr.status);
        db.commit('transports', id, 'trip:report');
        return { ok: true, transport: tr };
    }

    function reportTripException(id, data) {
        var tr = db.get('transports', id);
        if (!tr) return { ok: false, message: '车次不存在' };
        var d = data || {};
        tr.exceptionCount = (tr.exceptionCount || 0) + 1;
        var first = ordersOfTrip(id)[0];
        var res = TMS.service.createException({
            orderId: d.orderId || (first ? first.id : ''), type: d.type || '运输异常',
            description: (d.description || '') + '（车次 ' + labelOf(tr) + '）', level: d.level || '三级', actor: d.operator || driverOf(tr)
        });
        if (d.orderId) TMS.order.markProblem(d.orderId, { type: d.type || '运输异常', description: d.description, operator: d.operator || driverOf(tr) });
        db.commit('transports', id, 'trip:exception');
        return { ok: true, exception: res };
    }

    function openIntercept(order, data) {
        var d = data || {};
        // 拦截落一条装卸留痕：没有车次可反查，装卸量只能显式存
        return db.create('loadingTasks', {
            transportId: '', interceptOrderId: order.id, hubId: order.hubTo || order.hubFrom,
            containerNo: 'ITC' + util.pad(util.hash(order.id) % 900, 3),
            pieces: Number(order.pieces) || 1, weight: order.chargeableWeight || order.weight || 0,
            status: 'done', operator: d.operator || '运营管理员',
            finishedAt: util.iso(util.now()), actualMinutes: 12
        });
    }

    /* 单证关联任务：装卸任务挂在车次上，经订单的 tripId 反查，不再遍历车次的单号数组 */
    function tasksOfOrder(orderId) {
        var o = db.get('orders', orderId);
        var transport = o && o.tripId ? db.get('transports', o.tripId) : null;
        return {
            sorting: db.col('sortingTasks').filter(function (t) { return t.orderId === orderId; }).map(sortingTaskView),
            loading: db.col('loadingTasks').filter(function (t) {
                return t.interceptOrderId === orderId || (transport && t.transportId === transport.id);
            }).map(loadingTaskView),
            transport: transport ? [transport] : []
        };
    }

    function tripStats(days) {
        var cutoff = util.addDays(util.now(), -(days || 7)).getTime();
        var rows = db.col('transports').filter(function (t) { return util.toDate(t.date || t.createdAt).getTime() >= cutoff; });
        var cost = util.sum(rows, costTotal);
        var weight = util.sum(rows, 'weight');
        var km = util.sum(rows, distanceOf);
        var own = rows.filter(function (t) { return t.dispatchType !== 'ltl'; });
        return {
            total: rows.length,
            departed: rows.filter(function (t) { return t.status === 'departed'; }).length,
            arrived: rows.filter(function (t) { return ['arrived', 'completed'].indexOf(t.status) > -1; }).length,
            self: own.length, ltl: rows.length - own.length,
            orders: util.sum(rows, 'orders'), weight: util.round(weight, 2), km: Math.round(km),
            cost: util.money(cost), costPerKg: weight ? util.round(cost / weight, 2) : 0,
            avgLoadRate: own.length ? util.round(util.sum(own, 'loadRate') / own.length, 1) : 0,
            onTimeRate: rows.length ? util.round(rows.filter(isOnTime).length / rows.length * 100, 1) : 100
        };
    }

    TMS.operation = {
        onStage: onStage,
        createSortingTask: createSortingTask, startSorting: startSorting, finishSortingTask: finishSortingTask,
        sortingBoard: sortingBoard, sortChute: sortChute,
        createLoadingTask: createLoadingTask, finishLoading: finishLoading,
        sortingTaskView: sortingTaskView, loadingTaskView: loadingTaskView,
        createTrip: createTrip, dispatch: dispatch, startTransport: startTransport,
        arriveTransport: arriveTransport, completeTransport: completeTransport,
        reportPosition: reportPosition, reportTripException: reportTripException,
        openIntercept: openIntercept, tasksOfOrder: tasksOfOrder, tripStats: tripStats,
        ordersOfTrip: ordersOfTrip, recalcTrip: recalcTrip, costTotal: costTotal, costView: costView,
        tripView: tripView, labelOf: labelOf, crewOf: crewOf, driverOf: driverOf, carrierOf: carrierOf,
        plateOf: plateOf, capacityOf: capacityOf, vehicleOf: vehicleOf, vehicleTypeOf: vehicleTypeOf,
        costPerKgOf: costPerKgOf, departTimeOf: departTimeOf, completeTimeOf: completeTimeOf,
        distanceOf: distanceOf, transitHoursOf: transitHoursOf, isOnTime: isOnTime, volumeOfTrip: volumeOfTrip
    };
})(window);
