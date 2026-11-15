#!/usr/bin/env python3
"""Build BEWIJZEN.pdf from BEWIJZEN.md.

    cd yang-mills && python3 pdf/make_bewijzen_pdf.py [--source draft.md --output draft.pdf] [--allow-wide]

Needs pandoc, node with playwright (Chromium), matplotlib and pypdf; nothing is downloaded.

The mathematics in BEWIJZEN.md is LaTeX.  No TeX system is available here, so every formula is
typeset by matplotlib's mathtext (STIX fonts) into a small vector image, and the text is set in
the STIX text fonts that ship with matplotlib.  mathtext knows a subset of LaTeX; `to_mathtext`
below translates the constructions the document uses.  A formula that cannot be typeset stops
the build: nothing is silently dropped.

This script is a layout tool.  It does not check the mathematics.
"""
import hashlib
import html
import io
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BUILD = os.path.join(HERE, "build", "bewijzen")
SOURCE = os.path.join(ROOT, "BEWIJZEN.md")
OUTPUT = os.path.join(ROOT, "BEWIJZEN.pdf")

FONT_PT = 10.4            # body font size of the page; formulas are typeset at the same size
SIDE_MM = 24              # side margins of the page
TEXT_WIDTH_PT = (210 - 2 * SIDE_MM) / 25.4 * 72
INK = "#1a1c20"
MONTHS = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus",
          "september", "oktober", "november", "december"]
FOOTER = "Yang–Mills en de massakloof · drie stellingen met bewijs · geen bewijs van het millenniumprobleem"


def git(*args):
    return subprocess.run(["git", *args], cwd=ROOT, check=True, capture_output=True,
                          text=True).stdout.strip()


# ==============================================================================================
# LaTeX -> mathtext
# ==============================================================================================
_OPEN = {"(": "(", "[": "[", "\\lbrace": "\\{", "\\{": "\\{", "\\langle": "\\langle",
         "\\lvert": "|", "\\lVert": "\\|"}
_CLOSE = {")": ")", "]": "]", "\\rbrace": "\\}", "\\}": "\\}", "\\rangle": "\\rangle",
          "\\rvert": "|", "\\rVert": "\\|"}
_SIZED = re.compile(r"\\(?:big|Big|bigg|Bigg)\s*(\\[a-zA-Z]+|\\[{}]|[()\[\]])")


def _sized(m):
    d = m.group(1)
    if d in _OPEN:
        return "\\left" + _OPEN[d] + " "
    if d in _CLOSE:
        return "\\right" + _CLOSE[d] + " "
    raise ValueError("unknown sized delimiter: " + m.group(0))


def _matrix(m):
    rows = [[c.strip() for c in r.split("&")] for r in m.group(1).split("\\\\")]
    if len(rows) != 2 or any(len(r) != 2 for r in rows):
        raise ValueError("only 2x2 matrices are supported")
    (a, b), (c, d) = rows
    return ("\\left( \\genfrac{}{}{0}{0}{%s}{%s} \\ \\ \\genfrac{}{}{0}{0}{%s}{%s} \\right)"
            % (a, c, b, d))


