import "server-only";
import { randomUUID } from "node:crypto";
import { getSupabaseServiceClient, isSupabaseConfigured } from "./supabase/server";
import { generateOrderNumber } from "./order-number";
import type {
  Address,
  OrderItemRow,
  OrderRow,
  OrderStatus,
  OrderWithItems,
  ReviewInviteRow,
  ReviewRow,
} from "./supabase/types";

// ===========================================================================
// Server-side order data layer.
//
// This is the ONE place checkout, the Mollie webhook, the admin panel and
// the cron jobs go through to read/write orders. It talks to Supabase when
// configured (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY set), and
// otherwise falls back to an in-memory mock store — see DECISIONS.md for
// why: it lets every part of Phase 2/3 be built, wired together and tested
// end-to-end without requiring a live cloud project up front. The mock store
// resets whenever the server process restarts; it is NOT durable and must
// not be relied on beyond local development/demo.
// ===========================================================================

export type NewOrderInput = {
  email: string;
  phone?: string;
  shippingAddress: Address;
  billingAddress: Address | null;
  paymentMethod: string;
  newsletterOptIn: boolean;
  items: Array<{
    productVariantId: string | null;
    productName: string;
    variantName?: string | null;
    unitPriceCents: number;
    quantity: number;
  }>;
  subtotalCents: number;
  shippingCents: number;
  btwCents: number;
  totalCents: number;
};

// --- in-memory fallback store -------------------------------------------

type MockDb = {
  orders: OrderWithItems[];
  statusHistory: Array<{ id: string; order_id: string; status: string; note: string | null; created_at: string }>;
  processedWebhooks: Set<string>;
  reviews: ReviewRow[];
  reviewInvites: ReviewInviteRow[];
};

const globalKey = "__purelitter_mock_db__";
type GlobalWithMockDb = typeof globalThis & { [globalKey]?: MockDb };
const g = globalThis as GlobalWithMockDb;

function mockDb(): MockDb {
  if (!g[globalKey]) {
    g[globalKey] = {
      orders: [],
      statusHistory: [],
      processedWebhooks: new Set(),
      reviews: [],
      reviewInvites: [],
    };
  }
  return g[globalKey]!;
}

function nowIso() {
  return new Date().toISOString();
}

// --- order creation --------------------------------------------------------

export async function createPendingOrder(input: NewOrderInput): Promise<OrderWithItems> {
  const client = getSupabaseServiceClient();

  // Try a few times in the unlikely event of an order_number collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const orderNumber = generateOrderNumber();

    if (!client) {
      const order: OrderWithItems = {
        id: randomUUID(),
        order_number: orderNumber,
        customer_id: null,
        status: "pending",
        mollie_payment_id: null,
        mollie_payment_status: null,
        payment_method: input.paymentMethod,
        subtotal_cents: input.subtotalCents,
        shipping_cents: input.shippingCents,
        btw_cents: input.btwCents,
        total_cents: input.totalCents,
        currency: "EUR",
        email: input.email,
        phone: input.phone ?? null,
        shipping_address: input.shippingAddress,
        billing_address: input.billingAddress,
        newsletter_opt_in: input.newsletterOptIn,
        terms_accepted_at: nowIso(),
        conversion_tracked_at: null,
        track_and_trace_code: null,
        carrier: null,
        abandoned_email_sent_at: null,
        review_invite_sent_at: null,
        delivered_at: null,
        paid_at: null,
        notes: null,
        created_at: nowIso(),
        updated_at: nowIso(),
        items: input.items.map((item) => ({
          id: randomUUID(),
          order_id: "", // filled below
          product_variant_id: item.productVariantId,
          product_name: item.productName,
          variant_name: item.variantName ?? null,
          unit_price_cents: item.unitPriceCents,
          quantity: item.quantity,
          total_cents: item.unitPriceCents * item.quantity,
          created_at: nowIso(),
        })),
      };
      order.items.forEach((i) => (i.order_id = order.id));
      mockDb().orders.push(order);
      await recordStatusHistory(order.id, "pending", "Bestelling aangemaakt.");
      return order;
    }

    const { data: orderRow, error } = await client
      .from("orders")
      .insert({
        order_number: orderNumber,
        status: "pending",
        payment_method: input.paymentMethod,
        subtotal_cents: input.subtotalCents,
        shipping_cents: input.shippingCents,
        btw_cents: input.btwCents,
        total_cents: input.totalCents,
        currency: "EUR",
        email: input.email,
        phone: input.phone ?? null,
        shipping_address: input.shippingAddress,
        billing_address: input.billingAddress,
        newsletter_opt_in: input.newsletterOptIn,
        terms_accepted_at: nowIso(),
      })
      .select("*")
      .single();

    if (error) {
      // Unique violation on order_number -> retry with a fresh number.
      if (error.code === "23505") continue;
      throw new Error(`Kon bestelling niet aanmaken: ${error.message}`);
    }

    const itemsToInsert = input.items.map((item) => ({
      order_id: orderRow.id,
      product_variant_id: item.productVariantId,
      product_name: item.productName,
      variant_name: item.variantName ?? null,
      unit_price_cents: item.unitPriceCents,
      quantity: item.quantity,
      total_cents: item.unitPriceCents * item.quantity,
    }));

    const { data: itemRows, error: itemsError } = await client
      .from("order_items")
      .insert(itemsToInsert)
      .select("*");

    if (itemsError) {
      throw new Error(`Kon orderregels niet aanmaken: ${itemsError.message}`);
    }

    await recordStatusHistory(orderRow.id, "pending", "Bestelling aangemaakt.");

    return { ...(orderRow as OrderRow), items: (itemRows ?? []) as OrderItemRow[] };
  }

  throw new Error("Kon geen unieke ordernummer genereren, probeer het opnieuw.");
}

