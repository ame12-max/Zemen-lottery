const { pool } = require("../config/db");
const { parseBankSms, namesLooselyMatch } = require("../utils/smsParser");
const depositRequestService = require("./depositRequestService");

/**
 * Ingests one SMS forwarded by the Android bridge (MacroDroid, or the
 * Termux script — either posts the same shape to this endpoint).
 *
 * Matching strategy, strongest signal first — never approves on amount
 * alone, since two different users can easily deposit the same amount
 * around the same time:
 *
 *   1. Reference match: exact transaction reference + amount + method +
 *      PENDING status. This is the strong case (typically Telebirr, and
 *      CBE when the SMS happens to include a "Ref no").
 *
 *   2. Amount + payer-name fallback: for messages with no extractable
 *      reference (common for CBE), match on amount + method + PENDING
 *      status, narrowed by a loose name match against what the user
 *      entered. Only auto-approves when this narrows candidates to
 *      EXACTLY ONE — any ambiguity (e.g. two users deposited the same
 *      amount that day) falls through to manual review instead of
 *      guessing.
 *
 * Either way, every message is logged to bank_sms_messages so the parser
 * and matching logic stay auditable.
 */
async function ingest({ text, sender, provider: providerHint }) {
    console.log("📥 [Service] ingest called with:", { text, sender, provider });

  if (!text || typeof text !== "string") {
    const err = new Error("`text` is required");
    err.statusCode = 400;
    throw err;
  }

  const parsed = parseBankSms(text, providerHint);
  const { provider, amount, ref, name } = parsed;

  console.log(parsed);
  let matchedRequestId = null;
  let matchStrategy = null;
  let status = "UNPARSEABLE";

  if (amount) {
    status = "UNMATCHED";

    // --- Strategy 1: exact reference match ---
    if (ref) {
      const { rows } = await pool.query(
        `SELECT id, amount FROM deposit_requests
         WHERE status = 'PENDING' AND method = $1 AND lower(transaction_ref) = lower($2)
         LIMIT 2`,
        [provider, ref]
      );
      // Exactly one PENDING request with this ref, and the amount also
      // checks out — a reference collision matching two different
      // pending requests should never happen (it's meant to be unique),
      // but if it somehow did, that's exactly the ambiguity we refuse
      // to guess through.
      if (rows.length === 1 && Number(rows[0].amount) === amount) {
        matchedRequestId = rows[0].id;
        matchStrategy = "reference";
      }
    }

    // --- Strategy 2: amount + payer-name fallback (no ref on the SMS) ---
    if (!matchedRequestId && name) {
      const { rows } = await pool.query(
        `SELECT id, sender_name FROM deposit_requests
         WHERE status = 'PENDING' AND method = $1 AND amount = $2
           AND created_at > now() - interval '48 hours'`,
        [provider, amount]
      );
      const candidates = rows.filter(
        (r) => r.sender_name && namesLooselyMatch(r.sender_name, name)
      );
      if (candidates.length === 1) {
        matchedRequestId = candidates[0].id;
        matchStrategy = "amount+name";
      }
      // 0 candidates -> genuinely no match. 2+ candidates -> ambiguous,
      // deliberately left for a human to sort out rather than guessing.
    }

    if (matchedRequestId) {
      try {
        await depositRequestService.approve(matchedRequestId, null, { auto: true });
        status = "MATCHED";
      } catch (err) {
        // Already reviewed by an admin in the meantime, or some other
        // conflict — leave it logged as unmatched rather than throwing,
        // since the SMS itself was still received successfully.
        matchedRequestId = null;
        matchStrategy = null;
        status = "UNMATCHED";
      }
    }
  }

  const { rows: logRows } = await pool.query(
    `INSERT INTO bank_sms_messages
       (provider, raw_text, sender_phone, parsed_amount, parsed_name, parsed_ref,
        matched_deposit_request_id, match_strategy, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      provider || "UNKNOWN",
      text,
      sender || null,
      amount,
      name,
      ref,
      matchedRequestId,
      matchStrategy,
      status,
    ]
  );

  return { logId: logRows[0].id, status, matchedRequestId, matchStrategy, parsed };
}

async function listRecent(limit = 100) {
  const { rows } = await pool.query(
    `SELECT * FROM bank_sms_messages ORDER BY received_at DESC LIMIT $1`,
    [limit]
  );
  return rows;
}

module.exports = { ingest, listRecent };
