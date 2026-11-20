"""Copy the working copies into the public repo folder (data-visualizer), ready to commit (DECISIONS D17, stage 8).

The working copies stay where they are (this machine's research_wiki): visualizer/ (viewer, serve.py, docs, check) and
claude_work/ (datamgr/ framework, projects/). The repo gets one tidy layout:

    data-visualizer/
      README.md LICENSE .gitignore       owned by the repo (never overwritten here)
      RULES.md FORMAT.md DECISIONS.md CHANGELOG.md serve.py
      viewer/   tools/   tests/          from visualizer/
      datamgr/  projects/                from claude_work/

Usage:  python visualizer/tools/export_repo.py [REPO_DIR] [--viewer-from DIR]
  --viewer-from DIR   take viewer/ from DIR (e.g. a frozen release) instead of the working copy, so work in progress
                      is not exported
Then, in REPO_DIR: node tools/check.mjs  (must PASS), git add -A, git commit, git push.
Files the repo has that the working copies no longer have are removed (repo-owned files and .git excepted).
"""
import os, re, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
VIS = os.path.dirname(HERE)
WIKI = os.path.dirname(VIS)
CW = os.path.join(WIKI, "claude_work")
args = sys.argv[1:]
viewer_from = None
if "--viewer-from" in args:
    i = args.index("--viewer-from"); viewer_from = args[i + 1]; del args[i:i + 2]
REPO = os.path.abspath(args[0] if args else os.path.join(os.path.dirname(WIKI), "data-visualizer"))
OWNED = {"README.md", "LICENSE", ".gitignore", ".git", ".check-ok.json"}
SKIP = re.compile(r"(__pycache__|\.pyc$|^app\.js$|\.bak\d*$|\.orig$)")   # (viewer/app.js: a stray pre-v6 file on the server)

PLAN = [  # (source, destination in the repo)
    (viewer_from or os.path.join(VIS, "viewer"), "viewer"),
    (os.path.join(VIS, "tools"), "tools"),
    (os.path.join(VIS, "tests"), "tests"),
    (os.path.join(CW, "datamgr"), "datamgr"),
    (os.path.join(CW, "projects"), "projects"),
] + [(os.path.join(VIS, f), f) for f in ("RULES.md", "FORMAT.md", "DECISIONS.md", "CHANGELOG.md", "serve.py")]

def copy_tree(src, dst, wanted):
    for root, dirs, files in os.walk(src):
        dirs[:] = [d for d in dirs if not SKIP.search(d)]
        for f in files:
            if SKIP.search(f) and not (root != src and f == "app.js"):
                continue
            if root == src and f in ("serve.py", "app.js") and os.path.basename(dst) == "viewer":
                continue                                          # (a frozen release keeps serve.py and a stray app.js beside the viewer)
            s = os.path.join(root, f); rel = os.path.relpath(s, src); d = os.path.join(dst, rel)
            wanted.add(os.path.normpath(d))
            os.makedirs(os.path.dirname(d), exist_ok=True)
            shutil.copy2(s, d)

os.makedirs(REPO, exist_ok=True)
wanted = set()
for src, rel in PLAN:
    dst = os.path.join(REPO, rel)
    if os.path.isdir(src): copy_tree(src, dst, wanted)
    elif os.path.isfile(src):
        wanted.add(os.path.normpath(dst)); shutil.copy2(src, dst)
    else: sys.exit(f"missing: {src}")
# the check's file + the export script itself are tools; the stamp is per machine
removed = []
for root, dirs, files in os.walk(REPO):
    dirs[:] = [d for d in dirs if d != ".git"]
    for f in files:
        p = os.path.normpath(os.path.join(root, f)); rel = os.path.relpath(p, REPO)
        if rel.split(os.sep)[0] in OWNED: continue
        if p not in wanted: os.remove(p); removed.append(rel)
# the repo README's first line carries the version (the check compares it with index.html and CHANGELOG)
idx = open(os.path.join(REPO, "viewer", "index.html"), encoding="utf-8").read()
ver = re.search(r"visualizer v(\d+\.\d+\.\d+)", idx).group(1)
rp = os.path.join(REPO, "README.md")
if os.path.exists(rp):
    s = open(rp, encoding="utf-8", newline="").read()
    s = re.sub(r"^(# .*?\(v)[\d.]+(,)", lambda m: m.group(1) + ver + m.group(2), s, count=1)
    open(rp, "w", encoding="utf-8", newline="").write(s)
print(f"exported to {REPO}: {len(wanted)} files (viewer from {viewer_from or 'the working copy'}), version v{ver}; removed {len(removed)}")
for r in removed[:20]: print("  removed", r)
