/* 临时诊断脚本（用完删除）：定位环节时间倒挂与车次装载不一致 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

const storageMap = new Map();
global.localStorage = {
    getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
    setItem: (k, v) => storageMap.set(k, String(v)),
    removeItem: (k) => storageMap.delete(k),
    clear: () => storageMap.clear()
};
global.addEventListener = () => {};
global.location = { href: '', replace() {}, search: '' };
global.document = {
    currentScript: { getAttribute: () => 'js/boot.js?v=smoke' },
    addEventListener: () => {}, querySelector: () => null,
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {}, addEventListener() {} }),
    body: { appendChild() {} }
};
global.window = global;

const MODULES = [
    'js/core/config.js', 'js/core/utils.js', 'js/core/bus.js', 'js/core/db.js', 'js/core/ids.js',
    'js/core/auth.js', 'js/core/rbac.js',
    'js/data/master.js', 'js/domain/pricing.js', 'js/domain/network.js', 'js/data/seed.js',
    'js/domain/order.js', 'js/domain/operation.js', 'js/domain/finance.js', 'js/domain/service.js',
    'js/domain/people.js', 'js/domain/stats.js', 'js/domain/audit.js', 'js/domain/jobs.js'
];

MODULES.forEach((rel) => {
    vm.runInThisContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), { filename: path.join(ROOT, rel) });
});

const TMS = global.TMS;
const db = TMS.db, util = TMS.util;
db.load();

const TARGET = process.env.TARGET || 'HLHB2026101907640864';
const rawCreate = TMS.db.create;
TMS.db.create = function (name, row, opts) {
    if (name === 'scans' && row && row.orderId === TARGET) {
        const st = new Error().stack.split('\n').slice(2, 30)
            .map((s) => s.trim().replace(/^at\s+/, ''))
            .join('\n         ');
        console.log(`SCAN ${String(row.node).padEnd(10)} ${row.opTime} now=${util.iso(TMS.util.now())} ::\n         ${st}`);
    }
    return rawCreate.call(this, name, row, opts);
};
const TRIP = process.env.TRIP || TARGET_TRIP;
const rawStart = TMS.operation.startTransport;
TMS.operation.startTransport = function (id, data) {
    if (id === TRIP) {
        const t = db.get('transports', id) || {};
        console.log(`START ${id} param.at=${data && data.at} now=${util.iso(util.now())} trip.date=${t.date} createdAt=${t.createdAt} departAt=${t.departAt} 挂单=${TMS.operation.ordersOfTrip(id).map((x) => x.id + '@' + x.status).join(' ')}`);
    }
    return rawStart.call(this, id, data);
};
let lastNow = 0;
const rawMove = TMS.order.moveTo;
TMS.order.moveTo = function (orderId, status, opts) {
    if (orderId === TARGET) {
        const o = db.get('orders', orderId) || {};
        console.log(`MOVE ${String(status).padEnd(11)} from=${o.status} opt.at=${opts && opts.at} updatedAt=${o.updatedAt} now=${util.iso(util.now())}`);
    }
    return rawMove.call(this, orderId, status, opts);
};
const rawSetNow = TMS.util.setNow;
TMS.util.setNow = function (d) {
    const t = util.toDate(d).getTime();
    if (t < lastNow - 1) {
        const st = new Error().stack.split('\n').slice(2, 10)
            .map((s) => (s.match(/(\w+\.js):(\d+)/) || []).slice(1).join(':'))
            .filter(Boolean).join(' <- ');
        console.log(`BACKWARD ${new Date(lastNow).toISOString()} -> ${new Date(t).toISOString()} :: ${st}`);
    }
    if (t > lastNow) lastNow = t;
    return rawSetNow.call(this, d);
};
global.DBG = TARGET;
db.reseed();

const STAGES = ['collected', 'inbound', 'sorted', 'transit', 'arrived', 'delivering', 'signed'];

const bad = db.col('orders').filter((o) => {
    const seq = STAGES.map((k) => TMS.order.stageAt(o, k)).filter(Boolean).map((t) => util.toDate(t).getTime());
    for (let i = 1; i < seq.length; i++) if (seq[i] < seq[i - 1]) return true;
    return false;
});
console.log(`环节倒挂 ${bad.length} 单`);
bad.forEach((o) => {
    console.log(`\n— ${o.id} ${o.status} ${o.origin}→${o.destination} trip=${o.tripId}`);
    STAGES.forEach((k) => console.log(`   ${k.padEnd(11)} ${TMS.order.stageAt(o, k) || '-'}`));
    const tr = o.tripId ? db.get('transports', o.tripId) : null;
    if (tr) console.log(`   车次 ${tr.id} date=${tr.date} departAt=${tr.departAt} actualDepartAt=${tr.actualDepartAt} actualArriveAt=${tr.actualArriveAt} status=${tr.status}`);
    console.log('   轨迹：');
    db.col('scans').filter((s) => s.orderId === o.id).forEach((s) => {
        console.log(`     ${s.opTime}  ${String(s.node).padEnd(10)} ${s.location || ''} ${s.operator || ''}`);
    });
});

const mismatch = db.col('transports').filter((t) => {
    const rows = TMS.operation.ordersOfTrip(t.id);
    return rows.length !== t.orders || Math.abs(util.round(util.sum(rows, 'chargeableWeight'), 2) - t.weight) > 0.01;
});
console.log(`\n装载不一致 ${mismatch.length} 车次`);
mismatch.forEach((t) => {
    const rows = TMS.operation.ordersOfTrip(t.id);
    console.log(`— ${t.id} ${t.fromHub}→${t.toHub} ${t.dispatchType} status=${t.status} 存 orders=${t.orders} weight=${t.weight} 反查 ${rows.length} 单 / ${util.round(util.sum(rows, 'chargeableWeight'), 2)}kg`);
    const ids = rows.map((r) => r.id);
    console.log('   挂单：' + ids.join(', '));
});
