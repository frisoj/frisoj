"""Numerical checks of the proof of Stelling C (strong coupling) in BEWIJZEN.md.

Numerical evidence for the individual steps of the proof; not a proof.

Laboratory.  Most tests use Z2 lattice gauge theory: G = {+1, -1} with the normalised counting
measure as Haar measure and weight  w = exp(beta * sum_p sigma_p),  sigma_p the product of the four
link signs of the plaquette p.  This is the SU(2) weight exp((beta/2) sum_p Tr U_p) of section 1.3
restricted to the centre of SU(2).  The proof of Stelling C uses of the group only |Tr| <= 2, so
every statement of section 4 must hold in this laboratory with the same constants
(alpha = 6 (D-1) tanh beta).  On small lattices everything is computed exactly by enumeration:
a function on the configuration space is an array of shape (2,)*n (index 0 <-> +1, index 1 <-> -1).

The general lemmas of section 4.2 are also tested on other finite systems (class ``System`` accepts
any strictly positive probability mass function on a finite product space), and Lemma C.5 for the
real group SU(2) is tested by quadrature on S^3.

Sections of this file follow the numbering C1 ... C10 of the review task:
  C1  Lemma C.1                      C6  Propositie C.6 (and section 4.3)
  C2  geometry (1.2, 4.5)            C7  Stelling C point 1
  C3  Lemma C.5 for SU(2), 5.3       C8  Stelling C point 2 (transfer matrix gap)
  C4  Lemma C.5 (Z2, exact)          C9  the numbers in the document
  C5  Lemmas C.2, C.3, C.4           C10 Stelling C point 3

Conventions.  A test asserts what the document claims and no more.  Where a stronger fact is
observed (a bound that happens to be attained, a closed form of the laboratory) it is either only
recorded with ``note`` or, where it serves to validate the code, asserted with a comment saying
that it is a laboratory value and not a claim of the document.  Numbers printed in the document
are read from BEWIJZEN.md itself, so that these tests fail if text and computation drift apart.
Tolerances: ``FP`` for exact enumerations of quantities of order one; anything else is justified
where it is used.

How sharp the tests are.  The lemmas of section 4.2 are tested at or near equality (Lemma C.1,
C.2, C.3(a), C.3(c): ratio 1.000; Lemma C.4: 0.5 to 0.83; (4.2): 0.95; Lemma C.5 for Z2: 0.9975).
The end results are far from sharp in the Z2 laboratory, as the document itself says of the
bound: Propositie C.6 ratio 0.04, point 1 ratio 0.02, point 2 gap/bound >= 5.5, point 3 ratio
1e-40 (finite-volume corrections) and 0.01 (covariance in infinite volume).  A wrong constant in
those would only be detected beyond these factors; the decay RATE of
Propositie C.6 is probed separately on a tree (test_c6_decay_rate_of_proposition_c6_on_a_tree).
review/proofs/r2_test_c_mutations.py perturbs the formulas under test one by one and lists which
perturbations these tests detect.

Run from yang-mills/:   python3 -m pytest tests/test_proofs_c.py -q            (about half a minute)
                        python3 -m pytest tests/test_proofs_c.py -q --runslow  (about two minutes)
Add ``-s`` to see the key numbers (largest ratios left/right side) collected by the tests.
"""
import itertools
import math
import re
from collections import deque
from fractions import Fraction
from functools import lru_cache
from pathlib import Path

import numpy as np
import pytest
from numpy.polynomial.legendre import leggauss
from scipy import special
from scipy.optimize import brentq, minimize, minimize_scalar
from scipy.sparse.linalg import LinearOperator, eigsh

DOC = Path(__file__).resolve().parents[1] / "BEWIJZEN.md"


@lru_cache(maxsize=None)
def gauss_legendre(n):
    """nodes and weights of the n-point Gauss-Legendre rule on [-1, 1] (cached; read-only)."""
    return leggauss(n)

FP = 1e-12            # floating-point slack for quantities of order one (all computations are exact
                      # enumerations; nothing is sampled except the test functions)

REPORT = {}           # key numbers, printed at the end of the module when pytest runs with -s


def note(key, value):
    REPORT[key] = value


@pytest.fixture(scope="module", autouse=True)
def _print_report():
    yield
    if REPORT:
        print("\n--- key numbers collected by tests/test_proofs_c.py ---")
        for key, value in REPORT.items():
            print(f"{key}: {value}")


# ======================================================================================
# constants of section 4.1
# ======================================================================================
def alpha(beta, D):
    """alpha(beta, D) = 6 (D-1) tanh beta  (section 4.1)."""
    return 6 * (D - 1) * math.tanh(beta)


def beta0(D):
    """beta_0(D) = artanh(1 / (6 (D-1)))  (section 4.1)."""
    return math.atanh(1.0 / (6 * (D - 1)))


def c_theta(al, theta):
    """C_theta = e^theta / (1 - alpha e^theta)  (Stelling C), defined for alpha e^theta < 1."""
    lam = al * math.exp(theta)
    assert lam < 1.0
    return math.exp(theta) / (1.0 - lam)


def theta_grid(al):
    """several theta in (0, ln(1/alpha))."""
    return [fr * math.log(1.0 / al) for fr in (0.02, 0.25, 0.5, 0.75, 0.98)]


# ======================================================================================
# geometry of section 1.2
# ======================================================================================
class Torus:
    """Periodic lattice prod_mu Z/L_mu with the conventions of section 1.2.

    Link (x, mu) has index  site_index(x) * D + mu.  The plaquette (x; mu, nu), mu < nu, is stored
    as the 4-tuple of its links (x,mu), (x+mu,nu), (x+nu,mu), (x,nu), in that order.
    """

    def __init__(self, shape):
        self.shape = tuple(shape)
        self.D = len(self.shape)
        self.sites = list(itertools.product(*[range(n) for n in self.shape]))
        self.sidx = {x: i for i, x in enumerate(self.sites)}
        self.nl = len(self.sites) * self.D
        self.plaq, self.plaq_label = [], []
        for x in self.sites:
            for mu in range(self.D):
                for nu in range(mu + 1, self.D):
                    self.plaq.append((self.link(x, mu), self.link(self.shift(x, mu), nu),
                                      self.link(self.shift(x, nu), mu), self.link(x, nu)))
                    self.plaq_label.append((x, mu, nu))
        self.through = [[] for _ in range(self.nl)]          # plaquettes containing each link
        for ip, p in enumerate(self.plaq):
            for l in set(p):
                self.through[l].append(ip)
        self.ncommon = [dict() for _ in range(self.nl)]      # n_{lk} for k != l (only entries >= 1)
        for p in self.plaq:
            for a in set(p):
                for b in set(p):
                    if a != b:
                        self.ncommon[a][b] = self.ncommon[a].get(b, 0) + 1

    def shift(self, x, mu, s=1):
        y = list(x)
        y[mu] = (y[mu] + s) % self.shape[mu]
        return tuple(y)

    def link(self, x, mu):
        return self.sidx[tuple(x)] * self.D + mu

    def n(self, l, k):
        """n_{lk}: number of plaquettes containing both l and k (section 1.2, (R2))."""
        return self.ncommon[l].get(k, 0)

    def bfs(self, sources):
        """link distance d(k, sources) for every link k (-1 = unreachable), by breadth-first search
        over the neighbour relation n_{lk} >= 1."""
        d = np.full(self.nl, -1, dtype=int)
        queue = deque()
        for s in sources:
            if d[s] < 0:
                d[s] = 0
                queue.append(s)
        while queue:
            a = queue.popleft()
            for b in self.ncommon[a]:
                if d[b] < 0:
                    d[b] = d[a] + 1
                    queue.append(b)
        return d


@lru_cache(maxsize=None)
def torus(shape):
    return Torus(shape)


def layer_links(lat, t):
    """spatial links of time layer t (time = last direction): the set called A, B in section 4.5."""
    D = lat.D
    return [lat.link(x, mu) for x in lat.sites if x[D - 1] == t for mu in range(D - 1)]


# ======================================================================================
# functions on finite product spaces; the framework ("Kader") of section 4.2
# ======================================================================================
def sgn(n, k, dtype=float):
    """the coordinate function U -> U_k in {+1, -1} as an array broadcastable to shape (2,)*n."""
    sh = [1] * n
    sh[k] = 2
    return np.array([1, -1], dtype=dtype).reshape(sh)


def link_product(n, links, dtype=float):
    """the function U -> prod_{l in links} U_l as an array broadcastable to shape (2,)*n."""
    f = np.ones((1,) * n, dtype=dtype)
    for l in links:
        f = f * sgn(n, l, dtype)
    return f


def embed(table, axes, n):
    """a function of the variables ``axes`` (table has one axis per entry of ``axes``, in that
    order) as an array broadcastable to an n-dimensional array."""
    table = np.asarray(table)
    order = np.argsort(axes)
    t = np.transpose(table, order)
    sh = [1] * n
    for a, size in zip(np.sort(axes), t.shape):
        sh[a] = size
    return t.reshape(sh)


def delta(f, k):
    """delta_k(f) = sup |f(U) - f(U')| over U, U' that differ only in variable k (section 4.1)."""
    if f.shape[k] == 1:
        return 0.0
    if f.shape[k] == 2:
        i0 = [slice(None)] * f.ndim
        i1 = list(i0)
        i0[k], i1[k] = 0, 1
        return float(np.abs(f[tuple(i0)] - f[tuple(i1)]).max())
    return float((f.max(axis=k) - f.min(axis=k)).max())


def delta_vec(f):
    return np.array([delta(f, k) for k in range(f.ndim)])


def osc(f):
    return float(f.max() - f.min())


class System:
    """Finite version of the framework of section 4.2: X = prod_l {0..q_l - 1}, pi a probability
    measure with strictly positive mass function p (an array with one axis per "link")."""

    def __init__(self, p):
        p = np.asarray(p, dtype=float)
        assert p.min() > 0.0
        self.p = p / p.sum()
        self.n = p.ndim
        self.shape = p.shape
        self._cond = {}
        self._c = None

    def cond(self, l):
        """rho_l(V | U) as an array of the full shape: entry at U is rho_l(U_l | rest of U)."""
        c = self._cond.get(l)
        if c is None:
            c = self.p / self.p.sum(axis=l, keepdims=True)
            self._cond[l] = c
        return c

    def Pi(self, l, f):
        """(Pi_l f)(U) = sum_V f(U^{l->V}) rho_l(V | U); the result has a length-1 axis l."""
        return (f * self.cond(l)).sum(axis=l, keepdims=True)

    def mean(self, f):
        return float((self.p * f).sum())

    def sweep(self, order, f):
        """a round S f = Pi_{l_n} ... Pi_{l_1} f for order = (l_1, ..., l_n)."""
        for l in order:
            f = self.Pi(l, f)
        return f

    def coeff(self, l, k):
        """Dobrushin coefficient c_{lk}: sup over pairs differing only at k of the total-variation
        distance between rho_l(.|U) and rho_l(.|U')."""
        c = self.cond(l)
        la = l if l < k else l - 1          # position of axis l after axis k is indexed away
        best = 0.0
        for a in range(self.shape[k]):
            ia = [slice(None)] * self.n
            ia[k] = a
            for b in range(a + 1, self.shape[k]):
                ib = list(ia)
                ib[k] = b
                tv = 0.5 * np.abs(c[tuple(ia)] - c[tuple(ib)]).sum(axis=la)
                best = max(best, float(tv.max()))
        return best

    @property
    def c(self):
        """matrix of Dobrushin coefficients, c[l, k] = c_{lk}, c[l, l] = 0."""
        if self._c is None:
            c = np.zeros((self.n, self.n))
            for l in range(self.n):
                for k in range(self.n):
                    if k != l:
                        c[l, k] = self.coeff(l, k)
            self._c = c
        return self._c


def local_function(rng, shape, axes):
    """random function of the variables ``axes`` only (standard normal table)."""
    sh = [1] * len(shape)
    for a in axes:
        sh[a] = shape[a]
    return rng.normal(size=sh)


def assert_k1_k2(sysm, f):
    """(K1), (K2) of section 4.2 for every link.  Returns nothing; asserts."""
    scale = 1.0 + float(np.abs(f).max())
    one = np.ones(sysm.shape)
    lo, hi, mean_f = float(f.min()), float(f.max()), sysm.mean(f)
    for l in range(sysm.n):
        g = sysm.Pi(l, f)
        assert g.shape[l] == 1                                    # does not depend on U_l
        gb = np.broadcast_to(g, sysm.shape)
        assert delta(gb, l) == 0.0
        assert np.abs(sysm.Pi(l, one) - 1.0).max() <= FP          # Pi_l 1 = 1
        assert g.min() >= lo - FP * scale and g.max() <= hi + FP * scale
        assert abs(sysm.mean(g) - mean_f) <= FP * scale           # (K2)
        # the conditional density does not depend on U_l and is a probability density
        assert np.abs(sysm.cond(l).sum(axis=l) - 1.0).max() <= FP


def lemma_c2_worst(sysm, f, links=None):
    """Lemma C.2 for the given function and all pairs (l, k).  Asserts the inequality and returns
    the largest ratio  delta_k(Pi_l f) / (delta_k(f) + c_lk delta_l(f))  over pairs with positive
    right-hand side."""
    c = sysm.c
    df = delta_vec(f)
    scale = 1.0 + float(np.abs(f).max())
    worst = 0.0
    for l in (range(sysm.n) if links is None else links):
        dg = delta_vec(sysm.Pi(l, f))
        assert dg[l] == 0.0
        rhs = df + c[l] * df[l]
        for k in range(sysm.n):
            if k == l:
                continue
            assert dg[k] <= rhs[k] + FP * scale, (l, k, dg[k], rhs[k])
            if rhs[k] > 1e-9 * scale:
                worst = max(worst, dg[k] / rhs[k])
    return worst


def a_apply(c, l, x):
    """the linear map A_i of the proof of Lemma C.3(c) for l_i = l."""
    y = x + c[l] * x[l]
    y[l] = 0.0
    return y


def lemma_c3_check(sysm, pairs, f, rng, seq_len=40):
    """Lemma C.3 (a), (b), (c) for the function f and every pair (w, lam) in ``pairs``.  Asserts
    hypothesis (4.1) for each pair and the three statements; (b) for one random sequence of links
    (with repetitions), (c) for one round in a random order, together with the componentwise
    majorant delta(S f) <= A_n ... A_1 delta(f) of the proof.  Returns the largest ratio
    W(S f) / (lam W(f))."""
    c, n = sysm.c, sysm.n
    scale0 = 1.0 + float(np.abs(f).max())
    df = delta_vec(f)
    d_after = [delta_vec(sysm.Pi(l, f)) for l in range(n)]             # for (a)
    seq = rng.integers(0, n, size=seq_len)                             # for (b)
    g, seq_d = f, []
    for l in seq:
        seq_d.append(delta(g, l))
        g = sysm.Pi(l, g)
    seq_d = np.array(seq_d)
    order = rng.permutation(n)                                         # for (c)
    g, x = f, df.copy()
    for l in order:
        g = sysm.Pi(l, g)
        x = a_apply(c, l, x)
    dS = delta_vec(g)
    assert (dS <= x + FP * scale0).all(), "delta(S f) <= A_n ... A_1 delta(f)"
    worst = 0.0
    for w, lam in pairs:
        w = np.asarray(w, dtype=float)
        assert (w >= 0).all() and 0.0 <= lam <= 1.0
        assert (c @ w <= lam * w + FP).all(), "hypothesis (4.1) does not hold for these weights"
        scale = scale0 * (1.0 + float(w.sum()))
        Wf = float(w @ df)
        for l in range(n):                                             # (a)
            assert w @ d_after[l] <= Wf - (1.0 - lam) * w[l] * df[l] + FP * scale, ("C.3(a)", l)
        assert ((1.0 - lam) * np.cumsum(w[seq] * seq_d) <= Wf + FP * scale).all(), "C.3(b)"
        WS = float(w @ dS)
        assert WS <= lam * Wf + FP * scale, "C.3(c)"                   # (c)
        if lam * Wf > 1e-9 * scale:
            worst = max(worst, WS / (lam * Wf))
    return worst


def lemma_c3_matrix_check(c, w, lam, order):
    """the statement  w . (A_n ... A_1 e_j) <= lam w_j  of the proof of Lemma C.3(c)."""
    n = len(w)
    worst = 0.0
    for j in range(n):
        x = np.zeros(n)
        x[j] = 1.0
        for l in order:
            x = a_apply(c, l, x)
        assert w @ x <= lam * w[j] + FP * (1.0 + w.sum())
        if lam * w[j] > 0:
            worst = max(worst, (w @ x) / (lam * w[j]))
    return worst


def lemma_c4_check(sysm, als, f, order, nmax):
    """Lemma C.4:  || S^n f - pi(f) ||_inf <= al^n Delta(f)  for n = 0..nmax and every al in
    ``als`` (each must be < 1 and >= the exact alpha_pi).  Returns the largest ratio left/right."""
    scale = 1.0 + float(np.abs(f).max())
    pif, Df = sysm.mean(f), float(delta_vec(f).sum())
    alpha_pi = float(sysm.c.sum(axis=1).max())
    g, errs = f, []
    for nn in range(nmax + 1):
        errs.append(float(np.abs(g - pif).max()))
        g = sysm.sweep(order, g)
    worst = 0.0
    for al in als:
        assert alpha_pi <= al + FP and al < 1.0
        for nn, err in enumerate(errs):
            assert err <= al ** nn * Df + FP * scale, (nn, err, al ** nn * Df)
            if al ** nn * Df > 1e-9 * scale:
                worst = max(worst, err / (al ** nn * Df))
    return worst


# ======================================================================================
# the Z2 laboratory
# ======================================================================================
@lru_cache(maxsize=None)
def z2_action(shape):
    """sum_p sigma_p on the torus ``shape`` as an array of shape (2,)*nl."""
    lat = torus(shape)
    n = lat.nl
    S = np.zeros((2,) * n)
    for p in lat.plaq:
        S = S + sgn(n, p[0]) * sgn(n, p[1]) * sgn(n, p[2]) * sgn(n, p[3])
    return S


@lru_cache(maxsize=12)
def z2_system(shape, beta):
    """(lattice, System) for the Z2 measure mu of section 1.3 on the torus ``shape``."""
    return torus(shape), System(np.exp(beta * z2_action(shape)))


def z2_frozen(shape, beta, B, omega):
    """the system (R, mu^omega) of section 4.3: links B frozen at omega (omega_b in {0, 1} is the
    array index, 0 <-> +1).  Returns (R, System); axis i of the system is the link R[i]."""
    S = z2_action(shape)
    idx = [slice(None)] * S.ndim
    for b, o in zip(B, omega):
        idx[b] = int(o)
    Bset = set(B)
    R = [l for l in range(S.ndim) if l not in Bset]
    return R, System(np.exp(beta * S[tuple(idx)]))


def mu_all_omega(w, f, B):
    """mu^omega(f) for every boundary condition omega at once (array with one axis per link of B,
    in increasing order of link index).  f must not depend on the links of B."""
    Bset = set(B)
    R_axes = tuple(l for l in range(w.ndim) if l not in Bset)
    for b in B:
        assert f.shape[b] == 1
    return (w * f).sum(axis=R_axes) / w.sum(axis=R_axes)


T33 = (3, 3)
BETAS_D2 = (0.05, 0.10, 0.15)          # all below beta_0(2) = 0.1682


def h33(x, y):
    """horizontal link (x,y) -> (x+1,y) of the 3 x 3 torus."""
    return torus(T33).link((x % 3, y % 3), 0)


def v33(x, y):
    """vertical link (x,y) -> (x,y+1) of the 3 x 3 torus."""
    return torus(T33).link((x % 3, y % 3), 1)


def plaq33(x, y):
    return [h33(x, y), v33(x + 1, y), h33(x, y + 1), v33(x, y)]


# ======================================================================================
# C1.  Lemma C.1
# ======================================================================================
def tilt(nu, phi):
    """nu'(S) = nu(e^phi 1_S) / nu(e^phi)."""
    w = nu * np.exp(phi - phi.max(axis=-1, keepdims=True))
    return w / w.sum(axis=-1, keepdims=True)


def test_c1_lemma_c1_random_tilts():
    """Lemma C.1 (section 4.2): d_TV(nu, nu') <= tanh(osc(phi)/4) for 33600 random finite
    probability vectors nu and random bounded phi (several sizes, scales of phi and shapes of nu
    and phi, including nu with atoms of weight zero and two-valued phi)."""
    rng = np.random.default_rng(101)
    worst, count = 0.0, 0
    for size in (2, 3, 4, 5, 8, 13, 40, 200):
        for scale in (1e-3, 0.03, 0.3, 1.0, 3.0, 10.0, 40.0):
            for kind in range(4):
                reps = 150
                if kind == 0:                         # generic
                    nu = rng.dirichlet(np.ones(size), size=reps)
                    phi = scale * rng.normal(size=(reps, size))
                elif kind == 1:                       # very uneven nu, uniform phi
                    nu = rng.dirichlet(0.05 * np.ones(size), size=reps) + 1e-300
                    nu /= nu.sum(axis=1, keepdims=True)
                    phi = scale * rng.uniform(-1, 1, size=(reps, size))
                elif kind == 2:                       # two-valued phi (the extremal shape)
                    nu = rng.dirichlet(np.ones(size), size=reps)
                    phi = scale * rng.integers(0, 2, size=(reps, size)).astype(float)
                else:                                 # some atoms of weight exactly zero
                    nu = rng.dirichlet(np.ones(size), size=reps)
                    nu[:, 0] = 0.0
                    nu /= nu.sum(axis=1, keepdims=True)
                    phi = scale * rng.normal(size=(reps, size))
                nup = tilt(nu, phi)
                d = 0.5 * np.abs(nu - nup).sum(axis=1)
                bound = np.tanh((phi.max(axis=1) - phi.min(axis=1)) / 4.0)
                assert (d <= bound + 1e-14).all(), (size, scale, kind, float((d - bound).max()))
                ok = bound > 0
                worst = max(worst, float((d[ok] / bound[ok]).max()))
                count += reps
    assert count == 33600
    note("C1 Lemma C.1: max d_TV / tanh(osc/4) over 33600 random cases", f"{worst:.6f}")
    assert worst <= 1.0 + 1e-12


