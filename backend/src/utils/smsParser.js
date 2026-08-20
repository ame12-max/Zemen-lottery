/**
 * Best-effort parser for CBE and Telebirr "money received" SMS notifications.
 *
 * IMPORTANT: bank/telecom SMS wording changes over time and can vary by
 * account type, so these patterns are based on commonly-seen real message
 * formats, not a guaranteed spec. Every message is logged verbatim in
 * bank_sms_messages regardless of whether it parses, so if auto-verification
 * stops matching, check the raw text there and adjust the regexes below.
 *
 * Real examples this is built against:
 *
 * CBE (often has NO explicit transaction reference in the SMS itself,
 * even though the sender's own CBE app receipt does):
 *   "Dear Customer, You have received ETB 313.00 from account
 *    1********7748 (Bereket Alemu) to your account 1********6338. Your
 *    current balance is ETB3,312.55. Thanks for Banking with CBE."
 *
 * Telebirr (usually DOES include a transaction number):
 *   "You have received ETB 700.00 by transaction number DHFOST4WFC on
 *    2026-08-15 10:10:04 from Awash International Bank S C to your
 *    telebirr Account"
 */

// Anchored to "received" first so we never accidentally grab a *different*
// ETB figure appearing later in the same message (e.g. a CBE message also
// states "Your current balance is ETB3,312.55"). Checked in both possible
// orderings — "received ETB 100.00" and "received 100.00 ETB" both occur
// in real messages depending on the exact template — before falling back
// to a bare, unanchored "ETB <number>" or "<number> ETB" anywhere in the
// text.
const AMOUNT_PATTERNS = [
  /received\s+ETB\s*\.?\s*([\d,]+(?:\.\d{1,2})?)/i,
  /received\s+([\d,]+(?:\.\d{1,2})?)\s*ETB\b/i,
  /ETB\s*\.?\s*([\d,]+(?:\.\d{1,2})?)/i,
  /([\d,]+(?:\.\d{1,2})?)\s*ETB\b/i,
];

function parseAmount(text) {
  for (const pattern of AMOUNT_PATTERNS) {
    const m = text.match(pattern);
    if (m) {
      const cleaned = m[1].replace(/,/g, "");
      const value = Math.round(parseFloat(cleaned));
      if (Number.isFinite(value) && value > 0) return value;
    }
  }
  return null;
}

// CBE reference numbers look like "FT" + ~10 alphanumeric characters when
// present at all, e.g. FT23321WXWD5, FT24116CKXLS — but many real CBE SMS
// don't include one, so this is treated as optional (see bankSmsService's
// amount+name fallback matching for that case).
const CBE_REF_RE = /\bFT[0-9A-Z]{8,13}\b/i;

// Telebirr transaction numbers are introduced by "transaction number ..."
// (with or without "is"/colon), or look like TB + digits, or a bare
// 8-15 digit reference labeled some other way.
const TELEBIRR_REF_PATTERNS = [
  /transaction\s+number\s+(?:is\s+)?([A-Z0-9]{6,20})/i,
  /transaction\s*(?:no\.?|id)\s*[:\-]?\s*([A-Z0-9]{6,20})/i,
  /\bTB[0-9]{6,15}\b/i,
];

