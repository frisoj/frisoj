"""Core engine: pure SU(2) lattice gauge theory with the Wilson action in D = 2, 3, 4.

Conventions (binding for the whole project)
-------------------------------------------
* An SU(2) element is a real unit 4-vector q = (a0, a1, a2, a3) meaning
  U = a0*1 + i*(a1*sigma1 + a2*sigma2 + a3*sigma3).  Then (1/2) Tr U = a0,
  U^dagger = (a0, -a1, -a2, -a3) and (ab)_0 = a0 b0 - avec.bvec,
  (ab)_vec = a0 bvec + b0 avec - avec x bvec.
* Lattice shape (L0, ..., L_{D-1}), every extent even, axis 0 = Euclidean time, periodic
  boundary conditions.  Site index s = C-order ravel of the coordinates.
* U[s, mu, :] (float64, shape (V, D, 4)) is the link from site x to x + mu.
* Plaquette U_{mu nu}(x) = U_mu(x) U_nu(x+mu) U_mu^dagger(x+nu) U_nu^dagger(x).
* Wilson action S = beta * sum_{x, mu<nu} (1 - (1/2) Tr U_{mu nu}(x)), weight exp(-S).
* "plaquette" = <(1/2) Tr U_p> averaged over all plaquettes (cold start: exactly 1).

Random numbers / reproducibility
--------------------------------
All random numbers used by the kernels come from numba's own Mersenne-Twister state
(``np.random.*`` called inside njit code), which is seeded by ``seed_numba(seed)`` (an njit
function calling ``np.random.seed``).  ``Lattice(shape, beta, seed)`` seeds it on construction.
Consequences:

* A program that constructs a Lattice with a given seed and performs the same sequence of calls
  is bit-for-bit reproducible (same machine / same numba version).
* The state is PROCESS-GLOBAL (one stream per thread, the kernels are single threaded): it is
  NOT stored per Lattice object.  Constructing a second Lattice (or calling ``seed_numba`` /
  ``Lattice.reseed``) re-seeds the one global stream, and two lattices updated alternately in one
  process draw from the same stream.  Results remain deterministic for a fixed program, but if
  you need "lattice A with seed 1" to be bit-identical in two different programs, run the whole
  sequence for A right after constructing/reseeding A.
* numpy's own ``np.random`` state (outside njit) is completely independent of this stream.
* ``get_rng_state()`` / ``set_rng_state()`` snapshot and restore the stream (check-pointing).

All kernels are plain single-threaded ``numba.njit(cache=True)`` functions operating on plain
arrays (U, up, dn) so that other modules can build their own kernels on top of them.  Note that
numba's on-disk cache of a function in ANOTHER file is not invalidated when this file changes;
delete that file's ``__pycache__/*.nbi/*.nbc`` after editing this module.
"""
from __future__ import annotations

import math

import numpy as np
from numba import njit

__all__ = [
    "Lattice", "seed_numba", "get_rng_state", "set_rng_state",
    # quaternion helpers (njit, tuple based)
    "qget", "qset", "qmul", "qdag", "qmuld", "qdmul", "qdmuld", "qnorm2", "qnormalize",
    # numpy helpers
    "q_to_matrix", "matrix_to_q", "build_neighbours",
    # random SU(2)
    "random_unit3", "haar_su2", "sample_x0", "sample_x0_array", "heatbath_link",
    "heatbath_link_array",
    # kernels
    "staple_sum", "heatbath_sweep_kernel", "overrelax_sweep_kernel", "plaquette_sum_kernel",
    "plaquette_planes_kernel", "line_products", "wilson_loop_plane_kernel",
    "wilson_loop_all_kernel", "polyakov_kernel", "gauge_transform_kernel",
    "reunitarize_kernel", "hot_start_kernel", "haar_field",
    "ALPHA_SWITCH",
]

TWO_PI = 2.0 * math.pi

#: heatbath: for alpha = beta*k below this value Creutz's method is used, above it
#: Kennedy-Pendleton.  (Acceptance: Creutz pi*I1(a)/(2 sinh a), KP sqrt(2 pi a) exp(-a) I1(a);
#: they cross near a = 1.7; Creutz needs fewer random numbers per trial.)
ALPHA_SWITCH = 2.0

#: staple norms below this are treated as zero (link then drawn Haar-random / left unchanged)
K_TINY = 1e-100


