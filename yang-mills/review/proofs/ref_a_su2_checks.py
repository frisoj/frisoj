#!/usr/bin/env python3
"""Referee check of the SU(2)-specific steps of Stelling A (BEWIJZEN.md, sections 1-2).

Deterministic identities on random SU(2) data (fixed seed), no Monte Carlo error:
  (G1), (G2); composition rule (u^g)^h = u^{hg}; invariance of V and K; decomposition (2.1)
  on full lattices in D = 2, 3, 4 (plaquettes from sec. 1.2 versus the time-slice formula);
  the identity A(u,u') = sum_i phi_i(u) conj(phi_i(u')) and A^n = sum_I Phi_I conj(Phi_I);
  positive semidefiniteness of Gram matrices of K (necessary for (2.2));
  the pointwise identity behind the symmetry of T_0.
Plus two Monte Carlo checks (errors quoted):
  D = 2 kernel T_0(u,u') = int K(u^g,u') dg against the character series
  sum_j Lambda_j chi_j(h) chi_j(h'), and Z = int w dU against sum_j Lambda_j^N (L = N = 3).
And the behaviour of c = min T(u,u') in D = 2 (second remark after the proof).

Run:  python3 review/proofs/ref_a_su2_checks.py     (from yang-mills/)
"""
import itertools
import numpy as np
from scipy.special import iv

rng = np.random.default_rng(20261113)


def rand_su2(shape):
    q = rng.normal(size=tuple(shape) + (4,))
    q /= np.linalg.norm(q, axis=-1, keepdims=True)
    m = np.empty(tuple(shape) + (2, 2), dtype=complex)
    m[..., 0, 0] = q[..., 0] + 1j * q[..., 3]
    m[..., 0, 1] = q[..., 2] + 1j * q[..., 1]
    m[..., 1, 0] = -q[..., 2] + 1j * q[..., 1]
    m[..., 1, 1] = q[..., 0] - 1j * q[..., 3]
    return m


def dag(m):
    return np.conj(np.swapaxes(m, -1, -2))


def tr(m):
    return m[..., 0, 0] + m[..., 1, 1]


class Lattice:
    def __init__(self, shape):
        self.shape = tuple(shape)
        self.D = len(shape)
        self.sites = list(itertools.product(*[range(k) for k in shape]))
        self.sidx = {s: i for i, s in enumerate(self.sites)}
        self.links = [(s, mu) for s in self.sites for mu in range(self.D)]
        self.lidx = {l: i for i, l in enumerate(self.links)}
        self.plaq = []
        for s in self.sites:
            for mu in range(self.D):
                for nu in range(mu + 1, self.D):
                    self.plaq.append((self.lidx[(s, mu)], self.lidx[(self.shift(s, mu), nu)],
                                      self.lidx[(self.shift(s, nu), mu)], self.lidx[(s, nu)]))

    def shift(self, s, mu):
        s = list(s)
        s[mu] = (s[mu] + 1) % self.shape[mu]
        return tuple(s)


def plaq_trace_sum(lat, U):
    """sum_p Tr U_p, U of shape (..., nlinks, 2, 2); convention of sec. 1.2."""
    tot = 0.0
    for (a, b, c, d) in lat.plaq:
        tot = tot + tr(U[..., a, :, :] @ U[..., b, :, :] @ dag(U[..., c, :, :]) @ dag(U[..., d, :, :]))
    return tot


def gauge(ls, u, g):
    """(u^g)_(x,i) = g_x u_(x,i) g_{x+i}^{-1}."""
    out = np.empty_like(u)
    for (s, i), e in ls.lidx.items():
        out[..., e, :, :] = g[..., ls.sidx[s], :, :] @ u[..., e, :, :] @ dag(g[..., ls.sidx[ls.shift(s, i)], :, :])
    return out


def V_of(ls, u, beta):
    return -(beta / 2) * np.real(plaq_trace_sum(ls, u)) if ls.plaq else 0.0


def logK(u, up, beta):
    return (beta / 2) * np.real(np.sum(tr(u @ dag(up)), axis=-1))


print("== Haar sampling sanity (class-function moments): E[Tr]=0, E[Tr^2]=1, E[Tr^4]=2 ==")
x = np.real(tr(rand_su2((400000,))))
print(f"   E[Tr] = {x.mean():+.4f}, E[Tr^2] = {(x**2).mean():.4f}, E[Tr^4] = {(x**4).mean():.4f}")

