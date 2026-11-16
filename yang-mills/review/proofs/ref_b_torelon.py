"""Referee check of BEWIJZEN.md: Stelling B (points 2-4) + Stelling A point 5 against the
independent code in ym/exact.py and against a direct Monte Carlo simulation.

Run from the repository root:  python3 review/proofs/ref_b_torelon.py

Derivation checked here.  By Stelling B, T restricted to H_inv is diagonal in the orthonormal
basis chi_j o h with eigenvalues Lambda_j = ((2/beta) I_{2j+1}(beta))^L, and T = 0 on the
complement.  F = chi_{1/2} o h is gauge invariant, so multiplication by F maps H_inv to itself;
in the basis chi_j its matrix is F_kj = <chi_k, chi_{1/2} chi_j> (computed below by quadrature,
it is 1 for |j-k| = 1/2 and 0 otherwise).  Stelling A point 5 then gives, for 1 <= t <= N-1,

    <chi_{1/2}(h^0) chi_{1/2}(h^t)> = Tr(F T^t F T^(N-t)) / Tr T^N
        = sum_{|j-k|=1/2} Lambda_k^t Lambda_j^(N-t) / sum_j Lambda_j^N .                 (*)

With p = (1/2) Tr h = chi_{1/2}(h)/2 and lambda_j = I_{2j+1}/I_1 this is exactly
ym.exact.torelon_correlator_2d_torus (which has the prefactor 1/4).

Checks:
  1. (*) evaluated with explicit matrices against 4 * torelon_correlator_2d_torus.
  2. N -> infinity: C_F(t) = exp(-m t) = u^(L t); ym.exact.torelon_correlator_2d.
  3. Z of point 4: (1/(L N)) d ln Z / d beta against ym.exact.plaquette_2d_torus;
     m = L * string_tension_2d = torelon_energy_2d.
  4. Monte Carlo (own vectorised heat bath, independent replicas, honest lattices with
     L, N >= 3 including odd sizes that ym.lattice does not support) against (*).
"""
import os
import sys
import time
import numpy as np
from scipy.special import ive, eval_chebyu

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
from ym import exact  # noqa: E402

ok_all = True
JMAX = 80


def lam_ratio(beta, L):
    """(Lambda_j / Lambda_0), 2j = 0..JMAX-1."""
    twoj = np.arange(JMAX)
    return (ive(twoj + 1, beta) / ive(1, beta)) ** L


xg, wg = np.polynomial.legendre.leggauss(300)
TH, W = 0.5 * np.pi * (xg + 1), 0.5 * np.pi * wg
CH = np.array([eval_chebyu(t, np.cos(TH)) for t in range(JMAX)])
# F_kj = <chi_k, chi_{1/2} chi_j> with the Weyl measure (2/pi) sin^2
F = (CH * ((2 / np.pi) * W * np.sin(TH) ** 2 * CH[1])) @ CH.T
Fexact = np.diag(np.ones(JMAX - 1), 1) + np.diag(np.ones(JMAX - 1), -1)
print("0. matrix of multiplication by chi_{1/2}: max |F - (1 on |j-k| = 1/2)| = %.2e"
      % np.max(np.abs(F - Fexact)))
ok_all &= np.max(np.abs(F - Fexact)) < 1e-11
# From here on use the exact 0/1 matrix: the quadrature noise (1e-14) in the entries that should
# vanish would otherwise swamp correlators that are themselves as small as 1e-70 (small beta).
F = Fexact


def corr_from_theorems(beta, L, N, t):
    lam = lam_ratio(beta, L)
    Tm = np.diag(lam)
    num = np.trace(F @ np.linalg.matrix_power(Tm, t) @ F @ np.linalg.matrix_power(Tm, N - t))
    return num / np.sum(lam ** N)


print("1. Tr(F T^t F T^(N-t)) / Tr T^N  versus  4 * ym.exact.torelon_correlator_2d_torus")
worst = 0.0
for beta in (0.3, 1.0, 2.0, 3.0, 6.0, 12.0):
    for L, N in ((3, 3), (3, 4), (4, 3), (5, 7), (8, 8), (3, 12)):
        for t in range(1, N):
            a = corr_from_theorems(beta, L, N, t)
            b = 4.0 * exact.torelon_correlator_2d_torus(beta, L, N, t)
            worst = max(worst, abs(a - b) / abs(b))
print("  max relative difference over 6 beta x 6 lattices x all t: %.2e  %s"
      % (worst, "ok" if worst < 1e-11 else "FAIL"))
