/**
 * Interne hulpfuncties voor de indicatorbibliotheek (niet re-geëxporteerd).
 */

/**
 * Valideert een periode. Gooit een duidelijke Error bij een periode < 1 of een
 * niet-eindige waarde. Niet-gehele periodes worden naar beneden afgerond.
 */
export function checkPeriod(fn: string, period: number, name = "periode"): number {
  if (typeof period !== "number" || !Number.isFinite(period) || period < 1) {
    throw new Error(
      `Ongeldige ${name} voor ${fn}: ${String(period)} (moet een geheel getal >= 1 zijn)`,
    );
  }
  return Math.floor(period);
}

/** Nieuwe array van lengte n gevuld met NaN (packed double array). */
export function nanArray(n: number): number[] {
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = NaN;
  return out;
}

/** True voor eindige getallen (niet NaN/±Infinity). */
export function isNum(x: number): boolean {
  return Number.isFinite(x);
}

/**
 * Exponentieel voortschrijdend gemiddelde met willekeurige alpha, geseed met
 * het SMA van de eerste `p` opeenvolgende eindige waarden (op de index waar die
 * run compleet is). Na het seeden levert een niet-eindige invoer NaN op die
 * index op; de toestand blijft dan behouden en loopt door bij de volgende
 * eindige waarde.
 */
export function expSmooth(values: ArrayLike<number>, p: number, alpha: number): number[] {
  const n = values.length;
  const out = nanArray(n);
  let run = 0;
  let seeded = false;
  let e = 0;
  for (let i = 0; i < n; i++) {
    const x = values[i];
    if (!Number.isFinite(x)) {
      run = 0;
      continue;
    }
    if (seeded) {
      // e += alpha·(x − e) houdt constante reeksen exact constant
      e += alpha * (x - e);
      out[i] = e;
      continue;
    }
    run++;
    if (run === p) {
      const start = i - p + 1;
      const k = values[start];
      let s = 0;
      for (let j = start; j <= i; j++) s += values[j] - k;
      e = k + s / p;
      seeded = true;
      out[i] = e;
    }
  }
  return out;
}

/**
 * Voortschrijdend gemiddelde en (populatie-)standaarddeviatie in O(n).
 *
 * Numeriek robuust: sommen worden bijgehouden relatief t.o.v. een referentie-
 * waarde K (verschoven sommen, voorkomt catastrofale cancellatie bij hoge
 * prijzen), en elke `p` stappen exact opnieuw berekend over het venster
 * (voorkomt drift; kost O(p) per p stappen = O(n) totaal). Een venster met een
 * niet-eindige waarde levert NaN op.
 */
export function rollingStats(
  values: ArrayLike<number>,
  p: number,
  wantStd: boolean,
): { mean: number[]; std: number[] | null } {
  const n = values.length;
  const mean = nanArray(n);
  const std = wantStd ? nanArray(n) : null;
  if (n < p) return { mean, std };

  let k = 0;
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(values[i])) {
      k = values[i];
      break;
    }
  }

  let s1 = 0;
  let s2 = 0;
  let bad = 0;
  let sinceSync = 0;
  for (let i = 0; i < n; i++) {
    const x = values[i];
    if (Number.isFinite(x)) {
      const d = x - k;
      s1 += d;
      s2 += d * d;
    } else {
      bad++;
    }
    if (i >= p) {
      const y = values[i - p];
      if (Number.isFinite(y)) {
        const d = y - k;
        s1 -= d;
        s2 -= d * d;
      } else {
        bad--;
      }
    }
    if (i < p - 1) continue;

    if (++sinceSync >= p) {
      sinceSync = 0;
      if (Number.isFinite(x)) k = x;
      s1 = 0;
      s2 = 0;
      for (let j = i - p + 1; j <= i; j++) {
        const v = values[j];
        if (Number.isFinite(v)) {
          const d = v - k;
          s1 += d;
          s2 += d * d;
        }
      }
    }

    if (bad === 0) {
      const m = s1 / p;
      const mu = k + m;
      mean[i] = mu;
      if (std) {
        const variance = s2 / p - m * m;
        let sd = variance > 0 ? Math.sqrt(variance) : 0;
        // Ruisvloer: relatieve spreiding < 1e-10 is afrondingsruis (bijv. constante reeks)
        if (sd <= Math.abs(mu) * 1e-10) sd = 0;
        std[i] = sd;
      }
    }
  }
  return { mean, std };
}

/**
 * Voortschrijdend maximum (isMax) of minimum over `p` waarden (inclusief i),
 * O(n) via een monotone deque. Een venster met een niet-eindige waarde → NaN.
 */
export function rollingExtreme(values: ArrayLike<number>, p: number, isMax: boolean): number[] {
  const n = values.length;
  const out = nanArray(n);
  if (n < p) return out;
  const dq = new Int32Array(n);
  let head = 0;
  let tail = 0;
  let bad = 0;
  for (let i = 0; i < n; i++) {
    const x = values[i];
    if (Number.isFinite(x)) {
      if (isMax) {
        while (tail > head && values[dq[tail - 1]] <= x) tail--;
      } else {
        while (tail > head && values[dq[tail - 1]] >= x) tail--;
      }
      dq[tail++] = i;
    } else {
      bad++;
    }
    if (i >= p && !Number.isFinite(values[i - p])) bad--;
    const lo = i - p;
    while (tail > head && dq[head] <= lo) head++;
    if (i >= p - 1 && bad === 0) out[i] = values[dq[head]];
  }
  return out;
}
