/* 派送地址领域：地址簿维护 + 四级审核状态机 + 审核/审查双记录
   地址是「手机号 → 可派送」这条链的起点（见图1），所以它必须是一个可审核的档案，
   而不是订单上一个随手的字符串：一线按手机号取到的是已通过审核的那一条，取不到才回落到围栏判定 */
(function (global) {
    'use strict';

    var TMS = global.TMS = global.TMS || {};
    var util = TMS.util, db = TMS.db, cfg = TMS.cfg;

    var STATUS = cfg.address.LABEL;
    var FLOW = cfg.address.FLOW;

    /* 记录分两种，别混成一列：
       审核记录 = 审核人对「这一版地址」下的结论（通过 / 打回），一次结论一条，是追责依据；
       审查记录 = 地址内容发生变化时留下的对照快照（谁改的、改前改后是什么），
                  审核人回来复审时要看的就是它。
       图2 里「审核通过 → 审核+审查记录」「打回（需修改）→ 只有审核记录」正是这个区别：
       打回时地址一个字没动，没有变化可对照，自然不该凭空造一条快照 */
    var KIND = { review: '审核记录', inspect: '审查记录' };

    function labelOf(s) { return STATUS[s] || s; }

    /* ---------- 规范化 ---------- */

    /* 现场录进来的地址是一串自由文本，能不能派送取决于它拆得开吗：
       认城市（决定归哪个网点）、认区/镇（决定派给哪个片区）、认门牌（决定能不能送到门口）。
       判定标准写在 cfg.address，页面与领域共用同一份，不在两处各写一遍正则 */
    function parse(text) {
        var raw = String(text || '').replace(/\s+/g, '').trim();
        var city = TMS.network.cityOfText(raw);
        var district = '';
        (TMS.master.DISTRICTS || []).forEach(function (d) {
            if (!district && raw.indexOf(d) > -1) district = d;
        });
        /* detail 只装区以下的街面部分：三处页面都按「city + district + detail」拼整串，
           这里再塞一遍区名就会显示成「上海高新片区高新片区566号」。
           剥专名时连着后面的通名「市」一起剥，否则剩下个孤立的市字粘在街名前 */
        var detail = raw;
        if (city) detail = detail.replace(city + '市', '').replace(city, '');
        if (district) detail = detail.replace(district, '');
        var door = cfg.address.doorRe.test(raw);
        return {
            raw: raw, city: city, district: district,
            detail: detail,
            door: door, branch: city ? nearestBranch(city, raw) : null
        };
    }

    /* 同一座城市里，地址文本能直接命中网点名的优先归到那个网点（「浦东营业部」写在全串里），
       命中不了才退回城市归属：派送的分工是按网点谈的，按城市派会跨片区 */
    function nearestBranch(city, text) {
        var rows = db.col('branches').filter(function (b) { return b.city === city && b.status !== 'inactive'; });
        if (!rows.length) return null;
        var hit = null;
        rows.forEach(function (b) {
            if (!hit && b.name && String(text).indexOf(b.name) > -1) hit = b;
        });
        return hit || rows[0];
    }

    /* 打回理由必须是可执行的：说「不规范」而不说缺什么，网点改完还是一样被打回 */
    function issuesOf(p, phone) {
        var out = [];
        if (!p.city) out.push('地址里认不出服务城市，无法归属网点');
        if (!p.district) out.push('缺区/镇一级，无法分派到片区');
        if (!p.door) out.push('缺门牌号/楼栋/单元，派送员找不到具体点位');
        if (p.raw.length > cfg.address.maxLen) out.push('整串超 ' + cfg.address.maxLen + ' 字，疑似把备注写进了地址');
        if (!/^1[3-9]\d{9}$/.test(String(phone || '').replace(/\D/g, '').slice(-11))) out.push('收件人手机号不完整');
        return out;
    }

    function suggestOf(p) {
        var b = p.branch;
        var head = (b ? b.province + p.city : p.city || '（城市待补）');
        return head + (p.district || '（区/镇待补）') + '（街道）' + (p.door ? '' : '××路 88 号 1 栋 201');
    }

    /* ---------- 读写 ---------- */

    /* 停在当前状态多久：db.update 每落一次状态都盖 updatedAt，所以「打回后又压了两天」
       不该按建档时间算——催办要催的是现在这一轮，不是历史总时长 */
    function holdHours(a) {
        if (!a) return 0;
        return util.round(Math.max(0, util.hoursBetween(a.updatedAt || a.createdAt, util.now())), 1);
    }

    /* 两类超时分开判：待审核压着是审核人的事，待修改压着是网点的事，
       催的对象不同，页面标红的口径也就不能混用 */
    function overdueKind(a) {
        if (!a) return '';
        if (a.status === 'pending') return holdHours(a) > (cfg.sla.addressReviewHours || 24) ? 'review' : '';
        if (a.status === 'revise') return holdHours(a) > (cfg.sla.addressFixHours || 48) ? 'fix' : '';
        return '';
    }

    function isOverdue(a) { return !!overdueKind(a); }

    function get(id) { return db.get('addresses', id); }

    /* 图1 左支的入口：按手机号取「维护过且已通过审核」的地址。
       只认 approved 是有意的——待审核的地址还没人核对过，拿它直接派送等于让审核环节形同虚设 */
    function byPhone(phone) {
        var tail = String(phone || '').replace(/\D/g, '');
        if (tail.length < 11) return [];
        return db.col('addresses').filter(function (a) {
            return String(a.phone).indexOf(tail.slice(-11)) > -1 && a.status === 'approved';
        });
    }

    function allOfPhone(phone) {
        var tail = String(phone || '').replace(/\D/g, '').slice(-11);
        if (!tail) return [];
        return db.col('addresses').filter(function (a) { return String(a.phone).indexOf(tail) > -1; });
    }

    function reviewsOf(id) {
        return util.sortBy(db.col('addressReviews').filter(function (r) { return r.addressId === id; }), 'at', 'asc');
    }

    function rowView(a) {
        if (!a) return null;
        var rev = reviewsOf(a.id);
        return {
            row: a, reviews: rev,
            statusLabel: labelOf(a.status),
            reviewer: a.reviewer || '', reviewedAt: a.reviewedAt || '',
            rounds: rev.filter(function (r) { return r.kind === KIND.review; }).length,
            lastReject: (function () {
                var j = rev.filter(function (r) { return r.result === '打回'; });
                return j.length ? j[j.length - 1] : null;
            })()
        };
    }

    function pushReview(row, rec) {
        var d = rec || {};
        var saved = db.create('addressReviews', {
            addressId: row.id, waybillPhone: row.phone, kind: d.kind, result: d.result || '',
            action: d.action, fromStatus: d.from || '', toStatus: d.to || '',
            statusLabel: labelOf(d.to || row.status),
            actor: d.actor || '系统', actorRole: d.actorRole || '', reason: d.reason || '',
            note: d.note || '', snapshot: d.snapshot || null, rounds: d.rounds || 1,
            at: util.iso(util.now())
        });
        return saved;
    }

    function actorRole(actor) {
        var s = TMS.auth.current ? TMS.auth.current() : null;
        return (s && s.role) || (actor === '系统' ? 'system' : '') || '';
    }

    /* 新建即待审核：地址没有「存着不审就直接能派送」这条路，
       否则审核页永远只是走过场 */
    function create(data) {
        var d = data || {};
        var p = parse(d.address);
        var phone = String(d.phone || '').replace(/\D/g, '');
        var dup = db.findOne('addresses', function (a) {
            return a.phone === phone && a.detail === p.detail;
        });
        if (dup) return { ok: false, message: '该手机号下已有同一条地址（' + dup.id + '，' + labelOf(dup.status) + '），请直接在原记录上修改', dup: dup };
        var row = db.create('addresses', {
            phone: phone, receiver: d.receiver || '', custCode: d.custCode || '',
            city: p.city, district: p.district, detail: p.detail,
            branchId: p.branch ? p.branch.id : '', branchName: p.branch ? p.branch.name : '',
            status: 'pending', rejectReason: '', reviewer: '', reviewedAt: '',
            maintainCount: 1, source: d.source || '网点维护', owner: d.actor || '',
            issues: issuesOf(p, phone), suggest: p.city ? suggestOf(p) : '',
            createdAt: util.iso(util.now())
        });
        pushReview(row, {
            kind: KIND.inspect, action: '提交维护', to: 'pending', actor: d.actor || '网点',
            actorRole: actorRole(d.actor), rounds: 1,
            snapshot: { phone: phone, city: row.city, district: row.district, detail: row.detail },
            note: '新建派送地址，等待审核'
        });
        TMS.audit.log('address.maintain', 'addresses', row.id, '新建地址 ' + row.phone + ' ' + row.detail, d.actor);
        db.commit('addresses', row.id, 'address:create');
        return { ok: true, row: row };
    }

    /* 维护动作：改内容，不改结论。
       被打回后改完 → 已修改（等复审）；待审核期间补充 → 仍是待审核；
       已通过的不给直接改——改了就不是当初通过的那版地址了，要先发起复审 */
    function maintain(id, data) {
        var row = db.get('addresses', id);
        if (!row) return { ok: false, message: '地址记录不存在' };
        var d = data || {};
        if (row.status === 'approved' && !d.force) {
            return { ok: false, message: '已通过的地址不能直接改：改了就不是当初通过的那版。请先「发起复审」' };
        }
        var text = d.address || (row.city + row.district + row.detail);
        var p = parse(text);
        var phone = String(d.phone || row.phone).replace(/\D/g, '');
        var before = { phone: row.phone, city: row.city, district: row.district, detail: row.detail };
        var from = row.status;
        var to = from === 'revise' ? 'revised' : from;
        db.update('addresses', id, {
            phone: phone, receiver: d.receiver || row.receiver, custCode: d.custCode || row.custCode,
            city: p.city, district: p.district, detail: p.detail,
            branchId: p.branch ? p.branch.id : row.branchId,
            branchName: p.branch ? p.branch.name : row.branchName,
            status: to, rejectReason: row.status === 'revise' ? '' : row.rejectReason,
            issues: issuesOf(p, phone), suggest: p.city ? suggestOf(p) : '',
            maintainCount: (row.maintainCount || 1) + 1,
            owner: d.actor || row.owner
        });
        var after = { phone: phone, city: p.city, district: p.district, detail: p.detail };
        pushReview(row, {
            kind: KIND.inspect, action: to === 'revised' ? '打回后修改' : '补充修改',
            from: from, to: to, actor: d.actor || '网点', actorRole: actorRole(d.actor),
            rounds: row.maintainCount || 1, snapshot: after,
            note: changed(before, after)
        });
        TMS.audit.log('address.maintain', 'addresses', id, '修改地址内容 → ' + labelOf(to), d.actor);
        db.commit('addresses', id, 'address:maintain');
        TMS.bus.emit('address:changed', { id: id });
        return { ok: true, row: db.get('addresses', id) };
    }

    function changed(a, b) {
        var out = [];
        Object.keys(b).forEach(function (k) { if (String(a[k] || '') !== String(b[k] || '')) out.push(k + ': ' + (a[k] || '空') + ' → ' + (b[k] || '空')); });
        return out.join('；') || '内容未变化，重新提交审核';
    }

    /* 审核：一次给结论。
       待审核 --地址规范--> 通过；待审核 --不规范--> 打回 → 待修改（此时只生成审核记录）；
       已修改 --通过--> 通过；已修改 --仍不规范--> 待修改（地址已被人动过，所以要留一份改后快照） */
    function review(id, data) {
        var row = db.get('addresses', id);
        if (!row) return { ok: false, message: '地址记录不存在' };
        var d = data || {};
        var act = d.action === 'approve' ? 'approve' : 'reject';
        if (row.status === 'approved') return { ok: false, message: '该地址已是「通过」，请改用发起复审' };
        if (row.status === 'revise') return { ok: false, message: '待修改的地址还没人改过，审核只能等网点提交新版本' };
        var reason = (d.reason || '').trim();
        if (act === 'reject' && !reason) return { ok: false, message: '打回必须写明缺什么，否则网点无从改起' };
        var from = row.status;
        var to = act === 'approve' ? 'approved' : 'revise';
        var wasEdited = (row.maintainCount || 1) > 1 || from === 'revised';
        var issues = act === 'approve' ? [] : (row.issues && row.issues.length ? row.issues : [reason]);
        db.update('addresses', id, {
            status: to, reviewer: d.actor || '审核员', reviewedAt: util.iso(util.now()),
            rejectReason: act === 'reject' ? reason : '', issues: issues,
            approvedAt: act === 'approve' ? util.iso(util.now()) : null
        });
        var round = reviewsOf(id).filter(function (r) { return r.kind === KIND.review; }).length + 1;
        var saved = pushReview(row, {
            kind: KIND.review, result: act === 'approve' ? '通过' : '打回',
            action: act === 'approve' ? '审核通过' : '审核打回', from: from, to: to,
            actor: d.actor || '审核员', actorRole: actorRole(d.actor), reason: reason, rounds: round
        });
        /* 「审核通过 → 审核+审查记录」：结论之外还要留一份「通过的是哪一版」的快照，
           后面复审或出纠纷时能对上是哪条地址被放行 */
        if (act === 'approve' || wasEdited) {
            pushReview(row, {
                kind: KIND.inspect, action: act === 'approve' ? '通过版留档' : '打回时快照',
                from: from, to: to, actor: d.actor || '审核员', actorRole: actorRole(d.actor),
                rounds: round, result: saved.result,
                snapshot: { phone: row.phone, city: row.city, district: row.district, detail: row.detail },
                note: act === 'approve' ? '地址规范，放行派送' : reason
            });
        }
        TMS.audit.log('address.review', 'addresses', id,
            (act === 'approve' ? '审核通过' : '审核打回：' + reason) + '（' + labelOf(from) + '→' + labelOf(to) + '）', d.actor);
        db.commit('addresses', id, 'address:review');
        TMS.bus.emit('address:reviewed', { id: id, status: to });
        return { ok: true, row: db.get('addresses', id), review: saved };
    }

    /* 通过后仍可再发起审核（图2 两个「可继续发起审核」）：状态退回待审核，历史记录一条不删，
       这样客户投诉「地址明明是错的你们却放行」时，能翻出每一轮是谁批的 */
    function reopen(id, actor, note) {
        var row = db.get('addresses', id);
        if (!row) return { ok: false, message: '地址记录不存在' };
        if (row.status !== 'approved') return { ok: false, message: '只有「通过」的地址需要发起复审' };
        db.update('addresses', id, { status: 'pending', reviewer: '', reviewedAt: '', rejectReason: '' });
        pushReview(row, {
            kind: KIND.inspect, action: '发起复审', from: 'approved', to: 'pending',
            actor: actor || '运营', actorRole: actorRole(actor), rounds: (row.maintainCount || 1),
            snapshot: { phone: row.phone, city: row.city, district: row.district, detail: row.detail },
            note: note || '对已通过的地址重新发起审核'
        });
        TMS.audit.log('address.review', 'addresses', id, '发起复审（通过→待审核）', actor);
        db.commit('addresses', id, 'address:reopen');
        return { ok: true, row: db.get('addresses', id) };
    }

    function remove(id, actor) {
        var row = db.get('addresses', id);
        if (!row) return { ok: false, message: '地址记录不存在' };
        db.remove('addresses', id);
        db.removeWhere('addressReviews', function (r) { return r.addressId === id; });
        TMS.audit.log('address.maintain', 'addresses', id, '删除地址 ' + row.phone + ' ' + row.detail, actor);
        db.commit('addresses', id, 'address:remove');
        return { ok: true };
    }

    /* ---------- 供图1 判定链使用的口径 ---------- */

    /* 一个手机号能不能按派送：先看有没有通过的维护地址，再看收件点是否落在机构派送围栏内。
       围栏判定属于电子围栏那一层（TMS.network），地址这层只负责把「认不认得出收件点」说清楚，
       两条支路合成一句人话，一线才知道该让客户自提还是先补地址（图1 左支） */
    function phoneDecision(phone, addressText) {
        var list = byPhone(phone);
        if (list.length) {
            return { canDeliver: true, via: '维护地址', address: list[0], note: '按手机号命中 ' + list.length + ' 条已通过审核的派送地址' };
        }
        var held = allOfPhone(phone);
        if (held.length) {
            return {
                canDeliver: false, via: '维护地址', address: held[0],
                note: '有维护记录但是「' + labelOf(held[0].status) + '」，未通过审核前不能按地址派送', blocked: 'review'
            };
        }
        var p = parse(addressText);
        if (!p.city) {
            return {
                canDeliver: false, via: '无维护地址', address: null, parsed: p,
                note: '地址认不出服务城市，先补齐城市再判派送范围', blocked: 'address'
            };
        }
        /* 收件点取城市中心：没有地理编码，区级坐标不在本演示的数据范围里。
           所以这一格的精度就是「城市作业边界」——判定本身仍是射线法打在勾画的多边形上，
           停用/未勾围栏的城市会如实落到「需自提」那一支 */
        var fence = TMS.network.fenceOfCity(p.city, 'branch');
        if (fence) {
            return {
                canDeliver: true, via: '机构派送围栏', address: null, parsed: p, fence: fence.id, fenceName: fence.name,
                note: '无维护地址，但收件点落在「' + fence.name + '」内，可按原文字面地址派送'
            };
        }
        return {
            canDeliver: false, via: '机构派送围栏', address: null, parsed: p, blocked: 'fence',
            note: p.city + ' 当前没有在用的机构派送围栏，件只能到网点自提'
        };
    }

    function stats(days) {
        var win = days || 30;
        var cutoff = util.addDays(util.now(), -win + 1).getTime();
        var all = db.col('addresses');
        /* 队列按全库算，速率按窗口算：待审核压着 3 条就是欠 3 条活，
           不会因为「这行是 40 天前建的」就从页面上消失；通过率才是「这段日子干得怎么样」 */
        var rows = all.filter(function (a) { return util.toDate(a.createdAt).getTime() >= cutoff; });
        var byStatus = {};
        FLOW.forEach(function (s) { byStatus[s] = all.filter(function (a) { return a.status === s; }).length; });
        var reviews = db.col('addressReviews').filter(function (r) {
            return util.toDate(r.at).getTime() >= cutoff;
        });
        var reviewed = reviews.filter(function (r) { return r.kind === KIND.review; });
        var passed = reviewed.filter(function (r) { return r.result === '通过'; });
        var rejected = reviewed.filter(function (r) { return r.result === '打回'; });
        /* 一次通过率只看「首轮结论」：返工后终于通过不算一次通过，否则审核质量看起来很好 */
        var firstRound = {};
        util.sortBy(reviewed, 'at', 'asc').forEach(function (r) {
            if (firstRound[r.addressId] === undefined) firstRound[r.addressId] = r;
        });
        var firsts = Object.keys(firstRound).map(function (k) { return firstRound[k]; });
        var firstPass = firsts.filter(function (r) { return r.result === '通过'; }).length;
        var avgHours = passed.length ? util.round(util.sum(passed, function (r) {
            var a = db.get('addresses', r.addressId);
            return a ? util.hoursBetween(a.createdAt, r.at) : 0;
        }) / passed.length, 1) : 0;
        return {
            days: win, total: all.length, recent: rows.length, byStatus: byStatus,
            pending: byStatus.pending || 0, revise: byStatus.revise || 0,
            revised: byStatus.revised || 0, approved: byStatus.approved || 0,
            reviews: reviewed.length, passed: passed.length, rejected: rejected.length,
            inspects: reviews.length - reviewed.length,
            passRate: util.pct(passed.length, reviewed.length),
            firstPassRate: util.pct(firstPass, firsts.length),
            avgReviewHours: avgHours,
            /* 超时判定只走 overdueKind 这一条线：页面、巡检告警、统计三处读同一个数，
               否则会出现「待办标红 12 条、告警只发 8 条」 */
            overdue: all.filter(function (a) { return overdueKind(a) === 'review'; }).length,
            stuck: all.filter(function (a) { return overdueKind(a) === 'fix'; }).length,
            byBranch: util.unique(all.map(function (a) { return a.branchName; })).filter(Boolean).map(function (n) {
                var g = all.filter(function (a) { return a.branchName === n; });
                return {
                    label: n, total: g.length,
                    approved: g.filter(function (a) { return a.status === 'approved'; }).length,
                    revise: g.filter(function (a) { return a.status === 'revise' || a.status === 'revised'; }).length,
                    pending: g.filter(function (a) { return a.status === 'pending'; }).length,
                    overdue: g.filter(function (a) { return !!overdueKind(a); }).length
                };
            }).sort(function (a, b) { return b.total - a.total; }),
            byPhoneOwner: util.countBy(all, 'source')
        };
    }

    /* ---------- 建档 ---------- */

    /* 地址档案派生自真实订单的收件手机号 + 收件地址，而不是凭空造一批演示行：
       这样在轨迹页点任何一单，「按手机号取维护地址」这条链都能命中同一条记录。
       状态分布要铺满四级——审核页只有「通过」的话，图2 的打回/复审分支就永远是死代码。
       生命周期按时间推进（setNow），历史记录才能落在过去而不是全部堆在「此刻」 */
    function backfill(opts) {
        var d = opts || {};
        if (db.col('addresses').length && !d.force) return { created: 0 };
        var rand = d.rand || Math.random;
        var limit = d.limit || 40;
        var clock = util.now();
        var byPhone = {};
        db.col('orders').forEach(function (o) {
            var phone = String(o.receiverPhone || '').replace(/\D/g, '');
            if (phone.length < 11 || !o.receiverAddress) return;
            var cell = byPhone[phone] || (byPhone[phone] = { phone: phone });
            // 同号多条地址是常态（家里/公司），但建档只留最近一单的那条，避免一个手机号刷十几行
            if (!cell.at || o.updatedAt > cell.at) {
                cell.at = o.updatedAt;
                cell.receiver = o.receiverName || '';
                cell.address = o.receiverAddress;
                cell.custCode = (db.get('customers', o.customerId) || {}).code || '';
            }
        });
        /* 按城市轮流取，而不是「取最近 limit 个手机号」：后者会整批落在最近下单的那几座城市，
           演示账号所在的上海网点翻开自己这页就是空的——网点端每个城市都得有自己的件可看可改 */
        var groups = {};
        Object.keys(byPhone).forEach(function (k) {
            var cell = byPhone[k];
            var city = TMS.network.cityOfText(cell.address || '') || '（认不出城市）';
            (groups[city] || (groups[city] = [])).push(cell);
        });
        var cities = Object.keys(groups).sort();
        cities.forEach(function (c) { groups[c] = util.sortBy(groups[c], 'at', 'desc'); });
        /* rank = 这是该城市被取到的第几轮：第一轮铺「已通过」，让每城都有一个能直接派送的地址；
           第二轮起铺在途状态，保证每个网点翻开自己这页都有活可干，而不是只有一堆历史档案 */
        var pool = [];
        var round = 0;
        while (pool.length < limit) {
            var moved = false;
            cities.forEach(function (c) {
                if (pool.length >= limit) return;
                var it = groups[c].shift();
                if (it) { it.rank = round; pool.push(it); moved = true; }
            });
            if (!moved) break;
            round++;
        }
        /* 建档时间跟着订单时间走：选出来再按由早到晚排回来，
           历史才不会出现「上周的单子半年前就建了地址」这种倒挂 */
        pool = util.sortBy(pool, 'at', 'asc');
        var created = 0;
        var plan = pool.map(function (item, i) {
            if (!item.rank) return 'approved';
            /* 在途三态轮着铺：待审核占多数（网点提交后没人审是最常见的现场），
               待修改与已修改各留样本，图2 的打回与复审分支才不是死代码 */
            var q = i % 3;
            return q === 0 ? 'pending' : (q === 1 ? 'revise' : 'revised');
        });
        var daysSpan = Math.max(1, d.days || 26);
        pool.forEach(function (item, i) {
            var base = clock.getTime() - (daysSpan - (i * daysSpan / pool.length)) * 86400000;
            util.setNow(new Date(base));
            var res = create({
                phone: item.phone, receiver: item.receiver, address: item.address,
                custCode: item.custCode, source: i % 3 === 0 ? '派送员采集' : '网点维护',
                actor: i % 3 === 0 ? '派送员' : '网点'
            });
            if (!res.ok) return;
            created++;
            var id = res.row.id;
            var target = plan[i];
            util.setNow(new Date(base + 3600000 * (2 + rand() * 20)));
            if (target === 'pending') return;
            if (target === 'approved') { review(id, { action: 'approve', actor: '运营审核员' }); return; }
            review(id, {
                action: 'reject', actor: '运营审核员',
                reason: util.pick(['缺区/镇一级，无法分派到片区', '缺门牌号与楼栋单元，派送员找不到点位', '地址把备注写进了正文，需要拆解'], rand)
            });
            if (target === 'revise') return;
            var row = get(id);
            util.setNow(new Date(base + 3600000 * (30 + rand() * 40)));
            maintain(id, {
                address: row.city + '市' + util.pick(TMS.master.DISTRICTS, rand) +
                    util.pick(['人民路', '建设大道', '解放大道', '中山大街', '花园街'], rand) +
                    (100 + Math.floor(rand() * 800)) + '号' +
                    (1 + Math.floor(rand() * 9)) + '栋' + (100 + Math.floor(rand() * 800)) + '室',
                actor: '网点'
            });
        });
        util.setNow(clock);
        db.persist('address');
        return { created: created };
    }

    TMS.address = {
        STATUS: STATUS, FLOW: FLOW, KIND: KIND,
        labelOf: labelOf, parse: parse, issuesOf: issuesOf, suggestOf: suggestOf,
        get: get, byPhone: byPhone, allOfPhone: allOfPhone, reviewsOf: reviewsOf, rowView: rowView,
        holdHours: holdHours, overdueKind: overdueKind, isOverdue: isOverdue,
        create: create, maintain: maintain, review: review, reopen: reopen, remove: remove,
        backfill: backfill,
        phoneDecision: phoneDecision, stats: stats
    };
})(window);
