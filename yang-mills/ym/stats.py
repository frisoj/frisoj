"""Statistical analysis for the mass-gap measurements: binning, blocked jackknife, integrated
autocorrelation times, connected correlator matrices, the generalised eigenvalue problem (GEVP),
effective masses, the plateau rule, cosh fits and the string tension from the torelon energy.

==================================================================================================
PRE-REGISTERED ANALYSIS RULES
(fixed when this file was written, BEFORE any production data existed.  They must not be changed
after looking at production data.  If a rule turns out to be unsuitable, say so in the report and
show the numbers obtained with the rule as written.)
==================================================================================================

R1  Correlator matrix.  For operators O_k(t) on time slices t = 0 .. T-1 (periodic),

        C_kl(tau) = (1/T) sum_t < O_k(t) O_l(t + tau) >  -  < O_k > < O_l >,

    < O_k > = average over configurations AND time slices.  The vacuum subtraction is performed
    INSIDE the jackknife (every jackknife sample subtracts its own < O_k >).  For the torelon no
    subtraction is made (< Phi > = 0 by the Z_2 centre symmetry of the confined phase; the
    measured < Phi > is reported as a check).  C is symmetrised, C_kl(tau) -> (C_kl(tau) +
    C_lk(tau) + C_kl(T-tau) + C_lk(T-tau)) / 4, and kept for tau = 0 .. T/2.

R2  Operator subset (near-degenerate operators are dropped).  With the full-sample correlator,
    define the normalised matrix  Chat_kl(tau) = C_kl(tau) / sqrt(C_kk(t0) C_ll(t0)).
      (a) operators with C_kk(t0) <= 0 or C_kk(t0+1) <= 0 are discarded;
      (b) the remaining operators are ranked by q_k = C_kk(t0+1) / C_kk(t0), largest first
          (ties: lower index first);
      (c) going through that list, an operator is ACCEPTED if, together with the operators
          accepted so far, the smallest eigenvalue of Chat(t0) restricted to that set is
          >= MIN_EIG = 0.01; otherwise it is dropped.
    The best single operator is therefore always kept.  The subset is chosen once from the
    full sample and then used unchanged in every jackknife sample.

R3  GEVP.  t0 = 0:  Chat(t0+1) v = lambda Chat(t0) v on the subset; the ground state is the
    eigenvector with the LARGEST lambda, normalised to v^T Chat(t0) v = 1.  The projected
    correlator is C_proj(t) = v^T Chat(t) v.  The GEVP is re-solved in every jackknife sample.

R4  Effective mass.  m_eff(t) is the solution m > 0 of

        C_proj(t) / C_proj(t+1) = cosh(m (t - T/2)) / cosh(m (t+1 - T/2)),   t = 0 .. T/2 - 1,

    (undefined = NaN if C_proj(t) <= 0, C_proj(t+1) <= 0 or C_proj(t) <= C_proj(t+1)).  The
    log-ratio ln(C_proj(t)/C_proj(t+1)) is reported alongside.  The error of m_eff(t) is the
    jackknife error; if m_eff(t) is undefined in ANY jackknife sample the error is infinite.

R5  PLATEAU RULE.  The mass estimate is m_eff(t*) of the GEVP-projected correlator
    (cosh-corrected), where t* is the SMALLEST t >= 1 such that
      (i)  | m_eff(t) - m_eff(t+1) |  <=  1.0 * (jackknife error of the difference
           m_eff(t) - m_eff(t+1), computed from the jackknife samples of the difference), and
      (ii) the relative error of m_eff(t+1) is below 25 %  (err / m_eff(t+1) < 0.25,
           m_eff(t+1) > 0).
    The search runs over t = 1 .. T/2 - 2.  The error quoted for the mass is the jackknife
    error of m_eff(t*) with t* held fixed at the value found on the full sample.
    If no such t exists the result is flagged 'no plateau' and the value reported is m_eff at
    the last t of the initial run t = 0, 1, 2, ... of effective masses with relative error
    < 25 %; it is an UPPER BOUND ONLY (flag 'upper bound').  If not even m_eff(0) has a relative
    error < 25 % the flag is 'no signal' and no value is reported.
    m_eff(t) for t = 0 .. 5 is always reported with errors so that a reader can judge.

    Known property of R5 (see tests/test_stats.py, which measures it on synthetic data): t* is
    selected with the same data that provide m_eff(t*), so the quoted jackknife error does not
    include the selection effect, and residual excited-state contamination below the noise
    biases m_eff(t*) upwards.  m_eff(t*) of a positive correlator is a variational upper
    estimate of the ground-state mass.

R6  Cross-check: uncorrelated single-cosh fit  C_proj(t) = A cosh(m (t - T/2))  for
    t = t* .. t_max, t_max = the last t <= T/2 of the run of points starting at t* with
    C_proj(t) > 2 * error; needs at least 3 points.  Errors from the jackknife (the fit is
    repeated in every jackknife sample with the full-sample weights).  The quoted chi^2 ignores
    correlations between time slices and is NOT a goodness-of-fit probability.  (In the
    'no plateau' case the fit starts at the t whose m_eff is quoted.)  The fit is a cross-check
    only; the quoted mass is always the one of rule R5.

R7  String tension from the torelon energy E(L) (lattice units, D = space-time dimension):
        Luscher:      E = sigma L - pi (D-2) / (6 L)          =>  sigma = (E + pi (D-2)/(6 L)) / L
        Nambu-Goto:   E = sigma L sqrt(1 - pi (D-2) / (3 sigma L^2))
                                 =>  sigma = [ c + sqrt(c^2 + 4 L^2 E^2) ] / (2 L^2),  c = pi (D-2)/3
    Both are reported.  D = 2: no correction, sigma = E / L.

R8  Errors.  Blocked jackknife over bins of consecutive measurements formed WITHIN each
    independent stream; bins of all streams are pooled.  Measurements that do not fill a whole
    bin are dropped from the START of their stream and counted in the output.  Bin size used
    by analyze.py unless overridden on the command line: B = ceil(10 * tau_max), tau_max = the
    largest integrated autocorrelation time (Madras-Sokal window, c = 6) among the plaquette
    and, for every glueball and torelon operator, its time-slice average and its C(0) and C(1)
    estimators; the analysis is repeated with 2B as a stability check.

Everything here is numerical evidence about a lattice model at finite lattice spacing and
volume; none of it is, or is claimed to be, a proof of the Yang-Mills mass-gap problem.
"""
from __future__ import annotations

