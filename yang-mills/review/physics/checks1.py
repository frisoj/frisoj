"""Physics review, part 1: formulas, volume/temperature table, m*L versus m/sqrt(sigma), exponents.
Reads only results/<ens>.json and literature.json. Writes nothing into the project."""
import json, math, sys
import numpy as np
from scipy import optimize, stats as sst
R='/home/user/frisoj/yang-mills/results/'
def J(n): return json.load(open(R+n+'.json'))
names=['d3_b6.0_L16','d3_b6.0_L24','d3_b9.0_L24','d3_b9.0_L24r','d3_b9.0_L24_combined','d3_b12.0_L32',
       'd4_b2.3_L10','d4_b2.4_L12','d4_b2.4_L16','d4_b2.5_L16','d4_b2.5_L16x','d4_b2.5_L16_combined']
E={n:J(n) for n in names}
print("=== A. formulas: recompute sigma by hand from the JSON torelon energies ===")
def lus(Ev,L,D): return (Ev+math.pi*(D-2)/(6*L))/L
def ng_closed(Ev,L,D):
    c=math.pi*(D-2)/3; return (c+math.sqrt(c*c+4*L*L*Ev*Ev))/(2*L*L)
def ng_energy(s,L,D): return s*L*math.sqrt(1-math.pi*(D-2)/(3*s*L*L))
def ng_numeric(Ev,L,D):
    lo=math.pi*(D-2)/(3*L*L)*(1+1e-12)
    return optimize.brentq(lambda s: ng_energy(s,L,D)-Ev, lo, 10.0, xtol=1e-15)
for n in ['d3_b12.0_L32','d4_b2.4_L12','d3_b6.0_L16','d4_b2.5_L16_combined']:
    d=E[n]; D=d['D']; t=d['torelon']; L=t['L']; Ev=t['aE']
    sl=lus(Ev,L,D); sn=ng_closed(Ev,L,D); sn2=ng_numeric(Ev,L,D)
    st=d['string_tension']
    print(n,'D',D,'L',L,'aE',Ev)
    print('   Luscher  by hand %.12f  JSON %.12f  diff %.1e'%(sl,st['luscher']['sigma_a2'],sl-st['luscher']['sigma_a2']))
    print('   NG closed by hand %.12f  JSON %.12f  diff %.1e ; numeric root %.12f (diff %.1e)'%(sn,st['nambu_goto']['sigma_a2'],sn-st['nambu_goto']['sigma_a2'],sn2,sn2-sn))
    print('   check: NG energy(sigma_NG) - aE = %.1e ; Luscher energy(sigma_L)-aE = %.1e'%(ng_energy(sn,L,D)-Ev, sl*L-math.pi*(D-2)/(6*L)-Ev))
    # expansion check: NG = sigma L - pi(D-2)/(6L) - pi^2 (D-2)^2/(72 sigma L^3) + ...
    s=sn; exp3=s*L-math.pi*(D-2)/(6*L)-math.pi**2*(D-2)**2/(72*s*L**3)
    print('   NG energy %.8f ; expansion to 1/L^3 %.8f ; Luscher-only %.8f'%(ng_energy(s,L,D),exp3,s*L-math.pi*(D-2)/(6*L)))
    c=math.pi*(D-2)/3
    print('   sigma_NG - sigma_L = %.3e ; exact formula c^2/(2L^2(2 s L^2 - c + 2 L E)) = %.3e ; approx c^2/(4L^2(2sL^2-c)) = %.3e'%(sn-sl, c*c/(2*L*L*(2*sn*L*L-c+2*L*Ev)), c*c/(4*L*L*(2*sn*L*L-c))))
    if D==3:
        b=d['beta']; print('   sqrt(sigma)/g^2 = beta*a*sqrt(sigma)/4 = %.6f JSON %.6f'%(b*math.sqrt(sn)/4, d['D3']['beta_a_sqrt_sigma_over_4']['nambu_goto']['value']))
    if D==4:
        b=d['beta']
        b0=11*2/(48*math.pi**2); b1=(34/3)*4/(16*math.pi**2)**2; g2=4/b
        al=(b0*g2)**(-b1/(2*b0*b0))*math.exp(-1/(2*b0*g2))
        al2=(6*math.pi**2*b/11)**(51/121)*math.exp(-3*math.pi**2*b/11)
        print('   a Lambda_L general %.12e  lattice form %.12e  JSON %.12e ; b1/(2b0^2)=%.10f (51/121=%.10f)'%(al,al2,d['D4']['a_lambda_two_loop'],b1/(2*b0*b0),51/121))
        print('   m/Lambda %.3f JSON %.3f ; sqrt(sigma)/Lambda (NG) %.3f JSON %.3f'%(d['glueball']['am']/al, d['D4']['m_over_lambda']['value'], math.sqrt(sn)/al, d['D4']['sqrt_sigma_over_lambda']['nambu_goto']['value']))
