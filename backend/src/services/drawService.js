const crypto = require("crypto");
const { withTransaction } = require("../config/db");
const { creditWithinTransaction } = require("./walletService");
const ApiError = require("../utils/ApiError");

/**
 * Draws a winner for a FULL game and pays out the prize.
 * Runs entirely server-side and inside one transaction so the game
 * can't be drawn twice and the payout can't be duplicated.
 *
 * Uses crypto.randomInt (CSPRNG), never Math.random, because the
 * output picks who receives real money.
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
      return { alreadyDrawn: true, winnerTicketId: game.winner_ticket_id };
    }
    if (game.status !== "FULL") {
      throw new ApiError(400, `Game is not ready to draw (status: ${game.status})`);
    }

    await client.query(`UPDATE games SET status = 'DRAWING' WHERE id = $1`, [gameId]);

    const { rows: tickets } = await client.query(
      `SELECT id, user_id, ticket_number FROM tickets
       WHERE game_id = $1 AND status = 'VALID'
       ORDER BY ticket_number ASC`,
      [gameId]
    );
    if (tickets.length === 0) throw new ApiError(400, "Game has no valid tickets");

    const winnerIndex = crypto.randomInt(0, tickets.length);
    const winner = tickets[winnerIndex];

    await client.query(
      `UPDATE games
       SET status = 'COMPLETED', winner_ticket_id = $1, completed_at = now()
       WHERE id = $2`,
      [winner.id, gameId]
    );

    // Reference is the game id — a game can only pay out once because
    // of the unique (type, reference) index on wallet_transactions.
    await creditWithinTransaction(
      client,
      winner.user_id,
      Number(game.prize_amount),
      "PRIZE",
      `game:${gameId}`
    );

    return {
      alreadyDrawn: false,
      winnerTicketId: winner.id,
      winnerUserId: winner.user_id,
      winnerTicketNumber: winner.ticket_number,
    };
  });
}

module.exports = { drawWinner };
