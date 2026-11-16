"""Second-round referee check of BEWIJZEN.md, Stelling B: Lemma B.1, point 3, point 5, and
the two limits mentioned in section 3.4.

Run from /home/user/frisoj/yang-mills:  python3 review/proofs/ref_b_r2_bessel_limit.py

Independent of ref_b_bessel.py (first round): the ratios r_n(x) = I_{n+1}(x)/I_n(x) are computed
WITHOUT scipy, by the backward (Miller) recurrence that follows from the three-term recurrence
of S6,   I_n - I_{n+2} = (2(n+1)/x) I_{n+1}   =>   r_n = 1 / ( 2(n+1)/x + r_{n+1} ),
started far above the orders needed (an error in the start value is damped by the factor
prod r_k^2 ~ exp(-(n_start^2 - n^2)/x)).  scipy.special.ive is used only as a cross-check.

Checks:
  1. the recurrence-based ratios agree with scipy; the Riccati equation (3.2) (central
     differences of r); r(x) -> 0 for x -> 0.
  2. Lemma B.1: 0 < r_n(x) < 1 on a wide grid; and the sharper facts r_n decreasing in n.
  3. (3.3): ln(I_1/I_nu) = (nu^2-1)/(2x) + (nu^2-1)/(4x^2) + O(x^-3).
  4. Point 5: (E_j - E_0)/a -> (g^2 l/2) j(j+1) with a = l/L, beta = 4/(g^2 a^2); the error is
     (nu^2-1) g^4 l^3 / (64 L^2) to leading order (nu = 2j+1), so NOT uniform in j.
  5. Point 5: sup_j |q_j(L) - q_j| -> 0 for several sequences N(L) with N a -> tau, with the
     explicit size |N a - tau| / (e min(tau, N a)) + g^2 a^2 / (8 e) (1 + o(1)).
  6. Section 3.4: -ln u(beta)/a^2 -> (3/8) g^2;  sup_{j>0} Lambda_j/Lambda_0 = u^L -> 0 for
     L -> infinity at fixed beta (this is the precise content of "only the vacuum remains").
"""
import math
import numpy as np
from scipy.special import ive

ok_all = True


def report(name, value, tol):
    global ok_all
    ok = abs(value) <= tol
    ok_all &= ok
    print("  %-72s %.3e  (tol %.0e)  %s" % (name, value, tol, "ok" if ok else "FAIL"))


def ratios(x, nmax):
    """[r_0(x), ..., r_{nmax-1}(x)],  r_n = I_{n+1}/I_n, by backward recurrence."""
    n_start = nmax + int(8.0 * math.sqrt(x)) + 60
    r = x / (n_start + 1.0 + math.sqrt(x * x + (n_start + 1.0) ** 2))     # rough start value
    out = [0.0] * nmax
    for n in range(n_start - 1, -1, -1):
        r = 1.0 / (2.0 * (n + 1.0) / x + r)
        if n < nmax:
            out[n] = r
    return np.array(out)


def log_ratio_table(x, numax):
    """t[nu] = ln( I_1(x) / I_nu(x) ) for nu = 1 .. numax (t[0] unused)."""
    r = ratios(x, numax)
    t = np.zeros(numax + 1)
    t[2:] = -np.cumsum(np.log(r[1:numax]))
    return t


print("1. recurrence-based ratios; Riccati equation (3.2)")
worst = 0.0
for x in (1e-3, 0.3, 2.5, 40.0, 1e3, 1e5, 3e7):
    r = ratios(x, 40)
    ref = ive(np.arange(1, 41), x) / ive(np.arange(0, 40), x)
    good = ive(np.arange(1, 41), x) > 1e-250
    worst = max(worst, np.max(np.abs(r[good] / ref[good] - 1.0)))
report("max relative difference to scipy ive ratios, n < 40, x in [1e-3, 3e7]", worst, 1e-11)
worst = 0.0
for x in (0.2, 1.0, 3.0, 12.0, 80.0):
    h = 1e-4 * x
    rp = (ratios(x + h, 12) - ratios(x - h, 12)) / (2 * h)
    r = ratios(x, 12)
    n = np.arange(12)
    worst = max(worst, np.max(np.abs(rp - (1 - r * r - (2 * n + 1) / x * r))))
