"""EXPLORATORY (post hoc): torelon-pair operator W = sum_dir Phi_dir^2 added to the pipeline's glueball subset.
Jackknife error of the SHIFT of m_eff(t) and of m/sqrt(sigma); effective mass of the second GEVP state. Read-only."""
import sys, json, math
sys.path.insert(0,'/home/user/frisoj/yang-mills'); sys.dont_write_bytecode=True
import numpy as np
import analyze
from ym import stats
P='/home/user/frisoj/yang-mills/'
ens={'d4_b2.3_L10':[201,202,203,204],'d4_b2.4_L12':[401,402,403,404],'d4_b2.4_L16':[701,702,703,704],
     'd4_b2.5_L16':[601,602,603,604],'d4_b2.5_L16x':[605,606,607,608],'d4_b2.5_L16_combined':[601,602,603,604,605,606,607,608],
     'd3_b9.0_L24_combined':[301,302,303,304,305,306,307,308],'d3_b12.0_L32':[501,502,503,504],'d3_b6.0_L16':[101,102,103,104]}
def fname(name,s):
    base=name.replace('_combined','')
    if name=='d4_b2.5_L16_combined': base='d4_b2.5_L16' if s<605 else 'd4_b2.5_L16x'
    if name=='d3_b9.0_L24_combined': base='d3_b9.0_L24' if s<305 else 'd3_b9.0_L24r'
    return P+'results/raw/%s_s%d.npz'%(base,s)
def je(x):
    x=np.asarray(x,float); n=len(x); return math.sqrt((n-1)/n*((x-x.mean(0))**2).sum(0)) if x.ndim==1 else np.sqrt((n-1)/n*((x-x.mean(0))**2).sum(0))
for name in (sys.argv[1:] or list(ens)):
    d=json.load(open(P+'results/'+name+'.json')); T=d['T']; B=d['binsize']; D=d['D']
    S=[]
    for s in ens[name]:
        meta,a=analyze.load_raw(fname(name,s)); S.append({k:np.asarray(a[k],dtype=np.float64) for k in ('glue','torelon')})
    labs=list(d['glueball']['gevp']['operators']); sel=[labs.index(x) for x in d['glueball']['gevp']['selected']]
    nlev=S[0]['torelon'].shape[2]; K=len(labs)
    ext=[np.concatenate([s['glue'],((s['torelon'][:,:,nlev-1,:]**2).sum(axis=1))[:,None,:]],axis=1) for s in S]
    re=stats.analyze_channel(ext,T,B,subtract_vev=True,do_fit=False)
    C=re['C']; Cj=re['C_jk']; nb=Cj.shape[0]
    rt=stats.analyze_channel([s['torelon'] for s in S],T,B,subtract_vev=False,do_fit=False)
    E1=rt['meff']['m_cosh'][1]; E1j=rt['meff']['m_cosh_jk'][:,1]; L=d['torelon']['L']
    sg=math.sqrt(stats.sigma_nambu_goto(E1,L,D)); sgj=np.sqrt(stats.sigma_nambu_goto(E1j,L,D))
    def run(idx,Cm):
        nrm=np.sqrt(np.array([C[k,k,0] for k in idx])); Ch=Cm[np.ix_(idx,idx)]/np.outer(nrm,nrm)[:,:,None]
        lam,vec=stats.solve_gevp(Ch,0)
        out=[]
        for n in range(min(2,len(idx))):
            cp=np.einsum('k,klt,l->t',vec[:,n],Ch,vec[:,n])
            out.append([stats.cosh_effective_mass(cp[t],cp[t+1],t,T) for t in range(4)])
        return np.array(out)
    a0=run(sel,C); b0=run(sel+[K],C)
    aj=np.array([run(sel,Cj[b]) for b in range(nb)]); bj=np.array([run(sel+[K],Cj[b]) for b in range(nb)])
    print('=====',name,'bins',nb,' L*sqrt(sigma) %.2f  2E_tor(t=1) %.4f(%.4f)'%(L*sg,2*E1,2*je(E1j)))
    assert abs(a0[0,1]-d['glueball']['fixed_t']['t1']['m'])<1e-10
    for t in range(3):
        print('  ground state m_eff(%d): pipeline subset %.4f(%.4f) | + W %.4f(%.4f) | shift %+.4f(%.4f) = %+.1f sigma'%(t,a0[0,t],je(aj[:,0,t]),b0[0,t],je(bj[:,0,t]),b0[0,t]-a0[0,t],je(bj[:,0,t]-aj[:,0,t]),(b0[0,t]-a0[0,t])/je(bj[:,0,t]-aj[:,0,t])))
    r0=a0[0,1]/sg; r1=b0[0,1]/sg
    print('  m_eff(1)/sqrt(sigma)(t=1,NG): pipeline subset %.3f(%.3f) | + W %.3f(%.3f)'%(r0,je(aj[:,0,1]/sgj),r1,je(bj[:,0,1]/sgj)))
    print('  second state: pipeline subset m_eff(0,1,2) = %s | + W: %s'%(' '.join('%.3f(%.3f)'%(a0[1,t],je(aj[:,1,t])) for t in range(3)),' '.join('%.3f(%.3f)'%(b0[1,t],je(bj[:,1,t])) for t in range(3))))
    gap=b0[1,1]-b0[0,1]; gj=bj[:,1,1]-bj[:,0,1]
    print('  gap (second - ground, + W basis, t=1): %.3f(%.3f) ; (second level)/(2E_tor) = %.3f'%(gap,je(gj),b0[1,1]/(2*E1)))
