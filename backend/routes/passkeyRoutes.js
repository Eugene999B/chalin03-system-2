const express = require("express");

const router = express.Router();

const RETIRED_RESPONSE = Object.freeze({
  status: "error",
  code: "WEB_PASSKEY_LOGIN_DISABLED",
  message:
    "Browser passkey and device screen-lock login are disabled. Chalin 03 accepts account-password login only because a website cannot guarantee that a real fingerprint or face sensor was used.",
});

function sendRetiredResponse(req, res) {
  return res.status(410).json(RETIRED_RESPONSE);
}

router.use(sendRetiredResponse);

module.exports = router;
