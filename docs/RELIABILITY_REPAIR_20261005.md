# CHALIN03 reliability repair — 5 October 2026

The release repairs the object-storage migration's missing SQL column identifier,
claims customer receipt messages before external SMS delivery, and limits scheduled
receipt catch-up to the migration cutover date. Pending, submitted and uncertain
deliveries cannot be automatically resent. Verification uses mocked SMS delivery;
no test sends messages to customers.

Railway's checked-in start and pre-deploy configuration now match the existing
live configuration. Historical repair scripts remain available as explicit
maintenance commands, with their sequencing retained. This release does not
execute those repairs or migrate production storage.

Cloudflare Pages routes rewrite to the root application shell. Rewriting to
/index.html interacted with Pages HTML canonicalization, while the old 404-status
rewrite was unsupported. Explicit application routes preserve real 404 responses
for missing assets without a paid catch-all Function.

Validation on code commit 324765e9f31978202354cba223d1ca5526d670e2:
- 1,062 backend tests pass; the two integration tests are skipped in that unit run
  and both pass separately against disposable MySQL.
- Storage migration executes twice and preserves legacy payloads.
- 44 frontend test scripts pass, lint has zero errors, and production build passes.
- Pages emulator returns 200 for login/recovery/workspace routes and 404 for absent JS.
- Existing lint warnings remain; this release does not claim a warning-free codebase.

CI no longer permits the 42 baseline backend failures. The live smoke requires
the exact release in both API readiness and the deployed frontend bundle, plus
authentication, security headers, service-worker and public-site checks.
Production rollout must be verified independently of these CI results.
