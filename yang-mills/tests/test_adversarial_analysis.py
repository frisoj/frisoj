"""Adversarial review of the measurement and analysis layer
(ym/observables.py, ym/stats.py, run_production.py, analyze.py).

Run from the project directory:

    python3 -m pytest -q tests/test_adversarial_analysis.py            # default set
    python3 -m pytest -q tests/test_adversarial_analysis.py -rP        # ... and print the numbers
    python3 -m pytest -q tests/test_adversarial_analysis.py --runslow  # plus the slow checks

Everything here was written by a reviewer who did NOT write the code under test, and every
reference implementation in this file is deliberately different from the production code:

* gauge links are explicit 2x2 complex matrices on a numpy grid U[x0, .., x_{D-1}, mu, 2, 2];
  neighbours come from coordinate arithmetic modulo the extents (a path walker that follows a
  loop link by link) or from numpy.roll, never from the engine's neighbour tables;
* correlators are evaluated from their definition with explicit loops;
* jackknife samples are obtained by literally deleting one bin and re-running the estimator;
* synthetic ensembles are built from a transfer-matrix-like spectral sum, so that the exact
  infinite-statistics answer of every pipeline output is known.

Rules followed in this file
---------------------------
* Statistical comparisons use fixed seeds and windows that were chosen before the test was run
  for the first time; where a window or a run length was changed after a first run this is
  stated in the docstring of the test together with the first-run numbers.
* A test that documents a DEFECT or a LIMITATION of the code under test says so in its name
  and docstring.  Checks that currently FAIL because of a real defect are left failing.
* Nothing in this file reads, writes or analyses anything under results/raw (production data).

These tests validate a Monte Carlo analysis code.  They are numerical checks of a program and
contain no evidence, let alone a proof, concerning the Yang-Mills mass-gap problem.
"""
import itertools
import json
import math
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import pytest

from ym import exact, stats
from ym.lattice import Lattice
from ym.observables import Measurer, measure, smear_spatial

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import analyze as analyze_mod          # noqa: E402
import run_production as rp            # noqa: E402


# ==============================================================================================
# independent reference implementation of the operators (2x2 complex matrices, coordinates)
# ==============================================================================================
def q_to_m(q):
    """Quaternion (a0, a1, a2, a3) -> a0 + i (a1 s1 + a2 s2 + a3 s3) with the Pauli matrices
    written out explicitly."""
    q = np.asarray(q, dtype=np.float64)
    s0 = np.eye(2, dtype=complex)
    s1 = np.array([[0, 1], [1, 0]], dtype=complex)
    s2 = np.array([[0, -1j], [1j, 0]], dtype=complex)
    s3 = np.array([[1, 0], [0, -1]], dtype=complex)
    return (q[..., 0, None, None] * s0 + 1j * (q[..., 1, None, None] * s1
                                               + q[..., 2, None, None] * s2
                                               + q[..., 3, None, None] * s3))


def m_to_q(m):
    """Inverse of q_to_m for (real multiples of) SU(2) matrices."""
    out = np.empty(m.shape[:-2] + (4,))
    out[..., 0] = m[..., 0, 0].real
    out[..., 3] = m[..., 0, 0].imag
    out[..., 2] = m[..., 0, 1].real
    out[..., 1] = m[..., 0, 1].imag
    return out


def grid_of(U, shape):
    """Engine field (V, D, 4) -> matrices on a grid, G[x0, .., x_{D-1}, mu, 2, 2]."""
    D = len(shape)
    return q_to_m(np.asarray(U).reshape(tuple(shape) + (D, 4)))


def field_of(G):
    """Grid of matrices -> engine layout (V, D, 4)."""
    D = G.ndim - 3
    V = int(np.prod(G.shape[:D]))
    return np.ascontiguousarray(m_to_q(G).reshape(V, D, 4))


def dag(a):
    return np.conj(np.swapaxes(a, -1, -2))


def at(F, mu, n=1):
    """Field F evaluated at x + n * mu_hat (periodic)."""
    return np.roll(F, -n, axis=mu)


def ref_ape_step(G, w):
    """One APE step straight from the formula in the task description / module docstring:
    U'_i(x) = P[ U_i(x) + w sum_{j != i spatial} ( U_j(x) U_i(x+j) U_j(x+i)^+
                                                   + U_j(x-j)^+ U_i(x-j) U_j(x-j+i) ) ],
    P = division by sqrt(det) (the sum is a real multiple of an SU(2) matrix)."""
    D = G.ndim - 3
    new = G.copy()
    for i in range(1, D):
        Ui = G[..., i, :, :]
        acc = np.zeros_like(Ui)
        for j in range(1, D):
            if j == i:
                continue
            Uj = G[..., j, :, :]
            acc += Uj @ at(Ui, j) @ dag(at(Uj, i))
            Ujm = at(Uj, j, -1)
            acc += dag(Ujm) @ at(Ui, j, -1) @ at(Ujm, i)
        M = Ui + w * acc
        det = (M[..., 0, 0] * M[..., 1, 1] - M[..., 0, 1] * M[..., 1, 0]).real
        new[..., i, :, :] = M / np.sqrt(det)[..., None, None]
    return new


def walk_loop(G, shape, x, steps):
    """Ordered product of links along a path starting at coordinate tuple x.
    steps: list of (mu, +1 | -1).  Pure coordinate arithmetic, one link at a time."""
    x = list(x)
    M = np.eye(2, dtype=complex)
    for mu, sgn in steps:
        if sgn > 0:
            M = M @ G[tuple(x) + (mu,)]
            x[mu] = (x[mu] + 1) % shape[mu]
        else:
            x[mu] = (x[mu] - 1) % shape[mu]
            M = M @ dag(G[tuple(x) + (mu,)])
    return M, tuple(x)


def ref_glue(G, shape, R, S):
    """glue[t] = sum_{x in slice t} sum_{spatial planes i<j} (1/2) Tr W_{RxS}(x), both
    orientations when R != S; by walking every loop link by link."""
    D = len(shape)
    out = np.zeros(shape[0])
    shapes = [(R, S)] if R == S else [(R, S), (S, R)]
    for x in itertools.product(*[range(n) for n in shape]):
        for i in range(1, D):
            for j in range(i + 1, D):
                for (a, b) in shapes:
                    steps = [(i, 1)] * a + [(j, 1)] * b + [(i, -1)] * a + [(j, -1)] * b
                    M, xe = walk_loop(G, shape, x, steps)
                    assert xe == tuple(x)                   # the loop closes
                    out[x[0]] += 0.5 * np.trace(M).real
    return out


def ref_torelon(G, shape, i):
    """torelon[t] = sum_{x_perp} (1/2) Tr prod_{n=0}^{L_i-1} U_i(t, x_perp, x_i = n)."""
    out = np.zeros(shape[0])
    for x in itertools.product(*[range(n) for n in shape]):
        if x[i] != 0:
            continue
        M, xe = walk_loop(G, shape, x, [(i, 1)] * shape[i])
        assert xe == tuple(x)                               # winds exactly once
        out[x[0]] += 0.5 * np.trace(M).real
    return out


def ref_plaq_slices(G, shape):
    D = len(shape)
    pt = np.zeros(shape[0])
    ps = np.zeros(shape[0])
    for x in itertools.product(*[range(n) for n in shape]):
        for mu in range(D):
            for nu in range(mu + 1, D):
                M, _ = walk_loop(G, shape, x, [(mu, 1), (nu, 1), (mu, -1), (nu, -1)])
                if mu == 0:
                    pt[x[0]] += 0.5 * np.trace(M).real
                else:
                    ps[x[0]] += 0.5 * np.trace(M).real
    return pt, ps


def thermal_lattice(shape, beta, seed, n=6):
    lat = Lattice(shape, beta, seed=seed)
    lat.hot_start()
    lat.update(1, 1)
    for _ in range(n - 1):
        lat.update(1, 1)
    return lat


OBS_CASES = [((4, 4, 6), 3.0, 71001, (0, 1, 3), ((1, 1), (2, 2), (1, 2))),
             ((6, 4, 4), 5.0, 71002, (0, 2, 5), ((1, 1), (2, 2))),
             ((4, 4, 4, 6), 2.2, 71003, (0, 1, 2), ((1, 1), (2, 2), (2, 1)))]


@pytest.mark.parametrize("shape,beta,seed,levels,loops", OBS_CASES)
def test_operators_against_link_by_link_path_walker(shape, beta, seed, levels, loops):
    """Every stored operator, at every smearing level, equals an independent evaluation
    (2x2 complex matrices, loops walked link by link with coordinate arithmetic, APE smearing
    with numpy.roll) to 1e-10.  Covers: spatial-only staples, Jacobi (simultaneous) update,
    time links untouched, loop closure across the periodic boundary (extent 4 with 2x2 loops),
    torelon winding exactly once, time axis = axis 0, D = 3 versus D = 4 plane counting."""
    w = 0.25
    lat = thermal_lattice(shape, beta, seed)
    U0 = lat.U.copy()
    r = measure(lat, levels, w, loops)
    assert np.array_equal(lat.U, U0)                       # measurement does not touch the field
    D = len(shape)
    T = shape[0]
    assert r["glue"].shape == (len(levels), len(loops), T)
    assert r["torelon"].shape == (D - 1, len(levels), T)

    G = grid_of(lat.U, shape)
    G0 = G.copy()
    done = 0
    worst = 0.0
    for k, lev in enumerate(levels):
        for _ in range(lev - done):
            G = ref_ape_step(G, w)
        done = lev
        # time links are untouched by any number of smearing steps
        assert np.array_equal(G[..., 0, :, :], G0[..., 0, :, :])
        # the engine's smeared field agrees with the reference field link by link
        Us = smear_spatial(lat, w, lev)
        assert np.max(np.abs(grid_of(Us, shape) - G)) < 1e-12
        assert np.array_equal(Us[:, 0], lat.U[:, 0])
        for l, (R, S) in enumerate(loops):
            ref = ref_glue(G, shape, R, S)
            worst = max(worst, float(np.max(np.abs(ref - r["glue"][k, l]))))
        for i in range(1, D):
            ref = ref_torelon(G, shape, i)
            worst = max(worst, float(np.max(np.abs(ref - r["torelon"][i - 1, k]))))
    pt, ps = ref_plaq_slices(G0, shape)
    worst = max(worst, float(np.max(np.abs(pt - r["plaq_t_slices"]))),
                float(np.max(np.abs(ps - r["plaq_s_slices"]))))
    V = int(np.prod(shape))
    n_t = V * (D - 1)
    n_s = V * (D - 1) * (D - 2) // 2
    assert abs(r["plaq_t"] - pt.sum() / n_t) < 1e-13
    assert abs(r["plaq_s"] - ps.sum() / n_s) < 1e-13
    assert abs(r["plaq"] - (pt.sum() + ps.sum()) / (n_t + n_s)) < 1e-13
    assert abs(r["plaq"] - lat.plaquette()) < 1e-13
    print("shape %r: max |engine - walker| over all operators = %.2e" % (shape, worst))
    assert worst < 1e-10


