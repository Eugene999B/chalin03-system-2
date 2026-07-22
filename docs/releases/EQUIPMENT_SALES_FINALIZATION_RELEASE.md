# Equipment Sales & Hire Finalization Release

Release scope:

- Retire new Spare Parts installment entry while preserving historical data and restore compatibility.
- Add Equipment Sales quotation, agreement, statement, receipt, delivery, overdue and ownership PDFs.
- Add automatic due-soon, due-today and overdue SMS reminders with deduplication.
- Add collections, aging, profit, expected-payment, equipment-portfolio and staff reports.
- Add mobile document downloads, CSV export and reminder controls.

Production gate:

1. Cloudflare must compile the exact branch head.
2. The pull request must remain mergeable.
3. Railway must report success for the merged production commit.
4. The additive migration must verify both Equipment Sales foundation and Spare Parts retirement guards before serving the new module.
