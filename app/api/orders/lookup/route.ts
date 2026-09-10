import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getOrderByNumberAndEmail } from "@/lib/orders";
import { ORDER_STATUS_LABELS } from "@/lib/supabase/types";
import { rateLimit, clientIpFrom } from "@/lib/rate-limit";

// POST /api/orders/lookup — guest order tracking. Requires BOTH the exact
// order number and the email used at checkout; never returns other orders.
const schema = z.object({
  orderNumber: z.string().min(1, "Vul een ordernummer in."),
  email: z.string().email("Vul een geldig e-mailadres in."),
});

export async function POST(request: NextRequest) {
  const ip = clientIpFrom(request.headers);
  const { allowed } = rateLimit(`order-lookup:${ip}`, 15, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: "Te veel pogingen. Probeer het later opnieuw." }, { status: 429 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Ongeldige gegevens." }, { status: 400 });
  }

  const order = await getOrderByNumberAndEmail(parsed.data.orderNumber, parsed.data.email);
  if (!order) {
    return NextResponse.json({ error: "Geen bestelling gevonden met dit ordernummer en e-mailadres." }, { status: 404 });
  }

  return NextResponse.json({
    orderNumber: order.order_number,
    status: order.status,
    statusLabel: ORDER_STATUS_LABELS[order.status],
    trackAndTraceCode: order.track_and_trace_code,
    carrier: order.carrier,
    createdAt: order.created_at,
  });
}
