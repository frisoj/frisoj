"""Tests of the measurement layer (ym/observables.py), of the production driver
(run_production.py) and, end to end, of the whole string-tension pipeline against the EXACT
solution of two-dimensional lattice Yang-Mills theory.

Run from the project directory:

    python3 -m pytest -q tests/test_observables.py          # about 1 minute
    python3 -m pytest -q tests/test_observables.py -rP      # ... and print the measured numbers

Rules followed in this file
---------------------------
* Seeds, run lengths, tolerances and acceptance criteria were fixed BEFORE the tests were first
  run (run lengths from one exploratory D=2 run with ANOTHER seed, 11: 40000 measurements gave
  E = 0.7993(64) against the exact 0.79747).
* Statistical comparisons are |MC - exact| < 4 sigma TOGETHER with a precision requirement on
  sigma, so that a test cannot pass merely because its error bar is large.
* The deterministic checks compare the numba kernels with an independent implementation that
  uses explicit complex 2x2 matrices and numpy.roll (no shared code with the kernels).
* Changes made after the first run (no seed, tolerance or statistical criterion was changed):
  (1) test_killed_run_leaves_usable_resumable_file first required a progress line in the output
      of a process that was killed 0.3 s after its start while progress lines came every 0.5 s
      (an error of the test); it now uses --progress 0.1, waits 0.5 s after the first
      checkpoint before sending the signal, and always checks that the file can be resumed.
  (2) test_smearing_is_lattice_diffusion_of_the_flux was added after the D=3 pilot run showed
      that 1x1 loops of links smeared with weight w = 0.5 have a very poor overlap; the test
      pins down the cause (w = 0.5 is the stability limit of APE smearing: the staggered mode
      is not damped).
  (3) integration round: test_fixed_t_values_caveats_and_stream_consistency was added
      together with the corresponding (purely additive) output of analyze.py; it contains
      deterministic consistency checks only.
* These tests validate a measurement and analysis code.  The D=2 results are exact checks of
  the pipeline; nothing here is a proof of anything about continuum Yang-Mills theory.
"""
import json
import math
import os
import signal
import subprocess
import sys
import time

import numpy as np
import pytest

import analyze as analyze_mod
import run_production as rp
from ym import exact, stats
from ym.lattice import Lattice, get_rng_state, q_to_matrix
from ym.observables import DEFAULT_LOOPS, Measurer, measure, smear_spatial

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOOPS3 = ((1, 1), (2, 2), (1, 2))


# ==============================================================================================
# independent reference implementation with explicit 2x2 matrices
# ==============================================================================================
def as_matrices(U, shape):
    """Links as complex matrices, array of shape  lattice shape + (D, 2, 2)."""
    return q_to_matrix(U).reshape(tuple(shape) + (len(shape), 2, 2))


def dag(M):
    return np.conj(np.swapaxes(M, -1, -2))


def at(F, mu, n=1):
    """F(x + n mu) for a field F indexed by the lattice coordinates (leading axes)."""
    return np.roll(F, -n, axis=mu)


def ape_step_matrices(M, w):
    D = M.shape[-3]
    out = M.copy()
    for mu in range(1, D):
        Umu = M[..., mu, :, :]
        acc = Umu.copy()
        for nu in range(1, D):
            if nu == mu:
                continue
            Unu = M[..., nu, :, :]
            fwd = Unu @ at(Umu, nu) @ dag(at(Unu, mu))
            bwd = dag(Unu) @ Umu @ at(Unu, mu)             # this is the staple of x + nu
            acc = acc + w * (fwd + np.roll(bwd, 1, axis=nu))
        det = acc[..., 0, 0] * acc[..., 1, 1] - acc[..., 0, 1] * acc[..., 1, 0]
        out[..., mu, :, :] = acc / np.sqrt(det.real)[..., None, None]
    return out


def line_matrices(M, mu, n):
    L = M[..., mu, :, :]
    out = L
    for k in range(1, n):
        out = out @ at(L, mu, k)
    return out


def loop_slices_matrices(M, R, S, mu, nu):
    """sum over the spatial sites of each time slice of (1/2) Re Tr W(R along mu, S along nu)."""
    D = M.shape[-3]
    lr = line_matrices(M, mu, R)
    ls = line_matrices(M, nu, S)
    W = lr @ at(ls, mu, R) @ dag(at(lr, nu, S)) @ dag(ls)
    tr = 0.5 * np.trace(W, axis1=-2, axis2=-1).real
    return tr.sum(axis=tuple(range(1, D)))


def glue_reference(M, loops):
    D = M.shape[-3]
    T = M.shape[0]
    out = np.zeros((len(loops), T))
    for l, (R, S) in enumerate(loops):
        for mu in range(1, D - 1):
            for nu in range(mu + 1, D):
                out[l] += loop_slices_matrices(M, R, S, mu, nu)
                if R != S:
                    out[l] += loop_slices_matrices(M, S, R, mu, nu)
    return out


def torelon_reference(M):
    D = M.shape[-3]
    T = M.shape[0]
    out = np.zeros((D - 1, T))
    for mu in range(1, D):
        P = line_matrices(M, mu, M.shape[mu])
        tr = 0.5 * np.trace(P, axis1=-2, axis2=-1).real
        tr0 = np.take(tr, 0, axis=mu)                      # lines starting at x_mu = 0
        out[mu - 1] = tr0.reshape(T, -1).sum(axis=1)
    return out


def thermal_lattice(shape, beta, seed, n=6):
    lat = Lattice(shape, beta, seed=seed)
    lat.hot_start()
    lat.update(n, 1)
    return lat


CASES = [((6, 4), 3.0, 41), ((4, 6, 4), 5.0, 42), ((4, 4, 6, 4), 2.3, 43)]


