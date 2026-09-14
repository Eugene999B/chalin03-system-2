# Chalin 03 Professional Excavator Installment Finance Rebuild

Issue: #176

## 1. Business definition

Installment Finance is the controlled sale of one specifically identified excavator or other approved machine where the buyer pays an agreed deposit and clears the remaining purchase price through a dated installment schedule. The selected machine, buyer, approval, agreement, payments, delivery and ownership evidence must remain linked from beginning to end.

It is not a Hire job. It must not create Hire dispatch, Hire invoices, Hire returns or Hire work records. The same Equipment Business login may be authorised for both divisions, but every action remains permission-controlled and audit-labelled by division.

## 2. Authoritative lifecycle

1. **Register machine**
2. **Verify machine evidence and sale readiness**
3. **Register/select customer**
4. **Create quotation**
5. **Create credit application and KYC**
6. **Affordability/risk review**
7. **Independent approval**
8. **Activate agreement**
9. **Collect deposit**
10. **Reserve the exact machine**
11. **Generate and sign document pack**
12. **Collect and allocate installments**
13. **Manage reminders, arrears, promises, waivers and rescheduling**
14. **Record delivery/handover when approved threshold is met**
15. **Issue settlement evidence when fully paid**
16. **Complete lawful ownership transfer**
17. **Close and archive the customer file**

Every write must be transaction-safe, idempotent and append-only where it represents financial, approval, notice, signature or ownership evidence.

## 3. Professional navigation

### Command and records
- Finance Command Centre
- Excavator Register
- Customers
- Credit Applications
- Approval Queue
- Agreements
- Deposits & Reservations
- Collections
- Arrears & Follow-up
- Rescheduling & Waivers
- Documents
- Delivery & Handover
- Ownership Transfer
- Reports
- Finance Settings
- Equipment Staff

### Role-based landing views
- **Equipment Business Manager:** Hire and Finance gateway, full operational overview
- **Finance Manager:** approvals, policy, agreements, exceptions, documents and ownership
- **Credit Officer:** customers, KYC, applications, affordability and guarantors
- **Collections Officer:** payments, receipts, reminders, promises and arrears
- **Finance Accountant:** deposits, collections, reconciliation, statements and ownership readiness
- **Finance Auditor:** read-only complete evidence
- **Equipment Business Accountant:** authorised accounting work across Hire and Finance from one login
- **System Administrator:** protected setup, staff and production controls

## 4. Excavator register

A machine cannot enter Finance until it exists in the shared equipment catalogue and passes Finance readiness.

### Required identity
- internal equipment code
- machine name/type
- make
- model
- model year
- chassis number
- serial number
- engine number
- registration/number plate where applicable
- colour
- condition
- hour-meter/odometer type and reading
- current physical location
- ownership type and seller title evidence
- import/customs reference where available
- purchase cost, target sale price and minimum approved sale price
- sale purpose and sale status
- active/inactive state

### Evidence photos
- main full-machine photo
- front
- rear
- left side
- right side
- cabin
- engine
- serial plate
- chassis plate
- attachments/tools
- damage/inspection evidence
- registration/ownership evidence

Uploads must be compressed safely but displayed with `object-fit: contain`, never cropped. The document generator must use the full image inside a fixed evidence frame.

### Sale readiness gate
A Finance application cannot proceed when:
- machine identity is incomplete
- no main photo exists
- serial/chassis identity is missing
- machine is inactive
- machine is not approved for sale
- machine is already sold or reserved
- machine is active on a Hire contract
- another approved Finance application or sale lock exists

## 5. Customer and KYC file

### Buyer
- title and full legal name
- Ghana Card number and verified name
- date of birth where required
- phone and alternate phone
- email
- residential, postal and digital address
- region/district/town
- occupation/business/employer
- business registration/TIN where relevant
- monthly income and other income
- monthly expenses and existing debt obligations
- source of repayment
- bank/mobile-money information where voluntarily supplied
- passport/photo evidence
- Ghana Card front/back evidence
- proof of address
- consent and data-use acknowledgement

### Guarantor
- full legal name
- Ghana Card
- phone
- address
- occupation/business
- relationship to buyer
- income/repayment capacity
- ID/photo/address evidence
- independent guarantor undertaking and signature

### Other parties
- seller representative
- witness for buyer
- witness for seller where required
- document preparer
- approver

## 6. Finance configuration

### Commercial defaults
- currency
- minimum deposit percentage/amount
- maximum financed percentage
- standard term limits
- allowed frequencies: weekly, fortnightly, monthly, custom
- standard first-due offset
- maximum installment count
- delivery policy and percentage threshold
- early-settlement policy
- discounts/waivers approval thresholds

### Payment allocation
- oldest due line first
- late charges before or after principal, according to approved policy
- partial payments allowed
- exact payments allowed
- excess payment advances future schedule lines
- payment cannot exceed final account balance unless explicitly recorded as refundable unapplied credit
- every allocation is visible on receipt and statement
- rounding difference is placed only on the final schedule line

### Late and arrears policy
- grace days
- fixed or percentage late charge
- charge frequency and cap
- overdue classification bands
- reminder dates
- quiet hours
- weekly/monthly message limits
- promise-to-pay controls
- rescheduling eligibility
- waiver limits
- default-review threshold
- notice/cure period
- recovery path and required evidence

### Notifications
- boss payment-alert enabled
- boss phone number
- additional management recipients
- customer payment-receipt SMS enabled
- deposit alert enabled
- due-soon/due-today/overdue reminders
- settlement and ownership-ready alerts
- message templates
- provider availability and truthful delivery status

Boss payment alerts must be sent only after the collection transaction commits. SMS failure must not roll back or falsify the payment; it must be logged separately and visibly.

