const crypto = require("crypto");
const { pool } = require("../config/db");
const { creditWithinTransaction } = require("./walletService");
const pointsService = require("./pointsService");

const REFERRAL_REWARD_ETB = Number(process.env.REFERRAL_REWARD_ETB || 10);
const REFERRAL_REWARD_POINTS = Number(process.env.REFERRAL_REWARD_POINTS || 5);
const REFERRAL_MIN_DEPOSIT = Number(process.env.REFERRAL_MIN_DEPOSIT || 100);

function generateCode() {
  return crypto.randomBytes(5).toString("hex").toUpperCase().slice(0, 8);
}

/**
 * Generates a unique referral code for a new user. Retries a handful of
 * times on the rare collision — 8 hex chars is a big enough space that
 * this is mostly a formality, but a fixed retry loop is safer than
 * assuming uniqueness.
 */
async function generateUniqueCode(client) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    const { rows } = await client.query(`SELECT 1 FROM users WHERE referral_code = $1`, [code]);
    if (rows.length === 0) return code;
  }
  throw new Error("Could not generate a unique referral code — try again");
}

async function findInviterByCode(code) {
  if (!code) return null;
  const { rows } = await pool.query(`SELECT id FROM users WHERE referral_code = $1`, [
    code.trim().toUpperCase(),
  ]);
  return rows[0]?.id || null;
}

/**
 * Called once, inside the same transaction as a user's registration, to
 * record that they were referred (if a valid code was supplied). Reward
 * isn't paid yet — that happens on the invitee's first qualifying deposit.
 */
async function recordReferralIfAny(client, inviterId, inviteeId) {
  if (!inviterId) return;
  await client.query(
    `INSERT INTO referrals (inviter_id, invitee_id) VALUES ($1, $2)
     ON CONFLICT (invitee_id) DO NOTHING`,
    [inviterId, inviteeId]
  );
}

/**
 * Checks whether an approved deposit should trigger a referral reward, and
 * pays it out if so. MUST be called with the same `client`/transaction as
 * the deposit's own wallet credit — reward and deposit succeed or fail
 * together.
 *
 * Reward rule: the invitee's FIRST deposit of at least REFERRAL_MIN_DEPOSIT
 * ETB triggers a one-time reward to the inviter. Deliberately one-time —
 * without that, a referral pair could repeatedly deposit/withdraw to farm
 * rewards indefinitely.
 */
async function processReferralReward(client, invoiceeUserId, depositAmount, depositRequestId) {
  if (depositAmount < REFERRAL_MIN_DEPOSIT) return null;

  const { rows } = await client.query(
    `SELECT * FROM referrals WHERE invitee_id = $1 AND status = 'PENDING' FOR UPDATE`,
    [invoiceeUserId]
  );
  const referral = rows[0];
  if (!referral) return null; // not referred, or already rewarded

  await client.query(
    `UPDATE referrals
     SET status = 'REWARDED', reward_amount = $1, points_awarded = $2,
         triggering_deposit_request_id = $3, rewarded_at = now()
     WHERE id = $4`,
    [REFERRAL_REWARD_ETB, REFERRAL_REWARD_POINTS, depositRequestId, referral.id]
  );

  await creditWithinTransaction(
    client,
    referral.inviter_id,
    REFERRAL_REWARD_ETB,
    "REFERRAL_BONUS",
    `referral:${referral.id}`
  );
  await pointsService.awardBonusPoints(client, referral.inviter_id, REFERRAL_REWARD_POINTS);

  return { inviterId: referral.inviter_id, reward: REFERRAL_REWARD_ETB, points: REFERRAL_REWARD_POINTS };
}

async function getMyReferralInfo(userId) {
  const { rows: userRows } = await pool.query(`SELECT referral_code FROM users WHERE id = $1`, [
    userId,
  ]);
  const { rows: referrals } = await pool.query(
    `SELECT r.status, r.reward_amount, r.points_awarded, r.created_at, r.rewarded_at,
            u.name AS invitee_name, u.phone AS invitee_phone
     FROM referrals r
     JOIN users u ON u.id = r.invitee_id
     WHERE r.inviter_id = $1
     ORDER BY r.created_at DESC`,
    [userId]
  );
  return {
    referralCode: userRows[0]?.referral_code || null,
    rewardPerReferral: REFERRAL_REWARD_ETB,
    pointsPerReferral: REFERRAL_REWARD_POINTS,
    minimumDeposit: REFERRAL_MIN_DEPOSIT,
    referrals,
  };
}

module.exports = {
  generateUniqueCode,
  findInviterByCode,
  recordReferralIfAny,
  processReferralReward,
  getMyReferralInfo,
};
