"""EXPLORATORY: two-state correlated fit (C(0)=1 exact) of the ground-state projected 0++ correlator at beta=2.5,
pipeline subset and pipeline subset + torelon-pair operator; Delta chi2 at literature masses. Read-only."""
import sys, json, math
sys.path.insert(0,'/home/user/frisoj/yang-mills'); sys.dont_write_bytecode=True
import numpy as np
from scipy import optimize
import analyze
from ym import stats
P='/home/user/frisoj/yang-mills/'
name='d4_b2.5_L16_combined'
d=json.load(open(P+'results/'+name+'.json')); T=d['T']; B=d['binsize']
S=[]
for s in (601,602,603,604,605,606,607,608):
    base='d4_b2.5_L16' if s<605 else 'd4_b2.5_L16x'
    meta,a=analyze.load_raw(P+'results/raw/%s_s%d.npz'%(base,s)); S.append({k:np.asarray(a[k],dtype=np.float64) for k in ('glue','torelon')})
labs=list(d['glueball']['gevp']['operators']); sel=[labs.index(x) for x in d['glueball']['gevp']['selected']]
nlev=S[0]['torelon'].shape[2]; K=len(labs)
ext=[np.concatenate([s['glue'],((s['torelon'][:,:,nlev-1,:]**2).sum(axis=1))[:,None,:]],axis=1) for s in S]
re=stats.analyze_channel(ext,T,B,subtract_vev=True,do_fit=False)
C=re['C']; Cj=re['C_jk']; nb=Cj.shape[0]
def proj(idx,Cm):
    nrm=np.sqrt(np.array([C[k,k,0] for k in idx])); Ch=Cm[np.ix_(idx,idx)]/np.outer(nrm,nrm)[:,:,None]
    lam,vec=stats.solve_gevp(Ch,0); cp=np.einsum('k,klt,l->t',vec[:,0],Ch,vec[:,0]); return cp/cp[0]
def f(m,t): return np.exp(stats._logcosh(m*(t-0.5*T))-stats._logcosh(m*0.5*T))
for lab,idx in (('pipeline subset',sel),('pipeline subset + W',sel+[K])):
    y0=proj(idx,C); yj0=np.array([proj(idx,Cj[b]) for b in range(nb)])
    for tmax in (4,5):
        ts=np.arange(1,tmax+1); y=y0[ts]; yj=yj0[:,ts]
        cov=(nb-1)/nb*((yj-yj.mean(0)).T@(yj-yj.mean(0))); ci=np.linalg.inv(cov)
        def chi2(A,m,dm):
            if not (0<A<=1 and m>0 and dm>0): return 1e9
            r=y-(A*f(m,ts)+(1-A)*f(m+dm,ts)); return float(r@ci@r)
        def prof(m):
            bb=1e9
            for A0 in (0.4,0.6,0.8,0.95):
                for dm0 in (0.15,0.4,1.0,2.5):
                    r=optimize.minimize(lambda q: chi2(q[0],m,q[1]),[A0,dm0],method='Nelder-Mead',options={'xatol':1e-9,'fatol':1e-11,'maxiter':20000})
                    if r.fun<bb: bb=r.fun; bx=r.x
            return bb,bx
        grid=np.linspace(0.55,0.80,101); pv=[prof(m) for m in grid]; c=np.array([p[0] for p in pv]); i=int(c.argmin())
        ok1=grid[c<=c[i]+1]; ok4=grid[c<=c[i]+4]
        s='  %-20s t=1..%d: best m=%.4f (A=%.3f, m\'=%.3f) chi2=%.2f/%d ; dchi2<=1: [%.3f,%.3f] ; <=4: [%.3f,%.3f]'%(lab,tmax,grid[i],pv[i][1][0],grid[i]+pv[i][1][1],c[i],len(ts)-3,ok1.min(),ok1.max(),ok4.min(),ok4.max())
        for mh in (0.660,0.6857,0.72):
            ph=prof(mh); s+=' ; m=%.4f: dchi2=%.2f (A=%.2f, m\'=%.2f)'%(mh,ph[0]-c[i],ph[1][0],mh+ph[1][1])
        print(s)
    # single-exponential check on t=1..4 and t=2..5 (correlated), to show what a plain plateau fit gives
    for (t1,t2) in ((1,4),(2,5),(1,6)):
        ts=np.arange(t1,t2+1); y=y0[ts]; yj=yj0[:,ts]
        cov=(nb-1)/nb*((yj-yj.mean(0)).T@(yj-yj.mean(0))); ci=np.linalg.inv(cov)
        def c1(p):
            r=y-p[0]*f(p[1],ts); return float(r@ci@r)
        r=optimize.minimize(c1,[0.9,0.74],method='Nelder-Mead',options={'xatol':1e-10,'fatol':1e-12})
        mj=[]
        for b in range(nb):
            yb=yj0[b,ts]
            rb=optimize.minimize(lambda p: float((yb-p[0]*f(p[1],ts))@ci@(yb-p[0]*f(p[1],ts))),r.x,method='Nelder-Mead',options={'xatol':1e-9,'fatol':1e-12})
            mj.append(rb.x[1])
        mj=np.array(mj); e=math.sqrt((nb-1)/nb*((mj-mj.mean())**2).sum())
        print('  %-20s correlated single-cosh fit t=%d..%d: m=%.4f(%.4f) chi2=%.2f/%d'%(lab,t1,t2,r.x[1],e,r.fun,len(ts)-2))
