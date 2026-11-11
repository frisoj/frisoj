# Samenvatting over alle ensembles — numeriek bewijsmateriaal, geen bewijs

Gegenereerd door `python3 summarize.py` uit `results/<ensemble>.json` (uitvoer van `analyze.py`, niet gewijzigd) en `literature.json`. Machineleesbaar: `results/summary.json`. Tijdstip: 2026-11-11T23:39:34Z.

**Wat dit is — en wat niet.** Monte-Carlo-resultaten voor zuivere SU(2)-roosterijktheorie (Wilson-actie) bij eindige roosterafstand en eindig volume, met alleen statistische fouten; de massa's zijn variationele bovengrens-schattingen. Dit is **numeriek bewijsmateriaal** voor een massakloof in het roostermodel, **geen bewijs**: het millenniumprobleem is open en wordt hier niet opgelost.

## 0. Leeswijzer

- **R5** = de vooraf vastgelegde plateauregel (m_eff(t\*), t\* gekozen met dezelfde data; de fout dekt daardoor te weinig: 52–65 % binnen 1σ in de synthetische tests). **t=1**, **t=2** = effectieve massa bij vaste t (geen selectie). Lees ze altijd naast elkaar.
- Notatie 1.1959(77) = 1.1959 ± 0.0077. Alle fouten zijn statistisch (jackknife). Er is geen systematisch foutenbudget verzonnen; waar een systematiek zichtbaar is, staat het verschil zelf in de tabel.
- a√σ uit de torelon met de Nambu–Goto-formule; verschil met de Lüscher-formule apart vermeld.
- ‡ = geen meting (R5: "no plateau", alleen een bovengrens). \* = fout van een verhouding berekend alsof glueball en torelon ongecorreleerd zijn (de pijplijnbestanden bevatten voor die combinatie geen gecorreleerde fout). Controle bij de R5-verhoudingen, waar beide bestaan: gecorreleerde fout / ongecorreleerde fout ligt tussen 0.82 en 1.03.
- "σ" bij een verschil = verschil gedeeld door de kwadratisch opgetelde statistische fouten (onafhankelijke ensembles).
- Ronde 1 = de zes vooraf vastgelegde ensembles. Ronde 2 is na een eerste blik op ronde 1 besloten; het doel van elke run is vóór het draaien vastgelegd in `run_extra_production.sh`. Ronde 3 (d4_b2.5_L20) is na de natuurkundige controle besloten; doel, voorspellingen en criterium staan vooraf in `run_round3_production.sh`, het analyseplan in `round3_plan.md`.

## 1. Tabel per ensemble

### 1a. Glueballmassa a·m (0++)

| ensemble | D | β | rooster | ronde | metingen | a·m R5 [t\*] | a·m t=1 | a·m t=2 | m(1)−m(2) | a·m/fout (R5 / t1 / t2) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| d3_b6.0_L16 | 3 | 6 | 16^3 | 1 | 130053 | 1.1959(77) [1] | 1.1959(77) | 1.2035(259) | -0.0076(245) (-0.3σ) | 156 / 156 / 47 |
| d3_b6.0_L24 | 3 | 6 | 24^3 | 2 | 26853 | 1.1926(139) [1] | 1.1926(139) | 1.1819(449) | 0.0107(430) (+0.2σ) | 86 / 86 / 26 |
| d3_b9.0_L24 | 3 | 9 | 24^3 | 1 | 27995 | 0.8041(123) [2] | 0.7834(56) | 0.8041(123) | -0.0207(105) (-2.0σ) | 66 / 141 / 66 |
| d3_b9.0_L24r | 3 | 9 | 24^3 | 2 | 38446 | 0.7584(99) [2] | 0.7695(47) | 0.7584(99) | 0.0111(87) (+1.3σ) | 76 / 165 / 76 |
| d3_b9.0_L24_combined | 3 | 9 | 24^3 | 1+2 | 66441 | 0.7754(36) [1] | 0.7754(36) | 0.7773(77) | -0.0019(67) (-0.3σ) | 216 / 216 / 101 |
| d3_b12.0_L32 | 3 | 12 | 32^3 | 1 | 10152 | 0.5693(49) [1] | 0.5693(49) | 0.5696(83) | -0.0002(68) (-0.0σ) | 117 / 117 / 68 |
| d4_b2.3_L10 | 4 | 2.3 | 12x10^3 | 1 | 26500 | 1.1951(223) [1] | 1.1951(223) | 1.1492(704) | 0.0459(667) (+0.7σ) | 54 / 54 / 16 |
| d4_b2.4_L12 | 4 | 2.4 | 16x12^3 | 1 | 19977 | 0.9926(148) [1] | 0.9926(148) | 0.9809(404) | 0.0117(365) (+0.3σ) | 67 / 67 / 24 |
| d4_b2.4_L16 | 4 | 2.4 | 16^4 | 2 | 5378 | 0.9863(309) [1] | 0.9863(309) | 1.0215(850) | -0.0352(749) (-0.5σ) | 32 / 32 / 12 |
| d4_b2.5_L16 | 4 | 2.5 | 16^4 | 1 | 5831 | 0.7420(216) [1] | 0.7420(216) | 0.7667(494) | -0.0248(392) (-0.6σ) | 34 / 34 / 16 |
| d4_b2.5_L16x | 4 | 2.5 | 16^4 | 2 | 4871 | 0.7713(260) [1] | 0.7713(260) | 0.7457(584) | 0.0256(412) (+0.6σ) | 30 / 30 / 13 |
| d4_b2.5_L16_combined | 4 | 2.5 | 16^4 | 1+2 | 10702 | 0.7531(170) [1] | 0.7531(170) | 0.7463(371) | 0.0068(288) (+0.2σ) | 44 / 44 / 20 |
| d4_b2.5_L20 | 4 | 2.5 | 20^4 | 3 | 9600 | 0.7263(125) [1] | 0.7263(125) | 0.7186(263) | 0.0077(216) (+0.4σ) | 58 / 58 / 27 |

a·m/fout is de precisie waarmee de massa van nul verschilt. Op een eindig rooster is het spectrum discreet en is een kloof ≠ 0 bij één (β, L) vanzelfsprekend; bovendien is m_eff per definitie positief. Deze kolom is dus geen bewijsmateriaal voor een kloof in het continuüm.

### 1b. Torelon en snaarspanning

| ensemble | L | a·E R5 [t\*] | a·E t=1 | a·E t=2 | a√σ R5 | a√σ t=1 | a√σ t=2 | NG − Lüscher (t=1) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| d3_b6.0_L16 | 16 | 0.9983(95) [2] | 0.9874(36) | 0.9983(95) | 0.2539(12) | 0.2526(4) | 0.2539(12) | +0.0001 |
| d3_b6.0_L24 | 24 | 1.6931(1039) ‡ [—] | 1.5351(196) | 1.6931(1039) | 0.2673(81) ‡ | 0.2547(16) | 0.2673(81) | +0.0000 |
| d3_b9.0_L24 | 24 | 0.5978(48) [2] | 0.6022(27) | 0.5978(48) | 0.1607(6) | 0.1613(3) | 0.1607(6) | +0.0001 |
| d3_b9.0_L24r | 24 | 0.5956(42) [2] | 0.6014(24) | 0.5956(42) | 0.1604(5) | 0.1612(3) | 0.1604(5) | +0.0001 |
| d3_b9.0_L24_combined | 24 | 0.5965(32) [2] | 0.6018(18) | 0.5965(32) | 0.1606(4) | 0.1612(2) | 0.1606(4) | +0.0001 |
| d3_b12.0_L32 | 32 | 0.4359(26) [1] | 0.4359(26) | 0.4342(39) | 0.1189(3) | 0.1189(3) | 0.1187(5) | +0.0000 |
| d4_b2.3_L10 | 10 | 1.1824(455) [2] | 1.2499(138) | 1.1824(455) | 0.3594(63) | 0.3687(19) | 0.3594(63) | +0.0006 |
| d4_b2.4_L12 | 12 | 0.7306(58) [1] | 0.7306(58) | 0.7327(116) | 0.2619(9) | 0.2619(9) | 0.2622(18) | +0.0008 |
| d4_b2.4_L16 | 16 | 1.0585(219) [1] | 1.0585(219) | 1.0246(549) | 0.2653(26) | 0.2653(26) | 0.2613(66) | +0.0002 |
| d4_b2.5_L16 | 16 | 0.4913(93) [1] | 0.4913(93) | 0.4908(132) | 0.1873(15) | 0.1873(15) | 0.1872(22) | +0.0007 |
| d4_b2.5_L16x | 16 | 0.4553(204) [3] | 0.4858(93) | 0.4758(145) | 0.1812(35) | 0.1864(16) | 0.1847(24) | +0.0007 |
| d4_b2.5_L16_combined | 16 | 0.4873(65) [1] | 0.4873(65) | 0.4822(106) | 0.1866(11) | 0.1866(11) | 0.1858(18) | +0.0007 |
| d4_b2.5_L20 | 20 | 0.6405(126) [2] | 0.6522(76) | 0.6405(126) | 0.1864(17) | 0.1880(10) | 0.1864(17) | +0.0003 |

### 1c. Verhouding m/√σ en volume-indicatoren

| ensemble | m/√σ R5 | m/√σ t=1 | m/√σ t=2 | L√σ | m·L | m·T | 2E_torelon/m | fout m/√σ (R5): gecorr. / ongecorr. |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| d3_b6.0_L16 | 4.710(37) | 4.735(32) * | 4.740(104) * | 4.06(2) | 19.1(1) | 19.1(1) | 1.67(2) | 0.99 |
| d3_b6.0_L24 | 4.461(144) ‡ | 4.682(62) * | 4.421(215) * | 6.11(4) (t1) | 28.6(3) (t1) | 28.6(3) (t1) | 2.57(4) (t1) | 1.00 |
| d3_b9.0_L24 | 5.003(78) | 4.857(36) * | 5.003(78) | 3.86(1) | 19.3(3) | 19.3(3) | 1.49(3) | 0.99 |
| d3_b9.0_L24r | 4.727(64) | 4.774(30) * | 4.727(64) | 3.85(1) | 18.2(2) | 18.2(2) | 1.57(2) | 1.00 |
| d3_b9.0_L24_combined | 4.829(25) | 4.809(23) * | 4.841(50) * | 3.85(1) | 18.6(1) | 18.6(1) | 1.54(1) | 0.99 |
| d3_b12.0_L32 | 4.788(42) | 4.788(42) | 4.798(73) * | 3.81(1) | 18.2(2) | 18.2(2) | 1.53(2) | 0.98 |
| d4_b2.3_L10 | 3.325(82) | 3.242(63) * | 3.197(204) * | 3.59(6) | 12.0(2) | 14.3(3) | 1.98(8) | 0.97 |
| d4_b2.4_L12 | 3.790(58) | 3.790(58) | 3.741(156) * | 3.14(1) | 11.9(2) | 15.9(2) | 1.47(2) | 0.99 |
| d4_b2.4_L16 | 3.718(125) | 3.718(125) | 3.910(340) * | 4.24(4) | 15.8(5) | 15.8(5) | 2.15(8) | 1.03 |
| d4_b2.5_L16 | 3.962(112) | 3.962(112) | 4.096(268) * | 3.00(2) | 11.9(3) | 11.9(3) | 1.32(5) | 0.93 |
| d4_b2.5_L16x | 4.256(135) | 4.139(144) * | 4.038(320) * | 2.90(6) | 12.3(4) | 12.3(4) | 1.18(7) | 0.82 |
| d4_b2.5_L16_combined | 4.036(87) | 4.036(87) | 4.018(203) * | 2.99(2) | 12.0(3) | 12.0(3) | 1.29(3) | 0.93 |
| d4_b2.5_L20 | 3.896(78) | 3.864(70) * | 3.855(145) * | 3.73(3) | 14.5(3) | 14.5(3) | 1.76(5) | 1.03 |

L√σ en m·L: ruimtelijke afmeting in fysische eenheden; m·T: tijdsafmeting in eenheden 1/m; 2E_torelon/m: energie van een torelonpaar gedeeld door de glueballmassa (dicht bij 1 betekent dat het 0++-kanaal bij dit volume met torelonparen kan mengen). Berekend met de R5-waarden, of met t=1 waar R5 geen meting is. Laatste kolom: de gecorreleerde jackknife-fout van de R5-verhouding uit het pijplijnbestand gedeeld door de fout bij ongecorreleerde voortplanting; dit ijkt de met \* gemerkte fouten (kleiner dan 1 betekent dat een \*-fout iets te groot is).

### 1d. Statistische kwaliteit

| ensemble | bins | bingrootte | τ_int,max | warm−koud (σ) | χ²/dof stromen | plaquette | bins ×2: Δ(a·m R5) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| d3_b6.0_L16 | 10836 | 12 | 1.2 | +0.4 | 0.6/3 | 0.824782(5) | -0.00σ, fout ×1.00 |
| d3_b6.0_L24 | 2439 | 11 | 1.0 | +0.3 | 2.0/3 | 0.824781(7) | +0.03σ, fout ×1.01 |
| d3_b9.0_L24 | 1864 | 15 | 1.5 | +0.5 | 0.2/3 | 0.885447(4) | +0.05σ, fout ×0.99 |
| d3_b9.0_L24r | 2560 | 15 | 1.5 | -1.6 | 4.5/3 | 0.885457(3) | -0.03σ, fout ×1.02 |
| d3_b9.0_L24_combined | 4424 | 15 | 1.5 | -0.9 | 9.0/7 | 0.885453(2) | -0.03σ, fout ×1.00 |
| d3_b12.0_L32 | 532 | 19 | 1.9 | -0.4 | 1.5/3 | 0.914826(3) | +0.01σ, fout ×0.98 |
| d4_b2.3_L10 | 1203 | 22 | 2.1 | +0.7 | 1.0/3 | 0.602218(25) | -0.07σ, fout ×1.06 |
| d4_b2.4_L12 | 568 | 35 | 3.4 | -0.2 | 1.8/3 | 0.630022(16) | -0.01σ, fout ×1.01 |
| d4_b2.4_L16 | 178 | 30 | 2.9 | -2.2 | 8.6/3 | 0.630021(19) | +0.05σ, fout ×1.03 |
| d4_b2.5_L16 | 52 | 106 | 10.6 | +1.4 | 5.0/3 | 0.651984(18) | +0.14σ, fout ×1.06 |
| d4_b2.5_L16x | 37 | 122 | 12.1 | -0.3 | 0.1/3 | 0.651982(15) | -0.20σ, fout ×0.91 |
| d4_b2.5_L16_combined | 100 | 103 | 10.3 | +0.9 | 5.3/7 | 0.651985(11) | -0.11σ, fout ×1.03 |
| d4_b2.5_L20 | 156 | 61 | 6.1 | -0.9 | 5.3/3 | 0.651987(8) | +0.10σ, fout ×1.10 |

