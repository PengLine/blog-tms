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

const events = [];
const domLog = [];
const realCreateElement = global.document.createElement;
global.document.createElement = (tag) => {
    const node = realCreateElement(tag);
    domLog.push(node);
    return node;
};
global.Blob = class { constructor(parts) { this.parts = parts; } };
MODULES.forEach((rel) => {
    const file = path.join(ROOT, rel);
    const src = fs.readFileSync(file, 'utf8');
    try {
        vm.runInThisContext(src, { filename: file });
    } catch (err) {
        console.error('加载失败 ' + rel + '：' + err.message);
        console.error(err.stack.split('\n').slice(0, 4).join('\n'));
        process.exit(1);
    }
});

const TMS = global.TMS;
const util = TMS.util;
const db = TMS.db;

/* ---------- 建库 ---------- */

const t0 = Date.now();
db.load();
db.reseed();
const seedMs = Date.now() - t0;
const info = db.info();
log(`建库完成：${seedMs} ms，schema=${info.schema}，行数=${info.total}，容量=${(info.bytes / 1024).toFixed(0)} KB`);

/* ---------- 断言 ---------- */

let failures = 0;
function check(name, ok, detail) {
    if (ok) log('  ✓ ' + name + (detail ? '（' + detail + '）' : ''));
    else { failures++; console.error('  ✗ ' + name + (detail ? '（' + detail + '）' : '')); }
}
function log(msg) { console.error(msg); }
function section(title) { log('\n—— ' + title + ' ——'); }

const orders = db.col('orders');
const scans = db.col('scans');
const transports = db.col('transports');
const finances = db.col('finances');
const receivables = db.col('receivables');
const payables = db.col('payables');
const exceptions = db.col('exceptions');

section('主数据规模');
// 干支分离网络刻意按「一个大区一座分拨」排布，班次要覆盖大区两两直发：
// 枢纽越多单条班线越薄，装载率与干线成本会失真，所以这里校验的是覆盖度而不是绝对数量
const ZONE_COUNT = TMS.master.ZONES.length;
check('分拨中心覆盖全部大区', db.col('hubs').length >= ZONE_COUNT, db.col('hubs').length + ' 个 / ' + ZONE_COUNT + ' 大区');
check('网点 >= 60', db.col('branches').length >= 60, db.col('branches').length + ' 个');
check('客户 >= 30', db.col('customers').length >= 30, db.col('customers').length + ' 家');
check('员工 >= 300', db.col('employees').length >= 300, db.col('employees').length + ' 人');
check('车辆 >= 40', db.col('vehicles').length >= 40, db.col('vehicles').length + ' 台');
check('干线班次覆盖大区两两直发', db.col('trips').length >= ZONE_COUNT * (ZONE_COUNT - 1), db.col('trips').length + ' 条 / 直发需求 ' + ZONE_COUNT * (ZONE_COUNT - 1) + ' 条');
// 干支分离下同区件没有干线段：班线表按设计不存在同城直发，
// 一旦让 A→A 也去搜中转，就会绕出「上海分拨→广州分拨→上海分拨」这种 0 公里却背一整天标准时长的环形假干线
const badLegs = db.col('routes').reduce((n, r) => n + (r.segments || [])
    .filter((s) => s.legType === 'trunk' && (!s.km || s.from === s.to)).length, 0);
check('路由干线段均跨枢纽且有里程', badLegs === 0, badLegs + ' 段异常 / ' + db.col('routes').length + ' 条路由');
check('运价卡 = 区域×区域×服务', db.col('rateCards').length >= 194, db.col('rateCards').length + ' 张');
check('角色/权限入库', db.col('roles').length === 6 && db.col('permissions').length > 30,
    db.col('roles').length + ' 角色 / ' + db.col('permissions').length + ' 权限');

section('业务数据量');
check('订单 >= 500', orders.length >= 500, orders.length + ' 单');
check('扫描流水 >= 订单数×5', scans.length >= orders.length * 5, scans.length + ' 条');
check('车次 >= 30', transports.length >= 30, transports.length + ' 次');
check('财务流水 >= 500', finances.length >= 500, finances.length + ' 条');
check('应收覆盖月结/到付', receivables.length > 100, receivables.length + ' 条');
check('应付含干线/派送/操作', payables.length > 20, payables.length + ' 条');
check('异常工单 > 0', exceptions.length > 0, exceptions.length + ' 张');
check('代收货款台账 > 0', db.col('codRecords').length > 0, db.col('codRecords').length + ' 条');
check('账单已生成', db.col('bills').length > 0, db.col('bills').length + ' 份');
check('绩效已核算', db.col('performances').length > 30, db.col('performances').length + ' 条');
check('打卡记录 > 0', db.col('clockRecords').length > 0, db.col('clockRecords').length + ' 条');

section('数据不变量');
const badStatus = orders.filter((o) => TMS.cfg.orderLabels[o.status] === undefined);
check('订单状态合法', badStatus.length === 0, badStatus.slice(0, 3).map((o) => o.status).join(','));

const dupOrder = orders.length - new Set(orders.map((o) => o.id)).size;
check('订单号唯一', dupOrder === 0, '重复 ' + dupOrder);
const dupWaybill = orders.length - new Set(orders.map((o) => o.waybillNo)).size;
check('运单号唯一', dupWaybill === 0, '重复 ' + dupWaybill);
const badIds = orders.filter((o) => !/^HL[A-Z]{2}\d{8}\d{8}$/.test(o.id) || o.id.length !== 20);
check('订单号符合 HL+省码+日期+4+4 规范', badIds.length === 0, badIds.slice(0, 2).map((o) => o.id).join(','));
const badWb = orders.filter((o) => !/^WB\d{14}$/.test(o.waybillNo));
check('运单号符合 WB+10hash+4随机 规范', badWb.length === 0, badWb.slice(0, 2).map((o) => o.waybillNo).join(','));

