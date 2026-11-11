"""Cross-check of the engine (ym/lattice.py) against the independent reference (ym/reference.py).

The reference uses explicit complex 2x2 matrices, numpy.roll neighbours, checkerboard multi-hit
Metropolis and its own numpy random generator; the engine uses quaternions, index tables,
heatbath/overrelaxation and numba's generator.  The two codes share no line of simulation code.

Layout of this file
    A. the reference validated on its own (deterministic): group properties, observables against
       brute-force site loops, gauge invariance, exactness of the Metropolis action difference,
       independence of the simultaneously updated links;
    B. the reference against EXACT D = 2 results (statistical);
    C. deterministic cross-check: one thermalised configuration, observables from both codes
       must agree to 1e-12 (conventions and indexing, independent of statistics), in both
       directions (engine configuration -> reference, reference configuration -> engine), plus
       the engine's staple, gauge transformation and single-link heatbath in matrix language;
    D. statistical cross-check of the two Monte Carlo codes in D = 2, 3, 4;
    E. strong-coupling prediction P = u + 8 (D-2) u^5 u' tested with the reference code.

Statistical tests
    * errors are binned errors (ref.binned);
    * agreement criterion: |difference| < 4 combined sigma, and the combined sigma must be small
      (the comparison must be informative): <= 1e-3 for the plaquette in the default runs;
    * all seeds, run lengths, bin numbers and thresholds below were fixed BEFORE the recorded
      runs, using exploratory runs with other seeds (901-906, 951-953) to estimate cost and
      autocorrelation times.  They must not be changed to make a failing comparison pass.
      The only change made after a recorded run is documented at ENSEMBLES_SLOW["d4_b2.3"]
      (more engine statistics to meet the precision floor; the agreement itself was z = +0.02).
    * the engine is started hot and the reference cold, so agreement also tests thermalisation;
      the default runs use pure heatbath for some ensembles and heatbath + 2 overrelaxation
      sweeps for others, the slow runs compare BOTH engine modes with the reference.
    * run `pytest -q tests/test_crosscheck.py -rP` to see the tables of compared numbers;
      `--runslow` adds the high-statistics versions (about 3 minutes EACH: run them one at a
      time by node id).  Note that `-k test_c` also matches the file name: use `-k test_c_`.

Nothing in this file is, or supports, a proof of the Yang-Mills mass gap: it validates a Monte
Carlo program.
"""
import functools
import itertools
import math

import numpy as np
import pytest
from scipy.special import iv

from ym import reference as ref
from ym.reference import RefLattice

SIGMA = np.array([[[0, 1], [1, 0]], [[0, -1j], [1j, 0]], [[1, 0], [0, -1]]], dtype=complex)
OBS = ref.OBSERVABLES                      # ("plaq", "w12", "w22", "pol2", "polabs")
Z_MAX = 4.0                                # agreement criterion, in combined sigma


# ================================================================================================
# brute-force helpers: explicit site loops and np.matmul, written without ref.mm / ref.shift
# ================================================================================================
def sites(shape):
    return itertools.product(*[range(n) for n in shape])


def hop(x, mu, shape, n=1):
    y = list(x)
    y[mu] = (y[mu] + n) % shape[mu]
    return tuple(y)


def brute_plaquette_trace(U, shape, x, mu, nu):
    m = (U[x + (mu,)] @ U[hop(x, mu, shape) + (nu,)]
         @ U[hop(x, nu, shape) + (mu,)].conj().T @ U[x + (nu,)].conj().T)
    return 0.5 * np.trace(m).real


def brute_planes(U, shape):
    D = len(shape)
    return np.array([np.mean([brute_plaquette_trace(U, shape, x, mu, nu) for x in sites(shape)])
                     for mu in range(D) for nu in range(mu + 1, D)])


def brute_action(U, shape, beta):
    D = len(shape)
    return beta * sum(1.0 - brute_plaquette_trace(U, shape, x, mu, nu)
                      for x in sites(shape) for mu in range(D) for nu in range(mu + 1, D))


def brute_wilson(U, shape, R, T, mu, nu):
    """Walk around the R x T rectangle link by link: R steps +mu, T steps +nu, R steps -mu,
    T steps -nu, multiplying U for forward steps and U^dagger (of the link just behind) for
    backward steps."""
    total = 0.0
    for x in sites(shape):
        m = np.eye(2, dtype=complex)
        y = x
        for _ in range(R):
            m = m @ U[y + (mu,)]
            y = hop(y, mu, shape)
        for _ in range(T):
            m = m @ U[y + (nu,)]
            y = hop(y, nu, shape)
        for _ in range(R):
            y = hop(y, mu, shape, -1)
            m = m @ U[y + (mu,)].conj().T
        for _ in range(T):
            y = hop(y, nu, shape, -1)
            m = m @ U[y + (nu,)].conj().T
        assert y == x
        total += 0.5 * np.trace(m).real
    return total / np.prod(shape)


def brute_polyakov(U, shape, mu):
    rest = tuple(n for a, n in enumerate(shape) if a != mu)
    out = np.empty(rest)
    for xr in sites(rest):
        m = np.eye(2, dtype=complex)
        for t in range(shape[mu]):
            x = xr[:mu] + (t,) + xr[mu:]
            m = m @ U[x + (mu,)]
        out[xr] = 0.5 * np.trace(m).real
    return out


def brute_staple(U, shape, x, mu):
    D = len(shape)
    a = np.zeros((2, 2), dtype=complex)
    xp = hop(x, mu, shape)
    for nu in range(D):
        if nu == mu:
            continue
        a += U[xp + (nu,)] @ U[hop(x, nu, shape) + (mu,)].conj().T @ U[x + (nu,)].conj().T
        xm = hop(x, nu, shape, -1)
        a += U[hop(xp, nu, shape, -1) + (nu,)].conj().T @ U[xm + (mu,)].conj().T @ U[xm + (nu,)]
    return a


def generic_lattice(shape, beta=2.2, seed=1, sweeps=2, **kw):
    """A generic (neither cold nor Haar) configuration: hot start plus a few sweeps."""
    lat = RefLattice(shape, beta, seed=seed, **kw)
    lat.hot_start()
    lat.sweep(sweeps)
    return lat


SMALL_SHAPES = [(4, 6), (2, 4), (2, 2), (4, 2, 6), (2, 2, 2), (4, 2, 2, 4), (2, 2, 2, 2)]


# ================================================================================================
# A. the reference on its own (deterministic)
# ================================================================================================
def test_a_matrix_helpers_against_numpy():
    rng = np.random.default_rng(11)
    a = rng.standard_normal((5, 3, 2, 2)) + 1j * rng.standard_normal((5, 3, 2, 2))
    b = rng.standard_normal((5, 3, 2, 2)) + 1j * rng.standard_normal((5, 3, 2, 2))
    assert np.abs(ref.mm(a, b) - a @ b).max() < 1e-14
    assert np.abs(ref.mm(a, b[0, 0]) - a @ b[0, 0]).max() < 1e-14          # broadcasting
    assert np.array_equal(ref.dag(a), np.conj(np.transpose(a, (0, 1, 3, 2))))
    assert np.abs(ref.retr(a) - np.trace(a, axis1=-2, axis2=-1).real).max() < 1e-14
    f = np.arange(4 * 6 * 2).reshape(4, 6, 2)
    for mu, n in [(0, 1), (1, 1), (1, -1), (0, 3), (2, 1)]:
        g = ref.shift(f, mu, n)
        for x in sites(f.shape):
            assert g[x] == f[hop(x, mu, f.shape, n)]                       # result(x) = f(x + n mu)


