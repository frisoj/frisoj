"""Referee check of BEWIJZEN.md, Stelling B, point 2 (and the facts of section 3.1 / S5 / S6).

Run from the repository root:  python3 review/proofs/ref_b_cj.py

Checks (all deterministic, fixed seed):
  1. Weyl integration formula  int_G phi dg = (2/pi) int_0^pi phi(theta) sin^2(theta) dtheta:
     normalisation, and comparison with a Haar Monte Carlo (random unit quaternions).
  2. Characters: chi_j(g) = Tr D^j(g) with D^j(g) = exp(-i*angle*n.J) built from spin matrices
     equals sin((2j+1)theta)/sin(theta); D^j is a homomorphism; orthonormality by quadrature.
  3. c_j = int k chi_j dg by Gauss-Legendre quadrature against I_{2j} - I_{2j+2} and against
     (2(2j+1)/beta) I_{2j+1}, for several beta and j.
  4. The Schur step: A_j = int k(a) D^j(a^{-1}) da computed by quadrature over SU(2) (S^3 in
     hyperspherical coordinates) is (c_j/d_j) * identity.
"""
import numpy as np
from scipy.special import iv, eval_chebyu

rng = np.random.default_rng(20261113)
ok_all = True


def report(name, value, tol):
    global ok_all
    ok = abs(value) <= tol
    ok_all &= ok
    print("  %-62s %.3e  (tol %.0e)  %s" % (name, value, tol, "ok" if ok else "FAIL"))


def chi(twoj, theta):
    """sin((2j+1) theta)/sin(theta) = U_{2j}(cos theta)."""
    return eval_chebyu(twoj, np.cos(theta))


# Gauss-Legendre nodes on [0, pi]
xg, wg = np.polynomial.legendre.leggauss(400)
TH = 0.5 * np.pi * (xg + 1.0)
WTH = 0.5 * np.pi * wg


def weyl(phi_vals):
    return (2.0 / np.pi) * np.sum(WTH * phi_vals * np.sin(TH) ** 2)


print("1. Weyl integration formula")
report("normalisation (2/pi) int sin^2 - 1", weyl(np.ones_like(TH)) - 1.0, 1e-13)
q = rng.normal(size=(2_000_000, 4))
q /= np.linalg.norm(q, axis=1)[:, None]          # Haar on SU(2) = uniform on S^3
tr = 2.0 * q[:, 0]                                 # Tr g = 2 a0 = 2 cos(theta)
th_mc = np.arccos(np.clip(q[:, 0], -1, 1))
for name, f in [("Tr^2", lambda t: (2 * np.cos(t)) ** 2), ("Tr^4", lambda t: (2 * np.cos(t)) ** 4),
                ("exp(1.7 cos)", lambda t: np.exp(1.7 * np.cos(t))),
                ("chi_1 * chi_1", lambda t: chi(2, t) ** 2), ("chi_{3/2} chi_{1/2}", lambda t: chi(3, t) * chi(1, t))]:
    v = f(th_mc)
    mc, err = v.mean(), v.std() / np.sqrt(len(v))
    ex = weyl(f(TH))
    ok = abs(mc - ex) < 4 * err
    ok_all &= ok
    print("  Haar MC %-20s MC = %.5f +- %.5f   Weyl quadrature = %.5f   %s"
          % (name, mc, err, ex, "ok" if ok else "FAIL"))

print("2. Characters")
gram = np.array([[weyl(chi(a, TH) * chi(b, TH)) for b in range(9)] for a in range(9)])
report("max |<chi_j, chi_k> - delta_jk|, 2j,2k = 0..8", np.max(np.abs(gram - np.eye(9))), 1e-12)


def spin_matrices(twoj):
    j = twoj / 2.0
    m = np.arange(j, -j - 1, -1)
    jz = np.diag(m)
    jp = np.zeros((twoj + 1, twoj + 1))
    for a in range(1, twoj + 1):                   # J+ |m> = sqrt(j(j+1) - m(m+1)) |m+1>
        jp[a - 1, a] = np.sqrt(j * (j + 1) - m[a] * (m[a] + 1))
    jx = 0.5 * (jp + jp.T)
    jy = -0.5j * (jp - jp.T)
    return jx, jy, jz.astype(complex)


