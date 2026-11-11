"""Exact and analytic reference results for SU(2) lattice gauge theory (Wilson action).

Conventions (see ym/lattice.py):  S = beta * sum_p (1 - (1/2) Tr U_p),  weight exp(-S),
"plaquette" P = <(1/2) Tr U_p>.

Character expansion of the one-plaquette Boltzmann factor (theta = class angle of U,
(1/2) Tr U = cos(theta), chi_j = SU(2) character of spin j, d_j = 2j + 1):

    exp(beta * cos(theta)) = sum_j  d_j * f_j(beta) * chi_j(U),
    f_j(beta) = (2 / beta) * I_{2j+1}(beta),
    lambda_j(beta) = f_j / f_0 = I_{2j+1}(beta) / I_1(beta),

so the fundamental coefficient is  u(beta) = lambda_{1/2} = I_2(beta) / I_1(beta).

Status of the formulas in this module
-------------------------------------
* D = 2 results (plaquette, Wilson loops, torelon correlator) are EXACT.  The plain versions
  (``plaquette_2d``, ``wilson_loop_2d``, ``torelon_correlator_2d``) are the infinite-volume /
  leading-representation formulas; the ``*_torus`` versions are exact on a finite periodic
  lattice (sum over all representations, heat-kernel-like gluing formula) and differ from the
  plain ones only by terms that are exponentially small in the number of plaquettes.
* ``plaquette_strong_coupling`` is a truncated strong-coupling SERIES (not exact).
* ``a_lambda_two_loop`` is the two-loop perturbative asymptotic-scaling formula (not exact).

None of this is, or is claimed to be, a proof of anything about continuum Yang-Mills theory.
"""
from __future__ import annotations

import numpy as np
from scipy.special import ive

__all__ = [
    "u", "du_dbeta", "lambda_j",
    "plaquette_2d", "wilson_loop_2d", "string_tension_2d",
    "torelon_correlator_2d", "torelon_energy_2d",
    "plaquette_2d_torus", "wilson_loop_2d_torus", "torelon_correlator_2d_torus",
    "plaquette_strong_coupling", "strong_coupling_terms",
    "B0_SU2", "B1_SU2", "a_lambda_two_loop",
]

_SMALL = 1e-4  # below this beta the Bessel ratios are replaced by their Taylor series


# ----------------------------------------------------------------------------------------------
# basic functions
# ----------------------------------------------------------------------------------------------
def u(beta):
    """u(beta) = I_2(beta) / I_1(beta), the fundamental character coefficient.

    Uses exponentially scaled Bessel functions (``scipy.special.ive``), so it is stable for
    arbitrarily large beta; for |beta| < 1e-4 the series beta/4 - beta^3/96 is used (the neglected
    term is beta^5/1536, i.e. relative error < 1e-17).  Scalar in -> float out, array in -> array.

    u is an ODD function of beta (I_2 is even, I_1 is odd); negative arguments are evaluated as
    u(-beta) = -u(beta).  (For SU(2) on a bipartite lattice beta -> -beta maps P -> -P.)  The
    project itself only uses beta >= 0.
    """
    b = np.asarray(beta, dtype=np.float64)
    ab = np.abs(b)
    small = ab < _SMALL
    bs = np.where(small, 1.0, ab)                     # dummy argument where the series is used
    out = np.where(small, b / 4.0 - b ** 3 / 96.0, np.sign(b) * (ive(2, bs) / ive(1, bs)))
    return float(out) if out.ndim == 0 else out


def du_dbeta(beta):
    """u'(beta) = 1 - u^2 - 3 u / beta  (an EVEN function of beta).

    Derivation: I_2' = I_1 - (2/beta) I_2 and I_1' = I_2 + (1/beta) I_1, hence
    u' = I_2'/I_1 - u I_1'/I_1 = 1 - 2u/beta - u^2 - u/beta.  (u'(0) = 1/4.)
    """
    b = np.asarray(beta, dtype=np.float64)
    ab = np.abs(b)
    small = ab < _SMALL
    bs = np.where(small, 1.0, ab)
    us = np.asarray(u(bs))
    out = np.where(small, 0.25 - b ** 2 / 32.0, 1.0 - us ** 2 - 3.0 * us / bs)
    return float(out) if out.ndim == 0 else out


def lambda_j(beta, twoj):
    """lambda_j(beta) = I_{2j+1}(beta) / I_1(beta) for spin j = twoj / 2 (twoj = 0, 1, 2, ...).

    lambda_0 = 1, lambda_{1/2} = u.  Requires beta > 0.
    """
    b = np.asarray(beta, dtype=np.float64)
    out = ive(np.asarray(twoj) + 1, b) / ive(1, b)
    return float(out) if np.ndim(out) == 0 else out


# ----------------------------------------------------------------------------------------------
# D = 2: exact results
# ----------------------------------------------------------------------------------------------
def plaquette_2d(beta):
    """Exact D=2 plaquette <(1/2) Tr U_p> = u(beta) (infinite volume; on a periodic lattice with
    N_p plaquettes the correction is O(N_p-th power of u), see ``plaquette_2d_torus``)."""
    return u(beta)