def test_a_matrix_dictionary_matches_project_quaternion_convention():
    """U = a0 + i a.sigma, and the quaternion product rule stated in the project conventions,
    (ab)_0 = a0 b0 - a.b, (ab)_vec = a0 b + b0 a - a x b, checked with explicit Pauli matrices."""
    rng = np.random.default_rng(12)
    qa = rng.standard_normal((200, 4))
    qb = rng.standard_normal((200, 4))
    ma = ref.quaternion_to_matrix(qa)
    mb = ref.quaternion_to_matrix(qb)
    explicit = qa[:, 0, None, None] * np.eye(2) + 1j * np.einsum("nk,kij->nij", qa[:, 1:], SIGMA)
    assert np.abs(ma - explicit).max() < 1e-15
    prod = np.empty_like(qa)
    prod[:, 0] = qa[:, 0] * qb[:, 0] - (qa[:, 1:] * qb[:, 1:]).sum(axis=1)
    prod[:, 1:] = (qa[:, :1] * qb[:, 1:] + qb[:, :1] * qa[:, 1:] - np.cross(qa[:, 1:], qb[:, 1:]))
    assert np.abs(ma @ mb - ref.quaternion_to_matrix(prod)).max() < 1e-13
    assert np.abs(ref.matrix_to_quaternion(ma) - qa).max() < 1e-15         # round trip
    dagger = qa * np.array([1.0, -1.0, -1.0, -1.0])
    assert np.abs(ref.dag(ma) - ref.quaternion_to_matrix(dagger)).max() < 1e-15
    assert np.abs(0.5 * ref.retr(ma) - qa[:, 0]).max() < 1e-15             # (1/2) Tr U = a0
    unit = qa / np.linalg.norm(qa, axis=1, keepdims=True)
    mu = ref.quaternion_to_matrix(unit)
    assert np.abs(mu @ ref.dag(mu) - np.eye(2)).max() < 1e-14
    assert np.abs(np.linalg.det(mu) - 1.0).max() < 1e-14


def test_a_constructor_and_cold_start():
    for bad in [(4,), (4, 4, 4, 4, 4), (3, 4), (4, 0), (4, 5, 6)]:
        with pytest.raises(ValueError):
            RefLattice(bad, 2.0)
    for shape in [(4, 6), (2, 4, 6), (4, 2, 6, 4)]:
        lat = RefLattice(shape, 2.3, seed=3)
        assert lat.U.shape == shape + (len(shape), 2, 2) and lat.U.dtype == np.complex128
        assert lat.n_plaq == np.prod(shape) * len(shape) * (len(shape) - 1) // 2
        assert lat.plaquette() == 1.0 and lat.action() == 0.0
        assert lat.wilson_loop(2, 3) == 1.0
        for mu in range(lat.D):
            p = lat.polyakov_loops(mu)
            assert p.shape == tuple(n for a, n in enumerate(shape) if a != mu)
            assert np.all(p == 1.0)
        assert lat.unitarity_violation() == 0.0
        # parity really is the coordinate sum mod 2
        for x in sites(shape):
            assert lat.parity[x] == sum(x) % 2


def test_a_links_stay_in_su2():
    """Explicit unitarity and det = 1, without any re-projection, after many Metropolis hits."""
    for shape, beta in [((8, 8), 4.0), ((4, 6, 4), 6.0), ((4, 4, 4, 4), 2.3)]:
        lat = RefLattice(shape, beta, seed=21, n_hit=8)
        lat.reunit_every = 0
        lat.hot_start()
        u = lat.U
        assert np.abs(u @ np.conj(np.swapaxes(u, -1, -2)) - np.eye(2)).max() < 1e-14
        assert np.abs(np.linalg.det(u) - 1.0).max() < 1e-14
        lat.sweep(60)                                           # 480 multiplications per link
        u = lat.U
        assert np.abs(u @ np.conj(np.swapaxes(u, -1, -2)) - np.eye(2)).max() < 1e-12
        assert np.abs(np.linalg.det(u) - 1.0).max() < 1e-12
        assert lat.unitarity_violation() < 1e-12
        # the SU(2) form a0 + i a.sigma with REAL a is preserved (U11 = conj(U00), U10 = -conj(U01))
        assert np.abs(u[..., 1, 1] - np.conj(u[..., 0, 0])).max() < 1e-12
        assert np.abs(u[..., 1, 0] + np.conj(u[..., 0, 1])).max() < 1e-12
        before = lat.measure()
        lat.reunitarize()
        assert lat.unitarity_violation() < 5e-15              # a few ulp
        assert np.abs(lat.measure() - before).max() < 1e-12     # projection is a no-op physically


def test_a_reunitarize_projects_perturbed_links():
    lat = generic_lattice((4, 4, 4), seed=22)
    rng = np.random.default_rng(5)
    lat.U += 1e-6 * (rng.standard_normal(lat.U.shape) + 1j * rng.standard_normal(lat.U.shape))
    assert lat.unitarity_violation() > 1e-7
    lat.reunitarize()
    assert lat.unitarity_violation() < 5e-15              # a few ulp


def test_a_proposals_are_su2_bounded_and_symmetric():
    lat = RefLattice((4, 4), 2.0, seed=23, eps=0.7)
    x = lat.random_near_identity(200000)
    assert np.abs(x @ np.conj(np.swapaxes(x, -1, -2)) - np.eye(2)).max() < 1e-14
    assert np.abs(np.linalg.det(x) - 1.0).max() < 1e-14
    q = ref.matrix_to_quaternion(x)
    theta = np.arccos(np.clip(q[:, 0], -1, 1))
    assert theta.min() >= 0.0 and theta.max() <= 0.7 + 1e-12   # rotation angle bounded by eps
    assert abs(theta.mean() - 0.35) < 4 * 0.7 / math.sqrt(12 * 200000)      # uniform in [0, eps]
    # symmetry X <-> X^{-1}: the vector part is distributed symmetrically about zero
    vec = q[:, 1:]
    assert np.abs(vec.mean(axis=0)).max() < 4 * vec.std(axis=0).max() / math.sqrt(200000)
    skew = (vec ** 3).mean(axis=0)
    assert np.abs(skew).max() < 4 * (vec ** 3).std(axis=0).max() / math.sqrt(200000)
    # isotropic directions
    nhat = vec / np.linalg.norm(vec, axis=1, keepdims=True)
    assert np.abs((nhat ** 2).mean(axis=0) - 1.0 / 3.0).max() < 4 * 0.2981 / math.sqrt(200000)
    # eps = pi reaches the whole group (a0 down to -1)
    lat.eps = math.pi
    q = ref.matrix_to_quaternion(lat.random_near_identity(100000))
    assert q[:, 0].min() < -0.999 and q[:, 0].max() > 0.999


