"""Tests of summarize.py (the synthesis across ensembles): fit, pull and formatting helpers on
inputs with a known answer, the reading of pipeline files, and the whole chain on SYNTHETIC
pipeline files constructed so that every fit and pull is known in closed form.

    python3 -m pytest -q tests/test_summarize.py          # a few seconds

All tests are deterministic (no random numbers).  Expected values were worked out by hand (they
are derived in the comments) before the tests were first run.  The last two tests read the real
pipeline output in results/ if it is present; they never write there (output goes to tmp_path)
and check that no input file is changed.

Nothing here is, or tests, a proof of anything about Yang-Mills theory: these are tests of
bookkeeping and least-squares arithmetic.
"""
import hashlib
import json
import math
import os
from pathlib import Path

import numpy as np
import pytest

import summarize as S
from ym import exact

ROOT = Path(__file__).resolve().parents[1]


# ----------------------------------------------------------------------------------------------
# formatting
# ----------------------------------------------------------------------------------------------
def test_fmt_ve_fixed_decimals():
    assert S.fmt_ve(1.19587, 0.00768, 4) == "1.1959(77)"
    assert S.fmt_ve(0.8041176, 0.0122528, 4) == "0.8041(123)"
    assert S.fmt_ve(4.709793, 0.036957, 3) == "4.710(37)"
    assert S.fmt_ve(0.16073, 0.00062, 4) == "0.1607(6)"
    assert S.fmt_ve(215.696, 7.275, 1) == "215.7(7.3)"       # error >= 1: with decimal point
    assert S.fmt_ve(-2.25, 0.9996, 2) == "-2.25(1.00)"       # ... also when it rounds up to 1
    assert S.fmt_ve(-1.83, 0.96, 2) == "-1.83(96)"
    assert S.fmt_ve(1234.4, 56.7, 0) == "1234(57)"
    assert S.fmt_ve(None, 0.1, 3) == "n/a"
    assert S.fmt_ve(float("nan"), 0.1, 3) == "n/a"
    assert S.fmt_ve(1.5, None, 2) == "1.50"


def test_fmt_ve_automatic_two_significant_digits():
    assert S.fmt_ve(1.19587, 0.00768) == "1.1959(77)"
    assert S.fmt_ve(0.80412, 0.01225) == "0.804(12)"
    assert S.fmt_ve(3.781, 0.23) == "3.78(23)"


def test_fmt_lit_keeps_the_precision_of_the_source():
    assert S.n_decimals(0.2538) == 4 and S.n_decimals(0.001) == 3 and S.n_decimals(1.0) == 0
    assert S.fmt_lit(0.1616, 0.0006) == "0.1616(6)"
    assert S.fmt_lit(0.266, 0.0021) == "0.2660(21)"
    assert S.fmt_lit(1.19, 0.02) == "1.19(2)"
    assert S.fmt_lit(3.78, 0.07) == "3.78(7)"
    assert S.fmt_lit(2.2991, None) == "2.2991"


def test_lattice_and_beta_labels():
    assert S.lattice_label([16, 16, 16]) == "16^3"
    assert S.lattice_label([16, 12, 12, 12]) == "16x12^3"
    assert S.lattice_label([12, 10, 10, 10]) == "12x10^3"
    assert S.beta_key(6.0) == "6" and S.beta_key(2.3) == "2.3" and S.beta_key(12.0) == "12"


# ----------------------------------------------------------------------------------------------
# pulls, differences, ratios
# ----------------------------------------------------------------------------------------------
def test_pull_and_difference():
    # 3-4-5 triangle: combined error 0.5
    assert S.pull(1.0, 0.3, 0.0, 0.4) == pytest.approx(2.0, rel=1e-14)
    assert S.pull(0.0, 0.4, 1.0, 0.3) == pytest.approx(-2.0, rel=1e-14)
    d = S.diff_sigma(0.8041, 0.0123, 0.7584, 0.0099)
    assert d["diff"] == pytest.approx(0.0457, abs=1e-12)
    assert d["err"] == pytest.approx(math.sqrt(0.0123 ** 2 + 0.0099 ** 2), rel=1e-14)
    assert d["sigma"] == pytest.approx(0.0457 / math.sqrt(0.0123 ** 2 + 0.0099 ** 2), rel=1e-12)
    assert S.pull(1.0, None, 0.0, 0.4) is None
    assert S.pull(1.0, 0.0, 0.0, 0.0) is None
    assert S.diff_sigma(1.0, float("nan"), 0.0, 0.1)["sigma"] is None


