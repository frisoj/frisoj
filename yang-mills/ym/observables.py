"""Mass-gap observables on top of the engine (ym/lattice.py): smeared glueball and torelon
operators per Euclidean time slice.

Everything here is a MEASUREMENT: nothing in this module ever writes to the gauge field it is
given (all smearing happens in private work buffers) and nothing draws random numbers.

Conventions (see ym/lattice.py): axis 0 is Euclidean time, "spatial" means axes 1 .. D-1,
links are unit quaternions U[s, mu, :], site index s = C-order ravel, so the time coordinate of
site s is  t = s // Vs  with Vs = V / L0 the number of sites in a time slice.

APE smearing (spatial links only, spatial staples only)
-------------------------------------------------------
One smearing step replaces every spatial link by

    U'_i(x) = normalize( U_i(x) + w * sum_{j != i, j spatial}
                  [ U_j(x) U_i(x+j) U_j^dagger(x+i)  +  U_j^dagger(x-j) U_i(x-j) U_j(x-j+i) ] )

(all links on the right-hand side are the OLD links: the step is applied to the whole field
simultaneously).  A sum of SU(2) matrices is a real multiple of an SU(2) matrix, so
"normalize" (division by the quaternion norm) is the exact projection back to the group.
Time-like links are never touched, so a correlator of operators built from smeared links on
different time slices keeps its transfer-matrix (positive spectral) representation.
Each staple transforms like U_i(x) under gauge transformations, hence smearing commutes with
gauge transformations and every trace of a closed loop of smeared links is gauge invariant.
"Level k" means k smearing steps (level 0 = the original links).
In D = 2 there is no second spatial direction, so there are no spatial staples and smearing
is the identity (implemented as an exact no-op).

Choice of the weight w.  For weak fields one step is lattice diffusion of the link field with
diffusion constant  alpha = w / (1 + 2 (D-2) w)  (D-2 = number of staple directions): in D = 3
the plaquette angle F(x) of a time slice evolves EXACTLY as F' = F + alpha * Laplacian(F)
(tested in tests/test_observables.py), i.e. the Fourier mode k is multiplied by
1 - alpha * khat^2, khat^2 = sum_i (2 - 2 cos k_i) <= 4 (D-1).  All modes are damped only if
alpha < 1 / (2 (D-1)), which in D = 3 AND in D = 4 is the same condition  w < 1/2.  At w = 1/2
the maximally staggered mode (k = (pi, ..., pi)) is NOT damped at all (it only changes sign),
so plaquettes of smeared links stay rough however many steps are applied; loops with even side
lengths and the torelon lines are blind to that mode and are not affected.  Use w < 1/2
(e.g. w = 0.25); the smearing radius grows like r^2 ~ 4 alpha n (n = number of steps).

Operators (all are plain sums, not averages)
--------------------------------------------
* glueball, scalar channel, zero momentum.  For smearing level index k and loop shape (R, S):

      glue[k, l, t] = sum_{x in time slice t} sum_{spatial planes i<j} (1/2) Tr W^{(k)}_{RxS; ij}(x)

  where W is the rectangular loop with R links along i and S links along j built from the
  level-k links.  For R != S both orientations (R along i, S along j) and (S along i, R along j)
  are summed, which is the rotation-symmetric (A1) combination.  The default shapes are the
  1x1 plaquette and the 2x2 loop.  In D = 2 there are no spatial planes: the array is all zeros.
* torelon (flux loop winding a spatial circle), zero transverse momentum.  For the spatial
  direction i = 1 .. D-1 (stored at index i-1) and level index k:

      torelon[i-1, k, t] = sum_{x_perp} (1/2) Tr prod_{n=0}^{L_i - 1} U^{(k)}_i(t, x_perp, x_i = n)

  (x_perp = the D-2 spatial coordinates transverse to i; one line per x_perp).
* plaquettes of the ORIGINAL (unsmeared) field: the average plaquette, the average spatial
  (planes i<j, both spatial) and temporal (planes 0i) plaquette, and the per-time-slice sums

      plaq_t_slices[t] = sum_{x in slice t} sum_i   (1/2) Tr U_{0i}(x)     (links between t and t+1)
      plaq_s_slices[t] = sum_{x in slice t} sum_{i<j} (1/2) Tr U_{ij}(x)

  (in D = 2 there are no spatial plaquettes: plaq_s is NaN and plaq_s_slices is zero).

None of this is, or is claimed to be, a proof of anything about continuum Yang-Mills theory.
"""
from __future__ import annotations