print()
print("THEORY.md 4.5 table check: a*Lambda_L(beta) and sqrt(sigma)/Lambda with literature values")
for b,s in ((2.2,0.467),(2.3,0.3687),(2.4,0.2673),(2.5,0.186)):
    al=(6*math.pi**2*b/11)**(51/121)*math.exp(-3*math.pi**2*b/11)
    print('   beta %.1f aLambda %.6f  sqrt(sigma)/Lambda %.1f'%(b,al,s/al))
print('   drop 2.3->2.5: %.1f %%'%(100*(1-(0.186/0.003576)/(0.3687/0.005914))))
print('   factor at g^2=0.1: %.2e'%((11/(24*math.pi**2)*0.1)**(-51/121)*math.exp(-1/(2*11/(24*math.pi**2)*0.1))))

print()
print("=== B. volumes, temperature, thresholds (t=1 Nambu-Goto sigma and m_eff(1) used throughout; R5 where different is shown) ===")
# deconfinement: D=4 from beta_c(N_t) (literature.json), log-linear interpolation of N_t in beta
bc={4:2.2986,6:2.4265,8:2.510363}
def Nc_of_beta(b):
    xs=[bc[4],bc[6],bc[8]]; ys=[math.log(4),math.log(6),math.log(8)]
    if b<=xs[1]: s=(ys[1]-ys[0])/(xs[1]-xs[0]); return math.exp(ys[0]+s*(b-xs[0]))
    s=(ys[2]-ys[1])/(xs[2]-xs[1]); return math.exp(ys[1]+s*(b-xs[1]))
TcD4=(0.69,0.71)  # literature range T_c/sqrt(sigma), D=4 SU(2)
TcD3=1.12         # D=3 SU(2), memory unless excerpt found
rows={}
print('%-22s %-9s %6s %6s %7s %7s %7s %7s %8s %9s %9s'%('ensemble','shape','Ls','Ts','mL','mT','E_tor*T','2E/m','Lmin/Nc','Lmin*Tc','exp(-ET)'))
for n in names:
    d=E[n]; D=d['D']; g=d['glueball']; t=d['torelon']; st=d['string_tension']
    L=t['L']; T=d['T']
    f1=[e for e in st['fixed_t'] if e['t']==1][0]
    s1=f1['nambu_goto']['a_sqrt_sigma']; s1e=f1['nambu_goto']['a_sqrt_sigma_err']
    m1=g['fixed_t']['t1']['m']; m1e=g['fixed_t']['t1']['err']
    E1=f1['aE']; E1e=f1['aE_err']
    Lmin=min(d['shape'])
    if D==4:
        Nc=Nc_of_beta(d['beta']); r1=Lmin/Nc; r2='%.2f-%.2f'%(Lmin*s1*TcD4[0],Lmin*s1*TcD4[1])
    else:
        Nc=1/(TcD3*s1); r1=Lmin/Nc; r2='%.2f'%(Lmin*s1*TcD3)
    rows[n]=dict(D=D,beta=d['beta'],L=L,T=T,s1=s1,s1e=s1e,m1=m1,m1e=m1e,E1=E1,E1e=E1e,
                 mR5=g['am'],mR5e=g['am_err'],sR5=st['nambu_goto']['a_sqrt_sigma'],sR5e=st['nambu_goto']['a_sqrt_sigma_err'],
                 m2=g['fixed_t']['t2']['m'],m2e=g['fixed_t']['t2']['err'],
                 m0=g['meff_table'][0]['m_cosh'],m0e=g['meff_table'][0]['err_cosh'],
                 d12=g['fixed_t']['t1_minus_t2']['value'],d12e=g['fixed_t']['t1_minus_t2']['err'],
                 rR5=d['ratios']['m_over_sqrt_sigma']['nambu_goto']['value'],rR5e=d['ratios']['m_over_sqrt_sigma']['nambu_goto']['err'],
                 lev2=g['gevp']['naive_energies'][1] if len(g['gevp']['naive_energies'])>1 else None,
                 nbins=d['n_bins'])
    print('%-22s %-9s %6.2f %6.2f %7.2f %7.2f %7.2f %7.2f %8.2f %9s %9.1e'%(n,'x'.join(map(str,d['shape'])),L*s1,T*s1,m1*L,m1*T,E1*T,2*E1/m1,r1,r2,(D-1)*math.exp(-E1*T)))
