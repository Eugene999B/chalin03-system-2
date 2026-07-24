const express = require("express");

const router = express.Router();

const RETIRED_RESPONSE = Object.freeze({
  status: "error",
  code: "WEB_BIOMETRIC_LOGIN_DISABLED",
  message:
    "Fingerprint and face login are disabled in the Chalin 03 website. Browser APIs can fall back to a passkey, device PIN or screen lock and therefore cannot enforce biometric-only authentication.",
});

function sendRetiredResponse(req, res) {
  return res.status(410).json(RETIRED_RESPONSE);
}

router.use(sendRetiredResponse);

module.exports = router;