import math

import numpy as np
from scipy import linalg, optimize

__all__ = [
    "MIN_EIG", "GEVP_T0", "PLATEAU_NSIGMA", "PLATEAU_MAX_RELERR",
    "bin_means", "jackknife_samples", "jackknife_error", "jackknife",
    "autocorrelation", "tau_int", "mean_err_tau",
    "correlator_bins", "symmetrize_fold", "jackknife_correlators",
    "select_operators", "solve_gevp", "gevp_project",
    "cosh_effective_mass", "log_effective_mass", "effective_masses",
    "plateau_rule", "cosh_fit",
    "sigma_luscher", "sigma_nambu_goto", "torelon_energy_luscher", "torelon_energy_nambu_goto",
    "analyze_channel",
]

#: R2: minimal eigenvalue of the normalised t0 correlator matrix of the accepted operator set
MIN_EIG = 0.01
#: R3: reference time of the GEVP
GEVP_T0 = 0
#: R5: agreement criterion (in jackknife sigmas of the difference) and maximal relative error
PLATEAU_NSIGMA = 1.0
PLATEAU_MAX_RELERR = 0.25


# ==============================================================================================
# binning and jackknife
# ==============================================================================================
def bin_means(x, binsize):
    """Means over consecutive bins of ``binsize`` entries along axis 0.

    Entries that do not fill a whole bin are dropped from the START of the series (rule R8).
    Returns an array of shape (n // binsize,) + x.shape[1:].
    """
    x = np.asarray(x, dtype=np.float64)
    binsize = int(binsize)
    if binsize < 1:
        raise ValueError("binsize must be >= 1")
    nb = x.shape[0] // binsize
    drop = x.shape[0] - nb * binsize
    return x[drop:].reshape((nb, binsize) + x.shape[1:]).mean(axis=1)


def jackknife_samples(bins):
    """Leave-one-out means: out[i] = mean of all bins except bin i (axis 0)."""
    bins = np.asarray(bins, dtype=np.float64)
    n = bins.shape[0]
    if n < 2:
        raise ValueError("the jackknife needs at least 2 bins")
    return (bins.sum(axis=0)[None] - bins) / (n - 1)


def jackknife_error(samples):
    """Jackknife error from leave-one-out estimates theta_i (axis 0):
    sqrt( (n-1)/n * sum_i (theta_i - mean(theta))^2 ).  Entries for which any sample is
    not finite get an infinite error."""
    s = np.asarray(samples, dtype=np.float64)
    n = s.shape[0]
    bad = ~np.all(np.isfinite(s), axis=0)
    with np.errstate(invalid="ignore"):
        d = s - np.mean(s, axis=0)[None]
        err = np.sqrt((n - 1.0) / n * np.sum(d * d, axis=0))
    err = np.where(bad, np.inf, err)
    return float(err) if np.ndim(err) == 0 else err


def jackknife(func, *bins):
    """Blocked jackknife of a general function of means.

    ``bins`` are one or more arrays whose axis 0 runs over the same n bins (bin means).
    ``func`` maps the means (arrays without axis 0) to a float or an array.
    Returns (value, error, samples): value = func(full means), samples[i] = func(means without
    bin i), error = jackknife error of the samples.
    """
    arrs = [np.asarray(b, dtype=np.float64) for b in bins]
    n = arrs[0].shape[0]
    if any(a.shape[0] != n for a in arrs):
        raise ValueError("all inputs need the same number of bins")
    value = np.asarray(func(*[a.mean(axis=0) for a in arrs]), dtype=np.float64)
    jks = [jackknife_samples(a) for a in arrs]
    samples = np.array([np.asarray(func(*[j[i] for j in jks]), dtype=np.float64)
                        for i in range(n)])
    err = jackknife_error(samples)
    if value.ndim == 0:
        return float(value), err, samples
    return value, err, samples


# ==============================================================================================
# autocorrelation
# ==============================================================================================
def _as_streams(x):
    """Accept a 1-d array or a list/tuple of 1-d arrays (independent streams)."""
    if isinstance(x, (list, tuple)):
        streams = [np.asarray(s, dtype=np.float64).ravel() for s in x]
    else:
        streams = [np.asarray(x, dtype=np.float64).ravel()]
    streams = [s for s in streams if s.size > 0]
    if not streams:
        raise ValueError("no data")
    return streams


