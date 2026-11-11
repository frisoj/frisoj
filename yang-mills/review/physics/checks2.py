"""Physics review, part 2 (EXPLORATORY, post hoc, not part of the pre-registered rules):
excited-state contamination of m_eff(1), GEVP with t0=1, torelon-pair operator in the 0++ channel.
Raw data are opened READ ONLY through analyze.load_raw; nothing is written into the project."""
import sys, os, json, math, glob
sys.path.insert(0,'/home/user/frisoj/yang-mills')
sys.dont_write_bytecode=True
import numpy as np
from scipy import optimize, stats as sst
import analyze
from ym import stats
P='/home/user/frisoj/yang-mills/'
ens_files={
 'd4_b2.3_L10':['d4_b2.3_L10_s%d.npz'%s for s in (201,202,203,204)],
 'd4_b2.4_L12':['d4_b2.4_L12_s%d.npz'%s for s in (401,402,403,404)],
 'd4_b2.4_L16':['d4_b2.4_L16_s%d.npz'%s for s in (701,702,703,704)],
 'd4_b2.5_L16':['d4_b2.5_L16_s%d.npz'%s for s in (601,602,603,604)],
 'd4_b2.5_L16x':['d4_b2.5_L16x_s%d.npz'%s for s in (605,606,607,608)],
 'd4_b2.5_L16_combined':['d4_b2.5_L16_s%d.npz'%s for s in (601,602,603,604)]+['d4_b2.5_L16x_s%d.npz'%s for s in (605,606,607,608)],
 'd3_b6.0_L16':['d3_b6.0_L16_s%d.npz'%s for s in (101,102,103,104)],
 'd3_b6.0_L24':['d3_b6.0_L24_s%d.npz'%s for s in (801,802,803,804)],
 'd3_b9.0_L24_combined':['d3_b9.0_L24_s%d.npz'%s for s in (301,302,303,304)]+['d3_b9.0_L24r_s%d.npz'%s for s in (305,306,307,308)],
 'd3_b12.0_L32':['d3_b12.0_L32_s%d.npz'%s for s in (501,502,503,504)],
}
lit_m={'d4_b2.3_L10':(1.216,0.023),'d4_b2.4_L12':(0.936,0.023),'d4_b2.4_L16':(0.936,0.023),
       'd4_b2.5_L16':(0.660,0.022),'d4_b2.5_L16x':(0.660,0.022),'d4_b2.5_L16_combined':(0.660,0.022),
       'd3_b6.0_L16':(1.19,0.02),'d3_b6.0_L24':(1.19,0.02),'d3_b9.0_L24_combined':(0.765,0.01),'d3_b12.0_L32':(0.559,0.008)}
which=sys.argv[1:] or list(ens_files)
def f(m,t,T): return np.exp(stats._logcosh(m*(t-0.5*T))-stats._logcosh(m*0.5*T))
def two_state_predict(c1,c2,mh,T,tpred=3):
    """C(t)=A f(mh,t)+(1-A) f(m',t), C(0)=1; solve A,m' from C(1),C(2); return (C(tpred), A, m') or None"""
    f1,f2=f(mh,1,T),f(mh,2,T)
    def res(mp):
        g1,g2=f(mp,1,T),f(mp,2,T)
        A=(c1-g1)/(f1-g1)
        return A*f2+(1-A)*g2-c2
    xs=np.concatenate([mh+np.geomspace(1e-3,20,400)])
    vals=[res(x) for x in xs]
    for i in range(len(xs)-1):
        if np.isfinite(vals[i]) and np.isfinite(vals[i+1]) and vals[i]*vals[i+1]<0:
            mp=optimize.brentq(res,xs[i],xs[i+1],xtol=1e-12)
            A=(c1-f(mp,1,T))/(f1-f(mp,1,T))
            if 0<A<1:
                return A*f(mh,tpred,T)+(1-A)*f(mp,tpred,T),A,mp
    return None
def jk_err(x):
    x=np.asarray(x,float); n=len(x); return math.sqrt((n-1)/n*((x-x.mean())**2).sum())
