const crypto = require("node:crypto");

const { pool } = require("../config/db");
const { nextDocumentNumber } = require("./groupConfigurationService");
const {
  PayrollFoundationError,
  assertSchemaReady,
  checksumSnapshot,
} = require("./payrollFoundationService");

const PAYMENT_METHODS = new Set(["cash", "momo", "bank", "cheque", "other"]);
const DECISIONS = new Set(["approve", "reject"]);
const STATUTORY_LINE_TYPES = new Set(["deduction", "employer_contribution"]);
const STATUTORY_CALCULATIONS = new Set(["percentage", "fixed", "progressive_bands"]);

function cleanText(value, maxLength = 1000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function positiveId(value, label = "ID") {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new PayrollFoundationError(400, `${label} must be a positive whole number.`, "PAYROLL_IDENTIFIER_INVALID");
  }
  return number;
}

function dateOnly(value) {
  const text = cleanText(value, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const parsed = new Date(`${text}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text ? text : null;
}

function previousDate(value) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return parsed.toISOString().slice(0, 10);
}

function money(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(2)) : 0;
}

function positiveMoney(value) {
  const number = money(value);
  return number > 0 ? number : null;
}

function dateValue(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function inclusiveDays(startText, endText) {
  const start = new Date(`${startText}T00:00:00.000Z`);
  const end = new Date(`${endText}T00:00:00.000Z`);
  return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
}

function overlapDays(startA, endA, startB, endB) {
  const start = startA > startB ? startA : startB;
  const end = endA < endB ? endA : endB;
  return end < start ? 0 : inclusiveDays(start, end);
}

function parseJson(value, fallback = {}) {
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(String(value || "{}"));
  } catch {
    return fallback;
  }
}

function normalizeRuleConfiguration(rule) {
  const configuration = parseJson(rule?.configuration_json ?? rule?.configuration, {});
  const calculationType = cleanText(configuration.calculation_type, 40).toLowerCase();
  const lineType = cleanText(configuration.line_type, 40).toLowerCase();
  const lineCode = cleanText(configuration.line_code || rule?.rule_code, 80)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_");
  const lineName = cleanText(configuration.line_name || rule?.rule_code, 180);
  const basis = cleanText(configuration.basis || "gross_earnings", 50).toLowerCase();

  if (!STATUTORY_CALCULATIONS.has(calculationType)) {
    throw new PayrollFoundationError(
      409,
      `Approved statutory rule ${rule?.rule_code || "unknown"} has an unsupported calculation type.`,
      "PAYROLL_STATUTORY_RULE_CONFIGURATION_INVALID"
    );
  }
  if (!STATUTORY_LINE_TYPES.has(lineType) || !lineCode || !lineName) {
    throw new PayrollFoundationError(
      409,
      `Approved statutory rule ${rule?.rule_code || "unknown"} does not define a valid payroll line.`,
      "PAYROLL_STATUTORY_RULE_CONFIGURATION_INVALID"
    );
  }

  const normalized = {
    calculation_type: calculationType,
    line_type: lineType,
    line_code: lineCode,
    line_name: lineName,
    basis,
  };

  if (calculationType === "percentage") {
    const rate = Number(configuration.rate_percent);
    if (!Number.isFinite(rate) || rate < 0 || rate > 1000) {
      throw new PayrollFoundationError(409, `Approved statutory rule ${rule.rule_code} has an invalid rate.`, "PAYROLL_STATUTORY_RULE_CONFIGURATION_INVALID");
    }
    normalized.rate_percent = Number(rate.toFixed(6));
    normalized.cap_amount = configuration.cap_amount === undefined || configuration.cap_amount === null || configuration.cap_amount === ""
      ? null
      : money(configuration.cap_amount);
  } else if (calculationType === "fixed") {
    const amount = Number(configuration.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new PayrollFoundationError(409, `Approved statutory rule ${rule.rule_code} has an invalid fixed amount.`, "PAYROLL_STATUTORY_RULE_CONFIGURATION_INVALID");
    }
    normalized.amount = money(amount);
  } else {
    const bands = Array.isArray(configuration.bands) ? configuration.bands : [];
    if (!bands.length) {
      throw new PayrollFoundationError(409, `Approved statutory rule ${rule.rule_code} has no progressive bands.`, "PAYROLL_STATUTORY_RULE_CONFIGURATION_INVALID");
    }
    let previous = 0;
    normalized.bands = bands.map((band, index) => {
      const rate = Number(band?.rate_percent);
      const upper = band?.up_to === null || band?.up_to === undefined || band?.up_to === "" ? null : Number(band.up_to);
      if (!Number.isFinite(rate) || rate < 0 || rate > 1000 || (upper !== null && (!Number.isFinite(upper) || upper <= previous))) {
        throw new PayrollFoundationError(409, `Approved statutory rule ${rule.rule_code} has an invalid progressive band at position ${index + 1}.`, "PAYROLL_STATUTORY_RULE_CONFIGURATION_INVALID");
      }
      if (upper !== null) previous = upper;
      return { up_to: upper === null ? null : money(upper), rate_percent: Number(rate.toFixed(6)) };
    });
    if (normalized.bands.slice(0, -1).some((band) => band.up_to === null)) {
      throw new PayrollFoundationError(409, `Approved statutory rule ${rule.rule_code} has an open-ended band before its final band.`, "PAYROLL_STATUTORY_RULE_CONFIGURATION_INVALID");
    }
  }

  return normalized;
}

function statutoryBasis(configuration, context) {
  if (configuration.basis === "basic_earned") return context.basic_earned;
  if (configuration.basis === "taxable_gross") return context.taxable_gross;
  return context.gross_earnings;
}

function progressiveAmount(basis, bands) {
  let previousUpper = 0;
  let total = 0;
  for (const band of bands) {
    const upper = band.up_to;
    const slice = upper === null
      ? Math.max(basis - previousUpper, 0)
      : Math.max(Math.min(basis, upper) - previousUpper, 0);
    if (slice > 0) total += slice * (Number(band.rate_percent || 0) / 100);
    if (upper === null || basis <= upper) break;
    previousUpper = upper;
  }
  return money(total);
}

function evaluateStatutoryRule(rule, context) {
  const configuration = normalizeRuleConfiguration(rule);
  const basis = money(statutoryBasis(configuration, context));
  let amount = 0;
  if (configuration.calculation_type === "percentage") {
    amount = basis * (configuration.rate_percent / 100);
    if (configuration.cap_amount !== null) amount = Math.min(amount, configuration.cap_amount);
    amount = money(amount);
  } else if (configuration.calculation_type === "fixed") {
    amount = configuration.amount;
  } else {
    amount = progressiveAmount(basis, configuration.bands);
  }
  return {
    line_code: configuration.line_code,
    line_name: configuration.line_name,
    line_type: configuration.line_type,
    source_type: "statutory_rule",
    source_reference: String(rule.id),
    quantity: null,
    rate: configuration.calculation_type === "percentage" ? configuration.rate_percent : null,
    amount,
    metadata: {
      rule_id: rule.id,
      rule_code: rule.rule_code,
      version_label: rule.version_label,
      scope_code: rule.scope_code,
      configuration,
      calculation_basis: basis,
    },
  };
}

function payCycleDays(payFrequency, periodDays) {
  if (payFrequency === "weekly") return 7;
  if (payFrequency === "biweekly") return 14;
  return periodDays;
}

function calculateRecurringComponent(component, basicEarned, prorationFactor) {
  const calculationType = cleanText(component.calculation_type, 40).toLowerCase();
  const raw = Number(component.amount_value || 0);
  const amount = calculationType === "percentage_of_basic"
    ? basicEarned * (raw / 100)
    : raw * prorationFactor;
  return {
    line_code: component.component_code,
    line_name: component.component_name,
    line_type: component.component_type,
    source_type: "recurring_component",
    source_reference: String(component.id),
    quantity: null,
    rate: calculationType === "percentage_of_basic" ? raw : null,
    amount: money(amount),
    metadata: {
      calculation_type: calculationType,
      taxable: Boolean(component.taxable),
      pensionable: Boolean(component.pensionable),
    },
  };
}

function calculatePayrollEntry({ worker, profile, components = [], statutoryRules = [], period }) {
  const periodStart = dateValue(period.period_start);
  const periodEnd = dateValue(period.period_end);
  const employmentStart = dateValue(worker.employment_start_date) || periodStart;
  const employmentEnd = dateValue(worker.employment_end_date) || periodEnd;
  const periodDays = inclusiveDays(periodStart, periodEnd);
  const payableDays = overlapDays(periodStart, periodEnd, employmentStart, employmentEnd);
  const cycleDays = payCycleDays(profile.pay_frequency, periodDays);
  const prorationFactor = cycleDays > 0 ? payableDays / cycleDays : 0;
  const basicEarned = money(Number(profile.basic_salary || 0) * prorationFactor);

  const recurringLines = components.map((component) =>
    calculateRecurringComponent(component, basicEarned, prorationFactor)
  );
  const recurringEarnings = recurringLines
    .filter((line) => line.line_type === "earning")
    .reduce((sum, line) => sum + line.amount, 0);
  const recurringDeductions = recurringLines
    .filter((line) => line.line_type === "deduction")
    .reduce((sum, line) => sum + line.amount, 0);
  const recurringEmployer = recurringLines
    .filter((line) => line.line_type === "employer_contribution")
    .reduce((sum, line) => sum + line.amount, 0);
  const taxableRecurringEarnings = recurringLines
    .filter((line) => line.line_type === "earning" && line.metadata.taxable)
    .reduce((sum, line) => sum + line.amount, 0);
  const grossEarnings = money(basicEarned + recurringEarnings);
  const context = {
    basic_earned: basicEarned,
    gross_earnings: grossEarnings,
    taxable_gross: money(basicEarned + taxableRecurringEarnings),
  };
  const statutoryLines = statutoryRules.map((rule) => evaluateStatutoryRule(rule, context));
  const statutoryDeductions = statutoryLines
    .filter((line) => line.line_type === "deduction")
    .reduce((sum, line) => sum + line.amount, 0);
  const statutoryEmployer = statutoryLines
    .filter((line) => line.line_type === "employer_contribution")
    .reduce((sum, line) => sum + line.amount, 0);
  const totalDeductions = money(recurringDeductions + statutoryDeductions);
  const employerContributions = money(recurringEmployer + statutoryEmployer);
  const netSalary = money(grossEarnings - totalDeductions);

  const basicLine = {
    line_code: "basic_salary",
    line_name: "Basic salary",
    line_type: "earning",
    source_type: "compensation_profile",
    source_reference: String(profile.id),
    quantity: payableDays,
    rate: money(profile.basic_salary),
    amount: basicEarned,
    metadata: { pay_frequency: profile.pay_frequency, period_days: periodDays, payable_days: payableDays },
  };
  const lines = [basicLine, ...recurringLines, ...statutoryLines].map((line, index) => ({
    ...line,
    display_order: index,
  }));

  return {
    employment_days: periodDays,
    payable_days: payableDays,
    basic_earned: basicEarned,
    gross_earnings: grossEarnings,
    total_deductions: totalDeductions,
    employer_contributions: employerContributions,
    net_salary: netSalary,
    amount_paid: 0,
    remaining_balance: Math.max(netSalary, 0),
    lines,
  };
}

async function getPeriod(connection, periodId, workspaceCode, { lock = false } = {}) {
  const id = positiveId(periodId, "Payroll period ID");
  const [rows] = await connection.query(
    `SELECT * FROM payroll_periods
     WHERE id = ? AND workspace_code = ?
     LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [id, workspaceCode]
  );
  if (!rows[0]) {
    throw new PayrollFoundationError(404, "Payroll period was not found in this business category.", "PAYROLL_PERIOD_NOT_FOUND");
  }
  return rows[0];
}

async function approvedStatutoryRules(connection, workspaceCode, periodStart, periodEnd) {
  const [rows] = await connection.query(
    `SELECT *
     FROM payroll_statutory_rule_versions
     WHERE status = 'approved'
       AND scope_code IN ('group', ?)
       AND effective_from <= ?
       AND (effective_to IS NULL OR effective_to >= ?)
     ORDER BY rule_code, CASE WHEN scope_code = ? THEN 0 ELSE 1 END, effective_from DESC, id DESC`,
    [workspaceCode, periodStart, periodEnd, workspaceCode]
  );
  const selected = new Map();
  for (const row of rows) {
    if (!selected.has(row.rule_code)) selected.set(row.rule_code, row);
  }
  return [...selected.values()].map((row) => ({
    ...row,
    configuration: normalizeRuleConfiguration(row),
  }));
}

async function workerCandidates(connection, workspaceCode, periodStart, periodEnd) {
  const [workers] = await connection.query(
    `SELECT id, employee_number, full_name, workspace_code, employment_status,
            employment_start_date, employment_end_date, job_title, department
     FROM worker_profiles
     WHERE workspace_code = ?
       AND (employment_start_date IS NULL OR employment_start_date <= ?)
       AND (employment_end_date IS NULL OR employment_end_date >= ?)
     ORDER BY full_name, id`,
    [workspaceCode, periodEnd, periodStart]
  );
  return workers;
}

async function profilesForWorker(connection, workerId, workspaceCode, periodStart, periodEnd) {
  const [profiles] = await connection.query(
    `SELECT *
     FROM payroll_compensation_profiles
     WHERE worker_id = ?
       AND workspace_code = ?
       AND status = 'approved'
       AND effective_from <= ?
       AND (effective_to IS NULL OR effective_to >= ?)
     ORDER BY effective_from, id`,
    [workerId, workspaceCode, periodEnd, periodStart]
  );
  if (!profiles.length) return [];
  const ids = profiles.map((profile) => profile.id);
  const [components] = await connection.query(
    `SELECT * FROM payroll_recurring_components
     WHERE compensation_profile_id IN (${ids.map(() => "?").join(", ")})
     ORDER BY compensation_profile_id, display_order, id`,
    ids
  );
  const componentsByProfile = new Map();
  for (const component of components) {
    if (!componentsByProfile.has(Number(component.compensation_profile_id))) {
      componentsByProfile.set(Number(component.compensation_profile_id), []);
    }
    componentsByProfile.get(Number(component.compensation_profile_id)).push(component);
  }
  return profiles.map((profile) => ({
    ...profile,
    components: componentsByProfile.get(Number(profile.id)) || [],
  }));
}

function compensationCoverageIssue(worker, profiles, periodStart, periodEnd) {
  const employmentStart = dateValue(worker.employment_start_date) || periodStart;
  const employmentEnd = dateValue(worker.employment_end_date) || periodEnd;
  const requiredStart = employmentStart > periodStart ? employmentStart : periodStart;
  const requiredEnd = employmentEnd < periodEnd ? employmentEnd : periodEnd;
  if (!profiles.length) {
    return { severity: "error", code: "missing_compensation", worker_id: worker.id, worker_name: worker.full_name, message: "No approved compensation profile covers this payroll period." };
  }
  if (profiles.length > 1) {
    return { severity: "error", code: "salary_changed_during_period", worker_id: worker.id, worker_name: worker.full_name, message: "More than one approved compensation profile overlaps this period. Split or resolve the salary change before payroll is prepared." };
  }
  const profile = profiles[0];
  const profileStart = dateValue(profile.effective_from);
  const profileEnd = dateValue(profile.effective_to) || requiredEnd;
  if (profileStart > requiredStart || profileEnd < requiredEnd) {
    return { severity: "error", code: "compensation_gap", worker_id: worker.id, worker_name: worker.full_name, message: "The approved compensation record does not cover every payable day in the period." };
  }
  return null;
}

async function validatePayrollPeriod({ periodId, workspaceCode, connection = pool }) {
  await assertSchemaReady(connection);
  const period = await getPeriod(connection, periodId, workspaceCode);
  const periodStart = dateValue(period.period_start);
  const periodEnd = dateValue(period.period_end);
  const [rules, workers] = await Promise.all([
    approvedStatutoryRules(connection, workspaceCode, periodStart, periodEnd),
    workerCandidates(connection, workspaceCode, periodStart, periodEnd),
  ]);
  const issues = [];
  const previews = [];
  if (!rules.length) {
    issues.push({ severity: "error", code: "statutory_configuration_missing", message: "No approved statutory payroll rule version covers the full payroll period." });
  }
  if (!workers.length) {
    issues.push({ severity: "error", code: "eligible_workers_missing", message: "No worker employment record overlaps this payroll period." });
  }
  const statutoryLineCodes = new Set();
  for (const rule of rules) {
    const lineCode = rule.configuration.line_code;
    if (statutoryLineCodes.has(lineCode)) {
      issues.push({ severity: "error", code: "duplicate_statutory_line_code", message: `Approved statutory rules produce the duplicate payroll line code ${lineCode}.` });
    }
    statutoryLineCodes.add(lineCode);
  }

  for (const worker of workers) {
    if (["terminated", "inactive"].includes(String(worker.employment_status || "").toLowerCase()) && !worker.employment_end_date) {
      issues.push({ severity: "error", code: "employment_end_date_missing", worker_id: worker.id, worker_name: worker.full_name, message: "This inactive or terminated worker has no employment end date, so payable days cannot be determined safely." });
      continue;
    }
    const profiles = await profilesForWorker(connection, worker.id, workspaceCode, periodStart, periodEnd);
    const coverageIssue = compensationCoverageIssue(worker, profiles, periodStart, periodEnd);
    if (coverageIssue) {
      issues.push(coverageIssue);
      continue;
    }
    const calculation = calculatePayrollEntry({
      worker,
      profile: profiles[0],
      components: profiles[0].components,
      statutoryRules: rules,
      period,
    });
    if (calculation.net_salary <= 0) {
      issues.push({ severity: "error", code: "non_positive_net_salary", worker_id: worker.id, worker_name: worker.full_name, message: `Calculated net salary is ${calculation.net_salary.toFixed(2)} and cannot be processed automatically.` });
    }
    previews.push({
      worker_id: worker.id,
      employee_number: worker.employee_number,
      worker_name: worker.full_name,
      compensation_profile_id: profiles[0].id,
      basic_salary: money(profiles[0].basic_salary),
      pay_frequency: profiles[0].pay_frequency,
      gross_earnings: calculation.gross_earnings,
      total_deductions: calculation.total_deductions,
      employer_contributions: calculation.employer_contributions,
      net_salary: calculation.net_salary,
      payable_days: calculation.payable_days,
    });
  }

  return {
    period,
    rules: rules.map((rule) => ({ id: rule.id, rule_code: rule.rule_code, version_label: rule.version_label, scope_code: rule.scope_code, effective_from: rule.effective_from, effective_to: rule.effective_to, configuration: rule.configuration })),
    workers,
    previews,
    issues,
    valid: issues.every((issue) => issue.severity !== "error"),
    totals: {
      workers: previews.length,
      gross_earnings: money(previews.reduce((sum, item) => sum + item.gross_earnings, 0)),
      deductions: money(previews.reduce((sum, item) => sum + item.total_deductions, 0)),
      employer_contributions: money(previews.reduce((sum, item) => sum + item.employer_contributions, 0)),
      net_salary: money(previews.reduce((sum, item) => sum + item.net_salary, 0)),
    },
  };
}

function entryChecksumPayload(entry, lines, compensationSnapshot, statutorySnapshot) {
  return {
    payroll_period_id: Number(entry.payroll_period_id),
    worker_id: Number(entry.worker_id),
    workspace_code: entry.workspace_code,
    compensation_profile_id: Number(entry.compensation_profile_id),
    employment_days: Number(entry.employment_days || 0),
    payable_days: Number(entry.payable_days || 0),
    basic_earned: money(entry.basic_earned),
    gross_earnings: money(entry.gross_earnings),
    total_deductions: money(entry.total_deductions),
    employer_contributions: money(entry.employer_contributions),
    net_salary: money(entry.net_salary),
    compensation_snapshot: compensationSnapshot,
    statutory_snapshot: statutorySnapshot,
    lines: lines.map((line) => ({
      line_code: line.line_code,
      line_name: line.line_name,
      line_type: line.line_type,
      source_type: line.source_type,
      source_reference: line.source_reference || null,
      quantity: line.quantity === null || line.quantity === undefined ? null : Number(line.quantity),
      rate: line.rate === null || line.rate === undefined ? null : Number(line.rate),
      amount: money(line.amount),
      metadata: line.metadata || parseJson(line.metadata_json, null),
      display_order: Number(line.display_order || 0),
    })),
  };
}

async function preparePayrollPeriod({ periodId, workspaceCode, actorId }) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const period = await getPeriod(connection, periodId, workspaceCode, { lock: true });
    if (period.status !== "draft") {
      throw new PayrollFoundationError(409, "Only a draft payroll period can be prepared for review.", "PAYROLL_PERIOD_NOT_DRAFT");
    }
    const validation = await validatePayrollPeriod({ periodId, workspaceCode, connection });
    if (!validation.valid) {
      const error = new PayrollFoundationError(409, "Payroll validation found issues that must be resolved before review.", "PAYROLL_PERIOD_VALIDATION_FAILED");
      error.details = validation;
      throw error;
    }
    const [existing] = await connection.query("SELECT id FROM payroll_entries WHERE payroll_period_id = ? LIMIT 1 FOR UPDATE", [period.id]);
    if (existing.length) {
      throw new PayrollFoundationError(409, "This payroll period already has preserved worker entries.", "PAYROLL_PERIOD_ENTRIES_EXIST");
    }

    const statutorySnapshot = validation.rules;
    for (const preview of validation.previews) {
      const worker = validation.workers.find((item) => Number(item.id) === Number(preview.worker_id));
      const profiles = await profilesForWorker(connection, worker.id, workspaceCode, dateValue(period.period_start), dateValue(period.period_end));
      const profile = profiles[0];
      const calculation = calculatePayrollEntry({ worker, profile, components: profile.components, statutoryRules: validation.rules, period });
      const compensationSnapshot = {
        id: profile.id,
        effective_from: profile.effective_from,
        effective_to: profile.effective_to,
        currency_code: profile.currency_code,
        pay_frequency: profile.pay_frequency,
        basic_salary: money(profile.basic_salary),
        components: profile.components,
      };
      const [result] = await connection.query(
        `INSERT INTO payroll_entries (
           payroll_period_id, worker_id, workspace_code, compensation_profile_id,
           entry_status, employment_days, payable_days, basic_earned, gross_earnings,
           total_deductions, employer_contributions, net_salary, amount_paid,
           remaining_balance, compensation_snapshot_json, statutory_snapshot_json,
           calculation_checksum_sha256, prepared_by
         ) VALUES (?, ?, ?, ?, 'pending_approval', ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, NULL, ?)`,
        [period.id, worker.id, workspaceCode, profile.id, calculation.employment_days, calculation.payable_days,
          calculation.basic_earned, calculation.gross_earnings, calculation.total_deductions,
          calculation.employer_contributions, calculation.net_salary, calculation.net_salary,
          JSON.stringify(compensationSnapshot), JSON.stringify(statutorySnapshot), actorId]
      );
      const entry = {
        payroll_period_id: period.id,
        worker_id: worker.id,
        workspace_code: workspaceCode,
        compensation_profile_id: profile.id,
        ...calculation,
      };
      for (const line of calculation.lines) {
        await connection.query(
          `INSERT INTO payroll_entry_lines (
             payroll_entry_id, line_code, line_name, line_type, source_type, source_reference,
             quantity, rate, amount, metadata_json, display_order
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [result.insertId, line.line_code, line.line_name, line.line_type, line.source_type,
            line.source_reference, line.quantity, line.rate, line.amount,
            line.metadata ? JSON.stringify(line.metadata) : null, line.display_order]
        );
      }
      const checksum = checksumSnapshot(entryChecksumPayload(entry, calculation.lines, compensationSnapshot, statutorySnapshot));
      await connection.query("UPDATE payroll_entries SET calculation_checksum_sha256 = ? WHERE id = ?", [checksum, result.insertId]);
    }
    await connection.query(
      `UPDATE payroll_periods
       SET status = 'pending_approval', submitted_by = ?, submitted_at = CURRENT_TIMESTAMP,
           statutory_rule_snapshot_json = ?
       WHERE id = ?`,
      [actorId, JSON.stringify(statutorySnapshot), period.id]
    );
    await connection.commit();
    return { period_id: period.id, status: "pending_approval", entry_count: validation.previews.length, totals: validation.totals };
  } catch (error) {
    try { await connection.rollback(); } catch {}
    throw error;
  } finally {
    connection.release();
  }
}

async function verifyStoredEntryChecksum(connection, entry) {
  const [lines] = await connection.query(
    `SELECT * FROM payroll_entry_lines WHERE payroll_entry_id = ? ORDER BY display_order, id`,
    [entry.id]
  );
  const compensationSnapshot = parseJson(entry.compensation_snapshot_json, {});
  const statutorySnapshot = parseJson(entry.statutory_snapshot_json, []);
  const expected = checksumSnapshot(entryChecksumPayload(entry, lines, compensationSnapshot, statutorySnapshot));
  if (!entry.calculation_checksum_sha256 || expected !== entry.calculation_checksum_sha256) {
    throw new PayrollFoundationError(409, `Payroll entry ${entry.id} changed after calculation and cannot be approved.`, "PAYROLL_CALCULATION_CHECKSUM_MISMATCH");
  }
}

async function approvePayrollPeriod({ periodId, workspaceCode, actorId }) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const period = await getPeriod(connection, periodId, workspaceCode, { lock: true });
    if (period.status !== "pending_approval") {
      throw new PayrollFoundationError(409, "Only payroll submitted for review can be approved.", "PAYROLL_PERIOD_NOT_PENDING");
    }
    if (Number(period.prepared_by) === Number(actorId) || Number(period.submitted_by) === Number(actorId)) {
      throw new PayrollFoundationError(409, "The payroll maker cannot approve the same payroll period.", "PAYROLL_PERIOD_SELF_APPROVAL_FORBIDDEN");
    }
    const [entries] = await connection.query("SELECT * FROM payroll_entries WHERE payroll_period_id = ? FOR UPDATE", [period.id]);
    if (!entries.length) throw new PayrollFoundationError(409, "Payroll has no worker entries to approve.", "PAYROLL_PERIOD_ENTRIES_MISSING");
    for (const entry of entries) await verifyStoredEntryChecksum(connection, entry);
    await connection.query(
      `UPDATE payroll_entries SET entry_status = 'approved', approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE payroll_period_id = ?`,
      [actorId, period.id]
    );
    await connection.query(
      `UPDATE payroll_periods SET status = 'approved', approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [actorId, period.id]
    );
    await connection.commit();
    return { period_id: period.id, status: "approved", entry_count: entries.length };
  } catch (error) {
    try { await connection.rollback(); } catch {}
    throw error;
  } finally { connection.release(); }
}

async function lockPayrollPeriod({ periodId, workspaceCode, actorId }) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const period = await getPeriod(connection, periodId, workspaceCode, { lock: true });
    if (period.status !== "approved") {
      throw new PayrollFoundationError(409, "Approve payroll before locking it for payment.", "PAYROLL_PERIOD_NOT_APPROVED");
    }
    await connection.query(
      `UPDATE payroll_entries SET entry_status = 'due', locked_at = CURRENT_TIMESTAMP
       WHERE payroll_period_id = ? AND entry_status = 'approved'`,
      [period.id]
    );
    await connection.query(
      `UPDATE payroll_periods SET status = 'locked', locked_by = ?, locked_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [actorId, period.id]
    );
    await connection.commit();
    return { period_id: period.id, status: "locked" };
  } catch (error) {
    try { await connection.rollback(); } catch {}
    throw error;
  } finally { connection.release(); }
}

async function nextPayrollNumber(sequenceCode, prefix, actorId) {
  try {
    return await nextDocumentNumber(sequenceCode, { userId: actorId || null });
  } catch {
    return `${prefix}-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}-${crypto.randomInt(0, 10000).toString().padStart(4, "0")}`;
  }
}

function paymentRequestKey(value, entryId) {
  const key = cleanText(value, 191);
  if (key.length < 24 || !key.startsWith(`payroll-payment:${entryId}:`)) {
    throw new PayrollFoundationError(400, "A secure payroll payment request key is required.", "PAYROLL_PAYMENT_IDEMPOTENCY_REQUIRED");
  }
  return key;
}

async function refreshEntryPaymentState(connection, entryId) {
  const [entryRows] = await connection.query("SELECT * FROM payroll_entries WHERE id = ? LIMIT 1 FOR UPDATE", [entryId]);
  const entry = entryRows[0];
  if (!entry) throw new PayrollFoundationError(404, "Payroll entry was not found.", "PAYROLL_ENTRY_NOT_FOUND");
  const [[totals]] = await connection.query(
    `SELECT COALESCE(SUM(CASE WHEN payment_status IN ('posted','reversal_pending') AND reversal_of_payment_id IS NULL THEN amount ELSE 0 END), 0) AS paid
     FROM payroll_salary_payments WHERE payroll_entry_id = ?`,
    [entry.id]
  );
  const paid = money(totals?.paid);
  const net = money(entry.net_salary);
  const balance = money(Math.max(net - paid, 0));
  const status = balance <= 0.01 ? "paid" : paid > 0 ? "part_paid" : "due";
  await connection.query(
    `UPDATE payroll_entries SET amount_paid = ?, remaining_balance = ?, entry_status = ? WHERE id = ?`,
    [paid, balance, status, entry.id]
  );
  return { ...entry, amount_paid: paid, remaining_balance: balance, entry_status: status };
}

async function recordSalaryPayment({ entryId, workspaceCode, input, actorId }) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await assertSchemaReady(connection);
    const id = positiveId(entryId, "Payroll entry ID");
    const [rows] = await connection.query(
      `SELECT entry.*, period.status AS period_status
       FROM payroll_entries entry
       INNER JOIN payroll_periods period ON period.id = entry.payroll_period_id
       WHERE entry.id = ? AND entry.workspace_code = ? AND period.workspace_code = entry.workspace_code
       LIMIT 1 FOR UPDATE`,
      [id, workspaceCode]
    );
    const entry = rows[0];
    if (!entry) throw new PayrollFoundationError(404, "Payroll entry was not found in this business category.", "PAYROLL_ENTRY_NOT_FOUND");
    if (!["locked", "paying", "reconciled"].includes(entry.period_status)) {
      throw new PayrollFoundationError(409, "Salary payments can only be posted after payroll is approved and locked.", "PAYROLL_PERIOD_NOT_LOCKED");
    }
    const amount = positiveMoney(input?.amount);
    const method = cleanText(input?.payment_method, 50).toLowerCase();
    const reference = cleanText(input?.payment_reference, 191);
    const paymentDate = dateOnly(input?.payment_date || new Date().toISOString().slice(0, 10));
    const key = paymentRequestKey(input?.idempotency_key, entry.id);
    if (!amount || !PAYMENT_METHODS.has(method) || !reference || !paymentDate) {
      throw new PayrollFoundationError(400, "Payment amount, date, method and external reference are required.", "PAYROLL_PAYMENT_INPUT_INVALID");
    }
    const [replays] = await connection.query("SELECT * FROM payroll_salary_payments WHERE idempotency_key = ? LIMIT 1 FOR UPDATE", [key]);
    if (replays.length) {
      const refreshedReplay = await refreshEntryPaymentState(connection, entry.id);
      await connection.commit();
      return { replayed: true, payment: replays[0], entry: refreshedReplay };
    }
    const current = await refreshEntryPaymentState(connection, entry.id);
    if (amount > current.remaining_balance + 0.01) {
      throw new PayrollFoundationError(400, `Payment exceeds the remaining salary balance of GHS ${current.remaining_balance.toFixed(2)}.`, "PAYROLL_PAYMENT_EXCEEDS_BALANCE");
    }
    const [duplicateReference] = await connection.query(
      `SELECT id FROM payroll_salary_payments
       WHERE workspace_code = ? AND payment_reference = ?
         AND payment_status <> 'reversed' AND reversal_of_payment_id IS NULL
       LIMIT 1 FOR UPDATE`,
      [workspaceCode, reference]
    );
    if (duplicateReference.length) {
      throw new PayrollFoundationError(409, "That salary payment reference is already in use.", "PAYROLL_PAYMENT_REFERENCE_DUPLICATE");
    }
    const paymentNumber = await nextPayrollNumber("PAYROLL_PAYMENT", "PAY", actorId);
    const [result] = await connection.query(
      `INSERT INTO payroll_salary_payments (
         payroll_entry_id, worker_id, workspace_code, payment_number, idempotency_key,
         payment_date, amount, payment_method, payment_reference, destination_masked,
         payment_status, posted_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'posted', ?)`,
      [entry.id, entry.worker_id, workspaceCode, paymentNumber, key, paymentDate, amount, method,
        reference, cleanText(input?.destination_masked, 191) || null, actorId]
    );
    const refreshed = await refreshEntryPaymentState(connection, entry.id);
    if (entry.period_status === "locked") {
      await connection.query("UPDATE payroll_periods SET status = 'paying' WHERE id = ?", [entry.payroll_period_id]);
    }
    await connection.commit();
    return {
      replayed: false,
      payment: { id: result.insertId, payment_number: paymentNumber, amount, payment_method: method, payment_reference: reference, payment_date: paymentDate },
      entry: refreshed,
    };
  } catch (error) {
    try { await connection.rollback(); } catch {}
    throw error;
  } finally { connection.release(); }
}

async function requestPaymentReversal({ paymentId, workspaceCode, input, actorId }) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const id = positiveId(paymentId, "Salary payment ID");
    const reason = cleanText(input?.reason, 2000);
    if (reason.length < 8) throw new PayrollFoundationError(400, "Enter a detailed reversal reason.", "PAYROLL_REVERSAL_REASON_REQUIRED");
    const [rows] = await connection.query(
      `SELECT payment.*, entry.payroll_period_id, period.status AS period_status
       FROM payroll_salary_payments payment
       INNER JOIN payroll_entries entry ON entry.id = payment.payroll_entry_id
       INNER JOIN payroll_periods period ON period.id = entry.payroll_period_id
       WHERE payment.id = ? AND payment.workspace_code = ? AND entry.workspace_code = payment.workspace_code
       LIMIT 1 FOR UPDATE`,
      [id, workspaceCode]
    );
    const payment = rows[0];
    if (!payment) throw new PayrollFoundationError(404, "Salary payment was not found in this business category.", "PAYROLL_PAYMENT_NOT_FOUND");
    if (payment.reversal_of_payment_id || payment.payment_status !== "posted") {
      throw new PayrollFoundationError(409, "Only an active original salary payment can be submitted for reversal.", "PAYROLL_PAYMENT_NOT_REVERSIBLE");
    }
    if (payment.period_status === "closed") {
      throw new PayrollFoundationError(409, "A closed payroll period cannot accept a payment reversal.", "PAYROLL_PERIOD_CLOSED");
    }
    const [pending] = await connection.query(
      `SELECT id FROM payroll_adjustment_requests
       WHERE payment_id = ? AND adjustment_type = 'payment_reversal' AND request_status = 'pending'
       LIMIT 1 FOR UPDATE`,
      [payment.id]
    );
    if (pending.length) throw new PayrollFoundationError(409, "A reversal request for this payment is already awaiting approval.", "PAYROLL_REVERSAL_ALREADY_PENDING");
    const [result] = await connection.query(
      `INSERT INTO payroll_adjustment_requests (
         workspace_code, worker_id, payroll_entry_id, payment_id, adjustment_type,
         requested_amount, reason, evidence_reference, request_status, requested_by
       ) VALUES (?, ?, ?, ?, 'payment_reversal', ?, ?, ?, 'pending', ?)`,
      [workspaceCode, payment.worker_id, payment.payroll_entry_id, payment.id, payment.amount,
        reason, cleanText(input?.evidence_reference, 500) || null, actorId]
    );
    await connection.query("UPDATE payroll_salary_payments SET payment_status = 'reversal_pending' WHERE id = ?", [payment.id]);
    await connection.commit();
    return { request_id: result.insertId, status: "pending", payment_id: payment.id };
  } catch (error) {
    try { await connection.rollback(); } catch {}
    throw error;
  } finally { connection.release(); }
}

async function decideAdjustment({ requestId, workspaceCode, input, actorId }) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const id = positiveId(requestId, "Payroll adjustment request ID");
    const decision = cleanText(input?.decision, 20).toLowerCase();
    const reason = cleanText(input?.reason, 2000);
    if (!DECISIONS.has(decision) || reason.length < 5) {
      throw new PayrollFoundationError(400, "Choose approve or reject and record a decision reason.", "PAYROLL_ADJUSTMENT_DECISION_INVALID");
    }
    const [rows] = await connection.query(
      `SELECT request.*, payment.payment_number, payment.amount AS payment_amount,
              payment.payment_status, payment.payment_reference, payment.payment_method,
              payment.payroll_entry_id AS source_entry_id, payment.payment_date,
              entry.payroll_period_id, period.status AS period_status
       FROM payroll_adjustment_requests request
       LEFT JOIN payroll_salary_payments payment ON payment.id = request.payment_id
       LEFT JOIN payroll_entries entry ON entry.id = request.payroll_entry_id
       LEFT JOIN payroll_periods period ON period.id = entry.payroll_period_id
       WHERE request.id = ? AND request.workspace_code = ?
       LIMIT 1 FOR UPDATE`,
      [id, workspaceCode]
    );
    const request = rows[0];
    if (!request) throw new PayrollFoundationError(404, "Payroll adjustment request was not found.", "PAYROLL_ADJUSTMENT_NOT_FOUND");
    if (request.request_status !== "pending") throw new PayrollFoundationError(409, "This payroll adjustment request was already decided.", "PAYROLL_ADJUSTMENT_ALREADY_DECIDED");
    if (Number(request.requested_by) === Number(actorId)) {
      throw new PayrollFoundationError(409, "The person who requested a payroll correction cannot approve or reject the same request.", "PAYROLL_ADJUSTMENT_SELF_APPROVAL_FORBIDDEN");
    }
    if (request.adjustment_type !== "payment_reversal" || !request.payment_id) {
      throw new PayrollFoundationError(409, "This processing phase only executes controlled salary-payment reversal requests.", "PAYROLL_ADJUSTMENT_TYPE_NOT_EXECUTABLE");
    }
    if (decision === "reject") {
      await connection.query(
        `UPDATE payroll_adjustment_requests SET request_status = 'rejected', decided_by = ?, decided_at = CURRENT_TIMESTAMP, decision_reason = ? WHERE id = ?`,
        [actorId, reason, request.id]
      );
      if (request.payment_status === "reversal_pending") {
        await connection.query("UPDATE payroll_salary_payments SET payment_status = 'posted' WHERE id = ?", [request.payment_id]);
      }
      await connection.commit();
      return { request_id: request.id, status: "rejected" };
    }
    if (request.payment_status !== "reversal_pending") {
      throw new PayrollFoundationError(409, "The original payment is no longer awaiting this reversal decision.", "PAYROLL_REVERSAL_STATE_CHANGED");
    }
    if (request.period_status === "closed") {
      throw new PayrollFoundationError(409, "A closed payroll period cannot execute a payment reversal.", "PAYROLL_PERIOD_CLOSED");
    }
    const reversalNumber = await nextPayrollNumber("PAYROLL_PAYMENT_REVERSAL", "PAYREV", actorId);
    const reversalKey = `payroll-reversal:${request.id}:${crypto.randomUUID()}`;
    const [reversal] = await connection.query(
      `INSERT INTO payroll_salary_payments (
         payroll_entry_id, worker_id, workspace_code, payment_number, idempotency_key,
         payment_date, amount, payment_method, payment_reference, destination_masked,
         payment_status, reversal_of_payment_id, posted_by, metadata_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'reversed', ?, ?, ?)`,
      [request.payroll_entry_id, request.worker_id, workspaceCode, reversalNumber, reversalKey,
        dateOnly(new Date().toISOString().slice(0, 10)), money(request.payment_amount), request.payment_method,
        `REVERSAL-${request.payment_number || request.payment_id}`, request.payment_id, actorId,
        JSON.stringify({ adjustment_request_id: request.id, original_payment_reference: request.payment_reference, decision_reason: reason })]
    );
    await connection.query("UPDATE payroll_salary_payments SET payment_status = 'reversed' WHERE id = ?", [request.payment_id]);
    await connection.query(
      `UPDATE payroll_adjustment_requests
       SET request_status = 'executed', decided_by = ?, decided_at = CURRENT_TIMESTAMP,
           decision_reason = ?, executed_by = ?, executed_at = CURRENT_TIMESTAMP,
           result_reference = ?
       WHERE id = ?`,
      [actorId, reason, actorId, reversalNumber, request.id]
    );
    const refreshed = await refreshEntryPaymentState(connection, request.payroll_entry_id);
    if (refreshed.remaining_balance > 0.01 && request.period_status === "reconciled") {
      await connection.query("UPDATE payroll_periods SET status = 'paying' WHERE id = ?", [request.payroll_period_id]);
    }
    await connection.commit();
    return { request_id: request.id, status: "executed", reversal_payment_id: reversal.insertId, reversal_number: reversalNumber, entry: refreshed };
  } catch (error) {
    try { await connection.rollback(); } catch {}
    throw error;
  } finally { connection.release(); }
}

async function reconcilePayrollPeriod({ periodId, workspaceCode }) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const period = await getPeriod(connection, periodId, workspaceCode, { lock: true });
    if (!["locked", "paying", "reconciled"].includes(period.status)) {
      throw new PayrollFoundationError(409, "Only locked or paying payroll can be reconciled.", "PAYROLL_PERIOD_NOT_PAYMENT_READY");
    }
    const [entries] = await connection.query("SELECT id FROM payroll_entries WHERE payroll_period_id = ? FOR UPDATE", [period.id]);
    const refreshed = [];
    for (const entry of entries) refreshed.push(await refreshEntryPaymentState(connection, entry.id));
    const outstanding = money(refreshed.reduce((sum, entry) => sum + Number(entry.remaining_balance || 0), 0));
    const paid = money(refreshed.reduce((sum, entry) => sum + Number(entry.amount_paid || 0), 0));
    const [[pendingRow]] = await connection.query(
      `SELECT COUNT(*) AS pending_count FROM payroll_adjustment_requests
       WHERE workspace_code = ? AND request_status = 'pending'
         AND payroll_entry_id IN (SELECT id FROM payroll_entries WHERE payroll_period_id = ?)`,
      [workspaceCode, period.id]
    );
    const pendingAdjustments = Number(pendingRow?.pending_count || 0);
    const status = outstanding <= 0.01 && refreshed.length && pendingAdjustments === 0 ? "reconciled" : "paying";
    await connection.query("UPDATE payroll_periods SET status = ? WHERE id = ?", [status, period.id]);
    await connection.commit();
    return {
      period_id: period.id,
      status,
      pending_adjustments: pendingAdjustments,
      entry_count: refreshed.length,
      fully_paid_entries: refreshed.filter((entry) => entry.entry_status === "paid").length,
      part_paid_entries: refreshed.filter((entry) => entry.entry_status === "part_paid").length,
      unpaid_entries: refreshed.filter((entry) => entry.entry_status === "due").length,
      amount_paid: paid,
      outstanding_balance: outstanding,
    };
  } catch (error) {
    try { await connection.rollback(); } catch {}
    throw error;
  } finally { connection.release(); }
}

async function payrollPeriodDetail({ periodId, workspaceCode, connection = pool }) {
  await assertSchemaReady(connection);
  const period = await getPeriod(connection, periodId, workspaceCode);
  const [entries] = await connection.query(
    `SELECT entry.*, worker.employee_number, worker.full_name AS worker_name,
            worker.job_title, worker.department
     FROM payroll_entries entry
     INNER JOIN worker_profiles worker ON worker.id = entry.worker_id
     WHERE entry.payroll_period_id = ? AND entry.workspace_code = ?
     ORDER BY worker.full_name, entry.id`,
    [period.id, workspaceCode]
  );
  let lines = [];
  let payments = [];
  if (entries.length) {
    const ids = entries.map((entry) => entry.id);
    [lines] = await connection.query(
      `SELECT * FROM payroll_entry_lines WHERE payroll_entry_id IN (${ids.map(() => "?").join(", ")}) ORDER BY payroll_entry_id, display_order, id`,
      ids
    );
    [payments] = await connection.query(
      `SELECT payment.*, poster.full_name AS posted_by_name
       FROM payroll_salary_payments payment
       LEFT JOIN users poster ON poster.id = payment.posted_by
       WHERE payment.payroll_entry_id IN (${ids.map(() => "?").join(", ")})
       ORDER BY payment.payment_date DESC, payment.id DESC`,
      ids
    );
  }
  const [adjustments] = await connection.query(
    `SELECT request.*, requester.full_name AS requested_by_name, decider.full_name AS decided_by_name
     FROM payroll_adjustment_requests request
     LEFT JOIN users requester ON requester.id = request.requested_by
     LEFT JOIN users decider ON decider.id = request.decided_by
     WHERE request.workspace_code = ?
       AND (request.payroll_entry_id IN (SELECT id FROM payroll_entries WHERE payroll_period_id = ?))
     ORDER BY request.requested_at DESC, request.id DESC`,
    [workspaceCode, period.id]
  );
  const linesByEntry = new Map();
  const paymentsByEntry = new Map();
  for (const line of lines) {
    if (!linesByEntry.has(Number(line.payroll_entry_id))) linesByEntry.set(Number(line.payroll_entry_id), []);
    linesByEntry.get(Number(line.payroll_entry_id)).push(line);
  }
  for (const payment of payments) {
    if (!paymentsByEntry.has(Number(payment.payroll_entry_id))) paymentsByEntry.set(Number(payment.payroll_entry_id), []);
    paymentsByEntry.get(Number(payment.payroll_entry_id)).push(payment);
  }
  return {
    period,
    entries: entries.map((entry) => ({ ...entry, lines: linesByEntry.get(Number(entry.id)) || [], payments: paymentsByEntry.get(Number(entry.id)) || [] })),
    adjustments,
    summary: {
      workers: entries.length,
      gross_earnings: money(entries.reduce((sum, entry) => sum + Number(entry.gross_earnings || 0), 0)),
      deductions: money(entries.reduce((sum, entry) => sum + Number(entry.total_deductions || 0), 0)),
      employer_contributions: money(entries.reduce((sum, entry) => sum + Number(entry.employer_contributions || 0), 0)),
      net_salary: money(entries.reduce((sum, entry) => sum + Number(entry.net_salary || 0), 0)),
      amount_paid: money(entries.reduce((sum, entry) => sum + Number(entry.amount_paid || 0), 0)),
      outstanding_balance: money(entries.reduce((sum, entry) => sum + Number(entry.remaining_balance || 0), 0)),
      paid_workers: entries.filter((entry) => entry.entry_status === "paid").length,
      part_paid_workers: entries.filter((entry) => entry.entry_status === "part_paid").length,
      unpaid_workers: entries.filter((entry) => ["due", "approved", "pending_approval"].includes(entry.entry_status)).length,
    },
  };
}

async function submitStatutoryRule({ ruleId, workspaceCode, actorId, allowGroup = false }) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const id = positiveId(ruleId, "Statutory rule ID");
    const [rows] = await connection.query("SELECT * FROM payroll_statutory_rule_versions WHERE id = ? LIMIT 1 FOR UPDATE", [id]);
    const rule = rows[0];
    if (!rule || (rule.scope_code !== workspaceCode && !(allowGroup && rule.scope_code === "group"))) {
      throw new PayrollFoundationError(404, "Statutory rule was not found in this payroll scope.", "PAYROLL_STATUTORY_RULE_NOT_FOUND");
    }
    if (rule.status !== "draft") throw new PayrollFoundationError(409, "Only a draft statutory rule can be submitted.", "PAYROLL_STATUTORY_RULE_NOT_DRAFT");
    normalizeRuleConfiguration(rule);
    await connection.query("UPDATE payroll_statutory_rule_versions SET status = 'pending_approval', submitted_by = ?, submitted_at = CURRENT_TIMESTAMP WHERE id = ?", [actorId, rule.id]);
    await connection.commit();
    return { ...rule, status: "pending_approval", submitted_by: actorId };
  } catch (error) {
    try { await connection.rollback(); } catch {}
    throw error;
  } finally { connection.release(); }
}

async function approveStatutoryRule({ ruleId, workspaceCode, actorId, allowGroup = false }) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const id = positiveId(ruleId, "Statutory rule ID");
    const [rows] = await connection.query("SELECT * FROM payroll_statutory_rule_versions WHERE id = ? LIMIT 1 FOR UPDATE", [id]);
    const rule = rows[0];
    if (!rule || (rule.scope_code !== workspaceCode && !(allowGroup && rule.scope_code === "group"))) {
      throw new PayrollFoundationError(404, "Statutory rule was not found in this payroll scope.", "PAYROLL_STATUTORY_RULE_NOT_FOUND");
    }
    if (rule.status !== "pending_approval") throw new PayrollFoundationError(409, "Only a submitted statutory rule can be approved.", "PAYROLL_STATUTORY_RULE_NOT_PENDING");
    if (Number(rule.created_by) === Number(actorId) || Number(rule.submitted_by) === Number(actorId)) {
      throw new PayrollFoundationError(409, "The person who prepared or submitted this statutory rule cannot approve it.", "PAYROLL_STATUTORY_RULE_SELF_APPROVAL_FORBIDDEN");
    }
    normalizeRuleConfiguration(rule);
    const [future] = await connection.query(
      `SELECT id FROM payroll_statutory_rule_versions
       WHERE scope_code = ? AND rule_code = ? AND status = 'approved' AND id <> ? AND effective_from >= ?
       LIMIT 1 FOR UPDATE`,
      [rule.scope_code, rule.rule_code, rule.id, rule.effective_from]
    );
    if (future.length) throw new PayrollFoundationError(409, "An approved version of this rule already starts on or after the proposed effective date.", "PAYROLL_STATUTORY_RULE_FUTURE_CONFLICT");
    const [current] = await connection.query(
      `SELECT id, effective_from FROM payroll_statutory_rule_versions
       WHERE scope_code = ? AND rule_code = ? AND status = 'approved' AND id <> ?
         AND effective_from < ? AND (effective_to IS NULL OR effective_to >= ?)
       ORDER BY effective_from DESC LIMIT 1 FOR UPDATE`,
      [rule.scope_code, rule.rule_code, rule.id, rule.effective_from, rule.effective_from]
    );
    if (current[0]) {
      await connection.query(
        "UPDATE payroll_statutory_rule_versions SET status = 'superseded', effective_to = ? WHERE id = ?",
        [previousDate(dateValue(rule.effective_from)), current[0].id]
      );
    }
    await connection.query("UPDATE payroll_statutory_rule_versions SET status = 'approved', approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE id = ?", [actorId, rule.id]);
    await connection.commit();
    return { ...rule, status: "approved", approved_by: actorId };
  } catch (error) {
    try { await connection.rollback(); } catch {}
    throw error;
  } finally { connection.release(); }
}

module.exports = {
  normalizeRuleConfiguration,
  evaluateStatutoryRule,
  calculatePayrollEntry,
  validatePayrollPeriod,
  preparePayrollPeriod,
  approvePayrollPeriod,
  lockPayrollPeriod,
  recordSalaryPayment,
  requestPaymentReversal,
  decideAdjustment,
  reconcilePayrollPeriod,
  payrollPeriodDetail,
  submitStatutoryRule,
  approveStatutoryRule,
  refreshEntryPaymentState,
};