print("== (G1), (G2) on 1000 random elements ==")
u = rand_su2((1000,))
g = rand_su2((1000,))
print(f"   max |Im Tr u| = {np.abs(tr(u).imag).max():.1e};  max |Tr u^-1 - Tr u| = {np.abs(tr(dag(u)) - tr(u)).max():.1e};"
      f"  max |Tr(g u g^-1) - Tr u| = {np.abs(tr(g @ u @ dag(g)) - tr(u)).max():.1e}")
print(f"   max |conj(u11) - u22| = {np.abs(np.conj(u[:, 0, 0]) - u[:, 1, 1]).max():.1e};"
      f"  max |conj(u12) + u21| = {np.abs(np.conj(u[:, 0, 1]) + u[:, 1, 0]).max():.1e}")

print("== sec 2.1 / step 2: composition rule and invariances, spatial lattice 3x3 (D=3) ==")
ls = Lattice((3, 3))
nE, nS = len(ls.links), len(ls.sites)
beta = 2.3
u, up = rand_su2((nE,)), rand_su2((nE,))
g, h = rand_su2((nS,)), rand_su2((nS,))
lhs = gauge(ls, gauge(ls, u, g), h)
print(f"   |(u^g)^h - u^(hg)| = {np.abs(lhs - gauge(ls, u, h @ g)).max():.1e};   |(u^g)^h - u^(gh)| = {np.abs(lhs - gauge(ls, u, g @ h)).max():.2f} (wrong order)")
print(f"   V(u^g) - V(u) = {V_of(ls, gauge(ls, u, g), beta) - V_of(ls, u, beta):.1e}")
print(f"   logK(u^g,u'^g) - logK(u,u') = {logK(gauge(ls, u, g), gauge(ls, up, g), beta) - logK(u, up, beta):.1e};"
      f"   logK(u,u') - logK(u',u) = {logK(u, up, beta) - logK(up, u, beta):.1e}")
print(f"   step 4 symmetry identity  logK(u'^g,u) - logK(u^(g^-1),u') = {logK(gauge(ls, up, g), u, beta) - logK(gauge(ls, u, dag(g)), up, beta):.1e}")
print(f"   step 2(c) identity        logK(u,u'^(g^-1)) - logK(u^g,u') = {logK(u, gauge(ls, up, dag(g)), beta) - logK(gauge(ls, u, g), up, beta):.1e}")

print("== step 1: decomposition (2.1) on random full configurations ==")
for sshape, N in [((3,), 3), ((4,), 5), ((3, 3), 3), ((3, 4), 3), ((3, 3, 3), 3)]:
    full = Lattice(tuple(sshape) + (N,))
    ls = Lattice(sshape)
    Dfull = full.D
    U = rand_su2((len(full.links),))
    logw = (beta / 2) * np.real(plaq_trace_sum(full, U))
    us = [np.array([U[full.lidx[(tuple(s) + (t,), i)]] for (s, i) in ls.links]) for t in range(N)]
    vs = [np.array([U[full.lidx[(tuple(s) + (t,), Dfull - 1)]] for s in ls.sites]) for t in range(N)]
    rhs = sum(-V_of(ls, us[t], beta) + logK(gauge(ls, us[t], dag(vs[t])), us[(t + 1) % N], beta) for t in range(N))
    wrong = sum(-V_of(ls, us[t], beta) + logK(gauge(ls, us[t], vs[t]), us[(t + 1) % N], beta) for t in range(N))
    print(f"   D={Dfull}, spatial {sshape}, N={N}: {len(full.plaq)} plaquettes; log w = {logw:+.10f}; (2.1) = {rhs:+.10f};"
          f" diff {abs(logw - rhs):.1e};  with g^t = v^t instead of (v^t)^-1: diff {abs(logw - wrong):.2f}")

print("== step 3: A(u,u') = sum_i phi_i conj(phi_i'), A^n = sum_I Phi_I conj(Phi_I'), Gram matrices of K ==")
ls = Lattice((3,))
nE = len(ls.links)
u, up = rand_su2((nE,)), rand_su2((nE,))
A = np.sum(tr(u @ dag(up)))
phi, phip = u.reshape(-1), up.reshape(-1)            # the 4|E| matrix elements
print(f"   A - sum_i phi_i conj(phi'_i) = {abs(A - np.sum(phi * np.conj(phip))):.1e}  (A = {A.real:+.6f}, Im A = {A.imag:.1e})")
for n in (2, 3):
    s = 0.0
    for I in itertools.product(range(len(phi)), repeat=n):
        s += np.prod(phi[list(I)]) * np.conj(np.prod(phip[list(I)]))
    print(f"   n={n}: A^n - sum_I Phi_I conj(Phi'_I) = {abs(A**n - s):.1e}  ({len(phi)**n} monomials)")
