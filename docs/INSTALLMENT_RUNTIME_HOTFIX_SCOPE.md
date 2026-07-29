# Installment Runtime Hotfix Scope

This bounded release fixes the Equipment Installment Command Centre runtime before any new finance workflow is added.

- Correct portfolio and collections API failures.
- Make optional historical and evidence columns backward-compatible.
- Prevent unhandled database errors from becoming generic 500 responses.
- Keep agreements, balances, schedules, payments, Hire contracts and equipment locks unchanged.
- Do not add KYC, approval or credit tables in this release.

The next independent release adds an Equipment Hire & Installment Finance gateway after login with two clearly separated division cards.
