#!/usr/bin/env python3
"""Synthesis across ensembles: tables, scaling fits, volume / replication checks, literature pulls.

    python3 summarize.py                 # reads results/<ensemble>.json and literature.json
    python3 summarize.py --results results --literature literature.json --outdir results

Reads ONLY the pipeline output ``results/<ensemble>.json`` (written by analyze.py, never modified
here) and ``literature.json``.  No raw data are read and nothing is re-analysed.  Writes

    <outdir>/summary.json               everything below, machine readable (schema: see keys)
    <outdir>/summary.md                 the same as plain tables (Dutch, like README.md)
    <outdir>/summary_scaling_d3.png     m/sqrt(sigma) versus a^2 sigma, sqrt(sigma)/g^2 versus 1/beta
    <outdir>/summary_scaling_d4.png     m/sqrt(sigma) versus a^2 sigma, comparison with two-loop scaling
    <outdir>/summary_volume.png         finite-volume comparisons

Everything here is NUMERICAL EVIDENCE at finite lattice spacing and finite volume with
statistical errors.  It is not a proof of the Yang-Mills mass gap and must never be presented
as one.

Conventions (fixed in this file, not tuned to the data)
-------------------------------------------------------
* Three "variants" of every mass-like number are always carried side by side:
      R5   value of the pre-registered plateau rule R5 (ym/stats.py): m_eff(t*), t* chosen on
           the same data, so the quoted error under-covers (see ``caveats`` in each pipeline file);
      t1   effective mass at FIXED t = 1 (no selection, nominal coverage, more excited-state
           contamination: a variational UPPER estimate);
      t2   effective mass at FIXED t = 2.
  For a ratio the same variant is used in numerator and denominator (t1: glueball m_eff(1)
  over the string tension from the torelon m_eff(1)).
* String tension: Nambu-Goto formula (rule R7) unless stated; the Luscher variant is carried
  along and the difference is reported as it is.
* Errors.  Within one ensemble the correlated jackknife error of the pipeline file is used
  where the file contains it (R5 ratio; a fixed-t ratio when rule R5 happened to choose that t
  in both channels).  The pipeline files do NOT contain a correlated error for the other
  fixed-t ratios; those are propagated as if glueball and torelon were uncorrelated and are
  marked ``err_kind = "uncorrelated propagation"``; block ``ratio_error_check`` shows, for the
  R5 ratios where both exist, how little the two differ.  Different ensembles are statistically
  independent: errors are added in quadrature.
* No systematic error budget is invented.  Where a systematic is visible (R5 against fixed t,
  L dependence, Nambu-Goto against Luscher, fit ansatz) the difference itself is reported.
* Fits are weighted least squares with the statistical errors of the points; quoted parameter
  errors are NOT rescaled by sqrt(chi2/dof) (the scale factor is given separately).  Errors of
  the abscissa a^2 sigma are neglected; their size relative to the ordinate errors is reported.
* A "pull" is (ours - reference) / sqrt(err_ours^2 + err_reference^2).
* D = 4 extrapolations are only printed when the fit has p >= ACCEPT_P, and then with the
  statement why the number must not be trusted.
"""
from __future__ import annotations

import argparse
import datetime
import decimal
import json
import math
import os
import re
import sys

import numpy as np
from scipy import stats as sps

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from ym import exact  # noqa: E402  (only the closed-form two-loop formula is used)

SUMMARY_FORMAT = "ym-summary-1"
DISCLAIMER = ("Numerical Monte Carlo evidence (finite lattice spacing, finite volume, statistical "
              "errors, variational upper estimates of masses). NOT a proof of the Yang-Mills "
              "mass gap; the Millennium problem is open and nothing here solves it.")
TAGLINE_NL = "numeriek bewijsmateriaal, geen bewijs"

VARIANTS = ("R5", "t1", "t2")
ACCEPT_P = 0.05

#: ensemble -> (round, role).  Round 1 = the six pre-registered primary ensembles; round 2 was
#: decided after a first look at round 1 (purposes fixed in run_extra_production.sh beforehand);
#: round 3 was decided after the adversarial physics review (purpose and criterion fixed in
#: run_round3_production.sh, analysis plan in round3_plan.md, both before its data were looked at).
ENSEMBLES = {
    "d3_b6.0_L16": ("1", "primary"),
    "d3_b6.0_L24": ("2", "finite-volume check of d3_b6.0_L16"),
    "d3_b9.0_L24": ("1", "primary"),
    "d3_b9.0_L24r": ("2", "replication of d3_b9.0_L24 (new seeds)"),
    "d3_b9.0_L24_combined": ("1+2", "d3_b9.0_L24 and d3_b9.0_L24r analysed together"),
    "d3_b12.0_L32": ("1", "primary"),
    "d4_b2.3_L10": ("1", "primary"),
    "d4_b2.4_L12": ("1", "primary"),
    "d4_b2.4_L16": ("2", "finite-volume check of d4_b2.4_L12"),
    "d4_b2.5_L16": ("1", "primary"),
    "d4_b2.5_L16x": ("2", "more statistics for d4_b2.5_L16 (new seeds)"),
    "d4_b2.5_L16_combined": ("1+2", "d4_b2.5_L16 and d4_b2.5_L16x analysed together"),
    "d4_b2.5_L20": ("3", "finite-volume check of d4_b2.5_L16 (20^4)"),
}
TABLE_ORDER = list(ENSEMBLES)
#: the six pre-registered ensembles
PRIMARY = ["d3_b6.0_L16", "d3_b9.0_L24", "d3_b12.0_L32", "d4_b2.3_L10", "d4_b2.4_L12",
           "d4_b2.5_L16"]
#: all data, as statistically independent ensembles (combined files replace their parts)
INDEPENDENT_ALL = ["d3_b6.0_L16", "d3_b6.0_L24", "d3_b9.0_L24_combined", "d3_b12.0_L32",
                   "d4_b2.3_L10", "d4_b2.4_L12", "d4_b2.4_L16", "d4_b2.5_L16_combined",
                   "d4_b2.5_L20"]
SCALING_SETS = {
    3: {"primary": ["d3_b6.0_L16", "d3_b9.0_L24", "d3_b12.0_L32"],
        "all_data": ["d3_b6.0_L16", "d3_b9.0_L24_combined", "d3_b12.0_L32"]},
    4: {"primary": ["d4_b2.3_L10", "d4_b2.4_L12", "d4_b2.5_L16"],
        "all_data": ["d4_b2.3_L10", "d4_b2.4_L12", "d4_b2.5_L16_combined"]},
}
VOLUME_PAIRS = [("d3_b6.0_L16", "d3_b6.0_L24"), ("d4_b2.4_L12", "d4_b2.4_L16"),
                ("d4_b2.5_L16_combined", "d4_b2.5_L20")]
#: round 3 (run_round3_production.sh): reference ensemble, new ensemble, criterion in sigma
ROUND3_REF, ROUND3_NEW, ROUND3_NSIGMA = "d4_b2.5_L16_combined", "d4_b2.5_L20", 3.0
#: round3_plan.md item 4: the largest volume at each D=4 beta (shown NEXT TO the primary set)
LARGEST_VOLUME_D4 = ["d4_b2.3_L10", "d4_b2.4_L16", "d4_b2.5_L20"]
REPLICATION_PAIRS = [("d3_b9.0_L24", "d3_b9.0_L24r"), ("d4_b2.5_L16", "d4_b2.5_L16x")]
LIT_SECTION = {3: "D3_SU2_wilson", 4: "D4_SU2_wilson"}

D3_LIMIT_NOTE = (
    "Three lattice spacings and a variational systematic (the masses are upper estimates at "
    "small t; that bias is not part of the statistical errors) do not make a controlled "
    "continuum limit. The intercepts describe these three points; they are indicative only.")
D4_DISTRUST = (
    "Not to be trusted as a continuum limit: (i) three points only, so a straight line has one "
    "degree of freedom and an acceptable chi2 has almost no power; (ii) m/sqrt(sigma) drifts "
    "monotonically upward with beta instead of flattening; (iii) the glueball masses are "
    "variational upper estimates at t = 1 with a small operator basis, and t = 1 is a shorter "
    "physical time at larger beta, so excited-state contamination can grow towards a -> 0 and "
    "cannot be separated from a lattice artefact by a fit in a^2 sigma; (iv) the three "
    "ensembles have different physical volumes.")


# ==============================================================================================
# small numerical helpers (tested in tests/test_summarize.py)
# ==============================================================================================
def num(x):
    """float(x), or None for missing / non-numeric / non-finite input."""
    if x is None or isinstance(x, bool):
        return None
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return x if math.isfinite(x) else None


def ok(*xs):
    """True if every argument is a finite number."""
    return all(num(x) is not None for x in xs)


def ve(value, err, **extra):
    """{'value', 'err'} record (None for anything not finite) plus extra keys."""
    out = {"value": num(value), "err": num(err)}
    out.update(extra)
    return out


def fmt_ve(value, err=None, decimals=None):
    """Compact 'value(error)' notation: fmt_ve(1.19587, 0.00768, 4) -> '1.1959(77)'.

    ``decimals`` = number of decimals of the value; the error is given in units of the last
    digit.  ``decimals=None`` chooses it so that the error has two significant digits.  An
    error >= 1 with decimals > 0 is written with its decimal point: '215.7(7.3)'.
    """
    v, e = num(value), num(err)
    if v is None:
        return "n/a"
    if e is None or e <= 0:
        return f"{v:.{4 if decimals is None else decimals}f}"
    if decimals is None:
        decimals = max(0, 1 - int(math.floor(math.log10(e))))
    if decimals == 0:
        return f"{v:.0f}({e:.0f})"
    digits = int(round(e * 10 ** decimals))
    if digits >= 10 ** decimals:                 # error >= 1 after rounding: keep the point
        return f"{v:.{decimals}f}({e:.{decimals}f})"
    return f"{v:.{decimals}f}({digits})"


def n_decimals(x):
    """Number of decimals in the shortest decimal representation of x (0.2660 -> 3)."""
    x = num(x)
    if x is None:
        return 0
    return max(0, -decimal.Decimal(repr(x)).normalize().as_tuple().exponent)


def fmt_lit(value, unc):
    """Literature value in its own precision: fmt_lit(0.1616, 0.0006) -> '0.1616(6)'."""
    if num(value) is None:
        return "n/a"
    if num(unc) is None:
        return repr(float(value))
    return fmt_ve(value, unc, max(n_decimals(value), n_decimals(unc)))


def pull(a, ea, b, eb):
    """(a - b) / sqrt(ea^2 + eb^2) for two INDEPENDENT numbers; None if undefined."""
    if not ok(a, ea, b, eb):
        return None
    s = math.hypot(float(ea), float(eb))
    return (float(a) - float(b)) / s if s > 0 else None


def diff_sigma(a, ea, b, eb):
    """Difference a - b of two independent numbers with its error and significance."""
    if not ok(a, ea, b, eb):
        return {"diff": None, "err": None, "sigma": None}
    d, s = float(a) - float(b), math.hypot(float(ea), float(eb))
    return {"diff": d, "err": s, "sigma": d / s if s > 0 else None}


def ratio_indep(a, ea, b, eb):
    """a / b with the error of two INDEPENDENT numbers: (value, err) or (None, None)."""
    if not ok(a, ea, b, eb) or float(b) == 0.0:
        return None, None
    r = float(a) / float(b)
    rel = math.hypot(float(ea) / float(a), float(eb) / float(b)) if float(a) != 0.0 else None
    if rel is None:
        return r, abs(float(ea) / float(b))
    return r, abs(r) * rel


def product_indep(a, ea, b, eb):
    """a * b with the error of two INDEPENDENT numbers: (value, err) or (None, None)."""
    if not ok(a, ea, b, eb):
        return None, None
    return float(a) * float(b), math.hypot(float(b) * float(ea), float(a) * float(eb))


def chi2_pvalue(chi2, dof):
    """Upper tail probability of chi2 with ``dof`` degrees of freedom (None for dof < 1)."""
    if dof is None or dof < 1 or not ok(chi2):
        return None
    return float(sps.chi2.sf(float(chi2), int(dof)))


def wls_poly(x, y, err, degree):
    """Weighted least-squares fit  y = sum_k c_k x^k  (k = 0..degree), weights 1/err^2.

    Returns coef, coef_err (sqrt of the diagonal of the covariance matrix (A^T W A)^-1, NOT
    rescaled by chi2/dof), cov, chi2, dof, chi2_dof, p_value, scale_factor = max(1,
    sqrt(chi2/dof)).  Raises ValueError for unusable input.
    """
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    e = np.asarray(err, dtype=np.float64)
    n, npar = x.size, int(degree) + 1
    if not (x.shape == y.shape == e.shape) or x.ndim != 1:
        raise ValueError("x, y, err must be one-dimensional arrays of equal length")
    if n < npar:
        raise ValueError(f"{n} points cannot determine {npar} parameters")
    if not (np.all(np.isfinite(x)) and np.all(np.isfinite(y)) and np.all(np.isfinite(e))):
        raise ValueError("non-finite input")
    if np.any(e <= 0):
        raise ValueError("errors must be positive")
    a = np.vander(x, npar, increasing=True) / e[:, None]
    b = y / e
    cov = np.linalg.inv(a.T @ a)
    coef = cov @ (a.T @ b)
    resid = b - a @ coef
    chi2 = float(resid @ resid)
    dof = n - npar
    return {
        "coef": [float(c) for c in coef],
        "coef_err": [float(math.sqrt(max(cov[i, i], 0.0))) for i in range(npar)],
        "cov": [[float(v) for v in row] for row in cov],
        "chi2": chi2, "dof": dof,
        "chi2_dof": chi2 / dof if dof > 0 else None,
        "p_value": chi2_pvalue(chi2, dof),
        "scale_factor": max(1.0, math.sqrt(chi2 / dof)) if dof > 0 else None,
    }


def fit_constant(y, err):
    """Weighted mean: {'value','err','chi2','dof','chi2_dof','p_value','scale_factor'}."""
    f = wls_poly(np.zeros(len(y)), y, err, 0)
    return {"value": f["coef"][0], "err": f["coef_err"][0], "chi2": f["chi2"], "dof": f["dof"],
            "chi2_dof": f["chi2_dof"], "p_value": f["p_value"],
            "scale_factor": f["scale_factor"], "n_points": len(y)}


def fit_linear(x, y, err):
    """y = intercept + slope * x: intercept, slope, their errors and covariance, chi2, dof."""
    f = wls_poly(x, y, err, 1)
    return {"intercept": f["coef"][0], "intercept_err": f["coef_err"][0],
            "slope": f["coef"][1], "slope_err": f["coef_err"][1],
            "cov_intercept_slope": f["cov"][0][1],
            "chi2": f["chi2"], "dof": f["dof"], "chi2_dof": f["chi2_dof"],
            "p_value": f["p_value"], "scale_factor": f["scale_factor"], "n_points": len(y)}


def fit_quadratic(x, y, err):
    """y = intercept + slope x + curvature x^2 (exact interpolation for three points)."""
    f = wls_poly(x, y, err, 2)
    return {"intercept": f["coef"][0], "intercept_err": f["coef_err"][0],
            "slope": f["coef"][1], "slope_err": f["coef_err"][1],
            "curvature": f["coef"][2], "curvature_err": f["coef_err"][2],
            "chi2": f["chi2"], "dof": f["dof"], "chi2_dof": f["chi2_dof"],
            "p_value": f["p_value"], "n_points": len(y)}


def count_pulls(pulls):
    """Number of defined pulls and how many exceed 2 and 3 in absolute value."""
    vals = [abs(float(p)) for p in pulls if num(p) is not None]
    n = len(vals)
    return {"n": n, "n_gt_2": sum(1 for v in vals if v > 2.0),
            "n_gt_3": sum(1 for v in vals if v > 3.0),
            "max_abs": max(vals) if vals else None,
            "expected_gt_2_if_gaussian": 0.0455 * n, "expected_gt_3_if_gaussian": 0.0027 * n}


def lattice_label(shape):
    """[16, 12, 12, 12] -> '16x12^3',  [16, 16, 16] -> '16^3'."""
    shape = [int(s) for s in shape]
    t, sp = shape[0], shape[1:]
    if all(s == t for s in sp):
        return f"{t}^{len(shape)}"
    if len(set(sp)) == 1:
        return f"{t}x{sp[0]}^{len(sp)}"
    return "x".join(str(s) for s in shape)


def beta_key(beta):
    """Key used in literature.json: 6.0 -> '6', 2.3 -> '2.3'."""
    return f"{float(beta):g}"


def lit_entries(node):
    """Primary literature entry followed by its alternatives, each tagged with _index/_role."""
    out = [dict(node, _index=0, _role="primary")]
    for i, alt in enumerate(node.get("alternatives", []) or [], 1):
        out.append(dict(alt, _index=i, _role=f"alternative {i}"))
    for e in out:
        e.pop("alternatives", None)
        e["_parent_source"] = str(node.get("source", ""))
    return out


def lit_lattice_L(entry):
    """Spatial lattice size named in the 'source' text of a literature entry, or None.

    Recognises 'L=16' and '16^4'; the first match is used."""
    src = str(entry.get("source", ""))
    m = re.search(r"\bL\s*=\s*(\d+)", src)
    if m:
        return int(m.group(1))
    m = re.search(r"\b(\d+)\^4", src)
    return int(m.group(1)) if m else None


def lit_short_source(entry):
    """Short label of a literature source: the arXiv number if one is named ('same table'
    alternatives inherit it from their primary entry)."""
    src = str(entry.get("source", ""))
    pat = r"arXiv:\s*([A-Za-z\-]+/\d{7}|\d{4}\.\d{4,5})"
    m = re.search(pat, src)
    if not m and src.strip().lower().startswith("same table"):
        m = re.search(pat, str(entry.get("_parent_source", "")))
    return ("arXiv:" + m.group(1)) if m else "no source identified"


# ==============================================================================================
# reading the pipeline files
# ==============================================================================================
def _channel(block):
    """R5 / t1 / t2 values of one channel block of a pipeline file."""
    ft = block.get("fixed_t") or {}
    out = {"R5": ve(block.get("mass"), block.get("err"), t_star=block.get("t_star"),
                    t_value=block.get("t_value"), flag=block.get("flag"),
                    is_measurement=bool(block.get("plateau"))
                    and not bool(block.get("upper_bound_only")) and ok(block.get("mass"),
                                                                       block.get("err")))}
    for k in ("t1", "t2"):
        b = ft.get(k) or {}
        out[k] = ve(b.get("m"), b.get("err"), is_measurement=ok(b.get("m"), b.get("err")))
    d = ft.get("t1_minus_t2") or {}
    dv, de = num(d.get("value")), num(d.get("err"))
    out["t1_minus_t2"] = {"value": dv, "err": de,
                          "sigma": dv / de if ok(dv, de) and de > 0 else None,
                          "note": "correlated jackknife error of the difference (pipeline file)"}
    return out


