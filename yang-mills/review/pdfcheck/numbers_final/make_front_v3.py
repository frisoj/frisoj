#!/usr/bin/env python3
"""Derive check_front_v3.py from check_front_v2.py: every replacement must hit exactly once."""
src = open("check_front_v2.py", encoding="utf-8").read()
def rep(old, new, count=1):
    global src
    assert src.count(old) == count, (src.count(old), old[:80])
    src = src.replace(old, new)

rep('"""Build v2: title page', '"""Build v3: title page')
rep('appendix C of REPORT_v2.pdf', 'appendix C of REPORT_v4.pdf') if 'appendix C of REPORT_v2.pdf' in src else rep('appendix C of REPORT_v4.pdf', 'appendix C of REPORT_v4.pdf')

# ---- title page: subtitle and the 'correct' sentence (v3)
rep('chk("title: says not solved / no proof", ("niet opgelost" in p1, "Het bevat geen bewijs" in p1), (True, True))',
    'chk("title: says not solved / no proof", ("niet opgelost" in p1, "Het bevat geen bewijs" in p1), (True, True))\n'
    'chk("title (v3): subtitle ends with \'wat het wel en niet laat zien\' (no \'bewijst\' on the title page)", ("hoe het gecontroleerd is, en wat het wel en niet laat zien" in p1, "bewijst" in p1), (True, False))\n'
    'chk("title (v3): \'correct\' sentence: measurement outcomes recomputed and agree with stored data; not: solved", ("de meetuitkomsten in dit document zijn nagerekend en kloppen met de opgeslagen meetdata. Het betekent niet dat het probleem is opgelost" in p1), True)\n'
    'chk("title (v3): \'door geen mens nagekeken\' on the title page", "door geen mens nagekeken" in p1, True)')

