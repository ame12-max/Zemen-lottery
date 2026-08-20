const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");

const authRoutes = require("./routes/authRoutes");
const walletRoutes = require("./routes/walletRoutes");
const gameRoutes = require("./routes/gameRoutes");
const adminRoutes = require("./routes/adminRoutes");
const bankSmsRoutes = require("./routes/bankSmsRoutes");
const errorHandler = require("./middleware/errorHandler");

const app = express();

app.use(helmet());
// Restrict to the deployed frontend's origin in production. Left unset
// (local dev), allow any origin so localhost:5173 etc. all just work.
app.use(cors({ origin: process.env.FRONTEND_URL || true }));
app.use(express.json());
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

// Tighter limits on money-moving endpoints than the rest of the API.
// Ticket buying gets its own (higher) limit — a user picking several
// tickets in quick succession is normal behavior, not abuse, so it
// shouldn't share the same budget as deposit/withdrawal submissions.
const RATE_LIMIT_MESSAGE = {
  error: "You're doing that a bit too fast. Please wait a moment and try again.",
};

const financialLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: RATE_LIMIT_MESSAGE,
});

const ticketLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: RATE_LIMIT_MESSAGE,
});

const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: RATE_LIMIT_MESSAGE,
});

app.use("/api/wallet/deposit-requests", financialLimiter);
app.use("/api/wallet/withdrawal-requests", financialLimiter);
app.use("/api/games/:gameId/tickets", ticketLimiter);

app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/games", gameRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/bank-sms", bankSmsRoutes);

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.use(errorHandler);

module.exports = app;
