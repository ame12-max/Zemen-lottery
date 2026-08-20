const crypto = require("crypto");
const { pool, withTransaction } = require("../config/db");
const { creditWithinTransaction } = require("./walletService");
const ApiError = require("../utils/ApiError");

const SPIN_COST_POINTS = 50;
const SPIN_MIN_REWARD = 5;
const SPIN_MAX_REWARD = 50;
const POINTS_PER_LEVEL = 100;
const POINTS_PER_100_ETB_DEPOSITED = 1;

async function ensureRow(userId, client = pool) {
  await client.query(
    `INSERT INTO user_points (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
}

function computeLevel(lifetimePoints) {
  return Math.floor(lifetimePoints / POINTS_PER_LEVEL) + 1;
}

async function getPoints(userId) {
  await ensureRow(userId);
  const { rows } = await pool.query(
    `SELECT lifetime_points, spendable_points FROM user_points WHERE user_id = $1`,
    [userId]
  );
  const row = rows[0];
  const lifetimePoints = Number(row.lifetime_points);
  const spendablePoints = Number(row.spendable_points);

  return {
    lifetimePoints,
    spendablePoints,
    level: computeLevel(lifetimePoints),
    pointsIntoLevel: lifetimePoints % POINTS_PER_LEVEL,
    pointsPerLevel: POINTS_PER_LEVEL,
    spinCost: SPIN_COST_POINTS,
    canSpin: spendablePoints >= SPIN_COST_POINTS,
  };
}

/**
 * Awards points for an approved deposit. MUST be called with the same
 * `client` (and therefore the same transaction) as the deposit's wallet
 * credit, so a crash between the two can't award points for money that
 * was never actually credited, or vice versa.
 * Rule: 1 point per 100 ETB deposited, rounded down.
 */
async function awardDepositPoints(client, userId, depositAmount) {
  const points = Math.floor(depositAmount / 100) * POINTS_PER_100_ETB_DEPOSITED;
  if (points <= 0) return 0;

  await ensureRow(userId, client);
  await client.query(
    `UPDATE user_points
     SET lifetime_points = lifetime_points + $1,
         spendable_points = spendable_points + $1,
         updated_at = now()
     WHERE user_id = $2`,
    [points, userId]
  );
  return points;
}

/**
 * Spends 50 spendable points for a random 5-50 ETB reward, credited to
 * the wallet as a BONUS ledger entry. Uses crypto.randomInt, same as the
 * ticket draw — it's still real money leaving the platform, so it gets
 * the same "no Math.random" treatment.
 */
async function spin(userId) {
  return withTransaction(async (client) => {
    await ensureRow(userId, client);

    const { rows } = await client.query(
      `SELECT spendable_points FROM user_points WHERE user_id = $1 FOR UPDATE`,
      [userId]
    );
    const spendable = Number(rows[0].spendable_points);
    if (spendable < SPIN_COST_POINTS) {
      throw new ApiError(
        400,
        `You need ${SPIN_COST_POINTS} points to spin (you have ${spendable})`
      );
    }

    const reward = crypto.randomInt(SPIN_MIN_REWARD, SPIN_MAX_REWARD + 1);

    await client.query(
      `UPDATE user_points
       SET spendable_points = spendable_points - $1, updated_at = now()
       WHERE user_id = $2`,
      [SPIN_COST_POINTS, userId]
    );

    const { rows: spinRows } = await client.query(
      `INSERT INTO spin_history (user_id, points_spent, reward_amount)
       VALUES ($1, $2, $3) RETURNING id`,
      [userId, SPIN_COST_POINTS, reward]
    );
    const spinId = spinRows[0].id;

    // Reference ties this ledger entry to the specific spin row, so it
    // can never be credited twice even if something retried this call.
    await creditWithinTransaction(client, userId, reward, "BONUS", `spin:${spinId}`);

    return { reward, spinId };
  });
}

/**
 * Generic points award not tied to a deposit — used for referral rewards
 * and any other future bonus source. Same transaction-scoping contract as
 * awardDepositPoints: pass the caller's client so it's atomic with
 * whatever triggered it.
 */
async function awardBonusPoints(client, userId, points) {
  if (points <= 0) return 0;
  await ensureRow(userId, client);
  await client.query(
    `UPDATE user_points
     SET lifetime_points = lifetime_points + $1,
         spendable_points = spendable_points + $1,
         updated_at = now()
     WHERE user_id = $2`,
    [points, userId]
  );
  return points;
}

module.exports = {
  getPoints,
  awardDepositPoints,
  awardBonusPoints,
  spin,
  SPIN_COST_POINTS,
  SPIN_MIN_REWARD,
  SPIN_MAX_REWARD,
};
