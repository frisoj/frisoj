"""Selection-bias model of REPORT.md section 4.4 (bivariate normal; replication was run because m_eff rose from t=1 to t=2)."""
import json
from scipy.stats import norm
R = '/home/user/frisoj/yang-mills/results/'
p = json.load(open(R+'d3_b9.0_L24.json'))['glueball']['fixed_t']; s1 = p['t1']['err']; s2 = p['t2']['err']; sd = p['t1_minus_t2']['err']
rho = (s1**2+s2**2-sd**2)/(2*s1*s2); print('errors', s1, s2, sd, 'rho', rho)
c = json.load(open(R+'d3_b9.0_L24_combined.json'))['glueball']['fixed_t']; w1 = (c['t1']['err']/s1)**2; w2 = (c['t2']['err']/s2)**2
print('weights of round 1 in the combined value: t1', w1, 't2', w2)
for thr in (0, 1.0, 1.5, 1.97, 2.0):
    Ez = norm.pdf(thr)/norm.sf(thr)   # E[z | z > thr], z = (m2 - m1)/sd, true m1 = m2
    b2 = (s2**2-rho*s1*s2)/sd*Ez; b1 = (rho*s1*s2-s1**2)/sd*Ez
    print(f'rise > {thr} sigma: bias round1 t2 {b2:+.4f}, t1 {b1:+.4f}; combined t2 {w2*b2:+.4f}, t1 {w1*b1:+.4f}')
