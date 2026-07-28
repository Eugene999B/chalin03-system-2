# Chalin 03 Equipment Installment Command Centre

## Purpose

The Equipment Installment Command Centre turns the existing Equipment Sales workflow into a controlled installment portfolio and collections operation. It does not recreate the retired Spare Parts installment entry flow and does not alter historical Spare Parts agreements.

## Delivered operating areas

### Portfolio intelligence

- Active installment accounts
- Total sale value, financed amount, collected amount and outstanding balance
- Collection rate and portfolio-at-risk rate
- Overdue, defaulted, high-risk and critical-risk account counts
- Amounts due today, within seven days and within thirty days
- Receivables aging: current, 1–7, 8–30, 31–60, 61–90 and over 90 days
- Ninety-day expected collection forecast
- Risk score and recommended collection action per agreement

### Collections work queue

- Search by customer, phone, agreement or equipment
- Filter by agreement status, risk band and aging bucket
- Customer contact, equipment, balance, arrears, next payment and last-payment evidence
- One consolidated account view with schedule, payments, reminders, delivery and ownership evidence

### Customer follow-up

Staff with Equipment management permission can record:

- Phone calls
- SMS and WhatsApp follow-up
- Field visits
- Promise-to-pay dates and amounts
- Guarantor contact
- Recovery review
- Account notes and next-action dates

Follow-up evidence is stored in the existing protected activity log with user, location, request and audit context. No installment balance or payment value is changed by a follow-up note.

### Reminder control

Location-specific settings provide:

- Automatic SMS enable/disable, off by default
- Manual SMS and prepared WhatsApp controls
- Ghana send time
- Due-soon, due-today and overdue timing
- Weekly and monthly customer-message limits
- Minimum hours between messages
- Minimum outstanding balance
- Maximum messages per run
- Weekend controls
- Custom message template and location payment phone
- Preview, controlled Run Now and recent provider evidence

Automatic reminders are consolidated per agreement and protected by a MySQL named lock, daily deduplication and the saved frequency limits. WhatsApp remains a prepared manual chat until an approved Meta WhatsApp Business API is connected.

## Data-safety boundary

This release uses existing production tables only:

- `equipment_sale_agreements`
- `equipment_installment_schedule`
- `equipment_sale_payments`
- `equipment_sales_reminder_log`
- `sms_log`
- `activity_log`
- `group_configuration`
- `group_configuration_history`

There is no schema migration. The command centre does not create, delete, waive, reschedule, void or rewrite financial records. Payments continue to be recorded through the existing Equipment Sales workspace.

## Permissions and location isolation

- Portfolio and account viewing require `fleet.assets.view`.
- Settings, follow-up and customer messaging require `fleet.assets.manage`.
- The existing Equipment Sales & Hire workspace and location-scope middleware remain authoritative.
- All write actions require a specifically selected Equipment Sales & Hire location.

## Future controlled expansion

The following should be separate audited releases because they require new data structures, management policy or legal review:

1. Credit application, income evidence and affordability assessment
2. Formal credit scoring and approval limits
3. Controlled schedule restructuring and refinancing
4. Repossession, recovery-agent and legal-case management
5. Dedicated collection-officer assignment and targets
6. Customer self-service statement/payment portal
7. Automatic WhatsApp through an approved Meta Business API
8. Bank/MoMo reconciliation and automated payment matching

These items must not be improvised inside the current payment tables.
