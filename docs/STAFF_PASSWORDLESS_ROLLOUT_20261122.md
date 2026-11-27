# CHALIN03 staff passwordless access - controlled rollout

The passwordless work is feature-gated. The live password login, role policy, finance approvals, user sessions and SMS settings remain unchanged until verified cutover.

First sign-in: username or verified Ghana phone number; a short-lived and rate-limited SMS code ONLY for first-time staff identity verification; then unique TOTP secret via QR/manual key, validation and ten downloadable one-time backup codes. Future sign-ins use username/phone and TOTP or one unused recovery code without SMS.

System Administrator FIRST setup skips SMS only from a recently authenticated original-admin session; a public username alone never grants an admin authenticator key. Other users verify their registered phone number before setup. Google account linking requires a completed server-verified OpenID Connect flow and recent reauthentication; it must not change roles or access.

Migration: apply only after a tested backup and independent review. Run staging migration and verification first. Configure distinct STAFF_PASSWORDLESS_HMAC_KEY and STAFF_PASSWORDLESS_ENCRYPTION_KEY securely, never commit values. STAFF_PASSWORDLESS_PILOT and STAFF_PASSWORDLESS_ENFORCED both default false. No mass staff SMS until verified, staff recipient audit complete, and rollout authorized.

Security gates: expire SMS in five minutes, limit resend to one per minute and three per hour, maximum five code attempts, no account enumeration, encrypted secrets, HMAC-hashed recovery codes, prevent TOTP replay, atomic one-time backup redemption, deny legacy sign-in bypass after cutover, no involuntary account lockout, auditable admin recovery, and preserve server-scoped workspace/branch permissions.

SMS draft: CHALIN03: Password sign-in is being replaced. Install Google Authenticator or another authenticator app. On first sign-in verify your phone via SMS, scan the QR code and save backup codes. Never share your codes.