## 2. Schaalgedrag in D = 3 (β = 6, 9, 12)

**Voorbehoud.** Drie roosterafstanden en een variationele systematiek (bovengrens-schattingen bij kleine t; die zit niet in de fouten) vormen geen gecontroleerde continuümlimiet. De snijpunten hieronder beschrijven deze drie punten en zijn alleen indicatief.

### 2a. m/√σ tegen a²σ

**primair: alleen ronde 1 (d3_b6.0_L16, d3_b9.0_L24, d3_b12.0_L32)**

| variant | β=6: m/√σ @ a²σ | β=9 | β=12 |
| --- | --- | --- | --- |
| R5 | 4.710(37) @ 0.0645 | 5.003(78) @ 0.0258 | 4.788(42) @ 0.0141 |
| t1 | 4.735(32) * @ 0.0638 | 4.857(36) * @ 0.0260 | 4.788(42) @ 0.0141 |
| t2 | 4.740(104) * @ 0.0645 | 5.003(78) @ 0.0258 | 4.798(73) * @ 0.0141 |

Verschil tussen de grootste en de kleinste m/√σ over de drie β, als percentage van het gemiddelde (en in σ): R5: 6.1 % (+3.4σ); t1: 2.6 % (+2.6σ); t2: 5.4 % (+2.0σ). De roosterafstand verandert daarbij een factor 2.14(1) (a² een factor 4.6), gemeten met a√σ.

| variant | fit | waarde bij a → 0 | helling | χ²/dof | p | p ≥ 0.05? | pull t.o.v. 4.718(43) [geheugen (ongeverifieerd)] | pull t.o.v. 4.716(21) [zoekfragment] | pull t.o.v. 4.737(6) [zoekfragment] | pull t.o.v. 4.718(43) [zoekfragment] |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R5 | constante | 4.773(26) | — | 11.73/2 | 0.003 | nee | +1.1 | +1.7 | +1.3 | +1.1 |
| R5 | lineair in a²σ | 4.863(51) | -2.22(1.09) | 7.56/1 | 0.006 | nee | +2.2 | +2.6 | +2.4 | +2.2 |
| t1 | constante | 4.788(21) | — | 6.51/2 | 0.039 | nee | +1.5 | +2.4 | +2.3 | +1.5 |
| t1 | lineair in a²σ | 4.860(43) | -1.83(96) | 2.82/1 | 0.093 | ja | +2.3 | +3.0 | +2.8 | +2.3 |
| t2 | constante | 4.862(48) | — | 5.39/2 | 0.067 | ja | +2.2 | +2.8 | +2.6 | +2.2 |
| t2 | lineair in a²σ | 4.916(87) | -1.87(2.51) | 4.84/1 | 0.028 | nee | +2.0 | +2.2 | +2.1 | +2.0 |

**alle data: d3_b9.0_L24_combined in plaats van d3_b9.0_L24**

| variant | β=6: m/√σ @ a²σ | β=9 | β=12 |
| --- | --- | --- | --- |
| R5 | 4.710(37) @ 0.0645 | 4.829(25) @ 0.0258 | 4.788(42) @ 0.0141 |
| t1 | 4.735(32) * @ 0.0638 | 4.809(23) * @ 0.0260 | 4.788(42) @ 0.0141 |
| t2 | 4.740(104) * @ 0.0645 | 4.841(50) * @ 0.0258 | 4.798(73) * @ 0.0141 |

Verschil tussen de grootste en de kleinste m/√σ over de drie β, als percentage van het gemiddelde (en in σ): R5: 2.5 % (+2.7σ); t1: 1.5 % (+1.9σ); t2: 2.1 % (+0.9σ). De roosterafstand verandert daarbij een factor 2.14(1) (a² een factor 4.6), gemeten met a√σ.

| variant | fit | waarde bij a → 0 | helling | χ²/dof | p | p ≥ 0.05? | pull t.o.v. 4.718(43) [geheugen (ongeverifieerd)] | pull t.o.v. 4.716(21) [zoekfragment] | pull t.o.v. 4.737(6) [zoekfragment] | pull t.o.v. 4.718(43) [zoekfragment] |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R5 | constante | 4.790(19) | — | 7.11/2 | 0.029 | nee | +1.5 | +2.6 | +2.7 | +1.5 |
| R5 | lineair in a²σ | 4.866(38) | -2.25(1.00) | 2.01/1 | 0.156 | ja | +2.6 | +3.4 | +3.3 | +2.6 |
| t1 | constante | 4.783(17) | — | 3.58/2 | 0.167 | ja | +1.4 | +2.5 | +2.6 | +1.4 |
| t1 | lineair in a²σ | 4.837(36) | -1.53(90) | 0.70/1 | 0.403 | ja | +2.1 | +2.9 | +2.7 | +2.1 |
| t2 | constante | 4.816(38) | — | 0.85/2 | 0.655 | ja | +1.7 | +2.3 | +2.0 | +1.7 |
| t2 | lineair in a²σ | 4.856(79) | -1.45(2.50) | 0.51/1 | 0.476 | ja | +1.5 | +1.7 | +1.5 | +1.5 |

Fouten van de fitparameters zijn niet opgeschaald met √(χ²/dof). De fout van a²σ is verwaarloosd: |helling|·fout(x) is hoogstens 0.04 keer de fout van het punt zelf. Een pull van een snijpunt uit een fit met p < 0.05 heeft geen statistische betekenis; hij staat er alleen om de grootte van het verschil te tonen. De pulls in één tabel delen dezelfde data en zijn dus niet onafhankelijk.

### 2b. √σ/g² = β·a√σ/4 tegen 1/β

Literatuur (continuüm): 0.3353(18) [zoekfragment, arXiv:hep-lat/9804008]. Die waarde is met meer β-waarden en (uit het geheugen geciteerd) een verbeterde koppeling geëxtrapoleerd; een naïeve driepuntsextrapolatie in de kale 1/β is niet dezelfde procedure, dus een verschil toetst evenzeer de ansatz als de data.

| set | variant | β=6 | β=9 | β=12 | lineair → 1/β=0 | χ²/dof | p | pull lit. | kwadratisch (0 dof) | pull lit. | lineair in 1/β_I (β_I = β·plaq) | χ²/dof | pull lit. |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| primair | R5 | 0.3809(18) | 0.3616(14) | 0.3568(10) | 0.3322(27) | 3.60/1 | 0.058 | -1.0 | 0.3610(154) | +1.7 | 0.3358(20) | 2.59/1 | +0.2 |
| primair | t1 | 0.3789(7) | 0.3629(8) | 0.3568(10) | 0.3333(18) | 1.25/1 | 0.263 | -0.8 | 0.3454(109) | +0.9 | 0.3370(14) | 0.53/1 | +0.7 |
| primair | t2 | 0.3809(18) | 0.3616(14) | 0.3561(16) | 0.3296(34) | 2.20/1 | 0.138 | -1.5 | 0.3558(180) | +1.1 | 0.3339(26) | 1.42/1 | -0.5 |
| alle data | R5 | 0.3809(18) | 0.3613(9) | 0.3568(10) | 0.3318(27) | 7.46/1 | 0.006 | -1.1 | 0.3643(122) | +2.4 | 0.3352(20) | 5.60/1 | -0.0 |
| alle data | t1 | 0.3789(7) | 0.3628(5) | 0.3568(10) | 0.3325(16) | 2.23/1 | 0.136 | -1.2 | 0.3466(96) | +1.2 | 0.3365(12) | 1.02/1 | +0.5 |
| alle data | t2 | 0.3809(18) | 0.3613(9) | 0.3561(16) | 0.3284(33) | 4.22/1 | 0.040 | -1.9 | 0.3591(153) | +1.5 | 0.3328(24) | 2.84/1 | -0.8 |

De kolommen laten vooral zien hoe sterk het snijpunt van de ansatz afhangt. Dat de gepubliceerde waarde met β_I is verkregen, staat in `literature.json` als "uit het geheugen" en is niet geverifieerd.

### 2c. m/g² = β·a·m/4 tegen 1/β

Afgeleide referentie (geen literatuurwaarde op zich): 1.581(11) = product van twee continuümwaarden uit zoekfragmenten, fouten kwadratisch opgeteld.

| set | variant | β=6 | β=9 | β=12 | lineair → 1/β=0 | χ²/dof | p | pull afgeleide ref. |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| primair | R5 | 1.794(12) | 1.809(28) | 1.708(15) | 1.642(30) | 6.07/1 | 0.014 | +1.9 |
| primair | t1 | 1.794(12) | 1.763(13) | 1.708(15) | 1.646(28) | 2.57/1 | 0.109 | +2.2 |
| primair | t2 | 1.805(39) | 1.809(28) | 1.709(25) | 1.631(63) | 3.88/1 | 0.049 | +0.8 |
| alle data | R5 | 1.794(12) | 1.745(8) | 1.708(15) | 1.633(26) | 0.37/1 | 0.545 | +1.9 |
| alle data | t1 | 1.794(12) | 1.745(8) | 1.708(15) | 1.633(26) | 0.37/1 | 0.545 | +1.9 |
| alle data | t2 | 1.805(39) | 1.749(17) | 1.709(25) | 1.616(62) | 0.09/1 | 0.768 | +0.5 |

## 3. Schaalgedrag in D = 4 (β = 2.3, 2.4, 2.5)

**Geen gecontroleerde continuümlimiet.** Drie punten; m/√σ loopt monotoon op met β in plaats van af te vlakken; de glueballmassa's zijn bovengrens-schattingen bij t = 1 met een kleine operatorbasis, en t = 1 is bij grotere β een kortere fysische tijd, zodat verontreiniging door aangeslagen toestanden naar a → 0 kan toenemen en door een fit in a²σ niet van een roosterartefact te onderscheiden is; de drie ensembles hebben verschillende fysische volumes. Een extrapolatie wordt alleen afgedrukt als de fit statistisch aanvaardbaar is (p ≥ 0.05), en ook dan is het getal niet te vertrouwen.

### 3a. m/√σ tegen a²σ

**primair: alleen ronde 1 (d4_b2.3_L10, d4_b2.4_L12, d4_b2.5_L16)**

| variant | β=2.3: m/√σ @ a²σ | β=2.4 | β=2.5 | Δ(2.3→2.5) | constante: χ²/dof | lineair: χ²/dof | lineair, a → 0 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R5 | 3.325(82) @ 0.1292 | 3.790(58) @ 0.0686 | 3.962(112) @ 0.0351 | 0.637(139) (+4.6σ) | 28.6/2 (p=6.2e-07) | 0.32/1 (p=0.57) | 4.259(116) (niet te vertrouwen; pull t.o.v. 3.78(7): +3.5, 3.74(12): +3.1, 3.781(23): +4.0) |
| t1 | 3.242(63) * @ 0.1359 | 3.790(58) @ 0.0686 | 3.962(112) @ 0.0351 | 0.721(128) (+5.6σ) | 54.2/2 (p=1.7e-12) | 0.49/1 (p=0.48) | 4.291(103) (niet te vertrouwen; pull t.o.v. 3.78(7): +4.1, 3.74(12): +3.5, 3.781(23): +4.8) |
| t2 | 3.197(204) * @ 0.1292 | 3.741(156) * @ 0.0688 | 4.096(268) * @ 0.0350 | 0.899(337) (+2.7σ) | 8.0/2 (p=1.8e-02) | 0.02/1 (p=0.89) | 4.398(291) (niet te vertrouwen; pull t.o.v. 3.78(7): +2.1, 3.74(12): +2.1, 3.781(23): +2.1) |

Verschil tussen de grootste en de kleinste m/√σ over de drie β, als percentage van het gemiddelde (en in σ): R5: 17.3 % (+4.6σ); t1: 19.7 % (+5.6σ); t2: 24.4 % (+2.7σ). De roosterafstand verandert daarbij een factor 1.92(4) (a² een factor 3.7), gemeten met a√σ.

L√σ van de drie ensembles (R5): 3.59(6), 3.14(1), 3.00(2).

**alle data: d4_b2.5_L16_combined in plaats van d4_b2.5_L16**

| variant | β=2.3: m/√σ @ a²σ | β=2.4 | β=2.5 | Δ(2.3→2.5) | constante: χ²/dof | lineair: χ²/dof | lineair, a → 0 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R5 | 3.325(82) @ 0.1292 | 3.790(58) @ 0.0686 | 4.036(87) @ 0.0348 | 0.710(120) (+5.9σ) | 37.5/2 (p=7.1e-09) | 0.01/1 (p=0.92) | 4.305(103) (niet te vertrouwen; pull t.o.v. 3.78(7): +4.2, 3.74(12): +3.6, 3.781(23): +5.0) |
| t1 | 3.242(63) * @ 0.1359 | 3.790(58) @ 0.0686 | 4.036(87) @ 0.0348 | 0.794(107) (+7.4σ) | 67.8/2 (p=1.9e-15) | 0.06/1 (p=0.81) | 4.327(92) (niet te vertrouwen; pull t.o.v. 3.78(7): +4.7, 3.74(12): +3.9, 3.781(23): +5.7) |
| t2 | 3.197(204) * @ 0.1292 | 3.741(156) * @ 0.0688 | 4.018(203) * @ 0.0345 | 0.820(288) (+2.8σ) | 8.5/2 (p=1.4e-02) | 0.01/1 (p=0.93) | 4.329(250) (niet te vertrouwen; pull t.o.v. 3.78(7): +2.1, 3.74(12): +2.1, 3.781(23): +2.2) |

