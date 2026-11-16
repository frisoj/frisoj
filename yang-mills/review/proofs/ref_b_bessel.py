"""Referee check of BEWIJZEN.md, Stelling B: Lemma B.1, point 3 and point 5.

Run from the repository root:  python3 review/proofs/ref_b_bessel.py

Checks:
  1. The facts quoted from S6: power series, integral representation, recurrence, the two
     derivative relations (by an independent high-order finite difference of the power series).
  2. The Riccati equation (3.2) for r = I_{n+1}/I_n and Lemma B.1 (0 < r < 1) on a grid.
  3. The expansion (3.3): x * ln(I_1/I_nu) -> (nu^2-1)/2, with next term (nu^2-1)/(4x).
  4. Point 5: (E_j - E_0)/a -> (g^2 l/2) j(j+1) for a = l/L, beta = 4/(g^2 a^2); the
     convergence is NOT uniform in j in the relative sense (so the 2-epsilon argument is needed),
     but sup_j |q_j(L) - q_j| -> 0 for N = round(tau L / l).
"""
import math
import numpy as np
from scipy.special import iv, ive

ok_all = True


def report(name, value, tol):
    global ok_all
    ok = abs(value) <= tol
    ok_all &= ok
    print("  %-66s %.3e  (tol %.0e)  %s" % (name, value, tol, "ok" if ok else "FAIL"))


def series(n, x, terms=80):
    """Power series of S6, summed directly (independent of scipy)."""
    return sum((x / 2.0) ** (2 * k + n) / (math.factorial(k) * math.factorial(k + n)) for k in range(terms))


def dseries(n, x, terms=80):
    """Term-by-term derivative of the power series."""
    return sum((2 * k + n) / 2.0 * (x / 2.0) ** (2 * k + n - 1) / (math.factorial(k) * math.factorial(k + n))
               for k in range(terms) if 2 * k + n > 0)


print("1. Facts quoted in S6")
xg, wg = np.polynomial.legendre.leggauss(300)
TH, W = 0.5 * np.pi * (xg + 1), 0.5 * np.pi * wg
w1 = w2 = w3 = w4 = w5 = 0.0
for n in range(0, 9):
    for x in (0.03, 0.4, 1.0, 2.5, 7.0, 15.0):
        s = series(n, x)
        w1 = max(w1, abs(s - iv(n, x)) / s)
        # quadrature rounding error is ~1e-16 * I_0(x), so compare in units of I_0(x)
        w2 = max(w2, abs(np.sum(W * np.exp(x * np.cos(TH)) * np.cos(n * TH)) / np.pi - s) / series(0, x))
        if n >= 1:
            w3 = max(w3, abs(series(n - 1, x) - series(n + 1, x) - 2 * n / x * s) / s)
            w5 = max(w5, abs(dseries(n, x) - (series(n - 1, x) - n / x * s)) / s)
        w4 = max(w4, abs(dseries(n, x) - (series(n + 1, x) + n / x * s)) / s)
report("power series vs scipy iv, n = 0..8", w1, 1e-12)
report("integral representation (1/pi) int e^{x cos} cos(n theta), / I_0", w2, 1e-13)
report("recurrence I_{n-1} - I_{n+1} = (2n/x) I_n, n >= 1", w3, 1e-10)
report("derivative I_n' = I_{n+1} + (n/x) I_n, n >= 0", w4, 1e-10)
report("derivative I_n' = I_{n-1} - (n/x) I_n, n >= 1", w5, 1e-10)

print("2. Riccati equation (3.2) and Lemma B.1")
worst_ric, max_r, min_r = 0.0, 0.0, 1.0
for n in range(0, 12):
    for x in np.concatenate([np.logspace(-3, 1.5, 200)]):
        r = series(n + 1, x) / series(n, x)
        # derivative of r from the term-by-term derivatives of the two series
        rp = dseries(n + 1, x) / series(n, x) - r * dseries(n, x) / series(n, x)
        worst_ric = max(worst_ric, abs(rp - (1 - r * r - (2 * n + 1) / x * r)))
for n in range(0, 60):
    x = np.logspace(-6, 6, 4001)
    x = x[ive(n + 1, x) > 1e-280]                 # skip points where I_{n+1}(x) underflows
    r = ive(n + 1, x) / ive(n, x)
    max_r, min_r = max(max_r, r.max()), min(min_r, r.min())
report("max |r' - (1 - r^2 - (2n+1) r / x)|, n = 0..11, x in [1e-3, 31.6]", worst_ric, 1e-9)
print("  r = I_{n+1}/I_n on x in [1e-6, 1e6] (no underflow), n = 0..59:  min = %.3e > 0,  max = %.9f < 1  %s"
      % (min_r, max_r, "ok" if 0 < min_r and max_r < 1 else "FAIL"))
ok_all &= (0 < min_r and max_r < 1)
x = np.array([1e-4, 1e-3])
report("r(x) -> 0 as x -> 0: r(x) - x/(2(n+1)) for n = 3", np.max(np.abs(ive(4, x) / ive(3, x) - x / 8)), 1e-9)

