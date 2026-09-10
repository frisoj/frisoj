import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getReviewInviteByToken, submitReview, getOrderById } from "@/lib/orders";
import { site } from "@/lib/site";

// POST /api/reviews/submit — only a valid, unused review-invite token
// (mailed to a real buyer 7 days after delivery) may submit a review. The
// token ties the review to the real order_id, and is marked used so it
// can't be replayed.

const schema = z.object({
  token: z.string().min(1),
  authorName: z.string().trim().min(1, "Naam is verplicht."),
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().optional(),
  body: z.string().trim().optional(),
});

export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Ongeldige gegevens." }, { status: 400 });
  }

  const invite = await getReviewInviteByToken(parsed.data.token);
  if (!invite) {
    return NextResponse.json({ error: "Deze reviewlink is ongeldig." }, { status: 404 });
  }
  if (invite.used_at) {
    return NextResponse.json({ error: "Deze reviewlink is al gebruikt." }, { status: 409 });
  }

  const order = await getOrderById(invite.order_id);
  if (!order) {
    return NextResponse.json({ error: "Bijbehorende bestelling niet gevonden." }, { status: 404 });
  }

  const review = await submitReview({
    token: parsed.data.token,
    productId: site.defaultProductId,
    orderId: order.id,
    authorName: parsed.data.authorName,
    rating: parsed.data.rating,
    title: parsed.data.title,
    body: parsed.data.body,
  });

  return NextResponse.json({ ok: true, reviewId: review.id });
}
