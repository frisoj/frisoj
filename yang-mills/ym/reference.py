"""Independent reference implementation of pure SU(2) lattice gauge theory (Wilson action).

PURPOSE
    Cross-check of the production engine ``ym/lattice.py``.  The value of this module is its
    INDEPENDENCE, so every design decision is deliberately different from the engine:

    ===================  ================================  =====================================
    aspect               engine (ym/lattice.py)            this module
    ===================  ================================  =====================================
    link representation  real unit quaternion (4 floats)   explicit 2x2 complex128 matrix
    field layout         U[site_index, mu, 4] + tables     U[x0, ..., x_{D-1}, mu, 2, 2]
    neighbours           precomputed up/dn index tables    numpy.roll on the lattice axes
    update               heatbath (+ overrelaxation)       multi-hit Metropolis, checkerboard
    random numbers       numba global Mersenne Twister     numpy Generator (PCG64), per object
    compiled code        numba                             none (pure numpy)
    matrix algebra       SU(2)-specific quaternion rules   generic complex 2x2 products
    ===================  ================================  =====================================

    This module does NOT import ``ym.lattice`` (and not ``ym.exact`` either).  It is a slow but
    transparent code: every observable is written straight from its definition.

    It is a numerical tool for validating a Monte Carlo program.  Nothing in here is, or may be
    presented as, a proof of anything about continuum Yang-Mills theory.

CONVENTIONS (project-wide)
    * lattice shape (L0, ..., L_{D-1}), all extents even, axis 0 = Euclidean time, periodic;
    * U_mu(x) points from x to x + mu;
    * plaquette  U_{mu nu}(x) = U_mu(x) U_nu(x+mu) U_mu(x+nu)^dagger U_nu(x)^dagger;
    * Wilson action S = beta * sum_{x, mu<nu} (1 - (1/2) Re Tr U_{mu nu}(x)), weight exp(-S);
    * "plaquette" P = < (1/2) Tr U_p >, cold start gives exactly 1;
    * quaternion <-> matrix dictionary (only used for converting engine configurations):
      q = (a0, a1, a2, a3)  <->  U = a0*1 + i*(a1*sigma1 + a2*sigma2 + a3*sigma3)
                                   = [[ a0 + i a3,  a2 + i a1],
                                      [-a2 + i a1,  a0 - i a3]].

WHICH LINKS MAY BE UPDATED SIMULTANEOUSLY
    Two links share a plaquette only if they are (a) of different direction, or (b) of the same
    direction mu and sit at sites x and x +- nu with nu != mu.  In case (b) the two sites have
    opposite parity (x0 + ... + x_{D-1}) mod 2, because all extents are even (also for extent 2,
    where x + nu and x - nu are the same site).  Hence the links {U_mu(x) : parity(x) = p} for a
    FIXED direction mu and FIXED parity p never share a plaquette: their local actions are
    independent, and updating them simultaneously is identical to updating them one after the
    other.  One sweep = the 2*D classes (mu, p) in turn.  This statement is verified numerically
    in tests/test_crosscheck.py (sum of the individual action differences == action difference of
    the simultaneous change, plus single-link brute-force checks).

USAGE
    >>> from ym import reference as ref
    >>> run = ref.simulate((8, 8, 8), beta=6.0, seed=1, n_therm=200, n_meas=1000, n_hit=8)
    >>> mean, err = ref.binned(run["series"][:, 0], 40)        # plaquette, see OBSERVABLES
    >>> lat = ref.RefLattice.from_quaternions(shape, beta, engine_lattice.U)   # engine -> matrices
    >>> lat.plaquette(), lat.wilson_loop(2, 2), lat.polyakov_loops(0), lat.action()

COST (single thread, n_hit = 8; this code is 10-20 times slower than the engine by design)
    sweep / full measurement:  16x16: 1.7 / 0.7 ms (n_hit 4),  8^3: 6.5 / 1.7 ms,
    6^4: 17 / 4.8 ms,  12^3 (n_hit 2): 7.2 / 3.5 ms,  8^4 (n_hit 2): 28 / 14 ms.
    Integrated autocorrelation time of the plaquette with n_hit = 8 at 50% acceptance:
    about 1 sweep (D=2, D=3 at beta 3-6), 8 sweeps (6^4, beta = 2.3), 2-3 sweeps (6^4, beta = 2.5).
"""
from __future__ import annotations

