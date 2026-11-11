"""Point 3: the beta = 9 replication.  Per-stream values, leave-one-stream-out, cross-correlation
between streams (all lags), duplicate check, time dependence, error inflation."""
import itertools
import json
import math
import os

import numpy as np
from scipy import stats as sps

import lib

OUT = os.path.join(lib.HERE, "out")
B = 15
name = "d3_b9.0_L24_combined"
ser = lib.channel_series(name, "glue")           # vector from the combined sample
tor = lib.channel_series(name, "torelon")
T = ser["T"]
seeds = [m["seed"] for m in ser["meta"]]
starts = [m["start"] for m in ser["meta"]]
res = {"seeds": seeds, "starts": starts}
print("streams:", list(zip(seeds, starts)), "lengths", [a.shape[0] for a in ser["a"]])

# ---------------------------------------------------------------- per-stream values
print("\n(a) per-stream values (common GEVP vector from the combined sample; each stream with its own vacuum subtraction; bins of %d)" % B)
vals = []
for i in range(8):
    m, e, _, nb = lib.binned_meff(ser, B, True, tmax=3, streams=[i])
    mt, et, _, _ = lib.binned_meff(tor, B, False, tmax=2, streams=[i])
    vals.append((m, e, mt, et))
    print("   s%d %-4s  m_eff(1) %s  m_eff(2) %s  m_eff(3) %s | torelon E(1) %s E(2) %s"
          % (seeds[i], starts[i], lib.fmt(m[1], e[1]), lib.fmt(m[2], e[2]), lib.fmt(m[3], e[3]),
             lib.fmt(mt[1], et[1]), lib.fmt(mt[2], et[2])))
for t in (1, 2, 3):
    v = np.array([x[0][t] for x in vals]); e = np.array([x[1][t] for x in vals])
    w = 1 / e ** 2; wm = (w * v).sum() / w.sum(); chi2 = float((w * (v - wm) ** 2).sum())
    print("   glueball m_eff(%d): 8-stream chi2 = %.2f / 7 (p = %.3f); round-1 streams %.2f/3, replication %.2f/3"
          % (t, chi2, sps.chi2.sf(chi2, 7),
             float((w[:4] * (v[:4] - (w[:4] * v[:4]).sum() / w[:4].sum()) ** 2).sum()),
             float((w[4:] * (v[4:] - (w[4:] * v[4:]).sum() / w[4:].sum()) ** 2).sum())))
    res["chi2_8_t%d" % t] = chi2

# set values with a common vector
def setval(idx, Bx=B, discard=0):
    m, e, s, nb = lib.binned_meff(ser, Bx, True, tmax=3, streams=idx, discard=discard)
    return m, e

print("\n(b) set difference round 1 - replication (common vector), and with one stream left out")
m1, e1 = setval([0, 1, 2, 3]); m2, e2 = setval([4, 5, 6, 7])
for t in (1, 2):
    print("   t=%d: round 1 %s, replication %s, diff %+.4f = %+.2f sigma"
          % (t, lib.fmt(m1[t], e1[t]), lib.fmt(m2[t], e2[t]), m1[t] - m2[t],
             (m1[t] - m2[t]) / math.hypot(e1[t], e2[t])))
for drop in range(8):
    a = [i for i in range(4) if i != drop]; b = [i for i in range(4, 8) if i != drop]
    ma, ea = setval(a); mb, eb = setval(b)
    print("   without s%d: t=1 %+.2f sigma, t=2 %+.2f sigma" % (
        seeds[drop], (ma[1] - mb[1]) / math.hypot(ea[1], eb[1]), (ma[2] - mb[2]) / math.hypot(ea[2], eb[2])))

print("\n(c) all 35 splits of the 8 streams into two groups of 4 (look-elsewhere scale): |pull| at t=2 and t=1")
pulls2, pulls1 = [], []
for comb in itertools.combinations(range(8), 4):
    if 0 not in comb:
        continue
    other = [i for i in range(8) if i not in comb]
    ma, ea = setval(list(comb)); mb, eb = setval(other)
    pulls1.append((abs((ma[1] - mb[1]) / math.hypot(ea[1], eb[1])), comb))
    pulls2.append((abs((ma[2] - mb[2]) / math.hypot(ea[2], eb[2])), comb))