### Document identity
- company legal name
- registration/tax references
- phone, email, postal and digital address
- logo
- authorised boss/seller name and title
- signature image
- witness requirements
- agreement numbering
- legal-review status and review date
- terms template version

## 7. Agreement document pack

The system must generate a polished Chalin 03 pack automatically from live approved records.

### Document A — Excavator Sale and Installment Agreement
- company header and logo
- agreement number and date
- seller and buyer details
- Ghana Card/contact/address
- guarantor and witness details
- selected excavator identity
- full main machine photo
- purchase price
- deposit required and received
- financed balance
- frequency and number of installments
- first/final due date
- delivery policy
- ownership/title policy
- approved terms and conditions
- signature blocks
- page numbers and document integrity reference

### Annexure 1 — Payment schedule
- line number
- due date
- scheduled amount
- amount paid
- balance
- status
- date paid
- receipt references

### Annexure 2 — Machine identity and photo evidence
- full machine photo
- side/front/rear images
- serial/chassis plate images
- make/model/year
- serial/chassis/engine/registration
- condition and meter
- attachments/tools

### Annexure 3 — Guarantor undertaking
Separate acknowledgement and signature.

### Annexure 4 — Delivery and condition report
Generated at handover with customer acceptance, meter, fuel, condition, tools, photos and signatures.

### Other generated documents
- quotation
- credit application summary
- affordability/approval memorandum
- deposit receipt
- installment payment receipt
- complete customer statement
- due-soon reminder
- arrears/default notice
- promise-to-pay acknowledgement
- rescheduling variation agreement
- waiver approval
- settlement confirmation
- ownership-ready notice
- ownership transfer certificate/pack
- account closure certificate

### Formats
- browser print
- PDF
- Word-compatible editable document
- thermal receipt for collections

Document snapshots must not silently change when customer, machine or settings records are edited later. Each issued document stores its template version, data snapshot, generation time and generating user.

## 8. Terms architecture

Terms are versioned settings, never uncontrolled free text copied between accounts.

Required subjects:
- parties and identified machine
- cash price/purchase price disclosures
- deposit and financed balance
- schedule and payment channels
- title retention/security interest
- possession, location and inspection
- permitted and prohibited use
- maintenance, service, insurance and damage
- loss/theft notification
- taxes, registration and transfer costs
- late payment, grace and charges
- notices and cure
- partial, excess and early payments
- rescheduling and waivers
- default review and lawful recovery
- treatment of prior payments as legally reviewed
- delivery and risk handover
- warranties/condition disclosure
- ownership transfer after settlement
- guarantor obligations
- data/privacy and communication consent
- dispute resolution
- governing law of Ghana
- entire agreement, amendments and severability
- signatures and counterparts

The paper clause “three defaults shall result in repossession without refund” is not an approved automatic default. Recovery terms require legal review, notice evidence and the configured lawful route.

## 9. Payments and edge cases

### Late payment
The scheduled line remains overdue. A later payment allocates according to policy and the customer statement shows the original due date, days late, any approved charge, payment date and remaining amount.

### Partial payment
The line becomes partial; its unpaid part remains due/overdue. Future lines are not falsely marked paid.

### Payment larger than the current period
The system completes the current/oldest line, then advances the surplus into later schedule lines. The receipt displays the total received and allocation breakdown.

### Full early settlement
The payment is recorded as settlement, all open lines are allocated, the balance becomes zero, ownership readiness is created and no future reminder is sent.

### Overpayment beyond account balance
The normal collection endpoint rejects it. A separately approved unapplied-credit/refund workflow is required so money is never lost or hidden.

### Reversal/correction
Original payment remains immutable. An independently approved reversal creates linked negative evidence and recalculates the schedule and agreement.

## 10. Staff access

A single user account may be authorised for both Equipment Hire and Installment Finance. Access is explicit, not automatic.

Dual-division roles:
- Equipment Business Manager
- Equipment Business Accountant
- Equipment Business Auditor

Division-specific roles remain available. Every page and API checks the action permission, not only the role name. The audit trail records the active division for each action.

## 11. Reliability correction

The old independent router and final lifecycle router both exposed `/finance-lifecycle/accounts`. The independent router was dispatched first, bypassing the final lifecycle readiness response and allowing raw SQL failures to surface as HTTP 500.

The rebuild keeps one authoritative lifecycle route and verifies ownership of that URL in automated tests. Readiness failures must return a controlled 503 with missing schema evidence, never a generic 500.

## 12. Delivery sequence

### Release A — Reliability and authoritative routing
- remove duplicate lifecycle route
- expand readiness contract
- remove raw 500 path
- preserve current records

### Release B — Excavator register and photo evidence
- professional Finance catalogue views
- machine readiness checklist
- full-photo upload/display/document evidence

### Release C — Professional settings and staff access
- company-wide Finance settings
- boss payment alerts
- reminder policy
- document identity and signatures
- dual-division Equipment roles

### Release D — Agreement/document engine
- agreement, annexures, Word/PDF/print
- issued document snapshots
- signatures and evidence

### Release E — Collections and arrears completion
- partial/excess allocation
- receipts/statements
- reminders, promises, waivers, rescheduling and notices

### Release F — Delivery, settlement and ownership
- handover pack
- settlement confirmation
- DVLA/reference evidence where applicable
- ownership transfer pack

### Release G — Reports, acceptance and production
- management and audit reports
- mobile/desktop/print tests
- full financial scenarios
- two verified backups
- additive migration and verifier
- controlled production deployment

No release is promoted with a failing migration, raw API error, incomplete document snapshot or unverified financial allocation.
