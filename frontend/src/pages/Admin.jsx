import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../services/api.js";

export default function Admin() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: "",
    ticketPrice: "",
    maxTickets: "",
    prizeAmount: "",
  });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  const totalPool =
    Number(form.ticketPrice || 0) * Number(form.maxTickets || 0);
  const margin = totalPool - Number(form.prizeAmount || 0);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    const payload = {
      name: form.name.trim(),
      ticketPrice: parseInt(form.ticketPrice, 10),
      maxTickets: parseInt(form.maxTickets, 10),
      prizeAmount: parseInt(form.prizeAmount, 10),
    };

    if (
      !payload.name ||
      !Number.isInteger(payload.ticketPrice) ||
      !Number.isInteger(payload.maxTickets) ||
      !Number.isInteger(payload.prizeAmount)
    ) {
      setError("Fill in every field with valid whole numbers.");
      return;
    }

    setSubmitting(true);
    try {
      const { game } = await api.createGame(payload);
      navigate(`/games/${game.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-8 sm:px-6">
      <h1 className="mb-6 font-display text-3xl tracking-widest text-paper">CREATE POOL</h1>

      <form onSubmit={handleSubmit} className="space-y-4 rounded-lg bg-surface p-6">
        <div>
          <label className="mb-1 block text-sm text-mist">Pool name</label>
          <input
            value={form.name}
            onChange={update("name")}
            placeholder="10 Birr Lucky Draw"
            className="w-full rounded border border-surfaceRaised bg-ink px-3 py-2 text-paper outline-none focus:border-gold"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-sm text-mist">Ticket price (ETB)</label>
            <input
              type="number"
              min="1"
              value={form.ticketPrice}
              onChange={update("ticketPrice")}
              className="w-full rounded border border-surfaceRaised bg-ink px-3 py-2 font-mono text-paper outline-none focus:border-gold"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-mist">Number of tickets</label>
            <input
              type="number"
              min="2"
              value={form.maxTickets}
              onChange={update("maxTickets")}
              className="w-full rounded border border-surfaceRaised bg-ink px-3 py-2 font-mono text-paper outline-none focus:border-gold"
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm text-mist">Prize amount (ETB)</label>
          <input
            type="number"
            min="1"
            value={form.prizeAmount}
            onChange={update("prizeAmount")}
            className="w-full rounded border border-surfaceRaised bg-ink px-3 py-2 font-mono text-paper outline-none focus:border-gold"
          />
        </div>

        {totalPool > 0 && (
          <div className="rounded border border-surfaceRaised p-3 font-mono text-sm text-mist">
            <div className="flex justify-between">
              <span>Total collected</span>
              <span>{totalPool} ETB</span>
            </div>
            <div className="flex justify-between">
              <span>Prize payout</span>
              <span>{form.prizeAmount || 0} ETB</span>
            </div>
            <div className={`flex justify-between font-semibold ${margin < 0 ? "text-brick" : "text-teal"}`}>
              <span>Margin before fees</span>
              <span>{margin} ETB</span>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-brick">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded bg-gold py-2 font-display tracking-widest text-ink transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? "CREATING…" : "CREATE POOL"}
        </button>
      </form>
    </div>
  );
}
