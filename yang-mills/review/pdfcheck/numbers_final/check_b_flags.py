#!/usr/bin/env python3
"""v2, new: (a) every 'geen plateau' / 'geen meting' cell of appendix B against the flags in the JSON,
counted per analysis from the PDF text (independent of the row parser of check_b.py);
(b) the role sentence printed under each heading against what the data say;
(c) the round in the heading against results/summary.json and round3_plan / run scripts are not used."""
import json, re, os, sys
ROOT = "/home/user/frisoj/yang-mills"
QA = "/tmp/claude-0/-home-user-frisoj/c2e79863-26e2-54ce-9b2d-e39a90258140/scratchpad/qa"
ENS = ["d3_b6.0_L16", "d3_b6.0_L24", "d3_b9.0_L24", "d3_b9.0_L24r", "d3_b9.0_L24_combined",
       "d3_b12.0_L32", "d4_b2.3_L10", "d4_b2.4_L12", "d4_b2.4_L16", "d4_b2.5_L16", "d4_b2.5_L16x",
       "d4_b2.5_L16_combined", "d4_b2.5_L20"]
src = sys.argv[1] if len(sys.argv) > 1 else "pdf_layout.txt"
pages = open(os.path.join(QA, "numbers-v4", src), encoding="utf-8").read().split("\f")
start = [i for i, p in enumerate(pages) if "Bijlage B: de uitslagen per analyse" in p and "Inhoud" not in p][0]
end = [i for i, p in enumerate(pages) if "Bijlage C: vingerafdrukken" in p and "Inhoud" not in p][0]
text = "\n".join(pages[start:end])
heads = [(m.start(), m.group(1)) for m in re.finditer(r"^\s*(d[34]_b[\d.]+_L\d+\w*): D = ", text, flags=re.M)]
assert [h[1] for h in heads] == ENS, [h[1] for h in heads]
summary = json.load(open(os.path.join(ROOT, "results", "summary.json")))
nok = nbad = 0
def chk(cond, msg):
    global nok, nbad
    if cond: nok += 1
    else:
        nbad += 1; print("MISMATCH", msg)
data = {n: json.load(open(os.path.join(ROOT, "results", n + ".json"))) for n in ENS}
tot_gp = tot_gm = 0
for k, (pos, name) in enumerate(heads):
    blk = " ".join(text[pos:(heads[k + 1][0] if k + 1 < len(heads) else len(text))].split())
    d = data[name]
    g, t, st, r = d["glueball"], d["torelon"], d["string_tension"], d["ratios"]
    exp_gp = int(not g["plateau"]) + int(not t["plateau"])
    exp_gm = 2 * int(bool(st["upper_bound_only"])) + int(bool(r["upper_bound_only"]))
    got_gp = blk.count("geen plateau")
    got_gm = blk.count("geen meting")
    got_ub = blk.count("is alleen een bovengrens")
    tot_gp += got_gp; tot_gm += got_gm
    chk(got_gp == exp_gp, f"{name}: 'geen plateau' printed {got_gp}, JSON flags give {exp_gp}")
    chk(got_ub == exp_gp, f"{name}: 'alleen een bovengrens' printed {got_ub}, JSON flags give {exp_gp}")
    chk(got_gm == exp_gm, f"{name}: 'geen meting' printed {got_gm}, JSON flags give {exp_gm}")
    # flags must be mutually consistent in the JSON
    chk(g["plateau"] != g["upper_bound_only"] and t["plateau"] != t["upper_bound_only"], f"{name}: plateau/upper_bound flags")
    chk(bool(st["upper_bound_only"]) == (not t["plateau"]), f"{name}: string_tension.upper_bound_only vs torelon.plateau")
    chk(bool(r["upper_bound_only"]) == (bool(st["upper_bound_only"]) or not g["plateau"]), f"{name}: ratios.upper_bound_only vs parts")
    # the warning list of the JSON says the same
    w = [x for x in d.get("warnings", []) if "upper bound" in x or "no plateau" in x]
    chk(len(w) == exp_gp, f"{name}: {len(w)} no-plateau warnings in JSON vs {exp_gp} flags")
    # the m/sqrt(sigma) row, R5 cell, literally
    m = re.search(r"m/√σ \(Nambu–Goto\) (geen meting|\S+)", blk)
    cell = m.group(1)
    if r["upper_bound_only"]:
        chk(cell == "geen meting", f"{name}: m/√σ R5 cell is {cell!r}, expected 'geen meting'")
    else:
        chk(re.fullmatch(r"\d+\.\d+\(\d+\)", cell) is not None, f"{name}: m/√σ R5 cell is {cell!r}, expected a value")
    print(f"{name:22s} plateau g/t = {g['plateau']!s:5}/{t['plateau']!s:5} st.ub = {st['upper_bound_only']!s:5} ratios.ub = {r['upper_bound_only']!s:5}"
          f" | pdf: geen plateau x{got_gp}, geen meting x{got_gm}, m/√σ R5 cell = {cell}")

    # ---- role sentence
    role = re.search(r", ronde \S+ (.*?)\. Metingen:", blk).group(1)
    e = summary["ensembles"][name]
    seeds = [s["seed"] for s in d["streams"]]
    def other(n): return data[n]
    if role == "Vooraf vastgelegd rooster" or role.startswith("Vooraf vastgelegd rooster;"):
        chk(str(e["round"]) == "1", f"{name}: role 'vooraf vastgelegd' but round {e['round']}")
        if "niet gerepliceerd" in role:
            chk(name == "d3_b9.0_L24", f"{name}: 'niet gerepliceerd' on unexpected analysis")
    elif role.startswith("Volumecontrole van "):
        o = re.match(r"Volumecontrole van (\S+?)(,|$)", role).group(1)
        od = other(o)
        chk(od["D"] == d["D"] and od["beta"] == d["beta"] and od["shape"] != d["shape"]
            and max(d["shape"][1:]) > max(od["shape"][1:]), f"{name}: volume check of {o}: D/beta/shape")
        if "vooraf vastgelegd criterium" in role:
            chk(str(e["round"]) == "3", f"{name}: criterion wording but round {e['round']}")
    elif role.startswith("Herhaling van ") or role.startswith("Meer statistiek voor "):
        o = re.search(r"(?:van|voor) (\S+) met nieuwe seeds", role).group(1)
        od = other(o)
        chk(od["D"] == d["D"] and od["beta"] == d["beta"] and od["shape"] == d["shape"]
            and not set(seeds) & {s["seed"] for s in od["streams"]}, f"{name}: repeat of {o}: same lattice, disjoint seeds")
    elif role.startswith("Samengevoegde analyse van "):
        a, b = re.match(r"Samengevoegde analyse van (\S+) en (\S+); geen extra data", role).groups()
        sa = [(s["seed"], s["start"], s["n_meas"]) for s in other(a)["streams"]]
        sb = [(s["seed"], s["start"], s["n_meas"]) for s in other(b)["streams"]]
        chk(sorted(sa + sb) == sorted((s["seed"], s["start"], s["n_meas"]) for s in d["streams"])
            and d["n_meas_total"] == other(a)["n_meas_total"] + other(b)["n_meas_total"],
            f"{name}: combined streams != union of {a} and {b}")
    else:
        chk(False, f"{name}: unknown role sentence {role!r}")
    print(f"{'':22s} role: {role}")
print()
print(f"totals in appendix B text: 'geen plateau' x{tot_gp}, 'geen meting' x{tot_gm}")
print("checks passed:", nok, " failed:", nbad)
