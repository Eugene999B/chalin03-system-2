# CHALIN ONE — Phase 1 Feature Flag Verification

## Authoritative release flow

```text
chalin-one → main → production → Cloudflare and Railway production
```

- Development happens on `chalin-one`.
- Completed work is merged into `main` and verified.
- Verified `main` is merged into `production`.
- Cloudflare and Railway production deploy from `production`.

## Phase 1 implementation

### Backend

- Central feature definition registry.
- Explicit boolean environment parsing.
- Fail-closed defaults for every CHALIN ONE capability.
- Master AI emergency shutdown through `FEATURE_AI_ENABLED`.
- Dependency enforcement for AI child capabilities.
- Public-only effective feature snapshot.
- Authenticated staff effective feature snapshot.
- Controlled `FEATURE_DISABLED` middleware response.
- Unknown feature names rejected at route-registration time.
- No-store response headers for rapid emergency flag propagation.

### Frontend

- Central `FeatureFlagProvider`.
- Public snapshot before authentication.
- Staff snapshot after a login-token change.
- Automatic token-change detection without modifying ordinary authentication flows.
- Thirty-second visible-page refresh for emergency flag changes.
- Fail-closed behavior when the feature endpoint is unavailable.
- `FeatureFlagRoute` for protected future routes.
- `FeatureFlagVisible` for protected future navigation and controls.
- Existing Chalin 03 pages remain mounted independently of optional CHALIN ONE availability.

### Default environment state

All flags are false unless explicitly enabled:

- `FEATURE_AI_ENABLED`
- `FEATURE_PUBLIC_WEBSITE`
- `FEATURE_CONTENT_STUDIO`
- `FEATURE_CHALIN_COPILOT`
- `FEATURE_CHALIN_EXECUTIVE`
- `FEATURE_CHALIN_GUIDE`
- `FEATURE_CUSTOMER_PORTAL`
- `FEATURE_SUPPLIER_PORTAL`
- `FEATURE_APPLICANT_PORTAL`
- `FEATURE_AI_ACTIONS`
- `FEATURE_AI_SCHEDULED_JOBS`

## Security boundaries

- Anonymous callers receive only public-classified feature names.
- Staff status requires normal authentication.
- Status endpoints return effective booleans only.
- Environment variable values and secrets are never returned.
- A frontend flag never grants permission or workspace access.
- Future backend routes must still apply authentication, workspace, location and permission middleware after `requireFeature`.
- Disabling the master AI flag disables Copilot, Executive, Guide, AI actions and scheduled AI work through dependency evaluation.

## Branch verification

At the time of this report:

- `chalin-one` contains only CHALIN ONE development commits beyond `main`.
- `main` has not received Phase 1 changes.
- `production` has promotion commit history beyond `main`, but the branch comparison reports no file-tree differences from the current `main` tree.
- Neither `main` nor `production` was modified by Phase 1 development.

## Automated verification

The repository now includes `.github/workflows/chalin-one-ci.yml`.

For every subsequent push to `chalin-one`, it runs:

1. Backend dependency installation.
2. Backend syntax checks.
3. Complete backend tests.
4. Frontend dependency installation.
5. Complete frontend tests.
6. Frontend production build.

Phase 1 is considered code-complete only after these checks report success and branch comparison confirms that no production branch was changed.
