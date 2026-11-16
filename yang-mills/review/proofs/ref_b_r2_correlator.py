"""Second-round referee check of BEWIJZEN.md: the exact finite-N Polyakov-loop correlator that
follows from Stelling A point 5 and Stelling B, compared with the independent code in
ym/exact.py and with a Monte Carlo run of the repository's own engine (ym/lattice.py).

Run from /home/user/frisoj/yang-mills:  python3 review/proofs/ref_b_r2_correlator.py

DERIVATION (referee's own).  D = 2, ring of L sites, N time slices, F = chi_{1/2} o h = Tr h.
F is bounded and gauge invariant, so multiplication by F maps H_inv into itself.  By Stelling B
(points 1-3) {chi_j o h} is an orthonormal eigenbasis of T on H_inv, T chi_j o h =
Lambda_j chi_j o h, Lambda_j = Lambda_0 lam_j^L, lam_j = I_{2j+1}(beta)/I_1(beta), and T = 0 on
the complement.  With chi_{1/2} chi_j = chi_{j+1/2} + chi_{j-1/2} (second term absent for j = 0;
this is 2 cos(th) sin(n th) = sin((n+1) th) + sin((n-1) th)), Stelling A point 5 gives for
1 <= t <= N-1, taking the trace in that eigenbasis,

  <Tr h(u^0) Tr h(u^t)> = Tr(F T^t F T^(N-t)) / Tr T^N
     = sum_j Lambda_j^(N-t) <F chi_j, T^t F chi_j> / sum_j Lambda_j^N
     = sum_{j>=0} [ lam_j^(L(N-t)) lam_{j+1/2}^(L t) + lam_{j+1/2}^(L(N-t)) lam_j^(L t) ]
       / sum_{j>=0} lam_j^(L N).                                                        (*)

With p = (1/2) Tr h this is 4 x ym.exact.torelon_correlator_2d_torus(beta, L, N, t); the j = 0
terms alone give 4 x ym.exact.torelon_correlator_2d = u^(L t) + u^(L (N - t)), and for
N -> infinity (*) -> u^(L t) = exp(-m t), m = L ln(I_1/I_2), which is C_F(t) of Stelling A.

Checks:
  1. (*) (lam_j from a backward recurrence, no scipy) against ym.exact for many (beta, L, N, t);
     also with the matrix of F computed by quadrature instead of the fusion rule.
  2. ym.exact.u, lambda_j, string_tension_2d, torelon_energy_2d, torelon_correlator_2d against
     Stelling B; N -> infinity.
  3. Point 4: (1/(L N)) d ln Z / d beta against ym.exact.plaquette_2d_torus (analytic derivative
     and a central difference of ln Z).
  4. Monte Carlo with ym.lattice (heat bath; 4 x 4 at beta = 8 where the higher representations
     and the wrap-around terms are far outside the errors; 6 x 4 at beta = 3).
"""
import math
import os
import sys
import time
import numpy as np
from numba import njit

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
from ym import exact  # noqa: E402
from ym import lattice as ymlat  # noqa: E402

ok_all = True
NREP = 160


def ratios(x, nmax):
    """r_n = I_{n+1}(x)/I_n(x), n = 0..nmax-1, by backward recurrence (see ref_b_r2_bessel_limit.py)."""
    n_start = nmax + int(8.0 * math.sqrt(x)) + 60
    r = x / (n_start + 1.0 + math.sqrt(x * x + (n_start + 1.0) ** 2))
    out = [0.0] * nmax
    for n in range(n_start - 1, -1, -1):
        r = 1.0 / (2.0 * (n + 1.0) / x + r)
        if n < nmax:
            out[n] = r
    return np.array(out)


def lam_table(beta, nrep=NREP):
    """lam_j = I_{2j+1}/I_1 for 2j = 0..nrep-1."""
    r = ratios(beta, nrep + 1)
    return np.concatenate([[1.0], np.cumprod(r[1:nrep])])


def corr_theorem(beta, L, N, t):
    lam = lam_table(beta)
    a, b = lam ** (L * t), lam ** (L * (N - t))
    return float(np.sum(b[:-1] * a[1:] + b[1:] * a[:-1]) / np.sum(lam ** (L * N)))


# matrix of multiplication by chi_{1/2} in the basis chi_j, by Gauss-Legendre quadrature
xg, wg = np.polynomial.legendre.leggauss(260)
TH, W = 0.5 * np.pi * (xg + 1), 0.5 * np.pi * wg
NQ = 60
CH = np.array([np.sin((n + 1) * TH) / np.sin(TH) for n in range(NQ)])
FQ = (CH * ((2 / np.pi) * W * np.sin(TH) ** 2 * 2 * np.cos(TH))) @ CH.T


