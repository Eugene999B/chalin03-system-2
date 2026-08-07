# CHALIN ONE CI Observability

## Purpose

CHALIN ONE remains isolated on the `chalin-one` development branch until the complete release candidate is accepted. This document records how automated evidence is exposed without merging to `main`, `production`, deploying, or touching a live database.

## Workflow coverage

`.github/workflows/chalin-one-ci.yml` runs for:

- pushes to `chalin-one`;
- pull requests targeting `chalin-one`;
- pull requests targeting `main` or `production`.

The workflow executes four verification layers:

1. backend staging-safety checks, migration-safety checks, syntax checks, and backend tests;
2. isolated MySQL 8.4 migration rehearsal, second-run idempotency, database-backed Content Studio acceptance, and release-evidence generation;
3. dedicated CHALIN ONE frontend contracts, JSX compilation, the full frontend regression suite, and the production Vite build;
4. an aggregate `chalin-one/ci` commit status that reports pending, success, or failure and links to the exact workflow run.

## Machine-readable evidence

The database-acceptance job uploads:

`backend/artifacts/chalin-one-release-evidence.json`

The generated artifact is retained by GitHub Actions for 30 days and is excluded from source control. A release candidate is not accepted merely because the file exists; its `release_ready` field must be `true` and every gate must pass.

## Safe verification procedure

1. Confirm the candidate is based on the latest `main` history.
2. Run the complete workflow against the exact candidate commit or pull-request merge commit.
3. Inspect all backend, database, frontend, and build results.
4. Download and inspect the release-evidence artifact.
5. Keep feature flags disabled and do not run the public-content migration against production.
6. Proceed to isolated staging only after automated evidence is green.
7. Do not merge to `main` or `production` until browser acceptance, permissions, responsive layouts, public rendering, forms, and rollback controls are accepted.

## Failure handling

A failing aggregate status is diagnostic, not a release authorization. Inspect the exact failed job and patch only the confirmed defect on `chalin-one`. Do not bypass a failing job, weaken a governance gate, or substitute email silence for a successful workflow conclusion.
