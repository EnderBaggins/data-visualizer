"""serve.py — serve the visualizer (viewer + data) and let the viewer's save buttons write views/.

    python serve.py [PORT] [--project projects/<name>] [--datamgr DIR]
    then open http://localhost:8765/viewer/   (on a remote machine: forward the port, e.g. ssh -L 8765:localhost:8765; Ctrl+C stops it)

Same as `python -m http.server`, plus a tiny API used by the viewer's save buttons:
    GET    /api/ping                    -> {"ok": true}
    GET    /api/views                   -> {"desktops": [...], "panels": [...]}  (name, mtime, refs)
    POST   /api/views/<kind>/<name>     body = JSON  -> writes views/<kind>/<name>.json
    DELETE /api/views/<kind>/<name>                  -> deletes views/<kind>/<name>.json
    GET    /api/cols?f=<run>/<q>/<step>.bin&n=<values per row>&c0=&c1=   -> columns c0..c1-1 of every row
    GET    /api/rows?f=<run>/<q>/{step}.bin&steps=a,b,..&n=&w=2|4&r=   -> row r of each step's file (v10.2)
    GET    /api/window?qf=&sf=&steps=&n=&w=&mode=s|norm|south&p=&m=      -> every line's points near p, each step (v11.0)
    POST   /api/movie/frame?job=<id>&i=<n>  body = PNG   -> movies/.frames/<id>/<n:05d>.png
    POST   /api/movie/finish            body = JSON {job, name, fps} -> ffmpeg -> movies/<name>.mp4
    POST   /api/movie/cancel            body = JSON {job}            -> drops the frames
    GET    /api/dm/status               -> the data manager's status (python -m datamgr status --json)
    GET    /api/dm/jobs                 -> cache jobs (progress files in datamgr_jobs/)
    POST   /api/dm/cache                body = JSON {names, runs, steps?, rewrite?}  -> starts a cache job  (token)
    POST   /api/dm/cancel               body = JSON {job}                            -> stops it           (token)
    POST   /api/dm/meta                 body = JSON {action: card | follow | yaxis | yunits | push-label | preset, ...} (token)
           v8.1: dataset cards (notes, tags), following running simulations, y-axis groups and their units, a shown
           name written into the method's code. Followed datasets are checked every FOLLOW_EVERY s (a job each).
    POST   /api/dm/drop                 body = JSON {names, runs}                    -> deletes stored data (token)
    POST   /api/dm/scan                 body = JSON {path}                           -> runs found there    (token)
    POST   /api/dm/datasets             body = JSON {action: add|rename|remove|group|rename-group|move-group|archive|suggest, ...} (token)
    POST   /api/dm/group                body = JSON {action: set|rename|move|label, ...} -> groups, names  (token)
    POST   /api/dm/fields               body = JSON {run}                            -> raw fields in its dumps (token)
Data manager (v6.0, 2026-10-07): the page viewer/datamgr.html. The package `datamgr` is found in
Aperture_plotting/ (or claude_work/, where it was built); jobs run as children of this server (Ctrl+C stops
them). The POSTs that compute or delete need the token this server prints at start (also in .serve_token,
readable only by you): other users of this machine can reach 127.0.0.1 too. v6.2: the token is kept in .serve_token
and reused at the next start, so a browser that has it once keeps working.
kind is "desktops", "panels", "templates" or "library" (v7.5: things shared by every desktop, e.g. library/analytics.json = the
analytic functions). Writes are confined to views/ and movies/ (names: letters, digits, - _ . space).
Movies (v5.18, 2026-10-06): the viewer draws each step like its PNG export and sends it here; ffmpeg makes the
mp4 the way Aperture_plotting's movies are made (libx264, yuv420p). Offered only if ffmpeg is on the PATH.
api/cols (v5.1, 2026-10-05) is read-only: the viewer downloads only the r band of a θ × r map that its zoom
shows (the port forward is the bottleneck: ~1 MB/s measured, against ~25 ms of browser work per step).
Optional: serve.py <port> (default 8765) [--datamgr DIR] [--project PATH] (the folder holding the datamgr package, and
its project; default: Aperture_plotting/ or claude_work/, and the project found there). Listens on 127.0.0.1 only.
"""
import http.server
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import time
import urllib.parse

ROOT = os.path.dirname(os.path.abspath(__file__))
VIEWS = os.path.join(ROOT, "views")
KINDS = ("desktops", "panels", "library", "templates")       # v8.1: templates (typed panels saved on purpose)
NAME = re.compile(r"^[\w.\- ]{1,80}$")
MAX_BODY = 5_000_000
DATA_FILE = re.compile(r"^[\w.\- ]+(/[\w.\- ]+)*\.bin$")
MOVIES = os.path.join(ROOT, "movies")
JOB = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
MAX_FRAME = 50_000_000
FFMPEG = shutil.which("ffmpeg")
# what this serve.py offers (the viewer checks before using it); "datamgr" is added at start if the package is found
FEATURES = ["views", "cols", "rows", "window", "library", "templates"] + (["movie"] if FFMPEG else [])   # v10.2 rows, v11.0 window


