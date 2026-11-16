"""Mutation checks for tests/test_proofs_c.py (round 2).

For each mutant one formula under test is deliberately perturbed IN A COPY of the test source
held in memory (the file on disk is not touched), and the named test functions are called
directly.  The mutants labelled DOC change one printed number in the text of BEWIJZEN.md as the
tests read it (again in memory only): the tests must then fail, which shows that they are tied to
the document.  A mutant is "killed" if at least one of them raises AssertionError.  Mutants that are
expected to survive are included on purpose: they show where a bound of the document is far from
sharp in the Z2 laboratory, so that the tests can only detect gross errors there.

Run from yang-mills/:   python3 review/proofs/r2_test_c_mutations.py      (about 15 seconds)
Exit status 0 if every mutant behaves as listed in the column "expected".
"""
import sys
import time
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEST = ROOT / "tests" / "test_proofs_c.py"
SRC = TEST.read_text(encoding="utf-8")

# (label, [(old, new), ...], [(test function, args), ...], expected)
MUTANTS = [
    ("C1  Lemma C.1 with tanh(osc/4.2) instead of tanh(osc/4)",
     [("bound = np.tanh((phi.max(axis=1) - phi.min(axis=1)) / 4.0)",
       "bound = np.tanh((phi.max(axis=1) - phi.min(axis=1)) / 4.2)")],
     [("test_c1_lemma_c1_random_tilts", ())], "killed"),
    ("C1  identity with (s a + b)^2 instead of (s a - b)^2",
     [("assert s * s * a + b - (s + 1) ** 2 * a * b == (s * a - b) ** 2",
       "assert s * s * a + b - (s + 1) ** 2 * a * b == (s * a + b) ** 2")],
     [("test_c1_algebraic_identities_of_the_proof", ())], "killed"),
    ("C1  (TV2) with 0.9 osc(F) d_TV",
     [("rhs = (F.max() - F.min()) * 0.5 * np.abs(nu - nup).sum()",
       "rhs = 0.9 * (F.max() - F.min()) * 0.5 * np.abs(nu - nup).sum()")],
     [("test_c1_fact_tv2", ())], "killed"),
    ("C2  layer distance claimed >= t + 1",
     [("assert dB[A].min() >= t\n", "assert dB[A].min() >= t + 1\n")],
     [("test_c2_time_coordinate_and_layer_distance", ((3, 3), 6))], "killed"),
    ("C2  d(k,B) claimed >= r + 2 - rho(k)",
     [("assert dB[l] >= r + 1 - rho_link((x, mu))", "assert dB[l] >= r + 2 - rho_link((x, mu))")],
     [("test_c2_cube_embedding_of_point_3", (2, 2))], "killed"),
    ("C2  lifting claimed already for L >= 2 r0 + 3 (r = r0 instead of r0 + n)",
     [("    r = r0 + n\n", "    r = r0\n")],
     [("test_c2_lifting_argument_of_point_3", ("CASE:D=2 r0=3 opposite edges",))], "killed"),
    ("C2  lifting claimed for L >= 2r+1 (r = r0 + n - 1): threshold is not sharp",
     [("    r = r0 + n\n", "    r = r0 + n - 1\n")],
     [("test_c2_lifting_argument_of_point_3", ("CASE:D=2 r0=3 opposite edges",)),
      ("test_c2_lifting_argument_of_point_3", ("CASE:D=2 r0=2 opposite corners",))], "survives"),
    ("C3  SU(2) coefficient claimed <= 0.4 tanh(beta)",
     [("assert tv <= math.tanh(beta) + 1e-12, (D, beta, tv)",
       "assert tv <= 0.4 * math.tanh(beta) + 1e-12, (D, beta, tv)")],
     [("test_c3_su2_dependency_coefficient_random_configurations", ())], "killed"),
    ("C3  small-beta slope 1/2 instead of 4/(3 pi)",
     [("    slope = 4 / (3 * math.pi)\n", "    slope = 0.5\n")],
     [("test_c3_numbers_quoted_in_sections_4_1_and_4_6", ())], "killed"),
    ("C3  5(D-1) neighbours instead of 6(D-1) in the sum at beta_0(D)",
     [("        nb = 6 * (D - 1)\n", "        nb = 5 * (D - 1)\n")],
     [("test_c3_numbers_quoted_in_sections_4_1_and_4_6", ())], "killed"),
    ("C4  alpha = 5(D-1) tanh(beta)",
     [("    return 6 * (D - 1) * math.tanh(beta)\n", "    return 5 * (D - 1) * math.tanh(beta)\n")],
     [("test_c4_dobrushin_coefficients_z2_3x3", (0.05,))], "killed"),
    ("C4  Lemma C.5 with tanh(0.95 beta n_lk)",
     [("assert (c <= np.tanh(beta * nm) + FP).all()", "assert (c <= np.tanh(0.95 * beta * nm) + FP).all()")],
     [("test_c4_dobrushin_coefficients_z2_3x3", (0.05,))], "killed"),
    ("C4/C5  Dobrushin coefficients computed a factor 2 too small",
     [("tv = 0.5 * np.abs(c[tuple(ia)] - c[tuple(ib)]).sum(axis=la)",
       "tv = 0.25 * np.abs(c[tuple(ia)] - c[tuple(ib)]).sum(axis=la)")],
     [("test_c5_lemma_c2_z2_torus", (0.10,))], "killed"),
    ("C5  Lemma C.2 with 0.95 c_lk",
     [("rhs = df + c[l] * df[l]", "rhs = df + 0.95 * c[l] * df[l]")],
     [("test_c5_lemma_c2_z2_torus", (0.10,))], "killed"),
    ("C5  Lemma C.3(a) with (1 - 0.9 lambda)",
     [("Wf - (1.0 - lam) * w[l] * df[l] + FP * scale", "Wf - (1.0 - 0.9 * lam) * w[l] * df[l] + FP * scale")],
     [("test_c5_general_framework_on_other_systems", ("potts", (0.2, 0.5, 0.8)))], "killed"),
    ("C5  Lemma C.3(b) with (1 - 0.5 lambda)",
     [("assert ((1.0 - lam) * np.cumsum(w[seq] * seq_d) <= Wf + FP * scale).all()",
       "assert ((1.0 - 0.5 * lam) * np.cumsum(w[seq] * seq_d) <= Wf + FP * scale).all()")],
     [("test_c5_general_framework_on_other_systems", ("potts", (0.2, 0.5, 0.8))),
      ("test_c5_general_framework_on_other_systems", ("ising", (0.1, 0.25, 0.4)))], "killed"),
    ("C5  Lemma C.3(c) with 0.95 lambda",
     [('assert WS <= lam * Wf + FP * scale, "C.3(c)"', 'assert WS <= 0.95 * lam * Wf + FP * scale, "C.3(c)"')],
     [("test_c5_general_framework_on_other_systems", ("potts", (0.2, 0.5, 0.8)))], "killed"),
    ("C5  proof of C.3(c): w.(A_n...A_1 e_j) <= 0.95 lambda w_j",
     [("assert w @ x <= lam * w[j] + FP * (1.0 + w.sum())", "assert w @ x <= 0.95 * lam * w[j] + FP * (1.0 + w.sum())")],
     [("test_c5_lemma_c3_and_c4_z2_torus_unit_weights", (0.10,))], "killed"),
    ("C5  Lemma C.4 with alpha^(n+1)",
     [("assert err <= al ** nn * Df + FP * scale", "assert err <= al ** (nn + 1) * Df + FP * scale")],
     [("test_c5_lemma_c3_and_c4_z2_torus_unit_weights", (0.05,))], "killed"),
    ("C6  (4.2) with 0.9 delta_l(h)",
     [("assert diff <= dl + FP", "assert diff <= 0.9 * dl + FP")],
     [("test_c6_step_2_of_the_proof", ("six scattered links",))], "killed"),
    ("C6  Propositie C.6 with C_theta / 100",
     [("    return math.exp(theta) / (1.0 - lam)\n", "    return 0.01 * math.exp(theta) / (1.0 - lam)\n")],
     [("test_c6_proposition_c6_on_the_3x3_torus", (0.10,))], "killed"),
    ("C6  Propositie C.6 with C_theta / 10: the bound is not sharp in the laboratory",
     [("    return math.exp(theta) / (1.0 - lam)\n", "    return 0.1 * math.exp(theta) / (1.0 - lam)\n")],
     [("test_c6_proposition_c6_on_the_3x3_torus", (0.10,))], "survives"),
    ("C6  Propositie C.6 with decay e^{-3 theta d(k,B)}: the decay RATE is not tested sharply (Z2)",
     [("                rhs = c_theta(al, theta) * float(np.exp(-theta * dist[R]) @ df)\n                assert lhs <= rhs + FP, (name, fname, theta, lhs, rhs)",
       "                rhs = c_theta(al, theta) * float(np.exp(-3 * theta * dist[R]) @ df)\n                assert lhs <= rhs + FP, (name, fname, theta, lhs, rhs)")],
     [("test_c6_proposition_c6_on_the_3x3_torus", (0.05,)), ("test_c6_proposition_c6_on_the_3x3_torus", (0.15,))],
     "survives"),
    ("C6  argument of C.6 on Ising graphs with C_theta / 10",
     [("    return math.exp(theta) / (1.0 - lam)\n", "    return 0.1 * math.exp(theta) / (1.0 - lam)\n")],
     [("test_c6_argument_of_proposition_c6_on_ising_graphs", ())], "killed"),
    ("C6  Ising graphs with decay e^{-3 theta d(k,B)}: the decay rate is not tested sharply there either",
     [("                    rhs = c_theta(al, theta) * float(np.exp(-theta * dist[R]) @ df)\n                    assert lhs <= rhs + FP\n",
       "                    rhs = c_theta(al, theta) * float(np.exp(-3 * theta * dist[R]) @ df)\n                    assert lhs <= rhs + FP\n")],
     [("test_c6_argument_of_proposition_c6_on_ising_graphs", ())], "survives"),
    ("C6  tree: decay e^{-2 theta d(k,B)}",
     [("tree_rhs = c_theta(al, theta) * float(np.exp(-theta * dist[R]) @ df)",
       "tree_rhs = c_theta(al, theta) * float(np.exp(-2 * theta * dist[R]) @ df)")],
     [("test_c6_decay_rate_of_proposition_c6_on_a_tree", ())], "killed"),
    ("C6  tree: decay e^{-1.5 theta d(k,B)}: sensitivity limit of the tree test",
     [("tree_rhs = c_theta(al, theta) * float(np.exp(-theta * dist[R]) @ df)",
       "tree_rhs = c_theta(al, theta) * float(np.exp(-1.5 * theta * dist[R]) @ df)")],
     [("test_c6_decay_rate_of_proposition_c6_on_a_tree", ())], "survives"),
    ("C7  point 1 with osc(g)/200",
     [("first = c_theta(al, theta) * osc(g) / 2.0 *", "first = c_theta(al, theta) * osc(g) / 200.0 *")],
     [("test_c7_covariance_bound_on_the_3x3_torus", (0.10,))], "killed"),
    ("C7  point 1 with osc(g)/20: the bound is not sharp in the laboratory",
     [("first = c_theta(al, theta) * osc(g) / 2.0 *", "first = c_theta(al, theta) * osc(g) / 20.0 *")],
     [("test_c7_covariance_bound_on_the_3x3_torus", (0.10,))], "survives"),
    ("C8  closed form (L+1) ln coth(beta) for the D = 2 gap",
     [("assert abs(m - L * math.log(1.0 / math.tanh(beta))) <= 2 * tol1",
       "assert abs(m - (L + 1) * math.log(1.0 / math.tanh(beta))) <= 2 * tol1")],
     [("test_c8_gap_d2_rings", (3,))], "killed"),
    ("C8  point 2 with 6 ln(1/alpha)",
     [("    return math.log(1.0 / alpha(beta, D))\n", "    return 6 * math.log(1.0 / alpha(beta, D))\n")],
     [("test_c8_gap_d2_rings", (3,))], "killed"),
    ("C8  point 2 with 3 ln(1/alpha): the bound is not sharp in the laboratory",
     [("    return math.log(1.0 / alpha(beta, D))\n", "    return 3 * math.log(1.0 / alpha(beta, D))\n")],
     [("test_c8_gap_d2_rings", (3,)), ("test_c8_gap_d3_spatial_torus_3x3", (0.02,))], "survives"),
    ("C9  lower bounds of the table rounded to nearest instead of down",
     [("assert round(lb * 1e4) == math.floor(units)", "assert round(lb * 1e4) == round(units)")],
     [("test_c9_table_4_1_row", ("ROW:%d" % i,)) for i in range(9)], "killed"),
    ("C9  closed form of beta_0 with (6D-4)/(6D-7)",
     [("        assert abs(b0 - 0.5 * math.log((6 * D - 5) / (6 * D - 7))) <= 1e-15",
       "        assert abs(b0 - 0.5 * math.log((6 * D - 4) / (6 * D - 7))) <= 1e-15")],
     [("test_c9_beta0_values_and_closed_form", ())], "killed"),
    ("C9  u = I_1/I_0 instead of I_2/I_1 in the leading strong-coupling gap",
     [("ln_u = math.log(special.iv(2, 0.03) / special.iv(1, 0.03))",
       "ln_u = math.log(special.iv(1, 0.03) / special.iv(0, 0.03))")],
     [("test_c9_remark_leading_strong_coupling_gap", ())], "killed"),
    ("C9  threshold alpha = 1/e computed with 12 e instead of 18 e",
     [("bstar = math.atanh(1.0 / (18 * math.e))", "bstar = math.atanh(1.0 / (12 * math.e))")],
     [("test_c9_section_5_3_correlation_length_bound", ())], "killed"),
    ("C9  exact gap of Stelling B per link with I_0/I_1",
     [("per_link = math.log(special.iv(1, 0.1) / special.iv(2, 0.1))",
       "per_link = math.log(special.iv(0, 0.1) / special.iv(1, 0.1))")],
     [("test_c9_remark_toets_aan_stelling_b", ())], "killed"),
    ("C10 point 3 with e^{-50 theta (r+1-r0)}: consistency check only (left side ~ tanh(beta)^45)",
     [("rhs = c_theta(al, theta) * Df * math.exp(-theta * (r + 1 - r0))",
       "rhs = c_theta(al, theta) * Df * math.exp(-50 * theta * (r + 1 - r0))")],
     [("test_c10_infinite_volume_limit_d2", (0.15,))], "survives"),
    ("C10 infinite-volume covariance with C_theta / 200",
     [("    return math.exp(theta) / (1.0 - lam)\n", "    return 0.005 * math.exp(theta) / (1.0 - lam)\n")],
     [("test_c10_point_1_for_the_infinite_volume_state", ())], "killed"),
]

