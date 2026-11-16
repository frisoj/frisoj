"""Second-round referee check of BEWIJZEN.md, Stelling B, point 2 and the facts of 3.1 / S5 / S6.

Run from /home/user/frisoj/yang-mills:  python3 review/proofs/ref_b_r2_su2_integrals.py

Deliberately independent of ref_b_cj.py (first round, unreviewed):
  * Haar integrals are done in HOPF coordinates on S^3 (u = [[a, b], [-conj b, conj a]],
    a = cos(eta) e^{i xi1}, b = sin(eta) e^{i xi2}, Haar = 2 sin(eta) cos(eta) d eta
    d xi1/(2 pi) d xi2/(2 pi)), so the class-function (Weyl) formula of 3.1 is TESTED, not used;
  * the representations D^j are built as symmetric powers acting on homogeneous polynomials
    of degree 2j (no spin matrices, no exponentials);
  * Bessel functions come from the power series of S6 (scipy is used only as a cross-check).

Checks:
  A. Weyl formula  int_G phi dg = (2/pi) int_0^pi phi(theta) sin^2(theta) d theta.
  B. c_j = int k chi_j dg  three ways (Hopf 2-D quadrature, scipy.quad with the Weyl measure,
     closed forms I_2j - I_2j+2 and (2 d_j / beta) I_2j+1) for several beta and j.
  C. Pointwise character expansion  e^{beta cos theta} = sum_j d_j (c_j/d_j) chi_j(theta).
  D. Sym^n is a representation with character sin((n+1) theta)/sin(theta); the Schur step
     A_j = int k(a) D^j(a^-1) da = (c_j/d_j) 1 by 3-D quadrature.
  E. End to end for SU(2): (T chi_j o h)(u) = Lambda_j chi_j(h(u)) for L = 3 and L = 4, by
     importance-sampled Monte Carlo (a_i drawn with density k/c_0), fixed seed.
"""
import math
import warnings
import numpy as np
from scipy import integrate
from scipy.special import iv, eval_chebyu

warnings.simplefilter("ignore", integrate.IntegrationWarning)   # quad is asked for 1e-14
rng = np.random.default_rng(20261115)
ok_all = True


def report(name, value, tol):
    global ok_all
    ok = abs(value) <= tol
    ok_all &= ok
    print("  %-70s %.3e  (tol %.0e)  %s" % (name, value, tol, "ok" if ok else "FAIL"))


def bessel_series(n, x, terms=200):
    """I_n(x) from the power series quoted in S6:  sum_k (x/2)^(2k+n) / (k! (k+n)!),
    summed with the term ratio (x/2)^2 / ((k+1)(k+n+1)) to avoid huge factorials."""
    term = (x / 2.0) ** n / math.factorial(n)
    terms_list = []
    for k in range(terms):
        terms_list.append(term)
        term *= (x / 2.0) ** 2 / ((k + 1.0) * (k + n + 1.0))
    return math.fsum(terms_list)


def chi(twoj, costheta):
    """chi_j = sin((2j+1) theta)/sin(theta) = U_{2j}(cos theta) (Chebyshev, 2nd kind)."""
    return eval_chebyu(twoj, costheta)


# ---- Hopf-coordinate quadrature --------------------------------------------------------------
NE, NX = 48, 96
xe, we = np.polynomial.legendre.leggauss(NE)
ETA = 0.25 * np.pi * (xe + 1.0)                    # eta in [0, pi/2]
WETA = 0.25 * np.pi * we * 2.0 * np.sin(ETA) * np.cos(ETA)
XI = 2.0 * np.pi * np.arange(NX) / NX              # trapezoid (spectrally accurate, periodic)


def haar_class(phi_of_cos):
    """int_G phi dg for a class function given as a function of cos(theta) = (1/2) Tr u
    = cos(eta) cos(xi1).  (The xi2 integral is trivial.)"""
    c = np.cos(ETA)[:, None] * np.cos(XI)[None, :]
    return float(np.sum(WETA[:, None] * phi_of_cos(c)) / NX)


def weyl(phi_of_theta):
    val, _ = integrate.quad(lambda t: phi_of_theta(t) * np.sin(t) ** 2, 0.0, np.pi,
                            epsabs=1e-14, epsrel=1e-14, limit=400)
    return 2.0 / np.pi * val