# ==============================================================================================
# deterministic checks of the operators
# ==============================================================================================
@pytest.mark.parametrize("shape", [(4, 6), (6, 4, 8), (4, 4, 6, 6)])
def test_cold_configuration_gives_trivial_values(shape):
    lat = Lattice(shape, 2.0, seed=1)
    r = measure(lat, (0, 1, 4), 0.5, LOOPS3)
    D = len(shape)
    T = shape[0]
    Vs = lat.V // T
    n_planes = (D - 1) * (D - 2) // 2
    assert r["glue"].shape == (3, 3, T) and r["torelon"].shape == (D - 1, 3, T)
    # every loop has (1/2) Tr = 1; non-square loops are summed over both orientations
    np.testing.assert_allclose(r["glue"][:, 0], Vs * n_planes, atol=1e-10)
    np.testing.assert_allclose(r["glue"][:, 1], Vs * n_planes, atol=1e-10)
    np.testing.assert_allclose(r["glue"][:, 2], 2 * Vs * n_planes, atol=1e-10)
    for i in range(D - 1):
        np.testing.assert_allclose(r["torelon"][i], Vs / shape[i + 1], atol=1e-10)
    assert r["plaq"] == pytest.approx(1.0, abs=1e-14)
    assert r["plaq_t"] == pytest.approx(1.0, abs=1e-14)
    np.testing.assert_allclose(r["plaq_t_slices"], Vs * (D - 1), atol=1e-10)
    np.testing.assert_allclose(r["plaq_s_slices"], Vs * n_planes, atol=1e-10)
    if D == 2:
        assert math.isnan(r["plaq_s"])
    else:
        assert r["plaq_s"] == pytest.approx(1.0, abs=1e-14)


@pytest.mark.parametrize("shape,beta,seed", CASES)
def test_gauge_invariance_and_field_untouched(shape, beta, seed):
    lat = thermal_lattice(shape, beta, seed)
    levels = (0, 1, 2, 5)
    U0 = lat.U.copy()
    rng0 = get_rng_state()
    r1 = measure(lat, levels, 0.5, LOOPS3)
    assert np.array_equal(lat.U, U0), "measure() modified the gauge field"
    assert get_rng_state() == rng0, "measure() consumed random numbers"
    lat.random_gauge()
    assert np.max(np.abs(lat.U - U0)) > 0.1               # the field really changed
    r2 = measure(lat, levels, 0.5, LOOPS3)
    worst = 0.0
    for key in ("glue", "torelon", "plaq_t_slices", "plaq_s_slices", "plaq", "plaq_t"):
        d = float(np.max(np.abs(np.asarray(r1[key]) - np.asarray(r2[key]))))
        worst = max(worst, d)
        assert d < 1e-10, "%s changed by %g under a gauge transformation" % (key, d)
    if len(shape) > 2:
        assert abs(r1["plaq_s"] - r2["plaq_s"]) < 1e-12
        # the operators are non-trivial (not accidentally constant)
        assert np.std(r1["glue"][0, 0]) > 1e-3 and np.std(r1["torelon"][0, 1]) > 1e-3
    print("shape %s: largest change under a random gauge transformation %.2e" % (shape, worst))


@pytest.mark.parametrize("shape,beta,seed", CASES)
def test_smearing_properties(shape, beta, seed):
    lat = thermal_lattice(shape, beta, seed)
    U0 = lat.U.copy()
    Us = smear_spatial(lat, 0.5, 7)
    assert np.array_equal(lat.U, U0)
    assert Us is not lat.U and Us.shape == lat.U.shape
    assert np.array_equal(Us[:, 0], lat.U[:, 0]), "time-like links were modified"
    assert np.max(np.abs(np.sum(Us * Us, axis=-1) - 1.0)) < 1e-14
    if len(shape) == 2:
        assert np.array_equal(Us, lat.U)                  # no spatial staples in D = 2
    else:
        assert np.max(np.abs(Us[:, 1:] - lat.U[:, 1:])) > 0.05
        # smearing increases the spatial plaquette (it smooths the field)
        cp = lat.copy()
        cp.U[...] = Us
        ps0 = lat.plaquette_planes()[len(shape) - 1:].mean()
        ps1 = cp.plaquette_planes()[len(shape) - 1:].mean()
        assert ps1 > ps0 + 0.05
    assert np.array_equal(smear_spatial(lat, 0.5, 0), lat.U)
    # w = 0 is the identity up to rounding
    assert np.max(np.abs(smear_spatial(lat, 0.0, 3) - lat.U)) < 1e-15


@pytest.mark.parametrize("shape", [(2, 8, 6), (2, 4, 6, 4)])
@pytest.mark.parametrize("w", [0.5, 0.25, 1.0 / 6.0])
def test_smearing_is_lattice_diffusion_of_the_flux(w, shape):
    """Weak Abelian field (links exp(i theta sigma_3), theta ~ 1e-5) in D = 3 and D = 4: one
    APE step acts on every spatial plaquette angle F_ij as  F' = F + alpha * Laplacian(F)
    (spatial lattice Laplacian of the time slice),  alpha = w / (1 + 2 (D-2) w).
    Consequence checked explicitly: the maximally staggered mode k = (pi, .., pi) is multiplied
    by 1 - 4 (D-1) alpha, which is exactly -1 for w = 1/2 in D = 3 and in D = 4 (NOT damped)."""
    D = len(shape)
    lat = Lattice(shape, 1.0, seed=1)
    rng = np.random.default_rng(606)
    theta = 1e-5 * rng.standard_normal((lat.V, D))
    lat.U[...] = 0.0
    lat.U[..., 0] = np.cos(theta)
    lat.U[..., 3] = np.sin(theta)

    def flux(U, i, j):
        th = np.arctan2(U[..., 3], U[..., 0]).reshape(shape + (D,))
        ai, aj = th[..., i], th[..., j]
        return ai + np.roll(aj, -1, axis=i) - np.roll(ai, -1, axis=j) - aj

    Us = smear_spatial(lat, w, 1)
    assert np.max(np.abs(Us[:, :, 1:3])) == 0.0               # stays Abelian
    alpha = w / (1.0 + 2.0 * (D - 2) * w)
    coords = np.indices(shape)
    stag = (-1.0) ** coords[1:].sum(axis=0)
    for i in range(1, D - 1):
        for j in range(i + 1, D):
            f0 = flux(lat.U, i, j)
            f1 = flux(Us, i, j)
            lap = -2.0 * (D - 1) * f0
            for ax in range(1, D):
                lap = lap + np.roll(f0, 1, axis=ax) + np.roll(f0, -1, axis=ax)
            assert np.max(np.abs(f1 - (f0 + alpha * lap))) < 1e-13    # fluxes are O(1e-5)
            s0 = (f0 * stag).sum(axis=tuple(range(1, D)))
            s1 = (f1 * stag).sum(axis=tuple(range(1, D)))
            assert np.all(np.abs(s0) > 1e-7)
            np.testing.assert_allclose(s1, (1.0 - 4.0 * (D - 1) * alpha) * s0, atol=1e-13)
    print("D = %d, w = %.4f: alpha = %.4f, staggered flux mode multiplied by %+.4f per step"
          % (D, w, alpha, 1.0 - 4.0 * (D - 1) * alpha))


