/**
 * Live: haalt bij het starten de echte fees van het Bitvavo-account op en
 * geeft ze door aan de risico-instellingen ÉN aan de (al gebouwde) broker.
 * Apart van main.ts zodat het testbaar is.
 */
import type { Broker, RiskConfig } from "../core/types";
import type { RiskValidator } from "./validation";

export interface AccountFeesDeps {
  /** BitvavoClient.account() */
  account(): Promise<{ takerFee: number; makerFee: number }>;
  broker: Pick<Broker, "setCosts">;
  /** Wordt aangepast (takerFee/makerFee) */
  risk: RiskConfig;
  validateRisk: RiskValidator;
  log?: { info: (msg: string) => void; warn: (msg: string) => void };
}

export async function syncAccountFees(deps: AccountFeesDeps): Promise<void> {
  const { risk, validateRisk } = deps;
  const log = deps.log ?? { info: (m: string) => console.log(m), warn: (m: string) => console.warn(m) };
  try {
    const account = await deps.account();
    // Alleen fees binnen de grenzen van de risicomanager overnemen (anders keurt hij elke koop af).
    if (validateRisk({ takerFee: account.takerFee }).ok) risk.takerFee = account.takerFee;
    else log.warn(`⚠ Onverwachte taker fee van Bitvavo (${account.takerFee}); de ingestelde waarde blijft in gebruik.`);
    if (validateRisk({ makerFee: account.makerFee }).ok) risk.makerFee = account.makerFee;
    else log.warn(`⚠ Onverwachte maker fee van Bitvavo (${account.makerFee}); de ingestelde waarde blijft in gebruik.`);
    log.info(
      `Bitvavo-account gevonden. Jouw fees: taker ${(risk.takerFee * 100).toFixed(2)}%, ` +
        `maker ${(risk.makerFee * 100).toFixed(2)}%.`,
    );
  } catch (err) {
    log.warn(
      `⚠ Kon je Bitvavo-account niet ophalen (${(err as Error).message}). ` +
        "Controleer je API-sleutel en IP-whitelist. Standaard-fees worden gebruikt.",
    );
  }
  // De broker is al gebouwd (met de standaard-fee): geef hem de fee die nu echt
  // geldt (van Bitvavo of uit de instellingen), zodat zijn schatting van een nog
  // niet afgerekende fee klopt met wat de risicomanager aanneemt.
  deps.broker.setCosts?.(risk.takerFee, risk.slippagePct);
}