import numpy as np
from numba import njit

from .lattice import line_products, qdmul, qget, qmul, qmuld

__all__ = [
    "DEFAULT_LOOPS", "Measurer", "measure", "smear_spatial",
    "ape_step_kernel", "loop_slices_kernel", "polyakov_slices_kernel",
    "plaquette_slices_kernel", "glue_label", "torelon_label",
]

#: default glueball loop shapes (R, S): the 1x1 spatial plaquette and the 2x2 spatial loop
DEFAULT_LOOPS = ((1, 1), (2, 2))

#: links whose smeared, un-normalised norm^2 is below this are left unsmeared (never happens
#: in practice: it would need the staples to cancel the link exactly)
_NORM2_TINY = 1e-200


# ==============================================================================================
# kernels
# ==============================================================================================
@njit(cache=True)
def ape_step_kernel(Uin, Uout, up, dn, w):
    """One APE smearing step of the spatial links (spatial staples only); Uin is not modified.

    Uout[s, i] = normalize(Uin[s, i] + w * (sum of the 2 (D-2) spatial staples)) for i >= 1,
    Uout[s, 0] = Uin[s, 0] (time links copied bit for bit).  Uin and Uout must not overlap.
    """
    V = Uin.shape[0]
    D = Uin.shape[1]
    for s in range(V):
        Uout[s, 0, 0] = Uin[s, 0, 0]
        Uout[s, 0, 1] = Uin[s, 0, 1]
        Uout[s, 0, 2] = Uin[s, 0, 2]
        Uout[s, 0, 3] = Uin[s, 0, 3]
        for mu in range(1, D):
            xpm = up[s, mu]
            a0 = 0.0
            a1 = 0.0
            a2 = 0.0
            a3 = 0.0
            for nu in range(1, D):
                if nu != mu:
                    xpn = up[s, nu]
                    xmn = dn[s, nu]
                    xmnpm = up[xmn, mu]
                    # forward staple  U_nu(x) U_mu(x+nu) U_nu^dagger(x+mu)
                    f = qmuld(qmul(qget(Uin, s, nu), qget(Uin, xpn, mu)), qget(Uin, xpm, nu))
                    # backward staple U_nu^dagger(x-nu) U_mu(x-nu) U_nu(x-nu+mu)
                    b = qmul(qdmul(qget(Uin, xmn, nu), qget(Uin, xmn, mu)),
                             qget(Uin, xmnpm, nu))
                    a0 += f[0] + b[0]
                    a1 += f[1] + b[1]
                    a2 += f[2] + b[2]
                    a3 += f[3] + b[3]
            n0 = Uin[s, mu, 0] + w * a0
            n1 = Uin[s, mu, 1] + w * a1
            n2 = Uin[s, mu, 2] + w * a2
            n3 = Uin[s, mu, 3] + w * a3
            r2 = n0 * n0 + n1 * n1 + n2 * n2 + n3 * n3
            if r2 > _NORM2_TINY:
                r = 1.0 / np.sqrt(r2)
                Uout[s, mu, 0] = n0 * r
                Uout[s, mu, 1] = n1 * r
                Uout[s, mu, 2] = n2 * r
                Uout[s, mu, 3] = n3 * r
            else:
                Uout[s, mu, 0] = Uin[s, mu, 0]
                Uout[s, mu, 1] = Uin[s, mu, 1]
                Uout[s, mu, 2] = Uin[s, mu, 2]
                Uout[s, mu, 3] = Uin[s, mu, 3]


