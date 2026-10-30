---
kind: error_handling
name: 前端错误处理：基于 try/catch + alert/Toast 的轻量级容错模式
category: error_handling
scope:
    - '**'
source_files:
    - common.js
    - tms-ui.js
    - tms-store.js
    - tms-pages.js
    - branch-operation.html
    - branch-system.html
    - deliveryman-performance.html
    - tms-claim.html
    - tms-monitor.html
---

## 1. 总体方案

本项目是纯静态前端仓库（HTML + 原生 JS），没有后端、没有中间件、没有统一的异常类型定义。错误处理采用以下策略：
- **用户输入校验**：通过 `if` 分支 + `alert()` / `confirm()` 直接阻断流程。
- **业务规则校验**：在页面脚本中 `throw new Error(...)`，由调用方 `try/catch` 捕获并展示。
- **持久化与事件回调**：对 `localStorage` 解析、`CustomEvent` 派发、监听器执行等易失败点使用 `try/catch` 包裹，通常以空 catch 或 `console.error` 降级。
- **UI 反馈**：统一通过 `tms-ui.js` 暴露的 `toast()`、`formModal` 内嵌的错误区域显示成功/失败信息；登录/权限类错误用 `alert()`。

不存在全局 unhandledrejection / window.onerror 处理器，也没有自定义 Error 子类或错误码枚举。

## 2. 关键文件

- `common.js`：通用函数库，集中了登录、权限检查、用户信息等入口处的错误提示逻辑。
- `tms-ui.js`：共享 UI 组件库，提供 `toast()`、`modal()`、`confirmDialog()`、`formModal()` 以及表单验证错误展示。
- `tms-store.js`：本地数据层（基于 localStorage），负责数据初始化、CRUD、订阅通知，内部多处 try/catch 保证脏数据不崩溃页面。
- 各业务 HTML 页面（如 `branch-operation.html`、`branch-system.html`、`deliveryman-performance.html`、`tms-claim.html`、`tms-monitor.html`）：各自页面的业务校验与 try/catch。

## 3. 架构与约定

### 3.1 用户输入与权限错误 → `alert()`
`common.js` 中的 `login()` 在未选择角色或未填用户名密码时调用 `alert('请选择角色')` / `alert('请输入用户名和密码')`；`checkLoginStatus()` 在角色不匹配时 `alert('您没有权限访问此页面')` 后跳转回 `index.html`。这些是面向用户的阻塞式错误提示。

### 3.2 业务校验 → `throw new Error(...)`
`tms-pages.js` 中领料数量校验示例：`if (qty > Number(row.stock)) throw new Error('领用数量不能超过当前库存')`。调用方需自行 try/catch 捕获并展示。

### 3.3 表单提交错误 → `formModal` 内置错误区
`tms-ui.js` 的 `formModal()` 在 `onSubmit` 回调中用 `try { ... } catch (err) { showError(err.message || '保存失败'); }` 捕获同步抛错；对 Promise 返回则 `.catch(function (err) { showError(err.message || '保存失败'); })`。错误统一渲染到表单内的 `.tms-form-error` 元素，而非弹窗。

### 3.4 成功反馈 → `toast()`
`tms-ui.js` 的 `toast(message, type, duration)` 动态创建 `#tms-toast-container`，按类型添加 `tms-toast-info/success/warning/danger` 类名，2.6s 后自动移除。所有保存成功的场景都通过 `toast(opts.successText || '保存成功', 'success')` 提示。

### 3.5 数据层容错 → 静默降级
`tms-store.js` 的 `readDb()` 在 `JSON.parse` 失败时返回 `null`；`emit()` 在派发 `tms:datachange` 事件和遍历 listener 时分别 try/catch，listener 出错仅 `console.error('[TmsStore] listener error', e)`；`importLegacyData()` 对旧格式数据不可用时直接忽略。这种设计确保脏数据不会阻止页面加载。

### 3.6 角标等辅助逻辑 → 宽泛 try/catch
`tms-ui.js` 的 `initShell()` 中计算异常待办角标的代码被整体包裹在 `try { ... } catch (e) { /* 角标失败不影响页面 */ }`，注释明确表达了“辅助功能失败不影响主流程”的原则。

## 4. 约定与约束

- **无统一错误类型**：项目未定义自定义 Error 子类或错误码常量，错误消息以字符串字面量散落在各处（如 `'领用数量不能超过当前库存'`、`'保存失败'`）。
- **用户可见错误**：登录/权限类错误使用 `alert()`；表单校验错误通过 `formModal` 的错误区域展示；操作成功使用 `toast()`。
- **非关键路径错误**：localStorage 解析、事件派发、监听器执行、角标更新等辅助逻辑一律 try/catch 包裹，失败时静默降级或仅 `console.error`。
- **无全局异常拦截**：未发现 `window.onerror`、`unhandledrejection` 等全局处理器，未捕获的 Promise 拒绝会直接抛出。
- **无服务端错误映射**：由于是纯前端静态项目，不存在 HTTP 状态码到业务错误的转换层。
- **XSS 防护**：`tms-ui.js` 提供 `esc()` 工具函数对所有输出进行 HTML 转义，避免错误消息或用户输入引发 XSS。

总体而言，该仓库的错误处理是“分散但一致”的模式：用户交互错误走 `alert`/`toast`，业务校验走 `throw Error`，基础设施错误走 try/catch 静默降级，没有跨模块的统一错误传播机制。