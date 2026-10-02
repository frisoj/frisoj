// Pure hulpfuncties van de Marktscanner (geen DOM), zodat ze los te testen zijn
// (tests/frontend/scannerLogic.test.ts). Gebruikt door panels/scanner.js.

/** Zelfde als MAX_MARKETS in src/core/defaults.ts: maximaal aantal munten dat de bot volgt */
export const MAX_MARKETS = 400;

/** Kiest de bot zijn munten automatisch (meest verhandeld)? */
export const isAutoUniverse = (config) => config?.universe?.mode === "auto";

/**
 * De munten die de bot NU volgt: `snapshot.activeMarkets` (automatische keuze of
 * de eigen lijst), anders de eigen lijst uit de config. Zonder dubbele.
 */
export function botMarketsOf(snapshot, config) {
  const list = Array.isArray(snapshot?.activeMarkets)
    ? snapshot.activeMarkets
    : Array.isArray(snapshot?.config?.markets)
      ? snapshot.config.markets
      : Array.isArray(config?.markets)
        ? config.markets
        : [];
  return [...new Set(list)];
}

/**
 * Wat "toevoegen aan de bot" voor `market` betekent:
 * - "in-bot": de bot volgt hem al;
 * - "full": er kan niets meer bij (al het maximum);
 * - "add": zelf kiezen: `markets` = de eigen lijst plus deze munt (PUT { markets });
 * - "switch": automatisch: overschakelen naar "Zelf kiezen" met de munten die de bot
 *   nu volgt (hoogstens MAX_MARKETS) plus deze (PUT { universe: { mode: "manual" }, markets }).
 * @returns {{ kind: "in-bot" | "full" | "add" | "switch", auto: boolean, markets: string[], count: number }}
 */
export function addPlan(market, { snapshot = null, config = null, max = MAX_MARKETS } = {}) {
  const cfg = config || snapshot?.config || null;
  const auto = isAutoUniverse(cfg);
  if (auto) {
    const active = botMarketsOf(snapshot, cfg);
    if (active.includes(market)) return { kind: "in-bot", auto, markets: active, count: active.length };
    if (active.length >= max) return { kind: "full", auto, markets: active, count: active.length };
    return { kind: "switch", auto, markets: [...active, market], count: active.length };
  }
  const own = [...new Set(Array.isArray(cfg?.markets) ? cfg.markets : botMarketsOf(snapshot, null))];
  if (own.includes(market)) return { kind: "in-bot", auto, markets: own, count: own.length };
  if (own.length >= max) return { kind: "full", auto, markets: own, count: own.length };
  return { kind: "add", auto, markets: [...own, market], count: own.length };
}

/** De PUT /api/config-body die bij een plan hoort (null als er niets te doen is). */
export function planPatch(plan) {
  if (plan?.kind === "switch") return { universe: { mode: "manual" }, markets: plan.markets };
  if (plan?.kind === "add") return { markets: plan.markets };
  return null;
}
