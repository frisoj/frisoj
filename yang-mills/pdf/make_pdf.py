#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build REPORT.pdf: title page, verification section, the complete REPORT.md, results per analysis.

Numerical evidence at finite lattice spacing and volume -- NOT a proof of the mass gap.

Nothing in the generated parts is typed in by hand:
  * every count in the verification table is parsed from an evidence file in review/ or
    results/, or computed from results/summary.json (the build stops if a pattern is not found
    or a check did not pass);
  * every number in appendix B is read from results/<ensemble>.json and
    results/independent/<ensemble>.json and formatted with summarize.fmt_ve (a tested function);
  * the body is REPORT.md, unchanged apart from the edits listed in ``report_parts`` and the
    four display formulas, which are typeset with matplotlib's mathtext and placed as vector
    images (their TeX source is kept as the image description).

This script is NOT covered by the test suite.

Usage (from the project directory):   python3 pdf/make_pdf.py
Needs: pandoc, node with the playwright package (Chromium), matplotlib, pypdf.
"""
import hashlib
import html
import io
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BUILD = os.path.join(HERE, "build")
sys.path.insert(0, ROOT)
sys.dont_write_bytecode = True
import summarize as S  # noqa: E402

MONTHS = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus",
          "september", "oktober", "november", "december"]
#: the paths whose last commit is printed as "the state of report, code and results"
CONTENT_PATHS = ["REPORT.md", "results", "ym", "tests", "analyze.py", "summarize.py",
                 "independent_analysis.py", "literature.json"]
#: code that the slow tests could depend on (used to say what changed after they were run)
CODE_PATHS = ["ym", "tests", "analyze.py", "summarize.py", "independent_analysis.py",
              "run_production.py"]


def read(*parts):
    with io.open(os.path.join(ROOT, *parts), encoding="utf-8") as fh:
        return fh.read()


def find(pattern, text, what):
    m = re.search(pattern, text)
    if not m:
        raise SystemExit(f"make_pdf: evidence not found: {what}")
    return m


def git(*args):
    return subprocess.run(["git", *args], cwd=ROOT, check=True, capture_output=True,
                          text=True).stdout.strip()


def nl(x, nd):
    """Number with a decimal comma for running Dutch text."""
    return f"{x:.{nd}f}".replace(".", ",").replace("-", "−")


def nls(x, nd):
    """Signed number with a decimal comma: +0,6 or −2,0."""
    return ("+" if x > 0 else "") + nl(x, nd)


def sci_nl(x):
    """3.4e-10 -> '3,4·10⁻¹⁰'."""
    mant, exp = f"{x:.1e}".split("e")
    sup = str(int(exp)).translate(str.maketrans("-0123456789", "⁻⁰¹²³⁴⁵⁶⁷⁸⁹"))
    return mant.replace(".", ",") + "·10" + sup


def fv(value, err):
    """value(error), or an en dash for a missing number."""
    if S.num(value) is None or S.num(err) is None:
        return "–"
    return S.fmt_ve(value, err)


# ==============================================================================================
# formulas
# ==============================================================================================
#: TeX of REPORT.md -> mathtext: commands mathtext does not know, full-size fractions, and thin
#: spaces after the integral and around the sum sign (order matters)
MATHTEXT_SUBS = (("\\lbrace", "\\{"), ("\\rbrace", "\\}"), ("\\gt", ">"),
                 ("\\frac", "\\dfrac"), ("\\tfrac12", "\\frac{1}{2}"),
                 ("\\int d^4x", "\\int\\, d^4x"), ("\\beta\\sum_{p}", "\\beta\\,\\sum_{p}\\,"))


def render_formula(tex, path):
    """Typeset one display formula as an SVG file (glyphs as paths, no fonts needed)."""
    import matplotlib
    matplotlib.use("Agg")
    from matplotlib.backends.backend_svg import FigureCanvasSVG
    from matplotlib.figure import Figure
    src = " ".join(tex.split())
    for old, new in MATHTEXT_SUBS:
        src = src.replace(old, new)
    with matplotlib.rc_context({"svg.fonttype": "path", "svg.hashsalt": "yang-mills-report"}):
        fig = Figure(figsize=(1, 1))
        FigureCanvasSVG(fig)
        fig.text(0, 0, "$" + src + "$", fontsize=11.5, math_fontfamily="cm", color="#1b1d21")
        fig.savefig(path, format="svg", bbox_inches="tight", pad_inches=0.03, transparent=True,
                    metadata={"Date": None, "Creator": None})


def formulas_to_images(text):
    """Replace every $$...$$ block by an image of the typeset formula; returns (text, count)."""
    count = [0]

    def repl(m):
        count[0] += 1
        tex = m.group(1).strip()
        path = os.path.join(BUILD, f"formula_{count[0]}.svg")
        render_formula(tex, path)
        alt = html.escape("formule (TeX): " + " ".join(tex.split()), quote=True)
        return f'\n\n<p class="formula"><img src="file://{html.escape(path)}" alt="{alt}"></p>\n\n'

    out = re.sub(r"\n\$\$\n(.*?)\n\$\$\n", repl, text, flags=re.S)
    if "$" in out:
        raise SystemExit("make_pdf: REPORT.md contains math that was not converted")
    return out, count[0]


# ==============================================================================================
# evidence for the verification table
# ==============================================================================================
def evidence():
    ev = {}
    # ---- row 1: test suite
    t = read("review", "numcheck", "pytest_final_tree.txt")
    m = find(r"(\d+) passed, (\d+) skipped", t, "pytest summary of the final tree")
    ev["passed"], ev["skipped"] = int(m.group(1)), int(m.group(2))
    if "exit=0" not in t or "failed" in t or "error" in t.lower():
        raise SystemExit("make_pdf: the stored test run did not pass")
    slow = 0
    for i in range(4):
        s = read("review", "numcheck", f"slow_out_{i}.txt")
        if "exit=0" not in s or "failed" in s:
            raise SystemExit(f"make_pdf: slow test group {i} did not pass")
        slow += int(find(r"(\d+) passed", s, f"slow test group {i}").group(1))
    ev["slow_passed"] = slow
    if slow != ev["skipped"]:
        raise SystemExit("make_pdf: number of slow tests run differs from the number skipped")
    # what changed in the code after the slow tests were run (they ran before the last commit)
    slow_commit = git("log", "-1", "--format=%H", "--", "review/numcheck/slow_out_0.txt")
    changed = [p for p in git("diff", "--name-only", slow_commit, "HEAD", "--",
                              *CODE_PATHS).split("\n") if p]
    if any(not p.endswith("summarize.py") for p in changed):
        raise SystemExit("make_pdf: code used by the slow tests changed after they were run: "
                         + ", ".join(changed))
    ev["summarize_changed_after_slow"] = bool(changed)

    # ---- row 2: exact two-dimensional results and Schwinger-Dyson identities (test output)
    rp = read("review", "report", "t_rP.txt")
    if not re.search(r"\b14 passed\b", rp):
        raise SystemExit("make_pdf: review/report/t_rP.txt does not show the 14 tests passing")
    dev2 = [float(x) for x in re.findall(r"^\[g\] D=2 .*?dev = ([+-][0-9.]+) sigma", rp, flags=re.M)]
    sd = re.findall(r"^\[SD prod\] (D\d_b[0-9.]+) .*?\(([+-][0-9.]+) sigma\)", rp, flags=re.M)
    if not dev2 or not sd:
        raise SystemExit("make_pdf: exact-2D or Schwinger-Dyson lines not found in t_rP.txt")
    ev["n_2d"], ev["max_2d"] = len(dev2), max(abs(x) for x in dev2)
    ev["sd_couplings"] = len({c for c, _ in sd})
    ev["sd_min"], ev["sd_max"] = min(float(z) for _, z in sd), max(float(z) for _, z in sd)
    if ev["max_2d"] >= 4.0 or max(abs(ev["sd_min"]), abs(ev["sd_max"])) >= 4.0:
        raise SystemExit("make_pdf: an exactness test lies beyond 4 sigma")

    # ---- row 4: independent re-analysis
    c = read("results", "independent", "COMPARISON.md")
    m = find(r"\*\*Mechanical summary\.\*\*\s+(\d+) ensembles\.\s+Largest deviation of any "
             r"compared central value from the pipeline: ([0-9.eE+-]+) pipeline sigma\.\s+"
             r"Flags raised \([^)]*\): ([^\n]*)", c, "summary line of the independent re-analysis")
    ev["n_analyses"], ev["max_dev"] = int(m.group(1)), float(m.group(2))
    ev["flags"] = sum(int(x) for x in re.findall(r" x (\d+)", m.group(3).split(".")[0]))
    if ev["max_dev"] > 1e-6:
        raise SystemExit("make_pdf: the independent re-analysis deviates from the pipeline")

    # ---- row 5: raw data regenerated from the seeds
    hist = read("review", "report", "stats_rerun_a3_hist.txt")
    pairs = re.findall(r"bit-identical: (\d+) of (\d+)", hist)
    if not pairs or any(a != b for a, b in pairs):
        raise SystemExit("make_pdf: regenerated streams are not all bit-identical")
    ev["regen_streams"], ev["regen_meas"] = len(pairs), sum(int(a) for a, _ in pairs)

    # ---- rows 6-9: the number check of the report, re-run on the final text
    out = lambda n: read("review", "numcheck", "out_final", n)  # noqa: E731
    m = find(r"OK count (\d+)\s+mismatches (\d+)", out("check_tables.txt"), "table check")
    ev["cells"], ev["cells_bad"] = int(m.group(1)), int(m.group(2))
    m = find(r"OK count (\d+)\s+mismatches (\d+)", out("check4.txt"), "literature check")
    ev["lit"], ev["lit_bad"] = int(m.group(1)), int(m.group(2))
    tr = out("trace_tokens.txt")
    m = find(r"distinct tokens: (\d+)\s+untraced by literal/pool match: (\d+)", tr, "token trace")
    ev["tokens"], ev["tokens_hand"] = int(m.group(1)), int(m.group(2))
    ev["tokens_pool"] = int(find(r"pool-only \(no literal string in any text source\): (\d+)",
                                 tr, "token trace, pool-only").group(1))
    ev["tokens_literal"] = ev["tokens"] - ev["tokens_hand"] - ev["tokens_pool"]
    m = find(r"t1 meas-A sigma: report ([0-9.]+)\s+computed ([0-9.]+)", out("check3.txt"),
             "round-3 criterion")
    ev["r3_sigma"] = float(m.group(2))
    if ev["cells_bad"] or ev["lit_bad"]:
        raise SystemExit("make_pdf: the number check reports mismatches")
    for name in ("check_tables.txt", "check2.txt", "check3.txt", "check4.txt"):
        if "MISMATCH" in out(name):
            raise SystemExit(f"make_pdf: {name} reports a mismatch")

    # ---- row 10, live: summarize.py reproduces the stored summary
    fresh = json.loads(json.dumps(S.build_summary(os.path.join(ROOT, "results"),
                                                  os.path.join(ROOT, "literature.json"))))
    stored = json.loads(read("results", "summary.json"))
    for key in ("generated_utc", "figures"):      # time stamp; list of figure files (added by main)
        fresh.pop(key, None)
        stored.pop(key, None)
    if fresh != stored:
        raise SystemExit("make_pdf: summarize.py does not reproduce results/summary.json")

    # ---- numbers computed from the summary
    r3 = stored["round3"]
    ev["r3_criterion"] = r3["criterion_sigma"]
    if not r3["verdict"]["reading_A_excluded"]:
        raise SystemExit("make_pdf: the round-3 verdict in summary.json is not 'excluded'")
    if abs(r3["t1"]["measured_minus_A"]["sigma"] - ev["r3_sigma"]) > 0.005:
        raise SystemExit("make_pdf: round-3 significance differs between the two checks")
    ens = stored["ensembles"]
    single = {n: e for n, e in ens.items() if not n.endswith("_combined")}
    ev["n_meas"] = sum(e["n_meas"] for e in single.values())
    ev["n_streams"] = sum(len(e["seeds"]) for e in single.values())
    ev["n_lattices"] = len({(e["D"], e["beta"], tuple(e["shape"])) for e in ens.values()})
    r12 = {n: e for n, e in single.items() if e["round"] in ("1", "2")}
    r3e = {n: e for n, e in single.items() if e["round"] == "3"}
    ev["streams_r12"] = sum(len(e["seeds"]) for e in r12.values())
    ev["meas_r12"] = sum(e["n_meas"] for e in r12.values())
    ev["streams_r3"] = sum(len(e["seeds"]) for e in r3e.values())
    if ev["streams_r12"] + ev["streams_r3"] != ev["n_streams"]:
        raise SystemExit("make_pdf: the rounds do not add up to all streams")
    pulls = [r["pull"]["t1"] for r in stored["literature_comparison"]["rows"]
             if r["quantity"] == "a*m(0++)" and ens[r["ensemble"]]["D"] == 4
             and r["pull"]["t1"] is not None]
    ev["max_lit_pull_d4"] = max(pulls)
    # runs stopped on a time budget: fraction of the configured maximum that was reached
    frac = []
    for n in single:
        if single[n]["round"] not in ("1", "2"):
            continue
        for w in json.loads(read("results", f"{n}.json")).get("warnings", []):
            mm = re.search(r"\((\d+) of (\d+) measurements; reason: maxtime\)", w)
            if mm:
                frac.append(int(mm.group(1)) / int(mm.group(2)))
    ev["maxtime_streams"] = len(frac)
    ev["maxtime_min"], ev["maxtime_max"] = (min(frac), max(frac)) if frac else (None, None)
    return ev


# ==============================================================================================
# document parts
# ==============================================================================================
def report_parts():
    """(preamble, body) of REPORT.md.  Edits: the title lines are dropped (the pdf has its own
    title page); the report's appendix is called 'Bijlage A', also in the two references to it."""
    text = read("REPORT.md")
    for old, new in (("## Bijlage: herkomst van de getallen", "## Bijlage A: herkomst van de getallen"),
                     ("de sleutel staat in de bijlage.", "de sleutel staat in bijlage A."),
                     ("(zie de bijlage)", "(zie bijlage A)")):
        if text.count(old) != 1:
            raise SystemExit(f"make_pdf: expected exactly one occurrence in REPORT.md: {old}")
        text = text.replace(old, new)
    i = text.index("\n## 0. ")
    pre, body = text[:i], text[i + 1:]
    keep = [ln for ln in pre.split("\n")
            if not ln.startswith("# ") and not ln.startswith("**SU(2)-roostersimulaties")
            and ln.strip() != "---"]
    return "\n".join(keep).strip(), body


