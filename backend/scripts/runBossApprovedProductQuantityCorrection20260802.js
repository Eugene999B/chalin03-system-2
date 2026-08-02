const mysql = require("mysql2/promise");
require("dotenv").config();

const CORRECTION_DATE = "2026-08-02";
const CORRECTION_LOCK = "chalin03:inventory:boss-quantity-correction:20260802";
const CORRECTION_RECORD = "20260802_boss_approved_product_quantity_correction";
const TARGET_BRANCH_ID = 1;
const MIN_MATCH_SCORE = 0.84;
const MIN_MATCH_MARGIN = 0.08;

const BRAND_OR_CODE_TOKENS = new Set([
  "gtt",
  "jcb",
  "liugong",
  "sany",
  "sinopec",
]);

const PRODUCT_CORRECTIONS = Object.freeze([
  {
    label: "Fan belt box 1360",
    quantity: 17,
    aliases: ["Fan belt box 1360", "1360 fan belt box", "Fan belt 1360 box"],
  },
  {
    label: "Locker bolt",
    quantity: 73,
    aliases: ["Locker bolt", "Lock bolt"],
  },
  {
    label: "80 Bushing",
    quantity: 22,
    aliases: ["80 Bushing", "Bushing 80", "80 Bush", "Bush 80"],
  },
  {
    label: "Key nob Liugong",
    quantity: 6,
    aliases: ["Key nob Liugong", "Key knob Liugong", "Liugong key knob"],
  },
  {
    label: "Coolant No:1",
    quantity: 30,
    aliases: ["Coolant No:1", "Coolant No 1", "Coolant number 1", "No 1 coolant", "Coolant 1"],
  },
  {
    label: "Cutter",
    quantity: 0,
    aliases: ["Cutter"],
  },
  {
    label: "Cylinder engine 6",
    quantity: 0,
    aliases: ["Cylinder engine 6", "Engine cylinder 6"],
  },
  {
    label: "Fan pulley cap",
    quantity: 4,
    aliases: ["Fan pulley cap", "Pulley fan cap", "Fan pulley cover"],
  },
  {
    label: "Water separator Sany/Liugong/JCB",
    quantity: 21,
    aliases: [
      "Water separator Sany Liugong JCB",
      "Water separator Liugong Sany JCB",
      "Water separator JCB Sany Liugong",
    ],
  },
  {
    label: "Fuel filter (FF5544)",
    quantity: 61,
    aliases: ["Fuel filter FF5544", "FF5544 fuel filter"],
  },
  {
    label: "Oil filter (LF3349)",
    quantity: 30,
    aliases: ["Oil filter LF3349", "LF3349 oil filter"],
  },
  {
    label: "Pilot filter Liugong",
    quantity: 8,
    aliases: ["Pilot filter Liugong", "Liugong pilot filter"],
  },
  {
    label: "Hammer",
    quantity: 4,
    aliases: ["Hammer"],
  },
  {
    label: "Gear lever Sany",
    quantity: 2,
    aliases: ["Gear lever Sany", "Sany gear lever"],
  },
  {
    label: "Key nob JCB",
    quantity: 2,
    aliases: ["Key nob JCB", "Key knob JCB", "JCB key knob"],
  },
  {
    label: "Torch light",
    quantity: 9,
    aliases: ["Torch light", "Torchlight"],
  },
  {
    label: "Grease",
    quantity: 42,
    aliases: ["Grease"],
  },
  {
    label: "GTT oil 1L",
    quantity: 31,
    aliases: ["GTT oil 1L", "GTT 1L oil", "1 litre GTT oil", "GTT oil 1 litre"],
  },
  {
    label: "Sinopec gear oil",
    quantity: 24,
    aliases: ["Sinopec gear oil", "Gear oil Sinopec"],
  },
  {
    label: "Sinopec Hydraulic Oil",
    quantity: 42,
    aliases: ["Sinopec hydraulic oil", "Hydraulic oil Sinopec"],
  },
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

function normalizeProductName(value) {
  let text = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  text = text
    .replace(/\b(ff|lf)\s*[-_. ]*\s*(\d+)\b/g, "$1$2")
    .replace(/\b(\d+)\s*(litres?|liters?|ltr|l)\b/g, "$1l")
    .replace(/\btorch\s*light\b/g, "torchlight")
    .replace(/\bkey\s+nob\b/g, "key knob")
    .replace(/\blocker\b/g, "lock")
    .replace(/\bnumber\b/g, "no")
    .replace(/\bno\s*[:#.-]*\s*(\d+)\b/g, "$1")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  const singularMap = new Map([
    ["bolts", "bolt"],
    ["bushes", "bush"],
    ["bushings", "bushing"],
    ["filters", "filter"],
    ["lights", "light"],
  ]);

  const tokens = text
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !["and", "for", "no", "the"].includes(token))
    .map((token) => singularMap.get(token) || token)
    .map((token) => (token === "nob" ? "knob" : token))
    .sort();

  return tokens.join(" ");
}

function tokenSet(value) {
  return new Set(normalizeProductName(value).split(" ").filter(Boolean));
}

function essentialTokens(value) {
  return [...tokenSet(value)].filter(
    (token) => /\d/.test(token) || BRAND_OR_CODE_TOKENS.has(token)
  );
}

function scoreName(alias, candidateName) {
  const normalizedAlias = normalizeProductName(alias);
  const normalizedCandidate = normalizeProductName(candidateName);

  if (!normalizedAlias || !normalizedCandidate) return 0;
  if (normalizedAlias === normalizedCandidate) return 1;

  const aliasTokens = tokenSet(alias);
  const candidateTokens = tokenSet(candidateName);

  if (aliasTokens.size <= 1 || candidateTokens.size <= 1) return 0;

  for (const token of essentialTokens(alias)) {
    if (!candidateTokens.has(token)) return 0;
  }

  const intersection = [...aliasTokens].filter((token) => candidateTokens.has(token)).length;
  const union = new Set([...aliasTokens, ...candidateTokens]).size;
  const targetCoverage = intersection / aliasTokens.size;
  const candidateCoverage = intersection / candidateTokens.size;
  const jaccard = union ? intersection / union : 0;

  if (targetCoverage < 0.75 || candidateCoverage < 0.6) return 0;

  return Number((jaccard * 0.55 + targetCoverage * 0.25 + candidateCoverage * 0.2).toFixed(6));
}

function scoreCorrectionAgainstProduct(correction, product) {
  return Math.max(
    ...correction.aliases.map((alias) => scoreName(alias, product.name))
  );
}

function chooseUniqueProduct(correction, products) {
  const ranked = products
    .map((product) => ({
      product,
      score: scoreCorrectionAgainstProduct(correction, product),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.product.id - right.product.id);

  if (!ranked.length || ranked[0].score < MIN_MATCH_SCORE) {
    const candidates = ranked
      .slice(0, 5)
      .map((entry) => `${entry.product.id}:${entry.product.name} (${entry.score.toFixed(3)})`)
      .join(", ");
    throw new Error(
      `No safe product match for ${correction.label}. Best candidates: ${candidates || "none"}.`
    );
  }

  const top = ranked[0];
  const next = ranked[1];
  const exactTie = next && top.score === 1 && next.score === 1;
  const weakMargin = next && top.score - next.score < MIN_MATCH_MARGIN;

  if (exactTie || weakMargin) {
    throw new Error(
      `Ambiguous product match for ${correction.label}: ${ranked
        .slice(0, 5)
        .map((entry) => `${entry.product.id}:${entry.product.name} (${entry.score.toFixed(3)})`)
        .join(", ")}.`
    );
  }

  return {
    ...correction,
    product: top.product,
    match_score: top.score,
  };
}

function resolveCorrections(products, corrections = PRODUCT_CORRECTIONS) {
  const resolved = corrections.map((correction) =>
    chooseUniqueProduct(correction, products)
  );
  const usedIds = new Set();

  for (const item of resolved) {
    if (usedIds.has(item.product.id)) {
      throw new Error(
        `Product ${item.product.id}:${item.product.name} matched more than one correction target.`
      );
    }
    usedIds.add(item.product.id);
  }

  if (resolved.length !== corrections.length) {
    throw new Error(
      `Resolved ${resolved.length} products instead of ${corrections.length}.`
    );
  }

  return resolved;
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
      requested_name: item.label,
      matched_product_id: item.product.id,
      matched_database_name: item.product.name,
      match_score: item.match_score,
      matching_rules:
        "case-insensitive; punctuation, spacing and word-order tolerant; known spelling aliases only",
    });

    await connection.query(
      `UPDATE products
       SET quantity = ?
       WHERE id = ?
       AND branch_id = ?`,
      [newQuantity, item.product.id, TARGET_BRANCH_ID]
    );

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
        item.product.id,
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
      product_id: item.product.id,
      database_name: item.product.name,
      requested_name: item.label,
      old_quantity: oldQuantity,
      new_quantity: newQuantity,
      match_score: item.match_score,
      reference,
    });
  }

  const description = JSON.stringify({
    branch_id: TARGET_BRANCH_ID,
    approved_by: "Boss",
    instruction_source: "Kwabena WhatsApp stock count",
    correction_date: CORRECTION_DATE,
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

    const [products] = await connection.query(
      `SELECT id, branch_id, name, quantity, cost_price, is_active
       FROM products
       WHERE branch_id = ?
       AND is_active = TRUE
       ORDER BY id ASC
       FOR UPDATE`,
      [TARGET_BRANCH_ID]
    );

    const resolved = resolveCorrections(products);
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
        `${item.reference}: ${item.database_name} ${item.old_quantity} -> ${item.new_quantity}`
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
  MIN_MATCH_MARGIN,
  MIN_MATCH_SCORE,
  PRODUCT_CORRECTIONS,
  TARGET_BRANCH_ID,
  adjustmentType,
  applyResolvedCorrections,
  chooseUniqueProduct,
  correctionRecordExists,
  essentialTokens,
  normalizeProductName,
  resolveCorrections,
  runBossApprovedProductQuantityCorrection20260802,
  scoreCorrectionAgainstProduct,
  scoreName,
  verifyDatabaseIdentity,
};