# ==============================================================================================
# quaternion helpers.  They accept anything indexable with [0..3] (tuples or 1-d arrays) and
# return 4-tuples of float64, so they never allocate inside numba kernels.
# ==============================================================================================
@njit(cache=True)
def qget(U, s, mu):
    """Load link U[s, mu] as a 4-tuple."""
    return (U[s, mu, 0], U[s, mu, 1], U[s, mu, 2], U[s, mu, 3])


@njit(cache=True)
def qset(U, s, mu, q):
    """Store 4-tuple q into U[s, mu]."""
    U[s, mu, 0] = q[0]
    U[s, mu, 1] = q[1]
    U[s, mu, 2] = q[2]
    U[s, mu, 3] = q[3]


@njit(cache=True)
def qmul(a, b):
    """Product a*b."""
    return (a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
            a[0] * b[1] + a[1] * b[0] - a[2] * b[3] + a[3] * b[2],
            a[0] * b[2] + a[2] * b[0] - a[3] * b[1] + a[1] * b[3],
            a[0] * b[3] + a[3] * b[0] - a[1] * b[2] + a[2] * b[1])


@njit(cache=True)
def qdag(a):
    """Hermitian conjugate a^dagger (= inverse for unit quaternions)."""
    return (a[0], -a[1], -a[2], -a[3])


@njit(cache=True)
def qmuld(a, b):
    """a * b^dagger."""
    return (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3],
            -a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
            -a[0] * b[2] + a[2] * b[0] + a[3] * b[1] - a[1] * b[3],
            -a[0] * b[3] + a[3] * b[0] + a[1] * b[2] - a[2] * b[1])


@njit(cache=True)
def qdmul(a, b):
    """a^dagger * b."""
    return (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3],
            a[0] * b[1] - a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
            a[0] * b[2] - a[2] * b[0] + a[3] * b[1] - a[1] * b[3],
            a[0] * b[3] - a[3] * b[0] + a[1] * b[2] - a[2] * b[1])


@njit(cache=True)
def qdmuld(a, b):
    """a^dagger * b^dagger = (b a)^dagger."""
    return (a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
            -a[0] * b[1] - a[1] * b[0] - a[2] * b[3] + a[3] * b[2],
            -a[0] * b[2] - a[2] * b[0] - a[3] * b[1] + a[1] * b[3],
            -a[0] * b[3] - a[3] * b[0] - a[1] * b[2] + a[2] * b[1])


@njit(cache=True)
def qnorm2(a):
    """Squared norm a0^2 + a1^2 + a2^2 + a3^2 (= det of the 2x2 matrix)."""
    return a[0] * a[0] + a[1] * a[1] + a[2] * a[2] + a[3] * a[3]


@njit(cache=True)
def qnormalize(a):
    """a / |a| (projection of a multiple of an SU(2) matrix back to SU(2))."""
    r = 1.0 / math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2] + a[3] * a[3])
    return (a[0] * r, a[1] * r, a[2] * r, a[3] * r)


# ----------------------------------------------------------------------------------------------
# numpy-level helpers (not jitted)
# ----------------------------------------------------------------------------------------------
def q_to_matrix(q):
    """Convert quaternion(s) q[..., 4] to explicit complex 2x2 matrices [..., 2, 2]:
    U = a0 + i (a1 sigma1 + a2 sigma2 + a3 sigma3) = [[a0 + i a3, a2 + i a1], [-a2 + i a1, a0 - i a3]]."""
    q = np.asarray(q, dtype=np.float64)
    m = np.empty(q.shape[:-1] + (2, 2), dtype=np.complex128)
    m[..., 0, 0] = q[..., 0] + 1j * q[..., 3]
    m[..., 0, 1] = q[..., 2] + 1j * q[..., 1]
    m[..., 1, 0] = -q[..., 2] + 1j * q[..., 1]
    m[..., 1, 1] = q[..., 0] - 1j * q[..., 3]
    return m


def matrix_to_q(m):
    """Inverse of ``q_to_matrix`` (for matrices of the form a0 + i a.sigma with real a)."""
    m = np.asarray(m, dtype=np.complex128)
    q = np.empty(m.shape[:-2] + (4,), dtype=np.float64)
    q[..., 0] = 0.5 * (m[..., 0, 0] + m[..., 1, 1]).real
    q[..., 1] = 0.5 * (m[..., 0, 1] + m[..., 1, 0]).imag
    q[..., 2] = 0.5 * (m[..., 0, 1] - m[..., 1, 0]).real
    q[..., 3] = 0.5 * (m[..., 0, 0] - m[..., 1, 1]).imag
    return q


