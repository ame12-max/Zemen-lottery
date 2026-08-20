const express = require("express");
const requireAuth = require("../middleware/auth");
const {
  listOpenGames,
  getGame,
  getGameTickets,
  buyTicket,
  myTickets,
  recentWinners,
  myUnseenWins,
  acknowledgeWin,
} = require("../controllers/gameController");

const router = express.Router();

router.use(requireAuth);
router.get("/", listOpenGames);
router.get("/my-tickets", myTickets);
router.get("/recent-winners", recentWinners);
router.get("/my-unseen-wins", myUnseenWins);
router.post("/wins/:ticketId/seen", acknowledgeWin);
router.get("/:gameId", getGame);
router.get("/:gameId/tickets", getGameTickets);
router.post("/:gameId/tickets", buyTicket);

module.exports = router;
