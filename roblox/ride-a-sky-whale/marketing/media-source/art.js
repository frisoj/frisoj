// Tekenset voor de cover, het icoon en de trailer van Ride a Sky Whale.
// Elke functie geeft een stuk SVG terug; de pagina bouwt daar per beeld de scène mee.

const W = 1920, H = 1080;
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const seg = (t, a, b) => clamp((t - a) / (b - a));
const ease = {
  out: t => 1 - Math.pow(1 - t, 3),
  in: t => t * t * t,
  inOut: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: t => { const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
};
function rand(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

function hex2rgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgb2hex(r, g, b) { return '#' + [r, g, b].map(v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join(''); }
function mix(a, b, t) { const x = hex2rgb(a), y = hex2rgb(b); return rgb2hex(lerp(x[0], y[0], t), lerp(x[1], y[1], t), lerp(x[2], y[2], t)); }
function shade(c, amt) { return amt >= 0 ? mix(c, '#ffffff', amt) : mix(c, '#000000', -amt); }

let UID = 0;
const uid = p => p + (UID++);
function resetUid() { UID = 0; }
const stops = list => list.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}"${a != null ? ` stop-opacity="${a}"` : ''}/>`).join('');
const radial = (id, list, cx = '35%', cy = '30%', r = '75%') => `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${stops(list)}</radialGradient>`;
const linear = (id, list, x1 = 0, y1 = 0, x2 = 0, y2 = 1, user = false) =>
  `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"${user ? ' gradientUnits="userSpaceOnUse"' : ''}>${stops(list)}</linearGradient>`;

// Vaste filters en vormen die elke pagina één keer in <defs> zet.
const STATIC_DEFS = `
  <radialGradient id="vignette" cx="50%" cy="50%" r="75%"><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#0a0820" stop-opacity=".45"/></radialGradient>
  <filter id="b3" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"/></filter>
  <filter id="b6" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>
  <filter id="b12" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="12"/></filter>
  <filter id="b24" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="24"/></filter>
  <filter id="b50" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="50"/></filter>
  <filter id="shadow" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="14" stdDeviation="14" flood-color="#0a1230" flood-opacity=".35"/></filter>
  <filter id="tshadow" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="10" stdDeviation="8" flood-color="#0a0f2a" flood-opacity=".45"/></filter>
  <path id="spark" d="M0,-1 C.12,-.12 .12,-.12 1,0 C.12,.12 .12,.12 0,1 C-.12,.12 -.12,.12 -1,0 C-.12,-.12 -.12,-.12 0,-1Z"/>
  ${linear('titleFill', [[0, '#FFFFFF'], [0.48, '#FFF4C8'], [0.5, '#FFD957'], [1, '#FFA92E']])}
  ${linear('titleFill2', [[0, '#E2FCFF'], [0.48, '#8DEBFF'], [0.5, '#45C2FF'], [1, '#2A86EE']])}
  ${linear('grade', [[0, '#FF9A5A'], [0.5, '#FF7FA0'], [1, '#6A5CFF']], 0, 0, 1, 0)}
  ${radial('bokehG', [[0, '#FFFFFF', 0.55], [0.7, '#FFFFFF', 0.25], [1, '#FFFFFF', 0]], '50%', '50%', '50%')}
  ${radial('pearlG', [[0, '#FFFFFF'], [0.45, '#F7E9FB'], [1, '#C7AEE6']], '35%', '30%', '80%')}
  ${linear('whaleBody', [[0, '#5C9BDB'], [0.45, '#3770B0'], [1, '#1F4880']])}
  ${linear('whaleBelly', [[0, '#F2F8FF'], [1, '#A9C4E2']])}
  ${linear('whaleFin', [[0, '#4A86C6'], [1, '#22508A']])}
  ${linear('woodG', [[0, '#D9A05A'], [1, '#93602E']])}
  ${linear('sprayG', [[0, '#FFFFFF', 0.95], [1, '#BFE8FF', 0.55]])}
`;

/* ---------------- Lucht ---------------- */

const SKIES = {
  CloudSea: { name: 'CLOUD SEA', top: '#2F7FD8', mid: '#76B6F0', bot: '#DDF1FF', cloud: '#FFFFFF', cshade: '#B5D3EF', sun: '#FFF7CF', ui: '#78B4E6' },
  Thunderfront: { name: 'THUNDERFRONT', mut: 'CHARGED', mult: 2, top: '#1E2235', mid: '#3B4360', bot: '#6E7792', cloud: '#7D849A', cshade: '#3E4459', lightning: true, rain: true, ui: '#FFE15A' },
  Blizzard: { name: 'BLIZZARD', mut: 'FROZEN', mult: 3, top: '#8FA8C9', mid: '#C4D5E9', bot: '#EFF5FC', cloud: '#F5F9FF', cshade: '#A8BCD6', snow: true, ui: '#BEE6FF' },
  Ashfall: { name: 'ASHFALL', mut: 'MOLTEN', mult: 4, top: '#2E1A18', mid: '#6E3526', bot: '#C9683A', cloud: '#94625A', cshade: '#4E302B', ash: true, volcano: true, ui: '#FF8246' },
  GoldenHour: { name: 'GOLDEN HOUR', mut: 'GILDED', mult: 5, top: '#3F3FA6', mid: '#E9857F', bot: '#FFD38C', cloud: '#FFE4CB', cshade: '#DF9A8A', sun: '#FFE7A0', ui: '#FFBE5A' },
  Aurora: { name: 'AURORA', mut: 'PRISMATIC', mult: 6, top: '#041026', mid: '#0B2C45', bot: '#11505A', cloud: '#3A7880', cshade: '#173F4E', aurora: true, stars: true, ui: '#6EFFC8' },
  Starfall: { name: 'STARFALL', mut: 'STARDUST', mult: 8, top: '#090B2A', mid: '#1F2664', bot: '#474C9A', cloud: '#565DA2', cshade: '#2A2F6C', stars: true, shooting: true, ui: '#AAB4FF' },
  Eclipse: { name: 'ECLIPSE', mut: 'VOID', mult: 25, top: '#05010C', mid: '#1B0930', bot: '#3A1455', cloud: '#3A2352', cshade: '#170C26', eclipse: true, stars: true, ui: '#BE6EFF' },
  Cover: { top: '#25237A', mid: '#7A4FC8', bot: '#FFB27A', cloud: '#FFE3D6', cshade: '#D98AA6', hi: '#FFF3E2', hiOp: 0.5, sun: '#FFF0B0', stars: true, ui: '#FFBE5A' },
};
const SKY_ORDER = ['CloudSea', 'Thunderfront', 'Blizzard', 'Ashfall', 'GoldenHour', 'Aurora', 'Starfall', 'Eclipse'];

function sky(key, t, o = {}) {
  const k = SKIES[key];
  const gid = uid('sky');
  let s = `<defs>${linear(gid, [[0, k.top], [0.55, k.mid], [1, k.bot]])}</defs><rect width="${W}" height="${H}" fill="url(#${gid})"/>`;
  if (k.stars) {
    const r = rand(11);
    for (let i = 0; i < 140; i++) {
      const x = r() * W, y = r() * H * 0.7, rr = 0.8 + r() * 2.2;
      const tw = 0.45 + 0.55 * Math.abs(Math.sin(t * 2 + i));
      s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rr.toFixed(2)}" fill="#FFFFFF" opacity="${(tw * (1 - y / (H * 0.8))).toFixed(2)}"/>`;
    }
  }
  if (k.sun) {
    const sx = o.sunX ?? 1500, sy = o.sunY ?? 330, sr = o.sunR ?? 120;
    s += `<g transform="translate(${sx},${sy})">`;
    s += `<circle r="${sr * 4}" fill="${k.sun}" opacity=".22" filter="url(#b50)"/>`;
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * 360 + t * 6;
      s += `<path d="M0 0 L${sr * 6} -${sr * 0.35} L${sr * 6} ${sr * 0.35} Z" fill="${k.sun}" opacity=".10" transform="rotate(${a.toFixed(2)})"/>`;
    }
    s += `<circle r="${sr * 1.5}" fill="${k.sun}" opacity=".45" filter="url(#b24)"/><circle r="${sr}" fill="${k.sun}"/><circle r="${sr * 0.82}" fill="#FFFFFF" opacity=".55"/></g>`;
  }
  if (k.aurora) {
    for (let i = 0; i < 3; i++) {
      const y0 = 170 + i * 70, amp = 60 + i * 15, ph = t * 0.8 + i * 1.7;
      let d = `M -100 ${y0}`;
      for (let x = 0; x <= W + 200; x += 80) d += ` L ${x} ${(y0 + Math.sin(x / 260 + ph) * amp).toFixed(1)}`;
      const col = ['#46FFB4', '#7CFFE0', '#A57BFF'][i];
      s += `<path d="${d}" fill="none" stroke="${col}" stroke-width="${70 - i * 12}" opacity=".35" filter="url(#b24)"/>`;
      s += `<path d="${d}" fill="none" stroke="${col}" stroke-width="10" opacity=".45" filter="url(#b6)"/>`;
    }
  }
  if (k.shooting) {
    for (let i = 0; i < 4; i++) {
      const p = ((t * 0.7 + i * 0.27) % 1);
      const x = 300 + i * 420 + p * 600, y = 60 + i * 50 + p * 300;
      s += `<line x1="${x}" y1="${y}" x2="${x - 160}" y2="${y - 80}" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round" opacity="${(Math.sin(p * Math.PI) * 0.9).toFixed(2)}"/>`;
      s += `<circle cx="${x}" cy="${y}" r="6" fill="#FFFFFF" opacity="${(Math.sin(p * Math.PI)).toFixed(2)}" filter="url(#b3)"/>`;
    }
  }
  if (k.eclipse) {
    const ex = o.sunX ?? 1420, ey = o.sunY ?? 300, er = o.sunR ?? 130;
    s += `<g transform="translate(${ex},${ey})">`;
    s += `<circle r="${er * 3}" fill="#9B4DFF" opacity=".28" filter="url(#b50)"/>`;
    s += `<circle r="${er * 1.25}" fill="none" stroke="#E2B6FF" stroke-width="${er * 0.25}" opacity=".9" filter="url(#b12)"/>`;
    s += `<circle r="${er * 1.03}" fill="none" stroke="#FFFFFF" stroke-width="6" opacity=".9" filter="url(#b3)"/>`;
    s += `<circle r="${er}" fill="#06010C"/></g>`;
  }
  if (k.volcano) {
    s += `<g opacity=".85"><path d="M1250 760 L1430 470 L1500 470 L1700 760 Z" fill="#3A221E"/><path d="M1430 470 L1500 470 L1480 520 L1450 520 Z" fill="#FF7A30"/>`;
    s += `<circle cx="1465" cy="430" r="90" fill="#FF6A2A" opacity=".5" filter="url(#b24)"/></g>`;
    const r = rand(5);
    for (let i = 0; i < 8; i++) {
      const p = (t * 0.35 + r()) % 1;
      s += `<circle cx="${1465 + (r() - 0.5) * 140 * p}" cy="${450 - p * 340}" r="${40 + p * 90}" fill="#5A3A34" opacity="${(0.55 * (1 - p)).toFixed(2)}" filter="url(#b12)"/>`;
    }
  }
  return s;
}

