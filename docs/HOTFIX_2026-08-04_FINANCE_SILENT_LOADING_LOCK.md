# Equipment Finance Silent Loading Lock Hotfix

## Production symptom

Applications & Approvals could remain on a loading state without a visible browser-console error.

## Root causes

1. The shared Axios stale-session branch returned a promise that never settled.
2. Applications & Approvals waited for readiness and register requests together.
3. The critical default Applications page itself was loaded through React Suspense.

## Repair

- Retry one stale authenticated request with the current token.
- Never return an unresolved promise from the request layer.
- Apply five-second readiness and twelve-second Finance application read deadlines.
- Allow a transport-delayed readiness probe to degrade without blocking the register.
- Load Applications & Approvals eagerly; retain lazy loading for the heavier secondary Finance stages.

## Safety

- No migration.
- No database mutation.
- No approval, KYC, payment, agreement, Hire, Mining, or Spare Parts write behavior changes.