def to_mathtext(tex, display):
    """Translate the LaTeX used in BEWIJZEN.md into what matplotlib's mathtext accepts."""
    s = " ".join(tex.split())
    s = re.sub(r"\\begin\{pmatrix\}(.*?)\\end\{pmatrix\}", _matrix, s)
    s = _SIZED.sub(_sized, s)
    for a, b in (("\\lvert", "|"), ("\\rvert", "|"), ("\\vert", "|"), ("\\lVert", "\\|"),
                 ("\\rVert", "\\|"), ("\\lbrace", "\\{"), ("\\rbrace", "\\}"),
                 ("\\lt", "<"), ("\\gt", ">"), ("\\ast", "*"),
                 ("\\colon", ":")):
        s = re.sub(re.escape(a) + r"(?![a-zA-Z])", lambda _m, b=b: b + " ", s)
    s = re.sub(r"\\[td]frac(?![a-zA-Z])", r"\\frac", s)
    s = re.sub(r"\\frac\s*(\d)\s*(\d)", r"\\frac{\1}{\2}", s)
    s = re.sub(r"\\frac\s*(\d)\s*(\\[a-zA-Z]+)", r"\\frac{\1}{\2}", s)
    s = re.sub(r"\\(hat|bar|tilde)\s*(\\[a-zA-Z]+|[a-zA-Z])", r"\\\1{\2}", s)
    s = re.sub(r"\\text\{([^{}]*)\}",
               lambda m: "\\mathrm{" + m.group(1).replace(" ", "\\ ") + "}", s)
    # a prime is a superscript of the symbol before it (mathtext would set it as a loose mark)
    s = re.sub(r"(\\[a-zA-Z]+|[a-zA-Z0-9}])'", r"\1^{\\prime}", s)
    if display:
        s = s.replace("\\frac", "\\dfrac")
    else:
        # in running text the limits of a sum, product or maximum go beside the operator
        s = re.sub(r"\\(sum|prod|max|min|sup|inf|lim)\s*(?=[_^])", r"\\\1{}", s)
    return s


# ==============================================================================================
# typesetting one formula
# ==============================================================================================
_CACHE = {}


def typeset(tex, display):
    """Typeset a formula; returns (file path of the svg, width, height, depth) in points."""
    key = (tex, display)
    if key in _CACHE:
        return _CACHE[key]
    import matplotlib
    matplotlib.use("Agg")
    from matplotlib.backends.backend_svg import FigureCanvasSVG
    from matplotlib.figure import Figure
    from matplotlib.font_manager import FontProperties
    from matplotlib.mathtext import MathTextParser

    src = "$" + to_mathtext(tex, display) + "$"
    prop = FontProperties(size=FONT_PT, math_fontfamily="stix")
    parser = typeset.parser = getattr(typeset, "parser", None) or MathTextParser("path")
    try:
        width, height, depth, _, _ = parser.parse(src, dpi=72, prop=prop)
    except Exception as exc:
        raise SystemExit("make_bewijzen_pdf: cannot typeset the formula\n  %s\nas mathtext\n  %s\n%s"
                         % (tex, src, exc))
    pad, side = 1.2, 0.6                        # room for accents and for italic overhang
    w, h = width + 2 * side, height + 2 * pad
    name = "m_" + hashlib.sha256(repr(key).encode("utf-8")).hexdigest()[:20] + ".svg"
    path = os.path.join(BUILD, name)
    with matplotlib.rc_context({"svg.fonttype": "path", "svg.hashsalt": name}):
        fig = Figure(figsize=(w / 72.0, h / 72.0))
        FigureCanvasSVG(fig)
        fig.text(side / w, (depth + pad) / h, src, fontproperties=prop, color=INK)
        fig.savefig(path, format="svg", transparent=True, dpi=72,
                    metadata={"Date": None, "Creator": None})
    _CACHE[key] = (path, w, h, depth + pad)
    return _CACHE[key]


_RELATIONS = ("\\leq", "\\geq", "\\lt", "\\gt", "\\neq", "\\to", "\\longrightarrow",
              "\\Longrightarrow", "\\mapsto", "\\subset", ":=", "=")
_OPENERS = ("\\lvert", "\\lVert", "\\langle", "\\lbrace", "\\left")
_CLOSERS = ("\\rvert", "\\rVert", "\\rangle", "\\rbrace", "\\right")


_QED = {"\\square": "\u25a1", "\\blacksquare": "\u25a0"}