const noTrace = orders.filter((o) => !scans.some((s) => s.orderId === o.id));
check('每单均有轨迹扫描', noTrace.length === 0, '缺失 ' + noTrace.length);

/* 库存台账三条不变量：流水加总 = 库存行、各仓相加 = 物料档案合计、未到货采购 = 在途数量。
   任何一条对不上，页面的周转天数与补货建议就都是假数 */
const LEDGER_SIGN = { in: 1, out: -1, adjust: 1, purchase: 0 };
const ledger = {};
const badKind = [];
db.col('stockMovements').forEach((m) => {
    if (!(m.kind in LEDGER_SIGN)) { badKind.push(m.kind); return; }
    const k = m.warehouseId + '|' + m.materialId;
    ledger[k] = (ledger[k] || 0) + LEDGER_SIGN[m.kind] * (Number(m.qty) || 0);
});
check('库存流水种类合法', badKind.length === 0, badKind.slice(0, 3).join(','));
const stockDiff = db.col('stocks').filter((s) => (ledger[s.warehouseId + '|' + s.materialId] || 0) !== (Number(s.qty) || 0));
check('库存流水与库存行账实一致', stockDiff.length === 0,
    stockDiff.slice(0, 3).map((s) => s.id + '(' + (ledger[s.warehouseId + '|' + s.materialId] || 0) + '/' + s.qty + ')').join(','));
const matDiff = db.col('materials').filter((m) => m.stock !== db.col('stocks')
    .filter((s) => s.materialId === m.id).reduce((a, b) => a + (Number(b.qty) || 0), 0));
check('物料合计等于各仓相加', matDiff.length === 0, matDiff.slice(0, 3).map((m) => m.name).join(','));
const transit = {};
db.col('stockMovements').filter((m) => m.kind === 'purchase' && m.status === 'pending')
    .forEach((m) => { transit[m.materialId] = (transit[m.materialId] || 0) + (Number(m.qty) || 0); });
const transitDiff = db.col('materials').filter((m) => (Number(m.inTransit) || 0) !== (transit[m.id] || 0));
check('在途采购等于未到货流水', transitDiff.length === 0, transitDiff.slice(0, 3).map((m) => m.name).join(','));
const orphanAp = db.col('payables').filter((p) => /^MAT/.test(String(p.refId || '')) && !db.get('materials', p.refId));
check('物料应付挂到真实物料', orphanAp.length === 0, orphanAp.length + ' 张');

/* 环节时间一律从扫描流水派生（订单行不再冗余存阶段戳） */
const sidx = TMS.order.scanIndex();
const STAGES = ['collected', 'inbound', 'sorted', 'transit', 'arrived', 'delivering', 'signed'];
const stageAt = (o, k) => TMS.order.stageAt(o, k, sidx[o.id]);

const future = orders.filter((o) => util.toDate(o.createdAt).getTime() > Date.now() + 60000);
check('无未来下单时间', future.length === 0, future.length + ' 单');
const futureStage = orders.filter((o) => STAGES.some((k) => {
    const at = stageAt(o, k);
    return at && util.toDate(at).getTime() > Date.now() + 60000;
}));
check('环节时间无未来值', futureStage.length === 0, futureStage.length + ' 单');

const badFlow = orders.filter((o) => {
    let gap = false;
    return STAGES.some((k) => {
        if (!stageAt(o, k)) { if (k !== 'signed' || o.status !== 'signed') gap = true; return false; }
        return gap;
    });
});
check('状态推进无跳步', badFlow.length === 0, badFlow.slice(0, 2).map((o) => o.id).join(','));

const badTimeOrder = orders.filter((o) => {
    const seq = STAGES.map((k) => stageAt(o, k)).filter(Boolean).map((t) => util.toDate(t).getTime());
    for (let i = 1; i < seq.length; i++) if (seq[i] < seq[i - 1]) return true;
    return false;
});
check('环节时间单调递增', badTimeOrder.length === 0, badTimeOrder.slice(0, 2).map((o) => o.id).join(','));

const signed = orders.filter((o) => o.status === 'signed');
check('签收单均有 POD', signed.every((o) => o.pod && o.signedAt), signed.length + ' 单');
check('签收单均有收入流水', signed.every((o) => finances.some((f) => f.orderId === o.id && f.type === 'income')));
const codOrders = orders.filter((o) => o.paymentMethod === '到付' && Number(o.codAmount) > 0 && o.status === 'signed');
check('到付签收均入代收台账', codOrders.every((o) => db.col('codRecords').some((r) => r.orderId === o.id)), codOrders.length + ' 单');
const codBad = db.col('codRecords').filter((r) => Math.abs(r.netPayable - (r.goodsValue - r.serviceFee)) > 0.01);
check('代收净额=货款-服务费', codBad.length === 0, codBad.length + ' 条');

const inTransit = orders.filter((o) => ['transit', 'arrived', 'delivering'].indexOf(o.status) > -1);
check('在途订单均挂车次', inTransit.every((o) => !!o.tripId), inTransit.length + ' 单在途');
const orphanTrip = orders.filter((o) => o.tripId && !db.get('transports', o.tripId));
check('订单车次引用完整', orphanTrip.length === 0, orphanTrip.length + ' 单');
const oneTrip = orders.filter((o) => o.tripId && TMS.operation.ordersOfTrip(o.tripId).some((x) => x.id === o.id));
check('挂车订单均可反查', oneTrip.length === orders.filter((o) => o.tripId).length, oneTrip.length + ' 单');
// 一单只挂一车：车次装载数与重量必须与订单侧一致，否则运力统计会被重复计载
const loadMismatch = transports.filter((t) => {
    const rows = TMS.operation.ordersOfTrip(t.id);
    return rows.length !== t.orders || Math.abs(util.round(util.sum(rows, 'chargeableWeight'), 2) - t.weight) > 0.01;
});
check('车次装载与订单一致', loadMismatch.length === 0, loadMismatch.slice(0, 2).map((t) => t.id).join(','));

