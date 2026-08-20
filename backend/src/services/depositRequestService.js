const { pool, withTransaction } = require("../config/db");
const { creditWithinTransaction } = require("./walletService");
const pointsService = require("./pointsService");
const referralService = require("./referralService");
const ApiError = require("../utils/ApiError");

async function createRequest(userId, amount, method, screenshotPath, extracted = {}) {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new ApiError(400, "Amount must be a positive whole number");
  }
  if (!["CBE", "TELEBIRR"].includes(method)) {
    throw new ApiError(400, "Method must be CBE or TELEBIRR");
  }

  const { ocrTransactionId = null, ocrAmount = null, declaredReference = null } = extracted;

  const { rows } = await pool.query(
    `INSERT INTO deposit_requests
       (user_id, amount, method, screenshot_path, ocr_transaction_id, ocr_amount, declared_reference)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, amount, method, status, ocr_transaction_id, created_at`,
    [userId, amount, method, screenshotPath, ocrTransactionId, ocrAmount, declaredReference]
  );
  return rows[0];
}

async function listForUser(userId) {
  const { rows } = await pool.query(
    `SELECT id, amount, method, status, verification_source, admin_note, created_at, reviewed_at
     FROM deposit_requests WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );
  return rows;
}

async function listForAdmin(status) {
  const { rows } = await pool.query(
    `SELECT dr.id, dr.amount, dr.method, dr.status, dr.verification_source,
            dr.ocr_transaction_id, dr.declared_reference, dr.created_at, dr.reviewed_at,
            u.id AS user_id, u.name AS user_name, u.phone AS user_phone
     FROM deposit_requests dr
     JOIN users u ON u.id = dr.user_id
     WHERE ($1::text IS NULL OR dr.status = $1)
     ORDER BY dr.created_at DESC
     LIMIT 200`,
    [status || null]
  );
  return rows;
}

async function getScreenshotPath(requestId) {
  const { rows } = await pool.query(
    `SELECT screenshot_path FROM deposit_requests WHERE id = $1`,
    [requestId]
  );
  if (rows.length === 0) throw new ApiError(404, "Deposit request not found");
  return rows[0].screenshot_path;
}

/**
 * Shared approval core. Assumes it's called from WITHIN an existing
 * transaction (`client`) with the row not yet locked — it takes the lock
 * itself. Used by both:
 *  - `approve()` below (manual admin click, wraps its own transaction)
 *  - `autoVerificationService` (system-triggered match, wraps its own
 *    transaction alongside marking the matched bank_messages row)
 *
 * `reviewedBy` is null for AUTO approvals — there's no admin to attribute
 * it to.
 */
async function runApprovalWithinTransaction(client, requestId, { reviewedBy, source }) {
  const { rows } = await client.query(
    `SELECT * FROM deposit_requests WHERE id = $1 FOR UPDATE`,
    [requestId]
  );
  if (rows.length === 0) throw new ApiError(404, "Deposit request not found");
  const reqRow = rows[0];
  if (reqRow.status !== "PENDING") {
    throw new ApiError(400, `Request already ${reqRow.status.toLowerCase()}`);
  }

  await client.query(
    `UPDATE deposit_requests
     SET status = 'APPROVED', verification_source = $1, reviewed_by = $2, reviewed_at = now()
     WHERE id = $3`,
    [source, reviewedBy, requestId]
  );

  // Reference ties the ledger entry to this exact request, so approving
  // twice (e.g. a double click, or a race with auto-verification) can't
  // double-credit — the second attempt already fails the PENDING check above.
  await creditWithinTransaction(
    client,
    reqRow.user_id,
    Number(reqRow.amount),
    "DEPOSIT",
    `deposit-request:${requestId}`
  );

  const pointsEarned = await pointsService.awardDepositPoints(
    client,
    reqRow.user_id,
    Number(reqRow.amount)
  );

  const referralResult = await referralService.processReferralReward(
    client,
    reqRow.user_id,
    Number(reqRow.amount),
    requestId
  );

  return { id: requestId, status: "APPROVED", source, pointsEarned, referralResult };
}

async function approve(requestId, adminId) {
  return withTransaction((client) =>
    runApprovalWithinTransaction(client, requestId, { reviewedBy: adminId, source: "MANUAL" })
  );
}

async function reject(requestId, adminId, note) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM deposit_requests WHERE id = $1 FOR UPDATE`,
      [requestId]
    );
    if (rows.length === 0) throw new ApiError(404, "Deposit request not found");
    if (rows[0].status !== "PENDING") {
      throw new ApiError(400, `Request already ${rows[0].status.toLowerCase()}`);
    }

    await client.query(
      `UPDATE deposit_requests
       SET status = 'REJECTED', admin_note = $1, reviewed_by = $2, reviewed_at = now()
       WHERE id = $3`,
      [note || null, adminId, requestId]
    );

    return { id: requestId, status: "REJECTED" };
  });
}

module.exports = {
  createRequest,
  listForUser,
  listForAdmin,
  getScreenshotPath,
  runApprovalWithinTransaction,
  approve,
  reject,
};
