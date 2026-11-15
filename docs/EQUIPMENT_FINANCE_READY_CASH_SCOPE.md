# CHALIN03 Ready Cash - Pay in Full (Scope Decision)

**Business direction confirmed: 15 November 2026**

Ready Cash is an **equipment sale option**: the customer elects to settle the **entire selling price immediately** instead of entering an installment finance arrangement. It is not a payment method, payment provider, direct-debit service, or new bank/MoMo integration.

## Intended user experience

1. Staff see two distinct choices within Equipment Finance: **Installment** and **Ready Cash / Pay in Full**.
2. Ready Cash selects an available machine, an existing customer and the approved final price.
3. Authorized staff confirm that the full amount has actually been received and retain an internal receipt/reconciliation reference. Never assume payment based only on selecting the option.
4. The business records a single receipt and a zero-balance cash-type sale agreement. It creates no credit application, installment schedule, debt, arrears or recurring deductions.
5. The equipment remains reserved until a different authorized manager verifies the signed handover and ownership documents. Only then mark it SOLD.
6. Both full-payment sales and installment sales appear in appropriate management reports without mixing cash-sale revenue into installment receivables.

## Explicitly out of scope

- Hubtel direct debit / automated wallet deductions
- Paystack checkout or recurring billing
- MoMo or bank integrations, payment webhooks, automatic debits
- Customer payment mandates or installment collection automation

These will be developed as **separate payment-system updates later** and must not be required to select Ready Cash.

## Finance safety and release review

The existing DB describes a full-payment sale as `sale_type='cash'`; **this means a non-credit sale, not that the buyer necessarily tendered physical banknotes**. It also requires a `payment_method` field in the receipt table. The initial draft records manually confirmed payments under the existing `other` method without claiming cash or electronic payment. Before release, the Finance/Accounting owner must approve its reconciliation treatment or replace that interim classification with an accurate existing-tender booking process. No actual funds are moved by this feature.

Continue protecting the unique asset, receipt idempotency, two-decimal accounting, independent signed handover, audit trail, and actual payment evidence. Tax and approved selling-price policy must be confirmed before live use.

**Implementation:** draft pull request #774 from `feature/equipment-finance-ready-cash-20261115` into `main`. Do not merge to production until financial acceptance and tests pass.
