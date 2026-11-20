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
FOOTER = "Yang–Mills op het rooster · drie stellingen met bewijs · geen bewijs van het millenniumprobleem"


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


# symbols after which TeX puts a thin space before an operator name (ln, Tr, a sum sign)
_ORD = set("""alpha beta gamma delta epsilon varepsilon zeta eta theta kappa lambda mu nu xi pi rho
    varrho sigma varsigma tau phi varphi chi psi omega Gamma Delta Theta Lambda Pi Sigma Phi Psi
    Omega ell infty prime rangle partial emptyset""".split())
_OPERATOR = (r"\\(?:operatorname|ln|exp|tanh|sinh|cosh|sin|cos|sup|inf|max|min|lim|det|sum|prod|int)"
             r"(?![a-zA-Z])")
_SCRIPT = r"(\{(?:[^{}]|\{[^{}]*\})*\}|\\[a-zA-Z]+|[a-zA-Z0-9])"      # what follows a _ or ^


def _thin_space(m):
    before = m.group(1)
    if before.startswith("\\") and before[1:] not in _ORD:
        return m.group(0)
    return before + "\\," + m.group(2)


def to_mathtext(tex, display):
    """Translate the LaTeX used in BEWIJZEN.md into what matplotlib's mathtext accepts."""
    s = " ".join(tex.split())
    s = re.sub(r"\\begin\{pmatrix\}(.*?)\\end\{pmatrix\}", _matrix, s)
    s = _SIZED.sub(_sized, s)
    # := and =: are one relation sign each (mathtext sets ": =" with a gap in the middle)
    s = s.replace(":=", "\\coloneq ").replace("=:", "\\eqcolon ")
    # a dagger or star as a bare superscript gets the spaces of a binary operator: brace it
    s = re.sub(r"([_^])\s*\\(dagger|ast)(?![a-zA-Z])", r"\1{\\\2}", s)
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
    # \mathsf is upright in LaTeX; mathtext slants it unless it is told not to
    s = re.sub(r"\\mathsf\{([^{}]*)\}", r"\\mathrm{\\mathsf{\1}}", s)
    # a prime: mathtext sets u' with a tiny mark far from the letter, as a superscript too; the
    # full-size prime sits where it should.  A subscript (u'_e, I_n') is pulled back under it.
    s = re.sub(r"'\s*_\s*" + _SCRIPT, r"\\prime\\hspace{-0.26}_\1", s)
    s = re.sub(r"_\s*" + _SCRIPT + r"\s*'", r"\\prime\\hspace{-0.26}_\1", s)
    s = s.replace("'", "\\prime ")
    # a thin space between a symbol and the operator name after it (mathtext sets "Lln", "2Tr")
    s = re.sub(r"(\\[a-zA-Z]+|[A-Za-z0-9})\]])\s*(" + _OPERATOR + ")", _thin_space, s)
    # no space between an operator name and a sized bracket: "Tr[", "exp(" (mathtext only leaves
    # the space out before a plain bracket)
    s = re.sub(r"(\\(?:operatorname\{[^{}]*\}|(?:ln|exp|tanh|sinh|cosh|sin|cos|det)(?![a-zA-Z])))"
               r"\s*(?=\\left)", r"\1\\!", s)
    # a sign after a comma or a named relation is a sign, not an operation: without braces
    # mathtext puts the space of a binary operator after it ("\geq -\ln" became "≥ − ln")
    s = re.sub(r"(\\(?:coloneq|eqcolon|leq|geq|neq|approx|equiv|to|mapsto|in)(?![a-zA-Z])|,)"
               r"((?:\s|\\ |\\,)*)([-+])", r"\1\2{\3}", s)
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


