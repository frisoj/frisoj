#!/usr/bin/env python3
"""Read-only re-run of review/numcheck/check_tables.py and check3.py on the current tree (cwd = scratch),
and of summarize.build_summary (row 10). Compares with the stored outputs / results/summary.json."""
import sys, io, contextlib, runpy, json, os
sys.dont_write_bytecode = True
ROOT = "/home/user/frisoj/yang-mills"
sys.path.insert(0, ROOT); sys.path.insert(0, ROOT + "/review/numcheck")
for name in ("check_tables", "check3"):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        runpy.run_path(f"{ROOT}/review/numcheck/{name}.py", run_name="__main__")
    out = buf.getvalue()
    open(f"{name}_rerun.txt", "w").write(out)
    stored = open(f"{ROOT}/review/numcheck/out_final/{name}.txt").read()
    print(name, "re-run output identical to stored out_final file:", out == stored, "| MISMATCH lines:", out.count("MISMATCH"))
import summarize as S
fresh = json.loads(json.dumps(S.build_summary(os.path.join(ROOT, "results"), os.path.join(ROOT, "literature.json"))))
stored = json.load(open(os.path.join(ROOT, "results", "summary.json")))
diffkeys = [k for k in sorted(set(fresh) | set(stored)) if fresh.get(k) != stored.get(k)]
print("row 10: top-level keys of build_summary() that differ from results/summary.json:", diffkeys)
def leaves(o):
    if isinstance(o, dict): return sum(leaves(v) for v in o.values())
    if isinstance(o, list): return sum(leaves(v) for v in o)
    return 1
same = {k: v for k, v in stored.items() if k not in ("generated_utc", "figures")}
print("row 10: leaf values compared equal:", leaves(same), "| fresh has 'figures':", "figures" in fresh, "| stored figures:", stored.get("figures"))
