"use strict";

const crypto = require("node:crypto");

const { pool } = require("../config/db");
const { buildUnitEventHash } = require("../services/inventoryTraceabilityService");

const CHALIN_ONE_STAGING_ENVIRONMENT_ID =
  "db796450-1b80-42e8-9988-db3e90ca0713";
const STAGING_DATABASE_MARKERS = Object.freeze([
  "chalin_one_full_staging_completion_v1",
  "chalin_one_staging_auth_baseline_v1",
  "chalin_one_staging_clean_master_schema_bootstrap_v1",
]);
const SEED_MARKER = "chalin_one_full_trial_data_seed_v1";
const SEED_PREFIX = "TRIAL-20260813";
const REQUIRED_TABLES = Object.freeze([
  "branches", "business_units", "business_locations", "users", "schema_migrations",
  "products", "suppliers", "purchases", "purchase_items", "purchase_payments",
  "customers", "sales", "sale_items", "sale_payment_allocations", "debts",
  "debt_payments", "returns", "stock_transfers", "stock_transfer_items",
  "stock_adjustments", "expenses", "daily_closings", "worker_profiles",
  "worker_assignments", "payroll_compensation_profiles", "payroll_periods",
  "payroll_entries", "payroll_entry_lines", "payroll_salary_payments", "mining_sites",
  "mining_daily_logs", "mining_equipment_logs", "mining_expenses", "mining_fuel_logs",
  "mining_incidents", "mining_production_records", "fleet_assets", "fleet_fuel_logs",
  "fleet_inspections", "fleet_maintenance_records", "fleet_meter_readings", "hire_customers",
  "hire_enquiries", "hire_quotations", "hire_contracts", "hire_contract_assets",
  "hire_dispatches", "hire_work_logs", "hire_return_inspections", "hire_invoices",
  "hire_invoice_lines", "hire_payments", "ai_knowledge_sources", "ai_knowledge_versions",
  "ai_knowledge_approvals",
]);

const columnCache = new Map();

class ChalinOneFullTrialSeedError extends Error {
  constructor(message, code = "CHALIN_ONE_FULL_TRIAL_SEED_FAILED") {
    super(message);
    this.name = "ChalinOneFullTrialSeedError";
    this.code = code;
  }
}

function safeIdentifier(value) {
  const text = String(value || "");
  if (!/^[A-Za-z0-9_]+$/.test(text)) {
    throw new ChalinOneFullTrialSeedError(
      `Unsafe SQL identifier: ${text}`,
      "CHALIN_ONE_FULL_TRIAL_SEED_IDENTIFIER_INVALID"
    );
  }
  return `\`${text}\``;
}

function sha256(value) {
  return crypto.createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
}

function stat(stats, moduleName, field, amount = 1) {
  stats[moduleName] ||= { inserted: 0, existing: 0, skipped: 0 };
  stats[moduleName][field] += amount;
}

async function tableExists(connection, tableName) {
  const [rows] = await connection.query(
    `SELECT 1 FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND TABLE_TYPE = 'BASE TABLE' LIMIT 1`,
    [tableName]
  );
  return rows.length > 0;
}

async function tableMetadata(connection, tableName) {
  if (columnCache.has(tableName)) return columnCache.get(tableName);
  if (!(await tableExists(connection, tableName))) {
    throw new ChalinOneFullTrialSeedError(
      `Required staging table is missing: ${tableName}`,
      "CHALIN_ONE_FULL_TRIAL_SEED_SCHEMA_INCOMPLETE"
    );
  }
  const [rows] = await connection.query(`SHOW FULL COLUMNS FROM ${safeIdentifier(tableName)}`);
  const metadata = rows.map((row) => ({
    name: row.Field,
    type: String(row.Type || "").toLowerCase(),
    nullable: String(row.Null || "").toUpperCase() === "YES",
    defaultValue: row.Default,
    extra: String(row.Extra || "").toLowerCase(),
  }));
  columnCache.set(tableName, metadata);
  return metadata;
}