def extract_ensemble(d, name=None):
    """Normalised record of one pipeline file (dict as loaded from results/<name>.json)."""
    name = name or d["ensemble"]
    rnd, role = ENSEMBLES.get(name, ("?", "?"))
    D, beta = int(d["D"]), float(d["beta"])
    shape = [int(s) for s in d["shape"]]
    T = int(d["T"])
    L = int(d["torelon"]["L"])
    rec = {
        "name": name, "round": rnd, "role": role, "D": D, "beta": beta, "shape": shape,
        "lattice": lattice_label(shape), "T": T, "L": L,
        "pipeline_file": f"{name}.json", "pipeline_generated_utc": d.get("generated_utc"),
        "n_meas": int(d["n_meas_total"]), "n_used": int(d["n_meas_used"]),
        "n_bins": int(d["n_bins"]), "binsize": int(d["binsize"]),
        "tau_int_max": num(d.get("tau_int_max")),
        "seeds": [s.get("seed") for s in d.get("streams", [])],
        "plaquette": ve(d["plaquette"]["mean"], d["plaquette"]["err"]),
    }
    sc = d.get("stream_consistency") or {}
    rec["stream_consistency"] = {
        "plaquette_chi2": num((sc.get("plaquette") or {}).get("chi2")),
        "plaquette_dof": (sc.get("plaquette") or {}).get("dof"),
        "hot_minus_cold_pull": num((sc.get("hot_minus_cold") or {}).get("pull")),
    }
    rec["warnings_other"] = [w for w in d.get("warnings", []) if "incomplete run" not in w]
    rec["n_incomplete_streams"] = sum(1 for w in d.get("warnings", []) if "incomplete run" in w)

    glue, tor, st = d["glueball"], d["torelon"], d["string_tension"]
    rec["am"] = _channel(glue)
    rec["aE_torelon"] = _channel(tor)
    rec["am_over_err"] = {k: (rec["am"][k]["value"] / rec["am"][k]["err"]
                              if ok(rec["am"][k]["value"], rec["am"][k]["err"])
                              and rec["am"][k]["err"] > 0 else None) for k in VARIANTS}

    fixed = {int(f["t"]): f for f in st.get("fixed_t", [])}
    st_meas = (not bool(st.get("upper_bound_only"))) and rec["aE_torelon"]["R5"]["is_measurement"]
    for form, key in (("nambu_goto", "a_sqrt_sigma"), ("luscher", "a_sqrt_sigma_luscher")):
        blk = {"R5": ve(st[form]["a_sqrt_sigma"], st[form]["a_sqrt_sigma_err"],
                        is_measurement=st_meas, t_star=tor.get("t_star"),
                        t_value=tor.get("t_value"))}
        for t, k in ((1, "t1"), (2, "t2")):
            f = (fixed.get(t) or {}).get(form) or {}
            blk[k] = ve(f.get("a_sqrt_sigma"), f.get("a_sqrt_sigma_err"),
                        is_measurement=ok(f.get("a_sqrt_sigma"), f.get("a_sqrt_sigma_err")))
        rec[key] = blk
    rec["ng_minus_luscher"] = {
        k: (rec["a_sqrt_sigma"][k]["value"] - rec["a_sqrt_sigma_luscher"][k]["value"]
            if ok(rec["a_sqrt_sigma"][k]["value"], rec["a_sqrt_sigma_luscher"][k]["value"])
            else None) for k in VARIANTS}
    # a^2 sigma (abscissa of the scaling plots)
    a2 = {"R5": ve(st["nambu_goto"].get("sigma_a2"), st["nambu_goto"].get("sigma_a2_err"),
                   is_measurement=st_meas)}
    for k in ("t1", "t2"):
        s = rec["a_sqrt_sigma"][k]
        a2[k] = (ve(s["value"] ** 2, 2.0 * s["value"] * s["err"], is_measurement=True)
                 if ok(s["value"], s["err"]) else ve(None, None, is_measurement=False))
    rec["a2_sigma"] = a2

    # m / sqrt(sigma)
    jr = ((d.get("ratios") or {}).get("m_over_sqrt_sigma") or {}).get("nambu_goto") or {}
    r5_meas = rec["am"]["R5"]["is_measurement"] and st_meas
    ratio = {"R5": ve(jr.get("value"), jr.get("err"), is_measurement=r5_meas,
                      err_kind="correlated jackknife (pipeline file)",
                      t_glueball=glue.get("t_value"), t_torelon=tor.get("t_value"))}
    for t, k in ((1, "t1"), (2, "t2")):
        m, s = rec["am"][k], rec["a_sqrt_sigma"][k]
        if r5_meas and glue.get("t_star") == t and tor.get("t_star") == t:
            ratio[k] = ve(jr.get("value"), jr.get("err"), is_measurement=True,
                          err_kind="correlated jackknife (pipeline file; R5 chose this t in "
                                   "both channels)")
        else:
            v, e = ratio_indep(m["value"], m["err"], s["value"], s["err"])
            ratio[k] = ve(v, e, is_measurement=ok(v, e), err_kind="uncorrelated propagation")
    rec["m_over_sqrt_sigma"] = ratio
    v, e = ratio_indep(rec["am"]["R5"]["value"], rec["am"]["R5"]["err"],
                       rec["a_sqrt_sigma"]["R5"]["value"], rec["a_sqrt_sigma"]["R5"]["err"])
    rec["ratio_error_check"] = {
        "pipeline_correlated_err": num(jr.get("err")), "uncorrelated_err": e,
        "correlated_over_uncorrelated": (num(jr.get("err")) / e if ok(jr.get("err"), e)
                                         and e > 0 else None),
        "value_matches_pipeline": (abs(v - jr["value"]) < 1e-9 * abs(v)
                                   if ok(v, jr.get("value")) else None)}

    # finite-volume indicators
    fv = {}
    for k in VARIANTS:
        m, s, en = rec["am"][k], rec["a_sqrt_sigma"][k], rec["aE_torelon"][k]
        thr_v, thr_e = ratio_indep(2.0 * en["value"] if ok(en["value"]) else None,
                                   2.0 * en["err"] if ok(en["err"]) else None,
                                   m["value"], m["err"])
        fv[k] = {
            "L_sqrt_sigma": ve(L * s["value"] if ok(s["value"]) else None,
                               L * s["err"] if ok(s["err"]) else None),
            "mL": ve(L * m["value"] if ok(m["value"]) else None,
                     L * m["err"] if ok(m["err"]) else None),
            "mT": ve(T * m["value"] if ok(m["value"]) else None,
                     T * m["err"] if ok(m["err"]) else None),
            "two_torelon_over_m": ve(thr_v, thr_e, err_kind="uncorrelated propagation"),
            "is_measurement": bool(m.get("is_measurement")) and bool(s.get("is_measurement")),
        }
    rec["finite_volume_indicators"] = fv

    # dimension-specific combinations
    if D == 3:
        f = beta / 4.0
        rec["D3"] = {
            "m_over_g2": {k: ve(f * rec["am"][k]["value"] if ok(rec["am"][k]["value"]) else None,
                                f * rec["am"][k]["err"] if ok(rec["am"][k]["err"]) else None,
                                is_measurement=rec["am"][k]["is_measurement"])
                          for k in VARIANTS},
            "sqrt_sigma_over_g2": {
                k: ve(f * rec["a_sqrt_sigma"][k]["value"]
                      if ok(rec["a_sqrt_sigma"][k]["value"]) else None,
                      f * rec["a_sqrt_sigma"][k]["err"]
                      if ok(rec["a_sqrt_sigma"][k]["err"]) else None,
                      is_measurement=rec["a_sqrt_sigma"][k]["is_measurement"])
                for k in VARIANTS},
        }
        jv = num(((d.get("D3") or {}).get("beta_am_over_4") or {}).get("value"))
        mine = rec["D3"]["m_over_g2"]["R5"]["value"]
        rec["D3"]["matches_pipeline"] = (abs(jv - mine) < 1e-9 * abs(jv) if ok(jv, mine)
                                         else None)
    if D == 4:
        al = float(exact.a_lambda_two_loop(beta))
        rec["D4"] = {
            "a_lambda_two_loop": al,
            "m_over_lambda": {k: ve(rec["am"][k]["value"] / al if ok(rec["am"][k]["value"])
                                    else None,
                                    rec["am"][k]["err"] / al if ok(rec["am"][k]["err"]) else None,
                                    is_measurement=rec["am"][k]["is_measurement"])
                              for k in VARIANTS},
            "sqrt_sigma_over_lambda": {
                k: ve(rec["a_sqrt_sigma"][k]["value"] / al
                      if ok(rec["a_sqrt_sigma"][k]["value"]) else None,
                      rec["a_sqrt_sigma"][k]["err"] / al
                      if ok(rec["a_sqrt_sigma"][k]["err"]) else None,
                      is_measurement=rec["a_sqrt_sigma"][k]["is_measurement"])
                for k in VARIANTS},
        }
        jv = num((d.get("D4") or {}).get("a_lambda_two_loop"))
        rec["D4"]["matches_pipeline"] = abs(jv - al) < 1e-12 * al if ok(jv) else None

    # stability under doubling the bin size (numbers from the pipeline file)
    bc = d.get("binning_check") or {}
    g2 = bc.get("glueball") or {}
    t2 = bc.get("torelon") or {}
    r5 = rec["am"]["R5"]
    rec["binning_check"] = {
        "binsize": bc.get("binsize"),
        "am": ve(g2.get("am"), g2.get("am_err"), t_star=g2.get("t_star")),
        "aE_torelon": ve(t2.get("aE"), t2.get("aE_err"), t_star=t2.get("t_star"),
                         flag=t2.get("flag")),
        "am_shift_in_sigma": ((g2["am"] - r5["value"]) / r5["err"]
                              if ok(g2.get("am"), r5["value"], r5["err"]) and r5["err"] > 0
                              else None),
        "am_err_ratio": (g2["am_err"] / r5["err"] if ok(g2.get("am_err"), r5["err"])
                         and r5["err"] > 0 else None),
        "same_t_star": (g2.get("t_star") == r5.get("t_star")
                        and t2.get("t_star") == rec["aE_torelon"]["R5"].get("t_star")),
    }
    return rec


def load_results(results_dir, names=None):
    """{name: record} for the pipeline files of ``names`` (default: all known ensembles)."""
    recs = {}
    for name in (names or TABLE_ORDER):
        path = os.path.join(results_dir, f"{name}.json")
        if not os.path.isfile(path):
            raise FileNotFoundError(f"pipeline file missing: {path}")
        with open(path, "r", encoding="utf-8") as fh:
            d = json.load(fh)
        if d.get("ensemble") != name:
            raise ValueError(f"{path}: ensemble name {d.get('ensemble')!r} != {name!r}")
        recs[name] = extract_ensemble(d, name)
    return recs


# ==============================================================================================
# section 2 and 3: scaling
# ==============================================================================================
def _fit_points(points, xkey="x"):
    """Constant and linear fits of scaling points (None if a point is not a measurement)."""
    if not all(p.get("is_measurement") and ok(p[xkey], p["y"], p["y_err"]) for p in points):
        return None
    x = [p[xkey] for p in points]
    y = [p["y"] for p in points]
    e = [p["y_err"] for p in points]
    out = {"fit_constant": fit_constant(y, e)}
    if len(points) >= 3:
        lin = fit_linear(x, y, e)
        xe = [abs(lin["slope"]) * p["x_err"] / p["y_err"] for p in points if ok(p.get("x_err"))]
        lin["max_slope_times_xerr_over_yerr"] = max(xe) if xe else 0.0
        out["fit_linear"] = lin
    for f in out.values():
        f["acceptable"] = is_acceptable(f)
    return out


def is_acceptable(fit):
    """Fit quality gate used throughout: at least one degree of freedom and p >= ACCEPT_P."""
    return bool(fit.get("dof", 0) >= 1 and fit.get("p_value") is not None
                and fit["p_value"] >= ACCEPT_P)


def _ratio_points(recs, names, variant):
    pts = []
    for n in names:
        r = recs[n]
        y, x = r["m_over_sqrt_sigma"][variant], r["a2_sigma"][variant]
        ls = r["finite_volume_indicators"][variant]["L_sqrt_sigma"]
        pts.append({"ensemble": n, "beta": r["beta"], "lattice": r["lattice"],
                    "x": x["value"], "x_err": x["err"], "y": y["value"], "y_err": y["err"],
                    "err_kind": y.get("err_kind"), "is_measurement": bool(y["is_measurement"]),
                    "a_sqrt_sigma": r["a_sqrt_sigma"][variant]["value"],
                    "a_sqrt_sigma_err": r["a_sqrt_sigma"][variant]["err"],
                    "L_sqrt_sigma": ls["value"], "L_sqrt_sigma_err": ls["err"]})
    return pts


def _range_block(points):
    """Plain description of how much m/sqrt(sigma) moves over the lattice spacings of a set:
    largest minus smallest value (with the significance of that difference) and the factor by
    which the lattice spacing changes, measured with sqrt(sigma).  No fit, no model."""
    if not all(p["is_measurement"] and ok(p["y"], p["y_err"]) for p in points):
        return None
    lo = min(points, key=lambda p: p["y"])
    hi = max(points, key=lambda p: p["y"])
    d = diff_sigma(hi["y"], hi["y_err"], lo["y"], lo["y_err"])
    mean = sum(p["y"] for p in points) / len(points)
    coarse = max(points, key=lambda p: p["a_sqrt_sigma"])
    fine = min(points, key=lambda p: p["a_sqrt_sigma"])
    fa, fe = ratio_indep(coarse["a_sqrt_sigma"], coarse["a_sqrt_sigma_err"],
                         fine["a_sqrt_sigma"], fine["a_sqrt_sigma_err"])
    return {"min": ve(lo["y"], lo["y_err"], beta=lo["beta"]),
            "max": ve(hi["y"], hi["y_err"], beta=hi["beta"]),
            "max_minus_min": d, "spread_percent_of_mean": 100.0 * d["diff"] / mean,
            "lattice_spacing_factor": ve(fa, fe),
            "a2_factor": fa * fa if ok(fa) else None,
            "note": "max - min over the set, its significance (independent ensembles), and "
                    "the factor in the lattice spacing a between the coarsest and the finest "
                    "lattice (from a*sqrt(sigma))"}


def _lit_pulls(value, err, node):
    """Pulls of one of our numbers against a literature node (primary + alternatives)."""
    out = []
    for e in lit_entries(node):
        out.append({"lit_role": e["_role"], "lit_value": num(e.get("value")),
                    "lit_unc": num(e.get("uncertainty")),
                    "verification_level": e.get("verification_level"),
                    "source_short": lit_short_source(e),
                    "pull": pull(value, err, e.get("value"), e.get("uncertainty"))})
    return out


def scaling_d3(recs, lit):
    sec = lit[LIT_SECTION[3]]
    out = {"note": D3_LIMIT_NOTE,
           "x": "a^2 sigma (Nambu-Goto, same variant as the ordinate)",
           "y": "m(0++)/sqrt(sigma)", "sets": {}, "sqrt_sigma_over_g2": {}, "m_over_g2": {}}
    lit_cont = sec["continuum_m0pp_over_sqrt_sigma"]
    lit_sg = sec["continuum_sqrt_sigma_over_g2"]
    # derived reference for m/g^2: product of two excerpt-level continuum numbers
    alt = lit_entries(lit_cont)[1] if len(lit_entries(lit_cont)) > 1 else lit_entries(lit_cont)[0]
    mg_v, mg_e = product_indep(alt.get("value"), alt.get("uncertainty"),
                               lit_sg.get("value"), lit_sg.get("uncertainty"))
    out["m_over_g2_reference"] = {
        "value": mg_v, "err": mg_e,
        "how": f"product {alt.get('value')}({alt.get('uncertainty')}) x {lit_sg.get('value')}"
               f"({lit_sg.get('uncertainty')}) of two literature continuum values (errors in "
               "quadrature); a DERIVED number, not a literature entry",
        "verification_level": "derived from search_excerpt entries"}
    for set_name, names in SCALING_SETS[3].items():
        s_ratio, s_sig, s_m = {"ensembles": names}, {"ensembles": names}, {"ensembles": names}
        for variant in VARIANTS:
            # --- m/sqrt(sigma) versus a^2 sigma
            pts = _ratio_points(recs, names, variant)
            blk = {"points": pts, "range": _range_block(pts)}
            fits = _fit_points(pts)
            if fits is None:
                blk["fits"] = None
                blk["reason"] = "at least one point is not a measurement"
            else:
                blk.update(fits)
                blk["pulls_constant_vs_literature"] = _lit_pulls(
                    fits["fit_constant"]["value"], fits["fit_constant"]["err"], lit_cont)
                blk["pulls_linear_vs_literature"] = _lit_pulls(
                    fits["fit_linear"]["intercept"], fits["fit_linear"]["intercept_err"],
                    lit_cont)
            s_ratio[variant] = blk
            # --- sqrt(sigma)/g^2 = beta a sqrt(sigma)/4 versus 1/beta
            pts = []
            for n in names:
                r = recs[n]
                y = r["D3"]["sqrt_sigma_over_g2"][variant]
                p = r["plaquette"]["value"]
                bi = r["beta"] * p
                s = r["a_sqrt_sigma"][variant]
                pts.append({"ensemble": n, "beta": r["beta"], "x": 1.0 / r["beta"], "x_err": 0.0,
                            "y": y["value"], "y_err": y["err"],
                            "is_measurement": bool(y["is_measurement"]),
                            "x_improved": 1.0 / bi,
                            "y_improved": bi * s["value"] / 4.0 if ok(s["value"]) else None,
                            "y_improved_err": bi * s["err"] / 4.0 if ok(s["err"]) else None})
            blk = {"points": pts}
            if all(p["is_measurement"] for p in pts):
                x = [p["x"] for p in pts]
                y = [p["y"] for p in pts]
                e = [p["y_err"] for p in pts]
                lin, quad = fit_linear(x, y, e), fit_quadratic(x, y, e)
                blk["fit_linear_in_1_over_beta"] = lin
                blk["fit_quadratic_in_1_over_beta"] = quad
                blk["pull_linear_vs_literature"] = pull(
                    lin["intercept"], lin["intercept_err"], lit_sg["value"],
                    lit_sg["uncertainty"])
                blk["pull_quadratic_vs_literature"] = pull(
                    quad["intercept"], quad["intercept_err"], lit_sg["value"],
                    lit_sg["uncertainty"])
                xi = [p["x_improved"] for p in pts]
                yi = [p["y_improved"] for p in pts]
                ei = [p["y_improved_err"] for p in pts]
                imp = fit_linear(xi, yi, ei)
                imp["note"] = ("mean-field improved coupling beta_I = beta * <plaquette>: "
                               "beta_I a sqrt(sigma)/4 linear in 1/beta_I. That the published "
                               "value was obtained with this form is quoted FROM MEMORY in "
                               "literature.json (unverified); plaquette errors neglected.")
                blk["fit_linear_improved_coupling"] = imp
                blk["pull_improved_vs_literature"] = pull(
                    imp["intercept"], imp["intercept_err"], lit_sg["value"],
                    lit_sg["uncertainty"])
            else:
                blk["reason"] = "at least one point is not a measurement"
            s_sig[variant] = blk
            # --- m/g^2 = beta a m / 4 versus 1/beta
            pts = []
            for n in names:
                r = recs[n]
                y = r["D3"]["m_over_g2"][variant]
                pts.append({"ensemble": n, "beta": r["beta"], "x": 1.0 / r["beta"], "x_err": 0.0,
                            "y": y["value"], "y_err": y["err"],
                            "is_measurement": bool(y["is_measurement"])})
            blk = {"points": pts}
            if all(p["is_measurement"] for p in pts):
                lin = fit_linear([p["x"] for p in pts], [p["y"] for p in pts],
                                 [p["y_err"] for p in pts])
                blk["fit_linear_in_1_over_beta"] = lin
                blk["pull_linear_vs_derived_reference"] = pull(
                    lin["intercept"], lin["intercept_err"], mg_v, mg_e)
            s_m[variant] = blk
        out["sets"][set_name] = s_ratio
        out["sqrt_sigma_over_g2"][set_name] = s_sig
        out["m_over_g2"][set_name] = s_m
    out["literature"] = {
        "continuum_m0pp_over_sqrt_sigma": [
            {"role": e["_role"], "value": e.get("value"), "unc": e.get("uncertainty"),
             "verification_level": e.get("verification_level"),
             "source_short": lit_short_source(e)} for e in lit_entries(lit_cont)],
        "continuum_sqrt_sigma_over_g2": {
            "value": lit_sg.get("value"), "unc": lit_sg.get("uncertainty"),
            "verification_level": lit_sg.get("verification_level"),
            "source_short": lit_short_source(lit_sg),
            "caveat": "the published value uses more beta values and (from memory) an improved "
                      "coupling; a naive three-point extrapolation in the bare 1/beta is not the "
                      "same procedure, so a difference tests the ansatz as much as the data"},
    }
    return out


