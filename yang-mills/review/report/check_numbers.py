"""Scratch check: every value(error) token of the draft report must be traceable."""
import json, math, os, re, glob, sys
P = "/home/user/frisoj/yang-mills"
draft = open(sys.argv[1]).read()
tok = re.compile(r"(?<![\w.])(\d+\.\d+)\((\d+(?:\.\d+)?)\)")
tokens = sorted(set(m.group(0) for m in tok.finditer(draft)))
ok = set()
# 1. tokens that literally occur in project text files
for f in ["results/summary.md", "results/independent/COMPARISON.md"] + sorted(glob.glob(P + "/results/logs/*.txt")):
    t = open(f if f.startswith("/") else os.path.join(P, f)).read()
    ok |= set(m.group(0) for m in tok.finditer(t))
# 2. pairs from JSON files, formatted at several precisions
pairs = []
def walk(o):
    if isinstance(o, dict):
        num = {k: v for k, v in o.items() if isinstance(v, (int, float)) and not isinstance(v, bool)}
        for vk in num:
            for ek in num:
                if ek != vk and ("err" in ek or "unc" in ek) and num[ek] > 0:
                    pairs.append((num[vk], num[ek]))
        for v in o.values():
            walk(v)
    elif isinstance(o, list):
        for v in o:
            walk(v)
for f in sorted(glob.glob(P + "/results/*.json")) + sorted(glob.glob(P + "/results/independent/*.json")) + [P + "/literature.json"]:
    walk(json.load(open(f)))
def fmts(v, e):
    out = set()
    for dec in range(1, 8):
        ie = int(round(e * 10 ** dec))
        if 1 <= ie <= 9999:
            out.add("%.*f(%d)" % (dec, v, ie))
    return out
for v, e in pairs:
    ok |= fmts(v, e)
missing = [t for t in tokens if t not in ok]
print("tokens in draft:", len(tokens), " traced to project files:", len(tokens) - len(missing))
print("not literally traced (derived [A], tests [T], reviews [C1]/[C2], literature shorthand):")
for t in missing:
    ctx = draft[max(0, draft.find(t) - 70): draft.find(t) + len(t) + 30].replace("\n", " ")
    print("  %-14s ... %s" % (t, ctx))
