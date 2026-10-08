# Icoon, thumbnail en winkelplaatjes opnieuw maken

Alles wordt getekend door `art.js`: slijmpjes, het Roblox-poppetje en de spullen voor de winkel.

Nodig: Node met Playwright (Chromium) en Python 3 met Pillow.
Zet eerst `Fredoka.ttf` (Google Fonts, Open Font License) naast deze bestanden.

```sh
node render-items.cjs                                  # 20 winkelplaatjes in ../items/
node shot.cjs cover.html#cover 1920 1080 /tmp/c.png 2 && python3 scale.py /tmp/c.png ../thumbnail.png 1920 1080
node shot.cjs cover.html#icon 512 512 /tmp/i.png 2 && python3 scale.py /tmp/i.png ../game-icon.png 512 512
```

Plaatjes van Game Passes worden op Roblox rond afgesneden. Houd het onderwerp en de tekst daarom binnen de cirkel.
