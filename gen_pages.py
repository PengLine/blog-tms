# -*- coding: utf-8 -*-
"""
生成新增业务页面（订单/运价/应收/应付/计费复核/路由/轨迹/异常工单），
并向所有含“运输管理”锚点的 tms-*.html 侧边栏注入新导航。
对已注入旧 6 条的页面做第二轮增量（在应收后补插应付/复核）。
一次性构建脚本，可安全重复运行（新页面整体重写；注入幂等）。
"""
import os
import re

ROOT = os.path.dirname(os.path.abspath(__file__))
CACHE = "v=20261030c"

# 需要在“运输管理”之后注入的新导航（缩进与各页 ul 一致）
NAV_NEW = [
    '                        <li><a href="tms-order.html">订单管理</a></li>',
    '                        <li><a href="tms-rate.html">运价管理</a></li>',
    '                        <li><a href="tms-receivable.html">应收结算</a></li>',
    '                        <li><a href="tms-payable.html">应付结算</a></li>',
    '                        <li><a href="tms-audit.html">计费复核</a></li>',
    '                        <li><a href="tms-route.html">路由管理</a></li>',
    '                        <li><a href="tms-tracking.html">轨迹中心</a></li>',
    '                        <li><a href="tms-workflow.html">异常工单</a></li>',
    '                        <li><a href="tms-delivery.html">派送管理</a></li>',
    '                        <li><a href="tms-cod.html">代收货款</a></li>',
]

# 第二轮增量：已含“应收结算”但尚未插入应付/复核的页面，在应收后补插以下两条
NAV_E2 = [
    '                        <li><a href="tms-payable.html">应付结算</a></li>',
    '                        <li><a href="tms-audit.html">计费复核</a></li>',
]

# 第三轮增量：已含旧导航但尚未插入派送/代收货款的页面，在“异常工单”后补插以下两条
NAV_F2 = [
    '                        <li><a href="tms-delivery.html">派送管理</a></li>',
    '                        <li><a href="tms-cod.html">代收货款</a></li>',
]

# 新页面（id, 标题）
PAGES = [
    ("order", "订单管理"),
    ("rate", "运价管理"),
    ("receivable", "应收结算"),
    ("payable", "应付结算"),
    ("audit", "计费复核"),
    ("route", "路由管理"),
    ("tracking", "轨迹中心"),
    ("workflow", "异常工单闭环"),
    ("delivery", "派送管理"),
    ("cod", "代收货款"),
]

# 自建完整导航的新页面（注入时跳过）
SELF_PAGES = {
    "tms-order.html", "tms-rate.html", "tms-receivable.html", "tms-payable.html",
    "tms-audit.html", "tms-route.html", "tms-tracking.html", "tms-workflow.html",
    "tms-delivery.html", "tms-cod.html",
}

# 复用各管理页一致的基础外壳样式（重置 + header + sidebar + nav + content + 响应式）
SHELL_CSS = """        /* 基础样式重置 */
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background-color: #f5f7fa;
            color: #333;
            line-height: 1.6;
        }

        .hidden {
            display: none !important;
        }

        /* 顶部导航 */
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 1rem 2rem;
            background: white;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
        }

        .logo {
            font-size: 1.5rem;
            font-weight: bold;
            color: #96ceb4;
        }

        .user-info {
            display: flex;
            align-items: center;
            gap: 1rem;
        }

        .user-info button {
            padding: 0.5rem 1rem;
            background: #ff6b6b;
            color: white;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            transition: background 0.3s ease;
        }

        .user-info button:hover {
            background: #ee5a5a;
        }

        /* 主内容区域 */
        .main-content {
            display: flex;
            min-height: calc(100vh - 70px);
        }

        /* 侧边栏样式 */
        .sidebar {
            width: 250px;
            background: white;
            box-shadow: 2px 0 10px rgba(0, 0, 0, 0.1);
            padding: 1rem;
        }

        .nav h3 {
            margin-bottom: 1rem;
            color: #666;
            font-size: 1rem;
        }

        .nav ul {
            list-style: none;
        }

        .nav li {
            margin-bottom: 0.5rem;
        }

        .nav a {
            display: block;
            padding: 0.75rem 1rem;
            color: #333;
            text-decoration: none;
            border-radius: 5px;
            transition: all 0.3s ease;
        }

        .nav a:hover,
        .nav a.active {
            background: #96ceb4;
            color: white;
        }

        /* 子菜单样式 */
        .has-submenu {
            position: relative;
        }

        .has-submenu>a {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .has-submenu>a::after {
            content: '▼';
            font-size: 0.7rem;
            transition: transform 0.3s ease;
        }

        .has-submenu.active>a::after {
            transform: rotate(180deg);
        }

        .submenu {
            display: none;
            list-style: none;
            margin: 0.5rem 0 0 1.5rem;
            padding: 0;
        }

        .submenu li {
            margin-bottom: 0.3rem;
        }

        .submenu a {
            padding: 0.5rem 0.75rem;
            font-size: 0.9rem;
        }

        .has-submenu.active .submenu {
            display: block;
        }

        /* 内容区域样式 */
        .content {
            flex: 1;
            padding: 2rem;
            background: #f5f7fa;
            overflow-y: auto;
        }

        /* 响应式设计 */
        @media (max-width: 768px) {
            .main-content {
                flex-direction: column;
            }

            .sidebar {
                width: 100%;
                padding: 1rem;
            }

            .nav ul {
                display: flex;
                overflow-x: auto;
                gap: 0.5rem;
            }

            .nav li {
                white-space: nowrap;
            }

            .content {
                padding: 1rem;
            }

            .header {
                padding: 1rem;
            }

            .logo {
                font-size: 1.2rem;
            }
        }"""

