"""Round 2, literature referee: numerical side-checks for BEWIJZEN.md sections 5.1, 5.3 and appendix S6.

Run from /home/user/frisoj/yang-mills:  python3 review/proofs/r2_lit_checks.py
Deterministic, no random numbers, runs in about a second.

1. Section 5.1: the printed two-loop formula equals ym.exact.a_lambda_two_loop and the table of
   THEORY.md section 4.5.
2. Section 5.3: "doubles each time beta grows by about 0.26 (about 0.27 near beta = 2.4)".
3. Appendix S6: power series, integral representation, recurrence, both derivative relations and the
   large-argument asymptotics of I_n (DLMF 10.25.2, 10.32.3, 10.29.1, 10.29.2, 10.40.1).
"""
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))

from scipy.integrate import quad
from scipy.optimize import brentq
from scipy.special import iv, ive, ivp

from ym.exact import a_lambda_two_loop

ok = True


def check(name, cond, detail=""):
    global ok
    ok = ok and bool(cond)
    print(("PASS " if cond else "FAIL ") + name + (("  " + detail) if detail else ""))


# 1. formula of section 5.1 against the code and the THEORY.md table -------------------------------
def printed(beta):
    return (6 * math.pi ** 2 * beta / 11) ** (51 / 121) * math.exp(-3 * math.pi ** 2 * beta / 11)


theory_table = {2.2: 0.007597, 2.3: 0.005914, 2.4: 0.004600, 2.5: 0.003576}
dev = max(abs(printed(b) / a_lambda_two_loop(b) - 1) for b in (0.5, 2.4, 10.0, 100.0))
check("5.1 formula == ym.exact.a_lambda_two_loop", dev < 1e-14, "max rel dev %.1e" % dev)
dev = max(abs(printed(b) - v) for b, v in theory_table.items())
check("5.1 formula == THEORY.md 4.5 table (6 decimals)", dev < 5.1e-7, "max abs dev %.1e" % dev)

# 2. doubling of 1/(a Lambda_L) ----------------------------------------------------------------------
asym = 11 * math.log(2) / (3 * math.pi ** 2)


def doubling(beta):
    return brentq(lambda d: math.log(printed(beta) / printed(beta + d)) - math.log(2), 1e-3, 1.0)


check("5.3 asymptotic doubling step rounds to 0.26", round(asym, 2) == 0.26, "%.4f" % asym)
check("5.3 doubling step at beta = 2.4 rounds to 0.27", round(doubling(2.4), 2) == 0.27,
      "%.4f" % doubling(2.4))
check("5.3 doubling step tends to the asymptotic value", abs(doubling(200.0) - asym) < 5e-4,
      "%.4f at beta = 200" % doubling(200.0))

# 3. appendix S6 --------------------------------------------------------------------------------------
worst = 0.0
for n in range(0, 7):
    for x in (0.3, 1.0, 2.4, 9.0, 25.0):
        ref = iv(n, x)
        term = (x / 2) ** n / math.factorial(n)                 # k = 0 term of the power series
        series = 0.0
        for k in range(120):
            series += term
            term *= (x / 2) ** 2 / ((k + 1) * (k + 1 + n))
        integral = quad(lambda t: math.exp(x * (math.cos(t) - 1)) * math.cos(n * t), 0, math.pi,
                        epsabs=1e-12, epsrel=1e-11, limit=200)[0] / math.pi * math.exp(x)
        errs = [abs(series / ref - 1), abs(integral - ref) / ref if n <= 3 else 0.0,
                abs(ivp(n, x) - (iv(n + 1, x) + n / x * ref)) / ref]
        if n >= 1:
            errs.append(abs(iv(n - 1, x) - iv(n + 1, x) - 2 * n / x * ref) / ref)
            errs.append(abs(ivp(n, x) - (iv(n - 1, x) - n / x * ref)) / ref)
        worst = max(worst, max(errs))
check("S6 series / integral / recurrence / derivatives", worst < 1e-9, "max rel dev %.1e" % worst)

worst = 0.0
for n in (0, 1, 2, 3, 5):
    for x in (200.0, 800.0, 3200.0):
        scaled = ive(n, x) * math.sqrt(2 * math.pi * x)          # I_n(x) sqrt(2 pi x) e^{-x}
        second = (scaled - (1 - (4 * n * n - 1) / (8 * x))) * x * x
        exact_second = (4 * n * n - 1) * (4 * n * n - 9) / 128   # next DLMF coefficient a_2(n)
        worst = max(worst, abs(second - exact_second) / (1 + abs(exact_second)) * (x / 200.0))
check("S6 asymptotics: remainder is O(x^-2) with the DLMF coefficient", worst < 0.3,
      "scaled dev %.2e" % worst)
lhs = math.log(iv(1, 400.0) / iv(4, 400.0))
check("(3.3) ln(I_1/I_nu) ~ (nu^2-1)/(2x)", abs(lhs * 800.0 / 15 - 1) < 0.02, "ratio %.4f" % (lhs * 800.0 / 15))

print("ALL PASS" if ok else "SOME CHECK FAILED")
