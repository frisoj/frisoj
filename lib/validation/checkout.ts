import { z } from "zod";

// NL postcode: "1234 AB" (also accepts "1234AB", normalized to "1234 AB").
const nlPostcode = /^[1-9][0-9]{3}\s?[A-Za-z]{2}$/;
// BE postcode: 4 digits, first digit 1-9.
const bePostcode = /^[1-9][0-9]{3}$/;

const paymentMethods = ["ideal", "bancontact", "klarna", "creditcard", "applepay"] as const;
export type PaymentMethod = (typeof paymentMethods)[number];

const addressSchema = z.object({
  firstName: z.string().trim().min(1, "Voornaam is verplicht."),
  lastName: z.string().trim().min(1, "Achternaam is verplicht."),
  country: z.enum(["NL", "BE"], { message: "Kies Nederland of België." }),
  street: z.string().trim().min(1, "Straatnaam is verplicht."),
  houseNumber: z.string().trim().min(1, "Huisnummer is verplicht."),
  houseNumberAddition: z.string().trim().optional().default(""),
  postalCode: z.string().trim().min(1, "Postcode is verplicht."),
  city: z.string().trim().min(1, "Plaats is verplicht."),
});

function refinePostcode(
  data: { country: "NL" | "BE"; postalCode: string },
  ctx: z.RefinementCtx,
  path: (string | number)[],
) {
  const normalized = data.postalCode.trim();
  if (data.country === "NL" && !nlPostcode.test(normalized)) {
    ctx.addIssue({
      code: "custom",
      path,
      message: "Vul een geldige Nederlandse postcode in, bijv. 1234 AB.",
    });
  }
  if (data.country === "BE" && !bePostcode.test(normalized)) {
    ctx.addIssue({
      code: "custom",
      path,
      message: "Vul een geldige Belgische postcode in, bijv. 1000.",
    });
  }
}

export const checkoutFormSchema = z
  .object({
    email: z.string().trim().min(1, "E-mailadres is verplicht.").email("Vul een geldig e-mailadres in."),
    phone: z.string().trim().optional().default(""),
    shipping: addressSchema,
    billingDifferent: z.boolean().default(false),
    billing: addressSchema.partial().optional(),
    paymentMethod: z.enum(paymentMethods, { message: "Kies een betaalmethode." }),
    acceptedTerms: z.literal(true, {
      message: "Je moet akkoord gaan met de algemene voorwaarden en het herroepingsrecht.",
    }),
    newsletterOptIn: z.boolean().default(false),
  })
  .superRefine((data, ctx) => {
    refinePostcode(data.shipping, ctx, ["shipping", "postalCode"]);
    if (data.billingDifferent) {
      if (!data.billing?.firstName) {
        ctx.addIssue({ code: "custom", path: ["billing", "firstName"], message: "Voornaam is verplicht." });
      }
      if (!data.billing?.lastName) {
        ctx.addIssue({ code: "custom", path: ["billing", "lastName"], message: "Achternaam is verplicht." });
      }
      if (!data.billing?.street) {
        ctx.addIssue({ code: "custom", path: ["billing", "street"], message: "Straatnaam is verplicht." });
      }
      if (!data.billing?.houseNumber) {
        ctx.addIssue({ code: "custom", path: ["billing", "houseNumber"], message: "Huisnummer is verplicht." });
      }
      if (!data.billing?.city) {
        ctx.addIssue({ code: "custom", path: ["billing", "city"], message: "Plaats is verplicht." });
      }
      if (!data.billing?.country) {
        ctx.addIssue({ code: "custom", path: ["billing", "country"], message: "Kies Nederland of België." });
      } else if (!data.billing?.postalCode) {
        ctx.addIssue({ code: "custom", path: ["billing", "postalCode"], message: "Postcode is verplicht." });
      } else {
        refinePostcode(
          { country: data.billing.country, postalCode: data.billing.postalCode },
          ctx,
          ["billing", "postalCode"],
        );
      }
    }
  });

export type CheckoutFormInput = z.input<typeof checkoutFormSchema>;
export type CheckoutFormData = z.output<typeof checkoutFormSchema>;

export function defaultPaymentMethodFor(country: "NL" | "BE"): PaymentMethod {
  return country === "BE" ? "bancontact" : "ideal";
}

export const paymentMethodLabels: Record<PaymentMethod, { label: string; icon: string }> = {
  ideal: { label: "iDEAL", icon: "🏦" },
  bancontact: { label: "Bancontact", icon: "💳" },
  klarna: { label: "Klarna", icon: "🅺" },
  creditcard: { label: "Creditcard", icon: "💳" },
  applepay: { label: "Apple Pay", icon: "🍎" },
};