PERSONAL = os.path.dirname(ROOT)
DM_JOBS = os.path.join(ROOT, "datamgr_jobs")
DM_NAME = re.compile(r"^\w[\w.-]{0,80}$")
DM_STEPS = re.compile(r"^\d*:\d*(:\d+)?$")
TOKEN = secrets.token_urlsafe(18)                # set at start (load_token); the page sends it as X-Token


def load_token():
    """The token in .serve_token if it is there and readable only by you; else a new one, written there (0600)."""
    p = os.path.join(ROOT, ".serve_token")
    try:
        t = open(p).read().strip()
        if re.fullmatch(r"[\w-]{20,}", t) and not (os.stat(p).st_mode & 0o077):
            return t
    except OSError:
        pass
    t = secrets.token_urlsafe(18)
    fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(t + "\n")
    return t
_dm_procs = {}                                   # job id -> Popen (jobs this server started)


def dm_parent():
    """The folder holding the datamgr package: DATAMGR_PARENT (or --datamgr DIR) if set; else the plotting library
    first, then claude_work where it was built. The data manager's project (its reader and methods) is its own
    choice: DATAMGR_PROJECT (or --project PATH), else the one under <that folder>/projects/ (datamgr/config.py)."""
    if os.environ.get("DATAMGR_PARENT"):
        p = os.path.abspath(os.path.expanduser(os.environ["DATAMGR_PARENT"]))
        return p if os.path.isfile(os.path.join(p, "datamgr", "__init__.py")) else None
    # (v15.2: the repo layout first — datamgr/ next to serve.py; then the owner's server layout)
    for p in (ROOT, os.path.join(PERSONAL, "Aperture_plotting"), os.path.join(PERSONAL, "claude_work")):
        if os.path.isfile(os.path.join(p, "datamgr", "__init__.py")):
            return p
    return None


def dm_env():
    return dict(os.environ, DATAMGR_STORE=os.path.join(ROOT, "data"), DATAMGR_JOBS=DM_JOBS, PYTHONIOENCODING="utf-8")


def dm_run(args, timeout=300):
    return subprocess.run([sys.executable, "-m", "datamgr", *args], cwd=dm_parent(), env=dm_env(),
                          capture_output=True, text=True, timeout=timeout)


def _alive(pid):
    """Whether process `pid` still runs (signal 0 = only check). Not on Windows, where os.kill ends the process."""
    if os.name == "nt":
        return False
    try:
        os.kill(int(pid), 0)
        return True
    except (OSError, TypeError, ValueError):
        return False


FOLLOW_EVERY = 300                               # s between checks for new outputs of followed datasets (v8.1)
_follow_proc = None


def follow_loop():
    """Every FOLLOW_EVERY s: if a dataset follows (datasets.json) and no follow run is going, run `datamgr follow`
    (it starts a job only for datasets with new outputs; each shows on the page). Runs in a thread."""
    global _follow_proc
    import threading
    def tick():
        global _follow_proc
        while True:
            time.sleep(FOLLOW_EVERY)
            try:
                with open(os.path.join(ROOT, "data", "datasets.json")) as f:
                    if not any(d.get("follow") for d in json.load(f).get("datasets", {}).values()):
                        continue
            except (OSError, ValueError):
                continue
            if _follow_proc is not None and _follow_proc.poll() is None:
                continue
            prefix = "j" + time.strftime("%Y%m%d-%H%M%S") + "-follow"
            os.makedirs(DM_JOBS, exist_ok=True)
            log = open(os.path.join(DM_JOBS, prefix + ".log"), "w")
            _follow_proc = subprocess.Popen([sys.executable, "-m", "datamgr", "follow", "--job-prefix", prefix],
                                            cwd=dm_parent(), env=dm_env(), stdout=log, stderr=subprocess.STDOUT)
            log.close()
    threading.Thread(target=tick, daemon=True).start()


def dm_jobs():
    out = []
    if os.path.isdir(DM_JOBS):
        files = sorted((f for f in os.listdir(DM_JOBS) if f.endswith(".json")),
                       key=lambda f: os.path.getmtime(os.path.join(DM_JOBS, f)), reverse=True)[:30]
        for f in files:
            try:
                with open(os.path.join(DM_JOBS, f)) as fh:
                    j = json.load(fh)
            except (OSError, ValueError):
                continue
            p = _dm_procs.get(j.get("id"))
            if j.get("state") in ("running", "waiting") and (p is None or p.poll() is not None):
                if p is None and _alive(j.get("pid")) and time.time() - j.get("updated", 0) < 6 * 3600:
                    # started elsewhere (a notebook, the command line) and still at work (6 h: not a reused pid)
                    pass
                else:
                    j["state"] = "stopped" if p is None else ("done" if p.returncode == 0 else "failed")
            j.pop("trace", None)
            out.append(j)
    return out