for sshape, bet, nsamp in [((3,), 1.0, 500), ((3,), 6.0, 500), ((3, 3), 2.3, 500)]:
    ls = Lattice(sshape)
    us = rand_su2((nsamp, len(ls.links)))
    G = np.exp((bet / 2) * np.real(np.einsum("aeij,beij->ab", us, np.conj(us))))   # Tr(u u'^dagger) summed over e
    ev = np.linalg.eigvalsh(G)
    print(f"   Gram matrix K(u_a,u_b), spatial {sshape}, beta={bet}, {nsamp} random points: min eig = {ev.min():.3e}, max eig = {ev.max():.3e}")

print("== step 4 (D=2, L=3): T_0(u,u') by Monte Carlo over g versus the character series ==")


def chars(c, nmax):
    """chi_j(theta) for 2j = 0..nmax-1 with c = cos(theta) (Chebyshev U)."""
    out = [np.ones_like(c), 2 * c]
    for _ in range(nmax - 2):
        out.append(2 * c * out[-1] - out[-2])
    return np.array(out)


def lam(beta, L, nmax):
    n = np.arange(1, nmax + 1)
    return (2.0 / beta * iv(n, beta)) ** L


L, beta, nmax = 3, 1.5, 40
ls = Lattice((L,))
for trial in range(3):
    u, up = rand_su2((L,)), rand_su2((L,))
    if trial == 2:                                  # extreme pair: h = 1, h' = -1
        u = np.array([np.eye(2, dtype=complex)] * L)
        up = np.array([np.eye(2, dtype=complex)] * L)
        up[0] = -up[0]
    nmc = 400000
    g = rand_su2((nmc, L))
    vals = np.exp(logK(gauge(ls, np.broadcast_to(u, (nmc, L, 2, 2)), g), up, beta))
    mc, se = vals.mean(), vals.std() / np.sqrt(nmc)
    ch = np.real(tr(u[0] @ u[1] @ u[2])) / 2
    chp = np.real(tr(up[0] @ up[1] @ up[2])) / 2
    series = float(np.sum(lam(beta, L, nmax) * chars(np.array(ch), nmax) * chars(np.array(chp), nmax)))
    print(f"   pair {trial}: cos(theta)={ch:+.4f}, cos(theta')={chp:+.4f}: MC = {mc:.5f} +- {se:.5f}; series = {series:.5f}; "
          f"dev = {(mc - series) / se:+.2f} sigma; min of integrand K = {vals.min():.4f}")

print("== step 4 (D=2, L=N=3): Z = int w dU by uniform Monte Carlo versus sum_j Lambda_j^N ==")
beta, L, N = 1.0, 3, 3
full = Lattice((L, N))
nmc, chunk = 1500000, 150000
acc = []
for _ in range(nmc // chunk):
    U = rand_su2((chunk, len(full.links)))
    acc.append(np.exp((beta / 2) * np.real(plaq_trace_sum(full, U))))
acc = np.concatenate(acc)
Zmc, Zse = acc.mean(), acc.std() / np.sqrt(len(acc))
Zex = float(np.sum(lam(beta, L, 40) ** N))
print(f"   beta={beta}: Z_MC = {Zmc:.4f} +- {Zse:.4f};  sum_j Lambda_j^N = {Zex:.4f};  dev = {(Zmc - Zex) / Zse:+.2f} sigma")

print("== second remark: c = min T(u,u') in D = 2 does NOT tend to zero as L grows ==")
th = np.linspace(0, np.pi, 721)
c = np.cos(th)
for beta in (0.5, 2.3, 6.0):
    row = []
    for L in (3, 4, 6, 10, 20, 40):
        nmax = 400
        lj = lam(beta, L, nmax)
        ch = chars(c, nmax)                          # (nmax, ntheta)
        ker = np.einsum("j,ja,jb->ab", lj / lj[0], ch, ch)
        row.append((L, lj[0], ker.min(), ker.max()))
    print(f"   beta={beta}: " + "; ".join(f"L={L}: lambda_0={l0:.3e}, min T/lambda_0={mn:.4f}, min T={mn*l0:.3e}"
                                          for (L, l0, mn, mx) in row))
print("   (Jensen: T_0(u,u') = int K(u^g,u') dg >= exp(int log K dg) = exp(0) = 1 for every lattice with L >= 2.)")