@njit(cache=True)
def loop_slices_kernel(U, up, R, S, mu, nu, Vs, lr, er, ls, es, out):
    """out[t] += sum_{x in time slice t} (1/2) Tr of the R x S loop (R links along mu, S links
    along nu, both spatial).  lr, ls: (V, 4) work arrays; er, es: (V,) int64 work arrays."""
    V = U.shape[0]
    line_products(U, up, mu, R, lr, er)
    line_products(U, up, nu, S, ls, es)
    for s in range(V):
        # W = LR(x) LS(x + R mu) [LS(x) LR(x + S nu)]^dagger ;  (1/2) Tr (a b^dagger) = a . b
        a = qmul((lr[s, 0], lr[s, 1], lr[s, 2], lr[s, 3]),
                 (ls[er[s], 0], ls[er[s], 1], ls[er[s], 2], ls[er[s], 3]))
        b = qmul((ls[s, 0], ls[s, 1], ls[s, 2], ls[s, 3]),
                 (lr[es[s], 0], lr[es[s], 1], lr[es[s], 2], lr[es[s], 3]))
        out[s // Vs] += a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]


@njit(cache=True)
def glue_ops_kernel(U, up, Vs, loops, out, lr, er, ls, es):
    """out[l, t] = sum over the sites of time slice t and over all spatial planes of (1/2) Tr of
    the loop of shape loops[l] = (R, S) (both orientations if R != S).  out is overwritten."""
    D = U.shape[1]
    for l in range(loops.shape[0]):
        for t in range(out.shape[1]):
            out[l, t] = 0.0
        R = loops[l, 0]
        S = loops[l, 1]
        for mu in range(1, D - 1):
            for nu in range(mu + 1, D):
                loop_slices_kernel(U, up, R, S, mu, nu, Vs, lr, er, ls, es, out[l])
                if R != S:
                    loop_slices_kernel(U, up, S, R, mu, nu, Vs, lr, er, ls, es, out[l])


@njit(cache=True)
def polyakov_slices_kernel(U, up, mu, L, base, Vs, out):
    """out[t] = sum over the base sites lying in time slice t of (1/2) Tr of the product of the
    L links in direction mu starting at the base site.  out is overwritten."""
    for t in range(out.shape[0]):
        out[t] = 0.0
    for i in range(base.shape[0]):
        s = base[i]
        q = qget(U, s, mu)
        x = up[s, mu]
        for _ in range(1, L):
            q = qmul(q, qget(U, x, mu))
            x = up[x, mu]
        out[s // Vs] += q[0]


@njit(cache=True)
def plaquette_slices_kernel(U, up, Vs, out_t, out_s):
    """Per-time-slice plaquette sums of the field U (both outputs are overwritten):

    out_t[t] = sum_{x in slice t} sum_{i>=1}    (1/2) Tr U_{0i}(x)   (temporal plaquettes),
    out_s[t] = sum_{x in slice t} sum_{1<=i<j} (1/2) Tr U_{ij}(x)   (spatial plaquettes).
    """
    V = U.shape[0]
    D = U.shape[1]
    for t in range(out_t.shape[0]):
        out_t[t] = 0.0
        out_s[t] = 0.0
    for s in range(V):
        t = s // Vs
        for mu in range(D - 1):
            xpm = up[s, mu]
            a = qget(U, s, mu)
            for nu in range(mu + 1, D):
                p = qmul(a, qget(U, xpm, nu))                      # U_mu(x) U_nu(x+mu)
                q = qmul(qget(U, s, nu), qget(U, up[s, nu], mu))   # U_nu(x) U_mu(x+nu)
                tr = p[0] * q[0] + p[1] * q[1] + p[2] * q[2] + p[3] * q[3]
                if mu == 0:
                    out_t[t] += tr
                else:
                    out_s[t] += tr


# ==============================================================================================
# python layer
# ==============================================================================================
def _check_levels(levels):
    lev = [int(x) for x in levels]
    if len(lev) == 0:
        raise ValueError("at least one smearing level is required")
    if any(a != b for a, b in zip(lev, levels)):
        raise ValueError("smearing levels must be integers, got %r" % (levels,))
    if lev[0] < 0 or any(b <= a for a, b in zip(lev[:-1], lev[1:])):
        raise ValueError("smearing levels must be non-negative and strictly increasing, got %r"
                         % (levels,))
    return tuple(lev)


def _check_loops(loops, shape):
    out = []
    for item in loops:
        R, S = (int(item[0]), int(item[1]))
        if R < 1 or S < 1:
            raise ValueError("loop sizes must be >= 1, got %r" % (item,))
        out.append((R, S))
    if len(out) == 0:
        raise ValueError("at least one loop shape is required")
    if len(shape) >= 3:
        lmin = min(shape[1:])
        if max(max(rs) for rs in out) >= lmin:
            raise ValueError("loop shapes %r do not fit into the spatial extents %r"
                             % (out, shape[1:]))
    return tuple(out)


def glue_label(level, loop):
    """Human-readable label of a glueball operator, e.g. 's8_2x2'."""
    return "s%d_%dx%d" % (int(level), int(loop[0]), int(loop[1]))


def torelon_label(level):
    """Human-readable label of a torelon operator, e.g. 's8'."""
    return "s%d" % int(level)


def smear_spatial(lattice, w, n):
    """Return a NEW array (V, D, 4): the links of ``lattice`` after n APE smearing steps of
    weight w applied to the spatial links (time links are copied unchanged).  ``lattice.U`` is
    not modified.  n = 0 or D = 2 returns an exact copy."""
    n = int(n)
    if n < 0:
        raise ValueError("n must be >= 0")
    cur = lattice.U.copy()
    if lattice.D == 2 or n == 0:
        return cur
    other = np.empty_like(cur)
    for _ in range(n):
        ape_step_kernel(cur, other, lattice.up, lattice.dn, float(w))
        cur, other = other, cur
    return cur


class Measurer:
    """Reusable measurement object for one lattice geometry and one operator set.

    Parameters
    ----------
    shape  : lattice shape (L0 = time extent first).
    levels : strictly increasing non-negative ints, numbers of APE smearing steps.
    w      : APE smearing weight (see module docstring).
    loops  : glueball loop shapes, sequence of (R, S); default ((1, 1), (2, 2)).

    ``Measurer(...)(lattice)`` (or ``.measure_arrays(U, up, dn)``) returns a dict with

        'glue'          float64 (n_levels, n_loops, T)   glueball operators per time slice
        'torelon'       float64 (D-1, n_levels, T)       torelon operators; index 0 <-> direction 1
        'plaq'          float   average plaquette of the unsmeared field
        'plaq_s'        float   average spatial plaquette (NaN in D = 2)
        'plaq_t'        float   average temporal plaquette
        'plaq_t_slices' float64 (T,)  per-slice sums of temporal plaquettes (unsmeared)
        'plaq_s_slices' float64 (T,)  per-slice sums of spatial plaquettes (unsmeared)

    Fresh arrays are returned on every call.  The gauge field is never modified.
    """

    def __init__(self, shape, levels, w, loops=DEFAULT_LOOPS):
        shape = tuple(int(n) for n in shape)
        if len(shape) not in (2, 3, 4):
            raise ValueError("D must be 2, 3 or 4")
        self.shape = shape
        self.D = len(shape)
        self.T = shape[0]
        self.V = int(np.prod(shape))
        self.Vs = self.V // self.T
        self.levels = _check_levels(levels)
        self.w = float(w)
        self.loops = _check_loops(loops, shape)
        self._loops_arr = np.array(self.loops, dtype=np.int64).reshape(len(self.loops), 2)
        self.n_levels = len(self.levels)
        self.n_loops = len(self.loops)
        self.n_dirs = self.D - 1
        self.n_planes_s = (self.D - 1) * (self.D - 2) // 2
        # base sites (coordinate mu = 0) for the Polyakov lines in every spatial direction
        idx = np.arange(self.V, dtype=np.int64).reshape(shape)
        self._bases = []
        for mu in range(1, self.D):
            sl = [slice(None)] * self.D
            sl[mu] = 0
            self._bases.append(np.ascontiguousarray(idx[tuple(sl)].ravel()))
        # work space
        self._buf = [np.empty((self.V, self.D, 4), dtype=np.float64) for _ in range(2)] \
            if self.D > 2 else []
        self._lr = np.empty((self.V, 4), dtype=np.float64)
        self._ls = np.empty((self.V, 4), dtype=np.float64)
        self._er = np.empty(self.V, dtype=np.int64)
        self._es = np.empty(self.V, dtype=np.int64)

    # labels -----------------------------------------------------------------------------
    def glue_labels(self):
        """Labels of the flattened glueball operators, op = k * n_loops + l."""
        return [glue_label(lev, lp) for lev in self.levels for lp in self.loops]

    def torelon_labels(self):
        return [torelon_label(lev) for lev in self.levels]

    # measurement ------------------------------------------------------------------------
    def measure_arrays(self, U, up, dn):
        if U.shape != (self.V, self.D, 4):
            raise ValueError("field shape %r does not match the lattice shape %r"
                             % (U.shape, self.shape))
        T = self.T
        D = self.D
        glue = np.zeros((self.n_levels, self.n_loops, T), dtype=np.float64)
        tor = np.zeros((self.n_dirs, self.n_levels, T), dtype=np.float64)
        pt = np.empty(T, dtype=np.float64)
        ps = np.empty(T, dtype=np.float64)
        plaquette_slices_kernel(U, up, self.Vs, pt, ps)
        n_t = self.V * (D - 1)
        n_s = self.V * self.n_planes_s
        sum_t = float(pt.sum())
        sum_s = float(ps.sum())

        cur = U            # level-0 links: the field itself (read only)
        done = 0
        for k, lev in enumerate(self.levels):
            if D > 2:
                for _ in range(lev - done):
                    dst = self._buf[0] if cur is not self._buf[0] else self._buf[1]
                    ape_step_kernel(cur, dst, up, dn, self.w)
                    cur = dst
            done = lev
            if D > 2:
                glue_ops_kernel(cur, up, self.Vs, self._loops_arr, glue[k],
                                self._lr, self._er, self._ls, self._es)
            for i in range(self.n_dirs):
                polyakov_slices_kernel(cur, up, i + 1, self.shape[i + 1], self._bases[i],
                                       self.Vs, tor[i, k])
        return {
            "glue": glue,
            "torelon": tor,
            "plaq": (sum_t + sum_s) / (n_t + n_s),
            "plaq_s": (sum_s / n_s) if n_s > 0 else float("nan"),
            "plaq_t": sum_t / n_t,
            "plaq_t_slices": pt,
            "plaq_s_slices": ps,
        }

    def __call__(self, lattice):
        if tuple(lattice.shape) != self.shape:
            raise ValueError("lattice shape %r does not match %r" % (lattice.shape, self.shape))
        return self.measure_arrays(lattice.U, lattice.up, lattice.dn)


_MEASURER_CACHE = {}


def measure(lattice, levels, w, loops=DEFAULT_LOOPS):
    """Measure all mass-gap operators on ``lattice`` (which is not modified).

    levels : strictly increasing non-negative ints (numbers of APE smearing steps),
    w      : APE weight,
    loops  : glueball loop shapes (default 1x1 and 2x2).

    Returns the dict described in :class:`Measurer` (glue[k, l, t], torelon[i-1, k, t], plaq,
    plaq_s, plaq_t, plaq_t_slices, plaq_s_slices).  Work buffers are cached per
    (shape, levels, w, loops), so repeated calls do not re-allocate.
    """
    key = (tuple(lattice.shape), tuple(int(x) for x in levels), float(w),
           tuple((int(a), int(b)) for a, b in loops))
    m = _MEASURER_CACHE.get(key)
    if m is None:
        if len(_MEASURER_CACHE) > 16:
            _MEASURER_CACHE.clear()
        m = Measurer(lattice.shape, levels, w, loops)
        _MEASURER_CACHE[key] = m
    return m(lattice)
