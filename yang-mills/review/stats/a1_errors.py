"""Point 1: are the quoted errors right?  Own tau_int / Gamma-method errors of the linearised
m_eff(t) estimators, long-window scan for slow modes, chunk-scatter test.
Usage: python3 a1_errors.py <ensemble> [...]   -> out/a1_<ensemble>.json + printed table
"""
import json
import math
import os
import sys

import numpy as np
from scipy import stats as sps

import lib

OUT = os.path.join(lib.HERE, "out")
os.makedirs(OUT, exist_ok=True)
WIN = [5, 10, 20, 50, 100, 200, 400]


def gamma_err(series, windows=WIN):
    tw = lib.tau_windows(series, windows)
    N, var = tw["N"], tw["var"]
    out = {"N": N, "tau_auto": tw["auto"][0], "dtau_auto": tw["auto"][1], "W_auto": tw["auto"][2],
           "err_auto": math.sqrt(2.0 * max(tw["auto"][0], 1e-9) * var / N),
           "err_naive": math.sqrt(var / N), "fixed": {}}
    for w, (t, dt) in tw["fixed"].items():
        out["fixed"][w] = {"tau": t, "dtau": dt,
                           "err": math.sqrt(2.0 * max(t, 1e-9) * var / N)}
    return out


def chunk_test(ls, nch, e_pipe):
    """Scatter of the means of nch consecutive chunks per stream of the LINEARISED estimator
    (no bias, never undefined).  err_scatter = sd / sqrt(n); R = err_scatter / pipeline error;
    p = P(chi2_{n-1} >= (n-1) R^2) = probability of a scatter this large if the quoted error
    is right."""
    v = []
    for s in ls:
        edges = np.linspace(0, s.size, nch + 1).astype(int)
        v += [s[edges[c]:edges[c + 1]].mean() for c in range(nch)]
    v = np.array(v)
    n = v.size
    es = v.std(ddof=1) / math.sqrt(n)
    R = es / e_pipe
    return {"n": int(n), "err_scatter": float(es), "relunc": 1.0 / math.sqrt(2.0 * (n - 1)),
            "R": float(R), "p_upper": float(sps.chi2.sf((n - 1) * R * R, n - 1)),
            "p_lower": float(sps.chi2.cdf((n - 1) * R * R, n - 1))}


def run(name):
    P = lib.pipeline(name)
    B = int(P["binsize"])
    res = {"ensemble": name, "binsize": B, "n_bins_pipeline": P["n_bins"]}
    for ch, key, sub in (("glue", "glueball", True), ("torelon", "torelon", False)):
        ser = lib.channel_series(name, ch)
        T = ser["T"]
        m, e, _, nb = lib.binned_meff(ser, B, sub, tmax=3)
        pm = [P[key]["meff_table"][t]["m_cosh"] for t in range(4)]
        pe = [P[key]["meff_table"][t]["err_cosh"] for t in range(4)]
        r = {"T": T, "sel": [int(x) for x in ser["sel"]], "n_bins": nb,
             "mine_fixed_vector": {"m": m.tolist(), "err": e.tolist()},
             "pipeline": {"m": pm, "err": pe}}
        # error versus bin size (fixed vector), up to 64 B as long as >= 12 bins
        scan = {}
        k = 1
        while True:
            mm, ee, _, nbb = lib.binned_meff(ser, B * k, sub, tmax=2)
            if nbb < 12:
                break
            scan[k] = {"n_bins": nbb, "m1": float(mm[1]), "e1": float(ee[1]), "m2": float(mm[2]),
                       "e2": float(ee[2])}
            k *= 2
        r["bin_scan"] = scan
        # Gamma method on the linearised estimator
        for t in (1, 2):
            ls, mlog, C = lib.lin_series(ser, sub, t)
            g = gamma_err(ls)
            g["m_log"] = mlog
            r["gamma_t%d" % t] = g
        # raw ingredients: time-slice average b, a(0), a(1), a(2)
        N = sum(a.shape[0] for a in ser["a"])
        ing = {}
        ing["b (time-slice average)"] = gamma_err([b[:, 0] for b in ser["b"]])
        for tau in (0, 1, 2):
            ing["a(%d)" % tau] = gamma_err([a[:, tau] for a in ser["a"]])
        r["ingredients"] = {k: {"tau_auto": v["tau_auto"], "dtau": v["dtau_auto"], "W": v["W_auto"],
                                "tau_fixed": {w: x["tau"] for w, x in v["fixed"].items()}}
                            for k, v in ing.items()}
        for t in (1, 2):
            ls, _, _ = lib.lin_series(ser, sub, t)
            for nch in (4, 8):
                r["chunks_%d_t%d" % (nch, t)] = chunk_test(ls, nch, pe[t])
        res[ch] = r
        if ch == "glue":
            plaq = ser["plaq"]
    res["plaquette"] = gamma_err(plaq)
    res["plaquette"]["pipeline_err"] = P["plaquette"]["err"]
    res["plaquette"]["mean"] = float(np.concatenate(plaq).mean())
    with open(os.path.join(OUT, "a1_%s.json" % name), "w") as f:
        json.dump(res, f, indent=1)
    return res


