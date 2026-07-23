const { pool } = require("../config/db");

const COMMERCIAL_REPAIR_MIGRATION_NAME =
  "20260723_equipment_sales_commercial_column_repair_v1";
const LOCK_NAME = "chalin03_equipment_sales_finalization_v3";

const REQUIRED_SUPPORT_TABLES = [
  "fleet_assets",
  "business_locations",
  "hire_customers",
  "users",
  "equipment_asset_sale_locks",
];

const OPTIONAL_SUPPORT_TABLES = ["sms_log", "hire_contract_assets"];

const TABLES = {
  equipment_sales_enquiries: {
    columns: [
      ["enquiry_number", "VARCHAR(80) NULL"],
      ["hire_location_id", "INT NULL"],
      ["customer_id", "INT NULL"],
      ["enquiry_date", "DATE NULL"],
      ["asset_type", "VARCHAR(100) NOT NULL DEFAULT 'Excavator'"],
      ["preferred_make", "VARCHAR(100) NULL"],
      ["preferred_model", "VARCHAR(100) NULL"],
      [
        "condition_preference",
        "ENUM('new','used','either') NOT NULL DEFAULT 'either'",
      ],
      ["budget_amount", "DECIMAL(14,2) NOT NULL DEFAULT 0.00"],
      [
        "purchase_method",
        "ENUM('cash','installment','undecided') NOT NULL DEFAULT 'undecided'",
      ],
      ["expected_purchase_date", "DATE NULL"],
      ["source_channel", "VARCHAR(80) NULL"],
      [
        "status",
        "ENUM('open','quoted','won','lost','cancelled') NOT NULL DEFAULT 'open'",
      ],
      ["notes", "TEXT NULL"],
      ["created_by", "INT NULL"],
      ["updated_by", "INT NULL"],
      ["created_at", "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"],
      [
        "updated_at",
        "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
      ],
    ],
    indexes: [
      ["uq_equipment_sales_enquiry_number", "`enquiry_number`", true],
      [
        "idx_equipment_sales_enquiry_location",
        "`hire_location_id`, `enquiry_date`, `status`",
      ],
      ["idx_equipment_sales_enquiry_customer", "`customer_id`, `created_at`"],
      [
        "idx_equipment_sales_enquiry_asset",
        "`asset_type`, `preferred_make`, `preferred_model`",
      ],
    ],
  },

  equipment_sales_quotations: {
    columns: [
      ["quotation_number", "VARCHAR(80) NULL"],
      ["hire_location_id", "INT NULL"],
      ["enquiry_id", "BIGINT NULL"],
      ["customer_id", "INT NULL"],
      ["quotation_date", "DATE NULL"],
      ["validity_date", "DATE NULL"],
      [
        "status",
        "ENUM('draft','pending_approval','approved','accepted','rejected','expired','converted','cancelled') NOT NULL DEFAULT 'draft'",
      ],
      ["subtotal", "DECIMAL(14,2) NOT NULL DEFAULT 0.00"],
      ["discount_amount", "DECIMAL(14,2) NOT NULL DEFAULT 0.00"],
      ["tax_rate_percent", "DECIMAL(7,4) NOT NULL DEFAULT 0.0000"],
      ["tax_amount", "DECIMAL(14,2) NOT NULL DEFAULT 0.00"],
      ["total_amount", "DECIMAL(14,2) NOT NULL DEFAULT 0.00"],
      ["deposit_required", "DECIMAL(14,2) NOT NULL DEFAULT 0.00"],
      [
        "proposed_frequency",
        "ENUM('weekly','fortnightly','monthly','custom') NULL",
      ],
      ["proposed_installment_count", "INT NULL"],
      ["proposed_first_due_date", "DATE NULL"],
      [
        "delivery_policy",
        "ENUM('immediate','after_deposit','after_percentage','after_full_payment') NOT NULL DEFAULT 'after_deposit'",
      ],
      ["delivery_threshold_percent", "DECIMAL(7,4) NOT NULL DEFAULT 0.0000"],
      ["terms", "TEXT NULL"],
      ["notes", "TEXT NULL"],
      ["approval_reason", "VARCHAR(500) NULL"],
      ["created_by", "INT NULL"],
      ["approved_by", "INT NULL"],
      ["approved_at", "DATETIME NULL"],
      ["created_at", "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"],
      [
        "updated_at",
        "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
      ],
    ],
    indexes: [
      ["uq_equipment_sales_quotation_number", "`quotation_number`", true],
      [
        "idx_equipment_sales_quote_location",
        "`hire_location_id`, `quotation_date`, `status`",
      ],
      ["idx_equipment_sales_quote_customer", "`customer_id`, `created_at`"],
      ["idx_equipment_sales_quote_enquiry", "`enquiry_id`"],
      [
        "idx_equipment_sales_quote_approval",
        "`hire_location_id`, `status`, `created_at`",
      ],
    ],
  },

  equipment_sales_quotation_items: {
    columns: [
      ["quotation_id", "BIGINT NULL"],
      ["hire_location_id", "INT NULL"],
      ["line_number", "INT NOT NULL DEFAULT 1"],
      ["asset_id", "INT NULL"],
      ["asset_code_snapshot", "VARCHAR(50) NULL"],
      ["asset_name_snapshot", "VARCHAR(150) NULL"],
      ["asset_type_snapshot", "VARCHAR(100) NULL"],
      ["make_snapshot", "VARCHAR(100) NULL"],
      ["model_snapshot", "VARCHAR(100) NULL"],
      ["model_year_snapshot", "SMALLINT UNSIGNED NULL"],
      ["serial_number_snapshot", "VARCHAR(120) NULL"],
      ["main_image_url_snapshot", "LONGTEXT NULL"],
      ["description", "VARCHAR(500) NULL"],
      ["quantity", "INT NOT NULL DEFAULT 1"],
      ["unit_price", "DECIMAL(14,2) NOT NULL DEFAULT 0.00"],
      ["discount_amount", "DECIMAL(14,2) NOT NULL DEFAULT 0.00"],
      ["tax_amount", "DECIMAL(14,2) NOT NULL DEFAULT 0.00"],
      ["line_total", "DECIMAL(14,2) NOT NULL DEFAULT 0.00"],
      ["created_at", "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"],
      [
        "updated_at",
        "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
      ],
    ],
    indexes: [
      [
        "uq_equipment_sales_quote_line",
        "`quotation_id`, `line_number`",
        true,
      ],
      [
        "idx_equipment_sales_quote_item_location",
        "`hire_location_id`, `quotation_id`",
      ],
      ["idx_equipment_sales_quote_item_asset", "`asset_id`, `quotation_id`"],
    ],
  },

  equipment_sale_agreements: {
    columns: [
      ["agreement_number", "VARCHAR(80) NULL"],
      ["hire_location_id", "INT NULL"],
      ["quotation_id", "BIGINT NULL"],
      ["quotation_item_id", "BIGINT NULL"],
      ["enquiry_id", "BIGINT NULL"],
      ["customer_id", "INT NULL"],
      ["asset_id", "INT NULL"],
      ["sale_type", "ENUM('cash','installment') NOT NULL DEFAULT 'cash'"],
      [
        "agreement_status",
        "ENUM('draft','pending_approval','approved','active','due_soon','payment_due','overdue','completed','cancelled','defaulted') NOT NULL DEFAULT 'draft'",
      ],
      [
        "approval_status",
        "ENUM('not_required','pending','approved','rejected') NOT NULL DEFAULT 'not_required'",
      ],
      ["customer_name_snapshot", "VARCHAR(150) NULL"],
      ["customer_phone_snapshot", "VARCHAR(30) NULL"],
      ["customer_location_snapshot", "VARCHAR(180) NULL"],
      ["customer_id_type", "VARCHAR(60) NULL"],
      ["customer_id_number", "VARCHAR(120) NULL"],
      ["customer_id_document_url", "LONGTEXT NULL"],
      ["asset_code_snapshot", "VARCHAR(50) NULL"],
      ["asset_name_snapshot", "VARCHAR(150) NULL"],
      ["asset_type_snapshot", "VARCHAR(100) NULL"],
      ["make_snapshot", "VARCHAR(100) NULL"],
      ["model_snapshot", "VARCHAR(100) NULL"],
      ["model_year_snapshot", "SMALLINT UNSIGNED NULL"],
      ["serial_number_snapshot", "VARCHAR(120) NULL"],
      ["main_image_url_snapshot", "LONGTEXT NULL"],
      ["sale_price", "DECIMAL(14,2) NOT NULL DEFAULT 0.00"],
      ["discount_amount", "DECIMAL(14,2) NOT NULL DEFAULT 0.00"],
      ["tax_amount", "DECIMAL(14,2) NOT NULL DEFAULT 0.00"],
      ["total_amount", "DECIMAL(14,2) NOT NULL DEFAULT 0.00"],
      ["deposit_required", "DECIMAL(14,2) NOT NULL DEFAULT 0.00"],
      ["deposit_received", "DECIMAL(14,2) NOT NULL DEFAULT 0.00"],
      ["financed_amount", "DECIMAL(14,2) NOT NULL DEFAULT 0.00"],
      ["scheduled_total", "DECIMAL(14,2) NOT NULL DEFAULT 0.00"],
      ["amount_paid", "DECIMAL(14,2) NOT NULL DEFAULT 0.00"],
      ["late_charges_total", "DECIMAL(14,2) NOT NULL DEFAULT 0.00"],
      ["waived_charges_total", "DECIMAL(14,2) NOT NULL DEFAULT 0.00"],
      ["outstanding_balance", "DECIMAL(14,2) NOT NULL DEFAULT 0.00"],
      ["overdue_amount", "DECIMAL(14,2) NOT NULL DEFAULT 0.00"],
      [
        "payment_frequency",
        "ENUM('weekly','fortnightly','monthly','custom') NULL",
      ],
      ["installment_count", "INT NULL"],
      ["first_due_date", "DATE NULL"],
      ["next_due_date", "DATE NULL"],
      ["final_due_date", "DATE NULL"],
      ["grace_days", "INT NOT NULL DEFAULT 0"],
      [
        "late_charge_type",
        "ENUM('none','fixed','percentage') NOT NULL DEFAULT 'none'",
      ],
      ["late_charge_value", "DECIMAL(14,2) NOT NULL DEFAULT 0.00"],
      [
        "delivery_policy",
        "ENUM('immediate','after_deposit','after_percentage','after_full_payment') NOT NULL DEFAULT 'after_deposit'",
      ],
      ["delivery_threshold_percent", "DECIMAL(7,4) NOT NULL DEFAULT 0.0000"],
      [
        "delivery_status",
        "ENUM('reserved','approved','delivered','cancelled') NOT NULL DEFAULT 'reserved'",
      ],
      [
        "ownership_status",
        "ENUM('retained','conditional','transferred','repossessed') NOT NULL DEFAULT 'retained'",
      ],
      ["delivered_at", "DATETIME NULL"],
      ["completed_at", "DATETIME NULL"],
      ["guarantor_name", "VARCHAR(150) NULL"],
      ["guarantor_phone", "VARCHAR(30) NULL"],
      ["guarantor_location", "VARCHAR(180) NULL"],
      ["guarantor_id_type", "VARCHAR(60) NULL"],
      ["guarantor_id_number", "VARCHAR(120) NULL"],
      ["guarantor_document_url", "LONGTEXT NULL"],
      ["terms_accepted", "BOOLEAN NOT NULL DEFAULT FALSE"],
      ["agreement_notes", "TEXT NULL"],
      ["legacy_installment_agreement_id", "BIGINT NULL"],
      ["created_by", "INT NULL"],
      ["approved_by", "INT NULL"],
      ["approved_at", "DATETIME NULL"],
      ["cancelled_by", "INT NULL"],
      ["cancelled_at", "DATETIME NULL"],
      ["cancellation_reason", "VARCHAR(500) NULL"],
      ["created_at", "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"],
      [
        "updated_at",
        "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
      ],
    ],
    indexes: [
      ["uq_equipment_sale_agreement_number", "`agreement_number`", true],
      [
        "idx_equipment_sale_agreement_location",
        "`hire_location_id`, `agreement_status`, `next_due_date`",
      ],
      ["idx_equipment_sale_agreement_customer", "`customer_id`, `created_at`"],
      [
        "idx_equipment_sale_agreement_asset",
        "`asset_id`, `agreement_status`, `created_at`",
      ],
      [
        "idx_equipment_sale_agreement_approval",
        "`hire_location_id`, `approval_status`, `created_at`",
      ],
      [
        "idx_equipment_sale_agreement_legacy",
        "`legacy_installment_agreement_id`",
      ],
    ],
  },

  equipment_installment_schedule: {
    columns: [
      ["agreement_id", "BIGINT NULL"],
      ["sequence_number", "INT NOT NULL DEFAULT 1"],
      ["due_date", "DATE NULL"],
      ["scheduled_amount", "DECIMAL(14,2) NOT NULL DEFAULT 0.00"],
      ["amount_paid", "DECIMAL(14,2) NOT NULL DEFAULT 0.00"],
      ["late_charge_amount", "DECIMAL(14,2) NOT NULL DEFAULT 0.00"],
      ["waived_charge_amount", "DECIMAL(14,2) NOT NULL DEFAULT 0.00"],
      [
        "schedule_status",
        "ENUM('upcoming','due','partial','paid','overdue','rescheduled','waived','cancelled') NOT NULL DEFAULT 'upcoming'",
      ],
      ["fully_paid_at", "DATETIME NULL"],
      ["created_at", "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"],
      [
        "updated_at",
        "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
      ],
    ],
    indexes: [
      [
        "uq_equipment_installment_schedule",
        "`agreement_id`, `sequence_number`",
        true,
      ],
      ["idx_equipment_installment_due", "`due_date`, `schedule_status`"],
      [
        "idx_equipment_installment_agreement_status",
        "`agreement_id`, `schedule_status`",
      ],
    ],
  },

  equipment_sale_payments: {
    columns: [
      ["payment_number", "VARCHAR(80) NULL"],
      ["receipt_number", "VARCHAR(100) NULL"],
      ["hire_location_id", "INT NULL"],
      ["agreement_id", "BIGINT NULL"],
      ["customer_id", "INT NULL"],
      ["payment_date", "DATETIME NULL"],
      [
        "payment_category",
        "ENUM('deposit','installment','settlement','adjustment','refund') NOT NULL DEFAULT 'installment'",
      ],
      ["amount", "DECIMAL(14,2) NOT NULL DEFAULT 0.00"],
      [
        "payment_method",
        "ENUM('cash','momo','bank','cheque','other') NOT NULL DEFAULT 'cash'",
      ],
      ["reference_number", "VARCHAR(150) NULL"],
      ["notes", "VARCHAR(500) NULL"],
      ["received_by", "INT NULL"],
      ["approved_by", "INT NULL"],
      ["approved_at", "DATETIME NULL"],
      ["is_voided", "BOOLEAN NOT NULL DEFAULT FALSE"],
      ["void_reason", "VARCHAR(500) NULL"],
      ["voided_by", "INT NULL"],
      ["voided_at", "DATETIME NULL"],
      ["created_at", "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"],
    ],
    indexes: [
      ["uq_equipment_sale_payment_number", "`payment_number`", true],
      ["uq_equipment_sale_receipt_number", "`receipt_number`", true],
      [
        "idx_equipment_sale_payment_location",
        "`hire_location_id`, `payment_date`",
      ],
      [
        "idx_equipment_sale_payment_agreement",
        "`agreement_id`, `payment_date`",
      ],
      ["idx_equipment_sale_payment_customer", "`customer_id`, `payment_date`"],
      ["idx_equipment_sale_payment_method", "`payment_method`, `payment_date`"],
    ],
  },

  equipment_sale_payment_allocations: {
    columns: [
      ["payment_id", "BIGINT NULL"],
      ["schedule_id", "BIGINT NULL"],
      ["allocated_amount", "DECIMAL(14,2) NOT NULL DEFAULT 0.00"],
      ["created_at", "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"],
    ],
    indexes: [
      [
        "uq_equipment_sale_payment_schedule",
        "`payment_id`, `schedule_id`",
        true,
      ],
      ["idx_equipment_sale_allocation_schedule", "`schedule_id`"],
    ],
  },

  equipment_deliveries: {
    columns: [
      ["delivery_number", "VARCHAR(80) NULL"],
      ["hire_location_id", "INT NULL"],
      ["agreement_id", "BIGINT NULL"],
      ["customer_id", "INT NULL"],
      ["asset_id", "INT NULL"],
      ["delivery_datetime", "DATETIME NULL"],
      ["destination", "VARCHAR(255) NULL"],
      ["meter_reading", "DECIMAL(14,2) NULL"],
      ["fuel_level_percent", "DECIMAL(7,4) NULL"],
      [
        "condition_status",
        "ENUM('new','excellent','good','fair','poor','damaged') NOT NULL DEFAULT 'good'",
      ],
      ["attachments_tools", "TEXT NULL"],
      ["receiving_person", "VARCHAR(150) NULL"],
      ["receiving_phone", "VARCHAR(30) NULL"],
      ["customer_signature_url", "LONGTEXT NULL"],
      ["delivery_note_url", "LONGTEXT NULL"],
      ["notes", "TEXT NULL"],
      [
        "status",
        "ENUM('draft','approved','delivered','cancelled') NOT NULL DEFAULT 'draft'",
      ],
      ["created_by", "INT NULL"],
      ["approved_by", "INT NULL"],
      ["approved_at", "DATETIME NULL"],
      ["created_at", "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"],
      [
        "updated_at",
        "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
      ],
    ],
    indexes: [
      ["uq_equipment_delivery_number", "`delivery_number`", true],
      ["uq_equipment_delivery_agreement", "`agreement_id`", true],
      [
        "idx_equipment_delivery_location",
        "`hire_location_id`, `delivery_datetime`, `status`",
      ],
      ["idx_equipment_delivery_asset", "`asset_id`, `delivery_datetime`"],
    ],
  },

  equipment_ownership_transfers: {
    columns: [
      ["transfer_number", "VARCHAR(80) NULL"],
      ["hire_location_id", "INT NULL"],
      ["agreement_id", "BIGINT NULL"],
      ["customer_id", "INT NULL"],
      ["asset_id", "INT NULL"],
      ["transfer_date", "DATE NULL"],
      ["ownership_document_url", "LONGTEXT NULL"],
      ["registration_transfer_reference", "VARCHAR(150) NULL"],
      ["notes", "TEXT NULL"],
      ["status", "ENUM('draft','issued','revoked') NOT NULL DEFAULT 'draft'"],
      ["issued_by", "INT NULL"],
      ["issued_at", "DATETIME NULL"],
      ["revoked_by", "INT NULL"],
      ["revoked_at", "DATETIME NULL"],
      ["revocation_reason", "VARCHAR(500) NULL"],
      ["created_at", "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"],
      [
        "updated_at",
        "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
      ],
    ],
    indexes: [
      ["uq_equipment_ownership_transfer_number", "`transfer_number`", true],
      ["uq_equipment_ownership_agreement", "`agreement_id`", true],
      ["uq_equipment_ownership_asset", "`asset_id`", true],
      [
        "idx_equipment_ownership_location",
        "`hire_location_id`, `transfer_date`, `status`",
      ],
      ["idx_equipment_ownership_customer", "`customer_id`, `transfer_date`"],
    ],
  },

  equipment_sales_reminder_log: {
    columns: [
      ["hire_location_id", "INT NULL"],
      ["agreement_id", "BIGINT NULL"],
      ["schedule_id", "BIGINT NULL"],
      ["reminder_key", "VARCHAR(191) NULL"],
      [
        "reminder_type",
        "ENUM('quotation_ready','quotation_expiring','agreement_created','deposit_received','due_soon','due_today','overdue','payment_receipt','delivery_scheduled','delivered','completed','ownership_ready','manual') NOT NULL DEFAULT 'manual'",
      ],
      ["recipient_phone", "VARCHAR(30) NULL"],
      ["sms_log_id", "INT NULL"],
      ["delivery_status", "VARCHAR(40) NOT NULL DEFAULT 'pending'"],
      ["message_preview", "VARCHAR(500) NULL"],
      ["sent_by", "INT NULL"],
      ["sent_at", "DATETIME NULL"],
      ["created_at", "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"],
    ],
    indexes: [
      ["uq_equipment_sales_reminder_key", "`reminder_key`", true],
      [
        "idx_equipment_sales_reminder_agreement",
        "`agreement_id`, `created_at`",
      ],
      ["idx_equipment_sales_reminder_schedule", "`schedule_id`, `created_at`"],
      [
        "idx_equipment_sales_reminder_location",
        "`hire_location_id`, `created_at`",
      ],
    ],
  },

  equipment_legacy_installment_migrations: {
    columns: [
      ["legacy_agreement_id", "BIGINT NULL"],
      ["equipment_agreement_id", "BIGINT NULL"],
      ["asset_id", "INT NULL"],
      ["original_sale_id", "INT NULL"],
      ["original_branch_id", "INT NULL"],
      ["original_amount_paid", "DECIMAL(14,2) NOT NULL DEFAULT 0.00"],
      [
        "original_outstanding_balance",
        "DECIMAL(14,2) NOT NULL DEFAULT 0.00",
      ],
      ["migrated_amount_paid", "DECIMAL(14,2) NOT NULL DEFAULT 0.00"],
      [
        "migrated_outstanding_balance",
        "DECIMAL(14,2) NOT NULL DEFAULT 0.00",
      ],
      [
        "reconciliation_status",
        "ENUM('pending','matched','variance','reversed') NOT NULL DEFAULT 'pending'",
      ],
      ["reconciliation_notes", "TEXT NULL"],
      ["source_snapshot_json", "LONGTEXT NULL"],
      ["migrated_by", "INT NULL"],
      ["migrated_at", "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"],
      ["reviewed_by", "INT NULL"],
      ["reviewed_at", "DATETIME NULL"],
    ],
    indexes: [
      ["uq_equipment_legacy_agreement", "`legacy_agreement_id`", true],
      ["uq_equipment_legacy_equipment", "`equipment_agreement_id`", true],
      ["idx_equipment_legacy_migration_asset", "`asset_id`, `migrated_at`"],
      [
        "idx_equipment_legacy_migration_status",
        "`reconciliation_status`, `migrated_at`",
      ],
    ],
  },
};