def test_c1_lemma_c1_sup_over_events_and_tv1():
    """Lemma C.1 literally as stated, with d_TV = sup_S |nu(S) - nu'(S)| computed by brute force
    over all 2^n events (n <= 10), and fact (TV1): that supremum equals (1/2) sum |q - q'|."""
    rng = np.random.default_rng(102)
    for size in (2, 3, 5, 8, 10):
        masks = np.array(list(itertools.product((0.0, 1.0), repeat=size)))     # all events
        for scale in (0.1, 1.0, 5.0):
            for _ in range(40):
                nu = rng.dirichlet(np.ones(size))
                phi = scale * rng.normal(size=size)
                nup = tilt(nu, phi)
                sup = float(np.abs(masks @ (nu - nup)).max())
                assert abs(sup - 0.5 * np.abs(nu - nup).sum()) <= 1e-14          # (TV1)
                assert sup <= math.tanh((phi.max() - phi.min()) / 4.0) + 1e-14   # Lemma C.1


def test_c1_fact_tv1_and_its_proof():
    """(TV1) of section 4.2 and the steps of its proof, for random densities q, q' with respect to
    a random (non-uniform) reference measure on n <= 10 points: d_TV = sup_S |nu(S) - nu'(S)|
    (brute force over all 2^n events) equals (1/2) int |q - q'|; nu(S) - nu'(S) <= int (q-q')^+
    for every S with equality for S = {q > q'}; nu'(S) - nu(S) <= int (q-q')^-; and
    int (q-q')^+ = int (q-q')^- = (1/2) int |q - q'|."""
    rng = np.random.default_rng(107)
    for size in (2, 3, 6, 10):
        masks = np.array(list(itertools.product((0.0, 1.0), repeat=size)))     # all events S
        for _ in range(60):
            ref = rng.dirichlet(np.ones(size))                # the reference measure varsigma
            q, qp = rng.gamma(1.0, size=size), rng.gamma(1.0, size=size)
            if rng.uniform() < 0.3:
                q[rng.integers(size)] = 0.0                   # densities may vanish somewhere
            q, qp = q / (ref @ q), qp / (ref @ qp)            # int q = int q' = 1
            diff = ref * (q - qp)                             # nu({x}) - nu'({x})
            signed = masks @ diff                             # nu(S) - nu'(S) for every S
            pos, neg = float(np.maximum(diff, 0).sum()), float(np.maximum(-diff, 0).sum())
            half_l1 = 0.5 * float(np.abs(diff).sum())
            # 1e-14: sums of at most 10 numbers of order one
            assert signed.max() <= pos + 1e-14 and (-signed).max() <= neg + 1e-14
            assert abs(float((q > qp).astype(float) @ diff) - pos) <= 1e-14    # equality at {q > q'}
            assert abs(pos - neg) <= 1e-14 and abs(pos - half_l1) <= 1e-14
            assert abs(float(np.abs(signed).max()) - half_l1) <= 1e-14          # (TV1)
            assert 0.0 <= half_l1 <= 1.0 + 1e-14              # d_TV <= 1, used in step 2 of C.6


def test_c1_two_point_case_attains_equality():
    """Lemma C.1 is sharp: for nu = (a, 1-a), phi = (M, m), s = e^{(M-m)/2} and a = 1/(1+s) the
    distance equals tanh(osc(phi)/4) = (s-1)/(s+1); for other a it is
    (s^2-1) a (1-a) / (s^2 a + 1 - a), which is smaller (formula in the proof of Lemma C.1)."""
    rng = np.random.default_rng(103)
    for o in (1e-6, 1e-2, 0.4, 1.0, 4.0, 12.0, 30.0):
        s = math.exp(o / 2.0)
        a = 1.0 / (1.0 + s)
        nu = np.array([a, 1.0 - a])
        nup = tilt(nu, np.array([o, 0.0]))
        d = 0.5 * np.abs(nu - nup).sum()
        assert abs(d - math.tanh(o / 4.0)) <= 1e-13 * max(1.0, 1.0 / math.tanh(o / 4.0)) * math.tanh(o / 4.0) + 1e-16
        assert abs((s - 1) / (s + 1) - math.tanh(o / 4.0)) <= 1e-13
        for a2 in rng.uniform(0, 1, size=200):
            nu = np.array([a2, 1.0 - a2])
            nup = tilt(nu, np.array([o, 0.0]))
            d2 = 0.5 * np.abs(nu - nup).sum()
            formula = (s * s - 1) * a2 * (1 - a2) / (s * s * a2 + 1 - a2)
            assert abs(d2 - formula) <= 1e-13
            assert d2 <= math.tanh(o / 4.0) + 1e-15


def test_c1_algebraic_identities_of_the_proof():
    """The algebra in the proof of Lemma C.1, exactly (rational arithmetic) and in floating point:
    s^2 a/(s^2 a + 1 - a) - a = (s^2-1) a (1-a)/(s^2 a + 1 - a);
    s^2 a + b - (s+1)^2 a b = s^2 a (1-b) + b (1-a) - 2 s a b = (s a - b)^2  with b = 1 - a;
    and the equivalence with (s^2-1) a (1-a)/(s^2 a + 1 - a) <= (s-1)/(s+1)."""
    rng = np.random.default_rng(104)
    for _ in range(300):                                           # exact
        s = Fraction(int(rng.integers(1001, 10 ** 6)), 1000)       # s > 1
        a = Fraction(int(rng.integers(0, 10 ** 6 + 1)), 10 ** 6)   # a in [0, 1]
        b = 1 - a
        assert s * s * a + b - (s + 1) ** 2 * a * b == (s * a - b) ** 2
        assert s * s * a * (1 - b) + b * (1 - a) - 2 * s * a * b == (s * a - b) ** 2
        den = s * s * a + 1 - a
        assert s * s * a / den - a == (s * s - 1) * a * (1 - a) / den
        assert (s * s - 1) * a * (1 - a) / den <= (s - 1) / (s + 1)
    s = np.exp(rng.uniform(0, 7, size=20000))                      # floating point, s in [1, 1100]
    a = rng.uniform(0, 1, size=20000)
    b = 1 - a
    lhs = s * s * a + b - (s + 1) ** 2 * a * b
    assert (np.abs(lhs - (s * a - b) ** 2) <= 1e-12 * (1 + s * s)).all()


def test_c1_monotonicity_step_of_the_proof():
    """First display of the proof of Lemma C.1: nu'(S) <= s^2 a / (s^2 a + 1 - a) with a = nu(S),
    s = e^{(sup phi - inf phi)/2}, for random nu, phi and events S."""
    rng = np.random.default_rng(105)
    for size in (3, 6, 12):
        for _ in range(400):
            nu = rng.dirichlet(np.ones(size))
            phi = rng.normal(size=size) * rng.choice([0.1, 1.0, 6.0])
            ind = rng.integers(0, 2, size=size).astype(float)
            a = float(nu @ ind)
            s2 = math.exp(phi.max() - phi.min())
            assert float(tilt(nu, phi) @ ind) <= s2 * a / (s2 * a + 1 - a) + 1e-14


def test_c1_fact_tv2():
    """(TV2) of section 4.2: |nu(F) - nu'(F)| <= osc(F) d_TV(nu, nu') for random nu, nu', F."""
    rng = np.random.default_rng(106)
    worst = 0.0
    for size in (2, 3, 7, 30):
        for _ in range(500):
            nu, nup = rng.dirichlet(np.ones(size)), rng.dirichlet(np.ones(size))
            F = rng.normal(size=size)
            lhs = abs(float(nu @ F - nup @ F))
            rhs = (F.max() - F.min()) * 0.5 * np.abs(nu - nup).sum()
            assert lhs <= rhs + 1e-14
            worst = max(worst, lhs / rhs)
    assert worst > 0.5          # the inequality is not vacuous on this sample


# ======================================================================================
# C2.  geometry: section 1.2 and the geometric claims of section 4.5
# ======================================================================================
C2_SHAPES = [(L,) * D for D in (2, 3, 4) for L in (3, 4, 5)] + [(3, 4), (5, 3), (3, 5, 4), (3, 4, 5, 3)]


@pytest.mark.parametrize("shape", C2_SHAPES, ids=lambda s: "x".join(map(str, s)))
def test_c2_plaquettes_r1_r2(shape):
    """Section 1.2 by brute force on a torus with all extents >= 3: the four links of every
    plaquette are distinct; (R1) every link lies in exactly 2(D-1) plaquettes, namely for each
    nu != mu the two plaquettes in the (mu,nu)-plane on either side; (R2) sum_k n_lk = 6(D-1);
    moreover n_lk is 0 or 1 (so every link has exactly 6(D-1) neighbours) and the neighbour graph
    is connected (all link distances finite)."""
    lat = torus(shape)
    D = lat.D
    assert len(lat.plaq) == len(lat.sites) * D * (D - 1) // 2
    assert all(len(set(p)) == 4 for p in lat.plaq)
    assert len({frozenset(p) for p in lat.plaq}) == len(lat.plaq)
    for x in lat.sites:
        for mu in range(D):
            l = lat.link(x, mu)
            assert len(lat.through[l]) == 2 * (D - 1)                               # (R1)
            want = set()
            for nu in range(D):
                if nu != mu:
                    a, b = min(mu, nu), max(mu, nu)
                    want.add((x, a, b))
                    want.add((lat.shift(x, nu, -1), a, b))
            assert {lat.plaq_label[ip] for ip in lat.through[l]} == want
            assert len(want) == 2 * (D - 1)
            assert sum(lat.ncommon[l].values()) == 6 * (D - 1)                      # (R2)
            assert set(lat.ncommon[l].values()) == {1}                              # n_lk in {0,1}
            assert len(lat.ncommon[l]) == 6 * (D - 1)
            assert l not in lat.ncommon[l]
    assert (lat.bfs([0]) >= 0).all()


C2_TIME_CASES = [((3,), N) for N in range(3, 11)] + [((4,), N) for N in (3, 4, 7)] + \
                [((3, 3), N) for N in range(3, 9)] + [((3, 4), N) for N in (3, 6)] + \
                [((3, 3, 3), N) for N in (3, 4, 6)]


