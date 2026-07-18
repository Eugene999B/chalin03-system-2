
## Release 1.2 — SMS Delivery Report and Safe History Clearing

- Recognizes Arkesel's live `message_status` field (`DELIVERED`, `SUBMITTED`, `NOT_DELIVERED`, and related states) during automatic status checks.
- Keeps provider polling and callbacks automatic; staff do not confirm delivery manually.
- Adds administrator-only **Clear SMS History**, which archives records from the active page rather than deleting audit evidence.
- Adds **Archived History** viewing and controlled restoration.
- Records clear and restore operations in the activity log.
- Requires the additive `database/20260716_sms_report_and_history_archive_migration.sql` migration before deploying the Release 1.2 code.

# Chalin 03 Group Operations Platform

Production business-control platform for **Chalin 03 Company Limited**, prepared by **Eugene Amankwah Appiah**.

The platform combines:

- Spare Parts sales and inventory for two stores
- Mining Operations
- Equipment Hire
- Shared Fleet and equipment control
- Operations documents and reports
- Group Executive management
- Cash Control and Audit Security
- SMS communication
- Backup, export and recovery tools

## Current Production Status

| Item | Current value |
|---|---|
| Frontend | `https://chalin03.com` and `https://www.chalin03.com` |
| Backend API | `https://api.chalin03.com/api` |
| Frontend hosting | Cloudflare Pages |
| Backend hosting | Railway |
| Database | Railway MySQL |
| Production branch | `main` |
| Verified live release | `9024281` — Release advanced cash control and audit security |
| Verified release tag | `cash-control-security-v2-live-20260715` |
| Cash-control migration | `database/20260714_cash_control_security_migration.sql` |
| Migration verification | `database/20260714_cash_control_security_verify.sql` |
| Migration status | Applied successfully to production and verified |
| WhatsApp receipts | Code ready; keep disabled until Meta Cloud API setup is approved |

The application is in real business use. Treat production data as more important than code because code can be restored from GitHub, while lost business records may be difficult to reconstruct.

## Technology Stack

### Frontend

- React
- Vite
- React Router
- Axios
- CSS
- PWA/install support

### Backend

- Node.js
- Express
- MySQL / `mysql2`
- JWT authentication
- bcrypt password hashing
- PDFKit
- ExcelJS
- SMS provider integration

### Hosting

```text
Browser
  → Cloudflare Pages frontend
  → https://api.chalin03.com/api
  → Railway Express backend
  → Railway MySQL
  → Arkesel SMS
```

## Business Workspaces

### Spare Parts

Spare Parts operates with two independent stores. Store selection controls:

- Products and quantities
- Sales and receipts
- Customers and debts
- Purchases and suppliers
- Expenses
- Returns and refunds
- Daily Closing
- Reports and exports
- Stock adjustments
- Stock transfers
- Activity Log scope

Always confirm the active store before saving a transaction.

### Mining Operations

Mining sites are created by administrators and are not Spare Parts stores.

Mining includes:

- Site administration
- Daily site logs
- Production
- Equipment shifts
- Fuel
- Expenses
- Incidents
- Reports and documents
- Role and site access
- Shared Fleet context

### Equipment Hire

Hire locations, yards and bases are created by administrators and are separate from Spare Parts stores.

Equipment Hire includes:

- Customers and enquiries
- Quotations
- Contracts
- Equipment assignment
- Dispatch
- Job cards
- Invoices
- Deposits and payments
- Return inspection
- Statements and documents
- Role and location access
- Shared Fleet context

### Shared Fleet

Each excavator or machine should be registered once. Fleet records cover:

- Availability
- Assignment
- Current location
- Operator
- Meter readings
- Fuel
- Inspections
- Maintenance
- Breakdown
- Service due
- Document expiry
- Archive history

### Group Executive and Operations Documents

Group Executive Control is a read-only management command view. It presents group revenue, payments received, captured operating cost, receivables, an indicative operating position, business-unit scorecards, Daily Closing exceptions, financial trends, store comparison, Mining incidents, overdue Hire invoices, Fleet risks and a prioritized management action queue. Operational editing remains inside Spare Parts, Mining, Equipment Hire and Fleet. Authorized management can download the professional executive workbook.

## User and Permission Model

The platform uses one central user-account foundation. Users may receive access to one or more workspaces and then receive authorized stores, Mining sites or Hire locations.

Common roles include:

