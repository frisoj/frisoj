import { NextRequest, NextResponse } from "next/server";
import { getOrdersForAbandonedCartEmail } from "@/lib/orders";
import { sendAbandonedCartEmail } from "@/lib/email/send";

// GET /api/cron/abandoned-cart — triggered by Vercel Cron (see vercel.json).
// Sends an abandoned-cart reminder for orders that are still "pending"
// (payment never completed) 24h after checkout was started, but ONLY when
// the shopper opted in to marketing email at checkout — per the brief.

function isAuthorized(request: NextRequest): boolean {
  if (!process.env.CRON_SECRET) return true;
  return request.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orders = await getOrdersForAbandonedCartEmail(24);
  let sent = 0;
  for (const order of orders) {
    await sendAbandonedCartEmail(order.id);
    sent += 1;
  }

  return NextResponse.json({ ok: true, sent });
}
