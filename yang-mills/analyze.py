#!/usr/bin/env python3
"""Analysis of raw production files (written by run_production.py) of ONE ensemble.

    python3 analyze.py results/raw/d3_b6.0_L16_s1.npz results/raw/d3_b6.0_L16_s2.npz \\
        --name d3_b6.0_L16 --outdir results

Different files = independent streams (different seeds) of the same ensemble (same shape, beta,
update and operator parameters; this is checked, and two files with the same seed are refused).
Nothing is discarded silently: measurements dropped by --discard or because they do not fill a
whole bin are counted in the output.

Writes  <outdir>/<name>.json  and the plots  <outdir>/<name>_glueball_meff.png,
<outdir>/<name>_torelon_meff.png, <outdir>/<name>_correlators.png.

All analysis choices (correlator definition, operator selection, GEVP, effective mass, plateau
rule, string-tension formulas, binning) are the PRE-REGISTERED rules R1-R8 documented at the
top of ym/stats.py.  The bin size is, unless given with --binsize,

    B = ceil(10 * tau_max),   tau_max = max(1/2, largest integrated autocorrelation time among:
        the plaquette; for every glueball operator the time-slice average, the C(0) and the
        C(1) estimators; for every torelon operator the same three quantities)

(bins of 10 tau_int underestimate the variance by at most about tau_int/B = 10 %, i.e. the error
by about 5 %; the analysis is repeated with bins of 2B and both results are stored).

JSON schema (all quantities in lattice units; null = not available)
-------------------------------------------------------------------
ensemble, generated_utc, analysis_format, disclaimer
D, shape, T, L_spatial, beta, update{nhb,nor,nskip}, smearing{levels,w,loops}
streams[]            {file, seed, start, ntherm, n_meas, n_discarded, n_dropped_binning, n_used,
                      complete, plaquette_mean, plaquette_err, wall_clock_s, seconds_per_cycle,
                      therm_check{first_quarter,rest,pull}}
                     (n_discarded = dropped by --discard only; plaquette_err = error of this
                      stream alone from its own tau_int, null for fewer than 8 measurements)
n_meas_total, n_meas_used, n_discarded_total (= n_meas_total - n_meas_used, i.e. dropped by
                     --discard PLUS dropped because they do not fill a bin),
binsize, binsize_rule, n_bins, tau_int_max,
tau_int_table[]      {quantity, tau_int, tau_int_err, window}
stream_consistency   {plaquette{chi2, dof, n_streams}, hot_minus_cold{diff, err, pull,
                      n_hot, n_cold}}   independent streams / start types must agree
caveats[]            statements that must accompany every number quoted from this file
plaquette            {mean, err, tau_int, tau_int_err, err_from_tau_int, err_naive,
                      spatial{mean,err}, temporal{mean,err}}
glueball (D >= 3)    channel block, see below, with  am, am_err
torelon              channel block of the PRIMARY winding length (largest L), with  aE, aE_err, L,
                     n_directions, vev_check[] {direction, operator, mean, err}
torelon_all[]        one channel block per distinct spatial extent
string_tension       {L, luscher{sigma_a2, sigma_a2_err, a_sqrt_sigma, a_sqrt_sigma_err},
                      nambu_goto{...same...}, upper_bound_only,
                      fixed_t[] {t, aE, aE_err, luscher{a_sqrt_sigma, a_sqrt_sigma_err},
                                 nambu_goto{...}}  for t = 1, 2 (no plateau selection)}
ratios               {m_over_sqrt_sigma{luscher{value,err}, nambu_goto{value,err}},
                      upper_bound_only}
D3 (D = 3)           {beta_am_over_4{value,err}  (= m/g^2 up to lattice artefacts),
                      beta_a_sqrt_sigma_over_4{value,err}  (= sqrt(sigma)/g^2)}
D4 (D = 4)           {a_lambda_two_loop, m_over_lambda{value,err}, sqrt_sigma_over_lambda{...}}
D2 (D = 2)           {sigma_exact, torelon_energy_exact, pull_torelon_energy,
                      torelon_correlator[] ..., plaquette_exact, plaquette_pull,
                      plaquette_null_test{...}}
binning_check        {binsize, glueball{am,am_err,t_star,flag}, torelon{aE,aE_err,t_star,flag}}
plots[], warnings[]

channel block:
    mass, err            value of rule R5 (m_eff(t*), jackknife error at fixed t*)
    t_star, flag ('plateau' | 'no plateau' | 'no signal'), plateau (bool), upper_bound_only,
    t_value              the t whose m_eff is quoted
    meff_table[]         {t, m_cosh, err_cosh, m_log, err_log, C, C_err}  for t = 0 .. T/2-1
    meff_t0_5[]          the first six rows (always present)
    fixed_t              {t1{m,err}, t2{m,err}, t1_minus_t2{value,err}}: effective masses at
                         FIXED t = 1 and 2 and their difference (jackknife error of the
                         difference).  No selection is involved, so these errors have nominal
                         coverage; quote them next to the R5 value (see ``caveats``)
    plateau_checks[]     numbers that entered rule R5 for every tested t
    gevp                 {t0, min_eig, operators[], selected[], eigenvalues[], lambda0_err,
                          eigenvector[], decisions[], quality[], naive_energies[], n_fallback}
    overlap              C_proj(t_value)/C_proj(0) corrected for the cosh factor
    operators[]          per-operator diagnostics {label, C0, C0_err, C1_over_C0,
                          C1_over_C0_err, meff[] (t = 0..3), meff_err[]}
    cosh_fit             {ok, m, err, A, chi2, dof, tmin, tmax, n_points} (rule R6, cross-check)
    n_bins, binsize, n_used, n_dropped

Everything produced here is numerical evidence at finite lattice spacing and volume.  It is
NOT a proof of the Yang-Mills mass-gap problem and must never be presented as one.
"""
from __future__ import annotations