- Group Administrator
- Administrator
- Manager
- Cashier
- Accountant
- Auditor
- Mining site roles
- Equipment Hire operational roles
- Fleet roles
- System Administrator

Important controls:

- Staff must use their own account.
- Cashiers remain Spare Parts-specific.
- Mining and Hire permissions are workspace-specific.
- Auditors remain controlled or read-only where required.
- The creator or submitter should not approve or verify their own sensitive action.
- A different manager or administrator is required for protected corrections, financial refunds and Daily Closing verification.

## Cash Control and Audit Security V2

Cash Control V2 is part of the verified live release.

### Why it exists

A total received amount is not always the same as physical cash in hand. The system now separates:

- Cash
- Mobile Money
- Bank
- Other / unallocated

It also preserves evidence when a completed transaction is corrected after submission or closing.

### Daily Closing calculation

Expected physical cash is based on:

```text
Cash sales
+ Cash part of Mixed sales
+ Cash part-payments on Credit sales
+ Cash debt collections
- Cash expenses
- Cash refunds
= Expected physical cash
```

The former Cash Drawer Control fields are retained only for historical database compatibility. They are not part of the current Daily Closing form or new closing calculation.

MoMo, Bank and Other balances are reconciled separately.

### Manual count rule

The system must not automatically copy expected values into counted values.

Staff must:

1. Enter the real physical Cash count.
2. Confirm the actual MoMo balance.
3. Confirm the actual Bank balance.
4. Confirm Other where applicable.
5. Explain every shortage or excess.
6. Confirm that the figures were independently checked.
7. Submit the closing.
8. Allow a different manager or administrator to verify it.

Never force a difference to zero merely to make the closing appear balanced.

### Denomination counting

The physical-cash count supports:

- GHS 200 notes
- GHS 100 notes
- GHS 50 notes
- GHS 20 notes
- GHS 10 notes
- GHS 5 notes
- GHS 2 notes
- GHS 1 notes
- Coins total value

Denomination counting is optional. Staff may enter Cash Counted directly and save without note-and-coin quantities. When the optional counter is enabled, it calculates Cash Counted and its total must match the submitted cash figure.

### Simplified closing workflow

The current boss-approved workflow does not display Cash Drawer Control, opening float, deposits, withdrawals or other drawer-movement fields. New closings store neutral compatibility values for those historical columns. Cash, MoMo, Bank and Other reconciliation, variance notes, independent verification, revisions and changed-after-closing evidence remain active.

### Payment allocations

New sales preserve the exact amount received through:

- Cash
- MoMo
- Bank
- Other

This is especially important for:

- Mixed sales
- Part-paid Credit sales
- Initial payments that create a remaining debt

Only the Cash allocation should enter expected physical cash.

### Protected completed-sale changes

Completed sales must not be silently rewritten.

The protected workflow preserves:

- Original sale header
- Original items
- Corrected sale header
- Corrected items
- Products
- Quantities
- Prices
- Discount
- Customer
- Payment type
- Payment allocations
- Amount paid
- Debt effect
- Stock effect
- Reason
- Requesting user
- Approving user
- Date and time

A different active manager or administrator authorizes the change with their own credentials.

### Returns and refunds

Returns distinguish:

- Stock-only return
- Financial refund

A financial refund requires:

- Exact amount
- Exact refund channel
- Reference for electronic refunds
- Clear reason
- Independent manager or administrator approval

Approved refunds reduce the matching Daily Closing channel.

### Closing revisions

The system preserves Daily Closing evidence through revision history.

- Revision 1 preserves the original or historical closing.
- A later approved change may mark the closing `Changed After Closing`.
- The original closing is not silently overwritten.
- A different manager or administrator enters reconciliation notes.
- Later revisions preserve revised expected figures and review evidence.
- Historical closings created before Cash Control V2 remain legacy records and must not be described as independently verified.

### Manager verification

Daily Closing verification requires:

- An active manager or administrator
- Their own password
- A verifier different from the original submitter
- Review of changes and variance
- Reconciliation first when the closing changed after submission

Verification confirms that management reviewed the evidence. It does not erase a genuine shortage or excess.

## Activity Log and Security Exports

Activity Log supports grouped review and downloads.

Categories include:

- Logins & Account Security
- Sales & Receipts
- Products, Stock & Transfers
- Daily Closing & Cash Control
- Debts & Payments
- Expenses & Purchases
- Returns & Refunds
- Users, Roles & Access
- Audit, Approvals & Security
- Backups, Restores & Exports
- Mining Operations
- Equipment Hire
- Other System Activity

