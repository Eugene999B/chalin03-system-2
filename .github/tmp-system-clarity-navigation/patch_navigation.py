from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def write(path, text):
    (ROOT / path).write_text(text, encoding="utf-8")


def rep(path, old, new, expected=1):
    text = read(path)
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"{path}: expected {expected} match(es), got {count}: {old!r}")
    write(path, text.replace(old, new, expected))


# Spare Parts: replace internal/technical wording with task language while preserving paths/permissions.
p = "frontend/src/components/Layout.jsx"
rep(p, 'title: "Notification Centre"', 'title: "Notifications"', 2)
rep(p, 'title: "Help / User Guide"', 'title: "Help & Guide"', 2)
rep(p, 'description: "Open the business command center"', 'description: "See today’s sales, stock, debt and cash overview"')
rep(p, 'title: "Payroll Processing"', 'title: "Monthly Payroll"')
rep(p, 'description: "Validate, approve, pay and reconcile protected salary cycles"', 'description: "Review workers and salaries, approve the month, record payments and issue payslips"')
rep(p, 'title: isAuditor ? "Auditor Work" : "Main Work"', 'title: isAuditor ? "Auditor Work" : "Daily Work"')
rep(p, 'title: "Shared Reports & Documents"', 'title: "Reports & Documents"')
rep(p, 'title: "Audit & Accounting"', 'title: "Accounting Review"')
rep(p, 'title: "Accounting Intelligence"', 'title: "Accounting Controls"')
rep(p, 'title: "Audit Sign-Off History"', 'title: "Audit Sign-Offs"')
rep(p, 'title: "Group Executive Control"', 'title: "Group Overview"')
rep(p, 'title: "Employment & HR Documents"', 'title: "Employment Documents"')
rep(p, 'title: "SMS Center"', 'title: "SMS Messages"')
rep(p, 'title: "Audit Unlock Requests"', 'title: "Locked-Period Corrections"')
rep(p, 'title: isAuditor ? "Auditor Accounting Work" : "Management"', 'title: isAuditor ? "Audit & Reports" : "Reports & Operations"')
rep(p, 'title: "Users & Settings"', 'title: "Staff Accounts & Settings"')
rep(p, 'title: "User Permissions"', 'title: "Access Permissions"')
rep(p, 'title: "Worker Profiles"', 'title: "People & Employment"')
rep(p, 'description: "Employees, assignments, licences, documents and property"', 'description: "Workers, employment details, assignments, salary, documents and property"')
rep(p, 'title: "Document Signature Settings"', 'title: "Document Signatures"')
rep(p, 'title: "Professional Backups"', 'title: "Backup Verification"')
rep(p, 'title: "System Operations"', 'title: "System Health"')
rep(p, 'title: "Admin Control"', 'title: "Administration"')
rep(p, '<span>🔎 Smart Search</span>', '<span>🔎 Find a Page</span>')
rep(p, '🔎 Smart Command', '🔎 Find a Page')
rep(p, '<p className="premium-command-eyebrow">Smart Navigation</p>', '<p className="premium-command-eyebrow">Quick Navigation</p>')
rep(p, '<h2>Smart Command Center</h2>', '<h2>Find a Page or Task</h2>')
rep(p, 'No matching command found.', 'No matching page or task found.')

# Mining navigation.
p = "frontend/src/layouts/MiningLayout.jsx"
rep(p, 'title: "Mining Dashboard"', 'title: "Mining Overview"')
rep(p, 'title: "Notification Centre"', 'title: "Notifications"')
rep(p, 'title: "Mining Control Centre"', 'title: "Site Control"')
rep(p, 'title: "Equipment Operations"', 'title: "Equipment & Downtime"')
rep(p, 'title: "Fuel Management"', 'title: "Fuel"')
rep(p, 'title: "Mining Expenses"', 'title: "Expenses"')
rep(p, 'title: "Mining Resources"', 'title: "People, Fleet & Reports"')
rep(p, 'title: "Mining Workforce"', 'title: "People & Employment"')
rep(p, 'title: "Payroll Processing"', 'title: "Monthly Payroll"')
rep(p, 'description: "Validate, approve, pay and reconcile protected salary cycles"', 'description: "Review workers and salaries, approve the month, record payments and issue payslips"')
rep(p, 'title: "Employment & HR Documents"', 'title: "Employment Documents"')
rep(p, 'title: "Document Signature Settings"', 'title: "Document Signatures"')
rep(p, 'title: "Mining Administration"', 'title: "Sites & Access"')
rep(p, 'title: "Mining Help"', 'title: "Help & Guide"')

