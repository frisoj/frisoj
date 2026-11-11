# review/ — scripts en uitvoer van de controleronde

Numeriek bewijsmateriaal, geen bewijs. Deze map bevat de scripts waarmee de
twee kritische controles (statistiek, natuurkunde) en de rapportstap hun
getallen hebben berekend, met de tekstuitvoer van die runs. In `REPORT.md`
heten deze bronnen [C1], [C2] en [A].

De scripts staan hier **ongewijzigd, zoals ze zijn gedraaid**. Ze horen niet
bij de geteste code (`ym/`, `analyze.py`, `independent_analysis.py`,
`summarize.py`), worden niet door de testsuite gedekt en zijn verkennend.

| map | inhoud |
|---|---|
| `stats/` | statistische controle [C1]: foutencontrole (`a1_errors.py`), thermalisatie (`a2_therm.py`, `a3*.py`), het punt bij β = 9 (`a4_beta9.py`), schaalfits (`a5_ratios_fits.py`), toets op massa nul (`a6_zero_mass.py`), onafhankelijkheid en operatorkeuze (`a8`, `a11`–`a13`), overzicht (`a9_survey.py`); gedeelde functies in `lib.py`; uitvoer in `out/` |
| `physics/` | natuurkundige controle [C2]: formules, volumes en schaalfits uit `results/*.json` (`checks1.py`), verkennende toetsen op de ruwe data (`checks2.py`–`checks4.py`: bijmenging, torelonpaar, fit met twee toestanden); uitvoer in `out*.txt`, `rows.json` |
| `report/` | rekensommen voor de tabellen van het rapport [A] (`make_tables.py`, `table3.py` → `tables.txt`, `table3.txt`), een herhaling van `physics/checks1.py` (`checks1.txt`), testuitvoer [T] (`t_rP.txt`) en de uitvoer van een herhaling van vier scripts van de statistische controle (`stats_rerun_a3*.txt`) |

## Opnieuw draaien

De scripts verwijzen naar het project met het absolute pad
`/home/user/frisoj/yang-mills` en schrijven naar hun eigen map. Vervang dat
pad eerst door je eigen checkout, vanuit de map `yang-mills/`:

```bash
grep -rl /home/user/frisoj/yang-mills review | xargs sed -i "s#/home/user/frisoj/yang-mills#$PWD#g"
export NUMBA_NUM_THREADS=1 OMP_NUM_THREADS=1
python3 review/stats/a1_errors.py        # enzovoort
```

Wat je nodig hebt en wat hier niet staat:

- de ruwe data in `results/raw/` (niet in git; zie `REPORT.md` §6.2);
- de scripts `stats/a2_therm.py` en `stats/a3*.py` genereren het begin van
  productiestromen opnieuw en bewaren dat in `stats/cache/` en `stats/hist/`
  (samen ongeveer 110 MB); die tussenbestanden zijn niet opgenomen en worden
  bij een nieuwe run opnieuw gemaakt;
- `physics/checks1.py` schrijft `rows.json` naar het tijdelijke pad dat op
  regel 164 staat; pas die regel aan.

Een enkele run kan in de laatste cijfers afwijken van de opgeslagen uitvoer
als een blokgrootte anders wordt gekozen (zie de voetnoot bij de tabel in
`REPORT.md` §4.3).
