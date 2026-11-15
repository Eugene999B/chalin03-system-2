# CHALIN03 — Ready Cash Equipment Sales (development)

**Branch:** `feature/equipment-finance-ready-cash-20261115`  
**Draft PR:** #774  
**Status:** Code and automated contract checks exist; NOT APPROVED FOR LIVE CASH SALES.

## Business definition

Ready Cash is the immediate, full-payment alternative to Equipment Installment Finance. A Ready Cash transaction uses one active Finance customer and one available excavator at its protected configured sale price. It does **not** create a credit application, financed balance, repayment schedule, interest or arrears.

A full payment is not itself proof of physical delivery. Asset states are:

1. Available — not committed to another Hire, credit application or sale.
2. **Fully paid / reserved** — full cash payment and official receipt saved, machine reserved.
3. **Sold / transferred** — a different authorized manager has verified signed delivery, receiving person and machine condition; the sale, delivery, asset and ownership records commit together.

## Operational path

- Select a valid customer from the existing company-wide Finance customer list.
- Select an available machine from the Finance machine register.
- Verify the exact selling price, customer terms, and accountable cash shift/till reference.
- Record physically received and counted **cash** with the protected checkout.
- The backend checks price, machine locks, active Hire contracts, open credit cases and prior agreements **inside a transaction**.
- It creates a historical one-line quote, cash agreement, full-payment receipt, asset lock and high-severity audit event in one transaction.
- A duplicate checkout UUID must not create a second receipt. When a response is uncertain, check the recent-sales register before retrying.
- After signed handover, log in using a **separate authorized finance manager account** to record the receiving person, actual condition, destination and signed handover reference.
- The second transaction creates delivery and ownership evidence and moves the machine to SOLD.
- The official non-voided payment ledger must still equal the sale total at handover.

## Technical interfaces

- `GET /api/equipment-catalogue/sales/phase-one/bootstrap` — existing Finance customer and asset lists.
- `GET /api/equipment-catalogue/sales/ready-cash/recent` — protected receipt/recovery register.
- `POST /api/equipment-catalogue/sales/ready-cash/checkout` — full cash payment and reserved machine.
- `POST /api/equipment-catalogue/sales/ready-cash/:agreementId/handover` — independent signed delivery/ownership transfer.

The existing Finance authorization and workspaces are retained. This work must not be implemented in the Hire-location-scoped legacy sales path.

## Release blockers and accounting sign-off

1. **Tax policy:** The current development code treats `fleet_assets.target_selling_price` as the final cash price and records a zero separate tax component. Finance must explicitly confirm the lawful VAT/levy treatment and whether the catalogue price is tax-inclusive before production release. Add the actual approved statutory tax breakdown if applicable.
2. **Payment evidence:** Only physical cash with operator attestation and till/shift reference can complete instantly in this version. Hubtel, Paystack, MoMo and bank transfers must use a provider-verified callback, matched settlement and idempotent ledger entry before they can trigger `paid_in_full`.
3. **Database contract:** Verify nullable `hire_location_id` Finance records and all current Finance triggers, including agreement, quote, payment, lock, delivery and transfer schemas. No migrations are included here.
4. **Independent handover:** Test with two different authorized users and a real signed delivery-document reference in a synthetic environment. Uploading or archiving the actual signed evidence in a secure document vault is the follow-on integration.
5. **Atomic integrity:** Exercise double clicks, repeated request UUIDs, stale price, a machine held in Hire/Finance, transaction failures at each insert, reversal or void before delivery and cross-division denial. Original finance records must not be rewritten.
6. **Reconciliation:** Verify receipt accuracy, tax split, till/daily closing, cash flow reports, portfolio exclusion from installment arrears, sold asset visibility, audit trail, backup and rollback.

## Acceptance data (synthetic only)

Use an active test Finance customer, synthetic available machine and approved final selling price (for example GHS 125,000.00); no real customer should pay or receive an ownership transfer in the test.

Expected immediately after checkout: exactly one payment receipt for GHS 125,000.00; agreement `sale_type='cash'`, `amount_paid=125000.00`, `outstanding_balance=0.00`, `financed_amount=0`, zero installment-schedule rows, machine `sale_status='reserved'` and ownership `retained`.

Expected after independent signed handover: exactly one delivery, one ownership transfer, machine `sale_status='sold'`, agreement ownership `transferred`, same original receipt and complete audit evidence.

**Production decision:** Do not merge or deploy until finance/accounting has approved final-price/tax treatment and synthetic acceptance has passed.
