import { describe, expect, it } from "vitest";
import { LiveBroker } from "../../src/broker/liveBroker";
import { DEFAULT_RISK_CONFIG } from "../../src/core/defaults";
import type { BitvavoClient } from "../../src/exchange/bitvavoClient";
import { validateRiskConfig } from "../../src/risk/riskManager";
import { syncAccountFees } from "../../src/server/accountFees";

function recorder() {
  const calls: [number, number][] = [];
  return { calls, broker: { setCosts: (t: number, s: number) => void calls.push([t, s]) } };
}
const quiet = { info: () => {}, warn: () => {} };

describe("syncAccountFees (live: fees van het Bitvavo-account)", () => {
  it("neemt de echte fees over en geeft ze daarna aan de broker door", async () => {
    const risk = { ...DEFAULT_RISK_CONFIG, slippagePct: 0.001 };
    const { calls, broker } = recorder();
    await syncAccountFees({
      account: async () => ({ takerFee: 0.0015, makerFee: 0.001 }),
      broker,
      risk,
      validateRisk: validateRiskConfig,
      log: quiet,
    });
    expect(risk.takerFee).toBe(0.0015);
    expect(risk.makerFee).toBe(0.001);
    expect(calls).toEqual([[0.0015, 0.001]]);
  });

  it("de echte LiveBroker (vooraf gebouwd met de standaard-fee) krijgt de account-fee", async () => {
    const broker = new LiveBroker({} as BitvavoClient);
    expect(broker.takerFee).toBe(0.0025);
    const risk = { ...DEFAULT_RISK_CONFIG };
    await syncAccountFees({
      account: async () => ({ takerFee: 0.0012, makerFee: 0.0008 }),
      broker,
      risk,
      validateRisk: validateRiskConfig,
      log: quiet,
    });
    expect(broker.takerFee).toBe(0.0012);
  });

  it("account niet bereikbaar → de ingestelde fee gaat toch naar de broker", async () => {
    const risk = { ...DEFAULT_RISK_CONFIG, takerFee: 0.002 };
    const { calls, broker } = recorder();
    const warnings: string[] = [];
    await syncAccountFees({
      account: async () => {
        throw new Error("403 IP niet toegestaan");
      },
      broker,
      risk,
      validateRisk: validateRiskConfig,
      log: { info: () => {}, warn: (m) => warnings.push(m) },
    });
    expect(risk.takerFee).toBe(0.002);
    expect(calls).toEqual([[0.002, DEFAULT_RISK_CONFIG.slippagePct]]);
    expect(warnings.join(" ")).toMatch(/Kon je Bitvavo-account niet ophalen/);
  });

  it("een onverwachte fee van Bitvavo wordt genegeerd (ingestelde waarde blijft, ook in de broker)", async () => {
    const risk = { ...DEFAULT_RISK_CONFIG };
    const { calls, broker } = recorder();
    const warnings: string[] = [];
    await syncAccountFees({
      account: async () => ({ takerFee: 0.5, makerFee: 0.001 }),
      broker,
      risk,
      validateRisk: validateRiskConfig,
      log: { info: () => {}, warn: (m) => warnings.push(m) },
    });
    expect(risk.takerFee).toBe(DEFAULT_RISK_CONFIG.takerFee);
    expect(risk.makerFee).toBe(0.001);
    expect(calls).toEqual([[DEFAULT_RISK_CONFIG.takerFee, DEFAULT_RISK_CONFIG.slippagePct]]);
    expect(warnings.join(" ")).toMatch(/Onverwachte taker fee/);
  });

  it("broker zonder setCosts is geen probleem", async () => {
    const risk = { ...DEFAULT_RISK_CONFIG };
    await expect(
      syncAccountFees({
        account: async () => ({ takerFee: 0.0015, makerFee: 0.001 }),
        broker: {},
        risk,
        validateRisk: validateRiskConfig,
        log: quiet,
      }),
    ).resolves.toBeUndefined();
    expect(risk.takerFee).toBe(0.0015);
  });
});