# ---- row 2
rep('''m = need(r"binnen de statistische fout: (\\d+) vergelijkingen, grootste afwijking (\\d+,\\d)σ \\(de grens was vooraf (\\d)σ\\)\\. .*? bij de (\\d+) waarden van β "
         r"waarbij is gemeten, getest op kleine roosters: afwijkingen tussen ([−+]\\d+,\\d)σ en ([−+]\\d+,\\d)σ \\(§2\\)", ver, "row 2")''',
    '''m0 = need(r"binnen de statistische fout: (\\d+) vergelijkingen van plaquette en Wilson-lussen, grootste afwijking (\\d+,\\d)σ; in de (\\w+) andere tests in hetzelfde bestand "
          r"\\(energie van de fluxbuis en een nultest\\) is de grootste afwijking (\\d+,\\d)σ \\(de grens was vooraf (\\d)σ\\)\\. .*? bij de (\\d+) waarden van β "
          r"waarbij is gemeten, getest op kleine roosters: afwijkingen tussen ([−+]\\d+,\\d)σ en ([−+]\\d+,\\d)σ \\(§2\\)", ver, "row 2")
class _M:      # same group numbering as in the v2 script: 1 = 16, 2 = 1,4, 3 = bound, 4 = 6 couplings, 5, 6 = SD range
    def __init__(s, g): s.g = g
    def group(s, i): return s.g[i - 1]
m = _M([m0.group(1), m0.group(2), m0.group(5), m0.group(6), m0.group(7), m0.group(8)])''')
rep('''rep = rd("REPORT.md")
chk("row 2: REPORT.md §2 gives the same SD range"''',
    '''# v3: the row now names the 16 as plaquette + Wilson loops and quotes the two other D=2 tests separately
gq = re.findall(r"^\\[g\\] D=2 beta=\\S+?(?: \\([^)]*\\))?: (P|W\\(\\d,\\d\\)) = ", rp, flags=re.M)
chk("row 2 (v3): the 16 are 4 plaquettes and 12 Wilson loops", (gq.count("P"), sum(1 for q in gq if q.startswith("W"))), (4, 12))
secs = re.split(r"^_{3,} (\\S+) _{3,}$", rp, flags=re.M)      # [pre, name1, body1, name2, body2, ...]
tests_in_file = secs[1::2]
bodies = dict(zip(secs[1::2], secs[2::2]))
d2other = [t for t in tests_in_file if t.startswith("test_d2_")]
chk("row 2 (v3): tests in t_rP.txt: 6 SD production + 2 SD teeth + 4 [g] + the other D=2 tests", (len(tests_in_file), sum(t.startswith("test_schwinger_dyson_at_production") for t in tests_in_file),
    sum(t.startswith("test_schwinger_dyson_test_has_teeth") for t in tests_in_file), sum(t.startswith("test_g_d2_exact") for t in tests_in_file), d2other),
    (14, 6, 2, 4, ["test_d2_torelon_energy_and_string_tension_exact", "test_d2_plaquette_and_null_test"]))
chk("row 2 (v3): 'twee andere tests'", m0.group(3), {2: "twee"}.get(len(d2other)))
op = {t: [float(x) for x in re.findall(r"pull ([+-][0-9.]+)", bodies[t])] for t in d2other}
allp = [x for t in d2other for x in op[t]]
chk("row 2 (v3): every 'pull' in t_rP.txt lies in those two tests", sorted(allp), sorted(other))
mxo = max(abs(x) for x in allp)
print("         pulls: flux-tube energy test n = %d, max |pull| %.2f; null test n = %d, max |pull| %.2f"
      % (len(op[d2other[0]]), max(abs(x) for x in op[d2other[0]]), len(op[d2other[1]]), max(abs(x) for x in op[d2other[1]])))
chk("row 2 (v3): largest |deviation| in the two other tests (%.2f)" % mxo, m0.group(4), f"{mxo:.1f}".replace(".", ","))
tobs = rd("tests", "test_observables.py")
def fbody(name):
    i = tobs.index("def " + name + "("); j = tobs.find("\\ndef ", i + 5); return tobs[i:j if j > 0 else len(tobs)]
b1, b2 = fbody("test_d2_torelon_energy_and_string_tension_exact"), fbody("test_d2_plaquette_and_null_test")
chk("row 2 (v3): bound 4 sigma also in the two other tests (tests/test_observables.py: '< 4.0 *' / '< 4.0'; no other sigma multiple)",
    ("< 4.0 * tor[\\"aE_err\\"]" in b1, "< 4.0 * row[\\"err_cosh\\"]" in b1, "assert abs(d2[\\"plaquette_pull\\"]) < 4.0" in b2, "assert nt[\\"max_abs_pull\\"] < 4.0" in b2,
     sorted(set(re.findall(r"< (\\d\\.\\d) \\*", b1 + b2)))), (True, True, True, True, ["4.0"]))
rep = rd("REPORT.md")
chk("row 2: REPORT.md §2 gives the same SD range"''')

# ---- row 3
rep('''need(r"tot op 10⁻¹², en beide simulaties geven statistisch dezelfde gemiddelden in 2, 3 en 4 dimensies", ver, "row 3")''',
    '''need(r"tot op 10⁻¹², en beide simulaties geven statistisch dezelfde gemiddelden in 2, 3 en 4 dimensies", ver, "row 3")
need(r"De productieruns en de massa's van het lichtste deeltje \\(de \\"glueball\\"\\) zijn niet met de tweede simulatie nagerekend \\(§2\\)", ver, "row 3 (v3) limitation")''')

