# Password Change Fix Verification Checklist

- [x] Wrong current password is a validation error and does not clear the browser session.
- [x] Correct password change updates the hash and token version.
- [x] All active sessions are revoked in the same database transaction.
- [x] Session-revocation failure rolls the password update back.
- [x] Concurrent password changes fail closed.
- [x] Genuine expired and revoked sessions still force logout.
- [x] Backend contract coverage added.
- [x] Frontend regression coverage added.
- [x] No schema migration.
- [x] No business data operation.
