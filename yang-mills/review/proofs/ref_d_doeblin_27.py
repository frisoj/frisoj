#!/usr/bin/env python3
"""Referee D (round 2) -- BEWIJZEN.md section 2.4, remark "wat stelling A niet geeft": formula (2.7).

Part A.  Finite model of the proof of (2.7): a probability space {1..n} with weights mu_i, a symmetric
kernel T_ij > 0, operator (Tf)_i = sum_j T_ij f_j mu_j.  Checked line by line:
  * q_ij = T_ij Omega_j / (lambda_0 Omega_i) > 0, sum_j q_ij mu_j = 1, q phi = (lambda_n/lambda_0) phi;
  * minorisation q_ij >= eps * rho_j with eps = c/C, rho = Omega / sum(Omega mu);
  * (lambda_n/lambda_0)(max phi - min phi) <= (1 - eps)(max phi - min phi) for every n >= 1,
    for kernels that are NOT positive semidefinite as well (lambda_n < 0 allowed: no sign is needed);
  * -ln(1 - x) >= x on [0, 1).

Part B.  SU(2), D = 2, ring of L links (Stelling B).  The kernel of T is
        T(u,u') = sum_j Lambda_j chi_j(h(u)) chi_j(h(u')),   Lambda_j = (2 I_{2j+1}(beta)/beta)^L,
(checked here against a direct Monte Carlo evaluation of  int K(u^g,u') dg  for L = 3).
Then c = min T, C = max T are computed and compared with
  * the true ratio lambda_1/lambda_0 = (I_2/I_1)^L          (must be <= 1 - c/C),
  * the explicit estimate c/C >= exp(-2 beta (|E| + |P_s|)) = exp(-2 beta L).
Result relevant for section 5.3 ("Waarom stelling A niet helpt"): in D = 2 the true c/C tends to 1
as L grows, so (2.7) itself is NOT exponentially small in the number of links there; only the
explicit estimate exp(-2 beta L) is.

Run:  python3 review/proofs/ref_d_doeblin_27.py      (from yang-mills/; a few seconds)
"""
import numpy as np
from scipy.special import iv

rng = np.random.default_rng(20261116)

# ---------------------------------------------------------------- Part A
worst_bound = -np.inf      # lambda_1/lambda_0 - (1 - c/C), must be <= 0
worst_minor = np.inf       # min of q_ij - eps rho_j, must be >= 0
worst_row = 0.0            # |sum_j q_ij mu_j - 1|
worst_eig = 0.0            # |q phi - (lambda_n/lambda_0) phi|
worst_osc = -np.inf        # (lambda_n/lambda_0) osc(phi) - (1-eps) osc(phi), must be <= 0
n_negative = 0
for trial in range(4000):
    n = int(rng.integers(2, 16))
    mu = 0.2 / n + 0.8 * rng.dirichlet(np.ones(n) * rng.uniform(0.3, 3.0))   # weights bounded away from 0 (conditioning)
    kind = trial % 3
    if kind == 0:                                   # generic symmetric positive (not PSD in general)
        A = rng.uniform(0.05, 1.0, size=(n, n)) ** rng.uniform(0.2, 3.0)
        T = (A + A.T) / 2
    elif kind == 1:                                 # positive semidefinite with positive entries
        B = rng.uniform(0.0, 1.0, size=(n, int(rng.integers(1, n + 1))))
        T = B @ B.T + 1e-3
    else:                                           # e^{-V/2} K e^{-V/2}
        x = rng.normal(size=(n, 2))
        T = np.exp(rng.uniform(0.1, 0.5) * np.clip(x @ x.T, -6.0, 6.0))   # moderate dynamic range: eigenvectors accurate
        v = np.exp(0.5 * rng.normal(size=n))
        T = v[:, None] * T * v[None, :]
    s = np.sqrt(mu)
    ev, W = np.linalg.eigh(s[:, None] * T * s[None, :])      # unitarily equivalent to T on L^2(mu)
    lam0 = ev[-1]
    Om = W[:, -1] / s
    Om = Om * np.sign(Om[0])
    assert np.all(Om > 0)
    c, C = T.min(), T.max()
    eps = c / C
    q = T * Om[None, :] / (lam0 * Om[:, None])
    rho = Om / np.sum(Om * mu)
    worst_row = max(worst_row, np.max(np.abs(q @ mu - 1)))
    worst_minor = min(worst_minor, np.min(q - eps * rho[None, :]))
    for k in range(n - 1):                          # all eigenfunctions other than Omega
        psi = W[:, k] / s
        phi = psi / Om
        ratio = ev[k] / lam0
        n_negative += ratio < 0
        worst_eig = max(worst_eig, np.max(np.abs((q * mu[None, :]) @ phi - ratio * phi)))
        osc = phi.max() - phi.min()
        assert osc > 1e-9                           # phi is not constant
        worst_osc = max(worst_osc, (ratio - (1 - eps)) * osc)
        worst_bound = max(worst_bound, ratio - (1 - eps))