def frames_dir(job):
    return os.path.join(MOVIES, ".frames", job) if JOB.match(job or "") else None


def clean_old_frames(max_age=86400):
    """Frames of movies that were never finished (a closed browser tab) go after a day."""
    d = os.path.join(MOVIES, ".frames")
    if not os.path.isdir(d):
        return
    for job in os.listdir(d):
        p = os.path.join(d, job)
        if os.path.isdir(p) and time.time() - os.path.getmtime(p) > max_age:
            shutil.rmtree(p, ignore_errors=True)


def make_movie(job, name, fps):
    """ffmpeg the frames of `job` into movies/<name>.mp4 (a free name: -2, -3 … if taken). -> (ok, file or error)"""
    d = frames_dir(job)
    if d is None or not os.path.isdir(d) or not os.listdir(d):
        return False, "no frames for this movie"
    base = re.sub(r"\s+", "_", name.strip()) or "movie"
    out, k = os.path.join(MOVIES, base + ".mp4"), 2
    while os.path.exists(out):
        out, k = os.path.join(MOVIES, f"{base}-{k}.mp4"), k + 1
    cmd = [FFMPEG, "-y", "-loglevel", "error", "-framerate", f"{fps:g}", "-i", os.path.join(d, "%05d.png"),
           "-c:v", "libx264", "-pix_fmt", "yuv420p", "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2:color=white",
           "-threads", "0", out]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
    except subprocess.TimeoutExpired:
        return False, "ffmpeg took longer than 30 min"
    if r.returncode != 0 or not os.path.exists(out):
        return False, "ffmpeg: " + (r.stderr.strip().splitlines() or ["failed"])[-1]
    shutil.rmtree(d, ignore_errors=True)
    return True, os.path.relpath(out, ROOT).replace(os.sep, "/")


def view_path(kind, name):
    if kind not in KINDS or not NAME.match(name) or name.startswith("."):
        return None
    return os.path.join(VIEWS, kind, name + ".json")


def list_views():
    out = {}
    for kind in KINDS:
        d = os.path.join(VIEWS, kind)
        items = []
        if os.path.isdir(d):
            for f in sorted(os.listdir(d)):
                if not f.endswith(".json"):
                    continue
                p = os.path.join(d, f)
                item = {"name": f[:-5], "mtime": os.path.getmtime(p)}
                if kind in ("desktops", "templates"):
                    try:
                        with open(p) as fh:
                            obj = json.load(fh)
                    except (OSError, ValueError):
                        obj = {}
                    if kind == "desktops":           # v8.1: panels inside the desktop; before, references to setup files
                        ps = obj.get("panels", [])
                        item["refs"] = [x.get("ref") for x in ps if x.get("ref")]
                        item["n"] = len(ps)
                    else:                            # what the template picker groups and searches by (no preview here)
                        item.update({k: obj.get(k) for k in ("type", "label", "tag")})
                items.append(item)
        out[kind] = items
    return out