@pytest.mark.parametrize("sshape,N", C2_TIME_CASES, ids=lambda v: str(v).replace(" ", ""))
def test_c2_time_coordinate_and_layer_distance(sshape, N):
    """Section 4.5, proof of point 2: with time coordinate s for spatial links of layer s and
    s + 1/2 for time links, the links of a spatial plaquette have equal time coordinate, those of a
    time plaquette have s, s+1/2, s+1/2, s+1; neighbours differ by at most 1 (along the circle
    Z/N); and for A = spatial links of layer 0, B = those of layer t, 1 <= t <= N/2, the link
    distance satisfies d(A,B) >= t (breadth-first search); even d(k,B) >= t for every k in A."""
    lat = torus(tuple(sshape) + (N,))
    D = lat.D
    tc = np.zeros(lat.nl)
    for x in lat.sites:
        for mu in range(D):
            tc[lat.link(x, mu)] = x[D - 1] + (0.5 if mu == D - 1 else 0.0)
    for p, (x, mu, nu) in zip(lat.plaq, lat.plaq_label):
        s = x[D - 1]
        if nu < D - 1:                                         # spatial plaquette
            assert all(tc[l] == s for l in p)
        else:                                                  # time plaquette
            assert sorted((tc[l] - s) % N for l in p) == [0.0, 0.5, 0.5, 1.0]
    for a in range(lat.nl):
        for b in lat.ncommon[a]:
            dd = abs(tc[a] - tc[b])
            assert min(dd, N - dd) <= 1.0
    A = layer_links(lat, 0)
    for t in range(1, N // 2 + 1):
        dB = lat.bfs(layer_links(lat, t))
        assert dB[A].min() >= t
        assert dB[A].min() == t          # (the bound is attained; not claimed in the document)


def cube_links(D, r):
    """R_r of section 4.5: links (x, mu) of Z^D with both end points in Q_r = {-r..r}^D."""
    return [(x, mu) for x in itertools.product(range(-r, r + 1), repeat=D) for mu in range(D)
            if x[mu] + 1 <= r]


def rho_link(link):
    """rho(k): the largest absolute value of a coordinate of the two end points of k."""
    x, mu = link
    return max(max(abs(c) for c in x), abs(x[mu] + 1))


def zd_plaquette(x, mu, nu):
    xm = tuple(c + (i == mu) for i, c in enumerate(x))
    xn = tuple(c + (i == nu) for i, c in enumerate(x))
    return ((tuple(x), mu), (xm, nu), (xn, mu), (tuple(x), nu))


@pytest.mark.parametrize("D,r", [(2, 1), (2, 2), (2, 3), (3, 1), (3, 2), (4, 1)])
def test_c2_cube_embedding_of_point_3(D, r):
    """Section 4.5, proof of point 3 (geometry): neighbours differ by at most 1 in rho; for
    L >= 2r+3 the projection Z^D -> (Z/L)^D is injective on Q_{r+1}; every plaquette of the torus
    that contains a link of R_r has its corners in the image of Q_{r+1}; the plaquettes touching
    R_r (and their links) are the same for every L >= 2r+3 as in Z^D; and d(k,B) >= r+1-rho(k) for
    k in R_r and B the complement of R_r (breadth-first search on the torus)."""
    Rr = cube_links(D, r)
    Rset_zd = set(Rr)
    # the plaquettes of Z^D that contain a link of R_r, and "neighbours differ by <= 1 in rho"
    ref = set()
    for x in itertools.product(range(-r - 2, r + 2), repeat=D):
        for mu in range(D):
            for nu in range(mu + 1, D):
                p = zd_plaquette(x, mu, nu)
                rhos = [rho_link(l) for l in p]
                assert max(rhos) - min(rhos) <= 1
                if any(l in Rset_zd for l in p):
                    ref.add(p)
    Ls = (2 * r + 3, 2 * r + 4, 2 * r + 6) if D < 4 else (2 * r + 3, 2 * r + 4)
    attained_by_L = []
    for L in Ls:
        lat = torus((L,) * D)
        lift = {}
        for x in itertools.product(range(-r - 1, r + 2), repeat=D):
            px = tuple(c % L for c in x)
            assert px not in lift                               # injective on Q_{r+1}
            lift[px] = x
        img = [lat.link(tuple(c % L for c in x), mu) for (x, mu) in Rr]
        assert len(set(img)) == len(img)
        Rset = set(img)
        lifted = set()
        for p, (x, mu, nu) in zip(lat.plaq, lat.plaq_label):
            if not any(l in Rset for l in p):
                continue
            corners = [x, lat.shift(x, mu), lat.shift(x, nu), lat.shift(lat.shift(x, mu), nu)]
            assert all(c in lift for c in corners)              # corners in the image of Q_{r+1}
            zp = zd_plaquette(lift[x], mu, nu)
            # the lifted plaquette is the same plaquette: its links project onto the links of p
            assert tuple(lat.link(tuple(c % L for c in y), m) for (y, m) in zp) == p
            lifted.add(zp)
        assert lifted == ref                                    # same plaquettes for every L
        dB = lat.bfs([l for l in range(lat.nl) if l not in Rset])
        attained = 0
        for (x, mu), l in zip(Rr, img):
            assert dB[l] >= r + 1 - rho_link((x, mu))           # the claim (one-sided)
            attained += int(dB[l] == r + 1 - rho_link((x, mu)))
        # not claimed, only recorded: the bound is an equality for some links but not for all
        # (a link whose two end points both have a coordinate +-rho can be one step further away)
        assert 0 < attained
        attained_by_L.append(attained)
    assert len(set(attained_by_L)) == 1                         # the same for every L >= 2r+3
    note(f"C2 point 3, D={D} r={r}: links of R_r with d(k,B) = r+1-rho(k) exactly",
         f"{attained_by_L[0]} of {len(Rr)}")


def zd_neighbours(link):
    """the 6(D-1) neighbours in Z^D of the link (x, mu): the other links of the 2(D-1) plaquettes
    that contain it (section 1.2, (R1))."""
    x, mu = link
    out = []
    for nu in range(len(x)):
        if nu == mu:
            continue
        a, b = min(mu, nu), max(mu, nu)
        for base in (tuple(x), tuple(c - (i == nu) for i, c in enumerate(x))):
            p = zd_plaquette(base, a, b)
            assert link in p
            out.extend(l for l in p if l != link)
    return out


def zd_link_distance(sources, targets):
    """link distance d(k, sources) in Z^D for every k in ``targets``: breadth-first search over
    the neighbour relation on the infinite lattice itself (no box), stopped as soon as every
    target has been reached.  Returns a dict."""
    dist = {l: 0 for l in sources}
    frontier, want, d = list(dist), set(targets) - set(sources), 0
    while want:
        d += 1
        nxt = []
        for a in frontier:
            for b in zd_neighbours(a):
                if b not in dist:
                    dist[b] = d
                    nxt.append(b)
                    want.discard(b)
        frontier = nxt
        assert d < 60
    return {k: dist[k] for k in targets}


def torus_shortest_path(lat, source, targets):
    """a shortest path of neighbours on the torus from ``source`` to the set ``targets``
    (breadth-first search with parent pointers); list of link indices, source first."""
    parent = {source: None}
    queue = deque([source])
    targets = set(targets)
    while queue:
        a = queue.popleft()
        if a in targets:
            path = [a]
            while parent[path[-1]] is not None:
                path.append(parent[path[-1]])
            return path[::-1]
        for b in sorted(lat.ncommon[a]):
            if b not in parent:
                parent[b] = a
                queue.append(b)
    raise AssertionError("target not reachable")


def _c2_lift_cases():
    """(name, D, r0, A, B): disjoint non-empty sets of links of R_{r0} in Z^D."""
    rng = np.random.default_rng(201)
    cases = []
    for D, r0, sizes in ((2, 1, (1, 1)), (2, 1, (3, 4)), (2, 2, (1, 1)), (2, 2, (4, 3)), (2, 2, (6, 2)),
                         (2, 3, (2, 2)), (3, 1, (1, 1)), (3, 1, (3, 3)), (3, 2, (2, 2))):
        links = cube_links(D, r0)
        perm = rng.permutation(len(links))
        A = [links[i] for i in perm[:sizes[0]]]
        B = [links[i] for i in perm[sizes[0]:sizes[0] + sizes[1]]]
        cases.append((f"D={D} r0={r0} random sets of sizes {sizes[0]},{sizes[1]}", D, r0, A, B))
    # opposite corners of the cube: the largest distances, where wrapping around a torus pays most
    cases.append(("D=2 r0=2 opposite corners", 2, 2, [((-2, -2), 0)], [((1, 2), 0)]))
    cases.append(("D=2 r0=3 opposite edges", 2, 3, [((-3, y), 1) for y in range(-3, 3)], [((3, y), 1) for y in range(-3, 3)]))
    cases.append(("D=3 r0=1 opposite corners", 3, 1, [((-1, -1, -1), 0)], [((0, 1, 1), 0)]))
    cases.append(("D=4 r0=1 neighbouring links", 4, 1, [((0, 0, 0, 0), 0)], [((0, 0, 0, 0), 1), ((1, 1, 1, 0), 3)]))
    return cases


C2_LIFT_CASES = _c2_lift_cases()


@pytest.mark.parametrize("case", C2_LIFT_CASES, ids=[c[0].replace(" ", "_") for c in C2_LIFT_CASES])
def test_c2_lifting_argument_of_point_3(case):
    """Section 4.5, proof of point 3, last part: for disjoint non-empty A, B inside R_{r0}, with
    n = max_{k in A} d(k,B) (link distance in Z^D), r = r0 + n and L >= 2r+3, the link distance
    d_L on the torus (Z/L)^D satisfies d_L(k,B) = d(k,B) for every k in A.  Both distances by
    breadth-first search (on Z^D itself and on the torus), for L = 2r+3, 2r+4, 2r+5.  The steps of
    the proof are followed literally for L = 2r+3: d_L <= d (projection of a path); a shortest
    torus path k = k_0, ..., k_j from k to B is lifted link by link, each k_i being the image of a
    link with rho <= r0 + i, through the unique plaquette of Z^D with corners in Q_{r+1} above the
    torus plaquette that contains k_i and k_{i+1}; the last lifted link lies in R_r and is a link
    of B.  Recorded, not claimed: the smallest L from which on d_L = d on A (the hypothesis
    L >= 2r+3 is sufficient, not sharp), and that d_L < d does occur for smaller L."""
    name, D, r0, A, B = case
    assert not set(A) & set(B) and A and B
    assert all(rho_link(l) <= r0 for l in A + B)
    dZ = zd_link_distance(B, A)                                 # d(k, B) in Z^D, k in A
    n = max(dZ.values())
    r = r0 + n
    proj = lambda lat, link: lat.link(tuple(c % lat.shape[0] for c in link[0]), link[1])
    for L in (2 * r + 3, 2 * r + 4, 2 * r + 5) if D < 4 else (2 * r + 3,):
        lat = torus((L,) * D)
        Bimg = [proj(lat, l) for l in B]
        assert len(set(Bimg)) == len(B)
        dL = lat.bfs(Bimg)
        for k in A:
            assert dL[proj(lat, k)] == dZ[k], (name, L, k, int(dL[proj(lat, k)]), dZ[k])
    # the proof, step by step, on the smallest admissible torus
    L = 2 * r + 3
    lat = torus((L,) * D)
    lift_site = {tuple(c % L for c in x): x for x in itertools.product(range(-r - 1, r + 2), repeat=D)}
    assert len(lift_site) == (2 * r + 3) ** D                   # injective on Q_{r+1}
    Bset, Bimg = set(B), {proj(lat, l) for l in B}
    plaq_of = {}                                                # (link, link) -> the plaquette with both
    for ip, p in enumerate(lat.plaq):
        for a in p:
            for b in p:
                if a != b:
                    assert (a, b) not in plaq_of                # n_lk <= 1
                    plaq_of[(a, b)] = ip
    for k in A:
        path = torus_shortest_path(lat, proj(lat, k), Bimg)
        j = len(path) - 1
        assert j == dZ[k] <= n
        cur = k                                                 # the lifted link above path[i]
        for i in range(j):
            assert proj(lat, cur) == path[i] and rho_link(cur) <= r0 + i <= r
            ip = plaq_of[(path[i], path[i + 1])]
            x, mu, nu = lat.plaq_label[ip]
            corners = [x, lat.shift(x, mu), lat.shift(x, nu), lat.shift(lat.shift(x, mu), nu)]
            assert all(c in lift_site for c in corners)         # the plaquette touches R_r
            zp = zd_plaquette(lift_site[x], mu, nu)
            assert all(max(abs(c) for c in y) <= r + 1 for (y, _) in zp)
            assert tuple(proj(lat, l) for l in zp) == lat.plaq[ip]
            assert cur in zp                                    # it contains the lifted k_i
            nxt = zp[lat.plaq[ip].index(path[i + 1])]           # the link above k_{i+1}
            assert nxt in zd_neighbours(cur) and rho_link(nxt) <= r0 + i + 1
            cur = nxt
        assert rho_link(cur) <= r and proj(lat, cur) in Bimg
        assert cur in Bset                                      # hence d(k,B) <= j
    # recorded only: where does equality start, and is it ever violated below the threshold?
    first_ok, strict = None, 0
    if D < 4:
        for L in range(2 * r0 + 3, 2 * r + 3):                  # projection injective on Q_{r0+1}
            lat = torus((L,) * D)
            dL = lat.bfs([proj(lat, l) for l in B])
            vals = [(int(dL[proj(lat, k)]), dZ[k]) for k in A]
            assert all(a <= b for a, b in vals)                 # d_L <= d always
            strict += any(a < b for a, b in vals)
            if all(a == b for a, b in vals):
                first_ok = L if first_ok is None else first_ok
            else:
                first_ok = None
        note(f"C2 lifting, {name}: n = max d(k,B), threshold 2r+3, smallest L with d_L = d on A",
             f"{n}, {2 * r + 3}, {first_ok if first_ok is not None else 2 * r + 3} "
             f"({strict} smaller tori with d_L < d)")


# ======================================================================================
# C3.  Lemma C.5 for the real group SU(2): quadrature on S^3
# ======================================================================================
_PAULI_I = [np.eye(2, dtype=complex),
            1j * np.array([[0, 1], [1, 0]], dtype=complex),
            1j * np.array([[0, -1j], [1j, 0]], dtype=complex),
            1j * np.array([[1, 0], [0, -1]], dtype=complex)]


def su2_matrix(q):
    """q in R^4 -> q0 + i (q1 s1 + q2 s2 + q3 s3); an element of SU(2) iff |q| = 1 (section 1.1:
    a = q0 + i q3, b = q2 + i q1)."""
    return sum(q[i] * _PAULI_I[i] for i in range(4))


def random_unit(rng, size=None):
    v = rng.normal(size=(4,) if size is None else (size, 4))
    return v / np.linalg.norm(v, axis=-1, keepdims=True)


def su2_plaquette_half_trace(U, p):
    """(1/2) Tr U_p with U_p = U_{x,mu} U_{x+mu,nu} U_{x+nu,mu}^{-1} U_{x,nu}^{-1} (section 1.2);
    inverses are taken as conjugate transposes, so the expression is real-linear in each link."""
    M = U[p[0]] @ U[p[1]] @ U[p[2]].conj().T @ U[p[3]].conj().T
    return 0.5 * np.trace(M).real


def su2_field_b(lat, U, l):
    """the vector b in R^4 with  (1/2) sum_{p containing l} Tr U_p = b . v  when U_l is the unit
    quaternion v (b is the conjugate of the sum of the 2(D-1) staples)."""
    b = np.zeros(4)
    keep = U[l]
    for i in range(4):
        U[l] = _PAULI_I[i]
        b[i] = sum(su2_plaquette_half_trace(U, lat.plaq[ip]) for ip in lat.through[l])
    U[l] = keep
    return b


def su2_tv(beta, b, bp, n=None):
    """Total-variation distance (1/2) int |p - p'| between the probability densities
    p ~ exp(beta b.v) and p' ~ exp(beta b'.v) on S^3 (normalised surface measure = Haar measure of
    SU(2)), by Gauss-Legendre quadrature in hyperspherical coordinates
        v = cos(chi) e0 + sin(chi) (cos(th) e1 + sin(th) (cos(ph) e2 + sin(ph) e3)),
        dv = (2/pi) sin^2(chi) dchi  (1/2) sin(th) dth  dph/(2 pi),
    with e0 along b' - b and e1 along the part of b orthogonal to e0.  In that frame
    b = (c0, c1, 0, 0) and b' = (c0 + |b'-b|, c1, 0, 0) with c0 = b.e0 and c1 = |b - c0 e0|, so the
    integrand does not depend on ph, and the kink of |p - p'| (the set p = p', a level set of chi)
    is a break point of the chi quadrature.  Only c0, c1 and |b'-b| enter, so no frame has to be
    constructed (the measure is rotation invariant).  Returns (tv, Z, Z') with
    Z = int exp(beta b.v) dv."""
    b, bp = np.asarray(b, dtype=float), np.asarray(bp, dtype=float)
    dvec = bp - b
    nd = float(np.linalg.norm(dvec))
    if n is None:
        n = 48 if beta * max(np.linalg.norm(b), np.linalg.norm(bp)) <= 30 else 200
    x, wx = gauss_legendre(n)
    if nd < 1e-14:
        return 0.0, None, None
    e0 = dvec / nd
    c0 = float(b @ e0)
    c1 = float(np.linalg.norm(b - c0 * e0))
    c, cp = (c0, c1), (c0 + nd, c1)
    shift, shiftp = beta * np.linalg.norm(b), beta * np.linalg.norm(bp)    # to avoid overflow
    cth, wth = x, wx / 2.0

    def piece(lo, hi):
        chi = 0.5 * (hi - lo) * x + 0.5 * (hi + lo)
        wchi = 0.5 * (hi - lo) * wx * (2.0 / math.pi) * np.sin(chi) ** 2
        C, S = np.cos(chi)[:, None], np.sin(chi)[:, None]
        e = np.exp(beta * (c[0] * C + c[1] * S * cth[None, :]) - shift)
        ep = np.exp(beta * (cp[0] * C + cp[1] * S * cth[None, :]) - shiftp)
        return wchi, e, ep

    wchi, e, ep = piece(0.0, math.pi)
    Zs, Zps = float(wchi @ e @ wth), float(wchi @ ep @ wth)          # Z e^{-shift}, Z' e^{-shift'}
    # p'/p = exp(beta |b'-b| cos(chi)) Z/Z'  equals 1 at cos(chi0) = ln(Z'/Z) / (beta |b'-b|)
    x0 = (math.log(Zps / Zs) + shiftp - shift) / (beta * nd)
    assert -1.0 < x0 < 1.0
    chi0 = math.acos(x0)
    tv = 0.0
    for lo, hi in ((0.0, chi0), (chi0, math.pi)):
        wchi, e, ep = piece(lo, hi)
        tv += 0.5 * float(wchi @ np.abs(e / Zs - ep / Zps) @ wth)
    return tv, Zs * math.exp(shift), Zps * math.exp(shiftp)


def su2_tv_generic(beta, b, bp, n=64):
    """the same distance by a plain product quadrature on S^3 in a fixed coordinate system (not
    adapted to b, b'); less accurate because the integrand has a kink."""
    x, wx = gauss_legendre(n)
    chi = 0.5 * math.pi * (x + 1)
    wchi = 0.5 * math.pi * wx * (2.0 / math.pi) * np.sin(chi) ** 2
    cth, wth = x, wx / 2.0
    sth = np.sqrt(1 - cth ** 2)
    ph = 2 * math.pi * (np.arange(n) + 0.5) / n
    V = np.stack(np.broadcast_arrays(
        np.cos(chi)[:, None, None] + 0 * cth[None, :, None] + 0 * ph[None, None, :],
        np.sin(chi)[:, None, None] * cth[None, :, None] + 0 * ph[None, None, :],
        np.sin(chi)[:, None, None] * sth[None, :, None] * np.cos(ph)[None, None, :],
        np.sin(chi)[:, None, None] * sth[None, :, None] * np.sin(ph)[None, None, :]), axis=-1)
    W = wchi[:, None, None] * wth[None, :, None] * np.full(n, 1.0 / n)[None, None, :]
    e, ep = np.exp(beta * (V @ np.asarray(b))), np.exp(beta * (V @ np.asarray(bp)))
    Z, Zp = float((W * e).sum()), float((W * ep).sum())
    return 0.5 * float((W * np.abs(e / Z - ep / Zp)).sum()), Z, Zp


def _sinhc(a):
    a = np.asarray(a, dtype=float)
    small = np.abs(a) < 1e-4
    return np.where(small, 1.0 + a * a / 6.0, np.sinh(np.where(small, 1.0, a)) / np.where(small, 1.0, a))


def su2_tv_1d(beta, b, bp, n=80):
    """the same distance from a one-dimensional integral: with x = cos(chi) the component along
    b'-b, the integral over the S^2 of the other components is done in closed form
    (int exp(a n.e) dn = sinh(a)/a), Z = 2 I_1(beta |b|)/(beta |b|), and
    d_TV = P'(x > x0) - P(x > x0) with x0 the point where the two densities cross."""
    b, bp = np.asarray(b, dtype=float), np.asarray(bp, dtype=float)
    dvec = bp - b
    nd = float(np.linalg.norm(dvec))
    if nd < 1e-14:
        return 0.0
    u = dvec / nd
    bpar = float(b @ u)
    bperp = float(np.linalg.norm(b - bpar * u))

    def zfun(vec):
        a = beta * float(np.linalg.norm(vec))
        return 1.0 if a < 1e-8 else 2.0 * float(special.ive(1, a)) / a      # times e^a

    nb, nbp = float(np.linalg.norm(b)), float(np.linalg.norm(bp))
    x0 = (math.log(zfun(bp) / zfun(b)) + beta * (nbp - nb)) / (beta * nd)
    chi0 = math.acos(x0)
    x, wx = gauss_legendre(n)
    chi = 0.5 * chi0 * (x + 1)
    wchi = 0.5 * chi0 * wx * (2.0 / math.pi) * np.sin(chi) ** 2
    sph = _sinhc(beta * bperp * np.sin(chi))
    P = float(wchi @ (np.exp(beta * bpar * np.cos(chi) - beta * nb) * sph)) / zfun(b)
    Pp = float(wchi @ (np.exp(beta * (bpar + nd) * np.cos(chi) - beta * nbp) * sph)) / zfun(bp)
    return Pp - P


def test_c3_conditional_density_of_one_su2_link():
    """Lemma C.5, set-up for SU(2) (section 4.3): on tori 3^D, D = 2, 3, 4, with random SU(2) link
    variables, the conditional density of link l is proportional to exp(beta b.v), v in S^3 the
    quaternion of U_l and b = (conjugate of the) sum of the 2(D-1) staples, |b| <= 2(D-1); changing
    one neighbouring link k changes exactly n_lk = 1 plaquette and |b - b'| <= 2, so that
    phi = (beta/2) sum_p [Tr U'_p - Tr U_p] takes values in [-2 beta, 2 beta] (osc(phi) <= 4 beta);
    the value |b - b'| = 2 is attained (U_k -> -U_k)."""
    rng = np.random.default_rng(301)
    for D in (2, 3, 4):
        lat = torus((3,) * D)
        maxd = 0.0
        for trial in range(6):
            U = [su2_matrix(q) for q in random_unit(rng, lat.nl)]
            l = int(rng.integers(lat.nl))
            b = su2_field_b(lat, U, l)
            assert np.linalg.norm(b) <= 2 * (D - 1) + 1e-12
            for _ in range(5):                                   # the density is exp(beta b.v)
                v = random_unit(rng)
                U2 = list(U)
                U2[l] = su2_matrix(v)
                s = sum(su2_plaquette_half_trace(U2, lat.plaq[ip]) for ip in lat.through[l])
                assert abs(s - b @ v) <= 1e-12
            for k in lat.ncommon[l]:
                U2 = list(U)
                U2[k] = su2_matrix(random_unit(rng))
                bp = su2_field_b(lat, U2, l)
                assert np.linalg.norm(bp - b) <= 2.0 + 1e-12
                maxd = max(maxd, float(np.linalg.norm(bp - b)))
                # phi(V) = (beta/2) sum_{p containing l and k} [Tr U'_p - Tr U_p] = beta (b'-b).v
                v = random_unit(rng)
                U3, U4 = list(U), list(U2)
                U3[l] = U4[l] = su2_matrix(v)
                common = [ip for ip in lat.through[l] if k in lat.plaq[ip]]
                assert len(common) == 1
                dphi = sum(su2_plaquette_half_trace(U4, lat.plaq[ip]) - su2_plaquette_half_trace(U3, lat.plaq[ip])
                           for ip in common)
                assert abs(dphi - (bp - b) @ v) <= 1e-12 and abs(dphi) <= 2.0 + 1e-12
                # a non-neighbour does not enter the conditional density at all
            far = [k for k in range(lat.nl) if k != l and k not in lat.ncommon[l]]
            if far:
                U2 = list(U)
                U2[far[0]] = su2_matrix(random_unit(rng))
                assert np.abs(su2_field_b(lat, U2, l) - b).max() == 0.0
            k = next(iter(lat.ncommon[l]))                       # |b - b'| = 2 is attained
            U2 = list(U)
            U2[k] = -U[k]
            assert abs(np.linalg.norm(su2_field_b(lat, U2, l) - b) - 2.0) <= 1e-12
        assert maxd > 1.0


def test_c3_quadrature_on_s3_is_validated():
    """Validation of the S^3 quadrature used for Lemma C.5: the normalisation
    int exp(beta b.v) dv = 2 I_1(beta |b|)/(beta |b|) (the one-plaquette integral, THEORY.md 5.6),
    agreement of three computations of the distance (adapted 2-d Gauss quadrature, plain 3-d
    product quadrature in fixed coordinates, 1-d integral), and the closed form
    d_TV = L_1(beta)/I_1(beta) (modified Struve / Bessel) for b = -b' a unit vector."""
    rng = np.random.default_rng(302)
    worst_generic = 0.0
    for beta in (0.05, 0.5, 2.0):
        for _ in range(6):
            b = rng.normal(size=4) * rng.uniform(0.2, 2.0)
            bp = b + random_unit(rng) * rng.uniform(0.2, 2.0)
            tv, Z, Zp = su2_tv(beta, b, bp)
            for z, vec in ((Z, b), (Zp, bp)):
                a = beta * np.linalg.norm(vec)
                assert abs(z / (2 * special.iv(1, a) / a) - 1) <= 1e-12
            assert abs(tv - su2_tv_1d(beta, b, bp)) <= 1e-12
            tvg, Zg, _ = su2_tv_generic(beta, b, bp)
            assert abs(Zg / Z - 1) <= 1e-9
            worst_generic = max(worst_generic, abs(tvg - tv))
    assert worst_generic <= 5e-4          # quadrature error of the plain product rule (kink)
    note("C3 quadrature: max |plain 3-d product rule - adapted rule|", f"{worst_generic:.2e}")
    e = np.array([1.0, 0, 0, 0])
    for beta in (0.01, 0.0556, 0.1682, 1.0, 5.0, 20.0):
        closed = special.modstruve(1, beta) / special.iv(1, beta)
        assert abs(su2_tv(beta, -e, e)[0] - closed) <= 1e-12
        assert abs(su2_tv_1d(beta, -e, e) - closed) <= 1e-12


C3_BETAS = (0.01, 0.0556, 0.0835, 0.1682, 0.5, 1.0, 3.0)


def test_c3_su2_dependency_coefficient_random_configurations():
    """Lemma C.5 for SU(2): c_lk <= tanh(beta n_lk) = tanh(beta).  For 4200 random choices
    (D = 2, 3, 4; seven beta from 0.01 to 3; the 2(D-1) staples Haar-random, the staple through the
    changed link replaced by a new Haar-random one, or by its negative) the total-variation
    distance between the two conditional densities, computed by quadrature on S^3, is <= tanh(beta)."""
    rng = np.random.default_rng(303)
    worst = {}
    for D in (2, 3, 4):
        for beta in C3_BETAS:
            w = 0.0
            for trial in range(200):
                s = random_unit(rng, 2 * (D - 1))
                b = s.sum(axis=0)
                new = -s[0] if trial % 4 == 0 else random_unit(rng)
                bp = b - s[0] + new
                assert np.linalg.norm(bp - b) <= 2.0 + 1e-12
                tv = su2_tv(beta, b, bp)[0]
                assert tv <= math.tanh(beta) + 1e-12, (D, beta, tv)
                w = max(w, tv / math.tanh(beta))
            worst[(D, beta)] = w
    note("C3 SU(2) random staples: max d_TV/tanh(beta) per (D, beta)",
         ", ".join(f"D={D} b={beta}: {w:.4f}" for (D, beta), w in worst.items()))


def _c3_family(par, D):
    """b = c + s, b' = c + s' with |s| = |s'| = 1 and c the sum of the other 2D-3 unit staples:
    |c| = 1 for D = 2 and 0 <= |c| <= 2D-3 for D >= 3.  Up to a rotation of R^4 this is every
    pair (b, b') that can occur; four parameters."""
    r, a, ap, g = par
    rho = 1.0 if D == 2 else (2 * D - 3) * 0.5 * (1.0 - math.cos(r))
    b = np.array([rho + math.cos(a), math.sin(a), 0.0, 0.0])
    bp = np.array([rho + math.cos(ap), math.sin(ap) * math.cos(g), math.sin(ap) * math.sin(g), 0.0])
    return b, bp


def _c3_worst(D, beta, rng, starts):
    def neg(par):
        b, bp = _c3_family(par, D)
        return -su2_tv_1d(beta, b, bp, n=48)

    grid = [(r, a, ap, g) for r in np.linspace(0, math.pi, 4) for a in np.linspace(0, math.pi, 5)
            for ap in np.linspace(0, math.pi, 5) for g in (0.0, math.pi / 2, math.pi)]
    vals = np.array([neg(par) for par in grid])
    best_par, best = grid[int(vals.argmin())], -float(vals.min())
    seeds = [grid[i] for i in np.argsort(vals)[:starts]] + [tuple(rng.uniform(0, math.pi, 4)) for _ in range(starts)]
    for x0 in seeds:
        res = minimize(neg, x0, method="Nelder-Mead", options=dict(maxiter=600, xatol=1e-7, fatol=1e-13))
        if -res.fun > best:
            best, best_par = -float(res.fun), res.x
    b, bp = _c3_family(best_par, D)
    return su2_tv(beta, b, bp)[0], b, bp


def su2_sup_tv(D, beta):
    """The SU(2) dependency coefficient between two neighbouring links, sup over all admissible
    pairs (b, b') of the total-variation distance, evaluated in the reduced family in which the
    four-parameter search of ``_c3_worst`` finds its maximum (checked in
    test_c3_su2_dependency_coefficient_worst_case):
      D >= 3:  b = -b' a unit vector (the other 2D-3 staples cancel), distance L_1(beta)/I_1(beta)
               (modified Struve / Bessel functions);
      D = 2:   b = c + s, b' = c + s' with s' the mirror image of s in the axis c; maximum over the
               angle between c and s."""
    if D >= 3:
        return float(special.modstruve(1, beta) / special.iv(1, beta))
    res = minimize_scalar(lambda a: -su2_tv_1d(beta, [1 + math.cos(a), math.sin(a), 0, 0],
                                               [1 + math.cos(a), -math.sin(a), 0, 0]),
                          bounds=(0.3, 2.8), method="bounded", options=dict(xatol=1e-9))
    return -float(res.fun)


@pytest.mark.parametrize("D", [2, 3, 4])
def test_c3_su2_dependency_coefficient_worst_case(D):
    """Lemma C.5 for SU(2), worst case: maximise the total-variation distance over all pairs
    (b, b') that can occur (grid search plus Nelder-Mead in the four-parameter family of
    ``_c3_family``) at beta = 0.02, beta_0(D), 2.4 beta_0(D) and 1, and check that the maximum,
    i.e. the SU(2) coefficient c_lk, is <= tanh(beta).  Measured, not claimed as a theorem in the
    document (it is the basis of the numerical remarks in 4.1 and 4.6): the maximum is attained in
    the reduced family of ``su2_sup_tv``; for D >= 3 it equals L_1(beta)/I_1(beta) (b = -b'), for
    D = 2 it is slightly smaller."""
    rng = np.random.default_rng(304 + D)
    out = []
    for beta in (0.02, beta0(D), 2.4 * beta0(D), 1.0):
        best, b, bp = _c3_worst(D, beta, rng, starts=2)
        assert best <= math.tanh(beta) + 1e-12, (D, beta, best)        # Lemma C.5
        # the search and the reduced family agree; 1e-9: the Nelder-Mead search stops at a
        # function tolerance of 1e-13 and the two quadratures agree to 1e-12
        assert abs(best - su2_sup_tv(D, beta)) <= 1e-9, (D, beta, best, su2_sup_tv(D, beta))
        closed = special.modstruve(1, beta) / special.iv(1, beta)
        assert best <= closed + 1e-9                    # nothing found above the antipodal value
        if D == 2:
            assert 0.98 * closed <= best < closed       # antipodal pair not admissible for D = 2
        out.append(f"beta={beta:.4f}: {best:.6f} = {best / math.tanh(beta):.4f} tanh(beta)")
    note(f"C3 SU(2) worst case D={D}: sup d_TV", "; ".join(out))


def test_c3_numbers_quoted_in_sections_4_1_and_4_6():
    """Section 4.1 (paragraph after the table) and 4.6 ("Hoe ver dit reikt"): "numerically the
    true dependency coefficient of SU(2) is about 4 beta/(3 pi) = 0.42 beta for small beta instead
    of tanh(beta), so that the sum over the neighbours at beta_0(D) is about 0.43 and reaches 1
    only at about 2.4 beta_0(D)".  The three numbers are read from the document.  Computed for
    D = 2, 3, 4 with the SU(2) coefficient sup d_TV of ``su2_sup_tv`` (quadrature on S^3) times
    the 6(D-1) neighbours:
      * slope: sup d_TV / beta -> 4/(3 pi) = 0.4244 for beta -> 0, printed 0.42 (rounded);
      * the sum at beta_0(D): 0.4274, 0.4252, 0.4248; "about 0.43" is accepted within one unit
        of the last printed digit (the D = 4 value rounds to 0.42);
      * the sum equals 1 at 2.36 beta_0(D), printed 2.4 (rounded); the sum is increasing there."""
    sec41 = _doc_text().split("### 4.1")[1].split("### 4.2")[0]
    sec46 = _doc_text().split("### 4.6")[1].split("## 5.")[0]
    m_slope = re.search(r"4\\beta/\(3\\pi\) \\approx ([0-9{},]+)\\ \\beta", sec41)
    m_sum = re.search(r"bij \$\\beta_0\(D\)\$ ongeveer \$([0-9{},]+)\$ is", sec41)
    m_one = re.search(r"pas bij ongeveer \$([0-9{},]+)\\ \\beta_0\(D\)\$ de waarde 1 bereikt", sec41)
    m_one46 = re.search(r"numeriek tot ongeveer \$([0-9{},]+)\\ \\beta_0\(D\)\$", sec46)
    assert m_slope and m_sum and m_one and m_one46, "the numerical remark is no longer in the document"
    slope_doc, sum_doc, one_doc = _num(m_slope.group(1)), _num(m_sum.group(1)), _num(m_one.group(1))
    assert _num(m_one46.group(1)) == one_doc
    slope = 4 / (3 * math.pi)
    assert abs(slope_doc - slope) <= 0.005 + 1e-12                    # rounded to two decimals
    sums, ones = [], []
    for D in (2, 3, 4):
        nb = 6 * (D - 1)
        # small-beta slope; the relative correction is of order beta^2 (5e-6 at beta = 0.01)
        ratios = [su2_sup_tv(D, beta) / beta for beta in (0.04, 0.02, 0.01)]
        assert abs(ratios[-1] / slope - 1) <= 1e-5
        assert abs(ratios[0] - slope) > abs(ratios[1] - slope) > abs(ratios[2] - slope)
        # "instead of tanh(beta)": the bound of Lemma C.5 is a factor 3 pi/4 above the true value
        assert abs(math.tanh(0.01) / su2_sup_tv(D, 0.01) / (3 * math.pi / 4) - 1) <= 1e-4
        b0 = beta0(D)
        s0 = nb * su2_sup_tv(D, b0)
        assert abs(s0 - sum_doc) <= 0.01, (D, s0)                     # "ongeveer 0,43"
        assert s0 < 0.5 < alpha(b0, D) == pytest.approx(1.0)
        f = lambda beta: nb * su2_sup_tv(D, beta) - 1.0
        grid = np.linspace(1.0, 3.0, 9) * b0
        vals = [f(beta) for beta in grid]
        assert all(a < b for a, b in zip(vals[:-1], vals[1:]))        # increasing in beta
        root = brentq(f, 2.0 * b0, 3.0 * b0, xtol=1e-12)
        assert abs(root / b0 - one_doc) <= 0.05 + 1e-12, (D, root / b0)   # rounded to one decimal
        sums.append(s0)
        ones.append(root)
    note("C3 SU(2): sum of the true coefficients over the 6(D-1) neighbours at beta_0(D), D=2,3,4",
         ", ".join(f"{v:.4f}" for v in sums))
    note("C3 SU(2): beta at which that sum reaches 1 (and in units of beta_0(D)), D=2,3,4",
         ", ".join(f"{v:.4f} ({v / beta0(D):.3f})" for D, v in zip((2, 3, 4), ones)))


def test_c3_su2_coefficient_tends_to_one_for_large_beta():
    """Section 5.3 ("Waarom stelling C daar niet komt"): for large beta the dependency coefficient
    between two neighbours approaches 1 (and hence the row sum approaches 6(D-1)).  Lower bounds on
    the SU(2) coefficient from explicit admissible pairs: D >= 3: b = s, b' = -s (the other three
    staples cancel), distance L_1(beta)/I_1(beta); D = 2: b = c + s, b' = c - s with c, s orthogonal
    unit vectors.  Both tend to 1; both stay below the bound tanh(beta) of Lemma C.5."""
    e0, e1 = np.array([1.0, 0, 0, 0]), np.array([0, 1.0, 0, 0])
    prev3 = prev2 = 0.0
    rows = []
    for beta in (0.5, 1.0, 2.0, 5.0, 10.0, 20.0, 50.0):
        tv3 = su2_tv(beta, e0, -e0)[0]
        tv2 = su2_tv(beta, e1 + e0, e1 - e0)[0]
        closed = special.modstruve(1, beta) / special.iv(1, beta)
        assert abs(tv3 - closed) <= 1e-10
        assert abs(tv2 - su2_tv_1d(beta, e1 + e0, e1 - e0, n=300)) <= 1e-10
        assert prev3 < tv3 <= math.tanh(beta) + 1e-12 and prev2 < tv2 <= math.tanh(beta) + 1e-12
        prev3, prev2 = tv3, tv2
        rows.append(f"beta={beta}: D>=3 {tv3:.6f}, D=2 {tv2:.6f}")
    assert prev3 > 1 - 1e-9 and prev2 > 1 - 1e-6           # at beta = 50
    assert su2_tv(5.0, e0, -e0)[0] > 0.97 and su2_tv(10.0, e1 + e0, e1 - e0)[0] > 0.97
    note("C3 section 5.3, SU(2) coefficient for large beta", "; ".join(rows))


# ======================================================================================
# C4.  Lemma C.5 in the Z2 laboratory: exact Dobrushin coefficients
# ======================================================================================
def n_matrix(lat):
    nm = np.zeros((lat.nl, lat.nl), dtype=int)
    for l in range(lat.nl):
        for k, v in lat.ncommon[l].items():
            nm[l, k] = v
    return nm


@pytest.mark.parametrize("beta", BETAS_D2 + (0.5, 2.0))
def test_c4_dobrushin_coefficients_z2_3x3(beta):
    """Lemma C.5 (B empty) for Z2 on the 3 x 3 torus, D = 2: the exact Dobrushin coefficients
    (maximum over all 2^18 configurations) satisfy c_lk <= tanh(beta n_lk) <= n_lk tanh(beta), are
    zero for non-neighbours, and every row sum is <= alpha(beta, 2) = 6 tanh(beta).  (Lemma C.5
    does not need beta < beta_0, so beta = 0.5 and 2 are included.)  Laboratory value, not claimed
    in the document: c_lk = tanh(2 beta)/2 for neighbours."""
    lat, sysm = z2_system(T33, beta)
    c, nm = sysm.c, n_matrix(lat)
    assert set(np.unique(nm)) == {0, 1}
    assert (c <= np.tanh(beta * nm) + FP).all()
    assert (np.tanh(beta * nm) <= nm * math.tanh(beta) + FP).all()
    assert np.abs(c[nm == 0]).max() <= 1e-14                    # non-neighbours (and diagonal)
    assert (c.sum(axis=1) <= alpha(beta, 2) + FP).all()
    assert np.abs(c[nm == 1] - 0.5 * math.tanh(2 * beta)).max() <= 1e-13
    note(f"C4 Z2 3x3 beta={beta}: max row sum of c / alpha", f"{c.sum(axis=1).max() / alpha(beta, 2):.6f}")


def z2_local_coefficients(lat, l, beta):
    """exact c_lk for all neighbours k of l in the Z2 model on any torus, by enumerating the
    6(D-1) neighbouring links only (the conditional law of U_l depends on nothing else)."""
    nb = sorted(lat.ncommon[l])
    pos = {k: i for i, k in enumerate(nb)}
    m = len(nb)
    field = np.zeros((2,) * m)                    # sum over plaquettes through l of the staple
    for ip in lat.through[l]:
        others = [k for k in lat.plaq[ip] if k != l]
        assert len(others) == 3
        field = field + sgn(m, pos[others[0]]) * sgn(m, pos[others[1]]) * sgn(m, pos[others[2]])
    plus = 1.0 / (1.0 + np.exp(-2.0 * beta * field))           # rho_l(+1 | U)
    return {k: delta(plus, pos[k]) for k in nb}                # TV on a two-point space


def test_c4_local_enumeration_agrees_with_brute_force():
    """Consistency of the two ways of computing exact Z2 Dobrushin coefficients (enumeration of
    all 2^18 configurations of the 3 x 3 torus versus enumeration of the 6 neighbours of a link)."""
    for beta in (0.1, 0.7):
        lat, sysm = z2_system(T33, beta)
        for l in (0, 5, 17):
            loc = z2_local_coefficients(lat, l, beta)
            for k in range(lat.nl):
                assert abs(sysm.c[l, k] - loc.get(k, 0.0)) <= 1e-14


@pytest.mark.parametrize("shape", [(3, 3, 3), (4, 3, 5), (3, 3, 3, 3)], ids=lambda s: "x".join(map(str, s)))
def test_c4_dobrushin_coefficients_z2_d3_d4(shape):
    """Lemma C.5 (B empty) for Z2 in D = 3 and D = 4: exact c_lk by enumeration of the 12 (D = 3)
    or 18 (D = 4) neighbouring links of one link per direction: c_lk <= tanh(beta n_lk), and the
    row sum is <= alpha(beta, D) = 6(D-1) tanh(beta)."""
    lat = torus(shape)
    D = lat.D
    for beta in (0.02, 0.05, 0.08, 0.5):
        for mu in range(D):
            l = lat.link(lat.sites[len(lat.sites) // 2], mu)
            loc = z2_local_coefficients(lat, l, beta)
            assert len(loc) == 6 * (D - 1)
            for k, ck in loc.items():
                assert ck <= math.tanh(beta * lat.n(l, k)) + FP
                assert abs(ck - 0.5 * math.tanh(2 * beta)) <= 1e-13          # laboratory value
            assert sum(loc.values()) <= alpha(beta, D) + FP


C4_FROZEN = {
    "one link": [h33(0, 0)],
    "plaquette": plaq33(0, 0),
    "row of horizontal links": [h33(0, 0), h33(1, 0), h33(2, 0)],
    "six scattered links": [h33(0, 0), v33(1, 1), h33(2, 2), v33(0, 2), h33(1, 1), v33(2, 0)],
    "all but a 2x1 block": sorted(set(range(18)) - set(plaq33(0, 0)) - set(plaq33(1, 0))),
}


@pytest.mark.parametrize("name", list(C4_FROZEN))
def test_c4_dobrushin_coefficients_with_frozen_links(name):
    """Lemma C.5 with frozen links (section 4.3): for several sets B and boundary conditions omega
    (all omega if |B| <= 4, else 12 random ones) the exact coefficients c^omega_lk of (R, mu^omega)
    on the 3 x 3 torus satisfy c^omega_lk <= tanh(beta n_lk), vanish for non-neighbours, and have
    row sums <= alpha(beta, 2)."""
    rng = np.random.default_rng(401)
    B = C4_FROZEN[name]
    lat = torus(T33)
    nm = n_matrix(lat)
    for beta in (0.10, 0.6):
        if len(B) <= 4:
            omegas = list(itertools.product((0, 1), repeat=len(B)))
        else:
            omegas = [tuple(rng.integers(0, 2, size=len(B))) for _ in range(12)]
        for omega in omegas:
            R, sysm = z2_frozen(T33, beta, B, omega)
            nR = nm[np.ix_(R, R)]
            assert (sysm.c <= np.tanh(beta * nR) + FP).all()
            assert np.abs(sysm.c[nR == 0]).max() <= 1e-14
            assert (sysm.c.sum(axis=1) <= alpha(beta, 2) + FP).all()


def d3_frozen_system(beta, rng, box=(2, 2, 2)):
    """(R, mu^omega) in D = 3 on the 3 x 3 x 3 torus: R = the links inside a box of sites (12 links
    for the unit cube), all other links frozen at a random omega.  Returns (lat, R, System)."""
    lat = torus((3, 3, 3))
    inside = lambda x: all(x[i] < box[i] for i in range(3))
    R = [lat.link(x, mu) for x in lat.sites for mu in range(3)
         if inside(x) and x[mu] + 1 < box[mu]]
    pos = {l: i for i, l in enumerate(R)}
    omega = rng.choice([1.0, -1.0], size=lat.nl)
    m = len(R)
    S = np.zeros((2,) * m)
    for p in lat.plaq:
        if not any(l in pos for l in p):
            continue                                  # constant factor, cancels in mu^omega
        term = np.ones((1,) * m)
        for l in p:
            term = term * (sgn(m, pos[l]) if l in pos else omega[l])
        S = S + term
    return lat, R, System(np.exp(beta * S))


def test_c4_dobrushin_coefficients_d3_frozen():
    """Lemma C.5 in D = 3 with frozen links: R = the 12 links of an elementary cube (and the 20
    links of a 2 x 2 x 3 box) of the 3 x 3 x 3 torus, all other links frozen at random omega:
    c^omega_lk <= tanh(beta n_lk), zero for non-neighbours, row sums <= alpha(beta, 3)."""
    rng = np.random.default_rng(402)
    for box, reps in (((2, 2, 2), 6), ((2, 2, 3), 1)):
        for beta in (0.05, 0.08, 0.4):
            for _ in range(reps):
                lat, R, sysm = d3_frozen_system(beta, rng, box)
                assert len(R) == {(2, 2, 2): 12, (2, 2, 3): 20}[box]
                nR = n_matrix(lat)[np.ix_(R, R)]
                assert (sysm.c <= np.tanh(beta * nR) + FP).all()
                assert np.abs(sysm.c[nR == 0]).max() <= 1e-14
                assert (sysm.c.sum(axis=1) <= alpha(beta, 3) + FP).all()


def test_c4_tanh_concavity_step():
    """Last step of the proof of Lemma C.5: tanh(n x) <= n tanh(x) for x >= 0 and integers n >= 0,
    and with (R2) the row-sum bound sum_k tanh(beta n_lk) <= 6(D-1) tanh(beta)."""
    x = np.concatenate([np.linspace(0, 5, 2001), np.logspace(-8, 2, 400)])
    for nn in range(0, 12):
        assert (np.tanh(nn * x) <= nn * np.tanh(x) + 1e-15).all()
    for shape in ((3, 3), (3, 3, 3), (3, 3, 3, 3)):
        lat = torus(shape)
        for beta in (0.01, 0.1, 1.0):
            for l in range(0, lat.nl, 7):
                assert sum(math.tanh(beta * v) for v in lat.ncommon[l].values()) <= alpha(beta, lat.D) + FP


# ======================================================================================
# C5.  Lemmas C.2, C.3, C.4 (section 4.2)
# ======================================================================================
def z2_test_functions(rng, sysm, nlocal=2):
    """functions on the configuration space of a Z2 system: random functions of all links, random
    functions of a few links, coordinate functions and indicators."""
    n = sysm.n
    out = [("random, all links", rng.normal(size=sysm.shape)),
           ("random uniform, all links", rng.uniform(-1, 1, size=sysm.shape))]
    for i in range(nlocal):
        axes = sorted(rng.choice(n, size=min(n, 2 + i), replace=False))
        out.append((f"random function of links {axes}", local_function(rng, sysm.shape, axes)))
    l = int(rng.integers(n))
    out.append((f"indicator U_{l} = +1", (sgn(n, l) > 0).astype(float)))
    return out


def test_c5_k1_k2_z2():
    """(K1) and (K2) of section 4.2 for the heat-bath operators Pi_l of the Z2 model on the 3 x 3
    torus and of a frozen system (R, mu^omega): Pi_l f does not depend on U_l, Pi_l 1 = 1,
    inf f <= Pi_l f <= sup f, pi(Pi_l f) = pi(f); rho_l(.|U) is a probability density."""
    rng = np.random.default_rng(501)
    _, sysm = z2_system(T33, 0.10)
    for _, f in z2_test_functions(rng, sysm, nlocal=1):
        assert_k1_k2(sysm, np.broadcast_to(f, sysm.shape))
    R, sub = z2_frozen(T33, 0.15, plaq33(0, 0), (0, 1, 1, 0))
    for _, f in z2_test_functions(rng, sub, nlocal=1):
        assert_k1_k2(sub, np.broadcast_to(f, sub.shape))


@pytest.mark.parametrize("beta", (0.10, 0.6))
def test_c5_lemma_c2_z2_torus(beta):
    """Lemma C.2 for Z2 on the 3 x 3 torus with the exact c_lk: delta_l(Pi_l f) = 0 and
    delta_k(Pi_l f) <= delta_k(f) + c_lk delta_l(f) for all 18 x 17 pairs (l, k), for random
    functions of all links and of a few links.  The lemma does not need beta < beta_0."""
    rng = np.random.default_rng(502)
    _, sysm = z2_system(T33, beta)
    worst = 0.0
    for _, f in z2_test_functions(rng, sysm, nlocal=2):
        worst = max(worst, lemma_c2_worst(sysm, f))
    note(f"C5 Lemma C.2, Z2 3x3 beta={beta}: max lhs/rhs (random f)", f"{worst:.6f}")


def test_c5_lemma_c2_is_sharp_for_functions_of_one_link():
    """Lemma C.2 is an equality for f = indicator of {U_l = +1} in the Z2 model: then
    delta_k(f) = 0 for k != l, delta_l(f) = 1 and delta_k(Pi_l f) = c_lk exactly."""
    for beta in (0.10, 0.6):
        _, sysm = z2_system(T33, beta)
        for l in (0, 7, 16):
            f = (sgn(sysm.n, l) > 0).astype(float)
            dg = delta_vec(sysm.Pi(l, f))
            assert np.abs(dg - sysm.c[l]).max() <= 1e-14
            assert lemma_c2_worst(sysm, f, links=[l]) >= 1.0 - 1e-12


@pytest.mark.parametrize("beta", BETAS_D2)
def test_c5_lemma_c3_and_c4_z2_torus_unit_weights(beta):
    """Lemma C.3 (a), (b), (c) with weights w = 1 for Z2 on the 3 x 3 torus, with lambda the exact
    alpha_pi = max_l sum_k c_lk and with lambda = alpha(beta, 2) = 6 tanh(beta) (the value used in
    the document, via Lemma C.5); hypothesis (4.1) is verified first.  Then Lemma C.4:
    || S^n f - mu(f) || <= alpha^n Delta(f), n = 0..6, for both values of alpha."""
    rng = np.random.default_rng(503)
    _, sysm = z2_system(T33, beta)
    al_exact, al_doc = float(sysm.c.sum(axis=1).max()), alpha(beta, 2)
    assert al_exact <= al_doc < 1.0
    w = np.ones(sysm.n)
    worst3 = worst4 = 0.0
    for _, f in z2_test_functions(rng, sysm, nlocal=2):
        # the returned ratio W(Sf)/(lambda W(f)) is largest for the smaller lambda = alpha_pi (exact)
        worst3 = max(worst3, lemma_c3_check(sysm, [(w, al_exact), (w, al_doc)], f, rng))
        worst4 = max(worst4, lemma_c4_check(sysm, (al_exact, al_doc), f, rng.permutation(sysm.n), 6))
    for lam in (al_exact, al_doc):
        lemma_c3_matrix_check(sysm.c, w, lam, rng.permutation(sysm.n))
    note(f"C5 Lemma C.3(c), Z2 3x3 beta={beta}: max W(Sf)/(alpha_pi W(f)), exact alpha_pi", f"{worst3:.4f}")
    note(f"C5 Lemma C.4,    Z2 3x3 beta={beta}: max ||S^n f - mu f|| / (alpha^n Delta f)", f"{worst4:.4f}")


@pytest.mark.parametrize("name", ["one link", "plaquette", "row of horizontal links", "six scattered links"])
def test_c5_lemma_c3_exponential_weights_of_proposition_c6(name):
    """Lemma C.3 (a), (b), (c) for the frozen Z2 systems (R, mu^omega) on the 3 x 3 torus with the
    weights of Propositie C.6, w_k = exp(-theta d(k,B)), lambda = alpha e^theta, for several theta
    in (0, ln(1/alpha)): first step 1 of the proof of C.6 (hypothesis (4.1) holds for these
    weights, with the exact c^omega and alpha = 6 tanh(beta)), then the three statements, and the
    matrix statement w.(A_n ... A_1 e_j) <= lambda w_j of the proof of (c)."""
    rng = np.random.default_rng(504)
    B = C4_FROZEN[name]
    lat = torus(T33)
    dist = lat.bfs(B)
    for beta in (0.05, 0.15):
        al = alpha(beta, 2)
        omega = tuple(rng.integers(0, 2, size=len(B)))
        R, sysm = z2_frozen(T33, beta, B, omega)
        assert (dist[R] >= 1).all()
        pairs = [(np.exp(-theta * dist[R]), al * math.exp(theta)) for theta in theta_grid(al)]
        for _, f in z2_test_functions(rng, sysm, nlocal=1)[:3]:
            lemma_c3_check(sysm, pairs, f, rng)
        for w, lam in pairs:
            lemma_c3_matrix_check(sysm.c, w, lam, rng.permutation(sysm.n))


def test_c5_lemmas_d3_frozen_system():
    """Lemmas C.2, C.3 (w = 1 and exponential weights) and C.4 in D = 3: the system (R, mu^omega)
    with R the 12 links of an elementary cube of the 3 x 3 x 3 torus, random omega, beta = 0.02,
    0.05, 0.08 (alpha = 12 tanh(beta) < 1)."""
    rng = np.random.default_rng(505)
    for beta in (0.02, 0.05, 0.08):
        lat, R, sysm = d3_frozen_system(beta, rng)
        al = alpha(beta, 3)
        dist = lat.bfs([l for l in range(lat.nl) if l not in set(R)])
        theta = 0.6 * math.log(1 / al)
        pairs = [(np.ones(sysm.n), al), (np.exp(-theta * dist[R]), al * math.exp(theta))]
        for _, f in z2_test_functions(rng, sysm, nlocal=2):
            lemma_c2_worst(sysm, f)
            lemma_c3_check(sysm, pairs, f, rng)
            lemma_c4_check(sysm, (al,), f, rng.permutation(sysm.n), 5)


def random_system(rng, kind, strength):
    """finite systems that are not gauge theories, for the general framework of section 4.2."""
    if kind == "dense":                          # arbitrary positive density, mixed numbers of states
        shape = (2, 3, 2, 3, 2, 2)
        return System(np.exp(strength * rng.normal(size=shape)))
    if kind == "ising":                          # Ising model on a random graph, random fields
        n = 9
        H = np.zeros((2,) * n)
        for i in range(n):
            H = H + 0.3 * rng.normal() * sgn(n, i)
            for j in range(i + 1, n):
                if rng.uniform() < 0.35:
                    H = H + strength * rng.choice([-1.0, 1.0]) * sgn(n, i) * sgn(n, j)
        return System(np.exp(H))
    if kind == "potts":                          # 3-state Potts chain with a random field
        n = 6
        H = np.zeros((3,) * n)
        eye = np.eye(3)
        for i in range(n):
            H = H + embed(0.2 * rng.normal(size=3), [i], n)
            H = H + strength * embed(eye, [i, (i + 1) % n], n)
        return System(np.exp(H))
    raise ValueError(kind)


@pytest.mark.parametrize("kind,strengths", [("dense", (0.05, 0.15, 0.25)), ("ising", (0.1, 0.25, 0.4)),
                                            ("potts", (0.2, 0.5, 0.8))])
def test_c5_general_framework_on_other_systems(kind, strengths):
    """Section 4.2 claims its lemmas for every finite system with a strictly positive density.
    Lemma C.2, Lemma C.3 (a), (b), (c) and Lemma C.4 on systems that are not gauge theories
    (dense random density with 2 and 3 states per site, Ising model on a random graph, 3-state
    Potts ring), with w = 1, lambda = alpha_pi (when alpha_pi <= 1) and with the sharpest
    admissible choice: w the Perron vector of the matrix c and lambda its spectral radius, for
    which (4.1) is an equality (where the graph of c is not connected this w has zero entries,
    which Lemma C.3 allows).  Functions: random, local, and all indicators of one variable
    (the equality case of Lemma C.2)."""
    rng = np.random.default_rng(506)
    used, worst2, worst3, worst4 = 0, 0.0, 0.0, 0.0
    for strength in strengths:
        for rep in range(3):
            sysm = random_system(rng, kind, strength)
            c, n = sysm.c, sysm.n
            al = float(c.sum(axis=1).max())
            ev, vec = np.linalg.eig(c)
            i0 = int(np.argmax(ev.real))
            rad, perron = float(ev[i0].real), np.abs(vec[:, i0].real)
            # if the graph of c is not connected, the Perron vector vanishes on the other components
            # and the eigenvalue routine returns entries of order 1e-16 there; set them to exactly
            # 0 (weights w_k = 0 are allowed in Lemma C.3, and (4.1) is checked in lemma_c3_check)
            perron = np.where(perron < 1e-9 * perron.max(), 0.0, perron)
            funcs = [rng.normal(size=sysm.shape), local_function(rng, sysm.shape, [0, 2]),
                     local_function(rng, sysm.shape, [1, 3, 4])]
            funcs += [embed(np.eye(sysm.shape[l])[0], [l], n) for l in range(n)]
            pairs = []
            if al <= 1.0:
                pairs.append((np.ones(n), al))
            if rad <= 1.0:
                pairs.append((perron, rad))
            for f in funcs:
                worst2 = max(worst2, lemma_c2_worst(sysm, f))
                if pairs:
                    worst3 = max(worst3, lemma_c3_check(sysm, pairs, f, rng))
                if al < 1.0:
                    worst4 = max(worst4, lemma_c4_check(sysm, (al,), f, rng.permutation(n), 8))
            if al <= 1.0:
                lemma_c3_matrix_check(c, np.ones(n), al, rng.permutation(n))
                used += 1
            if rad <= 1.0:
                assert lemma_c3_matrix_check(c, perron, rad, rng.permutation(n)) <= 1 + 1e-9
    assert used >= 3                                         # the contraction regime was reached
    assert worst2 >= 1.0 - 1e-9                              # Lemma C.2 is attained
    note(f"C5 general framework ({kind}): max ratios C.2 / C.3(c) / C.4",
         f"{worst2:.4f} / {worst3:.4f} / {worst4:.4f}")


def test_c5_osc_le_Delta_and_mean_deviation():
    """Two facts used in the proof of Lemma C.4: osc(h) <= Delta(h), and a function deviates from
    its mean pi(h) by at most osc(h)."""
    rng = np.random.default_rng(507)
    _, sysm = z2_system(T33, 0.10)
    for _, f in z2_test_functions(rng, sysm, nlocal=3):
        fb = np.broadcast_to(f, sysm.shape)
        assert osc(fb) <= delta_vec(fb).sum() + FP
        assert np.abs(fb - sysm.mean(fb)).max() <= osc(fb) + FP


# ======================================================================================
# C6.  section 4.3 and Propositie C.6
# ======================================================================================
def c6_functions(lat, B, rng, w=None, max_single=6):
    """test functions on G^R (arrays with length-1 axes on B) at various link distances from B."""
    n = lat.nl
    Bset = set(B)
    R = [l for l in range(n) if l not in Bset]
    dist = lat.bfs(B)
    out = []
    for d in sorted(set(dist[R])):                                    # single links at each distance
        ks = [k for k in R if dist[k] == d][:max_single]
        for k in ks:
            out.append((f"U_{k} (d={d})", sgn(n, k)))
        out.append((f"indicator U_{ks[0]}=+1 (d={d})", (sgn(n, ks[0]) > 0).astype(float)))
    for p in lat.plaq:                                                # (partial) plaquettes
        free = [l for l in p if l not in Bset]
        if free:
            f = np.ones((1,) * n)
            for l in free:
                f = f * sgn(n, l)
            out.append((f"product of the free links of plaquette {p}", f))
    shape_R = [1 if l in Bset else 2 for l in range(n)]
    for i in range(3):                                                # random local
        axes = sorted(rng.choice(R, size=min(len(R), 2 + i), replace=False))
        sh = [1] * n
        for a in axes:
            sh[a] = 2
        out.append((f"random function of links {axes}", rng.normal(size=sh)))
    out.append(("random function of all free links", rng.normal(size=shape_R)))
    if w is not None:                                                 # the extremal f for a pair
        # omega and omega' must differ on a frozen link that has a free neighbour, otherwise the
        # two measures can coincide and the indicator below is identically zero
        edge = [i for i, b in enumerate(B) if any(k not in Bset for k in lat.ncommon[b])]
        for _ in range(2):
            om = rng.integers(0, 2, size=len(B))
            flip = rng.integers(0, 2, size=len(B))
            flip[edge[int(rng.integers(len(edge)))]] = 1
            omp = om ^ flip
            ia, ib = [slice(None)] * n, [slice(None)] * n
            for b, o, op in zip(B, om, omp):
                ia[b], ib[b] = int(o), int(op)
            pa, pb = w[tuple(ia)], w[tuple(ib)]
            f = (pa / pa.sum() > pb / pb.sum()).astype(float).reshape(shape_R)
            out.append(("indicator of {p^omega > p^omega'} (attains the TV distance)", f))
    return out


C6_SETS = dict(C4_FROZEN)
C6_SETS["two opposite links"] = [h33(0, 0), h33(1, 1)]
C6_SETS["half of the links"] = [h33(x, y) for x in range(3) for y in range(3)]


def test_c6_decomposition_of_section_4_3():
    """Section 4.3: mu(F) = int mu_B(d omega) mu^omega(F(., omega)) with mu_B(d omega) =
    Z(omega) d omega / Z, and mu^omega = mu for B empty; exact on the 3 x 3 torus."""
    rng = np.random.default_rng(601)
    lat, sysm = z2_system(T33, 0.12)
    w = sysm.p
    F = rng.normal(size=sysm.shape)
    for name, B in C6_SETS.items():
        R_axes = tuple(l for l in range(lat.nl) if l not in set(B))
        Zom = w.sum(axis=R_axes)                                  # mu_B (w is normalised)
        mu_om = (w * F).sum(axis=R_axes) / Zom                    # mu^omega(F(., omega))
        assert abs(Zom.sum() - 1.0) <= FP
        assert abs(float((Zom * mu_om).sum()) - sysm.mean(F)) <= FP
        # mu^omega computed from the frozen system agrees
        omega = tuple(rng.integers(0, 2, size=len(B)))
        idx = [slice(None)] * lat.nl
        for b, o in zip(B, omega):
            idx[b] = int(o)
        R, sub = z2_frozen(T33, 0.12, B, omega)
        # mu_om has one axis per link of B in increasing order of the link index, B itself need
        # not be sorted (a plaquette is listed in the order of section 1.2)
        om_sorted = tuple(int(omega[i]) for i in np.argsort(B))
        assert abs(sub.mean(F[tuple(idx)]) - float(mu_om[om_sorted])) <= FP


@pytest.mark.parametrize("name", ["one link", "plaquette", "six scattered links"])
def test_c6_step_2_of_the_proof(name):
    """Propositie C.6, step 2: for l not in dB = {l in R : d(l,B) = 1} the operators Pi^omega_l and
    Pi^omega'_l coincide (no plaquette through l contains a link of B); for l in dB,
    || Pi^omega_l h - Pi^omega'_l h || <= delta_l(h)  (4.2)."""
    rng = np.random.default_rng(602)
    B = C4_FROZEN[name]
    lat = torus(T33)
    dist = lat.bfs(B)
    worst = 0.0
    for beta in (0.10, 0.9):
        for _ in range(3):
            om, omp = tuple(rng.integers(0, 2, size=len(B))), tuple(rng.integers(0, 2, size=len(B)))
            R, s1 = z2_frozen(T33, beta, B, om)
            _, s2 = z2_frozen(T33, beta, B, omp)
            for _, h in z2_test_functions(rng, s1, nlocal=2):
                for i, l in enumerate(R):
                    diff = float(np.abs(s1.Pi(i, h) - s2.Pi(i, h)).max())
                    touches = any(k in set(B) for ip in lat.through[l] for k in lat.plaq[ip])
                    assert touches == (dist[l] == 1)
                    if dist[l] != 1:
                        assert diff <= 1e-14
                    else:
                        dl = delta(np.broadcast_to(h, s1.shape), i)
                        assert diff <= dl + FP
                        if dl > 0:
                            worst = max(worst, diff / dl)
    note(f"C6 step 2 (4.2), B = {name}: max ||Pi^w h - Pi^w' h|| / delta_l(h)", f"{worst:.4f}")


def test_c6_step_3_telescoping_sum():
    """Propositie C.6, step 3, on the 3 x 3 torus (B = one plaquette, beta = 0.15): with
    f_i = Pi^omega_{l_i} f_{i-1} along repeated rounds, (i) mu^omega'(f) - mu^omega'(f_{n|R|}) is the
    telescoping sum of mu^omega'(Pi^omega'_{l_i} f_{i-1} - Pi^omega_{l_i} f_{i-1}); (ii) f_{n|R|}
    converges uniformly to mu^omega(f) at rate alpha^n Delta(f) (Lemma C.4); (iii) only l_i in dB
    contribute and each term is bounded by delta_{l_i}(f_{i-1}); (iv) the chain of inequalities at
    the end of the proof, sum_{l_i in dB} delta_{l_i}(f_{i-1}) <= e^theta/(1-lambda) W(f)."""
    rng = np.random.default_rng(603)
    beta, B = 0.15, plaq33(0, 0)
    al = alpha(beta, 2)
    lat = torus(T33)
    dist = lat.bfs(B)
    om, omp = (0, 0, 0, 0), (1, 0, 0, 0)
    R, s1 = z2_frozen(T33, beta, B, om)
    _, s2 = z2_frozen(T33, beta, B, omp)
    nR = len(R)
    for _, f in z2_test_functions(rng, s1, nlocal=2):
        f = np.broadcast_to(f, s1.shape)
        Df = float(delta_vec(f).sum())
        target = s2.mean(f) - s1.mean(f)
        g, tele, boundary_sum = f, 0.0, 0.0
        nrounds = 12
        for rnd in range(nrounds):
            for i in range(nR):
                d_i = delta(np.broadcast_to(g, s1.shape), i)
                term = s2.mean(s2.Pi(i, g) - s1.Pi(i, g))
                assert abs(s2.mean(g) - s2.mean(s2.Pi(i, g))) <= FP * (1 + Df)            # (K2)
                if dist[R[i]] == 1:
                    assert abs(term) <= d_i + FP
                    boundary_sum += d_i
                else:
                    assert abs(term) <= 1e-14
                tele += term
                g = s1.Pi(i, g)
            assert abs(tele - (s2.mean(f) - s2.mean(g))) <= 1e-12 * (1 + Df)            # (i)
            assert np.abs(g - s1.mean(f)).max() <= al ** (rnd + 1) * Df + FP            # (ii)
        assert abs(tele - target) <= al ** nrounds * Df + 1e-12
        for theta in theta_grid(al):
            Wf = float(np.exp(-theta * dist[R]) @ delta_vec(f))
            assert abs(target) <= boundary_sum + 1e-12
            assert boundary_sum <= math.exp(theta) / (1 - al * math.exp(theta)) * Wf + FP


@pytest.mark.parametrize("beta", BETAS_D2)
def test_c6_proposition_c6_on_the_3x3_torus(beta):
    """Propositie C.6 on the 3 x 3 torus (D = 2): for seven frozen sets B, ALL pairs of boundary
    conditions omega, omega' (exact sup over omega, omega'), functions f at link distances 1, 2, 3
    from B (single links, products of links, random local and global functions, and the indicator
    that attains the total-variation distance of mu^omega and mu^omega'), and five theta in
    (0, ln(1/alpha)):  |mu^omega(f) - mu^omega'(f)| <= e^theta/(1 - alpha e^theta)
    sum_k e^{-theta d(k,B)} delta_k(f)."""
    rng = np.random.default_rng(604)
    lat, sysm = z2_system(T33, beta)
    w = sysm.p
    al = alpha(beta, 2)
    worst, nfun, dmax = 0.0, 0, 0
    for name, B in C6_SETS.items():
        dist = lat.bfs(B)
        R = [l for l in range(lat.nl) if l not in set(B)]
        dmax = max(dmax, int(dist[R].max()))
        for fname, f in c6_functions(lat, B, rng, w):
            mu = mu_all_omega(w, f, B)
            lhs = float(mu.max() - mu.min())                       # sup over omega, omega'
            df = np.array([delta(f, k) for k in R])
            for theta in theta_grid(al):
                rhs = c_theta(al, theta) * float(np.exp(-theta * dist[R]) @ df)
                assert lhs <= rhs + FP, (name, fname, theta, lhs, rhs)
                if rhs > 0.0:               # rhs = 0 only for a constant f (then lhs = 0 as well)
                    worst = max(worst, lhs / rhs)
            nfun += 1
    assert dmax >= 3
    note(f"C6 Propositie C.6, Z2 3x3 beta={beta}: max lhs/rhs over {nfun} (B, f) and 5 theta", f"{worst:.4f}")


def test_c6_argument_of_proposition_c6_on_ising_graphs():
    """The proof of Propositie C.6 uses only the framework of 4.2 and "c_lk = 0 unless l, k are
    neighbours".  Sharper test of that argument on Ising models on random graphs (10 spins, graph
    distance, two frozen spins, couplings chosen so that the exact alpha_omega = max row sum of
    c^omega is between 0.3 and 1):  |mu^omega(f) - mu^omega'(f)| <= e^theta/(1 - alpha_omega
    e^theta) sum_k e^{-theta d(k,B)} delta_k(f)  for all omega' and theta in (0, ln(1/alpha))."""
    rng = np.random.default_rng(605)
    n, used, worst = 10, 0, 0.0
    for trial in range(30):
        J = np.zeros((n, n))
        for i in range(n):
            j = (i + 1) % n
            J[i, j] = J[j, i] = rng.choice([-1.0, 1.0])            # a ring, so the graph is connected
        for _ in range(4):
            i, j = rng.choice(n, size=2, replace=False)
            J[i, j] = J[j, i] = rng.choice([-1.0, 1.0])
        strength = rng.uniform(0.12, 0.3)
        H = np.zeros((2,) * n)
        for i in range(n):
            H = H + 0.2 * rng.normal() * sgn(n, i)
            for j in range(i + 1, n):
                if J[i, j] != 0:
                    H = H + strength * J[i, j] * sgn(n, i) * sgn(n, j)
        w = np.exp(H)
        B = sorted(rng.choice(n, size=2, replace=False))
        R = [l for l in range(n) if l not in B]
        dist = np.full(n, -1)                                      # graph distance to B
        dist[B] = 0
        frontier = list(B)
        while frontier:
            nxt = []
            for a in frontier:
                for b in np.nonzero(J[a])[0]:
                    if dist[b] < 0:
                        dist[b] = dist[a] + 1
                        nxt.append(b)
            frontier = nxt
        for om in itertools.product((0, 1), repeat=2):
            idx = [slice(None)] * n
            idx[B[0]], idx[B[1]] = om
            sub = System(w[tuple(idx)])
            adj = (J[np.ix_(R, R)] != 0)
            assert np.abs(sub.c[~adj]).max() <= 1e-14              # c = 0 for non-neighbours
            al = float(sub.c.sum(axis=1).max())
            if not 0.3 < al < 1.0:
                continue
            used += 1
            funcs = [sgn(n, k) for k in R] + [local_function(rng, [1 if l in B else 2 for l in range(n)], R[:3]),
                                              rng.normal(size=[1 if l in B else 2 for l in range(n)])]
            for f in funcs:
                mu = mu_all_omega(w, f, B)
                lhs = float(np.abs(mu - mu[om]).max())             # sup over omega'
                df = np.array([delta(f, k) for k in R])
                for theta in theta_grid(al):
                    rhs = c_theta(al, theta) * float(np.exp(-theta * dist[R]) @ df)
                    assert lhs <= rhs + FP
                    worst = max(worst, lhs / rhs)
    assert used >= 20
    note("C6 argument of C.6 on Ising graphs: max lhs/rhs", f"{worst:.4f} ({used} systems)")


def test_c6_decay_rate_of_proposition_c6_on_a_tree():
    """How much room is there in the decay rate of Propositie C.6?  In the Z2 laboratory the
    influence of frozen links decays much faster than the bound (a whole plaquette is needed for
    every step), so the tests above cannot tell e^{-theta d} from a faster rate.  The proof uses
    only the framework of 4.2 and "c_lk = 0 unless l, k are neighbours", so it also covers the
    Ising model on a binary tree of depth 3 (15 spins, coupling J, no field) with the 8 leaves
    frozen (B = leaves, d = graph distance, alpha = the exact max row sum of c^omega = 3 tanh J).
    Checked for J = 0.002, 0.01, 0.05, omega = all +, all omega' and five theta:
    |mu^omega(f) - mu^omega'(f)| <= e^theta/(1 - alpha e^theta) sum_k e^{-theta d(k,B)} delta_k(f)
    for the spins at distance 3 (root), 2 and 1, and for random functions.  Control (a fact about
    this laboratory, not a claim of the document): for the root the left side is 16 tanh(J)^3 to
    leading order, i.e. 0.59 alpha^3, and the inequality with e^{-2 theta d(k,B)} in place of
    e^{-theta d(k,B)} is FALSE for J <= 0.01; so the rate cannot be improved by a factor 2."""
    rng = np.random.default_rng(606)
    n = 15
    parent = {i: (i - 1) // 2 for i in range(1, n)}             # heap numbering: root 0, leaves 7..14
    B, R = list(range(7, 15)), list(range(7))
    depth = np.zeros(n, dtype=int)
    for i in range(1, n):
        depth[i] = depth[parent[i]] + 1
    dist = 3 - depth                                            # graph distance to the leaves
    shape_R = [2] * 7 + [1] * 8
    for J in (0.002, 0.01, 0.05):
        H = np.zeros((2,) * n)
        for i in range(1, n):
            H = H + J * sgn(n, i) * sgn(n, parent[i])
        w = np.exp(H)
        idx = [slice(None)] * n
        for b in B:
            idx[b] = 0                                          # omega = all +
        sub = System(w[tuple(idx)])
        adj = np.array([[parent.get(a) == b or parent.get(b) == a for b in R] for a in R])
        assert np.abs(sub.c[~adj]).max() <= 1e-14               # c = 0 for non-neighbours
        al = float(sub.c.sum(axis=1).max())
        assert abs(al - 3 * math.tanh(J)) <= 1e-12 and al < 1.0
        funcs = [sgn(n, k) for k in R] + [local_function(rng, shape_R, [0, 1, 2]), rng.normal(size=shape_R)]
        for f in funcs:
            mu = mu_all_omega(w, f, B)
            lhs = float(np.abs(mu - mu[(0,) * 8]).max())        # sup over omega'
            df = np.array([delta(f, k) for k in R])
            for theta in theta_grid(al):
                tree_rhs = c_theta(al, theta) * float(np.exp(-theta * dist[R]) @ df)
                assert lhs <= tree_rhs + 1e-15, (J, theta, lhs, tree_rhs)   # 1e-15: lhs is a
                #   difference of two exactly enumerated means of size <= 1e-2
        # control: the root spin (distance 3, delta = 2)
        mu = mu_all_omega(w, sgn(n, 0), B)
        lhs = float(np.abs(mu - mu[(0,) * 8]).max())
        assert abs(lhs / (16 * math.tanh(J) ** 3) - 1) <= 4 * J     # leading order, corrections O(J^2)
        theta = theta_grid(al)[-1]
        faster = c_theta(al, theta) * math.exp(-2 * theta * 3) * 2.0
        if J <= 0.01:
            assert lhs > 2 * faster
        note(f"C6 tree, J={J}: root |mu^w f - mu^w' f| / bound, and / (bound with e^(-2 theta d))",
             f"{lhs / (c_theta(al, theta) * math.exp(-theta * 3) * 2.0):.2e}, {lhs / faster:.2e}")


# ======================================================================================
# C7.  Stelling C, point 1
# ======================================================================================
def covariance(w, f, g):
    """mu(f g) - mu(f) mu(g) for the normalised weight array w."""
    return float((w * f * g).sum() - (w * f).sum() * (w * g).sum())


def point1_bounds(lat, A, B, f, g, al, theta):
    """the two right-hand sides of Stelling C point 1."""
    dist = lat.bfs(B)
    df = np.array([delta(f, k) for k in A])
    first = c_theta(al, theta) * osc(g) / 2.0 * float(np.exp(-theta * dist[A]) @ df)
    second = c_theta(al, theta) * osc(g) / 2.0 * float(df.sum()) * math.exp(-theta * dist[A].min())
    return first, second


def c7_cases(rng):
    """(name, A, B, f, g) on the 3 x 3 torus; f depends only on A, g only on B, A and B disjoint."""
    n = 18
    prod = lambda links: link_product(n, links)
    rnd = lambda links: local_function(rng, (2,) * n, links)
    p00, p11, p10 = plaq33(0, 0), plaq33(1, 1), plaq33(1, 0)
    cases = [
        ("two links of a plaquette vs the other two", p00[:2], p00[2:], prod(p00[:2]), prod(p00[2:])),
        ("three links of a plaquette vs the fourth", p00[:3], p00[3:], prod(p00[:3]), prod(p00[3:])),
        ("plaquette (0,0) vs plaquette (1,1)", p00, p11, prod(p00), prod(p11)),
        ("random f on plaquette (0,0), random g on plaquette (1,1)", p00, p11, rnd(p00), rnd(p11)),
        ("holonomy of row 0 vs holonomy of row 1", [h33(x, 0) for x in range(3)], [h33(x, 1) for x in range(3)],
         prod([h33(x, 0) for x in range(3)]), prod([h33(x, 1) for x in range(3)])),
        ("random F(u^0), G(u^1) on rows 0 and 1", [h33(x, 0) for x in range(3)], [h33(x, 1) for x in range(3)],
         rnd([h33(x, 0) for x in range(3)]), rnd([h33(x, 1) for x in range(3)])),
        ("half 2x1 loop vs other half", [v33(0, 0), h33(0, 0), h33(0, 1)], [h33(1, 0), v33(2, 0), h33(1, 1)],
         prod([v33(0, 0), h33(0, 0), h33(0, 1)]), prod([h33(1, 0), v33(2, 0), h33(1, 1)])),
        ("indicator on one link vs open staple", [h33(0, 0)], p00[1:],
         (sgn(n, h33(0, 0)) > 0).astype(float), prod(p00[1:])),
    ]
    for sizes in ((1, 1), (2, 5), (3, 3), (9, 9), (4, 14)):
        perm = rng.permutation(n)
        A, B = sorted(perm[:sizes[0]]), sorted(perm[sizes[0]:sizes[0] + sizes[1]])
        cases.append((f"random disjoint sets of sizes {sizes}, random f, g", A, B, rnd(A), rnd(B)))
        # a pair with non-trivial correlation: f = g-like characters on the two sets
        cases.append((f"random disjoint sets of sizes {sizes}, products of all links", A, B, prod(A), prod(B)))
    return cases


def test_c7_covariance_identity_of_the_proof():
    """Section 4.5, proof of point 1: for f on A, g on B (disjoint), R = complement of B and every
    constant c,  mu(fg) - mu(f) mu(g) = int mu_B(d omega) (g(omega) - c) [mu^omega(f) -
    int mu_B(d omega') mu^omega'(f)]; and the term in brackets is bounded by
    sup |mu^omega(f) - mu^omega'(f)|."""
    rng = np.random.default_rng(701)
    lat, sysm = z2_system(T33, 0.14)
    w = sysm.p
    for name, A, B, f, g in c7_cases(rng):
        assert not set(A) & set(B)
        R_axes = tuple(l for l in range(lat.nl) if l not in set(B))
        muB = w.sum(axis=R_axes)
        mu_om = (w * f).sum(axis=R_axes) / muB
        # g as a function of omega: one axis per link of B, in increasing order of link index
        gB = np.squeeze(np.broadcast_to(g, [2 if l in set(B) else 1 for l in range(lat.nl)]),
                        axis=R_axes)
        mean_f = float((muB * mu_om).sum())
        assert abs(mean_f - float((w * f).sum())) <= FP
        cov = covariance(w, f, g)
        for cst in (0.0, 0.5 * (g.max() + g.min()), 3.7):
            rhs = float((muB * (gB - cst) * (mu_om - mean_f)).sum())
            assert abs(cov - rhs) <= 1e-12 * (1 + abs(cst)) * (1 + np.abs(f).max() * np.abs(g).max())
        assert np.abs(mu_om - mean_f).max() <= (mu_om.max() - mu_om.min()) + FP


@pytest.mark.parametrize("beta", BETAS_D2)
def test_c7_covariance_bound_on_the_3x3_torus(beta):
    """Stelling C point 1 on the 3 x 3 torus (D = 2), exact covariances: for 18 choices of
    (A, B, f, g) and five theta in (0, ln(1/alpha)):
    |mu(fg) - mu(f)mu(g)| <= C_theta osc(g)/2 sum_{k in A} e^{-theta d(k,B)} delta_k(f)
                          <= C_theta osc(g)/2 Delta(f) e^{-theta d(A,B)}."""
    rng = np.random.default_rng(702)
    lat, sysm = z2_system(T33, beta)
    w = sysm.p
    al = alpha(beta, 2)
    worst, nonzero = 0.0, 0
    for name, A, B, f, g in c7_cases(rng):
        assert not set(A) & set(B)
        assert all(f.shape[l] == 1 for l in range(lat.nl) if l not in set(A))
        assert all(g.shape[l] == 1 for l in range(lat.nl) if l not in set(B))
        cov = abs(covariance(w, f, g))
        nonzero += cov > 1e-9
        for theta in theta_grid(al):
            first, second = point1_bounds(lat, np.array(A), B, f, g, al, theta)
            assert cov <= first + FP, (name, theta, cov, first)
            assert first <= second + FP * (1 + second)
            worst = max(worst, cov / first)
    assert nonzero >= 8
    note(f"C7 Stelling C point 1, Z2 3x3 beta={beta}: max |cov| / first bound", f"{worst:.5f}")


def test_c7_degenerate_cases_of_point_1():
    """Section 4.5, first lines of the proof of point 1, with the conventions of section 1.2
    (minimum over the empty set = infinity, e^{-theta infinity} = 0): if B is empty, g is constant,
    mu(fg) = mu(f)mu(g) and osc(g) = 0; if A is empty, f is constant and every delta_k(f) = 0; in
    both cases all three members of the inequality are zero."""
    rng = np.random.default_rng(703)
    lat, sysm = z2_system(T33, 0.15)
    w, n = sysm.p, lat.nl
    const = np.full((1,) * n, 1.7)
    h = local_function(rng, (2,) * n, plaq33(0, 0))
    for f, g in ((h, const), (const, h)):                       # B empty; A empty
        assert abs(covariance(w, f, g)) <= FP
        assert osc(const) == 0.0 and all(delta(const, k) == 0.0 for k in range(n))
    assert math.exp(-0.3 * math.inf) == 0.0                     # the convention is consistent


def test_c7_covariance_bound_all_indicator_functions():
    """Stelling C point 1, exhaustively: A = two links of a plaquette, B = the other two links (and
    A = one link, B = the three others): all 16 x 16 (resp. 4 x 64) pairs of {0,1}-valued
    functions f on A and g on B, beta = 0.05, 0.10, 0.15, five theta each."""
    lat = torus(T33)
    p = plaq33(1, 2)
    for A, B in ((p[:2], p[2:]), (p[:1], p[1:])):
        tabsA = [np.array(t, dtype=float).reshape((2,) * len(A)) for t in itertools.product((0, 1), repeat=2 ** len(A))]
        nB = 2 ** len(B)
        tabsB = [np.array(t, dtype=float).reshape((2,) * len(B)) for t in itertools.product((0, 1), repeat=nB)]
        if len(tabsB) > 64:
            tabsB = tabsB[::max(1, len(tabsB) // 64)][:64]
        for beta in BETAS_D2:
            _, sysm = z2_system(T33, beta)
            w, al = sysm.p, alpha(beta, 2)
            for ta in tabsA:
                f = embed(ta, A, lat.nl)
                for tb in tabsB:
                    g = embed(tb, B, lat.nl)
                    cov = abs(covariance(w, f, g))
                    for theta in (theta_grid(al)[0], theta_grid(al)[-1]):
                        first, second = point1_bounds(lat, np.array(A), B, f, g, al, theta)
                        assert cov <= first + FP and first <= second + FP


# ======================================================================================
# C8.  Stelling C, point 2: the transfer matrix of section 2.2 for Z2 and its gap
# ======================================================================================
def site_stars(slat):
    """for every site x of the spatial lattice the links (x,i) and (x-i,i): the links whose value
    changes sign under the gauge transformation g_x = -1  ((u^g)_(x,i) = g_x u_(x,i) g_(x+i))."""
    stars = []
    for x in slat.sites:
        st = set()
        for i in range(slat.D):
            st.add(slat.link(x, i))
            st.add(slat.link(slat.shift(x, i, -1), i))
        stars.append(tuple(sorted(st)))
    return stars


def spatial_plaquette_sum(slat):
    n = slat.nl
    S = np.zeros((2,) * n)
    for p in slat.plaq:
        S = S + sgn(n, p[0]) * sgn(n, p[1]) * sgn(n, p[2]) * sgn(n, p[3])
    return S


def z2_transfer_dense(slat, beta):
    """T = M K P M of section 2.2 for G = Z2 (Haar = normalised counting measure), literally, as
    a dense matrix acting on functions on the 2^|E| spatial configurations: (T f)(u) =
    sum_{u'} Tmat[u, u'] f(u').  Returns (T, P, K, Mdiag).  Configuration index: C order of an
    array of shape (2,)*|E| with index 0 <-> +1."""
    n = slat.nl
    N = 2 ** n
    conf = np.array(list(itertools.product((1.0, -1.0), repeat=n)))        # row a = configuration a
    K = np.exp(beta * conf @ conf.T) / N                                    # K(u,u') du'
    stars = site_stars(slat)
    weights = 2 ** (n - 1 - np.arange(n))
    P = np.zeros((N, N))
    for g in itertools.product((0, 1), repeat=len(stars)):
        ug = conf.copy()
        for gx, st in zip(g, stars):
            if gx:
                ug[:, list(st)] *= -1.0
        idx = ((1 - ug) / 2 @ weights).astype(int)
        P[np.arange(N), idx] += 1.0 / 2 ** len(stars)                       # (P f)(u) = int f(u^g) dg
    Mdiag = np.exp(0.5 * beta * spatial_plaquette_sum(slat)).reshape(-1)   # e^{-V/2}, V = -beta sum sigma_p
    T = Mdiag[:, None] * (K @ P) * Mdiag[None, :]
    return T, P, K, Mdiag


class Z2Slice:
    """matrix-free T = M K P M of section 2.2 for G = Z2 on functions on Z2^E, stored as arrays of
    shape (2,)*|E|: K is a tensor product of 2 x 2 matrices, P a product over sites of
    (1 + flip of the star)/2, M a diagonal."""

    def __init__(self, slat, beta):
        self.slat, self.beta, self.n = slat, beta, slat.nl
        self.shape = (2,) * self.n
        self.Mdiag = np.exp(0.5 * beta * spatial_plaquette_sum(slat))
        self.stars = site_stars(slat)

    def applyK(self, v):
        a, b = 0.5 * math.exp(self.beta), 0.5 * math.exp(-self.beta)
        for e in range(self.n):
            v = a * v + b * np.flip(v, axis=e)
        return v

    def applyP(self, v):
        for st in self.stars:
            v = 0.5 * (v + np.flip(v, axis=st))
        return v

    def apply(self, vec):
        v = np.asarray(vec, dtype=float).reshape(self.shape) * self.Mdiag
        v = self.applyK(self.applyP(v))
        return (v * self.Mdiag).reshape(-1)

    def kernel(self, u, up):
        """T(u,u') = e^{-V(u)/2} [int K(u^g, u') dg] e^{-V(u')/2} literally (sum over all gauge
        transformations); u, u' are +-1 vectors."""
        def halfV(c):
            return 0.5 * self.beta * sum(c[p[0]] * c[p[1]] * c[p[2]] * c[p[3]] for p in self.slat.plaq)
        tot = 0.0
        for g in itertools.product((0, 1), repeat=len(self.stars)):
            ug = np.array(u, dtype=float)
            for gx, st in zip(g, self.stars):
                if gx:
                    ug[list(st)] *= -1.0
            tot += math.exp(self.beta * float(ug @ up))
        return math.exp(halfV(u)) * tot / 2 ** len(self.stars) * math.exp(halfV(up))


def z2_cycles(slat):
    """all subsets S of spatial links (bit e of the code <-> link e) with even degree at every
    site: chi_S(u) = prod_{e in S} u_e is gauge invariant exactly for these S."""
    n = slat.nl
    codes = np.arange(2 ** n, dtype=np.int64)
    ok = np.ones(len(codes), dtype=bool)
    for st in site_stars(slat):
        par = np.zeros(len(codes), dtype=np.int64)
        for e in st:
            par ^= (codes >> e) & 1
        ok &= (par == 0)
    return codes[ok]


def z2_hinv_factors(slat, beta, sign=1.0):
    """the factors of T restricted to H_inv in the orthonormal basis of gauge-invariant characters
    chi_S:  T = M diag(Kd) M^T  with  Kd_S = cosh(beta)^(|E|-|S|) sinh(beta)^|S|  (K chi_S =
    Kd_S chi_S) and M the matrix of multiplication by e^{-V/2} = prod_p (cosh(beta/2) +
    sinh(beta/2) sigma_p), sigma_p chi_S = chi_{S + boundary(p)}.  With sign = -1 the matrix of
    prod_p (cosh(beta/2) - sinh(beta/2) sigma_p) = e^{+V/2}, the inverse of M.
    Returns (M, Kd, cycles, index)."""
    cyc = z2_cycles(slat)
    index = {int(c): i for i, c in enumerate(cyc)}
    m = len(cyc)
    size = np.array([bin(int(c)).count("1") for c in cyc])
    ch, sh = math.cosh(beta / 2), sign * math.sinh(beta / 2)
    M = np.eye(m)
    for p in slat.plaq:
        mask = 0
        for l in p:
            mask ^= 1 << l
        perm = np.array([index[int(c) ^ mask] for c in cyc])
        M = ch * M + sh * M[perm, :]
    Kd = np.cosh(beta) ** (slat.nl - size) * np.sinh(beta) ** size
    return M, Kd, cyc, index


def z2_transfer_hinv(slat, beta):
    """matrix of T restricted to H_inv in the orthonormal basis of gauge-invariant characters
    chi_S (see ``z2_hinv_factors``).  Returns (T, cycles, index)."""
    M, Kd, cyc, index = z2_hinv_factors(slat, beta)
    T = (M * Kd[None, :]) @ M.T
    return 0.5 * (T + T.T), cyc, index


def chi_array(n, code):
    """the character chi_S as an array of shape (2,)*n; bit e of code <-> link e."""
    f = np.ones((1,) * n)
    for e in range(n):
        if (code >> e) & 1:
            f = f * sgn(n, e)
    return np.broadcast_to(f, (2,) * n)


def characters_to_function(n, cyc, coeffs):
    """sum_S coeffs[S] chi_S as an array of shape (2,)*n (fast Walsh-Hadamard transform)."""
    a = np.zeros(2 ** n)
    pos = np.zeros(len(cyc), dtype=np.int64)
    for e in range(n):                                 # link e is axis e: weight 2^(n-1-e)
        pos |= ((np.asarray(cyc) >> e) & 1) << (n - 1 - e)
    a[pos] = coeffs
    a = a.reshape((2,) * n)
    for e in range(n):
        i0, i1 = [slice(None)] * n, [slice(None)] * n
        i0[e], i1[e] = 0, 1
        a = np.stack([a[tuple(i0)] + a[tuple(i1)], a[tuple(i0)] - a[tuple(i1)]], axis=e)
    return a


def gap_bound(beta, D):
    return math.log(1.0 / alpha(beta, D))


@pytest.mark.parametrize("L", [3, 4, 5])
def test_c8_gap_d2_rings(L):
    """Stelling C point 2 for Z2 in D = 2 (ring of L links): T = M K P M built literally as in
    section 2.2 (M = 1); T is symmetric, positive semidefinite, T = PT = TP, P is an orthogonal
    projection commuting with K (Stelling A points 1-2 in the laboratory); H_inv has dimension 2,
    lambda_0 = cosh(beta)^L, lambda_1 = sinh(beta)^L (closed form, derived as in Stelling B: K acts
    on the characters 1 and h = u_1...u_L of the holonomy), hence m = L ln coth(beta); and
    m >= ln(1/(6 tanh beta)) for five beta below beta_0(2) = 0.1682."""
    slat = torus((L,))
    for beta in (0.02, 0.05, 0.10, 0.15, 0.168):
        assert beta < beta0(2)
        T, P, K, _ = z2_transfer_dense(slat, beta)
        assert np.abs(T - T.T).max() <= 1e-15
        assert np.abs(P @ P - P).max() <= 1e-14 and np.abs(P - P.T).max() <= 1e-15
        assert np.abs(K @ P - P @ K).max() <= 1e-14
        assert np.abs(P @ T - T).max() <= 1e-14 and np.abs(T @ P - T).max() <= 1e-14
        assert (T > 0).all()                                    # strictly positive kernel
        lam = np.sort(np.linalg.eigvalsh(T))[::-1]
        assert lam[-1] >= -1e-14                                # positive semidefinite
        assert abs(lam[0] / math.cosh(beta) ** L - 1) <= 1e-12
        # a symmetric eigenvalue routine returns every eigenvalue with an ABSOLUTE error of order
        # eps * ||T|| = eps * lambda_0, so the relative error of lambda_1 (and the absolute error
        # of m = ln(lambda_0/lambda_1)) is of order eps * lambda_0/lambda_1 = eps * coth(beta)^L,
        # which is 7e-8 for L = 5, beta = 0.02; factor 20 for the constant
        tol1 = 1e-12 + 20 * np.finfo(float).eps * (1.0 / math.tanh(beta)) ** L
        assert abs(lam[1] / math.sinh(beta) ** L - 1) <= tol1
        assert np.abs(lam[2:]).max() <= 1e-14                   # T = 0 on the complement of H_inv
        assert round(np.trace(P)) == 2
        m = math.log(lam[0] / lam[1])
        assert abs(m - L * math.log(1.0 / math.tanh(beta))) <= 2 * tol1
        assert m >= gap_bound(beta, 2)
        note(f"C8 D=2 ring L={L} beta={beta}: gap m / bound", f"{m:.4f} / {gap_bound(beta, 2):.4f}")


def test_c8_transfer_matrix_reproduces_the_measure_on_the_3x3_torus():
    """Link between T and the measure mu (Stelling A points 1 and 5, used in the proof of point 2):
    for Z2 on the 3 x 3 torus (ring L = 3, N = 3 time layers), by enumeration of all 2^18
    configurations: Z = Tr T^N, and mu(F1(u^0) F2(u^t)) = Tr(F1 T^t F2 T^(N-t)) / Tr T^N for t = 1,
    2 and random functions F1, F2 of the three spatial links of a layer."""
    rng = np.random.default_rng(801)
    lat = torus(T33)
    for beta in (0.10, 0.7):
        w = np.exp(beta * z2_action(T33))
        T = z2_transfer_dense(torus((3,)), beta)[0]
        assert abs(np.trace(np.linalg.matrix_power(T, 3)) / w.mean() - 1) <= 1e-12        # Z = Tr T^N
        for t in (1, 2):
            t1, t2 = rng.normal(size=(2, 2, 2)), rng.normal(size=(2, 2, 2))
            F1 = embed(t1, [h33(x, 0) for x in range(3)], lat.nl)
            F2 = embed(t2, [h33(x, t) for x in range(3)], lat.nl)
            brute = float((w * F1 * F2).sum() / w.sum())
            tm = np.trace(np.diag(t1.reshape(-1)) @ np.linalg.matrix_power(T, t)
                          @ np.diag(t2.reshape(-1)) @ np.linalg.matrix_power(T, 3 - t)) / np.trace(np.linalg.matrix_power(T, 3))
            assert abs(brute - tm) <= 1e-12


def test_c8_transfer_matrix_code_validated_on_2x2x2():
    """Code validation for the D = 3 transfer matrix (M, K and P all non-trivial): on a 2 x 2 x 2
    lattice (outside the hypotheses of the document, extents 2, but the derivation of
    Z = Tr T^N in section 2.4 is the same) the literal dense T = M K P M on the 2^8 spatial
    configurations reproduces the brute-force sums over all 2^24 configurations: Z = Tr T^2 and two
    correlation functions; and the matrix-free operator and the character-basis matrix used for the
    3 x 3 spatial torus agree with the dense T."""
    lat, slat = torus((2, 2, 2)), torus((2, 2))
    n = lat.nl
    S = np.zeros((2,) * n, dtype=np.int8)
    for p in lat.plaq:
        S += (sgn(n, p[0], np.int8) * sgn(n, p[1], np.int8) * sgn(n, p[2], np.int8) * sgn(n, p[3], np.int8))
    sl = lambda x, y, t, mu: lat.link((x, y, t), mu)
    obs = {
        "plaquette(t=0) plaquette(t=1)": ([sl(0, 0, 0, 0), sl(1, 0, 0, 1), sl(0, 1, 0, 0), sl(0, 0, 0, 1)],
                                          [sl(0, 0, 1, 0), sl(1, 0, 1, 1), sl(0, 1, 1, 0), sl(0, 0, 1, 1)]),
        "loop(t=0) loop(t=1)": ([sl(0, 0, 0, 0), sl(1, 0, 0, 0)], [sl(0, 0, 1, 0), sl(1, 0, 1, 0)]),
    }
    hist = np.bincount((S.astype(np.int16) + 24).ravel(), minlength=49).astype(float)
    signed = {}
    for name, (l0, l1) in obs.items():
        F = np.ones((1,) * n, dtype=np.int8)
        for l in l0 + l1:
            F = F * sgn(n, l, np.int8)
        code = (S.astype(np.int16) + 24) + 49 * (F < 0)
        hh = np.bincount(code.ravel(), minlength=98).astype(float)
        signed[name] = hh[:49] - hh[49:]
    svals = np.arange(49) - 24.0
    smap = {(x, y, mu): slat.link((x, y), mu) for x in range(2) for y in range(2) for mu in range(2)}
    for beta in (0.08, 0.3, 0.9):
        boltz = np.exp(beta * svals)
        Zbrute = float(hist @ boltz) / 2 ** n                     # int w dU with Haar measure
        T = z2_transfer_dense(slat, beta)[0]
        T2 = T @ T
        assert abs(np.trace(T2) / Zbrute - 1) <= 1e-12
        conf = np.array(list(itertools.product((1.0, -1.0), repeat=slat.nl)))
        for name, (l0, l1) in obs.items():
            brute = float(signed[name] @ boltz) / float(hist @ boltz)
            spatial = [smap[(lat.sites[l // 3][0], lat.sites[l // 3][1], l % 3)] for l in l0]
            Fd = np.prod(conf[:, spatial], axis=1)
            tm = np.trace(np.diag(Fd) @ T @ np.diag(Fd) @ T) / np.trace(T2)
            assert abs(brute - tm) <= 1e-12, name
        # matrix-free operator = dense matrix
        op = Z2Slice(slat, beta)
        Tfree = np.array([op.apply(e) for e in np.eye(2 ** slat.nl)]).T
        assert np.abs(Tfree - T).max() <= 1e-14
        # character basis: same non-zero spectrum, and <chi_S, T chi_S'> = matrix element
        Th, cyc, _ = z2_transfer_hinv(slat, beta)
        assert len(cyc) == 2 ** (slat.nl - len(slat.sites) + 1)
        lam_dense = np.sort(np.linalg.eigvalsh(T))[::-1]
        lam_h = np.sort(np.linalg.eigvalsh(Th))[::-1]
        # eigenvalues of a 256 x 256 symmetric matrix: absolute error of order eps * 256 * ||T||
        # (||T|| = lambda_0 = 219 at beta = 0.9, where the observed difference is 4e-13)
        tol = 1e-13 * max(1.0, lam_dense[0])
        assert np.abs(lam_dense[:len(cyc)] - lam_h).max() <= tol
        assert np.abs(lam_dense[len(cyc):]).max() <= tol
        chis = np.array([chi_array(slat.nl, int(c)).reshape(-1) for c in cyc])
        assert np.abs(chis @ T @ chis.T / 2 ** slat.nl - Th).max() <= tol      # <chi_S, T chi_S'>


C8_BETAS_D3 = (0.02, 0.05, 0.08, 0.0835)


@lru_cache(maxsize=None)
def d3_hinv(beta, sshape=(3, 3)):
    slat = torus(sshape)
    Th, cyc, index = z2_transfer_hinv(slat, beta)
    lam, vec = np.linalg.eigh(Th)
    order = np.argsort(lam)[::-1]
    return slat, Th, cyc, index, lam[order], vec[:, order]


@pytest.mark.parametrize("beta", C8_BETAS_D3)
def test_c8_gap_d3_spatial_torus_3x3(beta):
    """Stelling C point 2 for Z2 in D = 3, spatial torus 3 x 3 (18 links, 2^18 configurations,
    H_inv of dimension 2^10): the exact gap m = ln(lambda_0/lambda_1) of T = M K P M restricted to
    H_inv (dense 1024 x 1024 matrix in the basis of gauge-invariant characters) satisfies
    m >= ln(1/(12 tanh beta)) for four beta below beta_0(3) = 0.08353.  Also Stelling A in the
    laboratory: T >= 0 and injective on H_inv, lambda_0 simple."""
    assert beta < beta0(3)
    slat, Th, cyc, index, lam, vec = d3_hinv(beta)
    assert len(cyc) == 1024
    # Stelling A point 2 (T injective on H_inv).  The smallest eigenvalue is of the order of
    # sinh(beta)^18 = 1e-31 ... 1e-20, far below the rounding error eps * lambda_0 = 2e-16 of a
    # dense eigenvalue routine, so its sign cannot be read off from eigvalsh (which returns
    # -1e-16 ... -3e-15 here).  What can be checked: (i) T >= 0 up to that rounding error;
    # (ii) T|H_inv = M diag(Kd) M^T with all Kd > 0 and M invertible (its inverse is the matrix of
    # e^{+V/2}), so T|H_inv is strictly positive definite.
    assert lam[-1] >= -1e-13 * lam[0]
    M, Kd, _, _ = z2_hinv_factors(slat, beta)
    Minv = z2_hinv_factors(slat, beta, sign=-1.0)[0]
    assert Kd.min() > 0.0
    assert np.abs(M @ Minv - np.eye(len(cyc))).max() <= 1e-12
    assert lam[0] > lam[1] * (1 + 1e-6)                         # unique vacuum
    m = math.log(lam[0] / lam[1])
    assert m >= gap_bound(beta, 3)                              # Stelling C point 2
    # code sanity (laboratory value, not claimed in the document): to leading order the lowest
    # excitation is a loop winding once around the torus (length 3), m ~ 3 ln coth(beta)
    assert abs(m / (3 * math.log(1 / math.tanh(beta))) - 1) < 0.01
    deg = int((np.abs(lam / lam[1] - 1) < 1e-8).sum())          # recorded only: 2 (two directions)
    near = int((np.abs(lam / lam[1] - 1) < 1e-2).sum())         # recorded only: the 6 winding loops
    note(f"C8 D=3 spatial 3x3 beta={beta}: gap m / bound ln(1/alpha)",
         f"{m:.5f} / {gap_bound(beta, 3):.5f}  (lambda_1: degeneracy {deg}, {near} levels within 1%)")


def test_c8_d3_operator_agrees_with_the_definition_of_section_2_2():
    """The 3 x 3 spatial torus (D = 3): (i) the matrix-free T applied to the indicator of a
    configuration u' reproduces the kernel T(u,u') = e^{-V(u)/2} int K(u^g,u') dg e^{-V(u')/2} of
    section 2.4 step 4, evaluated literally (sum over the 2^9 gauge transformations) at random
    u, u'; (ii) T = T P = P T and symmetry on random vectors; (iii) matrix elements
    <chi_S, T chi_S'> of the matrix-free operator equal those of the 1024 x 1024 matrix."""
    rng = np.random.default_rng(803)
    beta = 0.08
    slat, Th, cyc, index, lam, vec = d3_hinv(beta)
    op = Z2Slice(slat, beta)
    N = 2 ** slat.nl
    weights = 2 ** (slat.nl - 1 - np.arange(slat.nl))
    for _ in range(3):
        up = rng.choice([1.0, -1.0], size=slat.nl)
        e = np.zeros(N)
        e[int(((1 - up) / 2) @ weights)] = 1.0
        col = op.apply(e) * N                                    # T(., u')
        for _ in range(4):
            u = rng.choice([1.0, -1.0], size=slat.nl)
            assert abs(col[int(((1 - u) / 2) @ weights)] / op.kernel(u, up) - 1) <= 1e-12
    x, y = rng.normal(size=N), rng.normal(size=N)
    Tx, Ty = op.apply(x), op.apply(y)
    assert abs(x @ Ty - y @ Tx) <= 1e-9 * abs(x @ Ty) + 1e-12   # symmetric
    Px = op.applyP(x.reshape(op.shape)).reshape(-1)
    assert np.abs(op.apply(Px) - Tx).max() <= 1e-13             # T P = T
    assert np.abs(op.applyP(Tx.reshape(op.shape)).reshape(-1) - Tx).max() <= 1e-13   # P T = T
    for _ in range(6):
        i, j = rng.integers(len(cyc), size=2)
        if rng.uniform() < 0.5:
            j = i
        ci = chi_array(slat.nl, int(cyc[i])).reshape(-1)
        cj = chi_array(slat.nl, int(cyc[j])).reshape(-1)
        assert abs(ci @ op.apply(cj) / N - Th[i, j]) <= 1e-13
    # a character that is not gauge invariant is annihilated
    bad = chi_array(slat.nl, 1).reshape(-1)
    assert np.abs(op.apply(bad)).max() <= 1e-14


def time_slice_covariances(lam, G, t, N):
    """Tr(F T^t F T^(N-t))/Tr T^N - (Tr(F T^N)/Tr T^N)^2 from the eigenvalues lam of T on H_inv
    and G = V^T F V (F in the eigenbasis)."""
    lt, lr, lN = lam ** t, lam ** (N - t), lam ** N
    ZN = lN.sum()
    two = float(lt @ (G * G) @ lr) / ZN
    one = float(np.diag(G) @ lN) / ZN
    return two - one * one


def test_c8_point_2_inequality_at_finite_N_d2():
    """Proof of point 2 (section 4.5), the displayed inequality before the limit N -> infinity,
    for Z2 in D = 2 on the 3 x N torus:  |mu(F(u^0)F(u^t)) - mu(F(u^0)) mu(F(u^t))| <=
    C_theta osc(F)/2 Delta(F) e^{-theta t}  for N >= max(3, 2t), t = 1..6, all 256 {0,1}-valued
    functions F of the three spatial links and random real F; left side from Stelling A point 5
    (transfer matrix, validated against enumeration in another test); also mu(F(u^t)) =
    mu(F(u^0)).  And the limit statement with F = psi_1/Omega = holonomy:
    (lambda_1/lambda_0)^t <= C_theta osc(F)/2 Delta(F) e^{-theta t}."""
    rng = np.random.default_rng(804)
    slat = torus((3,))
    tables = [np.array(tb, dtype=float) for tb in itertools.product((0, 1), repeat=8)]
    tables += [rng.normal(size=8) for _ in range(40)]
    Fs = np.array(tables)
    oscF = Fs.max(axis=1) - Fs.min(axis=1)
    DeltaF = np.array([delta_vec(tb.reshape(2, 2, 2)).sum() for tb in tables])
    worst = 0.0
    for beta in BETAS_D2:
        al = alpha(beta, 2)
        T = z2_transfer_dense(slat, beta)[0]
        pw = [np.eye(8)]
        for _ in range(16):
            pw.append(pw[-1] @ T)
        for t in range(1, 7):
            for N in sorted({max(3, 2 * t), 2 * t + 1, 2 * t + 4}):
                ZN = np.trace(pw[N])
                # mu(1_a(u^0) 1_b(u^t)) = T^t[a,b] T^(N-t)[b,a] / Z ;  mu(1_a(u^0)) = T^N[a,a]/Z
                joint = pw[t] * pw[N - t].T / ZN
                marg = np.diag(pw[N]) / ZN
                assert np.abs(joint.sum(axis=0) - marg).max() <= 1e-13        # time translation
                cov = np.abs(np.einsum("fa,ab,fb->f", Fs, joint, Fs) - (Fs @ marg) ** 2)
                for theta in theta_grid(al):
                    rhs = c_theta(al, theta) * oscF / 2 * DeltaF * math.exp(-theta * t)
                    assert (cov <= rhs + FP).all()
                    ok = rhs > 0
                    worst = max(worst, float((cov[ok] / rhs[ok]).max()))
        lam = np.sort(np.linalg.eigvalsh(T))[::-1]
        for theta in theta_grid(al):                 # F = psi_1/Omega = u_1 u_2 u_3: osc 2, Delta 6
            for t in range(1, 60):
                assert (lam[1] / lam[0]) ** t <= c_theta(al, theta) * 1.0 * 6.0 * math.exp(-theta * t)
    note("C8 point 2 at finite N (D=2, L=3): max |cov| / bound", f"{worst:.5f}")


def test_c8_point_2_inequality_d3():
    """Proof of point 2 for Z2 in D = 3 (lattice 3 x 3 x N): (i) finite N: the connected time
    correlation of F = sigma_p and of F = a loop winding around the torus, computed from the
    transfer matrix on H_inv (Stelling A point 5), is bounded by C_theta osc(F)/2 Delta(F)
    e^{-theta t} for N >= max(3, 2t); (ii) the choice F = psi_1/Omega of the proof: Omega > 0, F
    is a bounded gauge-invariant function on the 2^18 configurations, <psi_1, F Omega> = 1, and
    (lambda_1/lambda_0)^t <= C_theta osc(F)/2 Delta(F) e^{-theta t} for all t = 1..80, theta."""
    worst = 0.0
    for beta in (0.02, 0.05, 0.08):
        slat, Th, cyc, index, lam, vec = d3_hinv(beta)
        al = alpha(beta, 3)
        m = len(cyc)

        def shift_matrix(links):
            mask = 0
            for l in links:
                mask ^= 1 << l
            X = np.zeros((m, m))
            X[np.arange(m), [index[int(c) ^ mask] for c in cyc]] = 1.0
            return X

        loop = [slat.link((i, 0), 0) for i in range(3)]
        for links, oscF, DelF in ((list(slat.plaq[0]), 2.0, 8.0), (loop, 2.0, 6.0)):
            G = vec.T @ shift_matrix(links) @ vec
            for t in (1, 2, 3, 4):
                for N in sorted({max(3, 2 * t), 2 * t + 1, 2 * t + 5, 40}):
                    cov = abs(time_slice_covariances(lam / lam[0], G, t, N))
                    for theta in theta_grid(al):
                        rhs = c_theta(al, theta) * oscF / 2 * DelF * math.exp(-theta * t)
                        assert cov <= rhs + FP
                        worst = max(worst, cov / rhs)
        Om = characters_to_function(slat.nl, cyc, vec[:, 0])
        Om = Om * np.sign(Om.reshape(-1)[0])
        psi1 = characters_to_function(slat.nl, cyc, vec[:, 1])
        assert Om.min() > 0.0                                   # Stelling A point 3
        assert abs((Om ** 2).mean() - 1) <= 1e-10 and abs((psi1 ** 2).mean() - 1) <= 1e-10
        assert abs((Om * psi1).mean()) <= 1e-10
        F = psi1 / Om
        assert abs((psi1 * F * Om).mean() - 1) <= 1e-10         # <psi_1, F Omega> = 1
        oscF, DelF = osc(F), float(delta_vec(F).sum())
        for theta in theta_grid(al):
            for t in range(1, 81):
                assert (lam[1] / lam[0]) ** t <= c_theta(al, theta) * oscF / 2 * DelF * math.exp(-theta * t)
    note("C8 point 2 at finite N (D=3, 3x3xN): max |cov| / bound", f"{worst:.3e}")


def z2_dual_sectors(sshape, beta, k=3):
    """top eigenvalues of T on H_inv for a two-dimensional spatial torus (D = 3), sector by sector:
    every cycle is S = sum_p a_p boundary(p) + b_1 W_1 + b_2 W_2 (W_i a loop winding in direction
    i), with a and a + (1,...,1) giving the same cycle; in the variables a the operator M is a
    product of single-plaquette operators and K is diagonal.  Returns {(b1,b2): eigenvalues}."""
    slat = torus(sshape)
    L1, L2 = sshape
    nP = len(slat.plaq)
    shape = (2,) * nP
    ch, sh = math.cosh(beta / 2), math.sinh(beta / 2)
    bit = lambda p: sgn(nP, p)                                     # +1 <-> a_p = 0
    allax = tuple(range(nP))
    out = {}
    for b1 in (0, 1):
        for b2 in (0, 1):
            s0 = np.ones(slat.nl)
            if b1:
                for i in range(L1):
                    s0[slat.link((i, 0), 0)] = -1.0
            if b2:
                for j in range(L2):
                    s0[slat.link((0, j), 1)] = -1.0
            size = np.zeros(shape)                                 # |S|
            for e in range(slat.nl):
                p1, p2 = slat.through[e]
                size = size + 0.5 * (1.0 - bit(p1) * bit(p2) * s0[e])
            Kd = np.cosh(beta) ** (slat.nl - size) * np.sinh(beta) ** size

            def applyT(vec, Kd=Kd):
                v = vec.reshape(shape)
                v = 0.5 * (v + np.flip(v, axis=allax))             # functions of the cycle only
                for p in range(nP):
                    v = ch * v + sh * np.flip(v, axis=p)
                v = v * Kd
                for p in range(nP):
                    v = ch * v + sh * np.flip(v, axis=p)
                v = 0.5 * (v + np.flip(v, axis=allax))
                return v.reshape(-1)

            dim = 2 ** nP
            if dim <= 1024:
                Tm = np.array([applyT(e) for e in np.eye(dim)])
                lam = np.sort(np.linalg.eigvalsh(0.5 * (Tm + Tm.T)))[::-1][:k]
            else:
                op = LinearOperator((dim, dim), matvec=applyT, dtype=float)
                v0 = np.random.default_rng(11 + 2 * b1 + b2).normal(size=dim)
                lam = np.sort(eigsh(op, k=k, which="LA", v0=v0, tol=1e-12, return_eigenvectors=False))[::-1]
            out[(b1, b2)] = lam
    return out


def gap_from_sectors(sec):
    lam0 = sec[(0, 0)][0]
    lam1 = max([sec[(0, 0)][1]] + [sec[key][0] for key in sec if key != (0, 0)])
    return math.log(lam0 / lam1)


def test_c8_gap_d3_volume_dependence():
    """Stelling C point 2, "uniform in the volume", for Z2 in D = 3: the exact gap on the spatial
    tori 3 x 3, 3 x 4 and 4 x 4 (sector decomposition of H_inv; for 3 x 3 the result is compared
    with the 1024 x 1024 matrix) is >= ln(1/(12 tanh beta)) for beta = 0.02, 0.05, 0.08."""
    for beta in (0.02, 0.05, 0.08):
        slat, Th, cyc, index, lam, vec = d3_hinv(beta)
        sec = z2_dual_sectors((3, 3), beta)
        allv = np.sort(np.concatenate(list(sec.values())))[::-1]
        assert abs(allv[0] / lam[0] - 1) <= 1e-12 and abs(allv[1] / lam[1] - 1) <= 1e-9
        assert abs(gap_from_sectors(sec) - math.log(lam[0] / lam[1])) <= 1e-9
        for sshape in ((3, 4), (4, 4)):
            m = gap_from_sectors(z2_dual_sectors(sshape, beta))
            assert m >= gap_bound(beta, 3)
            note(f"C8 D=3 spatial {sshape[0]}x{sshape[1]} beta={beta}: gap m / bound", f"{m:.5f} / {gap_bound(beta, 3):.5f}")


@pytest.mark.slow
@pytest.mark.parametrize("beta", (0.02, 0.05, 0.08))
def test_c8_gap_d3_larger_spatial_torus(beta):
    """Stelling C point 2 for Z2 in D = 3 on the larger spatial torus 4 x 5 (40 links; sector
    decomposition of H_inv, four sectors of dimension 2^20, Lanczos): m >= ln(1/(12 tanh beta)).
    Recorded, and asserted only as a sanity check of the code: the gap does not shrink with the
    volume (lowest excitation of four plaquettes, m about 4 ln coth(beta))."""
    sshape = (4, 5)
    m = gap_from_sectors(z2_dual_sectors(sshape, beta))
    assert m >= gap_bound(beta, 3)
    assert m > 3.5 * math.log(1 / math.tanh(beta))
    note(f"C8 D=3 spatial {sshape[0]}x{sshape[1]} beta={beta}: gap m / bound", f"{m:.5f} / {gap_bound(beta, 3):.5f}")


@pytest.mark.slow
@pytest.mark.parametrize("beta", C8_BETAS_D3)
def test_c8_gap_d3_full_space_lanczos(beta):
    """Stelling C point 2 for Z2 in D = 3, spatial torus 3 x 3, computed on the full space of 2^18
    configurations: T = M K P M as a LinearOperator (tensor-product structure of K, site-by-site
    gauge averaging for P), largest eigenvalues by Lanczos (scipy eigsh).  They agree with the
    1024 x 1024 matrix on H_inv, and m = ln(lambda_0/lambda_1) >= ln(1/(12 tanh beta))."""
    slat, Th, cyc, index, lam, vec = d3_hinv(beta)
    op = Z2Slice(slat, beta)
    N = 2 ** slat.nl
    lop = LinearOperator((N, N), matvec=op.apply, dtype=float)
    v0 = np.random.default_rng(805).normal(size=N)
    ev = np.sort(eigsh(lop, k=8, which="LA", v0=v0, tol=1e-13, return_eigenvectors=False))[::-1]
    assert abs(ev[0] / lam[0] - 1) <= 1e-11
    assert np.abs(ev[1:8] / lam[1:8] - 1).max() <= 1e-6
    m = math.log(ev[0] / ev[1])
    assert abs(m - math.log(lam[0] / lam[1])) <= 1e-6
    assert m >= gap_bound(beta, 3)
    note(f"C8 D=3 3x3 full space (Lanczos) beta={beta}: gap m", f"{m:.6f}")


# ======================================================================================
# C9.  the numbers in the document
# ======================================================================================
def _doc_text():
    return DOC.read_text(encoding="utf-8")


def _num(s):
    return float(s.replace("{,}", ".").replace(",", "."))


def parse_table_4_1():
    """rows (D, beta_0 or None, beta, alpha, ln(1/alpha)) of the table in section 4.1."""
    sec = _doc_text().split("### 4.1")[1].split("### 4.2")[0]
    rows = []
    D = None
    for line in sec.splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) == 5 and re.fullmatch(r"\d", cells[0]):
            D = int(cells[0])
            rows.append((D, _num(cells[1]) if cells[1] else None, _num(cells[2]), _num(cells[3]), _num(cells[4])))
    return rows


try:
    TABLE_4_1 = parse_table_4_1()
except Exception:                                      # pragma: no cover - document missing
    TABLE_4_1 = []

HALF_ULP_4 = 0.5e-4 + 1e-9                             # a number correctly rounded to 4 decimals


def test_c9_table_4_1_is_found_in_the_document():
    """The table of section 4.1 is read from BEWIJZEN.md itself: nine rows, three per dimension
    D = 2, 3, 4, with the beta values 0.05/0.10/0.15, 0.02/0.05/0.08, 0.01/0.03/0.05."""
    assert [(r[0], r[2]) for r in TABLE_4_1] == [(2, 0.05), (2, 0.10), (2, 0.15), (3, 0.02), (3, 0.05),
                                                 (3, 0.08), (4, 0.01), (4, 0.03), (4, 0.05)]


@pytest.mark.parametrize("row", TABLE_4_1, ids=lambda r: f"D{r[0]}-beta{r[2]}")
def test_c9_table_4_1_row(row):
    """Table of section 4.1, one row: alpha(beta, D) = 6(D-1) tanh(beta) correctly rounded to the
    four decimals printed; the lower bound ln(1/alpha) rounded DOWN to four decimals, as the
    sentence after the table says (so that the printed number is itself a valid lower bound);
    beta < beta_0(D); and beta_0(D), rounded to nearest, where the row gives it."""
    D, b0, beta, al, lb = row
    assert beta < beta0(D)
    assert abs(al - alpha(beta, D)) <= HALF_ULP_4, f"alpha: document {al}, exact {alpha(beta, D):.8f}"
    exact = math.log(1.0 / alpha(beta, D))
    units = exact * 1e4                                # the exact value in units of the last digit
    assert abs(units - round(units)) > 1e-6            # not on a rounding boundary (double precision
    #                                                    resolves the floor without ambiguity)
    assert round(lb * 1e4) == math.floor(units), f"ln(1/alpha): document {lb}, exact {exact:.8f}"
    assert lb <= exact < lb + 1e-4 + 1e-12             # the same statement: printed <= exact
    if b0 is not None:
        assert abs(b0 - beta0(D)) <= HALF_ULP_4


def test_c9_table_4_1_rounding_convention_is_stated():
    """Section 4.1: the text after the table says that the last column is rounded down."""
    sec = _doc_text().split("### 4.1")[1].split("### 4.2")[0]
    assert "De ondergrens in de laatste kolom is naar beneden afgerond" in sec


def test_c9_beta0_values_and_closed_form():
    """Section 4.1 and section 0: beta_0(D) = artanh(1/(6(D-1))) = (1/2) ln((6D-5)/(6D-7));
    alpha(beta, D) < 1 exactly when beta < beta_0(D); beta_0(2) = 0.1682, beta_0(3) = 0.0835,
    beta_0(4) = 0.0556 (as printed in section 0, in the table and in sections 4.6 and 5.3)."""
    text = _doc_text()
    for D, printed in ((2, "0{,}1682"), (3, "0{,}0835"), (4, "0{,}0556")):
        b0 = beta0(D)
        assert abs(b0 - 0.5 * math.log((6 * D - 5) / (6 * D - 7))) <= 1e-15
        assert abs(alpha(b0, D) - 1.0) <= 1e-14
        assert alpha(b0 * (1 - 1e-9), D) < 1.0 < alpha(b0 * (1 + 1e-9), D)
        assert abs(_num(printed) - b0) <= HALF_ULP_4
        assert _num(printed) <= b0             # so "beta < printed value" implies beta < beta_0(D)
        assert f"\\beta_0({D}) = {printed}" in text
    for D in range(2, 12):
        assert abs(beta0(D) - 0.5 * math.log((6 * D - 5) / (6 * D - 7))) <= 1e-15
    assert "\\beta \\lt 0{,}0556" in text and "\\beta \\lt 0{,}1682" in text


def test_c9_remark_toets_aan_stelling_b():
    """Section 4.6, "Toets aan stelling B": at beta = 0.1, L = 3 the exact gap of Stelling B is
    3 x ln(I_1(0.1)/I_2(0.1)) = 3 x 3.689 = 11.07 and the lower bound of Stelling C is
    ln(1/(6 tanh 0.1)) = 0.514; the bound holds."""
    text = _doc_text()
    assert "3 \\times 3{,}689 = 11{,}07" in text and "0{,}514" in text
    per_link = math.log(special.iv(1, 0.1) / special.iv(2, 0.1))
    assert abs(per_link - 3.689) <= 0.5e-3
    assert abs(3 * per_link - 11.07) <= 0.5e-2
    bound = math.log(1.0 / (6 * math.tanh(0.1)))
    assert abs(bound - 0.514) <= 0.5e-3
    assert 3 * per_link >= bound
    # and for all L >= 3, beta < beta_0(2): the SU(2) gap of Stelling B is above the bound
    for beta in np.linspace(1e-3, beta0(2), 200, endpoint=False):
        assert 3 * math.log(special.iv(1, beta) / special.iv(2, beta)) >= math.log(1 / alpha(beta, 2))


def test_c9_remark_leading_strong_coupling_gap():
    """Section 4.1, paragraph after the table: for D = 4, beta = 0.03 the leading term of the
    strong-coupling series (THEORY.md 5.6; not a proved statement) is -4 ln u(beta) = 19.6 for the
    glueball in large volume and -3 ln u(beta) = 14.7 on a lattice whose smallest spatial extent is
    3, with u = I_2/I_1; both far above the proved lower bound 0.6164.  The two numbers are read
    from the document and must be correct to the one decimal printed."""
    sec = _doc_text().split("### 4.1")[1].split("### 4.2")[0]
    m4 = re.search(r"-4\\ln u\(\\beta\) \\approx ([0-9{},]+)", sec)
    m3 = re.search(r"-3\\ln u\(\\beta\) \\approx ([0-9{},]+)", sec)
    assert m4 and m3, "the two leading-order values are no longer in section 4.1"
    assert "voor $D = 4$ bij $\\beta = 0{,}03$" in sec and "u(\\beta) = I_2(\\beta)/I_1(\\beta)" in sec
    ln_u = math.log(special.iv(2, 0.03) / special.iv(1, 0.03))
    half_ulp_1 = 0.05 + 1e-9                                 # correctly rounded to one decimal
    assert abs(_num(m4.group(1)) - (-4 * ln_u)) <= half_ulp_1, (-4 * ln_u)
    assert abs(_num(m3.group(1)) - (-3 * ln_u)) <= half_ulp_1, (-3 * ln_u)
    # the series value of u: I_2/I_1 = (beta/4)(1 - beta^2/24 + O(beta^4)), independent of scipy
    assert abs(math.exp(ln_u) / (0.03 / 4 * (1 - 0.03 ** 2 / 24)) - 1) <= 1e-7
    assert -3 * ln_u > math.log(1 / alpha(0.03, 4))          # "veel groter" than the lower bound
    note("C9 leading strong-coupling gap D=4, beta=0.03: -4 ln u, -3 ln u, bound",
         f"{-4 * ln_u:.4f}, {-3 * ln_u:.4f}, {math.log(1 / alpha(0.03, 4)):.4f}")


def test_c9_section_5_3_correlation_length_bound():
    """Section 5.3 ("De afstand tussen bewezen en nodig"): Stelling C holds in four dimensions for
    beta < 0.0556; it gives only 1/m <= 1/ln(1/alpha), which is below one lattice spacing exactly
    when alpha < 1/e, in four dimensions for beta < artanh(1/(18 e)) = 0.0204.  The number is read
    from the document; it must be correctly rounded and on the safe side (at the printed value
    alpha is still below 1/e)."""
    text = _doc_text()
    sec = text.split("### 5.3")[1].split("### 5.4")[0]
    assert "Stelling C geldt in vier dimensies voor $\\beta \\lt 0{,}0556$" in sec
    assert "$1/m \\leq 1/\\ln(1/\\alpha)$" in sec
    mm = re.search(r"\\alpha \\lt 1/e\$, in vier dimensies voor \$\\beta \\lt ([0-9{},]+)\$", sec)
    assert mm, "the threshold for alpha < 1/e is no longer in section 5.3"
    printed = _num(mm.group(1))
    bstar = math.atanh(1.0 / (18 * math.e))                  # alpha(bstar, 4) = 1/e
    assert abs(alpha(bstar, 4) - 1 / math.e) <= 1e-15
    assert abs(printed - bstar) <= HALF_ULP_4, bstar
    assert alpha(printed, 4) < 1 / math.e                    # safe side
    for beta in (0.5 * bstar, 0.999 * bstar, printed):       # 1/ln(1/alpha) < 1 below the threshold
        assert 1.0 / math.log(1.0 / alpha(beta, 4)) < 1.0
    for beta in (1.001 * bstar, 0.03, 0.05, 0.0556):         # ... and > 1 above it
        assert 1.0 / math.log(1.0 / alpha(beta, 4)) > 1.0
    note("C9 section 5.3: alpha(beta,4) = 1/e at beta", f"{bstar:.6f}")


def _a_lambda(beta):
    """ln of a Lambda_L(beta) = (6 pi^2 beta/11)^(51/121) exp(-3 pi^2 beta/11)  (section 5.1)."""
    return (51.0 / 121.0) * math.log(6 * math.pi ** 2 * beta / 11) - 3 * math.pi ** 2 * beta / 11


def test_c9_section_5_3_doubling_of_the_correlation_length():
    """Section 5.3: "according to the formula of section 5.1 the correlation length doubles, for
    large beta, each time beta increases by about 0.26 (around beta = 2.4 that is about 0.27)"
    (both numbers read from the document).  The exponential factor exp(-3 pi^2 beta/11) alone
    gives the increase 11 ln 2/(3 pi^2) = 0.2575, which is the limit for beta -> infinity of the
    increase for the full formula; the first printed number must be that limit rounded to two
    decimals.  With the power prefactor the increase is larger at finite beta (0.2745 at
    beta = 2.4); the second printed number must be that value rounded to two decimals."""
    sec = _doc_text().split("### 5.3")[1].split("### 5.4")[0]
    mm = re.search(r"verdubbelt zij voor grote \$\\beta\$ telkens als \$\\beta\$ met ongeveer "
                   r"\$([0-9{},]+)\$ toeneemt \(rond \$\\beta = 2\{,\}4\$ is dat ongeveer \$([0-9{},]+)\$\)", sec)
    assert mm, "the doubling interval is no longer in section 5.3"
    printed, printed_24 = _num(mm.group(1)), _num(mm.group(2))
    limit = 11 * math.log(2) / (3 * math.pi ** 2)
    assert abs(printed - limit) <= 0.005 + 1e-9, limit

    def doubling(beta):                                      # solve a Lambda(beta + d) = a Lambda(beta)/2
        lo, hi = 0.0, 1.0
        for _ in range(60):
            mid = 0.5 * (lo + hi)
            if _a_lambda(beta + mid) - _a_lambda(beta) > -math.log(2):
                lo = mid
            else:
                hi = mid
        return 0.5 * (lo + hi)

    vals = {beta: doubling(beta) for beta in (2.3, 2.4, 2.5, 5.0, 20.0, 1000.0)}
    assert all(vals[a] > vals[b] for a, b in zip(list(vals)[:-1], list(vals)[1:]))   # decreasing
    assert abs(vals[1000.0] - limit) <= 1e-4
    assert all(abs(v - printed) <= 0.02 for v in vals.values())
    assert abs(vals[2.4] - printed_24) <= 0.005 + 1e-9, vals[2.4]    # 0.2745 printed as 0,27
    note("C9 section 5.3: increase of beta that doubles 1/(a Lambda_L)",
         ", ".join(f"beta={b}: {v:.4f}" for b, v in vals.items()) + f"; limit {limit:.4f}")


# ======================================================================================
# C10.  Stelling C, point 3 (infinite volume) in the Z2 laboratory, D = 2
# ======================================================================================
CUBE1 = cube_links(2, 1)                                   # the 12 links of R_1 in Z^2
CUBE1_PLAQ = [zd_plaquette((i, j), 0, 1) for i in (-1, 0) for j in (-1, 0)]


def walsh_coefficients(f):
    """hat f(S) = mean_U f(U) chi_S(U) for f of shape (2,)*n; result indexed by the indicator of S."""
    a = np.array(f, dtype=float)
    n = a.ndim
    for e in range(n):
        i0, i1 = [slice(None)] * n, [slice(None)] * n
        i0[e], i1[e] = 0, 1
        a = np.stack([(a[tuple(i0)] + a[tuple(i1)]) / 2, (a[tuple(i0)] - a[tuple(i1)]) / 2], axis=e)
    return a


def z2_d2_expectation(table, area, beta, minus_limit=False):
    """mu(f) for the Z2 model on a two-dimensional torus with ``area`` plaquettes, f = table a
    function of the 12 links of R_1 (axes in the order of CUBE1), from the character expansion:
    mu(chi_E) = (t^|Q| + t^(area-|Q|)) / (1 + t^area) if E is the boundary of a set Q of plaquettes
    (t = tanh beta) and 0 otherwise.  area = None gives the infinite-volume limit t^|Q|.
    With minus_limit = True the result is mu(f) - <f>, the finite-volume correction, computed
    term by term as (t^(area-|Q|) - t^(area+|Q|)) / (1 + t^area), i.e. without subtracting two
    numbers of order one (the correction is far below 1e-16 for area >= 49)."""
    t = math.tanh(beta)
    fh = walsh_coefficients(table)
    pos = {l: i for i, l in enumerate(CUBE1)}
    total = 0.0
    for Q in itertools.product((0, 1), repeat=4):
        ind = [0] * 12
        for q, p in zip(Q, CUBE1_PLAQ):
            if q:
                for l in p:
                    ind[pos[l]] ^= 1
        nq = sum(Q)
        if area is None:
            e = t ** nq
        elif minus_limit:
            e = (t ** (area - nq) - t ** (area + nq)) / (1 + t ** area)
        else:
            e = (t ** nq + t ** (area - nq)) / (1 + t ** area)
        total += fh[tuple(ind)] * e
    return float(total)


def c10_functions(rng):
    """functions of the 12 links of R_1: (name, table of shape (2,)*12)."""
    pos = {l: i for i, l in enumerate(CUBE1)}
    out = []
    plaq = np.ones((1,) * 12)
    for l in CUBE1_PLAQ[0]:
        plaq = plaq * sgn(12, pos[l])
    out.append(("one plaquette", np.broadcast_to(plaq, (2,) * 12)))
    big = np.ones((1,) * 12)
    for p in CUBE1_PLAQ:
        for l in p:
            big = big * sgn(12, pos[l])
    out.append(("2 x 2 Wilson loop", np.broadcast_to(big, (2,) * 12)))
    allplus = np.ones((2,) * 12)
    for p in CUBE1_PLAQ:
        allplus = allplus * (link_product(12, [pos[l] for l in p]) > 0)
    out.append(("indicator: all four plaquettes +1", allplus))
    out.append(("random function of the 12 links", rng.normal(size=(2,) * 12)))
    out.append(("random function of the 12 links (uniform)", rng.uniform(0, 1, size=(2,) * 12)))
    return out


def brute_force_expectation(shape, beta, table):
    lat = torus(shape)
    w = np.exp(beta * z2_action(shape))
    axes = [lat.link((x[0] % shape[0], x[1] % shape[1]), mu) for (x, mu) in CUBE1]
    assert len(set(axes)) == 12
    return float((w * embed(table, axes, lat.nl)).sum() / w.sum())


def test_c10_character_expansion_validated_by_enumeration():
    """Validation of the exact formula used for Stelling C point 3 in D = 2: for functions of the
    12 links of R_1 = links of the cube {-1,0,1}^2, the character-expansion value of mu_L(f)
    equals the enumeration of all 2^18 configurations of the 3 x 3 torus."""
    rng = np.random.default_rng(1001)
    for beta in (0.10, 0.168, 0.8):
        for name, table in c10_functions(rng):
            exact = z2_d2_expectation(table, 9, beta)
            assert abs(exact - brute_force_expectation(T33, beta, table)) <= 1e-12, name


@pytest.mark.slow
def test_c10_character_expansion_validated_on_3x4():
    """As the previous test, on the 3 x 4 and 4 x 3 tori (enumeration of all 2^24 configurations)."""
    rng = np.random.default_rng(1002)
    funcs = c10_functions(rng)
    for shape in ((3, 4), (4, 3)):
        for beta in (0.15, 0.8):
            for name, table in funcs:
                exact = z2_d2_expectation(table, 12, beta)
                assert abs(exact - brute_force_expectation(shape, beta, table)) <= 1e-12, name


@pytest.mark.parametrize("beta", BETAS_D2)
def test_c10_infinite_volume_limit_d2(beta):
    """Stelling C point 3 for Z2 in D = 2 with f a function of the links of R_{r0}, r0 = 1: exact
    mu_L(f) on the tori (Z/L)^2 from the character expansion.  For r = 2..6, all L, L' >= 2r+3 (up
    to 40) and five theta:  |mu_L(f) - mu_L'(f)| <= C_theta Delta(f) e^{-theta (r+1-r0)}; the limit
    <f> = lim mu_L(f) exists (it is the value with t^|Q|) and satisfies the same bound.  In this
    laboratory the left side is of order tanh(beta)^(L^2-4) (1e-37 or smaller for L >= 7), far
    below the rounding error of mu_L(f) itself, so the corrections mu_L(f) - <f> are computed
    term by term without cancellation.  The bound therefore holds with an enormous margin: this is
    a consistency check of point 3, not a sharp test (plaquettes are independent in D = 2)."""
    rng = np.random.default_rng(1003)
    al = alpha(beta, 2)
    r0 = 1
    worst, largest_diff = 0.0, 0.0
    for name, table in c10_functions(rng):
        Df = float(delta_vec(table).sum())
        limit = z2_d2_expectation(table, None, beta)
        vals = {L: z2_d2_expectation(table, L * L, beta) for L in range(3, 41)}
        corr = {L: z2_d2_expectation(table, L * L, beta, minus_limit=True) for L in range(3, 41)}
        # the two evaluations agree where the correction is resolved (L = 3: of order t^5)
        assert all(abs((vals[L] - limit) - corr[L]) <= 1e-14 * (1 + np.abs(table).max()) for L in vals)
        for r in range(2, 7):
            Ls = [L for L in vals if L >= 2 * r + 3]
            diff = max(abs(corr[L] - corr[Lp]) for L in Ls for Lp in Ls)        # |mu_L f - mu_L' f|
            diff = max(diff, max(abs(corr[L]) for L in Ls))                     # |mu_L f - <f>|
            for theta in theta_grid(al):
                rhs = c_theta(al, theta) * Df * math.exp(-theta * (r + 1 - r0))
                assert diff <= rhs
                worst = max(worst, diff / rhs)
            if r == 2:
                largest_diff = max(largest_diff, diff)
        # convergence of the whole sequence, also from the small tori on: the correction decreases
        errs = [abs(corr[L]) for L in range(3, 41)]
        assert all(errs[i + 1] <= errs[i] for i in range(len(errs) - 1))
        assert errs[-1] <= 1e-300 or errs[-1] <= errs[0] * 1e-200
    assert largest_diff > 0.0               # the left side is resolved (not a comparison 0 <= rhs)
    note(f"C10 point 3, Z2 D=2 beta={beta}: max |mu_L f - mu_L' f| for L,L' >= 7, and max lhs/rhs",
         f"{largest_diff:.2e}, {worst:.2e}")


def test_c10_point_1_for_the_infinite_volume_state():
    """Stelling C point 3, last sentence: for functions f, g of finitely many links with disjoint
    supports A, B the inequality of point 1 holds for the infinite-volume state <.>, with d the
    link distance in Z^D.  Z2 in D = 2 with A, B inside R_1 (12 links): <.> is computed exactly
    (character expansion, the limit of mu_L checked in the previous test), the distances d(k,B) by
    breadth-first search in Z^2; three beta, five theta, 14 choices of (A, B, f, g)."""
    rng = np.random.default_rng(1005)
    pos = {l: i for i, l in enumerate(CUBE1)}
    full = (2,) * 12
    p00, p11 = [pos[l] for l in CUBE1_PLAQ[0]], [pos[l] for l in CUBE1_PLAQ[3]]
    assert not set(p00) & set(p11)                              # plaquettes (-1,-1) and (0,0)
    cases = [("two links of a plaquette vs the other two", p00[:2], p00[2:], link_product(12, p00[:2]), link_product(12, p00[2:])),
             ("three links of a plaquette vs the fourth", p00[:3], p00[3:], link_product(12, p00[:3]), link_product(12, p00[3:])),
             ("two plaquettes", p00, p11, link_product(12, p00), link_product(12, p11)),
             ("random f, g on two plaquettes", p00, p11, local_function(rng, full, p00), local_function(rng, full, p11))]
    for sizes in ((1, 1), (2, 3), (4, 4), (6, 6), (3, 9)):
        perm = [int(i) for i in rng.permutation(12)]
        A, B = sorted(perm[:sizes[0]]), sorted(perm[sizes[0]:sizes[0] + sizes[1]])
        cases.append((f"random sets of sizes {sizes}, random f, g", A, B, local_function(rng, full, A), local_function(rng, full, B)))
        cases.append((f"random sets of sizes {sizes}, products of all links", A, B, link_product(12, A), link_product(12, B)))
    worst, nonzero = 0.0, 0
    for name, A, B, f, g in cases:
        assert not set(A) & set(B)
        dZ = zd_link_distance([CUBE1[i] for i in B], [CUBE1[i] for i in A])
        dist = np.array([dZ[CUBE1[i]] for i in A], dtype=float)
        df = np.array([delta(f, k) for k in A])
        fb, gb = np.broadcast_to(f, full), np.broadcast_to(g, full)
        for beta in BETAS_D2:
            al = alpha(beta, 2)
            cov = abs(z2_d2_expectation(fb * gb, None, beta)
                      - z2_d2_expectation(fb, None, beta) * z2_d2_expectation(gb, None, beta))
            nonzero += cov > 1e-9
            for theta in theta_grid(al):
                first = c_theta(al, theta) * osc(g) / 2 * float(np.exp(-theta * dist) @ df)
                second = c_theta(al, theta) * osc(g) / 2 * float(df.sum()) * math.exp(-theta * dist.min())
                assert cov <= first + FP, (name, beta, theta, cov, first)
                assert first <= second + FP * (1 + second)
                worst = max(worst, cov / first)
    assert nonzero >= 9                                         # the left sides are not all zero
    note("C10 point 3, Z2 D=2: max |<fg> - <f><g>| / first bound of point 1 (infinite volume)", f"{worst:.5f}")


@pytest.mark.slow
def test_c7_c6_on_the_3x4_torus():
    """Stelling C point 1 and Propositie C.6 on the larger 3 x 4 torus (2^24 configurations,
    D = 2, beta = 0.10 and 0.15): rows of horizontal links at link distance 1 and 2, plaquettes at
    distance 2, a frozen row with all 8 boundary conditions; exact covariances and exact
    sup over omega, omega' against the bounds."""
    shape = (3, 4)
    lat = torus(shape)
    n = lat.nl
    S = z2_action(shape)
    row = lambda y: [lat.link((x, y), 0) for x in range(3)]
    pl = lambda x, y: [lat.link((x % 3, y % 4), 0), lat.link(((x + 1) % 3, y % 4), 1),
                       lat.link((x % 3, (y + 1) % 4), 0), lat.link((x % 3, y % 4), 1)]
    prod = lambda links: link_product(n, links)
    rng = np.random.default_rng(1004)
    assert int(lat.bfs(row(2))[row(0)].min()) == 2
    for beta in (0.10, 0.15):
        w = np.exp(beta * S)
        w /= w.sum()
        al = alpha(beta, 2)
        cases = [(row(0), row(1), prod(row(0)), prod(row(1))), (row(0), row(2), prod(row(0)), prod(row(2))),
                 (row(0), row(2), local_function(rng, (2,) * n, row(0)), local_function(rng, (2,) * n, row(2))),
                 (pl(0, 0), pl(0, 2), prod(pl(0, 0)), prod(pl(0, 2))),
                 (pl(0, 0), pl(1, 2), local_function(rng, (2,) * n, pl(0, 0)), local_function(rng, (2,) * n, pl(1, 2)))]
        for A, B, f, g in cases:
            wf = w * f
            cov = abs(float((wf * g).sum() - wf.sum() * (w * g).sum()))
            for theta in theta_grid(al):
                first, second = point1_bounds(lat, np.array(A), B, f, g, al, theta)
                assert cov <= first + FP and first <= second + FP
        B = row(0)
        dist = lat.bfs(B)
        R = [l for l in range(n) if l not in set(B)]
        assert int(dist[R].max()) == 2          # on the 3 x 4 torus no link is further from a row
        for f in [sgn(n, k) for k in (lat.link((0, 2), 0), lat.link((1, 1), 1), lat.link((0, 0), 1))] + \
                 [prod([l for l in pl(0, 0) if l not in B]), prod(pl(1, 2)),
                  local_function(rng, (2,) * n, [lat.link((0, 2), 0), lat.link((2, 1), 1), lat.link((1, 3), 1)])]:
            mu = mu_all_omega(w, f, B)
            lhs = float(mu.max() - mu.min())
            df = np.array([delta(f, k) for k in R])
            for theta in theta_grid(al):
                assert lhs <= c_theta(al, theta) * float(np.exp(-theta * dist[R]) @ df) + FP
