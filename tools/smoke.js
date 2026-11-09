/* Node 冒烟校验：在无浏览器环境下装载运行时，重建种子库并校验业务不变量
   用法：node tools/smoke.js            仅建库 + 不变量校验
        node tools/smoke.js --flow     额外回放一条订单全生命周期
        node tools/smoke.js --empty    逐页列出空态区块，定位缺数据的功能
        node tools/smoke.js --loop     逐动作比对写库次数，揪「点了不落库」的断链
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
global.location = { href: '', hash: '', pathname: '/tms/index.html', replace() {}, search: '' };
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
    'js/domain/address.js',
    'js/domain/people.js', 'js/domain/stats.js', 'js/domain/audit.js', 'js/domain/jobs.js',
    'js/domain/architecture.js',
    'js/ui/kit.js', 'js/ui/charts.js', 'js/ui/map.js', 'js/ui/shell.js', 'js/pages/registry.js',
    'js/pages/portal.js', 'js/pages/admin.js', 'js/pages/architecture.js', 'js/pages/branch.js', 'js/pages/sorter.js',
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

/* 单号解析口径：一线输入框统一标「运单号」，操作员手里可能是 HL 订单号、WB 运单号、
   抄错的片段，甚至只有收件人手机后四位。这些回落曾经每个页面各抄一遍，漏抄的那几处
   就把本机真实存在的单报成「订单不存在」。口径只认唯一命中，命中多张一律交回调用方去列表里筛 */
section('单号解析');
const probe = orders.find((o) => String(o.receiverPhone || '').replace(/\D/g, '').length >= 4) || orders[0];
const idOf = (r) => (r || {}).id;
check('订单号可解析', idOf(TMS.order.byCode(probe.id)) === probe.id);
check('运单号可解析', idOf(TMS.order.byCode(probe.waybillNo)) === probe.id);
check('运单号大小写不敏感', idOf(TMS.order.byCode(probe.waybillNo.toLowerCase())) === probe.id);
check('首尾空格不影响解析', idOf(TMS.order.byCode('  ' + probe.waybillNo + ' ')) === probe.id);
check('唯一片段可解析', (function () {
    const frag = probe.waybillNo.slice(2, 10);
    const up = frag.toUpperCase();
    const peers = orders.filter((o) => String(o.waybillNo).toUpperCase().indexOf(up) > -1 || String(o.id).toUpperCase().indexOf(up) > -1);
    return peers.length === 1 ? idOf(TMS.order.byCode(frag)) === probe.id : TMS.order.byCode(frag) === null;
})(), '片段命中多张时应交回列表筛选');
check('手机后四位可解析', (function () {
    /* 后四位是抄单现场最常见的输入，但 700 张单里撞号是常态：
       撞上了必须返回 null 让人去列表里筛，不能随机挑一张挂到异常工单上 */
    const tailOf = (o) => String(o.receiverPhone || '').replace(/\D/g, '').slice(-4);
    const tail = tailOf(probe);
    const peers = orders.filter((o) => tailOf(o) === tail);
    return peers.length === 1 ? idOf(TMS.order.byCode(tail)) === probe.id : TMS.order.byCode(tail) === null;
})(), '后四位命中多张时应交回列表筛选');
check('空输入不报错', TMS.order.byCode('') === null && TMS.order.byCode(null) === null && TMS.order.byCode('   ') === null);
check('命中多张时不替用户猜单', TMS.order.byCode('HL') === null && TMS.order.byCode('WB') === null);
check('限定范围才可见', TMS.order.byCode(probe.waybillNo, orders.filter((o) => o.id !== probe.id).slice(0, 5)) === null);
/* 手抄回落一旦重新出现，就会有一处页面再次报「订单不存在」，所以直接扫源码拦住 */
const handCopied = MODULES.filter((p) =>
    /waybillNo\s*===/.test(fs.readFileSync(path.join(ROOT, p), 'utf8')));
check('页面不再手抄运单号回落查询', handCopied.length === 0, handCopied.join(','));

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

section('超时运单台账');
/* 这页八个数是拿去追责和清款口的，口径一旦在页面里各算一遍就对不上。
   台账的硬约束：行必须唯一、超时小时数不能为负、率的分母不能是零以外的怪东西 */
(() => {
    const ot = TMS.stats.overtimeStats(30);
    log(`  开单 ${ot.opened} / 超时 ${ot.lateOrders}（${ot.lateRate}%）· 在途超承诺 ${ot.transitLate} + 超时签收 ${ot.signedLate}` +
        ` · 滞留 ${ot.stranded} · 垫付 ${ot.advance} ¥${ot.advanceAmount}` +
        ` · 代收 ${ot.cod} ¥${ot.codAmount} · 回件率 ${ot.podRate}%（未回 ${ot.podMissing}）`);
    check('台账八个指标齐全', ['opened', 'lateOrders', 'lateRate', 'stranded', 'advance', 'cod', 'podRate', 'podMissing']
        .every((k) => typeof ot[k] === 'number' && isFinite(ot[k])));
    const dupKey = ot.rows.length - new Set(ot.rows.map((r) => r.key)).size;
    check('超时行 key 唯一（一单一类只一行）', dupKey === 0, '重复 ' + dupKey);
    const badKey = ot.rows.filter((r) => r.key !== r.orderId + '#' + r.type);
    check('超时行 key 由单号与类型拼成', badKey.length === 0, badKey.length + ' 行');
    check('超时小时数非负', ot.rows.every((r) => r.overHours >= 0),
        '最大 ' + Math.max(0, ...ot.rows.map((r) => r.overHours)));
    check('行金额非负', ot.rows.every((r) => r.amount >= 0));
    const orphan = ot.rows.filter((r) => !db.get('orders', r.orderId));
    check('超时行均指向现存订单', orphan.length === 0, orphan.length + ' 行');
    const badType = ot.rows.filter((r) => !TMS.stats.OT_TYPES[r.type]);
    check('超时类型在字典内', badType.length === 0, badType.map((r) => r.type).slice(0, 2).join(','));
    check('超时单数 ≤ 开单件数', ot.lateOrders <= ot.opened, `${ot.lateOrders} / ${ot.opened}`);
    check('超时占比与两数相除一致', ot.lateRate === util.pct(ot.lateOrders, ot.opened),
        ot.lateRate + '% vs ' + util.pct(ot.lateOrders, ot.opened) + '%');
    check('履约超时单数 = 去重后的在途超承诺 + 超时签收',
        ot.lateOrders === new Set(ot.rows.filter((r) => r.type === 'transitLate' || r.type === 'signedLate')
            .map((r) => r.orderId)).size);
    check('回件率 = 已回件 / 应回件', ot.podRate === util.pct(ot.podBack, ot.podDue),
        `${ot.podBack}/${ot.podDue}`);
    check('未回件数 = 应回件 − 已回件', ot.podMissing === ot.podDue - ot.podBack);
    check('资金敞口 = 垫付 + 代收', ot.exposure === util.money(ot.advanceAmount + ot.codAmount),
        `${ot.exposure} vs ${util.money(ot.advanceAmount + ot.codAmount)}`);
    /* 垫付与代收都是「钱压在网点手里」，前提必须是签收过：未签收就报资金超时是假账。
       口径用 signedAt 而不是 status==='signed'——签收后又退货的单状态会变成 returned，
       但代收的货款仍在那个网点手里没上划，这格账该继续追 */
    const badAdvance = ot.rows.filter((r) => (r.type === 'advance' || r.type === 'cod') && (!r.signedAt || r.status === 'cancelled'));
    check('垫付/代收超时行均签收过', badAdvance.length === 0,
        badAdvance.map((r) => r.type + ':' + r.orderId + ':' + (r.status || '无签收时间')).join(','));
    const badPod = ot.rows.filter((r) => r.type === 'podMissing' && r.status !== 'signed');
    check('未回件行均已签收', badPod.length === 0, badPod.length + ' 行');
    /* 滞留追的是「压着不动的那一站」，已完结的单不该再算滞留 */
    const badStrand = ot.rows.filter((r) => r.type === 'stranded' && TMS.order.isTerminal(db.get('orders', r.orderId)));
    check('滞留超时行均在非终态', badStrand.length === 0, badStrand.length + ' 行');
    const typeSum = ot.byType.reduce((n, t) => n + t.count, 0);
    check('类型分布加总等于台账行数', typeSum === ot.rows.length, `${typeSum} vs ${ot.rows.length}`);
    const branchSum = ot.byBranch.reduce((n, t) => n + t.count, 0);
    check('网点归属加总等于台账行数', branchSum === ot.rows.length, `${branchSum} vs ${ot.rows.length}`);
    check('责任网点榜按超时行数降序', ot.byBranch.every((t, i, a) => i === 0 || a[i - 1].count >= t.count));
    const trendOpened = ot.trend.reduce((n, t) => n + t.opened, 0);
    check('走势开单加总等于开单件数', trendOpened === ot.opened, `${trendOpened} vs ${ot.opened}`);
    check('走势每日超时占比 ≤ 100', ot.trend.every((t) => t.rate <= 100),
        '峰值 ' + Math.max(0, ...ot.trend.map((t) => t.rate)) + '%');
    const trendLate = ot.trend.reduce((n, t) => n + t.late, 0);
    /* 履约超时行全部来自窗口内开单，所以按天去重后加总必须等于顶部的超时单数；
       对不上就说明走势的分母或去重口径与 KPI 分了家 */
    check('走势超时单加总等于超时单数', trendLate === ot.lateOrders, `${trendLate} vs ${ot.lateOrders}`);
    /* 口径一旦改动，页面 KPI 与走势、榜单必须同时跟着变；这里钉住「窗口拉长行数不减」 */
    const otShort = TMS.stats.overtimeStats(7);
    check('7 日窗口是 30 日子集', otShort.rows.length <= ot.rows.length, `${otShort.rows.length} ≤ ${ot.rows.length}`);
    check('overtimeRows 与 overtimeStats 同源',
        TMS.stats.overtimeRows(30).length === ot.rows.length,
        TMS.stats.overtimeRows(30).length + ' vs ' + ot.rows.length);
    /* 台账存在的意义是「有账可追」：全零说明种子或判定线断了，页面会好看得可疑 */
    check('台账有内容', ot.rows.length > 0 && ot.byBranch.length > 0,
        `${ot.rows.length} 行 / ${ot.byBranch.length} 个网点`);
})();

section('行政区划三级与路由范围分级');
(function () {
    const M = TMS.master, N = TMS.network;
    /* 区名必须是这座城市真的有的，且同一座城里不能重复：
       重复或通用名会让同城两单被判进同一个区，分级表那一格永远空着 */
    const noDist = M.CITIES.filter((c) => (M.CITY_DISTRICTS[c.name] || []).length < 4).map((c) => c.name);
    check('每座城市都有真实区/镇名', noDist.length === 0, noDist.join('、') || M.CITIES.length + ' 座在册');
    const dup = M.CITIES.filter((c) => {
        const list = M.CITY_DISTRICTS[c.name] || [];
        return new Set(list).size !== list.length;
    }).map((c) => c.name);
    check('同城区名不重复', dup.length === 0, dup.join('、') || '无');

    const sz = M.districtsOf('上海');
    check('区级带派生坐标且同名恒得同坐标',
        sz.length > 0 && JSON.stringify(M.districtsOf('上海')) === JSON.stringify(sz) &&
        sz.every((d) => Math.abs(d.lat - M.cityByName('上海').lat) < 0.35),
        sz.length + ' 个区·' + (sz[0] || {}).name);
    check('区名可反查坐标', M.districtPoint('上海', sz[1].name).name === sz[1].name);
    check('从地址文本认出所在区，跨城同名不盲认',
        (M.matchDistrict('上海', '上海市' + sz[2].name + '世纪大道 100 号') || {}).name === sz[2].name &&
        M.matchDistrict('上海', '杭州市西湖区龙井路 1 号') === null);

    const provs = M.PROVINCES;
    const missProv = M.CITIES.filter((c) => !M.provinceOf(c.name)).map((c) => c.name);
    check('省表由市表反推且覆盖全部城市',
        missProv.length === 0 && provs.every((x) => x.cities.length >= 1 && x.name),
        provs.length + ' 个省级单元 / ' + M.CITIES.length + ' 座城市');
    const singles = provs.filter((x) => x.singleCity).map((x) => x.name);
    check('直辖市与单城省标出 singleCity（省内没有跨市这一档）',
        M.provinceOf('上海').singleCity === true && M.provinceOf('杭州').singleCity === false,
        singles.join('、'));

    /* 分级六个分支逐个钉死：区内 / 市内跨区（含缺区级）/ 省内跨市 /
       同大区跨省 / 跨大区跨省 / 范围待定。只验其中一个等于没验 */
    const L = (city, dist) => N.endLevels(city, city + '市' + dist + '某某路 1 号');
    const cases = [
        ['区内直送', L('上海', '浦东新区'), L('上海', '浦东新区'), 'intra'],
        ['市内跨区', L('上海', '浦东新区'), L('上海', '闵行区'), 'city'],
        ['省内跨市', L('杭州', '西湖区'), L('宁波', '海曙区'), 'prov'],
        ['同大区跨省', L('南京', '玄武区'), L('合肥', '蜀山区'), 'cross'],
        ['跨大区跨省', L('上海', '闵行区'), L('广州', '天河区'), 'cross'],
        ['范围待定', { city: '不存在', known: false }, L('上海', '闵行区'), 'unknown']
    ];
    cases.forEach((c) => {
        const sc = N.scopeOf(c[1], c[2]);
        check('分级判定：' + c[0], sc.code === c[3], c[3] + ' → ' + sc.name + (sc.sub ? ' / ' + sc.sub : ''));
    });
    const subCross = [N.scopeOf(L('南京', '玄武区'), L('合肥', '蜀山区')).sub,
        N.scopeOf(L('上海', '闵行区'), L('广州', '天河区')).sub];
    check('跨省再分同大区/跨大区', subCross[0] === '同大区跨省' && subCross[1] === '跨大区跨省', subCross.join(' / '));
    const blank = { city: '上海', province: '上海市', zone: '华东', district: '', known: true };
    const scBlank = N.scopeOf(blank, blank);
    check('同城但认不出区时标出缺数据', scBlank.code === 'city' && scBlank.needDistrict === true, scBlank.sub);

    /* 区内直送合并段次只改「怎么走」的展示，不改承诺：
       总时长、总里程、stdHours、slaHours 四个数必须一字不变 */
    const base = N.planRoute('上海', '上海', '标准', { noCache: true });
    const intra = N.planRoute('上海', '上海', '标准', {
        noCache: true, levels: { from: L('上海', '浦东新区'), to: L('上海', '浦东新区') }
    });
    check('区内直送合并为一段直送',
        !!base && !!intra && base.segments.length > 1 && intra.segments.length === 1 &&
        intra.segments[0].legType === 'direct',
        base.segments.length + ' 段 → ' + intra.segments.length + ' 段');
    check('合并后总时长与总里程不变（时效口径不动）',
        intra.totalStdHours === base.totalStdHours && intra.distanceKm === base.distanceKm &&
        intra.stdHours === base.stdHours && intra.slaHours === base.slaHours,
        intra.totalStdHours + 'h / ' + intra.distanceKm + 'km / 承诺 ' + intra.slaHours + 'h');
    check('跨城路由不被合并（干线段保留）',
        (() => {
            const x = N.planRoute('上海', '广州', '标准', { noCache: true });
            return !!x && x.segments.some((g) => g.legType === 'trunk') && x.scope.code !== 'intra';
        })());

    const st = N.scopeStats(orders);
    check('分级统计可汇总且分桶之和等于总量',
        st.total === orders.length && st.items.reduce((a, x) => a + x.count, 0) === st.total,
        st.total + ' 单');
    const seen = st.items.filter((x) => x.count > 0).map((x) => x.name + ' ' + x.count);
    check('四档分级在演示库里铺满（区内/市内/省内/跨省都有件）',
        ['intra', 'city', 'prov', 'cross'].every((k) => st.by[k] > 0), seen.join('·'));
    check('区内直送单的路由确实只有一段',
        orders.filter((o) => N.scopeOfOrder(o).code === 'intra')
            .every((o) => (N.planOf(o).segments || []).length === 1));
    check('段跨度与整单分级分开算',
        (() => {
            const x = N.planRoute('上海', '广州', '标准', { noCache: true });
            const codes = (x.segments || []).map((g) => N.segmentScope(g).code);
            /* 两端支线跑在同一座城里，干线才跨省：
               把它们算成同一个取值，「跨省单」就永远看不出干线背了多少量 */
            return x.scope.code === 'cross' && codes[0] === 'same' && codes.indexOf('cross') > -1;
        })());
})();

/* 多干线路由：一票货可能 serial 经过几条干线，中途枢纽要卸货→分拣→装货→候车。
   规划器必须在班次图上枚举全路径同场评分，而不是只找一条直发——
   这里把「枚举得出、评分别塌、装卸派生、采纳落库」四件事钉死 */
