import React, { useEffect, useState } from "react";
import { api } from "../services/api.js";
import { useToast } from "../context/ToastContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";

const STATUS_COLOR = {
  PENDING: "text-gold",
  APPROVED: "text-teal",
  REJECTED: "text-brick",
};

export default function Deposit() {
  const { showToast } = useToast();
  const { t } = useLanguage();
  const [methods, setMethods] = useState(null);
  const [requests, setRequests] = useState([]);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("CBE");
  const [transactionRef, setTransactionRef] = useState("");
  const [senderName, setSenderName] = useState("");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  function refreshRequests() {
    api.listMyDepositRequests().then((d) => setRequests(d.requests));
  }

  useEffect(() => {
    api.getPaymentMethods().then(setMethods);
    refreshRequests();
  }, []);

  function handleFileChange(e) {
    const f = e.target.files?.[0];
    setFile(f || null);
    setPreview(f ? URL.createObjectURL(f) : null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    const parsedAmount = parseInt(amount, 10);
    if (!Number.isInteger(parsedAmount) || parsedAmount <= 0) {
      setError("Enter a whole number of ETB greater than 0.");
      return;
    }
    if (!transactionRef.trim()) {
      setError("Enter the transaction reference/ID from your receipt.");
      return;
    }
    if (!file) {
      setError("Attach a screenshot of your payment.");
      return;
    }

    const formData = new FormData();
    formData.append("amount", parsedAmount);
    formData.append("method", method);
    formData.append("transactionRef", transactionRef.trim());
    if (senderName.trim()) formData.append("senderName", senderName.trim());
    formData.append("screenshot", file);

    setSubmitting(true);
    try {
      await api.createDepositRequest(formData);
      showToast("Deposit request submitted.", "success");
      setAmount("");
      setTransactionRef("");
      setSenderName("");
      setFile(null);
      setPreview(null);
      e.target.reset();
      refreshRequests();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const account = methods?.[method.toLowerCase()];

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <h1 className="mb-1 font-display text-3xl tracking-widest text-paper">
        {t("deposit").toUpperCase()}
      </h1>
      <p className="mb-2 text-sm text-mist">{t("depositIntro")}</p>
      <p className="mb-1 text-xs text-goldDim">{t("depositAutoNotice")}</p>
      <p className="mb-6 text-xs text-goldDim">{t("pointsPerDeposit")}</p>

      <form onSubmit={handleSubmit} className="mb-8 space-y-4 rounded-lg bg-surface p-6">
        <div>
          <label className="mb-1 block text-sm text-mist">{t("paymentMethod")}</label>
          <div className="flex gap-2">
            {["CBE", "TELEBIRR"].map((m) => (
              <button
                type="button"
                key={m}
                onClick={() => setMethod(m)}
                className={`flex-1 rounded py-2 font-display tracking-widest transition-colors ${
                  method === m ? "bg-gold text-ink" : "bg-ink text-mist"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {account && (
          <div className="ticket-stub rounded p-4 font-mono text-sm">
            <div className="mb-1 font-display text-lg tracking-wide">
              {method === "CBE" ? account.bankName : "Telebirr"}
            </div>
            <div className="flex justify-between">
              <span className="text-ink/60">Account name</span>
              <span className="font-semibold">{account.accountName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ink/60">{method === "CBE" ? "Account number" : "Phone number"}</span>
              <span className="font-semibold">
                {method === "CBE" ? account.accountNumber : account.phoneNumber}
              </span>
            </div>
          </div>
        )}

        <div>
          <label htmlFor="amount" className="mb-1 block text-sm text-mist">
            {t("amountPaid")}
          </label>
          <input
            id="amount"
            type="number"
            min="1"
            step="1"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full rounded border border-surfaceRaised bg-ink px-3 py-2 font-mono text-paper outline-none focus:border-gold"
          />
        </div>

        <div>
          <label htmlFor="transactionRef" className="mb-1 block text-sm text-mist">
            {t("transactionRef")}
          </label>
          <input
            id="transactionRef"
            required
            value={transactionRef}
            onChange={(e) => setTransactionRef(e.target.value)}
            placeholder={method === "CBE" ? "FT24116CKXLS" : "TB123456789"}
            className="w-full rounded border border-surfaceRaised bg-ink px-3 py-2 font-mono uppercase text-paper outline-none focus:border-gold"
          />
          <p className="mt-1 text-xs text-mist">{t("transactionRefHint")}</p>
        </div>

        <div>
          <label htmlFor="senderName" className="mb-1 block text-sm text-mist">
            {t("senderName")}
          </label>
          <input
            id="senderName"
            value={senderName}
            onChange={(e) => setSenderName(e.target.value)}
            className="w-full rounded border border-surfaceRaised bg-ink px-3 py-2 text-paper outline-none focus:border-gold"
          />
        </div>

        <div>
          <label htmlFor="screenshot" className="mb-1 block text-sm text-mist">
            {t("paymentScreenshot")}
          </label>
          <input
            id="screenshot"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={handleFileChange}
            className="w-full text-sm text-mist file:mr-3 file:rounded file:border-0 file:bg-surfaceRaised file:px-3 file:py-2 file:text-paper"
          />
          {preview && (
            <img
              src={preview}
              alt="Payment screenshot preview"
              className="mt-3 max-h-64 rounded border border-surfaceRaised object-contain"
            />
          )}
        </div>

        {error && <p className="text-sm text-brick">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded bg-teal py-2 font-display tracking-widest text-ink transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? t("submitting").toUpperCase() : t("submitDepositRequest").toUpperCase()}
        </button>
      </form>

      <h2 className="mb-3 font-display tracking-widest text-mist">{t("yourRequests").toUpperCase()}</h2>
      {requests.length === 0 ? (
        <p className="text-mist">{t("noTransactions")}</p>
      ) : (
        <ul className="divide-y divide-surfaceRaised rounded-lg bg-surface">
          {requests.map((r) => (
            <li key={r.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <div className="font-mono font-semibold">{r.amount} ETB</div>
                <div className="text-xs text-mist">
                  {r.method} · {new Date(r.created_at).toLocaleString()}
                  {r.auto_verified && (
                    <span className="ml-2 text-teal">🤖 {t("autoVerified")}</span>
                  )}
                </div>
                {r.admin_note && <div className="text-xs text-brick">Note: {r.admin_note}</div>}
              </div>
              <span className={`font-display text-sm tracking-widest ${STATUS_COLOR[r.status]}`}>
                {r.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