def _gated(fit, kind):
    """D = 4 rule: an extrapolated number is printed only for an acceptable fit."""
    out = {"chi2": fit["chi2"], "dof": fit["dof"], "chi2_dof": fit["chi2_dof"],
           "p_value": fit["p_value"], "n_points": fit["n_points"],
           "acceptable": is_acceptable(fit)}
    if out["acceptable"]:
        out["extrapolation_reported"] = True
        if kind == "linear":
            out.update({"intercept": fit["intercept"], "intercept_err": fit["intercept_err"],
                        "slope": fit["slope"], "slope_err": fit["slope_err"],
                        "max_slope_times_xerr_over_yerr":
                            fit.get("max_slope_times_xerr_over_yerr")})
        else:
            out.update({"value": fit["value"], "err": fit["err"]})
        out["why_not_trusted"] = D4_DISTRUST
    else:
        out["extrapolation_reported"] = False
        out["reason"] = (f"fit not statistically acceptable (p < {ACCEPT_P}): no extrapolated "
                         "value is given")
    return out


def scaling_d4(recs, lit):
    sec = lit[LIT_SECTION[4]]
    lit_cont = sec["continuum_m0pp_over_sqrt_sigma"]
    out = {"note": "No controlled continuum limit: " + D4_DISTRUST,
           "x": "a^2 sigma (Nambu-Goto, same variant as the ordinate)",
           "y": "m(0++)/sqrt(sigma)", "accept_p": ACCEPT_P, "sets": {},
           "asymptotic_scaling": {
               "formula": "a*Lambda_L = (6 pi^2 beta/11)^(51/121) exp(-3 pi^2 beta/11) "
                          "(ym/exact.py: a_lambda_two_loop)",
               "note": "If two-loop asymptotic scaling held, m/Lambda_L and sqrt(sigma)/Lambda_L "
                       "would not depend on beta and the ratio of lattice spacings from "
                       "sqrt(sigma) would equal the two-loop ratio.",
               "sets": {}}}
    for set_name, names in SCALING_SETS[4].items():
        s_ratio, s_as = {"ensembles": names}, {"ensembles": names}
        for variant in VARIANTS:
            pts = _ratio_points(recs, names, variant)
            blk = {"points": pts, "range": _range_block(pts)}
            fits = _fit_points(pts)
            if fits is None:
                blk["reason"] = "at least one point is not a measurement"
            else:
                blk["fit_constant"] = _gated(fits["fit_constant"], "constant")
                blk["fit_linear"] = _gated(fits["fit_linear"], "linear")
                if blk["fit_linear"]["extrapolation_reported"]:
                    blk["pulls_linear_vs_literature"] = _lit_pulls(
                        fits["fit_linear"]["intercept"], fits["fit_linear"]["intercept_err"],
                        lit_cont)
                if blk["fit_constant"]["extrapolation_reported"]:
                    blk["pulls_constant_vs_literature"] = _lit_pulls(
                        fits["fit_constant"]["value"], fits["fit_constant"]["err"], lit_cont)
            drift = []
            for i, j in ((0, 1), (1, 2), (0, 2)):
                a, b = pts[j], pts[i]
                d = diff_sigma(a["y"], a["y_err"], b["y"], b["y_err"])
                d.update({"from_beta": b["beta"], "to_beta": a["beta"],
                          "is_measurement": a["is_measurement"] and b["is_measurement"]})
                drift.append(d)
            blk["drift"] = drift
            # finest lattice against the continuum literature value: NOT like for like
            fin = pts[-1]
            blk["finest_beta_vs_continuum_literature"] = {
                "note": "our value at finite lattice spacing against a continuum value: not a "
                        "like-for-like comparison, shown for orientation only",
                "ensemble": fin["ensemble"],
                "pulls": _lit_pulls(fin["y"], fin["y_err"], lit_cont)}
            s_ratio[variant] = blk

            # --- asymptotic scaling
            rows = []
            for n in names:
                r = recs[n]
                rows.append({"ensemble": n, "beta": r["beta"],
                             "a_lambda_two_loop": r["D4"]["a_lambda_two_loop"],
                             "m_over_lambda": r["D4"]["m_over_lambda"][variant],
                             "sqrt_sigma_over_lambda": r["D4"]["sqrt_sigma_over_lambda"][variant]})
            ablk = {"rows": rows}
            for key in ("sqrt_sigma_over_lambda", "m_over_lambda"):
                vals = [(q[key]["value"], q[key]["err"]) for q in rows]
                if all(ok(v, e) for v, e in vals):
                    f = fit_constant([v for v, _ in vals], [e for _, e in vals])
                    rv, re_ = ratio_indep(vals[-1][0], vals[-1][1], vals[0][0], vals[0][1])
                    ablk[key + "_constancy"] = {
                        "chi2": f["chi2"], "dof": f["dof"], "p_value": f["p_value"],
                        "last_over_first": ve(rv, re_),
                        "percent_change_first_to_last": 100.0 * (rv - 1.0),
                        "percent_change_err": 100.0 * re_}
            sp = []
            for i, j in ((0, 1), (1, 2), (0, 2)):
                a, b = recs[names[i]], recs[names[j]]
                two = a["D4"]["a_lambda_two_loop"] / b["D4"]["a_lambda_two_loop"]
                row = {"coarse": names[i], "fine": names[j],
                       "betas": [a["beta"], b["beta"]], "two_loop": two}
                for key, q in (("from_sqrt_sigma", "a_sqrt_sigma"), ("from_glueball_mass", "am")):
                    v, e = ratio_indep(a[q][variant]["value"], a[q][variant]["err"],
                                       b[q][variant]["value"], b[q][variant]["err"])
                    row[key] = ve(v, e,
                                  percent_above_two_loop=(100.0 * (v / two - 1.0) if ok(v)
                                                          else None),
                                  sigma_from_two_loop=((v - two) / e if ok(v, e) and e > 0
                                                       else None))
                sp.append(row)
            ablk["lattice_spacing_ratios"] = sp
            s_as[variant] = ablk
        out["sets"][set_name] = s_ratio
        out["asymptotic_scaling"]["sets"][set_name] = s_as
    out["literature"] = {"continuum_m0pp_over_sqrt_sigma": [
        {"role": e["_role"], "value": e.get("value"), "unc": e.get("uncertainty"),
         "verification_level": e.get("verification_level"),
         "source_short": lit_short_source(e)} for e in lit_entries(lit_cont)]}
    return out


# ==============================================================================================
# section 4 and 5: pairs of ensembles
# ==============================================================================================
PAIR_QUANTITIES = (
    ("am", "a*m(0++)"),
    ("aE_torelon", "a*E(torelon)"),
    ("a_sqrt_sigma", "a*sqrt(sigma) [Nambu-Goto]"),
    ("a_sqrt_sigma_luscher", "a*sqrt(sigma) [Luscher]"),
    ("m_over_sqrt_sigma", "m/sqrt(sigma)"),
)


def compare_pair(ra, rb, kind):
    """All differences A - B between two statistically independent ensembles."""
    rows = []
    for key, label in PAIR_QUANTITIES:
        if key == "aE_torelon" and ra["L"] != rb["L"]:
            continue                                  # torelon energies of different length
        for variant in VARIANTS:
            a, b = ra[key][variant], rb[key][variant]
            d = diff_sigma(a["value"], a["err"], b["value"], b["err"])
            both = bool(a.get("is_measurement")) and bool(b.get("is_measurement"))
            row = {"quantity": label, "key": key, "variant": variant,
                   "A": ve(a["value"], a["err"]), "B": ve(b["value"], b["err"]),
                   "diff": d["diff"], "err": d["err"],
                   "sigma": d["sigma"] if both else None,
                   "both_measurements": both}
            if variant == "R5":
                row["t_A"], row["t_B"] = a.get("t_value"), b.get("t_value")
                if key == "m_over_sqrt_sigma":
                    row["t_A"] = [a.get("t_glueball"), a.get("t_torelon")]
                    row["t_B"] = [b.get("t_glueball"), b.get("t_torelon")]
            if not both:
                row["note"] = ("at least one side is 'no plateau' (upper bound only): not a "
                               "measurement, no significance quoted")
            rows.append(row)
    d = diff_sigma(ra["plaquette"]["value"], ra["plaquette"]["err"],
                   rb["plaquette"]["value"], rb["plaquette"]["err"])
    rows.append({"quantity": "plaquette", "key": "plaquette", "variant": "-",
                 "A": ra["plaquette"], "B": rb["plaquette"], "diff": d["diff"], "err": d["err"],
                 "sigma": d["sigma"], "both_measurements": True})
    return {"kind": kind, "A": ra["name"], "B": rb["name"],
            "lattice_A": ra["lattice"], "lattice_B": rb["lattice"], "beta": ra["beta"],
            "D": ra["D"], "rows": rows,
            "note": "A - B; the two ensembles are statistically independent (different seeds), "
                    "errors added in quadrature"}


# ==============================================================================================
# round 3: finite volume at beta = 2.5 (criterion of run_round3_production.sh, round3_plan.md)
# ==============================================================================================
def round3_verdict(ref, new, nsigma=ROUND3_NSIGMA):
    """Volume test of the glueball mass between two independent ensembles at the same beta.

    Reading A (pure finite-size gap, m ~ 1/L) predicts a*m(new) = a*m(ref) * L_ref / L_new;
    reading B (volume-independent gap) predicts a*m(new) = a*m(ref).  The verdict uses the
    fixed-t value m_eff(1) only, as fixed before the run: reading A is excluded if the measured
    value lies more than ``nsigma`` (errors in quadrature) above its prediction; the reference
    value is called volume-contaminated if the measured value lies more than ``nsigma`` below it.
    """
    out = {"reference": ref["name"], "ensemble": new["name"], "L_reference": ref["L"],
           "L": new["L"], "criterion_sigma": nsigma, "primary_quantity": "am t1 (m_eff(1))"}
    scale = ref["L"] / new["L"]
    for v in VARIANTS:
        a, b = ref["am"][v], new["am"][v]
        if not (ok(a["value"], a["err"], b["value"], b["err"]) and a["value"] > 0
                and b["value"] > 0):
            out[v] = None
            continue
        pred = ve(a["value"] * scale, a["err"] * scale)
        lnr = math.log(new["L"] / ref["L"])
        out[v] = {
            "measured": ve(b["value"], b["err"]), "reference": ve(a["value"], a["err"]),
            "both_measurements": bool(a.get("is_measurement")) and bool(b.get("is_measurement")),
            "reading_A_prediction": pred,
            "measured_minus_A": diff_sigma(b["value"], b["err"], pred["value"], pred["err"]),
            "measured_minus_reference": diff_sigma(b["value"], b["err"], a["value"], a["err"]),
            "amL_reference": ve(a["value"] * ref["L"], a["err"] * ref["L"]),
            "amL_measured": ve(b["value"] * new["L"], b["err"] * new["L"]),
            "exponent_q": ve(-math.log(b["value"] / a["value"]) / lnr,
                             math.hypot(a["err"] / a["value"], b["err"] / b["value"]) / lnr,
                             note="m ~ L^-q from the two volumes; q = 1 pure finite-size gap, "
                                  "q = 0 volume-independent gap"),
        }
    t1 = out.get("t1")
    if t1:
        sa, sb = t1["measured_minus_A"]["sigma"], t1["measured_minus_reference"]["sigma"]
        out["verdict"] = {"reading_A_excluded": bool(sa is not None and sa > nsigma),
                          "reference_volume_contaminated": bool(sb is not None and sb < -nsigma)}
    else:
        out["verdict"] = {"reading_A_excluded": None, "reference_volume_contaminated": None}
    return out


def round3_block(recs):
    """Round 3 as fixed beforehand: volume test at beta = 2.5 and the largest-volume D=4 set."""
    out = round3_verdict(recs[ROUND3_REF], recs[ROUND3_NEW])
    out["note"] = ("Criterion and predictions were committed in run_round3_production.sh before "
                   "the run, the list of what is computed in round3_plan.md before its data were "
                   "looked at. Statistical errors only; the masses are variational upper "
                   "estimates. Numerical evidence, not a proof.")
    lv = {"ensembles": LARGEST_VOLUME_D4,
          "note": "largest volume at each beta; shown next to the pre-registered primary set, "
                  "not instead of it. No continuum value is quoted from either set. Fixed-t "
                  "ratio errors: uncorrelated propagation (see ratio_error_check)."}
    for v in ("t1", "R5"):
        pts = _ratio_points(recs, LARGEST_VOLUME_D4, v)
        fit = None
        if all(p["is_measurement"] and ok(p["y"], p["y_err"]) for p in pts):
            fit = fit_constant([p["y"] for p in pts], [p["y_err"] for p in pts])
        lv[v] = {"points": pts, "fit_constant": fit}
    out["largest_volume_set"] = lv
    return out


# ==============================================================================================
# section 6: literature
# ==============================================================================================
LIT_QUANTITIES = (("plaquette", "plaquette"), ("a_sqrt_sigma", "a*sqrt(sigma)"),
                  ("a_m_0pp", "a*m(0++)"))


def literature_rows(recs, lit):
    """One row per (ensemble, literature entry) with the same D, beta and quantity."""
    rows = []
    for name in TABLE_ORDER:
        if name not in recs:
            continue
        r = recs[name]
        sec = lit.get(LIT_SECTION[r["D"]], {})
        for qkey, qlabel in LIT_QUANTITIES:
            node = (sec.get(qkey) or {}).get(beta_key(r["beta"]))
            if node is None:
                continue
            entries = lit_entries(node)
            same = [e["_index"] for e in entries if lit_lattice_L(e) == r["L"]]
            matched_index = same[0] if same else 0
            for e in entries:
                lv, lu = num(e.get("value")), num(e.get("uncertainty"))
                row = {"ensemble": name, "D": r["D"], "beta": r["beta"], "lattice": r["lattice"],
                       "quantity": qlabel, "lit_role": e["_role"], "lit_index": e["_index"],
                       "lit_value": lv, "lit_unc": lu,
                       "verification_level": e.get("verification_level"),
                       "web_verified": bool(e.get("web_verified")),
                       "lit_lattice_L": lit_lattice_L(e),
                       "same_L": lit_lattice_L(e) == r["L"],
                       "matched": e["_index"] == matched_index,
                       "source_short": lit_short_source(e)}
                if qkey == "plaquette":
                    p = r["plaquette"]
                    ours = {k: ve(p["value"], p["err"], is_measurement=True) for k in VARIANTS}
                    row["note"] = "no plateau choice involved: the variant columns are identical"
                elif qkey == "a_sqrt_sigma":
                    ours = {k: r["a_sqrt_sigma"][k] for k in VARIANTS}
                    lus = {k: r["a_sqrt_sigma_luscher"][k] for k in VARIANTS}
                    row["ours_luscher"] = {k: ve(lus[k]["value"], lus[k]["err"],
                                                 is_measurement=lus[k]["is_measurement"])
                                           for k in lus}
                    row["pull_luscher"] = {
                        k: (pull(lus[k]["value"], lus[k]["err"], lv, lu)
                            if lus[k]["is_measurement"] else None) for k in lus}
                else:
                    ours = {k: r["am"][k] for k in VARIANTS}
                row["ours"] = {k: ve(ours[k]["value"], ours[k]["err"],
                                     is_measurement=bool(ours[k]["is_measurement"]))
                               for k in ours}
                row["pull"] = {k: (pull(ours[k]["value"], ours[k]["err"], lv, lu)
                                   if ours[k]["is_measurement"] else None) for k in ours}
                rows.append(row)
    return rows


def literature_derived_rows(recs, lit):
    """m/sqrt(sigma) at finite beta from two literature entries of the same lattice (derived)."""
    rows = []
    for name in TABLE_ORDER:
        if name not in recs:
            continue
        r = recs[name]
        sec = lit.get(LIT_SECTION[r["D"]], {})
        bk = beta_key(r["beta"])
        nm, ns = (sec.get("a_m_0pp") or {}).get(bk), (sec.get("a_sqrt_sigma") or {}).get(bk)
        if nm is None or ns is None:
            continue
        em = lit_entries(nm)[0]
        cand = lit_entries(ns)
        lm = lit_lattice_L(em)
        same = [e for e in cand if lm is not None and lit_lattice_L(e) == lm]
        es = same[0] if same else cand[0]
        v, e = ratio_indep(em.get("value"), em.get("uncertainty"),
                           es.get("value"), es.get("uncertainty"))
        levels = {em.get("verification_level"), es.get("verification_level")}
        row = {"ensemble": name, "D": r["D"], "beta": r["beta"], "lattice": r["lattice"],
               "quantity": "m/sqrt(sigma)", "lit_value": v, "lit_unc": e,
               "lit_a2_sigma": float(es["value"]) ** 2 if ok(es.get("value")) else None,
               "how": f"{em.get('value')}({em.get('uncertainty')}) / {es.get('value')}"
                      f"({es.get('uncertainty')}), errors in quadrature; DERIVED, not a "
                      "literature entry",
               "verification_level": "none" if "none" in levels else "search_excerpt",
               "lit_lattice_L": lm, "ours": {}, "pull": {}}
        for k in VARIANTS:
            o = r["m_over_sqrt_sigma"][k]
            row["ours"][k] = ve(o["value"], o["err"], is_measurement=bool(o["is_measurement"]),
                                err_kind=o.get("err_kind"))
            row["pull"][k] = pull(o["value"], o["err"], v, e) if o["is_measurement"] else None
        rows.append(row)
    return rows


def _count_block(rows, ensembles, matched_only, key="pull"):
    sel = [r for r in rows if r["ensemble"] in ensembles and (r["matched"] or not matched_only)]
    out = {}
    for k in VARIANTS:
        out[k] = count_pulls([r[key][k] for r in sel if key in r])
        out[k]["rows_gt_2"] = [
            {"ensemble": r["ensemble"], "quantity": r["quantity"], "lit_role": r["lit_role"],
             "lit": fmt_lit(r["lit_value"], r["lit_unc"]),
             "verification_level": r["verification_level"], "pull": r[key][k]}
            for r in sel if key in r and num(r[key][k]) is not None and abs(r[key][k]) > 2.0]
    return out