async function enumValue(connection, tableName, columnName, candidates) {
  const metadata = await tableMetadata(connection, tableName);
  const column = metadata.find((item) => item.name === columnName);
  if (!column || !column.type.startsWith("enum(")) return candidates[0];
  const values = [...column.type.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map(
    (match) => match[1].replace(/\\'/g, "'")
  );
  for (const candidate of candidates) {
    if (values.includes(candidate)) return candidate;
  }
  if (values[0]) return values[0];
  throw new ChalinOneFullTrialSeedError(
    `No enum value is available for ${tableName}.${columnName}`,
    "CHALIN_ONE_FULL_TRIAL_SEED_ENUM_INVALID"
  );
}

async function findRow(connection, tableName, lookup) {
  const entries = Object.entries(lookup || {});
  if (!entries.length) return null;
  const clauses = [];
  const params = [];
  for (const [column, value] of entries) {
    if (value === null) clauses.push(`${safeIdentifier(column)} IS NULL`);
    else {
      clauses.push(`${safeIdentifier(column)} = ?`);
      params.push(value);
    }
  }
  const [rows] = await connection.query(
    `SELECT * FROM ${safeIdentifier(tableName)} WHERE ${clauses.join(" AND ")} LIMIT 1`,
    params
  );
  return rows[0] || null;
}

async function insertOrGet(connection, tableName, lookup, values, stats, moduleName) {
  const existing = await findRow(connection, tableName, lookup);
  if (existing) {
    stat(stats, moduleName, "existing");
    return existing;
  }
  const metadata = await tableMetadata(connection, tableName);
  const metadataByName = new Map(metadata.map((item) => [item.name, item]));
  const insertColumns = Object.keys(values).filter((column) => metadataByName.has(column));
  const missingRequired = metadata.filter(
    (column) => !column.extra.includes("auto_increment") && !column.extra.includes("generated") &&
      !column.nullable && column.defaultValue === null && !insertColumns.includes(column.name)
  );
  if (missingRequired.length) {
    throw new ChalinOneFullTrialSeedError(
      `Seed row for ${tableName} is missing required column(s): ${missingRequired.map((c) => c.name).join(", ")}`,
      "CHALIN_ONE_FULL_TRIAL_SEED_REQUIRED_VALUE_MISSING"
    );
  }
  const [result] = await connection.query(
    `INSERT INTO ${safeIdentifier(tableName)} (${insertColumns.map(safeIdentifier).join(", ")}) VALUES (${insertColumns.map(() => "?").join(", ")})`,
    insertColumns.map((column) => values[column])
  );
  stat(stats, moduleName, "inserted");
  if (result.insertId) {
    const [rows] = await connection.query(
      `SELECT * FROM ${safeIdentifier(tableName)} WHERE id = ? LIMIT 1`,
      [result.insertId]
    );
    return rows[0] || { id: Number(result.insertId), ...values };
  }
  return (await findRow(connection, tableName, lookup)) || values;
}

async function assertStagingTarget(connection, { allowFixture = false } = {}) {
  const environmentId = String(process.env.RAILWAY_ENVIRONMENT_ID || "").trim();
  if (!allowFixture && environmentId !== CHALIN_ONE_STAGING_ENVIRONMENT_ID) {
    throw new ChalinOneFullTrialSeedError(
      "Full trial seeding is allowed only in the dedicated CHALIN ONE Railway staging environment.",
      "CHALIN_ONE_FULL_TRIAL_SEED_ENVIRONMENT_REFUSED"
    );
  }
  const [[databaseRow]] = await connection.query("SELECT DATABASE() AS database_name");
  if (!(await tableExists(connection, "schema_migrations"))) {
    throw new ChalinOneFullTrialSeedError(
      "The target database has no schema_migrations ledger.",
      "CHALIN_ONE_FULL_TRIAL_SEED_MARKERS_UNAVAILABLE"
    );
  }
  const placeholders = STAGING_DATABASE_MARKERS.map(() => "?").join(", ");
  const [markerRows] = await connection.query(
    `SELECT migration_name FROM schema_migrations WHERE migration_name IN (${placeholders})`,
    STAGING_DATABASE_MARKERS
  );
  const found = new Set(markerRows.map((row) => String(row.migration_name || "").trim()));
  const missing = STAGING_DATABASE_MARKERS.filter((name) => !found.has(name));
  if (missing.length) {
    throw new ChalinOneFullTrialSeedError(
      `The target database is not a verified CHALIN ONE staging database. Missing markers: ${missing.join(", ")}`,
      "CHALIN_ONE_FULL_TRIAL_SEED_DATABASE_REFUSED"
    );
  }
  for (const tableName of REQUIRED_TABLES) {
    if (!(await tableExists(connection, tableName))) {
      throw new ChalinOneFullTrialSeedError(
        `The full-trial seed requires ${tableName}, but the staging schema does not contain it.`,
        "CHALIN_ONE_FULL_TRIAL_SEED_SCHEMA_INCOMPLETE"
      );
    }
  }
  return { database_name: databaseRow?.database_name || null, environment_id: environmentId || null };
}

async function seedSpareParts(connection, context, stats) {
  const { adminId, mainBranchId, secondBranchId } = context;
  const supplier = await insertOrGet(connection, "suppliers",
    { branch_id: mainBranchId, name: `${SEED_PREFIX} Auto & Industrial Supply` },
    { branch_id: mainBranchId, name: `${SEED_PREFIX} Auto & Industrial Supply`, contact_person: "Synthetic Supplier Desk", phone: "0200000101", email: "trial-supplier@example.invalid", address: "CHALIN ONE synthetic trial supplier", notes: "Synthetic full-system trial data. Not a real supplier.", is_active: 1 }, stats, "spare_parts");

  const defs = [
    ["brake", mainBranchId, "Brake Pad Set - Hilux", "Front", "Brake System", 180, 250, 39, 5, "BRAKE-MAIN", "quantity", "TRLBRK001", "standard", "off"],
    ["oil", mainBranchId, "Engine Oil 15W40 5L", "5L", "Lubricant & Oil", 210, 300, 23, 6, "OIL-MAIN", "quantity", "TRLOIL001", "standard", "off"],
    ["filter", mainBranchId, "Toyota Oil Filter", "Standard", "Filters", 55, 85, 25, 8, "FILTER-MAIN", "quantity", "TRLFIL001", "standard", "off"],
    ["battery", mainBranchId, "N70 12V Battery", "N70", "Electrical", 620, 800, 10, 3, "BATTERY-MAIN", "serialized", "TRLBAT001", "high", "setup"],
    ["hydraulic", mainBranchId, "CAT 320 Hydraulic Filter", "CAT 320", "Heavy Equipment Filters", 390, 620, 9, 3, "HYD-MAIN", "quantity", "TRLHYD001", "high", "off"],
    ["helmet", mainBranchId, "Mining Safety Helmet", "Universal", "PPE", 75, 120, 29, 10, "HELMET-MAIN", "quantity", "TRLHEL001", "standard", "off"],
    ["filterDestination", secondBranchId, "Toyota Oil Filter", "Standard", "Filters", 55, 85, 5, 4, "FILTER-AJAKAA", "quantity", "TRLFILAJ1", "standard", "off"],
  ];
  const products = {};
  for (const [key, branchId, name, size, category, cost, price, qty, low, barcodeSuffix, tracking, productCode, risk, state] of defs) {
    const barcode = `${SEED_PREFIX}-${barcodeSuffix}`;
    products[key] = await insertOrGet(connection, "products", { branch_id: branchId, barcode }, {
      branch_id: branchId, name: `${SEED_PREFIX} ${name}`, size, category, cost_price: cost,
      selling_price: price, quantity: qty, low_stock_threshold: low, barcode,
      inventory_tracking_mode: tracking, inventory_product_code: productCode,
      inventory_risk_tier: risk, inventory_traceability_state: state,
      inventory_traceability_configured_by: adminId,
      inventory_traceability_configured_at: "2026-08-11 08:00:00", is_active: 1, created_by: adminId,
    }, stats, "spare_parts");
  }

  const purchaseTotal = 40*180 + 25*210 + 30*55 + 12*620 + 10*390 + 30*75;
  const purchase = await insertOrGet(connection, "purchases", { branch_id: mainBranchId, invoice_number: `${SEED_PREFIX}-PO-001` }, {
    branch_id: mainBranchId, supplier_id: supplier.id, invoice_number: `${SEED_PREFIX}-PO-001`, purchase_date: "2026-08-11",
    total_cost: purchaseTotal, total_amount: purchaseTotal, amount_paid: purchaseTotal, balance: 0, payment_status: "paid",
    notes: "Synthetic opening stock purchase for CHALIN ONE full-system trial.", created_by: adminId,
  }, stats, "spare_parts");
  for (const [product, quantity, cost] of [[products.brake,40,180],[products.oil,25,210],[products.filter,30,55],[products.battery,12,620],[products.hydraulic,10,390],[products.helmet,30,75]]) {
    await insertOrGet(connection, "purchase_items", { purchase_id: purchase.id, product_id: product.id }, {
      purchase_id: purchase.id, product_id: product.id, product_name: product.name, quantity, cost_price: cost, line_total: quantity*cost,
    }, stats, "spare_parts");
  }
  await insertOrGet(connection, "purchase_payments", { purchase_id: purchase.id, amount: purchaseTotal }, {
    branch_id: mainBranchId, purchase_id: purchase.id, amount: purchaseTotal, payment_method: "bank", paid_by: adminId,
    notes: `${SEED_PREFIX} synthetic supplier settlement`,
  }, stats, "spare_parts");

  const customers = {};
  for (const [key,name,phone,location] of [
    ["cash",`${SEED_PREFIX} Ama Cash Customer`,"0200000201","Dunkwa"],
    ["credit",`${SEED_PREFIX} Kojo Credit Customer`,"0200000202","Ayanfuri"],
    ["momo",`${SEED_PREFIX} Efua MoMo Customer`,"0200000203","Dunkwa"],
  ]) customers[key] = await insertOrGet(connection, "customers", { branch_id: mainBranchId, phone }, { branch_id: mainBranchId, name, phone, location }, stats, "spare_parts");

  async function sale(key, customer, total, paymentType, paid, itemDefs) {
    const receipt = `${SEED_PREFIX}-SALE-${key}`;
    const row = await insertOrGet(connection, "sales", { receipt_number: receipt }, {
      branch_id: mainBranchId, receipt_number: receipt, customer_id: customer.id, customer_name: customer.name,
      customer_phone: customer.phone, staff_id: adminId, subtotal: total, discount_amount: 0, tax_amount: 0,
      total, payment_type: paymentType, amount_tendered: paid, amount_paid: paid, change_due: 0, balance: total-paid,
      sale_status: "completed", is_voided: 0,
    }, stats, "spare_parts");
    for (const [product, quantity, price] of itemDefs) await insertOrGet(connection, "sale_items", { sale_id: row.id, product_id: product.id }, {
      sale_id: row.id, product_id: product.id, product_name: product.name, quantity, unit_price: price,
      line_total: quantity*price, cost_price_at_sale: Number(product.cost_price),
    }, stats, "spare_parts");
    if (paid > 0) await insertOrGet(connection, "sale_payment_allocations", { sale_id: row.id, payment_channel: paymentType === "credit" ? "cash" : paymentType }, {
      branch_id: mainBranchId, sale_id: row.id, payment_channel: paymentType === "credit" ? "cash" : paymentType,
      amount: paid, recorded_by: adminId,
    }, stats, "spare_parts");
    return row;
  }
  const cashSale = await sale("CASH-001", customers.cash, 1100, "cash", 1100, [[products.brake,2,250],[products.oil,2,300]]);
  const creditSale = await sale("CREDIT-001", customers.credit, 1600, "credit", 400, [[products.battery,2,800]]);
  const momoSale = await sale("MOMO-001", customers.momo, 620, "momo", 620, [[products.hydraulic,1,620]]);
  const debt = await insertOrGet(connection, "debts", { branch_id: mainBranchId, sale_id: creditSale.id }, {
    branch_id: mainBranchId, sale_id: creditSale.id, customer_id: customers.credit.id, customer_name: customers.credit.name,
    customer_phone: customers.credit.phone, amount_owed: 1200, amount_paid: 300, balance: 900, status: "partial", due_date: "2026-09-12",
  }, stats, "spare_parts");
  await insertOrGet(connection, "debt_payments", { debt_id: debt.id, amount: 300 }, {
    branch_id: mainBranchId, debt_id: debt.id, amount: 300, payment_method: "cash", received_by: adminId,
    notes: `${SEED_PREFIX} synthetic part-payment`,
  }, stats, "spare_parts");
  await insertOrGet(connection, "returns", { branch_id: mainBranchId, sale_id: cashSale.id, product_id: products.brake.id, return_type: "refund" }, {
    branch_id: mainBranchId, sale_id: cashSale.id, product_id: products.brake.id, quantity: 1,
    reason: "Synthetic trial return: customer changed mind.", return_type: "refund", refund_amount: 250,
    refund_method: "cash", refund_reference: `${SEED_PREFIX}-RETURN-001`, returned_by: adminId,
    approved_by: adminId, approved_at: "2026-08-12 11:00:00",
  }, stats, "spare_parts");

  const transfer = await insertOrGet(connection, "stock_transfers", { transfer_number: `${SEED_PREFIX}-TRANSFER-001` }, {
    transfer_number: `${SEED_PREFIX}-TRANSFER-001`, from_branch_id: mainBranchId, to_branch_id: secondBranchId,
    status: await enumValue(connection, "stock_transfers", "status", ["received","completed","dispatched","approved"]),
    requested_by: adminId, approved_by: adminId, dispatched_by: adminId, received_by: adminId,
    request_note: "Synthetic trial transfer of five filters.", approval_note: "Approved for CHALIN ONE trial.",
    dispatch_note: "Synthetic dispatch completed.", receive_note: "Synthetic destination receipt confirmed.",
    approved_at: "2026-08-12 13:00:00", dispatched_at: "2026-08-12 13:15:00", received_at: "2026-08-12 14:00:00",
  }, stats, "spare_parts");
  await insertOrGet(connection, "stock_transfer_items", { transfer_id: transfer.id, source_product_id: products.filter.id }, {
    transfer_id: transfer.id, source_product_id: products.filter.id, destination_product_id: products.filterDestination.id,
    product_name: products.filter.name, barcode: products.filter.barcode, category: products.filter.category, size: products.filter.size,
    requested_quantity: 5, dispatched_quantity: 5, received_quantity: 5, source_quantity_before: 30, source_quantity_after: 25,
    destination_quantity_before: 0, destination_quantity_after: 5, item_note: "Synthetic full-trial received transfer.",
  }, stats, "spare_parts");
  await insertOrGet(connection, "stock_adjustments", { branch_id: mainBranchId, product_id: products.helmet.id, reference_number: `${SEED_PREFIX}-ADJ-001` }, {
    branch_id: mainBranchId, product_id: products.helmet.id, adjustment_type: "decrease", movement_type: "damage", quantity: 1,
    old_quantity: 30, new_quantity: 29, reason: "Synthetic trial damage write-down.", source_name: "CHALIN ONE full trial",
    reference_number: `${SEED_PREFIX}-ADJ-001`, unit_cost: 75, cost_price_before: 75, cost_price_after: 75,
    movement_date: "2026-08-12", notes: "Test data only.", adjusted_by: adminId,
  }, stats, "spare_parts");
  await insertOrGet(connection, "expenses", { branch_id: mainBranchId, description: `${SEED_PREFIX} Local delivery fuel` }, {
    branch_id: mainBranchId, category: "Transport", amount: 150, payment_method: "cash",
    description: `${SEED_PREFIX} Local delivery fuel`, expense_date: "2026-08-12", recorded_by: adminId,
  }, stats, "spare_parts");
  await insertOrGet(connection, "daily_closings", { branch_id: mainBranchId, closing_date: "2026-08-12" }, {
    branch_id: mainBranchId, closing_date: "2026-08-12", opening_cash_float: 0, cash_deposits: 0, cash_withdrawals: 0,
    other_cash_in: 0, other_cash_out: 0, sales_count: 3, sales_total: 3320, sales_received: 2120,
    cash_sales: 1100, momo_sales: 620, bank_sales: 0, mixed_sales: 0, credit_sales_total: 1600, credit_sales_received: 400,
    debt_payment_count: 1, debt_payments_total: 300, debt_cash: 300, debt_momo: 0, debt_bank: 0,
    expenses_count: 1, expenses_total: 150, expected_cash: 1650, expected_momo: 620, expected_bank: 0, expected_other: 0,
    expected_total: 2270, cash_counted: 1650, momo_counted: 620, bank_counted: 0, other_counted: 0, total_counted: 2270,
    denomination_total: 1650, denomination_json: JSON.stringify({ synthetic: true, total: 1650 }), counted_confirmed: 1,
    difference_total: 0, notes: "Synthetic balanced daily closing for full-system trial.", stale_after_close: 0,
    latest_revision_number: 1, closed_by: adminId, verified_by: adminId, verified_at: "2026-08-12 18:15:00",
    verification_status: await enumValue(connection, "daily_closings", "verification_status", ["verified","submitted"]),
  }, stats, "spare_parts");
  return { products, customers, cashSale, creditSale, momoSale, debt };
}

async function seedContext(connection, stats) {
  const main = (await findRow(connection,"branches",{code:"MAIN"})) || (await findRow(connection,"branches",{branch_code:"MAIN"}));
  const second = (await findRow(connection,"branches",{code:"AJAKAA"})) || (await findRow(connection,"branches",{branch_code:"AJAKAA"}));
  const admin = (await findRow(connection,"users",{username:"admin"})) || (await findRow(connection,"users",{id:1}));
  const reviewer = (await findRow(connection,"users",{username:"chalin-one-reviewer"})) || (await findRow(connection,"users",{id:2}));
  const publisher = (await findRow(connection,"users",{username:"chalin-one-publisher"})) || (await findRow(connection,"users",{id:3}));
  const spare = await findRow(connection,"business_units",{code:"spare_parts"});
  const mining = await findRow(connection,"business_units",{code:"mining"});
  const hire = await findRow(connection,"business_units",{code:"equipment_hire"});
  if (!main || !second || !admin || !reviewer || !publisher || !spare || !mining || !hire) {
    throw new ChalinOneFullTrialSeedError("The CHALIN ONE staging baseline identities are incomplete.","CHALIN_ONE_FULL_TRIAL_SEED_BASELINE_INCOMPLETE");
  }
  const hireLocation = await insertOrGet(connection,"business_locations",{business_unit_id:hire.id,code:"TRIAL-HIRE-YARD"},{
    business_unit_id:hire.id,code:"TRIAL-HIRE-YARD",name:"CHALIN ONE Trial Equipment Yard",location_type:"equipment_yard",
    address:"Synthetic Trial Yard, Dunkwa",phone:"0200000501",is_active:1,
  },stats,"context");
  const mine = await insertOrGet(connection,"mining_sites",{site_code:`${SEED_PREFIX}-MINE-01`},{
    site_code:`${SEED_PREFIX}-MINE-01`,site_name:"CHALIN ONE Trial Mining Site",location:"Synthetic Trial Concession, Western Region",
    material_type:"Alluvial Ore",production_unit:"tonnes",daily_target:120,manager_name:"Kofi Trial Mining Supervisor",manager_phone:"0200000303",
    status:await enumValue(connection,"mining_sites","status",["active","operational","open"]),notes:"Synthetic mining site for CHALIN ONE total-system trial.",
    is_active:1,created_by:admin.id,updated_by:admin.id,
  },stats,"context");
  for (const unit of [spare,mining,hire]) await insertOrGet(connection,"user_business_access",{user_id:admin.id,business_unit_id:unit.id},{
    user_id:admin.id,business_unit_id:unit.id,access_role:"admin",can_access:1,is_default:unit.id===spare.id?1:0,created_by:admin.id,
  },stats,"context");
  await insertOrGet(connection,"user_mining_site_access",{user_id:admin.id,site_id:mine.id},{user_id:admin.id,site_id:mine.id,can_access:1,is_default:1,created_by:admin.id},stats,"context");
  await insertOrGet(connection,"user_hire_location_access",{user_id:admin.id,location_id:hireLocation.id},{user_id:admin.id,location_id:hireLocation.id,can_access:1,is_default:1,created_by:admin.id},stats,"context");
  return {adminId:Number(admin.id),reviewerId:Number(reviewer.id),publisherId:Number(publisher.id),mainBranchId:Number(main.id),secondBranchId:Number(second.id),
    sparePartsUnitId:Number(spare.id),miningUnitId:Number(mining.id),hireUnitId:Number(hire.id),miningSiteId:Number(mine.id),hireLocationId:Number(hireLocation.id)};
}

async function seedMining(connection, context, stats) {
  const {adminId,miningSiteId}=context;
  const excavator=await insertOrGet(connection,"fleet_assets",{asset_code:`${SEED_PREFIX}-EXC-01`},{
    asset_code:`${SEED_PREFIX}-EXC-01`,asset_name:"CHALIN ONE Trial Excavator",asset_type:"Excavator",make:"CAT",model:"320",
    serial_number:`${SEED_PREFIX}-CAT320-001`,registration_number:`${SEED_PREFIX}-REG-EXC`,ownership_type:"company_owned",
    current_status:await enumValue(connection,"fleet_assets","current_status",["available","deployed","working"]),current_location:"Trial Mining Site",
    assigned_operator_name:"Yaw Trial Excavator Operator",meter_type:"hour_meter",current_meter:1254.5,fuel_type:"Diesel",service_interval:500,next_service_meter:1500,
    notes:"Synthetic full-trial mining asset.",is_active:1,created_by:adminId,updated_by:adminId,
  },stats,"mining_fleet");
  const log=await insertOrGet(connection,"mining_daily_logs",{site_id:miningSiteId,log_date:"2026-08-12",shift_code:"DAY"},{
    site_id:miningSiteId,log_date:"2026-08-12",shift_code:"DAY",supervisor_name:"Kofi Trial Mining Supervisor",weather_conditions:"Dry synthetic trial conditions",
    workforce_count:8,opening_notes:"Synthetic day-shift trial opened safely.",closing_notes:"Target exceeded; one minor near-miss recorded.",
    status:await enumValue(connection,"mining_daily_logs","status",["approved","closed","completed","submitted"]),created_by:adminId,approved_by:adminId,approved_at:"2026-08-12 18:00:00",
  },stats,"mining_fleet");
  await insertOrGet(connection,"mining_equipment_logs",{daily_log_id:log.id,asset_id:excavator.id},{site_id:miningSiteId,daily_log_id:log.id,asset_id:excavator.id,work_date:"2026-08-12",shift_code:"DAY",
    operator_name:"Yaw Trial Excavator Operator",start_meter:1246.5,end_meter:1254.5,working_hours:7,idle_hours:.5,breakdown_hours:.5,fuel_litres:145,
    task_description:"Synthetic pit loading and stockpile feed.",status:await enumValue(connection,"mining_equipment_logs","status",["approved","completed","submitted"]),created_by:adminId,approved_by:adminId,approved_at:"2026-08-12 18:00:00"},stats,"mining_fleet");
  await insertOrGet(connection,"mining_fuel_logs",{site_id:miningSiteId,reference_number:`${SEED_PREFIX}-MINE-FUEL-001`},{site_id:miningSiteId,asset_id:excavator.id,log_datetime:"2026-08-12 07:15:00",
    transaction_type:await enumValue(connection,"mining_fuel_logs","transaction_type",["issue","dispense","consumption","out"]),quantity_litres:145,storage_name:"Trial Site Diesel Tank",
    supplier_or_source:"Synthetic opening fuel stock",recipient_name:"Yaw Trial Excavator Operator",meter_reading:1246.5,unit_cost:15.5,total_cost:2247.5,reference_number:`${SEED_PREFIX}-MINE-FUEL-001`,notes:"Synthetic fuel issue.",created_by:adminId},stats,"mining_fleet");
  await insertOrGet(connection,"mining_production_records",{site_id:miningSiteId,daily_log_id:log.id,production_datetime:"2026-08-12 17:15:00"},{site_id:miningSiteId,daily_log_id:log.id,production_datetime:"2026-08-12 17:15:00",work_area:"Trial Pit A",
    material_type:"Alluvial Ore",quantity:128.5,unit:"tonnes",grade_quality:"Synthetic trial grade",destination:"Trial Stockpile A",notes:"Synthetic production record; no real mineral output.",
    status:await enumValue(connection,"mining_production_records","status",["approved","completed","submitted"]),created_by:adminId,approved_by:adminId,approved_at:"2026-08-12 18:00:00"},stats,"mining_fleet");
  await insertOrGet(connection,"mining_expenses",{site_id:miningSiteId,reference_number:`${SEED_PREFIX}-MINE-EXP-001`},{site_id:miningSiteId,expense_date:"2026-08-12",category:"Site Supplies",
    description:"Synthetic PPE and drinking-water expense.",amount:480,payment_method:"cash",reference_number:`${SEED_PREFIX}-MINE-EXP-001`,status:await enumValue(connection,"mining_expenses","status",["approved","posted","completed"]),created_by:adminId,approved_by:adminId,approved_at:"2026-08-12 18:00:00"},stats,"mining_fleet");
  await insertOrGet(connection,"mining_incidents",{site_id:miningSiteId,incident_datetime:"2026-08-12 14:20:00",incident_type:"Near Miss"},{site_id:miningSiteId,incident_datetime:"2026-08-12 14:20:00",incident_type:"Near Miss",
    severity:await enumValue(connection,"mining_incidents","severity",["low","minor","medium"]),exact_area:"Trial Pit A access ramp",people_involved:"Synthetic trial crew",
    description:"Synthetic near-miss: loose rock observed before vehicle entry.",immediate_action:"Access paused and loose material cleared.",corrective_action:"Pre-shift ramp inspection added to trial checklist.",responsible_officer:"Kofi Trial Mining Supervisor",
    status:await enumValue(connection,"mining_incidents","status",["closed","resolved","open"]),created_by:adminId,closed_by:adminId,closed_at:"2026-08-12 16:00:00"},stats,"mining_fleet");
  await insertOrGet(connection,"fleet_meter_readings",{asset_id:excavator.id,reading_datetime:"2026-08-12 17:30:00"},{asset_id:excavator.id,reading_value:1254.5,reading_datetime:"2026-08-12 17:30:00",source_type:"mining_daily_log",notes:"Synthetic end-of-shift meter.",is_correction:0,recorded_by:adminId},stats,"mining_fleet");
  await insertOrGet(connection,"fleet_fuel_logs",{asset_id:excavator.id,reference_number:`${SEED_PREFIX}-FLEET-FUEL-001`},{asset_id:excavator.id,log_datetime:"2026-08-12 07:15:00",quantity_litres:145,meter_reading:1246.5,supplier_or_source:"Trial Site Diesel Tank",reference_number:`${SEED_PREFIX}-FLEET-FUEL-001`,cost_amount:2247.5,notes:"Synthetic fleet-side mirror of mining fuel issue.",recorded_by:adminId},stats,"mining_fleet");
  await insertOrGet(connection,"fleet_inspections",{asset_id:excavator.id,inspection_datetime:"2026-08-12 06:45:00"},{asset_id:excavator.id,inspection_type:"pre_shift",inspection_datetime:"2026-08-12 06:45:00",meter_reading:1246.5,
    condition_status:await enumValue(connection,"fleet_inspections","condition_status",["good","serviceable","excellent"]),findings:"Synthetic inspection: serviceable, no critical defects.",action_required:"Monitor left track tension.",inspected_by_name:"Kofi Trial Mining Supervisor",created_by:adminId},stats,"mining_fleet");
  await insertOrGet(connection,"fleet_maintenance_records",{asset_id:excavator.id,reported_at:"2026-08-10 09:00:00",maintenance_type:"preventive"},{asset_id:excavator.id,maintenance_type:"preventive",status:await enumValue(connection,"fleet_maintenance_records","status",["completed","closed","done"]),reported_at:"2026-08-10 09:00:00",completed_at:"2026-08-10 15:00:00",meter_reading:1240,description:"Synthetic 250-hour inspection and lubrication.",technician:"CHALIN ONE Trial Workshop",cost_amount:650,next_service_meter:1500,notes:"Synthetic maintenance record.",created_by:adminId,updated_by:adminId},stats,"mining_fleet");
  return {excavator,log};
}

async function seedHire(connection, context, stats) {
  const {adminId,hireLocationId}=context;
  const asset=await insertOrGet(connection,"fleet_assets",{asset_code:`${SEED_PREFIX}-HIRE-EXC-01`},{asset_code:`${SEED_PREFIX}-HIRE-EXC-01`,asset_name:"CHALIN ONE Trial Hire Excavator",asset_type:"Excavator",make:"LiuGong",model:"922E",serial_number:`${SEED_PREFIX}-LIUGONG-001`,registration_number:`${SEED_PREFIX}-REG-HIRE`,ownership_type:"company_owned",current_status:await enumValue(connection,"fleet_assets","current_status",["available","hired","deployed"]),current_location:"Trial Equipment Yard / Client Site",assigned_operator_name:"Synthetic Hire Operator",meter_type:"hour_meter",current_meter:812.5,fuel_type:"Diesel",service_interval:500,next_service_meter:1000,notes:"Synthetic full-trial equipment-hire asset.",is_active:1,created_by:adminId,updated_by:adminId},stats,"equipment_hire");
  const customer=await insertOrGet(connection,"hire_customers",{customer_code:`${SEED_PREFIX}-HCUS-001`},{customer_code:`${SEED_PREFIX}-HCUS-001`,customer_name:"BuildRight CHALIN ONE Trial Ltd",customer_type:await enumValue(connection,"hire_customers","customer_type",["company","business","individual"]),phone:"0200000401",whatsapp_phone:"0200000401",email:"buildright-trial@example.invalid",address:"Synthetic Project Office, Tarkwa",contact_person:"Synthetic Site Engineer",payment_terms_days:14,credit_limit:50000,risk_notes:"Synthetic trial customer only.",is_active:1,created_by:adminId,updated_by:adminId},stats,"equipment_hire");
  const enquiry=await insertOrGet(connection,"hire_enquiries",{enquiry_number:`${SEED_PREFIX}-HENQ-001`},{hire_location_id:hireLocationId,enquiry_number:`${SEED_PREFIX}-HENQ-001`,customer_id:customer.id,enquiry_date:"2026-08-09",equipment_type:"Excavator",work_location:"Synthetic drainage project, Tarkwa",requested_start_date:"2026-08-11",expected_end_date:"2026-08-13",preferred_charging_method:"hourly",estimated_quantity:20,notes:"Synthetic enquiry for total-system trial.",status:await enumValue(connection,"hire_enquiries","status",["converted","quoted","active","open"]),created_by:adminId,updated_by:adminId},stats,"equipment_hire");
  const quote=await insertOrGet(connection,"hire_quotations",{quotation_number:`${SEED_PREFIX}-HQUO-001`},{hire_location_id:hireLocationId,quotation_number:`${SEED_PREFIX}-HQUO-001`,enquiry_id:enquiry.id,customer_id:customer.id,requested_asset_type:"Excavator",preferred_asset_id:asset.id,work_location:"Synthetic drainage project, Tarkwa",requested_start_date:"2026-08-11",expected_end_date:"2026-08-13",charging_method:"hourly",rate:950,estimated_quantity:20,minimum_quantity:8,mobilization_amount:1500,demobilization_amount:1500,operator_amount:1200,fuel_responsibility:"customer",subtotal:23200,discount_amount:0,tax_amount:0,total_amount:23200,validity_date:"2026-08-20",status:await enumValue(connection,"hire_quotations","status",["approved","accepted","converted"]),terms:"Synthetic trial quotation. Fuel by customer; operator included.",notes:"Test data only.",created_by:adminId,approved_by:adminId,approved_at:"2026-08-09 14:00:00",updated_by:adminId},stats,"equipment_hire");
  const contract=await insertOrGet(connection,"hire_contracts",{contract_number:`${SEED_PREFIX}-HCON-001`},{hire_location_id:hireLocationId,contract_number:`${SEED_PREFIX}-HCON-001`,quotation_id:quote.id,customer_id:customer.id,work_location:"Synthetic drainage project, Tarkwa",start_date:"2026-08-11",expected_end_date:"2026-08-13",actual_end_date:"2026-08-13",charging_method:"hourly",rate:950,minimum_quantity:8,mobilization_amount:1500,demobilization_amount:1500,operator_amount:1200,deposit_required:5000,deposit_received:5000,fuel_responsibility:"customer",status:await enumValue(connection,"hire_contracts","status",["completed","active","approved"]),terms:"Synthetic trial contract generated from approved quotation.",notes:"Test data only.",closure_notes:"Synthetic trial job completed and equipment returned.",operational_status:await enumValue(connection,"hire_contracts","operational_status",["completed","closed","returned","active"]),financial_status:await enumValue(connection,"hire_contracts","financial_status",["partial","outstanding","paid"]),created_by:adminId,approved_by:adminId,approved_at:"2026-08-10 09:00:00",updated_by:adminId},stats,"equipment_hire");
  const ca=await insertOrGet(connection,"hire_contract_assets",{contract_id:contract.id,asset_id:asset.id},{contract_id:contract.id,asset_id:asset.id,operator_name:"Synthetic Hire Operator",assigned_from:"2026-08-11 06:30:00",assigned_to:"2026-08-13 17:30:00",opening_meter:792.5,closing_meter:812.5,status:await enumValue(connection,"hire_contract_assets","status",["returned","completed","released","active"]),notes:"Synthetic full-trial asset assignment.",created_by:adminId,updated_by:adminId},stats,"equipment_hire");
  await insertOrGet(connection,"hire_dispatches",{contract_id:contract.id,contract_asset_id:ca.id,dispatch_datetime:"2026-08-11 07:00:00"},{hire_location_id:hireLocationId,contract_id:contract.id,contract_asset_id:ca.id,dispatch_datetime:"2026-08-11 07:00:00",destination:"Synthetic drainage project, Tarkwa",opening_meter:792.5,fuel_level_percent:80,condition_status:await enumValue(connection,"hire_dispatches","condition_status",["good","excellent","serviceable"]),attachments_tools:"Standard bucket; safety kit",transport_details:"Synthetic low-bed dispatch",receiving_person:"Synthetic Site Engineer",notes:"Synthetic dispatch confirmed.",created_by:adminId},stats,"equipment_hire");
  const work=await insertOrGet(connection,"hire_work_logs",{contract_id:contract.id,contract_asset_id:ca.id,work_date:"2026-08-12"},{hire_location_id:hireLocationId,contract_id:contract.id,contract_asset_id:ca.id,asset_id:asset.id,work_date:"2026-08-12",start_meter:800.5,end_meter:808.5,billable_hours:8,idle_hours:.5,breakdown_hours:0,fuel_litres:120,work_description:"Synthetic drainage excavation and loading.",customer_representative:"Synthetic Site Engineer",status:await enumValue(connection,"hire_work_logs","status",["approved","completed","submitted"]),created_by:adminId,approved_by:adminId,approved_at:"2026-08-12 18:00:00"},stats,"equipment_hire");
  await insertOrGet(connection,"hire_return_inspections",{contract_id:contract.id,contract_asset_id:ca.id,return_datetime:"2026-08-13 17:30:00"},{hire_location_id:hireLocationId,contract_id:contract.id,contract_asset_id:ca.id,return_datetime:"2026-08-13 17:30:00",closing_meter:812.5,fuel_level_percent:45,condition_status:await enumValue(connection,"hire_return_inspections","condition_status",["good","serviceable","excellent"]),damage_details:"No synthetic damage recorded.",missing_items:"None",estimated_damage_amount:0,customer_representative:"Synthetic Site Engineer",status:await enumValue(connection,"hire_return_inspections","status",["approved","completed","closed"]),notes:"Synthetic return inspection completed.",created_by:adminId},stats,"equipment_hire");
  const inv=await insertOrGet(connection,"hire_invoices",{invoice_number:`${SEED_PREFIX}-HINV-001`},{hire_location_id:hireLocationId,invoice_number:`${SEED_PREFIX}-HINV-001`,contract_id:contract.id,customer_id:customer.id,invoice_date:"2026-08-13",due_date:"2026-08-27",period_start:"2026-08-11",period_end:"2026-08-13",billable_quantity:20,rate:950,base_amount:19000,mobilization_amount:1500,demobilization_amount:1500,operator_amount:1200,other_amount:0,subtotal:23200,discount_amount:0,tax_amount:0,total_amount:23200,amount_paid:12000,balance:11200,status:await enumValue(connection,"hire_invoices","status",["partial","part_paid","issued","outstanding"]),notes:"Synthetic partial-payment hire invoice.",created_by:adminId,issued_by:adminId,issued_at:"2026-08-13 18:00:00"},stats,"equipment_hire");
  await insertOrGet(connection,"hire_invoice_lines",{invoice_id:inv.id,work_log_id:work.id},{invoice_id:inv.id,work_log_id:work.id,contract_asset_id:ca.id,asset_id:asset.id,description:"Synthetic excavator hire - approved work log",quantity:20,unit_rate:950,line_amount:19000,discount_amount:0,tax_amount:0},stats,"equipment_hire");
  await insertOrGet(connection,"hire_payments",{invoice_id:inv.id,reference_number:`${SEED_PREFIX}-HPAY-001`},{hire_location_id:hireLocationId,invoice_id:inv.id,contract_id:contract.id,customer_id:customer.id,payment_date:"2026-08-13",payment_category:await enumValue(connection,"hire_payments","payment_category",["invoice","deposit","hire"]),amount:12000,payment_method:"bank",reference_number:`${SEED_PREFIX}-HPAY-001`,notes:"Synthetic partial hire payment.",received_by:adminId},stats,"equipment_hire");
  return {contract,inv};
}

async function seedWorkforce(connection, context, stats) {
  const {adminId,mainBranchId,sparePartsUnitId,miningUnitId,hireUnitId,miningSiteId,hireLocationId}=context;
  const defs=[
    ["SP001","spare_parts",sparePartsUnitId,"Ama Trial Storekeeper","Storekeeper","Stores",3500,"branch",mainBranchId,mainBranchId],
    ["SP002","spare_parts",sparePartsUnitId,"Kojo Trial Cashier","Cashier","Sales",3000,"branch",mainBranchId,mainBranchId],
    ["MN001","mining",miningUnitId,"Kofi Trial Mining Supervisor","Mining Supervisor","Mining Operations",6500,"mining_site",miningSiteId,null],
    ["MN002","mining",miningUnitId,"Yaw Trial Excavator Operator","Excavator Operator","Mining Operations",5000,"mining_site",miningSiteId,null],
    ["HR001","equipment_hire",hireUnitId,"Efua Trial Hire Coordinator","Hire Coordinator","Equipment Hire",4200,"hire_location",hireLocationId,null],
  ];
  const workers=[];
  let n=0;
  for (const [code,workspace,businessUnitId,fullName,title,department,salary,contextType,contextId,branchId] of defs) {
    n+=1; const employee=`${SEED_PREFIX}-WRK-${code}`;
    const worker=await insertOrGet(connection,"worker_profiles",{employee_number:employee},{employee_number:employee,workspace_code:workspace,business_unit_id:businessUnitId,full_name:fullName,preferred_name:fullName.split(" ")[0],phone:`02000003${String(n).padStart(2,"0")}`,email:`${code.toLowerCase()}.trial@example.invalid`,nationality:"Ghanaian",residential_address:"Synthetic CHALIN ONE trial address",national_id_type:"ghana_card",national_id_number:`${SEED_PREFIX}-GHA-${String(n).padStart(3,"0")}`,emergency_contact_name:"Synthetic Contact",emergency_contact_phone:`020000039${n}`,job_title:title,department,employment_type:"permanent",employment_start_date:"2026-01-01",employment_status:"active",notes:"Synthetic CHALIN ONE full-trial worker.",created_by:adminId,updated_by:adminId},stats,"workforce_payroll");
    await insertOrGet(connection,"worker_assignments",{worker_id:worker.id,context_type:contextType,context_id:contextId,is_primary:1},{worker_id:worker.id,workspace_code:workspace,business_unit_id:businessUnitId,branch_id:branchId,context_type:contextType,context_id:contextId,context_label:contextType==="branch"?"Main Store":contextType==="mining_site"?"Trial Mining Site":"Trial Equipment Yard",role_code:title.toLowerCase().replace(/[^a-z0-9]+/g,"_"),is_primary:1,is_active:1,assignment_start:"2026-01-01",notes:"Synthetic primary assignment.",created_by:adminId},stats,"workforce_payroll");
    const profile=await insertOrGet(connection,"payroll_compensation_profiles",{worker_id:worker.id,effective_from:"2026-08-01"},{worker_id:worker.id,workspace_code:workspace,effective_from:"2026-08-01",currency_code:"GHS",pay_frequency:"monthly",basic_salary:salary,status:"approved",change_reason:"Synthetic full-trial compensation profile.",created_by:adminId,submitted_by:adminId,submitted_at:"2026-08-01 09:00:00",approved_by:adminId,approved_at:"2026-08-01 09:05:00"},stats,"workforce_payroll");
    workers.push({worker,profile,salary,workspace,paid:["SP001","MN001"].includes(code)});
  }
  for (const workspace of ["spare_parts","mining","equipment_hire"]) {
    const period=await insertOrGet(connection,"payroll_periods",{workspace_code:workspace,period_code:`${SEED_PREFIX}-PAY-${workspace}`},{workspace_code:workspace,period_code:`${SEED_PREFIX}-PAY-${workspace}`,period_start:"2026-08-01",period_end:"2026-08-31",scheduled_pay_date:"2026-08-31",status:"approved",statutory_rule_snapshot_json:JSON.stringify({synthetic_trial:true,note:"No statutory rate claim is made by this fixture."}),notes:"Synthetic August payroll for full-system trial.",prepared_by:adminId,submitted_by:adminId,submitted_at:"2026-08-12 09:00:00",approved_by:adminId,approved_at:"2026-08-12 09:10:00"},stats,"workforce_payroll");
    for (const item of workers.filter((w)=>w.workspace===workspace)) {
      const deduction=Number((item.salary*.05).toFixed(2)); const net=item.salary-deduction; const paid=item.paid?net:0;
      const entry=await insertOrGet(connection,"payroll_entries",{payroll_period_id:period.id,worker_id:item.worker.id},{payroll_period_id:period.id,worker_id:item.worker.id,workspace_code:workspace,compensation_profile_id:item.profile.id,entry_status:item.paid?"paid":"due",employment_days:31,payable_days:31,basic_earned:item.salary,gross_earnings:item.salary,total_deductions:deduction,employer_contributions:0,net_salary:net,amount_paid:paid,remaining_balance:net-paid,compensation_snapshot_json:JSON.stringify({synthetic_trial:true,basic_salary:item.salary}),statutory_snapshot_json:JSON.stringify({synthetic_trial:true,trial_deduction_rate:.05,disclaimer:"Fixture only; not a statutory rule."}),calculation_checksum_sha256:sha256({worker:item.worker.employee_number,basic:item.salary,deduction,net}),prepared_by:adminId,approved_by:adminId,approved_at:"2026-08-12 09:10:00"},stats,"workforce_payroll");
      await insertOrGet(connection,"payroll_entry_lines",{payroll_entry_id:entry.id,line_code:"BASIC",source_type:"compensation_profile"},{payroll_entry_id:entry.id,line_code:"BASIC",line_name:"Basic Salary",line_type:"earning",source_type:"compensation_profile",source_reference:String(item.profile.id),quantity:1,rate:item.salary,amount:item.salary,metadata_json:JSON.stringify({synthetic_trial:true}),display_order:10},stats,"workforce_payroll");
      await insertOrGet(connection,"payroll_entry_lines",{payroll_entry_id:entry.id,line_code:"TRIAL_DEDUCTION",source_type:"trial_fixture"},{payroll_entry_id:entry.id,line_code:"TRIAL_DEDUCTION",line_name:"Synthetic Trial Deduction",line_type:"deduction",source_type:"trial_fixture",source_reference:SEED_PREFIX,quantity:1,rate:.05,amount:deduction,metadata_json:JSON.stringify({synthetic_trial:true,statutory_claim:false}),display_order:90},stats,"workforce_payroll");
      if (item.paid) await insertOrGet(connection,"payroll_salary_payments",{idempotency_key:`${SEED_PREFIX}-PAYMENT-${item.worker.employee_number}`},{payroll_entry_id:entry.id,worker_id:item.worker.id,workspace_code:workspace,payment_number:`${SEED_PREFIX}-SAL-${item.worker.id}`,idempotency_key:`${SEED_PREFIX}-PAYMENT-${item.worker.employee_number}`,payment_date:"2026-08-13",amount:net,payment_method:"bank",payment_reference:`${SEED_PREFIX}-BANK-${item.worker.id}`,destination_masked:"****TRIAL",payment_status:"posted",posted_by:adminId,metadata_json:JSON.stringify({synthetic_trial:true})},stats,"workforce_payroll");
    }
  }
  return workers;
}

async function seedTraceability(connection, context, spare, stats) {
  if (!(await tableExists(connection,"inventory_label_batches")) || !(await tableExists(connection,"inventory_units")) || !(await tableExists(connection,"inventory_unit_events"))) {
    stat(stats,"inventory_traceability","skipped",3); return {supported:false};
  }
  const {adminId,mainBranchId}=context; const battery=spare.products.battery;
  const batch=await insertOrGet(connection,"inventory_label_batches",{batch_code:"LBL-MAIN-20260813-ABC234"},{batch_code:"LBL-MAIN-20260813-ABC234",branch_id:mainBranchId,product_id:battery.id,source_type:"opening_reconciliation",source_id:null,source_item_id:null,expected_quantity:1,generated_quantity:1,activated_quantity:1,voided_quantity:0,status:"activated",label_format:"sticker",created_by:adminId,printed_by:adminId,verified_by:adminId,activated_by:adminId,printed_at:"2026-08-13 08:00:00",verified_at:"2026-08-13 08:05:00",activated_at:"2026-08-13 08:10:00",notes:"Synthetic traceability label batch.",metadata_json:JSON.stringify({synthetic_trial:true})},stats,"inventory_traceability");
  const unit=await insertOrGet(connection,"inventory_units",{unit_code:"TRLBAT001-ABCD2345"},{unit_code:"TRLBAT001-ABCD2345",product_id:battery.id,origin_branch_id:mainBranchId,current_branch_id:mainBranchId,label_batch_id:batch.id,status:"active",current_location:"MAIN / Trial Electrical Shelf",custody_user_id:adminId,activated_by:adminId,activated_at:"2026-08-13 08:10:00",last_verified_by:adminId,last_verified_at:"2026-08-13 08:15:00"},stats,"inventory_traceability");
  const event={unitId:unit.id,eventSequence:1,branchId:mainBranchId,eventType:"activated",fromStatus:"label_pending",toStatus:"active",sourceType:"opening_reconciliation",sourceId:batch.id,actorUserId:adminId,reason:"Synthetic serialized battery activated for full-system trial.",requestId:`${SEED_PREFIX}-TRACE-001`,metadata:{synthetic_trial:true,label_batch_code:batch.batch_code},previousEventHash:null};
  await insertOrGet(connection,"inventory_unit_events",{unit_id:unit.id,event_sequence:1},{unit_id:unit.id,event_sequence:1,branch_id:mainBranchId,event_type:event.eventType,from_status:event.fromStatus,to_status:event.toStatus,source_type:event.sourceType,source_id:event.sourceId,actor_user_id:adminId,reason:event.reason,request_id:event.requestId,metadata_json:JSON.stringify(event.metadata),previous_event_hash:null,event_hash:buildUnitEventHash(event)},stats,"inventory_traceability");
  if (await tableExists(connection,"inventory_label_print_events")) await insertOrGet(connection,"inventory_label_print_events",{label_batch_id:batch.id,unit_id:unit.id},{branch_id:mainBranchId,label_batch_id:batch.id,unit_id:unit.id,print_format:"sticker",copies:1,print_reason:"Synthetic full-trial traceability label.",printed_by:adminId,approved_by:adminId},stats,"inventory_traceability");
  return {supported:true,batch,unit};
}

async function seedAi(connection, context, stats) {
  const {adminId,reviewerId,publisherId}=context;
  const sources=[
    ["chalin_one_full_trial_playbook","manual",null,"executive","CHALIN ONE Full Trial Playbook","Synthetic full-system test playbook. Live quantities and balances must be read from operational tools.",`CHALIN ONE FULL TRIAL PLAYBOOK\nThis source describes synthetic test scenarios only. It must never be treated as production business evidence.\nAll synthetic business identifiers start with ${SEED_PREFIX}.\nFor current stock, sales, debt, payroll, mining, fleet and equipment-hire figures, CHALIN AI must use the live read-only operational tools instead of treating this playbook as the current balance.\nThe test covers purchase-to-stock, cash sale, credit sale, debt payment, return/refund, branch stock transfer, stock adjustment, daily closing, worker assignments, compensation profiles, payroll entries and payments, mining production/fuel/incident control, fleet inspection/maintenance, and equipment-hire enquiry-to-payment.\nThe newer Equipment Finance rebuild is intentionally not represented until its mature schema is present in CHALIN ONE staging.`],
    ["chalin_one_trial_spare_parts_policy","procedure","spare_parts","workspace","CHALIN ONE Trial Spare Parts Procedure","Synthetic test procedure for Spare Parts operations.",`SPARE PARTS TRIAL PROCEDURE\nUse ${SEED_PREFIX} records for testing. A received stock transfer should show source/destination branches and quantities dispatched/received. A credit sale remains linked to a customer and debt balance; a later debt payment reduces debt balance without rewriting the original sale total. A return requires original sale, product, quantity, reason, type and refund evidence. Daily closing should reconcile receipts plus debt collections less cash expenses. For current figures, use live Spare Parts tools.`],
    ["chalin_one_trial_mining_policy","procedure","mining","workspace","CHALIN ONE Trial Mining Operations Procedure","Synthetic test procedure for mining operations.",`MINING TRIAL PROCEDURE\nUse ${SEED_PREFIX} records for testing. Daily evidence should connect site, shift log, production, equipment utilization, fuel issue, expenses and incidents. Closed incidents retain immediate and corrective actions. Fleet meter and fuel evidence should be consistent with the mining equipment log. For current figures, use live Mining tools.`],
    ["chalin_one_trial_hire_policy","procedure","equipment_hire","workspace","CHALIN ONE Trial Equipment Hire Procedure","Synthetic test procedure for equipment-hire operations.",`EQUIPMENT HIRE TRIAL PROCEDURE\nUse ${SEED_PREFIX} records for testing. The flow is enquiry to approved quotation to contract to asset assignment and dispatch, then work log, return inspection, invoice and payment. Invoice balance equals total less payments. Operational return evidence and financial settlement are separate controls. For current figures, use live Equipment Hire tools.`],
  ];
  for (const [key,type,workspace,visibility,title,description,body] of sources) {
    const source=await insertOrGet(connection,"ai_knowledge_sources",{source_key:key},{source_key:key,source_type:type,owner_workspace_code:workspace,visibility,title,description,source_reference:`trial://${key}`,source_status:"active",effective_from:"2026-08-13 00:00:00",expires_at:null,created_by:adminId,updated_by:publisherId},stats,"ai_knowledge");
    const version=await insertOrGet(connection,"ai_knowledge_versions",{source_id:source.id,version_number:1},{source_id:source.id,version_number:1,version_status:"published",title,body_text:body,checksum_sha256:sha256(body),metadata_json:JSON.stringify({synthetic_trial:true,seed_prefix:SEED_PREFIX,live_figures_require_tools:true}),effective_from:"2026-08-13 00:00:00",expires_at:null,created_by:adminId,published_by:publisherId,published_at:"2026-08-13 10:30:00"},stats,"ai_knowledge");
    await insertOrGet(connection,"ai_knowledge_approvals",{source_id:source.id,version_id:version.id},{source_id:source.id,version_id:version.id,approval_status:"approved",requested_by:adminId,assigned_to:reviewerId,decided_by:reviewerId,request_note:"Synthetic trial knowledge governance request.",decision_note:"Approved for isolated CHALIN ONE staging trial only.",decided_at:"2026-08-13 10:20:00",executed_at:"2026-08-13 10:30:00"},stats,"ai_knowledge");
  }
}

async function seedChalinOneFullTrialData({connection=null,dryRun=false,allowFixture=false}={}) {
  const own=!connection; const db=connection || await pool.getConnection(); const stats={}; let tx=false;
  try {
    const target=await assertStagingTarget(db,{allowFixture});
    const marker=await findRow(db,"schema_migrations",{migration_name:SEED_MARKER});
    if (marker) return Object.freeze({status:"already_seeded",marker:SEED_MARKER,seed_prefix:SEED_PREFIX,target,stats});
    await db.beginTransaction(); tx=true;
    const context=await seedContext(db,stats);
    const spare=await seedSpareParts(db,context,stats);
    const mining=await seedMining(db,context,stats);
    const hire=await seedHire(db,context,stats);
    const workers=await seedWorkforce(db,context,stats);
    const traceability=await seedTraceability(db,context,spare,stats);
    await seedAi(db,context,stats);
    if (dryRun) {
      await db.rollback(); tx=false;
      return Object.freeze({status:"dry_run_passed",marker:SEED_MARKER,seed_prefix:SEED_PREFIX,target,stats,scenario:{products:Object.keys(spare.products).length,customers:Object.keys(spare.customers).length,workers:workers.length,mining_site_id:context.miningSiteId,hire_contract_id:hire.contract.id,traceability_supported:traceability.supported}});
    }
    await db.query(`INSERT INTO schema_migrations (migration_name, description) VALUES (?, ?)`,[SEED_MARKER,`Synthetic CHALIN ONE full-trial dataset seeded with prefix ${SEED_PREFIX}.`]);
    await db.commit(); tx=false;
    return Object.freeze({status:"seeded",marker:SEED_MARKER,seed_prefix:SEED_PREFIX,target,stats,scenario:{products:Object.keys(spare.products).length,customers:Object.keys(spare.customers).length,workers:workers.length,mining_site_id:context.miningSiteId,mining_excavator_id:mining.excavator.id,hire_contract_id:hire.contract.id,hire_invoice_id:hire.inv.id,traceability_supported:traceability.supported},intentionally_unseeded:["Mature Equipment Finance tables that are not yet present in CHALIN ONE staging.","Real customer, supplier, worker, financial or mining data."]});
  } catch (error) {
    if (tx) try { await db.rollback(); } catch (rollbackError) { console.error("CHALIN ONE full-trial seed rollback warning:",rollbackError.message); }
    throw error;
  } finally { if (own) db.release(); }
}

async function runCli() {
  const result=await seedChalinOneFullTrialData({dryRun:process.argv.includes("--dry-run")});
  console.log("CHALIN ONE full-trial data seed completed.");
  console.log(JSON.stringify(result,null,2));
}

if (require.main===module) {
  runCli().catch((error)=>{console.error(`CHALIN ONE full-trial data seed failed [${error.code || "ERROR"}]: ${error.message}`);process.exitCode=1;})
    .finally(async()=>{try{await pool.end();}catch{}});
}

module.exports={CHALIN_ONE_STAGING_ENVIRONMENT_ID,REQUIRED_TABLES,SEED_MARKER,SEED_PREFIX,STAGING_DATABASE_MARKERS,ChalinOneFullTrialSeedError,assertStagingTarget,enumValue,seedChalinOneFullTrialData};