section('多干线智能规划与中途装卸');
(() => {
    const M = TMS.master, N = TMS.network;
    const ob = (c) => ({ city: c });

    const exp = N.planOptions('沈阳', '成都', '加急', {});
    check('规划台对长线 OD 枚举出多个可行方案', !!exp && exp.candidates.length > 1,
        exp ? exp.candidates.length + ' 个方案 / 策略 ' + exp.strategy : 'null');
    check('加急件允许空陆联运且含多干线方案',
        !!exp && exp.candidates.some((c) => c.mode === '联运') && exp.candidates.some((c) => c.trunkLegs >= 2),
        exp ? exp.candidates.filter((c) => c.trunkLegs >= 2).length + ' 个多干线方案' : '');
    check('候选按综合得分降序、推荐在首位',
        !!exp && exp.candidates[0] === exp.best &&
        exp.candidates.every((c, i) => i === 0 || exp.candidates[i - 1].score >= c.score),
        exp ? exp.best.label + ' ' + exp.best.score + ' 分' : '');
    check('候选都带起讫与分级、中转是装卸计划数组',
        !!exp && exp.candidates.every((c) => c.origin === '沈阳' && c.destination === '成都' &&
            c.scope && Array.isArray(c.transfers) && typeof c.trunkLegs === 'number'));

    const direct = M.planSegments(ob('上海'), ob('成都'), '陆运', { strategy: '均衡', maxTransfers: 0, withCandidates: true });
    check('最多中转 0 次时只出直达', !!direct && (direct.candidates || [direct]).every((c) => c.trunkLegs <= 1),
        direct ? (direct.candidates || [direct]).length + ' 个候选' : 'null');
    const multi = M.planSegments(ob('上海'), ob('成都'), '陆运', { strategy: '成本', maxTransfers: 2, withCandidates: true });
    const directCost = ((multi && multi.candidates) || []).filter((c) => c.trunkLegs === 1).map((c) => c.trunkCost)[0];
    check('成本策略会真的改选多干线路径（比直达便宜才选）',
        !!multi && multi.trunkLegs >= 2 && directCost != null && multi.trunkCost <= directCost,
        multi ? '选中 ¥' + multi.trunkCost + ' / 直达 ¥' + directCost : 'null');

    const ops = exp ? N.transferOps(exp.best) : [];
    const xferBest = exp ? exp.candidates.filter((c) => (c.transfers || []).length > 0)[0] : null;
    const xferOps = xferBest ? xferBest.transfers : [];
    check('多干线方案派生出中途装卸计划', xferOps.length >= 1 && xferOps.every((o) =>
        o.hub && o.unloadHours > 0 && o.sortHours > 0 && o.loadHours > 0 && o.waitHours >= 0 &&
        o.totalHours === o.unloadHours + o.sortHours + o.loadHours + o.waitHours &&
        /^D[1-8]$/.test(o.dockIn) && /^D[1-8]$/.test(o.dockOut)),
        xferOps.length ? xferOps[0].hub + ' 共 ' + xferOps[0].totalHours + 'h · 月台 ' + xferOps[0].dockIn + '→' + xferOps[0].dockOut : '无');
    check('装卸计划带前后班次衔接', xferOps.length > 0 && xferOps.every((o) => o.prevTripCode && o.nextTripCode),
        xferOps.length ? xferOps[0].prevTripCode + ' → ' + xferOps[0].nextTripCode : '');

    const inactive = db.col('trips').filter((t) => t.status === 'inactive').map((t) => t.id);
    const usedInactive = [];
    ['上海', '沈阳', '广州', '哈尔滨'].forEach((o) => ['成都', '昆明', '乌鲁木齐'].forEach((d) => {
        const r = N.planOptions(o, d, '标准', {});
        (r ? r.candidates : []).forEach((c) => (c.segments || []).forEach((s) => {
            if (s.tripId && inactive.indexOf(s.tripId) > -1) usedInactive.push(s.tripId);
        }));
    }));
    check('停用班次不参与规划', usedInactive.length === 0,
        inactive.length + ' 条停用班次 / 误用 ' + usedInactive.length);

    /* 采纳：同 OD 建档→再采纳更新不重复；路由行存中转次数（数字），规划对象存装卸数组 */
    const before = db.col('routes').length;
    const pick = xferBest || (exp && exp.best);
    const a1 = N.adoptRoutePlan(pick, '冒烟');
    const row1 = db.get('routes', a1.id);
    check('采纳方案建档且段次事实落库', a1.ok && a1.created && row1.planner === 'smart2' &&
        typeof row1.transfers === 'number' && row1.trunkLegs >= 1 && (row1.segments || []).length >= 3,
        a1.id + ' · 干线 ' + row1.trunkLegs + ' 段 / 中转 ' + row1.transfers + ' 次');
    const a2 = N.adoptRoutePlan(pick, '冒烟');
    check('同 OD 再采纳是更新不是重复建档', a2.ok && !a2.created && a2.id === a1.id && db.col('routes').length === before + 1);
    check('采纳留审计', db.col('auditLogs').some((x) => x.refId === a1.id && /采纳/.test(x.detail || '')),
        a1.id);
    /* 采纳后 planRoute 命中路由行，装卸计划从老段次也能派生（月台/工时不凭空消失） */
    const hit = N.planRoute('沈阳', '成都', '加急', { noCache: true });
    check('采纳后同 OD 下单命中新路由且装卸计划可派生',
        !!hit && hit.routeId === a1.id && (hit.transfers || []).length === row1.transfers,
        hit ? 'source=' + hit.source + ' · 装卸 ' + (hit.transfers || []).length + ' 次' : 'null');

    /* 规划台页面：八个条件控件改动即重算，对比表 + 选中方案段次/装卸可视化 */
    const def = TMS.pages.get('route');
    const rst = TMS.ui.state('route');
    const keepPl = rst.pl;
    rst.pl = { origin: '沈阳', destination: '成都', originDistrict: '', destDistrict: '', service: '加急', strategy: '', maxTransfers: '2', mode: '', picked: 1 };
    try {
        const rctx = { shell: TMS.shell, session: { username: 'admin', name: '冒烟', role: 'admin', permissions: [] }, params: {}, days: 7, layout: 'full', pageId: 'route', role: 'admin', state: rst };
        const html = String(def.render(rctx, def.load(rctx)) || '');
        check('规划台八个条件下拉改动即重算', (html.match(/data-change="rt:pl-set"/g) || []).length === 8);
        check('规划台常驻控件 >= 7（重规划/采纳/两导出/选用/全量重算）',
            ['rt:pl-run', 'rt:pl-adopt', 'rt:pl-csv', 'rt:pl-seg-csv', 'rt:pl-pick', 'rt:recompute-all']
                .every((a) => html.indexOf('data-act="' + a + '"') > -1));
        check('选中方案展开中转装卸可视化', html.indexOf('tms-xfer') > -1 && html.indexOf('卸货') > -1 &&
            html.indexOf('分拣转运') > -1 && html.indexOf('候车') > -1 && html.indexOf('月台') > -1);
        check('规划台渲染无脏值', !/undefined|NaN|\[object Object\]/.test(html));
    } finally {
        rst.pl = keepPl;
    }
})();

/* 分级中转：网点 → 三级中转场（县） → 二级中转站（市） → 一级中转站（跨省枢纽）。
   两条用户示例链是硬口径：定西某县→嘉峪关经兰州（省内），嘉峪关→嘉兴经兰州/杭州（跨省） */
section('分级中转路由体系');
(() => {
    const M = TMS.master, N = TMS.network;
    const chainOf = (p) => {
        const segs = p.segments || [];
        return segs.length ? [segs[0].from].concat(segs.map((s) => s.to)) : [];
    };
    const ordered = (chain, names) => {
        let at = -1;
        return names.every((n) => { const i = chain.indexOf(n); if (i <= at) return false; at = i; return true; });
    };

    ['定西', '嘉峪关', '嘉兴'].forEach((c) => check('新开城市在主数据内：' + c, !!M.cityByName(c)));
    check('示例区县真实在册', M.districtsOf('定西').some((d) => d.name === '陇西县') &&
        M.districtsOf('嘉峪关').some((d) => d.name === '雄关区') && M.districtsOf('嘉兴').some((d) => d.name === '海宁市'));
    const hubs = db.col('hubs');
    check('十座一级中转站全部建档且标级', hubs.length === 10 && hubs.every((h) => h.level === 1),
        hubs.length + ' 座');
    check('兰州/杭州/南京跨省分拣中心在册', hubs.some((h) => h.name === '兰州跨省分拣中心') && hubs.some((h) => h.name === '杭州跨省分拣中心') &&
        hubs.some((h) => h.name === '南京跨省分拣中心'));
    check('定西/嘉峪关归口兰州、嘉兴归口杭州',
        M.hubOfCity('定西').id === 'HB0008' && M.hubOfCity('嘉峪关').id === 'HB0008' && M.hubOfCity('嘉兴').id === 'HB0009',
        M.hubOfCity('定西').name + ' / ' + M.hubOfCity('嘉兴').name);
    check('南京/合肥归口南京跨省分拣中心',
        M.hubOfCity('南京').id === 'HB0010' && M.hubOfCity('合肥').id === 'HB0010',
        M.hubOfCity('南京').name + ' / ' + M.hubOfCity('合肥').name);
    check('县/县级市才设三级中转场', M.isCountyDistrict('陇西县') && M.isCountyDistrict('海宁市') &&
        !M.isCountyDistrict('南湖区') && !M.isCountyDistrict('新城镇'));
    check('二三级中转站是派生节点不落 hubs 表', !hubs.some((h) => /中转站$|中转场$/.test(h.name)) &&
        M.cityStation('定西').level === 2 && M.countyStation('定西', '陇西县').level === 3);

    /* 示例一：定西陇西县 → 嘉峪关雄关区，省内经兰州一级枢纽 */
    const p1 = N.planOptions('定西', '嘉峪关', '标准', { originDistrict: '陇西县', destDistrict: '雄关区' });
    const c1 = p1 ? chainOf(p1.best) : [];
    check('示例一：定西县件经兰州到嘉峪关', !!p1 && ordered(c1, ['定西陇西县中转场', '定西中转站', '兰州跨省分拣中心', '嘉峪关中转站']),
        c1.join(' → '));
    check('示例一网点起步含县域三级层', c1.length >= 6 && /陇西县/.test(c1[0]) && /嘉峪关/.test(c1[c1.length - 1]),
        c1[0] + ' … ' + c1[c1.length - 1]);
    check('示例一段次带层级标记', !!p1 && p1.best.segments.some((s) => s.fromLevel === 3) &&
        p1.best.segments.some((s) => s.fromLevel === 1 && s.legType === 'feeder'));

    /* 示例二：嘉峪关雄关区 → 嘉兴海宁市，跨省经兰州/杭州两座一级枢纽 */
    const p2 = N.planOptions('嘉峪关', '嘉兴', '标准', { originDistrict: '雄关区', destDistrict: '海宁市' });
    const c2 = p2 ? chainOf(p2.best) : [];
    check('示例二：嘉峪关→嘉兴经兰州/杭州双枢纽', !!p2 && ordered(c2, ['嘉峪关中转站', '兰州跨省分拣中心', '杭州跨省分拣中心', '嘉兴中转站', '嘉兴海宁市中转场']),
        c2.join(' → '));
    check('示例二目的县件落到三级中转场再派送', /海宁市中转场$/.test(c2[c2.length - 2] || '') && /网点|营业部/.test(c2[c2.length - 1] || ''),
        c2.slice(-2).join(' → '));
    const ops2 = p2 ? p2.best.transfers : [];
    check('示例二装卸计划覆盖兰州/杭州且标一级', ops2.some((o) => o.city === '兰州' && o.level === 1) &&
        ops2.some((o) => o.city === '杭州' && o.level === 1), ops2.map((o) => o.hub).join(' / '));
    check('示例二装卸计划班次衔接不断链', ops2.length > 0 && ops2.every((o) => o.prevTripCode && o.nextTripCode),
        ops2.length ? ops2[0].prevTripCode + ' → ' + ops2[0].nextTripCode : '无');

    /* 共享出省枢纽的两城：省域支线直连二级，不绕出省再绕回来（福州/厦门同归杭州） */
    const p3 = N.planOptions('福州', '厦门', '标准', {});
    const c3 = p3 ? chainOf(p3.best) : [];
    check('福州→厦门不绕杭州枢纽', !!p3 && c3.indexOf('福州中转站') > -1 && c3.indexOf('厦门中转站') > -1 &&
        !c3.some((n) => /分拣中心|分拨中心/.test(n)), c3.join(' → '));

    /* 示例二·深链：嘉峪关→嘉兴 跨省跨度大，兰州→西安→武汉→南京→杭州 四段干线逐枢纽串联，
       中途枢纽有发往杭州或路径下一站的班线就必须进候选，选用后装卸计划覆盖每个串联枢纽 */
    const p4 = N.planOptions('嘉峪关', '嘉兴', '标准', { originDistrict: '雄关区', destDistrict: '海宁市', maxTransfers: 4 });
    const deep = p4 ? p4.candidates.filter((p) => {
        const trunk = (p.segments || []).filter((s) => s.legType === 'trunk').map((s) => s.from);
        const to = (p.segments || []).filter((s) => s.legType === 'trunk').map((s) => s.to);
        const hubs5 = trunk.concat(to.length ? to[to.length - 1] : []);
        return hubs5.join('|') === '兰州跨省分拣中心|西安分拨中心|武汉分拨中心|南京跨省分拣中心|杭州跨省分拣中心';
    })[0] : null;
    check('深链候选：兰州→西安→武汉→南京→杭州 四段干线', !!deep && deep.trunkLegs === 4,
        deep ? chainOf(deep).join(' → ') : '未枚举到');
    check('深链全程网点起县域网点止', !!deep && /雄关区/.test(chainOf(deep)[0] || '') && /海宁市/.test(chainOf(deep).slice(-1)[0] || ''),
        deep ? chainOf(deep)[0] + ' … ' + chainOf(deep).slice(-1)[0] : '无');
    const ops4 = deep ? deep.transfers : [];
    check('深链装卸计划覆盖西安/武汉/南京且标一级', ['西安', '武汉', '南京'].every((c) => ops4.some((o) => o.city === c && o.level === 1)),
        ops4.map((o) => o.hub).join(' / '));
    check('深链装卸班次衔接不断链', ops4.length > 0 && ops4.every((o) => o.prevTripCode && o.nextTripCode),
        ops4.length ? ops4[0].prevTripCode + ' → ' + ops4[0].nextTripCode : '无');
    check('深链方案标记多经中转', !!deep && /3 经中转/.test(deep.label || ''), deep ? deep.label : '无');

    /* 规划台选中区县后链路条/段次分级徽标要渲染出来 */
    const def = TMS.pages.get('route');
    const rst = TMS.ui.state('route');
    const keepPl = rst.pl;
    rst.pl = { origin: '嘉峪关', destination: '嘉兴', originDistrict: '雄关区', destDistrict: '海宁市', service: '标准', strategy: '', maxTransfers: '2', mode: '', picked: 0 };
    try {
        const rctx = { shell: TMS.shell, session: { username: 'admin', name: '冒烟', role: 'admin', permissions: [] }, params: {}, days: 7, layout: 'full', pageId: 'route', role: 'admin', state: rst };
        const html = String(def.render(rctx, def.load(rctx)) || '');
        check('规划台渲染分级链路条与层级徽标', html.indexOf('tms-chain-lv1') > -1 && html.indexOf('tms-chain-lv3') > -1 &&
            html.indexOf('兰州跨省分拣中心') > -1 && html.indexOf('杭州跨省分拣中心') > -1);
        /* 段次表徽标必须是中转层级短标，不是考核页的「未定级」——同名函数曾被覆盖 */
        check('段次表起讫带中转层级短标', html.indexOf('>一级<') > -1 && html.indexOf('>三级<') > -1 && html.indexOf('未定级') < 0);
        check('区县下拉带真实县名', html.indexOf('海宁市') > -1 && html.indexOf('雄关区') > -1);
        check('分级规划渲染无脏值', !/undefined|NaN|\[object Object\]/.test(html));
    } finally {
        rst.pl = keepPl;
    }
    /* 深链在规划台要可见可选：前 6 名之外留各深度串联代表，多枢纽串联徽标 + 南京枢纽出现在候选链路 */
    rst.pl = { origin: '嘉峪关', destination: '嘉兴', originDistrict: '雄关区', destDistrict: '海宁市', service: '标准', strategy: '', maxTransfers: '4', mode: '', picked: 0 };
    try {
        const rctx = { shell: TMS.shell, session: { username: 'admin', name: '冒烟', role: 'admin', permissions: [] }, params: {}, days: 7, layout: 'full', pageId: 'route', role: 'admin', state: rst };
        const html = String(def.render(rctx, def.load(rctx)) || '');
        check('规划台列出多枢纽串联代表方案', html.indexOf('多枢纽串联') > -1 && html.indexOf('南京跨省分拣中心') > -1);
        check('最多中转档位放宽到 4 次', html.indexOf('4 次（多枢纽串联）') > -1 && html.indexOf('3 次中转') > -1);
        check('深链规划渲染无脏值', !/undefined|NaN|\[object Object\]/.test(html));
    } finally {
        rst.pl = keepPl;
    }

    /* v13 迁移只增不改：老订单/老路由/老班次一个字不动，新枢纽/网点/班线/示例路由补齐 */
    const oldRoute = { id: 'RT0001', origin: '上海', destination: '成都', segments: [{ seq: 1, from: '上海网点', to: '上海分拨中心', legType: 'collect', km: 12, stdHours: 3 }], totalStdHours: 30, status: 'active' };
    const oldOrder = { id: 'HL0001', origin: '上海', destination: '成都', hubFrom: 'HB0001', status: 'signed' };
    const oldTrip = { id: 'TRP0001', fromHub: 'HB0001', toHub: 'HB0002', mode: '陆运', status: 'active' };
    const raw = {
        schema: 12, createdAt: '', seededAt: '', counters: {}, auditAnchor: '',
        data: {
            hubs: [{ id: 'HB0001', name: '上海分拨中心', city: '上海', zone: '华东', role: '区域枢纽', status: 'active' }],
            branches: [
                { id: 'BR0001', name: '上海青浦营业部', city: '上海', hubId: 'HB0001', hubName: '上海分拨中心', status: 'active' },
                { id: 'BR0002', name: '南京城中营业部', city: '南京', hubId: 'HB0001', hubName: '上海分拨中心', status: 'active' }
            ],
            trips: [util.clone(oldTrip)], routes: [util.clone(oldRoute)], orders: [util.clone(oldOrder)]
        }
    };
    TMS.migrations[13](raw, TMS);
    check('v13 补齐九枢纽且老枢纽补标级', raw.data.hubs.length === 9 && raw.data.hubs[0].level === 1);
    check('v13 新开四网点且编号续 max 不撞号', raw.data.branches.length === 6 &&
        raw.data.branches.some((b) => b.city === '定西' && /陇西县/.test(b.name)) &&
        raw.data.branches.some((b) => b.city === '嘉兴' && /海宁市/.test(b.name)) &&
        new Set(raw.data.branches.map((b) => b.id)).size === 6);
    check('v13 老订单/老路由/老班次原样保留', JSON.stringify(raw.data.orders[0]) === JSON.stringify(oldOrder) &&
        JSON.stringify(raw.data.routes[0]) === JSON.stringify(oldRoute) &&
        JSON.stringify(raw.data.trips[0]) === JSON.stringify(oldTrip));
    check('v13 示例四路由落表且经分级链路', raw.data.routes.length === 5 &&
        raw.data.routes.some((r) => r.origin === '定西' && r.destination === '嘉峪关' &&
            (r.segments || []).some((s) => s.from === '兰州跨省分拣中心' || s.to === '兰州跨省分拣中心')) &&
        raw.data.routes.some((r) => r.origin === '嘉峪关' && r.destination === '嘉兴' &&
            (r.segments || []).some((s) => s.to === '杭州跨省分拣中心')));
    check('v13 新枢纽班线双向补齐', raw.data.trips.some((t) => t.fromHub === 'HB0008' && t.toHub === 'HB0009') &&
        raw.data.trips.some((t) => t.fromHub === 'HB0009' && t.toHub === 'HB0008'),
        raw.data.trips.length + ' 条班次');

    /* v14 南京升一级：只增不改，南京建档 + 双向班线 + 网点归口刷新，业务单依旧一字不动 */
    const tripsBeforeV14 = raw.data.trips.length;
    TMS.migrations[14](raw, TMS);
    check('v14 南京跨省分拣中心建档标一级', raw.data.hubs.length === 10 &&
        raw.data.hubs.some((h) => h.id === 'HB0010' && h.name === '南京跨省分拣中心' && h.level === 1));
    check('v14 网点归口刷新南京/合肥挂南京枢纽', raw.data.branches[1].hubId === 'HB0010' && raw.data.branches[0].hubId === 'HB0001');
    check('v14 南京班线双向补齐含武汉/杭州干线', raw.data.trips.length > tripsBeforeV14 &&
        raw.data.trips.some((t) => t.fromHub === 'HB0004' && t.toHub === 'HB0010' && t.mode === '陆运') &&
        raw.data.trips.some((t) => t.fromHub === 'HB0010' && t.toHub === 'HB0009' && t.mode === '陆运') &&
        raw.data.trips.some((t) => t.fromHub === 'HB0010' && t.toHub === 'HB0004'),
        raw.data.trips.length + ' 条班次');
    check('v14 老订单/老路由/首条班次仍原样', JSON.stringify(raw.data.orders[0]) === JSON.stringify(oldOrder) &&
        JSON.stringify(raw.data.routes[0]) === JSON.stringify(oldRoute) &&
        JSON.stringify(raw.data.trips[0]) === JSON.stringify(oldTrip));
    check('v14 幂等：重放不再增行', (function () {
        const n = { hubs: raw.data.hubs.length, branches: raw.data.branches.length, trips: raw.data.trips.length };
        TMS.migrations[14](raw, TMS);
        return raw.data.hubs.length === n.hubs && raw.data.branches.length === n.branches && raw.data.trips.length === n.trips;
    })());
})();

