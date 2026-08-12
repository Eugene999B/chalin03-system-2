const { pool } = require("../config/db");

function cleanText(value, maximum = 1000) {
  return String(value ?? "").trim().slice(0, maximum);
}

function positiveId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function moneyNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(2)) : null;
}

function sameMoney(left, right) {
  const a = moneyNumber(left);
  const b = moneyNumber(right);
  return a !== null && b !== null && Math.abs(a - b) <= 0.01;
}

function realDate(value) {
  const text = cleanText(value, 20);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return text;
}

function ghanaToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Accra",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function conflict(res, message) {
  return res.status(409).json({
    status: "error",
    code: "FINANCE_IDEMPOTENCY_CONFLICT",
    message,
  });
}

function invalidDate(res, message, code = "FINANCE_OWNERSHIP_DATE_INVALID") {
  return res.status(400).json({
    status: "error",
    code,
    message,
  });
}

function deliveryReplayMatches(row, body = {}) {
  const requestedCondition = cleanText(body.condition_status, 40).toLowerCase();
  const requestedPerson = cleanText(body.receiving_person, 150);
  const requestedMeter = moneyNumber(body.meter_reading);
  const requestedFuel = moneyNumber(body.fuel_level_percent);

  return (
    (!requestedCondition || requestedCondition === cleanText(row.condition_status, 40).toLowerCase()) &&
    (!requestedPerson || requestedPerson === cleanText(row.receiving_person, 150)) &&
    (requestedMeter === null || sameMoney(requestedMeter, row.meter_reading)) &&
    (requestedFuel === null || sameMoney(requestedFuel, row.fuel_level_percent))
  );
}

function ownershipReplayMatches(row, body = {}) {
  const requestedDate = realDate(body.transfer_date);
  const requestedReference = cleanText(body.registration_transfer_reference, 150);
  return (
    (!requestedDate || requestedDate === realDate(row.transfer_date)) &&
    (!requestedReference || requestedReference === cleanText(row.registration_transfer_reference, 150))
  );
}

async function guardDelivery(req, res, next, agreementId) {
  const key = cleanText(req.body?.idempotency_key, 191);
  if (!key) return next();

  const [rows] = await pool.query(
    `SELECT id, agreement_id, condition_status, meter_reading,
            fuel_level_percent, receiving_person
       FROM equipment_deliveries
      WHERE idempotency_key = ?
      LIMIT 1`,
    [key]
  );
  if (!rows.length) return next();

  const replay = rows[0];
  if (Number(replay.agreement_id) !== agreementId || !deliveryReplayMatches(replay, req.body)) {
    return conflict(
      res,
      "This delivery request key was already used for different agreement or handover details. No duplicate delivery was created."
    );
  }
  return next();
}

async function guardOwnership(req, res, next, agreementId) {
  const transferDate = realDate(req.body?.transfer_date);
  if (!transferDate) {
    return invalidDate(res, "Enter a real ownership-transfer date in YYYY-MM-DD format.");
  }

  const today = ghanaToday();
  if (transferDate > today) {
    return invalidDate(
      res,
      "Ownership transfer cannot be dated in the future.",
      "FINANCE_OWNERSHIP_DATE_IN_FUTURE"
    );
  }

  const [[accountRows], [replayRows]] = await Promise.all([
    pool.query(
      `SELECT agreement.id, delivery.delivery_datetime
         FROM equipment_sale_agreements agreement
         LEFT JOIN equipment_deliveries delivery
           ON delivery.agreement_id = agreement.id
        WHERE agreement.id = ?
        ORDER BY delivery.id DESC
        LIMIT 1`,
      [agreementId]
    ),
    req.body?.idempotency_key
      ? pool.query(
          `SELECT id, agreement_id, transfer_date, registration_transfer_reference
             FROM equipment_ownership_transfers
            WHERE idempotency_key = ?
            LIMIT 1`,
          [cleanText(req.body.idempotency_key, 191)]
        )
      : Promise.resolve([[]]),
  ]);

  if (replayRows.length) {
    const replay = replayRows[0];
    if (Number(replay.agreement_id) !== agreementId || !ownershipReplayMatches(replay, req.body)) {
      return conflict(
        res,
        "This ownership request key was already used for different agreement or transfer details. No duplicate ownership record was created."
      );
    }
  }

  const deliveryDate = realDate(
    accountRows[0]?.delivery_datetime
      ? String(accountRows[0].delivery_datetime).slice(0, 10)
      : null
  );
  if (deliveryDate && transferDate < deliveryDate) {
    return invalidDate(
      res,
      `Ownership transfer cannot be dated before the controlled delivery date ${deliveryDate}.`,
      "FINANCE_OWNERSHIP_DATE_BEFORE_DELIVERY"
    );
  }

  return next();
}

async function equipmentFinanceLifecycleIntegrityGuard(req, res, next) {
  if (req.method !== "POST") return next();
  const match = /^\/accounts\/(\d+)\/(delivery|ownership-transfer)\/?$/.exec(req.path);
  if (!match) return next();

  const agreementId = positiveId(match[1]);
  if (!agreementId) return next();

  try {
    if (match[2] === "delivery") {
      return await guardDelivery(req, res, next, agreementId);
    }
    return await guardOwnership(req, res, next, agreementId);
  } catch (error) {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) {
      return next();
    }
    return next(error);
  }
}

module.exports = {
  deliveryReplayMatches,
  equipmentFinanceLifecycleIntegrityGuard,
  ghanaToday,
  ownershipReplayMatches,
  realDate,
};
