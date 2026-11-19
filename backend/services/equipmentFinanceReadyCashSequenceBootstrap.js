"use strict";

// Warm up only the dedicated Ready Cash document counters after database
// connection succeeds, so production logs show readiness without placing a
// test sale, receipt, reservation, or payment in the live ledger.
const db = require("../config/db");
const { ensureReadyCashSequences } = require("./equipmentFinanceReadyCashSequenceService");
const FLAG = Symbol.for("chalin03.readyCashSequenceStartupInstalled");

if (!db[FLAG]) {
  const previousCheck = db.testDatabaseConnection;
  let initialized = false;
  db.testDatabaseConnection = async function verifyReadyCashSequencesAtStartup(...args) {
    const result = await previousCheck(...args);
    if (!initialized) {
      try {
        const readiness = await ensureReadyCashSequences();
        initialized = readiness.ready;
        console.log("Ready Cash document numbering: verified 4 sequences");
      } catch (error) {
        // Do not take down every workspace because of Ready Cash numbering.
        // Its checkout retries this idempotent initialization and reports an
        // explicit error before any sale ledger is changed if still unavailable.
        console.error("Ready Cash document numbering unavailable:", error.code || error.message);
      }
    }
    return result;
  };
  Object.defineProperty(db, FLAG, { value: true, configurable: false });
}
