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

    /* ---------- 超时运单台账 ----------
       网点经营会要的不是「时效均值多少」，而是「这个月哪一类超时在吃我的钱、挂在谁身上」。
       所以超时拆成六类可追责的行：在途超承诺 / 超时签收 / 节点滞留 / 垫付未回笼 /
       代收未上划 / 回件未返。一行 = 一张单的一个问题，同一单可以同时占多行；
       KPI、维度榜、明细表全部从这同一份行里出，页面再 sum 一遍就是两套口径的开始 */
    var OT_TYPES = {
        transitLate: { label: '在途超承诺', line: '履约', owner: 'dest', money: 'freight' },
        signedLate: { label: '超时签收', line: '履约', owner: 'dest', money: 'freight' },
        stranded: { label: '节点滞留', line: '作业', owner: 'last', money: 'freight' },
        advance: { label: '垫付未回笼', line: '资金', owner: 'origin', money: 'amount' },
        cod: { label: '代收未上划', line: '资金', owner: 'dest', money: 'netPayable' },
        podMissing: { label: '回件未返', line: '单证', owner: 'dest', money: 'freight' }
    };

    /* 滞留判定与「轨迹超时巡检」同一条线：只看最后一个节点，
       前序节点的时限已被后续扫描证明达成，重复计会把一单算成两单滞留 */
    function strandedDue(o, idx) {
        if (TMS.order.isTerminal(o)) return 0;
        var list = idx[o.id] || [];
        var s = list[list.length - 1];
        if (!s || s.node === 'SIGNED') return 0;
        return TMS.order.scanDue(s);
    }

    function overtimeRows(days) {
        var win = days || 30;
        var nowMs = util.now().getTime();
        var cutoff = util.addDays(util.now(), -win + 1).getTime();
        var list = ordersWithin(win).filter(function (o) { return o.status !== 'cancelled'; });
        var idx = TMS.order.scanIndex();
        var rows = [];

        function push(o, type, dueAt, amount) {
            var t = OT_TYPES[type];
            /* 责任网点按问题性质给：揽收/回件追目的网点，垫付追始发网点（谁开的单谁垫的钱），
               节点滞留追最后一次扫描落在哪——那才是压着不动的那一站 */
            var bid = t.owner === 'origin' ? o.originBranchId : o.destBranchId;
            if (t.owner === 'last') bid = o.hubFrom || o.originBranchId;
            var b = (bid && db.get('branches', bid)) || null;
            var due = dueAt ? util.toDate(dueAt) : null;
            rows.push({
                key: o.id + '#' + type, orderId: o.id, type: type, typeLabel: t.label, line: t.line,
                waybillNo: o.waybillNo, customer: TMS.order.customerName(o),
                customerLevel: TMS.order.customerLevel(o), service: o.service,
                origin: o.origin, destination: o.destination, status: o.status,
                courier: o.courier || '', courierId: o.courierId || '',
                branchId: b ? b.id : '', branchName: b ? b.name : '', branchCity: b ? b.city : '',
                createdAt: o.createdAt, signedAt: o.signedAt || '',
                dueAt: dueAt || '', overHours: due ? util.round(Math.max(0, (nowMs - due.getTime()) / 3600000), 1) : 0,
                amount: util.money(Number(amount) || 0)
            });
        }

        list.forEach(function (o) {
            if (TMS.order.isLate(o)) push(o, 'transitLate', TMS.order.promiseOf(o), o.freight);
            if (TMS.order.isSignedLate(o)) push(o, 'signedLate', TMS.order.promiseOf(o), o.freight);
            var sd = strandedDue(o, idx);
            if (sd && sd < nowMs) push(o, 'stranded', util.iso(new Date(sd)), o.freight);
            /* 回件只看 POD 照片：签收人/备注可以是电话口头补录，
               「有照片才算完整 POD」是签收弹窗里就写明的口径 */
            if (o.status === 'signed' && !(o.pod && o.pod.podPhoto)) {
                push(o, 'podMissing', util.iso(util.addHours(util.toDate(o.signedAt), cfg.sla.podReturnHours)), o.freight);
            }
        });

        db.col('receivables').forEach(function (r) {
            if (r.status !== 'pending') return;
            if (util.toDate(r.dueDate).getTime() >= nowMs) return;
            var o = db.get('orders', r.orderId);
            if (!o || util.toDate(o.createdAt).getTime() < cutoff || o.status === 'cancelled') return;
            if (o.status !== 'signed') return;   // 未签收谈不上回款逾期，那是时效问题，已在履约行里
            push(o, 'advance', r.dueDate, r.amount);
        });

        db.col('codRecords').forEach(function (r) {
            if (r.remitStatus === 'remitted') return;
            var o = db.get('orders', r.orderId);
            if (!o || util.toDate(o.createdAt).getTime() < cutoff || o.status === 'cancelled') return;
            if (util.hoursBetween(r.collectedAt, util.now()) < cfg.sla.codRemitHours) return;
            push(o, 'cod', util.iso(util.addHours(util.toDate(r.collectedAt), cfg.sla.codRemitHours)), r.netPayable);
        });

        return util.sortBy(rows, 'overHours', 'desc');
    }

    function overtimeStats(days) {
        var rows = overtimeRows(days);
        var opened = ordersWithin(days || 30).filter(function (o) { return o.status !== 'cancelled'; });
        var signed = opened.filter(function (o) { return o.status === 'signed'; });
        var of = function (t) { return rows.filter(function (r) { return r.type === t; }); };
        var transitLate = of('transitLate'), signedLate = of('signedLate'), stranded = of('stranded');
        var advance = of('advance'), cod = of('cod'), podMissing = of('podMissing');

        /* 超时单数按「单」而不是按「行」：一单既在途超承诺又滞留，只算一张超时单 */
        var lateIds = util.unique(transitLate.concat(signedLate).map(function (r) { return r.orderId; }));
        var byType = Object.keys(OT_TYPES).map(function (k) {
            var g = rows.filter(function (r) { return r.type === k; });
            return {
                key: k, label: OT_TYPES[k].label, line: OT_TYPES[k].line, count: g.length,
                orders: util.unique(g.map(function (r) { return r.orderId; })).length,
                amount: util.money(util.sum(g, 'amount')),
                avgHours: g.length ? util.round(util.sum(g, 'overHours') / g.length, 1) : 0,
                maxHours: util.round(g.reduce(function (m, r) { return Math.max(m, Number(r.overHours) || 0); }, 0), 1)
            };
        });
        var rollup = function (key, emptyText) {
            var m = {};
            rows.forEach(function (r) {
                var k = r[key] || emptyText;
                var g = m[k] || (m[k] = { label: k, count: 0, orders: {}, amount: 0, hours: 0,
                    late: 0, stranded: 0, advance: 0, cod: 0, pod: 0 });
                g.count++;
                g.orders[r.orderId] = 1;
                g.amount += Number(r.amount) || 0;
                g.hours = Math.max(g.hours, Number(r.overHours) || 0);
                if (r.type === 'transitLate' || r.type === 'signedLate') g.late++;
                else if (r.type === 'stranded') g.stranded++;
                else if (r.type === 'advance') g.advance++;
                else if (r.type === 'cod') g.cod++;
                else if (r.type === 'podMissing') g.pod++;
            });
            return Object.keys(m).map(function (k) {
                var g = m[k];
                return {
                    label: g.label, count: g.count, orders: Object.keys(g.orders).length,
                    amount: util.money(g.amount), maxHours: util.round(g.hours, 1),
                    late: g.late, stranded: g.stranded, advance: g.advance, cod: g.cod, pod: g.pod
                };
            }).sort(function (a, b) { return b.count - a.count; });
        };

        /* 按天趋势：分母用当日开单数，超承诺是「当天开的单里有多少张没守住时效」，
           拿全窗口单量当分母会把早上的积压摊到晚上，曲线看不出治理有没有生效 */
        var dayMap = {};
        opened.forEach(function (o) {
            var d = util.dateKey(util.toDate(o.createdAt));
            var g = dayMap[d] || (dayMap[d] = { day: d, opened: 0, late: 0, lateIds: {}, stranded: 0, pod: 0 });
            g.opened++;
        });
        rows.forEach(function (r) {
            var g = dayMap[util.dateKey(util.toDate(r.createdAt))];
            if (!g) return;
            if (r.type === 'transitLate' || r.type === 'signedLate') {
                /* 与顶部「超时单数」同口径：一单既在途超承诺又超时签收，走势里也只算它一次 */
                if (!g.lateIds[r.orderId]) { g.lateIds[r.orderId] = 1; g.late++; }
            }
            else if (r.type === 'stranded') g.stranded++;
            else if (r.type === 'podMissing') g.pod++;
        });
        var trend = Object.keys(dayMap).sort().map(function (d) {
            var g = dayMap[d];
            return { label: d.slice(5), opened: g.opened, late: g.late, stranded: g.stranded, pod: g.pod,
                rate: util.pct(g.late, g.opened) };
        });

        return {
            days: days || 30, rows: rows,
            opened: opened.length,
            lateOrders: lateIds.length,
            lateRate: util.pct(lateIds.length, opened.length),
            transitLate: transitLate.length, signedLate: signedLate.length,
            stranded: stranded.length, strandedAmount: util.money(util.sum(stranded, 'amount')),
            advance: advance.length, advanceAmount: util.money(util.sum(advance, 'amount')),
            cod: cod.length, codAmount: util.money(util.sum(cod, 'amount')),
            podDue: signed.length, podBack: signed.length - podMissing.length,
            podMissing: podMissing.length, podRate: util.pct(signed.length - podMissing.length, signed.length),
            exposure: util.money(util.sum(advance, 'amount') + util.sum(cod, 'amount')),
            byType: byType, byBranch: rollup('branchName', '未归属网点'),
            byCourier: rollup('courier', '未指派'), byCustomer: rollup('customer', '散客'),
            trend: trend
        };
    }

    TMS.stats = {
        overview: overview, orderTrend: orderTrend, breakdown: breakdown,
        lifecycleStats: lifecycleStats, timingStats: timingStats, traceStats: traceStats,
        routeStats: routeStats, networkStats: networkStats,
        customerRanking: customerRanking, scanStats: scanStats,
        systemStats: systemStats, ordersWithin: ordersWithin, orgStats: orgStats,
        overtimeRows: overtimeRows, overtimeStats: overtimeStats, OT_TYPES: OT_TYPES
    };
})(window);