print('  D=4 critical extent N_c(beta) from beta_c(N_t)=2.2986, 2.4265, 2.510363 (log-linear in N_t): beta 2.3 -> %.2f, 2.4 -> %.2f, 2.5 -> %.2f lattice units'%(Nc_of_beta(2.3),Nc_of_beta(2.4),Nc_of_beta(2.5)))
print('  our own T_c/sqrt(sigma) implied: 1/(N_c a sqrt(sigma)) =', ['%.3f'%(1/(Nc_of_beta(b)*rows[n]['s1'])) for b,n in ((2.3,'d4_b2.3_L10'),(2.4,'d4_b2.4_L12'),(2.4,'d4_b2.4_L16'),(2.5,'d4_b2.5_L16_combined'))])
print('  NG string: E=0 at L*sqrt(sigma) = sqrt(pi(D-2)/3) = %.3f (D=3), %.3f (D=4)'%(math.sqrt(math.pi/3),math.sqrt(2*math.pi/3)))

print()
print("=== C. is the gap a finite-size gap?  m*L versus m/sqrt(sigma) across beta, and the volume comparisons ===")
def wfit_const(v,e):
    v=np.array(v);e=np.array(e);w=1/e**2;mu=(w*v).sum()/w.sum();chi=((v-mu)**2*w).sum()
    return mu,1/math.sqrt(w.sum()),chi,len(v)-1,sst.chi2.sf(chi,len(v)-1)
sets={'D4 primary (round 1)':['d4_b2.3_L10','d4_b2.4_L12','d4_b2.5_L16'],
      'D4 all data':['d4_b2.3_L10','d4_b2.4_L12','d4_b2.5_L16_combined'],
      'D3 primary (round 1)':['d3_b6.0_L16','d3_b9.0_L24','d3_b12.0_L32'],
      'D3 all data':['d3_b6.0_L16','d3_b9.0_L24_combined','d3_b12.0_L32']}
for lab,ens in sets.items():
    for var in ('t1','R5'):
        mL=[];mLe=[];ra=[];rae=[];Ls=[]
        for n in ens:
            r=rows[n]
            if var=='t1':
                m,me,s,se=r['m1'],r['m1e'],r['s1'],r['s1e']; rat=m/s; rate=rat*math.hypot(me/m,se/s)
            else:
                m,me,s,se=r['mR5'],r['mR5e'],r['sR5'],r['sR5e']; rat=r['rR5']; rate=r['rR5e']
            mL.append(m*r['L']); mLe.append(me*r['L']); ra.append(rat); rae.append(rate); Ls.append(r['L']*s)
        a=wfit_const(mL,mLe); b=wfit_const(ra,rae)
        print('%-22s %-3s m*L = %s  -> const %.3f(%.3f) chi2 %.2f/%d p=%.3g'%(lab,var,' '.join('%.3f(%.3f)'%(x,y) for x,y in zip(mL,mLe)),a[0],a[1],a[2],a[3],a[4]))
        print('%-22s %-3s m/sqrt(sig) = %s -> const %.3f(%.3f) chi2 %.2f/%d p=%.3g ; L*sqrt(sig) = %s'%('', var,' '.join('%.3f(%.3f)'%(x,y) for x,y in zip(ra,rae)),b[0],b[1],b[2],b[3],b[4],' '.join('%.2f'%x for x in Ls)))