Verschil tussen de grootste en de kleinste m/√σ over de drie β, als percentage van het gemiddelde (en in σ): R5: 19.1 % (+5.9σ); t1: 21.5 % (+7.4σ); t2: 22.5 % (+2.8σ). De roosterafstand verandert daarbij een factor 1.93(4) (a² een factor 3.7), gemeten met a√σ.

L√σ van de drie ensembles (R5): 3.59(6), 3.14(1), 2.99(2).

Literatuur (continuüm): 3.78(7) [zoekfragment, arXiv:hep-lat/0404008]; 3.74(12) [zoekfragment, arXiv:hep-th/9812187]; 3.781(23) [geheugen (ongeverifieerd), arXiv:2106.00364].

### 3b. Afstand tot asymptotische schaling (twee-lus-formule)

a·Λ_L = (6π²β/11)^(51/121)·exp(−3π²β/11) (`ym/exact.py: a_lambda_two_loop`). Bij asymptotische schaling zouden m/Λ_L en √σ/Λ_L niet van β afhangen.

| set | variant | √σ/Λ_L β=2.3 | β=2.4 | β=2.5 | verandering 2.3→2.5 | m/Λ_L β=2.3 | β=2.4 | β=2.5 | verandering 2.3→2.5 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| primair | R5 | 60.8(1.1) | 56.9(2) | 52.4(4) | -13.8(1.7) %, χ²=111/2 | 202.1(3.8) | 215.8(3.2) | 207.5(6.0) | +2.7(3.5) %, χ²=7.8/2 |
| primair | t1 | 62.3(3) | 56.9(2) | 52.4(4) | -16.0(0.8) %, χ²=384/2 | 202.1(3.8) | 215.8(3.2) | 207.5(6.0) | +2.7(3.5) %, χ²=7.8/2 |
| primair | t2 | 60.8(1.1) | 57.0(4) | 52.3(6) | -13.9(1.8) %, χ²=62/2 | 194.3(11.9) | 213.2(8.8) | 214.4(13.8) | +10.4(9.8) %, χ²=1.9/2 |
| alle data | R5 | 60.8(1.1) | 56.9(2) | 52.2(3) | -14.1(1.6) %, χ²=195/2 | 202.1(3.8) | 215.8(3.2) | 210.6(4.8) | +4.2(3.1) %, χ²=7.7/2 |
| alle data | t1 | 62.3(3) | 56.9(2) | 52.2(3) | -16.3(0.6) %, χ²=540/2 | 202.1(3.8) | 215.8(3.2) | 210.6(4.8) | +4.2(3.1) %, χ²=7.7/2 |
| alle data | t2 | 60.8(1.1) | 57.0(4) | 51.9(5) | -14.5(1.7) %, χ²=90/2 | 194.3(11.9) | 213.2(8.8) | 208.7(10.4) | +7.4(8.5) %, χ²=1.7/2 |

| set | variant | verhouding | twee-lus | uit √σ | afwijking | uit a·m | afwijking |
| --- | --- | --- | --- | --- | --- | --- | --- |
| primair | R5 | a(2.3)/a(2.4) | 1.2856 | 1.372(25) | +6.7 % (+3.5σ) | 1.204(29) | -6.4 % (-2.8σ) |
| primair | R5 | a(2.4)/a(2.5) | 1.2866 | 1.399(13) | +8.7 % (+9.0σ) | 1.338(44) | +4.0 % (+1.2σ) |
| primair | R5 | a(2.3)/a(2.5) | 1.6540 | 1.919(37) | +16.0 % (+7.1σ) | 1.611(56) | -2.6 % (-0.8σ) |
| primair | t1 | a(2.3)/a(2.4) | 1.2856 | 1.408(9) | +9.5 % (+14.1σ) | 1.204(29) | -6.4 % (-2.8σ) |
| primair | t1 | a(2.4)/a(2.5) | 1.2866 | 1.399(13) | +8.7 % (+9.0σ) | 1.338(44) | +4.0 % (+1.2σ) |
| primair | t1 | a(2.3)/a(2.5) | 1.6540 | 1.969(19) | +19.0 % (+16.6σ) | 1.611(56) | -2.6 % (-0.8σ) |
| primair | t2 | a(2.3)/a(2.4) | 1.2856 | 1.371(26) | +6.6 % (+3.3σ) | 1.172(86) | -8.9 % (-1.3σ) |
| primair | t2 | a(2.4)/a(2.5) | 1.2866 | 1.401(19) | +8.9 % (+6.0σ) | 1.279(98) | -0.6 % (-0.1σ) |
| primair | t2 | a(2.3)/a(2.5) | 1.6540 | 1.920(40) | +16.1 % (+6.6σ) | 1.499(133) | -9.4 % (-1.2σ) |
| alle data | R5 | a(2.3)/a(2.4) | 1.2856 | 1.372(25) | +6.7 % (+3.5σ) | 1.204(29) | -6.4 % (-2.8σ) |
| alle data | R5 | a(2.4)/a(2.5) | 1.2866 | 1.403(10) | +9.1 % (+12.3σ) | 1.318(36) | +2.5 % (+0.9σ) |
| alle data | R5 | a(2.3)/a(2.5) | 1.6540 | 1.926(36) | +16.4 % (+7.6σ) | 1.587(46) | -4.1 % (-1.4σ) |
| alle data | t1 | a(2.3)/a(2.4) | 1.2856 | 1.408(9) | +9.5 % (+14.1σ) | 1.204(29) | -6.4 % (-2.8σ) |
| alle data | t1 | a(2.4)/a(2.5) | 1.2866 | 1.403(10) | +9.1 % (+12.3σ) | 1.318(36) | +2.5 % (+0.9σ) |
| alle data | t1 | a(2.3)/a(2.5) | 1.6540 | 1.976(15) | +19.4 % (+21.2σ) | 1.587(46) | -4.1 % (-1.4σ) |
| alle data | t2 | a(2.3)/a(2.4) | 1.2856 | 1.371(26) | +6.6 % (+3.3σ) | 1.172(86) | -8.9 % (-1.3σ) |
| alle data | t2 | a(2.4)/a(2.5) | 1.2866 | 1.412(17) | +9.7 % (+7.5σ) | 1.314(85) | +2.2 % (+0.3σ) |
| alle data | t2 | a(2.3)/a(2.5) | 1.6540 | 1.935(39) | +17.0 % (+7.3σ) | 1.540(122) | -6.9 % (-0.9σ) |

## 4. Eindig volume

Verschil klein rooster − groot rooster bij dezelfde β: één vergelijking in D = 3 en twee in D = 4 (β = 2.4 uit ronde 2, β = 2.5 uit ronde 3). Het grotere rooster heeft meestal grotere fouten: volume-effecten zijn alleen op het niveau van deze fouten begrensd.

**d3_b6.0_L16 (16^3) − d3_b6.0_L24 (24^3), D = 3, β = 6**

| grootheid | variant | A | B | A − B | significantie |
| --- | --- | --- | --- | --- | --- |
| a*m(0++) | R5 [t: 1 / 1] | 1.1959(77) | 1.1926(139) | 0.0033(159) | +0.21σ |
| a*m(0++) | t1 | 1.1959(77) | 1.1926(139) | 0.0033(159) | +0.21σ |
| a*m(0++) | t2 | 1.2035(259) | 1.1819(449) | 0.0216(518) | +0.42σ |
| a*sqrt(sigma) [Nambu-Goto] | R5 [t: 2 / 2] | 0.2539(12) | 0.2673(81) | -0.0134(82) | ‡ geen meting aan één kant |
| a*sqrt(sigma) [Nambu-Goto] | t1 | 0.2526(4) | 0.2547(16) | -0.0021(17) | -1.29σ |
| a*sqrt(sigma) [Nambu-Goto] | t2 | 0.2539(12) | 0.2673(81) | -0.0134(82) | -1.64σ |
| a*sqrt(sigma) [Luscher] | R5 [t: 2 / 2] | 0.2538(12) | 0.2673(81) | -0.0135(82) | ‡ geen meting aan één kant |
| a*sqrt(sigma) [Luscher] | t1 | 0.2525(4) | 0.2547(16) | -0.0022(17) | -1.32σ |
| a*sqrt(sigma) [Luscher] | t2 | 0.2538(12) | 0.2673(81) | -0.0135(82) | -1.65σ |
| m/sqrt(sigma) | R5 [t: [1, 2] / [1, 2]] | 4.710(37) | 4.461(144) | 0.249(149) | ‡ geen meting aan één kant |
| m/sqrt(sigma) | t1 | 4.735(32) | 4.682(62) | 0.053(69) | +0.76σ |
| m/sqrt(sigma) | t2 | 4.740(104) | 4.421(215) | 0.318(239) | +1.33σ |
| plaquette | - | 0.824782(5) | 0.824781(7) | 0.000001(9) | +0.14σ |

**d4_b2.4_L12 (16x12^3) − d4_b2.4_L16 (16^4), D = 4, β = 2.4**

| grootheid | variant | A | B | A − B | significantie |
| --- | --- | --- | --- | --- | --- |
| a*m(0++) | R5 [t: 1 / 1] | 0.9926(148) | 0.9863(309) | 0.0064(343) | +0.19σ |
| a*m(0++) | t1 | 0.9926(148) | 0.9863(309) | 0.0064(343) | +0.19σ |
| a*m(0++) | t2 | 0.9809(404) | 1.0215(850) | -0.0406(941) | -0.43σ |
| a*sqrt(sigma) [Nambu-Goto] | R5 [t: 1 / 1] | 0.2619(9) | 0.2653(26) | -0.0034(27) | -1.24σ |
| a*sqrt(sigma) [Nambu-Goto] | t1 | 0.2619(9) | 0.2653(26) | -0.0034(27) | -1.24σ |
| a*sqrt(sigma) [Nambu-Goto] | t2 | 0.2622(18) | 0.2613(66) | 0.0010(68) | +0.14σ |
| a*sqrt(sigma) [Luscher] | R5 [t: 1 / 1] | 0.2611(9) | 0.2650(26) | -0.0040(27) | -1.45σ |
| a*sqrt(sigma) [Luscher] | t1 | 0.2611(9) | 0.2650(26) | -0.0040(27) | -1.45σ |
| a*sqrt(sigma) [Luscher] | t2 | 0.2614(18) | 0.2610(66) | 0.0004(68) | +0.06σ |
| m/sqrt(sigma) | R5 [t: [1, 1] / [1, 1]] | 3.790(58) | 3.718(125) | 0.072(138) | +0.52σ |
| m/sqrt(sigma) | t1 | 3.790(58) | 3.718(125) | 0.072(138) | +0.52σ |
| m/sqrt(sigma) | t2 | 3.741(156) | 3.910(340) | -0.169(374) | -0.45σ |
| plaquette | - | 0.630022(16) | 0.630021(19) | 0.000001(25) | +0.03σ |

**d4_b2.5_L16_combined (16^4) − d4_b2.5_L20 (20^4), D = 4, β = 2.5**

| grootheid | variant | A | B | A − B | significantie |
| --- | --- | --- | --- | --- | --- |
| a*m(0++) | R5 [t: 1 / 1] | 0.7531(170) | 0.7263(125) | 0.0268(211) | +1.27σ |
| a*m(0++) | t1 | 0.7531(170) | 0.7263(125) | 0.0268(211) | +1.27σ |
| a*m(0++) | t2 | 0.7463(371) | 0.7186(263) | 0.0277(455) | +0.61σ |
| a*sqrt(sigma) [Nambu-Goto] | R5 [t: 1 / 2] | 0.1866(11) | 0.1864(17) | 0.0002(20) | +0.10σ |
| a*sqrt(sigma) [Nambu-Goto] | t1 | 0.1866(11) | 0.1880(10) | -0.0014(15) | -0.92σ |
| a*sqrt(sigma) [Nambu-Goto] | t2 | 0.1858(18) | 0.1864(17) | -0.0007(24) | -0.27σ |
| a*sqrt(sigma) [Luscher] | R5 [t: 1 / 2] | 0.1859(11) | 0.1861(17) | -0.0003(20) | -0.13σ |
| a*sqrt(sigma) [Luscher] | t1 | 0.1859(11) | 0.1877(10) | -0.0018(15) | -1.22σ |
| a*sqrt(sigma) [Luscher] | t2 | 0.1850(18) | 0.1861(17) | -0.0011(25) | -0.45σ |
| m/sqrt(sigma) | R5 [t: [1, 1] / [1, 2]] | 4.036(87) | 3.896(78) | 0.139(117) | +1.19σ |
| m/sqrt(sigma) | t1 | 4.036(87) | 3.864(70) | 0.172(112) | +1.54σ |
| m/sqrt(sigma) | t2 | 4.018(203) | 3.855(145) | 0.163(250) | +0.65σ |
| plaquette | - | 0.651985(11) | 0.651987(8) | -0.000002(14) | -0.12σ |

## 5. Replicatie

Verschil ronde 1 − nieuwe seeds, zelfde β en rooster.

**d3_b9.0_L24 (24^3) − d3_b9.0_L24r (24^3), D = 3, β = 9**

