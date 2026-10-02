import type { Candle } from "../core/types";
import { checkPeriod, nanArray } from "./internal";

export interface AdxResult {
  adx: number[];
  plusDI: number[];
  minusDI: number[];
}

/**
 * Average Directional Index (Wilder). +DM/−DM en TR vanaf candle 1, Wilder-
 * gesmoothed (eerste waarde = som van de eerste `period` waarden). +DI/−DI
 * vanaf index `period`, DX = 100·|+DI − −DI|/(+DI + −DI), ADX = Wilder-
 * gemiddelde van DX met de eerste waarde op index 2·period − 1.
 * Geen beweging (TR = 0) → DI = 0, DX = 0.
 */
export function adx(candles: ArrayLike<Candle>, period = 14): AdxResult {
  const p = checkPeriod("adx", period);
  const n = candles.length;
  const adxOut = nanArray(n);
  const plusDI = nanArray(n);
  const minusDI = nanArray(n);
  if (n <= p) return { adx: adxOut, plusDI, minusDI };

  let sTR = 0;
  let sP = 0;
  let sM = 0;
  let count = 0;
  let dxSum = 0;
  let dxCount = 0;
  let a = 0;
  for (let i = 1; i < n; i++) {
    const c = candles[i];
    const pv = candles[i - 1];
    const up = c.high - pv.high;
    const down = pv.low - c.low;
    const pdm = up > down && up > 0 ? up : 0;
    const mdm = down > up && down > 0 ? down : 0;
    let tr = c.high - c.low;
    const x = Math.abs(c.high - pv.close);
    const y = Math.abs(c.low - pv.close);
    if (x > tr) tr = x;
    if (y > tr) tr = y;

    if (count < p) {
      sTR += tr;
      sP += pdm;
      sM += mdm;
      if (++count < p) continue;
    } else {
      sTR = sTR - sTR / p + tr;
      sP = sP - sP / p + pdm;
      sM = sM - sM / p + mdm;
    }

    const pdi = sTR > 0 ? (100 * sP) / sTR : 0;
    const mdi = sTR > 0 ? (100 * sM) / sTR : 0;
    plusDI[i] = pdi;
    minusDI[i] = mdi;
    const diSum = pdi + mdi;
    const dx = diSum > 0 ? (100 * Math.abs(pdi - mdi)) / diSum : 0;

    if (dxCount < p) {
      dxSum += dx;
      if (++dxCount === p) {
        a = dxSum / p;
        adxOut[i] = a;
      }
    } else {
      a = (a * (p - 1) + dx) / p;
      adxOut[i] = a;
    }
  }
  return { adx: adxOut, plusDI, minusDI };
}