function cleanIdentifier(value) {
  const identifier = String(value || "");
  if (!/^[A-Za-z0-9_]+$/.test(identifier)) {
    const error = new Error("Unsafe Equipment Sales database identifier.");
    error.code = "UNSAFE_EQUIPMENT_SALES_IDENTIFIER";
    throw error;
  }
  return identifier;
}

async function tableExists(connection, tableName) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS total
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_TYPE = 'BASE TABLE'
       AND TABLE_NAME = ?`,
    [tableName]
  );
  return Number(rows[0]?.total || 0) === 1;
}

async function loadColumns(connection, tableNames) {
  if (!tableNames.length) return new Map();
  const placeholders = tableNames.map(() => "?").join(",");
  const [rows] = await connection.query(
    `SELECT TABLE_NAME, COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN (${placeholders})`,
    tableNames
  );
  const result = new Map();
  for (const tableName of tableNames) result.set(tableName, new Set());
  for (const row of rows) {
    if (!result.has(row.TABLE_NAME)) result.set(row.TABLE_NAME, new Set());
    result.get(row.TABLE_NAME).add(row.COLUMN_NAME);
  }
  return result;
}

async function loadIndexes(connection, tableNames) {
  if (!tableNames.length) return new Map();
  const placeholders = tableNames.map(() => "?").join(",");
  const [rows] = await connection.query(
    `SELECT TABLE_NAME, INDEX_NAME
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN (${placeholders})`,
    tableNames
  );
  const result = new Map();
  for (const tableName of tableNames) result.set(tableName, new Set());
  for (const row of rows) {
    if (!result.has(row.TABLE_NAME)) result.set(row.TABLE_NAME, new Set());
    result.get(row.TABLE_NAME).add(row.INDEX_NAME);
  }
  return result;
}

function createTableSql(tableName, definition) {
  const safeTable = cleanIdentifier(tableName);
  const columns = [
    "`id` BIGINT AUTO_INCREMENT PRIMARY KEY",
    ...definition.columns.map(
      ([name, sql]) => `\`${cleanIdentifier(name)}\` ${sql}`
    ),
    ...definition.indexes.map(([name, columnsSql, unique = false]) =>
      `${unique ? "UNIQUE KEY" : "INDEX"} \`${cleanIdentifier(name)}\` (${columnsSql})`
    ),
  ];
  return `CREATE TABLE IF NOT EXISTS \`${safeTable}\` (
    ${columns.join(",\n    ")}
  ) ENGINE=InnoDB`;
}