import argparse
import datetime
import json
import math
import os
import re
import sys

import numpy as np

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from ym import exact, stats  # noqa: E402

ANALYSIS_FORMAT = "ym-analysis-1"
ENSEMBLE_KEYS = ("shape", "beta", "nhb", "nor", "nskip", "levels", "w", "loops")
DISCLAIMER = ("Numerical Monte Carlo evidence for one lattice ensemble (finite lattice spacing, "
              "finite volume, statistical errors only). Not a proof of the Yang-Mills mass gap.")
BIN_TAU_FACTOR = 10.0
#: Statements that must accompany every number quoted from an analysis file.  They describe
#: declared properties of the pre-registered rules (ym/stats.py), quantified by the review
#: tests (tests/test_stats.py, tests/test_adversarial_analysis.py); the rules themselves are
#: not changed.
CAVEATS = (
    "Plateau rule R5 chooses t* with the same data that give m_eff(t*): the quoted jackknife "
    "error does not include this selection effect. Synthetic tests at production-like "
    "signal-to-noise found 52-65 % of the results within 1 sigma of the truth (nominal 68 %), "
    "91-97 % within 2 sigma, rms pull 1.1-1.2. Always read the fixed-t values (blocks "
    "'fixed_t', 'meff_table') next to the R5 value, treat m_eff(1) - m_eff(2) as a systematic "
    "uncertainty, and do not claim agreement or disagreement with other results at the "
    "1 sigma level from the R5 number alone.",
    "m_eff(t*) of a positive correlator is a variational UPPER estimate of the ground-state "
    "energy; its error is statistical only.",
    "A value flagged 'upper_bound_only' ('no plateau') is not a measurement and must not be "
    "quoted as one; rule R5 has no significance requirement on the correlator itself.",
    "One lattice spacing and one volume: no continuum or infinite-volume extrapolation is "
    "contained in this file. Numerical evidence, not a proof of the mass gap.",
)


# ==============================================================================================
# helpers
# ==============================================================================================
def clean(obj):
    """Convert numpy objects to plain python; NaN / inf become None (valid JSON)."""
    if isinstance(obj, dict):
        return {str(k): clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [clean(v) for v in obj]
    if isinstance(obj, np.ndarray):
        return clean(obj.tolist())
    if isinstance(obj, (np.bool_, bool)):
        return bool(obj)
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (float, np.floating)):
        f = float(obj)
        return f if math.isfinite(f) else None
    return obj


def load_raw(path):
    with np.load(path, allow_pickle=False) as z:
        meta = json.loads(str(z["meta"]))
        need = ("glue", "torelon", "plaq", "plaq_s", "plaq_t", "plaq_t_slices", "plaq_s_slices")
        arrays = {k: z[k] for k in need}
    return meta, arrays


def default_name(paths):
    base = os.path.basename(paths[0])
    base = re.sub(r"\.npz$", "", base)
    return re.sub(r"_s\d+$", "", base)


