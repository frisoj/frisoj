import { describe, expect, it } from "vitest";
import { isValidStatusTransition, assertValidStatusTransition } from "@/lib/order-transitions";

describe("admin order status transitions", () => {
  it("allows pending -> betaald", () => {
    expect(isValidStatusTransition("pending", "betaald")).toBe(true);
  });

  it("allows pending -> mislukt", () => {
    expect(isValidStatusTransition("pending", "mislukt")).toBe(true);
  });

  it("allows the full happy-path fulfilment chain", () => {
    expect(isValidStatusTransition("betaald", "besteld_bij_leverancier")).toBe(true);
    expect(isValidStatusTransition("besteld_bij_leverancier", "verzonden")).toBe(true);
    expect(isValidStatusTransition("verzonden", "geleverd")).toBe(true);
  });

  it("rejects skipping ahead in the fulfilment chain", () => {
    expect(isValidStatusTransition("betaald", "geleverd")).toBe(false);
    expect(isValidStatusTransition("pending", "verzonden")).toBe(false);
  });

  it("rejects moving backwards", () => {
    expect(isValidStatusTransition("geleverd", "betaald")).toBe(false);
    expect(isValidStatusTransition("verzonden", "besteld_bij_leverancier")).toBe(false);
  });

  it("has no outgoing transitions from the terminal terugbetaald state", () => {
    expect(isValidStatusTransition("terugbetaald", "betaald")).toBe(false);
    expect(isValidStatusTransition("terugbetaald", "pending")).toBe(false);
  });

  it("allows a failed payment to be retried back to pending", () => {
    expect(isValidStatusTransition("mislukt", "pending")).toBe(true);
  });

  it("throws a clear error for an invalid transition", () => {
    expect(() => assertValidStatusTransition("pending", "geleverd")).toThrowError(/niet toegestaan/);
  });
});
