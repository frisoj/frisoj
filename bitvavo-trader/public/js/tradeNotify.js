// Meldingen (toasts) bij een gesloten trade. Eén bron voor zowel het SSE-event
// "position-closed" als het antwoord van een handmatige sluiting/afschrijving,
// zodat dezelfde trade nooit twee toasts geeft (wie het eerst binnenkomt, toont hem).

/**
 * Tekst en soort van de melding voor een gesloten trade.
 * @param {object} t      Trade
 * @param {object} fmt    formatters uit format.js
 * @param {"paper"|"live"|undefined} mode
 * @returns {[string, "success" | "warn"]}
 */
export function closedTradeMessage(t, fmt, mode) {
  const market = (t && t.market) || "?";
  if (t && t.exitReason === "write-off") {
    // Er is niets verkocht: de inleg is als verlies geboekt, de coins staan nog op het account
    const where = mode === "live" ? "Bitvavo-account" : mode === "paper" ? "oefenaccount" : "account";
    return [`Afgeschreven: ${market} ${fmt.eurSigned(t.pnlQuote)} als verlies geboekt — de coins blijven op je ${where}`, "warn"];
  }
  const paper = mode === "paper";
  return [
    `${paper ? "Oefen-verkoop" : "Verkocht"}: ${market} ${fmt.eurSigned(t && t.pnlQuote)} (${fmt.pct(t && t.pnlPct)}) · ${fmt.exitReason(
      t && t.exitReason,
    )}`,
    t && t.pnlQuote >= 0 ? "success" : "warn",
  ];
}

/**
 * Maakt `notify(trade)`: toont de melding voor een trade één keer per trade-id.
 * @param {(msg: string, kind: string) => unknown} toast
 * @param {object} fmt
 * @param {() => ("paper"|"live"|undefined)} getMode
 */
export function createTradeNotifier(toast, fmt, getMode) {
  const seen = new Set();
  return function notify(t) {
    if (!t || typeof t !== "object") return false;
    if (t.id != null) {
      const id = String(t.id);
      if (seen.has(id)) return false;
      seen.add(id);
      if (seen.size > 500) seen.delete(seen.values().next().value);
    }
    const [msg, kind] = closedTradeMessage(t, fmt, getMode());
    toast(msg, kind);
    return true;
  };
}
