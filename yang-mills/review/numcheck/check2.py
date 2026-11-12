import sys; sys.path.insert(0, '.')
from lib import *
import numpy as np
from scipy.stats import chi2 as chi2dist
def pv(c, dof): return float(chi2dist.sf(c, dof))
def sig(a, da, b, db): return (a-b)/quad(da, db)
def say(label, reported, computed, nd=1):
    flag = '' if abs(round(computed, nd) - reported) < 0.5*10**(-nd) + 1e-9 else '   <<<<<< MISMATCH'
    print(f'{label}: report {reported}  computed {computed:.{nd+2}f}{flag}')
print('##### 3.4 D=3')
a6, a12 = ss('d3_b6.0_L16', 1), ss('d3_b12.0_L32', 1)
say('lattice spacing factor b6/b12 (t1)', 2.12, a6[0]/a12[0], 2)
r5 = [ratio('d3_b6.0_L16'), ratio('d3_b9.0_L24'), ratio('d3_b12.0_L32')]
x5 = [ss('d3_b6.0_L16')[0]**2, ss('d3_b9.0_L24')[0]**2, ss('d3_b12.0_L32')[0]**2]
m, e, c = wavg([r[0] for r in r5], [r[1] for r in r5]); chk('R5 round1 constant', '4.773(26)', m, e); say('chi2', 11.7, c); say('p', 0.003, pv(c, 2), 3)
i0, di0, sl, dsl, c = linfit(x5, [r[0] for r in r5], [r[1] for r in r5]); say('R5 line chi2', 7.6, c); say('p', 0.006, pv(c, 1), 3)
rows = [('t1 repl', [('d3_b6.0_L16',1),('d3_b9.0_L24r',1),('d3_b12.0_L32',1)], '4.762(19)', 1.3, 1.6),
        ('t1 both', [('d3_b6.0_L16',1),('d3_b9.0_L24_combined',1),('d3_b12.0_L32',1)], '4.783(17)', 3.6, 2.5),
        ('t2 repl', [('d3_b6.0_L16',2),('d3_b9.0_L24r',2),('d3_b12.0_L32',2)], '4.755(43)', 0.6, 0.8),
        ('t2 both', [('d3_b6.0_L16',2),('d3_b9.0_L24_combined',2),('d3_b12.0_L32',2)], '4.816(38)', 0.9, 2.3),
        ('phys repl', [('d3_b6.0_L16',1),('d3_b9.0_L24r',2),('d3_b12.0_L32',2)], '4.742(26)', 0.7, 0.8),
        ('phys both', [('d3_b6.0_L16',1),('d3_b9.0_L24_combined',2),('d3_b12.0_L32',2)], '4.769(25)', 3.5, 1.6)]
consts = []
for lab, sel, tok, chi_rep, pull_rep in rows:
    v = [ratio(e, t) for e, t in sel]
    m, e, c = wavg([q[0] for q in v], [q[1] for q in v]); consts.append(m)
    chk(lab, tok, m, e); say(lab+' chi2', chi_rep, c); say(lab+' pull vs 4.716(21)', pull_rep, sig(m, e, 4.716, 0.021))
    vals = [q[0] for q in v]; spread = (max(vals)-min(vals))/np.mean(vals)*100
    imax, imin = int(np.argmax(vals)), int(np.argmin(vals))
    xs = [ss(en, t)[0]**2 for en, t in sel]
    i0, di0, sl, dsl, cl = linfit(xs, vals, [q[1] for q in v])
    print(f'   spread {spread:.2f} %  ({sig(vals[imax], v[imax][1], vals[imin], v[imin][1]):.2f} sigma); line: icpt {i0:.3f}({di0:.3f}) slope/err {sl/dsl:.2f} chi2 {cl:.2f}; percent above 4.716: {100*(m/4.716-1):.2f}')
