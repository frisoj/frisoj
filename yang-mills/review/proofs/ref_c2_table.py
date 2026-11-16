#!/usr/bin/env python3
"""Referee C2 -- BEWIJZEN.md sections 0, 4.1, 4.6, 5.3: recompute every number.

  * beta_0(D) = artanh(1/(6(D-1))) and the closed form (1/2) ln((6D-5)/(6D-7));
  * the table of section 4.1 (alpha and ln(1/alpha)), compared with the printed values;
  * section 4.6 "Toets aan stelling B": 3 * ln(I1(0.1)/I2(0.1)) and ln(1/(6 tanh 0.1));
  * section 4.1 "in de orde van 20": leading strong-coupling estimates at D = 4, beta = 0.03;
  * section 5.3 "verdubbelt telkens als beta met ongeveer 0,26 toeneemt";
  * section 5.3 "correlatielengte een kleine fractie van een roosterafstand": what Stelling C itself gives;
  * section 5.3 "de ondergrens van die kern gaat exponentieel naar nul met het aantal links":
    in D = 2 the normalised kernel T(u,u')/lambda_0 = sum_j (Lambda_j/Lambda_0) chi_j(h) chi_j(h')
    has minimum (at h = 1, h' = -1) tending to 1, not to 0, as L grows.

Run:  python3 review/proofs/ref_c2_table.py      (from yang-mills/; < 1 s)
"""
import math

from scipy.special import iv

printed_beta0 = {2: "0,1682", 3: "0,0835", 4: "0,0556"}
printed = [  # D, beta, alpha, bound  (as printed in the table of section 4.1)
    (2, 0.05, "0,2998", "1,2048"), (2, 0.10, "0,5980", "0,5142"), (2, 0.15, "0,8933", "0,1128"),
    (3, 0.02, "0,2400", "1,4273"), (3, 0.05, "0,5995", "0,5117"), (3, 0.08, "0,9580", "0,0430"),
    (4, 0.01, "0,1800", "1,7148"), (4, 0.03, "0,5398", "0,6165"), (4, 0.05, "0,8993", "0,1062"),
]


def nl(x, nd=4):
    return f"{x:.{nd}f}".replace(".", ",")


print("beta_0(D): artanh(1/(6(D-1)))  vs  (1/2) ln((6D-5)/(6D-7))  vs printed")
ok = True
for D in range(2, 9):
    a = math.atanh(1.0 / (6 * (D - 1)))
    b = 0.5 * math.log((6 * D - 5) / (6 * D - 7))
    p = printed_beta0.get(D, "-")
    match = (p == "-") or (nl(a) == p)
    ok &= match and abs(a - b) < 1e-15
    print(f"  D={D}: {a:.10f}  {b:.10f}  diff {abs(a-b):.1e}  rounded {nl(a)}  printed {p}  {'OK' if match else 'MISMATCH'}")
    # alpha < 1 exactly when beta < beta_0
    assert 6 * (D - 1) * math.tanh(a * (1 - 1e-12)) < 1 < 6 * (D - 1) * math.tanh(a * (1 + 1e-12))
print("  all beta_0 OK:", ok)

print("\ntable of section 4.1")
ok = True
for D, beta, pa, pb in printed:
    alpha = 6 * (D - 1) * math.tanh(beta)
    bound = math.log(1 / alpha)
    m = (nl(alpha) == pa) and (nl(bound) == pb)
    ok &= m
    print(f"  D={D} beta={beta:.2f}: alpha = {alpha:.8f} (printed {pa}), ln(1/alpha) = {bound:.8f} (printed {pb})  "
          f"{'OK' if m else 'MISMATCH'}   beta < beta_0: {beta < math.atanh(1/(6*(D-1)))}")
print("  all table entries OK:", ok)

