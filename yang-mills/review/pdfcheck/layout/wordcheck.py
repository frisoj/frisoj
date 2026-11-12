import re, sys, collections
from html.parser import HTMLParser
pdf_txt, html_path = sys.argv[1], sys.argv[2]
class P(HTMLParser):
    def __init__(s):
        super().__init__(); s.out=[]; s.skip=0
    def handle_starttag(s, tag, attrs):
        if tag in ('style','script','title'): s.skip+=1
        if tag in ('td','th','p','li','h1','h2','h3','h4','tr','div','br','pre'): s.out.append(' ')
    def handle_endtag(s, tag):
        if tag in ('style','script','title'): s.skip-=1
        if tag in ('td','th','p','li','h1','h2','h3','h4','tr','div','pre'): s.out.append(' ')
    def handle_data(s, d):
        if not s.skip: s.out.append(d)
p = P(); p.feed(open(html_path, encoding='utf-8').read())
h = ''.join(p.out)
t = open(pdf_txt, encoding='utf-8').read()
hw = collections.Counter(h.split()); tw = collections.Counter(t.split())
missing = {w: n - tw[w] for w, n in hw.items() if n > tw[w]}
print("html words:", sum(hw.values()), "distinct", len(hw))
print("words of the html that are not found whole in the pdf text (count):", sum(missing.values()), "distinct", len(missing))
for w, n in sorted(missing.items(), key=lambda x: -len(x[0])):
    print("  %3d  %s" % (n, w))
