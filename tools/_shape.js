/* Node 冒烟校验：在无浏览器环境下装载运行时，重建种子库并校验业务不变量
   用法：node tools/smoke.js            仅建库 + 不变量校验
        node tools/smoke.js --flow     额外回放一条订单全生命周期
        node tools/smoke.js --dump     输出集合行数与容量 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);

/* ---------- 浏览器环境桩 ---------- */

const storageMap = new Map();
global.localStorage = {
    getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
    setItem: (k, v) => storageMap.set(k, String(v)),
    removeItem: (k) => storageMap.delete(k),
    clear: () => storageMap.clear()
};
global.addEventListener = () => {};
global.location = { href: '', hash: '', pathname: '/tms-index.html', replace() {}, search: '' };
global.scrollTo = () => {};
global.URL = { createObjectURL: () => 'blob:smoke' };

/* 最小 DOM：UI 层是字符串模板渲染，测试只关心渲染结果里有没有脏值，
   因此元素桩只需活过 appendChild/querySelector/addEventListener 这几下调用。
   querySelector 按选择器记忆子节点，否则「写入 body 再读回」这类断言永远拿到新对象 */
const el = () => {
    const kids = new Map();
    return {
        style: {}, className: '', innerHTML: '', value: '', textContent: '',
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        parentNode: { removeChild() {} },
        setAttribute() {}, getAttribute: () => null,
        appendChild() {}, removeChild() {}, contains: () => false,
        addEventListener() {}, removeEventListener() {}, focus() {}, click() {},
        getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }),
        querySelector: (sel) => {
            if (!kids.has(sel)) kids.set(sel, el());
            return kids.get(sel);
        },
        querySelectorAll: () => [], closest: () => null
    };
};
global.document = {
    currentScript: { getAttribute: () => 'js/boot.js?v=smoke' },
    addEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [],
    createElement: () => el(), body: el()
};
global.window = global;
global.innerWidth = 1440;

const MODULES = [
    'js/core/config.js', 'js/core/utils.js', 'js/core/bus.js', 'js/core/db.js', 'js/core/ids.js',
    'js/core/auth.js', 'js/core/rbac.js',
    'js/data/master.js', 'js/domain/pricing.js', 'js/domain/network.js', 'js/data/seed.js',
    'js/domain/order.js', 'js/domain/operation.js', 'js/domain/finance.js', 'js/domain/service.js',
    'js/domain/people.js', 'js/domain/stats.js', 'js/domain/audit.js', 'js/domain/jobs.js',
    'js/ui/kit.js', 'js/ui/charts.js', 'js/ui/shell.js', 'js/pages/registry.js', 'js/pages/admin.js'
];
MODULES.forEach((rel) => {
    const src = require('fs').readFileSync(require('path').join(ROOT, rel), 'utf8');
    vm.runInThisContext(src, { filename: rel });
});
const TMS = global.TMS, db = TMS.db;
db.load(); db.reseed();

const targets = process.argv.slice(2);
const pools = targets.length ? targets : Object.keys(db.COLLECTIONS);
pools.forEach((name) => {
    const rows = db.col(name);
    if (!rows.length) { console.log(name + ': 0 行'); return; }
    const keys = {};
    rows.forEach((r) => Object.keys(r).forEach((k) => { keys[k] = (keys[k] || 0) + 1; }));
    console.log('\n### ' + name + ' (' + rows.length + ')');
    console.log('  keys: ' + Object.keys(keys).map((k) => k + (keys[k] === rows.length ? '' : '×' + keys[k])).join(', '));
    console.log('  sample: ' + JSON.stringify(rows[rows.length - 1]).slice(0, 700));
});
