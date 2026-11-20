"""Write a small synthetic demo run (a rotating, slowly decaying vortex: ~3 turns in 100 outputs, so the period tool
has a cycle to find): python make_demo_run.py FOLDER [N_OUTPUTS]."""
import json
import os
import sys

import numpy as np

out = sys.argv[1]
n = int(sys.argv[2]) if len(sys.argv) > 2 else 100
os.makedirs(out, exist_ok=True)
x, y = np.linspace(-1, 1, 300), np.linspace(-1, 1, 240)
X, Y = np.meshgrid(x, y)                                  # arrays over (y, x)
dt = 0.1
for k in range(n):
    t = k * dt
    amp = np.exp(-t / 6.0)
    cx, cy = 0.4 * np.cos(2 * t), 0.4 * np.sin(2 * t)            # one turn every pi time units
    r2 = (X - cx) ** 2 + (Y - cy) ** 2
    g = amp * np.exp(-r2 / 0.08)
    np.savez(os.path.join(out, f"out.{k:05d}.npz"), vx=-(Y - cy) * g, vy=(X - cx) * g, rho=1 + g)
with open(os.path.join(out, "run.json"), "w") as f:
    json.dump({"dt": dt, "x": x.tolist(), "y": y.tolist(), "vortex_width": 0.2}, f)
print(f"{n} outputs -> {out}")
