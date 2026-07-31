# Equipment Installment Finance — Phase 1 Usability Release

## Purpose

Make the daily installment workflow understandable to a new employee and usable on a phone without weakening credit, payment, equipment or ownership controls.

## Simple operating journey

1. Create or select a reusable Finance customer.
2. Select the exact available excavator.
3. Enter the selling price, deposit, payment frequency and number of payments.
4. Complete KYC, guarantor and affordability information.
5. Create one draft credit application.
6. Verify KYC and record an independent manager decision.
7. Activate the agreement and dated schedule.
8. Record the opening deposit and reserve the exact excavator.
9. Run collections, arrears, delivery and ownership controls.

## Included

- company-wide Finance pages with no Hire-location selector
- phone-first Finance Home
- Start New Installment wizard with local draft recovery
- reusable standalone Customer Centre with duplicate checks
- automatic approved commercial Installment Offer inside the wizard
- single Excavators register/reference page
- protected excavator editing only before an active application, reservation or agreement
- complete uncropped machine-photo viewing
- large money values that wrap instead of clipping or ellipsising
- simplified sidebar
- dedicated Installment Finance guide
- company-wide application, agreement activation, deposit/reservation and reports pages

## Preserved controls

- Hire operations remain location-controlled and separate.
- Finance uses the excavator's physical yard internally only for required database provenance.
- The automatic Installment Offer does not approve the customer's credit.
- KYC verification and manager credit approval remain independent actions.
- Agreement activation does not post money or reserve equipment.
- Partial deposits do not reserve equipment.
- Machine identity and pricing lock after an active Finance application or agreement begins.
- Delivery and ownership transfer remain separate controlled lifecycle actions.

## Release workflow

The complete Phase 1 batch must pass backend tests, frontend source tests, lint, production build, dependency audit, secret scan, migration safety and CodeQL on its exact branch head. It is then merged into `main`, followed by a separate reviewed `main` to `production` promotion.
