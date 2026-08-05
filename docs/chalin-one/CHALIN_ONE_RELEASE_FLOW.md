# CHALIN ONE — Authoritative Branch and Production Release Flow

This file is the authoritative release rule for CHALIN ONE. It supersedes any earlier CHALIN ONE wording that incorrectly states that Cloudflare or Railway production deploy directly from `main`.

## Permanent branch flow

```text
chalin-one
  Development and complete local/staging verification
        ↓
main
  Integrated release verification before production promotion
        ↓
production
  Cloudflare and Railway production deployment source
```

## Fixed rules

1. All CHALIN ONE development is performed on `chalin-one`.
2. `chalin-one` must never deploy directly to the Cloudflare or Railway production environments.
3. When a completed release has passed its branch tests, it is merged into `main`.
4. The integrated `main` branch must be verified before production promotion.
5. Only an approved and verified `main` commit is merged into `production`.
6. Cloudflare and Railway production remain connected to the `production` branch.
7. Production deployment verification happens after the `production` merge.
8. A failed production deployment is rolled back to the previously verified `production` commit or deployment.

## Required release evidence

Before `main` can be merged into `production`, the release record must contain:

- Exact `chalin-one` source commit.
- Exact `main` verification commit.
- Backend test results.
- Frontend test and build results.
- Database migration rehearsal result when a migration exists.
- Desktop and mobile acceptance result.
- Workspace and permission isolation result.
- Backup and rollback readiness result.
- Final approval to promote `main` into `production`.

## Production protection

- Cloudflare production branch: `production`.
- Railway production branch: `production`.
- `main` is the pre-production integration and verification branch.
- `chalin-one` is the protected long-running CHALIN ONE development branch.
- No production configuration is changed merely to test an unfinished CHALIN ONE feature.

## Emergency hotfix synchronization

When an urgent correction is required in production:

```text
production hotfix
       ↓
verify production
       ↓
synchronize the correction back to main
       ↓
synchronize the correction back to chalin-one
```

This prevents the CHALIN ONE branch from losing fixes that were made while the larger project was still under development.
