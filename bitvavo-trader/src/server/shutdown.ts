/**
 * Netjes afsluiten (Ctrl+C, SIGTERM, SIGHUP, …) met een noodrem.
 *
 * engine.stop() wacht op een lopende tick, dus ook op een order die bij
 * Bitvavo loopt. POST + opzoeken bij een onbekende uitkomst kan ruim 10 s
 * duren; wie dan hard afsluit kan een gevulde order missen (munten zonder
 * stop-loss). Daarom wacht de noodrem in live mode langer zolang er (mogelijk)
 * een order loopt, en stopt een tweede Ctrl+C dan niet meteen maar waarschuwt
 * eerst.
 */
import type { TradingMode } from "../core/types";

export const FORCE_EXIT_MS = 10_000;
export const ORDER_WAIT_MAX_MS = 90_000;
const ORDER_POLL_MS = 1_000;

export interface ShutdownDeps {
  mode: TradingMode;
  /** Stopt de engine (wacht op een lopende tick/order). */
  stopEngine: () => Promise<void>;
  /** Na het stoppen van de engine: toestand wegschrijven, server sluiten, … */
  cleanup: () => Promise<void>;
  /** true/false als de engine het weet; undefined = onbekend. */
  orderInFlight: () => boolean | undefined;
  exit: (code: number) => void;
  log?: (msg: string) => void;
  warn?: (msg: string) => void;
  /** Luide waarschuwing (meerdere regels) */
  loud?: (lines: string[]) => void;
  now?: () => number;
  forceExitMs?: number;
  orderWaitMaxMs?: number;
  orderPollMs?: number;
}

export interface ShutdownController {
  /** Aanroepen bij elk signaal (of bij een fatale fout, met exitCode 1). */
  shutdown: (signal: string, exitCode?: number) => Promise<void>;
  readonly shuttingDown: boolean;
}

export function createShutdown(deps: ShutdownDeps): ShutdownController {
  const log = deps.log ?? ((m: string) => console.log(m));
  const warn = deps.warn ?? ((m: string) => console.warn(m));
  const loud = deps.loud ?? ((lines: string[]) => lines.forEach((l) => warn(l)));
  const now = deps.now ?? Date.now;
  const forceExitMs = deps.forceExitMs ?? FORCE_EXIT_MS;
  const orderWaitMaxMs = deps.orderWaitMaxMs ?? ORDER_WAIT_MAX_MS;
  const orderPollMs = deps.orderPollMs ?? ORDER_POLL_MS;

  let shuttingDown = false;
  let startedAt = 0;
  let engineStopped = false;
  let warned = false;
  let exited = false;

  const exit = (code: number) => {
    if (exited) return;
    exited = true;
    deps.exit(code);
  };

  const orderMayBeInFlight = (): boolean => {
    if (deps.mode !== "live" || engineStopped) return false;
    const flag = deps.orderInFlight();
    // Onbekend: zolang engine.stop() niet klaar is, kan er een order lopen.
    return typeof flag === "boolean" ? flag : true;
  };

  const orderWarning = () => {
    warned = true;
    loud([
      "⚠  Er loopt nog een order bij Bitvavo — wachten tot de uitkomst bekend is",
      `⚠  (max ${Math.round(orderWaitMaxMs / 1000)} s). Druk nogmaals Ctrl+C om toch te stoppen: de order`,
      "⚠  wordt dan mogelijk NIET geregistreerd (munten zonder stop-loss).",
    ]);
  };

  const checkAccountHint = () => {
    if (orderMayBeInFlight()) {
      warn("⚠ Een order had mogelijk nog geen uitkomst: controleer je Bitvavo-account (orders en saldo).");
    }
  };

  const forceExitCheck = () => {
    if (exited) return;
    if (orderMayBeInFlight() && now() - startedAt < orderWaitMaxMs) {
      if (!warned) orderWarning();
      setTimeout(forceExitCheck, orderPollMs).unref();
      return;
    }
    warn("Afsluiten duurt te lang; geforceerd gestopt.");
    checkAccountHint();
    exit(1);
  };

  const shutdown = async (signal: string, exitCode = 0): Promise<void> => {
    if (shuttingDown) {
      // Tijdens een lopende order: eerst waarschuwen, pas bij de volgende keer echt stoppen.
      if (orderMayBeInFlight() && !warned) {
        orderWarning();
        return;
      }
      warn("Geforceerd afsluiten.");
      checkAccountHint();
      exit(1);
      return;
    }
    shuttingDown = true;
    startedAt = now();
    log(`\n${signal} ontvangen — bot wordt netjes gestopt…`);
    setTimeout(forceExitCheck, forceExitMs).unref();
    try {
      await deps.stopEngine();
    } catch (err) {
      warn(`Fout bij stoppen van de engine: ${(err as Error).message}`);
    }
    engineStopped = true;
    try {
      await deps.cleanup();
    } catch (err) {
      warn(`Fout bij afsluiten: ${(err as Error).message}`);
    }
    log("Tot ziens!");
    exit(exitCode);
  };

  return {
    shutdown,
    get shuttingDown() {
      return shuttingDown;
    },
  };
}
