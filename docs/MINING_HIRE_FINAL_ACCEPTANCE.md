# Mining and Equipment Sales & Hire Final Acceptance

## Scope

This acceptance record verifies the production source paths for Mining Operations and Equipment Sales & Hire after the System Administrator-authorized Mining trial-data cleanup. It does not create new production trial records and does not alter Spare Parts data.

## Mining workflow coverage

| Stage | Protected application path |
|---|---|
| Administration | Create, update, safely remove/archive Mining sites and assign staff access |
| Daily operations | Daily logs, production, equipment logs, fuel logs, expenses and incidents |
| Physical control | Stockpiles, adjustments, transfers, dispatch and PDF evidence |
| Fuel control | Tanks, receipts/issues/transfers, reconciliation and consumption reporting |
| Workforce | Contractors, crews, approvals and workforce warnings |
| Period control | Site closings, approval and management intelligence |

## Equipment Sales & Hire workflow coverage

| Stage | Protected application path |
|---|---|
| Commercial entry | Customers, enquiries, availability and quotations |
| Contracting | Conversion, contracts, assets, rate cards, amendments and approvals |
| Operations | Dispatch, meters, work logs, returns and condition evidence |
| Finance | Invoices, deposits, payments, allocation, ageing and financial closing |
| Damage and release | Return inspection, damage assessment, settlement and contract closure |
| Equipment sales | Agreements, installments, payment receipts, delivery, ownership transfer and reminders |

## Controlled correction matrix

| Record family | Approved correction path |
|---|---|
| Mining site | Permanently remove only when empty; otherwise close/archive while preserving linked history |
| Mining stockpile or fuel balance | Documented adjustment movement and reconciliation; never direct database editing |
| Mining dispatch | Controlled cancellation with audit evidence |
| Mining daily/production/equipment/expense records | Status/approval controls and documented replacement or adjustment evidence |
| Hire quotation or contract | Status transition or approved amendment |
| Hire invoice | Protected void route; original evidence remains |
| Hire payment/deposit | Controlled allocation, approval and settlement evidence |
| Hire return/damage | Return inspection, damage assessment and settlement record |
| Equipment sale | Agreement status, payment allocation, delivery and ownership controls |

## Automatic operational alerts

The server refreshes notification rules automatically in production every 15 minutes by default, with a database advisory lock preventing concurrent sync. The interval can be configured but cannot be set below five minutes.

The rules cover Mining low stockpiles, low fuel, pending dispatch, reconciliation variance, incidents and closing review, plus Hire overdue invoices, ending contracts, pending approvals, draft work logs and open damage cases. The existing manual sync remains available for authorised investigation.

## Performance acceptance

Heavy Mining, Hire, shared-report, fleet, administration and worker-document pages use route-level dynamic imports. Authentication, workspace boundaries, role checks and permission wrappers remain outside the lazy-loaded pages and continue to execute before content is displayed.

## Evidence level

This release uses permanent source contracts, backend syntax/tests, frontend tests/lint/build, dependency audit, secret scans and CodeQL. A later real-business transaction should be entered only when the business has genuine Mining or Hire activity; artificial production test records are not recreated after cleanup.
