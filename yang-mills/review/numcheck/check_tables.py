import sys; sys.path.insert(0, '.')
from lib import *
R = f'{ROOT}/REPORT.md'
print('=== In het kort table')
for row in table_rows(R, '| dimensie | β | rooster | a·m (t = 1)'):
    D, beta, latt, m1, m2, r1, r5 = row
    key = (D, beta, latt)
    mp = {('3','6','16³'):'d3_b6.0_L16', ('3','6','24³'):'d3_b6.0_L24', ('3','9','24³, herhaling'):'d3_b9.0_L24r',
          ('3','9','24³, ronde 1'):'d3_b9.0_L24', ('3','12','32³'):'d3_b12.0_L32', ('4','2.3','12×10³'):'d4_b2.3_L10',
          ('4','2.4','16×12³'):'d4_b2.4_L12', ('4','2.4','16⁴'):'d4_b2.4_L16', ('4','2.5','16⁴, beide runs samen'):'d4_b2.5_L16_combined',
          ('4','2.5','20⁴ (ronde 3)'):'d4_b2.5_L20'}
    e = mp[key]
    assert P[e]['D'] == int(D) and abs(P[e]['beta']-float(beta)) < 1e-9, key
    chk(e+' m1', m1, *gl(e, 1)); chk(e+' m2', m2, *gl(e, 2)); chk(e+' r t1', r1, *ratio(e, 1))
    if 'geen meting' in r5: assert P[e]['ratios']['upper_bound_only'] or P[e]['torelon']['upper_bound_only'], e
    else: chk(e+' r R5', r5, *ratio(e))
def lattice_str(e):
    sh = P[e]['shape']
    sup = {2:'²',3:'³',4:'⁴'}
    if len(set(sh)) == 1: return f"{sh[0]}{sup[len(sh)]}"
    return f"{sh[0]}×{sh[1]}{sup[len(sh)-1]}"
ROUND = {'d3_b6.0_L16':'1','d3_b6.0_L24':'2','d3_b9.0_L24':'1','d3_b9.0_L24r':'2','d3_b9.0_L24_combined':'1+2','d3_b12.0_L32':'1',
 'd4_b2.3_L10':'1','d4_b2.4_L12':'1','d4_b2.4_L16':'2','d4_b2.5_L16':'1','d4_b2.5_L16x':'2','d4_b2.5_L16_combined':'1+2','d4_b2.5_L20':'3'}
print('=== Table 1')
rows = table_rows(R, '| ensemble | D | β | rooster | ronde | metingen | bins')
assert [r[0] for r in rows] == ENS, [r[0] for r in rows]
for r in rows:
    e = r[0]; p = P[e]
    exp = [str(p['D']), f"{p['beta']:g}", lattice_str(e), ROUND[e], str(p['n_meas_total']), str(p['n_bins'])]
    if r[1:7] != exp: print('MISMATCH T1 meta', e, r[1:7], exp)
    else: N_OK[0] += 6
    m, er, ts = gl(e); chk(e+' R5', r[7], m, er)
    if f'[{ts}]' not in r[7]: print('MISMATCH t*', e, r[7], ts)
    assert p['glueball']['plateau'] and not p['glueball']['upper_bound_only']
    chk(e+' m1', r[8], *gl(e, 1)); chk(e+' m2', r[9], *gl(e, 2))
print('=== Table 2')
rows = table_rows(R, '| ensemble | L | torelon a·E R5')
assert [r[0] for r in rows] == ENS
for r in rows:
    e = r[0]; p = P[e]
    if r[1] != str(p['torelon']['L']): print('MISMATCH L', e)
    if p['torelon']['upper_bound_only']:
        print('  no-plateau ensemble:', e, '| report cells:', r[2], '|', r[3], '|', r[6]); 
    else:
        m, er, ts = tor(e); chk(e+' tor R5', r[2], m, er)
        if f'[{ts}]' not in r[2]: print('MISMATCH tor t*', e, r[2], ts)
        chk(e+' as R5', r[3], *ss(e)); chk(e+' r R5', r[6], *ratio(e))
    chk(e+' as t1', r[4], *ss(e, 1)); chk(e+' as t2', r[5], *ss(e, 2))
    chk(e+' r t1', r[7], *ratio(e, 1)); chk(e+' r t2', r[8], *ratio(e, 2))
