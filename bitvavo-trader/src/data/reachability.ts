import type { BitvavoClient } from "../exchange/bitvavoClient";

/**
 * Controleert of de Bitvavo API bereikbaar is door `client.time()` te laten
 * racen tegen een timeout. Gooit nooit: bij een fout of timeout → false.
 */
export async function isBitvavoReachable(client: BitvavoClient, timeoutMs = 5000): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), Math.max(0, Number(timeoutMs) || 0));
    });
    const probe = Promise.resolve()
      .then(() => client.time())
      .then(
        (t) => typeof t === "number" && Number.isFinite(t) && t > 0,
        () => false,
      );
    return await Promise.race([probe, timeout]);
  } catch {
    return false;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
