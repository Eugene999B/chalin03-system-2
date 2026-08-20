const mysql = require("mysql2/promise");
require("dotenv").config();

const CORRECTION_DATE = "2026-08-06";
const EXPORT_GENERATED_AT = "2026-08-04 22:57:50 UTC";
const SOURCE_EXPORT = "chalin03-main-products (5)(1).xlsx";
const CORRECTION_LOCK = "chalin03:inventory:kwabena-count:20260806";
const CORRECTION_RECORD = "20260806_kwabena_main_store_quantity_correction";
const TARGET_BRANCH_ID = 1;
const EXPECTED_CORRECTION_COUNT = 8;

const PRODUCT_CORRECTIONS = Object.freeze([
  Object.freeze({ product_id: 313, requested_name: "Bearing case", exported_name: "Bearing Case", exported_size: "None", exported_quantity: 8, quantity: 4 }),
  Object.freeze({ product_id: 263, requested_name: "Small China fan belt", exported_name: "Small China Fan Belt", exported_size: "None", exported_quantity: 49, quantity: 13, matching_note: "Matched to active product ID 263; inactive duplicate product ID 252 was excluded." }),
  Object.freeze({ product_id: 205, requested_name: "Track Shoe bolt", exported_name: "Track Shoe Bolt", exported_size: "All", exported_quantity: 466, quantity: 152 }),
  Object.freeze({ product_id: 96, requested_name: "Binding wire", exported_name: "Binding Wire", exported_size: "Alovia", exported_quantity: 1, quantity: 0 }),
  Object.freeze({ product_id: 218, requested_name: "Grease gun mouth", exported_name: "Grease Gun Mouth", exported_size: "All", exported_quantity: 32, quantity: 27 }),
  Object.freeze({ product_id: 200, requested_name: "Hammer", exported_name: "Hammer", exported_size: "All", exported_quantity: 2, quantity: 1 }),
  Object.freeze({ product_id: 32, requested_name: "Sany Air cleaner", exported_name: "Air Cleaner", exported_size: "Sany", exported_quantity: 6, quantity: 0, matching_note: "Matched the shorthand to the active Air Cleaner row whose exact size is Sany." }),
  Object.freeze({ product_id: 46, requested_name: "70 pin medium", exported_name: "70 Pin Medium", exported_size: "All", exported_quantity: 14, quantity: 12 }),
]);

function requiredEnv(primaryName, fallbackName) {
  const value = process.env[primaryName] || process.env[fallbackName];
  if (!String(value || "").trim()) {
    throw new Error(`Missing required database variable ${primaryName}${fallbackName ? ` or ${fallbackName}` : ""}.`);
  }
  return value;
}

function getSslConfig(env = process.env) {
  if (String(env.DB_SSL || "").trim().toLowerCase() !== "true") return undefined;
  const encodedCa = String(env.DB_SSL_CA_BASE64 || "").trim();
  if (encodedCa) {
    return { ca: Buffer.from(encodedCa, "base64").toString("utf8"), rejectUnauthorized: true };
  }
  const disabled = ["0", "false", "no", "off"].includes(
    String(env.DB_SSL_REJECT_UNAUTHORIZED || "true").trim().toLowerCase()
  );
  return { rejectUnauthorized: !disabled };
}

function connectionOptions() {
  return {
    host: requiredEnv("DB_HOST", "MYSQLHOST"),
    port: Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306),
    user: requiredEnv("DB_USER", "MYSQLUSER"),
    password: requiredEnv("DB_PASSWORD", "MYSQLPASSWORD"),
    database: requiredEnv("DB_NAME", "MYSQLDATABASE"),
    ssl: getSslConfig(),
    connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 15000),
    multipleStatements: false,
    timezone: "Z",
  };
}

