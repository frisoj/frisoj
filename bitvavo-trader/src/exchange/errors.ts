/**
 * Fouten van de Bitvavo REST-client.
 *
 * Elke fout die de client gooit is een `BitvavoApiError`, zodat aanroepers
 * (LiveBroker, feeds, server) één type hoeven af te vangen. `message` is
 * Nederlandstalig en bevat de originele tekst van Bitvavo (indien aanwezig);
 * API-sleutels of handtekeningen komen er NOOIT in terecht.
 */

/**
 * - `http`: Bitvavo gaf een HTTP-foutstatus (of een `{ errorCode, error }`-body) terug.
 * - `network`: geen antwoord ontvangen (DNS, verbinding verbroken, ...).
 * - `timeout`: geen antwoord binnen de timeout (AbortController).
 * - `invalid-response`: antwoord ontvangen maar niet te lezen (geen geldige JSON).
 * - `validation`: lokaal geweigerd vóór verzending (er is NIETS naar Bitvavo gestuurd).
 * - `config`: lokaal geweigerd door ontbrekende configuratie (bijv. geen API-sleutel).
 * - `rate-limit`: lokaal geweigerd omdat Bitvavo ons tijdelijk heeft geblokkeerd.
 */
export type BitvavoErrorKind =
  | "http"
  | "network"
  | "timeout"
  | "invalid-response"
  | "validation"
  | "config"
  | "rate-limit";

export interface BitvavoApiErrorDetails {
  kind?: BitvavoErrorKind;
  /** Originele (Engelse) fouttekst van Bitvavo */
  bitvavoMessage?: string | null;
  method?: string;
  /** Endpoint zonder query, bijv. "/order" */
  endpoint?: string;
  cause?: unknown;
}

/** Bitvavo-foutcodes waarbij de operatie mogelijk tóch is uitgevoerd. */
const OUTCOME_UNKNOWN_CODES = new Set([101, 108, 109]);
/** Bitvavo-foutcodes voor rate limiting. */
const RATE_LIMIT_CODES = new Set([103, 104, 105]);

export class BitvavoApiError extends Error {
  /** HTTP-status; 0 als er geen HTTP-antwoord was (netwerk/timeout/lokaal). */
  status: number;
  /** Bitvavo `errorCode` (bijv. 216 = onvoldoende saldo), of null. */
  errorCode: number | null;
  kind: BitvavoErrorKind;
  bitvavoMessage: string | null;
  method?: string;
  endpoint?: string;

  constructor(
    message: string,
    status = 0,
    errorCode: number | null = null,
    details: BitvavoApiErrorDetails = {},
  ) {
    super(message, details.cause !== undefined ? { cause: details.cause } : undefined);
    this.name = "BitvavoApiError";
    this.status = status;
    this.errorCode = errorCode;
    this.kind = details.kind ?? (status > 0 ? "http" : "network");
    this.bitvavoMessage = details.bitvavoMessage ?? null;
    this.method = details.method;
    this.endpoint = details.endpoint;
  }

  /** Rate limit geraakt (HTTP 429 of Bitvavo-code 103/104/105). */
  get isRateLimit(): boolean {
    return (
      this.kind === "rate-limit" ||
      this.status === 429 ||
      (this.errorCode !== null && RATE_LIMIT_CODES.has(this.errorCode))
    );
  }

  /**
   * True als het verzoek Bitvavo mogelijk WEL bereikt heeft en uitgevoerd is
   * (netwerkfout, timeout, 5xx, onleesbaar antwoord, of Bitvavo-code
   * 101/108/109). Bij een order moet je dan eerst opzoeken of hij bestaat
   * voordat je iets anders doet — nooit blind opnieuw versturen.
   */
  get outcomeUnknown(): boolean {
    if (this.kind === "network" || this.kind === "timeout" || this.kind === "invalid-response") {
      return true;
    }
    if (this.kind !== "http") return false;
    if (this.errorCode !== null && OUTCOME_UNKNOWN_CODES.has(this.errorCode)) return true;
    return this.status >= 500;
  }

