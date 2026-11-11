"""Point 5: vacuum subtraction and the zero-mass hypothesis.

For every ensemble (GEVP-projected glueball operator, fixed vector, bins of the pipeline size):
 * z of C(t) - C(t+1) > 0 for t = 1, 2, 3   (a zero-mass / constant correlator has C(t) = C(t+1))
 * m_eff(t) and a CONSTANT-INSENSITIVE effective mass
       m_D(t) = ln[(C(t) - C(t+1)) / (C(t+1) - C(t+2))]
   which is unchanged if any constant is added to C (imperfect vacuum subtraction, drifting <O>).
 * the far-time plateau: weighted mean of C(t) for t >= t_far (where A exp(-m t) is negligible)
   as a direct estimate of a residual constant, and the shift it would cause in m_eff(1), m_eff(2)
 * finite-sample bias of the subtraction, -Var(mean of b), relative to C(2), C(3)
 * global versus stream-wise versus chunk-wise (8 per stream) vacuum subtraction
 * power-law alternative C ~ t^-p: predicts m_eff(2)/m_eff(1) = ln(3/2)/ln(2) = 0.585
"""
import json
import math
import os
import sys

import numpy as np

import lib

OUT = os.path.join(lib.HERE, "out")
R_POW = math.log(1.5) / math.log(2.0)


