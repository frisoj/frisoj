#!/usr/bin/env python3
"""Reconstruct every table of REPORT_v1.pdf from the cell-border rectangles (pdfplumber geometry)
and the characters inside each cell; writes pdf_tables.json.

Each table cell is drawn with a 0.75 pt bottom border; the header cells have a darker one.  Rows are
the bands between consecutive border lines, columns are the x-intervals of the border rectangles."""
import json, collections, sys, logging
import pdfplumber
logging.disable(logging.CRITICAL)

QA = "/tmp/claude-0/-home-user-frisoj/c2e79863-26e2-54ce-9b2d-e39a90258140/scratchpad/qa"
PUA = json.load(open(QA + "/numverify/pua_map.json"))
HEAD = (0.6667, 0.6941, 0.7333)      # bottom border of th
ROW = (0.851, 0.8667, 0.8902)        # bottom border of td
HEADBG = (0.9255, 0.9373, 0.9529)    # background of th


def col(c):
    return tuple(round(x, 4) for x in c) if isinstance(c, (list, tuple)) else c


def close(a, b):
    return isinstance(a, tuple) and len(a) == len(b) and all(abs(x - y) < 0.002 for x, y in zip(a, b))


def cell_text(chars, x0, x1, top, bottom):
    sel = [c for c in chars if x0 - 0.5 <= (c["x0"] + c["x1"]) / 2 <= x1 + 0.5 and top - 0.5 <= (c["top"] + c["bottom"]) / 2 <= bottom + 0.5]
    # cluster into text lines by vertical centre (line pitch is > 9 pt; code spans and superscripts sit within 4 pt)
    sel.sort(key=lambda c: (c["top"] + c["bottom"]) / 2)
    lines = []
    for c in sel:
        yc = (c["top"] + c["bottom"]) / 2
        if lines and abs(yc - lines[-1][0]) <= 4.0:
            lines[-1][1].append(c)
            lines[-1][0] = sum((d["top"] + d["bottom"]) / 2 for d in lines[-1][1]) / len(lines[-1][1])
        else:
            lines.append([yc, [c]])
    out = []
    for _, cs in lines:
        out.append("".join(PUA.get(c["text"], c["text"]) for c in sorted(cs, key=lambda c: c["x0"])))
    return "\n".join(out)


tables = []      # dicts: page, ncols, rows (list of list of str), has_header, cont
with pdfplumber.open(QA + "/REPORT_v1.pdf") as pdf:
    for pno, page in enumerate(pdf.pages, 1):
        chars = page.chars
        borders = collections.defaultdict(list)
        headbg = collections.defaultdict(list)
        for r in page.rects:
            c = col(r.get("non_stroking_color"))
            if r["height"] < 1.5 and (close(c, HEAD) or close(c, ROW)):
                borders[round(r["top"], 0)].append((round(r["x0"], 1), round(r["x1"], 1), "H" if close(c, HEAD) else "R", r["top"], r["bottom"]))
            elif close(c, HEADBG):
                headbg[round(r["top"], 0)].append((round(r["x0"], 1), round(r["x1"], 1), r["top"], r["bottom"]))
        ys = sorted(borders)
        # merge border groups that are < 1.2 pt apart (rounding)
        groups = []
        for y in ys:
            if groups and y - groups[-1][0] < 1.2 and sorted(set(b[:2] for b in borders[y])) == sorted(set(b[:2] for b in groups[-1][1])):
                continue
            groups.append((y, sorted(borders[y])))
        cur = None
        prev_bottom = None
        for y, bs in groups:
            cols = sorted(set(b[:2] for b in bs))
            kind = bs[0][2]
            top_y, bot_y = bs[0][3], bs[0][4]
            if kind == "H":
                # a header row: its top is the top of the header background with the same columns
                tops = [v for k, v in headbg.items() if sorted(set(h[:2] for h in v)) == cols and abs(sorted(v)[0][3] - bot_y) < 0.1 + 400 and sorted(v)[0][2] < top_y]
                cand = [sorted(v)[0][2] for v in tops if sorted(v)[0][3] <= bot_y + 1.0]
                htop = max(cand) if cand else top_y - 16
                cur = {"page": pno, "cols": cols, "rows": [[cell_text(chars, a, b, htop, top_y) for a, b in cols]], "has_header": True}
                tables.append(cur)
                prev_bottom = bot_y
            else:
                if cur is None or cur["cols"] != cols or cur["page"] != pno:
                    # body rows without a header on this page: continuation from the previous page
                    first_top = min([c["top"] for c in chars if cols[0][0] - 0.5 <= c["x0"] <= cols[-1][1] + 0.5 and c["top"] < top_y and c["top"] > 40] or [42.7])
                    # only chars directly above this border that are not above another structure: take chars between the
                    # previous border on the page (any table) and this one
                    prev = [g[1][0][4] for g in groups if g[0] < y]
                    start = max(prev) if prev else 42.0
                    cur = {"page": pno, "cols": cols, "rows": [], "has_header": False}
                    tables.append(cur)
                    prev_bottom = start
                cur["rows"].append([cell_text(chars, a, b, prev_bottom, top_y) for a, b in cols])
                prev_bottom = bot_y

json.dump(tables, open(QA + "/numverify/pdf_tables.json", "w"), ensure_ascii=False, indent=0)
print("tables (page fragments):", len(tables))
for t in tables:
    print(f"  page {t['page']:2d}  cols {len(t['cols'])}  rows {len(t['rows'])}  header {t['has_header']}  first: {[c[:18] for c in t['rows'][0]][:4]}")
