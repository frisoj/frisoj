import { createHmac } from "node:crypto";

/**
 * Bitvavo REST v2-handtekening: hex(HMAC-SHA256(secret, timestamp + METHOD + pathWithQuery + body)).
 *
 * `pathWithQuery` begint al met "/v2", bijv. "/v2/order?market=BTC-EUR&orderId=...".
 * `body` is exact de JSON-string die verstuurd wordt (lege string bij GET/DELETE).
 */
export function signRequest(
  secret: string,
  timestamp: number,
  method: string,
  pathWithQuery: string,
  body: string,
): string {
  const payload = `${timestamp}${method.toUpperCase()}${pathWithQuery}${body}`;
  return createHmac("sha256", secret).update(payload).digest("hex");
}