function weather(key, t) {
  const k = SKIES[key];
  let s = '';
  if (k.rain) {
    const r = rand(3);
    for (let i = 0; i < 160; i++) {
      const x = (r() * (W + 400) + t * 300) % (W + 400) - 200, y = (r() * H + t * 2200) % (H + 100) - 50;
      s += `<line x1="${x.toFixed(0)}" y1="${y.toFixed(0)}" x2="${(x - 14).toFixed(0)}" y2="${(y + 46).toFixed(0)}" stroke="#C9D6F0" stroke-width="2.5" opacity=".45"/>`;
    }
  }
  if (k.snow || k.ash) {
    const r = rand(k.snow ? 4 : 6);
    for (let i = 0; i < 150; i++) {
      const sp = 60 + r() * 120;
      const x = (r() * W + Math.sin(t * 1.5 + i) * 30 + t * (k.snow ? -40 : 30) + W * 4) % W, y = (r() * H + t * sp) % H;
      const rr = 2 + r() * 5;
      s += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${rr.toFixed(1)}" fill="${k.snow ? '#FFFFFF' : (i % 5 === 0 ? '#FF9A50' : '#3A2A28')}" opacity="${k.snow ? 0.85 : 0.6}"/>`;
    }
  }
  if (k.lightning) {
    const flash = Math.max(0, Math.sin(t * 9)) ** 30 + (Math.floor(t * 3) % 3 === 0 ? Math.max(0, 1 - ((t * 3) % 1) * 4) : 0);
    if (flash > 0.05) {
      s += `<rect width="${W}" height="${H}" fill="#E8F0FF" opacity="${(flash * 0.35).toFixed(2)}"/>`;
      s += `<path d="M1180 0 L1120 160 L1170 170 L1080 360 L1140 370 L1040 560" fill="none" stroke="#FFF7B0" stroke-width="10" stroke-linejoin="round" opacity="${flash.toFixed(2)}" filter="url(#b3)"/>`;
      s += `<path d="M1180 0 L1120 160 L1170 170 L1080 360 L1140 370 L1040 560" fill="none" stroke="#FFFFFF" stroke-width="4" stroke-linejoin="round" opacity="${flash.toFixed(2)}"/>`;
    }
  }
  if (k.eclipse) {
    const r = rand(9);
    for (let i = 0; i < 40; i++) {
      const p = (t * 0.25 + r()) % 1;
      s += `<circle cx="${(r() * W).toFixed(0)}" cy="${(H - p * H).toFixed(0)}" r="${(3 + r() * 6).toFixed(1)}" fill="#C27BFF" opacity="${(Math.sin(p * Math.PI) * 0.8).toFixed(2)}" filter="url(#b3)"/>`;
    }
  }
  return s;
}