print("Part A: 4000 random weighted kernels (1/3 of them positive semidefinite)")
print(f"  max |sum_j q_ij mu_j - 1|                         = {worst_row:.2e}")
print(f"  max |q phi - (lambda_n/lambda_0) phi|             = {worst_eig:.2e}")
print(f"  min (q_ij - eps rho_j)                            = {worst_minor:.3e}   (must be >= 0)")
print(f"  max (lambda_n/lambda_0 - (1 - c/C)) over n >= 1   = {worst_bound:.3e}   (must be <= 0)")
print(f"  number of negative eigenvalues among those tested = {n_negative}  (bound holds without sign condition)")
xs = np.linspace(0.0, 0.999999, 200001)
print(f"  min of -ln(1-x) - x on [0,1)                      = {np.min(-np.log1p(-xs) - xs):.3e}   (must be >= 0)")

# ---------------------------------------------------------------- Part B
def chi(j2, theta):
    """character chi_j with 2j = j2 at class angle theta"""
    n = j2 + 1
    st = np.sin(theta)
    with np.errstate(divide="ignore", invalid="ignore"):
        val = np.where(np.abs(st) > 1e-12, np.sin(n * theta) / st, n * np.cos(theta) ** (n - 1))
    return val


def kernel_series(beta, L, th1, th2, jmax=60):
    tot = 0.0
    for j2 in range(jmax):
        lam = (2.0 * iv(j2 + 1, beta) / beta) ** L
        tot = tot + lam * chi(j2, th1) * chi(j2, th2)
    return tot


def qmul(a, b):
    a0, a1, a2, a3 = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    b0, b1, b2, b3 = b[..., 0], b[..., 1], b[..., 2], b[..., 3]
    return np.stack([a0 * b0 - a1 * b1 - a2 * b2 - a3 * b3,
                     a0 * b1 + a1 * b0 + a2 * b3 - a3 * b2,
                     a0 * b2 - a1 * b3 + a2 * b0 + a3 * b1,
                     a0 * b3 + a1 * b2 - a2 * b1 + a3 * b0], axis=-1)


def qinv(a):
    return a * np.array([1.0, -1.0, -1.0, -1.0])


def haar(size):
    v = rng.normal(size=size + (4,))
    return v / np.linalg.norm(v, axis=-1, keepdims=True)


print("\nPart B: SU(2), D = 2, ring of L links")
L, beta, nsamp = 3, 1.0, 400000
u = haar((L,))
up = haar((L,))
g = haar((nsamp, L))
logK = np.zeros(nsamp)
for i in range(L):
    m = qmul(qmul(qmul(g[:, i], u[i]), qinv(g[:, (i + 1) % L])), qinv(up[i]))
    logK += beta * m[:, 0]                       # (beta/2) Tr = beta * real part
vals = np.exp(logK)
mc, err = vals.mean(), vals.std() / np.sqrt(nsamp)
h = qmul(qmul(u[0], u[1]), u[2])
hp = qmul(qmul(up[0], up[1]), up[2])
series = kernel_series(beta, L, np.arccos(h[0]), np.arccos(hp[0]))
print(f"  L=3, beta=1, random u,u': int K(u^g,u') dg by Monte Carlo = {mc:.5f} +- {err:.5f};"
      f" series = {series:.5f}; deviation = {(mc - series) / err:+.2f} sigma")

th = np.linspace(0.0, np.pi, 401)
T1, T2 = np.meshgrid(th, th, indexing="ij")
print("  beta   L   c/C (true)     1-c/C        lambda_1/lambda_0   exp(-2 beta L)   (2.7) ok   crude ok")
for beta in (0.5, 1.0, 3.0):
    for L in (3, 4, 6, 8, 12):
        Tk = kernel_series(beta, L, T1, T2)
        c, C = Tk.min(), Tk.max()
        ratio = (iv(2, beta) / iv(1, beta)) ** L
        crude = np.exp(-2 * beta * L)
        ok27 = ratio <= 1 - c / C + 1e-12
        okcr = (c / C >= crude) and (c >= np.exp(-beta * L)) and (C <= np.exp(beta * L))
        print(f"  {beta:4.1f}  {L:2d}   {c / C:.8f}   {1 - c / C:.3e}    {ratio:.3e}           {crude:.3e}        {ok27}       {okcr}")
print("  -> in D = 2 the true c/C increases to 1 with L (bound (2.7) improves with the volume);")
print("     only the explicit estimate exp(-2 beta (|E|+|P_s|)) is exponentially small.")