class Handler(http.server.SimpleHTTPRequestHandler):
    # v5.2: HTTP/1.1 keep-alive. Each request used to open a new connection (= a new forwarded ssh channel
    # through the port forward, ~57 ms measured). Every response sends Content-Length; idle connections close
    # after `timeout` s; error replies sent before a request body is read close the connection.
    protocol_version = "HTTP/1.1"
    timeout = 60

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, fmt, *args):            # keep the terminal quiet except for API calls
        path, cmd = getattr(self, "path", ""), getattr(self, "command", "")   # absent on an idle-timeout
        if path.startswith("/api/") and cmd != "GET" and "/api/movie/frame" not in path:
            sys.stderr.write("%s %s\n" % (cmd, path))

    def end_headers(self):
        p = getattr(self, "path", "").split("?")[0]
        if p.endswith(".json") or "/api/" in p:
            self.send_header("Cache-Control", "no-store")
        elif p.endswith((".js", ".html", ".css", "/", ".bin")):
            # re-check after an upload (never a stale viewer) and after a re-recording (.bin series rewritten
            # while a run is watched); an unchanged file costs a 304
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def _local_json(self):
        """A save must come from the viewer: JSON body, Host is this machine (a plain web page can't send it)."""
        host = (self.headers.get("Host") or "").split(":")[0].strip("[]")
        ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        return host in ("localhost", "127.0.0.1", "::1") and ctype == "application/json"

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _target(self):
        parts = urllib.parse.unquote(urllib.parse.urlparse(self.path).path).split("/")
        # [..., 'api', 'views', kind, name]  (any prefix before /api/ is allowed, e.g. a proxy path)
        if len(parts) < 5 or parts[-4] != "api" or parts[-3] != "views":
            return None
        return view_path(parts[-2], parts[-1])

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path.endswith("/api/ping"):
            return self._json(200, {"ok": True, "time": time.time(), "features": FEATURES})
        if path.endswith("/api/cols"):
            return self._cols(urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query))
        if path.endswith("/api/rows"):
            return self._rows(urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query))
        if path.endswith("/api/window"):
            return self._window(urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query))
        if path.endswith("/api/views"):
            return self._json(200, list_views())
        if path.endswith("/api/dm/status"):
            if not dm_parent():
                return self._json(404, {"ok": False, "error": "the datamgr package was not found"})
            try:
                r = dm_run(["status", "--json"])
                return self._json(200, {"ok": True, **json.loads(r.stdout)}) if r.returncode == 0 else \
                    self._json(500, {"ok": False, "error": (r.stderr.strip().splitlines() or ["failed"])[-1]})
            except (subprocess.TimeoutExpired, ValueError) as e:
                return self._json(500, {"ok": False, "error": f"{type(e).__name__}: {e}"})
        if path.endswith("/api/dm/jobs"):
            return self._json(200, {"ok": True, "jobs": dm_jobs()})
        return super().do_GET()

    def _cols(self, q):
        """Columns c0..c1-1 of every row of a stored data file (rows of n values, w bytes each)."""
        try:
            f, n, c0, c1 = q["f"][0], int(q["n"][0]), int(q["c0"][0]), int(q["c1"][0])
            w = int(q.get("w", ["2"])[0])
        except (KeyError, ValueError):
            return self._json(400, {"ok": False, "error": "need f, n, c0, c1"})
        if not DATA_FILE.match(f) or ".." in f.split("/") or not 0 <= c0 < c1 <= n or w not in (2, 4):
            return self._json(400, {"ok": False, "error": "bad file or column range"})
        try:
            with open(self.translate_path("/data/" + urllib.parse.quote(f)), "rb") as fh:
                buf = fh.read()
        except OSError:
            return self._json(404, {"ok": False, "error": "no such data file"})
        row = n * w
        if not buf or len(buf) % row:
            return self._json(400, {"ok": False, "error": "row length does not match the file"})
        mv = memoryview(buf)
        body = b"".join(mv[r + c0 * w:r + c1 * w] for r in range(0, len(buf), row))
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _rows(self, q):
        """v10.2 (human 2026-11-10: an along-line map "where the first draw doesn't take forever"): row r of a per-step
        file at every listed step, in one response — one field line at every output, read by seeking to that row, not
        every output's whole file (≈ 2.5 MB for 201 outputs instead of ≈ 260 MB). f = the file with {step} for the
        5-digit step, steps = comma list, n = values per row, w = bytes per value (2 | 4), r = the row. A missing or
        short file gives a row of NaN."""
        try:
            f, n, r = q["f"][0], int(q["n"][0]), int(q["r"][0])
            w = int(q.get("w", ["2"])[0])
            steps = [int(x) for x in q["steps"][0].split(",") if x.strip()]
        except (KeyError, ValueError):
            return self._json(400, {"ok": False, "error": "need f, steps, n, r"})
        if "{step}" not in f or w not in (2, 4) or not 0 < n <= 1_000_000 or r < 0 or not 0 < len(steps) <= 10_000:
            return self._json(400, {"ok": False, "error": "bad pattern, sizes or steps"})
        row = n * w
        nan = (b"\x00\x7e" if w == 2 else b"\x00\x00\xc0\x7f") * n      # float16 / float32 NaN, little-endian
        parts = []
        for st in steps:
            name = f.replace("{step}", f"{st:05d}")
            if not DATA_FILE.match(name) or ".." in name.split("/"):
                return self._json(400, {"ok": False, "error": "bad file"})
            try:
                with open(self.translate_path("/data/" + urllib.parse.quote(name)), "rb") as fh:
                    fh.seek(r * row)
                    b = fh.read(row)
            except OSError:
                b = b""
            parts.append(b if len(b) == row else nan)
        body = b"".join(parts)
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _window(self, q):
        """v11.0 (human 2026-11-10: linked slices, "just do it all as v11"): every field line's points within m of position
        p along it, at every listed step — the map of all lines over time at one position, without sending every
        output's whole files. qf / sf = the quantity's and its s's files with {step}; steps = comma list; n = points per
        line; w = the quantity's bytes per value (2: float16 codes, 4: float32); mode = s (from the north foot) | norm
        (s / the line's last s) | south (its last s - s). A line's points stop at its first missing s. Response (little-
        endian): int32 count[T*J], float32 L[T*J] (each line's length), then all points' s (float32), then all points'
        quantity (uint16 codes or float32), in (step, line) order. A missing step gives count 0."""
        try:
            qf, sf, n, w = q["qf"][0], q["sf"][0], int(q["n"][0]), int(q.get("w", ["2"])[0])
            mode, p, m = q["mode"][0], float(q["p"][0]), float(q["m"][0])
            steps = [int(x) for x in q["steps"][0].split(",") if x.strip()]
        except (KeyError, ValueError):
            return self._json(400, {"ok": False, "error": "need qf, sf, steps, n, mode, p, m"})
        if ("{step}" not in qf or "{step}" not in sf or w not in (2, 4) or mode not in ("s", "norm", "south")
                or not 0 < n <= 1_000_000 or not 0 < len(steps) <= 10_000 or not m >= 0 or p != p):
            return self._json(400, {"ok": False, "error": "bad pattern, mode or sizes"})
        try:
            import numpy as np
        except ImportError:
            return self._json(501, {"ok": False, "error": "numpy is needed for api/window"})

        def files(st):
            names = [x.replace("{step}", f"{st:05d}") for x in (sf, qf)]
            if any(not DATA_FILE.match(x) or ".." in x.split("/") for x in names):
                raise ValueError("bad file")
            return [self.translate_path("/data/" + urllib.parse.quote(x)) for x in names]

        def read(st):
            try:
                fs, fq = files(st)
                S = np.fromfile(fs, dtype="<f4")
                Q = np.fromfile(fq, dtype="<u2" if w == 2 else "<f4")
            except OSError:
                return None
            if not S.size or S.size % n or Q.size != S.size:
                return None
            return S.reshape(-1, n), Q.reshape(-1, n)

        try:
            first = next((r for r in (read(st) for st in steps) if r is not None), None)
        except ValueError:
            return self._json(400, {"ok": False, "error": "bad file"})
        if first is None:
            return self._json(404, {"ok": False, "error": "no data files"})
        J = first[0].shape[0]
        counts, lens, ss, qs = [], [], [], []
        k = np.arange(n)[None, :]
        with np.errstate(invalid="ignore", divide="ignore"):
            for st in steps:
                r = read(st)
                if r is None or r[0].shape[0] != J:
                    counts.append(np.zeros(J, dtype="<i4")); lens.append(np.full(J, np.nan, dtype="<f4"))
                    continue
                S, Q = r
                fin = np.isfinite(S)
                mc = np.where(fin.all(axis=1), n, fin.argmin(axis=1))      # points up to the first missing s
                L = np.full(J, np.nan, dtype="<f4")
                ok = mc >= 2
                L[ok] = S[np.nonzero(ok)[0], mc[ok] - 1]
                pos = S if mode == "s" else S / L[:, None] if mode == "norm" else L[:, None] - S
                keep = (k < mc[:, None]) & (np.abs(pos - p) <= m)
                c = np.zeros(J, dtype="<i4")
                for j in range(J):
                    idx = np.flatnonzero(keep[j])
                    c[j] = idx.size
                    if idx.size:
                        ss.append(S[j, idx]); qs.append(Q[j, idx])
                counts.append(c); lens.append(L)
        body = (np.concatenate(counts).astype("<i4").tobytes() + np.concatenate(lens).astype("<f4").tobytes()
                + (np.concatenate(ss).astype("<f4").tobytes() if ss else b"")
                + (np.concatenate(qs).astype("<u2" if w == 2 else "<f4").tobytes() if qs else b""))
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _local(self, ctype_want):
        host = (self.headers.get("Host") or "").split(":")[0].strip("[]")
        ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        return host in ("localhost", "127.0.0.1", "::1") and ctype == ctype_want

    def _movie(self, what):
        """POST /api/movie/frame | finish | cancel (v5.18)."""
        n = int(self.headers.get("Content-Length", 0))
        if not FFMPEG:
            self.close_connection = True
            return self._json(400, {"ok": False, "error": "no ffmpeg on this machine"})
        if what == "frame":
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            job, i = (q.get("job") or [""])[0], (q.get("i") or [""])[0]
            d = frames_dir(job)
            if d is None or not i.isdigit() or int(i) > 99999 or n <= 0 or n > MAX_FRAME or not self._local("image/png"):
                self.close_connection = True
                return self._json(400, {"ok": False, "error": "bad movie frame (job, number, size or origin)"})
            body = self.rfile.read(n)
            if not body.startswith(b"\x89PNG"):
                return self._json(400, {"ok": False, "error": "a frame must be a PNG"})
            os.makedirs(d, exist_ok=True)
            with open(os.path.join(d, f"{int(i):05d}.png"), "wb") as f:
                f.write(body)
            return self._json(200, {"ok": True})
        if n <= 0 or n > 10_000 or not self._local("application/json"):
            self.close_connection = True
            return self._json(400, {"ok": False, "error": "bad request (size or origin)"})
        try:
            obj = json.loads(self.rfile.read(n))
        except ValueError:
            return self._json(400, {"ok": False, "error": "body is not JSON"})
        job = str(obj.get("job", ""))
        if frames_dir(job) is None:
            return self._json(400, {"ok": False, "error": "bad job id"})
        if what == "cancel":
            shutil.rmtree(frames_dir(job), ignore_errors=True)
            return self._json(200, {"ok": True})
        name, fps = str(obj.get("name") or "movie"), obj.get("fps", 8)
        if not NAME.match(name) or name.startswith(".") or not isinstance(fps, (int, float)) or not 0.1 <= fps <= 120:
            return self._json(400, {"ok": False, "error": "bad name or fps"})
        clean_old_frames()
        ok, res = make_movie(job, name, float(fps))
        return self._json(200 if ok else 500, {"ok": ok, "file": res} if ok else {"ok": False, "error": res})

    def _dm(self, what):
        """POST /api/dm/cache | cancel | drop (v6.0): local, JSON, and the token."""
        n = int(self.headers.get("Content-Length", 0))
        if n <= 0 or n > 20_000 or not self._local("application/json") or \
                not secrets.compare_digest(self.headers.get("X-Token", ""), TOKEN):
            self.close_connection = True
            return self._json(403, {"ok": False, "error": "needs the token serve.py printed at start (and a local JSON request)"})
        try:
            obj = json.loads(self.rfile.read(n))
        except ValueError:
            return self._json(400, {"ok": False, "error": "body is not JSON"})
        if not dm_parent():
            return self._json(404, {"ok": False, "error": "the datamgr package was not found"})
        if what == "cache":
            names, runs, steps = obj.get("names") or [], obj.get("runs") or [], obj.get("steps") or ""
            if not names or not runs or not all(isinstance(x, str) and DM_NAME.match(x) for x in names + runs) or \
                    (steps and not DM_STEPS.match(steps)):
                return self._json(400, {"ok": False, "error": "bad method / run names or steps"})
            job = "j" + time.strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(2)
            os.makedirs(DM_JOBS, exist_ok=True)
            args = [sys.executable, "-m", "datamgr", "cache", *names, "--runs", *runs, "--job", job]
            args += (["--steps", steps] if steps else []) + (["--rewrite"] if obj.get("rewrite") else [])
            log = open(os.path.join(DM_JOBS, job + ".log"), "w")
            _dm_procs[job] = subprocess.Popen(args, cwd=dm_parent(), env=dm_env(), stdout=log, stderr=subprocess.STDOUT)
            log.close()
            return self._json(200, {"ok": True, "job": job})
        if what == "cancel":
            p = _dm_procs.get(str(obj.get("job", "")))
            if p is None or p.poll() is not None:
                return self._json(404, {"ok": False, "error": "no running job of this server with that id"})
            p.terminate()
            return self._json(200, {"ok": True})
        def done(r):
            out = (r.stdout + r.stderr).strip()
            return self._json(200 if r.returncode == 0 else 500, {"ok": r.returncode == 0, "out": out[-800:],
                                                                   "error": None if r.returncode == 0 else (out.splitlines() or ["failed"])[-1]})
        names = lambda key: [str(x) for x in (obj.get(key) or [])]
        if what == "drop":
            ns, rs = names("names") or [str(obj.get("name", ""))], names("runs") or [str(obj.get("run", ""))]
            if not all(DM_NAME.match(x) for x in ns + rs):
                return self._json(400, {"ok": False, "error": "bad names or runs"})
            return done(dm_run(["drop", *ns, "--runs", *rs, "--yes"], timeout=300))
        if what == "meta":                              # v8.1: cards, follow, y-axis groups, units, label -> code
            act, nm = obj.get("action"), str(obj.get("name", ""))
            txt = lambda k, n: str(obj.get(k, "") or "")[:n].replace("\r", "")
            if act == "card" and DM_NAME.match(nm):
                tags = txt("tags", 400)
                if "\n" in tags:
                    return self._json(400, {"ok": False, "error": "tags: one line, comma-separated"})
                return done(dm_run(["card", nm, "--notes=" + txt("notes", 2000), "--tags=" + tags]))   # "=": text may start with -
            if act == "follow" and DM_NAME.match(nm):
                f = obj.get("names")
                if f is None:
                    return done(dm_run(["set-follow", nm, "--off"]))
                if f == "stored":
                    return done(dm_run(["set-follow", nm, "--stored"]))
                if isinstance(f, list) and f and all(isinstance(x, str) and DM_NAME.match(x) for x in f):
                    return done(dm_run(["set-follow", nm, *f]))
                return self._json(400, {"ok": False, "error": "names: a list, \"stored\" or null"})
            if act == "yaxis" and names("names") and all(DM_NAME.match(x) for x in names("names")):
                g = txt("group", 60).strip()
                if "\n" in g:
                    return self._json(400, {"ok": False, "error": "bad y-axis group"})
                return done(dm_run(["yaxis", *names("names"), "--to=" + g]))
            if act == "yunits":
                g, u = txt("group", 60).strip(), txt("units", 40).strip()
                if not g or "\n" in g + u:
                    return self._json(400, {"ok": False, "error": "bad y-axis group or units"})
                return done(dm_run(["yunits", "--", g, u]))
            if act == "push-label" and DM_NAME.match(nm):
                return done(dm_run(["push-label", nm]))
            if act == "preset":                         # v8.24: a cache preset (names: [] / null deletes it)
                p, ns = txt("preset", 40).strip(), names("names")
                if not p or "\n" in p or not all(DM_NAME.match(x) for x in ns):
                    return self._json(400, {"ok": False, "error": "bad preset name or quantities"})
                return done(dm_run(["preset", "--", p, *ns] if ns else ["preset", "--delete", "--", p]))
            return self._json(400, {"ok": False, "error": "bad meta request"})
        if what == "scan":
            path = str(obj.get("path", "")).strip()
            if not path.startswith("/") and not re.match(r"^[A-Za-z]:[\\/]", path) or len(path) > 500 or "\n" in path:
                return self._json(400, {"ok": False, "error": "give an absolute folder path"})
            r = dm_run(["scan", path, "--json"], timeout=60)
            if r.returncode != 0:
                return self._json(400, {"ok": False, "error": (r.stderr.strip().splitlines() or ["failed"])[-1]})
            return self._json(200, {"ok": True, "runs": json.loads(r.stdout)})
        if what == "fields":
            run = str(obj.get("run", ""))
            if not DM_NAME.match(run):
                return self._json(400, {"ok": False, "error": "bad dataset name"})
            r = dm_run(["fields", run, "--json"], timeout=60)
            if r.returncode != 0:
                return self._json(400, {"ok": False, "error": (r.stderr.strip().splitlines() or ["failed"])[-1]})
            return self._json(200, {"ok": True, "fields": json.loads(r.stdout)})
        if what == "datasets":
            act, nm = obj.get("action"), str(obj.get("name", ""))
            okg = lambda g: len(g) <= 40 and not any(c in g for c in "\n\r\t")
            group = str(obj.get("group", "") or "").strip()
            if act == "add":
                path, kind = str(obj.get("path", "")), str(obj.get("kind", "simulation"))
                if not DM_NAME.match(nm) or kind not in ("simulation", "derived") or len(path) > 500 or "\n" in path or not okg(group):
                    return self._json(400, {"ok": False, "error": "bad dataset name, kind, path or group"})
                return done(dm_run(["add-dataset", nm, path, "--kind", kind, "--group=" + group]))
            # v8.24 dataset groups and the archive (only how datasets are listed)
            ns = names("names")
            if act == "group":
                if not ns or not all(DM_NAME.match(x) for x in ns) or not okg(group):
                    return self._json(400, {"ok": False, "error": "bad dataset names or group"})
                return done(dm_run(["dataset-group", *ns, "--to=" + group]))
            if act == "rename-group":
                old, new = str(obj.get("old", "")).strip(), str(obj.get("new", "")).strip()
                if not old or not new or not okg(old) or not okg(new):
                    return self._json(400, {"ok": False, "error": "bad group names"})
                return done(dm_run(["rename-dataset-group", "--", old, new]))
            if act == "move-group":
                if not group or not okg(group) or not isinstance(obj.get("index"), int):
                    return self._json(400, {"ok": False, "error": "bad group or index"})
                return done(dm_run(["move-dataset-group", "--", group, str(obj["index"])]))
            if act == "archive":
                if not ns or not all(DM_NAME.match(x) for x in ns):
                    return self._json(400, {"ok": False, "error": "bad dataset names"})
                return done(dm_run(["archive", *ns] + ([] if obj.get("archived", True) else ["--undo"])))
            if act == "suggest":
                r = dm_run(["suggest-groups", "--json"], timeout=60)
                if r.returncode != 0:
                    return self._json(400, {"ok": False, "error": (r.stderr.strip().splitlines() or ["failed"])[-1]})
                return self._json(200, {"ok": True, "groups": json.loads(r.stdout)})
            if act == "rename":
                new = str(obj.get("new", ""))
                if not DM_NAME.match(nm) or not DM_NAME.match(new):
                    return self._json(400, {"ok": False, "error": "bad dataset names"})
                return done(dm_run(["rename-dataset", nm, new]))
            if act == "remove":
                if not DM_NAME.match(nm):
                    return self._json(400, {"ok": False, "error": "bad dataset name"})
                return done(dm_run(["remove-dataset", nm] + (["--drop-data", "--yes"] if obj.get("drop_data") else []), timeout=300))
            return self._json(400, {"ok": False, "error": "action: add, rename, remove, group, rename-group, move-group, archive or suggest"})
        # groups (only how things are listed: never touches data or versions)
        act = obj.get("action")
        grp = lambda key: str(obj.get(key, "")).strip()
        okg = lambda g: 0 < len(g) <= 40 and not any(c in g for c in "\n\r\t")
        if act == "set" and okg(grp("group")) and names("names") and all(DM_NAME.match(x) for x in names("names")):
            return done(dm_run(["group", *names("names"), "--to", grp("group")]))
        if act == "rename" and okg(grp("old")) and okg(grp("new")):
            return done(dm_run(["rename-group", grp("old"), grp("new")]))
        if act == "move" and okg(grp("group")) and isinstance(obj.get("index"), int):
            return done(dm_run(["move-group", grp("group"), str(obj["index"])]))
        if act == "label" and DM_NAME.match(str(obj.get("name", ""))) and len(grp("label")) <= 80 and "\n" not in grp("label"):
            return done(dm_run(["label", str(obj["name"]), grp("label")]))
        return self._json(400, {"ok": False, "error": "bad group request"})

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        for what in ("frame", "finish", "cancel"):
            if path.endswith("/api/movie/" + what):
                return self._movie(what)
        for what in ("cache", "cancel", "drop", "scan", "datasets", "group", "fields", "meta"):
            if path.endswith("/api/dm/" + what):
                return self._dm(what)
        target = self._target()
        n = int(self.headers.get("Content-Length", 0))
        if target is None or n <= 0 or n > MAX_BODY or not self._local_json():
            self.close_connection = True              # the unread body must not be parsed as the next request
            return self._json(400, {"ok": False, "error": "bad view path, size or origin"})
        try:
            obj = json.loads(self.rfile.read(n))
        except ValueError:
            return self._json(400, {"ok": False, "error": "body is not JSON"})
        os.makedirs(os.path.dirname(target), exist_ok=True)
        tmp = target + ".tmp"
        with open(tmp, "w") as f:
            json.dump(obj, f, indent=1)
        os.replace(tmp, target)
        return self._json(200, {"ok": True})

    def do_DELETE(self):
        target = self._target()
        host = (self.headers.get("Host") or "").split(":")[0].strip("[]")
        if host not in ("localhost", "127.0.0.1", "::1"):
            self.close_connection = True
            return self._json(403, {"ok": False, "error": "not from this machine"})
        if target is None or not os.path.exists(target):
            self.close_connection = True
            return self._json(404, {"ok": False, "error": "no such view"})
        os.remove(target)
        return self._json(200, {"ok": True})