function parseAmount(text) {
  const m = text.match(AMOUNT_RECEIVED_RE) || text.match(AMOUNT_FALLBACK_RE);
  if (!m) return null;
  const cleaned = m[1].replace(/,/g, "");
  const value = Math.round(parseFloat(cleaned));
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * CBE payer name shows up in one of a couple of shapes depending on
 * account type:
 *   "...from account 1********7748 (Bereket Alemu) to your account..."
 *   "...from ALEM TESFAYE to your account..."
 * Try the parenthesized-name shape first (more precise), then the plain
 * "from NAME to" shape.
 */
function parseCbeName(text) {
  const parenMatch = text.match(/from\s+account\s+[^\s(]+\s*\(([^)]+)\)/i);
  if (parenMatch) return parenMatch[1].trim();

  const plainMatch = text.match(/\bfrom\s+([A-Za-z.\s]{2,60}?)(?:\s+to\b|\s+your\b|[.,]|$)/i);
  if (plainMatch) return plainMatch[1].trim();

  return null;
}

function parseCbe(text) {
  const amount = parseAmount(text);
  const refMatch = text.match(CBE_REF_RE);
  const ref = refMatch ? refMatch[0].toUpperCase() : null; // often absent — that's OK, see bankSmsService
  const name = parseCbeName(text);

  return { provider: "CBE", amount, ref, name };
}

/**
 * Telebirr payer name also shows up in a couple of shapes:
 *   "...from Alice Johnson (251912******). Your transaction number..."
 *   "...from Awash International Bank S C to your telebirr Account"
 */
function parseTelebirrName(text) {
  const withPhoneMatch = text.match(/\bfrom\s+([A-Za-z.\s]{2,60}?)\s*[(\d]/i);
  if (withPhoneMatch) return withPhoneMatch[1].trim();

  const toAccountMatch = text.match(/\bfrom\s+([A-Za-z0-9.\s]{2,60}?)\s+to\b/i);
  if (toAccountMatch) return toAccountMatch[1].trim();

  return null;
}

function parseTelebirr(text) {
  const amount = parseAmount(text);

  let ref = null;
  for (const pattern of TELEBIRR_REF_PATTERNS) {
    const m = text.match(pattern);
    if (m) {
      ref = (m[1] || m[0]).toUpperCase();
      break;
    }
  }

  const name = parseTelebirrName(text);

  return { provider: "TELEBIRR", amount, ref, name };
}

function detectProvider(text, senderHint) {
  const lower = text.toLowerCase();
  const senderLower = (senderHint || "").toLowerCase();

  // Prefer the sender/SIM label when MacroDroid provides one — it's a much
  // more reliable signal than guessing from message wording, since a
  // stripped-down test message (or a bank that changes phrasing) might not
  // contain any recognizable keyword at all.
  if (senderLower.includes("telebirr")) return "TELEBIRR";
  if (senderLower.includes("cbe")) return "CBE";

  if (lower.includes("telebirr")) return "TELEBIRR";
  if (lower.includes("cbe") || lower.includes("commercial bank")) return "CBE";
  if (CBE_REF_RE.test(text)) return "CBE";
  return "TELEBIRR"; // reasonable default for a bare "received ETB ... from ..." message
}

/**
 * Main entry point. `hintProvider` lets the bridge app/device explicitly
 * tag which provider a message came from — pass this whenever you can
 * (e.g. a `provider` field in the MacroDroid HTTP body, or a per-macro
 * fixed value if you set up one macro per SIM/sender). It's the most
 * reliable signal and always wins. `senderHint` (the SMS sender/label,
 * e.g. "CBE" or "Telebirr") is used as a secondary signal when no
 * explicit provider was given. Falls back to guessing from the message
 * text itself as a last resort.
 */
function parseBankSms(text, hintProvider, senderHint) {
  const provider =
    hintProvider && ["CBE", "TELEBIRR"].includes(hintProvider.toUpperCase())
      ? hintProvider.toUpperCase()
      : detectProvider(text, senderHint);

  return provider === "CBE" ? parseCbe(text) : parseTelebirr(text);
}

/**
 * Loose name match for the amount+name fallback strategy (used when a
 * message has no extractable reference — common for CBE). Normalizes
 * both names (lowercase, strip punctuation) and considers it a match if
 * they share a meaningful word, so "Bereket Alemu" matches "BEREKET
 * ALEMU KEBEDE" or vice versa. Deliberately loose but still meaningfully
 * discriminating — it's only ever used as a *secondary* filter on top of
 * an exact amount + provider + pending-status match, and only accepted
 * when it narrows the candidates to exactly one (see bankSmsService).
 */
function namesLooselyMatch(a, b) {
  if (!a || !b) return false;
  const norm = (s) =>
    s
      .toLowerCase()
      .replace(/[^a-z\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 2);
  const wordsA = new Set(norm(a));
  const wordsB = norm(b);
  return wordsB.some((w) => wordsA.has(w));
}

module.exports = { parseBankSms, parseAmount, namesLooselyMatch };