@pytest.mark.parametrize("shape", SMALL_SHAPES)
def test_a_observables_equal_brute_force_definitions(shape):
    """numpy.roll implementation == explicit site-by-site evaluation of the definitions."""
    lat = generic_lattice(shape, beta=2.2, seed=31)
    U, D = lat.U, lat.D
    assert np.abs(lat.plaquette_planes() - brute_planes(U, shape)).max() < 1e-13
    assert abs(lat.plaquette() - brute_planes(U, shape).mean()) < 1e-13
    s_brute = brute_action(U, shape, lat.beta)
    assert abs(lat.action() - s_brute) < 1e-11 * max(1.0, abs(s_brute))
    assert abs(lat.action() - lat.beta * lat.n_plaq * (1.0 - lat.plaquette())) < 1e-10
    pair_avg = {}
    for R, T in [(1, 1), (1, 2), (2, 1), (2, 2), (1, 3), (3, 2)]:
        vals = []
        for mu in range(D):
            for nu in range(D):
                if mu == nu:
                    continue
                w = brute_wilson(U, shape, R, T, mu, nu)
                assert abs(lat.wilson_loop(R, T, mu, nu) - w) < 1e-13
                vals.append(w)
        pair_avg[(R, T)] = np.mean(vals)
        assert abs(lat.wilson_loop(R, T) - pair_avg[(R, T)]) < 1e-13
    for mu in range(D):
        assert np.abs(lat.polyakov_loops(mu) - brute_polyakov(U, shape, mu)).max() < 1e-13
        staple = lat.staple_sum(mu)
        for x in sites(shape):
            assert np.abs(staple[x] - brute_staple(U, shape, x, mu)).max() < 1e-13
    m = lat.measure()
    assert abs(m[0] - lat.plaquette()) < 1e-13
    assert abs(m[1] - pair_avg[(1, 2)]) < 1e-13
    assert abs(m[2] - pair_avg[(2, 2)]) < 1e-13
    pol = [brute_polyakov(U, shape, mu) for mu in range(D)]
    assert abs(m[3] - np.mean([(p * p).mean() for p in pol])) < 1e-13
    assert abs(m[4] - np.mean([abs(p.mean()) for p in pol])) < 1e-13
    assert abs(lat.measure(loops=False)[0] - lat.plaquette()) < 1e-15


@pytest.mark.parametrize("shape", [(4, 6), (2, 2), (2, 4, 6), (4, 2, 6, 4), (6, 6, 6, 6)])
def test_a_gauge_invariance(shape):
    lat = generic_lattice(shape, beta=2.2, seed=32)
    D = lat.D
    before = {
        "planes": lat.plaquette_planes(), "action": lat.action(), "measure": lat.measure(),
        "loops": [lat.wilson_loop(R, T, mu, nu) for R, T in [(1, 1), (1, 2), (2, 2), (3, 2), (2, 5)]
                  for mu in range(D) for nu in range(D) if mu != nu],
        "pol": [lat.polyakov_loops(mu) for mu in range(D)],
    }
    links = lat.U.copy()
    G = lat.random_gauge()
    lat.gauge_transform(G)
    assert np.abs(lat.U - links).max() > 0.1                     # the transformation is not trivial
    assert lat.unitarity_violation() < 1e-13
    assert np.abs(lat.plaquette_planes() - before["planes"]).max() < 1e-13
    assert abs(lat.action() - before["action"]) < 1e-11 * max(1.0, abs(before["action"]))
    assert np.abs(lat.measure() - before["measure"]).max() < 1e-13
    after = [lat.wilson_loop(R, T, mu, nu) for R, T in [(1, 1), (1, 2), (2, 2), (3, 2), (2, 5)]
             for mu in range(D) for nu in range(D) if mu != nu]
    assert np.abs(np.array(after) - np.array(before["loops"])).max() < 1e-13
    for mu in range(D):
        assert np.abs(lat.polyakov_loops(mu) - before["pol"][mu]).max() < 1e-13
    # explicit form of the transformation at one link: U_mu(x) -> G(x) U_mu(x) G(x+mu)^dagger
    x = tuple(n - 1 for n in shape)
    for mu in range(D):
        expect = G[x] @ links[x + (mu,)] @ G[hop(x, mu, shape)].conj().T
        assert np.abs(lat.U[x + (mu,)] - expect).max() < 1e-14


def test_a_pure_gauge_and_centre_transformations():
    """Geometry checks: a pure gauge has all loops equal to 1; multiplying the mu-links of one
    time slice by the centre element -1 leaves every contractible loop unchanged and flips the
    sign of exactly the Polyakov loops winding direction mu."""
    for shape in [(4, 6), (2, 4, 6), (4, 2, 4, 6)]:
        lat = RefLattice(shape, 2.0, seed=33)
        lat.gauge_transform(lat.random_gauge())                  # cold -> pure gauge
        assert np.abs(lat.U - np.eye(2)).max() > 0.1
        assert abs(lat.plaquette() - 1.0) < 1e-13 and abs(lat.wilson_loop(2, 3) - 1.0) < 1e-13
        for mu in range(lat.D):
            assert np.abs(lat.polyakov_loops(mu) - 1.0).max() < 1e-13
        lat = generic_lattice(shape, seed=34)
        ref_loops = [lat.plaquette(), lat.wilson_loop(1, 2), lat.wilson_loop(2, 2), lat.action()]
        ref_pol = [lat.polyakov_loops(mu) for mu in range(lat.D)]
        for mu in range(lat.D):
            twisted = lat.copy()
            index = [slice(None)] * lat.D
            index[mu] = 1                                         # the slice x_mu = 1
            twisted.U[tuple(index) + (mu,)] *= -1.0
            now = [twisted.plaquette(), twisted.wilson_loop(1, 2), twisted.wilson_loop(2, 2),
                   twisted.action()]
            assert np.abs(np.array(now) - np.array(ref_loops)).max() < 1e-10
            for nu in range(lat.D):
                sign = -1.0 if nu == mu else 1.0
                assert np.abs(twisted.polyakov_loops(nu) - sign * ref_pol[nu]).max() < 1e-13


def test_a_wilson_loop_symmetries():
    lat = generic_lattice((4, 6, 4), seed=35)
    assert abs(lat.wilson_loop(1, 1) - lat.plaquette()) < 1e-14
    for mu, nu in [(0, 1), (1, 2), (2, 0)]:
        # same rectangles traversed in the opposite sense: Re Tr is unchanged
        assert abs(lat.wilson_loop(2, 3, mu, nu) - lat.wilson_loop(3, 2, nu, mu)) < 1e-14
    with pytest.raises(ValueError):
        lat.wilson_loop(1, 1, 0, 0)
    with pytest.raises(ValueError):
        lat.wilson_loop(1, 1, 0, None)


@pytest.mark.parametrize("shape", [(2, 2), (2, 4), (4, 6), (2, 2, 2), (4, 2, 6), (2, 2, 2, 2),
                                   (4, 2, 2, 6), (4, 4, 4, 4)])
def test_a_checkerboard_classes_share_no_plaquette(shape):
    """Pure combinatorics, no matrices: enumerate every plaquette with its four links and verify
    that no plaquette contains two links of the same class (direction, site parity).  This is the
    condition under which the simultaneous update of a class is a valid Metropolis step."""
    D = len(shape)
    n_plaquettes = 0
    for x in sites(shape):
        for mu in range(D):
            for nu in range(mu + 1, D):
                links = [(x, mu), (hop(x, mu, shape), nu), (hop(x, nu, shape), mu), (x, nu)]
                classes = [(d, sum(y) % 2) for y, d in links]
                assert len(set(classes)) == 4, (x, mu, nu, classes)
                n_plaquettes += 1
    assert n_plaquettes == np.prod(shape) * D * (D - 1) // 2
    # and the class masks used by the code are exactly these parities
    lat = RefLattice(shape, 1.0)
    for parity in (0, 1):
        assert np.array_equal(lat._masks[parity], lat.parity == parity)
        assert lat._masks[parity].sum() == lat.V // 2