@pytest.mark.parametrize("shape,beta,seed", CASES[1:])
def test_smearing_matches_explicit_matrix_implementation(shape, beta, seed):
    lat = thermal_lattice(shape, beta, seed)
    M = as_matrices(lat.U, shape)
    for w in (0.3, 0.5):
        Mk = M
        for n in (1, 2, 3):
            Mk = ape_step_matrices(Mk, w)
            got = as_matrices(smear_spatial(lat, w, n), shape)
            assert np.max(np.abs(got - Mk)) < 1e-12, "APE step %d (w=%g) differs" % (n, w)
    # the reference implementation is itself unitary with unit determinant
    det = Mk[..., 0, 0] * Mk[..., 1, 1] - Mk[..., 0, 1] * Mk[..., 1, 0]
    assert np.max(np.abs(det - 1.0)) < 1e-12


@pytest.mark.parametrize("shape,beta,seed", CASES)
def test_operators_match_explicit_matrix_implementation(shape, beta, seed):
    lat = thermal_lattice(shape, beta, seed)
    levels = (0, 2, 3)
    w = 0.4
    r = measure(lat, levels, w, LOOPS3)
    D = len(shape)
    worst = 0.0
    for k, lev in enumerate(levels):
        M = as_matrices(lat.U, shape)
        for _ in range(lev):
            M = ape_step_matrices(M, w)
        if D > 2:
            ref = glue_reference(M, LOOPS3)
            worst = max(worst, float(np.max(np.abs(r["glue"][k] - ref))))
            np.testing.assert_allclose(r["glue"][k], ref, atol=1e-10)
        else:
            assert np.all(r["glue"] == 0.0)
        tref = torelon_reference(M)
        worst = max(worst, float(np.max(np.abs(r["torelon"][:, k] - tref))))
        np.testing.assert_allclose(r["torelon"][:, k], tref, atol=1e-10)
    # unsmeared level against the engine's own observables
    if D > 2:
        tot = 0.0
        for mu in range(1, D - 1):
            for nu in range(mu + 1, D):
                tot += lat.V * lat.wilson_loop(2, 2, mu, nu)
        assert abs(r["glue"][0, 1].sum() - tot) < 1e-9
    for i in range(D - 1):
        pl = lat.polyakov_loops(i + 1)                    # lattice shape without axis i+1
        assert np.max(np.abs(r["torelon"][i, 0] - pl.reshape(shape[0], -1).sum(axis=1))) < 1e-10
    print("shape %s: largest deviation kernel vs matrices %.2e" % (shape, worst))


@pytest.mark.parametrize("shape,beta,seed", CASES)
def test_plaquette_outputs_match_engine(shape, beta, seed):
    lat = thermal_lattice(shape, beta, seed)
    r = measure(lat, (0,), 0.5)
    D = len(shape)
    pp = lat.plaquette_planes()                           # planes (0,1), (0,2), ..., then spatial
    assert r["plaq"] == pytest.approx(lat.plaquette(), abs=1e-13)
    assert r["plaq_t"] == pytest.approx(pp[:D - 1].mean(), abs=1e-13)
    assert r["plaq_t_slices"].sum() == pytest.approx(pp[:D - 1].sum() * lat.V, abs=1e-9)
    if D > 2:
        assert r["plaq_s"] == pytest.approx(pp[D - 1:].mean(), abs=1e-13)
        assert r["plaq_s_slices"].sum() == pytest.approx(pp[D - 1:].sum() * lat.V, abs=1e-9)
        # the unsmeared 1x1 glueball operator IS the spatial plaquette slice sum
        np.testing.assert_allclose(r["glue"][0, 0], r["plaq_s_slices"], atol=1e-10)
    else:
        assert np.all(r["plaq_s_slices"] == 0.0)
    # per-slice temporal plaquettes against the matrix implementation
    M = as_matrices(lat.U, shape)
    ref = np.zeros(shape[0])
    for i in range(1, D):
        ref += loop_slices_matrices(M, 1, 1, 0, i)
    np.testing.assert_allclose(r["plaq_t_slices"], ref, atol=1e-10)


@pytest.mark.parametrize("shape,beta,seed", CASES)
def test_translation_covariance(shape, beta, seed):
    """A time translation shifts the time-slice operators; a spatial translation leaves them
    unchanged (zero momentum projection)."""
    lat = thermal_lattice(shape, beta, seed)
    D = len(shape)
    r0 = measure(lat, (0, 2), 0.5)
    field = lat.U.reshape(tuple(shape) + (D, 4))
    lt = lat.copy()
    lt.U[...] = np.roll(field, 1, axis=0).reshape(lat.U.shape)      # U'(t) = U(t - 1)
    rt = measure(lt, (0, 2), 0.5)
    for key in ("glue", "torelon", "plaq_t_slices", "plaq_s_slices"):
        np.testing.assert_allclose(rt[key], np.roll(r0[key], 1, axis=-1), atol=1e-10)
    ls = lat.copy()
    ls.U[...] = np.roll(field, 1, axis=D - 1).reshape(lat.U.shape)  # shift along the last axis
    rs = measure(ls, (0, 2), 0.5)
    for key in ("glue", "torelon", "plaq_t_slices", "plaq_s_slices"):
        np.testing.assert_allclose(rs[key], r0[key], atol=1e-10)


