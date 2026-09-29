/** Noodstop in de header (public/js/header.js): echte module, nep-DOM, nep-API. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeNode, loadPublic, makeBus, settle, type Fake } from "./helpers";

const snapshot = (positions: Fake[], running = true) => ({
  running,
  mode: "paper",
  liveArmed: false,
  account: { equity: 50, cashQuote: 45 },
  config: { pollMs: 15000, risk: { minOrderQuote: 5, maxOpenPositions: 2 } },
  positions,
  trades: [],
});
/** Intl zet een harde spatie tussen € en het bedrag */
const norm = (s: string) => s.replace(/\s/g, " ");
const dust = { id: "p1", market: "SOL-EUR", amount: 4.9875 / 270, currentPrice: 264.84, entryPrice: 270 };
const big = { id: "p2", market: "BTC-EUR", amount: 0.0005, currentPrice: 60000, entryPrice: 59000 };

beforeEach(() => {
  vi.spyOn(globalThis, "setInterval").mockImplementation((() => 0) as unknown as typeof setInterval);
});
afterEach(() => vi.restoreAllMocks());

async function mount(initial: Fake, killResult: Fake) {
  const { mountHeader } = await loadPublic("js/header.js");
  const { fmt, esc } = await loadPublic("js/format.js");
  const bus = makeBus();
  const toasts: string[] = [];
  const modals: Fake[] = [];
  let state = initial;
  const buttons: Record<string, Fake> = {};
  const controlsEl = fakeNode({
    querySelector: (sel: string) => {
      const act = /data-act="(\w+)"/.exec(sel)?.[1] ?? sel;
      return (buttons[act] ||= fakeNode({ dataset: { act } }));
    },
  });
  const api = {
    kill: vi.fn(async () => {
      if (killResult instanceof Error) throw killResult;
      state = killResult;
      return killResult;
    }),
    getState: vi.fn(async () => state),
  };
  const ctx = {
    fmt,
    esc,
    api,
    bus,
    getState: () => initial,
    toast: (m: string, k: string) => toasts.push(`${k}: ${m}`),
    openModal: (o: Fake) => {
      modals.push(o);
      return () => {};
    },
  };
  mountHeader(ctx, { statsEl: null, controlsEl, bannerEl: null });
  const pressKill = () => {
    const b = controlsEl.querySelector('[data-act="kill"]');
    controlsEl.fire("click", { target: { closest: () => b } });
    return modals[modals.length - 1];
  };
  return { pressKill, toasts, api, bus };
}

describe("killOutcome", () => {
  it("alles verkocht → waarschuwing 'alles verkocht'", async () => {
    const { killOutcome } = await loadPublic("js/header.js");
    const { fmt } = await loadPublic("js/format.js");
    expect(killOutcome(snapshot([], false), fmt)).toEqual(["Noodstop uitgevoerd — alles verkocht, bot gestopt", "warn"]);
  });

  it("positie onder €5 blijft staan → fout met markt, waarde en uitleg", async () => {
    const { killOutcome } = await loadPublic("js/header.js");
    const { fmt } = await loadPublic("js/format.js");
    const [raw, kind] = killOutcome(snapshot([dust], false), fmt);
    const msg = norm(raw);
    expect(kind).toBe("error");
    expect(msg).toContain("1 positie NIET verkocht");
    expect(msg).toContain("SOL-EUR ≈ € 4,89");
    expect(msg).toContain("Bitvavo-minimum");
    expect(msg).toContain("de bot staat stil");
    expect(msg).not.toContain("alles verkocht");
  });
});

describe("Noodstop-knop", () => {
  it("zegt NIET 'alles verkocht' als er een positie open bleef; de modal blijft open met de fout", async () => {
    const h = await mount(snapshot([dust]), snapshot([dust], false));
    const modal = h.pressKill();
    expect(modal.title).toBe("Noodstop");
    // vooraf gewaarschuwd dat deze positie niet verkocht kan worden
    expect(modal.bodyHtml).toContain("niet verkocht");
    const err = await modal.onConfirm().catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(norm(err.message)).toContain("NIET verkocht (SOL-EUR ≈ € 4,89)");
    expect(h.api.kill).toHaveBeenCalledTimes(1);
    expect(h.toasts.some((t) => t.includes("alles verkocht"))).toBe(false);
    // de gestopte staat is wel doorgegeven aan het dashboard
    expect(h.bus.emitted.some((e) => e.type === "snapshot" && (e.data as Fake).running === false)).toBe(true);
  });

  it("alles verkocht → modal sluit en toast 'alles verkocht'", async () => {
    const h = await mount(snapshot([big]), snapshot([], false));
    const modal = h.pressKill();
    expect(modal.bodyHtml).not.toContain("niet verkocht");
    await expect(modal.onConfirm()).resolves.toBeUndefined();
    expect(h.toasts).toContain("warn: Noodstop uitgevoerd — alles verkocht, bot gestopt");
  });

  it("serverfout (bijv. 409) → fout in de modal en de staat wordt ververst", async () => {
    const h = await mount(snapshot([dust]), new Error("Noodstop: 1 positie niet gesloten"));
    const modal = h.pressKill();
    await expect(modal.onConfirm()).rejects.toThrow("Noodstop: 1 positie niet gesloten");
    await settle();
    expect(h.api.getState).toHaveBeenCalled();
    expect(h.toasts.some((t) => t.includes("alles verkocht"))).toBe(false);
  });
});

