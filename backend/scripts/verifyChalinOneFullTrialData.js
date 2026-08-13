"use strict";

const { pool } = require("../config/db");
const { buildUnitEventHash } = require("../services/inventoryTraceabilityService");
const {
  CHALIN_ONE_STAGING_ENVIRONMENT_ID,
  SEED_MARKER,
  SEED_PREFIX,
} = require("./seedChalinOneFullTrialData");

class ChalinOneFullTrialVerificationError extends Error {
  constructor(message, code = "CHALIN_ONE_FULL_TRIAL_VERIFICATION_FAILED") {
    super(message);
    this.name = "ChalinOneFullTrialVerificationError";
    this.code = code;
  }
}

function fail(label, expected, actual) {
  throw new ChalinOneFullTrialVerificationError(
    `${label} expected ${JSON.stringify(expected)} but found ${JSON.stringify(actual)}.`
  );
}

function assertEqual(label, actual, expected) {
  if (actual !== expected) fail(label, expected, actual);
}

function assertNumber(label, actual, expected, tolerance = 0.001) {
  const number = Number(actual);
  if (!Number.isFinite(number) || Math.abs(number - expected) > tolerance) {
    fail(label, expected, actual);
  }
}

async function firstRow(connection, sql, params = []) {
  const [rows] = await connection.query(sql, params);
  return rows[0] || null;
}

async function requireRow(connection, sql, params, label) {
  const row = await firstRow(connection, sql, params);
  if (!row) {
    throw new ChalinOneFullTrialVerificationError(`${label} is missing.`);
  }
  return row;
}