def continuum_rows(d3, d4):
    """Our extrapolated numbers against literature continuum values (collected from the scaling
    sections; an uncontrolled three-point extrapolation is NOT a like-for-like comparison)."""
    rows = []

    def add(D, quantity, set_name, variant, fit, value, err, fitq, lit_role, lv, lu, level, pl,
            note):
        rows.append({"D": D, "quantity": quantity, "set": set_name, "variant": variant,
                     "fit": fit, "value": value, "err": err, "chi2": fitq.get("chi2"),
                     "dof": fitq.get("dof"), "p_value": fitq.get("p_value"),
                     "acceptable": fitq.get("acceptable", is_acceptable(fitq)),
                     "lit_role": lit_role, "lit_value": lv, "lit_unc": lu,
                     "verification_level": level, "pull": pl, "note": note})

    for set_name in ("primary", "all_data"):
        for variant in VARIANTS:
            b = d3["sets"][set_name][variant]
            for fit, key, vkey, ekey in (("constant", "fit_constant", "value", "err"),
                                         ("linear in a^2 sigma", "fit_linear", "intercept",
                                          "intercept_err")):
                f = b.get(key)
                if not f:
                    continue
                pk = "pulls_constant_vs_literature" if key == "fit_constant" \
                    else "pulls_linear_vs_literature"
                for q in b[pk]:
                    add(3, "m/sqrt(sigma), a -> 0", set_name, variant, fit, f[vkey], f[ekey], f,
                        q["lit_role"], q["lit_value"], q["lit_unc"], q["verification_level"],
                        q["pull"], "three-point fit; indicative only")
            g = d3["sqrt_sigma_over_g2"][set_name][variant]
            ls = d3["literature"]["continuum_sqrt_sigma_over_g2"]
            for fit, key, pk in (
                    ("linear in 1/beta", "fit_linear_in_1_over_beta", "pull_linear_vs_literature"),
                    ("quadratic in 1/beta (0 dof)", "fit_quadratic_in_1_over_beta",
                     "pull_quadratic_vs_literature"),
                    ("linear in 1/beta_I (improved coupling)", "fit_linear_improved_coupling",
                     "pull_improved_vs_literature")):
                f = g.get(key)
                if not f:
                    continue
                add(3, "sqrt(sigma)/g^2, a -> 0", set_name, variant, fit, f["intercept"],
                    f["intercept_err"], f, "primary", ls["value"], ls["unc"],
                    ls["verification_level"], g[pk], "ansatz dependence visible across the fits")
            b4 = d4["sets"][set_name][variant]
            f = b4.get("fit_linear")
            if f and f.get("extrapolation_reported"):
                for q in b4["pulls_linear_vs_literature"]:
                    add(4, "m/sqrt(sigma), a -> 0", set_name, variant, "linear in a^2 sigma",
                        f["intercept"], f["intercept_err"], f, q["lit_role"], q["lit_value"],
                        q["lit_unc"], q["verification_level"], q["pull"],
                        "formally acceptable fit, NOT a continuum limit (see scaling_d4.note)")
    return rows


def literature_comparison(recs, lit):
    rows = literature_rows(recs, lit)
    derived = literature_derived_rows(recs, lit)
    counts = {}
    for set_name, ens in (("primary_ensembles", PRIMARY),
                          ("independent_all_data", INDEPENDENT_ALL)):
        counts[set_name] = {
            "ensembles": ens,
            "matched_entry_only": _count_block(rows, ens, True),
            "all_entries_including_alternatives": _count_block(rows, ens, False),
            "matched_entry_only_luscher_string_tension": _count_block(
                [r for r in rows if "pull_luscher" in r], ens, True, key="pull_luscher"),
            "by_quantity_matched": {
                q: _count_block([r for r in rows if r["quantity"] == q], ens, True)
                for _, q in LIT_QUANTITIES},
            "by_verification_level_matched": {
                lvl: _count_block([r for r in rows if r["verification_level"] == lvl], ens, True)
                for lvl in ("search_excerpt", "none")},
        }
    dcounts = {}
    for set_name, ens in (("primary_ensembles", PRIMARY),
                          ("independent_all_data", INDEPENDENT_ALL)):
        sel = [r for r in derived if r["ensemble"] in ens]
        dcounts[set_name] = {k: count_pulls([r["pull"][k] for r in sel]) for k in VARIANTS}
    used = {(LIT_SECTION[r["D"]], q, beta_key(r["beta"])) for r in rows
            for q, lab in LIT_QUANTITIES if lab == r["quantity"]}
    unmatched = []
    for sec_name in LIT_SECTION.values():
        for q, node in (lit.get(sec_name) or {}).items():
            if q.startswith("continuum"):
                continue
            if isinstance(node, dict) and "value" not in node:
                for bk in node:
                    if (sec_name, q, bk) not in used:
                        unmatched.append(f"{sec_name}.{q}.{bk}")
    return {
        "note": "pull = (ours - literature)/sqrt(err_ours^2 + unc_lit^2). 'matched' = the "
                "literature entry with the same spatial lattice size if literature.json names "
                "one, otherwise the primary entry; one matched entry per ensemble and quantity. "
                "Counts over 'all entries' include alternatives of the same quantity and are "
                "therefore not independent. The Gaussian expectation assumes independent pulls "
                "with correct errors. Literature numbers are at best 'seen in a web-search "
                "excerpt' (search_excerpt) or quoted from memory (none); none was checked "
                "against a published table.",
        "rows": rows, "counts": counts,
        "derived_ratio_rows": derived, "derived_ratio_counts": dcounts,
        "literature_entries_without_a_corresponding_measurement": unmatched,
    }


# ==============================================================================================
# section 7: headline
# ==============================================================================================
def _texts(block, decimals):
    """{'R5': '1.1959(77)', 't1': ..., 't2': ...}; values that are not measurements are marked."""
    return {k: fmt_ve(block[k]["value"], block[k]["err"], decimals)
            + ("" if block[k].get("is_measurement", True)
               else " [no plateau: upper bound only, not a measurement]") for k in VARIANTS}


def _fitq(fit, value_key="value", err_key="err", decimals=3):
    """Compact fit record for the headline list."""
    out = {"chi2": fit["chi2"], "dof": fit["dof"], "p_value": fit["p_value"],
           "acceptable": fit.get("acceptable", is_acceptable(fit))}
    if fit.get(value_key) is not None:
        out.update({"value": fit[value_key], "err": fit[err_key],
                    "text": fmt_ve(fit[value_key], fit[err_key], decimals)})
    else:
        out["text"] = "not reported (fit not acceptable)"
    return out


def build_headline(summary):
    """Short list of the numbers a report should quote, each with its source key."""
    recs = summary["ensembles"]
    H = []

    def add(hid, description, source, **payload):
        item = {"id": hid, "description": description, "source": source}
        item.update(payload)
        H.append(item)

    for n in TABLE_ORDER:
        r = recs[n]
        add(f"ensemble.{n}",
            f"{n}: D={r['D']}, beta={r['beta']:g}, lattice {r['lattice']}, round {r['round']} "
            f"({r['role']}), {r['n_meas']} measurements. Every quantity as R5 / fixed t=1 / "
            "fixed t=2; statistical errors only; masses are variational upper estimates.",
            f"summary.json: ensembles.{n}.{{am,a_sqrt_sigma,m_over_sqrt_sigma}}  <-  "
            f"results/{n}.json: glueball.{{mass,err,fixed_t}}, string_tension, ratios",
            am=_texts(r["am"], 4), am_t_star=r["am"]["R5"]["t_star"],
            a_sqrt_sigma=_texts(r["a_sqrt_sigma"], 4),
            torelon_t_star=r["a_sqrt_sigma"]["R5"]["t_star"],
            m_over_sqrt_sigma=_texts(r["m_over_sqrt_sigma"], 3),
            m_over_sqrt_sigma_err_kind={k: r["m_over_sqrt_sigma"][k].get("err_kind")
                                        for k in VARIANTS},
            am_over_err=r["am_over_err"])

    for set_name in ("primary", "all_data"):
        for variant in ("R5", "t1"):
            blk = summary["scaling_d3"]["sets"][set_name][variant]
            if blk.get("fit_constant"):
                add(f"d3.m_over_sqrt_sigma.{set_name}.{variant}",
                    "D=3 m/sqrt(sigma) at beta = 6, 9, 12 with a constant fit and a straight "
                    "line in a^2 sigma. Three points and a variational systematic: indicative "
                    "only, not a controlled continuum limit.",
                    f"summary.json: scaling_d3.sets.{set_name}.{variant}",
                    ensembles=summary["scaling_d3"]["sets"][set_name]["ensembles"],
                    points=[fmt_ve(q["y"], q["y_err"], 3) for q in blk["points"]],
                    spread_percent_of_mean=blk["range"]["spread_percent_of_mean"],
                    max_minus_min_sigma=blk["range"]["max_minus_min"]["sigma"],
                    lattice_spacing_factor=blk["range"]["lattice_spacing_factor"]["value"],
                    constant=_fitq(blk["fit_constant"]),
                    linear_intercept=_fitq(blk["fit_linear"], "intercept", "intercept_err"),
                    pulls_constant_vs_literature=[
                        {"lit": fmt_lit(q["lit_value"], q["lit_unc"]),
                         "verification_level": q["verification_level"], "pull": q["pull"]}
                        for q in blk["pulls_constant_vs_literature"]],
                    pulls_linear_vs_literature=[
                        {"lit": fmt_lit(q["lit_value"], q["lit_unc"]),
                         "verification_level": q["verification_level"], "pull": q["pull"]}
                        for q in blk["pulls_linear_vs_literature"]])
            g = summary["scaling_d3"]["sqrt_sigma_over_g2"][set_name][variant]
            if g.get("fit_linear_in_1_over_beta"):
                ls = summary["scaling_d3"]["literature"]["continuum_sqrt_sigma_over_g2"]
                add(f"d3.sqrt_sigma_over_g2.{set_name}.{variant}",
                    "D=3 sqrt(sigma)/g^2 = beta*a*sqrt(sigma)/4 at beta = 6, 9, 12 and its "
                    "extrapolation to 1/beta = 0 with three ansaetze (the spread between them "
                    "is the visible ansatz dependence).",
                    f"summary.json: scaling_d3.sqrt_sigma_over_g2.{set_name}.{variant}",
                    points=[fmt_ve(q["y"], q["y_err"], 4) for q in g["points"]],
                    linear=_fitq(g["fit_linear_in_1_over_beta"], "intercept", "intercept_err", 4),
                    quadratic_0_dof=fmt_ve(g["fit_quadratic_in_1_over_beta"]["intercept"],
                                           g["fit_quadratic_in_1_over_beta"]["intercept_err"], 4),
                    linear_improved_coupling=_fitq(g["fit_linear_improved_coupling"],
                                                   "intercept", "intercept_err", 4),
                    literature=fmt_lit(ls["value"], ls["unc"]),
                    literature_verification_level=ls["verification_level"],
                    pull_linear=g["pull_linear_vs_literature"],
                    pull_quadratic=g["pull_quadratic_vs_literature"],
                    pull_improved=g["pull_improved_vs_literature"])
    for set_name in ("primary", "all_data"):
        for variant in ("R5", "t1"):
            blk = summary["scaling_d4"]["sets"][set_name][variant]
            if not blk.get("fit_linear"):
                continue
            d = blk["drift"][2]
            fl = blk["fit_linear"]
            add(f"d4.m_over_sqrt_sigma.{set_name}.{variant}",
                "D=4 m/sqrt(sigma) at beta = 2.3, 2.4, 2.5: upward drift; a straight line in "
                "a^2 sigma is printed only when acceptable and is NOT a continuum limit.",
                f"summary.json: scaling_d4.sets.{set_name}.{variant}",
                ensembles=summary["scaling_d4"]["sets"][set_name]["ensembles"],
                points=[fmt_ve(q["y"], q["y_err"], 3) for q in blk["points"]],
                spread_percent_of_mean=blk["range"]["spread_percent_of_mean"],
                max_minus_min_sigma=blk["range"]["max_minus_min"]["sigma"],
                lattice_spacing_factor=blk["range"]["lattice_spacing_factor"]["value"],
                L_sqrt_sigma=[fmt_ve(q["L_sqrt_sigma"], q["L_sqrt_sigma_err"], 2)
                              for q in blk["points"]],
                drift_2p3_to_2p5={"text": fmt_ve(d["diff"], d["err"], 3), "sigma": d["sigma"]},
                constant_fit={"chi2": blk["fit_constant"]["chi2"],
                              "dof": blk["fit_constant"]["dof"],
                              "p_value": blk["fit_constant"]["p_value"],
                              "acceptable": blk["fit_constant"]["acceptable"]},
                linear_intercept=_fitq(fl, "intercept", "intercept_err"),
                why_not_trusted=fl.get("why_not_trusted"),
                pulls_linear_vs_literature=[
                    {"lit": fmt_lit(q["lit_value"], q["lit_unc"]),
                     "verification_level": q["verification_level"], "pull": q["pull"]}
                    for q in blk.get("pulls_linear_vs_literature") or []])
        ab = summary["scaling_d4"]["asymptotic_scaling"]["sets"][set_name]["R5"]
        c = ab["sqrt_sigma_over_lambda_constancy"]
        add(f"d4.asymptotic_scaling.{set_name}",
            "D=4 distance from two-loop asymptotic scaling (R5 values): sqrt(sigma)/Lambda_L "
            "at beta = 2.3, 2.4, 2.5 and ratios of lattice spacings from sqrt(sigma) against "
            "the two-loop formula.",
            f"summary.json: scaling_d4.asymptotic_scaling.sets.{set_name}.R5",
            sqrt_sigma_over_lambda=[fmt_ve(q["sqrt_sigma_over_lambda"]["value"],
                                           q["sqrt_sigma_over_lambda"]["err"], 1)
                                    for q in ab["rows"]],
            percent_change_2p3_to_2p5={"value": c["percent_change_first_to_last"],
                                       "err": c["percent_change_err"]},
            constant_fit_chi2=c["chi2"], constant_fit_dof=c["dof"],
            lattice_spacing_ratios=[
                {"betas": q["betas"], "two_loop": q["two_loop"],
                 "from_sqrt_sigma": fmt_ve(q["from_sqrt_sigma"]["value"],
                                           q["from_sqrt_sigma"]["err"], 3),
                 "percent_above_two_loop": q["from_sqrt_sigma"]["percent_above_two_loop"],
                 "sigma_from_two_loop": q["from_sqrt_sigma"]["sigma_from_two_loop"]}
                for q in ab["lattice_spacing_ratios"]])
    for sec_key in ("finite_volume", "replication"):
        for i, cmp_ in enumerate(summary[sec_key]):
            payload = {}
            for row in cmp_["rows"]:
                if row["key"] in ("am", "a_sqrt_sigma", "m_over_sqrt_sigma", "plaquette"):
                    dec = 6 if row["key"] == "plaquette" else (
                        3 if row["key"] == "m_over_sqrt_sigma" else 4)
                    payload.setdefault(row["key"], {})[row["variant"]] = {
                        "A_minus_B": fmt_ve(row["diff"], row["err"], dec),
                        "sigma": row["sigma"]}
            add(f"{sec_key}.{cmp_['A']}_vs_{cmp_['B']}",
                f"{sec_key.replace('_', ' ')}: {cmp_['A']} ({cmp_['lattice_A']}) minus "
                f"{cmp_['B']} ({cmp_['lattice_B']}); sigma = difference over the quadrature "
                "sum of the statistical errors (null where one side is not a measurement).",
                f"summary.json: {sec_key}[{i}].rows", **payload)
    cnt = summary["literature_comparison"]["counts"]
    for set_name in cnt:
        c = cnt[set_name]["matched_entry_only"]
        add(f"literature.{set_name}",
            "literature pulls (one matched literature entry per ensemble and quantity): how "
            "many exceed 2 and 3 sigma. Literature values are search-excerpt or from-memory "
            "level, never checked against a published table.",
            f"summary.json: literature_comparison.counts.{set_name}.matched_entry_only",
            counts={v: {k: c[v][k] for k in ("n", "n_gt_2", "n_gt_3", "max_abs",
                                             "expected_gt_2_if_gaussian",
                                             "expected_gt_3_if_gaussian")} for v in VARIANTS},
            rows_gt_2={v: c[v]["rows_gt_2"] for v in VARIANTS})
    sig = [(n, k, recs[n]["am_over_err"][k]) for n in TABLE_ORDER for k in VARIANTS
           if recs[n]["am_over_err"][k] is not None]
    lo = min(sig, key=lambda t: t[2])
    add("quality.min_am_over_err",
        "smallest a*m/error over all ensembles and variants. This is the precision of a mass "
        "that is nonzero by construction on a finite lattice; it is NOT by itself evidence for "
        "a mass gap in the continuum.", "summary.json: ensembles.*.am_over_err",
        value=lo[2], ensemble=lo[0], variant=lo[1])
    nb = min(TABLE_ORDER, key=lambda n: recs[n]["n_bins"])
    add("quality.min_bins", "smallest number of jackknife bins",
        "summary.json: ensembles.*.n_bins", value=recs[nb]["n_bins"], ensemble=nb,
        tau_int_max=recs[nb]["tau_int_max"])
    hc = [(n, recs[n]["stream_consistency"]["hot_minus_cold_pull"]) for n in TABLE_ORDER
          if recs[n]["stream_consistency"]["hot_minus_cold_pull"] is not None]
    worst = max(hc, key=lambda t: abs(t[1]))
    add("quality.max_hot_minus_cold", "largest |hot-start minus cold-start| plaquette pull",
        "summary.json: ensembles.*.stream_consistency.hot_minus_cold_pull", value=worst[1],
        ensemble=worst[0])
    return H


# ==============================================================================================
# assembling everything
# ==============================================================================================
def clean(obj):
    """Plain python containers; NaN / inf -> None (valid JSON)."""
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
        return float(obj) if math.isfinite(float(obj)) else None
    return obj


