# Phase 0 Production Promotion

Release candidate: `c580e8c9edb260f170526e9f641013afe3e1fe4e`

This promotion contains the completed Phase 0 production-safety controls verified in pull request #67.

## Release gates

- Production Migration Safety
- Desktop authentication/session-race verification
- Password-only login and expense evidence
- Full-history secret scan
- Backend syntax and complete tests
- Frontend source tests, full lint and production build
- Production dependency audit
- Repository secret and environment checks
- CodeQL security-extended analysis and reviewed SARIF policy
- Signed Version 2 isolated backup/restore drill

## Deployment control

Railway and Cloudflare must continue watching only the `production` branch. Automatic build/deploy may be enabled for `production` after the promotion PR checks pass and the required production environment variables are configured.
