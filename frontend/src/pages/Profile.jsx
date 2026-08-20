import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { api } from "../services/api.js";
import SpinModal from "../components/SpinModal.jsx";
import { useToast } from "../context/ToastContext.jsx";

export default function Profile() {
  const { user, logout } = useAuth();
  const { lang, setLang, t } = useLanguage();
  const { showToast } = useToast();
  const [points, setPoints] = useState(null);
  const [referral, setReferral] = useState(null);
  const [showSpin, setShowSpin] = useState(false);

  function refreshPoints() {
    api.getMyPoints().then((d) => setPoints(d.points));
  }

  useEffect(refreshPoints, []);
  useEffect(() => {
    api.getReferrals().then(setReferral);
  }, []);

  const progressPct = points
    ? Math.round((points.pointsIntoLevel / points.pointsPerLevel) * 100)
    : 0;

  const referralLink = referral
    ? `${window.location.origin}/register?ref=${referral.referralCode}`
    : "";

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(referralLink);
      showToast(t("copied"), "success");
    } catch {
      showToast(referralLink, "info");
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <h1 className="mb-6 font-display text-3xl tracking-widest text-paper">{t("profile")}</h1>

      <div className="mb-6 rounded-lg bg-surface p-6">
        <div className="mb-1 text-lg font-semibold text-paper">{user.name}</div>
        <div className="font-mono text-sm text-mist">{user.phone}</div>
      </div>

      <div className="mb-6 rounded-lg bg-surface p-6">
        <div className="mb-3 flex items-center justify-between">
          <span className="font-display tracking-widest text-mist">{t("level")}</span>
          <span className="font-display text-2xl text-gold">{points?.level ?? "…"}</span>
        </div>
        <div className="mb-1 h-2 overflow-hidden rounded-full bg-surfaceRaised">
          <div
            className="h-full rounded-full bg-gold transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <div className="mb-4 text-xs text-mist">
          {points?.pointsIntoLevel ?? 0}/{points?.pointsPerLevel ?? 100} {t("pointsToNextLevel")}
        </div>

        <div className="flex items-center justify-between rounded bg-ink p-3">
          <div>
            <div className="text-xs text-mist">{t("points")}</div>
            <div className="font-mono text-xl font-bold text-paper">
              {points?.spendablePoints ?? "…"}
            </div>
          </div>
          <button
            onClick={() => setShowSpin(true)}
            disabled={!points?.canSpin}
            className="rounded bg-gold px-5 py-2 font-display tracking-widest text-ink transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {t("spin").toUpperCase()}
          </button>
        </div>
        {!points?.canSpin && (
          <p className="mt-2 text-xs text-mist">{t("spinCostLabel")}</p>
        )}
      </div>

      <div className="mb-6 rounded-lg bg-surface p-6">
        <h2 className="mb-1 font-display tracking-widest text-gold">{t("inviteFriends")}</h2>
        <p className="mb-4 text-xs text-mist">{t("inviteFriendsRule")}</p>

        <div className="mb-3 flex items-center justify-between rounded bg-ink p-3">
          <div>
            <div className="text-xs text-mist">{t("yourReferralCode")}</div>
            <div className="font-mono text-xl font-bold tracking-widest text-paper">
              {referral?.referralCode ?? "…"}
            </div>
          </div>
          <button
            onClick={copyLink}
            className="rounded bg-gold px-4 py-2 font-display text-sm tracking-widest text-ink transition-opacity hover:opacity-90"
          >
            {t("copyLink").toUpperCase()}
          </button>
        </div>

        <div className="mb-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded bg-ink p-2">
            <div className="font-mono text-lg font-bold text-paper">
              {referral?.totalInvited ?? 0}
            </div>
            <div className="text-xs text-mist">{t("totalInvited")}</div>
          </div>
          <div className="rounded bg-ink p-2">
            <div className="font-mono text-lg font-bold text-teal">
              {referral?.totalCompleted ?? 0}
            </div>
            <div className="text-xs text-mist">{t("totalCompleted")}</div>
          </div>
          <div className="rounded bg-ink p-2">
            <div className="font-mono text-lg font-bold text-gold">
              {referral?.totalEarned ?? 0} ETB
            </div>
            <div className="text-xs text-mist">{t("totalEarned")}</div>
          </div>
        </div>

        {referral?.referrals?.length > 0 && (
          <div>
            <h3 className="mb-2 text-xs tracking-widest text-mist">
              {t("referralHistory").toUpperCase()}
            </h3>
            <ul className="divide-y divide-surfaceRaised">
              {referral.referrals.map((r, i) => (
                <li key={i} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-paper">{r.invitee_name}</span>
                  <span className={r.status === "COMPLETED" ? "text-teal" : "text-goldDim"}>
                    {r.status === "COMPLETED" ? t("completed") : t("pending")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="mb-6 rounded-lg bg-surface p-6">
        <h2 className="mb-3 font-display tracking-widest text-mist">{t("language")}</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setLang("am")}
            className={`flex-1 rounded py-2 font-semibold transition-colors ${
              lang === "am" ? "bg-gold text-ink" : "bg-ink text-mist"
            }`}
          >
            አማርኛ
          </button>
          <button
            onClick={() => setLang("en")}
            className={`flex-1 rounded py-2 font-semibold transition-colors ${
              lang === "en" ? "bg-gold text-ink" : "bg-ink text-mist"
            }`}
          >
            English
          </button>
        </div>
      </div>

      {user.role === "ADMIN" && (
        <div className="mb-6 rounded-lg bg-surface p-6">
          <h2 className="mb-3 font-display tracking-widest text-goldDim">{t("admin")}</h2>
          <div className="grid grid-cols-3 gap-2">
            <Link
              to="/admin"
              className="rounded bg-ink py-2 text-center text-sm text-paper hover:text-gold"
            >
              {t("createPool")}
            </Link>
            <Link
              to="/admin/deposits"
              className="rounded bg-ink py-2 text-center text-sm text-paper hover:text-gold"
            >
              {t("deposits")}
            </Link>
            <Link
              to="/admin/withdrawals"
              className="rounded bg-ink py-2 text-center text-sm text-paper hover:text-gold"
            >
              {t("withdrawals")}
            </Link>
          </div>
        </div>
      )}

      <button
        onClick={logout}
        className="w-full rounded bg-brick py-3 font-display tracking-widest text-paper transition-opacity hover:opacity-90"
      >
        {t("logout").toUpperCase()}
      </button>

      {showSpin && (
        <SpinModal
          segments={points?.spinSegments ?? [5, 10, 15, 20, 10, 25, 5, 50]}
          onClose={() => setShowSpin(false)}
          onSpun={() => {
            refreshPoints();
          }}
        />
      )}
    </div>
  );
}
