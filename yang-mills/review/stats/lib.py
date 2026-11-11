"""Reviewer's own helpers (adversarial statistics review).  Imports nothing from ym.stats /
analyze.py / independent_analysis.py.  Raw data are opened read-only.

Definitions follow the pre-registered rules only where needed to talk about the same numbers
(R1 correlator, R2 subset, R3 GEVP t0=0, R4 cosh mass); everything else (linearised
per-configuration estimators, Gamma method, chunk tests) is the reviewer's own.
"""
import glob
import json
import math
import os

import numpy as np
from scipy import linalg, optimize

RAW = "/home/user/frisoj/yang-mills/results/raw"
RES = "/home/user/frisoj/yang-mills/results"
HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")

ENS = {
    "d3_b6.0_L16": ("d3_b6.0_L16", [101, 102, 103, 104]),
    "d3_b6.0_L24": ("d3_b6.0_L24", [801, 802, 803, 804]),
    "d3_b9.0_L24": ("d3_b9.0_L24", [301, 302, 303, 304]),
    "d3_b9.0_L24r": ("d3_b9.0_L24r", [305, 306, 307, 308]),
    "d3_b12.0_L32": ("d3_b12.0_L32", [501, 502, 503, 504]),
    "d4_b2.3_L10": ("d4_b2.3_L10", [201, 202, 203, 204]),
    "d4_b2.4_L12": ("d4_b2.4_L12", [401, 402, 403, 404]),
    "d4_b2.4_L16": ("d4_b2.4_L16", [701, 702, 703, 704]),
    "d4_b2.5_L16": ("d4_b2.5_L16", [601, 602, 603, 604]),
    "d4_b2.5_L16x": ("d4_b2.5_L16x", [605, 606, 607, 608]),
}
COMBINED = {
    "d3_b9.0_L24_combined": ["d3_b9.0_L24", "d3_b9.0_L24r"],
    "d4_b2.5_L16_combined": ["d4_b2.5_L16", "d4_b2.5_L16x"],
}
ALL = list(ENS) + list(COMBINED)
INDEP = list(ENS)


def stream_files(name):
    if name in COMBINED:
        out = []
        for n in COMBINED[name]:
            out += stream_files(n)
        return out
    pre, seeds = ENS[name]
    return [os.path.join(RAW, "%s_s%d.npz" % (pre, s)) for s in seeds]


def load(name, keys=("glue", "torelon", "plaq")):
    """list of dicts (one per stream): glue (n,K,T), torelon (n,G,K,T), plaq (n,), meta."""
    out = []
    for f in stream_files(name):
        with np.load(f, allow_pickle=False) as d:
            s = {k: np.array(d[k], dtype=np.float64) for k in keys}
            s["meta"] = json.loads(str(d["meta"]))
        s["file"] = os.path.basename(f)
        out.append(s)
    return out


def pipeline(name):
    with open(os.path.join(RES, name + ".json")) as f:
        return json.load(f)