def title_page(ev, commit, date_nl):
    return f"""<section class="titlepage">
<p class="kicker">Eindrapport met alle uitslagen en verificatie</p>
<p class="doctitle">Yang–Mills en de massakloof</p>
<p class="subtitle">SU(2)-roostersimulaties in 2, 3 en 4 dimensies: wat er gemeten is, hoe het
gecontroleerd is, en wat het wel en niet bewijst</p>
<div class="statusbox">
<p><strong>Het millenniumprobleem is met dit werk niet opgelost, en een massakloof is er niet mee
aangetoond.</strong> Dit document bevat numerieke aanwijzingen (uitkomsten van berekeningen) voor
een massakloof in één roostermodel, bij eindige roosterafstand en eindig volume, met statistische
fouten: redelijk in drie dimensies, zwak in vier. Het bevat geen bewijs.</p>
<p><strong>Wat “correct” hier betekent:</strong> de meetuitkomsten in dit document zijn nagerekend
en kloppen met de opgeslagen meetdata. Het betekent niet dat het probleem is opgelost of dat de
natuurkundige conclusies vaststaan. Het hoofdstuk “Verificatie” zegt precies wat wel en wat niet
is bevestigd.</p>
</div>
<table class="meta">
<tr><td>Datum</td><td>{date_nl}</td></tr>
<tr><td>Omvang</td><td>{ev['n_lattices']} roosters, {ev['n_meas']} metingen in {ev['n_streams']} onafhankelijke stromen (meetreeksen)</td></tr>
<tr><td>Stand van de bestanden</td><td>rapport, code en resultaten: git-commit <code>{commit}</code></td></tr>
<tr><td>Opgesteld en gecontroleerd door</td><td>een AI-assistent (Claude Code); door geen mens nagekeken, ook niet door een natuurkundige</td></tr>
</table>
</section>
"""