def autocorrelation(x, maxlag=None):
    """Normalised autocorrelation function rho(t), t = 0 .. maxlag, of a time series (or of
    several independent streams of the same observable, list of 1-d arrays).

    Gamma(t) = sum_streams sum_i (x_i - m)(x_{i+t} - m) / sum_streams max(N_r - t, 0) with the
    global mean m;  rho(t) = Gamma(t) / Gamma(0).  A stream of length N_r contributes to the
    lags t < N_r only.  Default maxlag: half the length of the SHORTEST stream (every stream
    then contributes to every lag); an explicit maxlag may be as large as N_max - 1.
    """
    streams = _as_streams(x)
    ntot = sum(s.size for s in streams)
    nmin = min(s.size for s in streams)
    nmax = max(s.size for s in streams)
    if maxlag is None:
        maxlag = nmin // 2
    maxlag = int(max(0, min(maxlag, nmax - 1)))
    m = sum(s.sum() for s in streams) / ntot
    num = np.zeros(maxlag + 1)
    den = np.zeros(maxlag + 1)
    for s in streams:
        d = s - m
        n = d.size
        k = min(maxlag, n - 1)             # this stream contributes to the lags 0 .. k
        nfft = 1
        while nfft < n + k + 1:
            nfft *= 2
        f = np.fft.rfft(d, nfft)
        ac = np.fft.irfft(f * np.conj(f), nfft)[:k + 1]
        num[:k + 1] += ac
        den[:k + 1] += n - np.arange(k + 1)
    gamma = num / den
    if gamma[0] <= 0.0:
        return np.zeros(maxlag + 1)
    return gamma / gamma[0]


def _ms_window(rho, c):
    """Madras-Sokal window on rho[0 .. maxlag].  Returns (tau, w, i): tau[k] = tau_int(W = w[k]),
    w = 1 .. maxlag, and i = index of the first window with w >= c * max(tau, 1/2) or None."""
    tau = 0.5 + np.cumsum(rho[1:])
    w = np.arange(1, rho.size)
    ok = np.nonzero(w >= c * np.maximum(tau, 0.5))[0]
    return tau, w, (int(ok[0]) if ok.size else None)