# ------------------------------------------------------------------------------------------
# correlators
# ------------------------------------------------------------------------------------------
def fold(c):
    """average tau <-> T - tau along the last axis, keep 0..T/2."""
    T = c.shape[-1]
    idx = (-np.arange(T)) % T
    return (0.5 * (c + c[..., idx]))[..., : T // 2 + 1]


def corr_sums(O):
    """O (n, G, K, T) -> S[k,l,tau] = sum_n mean_G (1/T) sum_t O_k(t) O_l(t+tau), V[g,k] = sum_n
    mean_t O_k."""
    F = np.fft.rfft(O, axis=-1)
    S = np.einsum("ngkw,nglw->klw", np.conj(F), F) / O.shape[1]
    A = np.fft.irfft(S, n=O.shape[-1], axis=-1) / O.shape[-1]
    V = O.mean(axis=3).sum(axis=0)
    return A, V


def as4(x):
    return x[:, None] if x.ndim == 3 else x


def full_corr(streams_O, subtract):
    """Full-sample correlator matrix C[k,l,tau] (tau = 0..T/2), R1."""
    A = 0.0
    V = 0.0
    n = 0
    ref = None
    if subtract:
        ref = sum(as4(o).sum(axis=(0, 1, 3)) for o in streams_O) / sum(
            as4(o).shape[0] * as4(o).shape[1] * as4(o).shape[3] for o in streams_O)
    for o in streams_O:
        o = as4(o)
        if ref is not None:
            o = o - ref[None, None, :, None]
        a, v = corr_sums(o)
        A = A + a
        V = V + v
        n += o.shape[0]
    A = A / n
    V = V / n
    if subtract:
        A = A - np.einsum("gk,gl->kl", V, V)[:, :, None] / V.shape[0]
    A = 0.5 * (A + np.swapaxes(A, 0, 1))
    return fold(A), ref


def select_ops(C, min_eig=0.01):
    K = C.shape[0]
    d0 = np.array([C[k, k, 0] for k in range(K)])
    d1 = np.array([C[k, k, 1] for k in range(K)])
    ok = (d0 > 0) & (d1 > 0)
    q = np.where(ok, d1 / np.where(ok, d0, 1.0), -np.inf)
    order = sorted([k for k in range(K) if ok[k]], key=lambda k: (-q[k], k))
    sel = []
    for k in order:
        tr = sel + [k]
        sub = C[np.ix_(tr, tr)][:, :, 0] / np.sqrt(np.outer(d0[tr], d0[tr]))
        if np.linalg.eigvalsh(0.5 * (sub + sub.T))[0] >= min_eig:
            sel = tr
    return sel, q


def gevp_vector(C, sel):
    """ground-state vector w in ORIGINAL operator normalisation: P = sum_k w_k O_k, with
    C_proj(0) = 1."""
    norm = np.sqrt(np.array([C[k, k, 0] for k in sel]))
    Ch = C[np.ix_(sel, sel)] / np.outer(norm, norm)[:, :, None]
    a = 0.5 * (Ch[:, :, 1] + Ch[:, :, 1].T)
    b = 0.5 * (Ch[:, :, 0] + Ch[:, :, 0].T)
    lam, vec = linalg.eigh(a, b)
    v = vec[:, np.argmax(lam)]
    return v / norm, lam[::-1]


def project(O, sel, w, ref=None):
    """O (n,G,K,T) -> P (n,G,T)."""
    O = as4(O)
    x = O[:, :, sel, :]
    if ref is not None:
        x = x - ref[sel][None, None, :, None]
    return np.einsum("k,ngkt->ngt", w, x)


def ab_series(P):
    """P (n,G,T) -> a (n, T/2+1) = mean_G (1/T) sum_t P(t)P(t+tau) folded; b (n,G) = mean_t P."""
    F = np.fft.rfft(P, axis=-1)
    a = np.fft.irfft((F * np.conj(F)).real, n=P.shape[-1], axis=-1) / P.shape[-1]
    a = fold(a.mean(axis=1))
    b = P.mean(axis=2)
    return a, b


def conn(a_mean, b_mean, subtract):
    """C(tau) from means of a and b (b_mean shape (G,))."""
    if subtract:
        return a_mean - np.mean(b_mean ** 2)
    return a_mean


# ------------------------------------------------------------------------------------------
# effective mass (cosh, R4), own solver
# ------------------------------------------------------------------------------------------
def _lc(x):
    ax = abs(x)
    return ax + math.log1p(math.exp(-2.0 * ax)) - math.log(2.0)


def meff_cosh(c0, c1, t, T):
    if not (np.isfinite(c0) and np.isfinite(c1)) or c0 <= 0 or c1 <= 0 or c0 <= c1:
        return float("nan")
    lr = math.log(c0 / c1)
    a = 0.5 * T - t
    b = a - 1.0
    f = lambda m: _lc(m * a) - _lc(m * b) - lr
    return optimize.brentq(f, 1e-12, lr + 1.0, xtol=1e-14, rtol=1e-14)


def meff_all(C, T, tmax=None):
    nt = T // 2 if tmax is None else tmax + 1
    return np.array([meff_cosh(C[t], C[t + 1], t, T) for t in range(nt)])


def sigma_ng(E, L, D):
    c = math.pi * (D - 2) / 3.0
    return (c + np.sqrt(c * c + 4.0 * L * L * E * E)) / (2.0 * L * L)


def sigma_lu(E, L, D):
    return (E + math.pi * (D - 2) / (6.0 * L)) / L


# ------------------------------------------------------------------------------------------
# binning / jackknife
# ------------------------------------------------------------------------------------------
def bins_of(x, B):
    """bin means along axis 0, leftovers dropped from the START (as the pipeline)."""
    nb = x.shape[0] // B
    d = x.shape[0] - nb * B
    return x[d:].reshape((nb, B) + x.shape[1:]).mean(axis=1)


def jk(func, *arrs):
    n = arrs[0].shape[0]
    full = np.asarray(func(*[a.mean(axis=0) for a in arrs]), dtype=float)
    sums = [a.sum(axis=0) for a in arrs]
    samp = np.array([np.asarray(func(*[(s - a[i]) / (n - 1) for s, a in zip(sums, arrs)]),
                                dtype=float) for i in range(n)])
    err = np.sqrt((n - 1.0) / n * np.sum((samp - samp.mean(axis=0)) ** 2, axis=0))
    return full, err, samp


# ------------------------------------------------------------------------------------------
# autocorrelation (own implementation: direct sums per stream, common mean)
# ------------------------------------------------------------------------------------------
def acf(streams, maxlag, mean=None):
    """Gamma(t), t = 0..maxlag, pooled over streams (each stream contributes N_r - t pairs)."""
    if mean is None:
        mean = sum(s.sum() for s in streams) / sum(s.size for s in streams)
    num = np.zeros(maxlag + 1)
    den = np.zeros(maxlag + 1)
    for s in streams:
        d = s - mean
        n = d.size
        k = min(maxlag, n - 1)
        nfft = 1
        while nfft < 2 * n:
            nfft *= 2
        f = np.fft.rfft(d, nfft)
        ac = np.fft.irfft(f * np.conj(f), nfft)[: k + 1]
        num[: k + 1] += ac
        den[: k + 1] += n - np.arange(k + 1)
    return num / np.maximum(den, 1)


def tau_windows(streams, windows, c=5.0, maxlag=None):
    """tau_int at the automatic Sokal window (W >= c tau) and at fixed windows.
    Returns dict(auto=(tau, dtau, W), fixed={W: (tau, dtau)}, var, N)."""
    N = sum(s.size for s in streams)
    nmin = min(s.size for s in streams)
    if maxlag is None:
        maxlag = min(nmin // 2, max(max(windows), 50))
    g = acf(streams, maxlag)
    rho = g / g[0]
    tau = 0.5 + np.cumsum(rho[1:])
    W = np.arange(1, rho.size)
    ok = np.nonzero(W >= c * np.maximum(tau, 0.5))[0]
    if ok.size:
        i = ok[0]
        auto = (float(tau[i]), float(tau[i] * math.sqrt(2.0 * (2 * W[i] + 1) / N)), int(W[i]))
    else:
        auto = (float(tau[-1]), float("inf"), int(W[-1]))
    fixed = {}
    for w in windows:
        if w <= maxlag:
            fixed[w] = (float(tau[w - 1]), float(max(tau[w - 1], 0.5) * math.sqrt(2.0 * (2 * w + 1) / N)))
    return {"auto": auto, "fixed": fixed, "var": float(g[0]), "N": N, "rho": rho}


def fmt(v, e):
    """value(error) with 2 significant digits of the error."""
    if not (np.isfinite(v) and np.isfinite(e)) or e <= 0:
        return "%.5g(%s)" % (v, e)
    d = max(0, 1 - int(math.floor(math.log10(e))))
    return "%.*f(%d)" % (d, v, int(round(e * 10 ** d)))


# ------------------------------------------------------------------------------------------
# one-stop: projected series for an ensemble (cached)
# ------------------------------------------------------------------------------------------
def channel_series(name, channel, vec_from=None, single=None):
    """Per-stream series for the GEVP-projected operator of `channel` ('glue' or 'torelon').

    vec_from: ensemble name whose full sample defines the operator subset and vector (default:
    the ensemble itself).  single: operator index -> use that single operator instead.
    Returns dict(a=[(n, T/2+1)...], b=[(n,G)...], T, sel, w, ref, meta=[...], C=full corr).
    """
    tag = "%s__%s__%s__%s" % (name, channel, vec_from or "self", "gevp" if single is None else "op%d" % single)
    fn = os.path.join(CACHE, tag + ".npz")
    if os.path.exists(fn):
        with np.load(fn, allow_pickle=False) as d:
            ns = int(d["ns"])
            return {"a": [d["a%d" % i] for i in range(ns)], "b": [d["b%d" % i] for i in range(ns)],
                    "plaq": [d["p%d" % i] for i in range(ns)],
                    "T": int(d["T"]), "sel": [int(x) for x in d["sel"]], "w": d["w"], "ref": d["ref"],
                    "C": d["C"], "meta": json.loads(str(d["meta"])), "L": int(d["L"]), "D": int(d["D"])}
    key = "glue" if channel == "glue" else "torelon"
    sub = channel == "glue"
    st = load(name)
    src = st if vec_from is None else load(vec_from)
    C, ref = full_corr([s[key] for s in src], sub)
    if single is None:
        sel, q = select_ops(C)
        w, lam = gevp_vector(C, sel)
    else:
        sel = [int(single)]
        w = np.array([1.0 / math.sqrt(C[single, single, 0])])
    if vec_from is not None and sub:
        # the reference shift is only numerical conditioning; use own data's mean
        _, ref = full_corr([s[key] for s in st], sub)
    A, Bv = [], []
    for s in st:
        P = project(s[key], sel, w, ref if sub else None)
        a, b = ab_series(P)
        A.append(a)
        Bv.append(b)
    T = st[0][key].shape[-1]
    meta = [s["meta"] for s in st]
    L = meta[0]["shape"][1]
    D = len(meta[0]["shape"])
    out = {"ns": len(st), "T": T, "sel": np.array(sel), "w": w,
           "ref": ref if ref is not None else np.zeros(1), "C": C, "meta": json.dumps(meta),
           "L": L, "D": D}
    for i in range(len(st)):
        out["a%d" % i] = A[i]
        out["b%d" % i] = Bv[i]
        out["p%d" % i] = st[i]["plaq"]
    os.makedirs(CACHE, exist_ok=True)
    np.savez(fn, **out)
    return {"a": A, "b": Bv, "plaq": [s["plaq"] for s in st], "T": T, "sel": sel, "w": w, "ref": ref,
            "C": C, "meta": meta, "L": L, "D": D}


def binned_meff(ser, B, subtract, tmax=3, discard=0, streams=None):
    """jackknife (bins of B within streams) of m_eff(t), t = 0..tmax, fixed projection vector.
    Returns (m, err, samples, nb)."""
    T = ser["T"]
    idx = range(len(ser["a"])) if streams is None else streams
    ab = np.concatenate([bins_of(ser["a"][i][discard:], B) for i in idx])
    bb = np.concatenate([bins_of(ser["b"][i][discard:], B) for i in idx])

    def f(am, bm):
        C = conn(am, bm, subtract)
        return np.array([meff_cosh(C[t], C[t + 1], t, T) for t in range(tmax + 1)])

    m, e, s = jk(f, ab, bb)
    return m, e, s, ab.shape[0]


def lin_series(ser, subtract, t):
    """Linearised per-configuration series whose mean-error is the error of the log effective
    mass m(t) = ln C(t)/C(t+1) (fixed vector).  Returns list of 1-d arrays (one per stream) and
    the central value."""
    N = sum(a.shape[0] for a in ser["a"])
    am = sum(a.sum(axis=0) for a in ser["a"]) / N
    bm = sum(b.sum(axis=0) for b in ser["b"]) / N            # (G,)
    C = conn(am, bm, subtract)
    out = []
    for a, b in zip(ser["a"], ser["b"]):
        if subtract:
            corr = 2.0 * np.mean(bm[None, :] * (b - bm[None, :]), axis=1)
            c0 = a[:, t] - corr
            c1 = a[:, t + 1] - corr
        else:
            c0 = a[:, t]
            c1 = a[:, t + 1]
        out.append(c0 / C[t] - c1 / C[t + 1])
    return out, math.log(C[t] / C[t + 1]), C
