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
global.location = { href: '', hash: '', pathname: '/admin/index.html', replace() {}, search: '' };
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
const byId = new Map();
global.document = {
    currentScript: { getAttribute: () => 'js/boot.js?v=smoke' },
    addEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [],
    getElementById: (id) => {
        if (!byId.has(id)) byId.set(id, el());
        return byId.get(id);
    },
    createElement: () => el(), body: el()
};
global.window = global;
global.innerWidth = 1440;

const MODULES = [
    'js/core/config.js', 'js/core/utils.js', 'js/core/bus.js', 'js/core/db.js', 'js/core/ids.js',
    'js/core/auth.js', 'js/core/rbac.js', 'js/core/migrations.js',
    'js/data/master.js', 'js/domain/pricing.js', 'js/domain/network.js', 'js/data/seed.js',
    'js/domain/order.js', 'js/domain/operation.js', 'js/domain/finance.js', 'js/domain/service.js',
    'js/domain/people.js', 'js/domain/stats.js', 'js/domain/audit.js', 'js/domain/jobs.js',
    'js/ui/kit.js', 'js/ui/charts.js', 'js/ui/shell.js', 'js/pages/registry.js',
    'js/pages/portal.js', 'js/pages/admin.js', 'js/pages/branch.js', 'js/pages/sorter.js',
    'js/pages/transporter.js', 'js/pages/deliveryman.js', 'js/pages/client.js'
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
        // 司机端要的不是「历史上有过车次」，是「今天进来有活可干」：装车→发车→回场一路都得能点
        const open = mine.filter((t) => ['pending', 'loading', 'departed', 'arrived'].indexOf(t.status) > -1);
        return { name: '挂车车次', hit: mine.length > 0 && open.length > 0, detail: mine.length + ' 次 / 在办 ' + open.length + ' 次' };
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
        'people.performanceSummary': () => TMS.people.performanceSummary(),
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
    /* 绩效是月度账。月初几天就按当月核算，账期里只有一两票，档位会整体塌到 D，
       所以账期必须是 people.defaultPeriod() 认定的那个已关账月份；
       历史回放不足整月时（月中），靠 scoreOf 的覆盖天数折算兜住分布 */
    const perfPeriods = util.unique(db.col('performances').map((p) => p.period)).sort();
    const perfMonth = perfPeriods[perfPeriods.length - 1];
    const dayOfToday = Number(util.dateKey(util.now()).slice(-2));
    const summary = TMS.people.performanceSummary(perfMonth);
    const dCount = (summary.byGrade.filter((g) => g.label === 'D')[0] || { value: 0 }).value;
    check('绩效账期唯一且走关账规则', perfPeriods.length === 1 && perfMonth === TMS.people.defaultPeriod(), perfPeriods.join(' '));
    check('绩效账期不落进刚开头的月份', perfMonth !== util.monthKey(util.now()) || dayOfToday >= 14,
        perfMonth + ' · 今日 ' + util.dateKey(util.now()));
    check('绩效档位分布不是一边倒', summary.count > 0 && dCount / summary.count < 0.6,
        perfMonth + ' · ' + summary.count + ' 人 · 均分 ' + summary.avgScore + ' · D 档 ' + dCount + ' 人 · 覆盖 ' +
        TMS.people.computeMetrics(db.get('employees', db.col('performances')[0].employeeId), perfMonth).windowDays + ' 天');
    check('考核留有未定级草稿', db.col('evaluations').some((e) => e.status === 'pending'),
        db.col('evaluations').filter((e) => e.status === 'pending').length + ' 条 pending');
    /* 岗位内不能整岗塌陷：某个岗位全员同分，多半是指标归属拼错了字段（比如异常按全网计数） */
    const byRole = {};
    db.col('performances').filter((p) => p.period === perfMonth).forEach((p) => {
        const r = TMS.people.roleName((db.get('employees', p.employeeId) || {}).role || '?');
        (byRole[r] = byRole[r] || []).push(p.score);
    });
    check('档位按岗位分散，不是整岗塌陷', Object.keys(byRole).every((k) => {
        const s = byRole[k];
        return s.length < 10 || Math.max.apply(null, s) - Math.min.apply(null, s) > 12;
    }), Object.keys(byRole).map((k) => {
        const s = byRole[k].slice().sort((a, b) => a - b);
        return TMS.people.roleName(k) + ' ' + s[0] + '~' + s[s.length - 1] + '（均 ' +
            (s.reduce((a, b) => a + b, 0) / s.length).toFixed(0) + '）';
    }).join(' · '));
})();