# 侧边栏导航 ul 内部（与各业务页保持一致，运输管理后插入 6 条新导航）
def nav_html():
    lines = [
        '                        <li><a href="tms-index.html">首页</a></li>',
        '                        <li><a href="tms-monitor.html">系统监控</a></li>',
        '                        <li><a href="tms-user.html">用户管理</a></li>',
        '                        <li><a href="tms-exception.html">异常管理</a></li>',
        '                        <li><a href="tms-transport.html">运输管理</a></li>',
    ]
    lines.extend(NAV_NEW)
    lines += [
        '                        <li><a href="tms-operation.html">运营管理</a></li>',
        '                        <li><a href="tms-timing.html">时效管理</a></li>',
        '                        <li><a href="tms-scan.html">扫描管理</a></li>',
        '                        <li><a href="tms-loading.html">装卸管理</a></li>',
        '                        <li><a href="tms-sorting.html">分拣管理</a></li>',
        '                        <li><a href="tms-warehouse.html">仓储管理</a></li>',
        '                        <li><a href="tms-vehicle.html">车辆管理</a></li>',
        '                        <li><a href="tms-capacity.html">运力管理</a></li>',
        '                        <li><a href="tms-geofence.html">电子围栏</a></li>',
        '                        <li><a href="tms-service.html">客服管理</a></li>',
        '                        <li><a href="tms-claim.html">理赔管理</a></li>',
        '                        <li><a href="tms-finance.html">财务管理</a></li>',
        '                        <li><a href="tms-administration.html">行政管理</a></li>',
        '                        <li><a href="tms-material.html">物料管理</a></li>',
        '                        <li><a href="tms-evaluation.html">考核评级</a></li>',
        '                        <li><a href="tms-performance.html">绩效管理</a></li>',
        '                        <li><a href="tms-hr.html">人事管理</a></li>',
    ]
    return "\n".join(lines)


TEMPLATE = """<!DOCTYPE html>
<html lang="zh-CN">

<head>
    <meta charset="UTF-8">
    <meta name="robots" content="noindex, nofollow">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{title} - TMS运输管理系统</title>

    <style>
{css}
    </style>
    <link rel="stylesheet" href="tms-ui.css?{cache}">
</head>

<body>
    <!-- 主界面 -->
    <div id="main-container">
        <!-- 顶部导航 -->
        <header class="header">
            <div class="logo">TMS运输管理系统 - 运营</div>
            <div class="user-info">
                <span id="current-role"></span>
                <button id="logout-btn" class="btn btn-danger">退出登录</button>
            </div>
        </header>

        <!-- 内容区域 -->
        <main class="main-content">
            <!-- 侧边栏导航 -->
            <aside class="sidebar">
                <nav id="admin-nav" class="nav">
                    <h3>运营功能</h3>
                    <ul>
{nav}
                    </ul>
                </nav>
            </aside>

            <!-- 主内容 -->
            <section class="content"></section>
        </main>
    </div>

    <script src="common.js?{cache}"></script>
    <script src="tms-store.js?{cache}"></script>
    <script src="tms-ui.js?{cache}"></script>
    <script src="tms-pages.js?{cache}"></script>
    <script>
        document.addEventListener('DOMContentLoaded', function () {{
            if (checkLoginStatus('admin') === undefined) return;
            TmsUI.initShell();
            TmsPages.render('{id}', document.querySelector('.content'));
        }});
    </script>
</body>

</html>
"""


def generate_pages():
    nav = nav_html()
    for pid, title in PAGES:
        html = TEMPLATE.format(title=title, css=SHELL_CSS, nav=nav, cache=CACHE, id=pid)
        path = os.path.join(ROOT, "tms-%s.html" % pid)
        with open(path, "w", encoding="utf-8") as f:
            f.write(html)
        print("generated", os.path.basename(path))


def inject_nav():
    transport_re = re.compile(r'^(.*<li><a href="tms-transport\.html"(?: class="active")?>运输管理</a></li>.*)$', re.M)
    recv_re = re.compile(r'^(.*<li><a href="tms-receivable\.html">应收结算</a></li>.*)$', re.M)
    flow_re = re.compile(r'^(.*<li><a href="tms-workflow\.html">异常工单</a></li>.*)$', re.M)

    def insert_after(regex, content, block):
        def repl(m):
            line = m.group(1)
            indent = " " * (len(line) - len(line.lstrip()))
            return line + "\n" + "\n".join(indent + s.strip() for s in block)
        new_content, n = regex.subn(repl, content, count=1)
        return new_content, n

    for name in sorted(os.listdir(ROOT)):
        if not (name.startswith("tms-") and name.endswith(".html")):
            continue
        if name in SELF_PAGES:
            continue  # 新页面已含完整导航
        path = os.path.join(ROOT, name)
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
        actions = []

        if "tms-order.html" not in content:
            # 全量注入（含 10 条）到“运输管理”之后
            content, n = insert_after(transport_re, content, NAV_NEW)
            if n:
                actions.append("full")
        else:
            # 增量补齐：缺应付/复核 → 正在“应收结算”后补插
            if "tms-payable.html" not in content:
                content, n = insert_after(recv_re, content, NAV_E2)
                if n:
                    actions.append("E2:payable/audit")
            # 增量补齐：缺派送/代收 → 在“异常工单”后补插
            if "tms-delivery.html" not in content:
                content, n = insert_after(flow_re, content, NAV_F2)
                if n:
                    actions.append("F2:delivery/cod")

        if actions:
            with open(path, "w", encoding="utf-8") as f:
                f.write(content)
            print("injected (" + ", ".join(actions) + ")", name)
        else:
            print("skip", name)


if __name__ == "__main__":
    generate_pages()
    inject_nav()
    print("done")
