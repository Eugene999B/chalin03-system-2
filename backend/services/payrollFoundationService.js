const crypto = require("node:crypto");

const { pool } = require("../config/db");
const { normalizeCategory } = require("./categoryIsolationService");

const PAYROLL_TABLES = Object.freeze([
  "payroll_statutory_rule_versions",
  "payroll_compensation_profiles",
  "payroll_recurring_components",
  "payroll_periods",
  "payroll_entries",
  "payroll_entry_lines",
  "payroll_salary_payments",
  "payroll_adjustment_requests",
  "payroll_worker_loans",
  "payroll_loan_transactions",
  "payroll_payslips",
]);

class PayrollFoundationError extends Error {
  constructor(statusCode, message, code = "PAYROLL_FOUNDATION_ERROR") {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function cleanText(value, maxLength = 255) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function positiveId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function dateOnly(value) {
  const text = cleanText(value, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) return null;
  return text;
}

function previousDate(dateText) {
  const parsed = new Date(`${dateText}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return parsed.toISOString().slice(0, 10);
}

function money(value, { allowZero = true } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const rounded = Number(number.toFixed(2));
  if (rounded < 0 || (!allowZero && rounded <= 0)) return null;
  return rounded;
}

function normalizeWorkspace(value) {
  return normalizeCategory(value);
}

function normalizeComponent(component, index) {
  const componentType = cleanText(component?.component_type, 40).toLowerCase();
  const calculationType = cleanText(component?.calculation_type || "fixed", 40).toLowerCase();
  const code = cleanText(component?.component_code, 80).toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  const name = cleanText(component?.component_name, 180);
  const amountValue = Number(component?.amount_value);
  if (!code || !name) {
    throw new PayrollFoundationError(400, `Payroll component ${index + 1} requires a code and name.`, "PAYROLL_COMPONENT_IDENTITY_REQUIRED");
  }
  if (!["earning", "deduction", "employer_contribution"].includes(componentType)) {
    throw new PayrollFoundationError(400, `Payroll component ${code} has an unsupported type.`, "PAYROLL_COMPONENT_TYPE_INVALID");
  }
  if (!["fixed", "percentage_of_basic"].includes(calculationType)) {
    throw new PayrollFoundationError(400, `Payroll component ${code} has an unsupported calculation type.`, "PAYROLL_COMPONENT_CALCULATION_INVALID");
  }
  if (!Number.isFinite(amountValue) || amountValue < 0 || (calculationType === "percentage_of_basic" && amountValue > 1000)) {
    throw new PayrollFoundationError(400, `Payroll component ${code} has an invalid amount or percentage.`, "PAYROLL_COMPONENT_AMOUNT_INVALID");
  }
  return {
    component_code: code,
    component_name: name,
    component_type: componentType,
    calculation_type: calculationType,
    amount_value: Number(amountValue.toFixed(4)),
    taxable: Boolean(component?.taxable),
    pensionable: Boolean(component?.pensionable),
    display_order: Number.isInteger(Number(component?.display_order)) ? Number(component.display_order) : index,
    notes: cleanText(component?.notes, 1000) || null,
  };
}

function normalizeComponents(values) {
  const components = Array.isArray(values) ? values.map(normalizeComponent) : [];
  const codes = new Set();
  for (const component of components) {
    if (codes.has(component.component_code)) {
      throw new PayrollFoundationError(400, `Payroll component code ${component.component_code} appears more than once.`, "PAYROLL_COMPONENT_DUPLICATE");
    }
    codes.add(component.component_code);
  }
  return components;
}

async function schemaStatus(connection = pool) {
  const [rows] = await connection.query(
    `SELECT TABLE_NAME
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN (${PAYROLL_TABLES.map(() => "?").join(", ")})`,
    PAYROLL_TABLES
  );
  const existing = new Set(rows.map((row) => String(row.TABLE_NAME)));
  const missing = PAYROLL_TABLES.filter((name) => !existing.has(name));
  return {
    ready: missing.length === 0,
    required_tables: PAYROLL_TABLES,
    missing_tables: missing,
    migration: "20260810_payroll_financial_foundation.sql",
  };
}

async function assertSchemaReady(connection = pool) {
  const readiness = await schemaStatus(connection);
  if (!readiness.ready) {
    const error = new PayrollFoundationError(
      503,
      "Payroll financial foundation is awaiting the approved additive migration.",
      "PAYROLL_FOUNDATION_MIGRATION_REQUIRED"
    );
    error.readiness = readiness;
    throw error;
  }
  return readiness;
}

async function loadWorkerForWorkspace(connection, workerId, workspaceCode, { lock = false } = {}) {
  const id = positiveId(workerId);
  const workspace = normalizeWorkspace(workspaceCode);
  if (!id || !workspace) {
    throw new PayrollFoundationError(400, "Choose a valid worker and business category.", "PAYROLL_WORKER_INVALID");
  }
  const [rows] = await connection.query(
    `SELECT id, employee_number, full_name, workspace_code, employment_status,
            employment_start_date, employment_end_date, job_title, department
     FROM worker_profiles
     WHERE id = ?
       AND workspace_code = ?
     LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [id, workspace]
  );
  if (!rows[0]) {
    throw new PayrollFoundationError(
      404,
      "That worker does not belong to the active business category.",
      "PAYROLL_WORKER_CATEGORY_MISMATCH"
    );
  }
  return rows[0];
}

async function compensationHistory({ workerId, workspaceCode, connection = pool }) {
  await assertSchemaReady(connection);
  const worker = await loadWorkerForWorkspace(connection, workerId, workspaceCode);
  const [profiles] = await connection.query(
    `SELECT profile.*,
            creator.full_name AS created_by_name,
            submitter.full_name AS submitted_by_name,
            approver.full_name AS approved_by_name
     FROM payroll_compensation_profiles profile
     LEFT JOIN users creator ON creator.id = profile.created_by
     LEFT JOIN users submitter ON submitter.id = profile.submitted_by
     LEFT JOIN users approver ON approver.id = profile.approved_by
     WHERE profile.worker_id = ?
       AND profile.workspace_code = ?
     ORDER BY profile.effective_from DESC, profile.id DESC`,
    [worker.id, worker.workspace_code]
  );
  if (!profiles.length) return { worker, profiles: [] };
  const ids = profiles.map((profile) => profile.id);
  const [components] = await connection.query(
    `SELECT *
     FROM payroll_recurring_components
     WHERE compensation_profile_id IN (${ids.map(() => "?").join(", ")})
     ORDER BY compensation_profile_id, display_order, id`,
    ids
  );
  const byProfile = new Map();
  for (const component of components) {
    if (!byProfile.has(component.compensation_profile_id)) byProfile.set(component.compensation_profile_id, []);
    byProfile.get(component.compensation_profile_id).push(component);
  }
  return {
    worker,
    profiles: profiles.map((profile) => ({
      ...profile,
      components: byProfile.get(profile.id) || [],
    })),
  };
}

async function createCompensationDraft({ workerId, workspaceCode, input, actorId }) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await assertSchemaReady(connection);
    const worker = await loadWorkerForWorkspace(connection, workerId, workspaceCode, { lock: true });
    const effectiveFrom = dateOnly(input?.effective_from);
    const basicSalary = money(input?.basic_salary, { allowZero: false });
    const reason = cleanText(input?.change_reason, 1000);
    const payFrequency = cleanText(input?.pay_frequency || "monthly", 30).toLowerCase();
    const components = normalizeComponents(input?.components);
    if (!effectiveFrom || basicSalary === null || reason.length < 8) {
      throw new PayrollFoundationError(
        400,
        "Effective date, positive basic salary and a detailed change reason are required.",
        "PAYROLL_COMPENSATION_INPUT_INVALID"
      );
    }
    if (!["monthly", "weekly", "biweekly"].includes(payFrequency)) {
      throw new PayrollFoundationError(400, "Choose a supported pay frequency.", "PAYROLL_PAY_FREQUENCY_INVALID");
    }
    const [duplicateRows] = await connection.query(
      `SELECT id
       FROM payroll_compensation_profiles
       WHERE worker_id = ? AND effective_from = ?
       LIMIT 1 FOR UPDATE`,
      [worker.id, effectiveFrom]
    );
    if (duplicateRows.length) {
      throw new PayrollFoundationError(409, "A compensation profile already begins on that date.", "PAYROLL_COMPENSATION_DATE_DUPLICATE");
    }
    const [result] = await connection.query(
      `INSERT INTO payroll_compensation_profiles (
         worker_id, workspace_code, effective_from, currency_code, pay_frequency,
         basic_salary, status, change_reason, created_by
       ) VALUES (?, ?, ?, 'GHS', ?, ?, 'draft', ?, ?)`,
      [worker.id, worker.workspace_code, effectiveFrom, payFrequency, basicSalary, reason, actorId]
    );
    for (const component of components) {
      await connection.query(
        `INSERT INTO payroll_recurring_components (
           compensation_profile_id, component_code, component_name, component_type,
           calculation_type, amount_value, taxable, pensionable, display_order, notes
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          result.insertId,
          component.component_code,
          component.component_name,
          component.component_type,
          component.calculation_type,
          component.amount_value,
          component.taxable,
          component.pensionable,
          component.display_order,
          component.notes,
        ]
      );
    }
    await connection.commit();
    return { worker, profile_id: result.insertId };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function submitCompensationProfile({ profileId, workspaceCode, actorId }) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await assertSchemaReady(connection);
    const [rows] = await connection.query(
      `SELECT profile.*, worker.workspace_code AS worker_workspace_code
       FROM payroll_compensation_profiles profile
       INNER JOIN worker_profiles worker ON worker.id = profile.worker_id
       WHERE profile.id = ? AND profile.workspace_code = ? AND worker.workspace_code = profile.workspace_code
       LIMIT 1 FOR UPDATE`,
      [positiveId(profileId), normalizeWorkspace(workspaceCode)]
    );
    const profile = rows[0];
    if (!profile) throw new PayrollFoundationError(404, "Compensation profile not found in this business category.", "PAYROLL_COMPENSATION_NOT_FOUND");
    if (profile.status !== "draft") throw new PayrollFoundationError(409, "Only a draft compensation profile can be submitted.", "PAYROLL_COMPENSATION_NOT_DRAFT");
    await connection.query(
      `UPDATE payroll_compensation_profiles
       SET status = 'pending_approval', submitted_by = ?, submitted_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [actorId, profile.id]
    );
    await connection.commit();
    return { ...profile, status: "pending_approval", submitted_by: actorId };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function approveCompensationProfile({ profileId, workspaceCode, actorId }) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await assertSchemaReady(connection);
    const workspace = normalizeWorkspace(workspaceCode);
    const [rows] = await connection.query(
      `SELECT profile.*, worker.workspace_code AS worker_workspace_code
       FROM payroll_compensation_profiles profile
       INNER JOIN worker_profiles worker ON worker.id = profile.worker_id
       WHERE profile.id = ? AND profile.workspace_code = ? AND worker.workspace_code = profile.workspace_code
       LIMIT 1 FOR UPDATE`,
      [positiveId(profileId), workspace]
    );
    const profile = rows[0];
    if (!profile) throw new PayrollFoundationError(404, "Compensation profile not found in this business category.", "PAYROLL_COMPENSATION_NOT_FOUND");
    if (profile.status !== "pending_approval") throw new PayrollFoundationError(409, "Only a pending compensation profile can be approved.", "PAYROLL_COMPENSATION_NOT_PENDING");
    if (Number(profile.created_by) === Number(actorId) || Number(profile.submitted_by) === Number(actorId)) {
      throw new PayrollFoundationError(
        409,
        "The person who prepared or submitted this salary change cannot approve it.",
        "PAYROLL_PROFILE_SELF_APPROVAL_FORBIDDEN"
      );
    }
    const [futureRows] = await connection.query(
      `SELECT id, effective_from, effective_to
       FROM payroll_compensation_profiles
       WHERE worker_id = ?
         AND status = 'approved'
         AND id <> ?
         AND effective_from >= ?
       ORDER BY effective_from ASC
       LIMIT 1 FOR UPDATE`,
      [profile.worker_id, profile.id, profile.effective_from]
    );
    if (futureRows.length) {
      throw new PayrollFoundationError(409, "An approved compensation period already starts on or after this effective date.", "PAYROLL_COMPENSATION_FUTURE_CONFLICT");
    }
    const [currentRows] = await connection.query(
      `SELECT id, effective_from, effective_to
       FROM payroll_compensation_profiles
       WHERE worker_id = ?
         AND status = 'approved'
         AND id <> ?
         AND effective_from < ?
         AND (effective_to IS NULL OR effective_to >= ?)
       ORDER BY effective_from DESC
       LIMIT 1 FOR UPDATE`,
      [profile.worker_id, profile.id, profile.effective_from, profile.effective_from]
    );
    const superseded = currentRows[0] || null;
    if (superseded) {
      const closedOn = previousDate(profile.effective_from);
      if (closedOn < String(superseded.effective_from).slice(0, 10)) {
        throw new PayrollFoundationError(409, "The new salary effective date overlaps the existing approved history.", "PAYROLL_COMPENSATION_OVERLAP");
      }
      await connection.query(
        `UPDATE payroll_compensation_profiles
         SET effective_to = ?, superseded_by_profile_id = ?
         WHERE id = ?`,
        [closedOn, profile.id, superseded.id]
      );
    }
    await connection.query(
      `UPDATE payroll_compensation_profiles
       SET status = 'approved', approved_by = ?, approved_at = CURRENT_TIMESTAMP,
           supersedes_profile_id = ?
       WHERE id = ?`,
      [actorId, superseded?.id || null, profile.id]
    );
    await connection.commit();
    return {
      ...profile,
      status: "approved",
      approved_by: actorId,
      supersedes_profile_id: superseded?.id || null,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function listStatutoryRules({ workspaceCode, connection = pool }) {
  await assertSchemaReady(connection);
  const scope = normalizeWorkspace(workspaceCode);
  const [rows] = await connection.query(
    `SELECT rule.*, creator.full_name AS created_by_name, approver.full_name AS approved_by_name
     FROM payroll_statutory_rule_versions rule
     LEFT JOIN users creator ON creator.id = rule.created_by
     LEFT JOIN users approver ON approver.id = rule.approved_by
     WHERE rule.scope_code IN ('group', ?)
     ORDER BY rule.rule_code, rule.effective_from DESC, rule.id DESC`,
    [scope]
  );
  return rows.map((row) => ({
    ...row,
    configuration: typeof row.configuration_json === "string" ? JSON.parse(row.configuration_json || "{}") : row.configuration_json,
    configuration_json: undefined,
  }));
}

async function createStatutoryRuleDraft({ workspaceCode, input, actorId, allowGroup = false }) {
  await assertSchemaReady();
  const workspace = normalizeWorkspace(workspaceCode);
  const requestedScope = cleanText(input?.scope_code || workspace, 50).toLowerCase();
  const scopeCode = requestedScope === "group" && allowGroup ? "group" : workspace;
  const ruleCode = cleanText(input?.rule_code, 80).toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  const versionLabel = cleanText(input?.version_label, 120);
  const effectiveFrom = dateOnly(input?.effective_from);
  const effectiveTo = input?.effective_to ? dateOnly(input.effective_to) : null;
  const reason = cleanText(input?.change_reason, 1000);
  const configuration = input?.configuration;
  if (!scopeCode || !ruleCode || !versionLabel || !effectiveFrom || reason.length < 8 || !configuration || typeof configuration !== "object" || Array.isArray(configuration)) {
    throw new PayrollFoundationError(400, "Rule code, version, effective date, configuration object and detailed reason are required.", "PAYROLL_STATUTORY_RULE_INPUT_INVALID");
  }
  if (effectiveTo && effectiveTo < effectiveFrom) {
    throw new PayrollFoundationError(400, "Statutory rule end date cannot precede its start date.", "PAYROLL_STATUTORY_RULE_DATE_INVALID");
  }
  const [result] = await pool.query(
    `INSERT INTO payroll_statutory_rule_versions (
       scope_code, jurisdiction_code, rule_code, version_label, effective_from, effective_to,
       status, configuration_json, change_reason, created_by
     ) VALUES (?, 'GH', ?, ?, ?, ?, 'draft', ?, ?, ?)`,
    [scopeCode, ruleCode, versionLabel, effectiveFrom, effectiveTo, JSON.stringify(configuration), reason, actorId]
  );
  return { id: result.insertId, scope_code: scopeCode, rule_code: ruleCode, version_label: versionLabel, status: "draft" };
}

async function createPayrollPeriod({ workspaceCode, input, actorId }) {
  await assertSchemaReady();
  const workspace = normalizeWorkspace(workspaceCode);
  const periodCode = cleanText(input?.period_code, 20).toUpperCase();
  const periodStart = dateOnly(input?.period_start);
  const periodEnd = dateOnly(input?.period_end);
  const payDate = input?.scheduled_pay_date ? dateOnly(input.scheduled_pay_date) : null;
  if (!workspace || !periodCode || !periodStart || !periodEnd || periodEnd < periodStart) {
    throw new PayrollFoundationError(400, "Payroll period code and a valid start/end date range are required.", "PAYROLL_PERIOD_INPUT_INVALID");
  }
  const [result] = await pool.query(
    `INSERT INTO payroll_periods (
       workspace_code, period_code, period_start, period_end, scheduled_pay_date,
       status, notes, prepared_by
     ) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)`,
    [workspace, periodCode, periodStart, periodEnd, payDate, cleanText(input?.notes, 2000) || null, actorId]
  );
  return { id: result.insertId, workspace_code: workspace, period_code: periodCode, status: "draft" };
}

async function listPayrollPeriods({ workspaceCode, connection = pool }) {
  await assertSchemaReady(connection);
  const workspace = normalizeWorkspace(workspaceCode);
  const [rows] = await connection.query(
    `SELECT period.*, preparer.full_name AS prepared_by_name, approver.full_name AS approved_by_name
     FROM payroll_periods period
     LEFT JOIN users preparer ON preparer.id = period.prepared_by
     LEFT JOIN users approver ON approver.id = period.approved_by
     WHERE period.workspace_code = ?
     ORDER BY period.period_start DESC, period.id DESC
     LIMIT 120`,
    [workspace]
  );
  return rows;
}

function checksumSnapshot(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
}

module.exports = {
  PAYROLL_TABLES,
  PayrollFoundationError,
  normalizeComponents,
  schemaStatus,
  assertSchemaReady,
  loadWorkerForWorkspace,
  compensationHistory,
  createCompensationDraft,
  submitCompensationProfile,
  approveCompensationProfile,
  listStatutoryRules,
  createStatutoryRuleDraft,
  createPayrollPeriod,
  listPayrollPeriods,
  checksumSnapshot,
};