def test_measure_argument_validation():
    lat = Lattice((4, 4, 4), 5.0, seed=1)
    for bad in ((2, 1), (-1, 2), (1, 1), ()):
        with pytest.raises(ValueError):
            measure(lat, bad, 0.5)
    with pytest.raises(ValueError):
        measure(lat, (1,), 0.5, loops=((4, 4),))          # does not fit into L = 4
    with pytest.raises(ValueError):
        measure(lat, (1,), 0.5, loops=((0, 1),))
    m = Measurer((4, 4, 4), (0, 2), 0.5)
    assert m.glue_labels() == ["s0_1x1", "s0_2x2", "s2_1x1", "s2_2x2"]
    assert m.torelon_labels() == ["s0", "s2"]
    with pytest.raises(ValueError):
        m(Lattice((4, 4, 6), 5.0, seed=1))
    assert DEFAULT_LOOPS == ((1, 1), (2, 2))


# ==============================================================================================
# production driver
# ==============================================================================================
def make_args(tmp_path, name, extra=()):
    argv = ["--shape", "4,4,4", "--beta", "5.0", "--ntherm", "5", "--nmeas", "12", "--nhb", "1",
            "--nor", "2", "--levels", "0,2", "--w", "0.5", "--seed", "77",
            "--out", str(tmp_path / name)] + list(extra)
    return rp.build_parser().parse_args(argv)


class _Sink:
    def write(self, s):
        pass

    def flush(self):
        pass


def test_production_file_contents(tmp_path):
    args = make_args(tmp_path, "a.npz")
    assert rp.Run(args).run(out=_Sink()) == 0
    meta, arr = rp.load_raw(args.out)
    assert meta["format"] == "ym-raw-1" and meta["complete"] and meta["nmeas_done"] == 12
    assert meta["shape"] == [4, 4, 4] and meta["beta"] == 5.0 and meta["seed"] == 77
    assert meta["levels"] == [0, 2] and meta["w"] == 0.5 and meta["loops"] == [[1, 1], [2, 2]]
    assert meta["glue_ops"] == ["s0_1x1", "s0_2x2", "s2_1x1", "s2_2x2"]
    assert meta["sweeps_per_measurement"] == {"heatbath": 1, "overrelax": 2}
    for key in ("python", "numpy", "numba", "scipy"):
        assert key in meta["versions"]
    assert meta["wall_clock_s"] > 0 and meta["unitarity_violation"] < 1e-13
    assert arr["glue"].shape == (12, 4, 4) and arr["glue"].dtype == np.float64
    assert arr["torelon"].shape == (12, 2, 2, 4) and arr["torelon"].dtype == np.float64
    assert arr["plaq"].shape == (12,) and arr["plaq_t_slices"].shape == (12, 4)
    assert arr["state_U"].shape == (64, 3, 4) and int(arr["state_n"]) == 12
    # the stored numbers are what measure() gives on the stored final configuration
    lat = Lattice((4, 4, 4), 5.0, seed=0)
    lat.U[...] = arr["state_U"]
    r = measure(lat, (0, 2), 0.5)
    np.testing.assert_array_equal(arr["glue"][-1], r["glue"].reshape(4, 4))
    np.testing.assert_array_equal(arr["torelon"][-1], r["torelon"])
    assert arr["plaq"][-1] == r["plaq"]
    # an existing file is never overwritten silently
    with pytest.raises(SystemExit):
        rp.Run(make_args(tmp_path, "a.npz"))
    # --no-state omits the resume information
    args2 = make_args(tmp_path, "b.npz", ["--no-state"])
    rp.Run(args2).run(out=_Sink())
    _, arr2 = rp.load_raw(args2.out)
    assert "state_U" not in arr2
    np.testing.assert_array_equal(arr2["glue"], arr["glue"])     # same seed, same data


def test_resume_is_bit_identical(tmp_path):
    """A run interrupted after EVERY single step (--maxtime 0 stops after one thermalisation
    update or one measurement) and resumed each time reproduces the uninterrupted run exactly."""
    ref_args = make_args(tmp_path, "ref.npz")
    rp.Run(ref_args).run(out=_Sink())
    _, ref = rp.load_raw(ref_args.out)
    n_inv = 0
    while True:
        args = make_args(tmp_path, "chunked.npz", ["--maxtime", "0", "--resume"])
        rp.Run(args).run(out=_Sink())
        n_inv += 1
        meta, arr = rp.load_raw(args.out)
        assert meta["n_invocations"] == n_inv
        if meta["complete"]:
            break
        assert meta["stop_reason"] == "maxtime"
        assert n_inv < 40
    assert n_inv == 5 + 12                                 # one step per invocation
    for key in ("glue", "torelon", "plaq", "plaq_s", "plaq_t", "plaq_t_slices", "plaq_s_slices",
                "state_U", "state_rng_keys", "state_rng_index"):
        np.testing.assert_array_equal(arr[key], ref[key], err_msg=key)
    # resuming a complete file does nothing; changing a chain parameter is refused
    rp.Run(make_args(tmp_path, "chunked.npz", ["--resume"])).run(out=_Sink())
    _, again = rp.load_raw(args.out)
    np.testing.assert_array_equal(again["glue"], ref["glue"])
    bad = rp.build_parser().parse_args(
        ["--shape", "4,4,4", "--beta", "5.5", "--ntherm", "5", "--nmeas", "12", "--nhb", "1",
         "--nor", "2", "--levels", "0,2", "--seed", "77", "--out", str(tmp_path / "chunked.npz"),
         "--resume"])
    with pytest.raises(SystemExit):
        rp.Run(bad)


def _wait_for(predicate, timeout):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if predicate():
            return True
        time.sleep(0.2)
    return False


