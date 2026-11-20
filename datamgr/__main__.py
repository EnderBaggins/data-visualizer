"""python -m datamgr — the data manager from a terminal (and for the data manager page).

    python -m datamgr list                                   # saved methods
    python -m datamgr status [--json]                        # what is stored
    python -m datamgr check NAME RUN [--steps 50,100]        # a few outputs, no caching (no plot)
    python -m datamgr cache [NAME ...] [--preset P ...] --runs A [B ...] [--steps a:b:c] [--rewrite] [--job ID] [--workers auto|N]
    python -m datamgr drop NAME [NAME ...] --runs A [B ...] --yes   # delete stored quantities
    python -m datamgr scan PATH [--json]                     # runs at / under a folder
    python -m datamgr datasets [--json]                      # the registered datasets (the page's columns)
    python -m datamgr add-dataset NAME PATH [--kind simulation|derived] [--note TEXT] [--group GROUP]
    python -m datamgr dataset-group NAME [NAME ...] --to GROUP   # "" = no group (v8.24)
    python -m datamgr rename-dataset-group OLD NEW | move-dataset-group GROUP INDEX | suggest-groups [--json]
    python -m datamgr archive NAME [NAME ...] [--undo]          # archived: kept, left out of the visualizer's menus
    python -m datamgr preset NAME [QUANTITY ...] [--delete]     # a cache preset (no quantities: show it)
    python -m datamgr rename-dataset OLD NEW
    python -m datamgr remove-dataset NAME [--drop-data --yes]
    python -m datamgr group NAME [NAME ...] --to GROUP | rename-group OLD NEW | move-group GROUP INDEX
    python -m datamgr label NAME [TEXT]                      # the shown name (empty = the method's own)
    python -m datamgr fields RUN [--json]                    # raw fields in a dataset's dumps (can be copied)
    python -m datamgr prune RUN [RUN ...]                    # remove axes no stored quantity uses (not the grid's)
    python -m datamgr adopt [--runs A ...] [--names N ...] [--n 3] [--apply]   # old data -> its method, if it matches
    python -m datamgr source NAME                            # a method's code
    python -m datamgr yaxis NAME [NAME ...] --to GROUP       # draw them in another y-axis group ("" = the code's)
    python -m datamgr yunits GROUP [UNITS]                   # units of a y-axis group
    python -m datamgr push-label NAME                        # the page's shown name -> the method's code
    python -m datamgr sync-labels                            # names / groups / y-axis groups / units -> every manifest
    python -m datamgr card DATASET [--notes TEXT] [--tags a,b] [--about TEXT --page WIKIPAGE]
    python -m datamgr about [FILE]                           # cards: what each run is (the project's about file)
    python -m datamgr set-follow DATASET [NAME ...] [--stored | --off]   # compute new outputs automatically
    python -m datamgr follow [--job-prefix ID]               # do it now for every followed dataset (serve.py: every 5 min)
    python -m datamgr health [--datasets A ...]              # record NaN fractions of stored whole-run quantities
    python -m datamgr conf [--datasets A ...]                # every config number (the reader's metadata) into the manifests
    python -m datamgr retire AXIS [--datasets A ...] [--yes] # what retiring an axis takes; --yes does it
(--runs and --datasets are the same everywhere.)
"""
import argparse
import json
import sys