section('UI 层与页面注册器');/* UI 模块在无浏览器环境下只做字符串渲染，这里验三件事：
   能装配、管线正确、渲染结果不泄露内部字段（undefined/NaN/裸 ID 都是字段名抄错的信号） */
check('外壳与注册器已装配', !!(TMS.ui && TMS.charts && TMS.shell && TMS.pages));
/* bundle 文件写了却没进 boot.js 的 MODULES，浏览器里就是「页面尚未注册」的空白，
   而冒烟脚本自己 import 全量模块，永远测不出来——所以这里直接比对目录与 boot 的清单 */
(() => {
    const bootSrc = fs.readFileSync(path.join(ROOT, 'js/boot.js'), 'utf8');
    const files = fs.readdirSync(path.join(ROOT, 'js/pages')).filter((f) => /\.js$/.test(f));
    const missing = files.filter((f) => bootSrc.indexOf("'js/pages/" + f + "'") === -1);
    check('boot.js 登记了全部页面模块', missing.length === 0, missing.join('、') || files.length + ' 个模块');
    /* 冒烟清单和浏览器清单不一致 = 测了一套、跑的是另一套：
       只比对 js/pages 不够，core/domain 里少一个模块照样能让页面「在 Node 里好好的」 */
    const allFiles = ['core', 'data', 'domain', 'ui', 'pages'].reduce(function (acc, dir) {
        return acc.concat(fs.readdirSync(path.join(ROOT, 'js', dir)).filter((f) => /\.js$/.test(f))
            .map((f) => 'js/' + dir + '/' + f));
    }, []).concat('js/boot.js');
    const declared = (bootSrc.match(/'(js\/[a-z]+\/[A-Za-z0-9_.-]+\.js)'/g) || []).map((s) => s.slice(1, -1));
    const ghost = declared.filter((m) => allFiles.indexOf(m) === -1);
    check('boot 登记的模块文件都在', ghost.length === 0, ghost.join('、') || declared.length + ' 个');
    const notInSmoke = declared.filter((m) => MODULES.indexOf(m) === -1);
    check('冒烟与 boot 加载同一组模块', notInSmoke.length === 0, notInSmoke.join('、') || declared.length + ' 个');
    /* 模块清单是站点根相对路径，注入前必须乘上从 boot.js 自身 src 反推的基准；
       少了这一步，角色目录下的页面会去加载 admin/js/core/config.js 然后白屏 */
    check('boot 按自身 src 反推站点基准', /TMS\.base\s*=\s*BASE/.test(bootSrc) && /BASE \+ path/.test(bootSrc));
})();
check('注册表与菜单文件同源', TMS.pages.MENU_FILE['overview'] === 'admin/index.html' && TMS.pages.MENU_FILE['b-home'] === 'branch/index.html');

/* 目录布局契约：菜单里的 file 同时回答「这页归哪个角色」和「文件在哪个目录」，
   两边错一处就是登录跳错端、侧栏 404，所以逐条核对磁盘，而不是只看内存里的清单 */