def _stored_n(path):
    try:
        with np.load(path, allow_pickle=False) as z:
            return int(json.loads(str(z["meta"]))["nmeas_done"])
    except Exception:
        return -1


@pytest.mark.parametrize("sig", [signal.SIGKILL, signal.SIGTERM])
def test_killed_run_leaves_usable_resumable_file(tmp_path, sig):
    """Start a long run as a separate process with frequent checkpoints and kill it.
    SIGKILL: the last checkpoint must be a complete, loadable file.  SIGTERM: the run must
    stop gracefully and save.  In both cases the stored measurements must equal the first
    measurements of an uninterrupted run and the file must be resumable."""
    out = tmp_path / "killed.npz"
    cmd = [sys.executable, os.path.join(ROOT, "run_production.py"), "--shape", "4,4,4",
           "--beta", "5.0", "--ntherm", "5", "--nmeas", "2000000", "--nhb", "1", "--nor", "2",
           "--levels", "0,2", "--seed", "77", "--out", str(out), "--checkpoint", "0.3",
           "--progress", "0.1"]
    env = dict(os.environ, NUMBA_NUM_THREADS="1", OMP_NUM_THREADS="1")
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env,
                            cwd=ROOT)
    try:
        assert _wait_for(lambda: _stored_n(out) >= 50, 150), "no checkpoint appeared"
        time.sleep(0.5)                 # let it run on: the kill then hits mid-run
        proc.send_signal(sig)
        stdout, _ = proc.communicate(timeout=60)
    finally:
        if proc.poll() is None:
            proc.kill()
    text = stdout.decode()
    assert "[progress]" in text
    if sig == signal.SIGTERM:
        assert proc.returncode == 0 and "INCOMPLETE" in text
    meta, arr = rp.load_raw(str(out))
    n = meta["nmeas_done"]
    assert n >= 50 and not meta["complete"]
    assert arr["glue"].shape[0] == n == int(arr["state_n"]) == arr["plaq"].shape[0]
    if sig == signal.SIGTERM:
        assert meta["stop_reason"] == "signal %d" % signal.SIGTERM
    leftovers = [f for f in os.listdir(tmp_path) if ".tmp." in f]
    if sig == signal.SIGTERM:
        assert leftovers == []
    # reference: the same chain, uninterrupted, 25 measurements further
    ref_args = rp.build_parser().parse_args(
        ["--shape", "4,4,4", "--beta", "5.0", "--ntherm", "5", "--nmeas", str(n + 25),
         "--nhb", "1", "--nor", "2", "--levels", "0,2", "--seed", "77",
         "--out", str(tmp_path / "ref.npz")])
    rp.Run(ref_args).run(out=_Sink())
    _, ref = rp.load_raw(ref_args.out)
    np.testing.assert_array_equal(arr["glue"], ref["glue"][:n])
    np.testing.assert_array_equal(arr["torelon"], ref["torelon"][:n])
    np.testing.assert_array_equal(arr["plaq"], ref["plaq"][:n])
    # the killed file is resumable and continues the same chain bit for bit
    res_args = rp.build_parser().parse_args(
        ["--shape", "4,4,4", "--beta", "5.0", "--ntherm", "5", "--nmeas", str(n + 25),
         "--nhb", "1", "--nor", "2", "--levels", "0,2", "--seed", "77",
         "--out", str(out), "--resume"])
    rp.Run(res_args).run(out=_Sink())
    meta2, cont = rp.load_raw(str(out))
    assert meta2["complete"] and meta2["n_invocations"] == 2
    np.testing.assert_array_equal(cont["glue"], ref["glue"])
    np.testing.assert_array_equal(cont["torelon"], ref["torelon"])
    np.testing.assert_array_equal(cont["state_U"], ref["state_U"])
    print("signal %d: file with %d measurements, loadable, consistent and resumable" % (sig, n))


# ==============================================================================================
# EXACT end-to-end checks in D = 2
# ==============================================================================================
D2_T, D2_L, D2_BETA = 16, 4, 8.0
D2_NMEAS = 100000


@pytest.fixture(scope="module")
def d2_result(tmp_path_factory):
    """One production run on the (T=16, L=4) lattice at beta = 8 followed by the standard
    analysis (run_production.py -> analyze.py), exactly as for production ensembles."""
    d = tmp_path_factory.mktemp("d2")
    raw = d / "d2_b8.0_T16_L4_s20261111.npz"
    args = rp.build_parser().parse_args(
        ["--shape", "%d,%d" % (D2_T, D2_L), "--beta", str(D2_BETA), "--ntherm", "500",
         "--nmeas", str(D2_NMEAS), "--nhb", "1", "--nor", "1", "--levels", "0,2",
         "--seed", "20261111", "--out", str(raw)])
    rp.Run(args).run(out=_Sink())
    res = analyze_mod.analyze([str(raw)], outdir=str(d), quiet=True)
    with open(d / "d2_b8.0_T16_L4.json") as f:
        on_disk = json.load(f)
    assert on_disk["torelon"]["aE"] == res["torelon"]["aE"]
    for p in res["plots"]:
        assert os.path.getsize(d / p) > 5000
    return res


