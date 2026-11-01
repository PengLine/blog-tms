/* 单据号规则中心
   订单号：HL + 发货省缩写 + yyyyMMdd + 4 位（客户 ID hash）+ 4 位随机
   运单号：WB + 10 位（订单号 hash）+ 4 位随机
   其余单据：业务前缀 + yyyyMMdd + 当日流水，流水存于 counters，重启页面不会重号 */
(function (global) {
    'use strict';

    var TMS = global.TMS = global.TMS || {};
    var util = TMS.util;

    var rand = Math.random;

    function setRandom(fn) { rand = fn || Math.random; }

    function digits(n, len) {
        var s = String(Math.floor(Math.abs(n)));
        while (s.length < len) s = '0' + s;
        return s.slice(-len);
    }

    function randomDigits(len) {
        var out = '';
        for (var i = 0; i < len; i++) out += Math.floor(rand() * 10);
        return out;
    }

    function dayStamp(d) {
        var x = util.toDate(d || util.now());
        return String(x.getFullYear()) + util.pad(x.getMonth() + 1) + util.pad(x.getDate());
    }

    /* 序列号：同一前缀当日从 1 递增，seed 阶段预置后运行时继续往后排 */
    function sequence(entity, d) {
        var counters = TMS.db.counters();
        var key = entity + '#' + dayStamp(d);
        counters[key] = (counters[key] || 0) + 1;
        return digits(counters[key], 4);
    }

    /* 订单号尾段只有 4 位随机：同一发货省 + 同一天 + 同一客户 hash 是一个一万格的桶，
       日均几十单就会撞号。撞号即两条订单共用主键，读档时后者覆盖前者，账面会凭空少单。
       所以发号时先查重，重投用尽再退回当日流水补位——落库的单号必然唯一。 */
    function buildOrderId(province, customerId, date) {
        var p = String(province || 'SH').toUpperCase().slice(0, 2);
        var tail = digits(util.hash(String(customerId || 'guest')), 4);
        var stem = 'HL' + p + dayStamp(date) + tail;
        for (var i = 0; i < 30; i++) {
            var id = stem + randomDigits(4);
            if (!TMS.db.get('orders', id)) return id;
        }
        return stem + sequence('orderId', date);
    }

    function buildWaybill(orderId) {
        return 'WB' + digits(util.hash(String(orderId)), 10) + randomDigits(4);
    }

    function buildPackageId(orderId, seq) {
        return 'PK' + String(orderId).replace(/^HL/, '') + digits(seq, 2);
    }

    function next(entity, prefix) {
        var p = prefix || (TMS.db.meta(entity).prefix) || String(entity).slice(0, 3).toUpperCase();
        return p + dayStamp() + sequence(entity);
    }

    /* 平铺流水号：扫描这类高频留痕不带日期段，前缀 + 6 位全局序号，每行比 dayStamp 版省 ~8 字符 */
    function nextFlat(entity, prefix) {
        var counters = TMS.db.counters();
        counters['@' + entity] = (counters['@' + entity] || 0) + 1;
        var p = prefix || (TMS.db.meta(entity).prefix) || String(entity).slice(0, 3).toUpperCase();
        return p + digits(counters['@' + entity], 6);
    }

    function nextAt(entity, prefix, date) {
        var p = prefix || (TMS.db.meta(entity).prefix) || String(entity).slice(0, 3).toUpperCase();
        return p + dayStamp(date) + sequence(entity, date);
    }

    /* 稳定性 ID：主数据用固定编号，便于种子与页面互相引用 */
    function stable(prefix, seq) { return prefix + digits(seq, 4); }

    TMS.ids = {
        setRandom: setRandom,
        buildOrderId: buildOrderId,
        buildWaybill: buildWaybill,
        buildPackageId: buildPackageId,
        sequence: sequence,
        dayStamp: dayStamp,
        randomDigits: randomDigits,
        next: next,
        nextFlat: nextFlat,
        nextAt: nextAt,
        stable: stable
    };
})(window);