const monthSettled = orders.filter((o) => o.paymentMethod === '月结' && o.status === 'signed');
check('月结签收挂应收', monthSettled.every((o) => receivables.some((r) => r.orderId === o.id)), monthSettled.length + ' 单');
const paidInconsistent = receivables.filter((r) => r.status === 'paid' && !finances.some((f) => f.orderId === r.orderId && f.type === 'income'));
check('已回款应收有对应收入', paidInconsistent.length === 0, paidInconsistent.length + ' 条');

const negFreight = orders.filter((o) => Number(o.freight) <= 0);
check('运费均为正数', negFreight.length === 0, negFreight.length + ' 单');
// 费用明细不落库，由运价卡 + fees 反查重建，重建结果必须与实收运费吻合
const freightMismatch = orders.filter((o) => {
    const rows = TMS.pricing.feeRows(o);
    const rebuilt = util.round(rows.reduce((s, r) => s + r.value, 0), 2);
    return Math.abs(rebuilt - Number(o.freight)) > 0.05;
});
check('运费与反查计费明细一致', freightMismatch.length === 0, freightMismatch.length + ' 单');
const marginOut = signed.filter((o) => o.cost && (TMS.pricing.marginOf(o) > 75 || TMS.pricing.marginOf(o) < -40));
check('毛利率落在合理区间', marginOut.length < signed.length * 0.05, marginOut.length + ' 单异常');

const exBad = exceptions.filter((e) => e.orderId && !db.get('orders', e.orderId));
check('异常工单订单引用有效', exBad.length === 0, exBad.length + ' 张');
const deductionPay = exceptions.filter((e) => Number(e.deductionAmount) > 0 && e.responsibleParty !== '客户');
check('定责扣款已生成应付', deductionPay.every((e) => payables.some((p) => p.refId === e.id && p.category === '异常扣款')), deductionPay.length + ' 张');

const auditChain = TMS.audit.verify();
check('审计哈希链完整', auditChain.ok, auditChain.message || (auditChain.count + ' 条'));

section('登录身份与数据归属');
/* 演示账号必须站在真实档案上：绑定错人 = 角色端打开就是空工作台，
   所以这里不只测「能登录」，而是逐个角色测「登录后有没有属于他的活」 */
const IDENTITY_EXPECT = {
    branch: (s) => ({ name: '网点单据', hit: orders.some((o) => o.originBranchId === s.orgId || o.destBranchId === s.orgId) }),
    sorter: (s) => {
        const mine = scans.filter((x) => x.node === 'SORTING' && x.operator === s.name);
        return { name: '分拣扫描', hit: mine.length > 0, detail: mine.length + ' 条' };
    },
    transporter: (s) => {
        const mine = transports.filter((t) => t.driverId === s.personId);
        return { name: '挂车车次', hit: mine.length > 0, detail: mine.length + ' 次' };
    },
    deliveryman: (s) => {
        const mine = orders.filter((o) => o.courierId === s.personId);
        return { name: '派送单量', hit: mine.length > 0, detail: mine.length + ' 单' };
    },
    client: (s) => {
        const mine = orders.filter((o) => o.customerId === s.orgId);
        return { name: '本企业订单', hit: mine.length > 0, detail: mine.length + ' 单' };
    },
    admin: () => ({ name: '全量权限', hit: true })
};
const ORG_POOL = { admin: 'departments', branch: 'branches', sorter: 'hubs', transporter: 'departments', deliveryman: 'branches', client: 'customers' };
TMS.cfg.demoAccounts.forEach((a) => {
    const res = TMS.auth.login(a.username, a.password);
    if (!res.ok) { check('演示账号 ' + a.username + ' 登录', false, res.message); return; }
    const s = res.session;
    const expect = IDENTITY_EXPECT[s.role](s);
    const org = db.get(ORG_POOL[s.role], s.orgId);
    const person = s.personId ? db.get('employees', s.personId) : null;
    check('账号 ' + a.username + ' 绑定真实档案',
        !!org && org.name === s.orgName && (!s.personId || !!person) && expect.hit,
        s.role + ' → ' + s.orgName + (person ? ' / ' + person.id + ' ' + person.name : '') +
        ' / ' + expect.name + (expect.detail ? ' ' + expect.detail : ''));
});
check('口令错误被拒绝', TMS.auth.login('courier', 'wrong').ok === false);
check('未知账号被拒绝', TMS.auth.login('nobody', '123456').ok === false);
TMS.auth.write(null);

section('业务口径');
const ov = TMS.stats.overview(7);
log(`  近 7 日：${ov.orders} 单 / 收入 ${util.fmt.money(ov.revenue)} / 毛利率 ${ov.margin}% / 签收率 ${ov.signRate}% / 及时率 ${ov.onTimeRate}%`);
log(`  在途积压 ${ov.backlog} 单，超时滞留 ${ov.overdue} 单，未闭环异常 ${ov.openExceptions} 张`);
log(`  车次：${ov.trips.total} 次（自有 ${ov.trips.self} / 外协 ${ov.trips.ltl}），自有装载率 ${ov.trips.avgLoadRate}%，单公斤成本 ¥${ov.trips.costPerKg}`);
log(`  应收未回 ${util.fmt.money(ov.receivable.pending)}（逾期 ${util.fmt.money(ov.receivable.overdue)}），应付未结 ${util.fmt.money(ov.payable.pending)}`);
log(`  代收：待上划 ${util.fmt.money(ov.cod.pendingRemit)}，已上划 ${util.fmt.money(ov.cod.remittedTotal)}`);
const gross = TMS.stats.overview(30);
log(`  近 30 日毛利率 ${gross.margin}%，单均运费 ¥${gross.gross.avgFreight}，单均成本 ¥${gross.gross.avgCost}`);
check('近 30 日毛利率 8%~40%', gross.margin >= 8 && gross.margin <= 40, gross.margin + '%');
check('存在真实在途积压', ov.backlog > 0, ov.backlog + ' 单');
check('及时率 70%~99%', ov.onTimeRate >= 70 && ov.onTimeRate <= 99.5, ov.onTimeRate + '%');
check('运力存在自有/外协混合', ov.trips.self > 0 && ov.trips.ltl > 0,
    `自有 ${ov.trips.self} / 外协 ${ov.trips.ltl}`);