section('派送地址审核闭环');
(() => {
    const AD = TMS.address;
    const rows = db.col('addresses');
    const revs = db.col('addressReviews');
    check('地址档案有内容', rows.length > 0, `${rows.length} 条 / 审核记录 ${revs.length} 条`);
    const badStatus = rows.filter((a) => AD.FLOW.indexOf(a.status) < 0);
    check('状态全部落在四级流程内', badStatus.length === 0, badStatus.map((a) => a.status).join(','));
    const missing = AD.FLOW.filter((s) => !rows.some((a) => a.status === s));
    check('四级状态各有样本', missing.length === 0, missing.length ? '缺 ' + missing.join(',') :
        AD.FLOW.map((s) => s + ':' + rows.filter((a) => a.status === s).length).join(' '));
    check('手机号都是 11 位', rows.filter((a) => !/^1\d{10}$/.test(String(a.phone))).length === 0);

    /* 图2 的记录规则是硬口径：打回只留审核记录（地址一个字没动，不该凭空造快照），
       通过必须同时留审核 + 审查（要知道放行的是哪一版）。写错了追责链就断 */
    const approved = rows.filter((a) => a.status === 'approved');
    const apNoReview = approved.filter((a) => !AD.reviewsOf(a.id).some((r) => r.kind === AD.KIND.review));
    check('通过的地址都有审核结论', apNoReview.length === 0, apNoReview.length + ' 条缺失');
    const apNoSnap = approved.filter((a) => !AD.reviewsOf(a.id).some((r) => r.kind === AD.KIND.inspect && r.snapshot));
    check('通过的地址都留了通过版快照', apNoSnap.length === 0, apNoSnap.length + ' 条缺失');
    check('通过的地址都有审核人与时间',
        approved.filter((a) => !a.reviewer || !a.approvedAt).length === 0);
    const reviseRows = rows.filter((a) => a.status === 'revise');
    check('待修改的地址都写了打回原因', reviseRows.filter((a) => !a.rejectReason).length === 0);
    const badAfterReject = reviseRows.filter((a) => {
        const list = AD.reviewsOf(a.id);
        const last = list[list.length - 1];
        return !last || last.kind !== AD.KIND.review;
    });
    check('打回后停在审核记录，没有多余快照', badAfterReject.length === 0, badAfterReject.map((a) => a.id).join(','));
    check('按手机号只取到已通过的地址',
        approved.length === 0 || AD.byPhone(approved[0].phone).every((a) => a.status === 'approved'));
    const notApproved = rows.filter((a) => a.status !== 'approved')[0];
    check('未通过的地址不会被 byPhone 放行',
        !notApproved || !AD.byPhone(notApproved.phone).some((a) => a.id === notApproved.id));

    /* 状态机的三条拒绝线：通过件不能直接改、待修改件不能被审核、打回必须写原因。
       少一条，页面就能造出图2 里不存在的跳变 */
    const anyApproved = approved[0];
    check('已通过的地址禁止直接修改',
        !anyApproved || AD.maintain(anyApproved.id, { address: anyApproved.detail }).ok === false);
    check('待修改的地址禁止直接审核',
        !reviseRows[0] || AD.review(reviseRows[0].id, { action: 'approve' }).ok === false);
    check('打回不写理由一律拒绝',
        !AD.review(rows.filter((a) => a.status === 'pending')[0]?.id, { action: 'reject', reason: '' }).ok ||
        rows.filter((a) => a.status === 'pending').length === 0);

    // 全链跑一遍：新建 → 打回 → 修改 → 通过，落库状态与记录条数都要对得上
    const probe = AD.create({ phone: '13800001234', receiver: '冒烟', address: '哈尔滨市南岗区长江路 88 号 3 栋 301', actor: '网点' });
    if (probe.ok) {
        const pid = probe.row.id;
        const fresh = probe.row.status;
        /* 每一步都重新读一次：db.update 是就地改对象，
           拿创建时那个引用去断言中间态，最后看到的只会是终态 */
        const r1 = AD.review(pid, { action: 'reject', reason: '门牌号需与房产证一致', actor: '审核员' });
        const afterReject = AD.get(pid).status;
        const mid = AD.maintain(pid, { address: '哈尔滨市南岗区长江路 88 号 3 栋 301 室', actor: '网点' });
        const afterMaintain = AD.get(pid).status;
        const r2 = AD.review(pid, { action: 'approve', actor: '审核员' });
        const afterApprove = AD.get(pid).status;
        const dup = AD.create({ phone: '13800001234', address: '哈尔滨市南岗区长江路 88 号 3 栋 301 室' });
        check('同手机号同地址不重复建档', dup.ok === false && /已有同一条地址/.test(dup.message || ''), dup.message || '又建了一条');
        check('新建即待审核', fresh === 'pending', fresh);
        check('打回落到待修改', r1.ok && afterReject === 'revise', afterReject);
        check('改完自动进已修改', mid.ok && afterMaintain === 'revised', afterMaintain);
        check('复审通过', r2.ok && afterApprove === 'approved', afterApprove);
        const kinds = AD.reviewsOf(pid).map((x) => x.kind);
        check('一次通过留审核+审查双记录',
            kinds.filter((k) => k === AD.KIND.review).length === 2 &&
            kinds.filter((k) => k === AD.KIND.inspect).length >= 3,
            `${kinds.filter((k) => k === AD.KIND.review).length} 审核 / ${kinds.filter((k) => k === AD.KIND.inspect).length} 审查`);
        const dec = AD.phoneDecision('13800001234');
        check('通过后按手机号可派送', dec.canDeliver && dec.via === '维护地址', dec.note);
        const reop = AD.reopen(pid, '运营');
        check('通过后可发起复审', reop.ok && AD.get(pid).status === 'pending', AD.get(pid).status);
        AD.remove(pid);
        check('删除地址同时清掉审核记录',
            !AD.get(pid) && AD.reviewsOf(pid).length === 0);
    } else {
        check('新建即待审核', false, '建档失败：' + probe.message);
    }

    /* 维护边界（图2 的派送员支线）：只动自己采集的那条，别人建档的读得到、改不了；
       网点与运营端整城在册，不受这条限制。通过后改内容一律退回待审核 */
    const courierAdr = rows.filter((a) => a.source === '派送员采集' && a.owner && a.owner !== '派送员');
    check('建档把派送员采集的行落到真实派送员名下', courierAdr.length > 0, courierAdr.length + ' 条');
    const demoCourierName = (TMS.cfg.demoAccounts.filter((a) => a.role === 'deliveryman')[0] || {}).name;
    check('演示派送员端有自己采集的地址可维护',
        rows.some((a) => a.owner === demoCourierName),
        demoCourierName + ' 名下 ' + rows.filter((a) => a.owner === demoCourierName).length + ' 条 / 采集在档 ' + courierAdr.length + ' 条');
    const branchAdr = rows.filter((a) => a.source === '网点维护')[0];
    check('派送员改不动网点建档的地址',
        !branchAdr || AD.maintainScope(branchAdr, '冒牌采集人', 'deliveryman').ok === false);
    check('网点端不受采集人限制',
        !courierAdr[0] || AD.maintainScope(courierAdr[0], '网点管理员', 'branch').ok);
    const ownProbe = AD.create({
        phone: '13900002222', receiver: '冒烟复审', address: '上海市浦东新区世纪大道 100 号 1 栋 101',
        actor: '张三', role: 'deliveryman', source: '派送员采集'
    });
    if (ownProbe.ok) {
        const aid = ownProbe.row.id;
        AD.review(aid, { action: 'approve', actor: '审核员' });
        const edited = AD.maintain(aid, { address: '上海市浦东新区世纪大道 100 号 1 栋 102', actor: '张三', role: 'deliveryman', force: true });
        check('通过后改内容退回待审核', edited.ok && AD.get(aid).status === 'pending', AD.get(aid).status);
        check('退回待审核时上一轮结论一并清空', !AD.get(aid).reviewer && !AD.get(aid).reviewedAt);
        AD.review(aid, { action: 'approve', actor: '审核员' });
        const byBranch = AD.maintain(aid, { address: '上海市浦东新区世纪大道 100 号 1 栋 103', actor: '网点管理员', role: 'branch', force: true });
        check('采集人与最后维护人分开留痕',
            byBranch.ok && AD.get(aid).owner === '张三' && AD.get(aid).maintainer === '网点管理员',
            AD.get(aid).owner + ' / ' + AD.get(aid).maintainer);
        check('网点替改之后派送员仍改得回去', AD.maintainScope(AD.get(aid), '张三', 'deliveryman').ok);
        const other = AD.maintain(aid, { address: '上海市浦东新区世纪大道 100 号 1 栋 104', actor: '李四', role: 'deliveryman' });
        check('别的派送员改不动这条', other.ok === false && /只能改自己上门采集/.test(other.message || ''), other.message || '居然改动了');
        AD.remove(aid);
    } else {
        check('通过后改内容退回待审核', false, '建档失败：' + ownProbe.message);
    }

    const st = AD.stats(30);
    const sumStatus = AD.FLOW.reduce((t, s) => t + (st.byStatus[s] || 0), 0);
    /* 队列统计必须覆盖全库：一旦按「近 N 天」过滤，40 天前建的待审核件会从 KPI 上消失，
       而台账和待办队列里还挂着它——页面就会出现「卡片 3 条、列表 12 条」 */
    check('stats 分状态加总等于在档总量', sumStatus === st.total && st.total === db.col('addresses').length,
        `${sumStatus} / ${st.total} / ${db.col('addresses').length}`);
    check('状态计数与库里逐行一致',
        st.pending === db.col('addresses').filter((a) => a.status === 'pending').length &&
        st.approved === db.col('addresses').filter((a) => a.status === 'approved').length,
        `待审核 ${st.pending} / 通过 ${st.approved}`);
    check('窗口新建量只统计窗口内的建档', st.recent <= st.total, `${st.recent} / ${st.total}`);
    check('审核通过率在 0~100', st.passRate >= 0 && st.passRate <= 100, st.passRate + '%');
    check('一次通过率不高于总通过率 + 容差', st.firstPassRate <= 100, st.firstPassRate + '%');
    check('超时件都能落到某一类', st.overdue + st.stuck <= st.pending + st.revise,
        `审核超时 ${st.overdue} / 返工超时 ${st.stuck}`);
    log(`  建档 ${st.total} · 待审核 ${st.pending} · 待修改 ${st.revise} · 已修改 ${st.revised} · 通过 ${st.approved}` +
        `（超时 ${st.overdue} / 返工压单 ${st.stuck}）· 近 ${st.days} 天建档 ${st.recent} · 审核 ${st.reviews} 轮` +
        ` · 通过率 ${st.passRate}% · 一次通过 ${st.firstPassRate}% · 平均 ${st.avgReviewHours}h`);

    /* 图2 的「定时通知」：打回的行要生成指向有维护权限之人的告警，且核销要跟着状态走 */
    TMS.jobs.sweep();
    const fixAlerts = db.col('alerts').filter((a) => a.status === 'open' && String(a.key).indexOf('addr:fix:') === 0);
    check('待修改地址都发出了通知', fixAlerts.length === reviseRows.length,
        `${fixAlerts.length} 条 / 待修改 ${reviseRows.length} 条`);
    check('通知写给有维护地址权限的人',
        !fixAlerts.length || fixAlerts.every((a) => a.owner && a.owner.indexOf('网点') > -1),
        fixAlerts.length ? fixAlerts[0].owner : '无');
    const backlogAlerts = db.col('alerts').filter((a) => a.status === 'open' && String(a.key).indexOf('addr:backlog:') === 0);
    check('待审核超时告警与超时数一致', backlogAlerts.length === st.overdue,
        `${backlogAlerts.length} / ${st.overdue}`);
    const beforeResolve = fixAlerts.length;
    if (reviseRows.length) {
        const one = reviseRows[0];
        AD.maintain(one.id, { address: one.city + '市' + one.district + '解放大道 1 号 2 栋 3 室', actor: '网点' });
        TMS.jobs.run('addressReview');
        const still = db.col('alerts').filter((a) => a.status === 'open' && a.key === 'addr:fix:' + one.id);
        check('地址改完通知自动撤销', still.length === 0, `${beforeResolve} → ${fixAlerts.length}`);
    } else {
        check('地址改完通知自动撤销', true, '无待修改样本');
    }
})();

section('电子围栏勾画与三类围栏');
/* 围栏要能回答图1 的三个问题：到没到（到货围栏）、送不送（机构派送围栏）、谁去送（派送员编号围栏）。
   这里只测几何与领域层：种子是不是真多边形、判定打在哪一层、缺口的城市会不会如实落到「不派送」 */