def channel_block(r, labels, T):
    """JSON block of one channel from the dict returned by stats.analyze_channel."""
    blk = {"mass": r["mass"], "err": r["err"],
           "t_star": r["plateau"]["t_star"], "flag": r["plateau"]["flag"],
           "plateau": r["plateau"]["plateau"],
           "upper_bound_only": r["plateau"]["upper_bound_only"],
           "t_value": r["plateau"]["t_value"],
           "n_bins": r["n_bins"], "binsize": r["binsize"], "n_used": r["n_used"],
           "n_dropped": r["n_dropped"]}
    ops = []
    for o in r["operator_table"]:
        ops.append({"label": labels[o["index"]], "C0": o["C0"], "C0_err": o["C0_err"],
                    "C1_over_C0": o["C1_over_C0"], "C1_over_C0_err": o["C1_over_C0_err"],
                    "meff": list(o["m_cosh"][:4]), "meff_err": list(o["err_cosh"][:4])})
    blk["operators"] = ops
    if r.get("gevp") is None:
        blk.update({"error": r.get("error"), "meff_table": [], "meff_t0_5": [],
                    "fixed_t": None,
                    "plateau_checks": [], "gevp": None, "overlap": None, "cosh_fit": None})
        return blk
    me = r["meff"]
    table = []
    for t in range(T // 2):
        table.append({"t": t, "m_cosh": me["m_cosh"][t], "err_cosh": me["err_cosh"][t],
                      "m_log": me["m_log"][t], "err_log": me["err_log"][t],
                      "C": r["Cproj"][t], "C_err": r["Cproj_err"][t]})
    blk["meff_table"] = table
    blk["meff_t0_5"] = table[:6]
    # effective masses at FIXED t (no selection), to be quoted next to the value of rule R5
    mjk = np.asarray(me["m_cosh_jk"], dtype=np.float64)
    ft = {}
    for t in (1, 2):
        if t < T // 2:
            ft["t%d" % t] = {"m": me["m_cosh"][t], "err": me["err_cosh"][t]}
    if T // 2 > 2:
        d = me["m_cosh"][1] - me["m_cosh"][2]
        ft["t1_minus_t2"] = {"value": d,
                             "err": (stats.jackknife_error(mjk[:, 1] - mjk[:, 2])
                                     if np.isfinite(d) else None)}
    blk["fixed_t"] = ft
    blk["plateau_checks"] = r["plateau"]["checks"]
    g = r["gevp"]
    lam = np.asarray(g["eigenvalues"], dtype=np.float64)
    with np.errstate(divide="ignore", invalid="ignore"):
        naive = np.where(lam > 0, -np.log(np.where(lam > 0, lam, 1.0)), np.nan)
    blk["gevp"] = {"t0": r["t0"], "min_eig": r["min_eig"], "operators": list(labels),
                   "selected": [labels[k] for k in g["selected"]],
                   "eigenvalues": lam, "lambda0_err": g["lambda0_err"],
                   "eigenvector": g["eigenvector"],
                   "decisions": g["selection"]["decisions"],
                   "quality": g["selection"]["quality"],
                   "naive_energies": naive, "n_fallback": g["n_fallback"]}
    blk["overlap"] = r["overlap"]
    fit = r.get("fit")
    blk["cosh_fit"] = ({k: v for k, v in fit.items() if k != "m_jk"} if fit else None)
    return blk


def plot_meff(path, r, blk, title, ylabel, extra_lines=()):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(6.4, 4.4))
    me = r["meff"]
    t = np.asarray(me["t"], dtype=float)
    m = np.asarray(me["m_cosh"], dtype=float)
    e = np.asarray(me["err_cosh"], dtype=float)
    ok = np.isfinite(m) & np.isfinite(e)
    ax.errorbar(t[ok], m[ok], yerr=e[ok], fmt="o", color="C0", capsize=3,
                label="GEVP ground state, cosh $m_{\\rm eff}(t)$")
    bad = np.isfinite(m) & ~np.isfinite(e)
    if bad.any():
        ax.plot(t[bad], m[bad], "o", mfc="none", color="C0", label="error undefined")
    # best single operator for comparison
    best = max(r["operator_table"],
               key=lambda o: o["C1_over_C0"] if np.isfinite(o["C1_over_C0"]) else -1)
    mb = np.asarray(best["m_cosh"], dtype=float)
    eb = np.asarray(best["err_cosh"], dtype=float)
    okb = np.isfinite(mb) & np.isfinite(eb)
    ax.errorbar(t[okb] + 0.12, mb[okb], yerr=eb[okb], fmt="s", ms=4, color="0.6", capsize=2,
                label="best single operator")
    if blk["t_value"] is not None and blk["mass"] is not None and np.isfinite(r["mass"]):
        tv = blk["t_value"]
        lab = ("plateau rule: $t^*$=%d, %.4f(%.0f)" % (tv, r["mass"], 1e4 * r["err"])
               if blk["plateau"] else
               "NO PLATEAU: upper bound from t=%d, %.4f(%.0f)" % (tv, r["mass"], 1e4 * r["err"]))
        col = "C3" if blk["plateau"] else "C1"
        ax.axhspan(r["mass"] - r["err"], r["mass"] + r["err"], xmin=0, xmax=1, color=col,
                   alpha=0.25, label=lab)
        ax.axvline(tv, color=col, ls=":", lw=1)
    for y, lab, col in extra_lines:
        ax.axhline(y, color=col, ls="--", lw=1, label=lab)
    good = ok & (e < 0.5 * np.abs(m))
    if good.any():
        lo = float(np.min(m[good] - e[good]))
        hi = float(np.max(m[good] + e[good]))
        pad = 0.15 * (hi - lo + 1e-12)
        ax.set_ylim(max(0.0, lo - pad), hi + pad)
        ax.set_xlim(-0.5, float(t[good].max()) + 1.5)
    ax.set_xlabel("t / a")
    ax.set_ylabel(ylabel)
    ax.set_title(title, fontsize=9)
    ax.legend(fontsize=7, loc="best")
    fig.tight_layout()
    fig.savefig(path, dpi=130)
    plt.close(fig)


def plot_correlators(path, items, T, title):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(6.4, 4.4))
    for i, (lab, r) in enumerate(items):
        if r.get("Cproj") is None:
            continue
        c = np.asarray(r["Cproj"], dtype=float)
        e = np.asarray(r["Cproj_err"], dtype=float)
        t = np.arange(c.size)
        ok = (c > 0) & np.isfinite(e)
        ax.errorbar(t[ok] + 0.06 * i, c[ok] / c[0], yerr=e[ok] / c[0], fmt="o", ms=4,
                    capsize=2, color="C%d" % i, label=lab)
        fit = r.get("fit")
        if fit and fit.get("ok"):
            tt = np.linspace(fit["tmin"], fit["tmax"], 100)
            ax.plot(tt, fit["A"] * np.cosh(fit["m"] * (tt - T / 2.0)) / c[0], "-",
                    color="C%d" % i, lw=1)
    ax.set_yscale("log")
    ax.set_xlabel("t / a")
    ax.set_ylabel("$C_{\\rm proj}(t) / C_{\\rm proj}(0)$")
    ax.set_title(title, fontsize=9)
    ax.legend(fontsize=7)
    fig.tight_layout()
    fig.savefig(path, dpi=130)
    plt.close(fig)


# ==============================================================================================
# main analysis
# ==============================================================================================
def _tau_entry(name, series):
    t, dt, W = stats.tau_int(series)
    return {"quantity": name, "tau_int": t, "tau_int_err": dt, "window": W}


def _shifted_products(streams_o):
    """Per-configuration estimators of the time-slice average, C(0) and C(1) of one operator.
    streams_o: list of arrays (N, T) (already shifted by a common reference value)."""
    avg = [o.mean(axis=1) for o in streams_o]
    c0 = [(o * o).mean(axis=1) for o in streams_o]
    c1 = [(o * np.roll(o, -1, axis=1)).mean(axis=1) for o in streams_o]
    return avg, c0, c1


