// Gedeelde formatters (nl-NL). Alle panelen gebruiken deze i.p.v. eigen opmaak.

// Intl.NumberFormat aanmaken is duur (met 400 munten duizenden keren per update): hergebruiken
const nfCache = new Map();
const nf = (min, max) => {
  const key = `${min}|${max}`;
  let f = nfCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat("nl-NL", { minimumFractionDigits: min, maximumFractionDigits: max });
    nfCache.set(key, f);
  }
  return f;
};
const eurCache = new Map();
const eurNf = (digits) => {
  let f = eurCache.get(digits);
  if (!f) {
    f = new Intl.NumberFormat("nl-NL", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    eurCache.set(digits, f);
  }
  return f;
};

const isNum = (n) => typeof n === "number" && Number.isFinite(n);

export const fmt = {
  /** € 1.234,56 */
  eur(n, digits = 2) {
    if (!isNum(n)) return "–";
    return eurNf(digits).format(n);
  },
  /** +€ 1,23 / -€ 0,45 */
  eurSigned(n, digits = 2) {
    if (!isNum(n)) return "–";
    const s = fmt.eur(Math.abs(n), digits);
    return n > 0 ? `+${s}` : n < 0 ? `-${s}` : s;
  },
  /** +1,23% (signed standaard aan) */
  pct(n, digits = 2, signed = true) {
    if (!isNum(n)) return "–";
    const s = nf(digits, digits).format(n) + "%";
    return signed && n > 0 ? `+${s}` : s;
  },
  num(n, digits = 2) {
    if (!isNum(n)) return "–";
    return nf(0, digits).format(n);
  },
  /** Prijs met adaptieve decimalen: 64.123 → "64.123", 0,4567 → "0,4567" */
  price(n) {
    if (!isNum(n)) return "–";
    const a = Math.abs(n);
    const d = a >= 1000 ? 0 : a >= 100 ? 2 : a >= 1 ? 3 : a >= 0.01 ? 5 : 8;
    return nf(d, d).format(n);
  },
  /** Hoeveelheid base, max 8 decimalen */
  amount(n) {
    if (!isNum(n)) return "–";
    return nf(0, 8).format(n);
  },
  /** 14:32 */
  time(ms) {
    if (!isNum(ms)) return "–";
    return new Date(ms).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
  },
  /** 14:32:05 */
  timeSec(ms) {
    if (!isNum(ms)) return "–";
    return new Date(ms).toLocaleTimeString("nl-NL");
  },
  /** 28-09 14:32 */
  dateTime(ms) {
    if (!isNum(ms)) return "–";
    const d = new Date(ms);
    return `${d.toLocaleDateString("nl-NL", { day: "2-digit", month: "2-digit" })} ${fmt.time(ms)}`;
  },
  /** 28-09-2026 */
  date(ms) {
    if (!isNum(ms)) return "–";
    return new Date(ms).toLocaleDateString("nl-NL");
  },
  /** 3u 12m / 45s */
  duration(ms) {
    if (!isNum(ms)) return "–";
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 48) return `${h}u ${m % 60}m`;
    return `${Math.floor(h / 24)}d ${h % 24}u`;
  },
  /** CSS-klasse voor winst/verlies-kleur: "pos" | "neg" | "flat" */
  pnlClass(n) {
    if (!isNum(n) || Math.abs(n) < 1e-9) return "flat";
    return n > 0 ? "pos" : "neg";
  },
  /** Nederlandse labels */
  action(a) {
    return { buy: "KOOP", sell: "VERKOOP", hold: "WACHT" }[a] || a;
  },
  regime(r) {
    return (
      {
        "trend-up": "Stijgende trend",
        "trend-down": "Dalende trend",
        range: "Zijwaarts",
        volatile: "Volatiel",
        unknown: "Onbekend",
      }[r] || r
    );
  },
  exitReason(r) {
    return (
      {
        "stop-loss": "Stop-loss",
        "take-profit": "Take-profit",
        "trailing-stop": "Trailing stop",
        "break-even": "Break-even",
        signal: "Verkoopsignaal",
        "time-stop": "Tijdslimiet",
        manual: "Handmatig",
        "kill-switch": "Noodstop",
        "end-of-backtest": "Einde backtest",
        "write-off": "Afgeschreven",
        "daily-target": "Dagdoel",
      }[r] || r
    );
  },
};

/**
 * De markten die de bot volgt: `snapshot.activeMarkets ?? snapshot.config.markets`
 * (v2: bij automatische muntkeuze is dat de keuze van de bot, niet de eigen lijst).
 * `config` (optioneel) is een nieuwere config dan die in de snapshot (na "config-changed"):
 * bij zelf gekozen munten geldt die lijst dan meteen, zonder op de volgende snapshot te wachten.
 * @returns {string[]}
 */
export function botMarkets(snap, config = null) {
  const cfg = config || (snap && snap.config) || null;
  const own = cfg && Array.isArray(cfg.markets) ? cfg.markets : null;
  const active = snap && Array.isArray(snap.activeMarkets) ? snap.activeMarkets : null;
  const auto = !!(cfg && cfg.universe && cfg.universe.mode === "auto");
  // Nieuwere config met zelf gekozen munten: actieve markten = die lijst (ontdubbeld)
  if (config && own && !auto) return [...new Set(own)];
  return active ?? (own ? [...new Set(own)] : []);
}

/** Escape tekst voor veilig gebruik in innerHTML */
export function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
