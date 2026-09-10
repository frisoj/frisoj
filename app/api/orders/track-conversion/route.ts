import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getOrderById, markConversionTracked } from "@/lib/orders";
import { rateLimit, clientIpFrom } from "@/lib/rate-limit";
import { isValidUuid } from "@/lib/order-number";

// POST /api/orders/track-conversion
// Called by the thank-you page client code right after it fires the
// GA4/Meta/TikTok purchase pixels (and only after marketing consent), to
// record that this order's conversion was tracked — guaranteeing "max once
// per order" even across reloads/retries.
//
// Identified by the order's UUID `id`, not `order_number` — the order
// number is only 6 digits and must not be usable on its own to probe
// whether an order exists/is paid.

const schema = z.object({ orderId: z.string().min(1) });

export async function POST(request: NextRequest) {
  const ip = clientIpFrom(request.headers);
  const { allowed } = rateLimit(`track-conversion:${ip}`, 20, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: "Te veel pogingen." }, { status: 429 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !isValidUuid(parsed.data.orderId)) {
    return NextResponse.json({ error: "Ongeldig verzoek." }, { status: 400 });
  }

  const order = await getOrderById(parsed.data.orderId);
  if (!order || order.status !== "betaald") {
    return NextResponse.json({ ok: false });
  }
  if (order.conversion_tracked_at) {
    return NextResponse.json({ ok: true, alreadyTracked: true });
  }
  await markConversionTracked(order.id);
  return NextResponse.json({ ok: true });
}
