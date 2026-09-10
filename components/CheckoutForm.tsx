"use client";

import Link from "next/link";
import { cloneElement, isValidElement, useId, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { useCart } from "@/lib/cart-context";
import { formatEuro } from "@/lib/cart";
import {
  checkoutFormSchema,
  defaultPaymentMethodFor,
  paymentMethodLabels,
  type PaymentMethod,
} from "@/lib/validation/checkout";

type Country = "NL" | "BE";

type FieldErrors = Record<string, string>;

function flattenIssues(issues: { path: PropertyKey[]; message: string }[]): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join(".");
    if (!errors[key]) errors[key] = issue.message;
  }
  return errors;
}

export default function CheckoutForm({ csrfToken }: { csrfToken: string }) {
  const { items, totals, isHydrated } = useCart();
  const termsErrorId = useId();

  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState<Country>("NL");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [street, setStreet] = useState("");
  const [houseNumber, setHouseNumber] = useState("");
  const [houseNumberAddition, setHouseNumberAddition] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [city, setCity] = useState("");

  const [billingDifferent, setBillingDifferent] = useState(false);
  const [billingCountry, setBillingCountry] = useState<Country>("NL");
  const [billingFirstName, setBillingFirstName] = useState("");
  const [billingLastName, setBillingLastName] = useState("");
  const [billingStreet, setBillingStreet] = useState("");
  const [billingHouseNumber, setBillingHouseNumber] = useState("");
  const [billingHouseNumberAddition, setBillingHouseNumberAddition] = useState("");
  const [billingPostalCode, setBillingPostalCode] = useState("");
  const [billingCity, setBillingCity] = useState("");

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(defaultPaymentMethodFor("NL"));
  const [paymentMethodTouched, setPaymentMethodTouched] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [newsletterOptIn, setNewsletterOptIn] = useState(false);

  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function handleCountryChange(next: Country) {
    setCountry(next);
    if (!paymentMethodTouched) setPaymentMethod(defaultPaymentMethodFor(next));
  }

  const deliveryEstimate = "2-5 werkdagen";

  const formValue = useMemo(
    () => ({
      email,
      phone,
      shipping: {
        firstName,
        lastName,
        country,
        street,
        houseNumber,
        houseNumberAddition,
        postalCode,
        city,
      },
      billingDifferent,
      billing: billingDifferent
        ? {
            firstName: billingFirstName,
            lastName: billingLastName,
            country: billingCountry,
            street: billingStreet,
            houseNumber: billingHouseNumber,
            houseNumberAddition: billingHouseNumberAddition,
            postalCode: billingPostalCode,
            city: billingCity,
          }
        : undefined,
      paymentMethod,
      acceptedTerms,
      newsletterOptIn,
    }),
    [
      email, phone, firstName, lastName, country, street, houseNumber, houseNumberAddition, postalCode, city,
      billingDifferent, billingFirstName, billingLastName, billingCountry, billingStreet, billingHouseNumber,
      billingHouseNumberAddition, billingPostalCode, billingCity, paymentMethod, acceptedTerms, newsletterOptIn,
    ],
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    const parsed = checkoutFormSchema.safeParse(formValue);
    if (!parsed.success) {
      setErrors(flattenIssues(parsed.error.issues));
      const firstErrorEl = document.querySelector<HTMLElement>("[data-error='true']");
      firstErrorEl?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setErrors({});

    if (items.length === 0) {
      setSubmitError("Je winkelwagen is leeg.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify({
          form: parsed.data,
          cart: items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data.error ?? "Er ging iets mis. Probeer het opnieuw.");
        setSubmitting(false);
        return;
      }
      window.location.href = data.redirectUrl;
    } catch {
      setSubmitError("Er ging iets mis met de verbinding. Probeer het opnieuw.");
      setSubmitting(false);
    }
  }

  // The cart cookie is only readable client-side, so on the very first
  // paint (a fresh full-page load of /afrekenen, not a client-side Link
  // navigation from a page that already hydrated the cart) we don't yet
  // know whether the cart is empty. Showing the full two-column form and
  // then, a tick later, collapsing it down to this short message produced
  // a large Cumulative Layout Shift (0.62, flagged by Lighthouse) — show a
  // stable, minimal placeholder instead until hydration settles, so there
  // is at most one small→real content transition, not a big form→tiny
  // message reversal.
  if (!isHydrated) {
    return <div className="mx-auto min-h-[70vh] max-w-6xl px-4 py-10 sm:py-14" aria-hidden="true" />;
  }

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center">
        <h1 className="font-heading text-3xl font-semibold text-ink">Je winkelwagen is leeg</h1>
        <p className="mt-3 text-ink-muted">Voeg eerst een product toe voordat je kunt afrekenen.</p>
        <Link
          href="/zelfreinigende-kattenbak"
          className="mt-8 inline-block rounded-full bg-accent px-6 py-3 text-base font-semibold text-white hover:bg-accent-dark"
        >
          Bekijk het product
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:py-14">
      <h1 className="font-heading text-3xl font-semibold text-ink sm:text-4xl">Afrekenen</h1>
      <p className="mt-2 text-ink-muted">Geen account nodig — reken af als gast.</p>

      <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_360px] lg:items-start">
        {/* Order summary: on top for mobile, right column on desktop */}
        <aside className="order-first rounded-2xl border border-border bg-surface p-6 lg:order-last lg:sticky lg:top-24">
          <h2 className="font-heading text-lg font-semibold text-ink">Overzicht</h2>
          <ul className="mt-4 space-y-3">
            {items.map((item) => (
              <li key={item.variantId} className="flex justify-between gap-3 text-sm">
                <span className="text-ink-muted">
                  {item.quantity}× {item.name}
                </span>
                <span className="font-medium text-ink">{formatEuro(item.unitPriceCents * item.quantity)}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-4 space-y-2 border-t border-border pt-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-muted">Subtotaal</dt>
              <dd className="text-ink">{formatEuro(totals.subtotalCents)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-muted">Verzending</dt>
              <dd className="font-semibold text-success">Gratis (NL/BE)</dd>
            </div>
            <div className="flex justify-between border-t border-border pt-2">
              <dt className="font-semibold text-ink">Totaal</dt>
              <dd className="font-heading text-lg font-semibold text-ink">{formatEuro(totals.totalCents)}</dd>
            </div>
            <div className="flex justify-between text-xs text-ink-muted">
              <dt>Waarvan BTW (21%)</dt>
              <dd>{formatEuro(totals.btwCents)}</dd>
            </div>
          </dl>
          <p className="mt-4 text-sm text-ink-muted">Verwachte levering: {deliveryEstimate}</p>
          <ul className="mt-4 space-y-1 text-xs text-ink-muted">
            <li>✓ 14 dagen bedenktijd</li>
            <li>✓ 2 jaar garantie</li>
            <li>✓ Veilig betalen via Mollie</li>
          </ul>
        </aside>

        <form onSubmit={handleSubmit} className="space-y-10">
          {/* Contact */}
          <fieldset className="space-y-4">
            <legend className="font-heading text-lg font-semibold text-ink">Contactgegevens</legend>
            <Field label="E-mailadres" error={errors["email"]}>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                className={inputClass(errors["email"])}
              />
            </Field>
            <Field label="Telefoonnummer (optioneel)" error={errors["phone"]}>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                autoComplete="tel"
                className={inputClass(errors["phone"])}
              />
            </Field>
          </fieldset>

          {/* Shipping address */}
          <fieldset className="space-y-4">
            <legend className="font-heading text-lg font-semibold text-ink">Verzendadres</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Voornaam" error={errors["shipping.firstName"]}>
                <input value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" className={inputClass(errors["shipping.firstName"])} />
              </Field>
              <Field label="Achternaam" error={errors["shipping.lastName"]}>
                <input value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" className={inputClass(errors["shipping.lastName"])} />
              </Field>
            </div>
            <Field label="Land" error={errors["shipping.country"]}>
              <select value={country} onChange={(e) => handleCountryChange(e.target.value as Country)} className={inputClass(errors["shipping.country"])}>
                <option value="NL">Nederland</option>
                <option value="BE">België</option>
              </select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-[1fr_auto_auto]">
              <Field label="Straatnaam" error={errors["shipping.street"]}>
                <input value={street} onChange={(e) => setStreet(e.target.value)} autoComplete="address-line1" className={inputClass(errors["shipping.street"])} />
              </Field>
              <Field label="Huisnummer" error={errors["shipping.houseNumber"]}>
                <input value={houseNumber} onChange={(e) => setHouseNumber(e.target.value)} className={`${inputClass(errors["shipping.houseNumber"])} w-24`} />
              </Field>
              <Field label="Toevoeging" error={undefined}>
                <input value={houseNumberAddition} onChange={(e) => setHouseNumberAddition(e.target.value)} className={`${inputClass(undefined)} w-24`} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={country === "NL" ? "Postcode (1234 AB)" : "Postcode"} error={errors["shipping.postalCode"]}>
                <input value={postalCode} onChange={(e) => setPostalCode(e.target.value)} autoComplete="postal-code" className={inputClass(errors["shipping.postalCode"])} />
              </Field>
              <Field label="Plaats" error={errors["shipping.city"]}>
                <input value={city} onChange={(e) => setCity(e.target.value)} autoComplete="address-level2" className={inputClass(errors["shipping.city"])} />
              </Field>
            </div>
          </fieldset>

          {/* Billing address */}
          <fieldset className="space-y-4">
            <label className="flex items-center gap-2 text-sm font-medium text-ink">
              <input type="checkbox" checked={billingDifferent} onChange={(e) => setBillingDifferent(e.target.checked)} className="h-4 w-4 rounded border-border text-accent focus-visible:outline-accent" />
              Factuuradres is anders dan verzendadres
            </label>
            {billingDifferent && (
              <div className="space-y-4 rounded-xl border border-border bg-cream p-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Voornaam" error={errors["billing.firstName"]}>
                    <input value={billingFirstName} onChange={(e) => setBillingFirstName(e.target.value)} className={inputClass(errors["billing.firstName"])} />
                  </Field>
                  <Field label="Achternaam" error={errors["billing.lastName"]}>
                    <input value={billingLastName} onChange={(e) => setBillingLastName(e.target.value)} className={inputClass(errors["billing.lastName"])} />
                  </Field>
                </div>
                <Field label="Land" error={errors["billing.country"]}>
                  <select value={billingCountry} onChange={(e) => setBillingCountry(e.target.value as Country)} className={inputClass(errors["billing.country"])}>
                    <option value="NL">Nederland</option>
                    <option value="BE">België</option>
                  </select>
                </Field>
                <div className="grid gap-4 sm:grid-cols-[1fr_auto_auto]">
                  <Field label="Straatnaam" error={errors["billing.street"]}>
                    <input value={billingStreet} onChange={(e) => setBillingStreet(e.target.value)} className={inputClass(errors["billing.street"])} />
                  </Field>
                  <Field label="Huisnummer" error={errors["billing.houseNumber"]}>
                    <input value={billingHouseNumber} onChange={(e) => setBillingHouseNumber(e.target.value)} className={`${inputClass(errors["billing.houseNumber"])} w-24`} />
                  </Field>
                  <Field label="Toevoeging" error={undefined}>
                    <input value={billingHouseNumberAddition} onChange={(e) => setBillingHouseNumberAddition(e.target.value)} className={`${inputClass(undefined)} w-24`} />
                  </Field>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Postcode" error={errors["billing.postalCode"]}>
                    <input value={billingPostalCode} onChange={(e) => setBillingPostalCode(e.target.value)} className={inputClass(errors["billing.postalCode"])} />
                  </Field>
                  <Field label="Plaats" error={errors["billing.city"]}>
                    <input value={billingCity} onChange={(e) => setBillingCity(e.target.value)} className={inputClass(errors["billing.city"])} />
                  </Field>
                </div>
              </div>
            )}
          </fieldset>

          {/* Payment */}
          <fieldset className="space-y-3">
            <legend className="font-heading text-lg font-semibold text-ink">Betaalmethode</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {(Object.keys(paymentMethodLabels) as PaymentMethod[]).map((method) => (
                <label
                  key={method}
                  className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm font-medium text-ink transition-colors ${
                    paymentMethod === method ? "border-accent bg-accent-tint" : "border-border hover:border-accent"
                  }`}
                >
                  <input
                    type="radio"
                    name="paymentMethod"
                    value={method}
                    checked={paymentMethod === method}
                    onChange={() => {
                      setPaymentMethod(method);
                      setPaymentMethodTouched(true);
                    }}
                    className="h-4 w-4 text-accent"
                  />
                  <span aria-hidden="true" className="text-lg">{paymentMethodLabels[method].icon}</span>
                  {paymentMethodLabels[method].label}
                </label>
              ))}
            </div>
            {errors["paymentMethod"] && <ErrorText>{errors["paymentMethod"]}</ErrorText>}
          </fieldset>

          {/* Consents */}
          <fieldset className="space-y-3">
            <label className="flex items-start gap-3 text-sm text-ink" data-error={errors["acceptedTerms"] ? "true" : undefined}>
              <input
                type="checkbox"
                checked={acceptedTerms}
                onChange={(e) => setAcceptedTerms(e.target.checked)}
                aria-invalid={errors["acceptedTerms"] ? true : undefined}
                aria-describedby={errors["acceptedTerms"] ? termsErrorId : undefined}
                className="mt-0.5 h-4 w-4 rounded border-border text-accent focus-visible:outline-accent"
              />
              <span>
                Ik ga akkoord met de{" "}
                <Link href="/algemene-voorwaarden" className="font-semibold text-accent hover:underline">
                  algemene voorwaarden
                </Link>{" "}
                en ben op de hoogte van het{" "}
                <Link href="/herroepingsrecht" className="font-semibold text-accent hover:underline">
                  herroepingsrecht
                </Link>
                .
              </span>
            </label>
            {errors["acceptedTerms"] && <ErrorText id={termsErrorId}>{errors["acceptedTerms"]}</ErrorText>}

            <label className="flex items-start gap-3 text-sm text-ink">
              <input
                type="checkbox"
                checked={newsletterOptIn}
                onChange={(e) => setNewsletterOptIn(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-border text-accent focus-visible:outline-accent"
              />
              <span>Houd me op de hoogte via e-mail over aanbiedingen en nieuws (optioneel).</span>
            </label>
          </fieldset>

          {submitError && (
            <p role="alert" className="rounded-xl border border-accent bg-accent-tint px-4 py-3 text-sm text-accent-dark">
              {submitError}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-full bg-accent px-6 py-4 text-base font-semibold text-white transition-colors hover:bg-accent-dark disabled:opacity-60"
          >
            {submitting ? "Bezig..." : `Betalen — ${formatEuro(totals.totalCents)}`}
          </button>
        </form>
      </div>
    </div>
  );
}

// Wires each field's input to its error message via `aria-describedby` +
// `aria-invalid` (not just visual proximity), so a screen-reader user
// tabbing into a field — not only one hearing the role="alert" announcement
// at the moment an error first appears — still gets the error read out as
// part of the field's accessible description.
function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  const errorId = useId();
  const child = isValidElement(children)
    ? cloneElement(children as ReactElement<{ id?: string; "aria-invalid"?: boolean; "aria-describedby"?: string }>, {
        "aria-invalid": error ? true : undefined,
        "aria-describedby": error ? errorId : undefined,
      })
    : children;
  return (
    <label className="block text-sm" data-error={error ? "true" : undefined}>
      <span className="mb-1 block font-medium text-ink">{label}</span>
      {child}
      {error && <ErrorText id={errorId}>{error}</ErrorText>}
    </label>
  );
}

function ErrorText({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <span id={id} role="alert" className="mt-1 block text-sm text-accent-dark">
      {children}
    </span>
  );
}

function inputClass(error?: string) {
  return `mt-1 w-full rounded-lg border bg-surface px-3 py-2 text-ink ${error ? "border-accent" : "border-border"}`;
}