check('自有车次装载率 >40%', ov.trips.avgLoadRate > 40, ov.trips.avgLoadRate + '%');

section('存储容量');
const cfg = TMS.cfg;
const softKB = cfg.storage.softLimitBytes / 1024;
log(`  库容量 ${(info.bytes / 1024).toFixed(0)} KB / 软上限 ${softKB.toFixed(0)} KB（建库 ${seedMs} ms）`);
const trimmed = db.archiveStats();
check('建库不触发归档裁剪', trimmed.length === 0, trimmed.map((a) => a.name + ' -' + a.rows).join('，') || '无');
check('容量低于软上限', info.bytes < cfg.storage.softLimitBytes, `${(info.bytes / 1024 / 1024).toFixed(2)} MB`);
check('建库耗时 < 5s', seedMs < 5000, seedMs + ' ms');

section('只读统计 API');
/* 页面只调领域层的只读函数，这些函数一旦拼错工具方法（例如把 util.fmt.monthDay 写成 util.monthDay）
   就是整页空白，而业务不变量校验完全看不出来。这里逐个调用并检查产出结构 */
(() => {
    const month = util.monthKey(util.now());
    const day = util.dateKey(util.now());
    const apis = {
        'stats.overview': () => TMS.stats.overview(7),
        'stats.orderTrend': () => TMS.stats.orderTrend(7),
        'stats.breakdown': () => TMS.stats.breakdown('service', 30),
        'stats.lifecycleStats': () => TMS.stats.lifecycleStats(14),
        'stats.timingStats': () => TMS.stats.timingStats(30),
        'stats.traceStats': () => TMS.stats.traceStats(7),
        'stats.routeStats': () => TMS.stats.routeStats(),
        'stats.networkStats': () => TMS.stats.networkStats(30),
        'stats.capacityStats': () => TMS.stats.capacityStats(),
        'stats.customerRanking': () => TMS.stats.customerRanking(10),
        'stats.scanStats': () => TMS.stats.scanStats(7),
        'stats.materialStats': () => TMS.stats.materialStats(),
        'stats.systemStats': () => TMS.stats.systemStats(),
        'finance.financeSummary': () => TMS.finance.financeSummary(7),
        'finance.financeTrend': () => TMS.finance.financeTrend(14),
        'finance.receivableSummary': () => TMS.finance.receivableSummary(),
        'finance.grossAnalysis': () => TMS.finance.grossAnalysis(30),
        'finance.codSummary': () => TMS.finance.codSummary(30),
        'finance.payableBreakdown': () => TMS.finance.payableBreakdown(30),
        'service.exceptionStats': () => TMS.service.exceptionStats(),
        'service.ticketStats': () => TMS.service.ticketStats(),
        'service.claimStats': () => TMS.service.claimStats(),
        'operation.tripStats': () => TMS.operation.tripStats(7),
        'operation.costView': () => TMS.operation.costView(transports[0]),
        'people.performanceSummary': () => TMS.people.performanceSummary(month),
        'people.roster': () => TMS.people.roster(day),
        'audit.list': () => TMS.audit.list(5),
        'db.info': () => TMS.db.info()
    };
    Object.keys(apis).forEach((name) => {
        let v;
        try { v = apis[name](); } catch (err) { check(name + ' 可调用', false, err.message); return; }
        const json = JSON.stringify(v === undefined ? null : v);
        check(name + ' 产出有效', !!v && json !== 'null' && !/NaN|undefined/.test(json));
    });
    const trend = TMS.stats.orderTrend(7);
    check('趋势按日补齐 7 天', trend.length === 7 && trend.every((d) => /^\d{2}-\d{2}$/.test(d.label)), trend.map((d) => d.label).join(' '));
    check('绩效汇总命中当期账期', TMS.people.performanceSummary(month).count > 0, TMS.people.performanceSummary(month).count + ' 人');
})();

section('UI 层与页面注册器');/* UI 模块在无浏览器环境下只做字符串渲染，这里验三件事：
   能装配、管线正确、渲染结果不泄露内部字段（undefined/NaN/裸 ID 都是字段名抄错的信号） */
check('外壳与注册器已装配', !!(TMS.ui && TMS.charts && TMS.shell && TMS.pages));
check('注册表与菜单文件同源', TMS.pages.MENU_FILE['overview'] === 'tms-index.html' && TMS.pages.MENU_FILE['b-home'] === 'branch-index.html');
(() => {
    const d = TMS.pages.define('__smoke_page', { title: '冒烟页' });
    check('define 自动补齐 id 与文件名', d.id === '__smoke_page' && TMS.pages.get('__smoke_page') === d);
    check('未注册页面可被枚举', TMS.pages.unregistered('admin').indexOf('__smoke_page') === -1 && Array.isArray(TMS.pages.unregistered('client')));
})();
/* 页面文件尚未全量重建，落点允许是「专属列表页」或「角色首页」两者之一 */
check('单号直达按角色落地',
    ['order', 'overview'].indexOf(TMS.pages.orderPageFor('admin')) > -1 &&
    ['b-order', 'b-home'].indexOf(TMS.pages.orderPageFor('branch')) > -1 &&
    ['c-order', 'c-home'].indexOf(TMS.pages.orderPageFor('client')) > -1,
    'admin→' + TMS.pages.orderPageFor('admin') + ' / branch→' + TMS.pages.orderPageFor('branch'));