def test_ratio_and_product_of_independent_numbers():
    r, e = S.ratio_indep(2.0, 0.2, 4.0, 0.4)          # both 10 %: 0.5 * sqrt(0.02)
    assert r == pytest.approx(0.5) and e == pytest.approx(0.5 * math.sqrt(0.02), rel=1e-14)
    p, e = S.product_indep(2.0, 0.2, 4.0, 0.4)        # sqrt((4*0.2)^2 + (2*0.4)^2)
    assert p == pytest.approx(8.0) and e == pytest.approx(math.sqrt(0.64 + 0.64), rel=1e-14)
    assert S.ratio_indep(1.0, 0.1, 0.0, 0.1) == (None, None)
    assert S.ratio_indep(None, 0.1, 1.0, 0.1) == (None, None)


def test_count_pulls():
    c = S.count_pulls([0.5, -2.5, 3.5, None, 2.0, -3.0, float("nan")])
    # 2.0 and -3.0 lie ON the thresholds and are not counted ("exceed")
    assert c["n"] == 5 and c["n_gt_2"] == 3 and c["n_gt_3"] == 1
    assert c["max_abs"] == pytest.approx(3.5)
    assert S.count_pulls([])["n"] == 0 and S.count_pulls([])["max_abs"] is None


# ----------------------------------------------------------------------------------------------
# fits
# ----------------------------------------------------------------------------------------------
def test_chi2_pvalue():
    assert S.chi2_pvalue(1.0, 1) == pytest.approx(0.31731050786291415, rel=1e-12)
    assert S.chi2_pvalue(2.0, 2) == pytest.approx(math.exp(-1.0), rel=1e-12)   # exp(-chi2/2)
    assert S.chi2_pvalue(0.0, 3) == pytest.approx(1.0)
    assert S.chi2_pvalue(1.0, 0) is None


def test_fit_constant_known_answer():
    f = S.fit_constant([1.0, 2.0], [1.0, 1.0])
    assert f["value"] == pytest.approx(1.5) and f["err"] == pytest.approx(1 / math.sqrt(2))
    assert f["chi2"] == pytest.approx(0.5) and f["dof"] == 1
    # unequal weights: w = 1, 1/4  ->  mean (1*1 + 3/4)/(5/4) = 1.4, err = sqrt(4/5)
    f = S.fit_constant([1.0, 3.0], [1.0, 2.0])
    assert f["value"] == pytest.approx(1.4) and f["err"] == pytest.approx(math.sqrt(0.8))
    assert f["chi2"] == pytest.approx(0.16 + 0.64)
    assert f["scale_factor"] == 1.0


def test_fit_linear_known_answer():
    # x = 0,1,2; y = 0,1,1; unit errors.  Normal equations: slope = 1/2, intercept = 1/6,
    # residuals (-1/6, 1/3, -1/6) -> chi2 = 1/6;  var(intercept) = sum x^2 / (n sum x^2 -
    # (sum x)^2) = 5/6,  var(slope) = n / 6 = 1/2,  cov = -sum x / 6 = -1/2.
    f = S.fit_linear([0.0, 1.0, 2.0], [0.0, 1.0, 1.0], [1.0, 1.0, 1.0])
    assert f["intercept"] == pytest.approx(1 / 6, abs=1e-13)
    assert f["slope"] == pytest.approx(0.5, abs=1e-13)
    assert f["intercept_err"] == pytest.approx(math.sqrt(5 / 6), rel=1e-12)
    assert f["slope_err"] == pytest.approx(math.sqrt(0.5), rel=1e-12)
    assert f["cov_intercept_slope"] == pytest.approx(-0.5, rel=1e-12)
    assert f["chi2"] == pytest.approx(1 / 6, rel=1e-12) and f["dof"] == 1
    assert f["p_value"] == pytest.approx(S.chi2_pvalue(1 / 6, 1))


def test_fit_linear_recovers_an_exact_line_and_scales_with_the_errors():
    x = np.array([0.0141, 0.0258, 0.0645])
    y = 4.7 + 2.0 * x
    e = np.array([0.04, 0.03, 0.04])
    f = S.fit_linear(x, y, e)
    assert f["intercept"] == pytest.approx(4.7, abs=1e-10)
    assert f["slope"] == pytest.approx(2.0, abs=1e-8)
    assert f["chi2"] == pytest.approx(0.0, abs=1e-18)
    g = S.fit_linear(x, y, 3.0 * e)                    # errors x3: parameter errors x3
    assert g["intercept_err"] == pytest.approx(3.0 * f["intercept_err"], rel=1e-10)
    assert g["slope_err"] == pytest.approx(3.0 * f["slope_err"], rel=1e-10)


def test_fit_quadratic_is_lagrange_interpolation_for_three_points():
    # through (1, y1), (2, y2), (3, y3): value at 0 is 3 y1 - 3 y2 + y3
    y, e = [2.0, 3.0, 7.0], [0.1, 0.2, 0.3]
    f = S.fit_quadratic([1.0, 2.0, 3.0], y, e)
    assert f["intercept"] == pytest.approx(3 * 2.0 - 3 * 3.0 + 7.0, abs=1e-9)
    assert f["intercept_err"] == pytest.approx(
        math.sqrt(9 * 0.01 + 9 * 0.04 + 0.09), rel=1e-9)
    assert f["dof"] == 0 and f["p_value"] is None and f["chi2"] == pytest.approx(0.0, abs=1e-15)


