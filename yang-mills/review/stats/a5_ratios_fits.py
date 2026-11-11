"""Points 4, 6, 7: correlated fixed-t ratios m/sqrt(sigma) (own jackknife, fixed vectors),
by-hand weighted fits, selection-free and fixed-physical-t variants of the scaling sets."""
import json, math, os
import numpy as np
from scipy import stats as sps
import lib

def ratios(name):
    P = lib.pipeline(name); B = int(P["binsize"])
    g = lib.channel_series(name, "glue"); t = lib.channel_series(name, "torelon")
    T, L, D = g["T"], g["L"], g["D"]
    ga = np.concatenate([lib.bins_of(a, B) for a in g["a"]]); gb = np.concatenate([lib.bins_of(b, B) for b in g["b"]])
    ta = np.concatenate([lib.bins_of(a, B) for a in t["a"]])
    def f(gam, gbm, tam):
        C = lib.conn(gam, gbm, True)
        m = [lib.meff_cosh(C[k], C[k + 1], k, T) for k in (1, 2)]
        E = [lib.meff_cosh(tam[k], tam[k + 1], k, T) for k in (1, 2)]
        s = [math.sqrt(lib.sigma_ng(e, L, D)) if np.isfinite(e) else float("nan") for e in E]
        return np.array([m[0], m[1], s[0], s[1], m[0] / s[0], m[0] / s[1], m[1] / s[0], m[1] / s[1], s[0] ** 2, s[1] ** 2])
    v, e, _ = lib.jk(f, ga, gb, ta)
    keys = ["m1", "m2", "s1", "s2", "m1/s1", "m1/s2", "m2/s1", "m2/s2", "x1", "x2"]
    return {k: (float(a), float(b)) for k, a, b in zip(keys, v, e)}

R = {n: ratios(n) for n in lib.ALL}
json.dump(R, open(os.path.join(lib.HERE, "out", "a5_ratios.json"), "w"), indent=1)
print("Own correlated jackknife, fixed GEVP vectors (m_t / sqrt(sigma_NG)_t'):")
print("%-22s %-12s %-12s %-12s %-12s | %-11s %-11s %-11s %-11s" % ("ensemble", "a*m(1)", "a*m(2)", "a*sqrt(s)(1)", "a*sqrt(s)(2)", "m1/s1", "m1/s2", "m2/s1", "m2/s2"))
for n, r in R.items():
    print("%-22s %-12s %-12s %-12s %-12s | %-11s %-11s %-11s %-11s" % ((n,) + tuple(lib.fmt(*r[k]) for k in ["m1", "m2", "s1", "s2", "m1/s1", "m1/s2", "m2/s1", "m2/s2"])))

def wls(x, y, e, deg):
    x, y, e = map(np.asarray, (x, y, e))
    A = np.vander(x, deg + 1, increasing=True) / e[:, None]
    cov = np.linalg.inv(A.T @ A); c = cov @ (A.T @ (y / e))
    chi2 = float(np.sum((y / e - A @ c) ** 2)); dof = len(x) - deg - 1
    return c, np.sqrt(np.diag(cov)), chi2, dof, (sps.chi2.sf(chi2, dof) if dof > 0 else float("nan"))

def report(label, pts, lit=(4.716, 0.021)):
    x = [p[0] for p in pts]; y = [p[1] for p in pts]; e = [p[2] for p in pts]
    c0, e0, chi0, d0, p0 = wls(x, y, e, 0)
    c1, e1, chi1, d1, p1 = wls(x, y, e, 1)
    S = max(1.0, math.sqrt(chi0 / d0))
    print("  %-58s pts %s" % (label, " ".join(lib.fmt(a, b) for a, b in zip(y, e))))
    print("     constant %s chi2 %.2f/%d p=%.3f (pull vs lit %+.1f; with error x S=%.2f: %+.1f) | linear in a^2 sigma: intercept %s chi2 %.2f/%d p=%.3f (pull %+.1f)"
          % (lib.fmt(c0[0], e0[0]), chi0, d0, p0, (c0[0] - lit[0]) / math.hypot(e0[0], lit[1]), S,
             (c0[0] - lit[0]) / math.hypot(S * e0[0], lit[1]),
             lib.fmt(c1[0], e1[0]), chi1, d1, p1, (c1[0] - lit[0]) / math.hypot(e1[0], lit[1])))
    return c0, e0, chi0, c1, e1, chi1