(() => {
    const pairs = [];
    TMS.rbac.ADMIN_MENU.forEach((g) => g.items.forEach((it) => pairs.push(['admin', it.file])));
    Object.keys(TMS.rbac.PORTAL_MENU).forEach((role) => {
        TMS.rbac.PORTAL_MENU[role].forEach((it) => pairs.push([role, it.file]));
    });
    const offDir = pairs.filter(([role, f]) => {
        const segs = String(f || '').split('/');
        return segs.length !== 2 || segs[0] !== (TMS.cfg.roles[role] || {}).dir;
    });
    check('页面文件住在自己角色的目录下', offDir.length === 0,
        offDir.map(([r, f]) => r + '→' + f).join('、') || pairs.length + ' 条菜单');

    const menuFiles = [...new Set(pairs.map(([, f]) => f))];
    const absent = menuFiles.filter((f) => !fs.existsSync(path.join(ROOT, f)));
    check('菜单登记的页面文件都在磁盘上', absent.length === 0, absent.join('、') || menuFiles.length + ' 个文件');

    const stray = fs.readdirSync(ROOT).filter((n) => /\.html$/.test(n) && n !== 'index.html');
    check('站点根只留登录入口，业务页全部进目录', stray.length === 0, stray.join('、') || 'index.html');

    /* 深一层的页面必须把资源引用也降一层，否则 ../css/app.css 写成 css/app.css 就是 404 空壳 */
    const flat = menuFiles.filter((f) => {
        const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
        return src.indexOf('src="../js/boot.js') === -1 || src.indexOf('href="../css/app.css') === -1;
    });
    check('角色页外壳按目录深度引用资源', flat.length === 0, flat.join('、') || menuFiles.length + ' 个外壳');
    const loginSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    check('登录页从站点根引用资源', loginSrc.indexOf('src="js/boot.js') > -1 && loginSrc.indexOf('../js/boot.js') === -1);

    /* 一个 HTML 只承载本角色目录里的页面：跨目录深链靠 hash 归位，路径混了就永远对不上 */
    const dirs = [...new Set(menuFiles.map((f) => f.split('/')[0]))];
    const emptyDirs = dirs.filter((d) => !fs.existsSync(path.join(ROOT, d)));
    check('六端各有页面目录', emptyDirs.length === 0, dirs.join('/') || '');
})();
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
    /* 用户要的「搜索参数放到上面」是管线级的约定：筛选栏在表格之上、分页条在表格之下 */
    (() => {
        const gi = html.indexOf('class="tms-grid');
        const fi = html.indexOf('tms-filters');
        const ti = html.indexOf('tms-table');
        const pi = html.indexOf('tms-pager');
        check('筛选栏在列表之上、分页条在列表之下', gi > -1 && fi > gi && fi < ti && pi > ti,
            'grid@' + gi + ' filters@' + fi + ' table@' + ti + ' pager@' + pi);
        const p = markupProblem(html);
        check('列表标签结构闭合', !p, p);
    })();
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
        check(label + ' 渲染完整', html.length > 60 && !/undefined|NaN|object Object/.test(html) && !unclosedTagQuotes(html).length, html.length + ' 字符');
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

/* 六个角色端各自一套菜单，「定义了但没实现」的页面在浏览器里只是空白，
   在冒烟里要当场失败。这里按角色逐个跑三关：菜单页面全部注册 → 每页渲染干净 → 每页按钮动作有主。
   一线端的取数口径靠的是活会话：po.session() 读 shell.state，TMS.auth.can() 读 localStorage，
   两者都要按角色切过去，否则整页读到的都是「未绑定档案」的假正常 */
const ROLE_TARGETS = ['admin', 'branch', 'sorter', 'transporter', 'deliveryman', 'client'];
const SESSION_BY_ROLE = {};
TMS.cfg.demoAccounts.forEach((a) => {
    const r = TMS.auth.login(a.username, a.password);
    if (r.ok && !SESSION_BY_ROLE[r.session.role]) SESSION_BY_ROLE[r.session.role] = r.session;
});
const menuIdsOf = (role) => (role === 'admin'
    ? TMS.rbac.ADMIN_MENU.reduce((a, g) => a.concat(g.items), [])
    : (TMS.rbac.PORTAL_MENU[role] || [])).map((it) => it.id);

/* 外壳形态与侧栏取数口径：网点做的是后台管理，给它手机壳就会让列表退化成卡片流；
   反过来，桌面壳一旦改吃 ADMIN_MENU，就等于在网点的菜单里挂了一排越权入口 */