def build_limits(summary):
    """Statements (with the numbers that support them) that restrict what may be claimed."""
    recs = summary["ensembles"]
    out = [
        "This is numerical evidence for a mass gap in a lattice model, not a proof. The "
        "Millennium problem is open; nothing here proves or solves it.",
        "On a finite lattice the transfer matrix has a discrete spectrum, so a nonzero gap at "
        "one (beta, L) is automatic and a*m/error only measures precision. The physically "
        "meaningful evidence is that m/sqrt(sigma) stays finite and stable when L grows and a "
        "shrinks; this is tested with three lattice spacings per dimension and one larger "
        "volume at one beta in D=3 and at two betas in D=4 (beta = 2.4 in round 2, beta = 2.5 "
        "in round 3), no more.",
        "All masses are variational upper estimates at small t (t = 1 or 2) with statistical "
        "errors only. Rule R5 picks t* on the same data: its error under-covers (52-65 % within "
        "1 sigma in the synthetic tests quoted in the pipeline files), so every R5 number must "
        "be read with m_eff(1) and m_eff(2) beside it.",
    ]
    rep = summary["replication"][0]
    rr = {(r["key"], r["variant"]): r for r in rep["rows"]}
    a, b = recs[rep["A"]], recs[rep["B"]]
    out.append(
        f"Replication failure at the 2-3 sigma level in D=3, beta=9: {rep['A']} minus {rep['B']} "
        f"is {rr[('am', 'R5')]['sigma']:+.1f} sigma for a*m by rule R5 (both t*=2), "
        f"{rr[('am', 't1')]['sigma']:+.1f} sigma at fixed t=1, "
        f"{rr[('m_over_sqrt_sigma', 'R5')]['sigma']:+.1f} sigma for m/sqrt(sigma) (R5) and "
        f"{rr[('plaquette', '-')]['sigma']:+.1f} sigma for the plaquette. In round 1 the "
        f"effective mass rises from t=1 to t=2 by {-a['am']['t1_minus_t2']['sigma']:.1f} sigma "
        "(m_eff(1)-m_eff(2) = "
        f"{fmt_ve(a['am']['t1_minus_t2']['value'], a['am']['t1_minus_t2']['err'], 4)}), "
        f"which a variational correlator cannot do in expectation; in the replication it falls "
        f"({fmt_ve(b['am']['t1_minus_t2']['value'], b['am']['t1_minus_t2']['err'], 4)}). "
        "Reading the pre-registered round-1 number at beta=9 as an upward fluctuation that "
        "rule R5 then selected is consistent with these numbers, but it is a post-hoc reading; "
        "the pre-registered value stays what it is and all three (round 1, replication, "
        "combined) are reported.")
    lit_rows = summary["literature_comparison"]["rows"]
    big = [r for r in lit_rows if r["matched"] and r["ensemble"] in INDEPENDENT_ALL + PRIMARY
           and r["quantity"] == "a*m(0++)" and r["D"] == 4 and num(r["pull"]["t1"]) is not None]
    if big:
        txt = "; ".join(
            f"{r['ensemble']}: m_eff(1) = "
            f"{fmt_ve(r['ours']['t1']['value'], r['ours']['t1']['err'], 4)} "
            f"({r['pull']['t1']:+.1f} sigma), m_eff(2) = "
            f"{fmt_ve(r['ours']['t2']['value'], r['ours']['t2']['err'], 4)} "
            f"({r['pull']['t2']:+.1f} sigma) vs {fmt_lit(r['lit_value'], r['lit_unc'])}"
            for r in big)
        er2 = [r["ours"]["t2"]["err"] / r["ours"]["t1"]["err"] for r in big]
        out.append("D=4 glueball masses against the literature values of literature.json "
                   "(search-excerpt level, column assignment inferred; rule R5 chose t*=1 in "
                   "every D=4 glueball channel, so R5 = m_eff(1)): " + txt + ". At beta = 2.4 "
                   "and 2.5 our values lie above the reference. Ours are variational upper "
                   "estimates from a small operator basis; m_eff(2) has errors "
                   f"{min(er2):.1f}-{max(er2):.1f} times larger and neither confirms nor "
                   "removes the excess. The tension is unresolved.")
    st = [r for r in lit_rows if r["matched"] and r["ensemble"] in INDEPENDENT_ALL + PRIMARY
          and r["quantity"] == "a*sqrt(sigma)" and num(r["pull"]["t1"]) is not None
          and (abs(r["pull"]["t1"]) > 2.0 or abs(r["pull_luscher"]["t1"]) > 2.0)]
    for r in st:
        lsig = recs[r["ensemble"]]["finite_volume_indicators"]["t1"]["L_sqrt_sigma"]
        lname = "L=" + str(r["lit_lattice_L"]) if r["lit_lattice_L"] else "not named"
        partner = ""
        for a_, b_ in VOLUME_PAIRS:
            if r["ensemble"] in (a_, b_):
                o = recs[b_ if r["ensemble"] == a_ else a_]
                partner = (f" (our other volume at this beta, {o['name']} with L = {o['L']}, "
                           f"gives {fmt_ve(o['a_sqrt_sigma']['t1']['value'], o['a_sqrt_sigma']['t1']['err'], 4)})")
        out.append(
            f"String tension, {r['ensemble']}: a*sqrt(sigma) = "
            f"{fmt_ve(r['ours']['t1']['value'], r['ours']['t1']['err'], 4)} (Nambu-Goto, t=1) "
            f"against {fmt_lit(r['lit_value'], r['lit_unc'])} [{r['verification_level']}; "
            f"lattice size {lname}]: "
            f"{r['pull']['t1']:+.1f} sigma ({r['pull_luscher']['t1']:+.1f} sigma with the "
            f"Luscher formula). The torelon of this ensemble has L*sqrt(sigma) = "
            + fmt_ve(lsig["value"], lsig["err"], 2) + partner +
            "; a short flux loop is where corrections beyond the string formulas are largest, "
            "and m/sqrt(sigma) of this ensemble inherits the shift.")
    s4 = summary["scaling_d4"]["sets"]
    for set_name in ("primary", "all_data"):
        d = s4[set_name]["R5"]["drift"][2]
        fl = s4[set_name]["R5"].get("fit_linear") or {}
        t = (f"D=4 ({set_name}, R5): m/sqrt(sigma) rises by {fmt_ve(d['diff'], d['err'], 3)} "
             f"({d['sigma']:+.1f} sigma) from beta=2.3 to 2.5")
        if fl.get("extrapolation_reported"):
            pl = (s4[set_name]["R5"].get("pulls_linear_vs_literature") or [{}])[0]
            t += (f"; a straight line in a^2 sigma is formally acceptable (chi2/dof = "
                  f"{fl['chi2']:.2f}/{fl['dof']}) with intercept "
                  f"{fmt_ve(fl['intercept'], fl['intercept_err'], 3)}, "
                  f"{pl.get('pull', float('nan')):+.1f} sigma from the literature continuum value "
                  f"{fmt_lit(pl.get('lit_value'), pl.get('lit_unc'))}; this intercept is not "
                  "a continuum limit (see scaling_d4.note)")
        out.append(t + ".")
    for set_name in ("primary", "all_data"):
        blk = summary["scaling_d3"]["sets"][set_name]
        parts = []
        for variant in ("R5", "t1"):
            fc, fl = blk[variant]["fit_constant"], blk[variant]["fit_linear"]
            pl = blk[variant]["pulls_linear_vs_literature"]
            ex = [p for p in pl if p["verification_level"] == "search_excerpt"]
            parts.append(
                f"{variant}: constant {fmt_ve(fc['value'], fc['err'], 3)} (chi2/dof "
                f"{fc['chi2']:.1f}/{fc['dof']}, p={fc['p_value']:.3f}), linear intercept "
                f"{fmt_ve(fl['intercept'], fl['intercept_err'], 3)} (chi2/dof "
                f"{fl['chi2']:.1f}/{fl['dof']}, p={fl['p_value']:.3f}), pulls of the intercept "
                "against the excerpt-level continuum values "
                + ", ".join(f"{fmt_lit(p['lit_value'], p['lit_unc'])}: {p['pull']:+.1f}"
                            for p in ex))
        out.append(f"D=3 ({set_name}) m/sqrt(sigma) over beta = 6, 9, 12 - " + "; ".join(parts)
                   + ". " + D3_LIMIT_NOTE)
    for cmp_ in summary["finite_volume"]:
        rr = {(r["key"], r["variant"]): r for r in cmp_["rows"]}
        bits = []
        for key, lab in (("am", "a*m"), ("a_sqrt_sigma", "a*sqrt(sigma)")):
            for variant in VARIANTS:
                r = rr[(key, variant)]
                bits.append(f"{lab} {variant}: " + (f"{r['sigma']:+.1f} sigma"
                                                    if r["sigma"] is not None
                                                    else "no measurement on one side"))
        er = [rr[(key, "t1")]["B"]["err"] / rr[(key, "t1")]["A"]["err"]
              for key in ("am", "a_sqrt_sigma")]
        out.append(f"Finite volume, {cmp_['A']} ({cmp_['lattice_A']}) minus {cmp_['B']} "
                   f"({cmp_['lattice_B']}): " + "; ".join(bits) + ". The larger volume has "
                   f"errors {er[0]:.1f} (a*m) and {er[1]:.1f} (a*sqrt(sigma)) "
                   "times those of the smaller volume at t=1: finite-volume effects are bounded "
                   "only at the level of these errors.")
    npl = [n for n in TABLE_ORDER if not recs[n]["a_sqrt_sigma"]["R5"]["is_measurement"]
           or not recs[n]["am"]["R5"]["is_measurement"]]
    if npl:
        out.append("No plateau (rule R5 gives an upper bound only, not a measurement): "
                   + ", ".join(npl) + " (torelon / string tension); only the fixed-t values "
                   "can be compared there.")
    fewb = [(n, recs[n]["n_bins"], recs[n]["tau_int_max"]) for n in TABLE_ORDER
            if recs[n]["n_bins"] < 200]
    if fewb:
        out.append("Few jackknife bins (errors of errors are large, about 1/sqrt(2 n_bins)): "
                   + ", ".join(f"{n}: {nb} bins, tau_int,max = {tau:.1f}" for n, nb, tau in fewb)
                   + ".")
    hc = [(n, recs[n]["stream_consistency"]["hot_minus_cold_pull"]) for n in TABLE_ORDER
          if recs[n]["stream_consistency"]["hot_minus_cold_pull"] is not None
          and abs(recs[n]["stream_consistency"]["hot_minus_cold_pull"]) > 2.0]
    if hc:
        out.append("Hot-start minus cold-start plaquette beyond 2 sigma: "
                   + ", ".join(f"{n}: {p:+.1f} sigma" for n, p in hc)
                   + " (possible residual thermalisation effect or a fluctuation; not resolved).")
    out.append("Literature values are 'seen in a web-search excerpt' at best, several are "
               "quoted from memory; no published table was opened. Agreement or disagreement "
               "with them is correspondingly weak evidence.")
    out.append("D=4 is far from two-loop asymptotic scaling in this beta range (see "
               "scaling_d4.asymptotic_scaling): the lattice spacing in physical units is fixed "
               "by sqrt(sigma), not by perturbation theory.")
    return out


def build_summary(results_dir, literature_path):
    with open(literature_path, "r", encoding="utf-8") as fh:
        lit = json.load(fh)
    recs = load_results(results_dir)
    summary = {
        "format": SUMMARY_FORMAT,
        "disclaimer": DISCLAIMER,
        "generated_utc": datetime.datetime.now(datetime.timezone.utc).strftime(
            "%Y-%m-%dT%H:%M:%SZ"),
        "inputs": {"results_dir": os.path.relpath(results_dir, _HERE)
                   if os.path.abspath(results_dir).startswith(_HERE) else results_dir,
                   "pipeline_files": [f"{n}.json" for n in TABLE_ORDER],
                   "literature": os.path.basename(literature_path),
                   "literature_compiled_on": (lit.get("_meta") or {}).get("compiled_on")},
        "conventions": {
            "variants": {"R5": "pre-registered plateau rule (t* chosen on the same data; error "
                               "under-covers)",
                         "t1": "fixed t = 1 (no selection)", "t2": "fixed t = 2 (no selection)"},
            "string_tension": "Nambu-Goto formula unless a key says 'luscher'",
            "errors": "statistical only; correlated jackknife within an ensemble where the "
                      "pipeline file has it, otherwise 'uncorrelated propagation' (marked); "
                      "quadrature between ensembles",
            "pull": "(ours - reference)/sqrt(err_ours^2 + err_ref^2)",
            "fits": "weighted least squares, parameter errors not rescaled by sqrt(chi2/dof)",
        },
        "sets": {"primary": PRIMARY, "independent_all_data": INDEPENDENT_ALL,
                 "scaling": {f"D{D}": s for D, s in SCALING_SETS.items()}},
        "table_order": TABLE_ORDER,
        "ensembles": recs,
        "ratio_error_check": {
            "note": "R5 ratio m/sqrt(sigma): correlated jackknife error of the pipeline file "
                    "divided by the error obtained by treating glueball and torelon as "
                    "uncorrelated. Values near 1 justify the uncorrelated propagation used for "
                    "the fixed-t ratios that the pipeline files do not contain.",
            "per_ensemble": {n: recs[n]["ratio_error_check"] for n in TABLE_ORDER}},
        "scaling_d3": scaling_d3(recs, lit),
        "scaling_d4": scaling_d4(recs, lit),
        "finite_volume": [compare_pair(recs[a], recs[b], "finite volume")
                          for a, b in VOLUME_PAIRS],
        "replication": [compare_pair(recs[a], recs[b], "replication")
                        for a, b in REPLICATION_PAIRS],
        "round3": round3_block(recs),
        "literature_comparison": literature_comparison(recs, lit),
    }
    vals = [v["correlated_over_uncorrelated"]
            for v in summary["ratio_error_check"]["per_ensemble"].values()
            if v["correlated_over_uncorrelated"] is not None]
    summary["ratio_error_check"]["min"] = min(vals) if vals else None
    summary["ratio_error_check"]["max"] = max(vals) if vals else None
    crows = continuum_rows(summary["scaling_d3"], summary["scaling_d4"])
    lc = summary["literature_comparison"]
    lc["continuum_rows"] = crows
    lc["continuum_counts"] = {
        "note": "pulls of our extrapolated values (fits with p >= ACCEPT_P only) against "
                "search-excerpt-level literature continuum values. The rows share data (same "
                "points, different fits and reference values), so the counts are NOT counts "
                "of independent comparisons.",
        "by_quantity": {
            f"D{D} {q}": {
                set_name: {v: count_pulls([r["pull"] for r in crows if r["D"] == D
                                           and r["quantity"] == q and r["set"] == set_name
                                           and r["variant"] == v and r["acceptable"]
                                           and r["verification_level"] == "search_excerpt"])
                           for v in VARIANTS}
                for set_name in ("primary", "all_data")}
            for D, q in sorted({(r["D"], r["quantity"]) for r in crows})}}
    summary["headline"] = build_headline(summary)
    summary["limits"] = build_limits(summary)
    return clean(summary)


# ==============================================================================================
# markdown (Dutch, plain tables)
# ==============================================================================================
def md_table(headers, rows):
    lines = ["| " + " | ".join(headers) + " |", "|" + "|".join(" --- " for _ in headers) + "|"]
    for r in rows:
        lines.append("| " + " | ".join(str(c) for c in r) + " |")
    return "\n".join(lines)


def _sg(x, nd=1):
    return "n.v.t." if num(x) is None else f"{x:+.{nd}f}"


def _fx(x, nd=2):
    return "n.v.t." if num(x) is None else f"{x:.{nd}f}"


def _cell(b, decimals, star=False):
    """value(err) with markers: '‡' not a measurement, '*' uncorrelated error propagation."""
    s = fmt_ve(b.get("value"), b.get("err"), decimals)
    if b.get("is_measurement") is False:
        s += " ‡"
    if star and b.get("err_kind") == "uncorrelated propagation":
        s += " *"
    return s


LEVEL_NL = {"search_excerpt": "zoekfragment", "none": "geheugen (ongeverifieerd)",
            "derived from search_excerpt entries": "afgeleid uit zoekfragmenten"}


def _ts(t):
    """t* for a table cell ('—' when rule R5 found no plateau)."""
    return "—" if t is None else str(t)


def _src_nl(label):
    return "geen bron aangewezen" if label == "no source identified" else label


def _ja(flag):
    return "ja" if flag else "nee"


def _range_sentence(blk):
    """One plain sentence: how much m/sqrt(sigma) moves while the lattice spacing changes."""
    parts = []
    for v in VARIANTS:
        rg = blk[v].get("range")
        if not rg:
            continue
        parts.append(f"{v}: {rg['spread_percent_of_mean']:.1f} % "
                     f"({_sg(rg['max_minus_min']['sigma'])}σ)")
    rg = blk["R5"].get("range") or blk["t1"].get("range")
    return ("Verschil tussen de grootste en de kleinste m/√σ over de drie β, als percentage van "
            "het gemiddelde (en in σ): " + "; ".join(parts) + ". De roosterafstand verandert daarbij een factor "
            f"{fmt_ve(rg['lattice_spacing_factor']['value'], rg['lattice_spacing_factor']['err'], 2)}"
            f" (a² een factor {rg['a2_factor']:.1f}), gemeten met a√σ.")


