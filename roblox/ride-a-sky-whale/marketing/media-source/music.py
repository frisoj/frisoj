# Muziek en geluidseffecten voor de trailer, volledig gesynthetiseerd (geen samples).
# 120 BPM, maten van 2 s vanaf t = 0,5 zodat de scènewissels op de maat vallen.
# Gebruik: python3 music.py  -> music.wav (48 kHz stereo, 30 s)
import wave
import numpy as np

SR = 48000
DUR = 30.0
N = int(SR * DUR)
BEAT = 0.5
BAR = 2.0
GRID = 0.5  # eerste maat begint hier
rng = np.random.default_rng(42)

dry = np.zeros((N, 2))
wet = np.zeros((N, 2))  # gaat door de galm


def note_hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def place(buf, sig, t0, gain=1.0, pan=0.0):
    i0 = int(round(t0 * SR))
    if i0 >= N or i0 + len(sig) <= 0:
        return
    s = sig if sig.ndim == 2 else np.stack([sig * np.sqrt(0.5 * (1 - pan)), sig * np.sqrt(0.5 * (1 + pan))], axis=1)
    a, b = max(0, i0), min(N, i0 + len(s))
    buf[a:b] += s[a - i0:b - i0] * gain


def add(sig, t0, gain=1.0, pan=0.0, send=0.0):
    place(dry, sig, t0, gain, pan)
    if send:
        place(wet, sig, t0, gain * send, pan)


def tt(d):
    return np.arange(int(d * SR)) / SR


def env(d, a=0.005, r=0.05):
    t = tt(d)
    return np.minimum(1, t / max(a, 1e-4)) * np.clip((d - t) / max(r, 1e-4), 0, 1)


def saw(f, d, harm=40, bright=None):
    """Bandbegrensde zaagtand; `bright` laat de hoge boventonen sneller wegsterven (filter-pluk)."""
    t = tt(d)
    out = np.zeros_like(t)
    for k in range(1, harm + 1):
        if f * k > 18000:
            break
        a = 1.0 / k
        if bright is not None:
            a = a * np.exp(-t * bright * (k - 1))
        out += a * np.sin(2 * np.pi * f * k * t)
    return out


def square(f, d, harm=25, bright=None):
    t = tt(d)
    out = np.zeros_like(t)
    for k in range(1, harm * 2, 2):
        if f * k > 18000:
            break
        a = 1.0 / k
        if bright is not None:
            a = a * np.exp(-t * bright * (k - 1))
        out += a * np.sin(2 * np.pi * f * k * t)
    return out


def noise(d):
    return rng.standard_normal(int(d * SR))


def fft_filter(x, lo=None, hi=None):
    X = np.fft.rfft(x, axis=0)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    g = np.ones_like(f)
    if hi:
        g *= 1 / np.sqrt(1 + (f / hi) ** 4)
    if lo:
        g *= 1 / np.sqrt(1 + (lo / np.maximum(f, 1)) ** 4)
    return np.fft.irfft(X * (g[:, None] if x.ndim == 2 else g), n=len(x), axis=0)


# ---------- drums ----------
def kick(gain=1.0):
    d = 0.42
    t = tt(d)
    f = 48 + 110 * np.exp(-t / 0.035)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.16)
    click = noise(d) * np.exp(-t / 0.003) * 0.25
    return (body + click) * gain


def clap():
    d = 0.35
    t = tt(d)
    n = fft_filter(noise(d), lo=900, hi=6000)
    e = np.zeros_like(t)
    for o in (0, 0.011, 0.022):
        e += (t >= o) * np.exp(-np.maximum(t - o, 0) / (0.008 if o < 0.02 else 0.09))
    tone = np.sin(2 * np.pi * 190 * t) * np.exp(-t / 0.05) * 0.4
    return n * e * 0.6 + tone


def hat(open_=False):
    d = 0.25 if open_ else 0.06
    t = tt(d)
    n = fft_filter(noise(d), lo=7000)
    return n * np.exp(-t / (0.08 if open_ else 0.014))


def crash(d=2.2):
    t = tt(d)
    n = fft_filter(noise(d), lo=3500)
    return n * np.exp(-t / 0.7)


def boom(d=2.5, f0=38):
    t = tt(d)
    f = f0 + 70 * np.exp(-t / 0.15)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.9)


