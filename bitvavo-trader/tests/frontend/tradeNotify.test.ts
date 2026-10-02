/** Meldingen bij een gesloten trade (public/js/tradeNotify.js): tekst per exitReason en één toast per trade. */
import { describe, expect, it } from "vitest";
import { loadPublic } from "./helpers";

/** Intl zet een harde spatie tussen € en het bedrag */
const norm = (s: string) => s.replace(/\s+/g, " ");

describe("closedTradeMessage", () => {
  it("write-off: 'Afgeschreven: <markt> …' (geen 'Oefen-verkoop'/'Verkocht'), coins blijven op het account", async () => {
    const { closedTradeMessage } = await loadPublic("js/tradeNotify.js");
    const { fmt } = await loadPublic("js/format.js");
    const t = { id: "t1", market: "BTC-EUR", pnlQuote: -5.02, pnlPct: -100, exitReason: "write-off" };
    const [live, kind] = closedTradeMessage(t, fmt, "live");
    expect(norm(live)).toBe("Afgeschreven: BTC-EUR -€ 5,02 als verlies geboekt — de coins blijven op je Bitvavo-account");
    expect(kind).toBe("warn");
    const [paper] = closedTradeMessage(t, fmt, "paper");
    expect(norm(paper)).toBe("Afgeschreven: BTC-EUR -€ 5,02 als verlies geboekt — de coins blijven op je oefenaccount");
    expect(paper).not.toMatch(/Oefen-verkoop|Verkocht/);
  });

  it("gewone verkoop: 'Oefen-verkoop' (paper) / 'Verkocht' (live) met reden", async () => {
    const { closedTradeMessage } = await loadPublic("js/tradeNotify.js");
    const { fmt } = await loadPublic("js/format.js");
    const t = { id: "t2", market: "ETH-EUR", pnlQuote: 0.42, pnlPct: 2.1, exitReason: "take-profit" };
    expect(closedTradeMessage(t, fmt, "paper").map(norm)).toEqual(["Oefen-verkoop: ETH-EUR +€ 0,42 (+2,10%) · Take-profit", "success"]);
    expect(closedTradeMessage({ ...t, pnlQuote: -0.1, pnlPct: -0.5, exitReason: "stop-loss" }, fmt, "live").map(norm)).toEqual([
      "Verkocht: ETH-EUR -€ 0,10 (-0,50%) · Stop-loss",
      "warn",
    ]);
  });
});

describe("createTradeNotifier", () => {
  it("toont dezelfde trade (zelfde id) maar één keer; een andere trade wel", async () => {
    const { createTradeNotifier } = await loadPublic("js/tradeNotify.js");
    const { fmt } = await loadPublic("js/format.js");
    const shown: string[] = [];
    const notify = createTradeNotifier((m: string, k: string) => shown.push(`${k}: ${norm(m)}`), fmt, () => "paper");
    const t = { id: "trd_1", market: "SOL-EUR", pnlQuote: 0.1, pnlPct: 1, exitReason: "manual" };
    expect(notify(t)).toBe(true);
    expect(notify({ ...t })).toBe(false);
    expect(notify({ ...t, id: "trd_2" })).toBe(true);
    expect(shown).toEqual(["success: Oefen-verkoop: SOL-EUR +€ 0,10 (+1,00%) · Handmatig", "success: Oefen-verkoop: SOL-EUR +€ 0,10 (+1,00%) · Handmatig"]);
    expect(notify(null)).toBe(false);
  });
});
