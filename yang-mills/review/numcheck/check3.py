import sys; sys.path.insert(0, '.')
from lib import *
import numpy as np
from check2 import say, sig, pv
from ym.exact import a_lambda_two_loop as aL
print('\n##### beta_I fit with summary definition (beta_I a sqrt(sigma)/4 vs 1/beta_I)')
E3 = [(6,'d3_b6.0_L16'),(9,'d3_b9.0_L24_combined'),(12,'d3_b12.0_L32')]
bi = [b*P[e]['plaquette']['mean'] for b, e in E3]
i0, di0, sl, dsl, c = linfit([1/x for x in bi], [x*ss(e)[0]/4 for x, (b, e) in zip(bi, E3)], [x*ss(e)[1]/4 for x, (b, e) in zip(bi, E3)]); chk('lin 1/beta_I', '0.3352(20)', i0, di0); say('chi2', 5.6, c)
print('\n##### 1.4 / 3.5 two-loop formula')
for b, ref in [(2.2, 0.007597), (2.3, 0.005914), (2.4, 0.004600), (2.5, 0.003576)]:
    f = (6*math.pi**2*b/11)**(51/121)*math.exp(-3*math.pi**2*b/11)
    print(f'  beta {b}: formula {f:.6f}  ym.exact {aL(b):.6f}  THEORY table {ref}  P[D4] {P["d4_b2.5_L16"]["D4"]["a_lambda_two_loop"] if b==2.5 else ""}')