def test_wls_poly_refuses_bad_input():
    with pytest.raises(ValueError):
        S.wls_poly([0.0, 1.0], [1.0, 2.0], [1.0, 1.0], 2)        # too few points
    with pytest.raises(ValueError):
        S.wls_poly([0.0, 1.0], [1.0, 2.0], [1.0, 0.0], 0)        # zero error
    with pytest.raises(ValueError):
        S.wls_poly([0.0, 1.0], [1.0, float("nan")], [1.0, 1.0], 0)


def test_gate_for_d4_extrapolations():
    good = S.fit_linear([0.0, 1.0, 2.0], [1.0, 2.0, 3.0], [0.1, 0.1, 0.1])       # exact line
    bad = S.fit_linear([0.0, 1.0, 2.0], [1.0, 2.0, 4.0], [0.1, 0.1, 0.1])        # chi2 = 100/6
    assert bad["chi2"] == pytest.approx(100.0 / 6.0, rel=1e-10)
    g, b = S._gated(good, "linear"), S._gated(bad, "linear")
    assert g["acceptable"] and g["extrapolation_reported"]
    assert g["intercept"] == pytest.approx(1.0, abs=1e-10) and "why_not_trusted" in g
    assert not b["acceptable"] and not b["extrapolation_reported"]
    assert "intercept" not in b and "reason" in b
    # zero degrees of freedom is never "acceptable"
    assert not S.is_acceptable(S.fit_quadratic([1.0, 2.0, 3.0], [1.0, 2.0, 4.0], [1.0, 1.0, 1.0]))


# ----------------------------------------------------------------------------------------------
# literature helpers
# ----------------------------------------------------------------------------------------------
def test_literature_entry_helpers():
    node = {"value": 0.2538, "uncertainty": 0.001, "verification_level": "search_excerpt",
            "source": "M. Teper, Phys. Rev. D59 (1999) 014512, arXiv:hep-lat/9804008, table "
                      "'... flux loop masses of length L', beta=6.0, L=16.",
            "alternatives": [{"value": 0.2562, "uncertainty": 0.0026,
                              "source": "same table, beta=6.0, L=24"},
                             {"value": 0.19, "uncertainty": 0.01, "source": "from memory"}]}
    e = S.lit_entries(node)
    assert [x["_role"] for x in e] == ["primary", "alternative 1", "alternative 2"]
    assert all("alternatives" not in x for x in e)
    assert [S.lit_lattice_L(x) for x in e] == [16, 24, None]
    assert S.lit_short_source(e[0]) == "arXiv:hep-lat/9804008"
    assert S.lit_short_source(e[1]) == "arXiv:hep-lat/9804008"     # inherited ("same table")
    assert S.lit_short_source(e[2]) == "no source identified"
    assert S.lit_lattice_L({"source": "Table 10, row beta=2.5, 16^4 lattice"}) == 16
    assert S.lit_lattice_L({"source": "0.1871(10) on a 16^4 lattice and 0.1871(32) on a 32^4"}) == 16
    assert S.lit_short_source({"source": "JHEP 12 (2021) 082, arXiv:2106.00364."}) \
        == "arXiv:2106.00364"
    assert "alternatives" in node                                   # input not modified


# ----------------------------------------------------------------------------------------------
# synthetic pipeline files
# ----------------------------------------------------------------------------------------------
def _channel(m1, e1, m2, e2, t_star, plateau=True, L=None):
    val, err = (m1, e1) if t_star == 1 else (m2, e2)
    blk = {"mass": val, "err": err, "t_star": t_star if plateau else None,
           "t_value": t_star, "flag": "plateau" if plateau else "no plateau",
           "plateau": plateau, "upper_bound_only": not plateau,
           "fixed_t": {"t1": {"m": m1, "err": e1}, "t2": {"m": m2, "err": e2},
                       "t1_minus_t2": {"value": m1 - m2, "err": 0.5 * math.hypot(e1, e2)}}}
    if L is not None:
        blk["L"] = L
    return blk