Filters include:

- Date range
- Store or branch
- User
- Action
- Category

Download formats:

- Excel
- PDF
- Word
- CSV

Use Activity Log evidence when investigating:

- Login access
- Sale corrections
- Voids
- Refunds
- Post-closing changes
- Repeated adjustments
- Closing shortages or excesses
- Sensitive administration

## Reports and Export Centre

Professional exports are available for major record groups, including:

- Products and Inventory
- Low Stock / Restock
- Stock Adjustments
- Stock Transfers
- Stock Movement Ledger
- Sales
- Debts
- Debt Payments
- Expenses
- Purchases
- Returns
- Daily Closings
- Activity Logs

Supported report formats include:

- Excel for analysis
- PDF for fixed management presentation
- Word for editable notes and reports
- CSV where supported

Daily Closing reports include:

- Store and date
- Payment-channel summary
- Expected versus counted
- Optional denomination evidence
- Variance
- Exceptions
- Returns and refunds
- Verification
- Revision history
- Changed-after-closing evidence
- Clean-hands status

## Stock Control

### Stock adjustments

Use stock adjustment only for a genuine manual correction such as:

- Damage
- Loss
- Physical count difference
- Wrong entry
- Approved count correction

The system keeps:

- Old quantity
- New quantity
- Adjustment type
- Reason
- User
- Store
- Date and time

Do not use stock adjustment to imitate a sale, purchase, return or transfer.

### Stock transfers

Transfer workflow:

```text
Request → Approve → Dispatch → Receive
```

Meaning:

- Request creates the transfer.
- Approve authorizes it.
- Dispatch reduces source-store stock.
- Receive increases destination-store stock.

Approval alone does not move stock.

### Product detail, restock and correction separation

Product editing and stock movement are separate controls:

- **Edit Product Details** changes description, pricing, barcode, low-stock level and active status without changing quantity.
- **Receive / Restock** records stock received, supplier or source, reference number, unit cost, received date, notes and the receiving user.
- **Adjust / Correct** records damaged stock, lost or missing stock, physical counts and authorized corrections.
- Supplier purchases remain the preferred full-invoice restocking workflow. Quick Restock is for legitimate received stock that does not require a complete purchase transaction.

Every quantity movement must appear in the Stock Movement Ledger and Activity Log.

### Product stock ledger

Use the product ledger to review:

- Opening stock
- Purchases
- Sales
- Returns
- Adjustments
- Transfers in
- Transfers out
- Running balance

## SMS and WhatsApp

### SMS

Arkesel SMS support includes:

- SMS Center
- Custom messages
- Receipt SMS
- Debt reminders
- Low-stock alerts
- Daily summary
- Provider reference and response evidence
- SMS segment and estimated-credit evidence
- Delivery-status filters and controlled retry

SMS status meanings:

- `Accepted by provider` means the provider accepted the submission and credit may have been used. It does not prove that the phone received the message.
- `Delivered` is shown only after explicit delivery evidence.
- `Delivery unknown` means the provider result cannot safely prove success or failure. Check the provider dashboard before retrying.
- Automatic retry is limited to `Failed`, `Undelivered`, or `Expired` records to reduce duplicate charges.

Keep provider credentials and the delivery callback secret private.

### WhatsApp

WhatsApp receipt code is prepared but should remain disabled until Meta setup is complete:

```env
WHATSAPP_RECEIPT_ENABLED=false
```

A failed SMS or WhatsApp attempt must never cancel a valid sale.

## Project Structure

```text
chalin03-system/
├── backend/
│   ├── config/
│   ├── middleware/
│   ├── routes/
│   ├── scripts/
│   ├── security/
│   ├── services/
│   ├── tests/
│   ├── utils/
│   ├── server.js
│   └── package.json
├── database/
│   ├── migrations/
│   ├── schema.sql
│   ├── schema_verify.sql
│   ├── 20260714_cash_control_security_migration.sql
│   └── 20260714_cash_control_security_verify.sql
├── docs/
├── frontend/
│   ├── src/
│   │   ├── api/
│   │   ├── components/
│   │   ├── context/
│   │   ├── pages/
│   │   ├── security/
│   │   └── styles/
│   ├── package.json
│   └── vite.config.js
├── README.md
└── .gitignore
```

## Local Requirements

Install:

- Git for Windows
- Node.js LTS
- MySQL Server
- MySQL Workbench
- VS Code
- Chrome or Edge