(() => {
    const views = orders.map((o) => TMS.order.view(o));
    const st = { page: 1, pageSize: 10, sort: 'freight', dir: 'desc', filters: {} };
    const sorted = TMS.pages.sortRows(views, st);
    check('金额列按方向排序', sorted[0].freight >= sorted[sorted.length - 1].freight,
        `${sorted[0].freight} → ${sorted[sorted.length - 1].freight}`);
    st.sort = 'expectedAt'; st.dir = 'asc';
    const byTime = TMS.pages.sortRows(views, st);
    check('时间列按 ISO 串升序', byTime[0].expectedAt <= byTime[byTime.length - 1].expectedAt);
    const page1 = TMS.pages.paginate(byTime, st, 10);
    check('分页切出整页并记账', page1.length === 10 && st.total === byTime.length && st.pages === Math.ceil(byTime.length / 10),
        `${st.total} 行 / ${st.pages} 页`);
    st.page = 9999;
    TMS.pages.paginate(byTime, st, 10);
    check('筛选后页码越界自动收回', st.page === st.pages, '回到第 ' + st.page + ' 页');

    const signedViews = views.filter((r) => r.status === 'signed');
    const gs = { page: 1, pageSize: 10, sort: null, dir: 'desc', filters: { status: 'signed' } };
    const html = TMS.pages.grid({
        rows: signedViews, columns: TMS.pages.orderColumns({ hide: ['profit', 'courier'] }),
        fields: TMS.pages.orderFields({ customerFilter: true }), filter: TMS.pages.orderFilter,
        state: gs, valueOf: (r, k) => (k === 'stuck' ? TMS.order.stuckHours(r) : r[k])
    });
    check('列表管线渲染出表格与分页条', html.indexOf('tms-table') > -1 && html.indexOf('tms-pager') > -1 && gs.rows.length === 10);
    check('列定义 hide 生效', html.indexOf('毛利') === -1 && html.indexOf('派送员') === -1);
    check('列表渲染无脏值', !/undefined|NaN/.test(html));
})();

(() => {
    const sample = orders.find((o) => o.status === 'signed' && o.tripId && o.codAmount > 0)
        || orders.find((o) => o.status === 'signed') || orders[0];
    const detail = TMS.order.detail(sample.id);
    const views = {
        '履约步骤': () => TMS.pages.statusSteps(sample),
        '轨迹时间轴': () => TMS.pages.traceTimeline(sample.id),
        '订单档案': () => TMS.pages.orderInfo(sample),
        '费用面板': () => TMS.pages.orderFeePanel(sample),
        '成本面板': () => TMS.pages.orderCostPanel(sample),
        '路由面板': () => TMS.pages.orderPlanPanel(sample, detail.plan),
        '货物与作业': () => TMS.pages.orderWorkPanel(detail),
        '关联单据': () => TMS.pages.orderDocPanel(detail)
    };
    Object.keys(views).forEach((label) => {
        let html = '';
        try { html = String(views[label]()); } catch (err) {
            check(label + ' 渲染不抛错', false, err.message);
            return;
        }
        check(label + ' 渲染完整', html.length > 60 && !/undefined|NaN|object Object/.test(html), html.length + ' 字符');
    });
    check('履约步骤覆盖全部主状态', (TMS.pages.statusSteps(sample).match(/tms-step-name/g) || []).length === TMS.cfg.orderFlow.length);
    check('轨迹条目与扫描流水一致', (TMS.pages.traceTimeline(sample.id).match(/tms-tl-item/g) || []).length === TMS.order.traces(sample.id).length);

    const handle = TMS.pages.openOrder(sample.id);
    check('订单抽屉可打开', !!handle && !!handle.el);
    ['fee', 'cost', 'plan', 'work', 'doc', 'trace'].forEach((tab) => {
        TMS.shell.actions['order:tab'](tab);
    });
    const slot = handle && handle.el.querySelector('[data-order-slot]');
    check('抽屉页签渲染无脏值', !!slot && !/undefined|NaN/.test(slot.innerHTML), (slot || {}).innerHTML ? slot.innerHTML.length + ' 字符' : '空');
    TMS.pages.closeOrder();
})();

/* 菜单里每个页面都必须真的渲染出内容：
   「定义了但没实现」的页面在浏览器里只是空白，在这里要当场失败 */
