# -*- coding: utf-8 -*-
"""
页面外壳生成器（唯一入口，取代旧的 gen_pages.py + bump_cache.py 两个脚本）

页面清单不在这里重复维护：直接解析 js/core/rbac.js 的 ADMIN_MENU 与 PORTAL_MENU，
按「一个 HTML 只承载一个菜单页」的约定为每个条目落一个外壳。
菜单改了不必记得来改脚本，也不会出现「菜单里有、文件没有」或「文件在、菜单已删」的漂移。

菜单里的 file 形如 admin/order.html：第一段是角色目录，第二段是页面文件名。
外壳因此住在角色目录里，css/js 一律加 ../ 前缀；js/boot.js 会按自己的 src 反推出站点基准，
所以同一份模块清单在根目录的登录页和角色目录下的业务页都能正常加载。

用法：
    python tools/gen_pages.py                 # 按当前 token 生成缺失的外壳（已存在的只校验不重写）
    python tools/gen_pages.py --force         # 全量重写
    python tools/gen_pages.py --token v=20261101e   # 换缓存 token 并全量重写（等价旧的 bump_cache.py）
"""
import argparse
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RBAC = os.path.join(ROOT, "js", "core", "rbac.js")
DEFAULT_TOKEN = "v=20261103b"

ENTRY_RE = re.compile(r"\{\s*id:\s*'([^']+)'\s*,\s*file:\s*'([^']+)'\s*,\s*label:\s*'([^']+)'")
# 站点根下不是角色目录、不该出现业务页外壳的目录
NON_PAGE_DIRS = ("css", "js", "tools")

SHELL = u"""<!DOCTYPE html>
<html lang="zh-CN">

<head>
    <meta charset="UTF-8">
    <meta name="robots" content="noindex, nofollow">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{label} - 汇通物流 TMS</title>
    <link rel="stylesheet" href="{up}css/app.css?{token}">
</head>

<body class="tms-body">
    <!-- 外壳由 js/ui/shell.js 依角色装配（侧栏 / 顶栏 / 内容区），这里只保留挂载点 -->
    <div id="tms-root" class="content"></div>
    <script src="{up}js/boot.js?{token}"></script>
    <script>TMS.boot.start('{role}', '{page}');</script>
</body>

</html>
"""


def parse_menu(path):
    """菜单条目 → [(file, role, pageId, label)]；角色即文件所在目录，与 cfg.roles 的 dir 一致"""
    with io.open(path, "r", encoding="utf-8") as f:
        src = f.read()
    out, seen = [], {}
    for page_id, file_name, label in ENTRY_RE.findall(src):
        role = file_name.split("/")[0]
        if file_name in seen:
            # 同一文件挂多个 id 时只保留第一个作为落地页，其余靠 hash 深链进入
            continue
        seen[file_name] = True
        out.append((file_name, role, page_id, label))
    return out


def render(entry, token):
    file_name, role, page_id, label = entry
    up = "../" * file_name.count("/")
    return SHELL.format(label=label, token=token, role=role, page=page_id, up=up)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="全量重写外壳")
    ap.add_argument("--token", default=None, help="缓存 token，如 v=20261101e；给出即全量重写")
    args = ap.parse_args()

    token = args.token or DEFAULT_TOKEN
    force = args.force or bool(args.token)
    entries = parse_menu(RBAC)

    created, updated, ok = 0, 0, 0
    for entry in entries:
        file_name = entry[0]
        path = os.path.join(ROOT, file_name.replace("/", os.sep))
        body = render(entry, token)
        if os.path.exists(path):
            with io.open(path, "r", encoding="utf-8") as f:
                old = f.read()
            if old == body:
                ok += 1
                continue
            if not force:
                print("stale  %s（内容与菜单不一致，加 --force 重写）" % file_name)
                continue
            with io.open(path, "w", encoding="utf-8") as f:
                f.write(body)
            updated += 1
        else:
            d = os.path.dirname(path)
            if not os.path.isdir(d):
                os.makedirs(d)
            with io.open(path, "w", encoding="utf-8") as f:
                f.write(body)
            created += 1

    # 清掉菜单里已经没有的旧外壳，避免留下点不到的死页面
    keep = set(e[0] for e in entries)
    removed = 0
    for name in sorted(os.listdir(ROOT)):
        if not name.endswith(".html") or name == "index.html":
            continue
        # 登录入口常驻站点根；业务页一律住在角色目录，根下的历史遗留文件名仍按角色前缀识别
        if name.startswith("tms-") or re.match(r"^(branch|sorter|transporter|deliveryman|client)-", name):
            os.remove(os.path.join(ROOT, name))
            removed += 1
            print("pruned %s（业务页应位于角色目录下）" % name)
    for role_dir in sorted(os.listdir(ROOT)):
        full = os.path.join(ROOT, role_dir)
        if not os.path.isdir(full) or role_dir.startswith(".") or role_dir in NON_PAGE_DIRS:
            continue
        for name in sorted(os.listdir(full)):
            if not name.endswith(".html"):
                continue
            rel = "%s/%s" % (role_dir, name)
            if rel in keep:
                continue
            os.remove(os.path.join(full, name))
            removed += 1
            print("pruned %s（菜单中已无此页）" % rel)

    print("菜单页 %d · 新建 %d · 重写 %d · 已最新 %d · 清理 %d · token=%s"
          % (len(entries), created, updated, ok, removed, token))
    return 0


if __name__ == "__main__":
    sys.exit(main())
