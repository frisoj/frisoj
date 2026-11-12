import re, sys, html, collections
pdf_txt, html_path = sys.argv[1], sys.argv[2]
src = open(html_path, encoding='utf-8').read()
body = src[src.index('<body>'):]
body_nopre = re.sub(r'<pre.*?</pre>', ' ', body, flags=re.S)
codes = [html.unescape(re.sub(r'<[^>]+>', '', c)) for c in re.findall(r'<code[^>]*>(.*?)</code>', body_nopre, flags=re.S)]
t = open(pdf_txt, encoding='utf-8').read()
toks = collections.Counter(tok for c in codes for tok in c.split())
tw = collections.Counter()
# count occurrences as substrings (pdftotext may glue punctuation)
broken = []
for tok, n in toks.items():
    found = t.count(tok)
    if found < n:
        broken.append((tok, n, found))
print("inline code elements:", len(codes), "tokens:", sum(toks.values()), "distinct:", len(toks))
print("tokens not found whole often enough (broken across a line):", len(broken))
for b in broken: print("  ", b)
# also: value(err) tokens and all numbers with decimal point/comma are whole
nums = collections.Counter(re.findall(r'\d+[.,]\d+', re.sub(r'<[^>]+>', '', html.unescape(body))))
bad = [(k, n, len(re.findall(r'(?<![\d.,])' + re.escape(k) + r'(?![\d])', t))) for k, n in nums.items()]
bad = [b for b in bad if b[2] < b[1]]
print("decimal numbers in html:", sum(nums.values()), "distinct", len(nums), "| not found whole often enough:", len(bad), bad[:20])
