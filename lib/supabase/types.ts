// Hand-written types mirroring supabase/migrations/0001_init.sql +
// 0002_checkout.sql. Kept hand-written (rather than generated) since no live
// Supabase project exists yet in this environment — see DECISIONS.md. When a
// real project is provisioned, prefer regenerating with
// `supabase gen types typescript` and reconciling against this file.

export type OrderStatus =
  | "pending"
  | "betaald"
  | "mislukt"
  | "besteld_bij_leverancier"
  | "verzonden"
  | "geleverd"
  | "geretourneerd"
  | "terugbetaald";

export type Address = {
  firstName: string;
  lastName: string;
  country: "NL" | "BE";
  street: string;
  houseNumber: string;
  houseNumberAddition?: string;
  postalCode: string;
  city: string;
};

export type OrderItemRow = {
  id: string;
  order_id: string;
  product_variant_id: string | null;
  product_name: string;
  variant_name: string | null;
  unit_price_cents: number;
  quantity: number;
  total_cents: number;
  created_at: string;
};

export type OrderRow = {
  id: string;
  order_number: string;
  customer_id: string | null;
  status: OrderStatus;
  mollie_payment_id: string | null;
  mollie_payment_status: string | null;
  payment_method: string | null;
  subtotal_cents: number;
  shipping_cents: number;
  btw_cents: number;
  total_cents: number;
  currency: string;
  email: string;
  phone: string | null;
  shipping_address: Address;
  billing_address: Address | null;
  newsletter_opt_in: boolean;
  terms_accepted_at: string | null;
  conversion_tracked_at: string | null;
  track_and_trace_code: string | null;
  carrier: string | null;
  abandoned_email_sent_at: string | null;
  review_invite_sent_at: string | null;
  delivered_at: string | null;
  paid_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type OrderWithItems = OrderRow & { items: OrderItemRow[] };

export type OrderStatusHistoryRow = {
  id: string;
  order_id: string;
  status: string;
  note: string | null;
  created_at: string;
};

export type ReviewRow = {
  id: string;
  product_id: string;
  customer_id: string | null;
  order_id: string | null;
  author_name: string;
  rating: number;
  title: string | null;
  body: string | null;
  is_published: boolean;
  review_token: string | null;
  created_at: string;
};

export type ReviewInviteRow = {
  id: string;
  order_id: string;
  token: string;
  used_at: string | null;
  created_at: string;
};

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "In afwachting van betaling",
  betaald: "Betaald",
  mislukt: "Mislukt",
  besteld_bij_leverancier: "Besteld bij leverancier",
  verzonden: "Verzonden",
  geleverd: "Geleverd",
  geretourneerd: "Geretourneerd",
  terugbetaald: "Terugbetaald",
};

/** Valid forward transitions for the admin status-change UI. */
export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ["betaald", "mislukt"],
  betaald: ["besteld_bij_leverancier", "geretourneerd", "terugbetaald"],
  mislukt: ["pending"],
  besteld_bij_leverancier: ["verzonden"],
  verzonden: ["geleverd"],
  geleverd: ["geretourneerd"],
  geretourneerd: ["terugbetaald"],
  terugbetaald: [],
};
