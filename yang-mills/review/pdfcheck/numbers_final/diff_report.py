#!/usr/bin/env python3
"""v2, task 3: the report part of document_v4.md against REPORT.md.
Extracts from document_v4.md (a) the preamble under '## Vooraf en leeswijzer' and (b) everything from
'## 0. In het kort' up to '## Bijlage B', and diffs it line by line with REPORT.md.
Every differing line is classified; anything that is not one of the three declared edits is a MISMATCH."""
import difflib, re, html, os
QA = "/tmp/claude-0/-home-user-frisoj/c2e79863-26e2-54ce-9b2d-e39a90258140/scratchpad/qa"
ROOT = "/home/user/frisoj/yang-mills"
doc = open(QA + "/document_v4.md", encoding="utf-8").read()
rep = open(ROOT + "/REPORT.md", encoding="utf-8").read()
i_pre = doc.index("## Vooraf en leeswijzer\n"); i_ver = doc.index("\n## Verificatie:")
i_0 = doc.index("\n## 0. In het kort"); i_B = doc.index("\n## Bijlage B:")
pre = doc[i_pre + len("## Vooraf en leeswijzer\n"):i_ver]
body = doc[i_0 + 1:i_B]
print("document_v4.md: preamble %d chars, verification %d chars, report body %d chars, appendices B+C %d chars"
      % (len(pre), i_0 - i_ver, len(body), len(doc) - i_B))
a = rep.split("\n")
b = (pre.strip("\n") + "\n\n" + body.rstrip("\n")).split("\n")
sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
kinds = {}
bad = 0
formula = 0
for tag, i1, i2, j1, j2 in sm.get_opcodes():
    if tag == "equal":
        continue
    old, new = a[i1:i2], b[j1:j2]
    olds, news = "\n".join(old), "\n".join(new)
    if tag == "delete" and all(l.startswith("# ") or l.startswith("**SU(2)-roostersimulaties") or l.strip() in ("", "---") for l in old):
        k = "edit 1: title lines dropped (title, subtitle, blank lines)" if any(l.strip() for l in old) else "trailing blank line"
    elif olds.replace("## Bijlage: herkomst van de getallen", "## Bijlage A: herkomst van de getallen") == news:
        k = "edit 2: appendix heading 'Bijlage' -> 'Bijlage A'"
    elif olds.replace("de sleutel staat in de bijlage.", "de sleutel staat in bijlage A.") == news or olds.replace("(zie de bijlage)", "(zie bijlage A)") == news:
        k = "edit 2: reference to the appendix -> 'bijlage A'"
    elif "$$" in olds and 'class="formula"' in news:
        tex = " ".join(olds.replace("$$", " ").split())
        alt = re.search(r'alt="([^"]*)"', news).group(1)
        same = html.unescape(alt) == "formule (TeX): " + tex
        k = "edit 3: display formula -> image, alt text = the TeX source" if same else "FORMULA ALT TEXT DIFFERS FROM THE TEX"
        formula += 1
        if not same:
            bad += 1
            print("MISMATCH formula alt:", repr(html.unescape(alt)), "vs", repr(tex))
    elif all(l.strip() == "" for l in old + new):
        k = "blank lines only"
    elif [l.replace("de sleutel staat in de bijlage.", "de sleutel staat in bijlage A.") for l in old if l.strip() not in ("", "---")] == [l for l in new if l.strip()] \
            and any(l.strip() == "---" for l in old):
        k = "edit 2 (reference in the reading guide -> 'bijlage A') + edit 1 (the rule '---' under the title block dropped)"
    else:
        k = "UNDECLARED DIFFERENCE"
        bad += 1
        print("MISMATCH REPORT.md lines %d-%d vs document lines %d-%d" % (i1 + 1, i2, j1 + 1, j2))
        for l in old: print("   - " + l[:300])
        for l in new: print("   + " + l[:300])
    kinds.setdefault(k, []).append((i1 + 1, i2, len(old), len(new)))
for k, v in kinds.items():
    print("%-70s x%d  (REPORT.md lines: %s)" % (k, len(v), ", ".join(("%d" % x[0]) if x[1] <= x[0] else ("%d-%d" % (x[0], x[1])) for x in v)))
eq = sum(i2 - i1 for tag, i1, i2, j1, j2 in sm.get_opcodes() if tag == "equal")
print("lines of REPORT.md: %d, identical in the document: %d" % (len(a), eq))
# reverse the declared edits and require byte equality with REPORT.md from the preamble on
rev = (pre.strip("\n") + "\n\n---\n\n" + body)
rev = rev.replace("## Bijlage A: herkomst van de getallen", "## Bijlage: herkomst van de getallen").replace("de sleutel staat in bijlage A.", "de sleutel staat in de bijlage.").replace("(zie bijlage A)", "(zie de bijlage)")
texs = re.findall(r"\n\$\$\n(.*?)\n\$\$\n", rep, flags=re.S)
imgs = re.findall(r'\n\n<p class="formula"><img src="[^"]*" alt="[^"]*"></p>\n\n', rev)
assert len(texs) == len(imgs) == 4, (len(texs), len(imgs))
for tex, img in zip(texs, imgs):
    rev = rev.replace(img, "\n$$\n" + tex + "\n$$\n", 1)
start = rep.index("Datum: 11 en 12 november 2026.")
print("title lines of REPORT.md that are dropped:", repr(rep[:start]))
same = rev.rstrip("\n") == rep[start:].rstrip("\n")
print("after undoing the three declared edits the report part equals REPORT.md byte for byte (from 'Datum:' on):", same)
if not same:
    bad += 1
    x, y = rev.rstrip("\n"), rep[start:].rstrip("\n")
    n = next((k for k in range(min(len(x), len(y))) if x[k] != y[k]), min(len(x), len(y)))
    print("   first difference at char", n, repr(x[n - 60:n + 60]), "|", repr(y[n - 60:n + 60]))
print("formulas replaced:", formula, "| undeclared differences:", bad)