import copy as _copy

import numpy as np
from scipy.special import ive

__all__ = [
    "mm", "dag", "retr", "shift", "quaternion_to_matrix", "matrix_to_quaternion",
    "u_exact", "strong_coupling_lo", "strong_coupling_t10", "RefLattice", "simulate", "binned",
    "tau_int", "OBSERVABLES",
]


# ----------------------------------------------------------------------------------------------
# generic 2x2 complex matrix helpers (no SU(2) shortcuts: these work for ANY 2x2 matrices)
# ----------------------------------------------------------------------------------------------
def mm(a, b):
    """Matrix product a @ b for stacks of general complex 2x2 matrices (shape (..., 2, 2))."""
    out = np.empty(np.broadcast_shapes(a.shape, b.shape), dtype=np.complex128)
    out[..., 0, 0] = a[..., 0, 0] * b[..., 0, 0] + a[..., 0, 1] * b[..., 1, 0]
    out[..., 0, 1] = a[..., 0, 0] * b[..., 0, 1] + a[..., 0, 1] * b[..., 1, 1]
    out[..., 1, 0] = a[..., 1, 0] * b[..., 0, 0] + a[..., 1, 1] * b[..., 1, 0]
    out[..., 1, 1] = a[..., 1, 0] * b[..., 0, 1] + a[..., 1, 1] * b[..., 1, 1]
    return out


def dag(a):
    """Hermitian conjugate of a stack of 2x2 matrices."""
    return np.conj(np.swapaxes(a, -1, -2))


def retr(a):
    """Real part of the trace of a stack of 2x2 matrices."""
    return a[..., 0, 0].real + a[..., 1, 1].real


def shift(field, mu, n=1):
    """Return the field translated so that result(x) = field(x + n*mu) (periodic).

    ``field`` has the lattice axes first; ``mu`` is a lattice axis.
    """
    return np.roll(field, -n, axis=mu)


def quaternion_to_matrix(q):
    """(..., 4) real array (a0, a1, a2, a3) -> (..., 2, 2) complex matrices a0 + i a.sigma."""
    q = np.asarray(q, dtype=np.float64)
    m = np.empty(q.shape[:-1] + (2, 2), dtype=np.complex128)
    m[..., 0, 0] = q[..., 0] + 1j * q[..., 3]
    m[..., 0, 1] = q[..., 2] + 1j * q[..., 1]
    m[..., 1, 0] = -q[..., 2] + 1j * q[..., 1]
    m[..., 1, 1] = q[..., 0] - 1j * q[..., 3]
    return m


def matrix_to_quaternion(m):
    """Inverse of :func:`quaternion_to_matrix` for matrices of the form a0 + i a.sigma (a real).

    Uses the projections a0 = Re Tr(M)/2, a_k = Im Tr(sigma_k M)/2, so that for a matrix that is
    not exactly of that form the result is its orthogonal projection.
    """
    m = np.asarray(m, dtype=np.complex128)
    q = np.empty(m.shape[:-2] + (4,), dtype=np.float64)
    q[..., 0] = 0.5 * (m[..., 0, 0].real + m[..., 1, 1].real)
    q[..., 1] = 0.5 * (m[..., 0, 1].imag + m[..., 1, 0].imag)
    q[..., 2] = 0.5 * (m[..., 0, 1].real - m[..., 1, 0].real)
    q[..., 3] = 0.5 * (m[..., 0, 0].imag - m[..., 1, 1].imag)
    return q


# ----------------------------------------------------------------------------------------------
# exact formulas, written independently of ym/exact.py
# ----------------------------------------------------------------------------------------------
def u_exact(beta):
    """u(beta) = I_2(beta) / I_1(beta) (exponentially scaled Bessel functions, no overflow)."""
    beta = float(beta)
    return float(ive(2, beta) / ive(1, beta))


