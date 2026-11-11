import itertools, math, numpy as np, lib
from scipy import stats as sps
def xc(x, y, lags):
    n = min(x.size, y.size); x = x[:n] - x[:n].mean(); y = y[:n] - y[:n].mean(); s = x.std() * y.std()
    out = []
    for lag in lags:
        r = np.mean(x[lag:] * y[:n - lag]) if lag >= 0 else np.mean(x[:n + lag] * y[-lag:])
        out.append(r / s * math.sqrt(n - abs(lag)))
    return np.array(out)
lags = list(range(-20, 21))
allz0 = []; allz = []
plaqsets = {}
for name in lib.INDEP:
    g = lib.channel_series(name, "glue"); t = lib.channel_series(name, "torelon")
    ser = {"plaq": g["plaq"], "glue_b": [b[:, 0] for b in g["b"]], "m1lin": lib.lin_series(g, True, 1)[0], "tor_a1": [a[:, 1] for a in t["a"]]}
    line = "%-14s" % name
    for k, xs in ser.items():
        # variance inflation of the cross-correlation estimate from autocorrelation: 1 + 2 sum rho_x rho_y
        tw = lib.tau_windows(xs, [10], maxlag=50); rho = tw["rho"]; infl = math.sqrt(1 + 2 * np.sum(rho[1:30] ** 2))
        zz = np.array([xc(xs[i], xs[j], lags) for i, j in itertools.combinations(range(len(xs)), 2)]) / infl
        allz0 += list(zz[:, 20]); allz += list(zz.ravel())
        line += " | %s: lag0 rms %.2f max %.2f; lags+-20 rms %.2f max %.2f" % (k, np.sqrt(np.mean(zz[:, 20] ** 2)), np.abs(zz[:, 20]).max(), np.sqrt(np.mean(zz ** 2)), np.abs(zz).max())
    print(line)
    for m, p in zip(g["meta"], g["plaq"]):
        plaqsets[m["seed"]] = (set(p.tolist()), p.size)
allz0 = np.array(allz0); allz = np.array(allz)
print("ALL: lag 0: n=%d rms %.3f max |z| %.2f (Gaussian expected max ~ %.2f); chi2 %.1f/%d p=%.3f" % (allz0.size, np.sqrt(np.mean(allz0 ** 2)), np.abs(allz0).max(), sps.norm.isf(0.5 / allz0.size), (allz0 ** 2).sum(), allz0.size, sps.chi2.sf((allz0 ** 2).sum(), allz0.size)))
print("ALL: lags -20..20: n=%d rms %.3f max |z| %.2f (Gaussian expected max ~ %.2f)" % (allz.size, np.sqrt(np.mean(allz ** 2)), np.abs(allz).max(), sps.norm.isf(0.5 / allz.size)))
seeds = sorted(plaqsets)
shared = [(a, b, len(plaqsets[a][0] & plaqsets[b][0])) for a, b in itertools.combinations(seeds, 2) if len(plaqsets[a][0] & plaqsets[b][0])]
print("duplicate plaquette values between any two of the %d streams: %s; streams with repeated values inside: %s" % (len(seeds), shared, [s for s in seeds if len(plaqsets[s][0]) != plaqsets[s][1]]))
