const mysql = require("mysql2/promise");
require("dotenv").config();

const CORRECTION_DATE = "2026-08-03";
const EXPORT_GENERATED_AT = "2026-08-04 06:40:42 UTC";
const SOURCE_EXPORT = "chalin03-main-products.xlsx";
const CORRECTION_LOCK = "chalin03:inventory:boss-quantity-correction:20260804";
const CORRECTION_RECORD = "20260804_boss_approved_product_quantity_correction";
const TARGET_BRANCH_ID = 1;
const EXPECTED_CORRECTION_COUNT = 52;

const PRODUCT_CORRECTIONS = Object.freeze([
  Object.freeze({
    product_id: 141,
    requested_name: "T pipe with ring",
    exported_name: "T pipe With Ring",
    exported_size: "Alovia",
    exported_quantity: 19,
    quantity: 11,
  }),
  Object.freeze({
    product_id: 110,
    requested_name: "Fan belt 1385",
    exported_name: "Fan Belt 1385",
    exported_size: "",
    exported_quantity: 10,
    quantity: 6,
  }),
  Object.freeze({
    product_id: 105,
    requested_name: "Fan belt 1397 box",
    exported_name: "Fan Belt 1397 Box",
    exported_size: "",
    exported_quantity: 18,
    quantity: 9,
  }),
  Object.freeze({
    product_id: 264,
    requested_name: "Water engine",
    exported_name: "Water Engine Fan Belt",
    exported_size: "None",
    exported_quantity: 11,
    quantity: 12,
    matching_note: "Matched from the boss shorthand 'Water engine' to the active Water Engine Fan Belt row because it appears in the fan-belt count sequence.",
  }),
  Object.freeze({
    product_id: 106,
    requested_name: "Fan belt 1360 box",
    exported_name: "Fan Belt 1360 Box",
    exported_size: "",
    exported_quantity: 17,
    quantity: 17,
  }),
  Object.freeze({
    product_id: 263,
    requested_name: "Small China fan belt",
    exported_name: "Small China Fan Belt",
    exported_size: "None",
    exported_quantity: 70,
    quantity: 51,
    matching_note: "Matched to the active Small China Fan Belt row, not the inactive duplicate.",
  }),
  Object.freeze({
    product_id: 104,
    requested_name: "Fan belt 1370 box",
    exported_name: "Fan Belt 1370 Box",
    exported_size: "JCB",
    exported_quantity: 120,
    quantity: 90,
  }),
  Object.freeze({
    product_id: 267,
    requested_name: "Blanket dusty",
    exported_name: "Dusty Blanket",
    exported_size: "None",
    exported_quantity: 7,
    quantity: 0,
  }),
  Object.freeze({
    product_id: 250,
    requested_name: "Ash medium blanket",
    exported_name: "Ash Medium Blanket",
    exported_size: "None",
    exported_quantity: 18,
    quantity: 2,
  }),
  Object.freeze({
    product_id: 206,
    requested_name: "Locker bolt",
    exported_name: "Locker Bolt",
    exported_size: "All",
    exported_quantity: 73,
    quantity: 65,
  }),
  Object.freeze({
    product_id: 62,
    requested_name: "Bushing 70",
    exported_name: "Bushing 70",
    exported_size: "All",
    exported_quantity: 7,
    quantity: 6,
  }),
  Object.freeze({
    product_id: 243,
    requested_name: "Bushing 80",
    exported_name: "80 bushing",
    exported_size: "All",
    exported_quantity: 22,
    quantity: 22,
    matching_note: "Matched to the active 80 bushing row, not the inactive Bushing 80 duplicate.",
  }),
  Object.freeze({
    product_id: 276,
    requested_name: "XCMG circle tuner",
    exported_name: "XCMG CIRCLE TURNER",
    exported_size: "XCMG",
    exported_quantity: 3,
    quantity: 2,
  }),
  Object.freeze({
    product_id: 249,
    requested_name: "Key nob Liugong",
    exported_name: "Key Nob Liugong",
    exported_size: "Liugong",
    exported_quantity: 6,
    quantity: 6,
  }),
  Object.freeze({
    product_id: 16,
    requested_name: "Coolant no 1",
    exported_name: "Coolant NO:1",
    exported_size: "All",
    exported_quantity: 30,
    quantity: 30,
  }),
  Object.freeze({
    product_id: 181,
    requested_name: "Cutter",
    exported_name: "Cutter",
    exported_size: "All",
    exported_quantity: 0,
    quantity: 0,
  }),
  Object.freeze({
    product_id: 117,
    requested_name: "H bar 80/80",
    exported_name: "H Bar 80/80",
    exported_size: "All",
    exported_quantity: 4,
    quantity: 3,
  }),
  Object.freeze({
    product_id: 246,
    requested_name: "Fan pulley cap",
    exported_name: "Fan Pulley Cap",
    exported_size: "All",
    exported_quantity: 4,
    quantity: 4,
    matching_note: "Matched to the active Fan Pulley Cap row, not the inactive duplicate.",
  }),
  Object.freeze({
    product_id: 55,
    requested_name: "Pilot filter Liugong",
    exported_name: "Pilot Filter",
    exported_size: "Liugong",
    exported_quantity: 8,
    quantity: 8,
  }),
  Object.freeze({
    product_id: 116,
    requested_name: "Hand grease gun short",
    exported_name: "Hand Grease Gun Short",
    exported_size: "All",
    exported_quantity: 6,
    quantity: 6,
  }),
  Object.freeze({
    product_id: 200,
    requested_name: "Hammer",
    exported_name: "Hammer",
    exported_size: "All",
    exported_quantity: 3,
    quantity: 4,
  }),
  Object.freeze({
    product_id: 228,
    requested_name: "Intake hose",
    exported_name: "Intake Hose",
    exported_size: "None",
    exported_quantity: 24,
    quantity: 19,
  }),
  Object.freeze({
    product_id: 37,
    requested_name: "Gear lever",
    exported_name: "Gear Lever",
    exported_size: "Sany",
    exported_quantity: 2,
    quantity: 2,
    matching_note: "Matched to the active Sany Gear Lever row; the XCM and Liugong variants are separate product IDs.",
  }),
  Object.freeze({
    product_id: 50,
    requested_name: "Key nob JCB",
    exported_name: "Key Nob JCB",
    exported_size: "JCB",
    exported_quantity: 2,
    quantity: 2,
  }),
  Object.freeze({
    product_id: 51,
    requested_name: "Key nob Sany",
    exported_name: "Key Nob Sany",
    exported_size: "Sany",
    exported_quantity: 19,
    quantity: 5,
  }),
  Object.freeze({
    product_id: 140,
    requested_name: "Small China liner 1115",
    exported_name: "Small China Liner 1115",
    exported_size: "Small China",
    exported_quantity: 21,
    quantity: 20,
  }),
  Object.freeze({
    product_id: 30,
    requested_name: "Grease",
    exported_name: "Grease",
    exported_size: "All",
    exported_quantity: 42,
    quantity: 42,
  }),
  Object.freeze({
    product_id: 5,
    requested_name: "Sinopec gear oil 18L",
    exported_name: "Sinopec Gear Oil 18L",
    exported_size: "All",
    exported_quantity: 20,
    quantity: 24,
  }),
  Object.freeze({
    product_id: 13,
    requested_name: "GTT oil 1L",
    exported_name: "GTT OIL 1L",
    exported_size: "All",
    exported_quantity: 31,
    quantity: 31,
  }),
  Object.freeze({
    product_id: 9,
    requested_name: "Total oil quartz 1L",
    exported_name: "Total Oil Quartz 1L",
    exported_size: "All",
    exported_quantity: 69,
    quantity: 32,
  }),
  Object.freeze({
    product_id: 4,
    requested_name: "Sinopec hydraulic oil 18L",
    exported_name: "Sinopec Hydraulic Oil 18L",
    exported_size: "All",
    exported_quantity: 41,
    quantity: 42,
  }),
  Object.freeze({
    product_id: 223,
    requested_name: "Metal plate small hole",
    exported_name: "Metal Plate Small Hole",
    exported_size: "None",
    exported_quantity: 34,
    quantity: 32,
  }),
  Object.freeze({
    product_id: 101,
    requested_name: "Outers 6 inches",
    exported_name: "Outers 6 Inches",
    exported_size: "Alovia",
    exported_quantity: 8,
    quantity: 4,
  }),
  Object.freeze({
    product_id: 100,
    requested_name: "Outers 4 inches",
    exported_name: "Outers 4 inches",
    exported_size: "Alovia",
    exported_quantity: 28,
    quantity: 27,
  }),
  Object.freeze({
    product_id: 46,
    requested_name: "70 pin medium",
    exported_name: "70 Pin Medium",
    exported_size: "All",
    exported_quantity: 14,
    quantity: 14,
  }),
  Object.freeze({
    product_id: 112,
    requested_name: "Filling pipe",
    exported_name: "Filling Pipe",
    exported_size: "Alovia",
    exported_quantity: 5,
    quantity: 4,
  }),
  Object.freeze({
    product_id: 269,
    requested_name: "Center joint seal 215 Liugong/XCMG",
    exported_name: "Center Joint Seal 215",
    exported_size: "Liugong/XCMG",
    exported_quantity: 6,
    quantity: 5,
  }),
  Object.freeze({
    product_id: 275,
    requested_name: "80 spacer thick",
    exported_name: "80 Spacer Thick",
    exported_size: "All",
    exported_quantity: 15,
    quantity: 15,
  }),
  Object.freeze({
    product_id: 185,
    requested_name: "Spanner 27",
    exported_name: "Spanner 27",
    exported_size: "All",
    exported_quantity: 4,
    quantity: 4,
    matching_note: "Matched to the active Spanner 27 row, not the inactive duplicate.",
  }),
  Object.freeze({
    product_id: 197,
    requested_name: "Spanner L bar big",
    exported_name: "Spanner L Bar Big",
    exported_size: "All",
    exported_quantity: 6,
    quantity: 5,
  }),
  Object.freeze({
    product_id: 191,
    requested_name: "Spanner 14",
    exported_name: "Spanner 14",
    exported_size: "All",
    exported_quantity: 10,
    quantity: 8,
  }),
  Object.freeze({
    product_id: 193,
    requested_name: "Spanner 11",
    exported_name: "Spanner 11",
    exported_size: "All",
    exported_quantity: 10,
    quantity: 9,
  }),
  Object.freeze({
    product_id: 175,
    requested_name: "Box spanner 10",
    exported_name: "Box Spanner 10",
    exported_size: "All",
    exported_quantity: 20,
    quantity: 19,
  }),
  Object.freeze({
    product_id: 80,
    requested_name: "Speed sensor",
    exported_name: "Speed Sensor",
    exported_size: "All",
    exported_quantity: 1,
    quantity: 0,
  }),
  Object.freeze({
    product_id: 78,
    requested_name: "Starter small gear",
    exported_name: "Starter Small Gear",
    exported_size: "All",
    exported_quantity: 1,
    quantity: 1,
  }),
  Object.freeze({
    product_id: 74,
    requested_name: "Sany teeth",
    exported_name: "Sany Teeth",
    exported_size: "Sany",
    exported_quantity: 5,
    quantity: 3,
  }),
  Object.freeze({
    product_id: 240,
    requested_name: "Track shoe",
    exported_name: "Track Shoe",
    exported_size: "All",
    exported_quantity: 37,
    quantity: 39,
  }),
  Object.freeze({
    product_id: 85,
    requested_name: "Track link 106 single",
    exported_name: "Track Link 106 Single",
    exported_size: "All",
    exported_quantity: 10,
    quantity: 8,
  }),
  Object.freeze({
    product_id: 82,
    requested_name: "Tread locker",
    exported_name: "Tread Locker",
    exported_size: "All",
    exported_quantity: 11,
    quantity: 8,
  }),
  Object.freeze({
    product_id: 314,
    requested_name: "Cylinder spring",
    exported_name: "Cylinder Spring",
    exported_size: "None",
    exported_quantity: 8,
    quantity: 4,
  }),
  Object.freeze({
    product_id: 38,
    requested_name: "China Rod big",
    exported_name: "China Rod Big",
    exported_size: "All",
    exported_quantity: 10,
    quantity: 10,
  }),
  Object.freeze({
    product_id: 159,
    requested_name: "Screw driver medium star",
    exported_name: "Screw Driver Medium (Star)",
    exported_size: "All",
    exported_quantity: 8,
    quantity: 8,
  }),
]);