def analyse(name):
    P = lib.pipeline(name)
    B = int(P["binsize"])
    ser = lib.channel_series(name, "glue")
    T = ser["T"]
    ab = np.concatenate([lib.bins_of(a, B) for a in ser["a"]])
    bb = np.concatenate([lib.bins_of(b, B) for b in ser["b"]])
    nt = T // 2

    def corr(am, bm):
        return lib.conn(am, bm, True)

    C, Ce, Cs = lib.jk(corr, ab, bb)
    res = {"ensemble": name, "T": T, "B": B, "n_bins": int(ab.shape[0])}
    res["C_over_err"] = [float(C[t] / Ce[t]) for t in range(nt + 1)]

    def diffs(am, bm):
        c = corr(am, bm)
        return np.array([c[t] - c[t + 1] for t in range(0, 4)])

    d, de, _ = lib.jk(diffs, ab, bb)
    res["z_C(t)-C(t+1)"] = {t: float(d[t] / de[t]) for t in (1, 2, 3)}

    def masses(am, bm):
        c = corr(am, bm)
        m1 = lib.meff_cosh(c[1], c[2], 1, T)
        m2 = lib.meff_cosh(c[2], c[3], 2, T)
        with np.errstate(invalid="ignore", divide="ignore"):
            n1, n2, n3 = c[1] - c[2], c[2] - c[3], c[3] - c[4]
            mD1 = math.log(n1 / n2) if n1 > 0 and n2 > 0 else float("nan")
            mD2 = math.log(n2 / n3) if n2 > 0 and n3 > 0 else float("nan")
        return np.array([m1, m2, mD1, mD2, mD1 - m1, m2 - R_POW * m1, m2 / m1 if m1 > 0 else float("nan")])

    m, me, ms = lib.jk(masses, ab, bb)
    res["m1"], res["m1_err"] = float(m[0]), float(me[0])
    res["m2"], res["m2_err"] = float(m[1]), float(me[1])
    res["mD1"], res["mD1_err"] = float(m[2]), float(me[2])
    res["mD2"], res["mD2_err"] = float(m[3]), float(me[3])
    res["mD1_minus_m1"], res["mD1_minus_m1_err"] = float(m[4]), float(me[4])
    res["powerlaw_stat"], res["powerlaw_stat_err"] = float(m[5]), float(me[5])
    res["m2_over_m1"], res["m2_over_m1_err"] = float(m[6]), float(me[6])

    # far-time constant: t_far = first t with predicted signal A exp(-m t) < 0.25 * error
    A = C[1] * math.exp(m[0] * 1.0)
    tfar = None
    for t in range(2, nt + 1):
        pred = A * (math.exp(-m[0] * t) + math.exp(-m[0] * (T - t)))
        if pred < 0.25 * Ce[t]:
            tfar = t
            break
    if tfar is not None:
        def far(am, bm):
            c = corr(am, bm)
            return np.array([np.mean(c[tfar:nt + 1])])
        c0, c0e, _ = lib.jk(far, ab, bb)
        c0, c0e = float(c0[0]), float(c0e[0])
        res["t_far"] = tfar
        res["const"], res["const_err"] = c0, c0e
        # shift of m_eff(t) if a constant c were present: m' - m = ln((C(t)-c)/(C(t+1)-c)) - ln(C(t)/C(t+1))
        def shift(c, t):
            return math.log((C[t] - c) / (C[t + 1] - c)) - math.log(C[t] / C[t + 1])
        res["shift_m1_if_const"] = [shift(c0, 1), shift(c0 + 2 * c0e, 1), shift(c0 - 2 * c0e, 1)]
        res["shift_m2_if_const"] = [shift(c0, 2), shift(c0 + 2 * c0e, 2), shift(c0 - 2 * c0e, 2)]
    # finite-sample bias of the vacuum subtraction: -Var(mean b)
    bs = [b[:, 0] for b in ser["b"]]
    tw = lib.tau_windows(bs, [50, 200])
    N = tw["N"]
    varmean = 2.0 * max(tw["auto"][0], 0.5) * tw["var"] / N
    varmean200 = 2.0 * max(tw["fixed"].get(200, tw["auto"])[0], 0.5) * tw["var"] / N
    res["subtraction_bias_over_C"] = {t: float(varmean / C[t]) for t in (1, 2, 3)}
    res["subtraction_bias_over_C_tauW200"] = {t: float(varmean200 / C[t]) for t in (1, 2, 3)}
    res["vev2_over_C0"] = float((np.dot(ser["w"], ser["ref"][ser["sel"]])) ** 2 / C[0])

    # global vs stream-wise vs chunk-wise subtraction
    Ntot = sum(a.shape[0] for a in ser["a"])
    am = sum(a.sum(axis=0) for a in ser["a"]) / Ntot

    def m12(Cx):
        return lib.meff_cosh(Cx[1], Cx[2], 1, T), lib.meff_cosh(Cx[2], Cx[3], 2, T)

    bm = sum(b.sum(axis=0) for b in ser["b"]) / Ntot
    g = m12(am - np.mean(bm ** 2))
    sw = sum(b.shape[0] * np.mean(b.mean(axis=0) ** 2) for b in ser["b"]) / Ntot
    s = m12(am - sw)
    cw = 0.0
    for b in ser["b"]:
        ed = np.linspace(0, b.shape[0], 9).astype(int)
        for c in range(8):
            cw += (ed[c + 1] - ed[c]) * np.mean(b[ed[c]:ed[c + 1]].mean(axis=0) ** 2)
    cw /= Ntot
    c8 = m12(am - cw)
    # expected (pure noise) value of the extra subtracted constant for chunk-wise subtraction
    nchunk = Ntot / (8 * len(ser["b"]))
    exp_cw = 2.0 * max(tw["auto"][0], 0.5) * tw["var"] / nchunk
    res["subtraction_variants"] = {
        "global": g, "streamwise": s, "chunkwise8": c8,
        "const_streamwise_minus_global": float(sw - np.mean(bm ** 2)),
        "const_chunkwise_minus_global": float(cw - np.mean(bm ** 2)),
        "expected_chunkwise_minus_global_from_noise": float(exp_cw * (1 - 1.0 / (8 * len(ser["b"])))),
        "expected_streamwise_minus_global_from_noise": float(
            2.0 * max(tw["auto"][0], 0.5) * tw["var"] / (Ntot / len(ser["b"])) * (1 - 1.0 / len(ser["b"]))),
        "C1": float(C[1]), "C2": float(C[2]), "C3": float(C[3])}
    return res


