# Trailer opnieuw maken

1. Zet `Fredoka.ttf` (Google Fonts) naast `trailer.html`.
2. `python3 music.py` maakt `music.wav` (muziek en geluidseffecten, zelf gesynthetiseerd).
3. `node frames.cjs` maakt 900 beelden in `frames/` (Playwright met Chromium).
4. `ffmpeg -framerate 30 -i frames/f%04d.jpg -i music.wav -c:v libx264 -crf 20 -pix_fmt yuv420p -c:a aac -shortest trailer.mp4`
