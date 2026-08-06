# CHALIN ONE — Data Classification and Persona Boundary Matrix

**Status:** Development source of truth  
**Rule:** Classification narrows access; it never grants access by itself.

## Classification levels

| Level | Name | Examples | Public website | Chalin Guide | Chalin Copilot | Chalin Executive |
|---|---|---|---|---|---|---|
| C0 | Published public | Published pages, approved public equipment, vacancies, tenders, public FAQs | Allowed | Allowed through public allowlist | Allowed | Allowed |
| C1 | Internal operational | Stock summaries, ordinary sales totals, equipment availability, workflow status | Prohibited | Prohibited | Permission and workspace scoped | Permission scoped |
| C2 | Confidential business | Customer statements, debts, pricing rules, profitability, supplier terms, internal reports | Prohibited | Prohibited | Explicit permission and minimum necessary fields | Explicit executive/business permission |
| C3 | Sensitive personal/financial | Identity documents, phone/email, finance applications, payroll, bank details, incident medical information | Prohibited | Prohibited | Tool-specific permission; redacted/minimized by default | Explicit need-to-know permission |
| C4 | Restricted security | Password hashes, tokens, passkey secrets, provider keys, database credentials, backup encryption material | Prohibited | Prohibited | Permanently prohibited | Permanently prohibited |
| C5 | Immutable evidence | Audit events, approvals, signatures, finalized transaction evidence | Prohibited unless explicitly published | Prohibited | Read-only where existing permission allows | Read-only where existing permission allows |

## Workspace boundaries

| Workspace | Default AI scope | Additional required context | Cross-workspace access |
|---|---|---|---|
| Spare Parts | Active store/branch and authorized sales/inventory records | Branch/store context for branch-owned records | Denied unless an existing group permission explicitly allows it |
| Mining | Active mining workspace | Authorized mining-site ID for site-owned records | Denied between sites unless the user already has multi-site access |
| Equipment Hire | Active hire workspace | Authorized hire-location ID for location-owned records | Denied between locations unless the user already has multi-location access |
| Equipment Finance | Existing finance permissions within the appropriate operational workspace | Customer/application/agreement scope and document sensitivity | No inference of approval authority |
| Group Executive | Explicit executive persona and permission | Stronger-authentication evidence where configured | Only approved group-wide tools |

## Data-domain rules

### Customers

- Customer names, phone numbers, emails, addresses and identifiers are C2 or C3.
- Duplicate suggestions may expose only the minimum comparison fields authorized for the user.
- Customer merges are never autonomous AI actions.
- Public Guide cannot search operational customers.

### Sales, receipts and returns

- Transaction totals are C1/C2 depending on detail.
- Line items, margins, cashier identity and customer linkage are C2.
- Finalized records and audit evidence are C5 and read-only to AI.
- AI may explain authorized records but cannot rewrite them.

### Debts and collections

- Debt balances, payment history and reminder history are C2/C3.
- Copilot may rank or summarize only customers visible to the current user and branch.
- Reminder text is a draft until separately approved/sent through the normal communication workflow.

### Inventory and pricing

- Publicly approved catalogue data is C0.
- Internal stock quantities, cost prices, supplier details and reorder rules are C1/C2.
- AI recommendations do not change stock, prices or purchase records.

### Mining

- Production, fuel, downtime, equipment and workforce summaries are C1/C2.
- Incidents and medical details are C3.
- Site access must be checked on every tool invocation.
- Public Guide receives only published public mining information.

### Equipment Hire

- Public catalogue records are C0.
- Customer, quotation, contract, dispatch, work-log, invoice and damage records are C2/C3.
- Asset release, dispatch, return closure and financial closure remain human-controlled.

### Equipment Finance

- Public requirements and approved guidance are C0.
- Applications, identity documents, affordability, schedules, payments, arrears and recovery records are C3.
- AI may identify document completeness or upcoming payments for authorized staff.
- AI cannot approve/reject applications, alter schedules, waive debt or authorize delivery.

### Human resources

- Public vacancies and approved leadership profiles are C0.
- Worker identity, contracts, letters and ordinary HR records are C2/C3.
- Medical, disciplinary, payroll and bank information are C3.
- Signed documents and approvals are C5.

### System, security and backups

- Health summaries may be C1.
- Detailed configuration, security findings and backup metadata are C2/C3.
- Secrets and recovery material are C4 and permanently excluded.
- AI cannot restore backups or modify security settings.

### Content Studio and knowledge

- Published content is C0.
- Draft/review content is C1/C2 and staff-only.
- Knowledge visibility must be `public`, `workspace`, `restricted` or `executive`.
- A public knowledge version requires independent review and explicit public visibility.
- Expired, archived, rejected or superseded versions are excluded from retrieval.

## Provider minimization

Before provider submission:

1. Remove C4 fields unconditionally.
2. Remove fields outside the user’s effective permission and scope.
3. Prefer aggregates over raw C2/C3 rows.
4. Replace unnecessary identity values with stable display labels or counts.
5. Limit evidence excerpts and record only hashes/summaries in invocation audit.
6. Do not send document bytes unless a future dedicated vision/document tool explicitly permits it.

## Logging rules

Allowed logs:

- IDs, status codes, counts, hashes, latency, token usage and safe summaries.
- Provider and model identifiers.
- Permission and scope decisions.

Forbidden logs:

- Passwords, tokens, API keys and database URLs.
- Full identity-document numbers or bank details.
- Raw unrestricted prompts containing C3/C4 content.
- Full tool outputs when a safe summary is sufficient.

## Portal boundaries

External portals use separate identities from staff accounts.

- Customer portal: only records owned by the authenticated customer identity or explicitly shared with it.
- Supplier portal: only supplier-owned tenders, submissions, documents and communications.
- Applicant portal: only the applicant’s own vacancy application and documents.
- Portal identities cannot invoke staff Copilot or Executive tools.
- Guide remains public and cannot inherit portal ownership access.

## Decision rule

For every field requested by AI, evaluate in this order:

1. Is the feature/persona enabled?
2. Is the user or public identity authenticated where required?
3. Does the user hold the normal business permission?
4. Is the record inside the active workspace and location scope?
5. Is the classification allowed for this persona/tool?
6. Is every returned field necessary for the stated task?
7. Is the result size within the tool limit?
8. Can the answer cite approved evidence?

Any failed step denies or minimizes the data before provider access.