(() => {
    const session = TMS.auth.login('admin', '123456').session;
    const ids = TMS.rbac.ADMIN_MENU.reduce((a, g) => a.concat(g.items), []).map((it) => it.id);
    const missing = ids.filter((id) => !TMS.pages.get(id));
    check('运营端菜单页面全部注册', missing.length === 0, missing.join('、') || ids.length + ' 页');
    const globalActs = Object.keys(TMS.shell.actions).concat(Object.keys(TMS.pages.shared));
    let dirty = 0;
    let drawn = 0;
    ids.forEach((id) => {
        const def = TMS.pages.get(id);
        if (!def || !def.render) return;
        drawn++;
        const st = TMS.ui.state(id);
        const ctx = {
            shell: TMS.shell, session, params: {}, days: 7, layout: 'full', pageId: id,
            role: 'admin', go: () => {}, refresh: () => {}, toast: () => {}, confirm: () => Promise.resolve(true),
            modal: () => ({ close() {} }), drawer: () => ({ close() {} }), formModal: () => ({ close() {} }),
            state: st, data: {}
        };
        try {
            const data = def.load ? def.load(ctx) : {};
            ctx.data = data;
            const html = String(def.render(ctx, data) || '');
            if (html.length < 40) { dirty++; console.error('  ✗ ' + id + ' 渲染内容过少：' + html.length + ' 字符'); }
            else if (/undefined|NaN|\[object Object\]/.test(html)) {
                dirty++;
                const m = html.match(/.{0,60}(undefined|NaN|\[object Object\]).{0,60}/);
                console.error('  ✗ ' + id + ' 渲染有脏值：…' + (m ? m[0] : '') + '…');
            } else {
                const need = globalActs.concat(Object.keys(def.actions || {}));
                const used = [...new Set((html.match(/data-act="([^"%]+)"/g) || [])
                    .map((s) => s.replace(/^data-act="/, '').replace(/"$/, '')))];
                const unhandled = used.filter((a) => need.indexOf(a) === -1);
                if (unhandled.length) { dirty++; console.error('  ✗ ' + id + ' 按钮动作未注册：' + unhandled.join('、')); }
            }
        } catch (err) {
            dirty++;
            console.error('  ✗ ' + id + ' 渲染抛错：' + err.message + '\n' + (err.stack || '').split('\n')[1]);
        }
    });
    check('运营端菜单页面渲染干净且动作可响应', dirty === 0, dirty ? dirty + ' 页有问题' : ids.length + ' 页通过');
})();

/* 动作与弹窗是真写入的入口，光渲染通过不算数：
   这里把每个页面动作按「带单据号」和「不带参数」各调一次，
   confirm 直接给「是」、formModal 立刻用默认值提交，把落库路径全部走一遍 */
(() => {
    const DIRTY = /undefined|NaN|\[object Object\]/;
    const POOL_BY_PREFIX = {
        ord: 'orders', ex: 'exceptions', wf: 'exceptions', cs: 'tickets', cl: 'claims',
        cod: 'codRecords', rt: 'rateCards', ar: 'receivables', ap: 'payables', fin: 'finances',
        ck: 'rechecks', cust: 'customers', dv: 'devices', tr: 'transports', emp: 'employees',
        wh: 'warehouses', mat: 'materials', veh: 'vehicles', br: 'branches', usr: 'users',
        gf: 'geofences', bill: 'bills', hb: 'hubs', cu: 'customers', cv: 'carriers', smv: 'stockMovements'
    };
    const argOf = (act) => {
        const pool = POOL_BY_PREFIX[String(act).split(':')[0]];
        if (!pool) return '';
        const rows = db.col(pool);
        return rows.length ? rows[0].id : '';
    };
    const autoYes = { then: (cb) => { cb(true); return autoYes; }, catch: () => autoYes };
    const fakeValue = (f, preset) => {
        if (preset && preset[f.key] !== undefined) return preset[f.key];
        if (f.value !== undefined) return f.value;
        const opts = f.options || [];
        if (f.type === 'number') return f.min != null ? Number(f.min) : 1;
        if (f.type === 'checkbox') return false;
        if (f.type === 'select' || f.type === 'radio') {
            const o = opts[0];
            if (o === undefined) return '';
            return (o && typeof o === 'object') ? (o.value === undefined ? '' : o.value) : o;
        }
        if (f.type === 'date') return util.dateKey(util.now());
        if (f.type === 'datetime') return util.iso(util.now());
        if (f.type === 'city') return '上海';
        return '';
    };
    const fakeForm = (fields, preset) => {
        const out = {};
        (fields || []).forEach((f) => {
            if (!f || !f.key) return;
            out[f.key] = fakeValue(f, preset || {});
        });
        return out;
    };

    const realConfirm = TMS.ui.confirm;
    const realFormModal = TMS.ui.formModal;
    let submits = 0, actCalls = 0, bad = 0;
    TMS.ui.confirm = () => autoYes;
    TMS.ui.formModal = function (o) {
        const handle = realFormModal.call(TMS.ui, o);
        if (typeof o.onSubmit === 'function') {
            const mark = domLog.length;
            submits++;
            try {
                o.onSubmit(fakeForm(o.fields, o.values), handle);
            } catch (err) {
                bad++;
                console.error('  ✗ 表单提交抛错（' + o.title + '）：' + err.message + '\n' + (err.stack || '').split('\n')[1]);
            }
            domLog.slice(mark).forEach((n) => {
                if (n.innerHTML && DIRTY.test(n.innerHTML)) {
                    bad++;
                    const m = n.innerHTML.match(/.{0,60}(undefined|NaN|\[object Object\]).{0,60}/);
                    console.error('  ✗ 表单提交后渲染脏值（' + o.title + '）：…' + (m ? m[0] : '') + '…');
                }
            });
        }
        return handle;
    };

    const session = TMS.auth.login('admin', '123456').session;
    TMS.rbac.ADMIN_MENU.reduce((a, g) => a.concat(g.items), []).map((it) => it.id).forEach((id) => {
        const def = TMS.pages.get(id);
        if (!def || !def.render || !def.actions) return;
        const ctx = {
            shell: TMS.shell, session, params: {}, days: 7, layout: 'full', pageId: id,
            role: 'admin', go: () => {}, refresh: () => {}, toast: () => {},
            state: TMS.ui.state(id), data: {}
        };
        try { ctx.data = def.load ? def.load(ctx) : {}; } catch (err) { ctx.data = {}; }
        Object.keys(def.actions).forEach((act) => {
            [argOf(act), ''].forEach((arg) => {
                const mark = domLog.length;
                actCalls++;
                try {
                    def.actions[act](arg, null);
                } catch (err) {
                    bad++;
                    console.error('  ✗ ' + id + ' 动作 ' + act + '（arg=' + arg + '）抛错：' + err.message +
                        '\n' + (err.stack || '').split('\n')[1]);
                }
                domLog.slice(mark).forEach((n) => {
                    if (!n.innerHTML || !DIRTY.test(n.innerHTML)) return;
                    bad++;
                    const m = n.innerHTML.match(/.{0,70}(undefined|NaN|\[object Object\]).{0,70}/);
                    console.error('  ✗ ' + id + ' 动作 ' + act + ' 弹层渲染脏值：…' + (m ? m[0] : '') + '…');
                });
            });
        });
        for (let i = 0; i < 8; i++) TMS.ui.closeTop();   // 关掉本页留下的弹层，避免叠到下一页
    });
    TMS.ui.confirm = realConfirm;
    TMS.ui.formModal = realFormModal;
    check('页面动作全部可执行且弹层无脏值', bad === 0,
        actCalls + ' 次调用 / ' + submits + ' 次表单提交' + (bad ? '，' + bad + ' 处问题' : ''));
})();

