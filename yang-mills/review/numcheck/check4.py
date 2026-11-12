import sys; sys.path.insert(0, '.')
from lib import *
from check2 import sig
R = f'{ROOT}/REPORT.md'
lines = open(R, encoding='utf-8').read().split('\n')
def tables(header):
    out = []
    for i, l in enumerate(lines):
        if l.startswith(header):
            rows = []
            for m in lines[i+2:]:
                if not m.startswith('|'): break
                rows.append([c.strip() for c in m.strip().strip('|').split('|')])
            out.append(rows)
    return out
t4, t3 = tables('| grootheid | wij (t = 1 / t = 2) | literatuur | niveau | verschil |')
MAP = {'a·m, β = 2.3 (12×10³)': ('am', 'd4_b2.3_L10'), 'a·m, β = 2.4 (16×12³)': ('am', 'd4_b2.4_L12'), 'a·m, β = 2.4 (16⁴)': ('am', 'd4_b2.4_L16'),
       'a·m, β = 2.5 (16⁴, ronde 1)': ('am', 'd4_b2.5_L16'), 'a·m, β = 2.5 (16⁴, beide runs)': ('am', 'd4_b2.5_L16_combined'), 'a·m, β = 2.5 (20⁴, ronde 3)': ('am', 'd4_b2.5_L20'),
       'a√σ, β = 2.3': ('as', 'd4_b2.3_L10'), 'a√σ, β = 2.4 (16×12³)': ('as', 'd4_b2.4_L12'), 'a√σ, β = 2.4 (16⁴)': ('as', 'd4_b2.4_L16'),
       'a√σ, β = 2.5 (beide runs)': ('as', 'd4_b2.5_L16_combined'), 'a√σ, β = 2.5 (20⁴, ronde 3)': ('as', 'd4_b2.5_L20'),
       'a√σ, β = 6 (16³)': ('as', 'd3_b6.0_L16'), 'a√σ, β = 6 (24³)': ('as', 'd3_b6.0_L24'), 'a√σ, β = 9 (24³, beide runs)': ('as', 'd3_b9.0_L24_combined'),
       'a√σ, β = 12 (32³)': ('as', 'd3_b12.0_L32'), 'a·m, β = 6 (16³)': ('am', 'd3_b6.0_L16'), 'a·m, β = 9, herhaling': ('am', 'd3_b9.0_L24r'),
       'a·m, β = 9, ronde 1': ('am', 'd3_b9.0_L24'), 'a·m, β = 12 (32³)': ('am', 'd3_b12.0_L32')}
# all literature (value, err) pairs present in literature.json
litpairs = set()
def walk(o):
    if isinstance(o, dict):
        if 'value' in o and o.get('uncertainty') not in (None, 'None') and o.get('value') is not None:
            try: litpairs.add((float(o['value']), float(o['uncertainty']), o.get('verification_level')))
            except Exception: pass
        for v in o.values(): walk(v)
    elif isinstance(o, list):
        for v in o: walk(v)
walk(LIT)
cur = None; nbad = 0
for rows in (t4, t3):
    for r in rows:
        if r[0].startswith('plaquette'):
            for (b, e), ours_tok, lit_tok in zip([(2.3, 'd4_b2.3_L10'), (2.4, 'd4_b2.4_L12'), (2.5, 'd4_b2.5_L16_combined')], TOK.findall(r[1]), TOK.findall(r[2])):
                p = P[e]['plaquette']; chk('plaq '+e, f'{ours_tok[0]}({ours_tok[1]})', p['mean'], p['err'])
                lv, le, _ = parse(f'{lit_tok[0]}({lit_tok[1]})'); print('   plaq pull', e, round((p['mean']-lv)/quad(p['err'], le), 3), ' lit in json:', any(abs(a-lv) < 1e-9 and abs(b_-le) < 1e-9 for a, b_, _ in litpairs))
            continue
        if r[0] != 'idem': cur = MAP[r[0]]; ours = r[1]
        kind, e = cur
        f = gl if kind == 'am' else ss
        if r[0] != 'idem':
            a, b = [x.strip() for x in ours.split('/')]
            chk(e+' t1', a, *f(e, 1)); chk(e+' t2', b, *f(e, 2))
        lv, le, dec = parse(r[2])
        found = [lvl for a, b_, lvl in litpairs if abs(a-lv) < 1e-9 and abs(b_-le) < 1e-9]
        lvl_rep = r[3]
        lvl_ok = (('zoekfragment' in lvl_rep and 'search_excerpt' in found) or ('geheugen' in lvl_rep and 'none' in found))
        p1, p2 = sig(*f(e, 1), lv, le), sig(*f(e, 2), lv, le)
        rep = [float(x.replace('*', '').replace('−', '-').replace('+', '')) for x in r[4].split('/')]
        ok = abs(round(p1, 1)-rep[0]) < 0.05 and abs(round(p2, 1)-rep[1]) < 0.05
        bold = [('**' in x) for x in r[4].split('/')]
        boldok = (bold[0] == (abs(round(p1,1)) > 2.0)) and (bold[1] == (abs(round(p2,1)) > 2.0))
        if not (ok and lvl_ok and boldok and found):
            nbad += 1
            print(f'CHECK {r[0]} [{e}] lit {r[2][:22]} level {lvl_rep}: report {r[4]}  computed {p1:+.2f} / {p2:+.2f}  lit-found {found} bold_ok {boldok}')
        else: N_OK[0] += 2