def fake_pipeline(name, shape, beta, am, s, *, am_err=0.01, s_err=0.001, t_glue=1, t_tor=1,
                  plateau_tor=True, plaq=0.6, ratio_err=None, m2_shift=0.0):
    """Minimal pipeline file: glueball mass ``am`` and a*sqrt(sigma) = ``s`` at t = 1 AND t = 2
    (t = 2: am + m2_shift, with doubled errors).  The torelon energy is a dummy number."""
    D, T, L = len(shape), shape[0], shape[1]
    st_fixed = [{"t": 1, "aE": 1.0, "aE_err": 0.01,
                 "nambu_goto": {"a_sqrt_sigma": s, "a_sqrt_sigma_err": s_err},
                 "luscher": {"a_sqrt_sigma": s - 0.001, "a_sqrt_sigma_err": s_err}},
                {"t": 2, "aE": 1.0, "aE_err": 0.02,
                 "nambu_goto": {"a_sqrt_sigma": s, "a_sqrt_sigma_err": 2 * s_err},
                 "luscher": {"a_sqrt_sigma": s - 0.001, "a_sqrt_sigma_err": 2 * s_err}}]
    se = s_err if t_tor == 1 else 2 * s_err
    m_r5 = am if t_glue == 1 else am + m2_shift
    me = am_err if t_glue == 1 else 2 * am_err
    d = {
        "ensemble": name, "generated_utc": "2000-01-01T00:00:00Z", "D": D, "shape": list(shape),
        "T": T, "L_spatial": list(shape[1:]), "beta": beta,
        "streams": [{"seed": 1}, {"seed": 2}],
        "n_meas_total": 1000, "n_meas_used": 990, "binsize": 10, "n_bins": 99,
        "tau_int_max": 1.0,
        "stream_consistency": {"plaquette": {"chi2": 1.0, "dof": 1},
                               "hot_minus_cold": {"pull": 0.5}},
        "plaquette": {"mean": plaq, "err": 1e-5},
        "glueball": _channel(am, am_err, am + m2_shift, 2 * am_err, t_glue),
        "torelon": _channel(1.0, 0.01, 1.0, 0.02, t_tor, plateau_tor, L=L),
        "string_tension": {
            "L": L, "upper_bound_only": not plateau_tor,
            "nambu_goto": {"sigma_a2": s * s, "sigma_a2_err": 2 * s * se, "a_sqrt_sigma": s,
                           "a_sqrt_sigma_err": se},
            "luscher": {"sigma_a2": (s - 0.001) ** 2, "sigma_a2_err": 2 * s * se,
                        "a_sqrt_sigma": s - 0.001, "a_sqrt_sigma_err": se},
            "fixed_t": st_fixed},
        "ratios": {"m_over_sqrt_sigma": {"nambu_goto": {
            "value": m_r5 / s,
            "err": ratio_err if ratio_err is not None else S.ratio_indep(m_r5, me, s, se)[1]}},
            "upper_bound_only": not plateau_tor},
        "binning_check": {"binsize": 20,
                          "glueball": {"am": m_r5, "am_err": me, "t_star": t_glue},
                          "torelon": {"aE": 1.0, "aE_err": 0.01,
                                      "t_star": t_tor if plateau_tor else None,
                                      "flag": "plateau" if plateau_tor else "no plateau"}},
        "warnings": ["x_s1.npz is an incomplete run (1 of 2 measurements; reason: maxtime)"],
    }
    if D == 3:
        d["D3"] = {"beta_am_over_4": {"value": beta * m_r5 / 4.0}}
    if D == 4:
        d["D4"] = {"a_lambda_two_loop": exact.a_lambda_two_loop(beta)}
    return d


#: D = 3: m/sqrt(sigma) = 4.7 + 2 a^2 sigma exactly;  D = 4: m/sqrt(sigma) = 3.5 exactly
S3 = {6.0: 0.25, 9.0: 0.16, 12.0: 0.12}
S4 = {2.3: 0.36, 2.4: 0.26, 2.5: 0.19}
SHAPES = {"d3_b6.0_L16": (16, 16, 16), "d3_b6.0_L24": (24, 24, 24), "d3_b9.0_L24": (24, 24, 24),
          "d3_b9.0_L24r": (24, 24, 24), "d3_b9.0_L24_combined": (24, 24, 24),
          "d3_b12.0_L32": (32, 32, 32), "d4_b2.3_L10": (12, 10, 10, 10),
          "d4_b2.4_L12": (16, 12, 12, 12), "d4_b2.4_L16": (16, 16, 16, 16),
          "d4_b2.5_L16": (16, 16, 16, 16), "d4_b2.5_L16x": (16, 16, 16, 16),
          "d4_b2.5_L16_combined": (16, 16, 16, 16)}


def _beta_of(name):
    return float(name.split("_")[1][1:])


