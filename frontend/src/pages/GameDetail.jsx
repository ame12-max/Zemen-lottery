import React, { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import TicketBoard from "../components/TicketBoard.jsx";
import DrawReel from "../components/DrawReel.jsx";
import { api } from "../services/api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";

const STATUS_COPY = {
  OPEN: "Pool is open — pick any available ticket.",
  FULL: "Pool just filled. Drawing now…",
  DRAWING: "Drawing in progress…",
  COMPLETED: "Draw complete.",
  CANCELLED: "This pool was cancelled.",
};

export default function GameDetail() {
  const { gameId } = useParams();
  const { user } = useAuth();
  const { showToast } = useToast();
  const { t } = useLanguage();

  const [game, setGame] = useState(null);
  const [soldTickets, setSoldTickets] = useState([]); // [{ ticket_number, user_id }]
  const [error, setError] = useState(null);
  const [selectedNumber, setSelectedNumber] = useState(null);
  const [buying, setBuying] = useState(false);
  const [buyError, setBuyError] = useState(null);

  const fetchAll = useCallback(async () => {
    try {
      const [gameData, ticketsData] = await Promise.all([
        api.getGame(gameId),
        api.getGameTickets(gameId),
      ]);
      setGame(gameData.game);
      setSoldTickets(ticketsData.tickets);
    } catch (err) {
      setError(err.message);
    }
  }, [gameId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Poll while the pool is still active so everyone sees it fill/draw live.
  useEffect(() => {
    if (!game || game.status === "COMPLETED" || game.status === "CANCELLED") return;
    const interval = setInterval(fetchAll, 4000);
    return () => clearInterval(interval);
  }, [game, fetchAll]);

  async function handleBuy() {
    if (!selectedNumber) return;
    setBuying(true);
    setBuyError(null);
    try {
      const { ticket } = await api.buyTicket(gameId, selectedNumber);
      showToast(`You bought ticket #${ticket.ticket_number}! Good luck.`, "success");
      setSelectedNumber(null);
      fetchAll();
    } catch (err) {
      setBuyError(err.message);
      // If the number was taken between clicks, refresh so the board updates.
      fetchAll();
    } finally {
      setBuying(false);
    }
  }

  if (error) return <div className="mx-auto max-w-2xl px-4 py-8 text-brick">{error}</div>;
  if (!game) return <div className="mx-auto max-w-2xl px-4 py-8 text-mist">Loading…</div>;

  const soldNumbers = new Set(soldTickets.map((t) => t.ticket_number));
  const ownedNumbers = new Set(
    soldTickets.filter((t) => String(t.user_id) === String(user.id)).map((t) => t.ticket_number)
  );
  const sold = soldTickets.length;
  const canBuy = game.status === "OPEN" && sold < game.max_tickets;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <h1 className="font-display text-3xl tracking-widest text-paper">{game.name}</h1>
      <p className="mb-6 text-sm text-mist">{STATUS_COPY[game.status]}</p>

      <div className="mb-6 grid grid-cols-3 gap-3 font-mono">
        <div className="rounded bg-surface p-3 text-center">
          <div className="text-xs text-mist">Ticket price</div>
          <div className="text-lg font-semibold">{game.ticket_price} ETB</div>
        </div>
        <div className="rounded bg-surface p-3 text-center">
          <div className="text-xs text-mist">Prize</div>
          <div className="text-lg font-semibold text-gold">{game.prize_amount} ETB</div>
        </div>
        <div className="rounded bg-surface p-3 text-center">
          <div className="text-xs text-mist">Sold</div>
          <div className="text-lg font-semibold">
            {sold}/{game.max_tickets}
          </div>
        </div>
      </div>

      <div className="mb-6 rounded-lg bg-surface p-5">
        <h2 className="mb-3 font-display tracking-widest text-mist">TICKET BOARD</h2>
        <TicketBoard
          maxTickets={game.max_tickets}
          soldNumbers={soldNumbers}
          ownedNumbers={ownedNumbers}
          winnerTicketNumber={game.status === "COMPLETED" ? game.winner_ticket_number : null}
          selectedNumber={selectedNumber}
          onSelect={canBuy ? setSelectedNumber : undefined}
        />
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-mist">
          <span className="flex items-center gap-1">
            <span className="h-3 w-3 rounded bg-teal" /> {t("yourTickets")}
          </span>
          <span className="flex items-center gap-1">
            <span className="h-3 w-3 rounded bg-surfaceRaised" /> {t("taken")}
          </span>
          <span className="flex items-center gap-1">
            <span className="h-3 w-3 rounded border border-dashed border-mist/50" /> {t("available")}
          </span>
        </div>
      </div>

      {canBuy && (
        <div>
          <button
            onClick={handleBuy}
            disabled={buying || !selectedNumber}
            className="w-full rounded bg-gold py-3 font-display text-lg tracking-widest text-ink transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {buying
              ? "BUYING…"
              : selectedNumber
              ? `${t("buyTicket")} #${selectedNumber} — ${game.ticket_price} ETB`
              : t("selectTicket")}
          </button>
          {buyError && <p className="mt-2 text-sm text-brick">{buyError}</p>}
        </div>
      )}

      {(game.status === "FULL" || game.status === "DRAWING") && (
        <div className="rounded-lg bg-surface p-5 text-center">
          <p className="font-display tracking-widest text-gold">{t("drawingSoon").toUpperCase()}</p>
        </div>
      )}

      {game.status === "COMPLETED" && game.winner_ticket_number && (
        <div className="rounded-lg bg-surface p-5">
          <h2 className="mb-3 text-center font-display tracking-widest text-mist">
            {t("winningTicket").toUpperCase()}
          </h2>
          <DrawReel maxTickets={game.max_tickets} winnerTicketNumber={game.winner_ticket_number} />
        </div>
      )}
    </div>
  );
}
