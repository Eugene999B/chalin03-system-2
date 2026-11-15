# CHALIN03 — Ready Cash equipment sales

**Business definition:** Ready Cash means **Pay in Full**, an alternative to Installment Finance. It is a sale type, not a payment method and **does not integrate Hubtel, Paystack, mobile money, bank APIs or automatic direct debit**. Those projects are separate future phases.

**Implementation:** feature branch `feature/equipment-finance-ready-cash-20261115`, PR #774. Merge through `main` to `production` only after CI and operational acceptance; do not test on real customer transactions.

## Staff operating instructions

1. Sign in to the **Equipment Installment Finance** workspace with `fleet.assets.view` and `fleet.assets.manage` permissions.
2. In the navigation, select **Ready Cash · Full Payment**. You can also open `/equipment-installment-finance/applications?stage=ready-cash` from the Finance homepage.
3. Use an active company Finance customer (create the customer in the existing **Customers** screen first if needed).
4. Select the *exact available excavator*, and confirm its identity, serial number, protected photograph and registered final selling price.
5. Obtain the Finance-approved invoice or other documented sale-price evidence. In **Included tax/levy portion of full price**, enter the **approved included tax amount**. If the approved treatment is tax-free, explicitly enter `0.00`. The system deducts the included tax portion from the pre-tax amount; it does **not** add another charge on top of the displayed full price. Confirm the Finance tax-review checkbox.
6. Confirm that the buyer has **already paid the complete price** through the company's existing approved payment processes. Enter the internal receipt or reconciliation reference. Do not tick the confirmation if money has not been collected or verified. The Ready Cash feature itself does not take or initiate payment.
7. Confirm the customer's full-sale terms. Choose **Record full payment & reserve machine** once.
8. The checkout records a single final-price receipt and asset reservation with a zero outstanding balance, and creates **no** installment application, scheduled repayments, or loan arrears. The machine remains **Paid in Full / Awaiting Handover**.
9. Use **Download official receipt (PDF)** or the **Receipt PDF** action in the Ready Cash register. If the request response was unclear, check the register first; do not submit a second sale.
10. A *different authorized Finance manager* signs in. Under **Handover & mark sold**, choose the paid sale, inspect and physically hand over the exact excavator, enter the receiving person's name, actual machine condition, delivery destination and **reference to the signed delivery / ownership document**.
11. Tick the independent signed-handover confirmation and select **Confirm handover & mark machine sold**. Only then does the asset status change to **SOLD**, with an ownership-transfer record.
12. Review the final sale, original receipt, audit trail, cash reconciliation and sales records.

## Example — full purchase of an excavator

- Machine: EX-001
- Final registered and approved price: GHS 250,000.00 (example only)
- Finance-approved included tax component: GHS 0.00 **only if specifically approved**; otherwise enter the approved actual included tax amount
- Customer pays full GHS 250,000.00 in the existing payment process
- Staff confirm evidence and book Ready Cash; agreement paid GHS 250,000.00, outstanding GHS 0.00
- No credit application or installment schedule; delivery still pending
- Different authorized Finance manager verifies signed handover; the machine becomes SOLD and ownership transferred

## Controls and accounting semantics

- `sale_type='cash'` means non-credit sale within the existing schema; it **does not prove that physical banknotes were tendered**.
- The existing required `payment_method='other'` records a **manually confirmed settlement with unspecified tender**. Accounting must reconcile this to the true payment source; users must not mistake it for a new electronic-payment integration.
- A unique checkout UUID prevents duplicate postings. Repeat requests are checked against the exact customer, asset, final price, included tax amount and internal payment reference.
- The original machine's price, active Hire/Finance reservations and competing sales are checked inside the transaction; an error rolls back sale and payment records.
- One machine can only be sold once. Stock reservation remains in place until signed handover.
- Signed delivery and ownership are recorded in one transaction by a different authorized manager after non-voided payment-ledger reconciliation.
- The PDF receipt is a company-wide Finance document; it does not depend on a Hire-location record.
- Tax is **not automatically calculated**. A signed-off tax amount is necessary; current v1 does not implement a statutory invoice renderer or tax-jurisdiction engine. Managers must review output for compliance.
- Never alter an existing customer receipt, create an unverified refund, issue a duplicate sale, or record a real transaction to test this feature.

## Acceptance / verification

Run backend `npm run syntax-check`, `npm test`, and `npm run migration-safety`; run frontend `npm test`, `npm run lint`, and `npm run build`, plus browser tests. Validate a synthetic customer, eligible machine, price including an approved tax component, full-payment record, one receipt PDF, original sale audit, a separate manager's signed handover, and the final SOLD and ownership state. Verify both Railway and Cloudflare after release; code checks alone do not establish live business workflow success.

Operational staff must use real accounting evidence for payments, approved tax policy and signed handover. No background payment collection, MoMo, Hubtel or Paystack is part of this feature.