print('  4*pi = %.3f (lowest zero-momentum two-particle level of free massless particles in a periodic box, in units 1/L)'%(4*math.pi))
for small,large in (('d3_b6.0_L16','d3_b6.0_L24'),('d4_b2.4_L12','d4_b2.4_L16')):
    a=rows[small]; b=rows[large]
    pred=a['m1']*a['L']/b['L']; prede=a['m1e']*a['L']/b['L']
    pull=(b['m1']-pred)/math.hypot(b['m1e'],prede)
    ratio=b['m1']/a['m1']; ratioe=ratio*math.hypot(a['m1e']/a['m1'],b['m1e']/b['m1'])
    # exponent q in a*m ~ L^(-q)
    q=-math.log(ratio)/math.log(b['L']/a['L']); qe=(ratioe/ratio)/math.log(b['L']/a['L'])
    print('  volume check %s -> %s: a*m %.4f(%.4f) -> %.4f(%.4f); ratio %.4f(%.4f); 1/L law predicts %.4f(%.4f): measured is %.1f sigma away; exponent q in m ~ L^-q: %.3f(%.3f)'%(small,large,a['m1'],a['m1e'],b['m1'],b['m1e'],ratio,ratioe,pred,prede,pull,q,qe))
    # torelon: linear growth
    D=a['D']; sA=a['s1']**2
    Epred=ng_energy(sA,b['L'],D); 
    # error of prediction from s1e
    dE=(ng_energy((a['s1']+a['s1e'])**2,b['L'],D)-ng_energy((a['s1']-a['s1e'])**2,b['L'],D))/2
    print('     torelon: E(L=%d) measured t=1 %.4f(%.4f); NG prediction from sigma(L=%d): %.4f(%.4f); pull %.2f ; ratio E_large/E_small %.3f(%.3f) vs L ratio %.3f'%(b['L'],b['E1'],b['E1e'],a['L'],Epred,dE,(b['E1']-Epred)/math.hypot(b['E1e'],dE), b['E1']/a['E1'], b['E1']/a['E1']*math.hypot(a['E1e']/a['E1'],b['E1e']/b['E1']), b['L']/a['L']))

print()
print("=== D. exponent p in  m/sqrt(sigma) ~ (a sqrt(sigma))^p  (p>0 would mean the gap closes in units of sqrt(sigma) as a->0) ===")
for lab,ens in sets.items():
    for var in ('t1','R5'):
        x=[];y=[];ye=[]
        for n in ens:
            r=rows[n]
            if var=='t1':
                m,me,s,se=r['m1'],r['m1e'],r['s1'],r['s1e']; rat=m/s; rate=rat*math.hypot(me/m,se/s)
            else:
                s=r['sR5']; rat=r['rR5']; rate=r['rR5e']
            x.append(math.log(s)); y.append(math.log(rat)); ye.append(rate/rat)
        x=np.array(x);y=np.array(y);ye=np.array(ye);w=1/ye**2
        S=w.sum();Sx=(w*x).sum();Sy=(w*y).sum();Sxx=(w*x*x).sum();Sxy=(w*x*y).sum()
        De=S*Sxx-Sx**2; p=(S*Sxy-Sx*Sy)/De; pe=math.sqrt(S/De); c=(Sxx*Sy-Sx*Sxy)/De
        chi=((y-c-p*x)**2*w).sum()
        # endpoints only
        p2=(y[0]-y[-1])/(x[0]-x[-1]); p2e=math.hypot(ye[0],ye[-1])/abs(x[0]-x[-1])
        print('%-22s %-3s fit p = %+.3f(%.3f) chi2 %.2f/1 ; end points only p = %+.3f(%.3f); range a*sqrt(sigma) %.3f..%.3f (factor %.2f)'%(lab,var,p,pe,chi,p2,p2e,math.exp(x[-1]),math.exp(x[0]),math.exp(x[0]-x[-1])))