| grootheid | variant | A | B | A − B | significantie |
| --- | --- | --- | --- | --- | --- |
| a*m(0++) | R5 [t: 2 / 2] | 0.8041(123) | 0.7584(99) | 0.0457(158) | +2.90σ |
| a*m(0++) | t1 | 0.7834(56) | 0.7695(47) | 0.0139(73) | +1.91σ |
| a*m(0++) | t2 | 0.8041(123) | 0.7584(99) | 0.0457(158) | +2.90σ |
| a*E(torelon) | R5 [t: 2 / 2] | 0.5978(48) | 0.5956(42) | 0.0022(64) | +0.35σ |
| a*E(torelon) | t1 | 0.6022(27) | 0.6014(24) | 0.0008(36) | +0.22σ |
| a*E(torelon) | t2 | 0.5978(48) | 0.5956(42) | 0.0022(64) | +0.35σ |
| a*sqrt(sigma) [Nambu-Goto] | R5 [t: 2 / 2] | 0.1607(6) | 0.1604(5) | 0.0003(8) | +0.35σ |
| a*sqrt(sigma) [Nambu-Goto] | t1 | 0.1613(3) | 0.1612(3) | 0.0001(5) | +0.22σ |
| a*sqrt(sigma) [Nambu-Goto] | t2 | 0.1607(6) | 0.1604(5) | 0.0003(8) | +0.35σ |
| a*sqrt(sigma) [Luscher] | R5 [t: 2 / 2] | 0.1607(6) | 0.1604(5) | 0.0003(8) | +0.35σ |
| a*sqrt(sigma) [Luscher] | t1 | 0.1613(3) | 0.1611(3) | 0.0001(5) | +0.22σ |
| a*sqrt(sigma) [Luscher] | t2 | 0.1607(6) | 0.1604(5) | 0.0003(8) | +0.35σ |
| m/sqrt(sigma) | R5 [t: [2, 2] / [2, 2]] | 5.003(78) | 4.727(64) | 0.276(101) | +2.74σ |
| m/sqrt(sigma) | t1 | 4.857(36) | 4.774(30) | 0.083(47) | +1.76σ |
| m/sqrt(sigma) | t2 | 5.003(78) | 4.727(64) | 0.276(101) | +2.74σ |
| plaquette | - | 0.885447(4) | 0.885457(3) | -0.000010(5) | -2.13σ |

**d4_b2.5_L16 (16^4) − d4_b2.5_L16x (16^4), D = 4, β = 2.5**

| grootheid | variant | A | B | A − B | significantie |
| --- | --- | --- | --- | --- | --- |
| a*m(0++) | R5 [t: 1 / 1] | 0.7420(216) | 0.7713(260) | -0.0293(338) | -0.87σ |
| a*m(0++) | t1 | 0.7420(216) | 0.7713(260) | -0.0293(338) | -0.87σ |
| a*m(0++) | t2 | 0.7667(494) | 0.7457(584) | 0.0210(765) | +0.28σ |
| a*E(torelon) | R5 [t: 1 / 3] | 0.4913(93) | 0.4553(204) | 0.0360(224) | +1.60σ |
| a*E(torelon) | t1 | 0.4913(93) | 0.4858(93) | 0.0054(132) | +0.41σ |
| a*E(torelon) | t2 | 0.4908(132) | 0.4758(145) | 0.0150(196) | +0.76σ |
| a*sqrt(sigma) [Nambu-Goto] | R5 [t: 1 / 3] | 0.1873(15) | 0.1812(35) | 0.0060(38) | +1.59σ |
| a*sqrt(sigma) [Nambu-Goto] | t1 | 0.1873(15) | 0.1864(16) | 0.0009(22) | +0.41σ |
| a*sqrt(sigma) [Nambu-Goto] | t2 | 0.1872(22) | 0.1847(24) | 0.0025(33) | +0.76σ |
| a*sqrt(sigma) [Luscher] | R5 [t: 1 / 3] | 0.1865(16) | 0.1804(35) | 0.0061(39) | +1.59σ |
| a*sqrt(sigma) [Luscher] | t1 | 0.1865(16) | 0.1856(16) | 0.0009(22) | +0.41σ |
| a*sqrt(sigma) [Luscher] | t2 | 0.1865(22) | 0.1839(25) | 0.0025(33) | +0.76σ |
| m/sqrt(sigma) | R5 [t: [1, 1] / [1, 3]] | 3.962(112) | 4.256(135) | -0.294(176) | -1.67σ |
| m/sqrt(sigma) | t1 | 3.962(112) | 4.139(144) | -0.176(182) | -0.97σ |
| m/sqrt(sigma) | t2 | 4.096(268) | 4.038(320) | 0.059(418) | +0.14σ |
| plaquette | - | 0.651984(18) | 0.651982(15) | 0.000002(24) | +0.08σ |

## 5b. Ronde 3: volumecontrole bij β = 2.5 (vooraf vastgelegd criterium)

Vergelijking van d4_b2.5_L20 (L = 20) met d4_b2.5_L16_combined (L = 16). Lezing A (zuivere eindige-doos-kloof, m ∝ 1/L) voorspelt a·m(L = 20) = a·m(L = 16) × 16/20; lezing B (volume-onafhankelijke kloof) voorspelt dezelfde waarde als op het kleine rooster. Criterium (`run_round3_production.sh`, vóór de run vastgelegd): lezing A is uitgesloten als m_eff(1) meer dan 3σ boven haar voorspelling ligt; de waarde op L = 16 heet door het volume vertekend als m_eff(1) meer dan 3σ eronder ligt. Alleen t = 1 telt voor het oordeel; t = 2 en R5 staan ernaast.

| variant | a·m, L = 16 | voorspelling lezing A | a·m gemeten, L = 20 | gemeten − A | gemeten − klein rooster | a·m·L (L = 16 / L = 20) | exponent q in m ∝ L^−q |
| --- | --- | --- | --- | --- | --- | --- | --- |
| t = 1 (primair) | 0.7531(170) | 0.6024(136) | 0.7263(125) | +6.7σ | -1.3σ | 12.05(27) / 14.53(25) | 0.16(13) |
| t = 2 | 0.7463(371) | 0.5970(297) | 0.7186(263) | +3.1σ | -0.6σ | 11.94(59) / 14.37(53) | 0.17(28) |
| R5 | 0.7531(170) | 0.6024(136) | 0.7263(125) | +6.7σ | -1.3σ | 12.05(27) / 14.53(25) | 0.16(13) |

**Oordeel volgens het criterium (t = 1):** lezing A (m ∝ 1/L) is bij β = 2.5 **uitgesloten**; de waarde op L = 16 is **niet** als door het volume vertekend aangemerkt. q = 1 is een zuivere eindige-doos-kloof, q = 0 een volume-onafhankelijke kloof. Dit zegt iets over twee doosgroottes bij één roosterafstand, niet over de continuümlimiet.

**Grootste volume per β in D = 4** (d4_b2.3_L10, d4_b2.4_L16, d4_b2.5_L20; analyseplan `round3_plan.md`, punt 4). Deze set staat naast de vooraf vastgelegde primaire set van sectie 3, niet in plaats daarvan; uit geen van beide volgt een continuümwaarde.

| variant | m/√σ, β = 2.3 (12x10^3) | m/√σ, β = 2.4 (16^4) | m/√σ, β = 2.5 (20^4) | L√σ per rooster | constante door de drie punten |
| --- | --- | --- | --- | --- | --- |
| t = 1 | 3.242(63) | 3.718(125) | 3.864(70) | 3.69(2) / 4.24(4) / 3.76(2) | 3.544(44), χ² = 46.4 bij 2 (p = 0.000) |
| R5 | 3.325(82) | 3.718(125) | 3.896(78) | 3.59(6) / 4.24(4) / 3.73(3) | 3.641(52), χ² = 25.7 bij 2 (p = 0.000) |

## 6. Vergelijking met literatuurwaarden

Betrouwbaarheid van de literatuurgetallen: "zoekfragment" = gezien in een fragment van een webzoekresultaat, nooit in de volledige tekst; "geheugen" = ongeverifieerde herinnering. Geen enkel getal is tegen een gepubliceerde tabel gecontroleerd. Pull = (wij − literatuur)/√(fout² + onzekerheid²). "gekozen" = de literatuurwaarde met hetzelfde ruimtelijke rooster als die er is, anders de hoofdwaarde (één per ensemble en grootheid).

