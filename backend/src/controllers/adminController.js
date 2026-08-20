const gameService = require("../services/gameService");
const depositRequestService = require("../services/depositRequestService");
const withdrawalService = require("../services/withdrawalService");
const adminReportingService = require("../services/adminReportingService");
const { getSignedUrl } = require("../config/cloudinary");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");

// --- Pool (game) management ---

const createGame = asyncHandler(async (req, res) => {
  const { name, ticketPrice, maxTickets, prizeTiers } = req.body;
  const game = await gameService.createGame({
    name,
    ticketPrice,
    maxTickets,
    prizeTiers,
    createdBy: req.user.id,
  });
  res.status(201).json({ game });
});

const listAllGames = asyncHandler(async (req, res) => {
  const games = await gameService.listAllGamesForAdmin();
  res.json({ games });
});

const updateGame = asyncHandler(async (req, res) => {
  const { name, ticketPrice, maxTickets, prizeTiers } = req.body;
  const result = await gameService.updateGame(req.params.id, {
    name,
    ticketPrice,
    maxTickets,
    prizeTiers,
  });
  res.json({ result });
});

const deleteGame = asyncHandler(async (req, res) => {
  const result = await gameService.deleteOrCancelGame(req.params.id);
  res.json({ result });
});

// --- Deposit review ---

const listDepositRequests = asyncHandler(async (req, res) => {
  const requests = await depositRequestService.listForAdmin(req.query.status);
  res.json({ requests });
});

// Screenshots are never served from a public/static folder — only through
// this authenticated, admin-gated route. It generates a short-lived signed
// Cloudinary URL and redirects to it, so the browser fetches the image
// directly from Cloudinary but only after our own admin check has passed.
const getDepositScreenshot = asyncHandler(async (req, res) => {
  const publicId = await depositRequestService.getScreenshotPath(req.params.id);
  const signedUrl = getSignedUrl(publicId);
  res.redirect(302, signedUrl);
});

const approveDeposit = asyncHandler(async (req, res) => {
  const result = await depositRequestService.approve(req.params.id, req.user.id);
  res.json({ result });
});

const rejectDeposit = asyncHandler(async (req, res) => {
  const result = await depositRequestService.reject(req.params.id, req.user.id, req.body.note);
  res.json({ result });
});

// --- Withdrawal review ---

const listWithdrawalRequests = asyncHandler(async (req, res) => {
  const requests = await withdrawalService.listForAdmin(req.query.status);
  res.json({ requests });
});

const approveWithdrawal = asyncHandler(async (req, res) => {
  const result = await withdrawalService.approve(req.params.id, req.user.id);
  res.json({ result });
});

const rejectWithdrawal = asyncHandler(async (req, res) => {
  const result = await withdrawalService.reject(req.params.id, req.user.id, req.body.note);
  res.json({ result });
});

// --- User management / reporting ---

const getUserStats = asyncHandler(async (req, res) => {
  const stats = await adminReportingService.getUserStats();
  res.json({ stats });
});

const listUsers = asyncHandler(async (req, res) => {
  const filter = req.query.filter || "ALL";
  if (!["ALL", "DEPOSITED", "NOT_DEPOSITED"].includes(filter)) {
    throw new ApiError(400, "filter must be ALL, DEPOSITED, or NOT_DEPOSITED");
  }
  const users = await adminReportingService.listUsers(filter);
  res.json({ users });
});

module.exports = {
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
};