def test_smearing_is_jacobi_not_gauss_seidel():
    """A single APE step must use only OLD links.  A Gauss-Seidel (in-place) variant of the
    reference differs from the Jacobi reference by O(0.1) on a rough configuration, and the
    engine agrees with the Jacobi one to 1e-13 (so this test can tell the two apart)."""
    shape = (2, 4, 4)
    lat = thermal_lattice(shape, 3.0, 71010, n=3)
    G = grid_of(lat.U, shape)
    jac = ref_ape_step(G, 0.25)
    # in-place variant, direction 1 first, then direction 2 with the NEW direction-1 links
    gs = G.copy()
    for i in (1, 2):
        j = 3 - i
        Ui, Uj = gs[..., i, :, :], gs[..., j, :, :]
        acc = Uj @ at(Ui, j) @ dag(at(Uj, i))
        Ujm = at(Uj, j, -1)
        acc = acc + dag(Ujm) @ at(Ui, j, -1) @ at(Ujm, i)
        M = Ui + 0.25 * acc
        det = (M[..., 0, 0] * M[..., 1, 1] - M[..., 0, 1] * M[..., 1, 0]).real
        gs[..., i, :, :] = M / np.sqrt(det)[..., None, None]
    eng = grid_of(smear_spatial(lat, 0.25, 1), shape)
    d_jac = float(np.max(np.abs(eng - jac)))
    d_gs = float(np.max(np.abs(eng - gs)))
    print("engine vs Jacobi %.2e, engine vs Gauss-Seidel %.3f" % (d_jac, d_gs))
    assert d_jac < 1e-13
    assert d_gs > 1e-2


# ----------------------------------------------------------------------------------------------
# lattice symmetries (own transformation code acting on the grid of matrices)
# ----------------------------------------------------------------------------------------------
def permute_axes(G, perm):
    """Lattice rotation given by a permutation of the axes: the new axis a is the old axis
    perm[a];  U'_a(x') = U_{perm[a]}(x) with x'_a = x_{perm[a]}."""
    D = G.ndim - 3
    Gp = np.transpose(G, tuple(perm) + (D, D + 1, D + 2))
    return np.ascontiguousarray(Gp[..., list(perm), :, :])


def reflect_axis(G, a):
    """Reflection x_a -> -x_a:  U'_a(x') = U_a(R x' - a_hat)^+,  U'_b(x') = U_b(R x') (b != a)."""
    D = G.ndim - 3
    L = G.shape[a]
    idx = (-np.arange(L)) % L
    Gr = np.take(G, idx, axis=a)                    # field at R x'
    out = Gr.copy()
    idx2 = (-np.arange(L) - 1) % L                  # R x' - a_hat
    out[..., a, :, :] = dag(np.take(G, idx2, axis=a)[..., a, :, :])
    return out


def shift_field(G, a, n):
    """Translation: U'(x) = U(x + n a_hat)."""
    return np.roll(G, -n, axis=a)


SYM_CASES = [((4, 6, 6), 4.0, 71020, (0, 2, 5)),
             ((4, 4, 4, 4), 2.3, 71021, (0, 1, 3))]


@pytest.mark.parametrize("shape,beta,seed,levels", SYM_CASES)
def test_operators_are_scalars_under_the_cubic_group_and_translations(shape, beta, seed, levels):
    """Rotate / reflect / translate a thermalised configuration with independent code and
    re-measure: the 0++ operators must be invariant under every spatial axis permutation and
    reflection (together these generate the full cubic group including 90 degree rotations),
    the torelons must permute with the directions, a time reflection must map slice t to -t
    and a time translation must shift the slice index.  1x2 loops are included because their
    A1 combination is the one that is not automatically symmetric."""
    w = 0.25
    loops = ((1, 1), (2, 2), (1, 2))
    D = len(shape)
    T = shape[0]
    lat = thermal_lattice(shape, beta, seed)
    G = grid_of(lat.U, shape)
    base = measure(lat, levels, w, loops)
    other = Lattice(shape, beta, seed=1)
    worst = 0.0

    def remeasure(Gnew):
        other.U[...] = field_of(Gnew)
        assert other.unitarity_violation() < 1e-12
        return measure(other, levels, w, loops)

    # round trip of the conversion helpers themselves
    assert np.max(np.abs(field_of(G) - lat.U)) < 1e-15

    spatial = list(range(1, D))
    n_perm = 0
    for p in itertools.permutations(spatial):
        perm = (0,) + tuple(p)
        r = remeasure(permute_axes(G, perm))
        worst = max(worst, float(np.max(np.abs(r["glue"] - base["glue"]))))
        for a in spatial:                       # new direction a is the old direction perm[a]
            worst = max(worst, float(np.max(np.abs(r["torelon"][a - 1]
                                                   - base["torelon"][perm[a] - 1]))))
        worst = max(worst, abs(r["plaq"] - base["plaq"]))
        n_perm += 1
    for a in spatial:
        r = remeasure(reflect_axis(G, a))
        worst = max(worst, float(np.max(np.abs(r["glue"] - base["glue"]))),
                    float(np.max(np.abs(r["torelon"] - base["torelon"]))))
    # a genuine 90 degree rotation in the (1,2) plane: swap followed by a reflection
    perm = [0, 2, 1] + list(range(3, D))
    r = remeasure(reflect_axis(permute_axes(G, perm), 1))
    worst = max(worst, float(np.max(np.abs(r["glue"] - base["glue"]))),
                float(np.max(np.abs(r["torelon"][0] - base["torelon"][1]))),
                float(np.max(np.abs(r["torelon"][1] - base["torelon"][0]))))
    # spatial translation by an odd vector
    r = remeasure(shift_field(shift_field(G, 1, 1), D - 1, 3))
    worst = max(worst, float(np.max(np.abs(r["glue"] - base["glue"]))),
                float(np.max(np.abs(r["torelon"] - base["torelon"]))))
    # time translation by 1: slice t of the new field is slice t+1 of the old one
    r = remeasure(shift_field(G, 0, 1))
    for key in ("glue", "torelon", "plaq_t_slices", "plaq_s_slices"):
        worst = max(worst, float(np.max(np.abs(r[key] - np.roll(base[key], -1, axis=-1)))))
    # time reflection: slice t -> -t for the spatial operators; temporal plaquettes between
    # t and t+1 go to those between -t-1 and -t
    r = remeasure(reflect_axis(G, 0))
    idx = (-np.arange(T)) % T
    for key in ("glue", "torelon", "plaq_s_slices"):
        worst = max(worst, float(np.max(np.abs(r[key] - base[key][..., idx]))))
    worst = max(worst, float(np.max(np.abs(r["plaq_t_slices"]
                                           - base["plaq_t_slices"][(-np.arange(T) - 1) % T]))))
    print("shape %r: %d permutations, max violation of covariance %.2e" % (shape, n_perm, worst))
    assert worst < 1e-10
    # teeth: the operators are not trivially constant (slices and directions differ)
    assert np.std(base["glue"][-1, 1]) > 1e-3
    assert np.max(np.abs(base["torelon"][0] - base["torelon"][1])) > 1e-3


def test_torelon_is_charged_under_the_centre_and_glueball_is_not():
    """Multiplying all links U_i on ONE slice x_i = c by -1 (a centre transformation, a symmetry
    of the action) must flip the sign of every torelon winding direction i, at every smearing
    level, and leave the other torelons, all glueball operators and the plaquettes unchanged.
    This is what guarantees <torelon> = 0 and that torelon and glueball channels do not mix;
    it would fail if the line wound the lattice twice or not at all, or if smearing mixed
    time-like staples into the spatial links."""
    shape = (4, 4, 6, 4)
    levels = (0, 1, 4)
    lat = thermal_lattice(shape, 2.3, 71030)
    base = measure(lat, levels, 0.25)
    G = grid_of(lat.U, shape)
    for i in (1, 2, 3):
        Gc = G.copy()
        sl = [slice(None)] * 4
        sl[i] = 1
        Gc[tuple(sl) + (i,)] *= -1.0
        other = Lattice(shape, 2.3, seed=1)
        other.U[...] = field_of(Gc)
        r = measure(other, levels, 0.25)
        assert np.max(np.abs(r["glue"] - base["glue"])) < 1e-10
        assert abs(r["plaq"] - base["plaq"]) < 1e-13
        for j in (1, 2, 3):
            sign = -1.0 if j == i else 1.0
            assert np.max(np.abs(r["torelon"][j - 1] - sign * base["torelon"][j - 1])) < 1e-10
    # the same transformation applied to the TIME links must change nothing at all
    Gc = G.copy()
    Gc[1, ..., 0, :, :] *= -1.0
    other = Lattice(shape, 2.3, seed=1)
    other.U[...] = field_of(Gc)
    r = measure(other, levels, 0.25)
    for key in ("glue", "torelon", "plaq_t_slices", "plaq_s_slices"):
        assert np.max(np.abs(r[key] - base[key])) < 1e-10


