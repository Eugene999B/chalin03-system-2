const crypto = require("node:crypto");
const QRCode = require("qrcode");

const { pool } = require("../config/db");
const { nextDocumentNumber } = require("./groupConfigurationService");
const {
  PayrollFoundationError,
  assertSchemaReady,
  checksumSnapshot,
} = require("./payrollFoundationService");

function cleanText(value, maxLength = 1000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function positiveId(value, label = "ID") {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new PayrollFoundationError(400, `${label} must be a positive whole number.`, "PAYROLL_PAYSLIP_IDENTIFIER_INVALID");
  }
  return number;
}

function money(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(2)) : 0;
}

function dateValue(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function parseJson(value, fallback = {}) {
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(String(value || "{}"));
  } catch {
    return fallback;
  }
}

function publicBaseUrl() {
  return cleanText(
    process.env.PAYROLL_PAYSLIP_VERIFY_BASE_URL ||
      process.env.PUBLIC_API_URL ||
      process.env.API_PUBLIC_URL ||
      "https://api.chalin03.com",
    300
  ).replace(/\/+$/, "");
}

function buildPayslipVerificationUrl(reference) {
  const token = cleanText(reference, 191);
  if (!token) {
    throw new PayrollFoundationError(500, "Payslip verification reference is unavailable.", "PAYROLL_PAYSLIP_VERIFICATION_REFERENCE_MISSING");
  }
  return `${publicBaseUrl()}/api/release2-final/verification/payroll-payslip/${encodeURIComponent(token)}`;
}

async function createPayslipVerificationQr(reference) {
  return QRCode.toBuffer(buildPayslipVerificationUrl(reference), {
    type: "png",
    width: 320,
    margin: 1,
    errorCorrectionLevel: "M",
    color: {
      dark: "#07182cff",
      light: "#ffffffff",
    },
  });
}

function maskEmployeeNumber(value) {
  const text = cleanText(value, 80);
  if (text.length <= 4) return text ? `${text[0] || ""}***` : "Not shown";
  return `${text.slice(0, 2)}${"*".repeat(Math.min(6, text.length - 4))}${text.slice(-2)}`;
}

function maskEmployeeName(value) {
  const parts = cleanText(value, 180).split(/\s+/).filter(Boolean);
  if (!parts.length) return "Employee";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

async function nextPayslipNumber(actorId) {
  try {
    return await nextDocumentNumber("PAYROLL_PAYSLIP", { userId: actorId || null });
  } catch {
    return `PAYSLIP-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}-${crypto.randomInt(0, 10000).toString().padStart(4, "0")}`;
  }
}

async function uniqueVerificationReference(connection) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const reference = crypto.randomBytes(24).toString("base64url");
    const [rows] = await connection.query(
      "SELECT id FROM payroll_payslips WHERE verification_reference = ? LIMIT 1",
      [reference]
    );
    if (!rows.length) return reference;
  }
  throw new PayrollFoundationError(500, "Could not allocate a unique payslip verification reference.", "PAYROLL_PAYSLIP_VERIFICATION_REFERENCE_COLLISION");
}