# ---- row 4
rep('''m = need(r"Alle (\\d+) analyses zijn opnieuw gerekend uit de ruwe data, .*? Grootste afwijking van een meetwaarde: (\\d),(\\d)·10(\\S+) keer de statistische fout"
         r".*? Het gaf daarnaast (\\d+) automatische signaleringen", ver, "row 4")''',
    '''m = need(r"Alle (\\d+) analyses zijn opnieuw berekend uit de ruwe data, .*? Grootste afwijking van een meetwaarde: (\\d),(\\d)·10(\\S+) keer de statistische fout"
         r".*? Het gaf daarnaast (\\d+) automatische signaleringen: plekken waar een getal een vooraf ingestelde grens overschrijdt\\. Dat zijn aanleidingen om te kijken, geen "
         r"vastgestelde fouten\\. De meeste gaan over foutmarges bij grotere blokken en over het punt bij β = 9 en zijn besproken in §4\\.2 tot en met §4\\.4; die over de onderlinge "
         r"consistentie van de stromen in vier dimensies komen alleen voor een deel aan bod \\(§4\\.9\\)", ver, "row 4")''')
rep('''chk("row 4: flags (sum of len(flags) in the 13 independent files)", int(m.group(5)), sum(len(I[e]["flags"]) for e in ENS))''',
    '''chk("row 4: flags (sum of len(flags) in the 13 independent files)", int(m.group(5)), sum(len(I[e]["flags"]) for e in ENS))
# v3: 'De meeste gaan over foutmarges bij grotere blokken en over het punt bij beta = 9'; 'die over de consistentie van de stromen in vier dimensies'
fl = [(e, f["type"]) for e in ENS for f in I[e]["flags"]]
n_rebin = sum(1 for e, t in fl if t == "rebinning_error_change")
n_b9 = sum(1 for e, t in fl if e.startswith("d3_b9.0") and t != "rebinning_error_change")
n_stream = [(e, t) for e, t in fl if t.startswith("stream_chi2")]
n_rest = len(fl) - n_rebin - n_b9 - len(n_stream)
print("         flags by kind: rebinning error change %d; other flags on the beta = 9 analyses %d; stream chi2 %d (analyses %s); remaining %d"
      % (n_rebin, n_b9, len(n_stream), sorted({e for e, _ in n_stream}), n_rest))
chk("row 4 (v3): 'de meeste' = rebinning + beta-9 flags are more than half of the flags (%d of %d)" % (n_rebin + n_b9, len(fl)), 2 * (n_rebin + n_b9) > len(fl), True)
chk("row 4 (v3): the stream-consistency flags are all on D = 4 analyses", sorted({P[e]["D"] for e, _ in n_stream}), [4])
chk("row 4 (v3): REPORT.md has sections 4.2, 4.3, 4.4 and 4.9", [bool(re.search(r"^### %s " % s, rep, flags=re.M)) for s in ("4\\\\.2", "4\\\\.3", "4\\\\.4", "4\\\\.9")], [True] * 4)''')

# ---- row 5
rep('''chk("row 5: title-page total = rounds 1+2 plus round 3"''',
    '''need(r"De ruwe data zelf staan niet in git; wie ze wil controleren, moet de simulatie opnieuw draaien \\(§6\\.1, §6\\.2\\)", ver, "row 5 (v3) raw data")
chk("row 5 (v3): raw data not in git: 'git ls-files results/raw' empty, .gitignore lists results/raw/, REPORT.md §6.1 says so",
    (git("ls-files", "results/raw"), "results/raw/" in rd(".gitignore").split("\\n"), "**Ruwe data** staan niet in git" in rep[rep.index("### 6.1"):rep.index("### 6.2")]), ("", True, True))
chk("row 5: title-page total = rounds 1+2 plus round 3"''')

# ---- row 8
rep('''m = need(r"Het rapport bevat (\\d+) verschillende getallen met een fout erbij\\. (\\d+) daarvan staan letterlijk in een projectbestand; (\\d+) zijn alleen via een "
         r"zwakkere getalsvergelijking met de resultaatbestanden gevonden; (\\d+) zijn met de hand opgezocht in de testuitvoer", ver, "row 8")''',
    '''m8 = need(r"Het rapport bevat (\\d+) verschillende getallen met een fout erbij\\. (\\d+) daarvan staan letterlijk in een projectbestand; voor (\\d+) is alleen een los getal met "
          r"ongeveer dezelfde waarde in een resultaatbestand gevonden, en dat is geen sluitende herkomst \\(het zijn vooral afgeleide getallen en getallen die uit een "
          r"controleverslag zijn overgenomen\\); (\\d+) zijn met de hand opgezocht in de testuitvoer\\. Teruggevonden betekent voor de (\\d+) en de (\\d+) dat het getal een "
          r"aanwijsbare bron heeft, niet dat het opnieuw is uitgerekend", ver, "row 8")
m = m8
chk("row 8 (v3): 'voor de 257 en de 2' repeats the literal and by-hand counts", (m8.group(5), m8.group(6)), (m8.group(2), m8.group(4)))''')

