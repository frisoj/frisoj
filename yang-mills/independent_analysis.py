#!/usr/bin/env python3
"""Independent re-analysis of the raw production data (results/raw/*.npz).

Purpose: catch errors in the pipeline analysis (analyze.py + ym/stats.py) by redoing the
analysis with separately written code and, where reasonable, different numerical choices.
This file does NOT import ym.stats or analyze.py and shares no code with them.  It reads

  * the raw files (format: docstring of run_production.py),
  * the pipeline JSON results/<name>.json, ONLY to (a) take over the pipeline bin size so that
    the comparison is like for like and (b) compare numbers at the end.

What is done differently from the pipeline
------------------------------------------
  errors            bootstrap over bins (multinomial resampling of the pooled bins, default 2000
                    samples) as the primary error; a delete-one-bin jackknife is computed too
  vacuum subtraction a CONSTANT (the global mean of every operator) is subtracted from the
                    glueball operators before any product is formed (kills the 10^8 : 1
                    cancellation); the sample-dependent remainder <O_k><O_l> is subtracted
                    inside every bootstrap / jackknife sample
  GEVP              scipy.linalg.eigh(C(1), C(0)) (generalised symmetric-definite solver);
                    four variants are evaluated side by side:
                      gevp      operator subset chosen by rule R2 as DESCRIBED in the docstring
                                of ym/stats.py (re-implemented here), GEVP re-solved per sample
                      fixedvec  the same subset, eigenvector frozen at its full-sample value
                                (a fixed operator: no per-sample optimisation)
                      pruned    the FULL operator basis projected on the eigenmodes of the
                                normalised C(0) with eigenvalue >= 0.01, GEVP re-solved per sample
                      single    the single operator with the largest C(1)/C(0); no GEVP at all
  effective mass    own vectorised bisection for
                        C(t)/C(t+1) = cosh(m (t - T/2)) / cosh(m (t + 1 - T/2))
                    on the bracket [ln r, ln r + ln 2] (which always contains the root)
  autocorrelation   pooled FFT autocovariance about the global mean, Sokal window with c = 5
                    (pipeline: c = 6), plus a binning estimate  tau = B var(bin means) / (2 var)
  string tension    closed forms derived here (see sigma_nambu_goto / sigma_luscher) and checked
                    against a numerical inversion of E(sigma)

Conventions: "m_eff(t)" uses C(t) and C(t+1), as in the pipeline.  All numbers are in lattice
units.  The connected glueball correlator is

    C_kl(tau) = (1/T) sum_t <O_k(t) O_l(t+tau)> - <O_k><O_l>,

symmetrised in (k, l); because the time sum is periodic, C_kl(T - tau) = C_lk(tau) exactly, so
the (k, l) symmetrisation already contains the time reflection.  The torelon correlator is
averaged over the spatial directions and is NOT vacuum subtracted (centre symmetry).

What is written to results/independent/<name>.json
---------------------------------------------------
  plaquette, autocorrelation      mean, errors, tau_int of the plaquette and of every operator
  glueball, torelon               per variant: m_eff(t), t = 0..3, C(t)/C(0), m_eff(1) - m_eff(2)
  string_tension, ratios          a sqrt(sigma) (Luscher, Nambu-Goto) and m / sqrt(sigma) at fixed t
  correlator_significance         C(t) / error, t = 1..4
  r5_recheck                      plateau rule R5 re-implemented from its description
  comparison_with_pipeline        (a) every fixed-t number of results/<name>.json against mine
  bin_scan                        (b) the same analysis with bins of 1, 2, 4, 8 (16, 32) x the bin size
  thermalisation_cuts             (c) first 10 % / 25 % of every stream discarded
  time_history, early_vs_late     (c) consecutive chunks of the streams; first 10 % against the rest
  stream_consistency(_vs_binsize) (d) every stream alone, chi2 about the mean
  hot_vs_cold, set_comparison     (d) hot against cold starts; the two sets of a combined ensemble
  cross_stream_correlation        (d) are the streams independent at equal Monte Carlo time?
  flags                           mechanical flags (thresholds in make_flags); prompts, not verdicts
Operator choices (R2 subset, frozen vector, best single operator, pruned basis) are made once on
the full sample at the pipeline bin size and kept fixed in all sub-analyses of that ensemble.

Usage
-----
    python3 independent_analysis.py d3_b9.0_L24            # one ensemble -> results/independent/
    python3 independent_analysis.py --all --jobs 4         # all twelve (about 1.5 minutes on 4 cores)
    python3 independent_analysis.py --table                # (re)write results/independent/COMPARISON.md
    python3 independent_analysis.py --selftest             # synthetic data with a known answer
The raw files are only read.  Results are reproducible bit for bit (fixed bootstrap seed).

Everything produced here is numerical evidence about a lattice model at finite lattice spacing
and finite volume, with statistical errors, from variational (upper) estimates.  It is NOT a
proof of the Yang-Mills mass gap and must never be presented as one.
"""
from __future__ import annotations

import argparse
import datetime
import json
import math
import os
import sys
import time
import zlib

os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
os.environ.setdefault("MKL_NUM_THREADS", "1")

import numpy as np  # noqa: E402
import scipy.linalg as sla  # noqa: E402
from scipy.stats import chi2 as chi2_dist  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))

DISCLAIMER = ("Numerical evidence at finite lattice spacing and finite volume, statistical errors "
              "only, variational (upper) estimates. NOT a proof of the Yang-Mills mass gap.")

#: ensemble name -> list of (file prefix, seeds).  Written down from the task description, not
#: taken from the pipeline output; the file list is compared with the pipeline JSON later.
ENSEMBLES = {
    "d3_b6.0_L16": [("d3_b6.0_L16", (101, 102, 103, 104))],
    "d3_b6.0_L24": [("d3_b6.0_L24", (801, 802, 803, 804))],
    "d3_b9.0_L24": [("d3_b9.0_L24", (301, 302, 303, 304))],
    "d3_b9.0_L24r": [("d3_b9.0_L24r", (305, 306, 307, 308))],
    "d3_b9.0_L24_combined": [("d3_b9.0_L24", (301, 302, 303, 304)),
                             ("d3_b9.0_L24r", (305, 306, 307, 308))],
    "d3_b12.0_L32": [("d3_b12.0_L32", (501, 502, 503, 504))],
    "d4_b2.3_L10": [("d4_b2.3_L10", (201, 202, 203, 204))],
    "d4_b2.4_L12": [("d4_b2.4_L12", (401, 402, 403, 404))],
    "d4_b2.4_L16": [("d4_b2.4_L16", (701, 702, 703, 704))],
    "d4_b2.5_L16": [("d4_b2.5_L16", (601, 602, 603, 604))],
    "d4_b2.5_L16x": [("d4_b2.5_L16x", (605, 606, 607, 608))],
    "d4_b2.5_L16_combined": [("d4_b2.5_L16", (601, 602, 603, 604)),
                             ("d4_b2.5_L16x", (605, 606, 607, 608))],
}
ORDER = list(ENSEMBLES)

VARIANTS = ("gevp", "fixedvec", "pruned", "single")
MIN_EIG = 0.01          # rule R2 threshold (from the docstring of ym/stats.py)
PRUNE_CUT = 0.01        # eigenvalue cut of the 'pruned' variant
SOKAL_C = 5.0
NT_C = 6                # correlator values C(0..5) are stored
BIN_FACTORS = (1, 2, 4, 8, 16, 32)   # 16x, 32x go beyond what was asked; they show whether a growth continues
MIN_BINS = 20
THERM_CUTS = (0.10, 0.25)


# ==============================================================================================
# elementary numerics
# ==============================================================================================
def lncosh(x):
    """ln cosh(x), stable for large |x|."""
    ax = np.abs(x)
    return ax + np.log1p(np.exp(-2.0 * ax)) - math.log(2.0)


def cosh_meff(c0, c1, t, T, n_iter=64):
    """Solve  c0 / c1 = cosh(m (t - T/2)) / cosh(m (t + 1 - T/2))  for m > 0 by bisection.

    c0 = C(t), c1 = C(t+1) (arrays).  With a = T/2 - t >= 1 the function
    g(m) = lncosh(a m) - lncosh((a - 1) m) is increasing, g(m) <= m and g(m) >= m - ln 2, so
    the root lies in [ln r, ln r + ln 2], r = c0 / c1.  NaN where c0 <= 0, c1 <= 0 or c0 <= c1.
    """
    c0 = np.asarray(c0, dtype=float)
    c1 = np.asarray(c1, dtype=float)
    out = np.full(c0.shape, np.nan)
    a = 0.5 * T - t
    if a < 1.0:
        return out
    with np.errstate(invalid="ignore", divide="ignore"):
        ok = np.isfinite(c0) & np.isfinite(c1) & (c0 > 0) & (c1 > 0) & (c0 > c1)
    if not np.any(ok):
        return out
    target = np.log(c0[ok] / c1[ok])
    lo = target.copy()
    hi = target + math.log(2.0)
    for _ in range(n_iter):
        mid = 0.5 * (lo + hi)
        g = lncosh(a * mid) - lncosh((a - 1.0) * mid) - target
        up = g > 0
        hi = np.where(up, mid, hi)
        lo = np.where(up, lo, mid)
    out[ok] = 0.5 * (lo + hi)
    return out


def string_c(D):
    """c = pi (D - 2) / 3: the coefficient of the universal (Luscher) correction."""
    return math.pi * (D - 2) / 3.0


def sigma_luscher(E, L, D):
    """Effective string theory to first order: E = sigma L - pi (D-2) / (6 L)."""
    return (E + 0.5 * string_c(D) / L) / L


def sigma_nambu_goto(E, L, D):
    """Closed Nambu-Goto string of length L (winding 1, no excitations):
        E^2 = (sigma L)^2 - (pi (D-2) / 3) sigma
    i.e. L^2 sigma^2 - c sigma - E^2 = 0, positive root sigma = [c + sqrt(c^2 + 4 L^2 E^2)] / (2 L^2).
    Expanding E = sigma L sqrt(1 - c / (sigma L^2)) = sigma L - c / (2 L) - ... gives Luscher."""
    c = string_c(D)
    return (c + np.sqrt(c * c + 4.0 * L * L * np.asarray(E, dtype=float) ** 2)) / (2.0 * L * L)


def energy_nambu_goto(sigma, L, D):
    arg = 1.0 - string_c(D) / (sigma * L * L)
    return sigma * L * math.sqrt(arg) if arg > 0 else float("nan")


def sigma_nambu_goto_numeric(E, L, D):
    """Numerical inversion of energy_nambu_goto by bisection (cross-check of the closed form)."""
    lo = string_c(D) / (L * L) * (1.0 + 1e-14)   # E = 0 at this sigma
    hi = max(2.0 * lo, 1.0)
    while energy_nambu_goto(hi, L, D) < E:
        hi *= 2.0
    for _ in range(200):
        mid = 0.5 * (lo + hi)
        if energy_nambu_goto(mid, L, D) < E:
            lo = mid
        else:
            hi = mid
    return 0.5 * (lo + hi)


def autocov_pooled(series_list, max_lag):
    """Pooled autocovariance Gamma(0..max_lag-1) of several independent series about their
    common (global) mean, via FFT."""
    mu = np.concatenate(series_list).mean()
    num = np.zeros(max_lag)
    den = np.zeros(max_lag)
    for s in series_list:
        x = np.asarray(s, dtype=float) - mu
        n = len(x)
        m = min(max_lag, n)
        nfft = 1 << int(math.ceil(math.log2(2 * n)))
        f = np.fft.rfft(x, nfft)
        ac = np.fft.irfft(f * np.conj(f), nfft)[:m]
        num[:m] += ac
        den[:m] += n - np.arange(m)
    with np.errstate(invalid="ignore", divide="ignore"):
        return num / den


