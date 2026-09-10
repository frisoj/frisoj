import { formatEuro } from "@/lib/cart";
import { site } from "@/lib/site";
import type { Address, OrderWithItems } from "@/lib/supabase/types";

// Calm, on-brand HTML email templates (table-based layout for wide client
// support) + a plain-text fallback for every message. Colors mirror
// app/globals.css (--color-accent etc.) since email clients can't read CSS
// custom properties — values are inlined here.

const COLORS = {
  cream: "#faf7f2",
  surface: "#ffffff",
  ink: "#241f1a",
  inkMuted: "#6b6459",
  border: "#e7e0d6",
  accent: "#c05c34",
};

export type EmailContent = { subject: string; html: string; text: string };

function shell(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="nl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
  </head>
  <body style="margin:0;padding:0;background:${COLORS.cream};font-family:Georgia,'Times New Roman',serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.cream};padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width:560px;background:${COLORS.surface};border:1px solid ${COLORS.border};border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:28px 32px 8px 32px;">
                <p style="margin:0;font-size:13px;letter-spacing:0.06em;text-transform:uppercase;color:${COLORS.accent};font-weight:700;font-family:Arial,sans-serif;">${site.brand}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 32px 32px;font-family:Arial,sans-serif;color:${COLORS.ink};font-size:15px;line-height:1.6;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;border-top:1px solid ${COLORS.border};font-family:Arial,sans-serif;color:${COLORS.inkMuted};font-size:12px;">
                ${site.legalName} · <a href="mailto:${site.email}" style="color:${COLORS.accent};">${site.email}</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function addressLines(address: Address): string {
  const line2 = `${address.postalCode} ${address.city}, ${address.country === "NL" ? "Nederland" : "België"}`;
  return `${address.firstName} ${address.lastName}<br/>${address.street} ${address.houseNumber}${address.houseNumberAddition ? ` ${address.houseNumberAddition}` : ""}<br/>${line2}`;
}

function itemsTableHtml(order: OrderWithItems): string {
  const rows = order.items
    .map(
      (item) => `<tr>
        <td style="padding:8px 0;border-bottom:1px solid ${COLORS.border};">${item.quantity}× ${item.product_name}</td>
        <td style="padding:8px 0;border-bottom:1px solid ${COLORS.border};text-align:right;">${formatEuro(item.total_cents)}</td>
      </tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" style="font-size:14px;margin:16px 0;">${rows}
    <tr><td style="padding:8px 0;">Verzending</td><td style="padding:8px 0;text-align:right;color:#4b7b52;font-weight:700;">Gratis</td></tr>
    <tr><td style="padding:8px 0;font-weight:700;">Totaal (incl. BTW)</td><td style="padding:8px 0;text-align:right;font-weight:700;">${formatEuro(order.total_cents)}</td></tr>
  </table>`;
}

export function orderConfirmationEmail(order: OrderWithItems): EmailContent {
  const withdrawalUrl = `${site.url}/herroepingsrecht`;
  const html = shell(
    `Bestelbevestiging ${order.order_number}`,
    `<h1 style="font-family:Georgia,serif;font-size:22px;margin:0 0 12px 0;">Bedankt voor je bestelling!</h1>
     <p>Je bestelling <strong>${order.order_number}</strong> is bevestigd en wordt voorbereid voor verzending.</p>
     ${itemsTableHtml(order)}
     <h2 style="font-size:16px;margin:24px 0 8px 0;">Verzendadres</h2>
     <p>${addressLines(order.shipping_address)}</p>
     <p style="margin-top:16px;">Verwachte levertijd: <strong>2-5 werkdagen</strong> in Nederland en België.</p>
     <h2 style="font-size:16px;margin:24px 0 8px 0;">Herroepingsrecht</h2>
     <p>Je hebt <strong>14 dagen bedenktijd</strong> vanaf ontvangst om je bestelling ongebruikt en in originele verpakking te retourneren, zonder opgave van reden. Bekijk hoe dat werkt op onze <a href="${withdrawalUrl}" style="color:${COLORS.accent};">pagina over het herroepingsrecht</a>.</p>
     <p style="margin-top:24px;">Vragen? Mail ons gerust op <a href="mailto:${site.email}" style="color:${COLORS.accent};">${site.email}</a>.</p>`,
  );
  const text = `Bedankt voor je bestelling!\n\nBestelling ${order.order_number}\n${order.items.map((i) => `${i.quantity}x ${i.product_name} - ${formatEuro(i.total_cents)}`).join("\n")}\nVerzending: gratis\nTotaal (incl. BTW): ${formatEuro(order.total_cents)}\n\nVerzendadres:\n${order.shipping_address.firstName} ${order.shipping_address.lastName}\n${order.shipping_address.street} ${order.shipping_address.houseNumber}${order.shipping_address.houseNumberAddition ?? ""}\n${order.shipping_address.postalCode} ${order.shipping_address.city}\n\nVerwachte levertijd: 2-5 werkdagen.\n\nHerroepingsrecht: je hebt 14 dagen bedenktijd. Zie ${withdrawalUrl}.\n\nVragen? ${site.email}`;
  return { subject: `Bestelbevestiging ${order.order_number} — ${site.brand}`, html, text };
}

export function shippingConfirmationEmail(order: OrderWithItems): EmailContent {
  const trackUrl = order.track_and_trace_code
    ? `https://www.google.com/search?q=${encodeURIComponent(`${order.carrier ?? ""} ${order.track_and_trace_code}`)}`
    : null;
  const html = shell(
    `Je bestelling ${order.order_number} is verzonden`,
    `<h1 style="font-family:Georgia,serif;font-size:22px;margin:0 0 12px 0;">Je bestelling is onderweg!</h1>
     <p>Bestelling <strong>${order.order_number}</strong> is verzonden via <strong>${order.carrier ?? "onze vervoerder"}</strong>.</p>
     ${order.track_and_trace_code ? `<p>Track & trace code: <strong>${order.track_and_trace_code}</strong></p>` : ""}
     ${trackUrl ? `<p><a href="${trackUrl}" style="color:${COLORS.accent};font-weight:700;">Volg je pakket</a></p>` : ""}
     <p style="margin-top:16px;">Verwachte levertijd: 2-5 werkdagen.</p>`,
  );
  const text = `Je bestelling ${order.order_number} is verzonden via ${order.carrier ?? "onze vervoerder"}.\n${order.track_and_trace_code ? `Track & trace: ${order.track_and_trace_code}` : ""}`;
  return { subject: `Je bestelling ${order.order_number} is verzonden — ${site.brand}`, html, text };
}

export function ownerNotificationEmail(order: OrderWithItems): EmailContent {
  const html = shell(
    `Nieuwe bestelling ${order.order_number}`,
    `<h1 style="font-family:Georgia,serif;font-size:20px;margin:0 0 12px 0;">Nieuwe betaalde bestelling</h1>
     <p><strong>${order.order_number}</strong> — plaats deze bij de leverancier.</p>
     ${itemsTableHtml(order)}
     <h2 style="font-size:15px;margin:20px 0 6px 0;">Verzendadres (klant)</h2>
     <p>${addressLines(order.shipping_address)}</p>
     <h2 style="font-size:15px;margin:20px 0 6px 0;">Klantcontact</h2>
     <p>E-mail: ${order.email}<br/>Telefoon: ${order.phone ?? "-"}</p>
     <h2 style="font-size:15px;margin:20px 0 6px 0;">Betaling</h2>
     <p>Methode: ${order.payment_method ?? "-"}<br/>Mollie payment ID: ${order.mollie_payment_id ?? "-"}</p>`,
  );
  const text = `Nieuwe betaalde bestelling ${order.order_number}\n\n${order.items.map((i) => `${i.quantity}x ${i.product_name}`).join("\n")}\n\nVerzendadres:\n${order.shipping_address.firstName} ${order.shipping_address.lastName}\n${order.shipping_address.street} ${order.shipping_address.houseNumber}${order.shipping_address.houseNumberAddition ?? ""}\n${order.shipping_address.postalCode} ${order.shipping_address.city}\n\nE-mail: ${order.email}\nTelefoon: ${order.phone ?? "-"}\nBetaalmethode: ${order.payment_method ?? "-"}\nMollie payment ID: ${order.mollie_payment_id ?? "-"}`;
  return { subject: `[Nieuwe bestelling] ${order.order_number} — plaats bij leverancier`, html, text };
}

export function reviewInviteEmail(order: OrderWithItems, reviewUrl: string): EmailContent {
  const html = shell(
    "Hoe bevalt je PureLitter?",
    `<h1 style="font-family:Georgia,serif;font-size:22px;margin:0 0 12px 0;">Hoe bevalt je PureLitter?</h1>
     <p>Je bestelling <strong>${order.order_number}</strong> is een week geleden geleverd. We horen graag hoe het bevalt — jouw ervaring helpt andere kattenbezitters.</p>
     <p style="margin-top:20px;"><a href="${reviewUrl}" style="display:inline-block;background:${COLORS.accent};color:#fff;padding:12px 24px;border-radius:24px;text-decoration:none;font-weight:700;">Laat een review achter</a></p>
     <p style="margin-top:16px;color:${COLORS.inkMuted};font-size:13px;">Deze link is persoonlijk en eenmalig te gebruiken.</p>`,
  );
  const text = `Hoe bevalt je PureLitter?\n\nJe bestelling ${order.order_number} is een week geleden geleverd. Laat een review achter: ${reviewUrl}`;
  return { subject: `Hoe bevalt je PureLitter? — ${site.brand}`, html, text };
}

export function abandonedCartEmail(order: OrderWithItems): EmailContent {
  const cartUrl = `${site.url}/winkelwagen`;
  const html = shell(
    "Je winkelwagen wacht nog op je",
    `<h1 style="font-family:Georgia,serif;font-size:22px;margin:0 0 12px 0;">Nog steeds interesse in ${site.productName}?</h1>
     <p>Je hebt de PureLitter zelfreinigende kattenbak in je winkelwagen laten liggen. Je bestelling is nog niet afgerond.</p>
     ${itemsTableHtml(order)}
     <p style="margin-top:20px;"><a href="${cartUrl}" style="display:inline-block;background:${COLORS.accent};color:#fff;padding:12px 24px;border-radius:24px;text-decoration:none;font-weight:700;">Bekijk je winkelwagen</a></p>`,
  );
  const text = `Je hebt de PureLitter zelfreinigende kattenbak in je winkelwagen laten liggen. Bekijk je winkelwagen: ${cartUrl}`;
  return { subject: `Je winkelwagen wacht nog op je — ${site.brand}`, html, text };
}