(() => {
    const GF = TMS.cfg.fence;
    const net = TMS.network;
    const fences = db.col('geofences');
    /* 面积公式自己得先有基准：拿 1°×1° 方环对拍。
       鞋带式的 ½ 在累加里多写一次，全站围栏面积就集体少一半，而业务断言看不出来 */
    const degKm = Math.PI / 180 * 6371;
    const sq = [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 1, lng: 1 }, { lat: 1, lng: 0 }];
    check('面积公式对得上 1°×1° 方环', Math.abs(util.ringAreaKm2(sq) - degKm * degKm) < 3,
        `${util.ringAreaKm2(sq)} km² / 理论 ${Math.round(degKm * degKm)}`);
    const sqNorth = sq.map((p) => ({ lat: p.lat + 31, lng: p.lng }));
    check('纬度收缩按整环均值算', Math.abs(util.ringAreaKm2(sqNorth) - degKm * degKm * Math.cos(31.5 * Math.PI / 180)) < 3,
        `${util.ringAreaKm2(sqNorth)} km²（同形状挪到 31°N）`);
    const byType = {};
    fences.forEach((g) => { byType[g.type] = (byType[g.type] || 0) + 1; });
    check('三类围栏都有种子', GF.TYPES.every((t) => byType[t] > 0),
        GF.TYPES.map((t) => `${t} ${byType[t] || 0}`).join(' / '));

    const badRing = fences.filter((g) => !Array.isArray(g.polygon) || g.polygon.length < GF.minPoints || g.polygon.length > GF.maxPoints);
    check('每张围栏都是 3~40 顶点的勾画环', badRing.length === 0, badRing.length ? badRing[0].id : `${fences.length} 张`);
    const vtx = fences.map((g) => g.polygon.length);
    check('顶点数不是整齐划一的矩形', Math.max(...vtx) > Math.min(...vtx), `最少 ${Math.min(...vtx)} / 最多 ${Math.max(...vtx)}`);
    const noArea = fences.filter((g) => !(Number(g.areaKm2) > 0));
    check('面积由顶点环反算', noArea.length === 0, noArea.length ? noArea[0].id : `如 ${fences[0].name} ${fences[0].areaKm2} km²`);

    /* 圆心必须真在圈内：判定用射线法，而地图定位、面积、越界建议半径都读这个点。
       点跑到环外就会出现「地图上看着罩住了、系统说没罩住」 */
    const offCenter = fences.filter((g) => !util.pointInRing(g.center, g.polygon));
    check('围栏中心落在自己的边界内', offCenter.length === 0, offCenter.map((g) => g.id + '/' + g.name).join('，') || `${fences.length} 张`);

    // 罩住本市：作业围栏的锚点就是城市中心，勾完还罩不住自己城市等于白勾
    const missCity = fences.filter((g) => g.type !== 'courier' && g.status === 'active')
        .filter((g) => !net.pointInFence(TMS.master.cityByName(g.city), g));
    check('在用作业/到货围栏罩住本市', missCity.length === 0, missCity.map((g) => g.city).join('，') || '全部');

    const badScale = fences.filter((g) => {
        const expect = Math.PI * Math.pow(g.radiusM / 1000, 2);
        return g.areaKm2 < expect * 0.35 || g.areaKm2 > expect * 2.2;
    });
    check('面积与半径同量级', badScale.length === 0, badScale.length
        ? badScale.slice(0, 3).map((g) => `${g.name} r=${g.radiusM} A=${g.areaKm2} 倍=${Math.round(g.areaKm2 / (Math.PI * Math.pow(g.radiusM / 1000, 2)) * 100) / 100}`).join(' | ')
        : '勾画半径没有被写成两个数量级');

    const emp = db.col('employees');
    const badCourier = fences.filter((g) => g.type === 'courier')
        .filter((g) => { const e = emp.find((x) => x.id === g.refId); return !e || e.role !== 'deliveryman'; });
    check('编号围栏绑的都是在册派送员', badCourier.length === 0, badCourier.map((g) => g.refId).join('，') ||
        `${byType.courier} 张`);

    /* 只填半径的老数据要还能判：勾画是升级，不是把圆判定删掉 */
    const fake = { id: 'GFTEST', name: '测试圆围栏', type: 'branch', city: '上海', center: { lat: 31.23, lng: 121.47 }, radiusM: 5000, status: 'active' };
    check('无边界时退回半径判定', net.pointInFence({ lat: 31.24, lng: 121.48 }, fake) && !net.pointInFence({ lat: 31.6, lng: 121.9 }, fake),
        '5km 内命中 / 40km 外不命中');
    check('命中围栏按类型问', (() => {
        const c = TMS.master.cityByName(fences.find((g) => g.type === 'hub' && g.status === 'active').city);
        const hub = net.fenceAt(c, 'hub'), br = net.fenceAt(c, 'branch');
        return hub && br && hub.id !== br.id;
    })(), '同一座城能分别问到到货围栏与派送围栏');

    // 图1 左支：没有维护地址时，派送围栏决定「送 / 自提」
    const audit = net.fenceAudit(30);
    const gap = fences.find((g) => g.status === 'disabled');
    check('留出一座停用围栏的作业城市', !!gap, gap ? gap.city + '（网点 ' + db.col('branches').filter((b) => b.city === gap.city).length + ' 个）' : '无');
    if (gap) {
        const covered = net.fenceOfCity(gap.city, 'branch');
        check('停用后该市判为不可派送', !covered, covered ? covered.name : gap.city + ' 已无在用派送围栏');
        const dec = TMS.address.phoneDecision('19900001111', gap.city + '市某某区某某路 1 号');
        check('图1 左支：围栏外走自提', dec.canDeliver === false && dec.blocked === 'fence', dec.note);
        const other = fences.find((g) => g.type === 'branch' && g.status === 'active');
        const dec2 = TMS.address.phoneDecision('19900002222', other.city + '市某某区某某路 2 号');
        check('图1 左支：围栏内可按字面地址派送', dec2.canDeliver === true && dec2.via === '机构派送围栏', dec2.note);
    }
    check('覆盖城市数=服务城市数-缺口', audit.coveredCities === audit.cityCount - (gap ? 1 : 0),
        `${audit.coveredCities}/${audit.cityCount}，在用 ${audit.activeRows} 张`);

    /* 派单这一步读的是图1 整条链：dispatchOf 只算不写，
       收件城市有没有罩得住的派送围栏、编号围栏罩得住收件点，决定界面默认勾谁、能不能送。
       收件点取城市质心——判定链与巡检用的同一个口径，演示数据没有区级地理编码 */
    const cityInCourierFence = (c) => {
        const p = TMS.master.cityByName(c);
        return !!p && !!net.fenceAt(p, 'courier');
    };
    const courierCities = util.unique(fences.filter((g) => g.type === 'courier' && g.status === 'active').map((g) => g.city));
    const plans = courierCities.map((c) => TMS.order.dispatchOf({ destination: c, receiverPhone: '19900003333', receiverAddress: c + '市某某区某某路 9 号' }));
    check('派单判定只在收件点真被片区罩住时才给派送员',
        plans.every((d) => !d.courierId || d.courierId === (net.fenceAt(TMS.master.cityByName(d.city), 'courier') || {}).refId),
        `${courierCities.length} 座有片区的城市里 ${plans.filter((d) => d.courierId).length} 座自动绑`);
    check('罩不住片区时给最近片区候选而不是猜人',
        plans.filter((d) => !d.courierId).every((d) => d.courierVia === '需手动指定派送编号' && d.suggestId && d.suggestKm > 0),
        plans.filter((d) => !d.courierId).slice(0, 3).map((d) => d.city + '→' + d.suggest + ' ' + d.suggestKm + 'km').join(' ') || '全部自动绑');
    const noBindCity = util.unique(fences.filter((g) => g.type === 'branch' && g.status === 'active').map((g) => g.city))
        .find((c) => !cityInCourierFence(c) && !!net.fenceOfCity(c, 'branch'));
    if (noBindCity) {
        const d = TMS.order.dispatchOf({ destination: noBindCity, receiverPhone: '19900004444', receiverAddress: noBindCity + '市某某区某某路 9 号' });
        check('落不进编号围栏就不绑人', d.canDeliver && !d.courierId && d.courierVia === '需手动指定派送编号',
            noBindCity + ' → ' + d.courierVia);
    }
    if (gap) {
        const d = TMS.order.dispatchOf({ destination: gap.city, receiverPhone: '19900005555', receiverAddress: gap.city + '市某某区某某路 9 号' });
        check('派单判定按派送围栏说清自提', d.canDeliver === false && d.blocked === 'fence', gap.city + '：' + d.deliverNote);
    }
    /* 单上已有编号时图1 右支直接结束，不再拿围栏去改派——已绑定的派送员不该被后台判定悄悄换掉 */
    const boundOrder = db.col('orders').find((o) => o.courierId && o.status !== 'cancelled');
    if (boundOrder) {
        const d = TMS.order.dispatchOf(boundOrder);
        check('已派单的订单沿用原编号', d.courierId === boundOrder.courierId && d.courierVia === '已有派送编号',
            `${boundOrder.id} → ${d.courier}`);
    }

    /* 缺口表是巡检与围栏页共用的口径：一次算出三类问题各自的城市，
       页面再各算一遍就会和告警对不上，谁去补勾也说不清 */
    const gaps = net.fenceGaps(30);
    check('缺口表按图1 三类问题分列',
        ['hubGap', 'deliverGap', 'courierGap', 'legacy', 'rows'].every((k) => Array.isArray(gaps[k])),
        `到货 ${gaps.hubGap.length} / 派送 ${gaps.deliverGap.length} / 编号 ${gaps.courierGap.length} / 待重勾 ${gaps.legacy.length}`);
    check('派送缺口城市确实没有在用派送围栏',
        gaps.deliverGap.every((r) => !net.fenceOfCity(r.city, 'branch')),
        gaps.deliverGap.map((r) => r.city).slice(0, 4).join('，') || '无缺口');
    check('编号缺口城市有派送员却没有编号围栏',
        gaps.courierGap.every((r) => r.couriers > 0 && r.courierFences === 0 && !!r.branchFence),
        gaps.courierGap.map((r) => r.city + '(' + r.couriers + '人)').slice(0, 4).join(' ') || '无缺口');
    check('停用围栏的作业城市进了派送缺口', !gap || gaps.deliverGap.some((r) => r.city === gap.city), gap ? gap.city : '无停用围栏');
    const fc = TMS.jobs.run('fenceCoverage').out || {};
    check('巡检按三类缺口分别出告警',
        fc.gap === gaps.deliverGap.length && fc.hubGap === gaps.hubGap.length && fc.courierGap === gaps.courierGap.length,
        `派送 ${fc.gap} / 到货 ${fc.hubGap} / 编号 ${fc.courierGap}`);
    const fcAlerts = db.col('alerts').filter((a) => a.status === 'open' && String(a.key).indexOf('fence:') === 0);
    check('围栏告警按问题分型落库',
        (!gaps.deliverGap.length || fcAlerts.some((a) => a.key.indexOf('fence:gap:') === 0)) &&
        (!gaps.hubGap.length || fcAlerts.some((a) => a.key.indexOf('fence:hub:') === 0)) &&
        (!gaps.courierGap.length || fcAlerts.some((a) => a.key.indexOf('fence:courier:') === 0)),
        fcAlerts.length + ' 条在用告警');
    /* 围栏改成勾画之后，巡检不能再教人去补半径圆——那是上一版的做法，也是这次要消掉的口径 */
    check('围栏告警不再建议按半径补圈',
        fcAlerts.every((a) => !/半径\s*\d+(\.\d+)?\s*km/.test(a.message)),
        fcAlerts.map((a) => a.title).slice(0, 3).join(' / '));

    // 图1 右支：收件点落进谁的编号围栏就自动绑谁，落不进要人工指定
    const cf = fences.find((g) => g.type === 'courier' && g.status === 'active');
    if (cf) {
        const hit = net.courierFenceAt(cf.center);
        check('图1 右支：编号围栏内自动绑派送员', !!hit && hit.courier.id === cf.refId,
            hit ? hit.courier.name + '（' + hit.courier.badge + '）← ' + cf.name : '未命中');
        check('图1 右支：围栏外不猜派送员', !net.courierFenceAt({ lat: -45, lng: 175 }), '需手动指定派送编号');
    } else {
        check('图1 右支：编号围栏内自动绑派送员', false, '种子没有在用编号围栏');
    }

    /* 勾画落库：saveFence 是唯一的写入口，页面不许自己拼对象写 db。
       顶点/圆心/面积/所在城市都要在落库前算齐，且留审计流水 */
    const courierEmp = emp.find((e) => e.role === 'deliveryman' && e.status === 'active');
    const otherEmp = emp.find((e) => e.role === 'transporter');
    const ring = [{ lat: 30.1, lng: 120.1 }, { lat: 30.2, lng: 120.3 }, { lat: 30.05, lng: 120.35 }, { lat: 29.98, lng: 120.18 }];
    const r1 = net.saveFence({ name: '冒烟勾画围栏', type: 'branch', city: '杭州', polygon: ring, radiusM: 0 }, '冒烟');
    check('勾画围栏可落库', r1.ok && r1.shape === 'polygon' && r1.row.polygon.length === 4 && r1.row.areaKm2 > 0,
        r1.ok ? `${r1.row.id} ${r1.row.areaKm2} km² / 反查城市 ${r1.row.city}` : r1.message);
    check('圆心反查所在城市', r1.ok && r1.row.city === '杭州', r1.row && r1.row.city);
    const auditHit = db.col('auditLogs').some((a) => a.entity === 'geofences' && String(a.refId) === String(r1.row && r1.row.id));
    check('围栏改动进审计流水', auditHit, auditHit ? '' : '未写入 auditLogs');
    const r2 = net.saveFence({ name: '坏围栏', type: 'warehouse', city: '杭州', radiusM: 1000 }, '冒烟');
    check('未知类型被拒', !r2.ok, r2.message);
    const r3 = net.saveFence({ name: '坏围栏', type: 'branch', city: '杭州', polygon: [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }] }, '冒烟');
    check('顶点不足被拒', !r3.ok, r3.message);
    const r4 = net.saveFence({ name: '坏围栏', type: 'branch', city: '杭州' }, '冒烟');
    check('没形状也没半径被拒', !r4.ok, r4.message);
    const r5 = net.saveFence({ name: '错绑围栏', type: 'courier', city: '杭州', radiusM: 800, refId: otherEmp.id }, '冒烟');
    check('编号围栏不许绑非派送员', !r5.ok, r5.message);
    const r6 = net.saveFence({ name: '编号围栏', type: 'courier', city: '杭州', radiusM: 800, refId: courierEmp.id }, '冒烟');
    check('编号围栏可改半径落库', r6.ok && r6.shape === 'circle' && r6.row.refId === courierEmp.id,
        r6.ok ? `${r6.row.name} 半径 ${r6.row.radiusM}m` : r6.message);
    const inside = net.fencesOfCourier(courierEmp.id).length;
    check('按派送员反查在用编号围栏', inside >= 1, `${courierEmp.name} 名下 ${inside} 张`);
    /* 半径圆没有圆心时按所属城市中心补齐，否则这张圈谁都判不中，界面上却写着「在用」 */
    check('半径围栏自动补出圆心', r6.ok && !!r6.row.center && net.pointInFence(r6.row.center, r6.row),
        r6.ok ? `${r6.row.city} · 半径 ${r6.row.radiusM}m` : '未落库');
    /* 自动绑那一格要有真数据才验得出来：现勾一张罩得住市中心的片区，
       派单判定就必须把那位派送员交出来——罩不住就不给，前面已经验过 */
    const bindCityRow = TMS.master.CITIES.find((c) => !net.fenceAt(c, 'courier') && !!net.fenceOfCity(c.name, 'branch'));
    const bindEmp = emp.find((e) => e.role === 'deliveryman' && e.status === 'active' && e.city === (bindCityRow || {}).name) || courierEmp;
    const r7 = bindCityRow && net.saveFence({
        name: '冒烟市中心片区', type: 'courier', city: bindCityRow.name,
        polygon: util.blobRing(bindCityRow, 3500, () => 0.5), refId: bindEmp.id
    }, '冒烟');
    const dBind = r7 && r7.ok && TMS.order.dispatchOf({
        destination: bindCityRow.name, receiverPhone: '19900006666', receiverAddress: bindCityRow.name + '市某某区某某路 9 号'
    });
    check('勾一张罩住收件点的片区后派单自动绑编号',
        !!dBind && dBind.courierId === bindEmp.id && dBind.courierVia === '编号围栏自动绑定',
        dBind ? bindCityRow.name + ' → ' + dBind.courier + '（' + dBind.fenceName + '）' : '准备不出可绑片区');
    const del1 = net.removeFence(r1.row.id, '冒烟'), del2 = net.removeFence(r6.row.id, '冒烟');
    const del3 = r7 && r7.ok ? net.removeFence(r7.row.id, '冒烟') : { ok: false };
    check('围栏可删除', del1.ok && del2.ok && del3.ok && !db.get('geofences', r1.row.id) && !db.get('geofences', r7.row.id),
        `${GF.TYPES.length} 类均可增删改`);
    check('删不存在的围栏有回话', !net.removeFence('GF9999', '冒烟').ok, net.removeFence('GF9999', '冒烟').message);
    net.invalidateCache();
    log(`  围栏分布：${GF.TYPES.map((t) => GF.LABEL[t] + ' ' + (byType[t] || 0) + ' 张').join(' / ')}；停用缺口 ${gap ? gap.city : '无'}`);
})();

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
        'stats.customerRanking': () => TMS.stats.customerRanking(10),
        'stats.scanStats': () => TMS.stats.scanStats(7),
        'stats.systemStats': () => TMS.stats.systemStats(),
        'stats.overtimeStats': () => TMS.stats.overtimeStats(30),
        'stats.overtimeRows': () => TMS.stats.overtimeRows(14),
        'address.stats': () => TMS.address.stats(30),
        'address.parse': () => TMS.address.parse('哈尔滨市南岗区长江路 88 号 3 栋 301'),
        'address.phoneDecision': () => TMS.address.phoneDecision((db.col('addresses')[0] || {}).phone),
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
        'network.loadPlan': () => TMS.network.loadPlan(orders.slice(0, 12), TMS.master.vehicleType('MID')),
        'network.deviates': () => TMS.network.deviates(TMS.network.planRoute('上海', '成都', '标准', { noCache: true }), '上海', '哈尔滨'),
        'audit.actionOptions': () => TMS.audit.actionOptions(),
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
    /* 档位分布直接按账期现算：绩效页用的就是这个口径（util.countBy(rows,'grade')），
       断言跟着页面走，不依赖某个只有测试在调的聚合函数 */
    const perfRows = db.col('performances').filter((p) => p.period === perfMonth);
    const dCount = perfRows.filter((p) => p.grade === 'D').length;
    const avgScore = perfRows.length ? util.round(util.sum(perfRows, 'score') / perfRows.length, 1) : 0;
    check('绩效账期唯一且走关账规则', perfPeriods.length === 1 && perfMonth === TMS.people.defaultPeriod(), perfPeriods.join(' '));
    check('绩效账期不落进刚开头的月份', perfMonth !== util.monthKey(util.now()) || dayOfToday >= 14,
        perfMonth + ' · 今日 ' + util.dateKey(util.now()));
    /* 种子单量有随机抖动，D 档占比常态贴着 59%–60%：阈值卡 0.6 会把正常抖动误判成塌档，
       0.65 仍能抓住「账期落进月初、全员塌 D」这类真一边倒 */
    check('绩效档位分布不是一边倒', perfRows.length > 0 && dCount / perfRows.length < 0.65,
        perfMonth + ' · ' + perfRows.length + ' 人 · 均分 ' + avgScore + ' · D 档 ' + dCount + ' 人 · 覆盖 ' +
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

section('UI 层与页面注册器');
/* UI 模块在无浏览器环境下只做字符串渲染，这里验三件事：
   能装配、管线正确、渲染结果不泄露内部字段（undefined/NaN/裸 ID 都是字段名抄错的信号） */
check('外壳与注册器已装配', !!(TMS.ui && TMS.charts && TMS.shell && TMS.pages));
/* ui.confirm 的按钮监听里先 close() 还是先 finish()，决定「点确定」到底算不算同意：
   close() 会同步触发 onClose→finish(false)，顺序写反就是全站 confirm 门控的写操作静默失效。
   Node 桩没有真实事件冒泡，跑不了这条行为测试，只能钉源码顺序（浏览器里已实测过反面） */
(() => {
    const kitSrc = fs.readFileSync(path.join(ROOT, 'js/ui/kit.js'), 'utf8');
    const block = (kitSrc.match(/function confirm\(opts\)[\s\S]*?\n    \}/) || [''])[0];
    const iYes = block.indexOf('finish(yes)');
    const iClose = block.indexOf('handle.close()');
    check('ui.confirm 先定结论再关弹窗', iYes > -1 && iClose > -1 && iYes < iClose,
        'finish@' + iYes + ' / close@' + iClose);
})();
/* 环形图图例每项两行（名称 + 数值·占比）：行距小于两行全高时，
   数值行会被下一项名称压住——渲染字符串看不出重叠，只能按几何坐标钉死 */
