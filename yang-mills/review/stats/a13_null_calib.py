"""Null calibration of the thermalisation-phase effective-mass statistic: the same estimator
(every 10th measurement, 96 per stream, 4 streams pooled, jackknife bins of 5) applied to
PRODUCTION data in consecutive windows."""
import sys, math, numpy as np, lib
for ens in sys.argv[1:]:
    ser = lib.channel_series(ens, "glue"); tor = lib.channel_series(ens, "torelon"); T = ser["T"]
    N = sum(x.shape[0] for x in ser["a"]); b_eq = sum(b.sum() for b in ser["b"]) / N; a_eq = sum(a.sum(axis=0) for a in ser["a"]) / N
    C_eq = a_eq - b_eq ** 2; m_eq = lib.meff_cosh(C_eq[1], C_eq[2], 1, T)
    at_eq = sum(a.sum(axis=0) for a in tor["a"]) / N; E_eq = lib.meff_cosh(at_eq[1], at_eq[2], 1, T)
    nmin = min(a.shape[0] for a in ser["a"]); K = nmin // 960
    zs = []
    for k in range(K):
        sl = slice(k * 960, (k + 1) * 960, 10)
        ab = np.concatenate([lib.bins_of(a[sl], 5) for a in ser["a"]]); bb = np.concatenate([lib.bins_of(b[sl], 5) for b in ser["b"]]); tb = np.concatenate([lib.bins_of(a[sl], 5) for a in tor["a"]])
        def f(am, bm, tm):
            C = am - (2 * b_eq * bm[0] - b_eq ** 2)
            return np.array([lib.meff_cosh(C[1], C[2], 1, T), lib.meff_cosh(tm[1], tm[2], 1, T)])
        v, e, _ = lib.jk(f, ab, bb, tb)
        zs.append(((v[0] - m_eq) / e[0], (v[1] - E_eq) / e[1], v[0], e[0], v[1], e[1]))
    zs = np.array(zs)
    print("%s: %d production windows (960 measurements each, every 10th used): z glue m_eff(1): %s | z torelon E_eff(1): %s" % (
        ens, K, " ".join("%+.1f" % z for z in zs[:, 0]), " ".join("%+.1f" % z for z in zs[:, 1])))
    print("    mean z glue %+.2f, torelon %+.2f; rms glue %.2f, torelon %.2f; mean value glue %.3f (eq %.3f), torelon %.4f (eq %.4f)" % (
        np.nanmean(zs[:, 0]), np.nanmean(zs[:, 1]), np.sqrt(np.nanmean(zs[:, 0] ** 2)), np.sqrt(np.nanmean(zs[:, 1] ** 2)), np.nanmean(zs[:, 2]), m_eq, np.nanmean(zs[:, 4]), E_eq))