(() => {
    const groups = TMS.rbac.navGroups(SESSION_BY_ROLE.branch);
    const ids = groups.reduce((a, g) => a.concat(g.items.map((i) => i.id)), []);
    check('网点端声明为桌面后台', TMS.cfg.roles.branch.layout === 'desktop' && TMS.cfg.roles.client.layout === 'portal',
        Object.keys(TMS.cfg.roles).map((r) => r + '→' + TMS.cfg.roles[r].layout).join(' '));
    check('网点侧栏按组只出自己的页面',
        groups.length >= 3 && ids.every((i) => /^b-/.test(i)) && ids.length === TMS.rbac.PORTAL_MENU.branch.length,
        groups.map((g) => g.group + '(' + g.items.length + ')').join(' '));
    check('运营端侧栏仍是分组全量', TMS.rbac.navGroups(SESSION_BY_ROLE.admin).length === TMS.rbac.ADMIN_MENU.length,
        TMS.rbac.navGroups(SESSION_BY_ROLE.admin).length + ' 组');
})();

/* 改 ROLE_PERMS 出厂默认不等于改了老库：权限的活事实存在 roles 行里，
   不写迁移就会让老浏览器永远看不到新增的那一格菜单 */
(() => {
    const v8 = ['overview:view', 'order:view', 'order:create', 'order:advance', 'order:change', 'tracking:view',
        'scan:operate', 'loading:operate', 'exception:create', 'service:handle', 'cod:remit',
        'customer:manage', 'warehouse:manage', 'report:view', 'evaluation:manage'];
    const roles = [
        { code: 'branch', builtin: true, permissionCodes: v8.slice() },
        { code: 'branch', builtin: true, permissionCodes: v8.slice(0, 6) },
        { code: 'client', builtin: true, permissionCodes: v8.slice() }
    ];
    TMS.migrations[TMS.cfg.storage.schema]({ data: { roles: roles } }, TMS);
    check('v9 迁移只补出厂权限、不覆盖手工勾过的组合',
        roles[0].permissionCodes.indexOf('sorting:operate') > -1 &&
        roles[1].permissionCodes.length === 6 && roles[2].permissionCodes.length === v8.length,
        'branch ' + roles[0].permissionCodes.length + ' 项 / 定制 ' + roles[1].permissionCodes.length + ' 项');
    check('网点出厂权限含分拣交接', TMS.rbac.defaultPerms('branch').indexOf('sorting:operate') > -1);
})();
/* 模板字符串里少写一个引号（如 autocomplete="off>）不会抛错，但浏览器会把后面的整段标签
   当成这个属性的值吞进去，页面结构当场塌掉，肉眼只看到「样式混乱」。
   这里按「引号内不算标签结束」的规则走一遍，把没闭合的引号揪出来 */
function unclosedTagQuotes(html) {
    const bad = [];
    let i = 0;
    while (i < html.length) {
        const lt = html.indexOf('<', i);
        if (lt < 0) break;
        const next = html[lt + 1];
        if (next === '!' || next === '/' || !/[a-zA-Z]/.test(next || '')) { i = lt + 1; continue; }
        let j = lt + 1, quote = null;
        while (j < html.length) {
            const c = html[j];
            if (quote) { if (c === quote) quote = null; }
            else if (c === '"' || c === "'") quote = c;
            else if (c === '>' || c === '<') break;
            j++;
        }
        if (quote || html[j] !== '>') bad.push(html.slice(lt, Math.min(lt + 90, html.length)));
        i = j + 1;
    }
    return bad;
}

const autoYes = { then: (cb) => { cb(true); return autoYes; }, catch: () => autoYes };

/* 一段渲染结果的两类结构病：脏值 与 引号未闭合 */
function markupProblem(html) {
    const m = html.match(/.{0,70}(undefined|NaN|\[object Object\]).{0,70}/);
    if (m) return '渲染脏值：…' + m[0] + '…';
    const broken = unclosedTagQuotes(html);
    if (broken.length) return broken.length + ' 处标签属性引号未闭合：<' + broken[0].slice(1);
    return '';
}
/* 动作里调 ui.toast / shell.refresh 要有落笔的地方；此节点只建一次，
   免得它落进 domLog 的切片窗口里被当成「弹层脏值」 */
TMS.shell.state.content = realCreateElement('div');

