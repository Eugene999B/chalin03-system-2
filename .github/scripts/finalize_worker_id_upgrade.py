from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(relative_path: str) -> str:
    return (ROOT / relative_path).read_text(encoding="utf-8")


def write(relative_path: str, content: str) -> None:
    (ROOT / relative_path).write_text(content, encoding="utf-8")


def require_replace(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f"Could not locate {label}.")
    return text.replace(old, new, 1)


service = read("backend/services/workerIdentityService.js")
allocation_pattern = re.compile(
    r"  const nextNumber = Number\(sequenceRows\[0\]\?\.last_number \|\| 0\) \+ 1;"
    r"[\s\S]*?"
    r"  const employeeNumber = formatEmployeeNumber\(\n"
    r"    settings\.employeePrefix,\n"
    r"    workspace,\n"
    r"    nextNumber\n"
    r"  \);"
)
allocation_replacement = '''  let nextNumber = Number(sequenceRows[0]?.last_number || 0) + 1;
  let employeeNumber = "";
  let identityAllocated = false;

  for (let attempt = 0; attempt < 100000; attempt += 1) {
    const candidate = formatEmployeeNumber(
      settings.employeePrefix,
      workspace,
      nextNumber
    );
    const [existingRows] = await connection.query(
      `SELECT id
       FROM worker_profiles
       WHERE employee_number = ?
       LIMIT 1`,
      [candidate]
    );

    if (!existingRows.length) {
      employeeNumber = candidate;
      identityAllocated = true;
      break;
    }

    nextNumber += 1;
  }

  if (!identityAllocated) {
    const error = new Error(
      "A unique employee number could not be allocated safely."
    );
    error.code = "WORKER_ID_SEQUENCE_EXHAUSTED";
    throw error;
  }

  await connection.query(
    `UPDATE worker_identity_sequences
     SET last_number = ?
     WHERE workspace_code = ?`,
    [nextNumber, workspace]
  );'''
service, replacement_count = allocation_pattern.subn(
    allocation_replacement,
    service,
    count=1,
)
if replacement_count != 1:
    raise RuntimeError("Could not harden employee-number allocation.")
write("backend/services/workerIdentityService.js", service)

routes = read("backend/routes/workerProfileExpansionRoutes.js")
routes = require_replace(
    routes,
    "payload.employment_start_date || new Date()",
    "new Date()",
    "worker card issue-date source",
)
write("backend/routes/workerProfileExpansionRoutes.js", routes)

worker_page = read("frontend/src/pages/ExpandedWorkerProfilePage.jsx")
for controlled_field in (
    '  ["id_card_issue_date", "ID card issue date", "date"],\n',
    '  ["id_card_expiry_date", "ID card expiry date", "date"],\n',
    '  ["id_card_serial", "ID card serial / reference"],\n',
):
    worker_page = worker_page.replace(controlled_field, "", 1)

heading = "          <h2>Create Worker Profile</h2>"
heading_start = worker_page.index(heading)
full_name_line = '["full_name", "Full legal name"],'
full_name_start = worker_page.index(full_name_line, heading_start)
full_name_end = worker_page.index("\n", full_name_start) + 1
clean_create_start = '''          <h2>Create Worker Profile</h2>

          <form
            className="expanded-worker-form-grid"
            onSubmit={createWorker}
          >
            <Notice type="info">
              Employee number, card serial, issue date and expiry date are generated automatically from Business & ID Settings.
            </Notice>

            {[
              ["full_name", "Full legal name"],
'''
worker_page = (
    worker_page[:heading_start]
    + clean_create_start
    + worker_page[full_name_end:]
)
write("frontend/src/pages/ExpandedWorkerProfilePage.jsx", worker_page)

settings_routes = read("backend/routes/settingsRoutes.js")
settings_routes = re.sub(
    r"\n\s+receipt_footer = \?,\n\s+receipt_prefix = \?,\n"
    r"\s+worker_id_card_validity_months = \?,\n"
    r"\s+worker_employee_number_prefix = \?",
    "\n           receipt_footer = ?,\n"
    "           receipt_prefix = ?,\n"
    "           worker_id_card_validity_months = ?,\n"
    "           worker_employee_number_prefix = ?",
    settings_routes,
    count=1,
)
write("backend/routes/settingsRoutes.js", settings_routes)

tests = read("backend/tests/release3fD2WorkerIdentityCard.test.js")
if "skips matching legacy employee numbers" not in tests:
    tests += '''

test("Release 3F-D2 skips matching legacy employee numbers and issues cards today", () => {
  const service = read("backend/services/workerIdentityService.js");
  const routes = read("backend/routes/workerProfileExpansionRoutes.js");
  assert.match(service, /FROM worker_profiles[\\s\\S]*WHERE employee_number = \\?/);
  assert.match(service, /identityAllocated/);
  assert.match(routes, /allocateWorkerIdentity\\(\\s*connection,\\s*workspaceCode,\\s*new Date\\(\\)/);
});
'''
write("backend/tests/release3fD2WorkerIdentityCard.test.js", tests)

verification_path = ROOT / ".github/workflows/chalin03-verification.yml"
verification = verification_path.read_text(encoding="utf-8")
verification = verification.replace("contents: write", "contents: read", 1)
temporary_start = "  # BEGIN TEMPORARY WORKER ID FINALIZER\n"
temporary_end = "  # END TEMPORARY WORKER ID FINALIZER\n"
if temporary_start in verification and temporary_end in verification:
    start = verification.index(temporary_start)
    end = verification.index(temporary_end, start) + len(temporary_end)
    verification = verification[:start] + verification[end:]
if "src/pages/UsersSettingsPage.jsx" not in verification:
    verification = require_replace(
        verification,
        "            src/pages/SystemOperationsPage.jsx",
        "            src/pages/SystemOperationsPage.jsx \\\n"
        "            src/pages/UsersSettingsPage.jsx \\\n"
        "            src/pages/ExpandedWorkerProfilePage.jsx",
        "strict worker identity lint list",
    )
verification = verification.replace(
    "Lint Release 3F-D frontend files",
    "Lint protected release frontend files",
    1,
)
verification_path.write_text(verification, encoding="utf-8")

for temporary_path in (
    ROOT / ".github/workflows/finalize-worker-id-upgrade.yml",
    ROOT / ".github/scripts/finalize_worker_id_upgrade.py",
):
    temporary_path.unlink(missing_ok=True)

print("Worker ID review fixes applied and temporary finalizers removed.")