def verification(ev):
    total = ev["passed"] + ev["skipped"]
    pct = 100.0 * ev["regen_meas"] / ev["meas_r12"]
    rest = ev["streams_r12"] - ev["regen_streams"]
    ok = lambda w: f'<span class="ok">{w}</span>'      # noqa: E731  (a check with a pass/fail outcome)
    done = lambda w: f'<span class="done">{w}</span>'  # noqa: E731  (work that was done; no verdict)
    after_slow = (" Daarna is alleen nog code gewijzigd die een figuur tekent (in `summarize.py`); "
                  "de trage tests gebruiken dat bestand niet."
                  if ev["summarize_changed_after_slow"] else
                  " Daarna is de code niet meer gewijzigd.")
    rows = [
        ("Testsuite van de code", ok("geslaagd"),
         f"{total} tests. Standaardrun op de definitieve code: {ev['passed']} geslaagd, "
         f"{ev['skipped']} overgeslagen (dat zijn de trage tests). De {ev['skipped']} trage tests "
         f"zijn kort daarvoor apart gedraaid: {ev['slow_passed']} geslaagd." + after_slow,
         "`review/numcheck/pytest_final_tree.txt`, `slow_out_0.txt` t/m `slow_out_3.txt`"),
        ("Exact bekende uitkomsten", ok("klopt binnen de fout"),
         "In twee dimensies, waar de uitkomst exact bekend is, geeft de simulatie die uitkomst "
         f"terug binnen de statistische fout: {ev['n_2d']} vergelijkingen, grootste afwijking "
         f"{nl(ev['max_2d'], 1)}σ (de grens was vooraf 4σ). Ze voldoet ook aan de "
         "Schwinger–Dyson-identiteiten (vergelijkingen die bij een goed werkende simulatie "
         f"moeten gelden) bij de {ev['sd_couplings']} waarden van β waarbij is gemeten, getest op "
         f"kleine roosters: afwijkingen tussen {nls(ev['sd_min'], 1)}σ en "
         f"{nls(ev['sd_max'], 1)}σ (§2).",
         "`tests/`, uitvoer in `review/report/t_rP.txt`"),
        ("Tweede simulatie", ok("klopt"),
         "Een tweede, apart geschreven simulatie geeft op dezelfde toestand van het rooster "
         "dezelfde basisgrootheden (plaquette, Wilson-lussen, Polyakov-lussen, actie) tot op "
         "10⁻¹², en beide simulaties geven statistisch dezelfde gemiddelden in 2, 3 en 4 "
         "dimensies. Dit is gedaan op kleine testroosters. De productieruns en de glueballmassa's "
         "zijn niet met de tweede simulatie nagerekend (§2).",
         "`tests/test_crosscheck.py` (onderdeel van de testsuite)"),
        ("Tweede analyse", ok("klopt"),
         f"Alle {ev['n_analyses']} analyses zijn opnieuw gerekend uit de ruwe data, met een "
         "tweede programma dat geen code deelt met het eerste. Grootste afwijking van een "
         f"meetwaarde: {sci_nl(ev['max_dev'])} keer de statistische fout, dus afronding. Het "
         "tweede programma volgt dezelfde rekenregels en neemt de blokgrootte van het eerste "
         "over; het controleert dus het rekenwerk, niet de methode (§4.1). Het gaf daarnaast "
         f"{ev['flags']} automatische signaleringen; de belangrijkste zijn besproken in §4.2 tot "
         "en met §4.4.",
         "`results/independent/COMPARISON.md`"),
        ("Herkomst van de ruwe data (steekproef)", ok("klopt (steekproef)"),
         f"Het begin van {ev['regen_streams']} van de {ev['streams_r12']} stromen van ronde 1 en "
         "2 is opnieuw gegenereerd uit de startgetallen (seeds). Alle "
         f"{ev['regen_meas']} metingen die zo opnieuw zijn gemaakt, zijn bit voor bit gelijk aan "
         f"de opgeslagen data. Dat is {nl(pct, 1)} % van de {ev['meas_r12']} metingen van ronde "
         f"1 en 2. De andere {rest} stromen en de {ev['streams_r3']} stromen van ronde 3 zijn "
         "niet opnieuw gegenereerd (§2, §4.5).",
         "`review/report/stats_rerun_a3_hist.txt`"),
        ("Tabellen tegen de bestanden", ok("klopt"),
         "Elke cel van de tabellen in §0 en §3.2 en van de resultaattabel in `THEORY.md` is "
         f"vergeleken met de resultaatbestanden: {ev['cells']} cellen, {ev['cells_bad']} "
         "afwijkingen. Opnieuw gedraaid op de definitieve tekst.",
         "`review/numcheck/out_final/check_tables.txt`"),
        ("Rekenwerk van de literatuurvergelijking", done("nagerekend"),
         f"{ev['lit']} waarden en verschillen nagerekend, de meeste in §4.8 en een deel in §3.4 "
         f"en §3.5: {ev['lit_bad']} rekenfouten. Dit zegt niet dat onze uitkomsten met de "
         "literatuur overeenstemmen: in vier dimensies liggen de glueballmassa's tot "
         f"{nl(ev['max_lit_pull_d4'], 1)}σ boven gepubliceerde waarden (§4.8). De "
         "literatuurwaarden zelf zijn niet in de artikelen nagekeken (zie hieronder).",
         "`review/numcheck/out_final/check4.txt`"),
        ("Getallen in de lopende tekst", done("teruggevonden"),
         f"Het rapport bevat {ev['tokens']} verschillende getallen met een fout erbij. "
         f"{ev['tokens_literal']} daarvan staan letterlijk in een projectbestand; "
         f"{ev['tokens_pool']} zijn alleen via een zwakkere getalsvergelijking met de "
         f"resultaatbestanden gevonden; {ev['tokens_hand']} zijn met de hand opgezocht in de "
         "testuitvoer. Teruggevonden betekent dat het getal een bron heeft, niet dat het opnieuw "
         "is uitgerekend.",
         "`review/numcheck/out_final/trace_tokens.txt`"),
        ("Rekenwerk van fits, volumevergelijkingen en ronde 3", done("nagerekend"),
         "De getallen van §3.4, §3.5 en §4.5 zijn opnieuw berekend uit de resultaatbestanden en "
         "zijn gelijk aan die in de tekst. Bij het vooraf vastgelegde criterium van ronde 3 ligt "
         f"de meting {nl(ev['r3_sigma'], 1)}σ boven de voorspelling van een kloof die alleen door "
         f"de eindige doos ontstaat; de drempel was {ev['r3_criterion']:g}σ (§4.5). Dat de "
         "sommen kloppen, zegt niet dat de fits goed passen: in vier dimensies past een "
         "constante niet, en de vooraf vastgelegde toets in drie dimensies slaagde niet (§3.4, "
         "§3.5).",
         "`review/numcheck/out_final/check2.txt`, `check3.txt`"),
        ("Samenvatting reproduceerbaar", ok("klopt"),
         "`summarize.py` levert bij het maken van deze pdf opnieuw exact dezelfde getallen op "
         "als in `results/summary.json` staan (het tijdstempel en de lijst met figuurbestanden "
         "blijven buiten de vergelijking).",
         "`pdf/make_pdf.py` (stopt als dit niet klopt)"),
        ("Bijlage B van deze pdf", done("automatisch gevuld"),
         "Alle getallen in bijlage B zijn door het bouwscript rechtstreeks uit "
         "`results/<ensemble>.json` en `results/independent/<ensemble>.json` gezet; geen getal "
         "is overgetypt. Het bouwscript zelf valt buiten de testsuite.",
         "`pdf/make_pdf.py`"),
        ("Tekst nagelopen op te sterke beweringen", done("nagelopen"),
         "In een aparte controleronde is de tekst van het rapport nagelopen op zinnen die meer "
         "beweren dan de data dragen; zulke zinnen zijn afgezwakt. Daarbij is geen zin gevonden "
         "die een bewijs of een oplossing claimt. Dit is een oordeel van hetzelfde AI-systeem, "
         "geen meting.",
         "`git log -p REPORT.md`"),
    ]
    lines = ["| # | controle | uitkomst | waar het staat |", "|---|---|---|---|"]
    for i, (name, status, outcome, where) in enumerate(rows, 1):
        lines.append(f"| {i} | **{name}** | {status}: {outcome} | {where} |")
    table = "\n".join(lines)
    return f"""## Verificatie: wat “correct” in dit document betekent

Je vroeg om een pdf met alle uitslagen en de bevestiging dat het correct is. Die bevestiging kan voor een deel worden gegeven en voor een deel niet. Wel: de meetuitkomsten in dit document zijn nagerekend en kloppen met de opgeslagen data. Niet: dat het millenniumprobleem is opgelost of dat een massakloof is aangetoond; dat is niet zo. Alle controles zijn gedaan door hetzelfde AI-systeem dat het werk heeft gemaakt; geen mens heeft ze nagekeken. Hieronder staat precies wat wel en wat niet is bevestigd.

### Wat bevestigd is

De meetuitkomsten in dit document (de tabellen in §0 en §3.2 en bijlage B) zijn wat de opgeslagen meetdata opleveren, berekend met geteste code en met een tweede, apart geschreven analyse nagerekend. Voor de literatuurwaarden en een deel van de controlegetallen geldt dat niet (zie “Wat niet bevestigd is”). Elke regel hieronder noemt waar de uitkomst van de controle staat; de aantallen in de derde kolom zijn door het bouwscript uit die bestanden gelezen of uit `results/summary.json` berekend.

{table}

### Wat niet bevestigd is

1. **Dat het millenniumprobleem is opgelost.** Dat is het niet. Het probleem vraagt een wiskundig bewijs over een limiet (roosterafstand naar nul, volume naar oneindig, voor elke toegestane groep). Metingen met foutmarges op eindige roosters zijn geen bewijs, hoe zorgvuldig ze ook zijn nagerekend.
2. **Een oordeel van een mens.** Geen mens heeft dit werk nagekeken, ook geen natuurkundige. Alle controles hierboven zijn uitgevoerd door hetzelfde AI-systeem dat ook de code en het rapport heeft geschreven. Een deel van de controles is opnieuw opgezet zonder de eerdere code te gebruiken, maar ze lezen dezelfde data en volgen dezelfde rekenregels. Zo'n controle kan rekenfouten en te sterke formuleringen vinden; een denkfout in de opzet die het systeem zelf niet ziet, blijft onopgemerkt.
3. **Dat de metingen een massakloof aantonen, in drie of in vier dimensies.** Dat op elk rooster een massa ongelijk aan nul is gemeten, is op een eindig rooster vanzelfsprekend en dus geen bewijsmateriaal. In drie dimensies blijft de massa in natuurlijke eenheden vrijwel gelijk als het rooster fijner wordt, maar de vooraf vastgelegde meting bij β = 9 kwam bij herhaling niet terug; die uitspraak berust dus op een keuze achteraf (§3.4, §4.4). In vier dimensies, het geval van het millenniumprobleem, is alleen uitgesloten dat de kloof evenredig met de doos meekrimpt, en dat alleen bij β = 2,4 en 2,5, telkens met maar twee doosgroottes. De massa in natuurlijke eenheden stijgt daar nog met β (een grotere β is een fijner rooster) in plaats van gelijk te blijven, en er is geen waarde voor roosterafstand nul (§3.5, §5.1).
4. **Overeenstemming met gepubliceerde waarden.** In vier dimensies liggen onze glueballmassa's bij β = 2,4 en 2,5 tot {nl(ev['max_lit_pull_d4'], 1)}σ boven gepubliceerde roosterwaarden; dat verschil is niet verklaard (§4.8). De literatuurwaarden zelf zijn alleen in zoekresultaten gezien of door het AI-systeem uit het geheugen aangehaald, niet in de gepubliceerde artikelen nagekeken.
5. **Andere gevallen dan het gesimuleerde.** Er is alleen de eenvoudigste groep, SU(2), gesimuleerd, met één roosteractie en voor één soort deeltje. Het probleem gaat over elke toegestane groep (§6.1).
6. **Systematische fouten.** Alle foutmarges zijn statistisch. Hoeveel de massa's te hoog kunnen uitvallen door bijmenging van zwaardere toestanden, is niet beter begrensd dan ongeveer 5 tot 10 % in vier dimensies en 2 tot 4 % in drie (§4.7). De foutmarge van een R5-getal is bovendien te klein (§2).
7. **Een deel van de controlegetallen.** Getallen met het label [C1] of [C2] komen uit verkennende scripts van de controleronde; die zijn niet allemaal opnieuw berekend (zie bijlage A).
8. **De nieuwsberichten in §5.2.** Die zijn ongeverifieerd, en de zoekresultaten spreken elkaar tegen.

### In één zin

De getallen in dit document kloppen met de opgeslagen data en het rekenwerk is nagelopen; ze lossen het millenniumprobleem niet op en tonen geen massakloof aan. Wat ze wel zeggen, staat in §0 en §5.
"""


