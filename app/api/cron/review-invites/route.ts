import { NextRequest, NextResponse } from "next/server";
import { getOrdersForReviewInvite } from "@/lib/orders";
import { sendReviewInviteEmail } from "@/lib/email/send";

// GET /api/cron/review-invites — triggered by Vercel Cron (see vercel.json).
// Sends the review-invite email for every order delivered >=7 days ago that
// hasn't received one yet. Idempotent: each order is only ever picked up
// once thanks to `review_invite_sent_at` being set before returning.

function isAuthorized(request: NextRequest): boolean {
  if (!process.env.CRON_SECRET) return true; // no secret configured: allow (dev/demo only)
  return request.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orders = await getOrdersForReviewInvite(7);
  let sent = 0;
  for (const order of orders) {
    await sendReviewInviteEmail(order.id);
    sent += 1;
  }

  return NextResponse.json({ ok: true, sent });
}