def rep(twoj, quat):
    """D^j of the SU(2) element a0 + i a.sigma = exp(i psi n.sigma), i.e. D^j = exp(2 i psi n.J)."""
    a0, a = quat[0], quat[1:]
    s = np.linalg.norm(a)
    d = twoj + 1
    if s < 1e-15:
        return (np.sign(a0) ** twoj) * np.eye(d, dtype=complex)
    psi = np.arctan2(s, a0)
    n = a / s
    jx, jy, jz = spin_matrices(twoj)
    w, v = np.linalg.eigh(n[0] * jx + n[1] * jy + n[2] * jz)
    return (v * np.exp(2j * psi * w)) @ v.conj().T


def qmul(a, b):
    """Quaternion product for U = a0 + i a.sigma (same convention as ym/lattice.py)."""
    return np.concatenate(([a[0] * b[0] - a[1:] @ b[1:]],
                           a[0] * b[1:] + b[0] * a[1:] - np.cross(a[1:], b[1:])))


def q2m(a):
    return np.array([[a[0] + 1j * a[3], a[2] + 1j * a[1]], [-a[2] + 1j * a[1], a[0] - 1j * a[3]]])


worst_c, worst_h, worst_f = 0.0, 0.0, 0.0
for _ in range(40):
    g1, g2 = q[rng.integers(len(q))], q[rng.integers(len(q))]
    for twoj in range(0, 7):
        th = np.arccos(g1[0])
        worst_c = max(worst_c, abs(np.trace(rep(twoj, g1)) - chi(twoj, th)))
        worst_h = max(worst_h, np.max(np.abs(rep(twoj, qmul(g1, g2)) - rep(twoj, g1) @ rep(twoj, g2))))
    # D^{1/2} is unitarily equivalent to the defining matrix: same trace and determinant 1
    worst_f = max(worst_f, abs(np.trace(rep(1, g1)) - np.trace(q2m(g1))), abs(np.linalg.det(rep(1, g1)) - 1))
report("max |Tr D^j(g) - sin((2j+1)theta)/sin(theta)|, 2j=0..6", worst_c, 1e-11)
report("max |D^j(g1 g2) - D^j(g1) D^j(g2)|, 2j=0..6", worst_h, 1e-11)
report("D^{1/2}: Tr equals Tr g, det = 1", worst_f, 1e-11)

print("3. c_j = int k chi_j dg,  k = exp((beta/2) Tr) = exp(beta cos theta)")
print("   beta   2j   quadrature          I_2j - I_2j+2       (2 d_j/beta) I_2j+1   rel.dev")
worst, worst_abs = 0.0, 0.0
for beta in (0.05, 0.5, 1.0, 2.3, 5.0, 20.0, 100.0):
    c0 = 2.0 / beta * iv(1, beta)
    for twoj in (0, 1, 2, 3, 4, 7):
        cq = weyl(np.exp(beta * np.cos(TH)) * chi(twoj, TH))
        c1 = iv(twoj, beta) - iv(twoj + 2, beta)
        c2 = 2.0 * (twoj + 1) / beta * iv(twoj + 1, beta)
        dev = max(abs(cq - c1), abs(cq - c2)) / abs(c2)
        # the quadrature has an absolute rounding error of about 1e-16 * c_0, so the RELATIVE
        # deviation is only meaningful where c_j is not itself of that size (small beta, large j)
        worst_abs = max(worst_abs, max(abs(cq - c1), abs(cq - c2)) / c0)
        if c2 > 1e-5 * c0:
            worst = max(worst, dev)
        if twoj in (0, 1, 2) or beta in (2.3,):
            print("   %-6g %-3d  %.12e  %.12e  %.12e  %.1e" % (beta, twoj, cq, c1, c2, dev))
report("max relative deviation, entries with c_j > 1e-5 c_0", worst, 1e-10)
report("max absolute deviation / c_0, all (beta, j)", worst_abs, 1e-13)