def strong_coupling_lo(beta, D):
    """Leading strong-coupling prediction P = u + 8 (D-2) u^5 u', u' = du/dbeta = 1 - u^2 - 3u/beta.

    Returns (prediction, u, t6) with t6 = 8 (D-2) u^5 u'.

    Origin of the coefficient (re-derived here, independently of the orchestrator's statement):
    with the character expansion exp((beta/2) chi_{1/2}(U)) = c0(beta) (1 + sum_j d_j lambda_j chi_j(U)),
    c0 = 2 I_1(beta)/beta, lambda_{1/2} = u, one has d ln c0 / dbeta = u, and the lowest non-trivial
    closed surfaces are the elementary cubes with all six faces in the fundamental representation,
    each contributing d^2 u^6 = 4 u^6 to ln Z.  There are C(D,3) cubes and C(D,2) plaquettes per
    site, hence P = (1/N_p) d ln Z / dbeta = u + (C(D,3)/C(D,2)) * 24 u^5 u' = u + 8 (D-2) u^5 u'.
    """
    u = u_exact(beta)
    du = 1.0 - u * u - 3.0 * u / float(beta)
    t6 = 8.0 * (D - 2) * u ** 5 * du
    return u + t6, u, t6


def strong_coupling_t10(beta, D):
    """Next term of the strong-coupling series, t10 = 40 (D-2)(2D-5) u^9 u'.

    Re-derived here: the next closed surfaces are two cubes glued along a common face (10
    fundamental plaquettes, the shared face removed), each contributing 4 u^10 to ln Z.  A given
    plaquette belongs to 2(D-2) cubes, so there are C(2(D-2), 2) = (D-2)(2D-5) such pairs per
    plaquette; differentiating gives 40 (D-2)(2D-5) u^9 u' per plaquette.  (A shared face left in
    the j = 1 representation costs an extra lambda_1 ~ u^2, and single cubes in higher
    representations start at u^12, so nothing else contributes at this order.)  This agrees with
    the expression found independently by the engine author.
    """
    u = u_exact(beta)
    du = 1.0 - u * u - 3.0 * u / float(beta)
    return 40.0 * (D - 2) * (2 * D - 5) * u ** 9 * du