| ensemble | grootheid | literatuur | niveau | bron | gekozen | wij R5 | pull R5 | wij t=1 | pull t=1 | wij t=2 | pull t=2 | pull met Lüscher-formule (R5 / t1 / t2) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| d3_b6.0_L16 | a*sqrt(sigma) | 0.2538(10) | zoekfragment | arXiv:hep-lat/9804008, L=16 | ja | 0.2539(12) | +0.1 | 0.2526(4) | -1.1 | 0.2539(12) | +0.1 | +0.0 / -1.2 / +0.0 |
| d3_b6.0_L16 | a*sqrt(sigma) | 0.2562(26) | zoekfragment | arXiv:hep-lat/9804008, L=24 |  | 0.2539(12) | -0.8 | 0.2526(4) | -1.4 | 0.2539(12) | -0.8 | -0.8 / -1.4 / -0.8 |
| d3_b6.0_L16 | a*sqrt(sigma) | 0.2529(33) | zoekfragment | arXiv:hep-lat/9804008, L=32 |  | 0.2539(12) | +0.3 | 0.2526(4) | -0.1 | 0.2539(12) | +0.3 | +0.3 / -0.1 / +0.3 |
| d3_b6.0_L16 | a*m(0++) | 1.19(2) | geheugen (ongeverifieerd) | arXiv:hep-lat/9804008 | ja | 1.1959(77) | +0.3 | 1.1959(77) | +0.3 | 1.2035(259) | +0.4 |  |
| d3_b6.0_L24 | a*sqrt(sigma) | 0.2538(10) | zoekfragment | arXiv:hep-lat/9804008, L=16 |  | 0.2673(81) ‡ | n.v.t. | 0.2547(16) | +0.5 | 0.2673(81) | +1.7 | n.v.t. / +0.5 / +1.7 |
| d3_b6.0_L24 | a*sqrt(sigma) | 0.2562(26) | zoekfragment | arXiv:hep-lat/9804008, L=24 | ja | 0.2673(81) ‡ | n.v.t. | 0.2547(16) | -0.5 | 0.2673(81) | +1.3 | n.v.t. / -0.5 / +1.3 |
| d3_b6.0_L24 | a*sqrt(sigma) | 0.2529(33) | zoekfragment | arXiv:hep-lat/9804008, L=32 |  | 0.2673(81) ‡ | n.v.t. | 0.2547(16) | +0.5 | 0.2673(81) | +1.6 | n.v.t. / +0.5 / +1.6 |
| d3_b6.0_L24 | a*m(0++) | 1.19(2) | geheugen (ongeverifieerd) | arXiv:hep-lat/9804008 | ja | 1.1926(139) | +0.1 | 1.1926(139) | +0.1 | 1.1819(449) | -0.2 |  |
| d3_b9.0_L24 | a*sqrt(sigma) | 0.1616(6) | zoekfragment | arXiv:hep-lat/9804008, L=24 | ja | 0.1607(6) | -1.0 | 0.1613(3) | -0.4 | 0.1607(6) | -1.0 | -1.1 / -0.5 / -1.1 |
| d3_b9.0_L24 | a*sqrt(sigma) | 0.1622(4) | zoekfragment | arXiv:hep-lat/9804008, L=32 |  | 0.1607(6) | -2.0 | 0.1613(3) | -1.7 | 0.1607(6) | -2.0 | -2.1 / -1.8 / -2.1 |
| d3_b9.0_L24 | a*m(0++) | 0.765(10) | geheugen (ongeverifieerd) | arXiv:hep-lat/9804008 | ja | 0.8041(123) | +2.5 | 0.7834(56) | +1.6 | 0.8041(123) | +2.5 |  |
| d3_b9.0_L24r | a*sqrt(sigma) | 0.1616(6) | zoekfragment | arXiv:hep-lat/9804008, L=24 | ja | 0.1604(5) | -1.4 | 0.1612(3) | -0.6 | 0.1604(5) | -1.4 | -1.5 / -0.7 / -1.5 |
| d3_b9.0_L24r | a*sqrt(sigma) | 0.1622(4) | zoekfragment | arXiv:hep-lat/9804008, L=32 |  | 0.1604(5) | -2.6 | 0.1612(3) | -2.0 | 0.1604(5) | -2.6 | -2.7 / -2.1 / -2.7 |
| d3_b9.0_L24r | a*m(0++) | 0.765(10) | geheugen (ongeverifieerd) | arXiv:hep-lat/9804008 | ja | 0.7584(99) | -0.5 | 0.7695(47) | +0.4 | 0.7584(99) | -0.5 |  |
| d3_b9.0_L24_combined | a*sqrt(sigma) | 0.1616(6) | zoekfragment | arXiv:hep-lat/9804008, L=24 | ja | 0.1606(4) | -1.4 | 0.1612(2) | -0.6 | 0.1606(4) | -1.4 | -1.5 / -0.6 / -1.5 |
| d3_b9.0_L24_combined | a*sqrt(sigma) | 0.1622(4) | zoekfragment | arXiv:hep-lat/9804008, L=32 |  | 0.1606(4) | -2.9 | 0.1612(2) | -2.1 | 0.1606(4) | -2.9 | -2.9 / -2.2 / -2.9 |
| d3_b9.0_L24_combined | a*m(0++) | 0.765(10) | geheugen (ongeverifieerd) | arXiv:hep-lat/9804008 | ja | 0.7754(36) | +1.0 | 0.7754(36) | +1.0 | 0.7773(77) | +1.0 |  |
| d3_b12.0_L32 | a*sqrt(sigma) | 0.1179(5) | zoekfragment | arXiv:hep-lat/9804008, L=32 | ja | 0.1189(3) | +1.7 | 0.1189(3) | +1.7 | 0.1187(5) | +1.1 | +1.6 / +1.6 / +1.1 |
| d3_b12.0_L32 | a*sqrt(sigma) | 0.1179(8) | zoekfragment | arXiv:hep-lat/9804008, L=48 |  | 0.1189(3) | +1.2 | 0.1189(3) | +1.2 | 0.1187(5) | +0.8 | +1.1 / +1.1 / +0.8 |
| d3_b12.0_L32 | a*m(0++) | 0.559(8) | geheugen (ongeverifieerd) | arXiv:hep-lat/9804008 | ja | 0.5693(49) | +1.1 | 0.5693(49) | +1.1 | 0.5696(83) | +0.9 |  |
| d4_b2.3_L10 | plaquette | 0.6023(10) | geheugen (ongeverifieerd) | geen bron aangewezen | ja | 0.602218(25) | -0.1 | 0.602218(25) | -0.1 | 0.602218(25) | -0.1 |  |
| d4_b2.3_L10 | a*sqrt(sigma) | 0.3687(22) | zoekfragment | arXiv:hep-th/9812187, L=10 | ja | 0.3594(63) | -1.4 | 0.3687(19) | -0.0 | 0.3594(63) | -1.4 | -1.5 / -0.2 / -1.5 |
| d4_b2.3_L10 | a*m(0++) | 1.216(23) | zoekfragment | arXiv:hep-th/9812187, L=10 | ja | 1.1951(223) | -0.7 | 1.1951(223) | -0.7 | 1.1492(704) | -0.9 |  |
| d4_b2.4_L12 | plaquette | 0.630(1) | geheugen (ongeverifieerd) | geen bron aangewezen | ja | 0.630022(16) | +0.0 | 0.630022(16) | +0.0 | 0.630022(16) | +0.0 |  |
| d4_b2.4_L12 | a*sqrt(sigma) | 0.2673(15) | zoekfragment | arXiv:hep-th/9812187 | ja | 0.2619(9) | -3.1 | 0.2619(9) | -3.1 | 0.2622(18) | -2.1 | -3.5 / -3.5 / -2.5 |
| d4_b2.4_L12 | a*sqrt(sigma) | 0.2660(21) | zoekfragment | arXiv:hep-th/9812187, L=16 |  | 0.2619(9) | -1.8 | 0.2619(9) | -1.8 | 0.2622(18) | -1.4 | -2.2 / -2.2 / -1.6 |
| d4_b2.4_L12 | a*m(0++) | 0.936(23) | zoekfragment | arXiv:hep-th/9812187, L=16 | ja | 0.9926(148) | +2.1 | 0.9926(148) | +2.1 | 0.9809(404) | +1.0 |  |
| d4_b2.4_L16 | plaquette | 0.630(1) | geheugen (ongeverifieerd) | geen bron aangewezen | ja | 0.630021(19) | +0.0 | 0.630021(19) | +0.0 | 0.630021(19) | +0.0 |  |
| d4_b2.4_L16 | a*sqrt(sigma) | 0.2673(15) | zoekfragment | arXiv:hep-th/9812187 |  | 0.2653(26) | -0.7 | 0.2653(26) | -0.7 | 0.2613(66) | -0.9 | -0.8 / -0.8 / -0.9 |
| d4_b2.4_L16 | a*sqrt(sigma) | 0.2660(21) | zoekfragment | arXiv:hep-th/9812187, L=16 | ja | 0.2653(26) | -0.2 | 0.2653(26) | -0.2 | 0.2613(66) | -0.7 | -0.3 / -0.3 / -0.7 |
| d4_b2.4_L16 | a*m(0++) | 0.936(23) | zoekfragment | arXiv:hep-th/9812187, L=16 | ja | 0.9863(309) | +1.3 | 0.9863(309) | +1.3 | 1.0215(850) | +1.0 |  |
| d4_b2.5_L16 | plaquette | 0.652(1) | geheugen (ongeverifieerd) | geen bron aangewezen | ja | 0.651984(18) | -0.0 | 0.651984(18) | -0.0 | 0.651984(18) | -0.0 |  |
| d4_b2.5_L16 | a*sqrt(sigma) | 0.186(3) | zoekfragment | arXiv:hep-th/9812187 |  | 0.1873(15) | +0.4 | 0.1873(15) | +0.4 | 0.1872(22) | +0.3 | +0.2 / +0.2 / +0.1 |
| d4_b2.5_L16 | a*sqrt(sigma) | 0.1834(26) | zoekfragment | arXiv:hep-th/9812187, L=16 | ja | 0.1873(15) | +1.3 | 0.1873(15) | +1.3 | 0.1872(22) | +1.1 | +1.0 / +1.0 / +0.9 |
| d4_b2.5_L16 | a*sqrt(sigma) | 0.1871(10) | zoekfragment | arXiv:hep-th/9812187, L=16 |  | 0.1873(15) | +0.1 | 0.1873(15) | +0.1 | 0.1872(22) | +0.0 | -0.3 / -0.3 / -0.3 |
| d4_b2.5_L16 | a*sqrt(sigma) | 0.1905(8) | geheugen (ongeverifieerd) | arXiv:hep-lat/9208012 |  | 0.1873(15) | -1.9 | 0.1873(15) | -1.9 | 0.1872(22) | -1.4 | -2.3 / -2.3 / -1.7 |
| d4_b2.5_L16 | a*m(0++) | 0.660(22) | zoekfragment | arXiv:hep-th/9812187, L=16 | ja | 0.7420(216) | +2.7 | 0.7420(216) | +2.7 | 0.7667(494) | +2.0 |  |
| d4_b2.5_L16 | a*m(0++) | 0.69(4) | geheugen (ongeverifieerd) | geen bron aangewezen |  | 0.7420(216) | +1.1 | 0.7420(216) | +1.1 | 0.7667(494) | +1.2 |  |
| d4_b2.5_L16 | a*m(0++) | 0.6857(28) | zoekfragment | arXiv:1911.03048 |  | 0.7420(216) | +2.6 | 0.7420(216) | +2.6 | 0.7667(494) | +1.6 |  |
| d4_b2.5_L16 | a*m(0++) | 0.72(3) | zoekfragment | arXiv:hep-lat/9809019 |  | 0.7420(216) | +0.6 | 0.7420(216) | +0.6 | 0.7667(494) | +0.8 |  |
| d4_b2.5_L16x | plaquette | 0.652(1) | geheugen (ongeverifieerd) | geen bron aangewezen | ja | 0.651982(15) | -0.0 | 0.651982(15) | -0.0 | 0.651982(15) | -0.0 |  |
| d4_b2.5_L16x | a*sqrt(sigma) | 0.186(3) | zoekfragment | arXiv:hep-th/9812187 |  | 0.1812(35) | -1.0 | 0.1864(16) | +0.1 | 0.1847(24) | -0.3 | -1.2 / -0.1 / -0.5 |
| d4_b2.5_L16x | a*sqrt(sigma) | 0.1834(26) | zoekfragment | arXiv:hep-th/9812187, L=16 | ja | 0.1812(35) | -0.5 | 0.1864(16) | +1.0 | 0.1847(24) | +0.4 | -0.7 / +0.7 / +0.1 |
| d4_b2.5_L16x | a*sqrt(sigma) | 0.1871(10) | zoekfragment | arXiv:hep-th/9812187, L=16 |  | 0.1812(35) | -1.6 | 0.1864(16) | -0.4 | 0.1847(24) | -0.9 | -1.8 / -0.8 / -1.2 |
| d4_b2.5_L16x | a*sqrt(sigma) | 0.1905(8) | geheugen (ongeverifieerd) | arXiv:hep-lat/9208012 |  | 0.1812(35) | -2.6 | 0.1864(16) | -2.4 | 0.1847(24) | -2.3 | -2.8 / -2.8 / -2.5 |
| d4_b2.5_L16x | a*m(0++) | 0.660(22) | zoekfragment | arXiv:hep-th/9812187, L=16 | ja | 0.7713(260) | +3.3 | 0.7713(260) | +3.3 | 0.7457(584) | +1.4 |  |
| d4_b2.5_L16x | a*m(0++) | 0.69(4) | geheugen (ongeverifieerd) | geen bron aangewezen |  | 0.7713(260) | +1.7 | 0.7713(260) | +1.7 | 0.7457(584) | +0.8 |  |
| d4_b2.5_L16x | a*m(0++) | 0.6857(28) | zoekfragment | arXiv:1911.03048 |  | 0.7713(260) | +3.3 | 0.7713(260) | +3.3 | 0.7457(584) | +1.0 |  |
| d4_b2.5_L16x | a*m(0++) | 0.72(3) | zoekfragment | arXiv:hep-lat/9809019 |  | 0.7713(260) | +1.3 | 0.7713(260) | +1.3 | 0.7457(584) | +0.4 |  |
| d4_b2.5_L16_combined | plaquette | 0.652(1) | geheugen (ongeverifieerd) | geen bron aangewezen | ja | 0.651985(11) | -0.0 | 0.651985(11) | -0.0 | 0.651985(11) | -0.0 |  |
| d4_b2.5_L16_combined | a*sqrt(sigma) | 0.186(3) | zoekfragment | arXiv:hep-th/9812187 |  | 0.1866(11) | +0.2 | 0.1866(11) | +0.2 | 0.1858(18) | -0.1 | -0.0 / -0.0 / -0.3 |
| d4_b2.5_L16_combined | a*sqrt(sigma) | 0.1834(26) | zoekfragment | arXiv:hep-th/9812187, L=16 | ja | 0.1866(11) | +1.1 | 0.1866(11) | +1.1 | 0.1858(18) | +0.7 | +0.9 / +0.9 / +0.5 |
| d4_b2.5_L16_combined | a*sqrt(sigma) | 0.1871(10) | zoekfragment | arXiv:hep-th/9812187, L=16 |  | 0.1866(11) | -0.3 | 0.1866(11) | -0.3 | 0.1858(18) | -0.7 | -0.8 / -0.8 / -1.0 |
| d4_b2.5_L16_combined | a*sqrt(sigma) | 0.1905(8) | geheugen (ongeverifieerd) | arXiv:hep-lat/9208012 |  | 0.1866(11) | -2.9 | 0.1866(11) | -2.9 | 0.1858(18) | -2.4 | -3.4 / -3.4 / -2.8 |
| d4_b2.5_L16_combined | a*m(0++) | 0.660(22) | zoekfragment | arXiv:hep-th/9812187, L=16 | ja | 0.7531(170) | +3.3 | 0.7531(170) | +3.3 | 0.7463(371) | +2.0 |  |
| d4_b2.5_L16_combined | a*m(0++) | 0.69(4) | geheugen (ongeverifieerd) | geen bron aangewezen |  | 0.7531(170) | +1.5 | 0.7531(170) | +1.5 | 0.7463(371) | +1.0 |  |
| d4_b2.5_L16_combined | a*m(0++) | 0.6857(28) | zoekfragment | arXiv:1911.03048 |  | 0.7531(170) | +3.9 | 0.7531(170) | +3.9 | 0.7463(371) | +1.6 |  |
| d4_b2.5_L16_combined | a*m(0++) | 0.72(3) | zoekfragment | arXiv:hep-lat/9809019 |  | 0.7531(170) | +1.0 | 0.7531(170) | +1.0 | 0.7463(371) | +0.6 |  |
| d4_b2.5_L20 | plaquette | 0.652(1) | geheugen (ongeverifieerd) | geen bron aangewezen | ja | 0.651987(8) | -0.0 | 0.651987(8) | -0.0 | 0.651987(8) | -0.0 |  |
| d4_b2.5_L20 | a*sqrt(sigma) | 0.186(3) | zoekfragment | arXiv:hep-th/9812187 | ja | 0.1864(17) | +0.1 | 0.1880(10) | +0.6 | 0.1864(17) | +0.1 | +0.0 / +0.5 / +0.0 |
| d4_b2.5_L20 | a*sqrt(sigma) | 0.1834(26) | zoekfragment | arXiv:hep-th/9812187, L=16 |  | 0.1864(17) | +1.0 | 0.1880(10) | +1.6 | 0.1864(17) | +1.0 | +0.9 / +1.5 / +0.9 |
| d4_b2.5_L20 | a*sqrt(sigma) | 0.1871(10) | zoekfragment | arXiv:hep-th/9812187, L=16 |  | 0.1864(17) | -0.3 | 0.1880(10) | +0.6 | 0.1864(17) | -0.3 | -0.5 / +0.4 / -0.5 |
| d4_b2.5_L20 | a*sqrt(sigma) | 0.1905(8) | geheugen (ongeverifieerd) | arXiv:hep-lat/9208012 |  | 0.1864(17) | -2.2 | 0.1880(10) | -2.0 | 0.1864(17) | -2.2 | -2.3 / -2.2 / -2.3 |
| d4_b2.5_L20 | a*m(0++) | 0.660(22) | zoekfragment | arXiv:hep-th/9812187, L=16 | ja | 0.7263(125) | +2.6 | 0.7263(125) | +2.6 | 0.7186(263) | +1.7 |  |
| d4_b2.5_L20 | a*m(0++) | 0.69(4) | geheugen (ongeverifieerd) | geen bron aangewezen |  | 0.7263(125) | +0.9 | 0.7263(125) | +0.9 | 0.7186(263) | +0.6 |  |
| d4_b2.5_L20 | a*m(0++) | 0.6857(28) | zoekfragment | arXiv:1911.03048 |  | 0.7263(125) | +3.2 | 0.7263(125) | +3.2 | 0.7186(263) | +1.2 |  |
| d4_b2.5_L20 | a*m(0++) | 0.72(3) | zoekfragment | arXiv:hep-lat/9809019 |  | 0.7263(125) | +0.2 | 0.7263(125) | +0.2 | 0.7186(263) | -0.0 |  |

