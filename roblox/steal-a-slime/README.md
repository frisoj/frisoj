# Steal a Slime

Een Roblox-game in de stijl van de best verdienende games van 2025-2026 (Steal a Brainrot, Steal An Egg, Grow a Garden), met een eigen draai. Koop slijmpjes van de Goo-rivier en laat ze in je lab Goo verdienen. Steel die van anderen, fuseer ze tot Giants en Titans, en jaag op mutaties in de Goo-stormen.

Het hele plan, met het onderzoek en alle getallen, staat in [BLUEPRINT.md](BLUEPRINT.md).

## Wat erin zit

- **22 slijmsoorten** in 8 zeldzaamheden (Common tot Secret), elk met een eigen 3D-look.
- **6 mutaties** via Goo-stormen: Gold ×2, Diamond ×3, Candy ×4, Lava ×6, Galaxy ×10, Rainbow ×15.
- **Stelen en verdedigen:**
  - laserpoort met Lock-knop en een Lab Shield;
  - de Bonker-hamer stuurt gestolen slijmpjes terug naar huis.
- **Voortgang:**
  - fusie tot Giant ×4 en Titan ×16;
  - 10 rebirths;
  - Slijmdex-bonus;
  - offline verdiensten.
- **Terugkomen en lang spelen:**
  - dagelijkse beloning (reeks van 7 dagen);
  - 10 speeltijd-cadeaus tot 60 minuten;
  - codes;
  - Slime Storm Saturday: elke zaterdag 18:00-18:30 UTC dubbel Goo en dubbel geluk.
- **20 dingen om te kopen:** 8 Game Passes en 12 Developer Products, met plaatjes in `marketing/items/`.
- **Regels van Roblox:**
  - eieren en Server Luck tonen hun kansen achter een ODDS-knop;
  - spelers die volgens PolicyService geen willekeurige items mogen kopen, zien de eieren niet;
  - aankopen worden precies één keer gegeven;
  - saves hebben een sessie-slot, zodat er geen slijmpjes verdubbelen.

## Online zetten

### 1. Eén keer: de game aanmaken in Roblox Studio
1. Download `StealASlime.rbxl` uit deze map. Hij wordt ook bij elke run van de workflow **Roblox deploy (Steal a Slime)** onder *Artifacts* gezet.
2. Open het bestand in Roblox Studio en kies **File > Publish to Roblox > Create new experience**. Naam: `Steal a Slime`, genre: Simulation.
3. Zet in **Game Settings > Security** de optie **Enable Studio Access to API Services** aan. Dan werkt opslaan ook als je in Studio test.

### 2. Automatisch laten bijwerken
Gebruik een Open Cloud API-sleutel (Creator Hub > API Keys) met deze rechten voor **deze** game:
- universe-places: write
- developer-product: read en write
- game-pass: read en write

Zet de sleutel in GitHub als repository secret, bij *Settings > Secrets and variables > Actions > New repository secret*:
- `ROBLOX_API_KEY_SLIME`, of
- `ROBLOX_API_KEY` als die sleutel voor beide games geldt. De workflow kiest dan de game met "slime" in de naam.

Daarna doet de workflow bij elke wijziging alles vanzelf:
1. de 20 producten en passes aanmaken, met plaatje en prijs;
2. hun ID's invullen;
3. bouwen en publiceren.

### 3. Openbaar maken en geld verdienen
In de Creator Hub doe je zelf:
- de vragenlijst (Questionnaire) invullen;
- icoon en thumbnail uploaden (`marketing/game-icon.png`, `marketing/thumbnail.png`);
- de game op **Public** zetten.

Tips voor de lancering staan in BLUEPRINT.md, hoofdstuk 9.

## Zelf aanpassen

- **Getallen** (prijzen in de winkel, lock-tijd, stormen, cadeaus, codes): `src/shared/Config.luau`
- **Slijmsoorten, kansen en mutaties:** `src/shared/Slimes.luau`
- **Rebirth-eisen:** `src/shared/Rebirths.luau`
- **Indeling van de wereld:** `src/shared/Layout.luau`. De map zelf wordt gebouwd door `tools/MapBuilder.luau`.

Een nieuwe code toevoegen:

```lua
Config.CODES = {
	SLIME = { goo = 1000 },
	NIEUWECODE = { goo = 25000 },
}
```

## Controleren en bouwen

```sh
./tools/install-tools.sh                     # Rojo, Lune, luau-lsp (eenmalig)
export PATH="$PWD/.tools:$PATH"
./tools/check.sh                             # typecheck + tests
./build.sh                                   # maakt StealASlime.rbxl
python3 tools/deploy.py --dry-run            # laat zien wat online zou gebeuren
```

## Mappen

| Map | Inhoud |
|---|---|
| `src/shared` | Instellingen, slijmsoorten, kansen, rebirths, events, wereldindeling (server en client) |
| `src/server` | Opslaan, labs, rivier, stelen, fuseren, stormen, aankopen, ranglijsten, de Bonker |
| `src/client` | Slijm-modellen en -animaties, rivier- en labweergave, interface, effecten |
| `tools` | Mapbouwer, bouwscripts, tests, automatisch publiceren |
| `marketing` | Icoon, thumbnail, winkelplaatjes en de bronbestanden om ze opnieuw te maken |
