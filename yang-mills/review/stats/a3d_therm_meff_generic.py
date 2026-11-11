import sys, math, numpy as np, lib
ens, files, sh, Bz = sys.argv[1], sys.argv[2].split(","), int(sys.argv[3]), int(sys.argv[4])
wins = [tuple(int(x) for x in w.split("-")) for w in sys.argv[5:]]
ser = lib.channel_series(ens, "glue"); tor = lib.channel_series(ens, "torelon")
sel, w, ref, T = ser["sel"], ser["w"], ser["ref"], ser["T"]
N = sum(x.shape[0] for x in ser["a"]); b_eq = sum(b.sum() for b in ser["b"]) / N; a_eq = sum(a.sum(axis=0) for a in ser["a"]) / N
C_eq = a_eq - b_eq ** 2; m_eq = [lib.meff_cosh(C_eq[t], C_eq[t + 1], t, T) for t in (1, 2)]
at_eq = sum(a.sum(axis=0) for a in tor["a"]) / N; E_eq = lib.meff_cosh(at_eq[1], at_eq[2], 1, T)
A, Bv, TA = [], [], []
for f in files:
    h = dict(np.load(f, allow_pickle=False))
    a, b = lib.ab_series(lib.project(h["glue"], sel, w, ref)); A.append(a); Bv.append(b[:, 0])
    ta, _ = lib.ab_series(lib.project(h["torelon"], tor["sel"], tor["w"], None)); TA.append(ta)
upd = sh * (np.arange(A[0].shape[0]) + 1)
print("%s: production m_eff(1) %.4f m_eff(2) %.4f torelon E_eff(1) %.4f ; history files: %d, spacing %d updates" % (ens, m_eq[0], m_eq[1], E_eq, len(files), sh))
for lo, hi in wins:
    m = (upd > lo) & (upd <= hi)
    ab = np.concatenate([lib.bins_of(a[m], Bz) for a in A]); bb = np.concatenate([lib.bins_of(b[m][:, None], Bz) for b in Bv]); tb = np.concatenate([lib.bins_of(a[m], Bz) for a in TA])
    def f(am, bm, tm):
        C = am - (2 * b_eq * bm[0] - b_eq ** 2)
        return np.array([lib.meff_cosh(C[1], C[2], 1, T), lib.meff_cosh(C[2], C[3], 2, T), lib.meff_cosh(tm[1], tm[2], 1, T), C[1] / C_eq[1], tm[0] / at_eq[0]])
    v, e, _ = lib.jk(f, ab, bb, tb)
    print("   updates %5d-%-5d n=%4d: glue m_eff(1) %-12s (z %+.1f)  m_eff(2) %-12s (z %+.1f)  torelon E_eff(1) %-12s (z %+.1f)  C_glue(1)/eq %-10s  C_tor(0)/eq %-10s"
          % (lo, hi, ab.shape[0] * Bz, lib.fmt(v[0], e[0]), (v[0] - m_eq[0]) / e[0], lib.fmt(v[1], e[1]), (v[1] - m_eq[1]) / e[1],
             lib.fmt(v[2], e[2]), (v[2] - E_eq) / e[2], lib.fmt(v[3], e[3]), lib.fmt(v[4], e[4])))