describe("killOutcome met killResult van de server", () => {
  const withKill = (positions: Fake[], failed: Fake[], closed = 0) => ({ ...snapshot(positions, false), killResult: { closed, failed } });

  it("noemt precies welke posities niet verkocht zijn en waarom", async () => {
    const { killOutcome } = await loadPublic("js/header.js");
    const { fmt } = await loadPublic("js/format.js");
    const res = withKill(
      [dust, big],
      [
        { id: "p1", market: "SOL-EUR", reason: "onverkoopbaar: waarde € 4,89 is onder het minimum van € 5,00" },
        { id: "p2", market: "BTC-EUR", reason: "verkooporder afgewezen: rate limit" },
      ],
    );
    const [raw, kind] = killOutcome(res, fmt);
    const msg = norm(raw);
    expect(kind).toBe("error");
    expect(msg).toContain("2 posities NIET verkocht");
    expect(msg).toContain("SOL-EUR ≈ € 4,89: onverkoopbaar: waarde € 4,89 is onder het minimum van € 5,00");
    expect(msg).toContain("BTC-EUR ≈ € 30,00: verkooporder afgewezen: rate limit");
    // positie onder het minimum → uitleg over wachten/afschrijven
    expect(msg).toContain("schrijf hem af");
    expect(msg).toContain("de bot staat stil");
  });

  it("toont ook een kooporder met onbekende uitkomst (geen positie in de snapshot)", async () => {
    const { killOutcome } = await loadPublic("js/header.js");
    const { fmt } = await loadPublic("js/format.js");
    const res = withKill([], [{ id: "bvt-abc", market: "ETH-EUR", reason: "kooporder met onbekende uitkomst: controleer Bitvavo" }], 1);
    const [raw, kind] = killOutcome(res, fmt);
    expect(kind).toBe("error");
    expect(norm(raw)).toContain("1 positie NIET verkocht — ETH-EUR: kooporder met onbekende uitkomst: controleer Bitvavo");
    expect(raw).not.toContain("alles verkocht");
  });

  it("failed leeg en niets meer open → 'alles verkocht'", async () => {
    const { killOutcome } = await loadPublic("js/header.js");
    const { fmt } = await loadPublic("js/format.js");
    expect(killOutcome(withKill([], [], 2), fmt)).toEqual(["Noodstop uitgevoerd — alles verkocht, bot gestopt", "warn"]);
  });

  it("failed leeg maar er staan nog posities open → valt terug op de posities (nooit 'alles verkocht')", async () => {
    const { killOutcome } = await loadPublic("js/header.js");
    const { fmt } = await loadPublic("js/format.js");
    const [raw, kind] = killOutcome(withKill([dust], []), fmt);
    expect(kind).toBe("error");
    expect(norm(raw)).toContain("NIET verkocht (SOL-EUR ≈ € 4,89)");
  });

  it("de knop toont de reden uit killResult in de modal", async () => {
    const res = withKill([big], [{ id: "p2", market: "BTC-EUR", reason: "uitkomst onbekend (time-out)" }]);
    const h = await mount(snapshot([big]), res);
    const modal = h.pressKill();
    const err = await modal.onConfirm().catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(norm(err.message)).toContain("BTC-EUR ≈ € 30,00: uitkomst onbekend (time-out)");
  });

  it("de modal waarschuwt vooraf voor een positie die de engine als onverkoopbaar markeert", async () => {
    // Waarde boven €5, maar de engine weet beter (bijv. minimum in base-eenheden)
    const flagged = { ...big, unsellable: true, unsellableReason: "Onverkoopbaar: onder het minimum in BTC" };
    const h = await mount(snapshot([flagged]), snapshot([], false));
    const modal = h.pressKill();
    expect(modal.bodyHtml).toContain("niet verkocht");
    expect(modal.bodyHtml).toContain("BTC-EUR");
  });
});
