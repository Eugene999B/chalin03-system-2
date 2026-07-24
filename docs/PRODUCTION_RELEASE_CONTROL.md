# Chalin 03 Production Release Control

## Purpose

Production must not deploy merely because a feature pull request is merged into `main`.

The repository now uses these branch responsibilities:

- `agent/*`: isolated implementation branches.
- `main`: reviewed, integrated and release-candidate code.
- `production`: the only branch approved to trigger the live Railway and Cloudflare production deployments.

The `production` branch was created from the current `main` baseline before Phase 0 changes. Do not copy Phase 0 into it until the complete Phase 0 gate and recovery drill pass.

## Required external configuration

Repository code cannot change the branch watched by an existing Railway or Cloudflare service. An authorised project administrator must complete both dashboard changes before claiming that merge and deployment are separated.

### Railway backend

1. Open the Chalin 03 Railway project.
2. Select the backend service.
3. Open **Settings**.
4. Under the GitHub service source or deployment trigger, change the connected branch from `main` to `production`.
5. Prefer disabling automatic deployments until the first controlled release is completed.
6. Save the service settings.
7. Confirm the Root Directory and start command still point to the backend application.

Railway deploys pushes to the connected GitHub branch. Changing the trigger branch is therefore mandatory; adding a GitHub branch alone is not sufficient.

### Cloudflare Pages frontend

1. Open **Workers & Pages** and select the Chalin 03 Pages project.
2. Open **Settings** > **Builds & deployments**.
3. Open the production branch controls.
4. Change the production branch from `main` to `production`.
5. Disable automatic production deployments until the first controlled release is approved, or keep it enabled only after the release process below has been verified.
6. Set preview deployments according to policy; feature branches may use preview URLs but must not become the production deployment.
7. Save the settings.

## Phase 0 recovery drill

Complete this drill before Phase 0 is approved for merge:

1. Create a fresh signed full-system backup using the Phase 0 backup format.
2. Record the backup identifier, manifest version, creation time and source migration state.
3. Create a disposable recovery database that cannot reach production traffic.
4. Restore the signed backup into that isolated database.
5. Confirm the restore rejects a deliberately altered backup and a backup with an omitted durable table.
6. Compare the manifest table inventory, schema fingerprints and restored row counts.
7. Verify representative records for users, permissions, branches, products, sales, debts, purchases, expenses, mining, equipment hire, documents and audit history.
8. Confirm all sessions, recovery OTPs and temporary protected-action credentials that existed before restore are invalid.
9. Record the drill result and destroy or securely retain the isolated recovery database according to policy.
10. Do not run the restore against the live production database during this rehearsal.

## Release process

1. Build a change on an `agent/*` branch.
2. Open a draft pull request into `main`.
3. Pass backend syntax, migration safety, backend tests, frontend tests, lint, build, dependency audit, repository secret checks and CodeQL.
4. Complete the required desktop, mobile and role/workspace checks.
5. Merge into `main`. This creates a release candidate only.
6. Verify that neither Railway nor Cloudflare deployed from the `main` merge.
7. Open a separate pull request from `main` into `production`.
8. Re-run the complete required checks and attach the production release checklist.
9. Approve and merge the release pull request.
10. Observe Railway and Cloudflare deployments.
11. Run the post-deployment production-smoke workflow.
12. Confirm health, readiness, authentication gates, security headers, service worker, manifest and key business journeys.
13. Record the released commit and recovery point.

## Emergency stop

If merging to `main` still triggers either live platform:

1. Disable automatic deployments in that platform immediately.
2. Do not merge another feature pull request.
3. Record the unexpected deployment and exact commit.
4. Verify the live API and frontend before resuming work.
5. Correct the watched branch to `production`.

## Rollback rule

Do not rewrite database history or run `database/schema.sql` against production. Roll application code forward or use the hosting platform's approved deployment rollback only after confirming database compatibility. Database recovery must use a verified signed backup in an isolated recovery procedure.
