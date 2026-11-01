# -*- coding: utf-8 -*-
"""
页面外壳生成器（唯一入口，取代旧的 gen_pages.py + bump_cache.py 两个脚本）

页面清单不在这里重复维护：直接解析 js/core/rbac.js 的 ADMIN_MENU 与 PORTAL_MENU，
按「一个 HTML 只承载一个菜单页」的约定为每个条目落一个外壳。
菜单改了不必记得来改脚本，也不会出现「菜单里有、文件没有」或「文件在、菜单已删」的漂移。

用法：
    python tools/gen_pages.py                 # 按当前 token 生成缺失的外壳（已存在的只校验不重写）
    python tools/gen_pages.py --force         # 全量重写
    python tools/gen_pages.py --token v=20261101b   # 换缓存 token 并全量重写（等价旧的 bump_cache.py）
"""
import argparse
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RBAC = os.path.join(ROOT, "js", "core", "rbac.js")
DEFAULT_TOKEN = "v=20261101b"

ENTRY_RE = re.compile(r"\{\s*id:\s*'([^']+)'\s*,\s*file:\s*'([^']+)'\s*,\s*label:\s*'([^']+)'")

SHELL = u"""<!DOCTYPE html>
<html lang="zh-CN">

<head>
    <meta charset="UTF-8">
    <meta name="robots" content="noindex, nofollow">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{label} - 汇通物流 TMS</title>
    <link rel="stylesheet" href="css/app.css?{token}">
</head>

<body class="tms-body">
    <!-- 外壳由 js/ui/shell.js 依角色装配（侧栏 / 顶栏 / 内容区），这里只保留挂载点 -->
    <div id="tms-root" class="content"></div>
    <script src="js/boot.js?{token}"></script>
    <script>TMS.boot.start('{role}', '{page}');</script>
</body>

</html>
"""


def parse_menu(path):
    """菜单条目 → [(file, role, pageId, label)]；门户归属由文件名前缀判定，与 cfg.roles 的 portal 一致"""
    with io.open(path, "r", encoding="utf-8") as f:
        src = f.read()
    out, seen = [], {}
    for page_id, file_name, label in ENTRY_RE.findall(src):
        role = "admin" if file_name.startswith("tms-") else file_name.split("-")[0]
        if file_name in seen:
            # 同一文件挂多个 id 时只保留第一个作为落地页，其余靠 hash 深链进入
            continue
        seen[file_name] = True
        out.append((file_name, role, page_id, label))
    return out


def render(entry, token):
    file_name, role, page_id, label = entry
    return SHELL.format(label=label, token=token, role=role, page=page_id)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="全量重写外壳")
    ap.add_argument("--token", default=None, help="缓存 token，如 v=20261101b；给出即全量重写")
    args = ap.parse_args()

    token = args.token or DEFAULT_TOKEN
    force = args.force or bool(args.token)
    entries = parse_menu(RBAC)

    created, updated, ok = 0, 0, 0
    for entry in entries:
        file_name = entry[0]
        path = os.path.join(ROOT, file_name)
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
            with io.open(path, "w", encoding="utf-8") as f:
                f.write(body)
            created += 1

    # 清掉菜单里已经没有的旧外壳，避免留下点不到的死页面
    keep = set(e[0] for e in entries) | {"index.html"}
    removed = 0
    for name in sorted(os.listdir(ROOT)):
        if not name.endswith(".html") or name in keep:
            continue
        if name.startswith("tms-") or re.match(r"^(branch|sorter|transporter|deliveryman|client)-", name):
            os.remove(os.path.join(ROOT, name))
            removed += 1
            print("pruned %s（菜单中已无此页）" % name)

    print("菜单页 %d · 新建 %d · 重写 %d · 已最新 %d · 清理 %d · token=%s"
          % (len(entries), created, updated, ok, removed, token))
    return 0


if __name__ == "__main__":
    sys.exit(main())