## Current Windows Working Folder

Current controlled working folder:

```text
C:\Users\DDK\Desktop\chalin03-daily-closing-development
```

Use a fresh GitHub clone on another device rather than copying `node_modules`.

## New Device Setup

Clone:

```bat
cd /d C:\Users\DDK\Desktop

git clone https://github.com/Eugene999B/chalin03-system-2.git chalin03-system

cd /d C:\Users\DDK\Desktop\chalin03-system
git switch main
git pull --ff-only origin main
```

Install backend:

```bat
cd /d C:\Users\DDK\Desktop\chalin03-system\backend
npm install
```

Install frontend:

```bat
cd /d C:\Users\DDK\Desktop\chalin03-system\frontend
npm install
```

Do not copy `node_modules` from another computer.

## Environment Variables

Never commit real `.env` files.

### Backend local template

```env
NODE_ENV=development
PORT=5000
FRONTEND_URL=http://localhost:5173
FRONTEND_URL_ALT=http://localhost:3000

DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_local_mysql_password
DB_NAME=chalin03_db
DB_CONNECTION_LIMIT=10
DB_SSL=false

JWT_SECRET=generate_a_long_private_secret

SYSTEM_ADMIN_USER_ID=1
SYSTEM_ADMIN_USERNAME=admin
ALLOW_CLEAR_BUSINESS_DATA=true

SMS_ENABLED=false
SMS_PROVIDER=mock
SMS_SENDER_ID=CHALIN03
SMS_ARKESEL_API_KEY=
SMS_ARKESEL_BASE_URL=https://sms.arkesel.com/api/v2/sms/send
SMS_TIMEOUT_MS=15000
SMS_DELIVERY_WEBHOOK_SECRET=generate_a_long_private_callback_secret

WHATSAPP_RECEIPT_ENABLED=false
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_TEMPLATE_NAME=receipt_notification
WHATSAPP_TEMPLATE_LANGUAGE=en
```

### Frontend local template

```env
VITE_API_URL=http://localhost:5000/api
```

### Production frontend

```env
VITE_API_URL=https://api.chalin03.com/api
```

### Production backend CORS

```env
FRONTEND_URL=https://www.chalin03.com
FRONTEND_URL_ALT=https://chalin03.com
```

Railway MySQL variables must remain in Railway and must not be copied into README, documents, screenshots or GitHub.

## Fresh Local Database

For a new blank local installation only, use:

```text
database/schema.sql
```

Warning:

> `database/schema.sql` is a fresh-install/reset schema. Do not execute it against the live Railway database.

After creating a fresh local schema, create the administrator account using the supported backend administration script.

## Production Migrations

Production database changes must use reviewed additive migrations.

General order:

1. Confirm the correct production database.
2. Download a current system backup and export important reports.
3. Run the reviewed migration.
4. Run its verification SQL immediately.
5. Confirm all problem counts are zero.
6. Deploy the backend/frontend code that depends on the migration.
7. Test existing data and new workflows.
8. Create a release tag.

### Cash Control V2 migration

Files:

```text
database/20260714_cash_control_security_migration.sql
database/20260714_cash_control_security_verify.sql
```

Production status:

```text
Applied successfully and verified on 2026-07-15.
```

Do not rerun it casually. Do not run `schema.sql` to repair a migration problem.

### SMS Reliability and Restock Release 1 migration

Files:

```text
database/20260715_sms_reliability_and_restock_migration.sql
database/20260715_sms_reliability_and_restock_verify.sql
```

This additive migration must be executed and verified before deploying the Release 1 backend and frontend. It converts legacy SMS `sent` records to `accepted`, adds SMS delivery evidence, and adds professional stock-movement evidence. Never use `schema.sql` for this production update.

## Run Locally

Backend:

```bat
cd /d C:\Users\DDK\Desktop\chalin03-system\backend
npm run dev
```

Frontend:

```bat
cd /d C:\Users\DDK\Desktop\chalin03-system\frontend
npm run dev
```

Addresses:

```text
Frontend: http://localhost:5173
Backend:  http://localhost:5000
Health:   http://localhost:5000/api/health
```

## Tests

### Backend

```bat
cd /d C:\Users\DDK\Desktop\chalin03-system\backend

npm run syntax-check
npm test
```

Current Cash Control V2 acceptance result:

```text
Syntax: 72 backend JavaScript files passed
Tests: 48 passed, 0 failed
```

### Frontend

