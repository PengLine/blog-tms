/* 临时诊断脚本（用完删除）：统计各集合字段出现次数，用于设计行压缩字段序 */
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

const targets = process.argv.slice(2);
Object.keys(db.info().rows).forEach((name) => {
    const rows = db.col(name);
    if (!rows.length) return;
    if (targets.length && targets.indexOf(name) < 0) return;
    const counts = {};
    let objish = 0;
    rows.forEach((r) => Object.keys(r).forEach((k) => {
        counts[k] = (counts[k] || 0) + 1;
        if (r[k] && typeof r[k] === 'object') objish++;
    }));
    const keys = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    const chars = keys.reduce((s, k) => s + (counts[k] / rows.length) * (k.length + 3), 0);
    console.log(`\n== ${name} (${rows.length} 行) 字段名开销 ${Math.round(chars)} 字符/行${objish ? ' [含对象字段 ' + objish + ']' : ''}`);
    console.log('   ' + keys.map((k) => `${k}:${Math.round(counts[k] / rows.length * 100)}%`).join('  '));
});
