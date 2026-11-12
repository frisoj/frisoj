# yang-mills — SU(2)-rooster-Yang–Mills in D = 2, 3 en 4

Een getest Monte-Carlo-programma voor zuivere SU(2)-ijktheorie op het rooster (Wilson-actie),
met analyse van de lichtste glueballmassa en de snaarspanning.

**Wat dit is — en wat niet.** Dit project levert *numeriek bewijsmateriaal* voor een massakloof
in het roostermodel: een lichtste glueballmassa en een snaarspanning die niet nul zijn, bij
eindige roosterafstand en eindig volume, met statistische fouten. Een massa ongelijk aan nul is
op een eindig rooster vanzelfsprekend; wat telt, staat in `REPORT.md` §0: in D = 3 is m/√σ bij
vaste t stabiel binnen 1 à 2 % over een factor 2,1 in roosterafstand (achteraf samengestelde
set); in D = 4 is alleen uitgesloten dat de kloof als 1/L met de doos meekrimpt (bij β = 2,4 en
2,5, telkens met twee doosgroottes), is volume-onafhankelijkheid niet aangetoond en is er geen
aanwijzing voor schaalgedrag. Het is **geen bewijs** van het
millenniumprobleem "Yang–Mills: bestaan en massakloof" en mag nooit zo worden gepresenteerd. De
achtergrond en de precieze reikwijdte staan in `THEORY.md`; literatuurwaarden (met bron en
betrouwbaarheid) in `literature.json`.

## Inhoud

| pad | wat |
| --- | --- |
| `REPORT.md` | eindrapport: wat er gemeten is, alle controles en spanningen, en wat het wel en niet bewijst |
| `ym/lattice.py` | motor: heatbath (Creutz / Kennedy–Pendleton) + overrelaxatie, plaquette, Wilson- en Polyakov-lussen |
| `ym/exact.py` | exacte D=2-formules, sterke-koppelingsreeks, twee-lus-schaalformule |
| `ym/observables.py` | APE-smearing, glueball- (0++) en torelon-operatoren per tijdplak |
| `ym/stats.py` | analyse volgens de **vooraf vastgelegde regels R1–R8** (bovenaan dat bestand) |
| `ym/reference.py` | onafhankelijke referentie-implementatie (numpy, 2×2-matrices, Metropolis) |
| `run_production.py` | productierun: één Monte-Carlo-stroom → ruw `.npz`-bestand |
| `analyze.py` | analyse van één ensemble (meerdere stromen) → JSON + figuren |
| `run_all_production.sh`, `run_extra_production.sh`, `run_round3_production.sh` | de productie-ensembles zoals ze gedraaid zijn (ronde 1, 2 en 3; het doel van ronde 2 en 3 staat bovenaan het script, vastgelegd vóór de run) |
| `round3_plan.md` | analyseplan voor ronde 3, vastgelegd voordat de data van die ronde werden bekeken |
| `review/` | scripts en tekstuitvoer van de controleronde (statistiek, natuurkunde, rekensommen voor het rapport), ongewijzigd zoals ze zijn gedraaid; hoort niet bij de geteste code |
| `independent_analysis.py` | onafhankelijke heranalyse van de ruwe data (deelt geen code met `ym/stats.py` en `analyze.py`; bootstrapfouten) → `results/independent/` |
| `summarize.py` | synthese over alle ensembles: tabellen, schaalfits, volume- en replicatievergelijkingen, vergelijking met `literature.json` → `results/summary.json`, `results/summary.md` en drie figuren |
| `results/` | uitkomsten: per ensemble `<naam>.json` en drie figuren (uitvoer van `analyze.py`), `logs/` (dezelfde samenvattingen als tekst), `summary.*` (uitvoer van `summarize.py`), `independent/` (uitvoer van `independent_analysis.py`, met `COMPARISON.md`); `raw/` bevat de ruwe data en staat niet in git |
| `tests/` | testsuite (zie hieronder) |

Conventies: een SU(2)-element is een eenheidsquaternion `(a0, a1, a2, a3)`; as 0 is de tijd;
"plaquette" = ⟨½ Tr U_p⟩; β = 4/g² in D = 4. Zie de docstring van `ym/lattice.py`.

## Installatie

Python 3 met `numpy`, `scipy`, `numba`, `pytest`, `matplotlib` (`requirements.txt`). Alles draait
op één processorkern; zet `NUMBA_NUM_THREADS=1 OMP_NUM_THREADS=1`.

## Tests

Vanuit deze map:

```bash
python3 -m pytest -q                      # standaardsuite, ongeveer 10-15 minuten
python3 -m pytest -q tests/test_engine.py -rP    # één bestand, met alle gemeten getallen
```

Tests met het merk `slow` worden standaard **overgeslagen** (ze tellen dan als "skipped", niet
als geslaagd). Draai ze met `--runslow`, bij voorkeur één tegelijk (elk 1–4 minuten):

```bash
python3 -m pytest -q --runslow -rP \
  "tests/test_engine.py::test_slow_strong_coupling_d4_beta125_pins_second_coefficient"
python3 -m pytest -q --collect-only -m slow     # lijst van alle trage tests
```

Let op: `-k test_c` selecteert ook alles in `test_crosscheck.py` (de bestandsnaam telt mee);
gebruik `-k test_c_`.

