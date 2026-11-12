import sys, logging
logging.disable(logging.CRITICAL)
import pdfplumber
for path in sys.argv[1:]:
    pdf = pdfplumber.open(path)
    out = []
    for i, page in enumerate(pdf.pages, 1):
        ws = [w for w in page.extract_words() if w['top'] < 800]
        first = ' '.join(w['text'] for w in sorted(ws, key=lambda w: (round(w['top']), w['x0']))[:4])
        out.append("%d:%.0f[%s]" % (i, max(w['bottom'] for w in ws), first[:28]))
    print(path.split('/')[-1], len(pdf.pages), 'pages'); print('   ' + '  '.join(out[4:27]))
