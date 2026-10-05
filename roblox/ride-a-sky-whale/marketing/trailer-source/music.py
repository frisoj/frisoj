# Synthetiseert 30 s muziek + geluidseffecten voor de trailer (geen samples nodig).
import numpy as np, wave
SR = 44100; DUR = 30.0; N = int(SR * DUR)
out = np.zeros(N)
rng = np.random.default_rng(7)
def add(sig, t0, gain=1.0):
    i0 = int(t0 * SR); i1 = min(N, i0 + len(sig))
    if i0 < N: out[i0:i1] += sig[: i1 - i0] * gain
def tone(f, dur, decay=None, harm=(1.0,), attack=0.005):
    t = np.arange(int(dur * SR)) / SR
    s = sum(a * np.sin(2 * np.pi * f * (k + 1) * t) for k, a in enumerate(harm))
    env = np.minimum(1, t / attack) if attack > 0 else np.ones_like(t)
    if decay: env = env * np.exp(-t / decay)
    return s * env
def note(n): return 440.0 * 2 ** ((n - 69) / 12)   # MIDI -> Hz
BPM = 100; BEAT = 60 / BPM; BAR = 4 * BEAT
CHORDS = [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]]   # C G Am F
def groove_on(t): return (3.0 <= t < 21.0) or (25.0 <= t < 29.6)
# pad
for b in range(int(DUR / BAR) + 1):
    t0 = b * BAR
    if t0 >= 21.0 and t0 < 25.0: continue
    ch = CHORDS[b % 4]
    for n in ch:
        d = BAR + 0.3
        t = np.arange(int(d * SR)) / SR
        s = (np.sin(2*np.pi*note(n)*t) + 0.5*np.sin(2*np.pi*note(n)*1.003*t) + 0.25*np.sin(2*np.pi*note(n+12)*t))
        env = np.minimum(1, t / 0.4) * np.minimum(1, (d - t) / 0.4)
        add(s * env, t0, 0.045)
# bas, arpeggio, kick, hihat
step = BEAT / 2
for k in range(int(DUR / step)):
    t0 = k * step
    if not groove_on(t0): continue
    bar = int(t0 // BAR); ch = CHORDS[bar % 4]
    if k % 4 == 0:
        add(tone(note(ch[0] - 24), 0.5, decay=0.25, harm=(1.0, 0.4, 0.15)), t0, 0.32)
    if k % 2 == 0:  # kick
        d = 0.35; t = np.arange(int(d*SR))/SR
        f = 45 + 80*np.exp(-t/0.04)
        add(np.sin(2*np.pi*np.cumsum(f)/SR) * np.exp(-t/0.12), t0, 0.5)
    arp = [ch[0]+12, ch[1]+12, ch[2]+12, ch[1]+12][k % 4]
    bright = 0.11 if t0 < 15 else 0.14
    add(tone(note(arp), 0.4, decay=0.16, harm=(1.0, 0.3, 0.12)), t0, bright)
    if (7.0 <= t0 < 21.0) or t0 >= 25.0:
        hats = 2 if 15.0 <= t0 < 21.0 else 1
        for h in range(hats):
            d = 0.05; nz = rng.standard_normal(int(d*SR)); nz = np.diff(nz, prepend=0)
            add(nz * np.exp(-np.arange(len(nz))/SR/0.012), t0 + BEAT/4 + h*BEAT/4 - (BEAT/4 if hats == 2 else 0), 0.05)
# walvisroep
d = 2.2; t = np.arange(int(d*SR))/SR
f = 210 + 120*np.sin(np.pi*t/d) - 30*(t/d) + 6*np.sin(2*np.pi*5*t)
ph = 2*np.pi*np.cumsum(f)/SR
s = np.sin(ph) + 0.35*np.sin(2*ph) + 0.15*np.sin(3*ph)
add(s * np.sin(np.pi*t/d)**1.5, 0.6, 0.22)
add(s * np.sin(np.pi*t/d)**1.5, 25.6, 0.16)
# whoosh bij lancering
d = 1.3; nz = rng.standard_normal(int(d*SR)); y = np.zeros_like(nz); acc = 0.0
for i in range(len(nz)):
    a = 0.02 + 0.25*(i/len(nz)); acc += a*(nz[i]-acc); y[i] = acc
t = np.arange(len(y))/SR
add(y * np.sin(np.pi*t/d) * 1.6, 8.35, 0.5)
# vang-pings
for i, tc in enumerate([11.6, 12.4, 13.2, 14.0]):
    base = [76, 79, 83, 88][i]
    add(tone(note(base), 0.35, decay=0.12, harm=(1.0, 0.2)), tc, 0.22)
    add(tone(note(base+7), 0.35, decay=0.12, harm=(1.0, 0.2)), tc+0.06, 0.18)
# donder
for tt in (15.0, 15.7):
    d = 1.8; nz = rng.standard_normal(int(d*SR)); y = np.zeros_like(nz); acc = 0.0
    for i in range(len(nz)):
        acc += 0.015*(nz[i]-acc); y[i] = acc
    t = np.arange(len(y))/SR
    add(y * np.exp(-t/0.6) * 9, tt, 0.6)
# eclips: diepe boem + drone
d = 3.0; t = np.arange(int(d*SR))/SR
add(np.sin(2*np.pi*(40 + 30*np.exp(-t/0.2))*t) * np.exp(-t/1.0), 21.0, 0.7)
d = 4.0; t = np.arange(int(d*SR))/SR
drone = (np.sin(2*np.pi*note(45)*t) + 0.6*np.sin(2*np.pi*note(52)*t) + 0.3*np.sin(2*np.pi*note(57)*t*1.002)) * (0.6 + 0.4*np.sin(2*np.pi*0.5*t))
add(drone * np.minimum(1, t/0.8) * np.minimum(1, (d-t)/0.5), 21.0, 0.12)
# void-glinstering
d = 1.6; t = np.arange(int(d*SR))/SR
sh = sum(np.sin(2*np.pi*note(n)*t) for n in (84, 88, 91, 95)) * (0.5+0.5*np.sin(2*np.pi*12*t))
add(sh * np.exp(-t/0.6), 22.8, 0.05)
# titelklap
d = 1.5; nz = rng.standard_normal(int(d*SR)); t = np.arange(len(nz))/SR
add(np.diff(nz, prepend=0) * np.exp(-t/0.5), 25.0, 0.18)
for n in (60, 64, 67, 72):
    add(tone(note(n), 1.2, decay=0.5, harm=(1.0, 0.4, 0.2)), 25.0, 0.08)
# eind: uitfaden, normaliseren
t = np.arange(N)/SR
out *= np.clip((DUR - t) / 1.0, 0, 1)
out = np.tanh(out * 1.2)
out /= np.max(np.abs(out)) / 0.89
pcm = (out * 32767).astype(np.int16)
stereo = np.repeat(pcm[:, None], 2, axis=1)
with wave.open('music.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(stereo.tobytes())
print('music.wav', len(pcm)/SR, 's')
