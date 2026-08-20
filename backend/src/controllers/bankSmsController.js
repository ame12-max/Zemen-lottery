const bankSmsService = require("../services/bankSmsService");
const asyncHandler = require("../utils/asyncHandler");

// Called by the Android bridge device/app for every CBE/Telebirr SMS it
// reads on the admin's phone. Body: { text, sender?, provider? }.
// `provider` ("CBE" | "TELEBIRR") is optional but recommended — if the
// bridge app is configured per-SIM it can tag this reliably instead of
// making the parser guess from the message text.
const receiveSms = asyncHandler(async (req, res) => {
  const { text, sender, provider } = req.body;
  const result = await bankSmsService.ingest({ text, sender, provider });
  res.status(201).json(result);
});

module.exports = { receiveSms };
