import { describe, expect, it } from "vitest";
import { checkoutFormSchema, defaultPaymentMethodFor } from "@/lib/validation/checkout";

const validBase = {
  email: "klant@example.com",
  phone: "",
  shipping: {
    firstName: "Jan",
    lastName: "Jansen",
    country: "NL" as const,
    street: "Kerkstraat",
    houseNumber: "12",
    houseNumberAddition: "",
    postalCode: "1234 AB",
    city: "Amsterdam",
  },
  billingDifferent: false,
  paymentMethod: "ideal" as const,
  acceptedTerms: true as const,
  newsletterOptIn: false,
};

describe("checkout validation", () => {
  it("accepts a fully valid NL submission", () => {
    const result = checkoutFormSchema.safeParse(validBase);
    expect(result.success).toBe(true);
  });

  it("rejects an invalid email", () => {
    const result = checkoutFormSchema.safeParse({ ...validBase, email: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid NL postcode", () => {
    const result = checkoutFormSchema.safeParse({
      ...validBase,
      shipping: { ...validBase.shipping, postalCode: "12345" },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.path.join(".") === "shipping.postalCode")).toBe(true);
  });

  it("accepts a valid BE postcode (4 digits) and rejects an NL-style one", () => {
    const be = { ...validBase, shipping: { ...validBase.shipping, country: "BE" as const, postalCode: "1000" } };
    expect(checkoutFormSchema.safeParse(be).success).toBe(true);

    const beBad = { ...validBase, shipping: { ...validBase.shipping, country: "BE" as const, postalCode: "1234 AB" } };
    expect(checkoutFormSchema.safeParse(beBad).success).toBe(false);
  });

  it("requires acceptedTerms to be exactly true", () => {
    const result = checkoutFormSchema.safeParse({ ...validBase, acceptedTerms: false });
    expect(result.success).toBe(false);
  });

  it("requires billing fields only when billingDifferent is true", () => {
    const withoutBillingFilled = { ...validBase, billingDifferent: true };
    const result = checkoutFormSchema.safeParse(withoutBillingFilled);
    expect(result.success).toBe(false);

    const withBillingFilled = {
      ...validBase,
      billingDifferent: true,
      billing: {
        firstName: "Jan",
        lastName: "Jansen",
        country: "NL" as const,
        street: "Kerkstraat",
        houseNumber: "12",
        postalCode: "1234 AB",
        city: "Amsterdam",
      },
    };
    expect(checkoutFormSchema.safeParse(withBillingFilled).success).toBe(true);
  });

  it("defaults payment method by country", () => {
    expect(defaultPaymentMethodFor("NL")).toBe("ideal");
    expect(defaultPaymentMethodFor("BE")).toBe("bancontact");
  });
});