p2 = sorted(pulls2, reverse=True); p1 = sorted(pulls1, reverse=True)
print("   t=2: largest |pull| %.2f for split %s; the actual split (0,1,2,3) has rank %d of 35; rms over splits %.2f"
      % (p2[0][0], [seeds[i] for i in p2[0][1]], [c for _, c in p2].index((0, 1, 2, 3)) + 1,
         math.sqrt(np.mean([x[0] ** 2 for x in p2]))))
print("   t=1: largest |pull| %.2f for split %s; actual split rank %d of 35; rms %.2f"
      % (p1[0][0], [seeds[i] for i in p1[0][1]], [c for _, c in p1].index((0, 1, 2, 3)) + 1,
         math.sqrt(np.mean([x[0] ** 2 for x in p1]))))

# ---------------------------------------------------------------- bin-size dependence of the pull
print("\n(d) pull versus bin size (underestimated errors?)")
for Bx in (15, 60, 240, 480, 960):
    m1, e1 = setval([0, 1, 2, 3], Bx); m2, e2 = setval([4, 5, 6, 7], Bx)
    print("   B=%4d: t=1 %s vs %s -> %+.2f sigma | t=2 %s vs %s -> %+.2f sigma" % (
        Bx, lib.fmt(m1[1], e1[1]), lib.fmt(m2[1], e2[1]), (m1[1] - m2[1]) / math.hypot(e1[1], e2[1]),
        lib.fmt(m1[2], e1[2]), lib.fmt(m2[2], e2[2]), (m1[2] - m2[2]) / math.hypot(e1[2], e2[2])))

# ---------------------------------------------------------------- cross-correlation between streams
print("\n(e) cross-correlation between streams at equal and shifted Monte Carlo time (lags -200..200)")
def xcorr(x, y, maxlag):
    n = min(x.size, y.size)
    x = x[:n] - x[:n].mean(); y = y[:n] - y[:n].mean()
    sx, sy = x.std(), y.std()
    out = []
    for lag in range(-maxlag, maxlag + 1):
        if lag >= 0:
            r = np.mean(x[lag:] * y[:n - lag])
        else:
            r = np.mean(x[:n + lag] * y[-lag:])
        out.append(r / (sx * sy) * math.sqrt(n - abs(lag)))
    return np.array(out)

ls1, _, _ = lib.lin_series(ser, True, 1)
series = {"plaquette": ser["plaq"], "glue b (projected, time-slice mean)": [b[:, 0] for b in ser["b"]],
          "glue a(1)": [a[:, 1] for a in ser["a"]], "m_eff(1) linearised": ls1,
          "torelon a(1)": [a[:, 1] for a in tor["a"]]}
for k, xs in series.items():
    zs = []
    z0 = []
    for i, j in itertools.combinations(range(8), 2):
        # correct z for autocorrelation: var of r_xy ~ (1/n) sum_t rho_x(t) rho_y(t) ~ (2 tau_x)(2 tau_y) effect is
        # small for tau ~ 0.5-1.5; computed empirically below from the scatter over lags
        z = xcorr(xs[i], xs[j], 200)
        zs.append(z)
        z0.append(z[200])
    zs = np.array(zs)
    print("   %-36s lag 0: rms z %.2f, max |z| %.2f (28 pairs) | all lags: rms %.3f, max |z| %.2f over %d values (Gaussian max ~ %.1f)"
          % (k, np.sqrt(np.mean(np.square(z0))), np.max(np.abs(z0)), np.sqrt(np.mean(zs ** 2)),
             np.abs(zs).max(), zs.size, sps.norm.isf(0.5 / zs.size)))
# duplicates
print("\n(f) duplicate check: number of plaquette values shared between any two streams (exact float equality)")
sets = [set(p.tolist()) for p in ser["plaq"]]
for i, j in itertools.combinations(range(8), 2):
    c = len(sets[i] & sets[j])
    if c:
        print("   s%d & s%d share %d values" % (seeds[i], seeds[j], c))
