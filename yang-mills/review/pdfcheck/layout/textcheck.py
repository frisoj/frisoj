import re, sys, collections, html
from html.parser import HTMLParser
pdf_txt, html_path = sys.argv[1], sys.argv[2]
class P(HTMLParser):
    def __init__(s):
        super().__init__(); s.out=[]; s.skip=0
    def handle_starttag(s, tag, attrs):
        if tag in ('style','script','title'): s.skip+=1
    def handle_endtag(s, tag):
        if tag in ('style','script','title'): s.skip-=1
    def handle_data(s, d):
        if not s.skip: s.out.append(d)
p = P(); p.feed(open(html_path, encoding='utf-8').read())
h = ''.join(p.out)
t = open(pdf_txt, encoding='utf-8').read()
# strip footer lines
t2 = re.sub(r'Yang–Mills en de massakloof · numeriek bewijsmateriaal, geen bewijs\s*', '', t)
t2 = re.sub(r'pagina \d+ van \d+\s*', '', t2)
ch = collections.Counter(c for c in h if ord(c)>127)
ct = collections.Counter(c for c in t2 if ord(c)>127)
bad = 0
for c in sorted(set(ch)|set(ct)):
    if ch[c] != ct[c]:
        bad += 1
        print(f"char U+{ord(c):04X} {c!r}: html {ch[c]} pdf {ct[c]}")
print("non-ascii char classes differing:", bad)
# value(error) tokens
tok = re.compile(r'[+\-−]?\d+[.,]\d+\(\d+(?:\.\d+)?\)')
th = collections.Counter(tok.findall(h)); tt = collections.Counter(tok.findall(t2))
print("value(err) tokens html:", sum(th.values()), "distinct", len(th), "| pdf:", sum(tt.values()), "distinct", len(tt))
d = [(k, th[k], tt[k]) for k in set(th)|set(tt) if th[k]!=tt[k]]
print("token count differences:", len(d)); print(d[:40])
# whitespace-free comparison of the whole text
norm = lambda s: re.sub(r'\s+', '', s)
a, b = norm(h), norm(t2)
print("len html", len(a), "len pdf", len(b))
import difflib
if a != b:
    sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
    n=0
    for op,i1,i2,j1,j2 in sm.get_opcodes():
        if op!='equal':
            n+=1
            if n<=40: print(op, repr(a[max(0,i1-25):i2+25]), '=>', repr(b[max(0,j1-25):j2+25]))
    print("diff blocks:", n)
else:
    print("whitespace-free text identical")