def write_synthetic_results(directory):
    directory.mkdir(parents=True, exist_ok=True)
    for name, shape in SHAPES.items():
        beta = _beta_of(name)
        if len(shape) == 3:
            s = S3[beta]
            am = (4.7 + 2.0 * s * s) * s
        else:
            s = S4[beta]
            am = 3.5 * s
        kw = {}
        if name == "d3_b6.0_L24":
            kw = {"plateau_tor": False, "t_tor": 2}       # like the real one: no torelon plateau
        if name == "d3_b9.0_L24r":
            am += 0.03                                     # replication 3 units of am_err higher
        d = fake_pipeline(name, shape, beta, am, s, **kw)
        (directory / f"{name}.json").write_text(json.dumps(d))
    lit = {
        "_meta": {"compiled_on": "2000-01-01"},
        "D3_SU2_wilson": {
            # ours at beta = 6: 0.25 +- 0.001; literature 0.2525 +- 0.00  -> see test for the pull
            "a_sqrt_sigma": {"6": {"value": 0.2530, "uncertainty": 0.0012, "source": "x, L=16.",
                                   "verification_level": "search_excerpt", "web_verified": True,
                                   "alternatives": [{"value": 0.25, "uncertainty": 0.001,
                                                     "source": "same table, L=24",
                                                     "verification_level": "search_excerpt"}]}},
            "a_m_0pp": {"6": {"value": 1.2, "uncertainty": 0.02, "source": "memory",
                              "verification_level": "none", "web_verified": False}},
            "continuum_m0pp_over_sqrt_sigma": {"value": 4.6, "uncertainty": 0.05,
                                               "source": "arXiv:hep-lat/0000001",
                                               "verification_level": "search_excerpt"},
            "continuum_sqrt_sigma_over_g2": {"value": 0.33, "uncertainty": 0.01,
                                             "source": "arXiv:hep-lat/0000002",
                                             "verification_level": "search_excerpt"}},
        "D4_SU2_wilson": {
            "plaquette": {"2.3": {"value": 0.61, "uncertainty": 0.001, "source": "memory",
                                  "verification_level": "none"},
                          "2.2": {"value": 0.57, "uncertainty": 0.001, "source": "memory",
                                  "verification_level": "none"}},
            "a_sqrt_sigma": {}, "a_m_0pp": {},
            "continuum_m0pp_over_sqrt_sigma": {"value": 3.4, "uncertainty": 0.1,
                                               "source": "arXiv:hep-lat/0000003",
                                               "verification_level": "search_excerpt"},
            "beta_c": {"4": {"value": 2.2986, "uncertainty": 0.0006, "source": "x"}}},
    }
    lit_path = directory / "literature.json"
    lit_path.write_text(json.dumps(lit))
    return lit_path


def test_extract_ensemble_variants_and_error_kinds():
    # both channels chose t* = 1: the fixed-t1 ratio IS the pipeline ratio (correlated error)
    d = fake_pipeline("d4_b2.4_L12", (16, 12, 12, 12), 2.4, 0.91, 0.26, ratio_err=0.0123)
    r = S.extract_ensemble(d, "d4_b2.4_L12")
    assert r["lattice"] == "16x12^3" and r["L"] == 12 and r["T"] == 16 and r["round"] == "1"
    q = r["m_over_sqrt_sigma"]
    assert q["R5"]["value"] == pytest.approx(3.5) and q["R5"]["err"] == 0.0123
    assert q["t1"]["err"] == 0.0123 and "correlated" in q["t1"]["err_kind"]
    assert q["t2"]["err_kind"] == "uncorrelated propagation"
    assert q["t2"]["err"] == pytest.approx(3.5 * math.hypot(0.02 / 0.91, 0.002 / 0.26), rel=1e-12)
    # finite-volume indicators and two-loop quantities
    fv = r["finite_volume_indicators"]["R5"]
    assert fv["L_sqrt_sigma"]["value"] == pytest.approx(12 * 0.26)
    assert fv["mL"]["value"] == pytest.approx(12 * 0.91)
    assert fv["mT"]["value"] == pytest.approx(16 * 0.91)
    assert fv["two_torelon_over_m"]["value"] == pytest.approx(2.0 / 0.91)
    al = (6 * math.pi ** 2 * 2.4 / 11) ** (51 / 121) * math.exp(-3 * math.pi ** 2 * 2.4 / 11)
    assert r["D4"]["a_lambda_two_loop"] == pytest.approx(al, rel=1e-13)
    assert r["D4"]["m_over_lambda"]["t1"]["value"] == pytest.approx(0.91 / al, rel=1e-13)
    assert r["D4"]["matches_pipeline"] is True
    assert r["am_over_err"]["R5"] == pytest.approx(91.0)
    assert r["ng_minus_luscher"]["t1"] == pytest.approx(0.001)
    assert r["n_incomplete_streams"] == 1 and r["warnings_other"] == []

    # glueball t* = 1, torelon t* = 2: the t1 ratio needs uncorrelated propagation
    d = fake_pipeline("d3_b6.0_L16", (16, 16, 16), 6.0, 1.2, 0.25, t_tor=2, ratio_err=0.05)
    r = S.extract_ensemble(d, "d3_b6.0_L16")
    assert r["m_over_sqrt_sigma"]["R5"]["err"] == 0.05
    assert r["m_over_sqrt_sigma"]["t1"]["err_kind"] == "uncorrelated propagation"
    assert r["m_over_sqrt_sigma"]["t1"]["err"] == pytest.approx(
        4.8 * math.hypot(0.01 / 1.2, 0.001 / 0.25), rel=1e-12)
    assert r["D3"]["m_over_g2"]["R5"]["value"] == pytest.approx(1.8)
    assert r["D3"]["sqrt_sigma_over_g2"]["t1"]["value"] == pytest.approx(0.375)

    # no torelon plateau: the R5 string tension and ratio are NOT measurements
    d = fake_pipeline("d3_b6.0_L24", (24, 24, 24), 6.0, 1.2, 0.25, t_tor=2, plateau_tor=False)
    r = S.extract_ensemble(d, "d3_b6.0_L24")
    assert r["a_sqrt_sigma"]["R5"]["is_measurement"] is False
    assert r["m_over_sqrt_sigma"]["R5"]["is_measurement"] is False
    assert r["a_sqrt_sigma"]["t1"]["is_measurement"] is True
    assert r["am"]["R5"]["is_measurement"] is True