// --- reads -------------------------------------------------------------

export async function getOrderByNumber(orderNumber: string): Promise<OrderWithItems | null> {
  const client = getSupabaseServiceClient();
  if (!client) {
    return mockDb().orders.find((o) => o.order_number === orderNumber) ?? null;
  }
  const { data: order, error } = await client
    .from("orders")
    .select("*")
    .eq("order_number", orderNumber)
    .maybeSingle();
  if (error || !order) return null;
  const { data: items } = await client.from("order_items").select("*").eq("order_id", order.id);
  return { ...(order as OrderRow), items: (items ?? []) as OrderItemRow[] };
}

/** Guest lookup: requires BOTH order number and the exact email used at checkout. */
export async function getOrderByNumberAndEmail(
  orderNumber: string,
  email: string,
): Promise<OrderWithItems | null> {
  const order = await getOrderByNumber(orderNumber);
  if (!order) return null;
  if (order.email.trim().toLowerCase() !== email.trim().toLowerCase()) return null;
  return order;
}

export async function getOrderById(id: string): Promise<OrderWithItems | null> {
  const client = getSupabaseServiceClient();
  if (!client) {
    return mockDb().orders.find((o) => o.id === id) ?? null;
  }
  const { data: order, error } = await client.from("orders").select("*").eq("id", id).maybeSingle();
  if (error || !order) return null;
  const { data: items } = await client.from("order_items").select("*").eq("order_id", order.id);
  return { ...(order as OrderRow), items: (items ?? []) as OrderItemRow[] };
}

export async function getOrderByMolliePaymentId(paymentId: string): Promise<OrderWithItems | null> {
  const client = getSupabaseServiceClient();
  if (!client) {
    return mockDb().orders.find((o) => o.mollie_payment_id === paymentId) ?? null;
  }
  const { data: order, error } = await client
    .from("orders")
    .select("*")
    .eq("mollie_payment_id", paymentId)
    .maybeSingle();
  if (error || !order) return null;
  const { data: items } = await client.from("order_items").select("*").eq("order_id", order.id);
  return { ...(order as OrderRow), items: (items ?? []) as OrderItemRow[] };
}

export type OrderListFilter = {
  status?: OrderStatus;
  search?: string;
  limit?: number;
};

export async function listOrders(filter: OrderListFilter = {}): Promise<OrderRow[]> {
  const client = getSupabaseServiceClient();
  const limit = filter.limit ?? 100;

  if (!client) {
    let rows = [...mockDb().orders] as OrderRow[];
    if (filter.status) rows = rows.filter((o) => o.status === filter.status);
    if (filter.search) {
      const q = filter.search.toLowerCase();
      rows = rows.filter(
        (o) =>
          o.order_number.toLowerCase().includes(q) ||
          o.email.toLowerCase().includes(q) ||
          `${o.shipping_address?.firstName ?? ""} ${o.shipping_address?.lastName ?? ""}`.toLowerCase().includes(q),
      );
    }
    return rows.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit);
  }

  let query = client.from("orders").select("*").order("created_at", { ascending: false }).limit(limit);
  if (filter.status) query = query.eq("status", filter.status);
  if (filter.search) {
    const q = filter.search;
    query = query.or(`order_number.ilike.%${q}%,email.ilike.%${q}%`);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as OrderRow[];
}

