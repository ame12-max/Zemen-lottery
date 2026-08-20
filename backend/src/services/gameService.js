const { pool, withTransaction } = require("../config/db");
const { debitWithinTransaction } = require("./walletService");
const { drawWinner } = require("./drawService");
const ApiError = require("../utils/ApiError");

async function createGame({ name, ticketPrice, maxTickets, prizeAmount, createdBy }) {
  if (!name || !Number.isInteger(ticketPrice) || ticketPrice <= 0) {
    throw new ApiError(400, "Invalid game parameters");
  }
  if (!Number.isInteger(maxTickets) || maxTickets < 2) {
    throw new ApiError(400, "maxTickets must be an integer >= 2");
  }
  if (!Number.isInteger(prizeAmount) || prizeAmount <= 0) {
    throw new ApiError(400, "prizeAmount must be a positive integer");
  }

  const { rows } = await pool.query(
    `INSERT INTO games (name, ticket_price, max_tickets, prize_amount, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [name, ticketPrice, maxTickets, prizeAmount, createdBy]
  );
  return rows[0];
}

async function listGames(status = "OPEN") {
  const { rows } = await pool.query(
    `SELECT g.*, COUNT(t.id) FILTER (WHERE t.status = 'VALID') AS tickets_sold
     FROM games g
     LEFT JOIN tickets t ON t.game_id = g.id
     WHERE g.status = $1
     GROUP BY g.id
     ORDER BY g.created_at DESC`,
    [status]
  );
  return rows;
}

async function getGame(gameId) {
  const { rows } = await pool.query(
    `SELECT g.*,
            COUNT(t.id) FILTER (WHERE t.status = 'VALID') AS tickets_sold,
            winner.ticket_number AS winner_ticket_number
     FROM games g
     LEFT JOIN tickets t ON t.game_id = g.id
     LEFT JOIN tickets winner ON winner.id = g.winner_ticket_id
     WHERE g.id = $1
     GROUP BY g.id, winner.ticket_number`,
    [gameId]
  );
  if (rows.length === 0) throw new ApiError(404, "Game not found");
  return rows[0];
}

/**
 * Returns the sold ticket numbers for a game, so the UI can render an
 * accurate picker (which numbers are taken vs. available) instead of
 * just a count.
 */
async function getSoldTicketNumbers(gameId) {
  const { rows } = await pool.query(
    `SELECT ticket_number, user_id FROM tickets WHERE game_id = $1 AND status = 'VALID' ORDER BY ticket_number`,
    [gameId]
  );
  return rows;
}

/**
 * Recently completed draws, for the "winner announcement" banner shown
 * to users on login. Public-ish (any authed user can see who won what) —
 * that's intentional for a raffle: publishing winners builds trust.
 */
async function getRecentWinners(limit = 10) {
  const { rows } = await pool.query(
    `SELECT g.id AS game_id, g.name AS game_name, g.prize_amount, g.completed_at,
            t.ticket_number AS winner_ticket_number,
            u.name AS winner_name
     FROM games g
     JOIN tickets t ON t.id = g.winner_ticket_id
     JOIN users u ON u.id = t.user_id
     WHERE g.status = 'COMPLETED'
     ORDER BY g.completed_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}

/**
 * The critical path: purchasing a ticket.
 *
 * Everything happens inside one transaction, and the game row is locked
 * FIRST with SELECT ... FOR UPDATE. That serializes concurrent buyers of
 * the same game — the second concurrent request has to wait for the
 * first to commit (or roll back) before it can see an up-to-date ticket
 * count, which is exactly what prevents ticket #16 being sold for a
 * 15-ticket game.
 *
 * `requestedTicketNumber` lets a user pick a specific number out of the
 * pool. If omitted, falls back to the next sequential number. Either way,
 * the DB's UNIQUE (game_id, ticket_number) constraint is the final backstop
 * against two people getting the same number — caught below as a 409.
 */
async function buyTicket(gameId, userId, requestedTicketNumber) {
  const result = await withTransaction(async (client) => {
    const { rows: gameRows } = await client.query(
      `SELECT * FROM games WHERE id = $1 FOR UPDATE`,
      [gameId]
    );
    if (gameRows.length === 0) throw new ApiError(404, "Game not found");
    const game = gameRows[0];

    if (game.status !== "OPEN") {
      throw new ApiError(400, `Game is not open for ticket purchases (status: ${game.status})`);
    }

    const { rows: countRows } = await client.query(
      `SELECT COUNT(*)::int AS sold FROM tickets WHERE game_id = $1 AND status = 'VALID'`,
      [gameId]
    );
    const sold = countRows[0].sold;
    if (sold >= game.max_tickets) {
      // Shouldn't happen given the lock, but guard anyway.
      throw new ApiError(400, "Game is already full");
    }

    let ticketNumber;
    if (requestedTicketNumber !== undefined && requestedTicketNumber !== null) {
      ticketNumber = Number(requestedTicketNumber);
      if (!Number.isInteger(ticketNumber) || ticketNumber < 1 || ticketNumber > game.max_tickets) {
        throw new ApiError(400, `Ticket number must be between 1 and ${game.max_tickets}`);
      }
    } else {
      ticketNumber = sold + 1;
    }

    const price = Number(game.ticket_price);

    // Debit wallet — this itself takes a row lock on the wallet and
    // throws if balance is insufficient, rolling back the whole transaction.
    await debitWithinTransaction(
      client,
      userId,
      price,
      "TICKET",
      `game:${gameId}:ticket:${ticketNumber}:user:${userId}`
    );

    let ticket;
    try {
      const { rows: ticketRows } = await client.query(
        `INSERT INTO tickets (game_id, user_id, ticket_number, price)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [gameId, userId, ticketNumber, price]
      );
      ticket = ticketRows[0];
    } catch (err) {
      if (err.code === "23505") {
        // Someone else already holds this exact number — the game-row lock
        // makes this rare (it'd require the earlier holder to have committed
        // within the same locked window), but a picked number can still
        // collide with a sequential buyer, so handle it explicitly.
        throw new ApiError(409, `Ticket #${ticketNumber} was just taken. Pick another.`);
      }
      throw err;
    }

    const newSoldCount = sold + 1;
    const isNowFull = newSoldCount === game.max_tickets;
    if (isNowFull) {
      await client.query(`UPDATE games SET status = 'FULL' WHERE id = $1`, [gameId]);
    }

    return { ticket, isNowFull };
  });

  // Draw runs in its own transaction, after the ticket-purchase transaction
  // has committed, so the buyer's own request isn't blocked waiting on the
  // draw, and a draw failure can't roll back a legitimately sold ticket.
  if (result.isNowFull) {
    await drawWinner(gameId);
  }

  return result.ticket;
}

async function myTickets(userId) {
  const { rows } = await pool.query(
    `SELECT t.*, g.name AS game_name, g.status AS game_status, g.winner_ticket_id
     FROM tickets t
     JOIN games g ON g.id = t.game_id
     WHERE t.user_id = $1
     ORDER BY t.created_at DESC`,
    [userId]
  );
  return rows;
}

/**
 * Wins the user hasn't seen the congratulation popup for yet. Shown once,
 * on login — see acknowledgeWin() for how it gets marked seen.
 */
async function getUnseenWins(userId) {
  const { rows } = await pool.query(
    `SELECT g.id AS game_id, g.name AS game_name, g.prize_amount, g.completed_at,
            t.id AS ticket_id, t.ticket_number
     FROM tickets t
     JOIN games g ON g.id = t.game_id AND g.winner_ticket_id = t.id
     WHERE t.user_id = $1 AND t.win_seen = false AND g.status = 'COMPLETED'
     ORDER BY g.completed_at ASC`,
    [userId]
  );
  return rows;
}

/**
 * Marks a win's popup as seen. Scoped to the requesting user's own ticket
 * so nobody can mark someone else's win acknowledged.
 */
async function acknowledgeWin(userId, ticketId) {
  const { rows } = await pool.query(
    `UPDATE tickets SET win_seen = true WHERE id = $1 AND user_id = $2 RETURNING id`,
    [ticketId, userId]
  );
  if (rows.length === 0) throw new ApiError(404, "Ticket not found");
  return { id: rows[0].id };
}

module.exports = {
  createGame,
  listGames,
  getGame,
  buyTicket,
  myTickets,
  getSoldTicketNumbers,
  getRecentWinners,
  getUnseenWins,
  acknowledgeWin,
};
