"""Null calibration of the 'early window' statistic: the same pooled z, but for windows placed at
later positions k*w in every stream (window against the rest of the stream)."""
import math, numpy as np, lib
def zwin(x, s, w, tau, var):
    m = np.ones(x.size, bool); m[s:s + w] = False
    return (x[s:s + w].mean() - x[m].mean()) / math.sqrt(2 * tau * var * (1.0 / w + 1.0 / m.sum()))
for label, t in (("glue m_eff(1)", 1), ("glue m_eff(2)", 2)):
    for w in (100, 200):
        K = 1208 // w
        Zh = np.zeros(K); Zc = np.zeros(K); nh = nc = 0
        for name in lib.INDEP:
            g = lib.channel_series(name, "glue"); ls = lib.lin_series(g, True, t)[0]
            starts = [m["start"] for m in g["meta"]]
            for x, st in zip(ls, starts):
                tw = lib.tau_windows([x], [10], maxlag=min(x.size // 4, 400)); tau = max(tw["auto"][0], 0.5); var = tw["var"]
                z = np.array([zwin(x, k * w, w, tau, var) for k in range(K)])
                if st == "hot":
                    Zh += z; nh += 1
                else:
                    Zc += z; nc += 1
        Zh /= math.sqrt(nh); Zc /= math.sqrt(nc)
        print("%s, w=%d: pooled z over %d hot streams for windows k=0..%d: %s" % (label, w, nh, K - 1, " ".join("%+.1f" % z for z in Zh)))
        print("%s  pooled z over %d cold streams:                          %s" % (" " * len(label), nc, " ".join("%+.1f" % z for z in Zc)))
        print("     rms of the later windows (k>=1): hot %.2f, cold %.2f" % (np.sqrt(np.mean(Zh[1:] ** 2)), np.sqrt(np.mean(Zc[1:] ** 2))))
