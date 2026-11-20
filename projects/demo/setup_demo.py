"""Make the demo end to end: a synthetic run, registered and computed, ready for the viewer.

    python projects/demo/setup_demo.py            (from the repo root; then: python serve.py 8765 --project projects/demo)

1. make_demo_run.py writes demo_runs/vortex/ (100 outputs of a rotating, slowly decaying vortex: vx, vy, rho on a y × x grid);
2. the data manager (this demo project's reader) registers it as the dataset "vortex";
3. it computes the demo's methods (|v| as a map, max |v| per output) and copies the raw field rho, into data/.
"""
import os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))                  # the repo (datamgr/ lives here)
RUN = os.path.join(ROOT, "demo_runs", "vortex")
env = dict(os.environ, DATAMGR_PROJECT=HERE, PYTHONIOENCODING="utf-8")

def dm(*args, check=True):
    print("$ python -m datamgr", " ".join(args))
    subprocess.run([sys.executable, "-m", "datamgr", *args], cwd=ROOT, env=env, check=check)

subprocess.run([sys.executable, os.path.join(HERE, "make_demo_run.py"), RUN, "100"], check=True)
dm("add-dataset", "vortex", RUN, check=False)                  # (already registered on a second run: fine)
dm("cache", "speed", "speed_max", "rho", "--runs", "vortex", "--rewrite")
# 4. the demo desktop (the tools on this data): views/desktops/demo.json, opened from the header's "desktops…"
desk = os.path.join(HERE, "demo_desktop.json")
if os.path.exists(desk):
    import shutil
    os.makedirs(os.path.join(ROOT, "views", "desktops"), exist_ok=True)
    shutil.copy(desk, os.path.join(ROOT, "views", "desktops", "demo.json"))
    print("demo desktop -> views/desktops/demo.json (header: desktops… -> demo)")
print("\nDone. Start the viewer:  python serve.py 8765 --project projects/demo   then open http://localhost:8765/viewer/")