print("\nBY-HAND CHECK of summary.json fits (inputs = pipeline numbers as quoted in the task):")
print(" D=3, m/sqrt(sigma) vs a^2 sigma, literature continuum 4.716(21) [search excerpt]")
report("primary R5 [summary: const 4.773(26) 11.7/2; lin 4.863(51) 7.6/1]", [(0.2539**2, 4.710, 0.037), (0.1607**2, 5.003, 0.078), (0.1189**2, 4.788, 0.042)])
report("all data R5 [summary: 4.790(19) 7.1/2; 4.866(38) 2.0/1]", [(0.2539**2, 4.710, 0.037), (0.1606**2, 4.829, 0.025), (0.1189**2, 4.788, 0.042)])
report("all data t1 [summary: 4.783(17) 3.6/2; 4.837(36) 0.7/1]", [(0.25257**2, 4.735, 0.032), (0.16124**2, 4.809, 0.023), (0.11892**2, 4.788, 0.042)])
print(" D=4, literature continuum 3.78(7) [search excerpt]")
report("primary R5 [summary: const chi2 28.6/2; lin 4.259(116) 0.32/1]", [(0.3594**2, 3.325, 0.082), (0.2619**2, 3.790, 0.058), (0.1873**2, 3.962, 0.112)], lit=(3.78, 0.07))
report("all data R5 [summary: const chi2 37.5/2; lin 4.305(103) 0.01/1]", [(0.3594**2, 3.325, 0.082), (0.2619**2, 3.790, 0.058), (0.1866**2, 4.036, 0.087)], lit=(3.78, 0.07))

print("\nOWN VARIANTS, D=3 (own correlated ratios):")
def pt(n, k, xk): return (R[n][xk][0], R[n][k][0], R[n][k][1])
A6, A9c, A9r, A91, A12 = "d3_b6.0_L16", "d3_b9.0_L24_combined", "d3_b9.0_L24r", "d3_b9.0_L24", "d3_b12.0_L32"
report("t=1 everywhere, beta=9 combined", [pt(A6, "m1/s1", "x1"), pt(A9c, "m1/s1", "x1"), pt(A12, "m1/s1", "x1")])
report("t=1 everywhere, beta=9 REPLICATION ONLY (selection-free)", [pt(A6, "m1/s1", "x1"), pt(A9r, "m1/s1", "x1"), pt(A12, "m1/s1", "x1")])
report("t=1 everywhere, beta=9 round 1 only (pre-registered data)", [pt(A6, "m1/s1", "x1"), pt(A91, "m1/s1", "x1"), pt(A12, "m1/s1", "x1")])
report("t=2 everywhere, beta=9 combined", [pt(A6, "m2/s2", "x2"), pt(A9c, "m2/s2", "x2"), pt(A12, "m2/s2", "x2")])
report("t=2 everywhere, beta=9 REPLICATION ONLY", [pt(A6, "m2/s2", "x2"), pt(A9r, "m2/s2", "x2"), pt(A12, "m2/s2", "x2")])
report("fixed PHYSICAL t ~ 0.25/sqrt(sigma): t=1,2,2; b9 combined", [pt(A6, "m1/s1", "x1"), pt(A9c, "m2/s2", "x2"), pt(A12, "m2/s2", "x2")])
report("fixed PHYSICAL t ~ 0.25/sqrt(sigma): t=1,2,2; b9 replication", [pt(A6, "m1/s1", "x1"), pt(A9r, "m2/s2", "x2"), pt(A12, "m2/s2", "x2")])
report("glueball t=1, string tension t=2 everywhere; b9 combined", [pt(A6, "m1/s2", "x2"), pt(A9c, "m1/s2", "x2"), pt(A12, "m1/s2", "x2")])
report("glueball t=1, string tension t=2 everywhere; b9 replication", [pt(A6, "m1/s2", "x2"), pt(A9r, "m1/s2", "x2"), pt(A12, "m1/s2", "x2")])
print("  t*a*sqrt(sigma) at t=1: beta 6: %.3f, 9: %.3f, 12: %.3f" % (R[A6]["s1"][0], R[A9c]["s1"][0], R[A12]["s1"][0]))

