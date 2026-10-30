---
kind: logging_system
name: 基于浏览器 console 的裸日志输出（无专用日志框架）
category: logging_system
scope:
    - '**'
source_files:
    - common.js
    - tms-store.js
    - sorter-mock-data.js
---

## 1. 使用的系统/方案

本仓库是一个纯前端静态站点（HTML + 原生 JS），**没有引入任何第三方日志库或框架**（如 log4js、winston、pino、bunyan 等）。所有日志输出均直接使用浏览器原生的 `console` API，即 `console.log` / `console.error`。不存在统一的 logger 初始化模块、日志级别配置、结构化字段定义或日志路由机制。

## 2. 关键文件

- `common.js`：登录、用户信息、积分等通用逻辑中大量使用 `console.log` 输出调试信息（用户名、角色、localStorage 内容、当前用户、更新后的 profile 等）。
- `tms-store.js`：唯一一处使用 `console.error` 的地方，在 TMS Store 监听器执行异常时捕获并打印错误：`console.error('[TmsStore] listener error', e)`。
- `sorter-mock-data.js`：分拣员端示例数据生成脚本，几乎每条数据构造完成后都通过 `console.log` 打印“XX 数据生成完成”之类的进度信息。

其余 `.html` 页面与 `tms-ui.js`、`tms-pages.js` 中未发现额外的日志调用（grep 结果仅返回上述三处匹配）。

## 3. 架构与约定

- **无集中式日志层**：没有 `log/`、`logging/` 目录，也没有独立的 logger 模块；每个需要输出的位置直接调用 `console.log` / `console.error`。
- **无日志级别管理**：未实现 debug/info/warn/error 分级，也未根据环境（开发/生产）切换输出策略。
- **无结构化字段**：日志消息以人类可读的拼接字符串为主（例如 `'login - username:', username, 'role:', role`），没有统一的 JSON 结构体或固定字段（如 timestamp、level、module、traceId）。
- **无日志收集/上报**：没有将日志发送到远端服务、文件或存储后端的代码。
- **最小化的错误日志**：仅在 `tms-store.js` 中对异步监听器异常做了 try/catch + `console.error` 兜底，属于局部防御性编程而非全局错误处理体系。

## 4. 约定与约束

- **观察到的约定**：
  - 调试型日志统一使用 `console.log`，并以键值对形式输出上下文变量（见 `common.js` 中 `login`、`checkLoginStatus`、`displayCurrentUser`、`saveUserProfile`、`addUserPoints` 等函数）。
  - 模拟数据生成脚本使用中文提示语（如 `今日统计数据生成完成:`、`开始生成分拣员角色示例数据...`）。
  - 错误路径使用 `console.error` 并在消息前加模块前缀（`[TmsStore]`）以便区分来源。
- **无强制约束**：仓库中没有 lint 规则、ESLint 配置、CI 检查或文档强制要求某种日志格式；因此这些只是已实现的风格，并非被工具链保证的约束。

## 结论

该仓库的“日志系统”本质上是**零配置的浏览器 console 直出**，不具备日志框架的典型特征（级别、结构化、可插拔 sink、采样、过滤等）。若后续需要增强，应首先抽象一个统一的 logger 模块来替代散落的 `console.log` 调用。