print('literature rows flagged:', nbad, ' OK count', N_OK[0], ' mismatches', len(BAD))
# Luscher variants and other items in the list of tensions
print('b2.4 L12 Luscher vs 0.2673(15):', round(sig(*ss('d4_b2.4_L12', 1, 'luscher'), .2673, .0015), 2), ' with err 0.0011:', round((ss('d4_b2.4_L12',1)[0]-.2673)/quad(.0011, .0015), 2), fmt(ss('d4_b2.4_L12',1)[0], .0011, 4))
print('lit b2.5 values mutual: 0.660(22) vs 0.72(3):', round((0.72-0.66)/quad(.022, .03), 2), ' 0.660 vs 0.6857:', round((.6857-.66)/quad(.022, .0028), 2), ' 0.6857 vs 0.72:', round((.72-.6857)/quad(.03,.0028), 2))
# ratio of our masses to literature (THEORY 5.3: 5 to 14 %; ratios 1.046 to 1.141)
for e, refs in [('d4_b2.4_L12', [.936]), ('d4_b2.4_L16', [.936]), ('d4_b2.5_L16_combined', [.660, .6857, .72, .69]), ('d4_b2.5_L16', [.660, .6857, .72]), ('d4_b2.5_L20', [.660, .6857, .72, .69])]:
    print('  ratio ours/lit', e, [round(gl(e, 1)[0]/x, 3) for x in refs])
# derived ratios (item 7): our m/sqrt(sigma) vs literature-derived
def lit_ratio(m, dm, s, ds): return m/s, m/s*quad(dm/m, ds/s)
print('derived: b2.4 L12 R5 vs 0.936/0.2673:', round(sig(*ratio('d4_b2.4_L12'), *lit_ratio(.936, .023, .2673, .0015)), 2), '| vs 0.936/0.2660:', round(sig(*ratio('d4_b2.4_L12'), *lit_ratio(.936, .023, .2660, .0021)), 2))
for e in ['d4_b2.5_L16_combined', 'd4_b2.5_L16', 'd4_b2.5_L20']:
    print('derived: b2.5', e, 'R5 vs 0.660/0.1834:', round(sig(*ratio(e), *lit_ratio(.660, .022, .1834, .0026)), 2), ' t1:', round(sig(*ratio(e,1), *lit_ratio(.660, .022, .1834, .0026)), 2), '| vs 0.660/0.186(3):', round(sig(*ratio(e), *lit_ratio(.660, .022, .186, .003)), 2), '| vs .660/.1871:', round(sig(*ratio(e), *lit_ratio(.660, .022, .1871, .001)), 2))
print('derived: D3 b9 round1 R5 vs 0.765/0.1616:', round(sig(*ratio('d3_b9.0_L24'), *lit_ratio(.765, .010, .1616, .0006)), 2))
print('S derived_ratio_rows with |pull|>2:')
for row in S['literature_comparison']['derived_ratio_rows']:
    for k in ('R5', 't1', 't2'):
        v = row.get('pulls', {}).get(k) if isinstance(row.get('pulls'), dict) else None
    s_ = json.dumps(row)
    import re as _re
    if _re.search(r'"pull": -?(2\.[0-9]|[3-9])', s_): print('   ', s_[:420])