print("\nOWN VARIANTS, D=4:")
B3, B4, B4L, B5 = "d4_b2.3_L10", "d4_b2.4_L12", "d4_b2.4_L16", "d4_b2.5_L16_combined"
lit4 = (3.78, 0.07)
report("t=1 everywhere (combined at 2.5)", [pt(B3, "m1/s1", "x1"), pt(B4, "m1/s1", "x1"), pt(B5, "m1/s1", "x1")], lit=lit4)
report("t=1, beta=2.4 from L=16", [pt(B3, "m1/s1", "x1"), pt(B4L, "m1/s1", "x1"), pt(B5, "m1/s1", "x1")], lit=lit4)
report("t=2 everywhere", [pt(B3, "m2/s2", "x2"), pt(B4, "m2/s2", "x2"), pt(B5, "m2/s2", "x2")], lit=lit4)
report("fixed PHYSICAL t ~ 0.37/sqrt(sigma): t=1 (2.3), t=1 (2.4), t=2 (2.5)", [pt(B3, "m1/s1", "x1"), pt(B4, "m1/s1", "x1"), pt(B5, "m2/s2", "x2")], lit=lit4)
d = R[B5]["m2/s2"][0] - R[B3]["m1/s1"][0]; de = math.hypot(R[B5]["m2/s2"][1], R[B3]["m1/s1"][1])
print("  beta 2.5 (t=2) minus beta 2.3 (t=1), same physical t: %+.3f +- %.3f (%.1f sigma)" % (d, de, d / de))
d = R[B5]["m1/s1"][0] - R[B3]["m1/s1"][0]; de = math.hypot(R[B5]["m1/s1"][1], R[B3]["m1/s1"][1])
print("  beta 2.5 (t=1) minus beta 2.3 (t=1): %+.3f +- %.3f (%.1f sigma)" % (d, de, d / de))
d = R[B5]["m1/s1"][0] - R[B4]["m1/s1"][0]; de = math.hypot(R[B5]["m1/s1"][1], R[B4]["m1/s1"][1])
print("  beta 2.5 (t=1) minus beta 2.4 L12 (t=1): %+.3f +- %.3f (%.1f sigma)" % (d, de, d / de))
d = R[B5]["m1/s1"][0] - R[B4L]["m1/s1"][0]; de = math.hypot(R[B5]["m1/s1"][1], R[B4L]["m1/s1"][1])
print("  beta 2.5 (t=1) minus beta 2.4 L16 (t=1): %+.3f +- %.3f (%.1f sigma)" % (d, de, d / de))
print("  t*a*sqrt(sigma) at t=1: beta 2.3: %.3f, 2.4: %.3f, 2.5: %.3f" % (R[B3]["s1"][0], R[B4]["s1"][0], R[B5]["s1"][0]))

print("\n1/L-gap alternative (a massless theory in a box would give a*m ~ 1/L):")
for a, b, La, Lb in (("d3_b6.0_L16", "d3_b6.0_L24", 16, 24), ("d4_b2.4_L12", "d4_b2.4_L16", 12, 16)):
    r = R[b]["m1"][0] / R[a]["m1"][0]; re = r * math.hypot(R[b]["m1"][1] / R[b]["m1"][0], R[a]["m1"][1] / R[a]["m1"][0])
    print("  %s -> %s: a*m ratio (large/small) = %s; 1/L scaling predicts %.3f: excluded at %.1f sigma; constant (1.0): %+.1f sigma"
          % (a, b, lib.fmt(r, re), La / Lb, (r - La / Lb) / re, (r - 1) / re))
