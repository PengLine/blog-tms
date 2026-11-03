/* 通用工具：格式化、日期、随机、几何、集合运算 */
(function (global) {
    'use strict';

    var TMS = global.TMS = global.TMS || {};

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function pad(n, len) {
        var s = String(n == null ? '' : n);
        len = len || 2;
        while (s.length < len) s = '0' + s;
        return s;
    }

    function hash(str) {
        var h = 2166136261;
        var s = String(str == null ? '' : str);
        for (var i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return (h >>> 0);
    }

    /* 确定性随机：同一时点重跑种子数据得到完全一致的库 */
    function rng(seed) {
        var a = (seed >>> 0) || 1;
        return function () {
            a |= 0; a = (a + 0x6D2B79F5) | 0;
            var t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function money(n) {
        return Math.round((Number(n) || 0) * 100) / 100;
    }

    function round(n, digits) {
        var f = Math.pow(10, digits || 0);
        return Math.round((Number(n) || 0) * f) / f;
    }

    function num(n) { return Number(n) || 0; }

    function pct(part, whole, digits) {
        var w = Number(whole) || 0;
        return round((w ? Number(part) || 0 : 0) / w * 100, digits == null ? 1 : digits);
    }

    /* ---------- 日期 ---------- */

    function toDate(value) {
        if (value instanceof Date) return value;
        if (typeof value === 'number') return new Date(value);
        if (typeof value === 'string') {
            var m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(value);
            if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
        }
        return new Date(value);
    }

    /* 全链路时间戳统一到分钟：仓库作业留痕本身按分钟对齐，
       而 localStorage 是唯一持久层——每个时间字段省 3 字符，全库近千个时间字段就是 100KB+ 余量 */
    function iso(d) {
        d = toDate(d);
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
            'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    var simNow = null;
    function now() { return simNow ? new Date(simNow) : new Date(); }
    /* 回放用时钟：种子引擎按时间轴推进，业务代码无需感知演示数据 */
    function setNow(d) { simNow = d ? toDate(d) : null; }

    function dayStart(d) {
        var x = new Date(toDate(d || now()));
        x.setHours(0, 0, 0, 0);
        return x;
    }

    function addHours(d, h) { return new Date(toDate(d).getTime() + h * 3600000); }
    function addDays(d, n) { return new Date(toDate(d).getTime() + n * 86400000); }

    function dateKey(d) {
        var x = toDate(d || now());
        return x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate());
    }

    function monthKey(d) {
        var x = toDate(d || now());
        return x.getFullYear() + '-' + pad(x.getMonth() + 1);
    }

    function hoursBetween(a, b) {
        return (toDate(b).getTime() - toDate(a).getTime()) / 3600000;
    }

    var fmt = {
        date: function (v) { return v ? dateKey(toDate(v)) : '-'; },
        dateTime: function (v) {
            if (!v) return '-';
            var d = toDate(v);
            if (isNaN(d)) return String(v);
            return dateKey(d) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
        },
        time: function (v) {
            if (!v) return '-';
            var d = toDate(v);
            return pad(d.getHours()) + ':' + pad(d.getMinutes());
        },
        monthDay: function (v) {
            var d = toDate(v);
            return pad(d.getMonth() + 1) + '-' + pad(d.getDate());
        },
        money: function (v) {
            return '¥' + (Number(v) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        },
        number: function (v) { return (Number(v) || 0).toLocaleString('zh-CN'); },
        kg: function (v) { return round(v, 2) + ' kg'; },
        percent: function (v, digits) { return (Number(v) || 0).toFixed(digits == null ? 1 : digits) + '%'; },
        duration: function (hours) {
            var h = Number(hours) || 0;
            if (h < 24) return round(h, 1) + ' 小时';
            return round(h / 24, 1) + ' 天';
        },
        km: function (v) { return (Number(v) || 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 }) + ' km'; }
    };

    /* ---------- 集合 ---------- */

    function clone(obj) {
        return obj == null ? obj : JSON.parse(JSON.stringify(obj));
    }

    function sum(rows, getter) {
        var fn = typeof getter === 'function' ? getter : function (r) { return r[getter]; };
        var t = 0;
        (rows || []).forEach(function (r) { t += Number(fn(r)) || 0; });
        return t;
    }

    function groupBy(rows, getter) {
        var fn = typeof getter === 'function' ? getter : function (r) { return r[getter]; };
        var out = {};
        (rows || []).forEach(function (r) {
            var k = fn(r);
            if (k == null || k === '') k = '_';
            (out[k] = out[k] || []).push(r);
        });
        return out;
    }

    function countBy(rows, getter) {
        var g = groupBy(rows, getter);
        var out = {};
        Object.keys(g).forEach(function (k) { out[k] = g[k].length; });
        return out;
    }

    function unique(arr) {
        var seen = {}, out = [];
        (arr || []).forEach(function (v) { if (v != null && !seen[v]) { seen[v] = 1; out.push(v); } });
        return out;
    }

    function sortBy(rows, getter, dir) {
        var fn = typeof getter === 'function' ? getter : function (r) { return r[getter]; };
        var d = dir === 'asc' ? 1 : -1;
        return (rows || []).slice().sort(function (a, b) {
            var av = fn(a), bv = fn(b);
            if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * d;
            return String(av == null ? '' : av).localeCompare(String(bv == null ? '' : bv), 'zh-CN') * d;
        });
    }

    function randomDigits(len, rand) {
        var out = '';
        for (var i = 0; i < (len || 4); i++) out += Math.floor((rand ? rand() : Math.random()) * 10);
        return out;
    }

    function pick(list, rand) {
        return list[Math.floor((rand ? rand() : Math.random()) * list.length) % list.length];
    }

    function weighted(pairs, rand) {
        // pairs: [[value, weight], ...]
        var total = sum(pairs, function (p) { return p[1]; });
        var r = (rand ? rand() : Math.random()) * total;
        for (var i = 0; i < pairs.length; i++) {
            r -= pairs[i][1];
            if (r <= 0) return pairs[i][0];
        }
        return pairs[pairs.length - 1][0];
    }

    /* 淡旺季系数：11–12 月双十二/年末高峰，2 月春节低谷 */
    function seasonFactor(d) {
        var m = toDate(d).getMonth() + 1;
        var byMonth = { 1: 0.92, 2: 0.74, 3: 1.0, 4: 0.96, 5: 1.02, 6: 1.08, 7: 1.04, 8: 1.06, 9: 1.1, 10: 1.14, 11: 1.32, 12: 1.26 };
        var dow = toDate(d).getDay();
        var byDay = dow === 6 ? 1.12 : (dow === 0 ? 1.05 : 1.0);
        return round((byMonth[m] || 1) * byDay, 3);
    }

    /* 大圆距离（km），用于干线里程与在途时效 */
    function distanceKm(a, b) {
        if (!a || !b || a.lat == null || b.lat == null) return 0;
        var R = 6371, rad = Math.PI / 180;
        var dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
        var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return Math.round(2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s)) * 10) / 10;
    }

    function chunk(arr, size) {
        var out = [];
        for (var i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
        return out;
    }

    function bytes(str) {
        // 粗略 UTF-16 存储估算，仅用于容量裁剪判断
        return String(str == null ? '' : str).length * 2;
    }

    /* 站点根相对路径 → 当前页面能用的地址。
       页面按角色分了目录，登录页在根、业务页在 admin/ branch/ … 之下，
       同一个 'index.html' 在两边指向完全不同的文件，只有带上 boot.js 反推出的基准才说得清 */
    function url(path) {
        return (TMS.base || '') + String(path == null ? '' : path);
    }

    TMS.util = {
        esc: esc, pad: pad, hash: hash, rng: rng, money: money, round: round, num: num, pct: pct,
        fmt: fmt, iso: iso, now: now, setNow: setNow, dayStart: dayStart, addHours: addHours, addDays: addDays,
        dateKey: dateKey, monthKey: monthKey, hoursBetween: hoursBetween, toDate: toDate,
        clone: clone, sum: sum, groupBy: groupBy, countBy: countBy, unique: unique, sortBy: sortBy,
        pick: pick, weighted: weighted, randomDigits: randomDigits, seasonFactor: seasonFactor, distanceKm: distanceKm,
        chunk: chunk, bytes: bytes, url: url
    };
})(window);
