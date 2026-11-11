"""Referee point: optimisation bias of the GEVP vector (it is chosen on the same data that give
m_eff).  Cross-validation: split every stream into 20 consecutive chunks, even chunks -> half A,
odd chunks -> half B.  Vector from A applied to B and vice versa ('cross') versus vector from
the same half ('same').  mean(same - cross) estimates the bias at HALF statistics."""
import math, sys, os, json
import numpy as np
import lib

def half_corr(streams_O, which, ref):
    A = 0.0; V = 0.0; n = 0
    for o in streams_O:
        o = lib.as4(o) - ref[None, None, :, None]
        ed = np.linspace(0, o.shape[0], 21).astype(int)
        for c in range(20):
            if c % 2 != which:
                continue
            a, v = lib.corr_sums(o[ed[c]:ed[c + 1]])
            A = A + a; V = V + v; n += ed[c + 1] - ed[c]
    A = A / n; V = V / n
    A = A - np.einsum("gk,gl->kl", V, V)[:, :, None] / V.shape[0]
    return lib.fold(0.5 * (A + np.swapaxes(A, 0, 1)))

def proj_m(C, sel, w, T):
    Cp = np.einsum("k,klt,l->t", w, C[np.ix_(sel, sel)], w)
    return lib.meff_cosh(Cp[1], Cp[2], 1, T), lib.meff_cosh(Cp[2], Cp[3], 2, T)

print("%-22s %-10s | m_eff(1): same-half  cross   same-cross  (pipeline err) | m_eff(2): same  cross  same-cross (pipeline err)" % ("ensemble", "n_ops"))
tot1 = []; tot2 = []
for name in sys.argv[1:]:
    st = lib.load(name, keys=("glue",))
    O = [s["glue"] for s in st]
    T = O[0].shape[-1]
    C, ref = lib.full_corr(O, True)
    sel, _ = lib.select_ops(C)
    CA = half_corr(O, 0, ref); CB = half_corr(O, 1, ref)
    wA, _ = lib.gevp_vector(CA, sel); wB, _ = lib.gevp_vector(CB, sel)
    sAA = proj_m(CA, sel, wA, T); sBB = proj_m(CB, sel, wB, T)
    cAB = proj_m(CB, sel, wA, T); cBA = proj_m(CA, sel, wB, T)
    same = [(sAA[i] + sBB[i]) / 2 for i in (0, 1)]; cross = [(cAB[i] + cBA[i]) / 2 for i in (0, 1)]
    P = lib.pipeline(name)
    e1 = P["glueball"]["fixed_t"]["t1"]["err"]; e2 = P["glueball"]["fixed_t"]["t2"]["err"]
    print("%-22s %-10s | %.4f  %.4f  %+.5f = %+.2f sigma | %.4f  %.4f  %+.5f = %+.2f sigma" % (
        name, len(sel), same[0], cross[0], same[0] - cross[0], (same[0] - cross[0]) / e1,
        same[1], cross[1], same[1] - cross[1], (same[1] - cross[1]) / e2))
    tot1.append((same[0] - cross[0]) / e1); tot2.append((same[1] - cross[1]) / e2)
print("mean (same - cross)/pipeline error over ensembles: t=1 %+.3f, t=2 %+.3f  (bias at full statistics is about half of this)" % (np.mean(tot1), np.mean(tot2)))