/* ---------------- Wolken en eilanden ---------------- */

function cloud(x, y, w, o = {}) {
  const r = rand(o.seed ?? Math.round(x * 7 + y * 13 + w));
  const fill = o.fill ?? '#FFFFFF', sh = o.shade ?? '#BCD5EE';
  const gid = uid('cl');
  const h = w * 0.42;
  const hid = uid('ch');
  const hi = o.hi ?? '#FFFFFF';
  let circles = '', lights = '', puffs = [];
  const n = 5 + Math.floor(w / 140);
  for (let i = 0; i < n; i++) {
    const px = -w / 2 + (i + 0.5) * (w / n) + (r() - 0.5) * 20;
    const mid = 1 - Math.abs((i + 0.5) / n - 0.5) * 2;
    const rr = (w / n) * (0.75 + mid * 0.9 + r() * 0.3);
    puffs.push([px, -rr * 0.55 + h * 0.15, rr]);
  }
  // een tweede rij kleinere bolletjes geeft de wolk meer volume
  for (let i = 0; i < n - 1; i++) {
    const [ax, ay, ar] = puffs[i], [bx, by, br] = puffs[i + 1];
    puffs.push([(ax + bx) / 2 + (r() - 0.5) * 30, Math.min(ay, by) - (ar + br) * 0.18, (ar + br) * 0.36]);
  }
  for (const [px, py, rr] of puffs) {
    circles += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${rr.toFixed(1)}"/>`;
    lights += `<circle cx="${(px - rr * 0.12).toFixed(1)}" cy="${(py - rr * 0.14).toFixed(1)}" r="${(rr * 0.86).toFixed(1)}"/>`;
  }
  circles += `<rect x="${-w / 2}" y="${-h * 0.15}" width="${w}" height="${h * 0.55}" rx="${h * 0.27}"/>`;
  return `<g transform="translate(${x},${y})" opacity="${o.op ?? 1}"${o.blur ? ` filter="url(#${o.blur})"` : ''}>
    <defs>${linear(gid, [[0, fill], [0.5, fill], [1, sh]], 0, -h * 1.6, 0, h * 0.4, true)}${radial(hid, [[0, hi, o.hiOp ?? 0.7], [0.55, hi, (o.hiOp ?? 0.7) * 0.3], [1, hi, 0]], '38%', '30%', '62%')}</defs>
    <g fill="url(#${gid})">${circles}</g><g fill="url(#${hid})">${lights}</g></g>`;
}

function cloudBank(y, key, t, o = {}) {
  const k = SKIES[key];
  let s = '';
  const r = rand(o.seed ?? 21);
  const count = o.count ?? 9;
  const drift = (o.drift ?? 20) * t;
  for (let i = 0; i < count; i++) {
    const w = (o.w ?? 420) * (0.8 + r() * 0.6);
    const x = ((i / count) * (W + 600) - 300 + drift + r() * 80) % (W + 600) - 0;
    s += cloud(x, y + r() * (o.jitter ?? 50), w, { fill: o.fill ?? k.cloud, shade: o.shade ?? k.cshade, hi: o.hi ?? k.hi, hiOp: o.hiOp ?? k.hiOp, op: o.op, blur: o.blur, seed: i * 31 + (o.seed ?? 0) });
  }
  return s;
}

function island(x, y, sc, o = {}) {
  const grass = o.grass ?? '#7CCB6A', rock = o.rock ?? '#8E7A6B';
  const gid = uid('rk');
  let s = `<g transform="translate(${x},${y}) scale(${sc})" opacity="${o.op ?? 1}">`;
  s += `<defs>${linear(gid, [[0, shade(rock, 0.1)], [1, shade(rock, -0.45)]])}</defs>`;
  s += `<path d="M-160 0 C-150 60 -90 90 -60 150 C-40 200 -10 260 0 300 C15 250 40 190 70 140 C100 90 150 60 160 0 Z" fill="url(#${gid})"/>`;
  s += `<path d="M-120 40 C-60 60 60 60 125 40 M-80 100 C-30 115 40 115 90 100" stroke="${shade(rock, -0.5)}" stroke-width="5" fill="none" opacity=".5"/>`;
  s += `<ellipse cx="0" cy="0" rx="168" ry="34" fill="${shade(grass, -0.25)}"/><ellipse cx="0" cy="-8" rx="160" ry="30" fill="${grass}"/>`;
  s += `<ellipse cx="-30" cy="-16" rx="90" ry="12" fill="${shade(grass, 0.25)}" opacity=".6"/>`;
  if (o.trees !== false) {
    for (const [tx, ts] of [[-90, 1], [-50, 0.75], [80, 0.9]]) {
      s += `<rect x="${tx - 5}" y="${-60 * ts}" width="10" height="${55 * ts}" fill="#6E4A2E"/>`;
      s += `<circle cx="${tx}" cy="${-70 * ts}" r="${30 * ts}" fill="${shade(grass, -0.15)}"/><circle cx="${tx - 8 * ts}" cy="${-78 * ts}" r="${16 * ts}" fill="${shade(grass, 0.2)}"/>`;
    }
  }
  if (o.chest) s += `<g transform="translate(20,-26)"><rect x="-22" y="-14" width="44" height="28" rx="5" fill="#C8923E" stroke="#6E4A20" stroke-width="4"/><rect x="-22" y="-14" width="44" height="10" rx="4" fill="#E0AD55" stroke="#6E4A20" stroke-width="4"/><rect x="-5" y="-6" width="10" height="10" fill="#FFD84A" stroke="#6E4A20" stroke-width="3"/></g>`;
  if (o.pad) s += `<ellipse cx="-20" cy="-12" rx="38" ry="10" fill="#7AE8FF"/><ellipse cx="-20" cy="-12" rx="60" ry="22" fill="#7AE8FF" opacity=".4" filter="url(#b6)"/>`;
  return s + '</g>';
}

/* ---------------- Glitters, parels, teksten ---------------- */

const sparkle = (x, y, r, op = 1, col = '#FFFFFF', rot = 0) =>
  `<use href="#spark" transform="translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${rot.toFixed(1)}) scale(${r.toFixed(2)})" fill="${col}" opacity="${op.toFixed(2)}"/>`;

