import { describe, expect, it } from "vitest";
import type { MarketInfo } from "../../src/core/types";
import {
  decimalsOf,
  formatDecimal,
  roundAmount,
  roundPrice,
  roundQuote,
  roundToStep,
  toPlainString,
  toSignificant,
} from "../../src/exchange/precision";

const btc: MarketInfo = {
  market: "BTC-EUR",
  base: "BTC",
  quote: "EUR",
  status: "trading",
  minOrderQuote: 5,
  minOrderBase: 0.0001,
  pricePrecision: 5,
  quantityDecimals: 8,
  notionalDecimals: 2,
};

describe("toSignificant", () => {
  it("rondt af op significante cijfers", () => {
    expect(toSignificant(64123.456, 5)).toBe(64123);
    expect(toSignificant(0.123456, 5)).toBe(0.12346);
    expect(toSignificant(0.123456, 5, "down")).toBe(0.12345);
    expect(toSignificant(0.123451, 5, "up")).toBe(0.12346);
    expect(toSignificant(1234567, 5)).toBe(1234600);
    expect(toSignificant(0.000012345678, 5)).toBe(0.000012346);
    expect(toSignificant(99999.6, 5)).toBe(100000);
    expect(toSignificant(0, 5)).toBe(0);
  });

  it("heeft geen last van float-artefacten", () => {
    expect(toSignificant(0.1 + 0.2, 5, "up")).toBe(0.3);
    expect(toSignificant(1.1 * 3, 2, "down")).toBe(3.3);
  });
});

describe("roundPrice", () => {
  it("gebruikt pricePrecision als er geen tickSize is", () => {
    expect(roundPrice(64123.789, btc)).toBe(64124);
    expect(roundPrice(64123.789, btc, "down")).toBe(64123);
    expect(roundPrice(1.234567, btc)).toBe(1.2346);
  });

  it("geeft de voorkeur aan tickSize", () => {
    const m = { ...btc, tickSize: 0.01 };
    expect(roundPrice(64123.789, m)).toBe(64123.79);
    expect(roundPrice(64123.789, m, "down")).toBe(64123.78);
    expect(roundPrice(64123.781, m, "up")).toBe(64123.79);
    expect(roundPrice(0.1 + 0.2, { ...btc, tickSize: 0.1 }, "down")).toBe(0.3);
    expect(roundPrice(12.37, { ...btc, tickSize: 0.05 }, "down")).toBe(12.35);
    expect(roundPrice(12345, { ...btc, tickSize: 5 }, "nearest")).toBe(12345);
    expect(roundPrice(12347.4, { ...btc, tickSize: 5 }, "nearest")).toBe(12345);
  });

  it("valt terug op 5 significante cijfers bij ongeldige pricePrecision", () => {
    expect(roundPrice(1.234567, { ...btc, pricePrecision: 0 })).toBe(1.2346);
  });
});