def show(r):
    print("=" * 100)
    print("%s  T=%d  bins=%d (B=%d)" % (r["ensemble"], r["T"], r["n_bins"], r["B"]))
    print("  C(t)/err, t=0..T/2: " + " ".join("%.1f" % x for x in r["C_over_err"]))
    z = r["z_C(t)-C(t+1)"]
    print("  z[C(t) - C(t+1) > 0]: t=1 %.1f, t=2 %.1f, t=3 %.1f   (constant / zero-mass correlator: 0)" % (z[1], z[2], z[3]))
    print("  m_eff(1) %s (m/err %.0f)   m_eff(2) %s (m/err %.0f)" % (
        lib.fmt(r["m1"], r["m1_err"]), r["m1"] / r["m1_err"], lib.fmt(r["m2"], r["m2_err"]), r["m2"] / r["m2_err"]))
    print("  constant-insensitive m_D(1) %s (m/err %.0f), m_D(2) %s ; m_D(1) - m_eff(1) = %s (%.1f sigma)" % (
        lib.fmt(r["mD1"], r["mD1_err"]), r["mD1"] / r["mD1_err"], lib.fmt(r["mD2"], r["mD2_err"]),
        lib.fmt(r["mD1_minus_m1"], r["mD1_minus_m1_err"]), r["mD1_minus_m1"] / r["mD1_minus_m1_err"]))
    if "const" in r:
        print("  far-time constant (mean of C(t), t >= %d, C(0) = 1): %+.2e +- %.2e (%.1f sigma); implied shift of m_eff(1): %+.4f [2-sigma range %+.4f .. %+.4f]; m_eff(2): %+.4f [%+.4f .. %+.4f]"
              % (r["t_far"], r["const"], r["const_err"], r["const"] / r["const_err"],
                 r["shift_m1_if_const"][0], r["shift_m1_if_const"][2], r["shift_m1_if_const"][1],
                 r["shift_m2_if_const"][0], r["shift_m2_if_const"][2], r["shift_m2_if_const"][1]))
    sb = r["subtraction_bias_over_C"]; sb2 = r["subtraction_bias_over_C_tauW200"]
    print("  <P>^2 / C(0) = %.3g ; finite-sample subtraction bias Var(mean)/C(t): t=1 %.1e, t=2 %.1e, t=3 %.1e (tau at W=200: %.1e, %.1e, %.1e)"
          % (r["vev2_over_C0"], sb[1], sb[2], sb[3], sb2[1], sb2[2], sb2[3]))
    sv = r["subtraction_variants"]
    print("  subtraction: global m1 %.4f m2 %.4f | stream-wise %.4f %.4f | chunk-wise(8/stream) %.4f %.4f"
          % (sv["global"][0], sv["global"][1], sv["streamwise"][0], sv["streamwise"][1], sv["chunkwise8"][0], sv["chunkwise8"][1]))
    print("     extra constant removed: stream-wise %.2e (noise expectation %.2e), chunk-wise %.2e (noise expectation %.2e); C(2) = %.3e, C(3) = %.3e"
          % (sv["const_streamwise_minus_global"], sv["expected_streamwise_minus_global_from_noise"],
             sv["const_chunkwise_minus_global"], sv["expected_chunkwise_minus_global_from_noise"], sv["C2"], sv["C3"]))
    print("  power law C~t^-p predicts m_eff(2)/m_eff(1) = %.3f; measured %s; m2 - %.3f m1 = %s (%.1f sigma)"
          % (R_POW, lib.fmt(r["m2_over_m1"], r["m2_over_m1_err"]), R_POW,
             lib.fmt(r["powerlaw_stat"], r["powerlaw_stat_err"]), r["powerlaw_stat"] / r["powerlaw_stat_err"]))


if __name__ == "__main__":
    allr = {}
    for n in sys.argv[1:]:
        r = analyse(n)
        allr[n] = r
        show(r)
    json.dump(allr, open(os.path.join(OUT, "a6_zero_mass.json"), "w"), indent=1, default=float)
