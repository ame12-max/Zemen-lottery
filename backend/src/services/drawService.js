const crypto = require("crypto");
const { withTransaction } = require("../config/db");
const { creditWithinTransaction } = require("./walletService");
const ApiError = require("../utils/ApiError");

/**
 * Draws winners for a FULL game — one ticket per prize tier — and pays
 * each out. Runs entirely server-side inside one transaction so the game
 * can't be drawn twice and no payout can be duplicated.
 *
 * Selection is sampling WITHOUT replacement: a Fisher-Yates-style partial
 * shuffle using crypto.randomInt (never Math.random, since this picks who
 * receives real money) pulls one ticket per tier, so the same ticket can
 * never win two ranks. Rank order = draw order — the first ticket pulled
 * gets rank 1 (the largest prize, by convention of how tiers are entered).
 */
async function drawWinner(gameId) {
  return withTransaction(async (client) => {
    const { rows: gameRows } = await client.query(
      `SELECT * FROM games WHERE id = $1 FOR UPDATE`,
      [gameId]
    );
    if (gameRows.length === 0) throw new ApiError(404, "Game not found");
    const game = gameRows[0];

    if (game.status === "COMPLETED") {
      // Already drawn — return existing result instead of erroring,
      // so a retried request is safe.
      const { rows: existingWinners } = await client.query(
        `SELECT rank, ticket_id, user_id, prize_amount FROM game_winners WHERE game_id = $1 ORDER BY rank`,
        [gameId]
      );
      return { alreadyDrawn: true, winners: existingWinners };
    }
    if (game.status !== "FULL") {
      throw new ApiError(400, `Game is not ready to draw (status: ${game.status})`);
    }

    await client.query(`UPDATE games SET status = 'DRAWING' WHERE id = $1`, [gameId]);

    const { rows: tiers } = await client.query(
      `SELECT rank, prize_amount FROM game_prize_tiers WHERE game_id = $1 ORDER BY rank ASC`,
      [gameId]
    );
    if (tiers.length === 0) throw new ApiError(400, "Game has no prize tiers configured");

    const { rows: tickets } = await client.query(
      `SELECT id, user_id, ticket_number FROM tickets
       WHERE game_id = $1 AND status = 'VALID'
       ORDER BY ticket_number ASC`,
      [gameId]
    );
    if (tickets.length < tiers.length) {
      throw new ApiError(400, "Not enough valid tickets to fill every prize tier");
    }

    // Partial Fisher-Yates: only need tiers.length winners, not a full shuffle.
    const pool = [...tickets];
    const drawn = [];
    for (let i = 0; i < tiers.length; i++) {
      const idx = crypto.randomInt(0, pool.length);
      drawn.push(pool[idx]);
      pool.splice(idx, 1);
    }

    const winners = [];
    for (let i = 0; i < tiers.length; i++) {
      const tier = tiers[i];
      const ticket = drawn[i];
      const prizeAmount = Number(tier.prize_amount);

      await client.query(
        `INSERT INTO game_winners (game_id, rank, ticket_id, user_id, prize_amount)
         VALUES ($1, $2, $3, $4, $5)`,
        [gameId, tier.rank, ticket.id, ticket.user_id, prizeAmount]
      );

      // Reference includes the rank, so each tier's payout is independently
      // idempotent — a retry can't double-pay any one rank.
      await creditWithinTransaction(
        client,
        ticket.user_id,
        prizeAmount,
        "PRIZE",
        `game:${gameId}:rank:${tier.rank}`
      );

      winners.push({
        rank: tier.rank,
        ticketId: ticket.id,
        ticketNumber: ticket.ticket_number,
        userId: ticket.user_id,
        prizeAmount,
      });
    }

    // winner_ticket_id kept in sync with rank 1 for any simple/legacy
    // display that only cares about "the" winner.
    await client.query(
      `UPDATE games
       SET status = 'COMPLETED', winner_ticket_id = $1, completed_at = now()
       WHERE id = $2`,
      [winners[0].ticketId, gameId]
    );

    return { alreadyDrawn: false, winners };
  });
}

module.exports = { drawWinner };
