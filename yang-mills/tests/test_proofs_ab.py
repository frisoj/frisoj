"""Numerical checks of the proofs of Stelling A and Stelling B in BEWIJZEN.md.

Numerical evidence for the individual steps of the proofs; not a proof.

What is checked, and how (section and formula numbers refer to BEWIJZEN.md):

* Stelling A (section 2).  The operator algebra of sections 2.2-2.4 is tested in finite
  "laboratories" in which every operator is an explicit matrix and every integral a finite sum:
  the centre Z2 = {+1, -1} of SU(2) (tests ``test_A1_*``, ``test_A2_*``) and the quaternion group
  Q8 (a non-abelian subgroup of SU(2); ``test_A_q8_*``), always with the SU(2) formulas restricted
  to the subgroup and the normalised counting measure as Haar measure.  The SU(2)-specific steps
  (positivity of the kernel K, the invariances of step 2, the factorisation (2.1) of the weight)
  are tested on random SU(2) configurations (``test_A3_*``, ``test_A4_*``, ``test_A5_*``).
* Stelling B (section 3).  Bessel-function identities by quadrature (``test_B1``, ``test_B4``,
  ``test_B5``), the Schur step and the eigenvalue equation by quadrature over SU(2) and by Monte
  Carlo (``test_B2``, ``test_B3_*``), the continuum limit (``test_B5``, ``test_B6``), consistency
  with the independent formulas in ``ym/exact.py`` (``test_B7``) and with the simulation engine
  ``ym/lattice.py`` (``test_B8``).

Conventions of the laboratories.  A function on a finite configuration space C is a vector
indexed by C; the Hilbert space is L^2(C, du) with du the normalised counting measure, so the
integral operator with kernel k(u, u') is the MATRIX k(u, u') / |C|, its trace is the matrix trace,
and <f1, f2> = mean(conj(f1) * f2).

Tolerances.  Deterministic linear algebra and quadrature: a small multiple of the rounding error
of the computation (stated at each assertion).  Monte Carlo: a number of standard errors (4), with
an explicit check that the standard error is small enough for the comparison to mean something.
All random numbers come from fixed seeds.
"""
from __future__ import annotations

import itertools
import math

import numpy as np
import pytest
from scipy import integrate, special

from ym import exact, stats
from ym import lattice as ymlat

EPS = float(np.finfo(float).eps)


# =============================================================================================
# 0.  Shared helpers
# =============================================================================================
def composite_gauss_legendre(a, b, npanel, order):
    """Nodes and weights of a composite Gauss-Legendre rule on [a, b]."""
    x, w = np.polynomial.legendre.leggauss(order)
    edges = np.linspace(a, b, npanel + 1)
    half = 0.5 * (edges[1:] - edges[:-1])
    mid = 0.5 * (edges[1:] + edges[:-1])
    return (mid[:, None] + half[:, None] * x[None, :]).ravel(), (half[:, None] * w[None, :]).ravel()


class SpatialGeometry:
    """The periodic spatial lattice Lambda_s = prod_i Z/L_i of section 2.1: sites, the set E of
    spatial links (x, i) and the spatial plaquettes (x; i < j) with the link order of section 1.2."""

    def __init__(self, sshape):
        self.sshape = tuple(int(n) for n in sshape)
        self.d = len(self.sshape)
        self.sites = list(itertools.product(*[range(n) for n in self.sshape]))
        self.sid = {x: k for k, x in enumerate(self.sites)}
        self.ns = len(self.sites)
        self.nE = self.d * self.ns

    def shift(self, x, i):
        y = list(x)
        y[i] = (y[i] + 1) % self.sshape[i]
        return tuple(y)

    def link(self, x, i):
        return self.d * self.sid[x] + i

    def link_ends(self):
        """For every link e = (x, i): (index of x, index of x + i)."""
        return [(self.sid[x], self.sid[self.shift(x, i)]) for x in self.sites for i in range(self.d)]

    def plaquettes(self):
        """(x; i, j), i < j, as (x,i), (x+i,j), (x+j,i), (x,j)  [section 1.2]."""
        return [(self.link(x, i), self.link(self.shift(x, i), j),
                 self.link(self.shift(x, j), i), self.link(x, j))
                for x in self.sites for i in range(self.d) for j in range(i + 1, self.d)]

    def full_lattice(self, N):
        """Links and plaquettes of Lambda_s x Z/N (time = last direction, section 2.1).

        Bit/link numbering: spatial link e of time slice t -> t*nE + e; time link from (x, t) to
        (x, t+1) -> N*nE + t*ns + x.  Returns (number of links, list of plaquettes as 4-tuples of
        link numbers).  A time plaquette (x; i, time) consists, in the order of section 1.2, of
        u^t_e, v^t_{x+i}, u^{t+1}_e, v^t_x  (e = (x, i))."""
        nE, ns = self.nE, self.ns

        def sl(t, e):
            return (t % N) * nE + e

        def tl(t, x):
            return N * nE + (t % N) * ns + x

        plaq = []
        for t in range(N):
            for (a, b, c, d) in self.plaquettes():
                plaq.append((sl(t, a), sl(t, b), sl(t, c), sl(t, d)))
            for e, (x, y) in enumerate(self.link_ends()):
                plaq.append((sl(t, e), tl(t, y), sl(t + 1, e), tl(t, x)))
        return N * (nE + ns), plaq


# =============================================================================================
# 1.  The Z2 laboratory (Stelling A with G = {+1, -1})
# =============================================================================================
class Z2Lab:
    """Section 2.2 for G = Z2: sigma = +-1 on every link, (beta/2) Tr u -> beta * sigma.

    Spatial configurations are numbered c = 0 .. 2^nE - 1, bit e of c set <=> sigma_e = -1.
    Attributes: V (vector), Kker (kernel K(u, u')), masks (the gauge transformations as XOR
    masks), and the matrices M, K, P, T = M K P M of the operators on L^2(C, du)."""

    def __init__(self, sshape, beta):
        self.geo = geo = SpatialGeometry(sshape)
        self.beta = float(beta)
        nE, ns = geo.nE, geo.ns
        self.nC = nC = 2 ** nE
        codes = np.arange(nC, dtype=np.int64)
        self.sig = sig = (1 - 2 * ((codes[:, None] >> np.arange(nE)[None, :]) & 1)).astype(float)
        # V(u) = -(beta/2) sum_p Tr u_p = -beta sum_p sigma_p
        splaq = np.zeros(nC)
        for (a, b, c, d) in geo.plaquettes():
            splaq += sig[:, a] * sig[:, b] * sig[:, c] * sig[:, d]
        self.V = -self.beta * splaq
        # K(u, u') = prod_e k(u_e u'_e^-1),  k(h) = exp((beta/2) Tr h) = exp(beta h)
        self.Kker = np.exp(self.beta * (sig @ sig.T))
        # gauge transformations (u^g)_(x,i) = g_x u_(x,i) g_(x+i)^-1  ->  XOR with a mask
        ends = geo.link_ends()
        masks = []
        for g in range(2 ** ns):
            m = 0
            for e, (x, y) in enumerate(ends):
                m |= (((g >> x) ^ (g >> y)) & 1) << e
            masks.append(m)
        self.masks = np.array(masks, dtype=np.int64)
        P = np.zeros((nC, nC))
        for m in masks:                       # (P f)(u) = mean_g f(u^g)
            P[codes, codes ^ m] += 1.0 / len(masks)
        self.P = P
        self.M = np.diag(np.exp(-0.5 * self.V))
        self.K = self.Kker / nC
        self.T = self.M @ self.K @ self.P @ self.M


def z2_sum_over_all_configurations(nl, plaq, beta, nE=None, N=None, F1=None, F2=None):
    """Brute force over ALL 2^nl configurations of a Z2 gauge field with the weight of section 1.3,
    w = exp(beta * sum_p sigma_p), and the normalised counting measure.

    Returns Z = 2^-nl sum_U w(U) and, if F1, F2 (vectors indexed by the spatial configuration) are
    given, one = mu(F1(u^0)) and two[t] = mu(F1(u^0) F2(u^t)) for t = 1 .. N-1, where the spatial
    links of time slice t occupy the bits [t*nE, (t+1)*nE).

    Every configuration is visited once.  The only organisation: the vector of plaquette parities
    is linear over GF(2) in the link bits, so it is the XOR of a table for the low half of the
    bits and a table for the high half."""
    nP = len(plaq)
    assert nP <= 62 and all(len(set(p)) == 4 for p in plaq)
    nlo = nl // 2
    nhi = nl - nlo

    def parity_table(nbits, offset):
        c = np.arange(2 ** nbits, dtype=np.uint64)
        pm = np.zeros(2 ** nbits, dtype=np.uint64)
        for p, links in enumerate(plaq):
            par = np.zeros(2 ** nbits, dtype=np.uint64)
            for link in links:
                if offset <= link < offset + nbits:
                    par ^= (c >> np.uint64(link - offset)) & np.uint64(1)
            pm |= par << np.uint64(p)
        return pm

    pm_lo = parity_table(nlo, 0)
    pm_hi = parity_table(nhi, nlo)
    wtab = np.exp(beta * (nP - 2.0 * np.arange(nP + 1)))     # nfr plaquettes with sigma_p = -1
    lo = np.arange(2 ** nlo, dtype=np.int64)
    smask = None if nE is None else (1 << nE) - 1
    Z = 0.0
    one = 0.0
    two = np.zeros(N if N else 1, dtype=complex)
    chunk = max(1, (1 << 20) >> nlo)
    for start in range(0, 2 ** nhi, chunk):
        hi = np.arange(start, min(start + chunk, 2 ** nhi), dtype=np.int64)
        w = wtab[np.bitwise_count(pm_hi[hi][:, None] ^ pm_lo[None, :])]
        Z += w.sum()
        if F1 is not None:
            code = (hi[:, None] << nlo) | lo[None, :]
            wf = w * F1[code & smask]
            one += wf.sum()
            for t in range(1, N):
                two[t] += (wf * F2[(code >> (t * nE)) & smask]).sum()
    if F1 is None:
        return Z / 2.0 ** nl
    return Z / 2.0 ** nl, one / Z, two / Z


def _assert_transfer_matrix_structure(lab, tol=1e-12):
    """The matrix statements of Stelling A, points 1-4, for a Z2Lab; returns (eigenvalues in
    decreasing order, orthonormal eigenvectors as columns)."""
    M, K, P, T = lab.M, lab.K, lab.P, lab.T
    kmax = np.abs(K).max()
    tmax = np.abs(T).max()
    # step 2(a): P is an orthogonal projection
    assert np.abs(P - P.T).max() < tol
    assert np.abs(P @ P - P).max() < tol
    # step 2(b), 2(c): P commutes with M and with K; K symmetric with positive kernel
    assert np.abs(M @ P - P @ M).max() < tol * np.abs(M).max()
    assert np.abs(K @ P - P @ K).max() < tol * kmax
    assert np.abs(K - K.T).max() == 0.0 and K.min() > 0.0
    # step 3: K is positive definite (K >= 0 and injective)
    assert np.linalg.eigvalsh(K).min() > 0.0
    # step 4 / point 1: T symmetric, strictly positive kernel, positive semidefinite
    assert np.abs(T - T.T).max() < tol * tmax
    assert T.min() > 0.0
    lam, vec = np.linalg.eigh(0.5 * (T + T.T))
    lam, vec = lam[::-1], vec[:, ::-1]
    assert lam[-1] > -tol * lam[0]
    # point 2: T = PT = TP; T injective on H_inv = P H (rank T = dim H_inv); T = 0 on the complement
    assert np.abs(P @ T - T).max() < tol * tmax
    assert np.abs(T @ P - T).max() < tol * tmax
    dim_inv = int(round(np.trace(P)))
    assert abs(np.trace(P) - dim_inv) < tol * lab.nC
    assert np.all(lam[:dim_inv] > 1e-9 * lam[0])
    assert np.all(np.abs(lam[dim_inv:]) < tol * lam[0])
    assert np.abs(T @ (np.eye(lab.nC) - P)).max() < tol * tmax
    # point 3: the top eigenvalue is simple and its eigenvector has one strict sign
    assert lam[0] - lam[1] > 1e-6 * lam[0]
    omega = vec[:, 0] * np.sign(vec[0, 0])
    assert omega.min() > 1e-6 * omega.max()
    # point 4: gap 0 < m < infinity
    assert 0.0 < lam[1] < lam[0]
    return lam, vec


@pytest.mark.parametrize("L, beta", [(3, 0.6), (3, 1.4), (4, 0.9)])
def test_A1_z2_ring_transfer_matrix_and_brute_force(L, beta):
    """Stelling A, points 1-5 (sec. 2.3) and steps 2-4, 8 of the proof (sec. 2.4), in the Z2
    laboratory on a D = 2 ring with L = 3, 4 and N = 3: P is an orthogonal projection commuting
    with M and K; T = MKPM is symmetric, positive semidefinite with strictly positive entries;
    T = PT = TP; Z = Tr T^N equals the sum of w(U) over all configurations of the L x N lattice
    (section 1.3); simple top eigenvalue with strictly positive eigenvector; the correlation
    formula of point 5 for random complex, non-invariant F1, F2."""
    lab = Z2Lab((L,), beta)
    N = 3
    lam, _ = _assert_transfer_matrix_structure(lab)
    T = lab.T
    assert np.array_equal(lab.M, np.eye(lab.nC))            # sec. 3.1: no spatial plaquettes, M = 1
    rng = np.random.default_rng(1000 + L)
    F1 = rng.normal(size=lab.nC) + 1j * rng.normal(size=lab.nC)
    F2 = rng.normal(size=lab.nC) + 1j * rng.normal(size=lab.nC)
    nl, plaq = lab.geo.full_lattice(N)
    assert nl == 2 * L * N and len(plaq) == L * N
    Zb, one, two = z2_sum_over_all_configurations(nl, plaq, beta, nE=lab.geo.nE, N=N, F1=F1, F2=F2)
    TN = np.linalg.matrix_power(T, N)
    ZT = np.trace(TN)
    # sums of at most 2^24 terms with pairwise summation: relative error ~ 24 eps; tolerance 1e-12
    assert abs(ZT / Zb - 1.0) < 1e-12
    # the Z2 analogue of Stelling B: eigenvalues cosh^L, sinh^L, Z = cosh^(LN) + sinh^(LN)
    ch, sh = math.cosh(beta), math.sinh(beta)
    assert abs(Zb / (ch ** (L * N) + sh ** (L * N)) - 1.0) < 1e-12
    assert abs(lam[0] / ch ** L - 1.0) < 1e-12 and abs(lam[1] / sh ** L - 1.0) < 1e-12
    # point 5 / step 8: mu(F1(u^0) F2(u^t)) = Tr(F1 T^t F2 T^(N-t)) / Tr T^N, and the one-point
    # function mu(F(u^0)) = Tr(F T^N) / Tr T^N.  |F| = O(1); tolerance 1e-11 (see above).
    assert abs(one - np.trace(np.diag(F1) @ TN) / ZT) < 1e-11
    for t in range(1, N):
        rhs = np.trace(np.diag(F1) @ np.linalg.matrix_power(T, t) @ np.diag(F2)
                       @ np.linalg.matrix_power(T, N - t)) / ZT
        assert abs(two[t] - rhs) < 1e-11
    # sensitivity of the test: without the gauge projection P the formula is wrong
    assert abs(np.trace(np.linalg.matrix_power(lab.K, N)) / Zb - 1.0) > 0.05