async function ensureMigrationRegistry(connection) {
  await connection.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       id INT AUTO_INCREMENT PRIMARY KEY,
       migration_name VARCHAR(150) NOT NULL UNIQUE,
       applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
       description TEXT NULL,
       INDEX idx_schema_migration_name (migration_name),
       INDEX idx_schema_migration_applied_at (applied_at)
     )`
  );

  const columns = await loadColumns(connection, ["schema_migrations"]);
  if (!columns.get("schema_migrations")?.has("description")) {
    await connection.query(
      "ALTER TABLE schema_migrations ADD COLUMN description TEXT NULL"
    );
  }
}

async function recordMigration(connection) {
  await ensureMigrationRegistry(connection);
  await connection.query(
    `INSERT INTO schema_migrations (migration_name, description)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE description = VALUES(description)`,
    [
      COMMERCIAL_REPAIR_MIGRATION_NAME,
      "Idempotent column-level production repair for Equipment Sales, installments, delivery, ownership and reporting.",
    ]
  );
}

async function assertSupportTables(connection) {
  const missing = [];
  for (const tableName of REQUIRED_SUPPORT_TABLES) {
    if (!(await tableExists(connection, tableName))) missing.push(tableName);
  }
  if (!missing.length) return;

  const error = new Error(
    `Equipment Sales support tables are missing: ${missing.join(", ")}.`
  );
  error.code = "EQUIPMENT_SALES_SUPPORT_TABLES_MISSING";
  error.missingTables = missing;
  throw error;
}

async function createMissingTables(connection) {
  const created = [];
  for (const [tableName, definition] of Object.entries(TABLES)) {
    if (await tableExists(connection, tableName)) continue;
    await connection.query(createTableSql(tableName, definition));
    created.push(tableName);
  }
  return created;
}

async function addMissingColumns(connection) {
  const tableNames = Object.keys(TABLES);
  const columns = await loadColumns(connection, tableNames);
  const repaired = [];

  for (const [tableName, definition] of Object.entries(TABLES)) {
    const existing = columns.get(tableName) || new Set();
    if (!existing.has("id")) {
      const error = new Error(
        `Equipment Sales table ${tableName} exists without its required id column.`
      );
      error.code = "EQUIPMENT_SALES_TABLE_ID_MISSING";
      error.tableName = tableName;
      error.missingColumns = [`${tableName}.id`];
      throw error;
    }

    const additions = definition.columns.filter(([name]) => !existing.has(name));
    if (!additions.length) continue;

    const safeTable = cleanIdentifier(tableName);
    const fragments = additions.map(
      ([name, sql]) => `ADD COLUMN \`${cleanIdentifier(name)}\` ${sql}`
    );
    await connection.query(
      `ALTER TABLE \`${safeTable}\` ${fragments.join(", ")}`
    );
    repaired.push(...additions.map(([name]) => `${tableName}.${name}`));
  }

  return repaired;
}

