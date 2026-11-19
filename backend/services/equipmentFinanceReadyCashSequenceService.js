"use strict";

const { pool } = require("../config/db");
const { nextDocumentNumber } = require("./groupConfigurationService");

// Dedicated, company-wide Ready Cash numbers. Do NOT reuse the shared Equipment
// Hire or Installment sequences: existing workflows may use a separate legacy
// allocator, and could otherwise issue the same quotation or receipt reference.
const READY_CASH_SEQUENCES = Object.freeze([
  Object.freeze({
    code: "READY_CASH_QUOTATION", name: "Ready Cash quotation", prefix: "RCQ",
  }),
  Object.freeze({
    code: "READY_CASH_AGREEMENT", name: "Ready Cash sale agreement", prefix: "RCA",
  }),
  Object.freeze({
    code: "READY_CASH_PAYMENT", name: "Ready Cash full payment", prefix: "RCP",
  }),
  Object.freeze({
    code: "READY_CASH_RECEIPT", name: "Ready Cash payment receipt", prefix: "RCR",
  }),
  Object.freeze({
    code: "READY_CASH_DELIVERY", name: "Ready Cash signed delivery", prefix: "RCD",
  }),
  Object.freeze({
    code: "READY_CASH_OWNERSHIP_TRANSFER", name: "Ready Cash transfer of ownership", prefix: "RCT",
  }),
]);

function unavailable(code) {
  const error = new Error(
    "Ready Cash document numbering is unavailable for " + code +
    ". No sale or payment was recorded. Ask an administrator to check the Finance numbering configuration."
  );
  error.code = "READY_CASH_NUMBERING_UNAVAILABLE";
  error.statusCode = 503;
  return error;
}

async function ensureReadyCashSequences(connectionPool = pool) {
  const connection = await connectionPool.getConnection();
  try {
    await connection.beginTransaction();
    // One unique primary key per sequence; a retry or another Railway replica
    // can run this safely. ON DUPLICATE does not change an existing counter,
    // prefix, active flag, or administrative configuration.
    const placeholders = READY_CASH_SEQUENCES.map(
      () => "(?, 'equipment_installment_finance', ?, ?, 1, 6, 'none', TRUE, FALSE, '-', TRUE)"
    ).join(", ");
    await connection.query(
      `INSERT INTO document_sequences
         (sequence_code,workspace_code,document_name,prefix,next_number,
          padding,reset_policy,include_year,include_month,number_separator,is_active)
       VALUES ${placeholders}
       ON DUPLICATE KEY UPDATE sequence_code = sequence_code`,
      READY_CASH_SEQUENCES.flatMap((row) => [row.code, row.name, row.prefix])
    );
    const marks = READY_CASH_SEQUENCES.map(() => "?").join(", ");
    const [rows] = await connection.query(
      `SELECT sequence_code,is_active FROM document_sequences
       WHERE sequence_code IN (${marks}) FOR UPDATE`,
      READY_CASH_SEQUENCES.map((row) => row.code)
    );
    for (const definition of READY_CASH_SEQUENCES) {
      const found = rows.find((row) => row.sequence_code === definition.code);
      if (!found || Number(found.is_active) !== 1) {
        throw unavailable(definition.code);
      }
    }
    await connection.commit();
    return { ready: true, codes: READY_CASH_SEQUENCES.map((row) => row.code) };
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

async function nextReadyCashDocumentNumbers({ userId = null, stage = "checkout" } = {}) {
  if (stage !== "checkout" && stage !== "handover") {
    throw unavailable("invalid stage");
  }
  await ensureReadyCashSequences();
  // All six counters are verified; only allocate numbers for the requested
  // stage, so retrying checkout cannot consume delivery/transfer references.
  const definitions = stage === "checkout"
    ? READY_CASH_SEQUENCES.slice(0, 4)
    : READY_CASH_SEQUENCES.slice(4);
  const numbers = [];
  for (const sequence of definitions) {
    numbers.push(await nextDocumentNumber(sequence.code, { userId }));
  }
  return numbers;
}

module.exports = {
  READY_CASH_SEQUENCES,
  ensureReadyCashSequences,
  nextReadyCashDocumentNumbers,
};