report("Riccati: max |r' - (1 - r^2 - (2n+1) r/x)|, n < 12 (central differences)", worst, 1e-6)
x = 1e-5
report("r_n(x) -> 0 as x -> 0: max |r_n(x) - x/(2(n+1))| at x = 1e-5", np.max(np.abs(ratios(x, 8) - x / (2 * (np.arange(8) + 1)))), 1e-14)

print("2. Lemma B.1: 0 < I_{n+1}(x) < I_n(x)")
rmax, rmin, mono = 0.0, 1.0, True
for x in np.logspace(-4, 6, 61):
    r = ratios(float(x), 80)
    rmax, rmin = max(rmax, r.max()), min(rmin, r.min())
    mono &= bool(np.all(np.diff(r) < 0))
ok = 0.0 < rmin and rmax < 1.0 and mono
ok_all &= ok
print("  n = 0..79, x in [1e-4, 1e6]: min r = %.3e > 0, max r = %.10f < 1, r_n decreasing in n: %s   %s"
      % (rmin, rmax, mono, "ok" if ok else "FAIL"))

print("3. expansion (3.3)")
for nu in (2, 3, 5, 9):
    devs = []
    for x in (1e2, 1e3, 1e4, 1e5):
        t = log_ratio_table(x, nu + 1)[nu]
        devs.append(x * x * (t - (nu * nu - 1) / (2 * x)))
    print("   nu = %d: x^2 [ln(I_1/I_nu) - (nu^2-1)/(2x)] at x = 1e2..1e5: %s   -> (nu^2-1)/4 = %g"
          % (nu, "  ".join("%.5f" % d for d in devs), (nu * nu - 1) / 4))
    report("nu = %d: second-order coefficient at x = 1e5" % nu, devs[-1] - (nu * nu - 1) / 4, 2e-3 * (nu * nu - 1))

print("4. point 5: (E_j - E_0)/a -> (g^2 l/2) j(j+1)")
for g, ell in ((1.0, 1.0), (0.6, 2.5), (3.0, 0.4)):
    print("   g = %g, l = %g; columns 2j = 1, 2, 4, 8; last row = limit" % (g, ell))
    for L in (3, 10, 100, 1000, 10000):
        a = ell / L
        beta = 4.0 / (g * g * a * a)
        t = log_ratio_table(beta, 10)
        print("     L = %-6d beta = %-10.4g %s" % (L, beta, "  ".join("%.8f" % ((L / a) * t[tj + 1]) for tj in (1, 2, 4, 8))))
    print("     %-26s %s" % ("limit", "  ".join("%.8f" % (g * g * ell / 2 * (tj / 2) * (tj / 2 + 1)) for tj in (1, 2, 4, 8))))
    L = 10000
    a = ell / L
    beta = 4.0 / (g * g * a * a)
    t = log_ratio_table(beta, 10)
    report("|m/a - (3/8) g^2 l| at L = 1e4", (L / a) * t[2] - 0.375 * g * g * ell, 1e-6 * g ** 4 * ell ** 3 + 1e-9)
    L = 300
    a = ell / L
    beta = 4.0 / (g * g * a * a)
    t = log_ratio_table(beta, 10)
    for tj in (1, 8):
        nu = tj + 1
        lead = (nu * nu - 1) * g ** 4 * ell ** 3 / 64.0
        got = L * L * ((L / a) * t[nu] - g * g * ell / 2 * (tj / 2) * (tj / 2 + 1))
        report("2j = %d: L^2 * error at L = 300 versus (nu^2-1) g^4 l^3/64 (relative)" % tj, got / lead - 1.0, 2e-2)
print("   (the error grows like nu^2: the convergence is not uniform in j; the proof does not need that)")

print("5. point 5: operator norm  sup_j |q_j(L) - q_j|,  q_j(L) = (Lambda_j/Lambda_0)^N")