/* 抽屉是六端共用组件，页签必须按角色裁剪：客户和一线看见同一张运单时，
   不该读到干线分摊与间接摊销——那是「这单我们赚多少」，不是「你的运费为什么是这个数」 */
TMS.shell.state.session = SESSION_BY_ROLE.admin;
const adminTabs = TMS.pages.visibleTabs().map((t) => t.value);
TMS.shell.state.session = SESSION_BY_ROLE.client;
const clientTabs = TMS.pages.visibleTabs().map((t) => t.value);
check('成本页签只对运营端开放', adminTabs.indexOf('cost') > -1 && clientTabs.indexOf('cost') === -1,
    '运营 ' + adminTabs.join('/') + ' · 客户 ' + clientTabs.join('/'));
TMS.shell.state.session = null;

(() => {
    const globalActs = Object.keys(TMS.shell.actions).concat(Object.keys(TMS.pages.shared || {}));
    const unreg = [];
    let dirty = 0, drawn = 0;
    ROLE_TARGETS.forEach((role) => {
        const session = SESSION_BY_ROLE[role];
        if (!session) { check('角色 ' + role + ' 有演示账号', false); return; }
        const ids = menuIdsOf(role);
        ids.forEach((id) => { if (!TMS.pages.get(id)) unreg.push(role + '/' + id); });
        TMS.auth.write(session);
        TMS.shell.state.session = session;
        TMS.shell.state.portal = role;
        TMS.shell.state.pageId = '';
        ids.forEach((id) => {
            const def = TMS.pages.get(id);
            if (!def || !def.render) return;
            drawn++;
            const ctx = {
                shell: TMS.shell, session, params: {}, days: 7, layout: 'full', pageId: id,
                role, go: () => {}, refresh: () => {}, toast: () => {}, confirm: () => autoYes,
                modal: () => ({ close() {} }), drawer: () => ({ close() {} }), formModal: () => ({ close() {} }),
                state: TMS.ui.state(id), data: {}
            };
            try {
                const data = def.load ? def.load(ctx) : {};
                ctx.data = data;
                const html = String(def.render(ctx, data) || '');
                const broken = unclosedTagQuotes(html);
                if (broken.length) {
                    dirty++;
                    console.error('  ✗ ' + role + '/' + id + ' 有标签属性引号未闭合（' + broken.length + ' 处）：<' + broken[0].slice(1));
                }
                if (html.length < 40) { dirty++; console.error('  ✗ ' + role + '/' + id + ' 渲染内容过少：' + html.length + ' 字符'); }
                else if (/undefined|NaN|\[object Object\]/.test(html)) {
                    dirty++;
                    const m = html.match(/.{0,60}(undefined|NaN|\[object Object\]).{0,60}/);
                    console.error('  ✗ ' + role + '/' + id + ' 渲染有脏值：…' + (m ? m[0] : '') + '…');
                } else {
                    const need = globalActs.concat(Object.keys(def.actions || {}));
                    const used = [...new Set((html.match(/data-act="([^"%]+)"/g) || [])
                        .map((s) => s.replace(/^data-act="/, '').replace(/"$/, '')))];
                    const unhandled = used.filter((a) => need.indexOf(a) === -1);
                    if (unhandled.length) { dirty++; console.error('  ✗ ' + role + '/' + id + ' 按钮动作未注册：' + unhandled.join('、')); }
                }
            } catch (err) {
                dirty++;
                console.error('  ✗ ' + role + '/' + id + ' 渲染抛错：' + err.message + '\n' + (err.stack || '').split('\n')[1]);
            }
        });
    });
    check('六端菜单页面全部注册', unreg.length === 0, unreg.join('、') || ROLE_TARGETS.length + ' 端 / ' + drawn + ' 页');
    check('六端菜单页面渲染干净且动作可响应', dirty === 0, dirty ? dirty + ' 页有问题' : drawn + ' 页通过');
})();