def analyze(paths, name=None, outdir="results", binsize=None, discard=0, make_plots=True,
            t0=stats.GEVP_T0, min_eig=stats.MIN_EIG, quiet=False):
    """Analyse the raw files ``paths`` (one ensemble) and write JSON + plots.  Returns the
    result dictionary (already JSON-clean)."""
    paths = list(paths)
    if not paths:
        raise ValueError("no input files")
    name = name or default_name(paths)
    warnings = []

    # ------------------------------------------------------------------ load and check
    metas, data = [], []
    for p in paths:
        m, a = load_raw(p)
        if m.get("format") != "ym-raw-1":
            raise ValueError("%s: unknown raw format %r" % (p, m.get("format")))
        metas.append(m)
        data.append(a)
    ref = metas[0]
    for p, m in zip(paths, metas):
        for key in ENSEMBLE_KEYS:
            if m[key] != ref[key]:
                raise ValueError("%s is not the same ensemble as %s: %s = %r vs %r"
                                 % (p, paths[0], key, m[key], ref[key]))
    seeds = [m["seed"] for m in metas]
    if len(set(seeds)) != len(seeds):
        raise ValueError("two input files have the same seed %r: they are the same stream, "
                         "using both would double count" % (seeds,))
    shape = tuple(ref["shape"])
    D = len(shape)
    T = shape[0]
    beta = float(ref["beta"])
    glue_labels = list(ref["glue_ops"])
    tor_labels = list(ref["torelon_ops"])
    discard = int(discard)
    for p, m in zip(paths, metas):
        if not m.get("complete", False):
            warnings.append("%s is an incomplete run (%d of %d measurements; reason: %s)"
                            % (os.path.basename(p), m["nmeas_done"], m["nmeas_requested"],
                               m.get("stop_reason")))
        if m["ntherm_done"] < m["ntherm"]:
            raise ValueError("%s: thermalisation not finished" % p)

    # per-stream arrays after the explicit discard
    S = []
    for a in data:
        n = a["plaq"].shape[0]
        if n <= discard:
            raise ValueError("a stream has only %d measurements, cannot discard %d" % (n, discard))
        S.append({k: np.asarray(v[discard:], dtype=np.float64) for k, v in a.items()})
    n_total = sum(a["plaq"].shape[0] for a in data)
    n_after = sum(s["plaq"].shape[0] for s in S)

    # ------------------------------------------------------------------ autocorrelations
    tau_table = [_tau_entry("plaquette", [s["plaq"] for s in S])]
    if D > 2:
        nop = S[0]["glue"].shape[1]
        gref = sum(s["glue"].sum(axis=(0, 2)) for s in S) / (n_after * T)
        for k in range(nop):
            avg, c0, c1 = _shifted_products([s["glue"][:, k, :] - gref[k] for s in S])
            tau_table.append(_tau_entry("glue %s: time-slice average" % glue_labels[k], avg))
            tau_table.append(_tau_entry("glue %s: C(0)" % glue_labels[k], c0))
            tau_table.append(_tau_entry("glue %s: C(1)" % glue_labels[k], c1))
    ndir = D - 1
    for i in range(ndir):
        for k in range(len(tor_labels)):
            avg, c0, c1 = _shifted_products([s["torelon"][:, i, k, :] for s in S])
            lab = "torelon dir %d %s" % (i + 1, tor_labels[k])
            tau_table.append(_tau_entry(lab + ": time-slice average", avg))
            tau_table.append(_tau_entry(lab + ": C(0)", c0))
            tau_table.append(_tau_entry(lab + ": C(1)", c1))
    for e in tau_table:
        if not math.isfinite(e["tau_int_err"]):
            warnings.append("tau_int window not reached for '%s' (series too short for its "
                            "autocorrelation); tau_int is a lower estimate" % e["quantity"])
    tau_max = max(0.5, max(e["tau_int"] for e in tau_table))
    if binsize is None:
        B = max(1, int(math.ceil(BIN_TAU_FACTOR * tau_max)))
        rule = "auto: ceil(%g * tau_int_max), tau_int_max = %.3f" % (BIN_TAU_FACTOR, tau_max)
    else:
        B = int(binsize)
        rule = "given on the command line"
        if B < BIN_TAU_FACTOR * tau_max:
            warnings.append("bin size %d is smaller than %g * tau_int_max = %.1f: errors may be "
                            "underestimated" % (B, BIN_TAU_FACTOR, BIN_TAU_FACTOR * tau_max))
    n_bins = sum(s["plaq"].shape[0] // B for s in S)
    if n_bins < 2:
        raise ValueError("fewer than 2 bins (bin size %d, %d measurements): more data needed"
                         % (B, n_after))
    if n_bins < 30:
        warnings.append("only %d jackknife bins: error estimates are themselves uncertain by "
                        "about %.0f %%" % (n_bins, 100.0 / math.sqrt(2.0 * (n_bins - 1))))

    # ------------------------------------------------------------------ streams summary
    stream_info = []
    for p, m, a, s in zip(paths, metas, data, S):
        n = s["plaq"].shape[0]
        q = max(1, n // 4)
        first, rest = s["plaq"][:q], s["plaq"][q:]
        tc = None
        if rest.size >= 8 and first.size >= 8:
            r1 = stats.mean_err_tau(first)
            r2 = stats.mean_err_tau(rest)
            den = math.hypot(r1["err"], r2["err"])
            tc = {"first_quarter": r1["mean"], "first_quarter_err": r1["err"],
                  "rest": r2["mean"], "rest_err": r2["err"],
                  "pull": (r1["mean"] - r2["mean"]) / den if den > 0 else None}
            if den > 0 and abs(r1["mean"] - r2["mean"]) > 4.0 * den:
                warnings.append("%s: plaquette of the first quarter differs from the rest by "
                                "%.1f sigma (thermalisation?)"
                                % (os.path.basename(p), (r1["mean"] - r2["mean"]) / den))
        stream_info.append({"file": os.path.basename(p), "seed": m["seed"], "start": m["start"],
                            "ntherm": m["ntherm"], "n_meas": int(a["plaq"].shape[0]),
                            "n_discarded": discard, "n_dropped_binning": int(n - (n // B) * B),
                            "n_used": int((n // B) * B), "complete": bool(m.get("complete")),
                            "plaquette_mean": float(s["plaq"].mean()),
                            "plaquette_err": None,
                            "wall_clock_s": m.get("wall_clock_s"),
                            "seconds_per_cycle": m.get("seconds_per_cycle"),
                            "therm_check": tc})
    n_used = sum(si["n_used"] for si in stream_info)

    out = {"ensemble": name,
           "generated_utc": datetime.datetime.now(datetime.timezone.utc).strftime(
               "%Y-%m-%dT%H:%M:%SZ"),
           "analysis_format": ANALYSIS_FORMAT, "disclaimer": DISCLAIMER,
           "rules": "pre-registered rules R1-R8, see the docstring of ym/stats.py",
           "D": D, "shape": list(shape), "T": T, "L_spatial": list(shape[1:]), "beta": beta,
           "update": {"nhb": ref["nhb"], "nor": ref["nor"], "nskip": ref["nskip"]},
           "smearing": {"levels": ref["levels"], "w": ref["w"], "loops": ref["loops"]},
           "streams": stream_info, "n_meas_total": int(n_total), "n_meas_used": int(n_used),
           "n_discarded_total": int(n_total - n_used), "binsize": B, "binsize_rule": rule,
           "n_bins": int(n_bins), "tau_int_max": tau_max, "tau_int_table": tau_table}

    # ------------------------------------------------------------------ stream consistency
    # Independent streams (and hot-start vs cold-start streams) must agree.  Plaquette only:
    # for the masses, analyse subsets of the files (e.g. the hot and the cold streams
    # separately) with this program.  Every stream gets its OWN autocorrelation-corrected
    # error here (not the ensemble bin size: if the streams disagree, the pooled
    # autocorrelation function, and with it the bin size, is inflated by the disagreement).
    per = []
    for si, m, s_ in zip(stream_info, metas, S):
        if s_["plaq"].shape[0] >= 8:
            r_ = stats.mean_err_tau(s_["plaq"])
            if math.isfinite(r_["err"]) and r_["err"] > 0:
                si["plaquette_err"] = r_["err"]
                per.append((m["start"], r_["mean"], r_["err"]))

    def _wmean(items):
        w = np.array([1.0 / e ** 2 for _, _, e in items])
        v = np.array([x for _, x, _ in items])
        return float(np.sum(w * v) / np.sum(w)), float(1.0 / math.sqrt(np.sum(w)))

    sc = {"plaquette": None, "hot_minus_cold": None,
          "note": "plaquette means of the individual streams, each with the error from its own "
                  "integrated autocorrelation time; chi2 about their weighted mean"}
    if len(per) >= 2:
        wm, _ = _wmean(per)
        chi2 = float(sum(((x - wm) / e) ** 2 for _, x, e in per))
        dof = len(per) - 1
        sc["plaquette"] = {"chi2": chi2, "dof": dof, "n_streams": len(per)}
        if chi2 > dof + 4.0 * math.sqrt(2.0 * dof):
            warnings.append("the plaquette means of the %d streams are inconsistent: chi2 = "
                            "%.1f for %d degrees of freedom" % (len(per), chi2, dof))
    hot = [x for x in per if x[0] == "hot"]
    cold = [x for x in per if x[0] == "cold"]
    if hot and cold:
        (mh, eh), (mc, ec) = _wmean(hot), _wmean(cold)
        diff, derr = mh - mc, math.hypot(eh, ec)
        sc["hot_minus_cold"] = {"diff": diff, "err": derr, "pull": diff / derr,
                                "n_hot": len(hot), "n_cold": len(cold)}
        if abs(diff) > 4.0 * derr:
            warnings.append("hot-start and cold-start streams differ in the plaquette by "
                            "%.1f sigma (thermalisation or ergodicity problem?)"
                            % (diff / derr))
    out["stream_consistency"] = sc
    out["caveats"] = list(CAVEATS)

    # ------------------------------------------------------------------ plaquette
    def binned(key):
        return np.concatenate([stats.bin_means(s[key], B) for s in S])

    pl = stats.mean_err_tau([s["plaq"] for s in S])
    pb = binned("plaq")
    pm, pe, _ = stats.jackknife(lambda x: x, pb)
    plaq = {"mean": pm, "err": pe, "tau_int": pl["tau_int"], "tau_int_err": pl["tau_int_err"],
            "err_from_tau_int": pl["err"], "err_naive": pl["err_naive"],
            "mean_all_measurements": pl["mean"]}
    ptm, pte, _ = stats.jackknife(lambda x: x, binned("plaq_t"))
    plaq["temporal"] = {"mean": ptm, "err": pte}
    if D > 2:
        psm, pse, _ = stats.jackknife(lambda x: x, binned("plaq_s"))
        plaq["spatial"] = {"mean": psm, "err": pse}
    else:
        plaq["spatial"] = None
    out["plaquette"] = plaq

    # ------------------------------------------------------------------ glueball
    rg = None
    if D > 2:
        rg = stats.analyze_channel([s["glue"] for s in S], T, B, subtract_vev=True,
                                   t0=t0, min_eig=min_eig)
        gb = channel_block(rg, glue_labels, T)
        gb["am"] = gb["mass"]
        gb["am_err"] = gb["err"]
        gb["vev"] = [{"operator": glue_labels[k], "mean": rg["vev"][0, k],
                      "err": rg["vev_err"][0, k]} for k in range(len(glue_labels))]
        out["glueball"] = gb
        if not gb["plateau"]:
            warnings.append("glueball: %s -> the quoted mass is %s"
                            % (gb["flag"], "an upper bound only" if gb["upper_bound_only"]
                               else "not available"))
    else:
        out["glueball"] = None

    # ------------------------------------------------------------------ torelon
    groups = {}
    for i in range(ndir):
        groups.setdefault(int(shape[i + 1]), []).append(i)
    tor_results = {}
    tor_blocks = []
    for L in sorted(groups, reverse=True):
        dirs = groups[L]
        rt = stats.analyze_channel([s["torelon"][:, dirs] for s in S], T, B, subtract_vev=False,
                                   t0=t0, min_eig=min_eig)
        tb = channel_block(rt, tor_labels, T)
        tb["aE"] = tb["mass"]
        tb["aE_err"] = tb["err"]
        tb["L"] = L
        tb["directions"] = [d + 1 for d in dirs]
        tb["n_directions"] = len(dirs)
        vc = []
        for gi, d in enumerate(dirs):
            for k in range(len(tor_labels)):
                vc.append({"direction": d + 1, "operator": tor_labels[k],
                           "mean": rt["vev"][gi, k], "err": rt["vev_err"][gi, k]})
                if rt["vev_err"][gi, k] > 0 and abs(rt["vev"][gi, k]) > 4.0 * rt["vev_err"][gi, k]:
                    warnings.append("torelon <Phi> (direction %d, %s) is %.1f sigma from zero: "
                                    "centre symmetry broken or not sampled?"
                                    % (d + 1, tor_labels[k], rt["vev"][gi, k] / rt["vev_err"][gi, k]))
        tb["vev_check"] = vc
        if not tb["plateau"]:
            warnings.append("torelon (L=%d): %s -> the quoted energy is %s"
                            % (L, tb["flag"], "an upper bound only" if tb["upper_bound_only"]
                               else "not available"))
        tor_results[L] = rt
        tor_blocks.append(tb)
    out["torelon_all"] = tor_blocks
    out["torelon"] = tor_blocks[0]
    Lp = tor_blocks[0]["L"]
    rt = tor_results[Lp]

    # ------------------------------------------------------------------ string tension, ratios
    st = {"L": Lp, "upper_bound_only": tor_blocks[0]["upper_bound_only"],
          "luscher": None, "nambu_goto": None}
    sig_jk = {}
    if rt["mass_jk"] is not None and math.isfinite(rt["mass"]):
        for key, fn in (("luscher", stats.sigma_luscher), ("nambu_goto", stats.sigma_nambu_goto)):
            s0 = fn(rt["mass"], Lp, D)
            sj = fn(rt["mass_jk"], Lp, D)
            sig_jk[key] = (s0, sj)
            ok = s0 > 0 and np.all(sj > 0)
            st[key] = {"sigma_a2": s0, "sigma_a2_err": stats.jackknife_error(sj),
                       "a_sqrt_sigma": math.sqrt(s0) if s0 > 0 else None,
                       "a_sqrt_sigma_err": (stats.jackknife_error(np.sqrt(sj)) if ok else None)}
    # the same at FIXED t = 1 and 2 (no plateau selection), for comparison with the R5 value
    st["fixed_t"] = []
    if rt.get("meff") is not None:
        for t in (1, 2):
            if t >= T // 2:
                continue
            e0 = float(rt["meff"]["m_cosh"][t])
            ej = np.asarray(rt["meff"]["m_cosh_jk"][:, t], dtype=np.float64)
            ent = {"t": t, "aE": e0, "aE_err": rt["meff"]["err_cosh"][t],
                   "luscher": None, "nambu_goto": None}
            if math.isfinite(e0) and np.all(np.isfinite(ej)):
                for key, fn in (("luscher", stats.sigma_luscher),
                                ("nambu_goto", stats.sigma_nambu_goto)):
                    s0 = fn(e0, Lp, D)
                    sj = fn(ej, Lp, D)
                    if s0 > 0 and np.all(sj > 0):
                        ent[key] = {"a_sqrt_sigma": math.sqrt(s0),
                                    "a_sqrt_sigma_err": stats.jackknife_error(np.sqrt(sj))}
            st["fixed_t"].append(ent)
    out["string_tension"] = st

    ratios = {"m_over_sqrt_sigma": None, "upper_bound_only": None}
    if rg is not None and rg["mass_jk"] is not None and sig_jk:
        mos = {}
        for key, (s0, sj) in sig_jk.items():
            if s0 > 0 and np.all(sj > 0):
                mos[key] = {"value": rg["mass"] / math.sqrt(s0),
                            "err": stats.jackknife_error(rg["mass_jk"] / np.sqrt(sj))}
            else:
                mos[key] = None
        ratios["m_over_sqrt_sigma"] = mos
        ratios["upper_bound_only"] = bool(out["glueball"]["upper_bound_only"]
                                          or tor_blocks[0]["upper_bound_only"])
        ratios["note"] = ("jackknife error with the glueball mass and the torelon energy taken "
                          "from the same bins (correlations included); both t* held fixed")
    out["ratios"] = ratios

    if D == 3:
        d3 = {"beta_am_over_4": None, "beta_a_sqrt_sigma_over_4": None,
              "note": "beta = 4/(g^2 a) in D=3, so beta*a*m/4 = m/g^2 up to lattice artefacts"}
        if rg is not None and rg["mass_jk"] is not None:
            d3["beta_am_over_4"] = {"value": beta * rg["mass"] / 4.0,
                                    "err": beta * rg["err"] / 4.0}
        if "luscher" in sig_jk and st["luscher"]["a_sqrt_sigma"] is not None:
            d3["beta_a_sqrt_sigma_over_4"] = {
                "luscher": {"value": beta * st["luscher"]["a_sqrt_sigma"] / 4.0,
                            "err": beta * st["luscher"]["a_sqrt_sigma_err"] / 4.0},
                "nambu_goto": {"value": beta * st["nambu_goto"]["a_sqrt_sigma"] / 4.0,
                               "err": beta * st["nambu_goto"]["a_sqrt_sigma_err"] / 4.0}}
        out["D3"] = d3
    if D == 4:
        al = exact.a_lambda_two_loop(beta)
        d4 = {"a_lambda_two_loop": al, "m_over_lambda": None, "sqrt_sigma_over_lambda": None,
              "note": "a*Lambda_L from the two-loop asymptotic-scaling formula (ym/exact.py); "
                      "asymptotic scaling is known to be violated at accessible beta"}
        if rg is not None and rg["mass_jk"] is not None:
            d4["m_over_lambda"] = {"value": rg["mass"] / al, "err": rg["err"] / al}
        if "luscher" in sig_jk and st["luscher"]["a_sqrt_sigma"] is not None:
            d4["sqrt_sigma_over_lambda"] = {
                "luscher": {"value": st["luscher"]["a_sqrt_sigma"] / al,
                            "err": st["luscher"]["a_sqrt_sigma_err"] / al},
                "nambu_goto": {"value": st["nambu_goto"]["a_sqrt_sigma"] / al,
                               "err": st["nambu_goto"]["a_sqrt_sigma_err"] / al}}
        out["D4"] = d4
    if D == 2:
        L = shape[1]
        sig_ex = exact.string_tension_2d(beta)
        d2 = {"sigma_exact": sig_ex, "torelon_energy_exact": L * sig_ex,
              "plaquette_exact": exact.plaquette_2d_torus(beta, T * L),
              "plaquette_pull": (plaq["mean"] - exact.plaquette_2d_torus(beta, T * L)) / plaq["err"]
              if plaq["err"] > 0 else None,
              "pull_torelon_energy": ((rt["mass"] - L * sig_ex) / rt["err"]
                                      if math.isfinite(rt["mass"]) and rt["err"] > 0 else None)}
        # torelon correlator of the first (unsmeared, all levels are identical) operator
        tc = []
        for tau in range(T // 2 + 1):
            ex = exact.torelon_correlator_2d_torus(beta, L, T, tau)
            c, e = rt["C"][0, 0, tau], rt["C_err"][0, 0, tau]
            tc.append({"tau": tau, "C": c, "err": e, "exact": ex,
                       "pull": (c - ex) / e if e > 0 else None})
        d2["torelon_correlator"] = tc
        # null test: connected correlator of the time-slice plaquette sums (no glueballs in D=2)
        rn = stats.analyze_channel([s["plaq_t_slices"][:, None, :] for s in S], T, B,
                                   subtract_vev=True, do_fit=False)
        c, e = rn["C"][0, 0], rn["C_err"][0, 0]
        var1 = (1.0 + 3.0 * exact.lambda_j(beta, 2)) / 4.0 - exact.u(beta) ** 2
        pulls = c[1:] / e[1:]
        d2["plaquette_null_test"] = {
            "C": c, "err": e, "C0_exact_infinite_volume": L * var1,
            "pulls_tau_ge_1": pulls, "chi2_tau_ge_1": float(np.sum(pulls ** 2)),
            "n_tau": int(pulls.size), "max_abs_pull": float(np.max(np.abs(pulls))),
            "note": "connected correlator of time-slice plaquette sums; exact prediction: zero "
                    "for tau >= 1 (up to exponentially small torus corrections)"}
        out["D2"] = d2

    # ------------------------------------------------------------------ binning check (2B)
    bc = {"binsize": 2 * B, "glueball": None, "torelon": None}
    if sum(s["plaq"].shape[0] // (2 * B) for s in S) >= 10:
        if D > 2:
            r2 = stats.analyze_channel([s["glue"] for s in S], T, 2 * B, subtract_vev=True,
                                       t0=t0, min_eig=min_eig, do_fit=False)
            bc["glueball"] = {"am": r2["mass"], "am_err": r2["err"],
                              "t_star": r2["plateau"]["t_star"], "flag": r2["plateau"]["flag"],
                              "meff1": r2["meff"]["m_cosh"][1] if r2["meff"] else None,
                              "meff1_err": r2["meff"]["err_cosh"][1] if r2["meff"] else None}
        r2 = stats.analyze_channel([s["torelon"][:, groups[Lp]] for s in S], T, 2 * B,
                                   subtract_vev=False, t0=t0, min_eig=min_eig, do_fit=False)
        bc["torelon"] = {"aE": r2["mass"], "aE_err": r2["err"],
                         "t_star": r2["plateau"]["t_star"], "flag": r2["plateau"]["flag"],
                         "meff1": r2["meff"]["m_cosh"][1] if r2["meff"] else None,
                         "meff1_err": r2["meff"]["err_cosh"][1] if r2["meff"] else None}
    else:
        bc["note"] = "not enough data for bins of twice the size"
    out["binning_check"] = bc

    # ------------------------------------------------------------------ plots
    os.makedirs(outdir, exist_ok=True)
    plots = []
    if make_plots:
        head = "SU(2) D=%d  %s  beta=%g  (%d meas., bins of %d)" % (
            D, "x".join(map(str, shape)), beta, n_used, B)
        if rg is not None and rg.get("meff") is not None:
            p = os.path.join(outdir, name + "_glueball_meff.png")
            plot_meff(p, rg, out["glueball"], "0++ glueball effective mass\n" + head,
                      "$a\\,m_{\\rm eff}$")
            plots.append(os.path.basename(p))
        if rt.get("meff") is not None:
            extra = []
            if D == 2:
                extra.append((shape[1] * exact.string_tension_2d(beta),
                              "exact $-L\\,\\ln u(\\beta)$", "k"))
            p = os.path.join(outdir, name + "_torelon_meff.png")
            plot_meff(p, rt, out["torelon"],
                      "torelon (flux loop, L=%d) effective energy\n%s" % (Lp, head),
                      "$a\\,E_{\\rm eff}$", extra)
            plots.append(os.path.basename(p))
        items = []
        if rg is not None:
            items.append(("0++ glueball", rg))
        items.append(("torelon L=%d" % Lp, rt))
        p = os.path.join(outdir, name + "_correlators.png")
        plot_correlators(p, items, T, "GEVP-projected correlators (lines: cosh fits)\n" + head)
        plots.append(os.path.basename(p))
    out["plots"] = plots
    out["warnings"] = warnings

    res = clean(out)
    jpath = os.path.join(outdir, name + ".json")
    tmp = jpath + ".tmp"
    with open(tmp, "w") as f:
        json.dump(res, f, indent=1, allow_nan=False)
        f.write("\n")
    os.replace(tmp, jpath)
    if not quiet:
        print(summary(res))
        print("wrote %s%s" % (jpath, (" and " + ", ".join(plots)) if plots else ""))
    return res


def _fmt(v, e):
    if v is None:
        return "n/a"
    if e is None:
        return "%.5f(?)" % v
    return "%.5f +- %.5f" % (v, e)


def summary(res):
    """Human-readable summary of an analysis result."""
    lines = []
    lines.append("ensemble %s: D=%d shape=%s beta=%g | %d measurements used (%d discarded), "
                 "bins of %d (%s), %d bins"
                 % (res["ensemble"], res["D"], "x".join(map(str, res["shape"])), res["beta"],
                    res["n_meas_used"], res["n_discarded_total"], res["binsize"],
                    res["binsize_rule"], res["n_bins"]))
    p = res["plaquette"]
    lines.append("plaquette   %s   tau_int = %.2f" % (_fmt(p["mean"], p["err"]), p["tau_int"]))
    for key, lab in (("glueball", "glueball a*m"), ("torelon", "torelon  a*E")):
        b = res.get(key)
        if not b:
            continue
        lines.append("%s  %s   [%s, t*=%s%s]" % (lab, _fmt(b["mass"], b["err"]), b["flag"],
                                                  b["t_star"],
                                                  ", UPPER BOUND ONLY" if b["upper_bound_only"]
                                                  else ""))
        if b.get("gevp"):
            lines.append("   GEVP operators: %s   overlap %s" % (
                ",".join(b["gevp"]["selected"]),
                "%.3f" % b["overlap"] if b["overlap"] is not None else "n/a"))
        for row in b["meff_t0_5"]:
            lines.append("   t=%d  m_eff = %s" % (row["t"], _fmt(row["m_cosh"], row["err_cosh"])))
        if b.get("cosh_fit") and b["cosh_fit"].get("ok"):
            f = b["cosh_fit"]
            lines.append("   cosh fit t=%d..%d: %s  chi2/dof = %.2f/%d"
                         % (f["tmin"], f["tmax"], _fmt(f["m"], f["err"]), f["chi2"], f["dof"]))
    st = res["string_tension"]
    for key in ("luscher", "nambu_goto"):
        if st.get(key):
            lines.append("a*sqrt(sigma) [%s, L=%d]  %s"
                         % (key, st["L"], _fmt(st[key]["a_sqrt_sigma"],
                                                st[key]["a_sqrt_sigma_err"])))
    for ent in st.get("fixed_t") or []:
        if ent.get("luscher"):
            lines.append("   fixed t=%d: a*E = %s  ->  a*sqrt(sigma) [luscher] %s"
                         % (ent["t"], _fmt(ent["aE"], ent["aE_err"]),
                            _fmt(ent["luscher"]["a_sqrt_sigma"],
                                 ent["luscher"]["a_sqrt_sigma_err"])))
    r = res["ratios"]["m_over_sqrt_sigma"]
    if r:
        for key in ("luscher", "nambu_goto"):
            if r.get(key):
                lines.append("m/sqrt(sigma) [%s]  %s%s"
                             % (key, _fmt(r[key]["value"], r[key]["err"]),
                                "  (upper bound only)" if res["ratios"]["upper_bound_only"]
                                else ""))
    if res.get("D3") and res["D3"]["beta_am_over_4"]:
        v = res["D3"]["beta_am_over_4"]
        lines.append("beta*a*m/4 (= m/g^2)  %s" % _fmt(v["value"], v["err"]))
    if res.get("D4") and res["D4"]["m_over_lambda"]:
        v = res["D4"]["m_over_lambda"]
        lines.append("m/Lambda_L (two-loop)  %s   [a*Lambda_L = %.6g]"
                     % (_fmt(v["value"], v["err"]), res["D4"]["a_lambda_two_loop"]))
    if res.get("D2"):
        d2 = res["D2"]
        lines.append("D=2 exact: torelon energy %.5f (pull %s), null test max |pull| %.2f"
                     % (d2["torelon_energy_exact"],
                        "%+.2f" % d2["pull_torelon_energy"]
                        if d2["pull_torelon_energy"] is not None else "n/a",
                        d2["plaquette_null_test"]["max_abs_pull"]))
    hc = (res.get("stream_consistency") or {}).get("hot_minus_cold")
    if hc and hc.get("pull") is not None:
        lines.append("plaquette, hot-start minus cold-start streams: %+.2e +- %.1e (%+.2f sigma)"
                     % (hc["diff"], hc["err"], hc["pull"]))
    for w in res["warnings"]:
        lines.append("WARNING: " + w)
    lines.append("CAVEAT: the error of a mass chosen by plateau rule R5 does not include the "
                 "selection of t* (about 55-65 % coverage at 1 sigma in synthetic tests); compare "
                 "with the fixed-t values above and see 'caveats' in the JSON file.")
    lines.append("(numerical evidence for one lattice ensemble; not a proof of the mass gap)")
    return "\n".join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Analyse raw files of one ensemble (see module "
                                             "docstring for the JSON schema).")
    ap.add_argument("files", nargs="+", help="raw .npz files (independent streams)")
    ap.add_argument("--name", default=None, help="ensemble name (default: from the first file)")
    ap.add_argument("--outdir", default="results", help="output directory")
    ap.add_argument("--binsize", type=int, default=None,
                    help="bin size in measurements (default: ceil(10 tau_int_max))")
    ap.add_argument("--discard", type=int, default=0,
                    help="measurements to drop from the start of every stream (extra "
                         "thermalisation); counted in the output")
    ap.add_argument("--no-plots", action="store_true")
    args = ap.parse_args(argv)
    analyze(args.files, name=args.name, outdir=args.outdir, binsize=args.binsize,
            discard=args.discard, make_plots=not args.no_plots)
    return 0


if __name__ == "__main__":
    sys.exit(main())