const pearl = (x, y, r, op = 1) =>
  `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)})" opacity="${op.toFixed(2)}"><circle r="${r}" fill="url(#pearlG)" stroke="#8E6FB8" stroke-width="${r * 0.12}"/><ellipse cx="${-r * 0.3}" cy="${-r * 0.35}" rx="${r * 0.28}" ry="${r * 0.18}" fill="#FFFFFF" opacity=".95"/></g>`;

function label(text, x, y, size, o = {}) {
  const fill = o.fill ?? '#FFFFFF', stroke = o.stroke ?? '#15204A';
  const anchor = o.anchor ?? 'middle';
  const sw = o.sw ?? size * 0.2;
  let s = `<g transform="translate(${x},${y}) rotate(${o.rot ?? 0}) scale(${o.scale ?? 1})" opacity="${o.op ?? 1}">`;
  const base = `font-family="Fredoka" font-weight="700" font-size="${size}" text-anchor="${anchor}" letter-spacing="${o.ls ?? 0}"`;
  const depth = o.depth ?? Math.round(size * 0.08);
  if (o.outer) for (let i = depth; i >= 0; i -= 4) s += `<text ${base} y="${i}" fill="${o.outer}" stroke="${o.outer}" stroke-width="${sw + o.ow * 2}" stroke-linejoin="round">${text}</text>`;
  for (let i = depth; i > 0; i -= 2) s += `<text ${base} y="${i}" fill="${stroke}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round">${text}</text>`;
  s += `<text ${base} fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" paint-order="stroke">${text}</text>`;
  return s + '</g>';
}

// Het logo: "RIDE A" klein, "SKY WHALE" groot, met diepte en glans.
function title(x, y, sc, o = {}) {
  let s = `<g transform="translate(${x},${y}) rotate(${o.rot ?? -5}) scale(${sc})" filter="url(#tshadow)">`;
  s += `<ellipse cx="0" cy="-40" rx="640" ry="220" fill="#FFFFFF" opacity="${o.halo ?? 0.18}" filter="url(#b50)"/>`;
  s += label('RIDE A', 0, -150, 120, { fill: 'url(#titleFill2)', stroke: '#10204F', sw: 26, depth: 12, ls: 4, outer: '#FFFFFF', ow: 9 });
  s += label('SKY WHALE', 0, 40, 230, { fill: 'url(#titleFill)', stroke: '#10204F', sw: 40, depth: 22, ls: 2, outer: '#FFFFFF', ow: 12 });
  s += sparkle(-520, -80, 36, 0.95, '#FFFFFF', 10) + sparkle(560, -10, 26, 0.9) + sparkle(470, -190, 18, 0.85, '#FFF4B0');
  return s + '</g>';
}

function pill(text, x, y, size, o = {}) {
  const w = text.length * size * 0.62 + size * 1.6, h = size * 1.7;
  return `<g transform="translate(${x},${y}) rotate(${o.rot ?? 0}) scale(${o.scale ?? 1})" opacity="${o.op ?? 1}" filter="url(#shadow)">
    <rect x="${-w / 2}" y="${-h / 2 + 8}" width="${w}" height="${h}" rx="${h / 2}" fill="${shade(o.bg ?? '#FFC93C', -0.45)}"/>
    <rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="${h / 2}" fill="${o.bg ?? '#FFC93C'}" stroke="#15204A" stroke-width="${size * 0.14}"/>
    <rect x="${-w / 2 + h * 0.3}" y="${-h / 2 + h * 0.12}" width="${w - h * 0.6}" height="${h * 0.28}" rx="${h * 0.14}" fill="#FFFFFF" opacity=".35"/>
    <text font-family="Fredoka" font-weight="700" font-size="${size}" text-anchor="middle" y="${size * 0.35}" fill="${o.color ?? '#15204A'}">${text}</text></g>`;
}

/* ---------------- Driftlings ---------------- */

const RARITY = { Common: '#C8CDD7', Uncommon: '#6ED28C', Rare: '#6EAAFF', Epic: '#BE82FF', Legendary: '#FFC846', Mythic: '#FF78C8' };
const SPECIES = {
  NimbusPup: { name: 'Nimbus Pup', rarity: 'Common', color: '#F0F5FF', accent: '#AAC8EB', f: ['ears'] },
  Breezle: { name: 'Breezle', rarity: 'Common', color: '#AAE1FF', accent: '#FFFFFF', f: ['wings'] },
  Jellyfloat: { name: 'Jellyfloat', rarity: 'Uncommon', color: '#FFA5DC', accent: '#FF78C8', f: ['tentacles'] },
  PuffinPilot: { name: 'Puffin Pilot', rarity: 'Uncommon', color: '#2D2D37', accent: '#FF8C32', f: ['wings', 'beak'], face: '#F4F4F6' },
  KiteRay: { name: 'Kite Ray', rarity: 'Rare', color: '#5073C8', accent: '#FF5A5A', f: ['bigwings'] },
  Thunderkoi: { name: 'Thunderkoi', rarity: 'Epic', color: '#FFD73C', accent: '#FFFFFF', f: ['fins'] },
  Owlbatross: { name: 'Owlbatross', rarity: 'Epic', color: '#B9966E', accent: '#FAF0DC', f: ['bigwings', 'ears', 'beak'], face: '#FAF0DC' },
  AuroraMoth: { name: 'Aurora Moth', rarity: 'Legendary', color: '#78FFC8', accent: '#AA78FF', f: ['bigwings', 'ears'] },
  CometNarwhal: { name: 'Comet Narwhal', rarity: 'Legendary', color: '#C8D2FF', accent: '#FFE27A', f: ['horn', 'fins'] },
  Whalelet: { name: 'Whalelet', rarity: 'Mythic', color: '#6496D7', accent: '#D7E6F5', f: ['fluke'] },
};
const MUT_COLORS = { CHARGED: '#FFE65A', FROZEN: '#B9E6FF', MOLTEN: '#FF6E28', GILDED: '#FFC83C', PRISMATIC: '#96FFE6', STARDUST: '#D2D7FF', VOID: '#B45AFF' };