Wat er getest wordt: algebra, ijkinvariantie en reproduceerbaarheid; de heatbath-verdeling;
exacte D=2-resultaten (plaquette, Wilson-lussen, torelon, ook op piepkleine tori);
de sterke-koppelingsreeks (coëfficiënten onafhankelijk nageteld door oppervlakken te
enumereren, en met Monte Carlo); Schwinger–Dyson-identiteiten; vergelijking met de
onafhankelijke referentiecode; literatuurwaarden van de D=4-plaquette; de volledige
analyseketen op synthetische data met bekend antwoord en op D=2 (exact).
Geen tolerantie, seed of criterium mag worden aangepast om een falende test te laten slagen;
wijzigingen na een eerste run staan in de docstring van het betreffende testbestand.

## Een productie-ensemble draaien

Eén stroom (één seed) per aanroep; onafhankelijke stromen krijgen verschillende seeds:

```bash
python3 run_production.py --shape 16,16,16 --beta 6.0 --ntherm 1000 --nmeas 20000 \
    --nhb 1 --nor 4 --nskip 1 --levels 2,6,12,18 --w 0.25 --loops 1x1,2x2 \
    --seed 101 --start hot --out results/raw/d3_b6.0_L16_s101.npz
```

- Eén cyclus = `nskip` × (`nhb` heatbath- + `nor` overrelaxatie-sweeps) + één meting.
- `--maxtime S` stopt netjes na S seconden; `--resume` zet een onderbroken run **bit-identiek**
  voort (ijkveld en toestand van de toevalsgenerator staan in het bestand). Een bestaand
  bestand wordt nooit overschreven zonder `--resume`.
- Gebruik smearing-gewicht `--w 0.25`. Bij `w = 0.5` wordt de gestaggerde mode niet gedempt
  (stabiliteitsgrens; het programma waarschuwt).
- β moet eindig en ≥ 0 zijn; de toevalsgenerator is één stroom per proces (één rooster per
  proces draaien).
- De gedraaide ensembles, seeds en tijdsbudgetten staan in `run_all_production.sh`,
  `run_extra_production.sh` en `run_round3_production.sh` (4 stromen per ensemble, afwisselend warme en koude start).
  Ruwe data komen in `results/raw/` (niet in git; reproduceerbaar uit de seeds).

## Analyse

```bash
python3 analyze.py results/raw/d3_b6.0_L16_s*.npz --name d3_b6.0_L16 --outdir results
```

Schrijft `results/<naam>.json` en drie figuren, en drukt een samenvatting af. Bestanden van
verschillende ensembles of met dezelfde seed worden geweigerd. Opties: `--binsize N`,
`--discard N` (extra thermalisatie, wordt geteld), `--no-plots`. Het JSON-schema staat in de
docstring van `analyze.py`.

De analyse volgt de regels R1–R8 in `ym/stats.py` (correlatormatrix met vacuümaftrek binnen de
jackknife, operatorselectie, GEVP met t0 = 0, cosh-effectieve massa, plateauregel,
Lüscher- en Nambu–Goto-snaarspanning, bins van 10 τ_int). **Die regels lagen vast voordat er
productiedata waren en worden niet achteraf gewijzigd.**

### Hoe de getallen te lezen (verplichte kanttekeningen)

Deze staan ook in elk JSON-bestand onder `caveats`.

1. **Plateauregel R5.** Het tijdstip t* wordt gekozen met dezelfde data die m_eff(t*) geven. De
   opgegeven jackknife-fout bevat dat selectie-effect niet: in synthetische tests ligt 52–65 %
   van de uitkomsten binnen 1σ van de waarheid (nominaal 68 %) en 91–97 % binnen 2σ. Lees
   daarom altijd de waarden bij vaste t (`fixed_t`, `meff_table`) ernaast, behandel
   m_eff(1) − m_eff(2) als systematische onzekerheid, en claim geen overeenstemming of
   afwijking op 1σ-niveau op grond van het R5-getal alleen.
2. m_eff(t*) is een **bovengrens-schatting** (variationeel) met alleen een statistische fout.
3. Een waarde met `upper_bound_only` ("no plateau") is geen meting.
4. Elk ensemble is één roosterafstand en één volume; continuüm- en volumelimiet vergen
   meerdere ensembles.
5. Controleer `warnings`, `binning_check` (zelfde analyse met dubbele bins) en
   `stream_consistency` (stromen onderling, warme tegen koude start). Voor de massa's: analyseer
   de warme en de koude stromen ook apart (`analyze.py` op een deelverzameling van de
   bestanden, met `--name`).

## Herkomst van de data

De productieruns van ronde 1 en 2 zijn gedraaid met de code van git-commit `8613969`; voor
ronde 3 zegt `run_round3_production.sh` dat dezelfde code-snapshot is gebruikt. Latere wijzigingen aan
`ym/lattice.py` (alleen controle van β) veranderen geen enkel getal dat een productierun
wegschrijft; dat is bit voor bit nagegaan. Wijzigingen aan `analyze.py` zijn puur toevoegend
(extra velden); `ym/stats.py` geeft alleen een ander τ_int in het geval dat stromen sterk in
lengte verschillen én het venster eerder niet werd gehaald.
