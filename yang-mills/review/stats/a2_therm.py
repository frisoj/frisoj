"""Point 2: thermalisation.  Early windows of every stream against the second half of the same
stream, for the plaquette, smeared glueball operators (time-slice averages = vev pieces),
the correlator estimators of the projected glueball operator, torelon |Phi|^2-type estimators
and the signed torelon mean.
z = (mean of first w measurements - mean of second half) / error, error from the stream's own
tau_int (Sokal window c=5) and variance.  Pooled over streams: sum z / sqrt(n).
Usage: python3 a2_therm.py <ensemble> [...]
"""
import json
import math
import os
import sys

import numpy as np

import lib

OUT = os.path.join(lib.HERE, "out")
os.makedirs(OUT, exist_ok=True)
WINS = [20, 50, 100, 200, 400]


def early_z(x, w):
    """z of the first w entries against the second half; errors with tau_int of the stream."""
    n = x.size
    ref = x[n // 2:]
    tw = lib.tau_windows([x], [10], maxlag=min(n // 4, 400))
    tau = max(tw["auto"][0], 0.5)
    var = tw["var"]
    e1 = math.sqrt(2.0 * tau * var / w)
    e2 = math.sqrt(2.0 * tau * var / ref.size)
    return (x[:w].mean() - ref.mean()) / math.hypot(e1, e2)


def run(name):
    st = lib.load(name)
    g = lib.channel_series(name, "glue")
    t = lib.channel_series(name, "torelon")
    lg1, _, _ = lib.lin_series(g, True, 1)
    lg2, _, _ = lib.lin_series(g, True, 2)
    lt1, _, _ = lib.lin_series(t, False, 1)
    K = st[0]["glue"].shape[1]
    series = {}
    series["plaquette"] = [s["plaq"] for s in st]
    series["glue vev, least smeared 1x1"] = [s["glue"][:, 0, :].mean(axis=1) for s in st]
    series["glue vev, most smeared 1x1"] = [s["glue"][:, K - 2, :].mean(axis=1) for s in st]
    series["glue vev, most smeared 2x2"] = [s["glue"][:, K - 1, :].mean(axis=1) for s in st]
    series["glue projected: b"] = [b[:, 0] for b in g["b"]]
    series["glue projected: a(0)"] = [a[:, 0] for a in g["a"]]
    series["glue projected: a(1)"] = [a[:, 1] for a in g["a"]]
    series["glue projected: a(2)"] = [a[:, 2] for a in g["a"]]
    series["glue m_eff(1) linearised"] = lg1
    series["glue m_eff(2) linearised"] = lg2
    series["torelon projected: a(0)"] = [a[:, 0] for a in t["a"]]
    series["torelon projected: a(1)"] = [a[:, 1] for a in t["a"]]
    series["torelon E_eff(1) linearised"] = lt1
    series["torelon signed mean (dir 1, most smeared)"] = [s["torelon"][:, 0, -1, :].mean(axis=1) for s in st]
    starts = [s["meta"]["start"] for s in st]
    res = {"ensemble": name, "starts": starts, "n": [int(s["plaq"].size) for s in st], "z": {}}
    for k, xs in series.items():
        res["z"][k] = {}
        for w in WINS:
            if min(x.size for x in xs) < 4 * w:
                continue
            z = [early_z(x, w) for x in xs]
            res["z"][k][w] = z
    # signed torelon: mean of the first w against ZERO (cold start begins at Phi = +max)
    res["torelon_signed_first"] = {}
    for w in WINS:
        zz = []
        for s in st:
            for d in range(s["torelon"].shape[1]):
                x = s["torelon"][:, d, -1, :].mean(axis=1)
                tw = lib.tau_windows([x], [10], maxlag=min(x.size // 4, 400))
                e = math.sqrt(2.0 * max(tw["auto"][0], 0.5) * tw["var"] / w)
                zz.append(x[:w].mean() / e)
        res["torelon_signed_first"][w] = zz
    with open(os.path.join(OUT, "a2_%s.json" % name), "w") as f:
        json.dump(res, f, indent=1)
    return res


def show(res):
    print("=" * 100)
    print(res["ensemble"], "starts:", res["starts"], "n:", res["n"])
    starts = res["starts"]
    hot = [i for i, s in enumerate(starts) if s == "hot"]
    cold = [i for i, s in enumerate(starts) if s == "cold"]
    for k, d in res["z"].items():
        line = "  %-42s" % k
        for w, z in d.items():
            z = np.array(z)
            line += " | w=%d: hot %+.1f cold %+.1f all %+.1f" % (
                w, z[hot].sum() / math.sqrt(len(hot)), z[cold].sum() / math.sqrt(len(cold)),
                z.sum() / math.sqrt(z.size))
        print(line)
    for w, zz in res["torelon_signed_first"].items():
        zz = np.array(zz)
        print("  torelon signed mean of first %d vs 0: max |z| %.1f, chi2 %.1f / %d" % (
            w, np.abs(zz).max(), np.sum(zz ** 2), zz.size))


if __name__ == "__main__":
    for n in sys.argv[1:]:
        show(run(n))
        sys.stdout.flush()