def show(res):
    name = res["ensemble"]
    print("=" * 110)
    print("%s  B=%d  bins=%d" % (name, res["binsize"], res["n_bins_pipeline"]))
    for ch in ("glue", "torelon"):
        r = res[ch]
        print(" [%s] sel=%s" % (ch, r["sel"]))
        for t in (1, 2):
            mm, me = r["mine_fixed_vector"]["m"][t], r["mine_fixed_vector"]["err"][t]
            pm, pe = r["pipeline"]["m"][t], r["pipeline"]["err"][t]
            g = r["gamma_t%d" % t]
            fx = "  ".join("W%d:%.2f" % (w, x["err"] / pe) for w, x in g["fixed"].items())
            print("   m_eff(%d): pipeline %s | mine(fixed v) %s | Gamma: tau=%.2f(%.2f) W=%d err/pipe=%.3f | err(W)/pipe: %s"
                  % (t, lib.fmt(pm, pe), lib.fmt(mm, me), g["tau_auto"], g["dtau_auto"], g["W_auto"],
                     g["err_auto"] / pe, fx))
        sc = r["bin_scan"]
        print("   bin scan e1/e1(B), e2/e2(B) [bins]: " + "  ".join(
            "%dx:%.2f,%.2f[%d]" % (k, v["e1"] / sc[1]["e1"], v["e2"] / sc[1]["e2"], v["n_bins"])
            for k, v in sc.items()))
        print("   tau_int ingredients: " + "; ".join(
            "%s %.2f(%.2f) [W50 %.2f, W200 %s]" % (k, v["tau_auto"], v["dtau"],
                                                    v["tau_fixed"].get(50, float("nan")),
                                                    ("%.2f" % v["tau_fixed"][200]) if 200 in v["tau_fixed"] else "-")
            for k, v in r["ingredients"].items()))
        for t in (1, 2):
            print("   chunk scatter m_eff(%d): " % t + "; ".join(
                "%d/stream (n=%d): err %.2f(+-%.2f) x pipeline, p_up=%.3f"
                % (nch, c["n"], c["R"], c["R"] * c["relunc"], c["p_upper"])
                for nch, c in ((4, r["chunks_4_t%d" % t]), (8, r["chunks_8_t%d" % t]))))
    p = res["plaquette"]
    print(" [plaquette] %.7f  tau=%.2f(%.2f) W=%d  Gamma err %.2e  pipeline %.2e  ratio %.3f | err(W)/pipe %s"
          % (p["mean"], p["tau_auto"], p["dtau_auto"], p["W_auto"], p["err_auto"], p["pipeline_err"],
             p["err_auto"] / p["pipeline_err"],
             "  ".join("W%d:%.2f" % (w, x["err"] / p["pipeline_err"]) for w, x in p["fixed"].items())))


if __name__ == "__main__":
    for n in sys.argv[1:]:
        show(run(n))
        sys.stdout.flush()