De literatuurwaarden van a√σ zijn (volgens `literature.json`, uit het geheugen) met de Lüscher-correctie bepaald; de laatste kolom is daarom de meest gelijksoortige vergelijking voor de snaarspanning.

### 6a. Aantallen

| ensembles | literatuurwaarden | variant | aantal pulls | |pull| > 2 | |pull| > 3 | grootste |pull| | verwacht (Gauss) >2 / >3 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| primair (6 ensembles van ronde 1) | gekozen waarde | R5 | 15 | 4 | 1 | 3.07 | 0.7 / 0.04 |
| primair (6 ensembles van ronde 1) | gekozen waarde | t1 | 15 | 3 | 1 | 3.07 | 0.7 / 0.04 |
| primair (6 ensembles van ronde 1) | gekozen waarde | t2 | 15 | 2 | 0 | 2.47 | 0.7 / 0.04 |
| primair (6 ensembles van ronde 1) | alle waarden incl. alternatieven | R5 | 26 | 5 | 1 | 3.07 | 1.2 / 0.07 |
| primair (6 ensembles van ronde 1) | alle waarden incl. alternatieven | t1 | 26 | 4 | 1 | 3.07 | 1.2 / 0.07 |
| primair (6 ensembles van ronde 1) | alle waarden incl. alternatieven | t2 | 26 | 2 | 0 | 2.47 | 1.2 / 0.07 |
| primair (6 ensembles van ronde 1) | alleen a√σ, Lüscher-formule, gekozen waarde | R5 | 6 | 1 | 1 | 3.53 | 0.3 / 0.02 |
| primair (6 ensembles van ronde 1) | alleen a√σ, Lüscher-formule, gekozen waarde | t1 | 6 | 1 | 1 | 3.53 | 0.3 / 0.02 |
| primair (6 ensembles van ronde 1) | alleen a√σ, Lüscher-formule, gekozen waarde | t2 | 6 | 1 | 0 | 2.48 | 0.3 / 0.02 |
| alle data (9 onafhankelijke ensembles) | gekozen waarde | R5 | 22 | 4 | 2 | 3.35 | 1.0 / 0.06 |
| alle data (9 onafhankelijke ensembles) | gekozen waarde | t1 | 23 | 4 | 2 | 3.35 | 1.0 / 0.06 |
| alle data (9 onafhankelijke ensembles) | gekozen waarde | t2 | 23 | 1 | 0 | 2.15 | 1.0 / 0.06 |
| alle data (9 onafhankelijke ensembles) | alle waarden incl. alternatieven | R5 | 40 | 9 | 4 | 3.91 | 1.8 / 0.11 |
| alle data (9 onafhankelijke ensembles) | alle waarden incl. alternatieven | t1 | 43 | 8 | 4 | 3.91 | 2.0 / 0.12 |
| alle data (9 onafhankelijke ensembles) | alle waarden incl. alternatieven | t2 | 43 | 4 | 0 | 2.86 | 2.0 / 0.12 |
| alle data (9 onafhankelijke ensembles) | alleen a√σ, Lüscher-formule, gekozen waarde | R5 | 8 | 1 | 1 | 3.53 | 0.4 / 0.02 |
| alle data (9 onafhankelijke ensembles) | alleen a√σ, Lüscher-formule, gekozen waarde | t1 | 9 | 1 | 1 | 3.53 | 0.4 / 0.02 |
| alle data (9 onafhankelijke ensembles) | alleen a√σ, Lüscher-formule, gekozen waarde | t2 | 9 | 1 | 0 | 2.48 | 0.4 / 0.02 |

| ensembles | grootheid (gekozen waarde) | variant | aantal | > 2 | > 3 | grootste |pull| |
| --- | --- | --- | --- | --- | --- | --- |
| primair (6 ensembles van ronde 1) | plaquette | R5 | 3 | 0 | 0 | 0.08 |
| primair (6 ensembles van ronde 1) | plaquette | t1 | 3 | 0 | 0 | 0.08 |
| primair (6 ensembles van ronde 1) | plaquette | t2 | 3 | 0 | 0 | 0.08 |
| primair (6 ensembles van ronde 1) | a*sqrt(sigma) | R5 | 6 | 1 | 1 | 3.07 |
| primair (6 ensembles van ronde 1) | a*sqrt(sigma) | t1 | 6 | 1 | 1 | 3.07 |
| primair (6 ensembles van ronde 1) | a*sqrt(sigma) | t2 | 6 | 1 | 0 | 2.15 |
| primair (6 ensembles van ronde 1) | a*m(0++) | R5 | 6 | 3 | 0 | 2.66 |
| primair (6 ensembles van ronde 1) | a*m(0++) | t1 | 6 | 2 | 0 | 2.66 |
| primair (6 ensembles van ronde 1) | a*m(0++) | t2 | 6 | 1 | 0 | 2.47 |
| alle data (9 onafhankelijke ensembles) | plaquette | R5 | 5 | 0 | 0 | 0.08 |
| alle data (9 onafhankelijke ensembles) | plaquette | t1 | 5 | 0 | 0 | 0.08 |
| alle data (9 onafhankelijke ensembles) | plaquette | t2 | 5 | 0 | 0 | 0.08 |
| alle data (9 onafhankelijke ensembles) | a*sqrt(sigma) | R5 | 8 | 1 | 1 | 3.07 |
| alle data (9 onafhankelijke ensembles) | a*sqrt(sigma) | t1 | 9 | 1 | 1 | 3.07 |
| alle data (9 onafhankelijke ensembles) | a*sqrt(sigma) | t2 | 9 | 1 | 0 | 2.15 |
| alle data (9 onafhankelijke ensembles) | a*m(0++) | R5 | 9 | 3 | 1 | 3.35 |
| alle data (9 onafhankelijke ensembles) | a*m(0++) | t1 | 9 | 3 | 1 | 3.35 |
| alle data (9 onafhankelijke ensembles) | a*m(0++) | t2 | 9 | 0 | 0 | 2.00 |

| ensembles | niveau van de literatuurwaarde (gekozen waarde) | variant | aantal | > 2 | > 3 | grootste |pull| |
| --- | --- | --- | --- | --- | --- | --- |
| primair (6 ensembles van ronde 1) | zoekfragment | R5 | 9 | 3 | 1 | 3.07 |
| primair (6 ensembles van ronde 1) | zoekfragment | t1 | 9 | 3 | 1 | 3.07 |
| primair (6 ensembles van ronde 1) | zoekfragment | t2 | 9 | 1 | 0 | 2.15 |
| primair (6 ensembles van ronde 1) | geheugen (ongeverifieerd) | R5 | 6 | 1 | 0 | 2.47 |
| primair (6 ensembles van ronde 1) | geheugen (ongeverifieerd) | t1 | 6 | 0 | 0 | 1.61 |
| primair (6 ensembles van ronde 1) | geheugen (ongeverifieerd) | t2 | 6 | 1 | 0 | 2.47 |
| alle data (9 onafhankelijke ensembles) | zoekfragment | R5 | 13 | 4 | 2 | 3.35 |
| alle data (9 onafhankelijke ensembles) | zoekfragment | t1 | 14 | 4 | 2 | 3.35 |
| alle data (9 onafhankelijke ensembles) | zoekfragment | t2 | 14 | 1 | 0 | 2.15 |
| alle data (9 onafhankelijke ensembles) | geheugen (ongeverifieerd) | R5 | 9 | 0 | 0 | 1.10 |
| alle data (9 onafhankelijke ensembles) | geheugen (ongeverifieerd) | t1 | 9 | 0 | 0 | 1.10 |
| alle data (9 onafhankelijke ensembles) | geheugen (ongeverifieerd) | t2 | 9 | 0 | 0 | 0.97 |

De verwachting bij Gauss-verdeelde, onafhankelijke pulls met juiste fouten staat in de eerste tabel. De pulls zijn niet onafhankelijk (a·m en a√σ van één ensemble; alternatieve literatuurwaarden van dezelfde grootheid) en de literatuurwaarden zijn niet geverifieerd.

Pulls boven 2σ (gekozen waarde):

- d3_b9.0_L24, a*m(0++), R5: +2.47σ t.o.v. 0.765(10) [geheugen (ongeverifieerd)]
- d4_b2.4_L12, a*sqrt(sigma), R5: -3.07σ t.o.v. 0.2673(15) [zoekfragment]
- d4_b2.4_L12, a*m(0++), R5: +2.07σ t.o.v. 0.936(23) [zoekfragment]
- d4_b2.5_L16, a*m(0++), R5: +2.66σ t.o.v. 0.660(22) [zoekfragment]
- d4_b2.4_L12, a*sqrt(sigma), t1: -3.07σ t.o.v. 0.2673(15) [zoekfragment]
- d4_b2.4_L12, a*m(0++), t1: +2.07σ t.o.v. 0.936(23) [zoekfragment]
- d4_b2.5_L16, a*m(0++), t1: +2.66σ t.o.v. 0.660(22) [zoekfragment]
- d3_b9.0_L24, a*m(0++), t2: +2.47σ t.o.v. 0.765(10) [geheugen (ongeverifieerd)]
- d4_b2.4_L12, a*sqrt(sigma), t2: -2.15σ t.o.v. 0.2673(15) [zoekfragment]
- d4_b2.5_L16_combined, a*m(0++), R5: +3.35σ t.o.v. 0.660(22) [zoekfragment]
- d4_b2.5_L20, a*m(0++), R5: +2.62σ t.o.v. 0.660(22) [zoekfragment]
- d4_b2.5_L16_combined, a*m(0++), t1: +3.35σ t.o.v. 0.660(22) [zoekfragment]
- d4_b2.5_L20, a*m(0++), t1: +2.62σ t.o.v. 0.660(22) [zoekfragment]

### 6b. Afgeleide verhouding m/√σ bij eindige β (geen literatuurwaarde op zich)

| ensemble | literatuur: a·m / a√σ | niveau | wij R5 | pull R5 | wij t=1 | pull t=1 | wij t=2 | pull t=2 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| d3_b6.0_L16 | 4.689(81) | geheugen (ongeverifieerd) | 4.710(37) | +0.2 | 4.735(32) * | +0.5 | 4.740(104) * | +0.4 |
| d3_b6.0_L24 | 4.689(81) | geheugen (ongeverifieerd) | 4.461(144) ‡ | n.v.t. | 4.682(62) * | -0.1 | 4.421(215) * | -1.2 |
| d3_b9.0_L24 | 4.734(64) | geheugen (ongeverifieerd) | 5.003(78) | +2.7 | 4.857(36) * | +1.7 | 5.003(78) | +2.7 |
| d3_b9.0_L24r | 4.734(64) | geheugen (ongeverifieerd) | 4.727(64) | -0.1 | 4.774(30) * | +0.6 | 4.727(64) | -0.1 |
| d3_b9.0_L24_combined | 4.734(64) | geheugen (ongeverifieerd) | 4.829(25) | +1.4 | 4.809(23) * | +1.1 | 4.841(50) * | +1.3 |
| d3_b12.0_L32 | 4.741(71) | geheugen (ongeverifieerd) | 4.788(42) | +0.6 | 4.788(42) | +0.6 | 4.798(73) * | +0.6 |
| d4_b2.3_L10 | 3.298(65) | zoekfragment | 3.325(82) | +0.3 | 3.242(63) * | -0.6 | 3.197(204) * | -0.5 |
| d4_b2.4_L12 | 3.519(91) | zoekfragment | 3.790(58) | +2.5 | 3.790(58) | +2.5 | 3.741(156) * | +1.2 |
| d4_b2.4_L16 | 3.519(91) | zoekfragment | 3.718(125) | +1.3 | 3.718(125) | +1.3 | 3.910(340) * | +1.1 |
| d4_b2.5_L16 | 3.599(130) | zoekfragment | 3.962(112) | +2.1 | 3.962(112) | +2.1 | 4.096(268) * | +1.7 |
| d4_b2.5_L16x | 3.599(130) | zoekfragment | 4.256(135) | +3.5 | 4.139(144) * | +2.8 | 4.038(320) * | +1.3 |
| d4_b2.5_L16_combined | 3.599(130) | zoekfragment | 4.036(87) | +2.8 | 4.036(87) | +2.8 | 4.018(203) * | +1.7 |
| d4_b2.5_L20 | 3.599(130) | zoekfragment | 3.896(78) | +2.0 | 3.864(70) * | +1.8 | 3.855(145) * | +1.3 |

Aantallen (afgeleid): primair (6 ensembles van ronde 1), R5: 3 van 6 boven 2σ, 0 boven 3σ; primair (6 ensembles van ronde 1), t1: 2 van 6 boven 2σ, 0 boven 3σ; primair (6 ensembles van ronde 1), t2: 1 van 6 boven 2σ, 0 boven 3σ; alle data (9 onafhankelijke ensembles), R5: 2 van 8 boven 2σ, 0 boven 3σ; alle data (9 onafhankelijke ensembles), t1: 2 van 9 boven 2σ, 0 boven 3σ; alle data (9 onafhankelijke ensembles), t2: 0 van 9 boven 2σ, 0 boven 3σ.

### 6c. Geëxtrapoleerde waarden tegen continuümwaarden uit de literatuur

Niet gelijksoortig: een driepuntsfit van ons tegen een gepubliceerde continuümlimiet. De rijen delen dezelfde data en zijn niet onafhankelijk. Alleen fits met p ≥ 0.05 zijn opgenomen; de volledige lijst staat in `summary.json` onder `literature_comparison.continuum_rows`.

