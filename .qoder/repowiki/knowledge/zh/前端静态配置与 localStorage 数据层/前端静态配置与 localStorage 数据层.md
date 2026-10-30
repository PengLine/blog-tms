---
kind: configuration_system
name: 前端静态配置与 localStorage 数据层
category: configuration_system
scope:
    - '**'
source_files:
    - common.js
    - tms-store.js
    - tms-ui.js
    - index.html
---

## 1. 采用的方案

本项目是一个纯前端（HTML + 原生 JS）的 TMS 运输管理系统，没有后端、没有构建工具、没有配置文件。因此不存在传统的 YAML/ENV/properties 类配置系统。项目中的“配置”以三种形态存在：

- **硬编码常量与字典**：放在顶层 JS 文件中作为全局常量。
- **localStorage 持久化数据层**：通过 `tms-store.js` 把业务数据当作一个带版本号的本地数据库。
- **角色路由表**：在 `common.js` 中集中定义各角色对应的入口页面。

## 2. 关键文件

| 文件 | 职责 |
|---|---|
| `common.js` | 全局通用函数库：订单号/运单号生成规则、登录态管理、用户信息、积分、按钮样式注入、角色→页面路由映射 |
| `tms-store.js` | 基于 `localStorage` 的共享数据层（TmsStore），负责种子数据生成、CRUD、事件分发、状态标签字典 |
| `tms-ui.js` | 共享 UI 组件库（表格、弹窗、图表、Toast），不承载业务配置，但依赖 `TmsStore.labels` 做状态渲染 |
| `index.html` | 统一登录入口，由 `common.js` 的 `login()` 根据 `data-role` 跳转到对应页面 |
| 各角色 HTML 页（`client-*` / `branch-*` / `tms-*` / `deliveryman-*` / `sorter-*` / `transporter-*`） | 消费上述两个共享库，自身不包含配置逻辑 |

## 3. 架构与约定

### 3.1 全局常量与字典（`common.js`）

- `provinceMap`：省份到两字母代码的映射，用于订单号前缀。
- `ORDER_FLOW`、`STATUS_LABELS`、`CITY_PROVINCE`、`CUSTOMERS`、`GOODS`、`CARRIERS`、`DEPARTMENTS`、`PERMISSIONS`、`ROLES`、`AREAS`、`SERVICE_LEVELS`、`PAYMENT_METHODS`、`CUSTOMER_LEVELS`、`TRACE_NODES` 等全部定义在 `tms-store.js` 顶部，作为“可编辑的业务字典”。
- 新增字典项时直接修改这些数组/对象；UI 侧通过 `TmsStore.labels[entity][status]` 读取显示文本。

### 3.2 数据持久化与版本迁移（`tms-store.js`）

```js
var DB_KEY = 'tmsDB_v3';
var DB_VERSION = 3;
```

- 所有业务数据统一序列化后写入 `localStorage['tmsDB_v3']`。
- `readDb()` 会校验 `parsed.version === DB_VERSION`，版本不一致则丢弃旧数据并重新 seed。
- `init(force)` 是入口：若未初始化或 force 为真，则调用 `seed()` 生成演示数据，再 `persist()` 落盘。
- `importLegacyData()` 兼容旧格式 `tmsUsers`，体现向前兼容策略。

### 3.3 事件驱动的跨页同步

```js
document.dispatchEvent(new CustomEvent('tms:datachange', { detail: { at: Date.now() } }));
```

- 任何 `create/update/remove/reset` 都会触发 `tms:datachange` 事件。
- `subscribe(fn)` 提供订阅/取消订阅机制，`tms-ui.js` 的 `table()` 组件通过它实现列表实时刷新。

### 3.4 身份与会话配置（`common.js`）

- 登录态 key：`localStorage['tmsUser']`，结构 `{ username, role }`。
- 用户资料 key：`localStorage['tmsUserProfile']`。
- 积分 key：`localStorage['tmsUserPoints']`，结构 `{ balance, history[] }`。
- 角色→页面路由表集中在 `login()` 内：

```js
const rolePages = {
    'client': 'client-index.html',
    'branch': 'branch-index.html',
    'admin': 'tms-index.html',
    'sorter': 'sorter-index.html',
    'transporter': 'transporter-index.html',
    'deliveryman': 'deliveryman-index.html'
};
```

- 权限检查通过 `checkLoginStatus(requiredRole)` 比较当前用户的 `role` 字段与页面要求的 `requiredRole`。

### 3.5 无外部配置源

- 仓库中没有 `.env`、`.yaml`、`.toml`、`application.properties`、`config.json` 等任何配置文件。
- 没有环境变量读取逻辑（如 `process.env`、`import.meta.env`）。
- 没有 feature flag 开关、A/B 测试开关、灰度发布开关。
- 没有多环境（dev/staging/prod）切换逻辑。
- 所有“配置”都是代码级常量，修改需改源码并重新部署静态文件。

## 4. 观察到的约定与约束

- **ID 生成约定**：所有实体 ID 使用 `prefix-YYYYMMDD-seq` 形式（见 `counterNext` / `counterSeed`），不同实体有固定前缀映射（`EX`、`TR`、`SV`、`CLM`、`FIN`、`VEH`、`CAP`、`GF`、`POL`、`RUL`、`ADDR`、`TMR`、`CHG`、`KPI`、`EV`、`EMP`、`SRT`、`LOD`、`SC`、`user`、`role`、`perm`、`dept`）。
- **订单号/运单号规范**：`HL` + 省份代码 + 时间戳 + 4 位用户 hash + 4 位随机数；运单号为 `WB` + 10 位订单号 hash + 4 位随机数，该规则同时出现在 `common.js` 和 `tms-store.js` 中，两处实现需保持一致。
- **状态机**：订单生命周期严格遵循 `ORDER_FLOW` 定义的顺序（pending → inbound → sorted → shipping → arrived → delivering → signed），其他实体的状态集合由 `STATUS_LABELS` 集中声明。
- **localStorage 键命名空间**：业务数据用 `tmsDB_v3`，用户会话用 `tmsUser`，用户档案用 `tmsUserProfile`，积分用 `tmsUserPoints`，旧用户数据兼容键 `tmsUsers`——新增存储应沿用 `tms*` 前缀以避免冲突。
- **UI 组件命名空间**：所有 DOM 类名以 `tms-` 前缀开头，避免与页面自有样式冲突（见 `tms-ui.js` 注释）。
- **向后兼容**：`readDb()` 对 JSON 解析异常返回 null；`emit()` 对浏览器差异 try/catch；`init()` 支持 `force` 参数强制重建——这是唯一显式文档化的容错约定。

## 5. 结论

本项目的“配置系统”本质上是：**JS 模块内的常量字典 + localStorage 版式化数据库 + 角色路由表**。它适合演示/原型用途，但不具备运行时加载、多环境隔离、密钥管理、远程下发能力。如需引入真正的配置中心，需要新增独立的配置加载器（例如从 `config.json` 或远端 API 拉取），并在 `tms-store.js` 的 `seed()` 之前合并覆盖默认字典。