# ----------------------------------------------------------------------------------------------
# the lattice
# ----------------------------------------------------------------------------------------------
class RefLattice:
    """SU(2) gauge field as explicit complex matrices; multi-hit checkerboard Metropolis.

    Parameters
    ----------
    shape : tuple of 2, 3 or 4 even ints >= 2 (axis 0 = time)
    beta : Wilson coupling
    seed : seed of the private numpy Generator
    eps : maximal rotation angle of the Metropolis proposal (0 < eps <= pi)
    n_hit : number of Metropolis hits per link visit

    Attributes
    ----------
    U : complex128 array of shape shape + (D, 2, 2);  U[x0, ..., x_{D-1}, mu] = U_mu(x).
    """

    EPS_MIN = 1.0e-3
    EPS_MAX = np.pi

    def __init__(self, shape, beta, seed=0, eps=0.6, n_hit=8):
        shape = tuple(int(n) for n in shape)
        if len(shape) not in (2, 3, 4):
            raise ValueError("number of dimensions must be 2, 3 or 4")
        if any(n < 2 or n % 2 for n in shape):
            raise ValueError("every extent must be even and >= 2")
        self.shape = shape
        self.D = len(shape)
        self.V = int(np.prod(shape))
        self.n_plaq = self.V * self.D * (self.D - 1) // 2
        self.beta = float(beta)
        self.eps = float(eps)
        self.n_hit = int(n_hit)
        self.rng = np.random.default_rng(seed)
        coords = np.indices(shape)
        #: parity (x0 + ... + x_{D-1}) mod 2 of every site
        self.parity = coords.sum(axis=0) % 2
        self._masks = (self.parity == 0, self.parity == 1)
        self.U = np.empty(shape + (self.D, 2, 2), dtype=np.complex128)
        self.cold_start()
        self.sweeps_done = 0
        #: re-project onto SU(2) every this many sweeps (0 = never)
        self.reunit_every = 100

    # ------------------------------------------------------------------ configurations
    def cold_start(self):
        self.U[...] = 0.0
        self.U[..., 0, 0] = 1.0
        self.U[..., 1, 1] = 1.0

    def hot_start(self):
        """Independent Haar-distributed links (uniform points on S^3)."""
        q = self.rng.standard_normal(self.shape + (self.D, 4))
        q /= np.sqrt((q * q).sum(axis=-1, keepdims=True))
        self.U[...] = quaternion_to_matrix(q)

    def copy(self):
        """Deep copy (configuration, parameters and generator state)."""
        other = RefLattice.__new__(RefLattice)
        other.__dict__.update(self.__dict__)
        other.U = self.U.copy()
        other.rng = _copy.deepcopy(self.rng)
        return other

    def link(self, mu):
        """View of the direction-mu link field, shape = shape + (2, 2)."""
        return self.U[..., mu, :, :]

    # ------------------------------------------------------------------ group checks
    def unitarity_violation(self):
        """max over links of max(|U U^dagger - 1|_max, |det U - 1|)."""
        u = self.U
        uu = mm(u, dag(u))
        uu[..., 0, 0] -= 1.0
        uu[..., 1, 1] -= 1.0
        det = u[..., 0, 0] * u[..., 1, 1] - u[..., 0, 1] * u[..., 1, 0]
        return float(max(np.abs(uu).max(), np.abs(det - 1.0).max()))

    def reunitarize(self):
        """Project every link back onto SU(2): Gram-Schmidt on the rows, then fix det = 1."""
        u = self.U
        r0 = u[..., 0, :].copy()
        r1 = u[..., 1, :].copy()
        r0 /= np.sqrt((np.abs(r0) ** 2).sum(axis=-1, keepdims=True))
        r1 -= (np.conj(r0) * r1).sum(axis=-1, keepdims=True) * r0
        r1 /= np.sqrt((np.abs(r1) ** 2).sum(axis=-1, keepdims=True))
        det = r0[..., 0] * r1[..., 1] - r0[..., 1] * r1[..., 0]
        r1 /= det[..., None]
        u[..., 0, :] = r0
        u[..., 1, :] = r1

    # ------------------------------------------------------------------ gauge transformations
    def random_gauge(self):
        """Haar-random gauge function G(x), shape = shape + (2, 2)."""
        q = self.rng.standard_normal(self.shape + (4,))
        q /= np.sqrt((q * q).sum(axis=-1, keepdims=True))
        return quaternion_to_matrix(q)

    def gauge_transform(self, G):
        """U_mu(x) -> G(x) U_mu(x) G(x+mu)^dagger."""
        for mu in range(self.D):
            self.U[..., mu, :, :] = mm(mm(G, self.link(mu)), dag(shift(G, mu)))

    # ------------------------------------------------------------------ action
    def plaquette_field(self, mu, nu):
        """U_{mu nu}(x) = U_mu(x) U_nu(x+mu) U_mu(x+nu)^dagger U_nu(x)^dagger for every x."""
        umu = self.link(mu)
        unu = self.link(nu)
        return mm(mm(umu, shift(unu, mu)), mm(dag(shift(umu, nu)), dag(unu)))

    def plaquette_planes(self):
        """Mean of (1/2) Re Tr U_{mu nu} for each plane mu < nu (lexicographic order)."""
        return np.array([0.5 * retr(self.plaquette_field(mu, nu)).mean()
                         for mu in range(self.D) for nu in range(mu + 1, self.D)])

    def plaquette(self):
        """P = mean over all plaquettes of (1/2) Re Tr U_p."""
        return float(self.plaquette_planes().mean())

    def action(self):
        """Wilson action S = beta * sum_{x, mu<nu} (1 - (1/2) Re Tr U_{mu nu}(x))."""
        s = 0.0
        for mu in range(self.D):
            for nu in range(mu + 1, self.D):
                s += (1.0 - 0.5 * retr(self.plaquette_field(mu, nu))).sum()
        return float(self.beta * s)

    def staple_sum(self, mu):
        """A_mu(x) = sum over nu != mu of the two staples closing U_mu(x) into a plaquette:

            U_nu(x+mu) U_mu(x+nu)^dagger U_nu(x)^dagger
          + U_nu(x+mu-nu)^dagger U_mu(x-nu)^dagger U_nu(x-nu).

        The part of the action that depends on U_mu(x) is -(beta/2) Re Tr[U_mu(x) A_mu(x)].
        Returned for all sites, shape = shape + (2, 2).
        """
        umu = self.link(mu)
        total = np.zeros(self.shape + (2, 2), dtype=np.complex128)
        for nu in range(self.D):
            if nu == mu:
                continue
            unu = self.link(nu)
            unu_xpmu = shift(unu, mu)
            # forward staple
            total += mm(mm(unu_xpmu, dag(shift(umu, nu))), dag(unu))
            # backward staple: f(y) = U_nu(y+mu)^dagger U_mu(y)^dagger U_nu(y) evaluated at y = x - nu
            f = mm(mm(dag(unu_xpmu), dag(umu)), unu)
            total += shift(f, nu, -1)
        return total

    # ------------------------------------------------------------------ Metropolis
    def random_near_identity(self, n):
        """n random SU(2) matrices X = exp(i theta nhat.sigma) = cos(theta) + i sin(theta) nhat.sigma.

        nhat is uniform on the sphere and theta uniform in [0, eps], so X and X^{-1} (nhat -> -nhat)
        have the same probability density: the proposal U -> X U is symmetric, as Metropolis needs.
        eps = pi covers the whole group.
        """
        v = self.rng.standard_normal((n, 3))
        v /= np.sqrt((v * v).sum(axis=1, keepdims=True))
        theta = self.eps * self.rng.random(n)
        c = np.cos(theta)
        v *= np.sin(theta)[:, None]                        # v = sin(theta) * nhat
        # X = [[c + i v3, v2 + i v1], [-v2 + i v1, c - i v3]]  (filled through real/imag views)
        x = np.empty((n, 2, 2), dtype=np.complex128)
        xr = x.real
        xi = x.imag
        xr[:, 0, 0] = c
        xi[:, 0, 0] = v[:, 2]
        xr[:, 0, 1] = v[:, 1]
        xi[:, 0, 1] = v[:, 0]
        xr[:, 1, 0] = -v[:, 1]
        xi[:, 1, 0] = v[:, 0]
        xr[:, 1, 1] = c
        xi[:, 1, 1] = -v[:, 2]
        return x

    def update_class(self, mu, parity, n_hit=None, log=None):
        """n_hit Metropolis hits on all links U_mu(x) with parity(x) == parity, simultaneously.

        Returns the number of accepted proposals.  If ``log`` is a list, a dict with the current
        links, the proposed links, the action differences and the accept flags of every hit is
        appended to it (used by the tests to compare with brute-force action differences).
        """
        n_hit = self.n_hit if n_hit is None else int(n_hit)
        mask = self._masks[parity]
        staple = self.staple_sum(mu)[mask]                 # (n, 2, 2); does not change during hits
        cur = self.link(mu)[mask]                          # (n, 2, 2) copy
        n = cur.shape[0]
        tr_cur = retr(mm(cur, staple))
        half_beta = 0.5 * self.beta
        n_acc = 0
        for _ in range(n_hit):
            new = mm(self.random_near_identity(n), cur)
            tr_new = retr(mm(new, staple))
            d_action = -half_beta * (tr_new - tr_cur)      # S(new) - S(cur), exact
            accept = self.rng.random(n) < np.exp(np.minimum(0.0, -d_action))
            if log is not None:
                log.append({"mu": mu, "parity": parity, "cur": cur.copy(), "new": new.copy(),
                            "dS": d_action.copy(), "accept": accept.copy()})
            cur = np.where(accept[:, None, None], new, cur)
            tr_cur = np.where(accept, tr_new, tr_cur)
            n_acc += int(accept.sum())
        self.link(mu)[mask] = cur
        return n_acc

    def sweep(self, n=1):
        """n Metropolis sweeps (all 2*D checkerboard classes each); returns the acceptance rate."""
        n_acc = 0
        for _ in range(int(n)):
            for mu in range(self.D):
                for parity in (0, 1):
                    n_acc += self.update_class(mu, parity)
            self.sweeps_done += 1
            if self.reunit_every and self.sweeps_done % self.reunit_every == 0:
                self.reunitarize()
        return n_acc / float(max(1, int(n)) * self.V * self.D * self.n_hit)

    def thermalize(self, n_sweeps, tune=True, target=0.5):
        """n_sweeps sweeps.  With tune=True the proposal width eps is adapted towards the target
        acceptance during the FIRST HALF only and is frozen afterwards (adapting eps while
        measuring would violate detailed balance).  Returns the acceptance of the last sweep."""
        acc = np.nan
        n_tune = n_sweeps // 2 if tune else 0
        for i in range(int(n_sweeps)):
            acc = self.sweep()
            if i < n_tune:
                self.eps = float(np.clip(self.eps * np.exp(acc - target), self.EPS_MIN, self.EPS_MAX))
        return acc

    # ------------------------------------------------------------------ observables
    def line(self, mu, n):
        """Product of n consecutive links: L(x) = U_mu(x) U_mu(x+mu) ... U_mu(x+(n-1)mu)."""
        umu = self.link(mu)
        out = umu.copy()
        for k in range(1, int(n)):
            out = mm(out, shift(umu, mu, k))
        return out

    def _loop_from_lines(self, a, b, R, T, mu, nu):
        # a = R-link line along mu, b = T-link line along nu
        w = mm(mm(a, shift(b, mu, R)), mm(dag(shift(a, nu, T)), dag(b)))
        return float(0.5 * retr(w).mean())

    def wilson_loop(self, R, T, mu=None, nu=None):
        """< (1/2) Re Tr W > of the R x T rectangle, R links along mu and T links along nu,

            W(x) = L_mu^R(x) L_nu^T(x + R mu) L_mu^R(x + T nu)^dagger L_nu^T(x)^dagger,

        averaged over all sites.  With mu = nu = None: average over all ordered pairs mu != nu.
        """
        if mu is None and nu is None:
            la = [self.line(m, R) for m in range(self.D)]
            lb = la if T == R else [self.line(m, T) for m in range(self.D)]
            vals = [self._loop_from_lines(la[m], lb[n], R, T, m, n)
                    for m in range(self.D) for n in range(self.D) if m != n]
            return float(np.mean(vals))
        if mu is None or nu is None or mu == nu:
            raise ValueError("give both mu and nu (different), or neither")
        return self._loop_from_lines(self.line(mu, R), self.line(nu, T), R, T, mu, nu)

    def polyakov_loops(self, mu):
        """(1/2) Re Tr prod_{t=0}^{L_mu-1} U_mu(x + t mu) for all x with x_mu = 0.

        Result has the lattice shape with axis mu removed (C order of the remaining axes).
        """
        umu = np.moveaxis(self.link(mu), mu, 0)            # (L_mu, other axes..., 2, 2)
        prod = umu[0].copy()
        for t in range(1, self.shape[mu]):
            prod = mm(prod, umu[t])
        return 0.5 * retr(prod)

    def measure(self, loops=True):
        """One measurement of the standard observable set (see OBSERVABLES).

        plaq   : plaquette P
        w12    : Wilson loop W(1,2), averaged over all ordered pairs mu != nu
        w22    : Wilson loop W(2,2), same average
        pol2   : mean over directions mu and transverse sites of p_mu(x)^2
        polabs : mean over directions mu of | transverse average of p_mu(x) |
        """
        out = np.full(len(OBSERVABLES), np.nan)
        if not loops:
            out[0] = self.plaquette()
            return out
        D = self.D
        l1 = [self.link(m) for m in range(D)]
        l2 = [mm(l1[m], shift(l1[m], m)) for m in range(D)]
        p11, w12, w22 = [], [], []
        for m in range(D):
            for n in range(D):
                if m == n:
                    continue
                w12.append(self._loop_from_lines(l1[m], l2[n], 1, 2, m, n))
                if m < n:
                    p11.append(self._loop_from_lines(l1[m], l1[n], 1, 1, m, n))
                    w22.append(self._loop_from_lines(l2[m], l2[n], 2, 2, m, n))
        pol2, polabs = [], []
        for m in range(D):
            p = self.polyakov_loops(m)
            pol2.append((p * p).mean())
            polabs.append(abs(p.mean()))
        out[0] = np.mean(p11)
        out[1] = np.mean(w12)
        out[2] = np.mean(w22)          # W(2,2;mu,nu) = W(2,2;nu,mu): unordered pairs suffice
        out[3] = np.mean(pol2)
        out[4] = np.mean(polabs)
        return out

    # ------------------------------------------------------------------ interoperability
    @classmethod
    def from_quaternions(cls, shape, beta, q, seed=0, **kw):
        """Build a RefLattice from engine-style links q[site_index, mu, 0:4] (C-order sites)."""
        lat = cls(shape, beta, seed=seed, **kw)
        q = np.asarray(q, dtype=np.float64)
        if q.shape != (lat.V, lat.D, 4):
            raise ValueError("expected quaternion links of shape (V, D, 4)")
        lat.U[...] = quaternion_to_matrix(q.reshape(lat.shape + (lat.D, 4)))
        return lat

    def to_quaternions(self):
        """Links as an engine-style array (V, D, 4)."""
        return matrix_to_quaternion(self.U).reshape(self.V, self.D, 4)