ROLE_NL = {
    "d3_b6.0_L16": "vooraf vastgelegd rooster",
    "d3_b6.0_L24": "volumecontrole van d3_b6.0_L16",
    "d3_b9.0_L24": "vooraf vastgelegd rooster; niet gerepliceerd (§4.4)",
    "d3_b9.0_L24r": "herhaling van d3_b9.0_L24 met nieuwe seeds",
    "d3_b9.0_L24_combined": "samengevoegde analyse van d3_b9.0_L24 en d3_b9.0_L24r; geen extra data",
    "d3_b12.0_L32": "vooraf vastgelegd rooster",
    "d4_b2.3_L10": "vooraf vastgelegd rooster",
    "d4_b2.4_L12": "vooraf vastgelegd rooster",
    "d4_b2.4_L16": "volumecontrole van d4_b2.4_L12",
    "d4_b2.5_L16": "vooraf vastgelegd rooster",
    "d4_b2.5_L16x": "meer statistiek voor d4_b2.5_L16 met nieuwe seeds",
    "d4_b2.5_L16_combined": "samengevoegde analyse van d4_b2.5_L16 en d4_b2.5_L16x; geen extra data",
    "d4_b2.5_L20": "volumecontrole van d4_b2.5_L16, met vooraf vastgelegd criterium (§4.5)",
}
#: appendix B prints the effective masses for t = 0 .. T_MAX_APPENDIX (larger t: in the files)
T_MAX_APPENDIX = 6