| D | grootheid | set | variant | fit | onze waarde bij a → 0 | χ²/dof | literatuur [zoekfragment] | pull |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| D=3 | √σ/g² | primair | R5 | lineair in 1/β | 0.3322(27) | 3.60/1 | 0.3353(18) | -1.0 |
| D=3 | √σ/g² | primair | R5 | lineair in 1/β_I | 0.3358(20) | 2.59/1 | 0.3353(18) | +0.2 |
| D=4 | m/√σ | primair | R5 | lineair in a²σ | 4.259(116) | 0.32/1 | 3.78(7) | +3.5 |
| D=4 | m/√σ | primair | R5 | lineair in a²σ | 4.259(116) | 0.32/1 | 3.74(12) | +3.1 |
| D=3 | m/√σ | primair | t1 | lineair in a²σ | 4.860(43) | 2.82/1 | 4.716(21) | +3.0 |
| D=3 | m/√σ | primair | t1 | lineair in a²σ | 4.860(43) | 2.82/1 | 4.737(6) | +2.8 |
| D=3 | m/√σ | primair | t1 | lineair in a²σ | 4.860(43) | 2.82/1 | 4.718(43) | +2.3 |
| D=3 | √σ/g² | primair | t1 | lineair in 1/β | 0.3333(18) | 1.25/1 | 0.3353(18) | -0.8 |
| D=3 | √σ/g² | primair | t1 | lineair in 1/β_I | 0.3370(14) | 0.53/1 | 0.3353(18) | +0.7 |
| D=4 | m/√σ | primair | t1 | lineair in a²σ | 4.291(103) | 0.49/1 | 3.78(7) | +4.1 |
| D=4 | m/√σ | primair | t1 | lineair in a²σ | 4.291(103) | 0.49/1 | 3.74(12) | +3.5 |
| D=3 | m/√σ | primair | t2 | constante | 4.862(48) | 5.39/2 | 4.716(21) | +2.8 |
| D=3 | m/√σ | primair | t2 | constante | 4.862(48) | 5.39/2 | 4.737(6) | +2.6 |
| D=3 | m/√σ | primair | t2 | constante | 4.862(48) | 5.39/2 | 4.718(43) | +2.2 |
| D=3 | √σ/g² | primair | t2 | lineair in 1/β | 0.3296(34) | 2.20/1 | 0.3353(18) | -1.5 |
| D=3 | √σ/g² | primair | t2 | lineair in 1/β_I | 0.3339(26) | 1.42/1 | 0.3353(18) | -0.5 |
| D=4 | m/√σ | primair | t2 | lineair in a²σ | 4.398(291) | 0.02/1 | 3.78(7) | +2.1 |
| D=4 | m/√σ | primair | t2 | lineair in a²σ | 4.398(291) | 0.02/1 | 3.74(12) | +2.1 |
| D=3 | m/√σ | alle data | R5 | lineair in a²σ | 4.866(38) | 2.01/1 | 4.716(21) | +3.4 |
| D=3 | m/√σ | alle data | R5 | lineair in a²σ | 4.866(38) | 2.01/1 | 4.737(6) | +3.3 |
| D=3 | m/√σ | alle data | R5 | lineair in a²σ | 4.866(38) | 2.01/1 | 4.718(43) | +2.6 |
| D=4 | m/√σ | alle data | R5 | lineair in a²σ | 4.305(103) | 0.01/1 | 3.78(7) | +4.2 |
| D=4 | m/√σ | alle data | R5 | lineair in a²σ | 4.305(103) | 0.01/1 | 3.74(12) | +3.6 |
| D=3 | m/√σ | alle data | t1 | constante | 4.783(17) | 3.58/2 | 4.716(21) | +2.5 |
| D=3 | m/√σ | alle data | t1 | constante | 4.783(17) | 3.58/2 | 4.737(6) | +2.6 |
| D=3 | m/√σ | alle data | t1 | constante | 4.783(17) | 3.58/2 | 4.718(43) | +1.4 |
| D=3 | m/√σ | alle data | t1 | lineair in a²σ | 4.837(36) | 0.70/1 | 4.716(21) | +2.9 |
| D=3 | m/√σ | alle data | t1 | lineair in a²σ | 4.837(36) | 0.70/1 | 4.737(6) | +2.7 |
| D=3 | m/√σ | alle data | t1 | lineair in a²σ | 4.837(36) | 0.70/1 | 4.718(43) | +2.1 |
| D=3 | √σ/g² | alle data | t1 | lineair in 1/β | 0.3325(16) | 2.23/1 | 0.3353(18) | -1.2 |
| D=3 | √σ/g² | alle data | t1 | lineair in 1/β_I | 0.3365(12) | 1.02/1 | 0.3353(18) | +0.5 |
| D=4 | m/√σ | alle data | t1 | lineair in a²σ | 4.327(92) | 0.06/1 | 3.78(7) | +4.7 |
| D=4 | m/√σ | alle data | t1 | lineair in a²σ | 4.327(92) | 0.06/1 | 3.74(12) | +3.9 |
| D=3 | m/√σ | alle data | t2 | constante | 4.816(38) | 0.85/2 | 4.716(21) | +2.3 |
| D=3 | m/√σ | alle data | t2 | constante | 4.816(38) | 0.85/2 | 4.737(6) | +2.0 |
| D=3 | m/√σ | alle data | t2 | constante | 4.816(38) | 0.85/2 | 4.718(43) | +1.7 |
| D=3 | m/√σ | alle data | t2 | lineair in a²σ | 4.856(79) | 0.51/1 | 4.716(21) | +1.7 |
| D=3 | m/√σ | alle data | t2 | lineair in a²σ | 4.856(79) | 0.51/1 | 4.737(6) | +1.5 |
| D=3 | m/√σ | alle data | t2 | lineair in a²σ | 4.856(79) | 0.51/1 | 4.718(43) | +1.5 |
| D=3 | √σ/g² | alle data | t2 | lineair in 1/β_I | 0.3328(24) | 2.84/1 | 0.3353(18) | -0.8 |
| D=4 | m/√σ | alle data | t2 | lineair in a²σ | 4.329(250) | 0.01/1 | 3.78(7) | +2.1 |
| D=4 | m/√σ | alle data | t2 | lineair in a²σ | 4.329(250) | 0.01/1 | 3.74(12) | +2.1 |

Literatuurwaarden zonder bijbehorende meting van ons (niet vergeleken): `D4_SU2_wilson.plaquette.2.2`, `D4_SU2_wilson.a_sqrt_sigma.2.2`, `D4_SU2_wilson.beta_c.4`, `D4_SU2_wilson.beta_c.6`, `D4_SU2_wilson.beta_c.8`.

## 7. Kerngetallen (`headline` in summary.json)

Dezelfde lijst, met waarden en bronsleutels, staat in `summary.json` onder `headline`.

- `ensemble.d3_b6.0_L16`: a·m = 1.1959(77) / 1.1959(77) / 1.2035(259); a√σ = 0.2539(12) / 0.2526(4) / 0.2539(12); m/√σ = 4.710(37) / 4.735(32) / 4.740(104)  (R5 / t=1 / t=2)
- `ensemble.d3_b6.0_L24`: a·m = 1.1926(139) / 1.1926(139) / 1.1819(449); a√σ = 0.2673(81) ‡ / 0.2547(16) / 0.2673(81); m/√σ = 4.461(144) ‡ / 4.682(62) / 4.421(215)  (R5 / t=1 / t=2)
- `ensemble.d3_b9.0_L24`: a·m = 0.8041(123) / 0.7834(56) / 0.8041(123); a√σ = 0.1607(6) / 0.1613(3) / 0.1607(6); m/√σ = 5.003(78) / 4.857(36) / 5.003(78)  (R5 / t=1 / t=2)
- `ensemble.d3_b9.0_L24r`: a·m = 0.7584(99) / 0.7695(47) / 0.7584(99); a√σ = 0.1604(5) / 0.1612(3) / 0.1604(5); m/√σ = 4.727(64) / 4.774(30) / 4.727(64)  (R5 / t=1 / t=2)
- `ensemble.d3_b9.0_L24_combined`: a·m = 0.7754(36) / 0.7754(36) / 0.7773(77); a√σ = 0.1606(4) / 0.1612(2) / 0.1606(4); m/√σ = 4.829(25) / 4.809(23) / 4.841(50)  (R5 / t=1 / t=2)
- `ensemble.d3_b12.0_L32`: a·m = 0.5693(49) / 0.5693(49) / 0.5696(83); a√σ = 0.1189(3) / 0.1189(3) / 0.1187(5); m/√σ = 4.788(42) / 4.788(42) / 4.798(73)  (R5 / t=1 / t=2)
- `ensemble.d4_b2.3_L10`: a·m = 1.1951(223) / 1.1951(223) / 1.1492(704); a√σ = 0.3594(63) / 0.3687(19) / 0.3594(63); m/√σ = 3.325(82) / 3.242(63) / 3.197(204)  (R5 / t=1 / t=2)
- `ensemble.d4_b2.4_L12`: a·m = 0.9926(148) / 0.9926(148) / 0.9809(404); a√σ = 0.2619(9) / 0.2619(9) / 0.2622(18); m/√σ = 3.790(58) / 3.790(58) / 3.741(156)  (R5 / t=1 / t=2)
- `ensemble.d4_b2.4_L16`: a·m = 0.9863(309) / 0.9863(309) / 1.0215(850); a√σ = 0.2653(26) / 0.2653(26) / 0.2613(66); m/√σ = 3.718(125) / 3.718(125) / 3.910(340)  (R5 / t=1 / t=2)
- `ensemble.d4_b2.5_L16`: a·m = 0.7420(216) / 0.7420(216) / 0.7667(494); a√σ = 0.1873(15) / 0.1873(15) / 0.1872(22); m/√σ = 3.962(112) / 3.962(112) / 4.096(268)  (R5 / t=1 / t=2)
- `ensemble.d4_b2.5_L16x`: a·m = 0.7713(260) / 0.7713(260) / 0.7457(584); a√σ = 0.1812(35) / 0.1864(16) / 0.1847(24); m/√σ = 4.256(135) / 4.139(144) / 4.038(320)  (R5 / t=1 / t=2)
- `ensemble.d4_b2.5_L16_combined`: a·m = 0.7531(170) / 0.7531(170) / 0.7463(371); a√σ = 0.1866(11) / 0.1866(11) / 0.1858(18); m/√σ = 4.036(87) / 4.036(87) / 4.018(203)  (R5 / t=1 / t=2)
- `ensemble.d4_b2.5_L20`: a·m = 0.7263(125) / 0.7263(125) / 0.7186(263); a√σ = 0.1864(17) / 0.1880(10) / 0.1864(17); m/√σ = 3.896(78) / 3.864(70) / 3.855(145)  (R5 / t=1 / t=2)
- `d3.m_over_sqrt_sigma.primary.R5`: constante 4.773(26) (χ²/dof 11.73/2, p = 0.003); rechte lijn → 4.863(51) (χ²/dof 7.56/1, p = 0.006); pulls van het snijpunt: 4.718(43) [geheugen (ongeverifieerd)]: +2.2, 4.716(21) [zoekfragment]: +2.6, 4.737(6) [zoekfragment]: +2.4, 4.718(43) [zoekfragment]: +2.2
- `d3.sqrt_sigma_over_g2.primary.R5`: lineair in 1/β → 0.3322(27) (χ²/dof 3.60/1, pull -1.0); kwadratisch → 0.3610(154) (pull +1.7); lineair in 1/β_I → 0.3358(20) (pull +0.2); literatuur 0.3353(18) [zoekfragment]
- `d3.m_over_sqrt_sigma.primary.t1`: constante 4.788(21) (χ²/dof 6.51/2, p = 0.039); rechte lijn → 4.860(43) (χ²/dof 2.82/1, p = 0.093); pulls van het snijpunt: 4.718(43) [geheugen (ongeverifieerd)]: +2.3, 4.716(21) [zoekfragment]: +3.0, 4.737(6) [zoekfragment]: +2.8, 4.718(43) [zoekfragment]: +2.3
- `d3.sqrt_sigma_over_g2.primary.t1`: lineair in 1/β → 0.3333(18) (χ²/dof 1.25/1, pull -0.8); kwadratisch → 0.3454(109) (pull +0.9); lineair in 1/β_I → 0.3370(14) (pull +0.7); literatuur 0.3353(18) [zoekfragment]
- `d3.m_over_sqrt_sigma.all_data.R5`: constante 4.790(19) (χ²/dof 7.11/2, p = 0.029); rechte lijn → 4.866(38) (χ²/dof 2.01/1, p = 0.156); pulls van het snijpunt: 4.718(43) [geheugen (ongeverifieerd)]: +2.6, 4.716(21) [zoekfragment]: +3.4, 4.737(6) [zoekfragment]: +3.3, 4.718(43) [zoekfragment]: +2.6
- `d3.sqrt_sigma_over_g2.all_data.R5`: lineair in 1/β → 0.3318(27) (χ²/dof 7.46/1, pull -1.1); kwadratisch → 0.3643(122) (pull +2.4); lineair in 1/β_I → 0.3352(20) (pull -0.0); literatuur 0.3353(18) [zoekfragment]
- `d3.m_over_sqrt_sigma.all_data.t1`: constante 4.783(17) (χ²/dof 3.58/2, p = 0.167); rechte lijn → 4.837(36) (χ²/dof 0.70/1, p = 0.403); pulls van het snijpunt: 4.718(43) [geheugen (ongeverifieerd)]: +2.1, 4.716(21) [zoekfragment]: +2.9, 4.737(6) [zoekfragment]: +2.7, 4.718(43) [zoekfragment]: +2.1
- `d3.sqrt_sigma_over_g2.all_data.t1`: lineair in 1/β → 0.3325(16) (χ²/dof 2.23/1, pull -1.2); kwadratisch → 0.3466(96) (pull +1.2); lineair in 1/β_I → 0.3365(12) (pull +0.5); literatuur 0.3353(18) [zoekfragment]
- `d4.m_over_sqrt_sigma.primary.R5`: 3.325(82) → 3.790(58) → 3.962(112); verandering 2.3→2.5: 0.637(139) (+4.6σ); rechte lijn (χ²/dof 0.32/1): 4.259(116) — géén continuümlimiet; pulls: 3.78(7): +3.5, 3.74(12): +3.1, 3.781(23): +4.0
- `d4.m_over_sqrt_sigma.primary.t1`: 3.242(63) → 3.790(58) → 3.962(112); verandering 2.3→2.5: 0.721(128) (+5.6σ); rechte lijn (χ²/dof 0.49/1): 4.291(103) — géén continuümlimiet; pulls: 3.78(7): +4.1, 3.74(12): +3.5, 3.781(23): +4.8
- `d4.asymptotic_scaling.primary`: √σ/Λ_L = 60.8(1.1) → 56.9(2) → 52.4(4) (-13.8(1.7) %); a-verhoudingen uit √σ t.o.v. twee-lus: 1.372(25) vs 1.286 (+6.7 %), 1.399(13) vs 1.287 (+8.7 %), 1.919(37) vs 1.654 (+16.0 %)
- `d4.m_over_sqrt_sigma.all_data.R5`: 3.325(82) → 3.790(58) → 4.036(87); verandering 2.3→2.5: 0.710(120) (+5.9σ); rechte lijn (χ²/dof 0.01/1): 4.305(103) — géén continuümlimiet; pulls: 3.78(7): +4.2, 3.74(12): +3.6, 3.781(23): +5.0
- `d4.m_over_sqrt_sigma.all_data.t1`: 3.242(63) → 3.790(58) → 4.036(87); verandering 2.3→2.5: 0.794(107) (+7.4σ); rechte lijn (χ²/dof 0.06/1): 4.327(92) — géén continuümlimiet; pulls: 3.78(7): +4.7, 3.74(12): +3.9, 3.781(23): +5.7
- `d4.asymptotic_scaling.all_data`: √σ/Λ_L = 60.8(1.1) → 56.9(2) → 52.2(3) (-14.1(1.6) %); a-verhoudingen uit √σ t.o.v. twee-lus: 1.372(25) vs 1.286 (+6.7 %), 1.403(10) vs 1.287 (+9.1 %), 1.926(36) vs 1.654 (+16.4 %)
- `finite_volume.d3_b6.0_L16_vs_d3_b6.0_L24`: a·m: R5 +0.21σ / t1 +0.21σ / t2 +0.42σ; a√σ: R5 geen meting / t1 -1.29σ / t2 -1.64σ; m/√σ: R5 geen meting / t1 +0.76σ / t2 +1.33σ; plaquette: - +0.14σ
- `finite_volume.d4_b2.4_L12_vs_d4_b2.4_L16`: a·m: R5 +0.19σ / t1 +0.19σ / t2 -0.43σ; a√σ: R5 -1.24σ / t1 -1.24σ / t2 +0.14σ; m/√σ: R5 +0.52σ / t1 +0.52σ / t2 -0.45σ; plaquette: - +0.03σ
- `finite_volume.d4_b2.5_L16_combined_vs_d4_b2.5_L20`: a·m: R5 +1.27σ / t1 +1.27σ / t2 +0.61σ; a√σ: R5 +0.10σ / t1 -0.92σ / t2 -0.27σ; m/√σ: R5 +1.19σ / t1 +1.54σ / t2 +0.65σ; plaquette: - -0.12σ
- `replication.d3_b9.0_L24_vs_d3_b9.0_L24r`: a·m: R5 +2.90σ / t1 +1.91σ / t2 +2.90σ; a√σ: R5 +0.35σ / t1 +0.22σ / t2 +0.35σ; m/√σ: R5 +2.74σ / t1 +1.76σ / t2 +2.74σ; plaquette: - -2.13σ
- `replication.d4_b2.5_L16_vs_d4_b2.5_L16x`: a·m: R5 -0.87σ / t1 -0.87σ / t2 +0.28σ; a√σ: R5 +1.59σ / t1 +0.41σ / t2 +0.76σ; m/√σ: R5 -1.67σ / t1 -0.97σ / t2 +0.14σ; plaquette: - +0.08σ
- `literature.primary_ensembles`: R5: 4 van 15 boven 2σ, 1 boven 3σ; t1: 3 van 15 boven 2σ, 1 boven 3σ; t2: 2 van 15 boven 2σ, 0 boven 3σ
- `literature.independent_all_data`: R5: 4 van 22 boven 2σ, 2 boven 3σ; t1: 4 van 23 boven 2σ, 2 boven 3σ; t2: 1 van 23 boven 2σ, 0 boven 3σ
- `quality.min_am_over_err`: 12 (d4_b2.4_L16)
- `quality.min_bins`: 37 (d4_b2.5_L16x)
- `quality.max_hot_minus_cold`: -2.25 (d4_b2.4_L16)