@pytest.mark.parametrize("shape", [(4, 6), (2, 2), (2, 4, 6), (2, 2, 2), (4, 2, 4, 2), (4, 4, 4, 4)])
def test_a_staple_gives_exact_single_link_action_difference(shape):
    lat = generic_lattice(shape, beta=2.7, seed=41)
    rng = np.random.default_rng(42)
    s0 = lat.action()
    for _ in range(12):
        x = tuple(int(rng.integers(n)) for n in shape)
        mu = int(rng.integers(lat.D))
        staple = lat.staple_sum(mu)[x]
        q = rng.standard_normal(4)
        new = ref.quaternion_to_matrix(q / np.linalg.norm(q))
        old = lat.U[x + (mu,)].copy()
        local = -0.5 * lat.beta * (np.trace(new @ staple).real - np.trace(old @ staple).real)
        trial = lat.copy()
        trial.U[x + (mu,)] = new
        assert abs((trial.action() - s0) - local) < 1e-9
        if np.prod(shape) <= 100:                                # site-loop action on the small ones
            brute = brute_action(trial.U, shape, lat.beta) - brute_action(lat.U, shape, lat.beta)
            assert abs(brute - local) < 1e-9
    # total: sum over all links of Re Tr(U A) counts every plaquette 4 times
    total = sum(ref.retr(ref.mm(lat.link(mu), lat.staple_sum(mu))).sum() for mu in range(lat.D))
    assert abs(0.5 * total / (4 * lat.n_plaq) - lat.plaquette()) < 1e-13


@pytest.mark.parametrize("shape", [(4, 6), (2, 2), (2, 4, 6), (2, 2, 2), (4, 2, 4, 2), (4, 4, 4, 4)])
def test_a_metropolis_uses_exact_action_difference(shape):
    """Replays every hit of every class update of one sweep and compares the action difference
    used in the accept/reject step with brute-force differences of the FULL action:
      (1) for individual links (only that link changed),
      (2) for all proposals of the class applied at once: must equal the SUM of the individual
          differences, which holds only if the links of a class share no plaquette."""
    lat = generic_lattice(shape, beta=2.2, seed=51, eps=1.2, n_hit=3)
    rng = np.random.default_rng(52)
    n_class = lat.V // 2
    seen_accept = seen_reject = 0
    for mu in range(lat.D):
        for parity in (0, 1):
            mask = lat.parity == parity
            work = lat.copy()                                    # replay copy
            others = lat.U.copy()
            log = []
            n_acc = lat.update_class(mu, parity, log=log)
            assert len(log) == lat.n_hit
            total_acc = 0
            for hit in log:
                assert hit["cur"].shape == (n_class, 2, 2)
                assert np.array_equal(work.link(mu)[mask], hit["cur"])
                s_cur = work.action()
                trial = work.copy()
                trial.link(mu)[mask] = hit["new"]
                assert abs((trial.action() - s_cur) - hit["dS"].sum()) < 1e-9          # (2)
                for i in rng.choice(n_class, size=min(n_class, 4), replace=False):
                    single = work.copy()
                    links = hit["cur"].copy()
                    links[i] = hit["new"][i]
                    single.link(mu)[mask] = links
                    assert abs((single.action() - s_cur) - hit["dS"][i]) < 1e-9        # (1)
                assert hit["accept"][hit["dS"] <= 0.0].all()     # never reject a decrease
                work.link(mu)[mask] = np.where(hit["accept"][:, None, None], hit["new"], hit["cur"])
                total_acc += int(hit["accept"].sum())
                seen_accept += int(hit["accept"].sum())
                seen_reject += int((~hit["accept"]).sum())
            assert total_acc == n_acc
            assert np.array_equal(work.U, lat.U)                 # replay reproduces the update
            # links outside the class are untouched
            changed = np.abs(lat.U - others).max(axis=(-1, -2)) > 0
            assert not changed[~mask].any()
            for nu in range(lat.D):
                if nu != mu:
                    assert not changed[..., nu].any()
    assert seen_accept > 0 and seen_reject > 0


def test_a_metropolis_accept_probability_is_min_1_exp_minus_dS():
    """Empirical acceptance frequency as a function of the action difference."""
    lat = generic_lattice((8, 8, 8), beta=3.0, seed=61, sweeps=5, eps=1.5, n_hit=8)
    log = []
    for _ in range(4):
        for mu in range(3):
            for parity in (0, 1):
                lat.update_class(mu, parity, log=log)
    d = np.concatenate([h["dS"] for h in log])
    a = np.concatenate([h["accept"] for h in log])
    assert d.size == 4 * 3 * 2 * 8 * 256
    assert a[d <= 0].all() and (d <= 0).sum() > 1000
    edges = [0.0, 0.25, 0.5, 1.0, 1.5, 2.0, 3.0, 4.0, 6.0, 9.0, np.inf]
    pulls = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        sel = (d > lo) & (d <= hi)
        p = np.exp(-d[sel])
        expected, var = p.sum(), (p * (1 - p)).sum()
        assert sel.sum() > 200
        pulls.append((a[sel].sum() - expected) / math.sqrt(var))
    print("acceptance pulls per dS bin:", " ".join("%+.2f" % z for z in pulls))
    assert max(abs(z) for z in pulls) < 4.0
    assert abs(np.sum(np.square(pulls)) - len(pulls)) < 4.0 * math.sqrt(2.0 * len(pulls))


def test_a_acceptance_is_tuned_then_frozen():
    for shape, beta, n_hit in [((16, 16), 4.0, 4), ((8, 8, 8), 6.0, 8), ((4, 4, 4, 4), 2.3, 8)]:
        lat = RefLattice(shape, beta, seed=71, eps=0.05, n_hit=n_hit)
        lat.thermalize(80)
        eps = lat.eps
        acc = lat.sweep(10)
        assert lat.eps == eps                                    # frozen after thermalisation
        assert 0.42 < acc < 0.58, (shape, beta, acc)
        lat.thermalize(4, tune=False)
        assert lat.eps == eps
    # at strong coupling even the widest proposal is accepted more often than not: eps saturates
    lat = RefLattice((4, 4, 4), 0.2, seed=72, n_hit=1)
    lat.thermalize(40)
    assert lat.eps == RefLattice.EPS_MAX and lat.sweep(5) > 0.5


def test_a_reproducibility():
    def run(seed):
        lat = RefLattice((4, 4, 4), 3.0, seed=seed, n_hit=4)
        lat.thermalize(6)
        lat.sweep(3)
        return lat
    a, b, c = run(81), run(81), run(82)
    assert np.array_equal(a.U, b.U) and a.eps == b.eps
    assert np.abs(a.U - c.U).max() > 0.1
    d = a.copy()                                                 # copies continue identically
    a.sweep(2)
    d.sweep(2)
    assert np.array_equal(a.U, d.U)


