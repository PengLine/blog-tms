/* 临时诊断脚本（用完删除）：自有车次装载与成本结构 */
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
db.reseed();

const op = TMS.operation;
const trips = db.col('transports');
const self = trips.filter((t) => t.dispatchType !== 'ltl');
const ltl = trips.filter((t) => t.dispatchType === 'ltl');
console.log(`车次 ${trips.length}：自有 ${self.length} / 外协 ${ltl.length}`);

const byType = {};
self.forEach((t) => {
    const cap = op.capacityOf(t) || 0;
    const k = (t.vehicleTypeCode || op.vehicleTypeOf(t) || '?') + '|' + (t.toCity ? '支线' : '干线');
    byType[k] = byType[k] || { n: 0, kg: 0, cap: 0, cost: 0, km: 0, load: 0 };
    const b = byType[k];
    b.n++; b.kg += t.weight; b.cap += cap; b.cost += op.costTotal(t); b.km += (t.cost || {}).km || 0;
    b.load += cap ? t.weight / cap : 0;
});
console.log('\n车型|线路  车次  均重kg  均载重kg  装载率  均里程km  均成本¥  ¥/kg');
Object.keys(byType).sort((a, b) => byType[b].n - byType[a].n).forEach((k) => {
    const b = byType[k];
    console.log(`  ${k.padEnd(14)} ${String(b.n).padStart(4)}  ${Math.round(b.kg / b.n)}  ${Math.round(b.cap / b.n)}  ${(b.load / b.n * 100).toFixed(1)}%  ${Math.round(b.km / b.n)}  ${Math.round(b.cost / b.n)}  ${(b.cost / Math.max(1, b.kg)).toFixed(2)}`);
});

console.log('\n自有车次明细（按装载率升序前 15）：');
util.sortBy(self.map((t) => {
    const cap = op.capacityOf(t) || 0;
    return { id: t.id, type: op.vehicleTypeOf(t), mode: t.mode, feeder: !!t.toCity, kg: t.weight, cap: cap, rate: cap ? Math.round(t.weight / cap * 100) : 0, km: (t.cost || {}).km, cost: op.costTotal(t), orders: t.orders };
}), 'rate', 'asc').slice(0, 15).forEach((r) => console.log('  ' + JSON.stringify(r)));

console.log('\n外协车次：均重 ' + Math.round(ltl.reduce((s, t) => s + t.weight, 0) / ltl.length) +
    'kg 均成本 ¥' + Math.round(ltl.reduce((s, t) => s + op.costTotal(t), 0) / ltl.length));

// 车辆池状态
const vs = {};
db.col('vehicles').forEach((v) => { vs[v.status + '/' + v.typeCode] = (vs[v.status + '/' + v.typeCode] || 0) + 1; });
console.log('\n车辆池：' + JSON.stringify(vs));

// 每单成本口径
const signed = db.col('orders').filter((o) => o.status === 'signed');
const costs = signed.map((o) => TMS.pricing.costOf(o, TMS.network.planOf(o)));
const avg = (arr) => Math.round(arr.reduce((s, x) => s + x, 0) / arr.length * 100) / 100;
console.log('\n签收单成本：合计 ' + avg(costs.map((c) => c.tot)) + ' 干线 ' + avg(costs.map((c) => c.lh)) +
    ' 中转 ' + avg(costs.map((c) => c.hd)) + ' 揽收 ' + avg(costs.map((c) => c.cl)) +
    ' 分拣 ' + avg(costs.map((c) => c.sc)) + ' 派送 ' + avg(costs.map((c) => c.dl)) +
    ' 包材 ' + avg(costs.map((c) => c.pk)) + ' 间接 ' + avg(costs.map((c) => c.oh)));
console.log('签收单均运费 ¥' + avg(signed.map((o) => Number(o.freight))) + ' 均计费重 ' + avg(signed.map((o) => Number(o.chargeableWeight))) + 'kg');

const buckets = [[0, 10], [10, 30], [30, 80], [80, 300], [300, 1000], [1000, 1e9]];
buckets.forEach(([lo, hi]) => {
    const rows = signed.map((o, i) => ({ o, c: costs[i] })).filter((x) => x.o.chargeableWeight >= lo && x.o.chargeableWeight < hi);
    if (!rows.length) return;
    const s = (f) => rows.reduce((a, x) => a + f(x), 0) / rows.length;
    console.log(`  ${String(lo + '-' + (hi > 1e8 ? '∞' : hi)).padEnd(9)} n=${String(rows.length).padStart(3)} 均重 ${s((x) => x.o.chargeableWeight).toFixed(0)}kg 里程 ${s((x) => x.c.tp).toFixed(0)}km 运费 ¥${s((x) => Number(x.o.freight)).toFixed(0)}(¥${s((x) => Number(x.o.freight) / x.o.chargeableWeight).toFixed(2)}/kg) 成本 ¥${s((x) => x.c.tot).toFixed(0)} 干线 ¥${s((x) => x.c.lh).toFixed(0)} 毛利 ${s((x) => x.c.mg).toFixed(1)}%`);
});
console.log('车次分摊口径：自有 ' + costs.filter((c) => c.bs === 1).length +
    ' 外协 ' + costs.filter((c) => c.bs === 2).length + ' 标准价兜底 ' + costs.filter((c) => !c.bs).length);

const out = signed.map((o, i) => ({ o, c: costs[i] })).filter((x) => x.c.mg > 75 || x.c.mg < -40);
console.log('\n单票毛利异常 ' + out.length + ' 笔：');
out.slice(0, 12).forEach((x) => console.log(`  ${x.o.id} ${x.o.service} ${x.o.chargeableWeight}kg ${x.c.tp}km 运费¥${x.o.freight} 成本¥${x.c.tot}(干线${x.c.lh}/中转${x.c.hd}/派送${x.c.dl}) 车${x.o.tripId} bs=${x.c.bs} 毛利${x.c.mg}%`));
const hi = out.filter((x) => x.c.mg > 75), lo = out.filter((x) => x.c.mg < -40);
console.log('  >75%: ' + hi.length + '  <-40%: ' + lo.length);
console.log('  存储口径异常 ' + signed.filter((o) => { const m = TMS.pricing.marginOf(o); return m > 75 || m < -40; }).length);

const STAGES = ['collected', 'inbound', 'sorted', 'transit', 'arrived', 'delivering', 'signed'];
const sidx = TMS.order.scanIndex();
const badTime = db.col('orders').filter((o) => {
    const seq = STAGES.map((k) => TMS.order.stageAt(o, k, sidx[o.id])).filter(Boolean).map((t) => util.toDate(t).getTime());
    for (let i = 1; i < seq.length; i++) if (seq[i] < seq[i - 1]) return true;
    return false;
});
console.log('\n环节时间倒挂 ' + badTime.length + ' 单：');
badTime.forEach((o) => {
    console.log('  ' + o.id + ' 状态' + o.status + ' 车' + (o.tripId || '-'));
    STAGES.forEach((k) => { const t = TMS.order.stageAt(o, k, sidx[o.id]); if (t) console.log('     ' + k.padEnd(11) + t); });
    const tr = o.tripId ? db.get('transports', o.tripId) : null;
    if (tr) console.log('     车次 ' + tr.id + ' createdAt=' + tr.createdAt + ' departAt=' + tr.departAt + ' actualDepartAt=' + tr.actualDepartAt + ' status=' + tr.status);
    (sidx[o.id] || []).forEach((s) => console.log('     scan ' + String(s.node).padEnd(10) + s.opTime + ' dev=' + (s.device || '')));
});
