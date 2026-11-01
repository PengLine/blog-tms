/* 存储引擎：localStorage 之上的集合式仓储 + 乐观并发（单写者）+ 容量治理 */
(function (global) {
    'use strict';

    var TMS = global.TMS = global.TMS || {};
    var util = TMS.util, cfg = TMS.cfg;

    /* 集合清单：prefix 决定单据号前缀，trim 标记可被容量治理裁剪的流水表，
       noTouch 标记台账类行——状态更新不再写 updatedAt，发生时间只认 date/createdAt 一个字段 */
    var COLLECTIONS = {
        orders: { prefix: 'HL', label: '订单' },
        scans: { prefix: 'SC', label: '扫描流水', trim: 90, noTouch: true },
        sortingTasks: { prefix: 'SRT', label: '分拣任务', trim: 60, noTouch: true },
        loadingTasks: { prefix: 'LDG', label: '装卸任务', trim: 60, noTouch: true },
        transports: { prefix: 'TRP', label: '车次', trim: 90, noTouch: true },
        trips: { prefix: 'JRN', label: '干线班次' },
        receivables: { prefix: 'AR', label: '应收', noTouch: true },
        payables: { prefix: 'AP', label: '应付', noTouch: true },
        bills: { prefix: 'BILL', label: '账单' },
        finances: { prefix: 'FIN', label: '财务流水', trim: 120, noTouch: true },
        rechecks: { prefix: 'CHK', label: '计费复核', noTouch: true },
        codRecords: { prefix: 'COD', label: '代收货款', noTouch: true },
        exceptions: { prefix: 'EX', label: '异常工单' },
        tickets: { prefix: 'CS', label: '客服工单' },
        claims: { prefix: 'CL', label: '理赔' },
        evaluations: { prefix: 'EVA', label: '考核', noTouch: true },
        performances: { prefix: 'PRF', label: '绩效', noTouch: true },
        clockRecords: { prefix: 'CLK', label: '打卡', trim: 45, noTouch: true },
        shifts: { prefix: 'SFT', label: '排班', noTouch: true },
        employees: { prefix: 'EMP', label: '员工' },
        departments: { prefix: 'DEP', label: '部门' },
        users: { prefix: 'USR', label: '系统用户' },
        roles: { prefix: 'ROL', label: '角色' },
        permissions: { prefix: 'PER', label: '权限' },
        customers: { prefix: 'CU', label: '客户' },
        branches: { prefix: 'BR', label: '网点' },
        hubs: { prefix: 'HB', label: '分拨中心' },
        vehicles: { prefix: 'VEH', label: '车辆' },
        carriers: { prefix: 'CAR', label: '承运商' },
        suppliers: { prefix: 'SUP', label: '供应商' },
        routes: { prefix: 'RT', label: '路由' },
        rateCards: { prefix: 'RC', label: '运价卡' },
        warehouses: { prefix: 'WH', label: '仓库' },
        materials: { prefix: 'MAT', label: '物料' },
        stocks: { prefix: 'STK', label: '库存' },
        devices: { prefix: 'DEV', label: '扫描设备' },
        geofences: { prefix: 'GF', label: '电子围栏' },
        alerts: { prefix: 'ALR', label: '告警', trim: 30 },
        auditLogs: { prefix: 'LOG', label: '审计日志', trim: 30 },
        points: { prefix: 'PTS', label: '积分流水', trim: 60, noTouch: true }
    };

    var db = null;
    var dirty = false;
    var batchDepth = 0;
    var idMaps = {};
    /* 集合版本号：新增/删除/失效都会 +1，派生索引（如扫描流水分组）据此缓存，
       否则每算一次绩效都要重排全表流水，建库会慢到几十秒 */
    var revisions = {};
    var archived = [];        // 本次运行实际发生的归档留痕

    function emptyDb() {
        var data = {};
        Object.keys(COLLECTIONS).forEach(function (k) { data[k] = []; });
        return {
            schema: cfg.storage.schema,
            createdAt: util.iso(util.now()),
            seededAt: '',
            counters: {},
            auditAnchor: '',
            data: data
        };
    }

    function storage() {
        try {
            var s = global.localStorage;
            if (!s) return null;
            return s;
        } catch (err) { return null; }
    }

    function bump(name) { revisions[name] = (revisions[name] || 0) + 1; }

    function readRaw() {
        var s = storage();
        if (!s) return null;
        try { return s.getItem(cfg.storage.key); } catch (err) { return null; }
    }

    /* 换库名后清掉历史版本键：配额按整个域计算，老库留在原地等于白占一半空间，
       新库写入时会直接撞上限 */
    function pruneLegacyKeys() {
        var s = storage();
        if (!s) return;
        try {
            for (var i = s.length - 1; i >= 0; i--) {
                var k = s.key(i);
                if (k && k.indexOf('tmsDB_') === 0 && k !== cfg.storage.key) s.removeItem(k);
            }
        } catch (err) { /* 无痕模式下枚举可能抛异常，忽略即可 */ }
    }

    function writeRaw(text) {
        var s = storage();
        if (!s) return { ok: false, message: '浏览器不支持本地存储' };
        try {
            s.setItem(cfg.storage.key, text);
            return { ok: true };
        } catch (err) {
            return { ok: false, message: '本地存储已满：' + (err && err.name || 'unknown'), error: err };
        }
    }

    function sizeBytes() {
        return util.bytes(readRaw() || '');
    }

    /* ---------- 行压缩：列式打包 ----------
       localStorage 是唯一持久层，配额按 UTF-16 字符数计，而 JSON 里最贵的东西是字段名：
       "chargeableWeight": 每条订单重复一次、每笔扫描重复一次，全库纯键名占掉四成体积。
       落盘时把每个集合压成 {f:[字段序], r:[[值…]]}——字段序只写一遍，行只留值；
       读库时按 f 还原，业务代码、迁移、派生视图看到的始终是长字段名对象，
       只有存储形态紧凑。数组末尾的 null 会被裁掉，缺位即「该字段没值」。
       显式写成 null 的字段还原后按缺字段处理，读取端统一 `x || 默认值` 兜底，语义不变。 */

    function packColumn(rows) {
        var fields = [], seen = {}, i;
        for (i = 0; i < rows.length; i++) {
            Object.keys(rows[i]).forEach(function (k) {
                if (!seen[k]) { seen[k] = 1; fields.push(k); }
            });
        }
        var out = new Array(rows.length);
        for (i = 0; i < rows.length; i++) {
            var row = rows[i], arr = new Array(fields.length);
            for (var j = 0; j < fields.length; j++) arr[j] = row[fields[j]] === undefined ? null : row[fields[j]];
            while (arr.length && arr[arr.length - 1] === null) arr.pop();
            out[i] = arr;
        }
        return { f: fields, r: out };
    }

    function unpackColumn(col) {
        var fields = col.f, rows = col.r, out = new Array(rows.length);
        for (var i = 0; i < rows.length; i++) {
            var arr = rows[i], o = {};
            for (var j = 0; j < arr.length && j < fields.length; j++) {
                if (arr[j] !== null && arr[j] !== undefined) o[fields[j]] = arr[j];
            }
            out[i] = o;
        }
        return out;
    }

    /* 兼容未打包的历史库：数组即原样返回，非数组才按 {f,r} 还原 */
    function unpackData(data) {
        Object.keys(data || {}).forEach(function (name) {
            var col = data[name];
            if (Array.isArray(col)) return;
            data[name] = col && col.f && Array.isArray(col.r) ? unpackColumn(col) : [];
        });
        return data;
    }

    function serialize() {
        var rows = db.data, packed = {};
        Object.keys(rows).forEach(function (name) {
            var list = rows[name];
            packed[name] = Array.isArray(list) && list.length ? packColumn(list) : list || [];
        });
        db.data = packed;
        try { return JSON.stringify(db); } finally { db.data = rows; }
    }

    /* ---------- 容量治理：按集合 trim 天数裁剪流水，保证不撑爆 5MB 配额 ---------- */

    function trimRows(days, dateKey2) {
        var cutoff = util.addDays(util.now(), -days).getTime();
        return function (row) {
            var t = row[dateKey2 || 'createdAt'];
            if (!t) return false;
            var d = util.toDate(t).getTime();
            return isNaN(d) ? false : d < cutoff;
        };
    }

    /* 流水集合的时间字段名不统一，裁剪/归档时按此定位 */
    function timeFieldOf(name) {
        if (name === 'finances' || name === 'receivables' || name === 'payables') return 'date';
        if (name === 'scans') return 'opTime';
        if (name === 'clockRecords') return 'date';
        if (name === 'transports') return 'date';
        // 绩效按月生成，账期字符串本身即可排序、可裁剪
        if (name === 'performances') return 'period';
        return 'createdAt';
    }

    /* 审计链裁剪：记录被裁掉的最后一条哈希作为链头锚点，verify 仍能从现存首条续链 */
    function anchorAudit(rows, kept) {
        if (kept.length === rows.length) return;
        var dropped = rows.slice(0, rows.length - kept.length);
        if (dropped.length) db.auditAnchor = dropped[dropped.length - 1].hash || db.auditAnchor || '';
        dirty = true;
    }

    function dropOldest(name, count) {
        var rows = db.data[name] || [];
        if (!rows.length || count <= 0) return 0;
        var field = timeFieldOf(name);
        var ordered = util.sortBy(rows, field, 'asc');
        var floor = cfg.storage.archiveFloor[name] || 0;
        var drop = Math.min(count, Math.max(0, ordered.length - floor));
        if (!drop) return 0;
        var kept = ordered.slice(drop);
        if (name === 'auditLogs') anchorAudit(ordered, kept);
        db.data[name] = kept;
        idMaps[name] = {};            // 记忆化读取必须失效，否则会命中已归档的行
        bump(name);
        dirty = true;
        markArchive(name, drop);
        return drop;
    }

    /* 归档留痕：种子数据本不该触发裁剪，冒烟校验据此判断容量是否真的留有余量 */
    function markArchive(name, count) {
        if (!count) return;
        var hit = archived.filter(function (a) { return a.name === name; })[0];
        if (hit) hit.rows += count;
        else archived.push({ name: name, rows: count });
    }

    function enforceCapacity(text) {
        if (text.length * 2 <= cfg.storage.softLimitBytes) return;
        /* 一级：按保留天数裁剪流水（真实系统的归档策略） */
        Object.keys(COLLECTIONS).forEach(function (name) {
            var meta = COLLECTIONS[name];
            if (!meta.trim) return;
            var rows = db.data[name] || [];
            if (!rows.length) return;
            var field = timeFieldOf(name);
            var cutoff = util.addDays(util.now(), -meta.trim).getTime();
            var kept = rows.filter(function (r) {
                var d = util.toDate(r[field]);
                return isNaN(d.getTime()) || d.getTime() > cutoff;
            });
            if (name === 'auditLogs') anchorAudit(rows, kept);
            db.data[name] = kept;
            if (kept.length !== rows.length) {
                idMaps[name] = {}; bump(name); dirty = true;
                markArchive(name, rows.length - kept.length);
            }
        });
        if (text.length * 2 <= cfg.storage.hardLimitBytes * 0.86) return;
        /* 二级：仍超配额（例如一次性导入历史数据），按集合优先级从最旧记录继续丢弃，
           保住主数据与未闭环单据，宁可丢历史流水也不能让整库写不进去 */
        var budget = cfg.storage.hardLimitBytes;
        var pass = 0;
        while (text.length * 2 > budget && pass < 12) {
            pass++;
            var before = text.length;
            cfg.storage.archiveOrder.forEach(function (name) {
                var rows = db.data[name] || [];
                var floor = cfg.storage.archiveFloor[name] || 0;
                if (rows.length <= floor) return;
                dropOldest(name, Math.max(40, Math.ceil(rows.length * 0.18)));
            });
            text = serialize();
            if (text.length === before) break;
        }
    }

    function persist(reason) {
        if (batchDepth > 0) { dirty = true; return true; }
        if (!db) return false;
        dirty = false;
        var text = serialize();
        enforceCapacity(text);
        if (dirty) text = serialize();
        var res = writeRaw(text);
        if (!res.ok) {
            // 写入被浏览器拒绝（真实配额比估算更紧）：强制裁掉一半可裁剪流水后重试
            Object.keys(COLLECTIONS).forEach(function (name) {
                var meta = COLLECTIONS[name];
                if (!meta.trim) return;
                var rows = db.data[name] || [];
                if (rows.length > 400) dropOldest(name, Math.floor(rows.length / 2));
            });
            res = writeRaw(serialize());
        }
        if (res.ok) TMS.bus.emit('data:saved', { reason: reason || 'write', bytes: sizeBytes() });
        else if (global.console) console.warn('[TMS] 写入失败', res.message);
        return res.ok;
    }

    function notify(event, payload) {
        TMS.bus.emit(event || 'data:change', payload || {});
    }

    /* ---------- 载入 / 迁移 ---------- */

    function ensureCollections() {
        Object.keys(COLLECTIONS).forEach(function (k) {
            if (!Array.isArray(db.data[k])) db.data[k] = [];
        });
    }

    function runMigrations(from) {
        var steps = TMS.migrations || {};
        var v = from;
        while (v < cfg.storage.schema) {
            var next = v + 1;
            var step = steps[next];
            if (!step) return false;      // 没有可用迁移 → 交给上层重建种子
            try { step(db, TMS); } catch (err) { if (console) console.error(err); return false; }
            v = next;
        }
        db.schema = cfg.storage.schema;
        return true;
    }

    function load() {
        if (db) return db;
        idMaps = {};
        revisions = {};
        archived = [];
        pruneLegacyKeys();
        var raw = readRaw();
        if (raw) {
            try {
                var parsed = JSON.parse(raw);
                if (parsed && parsed.data) {
                    db = parsed;
                    unpackData(db.data);          // 先还原成对象行，迁移与业务代码才能按字段名读写
                    if (!db.counters) db.counters = {};
                    if (db.schema !== cfg.storage.schema) {
                        if (!runMigrations(Number(db.schema) || 0)) db = null;
                    }
                    if (db) { ensureCollections(); return db; }
                }
            } catch (err) { if (console) console.warn('[TMS] 存储解析失败，将重建数据', err); }
        }
        db = emptyDb();
        return db;
    }

    function reload() {
        db = null;
        var ok = !!load().seededAt;
        notify('data:change', { source: 'external' });
        return ok;
    }

    function reset() {
        idMaps = {};
        db = emptyDb();
        persist('reset');
        notify('data:reset', {});
        return db;
    }

    function reseed() {
        db = emptyDb();
        idMaps = {};
        batchDepth++;                     // 建库过程只标脏，最后统一落盘一次
        try { TMS.seed.generate(db, TMS); } finally { batchDepth--; }
        db.seededAt = util.iso(util.now());
        persist('seed');
        notify('data:seeded', {});
        return db;
    }

    function isSeeded() {
        return !!(load().seededAt && (db.data.orders || []).length);
    }

    /* ---------- CRUD ---------- */

    function col(name) {
        var d = load();
        if (!d.data[name]) d.data[name] = [];
        return d.data[name];
    }

    function get(name, id) {
        if (id == null || id === '') return null;
        var map = idMaps[name] || (idMaps[name] = {});
        var hit = map[id];
        if (hit) return hit === NOT_FOUND ? null : hit;
        var rows = col(name);
        for (var i = 0; i < rows.length; i++) {
            if (rows[i].id === id) { map[id] = rows[i]; return rows[i]; }
        }
        map[id] = NOT_FOUND;
        return null;
    }

    var NOT_FOUND = { __nf: 1 };

    function applySort(rows, sort) {
        if (!sort || !sort.key) return rows;
        var dir = sort.dir === 'asc' ? 1 : -1;
        var key = sort.key;
        return rows.slice().sort(function (a, b) {
            var av = a[key], bv = b[key];
            if (av == null && bv == null) return 0;
            if (av == null) return 1;
            if (bv == null) return -1;
            if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
            var as = /^-?\d+(\.\d+)?$/.test(String(av)), bs = /^-?\d+(\.\d+)?$/.test(String(bv));
            if (as && bs) return (Number(av) - Number(bv)) * dir;
            return String(av).localeCompare(String(bv), 'zh-CN') * dir;
        });
    }

    function applyFilters(rows, opts) {
        var o = opts || {};
        if (o.where) rows = rows.filter(o.where);
        if (o.search) {
            var q = String(o.search).toLowerCase();
            var fields = o.searchFields && o.searchFields.length ? o.searchFields : null;
            rows = rows.filter(function (r) {
                var keys = fields || Object.keys(r);
                for (var i = 0; i < keys.length; i++) {
                    var v = r[keys[i]];
                    if (v != null && typeof v !== 'object' && String(v).toLowerCase().indexOf(q) > -1) return true;
                }
                return false;
            });
        }
        if (o.filters) {
            Object.keys(o.filters).forEach(function (k) {
                var val = o.filters[k];
                if (val === '' || val == null) return;
                rows = rows.filter(function (r) { return String(r[k]) === String(val); });
            });
        }
        return rows;
    }

    function list(name, opts) {
        var o = opts || {};
        var rows = applyFilters(col(name), o);
        rows = applySort(rows, o.sort);
        var total = rows.length;
        var pageSize = o.pageSize === 0 ? 0 : (o.pageSize || cfg.pageSize);
        var page = Math.max(1, o.page || 1);
        var pages = pageSize ? Math.max(1, Math.ceil(total / pageSize)) : 1;
        if (pageSize) rows = rows.slice((page - 1) * pageSize, page * pageSize);
        return { rows: rows, total: total, page: page, pages: pages, pageSize: pageSize };
    }

    function find(name, predicate) {
        return col(name).filter(predicate || function (r) { return r; });
    }

    function findOne(name, predicate) {
        var rows = col(name);
        for (var i = 0; i < rows.length; i++) if (predicate(rows[i])) return rows[i];
        return null;
    }

    function create(name, row, options) {
        var opts = options || {};
        load();
        var meta = COLLECTIONS[name] || {};
        var record = row || {};
        // id:false：只追加、从不按主键回查的流水（扫描轨迹）不必背单据号，全库可省 ~100KB
        if (!record.id && opts.id !== false) record.id = opts.id || TMS.ids.next(name, meta.prefix);
        /* 稀疏落库：空串/空值不写存储位——localStorage 是唯一持久层，行体积直接决定可回放天数；
           读取端统一 `x || ''` 兜底，语义等同数据库可空列 */
        if (opts.sparse !== false) {
            Object.keys(record).forEach(function (k) {
                if (record[k] === '' || record[k] === null || record[k] === undefined) delete record[k];
            });
        }
        if (opts.stamp !== false && !record.createdAt) record.createdAt = util.iso(util.now());
        col(name).push(record);
        bump(name);
        return record;
    }

    function update(name, id, patch) {
        var row = get(name, id);
        if (!row) return null;
        Object.keys(patch || {}).forEach(function (k) {
            // null = 清除字段（与 create 的稀疏落库同一约定），空串则原样写入
            if (patch[k] === null || patch[k] === undefined) delete row[k];
            else row[k] = patch[k];
        });
        // 台账行的业务时间就是 date/createdAt，再盖一个 updatedAt 只是把每行撑胖 20 字符
        if (!(COLLECTIONS[name] || {}).noTouch) row.updatedAt = util.iso(util.now());
        return row;
    }

    function remove(name, id) {
        delete idMaps[name];
        bump(name);
        var rows = col(name);
        for (var i = 0; i < rows.length; i++) {
            if (rows[i].id === id) { rows.splice(i, 1); return true; }
        }
        return false;
    }

    function removeWhere(name, predicate) {
        delete idMaps[name];
        bump(name);
        var rows = col(name);
        var kept = rows.filter(function (r) { return !predicate(r); });
        var removed = rows.length - kept.length;
        db.data[name] = kept;
        return removed;
    }

    /* 批量写入：领域动作往往一次改多张表，合并成一次落盘 + 一次刷新 */
    /* 批量事务：深度 >0 时 persist 只标脏，退出时统一落盘一次 */
    function batch(fn, reason) {
        if (!db) load();
        batchDepth++;
        var result;
        try { result = fn(api); } catch (err) {
            batchDepth--;
            if (console) console.error('[TMS] 批量写入异常：', err);
            throw err;
        }
        batchDepth--;
        if (batchDepth === 0) {
            persist(reason || 'batch');
            notify('data:change', { reason: reason || 'batch', scope: 'all' });
        }
        return result;
    }

    function touch(entity) {
        if (entity) { delete idMaps[entity]; bump(entity); }
        dirty = true;
    }

    function commit(name, id, reason) {
        load();
        persist(reason || (name + ':' + (id || '')));
        notify('data:change', { reason: reason || 'commit', entity: name, id: id });
    }

    function counters() { return load().counters; }

    var api = {
        COLLECTIONS: COLLECTIONS,
        load: load, reload: reload, reset: reset, reseed: reseed, isSeeded: isSeeded,
        persist: persist, commit: commit, batch: batch,
        col: col, get: get, list: list, find: find, findOne: findOne,
        create: create, update: update, remove: remove, removeWhere: removeWhere,
        counters: counters, sizeBytes: sizeBytes, trimRows: trimRows, touch: touch, batchDepth: function () { return batchDepth; },
        rev: function (name) { return revisions[name] || 0; },
        archiveStats: function () { return archived.slice(); },
        meta: function (name) { return COLLECTIONS[name] || {}; },
        info: function () {
            var out = { bytes: sizeBytes(), schema: db ? db.schema : 0, seededAt: db ? db.seededAt : '', rows: {}, total: 0 };
            Object.keys(COLLECTIONS).forEach(function (k) {
                var n = db && db.data[k] ? db.data[k].length : 0;
                out.rows[k] = n; out.total += n;
            });
            return out;
        }
    };

    TMS.db = api;
})(window);
