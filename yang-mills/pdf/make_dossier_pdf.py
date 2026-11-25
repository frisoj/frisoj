#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build DOSSIER.pdf: the two finished PDFs of this project in one file, behind a cover page.

Part I is BEWIJZEN.pdf (three known theorems about the lattice theory, with proof) and part II
is REPORT.pdf (numerical evidence at finite lattice spacing and finite volume). The dossier is
NOT a proof of the Yang-Mills Millennium problem, and the cover says so.

Nothing on the cover is typed in by hand except its fixed sentences:
  * page counts, page ranges and SHA-256 sums are computed from the two PDF files;
  * the line about the tests is read from review/dossier/junit_default.xml;
  * commit and date are those of the last commit that touched one of the two PDFs.
The pages of the two PDFs are copied unchanged (no re-rendering); the script checks at the end
that the text of every copied page is identical to its source page and that every internal link
still lands inside its own part.

This script is NOT covered by the test suite.

Usage (from the project directory):   python3 pdf/make_dossier_pdf.py
Needs: node with the playwright package (Chromium), matplotlib (for the STIX fonts), pypdf.
"""
import hashlib
import html
import io
import os
import subprocess
import sys
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BUILD = os.path.join(HERE, "build", "dossier")
OUTPUT = os.path.join(ROOT, "DOSSIER.pdf")
JUNIT = os.path.join(ROOT, "review", "dossier", "junit_default.xml")
sys.path.insert(0, HERE)
sys.dont_write_bytecode = True
import make_bewijzen_pdf as B  # noqa: E402  (fonts, months, git helper; nothing in it is changed)

#: (file, name of the part, title of the document as on its own title page)
PARTS = [
    ("BEWIJZEN.pdf", "Deel I — Wiskundig bewijs",
     "Drie bekende stellingen over de massakloof, met uitgeschreven bewijs"),
    ("REPORT.pdf", "Deel II — Numeriek bewijsmateriaal",
     "Eindrapport met alle uitslagen en verificatie"),
]
TITLE = "Yang–Mills en de massakloof: het dossier (geen bewijs van het millenniumprobleem)"

EXTRA_CSS = """
.titlepage { height: 262mm; }
.titlepage .statusbox { margin-bottom: 1.5em; }
table.inhoud { width: 100%; max-width: 160mm; font-size: 9.8pt; margin: 0 0 0.9em 0; }
table.inhoud th, table.inhoud td { padding: 0.35em 0.6em; }
table.inhoud td.pg { white-space: nowrap; text-align: right; }
p.note { font-size: 9.6pt; max-width: 160mm; color: #2f353d; margin-bottom: 1.4em; text-align: left; }
table.meta td code { white-space: normal; overflow-wrap: anywhere; font-size: 0.74em; }
"""

PRINT_JS = """
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + process.argv[1], { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({ path: process.argv[2], format: 'A4', printBackground: true,
                   margin: { top: '15mm', bottom: '17mm', left: '24mm', right: '24mm' } });
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
"""


def sha256(path):
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def date_nl(iso):
    """'2026-11-24' -> '24 november 2026'."""
    y, m, d = iso[:10].split("-")
    return "%d %s %s" % (int(d), B.MONTHS[int(m) - 1], y)


def test_line():
    """One sentence about the last run of the test suite, from its JUnit file."""
    if not os.path.exists(JUNIT):
        raise SystemExit("make_dossier_pdf: missing " + JUNIT)
    root = ET.parse(JUNIT).getroot()
    suite = root if root.tag == "testsuite" else root.find("testsuite")
    total, skipped = int(suite.get("tests")), int(suite.get("skipped"))
    failed = int(suite.get("failures")) + int(suite.get("errors"))
    reasons = {(c.find("skipped").get("message") or "") for c in suite.iter("testcase")
               if c.find("skipped") is not None}
    if failed or any("slow test" not in r for r in reasons):
        raise SystemExit("make_dossier_pdf: the test run has failures or unexpected skips; "
                         "the sentence on the cover would be wrong")
    return ("%d toetsen; laatste ronde op %s: %d geslaagd, %d trage toetsen overgeslagen, "
            "%d mislukt" % (total, date_nl(suite.get("timestamp")), total - skipped, skipped,
                            failed))


def cover_html(rows, commit, stamp, tests):
    """The cover page; ``rows`` holds (part, title, file, pages, first, last, sha) per part."""
    inhoud = "\n".join(
        "<tr><td><strong>%s</strong></td><td>%s<br><code>%s</code>, %d pagina's, ongewijzigd</td>"
        "<td class=\"pg\">%d–%d</td></tr>" % (html.escape(p), html.escape(t), f, n, a, b)
        for p, t, f, n, a, b, _ in rows)
    sums = "\n".join("<tr><td>SHA-256 van <code>%s</code></td><td><code>%s</code></td></tr>"
                     % (f, s) for _, _, f, _, _, _, s in rows)
    return """<!DOCTYPE html>
<html lang="nl"><head><meta charset="utf-8"><title>%s</title>
<style>
%s
%s
%s
</style></head><body>
<div class="titlepage">
<div class="kicker">Yang–Mills en de massakloof</div>
<h1 class="doctitle">Het dossier: bewijzen en metingen in één bestand</h1>
<div class="subtitle">Alles wat dit project aan bewijs en bewijsmateriaal heeft opgeleverd: drie
bewezen stellingen over de roostertheorie, en het rapport met alle metingen en controles</div>
<div class="statusbox">
<p><strong>Dit dossier bevat geen bewijs van het millenniumprobleem.</strong> Het probleem
“Yang–Mills: bestaan en massakloof” is open. Wat hier ligt is van twee soorten: wiskundig bewijs
van drie bekende stellingen over de roosterversie van de theorie (deel I), en numeriek
bewijsmateriaal uit simulaties bij eindige roosterafstand en eindig volume (deel II). Geen van
beide lost het probleem op, ook niet gedeeltelijk.</p>
<p>Alles in dit dossier is geschreven, berekend en gecontroleerd door een AI-systeem. Geen
wiskundige of natuurkundige heeft het beoordeeld.</p>
</div>
<table class="inhoud">
<thead><tr><th>deel</th><th>document</th><th>pagina's in dit bestand</th></tr></thead>
<tbody>
%s
</tbody></table>
<p class="note">Beide documenten zijn ongewijzigd opgenomen. Elk heeft zijn eigen titelblad,
inhoudsopgave en paginanummers onderaan de pagina; de paginanummers in de tabel hierboven zijn
die van dit bestand. Niet in dit bestand: de achtergrondtekst met de theorie en de formules
(<code>THEORY.md</code>), de programmacode en de ruwe uitvoer van de controles. Die staan in de
map <code>yang-mills</code> van de repository.</p>
<table class="meta">
<tr><td>Versie</td><td>commit <code>%s</code>, %s</td></tr>
<tr><td>Toetsen</td><td>%s</td></tr>
%s
</table>
</div>
</body></html>
""" % (html.escape(TITLE), B.font_css(), io.open(os.path.join(HERE, "style_bewijzen.css"),
                                                 encoding="utf-8").read(), EXTRA_CSS,
       inhoud, html.escape(commit), html.escape(stamp), html.escape(tests), sums)


def link_targets(reader, first, last):
    """Pages (0-based) that the internal links on pages first..last point to."""
    names = reader.named_destinations
    out = []
    for i in range(first, last + 1):
        for ref in reader.pages[i].get("/Annots", []) or []:
            annot = ref.get_object()
            if annot.get("/Subtype") != "/Link" or "/Dest" not in annot:
                continue
            dest = annot["/Dest"]
            if str(dest) not in names:
                raise SystemExit("make_dossier_pdf: link on page %d has no target: %s"
                                 % (i + 1, dest))
            out.append(reader.get_destination_page_number(names[str(dest)]))
    return out


def main():
    from pypdf import PdfReader, PdfWriter
    from pypdf.generic import NameObject, TextStringObject
    os.makedirs(BUILD, exist_ok=True)
    files = [os.path.join(ROOT, f) for f, _, _ in PARTS]
    readers = [PdfReader(f) for f in files]
    commit = B.git("log", "-1", "--format=%h", "--", *[f for f, _, _ in PARTS])
    stamp = date_nl(B.git("log", "-1", "--format=%cs", "--", *[f for f, _, _ in PARTS]))

    rows, first = [], 2                       # page 1 is the cover
    for (f, part, title), path, reader in zip(PARTS, files, readers):
        n = len(reader.pages)
        rows.append((part, title, f, n, first, first + n - 1, sha256(path)))
        first += n
    cover_src, cover_pdf = os.path.join(BUILD, "cover.html"), os.path.join(BUILD, "cover.pdf")
    with io.open(cover_src, "w", encoding="utf-8") as fh:
        fh.write(cover_html(rows, commit, stamp, test_line()))
    subprocess.run(["node", "-e", PRINT_JS, cover_src, cover_pdf], check=True, cwd=HERE)
    cover = PdfReader(cover_pdf)
    if len(cover.pages) != 1:
        raise SystemExit("make_dossier_pdf: the cover is %d pages, expected 1" % len(cover.pages))

    writer = PdfWriter()
    writer.append(cover, outline_item="Voorblad", import_outline=False)
    for (f, part, _), reader in zip(PARTS, readers):
        writer.append(reader, outline_item="%s (%s)" % (part, f), import_outline=True)
    writer.add_metadata({"/Title": TITLE, "/Subject": "Drie bewezen stellingen over de "
                         "roostertheorie en numeriek bewijsmateriaal; geen bewijs van het "
                         "millenniumprobleem"})
    writer._root_object[NameObject("/Lang")] = TextStringObject("nl-NL")
    with open(OUTPUT, "wb") as fh:
        writer.write(fh)

    # checks on the file that was written
    out = PdfReader(OUTPUT)
    total = 1 + sum(len(r.pages) for r in readers)
    if len(out.pages) != total:
        raise SystemExit("make_dossier_pdf: %d pages, expected %d" % (len(out.pages), total))
    n_links = 0
    for (part, _, f, n, a, b, _), reader in zip(rows, readers):
        for k in range(n):
            if out.pages[a - 1 + k].extract_text() != reader.pages[k].extract_text():
                raise SystemExit("make_dossier_pdf: text of page %d of %s changed" % (k + 1, f))
        targets = link_targets(out, a - 1, b - 1)
        source = link_targets(reader, 0, n - 1)
        if targets != [t + a - 1 for t in source]:
            raise SystemExit("make_dossier_pdf: internal links of %s do not land on the same "
                             "pages as in the source" % f)
        n_links += len(targets)
        print("make_dossier_pdf: %s = pages %d-%d (%s, %d pages, sha256 %s)"
              % (part, a, b, f, n, sha256(os.path.join(ROOT, f))[:16]))
    print("make_dossier_pdf: %d pages; text of all %d copied pages identical to the sources; "
          "%d internal links checked; wrote %s"
          % (total, total - 1, n_links, OUTPUT))


if __name__ == "__main__":
    main()