def corr_matrix(beta, L, N, t):
    lam = lam_table(beta, NQ) ** L
    Tt, Tn = np.diag(lam ** t), np.diag(lam ** (N - t))
    return float(np.trace(FQ @ Tt @ FQ @ Tn) / np.sum(lam ** N))


print("1. formula (*) versus 4 * ym.exact.torelon_correlator_2d_torus")
worst, worst_q, count = 0.0, 0.0, 0
for beta in (0.2, 0.9, 2.0, 3.5, 7.0, 16.0, 40.0):
    for L, N in ((3, 3), (3, 5), (4, 4), (5, 3), (6, 9), (12, 4)):
        for t in range(1, N):
            mine = corr_theorem(beta, L, N, t)
            ref = 4.0 * exact.torelon_correlator_2d_torus(beta, L, N, t)
            worst = max(worst, abs(mine / ref - 1.0))
            count += 1
            if beta >= 2.0 and L * N <= 20:        # quadrature noise 1e-14 absolute; needs O(1) values
                worst_q = max(worst_q, abs(corr_matrix(beta, L, N, t) - mine))
ok = worst < 1e-11 and worst_q < 1e-11
ok_all &= ok
print("  %d cases: max relative difference %.2e;  F by quadrature instead of the fusion rule: max abs diff %.2e   %s"
      % (count, worst, worst_q, "ok" if ok else "FAIL"))
symm = max(abs(corr_theorem(b, L, N, t) - corr_theorem(b, L, N, N - t))
           for b in (1.0, 5.0) for L, N in ((3, 5), (4, 6)) for t in range(1, N))
print("  symmetry t <-> N - t of (*): max difference %.1e" % symm)
ok_all &= symm < 1e-14

print("2. ym.exact basic functions versus Stelling B")
worst = 0.0
for beta in (0.05, 0.7, 2.3, 9.0, 60.0):
    r = ratios(beta, 12)
    lam = lam_table(beta, 12)
    worst = max(worst, abs(exact.u(beta) / r[1] - 1.0))                                   # u = I_2/I_1
    worst = max(worst, max(abs(exact.lambda_j(beta, tj) / lam[tj] - 1.0) for tj in range(10)))
    for L in (3, 7):
        m = -L * math.log(r[1])                                                           # L ln(I_1/I_2)
        worst = max(worst, abs(exact.torelon_energy_2d(beta, L) / m - 1.0),
                    abs(L * exact.string_tension_2d(beta) / m - 1.0))
        nbig = int(100.0 / m) + 10            # exp(-m (nbig - t)) < 1e-40: effectively N = infinity
        for t in (1, 2):
            big = corr_theorem(beta, L, nbig, t)
            worst = max(worst, abs(big / math.exp(-m * t) - 1.0),
                        abs(4 * exact.torelon_correlator_2d(beta, L, nbig, t) / math.exp(-m * t) - 1.0))
            lead = r[1] ** (L * t) + r[1] ** (L * (5 - t))                                # j = 0 terms, N = 5
            worst = max(worst, abs(4 * exact.torelon_correlator_2d(beta, L, 5, t) / lead - 1.0))
ok = worst < 1e-11
ok_all &= ok
print("  u, lambda_j, string_tension_2d, torelon_energy_2d, torelon_correlator_2d, N -> infinity: "
      "max relative difference %.2e   %s" % (worst, "ok" if ok else "FAIL"))
print("  size of what the leading-representation formula misses (4 x 4 torus): beta, t, (*), u^(Lt)+u^(L(N-t)), exp(-m t)")
for beta in (3.0, 8.0):
    for t in (1, 2):
        uu = ratios(beta, 2)[1]
        print("     beta = %g, t = %d:  %.6f   %.6f   %.6f" % (beta, t, corr_theorem(beta, 4, 4, t),
                                                              uu ** (4 * t) + uu ** (4 * (4 - t)), uu ** (4 * t)))


def lnZ(beta, L, N):
    """ln Z of point 4,  Z = sum_j ((2/beta) I_{2j+1}(beta))^(L N), with I_1 from its series."""
    i1 = math.fsum((beta / 2.0) ** (2 * k + 1) / (math.factorial(k) * math.factorial(k + 1)) for k in range(80))
    return L * N * math.log(2.0 / beta * i1) + math.log(np.sum(lam_table(beta) ** (L * N)))


def plaquette_from_Z(beta, L, N):
    """(1/(L N)) d ln Z/d beta with d/dbeta ln((2/beta) I_nu) = I_{nu+1}/I_nu + (nu-1)/beta."""
    r = ratios(beta, NREP + 1)
    w = lam_table(beta) ** (L * N)
    twoj = np.arange(NREP)
    return float(np.sum(w * (r[1:NREP + 1] + twoj / beta)) / np.sum(w))