  /** Veilig om een (idempotent) GET-verzoek te herhalen. */
  get retryable(): boolean {
    if (this.errorCode === 105) return false; // ban: opnieuw proberen verlengt de ban
    if (this.kind === "network" || this.kind === "timeout" || this.kind === "invalid-response") {
      return true;
    }
    if (this.kind !== "http") return false;
    if (this.status >= 500 || this.status === 429) return true;
    return this.errorCode === 103 || this.errorCode === 104 || this.errorCode === 107;
  }
}

/** Korte Nederlandse omschrijving van bekende Bitvavo-foutcodes. */
const CODE_DESCRIPTIONS: Record<number, string> = {
  101: "onbekende fout; de operatie is mogelijk wel uitgevoerd",
  102: "ongeldige JSON in het verzoek",
  103: "rate limit bereikt",
  104: "te veel nieuwe orders (order-rate limit)",
  105: "IP-adres of API-sleutel tijdelijk geblokkeerd wegens te veel verzoeken",
  107: "matching engine overbelast",
  108: "matching engine kon de order niet op tijd verwerken",
  109: "matching engine reageerde niet op tijd; de operatie is mogelijk wel uitgevoerd",
  110: "ongeldig endpoint",
  200: "niet-ondersteunde URL-parameter",
  201: "niet-ondersteunde body-parameter",
  202: "niet-ondersteunde orderparameter",
  203: "ontbrekende of onverenigbare parameters",
  204: "niet-ondersteunde parameter",
  205: "ongeldige parameter",
  206: "gebruik óf amount óf amountQuote, niet beide",
  210: "hoeveelheid boven het maximum",
  211: "prijs boven het maximum",
  212: "hoeveelheid onder het minimum voor deze munt",
  213: "prijs onder het minimum",
  214: "prijs heeft te veel cijfers",
  215: "prijs heeft te veel decimalen",
  216: "onvoldoende saldo",
  217: "orderwaarde onder het minimum",
  230: "order geweigerd door de matching engine",
  231: "order geweigerd: markt is gepauzeerd",
  233: "order is niet (meer) actief",
  235: "maximaal aantal open orders voor deze markt bereikt",
  240: "order niet gevonden",
  300: "authenticatie vereist",
  301: "API-sleutel heeft een ongeldige lengte",
  302: "ongeldige timestamp",
  303: "access window moet tussen 100 en 60000 ms liggen",
  304: "verzoek kwam buiten het access window binnen (klokverschil of trage verbinding)",
  305: "geen actieve API-sleutel gevonden",
  306: "API-sleutel is nog niet bevestigd per e-mail",
  307: "deze API-sleutel staat geen toegang toe vanaf dit IP-adres",
  308: "handtekening heeft een ongeldige lengte",
  309: "ongeldige handtekening (controleer je API-secret)",
  310: "deze API-sleutel mag niet handelen",
  311: "deze API-sleutel mag geen accountgegevens tonen",
  317: "account is geblokkeerd; neem contact op met Bitvavo",
};

export function describeBitvavoErrorCode(code: number | null): string | null {
  if (code === null) return null;
  return CODE_DESCRIPTIONS[code] ?? null;
}

function describeHttpStatus(status: number): string {
  if (status === 429) return "te veel verzoeken (rate limit)";
  if (status >= 500) return "serverfout bij Bitvavo";
  if (status === 401 || status === 403) return "geen toegang (controleer je API-sleutel)";
  if (status === 404) return "niet gevonden";
  if (status > 0) return "verzoek geweigerd";
  return "onbekende fout";
}

/** Bouwt de Nederlandse foutmelding voor een HTTP-fout van Bitvavo. */
export function formatBitvavoHttpError(
  method: string,
  endpoint: string,
  status: number,
  errorCode: number | null,
  bitvavoMessage: string | null,
): string {
  const what = describeBitvavoErrorCode(errorCode) ?? describeHttpStatus(status);
  const codePart = errorCode !== null ? `code ${errorCode}` : `HTTP ${status}`;
  const cleaned = bitvavoMessage?.replace(/\s+/g, " ").trim().slice(0, 200);
  const original = cleaned ? `: "${cleaned}"` : "";
  return `Bitvavo-fout bij ${method} ${endpoint}: ${what} (${codePart}${original})`;
}

export function isBitvavoApiError(err: unknown): err is BitvavoApiError {
  return err instanceof BitvavoApiError;
}