def wilson_loop_2d(beta, area):
    """Exact D=2 Wilson loop <(1/2) Tr W> = u(beta)^area for a (non self-intersecting) loop
    enclosing ``area`` plaquettes: exact area law."""
    return u(beta) ** np.asarray(area, dtype=np.float64) if np.ndim(area) else u(beta) ** area


def string_tension_2d(beta):
    """Exact D=2 string tension in lattice units, sigma = -ln u(beta)."""
    return -np.log(u(beta))


def torelon_correlator_2d(beta, L, T, tau):
    """Leading-representation D=2 torelon correlator on an L (space) x T (time) torus.

    <p(t) p(t + tau)> with p = (1/2) Tr of the Polyakov loop winding the spatial circle of
    length L:   C(tau) = (1/4) * (u^(L*tau) + u^(L*(T - tau))).
    Corrections are exponentially small (higher representations, see the ``_torus`` version).
    """
    uu = u(beta)
    tau = np.asarray(tau, dtype=np.float64)
    out = 0.25 * (uu ** (L * tau) + uu ** (L * (T - tau)))
    return float(out) if out.ndim == 0 else out


def torelon_energy_2d(beta, L):
    """Exact D=2 torelon (flux-loop) energy E = L * sigma = -L ln u(beta)."""
    return L * string_tension_2d(beta)


def _lam_table(beta, n_max):
    """lambda_j for twoj = 0 .. n_max-1 (decreasing in j; truncated where negligible)."""
    twoj = np.arange(n_max)
    return ive(twoj + 1, float(beta)) / ive(1, float(beta))


def plaquette_2d_torus(beta, n_plaq, n_rep=200):
    """EXACT D=2 plaquette on a periodic lattice (torus) with ``n_plaq`` plaquettes.

    Z = sum_j f_j(beta)^n_plaq  (genus 1: no dimension factors), therefore
    P = (1/n_plaq) d ln Z / d beta = sum_j lambda_j^n_plaq * (f_j'/f_j) / sum_j lambda_j^n_plaq,
    with f_j'/f_j = I_{2j+1}'/I_{2j+1} - 1/beta = I_{2j+2}/I_{2j+1} + 2j/beta.
    The j = 0 term alone gives u(beta).

    Requires beta > 0.  The sum is truncated at ``n_rep`` representations (default 200), which
    is exact to double precision as long as beta * n_plaq is not huge: on a 2x2 torus the
    default is good to 1e-10 at beta = 5e3 and off by 8e-7 at beta = 5e4; pass a larger
    ``n_rep`` for extreme couplings on tiny tori.
    """
    beta = float(beta)
    twoj = np.arange(n_rep)
    with np.errstate(divide="ignore", invalid="ignore", under="ignore"):
        i_n = ive(twoj + 1, beta)
        i_np1 = ive(twoj + 2, beta)
        keep = i_n > 0.0
        lam = np.where(keep, i_n / i_n[0], 0.0)
        logder = np.where(keep, i_np1 / np.where(keep, i_n, 1.0) + twoj / beta, 0.0)
        w = lam ** n_plaq
    return float(np.sum(w * logder) / np.sum(w))


def wilson_loop_2d_torus(beta, area, n_plaq, n_rep=200):
    """EXACT D=2 Wilson loop <(1/2) Tr W> on a torus with ``n_plaq`` plaquettes; the loop is a
    contractible simple loop enclosing ``area`` plaquettes.

    <W> = (1/2) sum_{|j-k|=1/2} (d_j/d_k) lambda_j^area lambda_k^(n_plaq-area)
          / sum_j lambda_j^n_plaq,
    (j = representation inside, k = outside).  Leading term (j=1/2, k=0): u^area.
    """
    lam = _lam_table(beta, n_rep)
    d = np.arange(n_rep) + 1.0
    a_in = float(area)
    a_out = float(n_plaq - area)
    with np.errstate(under="ignore"):
        lin = lam ** a_in
        lout = lam ** a_out
        num = 0.0
        for j in range(n_rep - 1):
            # (inside j+1, outside j) and (inside j, outside j+1); index = twoj
            num += d[j + 1] / d[j] * lin[j + 1] * lout[j] + d[j] / d[j + 1] * lin[j] * lout[j + 1]
        den = np.sum(lam ** float(n_plaq))
    return float(0.5 * num / den)


def torelon_correlator_2d_torus(beta, L, T, tau, n_rep=200):
    """EXACT D=2 torelon correlator on an L x T torus (all representations):

    <p(0) p(tau)> = (1/4) sum_{|j-k|=1/2} lambda_j^(L*tau) lambda_k^(L*(T-tau))
                    / sum_j lambda_j^(L*T).
    Leading terms: (1/4) (u^(L tau) + u^(L (T - tau))).
    """
    lam = _lam_table(beta, n_rep)
    a1 = float(L * tau)
    a2 = float(L * (T - tau))
    with np.errstate(under="ignore"):
        l1 = lam ** a1
        l2 = lam ** a2
        num = np.sum(l1[1:] * l2[:-1] + l1[:-1] * l2[1:])
        den = np.sum(lam ** float(L * T))
    return float(0.25 * num / den)


