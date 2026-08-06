# CHALIN ONE Release Candidate Evidence

**Scope:** Release B — Public Website and Content Studio  
**Environment:** Isolated acceptance database or verified staging only  
**Production authorization:** None

## Purpose

A green build alone is not enough to release CHALIN ONE. This evidence package records the database, governance, publication and anonymous-access conditions that existed for the exact candidate commit.

The package contains two machine-readable reports:

```text
backend/artifacts/chalin-one-release-evidence.json
backend/artifacts/chalin-one-staging-smoke.json
```

Generated reports are intentionally ignored by Git. The MySQL acceptance workflow uploads the release-evidence report as a GitHub Actions artifact retained for 30 days.

## Commands

From `backend`:

```bash
npm run evidence:chalin-one:release
npm run smoke:chalin-one:staging
```

The evidence command is read-only. It accepts only:

- `NODE_ENV=test` with a database matching `chalin_one_acceptance*`; or
- a database approved by the CHALIN ONE staging safety verifier.

The smoke command uses anonymous GET requests only. It does not send:

- Authorization headers
- Cookies
- Staff tokens
- Workspace headers
- Form submissions
- Database writes

## Database evidence gates

The release-evidence command verifies:

1. The approved public-content migration record exists.
2. All 28 expected public-content tables exist.
3. Critical existing business-table row counts are recorded.
4. No pending approval is assigned to its requester.
5. No approved request was decided by its requester.
6. Approved and rejected decisions contain reviewer evidence.
7. Pending approvals target an exact page or content version.
8. Every active public media asset is processed and ready.
9. Exactly one homepage is published.
10. Every published page has a published page version.
11. Published navigation exists.
12. At least one public form is published.
13. Active public website settings exist.
14. Draft pages cannot be returned by the public content service.
15. Draft forms cannot be returned by the public content service.

The generated JSON includes:

- Candidate commit SHA when supplied by GitHub or Railway.
- Environment mode and database name.
- Migration timestamp.
- Missing-table list.
- Existing business row counts.
- Publication counts by table and status.
- Version counts.
- Approval-integrity totals.
- Media-readiness totals.
- Public-integrity totals.
- Content Studio dashboard snapshot.
- Public-bootstrap summary.
- Individual release gates.
- Final `release_ready` result.

A command exit code of `2` means the report was created, but one or more release gates are incomplete or failed. Exit code `1` means evidence generation itself failed.

## Anonymous staging smoke gates

The staging smoke runner verifies:

1. The API health endpoint is successful.
2. The anonymous feature response is classified as public.
3. `publicWebsite` is enabled.
4. AI Guide and all external portals remain disabled.
5. Staff-only feature names are not exposed anonymously.
6. Feature responses use a no-store cache policy.
7. Anonymous access to the staff feature endpoint is rejected.
8. Anonymous access to Content Studio is rejected.
9. The public bootstrap loads through the published API.
10. Published responses use public cache controls.
11. Public responses contain no private field names such as storage keys, IP hashes, user agents, secrets or tokens.
12. An unpublished-page probe returns the controlled public 404 response.
13. Unpublished responses are private/no-store.
14. The public frontend serves HTML from the staging hostname.

Set this only after author, reviewer and publisher have completed the governed workflow:

```text
CHALIN_ONE_STAGING_REQUIRE_PUBLISHED=true
```

With this enabled, the smoke runner additionally requires:

- Published `home` page.
- Published `contact` form.
- Published public navigation.

Before publication, leave the value false so infrastructure and privacy checks can run while all seeded records remain drafts.

## Required acceptance order

```text
CI backend/frontend checks
        ↓
MySQL migration rehearsal twice
        ↓
Database-backed workflow acceptance
        ↓
Acceptance evidence artifact
        ↓
Create isolated staging environment
        ↓
Seed controlled drafts
        ↓
Author review
        ↓
Independent reviewer approval
        ↓
Publisher publication
        ↓
Release evidence against staging
        ↓
Anonymous smoke with published-content requirement
        ↓
Desktop/mobile browser acceptance
        ↓
Existing business regression tests
        ↓
Release B sign-off
```

## Evidence review

The reviewer must confirm:

- `release_ready` is `true` in the staging evidence report.
- Every smoke check has `passed: true`.
- The report commit SHA matches the candidate being reviewed.
- The database name is the approved staging database.
- No production hostname, database or media bucket appears in the report.
- The migration and second-run idempotency logs belong to the same candidate.
- Browser screenshots and manual acceptance belong to the same staging deployment.

Machine-readable evidence does not replace manual browser acceptance. It complements it.

## Failure response

If a release gate fails:

1. Keep `FEATURE_PUBLIC_WEBSITE=false` and `FEATURE_CONTENT_STUDIO=false` outside staging.
2. Preserve the failed JSON report and related logs.
3. Fix the underlying code, data or configuration.
4. Rerun the complete relevant job; do not edit the evidence JSON manually.
5. Repeat staging smoke and browser acceptance.

If a private field appears in an anonymous response, treat it as a release-blocking security defect.

## Production boundary

These reports do not authorize:

- Running the migration on Railway production.
- Enabling production feature flags.
- Merging `chalin-one` into `main`.
- Merging `main` into `production`.
- Deploying Cloudflare or Railway production.

Those steps remain separately authorized only after Release B acceptance is complete.
