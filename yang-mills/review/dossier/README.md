# review/dossier/ — testuitvoer bij DOSSIER.pdf

Numeriek bewijsmateriaal en drie bekende stellingen, geen bewijs van het millenniumprobleem.
Deze map bevat de uitvoer van de testronde van 24 november 2026 waar het voorblad van
`DOSSIER.pdf` naar verwijst. `pdf/make_dossier_pdf.py` leest de regel over de toetsen uit
`junit_default.xml`.

| bestand | inhoud |
|---|---|
| `pytest_default.txt`, `junit_default.xml` | de standaardronde van de hele testsuite: 608 toetsen, 565 geslaagd, 43 trage toetsen overgeslagen, 0 mislukt; het xml-bestand noemt de uitslag en de looptijd per toets |
| `pytest_slow_engine.txt`, `junit_slow_engine.xml` | de 15 trage toetsen van `tests/test_engine.py`, apart gedraaid met `-m slow --runslow`: 15 geslaagd |

Niet gedaan in deze ronde: de andere 28 trage toetsen (in `test_adversarial.py`,
`test_adversarial_analysis.py`, `test_crosscheck.py`, `test_proofs_ab.py` en
`test_proofs_c.py`). Die run is afgebroken voordat hij klaar was en heeft geen uitvoer
opgeleverd. Eerdere uitslagen van trage toetsen staan in `review/numcheck/slow_out_*.txt`.