async function tableExists(connection, tableName) {
  const row = await firstRow(
    connection,
    `SELECT COUNT(*) AS count
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tableName]
  );
  return Number(row?.count || 0) === 1;
}

function parseJson(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function verifyInventory(connection) {
  const rows = await connection.query(
    `SELECT barcode, quantity
       FROM products
      WHERE barcode IN (?, ?, ?, ?, ?, ?, ?)`,
    [
      `${SEED_PREFIX}-BRAKE-MAIN`,
      `${SEED_PREFIX}-OIL-MAIN`,
      `${SEED_PREFIX}-FILTER-MAIN`,
      `${SEED_PREFIX}-BATTERY-MAIN`,
      `${SEED_PREFIX}-HYD-MAIN`,
      `${SEED_PREFIX}-HELMET-MAIN`,
      `${SEED_PREFIX}-FILTER-AJAKAA`,
    ]
  );
  const products = new Map(rows[0].map((row) => [row.barcode, Number(row.quantity)]));
  const expected = new Map([
    [`${SEED_PREFIX}-BRAKE-MAIN`, 39],
    [`${SEED_PREFIX}-OIL-MAIN`, 23],
    [`${SEED_PREFIX}-FILTER-MAIN`, 25],
    [`${SEED_PREFIX}-BATTERY-MAIN`, 10],
    [`${SEED_PREFIX}-HYD-MAIN`, 9],
    [`${SEED_PREFIX}-HELMET-MAIN`, 29],
    [`${SEED_PREFIX}-FILTER-AJAKAA`, 5],
  ]);
  assertEqual("trial product count", products.size, expected.size);
  for (const [barcode, quantity] of expected) {
    assertNumber(`stock quantity ${barcode}`, products.get(barcode), quantity);
  }

  const purchase = await requireRow(
    connection,
    `SELECT total_amount, amount_paid, balance, payment_status
       FROM purchases WHERE invoice_number = ? LIMIT 1`,
    [`${SEED_PREFIX}-PO-001`],
    "trial opening purchase"
  );
  assertNumber("purchase total", purchase.total_amount, 27690);
  assertNumber("purchase amount paid", purchase.amount_paid, 27690);
  assertNumber("purchase balance", purchase.balance, 0);
  assertEqual("purchase payment status", purchase.payment_status, "paid");

  const sales = await firstRow(
    connection,
    `SELECT COUNT(*) AS count,
            COALESCE(SUM(total), 0) AS total,
            COALESCE(SUM(amount_paid), 0) AS paid,
            COALESCE(SUM(balance), 0) AS balance
       FROM sales
      WHERE receipt_number IN (?, ?, ?)`,
    [
      `${SEED_PREFIX}-SALE-CASH-001`,
      `${SEED_PREFIX}-SALE-CREDIT-001`,
      `${SEED_PREFIX}-SALE-MOMO-001`,
    ]
  );
  assertNumber("trial sale count", sales.count, 3);
  assertNumber("trial sale total", sales.total, 3320);
  assertNumber("trial sale receipts", sales.paid, 2120);
  assertNumber("trial sale outstanding", sales.balance, 1200);

  const debt = await requireRow(
    connection,
    `SELECT d.amount_owed, d.amount_paid, d.balance, d.status
       FROM debts d
       JOIN sales s ON s.id = d.sale_id
      WHERE s.receipt_number = ? LIMIT 1`,
    [`${SEED_PREFIX}-SALE-CREDIT-001`],
    "trial credit-sale debt"
  );
  assertNumber("debt amount owed", debt.amount_owed, 1200);
  assertNumber("debt payment total", debt.amount_paid, 300);
  assertNumber("debt balance", debt.balance, 900);
  assertEqual("debt status", debt.status, "partial");

  const returned = await requireRow(
    connection,
    `SELECT quantity, refund_amount, return_type
       FROM returns WHERE refund_reference = ? LIMIT 1`,
    [`${SEED_PREFIX}-RETURN-001`],
    "trial return"
  );
  assertNumber("return quantity", returned.quantity, 1);
  assertNumber("return refund", returned.refund_amount, 250);
  assertEqual("return type", returned.return_type, "refund");

  const transfer = await requireRow(
    connection,
    `SELECT i.requested_quantity, i.dispatched_quantity, i.received_quantity
       FROM stock_transfers t
       JOIN stock_transfer_items i ON i.transfer_id = t.id
      WHERE t.transfer_number = ? LIMIT 1`,
    [`${SEED_PREFIX}-TRANSFER-001`],
    "trial stock transfer"
  );
  assertNumber("transfer requested quantity", transfer.requested_quantity, 5);
  assertNumber("transfer dispatched quantity", transfer.dispatched_quantity, 5);
  assertNumber("transfer received quantity", transfer.received_quantity, 5);

  const closing = await requireRow(
    connection,
    `SELECT dc.sales_count, dc.sales_total, dc.sales_received,
            dc.debt_payments_total, dc.expenses_total,
            dc.expected_total, dc.total_counted, dc.difference_total
       FROM daily_closings dc
       JOIN branches b ON b.id = dc.branch_id
      WHERE (b.code = 'MAIN' OR b.branch_code = 'MAIN')
        AND dc.closing_date = '2026-08-12'
      LIMIT 1`,
    [],
    "trial daily closing"
  );
  assertNumber("closing sale count", closing.sales_count, 3);
  assertNumber("closing sales total", closing.sales_total, 3320);
  assertNumber("closing sales received", closing.sales_received, 2120);
  assertNumber("closing debt receipts", closing.debt_payments_total, 300);
  assertNumber("closing expenses", closing.expenses_total, 150);
  assertNumber("closing expected total", closing.expected_total, 2270);
  assertNumber("closing counted total", closing.total_counted, 2270);
  assertNumber("closing difference", closing.difference_total, 0);

  return Object.freeze({
    products: 7,
    purchase_total: 27690,
    sales_count: 3,
    sales_total: 3320,
    debt_balance: 900,
    return_refund: 250,
    transfer_quantity: 5,
    closing_difference: 0,
  });
}

async function verifyPayroll(connection) {
  const workers = await firstRow(
    connection,
    `SELECT COUNT(*) AS count
       FROM worker_profiles
      WHERE employee_number IN (?, ?, ?, ?, ?)`,
    [
      `${SEED_PREFIX}-WRK-SP001`,
      `${SEED_PREFIX}-WRK-SP002`,
      `${SEED_PREFIX}-WRK-MN001`,
      `${SEED_PREFIX}-WRK-MN002`,
      `${SEED_PREFIX}-WRK-HR001`,
    ]
  );
  assertNumber("trial worker count", workers.count, 5);

  const compensation = await firstRow(
    connection,
    `SELECT COUNT(*) AS count, COALESCE(SUM(p.basic_salary), 0) AS basic_salary
       FROM payroll_compensation_profiles p
       JOIN worker_profiles w ON w.id = p.worker_id
      WHERE w.employee_number IN (?, ?, ?, ?, ?)
        AND p.effective_from = '2026-08-01'`,
    [
      `${SEED_PREFIX}-WRK-SP001`,
      `${SEED_PREFIX}-WRK-SP002`,
      `${SEED_PREFIX}-WRK-MN001`,
      `${SEED_PREFIX}-WRK-MN002`,
      `${SEED_PREFIX}-WRK-HR001`,
    ]
  );
  assertNumber("compensation profile count", compensation.count, 5);
  assertNumber("trial basic salary total", compensation.basic_salary, 22200);

  const entries = await firstRow(
    connection,
    `SELECT COUNT(*) AS count,
            COALESCE(SUM(e.gross_earnings), 0) AS gross,
            COALESCE(SUM(e.total_deductions), 0) AS deductions,
            COALESCE(SUM(e.net_salary), 0) AS net,
            COALESCE(SUM(e.amount_paid), 0) AS paid,
            COALESCE(SUM(e.remaining_balance), 0) AS remaining
       FROM payroll_entries e
       JOIN worker_profiles w ON w.id = e.worker_id
      WHERE w.employee_number IN (?, ?, ?, ?, ?)`,
    [
      `${SEED_PREFIX}-WRK-SP001`,
      `${SEED_PREFIX}-WRK-SP002`,
      `${SEED_PREFIX}-WRK-MN001`,
      `${SEED_PREFIX}-WRK-MN002`,
      `${SEED_PREFIX}-WRK-HR001`,
    ]
  );
  assertNumber("payroll entry count", entries.count, 5);
  assertNumber("payroll gross", entries.gross, 22200);
  assertNumber("payroll deductions", entries.deductions, 1110);
  assertNumber("payroll net", entries.net, 21090);
  assertNumber("payroll paid", entries.paid, 9500);
  assertNumber("payroll remaining", entries.remaining, 11590);

  const payments = await firstRow(
    connection,
    `SELECT COUNT(*) AS count, COALESCE(SUM(p.amount), 0) AS total
       FROM payroll_salary_payments p
       JOIN worker_profiles w ON w.id = p.worker_id
      WHERE w.employee_number IN (?, ?)
        AND p.idempotency_key IN (?, ?)`,
    [
      `${SEED_PREFIX}-WRK-SP001`,
      `${SEED_PREFIX}-WRK-MN001`,
      `${SEED_PREFIX}-PAYMENT-${SEED_PREFIX}-WRK-SP001`,
      `${SEED_PREFIX}-PAYMENT-${SEED_PREFIX}-WRK-MN001`,
    ]
  );
  assertNumber("salary payment count", payments.count, 2);
  assertNumber("salary payment total", payments.total, 9500);

  return Object.freeze({
    workers: 5,
    basic_salary_total: 22200,
    payroll_net: 21090,
    payroll_paid: 9500,
    payroll_remaining: 11590,
  });
}

async function verifyMining(connection) {
  const site = await requireRow(
    connection,
    `SELECT id FROM mining_sites WHERE site_code = ? LIMIT 1`,
    [`${SEED_PREFIX}-MINE-01`],
    "trial mining site"
  );
  const production = await requireRow(
    connection,
    `SELECT quantity, unit
       FROM mining_production_records
      WHERE site_id = ? AND production_datetime = '2026-08-12 17:15:00'
      LIMIT 1`,
    [site.id],
    "trial mining production"
  );
  assertNumber("mining production quantity", production.quantity, 128.5);
  assertEqual("mining production unit", production.unit, "tonnes");

  const fuel = await requireRow(
    connection,
    `SELECT quantity_litres, total_cost
       FROM mining_fuel_logs WHERE reference_number = ? LIMIT 1`,
    [`${SEED_PREFIX}-MINE-FUEL-001`],
    "trial mining fuel issue"
  );
  assertNumber("mining fuel litres", fuel.quantity_litres, 145);
  assertNumber("mining fuel cost", fuel.total_cost, 2247.5);

  const incident = await firstRow(
    connection,
    `SELECT COUNT(*) AS count
       FROM mining_incidents
      WHERE site_id = ?
        AND incident_datetime = '2026-08-12 14:20:00'
        AND immediate_action IS NOT NULL
        AND corrective_action IS NOT NULL`,
    [site.id]
  );
  assertNumber("closed mining incident evidence", incident.count, 1);

  const asset = await requireRow(
    connection,
    `SELECT current_meter FROM fleet_assets WHERE asset_code = ? LIMIT 1`,
    [`${SEED_PREFIX}-EXC-01`],
    "trial mining excavator"
  );
  assertNumber("mining excavator current meter", asset.current_meter, 1254.5);

  return Object.freeze({
    production_tonnes: 128.5,
    fuel_litres: 145,
    incident_evidence: 1,
    excavator_meter: 1254.5,
  });
}

async function verifyHire(connection) {
  const invoice = await requireRow(
    connection,
    `SELECT total_amount, amount_paid, balance
       FROM hire_invoices WHERE invoice_number = ? LIMIT 1`,
    [`${SEED_PREFIX}-HINV-001`],
    "trial hire invoice"
  );
  assertNumber("hire invoice total", invoice.total_amount, 23200);
  assertNumber("hire invoice paid", invoice.amount_paid, 12000);
  assertNumber("hire invoice balance", invoice.balance, 11200);

  const payment = await requireRow(
    connection,
    `SELECT amount FROM hire_payments WHERE reference_number = ? LIMIT 1`,
    [`${SEED_PREFIX}-HPAY-001`],
    "trial hire payment"
  );
  assertNumber("hire payment", payment.amount, 12000);

  const flow = await firstRow(
    connection,
    `SELECT COUNT(*) AS count
       FROM hire_contracts c
       JOIN hire_quotations q ON q.id = c.quotation_id
       JOIN hire_enquiries e ON e.id = q.enquiry_id
       JOIN hire_customers hc ON hc.id = c.customer_id
      WHERE c.contract_number = ?
        AND q.quotation_number = ?
        AND e.enquiry_number = ?
        AND hc.customer_code = ?`,
    [
      `${SEED_PREFIX}-HCON-001`,
      `${SEED_PREFIX}-HQUO-001`,
      `${SEED_PREFIX}-HENQ-001`,
      `${SEED_PREFIX}-HCUS-001`,
    ]
  );
  assertNumber("hire enquiry-to-contract chain", flow.count, 1);

  return Object.freeze({
    invoice_total: 23200,
    paid: 12000,
    balance: 11200,
    governed_flow: 1,
  });
}

async function verifyAiKnowledge(connection) {
  const keys = [
    "chalin_one_full_trial_playbook",
    "chalin_one_trial_spare_parts_policy",
    "chalin_one_trial_mining_policy",
    "chalin_one_trial_hire_policy",
  ];
  const placeholders = keys.map(() => "?").join(", ");
  const published = await firstRow(
    connection,
    `SELECT COUNT(*) AS count
       FROM ai_knowledge_sources s
       JOIN ai_knowledge_versions v ON v.source_id = s.id
      WHERE s.source_key IN (${placeholders})
        AND s.source_status = 'active'
        AND v.version_number = 1
        AND v.version_status = 'published'`,
    keys
  );
  assertNumber("published trial AI knowledge sources", published.count, 4);

  const approvals = await firstRow(
    connection,
    `SELECT COUNT(*) AS count
       FROM ai_knowledge_sources s
       JOIN ai_knowledge_versions v ON v.source_id = s.id
       JOIN ai_knowledge_approvals a
         ON a.source_id = s.id AND a.version_id = v.id
      WHERE s.source_key IN (${placeholders})
        AND a.approval_status = 'approved'
        AND a.requested_by <> a.decided_by`,
    keys
  );
  assertNumber("independently approved trial AI sources", approvals.count, 4);

  return Object.freeze({
    active_published_sources: 4,
    independently_approved_sources: 4,
  });
}

async function verifyTraceability(connection) {
  const required = [
    "inventory_label_batches",
    "inventory_units",
    "inventory_unit_events",
  ];
  const existence = await Promise.all(required.map((name) => tableExists(connection, name)));
  if (existence.some((present) => !present)) {
    return Object.freeze({ supported: false });
  }

  const unit = await requireRow(
    connection,
    `SELECT * FROM inventory_units WHERE unit_code = 'TRLBAT001-ABCD2345' LIMIT 1`,
    [],
    "trial serialized inventory unit"
  );
  assertEqual("traceability unit status", unit.status, "active");

  const batch = await requireRow(
    connection,
    `SELECT * FROM inventory_label_batches
      WHERE batch_code = 'LBL-MAIN-20260813-ABC234' LIMIT 1`,
    [],
    "trial traceability label batch"
  );
  assertEqual("traceability batch status", batch.status, "activated");
  assertNumber("traceability batch activated quantity", batch.activated_quantity, 1);

  const event = await requireRow(
    connection,
    `SELECT * FROM inventory_unit_events
      WHERE unit_id = ? AND event_sequence = 1 LIMIT 1`,
    [unit.id],
    "trial traceability activation event"
  );
  const expectedHash = buildUnitEventHash({
    unitId: event.unit_id,
    eventSequence: event.event_sequence,
    branchId: event.branch_id,
    eventType: event.event_type,
    fromStatus: event.from_status,
    toStatus: event.to_status,
    sourceType: event.source_type,
    sourceId: event.source_id,
    actorUserId: event.actor_user_id,
    reason: event.reason,
    requestId: event.request_id,
    metadata: parseJson(event.metadata_json),
    previousEventHash: event.previous_event_hash,
  });
  assertEqual(
    "traceability event hash",
    String(event.event_hash || "").toLowerCase(),
    expectedHash
  );

  return Object.freeze({
    supported: true,
    activated_units: 1,
    event_hash_verified: true,
  });
}

async function verifyChalinOneFullTrialData({
  connection = null,
  env = process.env,
  allowFixture = false,
} = {}) {
  const environmentId = String(env.RAILWAY_ENVIRONMENT_ID || "").trim();
  if (!allowFixture && environmentId !== CHALIN_ONE_STAGING_ENVIRONMENT_ID) {
    throw new ChalinOneFullTrialVerificationError(
      "Full-trial verification is allowed only in the dedicated CHALIN ONE Railway staging environment.",
      "CHALIN_ONE_FULL_TRIAL_VERIFICATION_ENVIRONMENT_REFUSED"
    );
  }

  const own = !connection;
  const db = connection || (await pool.getConnection());
  try {
    const marker = await firstRow(
      db,
      `SELECT COUNT(*) AS count
         FROM schema_migrations WHERE migration_name = ?`,
      [SEED_MARKER]
    );
    assertNumber("full-trial seed marker", marker?.count, 1);

    const inventory = await verifyInventory(db);
    const payroll = await verifyPayroll(db);
    const mining = await verifyMining(db);
    const equipmentHire = await verifyHire(db);
    const aiKnowledge = await verifyAiKnowledge(db);
    const traceability = await verifyTraceability(db);

    return Object.freeze({
      status: "verified",
      marker: SEED_MARKER,
      seed_prefix: SEED_PREFIX,
      environment_id: environmentId || null,
      checks: Object.freeze({
        inventory,
        payroll,
        mining,
        equipment_hire: equipmentHire,
        ai_knowledge: aiKnowledge,
        inventory_traceability: traceability,
      }),
    });
  } finally {
    if (own) db.release();
  }
}

async function runCli() {
  const result = await verifyChalinOneFullTrialData();
  console.log("CHALIN ONE full-trial data verification passed.");
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  runCli()
    .catch((error) => {
      console.error(
        `CHALIN ONE full-trial verification failed [${
          error.code || "ERROR"
        }]: ${error.message}`
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      try {
        await pool.end();
      } catch {}
    });
}

module.exports = {
  ChalinOneFullTrialVerificationError,
  verifyChalinOneFullTrialData,
};