def ensemble_block(name):
    d = json.loads(read("results", f"{name}.json"))
    ind = json.loads(read("results", "independent", f"{name}.json"))
    rnd = S.ENSEMBLES[name][0]
    g, t, st = d["glueball"], d["torelon"], d["string_tension"]
    fx = {int(f["t"]): f for f in st["fixed_t"]}
    ratio = d["ratios"]["m_over_sqrt_sigma"]
    iratio = ind["ratios"]["m_over_sqrt_sigma"]["gevp"]

    def r5(block):
        if block.get("plateau"):
            return f"{fv(block['mass'], block['err'])} [t\\* = {block['t_star']}]"
        return (f"geen plateau; {fv(block['mass'], block['err'])} bij t = {block['t_value']} "
                f"is alleen een bovengrens")

    none = "geen meting"
    no_st = bool(st.get("upper_bound_only"))                        # string tension: upper bound only
    no_ratio = no_st or bool(d["ratios"].get("upper_bound_only"))   # the flag sits beside the value
    rows = [
        ["glueball a·m", r5(g), fv(g["fixed_t"]["t1"]["m"], g["fixed_t"]["t1"]["err"]),
         fv(g["fixed_t"]["t2"]["m"], g["fixed_t"]["t2"]["err"])],
        [f"torelon a·E (L = {t['L']})", r5(t),
         fv(t["fixed_t"]["t1"]["m"], t["fixed_t"]["t1"]["err"]),
         fv(t["fixed_t"]["t2"]["m"], t["fixed_t"]["t2"]["err"])],
        ["a√σ (Nambu–Goto)",
         none if no_st else fv(st["nambu_goto"]["a_sqrt_sigma"], st["nambu_goto"]["a_sqrt_sigma_err"]),
         fv(fx[1]["nambu_goto"]["a_sqrt_sigma"], fx[1]["nambu_goto"]["a_sqrt_sigma_err"]),
         fv(fx[2]["nambu_goto"]["a_sqrt_sigma"], fx[2]["nambu_goto"]["a_sqrt_sigma_err"])],
        ["a√σ (Lüscher)",
         none if no_st else fv(st["luscher"]["a_sqrt_sigma"], st["luscher"]["a_sqrt_sigma_err"]),
         fv(fx[1]["luscher"]["a_sqrt_sigma"], fx[1]["luscher"]["a_sqrt_sigma_err"]),
         fv(fx[2]["luscher"]["a_sqrt_sigma"], fx[2]["luscher"]["a_sqrt_sigma_err"])],
        ["m/√σ (Nambu–Goto)",
         none if no_ratio else fv(ratio["nambu_goto"]["value"], ratio["nambu_goto"]["err"]),
         fv(iratio["t1"]["nambu_goto"]["value"], iratio["t1"]["nambu_goto"]["err_jack"]),
         fv(iratio["t2"]["nambu_goto"]["value"], iratio["t2"]["nambu_goto"]["err_jack"])],
    ]
    key = ["| grootheid | R5 (vooraf vastgelegde regel) | vaste t = 1 | vaste t = 2 |",
           "|---|---|---|---|"] + ["| " + " | ".join(r) + " |" for r in rows]

    gm = {r["t"]: r for r in g["meff_table"]}
    tm = {r["t"]: r for r in t["meff_table"]}
    eff = ["| t | glueball m_eff(t) | torelon E_eff(t) |", "|---|---|---|"]
    for tt in range(0, T_MAX_APPENDIX + 1):
        a, b = gm.get(tt), tm.get(tt)
        ca = fv(a["m_cosh"], a["err_cosh"]) if a else "–"
        cb = fv(b["m_cosh"], b["err_cosh"]) if b else "–"
        if ca == "–" and cb == "–":
            continue
        eff.append(f"| {tt} | {ca} | {cb} |")

    streams = ", ".join(f"{s['seed']} ({'warm' if s['start'] == 'hot' else 'koud'}, {s['n_meas']})"
                        for s in d["streams"])
    sc = d["stream_consistency"]
    pl = d["plaquette"]
    beta = d["beta"]
    beta_nl = str(int(beta)) if float(beta).is_integer() else f"{beta:g}".replace(".", ",")
    head = (f"### {name}: D = {d['D']}, β = {beta_nl}, rooster "
            f"{S._sup(S.lattice_label(d['shape']))}, ronde {rnd}")
    role = ROLE_NL[name]
    info = (f"{role[0].upper() + role[1:]}. Metingen: {d['n_meas_total']}, waarvan "
            f"{d['n_meas_used']} gebruikt in {d['n_bins']} bins van {d['binsize']}; langste "
            f"autocorrelatietijd {nl(d['tau_int_max'], 1)} metingen. Stromen (seed, start, "
            f"aantal metingen): {streams}.")
    plaq = (f"Plaquette: {fv(pl['mean'], pl['err'])}. Stromen onderling (plaquette): χ² = "
            f"{nl(sc['plaquette']['chi2'], 1)} bij {sc['plaquette']['dof']} vrijheidsgraden; "
            f"warme min koude starts: {nl(sc['hot_minus_cold']['pull'], 2)}σ.")
    for suffix in ("glueball_meff", "torelon_meff"):
        if not os.path.isfile(os.path.join(ROOT, "results", f"{name}_{suffix}.png")):
            raise SystemExit(f"make_pdf: figure missing for {name}: {suffix}")
    figs = (f'<div class="figrow"><img src="results/{name}_glueball_meff.png" alt="effectieve '
            f'massa glueball, {name}"><img src="results/{name}_torelon_meff.png" '
            f'alt="effectieve energie torelon, {name}"></div>')
    return "\n\n".join(['<div class="ens">', head, info, "\n".join(key), plaq, "\n".join(eff),
                        figs, "</div>"])