# ----------------------------------------------------------------------------------------------
# strong-coupling expansion in D dimensions
# ----------------------------------------------------------------------------------------------
def strong_coupling_terms(beta, D):
    """Individual terms of the strong-coupling series of the plaquette in D dimensions.

    Returns (u, t6, t10) with
        t6  = 8 (D-2) u^5 u'            (single 3-cube: ln Z contains (D-2)/3 * 4 u^6 per plaq.)
        t10 = 40 (D-2)(2D-5) u^9 u'     (two cubes sharing a face, 10 plaquettes:
                                         ln Z contains (D-2)(2D-5) * 4 u^10 per plaquette)
    Derivation: a closed surface with the topology of a sphere made of n plaquettes, all in the
    fundamental representation, contributes d^2 u^n = 4 u^n to ln Z (to this order there are no
    disconnected/cumulant corrections, which start at u^12).  Per plaquette there are
    C(D,3)/C(D,2) = (D-2)/3 cubes and C(2(D-2), 2) = (D-2)(2D-5) pairs of cubes sharing that
    plaquette.  P = (1/N_p) d ln Z / d beta.  The next neglected terms are O(u^11 u').
    The t10 term was derived by the engine author and is checked against Monte Carlo in
    tests/test_engine.py; treat both as predictions, not as theorems.
    """
    uu = u(beta)
    up = du_dbeta(beta)
    t6 = 8.0 * (D - 2) * uu ** 5 * up
    t10 = 40.0 * (D - 2) * (2 * D - 5) * uu ** 9 * up
    return uu, t6, t10


def plaquette_strong_coupling(beta, D, order=1):
    """Strong-coupling prediction for the plaquette in D dimensions.

    order=0:  P = u
    order=1:  P = u + 8 (D-2) u^5 u'                              (default; error O(u^9 u'))
    order=2:  P = u + 8 (D-2) u^5 u' + 40 (D-2)(2D-5) u^9 u'       (error O(u^11 u'))

    For D = 2 all corrections vanish and P = u exactly.  The series is only useful for small
    beta (u << 1); at beta = 1.5 in D = 4 the order-2 term is already ~20% of the order-1 term.

    Status of the coefficients: 8 (D-2) and 40 (D-2)(2D-5) are reproduced by a brute-force
    enumeration of closed surfaces and by Monte Carlo (tests/test_engine.py: leading
    coefficient 7.90 +- 0.10 in D = 4 at beta = 1.0; second term (P-u-t6)/t10 = 0.99 +- 0.02 at
    beta = 1.25, where neglected higher orders may contribute several per cent).  Use
    beta <= 1.0 for quantitative checks.

    This is the BULK series.  It does not apply to lattices with two (or more) directions of
    extent 2: surfaces wrapping the small 2x2 torus add terms of lower order (in D = 3 on
    2 x 2 x L: + u^3 u' / 3, see tests/test_adversarial.py).
    """
    uu, t6, t10 = strong_coupling_terms(beta, D)
    if order == 0:
        return uu
    if order == 1:
        return uu + t6
    if order == 2:
        return uu + t6 + t10
    raise ValueError("order must be 0, 1 or 2")


# ----------------------------------------------------------------------------------------------
# two-loop asymptotic scaling, SU(2), D = 4
# ----------------------------------------------------------------------------------------------
#: one- and two-loop beta-function coefficients for SU(N=2):
#: mu dg/dmu = -b0 g^3 - b1 g^5,  b0 = 11 N / (48 pi^2),  b1 = (34/3) N^2 / (16 pi^2)^2.
B0_SU2 = 11.0 / (24.0 * np.pi ** 2)
B1_SU2 = 17.0 / (96.0 * np.pi ** 4)


def a_lambda_two_loop(beta):
    """Two-loop asymptotic-scaling function for SU(2) in D=4:  a * Lambda_L as function of beta.

    a Lambda_L = (b0 g^2)^(-b1/(2 b0^2)) * exp(-1/(2 b0 g^2)),   g^2 = 4/beta
               = (6 pi^2 beta / 11)^(51/121) * exp(-3 pi^2 beta / 11).

    (b1/(2 b0^2) = [17/(96 pi^4)] * [576 pi^4/(2*121)] = 51/121;  1/(2 b0 g^2) = 3 pi^2 beta/11;
    1/(b0 g^2) = 6 pi^2 beta/11.)  Valid only asymptotically for large beta.
    Numerical range: the result is a denormal number above beta of about 263 and underflows to
    exactly 0.0 above about 277 (so its logarithm fails there); irrelevant for lattice work.
    """
    b = np.asarray(beta, dtype=np.float64)
    out = (6.0 * np.pi ** 2 * b / 11.0) ** (51.0 / 121.0) * np.exp(-3.0 * np.pi ** 2 * b / 11.0)
    return float(out) if out.ndim == 0 else out
