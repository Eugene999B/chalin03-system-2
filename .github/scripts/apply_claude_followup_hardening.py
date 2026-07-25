from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


legacy_path = Path("backend/routes/release2FinalRoutes.js")
legacy = legacy_path.read_text()
owner_start_marker = 'router.post(\n  "/owner/login",'
owner_next_marker = 'router.get(\n  "/owner/events",'
start = legacy.find(owner_start_marker)
end = legacy.find(owner_next_marker, start + 1)
if start < 0 or end < 0 or end <= start:
    raise SystemExit("Could not locate the legacy Owner login block safely.")
legacy = (
    legacy[:start]
    + "// Owner Break-Glass authentication is implemented exclusively in\n"
      "// ownerSecurityRoutes.js, where password plus MFA/recovery-code evidence\n"
      "// is mandatory. Do not add a second login handler to this legacy router.\n\n"
    + legacy[end:]
)
if owner_start_marker in legacy:
    raise SystemExit("Legacy Owner login block still exists after removal.")
legacy_path.write_text(legacy)


closing_path = Path("backend/routes/dailyClosingRoutes.js")
closing = closing_path.read_text()
helper_anchor = """function buildClosingSmsMessage({
  summary,
  closingDate,
  totalCounted,
  differenceTotal,
  closedByName,
}) {"""
helper = """function buildExpenseCorrectionPresentation(expense = {}) {
  const isVoided = Number(expense.is_voided || 0) === 1;
  const isReversal = Number(expense.is_reversal || 0) === 1;
  const category = cleanText(expense.category || "Other", 180) || "Other";
  const description = cleanText(expense.description, 5000);

  if (!isVoided && !isReversal) {
    return {
      correction_status: "active",
      correction_reference: null,
      display_category: category,
      display_description: description || null,
    };
  }

  const statusLabel = isReversal ? "REVERSAL" : "VOIDED";
  const reference = cleanText(
    expense.reversal_reference || expense.void_reference,
    180
  );
  const reason = cleanText(expense.void_reason, 1000);
  const actorEvidence = [
    expense.voided_by_name
      ? `Voided by ${cleanText(expense.voided_by_name, 160)}`
      : null,
    expense.void_approved_by_name
      ? `Approved by ${cleanText(expense.void_approved_by_name, 160)}`
      : null,
  ]
    .filter(Boolean)
    .join("; ");

  const evidence = [
    description || null,
    reference ? `Correction reference ${reference}` : null,
    reason ? `Reason: ${reason}` : null,
    isReversal && expense.reversal_of_expense_id
      ? `Reverses expense ${Number(expense.reversal_of_expense_id)}`
      : null,
    actorEvidence || null,
  ]
    .filter(Boolean)
    .join(" | ");

  return {
    correction_status: isReversal ? "reversal" : "voided",
    correction_reference: reference || null,
    display_category: `${statusLabel} — ${category}`,
    display_description: evidence || `${statusLabel} expense evidence`,
  };
}

function buildClosingSmsMessage({
  summary,
  closingDate,
  totalCounted,
  differenceTotal,
  closedByName,
}) {"""
closing = replace_once(closing, helper_anchor, helper, "Daily Closing correction helper insertion")

old_expense_query = """    `SELECT
      e.id,
      e.category,
      e.amount,
      e.payment_method,
      e.funding_source,
      e.affects_daily_closing,
      e.closing_treatment_note,
      e.description,
      e.expense_date,
      e.created_at,
      COALESCE(u.full_name, 'System') AS recorded_by_name
     FROM expenses e
     LEFT JOIN users u ON e.recorded_by = u.id
     WHERE e.branch_id = ?
     AND e.expense_date = ?
     ORDER BY e.created_at ASC, e.id ASC`,
    [branchId, closingDate]
  );

  const [returns] = await connection.query("""
new_expense_query = """    `SELECT
      e.id,
      e.category,
      e.amount,
      e.payment_method,
      e.funding_source,
      e.affects_daily_closing,
      e.closing_treatment_note,
      e.description,
      e.expense_date,
      e.created_at,
      e.is_voided,
      e.void_reason,
      e.void_reference,
      e.voided_at,
      e.void_approved_at,
      e.is_reversal,
      e.reversal_of_expense_id,
      e.reversal_reference,
      COALESCE(u.full_name, 'System') AS recorded_by_name,
      voider.full_name AS voided_by_name,
      void_approver.full_name AS void_approved_by_name
     FROM expenses e
     LEFT JOIN users u ON e.recorded_by = u.id
     LEFT JOIN users voider ON e.voided_by = voider.id
     LEFT JOIN users void_approver ON e.void_approved_by = void_approver.id
     WHERE e.branch_id = ?
     AND e.expense_date = ?
     ORDER BY e.created_at ASC, e.id ASC`,
    [branchId, closingDate]
  );

  for (const expense of expenses) {
    Object.assign(expense, buildExpenseCorrectionPresentation(expense));
  }

  const [returns] = await connection.query("""