def ink_extent(parser, src, prop):
    """Where the ink of a typeset formula is, in points: (left, right, top, bottom).

    left and right are measured from the left edge of the formula, top and bottom upwards from
    its baseline.  mathtext itself reports the size rounded up to whole points and without the
    overhang of slanted letters: an image cut to that size clips an italic f or j at its edge
    and has up to a point of air elsewhere.
    This reads matplotlib internals (written for matplotlib 3.11).
    """
    try:
        from matplotlib import _mathtext
        from matplotlib.ft2font import LoadFlags
        big = prop.copy()
        big.set_size(100.0)             # the svg backend lays a formula out at 100 pt and scales it
        k = prop.get_size_in_points() / 100.0
        fontset = parser._font_type_mapping[prop.get_math_fontfamily()](big, LoadFlags.NO_HINTING)
        box = parser._parser.parse(src, fontset, 100.0, 72)
        out = _mathtext.ship(box)
        xs, ys = [], []
        for ox, oy, info in out.glyphs:            # oy runs downwards from the top of the box
            xs += [ox + info.metrics.xmin, ox + info.metrics.xmax]
            ys += [box.height - oy + info.metrics.ymin, box.height - oy + info.metrics.ymax]
        for x, y, w, h in out.rects:               # fraction bars, overlines, root signs
            xs += [x, x + w]
            ys += [box.height - y - h, box.height - y]
    except (ImportError, AttributeError, KeyError, TypeError) as exc:
        raise SystemExit("make_bewijzen_pdf: cannot measure a formula with this matplotlib "
                         "(%s); ink_extent needs to be adapted" % exc)
    if not xs:                                     # nothing visible: keep the box of mathtext
        return 0.0, k * box.width, k * box.height, -k * box.depth
    return k * min(xs), k * max(xs), k * max(ys), k * min(ys)


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
        parser.parse(src, dpi=72, prop=prop)
    except Exception as exc:
        raise SystemExit("make_bewijzen_pdf: cannot typeset the formula\n  %s\nas mathtext\n  %s\n%s"
                         % (tex, src, exc))
    # the image is cut to the ink, with a hair of room around it
    left, right, top, bottom = ink_extent(parser, src, prop)
    side, pad = 0.35, 0.5
    w, h = (right - left) + 2 * side, (top - bottom) + 2 * pad
    below = pad - bottom                         # from the lower edge of the image up to the baseline
    name = "m_" + hashlib.sha256(repr(key).encode("utf-8")).hexdigest()[:20] + ".svg"
    path = os.path.join(BUILD, name)
    with matplotlib.rc_context({"svg.fonttype": "path", "svg.hashsalt": name}):
        fig = Figure(figsize=(w / 72.0, h / 72.0))
        FigureCanvasSVG(fig)
        fig.text((side - left) / w, below / h, src, fontproperties=prop, color=INK)
        fig.savefig(path, format="svg", transparent=True, dpi=72,
                    metadata={"Date": None, "Creator": None})
    _CACHE[key] = (path, w, h, below)
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
    # a formula and the bracket, punctuation mark or hyphen next to it stay on one line
    page = re.sub(r'([(\[]*)(<img class="m[^>]*>)([)\],.;:!?-]*)',
                  lambda m: m.group(0) if not (m.group(1) or m.group(3))
                  else '<span class="nb">%s</span>' % m.group(0), page)
    # a file name in running text may break after a slash or an underscore
    page = re.sub(r"<code>([^<]*)</code>",
                  lambda m: "<code>%s</code>" % re.sub(r"([/_])(?=.)", r"\1<wbr>", m.group(1)), page)
    return protect_titles(page), counts, wide


def protect_titles(page):
    """Titles in the literature list are English or German: keep the Dutch hyphenation off them.

    An entry of that list is a list item with one of the marks of chapter 7; a title is what
    stands between double quotes or in italics.
    """
    def entry(m):
        if "\u2714" not in m.group(0) and "\u25cb" not in m.group(0) and "\u25ef" not in m.group(0):
            return m.group(0)
        out, inside = [], False
        for part in re.split(r"(<[^>]+>)", m.group(0)):
            if part.startswith("<"):
                out.append('<em class="titel">' if part == "<em>" else part)
                continue
            for i, piece in enumerate(part.split('"')):
                if i:
                    out.append('"</span>' if inside else '<span class="titel">"')
                    inside = not inside
                out.append(piece)
        return m.group(0) if inside else "".join(out)      # unbalanced quotes: leave it alone

    return re.sub(r"<li>(?:(?!<li>).)*?</li>", entry, page, flags=re.S)


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
<div class="kicker">Yang–Mills op het rooster</div>
<h1 class="doctitle">Drie bekende stellingen over de massakloof, met uitgeschreven bewijs</h1>
<div class="subtitle">Wat er met betrekkelijk eenvoudige middelen over de massakloof van de
SU(2)-roostertheorie te bewijzen valt, en welke stappen naar het millenniumprobleem ontbreken</div>
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
        "--metadata", "pagetitle=Yang–Mills op het rooster: drie bekende stellingen over de massakloof, met uitgeschreven bewijs",
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