READ = '    return DOC.read_text(encoding="utf-8")\n'


def doc(label, printed, changed, tests):
    """a mutant that changes one printed number of BEWIJZEN.md as the tests read it."""
    return ("DOC " + label,
            [(READ, '    return DOC.read_text(encoding="utf-8").replace(%r, %r)\n' % (printed, changed))],
            tests, "killed")


MUTANTS += [
    doc("table: 0,5141 printed as 0,5142 (rounded to nearest)", "| 0,5980 | 0,5141 |", "| 0,5980 | 0,5142 |",
        [("test_c9_table_4_1_row", ("ROW:1",))]),
    doc("table: 1,4272 printed as 1,4273 (the error found in round 1)", "| 0,2400 | 1,4272 |", "| 0,2400 | 1,4273 |",
        [("test_c9_table_4_1_row", ("ROW:3",))]),
    doc("table: alpha 0,8993 printed as 0,8994", "| 0,8993 |", "| 0,8994 |", [("test_c9_table_4_1_row", ("ROW:8",))]),
    doc("19,6 printed as 19,7", "19{,}6", "19{,}7", [("test_c9_remark_leading_strong_coupling_gap", ())]),
    doc("14,7 printed as 14,6", "14{,}7", "14{,}6", [("test_c9_remark_leading_strong_coupling_gap", ())]),
    doc("0,0204 printed as 0,0205", "0{,}0204", "0{,}0205", [("test_c9_section_5_3_correlation_length_bound", ())]),
    doc("0,26 printed as 0,27", "0{,}26", "0{,}27", [("test_c9_section_5_3_doubling_of_the_correlation_length", ())]),
    doc("0,42 beta printed as 0,43 beta", "0{,}42\\ \\beta", "0{,}43\\ \\beta",
        [("test_c3_numbers_quoted_in_sections_4_1_and_4_6", ())]),
    doc("sum 0,43 printed as 0,45", "ongeveer $0{,}43$ is", "ongeveer $0{,}45$ is",
        [("test_c3_numbers_quoted_in_sections_4_1_and_4_6", ())]),
    doc("2,4 beta_0 printed as 2,5 beta_0", "2{,}4\\ \\beta_0(D)", "2{,}5\\ \\beta_0(D)",
        [("test_c3_numbers_quoted_in_sections_4_1_and_4_6", ())]),
    doc("beta_0(4) printed as 0,0557", "0{,}0556", "0{,}0557", [("test_c9_beta0_values_and_closed_form", ())]),
    doc("11,07 printed as 11,08", "11{,}07", "11{,}08", [("test_c9_remark_toets_aan_stelling_b", ())]),
]