def test_d2_torelon_energy_and_string_tension_exact(d2_result):
    """E = L * (-ln u(beta)) exactly in D = 2; the whole pipeline (operators, correlator, GEVP,
    cosh effective mass, plateau rule, jackknife) must reproduce it."""
    res = d2_result
    u = exact.u(D2_BETA)
    e_exact = -D2_L * math.log(u)
    assert abs(e_exact - exact.torelon_energy_2d(D2_BETA, D2_L)) < 1e-14
    tor = res["torelon"]
    print("exact E = %.6f, sigma = %.6f, a sqrt(sigma) = %.6f"
          % (e_exact, e_exact / D2_L, math.sqrt(e_exact / D2_L)))
    print("pipeline: E = %.5f +- %.5f  [%s, t* = %s], pull %+.2f, sigma(E)/E = %.2f %%"
          % (tor["aE"], tor["aE_err"], tor["flag"], tor["t_star"],
             (tor["aE"] - e_exact) / tor["aE_err"], 100 * tor["aE_err"] / tor["aE"]))
    for row in tor["meff_t0_5"]:
        print("  t=%d  m_eff = %.5f +- %.5f  pull %+.2f"
              % (row["t"], row["m_cosh"], row["err_cosh"],
                 (row["m_cosh"] - e_exact) / row["err_cosh"]))
    assert res["D"] == 2 and res["glueball"] is None
    assert res["n_meas_total"] == D2_NMEAS
    assert tor["flag"] == "plateau" and tor["t_star"] >= 1 and tor["L"] == D2_L
    assert tor["aE_err"] / tor["aE"] < 0.015                     # the test has teeth: 1.5 %
    assert abs(tor["aE"] - e_exact) < 4.0 * tor["aE_err"]
    # in D = 2 there are no excited torelon states: every effective mass must agree, also
    # the very precise one at t = 0
    for t in range(3):
        row = tor["meff_table"][t]
        assert abs(row["m_cosh"] - e_exact) < 4.0 * row["err_cosh"]
    assert tor["meff_table"][0]["err_cosh"] / e_exact < 0.005    # 0.5 % at t = 0
    # all smearing levels are identical in D = 2: the operator selection must keep exactly one
    assert len(tor["gevp"]["selected"]) == 1
    assert abs(tor["overlap"] - 1.0) < 0.05
    # string tension: both formulas reduce to sigma = E / L
    st = res["string_tension"]
    for key in ("luscher", "nambu_goto"):
        assert st[key]["sigma_a2"] == pytest.approx(tor["aE"] / D2_L, rel=1e-12)
        assert abs(st[key]["sigma_a2"] - (-math.log(u))) < 4.0 * st[key]["sigma_a2_err"]
        assert st[key]["a_sqrt_sigma_err"] / st[key]["a_sqrt_sigma"] < 0.008
    assert res["D2"]["sigma_exact"] == pytest.approx(-math.log(u), rel=1e-12)
    # cross-check fit
    fit = tor["cosh_fit"]
    assert fit["ok"] and abs(fit["m"] - e_exact) < 4.0 * fit["err"]
    # centre symmetry: <Phi> = 0
    for v in tor["vev_check"]:
        assert abs(v["mean"]) < 4.0 * v["err"]