def test_A2_z2_d3_smallest_lattice_with_spatial_plaquettes():
    """Stelling A, points 1-5, in the Z2 laboratory in D = 3 on the smallest periodic lattice
    with spatial plaquettes that can be enumerated completely: spatial lattice 2 x 2 (8 links,
    4 plaquettes, V != 0), N = 2 time slices, 2^24 configurations.  Tests the role of M (step
    2(b), step 4: the two halves of exp(-V)) and of the gauge projection P.  (The extents are 2,
    below the hypothesis 'all sizes >= 3' of the theorem; the algebra of steps 1-4 and 8 does
    not use that hypothesis.  The 3 x 3 x 3 lattice is in the slow test below.)"""
    beta = 0.55
    lab = Z2Lab((2, 2), beta)
    N = 2
    lam, _ = _assert_transfer_matrix_structure(lab)
    M, K, P, T = lab.M, lab.K, lab.P, lab.T
    assert len(np.unique(np.round(lab.V, 12))) >= 3 and np.abs(M - np.eye(lab.nC)).max() > 0.1
    assert int(round(np.trace(P))) == 32                    # 2^8 configurations / orbits of size 8
    # step 4: T has the kernel exp(-V(u)/2) T0(u,u') exp(-V(u')/2), T0(u,u') = mean_g K(u^g, u')
    T0 = np.zeros_like(lab.Kker)
    codes = np.arange(lab.nC)
    for m in lab.masks:
        T0 += lab.Kker[codes ^ m, :] / len(lab.masks)
    kern = np.exp(-0.5 * lab.V)[:, None] * T0 * np.exp(-0.5 * lab.V)[None, :]
    assert np.abs(T - kern / lab.nC).max() < 1e-13 * np.abs(T).max()
    assert np.abs(T0 - T0.T).max() < 1e-12 * T0.max()
    # brute force over the full 2 x 2 x 2 lattice
    rng = np.random.default_rng(2002)
    F1 = rng.normal(size=lab.nC) + 1j * rng.normal(size=lab.nC)
    F2 = rng.normal(size=lab.nC) + 1j * rng.normal(size=lab.nC)
    nl, plaq = lab.geo.full_lattice(N)
    assert nl == 24 and len(plaq) == 24
    Zb, one, two = z2_sum_over_all_configurations(nl, plaq, beta, nE=lab.geo.nE, N=N, F1=F1, F2=F2)
    TN = np.linalg.matrix_power(T, N)
    ZT = np.trace(TN)
    assert abs(ZT / Zb - 1.0) < 1e-12                       # point 1: Z = Tr T^N
    assert abs(one - np.trace(np.diag(F1) @ TN) / ZT) < 1e-11
    rhs = np.trace(np.diag(F1) @ T @ np.diag(F2) @ T) / ZT  # point 5 with t = 1, N = 2
    assert abs(two[1] - rhs) < 1e-11
    # sensitivity: leaving out M (the spatial plaquettes) or P (the time links) gives a wrong Z
    KP = K @ P
    MKM = M @ K @ M
    assert abs(np.trace(np.linalg.matrix_power(KP, N)) / Zb - 1.0) > 0.05
    assert abs(np.trace(np.linalg.matrix_power(MKM, N)) / Zb - 1.0) > 0.05
    # the vacuum is not constant here (unlike D = 2): M matters for point 3
    omega = np.abs(np.linalg.eigh(T)[1][:, -1])
    assert omega.max() / omega.min() > 1.05
    assert lam[1] / lam[0] < 1.0


@pytest.mark.parametrize("N", [3, 4])
def test_A2_z2_d3_time_links_summed_slice_by_slice(N):
    """Steps 1 and 4 of the proof of Stelling A ((2.1) and the integration over the time links)
    in the Z2 laboratory in D = 3 (spatial lattice 2 x 2) for N = 3, 4: the sum over the time
    links v^t of the time-plaquette weights, computed directly from the plaquettes of section 1.2
    without any gauge transformation, equals T0(u^t, u^{t+1}); hence Z = Tr T^N.  (For N >= 3 the
    full lattice has 2^36 or more configurations; here the sum over all configurations is carried
    out exactly, one time slice after the other.)"""
    beta = 0.55
    lab = Z2Lab((2, 2), beta)
    geo = lab.geo
    sig = lab.sig
    ends = geo.link_ends()
    B = np.zeros((lab.nC, lab.nC))
    for v in itertools.product((1.0, -1.0), repeat=geo.ns):
        s = np.array([v[x] * v[y] for (x, y) in ends])     # sigma of the time plaquette = u_e u'_e v_x v_(x+i)
        B += np.exp(beta * ((sig * s[None, :]) @ sig.T))
    B /= 2 ** geo.ns
    A = (np.exp(-lab.V)[:, None] * B) / lab.nC             # one time step, exp(-V) not yet split
    Z_slices = np.trace(np.linalg.matrix_power(A, N))
    Z_T = np.trace(np.linalg.matrix_power(lab.T, N))
    assert abs(Z_T / Z_slices - 1.0) < 1e-12
    assert np.abs(B / lab.nC - lab.K @ lab.P).max() < 1e-13 * B.max()


@pytest.mark.parametrize("sshape, beta", [((3,), 0.8), ((4,), 0.5), ((2, 2), 0.55)])
def test_A1_z2_large_N_limit_and_bounds_on_C_F(sshape, beta):
    """Stelling A, point 5, second part, and step 8 of the proof, in the Z2 laboratory: the
    remainder bound |r_N| <= |F1| |F2| sum_{n>=1} (lambda_n/lambda_0)^(N-t); the limit (2.6);
    mu(F(u^0)F(u^t)) - mu(F(u^0))^2 -> C_F(t) = sum_{n>=1} (lambda_n/lambda_0)^t |<psi_n, F Omega>|^2
    for a real, non-invariant F; 0 <= C_F(t) <= |F|_inf^2 exp(-m t); and C_F(t) >= exp(-m t) for
    F = psi_1 / Omega."""
    lab = Z2Lab(sshape, beta)
    nC = lab.nC
    lam, vec = np.linalg.eigh(lab.T)
    lam, vec = lam[::-1], vec[:, ::-1]
    psi = vec * math.sqrt(nC)                               # orthonormal in L^2(C, du)
    omega = psi[:, 0] * np.sign(psi[0, 0])
    r = np.clip(lam / lam[0], 0.0, None)
    m = math.log(lam[0] / lam[1])
    rng = np.random.default_rng(31)
    F = rng.normal(size=nC)
    G = rng.normal(size=nC)

    def tpow(k):                                            # (T / lambda_0)^k
        return (vec * r[None, :] ** k) @ vec.T

    def corr(F1, F2, t, N):                                 # Tr(F1 T^t F2 T^(N-t)) / Tr T^N
        return np.trace((F1[:, None] * tpow(t)) @ (F2[:, None] * tpow(N - t))) / np.sum(r ** N)

    def vac(F1, F2, t):                                     # <Omega, F1 (T/lambda_0)^t F2 Omega>
        return np.mean(omega * F1 * (tpow(t) @ (F2 * omega)))

    for t in (1, 2, 3):
        # remainder bound of step 8 at small N:
        # Tr(F T^t G T^(N-t)) / lambda_0^N = <Omega, F T^t G Omega> / lambda_0^t + r_N
        for N in (t + 1, t + 2, t + 5):
            rN = np.trace((F[:, None] * tpow(t)) @ (G[:, None] * tpow(N - t))) - vac(F, G, t)
            bound = np.abs(F).max() * np.abs(G).max() * np.sum(r[1:] ** (N - t))
            assert abs(rN) <= bound * (1 + 1e-9) + 1e-12
        # large N: N - t so large that (lambda_1/lambda_0)^(N-t) < 1e-15
        N = t + int(math.ceil(36.0 / m)) + 2
        assert abs(corr(F, G, t, N) - vac(F, G, t)) < 1e-11 * np.abs(F).max() * np.abs(G).max()
        a = psi.T @ (F * omega) / nC                        # a_n = <psi_n, F Omega>
        CF = np.sum(r[1:] ** t * a[1:] ** 2)
        lhs = corr(F, F, t, N) - corr(F, np.ones(nC), t, N) ** 2
        assert abs(lhs - CF) < 1e-11 * np.abs(F).max() ** 2
        assert 0.0 <= CF <= np.abs(F).max() ** 2 * math.exp(-m * t) * (1 + 1e-12)
        F1 = psi[:, 1] / omega                              # the function that attains the gap
        a1 = psi.T @ (F1 * omega) / nC
        CF1 = np.sum(r[1:] ** t * a1[1:] ** 2)
        assert abs(a1[1] - 1.0) < 1e-10
        assert CF1 >= math.exp(-m * t) * (1 - 1e-10)
        lhs1 = corr(F1, F1, t, N) - corr(F1, np.ones(nC), t, N) ** 2
        assert abs(lhs1 - CF1) < 1e-10 * np.abs(F1).max() ** 2


def _gf2_kernel(columns):
    """Basis of {S : XOR of columns[p] for p in S == 0} over GF(2); columns are Python ints.
    Each basis element is returned as an int whose bit p says whether column p is in S."""
    pivots = {}                                             # pivot bit -> (vector, combination)
    kernel = []
    for p, v in enumerate(columns):
        comb = 1 << p
        while v:
            hb = v.bit_length() - 1
            if hb not in pivots:
                pivots[hb] = (v, comb)
                break
            pv, pc = pivots[hb]
            v ^= pv
            comb ^= pc
        if v == 0:
            kernel.append(comb)
    return kernel


@pytest.mark.slow
def test_A2_z2_d3_3x3x3_trace_formula_against_surface_sum():
    """Stelling A, points 1-4, on a lattice that satisfies the hypotheses of the theorem (all
    sizes 3, N = 3): Z2 laboratory in D = 3, spatial lattice 3 x 3 (18 links), full lattice
    3 x 3 x 3 (81 links, 81 plaquettes).  Z = Tr T^3, with T restricted to the gauge orbits
    (legitimate because the kernel of step 4 is gauge invariant in each argument, which is
    checked), against an independent evaluation of Z = int w dU that uses no transfer matrix:
    Z = cosh(beta)^81 * sum over the 2^29 closed plaquette surfaces S of tanh(beta)^|S|."""
    beta = 0.5
    geo = SpatialGeometry((3, 3))
    nE, ns = geo.nE, geo.ns
    codes = np.arange(2 ** nE, dtype=np.int64)
    ends = geo.link_ends()
    masks = set()
    for g in range(2 ** ns):
        m = 0
        for e, (x, y) in enumerate(ends):
            m |= (((g >> x) ^ (g >> y)) & 1) << e
        masks.add(m)
    masks = np.array(sorted(masks), dtype=np.int64)
    assert len(masks) == 256                                # 2^9 transformations, constants act trivially
    canon = codes.copy()
    for m in masks:
        np.minimum(canon, codes ^ m, out=canon)
    reps, counts = np.unique(canon, return_counts=True)
    assert len(reps) == 1024 and np.all(counts == 256)

    def V_of(c):
        s = np.zeros(len(c))
        for (a, b, cc, d) in geo.plaquettes():
            s += 1.0 - 2.0 * (((c >> a) ^ (c >> b) ^ (c >> cc) ^ (c >> d)) & 1)
        return -beta * s

    ktab = np.exp(beta * (nE - 2.0 * np.arange(nE + 1)))    # K(u,u') = exp(beta sum_e u_e u'_e)

    def T0_of(c1, c2):                                      # mean_g K(c1^g, c2), step 4
        out = np.zeros((len(c1), len(c2)))
        for m in masks:
            out += ktab[np.bitwise_count((c1[:, None] ^ c2[None, :] ^ m).astype(np.uint64))]
        return out / len(masks)

    # gauge invariance of the kernel in each argument separately, on random configurations
    rng = np.random.default_rng(333)
    c1 = rng.integers(0, 2 ** nE, size=40)
    c2 = rng.integers(0, 2 ** nE, size=40)
    ref = T0_of(c1, c2)
    assert np.abs(T0_of(c1 ^ masks[17], c2 ^ masks[201]) - ref).max() < 1e-12 * ref.max()
    # T on the 1024 orbits: (T f)(r) = sum_r' (256 / 2^18) T(r, r') f(r')
    Vr = V_of(reps)
    T0 = T0_of(reps, reps)
    Torb = np.exp(-0.5 * Vr)[:, None] * T0 * np.exp(-0.5 * Vr)[None, :] * (256.0 / 2 ** nE)
    assert np.abs(Torb - Torb.T).max() < 1e-12 * Torb.max() and Torb.min() > 0.0
    lam = np.linalg.eigvalsh(Torb)[::-1]
    Z_T = np.sum(lam ** 3)
    # points 2-4 on H_inv: all 1024 eigenvalues strictly positive, lambda_0 simple, Omega > 0
    assert lam[-1] > 1e-12 * lam[0]
    assert lam[0] - lam[1] > 1e-6 * lam[0]
    omega = np.linalg.eigh(Torb)[1][:, -1]
    omega = omega * np.sign(omega[0])
    assert omega.min() > 0.0
    # independent Z: closed surfaces of the 3 x 3 x 3 lattice
    nl, plaq = geo.full_lattice(3)
    assert nl == 81 and len(plaq) == 81
    cols = [sum(1 << link for link in p) for p in plaq]     # boundary of plaquette p as a link set
    basis = _gf2_kernel(cols)
    assert len(basis) == 29                                 # 81 - rank, rank = 81 - 26 - 3 = 52

    def table(vecs):
        lo = np.zeros(1, dtype=np.uint64)
        hi = np.zeros(1, dtype=np.uint64)
        for v in vecs:
            vlo, vhi = np.uint64(v & (2 ** 64 - 1)), np.uint64(v >> 64)
            lo = np.concatenate([lo, lo ^ vlo])
            hi = np.concatenate([hi, hi ^ vhi])
        return lo, hi

    alo, ahi = table(basis[:15])
    blo, bhi = table(basis[15:])
    hist = np.zeros(82, dtype=np.int64)
    step = 32
    for s in range(0, len(alo), step):
        wgt = (np.bitwise_count(alo[s:s + step, None] ^ blo[None, :])
               + np.bitwise_count(ahi[s:s + step, None] ^ bhi[None, :]))
        hist += np.bincount(wgt.ravel(), minlength=82)
    assert hist.sum() == 2 ** 29 and hist[0] == 1
    assert hist[1:6].sum() == 0 and hist[6] == 27           # the 27 elementary cubes
    Z_surf = math.cosh(beta) ** 81 * float(np.sum(hist * math.tanh(beta) ** np.arange(82)))
    # 82 positive terms, eigenvalue sum of a 1024 x 1024 symmetric matrix: tolerance 1e-10
    assert abs(Z_T / Z_surf - 1.0) < 1e-10