print("A. Weyl integration formula (Hopf-coordinate Haar integral versus (2/pi) sin^2 measure)")
report("Haar measure normalised: int 1 dg - 1", haar_class(lambda c: np.ones_like(c)) - 1.0, 1e-13)
worst = 0.0
for name, f in (("(Tr u)^2", lambda c: (2 * c) ** 2), ("(Tr u)^6", lambda c: (2 * c) ** 6),
                ("exp(2.3 cos)", lambda c: np.exp(2.3 * c)), ("chi_1^2", lambda c: chi(2, c) ** 2),
                ("chi_{5/2} chi_{3/2}", lambda c: chi(5, c) * chi(3, c)),
                ("|cos|^3 (non-smooth)", lambda c: np.abs(c) ** 3)):
    a, b = haar_class(f), weyl(lambda t: f(np.cos(t)))
    tol = 1e-12 if "non" not in name else 2e-4
    ok = abs(a - b) < tol
    ok_all &= ok
    worst = max(worst, abs(a - b)) if "non" not in name else worst
    print("  %-22s Hopf = %.14f   Weyl = %.14f   diff = %.1e  %s" % (name, a, b, a - b, "ok" if ok else "FAIL"))
gram = np.array([[haar_class(lambda c: chi(p, c) * chi(q, c)) for q in range(8)] for p in range(8)])
report("characters orthonormal in L^2(G): max |<chi_j,chi_k> - delta|, 2j,2k<8", np.max(np.abs(gram - np.eye(8))), 1e-12)
print("  (int (Tr u)^2 dg = 1 and int (Tr u)^6 dg = 5: Catalan numbers, as they must be)")

print("B. c_j = int k chi_j dg,  k(a) = exp((beta/2) Tr a)")
print("   beta    2j  Hopf quadrature        scipy.quad (Weyl)      I_2j - I_2j+2 (series)  (2 d_j/beta) I_2j+1")
worst_rel, worst_scipy = 0.0, 0.0
for beta in (0.1, 0.7, 2.3, 6.0, 15.0):
    c0 = 2.0 / beta * bessel_series(1, beta)
    for twoj in range(0, 7):
        v1 = haar_class(lambda c: np.exp(beta * c) * chi(twoj, c))
        v2 = weyl(lambda t: np.exp(beta * np.cos(t)) * chi(twoj, np.cos(t)))
        v3 = bessel_series(twoj, beta) - bessel_series(twoj + 2, beta)
        v4 = 2.0 * (twoj + 1) / beta * bessel_series(twoj + 1, beta)
        # absolute errors are ~1e-15 * c_0; compare in units of c_0 (c_j itself can be 1e-11 c_0)
        worst_rel = max(worst_rel, max(abs(v1 - v4), abs(v2 - v4), abs(v3 - v4)) / c0)
        worst_scipy = max(worst_scipy, abs(v4 - 2.0 * (twoj + 1) / beta * iv(twoj + 1, beta)) / v4)
        if twoj in (0, 1, 2, 5) and beta in (0.7, 2.3, 15.0):
            print("   %-6g  %d   %.13e  %.13e  %.13e  %.13e" % (beta, twoj, v1, v2, v3, v4))
report("max deviation between the four values, in units of c_0(beta)", worst_rel, 5e-13)
report("power series of S6 versus scipy.special.iv (relative)", worst_scipy, 1e-13)

print("C. character expansion  exp(beta cos theta) = sum_j d_j (2/beta) I_{2j+1}(beta) chi_j(theta)")
worst = 0.0
for beta in (0.7, 2.3, 6.0, 15.0):
    for theta in (0.0, 0.3, 1.1, 2.0, 3.0, np.pi):
        s = math.fsum((n + 1) * 2.0 / beta * bessel_series(n + 1, beta) * chi(n, math.cos(theta))
                      for n in range(0, 80))
        worst = max(worst, abs(s - math.exp(beta * math.cos(theta))) / math.exp(beta))
report("max |series - exp(beta cos theta)| / exp(beta)", worst, 1e-13)