def tau_int(x, c=6.0, maxlag=None):
    """Integrated autocorrelation time with the automatic window of Madras and Sokal.

    tau_int(W) = 1/2 + sum_{t=1}^{W} rho(t);  the window is the smallest W with
    W >= c * max(tau_int(W), 1/2) (c = 6 by default; the max guards against anticorrelated
    series, for which the plain criterion would stop at W = 1).  Convention: uncorrelated data
    have tau_int = 1/2 and the variance of the mean is  2 tau_int var(x) / N.

    Returns (tau, dtau, W): dtau = tau sqrt(2 (2W + 1) / N) (Madras-Sokal).  The window is
    searched up to maxlag (default N_min / 2, N_min = length of the shortest stream).  If it
    is not reached there and the streams have different lengths, the search continues up to
    N_max / 2 using, at every lag, the streams that are long enough (so that one very short
    stream, e.g. a job that died early, cannot truncate the window of the whole ensemble; a
    result for which the window IS reached within N_min / 2 is not affected by this in any
    bit).  If the window criterion is still not met the last value is returned with
    dtau = inf.  A constant series returns (0.5, 0.0, 0).
    """
    streams = _as_streams(x)
    ntot = sum(s.size for s in streams)
    rho = autocorrelation(streams, maxlag)
    tau = w = i = None
    if rho.size >= 2 and np.any(rho):
        tau, w, i = _ms_window(rho, c)
    if i is None and maxlag is None:
        nmin = min(s.size for s in streams)
        nmax = max(s.size for s in streams)
        if nmax // 2 > nmin // 2:          # unequal streams: extend the lag range
            rho = autocorrelation(streams, nmax // 2)
            if rho.size >= 2 and np.any(rho):
                tau, w, i = _ms_window(rho, c)
    if tau is None:
        return 0.5, 0.0, 0
    if i is None:
        return float(tau[-1]), float("inf"), int(w[-1])
    t = max(float(tau[i]), 1e-3)      # anticorrelated series legitimately have tau_int < 1/2
    W = int(w[i])
    return t, float(t * math.sqrt(2.0 * (2 * W + 1) / ntot)), W


def mean_err_tau(x, c=6.0):
    """Mean of a (multi-stream) time series with the autocorrelation-corrected error.

    Returns dict(mean, err, err_naive, tau_int, tau_int_err, window, n) with
    err = err_naive * sqrt(2 tau_int).
    """
    streams = _as_streams(x)
    allx = np.concatenate(streams)
    n = allx.size
    mean = float(allx.mean())
    naive = float(allx.std(ddof=1) / math.sqrt(n)) if n > 1 else float("nan")
    t, dt, W = tau_int(streams, c=c)
    return {"mean": mean, "err": naive * math.sqrt(2.0 * t), "err_naive": naive,
            "tau_int": t, "tau_int_err": dt, "window": W, "n": int(n)}


# ==============================================================================================
# correlator matrices
# ==============================================================================================
def correlator_bins(O, binsize, ref=None):
    """Bin-wise ingredients of the correlator matrix (rule R1).

    O : array (N, K, T) -- N configurations, K operators, T time slices -- or (N, G, K, T),
        where G indexes equivalent copies of the operator set (e.g. torelons winding different
        directions of equal length) whose correlator matrices are averaged.
    ref : optional array (K,) subtracted from every operator before anything is computed
        (numerical conditioning only: connected correlators do not depend on it).

    Returns (A, Vb):
        A[b, k, l, tau]  = mean over the configurations of bin b (and over G) of
                           (1/T) sum_t O_k(t) O_l(t + tau)            shape (nb, K, K, T)
        Vb[b, g, k]      = mean over the configurations of bin b and over t of O_k (copy g)
                                                                     shape (nb, G, K)
    Leftover configurations are dropped from the start (R8).
    """
    O = np.asarray(O, dtype=np.float64)
    if O.ndim == 3:
        O = O[:, None]
    if O.ndim != 4:
        raise ValueError("O must have shape (N, K, T) or (N, G, K, T)")
    N, G, K, T = O.shape
    binsize = int(binsize)
    nb = N // binsize
    drop = N - nb * binsize
    A = np.empty((nb, K, K, T), dtype=np.float64)
    Vb = np.empty((nb, G, K), dtype=np.float64)
    refv = np.zeros(K) if ref is None else np.asarray(ref, dtype=np.float64)
    for b in range(nb):
        blk = O[drop + b * binsize: drop + (b + 1) * binsize] - refv[None, None, :, None]
        Vb[b] = blk.mean(axis=(0, 3))
        F = np.fft.rfft(blk, axis=-1)                                 # (n, G, K, T/2+1)
        S = np.einsum("ngkw,nglw->klw", np.conj(F), F) / (binsize * G)
        A[b] = np.fft.irfft(S, n=T, axis=-1) / T
    return A, Vb


def symmetrize_fold(C):
    """Rule R1 symmetrisation of C[..., K, K, T]: average over k <-> l and tau <-> T - tau and
    keep tau = 0 .. T/2.  Returns [..., K, K, T/2 + 1]."""
    C = np.asarray(C, dtype=np.float64)
    T = C.shape[-1]
    Ct = np.swapaxes(C, -3, -2)
    idx = (-np.arange(T)) % T
    full = 0.25 * (C + Ct + C[..., idx] + Ct[..., idx])
    return full[..., : T // 2 + 1]


def jackknife_correlators(A, Vb=None, subtract=True):
    """Full-sample and jackknife-sample correlator matrices from the output of
    ``correlator_bins`` (bins of several streams may simply be concatenated along axis 0).

    Returns (C, Cjk): C[k, l, tau] (tau = 0 .. T/2) and Cjk[b, k, l, tau].  With
    subtract=True the disconnected part <O_k><O_l> (averaged over the G copies) is subtracted,
    in every jackknife sample with that sample's own <O> (vacuum subtraction inside the
    jackknife).
    """
    A = np.asarray(A, dtype=np.float64)
    nb = A.shape[0]
    if nb < 2:
        raise ValueError("need at least 2 bins")
    Am = A.mean(axis=0)
    Ajk = (A.sum(axis=0)[None] - A) / (nb - 1)
    if subtract:
        if Vb is None:
            raise ValueError("Vb is required for the vacuum subtraction")
        Vb = np.asarray(Vb, dtype=np.float64)
        Vm = Vb.mean(axis=0)                                   # (G, K)
        Vjk = (Vb.sum(axis=0)[None] - Vb) / (nb - 1)           # (nb, G, K)
        Am = Am - np.einsum("gk,gl->kl", Vm, Vm)[:, :, None] / Vm.shape[0]
        Ajk = Ajk - np.einsum("bgk,bgl->bkl", Vjk, Vjk)[:, :, :, None] / Vm.shape[0]
    return symmetrize_fold(Am), symmetrize_fold(Ajk)


# ==============================================================================================
# GEVP
# ==============================================================================================
def select_operators(C, t0=GEVP_T0, min_eig=MIN_EIG):
    """Rule R2: greedy selection of a well-conditioned operator subset.

    C : full-sample correlator matrix [K, K, tau].  Returns (selected, info): ``selected`` is
    the list of accepted operator indices in order of acceptance (best operator first),
    ``info`` a dict with the ranking, the quality ratios and the reason every operator was
    kept or dropped.
    """
    C = np.asarray(C, dtype=np.float64)
    K = C.shape[0]
    d0 = np.array([C[k, k, t0] for k in range(K)])
    d1 = np.array([C[k, k, t0 + 1] for k in range(K)])
    valid = (d0 > 0.0) & (d1 > 0.0) & np.isfinite(d0) & np.isfinite(d1)
    q = np.where(valid, d1 / np.where(valid, d0, 1.0), -np.inf)
    order = sorted([k for k in range(K) if valid[k]], key=lambda k: (-q[k], k))
    selected = []
    decisions = {}
    for k in range(K):
        if not valid[k]:
            decisions[k] = "discarded: non-positive diagonal correlator"
    for k in order:
        trial = selected + [k]
        sub = C[np.ix_(trial, trial)][:, :, t0] / np.sqrt(np.outer(d0[trial], d0[trial]))
        emin = float(np.linalg.eigvalsh(0.5 * (sub + sub.T))[0])
        if emin >= min_eig:
            selected = trial
            decisions[k] = "accepted (min eigenvalue %.4g)" % emin
        else:
            decisions[k] = "dropped: min eigenvalue %.4g < %.4g" % (emin, min_eig)
    info = {"ranking": [int(k) for k in order],
            "quality": [float(q[k]) if np.isfinite(q[k]) else None for k in range(K)],
            "decisions": [decisions[k] for k in range(K)],
            "min_eig": float(min_eig), "t0": int(t0)}
    return [int(k) for k in selected], info


def solve_gevp(Chat, t0=GEVP_T0):
    """Rule R3 on an already normalised and restricted matrix Chat[K, K, tau]:
    Chat(t0+1) v = lambda Chat(t0) v.  Returns (lam, vecs) sorted by DECREASING lambda,
    vecs[:, n] normalised to v^T Chat(t0) v = 1.  Raises LinAlgError if Chat(t0) is not
    positive definite."""
    a = 0.5 * (Chat[:, :, t0 + 1] + Chat[:, :, t0 + 1].T)
    b = 0.5 * (Chat[:, :, t0] + Chat[:, :, t0].T)
    lam, vecs = linalg.eigh(a, b)
    order = np.argsort(lam)[::-1]
    return lam[order], vecs[:, order]


def gevp_project(C, Cjk, t0=GEVP_T0, min_eig=MIN_EIG):
    """Rules R2 + R3: select operators, solve the GEVP on the full sample and in every
    jackknife sample, and return the ground-state projected correlator.

    Returns a dict:
        selected, selection (info from select_operators),
        eigenvalues (full sample, decreasing), eigenvector (ground state, in the normalised
        basis of the selected operators), norm (sqrt(C_kk(t0)) of the selected operators),
        Cproj[tau], Cproj_jk[b, tau], n_fallback (number of jackknife samples in which the GEVP
        failed and the full-sample eigenvector was used instead).
    Raises ValueError if no operator has a positive correlator.
    """
    C = np.asarray(C, dtype=np.float64)
    Cjk = np.asarray(Cjk, dtype=np.float64)
    sel, info = select_operators(C, t0=t0, min_eig=min_eig)
    if not sel:
        raise ValueError("no usable operator (all diagonal correlators non-positive)")
    norm = np.sqrt(np.array([C[k, k, t0] for k in sel]))
    scale = 1.0 / np.outer(norm, norm)
    Ch = C[np.ix_(sel, sel)] * scale[:, :, None]
    lam, vecs = solve_gevp(Ch, t0)
    v = vecs[:, 0]
    cproj = np.einsum("k,klt,l->t", v, Ch, v)
    nb = Cjk.shape[0]
    cproj_jk = np.empty((nb, C.shape[-1]))
    lam_jk = np.empty(nb)
    n_fallback = 0
    for b in range(nb):
        Cb = Cjk[b][np.ix_(sel, sel)] * scale[:, :, None]
        try:
            lb, vb = solve_gevp(Cb, t0)
            vv = vb[:, 0]
            lam_jk[b] = lb[0]
        except (linalg.LinAlgError, ValueError):
            vv = v
            lam_jk[b] = np.nan
            n_fallback += 1
        cproj_jk[b] = np.einsum("k,klt,l->t", vv, Cb, vv)
    return {"selected": sel, "selection": info, "eigenvalues": lam, "eigenvector": v,
            "lambda0_err": jackknife_error(lam_jk), "norm": norm,
            "Cproj": cproj, "Cproj_jk": cproj_jk, "n_fallback": n_fallback}


# ==============================================================================================
# effective masses
# ==============================================================================================
def _logcosh(x):
    ax = np.abs(x)
    return ax + np.log1p(np.exp(-2.0 * ax)) - math.log(2.0)


def cosh_effective_mass(c0, c1, t, T):
    """Rule R4: solve c0 / c1 = cosh(m (t - T/2)) / cosh(m (t + 1 - T/2)) for m > 0.

    c0 = C(t), c1 = C(t+1) (scalars or arrays of equal shape; t may be an array broadcastable
    to them), 0 <= t <= T/2 - 1.  NaN where c0 <= 0, c1 <= 0 or c0 <= c1 (no positive solution).
    Vectorised bisection (the left-hand side minus the right-hand side is monotonic in m);
    accurate to ~1e-14.
    """
    c0 = np.asarray(c0, dtype=np.float64)
    c1 = np.asarray(c1, dtype=np.float64)
    tt = np.asarray(t, dtype=np.float64)
    c0, c1, tt = np.broadcast_arrays(c0, c1, tt)
    a = 0.5 * T - tt            # distance of t from the midpoint,  a >= 1
    b = a - 1.0                 # distance of t+1,                   b >= 0
    with np.errstate(divide="ignore", invalid="ignore"):
        good = np.isfinite(c0) & np.isfinite(c1) & (c0 > 0.0) & (c1 > 0.0) & (c0 > c1) & (b >= 0.0)
        lr = np.where(good, np.log(np.where(good, c0, 2.0) / np.where(good, c1, 1.0)), 1.0)
    lo = np.zeros(lr.shape)
    hi = lr + math.log(2.0) + 1e-12    # f(hi) >= 0 because logcosh(ma) - logcosh(mb) >= m - ln 2
    for _ in range(70):
        mid = 0.5 * (lo + hi)
        f = _logcosh(mid * a) - _logcosh(mid * b) - lr
        up = f > 0.0
        hi = np.where(up, mid, hi)
        lo = np.where(up, lo, mid)
    m = np.where(good, 0.5 * (lo + hi), np.nan)
    return float(m) if m.ndim == 0 else m


def log_effective_mass(c0, c1):
    """ln(c0 / c1), NaN where c0 <= 0 or c1 <= 0."""
    c0 = np.asarray(c0, dtype=np.float64)
    c1 = np.asarray(c1, dtype=np.float64)
    with np.errstate(divide="ignore", invalid="ignore"):
        good = np.isfinite(c0) & np.isfinite(c1) & (c0 > 0.0) & (c1 > 0.0)
        m = np.where(good, np.log(np.where(good, c0, 1.0) / np.where(good, c1, 1.0)), np.nan)
    return float(m) if m.ndim == 0 else m


def effective_masses(Cproj, Cproj_jk, T):
    """Effective masses of a (projected) correlator given for tau = 0 .. T/2.

    Returns a dict of arrays indexed by t = 0 .. T/2 - 1:
        t, m_cosh, err_cosh, m_log, err_log, and the jackknife samples m_cosh_jk, m_log_jk
        (shape (nb, T/2)).  Errors follow rule R4 (infinite if undefined in any sample).
    """
    Cproj = np.asarray(Cproj, dtype=np.float64)
    Cjk = np.asarray(Cproj_jk, dtype=np.float64)
    nt = T // 2
    t = np.arange(nt)
    mc = cosh_effective_mass(Cproj[:nt], Cproj[1:nt + 1], t, T)
    ml = log_effective_mass(Cproj[:nt], Cproj[1:nt + 1])
    mc_jk = cosh_effective_mass(Cjk[:, :nt], Cjk[:, 1:nt + 1], t[None, :], T)
    ml_jk = log_effective_mass(Cjk[:, :nt], Cjk[:, 1:nt + 1])
    ec = np.where(np.isfinite(mc), jackknife_error(mc_jk), np.inf)
    el = np.where(np.isfinite(ml), jackknife_error(ml_jk), np.inf)
    return {"t": t, "m_cosh": mc, "err_cosh": ec, "m_log": ml, "err_log": el,
            "m_cosh_jk": mc_jk, "m_log_jk": ml_jk}


def _relerr_ok(m, e, max_relerr):
    return bool(np.isfinite(m) and np.isfinite(e) and m > 0.0 and e / m < max_relerr)


def plateau_rule(m, m_jk, nsigma=PLATEAU_NSIGMA, max_relerr=PLATEAU_MAX_RELERR):
    """Rule R5 applied to cosh-corrected effective masses m[t] (t = 0 .. T/2 - 1) with jackknife
    samples m_jk[b, t].

    Returns a dict:
        t_star   : int or None
        flag     : 'plateau' | 'no plateau' | 'no signal'
        plateau  : bool
        upper_bound_only : bool (True for 'no plateau')
        mass, err: float (NaN for 'no signal'); mass_jk: jackknife samples of the mass (or None)
        t_value  : the t whose m_eff is reported (t_star, or the fallback t)
        checks   : list of dicts, one per tested t, with the numbers that entered the decision
    """
    m = np.asarray(m, dtype=np.float64)
    m_jk = np.asarray(m_jk, dtype=np.float64)
    nt = m.shape[0]                      # = T/2 ; valid t are 0 .. nt-1
    err = np.where(np.isfinite(m), jackknife_error(m_jk), np.inf)
    checks = []
    t_star = None
    for t in range(1, nt - 1):           # t = 1 .. T/2 - 2
        d = m[t] - m[t + 1]
        sd = jackknife_error(m_jk[:, t] - m_jk[:, t + 1]) if np.isfinite(d) else np.inf
        agree = bool(np.isfinite(d) and np.isfinite(sd) and abs(d) <= nsigma * sd)
        rel_ok = _relerr_ok(m[t + 1], err[t + 1], max_relerr)
        checks.append({"t": int(t),
                       "diff": float(d) if np.isfinite(d) else None,
                       "diff_err": float(sd) if np.isfinite(sd) else None,
                       "agree": agree,
                       "relerr_next": (float(err[t + 1] / m[t + 1])
                                       if np.isfinite(m[t + 1]) and np.isfinite(err[t + 1])
                                       and m[t + 1] > 0 else None),
                       "relerr_next_ok": rel_ok})
        if agree and rel_ok:
            t_star = t
            break
    if t_star is not None:
        return {"t_star": int(t_star), "flag": "plateau", "plateau": True,
                "upper_bound_only": False, "t_value": int(t_star),
                "mass": float(m[t_star]), "err": float(err[t_star]),
                "mass_jk": m_jk[:, t_star].copy(), "checks": checks}
    # fallback: last t of the initial run of effective masses with relative error < max_relerr
    t_last = None
    for t in range(nt):
        if _relerr_ok(m[t], err[t], max_relerr):
            t_last = t
        else:
            break
    if t_last is None:
        return {"t_star": None, "flag": "no signal", "plateau": False,
                "upper_bound_only": False, "t_value": None,
                "mass": float("nan"), "err": float("nan"), "mass_jk": None, "checks": checks}
    return {"t_star": None, "flag": "no plateau", "plateau": False,
            "upper_bound_only": True, "t_value": int(t_last),
            "mass": float(m[t_last]), "err": float(err[t_last]),
            "mass_jk": m_jk[:, t_last].copy(), "checks": checks}


# ==============================================================================================
# cosh fit (cross-check, rule R6)
# ==============================================================================================
def _cosh_fit_one(c, sig, ts, T, m_hint):
    """Uncorrelated chi^2 fit of c[ts] to A cosh(m (t - T/2)); A eliminated analytically."""
    y = c[ts]
    w = 1.0 / sig[ts] ** 2
    x = ts - 0.5 * T

    def chi2(mm):
        # scaled model to avoid overflow: g = cosh(m x) / cosh(m x_max)
        lg = _logcosh(mm * x)
        g = np.exp(lg - lg.max())
        amp = np.sum(w * y * g) / np.sum(w * g * g)
        return float(np.sum(w * (y - amp * g) ** 2))

    hi = max(4.0 * m_hint, 1.0) if np.isfinite(m_hint) and m_hint > 0 else 5.0
    res = optimize.minimize_scalar(chi2, bounds=(1e-6, hi), method="bounded",
                                   options={"xatol": 1e-10})
    mm = float(res.x)
    lg = _logcosh(mm * x)
    g = np.exp(lg - lg.max())
    amp = np.sum(w * y * g) / np.sum(w * g * g)
    # amplitude in the convention C(t) = A cosh(m (t - T/2))
    amp_true = amp * math.exp(-lg.max())
    return mm, float(amp_true), float(res.fun)


def cosh_fit(Cproj, Cproj_jk, T, tmin, tmax=None):
    """Rule R6: uncorrelated fit of C(t) = A cosh(m (t - T/2)) on t = tmin .. tmax.

    If tmax is None it is the last t <= T/2 of the run of points starting at tmin with
    C(t) > 2 * error.  Returns a dict (m, err, A, chi2, dof, tmin, tmax, n_points) or
    {'ok': False, 'reason': ...} if fewer than 3 points are available.
    """
    Cproj = np.asarray(Cproj, dtype=np.float64)
    Cjk = np.asarray(Cproj_jk, dtype=np.float64)
    sig = jackknife_error(Cjk)
    nt = Cproj.shape[0]
    if tmin is None or tmin < 0 or tmin >= nt:
        return {"ok": False, "reason": "invalid tmin"}
    if tmax is None:
        tmax = tmin - 1
        for t in range(tmin, nt):
            if np.isfinite(sig[t]) and sig[t] > 0 and Cproj[t] > 2.0 * sig[t]:
                tmax = t
            else:
                break
    if tmax - tmin + 1 < 3:
        return {"ok": False, "tmin": int(tmin), "tmax": int(tmax),
                "reason": "fewer than 3 points with C > 2 sigma"}
    ts = np.arange(tmin, tmax + 1)
    hint = cosh_effective_mass(Cproj[tmin], Cproj[tmin + 1], tmin, T)
    m, amp, chi2 = _cosh_fit_one(Cproj, sig, ts, T, hint)
    mj = np.array([_cosh_fit_one(Cjk[b], sig, ts, T, hint)[0] for b in range(Cjk.shape[0])])
    return {"ok": True, "m": m, "err": float(jackknife_error(mj)), "A": amp, "chi2": chi2,
            "dof": int(ts.size - 2), "tmin": int(tmin), "tmax": int(tmax),
            "n_points": int(ts.size), "m_jk": mj}


# ==============================================================================================
# string tension (rule R7)
# ==============================================================================================
def sigma_luscher(E, L, D):
    """sigma a^2 from the torelon energy: E = sigma L - pi (D-2) / (6 L)."""
    E = np.asarray(E, dtype=np.float64)
    out = (E + math.pi * (D - 2) / (6.0 * L)) / L
    return float(out) if out.ndim == 0 else out


def sigma_nambu_goto(E, L, D):
    """sigma a^2 from the torelon energy: E = sigma L sqrt(1 - pi (D-2) / (3 sigma L^2)),
    i.e. the positive root of  L^2 sigma^2 - c sigma - E^2 = 0  with c = pi (D-2) / 3."""
    E = np.asarray(E, dtype=np.float64)
    c = math.pi * (D - 2) / 3.0
    out = (c + np.sqrt(c * c + 4.0 * L * L * E * E)) / (2.0 * L * L)
    return float(out) if out.ndim == 0 else out


def torelon_energy_luscher(sigma, L, D):
    """Inverse of ``sigma_luscher``."""
    return sigma * L - math.pi * (D - 2) / (6.0 * L)


def torelon_energy_nambu_goto(sigma, L, D):
    """Inverse of ``sigma_nambu_goto`` (NaN if the square root is imaginary)."""
    arg = 1.0 - math.pi * (D - 2) / (3.0 * sigma * L * L)
    return sigma * L * math.sqrt(arg) if arg >= 0 else float("nan")


# ==============================================================================================
# complete single-channel analysis
# ==============================================================================================
def analyze_channel(streams, T, binsize, subtract_vev, t0=GEVP_T0, min_eig=MIN_EIG,
                    do_fit=True):
    """Complete analysis of one channel (rules R1-R6 and R8).

    streams : array or list of arrays (one per independent stream), each (N, K, T) or
              (N, G, K, T) (see ``correlator_bins``).
    T       : time extent.
    binsize : number of consecutive measurements per jackknife bin (bins are formed within
              each stream, then pooled).
    subtract_vev : True for the glueball (vacuum subtraction inside the jackknife), False for
              the torelon.

    Returns a dict with (among others)
        n_bins, n_used, n_dropped, C [K,K,tau], C_err, C_jk, vev [G,K], vev_err,
        gevp (dict from gevp_project), Cproj, Cproj_err, meff (dict from effective_masses),
        plateau (dict from plateau_rule), mass, err, mass_jk (aligned with the pooled bins),
        fit (dict from cosh_fit or None), operator_table (per-operator C(1)/C(0) and m_eff).
    """
    if not isinstance(streams, (list, tuple)):
        streams = [streams]
    arrs = []
    for s in streams:
        s = np.asarray(s, dtype=np.float64)
        if s.ndim == 3:
            s = s[:, None]
        arrs.append(s)
    K = arrs[0].shape[2]
    G = arrs[0].shape[1]
    if any(a.shape[1:] != (G, K, T) for a in arrs):
        raise ValueError("all streams need the same operator layout and time extent")
    ntot = sum(a.shape[0] for a in arrs)
    # reference shift (numerical conditioning of the vacuum subtraction only)
    ref = sum(a.sum(axis=(0, 1, 3)) for a in arrs) / (ntot * G * T) if subtract_vev else None
    As, Vs = [], []
    n_used = 0
    for a in arrs:
        A, Vb = correlator_bins(a, binsize, ref=ref)
        As.append(A)
        Vs.append(Vb)
        n_used += A.shape[0] * int(binsize)
    A = np.concatenate(As, axis=0)
    Vb = np.concatenate(Vs, axis=0)
    nb = A.shape[0]
    if nb < 2:
        raise ValueError("fewer than 2 bins: reduce the bin size or collect more data")
    C, Cjk = jackknife_correlators(A, Vb, subtract=subtract_vev)
    C_err = jackknife_error(Cjk)

    # vacuum expectation values (per copy and operator), with jackknife errors
    vev = Vb.mean(axis=0) + (ref[None, :] if ref is not None else 0.0)
    vev_err = jackknife_error(jackknife_samples(Vb))

    # per-operator diagnostics
    nt = T // 2
    op_table = []
    tt = np.arange(nt)
    for k in range(K):
        ck = C[k, k]
        ckj = Cjk[:, k, k]
        with np.errstate(divide="ignore", invalid="ignore"):
            r = ck[1] / ck[0] if ck[0] > 0 else float("nan")
            rj = np.where(ckj[:, 0] > 0, ckj[:, 1] / ckj[:, 0], np.nan)
        mk = cosh_effective_mass(ck[:nt], ck[1:nt + 1], tt, T)
        mkj = cosh_effective_mass(ckj[:, :nt], ckj[:, 1:nt + 1], tt[None, :], T)
        ek = np.where(np.isfinite(mk), jackknife_error(mkj), np.inf)
        op_table.append({"index": k, "C0": float(ck[0]), "C0_err": float(C_err[k, k, 0]),
                         "C1_over_C0": float(r), "C1_over_C0_err": float(jackknife_error(rj)),
                         "m_cosh": mk, "err_cosh": ek})

    out = {"T": int(T), "K": int(K), "G": int(G), "binsize": int(binsize), "n_bins": int(nb),
           "n_total": int(ntot), "n_used": int(n_used), "n_dropped": int(ntot - n_used),
           "subtract_vev": bool(subtract_vev), "t0": int(t0), "min_eig": float(min_eig),
           "C": C, "C_err": C_err, "C_jk": Cjk, "vev": vev, "vev_err": vev_err,
           "operator_table": op_table}
    try:
        g = gevp_project(C, Cjk, t0=t0, min_eig=min_eig)
    except (ValueError, linalg.LinAlgError) as exc:
        out.update({"gevp": None, "error": "GEVP failed: %s" % exc, "Cproj": None,
                    "meff": None, "mass": float("nan"), "err": float("nan"), "mass_jk": None,
                    "plateau": {"t_star": None, "flag": "no signal", "plateau": False,
                                "upper_bound_only": False, "t_value": None,
                                "mass": float("nan"), "err": float("nan"), "mass_jk": None,
                                "checks": []},
                    "fit": None})
        return out
    me = effective_masses(g["Cproj"], g["Cproj_jk"], T)
    pl = plateau_rule(me["m_cosh"], me["m_cosh_jk"])
    fit = None
    if do_fit and pl["t_value"] is not None:
        fit = cosh_fit(g["Cproj"], g["Cproj_jk"], T, pl["t_value"])
    # overlap of the projected operator with the state of mass `mass`:
    # C_proj(t) / C_proj(0) = |c|^2 cosh(m (t - T/2)) / cosh(m T/2)
    overlap = float("nan")
    if pl["t_value"] is not None and np.isfinite(pl["mass"]):
        tv = pl["t_value"]
        mm = pl["mass"]
        overlap = float(g["Cproj"][tv] / g["Cproj"][0]
                        * math.exp(_logcosh(mm * 0.5 * T) - _logcosh(mm * (tv - 0.5 * T))))
    out.update({"gevp": g, "Cproj": g["Cproj"], "Cproj_err": jackknife_error(g["Cproj_jk"]),
                "Cproj_jk": g["Cproj_jk"], "meff": me, "plateau": pl,
                "mass": pl["mass"], "err": pl["err"], "mass_jk": pl["mass_jk"],
                "overlap": overlap, "fit": fit})
    return out
