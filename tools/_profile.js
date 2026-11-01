/* 临时诊断脚本（用完删除）：按集合与字段统计字符占用 */
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
const db = TMS.db;

db.load();
db.reseed();

const info = db.info();
console.log(`建库 ${info.total} 行 / ${(info.bytes / 1024).toFixed(0)} KB（软上限 ${(TMS.cfg.storage.softLimitBytes / 1024).toFixed(0)} KB）`);

const rows = Object.keys(info.rows)
    .filter((k) => info.rows[k])
    .map((k) => {
        const col = db.col(k);
        const chars = JSON.stringify(col).length;
        return { name: k, n: col.length, chars, per: chars / Math.max(1, col.length) };
    })
    .sort((a, b) => b.chars - a.chars);
let sum = 0;
rows.forEach((r) => { sum += r.chars; });
console.log('\n集合字符占用（KB chars / 行数 / 单行均 chars）');
rows.forEach((r) => console.log(`  ${r.name.padEnd(18)} ${(r.chars / 1024).toFixed(0).padStart(6)}  ${String(r.n).padStart(5)}  ${r.per.toFixed(0).padStart(5)}`));
console.log(`  合计 ${(sum / 1024).toFixed(0)} KB chars`);

function prof(name, top) {
    const rs = db.col(name);
    if (!rs.length) return;
    const acc = {};
    rs.forEach((r) => Object.keys(r).forEach((k) => {
        const v = r[k];
        const s = v == null ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
        acc[k] = (acc[k] || 0) + s.length + k.length + 4;
    }));
    console.log(`\n== ${name} (${rs.length} 行) 字段 chars ==`);
    Object.entries(acc).sort((a, b) => b[1] - a[1]).slice(0, top || 16)
        .forEach(([k, v]) => console.log(`   ${k.padEnd(18)} ${(v / 1024).toFixed(1)} KB  均 ${(v / rs.length).toFixed(0)} B`));
}
['orders', 'scans', 'finances', 'transports', 'sortingTasks', 'loadingTasks', 'clockRecords',
    'performances', 'shifts', 'employees', 'receivables', 'payables', 'points', 'codRecords',
    'bills', 'exceptions', 'auditLogs', 'customers', 'branches', 'hubs', 'trips', 'rateCards'].forEach((n) => prof(n, 12));
