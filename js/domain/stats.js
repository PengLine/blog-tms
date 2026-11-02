/* 统计领域：经营看板口径统一在此，页面不重复实现聚合逻辑 */
(function (global) {
    'use strict';

    var TMS = global.TMS = global.TMS || {};
    var util = TMS.util, db = TMS.db, cfg = TMS.cfg;

    function ordersWithin(days) {
        var cutoff = util.addDays(util.now(), -(days || 7) + 1).getTime();
        return db.col('orders').filter(function (o) { return util.toDate(o.createdAt).getTime() >= cutoff; });
    }

    function overview(days) {
        var n = days || 7;
        var list = ordersWithin(n);
        var all = db.col('orders');
        var signed = list.filter(function (o) { return o.status === 'signed'; });
        var total = all.length;
        var signedAll = all.filter(function (o) { return o.status === 'signed'; });
        var late = signed.filter(function (o) { return TMS.order.isSignedLate(o); });
        var revenue = util.money(util.sum(signed, 'freight'));
        var cost = util.money(util.sum(signed, function (o) { return o.cost ? o.cost.tot : 0; }));
        var inTransit = all.filter(function (o) { return ['transit', 'arrived', 'delivering', 'sorted', 'inbound'].indexOf(o.status) > -1; });
        var ex = db.col('exceptions').filter(function (e) { return util.toDate(e.reportedAt).getTime() >= util.addDays(util.now(), -n + 1).getTime(); });
        var fs = TMS.finance.financeSummary();
        return {
            days: n,
            orders: list.length, totalOrders: total,
            newOrders: list.length, revenue: revenue, cost: cost,
            profit: util.money(revenue - cost),
            margin: revenue ? util.round((revenue - cost) / revenue * 100, 1) : 0,
            signed: signed.length,
            signRate: list.length ? util.round(signed.length / list.length * 100, 1) : 0,
            onTimeRate: signed.length ? util.round((signed.length - late.length) / signed.length * 100, 1) : 100,
            exceptionRate: total ? util.round(db.col('exceptions').length / total * 100, 2) : 0,
            openExceptions: ex.filter(function (e) { return e.status !== 'resolved'; }).length,
            backlog: inTransit.length,
            overdue: all.filter(function (o) { return TMS.order.isLate(o); }).length,
            avgHours: signed.length ? util.round(util.sum(signed, function (o) { return util.hoursBetween(o.createdAt, o.signedAt); }) / signed.length, 1) : 0,
            weight: util.round(util.sum(list, 'chargeableWeight'), 1),
            pieces: util.sum(list, 'pieces'),
            scanCount: db.col('scans').filter(function (s) { return util.toDate(s.opTime).getTime() >= util.addDays(util.now(), -n + 1).getTime(); }).length,
            scanRate: total ? util.round(db.col('scans').length / total, 1) : 0,
            trips: TMS.operation.tripStats(n),
            cod: TMS.finance.codSummary(),
            receivable: TMS.finance.receivableSummary(),
            payable: TMS.finance.payableBreakdown(),
            finance: fs,
            gross: TMS.finance.grossAnalysis()
        };
    }

    function orderTrend(days) {
        var n = days || 14;
        var out = [];
        for (var i = n - 1; i >= 0; i--) {
            var key = util.dateKey(util.addDays(util.now(), -i));
            var list = db.col('orders').filter(function (o) { return util.dateKey(o.createdAt) === key; });
            var signed = list.filter(function (o) { return o.status === 'signed'; });
            out.push({
                label: util.fmt.monthDay(key), date: key,
                orders: list.length, signed: signed.length,
                revenue: util.money(util.sum(signed, 'freight')),
                exceptions: db.col('exceptions').filter(function (e) { return util.dateKey(e.reportedAt) === key; }).length,
                trips: db.col('transports').filter(function (t) { return (t.date || util.dateKey(t.createdAt)) === key; }).length,
                weight: util.round(util.sum(list, 'chargeableWeight'), 1)
            });
        }
        return out;
    }

    function breakdown(field, days) {
        var list = ordersWithin(days || 30);
        var g = util.groupBy(list, field);
        return Object.keys(g).map(function (k) {
            var rows = g[k];
            var signed = rows.filter(function (o) { return o.status === 'signed'; });
            return {
                label: k || '未知', orders: rows.length, signed: signed.length,
                revenue: util.money(util.sum(signed, 'freight')),
                weight: util.round(util.sum(rows, 'chargeableWeight'), 1),
                margin: util.sum(signed, 'freight') ? util.round(util.sum(signed, TMS.order.profitOf) / util.sum(signed, 'freight') * 100, 1) : 0
            };
        }).sort(function (a, b) { return b.orders - a.orders; });
    }

    /* 全链路分段时效：环节时间取自扫描流水，流水按单预分组后一次性算完 */
    function lifecycleStats(days) {
        var list = ordersWithin(days || 14).filter(function (o) { return o.status === 'signed'; });
        var idx = TMS.order.scanIndex();
        var stages = [
            { key: 'created→collected', from: 'created', to: 'collected', label: '揽收' },
            { key: 'collected→inbound', from: 'collected', to: 'inbound', label: '入库' },
            { key: 'inbound→sorted', from: 'inbound', to: 'sorted', label: '分拣' },
            { key: 'sorted→transit', from: 'sorted', to: 'transit', label: '装车发运' },
            { key: 'transit→arrived', from: 'transit', to: 'arrived', label: '干线在途' },
            { key: 'arrived→delivering', from: 'arrived', to: 'delivering', label: '末端派送' },
            { key: 'delivering→signed', from: 'delivering', to: 'signed', label: '签收' }
        ];
        return stages.map(function (s) {
            var hours = [];
            list.forEach(function (o) {
                var st = TMS.order.stageTimes(o, idx[o.id]);
                if (st[s.from] && st[s.to]) hours.push(util.hoursBetween(st[s.from], st[s.to]));
            });
            hours.sort(function (a, b) { return a - b; });
            var avg = hours.length ? util.sum(hours, function (x) { return x; }) / hours.length : 0;
            return {
                label: s.label, key: s.key, count: hours.length,
                avgHours: util.round(avg, 1),
                p90Hours: util.round(hours.length ? hours[Math.floor(hours.length * 0.9)] || hours[hours.length - 1] : 0, 1),
                maxHours: util.round(hours.length ? hours[hours.length - 1] : 0, 1)
            };
        });
    }

    function timingStats(days) {
        var list = ordersWithin(days || 30);
        var signed = list.filter(function (o) { return o.status === 'signed'; });
        var late = signed.filter(function (o) { return TMS.order.isSignedLate(o); });
        var byService = {};
        TMS.cfg.serviceLevels.forEach(function (s) {
            var g = signed.filter(function (o) { return o.service === s; });
            byService[s] = {
                label: s, count: g.length,
                onTime: g.length ? util.round((g.length - g.filter(function (o) { return TMS.order.isSignedLate(o); }).length) / g.length * 100, 1) : 0,
                avgHours: g.length ? util.round(util.sum(g, function (o) { return util.hoursBetween(o.createdAt, o.signedAt); }) / g.length, 1) : 0
            };
        });
        var byZone = TMS.master.ZONES.map(function (z) {
            var g = signed.filter(function (o) { return TMS.pricing.zoneOf(o.destination) === z; });
            return {
                label: z, count: g.length,
                onTime: g.length ? util.round((g.length - g.filter(function (o) { return TMS.order.isSignedLate(o); }).length) / g.length * 100, 1) : 0,
                avgHours: g.length ? util.round(util.sum(g, function (o) { return util.hoursBetween(o.createdAt, o.signedAt); }) / g.length, 1) : 0
            };
        }).filter(function (x) { return x.count; });
        return {
            signed: signed.length, late: late.length,
            onTimeRate: signed.length ? util.round((signed.length - late.length) / signed.length * 100, 1) : 100,
            avgHours: signed.length ? util.round(util.sum(signed, function (o) { return util.hoursBetween(o.createdAt, o.signedAt); }) / signed.length, 1) : 0,
            promisedHours: signed.length ? util.round(util.sum(signed, TMS.order.stdHoursOf) / signed.length, 1) : 0,
            slaBreaching: list.filter(function (o) { return TMS.order.isLate(o); }).length,
            byService: Object.keys(byService).map(function (k) { return byService[k]; }),
            byZone: byZone,
            worst: util.sortBy(list, function (o) { return TMS.order.stuckHours(o); }, 'desc').slice(0, 10)
        };
    }

    /* 扫描质量看板：节点名/超时/设备全部走 TMS.order.traceView 派生，统计与详情页口径一致 */
    function traceStats(days) {
        var cutoff = util.addDays(util.now(), -(days || 14)).getTime();
        var rows = db.col('scans').filter(function (s) { return util.toDate(s.opTime).getTime() >= cutoff; });
        var idx = TMS.order.scanIndex();
        var views = rows.map(function (s) {
            var list = idx[s.orderId] || [];
            var i = list.indexOf(s);
            return TMS.order.traceView(s, db.get('orders', s.orderId), i > -1 ? list[i + 1] : null);
        });
        var overtime = views.filter(function (v) { return v.isOvertime; });
        var byNode = util.groupBy(views, 'nodeName');
        var byDevice = util.groupBy(views, 'device');
        return {
            total: views.length,
            overtime: overtime.length,
            deviant: views.filter(function (v) { return v.isDeviant; }).length,
            exceptionResult: views.filter(function (v) { return v.result !== 'ok'; }).length,
            byNode: Object.keys(byNode).map(function (k) { return { label: k, value: byNode[k].length }; })
                .sort(function (a, b) { return b.value - a.value; }),
            overtimeList: util.sortBy(overtime, 'opTime', 'asc').slice(0, 20),
            byDevice: Object.keys(byDevice).map(function (k) { return { label: k, value: byDevice[k].length }; }).sort(function (a, b) { return b.value - a.value; }),
            scanCount: rows.length, indexed: Object.keys(idx).length
        };
    }

    function routeStats() {
        var rows = db.col('routes');
        var traces = db.col('scans');
        return {
            total: rows.length,
            active: rows.filter(function (r) { return r.status === 'active'; }).length,
            avgStdHours: rows.length ? util.round(util.sum(rows, 'totalStdHours') / rows.length, 1) : 0,
            avgDistance: rows.length ? Math.round(util.sum(rows, 'distanceKm') / rows.length) : 0,
            deviationTraces: traces.filter(function (t) { return t.isDeviant; }).length,
            deviationOrders: util.unique(traces.filter(function (t) { return t.isDeviant; }).map(function (t) { return t.orderId; })).length,
            byMode: Object.keys(util.groupBy(rows, 'mode')).map(function (k) { return { label: k, value: util.groupBy(rows, 'mode')[k].length }; })
        };
    }

    function networkStats(days) {
        var list = ordersWithin(days || 30);
        var byBranch = util.groupBy(list, 'originBranchId');
        var byDest = util.groupBy(list, 'destBranchId');
        var branches = db.col('branches').map(function (b) {
            var out = byBranch[b.id] || [], inn = byDest[b.id] || [];
            return {
                id: b.id, name: b.name, city: b.city, zone: b.zone, hubName: b.hubName,
                manager: b.manager, status: b.status, staffCount: b.staffCount,
                outbound: out.length, inbound: inn.length,
                revenue: util.money(util.sum(inn.concat(out).filter(function (o) { return o.status === 'signed'; }), 'freight')),
                exceptions: (out.concat(inn)).reduce(function (s, o) { return s + (o.exceptionCount || 0); }, 0),
                loadRate: b.dailyCapacity ? util.round((out.length + inn.length) / 30 / b.dailyCapacity * 100, 1) : 0
            };
        });
        /* 分拣任务行不再冗余 hubId/件数：按订单的始发分拨分组汇总 */
        var sortRows = db.col('sortingTasks').map(TMS.operation.sortingTaskView);
        var sortByHub = util.groupBy(sortRows, 'hubId');
        var hubs = db.col('hubs').map(function (h) {
            var list2 = sortByHub[h.id] || [];
            return {
                id: h.id, name: h.name, city: h.city, zone: h.zone, role: h.role, status: h.status,
                tasks: list2.length, pieces: util.sum(list2, 'pieces'),
                capacityPieces: h.capacityPieces, usedPieces: h.usedPieces,
                utilization: h.capacityPieces ? util.round(h.usedPieces / h.capacityPieces * 100, 1) : 0,
                sortLines: h.sortLines
            };
        });
        return { branches: util.sortBy(branches, 'outbound', 'desc'), hubs: util.sortBy(hubs, 'pieces', 'desc') };
    }

    function capacityStats() {
        var vehicles = db.col('vehicles');
        var trips = db.col('transports');
        var recent = trips.slice(-120);
        var byStatus = util.countBy(vehicles, 'status');
        var byType = {};
        TMS.master.VEHICLE_TYPES.forEach(function (t) {
            var g = vehicles.filter(function (v) { return v.typeCode === t.code; });
            byType[t.code] = { label: t.name, count: g.length, loadKg: t.loadKg, busy: g.filter(function (v) { return v.status === 'busy'; }).length };
        });
        var trips7 = trips.filter(function (t) { return util.toDate(t.date || t.createdAt).getTime() >= util.addDays(util.now(), -6).getTime(); });
        var selfTrips7 = trips7.filter(function (t) { return t.dispatchType !== 'ltl'; });
        return {
            total: vehicles.length,
            available: byStatus.available || 0, busy: byStatus.busy || 0,
            maintenance: byStatus.maintenance || 0, offline: byStatus.offline || 0,
            utilization: vehicles.length ? util.round((byStatus.busy || 0) / vehicles.length * 100, 1) : 0,
            byType: Object.keys(byType).map(function (k) { return byType[k]; }),
            trips7: trips7.length,
            selfTrips: trips7.filter(function (t) { return t.dispatchType !== 'ltl'; }).length,
            ltlTrips: trips7.filter(function (t) { return t.dispatchType === 'ltl'; }).length,
            avgLoadRate: selfTrips7.length ? util.round(util.sum(selfTrips7, 'loadRate') / selfTrips7.length, 1) : 0,
            totalKm: util.sum(trips7, TMS.operation.distanceOf),
            totalWeight: util.round(util.sum(trips7, 'weight'), 1),
            costPerKg: util.sum(trips7, 'weight') ? util.round(util.sum(trips7, TMS.operation.costTotal) / util.sum(trips7, 'weight'), 2) : 0,
            maintenanceDue: vehicles.filter(function (v) { return util.toDate(v.nextCheckAt) <= util.addDays(util.now(), 15); }).length
        };
    }

    function customerRanking(limit) {
        var byCust = util.groupBy(db.col('orders'), 'customerId');
        var rows = db.col('customers').map(function (c) {
            var list = byCust[c.id] || [];
            var signed = list.filter(function (o) { return o.status === 'signed'; });
            var ar = db.col('receivables').filter(function (r) { return r.customerId === c.id; });
            return {
                id: c.id, name: c.name, level: c.level, city: c.city, industry: c.industry,
                contact: c.contact, settleCycle: c.settleCycle, status: c.status,
                orders: list.length, signed: signed.length,
                revenue: util.money(util.sum(signed, 'freight')),
                profit: util.money(util.sum(signed, TMS.order.profitOf)),
                margin: util.sum(signed, 'freight') ? util.round(util.sum(signed, TMS.order.profitOf) / util.sum(signed, 'freight') * 100, 1) : 0,
                arPending: util.money(util.sum(ar.filter(function (r) { return r.status === 'pending'; }), 'amount')),
                overdue: util.money(util.sum(ar.filter(function (r) { return r.status === 'pending' && util.toDate(r.dueDate) < util.now(); }), 'amount')),
                exceptions: list.reduce(function (s, o) { return s + (o.exceptionCount || 0); }, 0),
                points: c.points || 0, monthlyVolume: c.monthlyVolume
            };
        });
        return util.sortBy(rows, 'revenue', 'desc').slice(0, limit || 15);
    }

    /* 扫描设备/节点分布：设备号缺省即默认手持终端，节点名走 traceNodes 字典 */
    function scanStats(days) {
        var cutoff = util.addDays(util.now(), -(days || 7)).getTime();
        var rows = db.col('scans').filter(function (s) { return util.toDate(s.opTime).getTime() >= cutoff; });
        var devices = {};
        rows.forEach(function (s) {
            var key = TMS.order.deviceLabelOf(s);
            var d = devices[key] = devices[key] || { label: key, count: 0, errors: 0 };
            d.count++;
            if (s.result && s.result !== 'ok') d.errors++;
        });
        var byNode = util.groupBy(rows, function (s) { return cfg.nodeOf(s.node).name; });
        return {
            total: rows.length,
            ok: rows.filter(function (s) { return !s.result || s.result === 'ok'; }).length,
            exception: rows.filter(function (s) { return s.result && s.result !== 'ok'; }).length,
            byNode: Object.keys(byNode).map(function (k) { return { label: k, value: byNode[k].length }; }).sort(function (a, b) { return b.value - a.value; }),
            byDevice: Object.keys(devices).map(function (k) { return devices[k]; }).sort(function (a, b) { return b.count - a.count; }).slice(0, 12)
        };
    }

    function materialStats() {
        var mats = db.col('materials');
        return {
            total: mats.length,
            low: mats.filter(function (m) { return m.stock < m.safeStock; }).length,
            value: util.money(util.sum(mats, function (m) { return (Number(m.stock) || 0) * (Number(m.price) || 0); })),
            byStatus: ['normal', 'low', 'out'].map(function (s) {
                return { label: s === 'normal' ? '库存充足' : (s === 'low' ? '低于安全库存' : '断货'), value: mats.filter(function (m) { return m.status === s; }).length };
            }),
            warehouses: db.col('warehouses').map(function (w) {
                return {
                    label: w.name, area: w.areaM2, used: w.usedArea,
                    utilization: w.areaM2 ? util.round(w.usedArea / w.areaM2 * 100, 1) : 0,
                    pieces: w.usedPieces, capacity: w.capacityPieces
                };
            })
        };
    }

    function systemStats() {
        var devices = db.col('devices');
        var info = db.info();
        return {
            dbBytes: info.bytes, dbRows: info.total, schema: info.schema, seededAt: db.load().seededAt,
            counters: Object.keys(db.counters()).length,
            devices: { total: devices.length, online: devices.filter(function (d) { return d.status === 'online'; }).length, fault: devices.filter(function (d) { return d.status === 'fault'; }).length, lowBattery: devices.filter(function (d) { return d.battery < 20 && d.status !== 'offline'; }).length },
            alerts: { total: db.col('alerts').length, open: db.col('alerts').filter(function (a) { return a.status === 'open'; }).length },
            audit: db.col('auditLogs').length,
            idleDevices: util.sortBy(devices.filter(function (d) { return d.lastSyncAt; }), 'lastSyncAt', 'asc').slice(0, 5),
            users: { total: db.col('users').length, active: db.col('users').filter(function (u) { return u.status === 'active'; }).length }
        };
    }

    /* 网点/分拨口径的经营聚合：一线端的首页与经营页都读这里。
       页面里自己 sum/groupBy 会出现「网点端毛利与运营端对不上」，
       同一套口径必须只有一个实现。scope 用进出港双向归属，与 people.computeMetrics 的 touchesOrg 一致 */
    function orgStats(orgId, days) {
        var n = days || 30;
        var branch = db.get('branches', orgId) || db.get('hubs', orgId) || {};
        var hubId = branch.hubId || (branch.id ? branch.id : orgId);
        var cutoff = util.addDays(util.now(), -n + 1).getTime();
        var list = db.col('orders').filter(function (o) {
            return (o.originBranchId === orgId || o.destBranchId === orgId || o.hubFrom === hubId || o.hubTo === hubId) &&
                util.toDate(o.createdAt).getTime() >= cutoff;
        });
        var signed = list.filter(function (o) { return o.status === 'signed'; });
        var late = signed.filter(function (o) { return TMS.order.isSignedLate(o); });
        var inbound = list.filter(function (o) { return o.destBranchId === orgId; });
        var outbound = list.filter(function (o) { return o.originBranchId === orgId; });
        var revenue = util.money(util.sum(signed, 'freight'));
        var cost = util.money(util.sum(signed, function (o) { return o.cost ? o.cost.tot : 0; }));
        var ex = db.col('exceptions').filter(function (e) {
            var o = e.orderId ? db.get('orders', e.orderId) : null;
            return o && (o.originBranchId === orgId || o.destBranchId === orgId) &&
                util.toDate(e.reportedAt).getTime() >= cutoff;
        });
        var trend = [];
        for (var i = n - 1; i >= 0; i--) {
            var key = util.dateKey(util.addDays(util.now(), -i));
            var rows = list.filter(function (o) { return util.dateKey(o.createdAt) === key; });
            var s = rows.filter(function (o) { return o.status === 'signed'; });
            trend.push({
                label: util.fmt.monthDay(key), date: key, orders: rows.length, signed: s.length,
                revenue: util.money(util.sum(s, 'freight'))
            });
        }
        var byService = util.groupBy(list, 'service');
        var byCustomer = util.groupBy(list, 'customerId');
        return {
            org: branch.name || orgId, days: n,
            orders: list.length, signed: signed.length,
            collected: outbound.filter(function (o) { return TMS.order.stageAt(o, 'collected'); }).length,
            inbound: inbound.length, outbound: outbound.length,
            inTransit: list.filter(function (o) { return ['transit', 'arrived', 'delivering', 'sorted', 'inbound'].indexOf(o.status) > -1; }).length,
            backlog: list.filter(function (o) { return o.status === 'problem' || TMS.order.isLate(o); }).length,
            revenue: revenue, cost: cost, profit: util.money(revenue - cost),
            margin: revenue ? util.round((revenue - cost) / revenue * 100, 1) : 0,
            avgFreight: signed.length ? util.money(revenue / signed.length) : 0,
            weight: util.round(util.sum(list, 'chargeableWeight'), 1),
            onTimeRate: signed.length ? util.round((signed.length - late.length) / signed.length * 100, 1) : 100,
            exceptions: ex.length, openExceptions: ex.filter(function (e) { return e.status !== 'resolved'; }).length,
            deduction: util.money(util.sum(ex, 'deductionAmount')),
            trend: trend,
            byService: Object.keys(byService).map(function (k) {
                var g = byService[k], s = g.filter(function (o) { return o.status === 'signed'; });
                return { label: k || '未知', orders: g.length, revenue: util.money(util.sum(s, 'freight')) };
            }).sort(function (a, b) { return b.orders - a.orders; }),
            topCustomers: Object.keys(byCustomer).map(function (k) {
                var g = byCustomer[k], s = g.filter(function (o) { return o.status === 'signed'; });
                return {
                    label: TMS.order.customerName(g[0]) || k, orders: g.length,
                    revenue: util.money(util.sum(s, 'freight')),
                    margin: util.sum(s, 'freight') ? util.round(util.sum(s, TMS.order.profitOf) / util.sum(s, 'freight') * 100, 1) : 0
                };
            }).sort(function (a, b) { return b.revenue - a.revenue; }).slice(0, 8)
        };
    }

    TMS.stats = {
        overview: overview, orderTrend: orderTrend, breakdown: breakdown,
        lifecycleStats: lifecycleStats, timingStats: timingStats, traceStats: traceStats,
        routeStats: routeStats, networkStats: networkStats, capacityStats: capacityStats,
        customerRanking: customerRanking, scanStats: scanStats, materialStats: materialStats,
        systemStats: systemStats, ordersWithin: ordersWithin, orgStats: orgStats
    };
})(window);