def test_whole_chain_on_synthetic_files(tmp_path):
    res = tmp_path / "results"
    lit_path = write_synthetic_results(res)
    out = tmp_path / "out"
    before = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in res.iterdir()}
    assert S.main(["--results", str(res), "--literature", str(lit_path), "--outdir", str(out),
                   "--no-plots"]) == 0
    assert {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in res.iterdir()} == before
    assert sorted(p.name for p in out.iterdir()) == ["summary.json", "summary.md"]
    summ = json.loads((out / "summary.json").read_text())
    md = (out / "summary.md").read_text()
    assert S.TAGLINE_NL in md and "geen bewijs" in md
    assert "not a proof" in summ["disclaimer"].lower() or "NOT a proof" in summ["disclaimer"]

    # --- D = 3: points lie exactly on 4.7 + 2 x  -> intercept 4.7, slope 2, chi2 = 0
    for set_name in ("primary", "all_data"):
        for v in S.VARIANTS:
            blk = summ["scaling_d3"]["sets"][set_name][v]
            fl = blk["fit_linear"]
            assert fl["intercept"] == pytest.approx(4.7, abs=1e-8)
            assert fl["slope"] == pytest.approx(2.0, abs=1e-6)
            assert fl["chi2"] == pytest.approx(0.0, abs=1e-12) and fl["dof"] == 1
            assert fl["acceptable"] is True
            # pull against the synthetic literature value 4.6(5)
            p = blk["pulls_linear_vs_literature"][0]
            assert p["pull"] == pytest.approx(0.1 / math.hypot(fl["intercept_err"], 0.05),
                                              rel=1e-6)
            assert [q["x"] for q in blk["points"]] == pytest.approx(
                [0.25 ** 2, 0.16 ** 2, 0.12 ** 2])
    # sqrt(sigma)/g^2 = beta s / 4 = 0.375, 0.36, 0.36: quadratic through the three points at
    # x = 1/6, 1/9, 1/12 = (6, 4, 3)/36.  Lagrange weights at x = 0:
    #   w1 = 4*3/((6-4)(6-3)) = 2,  w2 = 6*3/((4-6)(4-3)) = -9,  w3 = 6*4/((3-6)(3-4)) = 8
    g = summ["scaling_d3"]["sqrt_sigma_over_g2"]["primary"]["R5"]
    assert [q["y"] for q in g["points"]] == pytest.approx([0.375, 0.36, 0.36])
    assert g["fit_quadratic_in_1_over_beta"]["intercept"] == pytest.approx(
        2 * 0.375 - 9 * 0.36 + 8 * 0.36, abs=1e-8)
    # straight line in 1/beta through the same three points (errors beta*s_err/4 = 1.5e-3,
    # 2.25e-3, 3e-3) must agree with an independent numpy.polyfit
    xs = np.array([1 / 6, 1 / 9, 1 / 12])
    sl, ic = np.polyfit(xs, [0.375, 0.36, 0.36], 1, w=1 / np.array([1.5e-3, 2.25e-3, 3e-3]))
    assert g["fit_linear_in_1_over_beta"]["intercept"] == pytest.approx(ic, rel=1e-9)
    assert g["fit_linear_in_1_over_beta"]["slope"] == pytest.approx(sl, rel=1e-9)

    # --- D = 4: m/sqrt(sigma) = 3.5 exactly -> constant fit acceptable and reported
    blk = summ["scaling_d4"]["sets"]["all_data"]["R5"]
    assert blk["fit_constant"]["extrapolation_reported"] is True
    assert blk["fit_constant"]["value"] == pytest.approx(3.5, abs=1e-9)
    assert blk["fit_linear"]["intercept"] == pytest.approx(3.5, abs=1e-7)
    assert "why_not_trusted" in blk["fit_linear"]
    assert [d["diff"] for d in blk["drift"]] == pytest.approx([0.0, 0.0, 0.0], abs=1e-12)
    # lattice-spacing ratio from sqrt(sigma) against the two-loop ratio
    row = summ["scaling_d4"]["asymptotic_scaling"]["sets"]["primary"]["t1"][
        "lattice_spacing_ratios"][0]
    two = exact.a_lambda_two_loop(2.3) / exact.a_lambda_two_loop(2.4)
    assert row["two_loop"] == pytest.approx(two, rel=1e-13)
    assert row["from_sqrt_sigma"]["value"] == pytest.approx(0.36 / 0.26, rel=1e-13)
    assert row["from_sqrt_sigma"]["err"] == pytest.approx(
        0.36 / 0.26 * math.hypot(0.001 / 0.36, 0.001 / 0.26), rel=1e-12)
    assert row["from_sqrt_sigma"]["percent_above_two_loop"] == pytest.approx(
        100 * (0.36 / 0.26 / two - 1), rel=1e-10)

    # --- replication: d3_b9.0_L24r has a*m higher by 0.03 with errors 0.01 on both sides
    rep = summ["replication"][0]
    assert (rep["A"], rep["B"]) == ("d3_b9.0_L24", "d3_b9.0_L24r")
    row = next(r for r in rep["rows"] if r["key"] == "am" and r["variant"] == "t1")
    assert row["diff"] == pytest.approx(-0.03, abs=1e-12)
    assert row["sigma"] == pytest.approx(-0.03 / math.hypot(0.01, 0.01), rel=1e-10)
    # --- finite volume: the 24^3 torelon has no plateau -> no R5 significance, but t1 has one
    fv = summ["finite_volume"][0]
    r5 = next(r for r in fv["rows"] if r["key"] == "a_sqrt_sigma" and r["variant"] == "R5")
    t1 = next(r for r in fv["rows"] if r["key"] == "a_sqrt_sigma" and r["variant"] == "t1")
    assert r5["sigma"] is None and r5["both_measurements"] is False
    assert t1["sigma"] == pytest.approx(0.0, abs=1e-12)
    assert not any(r["key"] == "aE_torelon" for r in fv["rows"])     # different L: not compared

    # --- literature: rows, matching by lattice size, pulls and counts
    rows = summ["literature_comparison"]["rows"]
    r16 = [r for r in rows if r["ensemble"] == "d3_b6.0_L16" and r["quantity"] == "a*sqrt(sigma)"]
    assert [r["lit_lattice_L"] for r in r16] == [16, 24]
    assert [r["matched"] for r in r16] == [True, False]
    # ours 0.25 +- 0.001 against 0.2530 +- 0.0012: pull = -0.003/sqrt(1e-6 + 1.44e-6)
    assert r16[0]["pull"]["t1"] == pytest.approx(-0.003 / math.sqrt(2.44e-6), rel=1e-9)
    # Luscher variant of ours is 0.249
    assert r16[0]["pull_luscher"]["t1"] == pytest.approx(-0.004 / math.sqrt(2.44e-6), rel=1e-9)
    r24 = [r for r in rows if r["ensemble"] == "d3_b6.0_L24" and r["quantity"] == "a*sqrt(sigma)"]
    assert [r["matched"] for r in r24] == [False, True]
    assert all(r["pull"]["R5"] is None for r in r24)                 # no plateau: no R5 pull
    plq = next(r for r in rows if r["quantity"] == "plaquette")
    assert plq["pull"]["R5"] == pytest.approx((0.6 - 0.61) / math.hypot(1e-5, 1e-3), rel=1e-9)
    cnt = summ["literature_comparison"]["counts"]["primary_ensembles"]["matched_entry_only"]
    # primary ensembles with a literature partner: d3_b6.0_L16 (a*sqrt(sigma): |pull| 1.92,
    # a*m: (4.825*0.25 - 1.2)/hypot(0.01, 0.02) = 0.28) and d4_b2.3_L10 (plaquette: |pull| 10.0)
    assert cnt["t1"]["n"] == 3 and cnt["t1"]["n_gt_2"] == 1 and cnt["t1"]["n_gt_3"] == 1
    assert cnt["t1"]["max_abs"] == pytest.approx(0.01 / math.hypot(1e-5, 1e-3), rel=1e-9)
    assert summ["literature_comparison"]["literature_entries_without_a_corresponding_measurement"] \
        == ["D4_SU2_wilson.plaquette.2.2", "D4_SU2_wilson.beta_c.4"]

    # --- headline: every item names its source
    assert len(summ["headline"]) >= 12
    assert all(h["id"] and h["source"].startswith("summary.json:") for h in summ["headline"])
    assert any("not a proof" in t for t in summ["limits"])


