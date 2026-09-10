import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getOrderByNumber, markConversionTracked } from "@/lib/orders";

// POST /api/orders/track-conversion
// Called by the thank-you page client code right after it fires the
// GA4/Meta/TikTok purchase pixels (and only after marketing consent), to
// record that this order's conversion was tracked — guaranteeing "max once
// per order" even across reloads/retries.

const schema = z.object({ orderNumber: z.string().min(1) });

export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ongeldig verzoek." }, { status: 400 });

  const order = await getOrderByNumber(parsed.data.orderNumber);
  if (!order || order.status !== "betaald") {
    return NextResponse.json({ ok: false });
  }
  if (order.conversion_tracked_at) {
    return NextResponse.json({ ok: true, alreadyTracked: true });
  }
  await markConversionTracked(order.id);
  return NextResponse.json({ ok: true });
}