def test_a_error_analysis_on_synthetic_data():
    rng = np.random.default_rng(91)
    n, rho = 400000, 0.8                                         # AR(1): tau_int = (1+rho)/(2(1-rho))
    noise = rng.standard_normal(n)
    x = np.empty(n)
    x[0] = noise[0]
    for i in range(1, n):
        x[i] = rho * x[i - 1] + math.sqrt(1 - rho * rho) * noise[i]
    tau_true = 0.5 * (1 + rho) / (1 - rho)
    assert abs(ref.tau_int(x) - tau_true) < 0.1 * tau_true
    mean, err = ref.binned(x, 40)
    err_true = math.sqrt(2 * tau_true / n)
    assert abs(err - err_true) < 0.5 * err_true and abs(mean) < 4 * err_true
    assert abs(ref.tau_int(noise) - 0.5) < 0.05
    m, e = ref.binned(np.arange(10.0), 5)
    assert m == 4.5 and abs(e - np.std([0.5, 2.5, 4.5, 6.5, 8.5], ddof=1) / math.sqrt(5)) < 1e-15
    with pytest.raises(ValueError):
        ref.binned(np.arange(3.0), 5)


def test_a_exact_formulas_independent_evaluation():
    from ym import exact                                         # formulas by the engine author
    for beta in (0.5, 1.0, 2.5, 4.0, 8.0):
        u = iv(2, beta) / iv(1, beta)
        assert abs(ref.u_exact(beta) - u) < 1e-14
        assert abs(exact.u(beta) - u) < 1e-13
        h = 1e-5
        du_numeric = (ref.u_exact(beta + h) - ref.u_exact(beta - h)) / (2 * h)
        for D in (2, 3, 4):
            lo, u2, t6 = ref.strong_coupling_lo(beta, D)
            assert abs(t6 - 8 * (D - 2) * u ** 5 * du_numeric) < 1e-9
            assert abs(lo - (u + t6)) < 1e-15 and u2 == ref.u_exact(beta)
            t10 = ref.strong_coupling_t10(beta, D)
            assert abs(t10 - 40 * (D - 2) * (2 * D - 5) * u ** 9 * du_numeric) < 1e-9
            # agreement with the independently written ym/exact.py
            assert abs(exact.plaquette_strong_coupling(beta, D, order=1) - lo) < 1e-13
            assert abs(exact.plaquette_strong_coupling(beta, D, order=2) - (lo + t10)) < 1e-13
    assert ref.strong_coupling_lo(1.0, 2)[2] == 0.0             # no cubes in D = 2


# ================================================================================================
# Monte Carlo runs (cached per pytest session so that several tests can share one run)
# ================================================================================================
@functools.lru_cache(maxsize=None)
def _ref_run_cached(shape, beta, seed, n_therm, n_meas, meas_every, n_hit, loops, start):
    return ref.simulate(shape, beta, seed, n_therm, n_meas, meas_every=meas_every, n_hit=n_hit,
                        start=start, loops=loops)


def ref_run(shape, beta, seed, n_therm, n_meas, meas_every, n_hit, loops=True, start="cold"):
    """Reference Metropolis run (cold start by default); identical parameters -> the same run."""
    return _ref_run_cached(tuple(shape), float(beta), int(seed), int(n_therm), int(n_meas),
                           int(meas_every), int(n_hit), bool(loops), str(start))


def engine_observables(lat, loops=True):
    out = np.full(len(OBS), np.nan)
    out[0] = lat.plaquette()
    if loops:
        out[1] = lat.wilson_loop(1, 2)
        out[2] = lat.wilson_loop(2, 2)
        pol = [lat.polyakov_loops(mu) for mu in range(lat.D)]
        out[3] = np.mean([(p * p).mean() for p in pol])
        out[4] = np.mean([abs(p.mean()) for p in pol])
    return out


def eng_run(shape, beta, seed, n_therm, n_meas, n_hb, n_or, loops=True, start="hot"):
    """Engine run (hot start by default); identical parameters -> the same run."""
    return _eng_run_cached(tuple(shape), float(beta), int(seed), int(n_therm), int(n_meas),
                           int(n_hb), int(n_or), bool(loops), str(start))


@functools.lru_cache(maxsize=None)
def _eng_run_cached(shape, beta, seed, n_therm, n_meas, n_hb, n_or, loops, start):
    from ym.lattice import Lattice
    lat = Lattice(shape, beta, seed=seed)       # (re)seeds the engine's global stream; the whole
    if start == "hot":                          # run is done before anything else touches it
        lat.hot_start()
    for _ in range(n_therm):
        lat.update(n_hb=n_hb, n_or=n_or)
    series = np.empty((n_meas, len(OBS)))
    for i in range(n_meas):
        lat.update(n_hb=n_hb, n_or=n_or)
        series[i] = engine_observables(lat, loops=loops)
    return {"series": series, "unitarity": lat.unitarity_violation()}


