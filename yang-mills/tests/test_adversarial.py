"""Adversarial tests of the engine (ym/lattice.py) and of the analytic formulas (ym/exact.py).

Written by a reviewer who was asked to ASSUME the engine contains a subtle bug and to try to
expose it.  The tests below are designed to be as independent of the engine as possible:

* geometry is re-implemented with explicit complex 2x2 matrices and ``np.roll`` (no neighbour
  tables, no quaternion algebra of the engine);
* D = 2 measurements use an independent kernel (complex pairs, own index arithmetic);
* equilibrium is checked with Schwinger-Dyson identities (valid for every beta, volume and
  dimension, no reference numbers needed) and with exact D = 2 finite-torus results at extreme
  couplings, including the SECOND cumulant of the action and the full one-plaquette
  distribution;
* the exact torus formulas of ym/exact.py are themselves checked WITHOUT any Markov chain, by
  brute-force i.i.d. Haar sampling + reweighting on the 1x1, 1x2 and 2x2 torus;
* "teeth" tests run deliberately broken update kernels (defined in THIS file from the engine's
  own primitives) and demand that the Schwinger-Dyson test rejects them.

Rules
-----
* The base seed, every tolerance and every criterion were fixed before the first run of this
  file; run lengths and precision requirements were chosen from exploratory runs with OTHER
  seeds (scratch scripts, not part of the project).  Nothing may be tuned to turn a failure
  into a pass.
* Statistical comparisons use binned errors (bins >= 10 integrated autocorrelation times is
  asserted) and the criterion |MC - exact| < 4 sigma TOGETHER with an absolute precision
  requirement on sigma, so that a test cannot pass merely because its error is large.
* njit helpers in this file are deliberately NOT cached on disk: numba's cache of a function
  in one file is not invalidated when ym/lattice.py changes, and an adversarial test must never
  silently run against a stale copy of the engine.
* These tests validate a Monte Carlo code.  They are numerical evidence about a program, not a
  proof of anything about continuum Yang-Mills theory.

Run:  python3 -m pytest -q tests/test_adversarial.py -rP        (add --runslow for the long ones)
"""
import math

import numpy as np
import pytest
from numba import njit
from scipy import stats
from scipy.integrate import quad
from scipy.special import iv, ive

from ym import exact
from ym.lattice import (
    Lattice,
    get_rng_state,
    heatbath_link,
    heatbath_link_array,
    heatbath_sweep_kernel,
    overrelax_sweep_kernel,
    plaquette_sum_kernel,
    sample_x0_array,
    seed_numba,
    set_rng_state,
    staple_sum,
)

SEED = 918_273_645  # base seed of every run in this file; fixed a priori, never tuned

# ==============================================================================================
# independent reference implementation: explicit complex 2x2 matrices, np.roll geometry
# ==============================================================================================
I2 = np.eye(2, dtype=complex)
S1 = np.array([[0, 1], [1, 0]], dtype=complex)
S2 = np.array([[0, -1j], [1j, 0]], dtype=complex)
S3 = np.array([[1, 0], [0, -1]], dtype=complex)


def q2m(q):
    """U = a0 + i (a1 sigma1 + a2 sigma2 + a3 sigma3), built from the Pauli matrices."""
    q = np.asarray(q, dtype=float)
    return (q[..., 0, None, None] * I2 + 1j * (q[..., 1, None, None] * S1
            + q[..., 2, None, None] * S2 + q[..., 3, None, None] * S3))


def m2q(m):
    """Inverse of q2m via traces: a0 = Re Tr M / 2, a_k = Im Tr(sigma_k M) / 2."""
    m = np.asarray(m)
    out = np.empty(m.shape[:-2] + (4,))
    out[..., 0] = 0.5 * np.trace(m, axis1=-2, axis2=-1).real
    for k, s in enumerate((S1, S2, S3)):
        out[..., k + 1] = 0.5 * np.trace(s @ m, axis1=-2, axis2=-1).imag
    return out


def field(lat):
    """Links as an array of shape lattice_shape + (D, 2, 2) (C-order site index convention)."""
    return q2m(lat.U).reshape(tuple(lat.shape) + (lat.D, 2, 2))


def sh(f, mu, n=1):
    """Field evaluated at x + n*mu (periodic)."""
    return np.roll(f, -n, axis=mu)


def dg(m):
    return np.conj(np.swapaxes(m, -1, -2))


def htr(m):
    return 0.5 * np.trace(m, axis1=-2, axis2=-1).real


def plaq_field(f, mu, nu):
    """(1/2) Tr [U_mu(x) U_nu(x+mu) U_mu^dagger(x+nu) U_nu^dagger(x)] for every site."""
    um = f[..., mu, :, :]
    un = f[..., nu, :, :]
    return htr(um @ sh(un, mu) @ dg(sh(um, nu)) @ dg(un))


def staple_field(f, mu):
    """Staple sum A_mu(x) for every site (project convention), shape lattice_shape + (2, 2)."""
    D = f.shape[-3]
    um = f[..., mu, :, :]
    tot = np.zeros_like(um)
    for nu in range(D):
        if nu == mu:
            continue
        un = f[..., nu, :, :]
        tot = tot + sh(un, mu) @ dg(sh(um, nu)) @ dg(un)
        un_m = sh(un, nu, -1)
        um_m = sh(um, nu, -1)
        tot = tot + dg(sh(un_m, mu)) @ dg(um_m) @ un_m
    return tot


def line(f, mu, n):
    """U_mu(x) U_mu(x+mu) ... U_mu(x+(n-1)mu) for every site."""
    um = f[..., mu, :, :]
    out = um.copy()
    for i in range(1, n):
        out = out @ sh(um, mu, i)
    return out


def wilson_field(f, R, T, mu, nu):
    """(1/2) Tr of the R x T loop (R links along mu, then T links along nu) for every site."""
    lr = line(f, mu, R)
    lt = line(f, nu, T)
    return htr(lr @ sh(lt, mu, R) @ dg(sh(lr, nu, T)) @ dg(lt))


def polyakov_ref(f, mu):
    L = f.shape[mu]
    return np.take(htr(line(f, mu, L)), 0, axis=mu)


def action_ref(f, beta):
    D = f.shape[-3]
    s = 0.0
    for mu in range(D):
        for nu in range(mu + 1, D):
            s += np.sum(1.0 - plaq_field(f, mu, nu))
    return beta * s


def generic_config(shape, beta, seed, n_hb=2, n_or=1):
    lat = Lattice(shape, beta, seed)
    lat.hot_start()
    lat.update(n_hb, n_or)
    return lat