// --- writes -------------------------------------------------------------

async function recordStatusHistory(orderId: string, status: string, note?: string) {
  const client = getSupabaseServiceClient();
  if (!client) {
    mockDb().statusHistory.push({
      id: randomUUID(),
      order_id: orderId,
      status,
      note: note ?? null,
      created_at: nowIso(),
    });
    return;
  }
  await client.from("order_status_history").insert({ order_id: orderId, status, note: note ?? null });
}

export async function setMolliePayment(orderId: string, paymentId: string, paymentStatus: string) {
  const client = getSupabaseServiceClient();
  if (!client) {
    const order = mockDb().orders.find((o) => o.id === orderId);
    if (order) {
      order.mollie_payment_id = paymentId;
      order.mollie_payment_status = paymentStatus;
      order.updated_at = nowIso();
    }
    return;
  }
  await client
    .from("orders")
    .update({ mollie_payment_id: paymentId, mollie_payment_status: paymentStatus, updated_at: nowIso() })
    .eq("id", orderId);
}

export async function updateOrderStatus(
  orderId: string,
  status: OrderStatus,
  note?: string,
  extra?: Partial<Pick<OrderRow, "mollie_payment_status" | "paid_at" | "delivered_at" | "track_and_trace_code" | "carrier">>,
) {
  const client = getSupabaseServiceClient();
  const patch = { status, updated_at: nowIso(), ...extra };

  if (!client) {
    const order = mockDb().orders.find((o) => o.id === orderId);
    if (order) Object.assign(order, patch);
  } else {
    const { error } = await client.from("orders").update(patch).eq("id", orderId);
    if (error) throw new Error(error.message);
  }

  await recordStatusHistory(orderId, status, note);
}

export async function markConversionTracked(orderId: string) {
  const client = getSupabaseServiceClient();
  if (!client) {
    const order = mockDb().orders.find((o) => o.id === orderId);
    if (order) order.conversion_tracked_at = nowIso();
    return;
  }
  await client.from("orders").update({ conversion_tracked_at: nowIso() }).eq("id", orderId);
}

export async function setTrackAndTrace(orderId: string, code: string, carrier: string) {
  await updateOrderStatus(orderId, "verzonden", `Track & trace toegevoegd: ${carrier} ${code}`, {
    track_and_trace_code: code,
    carrier,
  });
}

export async function markAbandonedEmailSent(orderId: string) {
  const client = getSupabaseServiceClient();
  if (!client) {
    const order = mockDb().orders.find((o) => o.id === orderId);
    if (order) order.abandoned_email_sent_at = nowIso();
    return;
  }
  await client.from("orders").update({ abandoned_email_sent_at: nowIso() }).eq("id", orderId);
}

export async function markReviewInviteSent(orderId: string) {
  const client = getSupabaseServiceClient();
  if (!client) {
    const order = mockDb().orders.find((o) => o.id === orderId);
    if (order) order.review_invite_sent_at = nowIso();
    return;
  }
  await client.from("orders").update({ review_invite_sent_at: nowIso() }).eq("id", orderId);
}

// --- webhook idempotency -------------------------------------------------

export async function isWebhookEventProcessed(paymentId: string, resultingStatus: string): Promise<boolean> {
  // Idempotency key = paymentId + the status we're about to apply, so a
  // genuinely new status transition (e.g. open -> paid) is never blocked by
  // an earlier "open" delivery, but a duplicate delivery of the same status
  // is a no-op.
  const eventId = `${paymentId}:${resultingStatus}`;
  const client = getSupabaseServiceClient();
  if (!client) {
    return mockDb().processedWebhooks.has(eventId);
  }
  const { data } = await client
    .from("processed_webhook_events")
    .select("id")
    .eq("provider", "mollie")
    .eq("event_id", eventId)
    .maybeSingle();
  return Boolean(data);
}

export async function recordWebhookEvent(paymentId: string, resultingStatus: string, orderId: string) {
  const eventId = `${paymentId}:${resultingStatus}`;
  const client = getSupabaseServiceClient();
  if (!client) {
    mockDb().processedWebhooks.add(eventId);
    return;
  }
  await client
    .from("processed_webhook_events")
    .upsert(
      { provider: "mollie", event_id: eventId, order_id: orderId, resulting_status: resultingStatus },
      { onConflict: "provider,event_id" },
    );
}