def build_neighbours(shape):
    """Neighbour tables for a periodic lattice.

    Returns (up, dn), int64 arrays of shape (V, D):  up[s, mu] = index of x + mu,
    dn[s, mu] = index of x - mu, with s the C-order ravel of x.
    """
    shape = tuple(int(n) for n in shape)
    D = len(shape)
    V = int(np.prod(shape))
    coords = np.indices(shape).reshape(D, V)
    up = np.empty((V, D), dtype=np.int64)
    dn = np.empty((V, D), dtype=np.int64)
    for mu in range(D):
        c = coords.copy()
        c[mu] = (coords[mu] + 1) % shape[mu]
        up[:, mu] = np.ravel_multi_index(tuple(c), shape)
        c[mu] = (coords[mu] - 1) % shape[mu]
        dn[:, mu] = np.ravel_multi_index(tuple(c), shape)
    return up, dn


# ==============================================================================================
# random numbers
# ==============================================================================================
@njit(cache=True)
def seed_numba(seed):
    """Seed numba's (process-global, per-thread) Mersenne Twister used by all kernels."""
    np.random.seed(seed)


def get_rng_state():
    """Snapshot of numba's RNG state (main thread): tuple (index, list of 624 ints).

    Uses ``numba._helperlib`` (private but long-stable numba API).  The kernels in this module
    only draw uniform numbers, so there is never a cached Gaussian deviate to worry about.
    """
    from numba import _helperlib
    ptr = _helperlib.rnd_get_np_state_ptr()
    idx, keys = _helperlib.rnd_get_state(ptr)
    return int(idx), [int(k) for k in keys]


def set_rng_state(state):
    """Restore a state obtained from ``get_rng_state``."""
    from numba import _helperlib
    ptr = _helperlib.rnd_get_np_state_ptr()
    _helperlib.rnd_set_state(ptr, (int(state[0]), [int(k) for k in state[1]]))


@njit(cache=True)
def random_unit3():
    """Uniformly distributed unit 3-vector (Marsaglia 1972; no trigonometric functions)."""
    while True:
        v1 = 2.0 * np.random.random() - 1.0
        v2 = 2.0 * np.random.random() - 1.0
        s = v1 * v1 + v2 * v2
        if s < 1.0:
            f = 2.0 * math.sqrt(1.0 - s)
            return (v1 * f, v2 * f, 1.0 - 2.0 * s)


@njit(cache=True)
def haar_su2():
    """Haar-random SU(2) element: x0 with density sqrt(1 - x0^2), isotropic vector part."""
    while True:
        x0 = 2.0 * np.random.random() - 1.0
        r = np.random.random()
        w = 1.0 - x0 * x0
        if r * r <= w:
            rad = math.sqrt(w)
            n = random_unit3()
            return (x0, rad * n[0], rad * n[1], rad * n[2])


@njit(cache=True)
def sample_x0(alpha):
    """Draw x0 in [-1, 1] with density proportional to sqrt(1 - x0^2) * exp(alpha * x0).

    Exact for every alpha >= 0:
    * alpha < ALPHA_SWITCH: Creutz's method.  x is drawn from the density exp(alpha x) on
      [-1, 1] by inversion, x = 1 + log(1 + (1 - r)(e^{-2 alpha} - 1)) / alpha (written with
      expm1/log1p, accurate for arbitrarily small alpha), and accepted with probability
      sqrt(1 - x^2).  alpha -> 0 reduces to the Haar measure (acceptance pi/4).
    * alpha >= ALPHA_SWITCH: Kennedy-Pendleton.  delta = 1 - x0 is drawn from
      sqrt(delta) exp(-alpha delta) on [0, inf) via delta = -(ln r1 + cos^2(2 pi r2) ln r3)/alpha
      and accepted with probability sqrt(1 - delta/2) (acceptance -> 1 for large alpha).
    """
    if alpha < ALPHA_SWITCH:
        if alpha < 1e-300:
            while True:
                x = 2.0 * np.random.random() - 1.0
                r = np.random.random()
                if r * r <= 1.0 - x * x:
                    return x
        em = math.expm1(-2.0 * alpha)
        ia = 1.0 / alpha
        while True:
            x = 1.0 + math.log1p((1.0 - np.random.random()) * em) * ia
            r = np.random.random()
            if r * r <= 1.0 - x * x:
                return x
    else:
        ia = 1.0 / alpha
        while True:
            r1 = 1.0 - np.random.random()          # in (0, 1]
            r3 = 1.0 - np.random.random()
            c = math.cos(TWO_PI * np.random.random())
            delta = -(math.log(r1) + c * c * math.log(r3)) * ia
            r4 = np.random.random()
            if r4 * r4 <= 1.0 - 0.5 * delta:
                return 1.0 - delta