function normalizeIdentity(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function validateCorrectionDefinitions(corrections = PRODUCT_CORRECTIONS) {
  if (corrections.length !== EXPECTED_CORRECTION_COUNT) {
    throw new Error(`Expected exactly ${EXPECTED_CORRECTION_COUNT} product corrections, received ${corrections.length}.`);
  }
  const ids = new Set();
  for (const correction of corrections) {
    if (!Number.isInteger(correction.product_id) || correction.product_id <= 0) {
      throw new Error(`Invalid product ID for ${correction.requested_name}.`);
    }
    if (ids.has(correction.product_id)) {
      throw new Error(`Duplicate correction product ID ${correction.product_id}.`);
    }
    ids.add(correction.product_id);
    if (!Number.isInteger(correction.quantity) || correction.quantity < 0) {
      throw new Error(`Invalid target quantity for product ${correction.product_id}.`);
    }
    if (!Number.isInteger(correction.exported_quantity) || correction.exported_quantity < 0) {
      throw new Error(`Invalid exported quantity for product ${correction.product_id}.`);
    }
    if (!normalizeIdentity(correction.exported_name)) {
      throw new Error(`Missing exported name for product ${correction.product_id}.`);
    }
  }
  return [...ids].sort((left, right) => left - right);
}

function resolveExactCorrections(products, corrections = PRODUCT_CORRECTIONS) {
  const expectedIds = validateCorrectionDefinitions(corrections);
  const rowsById = new Map(products.map((product) => [Number(product.id), product]));
  const missingIds = expectedIds.filter((id) => !rowsById.has(id));
  if (missingIds.length) {
    throw new Error(`Exported production product IDs are missing: ${missingIds.join(", ")}. No quantity was changed.`);
  }

  return corrections.map((correction) => {
    const product = rowsById.get(correction.product_id);
    if (Number(product.branch_id) !== TARGET_BRANCH_ID) {
      throw new Error(`Product ${correction.product_id} is in branch ${product.branch_id}, not branch ${TARGET_BRANCH_ID}.`);
    }
    if (![1, true, "1"].includes(product.is_active)) {
      throw new Error(`Product ${correction.product_id} is not active.`);
    }
    if (normalizeIdentity(product.name) !== normalizeIdentity(correction.exported_name)) {
      throw new Error(`Product ${correction.product_id} name changed from exported "${correction.exported_name}" to "${product.name}".`);
    }
    if (normalizeIdentity(product.size) !== normalizeIdentity(correction.exported_size)) {
      throw new Error(`Product ${correction.product_id} size changed from exported "${correction.exported_size}" to "${product.size || ""}".`);
    }
    return { ...correction, product, match_method: "exact_product_id_and_exported_identity" };
  });
}

async function verifyDatabaseIdentity(connection) {
  const [[row]] = await connection.query("SELECT DATABASE() AS database_name");
  const databaseName = String(row?.database_name || "").trim();
  const expected = String(process.env.CHALIN03_EXPECTED_DATABASE || "").trim();
  if (!databaseName || !expected) {
    throw new Error("Set CHALIN03_EXPECTED_DATABASE to the exact Railway production database name.");
  }
  if (databaseName !== expected) {
    throw new Error(`Connected database ${databaseName} does not match CHALIN03_EXPECTED_DATABASE.`);
  }
  return databaseName;
}

async function correctionRecordExists(connection) {
  const [[table]] = await connection.query(
    "SELECT COUNT(*) AS present FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schema_migrations'"
  );
  if (Number(table?.present || 0) !== 1) throw new Error("The required schema_migrations table is missing.");
  const [[row]] = await connection.query(
    "SELECT COUNT(*) AS applied FROM schema_migrations WHERE migration_name = ?",
    [CORRECTION_RECORD]
  );
  return Number(row?.applied || 0) === 1;
}

function adjustmentType(oldQuantity, newQuantity) {
  if (newQuantity > oldQuantity) return "increase";
  if (newQuantity < oldQuantity) return "decrease";
  return "set";
}

async function verifyUpdatedQuantity(connection, productId, expectedQuantity) {
  const [[row]] = await connection.query(
    `SELECT quantity FROM products WHERE id = ? AND branch_id = ? FOR UPDATE`,
    [productId, TARGET_BRANCH_ID]
  );
  if (!row || Number(row.quantity) !== expectedQuantity) {
    throw new Error(`Product ${productId} did not verify at quantity ${expectedQuantity} after update.`);
  }
}

async function applyResolvedCorrections(connection, resolved) {
  const applied = [];
  for (let index = 0; index < resolved.length; index += 1) {
    const item = resolved[index];
    const oldQuantity = Number(item.product.quantity || 0);
    const newQuantity = Number(item.quantity);
    const reference = `KWABENA-COUNT-20260806-${String(index + 1).padStart(2, "0")}`;
    const reason = "Boss-approved Main Store physical count received from Kwabena on 2026-08-05 and 2026-08-06.";
    const notes = JSON.stringify({
      requested_name: item.requested_name,
      exported_product_id: item.product_id,
      exported_database_name: item.exported_name,
      exported_size: item.exported_size,
      exported_quantity: item.exported_quantity,
      live_database_name: item.product.name,
      live_size: item.product.size || "",
      live_quantity_before_correction: oldQuantity,
      target_quantity: newQuantity,
      matching_note: item.matching_note || null,
      match_method: item.match_method,
      source_export: SOURCE_EXPORT,
      export_generated_at: EXPORT_GENERATED_AT,
    });

    await connection.query(
      `UPDATE products SET quantity = ? WHERE id = ? AND branch_id = ? AND is_active = TRUE`,
      [newQuantity, item.product_id, TARGET_BRANCH_ID]
    );
    await verifyUpdatedQuantity(connection, item.product_id, newQuantity);

    await connection.query(
      `INSERT INTO stock_adjustments (
        branch_id, product_id, adjustment_type, movement_type, quantity,
        old_quantity, new_quantity, reason, source_name, reference_number,
        unit_cost, cost_price_before, cost_price_after, movement_date, notes, adjusted_by
      ) VALUES (?, ?, ?, 'physical_count', ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, NULL)`,
      [
        TARGET_BRANCH_ID,
        item.product_id,
        adjustmentType(oldQuantity, newQuantity),
        Math.abs(newQuantity - oldQuantity),
        oldQuantity,
        newQuantity,
        reason,
        "Kwabena physical count",
        reference,
        item.product.cost_price,
        item.product.cost_price,
        CORRECTION_DATE,
        notes,
      ]
    );

    applied.push({
      product_id: item.product_id,
      database_name: item.product.name,
      size: item.product.size || "",
      requested_name: item.requested_name,
      exported_quantity: item.exported_quantity,
      old_quantity: oldQuantity,
      new_quantity: newQuantity,
      change: newQuantity - oldQuantity,
      match_method: item.match_method,
      reference,
    });
  }

  const summary = {
    increases: applied.filter((item) => item.change > 0).length,
    decreases: applied.filter((item) => item.change < 0).length,
    unchanged: applied.filter((item) => item.change === 0).length,
    net_quantity_change: applied.reduce((sum, item) => sum + item.change, 0),
    export_net_quantity_change: PRODUCT_CORRECTIONS.reduce(
      (sum, item) => sum + item.quantity - item.exported_quantity,
      0
    ),
  };
  const description = JSON.stringify({
    branch_id: TARGET_BRANCH_ID,
    approved_by: "Boss",
    instruction_source: "Kwabena WhatsApp physical count",
    instruction_dates: ["2026-08-05", "2026-08-06"],
    correction_date: CORRECTION_DATE,
    source_export: SOURCE_EXPORT,
    export_generated_at: EXPORT_GENERATED_AT,
    product_count: applied.length,
    summary,
    products: applied,
  });

  await connection.query(
    `INSERT INTO activity_log (branch_id, user_id, action, details) VALUES (?, NULL, 'KWABENA_MAIN_STORE_QUANTITY_CORRECTION', ?)`,
    [TARGET_BRANCH_ID, description]
  );
  await connection.query(
    `INSERT INTO schema_migrations (migration_name, description) VALUES (?, ?)`,
    [CORRECTION_RECORD, description]
  );
  return { applied, summary };
}

async function runKwabenaProductQuantityCorrection20260806() {
  if (String(process.env.NODE_ENV || "").trim().toLowerCase() !== "production") {
    console.log(`${CORRECTION_RECORD} skipped outside production. No product quantity was changed.`);
    return { skipped: true, reason: "non-production" };
  }

  const targetIds = validateCorrectionDefinitions();
  const connection = await mysql.createConnection(connectionOptions());
  let lockAcquired = false;
  let transactionStarted = false;
  try {
    const databaseName = await verifyDatabaseIdentity(connection);
    const [[lock]] = await connection.query("SELECT GET_LOCK(?, 30) AS acquired", [CORRECTION_LOCK]);
    lockAcquired = Number(lock?.acquired || 0) === 1;
    if (!lockAcquired) throw new Error("Could not acquire the product quantity correction lock.");

    if (await correctionRecordExists(connection)) {
      console.log(`${CORRECTION_RECORD} was already applied on ${databaseName}; no quantities were changed.`);
      return { applied: false, already_applied: true, database_name: databaseName, correction: CORRECTION_RECORD };
    }

    await connection.beginTransaction();
    transactionStarted = true;
    const placeholders = targetIds.map(() => "?").join(", ");
    const [products] = await connection.query(
      `SELECT id, branch_id, name, size, quantity, cost_price, selling_price, barcode, is_active
         FROM products WHERE id IN (${placeholders}) ORDER BY id ASC FOR UPDATE`,
      targetIds
    );
    const resolved = resolveExactCorrections(products);
    const result = await applyResolvedCorrections(connection, resolved);
    if (result.applied.length !== PRODUCT_CORRECTIONS.length) {
      throw new Error(`Prepared ${result.applied.length} corrections instead of ${PRODUCT_CORRECTIONS.length}.`);
    }

    await connection.commit();
    transactionStarted = false;
    console.log(`Applied ${CORRECTION_RECORD} to ${result.applied.length} Main Store products on ${databaseName}.`);
    for (const item of result.applied) {
      console.log(`${item.reference}: #${item.product_id} ${item.database_name} ${item.old_quantity} -> ${item.new_quantity}`);
    }
    return {
      applied: true,
      database_name: databaseName,
      branch_id: TARGET_BRANCH_ID,
      correction: CORRECTION_RECORD,
      products: result.applied,
      summary: result.summary,
    };
  } catch (error) {
    if (transactionStarted) {
      try { await connection.rollback(); } catch {}
    }
    throw error;
  } finally {
    if (lockAcquired) {
      try { await connection.query("SELECT RELEASE_LOCK(?)", [CORRECTION_LOCK]); } catch {}
    }
    await connection.end();
  }
}

if (require.main === module) {
  runKwabenaProductQuantityCorrection20260806().catch((error) => {
    console.error("Kwabena Main Store quantity correction failed safely.");
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  CORRECTION_DATE,
  CORRECTION_LOCK,
  CORRECTION_RECORD,
  EXPECTED_CORRECTION_COUNT,
  EXPORT_GENERATED_AT,
  PRODUCT_CORRECTIONS,
  SOURCE_EXPORT,
  TARGET_BRANCH_ID,
  adjustmentType,
  applyResolvedCorrections,
  correctionRecordExists,
  normalizeIdentity,
  resolveExactCorrections,
  runKwabenaProductQuantityCorrection20260806,
  validateCorrectionDefinitions,
  verifyDatabaseIdentity,
  verifyUpdatedQuantity,
};