print('  THEORY table sqrt(sigma)/Lambda: ', [round(s/aL(b), 1) for b, s in [(2.2, .467), (2.3, .3687), (2.4, .2673), (2.5, .186)]], ' report 61,5 62,3 58,1 52,0 ; drop 2.3->2.5 %:', 100*(1-(.186/aL(2.5))/(.3687/aL(2.3))))
A3, A4, A5 = 'd4_b2.3_L10', 'd4_b2.4_L12', 'd4_b2.5_L16_combined'
sl_ = [(ss(e)[0]/aL(b), ss(e)[1]/aL(b)) for b, e in [(2.3, A3), (2.4, A4), (2.5, A5)]]
print('  sqrt(sigma)/Lambda R5:', [f'{v:.1f}({d:.1f})' for v, d in sl_], ' report 60.8(1.1), 56.9(2), 52.2(3)')
dr = sl_[2][0]/sl_[0][0]-1; ddr = (sl_[2][0]/sl_[0][0])*quad(sl_[2][1]/sl_[2][0], sl_[0][1]/sl_[0][0]); print(f'  drop {100*dr:.1f} +- {100*ddr:.1f} %  (report 14,1 ± 1,6)')
ml = [(gl(e)[0]/aL(b), gl(e)[1]/aL(b)) for b, e in [(2.3, A3), (2.4, A4), (2.5, A5)]]
print('  m/Lambda:', [f'{v:.1f}({d:.1f})' for v, d in ml], ' report 202.1(3.8), 215.8(3.2), 210.6(4.8)'); m, e, c = wavg([q[0] for q in ml], [q[1] for q in ml]); say('  m/Lambda const chi2', 7.7, c)
ra = ss(A3)[0]/ss(A5)[0]; dra = ra*quad(ss(A3)[1]/ss(A3)[0], ss(A5)[1]/ss(A5)[0]); chk('a ratio from sigma', '1.926(36)', ra, dra); two = aL(2.3)/aL(2.5); say('two-loop ratio', 1.654, two, 3)
rm = gl(A3)[0]/gl(A5)[0]; drm = rm*quad(gl(A3)[1]/gl(A3)[0], gl(A5)[1]/gl(A5)[0])
print(f'  a ratio from a*m: {rm:.3f}({drm:.3f}); log-rate m vs formula: {math.log(rm)/math.log(two):.3f} -> {100*(1-math.log(rm)/math.log(two)):.1f} % slower, {(rm-two)/drm:.2f} sigma (report: binnen 8 %, 1,4 sigma)')
print(f'  log-rate sigma vs formula: {math.log(ra)/math.log(two):.3f} -> {100*(math.log(ra)/math.log(two)-1):.1f} % faster, {(ra-two)/dra:.2f} sigma (report: 30 % sneller, 8 sigma)')
print('\n##### 4.4 beta=9')
a, b = 'd3_b9.0_L24', 'd3_b9.0_L24r'
f = P[a]['glueball']['fixed_t']['t1_minus_t2']; print('  round1 m1-m2:', fmt(-f['value'], f['err'], 4), round(-f['value']/f['err'], 2), '(report 0.0207(105), 2,0σ)')
say('  t1 diff sigma', 1.9, sig(*gl(a, 1), *gl(b, 1))); say('  t2 diff sigma', 2.9, sig(*gl(a, 2), *gl(b, 2)))
say('  ratio R5 diff sigma (4.8 item 9)', 2.7, sig(*ratio(a), *ratio(b)))
pa, pb = P[a]['plaquette'], P[b]['plaquette']; say('  plaquette diff sigma', -2.1, sig(pa['mean'], pa['err'], pb['mean'], pb['err']))
print('\n##### 4.5 finite volume table')
for lab, s, l, toks in [('D3 b6', 'd3_b6.0_L16', 'd3_b6.0_L24', ('0.0033(159)', 0.2, '0.0021(17)', -1.3)), ('D4 b2.4', 'd4_b2.4_L12', 'd4_b2.4_L16', ('0.0064(343)', 0.2, '0.0034(27)', -1.2)), ('D4 b2.5', 'd4_b2.5_L16_combined', 'd4_b2.5_L20', ('0.0268(211)', 1.3, '0.0014(15)', -0.9))]:
    d = gl(s, 1)[0]-gl(l, 1)[0]; dd = quad(gl(s, 1)[1], gl(l, 1)[1]); chk(lab+' dm', toks[0], d, dd); say(lab+' dm sigma', toks[1], d/dd)
    d2 = ss(s, 1)[0]-ss(l, 1)[0]; dd2 = quad(ss(s, 1)[1], ss(l, 1)[1]); chk(lab+' d sqrt(sigma)', toks[2], -d2, dd2); say(lab+' ds sigma', toks[3], d2/dd2)
    print(f'    rel. err of diff {100*dd/gl(s,1)[0]:.2f} % ; large is {100*(1-gl(l,1)[0]/gl(s,1)[0]):.2f} % lower; L ratio {P[l]["torelon"]["L"]/P[s]["torelon"]["L"]:.3f}; err ratio large/small: glue t1 {gl(l,1)[1]/gl(s,1)[1]:.2f} glue t2 {gl(l,2)[1]/gl(s,2)[1]:.2f} as t1 {ss(l,1)[1]/ss(s,1)[1]:.2f} tor t1 {tor(l,1)[1]/tor(s,1)[1]:.2f} ratio t1 {ratio(l,1)[1]/ratio(s,1)[1]:.2f}')
    Es, El = tor(s, 1), tor(l, 1); r = El[0]/Es[0]; dr = r*quad(El[1]/El[0], Es[1]/Es[0])
    # Nambu-Goto prediction from the small box: E(L) = sigma L sqrt(1 - pi (D-2)/(3 sigma L^2))
    D = P[s]['D']; Ls, Ll = P[s]['torelon']['L'], P[l]['torelon']['L']; sg = ss(s, 1)[0]**2
    Eng = lambda L: sg*L*math.sqrt(1-math.pi*(D-2)/(3*sg*L*L))
    print(f'    torelon ratio large/small {r:.3f}({dr:.3f}); NG prediction from small box {Eng(Ll)/Eng(Ls):.3f} (check E_small NG {Eng(Ls):.4f} vs {Es[0]:.4f}); pull {(r-Eng(Ll)/Eng(Ls))/dr:.2f}')