(() => {
    const data = Array.from({ length: 8 }, (_, i) => ({ label: '类目' + (i + 1), value: (i + 1) * 137 }));
    const html = TMS.charts.donut({ data: data, height: 210, fmt: (v) => v + ' 条' });
    const vh = Number((html.match(/viewBox="0 0 720 ([\d.]+)"/) || [])[1]);
    const ys = [...html.matchAll(/<text x="([\d.]+)" y="([\d.]+)"/g)]
        .filter((m) => Number(m[1]) > 220).map((m) => Number(m[2]));
    check('环形图 8 项图例画布自适应加高', vh >= 8 * 28 + 26, 'viewBox 高 ' + vh);
    check('环形图图例名称/数值两行互不遮挡',
        ys.length === 16 && ys.every((y, i) => i % 2 ? y - ys[i - 1] === 13 : (i === 0 || y - ys[i - 1] >= 15)),
        ys.length + ' 行文字 / 相邻基线距 ' + (ys[2] - ys[1]));
    check('环形图图例不出画布上下边', ys.length > 0 && ys[0] > 10 && ys[ys.length - 1] + 3 <= vh,
        '首行 ' + ys[0] + ' / 末行 ' + ys[ys.length - 1] + ' / 画布 ' + vh);
    const few = TMS.charts.donut({ data: data.slice(0, 2), height: 230 });
    const fewH = Number((few.match(/viewBox="0 0 720 ([\d.]+)"/) || [])[1]);
    check('环形图少项时不强行加高', fewH === 230, 'viewBox 高 ' + fewH);
})();
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
    /* 冒烟直接 require 模块、不执行 boot.js，所以 TMS.boot 这份装配事实得由冒烟补上：
       架构页的「落地核对」读的就是它，缺了会把十个服务的模块映射全判成漂移 */
    TMS.boot = { modules: declared };
    /* 模块清单是站点根相对路径，注入前必须乘上从 boot.js 自身 src 反推的基准；
       少了这一步，角色目录下的页面会去加载 tms/js/core/config.js 然后白屏 */
    check('boot 按自身 src 反推站点基准', /TMS\.base\s*=\s*BASE/.test(bootSrc) && /BASE \+ path/.test(bootSrc));
})();
check('注册表与菜单文件同源', TMS.pages.MENU_FILE['overview'] === 'tms/index.html' && TMS.pages.MENU_FILE['b-home'] === 'branch/index.html');

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

    const stray = fs.readdirSync(ROOT).filter((n) => /\.html$/.test(n) && n !== 'index.html' && n !== 'architecture.html');
    check('站点根只留登录入口与公开架构页，业务页全部进目录', stray.length === 0, stray.join('、') || 'index.html + architecture.html');

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

/* 页脚署名与移动壳底栏契约：这两处都是「一处写错、71 页同时出问题」的全站约定，
   出图时又最难被察觉（署名漏了看不出、底栏盖住尾屏内容要点到底部才发现） */