@njit(cache=True)
def sample_x0_array(alpha, n):
    """n independent draws of ``sample_x0(alpha)`` (for tests)."""
    out = np.empty(n, dtype=np.float64)
    for i in range(n):
        out[i] = sample_x0(alpha)
    return out


@njit(cache=True)
def heatbath_link(beta, A):
    """New link U distributed as exp((beta/2) Tr(U A)) dU (Haar dU) for the staple sum A.

    A = k*V with k = sqrt(det A) = |A| and V in SU(2);  X = U V has density
    sqrt(1 - x0^2) exp(beta k x0) with isotropic vector part;  U = X V^dagger.
    For k -> 0 the link is Haar random.  A: 4-tuple or array; returns a 4-tuple.
    """
    k = math.sqrt(A[0] * A[0] + A[1] * A[1] + A[2] * A[2] + A[3] * A[3])
    if k < K_TINY:
        return haar_su2()
    x0 = sample_x0(beta * k)
    w = 1.0 - x0 * x0
    rad = math.sqrt(w) if w > 0.0 else 0.0
    n = random_unit3()
    ik = 1.0 / k
    return qmul((x0, rad * n[0], rad * n[1], rad * n[2]),
                (A[0] * ik, -A[1] * ik, -A[2] * ik, -A[3] * ik))


@njit(cache=True)
def heatbath_link_array(beta, A, n):
    """n independent draws of ``heatbath_link(beta, A)``, shape (n, 4) (for tests)."""
    out = np.empty((n, 4), dtype=np.float64)
    a = (A[0], A[1], A[2], A[3])
    for i in range(n):
        q = heatbath_link(beta, a)
        out[i, 0] = q[0]
        out[i, 1] = q[1]
        out[i, 2] = q[2]
        out[i, 3] = q[3]
    return out


@njit(cache=True)
def haar_field(n):
    """n Haar-random SU(2) elements, shape (n, 4)."""
    out = np.empty((n, 4), dtype=np.float64)
    for i in range(n):
        q = haar_su2()
        out[i, 0] = q[0]
        out[i, 1] = q[1]
        out[i, 2] = q[2]
        out[i, 3] = q[3]
    return out


# ==============================================================================================
# kernels
# ==============================================================================================
@njit(cache=True)
def staple_sum(U, up, dn, s, mu):
    """Staple sum A for link U_mu(x) (x = site s) as a 4-tuple (NOT normalised):

    A = sum_{nu != mu} [ U_nu(x+mu) U_mu^dagger(x+nu) U_nu^dagger(x)
                         + U_nu^dagger(x+mu-nu) U_mu^dagger(x-nu) U_nu(x-nu) ],

    so that the part of the action depending on U_mu(x) is -(beta/2) Tr(U_mu(x) A).
    """
    D = up.shape[1]
    a0 = 0.0
    a1 = 0.0
    a2 = 0.0
    a3 = 0.0
    xpm = up[s, mu]
    for nu in range(D):
        if nu != mu:
            xpn = up[s, nu]
            xmn = dn[s, nu]
            xpmmn = dn[xpm, nu]
            f = qmuld(qmuld(qget(U, xpm, nu), qget(U, xpn, mu)), qget(U, s, nu))
            b = qmul(qdmuld(qget(U, xpmmn, nu), qget(U, xmn, mu)), qget(U, xmn, nu))
            a0 += f[0] + b[0]
            a1 += f[1] + b[1]
            a2 += f[2] + b[2]
            a3 += f[3] + b[3]
    return (a0, a1, a2, a3)


@njit(cache=True)
def heatbath_sweep_kernel(U, up, dn, beta, nsweep):
    """nsweep sequential heatbath sweeps (sites in index order, mu = 0..D-1 at each site)."""
    V = U.shape[0]
    D = U.shape[1]
    for _ in range(nsweep):
        for s in range(V):
            for mu in range(D):
                q = heatbath_link(beta, staple_sum(U, up, dn, s, mu))
                U[s, mu, 0] = q[0]
                U[s, mu, 1] = q[1]
                U[s, mu, 2] = q[2]
                U[s, mu, 3] = q[3]