function requiredEnv(primaryName, fallbackName) {
  const value = process.env[primaryName] || process.env[fallbackName];
  if (!String(value || "").trim()) {
    throw new Error(
      `Missing required database variable ${primaryName}${fallbackName ? ` or ${fallbackName}` : ""}.`
    );
  }
  return value;
}

function getSslConfig(env = process.env) {
  if (String(env.DB_SSL || "").trim().toLowerCase() !== "true") {
    return undefined;
  }

  const encodedCa = String(env.DB_SSL_CA_BASE64 || "").trim();
  if (encodedCa) {
    return {
      ca: Buffer.from(encodedCa, "base64").toString("utf8"),
      rejectUnauthorized: true,
    };
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
    throw new Error(
      `Expected exactly ${EXPECTED_CORRECTION_COUNT} boss-approved corrections, received ${corrections.length}.`
    );
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
      throw new Error(`Invalid quantity for product ${correction.product_id}.`);
    }
    if (
      !Number.isInteger(correction.exported_quantity) ||
      correction.exported_quantity < 0
    ) {
      throw new Error(
        `Invalid exported quantity for product ${correction.product_id}.`
      );
    }
    if (!normalizeIdentity(correction.exported_name)) {
      throw new Error(`Missing exported product name for ID ${correction.product_id}.`);
    }
  }

  return [...ids].sort((left, right) => left - right);
}

