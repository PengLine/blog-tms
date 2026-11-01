/* 临时脚本：打印每个集合的样例行字段，供页面开发对齐字段名（收尾时删除） */
'use strict';
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');

global.require = require;
global.__dirname = path.join(ROOT, 'tools');
const src = fs.readFileSync(path.join(ROOT, 'tools/smoke.js'), 'utf8');
vm.runInThisContext(src.slice(0, src.indexOf('/* ---------- 建库 ----------')), { filename: 'smoke-head.js' });
const TMS = global.TMS;
TMS.db.load();
if (!TMS.db.isSeeded()) TMS.db.reseed();
const db = TMS.db;

const want = process.argv[2] ? process.argv[2].split(',') : null;
Object.keys(db.COLLECTIONS).forEach((name) => {
    if (want && want.indexOf(name) < 0) return;
    const rows = db.col(name);
    if (!rows.length) { console.log('\n### ' + name + '  （空表）'); return; }
    const keys = {};
    rows.slice(0, 40).forEach((r) => Object.keys(r).forEach((k) => {
        const v = r[k];
        keys[k] = Array.isArray(v) ? '[' + (v[0] && typeof v[0] === 'object' ? JSON.stringify(v[0]).slice(0, 90) : v[0]) + ']'
            : (v && typeof v === 'object' ? JSON.stringify(v).slice(0, 90) : String(v).slice(0, 42));
    }));
    console.log('\n### ' + name + '  ×' + rows.length + '\n' +
        Object.keys(keys).map((k) => k + '=' + keys[k]).join(' | '));
});