// --- cron job queries -----------------------------------------------------

export async function getOrdersForAbandonedCartEmail(olderThanHours = 24): Promise<OrderWithItems[]> {
  const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000).toISOString();
  const client = getSupabaseServiceClient();
  if (!client) {
    return mockDb().orders.filter(
      (o) =>
        o.status === "pending" &&
        o.newsletter_opt_in &&
        !o.abandoned_email_sent_at &&
        o.created_at <= cutoff,
    );
  }
  const { data } = await client
    .from("orders")
    .select("*")
    .eq("status", "pending")
    .eq("newsletter_opt_in", true)
    .is("abandoned_email_sent_at", null)
    .lte("created_at", cutoff);
  const orders = (data ?? []) as OrderRow[];
  return Promise.all(orders.map(async (o) => ({ ...o, items: (await getOrderById(o.id))?.items ?? [] })));
}

export async function getOrdersForReviewInvite(daysSinceDelivery = 7): Promise<OrderRow[]> {
  const cutoff = new Date(Date.now() - daysSinceDelivery * 24 * 60 * 60 * 1000).toISOString();
  const client = getSupabaseServiceClient();
  if (!client) {
    return mockDb().orders.filter(
      (o) =>
        o.status === "geleverd" &&
        !o.review_invite_sent_at &&
        o.delivered_at !== null &&
        o.delivered_at <= cutoff,
    ) as OrderRow[];
  }
  const { data } = await client
    .from("orders")
    .select("*")
    .eq("status", "geleverd")
    .is("review_invite_sent_at", null)
    .not("delivered_at", "is", null)
    .lte("delivered_at", cutoff);
  return (data ?? []) as OrderRow[];
}

// --- reviews ---------------------------------------------------------------

export async function createReviewInvite(orderId: string): Promise<string> {
  const token = randomUUID();
  const client = getSupabaseServiceClient();
  if (!client) {
    mockDb().reviewInvites.push({ id: randomUUID(), order_id: orderId, token, used_at: null, created_at: nowIso() });
    return token;
  }
  await client.from("review_invites").insert({ order_id: orderId, token });
  return token;
}

export async function getReviewInviteByToken(token: string): Promise<ReviewInviteRow | null> {
  const client = getSupabaseServiceClient();
  if (!client) {
    return mockDb().reviewInvites.find((r) => r.token === token) ?? null;
  }
  const { data } = await client.from("review_invites").select("*").eq("token", token).maybeSingle();
  return (data as ReviewInviteRow) ?? null;
}

export async function submitReview(input: {
  token: string;
  productId: string;
  orderId: string;
  authorName: string;
  rating: number;
  title?: string;
  body?: string;
}): Promise<ReviewRow> {
  const client = getSupabaseServiceClient();
  const review: ReviewRow = {
    id: randomUUID(),
    product_id: input.productId,
    customer_id: null,
    order_id: input.orderId,
    author_name: input.authorName,
    rating: input.rating,
    title: input.title ?? null,
    body: input.body ?? null,
    is_published: false,
    review_token: input.token,
    created_at: nowIso(),
  };

  if (!client) {
    mockDb().reviews.push(review);
    const invite = mockDb().reviewInvites.find((r) => r.token === input.token);
    if (invite) invite.used_at = nowIso();
    return review;
  }

  const { data, error } = await client.from("reviews").insert(review).select("*").single();
  if (error) throw new Error(error.message);
  await client.from("review_invites").update({ used_at: nowIso() }).eq("token", input.token);
  return data as ReviewRow;
}

export async function listAllReviews(): Promise<ReviewRow[]> {
  const client = getSupabaseServiceClient();
  if (!client) {
    return [...mockDb().reviews].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  const { data } = await client.from("reviews").select("*").order("created_at", { ascending: false });
  return (data ?? []) as ReviewRow[];
}

export async function setReviewPublished(reviewId: string, isPublished: boolean) {
  const client = getSupabaseServiceClient();
  if (!client) {
    const review = mockDb().reviews.find((r) => r.id === reviewId);
    if (review) review.is_published = isPublished;
    return;
  }
  await client.from("reviews").update({ is_published: isPublished }).eq("id", reviewId);
}

export { isSupabaseConfigured };