async function loadEntryForIssue(connection, entryId, workspaceCode, { lock = false } = {}) {
  const id = positiveId(entryId, "Payroll entry ID");
  const [rows] = await connection.query(
    `SELECT entry.*, period.period_code, period.period_start, period.period_end,
            period.scheduled_pay_date, period.status AS period_status,
            worker.employee_number, worker.full_name AS worker_name,
            worker.job_title, worker.department, worker.employment_start_date,
            worker.employment_end_date
     FROM payroll_entries entry
     INNER JOIN payroll_periods period ON period.id = entry.payroll_period_id
     INNER JOIN worker_profiles worker ON worker.id = entry.worker_id
     WHERE entry.id = ?
       AND entry.workspace_code = ?
       AND period.workspace_code = entry.workspace_code
       AND worker.workspace_code = entry.workspace_code
     LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [id, workspaceCode]
  );
  const entry = rows[0];
  if (!entry) {
    throw new PayrollFoundationError(404, "Payroll entry was not found in this business category.", "PAYROLL_PAYSLIP_ENTRY_NOT_FOUND");
  }
  return entry;
}

async function loadLines(connection, entryId) {
  const [rows] = await connection.query(
    `SELECT id, line_code, line_name, line_type, source_type, source_reference,
            quantity, rate, amount, metadata_json, display_order
     FROM payroll_entry_lines
     WHERE payroll_entry_id = ?
     ORDER BY display_order, id`,
    [entryId]
  );
  return rows.map((line) => ({
    id: Number(line.id),
    line_code: line.line_code,
    line_name: line.line_name,
    line_type: line.line_type,
    source_type: line.source_type,
    source_reference: line.source_reference || null,
    quantity: line.quantity === null ? null : Number(line.quantity),
    rate: line.rate === null ? null : Number(line.rate),
    amount: money(line.amount),
    metadata: parseJson(line.metadata_json, null),
    display_order: Number(line.display_order || 0),
  }));
}

async function loadActivePayments(connection, entryId) {
  const [rows] = await connection.query(
    `SELECT id, payment_number, payment_date, amount, payment_method,
            payment_reference, destination_masked, posted_at
     FROM payroll_salary_payments
     WHERE payroll_entry_id = ?
       AND reversal_of_payment_id IS NULL
       AND payment_status = 'posted'
     ORDER BY payment_date, id`,
    [entryId]
  );
  return rows.map((payment) => ({
    id: Number(payment.id),
    payment_number: payment.payment_number || null,
    payment_date: dateValue(payment.payment_date),
    amount: money(payment.amount),
    payment_method: payment.payment_method,
    payment_reference: payment.payment_reference,
    destination_masked: payment.destination_masked || null,
    posted_at: payment.posted_at || null,
  }));
}

async function loadYtdTotals(connection, entry) {
  const periodEnd = dateValue(entry.period_end);
  const year = Number(periodEnd?.slice(0, 4));
  if (!year) {
    return { year: null, gross_earnings: 0, total_deductions: 0, employer_contributions: 0, net_salary: 0, amount_paid: 0 };
  }
  const [[row]] = await connection.query(
    `SELECT COALESCE(SUM(item.gross_earnings), 0) AS gross_earnings,
            COALESCE(SUM(item.total_deductions), 0) AS total_deductions,
            COALESCE(SUM(item.employer_contributions), 0) AS employer_contributions,
            COALESCE(SUM(item.net_salary), 0) AS net_salary,
            COALESCE(SUM(item.amount_paid), 0) AS amount_paid
     FROM payroll_entries item
     INNER JOIN payroll_periods p ON p.id = item.payroll_period_id
     WHERE item.worker_id = ?
       AND item.workspace_code = ?
       AND YEAR(p.period_end) = ?
       AND p.period_end <= ?
       AND p.status IN ('approved', 'locked', 'paying', 'reconciled', 'closed')
       AND item.entry_status NOT IN ('cancelled', 'reversed')`,
    [entry.worker_id, entry.workspace_code, year, periodEnd]
  );
  return {
    year,
    gross_earnings: money(row?.gross_earnings),
    total_deductions: money(row?.total_deductions),
    employer_contributions: money(row?.employer_contributions),
    net_salary: money(row?.net_salary),
    amount_paid: money(row?.amount_paid),
  };
}

async function assertIssuableEntry(connection, entry) {
  if (!["reconciled", "closed"].includes(String(entry.period_status || "").toLowerCase())) {
    throw new PayrollFoundationError(409, "A professional payslip can be issued only after the payroll period is fully reconciled or closed.", "PAYROLL_PAYSLIP_PERIOD_NOT_RECONCILED");
  }
  if (String(entry.entry_status || "").toLowerCase() !== "paid" || money(entry.remaining_balance) > 0.01) {
    throw new PayrollFoundationError(409, "The worker payroll entry must be fully paid before a professional payslip is issued.", "PAYROLL_PAYSLIP_ENTRY_NOT_PAID");
  }
  if (!/^[a-f0-9]{64}$/i.test(cleanText(entry.calculation_checksum_sha256, 64))) {
    throw new PayrollFoundationError(409, "The locked payroll entry does not have a valid calculation checksum.", "PAYROLL_PAYSLIP_ENTRY_CHECKSUM_MISSING");
  }
  const [[pending]] = await connection.query(
    `SELECT COUNT(*) AS pending_count
     FROM payroll_adjustment_requests
     WHERE payroll_entry_id = ? AND request_status = 'pending'`,
    [entry.id]
  );
  if (Number(pending?.pending_count || 0) > 0) {
    throw new PayrollFoundationError(409, "Resolve pending payroll adjustments before issuing a payslip.", "PAYROLL_PAYSLIP_ADJUSTMENT_PENDING");
  }
}

function normalizedPayslipRow(row) {
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id),
    payroll_entry_id: Number(row.payroll_entry_id),
    worker_id: Number(row.worker_id),
    issue_version: Number(row.issue_version || 1),
    supersedes_payslip_id: row.supersedes_payslip_id ? Number(row.supersedes_payslip_id) : null,
    snapshot: parseJson(row.snapshot_json, {}),
    snapshot_json: undefined,
    verification_url: row.verification_reference ? buildPayslipVerificationUrl(row.verification_reference) : null,
  };
}

async function issuePayslip({ entryId, workspaceCode, actorId }) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await assertSchemaReady(connection);
    const entry = await loadEntryForIssue(connection, entryId, workspaceCode, { lock: true });
    await assertIssuableEntry(connection, entry);

    const [existingRows] = await connection.query(
      `SELECT * FROM payroll_payslips
       WHERE payroll_entry_id = ?
       ORDER BY issue_version DESC, id DESC
       FOR UPDATE`,
      [entry.id]
    );
    const current = existingRows.find((row) => row.issue_status === "current");
    if (current) {
      const snapshot = parseJson(current.snapshot_json, {});
      const checksumValid = checksumSnapshot(snapshot) === current.checksum_sha256;
      if (!checksumValid) {
        throw new PayrollFoundationError(409, "The current payslip snapshot checksum does not match its preserved record.", "PAYROLL_PAYSLIP_CHECKSUM_MISMATCH");
      }
      await connection.commit();
      return { replayed: true, payslip: normalizedPayslipRow(current) };
    }

    const lines = await loadLines(connection, entry.id);
    const payments = await loadActivePayments(connection, entry.id);
    const paidTotal = money(payments.reduce((sum, payment) => sum + payment.amount, 0));
    if (Math.abs(paidTotal - money(entry.net_salary)) > 0.01 || Math.abs(paidTotal - money(entry.amount_paid)) > 0.01) {
      throw new PayrollFoundationError(409, "Active salary payment evidence does not reconcile exactly to the worker's locked net pay.", "PAYROLL_PAYSLIP_PAYMENT_EVIDENCE_MISMATCH");
    }

    const ytd = await loadYtdTotals(connection, entry);
    const latest = existingRows[0] || null;
    const issueVersion = latest ? Number(latest.issue_version || 1) + 1 : 1;
    const payslipNumber = latest?.payslip_number || await nextPayslipNumber(actorId);
    const verificationReference = await uniqueVerificationReference(connection);
    const issuedAt = new Date().toISOString();
    const compensationSnapshot = parseJson(entry.compensation_snapshot_json, {});
    const snapshot = {
      document_type: "chalin03_payroll_payslip",
      document_schema_version: 1,
      company: {
        name: "Chalin 03 Company Limited",
        workspace_code: entry.workspace_code,
        currency_code: cleanText(compensationSnapshot.currency_code || "GHS", 3).toUpperCase() || "GHS",
      },
      payslip: {
        payslip_number: payslipNumber,
        issue_version: issueVersion,
        issued_at: issuedAt,
        verification_reference: verificationReference,
      },
      worker: {
        worker_id: Number(entry.worker_id),
        employee_number: entry.employee_number,
        full_name: entry.worker_name,
        department: entry.department || null,
        role: entry.job_title || null,
        employment_start_date: dateValue(entry.employment_start_date),
        employment_end_date: dateValue(entry.employment_end_date),
        photo_reference: null,
      },
      period: {
        payroll_period_id: Number(entry.payroll_period_id),
        period_code: entry.period_code,
        period_start: dateValue(entry.period_start),
        period_end: dateValue(entry.period_end),
        scheduled_pay_date: dateValue(entry.scheduled_pay_date),
        employment_days: Number(entry.employment_days || 0),
        payable_days: Number(entry.payable_days || 0),
      },
      totals: {
        basic_earned: money(entry.basic_earned),
        gross_earnings: money(entry.gross_earnings),
        total_deductions: money(entry.total_deductions),
        employer_contributions: money(entry.employer_contributions),
        net_salary: money(entry.net_salary),
        amount_paid: money(entry.amount_paid),
        remaining_balance: money(entry.remaining_balance),
      },
      ytd,
      lines,
      payments,
      source_integrity: {
        payroll_entry_checksum_sha256: entry.calculation_checksum_sha256,
        compensation_profile_id: Number(entry.compensation_profile_id),
        payroll_entry_id: Number(entry.id),
      },
    };
    const checksum = checksumSnapshot(snapshot);
    const [result] = await connection.query(
      `INSERT INTO payroll_payslips (
         payroll_entry_id, worker_id, workspace_code, payslip_number, issue_version,
         issue_status, snapshot_json, checksum_sha256, verification_reference,
         supersedes_payslip_id, issued_by, issued_at
       ) VALUES (?, ?, ?, ?, ?, 'current', ?, ?, ?, ?, ?, ?)`,
      [entry.id, entry.worker_id, entry.workspace_code, payslipNumber, issueVersion,
        JSON.stringify(snapshot), checksum, verificationReference, latest?.id || null, actorId,
        issuedAt.slice(0, 19).replace("T", " ")]
    );

    const [createdRows] = await connection.query("SELECT * FROM payroll_payslips WHERE id = ? LIMIT 1", [result.insertId]);
    await connection.commit();
    return { replayed: false, payslip: normalizedPayslipRow(createdRows[0]) };
  } catch (error) {
    try { await connection.rollback(); } catch {}
    throw error;
  } finally {
    connection.release();
  }
}

async function listEntryPayslips({ entryId, workspaceCode, connection = pool }) {
  await assertSchemaReady(connection);
  const entry = await loadEntryForIssue(connection, entryId, workspaceCode);
  const [rows] = await connection.query(
    `SELECT payslip.*, issuer.full_name AS issued_by_name, revoker.full_name AS revoked_by_name
     FROM payroll_payslips payslip
     LEFT JOIN users issuer ON issuer.id = payslip.issued_by
     LEFT JOIN users revoker ON revoker.id = payslip.revoked_by
     WHERE payslip.payroll_entry_id = ? AND payslip.workspace_code = ?
     ORDER BY payslip.issue_version DESC, payslip.id DESC`,
    [entry.id, workspaceCode]
  );
  return { entry, payslips: rows.map(normalizedPayslipRow) };
}

async function getPayslip({ payslipId, workspaceCode, connection = pool }) {
  await assertSchemaReady(connection);
  const id = positiveId(payslipId, "Payslip ID");
  const [rows] = await connection.query(
    `SELECT payslip.*, issuer.full_name AS issued_by_name, revoker.full_name AS revoked_by_name
     FROM payroll_payslips payslip
     LEFT JOIN users issuer ON issuer.id = payslip.issued_by
     LEFT JOIN users revoker ON revoker.id = payslip.revoked_by
     WHERE payslip.id = ? AND payslip.workspace_code = ?
     LIMIT 1`,
    [id, workspaceCode]
  );
  if (!rows[0]) {
    throw new PayrollFoundationError(404, "Payslip was not found in this business category.", "PAYROLL_PAYSLIP_NOT_FOUND");
  }
  const payslip = normalizedPayslipRow(rows[0]);
  if (checksumSnapshot(payslip.snapshot) !== payslip.checksum_sha256) {
    throw new PayrollFoundationError(409, "Payslip snapshot checksum verification failed.", "PAYROLL_PAYSLIP_CHECKSUM_MISMATCH");
  }
  return payslip;
}

async function revokePayslip({ payslipId, workspaceCode, actorId, reason }) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await assertSchemaReady(connection);
    const id = positiveId(payslipId, "Payslip ID");
    const revocationReason = cleanText(reason, 1000);
    if (revocationReason.length < 8) {
      throw new PayrollFoundationError(400, "Record a detailed reason before revoking a payslip.", "PAYROLL_PAYSLIP_REVOCATION_REASON_REQUIRED");
    }
    const [rows] = await connection.query(
      "SELECT * FROM payroll_payslips WHERE id = ? AND workspace_code = ? LIMIT 1 FOR UPDATE",
      [id, workspaceCode]
    );
    const payslip = rows[0];
    if (!payslip) throw new PayrollFoundationError(404, "Payslip was not found in this business category.", "PAYROLL_PAYSLIP_NOT_FOUND");
    if (payslip.issue_status !== "current") {
      throw new PayrollFoundationError(409, "Only the current payslip version can be revoked.", "PAYROLL_PAYSLIP_NOT_CURRENT");
    }
    if (Number(payslip.issued_by) === Number(actorId)) {
      throw new PayrollFoundationError(409, "The person who issued this payslip cannot revoke the same payslip.", "PAYROLL_PAYSLIP_SELF_REVOCATION_FORBIDDEN");
    }
    await connection.query(
      `UPDATE payroll_payslips
       SET issue_status = 'revoked', revoked_by = ?, revoked_at = CURRENT_TIMESTAMP,
           revocation_reason = ?
       WHERE id = ?`,
      [actorId, revocationReason, payslip.id]
    );
    const [updatedRows] = await connection.query("SELECT * FROM payroll_payslips WHERE id = ? LIMIT 1", [payslip.id]);
    await connection.commit();
    return normalizedPayslipRow(updatedRows[0]);
  } catch (error) {
    try { await connection.rollback(); } catch {}
    throw error;
  } finally {
    connection.release();
  }
}

async function revokeCurrentPayslipsForEntry({ entryId, actorId, reason, connection = pool }) {
  await assertSchemaReady(connection);
  const id = positiveId(entryId, "Payroll entry ID");
  const revocationReason = cleanText(reason, 1000);
  if (revocationReason.length < 8) {
    throw new PayrollFoundationError(400, "A detailed payslip revocation reason is required.", "PAYROLL_PAYSLIP_REVOCATION_REASON_REQUIRED");
  }
  const [result] = await connection.query(
    `UPDATE payroll_payslips
     SET issue_status = 'revoked', revoked_by = ?, revoked_at = CURRENT_TIMESTAMP,
         revocation_reason = ?
     WHERE payroll_entry_id = ? AND issue_status = 'current'`,
    [actorId || null, revocationReason, id]
  );
  return { payroll_entry_id: id, revoked_count: Number(result?.affectedRows || 0) };
}

async function publicPayslipVerification(reference, connection = pool) {
  await assertSchemaReady(connection);
  const token = cleanText(reference, 191);
  if (!/^[A-Za-z0-9_-]{24,191}$/.test(token)) {
    return { found: false, valid: false, state: "invalid" };
  }
  const [rows] = await connection.query(
    `SELECT payslip.id, payslip.payslip_number, payslip.issue_version,
            payslip.issue_status, payslip.snapshot_json, payslip.checksum_sha256,
            payslip.issued_at, payslip.revoked_at, payslip.revocation_reason,
            entry.entry_status, entry.remaining_balance, entry.net_salary,
            entry.amount_paid, period.status AS period_status,
            (SELECT COALESCE(SUM(payment.amount), 0)
             FROM payroll_salary_payments payment
             WHERE payment.payroll_entry_id = entry.id
               AND payment.reversal_of_payment_id IS NULL
               AND payment.payment_status = 'posted') AS active_paid,
            (SELECT COUNT(*)
             FROM payroll_adjustment_requests request
             WHERE request.payroll_entry_id = entry.id
               AND request.request_status = 'pending') AS pending_adjustments
     FROM payroll_payslips payslip
     INNER JOIN payroll_entries entry ON entry.id = payslip.payroll_entry_id
     INNER JOIN payroll_periods period ON period.id = entry.payroll_period_id
     WHERE payslip.verification_reference = ?
     ORDER BY payslip.id DESC
     LIMIT 1`,
    [token]
  );
  const row = rows[0];
  if (!row) return { found: false, valid: false, state: "invalid" };
  const snapshot = parseJson(row.snapshot_json, {});
  const checksumValid = checksumSnapshot(snapshot) === row.checksum_sha256;
  if (!checksumValid) {
    return { found: true, valid: false, state: "invalid", integrity_error: true };
  }

  const underlyingCurrent =
    String(row.entry_status || "").toLowerCase() === "paid" &&
    money(row.remaining_balance) <= 0.01 &&
    ["reconciled", "closed"].includes(String(row.period_status || "").toLowerCase()) &&
    Math.abs(money(row.active_paid) - money(row.net_salary)) <= 0.01 &&
    Math.abs(money(row.active_paid) - money(row.amount_paid)) <= 0.01 &&
    Number(row.pending_adjustments || 0) === 0;

  const storedState = ["current", "revoked", "superseded"].includes(row.issue_status) ? row.issue_status : "invalid";
  const state = storedState === "current" && !underlyingCurrent ? "revoked" : storedState;
  return {
    found: true,
    valid: state === "current",
    state,
    verification_title: state === "current" ? "VERIFIED CHALIN 03 PAYSLIP" : `CHALIN 03 PAYSLIP — ${state.toUpperCase()}`,
    payslip_id: Number(row.id),
    payslip_number: row.payslip_number,
    issue_version: Number(row.issue_version || 1),
    employee: maskEmployeeName(snapshot.worker?.full_name),
    employee_number: maskEmployeeNumber(snapshot.worker?.employee_number),
    period: snapshot.period?.period_code || `${snapshot.period?.period_start || ""} – ${snapshot.period?.period_end || ""}`,
    net_pay: money(snapshot.totals?.net_salary),
    currency: snapshot.company?.currency_code || "GHS",
    issued_at: snapshot.payslip?.issued_at || row.issued_at,
    revoked_at: row.revoked_at || null,
    message: state === "current"
      ? "Record matches Chalin 03 payroll system."
      : state === "revoked" && storedState === "current"
        ? "This preserved payslip is no longer current because its underlying reconciled salary-payment evidence changed."
        : state === "revoked"
          ? "This preserved payslip was revoked and must not be treated as the current payroll document."
          : state === "superseded"
            ? "This preserved payslip version has been superseded by a later issued version."
            : "This payslip could not be verified.",
  };
}

module.exports = {
  buildPayslipVerificationUrl,
  createPayslipVerificationQr,
  getPayslip,
  issuePayslip,
  listEntryPayslips,
  maskEmployeeName,
  maskEmployeeNumber,
  publicPayslipVerification,
  revokeCurrentPayslipsForEntry,
  revokePayslip,
};