function driftling(id, x, y, size, o = {}) {
  const sp = SPECIES[id];
  const t = o.t ?? 0, ph = o.phase ?? 0;
  const flap = Math.sin(t * 9 + ph);
  let body = sp.color, acc = sp.accent;
  if (o.mut) body = mix(body, MUT_COLORS[o.mut], o.mut === 'VOID' ? 0.8 : 0.5);
  const line = id === 'PuffinPilot' ? '#101018' : shade(body, -0.55);
  const gid = uid('dg'), wid = uid('dw');
  const glow = o.glowColor ?? (o.mut ? MUT_COLORS[o.mut] : RARITY[sp.rarity]);
  let s = `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${(o.rot ?? Math.sin(t * 2 + ph) * 6).toFixed(1)}) scale(${(size / 50).toFixed(3)})" opacity="${o.op ?? 1}">`;
  s += `<defs>${radial(gid, [[0, shade(body, 0.55)], [0.5, body], [1, shade(body, -0.3)]], '38%', '30%', '80%')}${linear(wid, [[0, shade(body, 0.2)], [1, acc]], 0, 0, 1, 1)}</defs>`;
  if (o.glow !== false) {
    if (sp.rarity === 'Mythic' && !o.mut) {
      ['#FF78C8', '#78E6FF', '#FFE678', '#B478FF'].forEach((c, i) => {
        const a = t * 2 + i * Math.PI / 2;
        s += `<circle cx="${(Math.cos(a) * 26).toFixed(1)}" cy="${(Math.sin(a) * 26).toFixed(1)}" r="70" fill="${c}" opacity=".5" filter="url(#b24)"/>`;
      });
    } else {
      s += `<circle r="${o.glowR ?? 82}" fill="${glow}" opacity="${o.glowOp ?? 0.55}" filter="url(#b24)"/>`;
    }
  }
  const f = sp.f;
  if (f.includes('bigwings')) {
    const a = flap * 16;
    const wing = `<path d="M28 -18 C70 -95 165 -95 160 -30 C156 10 105 38 34 20 Z" fill="url(#${wid})" stroke="${line}" stroke-width="5" stroke-linejoin="round"/><circle cx="110" cy="-40" r="14" fill="${acc}" stroke="${line}" stroke-width="4" opacity=".9"/>`;
    s += `<g transform="rotate(${-a})">${wing}</g><g transform="scale(-1,1) rotate(${-a})">${wing}</g>`;
  }
  if (f.includes('wings')) {
    const a = flap * 28;
    const wing = `<path d="M40 -8 C62 -48 102 -40 98 -10 C94 6 70 12 44 10 Z" fill="${id === 'PuffinPilot' ? '#22222C' : acc}" stroke="${line}" stroke-width="5" stroke-linejoin="round"/>`;
    s += `<g transform="rotate(${-a} 40 0)">${wing}</g><g transform="scale(-1,1) rotate(${-a} 40 0)">${wing}</g>`;
  }
  if (f.includes('fins')) {
    s += `<path d="M-14 -46 C-6 -84 30 -84 26 -42 Z" fill="${acc}" stroke="${line}" stroke-width="5" stroke-linejoin="round"/>`;
    const a = flap * 14;
    const fin = `<path d="M44 12 C72 0 90 26 66 40 C58 40 50 30 44 24 Z" fill="${acc}" stroke="${line}" stroke-width="5" stroke-linejoin="round"/>`;
    s += `<g transform="rotate(${a} 44 16)">${fin}</g><g transform="scale(-1,1) rotate(${a} 44 16)">${fin}</g>`;
  }
  if (f.includes('fluke')) {
    const a = flap * 12;
    s += `<g transform="rotate(${a} 38 0)"><path d="M38 0 C62 -6 74 -30 96 -42 C98 -18 88 -6 76 2 C88 10 98 24 96 46 C74 34 62 10 38 8 Z" fill="${shade(body, -0.1)}" stroke="${line}" stroke-width="5" stroke-linejoin="round"/></g>`;
  }
  if (f.includes('ears')) {
    for (const m of [1, -1]) s += `<g transform="scale(${m},1)"><path d="M14 -40 L34 -86 L46 -30 Z" fill="${body}" stroke="${line}" stroke-width="5" stroke-linejoin="round"/><path d="M22 -44 L33 -72 L40 -40 Z" fill="${acc}"/></g>`;
  }
  if (f.includes('tentacles')) {
    for (let i = 0; i < 4; i++) {
      const tx = -30 + i * 20, w = Math.sin(t * 5 + i) * 8;
      s += `<path d="M${tx} 30 q ${8 + w} 18 0 30 q ${-8 - w} 14 0 30" fill="none" stroke="${acc}" stroke-width="10" stroke-linecap="round"/>`;
    }
  }
  if (f.includes('horn')) {
    s += `<g transform="rotate(-18)"><path d="M-9 -44 L0 -118 L9 -44 Z" fill="${acc}" stroke="${shade(acc, -0.5)}" stroke-width="4" stroke-linejoin="round"/>`;
    for (let i = 0; i < 4; i++) s += `<line x1="${-7 + i * 1.6}" y1="${-56 - i * 15}" x2="${7 - i * 1.6}" y2="${-50 - i * 15}" stroke="${shade(acc, -0.4)}" stroke-width="3"/>`;
    s += `</g>`;
  }
  s += `<circle r="50" fill="url(#${gid})" stroke="${line}" stroke-width="5"/>`;
  if (sp.face) s += `<ellipse cx="0" cy="2" rx="36" ry="30" fill="${sp.face}"/>`;
  if (id === 'Whalelet') s += `<path d="M-46 14 C-30 40 30 40 46 14 C30 30 -30 30 -46 14 Z" fill="${acc}" opacity=".9"/><path d="M-6 -50 C-10 -64 -18 -70 -24 -72 M6 -50 C10 -64 18 -70 24 -72 M0 -50 L0 -76" stroke="#BFE8FF" stroke-width="6" stroke-linecap="round" fill="none"/>`;
  s += `<ellipse cx="-18" cy="-24" rx="16" ry="9" fill="#FFFFFF" opacity=".55" transform="rotate(-25 -18 -24)"/>`;
  const blink = o.blink ? 0.15 : 1;
  for (const ex of [-17, 17]) {
    s += `<ellipse cx="${ex}" cy="-2" rx="9" ry="${12 * blink}" fill="#161628"/>`;
    if (blink === 1) s += `<circle cx="${ex - 3}" cy="-7" r="4" fill="#FFFFFF"/><circle cx="${ex + 3}" cy="3" r="1.8" fill="#FFFFFF"/>`;
  }
  s += `<ellipse cx="-30" cy="12" rx="8" ry="5" fill="#FF7FA8" opacity=".55"/><ellipse cx="30" cy="12" rx="8" ry="5" fill="#FF7FA8" opacity=".55"/>`;
  if (f.includes('beak')) s += `<path d="M-10 9 L10 9 L0 24 Z" fill="${sp.accent}" stroke="${line}" stroke-width="3.5" stroke-linejoin="round"/>`;
  else s += `<path d="M-8 14 Q-4 20 0 15 Q4 20 8 14" fill="none" stroke="#161628" stroke-width="3.5" stroke-linecap="round"/>`;
  if (o.mut === 'FROZEN') s += `<circle r="56" fill="#DFF4FF" opacity=".35" stroke="#FFFFFF" stroke-width="3"/>`;
  if (o.mut === 'CHARGED') s += `<path d="M-60 -30 L-40 -10 L-55 -5 L-35 20" fill="none" stroke="#FFF27A" stroke-width="5" stroke-linejoin="round"/>`;
  if (o.mut === 'GILDED' || o.mut === 'STARDUST' || o.mut === 'PRISMATIC') {
    for (let i = 0; i < 3; i++) { const a = t * 3 + i * 2.1; s += sparkle(Math.cos(a) * 62, Math.sin(a) * 62, 10, 0.9, i === 1 ? MUT_COLORS[o.mut] : '#FFFFFF', 0); }
  }
  return s + '</g>';
}