def test_missing_or_misnamed_pipeline_file_is_an_error(tmp_path):
    res = tmp_path / "results"
    lit_path = write_synthetic_results(res)
    (res / "d4_b2.5_L16x.json").unlink()
    with pytest.raises(FileNotFoundError):
        S.build_summary(str(res), str(lit_path))
    d = fake_pipeline("something_else", (16, 16, 16, 16), 2.5, 0.7, 0.19)
    (res / "d4_b2.5_L16x.json").write_text(json.dumps(d))
    with pytest.raises(ValueError):
        S.build_summary(str(res), str(lit_path))


# ----------------------------------------------------------------------------------------------
# the real pipeline output (skipped when it is not there)
# ----------------------------------------------------------------------------------------------
REAL = ROOT / "results"
HAVE_REAL = all((REAL / f"{n}.json").is_file() for n in S.TABLE_ORDER) \
    and (ROOT / "literature.json").is_file()


@pytest.mark.skipif(not HAVE_REAL, reason="pipeline output results/<ensemble>.json not present")
def test_real_results_are_reproduced_exactly_and_inputs_untouched(tmp_path):
    inputs = [REAL / f"{n}.json" for n in S.TABLE_ORDER] + [ROOT / "literature.json"]
    before = [hashlib.sha256(p.read_bytes()).hexdigest() for p in inputs]
    summ = S.build_summary(str(REAL), str(ROOT / "literature.json"))
    assert [hashlib.sha256(p.read_bytes()).hexdigest() for p in inputs] == before
    for n in S.TABLE_ORDER:
        d = json.loads((REAL / f"{n}.json").read_text())
        r = summ["ensembles"][n]
        assert r["am"]["R5"]["value"] == d["glueball"]["mass"]
        assert r["am"]["R5"]["err"] == d["glueball"]["err"]
        assert r["am"]["t1"]["value"] == d["glueball"]["fixed_t"]["t1"]["m"]
        assert r["am"]["t2"]["err"] == d["glueball"]["fixed_t"]["t2"]["err"]
        assert r["a_sqrt_sigma"]["R5"]["value"] == d["string_tension"]["nambu_goto"]["a_sqrt_sigma"]
        assert r["m_over_sqrt_sigma"]["R5"]["value"] == \
            d["ratios"]["m_over_sqrt_sigma"]["nambu_goto"]["value"]
        assert r["m_over_sqrt_sigma"]["R5"]["err"] == \
            d["ratios"]["m_over_sqrt_sigma"]["nambu_goto"]["err"]
        assert r["ratio_error_check"]["value_matches_pipeline"] is True
        assert r[f"D{r['D']}"]["matches_pipeline"] is True
        assert r["n_meas"] == d["n_meas_total"]
    # the independent "all data" set really is independent: no seed appears twice
    seeds = [(summ["ensembles"][n]["D"], summ["ensembles"][n]["beta"], tuple(
        summ["ensembles"][n]["shape"]), s) for n in S.INDEPENDENT_ALL
        for s in summ["ensembles"][n]["seeds"]]
    assert len(seeds) == len(set(seeds))
    # an independent recomputation of one fit with numpy.polyfit (weights 1/err)
    pts = summ["scaling_d3"]["sets"]["all_data"]["R5"]["points"]
    x = np.array([p["x"] for p in pts])
    y = np.array([p["y"] for p in pts])
    e = np.array([p["y_err"] for p in pts])
    slope, icpt = np.polyfit(x, y, 1, w=1.0 / e)
    fl = summ["scaling_d3"]["sets"]["all_data"]["R5"]["fit_linear"]
    assert fl["intercept"] == pytest.approx(icpt, rel=1e-9)
    assert fl["slope"] == pytest.approx(slope, rel=1e-7)
    assert fl["chi2"] == pytest.approx(float(np.sum(((y - icpt - slope * x) / e) ** 2)), rel=1e-7)
    assert all(h["source"].startswith("summary.json:") for h in summ["headline"])
    assert json.dumps(summ, allow_nan=False)                 # valid JSON, no NaN / inf


@pytest.mark.skipif(not HAVE_REAL, reason="pipeline output results/<ensemble>.json not present")
def test_figures_are_written_to_the_output_directory_only(tmp_path):
    def state():        # pipeline files and any earlier summary output in results/
        return {f: (os.stat(REAL / f).st_mtime_ns, os.stat(REAL / f).st_size)
                for f in os.listdir(REAL)
                if f.startswith("summary") or f[:-5] in S.TABLE_ORDER}
    before = state()
    assert S.main(["--results", str(REAL), "--literature", str(ROOT / "literature.json"),
                   "--outdir", str(tmp_path)]) == 0
    assert state() == before
    for f in ("summary.json", "summary.md", "summary_scaling_d3.png", "summary_scaling_d4.png",
              "summary_volume.png"):
        assert (tmp_path / f).stat().st_size > 1000
    assert S.TAGLINE_NL in (tmp_path / "summary.md").read_text()