ok_all &= worst < 1e-11

print("2. N -> infinity (Stelling A point 5 with F Omega = psi_1): C_F(t) = exp(-m t) = u^(L t)")
worst = 0.0
ok_m = True
for beta in (1.0, 2.5, 6.0):
    for L in (3, 5):
        m = L * np.log(ive(1, beta) / ive(2, beta))
        ok_m &= abs(m - exact.torelon_energy_2d(beta, L)) < 1e-12 * m
        ok_m &= abs(m - L * exact.string_tension_2d(beta)) < 1e-12 * m
        for t in (1, 2, 3):
            big = corr_from_theorems(beta, L, 400, t)          # N = 400: effectively infinite
            worst = max(worst, abs(big - np.exp(-m * t)) / np.exp(-m * t),
                        abs(4 * exact.torelon_correlator_2d(beta, L, 400, t) - np.exp(-m * t)) / np.exp(-m * t))
print("  max relative difference: %.2e  %s   (m = L ln(I1/I2) = L * string_tension_2d: %s)"
      % (worst, "ok" if worst < 1e-10 else "FAIL", "ok" if ok_m else "FAIL"))
ok_all &= worst < 1e-10 and ok_m


def lnZ(beta, L, N):
    """ln of Z = sum_j ((2/beta) I_{2j+1}(beta))^(L N)   (point 4), overflow-safe."""
    return L * N * (beta + np.log(2.0 / beta * ive(1, beta))) + np.log(np.sum(lam_ratio(beta, L) ** N))


print("3. point 4: (1/(L N)) d ln Z / d beta  versus  ym.exact.plaquette_2d_torus")
worst = 0.0
for beta in (0.5, 1.5, 4.0, 8.0):
    for L, N in ((3, 3), (3, 4), (4, 6)):
        h = 1e-5
        P = (lnZ(beta + h, L, N) - lnZ(beta - h, L, N)) / (2 * h) / (L * N)
        ref = exact.plaquette_2d_torus(beta, L * N)
        worst = max(worst, abs(P - ref))
        if (L, N) == (3, 3):
            print("  beta = %-4g 3x3:  from Z of point 4: %.10f   plaquette_2d_torus: %.10f   u(beta): %.10f"
                  % (beta, P, ref, exact.u(beta)))
print("  max |difference| (central difference, h = 1e-5): %.2e  %s" % (worst, "ok" if worst < 1e-8 else "FAIL"))
ok_all &= worst < 1e-8

# ------------------------------------------------------------------------------------------
print("4. Monte Carlo: SU(2), D = 2, own heat bath, independent replicas")


def qmul(a, b):
    out = np.empty_like(a)
    out[:, 0] = a[:, 0] * b[:, 0] - a[:, 1] * b[:, 1] - a[:, 2] * b[:, 2] - a[:, 3] * b[:, 3]
    out[:, 1] = a[:, 0] * b[:, 1] + b[:, 0] * a[:, 1] - (a[:, 2] * b[:, 3] - a[:, 3] * b[:, 2])
    out[:, 2] = a[:, 0] * b[:, 2] + b[:, 0] * a[:, 2] - (a[:, 3] * b[:, 1] - a[:, 1] * b[:, 3])
    out[:, 3] = a[:, 0] * b[:, 3] + b[:, 0] * a[:, 3] - (a[:, 1] * b[:, 2] - a[:, 2] * b[:, 1])
    return out


def dag(a):
    out = a.copy()
    out[:, 1:] *= -1.0
    return out


def heatbath(rng, beta, A):
    """New link U with density prop. to exp((beta/2) Tr(U A)), A = sum of staples (R,4)."""
    k = np.linalg.norm(A, axis=1)
    Wd = dag(A / k[:, None])
    alpha = beta * k
    R = len(k)
    x0 = np.empty(R)
    todo = np.arange(R)
    while len(todo):                                   # Creutz' algorithm, vectorised rejection
        al = alpha[todo]
        r = rng.random(len(todo))
        x = 1.0 + np.log(np.exp(-2 * al) + r * (1.0 - np.exp(-2 * al))) / al
        acc = rng.random(len(todo)) ** 2 <= 1.0 - x * x
        x0[todo[acc]] = x[acc]
        todo = todo[~acc]
    v = rng.normal(size=(R, 3))
    v *= (np.sqrt(np.maximum(0.0, 1.0 - x0 * x0)) / np.linalg.norm(v, axis=1))[:, None]
    X = np.concatenate([x0[:, None], v], axis=1)
    return qmul(X, Wd)                                 # U W = X  =>  U = X W^dagger