@njit(cache=True)
def overrelax_sweep_kernel(U, up, dn, nsweep):
    """nsweep sequential microcanonical overrelaxation sweeps.

    U -> V^dagger U^dagger V^dagger with V = A/|A|; for SU(2) this equals
    U' = 2 (U A)_0 A^dagger / |A|^2 - U, which leaves Tr(U A), hence the action, unchanged.
    The new link is renormalised (rounding only) so that repeated sweeps cannot drift off SU(2).
    """
    V = U.shape[0]
    D = U.shape[1]
    for _ in range(nsweep):
        for s in range(V):
            for mu in range(D):
                A = staple_sum(U, up, dn, s, mu)
                k2 = A[0] * A[0] + A[1] * A[1] + A[2] * A[2] + A[3] * A[3]
                if k2 > K_TINY * K_TINY:
                    u0 = U[s, mu, 0]
                    u1 = U[s, mu, 1]
                    u2 = U[s, mu, 2]
                    u3 = U[s, mu, 3]
                    c = 2.0 * (u0 * A[0] - u1 * A[1] - u2 * A[2] - u3 * A[3]) / k2
                    n0 = c * A[0] - u0
                    n1 = -c * A[1] - u1
                    n2 = -c * A[2] - u2
                    n3 = -c * A[3] - u3
                    r = 1.0 / math.sqrt(n0 * n0 + n1 * n1 + n2 * n2 + n3 * n3)
                    U[s, mu, 0] = n0 * r
                    U[s, mu, 1] = n1 * r
                    U[s, mu, 2] = n2 * r
                    U[s, mu, 3] = n3 * r


@njit(cache=True)
def plaquette_planes_kernel(U, up, out):
    """out[ip] = sum over sites of (1/2) Tr U_{mu nu}(x) for the planes ip = (0,1), (0,2), ...,
    (D-2, D-1) (mu < nu, lexicographic).  out must have length D(D-1)/2."""
    V = U.shape[0]
    D = U.shape[1]
    for ip in range(out.shape[0]):
        out[ip] = 0.0
    for s in range(V):
        ip = 0
        for mu in range(D - 1):
            xpm = up[s, mu]
            a = qget(U, s, mu)
            for nu in range(mu + 1, D):
                t = qmul(a, qget(U, xpm, nu))                      # U_mu(x) U_nu(x+mu)
                w = qmul(qget(U, s, nu), qget(U, up[s, nu], mu))   # U_nu(x) U_mu(x+nu)
                out[ip] += t[0] * w[0] + t[1] * w[1] + t[2] * w[2] + t[3] * w[3]
                ip += 1


@njit(cache=True)
def plaquette_sum_kernel(U, up):
    """Sum over all plaquettes of (1/2) Tr U_p."""
    V = U.shape[0]
    D = U.shape[1]
    tot = 0.0
    for s in range(V):
        acc = 0.0
        for mu in range(D - 1):
            xpm = up[s, mu]
            a = qget(U, s, mu)
            for nu in range(mu + 1, D):
                t = qmul(a, qget(U, xpm, nu))
                w = qmul(qget(U, s, nu), qget(U, up[s, nu], mu))
                acc += t[0] * w[0] + t[1] * w[1] + t[2] * w[2] + t[3] * w[3]
        tot += acc
    return tot


@njit(cache=True)
def line_products(U, up, mu, n, line, end):
    """Straight lines of n links in direction mu starting at every site:

    line[s] = U_mu(x) U_mu(x+mu) ... U_mu(x+(n-1)mu)   (shape (V, 4)),
    end[s]  = site index of x + n*mu                   (shape (V,), int64).
    """
    V = U.shape[0]
    for s in range(V):
        q = qget(U, s, mu)
        x = up[s, mu]
        for _ in range(1, n):
            q = qmul(q, qget(U, x, mu))
            x = up[x, mu]
        line[s, 0] = q[0]
        line[s, 1] = q[1]
        line[s, 2] = q[2]
        line[s, 3] = q[3]
        end[s] = x