def summarise(series, n_bins):
    """{observable: (mean, binned error, tau_int in measurements, bin length in measurements)}."""
    out = {}
    for k, name in enumerate(OBS):
        col = series[:, k]
        if np.isnan(col).any():
            continue
        mean, err = ref.binned(col, n_bins)
        out[name] = (mean, err, ref.tau_int(col), len(col) // n_bins)
    return out


class Report:
    """Collects comparison lines; prints them all, then asserts, so that a failing run still
    shows every compared number."""

    def __init__(self, title):
        self.lines = [title]
        self.failures = []

    def compare(self, label, a, ea, b, eb=0.0, z_max=Z_MAX, max_sigma=None, a_name="ref",
                b_name="eng"):
        sigma = math.hypot(ea, eb)
        z = (a - b) / sigma
        line = "  %-22s %s %.6f(%.6f)  %s %.6f(%.6f)  diff %+.2e  sigma %.2e  z %+.2f" % (
            label, a_name, a, ea, b_name, b, eb, a - b, sigma, z)
        if abs(z) >= z_max:
            line += "   <-- |z| >= %.1f" % z_max
            self.failures.append(line)
        if max_sigma is not None and sigma > max_sigma:
            line += "   <-- sigma > %.1e (comparison not informative)" % max_sigma
            self.failures.append(line)
        self.lines.append(line)
        return z

    def note(self, text):
        self.lines.append("  " + text)

    def finish(self):
        print("\n".join(self.lines))
        assert not self.failures, "\n".join(self.failures)


# ================================================================================================
# B. the reference against exact D = 2 results
# ================================================================================================
# default parameters                shape     beta  seed  therm  meas  every  n_hit
D2_EXACT = {
    2.5: ((32, 32), 2.5, 1101, 200, 1500, 1, 4),
    4.0: ((16, 16), 4.0, 1001, 200, 3000, 1, 4),      # the same run as the D=2 cross-check below
}
D2_EXACT_SLOW = {
    2.5: ((32, 32), 2.5, 1111, 300, 30000, 1, 4),
    4.0: ((32, 32), 4.0, 1112, 300, 30000, 1, 4),
}


def check_d2_exact(params, n_bins, max_sigma_plaq, max_sigma_w22):
    shape, beta = params[0], params[1]
    run = ref_run(*params)
    stats = summarise(run["series"], n_bins)
    u = ref.u_exact(beta)
    rep = Report("D=2 exact, reference Metropolis, shape %s beta %.1f: eps %.3f, acceptance %.3f, "
                 "%d measurements, %d bins" % (shape, beta, run["eps"], run["acceptance"],
                                               len(run["series"]), n_bins))
    exact_values = {"plaq": u, "w12": u ** 2, "w22": u ** 4, "pol2": 0.25}
    limits = {"plaq": max_sigma_plaq, "w22": max_sigma_w22}
    for name, exact_value in exact_values.items():
        mean, err, tau, blen = stats[name]
        rep.compare("%s (tau %.1f, bin %d)" % (name, tau, blen), mean, err, exact_value,
                    max_sigma=limits.get(name), b_name="exact")
        assert blen >= 4 * tau, "bins too short for a reliable error"
    assert run["unitarity"] < 1e-12
    assert 0.4 < run["acceptance"] < 0.6
    rep.finish()


@pytest.mark.parametrize("beta", [2.5, 4.0])
def test_b_reference_reproduces_exact_d2(beta):
    """P = u, W(1,2) = u^2, W(2,2) = u^4, <p^2> = 1/4 (Polyakov loop, exact up to u^(area))."""
    check_d2_exact(D2_EXACT[beta], n_bins=20, max_sigma_plaq=6e-4, max_sigma_w22=1.2e-3)


@pytest.mark.slow
@pytest.mark.parametrize("beta", [2.5, 4.0])
def test_b_reference_reproduces_exact_d2_high_statistics(beta):
    check_d2_exact(D2_EXACT_SLOW[beta], n_bins=40, max_sigma_plaq=1.5e-4, max_sigma_w22=3e-4)


# ================================================================================================
# C. deterministic cross-check on single configurations
# ================================================================================================
DET_CASES = [((6, 10), 4.0), ((2, 2), 2.0), ((4, 6, 8), 6.0), ((2, 4, 2), 3.0), ((4, 6, 2, 8), 2.3),
             ((6, 6, 6, 6), 2.5)]
LOOP_SIZES = [(1, 1), (1, 2), (2, 1), (2, 2), (1, 3), (3, 2), (2, 4)]


def assert_same_observables(eng, r, tol=1e-12):
    """Every observable of the engine lattice `eng` equals that of the reference lattice `r`."""
    D = r.D
    assert eng.planes == [(mu, nu) for mu in range(D) for nu in range(mu + 1, D)]
    worst = 0.0
    worst = max(worst, abs(eng.plaquette() - r.plaquette()))
    worst = max(worst, np.abs(np.asarray(eng.plaquette_planes()) - r.plaquette_planes()).max())
    s_eng, s_ref = eng.action(), r.action()
    assert abs(s_eng - s_ref) <= tol * max(1.0, abs(s_ref)), (s_eng, s_ref)
    for R, T in LOOP_SIZES:
        worst = max(worst, abs(eng.wilson_loop(R, T) - r.wilson_loop(R, T)))
        for mu in range(D):
            for nu in range(D):
                if mu != nu:
                    worst = max(worst, abs(eng.wilson_loop(R, T, mu, nu) - r.wilson_loop(R, T, mu, nu)))
    for mu in range(D):
        # loops that wind once around the lattice in direction mu
        nu = (mu + 1) % D
        worst = max(worst, abs(eng.wilson_loop(r.shape[mu], 1, mu, nu)
                               - r.wilson_loop(r.shape[mu], 1, mu, nu)))
        p_eng = np.asarray(eng.polyakov_loops(mu))
        p_ref = r.polyakov_loops(mu)
        assert p_eng.shape == p_ref.shape == tuple(n for a, n in enumerate(r.shape) if a != mu)
        worst = max(worst, np.abs(p_eng - p_ref).max())
    worst = max(worst, np.abs(engine_observables(eng) - r.measure()).max())
    assert worst < tol, worst
    return worst


@pytest.mark.parametrize("shape,beta", DET_CASES)
def test_c_engine_configuration_measured_by_reference(shape, beta):
    """Thermalised ENGINE configuration -> matrices -> reference observables == engine observables."""
    from ym.lattice import Lattice
    eng = Lattice(shape, beta, seed=3001)
    eng.hot_start()
    for _ in range(40):
        eng.update(n_hb=1, n_or=1)
    assert eng.U.shape == (int(np.prod(shape)), len(shape), 4)
    r = RefLattice.from_quaternions(shape, beta, eng.U)
    assert r.unitarity_violation() < 1e-12                       # engine links are SU(2) matrices
    assert 0.05 < r.plaquette() < 0.999                          # a non-trivial configuration
    worst = assert_same_observables(eng, r)
    # site indexing: link U[s, mu] of the engine is the reference link at the C-order coordinates
    rng = np.random.default_rng(7)
    for _ in range(20):
        x = tuple(int(rng.integers(n)) for n in shape)
        s = int(eng.site_index(x))
        assert s == int(np.ravel_multi_index(x, shape))
        assert tuple(int(c) for c in eng.site_coords(s)) == x
        for mu in range(len(shape)):
            assert np.array_equal(ref.quaternion_to_matrix(eng.U[s, mu]), r.U[x + (mu,)])
            # staple: the local action is -beta (U A)_0 = -(beta/2) Re Tr[U A]; A must coincide
            a_eng = ref.quaternion_to_matrix(np.asarray(eng.staple(s, mu), dtype=float))
            a_ref = r.staple_sum(mu)[x]
            assert np.abs(a_eng - a_ref).max() < 1e-12
            assert np.abs(a_ref - brute_staple(r.U, shape, x, mu)).max() < 1e-12
    print("shape %s beta %.1f: P = %.12f, max |engine - reference| over all observables = %.1e"
          % (shape, beta, r.plaquette(), worst))


@pytest.mark.parametrize("shape,beta", DET_CASES)
def test_c_reference_configuration_measured_by_engine(shape, beta):
    """Thermalised REFERENCE configuration -> quaternions -> engine observables == reference's."""
    from ym.lattice import Lattice
    r = RefLattice(shape, beta, seed=3002, n_hit=4)
    r.hot_start()
    r.thermalize(30)
    eng = Lattice(shape, beta, seed=3003)
    eng.U[...] = r.to_quaternions()
    assert eng.unitarity_violation() < 1e-12
    worst = assert_same_observables(eng, r)
    print("shape %s beta %.1f: P = %.12f, max |engine - reference| = %.1e"
          % (shape, beta, r.plaquette(), worst))


@pytest.mark.parametrize("shape", [(6, 10), (4, 6, 8), (4, 6, 2, 8)])
def test_c_engine_brute_force_definitions(shape):
    """Engine observables against the explicit site-loop definitions of this file (which use
    neither the engine's nor the reference's lattice code) on a small engine configuration."""
    from ym.lattice import Lattice
    small = tuple(min(n, 4) for n in shape)
    eng = Lattice(small, 2.4, seed=3004)
    eng.hot_start()
    for _ in range(20):
        eng.update(n_hb=1, n_or=1)
    D = len(small)
    U = ref.quaternion_to_matrix(np.asarray(eng.U).reshape(small + (D, 4)))
    assert np.abs(np.asarray(eng.plaquette_planes()) - brute_planes(U, small)).max() < 1e-12
    s = brute_action(U, small, 2.4)
    assert abs(eng.action() - s) < 1e-12 * max(1.0, abs(s))
    for R, T in [(1, 2), (2, 2), (3, 1)]:
        for mu in range(D):
            for nu in range(D):
                if mu != nu:
                    assert abs(eng.wilson_loop(R, T, mu, nu) - brute_wilson(U, small, R, T, mu, nu)) < 1e-12
    for mu in range(D):
        assert np.abs(np.asarray(eng.polyakov_loops(mu)) - brute_polyakov(U, small, mu)).max() < 1e-12


def test_c_gauge_transformation_conventions_agree():
    """The engine's gauge transformation equals U_mu(x) -> G(x) U_mu(x) G(x+mu)^dagger."""
    from ym.lattice import Lattice
    shape = (4, 6, 2, 4)
    eng = Lattice(shape, 2.3, seed=3005)
    eng.hot_start()
    for _ in range(10):
        eng.update(n_hb=1, n_or=1)
    r = RefLattice.from_quaternions(shape, 2.3, eng.U)
    G = np.asarray(eng.random_gauge())                           # applies G and returns it
    assert G.shape == (int(np.prod(shape)), 4)
    r.gauge_transform(ref.quaternion_to_matrix(G.reshape(shape + (4,))))
    assert np.abs(ref.quaternion_to_matrix(np.asarray(eng.U).reshape(shape + (4, 4))) - r.U).max() < 1e-12
    assert_same_observables(eng, r)


def test_c_engine_heatbath_link_is_oriented_along_the_staple():
    """Single-link check of the engine's heatbath in matrix language: for a fixed staple sum A
    (taken from a real configuration, |A| = k) the new link must be distributed as
    exp((beta/2) Re Tr[U A]), hence E[U] = u(beta k) A^dagger / k with u = I_2/I_1.  A link drawn
    around A instead of A^dagger (wrong orientation) would fail this by many sigma."""
    from ym.lattice import Lattice, heatbath_link_array
    shape, beta, n = (4, 6, 2, 4), 2.3, 200000
    eng = Lattice(shape, beta, seed=3006)
    eng.hot_start()
    for _ in range(10):
        eng.update(n_hb=1, n_or=1)
    r = RefLattice.from_quaternions(shape, beta, eng.U)
    worst = 0.0
    for x, mu in [((1, 2, 0, 3), 0), ((3, 5, 1, 0), 2), ((0, 0, 0, 0), 3)]:
        a_quat = np.asarray(eng.staple(eng.site_index(x), mu), dtype=float)
        a = r.staple_sum(mu)[x]                                  # the reference's staple matrix
        assert np.abs(ref.quaternion_to_matrix(a_quat) - a).max() < 1e-12
        k = math.sqrt(abs(np.linalg.det(a)))                     # A = k * (SU(2) matrix)
        assert abs(k - np.linalg.norm(a_quat)) < 1e-12 and k > 0.5
        eng.reseed(3007 + mu)
        links = ref.quaternion_to_matrix(np.asarray(heatbath_link_array(beta, a_quat, n)))
        assert np.abs(links @ np.conj(np.swapaxes(links, -1, -2)) - np.eye(2)).max() < 1e-13
        expect = ref.u_exact(beta * k) * a.conj().T / k
        mean = links.mean(axis=0)
        err = np.sqrt((links.real.var(axis=0) + links.imag.var(axis=0)) / n)
        z = np.abs(mean - expect) / err
        x0 = 0.5 * np.trace(links @ a, axis1=-2, axis2=-1).real / k
        z0 = (x0.mean() - ref.u_exact(beta * k)) / (x0.std(ddof=1) / math.sqrt(n))
        print("link %s mu %d: k = %.4f, <(1/2k) Tr(U A)> = %.5f vs u(beta k) = %.5f (z %+.2f), "
              "max element pull of E[U] = %.2f" % (x, mu, k, x0.mean(), ref.u_exact(beta * k), z0, z.max()))
        worst = max(worst, abs(z0), z.max())
    assert worst < 4.0


# ================================================================================================
# D. statistical cross-check of the two Monte Carlo codes
# ================================================================================================
# reference: (seed, n_therm, n_meas, meas_every, n_hit); engine: (seed, n_therm, n_meas, n_hb, n_or)
ENSEMBLES = {
    "d2_b4.0": dict(shape=(16, 16), beta=4.0,
                    ref=(1001, 200, 3000, 1, 4), eng=(2001, 500, 10000, 1, 0)),
    "d3_b3.0": dict(shape=(8, 8, 8), beta=3.0,
                    ref=(1002, 200, 1200, 1, 8), eng=(2002, 500, 4000, 1, 0)),
    "d3_b6.0": dict(shape=(8, 8, 8), beta=6.0,
                    ref=(1003, 200, 1200, 1, 8), eng=(2003, 500, 4000, 1, 2)),
    "d4_b1.0": dict(shape=(6, 6, 6, 6), beta=1.0,
                    ref=(1004, 100, 800, 1, 2), eng=(2004, 200, 2000, 1, 0)),
    "d4_b2.3": dict(shape=(6, 6, 6, 6), beta=2.3,
                    ref=(1005, 200, 600, 2, 8), eng=(2005, 500, 2500, 1, 2)),
    "d4_b2.5": dict(shape=(6, 6, 6, 6), beta=2.5,
                    ref=(1006, 200, 500, 2, 8), eng=(2006, 500, 2500, 1, 2)),
}
# high statistics; the engine is run in BOTH update modes (pure heatbath, heatbath + 2 overrelax)
ENSEMBLES_SLOW = {
    "d2_b4.0": dict(shape=(16, 16), beta=4.0, ref=(1011, 300, 50000, 1, 4),
                    eng=[(2011, 1000, 100000, 1, 0), (2021, 1000, 100000, 1, 2)]),
    "d3_b3.0": dict(shape=(8, 8, 8), beta=3.0, ref=(1012, 300, 16000, 1, 8),
                    eng=[(2012, 1000, 40000, 1, 0), (2022, 1000, 40000, 1, 2)]),
    "d3_b6.0": dict(shape=(8, 8, 8), beta=6.0, ref=(1013, 300, 16000, 1, 8),
                    eng=[(2013, 1000, 40000, 1, 0), (2023, 1000, 40000, 1, 2)]),
    "d4_b1.0": dict(shape=(6, 6, 6, 6), beta=1.0, ref=(1014, 200, 8000, 1, 2),
                    eng=[(2014, 500, 12000, 1, 0), (2024, 500, 12000, 1, 2)]),
    # d4_b2.3: the pure-heatbath engine run was lengthened from 10000 to 20000 measurements after
    # the first recorded run: agreement was fine (plaquette z = +0.02) but the combined sigma,
    # 4.12e-4, missed the 4e-4 "informative" limit because pure heatbath has tau_int = 6.8 here
    # (I had assumed the tau_int = 2.9 of heatbath + overrelaxation).  Seeds, limits and the
    # agreement criterion were not touched.
    "d4_b2.3": dict(shape=(6, 6, 6, 6), beta=2.3, ref=(1015, 400, 3200, 2, 8),
                    eng=[(2015, 1000, 20000, 1, 0), (2025, 1000, 10000, 1, 2)]),
    "d4_b2.5": dict(shape=(6, 6, 6, 6), beta=2.5, ref=(1016, 400, 3200, 2, 8),
                    eng=[(2016, 1000, 10000, 1, 0), (2026, 1000, 10000, 1, 2)]),
}
# upper limits on the combined sigma (the comparison has to be informative).  The slow limits were
# fixed from the default-run errors scaled by 1/sqrt(statistics), before the slow runs were made.
MAX_SIGMA = {"plaq": 1.0e-3, "w12": 2.5e-3, "w22": 2.5e-3, "pol2": 2.5e-3, "polabs": 1.5e-2}
MAX_SIGMA_SLOW = {"plaq": 4.0e-4, "w12": 8e-4, "w22": 1e-3, "pol2": 8e-4, "polabs": 5e-3}


def check_ensemble(name, cfg, eng_params_list, n_bins_ref, n_bins_eng, max_sigma, min_bin_tau):
    shape, beta = cfg["shape"], cfg["beta"]
    seed, n_therm, n_meas, every, n_hit = cfg["ref"]
    r = ref_run(shape, beta, seed, n_therm, n_meas, every, n_hit)
    rs = summarise(r["series"], n_bins_ref)
    rep = Report("%s  shape %s beta %.1f\n  reference: Metropolis n_hit %d, eps %.3f, acceptance "
                 "%.3f, %d measurements every %d sweep(s), %d bins"
                 % (name, shape, beta, n_hit, r["eps"], r["acceptance"], n_meas, every, n_bins_ref))
    assert r["unitarity"] < 1e-12
    for eng_params in eng_params_list:
        eseed, etherm, emeas, n_hb, n_or = eng_params
        e = eng_run(shape, beta, eseed, etherm, emeas, n_hb, n_or)
        es = summarise(e["series"], n_bins_eng)
        rep.note("engine: %d heatbath + %d overrelaxation per update, %d measurements, %d bins"
                 % (n_hb, n_or, emeas, n_bins_eng))
        assert e["unitarity"] < 1e-12
        for obs in OBS:
            rm, re_, rt, rb = rs[obs]
            em, ee, et, eb = es[obs]
            rep.compare("%s" % obs, rm, re_, em, ee, max_sigma=max_sigma[obs])
            rep.note("     tau_int ref %.1f (bin %d) eng %.1f (bin %d)" % (rt, rb, et, eb))
            if obs == "plaq":
                # precondition of the binned error: bins much longer than the autocorrelation time
                assert rb >= min_bin_tau * rt, "reference bins too short: %d vs tau %.1f" % (rb, rt)
                assert eb >= min_bin_tau * et, "engine bins too short: %d vs tau %.1f" % (eb, et)
        if len(shape) == 2:                                      # exact results as arbiter
            u = ref.u_exact(beta)
            for obs, exact_value in (("plaq", u), ("w12", u ** 2), ("w22", u ** 4), ("pol2", 0.25)):
                rep.compare("%s eng vs exact" % obs, es[obs][0], es[obs][1], exact_value,
                            a_name="eng", b_name="exact")
    if len(shape) == 2:
        u = ref.u_exact(beta)
        for obs, exact_value in (("plaq", u), ("w12", u ** 2), ("w22", u ** 4), ("pol2", 0.25)):
            rep.compare("%s ref vs exact" % obs, rs[obs][0], rs[obs][1], exact_value, b_name="exact")
    rep.finish()


@pytest.mark.parametrize("name", list(ENSEMBLES))
def test_d_engine_agrees_with_reference(name):
    cfg = ENSEMBLES[name]
    check_ensemble(name, cfg, [cfg["eng"]], n_bins_ref=20, n_bins_eng=40, max_sigma=MAX_SIGMA,
                   min_bin_tau=3.0)


@pytest.mark.slow
@pytest.mark.parametrize("name", list(ENSEMBLES_SLOW))
def test_d_engine_agrees_with_reference_high_statistics(name):
    cfg = ENSEMBLES_SLOW[name]
    check_ensemble(name, cfg, cfg["eng"], n_bins_ref=40, n_bins_eng=40, max_sigma=MAX_SIGMA_SLOW,
                   min_bin_tau=8.0)


# ================================================================================================
# E. strong-coupling prediction P = u + 8 (D-2) u^5 u' at beta = 1 with the reference code
# ================================================================================================
# (shape, beta, seed, n_therm, n_meas, meas_every, n_hit, loops)
STRONG = {
    3: ((12, 12, 12), 1.0, 1201, 100, 1500, 1, 2, False),
    4: ((6, 6, 6, 6), 1.0, 1004, 100, 800, 1, 2, True),          # the D=4 beta=1 cross-check run
}
STRONG_SLOW = {
    3: ((12, 12, 12), 1.0, 1211, 200, 20000, 1, 2, False),
    4: ((8, 8, 8, 8), 1.0, 1212, 200, 5000, 1, 2, False),
}


def check_strong_coupling(D, params, n_bins):
    shape, beta = params[0], params[1]
    run = ref_run(*params)
    mean, err, tau, blen = summarise(run["series"], n_bins)["plaq"]
    lo, u, t6 = ref.strong_coupling_lo(beta, D)
    t10 = ref.strong_coupling_t10(beta, D)
    unit = t6 / (8.0 * (D - 2))                                  # u^5 u'
    rep = Report("strong coupling D=%d shape %s beta %.1f (reference Metropolis, n_hit %d, eps %.3f, "
                 "acceptance %.3f, %d sweeps, %d bins, tau_int %.2f)"
                 % (D, shape, beta, params[6], run["eps"], run["acceptance"], len(run["series"]),
                    n_bins, tau))
    z_u = rep.compare("P vs u", mean, err, u, z_max=np.inf, b_name="u   ")
    rep.compare("P vs u + t6", mean, err, lo, z_max=np.inf, b_name="LO  ")
    z_nlo = rep.compare("P vs u + t6 + t10", mean, err, lo + t10, b_name="NLO ")
    rep.note("t6 = 8(D-2) u^5 u' = %.3e,  t10 = 40(D-2)(2D-5) u^9 u' = %.3e" % (t6, t10))
    rep.note("measured coefficient (P - u)/(u^5 u')       = %.2f +- %.2f   (prediction 8(D-2) = %d;"
             " the t10 term alone would add %.2f)" % ((mean - u) / unit, err / unit, 8 * (D - 2),
                                                      t10 / unit))
    rep.note("measured coefficient (P - u - t10)/(u^5 u') = %.2f +- %.2f   (%+.2f sigma from %d)"
             % ((mean - u - t10) / unit, err / unit, (mean - u - t10 - t6) / err, 8 * (D - 2)))
    assert blen >= 8 * tau
    assert err < t6 / 5.0, "run too short to separate u from u + t6"
    assert z_u > 5.0, "data do not exclude P = u"                # P = u is excluded ...
    assert abs(z_nlo) < Z_MAX                                    # ... and the series fits
    assert abs(mean - lo) < Z_MAX * err + abs(t10)               # LO up to its known next term
    rep.finish()
    return mean, err


@pytest.mark.parametrize("D", [3, 4])
def test_e_strong_coupling_coefficient(D):
    check_strong_coupling(D, STRONG[D], n_bins=20)


@pytest.mark.slow
@pytest.mark.parametrize("D", [3, 4])
def test_e_strong_coupling_coefficient_high_statistics(D):
    check_strong_coupling(D, STRONG_SLOW[D], n_bins=40)


def test_e_strong_coupling_reference_agrees_with_engine_d3():
    """The 12^3, beta = 1 reference run against a pure-heatbath engine run (plaquette only)."""
    params = STRONG[3]
    r = ref_run(*params)
    e = eng_run(params[0], params[1], 2201, 200, 3000, 1, 0, loops=False)
    rm, re_, rt, rb = summarise(r["series"], 20)["plaq"]
    em, ee, et, eb = summarise(e["series"], 40)["plaq"]
    rep = Report("D=3 12^3 beta 1.0 plaquette, reference Metropolis vs engine heatbath")
    rep.compare("plaq", rm, re_, em, ee, max_sigma=5e-4)
    rep.finish()