closing = replace_once(closing, old_expense_query, new_expense_query, "Daily Closing expense evidence query")
closing = replace_once(
    closing,
    """      expense.category,
      Number(expense.amount || 0),""",
    """      expense.display_category || expense.category,
      Number(expense.amount || 0),""",
    "Excel expense category presentation",
)
closing = replace_once(
    closing,
    """        expense.description || null,
        expense.closing_treatment_note || null,""",
    """        expense.display_description || expense.description || null,
        expense.closing_treatment_note || null,""",
    "Excel expense description presentation",
)
closing = replace_once(
    closing,
    """      { key: "category", label: "Category", width: 120, maxLength: 22 },
      { key: "description", label: "Description", width: 245, maxLength: 48 },""",
    """      {
        key: "category",
        label: "Category",
        width: 120,
        maxLength: 22,
        value: (item) => item.display_category || item.category,
      },
      {
        key: "description",
        label: "Description",
        width: 245,
        maxLength: 48,
        value: (item) => item.display_description || item.description,
      },""",
    "PDF expense presentation",
)
closing = replace_once(
    closing,
    '${wordCell(expense.category || "Other")}\n                ${wordCell(expense.description || null)}',
    '${wordCell(expense.display_category || expense.category || "Other")}\n                ${wordCell(expense.display_description || expense.description || null)}',
    "Word expense presentation",
)
closing_path.write_text(closing)


test_path = Path("backend/tests/claudeFollowupHardening.test.js")
test_path.write_text("""const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const backendRoot = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(backendRoot, relativePath), "utf8");

test("Owner Break-Glass login has one MFA-enforcing implementation", () => {
  const secureRoutes = read("routes/ownerSecurityRoutes.js");
  const legacyRoutes = read("routes/release2FinalRoutes.js");
  const server = read("server.js");
  assert.match(secureRoutes, /router\.post\(\s*["']\\\/owner\\\/login["']/);
  assert.match(secureRoutes, /mfa_code|recovery_code/);
  assert.doesNotMatch(legacyRoutes, /router\.post\(\s*["']\\\/owner\\\/login["']/);
  assert.match(server, /app\.use\(["']\\\/api\\\/release2-final["'],\s*ownerSecurityRoutes\)/);
});

test("Daily Closing exposes correction evidence consistently in all outputs", () => {
  const source = read("routes/dailyClosingRoutes.js");
  assert.match(source, /function buildExpenseCorrectionPresentation/);
  assert.match(source, /e\.is_voided/);
  assert.match(source, /e\.is_reversal/);
  assert.match(source, /display_category: `\$\{statusLabel\} — \$\{category\}`/);
  assert.match(source, /expense\.display_category \|\| expense\.category/);
  assert.match(source, /expense\.display_description \|\| expense\.description/);
  assert.match(source, /item\.display_category \|\| item\.category/);
  assert.match(source, /item\.display_description \|\| item\.description/);
  assert.match(source, /wordCell\(expense\.display_category \|\| expense\.category/);
});
""")

release_path = Path("docs/RELEASE_2026-07-25_PHASE1_POST_PHASE1.md")
release = release_path.read_text()
if "## Independent post-release review follow-up" not in release:
    release += """

## Independent post-release review follow-up

A later independent Slack review identified one genuine dormant security risk and one reporting-consistency gap. The follow-up hardening:

- removed the shadowed password-only `/owner/login` implementation from the legacy Release 2 router, leaving the MFA/recovery-code implementation as the only Owner Break-Glass login path;
- retained the existing fail-closed Spare Parts branch middleware after confirming the claimed active branch-1 fallback was not reachable through protected routes;
- added explicit `VOIDED` and `REVERSAL` correction evidence to Daily Closing PDF, Excel and Word output data, matching the browser control evidence while preserving both immutable ledger rows;
- added permanent regression tests for the unique MFA login route and cross-format expense-correction presentation.

This is post-release defence-in-depth and evidence consistency work. It does not rewrite the original 95/100 audit result or imply that the deployed release had an active Critical or High incident.
"""
release_path.write_text(release)