async function addMissingIndexes(connection) {
  const tableNames = Object.keys(TABLES);
  const indexes = await loadIndexes(connection, tableNames);
  const added = [];
  const warnings = [];

  for (const [tableName, definition] of Object.entries(TABLES)) {
    const existing = indexes.get(tableName) || new Set();
    for (const [name, columnsSql, unique = false] of definition.indexes) {
      if (existing.has(name)) continue;
      try {
        await connection.query(
          `ALTER TABLE \`${cleanIdentifier(tableName)}\`
           ADD ${unique ? "UNIQUE KEY" : "INDEX"} \`${cleanIdentifier(name)}\`
           (${columnsSql})`
        );
        added.push(`${tableName}.${name}`);
      } catch (error) {
        warnings.push({
          table: tableName,
          index: name,
          code: error?.code || "INDEX_REPAIR_PENDING",
          message: error?.message || "Index repair remains pending.",
        });
      }
    }
  }

  return { added, warnings };
}

async function verifyCommercialSalesSchema(connection) {
  const missingTables = [];
  const missingColumns = [];
  const tableNames = Object.keys(TABLES);

  for (const tableName of tableNames) {
    if (!(await tableExists(connection, tableName))) missingTables.push(tableName);
  }

  const existingTables = tableNames.filter(
    (tableName) => !missingTables.includes(tableName)
  );
  const columns = await loadColumns(connection, existingTables);

  for (const tableName of existingTables) {
    const existing = columns.get(tableName) || new Set();
    if (!existing.has("id")) missingColumns.push(`${tableName}.id`);
    for (const [name] of TABLES[tableName].columns) {
      if (!existing.has(name)) missingColumns.push(`${tableName}.${name}`);
    }
  }

  const optionalMissing = [];
  for (const tableName of OPTIONAL_SUPPORT_TABLES) {
    if (!(await tableExists(connection, tableName))) optionalMissing.push(tableName);
  }

  return {
    ready: missingTables.length === 0 && missingColumns.length === 0,
    missing_tables: missingTables,
    missing_columns: missingColumns,
    optional_support_missing: optionalMissing,
  };
}

