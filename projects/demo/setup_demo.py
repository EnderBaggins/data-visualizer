"""Make the demo end to end: a synthetic run, registered and computed, ready for the viewer.

    python projects/demo/setup_demo.py            (from the repo root; then: python serve.py 8765 --project projects/demo)

1. make_demo_run.py writes demo_runs/vortex/ (40 outputs of a rotating, decaying vortex: vx, vy, rho on a y × x grid);
2. the data manager (this demo project's reader) registers it as the dataset "vortex";
3. it computes the demo's methods (|v| as a map, max |v| per output) and copies the raw field rho, into data/.
"""
import os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))                  # the repo (datamgr/ lives here)
RUN = os.path.join(ROOT, "demo_runs", "vortex")
env = dict(os.environ, DATAMGR_PROJECT=HERE, PYTHONIOENCODING="utf-8")

def dm(*args):
    print("$ python -m datamgr", " ".join(args))
    subprocess.run([sys.executable, "-m", "datamgr", *args], cwd=ROOT, env=env, check=True)

subprocess.run([sys.executable, os.path.join(HERE, "make_demo_run.py"), RUN, "40"], check=True)
dm("add-dataset", "vortex", RUN)
dm("cache", "speed", "speed_max", "rho", "--runs", "vortex")
print("\nDone. Start the viewer:  python serve.py 8765 --project projects/demo   then open http://localhost:8765/viewer/")
