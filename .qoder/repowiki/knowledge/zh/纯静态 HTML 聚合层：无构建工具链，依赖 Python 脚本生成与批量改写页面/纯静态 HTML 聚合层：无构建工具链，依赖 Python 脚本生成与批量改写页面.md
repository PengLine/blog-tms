---
kind: build_system
name: 纯静态 HTML 聚合层：无构建工具链，依赖 Python 脚本生成与批量改写页面
category: build_system
scope:
    - '**'
source_files:
    - gen_pages.py
    - update_all_auth.py
    - update_login_functions.py
    - update_login_simple.py
    - common.js
    - tms-store.js
    - tms-ui.js
    - tms-pages.js
---

## 1. 构建系统概览

本仓库是一个**纯静态前端聚合层**，不包含任何传统意义上的构建系统（无 `Makefile`、`Dockerfile`、`package.json`、`webpack.config.*`、CI YAML 等）。所有业务页面均为独立 `.html` 文件，直接由浏览器加载；运行时通过 `<script src="tms-ui.js?{cache}">` 等带查询参数的 URL 引用共享 JS/CSS，利用浏览器缓存机制实现版本控制。

因此，该仓库的“构建”实质是 **Python 脚本驱动的源码生成 + 批量文本替换**，而非编译/打包流程。

## 2. 关键脚本与职责

| 文件 | 作用 |
|---|---|
| `gen_pages.py` | 根据 `PAGES` 元数据（id, title）模板化生成 `tms-*.html` 新页面，并向已有 `tms-*.html` 侧边栏注入导航项；同时维护 `CACHE = "v=20261030a"` 作为资源版本号。 |
| `update_all_auth.py` | 扫描根目录下全部 `.html`，将内联认证逻辑（`localStorage.getItem('tmsUser')`、`checkLoginStatus()`、`logout()`、用户名显示）统一替换为调用 `common.js` 中的 `getCurrentUser()` / `displayCurrentUser()`。 |
| `update_login_functions.py` | 针对白名单中指定文件的登录相关代码进行定向替换（与上者互补，后者是全量扫描）。 |
| `update_login_simple.py` | 另一个登录函数批量更新脚本（存在但未在上述两个脚本中被引用）。 |

## 3. 架构与约定

- **页面生成模型**：`gen_pages.py` 定义 `TEMPLATE`（含完整 HTML shell）、`SHELL_CSS`（基础样式）、`NAV_NEW` / `NAV_E2`（侧边栏导航片段）、`SELF_PAGES`（已自带完整导航、跳过自动注入的新页面集合）。运行后对每个 `(pid, title)` 写入 `tms-{pid}.html`，并对非 `SELF_PAGES` 的现有 `tms-*.html` 做正则匹配注入。
- **幂等性保证**：脚本通过检测锚点（`tms-transport.html`、`tms-receivable.html`）和已注入标记（是否包含 `tms-order.html` / `tms-payable.html`）判断三种状态——未注入、部分注入、完全注入——从而安全重复执行。
- **资源版本策略**：`CACHE = "v=20261030a"` 硬编码在 `gen_pages.py` 中，模板渲染时拼入 `tms-ui.css?v=...`、`common.js?v=...` 等 URL，用于绕过浏览器缓存。
- **角色页面分组**：仓库按角色划分目录前缀（`tms-` 管理端、`client-` 客户端、`branch-` 网点端、`deliveryman-` 派送员、`sorter-` 分拣员、`transporter-` 运输员），但所有页面平铺在根目录，没有子模块或构建入口。
- **共享运行时契约**：`common.js`、`tms-store.js`、`tms-ui.js`、`tms-pages.js` 是所有页面的共同依赖，由 `gen_pages.py` 生成的模板统一引入。

## 4. 约定与约束

- **新增业务页面**：需先在 `gen_pages.py` 的 `PAGES` 列表中添加 `(id, title)` 条目，再运行 `python gen_pages.py` 生成 HTML 并注入导航；若页面需要自定义侧边栏，则将其文件名加入 `SELF_PAGES` 集合以跳过自动注入。
- **导航一致性**：侧边栏导航顺序由 `nav_html()` 返回的 `NAV_NEW` + 既有导航拼接而成，新增菜单项应在此处声明，而非手工编辑各 HTML。
- **认证逻辑集中化**：禁止在各 HTML 中直接操作 `localStorage.getItem('tmsUser')` 或内联 `checkLoginStatus` / `logout`；应使用 `common.js` 暴露的 `getCurrentUser()` / `checkLoginStatus('admin')` / `logout()` / `displayCurrentUser()`。`update_all_auth.py` 即用于强制执行这一迁移。
- **资源缓存失效**：修改 `tms-ui.css` / `common.js` / `tms-store.js` / `tms-ui.js` / `tms-pages.js` 后，需同步更新 `gen_pages.py` 中的 `CACHE` 常量以触发浏览器重新拉取。
- **无 CI / 无容器化 / 无包管理器**：仓库根目录不存在 `Makefile`、`Dockerfile*`、`.github/workflows/*`、`package.json`、`pnpm-lock.yaml`、`yarn.lock`、`requirements.txt` 等构建工件；部署方式未在仓库内体现。

## 5. 结论

该仓库的“构建系统”本质上是三个 Python 脚本组成的轻量级源码生成器与代码迁移器，配合浏览器 URL 查询参数完成资源版本控制。它不执行编译、压缩、打包或发布流水线，也不具备跨平台交叉编译能力。