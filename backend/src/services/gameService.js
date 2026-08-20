const { pool, withTransaction } = require("../config/db");
const { debitWithinTransaction, creditWithinTransaction } = require("./walletService");
const { drawWinner } = require("./drawService");
const ApiError = require("../utils/ApiError");

/**
 * Validates a prize tier list: ranks must be sequential starting at 1
 * (1st, 2nd, 3rd...), each amount a positive integer, and there can't be
 * more winners than tickets available.
 */
function validateTiers(prizeTiers, maxTickets) {
  if (!Array.isArray(prizeTiers) || prizeTiers.length === 0) {
    throw new ApiError(400, "At least one prize tier is required");
  }
  if (prizeTiers.length > maxTickets) {
    throw new ApiError(400, "Cannot have more prize winners than max tickets");
  }
  const ranks = prizeTiers.map((t) => Number(t.rank)).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) {
      throw new ApiError(400, "Prize ranks must be sequential starting at 1 (1st, 2nd, 3rd...)");
    }
  }
  for (const tier of prizeTiers) {
    if (!Number.isInteger(tier.prizeAmount) || tier.prizeAmount <= 0) {
      throw new ApiError(400, "Each prize amount must be a positive whole number");
    }
  }
}

async function createGame({ name, ticketPrice, maxTickets, prizeTiers, createdBy }) {
  if (!name || !Number.isInteger(ticketPrice) || ticketPrice <= 0) {
    throw new ApiError(400, "Invalid game parameters");
  }
  if (!Number.isInteger(maxTickets) || maxTickets < 2) {
    throw new ApiError(400, "maxTickets must be an integer >= 2");
  }
  validateTiers(prizeTiers, maxTickets);

  const totalPrize = prizeTiers.reduce((sum, t) => sum + t.prizeAmount, 0);

  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO games (name, ticket_price, max_tickets, prize_amount, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [name, ticketPrice, maxTickets, totalPrize, createdBy]
    );
    const game = rows[0];

    for (const tier of prizeTiers) {
      await client.query(
        `INSERT INTO game_prize_tiers (game_id, rank, prize_amount) VALUES ($1, $2, $3)`,
        [game.id, tier.rank, tier.prizeAmount]
      );
    }

    return { ...game, prize_tiers: prizeTiers };
  });
}

/**
 * Edits a pool's core parameters and prize tiers. Only allowed while the
 * pool is OPEN with zero tickets sold — once anyone has bought in, the
 * rules they saw (price, tier structure) can't change out from under them.
 */
async function updateGame(gameId, { name, ticketPrice, maxTickets, prizeTiers }) {
  if (!name || !Number.isInteger(ticketPrice) || ticketPrice <= 0) {
    throw new ApiError(400, "Invalid game parameters");
  }
  if (!Number.isInteger(maxTickets) || maxTickets < 2) {
    throw new ApiError(400, "maxTickets must be an integer >= 2");
  }
  validateTiers(prizeTiers, maxTickets);

  return withTransaction(async (client) => {
    const { rows } = await client.query(`SELECT * FROM games WHERE id = $1 FOR UPDATE`, [gameId]);
    if (rows.length === 0) throw new ApiError(404, "Game not found");
    const game = rows[0];
    if (game.status !== "OPEN") {
      throw new ApiError(400, "Only OPEN pools can be edited");
    }

    const { rows: soldRows } = await client.query(
      `SELECT COUNT(*)::int AS sold FROM tickets WHERE game_id = $1 AND status = 'VALID'`,
      [gameId]
    );
    if (soldRows[0].sold > 0) {
      throw new ApiError(400, "Cannot edit a pool once tickets have been sold");
    }

    const totalPrize = prizeTiers.reduce((sum, t) => sum + t.prizeAmount, 0);

    await client.query(
      `UPDATE games SET name = $1, ticket_price = $2, max_tickets = $3, prize_amount = $4 WHERE id = $5`,
      [name, ticketPrice, maxTickets, totalPrize, gameId]
    );
    await client.query(`DELETE FROM game_prize_tiers WHERE game_id = $1`, [gameId]);
    for (const tier of prizeTiers) {
      await client.query(
        `INSERT INTO game_prize_tiers (game_id, rank, prize_amount) VALUES ($1, $2, $3)`,
        [gameId, tier.rank, tier.prizeAmount]
      );
    }

    return { id: gameId };
  });
}

/**
 * Deletes or cancels a pool depending on its state:
 *  - No tickets sold yet: hard delete, nothing to unwind.
 *  - Tickets already sold (but not yet drawn): cancels the pool and
 *    refunds every buyer their ticket price.
 *  - Already COMPLETED: refused — it's a paid-out historical record.
 */
async function deleteOrCancelGame(gameId) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(`SELECT * FROM games WHERE id = $1 FOR UPDATE`, [gameId]);
    if (rows.length === 0) throw new ApiError(404, "Game not found");
    const game = rows[0];

    if (game.status === "COMPLETED") {
      throw new ApiError(400, "Cannot delete a completed pool — it's already been paid out");
    }
    if (game.status === "CANCELLED") {
      throw new ApiError(400, "Pool is already cancelled");
    }

    const { rows: tickets } = await client.query(
      `SELECT id, user_id, price FROM tickets WHERE game_id = $1 AND status = 'VALID'`,
      [gameId]
    );

    if (tickets.length === 0) {
      await client.query(`DELETE FROM games WHERE id = $1`, [gameId]);
      return { deleted: true, cancelled: false, refundedTickets: 0 };
    }

    for (const ticket of tickets) {
      await creditWithinTransaction(
        client,
        ticket.user_id,
        Number(ticket.price),
        "REFUND",
        `game-cancel:${gameId}:ticket:${ticket.id}`
      );
      await client.query(`UPDATE tickets SET status = 'CANCELLED' WHERE id = $1`, [ticket.id]);
    }
    await client.query(`UPDATE games SET status = 'CANCELLED' WHERE id = $1`, [gameId]);

    return { deleted: false, cancelled: true, refundedTickets: tickets.length };
  });
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
  const games = rows;
  await attachTopTier(games);
  return games;
}

