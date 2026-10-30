import os
import re

ROOT = os.path.dirname(os.path.abspath(__file__))
OLD = "v=20261030b"
NEW = "v=20261030c"

changed = []
for name in sorted(os.listdir(ROOT)):
    if not (name.startswith("tms-") and name.endswith(".html")):
        continue
    p = os.path.join(ROOT, name)
    with open(p, "r", encoding="utf-8") as f:
        s = f.read()
    if OLD in s:
        s = s.replace(OLD, NEW)
        with open(p, "w", encoding="utf-8") as f:
            f.write(s)
        changed.append(name)

# 同步构建脚本里的 token
gp = os.path.join(ROOT, "gen_pages.py")
with open(gp, "r", encoding="utf-8") as f:
    g = f.read()
if OLD in g:
    g = g.replace(OLD, NEW)
    with open(gp, "w", encoding="utf-8") as f:
        f.write(g)
    changed.append("gen_pages.py")

print("updated", len(changed), "files ->", NEW)
for c in changed:
    print("  ", c)
