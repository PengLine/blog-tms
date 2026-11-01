/* 临时：定位重复单号的订单 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
global.__s = new Map();
global.localStorage = { getItem: (k) => (global.__s.has(k) ? global.__s.get(k) : null), setItem: (k, v) => global.__s.set(k, String(v)), removeItem: (k) => global.__s.delete(k), clear: () => global.__s.clear() };
global.addEventListener = () => {};
global.location = { href: '', replace() {}, search: '' };
global.document = { currentScript: { getAttribute: () => 'js/boot.js?v=x' }, addEventListener: () => {}, querySelector: () => null, createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {}, addEventListener() {} }), body: { appendChild() {} } };
global.window = global;
['js/core/config.js', 'js/core/utils.js', 'js/core/bus.js', 'js/core/db.js', 'js/core/ids.js',
 'js/core/auth.js', 'js/core/rbac.js', 'js/data/master.js', 'js/domain/pricing.js', 'js/domain/network.js',
 'js/data/seed.js', 'js/domain/order.js', 'js/domain/operation.js', 'js/domain/finance.js', 'js/domain/service.js',
 'js/domain/people.js', 'js/domain/stats.js', 'js/domain/audit.js', 'js/domain/jobs.js'].forEach((rel) => {
    vm.runInThisContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), { filename: rel });
});
const TMS = global.TMS;
TMS.db.load();
if (!TMS.db.isSeeded()) TMS.db.reseed();
const orders = TMS.db.col('orders');
const seen = new Map();
orders.forEach((o, idx) => {
    if (seen.has(o.id)) console.log('重复订单号', o.id, 'idx', seen.get(o.id), idx);
    else seen.set(o.id, idx);
});
console.log('订单行数', orders.length, '唯一', seen.size);
const wb = orders.map((o) => o.waybillNo).filter(Boolean);
console.log('运单号', wb.length, '唯一', new Set(wb).size);
['orders', 'transports', 'scans', 'finances', 'receivables', 'payables', 'bills', 'exceptions', 'tickets',
    'claims', 'performances', 'clockRecords', 'codRecords', 'rateCards', 'routes', 'shifts', 'invoices', 'rechecks'].forEach((n) => {
    const rows = TMS.db.col(n);
    const ids = rows.map((r) => r.id).filter(Boolean);
    const u = new Set(ids).size;
    if (ids.length !== u) console.log('!! 主键重复', n, ids.length, '->', u);
});
console.log('扫描', TMS.db.col('scans').length);
