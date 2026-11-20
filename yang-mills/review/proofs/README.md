# review/proofs/ — controle van BEWIJZEN.md

Rapporten en rekenscripts van de controles van `BEWIJZEN.md`. Alle controles zijn gedaan door
hetzelfde AI-systeem dat het document heeft geschreven, in afzonderlijke rondes. Geen
wiskundige heeft het document beoordeeld. `BEWIJZEN.md` bevat geen bewijs van het
millenniumprobleem; deze map verandert daar niets aan.

| bestand | inhoud |
|---|---|
| `findings_round1.txt` | vier leesrapporten van 15 november 2026 (stelling A; stelling B; de lemma's van stelling C; uitspraak en bewijs van stelling C): geen foute stap, 32 kleine punten |
| `findings_round2.txt` | drie rapporten van 16 november 2026: over alle passages die na ronde 1 nieuw of gewijzigd waren (geen fout, 11 kleine punten), over het afmaken van `tests/test_proofs_c.py`, en over de verwijzingen en de uitspraken over de literatuur (alle 23 verwijzingen teruggevonden; 8 punten over toeschrijvingen) |
| `findings_round3.txt` | het rapport van 20 november 2026 over de hele tekst (formulering, samenhang, verwijzingen, getallen, taal): geen claim dat het millenniumprobleem is opgelost; 27 punten, waarvan 4 belangrijke over te sterke formuleringen in hoofdstuk 6 en §5.2 |
| `findings_layout.txt` | het rapport van 20 november 2026 over de opmaak van een proefdruk van `BEWIJZEN.pdf`: zetfouten in formules (afgesneden letters, losse accenten, verkeerde spaties) hersteld in `pdf/make_bewijzen_pdf.py` en `pdf/style_bewijzen.css`; voorstellen om lange formules op een eigen regel te zetten, overgenomen in `BEWIJZEN.md`. De formules zijn niet teken voor teken met de bron vergeleken |
| `ref_a_*.py`, `ref_b_*.py`, `ref_c1_*.py`, `ref_c2_*.py` | rekenscripts van de vier lezers van ronde 1 |
| `ref_d_*.py` | rekenscripts van de lezer van ronde 2 |
| `r2_lit_checks.py` | narekenen van de formules voor Besselfuncties uit de bijlage en van de schaalformule van §5.1 (literatuurcontrole) |
| `r2_test_c_mutations.py` | 51 opzettelijke verstoringen van de beweringen van stelling C: welke merkt `tests/test_proofs_c.py` op en welke niet |
| `r3_test_ab_mutations.py` | 10 opzettelijke verstoringen van formules van stelling A en B: alle worden door `tests/test_proofs_ab.py` opgemerkt |

Alle punten uit de rapporten zijn in `BEWIJZEN.md` verwerkt; hoofdstuk 6 van dat document vat
samen wat er gecontroleerd is en wat niet. Bij de literatuurcontrole kon geen enkel artikel
worden geopend; de legenda in hoofdstuk 7 van `BEWIJZEN.md` zegt per verwijzing of titel en
vindplaats zijn teruggevonden.

Niet gedaan: de aparte beoordeling van `tests/test_proofs_ab.py` is twee keer afgebroken door
een gebruikslimiet en heeft geen rapport opgeleverd. De scripts draaien vanuit de map
`yang-mills` (bijvoorbeeld `python3 review/proofs/ref_c2_z2_gap.py`); elk duurt hooguit een
paar minuten.