out={}
for name in which:
    d=json.load(open(P+'results/'+name+'.json'))
    T=d['T']; B=d['binsize']; D=d['D']
    S=[]
    for fn in ens_files[name]:
        meta,a=analyze.load_raw(P+'results/raw/'+fn)
        S.append({k:np.asarray(a[k],dtype=np.float64) for k in ('glue','torelon')})
    rg=stats.analyze_channel([s['glue'] for s in S],T,B,subtract_vev=True)
    assert abs(rg['mass']-d['glueball']['am'])<1e-12 and abs(rg['err']-d['glueball']['am_err'])<1e-12, 'pipeline not reproduced'
    Cp=rg['Cproj']/rg['Cproj'][0]; Cjk=rg['Cproj_jk']/rg['Cproj_jk'][:,:1]
    nb=Cjk.shape[0]
    me=rg['meff']
    m0,m1,m2=me['m_cosh'][:3]; e0,e1,e2=me['err_cosh'][:3]
    print('=====',name,'T',T,'bins',nb,'binsize',B,' pipeline reproduced: a*m(R5) = %.4f(%.4f)'%(rg['mass'],rg['err']))
    print('  m_eff(0,1,2,3) = %s'%' '.join('%.4f(%.4f)'%(me['m_cosh'][t],me['err_cosh'][t]) for t in range(4)))
    d0=me['m_cosh_jk'][:,0]-me['m_cosh_jk'][:,1]; d1=me['m_cosh_jk'][:,1]-me['m_cosh_jk'][:,2]
    D0,D1=m0-m1,m1-m2; D0e,D1e=jk_err(d0),jk_err(d1)
    print('  d0 = m_eff(0)-m_eff(1) = %.4f(%.4f)  [%.1f %% of m_eff(1)] ; d1 = m_eff(1)-m_eff(2) = %.4f(%.4f)'%(D0,D0e,100*D0/m1,D1,D1e))
    lev2=-math.log(rg['gevp']['eigenvalues'][1]) if len(rg['gevp']['eigenvalues'])>1 and rg['gevp']['eigenvalues'][1]>0 else float('nan')
    print('  GEVP second level -ln(lambda_1) = %.3f (upper estimate of the first excited state); gap to m_eff(1): %.3f'%(lev2,lev2-m1))
    # single-excited-state bracket: delta(1)=m_eff(1)-m_true = d0*r/(1-r) for contamination decaying like r^t; data constraint d1=delta(1)*(1-r)
    for lab,gap in (('gap = level2 - m_eff(1)',lev2-m1),('gap = 0.6*m_eff(1)',0.6*m1),('gap = 2E_torelon - m_eff(1)',2*d['torelon']['fixed_t']['t1']['m']-m1)):
        if not (gap>0): continue
        r=math.exp(-gap); dl=D0*r/(1-r)
        print('   if ALL t=0 contamination sits in one state with %-28s= %.3f: r=%.2f, implied bias of m_eff(1) = %.3f (%.0f %%), implied d1 = %.4f vs measured %.4f(%.4f): %+.1f sigma'%(lab,gap,r,dl,100*dl/m1,dl*(1-r),D1,D1e,(D1-dl*(1-r))/D1e))
        print('      data alone (d1) allow a bias of m_eff(1) up to %.3f (1 sigma) / %.3f (2 sigma) for this gap'%(max(0,(D1+D1e))/(1-r),max(0,(D1+2*D1e))/(1-r)))
    # two-state hypothesis test with the literature mass
    mh,mhe=lit_m[name]
    for hyp in (mh,mh+mhe,mh-mhe):
        pr=two_state_predict(Cp[1],Cp[2],hyp,T)
        if pr is None:
            print('  H: true mass = %.3f : no two-state solution with positive weights (hypothesis mass not below what C(1),C(2) allow)'%hyp); continue
        c3,A,mp=pr
        sj=[]
        for b in range(nb):
            q=two_state_predict(Cjk[b,1],Cjk[b,2],hyp,T)
            sj.append(np.nan if q is None else math.log(Cjk[b,3]/q[0]))
        sj=np.array(sj); nbad=int(np.isnan(sj).sum())
        s=math.log(Cp[3]/c3)
        se=jk_err(sj[np.isfinite(sj)]) if nbad<nb-2 else float('nan')
        print('  H: true mass = %.3f with ONE excited state: needs A=%.3f, m\'=%.3f; predicts m_eff(2)=%.4f (measured %.4f(%.4f)); ln[C(3)meas/C(3)pred] = %+.4f(%.4f) -> %+.2f sigma%s'%(hyp,A,mp,math.log(Cp[2]/c3) if True else 0,m2,e2,s,se,s/se,' [%d jk samples without solution]'%nbad if nbad else ''))
    # correlated two-state fit, C(0)=1 exact: C(t)=A f(m,t)+(1-A) f(m',t), t=1..tmax
    for tmax in (4,5):
        ts=np.arange(1,tmax+1)
        y=Cp[ts]; yj=Cjk[:,ts]
        cov=(nb-1)/nb*((yj-yj.mean(0)).T@(yj-yj.mean(0)))
        ci=np.linalg.inv(cov)
        def chi2(p):
            A,m,dm=p
            if not (0<A<=1 and m>0 and dm>0): return 1e9
            mod=A*f(m,ts,T)+(1-A)*f(m+dm,ts,T); r=y-mod; return float(r@ci@r)
        best=None
        for A0 in (0.6,0.8,0.95):
            for dm0 in (0.3,0.8,2.0):
                r=optimize.minimize(chi2,[A0,m1,dm0],method='Nelder-Mead',options={'xatol':1e-9,'fatol':1e-10,'maxiter':20000})
                if best is None or r.fun<best.fun: best=r
        # profile in m
        def prof(m):
            bb=None
            for A0 in (0.5,0.8,0.95):
                for dm0 in (0.2,0.8,2.0):
                    r=optimize.minimize(lambda q: chi2([q[0],m,q[1]]),[A0,dm0],method='Nelder-Mead',options={'xatol':1e-9,'fatol':1e-10,'maxiter':20000})
                    if bb is None or r.fun<bb.fun: bb=r
            return bb.fun,bb.x
        mb=best.x[1]; c0=best.fun
        grid=np.linspace(0.5*mb,1.15*mb,131)
        pv=np.array([prof(m)[0] for m in grid])
        ok1=grid[pv<=c0+1]; ok4=grid[pv<=c0+4]
        ph=prof(lit_m[name][0])
        print('  correlated two-state fit t=1..%d (C(0)=1 exact): m=%.4f A=%.3f m\'=%.3f chi2=%.2f/%d ; Delta chi2<=1: m in [%.3f,%.3f]; <=4: [%.3f,%.3f]%s ; at literature m=%.3f: Delta chi2 = %.2f (A=%.2f, m\'=%.2f)'%(tmax,mb,best.x[0],mb+best.x[2],c0,len(ts)-3,ok1.min(),ok1.max(),ok4.min(),ok4.max(),' (lower edge of scan!)' if ok4.min()<=grid[0]+1e-9 else '',lit_m[name][0],ph[0]-c0,ph[1][0],lit_m[name][0]+ph[1][1]))
    labs0=list(d['glueball']['gevp']['operators'])
    # GEVP with t0=1 (exploratory)
    try:
        r1=stats.analyze_channel([s['glue'] for s in S],T,B,subtract_vev=True,t0=1)
        mm=r1['meff']
        print('  GEVP t0=1 (exploratory; subset %s): m_eff(1,2,3) = %s ; n_fallback %d'%([labs0[i] for i in r1['gevp']['selected']],' '.join('%.4f(%.4f)'%(mm['m_cosh'][t],mm['err_cosh'][t]) for t in (1,2,3)),r1['gevp']['n_fallback']))
    except Exception as ex:
        print('  GEVP t0=1 failed:',ex)
    # torelon-pair operator W_l(t) = sum_dir Phi_dir,l(t)^2 for the two largest smearing levels
    nlev=S[0]['torelon'].shape[2]
    labs=list(d['glueball']['gevp']['operators'])
    ext=[]
    for s in S:
        W=[(s['torelon'][:,:,l,:]**2).sum(axis=1) for l in (nlev-1,nlev-2)]   # (N,T)
        ext.append(np.concatenate([s['glue'],np.stack(W,axis=1)],axis=1))
    labs_ext=labs+['W(tor pair, lev %s)'%d['torelon']['gevp']['operators'][nlev-1],'W(tor pair, lev %s)'%d['torelon']['gevp']['operators'][nlev-2]]
    re=stats.analyze_channel(ext,T,B,subtract_vev=True)
    K=len(labs)
    C=re['C']; Cj=re['C_jk']
    # W alone
    for k in (K,K+1):
        ot=re['operator_table'][k]
        print('  %-28s alone: C(1)/C(0)=%.4f(%.4f) m_eff(0,1,2)= %s   [2*E_torelon(t=1) = %.4f]'%(labs_ext[k],ot['C1_over_C0'],ot['C1_over_C0_err'],' '.join('%.3f(%.3f)'%(ot['m_cosh'][t],ot['err_cosh'][t]) for t in range(3)),2*d['torelon']['fixed_t']['t1']['m']))
    # overlap of W with each glue operator at equal time and with the pipeline ground-state vector
    sel=[labs.index(x) for x in d['glueball']['gevp']['selected']]
    v=np.array(d['glueball']['gevp']['eigenvector'])
    # normalised matrix as in R2: Chat = C/sqrt(Ckk(0) Cll(0)); eigenvector refers to Chat on the subset
    def rho_of(Cm):
        nrm=np.sqrt(np.diag(Cm[:,:,0]))
        Ch=Cm[:,:,0]/np.outer(nrm,nrm)
        # projected glue operator G = sum_k v_k O_k/nrm_k ; <G G>=v^T Chat v=1 ; <G W>/sqrt(<WW>)
        return [float(v@Ch[sel,k]/math.sqrt(v@Ch[np.ix_(sel,sel)]@v)) for k in (K,K+1)]
    rho=rho_of(C); rhoj=np.array([rho_of(Cj[b]) for b in range(nb)])
    rhoe=[jk_err(rhoj[:,i]) for i in range(2)]
    print('  equal-time correlation coefficient of the pipeline ground-state operator with W: %s  -> squared: %s'%(' '.join('%+.4f(%.4f)'%(rho[i],rhoe[i]) for i in range(2)),' '.join('%.5f'%(rho[i]**2) for i in range(2))))
    # correlation at t=1 relative: <G(1) W(0)>/sqrt(C_GG(0)C_WW(0))
    print('  extended basis (glue ops + W): R2 selected %s'%[labs_ext[i] for i in re['gevp']['selected']])
    mm=re['meff']
    print('     naive energies %s ; ground state m_eff(0,1,2) = %s  (pipeline basis: %.4f(%.4f) %.4f(%.4f) %.4f(%.4f))'%(' '.join('%.3f'%(-math.log(x)) if x>0 else 'nan' for x in re['gevp']['eigenvalues']),' '.join('%.4f(%.4f)'%(mm['m_cosh'][t],mm['err_cosh'][t]) for t in range(3)),m0,e0,m1,e1,m2,e2))
    print('     ground-state eigenvector (normalised basis):',' '.join('%+.3f'%x for x in re['gevp']['eigenvector']))
    # forced inclusion: best single glue operator set (pipeline subset) + W(top level), GEVP t0=0 without R2 pruning
    idx=sel+[K]
    Cs=C[np.ix_(idx,idx)]; nrm=np.sqrt(np.array([C[k,k,0] for k in idx])); Ch=Cs/np.outer(nrm,nrm)[:,:,None]
    lam,vec=stats.solve_gevp(Ch,0)
    print('     forced basis pipeline subset + W(top): -ln(lambda) = %s ; W-component of the two lowest states: %+.3f %+.3f ; min eig of Chat(0) %.4f'%(' '.join('%.3f'%(-math.log(x)) if x>0 else 'nan' for x in lam),vec[-1,0],vec[-1,1],np.linalg.eigvalsh(Ch[:,:,0])[0]))
    mj=[]
    for b in range(nb):
        Cb=Cj[b][np.ix_(idx,idx)]/np.outer(nrm,nrm)[:,:,None]
        lb,vb=stats.solve_gevp(Cb,0); vv=vb[:,0]; cp=np.einsum('k,klt,l->t',vv,Cb,vv); mj.append([stats.cosh_effective_mass(cp[t],cp[t+1],t,T) for t in range(3)])
    cp=np.einsum('k,klt,l->t',vec[:,0],Ch,vec[:,0]); mm0=[stats.cosh_effective_mass(cp[t],cp[t+1],t,T) for t in range(3)]
    mj=np.array(mj)
    print('     forced basis ground state m_eff(0,1,2) = %s'%' '.join('%.4f(%.4f)'%(mm0[t],jk_err(mj[:,t])) for t in range(3)))