# Equipment Hire navigation.
p = "frontend/src/layouts/EquipmentHireLayout.jsx"
rep(p, 'title: "Equipment Hire Operations"', 'title: "Hire Work"')
rep(p, 'title: "Hire Operations Dashboard"', 'title: "Hire Overview"')
rep(p, 'title: "Hire Customers"', 'title: "Customers"')
rep(p, 'title: "Hire Enquiries"', 'title: "Enquiries"')
rep(p, 'title: "Hire Availability"', 'title: "Equipment Availability"')
rep(p, 'title: "Hire Quotations"', 'title: "Quotations"')
rep(p, 'title: "Hire Contracts"', 'title: "Contracts"')
rep(p, 'title: "Hire Commercial Control"', 'title: "Rates, Deposits & Amendments"')
rep(p, 'title: "Hire Invoices & Payments"', 'title: "Invoices & Payments"')
rep(p, 'title: "Hire Reports"', 'title: "Reports"')
rep(p, 'title: "Hire Notification Centre"', 'title: "Notifications"')
rep(p, 'title: "Division Control"', 'title: "Equipment Business"')
rep(p, 'title: "Back to Equipment Divisions"', 'title: "Switch Equipment Division"')
rep(p, 'title: "Hire Resources"', 'title: "People, Equipment & Reports"')
rep(p, 'title: "Hire Equipment Register"', 'title: "Equipment Register"')
rep(p, 'title: "Hire Documents"', 'title: "Documents"')
rep(p, 'title: "Hire Reports & Audit"', 'title: "Reports & Audit"')
rep(p, 'title: "Staff & Workforce"', 'title: "People & Employment"')
rep(p, 'title: "Payroll Processing"', 'title: "Monthly Payroll"')
rep(p, 'description: "Validate, approve, pay and reconcile protected salary cycles"', 'description: "Review workers and salaries, approve the month, record payments and issue payslips"')
rep(p, 'title: "Document Signature Settings"', 'title: "Document Signatures"')
rep(p, 'title: "Hire Locations"', 'title: "Locations & Access"')
rep(p, 'title: "Equipment Hire Help"', 'title: "Help & Guide"')

# Equipment Installment Finance navigation.
p = "frontend/src/layouts/InstallmentFinanceLayout.jsx"
rep(p, 'title: "Installment Workflow"', 'title: "Start & Approve"')
rep(p, 'title: "Task & Approval Inbox"', 'title: "Work Inbox"')
rep(p, 'title: "Case Operations"', 'title: "Customer Case"')
rep(p, 'title: "Accounts & Payments"', 'title: "Accounts & Collections"')
rep(p, 'title: "Payments & Arrears"', 'title: "Arrears & Follow-up"')
rep(p, 'title: "Secure Case Documents"', 'title: "Private Case Files"')
rep(p, 'title: "Generated Documents"', 'title: "Issued Documents"')
rep(p, 'title: "Portfolio, SMS & Reports"', 'title: "Reports & Statements"')
rep(p, 'title: "Staff & Workforce"', 'title: "People & Employment"')
rep(p, 'title: "Payroll Processing"', 'title: "Monthly Payroll"')
rep(p, 'description: "Validate, approve, pay and reconcile protected salary cycles"', 'description: "Review workers and salaries, approve the month, record payments and issue payslips"')
rep(p, 'title: "Final Operations & Reset"', 'title: "Completion & Reset Checks"')
rep(p, 'title: "Back to Equipment Divisions"', 'title: "Switch Equipment Division"')

# Permanent source-contract test.
test_path = ROOT / "frontend/scripts/systemClarityNavigationTests.mjs"
test_path.write_text(r'''import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path) => readFileSync(join(root, path), "utf8");

const spare = read("src/components/Layout.jsx");
const mining = read("src/layouts/MiningLayout.jsx");
const hire = read("src/layouts/EquipmentHireLayout.jsx");
const finance = read("src/layouts/InstallmentFinanceLayout.jsx");

for (const source of [spare, mining, hire, finance]) {
  assert.match(source, /title: "Monthly Payroll"/);
  assert.doesNotMatch(source, /title: "Payroll Processing"/);
}

assert.match(spare, /title: isAuditor \? "Auditor Work" : "Daily Work"/);
assert.match(spare, /title: isAuditor \? "Audit & Reports" : "Reports & Operations"/);
assert.match(spare, /title: "People & Employment"/);
assert.match(spare, /title: "Staff Accounts & Settings"/);
assert.match(spare, /title: "Access Permissions"/);
assert.match(spare, /<h2>Find a Page or Task<\/h2>/);
assert.match(spare, /path: "\/payroll"/);
assert.match(spare, /path: "\/workers"/);

assert.match(mining, /title: "Site Control"/);
assert.match(mining, /title: "People, Fleet & Reports"/);
assert.match(mining, /title: "People & Employment"/);
assert.match(mining, /path: "\/mining\/control-centre"/);
assert.match(mining, /path: "\/mining\/payroll"/);

assert.match(hire, /title: "Hire Work"/);
assert.match(hire, /title: "Rates, Deposits & Amendments"/);
assert.match(hire, /title: "Switch Equipment Division"/);
assert.match(hire, /title: "People & Employment"/);
assert.match(hire, /path: "\/equipment-hire-operations\/commercial-control"/);
assert.match(hire, /path: "\/equipment-hire-operations\/payroll"/);

assert.match(finance, /title: "Start & Approve"/);
assert.match(finance, /title: "Work Inbox"/);
assert.match(finance, /title: "Customer Case"/);
assert.match(finance, /title: "Accounts & Collections"/);
assert.match(finance, /title: "Arrears & Follow-up"/);
assert.match(finance, /title: "People & Employment"/);
assert.match(finance, /title: "Completion & Reset Checks"/);
assert.match(finance, /path: "\/equipment-installment-finance\/applications\?stage=inbox"/);
assert.match(finance, /path: "\/equipment-installment-finance\/payroll"/);

console.log("System Clarity navigation source contract passed.");
''', encoding="utf-8")

# Add the new contract to the full frontend suite.
p = "frontend/package.json"
rep(
    p,
    'node scripts/backupRestoreDirectApiTests.mjs"',
    'node scripts/backupRestoreDirectApiTests.mjs && node scripts/systemClarityNavigationTests.mjs"',
)

print("System Clarity navigation patch applied.")