print("   distinct values per stream / length:", [(len(s), p.size) for s, p in zip(sets, ser["plaq"])])
print("   first three plaquette values per stream:")
for i in range(8):
    print("     s%d %s: %s" % (seeds[i], starts[i], np.array2string(ser["plaq"][i][:3], precision=10)))

# ---------------------------------------------------------------- time dependence
print("\n(g) time dependence: linearised m_eff(t) in 10 equal chunks of every stream, pooled over the 4 streams of a set;"
      "\n    z of each chunk against the other nine (errors from the Gamma method of the set)")
for label, idx in (("round 1", [0, 1, 2, 3]), ("replication", [4, 5, 6, 7])):
    for t in (1, 2):
        ls, mlog, _ = lib.lin_series({"a": [ser["a"][i] for i in idx], "b": [ser["b"][i] for i in idx]}, True, t)
        tw = lib.tau_windows(ls, [10])
        var, tau = tw["var"], max(tw["auto"][0], 0.5)
        ch = [[] for _ in range(10)]
        for s in ls:
            ed = np.linspace(0, s.size, 11).astype(int)
            for c in range(10):
                ch[c].append(s[ed[c]:ed[c + 1]])
        zs = []
        for c in range(10):
            x = np.concatenate(ch[c]); y = np.concatenate([np.concatenate(ch[d]) for d in range(10) if d != c])
            zs.append((x.mean() - y.mean()) / math.sqrt(2 * tau * var * (1 / x.size + 1 / y.size)))
        allm = np.array([np.concatenate(c).mean() for c in ch])
        nn = np.array([np.concatenate(c).size for c in ch])
        chi2 = float(np.sum((allm - np.concatenate(ls).mean()) ** 2 * nn / (2 * tau * var)))
        print("   %-11s m_eff(%d): z per chunk %s | chi2 %.1f/9 (p=%.3f)" % (
            label, t, " ".join("%+.1f" % z for z in zs), chi2, sps.chi2.sf(chi2, 9)))
        res["chunks_%s_t%d" % (label, t)] = zs

# per-stream z of the first tenth
print("\n(h) first tenth of each stream against the rest of the same stream (linearised m_eff(1), m_eff(2))")
for t in (1, 2):
    ls, _, _ = lib.lin_series(ser, True, t)
    line = "   m_eff(%d):" % t
    for i, s in enumerate(ls):
        n = s.size; k = n // 10
        tw = lib.tau_windows([s], [10]); tau = max(tw["auto"][0], 0.5)
        z = (s[:k].mean() - s[k:].mean()) / math.sqrt(2 * tau * tw["var"] * (1 / k + 1 / (n - k)))
        line += " s%d(%s) %+.1f" % (seeds[i], starts[i][0], z)
    print(line)

# set values with the first 10 % / 25 % of every stream discarded (common vector)
print("\n(i) values with the first part of every stream discarded (common vector)")
for frac in (0.0, 0.1, 0.25, 0.5):
    out = []
    for idx in ([0, 1, 2, 3], [4, 5, 6, 7]):
        sub = {"a": [ser["a"][i][int(frac * ser["a"][i].shape[0]):] for i in idx],
               "b": [ser["b"][i][int(frac * ser["b"][i].shape[0]):] for i in idx], "T": T}
        m, e, _, _ = lib.binned_meff(sub, B, True, tmax=2)
        out.append((m, e))
    (ma, ea), (mb, eb) = out
    print("   discard %2.0f %%: round 1 t1 %s t2 %s | replication t1 %s t2 %s | pulls t1 %+.2f t2 %+.2f" % (
        100 * frac, lib.fmt(ma[1], ea[1]), lib.fmt(ma[2], ea[2]), lib.fmt(mb[1], eb[1]), lib.fmt(mb[2], eb[2]),
        (ma[1] - mb[1]) / math.hypot(ea[1], eb[1]), (ma[2] - mb[2]) / math.hypot(ea[2], eb[2])))
json.dump(res, open(os.path.join(OUT, "a4_beta9.json"), "w"), indent=1, default=float)
