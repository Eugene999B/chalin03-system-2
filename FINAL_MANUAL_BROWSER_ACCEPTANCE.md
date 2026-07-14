# Final Manual Browser Acceptance

1. Start backend and frontend locally.
2. Log in as admin to Spare Parts.
3. Confirm products, sales, receipt preview/PDF and `IN GOD, WE TRUST`.
4. Open Audit Trail, filter by action, export CSV and open a record detail.
5. Open Backup & Restore, select a backup and run dry-run validation.
6. Open System Operations and confirm health/readiness/diagnostics.
7. Log in to Mining as each assigned role and confirm allowed actions only.
8. Log in to Equipment Hire as each assigned role and confirm allowed actions only.
9. Confirm cashier cannot enter Mining or Equipment Hire.
10. Confirm auditor can view reports/audit records but cannot mutate operations.

Expected backend errors appear with `request_id` in the response and backend log.