print("3. Expansion (3.3):  ln(I_1/I_nu) = (nu^2-1)/(2x) + (nu^2-1)/(4x^2) + O(x^-3)")
print("   nu     x        x*ln(I1/Inu)   (nu^2-1)/2   x^2*[ln - (nu^2-1)/(2x)]   (nu^2-1)/4")
for nu in (2, 3, 4, 7):
    for x in (1e2, 1e3, 1e4):
        ln = np.log(ive(1, x) / ive(nu, x))
        print("   %-5d  %-7g  %.8f     %-10g   %.6f                   %g"
              % (nu, x, x * ln, (nu * nu - 1) / 2, x * x * (ln - (nu * nu - 1) / (2 * x)), (nu * nu - 1) / 4))
    x = 1e4
    report("nu=%d: |x ln(I1/Inu) - (nu^2-1)/2| at x = 1e4 (expected ~ (nu^2-1)/(4x))" % nu,
           x * np.log(ive(1, x) / ive(nu, x)) - (nu * nu - 1) / 2, 1.5 * (nu * nu - 1) / (4 * x))

print("4. Point 5: continuum limit, a = l/L, beta = 4/(g^2 a^2)")
for g, ell in ((1.0, 1.0), (0.7, 3.0)):
    print("   g = %g, l = %g:  (E_j - E_0)/a  for 2j = 1, 2, 3, 6 ; limit (g^2 l/2) j(j+1) = %s"
          % (g, ell, "  ".join("%.6f" % (g * g * ell / 2 * (t / 2) * (t / 2 + 1)) for t in (1, 2, 3, 6))))
    for L in (4, 16, 64, 256, 1024, 4096):
        a = ell / L
        beta = 4.0 / (g * g * a * a)
        vals = [(L / a) * np.log(ive(1, beta) / ive(t + 1, beta)) for t in (1, 2, 3, 6)]
        print("     L = %-5d beta = %-12.4g %s" % (L, beta, "  ".join("%.6f" % v for v in vals)))
    L = 4096
    a = ell / L
    beta = 4.0 / (g * g * a * a)
    report("L = 4096: |m/a - (3/8) g^2 l|", (L / a) * np.log(ive(1, beta) / ive(2, beta)) - 0.375 * g * g * ell, 1e-6)

print("   non-uniformity in j (g = l = 1): ratio (E_j-E_0)/a / [(1/2) j(j+1)] at j = L and j = L^2")
for L in (8, 16, 32):
    a = 1.0 / L
    beta = 4.0 / (a * a)
    out = []
    for j in (float(L), float(L * L)):
        val = (L / a) * (np.log(ive(1, beta)) - np.log(ive(2 * j + 1, beta)))
        out.append(val / (0.5 * j * (j + 1)))
    print("     L = %-4d  j = L: %.6f    j = L^2: %.6f   (the O(a^4) in the proof is for FIXED j only;"
          " for j = beta/4 the ratio tends to 0.9806, not to 1)" % (L, out[0], out[1]))
# uniform (Debye) asymptotics for nu/x = z: ln I_nu(x) ~ x [sqrt(1+z^2) - z asinh z]; z = 1/2 gives
# ln(I_1/I_nu) / (nu^2/(2x)) -> (1 - sqrt(1.25) + 0.5 asinh(0.5)) / 0.125 = 0.98058
ok_all &= abs(out[1] - 1) > 0.01 and abs(out[1] - (1 - np.sqrt(1.25) + 0.5 * np.arcsinh(0.5)) / 0.125) < 2e-3

print("   operator norm sup_j |q_j(L) - q_j| for three admissible sequences N(L) with N a -> tau:")


def supnorm(g, ell, tau, L, N):
    a = ell / L
    beta = 4.0 / (g * g * a * a)
    twoj = np.arange(0, 6000)
    with np.errstate(divide="ignore", under="ignore"):
        lam = ive(twoj + 1, beta) / ive(1, beta)
        qL = np.where(lam > 0, lam, 0.0) ** (L * N)
    q = np.exp(-tau * g * g * ell / 2 * (twoj / 2) * (twoj / 2 + 1))
    assert np.all(np.diff(q) <= 0)
    if N >= 1:
        assert np.all(np.diff(qL) <= 0)            # decreasing in j (Lemma B.1); false for N = 0
    return np.max(np.abs(qL - q))


Ls = (20, 40, 80, 160, 320, 640, 1280, 2560)
for g, ell, tau in ((1.0, 1.0, 1.0), (1.0, 1.0, 0.05), (2.0, 0.5, 0.3)):
    for label, rule in (("N = round(tau L/l)", lambda L: int(round(tau * L / ell))),
                        ("N = floor(tau L/l) + 3", lambda L: int(np.floor(tau * L / ell)) + 3),
                        ("N = ceil(tau L/l + sqrt(L))", lambda L: int(np.ceil(tau * L / ell + np.sqrt(L))))):
        sups = [supnorm(g, ell, tau, L, rule(L)) for L in Ls]
        print("     g=%g l=%g tau=%-4g %-28s %s" % (g, ell, tau, label, "  ".join("%.1e" % v for v in sups)))
        # the rate depends on how fast N a -> tau (the theorem only claims convergence to 0)
        ok = all(sups[i + 1] < sups[i] for i in range(len(sups) - 1)) and sups[-1] < 0.35 * sups[0]
        ok_all &= ok
        print("        decreasing along this list of L, last < 0.35 x first: %s   (|N a - tau| at L=2560: %.1e)"
              % ("ok" if ok else "FAIL", abs(rule(Ls[-1]) * ell / Ls[-1] - tau)))
print("   (with N = 0, i.e. before N a is close to tau, q_j(L) = 1 for all j and the sup is 1:)")
print("     g=1 l=1 tau=0.05, L=4, N=round(0.2)=0: sup = %.3f" % supnorm(1.0, 1.0, 0.05, 4, 0))

print("ALL OK" if ok_all else "SOME CHECK FAILED")
