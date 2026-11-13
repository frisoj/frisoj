#!/bin/bash
# Number verification of REPORT_v4.pdf: commands as run on 13 November 2026 (outputs: out_*.txt in this directory).
cd "$(dirname "$0")"
export NUMBA_NUM_THREADS=1 NUMBA_CACHE_DIR=$PWD/numba_cache PYTHONDONTWRITEBYTECODE=1
python3 extract_all.py                      # pdf_layout/raw/plumber/pypdf/pdfium.txt
python3 pdf_tables.py > out_pdf_tables.txt  # pdf_tables.json
for x in layout plumber pypdf pdfium raw; do python3 check_b.py $x pdf_$x.txt > out_b_$x.txt; done   # raw: reading order breaks the row parser
for x in layout plumber pypdf pdfium; do python3 check_b_flags.py pdf_$x.txt > out_b_flags_$x.txt; done
python3 check_b_complete.py > out_b_complete.txt
python3 make_front_v3.py                    # check_front_v2.py -> check_front_v3.py
for x in pypdf pdfium; do python3 check_front_v3.py pdf_$x.txt > out_front_$x.txt; done
python3 check_tokens.py > out_tokens.txt
python3 cmp_tables.py > out_tables.txt
python3 check_allnums3.py > out_allnums.txt
python3 diff_report.py > out_diff_report.txt
python3 check_toc.py > out_toc.txt
python3 check_textlayer.py > out_textlayer.txt
python3 check_figures.py > out_figures.txt
python3 check_whole_doc.py > out_whole_doc.txt
python3 check_whole_doc_blocks.py > out_whole_doc_blocks.txt
python3 cross_body_b.py > out_cross_body_b.txt
(cd rerun && python3 rerun_evidence.py > ../out_rerun_evidence.txt)
python3 rerun_counts.py > out_rerun_counts.txt
python3 pool14.py > out_pool14.txt
