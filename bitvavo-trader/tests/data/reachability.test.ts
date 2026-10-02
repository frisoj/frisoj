import { describe, expect, it } from "vitest";
import { isBitvavoReachable } from "../../src/data/reachability";
import type { BitvavoClient } from "../../src/exchange/bitvavoClient";

const asClient = (time: () => Promise<number>): BitvavoClient => ({ time }) as unknown as BitvavoClient;

describe("isBitvavoReachable", () => {
  it("true als time() een geldige tijd teruggeeft", async () => {
    expect(await isBitvavoReachable(asClient(async () => Date.now()))).toBe(true);
  });

  it("false als time() faalt (zonder te gooien)", async () => {
    expect(await isBitvavoReachable(asClient(async () => Promise.reject(new Error("ENOTFOUND"))))).toBe(false);
    const throwsSync = asClient(() => {
      throw new Error("kapot");
    });
    expect(await isBitvavoReachable(throwsSync)).toBe(false);
    expect(await isBitvavoReachable(asClient(async () => Number.NaN))).toBe(false);
  });

  it("false na de timeout als time() blijft hangen", async () => {
    const t0 = Date.now();
    const hanging = asClient(() => new Promise<number>(() => {}));
    expect(await isBitvavoReachable(hanging, 50)).toBe(false);
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(40);
    expect(elapsed).toBeLessThan(2000);
  });

  it("true als het antwoord binnen de timeout komt", async () => {
    const slow = asClient(() => new Promise<number>((r) => setTimeout(() => r(1_790_000_000_000), 20)));
    expect(await isBitvavoReachable(slow, 1000)).toBe(true);
  });
});
