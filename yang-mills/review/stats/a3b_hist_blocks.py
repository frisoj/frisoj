import json, math, sys, os
import numpy as np
import lib
def run(histfile, prodfile, edges):
    h = dict(np.load(histfile, allow_pickle=False)); p = dict(np.load(os.path.join(lib.RAW, prodfile), allow_pickle=False))
    mh = json.loads(str(h["meta"])); sh = mh["nskip"]
    nh = h["plaq"].size; upd = sh * (np.arange(nh) + 1); K = p["glue"].shape[1]
    # tau_int (in production measurement units) -> convert to history spacing
    sp = json.loads(str(p["meta"]))["nskip"]
    obs = {
     "plaquette": (h["plaq"], p["plaq"]),
     "glue vev least smeared 1x1": (h["glue"][:, 0].mean(axis=1), p["glue"][:, 0].mean(axis=1)),
     "glue vev most smeared 2x2": (h["glue"][:, K-1].mean(axis=1), p["glue"][:, K-1].mean(axis=1)),
     "glue most sm. 2x2 var over t": (h["glue"][:, K-1].var(axis=1), p["glue"][:, K-1].var(axis=1)),
     "glue most sm. 2x2 lag-1 product": ((h["glue"][:, K-1]*np.roll(h["glue"][:, K-1],1,axis=1)).mean(axis=1)-h["glue"][:, K-1].mean(axis=1)**2,
                                         (p["glue"][:, K-1]*np.roll(p["glue"][:, K-1],1,axis=1)).mean(axis=1)-p["glue"][:, K-1].mean(axis=1)**2),
     "torelon |Phi|^2 most smeared": ((h["torelon"][:, :, -1, :]**2).mean(axis=(1,2)), (p["torelon"][:, :, -1, :]**2).mean(axis=(1,2))),
     "torelon signed mean dir1": (h["torelon"][:, 0, -1, :].mean(axis=1), p["torelon"][:, 0, -1, :].mean(axis=1)),
    }
    print("%s  start=%s seed=%d; block means in units of the error of a block mean (equilibrium mean, sd and tau_int from the production stream)" % (prodfile, mh["start"], mh["seed"]))
    print("   %-32s" % "updates:" + " ".join("%9s" % ("%d-%d" % (a, b)) for a, b in zip(edges[:-1], edges[1:])))
    for name, (x, ref) in obs.items():
        mu, sd = ref.mean(), ref.std(ddof=1)
        tw = lib.tau_windows([ref], [10], maxlag=200)
        tau_upd = max(tw["auto"][0], 0.5) * sp               # in compound updates
        tau_h = max(tau_upd / sh, 0.5)                        # in history-measurement units
        line = "   %-32s" % name
        for a, b in zip(edges[:-1], edges[1:]):
            m = (upd > a) & (upd <= b); n = int(m.sum())
            line += " %+9.1f" % ((x[m].mean() - mu) / (sd * math.sqrt(2 * tau_h / n)))
        print(line + "   (tau_int %.1f updates)" % tau_upd)
if __name__ == "__main__":
    edges = [int(x) for x in sys.argv[1].split(",")]
    for a in sys.argv[2:]:
        hf, pf = a.split(":"); run(hf, pf, edges)