function resolveExactCorrections(products, corrections = PRODUCT_CORRECTIONS) {
  const expectedIds = validateCorrectionDefinitions(corrections);
  const rowsById = new Map(products.map((product) => [Number(product.id), product]));
  const missingIds = expectedIds.filter((id) => !rowsById.has(id));

  if (missingIds.length) {
    throw new Error(
      `Exported production product IDs are missing: ${missingIds.join(", ")}. No quantity was changed.`
    );
  }

  return corrections.map((correction) => {
    const product = rowsById.get(correction.product_id);

    if (Number(product.branch_id) !== TARGET_BRANCH_ID) {
      throw new Error(
        `Product ${correction.product_id} is in branch ${product.branch_id}, not branch ${TARGET_BRANCH_ID}.`
      );
    }
    if (![1, true, "1"].includes(product.is_active)) {
      throw new Error(`Product ${correction.product_id} is not active.`);
    }

    const actualName = normalizeIdentity(product.name);
    const expectedName = normalizeIdentity(correction.exported_name);
    if (actualName !== expectedName) {
      throw new Error(
        `Product ${correction.product_id} name changed from exported "${correction.exported_name}" to "${product.name}".`
      );
    }

    const actualSize = normalizeIdentity(product.size);
    const expectedSize = normalizeIdentity(correction.exported_size);
    if (actualSize !== expectedSize) {
      throw new Error(
        `Product ${correction.product_id} size changed from exported "${correction.exported_size}" to "${product.size || ""}".`
      );
    }

    return {
      ...correction,
      product,
      match_method: "exact_product_id_and_exported_identity",
    };
  });
}