# ---- item 6, Kort gezegd
rep('''i0 = ver.index("Wat niet bevestigd is 1. Dat het millenniumprobleem"); i1 = ver.index("In één zin")''',
    '''i0 = ver.index("Wat niet bevestigd is 1. Dat het millenniumprobleem"); i1 = ver.index("Kort gezegd")
chk("v3: heading 'In één zin' no longer in the PDF", "In één zin" in ver, False)''')
rep('''chk("item 6: 'De foutmarge van een R5-getal is te klein (§2)': §2 of REPORT.md says so"''',
    '''need(r"De foutmarge van een getal volgens de vooraf vastgelegde regel R5 is bovendien te klein \\(§2\\)", nb, "item 6 (v3) wording")
chk("item 6: 'De foutmarge van een R5-getal is te klein (§2)': §2 of REPORT.md says so"''')
rep('''need(r"De getallen in dit document kloppen met de opgeslagen data en het rekenwerk is nagelopen; ze lossen het millenniumprobleem niet op en tonen geen massakloof aan", ver, "In één zin")''',
    '''need(r"Kort gezegd De meetuitkomsten in dit document kloppen met de opgeslagen data en het rekenwerk is nagelopen, door hetzelfde AI-systeem en door geen mens\\. "
     r"Ze lossen het millenniumprobleem niet op en tonen geen massakloof aan\\. Wat ze wel zeggen, staat in §0 en §5\\.", ver, "Kort gezegd (v3)")''')

# ---- appendix B intro
rep('''chk("B intro: analyses", (int(m.group(1)), int(m.group(3))), (len(ENS), len(ENS)))''',
    '''chk("B intro: analyses", (int(m.group(1)), int(m.group(3))), (len(ENS), len(ENS)))
need(r"de resultaatbestanden melden dat als waarschuwing\\. Zo was het opgezet: het maximum was een bovengrens, geen doel \\(§6\\.2\\)\\.", pB, "B intro (v3) cap sentence")
chk("B intro (v3): REPORT.md §6.2 says each stream has a time budget (--maxtime) so that the number of measurements depends on the speed",
    "De productiescripts geven elke stroom een tijdsbudget (`--maxtime`), zodat het aantal metingen van de rekensnelheid afhangt" in rep[rep.index("### 6.2"):], True)
need(r"Staat er bij R5 \\"geen plateau\\" of \\"geen meting\\", dan vond de regel geen vlak stuk; het getal dat erbij staat is dan alleen een bovengrens en telt niet als "
     r"meting \\(§3\\.2\\)\\. \\[t\\* = 1\\] zegt bij welke t de regel de waarde heeft afgelezen\\.", pB, "B intro (v3) R5 explanation")''')

