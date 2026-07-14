# Role Permission Matrix

The authoritative matrix is implemented in `backend/security/permissionCatalog.js`.

Group admin has every permission and automatic access to enabled workspaces.

Cashier is Spare Parts-only and receives no Mining or Equipment Hire permissions.

Auditor is read-only for operations, with audit/report/export permissions.

Mining roles:

- manager: Mining operations, approvals, reports and operational Fleet support.
- site_supervisor: assigned-site logs, production/equipment approvals, incidents and reports.
- equipment_operator: equipment logs, readings and inspections only.
- site_clerk: draft daily logs, production, fuel and incident entry.
- accountant: expenses, financial summaries and reports.
- auditor: read-only Mining audit/report access.

Equipment Hire roles:

- manager: all Hire operations, approvals, closure and reports.
- hire_officer: customers, enquiries, quotations and contract preparation.
- dispatcher: dispatches, work logs, returns and operational closure.
- fleet_officer: Fleet assets, readings, fuel, maintenance and inspections.
- accountant: invoices, payments, receivables and financial closure.
- auditor: read-only Hire audit/report access.