def render_markdown(S):
    recs = S["ensembles"]
    order = S["table_order"]
    L = []
    A = L.append
    A(f"# Samenvatting over alle ensembles — {TAGLINE_NL}")
    A("")
    A("Gegenereerd door `python3 summarize.py` uit `results/<ensemble>.json` (uitvoer van "
      "`analyze.py`, niet gewijzigd) en `literature.json`. Machineleesbaar: `results/summary.json`. "
      f"Tijdstip: {S['generated_utc']}.")
    A("")
    A("**Wat dit is — en wat niet.** Monte-Carlo-resultaten voor zuivere SU(2)-roosterijktheorie "
      "(Wilson-actie) bij eindige roosterafstand en eindig volume, met alleen statistische "
      "fouten; de massa's zijn variationele bovengrens-schattingen. Dit is **numeriek "
      "bewijsmateriaal** voor een massakloof in het roostermodel, **geen bewijs**: het "
      "millenniumprobleem is open en wordt hier niet opgelost.")
    A("")
    A("## 0. Leeswijzer")
    A("")
    A("- **R5** = de vooraf vastgelegde plateauregel (m_eff(t\\*), t\\* gekozen met dezelfde data; "
      "de fout dekt daardoor te weinig: 52–65 % binnen 1σ in de synthetische tests). "
      "**t=1**, **t=2** = effectieve massa bij vaste t (geen selectie). Lees ze altijd naast elkaar.")
    A("- Notatie 1.1959(77) = 1.1959 ± 0.0077. Alle fouten zijn statistisch (jackknife). "
      "Er is geen systematisch foutenbudget verzonnen; waar een systematiek zichtbaar is, staat het "
      "verschil zelf in de tabel.")
    A("- a√σ uit de torelon met de Nambu–Goto-formule; verschil met de Lüscher-formule apart vermeld.")
    A("- ‡ = geen meting (R5: \"no plateau\", alleen een bovengrens). "
      "\\* = fout van een verhouding berekend alsof glueball en torelon ongecorreleerd zijn "
      "(de pijplijnbestanden bevatten voor die combinatie geen gecorreleerde fout). Controle bij "
      "de R5-verhoudingen, waar beide bestaan: gecorreleerde fout / ongecorreleerde fout ligt "
      f"tussen {_fx(S['ratio_error_check']['min'])} en {_fx(S['ratio_error_check']['max'])}.")
    A("- \"σ\" bij een verschil = verschil gedeeld door de kwadratisch opgetelde statistische "
      "fouten (onafhankelijke ensembles).")
    A("- Ronde 1 = de zes vooraf vastgelegde ensembles. Ronde 2 is na een eerste blik op ronde 1 "
      "besloten; het doel van elke run is vóór het draaien vastgelegd in `run_extra_production.sh`. "
      "Ronde 3 (d4_b2.5_L20) is na de natuurkundige controle besloten; doel, voorspellingen en "
      "criterium staan vooraf in `run_round3_production.sh`, het analyseplan in `round3_plan.md`.")
    A("")

    # ------------------------------------------------------------------ 1
    A("## 1. Tabel per ensemble")
    A("")
    A("### 1a. Glueballmassa a·m (0++)")
    A("")
    rows = []
    for n in order:
        r = recs[n]
        m = r["am"]
        rows.append([n, r["D"], f"{r['beta']:g}", r["lattice"], r["round"], r["n_meas"],
                     f"{_cell(m['R5'], 4)} [{_ts(m['R5']['t_star'])}]", _cell(m["t1"], 4),
                     _cell(m["t2"], 4),
                     f"{fmt_ve(m['t1_minus_t2']['value'], m['t1_minus_t2']['err'], 4)} "
                     f"({_sg(m['t1_minus_t2']['sigma'])}σ)",
                     " / ".join(_fx(r["am_over_err"][k], 0) for k in VARIANTS)])
    A(md_table(["ensemble", "D", "β", "rooster", "ronde", "metingen", "a·m R5 [t\\*]", "a·m t=1",
                "a·m t=2", "m(1)−m(2)", "a·m/fout (R5 / t1 / t2)"], rows))
    A("")
    A("a·m/fout is de precisie waarmee de massa van nul verschilt. Op een eindig rooster is het "
      "spectrum discreet en is een kloof ≠ 0 bij één (β, L) vanzelfsprekend; bovendien is m_eff per "
      "definitie positief. Deze kolom is dus geen bewijsmateriaal voor een kloof in het continuüm.")
    A("")
    A("### 1b. Torelon en snaarspanning")
    A("")
    rows = []
    for n in order:
        r = recs[n]
        e, s = r["aE_torelon"], r["a_sqrt_sigma"]
        rows.append([n, r["L"], f"{_cell(e['R5'], 4)} [{_ts(e['R5']['t_star'])}]",
                     _cell(e["t1"], 4),
                     _cell(e["t2"], 4), _cell(s["R5"], 4), _cell(s["t1"], 4), _cell(s["t2"], 4),
                     "n.v.t." if r["ng_minus_luscher"]["t1"] is None
                     else f"{r['ng_minus_luscher']['t1']:+.4f}"])
    A(md_table(["ensemble", "L", "a·E R5 [t\\*]", "a·E t=1", "a·E t=2", "a√σ R5", "a√σ t=1",
                "a√σ t=2", "NG − Lüscher (t=1)"], rows))
    A("")
    A("### 1c. Verhouding m/√σ en volume-indicatoren")
    A("")
    rows = []
    for n in order:
        r = recs[n]
        q = r["m_over_sqrt_sigma"]
        k = "R5" if r["finite_volume_indicators"]["R5"]["is_measurement"] else "t1"
        fv = r["finite_volume_indicators"][k]
        mark = "" if k == "R5" else " (t1)"
        rows.append([n, _cell(q["R5"], 3, True), _cell(q["t1"], 3, True), _cell(q["t2"], 3, True),
                     fmt_ve(fv["L_sqrt_sigma"]["value"], fv["L_sqrt_sigma"]["err"], 2) + mark,
                     fmt_ve(fv["mL"]["value"], fv["mL"]["err"], 1) + mark,
                     fmt_ve(fv["mT"]["value"], fv["mT"]["err"], 1) + mark,
                     fmt_ve(fv["two_torelon_over_m"]["value"], fv["two_torelon_over_m"]["err"], 2)
                     + mark,
                     _fx(r["ratio_error_check"]["correlated_over_uncorrelated"])])
    A(md_table(["ensemble", "m/√σ R5", "m/√σ t=1", "m/√σ t=2", "L√σ", "m·L", "m·T",
                "2E_torelon/m", "fout m/√σ (R5): gecorr. / ongecorr."], rows))
    A("")
    A("L√σ en m·L: ruimtelijke afmeting in fysische eenheden; m·T: tijdsafmeting in eenheden 1/m; "
      "2E_torelon/m: energie van een torelonpaar gedeeld door de glueballmassa (dicht bij 1 "
      "betekent dat het 0++-kanaal bij dit volume met torelonparen kan mengen). Berekend met de "
      "R5-waarden, of met t=1 waar R5 geen meting is. Laatste kolom: de gecorreleerde "
      "jackknife-fout van de R5-verhouding uit het pijplijnbestand gedeeld door de fout bij "
      "ongecorreleerde voortplanting; dit ijkt de met \\* gemerkte fouten (kleiner dan 1 betekent "
      "dat een \\*-fout iets te groot is).")
    A("")
    A("### 1d. Statistische kwaliteit")
    A("")
    rows = []
    for n in order:
        r = recs[n]
        sc, bc = r["stream_consistency"], r["binning_check"]
        rows.append([n, r["n_bins"], r["binsize"], _fx(r["tau_int_max"], 1),
                     _sg(sc["hot_minus_cold_pull"]),
                     f"{_fx(sc['plaquette_chi2'], 1)}/{sc['plaquette_dof']}",
                     fmt_ve(r["plaquette"]["value"], r["plaquette"]["err"], 6),
                     f"{_sg(bc['am_shift_in_sigma'], 2)}σ, fout ×{_fx(bc['am_err_ratio'])}"
                     + ("" if bc["same_t_star"] else " (andere t\\*)")])
    A(md_table(["ensemble", "bins", "bingrootte", "τ_int,max", "warm−koud (σ)",
                "χ²/dof stromen", "plaquette", "bins ×2: Δ(a·m R5)"], rows))
    A("")

    # ------------------------------------------------------------------ 2
    d3 = S["scaling_d3"]
    A("## 2. Schaalgedrag in D = 3 (β = 6, 9, 12)")
    A("")
    A("**Voorbehoud.** Drie roosterafstanden en een variationele systematiek (bovengrens-"
      "schattingen bij kleine t; die zit niet in de fouten) vormen geen gecontroleerde "
      "continuümlimiet. De snijpunten hieronder beschrijven deze drie punten en zijn alleen "
      "indicatief.")
    A("")
    A("### 2a. m/√σ tegen a²σ")
    A("")
    for set_name, title in (("primary", "primair: alleen ronde 1 (d3_b6.0_L16, d3_b9.0_L24, d3_b12.0_L32)"),
                            ("all_data", "alle data: d3_b9.0_L24_combined in plaats van d3_b9.0_L24")):
        A(f"**{title}**")
        A("")
        blk = d3["sets"][set_name]
        rows = []
        for v in VARIANTS:
            p = blk[v]["points"]
            rows.append([v] + [f"{fmt_ve(q['y'], q['y_err'], 3)}"
                               + (" *" if q["err_kind"] == "uncorrelated propagation" else "")
                               + f" @ {q['x']:.4f}" for q in p])
        A(md_table(["variant", "β=6: m/√σ @ a²σ", "β=9", "β=12"], rows))
        A("")
        A(_range_sentence(blk))
        A("")
        rows = []
        for v in VARIANTS:
            b = blk[v]
            fc, fl = b["fit_constant"], b["fit_linear"]
            pc = {p["lit_role"]: p for p in b["pulls_constant_vs_literature"]}
            pl = {p["lit_role"]: p for p in b["pulls_linear_vs_literature"]}
            rows.append([v, "constante", fmt_ve(fc["value"], fc["err"], 3), "—",
                         f"{fc['chi2']:.2f}/{fc['dof']}", f"{fc['p_value']:.3f}",
                         _ja(fc["acceptable"])] + [_sg(pc[k]["pull"]) for k in pc])
            rows.append([v, "lineair in a²σ", fmt_ve(fl["intercept"], fl["intercept_err"], 3),
                         fmt_ve(fl["slope"], fl["slope_err"], 2),
                         f"{fl['chi2']:.2f}/{fl['dof']}", f"{fl['p_value']:.3f}",
                         _ja(fl["acceptable"])] + [_sg(pl[k]["pull"]) for k in pl])
        lit_heads = [f"pull t.o.v. {fmt_lit(e['value'], e['unc'])} "
                     f"[{LEVEL_NL.get(e['verification_level'])}]"
                     for e in d3["literature"]["continuum_m0pp_over_sqrt_sigma"]]
        A(md_table(["variant", "fit", "waarde bij a → 0", "helling", "χ²/dof", "p",
                    f"p ≥ {ACCEPT_P}?"] + lit_heads, rows))
        A("")
    xe = max(d3["sets"][s][v]["fit_linear"]["max_slope_times_xerr_over_yerr"]
             for s in ("primary", "all_data") for v in VARIANTS)
    A("Fouten van de fitparameters zijn niet opgeschaald met √(χ²/dof). De fout van a²σ is "
      f"verwaarloosd: |helling|·fout(x) is hoogstens {xe:.2f} keer de fout van het punt zelf. "
      "Een pull van een snijpunt uit een fit met p < 0.05 heeft geen statistische betekenis; hij "
      "staat er alleen om de grootte van het verschil te tonen. De pulls in één tabel delen "
      "dezelfde data en zijn dus niet onafhankelijk.")
    A("")
    A("### 2b. √σ/g² = β·a√σ/4 tegen 1/β")
    A("")
    ls = d3["literature"]["continuum_sqrt_sigma_over_g2"]
    A(f"Literatuur (continuüm): {fmt_lit(ls['value'], ls['unc'])} "
      f"[{LEVEL_NL.get(ls['verification_level'])}, {ls['source_short']}]. Die waarde is met meer "
      "β-waarden en (uit het geheugen geciteerd) een verbeterde koppeling geëxtrapoleerd; een "
      "naïeve driepuntsextrapolatie in de kale 1/β is niet dezelfde procedure, dus een verschil "
      "toetst evenzeer de ansatz als de data.")
    A("")
    rows = []
    for set_name, lab in (("primary", "primair"), ("all_data", "alle data")):
        for v in VARIANTS:
            b = d3["sqrt_sigma_over_g2"][set_name][v]
            p = b["points"]
            fl, fq, fi = (b["fit_linear_in_1_over_beta"], b["fit_quadratic_in_1_over_beta"],
                          b["fit_linear_improved_coupling"])
            rows.append([lab, v] + [fmt_ve(q["y"], q["y_err"], 4) for q in p]
                        + [fmt_ve(fl["intercept"], fl["intercept_err"], 4),
                           f"{fl['chi2']:.2f}/{fl['dof']}", f"{fl['p_value']:.3f}",
                           _sg(b["pull_linear_vs_literature"]),
                           fmt_ve(fq["intercept"], fq["intercept_err"], 4),
                           _sg(b["pull_quadratic_vs_literature"]),
                           fmt_ve(fi["intercept"], fi["intercept_err"], 4),
                           f"{fi['chi2']:.2f}/{fi['dof']}", _sg(b["pull_improved_vs_literature"])])
    A(md_table(["set", "variant", "β=6", "β=9", "β=12", "lineair → 1/β=0", "χ²/dof", "p",
                "pull lit.", "kwadratisch (0 dof)", "pull lit.", "lineair in 1/β_I (β_I = β·plaq)",
                "χ²/dof", "pull lit."], rows))
    A("")
    A("De kolommen laten vooral zien hoe sterk het snijpunt van de ansatz afhangt. Dat de "
      "gepubliceerde waarde met β_I is verkregen, staat in `literature.json` als \"uit het "
      "geheugen\" en is niet geverifieerd.")
    A("")
    A("### 2c. m/g² = β·a·m/4 tegen 1/β")
    A("")
    mref = d3["m_over_g2_reference"]
    A(f"Afgeleide referentie (geen literatuurwaarde op zich): {fmt_ve(mref['value'], mref['err'], 3)} "
      "= product van twee continuümwaarden uit zoekfragmenten, fouten kwadratisch opgeteld.")
    A("")
    rows = []
    for set_name, lab in (("primary", "primair"), ("all_data", "alle data")):
        for v in VARIANTS:
            b = d3["m_over_g2"][set_name][v]
            fl = b["fit_linear_in_1_over_beta"]
            rows.append([lab, v] + [fmt_ve(q["y"], q["y_err"], 3) for q in b["points"]]
                        + [fmt_ve(fl["intercept"], fl["intercept_err"], 3),
                           f"{fl['chi2']:.2f}/{fl['dof']}", f"{fl['p_value']:.3f}",
                           _sg(b["pull_linear_vs_derived_reference"])])
    A(md_table(["set", "variant", "β=6", "β=9", "β=12", "lineair → 1/β=0", "χ²/dof", "p",
                "pull afgeleide ref."], rows))
    A("")

    # ------------------------------------------------------------------ 3
    d4 = S["scaling_d4"]
    A("## 3. Schaalgedrag in D = 4 (β = 2.3, 2.4, 2.5)")
    A("")
    A("**Geen gecontroleerde continuümlimiet.** Drie punten; m/√σ loopt monotoon op met β in "
      "plaats van af te vlakken; de glueballmassa's zijn bovengrens-schattingen bij t = 1 met een "
      "kleine operatorbasis, en t = 1 is bij grotere β een kortere fysische tijd, zodat "
      "verontreiniging door aangeslagen toestanden naar a → 0 kan toenemen en door een fit in a²σ "
      "niet van een roosterartefact te onderscheiden is; de drie ensembles hebben verschillende "
      "fysische volumes. Een extrapolatie wordt alleen afgedrukt als de fit statistisch "
      f"aanvaardbaar is (p ≥ {d4['accept_p']}), en ook dan is het getal niet te vertrouwen.")
    A("")
    A("### 3a. m/√σ tegen a²σ")
    A("")
    for set_name, title in (("primary", "primair: alleen ronde 1 (d4_b2.3_L10, d4_b2.4_L12, d4_b2.5_L16)"),
                            ("all_data", "alle data: d4_b2.5_L16_combined in plaats van d4_b2.5_L16")):
        A(f"**{title}**")
        A("")
        blk = d4["sets"][set_name]
        rows = []
        for v in VARIANTS:
            b = blk[v]
            p = b["points"]
            fc, fl = b["fit_constant"], b["fit_linear"]
            dr = b["drift"][2]
            if fl["extrapolation_reported"]:
                pls = b.get("pulls_linear_vs_literature") or []
                ext = (fmt_ve(fl["intercept"], fl["intercept_err"], 3) + " (niet te vertrouwen; "
                       "pull t.o.v. " + ", ".join(
                           f"{fmt_lit(q['lit_value'], q['lit_unc'])}: {_sg(q['pull'])}" for q in pls)
                       + ")")
            else:
                ext = "niet gegeven (fit niet aanvaardbaar)"
            rows.append([v] + [f"{fmt_ve(q['y'], q['y_err'], 3)}"
                               + (" *" if q["err_kind"] == "uncorrelated propagation" else "")
                               + f" @ {q['x']:.4f}" for q in p]
                        + [f"{fmt_ve(dr['diff'], dr['err'], 3)} ({_sg(dr['sigma'])}σ)",
                           f"{fc['chi2']:.1f}/{fc['dof']} (p={fc['p_value']:.1e})",
                           f"{fl['chi2']:.2f}/{fl['dof']} (p={fl['p_value']:.2f})", ext])
        A(md_table(["variant", "β=2.3: m/√σ @ a²σ", "β=2.4", "β=2.5", "Δ(2.3→2.5)",
                    "constante: χ²/dof", "lineair: χ²/dof", "lineair, a → 0"], rows))
        A("")
        A(_range_sentence(blk))
        A("")
        A("L√σ van de drie ensembles (R5): " + ", ".join(
            fmt_ve(q["L_sqrt_sigma"], q["L_sqrt_sigma_err"], 2) for q in blk["R5"]["points"])
          + ".")
        A("")
    lc = d4["literature"]["continuum_m0pp_over_sqrt_sigma"]
    A("Literatuur (continuüm): " + "; ".join(
        f"{fmt_lit(e['value'], e['unc'])} [{LEVEL_NL.get(e['verification_level'])}, "
        f"{e['source_short']}]" for e in lc) + ".")
    A("")
    A("### 3b. Afstand tot asymptotische schaling (twee-lus-formule)")
    A("")
    A("a·Λ_L = (6π²β/11)^(51/121)·exp(−3π²β/11) (`ym/exact.py: a_lambda_two_loop`). Bij "
      "asymptotische schaling zouden m/Λ_L en √σ/Λ_L niet van β afhangen.")
    A("")
    rows = []
    for set_name, lab in (("primary", "primair"), ("all_data", "alle data")):
        for v in VARIANTS:
            ab = d4["asymptotic_scaling"]["sets"][set_name][v]
            r_ = ab["rows"]
            cs, cm = ab.get("sqrt_sigma_over_lambda_constancy"), ab.get("m_over_lambda_constancy")
            rows.append([lab, v]
                        + [fmt_ve(q["sqrt_sigma_over_lambda"]["value"],
                                  q["sqrt_sigma_over_lambda"]["err"], 1) for q in r_]
                        + [f"{cs['percent_change_first_to_last']:+.1f}({cs['percent_change_err']:.1f}) %, "
                           f"χ²={cs['chi2']:.0f}/{cs['dof']}"]
                        + [fmt_ve(q["m_over_lambda"]["value"], q["m_over_lambda"]["err"], 1)
                           for q in r_]
                        + [f"{cm['percent_change_first_to_last']:+.1f}({cm['percent_change_err']:.1f}) %, "
                           f"χ²={cm['chi2']:.1f}/{cm['dof']}"])
    A(md_table(["set", "variant", "√σ/Λ_L β=2.3", "β=2.4", "β=2.5", "verandering 2.3→2.5",
                "m/Λ_L β=2.3", "β=2.4", "β=2.5", "verandering 2.3→2.5"], rows))
    A("")
    rows = []
    for set_name, lab in (("primary", "primair"), ("all_data", "alle data")):
        for v in VARIANTS:
            ab = d4["asymptotic_scaling"]["sets"][set_name][v]
            for q in ab["lattice_spacing_ratios"]:
                s, g = q["from_sqrt_sigma"], q["from_glueball_mass"]
                rows.append([lab, v, f"a({q['betas'][0]:g})/a({q['betas'][1]:g})",
                             f"{q['two_loop']:.4f}", fmt_ve(s["value"], s["err"], 3),
                             f"{_sg(s['percent_above_two_loop'])} % ({_sg(s['sigma_from_two_loop'])}σ)",
                             fmt_ve(g["value"], g["err"], 3),
                             f"{_sg(g['percent_above_two_loop'])} % ({_sg(g['sigma_from_two_loop'])}σ)"])
    A(md_table(["set", "variant", "verhouding", "twee-lus", "uit √σ", "afwijking", "uit a·m",
                "afwijking"], rows))
    A("")

    # ------------------------------------------------------------------ 4, 5
    for key, title, intro in (
            ("finite_volume", "## 4. Eindig volume",
             "Verschil klein rooster − groot rooster bij dezelfde β: één vergelijking in D = 3 en "
             "twee in D = 4 (β = 2.4 uit ronde 2, β = 2.5 uit ronde 3). Het grotere rooster "
             "heeft meestal grotere fouten: volume-effecten zijn alleen op het niveau van deze "
             "fouten begrensd."),
            ("replication", "## 5. Replicatie",
             "Verschil ronde 1 − nieuwe seeds, zelfde β en rooster.")):
        A(title)
        A("")
        A(intro)
        A("")
        for cmp_ in S[key]:
            A(f"**{cmp_['A']} ({cmp_['lattice_A']}) − {cmp_['B']} ({cmp_['lattice_B']}), "
              f"D = {cmp_['D']}, β = {cmp_['beta']:g}**")
            A("")
            rows = []
            for r in cmp_["rows"]:
                dec = 6 if r["key"] == "plaquette" else (3 if r["key"] == "m_over_sqrt_sigma" else 4)
                ts = ""
                if r["variant"] == "R5":
                    ts = f" [t: {r.get('t_A')} / {r.get('t_B')}]"
                rows.append([r["quantity"], r["variant"] + ts,
                             fmt_ve(r["A"]["value"], r["A"]["err"], dec),
                             fmt_ve(r["B"]["value"], r["B"]["err"], dec),
                             fmt_ve(r["diff"], r["err"], dec),
                             (_sg(r["sigma"], 2) + "σ") if r["sigma"] is not None
                             else "‡ geen meting aan één kant"])
            A(md_table(["grootheid", "variant", "A", "B", "A − B", "significantie"], rows))
            A("")

    # ------------------------------------------------------------------ 5b (round 3)
    r3 = S["round3"]
    A("## 5b. Ronde 3: volumecontrole bij β = 2.5 (vooraf vastgelegd criterium)")
    A("")
    A(f"Vergelijking van {r3['ensemble']} (L = {r3['L']}) met {r3['reference']} "
      f"(L = {r3['L_reference']}). Lezing A (zuivere eindige-doos-kloof, m ∝ 1/L) voorspelt "
      f"a·m(L = {r3['L']}) = a·m(L = {r3['L_reference']}) × {r3['L_reference']}/{r3['L']}; lezing B "
      "(volume-onafhankelijke kloof) voorspelt dezelfde waarde als op het kleine rooster. "
      f"Criterium (`run_round3_production.sh`, vóór de run vastgelegd): lezing A is uitgesloten "
      f"als m_eff(1) meer dan {r3['criterion_sigma']:g}σ boven haar voorspelling ligt; de waarde "
      f"op L = {r3['L_reference']} heet door het volume vertekend als m_eff(1) meer dan "
      f"{r3['criterion_sigma']:g}σ eronder ligt. Alleen t = 1 telt voor het oordeel; t = 2 en R5 "
      "staan ernaast.")
    A("")
    rows = []
    vlab = {"t1": "t = 1 (primair)", "t2": "t = 2", "R5": "R5"}
    for v in ("t1", "t2", "R5"):
        b = r3.get(v)
        if not b:
            rows.append([vlab[v]] + ["n/a"] * 7)
            continue
        rows.append([
            vlab[v],
            fmt_ve(b["reference"]["value"], b["reference"]["err"], 4),
            fmt_ve(b["reading_A_prediction"]["value"], b["reading_A_prediction"]["err"], 4),
            fmt_ve(b["measured"]["value"], b["measured"]["err"], 4),
            _sg(b["measured_minus_A"]["sigma"], 1) + "σ",
            _sg(b["measured_minus_reference"]["sigma"], 1) + "σ",
            fmt_ve(b["amL_reference"]["value"], b["amL_reference"]["err"], 2) + " / "
            + fmt_ve(b["amL_measured"]["value"], b["amL_measured"]["err"], 2),
            fmt_ve(b["exponent_q"]["value"], b["exponent_q"]["err"], 2)])
    A(md_table(["variant", f"a·m, L = {r3['L_reference']}", "voorspelling lezing A",
                f"a·m gemeten, L = {r3['L']}", "gemeten − A", "gemeten − klein rooster",
                f"a·m·L (L = {r3['L_reference']} / L = {r3['L']})", "exponent q in m ∝ L^−q"], rows))
    A("")
    vd = r3["verdict"]
    A(f"**Oordeel volgens het criterium (t = 1):** lezing A (m ∝ 1/L) is bij β = 2.5 "
      f"**{'uitgesloten' if vd['reading_A_excluded'] else 'niet uitgesloten'}**; de waarde op "
      f"L = {r3['L_reference']} is **{'wel' if vd['reference_volume_contaminated'] else 'niet'}** "
      "als door het volume vertekend aangemerkt. q = 1 is een zuivere eindige-doos-kloof, q = 0 "
      "een volume-onafhankelijke kloof. Dit zegt iets over twee doosgroottes bij één "
      "roosterafstand, niet over de continuümlimiet.")
    A("")
    lv = r3["largest_volume_set"]
    A("**Grootste volume per β in D = 4** (" + ", ".join(lv["ensembles"]) + "; analyseplan "
      "`round3_plan.md`, punt 4). Deze set staat naast de vooraf vastgelegde primaire set van "
      "sectie 3, niet in plaats daarvan; uit geen van beide volgt een continuümwaarde.")
    A("")
    rows = []
    for v, lab in (("t1", "t = 1"), ("R5", "R5")):
        pts, fit = lv[v]["points"], lv[v]["fit_constant"]
        rows.append([lab] + [fmt_ve(q["y"], q["y_err"], 3) + ("" if q["is_measurement"] else " ‡")
                             for q in pts]
                    + [" / ".join(fmt_ve(q["L_sqrt_sigma"], q["L_sqrt_sigma_err"], 2) for q in pts),
                       (fmt_ve(fit["value"], fit["err"], 3) + f", χ² = {fit['chi2']:.1f} bij "
                        f"{fit['dof']} (p = {fit['p_value']:.3f})") if fit else "n/a"])
    A(md_table(["variant"] + [f"m/√σ, β = {q['beta']:g} ({q['lattice']})" for q in lv["t1"]["points"]]
               + ["L√σ per rooster", "constante door de drie punten"], rows))
    A("")

    # ------------------------------------------------------------------ 6
    lc = S["literature_comparison"]
    A("## 6. Vergelijking met literatuurwaarden")
    A("")
    A("Betrouwbaarheid van de literatuurgetallen: \"zoekfragment\" = gezien in een fragment van "
      "een webzoekresultaat, nooit in de volledige tekst; \"geheugen\" = ongeverifieerde "
      "herinnering. Geen enkel getal is tegen een gepubliceerde tabel gecontroleerd. "
      "Pull = (wij − literatuur)/√(fout² + onzekerheid²). \"gekozen\" = de literatuurwaarde met "
      "hetzelfde ruimtelijke rooster als die er is, anders de hoofdwaarde (één per ensemble en "
      "grootheid).")
    A("")
    rows = []
    for r in lc["rows"]:
        dec = 6 if r["quantity"] == "plaquette" else 4
        lus = ""
        if "pull_luscher" in r:
            lus = " / ".join(_sg(r["pull_luscher"][k]) for k in VARIANTS)
        rows.append([r["ensemble"], r["quantity"], fmt_lit(r["lit_value"], r["lit_unc"]),
                     LEVEL_NL.get(r["verification_level"], r["verification_level"]),
                     _src_nl(r["source_short"])
                     + (f", L={r['lit_lattice_L']}" if r["lit_lattice_L"] else ""),
                     "ja" if r["matched"] else "",
                     _cell(r["ours"]["R5"], dec), _sg(r["pull"]["R5"]),
                     _cell(r["ours"]["t1"], dec), _sg(r["pull"]["t1"]),
                     _cell(r["ours"]["t2"], dec), _sg(r["pull"]["t2"]), lus])
    A(md_table(["ensemble", "grootheid", "literatuur", "niveau", "bron", "gekozen", "wij R5",
                "pull R5", "wij t=1", "pull t=1", "wij t=2", "pull t=2",
                "pull met Lüscher-formule (R5 / t1 / t2)"], rows))
    A("")
    A("De literatuurwaarden van a√σ zijn (volgens `literature.json`, uit het geheugen) met de "
      "Lüscher-correctie bepaald; de laatste kolom is daarom de meest gelijksoortige vergelijking "
      "voor de snaarspanning.")
    A("")
    A("### 6a. Aantallen")
    A("")
    rows = []
    names_nl = {"primary_ensembles": "primair (6 ensembles van ronde 1)",
                "independent_all_data": f"alle data ({len(INDEPENDENT_ALL)} onafhankelijke ensembles)"}
    which_nl = {"matched_entry_only": "gekozen waarde",
                "all_entries_including_alternatives": "alle waarden incl. alternatieven",
                "matched_entry_only_luscher_string_tension": "alleen a√σ, Lüscher-formule, gekozen waarde"}
    for set_name in lc["counts"]:
        for which in which_nl:
            for v in VARIANTS:
                c = lc["counts"][set_name][which][v]
                rows.append([names_nl[set_name], which_nl[which], v, c["n"], c["n_gt_2"],
                             c["n_gt_3"], _fx(c["max_abs"]),
                             f"{c['expected_gt_2_if_gaussian']:.1f} / {c['expected_gt_3_if_gaussian']:.2f}"])
    A(md_table(["ensembles", "literatuurwaarden", "variant", "aantal pulls", "|pull| > 2",
                "|pull| > 3", "grootste |pull|", "verwacht (Gauss) >2 / >3"], rows))
    A("")
    rows = []
    for set_name in lc["counts"]:
        for q, blk in lc["counts"][set_name]["by_quantity_matched"].items():
            for v in VARIANTS:
                c = blk[v]
                rows.append([names_nl[set_name], q, v, c["n"], c["n_gt_2"], c["n_gt_3"],
                             _fx(c["max_abs"])])
    A(md_table(["ensembles", "grootheid (gekozen waarde)", "variant", "aantal", "> 2", "> 3",
                "grootste |pull|"], rows))
    A("")
    rows = []
    for set_name in lc["counts"]:
        for lvl, blk in lc["counts"][set_name]["by_verification_level_matched"].items():
            for v in VARIANTS:
                c = blk[v]
                rows.append([names_nl[set_name], LEVEL_NL.get(lvl, lvl), v, c["n"], c["n_gt_2"],
                             c["n_gt_3"], _fx(c["max_abs"])])
    A(md_table(["ensembles", "niveau van de literatuurwaarde (gekozen waarde)", "variant",
                "aantal", "> 2", "> 3", "grootste |pull|"], rows))
    A("")
    A("De verwachting bij Gauss-verdeelde, onafhankelijke pulls met juiste fouten staat in de "
      "eerste tabel. De pulls zijn niet onafhankelijk (a·m en a√σ van één ensemble; alternatieve "
      "literatuurwaarden van dezelfde grootheid) en de literatuurwaarden zijn niet geverifieerd.")
    A("")
    A("Pulls boven 2σ (gekozen waarde):")
    A("")
    seen = set()
    for set_name in lc["counts"]:
        for v in VARIANTS:
            for r in lc["counts"][set_name]["matched_entry_only"][v]["rows_gt_2"]:
                k = (r["ensemble"], r["quantity"], v)
                if k in seen:
                    continue
                seen.add(k)
                A(f"- {r['ensemble']}, {r['quantity']}, {v}: {r['pull']:+.2f}σ t.o.v. {r['lit']} "
                  f"[{LEVEL_NL.get(r['verification_level'])}]")
    if not seen:
        A("- geen")
    A("")
    A("### 6b. Afgeleide verhouding m/√σ bij eindige β (geen literatuurwaarde op zich)")
    A("")
    rows = []
    for r in lc["derived_ratio_rows"]:
        rows.append([r["ensemble"], fmt_ve(r["lit_value"], r["lit_unc"], 3),
                     LEVEL_NL.get(r["verification_level"], r["verification_level"]),
                     _cell(r["ours"]["R5"], 3, True), _sg(r["pull"]["R5"]),
                     _cell(r["ours"]["t1"], 3, True), _sg(r["pull"]["t1"]),
                     _cell(r["ours"]["t2"], 3, True), _sg(r["pull"]["t2"])])
    A(md_table(["ensemble", "literatuur: a·m / a√σ", "niveau", "wij R5", "pull R5", "wij t=1",
                "pull t=1", "wij t=2", "pull t=2"], rows))
    A("")
    dc = lc["derived_ratio_counts"]
    A("Aantallen (afgeleid): " + "; ".join(
        f"{names_nl[s]}, {v}: {dc[s][v]['n_gt_2']} van {dc[s][v]['n']} boven 2σ, "
        f"{dc[s][v]['n_gt_3']} boven 3σ" for s in dc for v in VARIANTS) + ".")
    A("")
    A("### 6c. Geëxtrapoleerde waarden tegen continuümwaarden uit de literatuur")
    A("")
    A("Niet gelijksoortig: een driepuntsfit van ons tegen een gepubliceerde continuümlimiet. De "
      "rijen delen dezelfde data en zijn niet onafhankelijk. Alleen fits met p ≥ "
      f"{ACCEPT_P} zijn opgenomen; de volledige lijst staat in `summary.json` onder "
      "`literature_comparison.continuum_rows`.")
    A("")
    rows = []
    qn = {"m/sqrt(sigma), a -> 0": "m/√σ", "sqrt(sigma)/g^2, a -> 0": "√σ/g²"}
    fn = {"constant": "constante", "linear in a^2 sigma": "lineair in a²σ",
          "linear in 1/beta": "lineair in 1/β",
          "quadratic in 1/beta (0 dof)": "kwadratisch in 1/β (0 dof)",
          "linear in 1/beta_I (improved coupling)": "lineair in 1/β_I"}
    sn = {"primary": "primair", "all_data": "alle data"}
    for r in lc["continuum_rows"]:
        if not r["acceptable"] or r["verification_level"] != "search_excerpt":
            continue
        rows.append([f"D={r['D']}", qn.get(r["quantity"], r["quantity"]), sn[r["set"]],
                     r["variant"], fn.get(r["fit"], r["fit"]),
                     fmt_ve(r["value"], r["err"], 4 if "g^2" in r["quantity"] else 3),
                     f"{r['chi2']:.2f}/{r['dof']}", fmt_lit(r["lit_value"], r["lit_unc"]),
                     _sg(r["pull"])])
    A(md_table(["D", "grootheid", "set", "variant", "fit", "onze waarde bij a → 0", "χ²/dof",
                "literatuur [zoekfragment]", "pull"], rows))
    A("")
    um = lc["literature_entries_without_a_corresponding_measurement"]
    A("Literatuurwaarden zonder bijbehorende meting van ons (niet vergeleken): "
      + (", ".join(f"`{u}`" for u in um) if um else "geen") + ".")
    A("")

    # ------------------------------------------------------------------ 7
    A("## 7. Kerngetallen (`headline` in summary.json)")
    A("")
    A("Dezelfde lijst, met waarden en bronsleutels, staat in `summary.json` onder `headline`.")
    A("")
    for h in S["headline"]:
        hid = h["id"]
        if hid.startswith("ensemble."):
            def tr(d):
                return " / ".join(d[k].replace(" [no plateau: upper bound only, not a "
                                               "measurement]", " ‡") for k in VARIANTS)
            A(f"- `{hid}`: a·m = {tr(h['am'])}; a√σ = {tr(h['a_sqrt_sigma'])}; "
              f"m/√σ = {tr(h['m_over_sqrt_sigma'])}  (R5 / t=1 / t=2)")
        elif hid.startswith("d3.m_over_sqrt_sigma."):
            c, l_ = h["constant"], h["linear_intercept"]
            A(f"- `{hid}`: constante {c['text']} (χ²/dof {c['chi2']:.2f}/{c['dof']}, "
              f"p = {c['p_value']:.3f}); rechte lijn → {l_['text']} (χ²/dof "
              f"{l_['chi2']:.2f}/{l_['dof']}, p = {l_['p_value']:.3f}); pulls van het snijpunt: "
              + ", ".join(f"{q['lit']} [{LEVEL_NL.get(q['verification_level'])}]: {_sg(q['pull'])}"
                          for q in h["pulls_linear_vs_literature"]))
        elif hid.startswith("d3.sqrt_sigma_over_g2."):
            A(f"- `{hid}`: lineair in 1/β → {h['linear']['text']} (χ²/dof "
              f"{h['linear']['chi2']:.2f}/{h['linear']['dof']}, pull {_sg(h['pull_linear'])}); "
              f"kwadratisch → {h['quadratic_0_dof']} (pull {_sg(h['pull_quadratic'])}); lineair "
              f"in 1/β_I → {h['linear_improved_coupling']['text']} (pull "
              f"{_sg(h['pull_improved'])}); literatuur {h['literature']} "
              f"[{LEVEL_NL.get(h['literature_verification_level'])}]")
        elif hid.startswith("d4.m_over_sqrt_sigma."):
            l_ = h["linear_intercept"]
            A(f"- `{hid}`: {' → '.join(h['points'])}; verandering 2.3→2.5: "
              f"{h['drift_2p3_to_2p5']['text']} ({_sg(h['drift_2p3_to_2p5']['sigma'])}σ); "
              f"rechte lijn (χ²/dof {l_['chi2']:.2f}/{l_['dof']}): {l_['text']}"
              + (" — géén continuümlimiet; pulls: " + ", ".join(
                  f"{q['lit']}: {_sg(q['pull'])}" for q in h["pulls_linear_vs_literature"])
                 if l_.get("value") is not None else ""))
        elif hid.startswith("d4.asymptotic_scaling."):
            pc = h["percent_change_2p3_to_2p5"]
            A(f"- `{hid}`: √σ/Λ_L = {' → '.join(h['sqrt_sigma_over_lambda'])} "
              f"({pc['value']:+.1f}({pc['err']:.1f}) %); a-verhoudingen uit √σ t.o.v. twee-lus: "
              + ", ".join(f"{q['from_sqrt_sigma']} vs {q['two_loop']:.3f} "
                          f"({_sg(q['percent_above_two_loop'])} %)"
                          for q in h["lattice_spacing_ratios"]))
        elif hid.startswith(("finite_volume.", "replication.")):
            bits = []
            for key, lab in (("am", "a·m"), ("a_sqrt_sigma", "a√σ"), ("m_over_sqrt_sigma", "m/√σ"),
                             ("plaquette", "plaquette")):
                if key in h:
                    bits.append(lab + ": " + " / ".join(
                        f"{k} {_sg(q['sigma'], 2)}σ" if q["sigma"] is not None
                        else f"{k} geen meting" for k, q in h[key].items()))
            A(f"- `{hid}`: " + "; ".join(bits))
        elif hid.startswith("literature."):
            A(f"- `{hid}`: " + "; ".join(
                f"{v}: {c['n_gt_2']} van {c['n']} boven 2σ, {c['n_gt_3']} boven 3σ"
                for v, c in h["counts"].items()))
        else:
            A(f"- `{hid}`: {h['value']:.3g} ({h['ensemble']})")
    A("")
    A("Bronsleutel van elk getal: veld `source` van het betreffende item.")
    A("")

    # ------------------------------------------------------------------ 8
    A("## 8. Beperkingen: wat hieruit niet geclaimd mag worden")
    A("")
    A("(Engelstalig, letterlijk gelijk aan `limits` in summary.json; de getallen zijn door "
      "het script ingevuld.)")
    A("")
    for t in S["limits"]:
        A(f"- {t}")
    A("")
    A("## Figuren")
    A("")
    A(f"`summary_scaling_d3.png`, `summary_scaling_d4.png`, `summary_volume.png` — {TAGLINE_NL}.")
    A("")
    return "\n".join(L)


