"""Validation of the analysis layer (ym/stats.py) on SYNTHETIC data with an exactly known answer.

Run from the project directory:

    python3 -m pytest -q tests/test_stats.py          # < 1.5 minutes
    python3 -m pytest -q tests/test_stats.py -rP      # ... and print the measured numbers

Synthetic data
--------------
"Modes" are Gaussian fields on a periodic ring of T time slices obtained by filtering white
noise with the lattice propagator 1 / (4 sin^2(p/2) + 4 sinh^2(m/2)); their correlator is
EXACTLY cosh(m (tau - T/2)) / cosh(m T/2) (free lattice scalar in one dimension).  Successive
"configurations" are correlated by an AR(1) process in Monte Carlo time (coefficient rho_mc),
which leaves the equal-MC-time distribution unchanged.  Operators are

    O_k(t) = vev_k + sum_a mix[k, a] * phi_a(t) + eps * (white noise in t and k),

so that the exact connected correlator matrix is
    C_kl(tau) = sum_a mix[k,a] mix[l,a] cosh(m_a (tau - T/2)) / cosh(m_a T/2) + eps^2 delta_kl delta_tau0.
The white noise acts like an infinitely heavy excited state: it contaminates only tau = 0.

Rules followed in this file
---------------------------
* Seeds, tolerances and acceptance windows were fixed BEFORE the tests were first run.  Run
  lengths and windows were chosen from exploratory runs with OTHER seeds (555001-555003); the
  exploratory numbers are quoted in the docstrings of the coverage tests.
* A statistical comparison is always accompanied by a precision requirement, so that a test
  cannot pass merely because its error bar is large.
* Changes made after the first run (no seed, statistical tolerance or acceptance window was
  changed):
  (1) test_tau_int_ar1: the first run printed tau_int = 0.001 for rho = -0.5 (exact 1/6) and
      still passed, because the bias allowance was vacuous for negative rho.  This exposed a
      real defect of the window criterion in ym/stats.py for anticorrelated series; the
      criterion got a minimal window (W >= 6 max(tau, 1/2)) and the test tolerance was
      TIGHTENED to the exact truncation bias.
  (2) test_string_tension_formulas: the first version also inverted the Nambu-Goto formula at
      parameters where the Nambu-Goto energy is imaginary (D=4, L=8, sigma=0.03); that was an
      error of the test, which now checks that NaN is returned there.
  (3) integration round: test_tau_int_streams_of_unequal_length was added together with a fix
      of stats.tau_int (review finding: one very short stream truncated the Madras-Sokal
      window of the whole ensemble).  Its criteria were written before its first run.
* These tests validate an analysis code.  They are not evidence about Yang-Mills theory.
"""
import math

import numpy as np
import pytest
from scipy.signal import lfilter

from ym import stats