describe("roundAmount / roundQuote", () => {
  it("floort naar quantityDecimals", () => {
    expect(roundAmount(0.123456789, btc)).toBe(0.12345678);
    expect(roundAmount(1.99999999999, { ...btc, quantityDecimals: 2 })).toBe(1.99);
    expect(roundAmount(0.29, { ...btc, quantityDecimals: 2 })).toBe(0.29); // 0.29*100 = 28.999999999999996
    expect(roundAmount(0.1 + 0.2, { ...btc, quantityDecimals: 1 })).toBe(0.3);
    expect(roundAmount(123.9, { ...btc, quantityDecimals: 0 })).toBe(123);
  });

  it("floort naar notionalDecimals", () => {
    expect(roundQuote(10.999, btc)).toBe(10.99);
    expect(roundQuote(4.999999, btc)).toBe(4.99);
    expect(roundQuote(1.1 * 3, btc)).toBe(3.3);
    expect(roundQuote(19.99, btc)).toBe(19.99);
  });

  it("rondt grote hoeveelheden (meer dan 15 significante cijfers) nooit naar boven af", () => {
    // Voorheen: 12345678.1234568 (> saldo) → Bitvavo weigert de verkoop met 216.
    expect(roundAmount(12345678.12345678, btc)).toBe(12345678.12345678);
    expect(roundAmount(99999999.99999999, btc)).toBeLessThanOrEqual(99999999.99999999);
    expect(roundAmount(99999999.99999999, btc)).toBeLessThan(100000000);
    expect(roundAmount(10000000.99999999, btc)).toBe(10000000.99999999);
    expect(roundAmount(95658278.50981535, btc)).toBeLessThanOrEqual(95658278.50981535);
    expect(roundAmount(1234567.123456789, btc)).toBe(1234567.12345678);
    expect(roundAmount(12345678.123456789, btc)).toBeLessThanOrEqual(12345678.123456789);
  });

  it("laat saldo's met 8 decimalen ongewijzigd (willekeurige steekproef tot 9e7)", () => {
    let seed = 42;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    let above = 0;
    let changed = 0;
    for (const mag of [1e-4, 1, 1e4, 1e6, 1e7, 5e7, 9e7]) {
      for (let k = 0; k < 4000; k++) {
        const units = BigInt(Math.floor(rnd() * mag * 1e8));
        const s = `${units / 100000000n}.${(units % 100000000n).toString().padStart(8, "0")}`;
        const v = Number(s);
        const r = roundAmount(v, btc);
        if (r > v || Number(formatDecimal(r, 15)) > v) above++;
        if (r !== v) changed++;
      }
    }
    expect(above).toBe(0);
    expect(changed).toBe(0);
  });

  it("geeft 0 bij ongeldige invoer", () => {
    expect(roundAmount(Number.NaN, btc)).toBe(0);
    expect(roundAmount(-1, btc)).toBe(0);
    expect(roundQuote(Number.POSITIVE_INFINITY, btc)).toBe(0);
    expect(roundAmount(0.000000001, btc)).toBe(0);
  });
});

describe("formatDecimal", () => {
  it("gebruikt nooit exponent-notatie", () => {
    expect(formatDecimal(1e-7, 8)).toBe("0.0000001");
    expect(formatDecimal(0.00000123, 8)).toBe("0.00000123");
    expect(formatDecimal(1e21, 2)).toBe("1000000000000000000000");
    expect(formatDecimal(1.5e-10, 12)).toBe("0.00000000015");
  });

  it("verwijdert overbodige nullen en float-ruis", () => {
    expect(formatDecimal(1.5, 2)).toBe("1.5");
    expect(formatDecimal(10, 2)).toBe("10");
    expect(formatDecimal(0.1 + 0.2, 8)).toBe("0.3");
    expect(formatDecimal(123456789.123, 8)).toBe("123456789.123");
    expect(formatDecimal(0, 8)).toBe("0");
  });

  it("kapt af en rondt nooit naar boven", () => {
    expect(formatDecimal(1.23456789, 4)).toBe("1.2345");
    expect(formatDecimal(0.999, 2)).toBe("0.99");
    expect(formatDecimal(1e-9, 8)).toBe("0");
    expect(formatDecimal(-1.2399, 2)).toBe("-1.23");
  });

  it("schrijft getallen met 16-17 significante cijfers exact (niet naar boven afgerond)", () => {
    expect(formatDecimal(12345678.12345678, 15)).toBe("12345678.12345678");
    expect(formatDecimal(12345678.12345678, 8)).toBe("12345678.12345678");
    expect(formatDecimal(12345678.12345678, 7)).toBe("12345678.1234567");
    expect(formatDecimal(99999999.99999999, 15)).not.toBe("100000000");
    expect(Number(formatDecimal(99999999.99999999, 15))).toBeLessThanOrEqual(99999999.99999999);
    expect(toPlainString(12345678.12345678, true)).toBe("12345678.12345678");
    expect(toPlainString(12345678.12345678)).toBe("12345678.1234568"); // 15 significante cijfers
  });

  it("gooit bij NaN/Infinity", () => {
    expect(() => formatDecimal(Number.NaN, 2)).toThrow();
    expect(() => formatDecimal(Number.POSITIVE_INFINITY, 2)).toThrow();
  });
});

describe("helpers", () => {
  it("toPlainString / decimalsOf / roundToStep", () => {
    expect(toPlainString(1e-7)).toBe("0.0000001");
    expect(toPlainString(-0.5)).toBe("-0.5");
    expect(decimalsOf(0.001)).toBe(3);
    expect(decimalsOf(5)).toBe(0);
    expect(decimalsOf(1e-8)).toBe(8);
    expect(roundToStep(0.7, 0.1, "down")).toBe(0.7);
    expect(roundToStep(1.23456, 0.0001, "down")).toBe(1.2345);
  });
});
