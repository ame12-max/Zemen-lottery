const express = require("express");
const requireAuth = require("../middleware/auth");
const requireAdmin = require("../middleware/admin");
const {
  createGame,
  listAllGames,
  updateGame,
  deleteGame,
  listDepositRequests,
  getDepositScreenshot,
  approveDeposit,
  rejectDeposit,
  listWithdrawalRequests,
  approveWithdrawal,
  rejectWithdrawal,
  getUserStats,
  listUsers,
} = require("../controllers/adminController");
const { ingestBankMessage } = require("../controllers/bankMessageController");

const router = express.Router();

router.use(requireAuth, requireAdmin);

router.get("/games", listAllGames);
router.post("/games", createGame);
router.put("/games/:id", updateGame);
router.delete("/games/:id", deleteGame);

router.get("/deposit-requests", listDepositRequests);
router.get("/deposit-requests/:id/screenshot", getDepositScreenshot);
router.post("/deposit-requests/:id/approve", approveDeposit);
router.post("/deposit-requests/:id/reject", rejectDeposit);

router.get("/withdrawal-requests", listWithdrawalRequests);
router.post("/withdrawal-requests/:id/approve", approveWithdrawal);
router.post("/withdrawal-requests/:id/reject", rejectWithdrawal);

// Manual fallback for auto-verification: paste a bank SMS here (same
// matching pipeline as the automated SMS-bridge endpoint) until you have
// a phone forwarding messages automatically. See README.
router.post("/bank-messages", ingestBankMessage);

router.get("/users/stats", getUserStats);
router.get("/users", listUsers);

module.exports = router;
