# CHALIN03 Security 4.0 — controlled rollout

## Phase 1: Browser credential protection
- Staff-cookie transport is deliberately OFF by default (STAFF_COOKIE_SESSIONS_ENABLED).
- Only direct official staff-origin Authenticator sign-in, enrollment and verified rotation issue the host-only Secure HttpOnly SameSite=Strict credential when enabled.
- JS receives a SHA-256-derived marker instead of the bearer credential; both exact marker and matching cookie are required. Cookie-only requests are not authenticated. Existing JWT signature, session, token-version and permission validation remain authoritative.
- Legacy bearer support remains for migration, so this is not a completed compulsory cookie migration. Do not enable before an isolated environment proves sign-in, refresh, cross-tab behavior, all workspace switches, protected media, approvals, exports, logout, rotation and recovery. Do not test with real customer data.
- Staff script policy is report-only because historic printable receipts still contain inline scripts. Refactor and test before enforcement. No fabricated compliance claims.

## Remaining release gates
1. Verify edge WAF managed-rule enforcement, DNSSEC registrar DS, origin certificate matching, and genuine Turnstile on a clean browser.
2. Migrate all remaining browser credentials; add CSRF and session concurrency end-to-end regression tests before compulsory rollout.
3. Introduce verified WebAuthn enrollment and recovery for privileged accounts.
4. Build authorization matrix with negative tests per workspace, branch, object and operation; independent test environment only.
5. Verify MySQL certificate chain, least-privilege DB account and encrypted backups; never rotate encryption keys without a verified restoration path.
6. Complete transaction-bound approvals and migration of legacy password checks.
7. Alerting, append-only audit retention, backup restore drill, GitHub branch policies and independent ASVS review.

No production data or credentials are changed by this PR.