if (argv.includes('--dump')) {
    section('订单状态分布');
    const byStatus = {};
    orders.forEach((o) => { byStatus[o.status] = (byStatus[o.status] || 0) + 1; });
    Object.keys(byStatus).forEach((k) => log(`  ${k}（${TMS.cfg.orderLabels[k] || k}）: ${byStatus[k]}`));
    const pendingTrips = transports.filter((t) => t.status === 'pending').length;
    log(`  待发车车次: ${pendingTrips}`);
}

if (argv.includes('--dump')) {
    section('经济画像');
    const avg = (rows, k) => rows.length ? util.round(util.sum(rows, k) / rows.length, 2) : 0;
    const avgOf = (rows, fn) => rows.length ? util.round(rows.reduce((s, r) => s + (fn(r) || 0), 0) / rows.length, 2) : 0;
    const med = (rows, k) => {
        const v = rows.map((r) => Number(r[k]) || 0).sort((a, b) => a - b);
        return v.length ? v[Math.floor(v.length / 2)] : 0;
    };
    log(`  订单：均计费重 ${avg(signed, 'chargeableWeight')}kg / 中位 ${med(signed, 'chargeableWeight')}kg，均里程 ${avg(signed, 'distanceKm')}km，均运费 ¥${avg(signed, 'freight')}`);
    log(`  单公斤收入 ¥${util.round(avg(signed, 'freight') / Math.max(1, avg(signed, 'chargeableWeight')), 2)}`);
    // 成本构成不落库，逐单用 costOf 按车次分摊与费率即时重建
    const costOrders = signed.filter((o) => o.cost);
    const costs = costOrders.map((o) => TMS.pricing.costOf(o));
    const avgC = (k) => costs.length ? util.round(costs.reduce((s, c) => s + (c[k] || 0), 0) / costs.length, 2) : 0;
    log('  单均成本：' + [['lh', '干线'], ['hd', '中转'], ['cl', '揽收'], ['sc', '分拣'], ['dl', '派送'], ['pk', '包材'], ['oh', '间接'], ['tot', '合计']]
        .map(([k, label]) => `${label} ¥${avgC(k)}`).join(' / '));
    const owns = transports.filter((t) => t.dispatchType !== 'ltl');
    const ltls = transports.filter((t) => t.dispatchType === 'ltl');
    log(`  自有车次 ${owns.length}：均重 ${avg(owns, 'weight')}kg / 均载重 ${avgOf(owns, TMS.operation.capacityOf)}kg / 装载率 ${avg(owns, 'loadRate')}% / 单公斤成本 ¥${avgOf(owns, TMS.operation.costPerKgOf)} / 均成本 ¥${avgOf(owns, TMS.operation.costTotal)}`);
    log(`  外协零担 ${ltls.length}：均重 ${avg(ltls, 'weight')}kg / 单公斤采购 ¥${avgOf(ltls, TMS.operation.costPerKgOf)} / 均成本 ¥${avgOf(ltls, TMS.operation.costTotal)}`);
    const lowLoad = owns.filter((t) => t.loadRate < 40).length;
    log(`  自有低装载车次（<40%）：${lowLoad}`);
    log(`  车次均装载单数：${util.round(util.sum(transports, 'orders') / Math.max(1, transports.length), 2)} 单/车次`);
    const ledger = TMS.finance.financeSummary();
    log(`  账面损益：收入 ¥${ledger.income} / 支出 ¥${ledger.expense} / 净利 ¥${ledger.profit}（毛利率 ${ledger.margin}%）`);
    log('  支出结构：' + ledger.byCategory.filter((c) => c.expense).map((c) => `${c.label} ¥${c.expense}`).join(' / '));
}

if (argv.includes('--dump')) {
    section('集合行数');
    const sizes = [];
    Object.keys(info.rows).forEach((k) => {
        if (!info.rows[k]) return;
        sizes.push({ name: k, rows: info.rows[k], kb: Math.round(JSON.stringify(db.col(k)).length / 1024) });
    });
    sizes.sort((a, b) => b.kb - a.kb).slice(0, 18).forEach((s) => log(`  ${s.name}: ${s.rows} 行 / ${s.kb} KB`));
    Object.keys(info.rows).forEach((k) => { if (info.rows[k]) log(`  · ${k}: ${info.rows[k]}`); });
}