# ---- D. symmetric powers ---------------------------------------------------------------------
def sym_power(n, u):
    """Matrix of u in SU(2) on homogeneous polynomials of degree n in (x, y), basis
    x^(n-k) y^k, acting by substitution (x, y) -> (x, y) u = (u11 x + u21 y, u12 x + u22 y).
    This is the (n+1)-dimensional irreducible representation, equivalent to D^{n/2} (the
    basis is not orthonormal, which is irrelevant for the trace and for the Schur step)."""
    px = np.array([u[0, 0], u[1, 0]])       # coefficients of (x, y) in the image of x
    py = np.array([u[0, 1], u[1, 1]])
    m = np.zeros((n + 1, n + 1), dtype=complex)
    for k in range(n + 1):
        p = np.array([1.0 + 0j])
        for _ in range(n - k):
            p = np.convolve(p, px)
        for _ in range(k):
            p = np.convolve(p, py)
        m[:, k] = p                          # p[i] = coefficient of x^(n-i) y^i
    return m


def su2(eta, x1, x2):
    a = np.cos(eta) * np.exp(1j * x1)
    b = np.sin(eta) * np.exp(1j * x2)
    return np.array([[a, b], [-np.conj(b), np.conj(a)]])


def haar_random(size):
    q = rng.normal(size=(size, 4))
    q /= np.linalg.norm(q, axis=1)[:, None]
    return q


def q2m(q):
    return np.array([[q[0] + 1j * q[3], q[2] + 1j * q[1]], [-q[2] + 1j * q[1], q[0] - 1j * q[3]]])


print("D. symmetric powers Sym^n = D^{n/2}: representation property, character, Schur step")
w_hom, w_chr = 0.0, 0.0
for _ in range(25):
    g1, g2 = q2m(haar_random(1)[0]), q2m(haar_random(1)[0])
    for n in range(0, 7):
        # (rho(u) p)(v) = p(v u) for the row vector v = (x, y): a homomorphism in u
        d1, d2, d12 = sym_power(n, g1), sym_power(n, g2), sym_power(n, g1 @ g2)
        w_hom = max(w_hom, np.max(np.abs(d12 - d1 @ d2)))
        w_chr = max(w_chr, abs(np.trace(d1) - chi(n, 0.5 * np.trace(g1).real)))
report("max |D(g1 g2) - D(g1) D(g2)|, n = 0..6", w_hom, 1e-12)
report("max |Tr D^{n/2}(g) - sin((n+1) theta)/sin(theta)|, n = 0..6", w_chr, 1e-12)

ne, nx = 24, 40
xe2, we2 = np.polynomial.legendre.leggauss(ne)
eta2 = 0.25 * np.pi * (xe2 + 1.0)
weta2 = 0.25 * np.pi * we2 * 2.0 * np.sin(eta2) * np.cos(eta2)
xi2 = 2.0 * np.pi * np.arange(nx) / nx
worst = 0.0
for beta in (0.7, 2.3, 5.0):
    A = {n: np.zeros((n + 1, n + 1), dtype=complex) for n in range(0, 6)}
    for e, w_e in zip(eta2, weta2):
        for x1 in xi2:
            kval = math.exp(beta * math.cos(e) * math.cos(x1))        # k(a) = exp((beta/2) Tr a)
            for x2 in xi2[:16] * (nx / 16.0):                          # 16 nodes suffice in xi2
                a_inv = su2(e, x1, x2).conj().T
                for n in A:
                    A[n] += (w_e / nx / 16.0) * kval * sym_power(n, a_inv)
    for n in A:
        target = 2.0 / beta * bessel_series(n + 1, beta)
        worst = max(worst, np.max(np.abs(A[n] - target * np.eye(n + 1))) / target)
report("max |A_j - (2/beta) I_{2j+1}(beta) 1| / ((2/beta) I_{2j+1}), 2j = 0..5", worst, 1e-10)


# ---- E. end to end ---------------------------------------------------------------------------
def qmul(a, b):
    out = np.empty(np.broadcast(a, b).shape)
    out[..., 0] = a[..., 0] * b[..., 0] - a[..., 1] * b[..., 1] - a[..., 2] * b[..., 2] - a[..., 3] * b[..., 3]
    out[..., 1] = a[..., 0] * b[..., 1] + b[..., 0] * a[..., 1] - (a[..., 2] * b[..., 3] - a[..., 3] * b[..., 2])
    out[..., 2] = a[..., 0] * b[..., 2] + b[..., 0] * a[..., 2] - (a[..., 3] * b[..., 1] - a[..., 1] * b[..., 3])
    out[..., 3] = a[..., 0] * b[..., 3] + b[..., 0] * a[..., 3] - (a[..., 1] * b[..., 2] - a[..., 2] * b[..., 1])
    return out


