#!/usr/bin/env python3
"""Text of REPORT_v4.pdf with four extractors, one form feed between pages.
   pdf_layout.txt  pdftotext -layout     pdf_raw.txt   pdftotext (reading order)
   pdf_plumber.txt pdfplumber            pdf_pypdf.txt pypdf        pdf_pdfium.txt pypdfium2"""
import subprocess, os
QA = "/tmp/claude-0/-home-user-frisoj/c2e79863-26e2-54ce-9b2d-e39a90258140/scratchpad/qa"
PDF = os.path.join(QA, "REPORT_v4.pdf")
OUT = os.path.join(QA, "numbers-v4")
subprocess.run(["pdftotext", "-layout", PDF, os.path.join(OUT, "pdf_layout.txt")], check=True)
subprocess.run(["pdftotext", PDF, os.path.join(OUT, "pdf_raw.txt")], check=True)
import pdfplumber
with pdfplumber.open(PDF) as pdf:
    pages = [(p.extract_text() or "") for p in pdf.pages]
open(os.path.join(OUT, "pdf_plumber.txt"), "w", encoding="utf-8").write("\f".join(pages))
print("pdfplumber pages", len(pages))
from pypdf import PdfReader
r = PdfReader(PDF)
pages = [(p.extract_text() or "") for p in r.pages]
open(os.path.join(OUT, "pdf_pypdf.txt"), "w", encoding="utf-8").write("\f".join(pages))
print("pypdf pages", len(pages))
import pypdfium2 as pdfium
doc = pdfium.PdfDocument(PDF)
pages = []
for i in range(len(doc)):
    tp = doc[i].get_textpage()
    pages.append(tp.get_text_range().replace("\r\n", "\n").replace("\r", "\n"))
open(os.path.join(OUT, "pdf_pdfium.txt"), "w", encoding="utf-8").write("\f".join(pages))
print("pdfium pages", len(pages))
