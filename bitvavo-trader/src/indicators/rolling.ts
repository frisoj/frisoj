import { checkPeriod, rollingExtreme } from "./internal";

/** Hoogste waarde van values[i-period+1..i] (inclusief i). O(n). */
export function rollingMax(values: ArrayLike<number>, period: number): number[] {
  const p = checkPeriod("rollingMax", period);
  return rollingExtreme(values, p, true);
}

/** Laagste waarde van values[i-period+1..i] (inclusief i). O(n). */
export function rollingMin(values: ArrayLike<number>, period: number): number[] {
  const p = checkPeriod("rollingMin", period);
  return rollingExtreme(values, p, false);
}