say('b2.4 sqrt(sigma) small-large Luscher', -1.45, sig(*ss('d4_b2.4_L12', 1, 'luscher'), *ss('d4_b2.4_L16', 1, 'luscher')), 2)
print('  NG-Luscher b2.4 L12 t1:', ss('d4_b2.4_L12', 1)[0]-ss('d4_b2.4_L12', 1, 'luscher')[0], ' max over ensembles:', max(ss(e, 1)[0]-ss(e, 1, 'luscher')[0] for e in ENS), max(ss(e)[0]-ss(e,None,'luscher')[0] for e in ENS if not P[e]['torelon']['upper_bound_only']))
print('  b2.3 sqrt(sigma) t1 vs t2 rel diff %:', 100*(ss('d4_b2.3_L10', 1)[0]/ss('d4_b2.3_L10', 2)[0]-1))
print('\n##### 4.5 round 3')
p = P['d4_b2.5_L20']
print('  n_meas', p['n_meas_total'], 'used', p['n_meas_used'], 'bins', p['n_bins'], 'binsize', p['binsize'], 'tau_max', p['tau_int_max'], 'per stream', [s['n_meas'] for s in p['streams']], 'seeds', [s['seed'] for s in p['streams']], [s['start'] for s in p['streams']], 'complete', [s['complete'] for s in p['streams']])
ref, new = 'd4_b2.5_L16_combined', 'd4_b2.5_L20'
for t, toks in [(1, ('0.7531(170)', '0.6024(136)', '0.7263(125)', '0.1238(185)', 6.7, '0.0268(211)', -1.3)), (2, ('0.7463(371)', '0.5970(297)', '0.7186(263)', '0.1216(397)', 3.1, '0.0277(455)', -0.6))]:
    r_, n_ = gl(ref, t), gl(new, t); pa_ = (r_[0]*0.8, r_[1]*0.8)
    chk(f't{t} ref', toks[0], *r_); chk(f't{t} predA', toks[1], *pa_); chk(f't{t} meas', toks[2], *n_)
    d = n_[0]-pa_[0]; dd = quad(n_[1], pa_[1]); chk(f't{t} meas-A', toks[3], d, dd); say(f't{t} meas-A sigma', toks[4], d/dd)
    d = n_[0]-r_[0]; dd = quad(n_[1], r_[1]); chk(f't{t} meas-16', toks[5], -d, dd); say(f't{t} meas-16 sigma', toks[6], d/dd)
    q = -math.log(n_[0]/r_[0])/math.log(20/16); dq = quad(n_[1]/n_[0], r_[1]/r_[0])/math.log(20/16); print(f'    exponent q t{t}: {q:.3f}({dq:.3f})  (report 0.16(13), 0.17(28))')
r_, n_ = gl('d4_b2.4_L12', 1), gl('d4_b2.4_L16', 1); q = -math.log(n_[0]/r_[0])/math.log(16/12); dq = quad(n_[1]/n_[0], r_[1]/r_[0])/math.log(16/12); print(f'    exponent q b2.4: {q:.3f}({dq:.3f}) (report 0.02(12))')
print('  script-rounded prediction 0.7531*16/20 =', 0.7531*16/20, ' unrounded', gl(ref,1)[0]*0.8, ' meas vs 0.6025(136):', (gl(new,1)[0]-0.6025)/quad(gl(new,1)[1], 0.0136))
print('  S round3:', json.dumps({k: v for k, v in S['round3'].items() if k not in ('largest_volume_set', 'note')})[:1500])
print('  string: 20^4 t1', fmt(*ss(new, 1), 4), 't2', fmt(*ss(new, 2), 4), 'R5 t*', tor(new)[2], '| 16^4 t1', fmt(*ss(ref, 1), 4), 't2', fmt(*ss(ref, 2), 4))
for t, tok, sg_ in [(1, '0.0014(15)', -0.9), (2, '0.0007(24)', -0.3)]:
    d = ss(ref, t)[0]-ss(new, t)[0]; dd = quad(ss(ref, t)[1], ss(new, t)[1]); chk(f'  ds t{t}', tok, -d, dd); say(f'  ds t{t} sigma', sg_, d/dd)
print('  torelon aE t1: 20^4', fmt(*tor(new, 1), 4), ' 16^4', fmt(*tor(ref, 1), 4), '(report 0.6522(76) vs 0.4873(65))')
print('  ratio: t1', fmt(*ratio(new, 1), 3), 'R5', fmt(*ratio(new), 3), 't2', fmt(*ratio(new, 2), 3), 'vs', fmt(*ratio(ref), 3))
print('  plaquette', fmt(p['plaquette']['mean'], p['plaquette']['err'], 6), 'vs 16^4c', fmt(P[ref]['plaquette']['mean'], P[ref]['plaquette']['err'], 6), 'hot-cold pull', p['stream_consistency']['hot_minus_cold']['pull'])
print('  max dev indep:', I[new]['comparison_with_pipeline']['max_abs_dev_sigma'], ' stream chi2 glue m1:', I[new]['stream_consistency']['chi2']['glue.gevp.m1'])
print('  therm cuts:', [(c['discard_fraction'], c['q'].get('glue.gevp.m1') if isinstance(c['q'], dict) else None) for c in I[new]['thermalisation_cuts']])
print('  flags:', json.dumps(I[new]['flags']))
print('  hot-cold indep:', {k: I[new]['hot_vs_cold']['q'][k] for k in ['plaq', 'glue.gevp.m1', 'tor.gevp.m1']})
