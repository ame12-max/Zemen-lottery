import React, { useEffect, useState } from "react";
import { api } from "../services/api.js";

const DISMISSED_KEY = "zemen_dismissed_winners";

function getDismissed() {
  try {
    return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function persistDismissed(set) {
  localStorage.setItem(DISMISSED_KEY, JSON.stringify([...set]));
}

/**
 * Fetches recently completed draws and shows them as a rotating,
 * dismissible banner — announcement-style, like the design brief asked
 * for ("notify for every user on each pool like an ad"). Dismissal is
 * tracked per-game-id in localStorage so a closed banner doesn't come
 * back on the next login, but a new win always does.
 */
export default function WinnerAnnouncement() {
  const [winners, setWinners] = useState([]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    api
      .recentWinners()
      .then((data) => {
        const dismissed = getDismissed();
        const fresh = data.winners.filter((w) => !dismissed.has(w.game_id));
        setWinners(fresh);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (winners.length <= 1) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % winners.length), 5000);
    return () => clearInterval(t);
  }, [winners.length]);

  if (winners.length === 0) return null;

  const current = winners[index];

  function dismissCurrent() {
    const dismissed = getDismissed();
    dismissed.add(current.game_id);
    persistDismissed(dismissed);
    setWinners((prev) => prev.filter((w) => w.game_id !== current.game_id));
    setIndex(0);
  }

  return (
    <div className="border-b border-goldDim bg-gradient-to-r from-surface via-surfaceRaised to-surface">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-2 sm:px-6">
        <p className="font-mono text-sm text-paper">
          <span className="mr-2 font-display tracking-widest text-gold">WINNER</span>
          <span className="font-semibold">{current.winner_name}</span> won{" "}
          <span className="text-gold">{current.prize_amount} ETB</span> on{" "}
          <span className="text-mist">{current.game_name}</span> — ticket #
          {current.winner_ticket_number}
        </p>
        <div className="flex shrink-0 items-center gap-3">
          {winners.length > 1 && (
            <button
              onClick={() => setIndex((i) => (i + 1) % winners.length)}
              className="text-xs text-mist hover:text-paper"
              aria-label="Next winner"
            >
              NEXT
            </button>
          )}
          <button
            onClick={dismissCurrent}
            className="text-mist hover:text-brick"
            aria-label="Dismiss this announcement"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