@njit(cache=True)
def _loop_sum(lr, er, lt, et):
    """sum_x (1/2) Tr[ LR(x) LT(x + R mu) LR(x + T nu)^dagger LT(x)^dagger ]."""
    V = lr.shape[0]
    tot = 0.0
    for s in range(V):
        a = qmul((lr[s, 0], lr[s, 1], lr[s, 2], lr[s, 3]),
                 (lt[er[s], 0], lt[er[s], 1], lt[er[s], 2], lt[er[s], 3]))
        b = qmul((lt[s, 0], lt[s, 1], lt[s, 2], lt[s, 3]),
                 (lr[et[s], 0], lr[et[s], 1], lr[et[s], 2], lr[et[s], 3]))
        tot += a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
    return tot


@njit(cache=True)
def wilson_loop_plane_kernel(U, up, R, T, mu, nu):
    """Mean over all sites of (1/2) Tr W for the R x T rectangle with R links along mu and
    T links along nu (mu != nu)."""
    V = U.shape[0]
    lr = np.empty((V, 4), dtype=np.float64)
    lt = np.empty((V, 4), dtype=np.float64)
    er = np.empty(V, dtype=np.int64)
    et = np.empty(V, dtype=np.int64)
    line_products(U, up, mu, R, lr, er)
    line_products(U, up, nu, T, lt, et)
    return _loop_sum(lr, er, lt, et) / V


@njit(cache=True)
def wilson_loop_all_kernel(U, up, R, T):
    """Mean of (1/2) Tr W(R, T) over all sites, all planes and both orientations
    (R along mu & T along nu for every ordered pair mu != nu)."""
    V = U.shape[0]
    D = U.shape[1]
    lr = np.empty((D, V, 4), dtype=np.float64)
    er = np.empty((D, V), dtype=np.int64)
    for mu in range(D):
        line_products(U, up, mu, R, lr[mu], er[mu])
    if R == T:
        lt = lr
        et = er
    else:
        lt = np.empty((D, V, 4), dtype=np.float64)
        et = np.empty((D, V), dtype=np.int64)
        for mu in range(D):
            line_products(U, up, mu, T, lt[mu], et[mu])
    tot = 0.0
    for mu in range(D):
        for nu in range(D):
            if mu != nu:
                tot += _loop_sum(lr[mu], er[mu], lt[nu], et[nu])
    return tot / (V * D * (D - 1))


@njit(cache=True)
def polyakov_kernel(U, up, mu, L, base, out):
    """out[i] = (1/2) Tr of the product of the L links in direction mu starting at site base[i]."""
    for i in range(base.shape[0]):
        s = base[i]
        q = qget(U, s, mu)
        x = up[s, mu]
        for _ in range(1, L):
            q = qmul(q, qget(U, x, mu))
            x = up[x, mu]
        out[i] = q[0]


@njit(cache=True)
def gauge_transform_kernel(U, up, G):
    """In place: U_mu(x) -> G(x) U_mu(x) G^dagger(x + mu), G of shape (V, 4)."""
    V = U.shape[0]
    D = U.shape[1]
    for s in range(V):
        g = (G[s, 0], G[s, 1], G[s, 2], G[s, 3])
        for mu in range(D):
            y = up[s, mu]
            q = qmuld(qmul(g, qget(U, s, mu)), (G[y, 0], G[y, 1], G[y, 2], G[y, 3]))
            U[s, mu, 0] = q[0]
            U[s, mu, 1] = q[1]
            U[s, mu, 2] = q[2]
            U[s, mu, 3] = q[3]


@njit(cache=True)
def reunitarize_kernel(U):
    """In place: project every link back onto unit norm."""
    V = U.shape[0]
    D = U.shape[1]
    for s in range(V):
        for mu in range(D):
            r = 1.0 / math.sqrt(U[s, mu, 0] ** 2 + U[s, mu, 1] ** 2
                                + U[s, mu, 2] ** 2 + U[s, mu, 3] ** 2)
            U[s, mu, 0] *= r
            U[s, mu, 1] *= r
            U[s, mu, 2] *= r
            U[s, mu, 3] *= r


@njit(cache=True)
def hot_start_kernel(U):
    """In place: every link Haar random (same order as the sweeps: s outer, mu inner)."""
    V = U.shape[0]
    D = U.shape[1]
    for s in range(V):
        for mu in range(D):
            q = haar_su2()
            U[s, mu, 0] = q[0]
            U[s, mu, 1] = q[1]
            U[s, mu, 2] = q[2]
            U[s, mu, 3] = q[3]