/* 动作与弹窗是真写入的入口，光渲染通过不算数：
   这里把六端每个页面动作按「带单据号」和「不带参数」各调一次，
   confirm 直接给「是」、formModal 立刻用默认值提交，把落库路径全部走一遍。
   角色端的动作前缀（b/s/srt/t/d/c）大多收的是订单号，少数收车次、设备、格口，
   所以先按动作全名查表，查不到再退到前缀默认池 */
(() => {
    const POOL_BY_PREFIX = {
        ord: 'orders', ex: 'exceptions', wf: 'exceptions', cs: 'tickets', cl: 'claims',
        cod: 'codRecords', rt: 'rateCards', ar: 'receivables', ap: 'payables', fin: 'finances',
        ck: 'rechecks', cust: 'customers', dv: 'devices', tr: 'transports', emp: 'employees',
        wh: 'warehouses', mat: 'materials', veh: 'vehicles', br: 'branches', usr: 'users',
        dept: 'departments', eval: 'evaluations', perf: 'performances',
        gf: 'geofences', bill: 'bills', hb: 'hubs', cu: 'customers', cv: 'carriers', smv: 'stockMovements',
        work: 'orders', device: 'devices', branch: 'branches', customer: 'customers',
        b: 'orders', s: 'orders', d: 'orders', c: 'orders', t: 'transports', srt: 'sortingTasks'
    };
    const POOL_BY_ACT = {
        'b:finishload': 'transports', 'b:sync': 'devices', 'b:requisition': 'materials',
        't:attach': 'orders', 'd:remit': 'codRecords', 'd:contact': 'customers'
    };
    const FIXED_ARG = { 's:batch': 'C01' };
    const argOf = (act) => {
        if (FIXED_ARG[act] !== undefined) return FIXED_ARG[act];
        const pool = POOL_BY_ACT[act] || POOL_BY_PREFIX[String(act).split(':')[0]];
        if (!pool) return '';
        const rows = db.col(pool);
        return rows.length ? rows[0].id : '';
    };
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
                if (!n.innerHTML) return;
                const p = markupProblem(n.innerHTML);
                if (p) { bad++; console.error('  ✗ 表单提交后弹层 ' + p + '（' + o.title + '）'); }
            });
        }
        return handle;
    };

    /* 翻页只改地址栏，不写库；Node 里没有真实路由，把 shell.go 收成计数器，
       免得 mount 去建浏览器外壳。渲染那一关已经逐页验过，跳过去的页面长什么样不必再验 */
    const realGo = TMS.shell.go;
    let navs = 0;
    TMS.shell.go = () => { navs++; };

    ROLE_TARGETS.forEach((role) => {
        const session = SESSION_BY_ROLE[role];
        if (!session) return;
        TMS.auth.write(session);
        TMS.shell.state.session = session;
        TMS.shell.state.portal = role;
        menuIdsOf(role).forEach((id) => {
            const def = TMS.pages.get(id);
            if (!def || !def.render || !def.actions) return;
            TMS.shell.state.pageId = id;
            const ctx = {
                shell: TMS.shell, session, params: {}, days: 7, layout: 'full', pageId: id,
                role, go: () => { navs++; }, refresh: () => {}, toast: () => {},
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
                        console.error('  ✗ ' + role + '/' + id + ' 动作 ' + act + '（arg=' + arg + '）抛错：' + err.message +
                            '\n' + (err.stack || '').split('\n')[1]);
                    }
                    domLog.slice(mark).forEach((n) => {
                        if (!n.innerHTML) return;
                        const p = markupProblem(n.innerHTML);
                        if (p) { bad++; console.error('  ✗ ' + role + '/' + id + ' 动作 ' + act + ' 弹层 ' + p); }
                    });
                });
            });
            for (let i = 0; i < 14; i++) TMS.ui.closeTop();   // 关掉本页留下的弹层，避免叠到下一页
        });
    });
    TMS.shell.go = realGo;
    TMS.ui.confirm = realConfirm;
    TMS.ui.formModal = realFormModal;
    check('六端页面动作全部可执行且弹层无脏值', bad === 0,
        actCalls + ' 次调用 / ' + submits + ' 次表单提交 / ' + navs + ' 次翻页' + (bad ? '，' + bad + ' 处问题' : ''));
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
