# Password Change Reliability Fix — 26 July 2026

## Scope

This release repairs the shared account-password change path used by the original System Administrator and every other authenticated user.

## Root causes corrected

1. A wrong current password returned HTTP 401. The shared Axios interceptor interpreted that credential-validation response as an expired or revoked login and cleared the active browser session.
2. The password hash was written before session revocation completed. A later database failure could therefore return an error after the password had already changed.
3. A secondary audit-log failure could make a completed password change appear unsuccessful.

## New behaviour

- Wrong current passwords return HTTP 400 with code `CURRENT_PASSWORD_INCORRECT` and remain on the password page.
- Genuine expired, revoked or replaced sessions still force a secure logout.
- Password update, token-version increment and active-session revocation commit in one database transaction.
- Any session-revocation failure rolls back the password update.
- A concurrent password change fails closed and asks the user to login again.
- Secondary alert/audit delivery cannot turn a committed password change into a false failure response.

## Data safety

No Spare Parts, Mining, Equipment Sales & Hire, customer, stock, sales, accounting or operational data is changed by this release. No schema migration is required.