# ---- appendix C
rep('''need(r"Een eerdere bouw van deze pdf is in drie afzonderlijke controles nagelopen", pC, "C three reviews")''',
    '''mc = need(r"Een eerdere bouw van deze pdf \\((\\d+) pagina's\\) is in (\\w+) afzonderlijke controles nagelopen, alle drie door hetzelfde AI-systeem: de getallen tegen de bestanden, "
          r"elke pagina op opmaak, en de formulering van de nieuwe onderdelen\\. Daarbij is geen fout getal gevonden\\. Wel stond in bijlage B (\\w+) waarde waar \\"geen meting\\" "
          r"hoort, en zeiden de nieuwe teksten op (\\w+) plaatsen meer dan de controlebestanden dragen\\. Die punten en (\\w+) opmaakfouten zijn hersteld\\.", pC, "C three reviews (v3)")
from pypdf import PdfReader as _PR
chk("C (v3): pages of the first build (REPORT_v1.pdf, pypdf)", int(mc.group(1)), len(_PR(QA + "/REPORT_v1.pdf").pages))
f1 = rd("review", "pdfcheck", "findings_v1.txt")
WORD = {"één": 1, "twee": 2, "drie": 3, "negen": 9, "tien": 10}
chk("C (v3): 'geen fout getal': findings_v1.txt, number review: 'No wrong number found'", "No wrong number found in REPORT_v1.pdf" in f1, True)
chk("C (v3): 'één waarde waar geen meting hoort': 732 of 733 appendix B checks, the one failure is the R5 ratio of d3_b6.0_L24",
    (WORD[mc.group(3)], bool(re.search(r"732 of 733 checks pass", f1)), "The one failure: d3_b6.0_L24 prints an R5 ratio 4.46(14) where the JSON says upper bound only" in f1), (1, True, True))
chk("C (v3): 'tien plaatsen': findings_v1.txt, wording review: 'in ten places'", (WORD[mc.group(4)], "say more than the evidence carries in ten places" in f1), (10, True))
chk("C (v3): 'negen opmaakfouten': findings_v1.txt, layout review: 'fixed 9 defects'", (WORD[mc.group(5)], "fixed 9 defects in pdf/style.css" in f1), (9, True))
chk("C (v3): 'drie' controls", WORD[mc.group(2)], 3)
chk("C (v3): that value is 'geen meting' in this build (appendix B, d3_b6.0_L24) and 4.46(14) is nowhere in the PDF", ("4.46(14)" in allpages, "m/√σ (Nambu–Goto) geen meting" in norm(flat(29))), (False, True))
need(r"of en hoe die bouw zelf nog is nagelopen, staat in review/pdfcheck/README\\.md ?, net als de scripts en bevindingen van de eerdere rondes", pC, "C (v3) pointer to README")
chk("C (v3): review/pdfcheck/findings_v2.txt exists (second round)", os.path.exists(os.path.join(ROOT, "review", "pdfcheck", "findings_v2.txt")), True)
need(r"python3 pdf/make_pdf\\.py # schrijft REPORT\\.pdf; nodig: pandoc, node met playwright, matplotlib, pypdf", pC, "C (v3) build command")''')