def test_d2_torelon_correlator_exact(d2_result):
    """C(tau) = (1/4) (u^(L tau) + u^(L (T - tau))) (plus exponentially small terms, included
    in the exact torus formula)."""
    res = d2_result
    rows = res["D2"]["torelon_correlator"]
    u = exact.u(D2_BETA)
    pulls = []
    for row in rows:
        tau = row["tau"]
        lead = 0.25 * (u ** (D2_L * tau) + u ** (D2_L * (D2_T - tau)))
        assert abs(row["exact"] - lead) < 1e-6           # torus corrections are tiny here
        pulls.append(row["pull"])
        print("  tau=%d  C = %.6f +- %.6f   exact %.6f   pull %+.2f"
              % (tau, row["C"], row["err"], row["exact"], row["pull"]))
        assert abs(row["pull"]) < 4.0
    for tau in range(4):                                  # precision: better than 3 % up to tau=3
        assert rows[tau]["err"] / rows[tau]["exact"] < 0.03
    assert rows[0]["err"] / rows[0]["exact"] < 0.004
    assert len(rows) == D2_T // 2 + 1
    print("rms pull over tau = 0..%d: %.2f" % (D2_T // 2, math.sqrt(np.mean(np.square(pulls)))))


def test_d2_plaquette_and_null_test(d2_result):
    """2D Yang-Mills has no propagating degrees of freedom: plaquettes are independent, so the
    connected correlator of time-slice plaquette sums vanishes for tau >= 1, while at tau = 0
    it equals L * Var(single plaquette) = L * [(1 + 3 I_3/I_1)/4 - u^2]."""
    res = d2_result
    d2 = res["D2"]
    nt = d2["plaquette_null_test"]
    c = np.array(nt["C"])
    e = np.array(nt["err"])
    c0_exact = nt["C0_exact_infinite_volume"]
    print("plaquette %.6f +- %.6f, exact %.6f (pull %+.2f), tau_int %.2f"
          % (res["plaquette"]["mean"], res["plaquette"]["err"], d2["plaquette_exact"],
             d2["plaquette_pull"], res["plaquette"]["tau_int"]))
    print("C(0) = %.6f +- %.6f, exact L*var = %.6f" % (c[0], e[0], c0_exact))
    for tau in range(1, c.size):
        print("  tau=%d  C/C(0) = %+.5f +- %.5f  pull %+.2f"
              % (tau, c[tau] / c[0], e[tau] / c[0], c[tau] / e[tau]))
    print("chi2 (tau >= 1, correlations ignored) = %.2f for %d points"
          % (nt["chi2_tau_ge_1"], nt["n_tau"]))
    # plaquette against the exact torus value
    assert res["plaquette"]["err"] < 1.5e-4
    assert abs(d2["plaquette_pull"]) < 4.0
    assert abs(d2["plaquette_exact"] - exact.u(D2_BETA)) < 1e-6
    # teeth: the tau = 0 point is measured to better than 2 % and agrees with the exact variance
    var1 = (1.0 + 3.0 * exact.lambda_j(D2_BETA, 2)) / 4.0 - exact.u(D2_BETA) ** 2
    assert c0_exact == pytest.approx(D2_L * var1, rel=1e-12)
    assert e[0] / c[0] < 0.02
    assert abs(c[0] - c0_exact) < 4.0 * e[0]
    # the null result: every tau >= 1 is zero within errors, with errors below 1 % of C(0)
    assert nt["n_tau"] == D2_T // 2
    assert np.all(e[1:] / c[0] < 0.01)
    assert nt["max_abs_pull"] < 4.0
    assert nt["chi2_tau_ge_1"] < 26.1                    # 99.9 % point of chi^2 with 8 dof


# ==============================================================================================
# the complete chain in D = 3 and D = 4 (schema / plumbing; tiny lattices, no physics claims)
# ==============================================================================================
CHANNEL_KEYS = {"mass", "err", "t_star", "flag", "plateau", "upper_bound_only", "t_value",
                "meff_table", "meff_t0_5", "plateau_checks", "gevp", "overlap", "operators",
                "cosh_fit", "n_bins", "binsize", "n_used", "n_dropped"}


@pytest.mark.parametrize("shape,beta,dkey", [((8, 6, 6), 4.0, "D3"), ((6, 4, 4, 4), 2.0, "D4")])
def test_full_chain_schema(tmp_path, shape, beta, dkey):
    files = []
    for seed in (5, 6):
        out = tmp_path / ("x_s%d.npz" % seed)
        args = rp.build_parser().parse_args(
            ["--shape", ",".join(map(str, shape)), "--beta", str(beta), "--ntherm", "50",
             "--nmeas", "600", "--nhb", "1", "--nor", "1", "--levels", "0,1,2", "--w", "0.5",
             "--seed", str(seed), "--out", str(out)])
        rp.Run(args).run(out=_Sink())
        files.append(str(out))
    res = analyze_mod.analyze(files, outdir=str(tmp_path), quiet=True)
    with open(tmp_path / "x.json") as f:
        text = f.read()
    assert "NaN" not in text and "Infinity" not in text      # strict JSON
    disk = json.loads(text)
    assert disk["ensemble"] == "x" and disk["D"] == len(shape) and disk["shape"] == list(shape)
    assert disk["n_meas_total"] == 1200 and len(disk["streams"]) == 2
    assert disk["n_meas_used"] + disk["n_discarded_total"] == 1200
    assert disk["n_bins"] == sum(s["n_used"] for s in disk["streams"]) // disk["binsize"]
    for key in ("plaquette", "glueball", "torelon", "torelon_all", "string_tension", "ratios",
                "binning_check", "plots", "warnings", "tau_int_table", "disclaimer", dkey):
        assert key in disk, key
    assert "not a proof" in disk["disclaimer"].lower()
    for blk in (disk["glueball"], disk["torelon"]):
        assert CHANNEL_KEYS <= set(blk)
        assert len(blk["meff_table"]) == shape[0] // 2
        assert len(blk["meff_t0_5"]) == min(6, shape[0] // 2)
        assert blk["flag"] in ("plateau", "no plateau", "no signal")
        assert blk["gevp"]["t0"] == 0 and blk["gevp"]["min_eig"] == 0.01
    assert disk["glueball"]["am"] == disk["glueball"]["mass"]
    assert disk["torelon"]["aE"] == disk["torelon"]["mass"]
    assert disk["torelon"]["n_directions"] == len(shape) - 1
    p = disk["plaquette"]
    assert 0 < p["mean"] < 1 and p["err"] > 0 and p["tau_int"] > 0
    assert p["spatial"]["mean"] > 0 and p["temporal"]["mean"] > 0
    if dkey == "D4":
        assert disk["D4"]["a_lambda_two_loop"] == pytest.approx(exact.a_lambda_two_loop(beta))
    for name in disk["plots"]:
        assert os.path.getsize(tmp_path / name) > 5000
    assert len(disk["plots"]) == 3
    # consistency of the derived numbers with the formulas of ym/stats.py
    st = disk["string_tension"]
    if st["luscher"] is not None:
        e = disk["torelon"]["aE"]
        L = disk["torelon"]["L"]
        assert st["luscher"]["sigma_a2"] == pytest.approx(stats.sigma_luscher(e, L, len(shape)))
        assert st["nambu_goto"]["sigma_a2"] == pytest.approx(
            stats.sigma_nambu_goto(e, L, len(shape)))
        r = disk["ratios"]["m_over_sqrt_sigma"]
        if r and r.get("luscher") and disk["glueball"]["am"] is not None:
            assert r["luscher"]["value"] == pytest.approx(
                disk["glueball"]["am"] / st["luscher"]["a_sqrt_sigma"])
    if dkey == "D3" and disk["D3"]["beta_am_over_4"]:
        assert disk["D3"]["beta_am_over_4"]["value"] == pytest.approx(
            beta * disk["glueball"]["am"] / 4.0)
    # the two streams are really different, and mixing ensembles / duplicating a stream fails
    with pytest.raises(ValueError):
        analyze_mod.analyze([files[0], files[0]], outdir=str(tmp_path), quiet=True)
    other = tmp_path / "y_s9.npz"
    args = rp.build_parser().parse_args(
        ["--shape", ",".join(map(str, shape)), "--beta", str(beta + 0.1), "--ntherm", "5",
         "--nmeas", "20", "--levels", "0,1,2", "--seed", "9", "--out", str(other)])
    rp.Run(args).run(out=_Sink())
    with pytest.raises(ValueError):
        analyze_mod.analyze([files[0], str(other)], outdir=str(tmp_path), quiet=True)
    # explicit discard is counted
    res2 = analyze_mod.analyze(files, outdir=str(tmp_path), name="x_disc", discard=100,
                               make_plots=False, quiet=True)
    assert res2["n_meas_total"] == 1200
    assert all(s["n_discarded"] == 100 for s in res2["streams"])
    assert res2["n_meas_used"] <= 1000


def test_fixed_t_values_caveats_and_stream_consistency(tmp_path):
    """Output added to analyze.py in the integration round (review findings: the error quoted
    with the mass selected by plateau rule R5 under-covers, so the fixed-t effective masses and
    the caveat must accompany every quoted number; hot-start and cold-start streams should be
    compared explicitly).  Deterministic consistency checks only:

    * 'fixed_t' of every channel repeats rows 1 and 2 of meff_table; the error of
      m_eff(1) - m_eff(2) is at most the sum of the two errors;
    * string_tension.fixed_t is the Luscher / Nambu-Goto formula applied to those energies;
    * the R5 numbers (mass, err, t_star, flag) do not depend on the new output: they equal
      a direct call of stats.analyze_channel on the raw arrays (to rounding);
    * 'caveats' names rule R5 and the summary prints the caveat;
    * stream_consistency: chi2 of the stream plaquettes (each stream with the error from
      its own tau_int), hot minus cold with its pull; a stream whose plaquette is shifted by
      hand (+0.01, tens of sigma) produces both warnings.
    """
    shape, beta = (8, 6, 6), 4.0
    files = []
    for seed, start in ((21, "hot"), (22, "cold"), (23, "hot")):
        out = tmp_path / ("c_s%d.npz" % seed)
        args = rp.build_parser().parse_args(
            ["--shape", ",".join(map(str, shape)), "--beta", str(beta), "--ntherm", "100",
             "--nmeas", "500", "--nhb", "1", "--nor", "1", "--levels", "0,1,2", "--w", "0.25",
             "--seed", str(seed), "--start", start, "--out", str(out)])
        rp.Run(args).run(out=_Sink())
        files.append(str(out))
    res = analyze_mod.analyze(files, outdir=str(tmp_path), make_plots=False, quiet=True)
    D, T, L = len(shape), shape[0], shape[1]
    for blk in (res["glueball"], res["torelon"]):
        ft = blk["fixed_t"]
        for t in (1, 2):
            row = blk["meff_table"][t]
            assert ft["t%d" % t] == {"m": row["m_cosh"], "err": row["err_cosh"]}
        d = ft["t1_minus_t2"]
        if d["value"] is not None:
            assert d["value"] == pytest.approx(ft["t1"]["m"] - ft["t2"]["m"], abs=1e-14)
            if d["err"] is not None and ft["t1"]["err"] is not None and ft["t2"]["err"] is not None:
                assert 0 < d["err"] <= ft["t1"]["err"] + ft["t2"]["err"] + 1e-12
    sft = res["string_tension"]["fixed_t"]
    assert [e["t"] for e in sft] == [1, 2]
    for e in sft:
        row = res["torelon"]["meff_table"][e["t"]]
        assert e["aE"] == row["m_cosh"] and e["aE_err"] == row["err_cosh"]
        if e["luscher"] is not None:
            assert e["luscher"]["a_sqrt_sigma"] == pytest.approx(
                math.sqrt(stats.sigma_luscher(e["aE"], L, D)), rel=1e-13)
            assert e["nambu_goto"]["a_sqrt_sigma"] == pytest.approx(
                math.sqrt(stats.sigma_nambu_goto(e["aE"], L, D)), rel=1e-13)
            assert e["luscher"]["a_sqrt_sigma_err"] > 0
    # rule R5 output is untouched by the additions
    raw = [rp.load_raw(f)[1] for f in files]
    B = res["binsize"]
    rg = stats.analyze_channel([a["glue"] for a in raw], T, B, subtract_vev=True)
    rt = stats.analyze_channel([a["torelon"] for a in raw], T, B, subtract_vev=False)
    for blk, r in ((res["glueball"], rg), (res["torelon"], rt)):
        assert blk["flag"] == r["plateau"]["flag"] and blk["t_star"] == r["plateau"]["t_star"]
        if math.isfinite(r["mass"]):
            # (1e-12: analyze.py passes the torelon array through a fancy index, which changes
            #  the memory layout and hence the last bits of the FFT sums)
            assert blk["mass"] == pytest.approx(r["mass"], rel=1e-12)
            assert blk["err"] == pytest.approx(r["err"], rel=1e-9)
        else:
            assert blk["mass"] is None
    # caveats
    assert len(res["caveats"]) >= 3 and any("R5" in c and "selection" in c for c in res["caveats"])
    assert any("upper" in c.lower() for c in res["caveats"])
    assert any("not a proof" in c.lower() for c in res["caveats"])
    text = analyze_mod.summary(res)
    assert "CAVEAT" in text and "not a proof" in text
    # stream consistency
    sc = res["stream_consistency"]
    assert sc["plaquette"]["n_streams"] == 3 and sc["plaquette"]["dof"] == 2
    hc = sc["hot_minus_cold"]
    assert hc["n_hot"] == 2 and hc["n_cold"] == 1 and hc["err"] > 0
    assert hc["pull"] == pytest.approx(hc["diff"] / hc["err"])
    each = [stats.mean_err_tau(a["plaq"]) for a in raw]         # hot, cold, hot
    for si, r in zip(res["streams"], each):
        assert si["plaquette_err"] == pytest.approx(r["err"], rel=1e-12)
    wh = [1.0 / each[0]["err"] ** 2, 1.0 / each[2]["err"] ** 2]
    mean_hot = (wh[0] * each[0]["mean"] + wh[1] * each[2]["mean"]) / (wh[0] + wh[1])
    assert hc["diff"] == pytest.approx(mean_hot - each[1]["mean"], abs=1e-13)
    assert hc["err"] == pytest.approx(math.hypot(1.0 / math.sqrt(wh[0] + wh[1]), each[1]["err"]),
                                      rel=1e-12)
    print("stream consistency: chi2 = %.2f / %d, hot - cold = %+.2e +- %.1e (%+.2f sigma)"
          % (sc["plaquette"]["chi2"], sc["plaquette"]["dof"], hc["diff"], hc["err"], hc["pull"]))
    assert not any("hot-start and cold-start" in w for w in res["warnings"])
    assert not any("inconsistent" in w for w in res["warnings"])
    # a stream whose plaquette is shifted (as an unthermalised or wrong-beta stream would be)
    with np.load(files[1], allow_pickle=False) as z:
        arrays = {k: z[k] for k in z.files}
    arrays["plaq"] = arrays["plaq"] + 0.01
    bad = str(tmp_path / "bad_s22.npz")
    np.savez(bad, **arrays)
    res2 = analyze_mod.analyze([files[0], bad, files[2]], name="bad", outdir=str(tmp_path),
                               make_plots=False, quiet=True)
    assert abs(res2["stream_consistency"]["hot_minus_cold"]["pull"]) > 4
    assert any("hot-start and cold-start" in w for w in res2["warnings"])
    assert any("inconsistent" in w for w in res2["warnings"])