print("4. Schur step: A_j = int k(a) D^j(a^{-1}) da = (c_j/d_j) 1  (quadrature over S^3)")
xp, wp = np.polynomial.legendre.leggauss(60)       # psi in [0, pi]
PSI, WPSI = 0.5 * np.pi * (xp + 1), 0.5 * np.pi * wp
xc, wc = np.polynomial.legendre.leggauss(12)       # cos(polar angle)
PHI = 2 * np.pi * np.arange(24) / 24
worst = 0.0
for beta in (0.7, 2.3, 6.0):
    for twoj in (0, 1, 2, 3, 4):
        d = twoj + 1
        A = np.zeros((d, d), dtype=complex)
        jx, jy, jz = spin_matrices(twoj)
        for c, w_c in zip(xc, wc):
            for ph in PHI:
                n = np.array([np.sqrt(1 - c * c) * np.cos(ph), np.sqrt(1 - c * c) * np.sin(ph), c])
                w, v = np.linalg.eigh(n[0] * jx + n[1] * jy + n[2] * jz)
                # a = exp(i psi n.sigma), k(a) = exp(beta cos psi), D^j(a^{-1}) = exp(-2 i psi n.J)
                # Haar: (2/pi) sin^2(psi) dpsi * dOmega/(4 pi)
                coef = (WPSI * (2 / np.pi) * np.sin(PSI) ** 2 * np.exp(beta * np.cos(PSI)))[:, None] \
                    * np.exp(-2j * PSI[:, None] * w[None, :])
                A += (w_c / 2.0) * (1.0 / 24) * (v * coef.sum(axis=0)) @ v.conj().T
        target = 2.0 / beta * iv(twoj + 1, beta)
        worst = max(worst, np.max(np.abs(A - target * np.eye(d))) / target)
report("max |A_j - (2/beta) I_{2j+1} 1| / ((2/beta) I_{2j+1})", worst, 1e-10)

print("5. End to end, SU(2), L = 3: (T chi_j o h)(u) = int prod_i k(u_i u_i'^-1) chi_j(u_1'u_2'u_3') du'")
print("   by Haar Monte Carlo over u' in G^3 (4e6 samples), against Lambda_j chi_j(h(u))")


def qmul_v(a, b):
    out = np.empty(np.broadcast(a, b).shape)
    out[..., 0] = a[..., 0] * b[..., 0] - a[..., 1] * b[..., 1] - a[..., 2] * b[..., 2] - a[..., 3] * b[..., 3]
    out[..., 1] = a[..., 0] * b[..., 1] + b[..., 0] * a[..., 1] - (a[..., 2] * b[..., 3] - a[..., 3] * b[..., 2])
    out[..., 2] = a[..., 0] * b[..., 2] + b[..., 0] * a[..., 2] - (a[..., 3] * b[..., 1] - a[..., 1] * b[..., 3])
    out[..., 3] = a[..., 0] * b[..., 3] + b[..., 0] * a[..., 3] - (a[..., 1] * b[..., 2] - a[..., 2] * b[..., 1])
    return out


beta, nmc = 1.2, 4_000_000
conj = np.array([1.0, -1.0, -1.0, -1.0])
u3 = rng.normal(size=(3, 4))
u3 /= np.linalg.norm(u3, axis=1)[:, None]
hu = qmul_v(qmul_v(u3[0], u3[1]), u3[2])
up = rng.normal(size=(3, nmc, 4))
up /= np.linalg.norm(up, axis=2)[:, :, None]
wgt = np.ones(nmc)
for i in range(3):
    wgt *= np.exp(beta * qmul_v(u3[i][None, :], up[i] * conj)[:, 0])     # k(u_i u_i'^-1)
hp = qmul_v(qmul_v(up[0], up[1]), up[2])
for twoj in (0, 1, 2, 3):
    vals = wgt * eval_chebyu(twoj, np.clip(hp[:, 0], -1, 1))
    mc, err = vals.mean(), vals.std() / np.sqrt(nmc)
    pred = (2.0 / beta * iv(twoj + 1, beta)) ** 3 * eval_chebyu(twoj, hu[0])
    ok = abs(mc - pred) < 4 * err
    ok_all &= ok
    print("   2j = %d:  MC = %+.5f +- %.5f   Lambda_j chi_j(h(u)) = %+.5f   dev = %+.2f sigma   %s"
          % (twoj, mc, err, pred, (mc - pred) / err, "ok" if ok else "FAIL"))

print("ALL OK" if ok_all else "SOME CHECK FAILED")