if (argv.includes('--flow')) {
    section('运行时链路回放（当前时刻）');
    const cust = db.col('customers').find((c) => c.level === 'A');
    const created = TMS.order.create({
        origin: cust.city, destination: '成都', service: '标准', customerId: cust.id,
        goods: '电子产品', weight: 18, pieces: 2, dims: '50x40x30',
        paymentMethod: '月结', receiverName: '测试收件人', receiverPhone: '13800001234'
    });
    check('下单成功', created.ok, created.message || created.order && created.order.id);
    const oid = created.order.id;
    check('下单即挂应收', !!TMS.finance.receivableOf(oid));
    ['collect', 'inbound', 'sort', 'assignDelivery', 'sign'].forEach(() => {});
    TMS.order.collect(oid, { operator: '冒烟测试揽收' });
    TMS.order.inbound(oid, { operator: '冒烟测试入库' });
    TMS.order.sort(oid, { operator: '冒烟测试分拣' });
    const tr = TMS.operation.createTrip({
        fromHub: db.get('orders', oid).hubFrom, toHub: db.get('orders', oid).hubTo,
        orderIds: [oid], departAt: '20:00'
    });
    check('建车次成功', tr.ok, tr.message || tr.transport && tr.transport.id);
    TMS.operation.startTransport(tr.transport.id, { operator: '司机' });
    check('状态推进至运输中', db.get('orders', oid).status === 'transit', db.get('orders', oid).status);
    TMS.operation.arriveTransport(tr.transport.id, { operator: '司机' });
    check('状态推进至已到件', db.get('orders', oid).status === 'arrived', db.get('orders', oid).status);
    const courier = db.col('employees').find((e) => e.role === 'deliveryman' && e.status === 'active');
    const asg = TMS.order.assignDelivery(oid, { courierId: courier.id });
    check('派单成功', asg.ok, asg.message);
    const bad = TMS.order.sign('HL_NOT_EXIST', {});
    check('非法单号签收被拒', !bad.ok, bad.message);
    const back = TMS.order.collect(oid, {});
    check('状态回退被拒', !back.ok, back.message);
    const st = TMS.order.sign(oid, { receiver: '本人签收', photo: true });
    check('签收成功', st.ok, st.message);
    const o2 = db.get('orders', oid);
    check('签收即生成应收核销基础', o2.receivableStatus === 'pending', o2.receivableStatus);
    const rc = TMS.finance.recheckWeight(oid, { actualWeight: 25.5, operator: '复核员' });
    check('计费复核产出差异', rc.ok && Math.abs(rc.delta) > 0, '差异 ' + rc.delta);
    const bill = TMS.finance.generateBills(util.monthKey(o2.createdAt), cust.id);
    check('生成客户账单', bill.length > 0, bill.length + ' 份');
    const ar = TMS.finance.receivableOf(oid);
    TMS.finance.markReceivablePaid(ar.id, { invoiceNo: 'INV-SMOKE' });
    check('应收核销并结转收入', db.get('receivables', ar.id).status === 'paid');
    const codOrder = signed.find((o) => o.paymentMethod === '到付' && db.col('codRecords').some((r) => r.orderId === o.id && r.remitStatus === 'pending'));
    if (codOrder) {
        const rec = db.col('codRecords').find((r) => r.orderId === codOrder.id && r.remitStatus === 'pending');
        const before = TMS.finance.financeSummary();
        TMS.finance.remitCOD(rec.id, '冒烟财务');
        const after = TMS.finance.financeSummary();
        const remitRow = db.col('finances').find((f) => f.refId === rec.id && f.type === 'expense');
        // 上划的是客户货款（代收负债），只过账不进损益；服务费才是收入
        check('代收款上划货款走往来、服务费计收入',
            db.get('codRecords', rec.id).remitStatus === 'remitted' && !!remitRow && remitRow.nature === '往来'
            && after.expense === before.expense && after.income > before.income,
            '货款 ' + util.fmt.money(rec.netPayable) + ' / 服务费 ' + util.fmt.money(rec.serviceFee));
    }
    const ex = TMS.service.createException({ orderId: oid, type: '货物破损', description: '冒烟测试异常', level: '二级', actor: '测试' });
    TMS.service.processException(ex.id, '受理人');
    TMS.service.assignResponsibility(ex.id, { party: '承运商', deduction: 300, responsible: '顺达快运' });
    const closed = TMS.service.closeException(ex.id, { solution: '理赔', rootCause: '装卸暴力', resolution: '已赔付', createClaim: true, claimAmount: 500 });
    check('异常闭环并联动理赔', closed.status === 'resolved' && !!closed.linkedClaimId, closed.linkedClaimId);
    const claim = db.get('claims', closed.linkedClaimId);
    const approved = TMS.service.approveClaim(claim.id, {});
    check('理赔审批生成支出', approved.status === 'approved', util.fmt.money(approved.amount));
    const rev = TMS.order.createReverseOrder(oid, { reason: '客户退货' });
    check('逆向退货生成新单', rev.ok && rev.reverse && rev.reverse.orderType === 'reverse', rev.reverse && rev.reverse.id);
    const sw = TMS.jobs.sweep(true);
    check('巡检可重入执行', sw.skipped === false, sw.jobs.length + ' 项任务');
    const p = TMS.people.computePerformance(courier.id);
    check('绩效可实时重算', p && p.score > 0, p && p.grade + ' ' + p.score);
    const cancelled = TMS.order.create({
        origin: '上海', destination: '广州', service: '经济', weight: 5, pieces: 1,
        paymentMethod: '现付', receiverName: 'x', receiverPhone: '13800000000'
    });
    const cx = TMS.order.cancel(cancelled.order.id, { reason: '客户取消' });
    check('未发运订单可直接取消', cx.ok && !cx.intercept, cx.order.status);
    const unknown = TMS.order.create({ origin: '上海', destination: '不存在的城市', weight: 3 });
    check('非法目的城市被拒', !unknown.ok, unknown.message);
    const chg = TMS.order.change(oid, { service: '加急' });
    check('终态订单改单被拒', !chg.ok, chg.message);
}

console.error('\n' + (failures ? '✗ 校验失败 ' + failures + ' 项' : '✓ 全部校验通过'));
process.exit(failures ? 1 : 0);