def split_at_relations(tex):
    """Cut a formula before every relation sign that is not inside brackets or braces."""
    pieces, start, depth, i, n = [], 0, 0, 0, len(tex)
    while i < n:
        ch = tex[i]
        if ch == "\\":
            m = re.match(r"\\([a-zA-Z]+|.)", tex[i:], flags=re.S)
            word = m.group(0)
            if word in _OPENERS:
                depth += 1
            elif word in _CLOSERS:
                depth -= 1
            elif depth == 0 and word in _RELATIONS and tex[start:i].strip():
                pieces.append(tex[start:i]); start = i
            i += len(word)
            continue
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        elif depth == 0 and tex[start:i].strip():
            if tex.startswith(":=", i):
                pieces.append(tex[start:i]); start = i
                i += 2
                continue
            if ch == "=":
                pieces.append(tex[start:i]); start = i
        i += 1
    pieces.append(tex[start:])
    return [p for p in pieces if p.strip()] if depth == 0 else [tex]


def inline_html(tex):
    """An inline formula; a long one is cut before its relation signs so that the line can break."""
    if tex.strip() in _QED:                      # end-of-proof marks: plain characters
        return '<span class="qed">%s</span>' % _QED[tex.strip()]
    element, w = img(tex, False)
    if w <= 0.26 * TEXT_WIDTH_PT:
        return element
    pieces = split_at_relations(tex)
    if len(pieces) == 1:
        return element
    parts = [img(p, False)[0] for p in pieces]
    return parts[0] + "".join('<wbr>' + e.replace('class="m"', 'class="m rel"', 1) for e in parts[1:])


def img(tex, display):
    """An <img> element for a formula, sized in em so that it follows the surrounding font."""
    path, w, h, d = typeset(tex, display)
    alt = html.escape(" ".join(tex.split()), quote=True)
    return ('<img class="m" src="file://%s" alt="%s" style="width:%.4fem;height:%.4fem;'
            'vertical-align:%.4fem">' % (html.escape(path), alt, w / FONT_PT, h / FONT_PT,
                                         -d / FONT_PT)), w


# ==============================================================================================
# the document: math out, pandoc, math back in
# ==============================================================================================
def extract_math(text):
    """Replace all math by tokens that survive pandoc; returns (text, {token: (kind, tex)})."""
    store = {}

    def put(kind, tex):
        token = "ZZMATH%s%05dZZ" % (kind, len(store))
        store[token] = (kind, tex)
        return token

    text = re.sub(r"```math\n(.*?)\n```", lambda m: "\n" + put("D", m.group(1)) + "\n", text,
                  flags=re.S)
    text = re.sub(r"\$\$([^\n$]+?)\$\$", lambda m: put("E", m.group(1)), text)
    text = re.sub(r"\$([^\n$]+?)\$", lambda m: put("I", m.group(1)), text)
    if "$" in text:
        raise SystemExit("make_bewijzen_pdf: unbalanced $ in BEWIJZEN.md")
    return text, store


def display_html(tex, wide):
    """HTML for a display formula: one line, or the lines of an aligned environment."""
    tag = ""
    m = re.search(r"\\tag\{([^{}]*)\}", tex)
    if m:
        tag = '<span class="eqtag">(%s)</span>' % html.escape(m.group(1))
        tex = tex[:m.start()] + tex[m.end():]
    tex = tex.strip()
    m = re.fullmatch(r"\\begin\{aligned\}(.*)\\end\{aligned\}", tex, flags=re.S)
    if m:
        rows = []
        for line in m.group(1).split("\\\\"):
            if not line.strip():
                continue
            left, _, right = line.partition("&")
            cells = []
            total = 0.0
            for part in (left, right):
                if part.strip():
                    element, w = img(part, True)
                    total += w
                else:
                    element = ""
                cells.append(element)
            if total > TEXT_WIDTH_PT:
                wide.append((total, " ".join(line.split())))
            rows.append('<tr><td class="al">%s</td><td class="ar">%s</td></tr>' % tuple(cells))
        body = '<table class="aligned">%s</table>' % "".join(rows)
    else:
        body, w = img(tex, True)
        if w > TEXT_WIDTH_PT:
            wide.append((w, " ".join(tex.split())))
    return '<span class="formula">%s%s</span>' % (body, tag)


