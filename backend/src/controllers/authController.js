const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { pool, withTransaction } = require("../config/db");
const { ensureWallet } = require("../services/walletService");
const referralService = require("../services/referralService");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");

const PHONE_REGEX = /^\+?[0-9]{9,15}$/;

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
}

const register = asyncHandler(async (req, res) => {
  const { name, phone, password, referralCode } = req.body;

  if (!name || typeof name !== "string" || name.trim().length < 2) {
    throw new ApiError(400, "Name is required");
  }
  if (!phone || !PHONE_REGEX.test(phone)) {
    throw new ApiError(400, "Valid phone number is required");
  }
  if (!password || typeof password !== "string" || password.length < 8) {
    throw new ApiError(400, "Password must be at least 8 characters");
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await withTransaction(async (client) => {
    let inserted;
    try {
      inserted = await client.query(
        `INSERT INTO users (name, phone, password_hash) VALUES ($1, $2, $3)
         RETURNING id, name, phone, role`,
        [name.trim(), phone, passwordHash]
      );
    } catch (err) {
      if (err.code === "23505") throw new ApiError(409, "Phone number already registered");
      throw err;
    }
    const newUser = inserted.rows[0];
    await ensureWallet(newUser.id, client);
    newUser.referral_code = await referralService.assignReferralCode(client, newUser.id);
    await referralService.linkReferral(client, newUser.id, referralCode);
    return newUser;
  });

  const token = signToken(user);
  res.status(201).json({ user, token });
});

const login = asyncHandler(async (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) throw new ApiError(400, "Phone and password are required");

  const { rows } = await pool.query(
    `SELECT id, name, phone, password_hash, role FROM users WHERE phone = $1`,
    [phone]
  );
  if (rows.length === 0) throw new ApiError(401, "Invalid phone or password");

  const user = rows[0];
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) throw new ApiError(401, "Invalid phone or password");

  const token = signToken(user);
  delete user.password_hash;
  res.json({ user, token });
});

module.exports = { register, login };