Bronsleutel van elk getal: veld `source` van het betreffende item.

## 8. Beperkingen: wat hieruit niet geclaimd mag worden

(Engelstalig, letterlijk gelijk aan `limits` in summary.json; de getallen zijn door het script ingevuld.)

- This is numerical evidence for a mass gap in a lattice model, not a proof. The Millennium problem is open; nothing here proves or solves it.
- On a finite lattice the transfer matrix has a discrete spectrum, so a nonzero gap at one (beta, L) is automatic and a*m/error only measures precision. The physically meaningful evidence is that m/sqrt(sigma) stays finite and stable when L grows and a shrinks; this is tested with three lattice spacings per dimension and one larger volume at one beta in D=3 and at two betas in D=4 (beta = 2.4 in round 2, beta = 2.5 in round 3), no more.
- All masses are variational upper estimates at small t (t = 1 or 2) with statistical errors only. Rule R5 picks t* on the same data: its error under-covers (52-65 % within 1 sigma in the synthetic tests quoted in the pipeline files), so every R5 number must be read with m_eff(1) and m_eff(2) beside it.
- Replication failure at the 2-3 sigma level in D=3, beta=9: d3_b9.0_L24 minus d3_b9.0_L24r is +2.9 sigma for a*m by rule R5 (both t*=2), +1.9 sigma at fixed t=1, +2.7 sigma for m/sqrt(sigma) (R5) and -2.1 sigma for the plaquette. In round 1 the effective mass rises from t=1 to t=2 by 2.0 sigma (m_eff(1)-m_eff(2) = -0.0207(105)), which a variational correlator cannot do in expectation; in the replication it falls (0.0111(87)). Reading the pre-registered round-1 number at beta=9 as an upward fluctuation that rule R5 then selected is consistent with these numbers, but it is a post-hoc reading; the pre-registered value stays what it is and all three (round 1, replication, combined) are reported.
- D=4 glueball masses against the literature values of literature.json (search-excerpt level, column assignment inferred; rule R5 chose t*=1 in every D=4 glueball channel, so R5 = m_eff(1)): d4_b2.3_L10: m_eff(1) = 1.1951(223) (-0.7 sigma), m_eff(2) = 1.1492(704) (-0.9 sigma) vs 1.216(23); d4_b2.4_L12: m_eff(1) = 0.9926(148) (+2.1 sigma), m_eff(2) = 0.9809(404) (+1.0 sigma) vs 0.936(23); d4_b2.4_L16: m_eff(1) = 0.9863(309) (+1.3 sigma), m_eff(2) = 1.0215(850) (+1.0 sigma) vs 0.936(23); d4_b2.5_L16: m_eff(1) = 0.7420(216) (+2.7 sigma), m_eff(2) = 0.7667(494) (+2.0 sigma) vs 0.660(22); d4_b2.5_L16_combined: m_eff(1) = 0.7531(170) (+3.3 sigma), m_eff(2) = 0.7463(371) (+2.0 sigma) vs 0.660(22); d4_b2.5_L20: m_eff(1) = 0.7263(125) (+2.6 sigma), m_eff(2) = 0.7186(263) (+1.7 sigma) vs 0.660(22). At beta = 2.4 and 2.5 our values lie above the reference. Ours are variational upper estimates from a small operator basis; m_eff(2) has errors 2.1-3.2 times larger and neither confirms nor removes the excess. The tension is unresolved.
- String tension, d4_b2.4_L12: a*sqrt(sigma) = 0.2619(9) (Nambu-Goto, t=1) against 0.2673(15) [search_excerpt; lattice size not named]: -3.1 sigma (-3.5 sigma with the Luscher formula). The torelon of this ensemble has L*sqrt(sigma) = 3.14(1) (our other volume at this beta, d4_b2.4_L16 with L = 16, gives 0.2653(26)); a short flux loop is where corrections beyond the string formulas are largest, and m/sqrt(sigma) of this ensemble inherits the shift.
- D=4 (primary, R5): m/sqrt(sigma) rises by 0.637(139) (+4.6 sigma) from beta=2.3 to 2.5; a straight line in a^2 sigma is formally acceptable (chi2/dof = 0.32/1) with intercept 4.259(116), +3.5 sigma from the literature continuum value 3.78(7); this intercept is not a continuum limit (see scaling_d4.note).
- D=4 (all_data, R5): m/sqrt(sigma) rises by 0.710(120) (+5.9 sigma) from beta=2.3 to 2.5; a straight line in a^2 sigma is formally acceptable (chi2/dof = 0.01/1) with intercept 4.305(103), +4.2 sigma from the literature continuum value 3.78(7); this intercept is not a continuum limit (see scaling_d4.note).
- D=3 (primary) m/sqrt(sigma) over beta = 6, 9, 12 - R5: constant 4.773(26) (chi2/dof 11.7/2, p=0.003), linear intercept 4.863(51) (chi2/dof 7.6/1, p=0.006), pulls of the intercept against the excerpt-level continuum values 4.716(21): +2.6, 4.737(6): +2.4, 4.718(43): +2.2; t1: constant 4.788(21) (chi2/dof 6.5/2, p=0.039), linear intercept 4.860(43) (chi2/dof 2.8/1, p=0.093), pulls of the intercept against the excerpt-level continuum values 4.716(21): +3.0, 4.737(6): +2.8, 4.718(43): +2.3. Three lattice spacings and a variational systematic (the masses are upper estimates at small t; that bias is not part of the statistical errors) do not make a controlled continuum limit. The intercepts describe these three points; they are indicative only.
- D=3 (all_data) m/sqrt(sigma) over beta = 6, 9, 12 - R5: constant 4.790(19) (chi2/dof 7.1/2, p=0.029), linear intercept 4.866(38) (chi2/dof 2.0/1, p=0.156), pulls of the intercept against the excerpt-level continuum values 4.716(21): +3.4, 4.737(6): +3.3, 4.718(43): +2.6; t1: constant 4.783(17) (chi2/dof 3.6/2, p=0.167), linear intercept 4.837(36) (chi2/dof 0.7/1, p=0.403), pulls of the intercept against the excerpt-level continuum values 4.716(21): +2.9, 4.737(6): +2.7, 4.718(43): +2.1. Three lattice spacings and a variational systematic (the masses are upper estimates at small t; that bias is not part of the statistical errors) do not make a controlled continuum limit. The intercepts describe these three points; they are indicative only.
- Finite volume, d3_b6.0_L16 (16^3) minus d3_b6.0_L24 (24^3): a*m R5: +0.2 sigma; a*m t1: +0.2 sigma; a*m t2: +0.4 sigma; a*sqrt(sigma) R5: no measurement on one side; a*sqrt(sigma) t1: -1.3 sigma; a*sqrt(sigma) t2: -1.6 sigma. The larger volume has errors 1.8 (a*m) and 3.6 (a*sqrt(sigma)) times those of the smaller volume at t=1: finite-volume effects are bounded only at the level of these errors.
- Finite volume, d4_b2.4_L12 (16x12^3) minus d4_b2.4_L16 (16^4): a*m R5: +0.2 sigma; a*m t1: +0.2 sigma; a*m t2: -0.4 sigma; a*sqrt(sigma) R5: -1.2 sigma; a*sqrt(sigma) t1: -1.2 sigma; a*sqrt(sigma) t2: +0.1 sigma. The larger volume has errors 2.1 (a*m) and 2.8 (a*sqrt(sigma)) times those of the smaller volume at t=1: finite-volume effects are bounded only at the level of these errors.
- Finite volume, d4_b2.5_L16_combined (16^4) minus d4_b2.5_L20 (20^4): a*m R5: +1.3 sigma; a*m t1: +1.3 sigma; a*m t2: +0.6 sigma; a*sqrt(sigma) R5: +0.1 sigma; a*sqrt(sigma) t1: -0.9 sigma; a*sqrt(sigma) t2: -0.3 sigma. The larger volume has errors 0.7 (a*m) and 0.9 (a*sqrt(sigma)) times those of the smaller volume at t=1: finite-volume effects are bounded only at the level of these errors.
- No plateau (rule R5 gives an upper bound only, not a measurement): d3_b6.0_L24 (torelon / string tension); only the fixed-t values can be compared there.
- Few jackknife bins (errors of errors are large, about 1/sqrt(2 n_bins)): d4_b2.4_L16: 178 bins, tau_int,max = 2.9, d4_b2.5_L16: 52 bins, tau_int,max = 10.6, d4_b2.5_L16x: 37 bins, tau_int,max = 12.1, d4_b2.5_L16_combined: 100 bins, tau_int,max = 10.3, d4_b2.5_L20: 156 bins, tau_int,max = 6.1.
- Hot-start minus cold-start plaquette beyond 2 sigma: d4_b2.4_L16: -2.2 sigma (possible residual thermalisation effect or a fluctuation; not resolved).
- Literature values are 'seen in a web-search excerpt' at best, several are quoted from memory; no published table was opened. Agreement or disagreement with them is correspondingly weak evidence.
- D=4 is far from two-loop asymptotic scaling in this beta range (see scaling_d4.asymptotic_scaling): the lattice spacing in physical units is fixed by sqrt(sigma), not by perturbation theory.

## Figuren

`summary_scaling_d3.png`, `summary_scaling_d4.png`, `summary_volume.png` — numeriek bewijsmateriaal, geen bewijs.
