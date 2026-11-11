import json, math, sys
R='/home/user/frisoj/yang-mills/results/'
names=['d3_b6.0_L16','d3_b6.0_L24','d3_b9.0_L24','d3_b9.0_L24r','d3_b9.0_L24_combined','d3_b12.0_L32',
       'd4_b2.3_L10','d4_b2.4_L12','d4_b2.4_L16','d4_b2.5_L16','d4_b2.5_L16x','d4_b2.5_L16_combined']
def f(v,e): return '%.4f(%.4f)'%(v,e)
for n in names:
    d=json.load(open(R+n+'.json'))
    g=d['glueball']; t=d['torelon']; st=d['string_tension']
    print('=====',n,'D',d['D'],'shape',d['shape'],'beta',d['beta'],'nbins',d['n_bins'],'binsize',d['binsize'],'tau',round(d['tau_int_max'],2))
    print(' smear levels',d['smearing']['levels'],'loops',d['smearing']['loops'])
    print(' glue sel',g['gevp']['selected'],'overlap',round(g['overlap'],4),'tstar',g['t_star'],g['flag'])
    print(' glue meff:',' '.join('t%d %s'%(r['t'],f(r['m_cosh'],r['err_cosh'])) for r in g['meff_table'][:5] if r['m_cosh'] is not None))
    print(' glue Cproj:',' '.join('t%d %.5g(%.2g)'%(r['t'],r['C'],r['C_err']) for r in g['meff_table'][:6] if r['C'] is not None))
    print(' tor  sel',t['gevp']['selected'],'overlap',round(t['overlap'],4) if t['overlap'] else None,'tstar',t['t_star'],t['flag'],'L',t['L'])
    print(' tor  meff:',' '.join('t%d %s'%(r['t'],f(r['m_cosh'],r['err_cosh'])) for r in t['meff_table'][:5] if r['m_cosh'] is not None))
    for k in ('luscher','nambu_goto'):
        if st[k]: print('  sigma',k,'a2sig %.6f(%.6f) asqrt %.5f(%.5f)'%(st[k]['sigma_a2'],st[k]['sigma_a2_err'],st[k]['a_sqrt_sigma'],st[k]['a_sqrt_sigma_err']))
    for e in st['fixed_t']:
        print('  fixed t',e['t'],'aE',f(e['aE'],e['aE_err']),'L',e['luscher'],'NG',e['nambu_goto'])
    print(' ratios',d['ratios']['m_over_sqrt_sigma'])
    if d.get('D4'): print(' D4',d['D4']['a_lambda_two_loop'],d['D4']['m_over_lambda'],d['D4']['sqrt_sigma_over_lambda'])
    if d.get('D3'): print(' D3',d['D3']['beta_am_over_4'],d['D3']['beta_a_sqrt_sigma_over_4'])
    print(' plaq',d['plaquette']['mean'],d['plaquette']['err'])
    print(' warnings',d['warnings'])