def simulate(beta, L, N, R, ntherm, nmeas, seed):
    rng = np.random.default_rng(seed)
    # Us[t][x]: link (x,t) -> (x+1,t);  Ut[t][x]: link (x,t) -> (x,t+1);  hot start
    def haar():
        q = rng.normal(size=(R, 4))
        return q / np.linalg.norm(q, axis=1)[:, None]
    Us = [[haar() for x in range(L)] for t in range(N)]
    Ut = [[haar() for x in range(L)] for t in range(N)]
    csum = np.zeros((R, N))
    psum = np.zeros(R)
    for sweep in range(ntherm + nmeas):
        for t in range(N):
            tp, tm = (t + 1) % N, (t - 1) % N
            for x in range(L):
                xp, xm = (x + 1) % L, (x - 1) % L
                # spatial link: plaquettes (x,t) and (x,t-1)
                A = qmul(qmul(Ut[t][xp], dag(Us[tp][x])), dag(Ut[t][x])) \
                    + qmul(qmul(dag(Ut[tm][xp]), dag(Us[tm][x])), Ut[tm][x])
                Us[t][x] = heatbath(rng, beta, A)
                # temporal link: plaquettes (x,t) and (x-1,t)
                B = qmul(qmul(Us[tp][x], dag(Ut[t][xp])), dag(Us[t][x])) \
                    + qmul(qmul(dag(Us[tp][xm]), dag(Ut[t][xm])), Us[t][xm])
                Ut[t][x] = heatbath(rng, beta, B)
        if sweep >= ntherm:
            chi = np.empty((R, N))
            for t in range(N):
                h = Us[t][0]
                for x in range(1, L):
                    h = qmul(h, Us[t][x])
                chi[:, t] = 2.0 * h[:, 0]              # chi_{1/2}(h^t) = Tr h^t
            for dt in range(N):
                csum[:, dt] += np.mean(chi * np.roll(chi, -dt, axis=1), axis=1)
            pl = 0.0
            for t in range(N):
                for x in range(L):
                    p = qmul(qmul(qmul(Us[t][x], Ut[t][(x + 1) % L]), dag(Us[(t + 1) % N][x])), dag(Ut[t][x]))
                    pl = pl + p[:, 0]
            psum += pl / (L * N)
    c = csum / nmeas
    p = psum / nmeas
    return c.mean(axis=0), c.std(axis=0, ddof=1) / np.sqrt(R), p.mean(), p.std(ddof=1) / np.sqrt(R)


for beta, L, N, R, nth, nme, seed in ((2.0, 3, 3, 3000, 150, 1000, 11), (3.0, 3, 4, 2500, 200, 900, 12)):
    t0 = time.time()
    c, ce, p, pe = simulate(beta, L, N, R, nth, nme, seed)
    print("  beta = %g, L = %d (space), N = %d (time), %d replicas x %d sweeps  [%.0f s]"
          % (beta, L, N, R, nme, time.time() - t0))
    pref = exact.plaquette_2d_torus(beta, L * N)
    dev = (p - pref) / pe
    ok_all &= abs(dev) < 4
    print("    plaquette      MC = %.5f +- %.5f   exact torus = %.5f   (u = %.5f)   dev = %+.2f sigma"
          % (p, pe, pref, exact.u(beta), dev))
    lam = lam_ratio(beta, L)
    c0 = (lam[0] ** N + 2 * np.sum(lam[1:] ** N)) / np.sum(lam ** N)       # t = 0: <chi^2>
    dev = (c[0] - c0) / ce[0]
    ok_all &= abs(dev) < 4
    print("    t = 0          MC = %.5f +- %.5f   <chi_{1/2}(h)^2> from point 4 basis = %.5f   dev = %+.2f sigma"
          % (c[0], ce[0], c0, dev))
    for t in range(1, N):
        th = corr_from_theorems(beta, L, N, t)
        lead_inf = np.exp(-t * L * np.log(ive(1, beta) / ive(2, beta)))     # N = infinity: e^{-m t}
        dev = (c[t] - th) / ce[t]
        ok_all &= abs(dev) < 4
        print("    t = %d          MC = %.5f +- %.5f   formula (*) = %.5f   e^{-m t} = %.5f "
              "(%.1f sigma away)   dev = %+.2f sigma" % (t, c[t], ce[t], th, lead_inf, abs(c[t] - lead_inf) / ce[t], dev))

print("ALL OK" if ok_all else "SOME CHECK FAILED")