def appendix_b(ev):
    budget = ""
    if ev["maxtime_streams"]:
        budget = (" De runs van ronde 1 en 2 zijn op een vast tijdsbudget gestopt, bij "
                  f"{100 * ev['maxtime_min']:.0f} tot {100 * ev['maxtime_max']:.0f} % van het "
                  "ingestelde maximum aantal metingen; de resultaatbestanden melden dat als "
                  "waarschuwing.")
    intro = f"""## Bijlage B: de uitslagen per analyse

Deze bijlage geeft voor elk van de {len(S.TABLE_ORDER)} analyses de hoofduitkomsten: de waarde volgens de vooraf vastgelegde regel R5, de waarden bij vaste t = 1 en t = 2, de effectieve massa's bij t = 0 tot en met {T_MAX_APPENDIX}, de plaquette en de onderlinge consistentie van de stromen. Het zijn {len(S.TABLE_ORDER)} analyses van {ev['n_lattices']} roosters: op twee roosters is twee keer gemeten, en van elk van die paren is er ook een samengevoegde analyse.{budget} Alles wat de analyse verder heeft berekend, staat in `results/<ensemble>.json`.

De getallen zijn door `pdf/make_pdf.py` rechtstreeks uit `results/<ensemble>.json` gezet; de verhouding m/√σ bij vaste t komt uit `results/independent/<ensemble>.json`. Notatie: `0.7263(125)` betekent 0,7263 ± 0,0125, alleen de statistische fout. Het aantal decimalen is zo gekozen dat de fout twee cijfers heeft; daardoor staan sommige getallen hier met een cijfer minder dan in de tabellen van het rapport (hier 1.203(26), daar 1.2035(259)); het is hetzelfde getal, anders afgerond. Een fout met een punt erin, zoals 1.1(1.4), betekent 1,1 ± 1,4.

Hoe je dit leest: de effectieve massa hoort bij grotere t vlak te worden. Dat de waarden bij t = 1 en t = 2 binnen hun fout gelijk zijn, is daarvoor nodig maar bewijst het niet: de fout bij t = 2 is twee tot drie keer zo groot (§4.7). Bij grotere t groeit de fout snel; waarden waarvan de fout bijna zo groot is als de waarde zelf, zeggen niets meer. Alle massa's zijn schattingen die eerder te hoog dan te laag uitvallen (§3.1). Bij de consistentie van de stromen hoort χ² ongeveer gelijk te zijn aan het aantal vrijheidsgraden; een veel grotere waarde wijst op stromen die het onderling niet eens zijn. De analyses met "_combined" in de naam bevatten dezelfde data als de twee analyses die erin zijn samengevoegd.

De figuren tonen per analyse de effectieve massa van de glueball (links) en de effectieve energie van de torelon (rechts) tegen de tijdsafstand t.
"""
    return intro + "\n\n" + "\n\n".join(ensemble_block(n) for n in S.TABLE_ORDER)