# =============================================================================================
# 2.  The Q8 laboratory (non-abelian finite subgroup of SU(2))
# =============================================================================================
_S0 = np.eye(2, dtype=complex)
_S1 = np.array([[0, 1], [1, 0]], dtype=complex)
_S2 = np.array([[0, -1j], [1j, 0]], dtype=complex)
_S3 = np.array([[1, 0], [0, -1]], dtype=complex)
SIGMA = np.array([_S1, _S2, _S3])


def q8_tables():
    """Q8 = {+-1, +-i sigma_1, +-i sigma_2, +-i sigma_3} in SU(2): elements, multiplication
    table, inverse table, traces."""
    els = np.array([_S0, -_S0, 1j * _S1, -1j * _S1, 1j * _S2, -1j * _S2, 1j * _S3, -1j * _S3])

    def find(m):
        d = np.abs(els - m).sum(axis=(1, 2))
        k = int(np.argmin(d))
        assert d[k] == 0.0
        return k

    mul = np.array([[find(a @ b) for b in els] for a in els])
    inv = np.array([find(a.conj().T) for a in els])
    tr = np.trace(els, axis1=1, axis2=2).real
    return els, mul, inv, tr


class Q8Ring:
    """Section 3.1 with G = Q8: ring of L sites, links u_i from i to i+1, (u^g)_i = g_i u_i
    g_(i+1)^-1, k(h) = exp((beta/2) Tr h), T = K P (matrices on L^2(G^L, du))."""

    def __init__(self, L, beta):
        self.L, self.beta = L, float(beta)
        self.els, self.mul, self.inv, self.tr = q8_tables()
        mul, inv, tr = self.mul, self.inv, self.tr
        self.nC = nC = 8 ** L
        idx = np.arange(nC)
        self.cfg = cfg = np.stack([(idx // 8 ** i) % 8 for i in range(L)], axis=1)
        pw = 8 ** np.arange(L)
        kk = np.exp(0.5 * self.beta * tr[mul[:, inv]])      # kk[a, b] = k(a b^-1)
        Kker = np.ones((nC, nC))
        for i in range(L):
            Kker *= kk[cfg[:, i][:, None], cfg[:, i][None, :]]
        self.Kker = Kker
        self.K = Kker / nC
        P = np.zeros((nC, nC))
        for g in cfg:                                       # all gauge transformations
            ug = np.stack([mul[mul[g[i], cfg[:, i]], inv[g[(i + 1) % L]]] for i in range(L)], axis=1)
            P[idx, ug @ pw] += 1.0 / nC
        self.P = P
        self.T = self.K @ P
        h = cfg[:, 0].copy()
        for i in range(1, L):
            h = mul[h, cfg[:, i]]
        self.hol = h                                        # holonomy u_1 u_2 ... u_L


def test_A_q8_nonabelian_plaquette_order_and_trace_formula():
    """Step 1 ((2.1): the order of the factors in the time plaquette, cyclicity of the trace, the
    gauge transformation g^t = (v^t)^-1), step 4 (Z = Tr T^N) and step 8 (point 5) of Stelling A
    for a NON-ABELIAN group, where the order of the factors matters: Q8 subset SU(2), D = 2,
    L = 2, N = 2, brute force over all 8^8 configurations of the 2 x 2 lattice with the plaquette
    U_p = U_(x,mu) U_(x+mu,nu) U_(x+nu,mu)^-1 U_(x,nu)^-1 of section 1.2."""
    beta = 0.9
    lab = Q8Ring(2, beta)
    mul, inv, tr = lab.mul, lab.inv, lab.tr
    P, K, T = lab.P, lab.K, lab.T
    assert np.abs(P - P.T).max() < 1e-13 and np.abs(P @ P - P).max() < 1e-13
    assert np.abs(K @ P - P @ K).max() < 1e-13 * K.max()
    assert np.abs(T - T.T).max() < 1e-13 * T.max() and T.min() > 0.0
    assert np.abs(P @ T - T).max() < 1e-13 * T.max() and np.abs(T @ P - T).max() < 1e-13 * T.max()
    assert np.linalg.eigvalsh(K).min() > 0.0                # step 3 for Q8
    rng = np.random.default_rng(88)
    F1 = rng.normal(size=lab.nC) + 1j * rng.normal(size=lab.nC)
    F2 = rng.normal(size=lab.nC) + 1j * rng.normal(size=lab.nC)
    # brute force: links u[t][i] (space) and v[t][i] (time, from (i,t) to (i,t+1)), i, t in {0,1}
    six = np.indices((8,) * 6).reshape(6, -1)               # u10, u11, v00, v01, v10, v11
    u1 = (six[0], six[1])
    v = ((six[2], six[3]), (six[4], six[5]))
    idx1 = u1[0] + 8 * u1[1]
    Z = 0.0
    num = 0.0
    for a in range(8):
        for b in range(8):
            u0 = (np.full(six.shape[1], a), np.full(six.shape[1], b))
            u = (u0, u1)
            s = np.zeros(six.shape[1])
            for t in range(2):
                for i in range(2):
                    # U_p = u^t_i  v^t_(i+1)  (u^(t+1)_i)^-1  (v^t_i)^-1
                    p = mul[mul[mul[u[t][i], v[t][(i + 1) % 2]], inv[u[(t + 1) % 2][i]]], inv[v[t][i]]]
                    s += tr[p]
            w = np.exp(0.5 * beta * s)
            Z += w.sum()
            num += F1[a + 8 * b] * (w * F2[idx1]).sum()
    Zb = Z / 8.0 ** 8
    ZT = np.trace(T @ T)
    assert abs(ZT / Zb - 1.0) < 1e-12
    rhs = np.trace(np.diag(F1) @ T @ np.diag(F2) @ T) / ZT
    assert abs(num / Z - rhs) < 1e-11
    assert abs(np.trace(K @ K) / Zb - 1.0) > 0.05           # sensitivity: P is needed


def test_B_q8_schur_step_and_spectrum():
    """Stelling B, points 1-4 (sec. 3.2) and the Schur step of the proof of point 2, in a finite
    non-abelian laboratory: Q8 on a ring of L = 3 sites (512 configurations).  H_inv consists of
    the class functions of the holonomy (dimension = number of conjugacy classes = 5), phi ->
    phi o h preserves the norm, and T (chi_rho o h) = (c_rho / d_rho)^L (chi_rho o h) with
    c_rho = int k chi_rho; the factor 1/d_rho (Schur) is tested by the 2-dimensional
    representation.  Z = sum_rho (c_rho / d_rho)^(L N)."""
    beta, L = 1.1, 3
    lab = Q8Ring(L, beta)
    tr = lab.tr
    T, P = lab.T, lab.P
    # character table of Q8: trivial, three sign representations, the 2-dimensional one
    chars = [np.ones(8)]
    for k in (1, 2, 3):
        c = -np.ones(8)
        c[[0, 1, 2 * k, 2 * k + 1]] = 1.0
        chars.append(c)
    chars.append(tr.copy())
    dims = [1, 1, 1, 1, 2]
    gram = np.array([[np.mean(a * b) for b in chars] for a in chars])
    assert np.abs(gram - np.eye(5)).max() < 1e-14 and sum(d * d for d in dims) == 8
    kvals = np.exp(0.5 * beta * tr)
    cs = [np.mean(kvals * c) for c in chars]                # c_rho = int k chi_rho dg
    Lams = [(c / d) ** L for c, d in zip(cs, dims)]
    # closed forms: (cosh b + 3)/4, (cosh b - 1)/4 three times, sinh(b)/4  [c_rho / d_rho]
    expect = [(math.cosh(beta) + 3) / 4] + [(math.cosh(beta) - 1) / 4] * 3 + [math.sinh(beta) / 4]
    assert np.allclose([c / d for c, d in zip(cs, dims)], expect, rtol=1e-13, atol=0)
    assert int(round(np.trace(P))) == 5                     # point 1: dim H_inv = 5
    funcs = [c[lab.hol] for c in chars]                     # chi_rho o h
    for f, lam in zip(funcs, Lams):
        assert np.abs(P @ f - f).max() < 1e-13              # gauge invariant
        assert np.abs(T @ f - lam * f).max() < 1e-13 * max(Lams)      # rounding of T f ~ eps Lambda_0
    g2 = np.array([[np.mean(a * b) for b in funcs] for a in funcs])
    assert np.abs(g2 - np.eye(5)).max() < 1e-13             # norm preserving, orthonormal
    ev = np.sort(np.linalg.eigvalsh(0.5 * (T + T.T)))[::-1]
    assert np.allclose(ev[:5], np.sort(Lams)[::-1], rtol=1e-12, atol=0)
    assert np.abs(ev[5:]).max() < 1e-13 * ev[0]             # T = 0 on the complement of H_inv
    for N in (2, 3, 5):                                     # point 4
        assert abs(np.trace(np.linalg.matrix_power(T, N)) / sum(lam ** N for lam in Lams) - 1) < 1e-12
    # the test has teeth: without the Schur factor 1/d the 2-dimensional eigenvalue is wrong
    assert abs(cs[4] ** L / Lams[4] - 1.0) > 1.0


# =============================================================================================
# 3.  SU(2) helpers
# =============================================================================================
def su2_from_q(q):
    """Unit quaternion(s) q[..., 4] -> SU(2) matrices a0 + i (a1 sigma1 + a2 sigma2 + a3 sigma3)."""
    q = np.asarray(q, dtype=float)
    return q[..., 0, None, None] * _S0 + 1j * np.einsum("...k,kab->...ab", q[..., 1:], SIGMA)


def su2_haar(rng, shape=()):
    """Haar-random SU(2) matrices (uniform points on S^3 from normalised Gaussian vectors)."""
    q = rng.normal(size=tuple(shape) + (4,))
    q /= np.linalg.norm(q, axis=-1, keepdims=True)
    return su2_from_q(q)


def dag(m):
    return np.conj(np.swapaxes(m, -1, -2))


def trace(m):
    return np.trace(m, axis1=-2, axis2=-1)


def inv(m):
    """Matrix inverse by the general formula (does not assume unitarity)."""
    return np.linalg.inv(m)


def gauge(u, g):
    """(u^g)_(x,i) = g_x u_(x,i) g_(x+i)^-1 (sec. 2.1).  u: sshape + (d, 2, 2); g: sshape + (2, 2)."""
    d = u.ndim - 3
    out = np.empty_like(u)
    for i in range(d):
        out[..., i, :, :] = g @ u[..., i, :, :] @ inv(np.roll(g, -1, axis=i))
    return out


def plaquette_trace_sum(U):
    """sum over all plaquettes (x; mu < nu) of Tr U_p, U_p = U_(x,mu) U_(x+mu,nu) U_(x+nu,mu)^-1
    U_(x,nu)^-1 (sec. 1.2), for U of shape (L_1, ..., L_n, n, 2, 2).  Returns a complex number
    (the imaginary part must vanish by (G1))."""
    n = U.ndim - 3
    s = 0.0
    for mu in range(n):
        for nu in range(mu + 1, n):
            Up = (U[..., mu, :, :] @ np.roll(U[..., nu, :, :], -1, axis=mu)
                  @ inv(np.roll(U[..., mu, :, :], -1, axis=nu)) @ inv(U[..., nu, :, :]))
            s = s + trace(Up).sum()
    return s


def V_spatial(u, beta):
    """V(u) = -(beta/2) sum_{p spatial} Tr u_p (sec. 2.2)."""
    return -0.5 * beta * plaquette_trace_sum(u)


def log_K(u, up, beta):
    """ln K(u, u') = (beta/2) sum_e Tr(u_e (u'_e)^-1) (sec. 2.2)."""
    return 0.5 * beta * trace(u @ inv(up)).sum()


def chi(twoj, g):
    """Character chi_j of SU(2) matrices g (sec. 3.1): sin((2j+1) theta)/sin(theta) = U_2j(cos
    theta), cos(theta) = (1/2) Tr g."""
    return special.eval_chebyu(twoj, np.clip(0.5 * trace(g).real, -1.0, 1.0))


def su2_rule(M, mp, ma):
    """Quadrature rule on SU(2) for the Haar probability measure in the coordinates
    a = cos(theta) + i sin(theta) n.sigma, n on S^2: da = (2/pi) sin^2(theta) dtheta dOmega/(4 pi).

    theta: trapezoidal rule with M intervals on [0, pi] (after the integration over n the
    integrand is an even 2 pi-periodic function of theta, so the rule is exact for trigonometric
    polynomials of degree < 2M - 2 and spectrally accurate otherwise); cos(polar angle):
    Gauss-Legendre with mp nodes; azimuth: ma equidistant points.  The rule is exact for
    (function of theta) x (polynomial of degree d in n) if d <= 2 mp - 1 and d <= ma - 1.
    Returns (matrices (n, 2, 2), weights (n,))."""
    th = np.pi * np.arange(1, M) / M
    wth = (2.0 / np.pi) * np.sin(th) ** 2 * (np.pi / M)
    z, wz = np.polynomial.legendre.leggauss(mp)
    ph = 2.0 * np.pi * (np.arange(ma) + 0.5) / ma
    TH, Z, PH = np.meshgrid(th, z, ph, indexing="ij")
    W = wth[:, None, None] * (0.5 * wz)[None, :, None] * np.full(ma, 1.0 / ma)[None, None, :]
    R = np.sqrt(1.0 - Z ** 2)
    q = np.stack([np.cos(TH), np.sin(TH) * R * np.cos(PH), np.sin(TH) * R * np.sin(PH),
                  np.sin(TH) * Z], axis=-1).reshape(-1, 4)
    return su2_from_q(q), W.ravel()


def spin_operators(twoj):
    """Spin-j matrices (Jx, Jy, Jz) in the basis m = j, j-1, ..., -j."""
    s = 0.5 * twoj
    d = twoj + 1
    m = s - np.arange(d)
    Jp = np.zeros((d, d), dtype=complex)
    for k in range(1, d):
        Jp[k - 1, k] = math.sqrt(s * (s + 1) - m[k] * (m[k] + 1))
    return 0.5 * (Jp + Jp.conj().T), (Jp - Jp.conj().T) / 2j, np.diag(m).astype(complex)


def rep(twoj, a):
    """D^j(a) = exp(2 i theta n.J) for a = cos(theta) + i sin(theta) n.sigma = exp(i theta
    n.sigma): the irreducible representation of dimension 2j + 1 (sec. 3.1, S5)."""
    a = np.asarray(a)
    q0 = 0.5 * trace(a).real
    qv = np.stack([0.5 * (a[..., 0, 1] + a[..., 1, 0]).imag, 0.5 * (a[..., 0, 1] - a[..., 1, 0]).real,
                   0.5 * (a[..., 0, 0] - a[..., 1, 1]).imag], axis=-1)
    s = np.linalg.norm(qv, axis=-1)
    theta = np.arctan2(s, q0)
    n = np.where(s[..., None] > 0, qv / np.where(s > 0, s, 1.0)[..., None], np.array([0.0, 0.0, 1.0]))
    Jx, Jy, Jz = spin_operators(twoj)
    H = n[..., 0, None, None] * Jx + n[..., 1, None, None] * Jy + n[..., 2, None, None] * Jz
    w, v = np.linalg.eigh(H)
    return (v * np.exp(2j * theta[..., None] * w)[..., None, :]) @ dag(v)


def adjoint(a):
    """Adjoint representation R(a)_kl = (1/2) Tr(sigma_k a sigma_l a^-1): real 3 x 3 (j = 1)."""
    return 0.5 * np.einsum("kab,...bc,lcd,...da->...kl", SIGMA, a, SIGMA, inv(a)).real


# =============================================================================================
# 4.  Stelling A for SU(2): steps 1, 2, 3
# =============================================================================================
@pytest.mark.parametrize("nlinks", [1, 2, 18])
@pytest.mark.parametrize("beta", [0.1, 1.0, 2.5, 8.0])
def test_A3_su2_kernel_K_is_positive_semidefinite(nlinks, beta):
    """Step 3 of the proof of Stelling A, (2.2)-(2.3): the kernel K(u, u') = prod_e k(u_e u'_e^-1)
    of section 2.2 is positive semidefinite.  For n random points u^1 .. u^n of SU(2)^E the Gram
    matrix K(u^a, u^b) must have no negative eigenvalue (smallest eigenvalue >= -1e-9 x largest;
    the rounding error of eigvalsh is about n * eps * largest = 3e-14 x largest).  Also the
    identity of step 3, A(u,u') = sum_e Tr(u_e u'_e^-1) = sum_i phi_i(u) conj(phi_i(u')), with
    phi_i the matrix elements."""
    n = 150
    rng = np.random.default_rng(300 + nlinks)
    u = su2_haar(rng, (n, nlinks))
    # A from the definition, with explicit matrix inverses
    A = np.einsum("aeij,beji->ab", u, inv(u))
    assert np.abs(A.imag).max() < 1e-12                     # (G1): the traces are real
    Phi = u.reshape(n, 4 * nlinks)                          # phi_(e,a,b)(u) = (u_e)_ab
    A2 = Phi @ Phi.conj().T
    assert np.abs(A - A2).max() < 1e-12 * nlinks
    Kg = np.exp(0.5 * beta * A.real)
    assert np.abs(Kg - Kg.T).max() < 1e-12 * Kg.max()       # step 2(c): symmetric, positive
    assert Kg.min() > 0.0
    ev = np.linalg.eigvalsh(0.5 * (Kg + Kg.T))
    assert ev[0] >= -1e-9 * ev[-1]


def test_A3_su2_kernel_gram_test_has_power_and_monomial_expansion():
    """Step 3 of the proof of Stelling A.  (i) The Gram-matrix test can fail: the kernel
    exp(-(beta/2) A), whose character coefficients c_j(-beta) = (-1)^(2j) c_j(beta) are negative
    for half-integer j, gives a clearly negative eigenvalue on the same points.  (ii) The
    identity A(u,u')^n = sum_{I in J^n} Phi_I(u) conj(Phi_I(u')) used for (2.2), with explicit
    monomials, for n = 1 .. 4 and two links.  (iii) (2.2) with the series truncated: for a
    measure f = sum_a c_a delta_(u^a), <f, K f> equals the sum over monomials up to the
    remainder of the exponential series.  (iv) Strict positivity (2.3) on few points."""
    rng = np.random.default_rng(77)
    n, beta = 150, 1.0
    u = su2_haar(rng, (n, 1))
    A = np.einsum("aeij,beji->ab", u, inv(u)).real
    ev_good = np.linalg.eigvalsh(np.exp(0.5 * beta * A))
    ev_bad = np.linalg.eigvalsh(np.exp(-0.5 * beta * A))
    assert ev_good[0] >= -1e-9 * ev_good[-1]
    assert ev_bad[0] < -0.05 * ev_bad[-1]
    # (ii) explicit monomials, |E| = 2: J has 8 elements, J^n has 8^n
    m = 6
    v = su2_haar(rng, (m, 2))
    phi = v.reshape(m, 8)
    Adef = np.einsum("aeij,beji->ab", v, inv(v))
    mono = np.ones((m, 1), dtype=complex)
    for power in range(1, 5):
        mono = (mono[:, :, None] * phi[:, None, :]).reshape(m, -1)      # all Phi_I, I in J^power
        assert mono.shape[1] == 8 ** power
        assert np.abs(mono @ mono.conj().T - Adef ** power).max() < 1e-11 * 4.0 ** power
    # (iii) (2.2) truncated at n <= nmax for |E| = 1 (|A| <= 2): remainder <= sum_{n>nmax} beta^n/n! * |c|_1^2
    pts = u[:5, 0]
    phi1 = pts.reshape(5, 4)
    c = rng.normal(size=5) + 1j * rng.normal(size=5)
    A1 = np.einsum("aij,bji->ab", pts, inv(pts)).real
    lhs = np.real(np.conj(c) @ np.exp(0.5 * beta * A1) @ c)
    total, mono, nmax = 0.0, np.ones((5, 1), dtype=complex), 8
    for power in range(0, nmax + 1):
        if power > 0:
            mono = (mono[:, :, None] * phi1[:, None, :]).reshape(5, -1)
        coef = (0.5 * beta) ** power / math.factorial(power)
        total += coef * np.sum(np.abs(np.conj(mono).T @ c) ** 2)        # |<Phi_I, f>|^2
    rem = sum(beta ** k / math.factorial(k) for k in range(nmax + 1, 60)) * np.abs(c).sum() ** 2
    assert 0.0 <= lhs - total <= rem * (1 + 1e-9)
    # (iv) five generic points: the Gram matrix is strictly positive definite
    ev5 = np.linalg.eigvalsh(np.exp(0.5 * 2.0 * A1))
    assert ev5[0] > 1e-8 * ev5[-1]


@pytest.mark.parametrize("sshape", [(3,), (3, 3), (4, 3), (3, 3, 3)])
def test_A4_su2_invariances_of_step_2(sshape):
    """Section 2.1 and step 2 of the proof of Stelling A, on random SU(2) configurations of a
    small spatial lattice (D = 2, 3, 4): (u^g)^h = u^(hg); K(u^g, u'^g) = K(u, u');
    V(u^g) = V(u); K(u, u') = K(u', u) > 0 real; the identity K(u, (u')^(g^-1)) = K(u^g, u')
    used for KP = PK; a spatial plaquette variable transforms as g_x u_p g_x^-1; (G1), (G2);
    and for D = 2 the holonomy h(u^g) = g_1 h(u) g_1^-1 of section 3.1."""
    rng = np.random.default_rng(400 + len(sshape) + sum(sshape))
    d = len(sshape)
    beta = 2.3
    tol = 1e-11                                             # products of < 100 matrices of norm 1
    for _ in range(4):
        u = su2_haar(rng, tuple(sshape) + (d,))
        up = su2_haar(rng, tuple(sshape) + (d,))
        g = su2_haar(rng, sshape)
        h = su2_haar(rng, sshape)
        # composition law, and the opposite order is NOT the law (non-abelian)
        assert np.abs(gauge(gauge(u, g), h) - gauge(u, h @ g)).max() < tol
        assert np.abs(gauge(gauge(u, g), h) - gauge(u, g @ h)).max() > 1e-3
        # K
        lk = log_K(u, up, beta)
        assert abs(lk.imag) < tol
        assert abs(log_K(gauge(u, g), gauge(up, g), beta) - lk) < tol * u.size
        assert abs(log_K(up, u, beta) - lk) < tol * u.size
        assert abs(log_K(u, gauge(up, inv(g)), beta) - log_K(gauge(u, g), up, beta)) < tol * u.size
        assert abs(log_K(gauge(u, g), up, beta) - lk) > 1e-3        # K is not invariant in one argument
        # V
        Vu = V_spatial(u, beta)
        assert abs(np.imag(Vu)) < tol * u.size
        assert abs(V_spatial(gauge(u, g), beta) - Vu) < tol * u.size
        if d >= 2:
            ug = gauge(u, g)

            def plaq01(w):
                return (w[..., 0, :, :] @ np.roll(w[..., 1, :, :], -1, axis=0)
                        @ inv(np.roll(w[..., 0, :, :], -1, axis=1)) @ inv(w[..., 1, :, :]))

            assert np.abs(plaq01(ug) - g @ plaq01(u) @ inv(g)).max() < tol
            assert abs(Vu.real) > 1e-3
        else:
            assert Vu == 0.0                                # D = 2: no spatial plaquettes
            hol = np.eye(2, dtype=complex)
            holg = np.eye(2, dtype=complex)
            ug = gauge(u, g)
            for i in range(sshape[0]):
                hol = hol @ u[i, 0]
                holg = holg @ ug[i, 0]
            assert np.abs(holg - g[0] @ hol @ inv(g[0])).max() < tol
        # (G1), (G2)
        a = u.reshape(-1, 2, 2)
        b = g.reshape(-1, 2, 2)[: 1]
        assert np.abs(trace(a).imag).max() < tol and np.abs(trace(a).real).max() <= 2 + tol
        assert np.abs(trace(inv(a)) - trace(a)).max() < tol
        assert np.abs(trace(b @ a @ inv(b)) - trace(a)).max() < tol
        assert np.abs(np.conj(a[:, 0, 0]) - a[:, 1, 1]).max() < tol
        assert np.abs(np.conj(a[:, 0, 1]) + a[:, 1, 0]).max() < tol
        assert np.abs(inv(a) - dag(a)).max() < tol and np.abs(np.linalg.det(a) - 1).max() < tol


def _assemble(us, vs):
    """Full configuration U (shape sshape + (N, D, 2, 2)) from the slices u^t and time links v^t."""
    N = len(us)
    sshape = us[0].shape[:-3]
    d = len(sshape)
    U = np.empty(sshape + (N, d + 1, 2, 2), dtype=complex)
    for t in range(N):
        U[..., t, :d, :, :] = us[t]
        U[..., t, d, :, :] = vs[t]
    return U


@pytest.mark.parametrize("sshape, N", [((3,), 3), ((3, 3), 3), ((3, 4), 5), ((3, 3, 3), 3)])
def test_A5_su2_weight_factorises_over_time_slices(sshape, N):
    """Step 1 of the proof of Stelling A, formula (2.1): for random SU(2) configurations
    w(U) = prod_t exp(-V(u^t)) K((u^t)^(g^t), u^(t+1)) with g^t = (v^t)^-1, where w(U) is
    computed directly from the plaquettes of section 1.2 on the full lattice (time = last
    direction).  D = 2, 3, 4."""
    rng = np.random.default_rng(500 + N + sum(sshape))
    d = len(sshape)
    beta = 1.7
    for _ in range(3):
        us = [su2_haar(rng, tuple(sshape) + (d,)) for _ in range(N)]
        vs = [su2_haar(rng, sshape) for _ in range(N)]
        logw = 0.5 * beta * plaquette_trace_sum(_assemble(us, vs))
        rhs = 0.0
        for t in range(N):
            rhs += -V_spatial(us[t], beta) + log_K(gauge(us[t], inv(vs[t])), us[(t + 1) % N], beta)
        nplaq = int(np.prod(sshape)) * N * (d + 1) * d // 2
        assert abs(np.imag(logw)) < 1e-11 * nplaq
        assert abs(logw - rhs) < 1e-11 * nplaq               # nplaq traces of 4 matrix products
        # sensitivity: with g^t = v^t instead of (v^t)^-1 the identity fails
        wrong = sum(-V_spatial(us[t], beta) + log_K(gauge(us[t], vs[t]), us[(t + 1) % N], beta)
                    for t in range(N))
        assert abs(logw - wrong) > 1e-3


@pytest.mark.parametrize("shape", [(4, 4), (4, 2, 4), (2, 4, 2, 2)])
def test_A5_su2_weight_agrees_with_the_simulation_engine(shape):
    """Section 1.3 and step 1 of Stelling A against the engine: on an even lattice (axis 0 =
    time in ym.lattice) the weight w(U) = exp((beta/2) sum_p Tr U_p), the action S = beta sum_p
    (1 - (1/2) Tr U_p) of the engine (exp(-S) = exp(-beta |P|) w) and the factorised form (2.1)
    agree for random configurations."""
    beta = 2.2
    N, sshape = shape[0], tuple(shape[1:])
    d = len(sshape)
    rng = np.random.default_rng(600 + len(shape))
    us = [su2_haar(rng, sshape + (d,)) for _ in range(N)]
    vs = [su2_haar(rng, sshape) for _ in range(N)]
    U = _assemble(us, vs)                                   # (x..., t, dir) with dir d = time
    lat = ymlat.Lattice(shape, beta, seed=1)
    E = np.moveaxis(U, d, 0)                                # (t, x..., dir, 2, 2)
    E = np.concatenate([E[..., d:d + 1, :, :], E[..., :d, :, :]], axis=-3)   # direction 0 = time
    lat.U[...] = ymlat.matrix_to_q(E.reshape(lat.V, lat.D, 2, 2))
    assert np.abs(ymlat.q_to_matrix(lat.U) - E.reshape(lat.V, lat.D, 2, 2)).max() < 1e-14
    logw = 0.5 * beta * plaquette_trace_sum(U).real
    assert abs(logw - beta * lat.plaquette() * lat.n_plaq) < 1e-10 * lat.n_plaq
    assert abs(-lat.action() + beta * lat.n_plaq - logw) < 1e-10 * lat.n_plaq
    rhs = sum(-V_spatial(us[t], beta) + log_K(gauge(us[t], inv(vs[t])), us[(t + 1) % N], beta)
              for t in range(N))
    assert abs(rhs - logw) < 1e-10 * lat.n_plaq


# =============================================================================================
# 5.  Stelling B: Bessel functions, characters, the Schur step, the eigenvalue equation
# =============================================================================================
BETAS_B1 = [0.05, 0.1, 0.5, 1.0, 2.0, 2.5, 4.0, 8.0, 16.0, 30.0]
TWOJS_B1 = list(range(0, 11))                               # j = 0, 1/2, ..., 5


def bessel_i_series(n, x, terms=300):
    """I_n(x) from the power series of (S6): sum_k (x/2)^(2k+n) / (k! (k+n)!)."""
    term = (0.5 * x) ** n / math.factorial(n)
    out = []
    for k in range(terms):
        out.append(term)
        term *= (0.5 * x) ** 2 / ((k + 1.0) * (k + n + 1.0))
    return math.fsum(out)


def c_j_trapezoid(beta, twoj, M=400):
    """c_j = (2/pi) int_0^pi exp(beta cos t) sin((2j+1) t) sin(t) dt by the trapezoidal rule with
    M intervals.  The integrand is an even 2 pi-periodic entire function, so the only error is
    aliasing, of the order I_(2M - 2j - 2)(beta) (zero to double precision here), plus rounding."""
    t = np.pi * np.arange(M + 1) / M
    f = np.exp(beta * np.cos(t)) * np.sin((twoj + 1) * t) * np.sin(t)
    return (2.0 / np.pi) * (np.pi / M) * (f.sum() - 0.5 * (f[0] + f[-1]))


def test_B1_c_j_by_quadrature_against_bessel_functions():
    """Stelling B, proof of point 2, formula (3.1), and (S6): c_j = (2/pi) int_0^pi exp(beta cos
    theta) sin((2j+1) theta) sin(theta) dtheta = I_2j(beta) - I_(2j+2)(beta) = (2 (2j+1)/beta)
    I_(2j+1)(beta), for beta in [0.05, 30] and j = 0, 1/2, ..., 5; the integral representation
    and the power series of I_n; the recurrence I_(n-1) - I_(n+1) = (2n/x) I_n."""
    worst = 0.0
    for beta in BETAS_B1:
        scale = math.exp(beta)                              # bound of the integrand
        for twoj in TWOJS_B1:
            nu = twoj + 1
            closed1 = special.iv(twoj, beta) - special.iv(twoj + 2, beta)
            closed2 = 2.0 * nu / beta * special.iv(nu, beta)
            # recurrence: two Bessel values with a few ulp each
            assert abs(closed1 - closed2) <= 20 * EPS * special.iv(twoj, beta)
            # trapezoid: rounding only, <= ~ 10 eps * max|integrand|; tolerance 500 eps e^beta
            q1 = c_j_trapezoid(beta, twoj)
            assert abs(q1 - closed2) <= 1e-13 * scale
            worst = max(worst, abs(q1 - closed2) / scale)
            # independent adaptive quadrature
            q2, err2 = integrate.quad(lambda t: math.exp(beta * math.cos(t)) * math.sin(nu * t)
                                      * math.sin(t), 0.0, math.pi, epsabs=1e-12 * scale, epsrel=0.0,
                                      limit=200)
            q2 *= 2.0 / math.pi
            assert err2 <= 1e-12 * scale and abs(q2 - closed2) <= 1e-12 * scale
            # where c_j is not tiny compared with the integrand, also a relative statement
            if closed2 > 1e-4 * scale:
                assert abs(q1 / closed2 - 1.0) < 1e-9
            # (S6): power series and integral representation of I_n, n = 2j + 1
            ser = bessel_i_series(nu, beta)
            assert abs(ser / special.iv(nu, beta) - 1.0) < 1e-13
            t = np.pi * np.arange(401) / 400
            f = np.exp(beta * np.cos(t)) * np.cos(nu * t)
            rep_int = (f.sum() - 0.5 * (f[0] + f[-1])) / 400
            assert abs(rep_int - special.iv(nu, beta)) <= 1e-13 * scale
        # c_0 = int k dg > 0 and the c_j are the character coefficients of k: Parseval
        # sum_j c_j^2 = int k^2 dg = c_0(2 beta) = I_1(2 beta)/beta
        cj = np.array([2.0 * (n + 1) / beta * special.ive(n + 1, beta) for n in range(400)])
        par = np.sum(cj ** 2)
        assert abs(par / (special.ive(1, 2 * beta) / beta) - 1.0) < 1e-12
    assert worst < 1e-13


def test_B_su2_characters_and_class_function_integration():
    """Section 3.1 / (S5): chi_j = sin((2j+1) theta)/sin(theta); the integration formula for class
    functions, int_G phi dg = (2/pi) int_0^pi phi(theta) sin^2(theta) dtheta, checked against an
    integration over SU(2) in Hopf coordinates (which does not use the class angle) and against
    Haar samples; orthonormality of the characters; and Stelling B, point 1: for Haar-distributed
    links the holonomy h(u) = u_1 ... u_L is Haar distributed (phi -> phi o h preserves the norm)."""
    # character formula
    th = np.linspace(0.05, 3.09, 40)
    g = su2_from_q(np.stack([np.cos(th), np.sin(th) * 0.6, np.sin(th) * 0.0, np.sin(th) * 0.8], axis=-1))
    for twoj in range(0, 9):
        assert np.abs(chi(twoj, g) - np.sin((twoj + 1) * th) / np.sin(th)).max() < 1e-12
    # Hopf coordinates: u = [[a, b], [-conj b, conj a]], a = sqrt(s) e^(i xi), s uniform on [0,1],
    # xi uniform; (1/2) Tr u = sqrt(s) cos(xi).  Exact for polynomials in (1/2) Tr u of degree < 48.
    s, ws = composite_gauss_legendre(0.0, 1.0, 1, 30)
    xi = 2.0 * np.pi * (np.arange(96) + 0.5) / 96
    X = np.sqrt(s)[:, None] * np.cos(xi)[None, :]
    WH = ws[:, None] * np.full(96, 1.0 / 96)[None, :]
    tw = np.pi * np.arange(1, 400) / 400                    # Weyl formula, trapezoid
    ww = (2.0 / np.pi) * np.sin(tw) ** 2 * (np.pi / 400)
    for twoj in range(0, 8):
        for twok in range(0, 8):
            hopf = np.sum(WH * special.eval_chebyu(twoj, X) * special.eval_chebyu(twok, X))
            weyl = np.sum(ww * special.eval_chebyu(twoj, np.cos(tw)) * special.eval_chebyu(twok, np.cos(tw)))
            delta = 1.0 if twoj == twok else 0.0
            assert abs(hopf - delta) < 1e-12 and abs(weyl - delta) < 1e-12
    for beta in (0.5, 3.0):                                 # a non-polynomial class function: k chi_j
        for twoj in range(0, 5):
            hopf = np.sum(WH * np.exp(beta * X) * special.eval_chebyu(twoj, X))
            assert abs(hopf - 2.0 * (twoj + 1) / beta * special.iv(twoj + 1, beta)) < 1e-12 * math.exp(beta)
    # Monte Carlo: Haar samples, and the holonomy of L = 3 Haar links
    rng = np.random.default_rng(5150)
    n = 400000
    a = su2_haar(rng, (n,))
    hol = su2_haar(rng, (n,)) @ su2_haar(rng, (n,)) @ a
    for sample in (a, hol):
        for twoj, twok in [(1, 1), (2, 2), (3, 3), (4, 4), (0, 2), (1, 3), (2, 4), (1, 2)]:
            vals = chi(twoj, sample) * chi(twok, sample)
            mean, sem = vals.mean(), vals.std(ddof=1) / math.sqrt(n)
            delta = 1.0 if twoj == twok else 0.0
            assert sem < 0.02 and abs(mean - delta) < 4.5 * sem


def test_B2_schur_step_A_j_is_a_multiple_of_the_identity():
    """Stelling B, proof of point 2 (Schur step): A_j = int k(a) D^j(a^-1) da = (c_j / d_j) * 1,
    by quadrature over SU(2), for j = 1/2 (defining representation), j = 1 (adjoint
    representation, real 3 x 3) and j = 1, 3/2, 2 (spin matrices).  Also: the D^j used here are
    representations with character chi_j, and the next line of the proof,
    (T f)(u) = Tr[prod_i A_j D^j(u_i)] = (c_j/d_j)^L chi_j(h(u))."""
    rng = np.random.default_rng(42)
    x, y = su2_haar(rng, (20,)), su2_haar(rng, (20,))
    for twoj in (1, 2, 3, 4):
        Dx, Dy = rep(twoj, x), rep(twoj, y)
        assert np.abs(Dx @ Dy - rep(twoj, x @ y)).max() < 1e-12           # homomorphism
        assert np.abs(Dx @ dag(Dx) - np.eye(twoj + 1)).max() < 1e-12      # unitary
        assert np.abs(trace(Dx) - chi(twoj, x)).max() < 1e-12             # character
    assert np.abs(rep(1, x) - x).max() < 1e-13
    assert np.abs(trace(adjoint(x)) - chi(2, x)).max() < 1e-12
    assert np.abs(adjoint(x) @ adjoint(y) - adjoint(x @ y)).max() < 1e-12
    # quadrature: D^j(a^-1) has degree 2j <= 4 in n -> mp = 4, ma = 6 is exact; theta: M = 40,
    # aliasing ~ I_72(beta) / e^beta (zero); rounding ~ 1e-15 e^beta; tolerance 1e-12 c_0
    a, w = su2_rule(40, 4, 6)
    assert abs(w.sum() - 1.0) < 1e-14
    for beta in (0.3, 1.0, 2.5, 6.0):
        kw = w * np.exp(0.5 * beta * trace(a).real)
        c0 = 2.0 / beta * special.iv(1, beta)
        assert abs(kw.sum() / c0 - 1.0) < 1e-12
        for twoj in (1, 2, 3, 4):
            Aj = np.einsum("n,nab->ab", kw, rep(twoj, inv(a)))
            gamma = 2.0 / beta * special.iv(twoj + 1, beta)               # c_j / d_j, (3.1)
            assert np.abs(Aj - gamma * np.eye(twoj + 1)).max() < 1e-12 * c0
            # without the factor 1/d_j the statement would be off by a factor d_j >= 2
            assert abs(Aj[0, 0].real / ((twoj + 1) * gamma) - 1.0) > 0.4
            for L in (2, 3):                                              # next line of the proof
                u = su2_haar(rng, (L,))
                prod = np.eye(twoj + 1, dtype=complex)
                hol = np.eye(2, dtype=complex)
                for i in range(L):
                    prod = prod @ Aj @ rep(twoj, u[i])
                    hol = hol @ u[i]
                assert abs(np.trace(prod) - gamma ** L * chi(twoj, hol)) < 1e-11 * c0 ** L
        A1 = np.einsum("n,nab->ab", kw, adjoint(inv(a)))                  # j = 1, adjoint
        c1 = special.iv(2, beta) - special.iv(4, beta)
        assert np.abs(A1 - (c1 / 3.0) * np.eye(3)).max() < 1e-12 * c0


def test_B3_eigenvalue_equation_by_quadrature():
    """Stelling B, point 2, for real SU(2): (K (chi_j o h))(u) = (c_j/d_j)^L chi_j(h(u)) at
    random u, by a deterministic quadrature over (a_1, ..., a_L) in SU(2)^L of
    prod_i k(a_i) chi_j(a_1^-1 u_1 ... a_L^-1 u_L) (substitution a_i = u_i u'_i^-1 of the
    proof).  Only the character formula chi_j = U_2j((1/2) Tr) is used, no representation
    matrices.  L = 2: j = 1/2 .. 2; L = 3: j = 1/2, 1."""
    rng = np.random.default_rng(2024)
    # L = 2.  degree 2j <= 4 in each n_i -> (mp, ma) = (4, 6) exact; theta: M = 24, aliasing
    # ~ I_42(beta)/e^beta = 0 for beta <= 2.5.  Rounding ~ 1e-15 x e^(2 beta); tolerance 1e-11 c_0^2.
    a, w = su2_rule(24, 4, 6)
    ai = inv(a)
    for beta in (0.7, 2.5):
        kw = w * np.exp(0.5 * beta * trace(a).real)
        c0 = 2.0 / beta * special.iv(1, beta)
        for _ in range(3):
            u = su2_haar(rng, (2,))
            g = (ai @ u[0])[:, None] @ (ai @ u[1])[None, :]            # a_1^-1 u_1 a_2^-1 u_2
            hol = u[0] @ u[1]
            for twoj in (1, 2, 3, 4):
                val = np.einsum("m,n,mn->", kw, kw, chi(twoj, g))
                pred = (2.0 / beta * special.iv(twoj + 1, beta)) ** 2 * chi(twoj, hol)
                assert abs(val - pred) < 1e-11 * c0 ** 2
    # L = 3.  j <= 1: degree 2 -> (mp, ma) = (2, 3) exact; M = 14, aliasing ~ I_24(1) = 1e-31.
    a, w = su2_rule(14, 2, 3)
    ai = inv(a)
    beta = 1.0
    kw = w * np.exp(0.5 * beta * trace(a).real)
    c0 = 2.0 / beta * special.iv(1, beta)
    for _ in range(2):
        u = su2_haar(rng, (3,))
        g12 = ((ai @ u[0])[:, None] @ (ai @ u[1])[None, :]).reshape(-1, 2, 2)
        w12 = (kw[:, None] * kw[None, :]).ravel()
        g = g12[:, None] @ (ai @ u[2])[None, :]
        hol = u[0] @ u[1] @ u[2]
        for twoj in (1, 2):
            val = np.einsum("m,n,mn->", w12, kw, chi(twoj, g))
            pred = (2.0 / beta * special.iv(twoj + 1, beta)) ** 3 * chi(twoj, hol)
            assert abs(val - pred) < 1e-11 * c0 ** 3


def _kernel_samples(beta, n):
    """n SU(2) matrices with density k(a)/c_0 = exp((beta/2) Tr a)/c_0 with respect to the Haar
    measure, from the heatbath sampler of the engine (staple = identity).  Uses numba's global
    random stream: call ymlat.seed_numba(seed) first."""
    q = ymlat.heatbath_link_array(float(beta), np.array([1.0, 0.0, 0.0, 0.0]), int(n))
    return su2_from_q(q)


def _mc_eigenvalue_equation(L, beta, seed, nchunk=5, chunk=200000, nu=3, twojs=(1, 2, 3)):
    """Monte Carlo estimate of E[chi_j(a_1^-1 u_1 ... a_L^-1 u_L)], a_i ~ k/c_0, at nu random u.
    Returns (mean, standard error, prediction (I_(2j+1)/I_1)^L chi_j(h(u))) as arrays [u, j] and
    the mean and standard error of (1/2) Tr a and of the matrix element a_12 (sampler check)."""
    ymlat.seed_numba(seed)
    rng = np.random.default_rng(seed)
    us = su2_haar(rng, (nu, L))
    s1 = np.zeros((nu, len(twojs)))
    s2 = np.zeros((nu, len(twojs)))
    x1 = x2 = 0.0
    o1, o2 = 0.0 + 0.0j, 0.0
    for _ in range(nchunk):
        a = _kernel_samples(beta, chunk * L).reshape(chunk, L, 2, 2)
        x0 = 0.5 * trace(a[:, 0]).real
        x1, x2 = x1 + x0.sum(), x2 + np.sum(x0 ** 2)
        o1, o2 = o1 + a[:, 0, 0, 1].sum(), o2 + np.sum(np.abs(a[:, 0, 0, 1]) ** 2)
        ai = dag(a)                                         # a^-1 for a in SU(2)
        for k in range(nu):
            g = ai[:, 0] @ us[k, 0]
            for i in range(1, L):
                g = g @ ai[:, i] @ us[k, i]
            for c, twoj in enumerate(twojs):
                vals = chi(twoj, g)
                s1[k, c] += vals.sum()
                s2[k, c] += np.sum(vals ** 2)
    n = nchunk * chunk
    mean = s1 / n
    sem = np.sqrt((s2 / n - mean ** 2) / (n - 1))
    pred = np.empty_like(mean)
    for k in range(nu):
        hol = us[k, 0]
        for i in range(1, L):
            hol = hol @ us[k, i]
        for c, twoj in enumerate(twojs):
            pred[k, c] = (special.ive(twoj + 1, beta) / special.ive(1, beta)) ** L * chi(twoj, hol)
    xm = x1 / n
    sampler = (xm, math.sqrt((x2 / n - xm ** 2) / (n - 1)), o1 / n, math.sqrt(o2 / n / (n - 1)))
    return mean, sem, pred, sampler


@pytest.mark.parametrize("L, beta, seed", [(2, 3.0, 11), (3, 4.0, 12), (3, 8.0, 13)])
def test_B3_eigenvalue_equation_by_monte_carlo(L, beta, seed):
    """Stelling B, point 2, for real SU(2) by Monte Carlo with importance sampling: with a_i
    drawn independently with density k(a)/c_0 (heatbath sampler of ym/lattice.py),
    (K (chi_j o h))(u) / c_0^L = E[chi_j(a_1^-1 u_1 ... a_L^-1 u_L)] must equal
    (c_j/(d_j c_0))^L chi_j(h(u)) = (I_(2j+1)(beta)/I_1(beta))^L chi_j(h(u)) at three random u,
    for j = 1/2, 1, 3/2; 10^6 samples.  Criterion: |deviation| < 4 standard errors for every
    (u, j).  The comparison has power: at least four of the nine predictions are more than 10
    standard errors away from zero, and a missing Schur factor (d_j^L >= 4 times too large) would
    then be off by at least 30 standard errors."""
    mean, sem, pred, (xm, xs, om, os_) = _mc_eigenvalue_equation(L, beta, seed)
    # the sampler itself: E[(1/2) Tr a] = I_2/I_1 = u(beta), E[a_12] = 0
    assert abs(xm - special.ive(2, beta) / special.ive(1, beta)) < 4.0 * xs
    assert abs(om) < 4.0 * os_
    z = (mean - pred) / sem
    assert np.abs(z).max() < 4.0
    assert np.sum(np.abs(pred) > 10.0 * sem) >= 4


def test_B3_eigenvalue_equation_by_reweighted_haar_sampling():
    """Stelling B, point 2, with the absolute normalisation and an independent sampler: for
    Haar-distributed a_i (numpy generator), E[prod_i k(a_i) chi_j(a_1^-1 u_1 ... a_L^-1 u_L)] =
    (c_j/d_j)^L chi_j(h(u)) = ((2/beta) I_(2j+1)(beta))^L chi_j(h(u)).  L = 2 and 3, beta = 1.
    Criterion: 4 standard errors."""
    rng = np.random.default_rng(909)
    n, beta = 400000, 1.0
    for L in (2, 3):
        a = su2_haar(rng, (n, L))
        wgt = np.exp(0.5 * beta * trace(a).real).prod(axis=1)
        u = su2_haar(rng, (L,))
        g = dag(a[:, 0]) @ u[0]
        hol = u[0]
        for i in range(1, L):
            g = g @ dag(a[:, i]) @ u[i]
            hol = hol @ u[i]
        for twoj in (0, 1, 2):
            vals = wgt * chi(twoj, g)
            mean, sem = vals.mean(), vals.std(ddof=1) / math.sqrt(n)
            pred = (2.0 / beta * special.iv(twoj + 1, beta)) ** L * chi(twoj, hol)
            assert abs(mean - pred) < 4.0 * sem
            if twoj == 0:                                   # c_0^L is resolved to better than 1 %
                assert sem < 0.01 * abs(pred)


def _T0_prediction(beta, L, hu, hup, nrep=60):
    """sum_j Lambda_j chi_j(h) chi_j(h'), Lambda_j = ((2/beta) I_(2j+1)(beta))^L."""
    return sum((2.0 / beta * special.iv(n + 1, beta)) ** L * chi(n, hu) * chi(n, hup) for n in range(nrep))


def test_AB_su2_kernel_of_T_in_two_dimensions():
    """Stelling A, step 4, combined with Stelling B, points 1-3, for real SU(2) in D = 2: the
    kernel T(u, u') = T0(u, u') = int K(u^g, u') dg (i) is symmetric, (ii) depends on u and u'
    only through the conjugacy classes of the holonomies, (iii) equals the spectral sum
    sum_j Lambda_j chi_j(h(u)) chi_j(h(u')) (so the chi_j o h are ALL eigenfunctions with
    non-zero eigenvalue), (iv) is strictly positive, in fact T0 >= 1 (Jensen's inequality,
    because int Tr(g A) dg = 0).  Rings with L = 1 and L = 2 links by quadrature over the gauge
    group (below the hypothesis L >= 3 of the theorem, but the proofs do not use it here), L = 3
    by Monte Carlo over Haar-distributed gauge transformations."""
    rng = np.random.default_rng(64)
    # L = 1: T0(u, u') = int k(g u g^-1 u'^-1) dg; the exponent is quadratic in g with modulus
    # <= beta: polynomial degree 2l with coefficient beta^l / l!  ->  degree 40 for 1e-16 at beta <= 1.2
    g, w = su2_rule(24, 21, 42)
    for beta in (0.4, 1.2):
        for _ in range(2):
            u, up = su2_haar(rng), su2_haar(rng)
            val = np.sum(w * np.exp(0.5 * beta * trace(g @ u @ inv(g) @ inv(up)).real))
            assert abs(val - _T0_prediction(beta, 1, u, up)) < 1e-11 * math.exp(beta)
            # Jensen for L = 1, where int g u g^-1 dg = (1/2) Tr(u) 1
            assert val >= math.exp(0.25 * beta * trace(u).real * trace(up).real) * (1 - 1e-12)
    # L = 2: linear exponent in each g_i with modulus <= 2 beta = 1: degree 18 for 1e-16
    g, w = su2_rule(12, 10, 19)
    beta = 0.5
    gi = inv(g)
    for _ in range(2):
        u, up = su2_haar(rng, (2,)), su2_haar(rng, (2,))

        def T0(u, up):
            # Tr(g1 u1 g2^-1 u1'^-1) and Tr(g2 u2 g1^-1 u2'^-1), index m <-> g1, n <-> g2
            e1 = np.einsum("mij,nji->mn", g @ u[0], gi @ inv(up[0])).real
            e2 = np.einsum("mij,nji->mn", gi @ inv(up[1]), g @ u[1]).real
            return np.einsum("m,n,mn->", w, w, np.exp(0.5 * beta * (e1 + e2)))

        val = T0(u, up)
        pred = _T0_prediction(beta, 2, u[0] @ u[1], up[0] @ up[1])
        assert abs(val - pred) < 1e-10 * math.exp(2 * beta)
        assert abs(T0(up, u) - val) < 1e-10 * math.exp(2 * beta)               # symmetric
        a, b = su2_haar(rng, (2,)), su2_haar(rng, (2,))
        ua = np.array([a[0] @ u[0] @ inv(a[1]), a[1] @ u[1] @ inv(a[0])])
        upb = np.array([b[0] @ up[0] @ inv(b[1]), b[1] @ up[1] @ inv(b[0])])
        assert abs(T0(ua, upb) - val) < 1e-10 * math.exp(2 * beta)             # gauge invariant in each argument
        assert val >= 1.0
    # L = 3 by Monte Carlo over g in SU(2)^3
    n, beta, L = 300000, 1.2, 3
    g = su2_haar(rng, (n, L))
    u, up = su2_haar(rng, (L,)), su2_haar(rng, (L,))
    expo = np.zeros(n)
    for i in range(L):
        expo += trace(g[:, i] @ u[i] @ dag(g[:, (i + 1) % L]) @ inv(up[i])).real
    vals = np.exp(0.5 * beta * expo)
    mean, sem = vals.mean(), vals.std(ddof=1) / math.sqrt(n)
    pred = _T0_prediction(beta, L, u[0] @ u[1] @ u[2], up[0] @ up[1] @ up[2])
    lead = (2.0 / beta * special.iv(1, beta)) ** L
    assert abs(mean - pred) < 4.0 * sem
    assert sem < 0.01 * lead                                # the j = 0 term alone is resolved to 1 %


# =============================================================================================
# 6.  Stelling B: lemma B.1, asymptotics, continuum limit
# =============================================================================================
def test_B4_lemma_B1_and_riccati_equation():
    """Stelling B, lemma B.1 and formula (3.2): r(x) = I_(n+1)(x)/I_n(x) satisfies
    r' = 1 - r^2 - (2n+1) r / x (five-point central differences), 0 < I_(n+1)(x) < I_n(x) on a
    grid of x in [1e-3, 1e4] and n = 0 .. 40, r(x) -> 0 for x -> 0, the derivative relations of
    (S6), and the sign argument of the proof (r' < 0 wherever r = 1 would hold)."""
    def r(n, x):
        return special.ive(n + 1, x) / special.ive(n, x)

    worst = 0.0
    for n in range(0, 13):
        for x in [0.05, 0.2, 0.7, 1.0, 2.5, 5.0, 10.0, 25.0, 50.0]:
            h = 1e-3 * min(1.0, x)
            num = (-r(n, x + 2 * h) + 8 * r(n, x + h) - 8 * r(n, x - h) + r(n, x - 2 * h)) / (12 * h)
            rhs = 1.0 - r(n, x) ** 2 - (2 * n + 1) * r(n, x) / x
            worst = max(worst, abs(num - rhs))
            # truncation h^4 r^(5)/30 <= ~1e-12, rounding ~ 1.5 eps r / h <= 1e-11: tolerance 1e-9
            assert abs(num - rhs) < 1e-9
            # derivative relations of (S6) for I_n and I_(n+1), same difference formula
            for order, sign, shift in ((n, +1, n + 1), (n + 1, -1, n)):
                f = lambda y: special.iv(order, y)          # noqa: E731
                d = (-f(x + 2 * h) + 8 * f(x + h) - 8 * f(x - h) + f(x - 2 * h)) / (12 * h)
                expect = special.iv(shift, x) + sign * order / x * special.iv(order, x)
                assert abs(d - expect) < 1e-8 * (special.iv(n, x) / x + special.iv(n, x))
    assert worst < 1e-9
    xs = np.logspace(-3, 4, 141)
    for n in range(0, 41):
        rr = special.ive(n + 1, xs) / special.ive(n, xs)
        assert np.all(special.ive(n + 1, xs) > 0.0)
        assert np.all(rr > 0.0) and np.all(rr < 1.0)
        # r(x) -> 0 for x -> 0: r = x / (2 (n+1)) (1 + O(x^2))
        assert abs(rr[0] / (xs[0] / (2.0 * (n + 1))) - 1.0) < 1e-6
        # the contradiction in the proof: at r = 1 the right-hand side of (3.2) is -(2n+1)/x < 0
        assert np.all(1.0 - 1.0 ** 2 - (2 * n + 1) * 1.0 / xs < 0.0)
    # consequence (point 3): Lambda_0 > Lambda_1/2 > ... > 0 and the gap formula
    for beta in (0.05, 0.5, 2.5, 20.0, 500.0):
        seq = special.ive(np.arange(1, 60), beta)
        seq = seq[seq > 0]
        assert np.all(np.diff(seq) < 0.0)


_S_NODES, _S_WEIGHTS = composite_gauss_legendre(0.0, 12.0, 12, 24)
IVE_MAX_ARGUMENT = 2.0 ** 30        # scipy.special.ive returns NaN above this argument


def log_i1_over_inu(beta, nu):
    """ln(I_1(beta) / I_nu(beta)) for integer nu >= 1, with a RELATIVE error of a few 1e-15.

    For beta >= 200 and nu^2 <= beta the difference I_1 - I_nu is computed without cancellation
    from the integral representation of (S6),
        I_1 - I_nu = (2/pi) int_0^pi exp(beta cos t) sin((nu+1) t/2) sin((nu-1) t/2) dt,
    with t = s / sqrt(beta), s in [0, 12] (the rest contributes < exp(-72) relatively), by a
    composite Gauss-Legendre rule; then ln(I_1/I_nu) = log1p((I_1 - I_nu)/I_nu).  Otherwise the
    ratio is not close to 1 and scipy's exponentially scaled ive is accurate.  (ive itself loses
    all relative accuracy of ln(I_1/I_nu) for large beta, absolute error ~ 2e-16, and returns NaN
    for beta > 2^30.)"""
    nu = np.asarray(nu, dtype=float)
    out = np.empty(nu.shape)
    quad = (beta >= 200.0) & (nu ** 2 <= beta)
    if np.any(quad):
        t = _S_NODES / math.sqrt(beta)
        e = _S_WEIGHTS * np.exp(-2.0 * beta * np.sin(0.5 * t) ** 2)
        nq = nu[quad][..., None]
        diff = 2.0 * np.sum(e * np.sin(0.5 * (nq + 1) * t) * np.sin(0.5 * (nq - 1) * t), axis=-1)
        inu = np.sum(e * np.cos(nq * t), axis=-1)
        out[quad] = np.log1p(diff / inu)
    if np.any(~quad):
        assert beta <= IVE_MAX_ARGUMENT
        with np.errstate(divide="ignore", under="ignore"):
            out[~quad] = np.log(special.ive(1, beta)) - np.log(special.ive(nu[~quad], beta))
    return out


def test_B5_bessel_asymptotics_3_3():
    """Stelling B, proof of point 5, formula (3.3): ln(I_1(x)/I_nu(x)) = (nu^2-1)/(2x) + O(x^-2).
    The quantity x^2 |ln(I_1/I_nu) - (nu^2-1)/(2x)| stays bounded for x up to 1e12; in fact it
    tends to (nu^2-1)/4, with the next term c3(nu)/x, c3 = -(63 + (4nu^2-1)(4nu^2-25))/384
    (from the Hankel expansion of (S6) carried two orders further).  With scipy's ive for
    x <= 1e6 (rounding: absolute error ~ 1e-15 of the logarithm, i.e. 1e-15 x^2 here) and with
    the cancellation-free quadrature for x up to 1e12; the two are compared where both work."""
    nus = np.arange(2, 13)
    c3 = -(63.0 + (4 * nus ** 2 - 1.0) * (4 * nus ** 2 - 25.0)) / 384.0
    lim = (nus ** 2 - 1.0) / 4.0
    # agreement of the two evaluations (ive: a few ulp of the ratio -> absolute 1e-15)
    for x in (200.0, 1e3, 1e4, 1e5, 1e6, 1e8, 1e9):
        a = log_i1_over_inu(x, nus)
        b = np.log(special.ive(1, x) / special.ive(nus, x))
        assert np.all(np.abs(a - b) < 1.5e-15 * (1.0 + a))
    assert np.isnan(special.ive(1, 2.0 * IVE_MAX_ARGUMENT))          # why ive cannot be used beyond
    sup_scaled = 0.0
    for x in (2e3, 1e4, 1e5, 1e6, 1e8, 1e10, 4e10, 1e12):
        lead = (nus ** 2 - 1.0) / (2.0 * x)
        # bounded, and equal to (nu^2-1)/4 + c3/x up to the next order (|c4| / x^2, estimated
        # generously by 2 nu^6 / x^2) and the rounding noise of the evaluation
        scaled = x ** 2 * (log_i1_over_inu(x, nus) - lead)
        noise = 4e-15 * lead * x ** 2                       # relative error 4e-15 of the result
        assert np.all(np.abs(scaled - lim - c3 / x) < 2.0 * nus ** 6 / x ** 2 + noise + 1e-12)
        sup_scaled = max(sup_scaled, np.abs(scaled / lim).max())
        if x <= 1e6:                                        # the same with ive: absolute error 1.5e-15
            scaled = x ** 2 * (np.log(special.ive(1, x) / special.ive(nus, x)) - lead)
            assert np.all(np.abs(scaled - lim - c3 / x) < 2.0 * nus ** 6 / x ** 2 + 1.5e-15 * x ** 2 + 1e-12)
    assert sup_scaled < 1.02                                # x^2 |...| <= 1.02 (nu^2-1)/4 for x >= 2e3
    # the underlying Hankel expansion of (S6) for I_nu itself
    for x in (50.0, 200.0, 1000.0):
        for nu in (1, 2, 5):
            lhs = special.ive(nu, x) * math.sqrt(2 * math.pi * x)
            assert abs(lhs - (1.0 - (4 * nu * nu - 1) / (8 * x))) < (4 * nu * nu) ** 2 / (60.0 * x * x)


CONTINUUM_CASES = [(1.0, 1.0), (2.0, 0.5), (0.5, 3.0)]      # (g, ell)


def test_B5_continuum_limit_of_the_energies():
    """Stelling B, point 5, first part: with a = ell/L and beta = 4/(g^2 a^2),
    (E_j - E_0)/a = (L^2/ell) ln(I_1(beta)/I_(2j+1)(beta)) -> (g^2 ell/2) j(j+1) for L -> infinity;
    in particular m/a -> (3/8) g^2 ell.  L = 10^2 .. 10^5.  The relative deviation is
    1/(2 beta) (1 + O(nu^2/beta)) = g^2 ell^2/(8 L^2) (..), i.e. O(a^2) as in the proof."""
    twoj = np.arange(1, 11)                                 # j = 1/2 .. 5
    nu = twoj + 1.0
    jj1 = 0.25 * twoj * (twoj + 2)                          # j (j+1)
    for g, ell in CONTINUUM_CASES:
        prev = None
        for L in (10 ** 2, 10 ** 2.5, 10 ** 3, 10 ** 3.5, 10 ** 4, 10 ** 4.5, 10 ** 5):
            L = float(round(L))
            a = ell / L
            beta = 4.0 / (g * g * a * a)
            val = (L / a) * log_i1_over_inu(beta, nu)       # (E_j - E_0) / a
            limit = 0.5 * g * g * ell * jj1
            rel = val / limit - 1.0
            # predicted deviation 1/(2 beta) + c3/((nu^2-1)/2) / beta^2; the remainder is bounded
            # by nu^4/beta^2, the rounding by 5e-15
            assert np.all(np.abs(rel - 0.5 / beta) < nu ** 4 / beta ** 2 + 5e-15)
            assert np.all(rel > 0.0)
            if prev is not None:
                assert np.all(rel < prev)                   # monotone convergence along this sequence
            prev = rel
            # the mass gap: m / a -> (3/8) g^2 ell
            assert abs(val[0] / (0.375 * g * g * ell) - 1.0) < 1.0 / beta
        assert np.all(prev < 2e-10 * (g * ell) ** 2)        # at L = 1e5: g^2 ell^2 / (8 L^2) = 1.25e-11 (g ell)^2
    # the same with scipy's ive alone, as far as it reaches (beta <= 2^30): its rounding error
    # 1.5e-15 of the logarithm is amplified by L^2/ell
    g, ell = 1.0, 1.0
    for L in (100.0, 1000.0, 10000.0):
        beta = 4.0 * L * L / (g * g * ell * ell)
        val = (L * L / ell) * np.log(special.ive(1, beta) / special.ive(nu, beta))
        assert np.all(np.abs(val - 0.5 * g * g * ell * jj1 * (1 + 0.5 / beta))
                      < 1.5e-15 * L * L / ell + 0.5 * g * g * ell * jj1 * nu ** 4 / beta ** 2)


def _sup_norm_difference(g, ell, tau, L, N):
    """sup_j |(Lambda_j/Lambda_0)^N - exp(-tau (g^2 ell/2) j(j+1))| and the j-range used.

    Both sequences decrease in j (lemma B.1), so the supremum over j > J is at most
    max(q_J(L), q_J); J is taken so large that this is < 1e-300."""
    beta = 4.0 * L * L / (g * g * ell * ell)
    twoj = np.arange(0, 4000)
    x = tau * 0.5 * g * g * ell * 0.25 * twoj * (twoj + 2.0)
    keep = x < 800.0
    assert not keep[-1]
    twoj, x = twoj[keep], x[keep]
    xl = N * L * log_i1_over_inu(beta, twoj + 1.0)
    xl[0] = 0.0
    q_cont = np.exp(-x)
    q_latt = np.exp(-xl)
    assert q_cont[-1] < 1e-300 or x[-1] > 690.0
    assert np.all(np.diff(xl) > 0.0)                        # q_j(L) decreasing in j
    tail = max(q_latt[-1], q_cont[-1])
    # difference computed as exp(-x) expm1(-(xl - x)) to avoid cancellation
    diff = np.abs(q_cont * np.expm1(-(xl - x)))
    return max(diff.max(), tail), beta


def test_B6_operator_norm_convergence_of_the_transfer_matrix():
    """Stelling B, point 5, second part: (T/Lambda_0)^N -> exp(-tau H_c) in operator norm when
    N a -> tau, i.e. sup_j |(Lambda_j/Lambda_0)^N - exp(-tau (g^2 ell/2) j(j+1))| -> 0.
    (a) N a = tau exactly (tau = ell, N = L): the supremum decreases monotonically, like
    g^2 ell^2/(8 L^2) x max_j (x_j e^-x_j).  (b) generic tau, N = round(tau L/ell): the supremum
    is bounded by (|N a/tau - 1| + 1/beta)/e, which tends to 0 like 1/L.  L = 10^2 .. 10^5."""
    Ls = [100, 316, 1000, 3162, 10000, 31623, 100000]
    for g, ell in CONTINUUM_CASES:
        # (a)
        tau = ell
        sups = []
        for L in Ls:
            s, beta = _sup_norm_difference(g, ell, tau, float(L), float(L))
            sups.append(s)
            # |q_j(L) - q_j| = e^-x |expm1(-x eps_j)| with eps_j = 1/(2 beta) (1 + O(nu^2/beta));
            # sup_x x e^-x = 1/e
            assert s <= 1.05 * 0.5 / beta / math.e
            assert s >= 0.2 * 0.5 / beta / math.e           # and it is really of that order
        assert all(b < a for a, b in zip(sups, sups[1:]))
        assert sups[-1] < 1e-9 * (g * ell) ** 2
        # (b)
        tau = ell / math.sqrt(2.0)
        sups_b = []
        for L in Ls:
            N = float(round(tau * L / ell))
            s, beta = _sup_norm_difference(g, ell, tau, float(L), N)
            eps = abs(N * ell / L / tau - 1.0) + 1.0 / beta
            assert s <= 1.05 * eps / math.e / (1.0 - eps)
            sups_b.append(s)
            assert s <= 1.05 * (0.5 * ell / (L * tau) + 1.0 / beta) / math.e / (1.0 - eps)   # -> 0 like 1/L
        assert sups_b[-1] < 1e-5 and sups_b[-1] < sups_b[0]


# =============================================================================================
# 7.  Stelling A point 5 + Stelling B: exact finite-volume formulas, ym/exact.py, the engine
# =============================================================================================
def _lambda_ratios(beta, L, nrep):
    """rho_j = Lambda_j / Lambda_0 = (I_(2j+1)(beta)/I_1(beta))^L for 2j = 0 .. nrep-1 (point 2)."""
    with np.errstate(under="ignore"):
        return (special.ive(np.arange(nrep) + 1, beta) / special.ive(1, beta)) ** L


def _fusion_matrix(nrep):
    """F[j', j] = <chi_j', chi_1/2 chi_j> = int chi_j' chi_1/2 chi_j dg, by the class-function
    integration formula of section 3.1 (trapezoidal rule, exact for these trigonometric
    polynomials).  Not assumed to be the Clebsch-Gordan rule; the test checks that it is."""
    M = 2 * nrep + 8
    t = np.pi * np.arange(1, M) / M
    w = (2.0 / np.pi) * np.sin(t) ** 2 * (np.pi / M)
    ch = np.array([np.sin((n + 1) * t) / np.sin(t) for n in range(nrep)])
    return np.einsum("t,at,bt->ab", w * 2.0 * np.cos(t), ch, ch)


def polyakov_correlator_from_theorems(beta, L, N, t, nrep=60):
    """C(t) = mu(Tr h(u^0) Tr h(u^t)) on an L x N torus from Stelling A, point 5, with
    F = chi_1/2 o h, evaluated in the eigenbasis chi_j o h of Stelling B (T = 0 on the complement
    of H_inv):  C(t) = sum_{j, j'} |<chi_j', chi_1/2 chi_j>|^2 Lambda_j^(N-t) Lambda_j'^t /
    sum_j Lambda_j^N."""
    rho = _lambda_ratios(beta, L, nrep)
    F = _fusion_matrix(nrep)
    with np.errstate(under="ignore"):
        num = np.einsum("b,ab,a->", rho ** (N - t), F ** 2, rho ** t)
        den = np.sum(rho ** N)
    return num / den


def log_Z_2d(beta, n_plaq, nrep=200):
    """ln Z for Z = sum_j ((2/beta) I_(2j+1)(beta))^(L N) (Stelling B, point 4), n_plaq = L N."""
    nu = np.arange(nrep) + 1
    with np.errstate(divide="ignore"):
        terms = n_plaq * (math.log(2.0 / beta) + beta + np.log(special.ive(nu, beta)))
    return special.logsumexp(terms)


def plaquette_from_theorems(beta, n_plaq, nrep=200):
    """<(1/2) Tr U_p> = (1/n_plaq) d ln Z / d beta with Z of Stelling B, point 4, and
    d/dbeta ln((2/beta) I_nu) = I_(nu+1)/I_nu + (nu - 1)/beta  (from (S6))."""
    nu = np.arange(nrep) + 1
    i_nu = special.ive(nu, beta)
    keep = i_nu > 0
    nu, i_nu = nu[keep], i_nu[keep]
    with np.errstate(under="ignore"):
        wgt = (i_nu / i_nu[0]) ** n_plaq
    logder = special.ive(nu + 1, beta) / i_nu + (nu - 1.0) / beta
    return float(np.sum(wgt * logder) / np.sum(wgt))


def test_B7_consistency_with_ym_exact():
    """Stelling A, point 5, and Stelling B, points 2-4, against the independently written
    formulas of ym/exact.py: u = I_2/I_1 and lambda_j = I_(2j+1)/I_1 (ratios of the Lambda_j of
    point 2); the string tension -ln u = m / L (point 3, sec. 3.4); the Polyakov-loop correlator
    on an L x N torus, (1/4) C(t) = torelon_correlator_2d_torus(beta, L, N, t) (normalisation
    (1/2) Tr in the code); the plaquette from d ln Z / d beta with Z of point 4 =
    plaquette_2d_torus (analytic derivative and a finite difference of ln Z)."""
    F = _fusion_matrix(12)
    expect = np.zeros((12, 12))
    for n in range(11):
        expect[n, n + 1] = expect[n + 1, n] = 1.0           # chi_1/2 chi_j = chi_(j+1/2) + chi_(j-1/2)
    assert np.abs(F[:11, :11] - expect[:11, :11]).max() < 1e-12
    for beta in (0.3, 1.0, 2.5, 4.0, 9.0, 30.0):
        lam = 2.0 / beta * special.iv(np.arange(1, 8), beta)            # (c_j / d_j), 2j = 0 .. 6
        assert abs(exact.u(beta) / (lam[1] / lam[0]) - 1.0) < 1e-13
        for twoj in range(0, 7):
            assert abs(exact.lambda_j(beta, twoj) / (lam[twoj] / lam[0]) - 1.0) < 1e-13
        for L in (3, 4, 7):
            m = L * math.log(special.iv(1, beta) / special.iv(2, beta))  # point 3
            assert abs(exact.torelon_energy_2d(beta, L) / m - 1.0) < 1e-12
            assert abs(L * exact.string_tension_2d(beta) / m - 1.0) < 1e-12
        for (L, N) in [(3, 3), (4, 8), (2, 2), (6, 4), (3, 12)]:
            for t in range(1, N):
                mine = 0.25 * polyakov_correlator_from_theorems(beta, L, N, t)
                ref = exact.torelon_correlator_2d_torus(beta, L, N, t)
                assert abs(mine / ref - 1.0) < 1e-11
            n_plaq = L * N
            p1 = plaquette_from_theorems(beta, n_plaq)
            ref = exact.plaquette_2d_torus(beta, n_plaq)
            assert abs(p1 - ref) < 1e-12
            h = 1e-3 * min(1.0, beta)
            lz = lambda b: log_Z_2d(b, n_plaq)              # noqa: E731
            p2 = (-lz(beta + 2 * h) + 8 * lz(beta + h) - 8 * lz(beta - h) + lz(beta - 2 * h)) / (12 * h) / n_plaq
            # truncation h^4/30 x fifth derivative, rounding eps |ln Z| / (h n_plaq) ~ 1e-12: 1e-8
            assert abs(p2 - ref) < 1e-8
    # N -> infinity: C(t) -> exp(-m t) = u^(L t), the C_F(t) of Stelling A with gap m of point 3
    beta, L = 2.5, 4
    for t in (1, 2, 3):
        c_inf = polyakov_correlator_from_theorems(beta, L, 400, t)
        assert abs(c_inf / exact.u(beta) ** (L * t) - 1.0) < 1e-12
    # the finite-volume formula differs visibly from the leading-representation one on a small
    # torus (so the comparison above tests the full sum over j, j')
    full = 0.25 * polyakov_correlator_from_theorems(8.0, 2, 2, 1)
    assert abs(full / exact.torelon_correlator_2d(8.0, 2, 2, 1) - 1.0) > 0.02


def test_B_numbers_quoted_in_the_document():
    """Numbers and identities quoted in the text that follow from Stelling B: m = L ln(I_1/I_2)
    (overview table, point 3); the string tension a^2 sigma = -ln u(beta) = m / L (sec. 3.2,
    3.4); continuum string tension (3/8) g^2 (sec. 3.4); and section 4.6: at beta = 0.1, L = 3
    the exact gap is 3 x 3.689 = 11.07 and the lower bound of Stelling C is 0.514."""
    x = math.log(special.iv(1, 0.1) / special.iv(2, 0.1))
    assert f"{x:.3f}" == "3.689" and f"{3 * x:.2f}" == "11.07"
    assert f"{-math.log(6 * math.tanh(0.1)):.3f}" == "0.514"
    assert 3 * x > -math.log(6 * math.tanh(0.1))
    for beta in (0.1, 2.2, 2.5, 10.0):
        assert abs(-math.log(exact.u(beta)) - math.log(special.iv(1, beta) / special.iv(2, beta))) < 1e-13
    # sigma = (3/8) g^2 in the continuum: a^2 sigma = -ln u(4/(g^2 a^2)) ~ (3/8) g^2 a^2
    g = 1.3
    for a in (1e-2, 1e-3):
        beta = 4.0 / (g * g * a * a)
        sig = float(log_i1_over_inu(beta, np.array([2.0]))[0]) / (a * a)
        assert abs(sig / (0.375 * g * g) - 1.0) < 1.0 / beta


def _run_2d(N, L, beta, seed, ntherm, nmeas, binsize, chunk=100000):
    """Heatbath simulation of the D = 2 lattice (N time slices, ring of L sites) with the engine.

    Per sweep: p[t] = (1/2) Tr h(u^t), the Polyakov loop around the ring in time slice t, the
    correlator c[t] = mean_t0 p[t0] p[t0 + t] for t = 0 .. N/2, and the mean plaquette.  Returns
    the bin means (ym.stats.bin_means, bins of `binsize` consecutive sweeps) of c and of the
    plaquette, and the integrated autocorrelation times of the plaquette and of c[1] measured on
    the first chunk of sweeps."""
    assert chunk % binsize == 0 and nmeas % chunk == 0
    lat = ymlat.Lattice((N, L), beta, seed=seed)
    lat.hot_start()
    lat.heatbath_sweep(ntherm)
    base = np.ascontiguousarray(np.arange(lat.V, dtype=np.int64).reshape(lat.shape)[:, 0].ravel())
    out = np.empty(N)
    nt = N // 2 + 1
    cbins, pbins, taus = [], [], None
    for _ in range(nmeas // chunk):
        p = np.empty((chunk, N))
        P = np.empty(chunk)
        for i in range(chunk):
            ymlat.heatbath_sweep_kernel(lat.U, lat.up, lat.dn, lat.beta, 1)
            ymlat.polyakov_kernel(lat.U, lat.up, 1, L, base, out)
            p[i] = out
            P[i] = ymlat.plaquette_sum_kernel(lat.U, lat.up)
        P /= lat.n_plaq
        corr = np.stack([(p * np.roll(p, -t, axis=1)).mean(axis=1) for t in range(nt)], axis=1)
        if taus is None:
            taus = (stats.mean_err_tau(P)["tau_int"], stats.mean_err_tau(corr[:, 1])["tau_int"])
        cbins.append(stats.bin_means(corr, binsize))
        pbins.append(stats.bin_means(P, binsize))
    # the kernels called directly are what the public methods of Lattice call
    assert np.array_equal(lat.polyakov_loops(1), out)
    assert abs(lat.plaquette() - P[-1]) < 1e-14
    return np.concatenate(cbins), np.concatenate(pbins), taus


def _compare_simulation_with_stelling_B(N, L, beta, seed, nmeas, binsize=100):
    """Returns a dict of results; raises AssertionError if the binning is not justified."""
    cb, pb, taus = _run_2d(N, L, beta, seed, ntherm=1000, nmeas=nmeas, binsize=binsize)
    nt = N // 2 + 1
    # autocorrelation: the bins must be much longer than tau_int
    assert binsize >= 20 * max(taus)
    c_val, c_err, _ = stats.jackknife(lambda m: m, cb)
    p_val, p_err, _ = stats.jackknife(lambda m: m, pb)
    m_val, m_err, _ = stats.jackknife(lambda m: math.log(m[1] / m[2]), cb)
    c_exact = np.array([0.25 * polyakov_correlator_from_theorems(beta, L, N, t) for t in range(nt)])
    p_exact = plaquette_from_theorems(beta, L * N)
    return {
        "z_corr": (c_val - c_exact) / c_err, "c_val": c_val, "c_err": c_err, "c_exact": c_exact,
        "z_plaq": (p_val - p_exact) / p_err, "p_val": p_val, "p_err": p_err, "p_exact": p_exact,
        "m_eff": m_val, "m_err": m_err, "m_eff_exact": math.log(c_exact[1] / c_exact[2]),
        "m_gap": L * math.log(special.ive(1, beta) / special.ive(2, beta)), "tau_int": max(taus),
    }


def _assert_simulation_agrees(res, nsigma=4.0):
    assert np.abs(res["z_corr"]).max() < nsigma
    assert abs(res["z_plaq"]) < nsigma
    assert abs(res["m_eff"] - res["m_eff_exact"]) < nsigma * res["m_err"]


def test_B8_engine_polyakov_correlator_and_plaquette_quick():
    """End to end: Stelling A, point 5, and Stelling B, points 2-4, against a heatbath simulation
    with the real engine (ym.lattice.Lattice, D = 2, ring of L = 4 sites, N = 8 time slices,
    beta = 4, fixed seed, 3e5 sweeps).  Polyakov-loop correlator <p(t0) p(t0+t)>, p = (1/2) Tr h,
    for t = 0 .. 4, the plaquette, and the effective mass ln(C(1)/C(2)), compared with the exact
    finite-volume formulas; errors from binning + jackknife (ym.stats).  Criterion: every
    deviation below 4 standard errors, with C(1) resolved to better than 1 % and the plaquette to
    2e-4, so that a wrong exponent (L -> L +- 1 changes C(1) by a factor 1.5) or a wrong Bessel
    index would fail by many standard errors."""
    N, L, beta = 8, 4, 4.0
    res = _compare_simulation_with_stelling_B(N, L, beta, seed=20261115, nmeas=300000)
    _assert_simulation_agrees(res)
    assert res["c_err"][1] < 0.01 * res["c_exact"][1]
    assert res["p_err"] < 2e-4
    # the measured decay rate is the gap m = L ln(I_1/I_2) of point 3 (up to the tiny, exactly
    # known contribution of higher representations and of the wrap-around)
    assert abs(res["m_eff_exact"] - res["m_gap"]) < 0.01
    assert abs(res["m_eff"] - res["m_gap"]) < 4.0 * res["m_err"] + 0.01
    assert res["m_err"] < 0.05 * res["m_gap"]


@pytest.mark.slow
@pytest.mark.parametrize("N, L, beta, seed", [(8, 4, 2.0, 101), (8, 4, 3.0, 102), (8, 4, 4.0, 103),
                                              (4, 6, 6.0, 104)])
def test_B8_engine_polyakov_correlator_and_plaquette_slow(N, L, beta, seed):
    """As the quick version, with 3e6 sweeps per parameter set: L x N = 4 x 8 at beta = 2, 3, 4
    and 6 x 4 at beta = 6.  Criterion: every deviation (correlator at t = 0 .. N/2, plaquette,
    effective mass) below 4 standard errors."""
    res = _compare_simulation_with_stelling_B(N, L, beta, seed=seed, nmeas=3000000)
    _assert_simulation_agrees(res)
    assert res["c_err"][1] < 0.02 * res["c_exact"][1]
    assert res["p_err"] < 1e-4