(() => {
    const site = TMS.cfg.brand.site, author = TMS.cfg.brand.author;
    check('署名文案与链接在配置里单点维护', !!author && /^https:\/\//.test(String(site || '')), author + ' · ' + site);
    const src = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const kitSrc = src('js/ui/kit.js'), shellSrc = src('js/ui/shell.js'), css = src('css/app.css');
    check('ui.copyright 已导出', /copyright:\s*copyright/.test(kitSrc) && /function copyright/.test(kitSrc));
    const wired = (shellSrc.match(/ui\.copyright\(\)/g) || []).length;
    check('三套外壳都落署名页脚', wired === 3, wired + '/3 处');
    check('登录页复用同一份署名组件', /TMS\.ui\.copyright\(\)/.test(src('index.html')));
    check('署名样式有收口且外链新窗口打开',
        /\.tms-copyright\s*\{/.test(css) && /rel="noopener/.test(kitSrc));
    /* 底栏一旦回到 position:fixed，正文就得靠写死的 padding-bottom 让位；
       历史上那个选择器写成了 .tms-body.tms-shell-mobile（壳类名在内层 div 上，永不命中），
       分拣·司机·派送三端的尾屏内容因此被盖住，这里同时锁死选择器和定位方式 */
    const tabbar = /\.tms-tabbar\s*\{([^}]*)\}/.exec(css);
    check('移动底栏吸底不遮正文', !!tabbar && /position:\s*sticky/.test(tabbar[1]) && !/position:\s*fixed/.test(tabbar[1]),
        tabbar ? (tabbar[1].trim().split('\n')[0] || '') : '规则缺失');
    check('移动正文按壳层类名留白',
        /\.tms-shell-mobile \.tms-content\s*\{/.test(css) && !/\.tms-body\.tms-shell-mobile/.test(css));
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
    const v11Courier = ['overview:view', 'order:view', 'order:create', 'tracking:view', 'scan:operate',
        'delivery:operate', 'delivery:pod', 'cod:remit', 'exception:create', 'report:view'];
    const roles = [
        { code: 'branch', builtin: true, permissionCodes: v8.slice() },
        { code: 'branch', builtin: true, permissionCodes: v8.slice(0, 6) },
        { code: 'client', builtin: true, permissionCodes: v8.slice() },
        { code: 'deliveryman', builtin: true, permissionCodes: v11Courier.slice() },
        { code: 'deliveryman', builtin: true, permissionCodes: ['overview:view', 'report:view'] }
    ];
    /* 从 v9 一路跑到当前版本，而不是只跑最后一步：每加一版权限迁移，上一版写死的
       fixture 就不再命中判定线（长度不同直接 return），只测末步会假通过成「迁移没跑」 */
    for (let v = 9; v <= TMS.cfg.storage.schema; v++) TMS.migrations[v]({ data: { roles: roles } }, TMS);
    const shipped = TMS.rbac.defaultPerms('branch');
    check('权限迁移只补出厂权限、不覆盖手工勾过的组合',
        shipped.every((p) => roles[0].permissionCodes.indexOf(p) > -1) &&
        roles[1].permissionCodes.length === 6 && roles[2].permissionCodes.length === v8.length &&
        roles[4].permissionCodes.length === 2,
        'branch ' + roles[0].permissionCodes.length + ' 项 / 定制 ' + roles[1].permissionCodes.length + ' 项');
    check('派送员老库升到 v12 拿到地址维护权',
        roles[3].permissionCodes.indexOf('address:manage') > -1 &&
        roles[3].permissionCodes.length === TMS.rbac.defaultPerms('deliveryman').length,
        '派送员 ' + roles[3].permissionCodes.length + ' 项');
    check('派送员出厂权限含地址维护、不含地址审核',
        TMS.rbac.defaultPerms('deliveryman').indexOf('address:manage') > -1 &&
        TMS.rbac.defaultPerms('deliveryman').indexOf('address:review') === -1);
    check('派送员端菜单挂了派送地址页',
        TMS.rbac.PORTAL_MENU.deliveryman.some((i) => i.id === 'd-address' && i.perm === 'address:manage') &&
        !!TMS.pages.get('d-address'), TMS.pages.get('d-address') ? TMS.pages.get('d-address').file : '未注册');
    check('网点出厂权限含分拣交接', TMS.rbac.defaultPerms('branch').indexOf('sorting:operate') > -1);
    check('网点出厂权限含地址维护', TMS.rbac.defaultPerms('branch').indexOf('address:manage') > -1);
    check('网点出厂权限含本城围栏维护', TMS.rbac.defaultPerms('branch').indexOf('geofence:operate') > -1 &&
        TMS.rbac.PERMISSIONS.some((p) => p.code === 'geofence:operate'),
        TMS.rbac.defaultPerms('branch').length + ' 项出厂权限');
})();

/* v11：围栏从「圆心 + 半径」改成现场勾画的边界，并新增派送员编号围栏。
   老库里那批自动画的方框、写成 inactive 的停用状态都要跟着改，
   编号围栏要读员工档案，只能打标记交给 boot.ready 补建档 */
(() => {
    const box = (lat, lng) => [
        { lat: lat + 0.02, lng: lng - 0.026 }, { lat: lat + 0.02, lng: lng + 0.026 },
        { lat: lat - 0.02, lng: lng + 0.026 }, { lat: lat - 0.02, lng: lng - 0.026 }
    ];
    const legacy = {
        data: {
            geofences: [
                { id: 'GF0001', name: '上海分拨中心电子围栏', type: 'hub', city: '上海', center: { lat: 31.2, lng: 121.4 }, radiusM: 2000, polygon: box(31.2, 121.4), status: 'active' },
                { id: 'GF0002', name: '杭州作业围栏', type: 'branch', city: '杭州', center: { lat: 30.25, lng: 120.16 }, radiusM: 5000, polygon: box(30.25, 120.16), status: 'inactive' },
                { id: 'GF0003', name: '老半径围栏', type: 'branch', city: '广州', center: { lat: 23.13, lng: 113.26 }, radiusM: 9000, status: 'active' }
            ],
            employees: [
                { id: 'EMP0001', name: '甲', role: 'deliveryman', status: 'active', city: '上海', badge: 'HT0001' },
                { id: 'EMP0002', name: '乙', role: 'transporter', status: 'active', city: '上海' }
            ]
        }
    };
    TMS.migrations[11](legacy, TMS);
    const g = legacy.data.geofences;
    check('老库停用围栏的状态码统一到 disabled', g[1].status === 'disabled' && !!g[1].note, g[1].status + ' · ' + g[1].note);
    check('旧版自动画的方框打上重勾标记', !!g[0].legacyBox && g[2].legacyBox === undefined,
        g[0].name + ' 标为待重勾 / ' + g[2].name + '（半径圆）不误标');
    check('迁移补齐派生字段：shape / 圆心 / 面积',
        g[0].shape === 'polygon' && g[2].shape === 'circle' &&
        g[0].areaKm2 > 0 && g[2].areaKm2 === TMS.util.round(Math.PI * 81, 2) &&
        g[0].center && TMS.util.pointInRing(g[0].center, g[0].polygon),
        '勾画 ' + g[0].areaKm2 + ' km² · 半径圆 ' + g[2].areaKm2 + ' km²');
    check('没有编号围栏的老库打上补建档标记', legacy.pendingCourierFence === 1);
    /* 补建档走真实领域层：在册派送员才配编号围栏，且必须整格落在宿主派送围栏里。
       这一段要换掉活库的围栏与员工，跑完必须原样换回去——后面的六端页面渲染吃的就是这份数据。
       换完必须 touch：get/find 有 idMaps 缓存，不清会让后面的断言读到已被换掉的行 */
    const raw = TMS.db.load();
    const keep = { geofences: raw.data.geofences, employees: raw.data.employees };
    const swap = (name, rows) => { raw.data[name] = rows; TMS.db.touch(name); };
    let out, made, host;
    try {
        swap('geofences', g.map((x) => JSON.parse(JSON.stringify(x))));
        swap('employees', legacy.data.employees.concat([
            { id: 'EMP0003', name: '丙', role: 'deliveryman', status: 'active', city: '广州', badge: 'HT0003' }
        ]));
        out = TMS.network.backfillCourierFences();
        made = TMS.db.col('geofences').filter((x) => x.type === 'courier');
        host = (cid) => TMS.db.col('geofences').filter((x) => x.city === cid && x.type !== 'courier' && x.status === 'active')[0];
        check('补建档只给在册派送员勾格，且格子在宿主围栏内',
            made.length > 0 && made.every((x) => {
                const e = TMS.db.get('employees', x.refId);
                return e && e.role === 'deliveryman' && TMS.network.fenceRing(x) &&
                    TMS.network.fenceRing(x).every((p) => TMS.network.pointInFence(p, host(x.city)));
            }),
            out.created + ' 张编号围栏 / 跳过 ' + out.skipped + ' · 候选城市 ' + out.cities);
        check('补出来的编号围栏能回答图1 右支', (() => {
            const one = made[0];
            if (!one) return false;
            const hit = TMS.network.fenceAt(TMS.util.ringCentroid(TMS.network.fenceRing(one)), 'courier');
            return !!hit && hit.refId === one.refId;
        })(), made.length ? made[0].name + ' 中心反查回 ' + (TMS.db.get('employees', made[0].refId) || {}).name : '未补出围栏');
    } finally {
        swap('geofences', keep.geofences);
        swap('employees', keep.employees);
    }
    check('补建档跑完把库原样换回', TMS.db.col('geofences') === keep.geofences && TMS.db.col('employees') === keep.employees,
        TMS.db.col('geofences').length + ' 张围栏复原');
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
/* 片段数组被当成字符串拼进 HTML 时，逗号会留在两个标签之间。
   浏览器把这枚裸逗号当作匿名的栅格/弹性子项，split 于是多出一格、卡片被挤窄，
   这正是「布局乱」最难从截图里看出来的一类回归，所以在冒烟里就拦住 */
function strayCommas(html) {
    return (html.match(/[^<>]*>[\s]*,[\s]*<[^\/>]/g) || []).length
        + (html.match(/>[\s]*,[\s]*<\//g) || []).length;
}

function markupProblem(html) {
    const m = html.match(/.{0,70}(undefined|NaN|\[object Object\]).{0,70}/);
    if (m) return '渲染脏值：…' + m[0] + '…';
    const broken = unclosedTagQuotes(html);
    if (broken.length) return broken.length + ' 处标签属性引号未闭合：<' + broken[0].slice(1);
    const sc = strayCommas(html);
    if (sc) return sc + ' 处两个标签之间残留逗号（数组被 String() 拼进了 HTML）';
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

/* 空态体检（node tools/smoke.js --empty）：页面上的「暂无数据」有两类，
   一类是此刻业务上确实为空（今天没有待派送件），一类是这块功能压根没造数据。
   前者是正常态、后者才是要补的洞，机器分不清，所以只逐页列给人看，不计入失败 */
const EMPTY_AUDIT = argv.includes('--empty');
const emptyHits = [];
function collectEmpties(role, pageId, html) {
    let at = 0;
    while ((at = html.indexOf('class="tms-empty"', at)) > -1) {
        const seg = html.slice(at, at + 600);
        const text = (seg.match(/<p>([^<]*)<\/p>/) || [])[1] || '';
        const sub = (seg.match(/class="tms-sub"[^>]*>([\s\S]{0,120}?)<\/div>/) || [])[1] || '';
        const h3 = html.lastIndexOf('<h3', at);
        const card = h3 > -1 ? ((html.slice(h3, h3 + 200).match(/<h3[^>]*>([^<]*)</) || [])[1] || '') : '';
        emptyHits.push({ role, pageId, card, text: util_esc(text), sub: util_esc(sub).slice(0, 60) });
        at += 16;
    }
}
function util_esc(s) { return String(s || '').replace(/&[a-z]+;/g, ' ').replace(/<[^>]*>/g, '').trim(); }

/* ---------- 闭环审计 ---------- */
const LOOP_AUDIT = argv.includes('--loop');
/* 领域接口接入审计：种子建完库之后、页面跑起来之前，把每个领域模块的导出函数包一层。
   按源码文本找方法名会冤枉人——plateOf、stdHoursOf 这类查询函数常常是被别的领域函数链式调用的，
   文本匹配把「内部复用」误判成「没入口」，反之页面拼了个同名局部变量又能骗过去。
   这里只认运行时：页面 load/render/actions 期间真正被执行到的，就是接进了界面；
   一次都没被碰到的导出函数，才是业务链条上缺的最后一米——功能写完了，界面上按不出来 */
const DOMAIN_MODS = ['order', 'operation', 'finance', 'service', 'people', 'pricing', 'network', 'stats', 'master', 'jobs', 'audit', 'architecture'];
const apiHits = new Set();
const apiTotal = new Set();
const apiRestore = [];
if (LOOP_AUDIT) {
    DOMAIN_MODS.forEach((m) => {
        const api = TMS[m];
        if (!api) return;
        Object.keys(api).forEach((fn) => {
            if (typeof api[fn] !== 'function') return;
            const key = m + '.' + fn;
            apiTotal.add(key);
            const real = api[fn];
            apiRestore.push(() => { api[fn] = real; });
            api[fn] = function () { apiHits.add(key); return real.apply(api, arguments); };
        });
    });
}

/* 动作「跑得通」和动作「把业务往前推了一格」是两件事。
   node tools/smoke.js --loop 在每次调用前后统计写库次数（create/update/remove/touch/commit），
   一次写都没有的动作就只是个 toast——链路在这里断了，页面看起来仍然是满的。
   只读动作（开抽屉、导出、跳转、筛选）写进 READ_ONLY 白名单，
   白名单之外一律算缺陷，这样以后加按钮忘了落库会被当场抓住 */
const READ_ONLY_ACT = new Set([
    'ui:close', 'ui:back', 'ui:toast', 'ui:filter', 'ui:sort', 'ui:reset',
    /* 架构页的图纸控件：只改 ui.state 里的视图参数（连线/聚焦/动画/流速/缩放/标注/底色/播放头），
       业务库一行都不该动——它们是真交互，但不是写操作，别混进「点了不落库」的参考名单 */
    'arch:lines', 'arch:focus', 'arch:theme', 'arch:anim', 'arch:metrics', 'arch:grid', 'arch:glow',
    'arch:speed', 'arch:zoom', 'arch:reset', 'arch:play', 'arch:step', 'arch:prev', 'arch:next', 'arch:flowsof'
]);
/* 判定「点了没反应」看函数体，不看写库次数。
   冒烟给不出每个动作需要的主键——动作拿不到合法 id 就在 if (!row) return 处提前退出，
   写库次数为零是误会了它。直接读源码：一个动作既没碰存储、没调领域服务、没开抽屉弹窗、
   没翻页、没导出、没复制、没刷新，那它就只是弹了句提示。
   这类断链与主键无关，机器判得准，可以当硬门禁用 */
/* pg.xxxDrawer( 是注册器里的跨页共用抽屉：调用点写的是带点的名字，
   下面的具名调用扫描只认裸标识符，跟不过去。它确实开了界面，算 live */
const LIVE_RE = /(^|[^.\w])db\.(col|get|find|create|update|remove|removeWhere|touch|commit|batch|persist|rev)|TMS\.(order|operation|finance|service|people|pricing|network|stats|master|jobs|audit|ids|auth|rbac|shell)\.|pg\.\w*[Dd]rawer\s*\(|\w*Modal\s*\(|\bopen[A-Z]\w*\s*\(|ui\.(drawer|modal|formModal|confirm|prompt)|\bgo\s*\(|\bhref\s*=|location\s*=|exportGrid|\bdownload\b|clipboard|window\.open|refresh\s*\(|reload\s*\(|\bstate\s*\(/;
const stubHits = [];

/* 动作体常常只是一行 'cust:open': function (id) { customerModal(id); }——
   真正落库的是同文件里的具名函数。只看动作本身会把这类正常按钮全判成断链，
   所以顺着调用到的标识符把同页的函数体也读进来，递归三层足够覆盖 helper → modal → onSubmit */
const PAGE_TEXTS = fs.readdirSync(path.join(ROOT, 'js/pages'))
    .map((f) => fs.readFileSync(path.join(ROOT, 'js/pages', f), 'utf8')).join('\n');
const GLOBALS = new Set(['ui', 'db', 'pg', 'util', 'fmt', 'esc', 'TMS', 'Number', 'String', 'Object',
    'Array', 'JSON', 'Math', 'Date', 'parseInt', 'parseFloat', 'isNaN', 'encodeURIComponent',
    'decodeURIComponent', 'RegExp', 'setTimeout', 'clearTimeout', 'alert', 'confirm', 'Function',
    'if', 'for', 'while', 'switch', 'return', 'typeof', 'catch', 'Boolean', 'push', 'filter',
    'map', 'forEach', 'join', 'split', 'slice', 'sort', 'some', 'every', 'indexOf', 'test', 'replace', 'trim']);
function bodyOf(name) {
    const re = new RegExp('function\\s+' + name + '\\s*\\(|(?:var|let|const)\\s+' + name + '\\s*=\\s*(?:function|\\()');
    const at = PAGE_TEXTS.search(re);
    if (at < 0) return '';
    const open = PAGE_TEXTS.indexOf('{', at);
    if (open < 0) return '';
    let depth = 0;
    for (let i = open; i < PAGE_TEXTS.length; i++) {
        const c = PAGE_TEXTS[i];
        if (c === '{') depth++;
        else if (c === '}' && --depth === 0) return PAGE_TEXTS.slice(at, i + 1);
    }
    return '';
}
function liveSrc(fnSrc, depth) {
    let out = fnSrc;
    if (LIVE_RE.test(out) || depth > 3) return out;
    const seen = new Set();
    let m;
    const callRe = /(?:^|[^\w.$])([a-zA-Z_$][\w$]*)\s*\(/g;
    while ((m = callRe.exec(fnSrc))) {
        const name = m[1];
        if (GLOBALS.has(name) || seen.has(name)) continue;
        seen.add(name);
        const sub = bodyOf(name);
        if (!sub) continue;
        out += '\n' + sub;
        if (LIVE_RE.test(out)) return out;
    }
    return liveSrc(out, depth + 1);
}
let writes = {};
let emptyWrites = [];
const countWrite = (name) => { writes[name] = (writes[name] || 0) + 1; };
const realCreate = db.create, realUpdate = db.update, realRemove = db.remove;
const realRemoveWhere = db.removeWhere, realTouch = db.touch, realCommit = db.commit;
if (LOOP_AUDIT) {
    db.create = (n, r, o) => { countWrite(n); return realCreate(n, r, o); };
    db.update = (n, id, p) => { const hit = realUpdate(n, id, p); if (hit) countWrite(n); else emptyWrites.push(n + '/' + id); return hit; };
    db.remove = (n, id) => { if (realRemove(n, id)) countWrite(n); };
    db.removeWhere = (n, f) => { const m = realRemoveWhere(n, f); if (m) countWrite(n); return m; };
    db.touch = (n) => { countWrite(n); realTouch(n); };
    db.commit = (n, id, reason) => { countWrite('@commit'); realCommit(n, id, reason); };
}
const loopHits = [];
const readWrite = () => { const w = writes; writes = {}; return w; };

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
                if (EMPTY_AUDIT) collectEmpties(role, id, html);
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
                    /* 点行开单是最常用的入口，而 grid 的行键（keyName）同时决定 onRow 带出去的参数：
                       台账这类「一单多行」的列表把行内唯一键当行键，点行就打不开抽屉，
                       渲染文本里完全看不出异常——所以逐个把 data-arg 送进 openOrder 用的同一个解析器验一遍 */
                    const argPairs = html.match(/data-act="order:open" data-arg="([^"]*)"/g) || [];
                    const badArg = argPairs.map((s) => s.replace(/^.*data-arg="/, '').replace(/"$/, ''))
                        .filter((a) => a && a !== 'undefined' && !TMS.order.byCode(a));
                    if (badArg.length) {
                        dirty++;
                        console.error('  ✗ ' + role + '/' + id + ' 行键解析不到订单（' + badArg.length + ' 处，如 ' + badArg[0] + '）');
                    }
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

/* 架构设计是一份说明书，而说明书写错一个表名、一个函数名、一条链路，
   比页面脏值更难发现——它看起来永远是对的。所以这里把目录当代码验：
   编号连续、每张表恰好一个写入者、同步依赖不成环、映射到的模块/接口/页面/集合全部真实存在、
   拓扑坐标不出画布也不互相压盖、走线槽不穿过节点、链路与定时清单跟真实 handler 对齐 */
(() => {
    section('架构设计目录');
    const arch = TMS.architecture;
    const svcs = arch.services();
    const WANT = ['gateway', 'bff', 'order', 'branch', 'dispatch', 'billing', 'tms', 'kpi', 'job', 'search'];
    check('十个服务且编号 1–10 连续',
        svcs.length === 10 && svcs.every((s, i) => s.no === i + 1) && WANT.every((id) => !!arch.service(id)),
        svcs.map((s) => s.no + ' ' + s.id).join(' · '));

    const layerIds = arch.layers().map((l) => l.id);
    const hues = svcs.map((s) => s.hue);
    const thin = svcs.filter((s) => !s.mission || !s.tag || !s.en || !s.icon ||
        !(s.duty || []).length || !(s.boundary || []).length || !(s.apis || []).length ||
        !s.consistency || !s.capacity || layerIds.indexOf(s.layer) < 0);
    check('每个服务职责/边界/契约/一致性/容量齐全且色号不撞',
        thin.length === 0 && new Set(hues).size === hues.length,
        thin.length ? thin.map((s) => s.id).join('、') : new Set(hues).size + ' 个可分辨色号');
    /* BFF 与检索不拥有主表，本来就不该有领域事件契约；拥有表的服务必须说清谁订阅它的变更 */
    const mute = svcs.filter((s) => (s.owns || []).length && !(s.events || []).length);
    check('拥有数据的服务都声明了事件契约', mute.length === 0,
        mute.map((s) => s.id).join('、') || svcs.filter((s) => (s.events || []).length).length + ' 个服务有事件');

    const badDep = [];
    const badPeer = [];
    svcs.forEach((s) => {
        (s.deps || []).forEach((d) => { if (!arch.service(d)) badDep.push(s.id + '→' + d); });
        (s.events || []).forEach((e) => {
            if (['in', 'out'].indexOf(e.dir) < 0 || !e.name || !e.d) badPeer.push(s.id + '/' + e.name);
            /* peer 允许写「全部服务」这类散文，只有长得像服务 id 的才拿去对目录 */
            String(e.peer || '').split(/\s*\/\s*/).forEach((p) => {
                if (/^[a-z][a-z0-9]*$/.test(p) && !arch.service(p)) badPeer.push(s.id + '→' + p);
            });
        });
        (s.apis || []).forEach((a) => {
            if (!a.m || !a.p || !a.d || ['sync', 'event', 'job', 'read'].indexOf(a.kind) < 0) badPeer.push(s.id + '/' + a.p);
        });
    });
    check('依赖与事件对端全部指向真实服务', badDep.length === 0 && badPeer.length === 0,
        badDep.concat(badPeer).join('、') || svcs.reduce((a, s) => a + (s.deps || []).length, 0) + ' 条依赖');
    check('同步依赖图无环（拆分成立）', arch.syncCycle().length === 0, arch.syncCycle().join('→') || 'DAG');

    const st = arch.stats();
    const mx = arch.matrix();
    const own = arch.ownership();
    const ownerCount = {};
    mx.forEach((r) => { if (r.owner) ownerCount[r.owner] = (ownerCount[r.owner] || 0) + 1; });
    const dup = svcs.filter((s) => {
        const declared = (s.owns || []).filter((c, i, a) => a.indexOf(c) !== i);
        return declared.length;
    });
    check('每张集合恰好一个写入者，无主表为 0',
        mx.length === st.collections && st.orphan.length === 0 && dup.length === 0 &&
        Object.keys(ownerCount).length === svcs.filter((s) => (s.owns || []).length).length,
        mx.length + ' 张 / 无主 ' + st.orphan.length + ' 张' + (st.orphan.length ? '：' + st.orphan.join('、') : ''));
    check('归属分布与矩阵、统计三处同源',
        own.reduce((a, r) => a + r.tables, 0) === st.collections &&
        own.reduce((a, r) => a + r.rows, 0) === st.rows &&
        own.every((r) => r.tables === (arch.service(r.id).owns || []).length),
        st.rows + ' 行分布在 ' + own.filter((r) => r.tables).length + ' 个写入者');

    const drift = [];
    svcs.forEach((s) => {
        const c = arch.coverage(s.id);
        ['missingModules', 'missingPages', 'missingApis', 'missingCollections'].forEach((k) => {
            if (c[k].length) drift.push(s.id + '.' + k + '=' + c[k].join(','));
        });
    });
    check('落地映射全部命中真实模块/页面/接口/集合', drift.length === 0,
        drift.join(' | ') || svcs.reduce((a, s) => a + arch.coverage(s.id).apis.length, 0) + ' 个接口可解析');

    const fl = arch.flows();
    const badStep = [];
    fl.forEach((f) => f.steps.forEach((x) => {
        if (x.missing || ['sync', 'event', 'job', 'self'].indexOf(x.kind) < 0 || !x.api || !x.payload || !x.note) {
            badStep.push(f.id + '#' + x.seq);
        }
    }));
    check('端到端链路每一步两端有效且载荷齐全',
        fl.length >= 6 && badStep.length === 0 && fl.every((f) => f.participants.length >= 2 && f.trigger && f.outcome && f.sla) &&
        fl.reduce((a, f) => a + f.steps.length, 0) === st.steps && st.syncSteps + st.asyncSteps === st.steps,
        badStep.join('、') || fl.length + ' 条 / ' + st.steps + ' 步（异步 ' + st.asyncSteps + '）');
    check('链路可按 id 取回且参与方去重',
        fl.every((f) => arch.flow(f.id).id === f.id && new Set(f.participants.map((p) => p.id)).size === f.participants.length),
        fl.map((f) => f.id + '(' + f.participants.length + ')').join(' '));

    const jp = arch.jobPlan();
    const ruleKeys = TMS.jobs.RULES.map((r) => r.key);
    check('定时清单覆盖全部真实 handler 且都登记了 cron',
        jp.length === ruleKeys.length && jp.every((r) => r.planned && r.cron && r.target && r.note) &&
        ruleKeys.every((k) => jp.some((r) => r.key === k)),
        jp.length + ' 个 handler / 未登记 ' + jp.filter((r) => !r.planned).length);

    const topo = arch.topology();
    const outside = topo.nodes.filter((n) => n.x < 0 || n.y < 0 || n.x + n.w > topo.width || n.y + n.h > topo.height);
    const overlap = [];
    topo.nodes.forEach((a, i) => topo.nodes.slice(i + 1).forEach((b) => {
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlap.push(a.id + '×' + b.id);
    }));
    check('拓扑十个节点都在画布内且互不压盖',
        topo.nodes.length === 10 && outside.length === 0 && overlap.length === 0,
        outside.map((n) => n.id).concat(overlap).join('、') || topo.width + '×' + topo.height);
    const bandBad = topo.bands.filter((b, i) => b.y < 0 || b.y + b.h > topo.height ||
        (i && b.y < topo.bands[i - 1].y + topo.bands[i - 1].h));
    const nodeOutBand = topo.nodes.filter((n) => !topo.bands.some((b) => b.id === n.layer && n.y >= b.y && n.y + n.h <= b.y + b.h));
    check('分层色带不重叠且每个节点落在自己的层里', bandBad.length === 0 && nodeOutBand.length === 0,
        bandBad.map((b) => b.id).concat(nodeOutBand.map((n) => n.id)).join('、') || topo.bands.length + ' 层色带');
    const pathBad = topo.edges.filter((e) => !/^M\s/.test(e.path) || /NaN|undefined/.test(e.path) || !e.hue);
    const cnt = topo.counts;
    check('走线路径可绘制且四种线型计数自洽',
        pathBad.length === 0 && cnt.sync + cnt.event + cnt.job + cnt.read === topo.edges.length,
        pathBad.map((e) => e.from + '→' + e.to).join('、') ||
        '同步 ' + cnt.sync + ' / 事件 ' + cnt.event + ' / 定时 ' + cnt.job + ' / 只读 ' + cnt.read);
    const sy = arch.topology({ lines: 'sync' }), asy = arch.topology({ lines: 'async' });
    check('连线过滤三档互斥且并集等于全量',
        sy.edges.every((e) => e.kind === 'sync') && asy.edges.every((e) => e.kind !== 'sync') &&
        sy.edges.length + asy.edges.length === topo.edges.length,
        sy.edges.length + ' + ' + asy.edges.length + ' = ' + topo.edges.length);
    /* 领域层内部走线槽：同步走节点下方、事件走节点上方，槽位一旦落进节点矩形就会被盖住 */
    const domainNodes = topo.nodes.filter((n) => n.layer === 'domain');
    const gutters = [410, 276];
    const gutterHit = gutters.filter((g) => domainNodes.some((n) => g >= n.y && g <= n.y + n.h));
    check('领域层走线槽不穿过节点', gutterHit.length === 0,
        gutterHit.length ? '槽位 ' + gutterHit.join('、') + ' 压在节点上' : '同步槽 410 / 事件槽 276');

    /* 治理与运维轨：四件横切组件坐标合法、连线可绘制、显隐开关改变画布宽 */
    const ops = topo.ops;
    const opsOutside = ops.nodes.filter((n) => n.x < 0 || n.y < 0 || n.x + n.w > topo.width || n.y + n.h > topo.height);
    const opsOverlap = [];
    ops.nodes.forEach((a, i) => ops.nodes.slice(i + 1).concat(topo.nodes).forEach((b) => {
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) opsOverlap.push(a.id + '×' + b.id);
    }));
    check('治理运维四组件在画布内且与服务节点互不压盖',
        ops.nodes.length === 4 && ['nginx', 'nacos', 'skywalking', 'k8s'].every((id) => ops.nodes.some((n) => n.id === id)) &&
        opsOutside.length === 0 && opsOverlap.length === 0 && ops.nodes.every((n) => !!arch.distTech(n.tech)),
        opsOutside.map((n) => n.id).concat(opsOverlap).join('、') || ops.nodes.map((n) => n.id).join(' · '));
    const opsPathBad = ops.links.filter((e) => !/^M\s/.test(e.path) || /NaN|undefined/.test(e.path) || !e.hue || !e.label);
    const ingress = ops.links.filter((e) => e.kind === 'ingress');
    check('入口流量走向完整：五端汇入 Nginx 再转发网关',
        opsPathBad.length === 0 && ingress.length === 6 &&
        ingress.slice(0, 5).every((e) => e.to === 'nginx') &&
        ingress.some((e) => e.from === 'nginx' && e.to === 'gateway'),
        opsPathBad.map((e) => e.id).join('、') || ingress.length + ' 条入口线 / 共 ' + ops.links.length + ' 条横切线');
    const govIds = ops.links.filter((e) => e.arrow && e.kind !== 'ingress').map((e) => e.id).sort().join(',');
    check('治理总线双向注册与上报/调度走向齐全',
        govIds === 'apm,push,reg,sched' && ops.links.some((e) => e.id === 'bus' && !e.arrow) &&
        ops.links.filter((e) => e.id.indexOf('tick-') === 0).length === 4,
        govIds + ' · 总线 + 四层挂接');
    const noOps = arch.topology({ ops: false });
    check('治理运维开关收起后画布回到主宽且无横切件',
        noOps.ops === null && noOps.width === noOps.mainW && topo.width > topo.mainW,
        noOps.width + ' / ' + topo.width);
    check('基础设施 chips 与治理轨去重（Nacos/SkyWalking 不再重复出现）',
        topo.infra.length === 8 && !topo.infra.some((x) => x.id === 'nacos') &&
        topo.infra.some((x) => /Prometheus/.test(x.name)),
        topo.infra.map((x) => x.name).join(' · '));

    /* 架构说明书是公开页：不进任何角色菜单（运营仪表盘也不放入口），
       注册表显式登记根文件、裸页无权限点，访客从登录首页直接进 */
    const archDef = TMS.pages.get('architecture');
    check('架构页公开裸注册且不住在角色菜单里',
        !!archDef && archDef.file === 'architecture.html' && archDef.bare === true && !archDef.perm &&
        !TMS.rbac.ADMIN_MENU.some((g) => g.items.some((i) => i.id === 'architecture')) &&
        Object.keys(TMS.rbac.PORTAL_MENU).every((r) => !TMS.rbac.PORTAL_MENU[r].some((i) => i.id === 'architecture')),
        'architecture.html · bare · 无权限点');
    const shellHtml = fs.readFileSync(path.join(ROOT, 'architecture.html'), 'utf8');
    const homeHtml = fs.readFileSync(path.join(ROOT, 'tms/index.html'), 'utf8');
    const loginHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const tokOf = (h) => (h.match(/boot\.js\?v=([\w-]+)/) || [])[1] || '';
    check('公开架构页走 startPublic 且 token 与全站一致',
        /TMS\.boot\.startPublic\('architecture'\)/.test(shellHtml) &&
        /css\/architecture\.css\?v=/.test(shellHtml) && tokOf(shellHtml) &&
        tokOf(shellHtml) === tokOf(homeHtml) && tokOf(shellHtml) === tokOf(loginHtml),
        'v=' + tokOf(shellHtml));
    check('boot 提供公开启动且角色目录能解析回角色 key',
        /function startPublic/.test(fs.readFileSync(path.join(ROOT, 'js/boot.js'), 'utf8')) &&
        TMS.cfg.roleOf('tms') === 'admin' && TMS.cfg.roleOf('admin') === 'admin' &&
        TMS.cfg.roleOf('branch') === 'branch' && TMS.cfg.roleOf('nope') === null,
        'tms→admin');
    check('两个架构模块已进 boot 装配清单',
        TMS.boot.modules.indexOf('js/domain/architecture.js') > -1 &&
        TMS.boot.modules.indexOf('js/pages/architecture.js') > -1 &&
        TMS.boot.modules.indexOf('js/domain/architecture.js') < TMS.boot.modules.indexOf('js/ui/kit.js'),
        TMS.boot.modules.length + ' 个模块');

    /* 分布式与运维目录同样当代码验：十件组件逐件有契约，引用的服务/表/链路全部真实存在 */
    const techs = arch.distributed();
    const WANT_TECH = ['sharding', 'nacos', 'sentinel', 'skywalking', 'seata', 'redis', 'prometheus', 'cicd', 'lb', 'snowflake'];
    check('十件分布式组件齐全且编号 1–10 连续',
        techs.length === 10 && techs.every((t, i) => t.no === i + 1) && WANT_TECH.every((id) => !!arch.distTech(id)),
        techs.map((t) => t.no + ' ' + t.id).join(' · '));
    const techHues = techs.map((t) => t.hue);
    const thinTech = techs.filter((t) => !t.name || !t.product || !t.version || !t.role || !t.why || !t.scenario ||
        !t.fallback || !(t.points || []).length || (t.metrics || []).length !== 3 ||
        t.metrics.some((m) => !m.k || !m.v) || !arch.distCats().some((c) => c.id === t.cat));
    check('每件组件契约完整且色号不撞', thinTech.length === 0 && new Set(techHues).size === techHues.length,
        thinTech.length ? thinTech.map((t) => t.id).join('、') : new Set(techHues).size + ' 个可分辨色号 · ' +
        techs.reduce((a, t) => a + t.points.length, 0) + ' 条设计要点');
    const techDrift = [];
    techs.forEach((t) => {
        t.services.forEach((sid) => { if (!arch.service(sid)) techDrift.push(t.id + '→svc:' + sid); });
        (t.tables || []).forEach((n) => { if (!db.meta(n).label) techDrift.push(t.id + '→tbl:' + n); });
        (t.flows || []).forEach((fid) => { if (!arch.flow(fid)) techDrift.push(t.id + '→flow:' + fid); });
    });
    check('组件覆盖的服务/表/链路全部命中真实目录', techDrift.length === 0,
        techDrift.join('、') || techs.reduce((a, t) => a + t.services.length, 0) + ' 条覆盖连接');
    const dmx = arch.distMatrix();
    check('覆盖矩阵与组件目录同源',
        dmx.length === techs.length && dmx.every((r) => r.cells.length === 10 &&
            r.count === r.cells.filter(Boolean).length && r.count === arch.distTech(r.id).services.length),
        dmx.length + ' 行 × 10 服务');
    const dcats = arch.distCats();
    const dst = arch.distStats();
    check('分类计数与统计三处同源',
        dcats.length === 5 && dcats.reduce((a, c) => a + c.count, 0) === 10 &&
        dst.techs === 10 && dst.cats === 5 && dst.links === techs.reduce((a, t) => a + t.services.length, 0) &&
        dst.full === techs.filter((t) => t.services.length === 10).length &&
        dst.points === techs.reduce((a, t) => a + t.points.length, 0),
        '连接 ' + dst.links + ' / 全量覆盖 ' + dst.full + ' 件 / 要点 ' + dst.points + ' 条');
    const stages = arch.cicd();
    check('CI/CD 八阶段出口条件与失败处置齐全',
        stages.length === 8 && stages.every((s, i) => s.no === i + 1 && s.name && s.tool && s.dur && s.hue && s.action && s.exit && s.fail) &&
        dst.stages === 8,
        stages.map((s) => s.id).join(' → '));
    const lb = arch.lbPath();
    check('负载均衡五跳接力且 Nacos 供名单',
        lb.hops.length === 5 && lb.hops.every((h) => h.name && h.hue && h.icon) &&
        /Nacos/.test(lb.registry.name) && lb.hops.some((h) => /Feign/.test(h.name)) && lb.hops.some((h) => /Nginx/.test(h.name)),
        lb.hops.map((h) => h.name).join(' → '));
})();

/* 图纸是「可操纵的对象」，控件必须常驻且真的改画面：
   这里逐个 tab 渲染架构页，数控件数量、数 SVG 状态类、数时序图步数，
   再把每个视图开关拨一遍，确认导出的 SVG 跟着当前状态走而不是永远一张默认图 */
(() => {
    section('架构页图纸与控件');
    const def = TMS.pages.get('architecture');
    const session = SESSION_BY_ROLE.admin;
    TMS.auth.write(session);
    TMS.shell.state.session = session;
    TMS.shell.state.portal = 'admin';
    TMS.shell.state.pageId = 'architecture';
    const uiState = TMS.ui.state('architecture');
    const ctx = {
        shell: TMS.shell, session, params: {}, days: 7, layout: 'bare', pageId: 'architecture',
        role: 'admin', go: () => {}, refresh: () => {}, toast: () => {}, confirm: () => autoYes,
        modal: () => ({ close() {} }), drawer: () => ({ close() {} }), formModal: () => ({ close() {} }),
        state: uiState, data: {}
    };
    const TABS = ['topo', 'services', 'flows', 'data', 'dist', 'deploy'];
    const htmlByTab = {};
    let bad = 0;
    TABS.forEach((t) => {
        uiState.tab = t;
        try {
            const d = def.load(ctx);
            ctx.data = d;
            const html = String(def.render(ctx, d) || '');
            htmlByTab[t] = html;
            if (/undefined|NaN|\[object Object\]/.test(html) || html.length < 400) {
                bad++;
                const m = html.match(/.{0,60}(undefined|NaN|\[object Object\]).{0,60}/);
                console.error('  ✗ 架构页 ' + t + ' 渲染有问题：' + (m ? m[0] : html.length + ' 字符'));
            }
            if (unclosedTagQuotes(html).length) { bad++; console.error('  ✗ 架构页 ' + t + ' 标签引号未闭合'); }
        } catch (err) {
            bad++;
            console.error('  ✗ 架构页 ' + t + ' 渲染抛错：' + err.message);
        }
    });
    check('架构页六个页签全部渲染干净', bad === 0 && TABS.every((t) => htmlByTab[t]), bad ? bad + ' 个页签有问题' : TABS.join(' / '));
    check('公开页 masthead 常驻且已登录会话给进入系统',
        /class="ar-mast"/.test(htmlByTab.topo) && /进入系统/.test(htmlByTab.topo) &&
        /tms\/index\.html/.test(htmlByTab.topo) && /class="ar-public-body"/.test(htmlByTab.topo),
        'masthead + 收宽正文');
    const guestCtx = Object.assign({}, ctx, {
        session: { username: 'guest', name: '访客', role: 'guest', guest: true, permissions: [] }, role: 'guest'
    });
    uiState.tab = 'topo';
    const guestHtml = String(def.render(guestCtx, def.load(guestCtx)) || '');
    check('访客视角 masthead 给返回登录且页面照常渲染',
        /返回登录/.test(guestHtml) && guestHtml.indexOf('进入系统') === -1 &&
        /class="ar-controls"/.test(guestHtml) && !/undefined|NaN/.test(guestHtml),
        'guest → 返回登录');

    const topoHtml = htmlByTab.topo || '';
    const switches = (topoHtml.match(/class="ar-switch"/g) || []).length;
    const ranges = (topoHtml.match(/type="range"/g) || []).length;
    const selects = (topoHtml.match(/<select/g) || []).length;
    const ctlBtns = (topoHtml.match(/data-act="arch:(reset|svg|csv)"/g) || []).length;
    check('图纸控件区常驻且不少于七件',
        /class="ar-controls"/.test(topoHtml) && switches + ranges + selects + ctlBtns >= 7,
        '开关 ' + switches + ' / 滑杆 ' + ranges + ' / 下拉 ' + selects + ' / 按钮 ' + ctlBtns);
    check('拓扑 SVG 自带样式与 viewBox（导出即自包含）',
        /<svg[^>]*viewBox="0 0 1408 620"/.test(topoHtml) && /<style>/.test(topoHtml) &&
        /data-act="arch:open"/.test(topoHtml) && /--arch-speed/.test(topoHtml),
        (topoHtml.match(/data-act="arch:open"/g) || []).length + ' 个可点节点');
    check('拓扑总图含四件治理运维组件与关系走向',
        ['Nginx', 'Nacos', 'SkyWalking', 'Docker + K8s'].every((n) => topoHtml.indexOf(n) > -1) &&
        /治理与运维/.test(topoHtml) && /服务注册 · 心跳 5s/.test(topoHtml) &&
        /K8s 调度 · 探针自愈 · 滚动发布/.test(topoHtml) && /全部服务 · 横切接入/.test(topoHtml),
        'Nginx 入口 + 右侧治理轨');
    /* 入口从运营仪表盘挪到登录首页：仪表盘不再出现任何架构块，
       登录页的入口脚本必须读同一份领域目录、十枚胶囊深链聚焦对应服务 */
    check('运营仪表盘不再带架构入口', (() => {
        const ovDef = TMS.pages.get('overview');
        const ovCtx = Object.assign({}, ctx, { pageId: 'overview', state: TMS.ui.state('overview') });
        const html = String(ovDef.render(ovCtx, ovDef.load(ovCtx)) || '');
        return !/tms-arch-entry|tms-arch-pill|ov:arch/.test(html) && !ovDef.actions['ov:arch'];
    })(), 'overview 无架构块');
    check('登录首页架构入口读领域目录且十枚胶囊深链', (() => {
        const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        const svcs = TMS.architecture.services();
        return /id="login-arch"/.test(src) && /TMS\.architecture\.services\(\)/.test(src) &&
            /architecture\.html#architecture\?service=/.test(src) && svcs.length === 10 &&
            /renderArch\(\);/.test(src) && /tms-login-arch-pill/.test(src);
    })(), '10 枚胶囊 → 公开架构页聚焦');

    const flowHtml = htmlByTab.flows || '';
    const curFlow = TMS.architecture.flow(uiState.seg);
    check('时序图步数与链路目录一致且带播放头',
        (flowHtml.match(/data-act="arch:step"/g) || []).length >= curFlow.steps.length &&
        /ar-playhead/.test(flowHtml) && /data-act="arch:play"/.test(flowHtml) &&
        /data-act="arch:next"/.test(flowHtml) && /data-act="arch:prev"/.test(flowHtml),
        curFlow.name + ' ' + curFlow.steps.length + ' 步');

    /* 开关拨一遍：SVG 根上的状态类必须跟着变，否则「导出当前状态」就是假的 */
    uiState.tab = 'topo';
    uiState.arch = {};
    const base = String(def.render(ctx, def.load(ctx)) || '');
    def.actions['arch:anim']('');
    def.actions['arch:grid']('');
    def.actions['arch:glow']('');
    def.actions['arch:theme']('light');
    def.actions['arch:metrics']('');
    def.actions['arch:lines']('async');
    def.actions['arch:speed']('2');
    def.actions['arch:zoom']('1.4');
    const tuned = String(def.render(ctx, def.load(ctx)) || '');
    /* 状态类只能认 <svg> 根上的 class：内联 <style> 里本来就写着 .no-anim/.no-grid 选择器，
       拿裸词去 test 会永远命中，开关拨没拨都看不出来 */
    const clsHas = (h, c) => new RegExp('class="ar-svg[^"]*\\b' + c + '\\b').test(h);
    const tunedFlags = {
        '动画关': clsHas(tuned, 'no-anim') && !clsHas(base, 'no-anim'),
        '网格关': clsHas(tuned, 'no-grid') && !clsHas(base, 'no-grid'),
        '流速2×': /--arch-speed:2/.test(tuned),
        '缩放1.4×': /--arch-zoom:1\.4/.test(tuned),
        '图纸变了': tuned !== base,
        '底色转浅': /fill="#080e1c"/.test(base) && /fill="#f6f9fd"/.test(tuned),
        '辉光关': /filter="url\(#arGlowF\)"/.test(base) && !/filter="url\(#arGlowF\)"/.test(tuned)
    };
    check('视图开关真的改图纸（动画/网格/辉光/底色/标注/连线/流速/缩放）',
        Object.keys(tunedFlags).every((k) => tunedFlags[k]),
        Object.keys(tunedFlags).filter((k) => !tunedFlags[k]).join('、') || '八项全部跟着状态走');
    def.actions['arch:reset']('');
    const reset = String(def.render(ctx, def.load(ctx)) || '');
    check('重置视图回到出厂态', !clsHas(reset, 'no-anim') && !clsHas(reset, 'no-grid') && /--arch-speed:1"/.test(reset),
        'anim/grid/glow/metrics 全开 · 流速 1 · 缩放 1');
    def.actions['arch:focus']('billing');
    const focused = String(def.render(ctx, def.load(ctx)) || '');
    const nodeTags = focused.match(/<g class="ar-node(?: ar-focus)?" data-act="arch:open"[^>]*>/g) || [];
    const opsTags = focused.match(/<g class="ar-node" data-act="arch:dist-tech"[^>]*>/g) || [];
    check('聚焦高亮邻接且不压暗任何服务', uiState.arch.focus === 'billing' &&
        nodeTags.length === 10 && nodeTags.every((t) => /opacity="1"/.test(t)) && opsTags.length === 4 &&
        /ar-node ar-focus" data-act="arch:open" data-arg="billing"/.test(focused) &&
        /ar-focus-bar/.test(focused) && /退出聚焦/.test(focused) && /opacity="\.16"/.test(focused),
        '结算/计费服务 · 十节点全亮 · 四件横切件可点 · 无关线淡出');
    def.actions['arch:ops']('');
    const noOpsHtml = String(def.render(ctx, def.load(ctx)) || '');
    check('治理运维开关收起横切轨并还原主画布宽',
        /viewBox="0 0 1180 620"/.test(noOpsHtml) && !/data-arg="skywalking"/.test(noOpsHtml) &&
        !/治理运维轨/.test(noOpsHtml),
        'ops off → 1180 主画布');
    def.actions['arch:ops']('');
    def.actions['arch:step']('3');
    uiState.tab = 'flows';
    const stepped = String(def.render(ctx, def.load(ctx)) || '');
    check('单步播放头落到指定步且暂停自动播放',
        uiState.arch.step === 3 && uiState.arch.play === 0 && /ar-row on/.test(stepped),
        '第 3 步');

    /* 分布式页签：三张自包含 SVG + 常驻控制台 + 雪花发号器全流程 */
    const distHtml = htmlByTab.dist || '';
    const distSvgs = (distHtml.match(/<svg/g) || []).length;
    const distCtl = (distHtml.match(/data-(?:act|change)="arch:(?:dist-focus|theme|anim|grid|glow|speed|zoom|reset|dist-svg)"/g) || []).length;
    const snowCtl = (distHtml.match(/data-(?:act|change)="arch:snow-(?:dc|worker|count|clock|gen|copy|csv|reset|pick)"/g) || []).length;
    check('分布式页签三张图纸且两块控制台各不少于七件',
        distSvgs >= 3 && /ar-dist-cards/.test(distHtml) && /ar-mx-row/.test(distHtml) && /class="ar-snow"/.test(distHtml) &&
        /ar-dist-controls/.test(distHtml) && distCtl >= 7 && snowCtl >= 7,
        'SVG ' + distSvgs + ' / 全景旋钮 ' + distCtl + ' / 发号旋钮 ' + snowCtl);
    check('三张图纸 SVG 标识符互不撞且自带样式',
        /id="arDGridP"/.test(distHtml) && /id="ar-ca-rb"/.test(distHtml) && /id="arLGlowF"/.test(distHtml) &&
        (distHtml.match(/<style>/g) || []).length >= 3 && !/id="arGlowF"/.test(distHtml),
        'dist / cicd / lb 各自前缀');

    const snowOf = () => TMS.ui.state('architecture').snow;
    def.actions['arch:snow-reset']('');
    def.actions['arch:snow-gen']('');
    let batch = snowOf().ids.slice();
    const decBig = (x) => BigInt('0b' + x.bin);
    check('雪花一批八个：64 位、十进制换算精确、字段可解码、批内递增',
        batch.length === 8 && batch.every((x) => x.bin.length === 64 && x.bin.charAt(0) === '0' &&
            decBig(x).toString() === x.dec &&
            parseInt(x.bin.substr(42, 5), 2) === x.dc && parseInt(x.bin.substr(47, 5), 2) === x.worker &&
            parseInt(x.bin.substr(52, 12), 2) === x.seq) &&
        batch.every((x, i) => i === 0 || decBig(x) > decBig(batch[i - 1])) &&
        new Set(batch.map((x) => x.dec)).size === 8,
        (batch[0] || {}).dec + ' … ' + (batch[7] || {}).dec);
    def.actions['arch:snow-gen']('');
    const batch2 = snowOf().ids.slice();
    check('跨批次不重号（同毫秒序列续增）',
        batch2.every((x) => !batch.some((y) => y.dec === x.dec)),
        '第二批 ' + batch2.length + ' 个全新');
    def.actions['arch:snow-clock']('reject');
    def.actions['arch:snow-gen']('');
    check('回拨 12ms 超容忍：整批拒发且告警',
        snowOf().alert && snowOf().alert.tone === 'danger' &&
        snowOf().ids.length === batch2.length && snowOf().ids.every((x, i) => x.dec === batch2[i].dec),
        '拒发 ' + snowOf().snowCount + ' 个 · 旧批原样保留');
    def.actions['arch:snow-clock']('wait');
    def.actions['arch:snow-gen']('');
    check('回拨 3ms 容忍内：等待追平继续发号',
        snowOf().alert && snowOf().alert.tone === 'warn' && snowOf().ids.length === 8 &&
        snowOf().ids.every((x) => !batch2.some((y) => y.dec === x.dec)),
        '追平后新批 ' + snowOf().ids.length + ' 个');
    def.actions['arch:snow-clock']('ok');
    def.actions['arch:snow-pick']('3');
    check('点选批次行切换解剖对象', snowOf().picked === '3', 'picked = 3');
    def.actions['arch:snow-dc']('99');
    def.actions['arch:snow-worker']('7');
    def.actions['arch:snow-count']('99');
    def.actions['arch:snow-gen']('');
    check('旋钮越界钳制且新批用新节点位',
        snowOf().snowDc === 31 && snowOf().snowWorker === 7 && snowOf().snowCount === 24 &&
        snowOf().ids.length === 24 && snowOf().ids.every((x) => x.dc === 31 && x.worker === 7),
        '机房 31 · 节点 7 · 批量 24');
    def.actions['arch:snow-copy']('');
    def.actions['arch:snow-csv']('');
    def.actions['arch:snow-reset']('');
    check('发号器复位回出厂态', snowOf().ids.length === 0 && snowOf().snowDc === 1 && snowOf().snowClock === 'ok',
        '机房 1 · 节点 1 · 每批 8');
    def.actions['arch:snow-copy']('');
    def.actions['arch:snow-csv']('');

    uiState.tab = 'dist';
    def.actions['arch:dist-focus']('sharding');
    const distFocused = String(def.render(ctx, def.load(ctx)) || '');
    const distOnly = distFocused.split('</svg>')[0];
    const distNodeTags = distOnly.match(/<g class="ar-node(?: ar-focus)?"[^>]*>/g) || [];
    check('全景聚焦画覆盖连线且不压暗任何节点',
        uiState.arch.distFocus === 'sharding' && /ar-focus-bar/.test(distFocused) &&
        /id="ar-dah"/.test(distFocused) && (distFocused.match(/marker-end="url\(#ar-dah\)"/g) || []).length === 4 &&
        distNodeTags.length === 20 && distNodeTags.every((t) => /opacity="1"/.test(t)),
        '分库分表 → 4 服务连线 · 20 节点全亮');
    def.actions['arch:dist-cat']('data');
    const distData = String(def.render(ctx, def.load(ctx)) || '');
    check('目录分类筛选只留数据与一致性四件',
        (distData.match(/class="ar-dist-card"/g) || []).length === 4 &&
        /ShardingSphere/.test(distData) && /Seata/.test(distData) && /Redisson/.test(distData) && /Snowflake/.test(distData),
        '4 / 10 件');
    def.actions['arch:dist-cat']('');
    def.actions['arch:dist-tech']('sharding');
    TMS.ui.closeTop();
    def.actions['arch:dist-stage']('canary');
    TMS.ui.closeTop();
    def.actions['arch:dist-svg']('');
    def.actions['arch:dist-csv']('');
    def.actions['arch:dist-flow']('trunk');
    check('技术抽屉/阶段弹窗/导出/链路跳转全部可达',
        uiState.tab === 'flows' && uiState.seg === 'trunk',
        'dist-flow → 干线链路');
    def.actions['arch:reset']('');
    uiState.tab = 'topo';
    uiState.arch = {};
})();

if (EMPTY_AUDIT) {
    section('空态体检（--empty）');
    let last = '';
    emptyHits.forEach((h) => {
        const key = h.role + '/' + h.pageId;
        if (key !== last) { log('  ▸ ' + key); last = key; }
        log('      区块「' + (h.card || '未命名') + '」空：' + h.text + (h.sub ? '｜' + h.sub : ''));
    });
    const pages = new Set(emptyHits.map((h) => h.role + '/' + h.pageId));
    const menuTotal = ROLE_TARGETS.reduce((a, r) => a + menuIdsOf(r).length, 0);
    log(`\n  共 ${emptyHits.length} 处空态，分布在 ${pages.size} 个页面（渲染 ${ROLE_TARGETS.length} 端 / ${menuTotal} 页）`);
}

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
            /* 取第一个「真有值」的选项：选项表常以 { value:'', label:'全部' } 开头占位，
               按位置取第一个就等于每次都提交空值，校验当场拦下，闭环审计会把它误报成断链 */
            const valOf = (o) => (o && typeof o === 'object') ? o.value : o;
            const hit = opts.filter((o) => { const v = valOf(o); return v !== '' && v !== null && v !== undefined; })[0];
            return hit === undefined ? '' : valOf(hit);
        }
        if (f.type === 'date') return util.dateKey(util.now());
        if (f.type === 'datetime') return util.iso(util.now());
        if (f.type === 'city') return '上海';
        if (f.type === 'money' || f.type === 'amount') return 100;
        if (f.type === 'switch') return true;
        /* 文本类默认给内容而不是空串：多数 onSubmit 的必填校验只看空值，
           喂空串等于每次都被业务规则拒掉，审计就分不清「校验拦住了」和「压根没落库」 */
        return '冒烟样本';
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
    let submits = 0, actCalls = 0, bad = 0, modals = 0, sheets = 0;
    const realDrawer = TMS.ui.drawer;
    TMS.ui.confirm = () => autoYes;
    TMS.ui.drawer = function (o) { sheets++; return realDrawer.call(TMS.ui, o); };
    TMS.ui.formModal = function (o) {
        const handle = realFormModal.call(TMS.ui, o);
        modals++;
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
                /* 静态判一次「点了没反应」：与主键无关，不受冒烟假数据影响 */
                if (LOOP_AUDIT && !READ_ONLY_ACT.has(act) && !LIVE_RE.test(liveSrc(String(def.actions[act]), 0))) {
                    stubHits.push(role + '/' + id + '/' + act);
                }
                let navMark = navs, modalMark = modals, sheetMark = sheets;
                [argOf(act), ''].forEach((arg) => {
                    const mark = domLog.length;
                    actCalls++;
                    readWrite();
                    try {
                        def.actions[act](arg, null);
                    } catch (err) {
                        bad++;
                        console.error('  ✗ ' + role + '/' + id + ' 动作 ' + act + '（arg=' + arg + '）抛错：' + err.message +
                            '\n' + (err.stack || '').split('\n')[1]);
                    }
                    if (LOOP_AUDIT) {
                        const w = readWrite();
                        const touched = Object.keys(w).filter((k) => k !== '@commit').length;
                        if (!(touched || (navs - navMark) || (sheets - sheetMark)) && !READ_ONLY_ACT.has(act)) {
                            loopHits.push({ role, pageId: id, act, arg, kind: (modals - modalMark) ? '表单被校验拦住或只弹不写' : '点了没反应' });
                        }
                        modalMark = modals; navMark = navs; sheetMark = sheets;
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
    TMS.ui.drawer = realDrawer;
    TMS.ui.formModal = realFormModal;
    check('六端页面动作全部可执行且弹层无脏值', bad === 0,
        actCalls + ' 次调用 / ' + submits + ' 次表单提交 / ' + navs + ' 次翻页' + (bad ? '，' + bad + ' 处问题' : ''));
    if (LOOP_AUDIT) {
        /* 领域接口有没有接进界面：导出了一百个方法、页面只碰到八十一个，
           剩下那十九个就是「功能写了但没入口」——业务闭环断在最后一米。
           两路并判，缺一都会冤枉人：
           · 只看源码，会把 order.stdHoursOf 这种「页面没写、但被别的领域函数链式带出来」的
             内部复用误判成没入口；
           · 只看运行时，冒烟里的假主键会让动作在 if (!row) return 处提前退出，
             于是 createTrip、addScan 这种核心写操作全被误报成没人调。
           所以：源码里没出现、运行时也没被执行过，才是真的没有入口 */
        section('闭环审计（--loop）：领域接口未接入界面');
        const pageSrc = fs.readdirSync(path.join(ROOT, 'js/pages'))
            .map((f) => fs.readFileSync(path.join(ROOT, 'js/pages', f), 'utf8')).join('\n');
        const MOD_SRC = {};
        DOMAIN_MODS.forEach((m) => {
            const rel = m === 'master' ? 'js/data/master.js' : 'js/domain/' + m + '.js';
            MOD_SRC[m] = fs.readFileSync(path.join(ROOT, rel), 'utf8');
        });
        /* 取一个模块级声明的完整体：函数用 function 名( 或 var 名 = function(，
           表引用（RULES = [...]）也算，否则「run: traceOvertime」这一跳没人接力。
           只认行首缩进的声明，不然 .costTotal( 这类调用会被误当成定义 */
        function domainBody(mod, fn) {
            const src = MOD_SRC[mod];
            if (!src) return '';
            const re = new RegExp('^\\s*(?:function\\s+' + fn + '\\s*\\(|' +
                '(?:var|let|const)\\s+' + fn + '\\s*=\\s*(?:function\\s*\\(|[\\[{]))', 'gm');
            const m = re.exec(src);
            if (!m) return '';
            let depth = 0;
            for (let i = m.index; i < src.length; i++) {
                const c = src[i];
                if (c === '{' || c === '[') depth++;
                else if (c === '}' || c === ']') {
                    if (!--depth) return src.slice(m.index, i + 1);
                }
            }
            return '';
        }
                const seeded = new Set();
        apiTotal.forEach((key) => {
            if (apiHits.has(key) || new RegExp('\\b' + key.split('.')[1] + '\\b').test(pageSrc)) seeded.add(key);
        });
        /* 链式可达：页面没直接点它，但它被某个「已接入」的接口调了出去。
           不这么算就会把 network.loadPlan（由 operation.dispatch 内部复用）、
           jobs.addAlert（巡检任务内部调用）这类误报成断链。
           方向是从已知的往外推：取可达函数的函数体，扫它调了谁，收敛到不动点。
           种子除页面还算核心/视图/种子脚本——它们里写的 TMS.mod.fn 一定跑过 */
        const shellSrc = ['js/data/seed.js', 'js/boot.js', 'js/core/utils.js', 'js/core/db.js', 'js/core/auth.js',
            'js/core/rbac.js', 'js/core/migrations.js', 'js/ui/kit.js', 'js/ui/charts.js', 'js/ui/map.js', 'js/ui/shell.js',
            'js/pages/registry.js']
            .map((rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')).join('\n');
        const ALLKEY = new Set(apiTotal);
        shellSrc.replace(/TMS\.(\w+)\.(\w+)/g, (_, m, fn) => {
            const k = m + '.' + fn;
            if (ALLKEY.has(k)) seeded.add(k);
            return _;
        });
        const reachable = new Set(seeded);
        /* 每个模块声明过的函数名——只有它们能当调用图的节点，
           否则 body 里的 money、iso 这类 util 词会把遍历炸开 */
        const DECLARED = {};
        Object.keys(MOD_SRC).forEach((m) => {
            const set = new Set();
            let dm;
            const dre = /^\s*(?:function\s+|var\s+|let\s+|const\s+)([a-zA-Z_$][\w$]*)\s*(?:\(|=)/gm;
            while ((dm = dre.exec(MOD_SRC[m]))) set.add(dm[1]);
            DECLARED[m] = set;
        });
        const bodies = {};
        function calleesOf(node) {
            if (!(node in bodies)) bodies[node] = domainBody(node.split('.')[0], node.split('.')[1]);
            const body = bodies[node];
            if (!body) return [];
            const out = [];
            /* 跨模块写全名 TMS.operation.costTotal(...)；同模块只写裸名 costTotal(...)，
               且既看调用也看引用——RULES 里的 run: traceOvertime 不带动括号，
               只认「调用」就会把整条巡检链看成没入口 */
            let m;
            const qualified = /TMS\.(\w+)\.(\w+)/g;
            while ((m = qualified.exec(body))) out.push(m[1] + '.' + m[2]);
            const same = node.split('.')[0];
            const bare = /(^|[^\w.$])([a-zA-Z_$][\w$]*)\b/g;
            while ((m = bare.exec(body))) if (DECLARED[same] && DECLARED[same].has(m[2])) out.push(same + '.' + m[2]);
            return out;
        }
        /* 遍历的是「函数节点」而不是「导出接口」：页面 → reprice → feeParts → contRateOf。
           中间的 feeParts 没导出，但它是这一跳的唯一通路，卡住就会冤枉整条链 */
        const walked = new Set();
        const frontier = Array.from(reachable);
        while (frontier.length) {
            const node = frontier.shift();
            if (walked.has(node)) continue;
            walked.add(node);
            calleesOf(node).forEach((c) => {
                if (ALLKEY.has(c)) reachable.add(c);
                if (!walked.has(c)) frontier.push(c);
            });
        }
        const orphans = [];
        apiTotal.forEach((key) => { if (!reachable.has(key)) orphans.push(key); });
        orphans.sort();
        orphans.forEach((k) => log('  ▸ ' + k));
        log('\n  ' + orphans.length + ' / ' + apiTotal.size + ' 个领域接口在六端页面里没有任何入口');
        check('领域接口没有一个写了却没入口', orphans.length === 0,
            orphans.length ? orphans.slice(0, 8).join('、') : apiTotal.size + ' 个接口全部接得上界面或已被调用链带出');
        apiRestore.forEach((fn) => fn());

        db.create = realCreate; db.update = realUpdate; db.remove = realRemove;
        db.removeWhere = realRemoveWhere; db.touch = realTouch; db.commit = realCommit;
        /* 硬门禁：函数体里既不落库、不开界面、不跳转、不导出的动作，就是断链的按钮 */
        check('页面动作没有一个只弹提示', stubHits.length === 0,
            stubHits.length ? stubHits.slice(0, 8).join('、') : '所有动作都推进了业务或界面');
        section('闭环审计（--loop）：只弹提示、不推进任何事的动作');
        stubHits.forEach((k) => log('  ▸ ' + k));
        log('  共 ' + stubHits.length + ' 个');
        section('闭环审计（--loop）：冒烟假主键下没推进业务的动作（仅参考，非门禁）');
        const seen = new Set();
        loopHits.forEach((h) => {
            const key = h.role + '/' + h.pageId + '/' + h.act;
            if (seen.has(key)) return;
            seen.add(key);
        });
        log('  ' + seen.size + ' 个 / 共调用 ' + actCalls + ' 次——多数是动作拿到的是冒烟编的主键，'
            + '在 if (!row) return 处退出，不代表页面有缺陷');
        const dup = {};
        emptyWrites.forEach((k) => { dup[k] = (dup[k] || 0) + 1; });
        if (Object.keys(dup).length) {
            log('\n  空写（update 找不到目标行，通常是引用失效）：');
            Object.keys(dup).slice(0, 12).forEach((k) => log('    ' + k + ' × ' + dup[k]));
        }
    }
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
