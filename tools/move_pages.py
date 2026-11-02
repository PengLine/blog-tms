# -*- coding: utf-8 -*-
"""一次性迁移：把根目录的 71 个页面外壳按角色拆进子目录，并同步 rbac 菜单里的 file 路径。

角色目录名与 cfg.roles 的 key 一致，页面文件名去掉角色前缀（tms-order.html → admin/order.html）。
脚本用完即弃，目录布局的唯一事实仍是 js/core/rbac.js 的菜单条目 + tools/gen_pages.py。
"""
import io
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR_OF = {"tms": "admin", "branch": "branch", "sorter": "sorter",
          "transporter": "transporter", "deliveryman": "deliveryman", "client": "client"}


def new_name(old):
    stem, ext = os.path.splitext(old)
    prefix, rest = stem.split("-", 1)
    return "%s/%s%s" % (DIR_OF[prefix], rest, ext)


def main():
    rbac = os.path.join(ROOT, "js", "core", "rbac.js")
    with io.open(rbac, "r", encoding="utf-8") as f:
        src = f.read()

    olds = re.findall(r"file:\s*'([^']+\.html)'", src)
    moved, renamed = [], {}
    for old in dict.fromkeys(olds):
        target = new_name(old)
        if old == target:
            continue
        renamed[old] = target
        src = src.replace("file: '%s'" % old, "file: '%s'" % target)
        moved.append((old, target))

    with io.open(rbac, "w", encoding="utf-8", newline="\n") as f:
        f.write(src)

    for old, target in moved:
        d = os.path.dirname(os.path.join(ROOT, target))
        if not os.path.isdir(d):
            os.makedirs(d)
        subprocess.check_call(["git", "mv", old, target], cwd=ROOT)

    print("菜单条目改写 %d · 文件迁移 %d" % (len(renamed), len(moved)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
