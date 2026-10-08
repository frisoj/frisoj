// Tekenset voor de winkelplaatjes, het icoon en de thumbnail van Steal a Slime.
// Alles is SVG; dezelfde slijm-look als in de game (glanzend lijf, grote ogen, accessoires).

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
function rand(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
function hex2rgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgb2hex(r, g, b) { return '#' + [r, g, b].map(v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join(''); }
function mix(a, b, t) { const x = hex2rgb(a), y = hex2rgb(b); return rgb2hex(lerp(x[0], y[0], t), lerp(x[1], y[1], t), lerp(x[2], y[2], t)); }
function shade(c, amt) { return amt >= 0 ? mix(c, '#ffffff', amt) : mix(c, '#000000', -amt); }
const rgbHex = a => rgb2hex(a[0], a[1], a[2]);

let UID = 0;
const uid = p => p + (UID++);
const stops = list => list.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}"${a != null ? ` stop-opacity="${a}"` : ''}/>`).join('');
const radial = (id, list, cx = '35%', cy = '30%', r = '75%') => `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${stops(list)}</radialGradient>`;
const linear = (id, list, x1 = 0, y1 = 0, x2 = 0, y2 = 1) => `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops(list)}</linearGradient>`;

const DEFS = `
  <filter id="b4" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4"/></filter>
  <filter id="b10" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="10"/></filter>
  <filter id="b24" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="24"/></filter>
  <filter id="b50" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="50"/></filter>
  <filter id="shadow" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="10" stdDeviation="10" flood-color="#120a2a" flood-opacity=".4"/></filter>
  <filter id="tshadow" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="8" stdDeviation="7" flood-color="#0b0620" flood-opacity=".5"/></filter>
  <path id="spark" d="M0,-1 C.12,-.12 .12,-.12 1,0 C.12,.12 .12,.12 0,1 C-.12,.12 -.12,.12 -1,0 C-.12,-.12 -.12,-.12 0,-1Z"/>
  ${linear('goldText', [[0, '#FFFFFF'], [0.48, '#FFF2B8'], [0.5, '#FFD447'], [1, '#FF9F1C']])}
  ${linear('mintText', [[0, '#F0FFF6'], [0.48, '#B6FFD2'], [0.5, '#4DF08E'], [1, '#18B86A']])}
  ${linear('pinkText', [[0, '#FFF0FA'], [0.48, '#FFC2E6'], [0.5, '#FF6FC0'], [1, '#E0359A']])}
  ${linear('rainbow', [[0, '#FF5E7E'], [0.2, '#FFB03B'], [0.4, '#FFF05A'], [0.6, '#5BF08E'], [0.8, '#4DB8FF'], [1, '#B06BFF']], 0, 0, 1, 0)}
  ${linear('gooFill', [[0, '#B8FFD6'], [0.5, '#4FF09A'], [1, '#14B865']])}
  ${linear('metal', [[0, '#E9EEF6'], [0.5, '#A9B3C6'], [1, '#6D7890']])}
  ${linear('woodG', [[0, '#E3A766'], [1, '#9A6230']])}
  <radialGradient id="vignette" cx="50%" cy="50%" r="72%"><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#0b0620" stop-opacity=".45"/></radialGradient>
`;

const sparkle = (x, y, r, op = 1, col = '#FFFFFF', rot = 0) =>
  `<use href="#spark" transform="translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${rot}) scale(${r.toFixed(2)})" fill="${col}" opacity="${op}"/>`;

function text(str, x, y, size, o = {}) {
  const fill = o.fill ?? 'url(#goldText)', stroke = o.stroke ?? '#1A0E36', sw = o.sw ?? size * 0.2, depth = o.depth ?? Math.round(size * 0.09);
  const base = `font-family="Fredoka" font-weight="700" font-size="${size}" text-anchor="${o.anchor ?? 'middle'}" letter-spacing="${o.ls ?? 0}"`;
  let s = `<g transform="translate(${x},${y}) rotate(${o.rot ?? 0}) scale(${o.scale ?? 1})" filter="url(#tshadow)">`;
  if (o.outer !== false) for (let i = depth; i >= 0; i -= 3) s += `<text ${base} y="${i}" fill="${o.outer ?? '#FFFFFF'}" stroke="${o.outer ?? '#FFFFFF'}" stroke-width="${sw + (o.ow ?? size * 0.12) * 2}" stroke-linejoin="round">${str}</text>`;
  for (let i = depth; i > 0; i -= 2) s += `<text ${base} y="${i}" fill="${stroke}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round">${str}</text>`;
  s += `<text ${base} fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" paint-order="stroke">${str}</text>`;
  return s + '</g>';
}

/* ---------------- slijmpjes ---------------- */

const SPECIES = {
  Gloop: { color: [120, 220, 120], accent: [70, 170, 80], style: 'plain', rarity: 'Common' },
  Bubbles: { color: [120, 200, 255], accent: [220, 245, 255], style: 'bubbles', rarity: 'Common' },
  Jellybean: { color: [255, 120, 170], accent: [255, 210, 230], style: 'bean', rarity: 'Uncommon' },
  PuddlePup: { color: [255, 200, 120], accent: [160, 100, 60], style: 'pup', rarity: 'Uncommon' },
  Sprout: { color: [170, 235, 110], accent: [60, 160, 60], style: 'sprout', rarity: 'Uncommon' },
  Bouncer: { color: [255, 150, 60], accent: [255, 230, 80], style: 'spring', rarity: 'Rare' },
  Frosty: { color: [190, 235, 255], accent: [90, 170, 230], style: 'frost', rarity: 'Rare' },
  Ninja: { color: [70, 70, 90], accent: [230, 50, 60], style: 'ninja', rarity: 'Epic' },
  Pirate: { color: [80, 170, 200], accent: [40, 40, 50], style: 'pirate', rarity: 'Epic' },
  KingGloop: { color: [90, 220, 110], accent: [255, 205, 60], style: 'king', rarity: 'Legendary' },
  Unicorn: { color: [250, 230, 255], accent: [255, 140, 220], style: 'unicorn', rarity: 'Legendary' },
  DragonDrip: { color: [230, 70, 70], accent: [255, 200, 80], style: 'dragon', rarity: 'Legendary' },
  GalaxyGel: { color: [60, 40, 140], accent: [150, 220, 255], style: 'galaxy', rarity: 'Mythic' },
  CyberSlime: { color: [40, 50, 70], accent: [0, 255, 230], style: 'cyber', rarity: 'Mythic' },
  PhoenixPuff: { color: [255, 110, 40], accent: [255, 230, 90], style: 'phoenix', rarity: 'Mythic' },
  SlimeGod: { color: [255, 250, 220], accent: [255, 215, 90], style: 'god', rarity: 'Godly' },
  VoidBlob: { color: [30, 16, 46], accent: [190, 80, 255], style: 'void', rarity: 'Secret' },
  RainbowRoyale: { color: [255, 120, 120], accent: [255, 230, 120], style: 'rainbow', rarity: 'Secret' },
};
const RARITY = { Common: '#CDD6E0', Uncommon: '#6EE182', Rare: '#5AAAFF', Epic: '#BE6EFF', Legendary: '#FFC43C', Mythic: '#FF5AA0', Godly: '#FFF08C', Secret: '#B65CFF' };
const MUT = { Gold: '#FFC832', Diamond: '#96EBFF', Candy: '#FF78C8', Lava: '#FF641E', Galaxy: '#8C5AFF' };

// Een slijmpje van ongeveer `size` breed, met de onderkant op (x, y).
function slime(id, x, y, size, o = {}) {
  const sp = SPECIES[id];
  let body = rgbHex(sp.color);
  const acc = rgbHex(sp.accent);
  if (o.mut && MUT[o.mut]) body = mix(body, MUT[o.mut], o.mut === 'Gold' ? 0.95 : 0.75);
  const rainbow = o.mut === 'Rainbow' || id === 'RainbowRoyale';
  const W = size, H = size * 0.82;
  const sq = o.squash ?? 0;
  const w = W * (1 + sq * 0.5), h = H * (1 - sq);
  const gid = uid('sb'), hid = uid('sh');
  const line = shade(body, -0.55);
  let s = `<g transform="translate(${x},${y}) rotate(${o.rot ?? 0})" opacity="${o.op ?? 1}">`;
  s += `<defs>${rainbow ? linear(gid, [[0, '#FF6E8C'], [0.25, '#FFC24A'], [0.5, '#7CF59E'], [0.75, '#62C2FF'], [1, '#C07BFF']], 0, 0, 1, 1) : radial(gid, [[0, shade(body, 0.55)], [0.45, body], [1, shade(body, -0.35)]], '38%', '28%', '80%')}${radial(hid, [[0, '#FFFFFF', 0.95], [1, '#FFFFFF', 0]], '50%', '50%', '50%')}</defs>`;
  if (o.glow !== false) {
    const gc = o.mut && MUT[o.mut] ? MUT[o.mut] : RARITY[sp.rarity];
    s += `<ellipse cx="0" cy="${-h * 0.45}" rx="${w * 0.85}" ry="${h * 0.85}" fill="${gc}" opacity="${o.glowOp ?? 0.5}" filter="url(#b24)"/>`;
  }
  // schaduw op de grond
  if (o.shadow !== false) s += `<ellipse cx="0" cy="2" rx="${w * 0.5}" ry="${w * 0.1}" fill="#120a2a" opacity=".3" filter="url(#b4)"/>`;
  const st = sp.style;
  const top = -h;
  // achterkant-accessoires
  if (st === 'dragon') for (const m of [1, -1]) s += `<g transform="scale(${m},1)"><path d="M${w * 0.32} ${-h * 0.62} L${w * 0.78} ${-h * 1.05} L${w * 0.62} ${-h * 0.5} L${w * 0.8} ${-h * 0.42} Z" fill="${shade(body, -0.2)}" stroke="${line}" stroke-width="${size * 0.025}" stroke-linejoin="round"/></g>`;
  if (st === 'god') for (const m of [1, -1]) s += `<g transform="scale(${m},1)"><path d="M${w * 0.3} ${-h * 0.6} C${w * 0.6} ${-h * 1.2} ${w * 0.95} ${-h * 1.05} ${w * 0.9} ${-h * 0.6} C${w * 0.8} ${-h * 0.45} ${w * 0.55} ${-h * 0.35} ${w * 0.32} ${-h * 0.4} Z" fill="#FFFFFF" stroke="#E8D9A0" stroke-width="${size * 0.02}"/></g>`;
  if (st === 'pup') for (const m of [1, -1]) s += `<g transform="scale(${m},1)"><ellipse cx="${w * 0.42}" cy="${-h * 0.7}" rx="${w * 0.12}" ry="${h * 0.26}" fill="${acc}" stroke="${line}" stroke-width="${size * 0.02}" transform="rotate(25 ${w * 0.42} ${-h * 0.7})"/></g>`;
  // lijf
  s += `<path d="M${-w / 2} ${-h * 0.32} C${-w / 2} ${-h * 0.86} ${-w * 0.3} ${-h} 0 ${-h} C${w * 0.3} ${-h} ${w / 2} ${-h * 0.86} ${w / 2} ${-h * 0.32} C${w / 2} ${-h * 0.04} ${w * 0.36} 0 0 0 C${-w * 0.36} 0 ${-w / 2} ${-h * 0.04} ${-w / 2} ${-h * 0.32} Z" fill="url(#${gid})" stroke="${line}" stroke-width="${size * 0.03}" opacity="${o.bodyOp ?? 1}"/>`;
  if (['galaxy', 'void'].includes(st) || o.mut === 'Galaxy') {
    const r = rand(size | 0);
    for (let i = 0; i < 9; i++) s += `<circle cx="${(r() - 0.5) * w * 0.7}" cy="${-h * (0.2 + r() * 0.65)}" r="${size * (0.01 + r() * 0.015)}" fill="#FFFFFF" opacity=".9"/>`;
  }
  if (o.mut === 'Candy') {
    const r = rand(7); const cols = ['#FFFFFF', '#6EDBFF', '#FFE45C', '#7CF59E'];
    for (let i = 0; i < 10; i++) { const px = (r() - 0.5) * w * 0.7, py = -h * (0.45 + r() * 0.45); s += `<rect x="${px}" y="${py}" width="${size * 0.07}" height="${size * 0.022}" rx="${size * 0.011}" fill="${cols[i % 4]}" transform="rotate(${r() * 180} ${px} ${py})"/>`; }
  }
  if (o.mut === 'Lava') s += `<ellipse cx="0" cy="${-h * 0.4}" rx="${w * 0.28}" ry="${h * 0.22}" fill="#FFB347" opacity=".75" filter="url(#b4)"/>`;
  // glans
  s += `<ellipse cx="${-w * 0.2}" cy="${-h * 0.78}" rx="${w * 0.14}" ry="${h * 0.08}" fill="url(#${hid})" transform="rotate(-25 ${-w * 0.2} ${-h * 0.78})"/>`;
  s += `<circle cx="${w * 0.27}" cy="${-h * 0.6}" r="${size * 0.025}" fill="#FFFFFF" opacity=".8"/>`;
  // gezicht
  const ey = -h * 0.55, ex = w * 0.19, er = size * 0.1;
  const eyeCol = st === 'void' ? '#C46BFF' : '#1B1430';
  for (const m of [-1, 1]) {
    s += `<ellipse cx="${m * ex}" cy="${ey}" rx="${er * 0.9}" ry="${er * 1.12}" fill="${eyeCol}"/>`;
    s += `<circle cx="${m * ex + er * 0.3}" cy="${ey - er * 0.4}" r="${er * 0.42}" fill="#FFFFFF"/>`;
    s += `<circle cx="${m * ex - er * 0.3}" cy="${ey + er * 0.45}" r="${er * 0.18}" fill="#FFFFFF"/>`;
    s += `<ellipse cx="${m * w * 0.31}" cy="${-h * 0.4}" rx="${size * 0.07}" ry="${size * 0.04}" fill="#FF6E9E" opacity=".6"/>`;
  }
  s += `<path d="M${-size * 0.05} ${-h * 0.38} Q0 ${-h * 0.27} ${size * 0.05} ${-h * 0.38} Z" fill="#1B1430"/><ellipse cx="0" cy="${-h * 0.33}" rx="${size * 0.025}" ry="${size * 0.015}" fill="#FF6E8C"/>`;
  // accessoires vooraan / bovenop
  const k = size;
  if (st === 'king' || st === 'rainbow' || o.crown) {
    s += `<g transform="translate(0,${top + k * 0.03})"><path d="M${-k * 0.22} 0 L${-k * 0.24} ${-k * 0.2} L${-k * 0.11} ${-k * 0.1} L0 ${-k * 0.25} L${k * 0.11} ${-k * 0.1} L${k * 0.24} ${-k * 0.2} L${k * 0.22} 0 Z" fill="#FFCF3A" stroke="#9A6A08" stroke-width="${k * 0.02}" stroke-linejoin="round"/>`;
    s += `<circle cx="0" cy="${-k * 0.07}" r="${k * 0.035}" fill="#FF4A6E"/><circle cx="${-k * 0.24}" cy="${-k * 0.21}" r="${k * 0.025}" fill="#FFF1A6"/><circle cx="${k * 0.24}" cy="${-k * 0.21}" r="${k * 0.025}" fill="#FFF1A6"/><circle cx="0" cy="${-k * 0.26}" r="${k * 0.025}" fill="#FFF1A6"/></g>`;
  }
  if (st === 'unicorn') s += `<path d="M${-k * 0.05} ${top + k * 0.04} L0 ${top - k * 0.28} L${k * 0.05} ${top + k * 0.04} Z" fill="#FFD77A" stroke="#B88A1C" stroke-width="${k * 0.015}"/><path d="M${-k * 0.03} ${top - k * 0.05} L${k * 0.035} ${top - k * 0.09} M${-k * 0.02} ${top - k * 0.14} L${k * 0.025} ${top - k * 0.17}" stroke="#B88A1C" stroke-width="${k * 0.012}"/>`;
  if (st === 'sprout') s += `<path d="M0 ${top + k * 0.02} L0 ${top - k * 0.14}" stroke="${acc}" stroke-width="${k * 0.03}"/><ellipse cx="${-k * 0.08}" cy="${top - k * 0.16}" rx="${k * 0.1}" ry="${k * 0.04}" fill="#5CCB5A" transform="rotate(-25 ${-k * 0.08} ${top - k * 0.16})"/><ellipse cx="${k * 0.08}" cy="${top - k * 0.16}" rx="${k * 0.1}" ry="${k * 0.04}" fill="#5CCB5A" transform="rotate(25 ${k * 0.08} ${top - k * 0.16})"/>`;
  if (st === 'ninja') s += `<rect x="${-w * 0.49}" y="${-h * 0.8}" width="${w * 0.98}" height="${h * 0.12}" rx="${h * 0.05}" fill="${acc}"/><path d="M${w * 0.45} ${-h * 0.75} L${w * 0.75} ${-h * 0.62} L${w * 0.7} ${-h * 0.8} Z" fill="${acc}"/>`;
  if (st === 'pirate') s += `<path d="M${-k * 0.42} ${top + k * 0.06} Q0 ${top - k * 0.12} ${k * 0.42} ${top + k * 0.06} Q0 ${top - k * 0.02} ${-k * 0.42} ${top + k * 0.06} Z" fill="#26222E"/><path d="M${-k * 0.26} ${top + k * 0.02} Q0 ${top - k * 0.32} ${k * 0.26} ${top + k * 0.02} Z" fill="#26222E"/><circle cx="0" cy="${top - k * 0.08}" r="${k * 0.035}" fill="#FFFFFF"/><ellipse cx="${ex}" cy="${ey}" rx="${er * 1.1}" ry="${er * 1.2}" fill="#26222E"/><path d="M${ex - er} ${ey - er} L${-w * 0.4} ${-h * 0.85}" stroke="#26222E" stroke-width="${k * 0.015}"/>`;
  if (st === 'frost') for (const a of [-0.5, 0, 0.5]) s += `<path d="M0 ${top + k * 0.05} L${-k * 0.03} ${top - k * 0.12} L0 ${top - k * 0.2} L${k * 0.03} ${top - k * 0.12} Z" fill="#DFF6FF" stroke="#7CC8F0" stroke-width="${k * 0.01}" transform="rotate(${a * 50} 0 ${top + k * 0.05})"/>`;
  if (st === 'spring') s += `<path d="M0 ${top + k * 0.02} l${k * 0.06} ${-k * 0.04} l${-k * 0.12} ${-k * 0.04} l${k * 0.12} ${-k * 0.04} l${-k * 0.06} ${-k * 0.03}" fill="none" stroke="${acc}" stroke-width="${k * 0.02}"/><circle cx="0" cy="${top - k * 0.17}" r="${k * 0.05}" fill="#FF5A5A"/>`;
  if (st === 'bean') s += `<path d="M${-k * 0.13} ${top - k * 0.04} L0 ${top + k * 0.02} L${-k * 0.13} ${top + k * 0.08} Z M${k * 0.13} ${top - k * 0.04} L0 ${top + k * 0.02} L${k * 0.13} ${top + k * 0.08} Z" fill="#FF5AA0" stroke="#B02A6A" stroke-width="${k * 0.01}"/><circle cx="0" cy="${top + k * 0.02}" r="${k * 0.03}" fill="#FF5AA0"/>`;
  if (st === 'bubbles') for (const [bx, by, br] of [[-0.55, -0.9, 0.07], [0.6, -0.75, 0.09], [0.5, -1.15, 0.05]]) s += `<circle cx="${w * bx}" cy="${h * by}" r="${k * br}" fill="#E8F8FF" fill-opacity=".35" stroke="#FFFFFF" stroke-width="${k * 0.01}"/>`;
  if (st === 'dragon') for (const m of [-1, 1]) s += `<path d="M${m * w * 0.15} ${top + k * 0.04} L${m * w * 0.3} ${top - k * 0.14} L${m * w * 0.24} ${top + k * 0.06} Z" fill="${acc}" stroke="${line}" stroke-width="${k * 0.012}"/>`;
  if (st === 'cyber') s += `<rect x="${-w * 0.36}" y="${ey - er * 0.7}" width="${w * 0.72}" height="${er * 1.4}" rx="${er * 0.6}" fill="${acc}" opacity=".85"/><path d="M0 ${top} L0 ${top - k * 0.16}" stroke="#B9BED0" stroke-width="${k * 0.015}"/><circle cx="0" cy="${top - k * 0.17}" r="${k * 0.035}" fill="${acc}"/>`;
  if (st === 'phoenix') for (const [a, c] of [[-28, '#FF7A28'], [0, '#FFE15A'], [28, '#FF7A28']]) s += `<path d="M0 ${top + k * 0.04} C${-k * 0.06} ${top - k * 0.08} ${-k * 0.02} ${top - k * 0.2} 0 ${top - k * 0.26} C${k * 0.03} ${top - k * 0.16} ${k * 0.06} ${top - k * 0.08} 0 ${top + k * 0.04} Z" fill="${c}" transform="rotate(${a} 0 ${top + k * 0.04})"/>`;
  if (st === 'god') s += `<ellipse cx="0" cy="${top - k * 0.12}" rx="${k * 0.22}" ry="${k * 0.05}" fill="none" stroke="#FFE27A" stroke-width="${k * 0.03}"/><ellipse cx="0" cy="${top - k * 0.12}" rx="${k * 0.22}" ry="${k * 0.05}" fill="none" stroke="#FFF6C8" stroke-width="${k * 0.012}" filter="url(#b4)"/>`;
  if (o.mut === 'Gold' || o.mut === 'Diamond' || sp.rarity === 'Mythic' || sp.rarity === 'Godly' || sp.rarity === 'Secret' || rainbow) {
    s += sparkle(w * 0.5, -h * 0.95, k * 0.07, 0.95) + sparkle(-w * 0.55, -h * 0.5, k * 0.05, 0.85, '#FFF4B0') + sparkle(w * 0.62, -h * 0.25, k * 0.04, 0.8);
  }
  return s + '</g>';
}

/* ---------------- Roblox-poppetje (dief) ---------------- */

function avatar(x, y, sc, o = {}) {
  const shirt = o.shirt ?? '#3B3F58', pants = o.pants ?? '#22253A', skin = o.skin ?? '#F7CB46', ln = '#140C2A';
  const OX = 9, OY = -7;
  const box = (bx, by, w, h, c, rx = 4) =>
    `<path d="M${bx + w - 1} ${by + 1} L${bx + w + OX} ${by + OY + 1} L${bx + w + OX} ${by + h + OY - 1} L${bx + w - 1} ${by + h - 1} Z" fill="${shade(c, -0.34)}" stroke="${ln}" stroke-width="3.5" stroke-linejoin="round"/>` +
    `<path d="M${bx + 1} ${by + 1} L${bx + OX + 1} ${by + OY} L${bx + w + OX} ${by + OY} L${bx + w - 1} ${by + 1} Z" fill="${shade(c, 0.3)}" stroke="${ln}" stroke-width="3.5" stroke-linejoin="round"/>` +
    `<rect x="${bx}" y="${by}" width="${w}" height="${h}" rx="${rx}" fill="${c}" stroke="${ln}" stroke-width="4"/><rect x="${bx + 3}" y="${by + 3}" width="${w * 0.3}" height="${h - 6}" rx="3" fill="#FFFFFF" opacity=".18"/>`;
  let s = `<g transform="translate(${x},${y}) rotate(${o.rot ?? 0}) scale(${sc * (o.flip ? -1 : 1)},${sc})">`;
  const leg = (dx, a) => `<g transform="rotate(${a} ${dx} 0)">${box(dx - 11, -2, 22, 48, pants)}<rect x="${dx - 11}" y="34" width="22" height="12" rx="3" fill="#111" stroke="${ln}" stroke-width="4"/></g>`;
  s += leg(-12, o.legL ?? 0) + leg(12, o.legR ?? 0);
  const arm = (dx, a, holding) => {
    let q = `<g transform="rotate(${a} ${dx} -46)">`;
    if (holding === 'bonker') q += `<line x1="${dx}" y1="-6" x2="${dx}" y2="60" stroke="#A86BFF" stroke-width="8" stroke-linecap="round"/><circle cx="${dx}" cy="78" r="22" fill="#6EFFA0" stroke="${ln}" stroke-width="4"/><circle cx="${dx - 7}" cy="70" r="6" fill="#FFFFFF" opacity=".8"/>`;
    q += box(dx - 10, -52, 20, 50, skin, 5) + box(dx - 10, -52, 20, 18, shirt, 5);
    return q + '</g>';
  };
  s += arm(-34, o.armL ?? 0, o.holdL);
  s += box(-24, -54, 48, 54, shirt, 6);
  s += `<path d="M-14 -40 L14 -40" stroke="#FFFFFF" stroke-width="4" opacity=".5"/><path d="M-14 -28 L14 -28" stroke="#FFFFFF" stroke-width="4" opacity=".5"/><path d="M-14 -16 L14 -16" stroke="#FFFFFF" stroke-width="4" opacity=".5"/>`;
  s += arm(34, o.armR ?? 0, o.holdR);
  s += box(-22, -100, 44, 44, skin, 10);
  // bandietenmasker en muts
  s += `<rect x="-24" y="-90" width="48" height="13" rx="5" fill="#1B1430"/><ellipse cx="-9" cy="-83.5" rx="5" ry="4" fill="#FFFFFF"/><ellipse cx="9" cy="-83.5" rx="5" ry="4" fill="#FFFFFF"/><circle cx="-8" cy="-83" r="2.4" fill="#1B1430"/><circle cx="10" cy="-83" r="2.4" fill="#1B1430"/>`;
  s += o.shout ? `<path d="M-9 -70 Q0 -72 9 -70 Q8 -60 0 -59 Q-8 -60 -9 -70 Z" fill="${ln}"/>` : `<path d="M-10 -69 Q0 -60 10 -69" fill="none" stroke="${ln}" stroke-width="3.5" stroke-linecap="round"/>`;
  s += `<path d="M-25 -98 C-26 -122 -10 -130 4 -130 C18 -130 32 -120 30 -98 Z" fill="#E8394E" stroke="${ln}" stroke-width="4"/><rect x="-26" y="-104" width="58" height="10" rx="4" fill="#B81E33" stroke="${ln}" stroke-width="3"/><circle cx="4" cy="-132" r="7" fill="#FFFFFF" stroke="${ln}" stroke-width="3"/>`;
  return s + '</g>';
}

/* ---------------- spullen voor de winkel ---------------- */

function gooDrop(x, y, r) {
  return `<path transform="translate(${x},${y}) scale(${r / 50})" d="M0 -60 C20 -30 40 -10 40 15 C40 40 22 55 0 55 C-22 55 -40 40 -40 15 C-40 -10 -20 -30 0 -60 Z" fill="url(#gooFill)" stroke="#0E6B3E" stroke-width="6"/><ellipse transform="translate(${x},${y}) scale(${r / 50})" cx="-14" cy="5" rx="9" ry="16" fill="#FFFFFF" opacity=".7"/>`;
}

function cloud(x, y, w, fill, stroke) {
  return `<g transform="translate(${x},${y}) scale(${w / 300})"><path d="M-120 40 C-170 40 -170 -30 -115 -30 C-110 -90 -30 -105 0 -60 C25 -110 110 -95 110 -35 C170 -35 170 40 115 40 Z" fill="${fill}" stroke="${stroke}" stroke-width="10" stroke-linejoin="round"/></g>`;
}

function egg(x, y, s, base, spot, glow) {
  const gid = uid('eg');
  let out = `<defs>${radial(gid, [[0, shade(base, 0.6)], [0.5, base], [1, shade(base, -0.35)]], '38%', '30%', '80%')}</defs>`;
  if (glow) out += `<ellipse cx="${x}" cy="${y - s * 0.6}" rx="${s * 0.9}" ry="${s}" fill="${glow}" opacity=".55" filter="url(#b24)"/>`;
  out += `<path transform="translate(${x},${y}) scale(${s / 100})" d="M0 -130 C50 -130 80 -40 80 0 C80 45 45 70 0 70 C-45 70 -80 45 -80 0 C-80 -40 -50 -130 0 -130 Z" fill="url(#${gid})" stroke="#2A1748" stroke-width="7"/>`;
  const r = rand(Math.round(x + y));
  for (let i = 0; i < 6; i++) out += `<circle cx="${x + (r() - 0.5) * s * 1.1}" cy="${y - s * (0.2 + r() * 0.9)}" r="${s * (0.08 + r() * 0.08)}" fill="${spot}" opacity=".9"/>`;
  out += `<ellipse cx="${x - s * 0.3}" cy="${y - s * 0.85}" rx="${s * 0.12}" ry="${s * 0.22}" fill="#FFFFFF" opacity=".7" transform="rotate(20 ${x - s * 0.3} ${y - s * 0.85})"/>`;
  return out;
}

function clover(x, y, s, col = '#3FDB6F') {
  let out = `<g transform="translate(${x},${y}) scale(${s / 100})"><path d="M0 20 C10 60 30 90 50 110" stroke="#1F8F45" stroke-width="12" fill="none" stroke-linecap="round"/>`;
  for (let i = 0; i < 4; i++) out += `<g transform="rotate(${i * 90 + 45})"><path d="M0 0 C-40 -20 -50 -70 -20 -80 C-5 -85 0 -70 0 -60 C0 -70 5 -85 20 -80 C50 -70 40 -20 0 0 Z" fill="${col}" stroke="#14662F" stroke-width="7"/><path d="M0 -10 L0 -55" stroke="#FFFFFF" stroke-width="5" opacity=".5"/></g>`;
  return out + `<circle r="10" fill="#FFE45C" stroke="#14662F" stroke-width="5"/></g>`;
}

function lock(x, y, s, col = '#FFC43C') {
  return `<g transform="translate(${x},${y}) scale(${s / 100})"><path d="M-45 -10 L-45 -55 C-45 -110 45 -110 45 -55 L45 -10" fill="none" stroke="url(#metal)" stroke-width="22"/><path d="M-45 -10 L-45 -55 C-45 -110 45 -110 45 -55 L45 -10" fill="none" stroke="#2A1748" stroke-width="30" opacity=".0"/><rect x="-75" y="-20" width="150" height="120" rx="22" fill="${col}" stroke="#2A1748" stroke-width="8"/><rect x="-60" y="-8" width="40" height="96" rx="12" fill="#FFFFFF" opacity=".3"/><circle cx="0" cy="30" r="16" fill="#2A1748"/><rect x="-7" y="35" width="14" height="32" rx="6" fill="#2A1748"/></g>`;
}

function lab(x, y, s, col = '#8CE0FF') {
  return `<g transform="translate(${x},${y}) scale(${s / 100})"><rect x="-120" y="-40" width="240" height="110" rx="14" fill="#F2F0FA" stroke="#2A1748" stroke-width="7"/><path d="M-130 -40 L0 -120 L130 -40 Z" fill="${col}" stroke="#2A1748" stroke-width="7" stroke-linejoin="round"/><rect x="-30" y="5" width="60" height="65" rx="10" fill="#6E4DB8" stroke="#2A1748" stroke-width="6"/><rect x="-100" y="-20" width="50" height="38" rx="8" fill="#BDEBFF" stroke="#2A1748" stroke-width="5"/><rect x="50" y="-20" width="50" height="38" rx="8" fill="#BDEBFF" stroke="#2A1748" stroke-width="5"/><circle cx="0" cy="-70" r="16" fill="#FFFFFF" stroke="#2A1748" stroke-width="5"/></g>`;
}

function boot(x, y, s) {
  return `<g transform="translate(${x},${y}) scale(${s / 100})"><path d="M-60 -90 L10 -90 L15 -20 C60 -15 95 5 95 30 L95 45 L-70 45 L-70 -20 Z" fill="#FF4F6E" stroke="#2A1748" stroke-width="8" stroke-linejoin="round"/><rect x="-75" y="40" width="175" height="22" rx="10" fill="#FFFFFF" stroke="#2A1748" stroke-width="7"/><path d="M-50 -60 L0 -60 M-50 -40 L5 -40" stroke="#FFFFFF" stroke-width="7" stroke-linecap="round"/><path d="M-60 -70 C-120 -110 -150 -60 -130 -40 C-110 -60 -90 -55 -70 -45" fill="#FFFFFF" stroke="#2A1748" stroke-width="6"/><path d="M-60 -45 C-115 -70 -140 -25 -120 -10 C-100 -25 -85 -25 -70 -20" fill="#FFFFFF" stroke="#2A1748" stroke-width="6"/></g>`;
}

function glove(x, y, s) {
  return `<g transform="translate(${x},${y}) scale(${s / 100})"><path d="M-55 70 L-55 -10 C-55 -30 -35 -30 -35 -10 L-35 -60 C-35 -80 -15 -80 -15 -60 L-15 -75 C-15 -95 5 -95 5 -75 L5 -65 C5 -85 25 -85 25 -65 L25 -45 C25 -65 45 -65 45 -45 L45 30 C45 55 30 70 10 70 Z" fill="#2C2A3A" stroke="#120E1E" stroke-width="8" stroke-linejoin="round"/><rect x="-62" y="62" width="114" height="26" rx="10" fill="#E8394E" stroke="#120E1E" stroke-width="7"/><path d="M-25 -40 L-25 0 M-5 -55 L-5 0" stroke="#5A5674" stroke-width="6" stroke-linecap="round"/></g>`;
}

function magnet(x, y, s) {
  return `<g transform="translate(${x},${y}) scale(${s / 100}) rotate(-20)"><path d="M-70 -60 L-70 10 C-70 80 70 80 70 10 L70 -60 L30 -60 L30 10 C30 35 -30 35 -30 10 L-30 -60 Z" fill="#FF4F6E" stroke="#2A1748" stroke-width="8" stroke-linejoin="round"/><rect x="-74" y="-90" width="48" height="34" rx="6" fill="url(#metal)" stroke="#2A1748" stroke-width="7"/><rect x="26" y="-90" width="48" height="34" rx="6" fill="url(#metal)" stroke="#2A1748" stroke-width="7"/></g>`;
}

function shieldBubble(x, y, r) {
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="#8CE6FF" fill-opacity=".22" stroke="#BDF2FF" stroke-width="${r * 0.06}"/><path d="M${x - r * 0.6} ${y - r * 0.55} A${r * 0.8} ${r * 0.8} 0 0 1 ${x + r * 0.1} ${y - r * 0.9}" stroke="#FFFFFF" stroke-width="${r * 0.08}" fill="none" stroke-linecap="round" opacity=".85"/>`;
}

function container(kind, x, y, s) {
  // goo-bakjes: van klein bekertje tot tankwagen
  if (kind === 'cup') return `<g transform="translate(${x},${y}) scale(${s / 100})"><path d="M-55 -60 L55 -60 L42 70 L-42 70 Z" fill="#FFFFFF" stroke="#2A1748" stroke-width="8" stroke-linejoin="round"/><path d="M-50 -20 L50 -20 L42 70 L-42 70 Z" fill="url(#gooFill)"/><path d="M-62 -70 L62 -70 L58 -55 L-58 -55 Z" fill="#FF8AC8" stroke="#2A1748" stroke-width="7"/><path d="M15 -70 L35 -130" stroke="#FF4F6E" stroke-width="12" stroke-linecap="round"/></g>`;
  if (kind === 'bucket') return `<g transform="translate(${x},${y}) scale(${s / 100})"><path d="M-80 -70 C-60 -150 60 -150 80 -70" fill="none" stroke="url(#metal)" stroke-width="12"/><path d="M-80 -60 L80 -60 L65 70 L-65 70 Z" fill="#6EB8FF" stroke="#2A1748" stroke-width="8" stroke-linejoin="round"/><ellipse cx="0" cy="-60" rx="80" ry="18" fill="url(#gooFill)" stroke="#2A1748" stroke-width="7"/><path d="M-70 -55 C-75 -10 -60 10 -55 0 C-50 -20 -55 -40 -50 -55" fill="url(#gooFill)" stroke="#0E6B3E" stroke-width="5"/></g>`;
  if (kind === 'barrel') return `<g transform="translate(${x},${y}) scale(${s / 100})"><path d="M-70 -90 C-90 -30 -90 30 -70 90 L70 90 C90 30 90 -30 70 -90 Z" fill="url(#woodG)" stroke="#2A1748" stroke-width="8"/><path d="M-82 -40 L82 -40 M-82 40 L82 40" stroke="url(#metal)" stroke-width="14"/><ellipse cx="0" cy="-90" rx="70" ry="16" fill="url(#gooFill)" stroke="#2A1748" stroke-width="7"/><path d="M30 -88 C35 -40 25 -20 32 -10 C40 -25 40 -60 45 -86" fill="url(#gooFill)" stroke="#0E6B3E" stroke-width="5"/></g>`;
  return `<g transform="translate(${x},${y}) scale(${s / 100})"><rect x="-150" y="-60" width="200" height="100" rx="45" fill="url(#gooFill)" stroke="#2A1748" stroke-width="8"/><rect x="-140" y="-48" width="180" height="22" rx="11" fill="#FFFFFF" opacity=".4"/><path d="M50 -40 L110 -40 L140 0 L140 40 L50 40 Z" fill="#FF8AC8" stroke="#2A1748" stroke-width="8" stroke-linejoin="round"/><rect x="65" y="-30" width="40" height="28" rx="6" fill="#BDEBFF" stroke="#2A1748" stroke-width="5"/>${[-110, -20, 95].map(cx => `<circle cx="${cx}" cy="50" r="24" fill="#2A2638" stroke="#120E1E" stroke-width="6"/><circle cx="${cx}" cy="50" r="9" fill="url(#metal)"/>`).join('')}</g>`;
}

function fastForward(x, y, s) {
  return `<g transform="translate(${x},${y}) scale(${s / 100})">${[-40, 30].map(dx => `<path d="M${dx - 40} -55 L${dx + 35} 0 L${dx - 40} 55 Z" fill="#FFD447" stroke="#2A1748" stroke-width="8" stroke-linejoin="round"/>`).join('')}</g>`;
}

function bolt(x, y, s, col = '#FFE15A') {
  return `<path transform="translate(${x},${y}) scale(${s / 100})" d="M10 -100 L-45 10 L-5 10 L-25 100 L45 -20 L5 -20 Z" fill="${col}" stroke="#2A1748" stroke-width="8" stroke-linejoin="round"/>`;
}

function rainbowArc(x, y, r, wid) {
  const cols = ['#FF5E7E', '#FFB03B', '#FFF05A', '#5BF08E', '#4DB8FF', '#B06BFF'];
  return cols.map((c, i) => `<path d="M${x - r + i * wid} ${y} A${r - i * wid} ${r - i * wid} 0 0 1 ${x + r - i * wid} ${y}" fill="none" stroke="${c}" stroke-width="${wid}"/>`).join('');
}

function bg(w, h, c1, c2, seed = 3) {
  const gid = uid('bg');
  let s = `<defs>${radial(gid, [[0, c1], [1, c2]], '50%', '42%', '75%')}</defs><rect width="${w}" height="${h}" fill="url(#${gid})"/>`;
  // zachte lichtstralen en glitters
  for (let i = 0; i < 12; i++) s += `<path d="M${w / 2} ${h * 0.45} L${w / 2 + Math.cos(i / 12 * Math.PI * 2) * w} ${h * 0.45 + Math.sin(i / 12 * Math.PI * 2) * w} L${w / 2 + Math.cos((i + 0.45) / 12 * Math.PI * 2) * w} ${h * 0.45 + Math.sin((i + 0.45) / 12 * Math.PI * 2) * w} Z" fill="#FFFFFF" opacity=".07"/>`;
  const r = rand(seed);
  for (let i = 0; i < 14; i++) s += sparkle(r() * w, r() * h, 4 + r() * 9, 0.5 + r() * 0.4);
  return s;
}

if (typeof module !== 'undefined') module.exports = {};
