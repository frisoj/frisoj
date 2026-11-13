#!/usr/bin/env python3
"""v3 addition: completeness of check_b.py. For each of the 13 blocks of appendix B, remove the five pieces that
check_b.py parses and verifies (heading, info line, 5x3 table, plaquette line, effective-mass table) and list
every digit that is left. Nothing may be left."""
import re, os, sys
QA = "/tmp/claude-0/-home-user-frisoj/c2e79863-26e2-54ce-9b2d-e39a90258140/scratchpad/qa"
TOK = r"-?\d+(?:\.\d+)?\(\d+(?:\.\d+)?\)"
left_total = 0
for src in ("pdf_layout.txt", "pdf_pypdf.txt", "pdf_pdfium.txt"):
    pages = open(os.path.join(QA, "numbers-v4", src), encoding="utf-8").read().split("\f")
    start = [i for i, p in enumerate(pages) if "Bijlage B: de uitslagen per analyse" in p and "Inhoud" not in p][0]
    end = [i for i, p in enumerate(pages) if "Bijlage C: vingerafdrukken" in p and "Inhoud" not in p][0]
    footer = re.compile(r"^\s*Yang–Mills en de massakloof · numeriek bewijsmateriaal, geen bewijs\s+pagina \d+ van \d+\s*$")
    text = "\n".join(ln for i in range(start, end) for ln in pages[i].split("\n") if not footer.match(ln))
    heads = [(m.start(), m.group(1)) for m in re.finditer(r"^\s*(d[34]_b[\d.]+_L\d+\w*): D = ", text, flags=re.M)]
    nblocks = 0; left = []
    for k, (pos, name) in enumerate(heads):
        flat = " ".join(text[pos:(heads[k + 1][0] if k + 1 < len(heads) else len(text))].split())
        pieces = [
            r"^\S+: D = \d, β = [\d.,]+, rooster \S+, ronde \S+ ",
            r"Metingen: \d+, waarvan \d+ gebruikt in \d+ bins van \d+; langste autocorrelatietijd [\d,]+ metingen\. Stromen \(seed, start, aantal metingen\): (?:\d+ \((?:warm|koud), \d+\)(?:, |\. ))+",
            r"grootheid R5 \(vooraf vastgelegde regel\) vaste t = 1 vaste t = 2 .*? (?=Plaquette:)",
            rf"Plaquette: {TOK}\. Stromen onderling \(plaquette\): χ² = [\d,]+ bij \d+ vrijheidsgraden; warme min koude starts: [−\d,]+σ\.",
            rf"t glueball m_eff\(t\) torelon E_eff\(t\)(?: \d+ (?:{TOK}|–) (?:{TOK}|–))+",
        ]
        rest = flat
        for p in pieces:
            m = re.search(p, rest)
            assert m, (src, name, p)
            rest = rest[:m.start()] + " " + rest[m.end():]
        nblocks += 1
        # the role sentence may contain analysis names and section numbers (text, not results)
        role = rest
        role_wo_names = re.sub(r"d[34]_b[\d.]+_L\d+\w*|§\d\.\d", "", role)
        d = re.findall(r"\d+(?:[.,]\d+)*", role_wo_names)
        if d: left.append((name, d, role[:200]))
    print("[%s] blocks %d; blocks with a digit outside the five verified pieces (analysis names and § references in the role sentence excepted): %d" % (src, nblocks, len(left)))
    for l in left: print("    LEFT", l)
    left_total += len(left)
print("TOTAL unverified digit strings in appendix B blocks:", left_total)
