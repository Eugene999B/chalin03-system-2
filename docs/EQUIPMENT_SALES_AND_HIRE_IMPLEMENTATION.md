# Chalin 03 Equipment Sales & Hire Implementation

## Status

This work is being developed on `feature/equipment-sales-installments` and must not be merged or deployed until the database migration, backup/restore contract, APIs, frontend build and end-to-end acceptance journeys have passed review.

Tracking issue: #43.

## Product boundary

The login workspace remains **Equipment Hire** to preserve current access assignments and routes. Inside the workspace, the operating title becomes **Equipment Sales & Hire** with two businesses:

1. Equipment Sales & Installment
2. Equipment Hire Operations

Spare Parts remains a fast retail and stock business. It will stop creating new installment agreements only after the Equipment Sales workflow is fully operational. Existing Spare Parts installment agreements remain readable and payable and are never deleted automatically.

## Shared equipment master

`fleet_assets` remains the master record for every excavator and heavy-equipment unit. The foundation migration adds:

- Equipment category, type, make, model and year
- Serial, chassis and engine identity
- Condition and capacity
- Hire location
- Acquisition source and value
- Target selling price and standard hire rate
- Operating purpose: hire only, sale only, sale or hire, company operations
- Sale status and reservation dates
- Main equipment image

The same asset record is used by availability, Hire quotations, Hire contracts, sales quotations, installment agreements, dispatch, delivery, maintenance and reporting.

## Media and evidence

`equipment_media` stores metadata for photos, videos and documents. It supports:

- Main, front, rear, left and right images
- Cabin, engine, serial plate and chassis plate images
- Inspection and damage evidence
- Hire dispatch and return evidence
- Sale delivery evidence
- Registration, insurance and ownership documents

The database stores file URLs and metadata, not raw image bytes. Phone uploads must be compressed before storage to protect Railway database space and mobile data usage.

## Equipment sales workflow

1. Create or select a Hire customer.
2. Record a sales enquiry.
3. Select the specific equipment unit.
4. Prepare a quotation with an equipment snapshot and image.
5. Complete required discount, deposit or term approval.
6. Create a cash or installment sale agreement.
7. Lock the equipment against Hire assignment and another sale.
8. Collect deposit and scheduled payments.
9. Enforce delivery policy before release.
10. Capture delivery condition, meter, accessories and receiving person.
11. Complete final settlement.
12. Issue ownership transfer and mark the unit sold.

## Installment controls

Equipment installment agreements support:

- Weekly, fortnightly, monthly or custom schedules
- Required deposit and financed balance
- First, next and final due dates
- Grace periods and late charges
- Guarantor identity and documents
- Delivery after deposit, percentage threshold or full payment
- Partial allocations to schedule lines
- Overdue and rescheduled statuses
- Payment void controls and audit evidence
- Final settlement and ownership transfer

All equipment agreements are location-scoped and use Hire customers rather than Spare Parts customers.

## Double-booking safety

Database triggers block:

- Assigning sale-only, reserved, installment-active or sold equipment to a Hire contract
- Approving an equipment sale while the unit is assigned, dispatched or active on Hire
- Approving a sale at a location different from the equipment's assigned Hire location

The API must also lock the relevant `fleet_assets` row in the same transaction when approving a sale, creating a sale lock, dispatching Hire equipment or releasing a reservation.

## SMS architecture

The central `sms_log` remains the single provider history. It is expanded with workspace, business unit, Hire location, entity and template context.

Equipment Sales events include:

- Quotation ready or expiring
- Agreement created
- Deposit received
- Payment due soon, due today or overdue
- Payment receipt
- Delivery scheduled and completed
- Final settlement
- Ownership document ready

Equipment Hire events continue to cover quotations, contracts, dispatch, invoices, payments, returns and damage.

## Legacy Spare Parts installments

No legacy agreement is deleted or silently converted.

A later supervised migration tool will:

1. Require the original System Administrator.
2. Select the legacy installment agreement.
3. Select or create the exact equipment asset.
4. Create the Hire customer and Equipment Sales agreement.
5. Copy schedule and payment evidence.
6. Recalculate balances independently.
7. Save the original data snapshot.
8. Require reconciliation review.
9. Mark the original record as migrated without deleting it.

`equipment_legacy_installment_migrations` preserves the one-to-one mapping, original values, migrated values and reconciliation outcome.

## Delivery sequence

### Release A — Foundation

- Additive migration and read-only verification
- Backup/restore table ordering
- Restore verification contracts
- Shared equipment catalogue API
- Media metadata API

### Release B — Equipment catalogue UI

- Mobile equipment gallery
- Create/edit equipment
- Camera upload
- Main image and evidence gallery
- Purpose and availability controls

### Release C — Equipment sales

- Enquiries
- Quotations
- Approval
- Cash sale agreements
- Delivery and ownership transfer

### Release D — Installment finance

- Installment agreements
- Schedule generation
- Payments and receipts
- Arrears and rescheduling
- SMS reminders

### Release E — Hire integration and transition

- Images throughout Hire workflow
- Sale/Hire conflict enforcement
- Legacy installment read-only area
- Supervised migration
- Group reports

## Acceptance gates

No production release is complete until these journeys pass:

1. Cash equipment purchase
2. Installment equipment purchase
3. Partial payment and allocation
4. Due and overdue SMS
5. Final settlement and ownership transfer
6. Hire enquiry through return
7. Reserved or sold equipment cannot be hired
8. Hired equipment cannot be sold
9. Android image capture and compression
10. Location and permission isolation
11. Backup download, test restore and verification
12. Spare Parts regression without new installment creation