#: order of the entries returned by RefLattice.measure
OBSERVABLES = ("plaq", "w12", "w22", "pol2", "polabs")


# ----------------------------------------------------------------------------------------------
# driver and error analysis
# ----------------------------------------------------------------------------------------------
def simulate(shape, beta, seed, n_therm, n_meas, meas_every=1, n_hit=8, eps=0.6, start="cold",
             loops=True):
    """Thermalise (tuning eps in the first half of thermalisation), then measure.

    Returns a dict with the time series ``series`` (n_meas, len(OBSERVABLES)), the frozen ``eps``,
    the measured ``acceptance`` during the measurement phase, and the lattice ``lat``.
    """
    lat = RefLattice(shape, beta, seed=seed, eps=eps, n_hit=n_hit)
    if start == "hot":
        lat.hot_start()
    elif start != "cold":
        raise ValueError("start must be 'cold' or 'hot'")
    lat.thermalize(n_therm, tune=True)
    series = np.empty((int(n_meas), len(OBSERVABLES)))
    acc = 0.0
    for i in range(int(n_meas)):
        acc += lat.sweep(meas_every)
        series[i] = lat.measure(loops=loops)
    return {"series": series, "eps": lat.eps, "acceptance": acc / max(1, int(n_meas)), "lat": lat,
            "unitarity": lat.unitarity_violation()}


def binned(x, n_bins=40):
    """Mean and standard error of the mean of a correlated series from n_bins equal bins
    (trailing measurements that do not fill a bin are dropped)."""
    x = np.asarray(x, dtype=np.float64)
    n_bins = int(n_bins)
    length = x.shape[0] // n_bins
    if length < 1:
        raise ValueError("series shorter than the number of bins")
    means = x[: length * n_bins].reshape(n_bins, length).mean(axis=1)
    return float(means.mean()), float(means.std(ddof=1) / np.sqrt(n_bins))


def tau_int(x, c=6.0):
    """Integrated autocorrelation time (in units of the measurement spacing), tau = 1/2 + sum rho,
    with the Madras-Sokal automatic window W >= c * tau."""
    x = np.asarray(x, dtype=np.float64)
    n = x.shape[0]
    d = x - x.mean()
    var = float(np.dot(d, d)) / n
    if var == 0.0:
        return 0.5
    tau = 0.5
    for w in range(1, n // 2):
        tau += float(np.dot(d[:-w], d[w:])) / ((n - w) * var)
        if w >= c * tau:
            break
    return max(tau, 0.5)