# ==============================================================================================
# user-facing class
# ==============================================================================================
class Lattice:
    """SU(2) gauge field on a periodic hypercubic lattice in D = 2, 3 or 4 dimensions.

    Parameters
    ----------
    shape : sequence of D even ints >= 2, (L0, ..., L_{D-1}); axis 0 is Euclidean time.
    beta  : Wilson coupling (beta = 4/g^2 in D = 4), a finite number >= 0.  May be changed
            later (``lat.beta = ...``); a negative, infinite or NaN value raises ValueError
            (the heatbath sampler is only defined for beta >= 0: it would silently sample
            beta = 0 for a negative coupling and never terminate for NaN).
    seed  : int in [0, 2^32); seeds numba's global RNG stream (see module docstring).

    Attributes
    ----------
    shape, D, V (number of sites), beta, seed,
    U  : float64 array (V, D, 4), U[s, mu] = link from site s in direction mu (quaternion),
    up, dn : int64 arrays (V, D), neighbour tables,
    planes : list of (mu, nu) with mu < nu in the order used by ``plaquette_planes``,
    n_plaq : number of plaquettes V * D (D - 1) / 2.

    The lattice starts cold (all links = identity).
    """

    def __init__(self, shape, beta, seed=0):
        shape = tuple(int(n) for n in shape)
        if len(shape) not in (2, 3, 4):
            raise ValueError("D must be 2, 3 or 4, got shape %r" % (shape,))
        if any(n < 2 or n % 2 for n in shape):
            raise ValueError("every lattice extent must be even and >= 2, got %r" % (shape,))
        self.shape = shape
        self.D = len(shape)
        self.V = int(np.prod(shape))
        self.beta = float(beta)
        self.up, self.dn = build_neighbours(shape)
        self.planes = [(mu, nu) for mu in range(self.D) for nu in range(mu + 1, self.D)]
        self.n_plaq = self.V * len(self.planes)
        self.U = np.empty((self.V, self.D, 4), dtype=np.float64)
        self.cold_start()
        self.seed = None
        self.reseed(seed)

    # ------------------------------------------------------------------ bookkeeping
    @property
    def beta(self):
        """Wilson coupling (float, finite, >= 0)."""
        return self._beta

    @beta.setter
    def beta(self, value):
        value = float(value)
        if not math.isfinite(value) or value < 0.0:
            raise ValueError("beta must be a finite number >= 0, got %r" % (value,))
        self._beta = value

    def reseed(self, seed):
        """(Re-)seed numba's global RNG stream; 0 <= seed < 2^32."""
        seed = int(seed)
        if not 0 <= seed < 2 ** 32:
            raise ValueError("seed must satisfy 0 <= seed < 2**32")
        self.seed = seed
        seed_numba(seed)

    def copy(self):
        """Independent copy of the field (shares nothing; does NOT touch the RNG)."""
        new = object.__new__(Lattice)
        new.shape = self.shape
        new.D = self.D
        new.V = self.V
        new.beta = self.beta
        new.up = self.up.copy()
        new.dn = self.dn.copy()
        new.planes = list(self.planes)
        new.n_plaq = self.n_plaq
        new.U = self.U.copy()
        new.seed = self.seed
        return new

    def site_index(self, coords):
        """Site index of integer coordinates (taken modulo the lattice extents)."""
        c = tuple(int(x) % n for x, n in zip(coords, self.shape))
        return int(np.ravel_multi_index(c, self.shape))

    def site_coords(self, s):
        """Coordinates (tuple) of site index s."""
        return tuple(int(x) for x in np.unravel_index(int(s), self.shape))

    # ------------------------------------------------------------------ starts
    def cold_start(self):
        """All links = identity (plaquette exactly 1)."""
        self.U[...] = 0.0
        self.U[..., 0] = 1.0

    def hot_start(self):
        """All links Haar random (infinite-temperature / beta = 0 configuration)."""
        hot_start_kernel(self.U)

    # ------------------------------------------------------------------ updates
    def heatbath_sweep(self, n=1):
        """n sequential sweeps of the exact SU(2) heatbath over all V*D links."""
        heatbath_sweep_kernel(self.U, self.up, self.dn, self.beta, int(n))

    def overrelax_sweep(self, n=1):
        """n sequential microcanonical overrelaxation sweeps (action preserving, not ergodic
        on their own: always combine with heatbath sweeps)."""
        overrelax_sweep_kernel(self.U, self.up, self.dn, int(n))

    def update(self, n_hb=1, n_or=0):
        """One compound update: n_hb heatbath sweeps followed by n_or overrelaxation sweeps."""
        if n_hb > 0:
            heatbath_sweep_kernel(self.U, self.up, self.dn, self.beta, int(n_hb))
        if n_or > 0:
            overrelax_sweep_kernel(self.U, self.up, self.dn, int(n_or))

    def reunitarize(self):
        """Project all links back to unit norm (removes accumulated rounding)."""
        reunitarize_kernel(self.U)

    def unitarity_violation(self):
        """max over links of | |U|^2 - 1 |."""
        return float(np.max(np.abs(np.sum(self.U * self.U, axis=-1) - 1.0)))

    # ------------------------------------------------------------------ observables
    def plaquette(self):
        """Mean of (1/2) Tr U_p over all plaquettes."""
        return plaquette_sum_kernel(self.U, self.up) / self.n_plaq

    def plaquette_planes(self):
        """Mean of (1/2) Tr U_p per plane; array of length D(D-1)/2 ordered as ``self.planes``."""
        out = np.empty(len(self.planes), dtype=np.float64)
        plaquette_planes_kernel(self.U, self.up, out)
        return out / self.V

    def action(self):
        """Wilson action S = beta * sum_p (1 - (1/2) Tr U_p)."""
        return self.beta * (self.n_plaq - plaquette_sum_kernel(self.U, self.up))

    def wilson_loop(self, R, T, mu=None, nu=None):
        """Mean of (1/2) Tr of the R x T rectangular Wilson loop over all positions.

        With mu and nu given: R links along mu, T links along nu.  With mu = nu = None:
        average over all planes and both orientations (R along mu, T along nu and vice versa).
        Loops are built from straight lines with periodic wrap-around; R, T >= 1.
        """
        R = int(R)
        T = int(T)
        if R < 1 or T < 1:
            raise ValueError("R and T must be >= 1")
        if mu is None and nu is None:
            return wilson_loop_all_kernel(self.U, self.up, R, T)
        if mu is None or nu is None:
            raise ValueError("give both mu and nu, or neither")
        mu = int(mu)
        nu = int(nu)
        if mu == nu or not (0 <= mu < self.D and 0 <= nu < self.D):
            raise ValueError("need 0 <= mu != nu < D")
        return wilson_loop_plane_kernel(self.U, self.up, R, T, mu, nu)

    def polyakov_loops(self, mu):
        """(1/2) Tr of the straight loop winding direction mu, one value per site of the
        transverse lattice.  Returned array has the lattice shape with axis mu removed
        (C order), e.g. for shape (T, L) and mu = 1: shape (T,), one loop per time slice."""
        mu = int(mu)
        if not 0 <= mu < self.D:
            raise ValueError("need 0 <= mu < D")
        idx = [slice(None)] * self.D
        idx[mu] = 0
        base = np.ascontiguousarray(
            np.arange(self.V, dtype=np.int64).reshape(self.shape)[tuple(idx)].ravel())
        out = np.empty(base.shape[0], dtype=np.float64)
        polyakov_kernel(self.U, self.up, mu, self.shape[mu], base, out)
        return out.reshape(self.shape[:mu] + self.shape[mu + 1:])

    def staple(self, s, mu):
        """Staple sum A (array of 4 floats, not normalised) for link (s, mu); the action
        depends on that link only through -(beta/2) Tr(U A) = -beta * (U A)_0."""
        return np.array(staple_sum(self.U, self.up, self.dn, int(s), int(mu)), dtype=np.float64)

    # ------------------------------------------------------------------ gauge transformations
    def gauge_transform(self, G):
        """Apply U_mu(x) -> G(x) U_mu(x) G^dagger(x + mu); G has shape (V, 4) (unit quaternions)."""
        G = np.ascontiguousarray(G, dtype=np.float64)
        if G.shape != (self.V, 4):
            raise ValueError("G must have shape (V, 4)")
        gauge_transform_kernel(self.U, self.up, G)

    def random_gauge(self):
        """Apply a Haar-random gauge transformation (drawn from the numba RNG stream) and
        return the G (V, 4) that was used."""
        G = haar_field(self.V)
        gauge_transform_kernel(self.U, self.up, G)
        return G

    def __repr__(self):
        return "Lattice(shape=%r, beta=%r, seed=%r)" % (self.shape, self.beta, self.seed)
