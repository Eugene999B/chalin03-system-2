const WORKSPACE = "equipment_installment_finance";

function positiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function exists(db, table) {
  const [[row]] = await db.query(
    "SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?",
    [table]
  );
  return Number(row?.n || 0) === 1;
}

async function ensureOwnershipTable(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS installment_reset_ownership (
    id INT AUTO_INCREMENT PRIMARY KEY,
    workspace_code VARCHAR(100) NOT NULL,
    entity_type VARCHAR(40) NOT NULL,
    entity_id BIGINT NOT NULL,
    evidence_source VARCHAR(120) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_installment_reset_owner (workspace_code, entity_type, entity_id),
    INDEX idx_installment_reset_owner_entity (entity_type, entity_id)
  )`);
}

async function recoverCustomers(db) {
  if (!(await exists(db, "hire_customers"))) return 0;
  const [rows] = await db.query(
    "SELECT id FROM hire_customers WHERE UPPER(COALESCE(customer_code,'')) LIKE 'FCUS-%'"
  );
  let count = 0;
  for (const row of rows) {
    const id = positiveId(row.id);
    if (!id) continue;
    const [result] = await db.query(
      "INSERT IGNORE INTO installment_reset_ownership (workspace_code,entity_type,entity_id,evidence_source) VALUES (?, 'customer', ?, 'legacy_finance_customer_code')",
      [WORKSPACE, id]
    );
    count += Number(result.affectedRows || 0);
  }
  return count;
}

async function recoverAssets(db) {
  if (!(await exists(db, "activity_log")) || !(await exists(db, "fleet_assets"))) return 0;
  const [rows] = await db.query(
    "SELECT DISTINCT CAST(entity_id AS UNSIGNED) AS id FROM activity_log WHERE entity_type='fleet_asset' AND entity_id REGEXP '^[0-9]+$' AND (workspace_code=? OR action_type IN ('equipment.finance.machine.register','EQUIPMENT_FINANCE_MACHINE_REGISTERED','equipment.finance.machine.registered') OR action IN ('equipment.finance.machine.register','EQUIPMENT_FINANCE_MACHINE_REGISTERED','equipment.finance.machine.registered'))",
    [WORKSPACE]
  );
  let count = 0;
  for (const row of rows) {
    const id = positiveId(row.id);
    if (!id) continue;
    const [result] = await db.query(
      "INSERT IGNORE INTO installment_reset_ownership (workspace_code,entity_type,entity_id,evidence_source) VALUES (?, 'fleet_asset', ?, 'legacy_finance_machine_registration')",
      [WORKSPACE, id]
    );
    count += Number(result.affectedRows || 0);
  }
  return count;
}

async function recoverInstallmentLegacyTrialOwnership({ connection, logger = console } = {}) {
  if (!connection) throw new Error("A database connection is required.");
  await ensureOwnershipTable(connection);
  const customers = await recoverCustomers(connection);
  const assets = await recoverAssets(connection);
  logger.info?.(`Installment legacy ownership recovery: ${customers} customers, ${assets} excavators.`);
  return { customers, assets };
}

module.exports = { recoverInstallmentLegacyTrialOwnership };