/* ---------------- Roblox-poppetje ---------------- */

function avatar(x, y, sc, o = {}) {
  const shirt = o.shirt ?? '#FF5A52', pants = o.pants ?? '#2E3D74', skin = o.skin ?? '#F7CB46', ln = '#15204A';
  const aL = o.armL ?? 0, aR = o.armR ?? 0, lL = o.legL ?? 0, lR = o.legR ?? 0;
  const OX = 9, OY = -7; // blokken hebben een zij- en bovenkant, zoals in Roblox
  const g = {}; let defs = '';
  for (const [k, c] of [['shirt', shirt], ['pants', pants], ['skin', skin]]) {
    g[k] = uid('av');
    defs += linear(g[k], [[0, shade(c, 0.22)], [0.6, c], [1, shade(c, -0.12)]], 0, 0, 1, 1);
  }
  const box = (bx, by, w, h, c, gid, rx = 4) =>
    `<path d="M${bx + w - 1} ${by + 1} L${bx + w + OX} ${by + OY + 1} L${bx + w + OX} ${by + h + OY - 1} L${bx + w - 1} ${by + h - 1} Z" fill="${shade(c, -0.34)}" stroke="${ln}" stroke-width="3.5" stroke-linejoin="round"/>` +
    `<path d="M${bx + 1} ${by + 1} L${bx + OX + 1} ${by + OY} L${bx + w + OX} ${by + OY} L${bx + w - 1} ${by + 1} Z" fill="${shade(c, 0.3)}" stroke="${ln}" stroke-width="3.5" stroke-linejoin="round"/>` +
    `<rect x="${bx}" y="${by}" width="${w}" height="${h}" rx="${rx}" fill="url(#${gid})" stroke="${ln}" stroke-width="4"/>`;
  let s = `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${(o.rot ?? 0).toFixed(1)}) scale(${sc * (o.flip ? -1 : 1)},${sc})"><defs>${defs}</defs>`;
  if (o.glow) s += `<ellipse cx="0" cy="-40" rx="90" ry="110" fill="${o.glow}" opacity=".45" filter="url(#b24)"/>`;
  const leg = (dx, a) => `<g transform="rotate(${a} ${dx} 0)">${box(dx - 11, -2, 22, 48, pants, g.pants)}<rect x="${dx - 11}" y="34" width="22" height="12" rx="3" fill="${shade(pants, -0.45)}" stroke="${ln}" stroke-width="4"/></g>`;
  s += leg(-12, lL) + leg(12, lR);
  const arm = (dx, a, net) => {
    let q = `<g transform="rotate(${a} ${dx} -46)">`;
    if (net) {
      q += `<line x1="${dx}" y1="-8" x2="${dx}" y2="96" stroke="#5E3A18" stroke-width="10" stroke-linecap="round"/><line x1="${dx}" y1="-8" x2="${dx}" y2="96" stroke="#A8743E" stroke-width="5" stroke-linecap="round"/>`;
      q += `<g transform="translate(${dx},130)"><circle r="36" fill="#FFFFFF" fill-opacity=".22"/>`;
      q += `<path d="M-25 -25 L25 25 M-36 0 L36 0 M-25 25 L25 -25 M0 -36 L0 36 M-18 -31 L-18 31 M18 -31 L18 31 M-31 -18 L31 -18 M-31 18 L31 18" stroke="#FFFFFF" stroke-width="2" opacity=".6"/>`;
      q += `<circle r="36" fill="none" stroke="${ln}" stroke-width="9"/><circle r="36" fill="none" stroke="#E9EEF7" stroke-width="5"/></g>`;
    }
    q += box(dx - 10, -52, 20, 50, skin, g.skin, 5);
    q += box(dx - 10, -52, 20, 18, shirt, g.shirt, 5);
    return q + '</g>';
  };
  s += arm(-34, aL, false);
  s += box(-24, -54, 48, 54, shirt, g.shirt, 6);
  s += `<path d="M-6 -50 L0 -40 L6 -50" fill="none" stroke="#FFFFFF" stroke-width="4" stroke-linejoin="round"/>`;
  s += `<circle cx="0" cy="-30" r="3" fill="#FFFFFF" opacity=".8"/><circle cx="0" cy="-18" r="3" fill="#FFFFFF" opacity=".8"/>`;
  s += arm(34, aR, o.net !== false);
  s += box(-22, -100, 44, 44, skin, g.skin, 10);
  s += `<rect x="-17" y="-95" width="10" height="18" rx="5" fill="#FFFFFF" opacity=".35"/>`;
  s += `<ellipse cx="-8" cy="-82" rx="3.8" ry="5.8" fill="${ln}"/><ellipse cx="8" cy="-82" rx="3.8" ry="5.8" fill="${ln}"/>`;
  s += `<circle cx="-9" cy="-84" r="1.4" fill="#FFFFFF"/><circle cx="7" cy="-84" r="1.4" fill="#FFFFFF"/>`;
  s += o.shout ? `<path d="M-9 -70 Q0 -72 9 -70 Q8 -60 0 -59 Q-8 -60 -9 -70 Z" fill="${ln}"/><path d="M-5 -63 Q0 -60 5 -63" stroke="#FF7F8E" stroke-width="3" fill="none"/>`
    : `<path d="M-11 -71 Q0 -59 11 -71" fill="none" stroke="${ln}" stroke-width="3.5" stroke-linecap="round"/>`;
  // kapiteinspet
  s += `<path d="M-27 -101 C-30 -124 -12 -134 4 -134 C20 -134 38 -124 34 -104 Z" fill="#FFFFFF" stroke="${ln}" stroke-width="4"/>`;
  s += `<path d="M-20 -116 C-14 -128 8 -130 20 -124" stroke="#E3E8F2" stroke-width="6" fill="none"/>`;
  s += `<rect x="-27" y="-108" width="61" height="11" rx="3" fill="#1E2C5E" stroke="${ln}" stroke-width="3"/>`;
  s += `<path d="M-25 -97 Q2 -88 30 -98 L32 -93 Q2 -82 -27 -92 Z" fill="#14141F"/>`;
  s += `<circle cx="3" cy="-116" r="6.5" fill="#FFC93C" stroke="${ln}" stroke-width="2.5"/>`;
  return s + '</g>';
}

