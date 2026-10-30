# TMS 业务引擎增强方案

## 总览与约束
- 架构不变：纯前端 `localStorage`（[tms-store.js](file:///e:/Projects/blogs/blog-tms/tms-store.js)）+ 声明式页面装配（[tms-pages.js](file:///e:/Projects/blogs/blog-tms/tms-pages.js)）+ UI 组件（[tms-ui.js](file:///e:/Projects/blogs/blog-tms/tms-ui.js)）。不引入构建/后端。
- **Schema 升级**：`DB_VERSION` 2→3、`DB_KEY` `tmsDB_v2`→`tmsDB_v3`。因新增大量字段/集合，版本不匹配时 `readDb` 返回 null 触发重新 `seed()`（演示数据，可接受；`TmsStore.reset()` 仍可用）。
- **保留既有 ID 规范**（见 [readme](file:///e:/Projects/blogs/blog-tms/readme)）：订单 `HL+省份码+时间戳+4位hash+4位随机`、运单 `WB+10位hash+4位随机`，即 `buildOrderId/buildWaybill` 不改签名。
- **性能护栏**：新集合种子控制在合理规模（订单仍 ~90 条；bills/receivables/payables/traces 各自限量），沿用 `scans` 500 上限思路，避免 localStorage 超限。
- 全部新增对外方法挂到 `global.TmsStore`，页面通过 `S.xxx` 调用；数据变更仍走 `persist()→emit()`。

---

## Phase A — 数据层与业务引擎（tms-store.js）

### A1. 新集合 + 字典
- `rateCards` 运价模板：`{id, name, origin, destination, service(标准/加急/经济/冷链), firstWeight, firstPrice, continueUnit, continuePrice, throwRatio(抛比6000/8000), fuelRate, minimum, remoteFee, insuredRate, status}`；按线路+服务等级生成 ~20 条真实档位（含全国兜底卡）。
- `bills` 客户账单：`{id, billNo, customer, period(yyyy-MM), itemCount, totalAmount, receivedAmount, status(draft/confirmed/settled/disputed), dueDate, createdAt}`。
- `receivables` 应收账款：`{id, orderId, customer, amount, paymentMethod, settleCycle, issuedAt, dueDate, status(unpaid/partial/paid/overdue), billId}`。
- `payables` 成本应付：`{id, target, targetType(carrier/driver/branch), category(干线运费/理赔扣款/异常扣款), refId, amount, period, status, settledAt}`。
- `routes` 升级路由：多段 `{id, origin, destination, segments:[{seq, from, to, mode, stdHours}], totalStdHours, priority, status}`（现有 `routingRules` 保留兼容）。
- `TRACE_NODES` 节点字典：揽收/入库/分拣/装车/发车/到达/派送/签收 + 退回/拦截/超区/问题件；每节点带 `stdHours` 时限。

### A2. 订单数据模型扩展（seed + createOrder 同步）
每条 order 增加：`orderType(forward/reverse/intercept)`、`service`、`volume/dims(LxWxH)`、`volumetricWeight`、`chargeableWeight`、`declaredValue`、`isInsured`、`freightBreakdown{基础,续重,燃油,偏远,保价,到付,折扣,total}`、`paymentMethod(现付/到付/月结)`、`settleCycle`、`receivableStatus`、`routeId`、`planSegments`、`traces[]`（比 timeline 更细，带 node/location/opTime/deadline/isOvertime/isDeviant）、`slaDeadline`。
- seed 中运费改由 `calcFreight()` 生成（替换随机 `amount`），并按线路写 `planSegments`、按状态生成 `traces`（含若干 `isOvertime`/`isDeviant` 样本，供轨迹页预警演示）。

### A3. 计费引擎 `calcFreight(order)`
1. 选 `rateCards`：精确匹配 lane+service，未命中回退全国兜底卡。
2. 体积重 = L×W×H/抛比；计费重 = max(实际重, 体积重, 最低计费重)。
3. 基础 = firstPrice + ceil((计费重-firstWeight)/continueUnit)×continuePrice；不足 minimum 取 minimum。
4. 附加：燃油 = 基础×fuelRate；偏远（目的地在偏远名单）加 remoteFee；保价 = declaredValue×insuredRate（`isInsured`）；到付手续费（`paymentMethod==='到付'`）。
5. 折扣：按客户等级（月结大客户）。
6. 返回 `freightBreakdown`，`freight = total`。
- 对外：`quote(params)` 试算（新页用）、`createOrder`/改单重算均调用它。

### A4. 订单全生命周期动作
- `advanceOrder`：推进时按节点写 `traces`（含 deadline）+ 触发 `ensureReceivable`（signed 后按付款方式建应收/收入）。
- `cancelOrder(orderId, reason)` 联动：已产生运输→置 `orderType=intercept`（拦截件）而非直接删；作废未核销 receivable；生成冲销 finance（负收入/void）；释放 `capacities.remaining`、vehicle 回 online。
- `changeOrder(orderId, patch)`：改址/改约/改重量，重量或线路变化触发 `calcFreight` 重算并写 `changeRecords` + trace 变更节点。
- `createReverseOrder(orderId, reason)`：由拒收/退货异常生成逆向件（`orderType=reverse`，独立流程），正向单置退回。

### A5. 异常工单闭环
`exceptions` 增加：`level(一/二/三)`、`slaDeadline`、`escalated`、`responsibleParty(承运商/网点/司机/仓库/客户)`、`responsible`、`solution(补发/改派/理赔/退回)`、`rootCause`、`deductionAmount`、`linkedClaimId`、`linkedTicketId`、`flow[]`（处理留痕）。
- `processException` → 受理并记 flow；`assignResponsibility(id,{party,responsible,deduction})`；`closeException(id,{solution,resolution,createClaim})` → 闭环，若定责扣款则生成 `payables`（向责任方）+ 冲抵 finance；`resolveException` 保留旧签名兼容（内部转 `closeException`）。
- SLA：`overdueExceptions()` 返回超 `slaDeadline` 未闭环项；`escalate(id)` 升级并写 flow。

### A6. 路由与轨迹
- `planRoute(order)`：按起终点取 `routes.segments` 写 `planSegments` + 逐段 deadline。
- `matchDeviant(order)`：比对最近扫描 location 与计划段，命中差异置 trace.isDeviant。
- `checkTracesOvertime()`：扫描在途单，当前节点超 deadline 写 `isOvertime` 并（可）自动生成延迟异常。

### A7. 统计聚合扩展
- `billingSummary(days)`：应收总额/逾期额/回款率/账龄分布(0-30/31-60/61-90/90+)。
- `payableSummary(period)`：成本应付合计/待结/已结。
- `routeStats()`：线路数、平均全程时效、偏差单数。
- `traceOvertimeStats()`：超时节点数、按线路 TopN、升级中异常数。
- `orderLifecycleStats()`：各状态含 reverse/intercept 计数、取消率、逆向率。
- 现有 `overview()` 增补 `overdueReceivable`、`overtimeTraces`、`escalatedExceptions` 字段（[tms-index.html](file:///e:/Projects/blogs/blog-tms/tms-index.html) 直接可用）。

---

## Phase B — 页面装配（tms-pages.js 新增 6 个 define）

复用 `define/render/U.table/U.formModal/U.charts`，每个含 KPI + 表格 + 操作（+ 图表/试算面板）：
1. **`order` 订单管理**（生命周期）：搜索/按状态+类型筛选；列：订单号(orderLink)/运单/客户/类型/计费重/运费/付款方式/状态/时效；操作：新建订单(带计费试算联动)、推进、改单(changeOrder 表单+重算预览)、取消(联动提示)、转逆向、详情(轨迹 timeline + freightBreakdown 明细 + 应收状态)。`extraAfter` 放生命周期状态分布 donut。
2. **`rate` 运价管理**：rateCards CRUD；`extraBefore` 放**计费试算工具**（输入起终点/重量/体积/服务/付款方式 → `S.quote()` 显示费用明细分解）。
3. **`receivable` 应收结算**：receivables + bills；列含到期/账龄/状态；操作：生成账单(按月+客户聚合 unpaid→bill)、核销收款(markPaid + 生成 income 冲应收)、争议;KPI 逾期额/回款率;`extraAfter` 账龄分布 bar。
4. **`route` 路由管理**：routes 多段维护（新增/编辑线路及其 segments、时效、优先级）；列展示全程时效/段数;偏差样本标记。
5. **`tracking` 轨迹中心**：以 traces 为数据源的轨迹流水表（按运单搜索）;`extraBefore` 放超时/偏差预警面板（`checkTracesOvertime`+`traceOvertimeStats`）;操作：补录节点、标记处理。
6. **`workflow` 异常工单闭环**：exceptions 看板;列含级别/SLA/责任方/状态;操作：受理→定责(assignResponsibility 表单)→闭环(closeException，联动理赔/扣款);`extraBefore` 超时未闭环 TopN + 升级。

同步微调现有页面以联动新引擎（不新建，最小改动）：
- `transport` 调度发车后调用 `planRoute`；完成运输触发应收。
- `finance` 表格增加"来源"区分应收核销/应付扣款（复用 finances）。
- 订单详情 `orderDetail()`（[tms-pages.js](file:///e:/Projects/blogs/blog-tms/tms-pages.js) 顶部）追加 freightBreakdown 与计费重展示。

---

## Phase C — 新 HTML 页面 + 导航注入

- 以精简 admin 页为模板新建 6 个文件：`tms-order.html / tms-rate.html / tms-receivable.html / tms-route.html / tms-tracking.html / tms-workflow.html`。每个含：现有 `<head>` 元信息/`tms-ui.css`、header、内联完整侧边栏导航、`<section class="content">` 空壳、四个 script（common/store/ui/pages）与 `TmsPages.render('<id>', document.querySelector('.content'))` 初始化（角色 `admin`，同现有页）。
- **批量注入导航**：写脚本（PowerShell 或复用 `update_*.py` 风格）向所有含锚点 `<li><a href="tms-transport.html">运输管理</a></li>` 的 `tms-*.html`（22 个）插入 6 条新 `<li>`（订单管理/运价管理/应收结算/路由管理/轨迹中心/异常工单），置于"运输管理"之后；同时对 6 个新页面自身导航亦包含全部条目。
- [tms-index.html](file:///e:/Projects/blogs/blog-tms/tms-index.html) 快捷入口区 `dash-quick` 增加"订单/运价/应收"入口（可选）。

---

## Phase D — 自检与交付
- 语法：`GetProblems` 检查 tms-store.js / tms-pages.js / 6 个新 HTML。
- 引擎自测：浏览器控制台顺序验证（或临时脚本）——`TmsStore.quote({origin:'北京',destination:'上海',weight:12,volume:0.05,service:'标准',paymentMethod:'月结'})` 返回合理明细；`createOrder`→`advanceOrder` 到 signed 后应收/流水/轨迹齐备；`cancelOrder` 释放运力/冲销；`closeException` 生成扣款 payable。
- 数据完整：`reset()` 后新集合非空、KPI 无 NaN/除零；跨标签页 `storage` 事件仍同步。
- 一致性：新页面遵循 [tms-pages.js](file:///e:/Projects/blogs/blog-tms/tms-pages.js) 现有文案/字段风格；只写系统真实具备能力。

## 影响文件清单
- 改造：`tms-store.js`（引擎+种子+聚合，主战场）、`tms-pages.js`（6 define + 3 处微调）、`tms-index.html`。
- 新增：`tms-order.html`、`tms-rate.html`、`tms-receivable.html`、`tms-route.html`、`tms-tracking.html`、`tms-workflow.html`、导航注入脚本。
- 批量小改：全部 `tms-*.html` 侧边栏（脚本注入）。

## 分阶段可独立验收
A（引擎+数据，页面未接也有 console 可用）→ B（6 define）→ C（页面+导航上线）→ D（自检）。建议按此顺序实施，每阶段完成即可预览。