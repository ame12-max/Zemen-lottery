import React, { useEffect, useState } from "react";
import { api } from "../services/api.js";
import { useToast } from "../context/ToastContext.jsx";

export default function AdminDeposits() {
  const { showToast } = useToast();
  const [requests, setRequests] = useState([]);
  const [statusFilter, setStatusFilter] = useState("PENDING");
  const [screenshots, setScreenshots] = useState({}); // id -> blob url
  const [notes, setNotes] = useState({}); // id -> note text
  const [busyId, setBusyId] = useState(null);

  function refresh() {
    api.listAdminDepositRequests(statusFilter).then((d) => setRequests(d.requests));
  }

  useEffect(refresh, [statusFilter]);

  // Revoke blob URLs on unmount to avoid leaking memory.
  useEffect(() => {
    return () => Object.values(screenshots).forEach((url) => URL.revokeObjectURL(url));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadScreenshot(id) {
    if (screenshots[id]) return; // already loaded
    try {
      const url = await api.getDepositScreenshotUrl(id);
      setScreenshots((prev) => ({ ...prev, [id]: url }));
    } catch {
      showToast("Could not load screenshot.", "error");
    }
  }

  async function handleApprove(id) {
    setBusyId(id);
    try {
      await api.approveDeposit(id);
      showToast(`Deposit #${id} approved — wallet credited.`, "success");
      refresh();
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(id) {
    setBusyId(id);
    try {
      await api.rejectDeposit(id, notes[id] || "");
      showToast(`Deposit #${id} rejected.`, "success");
      refresh();
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <h1 className="mb-4 font-display text-3xl tracking-widest text-paper">DEPOSIT REVIEW</h1>

      <div className="mb-6 flex gap-2">
        {["PENDING", "APPROVED", "REJECTED"].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded px-4 py-1.5 font-display text-sm tracking-widest ${
              statusFilter === s ? "bg-gold text-ink" : "bg-surface text-mist"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {requests.length === 0 && <p className="text-mist">Nothing here.</p>}

      <div className="space-y-4">
        {requests.map((r) => (
          <div key={r.id} className="rounded-lg bg-surface p-5">
            <div className="mb-3 flex items-start justify-between">
              <div>
                <div className="font-mono text-lg font-bold text-gold">{r.amount} ETB</div>
                <div className="text-sm text-paper">
                  {r.user_name} · {r.user_phone}
                </div>
                <div className="text-xs text-mist">
                  {r.method} · {new Date(r.created_at).toLocaleString()}
                </div>
              </div>
              <span className="font-display text-xs tracking-widest text-mist">#{r.id}</span>
            </div>

            {screenshots[r.id] ? (
              <img
                src={screenshots[r.id]}
                alt={`Deposit proof #${r.id}`}
                className="mb-3 max-h-80 rounded border border-surfaceRaised object-contain"
              />
            ) : (
              <button
                onClick={() => loadScreenshot(r.id)}
                className="mb-3 rounded border border-dashed border-mist/50 px-4 py-2 text-sm text-mist hover:text-gold"
              >
                View screenshot
              </button>
            )}

            {r.status === "PENDING" ? (
              <div className="flex items-center gap-2">
                <input
                  placeholder="Rejection note (optional)"
                  value={notes[r.id] || ""}
                  onChange={(e) => setNotes((prev) => ({ ...prev, [r.id]: e.target.value }))}
                  className="flex-1 rounded border border-surfaceRaised bg-ink px-3 py-1.5 text-sm text-paper outline-none focus:border-gold"
                />
                <button
                  disabled={busyId === r.id}
                  onClick={() => handleApprove(r.id)}
                  className="rounded bg-teal px-3 py-1.5 text-sm font-semibold text-ink disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  disabled={busyId === r.id}
                  onClick={() => handleReject(r.id)}
                  className="rounded bg-brick px-3 py-1.5 text-sm font-semibold text-paper disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            ) : (
              <div className="text-sm text-mist">
                Reviewed — status: <span className="font-semibold">{r.status}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
