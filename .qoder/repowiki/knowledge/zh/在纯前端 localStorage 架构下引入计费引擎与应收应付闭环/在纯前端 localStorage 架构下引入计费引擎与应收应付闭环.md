---
kind: design
name: 在纯前端 localStorage 架构下引入计费引擎与应收应付闭环
source: session
category: adr
---

# 在纯前端 localStorage 架构下引入计费引擎与应收应付闭环

_来源：ef1a37d → 3cefdef 提交周期内记录的编码计划——内容为规划时意图，实现可能滞后或有出入。_

**状态：** accepted

## 背景
TMS 演示系统此前仅有订单/运输/财务等基础页面，缺少真实计费逻辑、应收账款生成、异常工单 SLA 与轨迹偏差检测；同时需扩展运价模板、账单、应付、多段路由等新集合。项目约束为纯前端（无后端/构建），数据持久化仍依赖 `localStorage`，且必须兼容现有 ID 规范与 `scans` 500 上限。

## 决策驱动
- 保持纯前端架构不变（不引入后端/构建）
- 通过 `DB_VERSION` 升级 + `seed()` 重新播种实现零迁移成本
- 新增业务以 `global.TmsStore` 对外暴露，页面统一经 `S.xxx` 调用
- 控制新集合种子规模，避免 localStorage 超限

## 备选方案
- **引入后端 API 服务承载计费与账务** _（已否决）_ — 优点：计算可复杂化、事务安全、天然支持并发；缺点：违背纯前端约束，增加部署/运维复杂度，超出演示系统范围
- **原地扩展 order 字段承载运费明细** _（已否决）_ — 优点：改动最小；缺点：无法支撑独立 rateCards、bills、receivables、payables 等多实体关系，也无法复用 `calcFreight` 供报价页使用
- **维持现状仅加 UI 页面** _（已否决）_ — 优点：改动最少；缺点：无法演示真实计费、SLA、异常扣款等业务闭环

## 决策
在 `tms-store.js` 中新增 `rateCards/bills/receivables/payables/routes` 集合与 `TRACE_NODES` 字典，实现 `calcFreight` 计费引擎、`advanceOrder/cancelOrder/changeOrder/createReverseOrder` 全生命周期动作、`processException/closeException` 异常闭环以及 `planRoute/matchDeviant/checkTracesOvertime` 轨迹校验；所有方法挂到 `global.TmsStore`，页面通过 `S.xxx` 调用，数据变更仍走 `persist()→emit()`。`DB_VERSION` 从 2 升到 3，版本不匹配时 `readDb` 返回 null 触发 `seed()` 重新播种。

## 影响
获得可演示的端到端业务流：报价试算 → 下单 → 轨迹追踪 → 超时/偏差预警 → 异常定责扣款 → 应收核销。代价是 `localStorage` 容量压力增大，需在 seed 中严格限制各集合条目数；ID 生成器签名保持不变以避免下游破坏。