def supnorm(g, ell, tau, L, N, numax=700):
    a = ell / L
    beta = 4.0 / (g * g * a * a)
    t = log_ratio_table(beta, numax)[1:]                # nu = 1..numax, i.e. 2j = 0..numax-1
    twoj = np.arange(numax)
    qL = np.exp(-L * N * t)
    q = np.exp(-tau * g * g * ell / 2 * (twoj / 2) * (twoj / 2 + 1))
    assert q[-1] < 1e-200 and np.all(np.diff(q) <= 0)
    if N >= 1:                                          # for N = 0, q_j(L) = 1 for all j
        assert qL[-1] < 1e-200 and np.all(np.diff(qL) <= 0)      # truncation harmless; monotone
    return float(np.max(np.abs(qL - q)))


Ls = (10, 30, 100, 300, 1000, 3000)
for g, ell, tau in ((1.0, 1.0, 1.0), (1.0, 1.0, 0.02), (2.0, 0.5, 0.3)):
    for label, rule in (("N = round(tau/a)", lambda L: int(round(tau * L / ell))),
                        ("N = floor(tau/a) + 5", lambda L: int(math.floor(tau * L / ell)) + 5),
                        ("N = ceil(tau/a + L^0.5)", lambda L: int(math.ceil(tau * L / ell + math.sqrt(L))))):
        sups = [supnorm(g, ell, tau, L, rule(L)) for L in Ls]
        # expected size: sup_x |e^{-(tau+d)x} - e^{-tau x}| <= |d| / (e min(tau, tau+d)) with
        # d = N a - tau, plus the lattice artefact sup_j ~ g^2 a^2 / (8 e) (from check 4),
        # plus 3e-8 for rounding in ln r (r is within 1e-8 of 1 at the largest beta)
        bounds = []
        for L in Ls:
            na = rule(L) * ell / L
            bounds.append(float("inf") if rule(L) < 1 else
                          abs(na - tau) / (math.e * min(tau, na)) + 1.5 * (g * ell / L) ** 2 / (8 * math.e) + 3e-8)
        ok = all(s_ <= b_ for s_, b_ in zip(sups, bounds)) and sups[-1] < sups[-2] < sups[-3]
        ok_all &= ok
        print("   g=%g l=%-3g tau=%-4g %-24s L = 10..3000: %s   %s"
              % (g, ell, tau, label, " ".join("%.1e" % s_ for s_ in sups), "ok" if ok else "FAIL"))
        print("   %54s %s" % ("bound |Na-tau|/(e min) + 1.5 g^2 a^2/(8e):", " ".join("%.1e" % b_ for b_ in bounds)))
print("   remark: for tau = 0.02, L = 10 the rule N = round(tau/a) gives N = 0, (T/Lambda_0)^0 = 1 and the")
print("   distance is 1: sup = %.3f.  The statement needs N >= 1, which holds for all large L since N a -> tau > 0."
      % supnorm(1.0, 1.0, 0.02, 10, 0))

print("6. section 3.4")
g = 1.7
for a in (0.3, 0.1, 0.03, 0.01):
    beta = 4.0 / (g * g * a * a)
    sig = -math.log(ratios(beta, 2)[1]) / (a * a)
    print("   g = %g, a = %-5g: sigma = -ln u(beta)/a^2 = %.8f   (3/8) g^2 = %.8f" % (g, a, sig, 0.375 * g * g))
report("continuum string tension: |sigma - (3/8) g^2| at a = 0.01", sig - 0.375 * g * g, 1e-3)
for beta in (0.5, 2.5, 10.0):
    uu = ratios(beta, 2)[1]
    r = ratios(beta, 60)
    lam = np.concatenate([[1.0], np.cumprod(r[1:])])               # I_{2j+1}/I_1, 2j = 0..59
    vals = []
    for L in (3, 10, 30, 100):
        vals.append(np.max(lam[1:] ** L))                           # = || T/Lambda_0 - |Omega><Omega| ||
        ok_all &= abs(vals[-1] - uu ** L) <= 1e-12 * uu ** L
    print("   beta = %-4g: || T/Lambda_0 - P_Omega || = sup_{j>0} (I_{2j+1}/I_1)^L = u^L for L = 3, 10, 30, 100: %s"
          % (beta, "  ".join("%.3e" % v for v in vals)))
print("   continuum: || exp(-tau H_c) - P_0 || = exp(-(3/8) g^2 l tau) -> 0 for l -> infinity at fixed tau > 0")

print("ALL OK" if ok_all else "SOME CHECK FAILED")
