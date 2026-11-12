"""Helpers for the number-by-number check of REPORT.md / THEORY.md (read-only on the project)."""
import json, re, math, os
ROOT = '/home/user/frisoj/yang-mills'
ENS = ['d3_b6.0_L16','d3_b6.0_L24','d3_b9.0_L24','d3_b9.0_L24r','d3_b9.0_L24_combined','d3_b12.0_L32',
       'd4_b2.3_L10','d4_b2.4_L12','d4_b2.4_L16','d4_b2.5_L16','d4_b2.5_L16x','d4_b2.5_L16_combined','d4_b2.5_L20']
P = {e: json.load(open(f'{ROOT}/results/{e}.json')) for e in ENS}
I = {e: json.load(open(f'{ROOT}/results/independent/{e}.json')) for e in ENS}
S = json.load(open(f'{ROOT}/results/summary.json'))
LIT = json.load(open(f'{ROOT}/literature.json'))
TOK = re.compile(r'(-?\d+\.\d+)\((\d+(?:\.\d+)?)\)')

def parse(tok):
    m = TOK.search(tok)
    if not m: return None
    v, e = m.group(1), m.group(2)
    dec = len(v.split('.')[1])
    val = float(v)
    err = float(e) if '.' in e else int(e) * 10.0**(-dec)
    return val, err, dec

def fmt(v, e, dec):
    return f"{v:.{dec}f}({int(round(e*10**dec))})"

N_OK = [0]; BAD = []
def chk(label, tok, v, e, quiet=True):
    p = parse(tok)
    if p is None:
        BAD.append((label, tok, 'unparsable')); print('UNPARSABLE', label, tok); return False
    val, err, dec = p
    ok = abs(round(v, dec) - val) < 0.51*10**(-dec) * 1e-6 + 1e-12 and abs(round(e, dec) - err) < 1e-12 + 1e-9
    # exact rounding comparison
    ok = (f"{v:.{dec}f}" == f"{val:.{dec}f}") and (abs(round(e*10**dec) - round(err*10**dec)) < 0.5)
    if ok:
        N_OK[0] += 1
        if not quiet: print('ok  ', label, tok)
    else:
        BAD.append((label, tok, fmt(v, e, dec)))
        print(f'MISMATCH {label}: report {tok}  computed {fmt(v,e,dec)}   [{v:.6f} +- {e:.6f}]')
    return ok

def gl(e, t=None):
    g = P[e]['glueball']
    if t is None: return g['mass'], g['err'], g['t_star']
    return g['fixed_t'][f't{t}']['m'], g['fixed_t'][f't{t}']['err']
def gmeff(e, t):
    r = P[e]['glueball']['meff_table'][t]; assert r['t'] == t
    return r['m_cosh'], r['err_cosh']
def tmeff(e, t):
    r = P[e]['torelon']['meff_table'][t]; assert r['t'] == t
    return r['m_cosh'], r['err_cosh']
def tor(e, t=None):
    g = P[e]['torelon']
    if t is None: return g['mass'], g['err'], g['t_star']
    return g['fixed_t'][f't{t}']['m'], g['fixed_t'][f't{t}']['err']
def ss(e, t=None, form='nambu_goto'):
    s = P[e]['string_tension']
    if t is None: return s[form]['a_sqrt_sigma'], s[form]['a_sqrt_sigma_err']
    for r in s['fixed_t']:
        if r['t'] == t: return r[form]['a_sqrt_sigma'], r[form]['a_sqrt_sigma_err']
    raise KeyError
def ratio(e, t=None, form='nambu_goto'):
    if t is None:
        r = P[e]['ratios']['m_over_sqrt_sigma'][form]; return r['value'], r['err']
    r = I[e]['ratios']['m_over_sqrt_sigma']['gevp'][f't{t}'][form]
    return r['value'], r['err_jack']
def quad(*errs): return math.sqrt(sum(x*x for x in errs))
def wavg(vals, errs):
    w = [1/x**2 for x in errs]; m = sum(a*b for a, b in zip(w, vals))/sum(w)
    chi2 = sum(((a-m)/b)**2 for a, b in zip(vals, errs))
    return m, 1/math.sqrt(sum(w)), chi2
def linfit(x, y, e):
    import numpy as np
    x, y, e = map(np.asarray, (x, y, e)); w = 1/e**2
    A = np.vstack([np.ones_like(x), x]).T
    cov = np.linalg.inv(A.T @ (A*w[:, None])); p = cov @ (A.T @ (w*y))
    chi2 = float(np.sum(w*(y - A@p)**2))
    return p[0], math.sqrt(cov[0, 0]), p[1], math.sqrt(cov[1, 1]), chi2
def table_rows(path, header_startswith):
    """Return rows (list of cell lists) of the first markdown table whose header line starts with given text."""
    lines = open(path, encoding='utf-8').read().split('\n')
    for i, l in enumerate(lines):
        if l.startswith(header_startswith):
            rows = []
            for m in lines[i+2:]:
                if not m.startswith('|'): break
                rows.append([c.strip() for c in m.strip().strip('|').split('|')])
            return rows
    raise KeyError(header_startswith)
