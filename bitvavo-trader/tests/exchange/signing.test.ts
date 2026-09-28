import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signRequest } from "../../src/exchange/signing";

function reference(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

describe("signRequest", () => {
  it("tekent een GET-verzoek (lege body)", () => {
    const sig = signRequest("geheim", 1700000000000, "GET", "/v2/balance", "");
    expect(sig).toBe(reference("geheim", "1700000000000GET/v2/balance"));
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("tekent een POST-verzoek met body en uppercase methode", () => {
    const body = JSON.stringify({ market: "BTC-EUR", side: "buy", orderType: "market", amountQuote: "10", operatorId: 1 });
    const sig = signRequest("s3cr3t", 1700000000123, "post", "/v2/order", body);
    expect(sig).toBe(reference("s3cr3t", `1700000000123POST/v2/order${body}`));
  });

  it("neemt de querystring mee", () => {
    const sig = signRequest("x", 1, "DELETE", "/v2/order?market=BTC-EUR&orderId=abc&operatorId=1", "");
    expect(sig).toBe(reference("x", "1DELETE/v2/order?market=BTC-EUR&orderId=abc&operatorId=1"));
  });
});