print("\nsection 4.6, test against Stelling B (D = 2, beta = 0.1, L = 3)")
r = math.log(iv(1, 0.1) / iv(2, 0.1))
print(f"  ln(I1/I2)(0.1) = {r:.6f} (printed 3,689);  3 * that = {3*r:.4f} (printed 11,07);  "
      f"ln(1/(6 tanh 0.1)) = {math.log(1/(6*math.tanh(0.1))):.4f} (printed 0,514)")
print("  exact D=2 gap  L*ln(I1/I2)  versus bound over the whole range (L = 3, the worst case):")
for beta in (0.01, 0.05, 0.10, 0.15, 0.168):
    print(f"    beta={beta:.3f}: exact = {3*math.log(iv(1,beta)/iv(2,beta)):8.4f}   bound = {math.log(1/(6*math.tanh(beta))):7.4f}")

print("\nsection 4.1, 'in de orde van 20' (D = 4, beta = 0.03); u = I2/I1")
u = iv(2, 0.03) / iv(1, 0.03)
print(f"  u = {u:.6f};  -ln u = {-math.log(u):.4f};  glueball, leading order: -4 ln u = {-4*math.log(u):.3f}")
for L in (3, 4, 5):
    print(f"  flux loop winding around a spatial direction of extent {L} (leading order): -{L} ln u = {-L*math.log(u):.3f}")
print("  => on a spatial lattice with smallest extent 3 the leading-order gap of Stelling A is ~14.7, not ~19.6")

print("\nsection 5.3, doubling of the correlation length: xi ~ 1/(a Lambda_L)")
c = 3 * math.pi ** 2 / 11
print(f"  asymptotically: ln2 / (3 pi^2/11) = {math.log(2)/c:.4f}")
for beta in (2.2, 2.5, 5.0, 10.0):
    slope = c - (51 / 121) / beta
    # exact solution of xi(beta + d) = 2 xi(beta)
    lo, hi = 0.0, 1.0
    f = lambda d: c * d - (51 / 121) * math.log((beta + d) / beta) - math.log(2)
    for _ in range(80):
        mid = 0.5 * (lo + hi)
        if f(mid) > 0:
            hi = mid
        else:
            lo = mid
    print(f"  at beta = {beta}: Delta beta for a factor 2 = {lo:.4f}")

print("\nsection 5.3, correlation length 1/m from Stelling C alone (bound 1/ln(1/alpha)), D = 4")
print(f"  alpha < 1/e  <=>  beta < artanh(1/(18 e)) = {math.atanh(1/(18*math.e)):.5f}")
for beta in (0.01, 0.02, 0.03, 0.05, 0.055):
    a = 18 * math.tanh(beta)
    uu = iv(2, beta) / iv(1, beta)
    print(f"  beta={beta}: 1/ln(1/alpha) = {1/math.log(1/a):8.3f} lattice spacings;  leading strong coupling 1/(-4 ln u) = {1/(-4*math.log(uu)):.4f}")

print("\nsection 5.3 / remark after Stelling A: T(u,u')/lambda_0 in D = 2 (SU(2), ring of L links):")
print("  value at h = 1, h' = -1, and the rigorous lower bound 1 - sum_{j>=1/2} d_j^2 (Lambda_j/Lambda_0) valid for all (u,u')")
for beta in (0.1, 1.0, 2.5):
    row = []
    for L in (3, 6, 12, 24):
        val, low = 1.0, 1.0
        for twoj in range(1, 400):
            d = twoj + 1
            ratio = iv(d, beta) / iv(1, beta)
            if ratio <= 0:
                break
            val += ((-1) ** twoj) * d * d * ratio ** L       # chi_j(1) chi_j(-1) = (-1)^(2j) d_j^2
            low -= d * d * ratio ** L
        row.append(f"L={L}: {val:.6f} (>= {low:.6f})")
    print(f"  beta={beta}: " + ", ".join(row))
print("  => tends to 1 with growing L: in D = 2 the lower bound of the kernel does NOT go to zero")
