"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  READY_CASH_SEQUENCES,
  ensureReadyCashSequences,
} = require("../services/equipmentFinanceReadyCashSequenceService");

function fakePool({ inactive = null, failure = null } = {}) {
  const state = {
    begins: 0, commits: 0, rollbacks: 0, releases: 0,
    statements: [], sequenceRows: new Map(),
  };
  const connection = {
    beginTransaction: async () => { state.begins++; },
    commit: async () => { state.commits++; },
    rollback: async () => { state.rollbacks++; },
    release: () => { state.releases++; },
    query: async (sql, params) => {
      state.statements.push({ sql, params });
      if (failure && sql.includes(failure)) throw new Error("Synthetic database failure");
      if (sql.includes("INSERT INTO document_sequences")) {
        assert.equal(params.length, 18, "Six exact Ready Cash sequence definitions");
        for (let i = 0; i < params.length; i += 3) {
          const [code, name, prefix] = params.slice(i, i+3);
          if (!state.sequenceRows.has(code)) {
            state.sequenceRows.set(code, {
              sequence_code: code, document_name: name, prefix,
              next_number: 500, is_active: code === inactive ? 0 : 1,
            });
          }
        }
        return [{ affectedRows: 6 }];
      }
      if (sql.includes("SELECT sequence_code,is_active FROM document_sequences")) {
        return [[...state.sequenceRows.values()].map((row) => ({
          sequence_code: row.sequence_code, is_active: row.is_active,
        }))];
      }
      throw new Error("Unexpected query: " + sql.slice(0, 100));
    },
  };
  return { getConnection: async () => connection, state };
}

test("each Ready Cash reference has its own stable code, exclusive prefix, and no annual counter reset", () => {
  assert.deepEqual(READY_CASH_SEQUENCES.map(x=>x.code), [
    "READY_CASH_QUOTATION","READY_CASH_AGREEMENT",
    "READY_CASH_PAYMENT","READY_CASH_RECEIPT",
    "READY_CASH_DELIVERY","READY_CASH_OWNERSHIP_TRANSFER",
  ]);
  assert.deepEqual(READY_CASH_SEQUENCES.map(x=>x.prefix), ["RCQ","RCA","RCP","RCR","RCD","RCT"]);
});

test("missing Ready Cash numbers are initialized atomically without changing receipts or other sequences", async () => {
  const fake=fakePool();
  assert.deepEqual((await ensureReadyCashSequences(fake)).ready,true);
  assert.equal(fake.state.begins,1);
  assert.equal(fake.state.commits,1);
  assert.equal(fake.state.rollbacks,0);
  assert.equal(fake.state.releases,1);
  assert.equal(fake.state.sequenceRows.size,6);
  const inserts=fake.state.statements.filter(x=>x.sql.includes("INSERT"));
  assert.equal(inserts.length,1);
  assert.match(inserts[0].sql,/ON DUPLICATE KEY UPDATE sequence_code = sequence_code/);
  assert.match(inserts[0].sql,/reset_policy,include_year,include_month/);
  assert.match(inserts[0].sql,/'none', TRUE, FALSE/);
  assert.equal(fake.state.statements.some(x=>/equipment_sale_payments|fleet_assets|equipment_sale_agreements/.test(x.sql)),false);
});

test("retry is idempotent; existing configured counters are never reset", async () => {
  const fake=fakePool();
  await ensureReadyCashSequences(fake);
  fake.state.sequenceRows.get("READY_CASH_RECEIPT").next_number=9001;
  await ensureReadyCashSequences(fake);
  assert.equal(fake.state.sequenceRows.get("READY_CASH_RECEIPT").next_number,9001);
  assert.equal(fake.state.commits,2);
  assert.equal(fake.state.releases,2);
});

test("manually deactivated document number blocks checkout cleanly rather than bypassing policy", async () => {
  const fake=fakePool({ inactive:"READY_CASH_PAYMENT" });
  await assert.rejects(
    () => ensureReadyCashSequences(fake),
    e=>e.statusCode===503 && e.code==="READY_CASH_NUMBERING_UNAVAILABLE" &&
      e.message.includes("READY_CASH_PAYMENT")
  );
  assert.equal(fake.state.commits,0);
  assert.equal(fake.state.rollbacks,1);
  assert.equal(fake.state.releases,1);
});

test("failure to initialize leaves no half-complete numbering configuration", async () => {
  const fake=fakePool({ failure:"SELECT sequence_code,is_active" });
  await assert.rejects(()=>ensureReadyCashSequences(fake),/Synthetic database failure/);
  assert.equal(fake.state.commits,0);
  assert.equal(fake.state.rollbacks,1);
  assert.equal(fake.state.releases,1);
});

test("ready cash checkout uses its own safe sequences and startup does not post a sale",()=>{
  const route=fs.readFileSync(path.join(__dirname,"../routes/equipmentFinanceReadyCashRoutes.js"),"utf8");
  const bootstrap=fs.readFileSync(path.join(__dirname,"../services/equipmentFinanceReadyCashSequenceBootstrap.js"),"utf8");
  const preload=fs.readFileSync(path.join(__dirname,"../services/exportWorkbookSafetyBootstrap.js"),"utf8");
  assert.match(route,/nextReadyCashDocumentNumbers\(\{ userId \}\)/);
  assert.match(route,/nextReadyCashDocumentNumbers\(\{ userId, stage: "handover" \}\)/);
  assert.doesNotMatch(route,/nextDocumentNumber\("EQUIPMENT_SALES_QUOTATION"/);
  assert.match(bootstrap,/testDatabaseConnection/);
  assert.match(bootstrap,/ensureReadyCashSequences\(\)/);
  assert.match(preload,/require\("\.\/equipmentFinanceReadyCashSequenceBootstrap"\)/);
  assert.doesNotMatch(bootstrap,/equipment_sale_payments|equipment_sale_agreements|INSERT INTO fleet_assets/);
});