def tau_int_sokal(series_list, c=SOKAL_C):
    """Integrated autocorrelation time, tau = 1/2 + sum_{t=1}^{W} rho(t), with the automatic
    window W = smallest W >= c tau(W).  Returns (tau, error, W); error = tau sqrt(2 (2W+1) / N)."""
    n_tot = sum(len(s) for s in series_list)
    n_min = min(len(s) for s in series_list)
    max_lag = max(2, min(n_min // 2, 5000))
    gam = autocov_pooled(series_list, max_lag)
    if not np.isfinite(gam[0]) or gam[0] <= 0:
        return float("nan"), float("nan"), 0
    rho = gam / gam[0]
    tau = 0.5 + np.cumsum(rho[1:])
    w = np.arange(1, max_lag)
    good = np.nonzero(w >= c * tau)[0]
    i = int(good[0]) if len(good) else len(w) - 1
    t = float(tau[i])
    W = int(w[i])
    return t, abs(t) * math.sqrt(2.0 * (2 * W + 1) / n_tot), W


def tau_int_binning(series_list, B):
    """tau = B var(bin means) / (2 var(single measurements)); bins inside streams, the
    measurements that do not fill a bin are dropped from the start of the stream."""
    allx = np.concatenate(series_list)
    var1 = allx.var(ddof=1)
    means = []
    for s in series_list:
        nb = len(s) // B
        if nb:
            means.append(np.asarray(s[len(s) - nb * B:]).reshape(nb, B).mean(axis=1))
    if not means or var1 <= 0:
        return float("nan"), 0
    mb = np.concatenate(means)
    if len(mb) < 2:
        return float("nan"), len(mb)
    return float(B * mb.var(ddof=1) / (2.0 * var1)), len(mb)


# ==============================================================================================
# raw data -> per-measurement "primary" quantities
# ==============================================================================================
def load_stream(path):
    with np.load(path, allow_pickle=False) as z:
        meta = json.loads(str(z["meta"]))
        d = {"glue": np.array(z["glue"], dtype=float), "tor": np.array(z["torelon"], dtype=float),
             "plaq": np.array(z["plaq"], dtype=float)}
    n = int(meta["nmeas_done"])
    for k in d:
        if d[k].shape[0] != n:
            raise SystemExit("%s: array %s has %d rows, meta says %d" % (path, k, d[k].shape[0], n))
    d["meta"] = meta
    d["file"] = os.path.basename(path)
    return d


def ensemble_paths(name, raw_dir):
    out = []
    for prefix, seeds in ENSEMBLES[name]:
        for s in seeds:
            out.append((prefix, os.path.join(raw_dir, "%s_s%d.npz" % (prefix, s))))
    return out


def primaries(st, off):
    """Per measurement: g1[k] = time-slice average of O_k - off_k;  g2[k,l,tau] = (1/T) sum_t
    (O_k - off_k)(t) (O_l - off_l)(t + tau), symmetrised in (k, l), tau = 0 .. T/2;
    p1[d,a] = time-slice average of the torelon; p2[a,b,tau] = the same product for the
    torelon, averaged over the spatial directions."""
    g = st["glue"] - off[None, :, None]
    n, K, T = g.shape
    nt = T // 2 + 1
    g2 = np.empty((n, K, K, nt))
    for tau in range(nt):
        a = np.matmul(g, np.roll(g, -tau, axis=2).transpose(0, 2, 1)) / T
        g2[..., tau] = 0.5 * (a + a.transpose(0, 2, 1))
    tor = st["tor"]
    nd, A = tor.shape[1], tor.shape[2]
    p2 = np.zeros((n, A, A, nt))
    for tau in range(nt):
        for d in range(nd):
            a = np.matmul(tor[:, d], np.roll(tor[:, d], -tau, axis=2).transpose(0, 2, 1)) / (T * nd)
            p2[..., tau] += 0.5 * (a + a.transpose(0, 2, 1))
    st["g1"] = g.mean(axis=2)
    st["g2"] = g2
    st["p1"] = tor.mean(axis=3)
    st["p2"] = p2


def make_bins(streams, B, discard=0.0, which=None, window=None):
    """Bin means inside each stream.  First drop floor(discard * n) measurements from the start
    (thermalisation cut), then drop the measurements that do not fill a whole bin, also from the
    start.  Bins of all selected streams are pooled.  window = (a, b) restricts every stream to
    its measurements floor(a n) .. floor(b n) - 1 (time-history analysis)."""
    acc = {k: [] for k in ("g1", "g2", "p1", "p2", "plaq")}
    label, n_used, n_drop, n_cut = [], 0, 0, 0
    for i, st in enumerate(streams):
        if which is not None and i not in which:
            continue
        n = len(st["plaq"])
        cut = int(math.floor(discard * n))
        end = n
        if window is not None:
            cut, end = int(math.floor(window[0] * n)), int(math.floor(window[1] * n))
        nb = (end - cut) // B
        start = end - nb * B
        n_cut += cut
        n_drop += start - cut
        n_used += nb * B
        if nb == 0:
            continue
        for k in acc:
            a = st[k][start:end]
            acc[k].append(a.reshape((nb, B) + a.shape[1:]).mean(axis=1))
        label.append(np.full(nb, i))
    if not label:
        return {"n_bins": 0, "n_used": 0, "n_dropped_binning": n_drop, "n_cut": n_cut, "binsize": B}
    out = {k: np.concatenate(v) for k, v in acc.items()}
    out["stream"] = np.concatenate(label)
    out["n_bins"] = int(len(out["plaq"]))
    out["n_used"], out["n_dropped_binning"], out["n_cut"], out["binsize"] = n_used, n_drop, n_cut, B
    return out


# ==============================================================================================
# operator choice (made once on the full sample) and per-sample evaluation
# ==============================================================================================
def channel_config(C, labels):
    """C: full-sample correlator matrix (K, K, nt).  Returns the operator choices."""
    K = C.shape[0]
    d0 = np.array([C[k, k, 0] for k in range(K)])
    d1 = np.array([C[k, k, 1] for k in range(K)])
    valid = [k for k in range(K) if d0[k] > 0 and d1[k] > 0]
    if not valid:
        raise SystemExit("no operator with positive C(0) and C(1)")
    q = np.full(K, -np.inf)
    q[valid] = d1[valid] / d0[valid]
    ranked = sorted(valid, key=lambda k: (-q[k], k))
    scale = np.zeros(K)
    scale[valid] = 1.0 / np.sqrt(d0[valid])
    Ch0 = C[:, :, 0] * scale[:, None] * scale[None, :]
    subset, decisions = [], {}
    for k in ranked:                                   # rule R2 (c)
        trial = subset + [k]
        ev = sla.eigvalsh(Ch0[np.ix_(trial, trial)])
        if ev[0] >= MIN_EIG:
            subset = trial
            decisions[labels[k]] = "accepted (min eig %.4g)" % ev[0]
        else:
            decisions[labels[k]] = "dropped (min eig %.4g)" % ev[0]
    sub = np.ix_(subset, subset)
    Ch1 = C[:, :, 1] * scale[:, None] * scale[None, :]
    w, V = sla.eigh(Ch1[sub], Ch0[sub])
    vfix = V[:, -1].copy()
    if vfix[np.argmax(np.abs(vfix))] < 0:
        vfix = -vfix
    # 'pruned' variant: eigenmodes of the normalised C(0) on ALL valid operators
    vi = np.ix_(valid, valid)
    s, U = sla.eigh(Ch0[vi])
    keep = s >= PRUNE_CUT
    Wp = np.zeros((K, int(keep.sum())))
    Wp[valid, :] = U[:, keep] / np.sqrt(s[keep])[None, :]
    return {"labels": list(labels), "scale": scale, "best": ranked[0], "subset": subset,
            "vfix": vfix, "Wp": Wp, "quality": q, "ranked": ranked, "decisions": decisions,
            "c0_eigenvalues_all": s, "gevp_eigenvalues_full_sample": w[::-1]}


def gevp_batch(Cs):
    """Cs (S, m, m, nt).  For every sample solve C(1) v = lambda C(0) v with scipy.linalg.eigh,
    take the largest lambda and return v^T C(t) v / v^T C(0) v, shape (S, nt)."""
    S, m, _, nt = Cs.shape
    out = np.full((S, nt), np.nan)
    if m == 1:
        with np.errstate(invalid="ignore", divide="ignore"):
            c = Cs[:, 0, 0, :]
            return np.where(c[:, :1] > 0, c / c[:, :1], np.nan)
    for i in range(S):
        A = Cs[i, :, :, 1]
        Bm = Cs[i, :, :, 0]
        if not (np.all(np.isfinite(A)) and np.all(np.isfinite(Bm))):
            continue
        try:
            _, V = sla.eigh(A, Bm, check_finite=False)
        except (sla.LinAlgError, ValueError):
            continue
        v = V[:, -1]
        out[i] = np.einsum("k,klt,l->t", v, Cs[i], v) / (v @ Bm @ v)
    return out


def eval_channel(C, cfg, T, prefix, out):
    """C (S, K, K, nt) -> effective masses etc. for the four variants (written into ``out``)."""
    sc = cfg["scale"]
    Ch = C * sc[None, :, None, None] * sc[None, None, :, None]
    idx = cfg["subset"]
    sub = Ch[:, idx][:, :, idx]
    cs = {"single": C[:, cfg["best"], cfg["best"], :],
          "gevp": gevp_batch(sub),
          "fixedvec": np.einsum("k,sklt,l->st", cfg["vfix"], sub, cfg["vfix"]),
          "pruned": gevp_batch(np.einsum("ka,sklt,lb->sabt", cfg["Wp"], Ch, cfg["Wp"]))}
    nt = C.shape[-1]
    for var, c in cs.items():
        for t in range(min(nt, NT_C)):
            out["%s.%s.C%d" % (prefix, var, t)] = c[:, t]
            if t:
                with np.errstate(invalid="ignore", divide="ignore"):
                    out["%s.%s.R%d" % (prefix, var, t)] = c[:, t] / c[:, 0]
        for t in range(nt - 1):
            out["%s.%s.m%d" % (prefix, var, t)] = cosh_meff(c[:, t], c[:, t + 1], t, T)
        out["%s.%s.d12" % (prefix, var)] = out["%s.%s.m1" % (prefix, var)] - out["%s.%s.m2" % (prefix, var)]


def evaluate(g1, g2, p2, cfg):
    """All derived quantities for a batch of S sample means.  g1 (S, K), g2 (S, K, K, nt),
    p2 (S, A, A, nt).  The vacuum subtraction uses the sample's own <O_k>."""
    T, L, D = cfg["T"], cfg["L"], cfg["D"]
    out = {}
    Cg = g2 - g1[:, :, None, None] * g1[:, None, :, None]
    eval_channel(Cg, cfg["glue"], T, "glue", out)
    eval_channel(p2, cfg["tor"], T, "tor", out)
    with np.errstate(invalid="ignore", divide="ignore"):
        for var in VARIANTS:
            for t in range(4):
                E = out["tor.%s.m%d" % (var, t)]
                out["tor.%s.asL%d" % (var, t)] = np.sqrt(sigma_luscher(E, L, D))
                out["tor.%s.asNG%d" % (var, t)] = np.sqrt(sigma_nambu_goto(E, L, D))
            for t in (1, 2):
                m = out["glue.%s.m%d" % (var, t)]
                out["ratio.%s.NG%d" % (var, t)] = m / out["tor.%s.asNG%d" % (var, t)]
                out["ratio.%s.L%d" % (var, t)] = m / out["tor.%s.asL%d" % (var, t)]
        for tg in range(4):
            for tt in range(4):
                out["ratio.gevp.NGx%d%d" % (tg, tt)] = out["glue.gevp.m%d" % tg] / out["tor.gevp.asNG%d" % tt]
                out["ratio.gevp.Lx%d%d" % (tg, tt)] = out["glue.gevp.m%d" % tg] / out["tor.gevp.asL%d" % tt]
    return out


class Res:
    """Central values, bootstrap samples and jackknife samples of all derived quantities."""

    def __init__(self, bins, cfg, nboot, rng, jack=True):
        N = bins["n_bins"]
        K = bins["g1"].shape[1]
        sg2 = bins["g2"].shape[1:]
        sp2 = bins["p2"].shape[1:]
        X = np.concatenate([bins["g1"].reshape(N, -1), bins["g2"].reshape(N, -1),
                            bins["p2"].reshape(N, -1), bins["plaq"].reshape(N, 1)], axis=1)
        n_g2 = int(np.prod(sg2))
        n_p2 = int(np.prod(sp2))

        def split(Y):
            S = Y.shape[0]
            return (Y[:, :K], Y[:, K:K + n_g2].reshape((S,) + sg2),
                    Y[:, K + n_g2:K + n_g2 + n_p2].reshape((S,) + sp2), Y[:, -1])

        full = X.mean(axis=0)
        self.N = N
        self.nboot = nboot
        g1, g2, p2, pl = split(full[None])
        self.c = evaluate(g1, g2, p2, cfg)
        self.c["plaq"] = pl
        self.b = {}
        chunks = []
        for lo in range(0, nboot, 250):
            n = min(250, nboot - lo)
            w = rng.multinomial(N, np.full(N, 1.0 / N), size=n).astype(float)
            chunks.append(w @ X / N)
        Xb = np.concatenate(chunks)
        g1, g2, p2, pl = split(Xb)
        self.b = evaluate(g1, g2, p2, cfg)
        self.b["plaq"] = pl
        self.j = None
        if jack and N >= 2:
            Xj = (N * full[None, :] - X) / (N - 1.0)
            g1, g2, p2, pl = split(Xj)
            self.j = evaluate(g1, g2, p2, cfg)
            self.j["plaq"] = pl

    def val(self, k):
        return float(self.c[k][0])

    def eb(self, k):
        b = self.b[k]
        b = b[np.isfinite(b)]
        return float(b.std(ddof=1)) if len(b) > 1 else float("nan")

    def n_undef(self, k):
        return int(np.sum(~np.isfinite(self.b[k])))

    def ej(self, k):
        if self.j is None:
            return float("nan")
        j = self.j[k]
        if not np.all(np.isfinite(j)):
            return float("inf")
        return float(math.sqrt((self.N - 1.0) / self.N * np.sum((j - j.mean()) ** 2)))

    def ej_diff(self, k1, k2):
        j = self.j[k1] - self.j[k2]
        if not np.all(np.isfinite(j)):
            return float("inf")
        return float(math.sqrt((self.N - 1.0) / self.N * np.sum((j - j.mean()) ** 2)))

    def short(self, k):
        return {"value": self.val(k), "err_boot": self.eb(k), "err_jack": self.ej(k),
                "n_boot_undefined": self.n_undef(k)}

    def full(self, k):
        d = self.short(k)
        b = self.b[k]
        b = b[np.isfinite(b)]
        if len(b) > 10:
            lo, hi = np.percentile(b, [15.865, 84.135])
            d.update({"boot_lo68": float(lo), "boot_hi68": float(hi),
                      "err_boot68": float(0.5 * (hi - lo)), "boot_bias": float(b.mean() - self.val(k))})
        return d

    def cov_boot(self, keys):
        M = np.array([self.b[k] for k in keys])
        ok = np.all(np.isfinite(M), axis=0)
        return np.cov(M[:, ok])


def build_config(bins, meta):
    g1 = bins["g1"].mean(axis=0)
    Cg = bins["g2"].mean(axis=0) - g1[:, None, None] * g1[None, :, None]
    Ct = bins["p2"].mean(axis=0)
    L = meta["torelon_L"]
    if len(set(L)) != 1:
        raise SystemExit("spatial extents differ: %r (not supported here)" % (L,))
    return {"T": int(meta["T"]), "L": int(L[0]), "D": int(meta["D"]),
            "glue": channel_config(Cg, meta["glue_ops"]),
            "tor": channel_config(Ct, meta["torelon_ops"])}


# ==============================================================================================
# blocks of the analysis
# ==============================================================================================
SUB_KEYS = (["plaq"]
            + ["%s.%s.m%d" % (ch, v, t) for ch in ("glue", "tor") for v in VARIANTS for t in (0, 1, 2)]
            + ["%s.%s.d12" % (ch, v) for ch in ("glue", "tor") for v in VARIANTS]
            + ["tor.%s.as%s%d" % (v, f, t) for v in VARIANTS for f in ("NG", "L") for t in (1, 2)]
            + ["ratio.%s.NG%d" % (v, t) for v in VARIANTS for t in (1, 2)])
#: the quantities on which the flags (re-binning, thermalisation, streams) are evaluated
FLAG_KEYS = ("plaq", "glue.gevp.m1", "glue.gevp.m2", "glue.single.m1", "glue.single.m2",
             "tor.gevp.m1", "tor.gevp.m2", "tor.single.m1", "tor.single.m2",
             "tor.gevp.asNG1", "tor.gevp.asNG2", "ratio.gevp.NG1", "ratio.gevp.NG2")
STREAM_KEYS = tuple(["plaq"] + ["%s.%s.m%d" % (ch, v, t) for ch in ("glue", "tor") for t in (1, 2)
                                for v in VARIANTS])


def chi2_block(vals, errs):
    v = np.array(vals, dtype=float)
    e = np.array(errs, dtype=float)
    ok = np.isfinite(v) & np.isfinite(e) & (e > 0)
    if ok.sum() < 2:
        return {"chi2": None, "dof": 0, "p": None, "mean": None, "n": int(ok.sum())}
    w = 1.0 / e[ok] ** 2
    mean = float(np.sum(w * v[ok]) / np.sum(w))
    c2 = float(np.sum(w * (v[ok] - mean) ** 2))
    dof = int(ok.sum() - 1)
    return {"chi2": c2, "dof": dof, "chi2_per_dof": c2 / dof, "p": float(chi2_dist.sf(c2, dof)),
            "mean": mean, "err_of_mean": float(1.0 / math.sqrt(np.sum(w))), "n": int(ok.sum())}


def autocorr_block(streams, meta, B):
    rows = []

    def add(name, series):
        t, e, W = tau_int_sokal(series)
        tb, nb = tau_int_binning(series, B)
        rows.append({"quantity": name, "tau_int": t, "tau_int_err": e, "window": W,
                     "tau_binning_at_B": tb})

    add("plaquette", [s["plaq"] for s in streams])
    for k, lab in enumerate(meta["glue_ops"]):
        add("glue %s: time-slice average" % lab, [s["g1"][:, k] for s in streams])
        add("glue %s: C(0)" % lab, [s["g2"][:, k, k, 0] for s in streams])
        add("glue %s: C(1)" % lab, [s["g2"][:, k, k, 1] for s in streams])
    nd = streams[0]["p1"].shape[1]
    for a, lab in enumerate(meta["torelon_ops"]):
        for d in range(nd):
            add("torelon %s dir %d: time-slice average" % (lab, d + 1), [s["p1"][:, d, a] for s in streams])
        add("torelon %s: C(0)" % lab, [s["p2"][:, a, a, 0] for s in streams])
        add("torelon %s: C(1)" % lab, [s["p2"][:, a, a, 1] for s in streams])
    fin = [r for r in rows if np.isfinite(r["tau_int"])]
    slow = max(fin, key=lambda r: r["tau_int"])
    slow_op = max([r for r in fin if r["quantity"] != "plaquette"], key=lambda r: r["tau_int"])
    pl = rows[0]
    scan = {}
    for f in (1, 2, 4, 8, 16):
        tb, nb = tau_int_binning([s["plaq"] for s in streams], B * f)
        if nb >= MIN_BINS:
            scan[str(B * f)] = tb
    return {"method": "pooled FFT autocovariance about the global mean, Sokal window c = %g; "
                      "tau_binning = B var(bin means) / (2 var)" % SOKAL_C,
            "plaquette": dict(pl, tau_binning_vs_binsize=scan),
            "slowest_operator": slow_op, "slowest_overall": slow,
            "tau_int_max": slow["tau_int"], "implied_binsize_10tau": int(math.ceil(10 * max(0.5, slow["tau_int"]))),
            "table": rows}


def r5_recheck(res, prefix, T):
    """Rule R5 re-implemented from its description in the docstring of ym/stats.py, on the
    jackknife of this file (GEVP variant)."""
    nt = T // 2
    m = [res.val("%s.gevp.m%d" % (prefix, t)) for t in range(nt)]
    e = [res.ej("%s.gevp.m%d" % (prefix, t)) for t in range(nt)]
    checks = []
    for t in range(1, nt - 1):
        de = res.ej_diff("%s.gevp.m%d" % (prefix, t), "%s.gevp.m%d" % (prefix, t + 1))
        ok1 = bool(np.isfinite(m[t]) and np.isfinite(m[t + 1]) and abs(m[t] - m[t + 1]) <= de)
        ok2 = bool(np.isfinite(m[t + 1]) and m[t + 1] > 0 and e[t + 1] / m[t + 1] < 0.25)
        checks.append({"t": t, "diff": m[t] - m[t + 1], "diff_err": de, "cond_i": ok1, "cond_ii": ok2})
        if ok1 and ok2:
            return {"flag": "plateau", "t_star": t, "value": m[t], "err_jack": e[t], "checks": checks}
    last = None
    for t in range(nt):
        if np.isfinite(m[t]) and m[t] > 0 and e[t] / m[t] < 0.25:
            last = t
        else:
            break
    if last is None:
        return {"flag": "no signal", "t_star": None, "value": None, "err_jack": None, "checks": checks}
    return {"flag": "no plateau", "t_star": None, "t_value": last, "value": m[last],
            "err_jack": e[last], "checks": checks}


def channel_report(res, cfg, prefix, T):
    ch = cfg[prefix]
    lab = ch["labels"]
    rep = {"operators": lab, "best_single_operator": lab[ch["best"]],
           "ranking_by_C1_over_C0": [lab[k] for k in ch["ranked"]],
           "C1_over_C0": {lab[k]: float(ch["quality"][k]) for k in ch["ranked"]},
           "r2_subset": [lab[k] for k in ch["subset"]], "r2_decisions": ch["decisions"],
           "fixed_vector": [float(x) for x in ch["vfix"]],
           "pruned_rank": int(ch["Wp"].shape[1]),
           "c0_eigenvalues_all_operators": [float(x) for x in ch["c0_eigenvalues_all"]],
           "variants": {}}
    for var in VARIANTS:
        v = {"meff": [dict(t=t, **res.full("%s.%s.m%d" % (prefix, var, t))) for t in range(4)],
             "m1_minus_m2": res.full("%s.%s.d12" % (prefix, var)),
             "C_over_C0": [dict(t=t, **res.short("%s.%s.R%d" % (prefix, var, t))) for t in range(1, NT_C)]}
        if var in ("single", "fixedvec"):
            v["C"] = [dict(t=t, **res.short("%s.%s.C%d" % (prefix, var, t))) for t in range(NT_C)]
        rep["variants"][var] = v
    rep["meff_all_t_gevp"] = [dict(t=t, **res.short("%s.gevp.m%d" % (prefix, t))) for t in range(T // 2)]
    return rep


def significance(res, prefix):
    """C(t) / error for t = 1, 2, 3 (is the connected correlator significantly non-zero?)."""
    out = {}
    for var, key in (("single", "C"), ("fixedvec", "C"), ("gevp", "R"), ("pruned", "R")):
        rows = []
        for t in (1, 2, 3, 4):
            k = "%s.%s.%s%d" % (prefix, var, key, t)
            v, eb, ej = res.val(k), res.eb(k), res.ej(k)
            rows.append({"t": t, "value": v, "err_boot": eb, "err_jack": ej,
                         "signif_boot": v / eb if eb > 0 else None,
                         "signif_jack": v / ej if (ej > 0 and np.isfinite(ej)) else None})
        out[var] = {"quantity": "connected C(t)" if key == "C" else "C(t)/C(0) of the projected correlator",
                    "rows": rows}
    return out


def sub_analysis(streams, cfg, B, nboot, rng, discard=0.0, which=None, keys=SUB_KEYS, jack=True,
                 window=None):
    bins = make_bins(streams, B, discard, which, window)
    if bins["n_bins"] < 4:
        return None, bins
    res = Res(bins, cfg, nboot, rng, jack=jack)
    return res, bins


def pack(res, bins, keys):
    return {"binsize": bins["binsize"], "n_bins": bins["n_bins"], "n_used": bins["n_used"],
            "n_cut": bins["n_cut"], "n_dropped_binning": bins["n_dropped_binning"],
            "q": {k: res.short(k) for k in keys}}


def stream_block(streams, cfg, B, nboot, rng, ens):
    """Every stream analysed alone.  Three chi2 values of the stream results about their weighted
    mean: with the bootstrap error of each stream ('boot'), with its jackknife error ('jack'), and
    with the error of the whole ensemble scaled to the stream length ('scaled':
    err_s = err_ensemble sqrt(N_bins_ensemble / N_bins_stream)).  The last one does not suffer
    from the noise of an error estimated from a handful of bins; with fewer than about 20 bins
    per stream the first two are NOT chi2-distributed and their p-values are too small."""
    per = []
    for i, st in enumerate(streams):
        res, bins = sub_analysis(streams, cfg, B, nboot, rng, which={i})
        row = {"file": st["file"], "seed": st["meta"]["seed"], "start": st["meta"]["start"],
               "set": st["set"], "n_meas": len(st["plaq"]), "n_bins": bins["n_bins"]}
        row["q"] = {k: res.short(k) for k in STREAM_KEYS} if res is not None else None
        per.append(row)
    chi = {}
    rows = [r for r in per if r["q"] is not None]
    for k in STREAM_KEYS:
        e_ens = ens.eb(k)
        chi[k] = {"boot": chi2_block([r["q"][k]["value"] for r in rows], [r["q"][k]["err_boot"] for r in rows]),
                  "jack": chi2_block([r["q"][k]["value"] for r in rows], [r["q"][k]["err_jack"] for r in rows]),
                  "scaled": chi2_block([r["q"][k]["value"] for r in rows],
                                       [e_ens * math.sqrt(ens.N / r["n_bins"]) for r in rows])}
    return {"binsize": B, "per_stream": per, "chi2": chi}


def group_compare(streams, cfg, B, nboot, rng, groups, corr_tests=False, discard=0.0):
    """Two disjoint groups of streams analysed separately (pooled bins inside a group)."""
    names = list(groups)
    R, info = {}, {}
    for g in names:
        res, bins = sub_analysis(streams, cfg, B, nboot, rng, which=set(groups[g]), discard=discard)
        if res is None:
            return None
        R[g] = res
        info[g] = {"streams": [streams[i]["file"] for i in groups[g]], "n_bins": bins["n_bins"],
                   "n_used": bins["n_used"]}
    a, b = names
    out = {"binsize": B, "discard_fraction": discard, "groups": info, "q": {}}
    for k in SUB_KEYS:
        va, vb = R[a].val(k), R[b].val(k)
        row = {a: R[a].short(k), b: R[b].short(k), "diff": va - vb}
        for kind, fa, fb in (("boot", R[a].eb(k), R[b].eb(k)), ("jack", R[a].ej(k), R[b].ej(k))):
            e = math.sqrt(fa * fa + fb * fb) if (np.isfinite(fa) and np.isfinite(fb)) else float("nan")
            row["diff_err_" + kind] = e
            row["pull_" + kind] = (va - vb) / e if (np.isfinite(e) and e > 0) else None
        out["q"][k] = row
    if corr_tests:
        tests = {}
        for ch in ("glue", "tor"):
            for var in ("single", "fixedvec"):
                keys = ["%s.%s.R%d" % (ch, var, t) for t in (1, 2, 3, 4)]
                d = np.array([R[a].val(k) - R[b].val(k) for k in keys])
                cov = R[a].cov_boot(keys) + R[b].cov_boot(keys)
                try:
                    c2 = float(d @ np.linalg.solve(cov, d))
                    tests["%s.%s" % (ch, var)] = {
                        "what": "C(t)/C(0), t = 1..4, of one common fixed operator: chi2 of the "
                                "difference between the groups with the full (bootstrap) covariance",
                        "diff": [float(x) for x in d],
                        "diff_err": [float(math.sqrt(cov[i, i])) for i in range(len(d))],
                        "chi2": c2, "dof": len(d), "p": float(chi2_dist.sf(c2, len(d)))}
                except np.linalg.LinAlgError:
                    pass
        out["correlator_tests"] = tests
    return out


HIST_KEYS = ("plaq", "glue.gevp.m1", "glue.gevp.m2", "glue.single.m1", "glue.single.m2",
             "glue.single.C0", "glue.single.R1", "glue.single.R2", "glue.single.R3",
             "tor.gevp.m1", "tor.gevp.m2", "tor.single.C0", "tor.single.R1", "tor.single.R3")


def time_history(streams, cfg, B, nboot, rng, ens):
    """Every stream is cut into n consecutive chunks of equal length; chunk c of all streams is
    pooled and analysed alone.  n = 10 if that leaves >= 20 bins per chunk, else 5, else none.
    Reported: the chunk values, their chi2 about the weighted mean, and chunk 0 (the data taken
    directly after thermalisation) against the pooled rest."""
    n_bins = ens.N
    n = 10 if n_bins >= 10 * MIN_BINS else (5 if n_bins >= 5 * MIN_BINS else 0)
    if n == 0:
        return {"n_chunks": 0, "note": "fewer than %d bins per chunk even with 5 chunks: not run" % MIN_BINS}
    chunks = []
    for c in range(n):
        res, bins = sub_analysis(streams, cfg, B, nboot, rng, window=(c / n, (c + 1) / n))
        chunks.append({"chunk": c, "n_bins": bins["n_bins"], "q": {k: res.short(k) for k in HIST_KEYS}})
    rest, rbins = sub_analysis(streams, cfg, B, nboot, rng, window=(1.0 / n, 1.0))
    out = {"n_chunks": n, "chunks": chunks, "chi2": {}, "first_chunk_vs_rest": {}}
    for k in HIST_KEYS:
        v = [c["q"][k]["value"] for c in chunks]
        out["chi2"][k] = {"boot": chi2_block(v, [c["q"][k]["err_boot"] for c in chunks]),
                          "scaled": chi2_block(v, [ens.eb(k) * math.sqrt(ens.N / c["n_bins"]) for c in chunks])}
        f = chunks[0]["q"][k]
        e = math.sqrt(f["err_boot"] ** 2 + rest.eb(k) ** 2)
        out["first_chunk_vs_rest"][k] = {"first": f["value"], "first_err": f["err_boot"], "rest": rest.val(k),
                                         "rest_err": rest.eb(k),
                                         "pull": (f["value"] - rest.val(k)) / e if (np.isfinite(e) and e > 0) else None}
    return out


def early_vs_late(streams, cfg, B, frac=0.10):
    """Per stream and for a few linear series: mean of the first ``frac`` of the bins minus the
    mean of the remaining bins, in units of its error (standard deviation of that stream's bins),
    and the slope of a straight line through the bin means against Monte Carlo time, in units of
    its error.  For a stationary stream both are standard normal."""
    kb, ka = cfg["glue"]["best"], cfg["tor"]["best"]
    series = {"plaquette": lambda s: s["plaq"],
              "glue best op: slice average": lambda s: s["g1"][:, kb],
              "glue best op: C(0)": lambda s: s["g2"][:, kb, kb, 0],
              "glue best op: C(1)": lambda s: s["g2"][:, kb, kb, 1],
              "glue best op: C(2)": lambda s: s["g2"][:, kb, kb, 2],
              "glue best op: C(3)": lambda s: s["g2"][:, kb, kb, 3],
              "torelon best op: C(0)": lambda s: s["p2"][:, ka, ka, 0],
              "torelon best op: C(1)": lambda s: s["p2"][:, ka, ka, 1],
              "torelon best op: C(2)": lambda s: s["p2"][:, ka, ka, 2]}
    out = []
    for st in streams:
        row = {"file": st["file"], "seed": st["meta"]["seed"], "start": st["meta"]["start"], "z": {}, "slope_z": {}}
        for name, fn in series.items():
            x = fn(st)
            nb = len(x) // B
            if nb < 10:
                continue
            bm = x[len(x) - nb * B:].reshape(nb, B).mean(axis=1)
            k = max(1, int(round(frac * nb)))
            sd = bm.std(ddof=1)
            row["z"][name] = float((bm[:k].mean() - bm[k:].mean()) / (sd * math.sqrt(1.0 / k + 1.0 / (nb - k))))
            tc = (np.arange(nb) + 0.5) / nb - 0.5
            slope = float(np.sum(tc * (bm - bm.mean())) / np.sum(tc * tc))
            resid = bm - bm.mean() - slope * tc
            row["slope_z"][name] = slope / math.sqrt(float(np.sum(resid ** 2)) / (nb - 2) / float(np.sum(tc * tc)))
        row["n_bins"] = int(len(st["plaq"]) // B)
        out.append(row)
    return {"fraction": frac, "binsize": B, "per_stream": out}


def cross_stream_correlation(streams, cfg, B):
    """Are the streams independent?  Pearson correlation, between every pair of streams, of bin
    means taken at EQUAL Monte Carlo time (bins counted from the start of the streams), for bin
    sizes B and 10 B.  z = atanh(r) sqrt(n - 3) is standard normal for independent streams."""
    kb, ka = cfg["glue"]["best"], cfg["tor"]["best"]
    series = {"plaquette": lambda s: s["plaq"],
              "glue best op: slice average": lambda s: s["g1"][:, kb],
              "glue best op: C(0)": lambda s: s["g2"][:, kb, kb, 0],
              "glue best op: C(1)": lambda s: s["g2"][:, kb, kb, 1],
              "glue best op: C(2)": lambda s: s["g2"][:, kb, kb, 2],
              "torelon best op: C(0)": lambda s: s["p2"][:, ka, ka, 0],
              "torelon best op: C(1)": lambda s: s["p2"][:, ka, ka, 1]}
    out = []
    for f in (1, 10):
        for name, fn in series.items():
            zs = []
            for i in range(len(streams)):
                for j in range(i + 1, len(streams)):
                    a, b = fn(streams[i]), fn(streams[j])
                    nb = min(len(a), len(b)) // (B * f)
                    if nb < 8:
                        continue
                    x = a[:nb * B * f].reshape(nb, B * f).mean(axis=1)
                    y = b[:nb * B * f].reshape(nb, B * f).mean(axis=1)
                    r = float(np.corrcoef(x, y)[0, 1])
                    zs.append({"pair": [streams[i]["meta"]["seed"], streams[j]["meta"]["seed"]], "n": nb,
                               "r": r, "z": math.atanh(r) * math.sqrt(nb - 3)})
            if not zs:
                continue
            c2 = float(sum(z["z"] ** 2 for z in zs))
            out.append({"binsize": B * f, "quantity": name, "pairs": zs, "chi2": c2, "dof": len(zs),
                        "p": float(chi2_dist.sf(c2, len(zs))), "mean_z": float(np.mean([z["z"] for z in zs])),
                        "max_abs_z": float(max(abs(z["z"]) for z in zs))})
    return out


# ==============================================================================================
# one ensemble
# ==============================================================================================
def jsonable(o):
    if isinstance(o, dict):
        return {str(k): jsonable(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [jsonable(v) for v in o]
    if isinstance(o, np.ndarray):
        return jsonable(o.tolist())
    if isinstance(o, (np.floating, float)):
        f = float(o)
        if not math.isfinite(f):
            return None if math.isnan(f) else ("inf" if f > 0 else "-inf")
        return float("%.10g" % f)       # 10 significant digits are stored
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.bool_,)):
        return bool(o)
    return o


def dump_json(obj, f, depth=3):
    """JSON with indentation for the first ``depth`` levels and one line per deeper object
    (keeps the files readable without making them several times larger)."""
    def rec(o, level):
        pad = " " * level
        if level >= depth or not isinstance(o, (dict, list)) or not o:
            return json.dumps(o, separators=(", ", ": "))
        if isinstance(o, dict):
            items = ["%s %s: %s" % (pad, json.dumps(k), rec(v, level + 1)) for k, v in o.items()]
            return "{\n" + ",\n".join(items) + "\n" + pad + "}"
        items = ["%s %s" % (pad, rec(v, level + 1)) for v in o]
        return "[\n" + ",\n".join(items) + "\n" + pad + "]"
    f.write(rec(obj, 0) + "\n")


def pipeline_compare(res, base_bins, cfg, pipe, r5):
    rows = []

    def add(name, key, pv, pe, kind="value"):
        if pv is None:
            return
        v, eb, ej = res.val(key), res.eb(key), res.ej(key)
        row = {"quantity": name, "key": key, "mine": v, "err_boot": eb, "err_jack": ej,
               "pipeline": pv, "pipeline_err": pe}
        if pe is not None and pe > 0 and np.isfinite(v):
            row["dev_sigma"] = (v - pv) / pe
            row["err_ratio_boot"] = eb / pe
            row["err_ratio_jack"] = ej / pe if np.isfinite(ej) else None
        rows.append(row)

    add("plaquette", "plaq", pipe["plaquette"]["mean"], pipe["plaquette"]["err"])
    for ch, blk in (("glue", pipe.get("glueball")), ("tor", pipe.get("torelon"))):
        if not blk:
            continue
        nm = "glueball m_eff" if ch == "glue" else "torelon E_eff"
        ft = blk["fixed_t"]
        add("%s(1)" % nm, "%s.gevp.m1" % ch, ft["t1"]["m"], ft["t1"]["err"])
        add("%s(2)" % nm, "%s.gevp.m2" % ch, ft["t2"]["m"], ft["t2"]["err"])
        add("%s(1)-%s(2)" % (nm, nm.split()[1]), "%s.gevp.d12" % ch,
            ft["t1_minus_t2"]["value"], ft["t1_minus_t2"]["err"])
        for r in blk.get("meff_t0_5", []):
            if r["t"] in (0, 3):
                add("%s(%d)" % (nm, r["t"]), "%s.gevp.m%d" % (ch, r["t"]), r["m_cosh"], r["err_cosh"])
    for r in pipe.get("string_tension", {}).get("fixed_t", []):
        t = r["t"]
        add("a*sqrt(sigma) Nambu-Goto t=%d" % t, "tor.gevp.asNG%d" % t,
            r["nambu_goto"]["a_sqrt_sigma"], r["nambu_goto"]["a_sqrt_sigma_err"])
        add("a*sqrt(sigma) Luscher t=%d" % t, "tor.gevp.asL%d" % t,
            r["luscher"]["a_sqrt_sigma"], r["luscher"]["a_sqrt_sigma_err"])
    g, t = pipe.get("glueball", {}), pipe.get("torelon", {})
    if g.get("flag") == "plateau" and t.get("flag") == "plateau":
        tg, tt = int(g["t_star"]), int(t["t_star"])
        rr = pipe["ratios"]["m_over_sqrt_sigma"]
        if tg < 4 and tt < 4:
            add("m/sqrt(sigma) NG at the pipeline's (t*_glue=%d, t*_torelon=%d)" % (tg, tt),
                "ratio.gevp.NGx%d%d" % (tg, tt), rr["nambu_goto"]["value"], rr["nambu_goto"]["err"])
            add("m/sqrt(sigma) Luscher at the pipeline's (t*_glue=%d, t*_torelon=%d)" % (tg, tt),
                "ratio.gevp.Lx%d%d" % (tg, tt), rr["luscher"]["value"], rr["luscher"]["err"])
    devs = [abs(r["dev_sigma"]) for r in rows if "dev_sigma" in r]
    worst = max((r for r in rows if "dev_sigma" in r), key=lambda r: abs(r["dev_sigma"]))
    structural = {
        "n_bins": {"mine": base_bins["n_bins"], "pipeline": pipe["n_bins"]},
        "n_used": {"mine": base_bins["n_used"], "pipeline": pipe["n_meas_used"]},
        "files": {"mine": None, "pipeline": [s["file"] for s in pipe["streams"]]},
        "glueball_subset": {"mine": [cfg["glue"]["labels"][k] for k in cfg["glue"]["subset"]],
                            "pipeline": pipe.get("glueball", {}).get("gevp", {}).get("selected")},
        "torelon_subset": {"mine": [cfg["tor"]["labels"][k] for k in cfg["tor"]["subset"]],
                           "pipeline": pipe.get("torelon", {}).get("gevp", {}).get("selected")},
    }
    r5cmp = {}
    for ch, blk in (("glue", g), ("tor", t)):
        if blk:
            mine = r5[ch]
            r5cmp[ch] = {"mine": {k: mine.get(k) for k in ("flag", "t_star", "t_value", "value", "err_jack")},
                         "pipeline": {"flag": blk.get("flag"), "t_star": blk.get("t_star"),
                                      "t_value": blk.get("t_value"), "value": blk.get("mass"),
                                      "err": blk.get("err")}}
    return {"rows": rows, "max_abs_dev_sigma": max(devs) if devs else None,
            "worst_quantity": worst["quantity"], "structural": structural, "r5": r5cmp}


def run_ensemble(name, args):
    t_start = time.time()
    rng = np.random.default_rng([args.seed, zlib.crc32(name.encode())])
    paths = ensemble_paths(name, args.raw_dir)
    streams = []
    for prefix, p in paths:
        st = load_stream(p)
        st["set"] = prefix
        streams.append(st)
    meta = streams[0]["meta"]
    for st in streams[1:]:
        for k in ("shape", "beta", "levels", "w", "loops", "nhb", "nor", "nskip", "ntherm", "glue_ops",
                  "torelon_ops"):
            if st["meta"][k] != meta[k]:
                raise SystemExit("%s: parameter %s differs between streams" % (name, k))
    if len({st["meta"]["seed"] for st in streams}) != len(streams):
        raise SystemExit("%s: duplicate seeds" % name)
    T, D = int(meta["T"]), int(meta["D"])

    pipe = None
    ppath = os.path.join(args.pipeline_dir, name + ".json")
    if os.path.exists(ppath):
        with open(ppath) as f:
            pipe = json.load(f)

    # constant offsets: global mean of every glueball operator (all streams, all time slices)
    n_all = sum(len(st["plaq"]) for st in streams)
    off = sum(st["glue"].mean(axis=2).sum(axis=0) for st in streams) / n_all
    for st in streams:
        primaries(st, off)
        del st["glue"], st["tor"]

    B_own = None
    if pipe is not None:
        B = int(pipe["binsize"])
    else:
        B = 1
    ac = autocorr_block(streams, meta, max(B, 1))
    B_own = ac["implied_binsize_10tau"]
    if pipe is None:
        B = B_own
        ac = autocorr_block(streams, meta, B)
    if args.binsize:
        B = args.binsize

    base_bins = make_bins(streams, B)
    cfg = build_config(base_bins, meta)
    res = Res(base_bins, cfg, args.nboot, rng, jack=True)

    out = {"ensemble": name, "generated_utc": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "disclaimer": DISCLAIMER, "code": "independent_analysis.py (does not import ym.stats / analyze.py)",
           "D": D, "shape": meta["shape"], "T": T, "L": cfg["L"], "beta": meta["beta"],
           "update": {k: meta[k] for k in ("nhb", "nor", "nskip", "ntherm")},
           "smearing": {"levels": meta["levels"], "w": meta["w"]},
           "nboot": args.nboot, "rng_seed": [args.seed, zlib.crc32(name.encode())],
           "streams": [{"file": st["file"], "set": st["set"], "seed": st["meta"]["seed"],
                        "start": st["meta"]["start"], "n_meas": len(st["plaq"]),
                        "complete": st["meta"].get("complete")} for st in streams],
           "n_meas_total": n_all, "binsize": B,
           "binsize_source": "pipeline JSON" if (pipe is not None and not args.binsize) else "own 10 tau_int / command line",
           "binsize_own_rule_10tau": B_own, "n_bins": base_bins["n_bins"], "n_used": base_bins["n_used"],
           "n_dropped_binning": base_bins["n_dropped_binning"],
           "autocorrelation": ac}

    # ---- base analysis -----------------------------------------------------------------
    pl = [st["plaq"] for st in streams]
    tau_p = ac["plaquette"]["tau_int"]
    allp = np.concatenate(pl)
    out["plaquette"] = dict(res.full("plaq"),
                            mean_all_measurements=float(allp.mean()),
                            err_naive=float(allp.std(ddof=1) / math.sqrt(len(allp))),
                            err_from_tau_int=float(allp.std(ddof=1) * math.sqrt(2 * max(tau_p, 0.5) / len(allp))),
                            tau_int=tau_p, tau_int_err=ac["plaquette"]["tau_int_err"])
    out["glueball"] = channel_report(res, cfg, "glue", T)
    out["torelon"] = channel_report(res, cfg, "tor", T)
    vev = []
    p1 = base_bins["p1"]
    for d in range(p1.shape[1]):
        for a, lab in enumerate(meta["torelon_ops"]):
            m = float(p1[:, d, a].mean())
            e = float(p1[:, d, a].std(ddof=1) / math.sqrt(p1.shape[0]))
            vev.append({"direction": d + 1, "operator": lab, "mean": m, "err": e, "pull": m / e})
    out["torelon"]["vev_check"] = vev
    out["torelon"]["vev_max_abs_pull"] = max(abs(v["pull"]) for v in vev)
    g1 = base_bins["g1"]
    out["glueball"]["vev"] = [{"operator": lab, "offset_subtracted": float(off[k]),
                               "mean_after_offset": float(g1[:, k].mean())}
                              for k, lab in enumerate(meta["glue_ops"])]

    st_blk = {"L": cfg["L"], "variants": {}}
    for var in VARIANTS:
        st_blk["variants"][var] = [
            {"t": t, "aE": res.short("tor.%s.m%d" % (var, t)),
             "luscher_a_sqrt_sigma": res.short("tor.%s.asL%d" % (var, t)),
             "nambu_goto_a_sqrt_sigma": res.short("tor.%s.asNG%d" % (var, t))} for t in range(4)]
    E1 = res.val("tor.gevp.m1")
    s_ng, s_num, s_lu = float(sigma_nambu_goto(E1, cfg["L"], D)), sigma_nambu_goto_numeric(E1, cfg["L"], D), float(sigma_luscher(E1, cfg["L"], D))
    st_blk["formula_check"] = {
        "E_used": E1, "sigma_nambu_goto_closed_form": s_ng, "sigma_nambu_goto_numerical_inversion": s_num,
        "closed_minus_numeric": s_ng - s_num, "E_reconstructed_from_sigma": energy_nambu_goto(s_ng, cfg["L"], D),
        "sigma_luscher": s_lu, "nambu_goto_minus_luscher": s_ng - s_lu,
        "expected_difference": string_c(D) ** 2 / (4.0 * cfg["L"] ** 2 * (2.0 * s_lu * cfg["L"] ** 2 - string_c(D))),
        "note": "inserting E = sigma_L L - c/(2L) into the NG relation gives NG - Luscher = "
                "c^2 / (4 L^2 (2 sigma_L L^2 - c)) up to a term of second order in the difference "
                "(about c^2 / (8 sigma L^4)); c = pi (D-2)/3"}
    out["string_tension"] = st_blk
    out["ratios"] = {"m_over_sqrt_sigma": {
        var: {"t%d" % t: {"nambu_goto": res.full("ratio.%s.NG%d" % (var, t)),
                          "luscher": res.full("ratio.%s.L%d" % (var, t))} for t in (1, 2)} for var in VARIANTS},
        "note": "glueball and torelon at the SAME fixed t, both from the same bootstrap / jackknife "
                "samples (correlations included)"}
    out["correlator_significance"] = {"glueball": significance(res, "glue"), "torelon": significance(res, "tor")}
    r5 = {"glue": r5_recheck(res, "glue", T), "tor": r5_recheck(res, "tor", T)}
    out["r5_recheck"] = r5
    if pipe is not None:
        cmp_ = pipeline_compare(res, base_bins, cfg, pipe, r5)
        cmp_["structural"]["files"]["mine"] = [st["file"] for st in streams]
        out["comparison_with_pipeline"] = cmp_

    # ---- (b) re-binning ----------------------------------------------------------------
    scan, stream_scan = [], []
    for f in BIN_FACTORS:
        bins = make_bins(streams, B * f)
        if bins["n_bins"] < MIN_BINS:
            continue
        r = res if f == 1 else Res(bins, cfg, args.nboot, rng, jack=True)
        row = pack(r, bins, SUB_KEYS)
        row["factor"] = f
        scan.append(row)
        sb = stream_block(streams, cfg, B * f, args.nboot_sub, rng, r)
        sb["factor"] = f
        stream_scan.append(sb)
    base_row = scan[0]
    for row in scan[1:]:
        n1, nk = base_row["n_bins"], row["n_bins"]
        sd = math.sqrt(max(1.0 / (2 * (nk - 1)) - 1.0 / (2 * (n1 - 1)), 0.0))
        # the ratio of two bootstrap errors carries in addition the resampling noise of both,
        # 1 / sqrt(2 nboot) each
        sdb = math.sqrt(sd * sd + 1.0 / args.nboot)
        row["expected_sd_of_error_ratio"] = sd
        row["expected_sd_of_bootstrap_error_ratio"] = sdb
        row["error_ratio_to_1x"] = {}
        for k in SUB_KEYS:
            e1b, ekb = base_row["q"][k]["err_boot"], row["q"][k]["err_boot"]
            e1j, ekj = base_row["q"][k]["err_jack"], row["q"][k]["err_jack"]
            rb = ekb / e1b if (e1b and np.isfinite(e1b) and np.isfinite(ekb)) else None
            rj = ekj / e1j if (e1j and np.isfinite(e1j) and np.isfinite(ekj)) else None
            row["error_ratio_to_1x"][k] = {"boot": rb, "jack": rj,
                                           "z_boot": (rb - 1.0) / sdb if rb is not None else None,
                                           "z_jack": (rj - 1.0) / sd if (rj is not None and sd > 0) else None,
                                           "shift_in_sigma_1x": (row["q"][k]["value"] - base_row["q"][k]["value"]) / e1b
                                           if (e1b and np.isfinite(e1b) and np.isfinite(row["q"][k]["value"])) else None}
    out["bin_scan"] = scan
    if pipe is not None and len(scan) > 1 and "binning_check" in pipe:
        bc, mine2 = pipe["binning_check"], scan[1]
        rows = []
        if int(bc.get("binsize", -1)) == mine2["binsize"]:
            for ch, blk in (("glue", bc.get("glueball")), ("tor", bc.get("torelon"))):
                if blk and blk.get("meff1") is not None:
                    q = mine2["q"]["%s.gevp.m1" % ch]
                    rows.append({"quantity": "%s m_eff(1) at 2B" % ch, "mine": q["value"], "err_jack": q["err_jack"],
                                 "err_boot": q["err_boot"], "pipeline": blk["meff1"], "pipeline_err": blk["meff1_err"],
                                 "dev_sigma": (q["value"] - blk["meff1"]) / blk["meff1_err"],
                                 "err_ratio_jack": q["err_jack"] / blk["meff1_err"]})
        out["comparison_with_pipeline"]["binning_check_2B"] = rows

    # ---- (c) thermalisation cuts -------------------------------------------------------
    cuts = []
    for frac in THERM_CUTS:
        r, bins = sub_analysis(streams, cfg, B, args.nboot, rng, discard=frac)
        row = pack(r, bins, SUB_KEYS)
        row["discard_fraction"] = frac
        row["shift"] = {}
        # a subsample holding the fraction (1 - frac) of the data differs from the full sample by
        # err_full * sqrt(frac / (1 - frac)) (one standard deviation; linear estimator, independent bins)
        sd = math.sqrt(frac / (1.0 - frac))
        row["expected_sd_of_shift_in_sigma_full"] = sd
        for k in SUB_KEYS:
            v0, e0 = res.val(k), res.eb(k)
            v1 = r.val(k)
            z = (v1 - v0) / e0 if (e0 and np.isfinite(e0) and np.isfinite(v1)) else None
            row["shift"][k] = {"shift": v1 - v0, "shift_in_sigma_full": z,
                               "shift_in_expected_sd": z / sd if z is not None else None}
        cuts.append(row)
    out["thermalisation_cuts"] = cuts
    out["time_history"] = time_history(streams, cfg, B, args.nboot_sub, rng, res)
    out["cross_stream_correlation"] = cross_stream_correlation(streams, cfg, B)
    out["early_vs_late"] = early_vs_late(streams, cfg, B)

    # ---- (d) streams, hot vs cold, sets -------------------------------------------------
    out["stream_consistency"] = stream_scan[0]
    out["stream_consistency_vs_binsize"] = [
        {"factor": sb["factor"], "binsize": sb["binsize"],
         "n_bins_per_stream": [r["n_bins"] for r in sb["per_stream"]],
         "chi2": sb["chi2"]} for sb in stream_scan]
    hot = [i for i, st in enumerate(streams) if st["meta"]["start"] == "hot"]
    cold = [i for i, st in enumerate(streams) if st["meta"]["start"] == "cold"]
    if hot and cold:
        out["hot_vs_cold"] = group_compare(streams, cfg, B, args.nboot_sub, rng, {"hot": hot, "cold": cold})
    sets = []
    for st in streams:
        if st["set"] not in sets:
            sets.append(st["set"])
    if len(sets) == 2:
        groups = {s: [i for i, st in enumerate(streams) if st["set"] == s] for s in sets}
        comp = []
        for f in BIN_FACTORS:
            if make_bins(streams, B * f)["n_bins"] < MIN_BINS:
                continue
            gc = group_compare(streams, cfg, B * f, args.nboot, rng, groups, corr_tests=True)
            if gc is not None:
                gc["factor"] = f
                comp.append(gc)
        by_cut = []
        for frac in THERM_CUTS:
            gc = group_compare(streams, cfg, B, args.nboot, rng, groups, corr_tests=True, discard=frac)
            if gc is not None:
                by_cut.append(gc)
        out["set_comparison"] = {"sets": sets, "note": "operator choices (subset, fixed vector, best "
                                 "single operator) are those of the combined sample, identical for both sets",
                                 "by_binsize": comp, "with_thermalisation_cut": by_cut}

    out["flags"] = make_flags(out)
    out["runtime_s"] = time.time() - t_start
    os.makedirs(args.outdir, exist_ok=True)
    path = os.path.join(args.outdir, name + ".json")
    with open(path, "w") as f:
        dump_json(jsonable(out), f)
    return path, out


def make_flags(out):
    """Mechanical flags (thresholds from the task): pipeline deviation > 0.3 sigma, error change
    > 20 % under re-binning, thermalisation shift > 1.5 sigma, stream chi2 probability < 1 %."""
    flags = []
    cmp_ = out.get("comparison_with_pipeline")
    if cmp_:
        for r in cmp_["rows"]:
            if "dev_sigma" in r and abs(r["dev_sigma"]) > 0.3:
                flags.append({"type": "pipeline_deviation", "quantity": r["quantity"],
                              "dev_sigma": r["dev_sigma"]})
            rj = r.get("err_ratio_jack")
            if rj is not None and abs(rj - 1.0) > 0.05:
                flags.append({"type": "pipeline_error_mismatch_jackknife", "quantity": r["quantity"],
                              "err_ratio_jack": rj})
            rb = r.get("err_ratio_boot")
            if rb is not None and abs(rb - 1.0) > 0.2:
                flags.append({"type": "pipeline_error_mismatch_bootstrap", "quantity": r["quantity"],
                              "err_ratio_boot": rb, "relative_error_of_the_quantity": r["pipeline_err"] / abs(r["pipeline"])
                              if r["pipeline"] else None})
        for r in cmp_.get("binning_check_2B", []):
            if abs(r["dev_sigma"]) > 0.3 or abs(r["err_ratio_jack"] - 1.0) > 0.05:
                flags.append({"type": "pipeline_deviation", "quantity": r["quantity"], "dev_sigma": r["dev_sigma"]})
        s = cmp_["structural"]
        for k in ("n_bins", "n_used", "files", "glueball_subset", "torelon_subset"):
            if s[k]["mine"] != s[k]["pipeline"]:
                flags.append({"type": "structural_mismatch", "quantity": k, "mine": s[k]["mine"],
                              "pipeline": s[k]["pipeline"]})
        for ch, r in cmp_["r5"].items():
            m, p = r["mine"], r["pipeline"]
            same = (m["flag"] == p["flag"] and m["t_star"] == p["t_star"])
            if same and m["value"] is not None and p["value"] is not None:
                same = abs(m["value"] - p["value"]) <= 0.01 * (p["err"] or 1.0)
            if not same:
                flags.append({"type": "r5_mismatch", "channel": ch, "mine": m, "pipeline": p})
    for row in out.get("bin_scan", [])[1:]:
        for k in FLAG_KEYS:
            er = row["error_ratio_to_1x"][k]
            if er["boot"] is not None and abs(er["boot"] - 1.0) > 0.2:
                flags.append({"type": "rebinning_error_change", "quantity": k, "factor": row["factor"],
                              "n_bins": row["n_bins"], "error_ratio_boot": er["boot"],
                              "error_ratio_jack": er["jack"], "z_vs_expected_scatter": er["z_boot"],
                              "z_jack": er["z_jack"]})
    for row in out.get("thermalisation_cuts", []):
        for k in FLAG_KEYS:
            s = row["shift"][k]
            if s["shift_in_sigma_full"] is not None and abs(s["shift_in_sigma_full"]) > 1.5:
                flags.append({"type": "thermalisation_shift", "quantity": k,
                              "discard_fraction": row["discard_fraction"],
                              "shift_in_sigma_full": s["shift_in_sigma_full"],
                              "shift_in_expected_sd": s["shift_in_expected_sd"]})
    for sb in out.get("stream_consistency_vs_binsize", []):
        nmin = min(sb["n_bins_per_stream"])
        for k, c in sb["chi2"].items():
            for kind in ("scaled", "boot"):
                p = c[kind].get("p")
                if p is not None and p < 0.01:
                    flags.append({"type": "stream_inconsistency" if (kind == "scaled" or nmin >= MIN_BINS)
                                  else "stream_chi2_small_but_unreliable_few_bins_per_stream",
                                  "quantity": k, "factor": sb["factor"], "errors": kind,
                                  "min_bins_per_stream": nmin, "chi2": c[kind]["chi2"],
                                  "dof": c[kind]["dof"], "p": p})
    for row in out.get("thermalisation_cuts", []):
        for k in FLAG_KEYS:
            z = row["shift"][k]["shift_in_expected_sd"]
            if z is not None and abs(z) > 3.0:
                flags.append({"type": "thermalisation_shift_beyond_3_expected_sd", "quantity": k,
                              "discard_fraction": row["discard_fraction"],
                              "shift_in_sigma_full": row["shift"][k]["shift_in_sigma_full"],
                              "shift_in_expected_sd": z})
    th = out.get("time_history", {})
    for k, c in th.get("chi2", {}).items():
        for kind in ("scaled", "boot"):
            p = c[kind].get("p")
            if p is not None and p < 0.01:
                flags.append({"type": "time_history_inhomogeneous", "quantity": k, "errors": kind,
                              "n_chunks": th["n_chunks"], "chi2": c[kind]["chi2"], "dof": c[kind]["dof"], "p": p})
    for k, c in th.get("first_chunk_vs_rest", {}).items():
        if c["pull"] is not None and abs(c["pull"]) > 3.0:
            flags.append({"type": "first_chunk_differs_from_rest", "quantity": k, "n_chunks": th["n_chunks"],
                          "pull": c["pull"], "first": c["first"], "first_err": c["first_err"],
                          "rest": c["rest"], "rest_err": c["rest_err"]})
    for c in out.get("cross_stream_correlation", []):
        if c["p"] < 0.001:          # 14 tests per ensemble: a stricter threshold than elsewhere
            flags.append({"type": "streams_correlated_at_equal_mc_time", "quantity": c["quantity"],
                          "binsize": c["binsize"], "chi2": c["chi2"], "dof": c["dof"], "p": c["p"]})
    hc = out.get("hot_vs_cold")
    if hc:
        for k in FLAG_KEYS:
            p = hc["q"][k]["pull_boot"]
            if p is not None and abs(p) > 2.576:
                flags.append({"type": "hot_cold_difference", "quantity": k, "pull": p})
    return flags


# ==============================================================================================
# COMPARISON.md
# ==============================================================================================
def ve(v, e):
    """value(error) with two significant digits of the error."""
    if v is None or (isinstance(v, float) and not math.isfinite(v)):
        return "n/a"
    if e is None or isinstance(e, str) or not math.isfinite(e) or e <= 0:
        return "%.5g(?)" % v
    dec = max(0, 1 - int(math.floor(math.log10(e))))
    return "%.*f(%d)" % (dec, v, int(round(e * 10 ** dec)))


def num(x, fmt="%.2f"):
    if x is None or isinstance(x, str):
        return "n/a" if x is None else x
    return fmt % x


def write_table(outdir, pipeline_dir):
    J, P = {}, {}
    for n in ORDER:
        p = os.path.join(outdir, n + ".json")
        if os.path.exists(p):
            with open(p) as f:
                J[n] = json.load(f)
            pp = os.path.join(pipeline_dir, n + ".json")
            if os.path.exists(pp):
                with open(pp) as f:
                    P[n] = json.load(f)
    L = []
    w = L.append
    w("# Independent re-analysis versus the pipeline")
    w("")
    w("Generated by `python3 independent_analysis.py --table` from `results/independent/<name>.json` "
      "(mine) and `results/<name>.json` (pipeline).  " + DISCLAIMER)
    w("")
    w("Notation: value(error); `m_eff(t)` uses C(t) and C(t+1).  Pipeline errors are its blocked "
      "jackknife errors; mine are bootstrap errors over the same bins (%s samples) unless a column "
      "says otherwise.  `dev` = (mine - pipeline) / pipeline error.  `eB/eP`, `eJ/eP` = my bootstrap / "
      "my jackknife error divided by the pipeline error." % (next(iter(J.values()))["nboot"] if J else "?"))
    w("")

    if J:
        devs = [j["comparison_with_pipeline"]["max_abs_dev_sigma"] for j in J.values() if "comparison_with_pipeline" in j]
        counts = {}
        for j in J.values():
            for fl in j["flags"]:
                counts[fl["type"]] = counts.get(fl["type"], 0) + 1
        w("**Mechanical summary.**  %d ensembles.  Largest deviation of any compared central value from "
          "the pipeline: %.1e pipeline sigma.  Flags raised (section 9; a flag is a prompt to look, not "
          "a verdict): %s." % (len(J), max(devs) if devs else float("nan"),
                               ", ".join("%s x %d" % (k.replace("_", " "), v) for k, v in sorted(counts.items())) or "none"))
        w("")

    def cmp_row(j, quantity):
        for r in j["comparison_with_pipeline"]["rows"]:
            if r["quantity"] == quantity:
                return r
        return None

    w("## 1. Like-for-like comparison (same bins, operator subset by rule R2, GEVP t0 = 0)")
    w("")
    for title, quants in (("Glueball effective mass", ("glueball m_eff(1)", "glueball m_eff(2)")),
                          ("Torelon effective energy", ("torelon E_eff(1)", "torelon E_eff(2)")),
                          ("a*sqrt(sigma), Nambu-Goto", ("a*sqrt(sigma) Nambu-Goto t=1", "a*sqrt(sigma) Nambu-Goto t=2"))):
        w("### %s" % title)
        w("")
        w("| ensemble | t=1 pipeline | t=1 mine | dev | eB/eP | eJ/eP | t=2 pipeline | t=2 mine | dev | eB/eP | eJ/eP |")
        w("|---|---|---|---|---|---|---|---|---|---|---|")
        for n, j in J.items():
            cells = [n]
            for q in quants:
                r = cmp_row(j, q)
                if r is None:
                    cells += ["n/a"] * 5
                else:
                    cells += [ve(r["pipeline"], r["pipeline_err"]), ve(r["mine"], r["err_boot"]),
                              num(r.get("dev_sigma"), "%+.1e"), num(r.get("err_ratio_boot"), "%.3f"),
                              num(r.get("err_ratio_jack"), "%.4f")]
            w("| " + " | ".join(cells) + " |")
        w("")
    w("### Plaquette and autocorrelation")
    w("")
    w("| ensemble | plaquette pipeline | plaquette mine | dev | eB/eP | tau_int(plaq) pipeline | mine (Sokal c=5) | mine (binning at B) | tau_int max pipeline | mine | slowest quantity (mine) | bin size (pipeline) | 10 tau (mine) |")
    w("|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for n, j in J.items():
        r = cmp_row(j, "plaquette")
        p = P.get(n, {})
        ac = j["autocorrelation"]
        w("| %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %d | %d |" % (
            n, ve(r["pipeline"], r["pipeline_err"]), ve(r["mine"], r["err_boot"]), num(r.get("dev_sigma"), "%+.1e"),
            num(r.get("err_ratio_boot"), "%.3f"),
            ve(p.get("plaquette", {}).get("tau_int"), p.get("plaquette", {}).get("tau_int_err")),
            ve(ac["plaquette"]["tau_int"], ac["plaquette"]["tau_int_err"]), num(ac["plaquette"]["tau_binning_at_B"]),
            num(p.get("tau_int_max"), "%.2f"), num(ac["tau_int_max"], "%.2f"), ac["slowest_overall"]["quantity"],
            j["binsize"], j["binsize_own_rule_10tau"]))
    w("")
    w("### Largest deviation per ensemble, structure and rule R5")
    w("")
    w("| ensemble | bins mine/pipeline | max abs(dev) over all compared numbers | at | R2 subsets equal | R5 glueball (mine / pipeline) | R5 torelon (mine / pipeline) | pipeline's 2B check, max abs(dev) |")
    w("|---|---|---|---|---|---|---|---|")
    for n, j in J.items():
        c = j["comparison_with_pipeline"]
        s = c["structural"]
        eq = (s["glueball_subset"]["mine"] == s["glueball_subset"]["pipeline"]
              and s["torelon_subset"]["mine"] == s["torelon_subset"]["pipeline"])

        def r5s(ch):
            r = c["r5"].get(ch)
            if not r:
                return "n/a"
            m, p = r["mine"], r["pipeline"]

            def one(d, ek):
                if d["flag"] == "plateau":
                    return "%s [t*=%s]" % (ve(d["value"], d.get(ek)), d["t_star"])
                return "%s: %s at t=%s" % (d["flag"], ve(d["value"], d.get(ek)), d.get("t_value"))
            return one(m, "err_jack") + " / " + one(p, "err")
        b2 = c.get("binning_check_2B", [])
        w("| %s | %d / %d | %s | %s | %s | %s | %s | %s |" % (
            n, s["n_bins"]["mine"], s["n_bins"]["pipeline"], num(c["max_abs_dev_sigma"], "%.1e"),
            c["worst_quantity"], "yes" if eq else "NO", r5s("glue"), r5s("tor"),
            num(max(abs(r["dev_sigma"]) for r in b2), "%.1e") if b2 else "n/a"))
    w("")

    w("## 2. Dependence on the variational choice (my numbers, bootstrap errors)")
    w("")
    w("`gevp` = R2 subset, re-solved per sample; `fixedvec` = same subset, eigenvector frozen; "
      "`pruned` = full basis, modes of C(0) with eigenvalue >= 0.01; `single` = best single operator.")
    w("")
    for ch, title in (("glueball", "Glueball m_eff"), ("torelon", "Torelon E_eff")):
        w("### %s" % title)
        w("")
        w("| ensemble | t | gevp | fixedvec | pruned | single (operator) |")
        w("|---|---|---|---|---|---|")
        for n, j in J.items():
            for t in (0, 1, 2, 3):
                cells = []
                for var in VARIANTS:
                    r = j[ch]["variants"][var]["meff"][t]
                    s = ve(r["value"], r["err_boot"])
                    if r["n_boot_undefined"]:
                        s += " [%d undef]" % r["n_boot_undefined"]
                    cells.append(s)
                cells[-1] += " (%s)" % j[ch]["best_single_operator"]
                w("| %s | %d | %s |" % (n if t == 0 else "", t, " | ".join(cells)))
        w("")
    w("### m_eff(1) - m_eff(2) (correlated error; positive = falling effective mass)")
    w("")
    w("| ensemble | glueball gevp | glueball single | torelon gevp | torelon single |")
    w("|---|---|---|---|---|")
    for n, j in J.items():
        cells = []
        for ch in ("glueball", "torelon"):
            for var in ("gevp", "single"):
                r = j[ch]["variants"][var]["m1_minus_m2"]
                cells.append("%s (%+.1f sigma)" % (ve(r["value"], r["err_boot"]), r["value"] / r["err_boot"]))
        w("| %s | %s |" % (n, " | ".join(cells)))
    w("")

    w("## 3. String tension and m/sqrt(sigma) at fixed t (my numbers)")
    w("")
    w("| ensemble | L | a*sqrt(sigma) NG t=1 | Luscher t=1 | NG t=2 | Luscher t=2 | m/sqrt(sigma) NG t=1 | t=2 | single-operator variant t=1 | t=2 |")
    w("|---|---|---|---|---|---|---|---|---|---|")
    for n, j in J.items():
        sv = j["string_tension"]["variants"]["gevp"]
        rr = j["ratios"]["m_over_sqrt_sigma"]

        def s(d):
            return ve(d["value"], d["err_boot"])
        w("| %s | %d | %s | %s | %s | %s | %s | %s | %s | %s |" % (
            n, j["L"], s(sv[1]["nambu_goto_a_sqrt_sigma"]), s(sv[1]["luscher_a_sqrt_sigma"]),
            s(sv[2]["nambu_goto_a_sqrt_sigma"]), s(sv[2]["luscher_a_sqrt_sigma"]),
            s(rr["gevp"]["t1"]["nambu_goto"]), s(rr["gevp"]["t2"]["nambu_goto"]),
            s(rr["single"]["t1"]["nambu_goto"]), s(rr["single"]["t2"]["nambu_goto"])))
    w("")
    w("Formula check (closed-form Nambu-Goto inversion against a numerical inversion; largest "
      "absolute difference in sigma over all ensembles): %.1e." % max(
          abs(j["string_tension"]["formula_check"]["closed_minus_numeric"]) for j in J.values()))
    w("")

    w("## 4. Re-binning: error(k x B) / error(B), bootstrap errors")
    w("")
    w("`sd` = scatter of the ratio expected from the finite number of bins alone, "
      "sqrt(1/(2(n_k-1)) - 1/(2(n_1-1))); a ratio of two bootstrap errors has in addition a "
      "resampling noise of 1/sqrt(nboot) = %.3f.  Bin sizes with fewer than %d bins are not run; "
      "k = 16, 32 go beyond the requested 1-8." % (1.0 / math.sqrt(next(iter(J.values()))["nboot"]), MIN_BINS))
    w("")
    w("| ensemble | k | bins | sd | plaq | glue m(1) | glue m(2) | glue single m(1) | glue single m(2) | tor E(1) | tor E(2) | a sqrt(sigma) t=1 | m/sqrt(sigma) t=1 |")
    w("|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    keys = ("plaq", "glue.gevp.m1", "glue.gevp.m2", "glue.single.m1", "glue.single.m2", "tor.gevp.m1",
            "tor.gevp.m2", "tor.gevp.asNG1", "ratio.gevp.NG1")
    for n, j in J.items():
        if len(j["bin_scan"]) == 1:
            w("| %s | 1 | %d | - | (no larger bin size leaves %d bins) | | | | | | | | |" % (n, j["bin_scan"][0]["n_bins"], MIN_BINS))
        for row in j["bin_scan"][1:]:
            w("| %s | %d | %d | %.2f | %s |" % (n, row["factor"], row["n_bins"], row["expected_sd_of_error_ratio"],
                                              " | ".join(num(row["error_ratio_to_1x"][k]["boot"]) for k in keys)))
    w("")

    w("## 5. Thermalisation cuts: shift of the value in units of the full-sample error")
    w("")
    w("In brackets: the shift in units of the scatter expected from dropping data alone, "
      "err_full sqrt(c / (1 - c)) for a cut fraction c (0.33 sigma for 10 %, 0.58 sigma for 25 %).")
    w("")
    w("| ensemble | cut | glue m(1) | glue m(2) | tor E(1) | tor E(2) | a sqrt(sigma) t=1 | m/sqrt(sigma) t=1 | plaq |")
    w("|---|---|---|---|---|---|---|---|---|")
    keys = ("glue.gevp.m1", "glue.gevp.m2", "tor.gevp.m1", "tor.gevp.m2", "tor.gevp.asNG1", "ratio.gevp.NG1", "plaq")
    for n, j in J.items():
        for row in j["thermalisation_cuts"]:
            w("| %s | %d %% | %s |" % (n, round(100 * row["discard_fraction"]), " | ".join(
                "%s [%s]" % (num(row["shift"][k]["shift_in_sigma_full"], "%+.2f"),
                             num(row["shift"][k]["shift_in_expected_sd"], "%+.1f")) for k in keys)))
    w("")

    w("### The values themselves with the cuts (gevp variant, bootstrap errors)")
    w("")
    w("| ensemble | glue m(1) full | 10 % cut | 25 % cut | glue m(2) full | 10 % cut | 25 % cut | a sqrt(sigma) t=1 full | 25 % cut | m/sqrt(sigma) t=1 full | 10 % cut | 25 % cut |")
    w("|---|---|---|---|---|---|---|---|---|---|---|---|")
    for n, j in J.items():
        f, c10, c25 = j["bin_scan"][0]["q"], j["thermalisation_cuts"][0]["q"], j["thermalisation_cuts"][1]["q"]

        def s(d, k):
            return ve(d[k]["value"], d[k]["err_boot"])
        w("| %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s |" % (
            n, s(f, "glue.gevp.m1"), s(c10, "glue.gevp.m1"), s(c25, "glue.gevp.m1"),
            s(f, "glue.gevp.m2"), s(c10, "glue.gevp.m2"), s(c25, "glue.gevp.m2"),
            s(f, "tor.gevp.asNG1"), s(c25, "tor.gevp.asNG1"),
            s(f, "ratio.gevp.NG1"), s(c10, "ratio.gevp.NG1"), s(c25, "ratio.gevp.NG1")))
    w("")
    w("### Time history: consecutive chunks of every stream, pooled over streams")
    w("")
    w("Every stream is cut into n chunks of equal length (n = 10, or 5 if 10 would leave fewer than "
      "%d bins per chunk; not run below that).  chi2 of the chunk values about their weighted mean "
      "(bootstrap error per chunk; p in brackets), and the pull of chunk 0 (the first 1/n of every "
      "stream, taken directly after the 1000 thermalisation updates) against the pooled rest.  "
      "`R3` = C(3)/C(0) of the best single glueball operator." % MIN_BINS)
    w("")
    w("| ensemble | n | chi2/dof (p): glue m(1) | glue m(2) | glue R3 | tor E(1) | plaq | pull chunk 0 vs rest: glue m(1) | glue m(2) | glue R3 | tor E(1) | plaq |")
    w("|---|---|---|---|---|---|---|---|---|---|---|---|")
    hk = ("glue.gevp.m1", "glue.gevp.m2", "glue.single.R3", "tor.gevp.m1", "plaq")
    for n, j in J.items():
        th = j["time_history"]
        if not th["n_chunks"]:
            w("| %s | - | not run (too few bins) | | | | | | | | | |" % n)
            continue

        def c(k):
            x = th["chi2"][k]["boot"]
            return "%.1f/%d (%.3f)" % (x["chi2"], x["dof"], x["p"]) if x["chi2"] is not None else "n/a"
        w("| %s | %d | %s | %s |" % (n, th["n_chunks"], " | ".join(c(k) for k in hk),
                                  " | ".join(num(th["first_chunk_vs_rest"][k]["pull"], "%+.2f") for k in hk)))
    w("")

    w("### Pooled over the independent data sets: is there a common early-time effect?")
    w("")
    indep = [n for n in J if not n.endswith("_combined")]
    w("(a) Thermalisation cuts, pooled over the %d ensembles that share no data: sum of the shifts "
      "(in units of the scatter expected from dropping data) divided by sqrt(number of ensembles).  "
      "Standard normal if nothing depends on Monte Carlo time; the cuts 10 %% and 25 %% are nested and "
      "therefore correlated." % len(indep))
    w("")
    w("| cut | glue m(1) | glue m(2) | glue single m(1) | tor E(1) | tor E(2) | a sqrt(sigma) t=1 | m/sqrt(sigma) t=1 | plaq |")
    w("|---|---|---|---|---|---|---|---|---|")
    pk = ("glue.gevp.m1", "glue.gevp.m2", "glue.single.m1", "tor.gevp.m1", "tor.gevp.m2", "tor.gevp.asNG1", "ratio.gevp.NG1", "plaq")
    for ci, frac in enumerate(THERM_CUTS):
        cells = []
        for k in pk:
            z = [J[n]["thermalisation_cuts"][ci]["shift"][k]["shift_in_expected_sd"] for n in indep]
            z = [x for x in z if x is not None]
            cells.append("%+.2f (%d of %d negative)" % (sum(z) / math.sqrt(len(z)), sum(1 for x in z if x < 0), len(z)))
        w("| %d %% | %s |" % (round(100 * frac), " | ".join(cells)))
    w("")
    rows = [(n, r) for n in indep for r in J[n]["early_vs_late"]["per_stream"] if r["z"]]

    def cnt(sel):
        return sum(1 for n, r in rows if sel(n, r))
    w("(b) First 10 %% of the bins of every stream against the rest of that stream (z per stream, "
      "pooled as sum z / sqrt(n) over the %d streams that have at least 10 bins; `slope` = the same "
      "for the slope of a straight line through the bin means).  These are linear series: `C(t)` is "
      "the per-measurement estimator (1/T) sum_t' O(t') O(t'+t) with the global mean of O subtracted "
      "beforehand." % len(rows))
    w("")
    w("| series | all %d streams | negative z | hot starts (%d) | cold starts (%d) | D = 3 (%d) | D = 4 (%d) | slope, all |" % (
        len(rows), cnt(lambda n, r: r["start"] == "hot"), cnt(lambda n, r: r["start"] == "cold"),
        cnt(lambda n, r: n.startswith("d3")), cnt(lambda n, r: n.startswith("d4"))))
    w("|---|---|---|---|---|---|---|---|")
    for name in rows[0][1]["z"]:
        def pool(sel, key="z"):
            z = [r[key][name] for n, r in rows if sel(n, r) and name in r[key]]
            return sum(z) / math.sqrt(len(z)) if z else float("nan")
        zall = [r["z"][name] for n, r in rows if name in r["z"]]
        w("| %s | %+.2f | %d of %d | %+.2f | %+.2f | %+.2f | %+.2f | %+.2f |" % (
            name, pool(lambda n, r: True), sum(1 for z in zall if z < 0), len(zall),
            pool(lambda n, r: r["start"] == "hot"), pool(lambda n, r: r["start"] == "cold"),
            pool(lambda n, r: n.startswith("d3")), pool(lambda n, r: n.startswith("d4")),
            pool(lambda n, r: True, "slope_z")))
    w("")

    w("## 6. Stream consistency at fixed t = 1 (every stream analysed alone, pipeline bin size)")
    w("")
    w("chi2 of the stream values about their weighted mean; p = chi2 probability.  First entry: with "
      "the bootstrap error of each stream; after the semicolon: chi2 (p) with the ensemble error "
      "scaled to the stream length (robust when a stream has few bins).  Hot/cold: all hot-start "
      "bins pooled against all cold-start bins, pull = difference / error.")
    w("")
    w("| ensemble | streams | bins per stream | glue m(1) gevp chi2/dof (p); scaled | glue m(1) single | tor E(1) gevp | tor E(1) single | plaq | hot-cold pull: glue m(1) | tor E(1) | plaq |")
    w("|---|---|---|---|---|---|---|---|---|---|---|")
    for n, j in J.items():
        sc = j["stream_consistency"]

        def c(k):
            x, y = sc["chi2"][k]["boot"], sc["chi2"][k]["scaled"]
            if x["chi2"] is None:
                return "n/a"
            return "%.2f/%d (%.2f); %.2f (%.2f)" % (x["chi2"], x["dof"], x["p"], y["chi2"], y["p"])
        hc = j.get("hot_vs_cold", {}).get("q", {})

        def hp(k):
            return num(hc.get(k, {}).get("pull_boot"), "%+.2f")
        nb = [r["n_bins"] for r in sc["per_stream"]]
        w("| %s | %d | %d-%d | %s | %s | %s | %s | %s | %s | %s | %s |" % (
            n, len(nb), min(nb), max(nb), c("glue.gevp.m1"), c("glue.single.m1"), c("tor.gevp.m1"),
            c("tor.single.m1"), c("plaq"), hp("glue.gevp.m1"), hp("tor.gevp.m1"), hp("plaq")))
    w("")
    w("### Stream values (glueball m_eff(1), torelon E_eff(1); gevp variant)")
    w("")
    w("| ensemble | stream (start) | bins | glue m(1) | glue m(2) | glue single m(1) | tor E(1) | plaquette |")
    w("|---|---|---|---|---|---|---|---|")
    for n, j in J.items():
        for r in j["stream_consistency"]["per_stream"]:
            q = r["q"]

            def s(k):
                return ve(q[k]["value"], q[k]["err_boot"])
            w("| %s | s%d (%s) | %d | %s | %s | %s | %s | %s |" % (
                n, r["seed"], r["start"], r["n_bins"], s("glue.gevp.m1"), s("glue.gevp.m2"),
                s("glue.single.m1"), s("tor.gevp.m1"), s("plaq")))
    w("")

    w("### Independence of the streams: correlation at equal Monte Carlo time")
    w("")
    w("Pearson correlation of bin means (bin sizes B and 10 B) between every pair of streams at equal "
      "Monte Carlo time, for the plaquette and for the slice average, C(0), C(1), C(2) of the best "
      "glueball operator and C(0), C(1) of the best torelon operator; z = atanh(r) sqrt(n - 3).")
    w("")
    w("| ensemble | pairs x quantities x bin sizes | rms z (expected 1) | max abs z | smallest chi2 probability of one quantity |")
    w("|---|---|---|---|---|")
    for n, j in J.items():
        cs = j["cross_stream_correlation"]
        zs = [z["z"] for c in cs for z in c["pairs"]]
        w("| %s | %d | %.2f | %.2f | %.3f (%s, bins of %d) |" % (
            n, len(zs), math.sqrt(sum(z * z for z in zs) / len(zs)), max(abs(z) for z in zs),
            min(c["p"] for c in cs), *min(((c["p"], c["quantity"], c["binsize"]) for c in cs))[1:]))
    w("")

    for n in ("d3_b9.0_L24_combined", "d4_b2.5_L16_combined"):
        j = J.get(n)
        if not j or "set_comparison" not in j:
            continue
        sc = j["set_comparison"]
        a, b = sc["sets"]
        w("## 7. Two independent sets in %s: %s versus %s" % (n, a, b))
        w("")
        w("Operator choices are those of the combined sample (identical for both sets).  pull = "
          "(set 1 - set 2) / sqrt(err1^2 + err2^2), bootstrap errors.  The 8-stream chi2 is about "
          "the common weighted mean, with the ensemble error scaled to the stream length.")
        w("")
        w("| bin size | quantity | variant | %s | %s | pull | 8-stream chi2/dof (p) |" % (a, b))
        w("|---|---|---|---|---|---|---|")
        by_f = {x["factor"]: x for x in j["stream_consistency_vs_binsize"]}
        for gc in sc["by_binsize"]:
            for ch, nm in (("glue", "glueball m_eff"), ("tor", "torelon E_eff")):
                for t in (1, 2):
                    for var in ("gevp", "single"):
                        k = "%s.%s.m%d" % (ch, var, t)
                        q = gc["q"][k]
                        c = by_f[gc["factor"]]["chi2"].get(k, {}).get("scaled")
                        cs = "%.2f/%d (%.3f)" % (c["chi2"], c["dof"], c["p"]) if (c and c["chi2"] is not None) else ""
                        w("| %d | %s(%d) | %s | %s | %s | %s | %s |" % (
                            gc["binsize"], nm, t, var, ve(q[a]["value"], q[a]["err_boot"]),
                            ve(q[b]["value"], q[b]["err_boot"]), num(q["pull_boot"], "%+.2f"), cs))
        w("")
        w("Correlator-level test (C(t)/C(0), t = 1..4, of one common fixed operator; chi2 of the "
          "difference between the two sets with the full covariance, 4 degrees of freedom):")
        w("")
        w("| bin size | operator | chi2 | p | differences in sigma at t = 1, 2, 3, 4 |")
        w("|---|---|---|---|---|")
        for gc in sc["by_binsize"]:
            for key, t in gc.get("correlator_tests", {}).items():
                w("| %d | %s | %.2f | %.3f | %s |" % (
                    gc["binsize"], key, t["chi2"], t["p"],
                    ", ".join("%+.2f" % (d / e) for d, e in zip(t["diff"], t["diff_err"]))))
        w("")
        w("The same comparison with the first 10 %% / 25 %% of every stream discarded (bin size %d):" % j["binsize"])
        w("")
        w("| cut | quantity | variant | %s | %s | pull | correlator test p (glue.single / glue.fixedvec) |" % (a, b))
        w("|---|---|---|---|---|---|---|")
        for gc in sc.get("with_thermalisation_cut", []):
            ct = gc.get("correlator_tests", {})
            ps = "%s / %s" % (num(ct.get("glue.single", {}).get("p"), "%.3f"), num(ct.get("glue.fixedvec", {}).get("p"), "%.3f"))
            for ch, nm in (("glue", "glueball m_eff"), ("tor", "torelon E_eff")):
                for t in (1, 2):
                    for var in ("gevp", "single"):
                        q = gc["q"]["%s.%s.m%d" % (ch, var, t)]
                        w("| %d %% | %s(%d) | %s | %s | %s | %s | %s |" % (
                            round(100 * gc["discard_fraction"]), nm, t, var, ve(q[a]["value"], q[a]["err_boot"]),
                            ve(q[b]["value"], q[b]["err_boot"]), num(q["pull_boot"], "%+.2f"),
                            ps if ch == "glue" else ""))
        w("")

    w("## 8. Is the connected glueball correlator non-zero?  C(t) / error")
    w("")
    w("`single`: connected correlator of the best single operator, vacuum subtracted inside the "
      "bootstrap.  `fixedvec`: the frozen GEVP combination.  Bootstrap errors.")
    w("")
    w("| ensemble | single t=1 | t=2 | t=3 | t=4 | fixedvec t=1 | t=2 | t=3 | t=4 |")
    w("|---|---|---|---|---|---|---|---|---|")
    for n, j in J.items():
        sg = j["correlator_significance"]["glueball"]
        cells = [num(r["signif_boot"], "%.1f") for var in ("single", "fixedvec") for r in sg[var]["rows"]]
        w("| %s | %s |" % (n, " | ".join(cells)))
    w("")

    w("## 9. Mechanical flags")
    w("")
    w("Thresholds: deviation from the pipeline > 0.3 sigma; my jackknife error differs from the "
      "pipeline error by > 5 %, my bootstrap error by > 20 %; error changes by > 20 % under "
      "re-binning; a thermalisation cut shifts a value by > 1.5 sigma (full-sample error) or by more "
      "than 3 times the scatter expected from dropping data; chi2 probability < 1 % for the streams and "
      "for the time-history chunks, < 0.1 % for the correlation between streams (14 tests per "
      "ensemble); chunk 0 differs from the rest by more than 3 sigma; hot-cold pull beyond 2.58.  A flag is a prompt to look, not a "
      "verdict; with twelve ensembles and dozens of quantities a few flags are expected by chance.")
    w("")
    any_flag = False
    for n, j in J.items():
        for fl in j["flags"]:
            any_flag = True
            t = fl["type"]
            if t == "rebinning_error_change":
                w("- **%s** re-binning x%d (%d bins): error of `%s` changes by factor %.2f (z = %s); "
                  "jackknife error by factor %s (z = %s); z against the scatter expected from the bin count" % (
                      n, fl["factor"], fl["n_bins"], fl["quantity"], fl["error_ratio_boot"],
                      num(fl["z_vs_expected_scatter"], "%+.1f"), num(fl["error_ratio_jack"]),
                      num(fl.get("z_jack"), "%+.1f")))
            elif t == "thermalisation_shift":
                w("- **%s** thermalisation cut %d %%: `%s` shifts by %+.2f sigma (full-sample error), "
                  "%s expected sd" % (n, round(100 * fl["discard_fraction"]), fl["quantity"],
                                      fl["shift_in_sigma_full"], num(fl["shift_in_expected_sd"], "%+.1f")))
            elif t.startswith("stream_"):
                w("- **%s** %s, bin factor %d (min. %d bins per stream), %s errors: `%s` chi2 = %.2f / %d, p = %.4f" % (
                    n, t.replace("_", " "), fl["factor"], fl["min_bins_per_stream"], fl["errors"],
                    fl["quantity"], fl["chi2"], fl["dof"], fl["p"]))
            elif t == "thermalisation_shift_beyond_3_expected_sd":
                w("- **%s** thermalisation cut %d %%: `%s` shifts by %+.2f sigma (full-sample error) = %+.1f times "
                  "the scatter expected from dropping data" % (n, round(100 * fl["discard_fraction"]), fl["quantity"],
                                                               fl["shift_in_sigma_full"], fl["shift_in_expected_sd"]))
            elif t == "time_history_inhomogeneous":
                w("- **%s** time history (%d chunks, %s errors): `%s` chi2 = %.1f / %d, p = %.4f" % (
                    n, fl["n_chunks"], fl["errors"], fl["quantity"], fl["chi2"], fl["dof"], fl["p"]))
            elif t == "first_chunk_differs_from_rest":
                w("- **%s** first 1/%d of every stream against the rest: `%s` = %s versus %s, pull %+.2f" % (
                    n, fl["n_chunks"], fl["quantity"], ve(fl["first"], fl["first_err"]),
                    ve(fl["rest"], fl["rest_err"]), fl["pull"]))
            elif t == "streams_correlated_at_equal_mc_time":
                w("- **%s** correlation between streams at equal Monte Carlo time: `%s`, bins of %d: chi2 = %.1f / %d, p = %.4f" % (
                    n, fl["quantity"], fl["binsize"], fl["chi2"], fl["dof"], fl["p"]))
            elif t == "pipeline_deviation":
                w("- **%s** pipeline deviation: `%s` differs by %+.2f sigma" % (n, fl["quantity"], fl["dev_sigma"]))
            elif t == "hot_cold_difference":
                w("- **%s** hot versus cold: `%s` pull %+.2f" % (n, fl["quantity"], fl["pull"]))
            else:
                w("- **%s** %s: %s" % (n, t, json.dumps({k: v for k, v in fl.items() if k != "type"})))
    if not any_flag:
        w("None.")
    w("")
    path = os.path.join(outdir, "COMPARISON.md")
    with open(path, "w") as f:
        f.write("\n".join(L))
    return path


# ==============================================================================================
# self-test on synthetic data with a known answer
# ==============================================================================================
def selftest():
    rng = np.random.default_rng(7)
    ok = True

    def check(name, cond, detail=""):
        nonlocal ok
        ok = ok and bool(cond)
        print("%-58s %s  %s" % (name, "ok  " if cond else "FAIL", detail))

    # 1. root finder: exact single cosh
    T = 16
    for m in (0.05, 0.4, 1.3, 3.0):
        t = np.arange(T // 2)
        c = np.cosh(m * (np.arange(T // 2 + 1) - T / 2))
        got = np.array([cosh_meff(c[i:i + 1], c[i + 1:i + 2], i, T)[0] for i in t])
        check("cosh_meff exact, m = %.2f" % m, np.max(np.abs(got - m)) < 1e-12, "max dev %.1e" % np.max(np.abs(got - m)))
    # 2. string-tension formulas
    for D, L, sig in ((3, 16, 0.0645), (4, 12, 0.0686), (4, 16, 0.035)):
        E = energy_nambu_goto(sig, L, D)
        s1, s2 = float(sigma_nambu_goto(E, L, D)), sigma_nambu_goto_numeric(E, L, D)
        check("Nambu-Goto inversion D=%d L=%d" % (D, L), abs(s1 - sig) < 1e-13 and abs(s2 - sig) < 1e-11,
              "closed %.3e numeric %.3e" % (s1 - sig, s2 - sig))
        sl = float(sigma_luscher(E, L, D))
        lead = string_c(D) ** 2 / (4.0 * L * L * (2.0 * sl * L * L - string_c(D)))
        check("NG - Luscher = c^2 / (4 L^2 (2 sigma L^2 - c)) [~ c^2/(8 sigma L^4)]", abs((s1 - sl) / lead - 1) < 0.05,
              "ratio %.4f" % ((s1 - sl) / lead))
    # 3. tau_int of AR(1) chains: tau = (1 + rho) / (2 (1 - rho))
    for rho in (0.0, 0.5, 0.9):
        ser = []
        for _ in range(4):
            e = rng.standard_normal(40000)
            x = np.empty_like(e)
            x[0] = e[0] / math.sqrt(1 - rho * rho)
            for i in range(1, len(e)):
                x[i] = rho * x[i - 1] + e[i]
            ser.append(x + 3.0)
        t, err, W = tau_int_sokal(ser)
        exact = (1 + rho) / (2 * (1 - rho))
        check("tau_int AR(1) rho = %.1f (exact %.3f)" % (rho, exact), abs(t - exact) < 4 * err + 0.02 * exact,
              "%.3f +- %.3f, W = %d" % (t, err, W))
        tb, nb = tau_int_binning(ser, int(math.ceil(20 * exact)))
        check("  binning estimate", abs(tb - exact) < 0.25 * exact + 0.05, "%.3f (%d bins)" % (tb, nb))
    # 4. full chain on synthetic two-state data with a large vacuum expectation value
    T, K, n, nstream = 16, 4, 6000, 3
    masses = np.array([0.6, 1.5])
    tt = np.arange(T)
    dist = np.minimum(tt[:, None] - tt[None, :], T) % T
    chol = [np.linalg.cholesky(np.cosh(m * (dist - T / 2)) / np.cosh(m * T / 2) + 1e-12 * np.eye(T)) for m in masses]
    z = np.array([[1.0, 0.9], [1.0, 0.5], [1.0, 0.2], [0.8, 1.0]])
    vev = np.array([5000.0, 800.0, 12000.0, 30.0])
    streams = []
    for s in range(nstream):
        phi = np.stack([rng.standard_normal((n, T)) @ c.T for c in chol], axis=1)      # (n, 2, T)
        O = np.einsum("ks,nst->nkt", z, phi) + vev[None, :, None] + 0.05 * rng.standard_normal((n, K, T))
        tor = np.einsum("ks,nst->nkt", z[:2], phi)[:, None, :, :] * np.ones((1, 2, 1, 1)) \
            + 0.05 * rng.standard_normal((n, 2, 2, T))
        streams.append({"glue": O, "tor": tor, "plaq": rng.standard_normal(n),
                        "meta": {"seed": s, "start": "hot"}, "file": "synthetic%d" % s, "set": "syn"})
    off = sum(st["glue"].mean(axis=2).sum(axis=0) for st in streams) / (n * nstream)
    for st in streams:
        primaries(st, off)
    # time-reflection identity used in the symmetrisation
    g = streams[0]["glue"][:50] - off[None, :, None]
    a3 = np.matmul(g, np.roll(g, -3, axis=2).transpose(0, 2, 1)) / T
    a13 = np.matmul(g, np.roll(g, -(T - 3), axis=2).transpose(0, 2, 1)) / T
    check("A_kl(T - tau) = A_lk(tau)", np.max(np.abs(a13 - a3.transpose(0, 2, 1))) < 1e-9 * np.max(np.abs(a3)))
    meta = {"T": T, "D": 3, "torelon_L": [16, 16], "glue_ops": ["a", "b", "c", "d"], "torelon_ops": ["a", "b"]}
    bins = make_bins(streams, 10)
    cfg = build_config(bins, meta)
    res = Res(bins, cfg, 500, rng, jack=True)
    for var in VARIANTS:
        for t in (1, 2, 3):
            k = "glue.%s.m%d" % (var, t)
            v, e = res.val(k), res.eb(k)
            if var == "single":
                # exact effective mass of the best single operator
                kb = cfg["glue"]["best"]
                ex = [np.sum(z[kb] ** 2 * np.cosh(masses * (x - T / 2)) / np.cosh(masses * T / 2)) for x in (t, t + 1)]
                target = cosh_meff(np.array([ex[0]]), np.array([ex[1]]), t, T)[0]
            else:
                target = masses[0]
            lim = 4.0 * e + (0.02 if var != "single" else 0.0)
            check("synthetic %s m_eff(%d) vs %.4f" % (var, t, target), abs(v - target) < lim,
                  "%.4f +- %.4f (boot) %.4f (jack)" % (v, e, res.ej(k)))
    check("bootstrap and jackknife errors agree (m_eff(1), gevp)",
          abs(res.eb("glue.gevp.m1") / res.ej("glue.gevp.m1") - 1) < 0.15,
          "ratio %.3f" % (res.eb("glue.gevp.m1") / res.ej("glue.gevp.m1")))
    # vacuum subtraction must not depend on the constant offset
    for st in streams:
        primaries(st, off + np.array([3.0, -2.0, 7.0, 0.5]))
    bins2 = make_bins(streams, 10)
    g1a, g1b = bins["g1"].mean(0), bins2["g1"].mean(0)
    Ca = bins["g2"].mean(0) - g1a[:, None, None] * g1a[None, :, None]
    Cb = bins2["g2"].mean(0) - g1b[:, None, None] * g1b[None, :, None]
    check("connected correlator independent of the constant offset", np.max(np.abs(Ca - Cb)) < 1e-9 * np.max(np.abs(Ca)),
          "max dev %.1e" % np.max(np.abs(Ca - Cb)))
    print("SELFTEST", "PASSED" if ok else "FAILED")
    return 0 if ok else 1


# ==============================================================================================
def _worker(job):
    name, argd = job
    args = argparse.Namespace(**argd)
    t0 = time.time()
    path, out = run_ensemble(name, args)
    return name, path, time.time() - t0, len(out["flags"]), (out.get("comparison_with_pipeline") or {}).get("max_abs_dev_sigma")


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("names", nargs="*", help="ensemble names (see ENSEMBLES)")
    p.add_argument("--all", action="store_true", help="all twelve ensembles")
    p.add_argument("--jobs", type=int, default=1)
    p.add_argument("--raw-dir", default=os.path.join(HERE, "results", "raw"))
    p.add_argument("--pipeline-dir", default=os.path.join(HERE, "results"))
    p.add_argument("--outdir", default=os.path.join(HERE, "results", "independent"))
    p.add_argument("--nboot", type=int, default=2000, help="bootstrap samples (main analyses)")
    p.add_argument("--nboot-sub", type=int, default=1000, help="bootstrap samples (single streams, hot/cold)")
    p.add_argument("--seed", type=int, default=20261111)
    p.add_argument("--binsize", type=int, default=0, help="override the bin size (default: pipeline's)")
    p.add_argument("--table", action="store_true", help="write COMPARISON.md from the JSON files")
    p.add_argument("--selftest", action="store_true")
    args = p.parse_args(argv)
    if args.selftest:
        return selftest()
    names = ORDER if args.all else args.names
    for n in names:
        if n not in ENSEMBLES:
            raise SystemExit("unknown ensemble %r; known: %s" % (n, ", ".join(ORDER)))
    if names:
        jobs = [(n, vars(args)) for n in names]
        if args.jobs > 1 and len(jobs) > 1:
            import concurrent.futures as cf
            # largest ensembles first
            size = {n: sum(os.path.getsize(q) for _, q in ensemble_paths(n, args.raw_dir)) for n in names}
            jobs.sort(key=lambda j: -size[j[0]])
            with cf.ProcessPoolExecutor(max_workers=args.jobs) as ex:
                results = list(ex.map(_worker, jobs))
        else:
            results = [_worker(j) for j in jobs]
        for name, path, dt, nflags, dev in results:
            print("%-22s %6.1f s  flags %2d  max |dev| vs pipeline %s  -> %s"
                  % (name, dt, nflags, "n/a" if dev is None else "%.2e sigma" % dev, path))
    if args.table or args.all:
        print("wrote", write_table(args.outdir, args.pipeline_dir))
    return 0


if __name__ == "__main__":
    sys.exit(main())