def whoosh(d, rise=True):
    t = tt(d)
    n = noise(d)
    out = np.zeros_like(n)
    # zwaai van het filter door de noise, in blokjes
    steps = 24
    for i in range(steps):
        a, b = int(i * len(n) / steps), int((i + 1) * len(n) / steps)
        k = (i + 0.5) / steps
        c = 300 + (k if rise else 1 - k) ** 2 * 7000
        seg = fft_filter(n[max(0, a - 2000):b + 2000], lo=c * 0.5, hi=c * 1.5)
        out[a:b] = seg[a - max(0, a - 2000):a - max(0, a - 2000) + (b - a)]
    shape = np.sin(np.pi * np.clip(t / d, 0, 1)) ** 1.5 if not rise else (t / d) ** 2.2
    return out * shape


def ping(m, d=0.6, gain=1.0):
    t = tt(d)
    f = note_hz(m)
    s = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * f * 2.0 * t) + 0.12 * np.sin(2 * np.pi * f * 3.01 * t)
    return s * np.exp(-t / 0.18) * gain


def bell(m, d=2.5):
    t = tt(d)
    f = note_hz(m)
    parts = [(1, 1, 1.2), (2.0, 0.5, 0.8), (2.76, 0.35, 0.5), (5.4, 0.18, 0.25)]
    return sum(a * np.sin(2 * np.pi * f * r * t) * np.exp(-t / dec) for r, a, dec in parts)


def shimmer(d=1.6, base=84):
    t = tt(d)
    s = np.zeros_like(t)
    for i, m in enumerate((base, base + 4, base + 7, base + 11, base + 14)):
        s += np.sin(2 * np.pi * note_hz(m) * t + i) * (0.5 + 0.5 * np.sin(2 * np.pi * (9 + i) * t))
    return s * np.exp(-t / 0.7) * np.minimum(1, t / 0.05)


# ---------- harmonie ----------
KEY = 2  # alles een hele toon omhoog naar D groot: helderder
PROG = [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]]  # I V vi IV
DARK = [[57, 60, 64], [53, 57, 60]]  # eclips: vi IV


def chord_at(bar_index, dark=False):
    c = (DARK if dark else PROG)[bar_index % (2 if dark else 4)]
    return [m + KEY for m in c]


def bar_start(i):
    return GRID + i * BAR


SECTIONS = {'intro': (0, 3.0), 'ride': (3.0, 7.5), 'catch': (7.5, 12.5), 'skies': (12.5, 18.5),
            'nest': (18.5, 22.5), 'eclipse': (22.5, 26.5), 'end': (26.5, 30.0)}


def section(t):
    for k, (a, b) in SECTIONS.items():
        if a <= t < b:
            return k
    return 'end'


# Pad: drie ontstemde zaagtanden per noot, zacht gefilterd
pad = np.zeros((N, 2))
for i in range(-1, 15):
    t0 = bar_start(i)
    if t0 >= DUR:
        break
    dark = 22.5 <= t0 < 26.5
    ch = chord_at(max(i, 0), dark)
    d = BAR + 0.4
    for m in ch + [ch[0] - 12]:
        for det, pan in ((-0.12, -0.6), (0.0, 0.0), (0.12, 0.6)):
            s = saw(note_hz(m) * 2 ** (det / 12), d, harm=18) * env(d, 0.35, 0.4)
            place(pad, s, max(t0, 0), 0.028, pan)
pad = fft_filter(pad, hi=2600)
dry += pad
wet += pad * 0.5

# Bel-arpeggio in de intro
for j, m in enumerate([74, 78, 81, 86, 81, 78, 74, 81]):
    add(bell(m + KEY - 2), 0.15 + j * 0.34, 0.07, pan=(-0.5 if j % 2 else 0.5), send=0.9)

# Walvisroep
d = 2.4
t = tt(d)
f = 190 + 110 * np.sin(np.pi * t / d) - 40 * (t / d) + 7 * np.sin(2 * np.pi * 5.5 * t)
ph = 2 * np.pi * np.cumsum(f) / SR
call = (np.sin(ph) + 0.35 * np.sin(2 * ph) + 0.12 * np.sin(3 * ph)) * np.sin(np.pi * t / d) ** 1.5
add(call, 0.7, 0.16, send=0.9)
add(call, 27.0, 0.10, send=0.9)