def _options(argv):
    """serve.py [PORT] [--datamgr DIR] [--project PATH]: the port; where the datamgr package and its project are
    (set as DATAMGR_PARENT / DATAMGR_PROJECT, which the data manager's commands inherit)."""
    port, i = 8765, 0
    while i < len(argv):
        if argv[i] in ("--datamgr", "--project") and i + 1 < len(argv):
            os.environ["DATAMGR_PARENT" if argv[i] == "--datamgr" else "DATAMGR_PROJECT"] = os.path.abspath(argv[i + 1])
            i += 2
            continue
        port, i = int(argv[i]), i + 1
    return port


if __name__ == "__main__":
    port = _options(sys.argv[1:])
    try:
        server = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    except OSError:                      # e.g. started by a second VS Code window: the viewer is already up
        print(f"visualizer: http://localhost:{port}/viewer/   (port {port} is already in use — "
              f"the viewer is probably already running; nothing to do)", flush=True)
        sys.exit(0)
    print(f"visualizer: http://localhost:{port}/viewer/   (serving {ROOT}; Ctrl+C to stop)", flush=True)
    if dm_parent():
        FEATURES.append("datamgr")
        TOKEN = load_token()                         # the same token as last time: a browser that has it keeps working
        tok = os.path.join(ROOT, ".serve_token")
        print(f"data manager: http://localhost:{port}/viewer/datamgr.html#token={TOKEN}   "
              f"(datamgr from {dm_parent()}; the token is also in {tok})", flush=True)
        follow_loop()                                # followed datasets: new outputs computed every FOLLOW_EVERY s
    server.serve_forever()
