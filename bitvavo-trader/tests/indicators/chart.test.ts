import { describe, expect, it } from "vitest";
import { atr, bollinger, chartIndicators, closes, ema, macd, rsi, toNullable, vwap } from "../../src/indicators";
import { randomCandles } from "./helpers";

describe("chartIndicators", () => {
  const cs = randomCandles(400);
  const ind = chartIndicators(cs);
  const keys = [
    "emaFast",
    "emaSlow",
    "ema200",
    "bbUpper",
    "bbMiddle",
    "bbLower",
    "vwap",
    "rsi",
    "macd",
    "macdSignal",
    "macdHist",
    "atr",
  ] as const;

  it("heeft alle reeksen, even lang als de candles, zonder NaN (null tijdens warmup)", () => {
    expect(Object.keys(ind).sort()).toEqual([...keys].sort());
    for (const k of keys) {
      expect(ind[k].length).toBe(cs.length);
      for (const x of ind[k]) expect(x === null || Number.isFinite(x)).toBe(true);
    }
  });

  it("gebruikt de afgesproken periodes", () => {
    const c = closes(cs);
    const bb = bollinger(c, 20, 2);
    const m = macd(c, 12, 26, 9);
    expect(ind.emaFast).toEqual(toNullable(ema(c, 9)));
    expect(ind.emaSlow).toEqual(toNullable(ema(c, 21)));
    expect(ind.ema200).toEqual(toNullable(ema(c, 200)));
    expect(ind.bbUpper).toEqual(toNullable(bb.upper));
    expect(ind.bbMiddle).toEqual(toNullable(bb.middle));
    expect(ind.bbLower).toEqual(toNullable(bb.lower));
    expect(ind.vwap).toEqual(toNullable(vwap(cs)));
    expect(ind.rsi).toEqual(toNullable(rsi(c, 14)));
    expect(ind.macd).toEqual(toNullable(m.macd));
    expect(ind.macdSignal).toEqual(toNullable(m.signal));
    expect(ind.macdHist).toEqual(toNullable(m.histogram));
    expect(ind.atr).toEqual(toNullable(atr(cs, 14)));
  });

  it("null-telling tijdens warmup", () => {
    const nulls = (a: (number | null)[]) => a.filter((x) => x === null).length;
    expect(nulls(ind.emaFast)).toBe(8);
    expect(nulls(ind.emaSlow)).toBe(20);
    expect(nulls(ind.ema200)).toBe(199);
    expect(nulls(ind.bbUpper)).toBe(19);
    expect(nulls(ind.vwap)).toBe(0);
    expect(nulls(ind.rsi)).toBe(14);
    expect(nulls(ind.macd)).toBe(25);
    expect(nulls(ind.macdSignal)).toBe(33);
    expect(nulls(ind.macdHist)).toBe(33);
    expect(nulls(ind.atr)).toBe(13);
  });

  it("is JSON-veilig (null blijft null)", () => {
    const back = JSON.parse(JSON.stringify(chartIndicators(cs.slice(0, 30))));
    expect(back.ema200.every((x: unknown) => x === null)).toBe(true);
    expect(back.emaFast[8]).toBeTypeOf("number");
  });

  it("lege invoer → lege reeksen", () => {
    const empty = chartIndicators([]);
    for (const k of keys) expect(empty[k]).toEqual([]);
  });

  it("toNullable zet NaN en Infinity om naar null", () => {
    expect(toNullable([NaN, 1, Infinity, -Infinity, 0])).toEqual([null, 1, null, null, 0]);
  });
});