def insert_math(page, store):
    wide = []
    counts = {"D": 0, "E": 0, "I": 0}

    def repl(m):
        kind, tex = store[m.group(0)]
        counts[kind] += 1
        if kind == "I":
            return inline_html(tex)
        return display_html(tex, wide)

    # a display block that pandoc wrapped in its own paragraph becomes a block of its own
    page = re.sub(r"<p>(ZZMATHD\d{5}ZZ)</p>", lambda m: '<div class="display">%s</div>' % m.group(1),
                  page)
    page = re.sub(r"ZZMATH[DEI]\d{5}ZZ", repl, page)
    if "ZZMATH" in page:
        raise SystemExit("make_bewijzen_pdf: a formula token was not replaced")
    return page, counts, wide


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


def font_css():
    """@font-face rules for the STIX text fonts that ship with matplotlib."""
    import matplotlib
    d = os.path.join(matplotlib.get_data_path(), "fonts", "ttf")
    faces = (("STIXGeneral.ttf", "normal", "normal"), ("STIXGeneralItalic.ttf", "normal", "italic"),
             ("STIXGeneralBol.ttf", "bold", "normal"), ("STIXGeneralBolIta.ttf", "bold", "italic"))
    out = []
    for name, weight, style in faces:
        path = os.path.join(d, name)
        if not os.path.exists(path):
            raise SystemExit("make_bewijzen_pdf: font not found: " + path)
        out.append('@font-face { font-family: "STIX Text"; src: url("file://%s"); '
                   'font-weight: %s; font-style: %s; }' % (path, weight, style))
    return "\n".join(out)


def title_page(commit, date_nl):
    return """
<div class="titlepage">
<div class="kicker">Yang–Mills en de massakloof</div>
<h1 class="doctitle">Drie stellingen met volledig bewijs</h1>
<div class="subtitle">Wat er over de massakloof van de SU(2)-roostertheorie werkelijk bewezen kan
worden, en welke stap naar het millenniumprobleem ontbreekt</div>
<div class="statusbox">
<p><strong>Dit document bevat geen bewijs van het millenniumprobleem.</strong> Het probleem
“Yang–Mills: bestaan en massakloof” is open. De drie stellingen in dit document zijn bekende
resultaten over de roosterversie van de theorie; zij lossen het probleem niet op en ook geen
deel ervan.</p>
<p>De bewijzen zijn geschreven en nagelopen door een AI-systeem. Geen wiskundige heeft dit
document beoordeeld.</p>
</div>
<table class="meta">
<tr><td>Bron</td><td><code>yang-mills/BEWIJZEN.md</code></td></tr>
<tr><td>Versie</td><td>commit <code>%s</code>, %s</td></tr>
<tr><td>Numerieke toetsen</td><td><code>tests/test_proofs_ab.py</code>, <code>tests/test_proofs_c.py</code></td></tr>
</table>
</div>
""" % (html.escape(commit), html.escape(date_nl))


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
            '<a href="#%s"%s><span>%s</span><span class="pg">%d</span></a>'
            % (m.group(1), m.group(2), m.group(3), n))

    nav = re.sub(r'<a href="#([^"]+)"([^>]*)>(.*?)</a>', repl, page_html[i:j], flags=re.S)
    return page_html[:i] + nav + page_html[j:], ids