```bat
cd /d C:\Users\DDK\Desktop\chalin03-system\frontend

npm test
npm run build
```

The Vite chunk-size warning is non-blocking when the build ends successfully.

### Git quality check

```bat
cd /d C:\Users\DDK\Desktop\chalin03-system

git diff --check
git status --short
```

LF-to-CRLF warnings on Windows are not failures when no real whitespace error is reported.

## Production Deployment

Production code is deployed from `main`.

Safe release pattern:

```bat
cd /d C:\Users\DDK\Desktop\chalin03-system

git switch main
git pull --ff-only origin main
git status --short
```

Create a feature branch:

```bat
git switch -c feature/clear-feature-name
```

After implementation and successful tests:

```bat
git add exact\file\paths
git commit -m "Clear release description"
git push -u origin feature/clear-feature-name
```

Merge after acceptance:

```bat
git switch main
git pull --ff-only origin main
git merge --no-ff feature/clear-feature-name -m "Release clear feature name"
git push origin main
```

Then verify:

- Railway backend deployment
- Cloudflare frontend deployment
- API health
- Login
- Correct store/workspace
- Existing records
- New feature
- Reports
- Mobile layout
- Browser console

Use Incognito or hard refresh when an old PWA/cache version remains visible.

## Git Tags and Rollback

Verified release:

```text
9024281 — Release advanced cash control and audit security
cash-control-security-v2-live-20260715
```

A Git tag protects application code, not database contents.

To revert a merge commit:

```bat
git switch main
git pull --ff-only origin main
git log --oneline -5
git revert -m 1 ACTUAL_MERGE_COMMIT_HASH
git push origin main
```

Do not type placeholder brackets such as `<MERGE_COMMIT_HASH>` in Windows Command Prompt.

Database recovery requires a database backup or controlled repair; Git cannot reverse MySQL data changes.

## Backup and Recovery

Keep separate copies of:

- Pre-migration system backup
- Post-migration system backup
- Important Excel/PDF/Word exports
- Database SQL export when available
- Clean GitHub clone
- Controlled documentation set
- Migration and verification files
- Release notes and tags

Do not store secrets inside documentation or source backups.

### Pen-drive structure

Recommended final structure:

```text
D:\Chalin03_Final_Backup_2026-07-15\
├── 01_Production_Source\
├── 02_Clean_GitHub_Clone\
├── 03_Database_Backups\
├── 04_Complete_Documentation\
├── 05_Installers_and_Migrations\
├── 06_Reports_and_Release_Notes\
└── 07_New_Device_Recovery\
```

Exclude from the production-source copy:

```text
node_modules
frontend\dist
.env
temporary extraction folders
real secrets
```

The clean GitHub clone should keep its `.git` folder so it remains an independent repository backup.

## Production Operating Rules

1. Use individual accounts.
2. Confirm the active store, site or Hire location.
3. Record transactions when they happen.
4. Separate Cash, MoMo, Bank and Other.
5. Enter the physical Cash count directly or use the optional denomination counter.
6. Never force a closing to balance.
7. Explain every shortage or excess.
8. Use protected correction workflows.
9. Preserve original evidence.
10. Require independent approval.
11. Review Activity Logs.
12. Back up before migrations or major releases.
13. Do not reset production to fix a normal application error.
14. Investigate evidence before accusing staff of theft.

## Troubleshooting

### Old frontend after deployment

- Open Incognito.
- Use `Ctrl + Shift + R`.
- Wait for Cloudflare deployment.
- Confirm the latest commit.
- Clear PWA/browser cache when needed.

### API route not found

- Confirm Railway deployed the latest `main`.
- Check route registration in `backend/server.js`.
- Review Railway logs.

### Database connection error

- Check Railway MySQL environment variables.
- Confirm the live backend is connected to the intended production service.
- Do not reset the database.

### Export failure

- Check the browser Network response.
- Check Railway logs.
- Verify required migration columns/tables exist.
- Hard refresh after frontend deployment.

### Daily Closing mismatch

Review:

- Physical Cash count
- Optional denomination evidence, when used
- Cash sales
- Mixed/Credit cash allocations
- Debt collections
- Expenses
- Refunds
- Post-closing changes
- Activity Logs
- Manager verification
- Revision history

A mismatch may be caused by a recording error, counting error, missing transaction or genuine loss. The system preserves evidence; management determines the cause.

## Security

Never commit or publish:

- `.env` files
- JWT secrets
- Railway MySQL passwords
- SMS API keys
- WhatsApp access tokens
- Admin passwords
- Customer private data
- Production database dumps
- Real business backups

Rotate credentials immediately when exposed.

## Documentation

The in-app Help/User Guide is designed for:

- Cashiers
- Managers
- Administrators
- Auditors
- Mining staff
- Equipment Hire staff
- Fleet staff

This README is designed for:

- Developers
- System administrators
- Support technicians
- Future maintainers

Keep both updated after every major production release.

## Author and Ownership

Prepared by:

**Eugene Amankwah Appiah**

For:

**Chalin 03 Company Limited**

Location reference:

**Dunkwa Police Barrier**


## Release 1.1 — Automatic Arkesel Delivery Confirmation

SMS delivery evidence is now updated automatically without staff calling customers
or ticking a manual confirmation.

- Every Arkesel send includes the protected `callback_url` when
  `SMS_DELIVERY_WEBHOOK_SECRET` is configured.
- The public callback accepts Arkesel's documented `sms_id` and `status` query
  parameters.
- The backend also polls Arkesel's official batch message-report endpoint every
  minute as a fallback.
- Accepted, Submitted and Queued remain awaiting delivery.
- Delivered, Not Delivered, Prohibited and Expired update to explicit final
  evidence.
- Existing accepted messages with provider UUIDs are backfilled automatically
  after deployment.
- The process never resends an SMS and therefore does not spend another credit.

## Release 3F-B — Professional Installment Sales

Release 3F-B adds controlled branch-isolated installment sales without replacing the
existing Cash, MoMo, Bank, Credit or Mixed workflows.

- New Sale can create a professional installment agreement with deposit, payment
  frequency, first due date, grace period, delivery policy, guarantor details and
  accepted terms.
- The system generates exact weekly, fortnightly, monthly or custom payment
  schedules and preserves the agreement, item and payment ledgers.
- Authorized staff can approve agreements, collect partial or full payments,
  reschedule future dues, record delivery, waive approved charges and correct a
  payment through controlled evidence.
- The Installment Sales workspace shows due, overdue, completed and default-risk
  accounts with agreement PDFs, payment receipts, customer statements and Excel
  exports.
- Installment collections are included in Daily Closing channel totals and all new
  tables are included in full-system and professional backups.
- Arkesel reminders keep truthful provider evidence. Automatic scheduled reminders
  remain disabled until `INSTALLMENT_SMS_REMINDERS_ENABLED=true` is deliberately
  configured in production; authorized staff can run due reminders from the page.

Production maintenance must apply only the reviewed additive migration:

`database/migrations/20260718_release3fb_professional_installment_sales.sql`

Never run `database/schema.sql` against the live Railway database.

## Release 3F-C — User Permission Manager and Security UX

Release 3F-C adds protected per-user permission control while preserving the role
catalog as the default source of access.

- Administrators can Allow, Restrict or return an individual feature, page or
  action to its role default for one user and workspace.
- Explicit Deny always overrides Allow. Optional expiry dates support temporary
  duty assignments.
- Every change requires a reason, a current-password protected-action window and
  complete Activity Log / privileged-ledger evidence.
- Active user sessions can be revoked immediately after a permission change.
- Original owner-security, Break-Glass and core recovery permissions cannot be
  removed from the original System Administrator.
- Security Centre messages can be deleted from the active view after review;
  underlying activity-log and ledger evidence is never deleted.
- The login page clears remembered passwords on page open and uses browser/password
  manager resistance controls so the password field starts empty.
- System Operations reports active overrides, explicit restrictions, expiring
  rules and reviewed Security Centre messages.

Production maintenance must apply only the reviewed additive migration:

`database/migrations/20260718_release3fc_user_permissions_security_messages.sql`

Never run `database/schema.sql` against the live Railway database.

## Release 3F-C2 — Independent Category Controls

Release 3F-C2 makes Spare Parts, Mining Operations and Equipment Hire independent
login and workforce domains. The original System Administrator is the only
cross-category account. Category-specific permission catalogs and user lists are
enforced server-side, worker profiles are scoped by category, ambiguous legacy
assignments are preserved for protected Safe Conflict Review, each category has
its own detailed Help/User Guide, the Equipment Hire sidebar Unicode rendering
is corrected, and each Spare Parts store's Business Phone is the MoMo number on
its receipts. Production uses only the additive 3F-C2 migration; `schema.sql` is
never used against the live database.
