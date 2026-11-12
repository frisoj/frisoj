#!/usr/bin/env python3
"""Build the map private-use code point -> real character from the /ActualText spans of the PDF,
so that pdfplumber (which ignores ActualText) can be used on REPORT_v1.pdf."""
import re, json, collections, sys
from pypdf import PdfReader

QA = "/tmp/claude-0/-home-user-frisoj/c2e79863-26e2-54ce-9b2d-e39a90258140/scratchpad/qa"
r = PdfReader(QA + "/REPORT_v1.pdf")


def parse_tounicode(data):
    m = {}
    for blk in re.findall(r"beginbfchar(.*?)endbfchar", data, flags=re.S):
        for a, b in re.findall(r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", blk):
            m[int(a, 16)] = "".join(chr(int(b[i:i + 4], 16)) for i in range(0, len(b), 4))
    for blk in re.findall(r"beginbfrange(.*?)endbfrange", data, flags=re.S):
        for a, b, c in re.findall(r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", blk):
            for k in range(int(a, 16), int(b, 16) + 1):
                m[k] = chr(int(c, 16) + k - int(a, 16))
    return m


def actual(s):
    """decode the ActualText operand (literal or hex string)."""
    s = s.strip()
    if s.startswith("<"):
        h = s.strip("<>")
        b = bytes.fromhex(h)
        if b[:2] == b"\xfe\xff":
            return b[2:].decode("utf-16-be")
        return b.decode("latin1")
    body = s[1:-1]
    body = re.sub(r"\\([()\\])", r"\1", body)
    if body.startswith("\xfe\xff"):
        return body.encode("latin1")[2:].decode("utf-16-be")
    return body


pua = collections.defaultdict(collections.Counter)
n_span = 0
multi = collections.Counter()
for pno, page in enumerate(r.pages):
    fonts = page["/Resources"].get("/Font", {})
    tu = {}
    for k, v in fonts.items():
        f = v.get_object()
        if "/ToUnicode" in f:
            tu[k] = parse_tounicode(f["/ToUnicode"].get_object().get_data().decode("latin1"))
    data = page.get_contents().get_data().decode("latin1")
    cur = None
    pos = 0
    tok = re.compile(r"(/F\d+) [\d.]+ Tf|/Span<</ActualText (\(.*?(?<!\\)\)|<[0-9A-Fa-f]*>) ?>> BDC(.*?)EMC", re.S)
    for m in tok.finditer(data):
        if m.group(1):
            cur = m.group(1)
            continue
        n_span += 1
        txt = actual(m.group(2))
        inner = m.group(3)
        codes = []
        f = cur
        for mm in re.finditer(r"(/F\d+) [\d.]+ Tf|<([0-9A-Fa-f]+)> Tj|\[(.*?)\] TJ", inner, flags=re.S):
            if mm.group(1):
                f = mm.group(1)
            elif mm.group(2):
                h = mm.group(2)
                codes += [(f, int(h[i:i + 2], 16)) for i in range(0, len(h), 2)]
            else:
                for h in re.findall(r"<([0-9A-Fa-f]+)>", mm.group(3)):
                    codes += [(f, int(h[i:i + 2], 16)) for i in range(0, len(h), 2)]
        cur = f
        us = [tu.get(ff, {}).get(c, "?") for ff, c in codes]
        if len(us) == 1 and len(txt) == 1:
            pua[us[0]][txt] += 1
        else:
            multi[(txt, "".join(us))] += 1

out = {}
amb = 0
for k, c in sorted(pua.items()):
    if len(c) > 1:
        amb += 1
        print("AMBIGUOUS", hex(ord(k)) if len(k) == 1 else k, dict(c))
    out[k] = c.most_common(1)[0][0]
print("spans:", n_span, " distinct single-glyph source code points:", len(out), " ambiguous:", amb)
print("multi-glyph or multi-char spans:", sum(multi.values()), dict(list(multi.most_common(25))))
print({(hex(ord(k)) if len(k) == 1 else k): v for k, v in out.items()})
json.dump(out, open(QA + "/numverify/pua_map.json", "w"), ensure_ascii=True)