def sample_k(beta, size):
    """a in SU(2) with density k(a)/c_0 w.r.t. Haar: a0 has density prop. to
    exp(beta x) sqrt(1 - x^2) on [-1, 1]; the direction of the vector part is uniform."""
    x0 = np.empty(size)
    todo = np.arange(size)
    while len(todo):
        r = rng.random(len(todo))
        x = 1.0 + np.log(np.exp(-2 * beta) + r * (1.0 - np.exp(-2 * beta))) / beta
        acc = rng.random(len(todo)) ** 2 <= 1.0 - x * x
        x0[todo[acc]] = x[acc]
        todo = todo[~acc]
    v = rng.normal(size=(size, 3))
    v *= (np.sqrt(np.maximum(0.0, 1.0 - x0 * x0)) / np.linalg.norm(v, axis=1))[:, None]
    return np.concatenate([x0[:, None], v], axis=1)


print("E. end to end, SU(2): E_k[chi_j(a_1^-1 u_1 ... a_L^-1 u_L)] = (I_{2j+1}/I_1)^L chi_j(h(u))")
print("   (this is (T chi_j o h)(u) / Lambda_0 with a_i drawn from k/c_0; 3e6 samples)")
conj = np.array([1.0, -1.0, -1.0, -1.0])
nmc = 3_000_000
# sanity check of the sampler: E[(1/2) Tr a] must be c_{1/2}/(2 c_0) = I_2/I_1
for beta in (6.0,):
    a = sample_k(beta, nmc)
    m, e = a[:, 0].mean(), a[:, 0].std() / math.sqrt(nmc)
    target = bessel_series(2, beta) / bessel_series(1, beta)
    ok = abs(m - target) < 4 * e
    ok_all &= ok
    print("   sampler: E[(1/2) Tr a] = %.5f +- %.5f,  I_2/I_1 = %.5f   %s" % (m, e, target, "ok" if ok else "FAIL"))
for beta, L in ((6.0, 3), (6.0, 4)):
    # u_1 .. u_{L-1} Haar random, u_L chosen such that the holonomy has class angle 0.5
    # (then chi_j(h(u)) is of order 1 for all j tested, so every row is a real test)
    u = haar_random(L)
    w = u[0]
    for i in range(1, L - 1):
        w = qmul(w, u[i])
    axis = np.array([0.36, -0.48, 0.8])
    h_target = np.concatenate([[math.cos(0.5)], math.sin(0.5) * axis])
    u[L - 1] = qmul(w * conj, h_target)
    h = qmul(w, u[L - 1])
    assert abs(h[0] - math.cos(0.5)) < 1e-13
    prod = None
    for i in range(L):
        a = sample_k(beta, nmc)
        f = qmul(a * conj, u[i][None, :])                 # a_i^-1 u_i
        prod = f if prod is None else qmul(prod, f)
    for twoj in (1, 2, 3, 4):
        vals = chi(twoj, np.clip(prod[:, 0], -1.0, 1.0))
        mc, err = vals.mean(), vals.std() / math.sqrt(nmc)
        lam = (bessel_series(twoj + 1, beta) / bessel_series(1, beta)) ** L
        pred = lam * chi(twoj, h[0])
        dev = (mc - pred) / err
        ok = abs(dev) < 4.0
        ok_all &= ok
        print("   beta=%g L=%d 2j=%d: MC = %+.5f +- %.5f   prediction = %+.5f  (chi_j(h(u)) = %+.4f, "
              "signal/noise %.0f)   dev = %+.2f sigma  %s"
              % (beta, L, twoj, mc, err, pred, chi(twoj, h[0]), abs(pred) / err, dev, "ok" if ok else "FAIL"))

# ---- F. point 1 -------------------------------------------------------------------------------
print("F. point 1: holonomy coordinates and gauge orbits (SU(2), L = 5)")
L = 5


