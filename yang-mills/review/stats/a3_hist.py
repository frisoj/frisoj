"""Thermalisation history of PRODUCTION streams, re-generated from update 0 with the same seed
(ntherm=0; measurements every nskip_h updates).  (a) bit-identity with the stored production
measurements where the update counts coincide; (b) how fast the smeared operators and torelons
reach their equilibrium values (equilibrium mean/sd taken from the production stream itself)."""
import json, math, sys, os
import numpy as np
import lib

def run(histfile, prodfile, label):
    h = dict(np.load(histfile, allow_pickle=False))
    p = dict(np.load(os.path.join(lib.RAW, prodfile), allow_pickle=False))
    mh = json.loads(str(h["meta"])); mp = json.loads(str(p["meta"]))
    for k in ("shape", "beta", "seed", "start", "nhb", "nor", "levels", "w", "loops"):
        assert mh[k] == mp[k], k
    sh, sp, nth = mh["nskip"], mp["nskip"], mp["ntherm"]
    nh = h["plaq"].size
    upd_h = sh * (np.arange(nh) + 1)              # number of compound updates before hist meas j
    # production measurement k (1-based) is after nth + sp*k updates
    same = []
    for j, u in enumerate(upd_h):
        if u > nth and (u - nth) % sp == 0:
            k = (u - nth) // sp - 1
            if k < p["plaq"].size:
                same.append((j, k))
    nbit = 0; maxdiff = 0.0
    for j, k in same:
        ok = (np.array_equal(h["glue"][j], p["glue"][k]) and np.array_equal(h["torelon"][j], p["torelon"][k])
              and h["plaq"][j] == p["plaq"][k])
        nbit += ok
        maxdiff = max(maxdiff, float(np.max(np.abs(h["glue"][j] - p["glue"][k]))))
    print("%s (%s start, seed %d): %d history measurements; %d coincide in update count with stored "
          "production measurements; bit-identical: %d of %d (max |diff| glue %.3g)"
          % (label, mh["start"], mh["seed"], nh, len(same), nbit, len(same), maxdiff))
    # equilibrium reference from the production stream (all of it)
    obs = {}
    K = p["glue"].shape[1]
    obs["plaquette"] = (h["plaq"], p["plaq"])
    obs["glue vev least smeared 1x1"] = (h["glue"][:, 0].mean(axis=1), p["glue"][:, 0].mean(axis=1))
    obs["glue vev most smeared 1x1"] = (h["glue"][:, K - 2].mean(axis=1), p["glue"][:, K - 2].mean(axis=1))
    obs["glue vev most smeared 2x2"] = (h["glue"][:, K - 1].mean(axis=1), p["glue"][:, K - 1].mean(axis=1))
    th = (h["torelon"][:, :, -1, :] ** 2).mean(axis=(1, 2)); tp = (p["torelon"][:, :, -1, :] ** 2).mean(axis=(1, 2))
    obs["torelon |Phi|^2 most smeared"] = (th, tp)
    th = h["torelon"][:, :, -1, :].mean(axis=(1, 2)); tp = p["torelon"][:, :, -1, :].mean(axis=(1, 2))
    obs["torelon signed mean most smeared"] = (th, tp)
    # fluctuation part of the most smeared operator: time-slice variance (connected C(0)-like)
    gh = h["glue"][:, K - 1]; gp = p["glue"][:, K - 1]
    obs["glue most smeared 2x2: var over t"] = (gh.var(axis=1), gp.var(axis=1))
    res = {}
    for name, (x, ref) in obs.items():
        mu, sd = ref.mean(), ref.std(ddof=1)
        z = (x - mu) / sd
        inside = np.abs(z) < 3.0
        # first update count after which the history never leaves +-3 sd (within the therm phase)
        pre = upd_h <= nth
        bad = np.nonzero(~inside & pre)[0]
        first_ok = int(upd_h[bad[-1] + 1]) if bad.size and bad[-1] + 1 < nh else (int(upd_h[0]) if not bad.size else None)
        def win(lo, hi):
            m = (upd_h > lo) & (upd_h <= hi)
            n = int(m.sum())
            # error of the window mean: sd * sqrt(2 tau / n_eff); tau in units of hist spacing ~ 0.5 (spacing >= 5 updates)
            return float(z[m].mean() * math.sqrt(n)) if n else float("nan"), n
        w1 = win(200, 500); w2 = win(500, 1000)
        res[name] = (float(z[0]), first_ok, w1, w2)
        print("   %-34s first z %+9.1f | last excursion >3 sd during therm ends at update %s | mean z*sqrt(n): updates 200-500: %+.2f (n=%d), 500-1000: %+.2f (n=%d)"
              % (name, z[0], first_ok, w1[0], w1[1], w2[0], w2[1]))
    return res

if __name__ == "__main__":
    for a in sys.argv[1:]:
        hf, pf, lab = a.split(":")
        run(hf, pf, lab)
