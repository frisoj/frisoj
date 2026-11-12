import sys; sys.path.insert(0, '.')
from lib import *
IND = [e for e in ENS if 'combined' not in e]
# pooled thermalisation-cut shifts
def pooled(sets, key, frac):
    tot = 0; n = 0
    for e in sets:
        for c in I[e]['thermalisation_cuts']:
            if abs(c['discard_fraction']-frac) < 1e-9:
                sh = c['shift'][key]; exp = c['expected_sd_of_shift_in_sigma_full']
                tot += sh['shift_in_expected_sd']; n += 1
    return tot/math.sqrt(n), n
c0 = I['d4_b2.5_L20']['thermalisation_cuts'][0]
print('shift keys:', list(c0['shift'].keys())[:12], type(c0['shift']['plaq']), c0['expected_sd_of_shift_in_sigma_full'])
for label, sets in [('10 sets (rounds 1+2)', [e for e in IND if e != 'd4_b2.5_L20']), ('11 sets', IND)]:
    for key in ['glue.gevp.m1', 'plaq']:
        print(' ', label, key, [round(pooled(sets, key, f)[0], 2) for f in (0.1, 0.25)])
# bootstrap vs jackknife error ratios in the comparison rows; jackknife vs pipeline
rb, rj, n = [], [], 0
for e in ENS:
    for r in I[e]['comparison_with_pipeline']['rows']:
        n += 1
        if r.get('err_ratio_jack') is not None: rj.append(r['err_ratio_jack'])
        if r.get('err_ratio_boot') is not None: rb.append((r['err_ratio_boot'], e, r['quantity']))
print('rows:', n, ' rows rounds 1+2:', sum(len(I[e]['comparison_with_pipeline']['rows']) for e in ENS if e != 'd4_b2.5_L20'), ' jack ratio range', min(rj), max(rj))
print('boot ratio range all rows:', min(rb)[:3], max(rb)[:3])
sel = [x for x in rb if any(s in x[2] for s in ('(1)', '(2)', 't=1', 't=2'))]
print('boot ratio, t=1/2 quantities:', min(sel), max(sel))
print('max dev rounds1+2:', max(I[e]['comparison_with_pipeline']['max_abs_dev_sigma'] for e in ENS if e != 'd4_b2.5_L20'))
# single operator vs gevp at t=1
out = []
for e in ENS:
    g = I[e]['glueball']['variants']
    a = g['gevp']['meff'][1]; b = g['single']['meff'][1]
    out.append((100*(b['value']/a['value']-1), (b['value']-a['value'])/a['err_boot'], e))
print('single vs gevp t=1, % higher:', round(min(out)[0], 2), round(max(out)[0], 2), ' max in sigma(gevp err):', round(max(o[1] for o in out), 2), [(o[2], round(o[0], 2), round(o[1], 2)) for o in out if o[2]=='d4_b2.5_L20'])
# bootstrap vs jackknife for fixed-t ratios (O §3 "hoogstens ruim 5 %")
rr = []
for e in ENS:
    for t in ('t1', 't2'):
        r = I[e]['ratios']['m_over_sqrt_sigma']['gevp'][t]['nambu_goto']; rr.append((r['err_boot']/r['err_jack']-1, e, t))
print('ratio err boot/jack - 1: min', min(rr), 'max', max(rr))
# hot vs cold pulls [O §6]
hc = []
for e in IND:
    q = I[e]['hot_vs_cold']['q']
    for k in ('plaq', 'glue.gevp.m1', 'tor.gevp.m1', 'glue.gevp.m2', 'tor.gevp.m2'):
        if k in q and q[k].get('pull_boot') is not None: hc.append((q[k]['pull_boot'], e, k))
hc.sort(key=lambda x: -abs(x[0])); print('largest hot-cold pulls (boot):', [(round(a, 2), b, c) for a, b, c in hc[:6]], ' n comparisons', len(hc))
# stream consistency chi2 p min at pipeline binsize
ps = []
for e in IND:
    for k, v in I[e]['stream_consistency']['chi2'].items():
        ps.append((v['boot']['p'], e, k))
ps.sort(); print('smallest stream chi2 p:', [(round(a, 4), b, c) for a, b, c in ps[:4]])
print('702 streams plaq:', [(s['seed'], s['start'], fmt(s['q']['plaq']['value'], s['q']['plaq']['err_boot'], 6)) for s in I['d4_b2.4_L16']['stream_consistency']['per_stream']])
print('bins per stream b2.5:', {e: [s['n_bins'] for s in I[e]['stream_consistency']['per_stream']] for e in ('d4_b2.5_L16', 'd4_b2.5_L16x', 'd4_b2.5_L20')})
print('stream lengths b2.5:', {e: [s['n_meas'] for s in P[e]['streams']] for e in ('d4_b2.5_L16', 'd4_b2.5_L16x')}, ' dropped:', {e: (P[e]['n_meas_total']-P[e]['n_meas_used'], P[e]['n_meas_total'], round(100*(P[e]['n_meas_total']-P[e]['n_meas_used'])/P[e]['n_meas_total'], 2)) for e in ('d4_b2.5_L16', 'd4_b2.5_L16x', 'd4_b2.5_L16_combined', 'd4_b2.5_L20')})
print('err of err 1/sqrt(2(n-1)) for 52, 37, 100, 156 bins:', [round(100/math.sqrt(2*(n-1)), 1) for n in (52, 37, 100, 156)])
# cross-stream correlation spread
cs = []
for e in IND:
    for r in I[e]['cross_stream_correlation']:
        zs=[p_['z'] for p_ in r['pairs']]; cs.append((math.sqrt(sum(z*z for z in zs)/len(zs)), e, r['quantity'], r.get('binsize')))
print('cross-stream rms z per (ensemble, quantity): min', min(cs), 'max', max(cs))
# am/err range
ae = [(gl(e, 1)[0]/gl(e, 1)[1], e) for e in ENS]; print('am/err t1 range:', min(ae), max(ae))
# measurement interval nskip and smearing levels per D
print('nskip:', {e: P[e]['update']['nskip'] for e in IND}); print('levels:', {e: len(P[e]['smearing']['levels']) for e in IND}, 'ntherm:', set(s['ntherm'] for e in IND for s in P[e]['streams']), 'starts ok:', all((s['start'] == 'hot') == (s['seed'] % 2 == 1) for e in IND for s in P[e]['streams']))
print('m0->m1 jump %:', {e: round(100*(gmeff(e, 0)[0]/gl(e, 1)[0]-1), 1) for e in ENS}); print('err t2/t1:', {e: round(gl(e, 2)[1]/gl(e, 1)[1], 2) for e in ENS})
