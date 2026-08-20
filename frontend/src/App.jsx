import React, { useEffect, useState } from "react";
import { Routes, Route } from "react-router-dom";
import Navbar from "./components/Navbar.jsx";
import BottomTabs from "./components/BottomTabs.jsx";
import WinnerAnnouncement from "./components/WinnerAnnouncement.jsx";
import WinCelebrationModal from "./components/WinCelebrationModal.jsx";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import { useAuth } from "./context/AuthContext.jsx";
import { api } from "./services/api.js";
import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import Games from "./pages/Games.jsx";
import GameDetail from "./pages/GameDetail.jsx";
import Wallet from "./pages/Wallet.jsx";
import Deposit from "./pages/Deposit.jsx";
import Withdraw from "./pages/Withdraw.jsx";
import MyTickets from "./pages/MyTickets.jsx";
import Profile from "./pages/Profile.jsx";
import Admin from "./pages/Admin.jsx";
import AdminDeposits from "./pages/AdminDeposits.jsx";
import AdminWithdrawals from "./pages/AdminWithdrawals.jsx";

export default function App() {
  const { user } = useAuth();
  const [unseenWins, setUnseenWins] = useState([]);

  // Checked once per login (and on a fresh page load while already logged
  // in) — a beautiful "you won!" popup for any draw the user hasn't seen
  // the result of yet.
  useEffect(() => {
    if (!user) {
      setUnseenWins([]);
      return;
    }
    api
      .myUnseenWins()
      .then((d) => setUnseenWins(d.wins))
      .catch(() => {});
  }, [user?.id]);

  async function handleAcknowledgeWin(ticketId) {
    try {
      await api.acknowledgeWin(ticketId);
    } catch {
      // even if this fails, don't trap the user behind the modal
    }
    setUnseenWins((prev) => prev.filter((w) => w.ticket_id !== ticketId));
  }

  return (
    <div className="min-h-screen bg-ink">
      <Navbar />
      {user && <WinnerAnnouncement />}
      {user && unseenWins.length > 0 && (
        <WinCelebrationModal wins={unseenWins} onAcknowledge={handleAcknowledgeWin} />
      )}
      <div className={user ? "pb-20" : ""}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Games />
              </ProtectedRoute>
            }
          />
          <Route
            path="/games/:gameId"
            element={
              <ProtectedRoute>
                <GameDetail />
              </ProtectedRoute>
            }
          />
          <Route
            path="/wallet"
            element={
              <ProtectedRoute>
                <Wallet />
              </ProtectedRoute>
            }
          />
          <Route
            path="/deposit"
            element={
              <ProtectedRoute>
                <Deposit />
              </ProtectedRoute>
            }
          />
          <Route
            path="/withdraw"
            element={
              <ProtectedRoute>
                <Withdraw />
              </ProtectedRoute>
            }
          />
          <Route
            path="/my-tickets"
            element={
              <ProtectedRoute>
                <MyTickets />
              </ProtectedRoute>
            }
          />
          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <Profile />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <ProtectedRoute adminOnly>
                <Admin />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/deposits"
            element={
              <ProtectedRoute adminOnly>
                <AdminDeposits />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/withdrawals"
            element={
              <ProtectedRoute adminOnly>
                <AdminWithdrawals />
              </ProtectedRoute>
            }
          />
        </Routes>
      </div>
      {user && <BottomTabs />}
    </div>
  );
}
