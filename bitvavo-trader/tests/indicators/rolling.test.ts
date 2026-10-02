import { describe, expect, it } from "vitest";
import { rollingMax, rollingMin } from "../../src/indicators";
import { mulberry32 } from "../../src/core/util";
import { expectClose, naiveRollingMax, naiveRollingMin, randomValues } from "./helpers";

describe("rollingMax / rollingMin", () => {
  it("komt overeen met een naïeve O(n·k) versie op random data", () => {
    const v = randomValues(3000, 11);
    for (const p of [1, 2, 3, 10, 57, 200]) {
      expectClose(rollingMax(v, p), naiveRollingMax(v, p), 0);
      expectClose(rollingMin(v, p), naiveRollingMin(v, p), 0);
    }
  });

  it("werkt met veel gelijke waarden (duplicaten)", () => {
    const rnd = mulberry32(5);
    const v = Array.from({ length: 2000 }, () => Math.floor(rnd() * 4));
    for (const p of [2, 5, 13]) {
      expectClose(rollingMax(v, p), naiveRollingMax(v, p), 0);
      expectClose(rollingMin(v, p), naiveRollingMin(v, p), 0);
    }
  });

  it("monotone reeksen", () => {
    const up = Array.from({ length: 50 }, (_, i) => i);
    expectClose(rollingMax(up, 5), naiveRollingMax(up, 5), 0);
    expectClose(rollingMin(up, 5), naiveRollingMin(up, 5), 0);
    const down = up.map((x) => -x);
    expectClose(rollingMax(down, 5), naiveRollingMax(down, 5), 0);
    expectClose(rollingMin(down, 5), naiveRollingMin(down, 5), 0);
  });

  it("vensters met NaN geven NaN, daarna herstelt het", () => {
    const out = rollingMax([1, 5, NaN, 2, 3, 1], 2);
    expectClose(out, [NaN, 5, NaN, NaN, 3, 3]);
    expect(rollingMin([4, 3], 3)).toEqual([NaN, NaN]);
  });
});