function safeRepairError(error) {
  return {
    code: error?.code || "EQUIPMENT_SALES_COMMERCIAL_REPAIR_PENDING",
    message: error?.message || "Equipment Sales commercial repair remains pending.",
    table_name: error?.tableName || null,
    missing_tables: error?.missingTables || [],
    missing_columns: error?.missingColumns || [],
  };
}

async function ensureCommercialSalesSchema() {
  const connection = await pool.getConnection();
  let lockAcquired = false;

  try {
    const [lockRows] = await connection.query(
      "SELECT GET_LOCK(?, 60) AS acquired",
      [LOCK_NAME]
    );
    lockAcquired = Number(lockRows[0]?.acquired || 0) === 1;

    if (!lockAcquired) {
      const status = await verifyCommercialSalesSchema(connection);
      if (status.ready) return { ...status, lock_pending: true };
      const error = new Error(
        "Could not acquire the Equipment Sales repair lock while the commercial schema is incomplete."
      );
      error.code = "EQUIPMENT_SALES_COMMERCIAL_REPAIR_LOCK_TIMEOUT";
      error.missingTables = status.missing_tables;
      error.missingColumns = status.missing_columns;
      throw error;
    }

    await assertSupportTables(connection);
    await ensureMigrationRegistry(connection);

    const createdTables = await createMissingTables(connection);
    const repairedColumns = await addMissingColumns(connection);
    const indexResult = await addMissingIndexes(connection);
    const status = await verifyCommercialSalesSchema(connection);

    if (!status.ready) {
      const error = new Error(
        `Equipment Sales commercial schema remains incomplete. Missing tables: ${
          status.missing_tables.join(", ") || "none"
        }. Missing columns: ${status.missing_columns.join(", ") || "none"}.`
      );
      error.code = "EQUIPMENT_SALES_COMMERCIAL_SCHEMA_INCOMPLETE";
      error.missingTables = status.missing_tables;
      error.missingColumns = status.missing_columns;
      throw error;
    }

    await recordMigration(connection);

    return {
      ...status,
      migration_name: COMMERCIAL_REPAIR_MIGRATION_NAME,
      created_tables: createdTables,
      repaired_columns: repairedColumns,
      added_indexes: indexResult.added,
      index_warnings: indexResult.warnings,
    };
  } finally {
    if (lockAcquired) {
      try {
        await connection.query("SELECT RELEASE_LOCK(?)", [LOCK_NAME]);
      } catch (error) {
        console.warn(
          "Could not release Equipment Sales commercial repair lock:",
          error.message
        );
      }
    }
    connection.release();
  }
}

module.exports = {
  COMMERCIAL_REPAIR_MIGRATION_NAME,
  TABLES,
  ensureCommercialSalesSchema,
  safeRepairError,
  verifyCommercialSalesSchema,
};