print()
print("=== E. asymptotic scaling in D=4: d ln(a m)/d beta and d ln(a sqrt(sigma))/d beta versus two-loop ===")
def aL(b): return (6*math.pi**2*b/11)**(51/121)*math.exp(-3*math.pi**2*b/11)
for lab,ens in (('primary',['d4_b2.3_L10','d4_b2.4_L12','d4_b2.5_L16']),('all data',['d4_b2.3_L10','d4_b2.4_L12','d4_b2.5_L16_combined'])):
    r=[rows[n] for n in ens]
    for i,j in ((0,1),(1,2),(0,2)):
        db=r[j]['beta']-r[i]['beta']
        sm=math.log(r[j]['m1']/r[i]['m1'])/db; sme=math.hypot(r[i]['m1e']/r[i]['m1'],r[j]['m1e']/r[j]['m1'])/db
        ss=math.log(r[j]['sR5']/r[i]['sR5'])/db; sse=math.hypot(r[i]['sR5e']/r[i]['sR5'],r[j]['sR5e']/r[j]['sR5'])/db
        s1=math.log(r[j]['s1']/r[i]['s1'])/db; s1e=math.hypot(r[i]['s1e']/r[i]['s1'],r[j]['s1e']/r[j]['s1'])/db
        s2=math.log(aL(r[j]['beta'])/aL(r[i]['beta']))/db
        print('%-9s beta %.1f->%.1f: dln(am)/dbeta %.3f(%.3f) [%+.1f sig vs 2-loop]; dln(a sqrt sig)/dbeta R5 %.3f(%.3f) [%+.1f sig], t1 %.3f(%.3f) [%+.1f sig]; two-loop %.3f'%(lab,r[i]['beta'],r[j]['beta'],sm,sme,(sm-s2)/sme,ss,sse,(ss-s2)/sse,s1,s1e,(s1-s2)/s1e,s2))
    ml=[x['m1']/aL(x['beta']) for x in r]; mle=[x['m1e']/aL(x['beta']) for x in r]
    sl=[x['sR5']/aL(x['beta']) for x in r]; sle=[x['sR5e']/aL(x['beta']) for x in r]
    a=wfit_const(ml,mle); b=wfit_const(sl,sle)
    print('   m/Lambda_L = %s const %.1f(%.1f) chi2 %.2f/%d p=%.3g ; spread (max-min)/mean %.1f %%'%(' '.join('%.1f(%.1f)'%(u,v) for u,v in zip(ml,mle)),a[0],a[1],a[2],a[3],a[4],100*(max(ml)-min(ml))/np.mean(ml)))
    print('   sqrt(sigma)/Lambda_L = %s const chi2 %.1f/%d ; change first->last %.1f %%'%(' '.join('%.1f(%.1f)'%(u,v) for u,v in zip(sl,sle)),b[2],b[3],100*(sl[-1]/sl[0]-1)))
lit={2.3:(1.216,0.023,0.3687,0.0022),2.4:(0.936,0.023,0.2660,0.0021),2.5:(0.660,0.022,0.1834,0.0026)}
print('   literature (Teper Table 10, excerpt level): m/Lambda_L =',' '.join('%.1f(%.1f)'%(v[0]/aL(b),v[1]/aL(b)) for b,v in lit.items()),'; sqrt(sigma)/Lambda_L =',' '.join('%.1f(%.1f)'%(v[2]/aL(b),v[3]/aL(b)) for b,v in lit.items()))
print('   literature m/sqrt(sigma) rows:',' '.join('%.3f(%.3f)'%(v[0]/v[2],v[0]/v[2]*math.hypot(v[1]/v[0],v[3]/v[2])) for b,v in lit.items()))
json.dump(rows,open('/tmp/claude-0/-home-user-frisoj/c2e79863-26e2-54ce-9b2d-e39a90258140/scratchpad/phase2/physics-review/rows.json','w'),indent=1)
