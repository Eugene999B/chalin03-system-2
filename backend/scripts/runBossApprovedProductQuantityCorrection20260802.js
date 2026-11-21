const mysql = require("mysql2/promise");
require("dotenv").config();

const CORRECTION_DATE = "2026-08-02";
const EXPORT_GENERATED_AT = "2026-08-02 09:07:30 UTC";
const CORRECTION_LOCK = "chalin03:inventory:boss-quantity-correction:20260802";
const CORRECTION_RECORD = "20260802_boss_approved_product_quantity_correction";
const TARGET_BRANCH_ID = 1;

const PRODUCT_CORRECTIONS = Object.freeze([
  Object.freeze({
    product_id: 106,
    requested_name: "Fan belt box 1360",
    exported_name: "Fan Belt 1360 Box",
    exported_size: "",
    quantity: 17,
  }),
  Object.freeze({
    product_id: 206,
    requested_name: "Locker bolt",
    exported_name: "Locker Bolt",
    exported_size: "All",
    quantity: 73,
  }),
  Object.freeze({
    product_id: 243,
    requested_name: "80 Bushing",
    exported_name: "80 bushing",
    exported_size: "All",
    quantity: 22,
  }),
  Object.freeze({
    product_id: 249,
    requested_name: "Key nob Liugong",
    exported_name: "Key Nob Liugong",
    exported_size: "Liugong",
    quantity: 6,
  }),
  Object.freeze({
    product_id: 16,
    requested_name: "Coolant No:1",
    exported_name: "Coolant NO:1",
    exported_size: "All",
    quantity: 30,
  }),
  Object.freeze({
    product_id: 181,
    requested_name: "Cutter",
    exported_name: "Cutter",
    exported_size: "All",
    quantity: 0,
  }),
  Object.freeze({
    product_id: 253,
    requested_name: "Cylinder engine 6",
    exported_name: "Cylinder Engine 6",
    exported_size: "None",
    quantity: 0,
  }),
  Object.freeze({
    product_id: 246,
    requested_name: "Fan pulley cap",
    exported_name: "Fan Pulley Cap",
    exported_size: "All",
    quantity: 4,
  }),
  Object.freeze({
    product_id: 23,
    requested_name: "Water separator Sany/Liugong/JCB",
    exported_name: "Water Saparator",
    exported_size: "Sany/Liugong/JCB",
    quantity: 21,
  }),
  Object.freeze({
    product_id: 21,
    requested_name: "Fuel filter (FF5544)",
    exported_name: "Fuel Filter (FF5544)",
    exported_size: "All",
    quantity: 61,
  }),
  Object.freeze({
    product_id: 20,
    requested_name: "Oil filter (LF3349)",
    exported_name: "Oil Filter (LF3349)",
    exported_size: "All",
    quantity: 30,
  }),
  Object.freeze({
    product_id: 55,
    requested_name: "Pilot filter Liugong",
    exported_name: "Pilot Filter",
    exported_size: "Liugong",
    quantity: 8,
  }),
  Object.freeze({
    product_id: 200,
    requested_name: "Hammer",
    exported_name: "Hammer",
    exported_size: "All",
    quantity: 4,
  }),
  Object.freeze({
    product_id: 37,
    requested_name: "Gear lever Sany",
    exported_name: "Gear Lever",
    exported_size: "Sany",
    quantity: 2,
  }),
  Object.freeze({
    product_id: 50,
    requested_name: "Key nob JCB",
    exported_name: "Key Nob JCB",
    exported_size: "JCB",
    quantity: 2,
  }),
  Object.freeze({
    product_id: 27,
    requested_name: "Torch light",
    exported_name: "Torch Light",
    exported_size: "All",
    quantity: 9,
  }),
  Object.freeze({
    product_id: 30,
    requested_name: "Grease",
    exported_name: "Grease",
    exported_size: "All",
    quantity: 42,
  }),
  Object.freeze({
    product_id: 13,
    requested_name: "GTT oil 1L",
    exported_name: "GTT OIL 1L",
    exported_size: "All",
    quantity: 31,
  }),
  Object.freeze({
    product_id: 5,
    requested_name: "Sinopec gear oil",
    exported_name: "Sinopec Gear Oil 18L",
    exported_size: "All",
    quantity: 24,
  }),
  Object.freeze({
    product_id: 4,
    requested_name: "Sinopec Hydraulic Oil",
    exported_name: "Sinopec Hydraulic Oil 18L",
    exported_size: "All",
    quantity: 42,
  }),
  Object.freeze({
    product_id: 46,
    requested_name: "70 pin medium",
    exported_name: "70 Pin Medium",
    exported_size: "All",
    quantity: 14,
  }),
  Object.freeze({
    product_id: 275,
    requested_name: "80 spacer thick",
    exported_name: "80 Spacer Thick",
    exported_size: "All",
    quantity: 15,
  }),
  Object.freeze({
    product_id: 38,
    requested_name: "China Rod big",
    exported_name: "China Rod Big",
    exported_size: "All",
    quantity: 10,
  }),
  Object.freeze({
    product_id: 159,
    requested_name: "Screw driver medium (Star)",
    exported_name: "Screw Driver Medium (Star)",
    exported_size: "All",
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
  if (corrections.length !== 24) {
    throw new Error(`Expected exactly 24 boss-approved corrections, received ${corrections.length}.`);
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
    const reference = `BOSS-COUNT-20260802-${String(index + 1).padStart(2, "0")}`;
    const reason =
      "Boss-approved physical stock count correction received on 2026-08-02.";
    const notes = JSON.stringify({
      requested_name: item.requested_name,
      exported_product_id: item.product_id,
      exported_database_name: item.exported_name,
      exported_size: item.exported_size,
      live_database_name: item.product.name,
      live_size: item.product.size || "",
      match_method: item.match_method,
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
      old_quantity: oldQuantity,
      new_quantity: newQuantity,
      match_method: item.match_method,
      reference,
    });
  }

  const description = JSON.stringify({
    branch_id: TARGET_BRANCH_ID,
    approved_by: "Boss",
    instruction_source: "Kwabena WhatsApp stock count",
    correction_date: CORRECTION_DATE,
    export_generated_at: EXPORT_GENERATED_AT,
    product_count: applied.length,
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

  return applied;
}

async function runBossApprovedProductQuantityCorrection20260802() {
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
    const applied = await applyResolvedCorrections(connection, resolved);

    if (applied.length !== PRODUCT_CORRECTIONS.length) {
      throw new Error(
        `Prepared ${applied.length} product corrections instead of ${PRODUCT_CORRECTIONS.length}.`
      );
    }

    await connection.commit();
    transactionStarted = false;

    console.log(
      `Applied ${CORRECTION_RECORD} to ${applied.length} products in branch ${TARGET_BRANCH_ID} on ${databaseName}.`
    );
    for (const item of applied) {
      console.log(
        `${item.reference}: #${item.product_id} ${item.database_name} ${item.old_quantity} -> ${item.new_quantity}`
      );
    }

    return {
      applied: true,
      database_name: databaseName,
      branch_id: TARGET_BRANCH_ID,
      correction: CORRECTION_RECORD,
      products: applied,
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
  runBossApprovedProductQuantityCorrection20260802().catch((error) => {
    console.error("Boss-approved product quantity correction failed safely.");
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  CORRECTION_DATE,
  CORRECTION_LOCK,
  CORRECTION_RECORD,
  EXPORT_GENERATED_AT,
  PRODUCT_CORRECTIONS,
  TARGET_BRANCH_ID,
  adjustmentType,
  applyResolvedCorrections,
  correctionRecordExists,
  normalizeIdentity,
  resolveExactCorrections,
  runBossApprovedProductQuantityCorrection20260802,
  validateCorrectionDefinitions,
  verifyDatabaseIdentity,
  verifyUpdatedQuantity,
};
