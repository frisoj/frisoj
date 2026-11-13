#!/usr/bin/env python3
"""Read-only re-run of review/numcheck/check2.py and check4.py (import chain) to see how the count
'OK count 124' of check4.txt splits between the two scripts, and which labels are counted."""
import sys, io, contextlib, re
sys.dont_write_bytecode = True
sys.path.insert(0, "/home/user/frisoj/yang-mills")
sys.path.insert(0, "/home/user/frisoj/yang-mills/review/numcheck")
import lib
labels = []
orig = lib.chk
def chk(label, tok, v, e, quiet=True):
    r = orig(label, tok, v, e, quiet)
    labels.append((label, tok, r))
    return r
lib.chk = chk
buf2 = io.StringIO()
with contextlib.redirect_stdout(buf2):
    import check2
n2 = lib.N_OK[0]; l2 = list(labels)
buf4 = io.StringIO()
with contextlib.redirect_stdout(buf4):
    import check4
n4 = lib.N_OK[0]
open("rerun/check2_rerun.txt", "w").write(buf2.getvalue())
open("rerun/check4_rerun.txt", "w").write(buf2.getvalue() + buf4.getvalue())
print("N_OK after check2:", n2, " after check4:", n4, " added by check4:", n4 - n2, " BAD:", len(lib.BAD))
print("chk() calls in check2 (value(error) recomputations):", len(l2))
for lab, tok, r in l2: print("   ", "ok " if r else "BAD", lab, tok)
l4 = labels[len(l2):]
print("chk() calls in check4:", len(l4), " (+2 per literature row counted in the else branch)")
print("check4 added", n4 - n2, "=", len([1 for x in l4 if x[2]]), "value checks +", (n4 - n2) - len([1 for x in l4 if x[2]]), "difference checks")