def appendix_c(commit, branch):
    def h(*parts):
        with open(os.path.join(ROOT, *parts), "rb") as fh:
            return hashlib.sha256(fh.read()).hexdigest()[:16]
    rows = ["| analyse | `results/<naam>.json` | `results/independent/<naam>.json` |", "|---|---|---|"]
    for n in S.TABLE_ORDER:
        rows.append(f"| {n} | `{h('results', n + '.json')}` | `{h('results', 'independent', n + '.json')}` |")
    other = ["| bestand | SHA-256 (eerste 16 tekens) |", "|---|---|"]
    for parts in (("REPORT.md",), ("literature.json",), ("results", "summary.json"),
                  ("results", "independent", "COMPARISON.md")):
        other.append(f"| `{'/'.join(parts)}` | `{h(*parts)}` |")
    checked = ""
    if os.path.isfile(os.path.join(ROOT, "review", "pdfcheck", "README.md")):
        checked = ("\n\nEen eerdere bouw van deze pdf is in drie afzonderlijke controles nagelopen: "
                   "de getallen tegen de bestanden, elke pagina op opmaak, en de formulering van "
                   "de nieuwe onderdelen. De fouten die daarbij zijn gevonden, zijn hersteld. De "
                   "scripts en uitkomsten van die controles staan in `review/pdfcheck/`.")
    return f"""## Bijlage C: vingerafdrukken en hoe deze pdf is gemaakt

Het rapport, de code en de resultaten in deze pdf zijn die van git-commit `{commit}` op de branch `{branch}`. De controle-uitvoer in `review/numcheck/out_final/` en het bouwscript in `pdf/` zijn daarna toegevoegd, samen met deze pdf. Met de vingerafdrukken hieronder kun je nagaan of een bestand dat je voor je hebt hetzelfde is als het bestand waaruit deze pdf is gemaakt (`sha256sum <bestand>`; vergelijk de eerste 16 tekens).

{chr(10).join(rows)}

{chr(10).join(other)}

De pdf is gemaakt met:

```bash
cd yang-mills
python3 pdf/make_pdf.py        # schrijft REPORT.pdf; heeft pandoc, node met playwright en pypdf nodig
```

Het script zet deze onderdelen achter elkaar: de titelpagina, het hoofdstuk "Verificatie", de volledige tekst van `REPORT.md`, en de bijlagen B en C. Aan de tekst van `REPORT.md` verandert het drie dingen: de titelregels vervallen omdat de pdf een eigen titelpagina heeft; de bijlage van het rapport heet hier "Bijlage A", ook in de twee verwijzingen ernaar; en de vier formules zijn als afbeelding gezet. Het script stopt met een foutmelding als een van de bestanden waaruit het aantallen leest ontbreekt of een afwijking meldt, of als `summarize.py` de opgeslagen samenvatting niet exact reproduceert. Het script zelf valt buiten de testsuite.{checked}
"""