import datamgr as dm


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m datamgr", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list")
    st = sub.add_parser("status")
    st.add_argument("--json", action="store_true")
    st.add_argument("--runs", "--datasets", dest="runs", nargs="*")
    ck = sub.add_parser("check")
    ck.add_argument("name")
    ck.add_argument("run")
    ck.add_argument("--steps", help="comma-separated steps (default: 3 spread over the run)")
    ca = sub.add_parser("cache")
    ca.add_argument("names", nargs="*")
    ca.add_argument("--preset", "--folder", dest="presets", nargs="+", default=[],
                    help="cache presets (folders): their quantities are added, each once")
    ca.add_argument("--runs", "--datasets", dest="runs", nargs="+", required=True)
    ca.add_argument("--steps", help="a:b:c over step numbers (default: all)")
    ca.add_argument("--rewrite", action="store_true")
    ca.add_argument("--job", help="progress file id (the data manager page)")
    ca.add_argument("--workers", default="auto", help="processes computing the outputs: auto (half the server's free capacity, at most 8), a number, or 0 = all in this one")
    dr = sub.add_parser("drop")
    dr.add_argument("names", nargs="+")
    dr.add_argument("--runs", "--datasets", dest="runs", nargs="+", required=True)
    dr.add_argument("--yes", action="store_true", help="really delete it from the visualizer store")
    sc = sub.add_parser("scan")
    sc.add_argument("path")
    sc.add_argument("--json", action="store_true")
    dl = sub.add_parser("datasets")
    dl.add_argument("--json", action="store_true")
    ad = sub.add_parser("add-dataset")
    ad.add_argument("name")
    ad.add_argument("path", nargs="?")
    ad.add_argument("--kind", default="simulation", choices=["simulation", "derived"])
    ad.add_argument("--note", default="")
    ad.add_argument("--group", default="")
    dg = sub.add_parser("dataset-group")
    dg.add_argument("names", nargs="+")
    dg.add_argument("--to", required=True)
    rdg = sub.add_parser("rename-dataset-group")
    rdg.add_argument("old")
    rdg.add_argument("new")
    mdg = sub.add_parser("move-dataset-group")
    mdg.add_argument("group")
    mdg.add_argument("index", type=int)
    sg = sub.add_parser("suggest-groups")
    sg.add_argument("--json", action="store_true")
    ar = sub.add_parser("archive")
    ar.add_argument("names", nargs="+")
    ar.add_argument("--undo", action="store_true")
    ps = sub.add_parser("preset")
    ps.add_argument("name")
    ps.add_argument("names", nargs="*")
    ps.add_argument("--delete", action="store_true")
    rn = sub.add_parser("rename-dataset")
    rn.add_argument("old")
    rn.add_argument("new")
    rm = sub.add_parser("remove-dataset")
    rm.add_argument("name")
    rm.add_argument("--drop-data", action="store_true")
    rm.add_argument("--yes", action="store_true")
    gr = sub.add_parser("group")
    gr.add_argument("names", nargs="+")
    gr.add_argument("--to", required=True)
    rg = sub.add_parser("rename-group")
    rg.add_argument("old")
    rg.add_argument("new")
    lb = sub.add_parser("label")
    lb.add_argument("name")
    lb.add_argument("text", nargs="?", default="")
    ad = sub.add_parser("adopt")
    ad.add_argument("--runs", "--datasets", dest="runs", nargs="*")
    ad.add_argument("--names", nargs="*")
    ad.add_argument("--n", type=int, default=3)
    ad.add_argument("--apply", action="store_true")
    pr = sub.add_parser("prune")
    pr.add_argument("runs", nargs="+")
    fl = sub.add_parser("fields")
    fl.add_argument("run")
    fl.add_argument("--json", action="store_true")
    mg = sub.add_parser("move-group")
    mg.add_argument("group")
    mg.add_argument("index", type=int)
    so = sub.add_parser("source")
    so.add_argument("name")
    ya = sub.add_parser("yaxis")
    ya.add_argument("names", nargs="+")
    ya.add_argument("--to", required=True)
    yu = sub.add_parser("yunits")
    yu.add_argument("group")
    yu.add_argument("units", nargs="?", default="")
    pl = sub.add_parser("push-label")
    pl.add_argument("name")
    sub.add_parser("sync-labels")
    cd = sub.add_parser("card")
    cd.add_argument("dataset")
    cd.add_argument("--notes")
    cd.add_argument("--tags")
    cd.add_argument("--about")
    cd.add_argument("--page")
    ab = sub.add_parser("about")
    ab.add_argument("file", nargs="?")
    sf = sub.add_parser("set-follow")
    sf.add_argument("dataset")
    sf.add_argument("names", nargs="*")
    sf.add_argument("--stored", action="store_true", help="everything stored for it")
    sf.add_argument("--off", action="store_true")
    fo = sub.add_parser("follow")
    fo.add_argument("--job-prefix")
    he = sub.add_parser("health")
    he.add_argument("--runs", "--datasets", dest="runs", nargs="*")
    co = sub.add_parser("conf")
    co.add_argument("--runs", "--datasets", dest="runs", nargs="*")
    rt = sub.add_parser("retire")
    rt.add_argument("axis")
    rt.add_argument("--runs", "--datasets", dest="runs", nargs="*")
    rt.add_argument("--yes", action="store_true")
    a = ap.parse_args(argv)

    if a.cmd == "list":
        for n, m in sorted(dm.METHODS.items()):
            print(f"{n:24s} {m.section:22s} {m.label}  {m.axis_names}")
        for f, e in dm.LOAD_ERRORS.items():
            print(f"⚠ {f}: {e}")
    elif a.cmd == "status":
        r = dm.status(runs=a.runs, as_json=a.json)
        if a.json:
            json.dump(r, sys.stdout, default=str)
        else:
            print(r.to_string() if hasattr(r, "to_string") else "")
    elif a.cmd == "check":
        steps = [int(s) for s in a.steps.split(",")] if a.steps else None
        r = dm.check(a.name, a.run, steps=steps, plot=False)
        return 0 if r["ok"] else 1
    elif a.cmd == "cache":
        from datamgr.groups import read as read_groups
        known = read_groups()["presets"]
        miss = [p for p in a.presets if p not in known]
        if miss:
            sys.exit(f"no preset {', '.join(miss)} (presets: {', '.join(sorted(known)) or 'none'})")
        names = list(dict.fromkeys([*a.names, *(q for p in a.presets for q in known[p])]))
        if not names:
            sys.exit("name quantities or --preset folders to cache")
        dm.cache(names, a.runs, steps=a.steps, rewrite=a.rewrite, job=a.job, workers=a.workers if a.workers == "auto" else int(a.workers))
    elif a.cmd == "drop":
        if not a.yes:
            print("drop deletes the stored data for good: add --yes")
            return 1
        for n in a.names:
            for r in a.runs:
                dm.drop(n, r, confirm=True)
    elif a.cmd == "scan":
        from datamgr.catalog import scan
        res = scan(a.path)
        if a.json:
            json.dump(res, sys.stdout)
        else:
            for x in res:
                print(f"{x['name']:30s} {x['outputs'] or 0:>5} outputs  {x['path']}" + (f"  (= {x['registered_as']})" if x["registered_as"] else ""))
    elif a.cmd == "datasets":
        reg = dm.datasets()
        if a.json:
            json.dump(reg, sys.stdout)
        else:
            for n, d in sorted(reg.items()):
                print(f"{n:30s} {d.get('kind'):10s} {d.get('path') or d.get('note', '')}")
    elif a.cmd == "add-dataset":
        from datamgr.catalog import add
        add(a.name, a.path, a.kind, a.note, group=a.group)
        print(f"added {a.name}" + (f" to group {a.group}" if a.group else ""))
    elif a.cmd == "dataset-group":
        from datamgr.catalog import set_dataset_group
        set_dataset_group(a.names, a.to)
        print(f"{', '.join(a.names)} -> " + (f"group {a.to}" if a.to.strip() else "no group"))
    elif a.cmd == "rename-dataset-group":
        from datamgr.catalog import rename_dataset_group
        rename_dataset_group(a.old, a.new)
        print(f"group {a.old} -> {a.new}")
    elif a.cmd == "move-dataset-group":
        from datamgr.catalog import move_dataset_group
        move_dataset_group(a.group, a.index)
        print(f"group {a.group} -> place {a.index}")
    elif a.cmd == "suggest-groups":
        from datamgr.catalog import suggest_groups
        sug = suggest_groups()
        if a.json:
            json.dump(sug, sys.stdout)
        else:
            for g, ns in sug.items():
                print(f"{g:20s} {', '.join(ns)}")
    elif a.cmd == "archive":
        from datamgr.catalog import set_archived
        set_archived(a.names, not a.undo)
        print(f"{', '.join(a.names)}: " + ("back from the archive" if a.undo else "archived"))
    elif a.cmd == "preset":
        from datamgr.groups import read as read_groups, set_preset
        if a.delete or a.names:
            set_preset(a.name, None if a.delete else a.names)
        print(f"preset {a.name}: " + (", ".join(read_groups()["presets"].get(a.name, [])) or "(none)"))
    elif a.cmd == "rename-dataset":
        from datamgr.catalog import rename
        rename(a.old, a.new)
        print(f"renamed {a.old} -> {a.new}")
    elif a.cmd == "remove-dataset":
        from datamgr.catalog import remove
        if a.drop_data and not a.yes:
            print("--drop-data deletes everything stored for it: add --yes")
            return 1
        remove(a.name, drop_data=a.drop_data)
        print(f"removed {a.name}")
    elif a.cmd == "yaxis":
        dm.set_yaxis(a.names, a.to)
        print(f"{', '.join(a.names)} -> y-axis group " + (a.to or "(the one in the code)"))
    elif a.cmd == "yunits":
        dm.set_yunits(a.group, a.units)
        print(f"{a.group}: units {a.units or '(none)'}")
    elif a.cmd == "push-label":
        print(f"{a.name}: label written to {dm.push_label(a.name)}")
    elif a.cmd == "sync-labels":
        print(f"{dm.sync_labels()} manifest entries updated")
    elif a.cmd == "card":
        d = dm.set_card(a.dataset, notes=a.notes, tags=a.tags, about=a.about, page=a.page)
        print(f"{a.dataset}: tags {', '.join(d.get('tags') or []) or '-'}; notes {len(d.get('notes') or '')} characters"
              + (f"; about: {d['about']}" if d.get("about") else ""))
    elif a.cmd == "about":
        from datamgr.catalog import set_about, ABOUT
        done, missing = set_about(a.file or ABOUT)
        print(f"{len(done)} dataset card(s) now say what the run is: {', '.join(done) or '-'}")
        if missing:
            print(f"not described in the file: {', '.join(missing)} (no run section in the wiki?)")
    elif a.cmd == "set-follow":
        names = None if a.off else "stored" if a.stored else (a.names or None)
        d = dm.set_follow(a.dataset, names)
        print(f"{a.dataset}: follow {d.get('follow') or 'off'}")
    elif a.cmd == "follow":
        dm.follow(job_prefix=a.job_prefix)
    elif a.cmd == "health":
        dm.health(runs=a.runs or None)
    elif a.cmd == "conf":
        dm.refresh_conf(runs=a.runs or None)
    elif a.cmd == "retire":
        dm.retire(a.axis, runs=a.runs or None, apply=a.yes)
    elif a.cmd == "group":
        dm.set_group(a.names, a.to)
        print(f"{', '.join(a.names)} -> {a.to}")
    elif a.cmd == "rename-group":
        dm.rename_group(a.old, a.new)
        print(f"group {a.old} -> {a.new}")
    elif a.cmd == "label":
        dm.set_label(a.name, a.text)
        print(f"{a.name} shown as {a.text or '(its own label)'}")
    elif a.cmd == "adopt":
        dm.adopt(runs=a.runs or None, names=a.names or None, n=a.n, apply=a.apply)
    elif a.cmd == "prune":
        import os
        from datamgr import config
        from datamgr.store import _atomic_write_json, dataset_lock, prune_coords, read_manifest
        for run in a.runs:
            with dataset_lock(run, wait=False):
                m = read_manifest(config.STORE, run)
                if not m:
                    print(f"{run}: not in the store"); continue
                gone = prune_coords(m)
                if gone:
                    _atomic_write_json(os.path.join(config.STORE, run, "manifest.json"), m)
            print(f"{run}: removed {', '.join(gone) if gone else 'nothing'}")
    elif a.cmd == "fields":
        from datamgr.catalog import fields
        res = fields(a.run)
        if a.json:
            json.dump(res, sys.stdout)
        else:
            print(" ".join(res))
    elif a.cmd == "move-group":
        from datamgr.groups import move_group
        move_group(a.group, a.index)
    elif a.cmd == "source":
        print(dm.method(a.name).source or "(no source)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
