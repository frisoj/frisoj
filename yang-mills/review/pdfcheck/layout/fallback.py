import sys, logging, collections
logging.disable(logging.CRITICAL)
import pdfplumber
pdf = pdfplumber.open(sys.argv[1])
c = collections.Counter(); pages = collections.defaultdict(set)
allfonts = collections.Counter()
for i, page in enumerate(pdf.pages, 1):
    for ch in page.chars:
        fn = ch['fontname'].split('+')[-1]
        allfonts[fn] += 1
        if fn.startswith('DejaVuSans') and 'Mono' not in fn:
            c[(fn, ch['text'])] += 1; pages[(fn, ch['text'])].add(i)
print(allfonts)
for k, n in sorted(c.items()):
    print(k, n, 'pages', sorted(pages[k])[:12])
