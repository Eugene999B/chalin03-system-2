# Equipment Installment Finance Division Boundary

## Purpose

Equipment Installment Finance is presented as an independent operating division inside the authenticated Equipment Sales & Hire business workspace. It must be visually and operationally distinct from Equipment Hire without duplicating customers, machines, locations, users, balances or audit evidence.

## Route and layout boundary

- Installment Finance: `/equipment-installment-finance`
- Equipment Hire Operations: `/equipment-hire-operations`
- Installment Finance uses `InstallmentFinanceLayout`.
- Equipment Hire uses `EquipmentHireLayout`.
- Both routes remain protected by the existing `equipment_hire` workspace access and Equipment Sales & Hire location context.

## Installment Finance responsibilities

- Equipment sales enquiries and quotations
- Installment applications and agreements
- Payment schedules and receipts
- Portfolio health and expected cash flow
- Collections queue and customer follow-up
- Promise-to-pay evidence
- SMS and prepared WhatsApp reminders
- Delivery eligibility and ownership-transfer evidence
- Installment documents and management reports

## Equipment Hire responsibilities

- Hire enquiries
- Hire quotations
- Hire contracts
- Equipment availability for Hire
- Dispatch and job cards
- Work logs and billable hours
- Hire invoices and payments
- Return inspections
- Hire reports and utilization

## Shared records

The divisions deliberately share:

- `hire_customers`
- `fleet_assets`
- Equipment Sales & Hire locations
- Authenticated user accounts and location assignments
- Notification and document infrastructure
- Audit trail and security controls

Shared records prevent duplicate customer identities and conflicting machine states. Sale locks and Hire assignments remain authoritative safeguards.

## Legacy navigation

Old links continue to work through safe redirects:

- `fleet?view=installments` → Installment Finance Command Centre
- `fleet?view=sales` → Installment Finance Applications & Agreements
- `fleet?view=reports` → Installment Finance Documents & Reports

## Current permission boundary

Phase 1 intentionally preserves the existing tested permissions:

- Read: `fleet.assets.view` and relevant existing view permissions
- Changes, sending and follow-up: existing protected Equipment Sales permissions
- Location and staff administration: `workspace.admin`

A later additive release may introduce dedicated `installment.*` permissions after permission seeding, role mapping, migration review and regression testing.

## Data-safety rules

This separation release:

- does not create a new database or workspace code
- does not migrate balances or payment records
- does not duplicate customers or equipment
- does not alter Hire contracts
- does not rewrite installment agreements
- does not change sale locks, delivery records or ownership records
- does not enable automatic SMS by default

## Release verification

The release must pass:

- complete frontend source tests
- frontend lint and production build
- complete backend tests
- authentication and workspace-boundary regressions
- migration safety
- dependency and secret checks
- CodeQL security analysis
