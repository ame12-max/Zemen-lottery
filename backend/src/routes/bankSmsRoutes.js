const express = require("express");
const requireBankSmsSecret = require("../middleware/bankSmsAuth");
const { ingestBankMessage } = require("../controllers/bankMessageController");

const router = express.Router();

router.post("/", requireBankSmsSecret, ingestBankMessage);

module.exports = router;