/* ---------------- De walvis ---------------- */

// Lokale maat: ongeveer 1060 breed, kop links. (0,0) ligt midden op de rug.
const BACK = [[300, 112], [380, 104], [460, 102], [540, 106], [620, 118], [700, 140], [780, 180]];
function backAt(px) {
  for (let i = 0; i < BACK.length - 1; i++) {
    const [x0, y0] = BACK[i], [x1, y1] = BACK[i + 1];
    if (px >= x0 && px <= x1) { const k = (px - x0) / (x1 - x0); return [lerp(y0, y1, k), Math.atan2(y1 - y0, x1 - x0) * 180 / Math.PI]; }
  }
  return [112, 0];
}

function whale(x, y, sc, o = {}) {
  const t = o.t ?? 0;
  const tail = Math.sin(t * 1.6) * 7 + (o.tailExtra ?? 0);
  const fin = Math.sin(t * 1.6 + 1) * 6;
  let s = `<g transform="translate(${x},${y}) rotate(${(o.rot ?? 0).toFixed(2)}) scale(${sc * (o.flip ? -1 : 1)},${sc}) translate(-520,-250)">`;
  // staart
  s += `<g transform="rotate(${tail.toFixed(2)} 900 250)"><path d="M880 232 C930 214 980 160 1040 128 C1052 170 1030 215 1000 248 C1032 275 1058 320 1050 368 C990 340 935 290 882 276 Z" fill="url(#whaleFin)" stroke="#132E55" stroke-width="8" stroke-linejoin="round"/>
    <path d="M1000 248 C980 250 960 252 930 254" stroke="#132E55" stroke-width="5" fill="none" opacity=".5"/></g>`;
  // achterste vin
  s += `<g transform="rotate(${(-fin).toFixed(2)} 600 340)"><path d="M560 336 C600 380 650 405 700 412 C680 385 650 360 620 340 Z" fill="#22508A" stroke="#132E55" stroke-width="6" stroke-linejoin="round"/></g>`;
  // lijf
  s += `<path d="M40 262 C40 168 150 118 300 112 C470 98 650 122 790 182 C840 204 878 222 912 236 L912 272 C850 292 760 332 620 352 C440 380 230 376 130 342 C70 320 40 296 40 262 Z" fill="url(#whaleBody)" stroke="#132E55" stroke-width="8" stroke-linejoin="round"/>`;
  // licht en schaduw binnen de omtrek van het lijf
  const cid = uid('wc'), wid = uid('ww');
  const warm = o.warm ?? '#FF9F7A';
  s += `<defs><clipPath id="${cid}"><path d="M40 262 C40 168 150 118 300 112 C470 98 650 122 790 182 C840 204 878 222 912 236 L912 272 C850 292 760 332 620 352 C440 380 230 376 130 342 C70 320 40 296 40 262 Z"/></clipPath>${radial(wid, [[0, warm, o.warmOp ?? 0.55], [1, warm, 0]], o.warmX ?? '2%', '66%', '40%')}</defs>`;
  s += `<g clip-path="url(#${cid})">`;
  s += `<rect x="0" y="60" width="960" height="360" fill="url(#${wid})" style="mix-blend-mode:screen"/>`;
  s += `<path d="M40 330 C220 400 600 390 930 262 L930 430 L20 430 Z" fill="#0B1D40" opacity=".32" filter="url(#b12)"/>`;
  s += `<path d="M130 166 C260 112 470 100 660 132" stroke="#D9EEFF" stroke-width="20" fill="none" opacity=".55" filter="url(#b6)"/>`;
  s += `<path d="M190 146 C300 118 420 110 520 114" stroke="#FFFFFF" stroke-width="7" fill="none" stroke-linecap="round" opacity=".8" filter="url(#b3)"/>`;
  if (o.deck !== false) for (const nx of [420, 600, 700]) { const [ny] = backAt(nx); s += `<ellipse cx="${nx}" cy="${ny + 14}" rx="54" ry="16" fill="#0B1D40" opacity=".35" filter="url(#b6)"/>`; }
  s += `</g>`;
  // buik met groeven
  s += `<path d="M58 300 C120 346 262 370 420 366 C520 363 600 352 690 336 C600 364 450 384 300 380 C190 376 100 346 58 300 Z" fill="url(#whaleBelly)"/>`;
  for (let i = 0; i < 6; i++) {
    const off = i * 9;
    s += `<path d="M${90 + i * 10} ${318 + off * 0.6} C${200} ${350 + off * 0.5} ${380} ${364 + off * 0.2} ${560 - i * 30} ${352 + off * 0.3}" fill="none" stroke="#7FA3C9" stroke-width="3" opacity=".65"/>`;
  }
  // vlekjes en zeepokken
  const r = rand(17);
  for (let i = 0; i < 14; i++) s += `<circle cx="${(330 + r() * 420).toFixed(0)}" cy="${(160 + r() * 110).toFixed(0)}" r="${(3 + r() * 6).toFixed(1)}" fill="#8EC0EE" opacity=".45"/>`;
  for (const [bx, by] of [[110, 200], [128, 190], [118, 214], [760, 238], [776, 248]]) s += `<circle cx="${bx}" cy="${by}" r="7" fill="#DCE6EE" stroke="#8796A6" stroke-width="3"/>`;
  // voorvin
  s += `<g transform="rotate(${fin.toFixed(2)} 330 350)"><path d="M300 344 C330 410 400 460 486 474 C462 432 420 390 380 356 Z" fill="url(#whaleFin)" stroke="#132E55" stroke-width="7" stroke-linejoin="round"/></g>`;
  // gezicht
  s += `<path d="M52 292 C112 316 200 322 280 302" fill="none" stroke="#132E55" stroke-width="8" stroke-linecap="round"/>`;
  const blink = o.blink ? 0.12 : 1;
  s += `<ellipse cx="178" cy="236" rx="19" ry="${21 * blink}" fill="#0E1B30"/>`;
  if (blink === 1) s += `<circle cx="171" cy="227" r="7.5" fill="#FFFFFF"/><circle cx="185" cy="246" r="3.5" fill="#FFFFFF"/>`;
  s += `<path d="M150 208 Q176 196 200 210" fill="none" stroke="#132E55" stroke-width="5" stroke-linecap="round"/>`;
  s += `<ellipse cx="140" cy="276" rx="22" ry="12" fill="#FF8FB0" opacity=".55"/>`;
  // spuitgat
  s += `<ellipse cx="250" cy="116" rx="18" ry="6" fill="#0E1B30"/>`;
  // dek: touwreling, mast met vlag en nesten
  if (o.deck !== false) {
    const posts = [380, 440, 500, 560, 620, 680];
    let rope = '';
    posts.forEach((px, i) => {
      const [py] = backAt(px);
      s += `<rect x="${px - 4}" y="${py - 46}" width="8" height="46" rx="3" fill="#8A5A2E" stroke="#4E3014" stroke-width="3"/>`;
      if (i > 0) { const qx = posts[i - 1], [qy] = backAt(qx); rope += `M${qx} ${qy - 40} Q${(qx + px) / 2} ${(qy + py) / 2 - 26} ${px} ${py - 40} `; }
    });
    const [my] = backAt(540);
    const wave = Math.sin(t * 4) * 8;
    s += `<rect x="535" y="${my - 230}" width="10" height="230" rx="4" fill="#8A5A2E" stroke="#4E3014" stroke-width="3"/>`;
    s += `<path d="M545 ${my - 228} C590 ${my - 238 + wave} 620 ${my - 212 - wave} 662 ${my - 222 + wave} L652 ${my - 176 + wave} C612 ${my - 168 - wave} 590 ${my - 190 + wave} 545 ${my - 178} Z" fill="#FF5A52" stroke="#4E1414" stroke-width="4" stroke-linejoin="round"/>`;
    s += `<path d="M578 ${my - 205} c6 -12 22 -12 28 0 c6 8 -8 14 -14 6 c-6 8 -20 2 -14 -6 Z" fill="#FFFFFF" opacity=".9"/>`;
    for (const [nx, sp] of [[420, o.nest?.[0] ?? 'NimbusPup'], [600, o.nest?.[1] ?? 'Jellyfloat'], [700, o.nest?.[2] ?? 'Breezle']]) {
      const [ny, na] = backAt(nx);
      s += `<g transform="translate(${nx},${ny - 6}) rotate(${na.toFixed(1)})">`;
      if (sp) s += driftling(sp, 0, -22, 22, { t, phase: nx, glow: false, rot: 0 });
      s += `<path d="M-40 -8 Q0 34 40 -8 Z" fill="url(#woodG)" stroke="#5A3612" stroke-width="5" stroke-linejoin="round"/>`;
      s += `<path d="M-30 4 Q0 18 30 4 M-20 -6 L-14 16 M0 -6 L0 20 M20 -6 L14 16" stroke="#5A3612" stroke-width="3" fill="none" opacity=".6"/>`;
      s += `<ellipse cx="0" cy="-8" rx="42" ry="9" fill="#B97C3A" stroke="#5A3612" stroke-width="4"/></g>`;
    }
    s += `<path d="${rope}" fill="none" stroke="#E8D3A8" stroke-width="5"/>`;
  }
  return s + '</g>';
}

