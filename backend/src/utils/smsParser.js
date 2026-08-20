/**
 * Best-effort parser for CBE and Telebirr "money received" SMS notifications.
 */

const AMOUNT_RECEIVED_RE =
  /(?:you\s+have\s+received|received)\s+ETB\s*([\d,]+(?:\.\d{1,2})?)/i;

const AMOUNT_RECEIVED_REVERSE =
  /(?:you\s+have\s+received|received)\s+([\d,]+(?:\.\d{1,2})?)\s*ETB/i;

const AMOUNT_FALLBACK_RE =
  /ETB\s*([\d,]+(?:\.\d{1,2})?)/i;

const CBE_REF_RE = /\bFT[0-9A-Z]{8,13}\b/i;

const TELEBIRR_REF_PATTERNS = [
  /transaction\s+number\s+(?:is\s+|:\s*)?([A-Z0-9]{6,20})/i,
  /transaction\s+(?:no\.?|id)\s*[:\-]?\s*([A-Z0-9]{6,20})/i,
  /\b(TB[0-9]{6,15})\b/i,
];

/**
 * Parse received amount.
 *
 * Examples:
 *   "You have received ETB 700.00"
 *   "received ETB 313.00"
 *   "You have received 700.00 ETB"
 */
function parseAmount(text) {
  let m = text.match(AMOUNT_RECEIVED_RE);

  if (!m) {
    m = text.match(AMOUNT_RECEIVED_REVERSE);
  }

  if (!m) {
    m = text.match(AMOUNT_FALLBACK_RE);
  }

  if (!m) return null;

  const cleaned = m[1].replace(/,/g, "");
  const value = Number.parseFloat(cleaned);

  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * CBE payer name.
 */
function parseCbeName(text) {
  // Example:
  // from account 1234567748 (Bereket Alemu) to your account
  const parenMatch = text.match(
    /from\s+account\s+[^\s(]+\s*\(([^)]+)\)/i
  );

  if (parenMatch) {
    return parenMatch[1].trim();
  }

  // Example:
  // from ALEM TESFAYE to your account
  const plainMatch = text.match(
    /\bfrom\s+([A-Za-z.\s]{2,60}?)(?:\s+to\b|\s+your\b|[.,]|$)/i
  );

  if (plainMatch) {
    return plainMatch[1].trim();
  }

  return null;
}

function parseCbe(text) {
  const amount = parseAmount(text);

  const refMatch = text.match(CBE_REF_RE);
  const ref = refMatch ? refMatch[0].toUpperCase() : null;

  const name = parseCbeName(text);

  return {
    provider: "CBE",
    amount,
    ref,
    name,
  };
}

/**
 * Telebirr payer/source name.
 *
 * Examples:
 *   from Alice Johnson (251912345678)
 *   from Awash International Bank S C to your telebirr Account
 */
function parseTelebirrName(text) {
  // "from Alice Johnson (2519...)"
  const withPhoneMatch = text.match(
    /\bfrom\s+([A-Za-z.\s]{2,60}?)\s*[\(\d]/i
  );

  if (withPhoneMatch) {
    return withPhoneMatch[1].trim();
  }

  // "from Awash International Bank S C to your telebirr Account"
  const toAccountMatch = text.match(
    /\bfrom\s+([A-Za-z0-9.\s]{2,60}?)\s+to\s+(?:your\s+)?telebirr\s+Account\b/i
  );

  if (toAccountMatch) {
    return toAccountMatch[1].trim();
  }

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

  return {
    provider: "TELEBIRR",
    amount,
    ref,
    name,
  };
}

function detectProvider(text) {
  const lower = text.toLowerCase();

  if (lower.includes("telebirr")) {
    return "TELEBIRR";
  }

  if (
    lower.includes("cbe") ||
    lower.includes("commercial bank")
  ) {
    return "CBE";
  }

  if (CBE_REF_RE.test(text)) {
    return "CBE";
  }

  return "TELEBIRR";
}

function parseBankSms(text, hintProvider) {
  const provider =
    hintProvider &&
    ["CBE", "TELEBIRR"].includes(hintProvider.toUpperCase())
      ? hintProvider.toUpperCase()
      : detectProvider(text);

  return provider === "CBE"
    ? parseCbe(text)
    : parseTelebirr(text);
}

/**
 * Loose name match for amount+name fallback.
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

module.exports = {
  parseBankSms,
  parseAmount,
  namesLooselyMatch,
};