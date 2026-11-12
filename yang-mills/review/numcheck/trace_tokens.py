import sys, glob, bisect; sys.path.insert(0, '.')
from lib import *
R = open(f'{ROOT}/REPORT.md', encoding='utf-8').read().split('\n')
srcs = {}
for pat in ['results/summary.md', 'results/independent/COMPARISON.md', 'results/logs/*.txt', 'review/*/*.txt', 'review/*/out/*.txt', 'run_round3_production.sh', 'README.md', 'round3_plan.md', 'review/README.md']:
    for f in glob.glob(f'{ROOT}/{pat}'):
        srcs[f.replace(ROOT+'/', '')] = open(f, encoding='utf-8', errors='replace').read()
# numeric pools per JSON file
pools = {}
def floats(o, acc):
    if isinstance(o, bool): return
    if isinstance(o, (int, float)): acc.append(float(o))
    elif isinstance(o, dict):
        for v in o.values(): floats(v, acc)
    elif isinstance(o, list):
        for v in o: floats(v, acc)
for name, coll in [('P', P), ('I', I)]:
    for e, d in coll.items():
        acc = []; floats(d, acc); pools[f'{name}:{e}'] = sorted(acc)
acc = []; floats(S, acc); pools['S'] = sorted(acc)
def inpool(arr, x, tol):
    i = bisect.bisect_left(arr, x-tol); return i < len(arr) and arr[i] <= x+tol
litvals = []
def walk(o):
    if isinstance(o, dict):
        if 'value' in o and o.get('uncertainty') not in (None, 'None'):
            try: litvals.append((float(o['value']), float(o['uncertainty'])))
            except Exception: pass
        for v in o.values(): walk(v)
    elif isinstance(o, list):
        for v in o: walk(v)
walk(LIT)
seen = {}
for n, line in enumerate(R, 1):
    for m in TOK.finditer(line):
        tok = m.group(0)
        if tok.startswith('-'): tok = tok[1:]
        seen.setdefault(tok, []).append(n)
unt = []
for tok, where in seen.items():
    val, err, dec = parse(tok)
    lit = any(abs(a-val) < 1e-9 and abs(b-err) < 1e-9 for a, b in litvals)
    files = [f for f, t in srcs.items() if tok in t]
    tol = 0.5*10**(-dec)*1.0000001
    pl = [k for k, arr in pools.items() if inpool(arr, val, tol) and inpool(arr, err, tol)]
    if not (lit or files or pl):
        unt.append((tok, where))
    seen[tok] = (where, lit, files, pl)
print('distinct tokens:', len(seen), ' untraced by literal/pool match:', len(unt))
for tok, where in unt: print('  UNTRACED', tok, 'lines', where)
only_pool = [(t, v[0], v[3][:3]) for t, v in seen.items() if not v[1] and not v[2] and v[3]]
print('pool-only (no literal string in any text source):', len(only_pool))
for t, w, p in only_pool: print('  ', t, w, p)
json.dump({t: {'lines': v[0], 'lit': v[1], 'files': v[2][:6], 'pool': v[3][:4]} for t, v in seen.items()}, open('token_trace.json', 'w'), indent=1)