print('range of constants', min(consts), max(consts))
# round-1-only t1 spread (THEORY: 2,6 %)
v = [ratio('d3_b6.0_L16',1), ratio('d3_b9.0_L24',1), ratio('d3_b12.0_L32',1)]; vals=[q[0] for q in v]
say('round-1 t1 spread %', 2.6, (max(vals)-min(vals))/np.mean(vals)*100)
print('sqrt(sigma)/g2 R5 all data:', [fmt(b*ss(e)[0]/4, b*ss(e)[1]/4, 4) for b, e in [(6,'d3_b6.0_L16'),(9,'d3_b9.0_L24_combined'),(12,'d3_b12.0_L32')]], ' report 0.3809(18), 0.3613(9), 0.3568(10)')
xs = [1/6, 1/9, 1/12]; ys = [b*ss(e)[0]/4 for b, e in [(6,'d3_b6.0_L16'),(9,'d3_b9.0_L24_combined'),(12,'d3_b12.0_L32')]]; es = [b*ss(e)[1]/4 for b, e in [(6,'d3_b6.0_L16'),(9,'d3_b9.0_L24_combined'),(12,'d3_b12.0_L32')]]
i0, di0, sl, dsl, c = linfit(xs, ys, es); chk('lin 1/beta', '0.3318(27)', i0, di0); say('chi2', 7.5, c)
A = np.vstack([np.ones(3), xs, np.square(xs)]).T; Ai = np.linalg.inv(A); p = Ai @ ys; dp = math.sqrt(sum((Ai[0, k]*es[k])**2 for k in range(3))); chk('parabola', '0.3643(122)', p[0], dp)
plq = [P[e]['plaquette']['mean'] for e in ['d3_b6.0_L16','d3_b9.0_L24_combined','d3_b12.0_L32']]
bi = [b*q for b, q in zip([6, 9, 12], plq)]; xi = [1/x for x in bi]; ysI = [x*ss(e)[0]/4 for x, e in zip(bi, ['d3_b6.0_L16','d3_b9.0_L24_combined','d3_b12.0_L32'])]; esI = [x*ss(e)[1]/4 for x, e in zip(bi, ['d3_b6.0_L16','d3_b9.0_L24_combined','d3_b12.0_L32'])]; i0, di0, sl, dsl, c = linfit(xi, ysI, esI)  # summarize.py definition: beta_I a sqrt(sigma)/4 against 1/beta_I; chk('lin 1/beta_I', '0.3352(20)', i0, di0); say('chi2', 5.6, c)
print('##### 3.5 D=4')
A3, A4, A5, A4b, A5b = 'd4_b2.3_L10', 'd4_b2.4_L12', 'd4_b2.5_L16_combined', 'd4_b2.4_L16', 'd4_b2.5_L20'
d = ratio(A5)[0]-ratio(A3)[0]; dd = quad(ratio(A5)[1], ratio(A3)[1]); chk('rise R5', '0.710(120)', d, dd); say('sigma', 5.9, d/dd)
v = [ratio(A3), ratio(A4), ratio(A5)]; m, e, c = wavg([q[0] for q in v], [q[1] for q in v]); say('const chi2 R5', 37.5, c)
xs = [ss(en)[0]**2 for en in (A3, A4, A5)]; i0, di0, sl, dsl, cl = linfit(xs, [q[0] for q in v], [q[1] for q in v]); print('   line icpt', fmt(i0, di0, 3), 'pull vs 3.78(7):', round(sig(i0, di0, 3.78, 0.07), 2), 'chi2', round(cl, 3))
lit = lambda m, dm, s, ds: (m/s, m/s*quad(dm/m, ds/s))
chk('lit ratio 2.3', '3.298(65)', *lit(1.216, .023, .3687, .0022)); chk('lit ratio 2.5', '3.599(130)', *lit(.660, .022, .1834, .0026))
print('   our rise / lit rise =', d/(lit(.660, .022, .1834, .0026)[0]-lit(1.216, .023, .3687, .0022)[0]))
say('b2.5 16^4 vs 3.78(7)', 2.3, sig(*ratio(A5), 3.78, 0.07)); say('b2.5 20^4 t1 vs 3.78(7)', 0.8, sig(*ratio(A5b, 1), 3.78, 0.07))
print('   t1 series:', [fmt(*ratio(e, 1), 3) for e in (A3, A4, A5)])
d = ratio(A5, 2)[0]-ratio(A3, 1)[0]; dd = quad(ratio(A5, 2)[1], ratio(A3, 1)[1]); chk('equal phys time', '0.776(199)', d, dd); say('sigma', 3.9, d/dd)
print('   2.4->2.5 step: R5/t1', round(sig(*ratio(A5), *ratio(A4)), 2), ' t1(indep)', round(sig(*ratio(A5, 1), *ratio(A4, 1)), 2), ' t2', round(sig(*ratio(A5, 2), *ratio(A4, 2)), 2), ' phys time (2.5 t2 vs 2.4 t1)', round(sig(*ratio(A5, 2), *ratio(A4, 1)), 2), ' round1-only R5', round(sig(*ratio('d4_b2.5_L16'), *ratio(A4)), 2), ' report: 2,1 tot 2,3')
print('   torelon b2.3 t=1,2,3:', [fmt(*tmeff(A3, t), 4) for t in (1, 2, 3)], ' report 1.2499(138), 1.1824(455), 1.0929(1292)')
aml = [(10*gl(A3, 1)[0], 10*gl(A3, 1)[1]), (12*gl(A4, 1)[0], 12*gl(A4, 1)[1]), (16*gl('d4_b2.5_L16', 1)[0], 16*gl('d4_b2.5_L16', 1)[1])]
print('   amL:', [fmt(*q, 3) for q in aml], ' report 11.951(223), 11.912(177), 11.871(345)'); m, e, c = wavg([q[0] for q in aml], [q[1] for q in aml]); say('amL const chi2', 0.04, c, 2)
print('   L sqrt(sigma) t1:', [round(L*ss(e, 1)[0], 3) for L, e in [(10, A3), (12, A4), (16, 'd4_b2.5_L16'), (16, A5), (16, A4b), (20, A5b)]])
pA4 = (gl(A4, 1)[0]*12/16, gl(A4, 1)[1]*12/16); chk('pred A b2.4', '0.7445(111)', *pA4); say('sigma b2.4', 7.4, sig(*gl(A4b, 1), *pA4))
pA5 = (gl(A5, 1)[0]*16/20, gl(A5, 1)[1]*16/20); chk('pred A b2.5', '0.6024(136)', *pA5); say('sigma b2.5', 6.7, sig(*gl(A5b, 1), *pA5))
pA3 = (gl('d3_b6.0_L16', 1)[0]*16/24, gl('d3_b6.0_L16', 1)[1]*16/24); chk('pred A d3 b6', '0.7972(51)', *pA3); say('sigma d3 b6', 26.7, sig(*gl('d3_b6.0_L24', 1), *pA3))
chk('amL b2.4 L16', '15.78(49)', 16*gl(A4b, 1)[0], 16*gl(A4b, 1)[1]); chk('amL b2.5 L20', '14.53(25)', 20*gl(A5b, 1)[0], 20*gl(A5b, 1)[1]); chk('amL b2.5 L16c', '12.05(27)', 16*gl(A5, 1)[0], 16*gl(A5, 1)[1])
big = [ratio(A3, 1), ratio(A4b, 1), ratio(A5b, 1)]; m, e, c = wavg([q[0] for q in big], [q[1] for q in big]); say('largest-volume const chi2 (jackknife corr. errors)', 47.1, c)
print('   summary.json largest_volume_set:', json.dumps(S['round3'].get('largest_volume_set'))[:600])
d = big[1][0]-big[0][0]; dd = quad(big[1][1], big[0][1]); chk('step 2.3->2.4', '0.476(140)', d, dd); say('sigma', 3.4, d/dd)
d = big[2][0]-big[1][0]; dd = quad(big[2][1], big[1][1]); chk('step 2.4->2.5', '0.146(144)', d, dd); say('sigma', 1.0, d/dd)
d = big[2][0]-big[0][0]; dd = quad(big[2][1], big[0][1]); print('   rise 2.3->2.5 largest volumes:', fmt(d, dd, 3), round(d/dd, 2), 'sigma  (report 6.1: "6,7σ over de grootste roosters")')
say('16^4 -> 20^4 ratio t1', 1.5, sig(*ratio(A5, 1), *ratio(A5b, 1))); say('same, R5', 1.2, sig(*ratio(A5), *ratio(A5b)))
from ym.exact import a_lambda_two_loop as aL