# ==============================================================================================
# correlators and jackknife: definition + literal deletion of one bin
# ==============================================================================================
def _def_correlator(O, subtract):
    """Rule R1 from the definition, explicit loops.  O[n, g, k, t]."""
    N, G, K, T = O.shape
    C = np.zeros((K, K, T))
    for k in range(K):
        for l in range(K):
            for tau in range(T):
                acc = 0.0
                for t in range(T):
                    acc += np.sum(O[:, :, k, t] * O[:, :, l, (t + tau) % T])
                C[k, l, tau] = acc / (N * G * T)
    if subtract:
        for g in range(G):
            v = np.array([O[:, g, k, :].mean() for k in range(K)])
            C -= np.outer(v, v)[:, :, None] / G
    out = np.zeros((K, K, T // 2 + 1))
    for k in range(K):
        for l in range(K):
            for tau in range(T // 2 + 1):
                out[k, l, tau] = 0.25 * (C[k, l, tau] + C[l, k, tau]
                                         + C[k, l, (T - tau) % T] + C[l, k, (T - tau) % T])
    return out


def _asym_streams(rng, lengths, G, T, vev):
    """Operators with a deliberately asymmetric correlation structure (k <-> l and
    tau <-> T - tau are NOT symmetric before the R1 symmetrisation)."""
    streams = []
    for n in lengths:
        x = rng.standard_normal((n, G, T))
        y = rng.standard_normal((n, G, T))
        O = np.empty((n, G, 3, T))
        O[:, :, 0] = x + 0.5 * np.roll(x, 1, axis=-1)
        O[:, :, 1] = np.roll(x, -1, axis=-1) + 0.7 * y            # O_1(t) ~ x(t+1)
        O[:, :, 2] = np.roll(x, 2, axis=-1) - 0.4 * np.roll(y, -1, axis=-1) + 0.2 * x * y
        O += np.asarray(vev)[None, None, :, None]
        streams.append(O)
    return streams


@pytest.mark.parametrize("G,subtract", [(1, True), (3, False), (2, True)])
def test_correlator_and_jackknife_by_literal_bin_deletion(G, subtract):
    """analyze_channel's correlator matrix and EVERY jackknife sample of it equal the
    definition (rule R1) evaluated with explicit loops on the data with one bin literally
    deleted: vacuum subtraction inside the jackknife, periodic wrap in time, symmetrisation,
    bins formed within each stream, leftovers dropped from the START of each stream, streams
    pooled, G equivalent copies averaged.  (G=1, subtract) is the glueball case, (G=3, no
    subtraction) the D=4 torelon case."""
    rng = np.random.default_rng(72001 + G)
    T, B = 8, 5
    lengths = (23, 17, 11)
    vev = [30.0, -12.0, 7.0] if subtract else [0.0, 0.0, 0.0]
    streams = _asym_streams(rng, lengths, G, T, vev)
    r = stats.analyze_channel(streams, T, B, subtract_vev=subtract, do_fit=False)
    kept = [s[s.shape[0] % B:] for s in streams]              # drop from the start
    allk = np.concatenate(kept)
    nb = allk.shape[0] // B
    assert r["n_bins"] == nb == sum(n // B for n in lengths)
    assert r["n_used"] == nb * B and r["n_dropped"] == sum(n % B for n in lengths)
    C = _def_correlator(allk, subtract)
    scale = np.max(np.abs(C))
    d_full = float(np.max(np.abs(r["C"] - C))) / scale
    d_jk = 0.0
    for b in range(nb):
        rest = np.concatenate([allk[:b * B], allk[(b + 1) * B:]])
        d_jk = max(d_jk, float(np.max(np.abs(r["C_jk"][b] - _def_correlator(rest, subtract)))))
    d_jk /= scale
    # the asymmetry before symmetrisation is real (teeth for the symmetrisation part)
    raw01 = np.mean(allk[:, :, 0, :] * np.roll(allk[:, :, 1, :], -1, axis=-1))
    raw10 = np.mean(allk[:, :, 1, :] * np.roll(allk[:, :, 0, :], -1, axis=-1))
    print("G=%d subtract=%s: rel. dev. full %.1e, jackknife samples %.1e; asymmetry %.2f"
          % (G, subtract, d_full, d_jk, abs(raw01 - raw10)))
    assert d_full < 1e-11 and d_jk < 1e-11
    assert abs(raw01 - raw10) > 0.3
    # vacuum expectation values reported per copy
    for g in range(G):
        for k in range(3):
            assert abs(r["vev"][g, k] - allk[:, g, k, :].mean()) < 1e-10


def test_vacuum_subtraction_outside_the_jackknife_would_be_detected():
    """Teeth for the previous test and a statement about error bars: if the disconnected part
    were subtracted with the FULL-sample <O> in every jackknife sample (subtraction outside
    the jackknife), the jackknife error of C(tau) at large tau would come out too LARGE by a
    big factor for an operator with a large vacuum expectation value; the implemented
    (inside) version reproduces the true scatter of the estimator over independent replicas."""
    rng = np.random.default_rng(72010)
    T, N, B, reps = 8, 400, 4, 200
    vev = 25.0
    tau = 3
    est = np.empty(reps)
    err_in = np.empty(reps)
    err_out = np.empty(reps)
    for i in range(reps):
        O = vev + rng.standard_normal((N, 1, T))
        A, Vb = stats.correlator_bins(O, B)
        C, Cjk = stats.jackknife_correlators(A, Vb, subtract=True)
        est[i] = C[0, 0, tau]
        err_in[i] = stats.jackknife_error(Cjk[:, 0, 0, tau])
        # "outside": jackknife of <OO> only, constant full-sample <O>^2 subtracted
        Craw, Crawjk = stats.jackknife_correlators(A, None, subtract=False)
        err_out[i] = stats.jackknife_error(Crawjk[:, 0, 0, tau])
    true_scatter = float(np.std(est, ddof=1))
    print("true scatter %.5f, <jk err inside> %.5f, <jk err outside> %.5f"
          % (true_scatter, err_in.mean(), err_out.mean()))
    assert abs(err_in.mean() / true_scatter - 1.0) < 0.15       # 200 replicas: 5 % accuracy
    assert err_out.mean() / true_scatter > 20.0


# ==============================================================================================
# GEVP
# ==============================================================================================
def _spectral_C(T, masses, amps):
    """C[k, l, tau] = sum_n amps[k, n] amps[l, n] cosh(m_n (tau - T/2)) / cosh(m_n T/2)."""
    amps = np.asarray(amps, dtype=np.float64)
    tau = np.arange(T // 2 + 1)
    C = np.zeros((amps.shape[0], amps.shape[0], tau.size))
    for n, m in enumerate(masses):
        C += (np.outer(amps[:, n], amps[:, n])[:, :, None]
              * (np.cosh(m * (tau - T / 2.0)) / np.cosh(m * T / 2.0))[None, None, :])
    return C


def test_gevp_is_the_generalised_problem_with_the_largest_eigenvalue():
    """Strongly non-orthogonal operators with an exactly known spectrum (as many states as
    operators): the projected correlator must be the pure ground state, so the cosh effective
    mass equals m_0 at EVERY t, and all eigenvalues equal cosh(m_n (1 - T/2)) / cosh(m_n T/2).
    The ordinary eigenvalue problem of C(1), and the smallest generalised eigenvalue, give
    clearly different numbers (teeth).  Cross-checked against scipy.linalg.eig (general,
    non-symmetric solver)."""
    from scipy import linalg
    T = 24
    masses = [0.35, 0.9, 1.6]
    amps = np.array([[1.0, 2.0, 0.7], [1.0, 1.6, -0.5], [0.4, 1.0, 1.0]])
    C = _spectral_C(T, masses, amps)
    Cjk = np.stack([C, C])                                   # dummy jackknife samples
    g = stats.gevp_project(C, Cjk, t0=0, min_eig=1e-6)
    assert sorted(g["selected"]) == [0, 1, 2]
    lam_exact = np.array([np.cosh(m * (1 - T / 2.0)) / np.cosh(m * T / 2.0) for m in masses])
    assert np.max(np.abs(g["eigenvalues"] - lam_exact)) < 1e-9          # decreasing order
    me = stats.effective_masses(g["Cproj"], g["Cproj_jk"], T)
    dev = float(np.max(np.abs(me["m_cosh"] - masses[0])))
    # independent general eigen-solver on the un-normalised matrices
    w, v = linalg.eig(C[:, :, 1], C[:, :, 0])
    assert np.max(np.abs(w.imag)) < 1e-12
    assert np.max(np.abs(np.sort(w.real)[::-1] - lam_exact)) < 1e-9
    # ordinary eigenproblem of C(1): its top eigenvector does NOT project on the ground state
    w1, v1 = np.linalg.eigh(C[:, :, 1])
    vo = v1[:, -1]
    c_ord = np.einsum("k,klt,l->t", vo, C, vo)
    m_ord = stats.cosh_effective_mass(c_ord[:-1], c_ord[1:], np.arange(T // 2), T)
    print("GEVP: max |m_eff(t) - m0| = %.1e over t = 0..%d; ordinary eigenproblem m_eff(0..2) = %s"
          % (dev, T // 2 - 1, np.round(m_ord[:3], 4)))
    assert dev < 1e-8
    assert abs(m_ord[0] - masses[0]) > 0.1 and abs(m_ord[1] - masses[0]) > 0.05
    # a duplicated operator (exactly degenerate basis) is dropped by rule R2, nothing breaks
    amps4 = np.vstack([amps, amps[1]])
    C4 = _spectral_C(T, masses, amps4)
    g4 = stats.gevp_project(C4, np.stack([C4, C4]), t0=0, min_eig=stats.MIN_EIG)
    assert len(g4["selected"]) <= 3 and g4["n_fallback"] == 0
    assert not (1 in g4["selected"] and 3 in g4["selected"])


def test_mass_jackknife_samples_equal_a_literal_leave_one_bin_out_reanalysis():
    """The jackknife samples of the final mass (which give its error and enter the error of
    m / sqrt(sigma)) are reproduced by literally deleting one bin of configurations and redoing
    the whole chain with independent code: correlator from the definition, vacuum subtraction
    with the reduced sample's own mean, general (non-symmetric) eigen-solver for the GEVP on
    the operator subset selected on the full sample, largest eigenvalue, projected correlator,
    cosh mass at the full-sample t* by a root finder."""
    from scipy import linalg
    from scipy.optimize import brentq
    rng = np.random.default_rng(72015)
    T, B = 8, 6
    masses, amps = [0.45, 1.4], np.array([[1.0, 0.8], [0.7, -0.6], [0.9, 0.3]])
    streams = [synth_channel(rng, n, T, masses, amps, [20.0, -5.0, 9.0], 0.35, 0.3)[:, None]
               for n in (150, 97)]
    r = stats.analyze_channel(streams, T, B, subtract_vev=True, do_fit=False)
    sel = r["gevp"]["selected"]
    tv = r["plateau"]["t_value"]
    assert tv is not None and len(sel) >= 2
    allk = np.concatenate([x[x.shape[0] % B:] for x in streams])
    nb = allk.shape[0] // B

    def chain(data):
        C = _def_correlator(data, True)[np.ix_(sel, sel)]
        w, v = linalg.eig(C[:, :, 1], C[:, :, 0])
        v0 = v[:, int(np.argmax(w.real))].real
        cp = np.einsum("k,klt,l->t", v0, C, v0)
        a, b = T / 2.0 - tv, T / 2.0 - tv - 1
        return brentq(lambda m: math.cosh(m * a) / math.cosh(m * b) - cp[tv] / cp[tv + 1],
                      1e-9, 20.0, xtol=1e-14)

    assert abs(chain(allk) - r["mass"]) < 1e-9
    worst = 0.0
    mj = np.empty(nb)
    for b in range(nb):
        mj[b] = chain(np.concatenate([allk[:b * B], allk[(b + 1) * B:]]))
        worst = max(worst, abs(mj[b] - r["mass_jk"][b]))
    err = math.sqrt((nb - 1.0) / nb * np.sum((mj - mj.mean()) ** 2))
    print("t* = %d, mass %.5f +- %.5f; max |literal - pipeline| over %d jackknife samples %.1e"
          % (tv, r["mass"], r["err"], nb, worst))
    assert worst < 1e-9 and abs(err - r["err"]) < 1e-9


def test_operator_selection_rule_on_a_handcrafted_matrix():
    """Rule R2 on a matrix whose answer can be worked out by hand: three unit-normalised
    operators with pair correlations r01 = 0.985 (allowed: eigenvalues 1 +- 0.985 >= 0.01),
    r02 = 0.995 (not allowed with operator 0: 1 - 0.995 = 0.005 < 0.01).  Ranking by
    C(1)/C(0): operator 0 (0.50) > operator 2 (0.45) > operator 1 (0.40).  Hence: 0 accepted,
    2 dropped (min eigenvalue 0.005), 1 accepted."""
    C = np.zeros((3, 3, 3))
    r = {(0, 1): 0.985, (0, 2): 0.995, (1, 2): 0.98}
    C[:, :, 0] = np.eye(3)
    for (a, b), v in r.items():
        C[a, b, 0] = C[b, a, 0] = v
    q = [0.50, 0.40, 0.45]
    C[:, :, 1] = np.diag(q)
    C[:, :, 2] = np.diag(np.square(q))
    # rescale the operators arbitrarily: the rule must be invariant under normalisation
    s = np.array([3.0, 0.01, 200.0])
    C = C * np.outer(s, s)[:, :, None]
    sel, info = stats.select_operators(C, t0=0, min_eig=stats.MIN_EIG)
    assert info["ranking"] == [0, 2, 1]
    assert sel == [0, 1]
    assert "dropped" in info["decisions"][2] and "0.005" in info["decisions"][2]
    # an operator with a non-positive C(1) is discarded outright (rule R2 a)
    C2 = C.copy()
    C2[0, 0, 1] = -1e-9
    sel2, info2 = stats.select_operators(C2, t0=0, min_eig=stats.MIN_EIG)
    assert 0 not in sel2 and "discarded" in info2["decisions"][0]


def test_gevp_optimisation_bias_is_small_at_production_like_statistics():
    """The GEVP vector is optimised on the same noisy C(0), C(1) that enter m_eff(0), which
    biases the largest eigenvalue upwards (m_eff(0) downwards) at O(1/N).  Measured here on
    synthetic data with as many states as operators (exact answer m_0 at every t): 400
    replicas of 2000 independent configurations (production streams have > 10 times more).
    The mean pull of m_eff(0) and m_eff(1) must be compatible with zero within 0.25 sigma
    (statistical accuracy of the mean pull: 0.05), i.e. no bias relevant at the level of the
    quoted error; the rms pulls must be 1 within 12 % (correct fixed-t jackknife errors)."""
    rng = np.random.default_rng(72020)
    T, N, B, reps = 16, 2000, 10, 400
    masses = [0.6, 1.5]
    amps = np.array([[1.0, 0.9], [0.9, -0.5], [0.7, 0.3]])       # 3 operators, 2 states + noise
    eps = 0.3
    chol = [np.linalg.cholesky(_ring_cov(T, m) + 1e-13 * np.eye(T)) for m in masses]
    # exact infinite-statistics value of m_eff(t) of this operator basis (white noise acts
    # like an infinitely heavy state at tau = 0, so m_eff(0) != m_0 but is known exactly)
    Cex = _spectral_C(T, masses, amps)
    Cex[:, :, 0] += eps ** 2 * np.eye(3)
    gex = stats.gevp_project(Cex, np.stack([Cex, Cex]))
    mex = stats.effective_masses(gex["Cproj"], gex["Cproj_jk"], T)["m_cosh"]
    pulls = np.empty((reps, 2))
    for i in range(reps):
        phi = np.stack([rng.standard_normal((N, T)) @ c.T for c in chol], axis=1)   # (N, 2, T)
        O = np.einsum("ka,nat->nkt", amps, phi) + eps * rng.standard_normal((N, 3, T)) + 50.0
        r = stats.analyze_channel(O, T, B, subtract_vev=True, do_fit=False)
        me = r["meff"]
        pulls[i] = (me["m_cosh"][:2] - mex[:2]) / me["err_cosh"][:2]
    mean = pulls.mean(axis=0)
    rms = np.sqrt((pulls ** 2).mean(axis=0))
    print("exact m_eff(0), m_eff(1) = %.5f, %.5f (m0 = %.2f)" % (mex[0], mex[1], masses[0]))
    print("mean pull t=0: %+.3f, t=1: %+.3f (+-0.05); rms pull t=0: %.3f, t=1: %.3f"
          % (mean[0], mean[1], rms[0], rms[1]))
    assert np.all(np.abs(mean) < 0.25)
    assert np.all(np.abs(rms - 1.0) < 0.12)


def _ring_cov(T, m):
    """Covariance matrix of a Gaussian field on a periodic ring of T sites with correlator
    cosh(m (tau - T/2)) / cosh(m T/2) (positive definite: its Fourier transform is the lattice
    propagator)."""
    c = np.cosh(m * (np.arange(T) - T / 2.0)) / np.cosh(m * T / 2.0)
    return np.array([[c[(i - j) % T] for j in range(T)] for i in range(T)])


# ==============================================================================================
# effective mass and plateau rule
# ==============================================================================================
def test_cosh_effective_mass_against_root_finder_including_the_midpoint():
    """Rule R4 against scipy's brentq on the defining equation, for random correlator ratios,
    all t up to T/2 - 1 (where cosh(m (t+1-T/2)) = 1), tiny and huge masses, and the undefined
    cases (non-positive or non-decreasing correlator -> NaN, never a number)."""
    from scipy.optimize import brentq
    rng = np.random.default_rng(72030)
    worst = 0.0
    for T in (4, 12, 16, 32):
        for t in range(T // 2):
            for _ in range(25):
                m = float(np.exp(rng.uniform(np.log(1e-3), np.log(30.0))))
                a, b = T / 2.0 - t, T / 2.0 - t - 1
                # log of the ratio computed stably
                lr = (m * a + np.log1p(np.exp(-2 * m * a))) - (m * b + np.log1p(np.exp(-2 * m * b)))
                c1 = float(np.exp(rng.uniform(-20, 5)))
                c0 = c1 * math.exp(lr)
                got = stats.cosh_effective_mass(c0, c1, t, T)

                def f(x):
                    return ((x * a + np.log1p(np.exp(-2 * x * a)))
                            - (x * b + np.log1p(np.exp(-2 * x * b))) - math.log(c0 / c1))
                ref = brentq(f, 0.0, lr + 1.0, xtol=1e-15, rtol=1e-15)
                worst = max(worst, abs(got - ref) / max(ref, 1e-300))
                assert abs(got - ref) <= 1e-9 * max(1.0, ref)
    print("max relative deviation from brentq: %.1e" % worst)
    T = 16
    assert math.isnan(stats.cosh_effective_mass(1.0, 1.0, 3, T))        # flat
    assert math.isnan(stats.cosh_effective_mass(1.0, 1.1, 3, T))        # rising
    assert math.isnan(stats.cosh_effective_mass(1.0, -0.1, 3, T))       # negative
    assert math.isnan(stats.cosh_effective_mass(-1.0, -2.0, 3, T))      # both negative
    assert math.isnan(stats.cosh_effective_mass(0.0, 0.0, 3, T))
    assert math.isnan(stats.cosh_effective_mass(float("nan"), 1.0, 3, T))
    # array form used by the pipeline, including the last t
    m = 0.37
    tt = np.arange(T // 2 + 1)
    c = np.cosh(m * (tt - T / 2.0))
    got = stats.cosh_effective_mass(c[:-1], c[1:], np.arange(T // 2), T)
    assert np.max(np.abs(got - m)) < 1e-11
    # for a pure cosh the plain log-ratio underestimates m (strongly so near the midpoint,
    # where the backward-propagating part is as large as the forward one): cosh mass > log mass
    lg = stats.log_effective_mass(c[:-1], c[1:])
    assert np.all(got > lg) and (got[-1] - lg[-1]) > 0.3


def _fake_jk(m, e, nb=40, seed=0):
    """Jackknife samples m_jk[b, t] whose jackknife error is exactly e[t], with fluctuations
    that are exactly uncorrelated between different t (orthogonal patterns), so that the
    jackknife error of m[t] - m[t+1] is exactly sqrt(e[t]^2 + e[t+1]^2)."""
    m = np.asarray(m, dtype=np.float64)
    e = np.asarray(e, dtype=np.float64)
    nt = m.size
    rng = np.random.default_rng(seed)
    Z = rng.standard_normal((nb, nt))
    Z -= Z.mean(axis=0)
    Qm, _ = np.linalg.qr(Z)                           # orthonormal, zero-mean columns
    # jackknife error = sqrt((nb-1)/nb * sum d^2)  ->  d = e * sqrt(nb/(nb-1)) * column
    return m[None, :] + Qm * (e * math.sqrt(nb / (nb - 1.0)))[None, :]


def test_plateau_rule_on_handcrafted_inputs():
    """Rule R5 exactly as written in ym/stats.py, on inputs whose jackknife errors are exact
    by construction (see _fake_jk)."""
    def run(m, e):
        mj = _fake_jk(m, e)
        assert np.allclose(stats.jackknife_error(mj), e, rtol=1e-12)
        return stats.plateau_rule(np.asarray(m, float), mj)

    e = [0.01, 0.02, 0.03, 0.05, 0.08, 0.10, 0.2, 0.3]
    s12 = math.hypot(0.02, 0.03)
    # (i) boundary: |m1 - m2| = 0.99 sigma_diff -> t* = 1;  1.01 sigma_diff -> not t* = 1
    r = run([1.3, 1.0, 1.0 - 0.99 * s12, 0.9, 0.9, 0.9, 0.9, 0.9], e)
    assert r["flag"] == "plateau" and r["t_star"] == 1 and r["plateau"] is True
    assert r["mass"] == 1.0 and abs(r["err"] - 0.02) < 1e-12 and r["upper_bound_only"] is False
    assert abs(r["checks"][0]["diff_err"] - s12) < 1e-12
    r = run([1.3, 1.0, 1.0 - 1.01 * s12, 1.0 - 1.01 * s12, 0.9, 0.9, 0.9, 0.9], e)
    assert r["t_star"] == 2 and abs(r["mass"] - (1.0 - 1.01 * s12)) < 1e-15
    assert abs(r["err"] - 0.03) < 1e-12
    # the sign of the difference does not matter (a RISING effective mass also passes/fails)
    r = run([1.3, 1.0, 1.0 + 1.01 * s12, 1.0 + 1.01 * s12, 0.9, 0.9, 0.9, 0.9], e)
    assert r["t_star"] == 2
    # t = 0 is never selected even if m(0) = m(1) exactly
    r = run([1.0, 1.0, 1.2, 1.2, 0.9, 0.9, 0.9, 0.9], e)
    assert r["t_star"] == 2 and r["mass"] == 1.2
    # (ii) relative error of m(t+1): 24.9 % passes, 25.1 % fails -> the search moves on / ends
    r = run([1.3, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0], [0.01, 0.02, 0.249, 0.5, 0.5, 0.5, 0.5, 0.5])
    assert r["t_star"] == 1
    r = run([1.3, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0], [0.01, 0.02, 0.251, 0.5, 0.5, 0.5, 0.5, 0.5])
    assert r["flag"] == "no plateau" and r["t_star"] is None and r["upper_bound_only"] is True
    # fallback value: last t of the INITIAL run with relative error < 25 %  (here t = 1)
    assert r["t_value"] == 1 and r["mass"] == 1.0 and abs(r["err"] - 0.02) < 1e-12
    # (ii) uses the error of m(t+1), not of m(t): m(1) may be imprecise if m(2) is precise
    r = run([1.3, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0], [0.01, 0.4, 0.01, 0.5, 0.5, 0.5, 0.5, 0.5])
    assert r["t_star"] == 1 and abs(r["err"] - 0.4) < 1e-12
    # the search ends at t = T/2 - 2: agreement only between the last two points is still found
    nt = 6
    m = [2.0, 1.8, 1.6, 1.4, 1.2, 1.2]
    r = run(m, [0.001] * nt)
    assert r["t_star"] == nt - 2 and len(r["checks"]) == nt - 2
    # no agreement anywhere: 'no plateau', value = m_eff at the last precise t, upper bound only
    r = run([2.0, 1.8, 1.6, 1.4, 1.2, 1.0], [0.001, 0.001, 0.001, 0.001, 0.5, 0.5])
    assert r["flag"] == "no plateau" and r["t_value"] == 3 and r["mass"] == 1.4
    # m_eff(0) itself imprecise: 'no signal', no number
    r = run([2.0, 1.8, 1.6, 1.4, 1.2, 1.0], [0.6, 0.6, 0.6, 0.6, 0.6, 0.6])
    assert r["flag"] == "no signal" and r["t_value"] is None and math.isnan(r["mass"])
    assert r["mass_jk"] is None and r["upper_bound_only"] is False
    # an effective mass that is undefined in ONE jackknife sample has an infinite error (R4):
    # it can neither be t*+1 nor pass the agreement test
    m = [1.3, 1.0, 1.0, 1.0, 1.0, 1.0]
    mj = _fake_jk(m, [0.01, 0.02, 0.02, 0.02, 0.02, 0.02])
    mj[7, 2] = np.nan
    r = stats.plateau_rule(np.array(m), mj)
    assert r["t_star"] == 3 and r["checks"][0]["agree"] is False
    assert r["checks"][1]["agree"] is False          # t = 2 itself has an undefined difference
    # NaN central value at t+1
    m = [1.3, 1.0, float("nan"), 1.0, 1.0, 1.0]
    mj = _fake_jk([1.3, 1.0, 1.0, 1.0, 1.0, 1.0], [0.01, 0.02, 0.02, 0.02, 0.02, 0.02])
    r = stats.plateau_rule(np.array(m), mj)
    assert r["t_star"] == 3
    # the returned jackknife samples are those of t* (needed for the error of m/sqrt(sigma))
    assert np.array_equal(r["mass_jk"], mj[:, 3])


def test_string_tension_inversions_round_trip_and_d2():
    """Rule R7: both inversion formulas against a numerical root finder on the forward
    formulas E(sigma), for the production geometries; D = 2 has no correction (sigma = E / L);
    the Luescher formula is the large-L expansion of Nambu-Goto (difference O(1/L^3))."""
    from scipy.optimize import brentq
    for D, L, sig in [(3, 16, 0.0644), (3, 24, 0.0263), (3, 32, 0.0139), (4, 10, 0.1358),
                      (4, 12, 0.0714), (4, 16, 0.0354), (2, 4, 0.27), (4, 6, 0.3)]:
        c = math.pi * (D - 2)
        E_l = sig * L - c / (6.0 * L)
        E_ng = sig * L * math.sqrt(1.0 - c / (3.0 * sig * L * L))
        assert abs(stats.sigma_luscher(E_l, L, D) - sig) < 1e-14
        assert abs(stats.sigma_nambu_goto(E_ng, L, D) - sig) < 1e-14
        assert abs(stats.torelon_energy_luscher(sig, L, D) - E_l) < 1e-14
        assert abs(stats.torelon_energy_nambu_goto(sig, L, D) - E_ng) < 1e-14
        # independent numerical inversion of the forward formulas at a common energy
        E = 0.9 * E_l
        s_l = brentq(lambda s: s * L - c / (6.0 * L) - E, 1e-6, 10.0, xtol=1e-15)
        s_n = brentq(lambda s: s * L * math.sqrt(max(1.0 - c / (3.0 * s * L * L), 0.0)) - E,
                     c / (3.0 * L * L) + 1e-12, 10.0, xtol=1e-15)
        assert abs(stats.sigma_luscher(E, L, D) - s_l) < 1e-12
        assert abs(stats.sigma_nambu_goto(E, L, D) - s_n) < 1e-12
        if D == 2:
            assert stats.sigma_luscher(E, L, D) == E / L
            assert abs(stats.sigma_nambu_goto(E, L, D) - E / L) < 1e-15
        else:
            # NG - Luescher = c^2 / (72 sigma L^4) + ... > 0 and small
            d = stats.sigma_nambu_goto(E_l, L, D) - sig
            assert 0.0 < d < 1.5 * c * c / (72.0 * sig * L ** 4) + 1e-12
    # arrays (the jackknife samples are passed as arrays by analyze.py)
    Ej = np.array([0.5, 0.6, 0.7])
    assert np.allclose(stats.sigma_luscher(Ej, 12, 4), (Ej + math.pi * 2 / 72.0) / 12.0)


# ==============================================================================================
# synthetic raw ensembles with an exactly known spectrum, pushed through analyze.py
# ==============================================================================================
def _ar1_field(rng, N, chol, rho):
    """(N, T) Gaussian vectors with equal-time covariance chol chol^T, AR(1) in Monte Carlo
    time with coefficient rho (explicit recursion, stationary from the first entry)."""
    xi = rng.standard_normal((N, chol.shape[0])) @ chol.T
    if rho == 0.0:
        return xi
    out = np.empty_like(xi)
    s = math.sqrt(1.0 - rho * rho)
    cur = xi[0]
    out[0] = cur
    for n in range(1, N):
        cur = rho * cur + s * xi[n]
        out[n] = cur
    return out


def synth_channel(rng, N, T, masses, amps, vev, eps, rho):
    """O[n, k, t] = vev_k + sum_a amps[k, a] phi_a(t) + eps * white noise; the exact connected
    correlator is _spectral_C(T, masses, amps) (+ eps^2 at tau = 0)."""
    amps = np.asarray(amps, dtype=np.float64)
    K, S = amps.shape
    O = np.zeros((N, K, T))
    for a in range(S):
        chol = np.linalg.cholesky(_ring_cov(T, masses[a]) + 1e-13 * np.eye(T))
        O += amps[:, a][None, :, None] * _ar1_field(rng, N, chol, rho)[:, None, :]
    if eps > 0.0:
        O += eps * rng.standard_normal(O.shape)
    return O + np.asarray(vev, dtype=np.float64)[None, :, None]


def write_synth_raw(path, shape, beta, seed, glue, torelon, levels, loops, start="hot",
                    plaq=None):
    """A raw file in the format of run_production.py ('ym-raw-1') holding synthetic operators."""
    shape = [int(x) for x in shape]
    T = shape[0]
    n = torelon.shape[0]
    if plaq is None:
        plaq = 0.6 + 1e-3 * np.random.default_rng(seed + 7).standard_normal(n)
    meta = {"format": "ym-raw-1", "shape": shape, "beta": float(beta), "seed": int(seed),
            "start": start, "ntherm": 10, "ntherm_done": 10, "nhb": 1, "nor": 4, "nskip": 1,
            "levels": [int(x) for x in levels], "w": 0.25, "loops": [list(x) for x in loops],
            "D": len(shape), "T": T, "nmeas_requested": n, "nmeas_done": n, "complete": True,
            "stop_reason": "complete",
            "glue_ops": ["s%d_%dx%d" % (lev, a, b) for lev in levels for (a, b) in loops],
            "torelon_ops": ["s%d" % lev for lev in levels],
            "wall_clock_s": 1.0, "seconds_per_cycle": 1e-3}
    sl = np.repeat(plaq[:, None], T, axis=1)
    np.savez(path, glue=glue, torelon=torelon, plaq=plaq, plaq_s=plaq, plaq_t=plaq,
             plaq_t_slices=sl, plaq_s_slices=sl, meta=np.array(json.dumps(meta)))


WIRING = [((20, 16, 16), 6.0, [1.19, 2.0], [0.98, 1.9]),          # D = 3, T != L on purpose
          ((16, 12, 12, 12), 2.4, [0.93, 1.8], [0.77, 1.6])]      # D = 4, T != L


@pytest.mark.parametrize("shape,beta,mg,mt", WIRING)
def test_full_pipeline_on_synthetic_ensemble_with_known_masses(tmp_path, shape, beta, mg, mt):
    """Four streams of unequal length (two 'hot', two 'cold') of a synthetic ensemble whose
    glueball and torelon channels contain exactly two states seen by two operators, so that
    the GEVP is exact and the true answer of the whole pipeline is known: am = mg[0],
    aE = mt[0], sigma a^2 = (aE + pi (D-2) / (6 L)) / L with L the SPATIAL extent (T != L).
    Checks (a) agreement with the truth within errors AND a precision requirement, (b) every
    derived number against an independent formula applied to the reported am and aE, (c) the
    error of m/sqrt(sigma) against independent error propagation, (d) the bookkeeping."""
    D = len(shape)
    T, L = shape[0], shape[1]
    levels, loops = (3, 7), ((2, 2),)
    amp_g = [[1.0, 0.8], [0.9, -0.4]]
    amp_t = [[1.0, 0.7], [0.8, -0.5]]
    rho = 0.4                                         # tau_int = 1.17 for linear quantities
    lengths = (3000, 2600, 3000, 2311)
    paths = []
    for i, n in enumerate(lengths):
        rng = np.random.default_rng(73001 + 10 * D + i)
        glue = synth_channel(rng, n, T, mg, amp_g, [900.0, 400.0], 0.0, rho)
        tor = np.stack([synth_channel(rng, n, T, mt, amp_t, [0.0, 0.0], 0.0, rho)
                        for _ in range(D - 1)], axis=1)
        p = str(tmp_path / ("syn_s%d.npz" % (i + 1)))
        write_synth_raw(p, shape, beta, i + 1, glue, tor, levels, loops,
                        start="hot" if i % 2 == 0 else "cold")
        paths.append(p)
    res = analyze_mod.analyze(paths, name="syn", outdir=str(tmp_path), make_plots=False,
                              quiet=True)
    with open(tmp_path / "syn.json") as f:
        assert json.load(f)["glueball"]["am"] == res["glueball"]["am"]
    gb, tb, st = res["glueball"], res["torelon"], res["string_tension"]
    am, dam, aE, daE = gb["am"], gb["am_err"], tb["aE"], tb["aE_err"]
    print("D=%d: am = %.4f(%.0f) [truth %.2f, t*=%s], aE = %.4f(%.0f) [truth %.2f, t*=%s], "
          "B = %d, tau_max = %.2f" % (D, am, 1e4 * dam, mg[0], gb["t_star"], aE, 1e4 * daE,
                                      mt[0], tb["t_star"], res["binsize"], res["tau_int_max"]))
    # (a) truth
    assert gb["flag"] in ("plateau", "no plateau") and tb["flag"] in ("plateau", "no plateau")
    assert abs(am - mg[0]) < 4.0 * dam and dam < 0.08 * mg[0]
    assert abs(aE - mt[0]) < 4.0 * daE and daE < 0.05 * mt[0]
    # fixed-t effective masses (no selection): t = 0 and t = 1 of both channels
    for blk, truth in ((gb, mg[0]), (tb, mt[0])):
        for t in (0, 1):
            row = blk["meff_table"][t]
            assert abs(row["m_cosh"] - truth) < 4.0 * row["err_cosh"]
            assert row["err_cosh"] < 0.05 * truth
    # (b) derived quantities from the reported numbers, independent formulas
    c = math.pi * (D - 2)
    assert st["L"] == L and tb["L"] == L and res["T"] == T and res["L_spatial"] == list(shape[1:])
    assert tb["n_directions"] == D - 1 and tb["directions"] == list(range(1, D))
    sig_l = (aE + c / (6.0 * L)) / L
    sig_n = (c / 3.0 + math.sqrt((c / 3.0) ** 2 + 4.0 * L * L * aE * aE)) / (2.0 * L * L)
    assert abs(st["luscher"]["sigma_a2"] - sig_l) < 1e-13
    assert abs(st["nambu_goto"]["sigma_a2"] - sig_n) < 1e-13
    assert abs(st["luscher"]["a_sqrt_sigma"] - math.sqrt(sig_l)) < 1e-13
    # the error of sigma is the propagated error of aE (sigma is linear in aE for Luescher)
    assert abs(st["luscher"]["sigma_a2_err"] - daE / L) < 1e-9 * daE
    assert abs(st["luscher"]["a_sqrt_sigma_err"] / (daE / L / (2 * math.sqrt(sig_l))) - 1) < 0.01
    r = res["ratios"]["m_over_sqrt_sigma"]
    assert abs(r["luscher"]["value"] - am / math.sqrt(sig_l)) < 1e-12
    assert abs(r["nambu_goto"]["value"] - am / math.sqrt(sig_n)) < 1e-12
    # (c) glueball and torelon are statistically independent here: errors add in quadrature
    rel = math.hypot(dam / am, st["luscher"]["a_sqrt_sigma_err"] / st["luscher"]["a_sqrt_sigma"])
    ratio_err = r["luscher"]["err"] / r["luscher"]["value"] / rel
    print("   m/sqrt(sigma) = %.3f(%.0f); jackknife error / independent propagation = %.3f"
          % (r["luscher"]["value"], 1e3 * r["luscher"]["err"], ratio_err))
    assert abs(ratio_err - 1.0) < 0.15
    if D == 3:
        assert abs(res["D3"]["beta_am_over_4"]["value"] - beta * am / 4.0) < 1e-13
        assert abs(res["D3"]["beta_am_over_4"]["err"] - beta * dam / 4.0) < 1e-13
        assert abs(res["D3"]["beta_a_sqrt_sigma_over_4"]["luscher"]["value"]
                   - beta * math.sqrt(sig_l) / 4.0) < 1e-13
    else:
        al = (6 * math.pi ** 2 * beta / 11.0) ** (51.0 / 121.0) * math.exp(-3 * math.pi ** 2
                                                                         * beta / 11.0)
        assert abs(res["D4"]["a_lambda_two_loop"] / al - 1.0) < 1e-12
        assert abs(res["D4"]["m_over_lambda"]["value"] - am / al) < 1e-9 * am / al
        assert abs(res["D4"]["sqrt_sigma_over_lambda"]["luscher"]["value"]
                   - math.sqrt(sig_l) / al) < 1e-9 / al
    # (d) bookkeeping: bins within streams, leftovers dropped, everything counted
    B = res["binsize"]
    assert B == max(1, math.ceil(10.0 * res["tau_int_max"]))
    assert res["n_meas_total"] == sum(lengths)
    assert res["n_bins"] == sum(n // B for n in lengths) == gb["n_bins"] == tb["n_bins"]
    assert res["n_meas_used"] == B * res["n_bins"] == gb["n_used"]
    assert [s["start"] for s in res["streams"]] == ["hot", "cold", "hot", "cold"]
    assert [s["n_dropped_binning"] for s in res["streams"]] == [n % B for n in lengths]
    # tau_int of the linear quantities is (1 + rho) / (2 (1 - rho)) = 1.167
    assert abs(res["tau_int_max"] - 1.1667) < 0.25
    # the same stream twice / a different ensemble must be refused
    with pytest.raises(ValueError):
        analyze_mod.analyze([paths[0], paths[0]], name="x", outdir=str(tmp_path),
                            make_plots=False, quiet=True)
    other = str(tmp_path / "other_s9.npz")
    rng = np.random.default_rng(1)
    write_synth_raw(other, shape, beta + 0.1, 9,
                    synth_channel(rng, 50, T, mg, amp_g, [0, 0], 0.0, 0.0),
                    np.stack([synth_channel(rng, 50, T, mt, amp_t, [0, 0], 0.0, 0.0)
                              for _ in range(D - 1)], axis=1), levels, loops)
    with pytest.raises(ValueError):
        analyze_mod.analyze([paths[0], other], name="x", outdir=str(tmp_path),
                            make_plots=False, quiet=True)


def test_error_bars_with_autocorrelated_data_through_analyze(tmp_path):
    """AR(1) Monte-Carlo-time correlated synthetic data with EXACTLY known integrated
    autocorrelation times (rho = 9/11: tau_int = 5 for the operators, 2.52 for the correlator
    estimators), 20 independent replicas of a 2-stream ensemble, each pushed through
    analyze.py with its automatic bin size.

    Requirements (windows fixed before the first run):
      * analyze.py reports tau_int_max = 5 within 20 % and uses B = ceil(10 tau_int_max) >= 40;
      * the fixed-t effective masses t = 0, 1 of the torelon AND glueball channel have unit
        pulls about the exact value: rms of the 80 pulls in [0.78, 1.22] (the 3 sigma window
        of sqrt(chi^2_80 / 80) is 0.76 .. 1.24), i.e. the error is not underestimated;
      * teeth: the same analysis with --binsize 1 underestimates the error by the expected
        factor sqrt(2 * 2.52) = 2.2 (measured ratio in [1.7, 2.8]) and analyze.py WARNS that
        the bin size is too small.
    """
    T, shape, beta = 12, (12, 8, 8), 5.0
    rho = 9.0 / 11.0
    masses, amps = [0.7, 1.6], [[1.0, 0.6], [0.8, -0.5]]
    levels, loops = (2, 5), ((1, 1),)
    reps, N = 20, 5000
    pulls, ratio, taus, bins = [], [], [], []
    for i in range(reps):
        paths = []
        for s in range(2):
            rng = np.random.default_rng(73100 + 10 * i + s)
            glue = synth_channel(rng, N, T, masses, amps, [300.0, 100.0], 0.0, rho)
            tor = np.stack([synth_channel(rng, N, T, masses, amps, [0.0, 0.0], 0.0, rho)
                            for _ in range(2)], axis=1)
            p = str(tmp_path / ("ar_r%d_s%d.npz" % (i, s + 1)))
            write_synth_raw(p, shape, beta, s + 1, glue, tor, levels, loops)
            paths.append(p)
        res = analyze_mod.analyze(paths, name="ar", outdir=str(tmp_path), make_plots=False,
                                  quiet=True)
        taus.append(res["tau_int_max"])
        bins.append(res["binsize"])
        for blk in (res["glueball"], res["torelon"]):
            for t in (0, 1):
                row = blk["meff_table"][t]
                pulls.append((row["m_cosh"] - masses[0]) / row["err_cosh"])
        if i < 6:
            r1 = analyze_mod.analyze(paths, name="ar1", outdir=str(tmp_path), binsize=1,
                                     make_plots=False, quiet=True)
            assert any("smaller than" in w for w in r1["warnings"])
            for key in ("glueball", "torelon"):
                ratio.append(res[key]["meff_table"][1]["err_cosh"]
                             / r1[key]["meff_table"][1]["err_cosh"])
        for p in paths:
            os.remove(p)
    pulls = np.array(pulls)
    rms = float(np.sqrt(np.mean(pulls ** 2)))
    print("tau_int_max: mean %.2f (min %.2f, max %.2f; exact 5.0); bin sizes %d .. %d"
          % (np.mean(taus), np.min(taus), np.max(taus), min(bins), max(bins)))
    print("fixed-t pulls (n = %d): mean %+.3f, rms %.3f, max |pull| %.2f"
          % (pulls.size, pulls.mean(), rms, np.max(np.abs(pulls))))
    print("error(auto bins) / error(bins of 1): mean %.2f (expected about 2.2)" % np.mean(ratio))
    assert abs(np.mean(taus) - 5.0) < 1.0 and min(taus) > 3.5
    assert min(bins) >= 40
    assert 0.78 < rms < 1.22
    assert abs(pulls.mean()) < 0.45
    assert 1.7 < np.mean(ratio) < 2.8


# ==============================================================================================
# run_production.py: what exactly is stored
# ==============================================================================================
class _Sink:
    def __init__(self):
        self.lines = []

    def write(self, s):
        self.lines.append(s)

    def flush(self):
        pass


def _args(**kw):
    base = ["--shape", "4,4,4", "--beta", "4.0", "--nmeas", "4", "--out", "x.npz"]
    a = rp.build_parser().parse_args(base)
    for k, v in kw.items():
        setattr(a, k, v)
    return a


def _replay(shape, beta, seed, start, ntherm, nhb, nor, nskip, nmeas, levels, w, loops):
    """What the stored time series must be, generated with explicit engine calls only."""
    lat = Lattice(shape, beta, seed=seed)
    if start == "hot":
        lat.hot_start()
    m = Measurer(shape, levels, w, loops)
    for _ in range(ntherm):
        lat.heatbath_sweep(nhb)
        lat.overrelax_sweep(nor)
    out = []
    for _ in range(nmeas):
        for _ in range(nskip):
            lat.heatbath_sweep(nhb)
            lat.overrelax_sweep(nor)
        out.append(m(lat))
    return out, lat


@pytest.mark.parametrize("start", ["hot", "cold"])
def test_stored_series_is_exactly_the_documented_markov_chain(tmp_path, start):
    """The file written by the driver equals, bit for bit, an explicit replay: seed -> (hot
    start) -> ntherm compound updates WITHOUT measurement -> nmeas x (nskip compound updates,
    one measurement), compound update = nhb heatbath sweeps then nor overrelaxation sweeps.
    So thermalisation is really discarded, measurements are separated by exactly the stated
    sweeps, measuring does not disturb the chain, and the operator index order in the file is
    level-major (op = level_index * n_loops + loop_index).  A replay with ntherm - 1 or with
    nskip - 1 gives different numbers (teeth)."""
    shape, beta, seed = (4, 6, 4), 4.0, 74001
    par = dict(ntherm=5, nhb=2, nor=3, nskip=2, nmeas=6)
    levels, w, loops = (0, 2, 3), 0.25, ((1, 1), (2, 2), (1, 2))
    out = str(tmp_path / "replay.npz")
    a = _args(shape="4,6,4", beta=beta, seed=seed, start=start, levels="0,2,3", w=w,
              loops="1x1,2x2,1x2", out=out, **par)
    rp.Run(a).run(out=_Sink())
    meta, arr = rp.load_raw(out)
    ref, lat = _replay(shape, beta, seed, start, levels=levels, w=w, loops=loops, **par)
    n = par["nmeas"]
    assert arr["glue"].shape == (n, len(levels) * len(loops), shape[0])
    assert arr["torelon"].shape == (n, 2, len(levels), shape[0])
    for i in range(n):
        assert np.array_equal(arr["glue"][i], ref[i]["glue"].reshape(-1, shape[0]))
        assert np.array_equal(arr["torelon"][i], ref[i]["torelon"])
        for key in ("plaq", "plaq_s", "plaq_t", "plaq_t_slices", "plaq_s_slices"):
            assert np.array_equal(arr[key][i], ref[i][key])
    assert np.array_equal(arr["state_U"], lat.U)              # final field = end of the chain
    # labels follow the storage order
    assert meta["glue_ops"] == ["s%d_%dx%d" % (lev, r, s) for lev in levels for (r, s) in loops]
    assert meta["torelon_ops"] == ["s%d" % lev for lev in levels]
    # metadata needed to reproduce and to analyse
    for key in ("format", "shape", "beta", "seed", "start", "ntherm", "ntherm_done", "nhb",
                "nor", "nskip", "levels", "w", "loops", "nmeas_requested", "nmeas_done",
                "complete", "stop_reason", "sweeps_per_measurement", "versions", "command",
                "wall_clock_s", "seconds_per_cycle", "unitarity_violation"):
        assert key in meta, key
    assert meta["complete"] is True and meta["start"] == start and meta["seed"] == seed
    assert meta["sweeps_per_measurement"] == {"heatbath": 4, "overrelax": 6}
    assert meta["unitarity_violation"] < 1e-13
    # teeth
    for wrong in (dict(par, ntherm=par["ntherm"] - 1), dict(par, nskip=par["nskip"] - 1)):
        bad, _ = _replay(shape, beta, seed, start, levels=levels, w=w, loops=loops, **wrong)
        assert not np.array_equal(arr["plaq"], np.array([b["plaq"] for b in bad]))
    if start == "cold":
        # a cold start really starts from the unit configuration: with ntherm = 0 and beta
        # large the first measurement is still close to 1
        a0 = _args(shape="4,6,4", beta=50.0, seed=seed, start="cold", ntherm=0, nmeas=1,
                   levels="0", out=str(tmp_path / "cold.npz"))
        rp.Run(a0).run(out=_Sink())
        assert rp.load_raw(str(tmp_path / "cold.npz"))[1]["plaq"][0] > 0.9
    else:
        a0 = _args(shape="4,6,4", beta=50.0, seed=seed, start="hot", ntherm=0, nmeas=1,
                   nhb=1, nor=0, levels="0", out=str(tmp_path / "hot.npz"))
        rp.Run(a0).run(out=_Sink())
        assert rp.load_raw(str(tmp_path / "hot.npz"))[1]["plaq"][0] < 0.8


def _cli(*args, timeout=600):
    env = dict(os.environ, NUMBA_NUM_THREADS="1", OMP_NUM_THREADS="1",
               OPENBLAS_NUM_THREADS="1", MKL_NUM_THREADS="1")
    return subprocess.run([sys.executable] + [str(a) for a in args], cwd=str(ROOT), env=env,
                          capture_output=True, text=True, timeout=timeout)


def test_sigkill_leaves_a_loadable_prefix_of_the_exact_chain(tmp_path):
    """Start the real driver as a separate process with frequent checkpoints, kill it with
    SIGKILL (no chance to clean up) once at least two checkpoints were written, and check
    that the file is a complete, loadable, analysable prefix of the SAME chain that an
    uninterrupted explicit replay generates (bit-identical), with consistent bookkeeping.
    Then resume it and check that the continuation ACROSS the kill point is again the
    uninterrupted chain.  Generous wall-clock limits: the machine is shared.
    (--nmeas is kept moderate on purpose: the driver pre-allocates all output arrays for
    --nmeas measurements, a cap of 5e7 on this lattice needs 18 GiB and dies with MemoryError.)"""
    out = str(tmp_path / "killed.npz")
    shape, beta, seed = (6, 6, 6), 4.0, 74100
    levels, loops = (0, 2, 4, 8), ((1, 1), (2, 2))
    chain = ["--shape", "6,6,6", "--beta", "4.0", "--ntherm", "20", "--nmeas", "400000",
             "--nhb", "1", "--nor", "2", "--levels", "0,2,4,8", "--w", "0.25",
             "--loops", "1x1,2x2", "--seed", str(seed), "--start", "hot", "--out", out]
    par = dict(ntherm=20, nhb=1, nor=2, nskip=1)
    cmd = ([sys.executable, str(ROOT / "run_production.py")] + chain
           + ["--checkpoint", "0.4", "--progress", "1000"])
    env = dict(os.environ, NUMBA_NUM_THREADS="1", OMP_NUM_THREADS="1", PYTHONUNBUFFERED="1")
    proc = subprocess.Popen(cmd, cwd=str(ROOT), env=env, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, text=True)
    n_ckpt = 0
    t0 = time.time()
    try:
        while n_ckpt < 2:
            line = proc.stdout.readline()
            if not line:
                break
            if line.startswith("[checkpoint]"):
                n_ckpt += 1
            assert time.time() - t0 < 300, "driver did not checkpoint within 300 s"
        time.sleep(0.15)                       # land somewhere inside the next interval
    finally:
        proc.send_signal(signal.SIGKILL)       # only the process started by this test
        proc.wait(timeout=60)
        proc.stdout.close()
    assert n_ckpt >= 2
    meta, arr = rp.load_raw(out)
    n = int(meta["nmeas_done"])
    assert n > 0 and meta["complete"] is False and meta["ntherm_done"] == 20
    assert int(arr["state_n"]) == n
    for key in ("glue", "torelon", "plaq", "plaq_s", "plaq_t", "plaq_t_slices", "plaq_s_slices"):
        assert arr[key].shape[0] == n and np.all(np.isfinite(arr[key]))
    # the analysis accepts the file and flags it as incomplete
    res = analyze_mod.analyze([out], name="killed", outdir=str(tmp_path), make_plots=False,
                              quiet=True)
    assert res["n_meas_total"] == n and any("incomplete" in w for w in res["warnings"])
    # ... and the run can be continued; a resume with a different seed is refused
    bad = [x if x != str(seed) else str(seed + 1) for x in chain]
    rb = _cli(ROOT / "run_production.py", *bad, "--resume", "--maxtime", "0.5")
    assert rb.returncode != 0 and "seed differs" in (rb.stdout + rb.stderr)
    r = _cli(ROOT / "run_production.py", *chain, "--checkpoint", "1000", "--progress", "1000",
             "--resume", "--maxtime", "0.5")
    assert r.returncode == 0, r.stdout + r.stderr
    meta2, arr2 = rp.load_raw(out)
    n_tot = int(meta2["nmeas_done"])
    assert n_tot > n and meta2["n_invocations"] == 2
    assert np.array_equal(arr2["plaq"][:n], arr["plaq"])
    assert np.array_equal(arr2["glue"][:n], arr["glue"])
    # explicit replay of the uninterrupted chain: before, across and after the kill point
    if n + 50 <= 6000:
        nrep = min(n_tot, n + 50)
        crossed = nrep > n
    else:
        nrep, crossed = 6000, False            # (very fast machine: prefix only)
    ref, _ = _replay(shape, beta, seed, "hot", nmeas=nrep, levels=levels, w=0.25, loops=loops,
                     **par)
    assert np.array_equal(arr2["plaq"][:nrep], np.array([x["plaq"] for x in ref]))
    assert np.array_equal(arr2["glue"][nrep - 1], ref[-1]["glue"].reshape(-1, shape[0]))
    assert np.array_equal(arr2["torelon"][nrep - 1], ref[-1]["torelon"])
    print("killed after %d checkpoints with %d measurements on disk; resumed to %d; first %d "
          "bit-identical to an uninterrupted replay (kill point crossed: %s)"
          % (n_ckpt, n, n_tot, nrep, crossed))
    # no temporary files left behind after the resume
    assert [f for f in os.listdir(tmp_path) if ".tmp." in f] == []


def test_streams_with_neighbouring_seeds_are_uncorrelated_and_production_seeds_distinct():
    """Production streams use consecutive seeds (100 * ensemble + slot).  (a) The random
    numbers behind neighbouring seeds are uncorrelated: Haar start fields of seeds s and s+1
    (131072 numbers each) have no cross-correlation at any lag in -64 .. 64 beyond 5 / sqrt(n),
    and are not shifted copies of each other.  (b) The seeds in run_all_production.sh are
    pairwise distinct (static check of the launcher)."""
    shape = (8, 8, 8, 8)
    fields = []
    for seed in (401, 402, 403, 404):
        lat = Lattice(shape, 2.4, seed=seed)
        lat.hot_start()
        fields.append(lat.U[:, :, :2].ravel().copy())      # two components per link
    n = fields[0].size
    worst = 0.0
    for i in range(4):
        for j in range(i + 1, 4):
            x = (fields[i] - fields[i].mean()) / fields[i].std()
            y = (fields[j] - fields[j].mean()) / fields[j].std()
            cc = np.fft.irfft(np.fft.rfft(x) * np.conj(np.fft.rfft(y)), n) / n
            lags = np.r_[cc[:65], cc[-64:]]
            worst = max(worst, float(np.max(np.abs(lags))))
    print("max |cross-correlation| over 6 seed pairs and 129 lags: %.4f (5/sqrt(n) = %.4f)"
          % (worst, 5.0 / math.sqrt(n)))
    assert worst < 5.0 / math.sqrt(n)
    script = ROOT / "run_all_production.sh"
    if not script.exists():
        pytest.skip("launcher script not present")
    text = script.read_text()
    assert "seed=$(( 100 * eid + s ))" in text and '--seed "$seed"' in text
    eids = []
    for line in text.splitlines():
        line = line.strip()
        if line.startswith('"d') and line.count("|") == 7:
            eids.append(int(line.strip('"').split("|")[7]))
    assert len(eids) >= 6 and len(set(eids)) == len(eids) and max(eids) < 2 ** 32 // 100 - 1
    seeds = [100 * e + s for e in eids for s in (1, 2, 3, 4)]
    assert len(set(seeds)) == len(seeds)


# ==============================================================================================
# end-to-end exact check in D = 2: real driver + real analysis, command-line interfaces
# ==============================================================================================
def _d2_end_to_end(tmp_path, shape, beta, nmeas, seeds):
    T, L = shape
    paths = []
    for seed, start in seeds:
        out = str(tmp_path / ("d2_s%d.npz" % seed))
        r = _cli(ROOT / "run_production.py", "--shape", "%d,%d" % shape, "--beta", beta,
                 "--ntherm", 500, "--nmeas", nmeas, "--nhb", 1, "--nor", 4, "--nskip", 1,
                 "--levels", "0,1", "--seed", seed, "--start", start, "--out", out,
                 "--checkpoint", 10000, "--progress", 10000)
        assert r.returncode == 0, r.stdout + r.stderr
        assert "complete" in r.stdout
        paths.append(out)
    r = _cli(ROOT / "analyze.py", *paths, "--name", "d2", "--outdir", tmp_path, "--no-plots")
    assert r.returncode == 0, r.stdout + r.stderr
    with open(tmp_path / "d2.json") as f:
        res = json.load(f)
    sig = -math.log(exact.u(beta))
    # exact effective energies of the exact finite-torus correlator (all representations)
    cex = np.array([exact.torelon_correlator_2d_torus(beta, L, T, tau) for tau in range(T // 2 + 1)])
    mex = stats.cosh_effective_mass(cex[:-1], cex[1:], np.arange(T // 2), T)
    return res, sig, mex


def _check_d2(res, sig, mex, shape, rel_prec_m0, rel_prec_E):
    T, L = shape
    tb = res["torelon"]
    st = res["string_tension"]
    rows = tb["meff_table"]
    E = tb["aE"]
    print("exact L*sigma = %.6f; exact torus m_eff(0), m_eff(1) = %.6f, %.6f"
          % (L * sig, mex[0], mex[1]))
    for t in range(min(4, len(rows))):
        if rows[t]["m_cosh"] is not None and rows[t]["err_cosh"] is not None:
            print("  t=%d  m_eff = %.5f +- %.5f  pull %+.2f" % (
                t, rows[t]["m_cosh"], rows[t]["err_cosh"],
                (rows[t]["m_cosh"] - mex[t]) / rows[t]["err_cosh"]))
    print("pipeline: aE = %.5f +- %.5f (%s, t* = %s), sigma a^2 = %.5f +- %.5f, exact %.5f, "
          "pull %+.2f; plaquette pull %+.2f; null test max |pull| %.2f"
          % (E, tb["aE_err"], tb["flag"], tb["t_star"], st["luscher"]["sigma_a2"],
             st["luscher"]["sigma_a2_err"], sig,
             (st["luscher"]["sigma_a2"] - sig) / st["luscher"]["sigma_a2_err"],
             res["D2"]["plaquette_pull"], res["D2"]["plaquette_null_test"]["max_abs_pull"]))
    # the finite-torus corrections to E = L sigma are negligible compared with the statistical
    # precision (so "sigma a^2 = -ln u" is a sharp prediction here).  [First version of this
    # auxiliary assertion demanded 1e-6 and failed with 1.02e-6 at beta = 6: that was an error
    # of the test (an arbitrary bound on an exactly known, irrelevant correction), not of the
    # code under test; no statistical window was changed.]
    assert abs(mex[0] / (L * sig) - 1.0) < 1e-4 and abs(mex[1] / (L * sig) - 1.0) < 1e-4
    # D = 2: no Luescher term in either formula
    assert st["L"] == L and res["D"] == 2 and res["glueball"] is None
    assert abs(st["luscher"]["sigma_a2"] - E / L) < 1e-14
    assert abs(st["nambu_goto"]["sigma_a2"] - E / L) < 1e-14
    assert abs(res["D2"]["sigma_exact"] - sig) < 1e-12
    assert abs(res["D2"]["torelon_energy_exact"] - L * sig) < 1e-12
    # fixed-t effective energies: precise and correct
    for t in (0, 1):
        assert abs(rows[t]["m_cosh"] - mex[t]) < 3.5 * rows[t]["err_cosh"]
    assert rows[0]["err_cosh"] < rel_prec_m0 * L * sig
    # the number the pipeline quotes
    assert tb["flag"] == "plateau"
    assert abs(E - L * sig) < 3.5 * tb["aE_err"] and tb["aE_err"] < rel_prec_E * L * sig
    assert abs(st["luscher"]["sigma_a2"] - sig) < 3.5 * st["luscher"]["sigma_a2_err"]
    # correlator, plaquette (exact finite-torus value) and the null test
    assert max(abs(c["pull"]) for c in res["D2"]["torelon_correlator"]) < 4.0
    assert abs(res["D2"]["plaquette_pull"]) < 3.5
    assert res["D2"]["plaquette_null_test"]["max_abs_pull"] < 4.0
    assert res["plaquette"]["err"] < 2e-4
    assert not any("thermalisation" in w for w in res["warnings"])


def test_d2_end_to_end_string_tension_beta6(tmp_path):
    """Real driver (two streams, hot and cold start, command line) + real analyze.py on a
    12 x 4 lattice at beta = 6: the pipeline's sigma a^2 must equal -ln u(6) = 0.27074 within
    errors, with the fixed-t effective energy at t = 0 known to better than 0.6 % and the
    quoted energy to better than 4 %."""
    shape, beta = (12, 4), 6.0
    res, sig, mex = _d2_end_to_end(tmp_path, shape, beta, 60000, [(74201, "hot"), (74202, "cold")])
    assert res["n_meas_total"] == 120000
    _check_d2(res, sig, mex, shape, 0.006, 0.04)


@pytest.mark.slow
def test_d2_end_to_end_string_tension_beta8_slow(tmp_path):
    """Same on 16 x 4 at beta = 8 (sigma a^2 = -ln u(8) = 0.19937), 2 x 150000 measurements."""
    shape, beta = (16, 4), 8.0
    res, sig, mex = _d2_end_to_end(tmp_path, shape, beta, 150000,
                                   [(74211, "hot"), (74212, "cold")])
    _check_d2(res, sig, mex, shape, 0.004, 0.03)


# ==============================================================================================
# limitations that are documented by a number (they pass as long as the code warns / flags)
# ==============================================================================================
def test_one_short_stream_truncates_the_tau_int_window_but_is_flagged(tmp_path):
    """LIMITATION (reported as 'minor').  stats.autocorrelation() limits the lag range to half
    the length of the SHORTEST stream, so a single very short stream (e.g. a crashed job)
    truncates the Madras-Sokal window of the whole ensemble: tau_int and therefore the
    automatic bin size come out too small.  Here: AR(1) data with tau_int = 5 exactly,
    streams of 4000, 4000 and 8 measurements.  With the two long streams alone the bin size
    is >= 40; adding the 8-measurement stream roughly halves it (58 -> 31).  What must hold
    is that analyze.py does not do this silently: the 'window not reached' warning is present.
    (Production streams of one ensemble have similar lengths, so this does not affect them.)"""
    T, shape, beta = 12, (12, 8, 8), 5.0
    rho = 9.0 / 11.0
    masses, amps = [0.7, 1.6], [[1.0, 0.6], [0.8, -0.5]]
    paths = []
    for s, n in enumerate((4000, 4000, 8)):
        rng = np.random.default_rng(75300 + s)
        glue = synth_channel(rng, n, T, masses, amps, [300.0, 100.0], 0.0, rho)
        tor = np.stack([synth_channel(rng, n, T, masses, amps, [0.0, 0.0], 0.0, rho)
                        for _ in range(2)], axis=1)
        p = str(tmp_path / ("sh_s%d.npz" % (s + 1)))
        write_synth_raw(p, shape, beta, s + 1, glue, tor, (2, 5), ((1, 1),))
        paths.append(p)
    r2 = analyze_mod.analyze(paths[:2], name="two", outdir=str(tmp_path), make_plots=False,
                             quiet=True)
    r3 = analyze_mod.analyze(paths, name="three", outdir=str(tmp_path), make_plots=False,
                             quiet=True)
    w3 = [w for w in r3["warnings"] if "window not reached" in w]
    print("two long streams: tau_int_max %.2f, B = %d; plus one stream of 8: tau_int_max %.2f, "
          "B = %d, %d 'window not reached' warnings"
          % (r2["tau_int_max"], r2["binsize"], r3["tau_int_max"], r3["binsize"], len(w3)))
    assert r2["binsize"] >= 40 and not any("window not reached" in w for w in r2["warnings"])
    assert r3["binsize"] >= 40 or len(w3) > 0


def test_pure_noise_never_produces_a_plateau(tmp_path):
    """Safety check for a project about a MASS GAP: operators that are pure white noise in
    Euclidean and Monte Carlo time (no state at all, true correlator zero for tau >= 1) must
    never be turned into a 'plateau' by GEVP + rule R5, in neither channel; whatever number
    is printed must carry the 'upper bound only' flag (or there is no number) and so must the
    string tension and the ratio derived from it.  8 independent noise ensembles.
    Observed (reported as a 'note'): in 3 of 8 ensembles both channels give 'no signal'; in
    the others the result is 'no plateau' with a noise-generated m_eff(0) of 4.5 - 6 that
    passes the 25 % relative-error criterion (the logarithm of a noise ratio has a small
    relative spread) and is printed as an 'upper bound'.  Rule R5 has no requirement that
    the correlator itself be significantly different from zero."""
    T, shape, beta = 12, (12, 8, 8), 5.0
    flags = []
    for i in range(8):
        paths = []
        for s_ in range(2):
            rng = np.random.default_rng(75400 + 10 * i + s_)
            n = 3000
            glue = 500.0 + rng.standard_normal((n, 4, T))
            tor = rng.standard_normal((n, 2, 2, T))
            p = str(tmp_path / ("noise_r%d_s%d.npz" % (i, s_ + 1)))
            write_synth_raw(p, shape, beta, s_ + 1, glue, tor, (2, 5), ((1, 1), (2, 2)))
            paths.append(p)
        res = analyze_mod.analyze(paths, name="noise", outdir=str(tmp_path), make_plots=False,
                                  quiet=True)
        gb, tb, st = res["glueball"], res["torelon"], res["string_tension"]
        flags.append((gb["flag"], gb["am"], tb["flag"], tb["aE"]))
        for blk in (gb, tb):
            assert blk["flag"] != "plateau" and blk["plateau"] is False and blk["t_star"] is None
            assert blk["mass"] is None or blk["upper_bound_only"] is True
        assert st["luscher"] is None or st["upper_bound_only"] is True
        if res["ratios"]["m_over_sqrt_sigma"] is not None:
            assert res["ratios"]["upper_bound_only"] is True
        assert any("glueball" in w for w in res["warnings"])
        assert any("torelon" in w for w in res["warnings"])
        for p in paths:
            os.remove(p)
    print("noise ensembles (glue flag, am, torelon flag, aE):")
    for f in flags:
        print("  ", f)


@pytest.mark.slow
def test_plateau_rule_coverage_at_production_like_signal_to_noise_slow():
    """KNOWN PROPERTY of rule R5 (stated in ym/stats.py), quantified here for a spectrum and
    statistics that resemble the D = 3, beta = 6 production ensemble: ground state a m = 1.19,
    excited states at 1.9 and 3.0, four operators, white noise, 4 streams x 5000
    configurations, tau_int = 0.93, bins of 10; 120 independent replicas.

    Exploratory runs with OTHER seeds (150 replicas each; 4 x 5000 and 4 x 20000
    configurations) gave: fixed-t jackknife errors correct (rms pull 0.90 - 0.98 at t = 0, 1,
    2), but for the number selected by the plateau rule only 55 % / 58 % of the replicas
    within 1 sigma of the true mass (nominal 68 %), 93 % / 97 % within 2 sigma, rms pull
    1.18 / 1.10, and a replica-to-replica scatter of the quoted mass 2.1 / 2.3 times the mean
    quoted error (t* = 1 in about 70 % of the replicas, t = 2 or 3 otherwise).

    What is asserted (windows fixed from those exploratory numbers before this test was run):
    the fixed-t errors are right (rms pull of m_eff(1) about its exact value within 0.8 .. 1.2),
    and the error quoted with the selected mass is not wrong by more than 40 % in rms and
    covers at least 85 % at 2 sigma.  The 1 sigma coverage is printed; it is NOT 68 %."""
    T = 16
    masses = [1.19, 1.9, 3.0]
    amps = np.array([[1.0, 0.3, 0.3], [0.95, 0.5, 0.5], [0.8, 0.8, 0.8], [0.6, 1.0, 1.2]])
    eps, rho, B, N, reps = 0.2, 0.3, 10, 5000, 120
    Cex = _spectral_C(T, masses, amps)
    Cex[:, :, 0] += eps ** 2 * np.eye(4)
    gex = stats.gevp_project(Cex, np.stack([Cex, Cex]))
    mex = stats.effective_masses(gex["Cproj"], gex["Cproj_jk"], T)["m_cosh"]
    assert abs(mex[1] - masses[0]) < 0.003          # tiny true contamination at t = 1
    val, err, tv, p1 = [], [], [], []
    for i in range(reps):
        rng = np.random.default_rng(75000 + i)
        streams = [synth_channel(rng, N, T, masses, amps, [100.0, 80.0, 60.0, 40.0], eps, rho)
                   for _ in range(4)]
        r = stats.analyze_channel(streams, T, B, subtract_vev=True, do_fit=False)
        val.append(r["mass"])
        err.append(r["err"])
        tv.append(-1 if r["plateau"]["t_value"] is None else r["plateau"]["t_value"])
        p1.append((r["meff"]["m_cosh"][1] - mex[1]) / r["meff"]["err_cosh"][1])
    val, err, tv, p1 = map(np.array, (val, err, tv, p1))
    ok = np.isfinite(val)
    pull = (val[ok] - masses[0]) / err[ok]
    rms1 = float(np.sqrt(np.mean(p1 ** 2)))
    rms = float(np.sqrt(np.mean(pull ** 2)))
    c1 = float(np.mean(np.abs(pull) < 1.0))
    c2 = float(np.mean(np.abs(pull) < 2.0))
    print("fixed t = 1: rms pull %.2f, mean pull %+.2f" % (rms1, p1.mean()))
    print("plateau rule: t_value histogram %s; %d of %d replicas give a value"
          % ({int(t): int(np.sum(tv == t)) for t in np.unique(tv)}, ok.sum(), reps))
    print("  pull about the TRUE mass: mean %+.2f, rms %.2f, within 1 sigma %.0f %% (nominal 68), "
          "within 2 sigma %.0f %% (nominal 95)" % (pull.mean(), rms, 100 * c1, 100 * c2))
    print("  scatter of the quoted mass %.4f vs mean quoted error %.4f (ratio %.2f)"
          % (val[ok].std(ddof=1), err[ok].mean(), val[ok].std(ddof=1) / err[ok].mean()))
    assert ok.sum() == reps
    assert 0.8 < rms1 < 1.2
    assert rms < 1.4
    assert c2 > 0.85
