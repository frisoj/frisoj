"""Look-elsewhere survey over the 10 independent ensembles: stream chi2 (3 dof), hot-minus-cold
pull, ten-chunk chi2 (9 dof) and first-tenth z, for the plaquette and the linearised
m_eff(1), m_eff(2) (glueball) and E_eff(1), E_eff(2) (torelon).  Errors: Gamma method
(Sokal window c=5) from the whole ensemble; chunk/stream means are means of the linearised
per-configuration series (no nonlinearity)."""
import json, math, os
import numpy as np
from scipy import stats as sps
import lib
rows = []
tot = {}
for name in lib.INDEP:
    g = lib.channel_series(name, "glue"); t = lib.channel_series(name, "torelon")
    starts = [m["start"] for m in g["meta"]]
    ser = {"plaquette": g["plaq"]}
    for tt in (1, 2):
        ser["glue m_eff(%d)" % tt] = lib.lin_series(g, True, tt)[0]
        ser["torelon E_eff(%d)" % tt] = lib.lin_series(t, False, tt)[0]
    for k, xs in ser.items():
        tw = lib.tau_windows(xs, [10]); tau = max(tw["auto"][0], 0.5); var = tw["var"]
        allm = np.concatenate(xs).mean()
        sm = np.array([x.mean() for x in xs]); sn = np.array([x.size for x in xs])
        se = np.sqrt(2 * tau * var / sn)
        w = 1 / se ** 2; wm = (w * sm).sum() / w.sum()
        chi2s = float((w * (sm - wm) ** 2).sum())
        hot = [i for i, s in enumerate(starts) if s == "hot"]; cold = [i for i, s in enumerate(starts) if s == "cold"]
        mh = np.concatenate([xs[i] for i in hot]); mc = np.concatenate([xs[i] for i in cold])
        hc = (mh.mean() - mc.mean()) / math.sqrt(2 * tau * var * (1 / mh.size + 1 / mc.size))
        ch = [[] for _ in range(10)]
        for s in xs:
            ed = np.linspace(0, s.size, 11).astype(int)
            for c in range(10):
                ch[c].append(s[ed[c]:ed[c + 1]])
        cm = np.array([np.concatenate(c).mean() for c in ch]); cn = np.array([np.concatenate(c).size for c in ch])
        chi2c = float(np.sum((cm - allm) ** 2 * cn / (2 * tau * var)))
        rest = np.concatenate([np.concatenate(c) for c in ch[1:]])
        z1 = (cm[0] - rest.mean()) / math.sqrt(2 * tau * var * (1 / cn[0] + 1 / rest.size))
        zc = (cm - allm) / np.sqrt(2 * tau * var * (1 / cn - 1 / cn.sum()))
        rows.append((name, k, chi2s, sps.chi2.sf(chi2s, 3), hc, chi2c, sps.chi2.sf(chi2c, 9), z1, np.abs(zc).max()))
        d = tot.setdefault(k, {"chi2s": 0.0, "chi2c": 0.0, "hc": [], "z1": [], "n": 0, "zmax": []})
        d["chi2s"] += chi2s; d["chi2c"] += chi2c; d["hc"].append(hc); d["z1"].append(z1); d["n"] += 1; d["zmax"].append(np.abs(zc).max())
print("%-14s %-18s stream chi2/3 (p)     hot-cold   10-chunk chi2/9 (p)   z(first tenth)  max|z| chunk" % ("ensemble", "quantity"))
for r in rows:
    print("%-14s %-18s %6.2f (%.3f)        %+5.2f      %6.2f (%.3f)        %+5.2f          %.2f" % r)
print("\nTotals over the 10 independent ensembles:")
for k, d in tot.items():
    hc = np.array(d["hc"]); z1 = np.array(d["z1"])
    print("  %-18s stream chi2 %.1f/%d (p=%.3f) | hot-cold: sum z^2 %.1f/%d (p=%.3f), mean z %+.2f*sqrt(n) = %+.2f | chunk chi2 %.1f/%d (p=%.3f) | first tenth: sum z/sqrt(n) %+.2f, sum z^2 %.1f/%d"
          % (k, d["chi2s"], 3 * d["n"], sps.chi2.sf(d["chi2s"], 3 * d["n"]), (hc ** 2).sum(), d["n"], sps.chi2.sf((hc ** 2).sum(), d["n"]),
             hc.mean(), hc.sum() / math.sqrt(d["n"]), d["chi2c"], 9 * d["n"], sps.chi2.sf(d["chi2c"], 9 * d["n"]),
             z1.sum() / math.sqrt(d["n"]), (z1 ** 2).sum(), d["n"]))
ps = sorted([(r[6], r[0], r[1]) for r in rows])
print("\nsmallest 10-chunk p-values of %d tests: %s" % (len(rows), ", ".join("%.4f (%s %s)" % x for x in ps[:4])))
print("  probability that the smallest of %d independent p-values is <= %.4f: %.2f" % (len(rows), ps[0][0], 1 - (1 - ps[0][0]) ** len(rows)))
ps = sorted([(r[3], r[0], r[1]) for r in rows])
print("smallest stream-chi2 p-values: %s" % ", ".join("%.4f (%s %s)" % x for x in ps[:4]))
zz = sorted([(abs(r[7]), r[0], r[1], r[7]) for r in rows], reverse=True)
print("largest |z(first tenth)|: %s" % ", ".join("%+.2f (%s %s)" % (x[3], x[1], x[2]) for x in zz[:5]))
zz = sorted([(abs(r[4]), r[0], r[1], r[4]) for r in rows], reverse=True)
print("largest |hot-cold|: %s" % ", ".join("%+.2f (%s %s)" % (x[3], x[1], x[2]) for x in zz[:5]))