TEMPLATE = """<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="utf-8">
<title>$pagetitle$</title>
$for(header-includes)$
$header-includes$
$endfor$
</head>
<body>
$for(include-before)$
$include-before$
$endfor$
$if(toc)$
<nav id="TOC" role="doc-toc">
$table-of-contents$
</nav>
$endif$
$body$
</body>
</html>
"""


# ==============================================================================================
# table of contents with page numbers (second print pass)
# ==============================================================================================
def destination_pages(pdf_path):
    """{heading id: 1-based page number} from the named destinations of the printed pdf."""
    from urllib.parse import unquote
    from pypdf import PdfReader
    reader = PdfReader(pdf_path)
    pages = {}
    for name, dest in reader.named_destinations.items():
        try:
            pages[unquote(str(name).lstrip("/"))] = reader.get_destination_page_number(dest) + 1
        except Exception:      # a destination without a page: leave it out
            continue
    return pages, len(reader.pages)


def toc_with_pages(page_html, pages):
    """Append the page number to every entry of the table of contents; returns (html, ids)."""
    i, j = page_html.index('<nav id="TOC"'), page_html.index("</nav>")
    ids = []

    def repl(m):
        ids.append(m.group(1))
        n = pages.get(m.group(1))
        return m.group(0) if n is None else (
            f'<a href="#{m.group(1)}"{m.group(2)}><span>{m.group(3)}</span>'
            f'<span class="pg">{n}</span></a>')

    nav = re.sub(r'<a href="#([^"]+)"([^>]*)>(.*?)</a>', repl, page_html[i:j], flags=re.S)
    return page_html[:i] + nav + page_html[j:], ids


def main():
    os.makedirs(BUILD, exist_ok=True)
    ev = evidence()
    commit = git("log", "-1", "--format=%h", "--", *CONTENT_PATHS)
    y, mth, dd = git("log", "-1", "--format=%cs", "--", *CONTENT_PATHS).split("-")
    date_nl = f"{int(dd)} {MONTHS[int(mth) - 1]} {y}"
    branch = git("rev-parse", "--abbrev-ref", "HEAD")
    pre, body = report_parts()
    body, n_formulas = formulas_to_images(body)

    doc = "\n\n".join([
        "## Vooraf en leeswijzer", pre,
        verification(ev), body, appendix_b(ev), appendix_c(commit, branch)])
    paths = {k: os.path.join(BUILD, v) for k, v in (
        ("doc", "document.md"), ("title", "title.html"), ("head", "head.html"),
        ("tpl", "template.html"), ("html0", "REPORT_pass1.html"), ("html", "REPORT.html"))}
    with io.open(paths["doc"], "w", encoding="utf-8") as fh:
        fh.write(doc)
    with io.open(paths["title"], "w", encoding="utf-8") as fh:
        fh.write(title_page(ev, commit, date_nl))
    with io.open(paths["head"], "w", encoding="utf-8") as fh:
        fh.write("<style>\n" + read("pdf", "style.css") + "\n</style>\n")
    with io.open(paths["tpl"], "w", encoding="utf-8") as fh:
        fh.write(TEMPLATE)

    subprocess.run([
        "pandoc", paths["doc"], "-f", "gfm", "-t", "html5", "--standalone",
        "--columns=10000", "--toc", "--toc-depth=2", "--template", paths["tpl"],
        "--metadata", "pagetitle=Yang–Mills en de massakloof: eindrapport met alle uitslagen "
                      "en verificatie",
        "--include-in-header", paths["head"], "--include-before-body", paths["title"],
        "-o", paths["html0"]], check=True, cwd=ROOT)
    # figures: absolute file URLs, so that the html can live in the build directory
    with io.open(paths["html0"], encoding="utf-8") as fh:
        page = fh.read()
    page, n = re.subn(r'src="results/', 'src="file://' + html.escape(ROOT) + '/results/', page)
    with io.open(paths["html0"], "w", encoding="utf-8") as fh:
        fh.write(page)

    out = os.path.join(ROOT, "REPORT.pdf")
    printer = ["node", os.path.join(HERE, "print_pdf.js")]
    # pass 1 finds the page of every section; pass 2 prints them in the table of contents
    subprocess.run(printer + [paths["html0"], out], check=True, cwd=HERE)
    pages, n_pages = destination_pages(out)
    for _ in range(3):
        numbered, ids = toc_with_pages(page, pages)
        missing = [i for i in ids if i not in pages]
        if missing:
            raise SystemExit("make_pdf: no page found for contents entries: " + ", ".join(missing))
        with io.open(paths["html"], "w", encoding="utf-8") as fh:
            fh.write(numbered)
        subprocess.run(printer + [paths["html"], out], check=True, cwd=HERE)
        again, n_pages = destination_pages(out)
        if all(again.get(i) == pages[i] for i in ids):
            break
        pages = again
    else:
        raise SystemExit("make_pdf: page numbers of the contents did not settle")
    print(f"make_pdf: {n_pages} pages, {n} figures, {n_formulas} formulas, "
          f"{len(S.TABLE_ORDER)} analyses in appendix B, commit {commit}, wrote {out}")


if __name__ == "__main__":
    main()