def load(replacements):
    src = SRC
    for old, new in replacements:
        assert src.count(old) >= 1, f"pattern not found: {old[:70]!r}"
        src = src.replace(old, new)
    mod = types.ModuleType("test_proofs_c_mutant")
    mod.__file__ = str(TEST)
    exec(compile(src, str(TEST), "exec"), mod.__dict__)
    return mod


def resolve(mod, args):
    """arguments given as 'CASE:<name>' / 'ROW:<i>' are looked up in the module's own tables."""
    out = []
    for a in args:
        if isinstance(a, str) and a.startswith("CASE:"):
            a = next(c for c in mod.C2_LIFT_CASES if c[0] == a[5:])
        elif isinstance(a, str) and a.startswith("ROW:"):
            a = mod.TABLE_4_1[int(a[4:])]
        out.append(a)
    return out


def main():
    sys.path.insert(0, str(ROOT))
    t00 = time.time()
    # the unmutated source must pass every test used below
    base = load([])
    used = sorted({(name, args) for _, _, tests, _ in MUTANTS for name, args in tests}, key=repr)
    for name, args in used:
        getattr(base, name)(*resolve(base, args))
    print(f"unmutated source: {len(used)} test calls pass ({time.time() - t00:.1f} s)\n")
    bad = 0
    for label, repl, tests, expected in MUTANTS:
        t0 = time.time()
        mod = load(repl)
        killed_by = []
        for name, args in tests:
            try:
                getattr(mod, name)(*resolve(mod, args))
            except AssertionError:
                killed_by.append(name)
        outcome = "killed" if killed_by else "survives"
        flag = "" if outcome == expected else "   <-- NOT AS EXPECTED"
        bad += outcome != expected
        print(f"{outcome:8s} (expected {expected:8s}) {label}  [{time.time() - t0:.1f} s]{flag}")
    print(f"\n{len(MUTANTS)} mutants, {bad} not as expected, {time.time() - t00:.1f} s")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
