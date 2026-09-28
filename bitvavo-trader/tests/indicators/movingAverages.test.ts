import { describe, expect, it } from "vitest";
import { ema, rma, sma, stdev } from "../../src/indicators";
import { expectClose, firstFinite, naiveEma, naiveSma, naiveStd, randomValues } from "./helpers";

describe("sma", () => {
  it("rekent een klein voorbeeld met de hand goed uit", () => {
    expectClose(sma([1, 2, 3, 4, 5], 3), [NaN, NaN, 2, 3, 4]);
    expectClose(sma([10, 20], 1), [10, 20]);
  });

  it("komt overeen met een naïeve implementatie op random data", () => {
    const v = randomValues(2000);
    for (const p of [1, 2, 5, 20, 50]) expectClose(sma(v, p), naiveSma(v, p), 1e-12);
  });

  it("blijft nauwkeurig bij hoge prijzen en lange reeksen (geen drift)", () => {
    const v = randomValues(30_000).map((x) => 60_000 + x * 10);
    const out = sma(v, 20);
    const ref = naiveSma(v, 20);
    for (let i = 19; i < v.length; i += 997) expect(out[i]).toBeCloseTo(ref[i], 8);
    expect(out[v.length - 1]).toBeCloseTo(ref[v.length - 1], 8);
  });

  it("is exact constant bij een constante reeks", () => {
    const out = sma(new Array(50).fill(0.1), 7);
    for (let i = 6; i < 50; i++) expect(out[i]).toBe(0.1);
  });

  it("geeft NaN voor vensters met een NaN", () => {
    const out = sma([1, 2, NaN, 4, 5, 6, 7], 2);
    expectClose(out, [NaN, 1.5, NaN, NaN, 4.5, 5.5, 6.5]);
  });
});

describe("ema", () => {
  it("seedt met het SMA en gebruikt alpha = 2/(p+1)", () => {
    // p=3 → alpha 0.5; seed (1+2+3)/3 = 2
    expectClose(ema([1, 2, 3, 4, 5, 6], 3), [NaN, NaN, 2, 3, 4, 5]);
    // p=2 → alpha 2/3; seed 3; 2/3·6 + 1/3·3 = 5; 2/3·8 + 5/3 = 7; 2/3·12 + 7/3 = 31/3
    expectClose(ema([2, 4, 6, 8, 12], 2), [NaN, 3, 5, 7, 31 / 3]);
  });

  it("komt overeen met de textbook-formule", () => {
    const v = randomValues(1500);
    for (const p of [1, 3, 9, 21, 200]) expectClose(ema(v, p), naiveEma(v, p), 1e-10);
  });

  it("verwerkt leidende NaN's (bijv. EMA van een MACD-lijn)", () => {
    expectClose(ema([NaN, NaN, 1, 2, 3, 4, 5, 6], 3), [NaN, NaN, NaN, NaN, 2, 3, 4, 5]);
    const v = randomValues(300);
    const lead = [...new Array(25).fill(NaN), ...v];
    const out = ema(lead, 9);
    expect(out.length).toBe(lead.length);
    expect(firstFinite(out)).toBe(25 + 8);
    expectClose(out.slice(25), naiveEma(v, 9), 1e-12);
  });

  it("start het seeden bij de eerste run van `period` eindige waarden", () => {
    // run 1 wordt door NaN afgebroken; seed op 2,3,4 → 3 op index 4
    expectClose(ema([1, NaN, 2, 3, 4, 5], 3), [NaN, NaN, NaN, NaN, 3, 4]);
  });

  it("geeft NaN op een NaN na het seeden en loopt daarna door", () => {
    const out = ema([1, 2, 3, NaN, 5], 3);
    expectClose(out, [NaN, NaN, 2, NaN, 3.5]);
  });

  it("is exact constant bij een constante reeks", () => {
    const out = ema(new Array(40).fill(0.3), 9);
    for (let i = 8; i < 40; i++) expect(out[i]).toBe(0.3);
  });
});

describe("rma (Wilder)", () => {
  it("gebruikt alpha = 1/period", () => {
    // seed (1+2+3)/3 = 2; daarna (2·2 + 6)/3 = 10/3
    expectClose(rma([1, 2, 3, 6], 3), [NaN, NaN, 2, 10 / 3]);
  });
});

describe("stdev", () => {
  it("is de populatie-standaarddeviatie", () => {
    const out = stdev([2, 4, 4, 4, 5, 5, 7, 9], 8);
    expect(out[7]).toBeCloseTo(2, 12);
    expectClose(stdev([1, 2, 3, 4, 5], 5), [NaN, NaN, NaN, NaN, Math.SQRT2]);
  });

  it("komt overeen met een naïeve implementatie, ook bij hoge prijzen", () => {
    const v = randomValues(3000);
    for (const p of [2, 5, 20]) expectClose(stdev(v, p), naiveStd(v, p), 1e-9);
    const high = v.map((x) => 65_000 + x);
    expectClose(stdev(high, 20), naiveStd(high, 20), 1e-7);
  });

  it("is exact 0 voor constante reeksen en nooit NaN na de warmup", () => {
    const flat = [...new Array(30).fill(100), ...new Array(30).fill(100.1), ...new Array(30).fill(0.1)];
    const out = stdev(flat, 10);
    for (let i = 9; i < flat.length; i++) expect(Number.isFinite(out[i])).toBe(true);
    for (const i of [29, 59, 89]) expect(out[i]).toBe(0);
  });
});
