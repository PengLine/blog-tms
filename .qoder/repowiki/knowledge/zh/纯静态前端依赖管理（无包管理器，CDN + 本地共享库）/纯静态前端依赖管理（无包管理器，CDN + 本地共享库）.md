---
kind: dependency_management
name: 纯静态前端依赖管理（无包管理器，CDN + 本地共享库）
category: dependency_management
scope:
    - '**'
source_files:
    - common.js
    - tms-ui.js
    - tms-store.js
    - tms-pages.js
    - branch-system.html
    - client-branch.html
    - client-index.html
    - branch-operation.html
---

## 1. 使用的系统/方式

本仓库是一个纯静态前端项目（HTML + CSS + JS），没有使用任何现代包管理器或构建工具：
- 不存在 package.json、go.mod、pom.xml、Cargo.toml、yarn.lock、pnpm-lock.yaml、requirements.txt、vendor/、node_modules/ 等依赖清单或锁定文件。
- 所有第三方库通过 <script src="..."> 直接以 CDN URL 引入，版本硬编码在 HTML 中。
- 业务逻辑与 UI 组件以本地 .js 文件形式作为“共享库”被各页面引用，属于手工维护的依赖关系。

## 2. 关键文件

- common.js：全局通用函数库（订单号/运单号生成、按钮样式注入、登录鉴权、角色跳转等），被几乎所有业务页面通过 <script src="common.js"></script> 引用。
- tms-ui.js：TMS 运营管理后台的共享 UI 组件库（列表、搜索/筛选/分页、表单弹窗、确认框、Toast、SVG 图表等），以 IIFE 暴露到全局。
- tms-store.js、tms-pages.js：后台页面的数据层与页面注册器。
- client-branch.html、branch-system.html、branch-operation.html、client-index.html、client-profile.html：引入外部 CDN 依赖的典型页面。

## 3. 架构与约定

### 3.1 本地共享库（内聚依赖）
- 每个业务子模块（branch / client / deliveryman / sorter / transporter / tms-*）下的 HTML 页面通过相对路径 <script src="common.js"></script> 引用 common.js，形成“多页面 → 共享库”的单向依赖。
- common.js 在加载时自动执行 document.addEventListener('DOMContentLoaded', injectButtonStyles)，向页面注入统一按钮样式，体现“库主动装配”的约定。
- tms-ui.js 采用 IIFE (function (global) { ... })(this) 包裹，避免污染全局命名空间，仅通过 global.TmsStore 等显式挂载点与页面交互。

### 3.2 第三方库（CDN 直引）
| 库 | 引入位置 | 版本 |
|---|---|---|
| Chart.js | branch-operation.html、branch-system.html、client-index.html、client-profile.html | https://cdn.jsdelivr.net/npm/chart.js（未固定具体小版本） |
| Leaflet | branch-system.html、client-branch.html | 1.9.4（https://unpkg.com/leaflet@1.9.4/dist/leaflet.js） |
| leaflet-draw | branch-system.html | 1.0.4（https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.js） |
| leaflet-china-boundary | client-branch.html | 1.0.2（https://unpkg.com/leaflet-china-boundary@1.0.2/dist/china.js） |

### 3.3 依赖声明位置
- 无集中式清单；依赖声明分散在各 HTML 文件的 <head> 或 <body> 末尾的 <script src="..."> 标签中。
- 同一库可能在不同页面重复引入多个版本（例如 Chart.js 在多个页面分别引入），未见去重或聚合脚本。

## 4. 约定与约束

- 描述性约定：
  - 所有跨页面复用的 JS 逻辑集中在根目录的 common.js，业务页面不重复实现订单号/运单号生成与登录逻辑。
  - TMS 后台页面的 UI 能力集中在 tms-ui.js，并以 tms- 前缀命名类名以避免与页面原有样式冲突（见 tms-ui.js 注释）。
  - 第三方库一律通过 unpkg/jsdelivr CDN 引入，不使用本地 node_modules 或 vendor 目录。
  - 部分第三方库（Leaflet、leaflet-draw、leaflet-china-boundary）在 HTML 中固定了语义化版本号，而 Chart.js 的 CDN URL 未固定具体版本。

- 可验证的规则：
  - 仓库根目录不存在 package.json、go.mod、requirements.txt、yarn.lock、pnpm-lock.yaml、poetry.lock、Pipfile、Gemfile、Cargo.toml、go.sum、vendor/、node_modules/ 等任何包管理器或锁定文件——经对根目录 tree 扫描确认。
  - 所有第三方 JS 依赖均通过 HTML 中的 <script src="https://..."> 引入，未发现 import/require 语句用于加载第三方库。
  - 页面间共享的本地 JS 依赖通过相对路径 <script src="common.js"></script> 引入，未见绝对路径或 CDN 形式的本地库引用。

- 风险点：
  - 无锁定文件意味着无法保证构建/运行时的依赖版本一致性，Chart.js 尤其存在上游更新导致行为变化的风险。
  - 无自动化升级机制（无 Dependabot、Renovate、npm audit 等），版本更新需人工修改 HTML 中的 CDN URL。
  - 同一库在多页面重复引入且版本不一致（如 Chart.js 未固定版本）可能导致不同页面行为差异。