# ==============================================================================================
# figures
# ==============================================================================================
COL = {"R5": "#2a78d6", "t1": "#eb6834", "t2": "#1baf7a", "lit": "#52514e",
       "surface": "#fcfcfb", "text": "#0b0b0b", "text2": "#52514e", "grid": "#e6e5e0"}
MARK = {"R5": "o", "t1": "s", "t2": "D"}
VLAB = {"R5": "R5 (vooraf vastgelegde plateauregel)", "t1": "vaste t = 1", "t2": "vaste t = 2"}


def _style(ax, xlabel, ylabel, title):
    ax.set_facecolor(COL["surface"])
    ax.grid(True, color=COL["grid"], linewidth=0.8, linestyle="-")
    ax.set_axisbelow(True)
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    for s in ("left", "bottom"):
        ax.spines[s].set_color(COL["text2"])
        ax.spines[s].set_linewidth(0.8)
    ax.tick_params(colors=COL["text2"], labelsize=9)
    ax.set_xlabel(xlabel, color=COL["text"], fontsize=10)
    ax.set_ylabel(ylabel, color=COL["text"], fontsize=10)
    ax.set_title(title, color=COL["text"], fontsize=10.5, loc="left")


def _pts(ax, x, y, e, variant, label=None, hollow=False, dx=0.0):
    ax.errorbar([xi + dx for xi in x], y, yerr=e, fmt=MARK[variant], color=COL[variant],
                markersize=8, markerfacecolor=COL["surface"] if hollow else COL[variant],
                markeredgecolor=COL[variant] if hollow else COL["surface"],
                markeredgewidth=1.6 if hollow else 1.2, elinewidth=1.6, capsize=3,
                linestyle="none", label=label, zorder=4)


