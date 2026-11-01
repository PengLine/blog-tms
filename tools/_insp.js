/* 临时：查看单行体积构成 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
global.localStorage = { getItem: (k) => (global.__s.has(k) ? global.__s.get(k) : null), setItem: (k, v) => global.__s.set(k, String(v)), removeItem: (k) => global.__s.delete(k), clear: () => global.__s.clear() };
global.__s = new Map();
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
const o = TMS.db.col('orders').filter((r) => r.status === 'signed')[0];
const rows = Object.entries(o).map(([k, v]) => ({ k, c: JSON.stringify(v).length })).sort((a, b) => b.c - a.c);
console.log(JSON.stringify(o, null, 1).slice(0, 3000));
console.log('合计字符', JSON.stringify(o).length);
console.log(rows.map((r) => `${r.k}=${r.c}`).join(' '));
const avg = (name) => { const c = TMS.db.col(name); if (!c.length) return; const tot = JSON.stringify(c).length; console.log(`${name}: ${c.length} 行 / 均 ${Math.round(tot / c.length)} 字符`); };
['orders', 'scans', 'finances', 'receivables', 'payables', 'transports', 'employees', 'points', 'rateCards', 'shifts', 'clockRecords', 'performances', 'tickets', 'codRecords'].forEach(avg);
const keyCount = {};
TMS.db.col('orders').forEach((r) => Object.keys(r).forEach((k) => { keyCount[k] = (keyCount[k] || 0) + 1; }));
console.log('订单字段出现次数：', JSON.stringify(keyCount));
const sw = {};
TMS.db.col('orders').forEach((r) => Object.keys(r.fees || {}).forEach((k) => { sw[k] = (sw[k] || 0) + 1; }));
console.log('fees 键：', JSON.stringify(sw));
const cw = {};
TMS.db.col('orders').forEach((r) => Object.keys(r.cost || {}).forEach((k) => { cw[k] = (cw[k] || 0) + 1; }));
console.log('cost 键：', JSON.stringify(cw));
const one = (name) => {
    const c = TMS.db.col(name);
    if (!c.length) return;
    console.log('==== ' + name + ' 均 ' + Math.round(JSON.stringify(c).length / c.length) + ' 字符');
    console.log(JSON.stringify(c[c.length - 1]));
    const census = {};
    c.forEach((r) => Object.keys(r).forEach((k) => { census[k] = (census[k] || 0) + 1; }));
    console.log('字段数', Object.keys(census).length, JSON.stringify(census));
};
const which = process.argv.slice(2);
which.forEach(one);
