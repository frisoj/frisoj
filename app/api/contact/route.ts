import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { contactFormSchema } from "@/lib/validation/contact";
import { rateLimit, clientIpFrom } from "@/lib/rate-limit";
import { verifyCsrfToken, CSRF_COOKIE_NAME } from "@/lib/csrf";
import { site } from "@/lib/site";

// POST /api/contact — spam-protected with a honeypot field (rejected
// silently as success, so bots filling it don't learn anything) and a
// per-IP rate limit, same CSRF double-submit-cookie pattern as checkout.
// Delivered via Resend to the owner address; falls back to a log line when
// RESEND_API_KEY is unset, same degrade-gracefully pattern as lib/email/send.ts.

const OWNER_EMAIL = process.env.OWNER_NOTIFICATION_EMAIL || `info@${site.domain}`;
const FROM_ADDRESS = `${site.brand} website <bestellingen@${site.domain}>`;

let cachedClient: Resend | null | undefined;
function client(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  if (cachedClient !== undefined) return cachedClient;
  cachedClient = new Resend(process.env.RESEND_API_KEY);
  return cachedClient;
}

export async function POST(request: NextRequest) {
  const csrfCookie = request.cookies.get(CSRF_COOKIE_NAME)?.value;
  const csrfHeader = request.headers.get("x-csrf-token");
  if (!verifyCsrfToken(csrfCookie, csrfHeader)) {
    return NextResponse.json({ error: "Ongeldig verzoek." }, { status: 403 });
  }

  const ip = clientIpFrom(request.headers);
  const { allowed } = rateLimit(`contact:${ip}`, 5, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: "Te veel pogingen. Probeer het over een minuut opnieuw." }, { status: 429 });
  }

  const json = await request.json().catch(() => null);
  const parsed = contactFormSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Ongeldige gegevens.", issues: parsed.error.issues }, { status: 400 });
  }

  const { name, email, orderNumber, message, honeypot } = parsed.data;

  // Bots that fill the hidden honeypot field get a fake success — never
  // reveal to an automated client that it was detected.
  if (honeypot) {
    return NextResponse.json({ ok: true });
  }

  const subject = orderNumber ? `Contactformulier — bestelling ${orderNumber}` : "Contactformulier — nieuw bericht";
  const text = `Naam: ${name}\nE-mail: ${email}\nOrdernummer: ${orderNumber || "-"}\n\nBericht:\n${message}`;
  const html = `<p><strong>Naam:</strong> ${escapeHtml(name)}</p><p><strong>E-mail:</strong> ${escapeHtml(email)}</p><p><strong>Ordernummer:</strong> ${escapeHtml(orderNumber || "-")}</p><p><strong>Bericht:</strong></p><p>${escapeHtml(message).replace(/\n/g, "<br/>")}</p>`;

  const resend = client();
  if (!resend) {
    console.info(`[email:skip] RESEND_API_KEY not set — would have sent "${subject}"`);
    return NextResponse.json({ ok: true });
  }

  await resend.emails.send({ from: FROM_ADDRESS, to: OWNER_EMAIL, replyTo: email, subject, html, text });
  return NextResponse.json({ ok: true });
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