# ==============================================================================================
# synthetic data with exactly known correlators
# ==============================================================================================
def ring_modes(rng, N, T, masses, rho_mc):
    """phi[n, a, t]: independent unit-variance Gaussian fields on a periodic ring with
    <phi_a(t) phi_a(t + tau)> = cosh(m_a (tau - T/2)) / cosh(m_a T/2), AR(1) in Monte Carlo
    time n with coefficient rho_mc (stationary from n = 0)."""
    masses = np.asarray(masses, dtype=np.float64)
    p = 2.0 * np.pi * np.arange(T // 2 + 1) / T
    out = np.empty((N, masses.size, T))
    s = math.sqrt(1.0 - rho_mc ** 2)
    for a, m in enumerate(masses):
        spec = 1.0 / (4.0 * np.sin(p / 2.0) ** 2 + 4.0 * np.sinh(m / 2.0) ** 2)
        g0 = np.cosh(m * T / 2.0) / (2.0 * np.sinh(m) * np.sinh(m * T / 2.0))
        xi = rng.standard_normal((N, T))
        f = np.fft.irfft(np.fft.rfft(xi, axis=1) * np.sqrt(spec)[None, :], n=T, axis=1)
        f /= math.sqrt(g0)
        f[0] /= s                                   # stationary start of the AR(1) recursion
        out[:, a] = lfilter([s], [1.0, -rho_mc], f, axis=0)
    return out


def make_ops(rng, N, T, masses, mix, vev, eps, rho_mc):
    """O[n, k, t] = vev_k + sum_a mix[k, a] phi_a(t) + eps * white noise."""
    phi = ring_modes(rng, N, T, masses, rho_mc)
    O = np.einsum("ka,nat->nkt", np.asarray(mix, dtype=np.float64), phi)
    O += eps * rng.standard_normal(O.shape)
    O += np.asarray(vev, dtype=np.float64)[None, :, None]
    return O


def exact_C(T, masses, mix, eps):
    """Exact connected correlator matrix C[k, l, tau], tau = 0 .. T/2."""
    mix = np.asarray(mix, dtype=np.float64)
    K = mix.shape[0]
    tau = np.arange(T // 2 + 1)
    C = np.zeros((K, K, T // 2 + 1))
    for a, m in enumerate(masses):
        g = np.cosh(m * (tau - T / 2.0)) / np.cosh(m * T / 2.0)
        C += np.outer(mix[:, a], mix[:, a])[:, :, None] * g[None, None, :]
    C[:, :, 0] += eps ** 2 * np.eye(K)
    return C


def brute_correlator(O, subtract):
    """Direct O(N K^2 T^2) evaluation of rule R1 for O[n, k, t] (reference implementation)."""
    N, K, T = O.shape
    C = np.zeros((K, K, T))
    for k in range(K):
        for l in range(K):
            for tau in range(T):
                acc = 0.0
                for t in range(T):
                    acc += np.mean(O[:, k, t] * O[:, l, (t + tau) % T])
                C[k, l, tau] = acc / T
    if subtract:
        v = O.mean(axis=(0, 2))
        C -= np.outer(v, v)[:, :, None]
    sym = np.zeros((K, K, T // 2 + 1))
    for k in range(K):
        for l in range(K):
            for tau in range(T // 2 + 1):
                sym[k, l, tau] = 0.25 * (C[k, l, tau] + C[l, k, tau]
                                         + C[k, l, (T - tau) % T] + C[l, k, (T - tau) % T])
    return sym


# scenario used by the two-state tests
T2 = 16
MASSES2 = [0.5, 1.3]
MIX2 = [[1.0, 0.7], [0.9, -0.4], [0.5, 1.0]]
VEV2 = [40.0, -25.0, 10.0]
EPS2 = 0.4


# ==============================================================================================
# binning, jackknife
# ==============================================================================================
def test_bin_means_drops_leading_remainder():
    x = np.arange(11, dtype=np.float64)
    b = stats.bin_means(x, 3)
    assert b.shape == (3,)
    np.testing.assert_allclose(b, [3.0, 6.0, 9.0])          # entries 0, 1 dropped
    y = np.arange(24, dtype=np.float64).reshape(8, 3)
    b2 = stats.bin_means(y, 4)
    assert b2.shape == (2, 3)
    np.testing.assert_allclose(b2[0], y[:4].mean(axis=0))
    with pytest.raises(ValueError):
        stats.bin_means(x, 0)


def test_jackknife_of_the_mean_is_the_standard_error():
    rng = np.random.default_rng(1101)
    x = rng.standard_normal(500) * 3.0 + 7.0
    val, err, samples = stats.jackknife(lambda m: m, x)
    assert abs(val - x.mean()) < 1e-13
    assert abs(err - x.std(ddof=1) / math.sqrt(x.size)) < 1e-13
    assert samples.shape == (500,)
    # array-valued function
    y = rng.standard_normal((500, 4))
    val, err, _ = stats.jackknife(lambda m: 2.0 * m, y)
    np.testing.assert_allclose(err, 2.0 * y.std(axis=0, ddof=1) / math.sqrt(500), rtol=1e-12)


def test_jackknife_nonlinear_function_matches_delta_method():
    rng = np.random.default_rng(1102)
    n = 4000
    x = 5.0 + rng.standard_normal(n)
    y = 3.0 + 0.6 * (x - 5.0) + 0.8 * rng.standard_normal(n)
    val, err, _ = stats.jackknife(lambda a, b: a / b, x, y)
    mx, my = x.mean(), y.mean()
    cov = np.cov(x, y, ddof=1)
    var = (cov[0, 0] / my ** 2 + mx ** 2 * cov[1, 1] / my ** 4
           - 2.0 * mx * cov[0, 1] / my ** 3) / n
    assert abs(val - mx / my) < 1e-13
    assert abs(err / math.sqrt(var) - 1.0) < 0.01
    print("ratio %.5f  jackknife err %.6f  delta-method err %.6f" % (val, err, math.sqrt(var)))


def test_jackknife_error_infinite_if_any_sample_undefined():
    s = np.array([[1.0, 2.0], [1.1, np.nan], [0.9, 2.1]])
    e = stats.jackknife_error(s)
    assert np.isfinite(e[0]) and np.isinf(e[1])


# ==============================================================================================
# autocorrelation
# ==============================================================================================
def ar1(rng, n, rho):
    s = math.sqrt(1.0 - rho * rho)
    xi = rng.standard_normal(n)
    xi[0] /= s
    return lfilter([s], [1.0, -rho], xi)


@pytest.mark.parametrize("rho", [0.0, 0.5, 0.8, 0.95, -0.5])
def test_tau_int_ar1(rho):
    """AR(1): rho(t) = rho^|t|, tau_int = 1/2 + rho/(1 - rho) = (1 + rho) / (2 (1 - rho))."""
    rng = np.random.default_rng(2200 + int(round(100 * rho)))
    n = 400000
    x = ar1(rng, n, rho)
    tau, dtau, W = stats.tau_int(x)
    exact = (1.0 + rho) / (2.0 * (1.0 - rho))
    print("rho %+.2f: tau_int = %.4f +- %.4f (window %d), exact %.4f, pull %+.2f"
          % (rho, tau, dtau, W, exact, (tau - exact) / dtau))
    assert dtau / exact < 0.06                       # precision requirement
    assert W >= 3
    # the automatic window truncates the sum at W: exact bias -rho^(W+1)/(1-rho) (tiny for
    # rho > 0; 0.04 for rho = -0.5, where the minimal window W = 3 applies).
    # NOTE: this tolerance was TIGHTENED after the first run, which showed that the original
    # allowance |rho|^(W+1)/(1-|rho|) was vacuous for rho = -0.5 and had hidden a real defect of
    # the window criterion for anticorrelated series (it stopped at W = 1 with tau_int = 0);
    # the criterion in ym/stats.py was corrected (minimal window) and the test now checks it.
    assert abs(tau - exact) < 4.0 * dtau + abs(rho ** (W + 1) / (1.0 - rho))


def test_tau_int_streams_and_error_of_mean():
    rng = np.random.default_rng(2301)
    rho = 0.7
    exact = (1.0 + rho) / (2.0 * (1.0 - rho))
    streams = [ar1(rng, 60000, rho) + 2.0 for _ in range(5)]
    tau, dtau, W = stats.tau_int(streams)
    assert abs(tau - exact) < 4.0 * dtau and dtau / exact < 0.08
    r = stats.mean_err_tau(streams)
    true_err = math.sqrt(2.0 * exact / 300000.0)
    assert abs(r["err"] / true_err - 1.0) < 0.10
    assert abs(r["mean"] - 2.0) < 4.0 * r["err"]
    assert r["err"] > 2.0 * r["err_naive"]           # naive error is too small by sqrt(2 tau)
    # constant series
    assert stats.tau_int(np.ones(100)) == (0.5, 0.0, 0)
    # binned error with bins >> tau agrees with the tau_int error
    allx = np.concatenate([stats.bin_means(s, 500) for s in streams])
    _, jerr, _ = stats.jackknife(lambda m: m, allx)
    assert abs(jerr / true_err - 1.0) < 0.15
    print("tau %.3f(%.3f) exact %.3f; err(tau) %.5f, err(binned) %.5f, true %.5f"
          % (tau, dtau, exact, r["err"], jerr, true_err))


def _brute_rho(streams, maxlag):
    """Literal definition: Gamma(t) = sum_r sum_i d_i d_(i+t) / sum_r max(N_r - t, 0)."""
    m = sum(s.sum() for s in streams) / sum(s.size for s in streams)
    g = np.empty(maxlag + 1)
    for t in range(maxlag + 1):
        num = sum(float(np.dot((s - m)[:s.size - t], (s - m)[t:])) for s in streams if s.size > t)
        den = sum(s.size - t for s in streams if s.size > t)
        g[t] = num / den
    return g / g[0]


def test_tau_int_streams_of_unequal_length():
    """Review finding (minor): the lag range of the pooled autocorrelation function was limited
    to half the length of the SHORTEST stream, so one very short stream (a job that died early)
    silently truncated the Madras-Sokal window of the whole ensemble and tau_int - hence the
    automatic bin size - came out too small.  Fixed in stats.tau_int: if the window is not
    reached within N_min / 2 the search continues up to N_max / 2 with the streams that are
    long enough.

    AR(1) data with tau_int = 5 exactly; streams of 4000, 4000 and 8 measurements.  Criteria
    (written before the first run):
      * the pooled rho(t) equals the literal definition (1e-10), with the default lag range
        and with an explicit one beyond the shortest stream;
      * with the short stream added, the window is reached (finite error), tau_int differs by
        less than 5 % from the value of the two long streams alone, and it is within 4 sigma
        of the exact value 5 with a relative error below 25 %;
      * streams of equal length, and unequal streams whose window IS reached within N_min / 2,
        give bit-for-bit what the previous implementation gave (re-implemented here).
    """
    rho = 9.0 / 11.0
    rng = np.random.default_rng(2310)
    a, b, c = ar1(rng, 4000, rho) + 1.0, ar1(rng, 4000, rho) + 1.0, ar1(rng, 8, rho) + 1.0
    # literal definition
    assert np.allclose(stats.autocorrelation([a, b, c]), _brute_rho([a, b, c], 4),
                       rtol=0, atol=1e-10)
    assert np.allclose(stats.autocorrelation([a, b, c], maxlag=60), _brute_rho([a, b, c], 60),
                       rtol=0, atol=1e-10)
    assert stats.autocorrelation([a, b, c], maxlag=10 ** 9).size == 4000    # clipped at N_max - 1
    t2 = stats.tau_int([a, b])
    t3 = stats.tau_int([a, b, c])
    print("two long streams: tau_int = %.3f +- %.3f (W = %d); plus a stream of 8: "
          "%.3f +- %.3f (W = %d); exact 5" % (t2 + t3))
    assert math.isfinite(t2[1]) and math.isfinite(t3[1])
    assert t3[2] > 4                                   # not cut off at N_min / 2 = 4
    assert abs(t3[0] - t2[0]) < 0.05 * t2[0]
    assert abs(t3[0] - 5.0) < 4.0 * t3[1] and t3[1] / 5.0 < 0.25
    # a stream of a single measurement must not switch the estimate off either
    t1 = stats.tau_int([a, b, np.array([1.0])])
    assert math.isfinite(t1[1]) and abs(t1[0] - t2[0]) < 0.05 * t2[0]

    def old_tau_int(streams, cc=6.0):
        """The implementation before the fix (lag range N_min / 2 for every stream)."""
        ntot = sum(x.size for x in streams)
        nmin = min(x.size for x in streams)
        maxlag = nmin // 2
        m = sum(x.sum() for x in streams) / ntot
        num = np.zeros(maxlag + 1)
        den = np.zeros(maxlag + 1)
        for x in streams:
            d = x - m
            nfft = 1
            while nfft < d.size + maxlag + 1:
                nfft *= 2
            f = np.fft.rfft(d, nfft)
            num += np.fft.irfft(f * np.conj(f), nfft)[:maxlag + 1]
            den += d.size - np.arange(maxlag + 1)
        r = num / den
        r = r / r[0]
        tau = 0.5 + np.cumsum(r[1:])
        w = np.arange(1, r.size)
        ok = np.nonzero(w >= cc * np.maximum(tau, 0.5))[0]
        if ok.size == 0:
            return float(tau[-1]), float("inf"), int(w[-1])
        i = int(ok[0])
        t = max(float(tau[i]), 1e-3)
        return t, float(t * math.sqrt(2.0 * (2 * int(w[i]) + 1) / ntot)), int(w[i])

    for streams in ([a, b], [a], [a, b[:3500]], [a[:1000], b, a[1000:3100]]):
        assert stats.tau_int(streams) == old_tau_int(streams)
    assert old_tau_int([a, b, c])[2] == 4 and not math.isfinite(old_tau_int([a, b, c])[1])
    # still honest when the window cannot be reached at all: linear ramps of 40 and 30 points
    # (deterministic, strongly correlated; tau_int(W) grows with W over the whole lag range).
    # [The first version of this auxiliary check used a[:40], b[:30], for which the window IS
    #  reached (tau 2.99); that was an error of the check, not of the code.]
    ramp = stats.tau_int([np.arange(40.0), np.arange(30.0)])
    assert not math.isfinite(ramp[1]) and ramp[2] == 20


# ==============================================================================================
# correlator matrices
# ==============================================================================================
def test_correlator_matches_brute_force_and_subtracts_inside_the_jackknife():
    rng = np.random.default_rng(3301)
    N, K, T, B = 12, 3, 8, 3
    O = rng.standard_normal((N, K, T)) + np.array([3.0, -2.0, 0.5])[None, :, None]
    A, Vb = stats.correlator_bins(O, B)
    assert A.shape == (4, K, K, T) and Vb.shape == (4, 1, K)
    for subtract in (True, False):
        C, Cjk = stats.jackknife_correlators(A, Vb, subtract=subtract)
        assert C.shape == (K, K, T // 2 + 1) and Cjk.shape == (4, K, K, T // 2 + 1)
        np.testing.assert_allclose(C, brute_correlator(O, subtract), atol=1e-12)
        for b in range(4):
            keep = np.ones(N, dtype=bool)
            keep[b * B:(b + 1) * B] = False
            # the jackknife sample must equal the full analysis (including ITS OWN vacuum
            # subtraction) of the data without bin b
            np.testing.assert_allclose(Cjk[b], brute_correlator(O[keep], subtract), atol=1e-12)
    # symmetry properties
    C, _ = stats.jackknife_correlators(A, Vb, subtract=True)
    np.testing.assert_allclose(C, np.swapaxes(C, 0, 1), atol=1e-14)
    # a constant shift of the operators does not change the connected correlator
    A2, Vb2 = stats.correlator_bins(O, B, ref=np.array([3.0, -2.0, 0.5]))
    C2, Cjk2 = stats.jackknife_correlators(A2, Vb2, subtract=True)
    _, Cjk1 = stats.jackknife_correlators(A, Vb, subtract=True)
    np.testing.assert_allclose(C2, C, atol=1e-12)
    np.testing.assert_allclose(Cjk2, Cjk1, atol=1e-12)
    # leftover configurations are dropped from the start
    A3, _ = stats.correlator_bins(O[1:], B)
    A4, _ = stats.correlator_bins(O[3:], B)
    np.testing.assert_allclose(A3, A4, atol=1e-14)


def test_correlator_copies_are_averaged():
    """Input (N, G, K, T): the correlator matrices of the G copies are averaged."""
    rng = np.random.default_rng(3302)
    N, G, K, T = 10, 2, 2, 6
    O = rng.standard_normal((N, G, K, T))
    A, Vb = stats.correlator_bins(O, 5)
    assert Vb.shape == (2, G, K)
    C, _ = stats.jackknife_correlators(A, Vb, subtract=False)
    ref = 0.5 * (brute_correlator(O[:, 0], False) + brute_correlator(O[:, 1], False))
    np.testing.assert_allclose(C, ref, atol=1e-12)
    Cs, _ = stats.jackknife_correlators(A, Vb, subtract=True)
    refs = 0.5 * (brute_correlator(O[:, 0], True) + brute_correlator(O[:, 1], True))
    np.testing.assert_allclose(Cs, refs, atol=1e-12)


def test_synthetic_generator_reproduces_exact_correlator():
    """Checks the test infrastructure itself: sample correlator vs exact formula."""
    rng = np.random.default_rng(3303)
    O = make_ops(rng, 200000, T2, MASSES2, MIX2, VEV2, EPS2, 0.0)
    A, Vb = stats.correlator_bins(O, 1000)
    C, Cjk = stats.jackknife_correlators(A, Vb, subtract=True)
    err = stats.jackknife_error(Cjk)
    pull = (C - exact_C(T2, MASSES2, MIX2, EPS2)) / err
    iu = np.triu_indices(3)
    p = pull[iu]                                     # 6 independent matrix elements x 9 times
    print("generator: max |pull| %.2f, rms pull %.2f, max rel. err %.4f"
          % (np.abs(p).max(), math.sqrt((p ** 2).mean()), (err / np.abs(C)).max()))
    assert np.abs(p).max() < 4.5
    assert 0.6 < math.sqrt((p ** 2).mean()) < 1.4
    assert (err[0, 0, :5] / np.abs(C[0, 0, :5])).max() < 0.02


# ==============================================================================================
# effective masses, GEVP, plateau rule, string tension: deterministic checks
# ==============================================================================================
@pytest.mark.parametrize("m", [0.02, 0.3, 1.0, 2.5])
@pytest.mark.parametrize("T", [8, 16, 32])
def test_cosh_effective_mass_exact(m, T):
    t = np.arange(T // 2 + 1)
    C = 3.7 * np.cosh(m * (t - T / 2.0))
    got = stats.cosh_effective_mass(C[:-1], C[1:], np.arange(T // 2), T)
    np.testing.assert_allclose(got, m, rtol=1e-10)
    # log-ratio effective mass is NOT the mass on a periodic lattice: it is smaller near T/2
    ml = stats.log_effective_mass(C[:-1], C[1:])
    assert np.all(ml <= m + 1e-12) and ml[-1] < m


def test_effective_mass_undefined_cases():
    assert math.isnan(stats.cosh_effective_mass(1.0, 1.5, 2, 16))     # rising correlator
    assert math.isnan(stats.cosh_effective_mass(-1.0, 0.5, 2, 16))
    assert math.isnan(stats.cosh_effective_mass(1.0, -0.5, 2, 16))
    assert math.isnan(stats.log_effective_mass(1.0, -0.5))
    assert abs(stats.log_effective_mass(math.e, 1.0) - 1.0) < 1e-15
    out = stats.cosh_effective_mass(np.array([2.0, 1.0]), np.array([1.0, 2.0]), np.array([0, 1]), 16)
    assert np.isfinite(out[0]) and np.isnan(out[1])


def test_gevp_exact_on_noiseless_two_state_data():
    """With as many operators as states and no noise the GEVP is exact: the projected
    correlator is a single cosh and m_eff(t) = m_1 at every t."""
    mix = [[1.0, 0.7], [0.9, -0.4]]
    C = exact_C(T2, MASSES2, mix, 0.0)
    g = stats.gevp_project(C, np.stack([C, C]))
    assert sorted(g["selected"]) == [0, 1]
    me = stats.effective_masses(g["Cproj"], g["Cproj_jk"], T2)
    np.testing.assert_allclose(me["m_cosh"], MASSES2[0], rtol=1e-9)
    # generalised eigenvalues = cosh(m (1 - T/2)) / cosh(m T/2)
    lam_exact = [math.cosh(m * (1 - T2 / 2.0)) / math.cosh(m * T2 / 2.0) for m in MASSES2]
    np.testing.assert_allclose(g["eigenvalues"], lam_exact, rtol=1e-10)
    # a single operator is contaminated: its effective mass lies above m_1 and decreases
    m_single = stats.cosh_effective_mass(C[0, 0, :-1], C[0, 0, 1:], np.arange(T2 // 2), T2)
    assert m_single[0] > MASSES2[0] + 0.05 and np.all(np.diff(m_single) < 0)


def test_gevp_three_states_three_operators():
    masses = [0.4, 0.9, 1.6]
    mix = [[1.0, 0.5, 0.3], [0.6, -0.8, 0.2], [0.3, 0.4, -1.0]]
    C = exact_C(20, masses, mix, 0.0)
    g = stats.gevp_project(C, np.stack([C, C]))
    me = stats.effective_masses(g["Cproj"], g["Cproj_jk"], 20)
    np.testing.assert_allclose(me["m_cosh"], masses[0], rtol=1e-8)


def test_operator_selection_rule():
    # operator 2 is an exact copy of operator 0, operator 3 is almost a copy of operator 1
    mix = np.array([[1.0, 0.7], [0.9, -0.4], [1.0, 0.7], [0.9, -0.4]])
    C = exact_C(T2, MASSES2, mix, 0.0)
    # give every operator a small independent noise at tau = 0, tiny for the near-copy
    C[:, :, 0] += np.diag([0.2, 0.2, 0.2, 0.2])
    C[2, :, :] = C[0, :, :]
    C[:, 2, :] = C[:, 0, :]
    C[2, 2, :] = C[0, 0, :]
    C[1, 3, 0] = C[3, 1, 0] = C[1, 1, 0] * 0.9995
    sel, info = stats.select_operators(C)
    assert len(sel) == 2
    assert sel[0] == info["ranking"][0]              # the best single operator is always kept
    assert not (0 in sel and 2 in sel)               # exact duplicates never both survive
    assert not (1 in sel and 3 in sel)               # nor near duplicates
    assert sum("dropped" in d for d in info["decisions"]) == 2
    # the same matrix with a loose threshold keeps the near-duplicate
    sel2, _ = stats.select_operators(C, min_eig=1e-6)
    assert len(sel2) == 3
    # non-positive diagonal correlators are discarded
    C2 = C.copy()
    C2[0, 0, 1] = -1.0
    sel3, info3 = stats.select_operators(C2)
    assert 0 not in sel3 and "discarded" in info3["decisions"][0]


def _fake_jk(m, err, rng, nb=40):
    """Jackknife samples whose jackknife error is exactly err[t] and that are uncorrelated
    between different t (so the error of a difference is the quadrature sum)."""
    m = np.asarray(m, dtype=np.float64)
    out = np.empty((nb, m.size))
    for t in range(m.size):
        d = rng.standard_normal(nb)
        d -= d.mean()
        out[:, t] = d
    # orthogonalise the columns so that the samples of different t are exactly uncorrelated
    q, _ = np.linalg.qr(out - out.mean(axis=0)[None])
    for t in range(m.size):
        d = q[:, t]
        d = d / math.sqrt((nb - 1.0) / nb * np.sum(d * d))
        out[:, t] = m[t] + err[t] * d
    return out


def test_plateau_rule_branches():
    rng = np.random.default_rng(4401)
    # (i) plateau at t = 1
    m = np.array([1.5, 1.00, 1.01, 1.0, 1.0, 1.0, 1.0, 1.0])
    e = np.array([0.01, 0.02, 0.03, 0.05, 0.08, 0.1, 0.2, 0.3])
    r = stats.plateau_rule(m, _fake_jk(m, e, rng))
    assert r["flag"] == "plateau" and r["t_star"] == 1 and r["plateau"]
    assert abs(r["mass"] - 1.00) < 1e-12 and abs(r["err"] - 0.02) < 1e-12
    assert not r["upper_bound_only"]
    # t = 0 is never accepted even if m(0) = m(1)
    m0 = np.array([1.0, 1.0, 1.3, 1.3, 1.3, 1.3, 1.3, 1.3])
    r = stats.plateau_rule(m0, _fake_jk(m0, e, rng))
    assert r["t_star"] == 2
    # (ii) m(1) - m(2) = 0.1 > 1 sigma (sqrt(0.02^2 + 0.03^2) = 0.036): skip; t = 2 agrees
    m = np.array([1.5, 1.10, 1.00, 1.02, 1.0, 1.0, 1.0, 1.0])
    r = stats.plateau_rule(m, _fake_jk(m, e, rng))
    assert r["t_star"] == 2 and abs(r["mass"] - 1.00) < 1e-12 and abs(r["err"] - 0.03) < 1e-12
    assert r["checks"][0]["agree"] is False and r["checks"][1]["agree"] is True
    assert abs(r["checks"][0]["diff_err"] - math.hypot(0.02, 0.03)) < 1e-10
    # exactly at the boundary |d| = 1.0 sigma counts as agreement; just above does not
    sd = math.hypot(0.02, 0.03)
    for factor, expect in ((0.999, 1), (1.001, 2)):
        mb = np.array([1.5, 1.0 + factor * sd, 1.00, 1.0, 1.0, 1.0, 1.0, 1.0])
        assert stats.plateau_rule(mb, _fake_jk(mb, e, rng))["t_star"] == expect
    # (iii) agreement at t = 1 but m(2) has a 30 % error: not accepted there; later points
    #       are even noisier -> 'no plateau', value = last t of the initial run with error < 25 %
    m = np.array([1.5, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0])
    e3 = np.array([0.01, 0.05, 0.30, 0.4, 0.5, 0.6, 0.7, 0.8])
    r = stats.plateau_rule(m, _fake_jk(m, e3, rng))
    assert r["flag"] == "no plateau" and r["t_star"] is None and r["upper_bound_only"]
    assert r["t_value"] == 1 and abs(r["mass"] - 1.0) < 1e-12 and abs(r["err"] - 0.05) < 1e-12
    # (iv) effective masses never agree (steadily falling): 'no plateau'
    m = np.array([2.0, 1.8, 1.6, 1.4, 1.2, 1.0, 0.8, 0.6])
    e4 = np.full(8, 0.01)
    r = stats.plateau_rule(m, _fake_jk(m, e4, rng))
    assert r["flag"] == "no plateau" and r["t_value"] == 7 and r["upper_bound_only"]
    # (v) nothing usable
    e5 = np.full(8, 5.0)
    r = stats.plateau_rule(m, _fake_jk(m, e5, rng))
    assert r["flag"] == "no signal" and math.isnan(r["mass"]) and r["mass_jk"] is None
    # (vi) NaN in the central value or in one jackknife sample blocks that t
    m = np.array([1.5, 1.0, np.nan, 1.0, 1.0, 1.0, 1.0, 1.0])
    r = stats.plateau_rule(m, _fake_jk(np.nan_to_num(m, nan=1.0), e, rng))
    assert r["t_star"] == 3
    m = np.array([1.5, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0])
    jk = _fake_jk(m, e, rng)
    jk[7, 2] = np.nan                                 # m_eff(2) undefined in one sample
    r = stats.plateau_rule(m, jk)
    assert r["t_star"] == 3
    # the search stops at T/2 - 2: agreement only between the last two points is still found
    m = np.array([2.0, 1.8, 1.6, 1.4, 1.2, 1.1, 1.0, 1.0])
    r = stats.plateau_rule(m, _fake_jk(m, e4, rng))
    assert r["t_star"] == 6


def test_string_tension_formulas():
    # D = 2: no correction
    assert abs(stats.sigma_luscher(0.8, 4, 2) - 0.2) < 1e-15
    assert abs(stats.sigma_nambu_goto(0.8, 4, 2) - 0.2) < 1e-15
    n_checked = 0
    for D in (3, 4):
        for L in (8, 16, 32):
            for sigma in (0.03, 0.0644, 0.2):
                el = stats.torelon_energy_luscher(sigma, L, D)
                assert abs(stats.sigma_luscher(el, L, D) - sigma) < 1e-14
                assert abs(el - (sigma * L - math.pi * (D - 2) / (6.0 * L))) < 1e-15
                x = math.pi * (D - 2) / (3 * sigma * L * L)     # NG: E = sigma L sqrt(1 - x)
                en = stats.torelon_energy_nambu_goto(sigma, L, D)
                if x > 1.0:
                    # the Nambu-Goto ground state is tachyonic here (e.g. D=4, L=8,
                    # sigma=0.03): no real energy, the formula must not pretend otherwise
                    assert math.isnan(en)
                    continue
                n_checked += 1
                assert abs(stats.sigma_nambu_goto(en, L, D) - sigma) < 1e-14
                assert abs(en - sigma * L * math.sqrt(1 - x)) < 1e-15
                # the NG energy is the lower one; NG - Luscher = -c^2/(8 sigma L^3) (1 + O(x)),
                # c = pi (D-2)/3
                assert en < el
                if x < 0.3:
                    lead = (math.pi * (D - 2) / 3.0) ** 2 / (8 * sigma * L ** 3)
                    assert lead < el - en < 1.5 * lead
    assert n_checked >= 16
    # worked example: D = 3, L = 16, a sqrt(sigma) = 0.2538  ->  E = 0.99788...
    s = 0.2538 ** 2
    e = stats.torelon_energy_luscher(s, 16, 3)
    assert abs(e - (16 * s - math.pi / 96.0)) < 1e-15 and abs(e - 0.99790) < 2e-4
    # array input
    arr = stats.sigma_luscher(np.array([0.9, 1.0]), 16, 3)
    assert arr.shape == (2,) and arr[1] > arr[0]


def test_cosh_fit_recovers_exact_parameters():
    rng = np.random.default_rng(4501)
    T, m, amp = 16, 0.45, 2.5
    t = np.arange(T // 2 + 1)
    C = amp * np.cosh(m * (t - T / 2.0))
    jk = C[None, :] * (1.0 + 1e-4 * rng.standard_normal((30, T // 2 + 1)))
    f = stats.cosh_fit(C, jk, T, 1)
    assert f["ok"] and f["tmin"] == 1 and f["tmax"] == T // 2
    assert abs(f["m"] - m) < 1e-7 and abs(f["A"] / amp - 1.0) < 1e-6 and f["chi2"] < 1e-8
    assert 0 < f["err"] < 1e-2
    # too few usable points
    jk_noisy = C[None, :] * (1.0 + 5.0 * rng.standard_normal((30, T // 2 + 1)))
    assert stats.cosh_fit(C, jk_noisy, T, 1)["ok"] is False


# ==============================================================================================
# whole pipeline on synthetic data
# ==============================================================================================
def test_pipeline_recovers_ground_state_mass():
    """Two modes (m1 = 0.5, m2 = 1.3) seen through 3 noisy operators with large vacuum
    expectation values and Monte-Carlo-time autocorrelation (AR(1), rho = 0.6, i.e. tau_int = 2
    for the fields).  Criteria fixed in advance: |m - m1| < 3 sigma and sigma/m < 3 %."""
    rng = np.random.default_rng(20261111)
    rho = 0.6
    O = make_ops(rng, 20000, T2, MASSES2, MIX2, VEV2, EPS2, rho)
    r = stats.analyze_channel(O, T2, 40, subtract_vev=True)
    me = r["meff"]
    print("selected operators:", r["gevp"]["selected"], "| eigenvalues:", r["gevp"]["eigenvalues"])
    for t in range(6):
        print("  t=%d  m_cosh = %.4f +- %.4f   m_log = %.4f +- %.4f"
              % (t, me["m_cosh"][t], me["err_cosh"][t], me["m_log"][t], me["err_log"][t]))
    pl = r["plateau"]
    print("plateau: t* = %s, m = %.4f +- %.4f (exact %.4f, pull %+.2f), overlap %.3f"
          % (pl["t_star"], r["mass"], r["err"], MASSES2[0], (r["mass"] - MASSES2[0]) / r["err"],
             r["overlap"]))
    print("cosh fit: m = %.4f +- %.4f on t = %d..%d, chi2/dof = %.2f/%d"
          % (r["fit"]["m"], r["fit"]["err"], r["fit"]["tmin"], r["fit"]["tmax"],
             r["fit"]["chi2"], r["fit"]["dof"]))
    assert r["n_bins"] == 500 and r["n_dropped"] == 0
    assert pl["flag"] == "plateau" and pl["t_star"] >= 1
    assert r["err"] / r["mass"] < 0.03
    assert abs(r["mass"] - MASSES2[0]) < 3.0 * r["err"]
    assert abs(r["fit"]["m"] - MASSES2[0]) < 3.0 * r["fit"]["err"]
    # m_eff(0) is contaminated by the white noise and the second mode: clearly above m1
    assert me["m_cosh"][0] > MASSES2[0] + 5.0 * me["err_cosh"][0]
    # the variational estimate at t = 1 beats the best single operator at t = 1
    best_single = min(o["m_cosh"][1] for o in r["operator_table"])
    assert me["m_cosh"][1] < best_single + 2.0 * me["err_cosh"][1]
    # vacuum expectation values are recovered (errors from the binned jackknife)
    for k in range(3):
        assert abs(r["vev"][0, k] - VEV2[k]) < 4.0 * r["vev_err"][0, k]
        assert r["vev_err"][0, k] < 0.02
    # correlator matrix vs exact, at the times that matter
    pull = (r["C"] - exact_C(T2, MASSES2, MIX2, EPS2)) / r["C_err"]
    assert np.abs(pull[:, :, :6]).max() < 4.5


def test_vacuum_subtraction_is_essential():
    """Without the subtraction the correlator is dominated by vev^2 and the 'mass' collapses."""
    rng = np.random.default_rng(20261112)
    O = make_ops(rng, 4000, T2, MASSES2, MIX2, VEV2, EPS2, 0.3)
    good = stats.analyze_channel(O, T2, 20, subtract_vev=True, do_fit=False)
    bad = stats.analyze_channel(O, T2, 20, subtract_vev=False, do_fit=False)
    assert abs(good["meff"]["m_cosh"][1] - MASSES2[0]) < 4.0 * good["meff"]["err_cosh"][1]
    m_bad = bad["meff"]["m_cosh"][1]
    assert (not np.isfinite(m_bad)) or m_bad < 0.02


def test_binning_accounts_for_autocorrelation():
    """With strongly autocorrelated configurations the unbinned jackknife error of the vev is
    too small by about sqrt(2 tau_int); bins >> tau_int give the right error."""
    rng = np.random.default_rng(20261113)
    rho = 0.9                                         # tau_int of the fields = 9.5
    N = 40000
    O = make_ops(rng, N, T2, [0.5], [[1.0]], [0.0], 0.0, rho)
    r1 = stats.analyze_channel(O, T2, 1, subtract_vev=True, do_fit=False)
    r2 = stats.analyze_channel(O, T2, 400, subtract_vev=True, do_fit=False)
    # exact variance of the time-slice average of one configuration: (1/T) sum_tau g(tau)
    tau = np.arange(T2)
    g = np.cosh(0.5 * (np.minimum(tau, T2 - tau) - T2 / 2.0)) / np.cosh(0.5 * T2 / 2.0)
    var_cfg = g.sum() / T2
    true_err = math.sqrt(var_cfg * 2.0 * 9.5 / N)
    print("vev error: unbinned %.5f, binned(400) %.5f, exact %.5f"
          % (r1["vev_err"][0, 0], r2["vev_err"][0, 0], true_err))
    assert abs(r2["vev_err"][0, 0] / true_err - 1.0) < 0.25
    assert r1["vev_err"][0, 0] < 0.35 * true_err      # sqrt(1/19) = 0.23
    assert abs(r2["vev"][0, 0]) < 4.0 * r2["vev_err"][0, 0]


def test_streams_are_binned_separately_and_pooled():
    rng = np.random.default_rng(20261114)
    O = make_ops(rng, 1200, T2, MASSES2, MIX2, VEV2, EPS2, 0.3)
    whole = stats.analyze_channel(O, T2, 20, subtract_vev=True, do_fit=False)
    split = stats.analyze_channel([O[:400], O[400:]], T2, 20, subtract_vev=True, do_fit=False)
    # identical bins -> identical results
    np.testing.assert_allclose(split["C"], whole["C"], rtol=0, atol=1e-12)
    assert split["mass"] == pytest.approx(whole["mass"], abs=1e-12)
    assert split["err"] == pytest.approx(whole["err"], abs=1e-12)
    # streams whose lengths are not multiples of the bin size lose their leading remainder
    odd = stats.analyze_channel([O[:410], O[410:]], T2, 20, subtract_vev=True, do_fit=False)
    assert odd["n_total"] == 1200 and odd["n_used"] == 1180 and odd["n_dropped"] == 20
    assert odd["n_bins"] == 59


def _coverage_experiments(seed, nexp, N, masses, mix, vev, eps, rho, binsize):
    rng = np.random.default_rng(seed)
    rule, fixed1, tstars, flags = [], [], [], []
    for _ in range(nexp):
        O = make_ops(rng, N, T2, masses, mix, vev, eps, rho)
        r = stats.analyze_channel(O, T2, binsize, subtract_vev=True, do_fit=False)
        flags.append(r["plateau"]["flag"])
        if r["plateau"]["plateau"]:
            rule.append((r["mass"] - masses[0]) / r["err"])
            tstars.append(r["plateau"]["t_star"])
        fixed1.append((r["meff"]["m_cosh"][1] - masses[0]) / r["meff"]["err_cosh"][1])
    return np.array(rule), np.array(fixed1), np.array(tstars), flags


def test_coverage_of_jackknife_errors_at_fixed_t():
    """300 independent synthetic experiments, single state (m = 0.6), two operators, white
    noise, vev, MC autocorrelation rho = 0.5, bins of 20.  The effective mass at FIXED t = 1
    (no selection) is unbiased, so its jackknife error must cover: 68.3 % within 1 sigma.
    Window fixed in advance: [0.57, 0.79] (= 68 % +- 4 binomial sigma); 2 sigma: >= 0.90.
    Exploratory run (seed 555001): 0.647 within 1 sigma, 0.937 within 2 sigma, rms pull 1.04."""
    rule, fixed1, tstars, flags = _coverage_experiments(
        20261115, 300, 2000, [0.6], [[1.0], [0.7]], [30.0, -12.0], 0.5, 0.5, 20)
    c1 = float((np.abs(fixed1) < 1).mean())
    c2 = float((np.abs(fixed1) < 2).mean())
    print("fixed t=1: mean pull %+.3f, rms pull %.3f, within 1 sigma %.3f, within 2 sigma %.3f"
          % (fixed1.mean(), math.sqrt((fixed1 ** 2).mean()), c1, c2))
    assert np.all(np.isfinite(fixed1))
    assert 0.57 <= c1 <= 0.79
    assert c2 >= 0.90
    assert abs(fixed1.mean()) < 0.30
    assert 0.85 < math.sqrt((fixed1 ** 2).mean()) < 1.20


def test_coverage_of_plateau_rule():
    """300 independent synthetic experiments of the two-state scenario (m1 = 0.5, m2 = 1.3,
    3 operators, white noise, vev, MC autocorrelation rho = 0.5, N = 2000, bins of 20) through
    the WHOLE pipeline including the pre-registered plateau rule R5.

    Because t* is selected with the same data (sequential test), the coverage of the quoted
    jackknife error is expected to be somewhat BELOW 68 %.  Exploratory runs with other seeds
    gave: two-state scenario 0.627 within 1 sigma / 0.953 within 2 sigma, rms pull 1.12, mean
    pull +0.09; single-state scenario 0.550 / 0.904, rms pull 1.18; a harder two-state scenario
    (m1 = 0.8, m2 = 1.4) 0.633 / 0.924, rms pull 1.09.
    Loose window fixed in advance: 1 sigma coverage in [0.50, 0.85], 2 sigma coverage >= 0.85,
    |mean pull| < 0.4, rms pull < 1.4, plateau found in >= 90 % of the experiments.
    The measured numbers are printed (pytest -rP) and must be quoted with any mass obtained
    from rule R5."""
    rule, fixed1, tstars, flags = _coverage_experiments(
        20261116, 300, 2000, MASSES2, MIX2, VEV2, EPS2, 0.5, 20)
    c1 = float((np.abs(rule) < 1).mean())
    c2 = float((np.abs(rule) < 2).mean())
    rms = math.sqrt((rule ** 2).mean())
    print("plateau rule: plateau found in %d/300; t* histogram %s"
          % (rule.size, np.bincount(tstars).tolist()))
    print("plateau rule: mean pull %+.3f, rms pull %.3f, within 1 sigma %.3f, within 2 sigma %.3f"
          % (rule.mean(), rms, c1, c2))
    print("same data, fixed t=1: within 1 sigma %.3f, rms pull %.3f"
          % ((np.abs(fixed1) < 1).mean(), math.sqrt((fixed1 ** 2).mean())))
    assert rule.size >= 270
    assert 0.50 <= c1 <= 0.85
    assert c2 >= 0.85
    assert abs(rule.mean()) < 0.4
    assert rms < 1.4
