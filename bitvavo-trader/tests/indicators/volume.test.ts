import { describe, expect, it } from "vitest";
import { obv, vwap } from "../../src/indicators";
import { candle, expectClose, naiveVwap, randomCandles } from "./helpers";

const H = 3_600_000;

describe("vwap", () => {
  it("reset om 00:00 UTC", () => {
    const day1 = Date.UTC(2024, 4, 1);
    const day2 = Date.UTC(2024, 4, 2);
    const cs = [
      candle(day1 + 22 * H, 12, 9, 9, 2), // tp 10
      candle(day1 + 23 * H, 22, 19, 19, 3), // tp 20
      candle(day2, 33, 29, 28, 5), // tp 30 → nieuwe sessie
      candle(day2 + H, 42, 39, 39, 5), // tp 40
    ];
    const out = vwap(cs);
    expect(out[0]).toBeCloseTo(10, 12);
    expect(out[1]).toBeCloseTo((10 * 2 + 20 * 3) / 5, 12);
    expect(out[2]).toBeCloseTo(30, 12);
    expect(out[3]).toBeCloseTo(35, 12);
  });

  it("gebruikt de typical price als het cumulatieve volume 0 is", () => {
    const t = Date.UTC(2024, 0, 1);
    const cs = [candle(t, 12, 6, 9, 0), candle(t + H, 15, 9, 12, 0), candle(t + 2 * H, 30, 30, 30, 1), candle(t + 3 * H, 10, 10, 10, 0)];
    const out = vwap(cs);
    expect(out[0]).toBe(9);
    expect(out[1]).toBe(12);
    expect(out[2]).toBe(30);
    expect(out[3]).toBe(30); // volume 0 verandert de VWAP niet
    for (const x of out) expect(Number.isFinite(x)).toBe(true);
  });

  it("komt overeen met een naïeve implementatie (meerdere dagen, 15m)", () => {
    const cs = randomCandles(1000, 9, Date.UTC(2024, 0, 1, 17, 0));
    expectClose(vwap(cs), naiveVwap(cs), 1e-10);
  });
});

describe("obv", () => {
  it("telt volume op/af op basis van de slotkoers", () => {
    const cs = [
      candle(0, 1, 1, 10, 5),
      candle(1, 1, 1, 11, 3), // +3
      candle(2, 1, 1, 11, 7), // gelijk
      candle(3, 1, 1, 9, 2), // −2
      candle(4, 1, 1, 12, 4), // +4
    ];
    expect(obv(cs)).toEqual([0, 3, 3, 1, 5]);
  });
});
