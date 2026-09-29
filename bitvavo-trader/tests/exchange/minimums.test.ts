import { describe, expect, it } from "vitest";
import { EXCHANGE_MIN_ORDER_QUOTE } from "../../src/core/defaults";
import { exchangeMinBase, exchangeMinQuote } from "../../src/exchange/minimums";

describe("beursminima (één regel voor brokers, backtest en risk)", () => {
  it("exchangeMinQuote: geldig (eindig, > 0) minimum uit de marktinfo, anders EXCHANGE_MIN_ORDER_QUOTE", () => {
    expect(EXCHANGE_MIN_ORDER_QUOTE).toBe(5);
    expect(exchangeMinQuote({ minOrderQuote: 5 })).toBe(5);
    expect(exchangeMinQuote({ minOrderQuote: 10 })).toBe(10);
    expect(exchangeMinQuote({ minOrderQuote: 1 })).toBe(1);
    for (const bad of [0, -0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, undefined, null, "5"]) {
      expect(exchangeMinQuote({ minOrderQuote: bad })).toBe(EXCHANGE_MIN_ORDER_QUOTE);
    }
    expect(exchangeMinQuote(undefined)).toBe(EXCHANGE_MIN_ORDER_QUOTE);
    expect(exchangeMinQuote(null)).toBe(EXCHANGE_MIN_ORDER_QUOTE);
    expect(exchangeMinQuote({})).toBe(EXCHANGE_MIN_ORDER_QUOTE);
  });

  it("exchangeMinBase: geldig minimum in base, anders 0 (dan telt alleen het EUR-minimum)", () => {
    expect(exchangeMinBase({ minOrderBase: 0.001 })).toBe(0.001);
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, undefined, null]) {
      expect(exchangeMinBase({ minOrderBase: bad })).toBe(0);
    }
    expect(exchangeMinBase(undefined)).toBe(0);
  });
});