def chain(u):
    """w_i = u_1 ... u_i for i = 1..L (w_L = h)."""
    out = [u[0]]
    for i in range(1, len(u)):
        out.append(qmul(out[-1], u[i]))
    return out


def gauge(u, g):
    """(u^g)_i = g_i u_i g_{i+1}^-1 with g_{L+1} = g_1."""
    return np.array([qmul(qmul(g[i], u[i]), g[(i + 1) % len(u)] * conj) for i in range(len(u))])


w_act, w_inv, w_orbit = 0.0, 0.0, 0.0
for _ in range(200):
    u, g = haar_random(L), haar_random(L)
    w, wg = chain(u), chain(gauge(u, g))
    for i in range(L - 1):                                        # w_i -> g_1 w_i g_{i+1}^-1
        w_act = max(w_act, np.max(np.abs(wg[i] - qmul(qmul(g[0], w[i]), g[i + 1] * conj))))
    w_act = max(w_act, np.max(np.abs(wg[L - 1] - qmul(qmul(g[0], w[L - 1]), g[0] * conj))))   # h
    # inverse map: u_1 = w_1, u_i = w_{i-1}^-1 w_i, u_L = w_{L-1}^-1 h
    back = [w[0]] + [qmul(w[i - 1] * conj, w[i]) for i in range(1, L)]
    w_inv = max(w_inv, np.max(np.abs(np.array(back) - u)))
    # two configurations with CONJUGATE holonomies are gauge equivalent (so a gauge-invariant
    # function is a class function of h): take u2 random with h(u2) = s h(u) s^-1 and construct
    # g_1 = s, g_{i+1} = (u2_i)^-1 g_i u_i; then u2 = u^g and g_{L+1} = g_1.
    s = haar_random(1)[0]
    u2 = haar_random(L)
    w2 = chain(u2[:L - 1])[-1]
    u2[L - 1] = qmul(w2 * conj, qmul(qmul(s, w[L - 1]), s * conj))
    gg = [s]
    for i in range(L):
        gg.append(qmul(qmul(u2[i] * conj, gg[i]), u[i]))
    w_orbit = max(w_orbit, np.max(np.abs(gg[L] - gg[0])), np.max(np.abs(gauge(u, np.array(gg[:L])) - u2)))
report("gauge action in the new coordinates (w_i -> g_1 w_i g_{i+1}^-1, h -> g_1 h g_1^-1)", w_act, 1e-13)
report("inverse of u -> (w, h)", w_inv, 1e-13)
report("conjugate holonomies => gauge equivalent (explicit g, closes around the ring)", w_orbit, 1e-12)
# (w_1, ..., w_{L-1}, h) is Haar^L distributed: a few joint moments by Monte Carlo
n = 1_000_000
uu = [haar_random(n) for _ in range(L)]
ww = chain(uu)
tr = [2.0 * x[:, 0] for x in ww]
tests = (("E[chi_1(h)^2] = 1", eval_chebyu(2, ww[L - 1][:, 0]) ** 2, 1.0),
         ("E[Tr(w_2) Tr(h)] = 0", tr[1] * tr[L - 1], 0.0),
         ("E[Tr(w_1) Tr(h) Tr(w_1^-1 h)] = 1/2", tr[0] * tr[L - 1] * 2.0 * qmul(ww[0] * conj, ww[L - 1])[:, 0], 0.5),
         ("E[Tr(w_3)^2 Tr(h)^2] = 1", tr[2] ** 2 * tr[L - 1] ** 2, 1.0),
         ("E[Tr(w_2 w_4^-1 h)^2 Tr(w_4)^2] = 1", (2.0 * qmul(qmul(ww[1], ww[3] * conj), ww[L - 1])[:, 0]) ** 2 * tr[3] ** 2, 1.0))
for name, vals, target in tests:
    m, e = vals.mean(), vals.std() / math.sqrt(n)
    ok = abs(m - target) < 4 * e
    ok_all &= ok
    print("  Haar^L moments of (w, h): %-40s MC = %+.4f +- %.4f  %s" % (name, m, e, "ok" if ok else "FAIL"))

print("ALL OK" if ok_all else "SOME CHECK FAILED")
