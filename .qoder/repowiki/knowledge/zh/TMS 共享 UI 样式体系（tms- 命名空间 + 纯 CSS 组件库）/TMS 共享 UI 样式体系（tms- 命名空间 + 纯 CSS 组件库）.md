---
kind: frontend_style
name: TMS 共享 UI 样式体系（tms- 命名空间 + 纯 CSS 组件库）
category: frontend_style
scope:
    - '**'
source_files:
    - tms-ui.css
    - tms-ui.js
    - index.html
    - tms-administration.html
---

## 1. 采用的系统/方法

仓库没有引入任何前端框架或 CSS 预处理器，也没有 Tailwind、Bootstrap 等第三方样式库。视觉风格完全由一份自研的共享样式表 `tms-ui.css` 与配套的 JS 组件库 `tms-ui.js` 提供，所有类名统一以 `tms-` 前缀命名，避免与各业务页面自有样式冲突。

- 样式语言：原生 CSS（无 SCSS/Less/Sass，无 CSS Modules / BEM 工具）
- 布局方案：Flexbox + CSS Grid（`display: flex`、`display: grid`、`grid-template-columns: repeat(auto-fit, minmax(...))`），无媒体查询断点以外的响应式策略
- 图标：内联 SVG（通过 `tms-chart svg` 渲染），不依赖字体图标库
- 动画：CSS `transition`（hover、modal 打开、toast 滑入）+ JS 控制 class 切换
- 设计令牌：硬编码在 CSS 中，未抽离为变量；主色 `#4ecdc4`（青绿）、强调红 `#ff6b6b`、成功 `#4caf50`、警告 `#ff9800`、中性灰 `#7b8794` / `#98a4b3` / `#2f3b4a`

## 2. 关键文件

| 文件 | 作用 |
|---|---|
| `tms-ui.css` | 共享 UI 样式表，定义全部 `tms-*` 类 |
| `tms-ui.js` | 共享 UI 组件库（Toast、Modal、Form Modal、确认框、状态徽章、SVG 图表、列表/分页/搜索/筛选等 DOM 生成逻辑） |
| `index.html` | 登录入口，使用内联 `<style>` 覆盖全局基础样式（reset、body、容器、角色按钮），不走 `tms-ui.css` |
| `tms-administration.html` | 管理端装配页，作为模板引用 `tms-ui.css?v=...` 与 `tms-store.js`、`tms-ui.js` |
| 各业务 `.html`（branch-*/client-*/deliveryman-*/sorter-*/transporter-*/tms-*.html） | 通过 `<link href="tms-ui.css">` 复用共享样式 |

## 3. 架构与约定

### 3.1 命名空间隔离
`tms-ui.css` 顶部注释明确声明“仅使用 tms- 前缀，避免与各页面自有样式冲突”，JS 组件生成的 DOM 也一律使用 `tms-*` 类名（如 `tms-modal-overlay`、`tms-toast-container`、`tms-form`、`tms-table`、`tms-pagination`）。这是唯一被代码强制约束的命名约定。

### 3.2 组件化 UI 抽象
`tms-ui.js` 暴露一组函数式 API，每个函数负责渲染一个可复用的 UI 片段：
- `toast(message, type)` — 右上角 Toast 通知（success/error/warning/info）
- `modal(options)` — 通用弹窗（带 overlay、ESC 关闭、点击遮罩关闭）
- `confirmDialog(options)` — Promise 风格的确认对话框
- `formModal(options)` — 基于字段描述数组动态生成表单（支持 text/select/textarea/checkbox，含必填校验与错误区）
- `statusBadge(status, entity)` — 根据 `STATUS_CLASS` 映射输出 `tms-badge tms-badge-{success|info|warn|danger|muted}`
- 表格、分页、搜索、筛选、SVG 折线/环形图均在 JS 中拼接 HTML 并注入到已存在的 `tms-*` 容器中

### 3.3 设计令牌集中但硬编码
颜色、圆角、阴影、间距等值直接写在 CSS 中，例如：
- 卡片/面板：`border-radius: 12px; box-shadow: 0 2px 12px rgba(38,50,70,.06); border: 1px solid #eef1f5`
- 主色：`#4ecdc4`（按钮、focus ring、进度条、时间轴节点）
- 文本层级：`#2f3b4a`（标题）、`#3d4b5c`（正文）、`#7b8794`（次要）、`#98a4b3`（占位/空态）
- 字号：标题 `1.5rem` / KPI 值 `1.75rem` / 正文 `0.85rem` / 辅助 `0.72–0.78rem`

### 3.4 响应式策略
采用 CSS Grid 的 `auto-fit` + `minmax` 实现自适应网格（KPI、详情网格、表单两列），并通过单条 `@media (max-width: 560px)` 将表单回退为单列。没有移动端优先或断点系统。

### 3.5 页面装配模式
`tms-administration.html` 作为管理端的统一外壳，侧边导航 + 内容区，其他 `tms-*.html` 业务页通过 `<script src="tms-store.js">` + `<script src="tms-ui.js">` + `<link href="tms-ui.css">` 接入共享层，再由 `tms-pages.js` 注册页面路由。

## 4. 约定与约束

**观察到的约定（descriptive）：**
- 所有共享 UI 类名以 `tms-` 开头，业务页面不应新增无前缀的全局类。
- 状态值统一走 `STATUS_CLASS` 映射到 `tms-badge-{success|info|warn|danger|muted}`，而非手写颜色。
- 按钮语义通过修饰类区分：`tms-btn-primary`、`tms-btn-success`、`tms-btn-warning`、`tms-btn-danger`、`tms-btn-light`、`tms-btn-xs`。
- 弹窗/Toast 通过 JS API 创建，DOM 结构由 `tms-ui.js` 固定，业务页只调用函数。
- 表格数据通过 `tms-table-wrap > .tms-table` 结构渲染，行可点击用 `tms-row-clickable`，列可排序用 `tms-sortable`。
- 表单统一使用 `tms-form` + `tms-field` 网格布局，必填字段 label 后追加 `<em>*</em>`。

**被代码/文档显式声明的规则：**
- “仅使用 tms- 前缀，避免与各页面自有样式冲突” —— 见 `tms-ui.css` 首行注释，且 JS 组件生成的所有 class 均遵守该约定。
- “所有组件以 tms- 前缀命名，避免与各页面原有样式冲突” —— 见 `tms-ui.js` 文件头注释。
- 登录页 `index.html` 使用内联 `<style>` 做 reset 和登录界面样式，不依赖 `tms-ui.css`，是唯一的例外（因为它是独立入口）。

**未发现的设施：**
- 无 CSS 变量、SCSS、Tailwind 配置、设计令牌 JSON、主题切换机制。
- 无 Lint/CI 规则强制命名规范（未发现 stylelint、ESLint 配置文件）。
- 无多主题/暗色模式支持。
- 无图标字体或 SVG sprite 资源，图表为内联 SVG 路径。