print('=== Table 3 (all at t=1; errors uncorrelated for the last two columns)')
rows = table_rows(R, '| ensemble | L√σ | a·m·L | correlatielengte')
for r in rows:
    e = r[0].split()[0]; p = P[e]; L = p['torelon']['L']
    a, da = ss(e, 1); m, dm = gl(e, 1); E, dE = tor(e, 1)
    chk(e+' L sqrt(sigma)', r[1], L*a, L*da); chk(e+' amL', r[2], L*m, L*dm)
    chk(e+' xi', r[3], 1/m, dm/m**2)
    x = 2*E/m; chk(e+' 2E/m', r[4], x, x*quad(dE/E, dm/m))
    light = 'torelon' if E < m else 'glueball'
    if r[5] != light: print('MISMATCH lightest', e, r[5], light, E, m)
    else: N_OK[0] += 1
    m0, dm0 = gmeff(e, 0); y = 100*(m0-m)/m; dy = 100*(m0/m)*quad(dm0/m0, dm/m)
    chk(e+' excit', r[6].replace(' %', ''), y, dy)
print('lightest-state count (torelon lighter) over 9 lattices:',
      sum(tor(e,1)[0] < gl(e,1)[0] for e in ['d3_b6.0_L16','d3_b6.0_L24','d3_b9.0_L24_combined','d3_b12.0_L32','d4_b2.3_L10','d4_b2.4_L12','d4_b2.4_L16','d4_b2.5_L16_combined','d4_b2.5_L20']))
print('xi range:', min(1/gl(e,1)[0] for e in ENS), max(1/gl(e,1)[0] for e in ENS))
print('d3_b6.0_L24 torelon t1,t2:', fmt(*tor('d3_b6.0_L24',1),4), fmt(*tor('d3_b6.0_L24',2),4), 'flag', P['d3_b6.0_L24']['torelon']['flag'])
print('d4_b2.3_L10 L sqrt(sigma) with R5:', fmt(10*ss('d4_b2.3_L10')[0], 10*ss('d4_b2.3_L10')[1], 2))
print('amL round1 b2.5:', 16*gl('d4_b2.5_L16',1)[0], 16*gl('d4_b2.5_L16',1)[1])
print('=== THEORY 7.3 table')
T = f'{ROOT}/THEORY.md'
rows = table_rows(T, '| ensemble | D | β | rooster | a·m R5 [t\\*] | a·m, t = 1')
assert [r[0].split()[0] for r in rows] == ENS
for r in rows:
    e = r[0].split()[0]; p = P[e]
    exp = [str(p['D']), f"{p['beta']:g}".replace('.', ','), lattice_str(e)]
    if r[1:4] != exp: print('MISMATCH TH meta', e, r[1:4], exp)
    m, er, ts = gl(e); chk('TH '+e+' R5', r[4], m, er)
    if f'[{ts}]' not in r[4]: print('MISMATCH t*', e)
    chk('TH '+e+' m1', r[5], *gl(e, 1)); chk('TH '+e+' m2', r[6], *gl(e, 2)); chk('TH '+e+' as t1', r[7], *ss(e, 1))
    if 'geen meting' in r[8]: assert p['torelon']['upper_bound_only']
    else: chk('TH '+e+' r R5', r[8], *ratio(e))
    chk('TH '+e+' r t1', r[9], *ratio(e, 1))
print('OK count', N_OK[0], ' mismatches', len(BAD))
print('total meas round1+2 (10 indep sets):', sum(P[e]['n_meas_total'] for e in ENS if 'combined' not in e and e != 'd4_b2.5_L20'),
      'round3', P['d4_b2.5_L20']['n_meas_total'], 'streams', sum(len(P[e]['streams']) for e in ENS if 'combined' not in e))