/** Attaches each game's rank-1 (top) prize tier for card/list display. */
async function attachTopTier(games) {
  if (games.length === 0) return;
  const { rows: topTiers } = await pool.query(
    `SELECT DISTINCT ON (game_id) game_id, prize_amount
     FROM game_prize_tiers
     WHERE game_id = ANY($1::bigint[])
     ORDER BY game_id, rank ASC`,
    [games.map((g) => g.id)]
  );
  const byGame = new Map(topTiers.map((t) => [String(t.game_id), Number(t.prize_amount)]));
  for (const g of games) g.top_prize = byGame.get(String(g.id)) ?? Number(g.prize_amount);
}

/** Admin listing — every status, for pool management. */
async function listAllGamesForAdmin() {
  const { rows } = await pool.query(
    `SELECT g.*, COUNT(t.id) FILTER (WHERE t.status = 'VALID') AS tickets_sold
     FROM games g
     LEFT JOIN tickets t ON t.game_id = g.id
     GROUP BY g.id
     ORDER BY g.created_at DESC`
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
  const game = rows[0];

  const { rows: tiers } = await pool.query(
    `SELECT rank, prize_amount FROM game_prize_tiers WHERE game_id = $1 ORDER BY rank ASC`,
    [gameId]
  );
  game.prize_tiers = tiers;
  return game;
}

/** Full winner breakdown for a completed game — rank, ticket, prize, user. */
async function getGameWinners(gameId) {
  const { rows } = await pool.query(
    `SELECT gw.rank, gw.prize_amount, gw.user_id, t.ticket_number, u.name AS winner_name
     FROM game_winners gw
     JOIN tickets t ON t.id = gw.ticket_id
     JOIN users u ON u.id = gw.user_id
     WHERE gw.game_id = $1
     ORDER BY gw.rank ASC`,
    [gameId]
  );
  return rows;
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
 * to users on login. One row per (game, rank) — a multi-tier game yields
 * several rows, which the banner already cycles through naturally.
 * Public-ish (any authed user can see who won what) — intentional for a
 * raffle: publishing winners builds trust.
 */
async function getRecentWinners(limit = 10) {
  const { rows } = await pool.query(
    `SELECT g.id AS game_id, g.name AS game_name, gw.prize_amount, gw.rank, g.completed_at,
            t.ticket_number AS winner_ticket_number,
            u.name AS winner_name
     FROM game_winners gw
     JOIN games g ON g.id = gw.game_id
     JOIN tickets t ON t.id = gw.ticket_id
     JOIN users u ON u.id = gw.user_id
     WHERE g.status = 'COMPLETED'
     ORDER BY g.completed_at DESC, gw.rank ASC
     LIMIT $1`,
    [limit]
  );
  return rows;
}

/**
 * A user's own wins that haven't been shown to them yet — powers the
 * personal "congratulations, you won!" popup shown right after login.
 * Distinct from getRecentWinners, which is the public ticker banner
 * everyone sees regardless of whether they personally won anything.
 */
async function getMyUnseenWins(userId) {
  const { rows } = await pool.query(
    `SELECT gw.id, gw.rank, gw.prize_amount, g.id AS game_id, g.name AS game_name,
            t.ticket_number
     FROM game_winners gw
     JOIN games g ON g.id = gw.game_id
     JOIN tickets t ON t.id = gw.ticket_id
     WHERE gw.user_id = $1 AND gw.acknowledged_at IS NULL
     ORDER BY gw.created_at ASC`,
    [userId]
  );
  return rows;
}

/** Marks one win as seen. Ownership-checked — can only ack your own win. */
async function acknowledgeWin(userId, winId) {
  const { rows } = await pool.query(
    `UPDATE game_winners SET acknowledged_at = now()
     WHERE id = $1 AND user_id = $2 AND acknowledged_at IS NULL
     RETURNING id`,
    [winId, userId]
  );
  if (rows.length === 0) throw new ApiError(404, "Win not found");
  return { id: rows[0].id };
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
    `SELECT t.*, g.name AS game_name, g.status AS game_status,
            gw.rank AS won_rank, gw.prize_amount AS won_amount
     FROM tickets t
     JOIN games g ON g.id = t.game_id
     LEFT JOIN game_winners gw ON gw.ticket_id = t.id
     WHERE t.user_id = $1
     ORDER BY t.created_at DESC`,
    [userId]
  );
  return rows;
}

module.exports = {
  createGame,
  updateGame,
  deleteOrCancelGame,
  listGames,
  listAllGamesForAdmin,
  getGame,
  getGameWinners,
  buyTicket,
  myTickets,
  getSoldTicketNumbers,
  getRecentWinners,
  getMyUnseenWins,
  acknowledgeWin,
};