def _band(ax, lo, hi, label, x0=None, x1=None):
    if x0 is None:
        ax.axhspan(lo, hi, color=COL["lit"], alpha=0.16, linewidth=0, label=label, zorder=1)
    else:
        ax.fill_between([x0, x1], [lo, lo], [hi, hi], color=COL["lit"], alpha=0.30,
                        linewidth=0, label=label, zorder=1)


def _legend(ax, **kw):
    leg = ax.legend(fontsize=8, frameon=False, labelcolor=COL["text"], **kw)
    return leg


def _lvl(level):
    return LEVEL_NL.get(level, str(level))


def _sup(label):
    """'16x12^3' -> '16×12³' for figure labels."""
    return (label.replace("^2", "²").replace("^3", "³").replace("^4", "⁴").replace("x", "×"))


def _ratio_panel(ax, blk, lit_cont, derived, title, show_fit):
    """m/sqrt(sigma) versus a^2 sigma for the three variants of one data set."""
    xmax = max(p["x"] for v in VARIANTS for p in blk[v]["points"] if ok(p["x"]))
    for d_ in derived:
        xmax = max(xmax, d_["lit_a2_sigma"] or 0.0)
    xmax *= 1.12
    dx = {"R5": 0.0, "t1": 0.006 * xmax, "t2": -0.006 * xmax}
    lit = lit_cont[0] if lit_cont[0]["verification_level"] == "search_excerpt" else lit_cont[1]
    _band(ax, lit["value"] - lit["unc"], lit["value"] + lit["unc"],
          f"literatuur, continuüm: {fmt_lit(lit['value'], lit['unc'])} "
          f"[{_lvl(lit['verification_level'])}]")
    first = True
    for d_ in derived:
        hw = 0.02 * xmax
        _band(ax, d_["lit_value"] - d_["lit_unc"], d_["lit_value"] + d_["lit_unc"],
              ("literatuur, eindige β: a·m / a√σ (afgeleid, ±1σ)" if first else None),
              d_["lit_a2_sigma"] - hw, d_["lit_a2_sigma"] + hw)
        first = False
    lines = []
    for v in VARIANTS:
        p = blk[v]["points"]
        meas = [q for q in p if q["is_measurement"]]
        _pts(ax, [q["x"] for q in meas], [q["y"] for q in meas], [q["y_err"] for q in meas], v,
             VLAB[v], dx=dx[v])
        fl = blk[v].get("fit_linear")
        if show_fit(fl) and v in ("R5", "t1"):
            xs = np.array([0.0, xmax / 1.12])
            ax.plot(xs, fl["intercept"] + fl["slope"] * xs, color=COL[v], linewidth=2.0,
                    alpha=0.75, zorder=3, solid_capstyle="round")
            ax.errorbar([dx[v]], [fl["intercept"]], yerr=[fl["intercept_err"]], fmt=MARK[v],
                        color=COL[v], markersize=7, markerfacecolor=COL["surface"],
                        markeredgecolor=COL[v], markeredgewidth=1.6, elinewidth=1.6, capsize=3,
                        zorder=5)
            lines.append(f"{v}: rechte lijn → {fmt_ve(fl['intercept'], fl['intercept_err'], 3)}"
                         f"  (χ²/dof {fl['chi2']:.2f}/{fl['dof']}"
                         + ("" if fl.get("acceptable") else f", p < {ACCEPT_P}") + ")")
        fc = blk[v].get("fit_constant")
        if fc and v in ("R5", "t1"):
            if fc.get("value") is not None:
                lines.append(f"{v}: constante {fmt_ve(fc['value'], fc['err'], 3)}"
                             f"  (χ²/dof {fc['chi2']:.2f}/{fc['dof']}"
                             + ("" if fc.get("acceptable") else f", p < {ACCEPT_P}") + ")")
            else:
                lines.append(f"{v}: constante verworpen (χ²/dof {fc['chi2']:.1f}/{fc['dof']})")
    ax.set_xlim(-0.03 * xmax, xmax)
    _style(ax, "a²σ  (roosterafstand², links = continuüm)", "m(0++) / √σ", title)
    return lines


def make_figures(S, outdir):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    recs = S["ensembles"]
    lc = S["literature_comparison"]
    files = []
    foot = ("Fouten: alleen statistisch. Massa's zijn variationele bovengrens-schattingen. "
            "Open symbolen bij a²σ = 0: snijpunt van de rechte lijn (drie punten; geen "
            "gecontroleerde continuümlimiet). Punten van t = 1 en t = 2 zijn horizontaal iets "
            "verschoven. Literatuurwaarden: niet tegen de gepubliceerde tabel gecontroleerd.")

    # ------------------------------------------------------------------ D = 3
    d3 = S["scaling_d3"]
    fig, axes = plt.subplots(1, 3, figsize=(17.5, 5.9), facecolor=COL["surface"])
    for ax, (set_name, title) in zip(axes[:2], (
            ("primary", "primair: alleen ronde 1 (β = 6, 9, 12)"),
            ("all_data", "alle data: β = 9 met beide runs gecombineerd"))):
        names = d3["sets"][set_name]["ensembles"]
        der = [r for r in lc["derived_ratio_rows"] if r["ensemble"] in names]
        lines = _ratio_panel(ax, d3["sets"][set_name], d3["literature"]
                             ["continuum_m0pp_over_sqrt_sigma"], der, title, lambda fl: bool(fl))
        ax.text(0.98, 0.03, "\n".join(lines), transform=ax.transAxes, fontsize=8,
                color=COL["text2"], va="bottom", ha="right")
        _legend(ax, loc="upper right")
    ymin = min(a.get_ylim()[0] for a in axes[:2])
    ymax = max(a.get_ylim()[1] for a in axes[:2])
    for a in axes[:2]:
        a.set_ylim(ymin - 0.32 * (ymax - ymin), ymax + 0.22 * (ymax - ymin))
    ax = axes[2]
    blk = d3["sqrt_sigma_over_g2"]["all_data"]
    ls = d3["literature"]["continuum_sqrt_sigma_over_g2"]
    _band(ax, ls["value"] - ls["unc"], ls["value"] + ls["unc"],
          f"literatuur, continuüm: {fmt_lit(ls['value'], ls['unc'])} "
          f"[{_lvl(ls['verification_level'])}]")
    first = True
    for r in lc["rows"]:
        if (r["D"] == 3 and r["quantity"] == "a*sqrt(sigma)" and r["matched"]
                and r["ensemble"] in d3["sets"]["all_data"]["ensembles"]):
            f = r["beta"] / 4.0
            _band(ax, f * (r["lit_value"] - r["lit_unc"]), f * (r["lit_value"] + r["lit_unc"]),
                  "literatuur, eindige β: β·a√σ/4 (±1σ) [zoekfragment]" if first else None,
                  1.0 / r["beta"] - 0.004, 1.0 / r["beta"] + 0.004)
            first = False
    lines = []
    for v, dx in (("R5", 0.0), ("t1", 0.0012), ("t2", -0.0012)):
        p = blk[v]["points"]
        _pts(ax, [q["x"] for q in p], [q["y"] for q in p], [q["y_err"] for q in p], v, VLAB[v],
             dx=dx)
        fl = blk[v].get("fit_linear_in_1_over_beta")
        if fl and v in ("R5", "t1"):
            xs = np.array([0.0, 1.0 / 6.0])
            ax.plot(xs, fl["intercept"] + fl["slope"] * xs, color=COL[v], linewidth=2.0,
                    alpha=0.75, zorder=3, solid_capstyle="round")
            ax.errorbar([dx], [fl["intercept"]], yerr=[fl["intercept_err"]], fmt=MARK[v],
                        color=COL[v], markersize=7, markerfacecolor=COL["surface"],
                        markeredgecolor=COL[v], markeredgewidth=1.6, elinewidth=1.6, capsize=3,
                        zorder=5)
            lines.append(f"{v}: rechte lijn → {fmt_ve(fl['intercept'], fl['intercept_err'], 4)}"
                         f"  (χ²/dof {fl['chi2']:.2f}/{fl['dof']}"
                         + ("" if is_acceptable(fl) else f", p < {ACCEPT_P}") + ")")
    ax.set_xlim(-0.008, 0.18)
    _style(ax, "1/β  (links = continuüm)", "β·a√σ / 4  =  √σ / g²",
           "alle data: √σ/g² tegen 1/β (naïeve rechte lijn in de kale koppeling)")
    ax.text(0.98, 0.03, "\n".join(lines), transform=ax.transAxes, fontsize=8, color=COL["text2"],
            va="bottom", ha="right")
    _legend(ax, loc="upper left")
    fig.suptitle(f"SU(2) in D = 3: schaalgedrag van de glueballmassa en de snaarspanning — "
                 f"{TAGLINE_NL}", color=COL["text"], fontsize=13, x=0.01, ha="left")
    fig.text(0.01, 0.012, foot, fontsize=8, color=COL["text2"], ha="left", va="bottom", wrap=True)
    fig.tight_layout(rect=(0, 0.045, 1, 0.94))
    path = os.path.join(outdir, "summary_scaling_d3.png")
    fig.savefig(path, dpi=130, facecolor=COL["surface"])
    plt.close(fig)
    files.append(os.path.basename(path))

    # ------------------------------------------------------------------ D = 4
    d4 = S["scaling_d4"]
    fig, axes = plt.subplots(2, 2, figsize=(14.5, 11.0), facecolor=COL["surface"])
    for ax, (set_name, title) in zip(axes[0], (
            ("primary", "primair: alleen ronde 1 (β = 2.3, 2.4, 2.5)"),
            ("all_data", "alle data: β = 2.5 met beide runs gecombineerd"))):
        names = d4["sets"][set_name]["ensembles"]
        der = [r for r in lc["derived_ratio_rows"] if r["ensemble"] in names]
        lines = _ratio_panel(ax, d4["sets"][set_name], d4["literature"]
                             ["continuum_m0pp_over_sqrt_sigma"], der, title,
                             lambda fl: bool(fl) and fl.get("extrapolation_reported"))
        lines.append("rechte lijn: formeel aanvaardbaar, géén continuümlimiet (zie voetregel)")
        ax.text(0.03, 0.03, "\n".join(lines), transform=ax.transAxes, fontsize=8,
                color=COL["text2"], va="bottom", ha="left")
        _legend(ax, loc="upper right")
    ymin = min(a.get_ylim()[0] for a in axes[0])
    ymax = max(a.get_ylim()[1] for a in axes[0])
    for a in axes[0]:
        a.set_ylim(ymin - 0.10 * (ymax - ymin), ymax + 0.25 * (ymax - ymin))
    # (c) a*m: ours / literature
    ax = axes[1][0]
    first = True
    xt, xl = [], []
    pos = {n: i for i, n in enumerate([n for n in INDEPENDENT_ALL if recs[n]["D"] == 4])}
    for r in lc["rows"]:
        if r["D"] == 4 and r["quantity"] == "a*m(0++)" and r["matched"] and r["ensemble"] in pos:
            i = pos[r["ensemble"]]
            rel = r["lit_unc"] / r["lit_value"]
            _band(ax, 1 - rel, 1 + rel,
                  "literatuur (Teper, tabel 10) ±1σ [zoekfragment]" if first else None,
                  i - 0.38, i + 0.38)
            first = False
            rec = recs[r["ensemble"]]
            for v, dx in (("t1", -0.12), ("t2", 0.12)):
                m = rec["am"][v]
                _pts(ax, [i], [m["value"] / r["lit_value"]], [m["err"] / r["lit_value"]], v,
                     (VLAB[v] + (" (= R5: overal t* = 1)" if v == "t1" else "")) if i == 0 else None,
                     dx=dx)
            xt.append(i)
            xl.append(f"β = {rec['beta']:g}\n{_sup(rec['lattice'])}\n"
                      f"(lit.: {r['lit_lattice_L']}⁴)")
    ax.axhline(1.0, color=COL["text2"], linewidth=0.8, zorder=2)
    ax.set_xticks(xt)
    ax.set_xticklabels(xl)
    ax.set_xlim(-0.6, len(pos) - 0.4)
    _style(ax, "", "a·m (wij) / a·m (literatuur)",
           "glueballmassa t.o.v. de literatuurwaarde bij dezelfde β")
    _legend(ax, loc="upper left")
    # (d) sqrt(sigma)/Lambda_L
    ax = axes[1][1]
    ab = d4["asymptotic_scaling"]["sets"]["all_data"]
    for v, dx in (("R5", 0.0), ("t1", 0.006), ("t2", -0.006)):
        rws = ab[v]["rows"]
        _pts(ax, [q["beta"] for q in rws], [q["sqrt_sigma_over_lambda"]["value"] for q in rws],
             [q["sqrt_sigma_over_lambda"]["err"] for q in rws], v, VLAB[v], dx=dx)
    c = ab["R5"]["sqrt_sigma_over_lambda_constancy"]
    ax.text(0.03, 0.05, "asymptotische schaling zou een horizontale lijn geven;\n"
            f"gemeten (R5): {c['percent_change_first_to_last']:+.1f}({c['percent_change_err']:.1f}) % "
            "van β = 2.3 naar 2.5", transform=ax.transAxes, fontsize=8.5, color=COL["text2"],
            va="bottom", ha="left")
    ax.set_xticks([2.3, 2.4, 2.5])
    ax.set_xlim(2.25, 2.55)
    _style(ax, "β", "√σ / Λ_L  (twee-lus-formule)",
           "alle data: afstand tot asymptotische schaling")
    _legend(ax, loc="upper right")
    fig.suptitle(f"SU(2) in D = 4: schaalgedrag — {TAGLINE_NL}", color=COL["text"], fontsize=13,
                 x=0.01, ha="left")
    fig.text(0.01, 0.008, foot + " In D = 4 loopt m/√σ op met β; de rechte lijn is geen "
             "continuümextrapolatie.", fontsize=8, color=COL["text2"], ha="left", va="bottom",
             wrap=True)
    fig.tight_layout(rect=(0, 0.04, 1, 0.955))
    path = os.path.join(outdir, "summary_scaling_d4.png")
    fig.savefig(path, dpi=130, facecolor=COL["surface"])
    plt.close(fig)
    files.append(os.path.basename(path))

    # ------------------------------------------------------------------ volume
    n_fv = len(S["finite_volume"])
    fig, axes = plt.subplots(n_fv, 2, figsize=(13.5, 5.0 * n_fv), facecolor=COL["surface"],
                             squeeze=False)
    for row, cmp_ in enumerate(S["finite_volume"]):
        ra, rb = recs[cmp_["A"]], recs[cmp_["B"]]
        for col, (key, qlab, ylabel) in enumerate((("am", "a*m(0++)", "a·m (0++)"),
                                                   ("a_sqrt_sigma", "a*sqrt(sigma)", "a√σ"))):
            ax = axes[row][col]
            seen_lab = set()
            for r in lc["rows"]:
                if r["ensemble"] in (ra["name"], rb["name"]) and r["quantity"] == qlab \
                        and ok(r["lit_unc"]) and (r["same_L"] or (
                            r["lit_lattice_L"] is None and r["lit_role"] == "primary")):
                    rec = recs[r["ensemble"]]
                    if r["lit_lattice_L"] is None:
                        lab = (f"literatuur {fmt_lit(r['lit_value'], r['lit_unc'])}, rooster niet "
                               f"genoemd [{_lvl(r['verification_level'])}]")
                        if lab not in seen_lab:
                            _band(ax, r["lit_value"] - r["lit_unc"], r["lit_value"] + r["lit_unc"],
                                  lab)
                            seen_lab.add(lab)
                    else:
                        lab = "literatuur bij dezelfde L (±1σ) [zoekfragment]"
                        _band(ax, r["lit_value"] - r["lit_unc"], r["lit_value"] + r["lit_unc"],
                              lab if lab not in seen_lab else None, rec["L"] - 1.6, rec["L"] + 1.6)
                        seen_lab.add(lab)
            for v, dx in (("R5", 0.0), ("t1", 0.45), ("t2", -0.45)):
                for hollow in (False, True):
                    sel = [q for q in (ra, rb) if ok(q[key][v]["value"], q[key][v]["err"])
                           and (not q[key][v]["is_measurement"]) == hollow]
                    if not sel:
                        continue
                    lab = VLAB[v] if not hollow else "R5: geen plateau (alleen bovengrens)"
                    _pts(ax, [q["L"] for q in sel], [q[key][v]["value"] for q in sel],
                         [q[key][v]["err"] for q in sel], v, lab, hollow=hollow, dx=dx)
            rr = {(q["key"], q["variant"]): q for q in cmp_["rows"]}
            txt = "klein − groot:  " + ",  ".join(
                f"{v}: " + (f"{rr[(key, v)]['sigma']:+.1f}σ" if rr[(key, v)]["sigma"] is not None
                            else "geen meting") for v in VARIANTS)
            ax.text(0.98, 0.03, txt, transform=ax.transAxes, fontsize=8.5, color=COL["text2"],
                    va="bottom", ha="right")
            ax.set_xticks([ra["L"], rb["L"]])
            ax.set_xlim(ra["L"] - 3, rb["L"] + 3)
            lo, hi = ax.get_ylim()
            ax.set_ylim(lo - 0.18 * (hi - lo), hi + 0.30 * (hi - lo))
            _style(ax, "ruimtelijke roostergrootte L", ylabel,
                   f"D = {ra['D']}, β = {ra['beta']:g}: {ylabel} op {_sup(ra['lattice'])} en "
                   f"{_sup(rb['lattice'])}")
            _legend(ax, loc="upper left", ncol=2)
    fig.suptitle(f"Eindig-volumecontrole (klein en groot rooster bij dezelfde β) — {TAGLINE_NL}",
                 color=COL["text"], fontsize=13, x=0.01, ha="left")
    fig.text(0.01, 0.008, "Fouten: alleen statistisch. Punten van t = 1 en t = 2 zijn horizontaal "
             "iets verschoven. Het grotere rooster heeft minder metingen en dus grotere fouten: "
             "volume-effecten zijn alleen op dat niveau begrensd. Literatuurwaarden: niet tegen "
             "de gepubliceerde tabel gecontroleerd.", fontsize=8, color=COL["text2"], ha="left",
             va="bottom", wrap=True)
    fig.tight_layout(rect=(0, 0.035, 1, 0.955))
    path = os.path.join(outdir, "summary_volume.png")
    fig.savefig(path, dpi=130, facecolor=COL["surface"])
    plt.close(fig)
    files.append(os.path.basename(path))
    return files


# ==============================================================================================
# command line
# ==============================================================================================
def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--results", default=os.path.join(_HERE, "results"),
                    help="directory with the pipeline files <ensemble>.json (read only)")
    ap.add_argument("--literature", default=os.path.join(_HERE, "literature.json"))
    ap.add_argument("--outdir", default=None, help="output directory (default: --results)")
    ap.add_argument("--no-plots", action="store_true")
    args = ap.parse_args(argv)
    outdir = args.outdir or args.results
    os.makedirs(outdir, exist_ok=True)

    summary = build_summary(args.results, args.literature)
    summary["figures"] = [] if args.no_plots else make_figures(summary, outdir)
    with open(os.path.join(outdir, "summary.json"), "w", encoding="utf-8") as fh:
        json.dump(summary, fh, indent=1, ensure_ascii=False, allow_nan=False)
        fh.write("\n")
    with open(os.path.join(outdir, "summary.md"), "w", encoding="utf-8") as fh:
        fh.write(render_markdown(summary))
    print(f"wrote {os.path.join(outdir, 'summary.json')}, summary.md"
          + ("" if args.no_plots else " and " + ", ".join(summary["figures"])))
    print("(numerical evidence at finite lattice spacing and volume; not a proof of the mass gap)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