async function verifyDatabaseIdentity(connection) {
  const [[row]] = await connection.query("SELECT DATABASE() AS database_name");
  const databaseName = String(row?.database_name || "").trim();
  const expected = String(process.env.CHALIN03_EXPECTED_DATABASE || "").trim();

  if (!databaseName || !expected) {
    throw new Error(
      "Set CHALIN03_EXPECTED_DATABASE to the exact Railway production database name."
    );
  }
  if (databaseName !== expected) {
    throw new Error(
      `Connected database ${databaseName} does not match CHALIN03_EXPECTED_DATABASE.`
    );
  }
  return databaseName;
}

async function correctionRecordExists(connection) {
  const [[table]] = await connection.query(
    "SELECT COUNT(*) AS present FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schema_migrations'"
  );
  if (Number(table?.present || 0) !== 1) {
    throw new Error("The required schema_migrations table is missing.");
  }

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
    `SELECT quantity
     FROM products
     WHERE id = ?
       AND branch_id = ?
     FOR UPDATE`,
    [productId, TARGET_BRANCH_ID]
  );

  if (!row || Number(row.quantity) !== expectedQuantity) {
    throw new Error(
      `Product ${productId} did not verify at quantity ${expectedQuantity} after update.`
    );
  }
}

async function applyResolvedCorrections(connection, resolved) {
  const applied = [];

  for (let index = 0; index < resolved.length; index += 1) {
    const item = resolved[index];
    const oldQuantity = Number(item.product.quantity || 0);
    const newQuantity = Number(item.quantity);
    const reference = `BOSS-COUNT-20260804-${String(index + 1).padStart(2, "0")}`;
    const reason =
      "Boss-approved physical stock count correction received from Kwabena on 2026-08-03.";
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
      `UPDATE products
       SET quantity = ?
       WHERE id = ?
         AND branch_id = ?
         AND is_active = TRUE`,
      [newQuantity, item.product_id, TARGET_BRANCH_ID]
    );
    await verifyUpdatedQuantity(connection, item.product_id, newQuantity);

    await connection.query(
      `INSERT INTO stock_adjustments (
        branch_id,
        product_id,
        adjustment_type,
        movement_type,
        quantity,
        old_quantity,
        new_quantity,
        reason,
        source_name,
        reference_number,
        unit_cost,
        cost_price_before,
        cost_price_after,
        movement_date,
        notes,
        adjusted_by
      ) VALUES (?, ?, ?, 'physical_count', ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, NULL)`,
      [
        TARGET_BRANCH_ID,
        item.product_id,
        adjustmentType(oldQuantity, newQuantity),
        Math.abs(newQuantity - oldQuantity),
        oldQuantity,
        newQuantity,
        reason,
        "Boss-approved physical count",
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
  };
  const description = JSON.stringify({
    branch_id: TARGET_BRANCH_ID,
    approved_by: "Boss",
    instruction_source: "Kwabena WhatsApp stock count",
    correction_date: CORRECTION_DATE,
    source_export: SOURCE_EXPORT,
    export_generated_at: EXPORT_GENERATED_AT,
    product_count: applied.length,
    summary,
    products: applied,
  });

  await connection.query(
    `INSERT INTO activity_log (branch_id, user_id, action, details)
     VALUES (?, NULL, 'BOSS_APPROVED_STOCK_COUNT_CORRECTION', ?)`,
    [TARGET_BRANCH_ID, description]
  );

  await connection.query(
    `INSERT INTO schema_migrations (migration_name, description)
     VALUES (?, ?)`,
    [CORRECTION_RECORD, description]
  );

  return { applied, summary };
}

async function runBossApprovedProductQuantityCorrection20260804() {
  if (String(process.env.NODE_ENV || "").trim().toLowerCase() !== "production") {
    console.log(
      `${CORRECTION_RECORD} skipped outside production. No product quantity was changed.`
    );
    return { skipped: true, reason: "non-production" };
  }

  const targetIds = validateCorrectionDefinitions();
  const connection = await mysql.createConnection(connectionOptions());
  let lockAcquired = false;
  let transactionStarted = false;

  try {
    const databaseName = await verifyDatabaseIdentity(connection);
    const [[lock]] = await connection.query("SELECT GET_LOCK(?, 30) AS acquired", [
      CORRECTION_LOCK,
    ]);
    lockAcquired = Number(lock?.acquired || 0) === 1;
    if (!lockAcquired) {
      throw new Error("Could not acquire the product quantity correction lock.");
    }

    if (await correctionRecordExists(connection)) {
      console.log(
        `${CORRECTION_RECORD} was already applied on ${databaseName}; no quantities were changed.`
      );
      return {
        applied: false,
        already_applied: true,
        database_name: databaseName,
        correction: CORRECTION_RECORD,
      };
    }

    await connection.beginTransaction();
    transactionStarted = true;

    const placeholders = targetIds.map(() => "?").join(", ");
    const [products] = await connection.query(
      `SELECT id, branch_id, name, size, quantity, cost_price, is_active
       FROM products
       WHERE id IN (${placeholders})
       ORDER BY id ASC
       FOR UPDATE`,
      targetIds
    );

    const resolved = resolveExactCorrections(products);
    const result = await applyResolvedCorrections(connection, resolved);

    if (result.applied.length !== PRODUCT_CORRECTIONS.length) {
      throw new Error(
        `Prepared ${result.applied.length} product corrections instead of ${PRODUCT_CORRECTIONS.length}.`
      );
    }

    await connection.commit();
    transactionStarted = false;

    console.log(
      `Applied ${CORRECTION_RECORD} to ${result.applied.length} products in branch ${TARGET_BRANCH_ID} on ${databaseName}.`
    );
    console.log(
      `Summary: ${result.summary.decreases} decreases, ${result.summary.increases} increases, ${result.summary.unchanged} unchanged, net ${result.summary.net_quantity_change} units.`
    );
    for (const item of result.applied) {
      console.log(
        `${item.reference}: #${item.product_id} ${item.database_name} ${item.old_quantity} -> ${item.new_quantity}`
      );
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
      try {
        await connection.rollback();
      } catch {}
    }
    throw error;
  } finally {
    if (lockAcquired) {
      try {
        await connection.query("SELECT RELEASE_LOCK(?)", [CORRECTION_LOCK]);
      } catch {}
    }
    await connection.end();
  }
}

if (require.main === module) {
  runBossApprovedProductQuantityCorrection20260804().catch((error) => {
    console.error("Boss-approved product quantity correction failed safely.");
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
  runBossApprovedProductQuantityCorrection20260804,
  validateCorrectionDefinitions,
  verifyDatabaseIdentity,
  verifyUpdatedQuantity,
};