print("3. point 4: plaquette from Z versus ym.exact.plaquette_2d_torus")
worst_a, worst_d = 0.0, 0.0
for beta in (0.4, 1.5, 4.0, 8.0, 14.0):
    for L, N in ((3, 3), (4, 4), (3, 6), (6, 4)):
        pa = plaquette_from_Z(beta, L, N)
        h = 1e-5 * max(1.0, beta)
        pd = (lnZ(beta + h, L, N) - lnZ(beta - h, L, N)) / (2 * h) / (L * N)
        ref = exact.plaquette_2d_torus(beta, L * N)
        worst_a, worst_d = max(worst_a, abs(pa - ref)), max(worst_d, abs(pd - ref))
ok = worst_a < 1e-12 and worst_d < 1e-8
ok_all &= ok
print("  max |difference|: analytic derivative %.1e, central difference of ln Z %.1e   %s"
      % (worst_a, worst_d, "ok" if ok else "FAIL"))


# ---- 4. Monte Carlo with the repository engine ------------------------------------------------
@njit
def mc_blocks(U, up, dn, beta, base, L, nblock, per_block, nskip):
    """Heat-bath sweeps with ym.lattice kernels; returns per-block means of
    p(t0) p(t0 + t) (p = (1/2) Tr of the spatial Polyakov loop, averaged over t0) and of the
    plaquette."""
    nt = base.shape[0]
    corr = np.zeros((nblock, nt))
    plaq = np.zeros(nblock)
    p = np.empty(nt)
    nplaq = U.shape[0]
    for b in range(nblock):
        for _ in range(per_block):
            ymlat.heatbath_sweep_kernel(U, up, dn, beta, nskip)
            ymlat.polyakov_kernel(U, up, 1, L, base, p)
            for dt in range(nt):
                acc = 0.0
                for t0 in range(nt):
                    acc += p[t0] * p[(t0 + dt) % nt]
                corr[b, dt] += acc / nt
            plaq[b] += ymlat.plaquette_sum_kernel(U, up) / nplaq
        for dt in range(nt):
            corr[b, dt] /= per_block
        plaq[b] /= per_block
    return corr, plaq


print("4. Monte Carlo with ym.lattice (axis 0 = time, axis 1 = space), heat bath, blocked errors")
for beta, N, L, nblock, per_block, nskip, seed in ((8.0, 4, 4, 200, 6000, 2, 4101), (3.0, 6, 4, 200, 6000, 2, 4102)):
    t0 = time.time()
    lat = ymlat.Lattice((N, L), beta, seed=seed)
    lat.hot_start()
    lat.heatbath_sweep(2000)
    base = np.ascontiguousarray(np.arange(N * L, dtype=np.int64).reshape(N, L)[:, 0])
    corr, plaq = mc_blocks(lat.U, lat.up, lat.dn, beta, base, L, nblock, per_block, nskip)
    cm, ce = corr.mean(axis=0), corr.std(axis=0, ddof=1) / math.sqrt(nblock)
    pm, pe = plaq.mean(), plaq.std(ddof=1) / math.sqrt(nblock)
    # blocks are long (per_block * nskip sweeps); check that block means are uncorrelated
    c1 = corr[:, 1] - cm[1]
    rho = float(np.sum(c1[1:] * c1[:-1]) / np.sum(c1 * c1))
    print("  beta = %g, N = %d (time) x L = %d (space): %d blocks x %d measurements, %d sweeps apart  [%.0f s]; "
          "lag-1 autocorrelation of block means %.2f" % (beta, N, L, nblock, per_block, nskip, time.time() - t0, rho))
    pref = exact.plaquette_2d_torus(beta, L * N)
    dev = (pm - pref) / pe
    ok_all &= abs(dev) < 4
    print("    plaquette   MC = %.6f +- %.6f   point 4 / plaquette_2d_torus = %.6f   u(beta) = %.6f   dev = %+.2f sigma"
          % (pm, pe, pref, exact.u(beta), dev))
    uu = exact.u(beta)
    for t in range(1, N // 2 + 1):
        th = corr_theorem(beta, L, N, t) / 4.0
        ex = exact.torelon_correlator_2d_torus(beta, L, N, t)
        lead = exact.torelon_correlator_2d(beta, L, N, t)
        dev = (cm[t] - th) / ce[t]
        ok_all &= abs(dev) < 4
        print("    <p(0)p(%d)>  MC = %.6f +- %.6f   (*)/4 = %.6f   exact.py torus = %.6f   leading rep. = %.6f (%+.1f sigma)"
              "   exp(-m t)/4 = %.6f (%+.1f sigma)   dev from (*) = %+.2f sigma"
              % (t, cm[t], ce[t], th, ex, lead, (cm[t] - lead) / ce[t], 0.25 * uu ** (L * t),
                 (cm[t] - 0.25 * uu ** (L * t)) / ce[t], dev))

print("ALL OK" if ok_all else "SOME CHECK FAILED")
