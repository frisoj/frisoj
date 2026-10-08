# Cover, icoon en trailer opnieuw maken

Alles wordt getekend door `art.js` (walvis, Roblox-poppetje, Driftlings, de 8 luchten).
`cover.html` maakt de thumbnail en het icoon, `trailer.html` de video, `music.py` de muziek.

Nodig: Node met Playwright (Chromium), Python 3 met numpy en Pillow, en ffmpeg.
Zet eerst `Fredoka.ttf` (Google Fonts, Open Font License) naast deze bestanden.

```sh
# thumbnail 1920x1080 en icoon 512x512, op 2x gerenderd en netjes verkleind
node shot.cjs cover.html#cover 1920 1080 /tmp/cover-2x.png 2 && python3 scale.py /tmp/cover-2x.png ../thumbnail.png 1920 1080
node shot.cjs cover.html#icon 512 512 /tmp/icon-2x.png 2 && python3 scale.py /tmp/icon-2x.png ../game-icon.png 512 512

# trailer: 1800 beelden (60 fps), muziek, en samenvoegen
OUT=frames FPS=60 node frames.cjs
python3 music.py
ffmpeg -framerate 60 -i frames/f%05d.png -i music.wav -c:v libx264 -preset slow -crf 16 -profile:v high -pix_fmt yuv420p \
  -c:a aac -b:a 256k -movflags +faststart -shortest ../trailer.mp4
```

Losse beelden bekijken: `node frames.cjs preview 4 12.9 28` (komt in `preview/`).