def main():
    global SOURCE, OUTPUT
    args = sys.argv[1:]
    for flag in ("--source", "--output"):      # for trial builds of a draft
        if flag in args:
            value = os.path.abspath(args[args.index(flag) + 1])
            if flag == "--source":
                SOURCE = value
            else:
                OUTPUT = value
    os.makedirs(BUILD, exist_ok=True)
    with io.open(SOURCE, encoding="utf-8") as fh:
        text = fh.read()
    first, _, rest = text.partition("\n")
    if not first.startswith("# "):
        raise SystemExit("make_bewijzen_pdf: BEWIJZEN.md must start with its title")
    commit = git("log", "-1", "--format=%h", "--", "BEWIJZEN.md") or "nog niet vastgelegd"
    stamp = git("log", "-1", "--format=%cs", "--", "BEWIJZEN.md")
    if stamp:
        y, mth, dd = stamp.split("-")
        date_nl = "%d %s %s" % (int(dd), MONTHS[int(mth) - 1], y)
    else:
        date_nl = "datum onbekend"

    body, store = extract_math("## Vooraf\n" + rest)
    paths = {k: os.path.join(BUILD, v) for k, v in (
        ("doc", "document.md"), ("title", "title.html"), ("head", "head.html"),
        ("tpl", "template.html"), ("html0", "BEWIJZEN_pass1.html"), ("html", "BEWIJZEN.html"))}
    with io.open(paths["doc"], "w", encoding="utf-8") as fh:
        fh.write(body)
    with io.open(paths["title"], "w", encoding="utf-8") as fh:
        fh.write(title_page(commit, date_nl))
    with io.open(os.path.join(HERE, "style_bewijzen.css"), encoding="utf-8") as fh:
        css = fh.read()
    with io.open(paths["head"], "w", encoding="utf-8") as fh:
        fh.write("<style>\n" + font_css() + "\n" + css + "\n</style>\n")
    with io.open(paths["tpl"], "w", encoding="utf-8") as fh:
        fh.write(TEMPLATE)

    subprocess.run([
        "pandoc", paths["doc"], "-f", "gfm", "-t", "html5", "--standalone",
        "--columns=10000", "--toc", "--toc-depth=3", "--template", paths["tpl"],
        "--metadata", "pagetitle=Yang–Mills en de massakloof: drie stellingen met volledig bewijs",
        "--include-in-header", paths["head"], "--include-before-body", paths["title"],
        "-o", paths["html0"]], check=True, cwd=ROOT)
    with io.open(paths["html0"], encoding="utf-8") as fh:
        page = fh.read()
    page, counts, wide = insert_math(page, store)
    with io.open(paths["html0"], "w", encoding="utf-8") as fh:
        fh.write(page)
    for w, tex in wide:
        print("make_bewijzen_pdf: WIDE formula (%.0f pt > %.0f pt): %s" % (w, TEXT_WIDTH_PT, tex[:100]))
    if wide and "--allow-wide" not in sys.argv:
        raise SystemExit("make_bewijzen_pdf: %d display formulas are wider than the page; "
                         "break them with an aligned environment" % len(wide))

    printer = ["node", os.path.join(HERE, "print_pdf.js")]
    subprocess.run(printer + [paths["html0"], OUTPUT, FOOTER, str(SIDE_MM)], check=True, cwd=HERE)
    pages, n_pages = destination_pages(OUTPUT)
    for _ in range(3):
        numbered, ids = toc_with_pages(page, pages)
        missing = [i for i in ids if i not in pages]
        if missing:
            raise SystemExit("make_bewijzen_pdf: no page found for contents entries: "
                             + ", ".join(missing))
        with io.open(paths["html"], "w", encoding="utf-8") as fh:
            fh.write(numbered)
        subprocess.run(printer + [paths["html"], OUTPUT, FOOTER, str(SIDE_MM)], check=True, cwd=HERE)
        again, n_pages = destination_pages(OUTPUT)
        if all(again.get(i) == pages[i] for i in ids):
            break
        pages = again
    else:
        raise SystemExit("make_bewijzen_pdf: page numbers of the contents did not settle")
    print("make_bewijzen_pdf: %d pages; formulas: %d display, %d display inside text, %d inline "
          "(%d distinct images); commit %s; wrote %s"
          % (n_pages, counts["D"], counts["E"], counts["I"], len(_CACHE), commit, OUTPUT))


if __name__ == "__main__":
    main()