// Waar het spuitgat van een walvis op het scherm ligt (zelfde transform als whale()).
function blowholePos(x, y, sc, rot = 0, flip = false) {
  const lx = (250 - 520) * sc * (flip ? -1 : 1), ly = (112 - 250) * sc;
  const a = rot * Math.PI / 180;
  return [x + lx * Math.cos(a) - ly * Math.sin(a), y + lx * Math.sin(a) + ly * Math.cos(a)];
}

function spout(x, y, height, t, o = {}) {
  const w = o.w ?? 46;
  let s = `<g transform="translate(${x},${y})" opacity="${o.op ?? 1}">`;
  s += `<path d="M${-w * 0.35} 0 C${-w * 0.6} ${-height * 0.4} ${-w * 0.2} ${-height * 0.8} 0 ${-height} C${w * 0.2} ${-height * 0.8} ${w * 0.6} ${-height * 0.4} ${w * 0.35} 0 Z" fill="url(#sprayG)"/>`;
  s += `<path d="M${-w * 0.12} 0 C${-w * 0.22} ${-height * 0.4} ${-w * 0.08} ${-height * 0.8} 0 ${-height * 0.95} C${w * 0.08} ${-height * 0.8} ${w * 0.22} ${-height * 0.4} ${w * 0.12} 0 Z" fill="#FFFFFF" opacity=".75"/>`;
  const r = rand(7);
  for (let i = 0; i < 26; i++) {
    const p = (t * 1.4 + r()) % 1;
    const side = r() < 0.5 ? -1 : 1;
    const px = side * (10 + p * (w * 2 + r() * 60)), py = -height + p * p * 160 - (1 - p) * 30;
    s += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${(4 + r() * 8) * (1 - p * 0.5)}" fill="#FFFFFF" opacity="${(0.9 * (1 - p)).toFixed(2)}"/>`;
  }
  s += `<ellipse cx="0" cy="${-height}" rx="${w * 1.4}" ry="${w * 0.7}" fill="#FFFFFF" opacity=".85" filter="url(#b6)"/>`;
  return s + '</g>';
}

function bokeh(seed, count, o = {}) {
  const r = rand(seed); let s = '';
  for (let i = 0; i < count; i++) {
    const x = (o.x0 ?? 0) + r() * (o.w ?? W), y = (o.y0 ?? 0) + r() * (o.h ?? H), rr = (o.rMin ?? 10) + r() * (o.rMax ?? 40);
    s += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${rr.toFixed(1)}" fill="url(#bokehG)" opacity="${(o.op ?? 0.5) * (0.4 + r() * 0.6)}"/>`;
  }
  return s;
}

function speedLines(x, y, len, angle, count, o = {}) {
  const r = rand(o.seed ?? 4); let s = `<g transform="translate(${x},${y}) rotate(${angle})" opacity="${o.op ?? 0.8}">`;
  for (let i = 0; i < count; i++) {
    const off = (r() - 0.5) * (o.spread ?? 160), l = len * (0.5 + r() * 0.5), y0 = r() * 60;
    s += `<line x1="${off.toFixed(0)}" y1="${y0.toFixed(0)}" x2="${off.toFixed(0)}" y2="${(y0 + l).toFixed(0)}" stroke="#FFFFFF" stroke-width="${(3 + r() * 4).toFixed(1)}" stroke-linecap="round" opacity="${(0.4 + r() * 0.5).toFixed(2)}"/>`;
  }
  return s + '</g>';
}

// Kleurcorrectie over het hele beeld: warm links, paars rechts, en een vignet.
function grade(op = 0.35, w = W, h = H) {
  return `<rect width="${w}" height="${h}" fill="url(#grade)" opacity="${op}" style="mix-blend-mode:soft-light"/><rect width="${w}" height="${h}" fill="url(#vignette)"/>`;
}

if (typeof module !== 'undefined') module.exports = {};