# ==============================================================================================
# statistics helpers
# ==============================================================================================
def tau_int(x, c=6.0):
    """Integrated autocorrelation time, Madras-Sokal window W >= c * tau."""
    x = np.asarray(x, dtype=float)
    n = len(x)
    d = x - x.mean()
    c0 = np.dot(d, d) / n
    if c0 == 0.0:
        return 0.5
    tau = 0.5
    for k in range(1, n // 4):
        tau += np.dot(d[:-k], d[k:]) / ((n - k) * c0)
        if k >= c * tau:
            break
    return tau


def bin_err(x, nb):
    x = np.asarray(x, dtype=float)
    n = (len(x) // nb) * nb
    b = x[:n].reshape(nb, -1).mean(axis=1)
    return b.std(ddof=1) / math.sqrt(nb)


NB = 64  # number of bins of every binned error in this file


def estimate(x, label):
    """(mean, binned error, tau_int); asserts that bins are >= 10 tau_int long."""
    x = np.asarray(x, dtype=float)
    tau = max(tau_int(x), 0.5)
    blen = len(x) // NB
    assert blen >= 10.0 * tau, "%s: bins (%d) shorter than 10 tau_int (%.1f)" % (label, blen, tau)
    err = bin_err(x, NB)
    assert err > 0.0, label
    return float(x.mean()), float(err), float(tau)


def bessel_u(a):
    """I_2(a)/I_1(a) straight from scipy (independent of ym.exact)."""
    return ive(2, a) / ive(1, a)


# ==============================================================================================
# 1. deterministic geometry: every observable and EVERY staple against the reference
# ==============================================================================================
GEOM_SHAPES = [(2, 2), (2, 6), (6, 4), (2, 2, 2), (2, 4, 6), (4, 6, 8), (2, 2, 2, 2),
               (2, 4, 6, 4), (4, 6, 8, 10)]


@pytest.mark.parametrize("shape", GEOM_SHAPES)
def test_geometry_against_independent_matrix_reference(shape):
    lat = generic_config(shape, 2.0, SEED + 1)
    D, V = lat.D, lat.V
    f = field(lat)
    # site index convention: C-order ravel, by explicit strides
    strides = [int(np.prod(shape[i + 1:])) for i in range(D)]
    rng = np.random.default_rng(SEED + 2)
    for _ in range(20):
        x = [int(rng.integers(n)) for n in shape]
        s = sum(xi * st for xi, st in zip(x, strides))
        assert lat.site_index(x) == s and lat.site_coords(s) == tuple(x)
        for mu in range(D):
            y = list(x)
            y[mu] = (y[mu] + 1) % shape[mu]
            assert lat.up[s, mu] == sum(yi * st for yi, st in zip(y, strides))
            y[mu] = (x[mu] - 1) % shape[mu]
            assert lat.dn[s, mu] == sum(yi * st for yi, st in zip(y, strides))
    # plaquettes, action
    planes = lat.plaquette_planes()
    ref_planes = np.array([plaq_field(f, mu, nu).mean() for (mu, nu) in lat.planes])
    assert lat.planes == [(mu, nu) for mu in range(D) for nu in range(mu + 1, D)]
    assert np.max(np.abs(planes - ref_planes)) < 1e-13
    assert abs(lat.plaquette() - ref_planes.mean()) < 1e-13
    assert abs(lat.action() - action_ref(f, lat.beta)) < 1e-10 * max(1.0, lat.action())
    # EVERY staple (all sites, all directions)
    worst = 0.0
    for mu in range(D):
        ref = m2q(staple_field(f, mu)).reshape(V, 4)
        got = np.array([lat.staple(s, mu) for s in range(V)])
        worst = max(worst, float(np.max(np.abs(ref - got))))
    assert worst < 1e-12, worst
    # Wilson loops: every ordered pair of directions, sizes 1..3 (wrapping on short extents)
    for R in (1, 2, 3):
        for T in (1, 2, 3):
            acc = []
            for mu in range(D):
                for nu in range(D):
                    if mu == nu:
                        continue
                    ref = wilson_field(f, R, T, mu, nu).mean()
                    assert abs(lat.wilson_loop(R, T, mu, nu) - ref) < 1e-13
                    acc.append(ref)
            assert abs(lat.wilson_loop(R, T) - np.mean(acc)) < 1e-13
    # Polyakov loops in every direction (values AND array layout)
    for mu in range(D):
        pl = lat.polyakov_loops(mu)
        ref = polyakov_ref(f, mu)
        assert pl.shape == ref.shape == tuple(shape[:mu] + shape[mu + 1:])
        assert np.max(np.abs(pl - ref)) < 1e-13
    print("[geom] shape=%s: max staple deviation %.1e over %d links" % (shape, worst, V * D))


@pytest.mark.parametrize("shape", [(4, 6), (2, 4), (4, 6, 8), (2, 6, 4), (4, 6, 8, 10),
                                   (2, 4, 2, 6)])
def test_analytically_known_configurations(shape):
    """Pure gauge, a single flipped link, centre transformations: answers known in closed form."""
    D = len(shape)
    lat = Lattice(shape, 1.0, SEED + 3)
    V = lat.V
    rng = np.random.default_rng(SEED + 4)

    # --- (a) pure gauge: every loop is exactly 1 --------------------------------------------
    g = rng.normal(size=(V, 4))
    g /= np.linalg.norm(g, axis=1)[:, None]
    lat.cold_start()
    lat.gauge_transform(g)
    gm = q2m(g).reshape(tuple(shape) + (2, 2))
    f = field(lat)
    for mu in range(D):          # U_mu(x) = G(x) G^dagger(x + mu)
        assert np.max(np.abs(f[..., mu, :, :] - gm @ dg(sh(gm, mu)))) < 1e-13
    assert abs(lat.plaquette() - 1.0) < 1e-13 and abs(lat.action()) < 1e-10
    for R in (1, 2, 3, 5):
        for T in (1, 2, 4):
            assert abs(lat.wilson_loop(R, T) - 1.0) < 1e-12
    for mu in range(D):
        assert np.max(np.abs(lat.polyakov_loops(mu) - 1.0)) < 1e-12
        for s in rng.integers(V, size=5):
            a = lat.staple(int(s), mu)
            ua0 = htr(q2m(lat.U[s, mu]) @ q2m(a))
            assert abs(ua0 - 2 * (D - 1)) < 1e-12

    # --- (b) one flipped link U = -1 on the cold configuration -------------------------------
    for m0 in range(D):
        lat.cold_start()
        xs = [int(rng.integers(n)) for n in shape]
        s0 = lat.site_index(xs)
        lat.U[s0, m0] = (-1.0, 0.0, 0.0, 0.0)
        # 2(D-1) plaquettes flip sign
        assert abs(lat.plaquette() - (1.0 - 8.0 / (V * D))) < 1e-13
        ref_planes = [1.0 - (4.0 / V if m0 in pl else 0.0) for pl in lat.planes]
        assert np.max(np.abs(lat.plaquette_planes() - ref_planes)) < 1e-13
        assert abs(lat.action() - lat.beta * 4 * (D - 1)) < 1e-10
        for mu in range(D):
            for nu in range(D):
                if mu == nu:
                    continue
                for R in (1, 2, 3):
                    for T in (1, 2, 3):
                        if R >= shape[mu] or T >= shape[nu]:
                            continue          # wrapping loops: the link may enter twice
                        if mu == m0:
                            ref = 1.0 - 4.0 * R / V     # 2R loops contain the link
                        elif nu == m0:
                            ref = 1.0 - 4.0 * T / V
                        else:
                            ref = 1.0
                        assert abs(lat.wilson_loop(R, T, mu, nu) - ref) < 1e-13
        # the staple of the flipped link is untouched; exactly one Polyakov loop flips
        assert np.allclose(lat.staple(s0, m0), (2.0 * (D - 1), 0, 0, 0), atol=1e-14)
        for mu in range(D):
            pl = lat.polyakov_loops(mu)
            if mu == m0:
                idx = tuple(xs[:mu] + xs[mu + 1:])
                assert pl[idx] == -1.0
                assert np.sum(pl) == pl.size - 2.0
            else:
                assert np.all(pl == 1.0)

    # --- (c) centre transformation on a generic configuration --------------------------------
    lat = generic_config(shape, 2.2, SEED + 5)
    coords = np.indices(shape).reshape(D, V)
    for mu in range(D):
        before_p = lat.plaquette_planes()
        before_w = [lat.wilson_loop(R, T, a, b) for R in (1, 2, 3) for T in (1, 2, 4)
                    for a in range(D) for b in range(D) if a != b]
        before_pol = [lat.polyakov_loops(nu).copy() for nu in range(D)]
        c = int(rng.integers(shape[mu]))
        lat.U[coords[mu] == c, mu, :] *= -1.0        # all mu-links leaving the slice x_mu = c
        assert np.max(np.abs(lat.plaquette_planes() - before_p)) < 1e-14
        after_w = [lat.wilson_loop(R, T, a, b) for R in (1, 2, 3) for T in (1, 2, 4)
                   for a in range(D) for b in range(D) if a != b]
        assert np.max(np.abs(np.array(after_w) - np.array(before_w))) < 1e-14
        for nu in range(D):
            sign = -1.0 if nu == mu else 1.0
            assert np.max(np.abs(lat.polyakov_loops(nu) - sign * before_pol[nu])) < 1e-14


@pytest.mark.parametrize("shape", [(4, 6), (6, 4, 8), (4, 6, 8, 10)])
def test_constant_abelian_flux(shape):
    """U_b(x) = exp(i sigma_3 B x_a), all other links 1, B = 2 pi / L_a: uniform flux B through
    every (a, b) plaquette.  Then P_(a,b) = cos B, W(R, T) = cos(B R T) in that plane, and the
    Polyakov loop winding b is cos(L_b B x_a): a closed-form check of plane ordering, loop
    orientation and of which array axis is which."""
    D = len(shape)
    lat = Lattice(shape, 1.0, SEED + 6)
    V = lat.V
    coords = np.indices(shape).reshape(D, V)
    for a in range(D):
        for b in range(D):
            if a == b:
                continue
            B = 2.0 * math.pi / shape[a]
            lat.cold_start()
            theta = B * coords[a]
            lat.U[:, b, 0] = np.cos(theta)
            lat.U[:, b, 3] = np.sin(theta)
            planes = lat.plaquette_planes()
            for ip, pl in enumerate(lat.planes):
                ref = math.cos(B) if set(pl) == {a, b} else 1.0
                assert abs(planes[ip] - ref) < 1e-13
            for R in (1, 2, 3):
                for T in (1, 2, 3):
                    ref = math.cos(B * R * T)
                    assert abs(lat.wilson_loop(R, T, a, b) - ref) < 1e-12
                    assert abs(lat.wilson_loop(T, R, b, a) - ref) < 1e-12
                    for c in range(D):
                        if c not in (a, b):
                            assert abs(lat.wilson_loop(R, T, a, c) - 1.0) < 1e-13
                            assert abs(lat.wilson_loop(R, T, b, c) - 1.0) < 1e-13
            # Polyakov loop winding b at transverse position x: cos(L_b * B * x_a)
            pol = lat.polyakov_loops(b)
            rest = [ax for ax in range(D) if ax != b]
            xa = np.indices(pol.shape)[rest.index(a)]
            assert np.max(np.abs(pol - np.cos(shape[b] * B * xa))) < 1e-12
            for c in range(D):
                if c != b:
                    assert np.max(np.abs(lat.polyakov_loops(c) - 1.0)) < 1e-13


# ==============================================================================================
# 2. the sweeps are sequential, in the documented order, with FRESH staples
# ==============================================================================================
def _nb(shape, s, mu, d):
    x = list(np.unravel_index(s, shape))
    x[mu] = (x[mu] + d) % shape[mu]
    return int(np.ravel_multi_index(x, shape))


def _staple_one(m, shape, s, mu):
    """Staple of link (s, mu) from the matrix array m[V, D, 2, 2] with own index arithmetic."""
    a = np.zeros((2, 2), dtype=complex)
    xpm = _nb(shape, s, mu, 1)
    for nu in range(len(shape)):
        if nu == mu:
            continue
        xpn = _nb(shape, s, nu, 1)
        xmn = _nb(shape, s, nu, -1)
        xpmmn = _nb(shape, xpm, nu, -1)
        a += m[xpm, nu] @ dg(m[xpn, mu]) @ dg(m[s, nu])
        a += dg(m[xpmmn, nu]) @ dg(m[xmn, mu]) @ m[xmn, nu]
    return a


@pytest.mark.parametrize("shape,beta", [((2, 4), 3.0), ((2, 4, 6), 4.0), ((2, 2, 4, 2), 2.3)])
def test_heatbath_sweep_is_sequential_with_fresh_staples(shape, beta):
    """Re-play two heatbath sweeps link by link in Python: staples are recomputed from the
    CURRENT configuration with the independent reference, the new link comes from the engine's
    single-link sampler driven by the same RNG state.  Any stale/cached staple, any other
    visiting order or any hidden extra RNG consumption makes the two results differ."""
    lat = generic_config(shape, beta, SEED + 10)
    m = q2m(lat.U).copy()                       # (V, D, 2, 2)
    state = get_rng_state()
    heatbath_sweep_kernel(lat.U, lat.up, lat.dn, beta, 2)
    after_kernel = get_rng_state()
    set_rng_state(state)
    for _ in range(2):
        for s in range(lat.V):
            for mu in range(lat.D):
                a = m2q(_staple_one(m, shape, s, mu))
                m[s, mu] = q2m(np.array(heatbath_link(beta, (a[0], a[1], a[2], a[3]))))
    dev = float(np.max(np.abs(m - q2m(lat.U))))
    print("[seq] heatbath shape=%s: max |kernel - replay| = %.1e" % (shape, dev))
    assert dev < 1e-9
    # the replay consumed exactly the same number of random numbers
    assert get_rng_state() == after_kernel


@pytest.mark.parametrize("shape,beta", [((2, 4), 3.0), ((4, 2, 6), 4.0), ((2, 2, 4, 2), 2.3)])
def test_overrelaxation_is_sequential_exact_and_reversible(shape, beta):
    """Overrelaxation = sequential single-link reflections U -> V^+ U^+ V^+ (V = A/|A|, fresh
    staple).  Checked against the matrix reference; each reflection is an involution, so
    applying the reference reflections in REVERSE order must restore the original
    configuration; the action (reference implementation) is conserved."""
    lat = generic_config(shape, beta, SEED + 11)
    m0 = q2m(lat.U).copy()
    s_before = action_ref(field(lat), beta)
    state = get_rng_state()
    overrelax_sweep_kernel(lat.U, lat.up, lat.dn, 1)
    assert get_rng_state() == state             # overrelaxation uses no random numbers
    order = [(s, mu) for s in range(lat.V) for mu in range(lat.D)]

    def reflect(m, s, mu):
        a = _staple_one(m, shape, s, mu)
        v = a / math.sqrt(np.linalg.det(a).real)
        m[s, mu] = dg(v) @ dg(m[s, mu]) @ dg(v)

    m = m0.copy()
    for (s, mu) in order:
        reflect(m, s, mu)
    dev = float(np.max(np.abs(m - q2m(lat.U))))
    assert dev < 1e-12, dev
    assert float(np.sqrt(np.mean(np.abs(m - m0) ** 2))) > 0.1       # the links really moved
    s_after = action_ref(field(lat), beta)
    assert abs(s_after - s_before) < 1e-11 * s_before
    back = q2m(lat.U).copy()
    for (s, mu) in reversed(order):
        reflect(back, s, mu)
    rev = float(np.max(np.abs(back - m0)))
    print("[seq] overrelax shape=%s: |kernel - ref| = %.1e, reversibility defect = %.1e, "
          "|dS| = %.1e" % (shape, dev, rev, abs(s_after - s_before)))
    assert rev < 1e-11


# ==============================================================================================
# 3. random numbers
# ==============================================================================================
@njit
def _draw(n):
    out = np.empty(n)
    for i in range(n):
        out[i] = np.random.random()
    return out


def test_rng_reproducible_independent_streams_and_isolation_from_numpy():
    n = 200_000
    seeds = [0, 1, 2, 101, 102, 103, 104, SEED, SEED + 1, 2 ** 32 - 1]
    streams = []
    for sd in seeds:
        seed_numba(sd)
        streams.append(_draw(n))
    # reproducible, and Lattice(seed) seeds exactly like seed_numba(seed)
    seed_numba(seeds[3])
    assert np.array_equal(_draw(n), streams[3])
    Lattice((2, 2), 1.0, seeds[4])
    assert np.array_equal(_draw(n), streams[4])
    # uniform on [0, 1): moments, range, no exact 0/1 problems
    lim = 4.0
    for sd, x in zip(seeds, streams):
        assert x.min() >= 0.0 and x.max() < 1.0
        assert abs(x.mean() - 0.5) < lim * math.sqrt(1.0 / 12.0 / n)
        assert abs(np.mean((x - 0.5) ** 2) - 1.0 / 12.0) < lim * math.sqrt(1.0 / 180.0 / n)
        d = x - 0.5
        for lag in (1, 2, 3, 7):
            r = np.mean(d[:-lag] * d[lag:]) * 12.0
            assert abs(r) < lim / math.sqrt(n), (sd, lag, r)
    # different seeds (in particular neighbouring ones, as used in production): distinct and
    # uncorrelated streams, also when shifted against each other by a few draws
    worst = 0.0
    for i in range(len(seeds)):
        for j in range(i + 1, len(seeds)):
            a, b = streams[i] - 0.5, streams[j] - 0.5
            assert not np.array_equal(streams[i][:50], streams[j][:50])
            for lag in (0, 1, 2):
                r = np.mean(a[: n - lag] * b[lag:]) * 12.0
                worst = max(worst, abs(r) * math.sqrt(n))
    print("[rng] largest |cross-correlation| between streams: %.2f sigma (135 pairs*lags)"
          % worst)
    assert worst < 4.5          # 135 comparisons: 4.5 sigma keeps the false-alarm rate < 0.1%
    # numpy's global generator is neither read nor advanced by the engine
    results = []
    for np_seed in (1, 2):
        np.random.seed(np_seed)
        expect_next = np.random.RandomState(np_seed).random_sample(5)
        lat = Lattice((4, 4, 4), 2.0, SEED + 20)
        lat.hot_start()
        lat.update(2, 2)
        lat.random_gauge()
        results.append(lat.U.copy())
        assert np.array_equal(np.random.random_sample(5), expect_next)
    assert np.array_equal(results[0], results[1])
    # different engine seeds: uncorrelated hot starts
    lat_a = Lattice((6, 6, 6, 6), 2.0, 7)
    lat_a.hot_start()
    ua = lat_a.U.copy()
    lat_b = Lattice((6, 6, 6, 6), 2.0, 8)
    lat_b.hot_start()
    dots = np.sum(ua * lat_b.U, axis=-1).ravel()           # mean 0, variance 1/4 if independent
    assert abs(dots.mean()) < 4.0 * 0.5 / math.sqrt(dots.size)
    # copy() does not disturb the stream
    st = get_rng_state()
    lat_b.copy()
    assert get_rng_state() == st


# ==============================================================================================
# 4. the single-link heatbath: moments and chi^2 over ten decades of alpha
# ==============================================================================================
X0_ALPHAS = [1e-7, 1e-3, 0.2, 1.0, 1.9999, 2.0, 2.0001, 3.5, 15.0, 120.0, 5e3, 1e6]


def _x0_bin_probabilities(alpha, edges, small):
    """Exact bin probabilities of the density sqrt(1-x^2) exp(alpha x) by adaptive quadrature in
    theta (x = cos theta).  ``edges`` are increasing values of theta (small=True) or of
    s = sqrt(alpha (1 - x)) (small=False); the last bin extends to theta = pi."""
    def g(t):
        return math.sin(t) ** 2 * math.exp(alpha * (math.cos(t) - 1.0))
    if small:
        th = np.asarray(edges)
    else:
        th = np.arccos(np.clip(1.0 - np.asarray(edges) ** 2 / alpha, -1.0, 1.0))
    norm = math.pi * ive(1, alpha) / alpha if alpha > 1e-5 else 0.5 * math.pi * math.exp(-alpha)
    p = np.array([quad(g, th[i], th[i + 1], epsabs=0, epsrel=1e-11)[0]
                  for i in range(len(th) - 1)]) / norm
    return p


@pytest.mark.parametrize("alpha", X0_ALPHAS)
def test_x0_sampler_moments_and_chi2(alpha):
    """Density sqrt(1 - x^2) exp(alpha x): <x> = I2/I1, <x^2> = 1 - 3 I2/(alpha I1), and a
    chi^2 test of the histogram against quadrature.  Covers alpha -> 0, both sides of the
    Creutz / Kennedy-Pendleton switch, and very large alpha (where 1 - x ~ 1/alpha)."""
    n = 400_000
    seed_numba(SEED + 30 + X0_ALPHAS.index(alpha))
    x = sample_x0_array(alpha, n)
    assert np.all(np.isfinite(x)) and x.min() >= -1.0 and x.max() <= 1.0
    u = bessel_u(alpha) if alpha > 1e-5 else alpha / 4.0
    d = 1.0 - x                                   # work with 1 - x: no cancellation at large alpha
    m1_exact = 1.0 - u
    m2_exact = (2.0 - 2.0 * u - 3.0 * u / alpha) if alpha > 1e-5 else 1.25 - 2.0 * u
    z1 = (d.mean() - m1_exact) / (d.std(ddof=1) / math.sqrt(n))
    d2 = d * d
    z2 = (d2.mean() - m2_exact) / (d2.std(ddof=1) / math.sqrt(n))
    # histogram
    small = alpha < 5.0
    if small:
        edges = np.linspace(0.0, math.pi, 33)
        var = np.arccos(x)
    else:
        edges = np.concatenate((np.linspace(0.0, 3.2, 33), [math.sqrt(2.0 * alpha)]))
        var = np.sqrt(alpha * d)
    p = _x0_bin_probabilities(alpha, edges, small)
    assert abs(p.sum() - 1.0) < 1e-8, p.sum()
    counts = np.histogram(var, bins=edges)[0].astype(float)
    assert counts.sum() == n
    keep = p * n >= 25.0                          # merge sparsely populated bins into one
    obs = np.concatenate((counts[keep], [counts[~keep].sum()]))
    expc = np.concatenate((p[keep], [p[~keep].sum()])) * n
    if expc[-1] < 5.0:
        obs, expc = obs[:-1], expc[:-1] * (obs[:-1].sum() / expc[:-1].sum())
    chi2 = float(np.sum((obs - expc) ** 2 / expc))
    dof = len(obs) - 1
    pval = float(stats.chi2.sf(chi2, dof))
    print("[x0] alpha=%g: <1-x> pull %+.2f, <(1-x)^2> pull %+.2f, chi2/dof = %.1f/%d (p=%.3f)"
          % (alpha, z1, z2, chi2, dof, pval))
    assert abs(z1) < 4.0 and abs(z2) < 4.0
    assert pval > 1e-4


HB_LINK_CASES = [(0.1, 1e-120), (2.3, 1e-30), (50.0, 1e-3), (0.1, 0.5), (2.3, 3.0), (50.0, 6.0),
                 (2.3, 1e-99)]


@pytest.mark.parametrize("beta,knorm", HB_LINK_CASES)
def test_heatbath_link_conditional_distribution_adversarial_staples(beta, knorm):
    """U ~ exp(beta (U A)_0) for staples of wildly different norm: X = U A/|A| (computed with
    matrices) must have <x0> = I2/I1(beta |A|), an isotropic vector part uncorrelated with x0,
    and U must be exactly unitary."""
    n = 200_000
    case = HB_LINK_CASES.index((beta, knorm))
    rng = np.random.default_rng(SEED + 40 + case)
    a = rng.normal(size=4)
    a *= knorm / np.linalg.norm(a)
    seed_numba(SEED + 400 + case)
    unew = heatbath_link_array(beta, a, n)
    assert np.all(np.isfinite(unew))
    assert np.max(np.abs(np.sum(unew * unew, axis=1) - 1.0)) < 1e-14
    xq = m2q(q2m(unew) @ q2m(a / np.linalg.norm(a)))
    x0, xv = xq[:, 0], xq[:, 1:]
    alpha = beta * knorm
    u = bessel_u(alpha) if alpha > 1e-5 else alpha / 4.0
    z = (np.mean(1.0 - x0) - (1.0 - u)) / (np.std(1.0 - x0, ddof=1) / math.sqrt(n))
    nhat = xv / np.linalg.norm(xv, axis=1)[:, None]
    zdir = nhat.mean(axis=0) * math.sqrt(3.0 * n)
    second = nhat.T @ nhat / n
    zdiag = (np.diag(second) - 1.0 / 3.0) / math.sqrt(4.0 / 45.0 / n)
    zoff = second[np.triu_indices(3, 1)] / math.sqrt(1.0 / 15.0 / n)
    zcorr = np.array([np.corrcoef(x0, nhat[:, i])[0, 1] for i in range(3)]) * math.sqrt(n)
    print("[hb] beta=%g |A|=%g: x0 pull %+.2f, direction pulls %s / %s / %s, x0-direction %s"
          % (beta, knorm, z, np.round(zdir, 2), np.round(zdiag, 2), np.round(zoff, 2),
             np.round(zcorr, 2)))
    assert abs(z) < 4.0
    assert np.all(np.abs(zdir) < 4.0) and np.all(np.abs(zdiag) < 4.0)
    assert np.all(np.abs(zoff) < 4.0) and np.all(np.abs(zcorr) < 4.0)


# ==============================================================================================
# 5. Schwinger-Dyson identities: equilibrium checks that need no reference numbers
# ==============================================================================================
def sd_residuals(f, beta):
    """For every direction mu, the lattice averages of
        r1 = (U A)_0 - |A| I2/I1(beta |A|)
        r2 = 3 (U A)_0 - beta (|A|^2 - (U A)_0^2)
    Both have expectation zero in the Boltzmann ensemble for EVERY link (invariance of the Haar
    measure of that link); r2 is the textbook Schwinger-Dyson equation, r1 its Bessel-function
    form.  Everything is computed with the independent matrix reference."""
    D = f.shape[-3]
    r1 = np.empty(D)
    r2 = np.empty(D)
    for mu in range(D):
        a = staple_field(f, mu)
        w0 = htr(f[..., mu, :, :] @ a)
        k2 = (a[..., 0, 0] * a[..., 1, 1] - a[..., 0, 1] * a[..., 1, 0]).real
        k = np.sqrt(k2)
        r1[mu] = np.mean(w0 - k * bessel_u(beta * k))
        r2[mu] = np.mean(3.0 * w0 - beta * (k2 - w0 * w0))
    return r1, r2


@njit
def _hb_stale_sweep(U, up, dn, beta, nsweep):
    """DELIBERATELY WRONG heatbath: the D staples of a site are computed first and the D links
    are then updated with these stale staples (the kind of bug a 'cache the staples'
    optimisation produces).  Used only to show that the tests reject it."""
    V = U.shape[0]
    D = U.shape[1]
    st = np.empty((D, 4))
    for _ in range(nsweep):
        for s in range(V):
            for mu in range(D):
                a = staple_sum(U, up, dn, s, mu)
                st[mu, 0] = a[0]
                st[mu, 1] = a[1]
                st[mu, 2] = a[2]
                st[mu, 3] = a[3]
            for mu in range(D):
                q = heatbath_link(beta, (st[mu, 0], st[mu, 1], st[mu, 2], st[mu, 3]))
                U[s, mu, 0] = q[0]
                U[s, mu, 1] = q[1]
                U[s, mu, 2] = q[2]
                U[s, mu, 3] = q[3]


def sd_run(shape, beta, seed, start, n_or, n_meas, mode="engine", n_therm=200):
    """Returns (pulls of r1 per direction, pulls of r2 per direction, pull and error of the
    all-direction averages)."""
    lat = Lattice(shape, beta, seed)
    if start == "hot":
        lat.hot_start()

    def update():
        if mode == "engine":
            lat.heatbath_sweep(1)
        elif mode == "beta_2_percent_low":      # sampler run at 0.98 beta, identity tested at beta
            heatbath_sweep_kernel(lat.U, lat.up, lat.dn, 0.98 * beta, 1)
        elif mode == "stale_staples":
            _hb_stale_sweep(lat.U, lat.up, lat.dn, beta, 1)
        else:
            raise ValueError(mode)
        if n_or:
            lat.overrelax_sweep(n_or)

    for _ in range(n_therm):
        update()
    r1 = np.empty((n_meas, lat.D))
    r2 = np.empty((n_meas, lat.D))
    for i in range(n_meas):
        update()
        r1[i], r2[i] = sd_residuals(field(lat), beta)
    nb = 40
    out = {}
    for name, r in (("r1", r1), ("r2", r2)):
        per_dir = np.array([r[:, mu].mean() / bin_err(r[:, mu], nb) for mu in range(lat.D)])
        tot = r.mean(axis=1)
        tau = max(tau_int(tot), 0.5)
        assert n_meas // nb >= 10.0 * tau, "SD %s: bins shorter than 10 tau_int (%.1f)" % (
            name, tau)
        err = bin_err(tot, nb)
        out[name] = (per_dir, tot.mean() / err, err, tot.mean())
    return out


# (1.5 x the errors of an exploratory run with another seed, scaled to the run length)
SD_PROD_SIGMA_D3 = 3.5e-4
SD_PROD_SIGMA_D4 = 8.5e-4

SD_CASES = {
    # name: (shape, beta, start, n_or, n_meas, required sigma of the all-direction <r1>);
    # the precision requirements are 1.5 x the errors of an exploratory run with another seed
    "D2_6x10_b3": ((6, 10), 3.0, "hot", 1, 4000, 1.5e-3),
    "D3_4x6x8_b5": ((4, 6, 8), 5.0, "hot", 1, 1600, 6.5e-4),
    "D3_2x4x6_b1.2_pureHB_cold": ((2, 4, 6), 1.2, "cold", 0, 4000, 3.2e-3),
    "D4_4x4x6x6_b2.3": ((4, 4, 6, 6), 2.3, "hot", 1, 800, 8.5e-4),
    "D4_2x4x6x4_b2.6_pureHB_cold": ((2, 4, 6, 4), 2.6, "cold", 0, 1200, 9.5e-4),
}


@pytest.mark.parametrize("name", list(SD_CASES))
def test_schwinger_dyson_identities(name):
    shape, beta, start, n_or, n_meas, sig_max = SD_CASES[name]
    out = sd_run(shape, beta, SEED + 50 + list(SD_CASES).index(name), start, n_or, n_meas)
    for key in ("r1", "r2"):
        per_dir, pull, err, mean = out[key]
        print("[SD] %s %s: per-direction pulls %s ; all: %+.2e +- %.1e (%+.2f sigma)" % (
            name, key, np.round(per_dir, 2), mean, err, pull))
        assert np.all(np.abs(per_dir) < 4.0)
        assert abs(pull) < 4.0
    assert out["r1"][2] <= sig_max           # precision requirement (teeth: see next test)


SD_PRODUCTION = {
    # the couplings and the update scheme (1 heatbath + 4 overrelaxation sweeps) of the
    # production ensembles, on small volumes (the identities hold in any volume);
    # name: (shape, beta, n_meas, required sigma of the all-direction <r1>)
    "D3_b6.0": ((8, 8, 8), 6.0, 1200, SD_PROD_SIGMA_D3),
    "D3_b9.0": ((8, 8, 8), 9.0, 1200, SD_PROD_SIGMA_D3),
    "D3_b12.0": ((8, 8, 8), 12.0, 1200, SD_PROD_SIGMA_D3),
    "D4_b2.3": ((6, 6, 6, 6), 2.3, 480, SD_PROD_SIGMA_D4),
    "D4_b2.4": ((6, 6, 6, 6), 2.4, 480, SD_PROD_SIGMA_D4),
    "D4_b2.5": ((6, 6, 6, 6), 2.5, 480, SD_PROD_SIGMA_D4),
}


@pytest.mark.parametrize("name", list(SD_PRODUCTION))
def test_schwinger_dyson_at_production_couplings(name):
    """The update scheme used in production (1 HB + 4 OR) at the six production couplings."""
    shape, beta, n_meas, sig_max = SD_PRODUCTION[name]
    out = sd_run(shape, beta, SEED + 500 + list(SD_PRODUCTION).index(name), "hot", 4, n_meas)
    for key in ("r1", "r2"):
        per_dir, pull, err, mean = out[key]
        print("[SD prod] %s 1HB+4OR %s: per-direction pulls %s ; all: %+.2e +- %.1e "
              "(%+.2f sigma)" % (name, key, np.round(per_dir, 2), mean, err, pull))
        assert np.all(np.abs(per_dir) < 4.0)
        assert abs(pull) < 4.0
    assert out["r1"][2] <= sig_max


@pytest.mark.parametrize("mode,min_pull", [("beta_2_percent_low", 6.0), ("stale_staples", 20.0)])
def test_schwinger_dyson_test_has_teeth(mode, min_pull):
    """The same test with a deliberately broken update must fail clearly: a sampler that uses a
    coupling 2% too small, and a heatbath with per-site stale staples (exploratory run with
    another seed: 14 and 74 sigma respectively)."""
    shape, beta, start, n_or, n_meas, _ = SD_CASES["D3_4x6x8_b5"]
    out = sd_run(shape, beta, SEED + 60, start, n_or, n_meas, mode=mode)
    print("[SD teeth] %s: r1 %+.1f sigma, r2 %+.1f sigma" % (mode, out["r1"][1], out["r2"][1]))
    assert abs(out["r1"][1]) > min_pull
    assert abs(out["r2"][1]) > min_pull


# ==============================================================================================
# 6. D = 2 on tiny tori at extreme couplings, measured with an independent kernel
# ==============================================================================================
@njit
def _cmul(a, b, c, d):
    """Product of SU(2) matrices stored as (a, b) ~ [[a, b], [-conj(b), conj(a)]]."""
    return a * c - b * np.conj(d), a * d + b * np.conj(c)


@njit
def _clink(U, s, mu):
    return complex(U[s, mu, 0], U[s, mu, 3]), complex(U[s, mu, 2], U[s, mu, 1])


@njit
def _d2_measure(U, L0, L1, pol0, pol1):
    """Independent D=2 measurement (site index x0*L1 + x1): returns the mean plaquette and
    fills pol0[x1] = (1/2)Tr of the loop winding axis 0, pol1[x0] = loop winding axis 1."""
    tot = 0.0
    for x0 in range(L0):
        for x1 in range(L1):
            s = x0 * L1 + x1
            s0 = ((x0 + 1) % L0) * L1 + x1
            s1 = x0 * L1 + (x1 + 1) % L1
            a, b = _clink(U, s, 0)
            c, d = _clink(U, s0, 1)
            a, b = _cmul(a, b, c, d)
            c, d = _clink(U, s1, 0)
            a, b = _cmul(a, b, np.conj(c), -d)          # times U_0(x+1)^dagger
            c, d = _clink(U, s, 1)
            a, b = _cmul(a, b, np.conj(c), -d)          # times U_1(x)^dagger
            tot += a.real
    for x1 in range(L1):
        a = complex(1.0, 0.0)
        b = complex(0.0, 0.0)
        for x0 in range(L0):
            c, d = _clink(U, x0 * L1 + x1, 0)
            a, b = _cmul(a, b, c, d)
        pol0[x1] = a.real
    for x0 in range(L0):
        a = complex(1.0, 0.0)
        b = complex(0.0, 0.0)
        for x1 in range(L1):
            c, d = _clink(U, x0 * L1 + x1, 1)
            a, b = _cmul(a, b, c, d)
        pol1[x0] = a.real
    return tot / (L0 * L1)


@njit
def _d2_run(U, up, dn, beta, L0, L1, n_therm, n_meas, n_hb, n_or, out):
    """out[i] = (P, C1(1), C1(2), C0(1), C0(2)); C1 = correlator of loops winding axis 1
    separated along axis 0, C0 = loops winding axis 0 separated along axis 1."""
    pol0 = np.empty(L1)
    pol1 = np.empty(L0)
    for i in range(-n_therm, n_meas):
        heatbath_sweep_kernel(U, up, dn, beta, n_hb)
        if n_or > 0:
            overrelax_sweep_kernel(U, up, dn, n_or)
        if i < 0:
            continue
        out[i, 0] = _d2_measure(U, L0, L1, pol0, pol1)
        for tau in (1, 2):
            c = 0.0
            for t in range(L0):
                c += pol1[t] * pol1[(t + tau) % L0]
            out[i, tau] = c / L0
            c = 0.0
            for t in range(L1):
                c += pol0[t] * pol0[(t + tau) % L1]
            out[i, 2 + tau] = c / L1


def test_independent_d2_measurement_kernel_agrees_with_reference():
    lat = generic_config((4, 6), 2.0, SEED + 70)
    pol0 = np.empty(6)
    pol1 = np.empty(4)
    p = _d2_measure(lat.U, 4, 6, pol0, pol1)
    f = field(lat)
    assert abs(p - plaq_field(f, 0, 1).mean()) < 1e-13
    assert np.max(np.abs(pol0 - polyakov_ref(f, 0))) < 1e-13
    assert np.max(np.abs(pol1 - polyakov_ref(f, 1))) < 1e-13


D2_TINY = {
    # name: (shape, beta, n_hb, n_or, n_meas, sigma_P required, sigma_C required,
    #        finite-volume / higher-representation effects large enough to demand resolution)
    "2x2_b50": ((2, 2), 50.0, 1, 1, 600_000, 3e-5, 4.5e-3, True),
    "2x2_b50_pureHB": ((2, 2), 50.0, 1, 0, 600_000, 3e-5, 4.5e-3, True),
    "4x4_b20": ((4, 4), 20.0, 1, 1, 300_000, 6e-5, 2.2e-3, True),
    "2x6_b12": ((2, 6), 12.0, 1, 1, 300_000, 1.0e-4, 2.2e-3, True),
    "6x2_b12": ((6, 2), 12.0, 1, 1, 300_000, 1.0e-4, 2.2e-3, True),
    "4x6_b6_1hb_6or": ((4, 6), 6.0, 1, 6, 150_000, 2.0e-4, 6.5e-4, False),
    "4x4_b0.1": ((4, 4), 0.1, 1, 0, 600_000, 3e-4, 5e-4, False),
}


@pytest.mark.parametrize("name", list(D2_TINY))
def test_d2_tiny_torus_extreme_couplings(name):
    """Exact finite-torus results (all representations) at beta = 0.1 ... 50 on lattices with
    4 to 24 plaquettes: the plaquette, its VARIANCE (N_p var(P) = dP/dbeta, the second
    cumulant of the action) and the torelon correlators in BOTH directions.  At large beta the
    finite-volume terms are large, so P = u(beta) or the leading-representation correlator
    would fail by many sigma; on 2x6 vs 6x2 an exchange of the two axes would fail as well."""
    shape, beta, n_hb, n_or, n, sig_p, sig_c, resolve = D2_TINY[name]
    L0, L1 = shape
    n_plaq = L0 * L1
    lat = Lattice(shape, beta, SEED + 80 + list(D2_TINY).index(name))
    lat.hot_start()
    out = np.empty((n, 5))
    _d2_run(lat.U, lat.up, lat.dn, beta, L0, L1, 2000, n, n_hb, n_or, out)
    assert lat.unitarity_violation() < 1e-13
    # plaquette
    p, perr, ptau = estimate(out[:, 0], name + " P")
    ref = exact.plaquette_2d_torus(beta, n_plaq)
    uu = bessel_u(beta)
    print("[d2] %s: P = %.6f +- %.1e (tau %.1f) ; exact torus %.6f (%+.2f sigma) ; u = %.6f "
          "(%+.1f sigma)" % (name, p, perr, ptau, ref, (p - ref) / perr, uu, (p - uu) / perr))
    assert perr <= sig_p
    assert abs(p - ref) < 4.0 * perr
    if resolve:
        assert abs(ref - uu) > 10.0 * perr          # the finite-volume effect is resolved
    # second cumulant: N_p * var(P) = dP/dbeta (derivative of the exact formula)
    h = 1e-4 * beta
    dpdb = (exact.plaquette_2d_torus(beta + h, n_plaq)
            - exact.plaquette_2d_torus(beta - h, n_plaq)) / (2.0 * h)
    v, verr, _ = estimate(n_plaq * (out[:, 0] - ref) ** 2, name + " var")
    print("[d2] %s: N_p var(P) = %.6g +- %.1e ; exact dP/dbeta = %.6g (%+.2f sigma) ; "
          "infinite-volume u' = %.6g" % (name, v, verr, dpdb, (v - dpdb) / verr,
                                         1.0 - uu * uu - 3.0 * uu / beta))
    assert verr <= 0.006 * dpdb                     # variance measured to better than 0.6%
    assert abs(v - dpdb) < 4.0 * verr
    # torelon correlators: loops winding axis 1 (length L1) separated along axis 0, and v.v.
    for tau in (1, 2):
        for col, (Lw, Lsep) in ((tau, (L1, L0)), (2 + tau, (L0, L1))):
            c, cerr, ctau = estimate(out[:, col], "%s C tau=%d" % (name, tau))
            cref = exact.torelon_correlator_2d_torus(beta, Lw, Lsep, tau)
            lead = exact.torelon_correlator_2d(beta, Lw, Lsep, tau)
            swapped = exact.torelon_correlator_2d_torus(beta, Lsep, Lw, tau)
            print("[d2] %s: loops of length %d, separation %d (extent %d): C = %.6f +- %.1e "
                  "(tau %.1f) ; exact %.6f (%+.2f sigma) ; leading-rep %.6f ; axes swapped "
                  "%.6f" % (name, Lw, tau, Lsep, c, cerr, ctau, cref, (c - cref) / cerr, lead,
                            swapped))
            assert cerr <= sig_c
            assert abs(c - cref) < 4.0 * cerr
            if resolve:
                assert abs(cref - lead) > 5.0 * cerr    # higher representations are resolved
            if resolve and L0 != L1:
                assert abs(cref - swapped) > 8.0 * cerr  # an axis mix-up would be seen


def test_d2_one_plaquette_distribution_and_independence():
    """In D = 2 the plaquettes are independent with density sin^2(theta) exp(beta cos theta)
    (torus corrections ~ u^144 here).  Checks the WHOLE one-plaquette distribution (16 bins) and
    the absence of correlations between neighbouring plaquettes."""
    shape, beta = (12, 12), 2.0
    lat = Lattice(shape, beta, SEED + 100)
    lat.hot_start()
    lat.update(200, 1)
    n_conf, skip = 3840, 4
    edges = np.linspace(0.0, math.pi, 17)
    norm = math.pi * ive(1, beta) / beta
    pbin = np.array([quad(lambda t: math.sin(t) ** 2 * math.exp(beta * (math.cos(t) - 1.0)),
                          edges[i], edges[i + 1], epsabs=0, epsrel=1e-11)[0]
                     for i in range(16)]) / norm
    assert abs(pbin.sum() - 1.0) < 1e-9
    hist = np.empty((n_conf, 16))
    corr = np.empty((n_conf, 3))
    uu = bessel_u(beta)
    for i in range(n_conf):
        lat.update(skip, 1)
        c = plaq_field(field(lat), 0, 1)
        hist[i] = np.histogram(np.arccos(np.clip(c, -1.0, 1.0)), bins=edges)[0] / c.size
        corr[i, 0] = np.mean(c * np.roll(c, -1, axis=0)) - uu * uu
        corr[i, 1] = np.mean(c * np.roll(c, -1, axis=1)) - uu * uu
        corr[i, 2] = np.mean(c * np.roll(np.roll(c, -1, axis=0), -1, axis=1)) - uu * uu
    zb = np.empty(16)
    for b in range(16):
        m, e, _ = estimate(hist[:, b], "bin %d" % b)
        zb[b] = (m - pbin[b]) / e
    zc = np.empty(3)
    for j in range(3):
        m, e, _ = estimate(corr[:, j], "corr %d" % j)
        zc[j] = m / e
        assert e < 5e-4
    print("[d2] one-plaquette distribution, 16 bins in theta: pulls %s" % np.round(zb, 2))
    print("[d2] neighbour correlations <c c'> - u^2 (axis 0, axis 1, diagonal): pulls %s"
          % np.round(zc, 2))
    assert np.all(np.abs(zb) < 4.0)
    assert np.all(np.abs(zc) < 4.0)


# ==============================================================================================
# 7. D = 3 with two extents equal to 2: strong coupling with wrapping surfaces
# ==============================================================================================
@njit
def _plaq_run(U, up, dn, beta, n_therm, n_meas, out):
    n_plaq = U.shape[0] * U.shape[1] * (U.shape[1] - 1) // 2
    heatbath_sweep_kernel(U, up, dn, beta, n_therm)
    for i in range(n_meas):
        heatbath_sweep_kernel(U, up, dn, beta, 1)
        out[i] = plaquette_sum_kernel(U, up) / n_plaq


def d3_22L_prediction(beta):
    """Strong-coupling prediction for the plaquette on a 2 x 2 x L lattice (L >= 4), derived by
    the reviewer; a PREDICTION to be tested, not a theorem.

    ln Z = N_p ln f_0 + sum over closed surfaces.  Besides the 4 L cubes (sphere: 4 u^6 each)
    the lattice contains L closed surfaces that do not exist in a large volume: the four
    (0,1)-plaquettes at fixed x2 form a TORUS (weight d^0 u^4 = u^4).  With N_p = 12 L:
        P = u + u^3 u'/3 + 8 u^5 u' + O(u^7 u').
    The next terms are tori of 8 plaquettes; their size is returned as the truncation scale."""
    u = bessel_u(beta)
    du = 1.0 - u * u - 3.0 * u / beta
    return u, u ** 3 * du / 3.0, 8.0 * u ** 5 * du, 8.0 * u ** 7 * du


def test_d3_extent2_strong_coupling_wrapping_tori():
    shape, beta, n = (2, 2, 8), 0.8, 600_000
    lat = Lattice(shape, beta, SEED + 110)
    lat.hot_start()
    out = np.empty(n)
    _plaq_run(lat.U, lat.up, lat.dn, beta, 500, n, out)
    p, err, tau = estimate(out, "D3 2x2x8")
    u, t_torus, t_cube, t_next = d3_22L_prediction(beta)
    pred = u + t_torus + t_cube
    bulk = exact.plaquette_strong_coupling(beta, 3)
    print("[sc] D=3 2x2x8 beta=%g: P = %.6f +- %.1e (tau %.2f) ; prediction u + u^3u'/3 + "
          "8u^5u' = %.6f (%+.2f sigma) ; infinite-volume formula %.6f (%+.1f sigma) ; torus "
          "term %.2e, next order ~ %.1e" % (beta, p, err, tau, pred, (p - pred) / err, bulk,
                                           (p - bulk) / err, t_torus, t_next))
    assert err <= 9e-5
    assert abs(t_torus) > 6.0 * err                       # the wrapping term is resolved
    assert abs(p - pred) <= 4.0 * err + 4.0 * t_next      # truncation allowance fixed a priori
    assert abs(p - bulk) > 0.5 * t_torus                  # the bulk formula alone is NOT right


# ==============================================================================================
# 8. ym/exact.py: every formula against an independent numerical evaluation
# ==============================================================================================
def test_exact_bessel_identities_and_asymptotics():
    for beta in (1e-3, 0.05, 0.3, 1.0, 2.5, 8.0, 50.0, 500.0):
        uu = exact.u(beta)
        assert uu == pytest.approx(iv(2, beta) / iv(1, beta), rel=1e-12)
        # recurrence I_{n-1} - I_{n+1} = (2n/beta) I_n in terms of lambda_j
        # (lambda_j(beta, twoj) = I_{twoj+1}/I_1, so I_n/I_1 = lambda_j(beta, n-1) for n >= 1)
        for n in (1, 2, 3, 4):
            lam_m = exact.lambda_j(beta, n - 2) if n >= 2 else ive(0, beta) / ive(1, beta)
            lam_0 = exact.lambda_j(beta, n - 1)
            lam_p = exact.lambda_j(beta, n)
            assert lam_m - lam_p == pytest.approx(2.0 * n / beta * lam_0, rel=1e-9)
        assert exact.lambda_j(beta, 0) == 1.0
        assert exact.lambda_j(beta, 1) == pytest.approx(uu, rel=1e-13)
        # derivative by Richardson-extrapolated central differences
        h = 1e-3 * beta
        d1 = (exact.u(beta + h) - exact.u(beta - h)) / (2 * h)
        d2 = (exact.u(beta + 2 * h) - exact.u(beta - 2 * h)) / (4 * h)
        assert exact.du_dbeta(beta) == pytest.approx((4 * d1 - d2) / 3, rel=2e-7)
        # character coefficients by quadrature: f_j = int dU chi_j(U) exp(beta cos)/d_j
        # (coefficients below 1e-4 are skipped: the quadrature is then dominated by cancellation)
        for twoj in range(6):
            ref = 2.0 / beta * ive(twoj + 1, beta)
            if ref < 1e-4:
                continue
            num = quad(lambda t: math.sin(t) * math.sin((twoj + 1) * t)
                       * math.exp(beta * (math.cos(t) - 1.0)), 0.0, math.pi,
                       epsabs=1e-14, epsrel=1e-10, limit=200)[0] * (2.0 / math.pi) / (twoj + 1)
            assert num == pytest.approx(ref, rel=1e-8)
        f0 = 2.0 / beta * ive(1, beta)
        assert exact.lambda_j(beta, 3) == pytest.approx(2.0 / beta * ive(4, beta) / f0, rel=1e-12)
    # asymptotic expansions
    for beta in (200.0, 1e3, 1e5):
        assert exact.u(beta) == pytest.approx(1 - 1.5 / beta + 0.375 / beta ** 2,
                                              abs=1.0 / beta ** 3)
        assert exact.string_tension_2d(beta) == pytest.approx(1.5 / beta, rel=2.0 / beta)
    for beta in (1e-6, 1e-3, 0.02):
        assert exact.u(beta) == pytest.approx(beta / 4 - beta ** 3 / 96, abs=beta ** 5 / 1000)
        assert exact.du_dbeta(beta) == pytest.approx(0.25 - beta ** 2 / 32, abs=beta ** 4 / 100)
    # continuity across the internal series switch at beta = 1e-4
    assert exact.u(1e-4 * (1 - 1e-9)) == pytest.approx(exact.u(1e-4 * (1 + 1e-9)), rel=1e-8)
    assert exact.du_dbeta(1e-4 * (1 - 1e-9)) == pytest.approx(exact.du_dbeta(1e-4 * (1 + 1e-9)),
                                                             rel=1e-8)
    # strong-coupling series: D = 2 exact, coefficients as documented, small-beta behaviour
    for beta in (0.4, 1.0):
        uu, du = exact.u(beta), exact.du_dbeta(beta)
        assert exact.plaquette_strong_coupling(beta, 2, order=2) == uu
        for D in (3, 4):
            assert exact.plaquette_strong_coupling(beta, D, order=2) == pytest.approx(
                uu + 8 * (D - 2) * uu ** 5 * du + 40 * (D - 2) * (2 * D - 5) * uu ** 9 * du,
                rel=1e-14)


def test_exact_two_loop_scaling_constants():
    """b0 = 11 N / (48 pi^2), b1 = (34/3) N^2 / (16 pi^2)^2 for N = 2; the closed form must be a
    solution of a dg/da = b0 g^3 + b1 g^5 + O(g^7) (i.e. mu dg/dmu = -b0 g^3 - b1 g^5)."""
    N = 2
    b0 = 11.0 * N / (48.0 * math.pi ** 2)
    b1 = (34.0 / 3.0) * N ** 2 / (16.0 * math.pi ** 2) ** 2
    assert exact.B0_SU2 == pytest.approx(b0, rel=1e-14)
    assert exact.B1_SU2 == pytest.approx(b1, rel=1e-14)
    assert b1 / (2 * b0 ** 2) == pytest.approx(51.0 / 121.0, rel=1e-13)
    # d ln(a Lambda)/d beta = -3 pi^2/11 + (51/121)/beta
    for beta in (2.2, 2.5, 3.0, 10.0):
        h = 1e-4
        dl = (math.log(exact.a_lambda_two_loop(beta + h))
              - math.log(exact.a_lambda_two_loop(beta - h))) / (2 * h)
        assert dl == pytest.approx(-3 * math.pi ** 2 / 11 + (51.0 / 121.0) / beta, rel=1e-7)
    # reconstruct the beta function from the formula at weak coupling
    for g2 in (0.05, 0.03, 0.02):             # beta = 80 ... 200 (a*Lambda underflows beyond ~270)
        g = math.sqrt(g2)
        h = 1e-5 * g

        def ln_a(gg):
            return math.log(exact.a_lambda_two_loop(4.0 / gg ** 2))
        beta_fn = 1.0 / ((ln_a(g + h) - ln_a(g - h)) / (2 * h))        # = a dg/da
        assert beta_fn == pytest.approx(b0 * g ** 3, rel=2 * b1 / b0 * g2)
        c1 = (beta_fn - b0 * g ** 3) / g ** 5
        assert c1 == pytest.approx(b1, rel=3 * (b1 / b0) * g2 + 2e-3)
    # an explicit number (hand calculation: (6 pi^2 * 2.5/11)^(51/121) exp(-7.5 pi^2/11))
    assert exact.a_lambda_two_loop(2.5) == pytest.approx(
        math.exp((51.0 / 121.0) * math.log(15.0 * math.pi ** 2 / 11.0) - 7.5 * math.pi ** 2 / 11.0),
        rel=1e-13)
    r = exact.a_lambda_two_loop(2.4) / exact.a_lambda_two_loop(2.5)
    assert r == pytest.approx(math.exp(0.3 * math.pi ** 2 / 11) * (2.4 / 2.5) ** (51.0 / 121.0),
                              rel=1e-12)


def _haar_q(rng, n):
    q = rng.normal(size=(n, 4))
    q /= np.linalg.norm(q, axis=1)[:, None]
    return q


def _qm(a, b):
    """Vectorised quaternion product a*b in the project convention, (ab)_0 = a0 b0 - a.b,
    (ab)_vec = a0 b + b0 a - a x b.  Independent of the engine's njit helpers and verified
    against 2x2 matrices inside the test that uses it."""
    out = np.empty_like(a)
    out[:, 0] = a[:, 0] * b[:, 0] - a[:, 1] * b[:, 1] - a[:, 2] * b[:, 2] - a[:, 3] * b[:, 3]
    out[:, 1] = a[:, 0] * b[:, 1] + b[:, 0] * a[:, 1] - (a[:, 2] * b[:, 3] - a[:, 3] * b[:, 2])
    out[:, 2] = a[:, 0] * b[:, 2] + b[:, 0] * a[:, 2] - (a[:, 3] * b[:, 1] - a[:, 1] * b[:, 3])
    out[:, 3] = a[:, 0] * b[:, 3] + b[:, 0] * a[:, 3] - (a[:, 1] * b[:, 2] - a[:, 2] * b[:, 1])
    return out


def _qd(a):
    out = a.copy()
    out[:, 1:] *= -1.0
    return out


def _weighted(obs, w, nb=50):
    """Reweighted mean sum(obs w)/sum(w) with a jackknife error over nb blocks."""
    n = (len(w) // nb) * nb
    so = (obs[:n] * w[:n]).reshape(nb, -1).sum(axis=1)
    sw = w[:n].reshape(nb, -1).sum(axis=1)
    full = so.sum() / sw.sum()
    jk = (so.sum() - so) / (sw.sum() - sw)
    return full, math.sqrt((nb - 1) / nb * np.sum((jk - jk.mean()) ** 2))


def test_exact_torus_formulas_against_brute_force_haar_integration():
    """No Markov chain, no staples, no engine: i.i.d. Haar links + reweighting with exp(beta
    sum_p c_p) on the 1x1, 1x2 and 2x2 torus.  Validates the all-representation torus formulas
    of ym/exact.py (on which the D = 2 engine tests rely) from first principles."""
    rng = np.random.default_rng(SEED + 120)
    a, b = _haar_q(rng, 2000), _haar_q(rng, 2000)
    assert np.max(np.abs(q2m(_qm(a, b)) - q2m(a) @ q2m(b))) < 1e-14
    assert np.max(np.abs(q2m(_qd(a)) - dg(q2m(a)))) < 1e-15
    n = 1_000_000
    worst = 0.0

    def check(label, value, err, ref, plain, resolved=5.0):
        nonlocal worst
        z = (value - ref) / err
        worst = max(worst, abs(z))
        print("[haar] %s: %.5f +- %.5f ; exact torus formula %.5f (%+.2f sigma) ; "
              "infinite-volume/leading-representation %.5f" % (label, value, err, ref, z, plain))
        assert abs(z) < 4.0
        assert abs(ref - plain) > resolved * err

    for beta in (1.0, 2.5):
        uu = bessel_u(beta)
        # ---- 1x1 torus: links S (space), T (time); plaquette S T S^+ T^+ ------------------
        s, t = _haar_q(rng, n), _haar_q(rng, n)
        c = _qm(_qm(s, t), _qd(_qm(t, s)))[:, 0]
        w = np.exp(beta * (c - 1.0))
        # Z_1 = sum_j f_j: NO dimension factors on the torus (a sphere would have d_j^2)
        z_mc, z_err = w.mean(), w.std(ddof=1) / math.sqrt(n)
        orders = np.arange(1, 60)
        z_ref = float(np.sum(2.0 / beta * ive(orders, beta)))
        z_sphere = float(np.sum(orders ** 2 * 2.0 / beta * ive(orders, beta)))
        print("[haar] 1x1 beta=%g: Z e^-beta = %.5f +- %.5f ; sum_j f_j = %.5f ; "
              "sum_j d_j^2 f_j = %.5f" % (beta, z_mc, z_err, z_ref, z_sphere))
        assert abs(z_mc - z_ref) < 4.0 * z_err and abs(z_sphere - z_ref) > 100.0 * z_err
        v, e = _weighted(c, w)
        check("1x1 beta=%g plaquette" % beta, v, e, exact.plaquette_2d_torus(beta, 1), uu)
        v, e = _weighted(s[:, 0] ** 2, w)
        check("1x1 beta=%g <p p>" % beta, v, e, exact.torelon_correlator_2d_torus(beta, 1, 1, 0),
              exact.torelon_correlator_2d(beta, 1, 1, 0))
        # ---- 1 (space) x 2 (time) torus ----------------------------------------------------
        s0, s1, t0, t1 = (_haar_q(rng, n) for _ in range(4))
        c0 = _qm(_qm(s0, t0), _qd(_qm(t0, s1)))[:, 0]
        c1 = _qm(_qm(s1, t1), _qd(_qm(t1, s0)))[:, 0]
        w = np.exp(beta * (c0 + c1 - 2.0))
        v, e = _weighted(0.5 * (c0 + c1), w)
        check("1x2 beta=%g plaquette" % beta, v, e, exact.plaquette_2d_torus(beta, 2), uu)
        assert exact.wilson_loop_2d_torus(beta, 1, 2) == pytest.approx(
            exact.plaquette_2d_torus(beta, 2), rel=1e-12)
        v, e = _weighted(s0[:, 0] * s1[:, 0], w)
        check("1x2 beta=%g <p(0) p(1)>" % beta, v, e,
              exact.torelon_correlator_2d_torus(beta, 1, 2, 1),
              exact.torelon_correlator_2d(beta, 1, 2, 1))
    # ---- 2x2 torus (8 links), the smallest lattice the engine can simulate -----------------
    beta = 1.5
    obs_p, obs_c, wts = [], [], []
    for _ in range(4):
        m = 500_000
        lk = {(x0, x1, mu): _haar_q(rng, m) for x0 in (0, 1) for x1 in (0, 1) for mu in (0, 1)}
        tot = np.zeros(m)
        for x0 in (0, 1):
            for x1 in (0, 1):
                # U_0(x) U_1(x+0) [U_1(x) U_0(x+1)]^dagger
                tot += _qm(_qm(lk[x0, x1, 0], lk[1 - x0, x1, 1]),
                           _qd(_qm(lk[x0, x1, 1], lk[x0, 1 - x1, 0])))[:, 0]
        pol_a = _qm(lk[0, 0, 1], lk[0, 1, 1])[:, 0]      # loop winding axis 1 at x0 = 0
        pol_b = _qm(lk[1, 0, 1], lk[1, 1, 1])[:, 0]      # ... at x0 = 1
        wts.append(np.exp(beta * (tot - 4.0)))
        obs_p.append(tot / 4.0)
        obs_c.append(pol_a * pol_b)
    w = np.concatenate(wts)
    v, e = _weighted(np.concatenate(obs_p), w)
    check("2x2 beta=1.5 plaquette", v, e, exact.plaquette_2d_torus(beta, 4), bessel_u(beta),
          resolved=8.0)
    v, e = _weighted(np.concatenate(obs_c), w)
    check("2x2 beta=1.5 <p(0) p(1)>", v, e, exact.torelon_correlator_2d_torus(beta, 2, 2, 1),
          exact.torelon_correlator_2d(beta, 2, 2, 1), resolved=0.0)
    assert exact.wilson_loop_2d_torus(beta, 1, 4) == pytest.approx(
        exact.plaquette_2d_torus(beta, 4), rel=1e-12)
    print("[haar] largest pull: %.2f sigma" % worst)


# ==============================================================================================
# 9. former limitations (found in the review as 'minor', fixed in the integration round; these
#    were non-strict xfail tests and are now ordinary tests)
# ==============================================================================================
def test_negative_beta_is_rejected_or_simulated_correctly():
    """Review finding: a negative beta was neither rejected nor simulated (the heatbath
    silently sampled beta = 0, P ~ 0 instead of -u(|beta|)), and beta = NaN was accepted.
    Fix: Lattice raises ValueError for beta that is negative or not finite, at construction
    and on assignment.  beta = 0 stays legal and gives the Haar measure."""
    for bad in (-2.0, float("nan"), float("inf")):
        with pytest.raises(ValueError):
            Lattice((4, 4), bad, SEED + 130)
    lat = Lattice((4, 4), 2.0, SEED + 130)
    for bad in (-2.0, float("nan"), float("inf")):
        with pytest.raises(ValueError):
            lat.beta = bad
    assert lat.beta == 2.0
    # beta = 0: plaquettes of Haar-random links average to zero
    lat = Lattice((4, 4), 0.0, SEED + 131)
    lat.hot_start()
    lat.update(50, 0)
    p = np.empty(20000)
    for i in range(len(p)):
        lat.update(1, 0)
        p[i] = lat.plaquette()
    err = bin_err(p, 40)
    print("[beta=0] P = %.5f +- %.5f" % (p.mean(), err))
    assert err < 2.5e-3
    assert abs(p.mean()) < 4.0 * err


def test_exact_u_negative_argument():
    """Review finding: exact.u(beta < 0) returned the small-beta Taylor polynomial.  Fix: u is
    evaluated as the odd function it is, u' as an even function."""
    for b in (-2.0, -0.3, -30.0, -1e-3):
        assert exact.u(b) == pytest.approx(iv(2, b) / iv(1, b), rel=1e-10)
        h = 1e-6 * max(1.0, abs(b))
        assert exact.du_dbeta(b) == pytest.approx((exact.u(b + h) - exact.u(b - h)) / (2 * h),
                                                  rel=1e-6)
    assert exact.u(-2.0) == -exact.u(2.0)
    assert exact.du_dbeta(-2.0) == exact.du_dbeta(2.0)


# ==============================================================================================
# slow, high-statistics versions (run with --runslow)
# ==============================================================================================
@pytest.mark.slow
@pytest.mark.parametrize("name", ["D3_4x6x8_b5", "D4_4x4x6x6_b2.3"])
def test_slow_schwinger_dyson_high_statistics(name):
    shape, beta, start, n_or, n_meas, sig_max = SD_CASES[name]
    out = sd_run(shape, beta, SEED + 200 + list(SD_CASES).index(name), start, n_or, 8 * n_meas)
    for key in ("r1", "r2"):
        per_dir, pull, err, mean = out[key]
        print("[SD slow] %s %s: per-direction pulls %s ; all: %+.2e +- %.1e (%+.2f sigma)" % (
            name, key, np.round(per_dir, 2), mean, err, pull))
        assert np.all(np.abs(per_dir) < 4.0)
        assert abs(pull) < 4.0
    assert out["r1"][2] <= sig_max / 2.5