# Drums, bas en arpeggio per tel
drums_on = lambda t: (3.0 <= t < 22.5) or (26.5 <= t < 29.0)
for k in range(int(DUR / (BEAT / 2))):
    t0 = k * BEAT / 2  # zestiende-achtsten: 0,25 s
    sec = section(t0)
    on_beat = abs((t0 / BEAT) - round(t0 / BEAT)) < 1e-6
    beat_i = int(round((t0 - GRID) / BEAT))
    bar_i = int((t0 - GRID) // BAR)
    dark = 22.5 <= t0 < 26.5
    ch = chord_at(max(bar_i, 0), dark)
    if drums_on(t0):
        if on_beat:
            add(kick(), t0, 0.6)
            if beat_i % 2 == 1 and sec not in ('ride',) or (sec == 'ride' and t0 >= 5.0 and beat_i % 2 == 1):
                add(clap(), t0, 0.32, pan=0.05, send=0.25)
        else:
            add(hat(open_=(sec in ('catch', 'skies', 'end'))), t0, 0.06 if sec != 'nest' else 0.045, pan=0.3)
        if sec in ('catch', 'skies', 'end'):
            add(hat(), t0 + 0.125, 0.03, pan=-0.3)
        # bas: achtsten met octaafsprong
        if t0 >= 3.0 and k % 2 == 0:
            m = ch[0] - 24 + (12 if (k // 2) % 2 == 1 else 0)
            b = saw(note_hz(m), 0.24, harm=30, bright=3.0) * env(0.24, 0.004, 0.04)
            add(b, t0, 0.15)
    # plukjes-arpeggio
    if 3.0 <= t0 < 22.5 or 26.5 <= t0 < 29.5:
        arp = [ch[0] + 12, ch[1] + 12, ch[2] + 12, ch[1] + 24][k % 4]
        p = square(note_hz(arp), 0.3, harm=12, bright=12) * env(0.3, 0.002, 0.08)
        pan = -0.45 if k % 2 else 0.45
        add(p, t0, 0.085, pan=pan, send=0.35)
        add(p, t0 + 0.375, 0.035, pan=-pan, send=0.3)  # pingpong-echo

# Eclips: hartslag-kicks en duister drone-akkoord
for j in range(8):
    add(kick(), 22.5 + j * 0.5, 0.55 if j % 2 == 0 else 0.35)
d = 4.0
t = tt(d)
drone = sum(saw(note_hz(m + KEY), d, harm=10) for m in (45, 52, 57)) * np.minimum(1, t / 0.6) * np.clip((d - t) / 0.4, 0, 1)
add(fft_filter(drone, hi=900), 22.5, 0.06, send=0.6)

# Hoofdmelodie (refrein) in de vang-scène en het eindbeeld
HOOK = [  # (tel in de 4-maats frase, midi, lengte in tellen)
    (0, 76, 1), (1, 79, 1), (2, 81, 0.5), (2.5, 79, 0.5), (3, 76, 1),
    (4, 74, 1), (5, 79, 1), (6, 83, 0.5), (6.5, 81, 0.5), (7, 79, 1),
    (8, 72, 1), (9, 76, 1), (10, 81, 0.5), (10.5, 83, 0.5), (11, 84, 1),
    (12, 81, 0.5), (12.5, 79, 0.5), (13, 77, 1), (14, 76, 1), (15, 74, 1),
]


def lead(m, d):
    t = tt(d)
    f = note_hz(m) * (1 + 0.006 * np.sin(2 * np.pi * 5.5 * t) * np.minimum(1, t / 0.15))
    ph = 2 * np.pi * np.cumsum(f) / SR
    s = np.sin(ph) + 0.45 * np.sin(2 * ph) + 0.22 * np.sin(3 * ph) + 0.1 * np.sin(4 * ph)
    return s * env(d, 0.01, 0.06)


for start, end in ((8.5, 12.5), (26.5, 29.0)):
    for beat, m, ln in HOOK:
        t0 = start + beat * BEAT
        if t0 >= end:
            continue
        d = ln * BEAT * 0.95
        s = lead(m + KEY, d)
        add(s, t0, 0.13, pan=0.0, send=0.45)
        add(s, t0 + 0.375, 0.04, pan=0.6, send=0.3)
        add(s, t0 + 0.75, 0.025, pan=-0.6, send=0.3)

# ---------- effecten op de scènes ----------
add(whoosh(1.0, rise=True), 2.0, 0.25, send=0.3)              # aanloop naar de drop
add(crash(), 3.0, 0.12, send=0.4)
add(whoosh(0.9, rise=False), 4.85, 0.35, send=0.2)            # lancering
add(boom(1.4, 50), 5.0, 0.45)
add(whoosh(1.0, rise=True), 6.5, 0.22, send=0.3)
add(crash(), 7.5, 0.11, send=0.4)
for i, (tc, m) in enumerate(((8.5, 84), (9.5, 86), (10.5, 88), (11.5, 91))):  # vangsten
    add(ping(m + KEY), tc, 0.22, pan=-0.2, send=0.5)
    add(ping(m + KEY + 7), tc + 0.06, 0.16, pan=0.2, send=0.5)
add(shimmer(1.8, 86), 11.5, 0.05, send=0.8)                    # legendarisch
add(whoosh(1.0, rise=True), 11.5, 0.2, send=0.3)
for i in range(8):                                             # elke lucht een klap
    tc = 12.5 + i * 0.75
    add(boom(0.9, 46), tc, 0.35)
    add(crash(0.9), tc, 0.07, send=0.3)
th = fft_filter(noise(2.0), hi=400) * np.exp(-tt(2.0) / 0.5)
add(th, 13.25, 0.9)                                            # donder
add(whoosh(0.75, rise=False), 14.0, 0.25)                      # sneeuwwind
add(fft_filter(noise(1.0), hi=200) * np.exp(-tt(1.0) / 0.4), 14.75, 0.9)  # vulkaan
add(bell(91 + KEY - 2, 1.2), 15.5, 0.05, send=0.8)             # gouden uur
add(shimmer(1.0, 88), 16.25, 0.04, send=0.8)                   # aurora
for j in range(5):
    add(ping(96 + (j % 3) * 3, 0.3), 17.0 + j * 0.12, 0.05, pan=(j - 2) * 0.3, send=0.7)
add(boom(2.0, 34), 17.75, 0.5)
add(crash(), 18.5, 0.12, send=0.4)
for i in range(8):                                             # Driftlings landen in het nest
    add(ping(79 + [0, 2, 4, 7, 9, 12, 14, 16][i] + KEY, 0.3), 18.85 + i * 0.22, 0.12, pan=(i % 4 - 1.5) * 0.3, send=0.4)
tick_t = 18.8
while tick_t < 22.3:                                           # teller tikt steeds sneller
    add(ping(100, 0.08), tick_t, 0.03, pan=0.2)
    tick_t += max(0.05, 0.22 - (tick_t - 18.8) * 0.06)
add(boom(3.0, 30), 22.5, 0.7)
add(shimmer(2.0, 84), 24.5, 0.08, send=0.9)                    # mythische onthulling
add(boom(1.5, 44), 24.5, 0.4)
add(whoosh(1.0, rise=True), 25.5, 0.3, send=0.3)
add(boom(2.0, 40), 26.5, 0.6)                                  # eindbeeld
add(crash(2.6), 26.5, 0.15, send=0.5)
for m in (62, 66, 69, 74):
    add(lead(m + KEY - 2 + 12, 1.4) * np.exp(-tt(1.4) / 0.6), 29.0, 0.05, send=0.8)
add(bell(86 + KEY - 2, 2.0), 29.0, 0.06, send=0.9)

# ---------- galm en master ----------
ir_d = 2.4
t = tt(ir_d)
ir = np.stack([rng.standard_normal(len(t)), rng.standard_normal(len(t))], axis=1) * np.exp(-t / 0.55)[:, None]
ir = fft_filter(ir, hi=6000)
ir[: int(0.012 * SR)] = 0  # pre-delay
size = 1 << int(np.ceil(np.log2(N + len(ir))))
rev = np.fft.irfft(np.fft.rfft(wet, size, axis=0) * np.fft.rfft(ir, size, axis=0), size, axis=0)[:N]
rev /= np.max(np.abs(rev)) + 1e-9
mix = dry + rev * np.max(np.abs(dry)) * 0.22

mix = fft_filter(mix, lo=28)
t = np.arange(N) / SR
mix *= np.clip(t / 0.05, 0, 1)[:, None] * np.clip((DUR - t) / 0.8, 0, 1)[:, None]
mix = np.tanh(mix / np.max(np.abs(mix)) * 1.6)
mix /= np.max(np.abs(mix)) / 0.89
pcm = (mix * 32767).astype('<i2')
with wave.open('music.wav', 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print('music.wav', N / SR, 's')