# ---- new block: the paragraph above the table (v3)
rep('''print("\\n================ VERIFICATION, row 1 (test suite)")''',
    '''print("\\n================ VERIFICATION, paragraph above the table (v3): what the second analysis recomputed")
need(r"De hoofdgetallen \\(plaquette, effectieve massa's bij t = 0 tot en met 3, snaarspanning bij t = 1 en 2, en de verhouding volgens regel R5\\) zijn met een tweede, apart "
     r"geschreven analyse nagerekend\\. Voor de effectieve massa's bij t = 4 tot en met 6 en de consistentiegetallen in bijlage B is dat niet gedaan\\. De verhouding m/√σ bij "
     r"vaste t komt uit die tweede analyse: de waarde volgt ook uit de getallen van de eerste, de fout niet\\.", ver, "paragraph above the table")
CORE = ["plaq"] + [f"{c}.gevp.m{t}" for c in ("glue", "tor") for t in (0, 1, 2, 3)] + ["tor.gevp.asNG1", "tor.gevp.asL1", "tor.gevp.asNG2", "tor.gevp.asL2"]
nrows = 0; worst = 0.0; missing = []; ratio_rows = {}; extra_keys = set()
for e in ENS:
    rows_ = {r["key"]: r for r in I[e]["comparison_with_pipeline"]["rows"]}
    nrows += len(rows_)
    for k in CORE:
        if k not in rows_: missing.append((e, k))
    ratio_rows[e] = sorted(k for k in rows_ if k.startswith("ratio."))
    extra_keys |= set(rows_) - set(CORE) - set(ratio_rows[e])
    for r in rows_.values():
        worst = max(worst, abs(r["dev_sigma"]))
        # every row: 'mine' equals 'pipeline' to 1e-9 relative, and the jackknife error equals the pipeline error
        assert abs(r["mine"] - r["pipeline"]) <= 1e-9 * max(1.0, abs(r["pipeline"])), (e, r)
        assert abs(r["err_jack"] - r["pipeline_err"]) <= 1e-9 * r["pipeline_err"], (e, r)
chk("paragraph: plaquette, m_eff/E_eff at t = 0..3 (glueball and torelon), a sqrt(sigma) NG and Luescher at t = 1 and 2: a comparison row in each of the 13 files (13 x 13 = 169 rows)",
    (missing, 13 * len(CORE)), ([], 169))
chk("paragraph: the other comparison rows are the two differences m(1)-m(2) and the R5 ratio", sorted(extra_keys), ["glue.gevp.d12", "tor.gevp.d12"])
# the R5 ratio: one NG and one Luescher row at the pipeline's (t*_glue, t*_torelon) wherever the pipeline has an R5 ratio
exp_ratio = {}
for e in ENS:
    g_, t_ = P[e]["glueball"], P[e]["torelon"]
    exp_ratio[e] = [] if P[e]["ratios"]["upper_bound_only"] else sorted([f"ratio.gevp.NGx{g_['t_star']}{t_['t_star']}", f"ratio.gevp.Lx{g_['t_star']}{t_['t_star']}"])
chk("paragraph: 'verhouding volgens regel R5': ratio rows at the pipeline's t* in the 12 files that have an R5 ratio, none for d3_b6.0_L24 (geen meting)", ratio_rows, exp_ratio)
for e in ENS:
    for r in I[e]["comparison_with_pipeline"]["rows"]:
        if r["key"].startswith("ratio.gevp.NGx"):
            assert abs(r["pipeline"] - P[e]["ratios"]["m_over_sqrt_sigma"]["nambu_goto"]["value"]) <= 1e-9 * abs(r["pipeline"]), (e, r)
        if r["key"] == "plaq": assert abs(r["pipeline"] - P[e]["plaquette"]["mean"]) < 1e-9
        mm_ = re.fullmatch(r"(glue|tor)\\.gevp\\.m(\\d)", r["key"])
        if mm_:
            tab = {x["t"]: x for x in P[e]["glueball" if mm_.group(1) == "glue" else "torelon"]["meff_table"]}
            assert abs(r["pipeline"] - tab[int(mm_.group(2))]["m_cosh"]) <= 1e-9 * abs(r["pipeline"]), (e, r)
        mm_ = re.fullmatch(r"tor\\.gevp\\.as(NG|L)(\\d)", r["key"])
        if mm_:
            fx_ = {int(f["t"]): f for f in P[e]["string_tension"]["fixed_t"]}
            assert abs(r["pipeline"] - fx_[int(mm_.group(2))]["nambu_goto" if mm_.group(1) == "NG" else "luscher"]["a_sqrt_sigma"]) <= 1e-9 * abs(r["pipeline"]), (e, r)
chk("paragraph: the 'pipeline' column of those rows equals the numbers in results/<ens>.json (plaquette, meff_table, string_tension.fixed_t, ratios)", True, True)
chk("paragraph: total comparison rows in the 13 files (12 x 17 + 15), largest |dev_sigma| %.2e" % worst, (nrows, worst < 1e-9), (12 * 17 + 15, True))
allkeys = {r["key"] for e in ENS for r in I[e]["comparison_with_pipeline"]["rows"]}
chk("paragraph: 'm_eff bij t = 4 tot en met 6 niet': no comparison row for t >= 4", sorted(k for k in allkeys if re.search(r"\\.m[4-9]$", k)), [])
chk("paragraph: 'consistentiegetallen niet': no comparison row for chi2 / hot-cold / tau_int", sorted(k for k in allkeys if re.search(r"chi2|hot|cold|pull|tau", k)), [])
# R5 values of glueball and torelon: the 'r5' block of comparison_with_pipeline
r5ok = 0
for e in ENS:
    for ch in ("glue", "tor"):
        a_, b_ = I[e]["comparison_with_pipeline"]["r5"][ch]["mine"], I[e]["comparison_with_pipeline"]["r5"][ch]["pipeline"]
        r5ok += (a_["flag"] == b_["flag"] and a_["t_star"] == b_["t_star"] and abs(a_["value"] - b_["value"]) <= 1e-9 * abs(b_["value"]) and abs(a_["err_jack"] - b_["err"]) <= 1e-9 * b_["err"])
chk("paragraph (extra): R5 flag, t*, value and error of glueball and torelon agree in the 'r5' block (13 x 2)", r5ok, 26)
# what appendix B prints from the second analysis: m/sqrt(sigma) at fixed t; value also follows from the pipeline numbers, the error does not
qok = 0; has_err = 0
for e in ENS:
    fx_ = {int(f["t"]): f for f in P[e]["string_tension"]["fixed_t"]}
    for tt in (1, 2):
        ir_ = I[e]["ratios"]["m_over_sqrt_sigma"]["gevp"][f"t{tt}"]["nambu_goto"]
        q_ = P[e]["glueball"]["fixed_t"][f"t{tt}"]["m"] / fx_[tt]["nambu_goto"]["a_sqrt_sigma"]
        qok += abs(q_ - ir_["value"]) <= 5e-7 * abs(q_)
def walk_keys(o, path=""):
    if isinstance(o, dict):
        for k, v in o.items(): yield from walk_keys(v, path + "/" + str(k))
    elif isinstance(o, list):
        for i_, v in enumerate(o): yield from walk_keys(v, path + "[%d]" % i_)
    else: yield path, o
fixed_ratio_in_pipeline = sorted({p_ for e in ENS for p_, v in walk_keys(P[e]["ratios"]) if re.search(r"fixed|/t1|/t2", p_)})
chk("paragraph: m/sqrt(sigma) at fixed t: value of the second analysis = quotient of the pipeline numbers (13 x 2)", qok, 26)
chk("paragraph: 'de fout niet': results/<ens>.json has no fixed-t ratio (no key with fixed/t1/t2 under 'ratios')", fixed_ratio_in_pipeline, [])
# information only: does the second analysis contain m_eff at t = 4..6 and stream-consistency numbers of its own?
have46 = 0; agree46 = 0
for e in ENS:
    for ch, key in (("glueball", "glueball"), ("torelon", "torelon")):
        tabI = I[e][key].get("meff_all_t_gevp")
        tabP = {x["t"]: x for x in P[e][key]["meff_table"]}
        if not tabI: continue
        for row in tabI:
            t_ = row.get("t") if isinstance(row, dict) else None
            if t_ in (4, 5, 6) and tabP.get(t_) and tabP[t_].get("m_cosh") is not None:
                v_ = row.get("value", row.get("m", row.get("m_cosh")))
                if v_ is None: continue
                have46 += 1; agree46 += abs(v_ - tabP[t_]["m_cosh"]) <= 1e-6 * abs(tabP[t_]["m_cosh"])
print("         NOTE (information): independent files carry m_eff at t = 4..6 of their own ('meff_all_t_gevp'): %d values with a pipeline counterpart, %d equal to 1e-6;"
      " they are not part of comparison_with_pipeline, so 'niet nagerekend' is the conservative statement" % (have46, agree46))

print("\\n================ VERIFICATION, row 1 (test suite)")''')

open("check_front_v3.py", "w", encoding="utf-8").write(src)
print("written check_front_v3.py,", len(src), "chars")
