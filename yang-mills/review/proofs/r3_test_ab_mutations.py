"""Mutation check of tests/test_proofs_ab.py.

Each mutation perturbs ONE formula in a temporary copy of the test file (the file itself is not
touched) and runs the tests that should notice.  A mutation is "killed" if at least one of
those tests then fails.  A control run of the same selection on the unmodified copy must pass.

    cd yang-mills && python3 review/proofs/r3_test_ab_mutations.py

Numerical evidence that the tests have power; not a proof of anything.
"""
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, "tests", "test_proofs_ab.py")
TMP = os.path.join(ROOT, "tests", "test_zz_mutant_tmp.py")

MUTATIONS = [
    ("eigenvalue ratio with I_(2j+2) instead of I_(2j+1) (Stelling B, point 2)",
     "return (special.ive(np.arange(nrep) + 1, beta) / special.ive(1, beta)) ** L",
     "return (special.ive(np.arange(nrep) + 2, beta) / special.ive(1, beta)) ** L",
     "B7 or B8_engine_polyakov_correlator_and_plaquette_quick"),
    ("gauge transformation with the wrong neighbour g_(x-i) (section 2.1)",
     "out[..., i, :, :] = g @ u[..., i, :, :] @ inv(np.roll(g, -1, axis=i))",
     "out[..., i, :, :] = g @ u[..., i, :, :] @ inv(np.roll(g, 1, axis=i))",
     "A4 or A5"),
    ("c_j = (2 d_j/beta) I_(2j+2) instead of I_(2j+1) (formula (3.1))",
     "closed2 = 2.0 * nu / beta * special.iv(nu, beta)",
     "closed2 = 2.0 * nu / beta * special.iv(nu + 1, beta)",
     "B1"),
    ("formula (2.7) with 3 c/C instead of c/C",
     "    eps = c / C\n", "    eps = 3.0 * c / C\n", "remark_2_7"),
    ("formula (2.7) with 30 c/C instead of c/C",
     "    eps = c / C\n", "    eps = min(0.999, 30.0 * c / C)\n", "remark_2_7"),
    ("character chi_1/2 = cos(theta) instead of 2 cos(theta) (fusion rule)",
     'return np.einsum("t,at,bt->ab", w * 2.0 * np.cos(t), ch, ch)',
     'return np.einsum("t,at,bt->ab", w * 1.0 * np.cos(t), ch, ch)',
     "B7"),
    ("time-plaquette weight exp(beta/2 ...) instead of exp(beta ...) in the Z2 laboratory",
     "B += np.exp(beta * ((sig * s[None, :]) @ sig.T))",
     "B += np.exp(0.5 * beta * ((sig * s[None, :]) @ sig.T))",
     "A2_z2_d3_time_links"),
    ("M = exp(-V) instead of exp(-V/2) (section 2.2)",
     "self.M = np.diag(np.exp(-0.5 * self.V))",
     "self.M = np.diag(np.exp(-1.0 * self.V))",
     "A1_z2_ring or A2_z2_d3_smallest"),
    ("kernel K with the sign of beta reversed (positivity, step 3)",
     "Kg = np.exp(0.5 * beta * A.real)",
     "Kg = np.exp(-0.5 * beta * A.real)",
     "A3"),
    ("partition function with I_(2j+2) instead of I_(2j+1) (Stelling B, point 4)",
     "terms = n_plaq * (math.log(2.0 / beta) + beta + np.log(special.ive(nu, beta)))",
     "terms = n_plaq * (math.log(2.0 / beta) + beta + np.log(special.ive(nu + 1, beta)))",
     "B7 or B_point_4"),
]


def run(source, select):
    with open(TMP, "w", encoding="utf-8") as fh:
        fh.write(source)
    try:
        r = subprocess.run([sys.executable, "-m", "pytest", TMP, "-q", "-x", "-k", select,
                            "-p", "no:cacheprovider"], cwd=ROOT, capture_output=True, text=True)
    finally:
        os.remove(TMP)
    last = [line for line in r.stdout.strip().splitlines() if line.strip()][-1]
    return r.returncode, last


def main():
    with open(SRC, encoding="utf-8") as fh:
        source = fh.read()
    killed = survived = 0
    for what, old, new, select in MUTATIONS:
        if source.count(old) != 1:
            raise SystemExit("mutation target occurs %d times: %r" % (source.count(old), old))
        code0, last0 = run(source, select)
        if code0 != 0:
            raise SystemExit("control run failed for selection %r: %s" % (select, last0))
        code, last = run(source.replace(old, new), select)
        verdict = "KILLED" if code != 0 else "SURVIVES"
        killed += code != 0
        survived += code == 0
        print("%-8s %s\n         control: %s\n         mutant:  %s" % (verdict, what, last0, last))
    print("%d mutants: %d killed, %d survive" % (len(MUTATIONS), killed, survived))


if __name__ == "__main__":
    main()
