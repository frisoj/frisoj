import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PersistedState } from "../../src/core/types";
import { StateStore, isPersistedState } from "../../src/engine/stateStore";

function state(cash: number): PersistedState {
  return {
    version: 1,
    mode: "paper",
    savedAt: 1,
    account: {
      startingEquity: 50,
      cashQuote: cash,
      equity: cash,
      dayStartEquity: 50,
      dayKey: "2026-01-05",
      realizedPnl: 0,
      realizedPnlToday: 0,
      unrealizedPnl: 0,
      feesPaid: 0,
      tradesToday: 0,
      lastLossAt: {},
    },
    positions: [],
    trades: [],
    equityHistory: [{ time: 1, equity: cash }],
    paperBalances: [{ symbol: "EUR", available: cash, inOrder: 0 }],
  };
}

describe("StateStore", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "statestore-"));
  });
  afterEach(() => {
    vi.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  });

  it("load() geeft null als er geen bestand is", () => {
    expect(new StateStore(join(dir, "nope.json")).load()).toBeNull();
  });

  it("save() is gedebounced en schrijft de laatste staat; flush() schrijft direct", async () => {
    vi.useFakeTimers();
    const file = join(dir, "a", "b", "state.json"); // mkdir -p
    const store = new StateStore(file);
    store.save(state(10));
    store.save(state(20));
    expect(existsSync(file)).toBe(false);
    expect(store.hasPending).toBe(true);
    await vi.advanceTimersByTimeAsync(499);
    expect(existsSync(file)).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(existsSync(file)).toBe(true);
    expect(store.load()!.account.cashQuote).toBe(20);

    store.save(state(30));
    store.flush();
    expect(store.load()!.account.cashQuote).toBe(30);
    expect(store.hasPending).toBe(false);
    // geen tijdelijke bestanden achtergebleven
    expect(readdirSync(join(dir, "a", "b"))).toEqual(["state.json"]);
  });

  it("blijft schrijven bij voortdurende saves (throttle, geen eindeloze debounce)", async () => {
    vi.useFakeTimers();
    const file = join(dir, "state.json");
    const store = new StateStore(file, { debounceMs: 500 });
    for (let i = 0; i < 10; i++) {
      store.save(state(i));
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(existsSync(file)).toBe(true);
  });

  it("round-trip behoudt alle velden", () => {
    const file = join(dir, "state.json");
    const store = new StateStore(file);
    const s = state(42);
    store.save(s);
    store.flush();
    expect(new StateStore(file).load()).toEqual(s);
    expect(JSON.parse(readFileSync(file, "utf8")).version).toBe(1);
  });

  it("corrupte JSON → null en hernoemd naar .corrupt-<ts>", () => {
    const file = join(dir, "state.json");
    writeFileSync(file, "{{{ kapot");
    const store = new StateStore(file, { now: () => 1234 });
    expect(store.load()).toBeNull();
    expect(existsSync(file)).toBe(false);
    expect(existsSync(`${file}.corrupt-1234`)).toBe(true);
    // daarna gewoon weer opslaan
    store.save(state(5));
    store.flush();
    expect(store.load()!.account.cashQuote).toBe(5);
  });

  it("geldige JSON met verkeerde vorm telt ook als corrupt", () => {
    const file = join(dir, "state.json");
    writeFileSync(file, JSON.stringify({ version: 2, hello: "world" }));
    expect(new StateStore(file, { now: () => 99 }).load()).toBeNull();
    expect(existsSync(`${file}.corrupt-99`)).toBe(true);
  });

  it("isPersistedState controleert de structuur", () => {
    expect(isPersistedState(state(1))).toBe(true);
    expect(isPersistedState(null)).toBe(false);
    expect(isPersistedState({ ...state(1), mode: "demo" })).toBe(false);
    expect(isPersistedState({ ...state(1), positions: "x" })).toBe(false);
  });

  it("flush() gooit bij een schrijffout maar houdt de staat vast voor een nieuwe poging", () => {
    const blocker = join(dir, "file");
    writeFileSync(blocker, "x");
    const store = new StateStore(join(blocker, "state.json")); // map kan niet gemaakt worden
    store.save(state(1));
    expect(() => store.flush()).toThrow();
    expect(store.lastError).not.toBeNull();
    expect(store.hasPending).toBe(true);
  });
});
