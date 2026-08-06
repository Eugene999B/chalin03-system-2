# CHALIN ONE Staging Acceptance Runbook

**Status:** Development and staging only  
**Production impact:** None  
**Release scope:** Public Website and Content Studio (Release B)

## Purpose

This runbook creates a controlled CHALIN ONE preview without using the live Railway database, production media bucket or public production domains.

The staging preview is used to verify:

- The additive public-content migration.
- Content Studio permissions and independent approvals.
- The public website renderer and deep routes.
- Public forms, real staging submissions and the Enquiry Desk.
- Desktop and mobile behaviour.
- Regression safety for the existing staff system.

It does **not** authorize:

- A production migration.
- A `chalin-one` to `main` merge.
- A `main` to `production` merge.
- A Cloudflare or Railway production deployment.
- Enabling AI or portal flags.

## Required isolation

Staging must have all of the following:

1. A database named `chalin_one_staging` or `chalin_one_staging_<name>`.
2. A staging database user that cannot access the live production database.
3. A separate frontend preview hostname.
4. A separate API preview hostname.
5. A separate media directory or R2 bucket containing `staging` in its name.
6. A unique staging-only public-form IP hash secret.
7. Three different staging staff accounts:
   - Author
   - Reviewer
   - Publisher
8. `FEATURE_PUBLIC_WEBSITE=true` and `FEATURE_CONTENT_STUDIO=true`.
9. All AI and portal feature flags disabled.
10. SMS delivery and installment reminder jobs disabled.

Use `backend/.env.chalin-one-staging.example` as the starting template.

## Safety guard

Every staging command begins with:

```text
CHALIN_ONE_STAGING_CONFIRM=CHALIN_ONE_STAGING_PREVIEW_ONLY
```

The verifier rejects:

- `NODE_ENV=production`.
- The Railway production environment.
- Production database names.
- `chalin03.com`, `www.chalin03.com`, `staff.chalin03.com` and `api.chalin03.com`.
- Shared author, reviewer and publisher accounts.
- Non-isolated media storage.
- Weak or placeholder public-form secrets.
- AI or portal features enabled during Release B acceptance.
- Migration gates left enabled during normal runtime or seeding.

The smoke runner also refuses cross-origin and insecure redirects. It follows only bounded same-origin canonical redirects, such as `/website` to `/website/`.

## Step 1 — Prepare the isolated environment

Create the staging database and staging accounts outside the production database.

Do not grant the staging database user access to the production schema.

Create three different test staff users in staging. Record their IDs in:

```text
CHALIN_ONE_STAGING_AUTHOR_USER_ID
CHALIN_ONE_STAGING_REVIEWER_USER_ID
CHALIN_ONE_STAGING_PUBLISHER_USER_ID
```

The staging author must not be the reviewer. The reviewer must not be the publisher.

## Step 2 — Verify normal staging configuration

Keep migration gates and writing smoke checks closed:

```text
CHALIN_ONE_ALLOW_SCHEMA_MIGRATION=false
CHALIN_ONE_PUBLIC_CONTENT_MIGRATION_CONFIRM=
CHALIN_ONE_STAGING_REQUIRE_PUBLISHED=false
CHALIN_ONE_STAGING_SMOKE_SUBMIT_FORM=false
```

From `backend` run:

```bash
npm ci
npm run verify:chalin-one:staging
```

Expected result:

```text
CHALIN ONE staging environment verified safely.
```

A failure must be corrected. Do not bypass the verifier.

## Step 3 — Rehearse the migration

Create a backup of the isolated staging database before migration.

Temporarily set:

```text
CHALIN_ONE_ALLOW_SCHEMA_MIGRATION=true
CHALIN_ONE_PUBLIC_CONTENT_MIGRATION_CONFIRM=20260805_CHALIN_ONE_PUBLIC_CONTENT_FOUNDATION
```

Run:

```bash
npm run verify:chalin-one:staging:migration
npm run migrate:chalin-one:public-content
npm run migrate:chalin-one:public-content
```

The second migration run verifies idempotency.

Immediately restore:

```text
CHALIN_ONE_ALLOW_SCHEMA_MIGRATION=false
CHALIN_ONE_PUBLIC_CONTENT_MIGRATION_CONFIRM=
```

Then rerun:

```bash
npm run verify:chalin-one:staging
```

Migration gates must never remain open while the application is running.

## Step 4 — Validate the content seed without writing

Run:

```bash
npm run seed:chalin-one:staging:dry-run
```

The dry run validates 33 governed seed identities:

- 3 pages
- 5 business divisions
- 1 company statistic
- 3 FAQs
- 1 public contact form
- 13 navigation items
- 7 public website settings

The dry run does not connect to MySQL and does not write content.

## Step 5 — Create staging drafts

Run once:

```bash
npm run seed:chalin-one:staging
```

The command is idempotent. Existing keys are skipped rather than duplicated.

It creates:

- Home page draft
- About page draft
- Contact page draft
- Spare Parts division draft
- Mining Operations division draft
- Equipment Hire division draft
- Equipment Sales division draft
- Installment Finance division draft
- Business-divisions statistic draft
- Three public FAQ drafts
- Contact form draft
- Header and footer navigation drafts
- Public staging settings

It does not create unverified:

- Leadership profiles
- Office addresses or coordinates
- Testimonials
- Vacancies
- Tenders
- Project claims
- Equipment inventory claims

Those records require verified company information and approved media.

## Step 6 — Run pre-publication smoke checks

Before publishing content, keep both final-acceptance switches disabled:

```text
CHALIN_ONE_STAGING_REQUIRE_PUBLISHED=false
CHALIN_ONE_STAGING_SMOKE_SUBMIT_FORM=false
```

Run:

```bash
npm run smoke:chalin-one:staging
```

This non-writing smoke pass verifies:

- API health.
- Public feature boundaries.
- Anonymous denial for staff feature data and Content Studio APIs.
- Public bootstrap privacy and cache headers.
- Unpublished-page fail-closed behaviour.
- `/website` frontend delivery.
- `/website/pages/about` deep-route delivery.
- `/content-studio` deep-route delivery.
- Safe canonical redirects without cross-origin following.

It does not require published content and does not create a form submission.

## Step 7 — Complete the real governed workflow

Sign in as the staging author and inspect every draft.

For each publishable record:

```text
Draft
  → submit exact version
  → independent reviewer approves or rejects
  → publisher publishes the approved exact version
```

Check that:

- The author cannot approve their own submission.
- A reviewer assigned to another request cannot decide it.
- Rejected content returns to draft.
- Published content retains version and approval evidence.
- Restoring a previous version creates a new draft.
- Archiving does not delete audit history.

Before publication, replace placeholder wording with verified facts and upload approved public-ready media.

## Step 8 — Run final automated staging acceptance

Only after the homepage, contact form and navigation have completed the governed approval and publication flow, enable both final-acceptance switches:

```text
CHALIN_ONE_STAGING_REQUIRE_PUBLISHED=true
CHALIN_ONE_STAGING_SMOKE_SUBMIT_FORM=true
```

Run:

```bash
npm run smoke:chalin-one:staging
```

This pass verifies everything in the pre-publication smoke plus:

- The published homepage API.
- The published contact-form schema.
- Published navigation in the public bootstrap.
- A real `POST /api/public/content/forms/contact/submissions` request.
- HTTP `202` acceptance.
- A valid `WEB-YYYYMMDD-XXXXXXXXXXXX` reference code.
- Private/no-store submission response headers.
- No private storage, network hash, token or user-agent fields in the public response.

This command intentionally creates **one traceable enquiry row** in the isolated staging database. Record its reference code in the acceptance evidence and confirm that it appears in the protected Enquiry Desk. Do not run this writing check against production.

After the final smoke pass, restore the switches unless another controlled acceptance run is planned:

```text
CHALIN_ONE_STAGING_REQUIRE_PUBLISHED=false
CHALIN_ONE_STAGING_SMOKE_SUBMIT_FORM=false
```

Do not delete the staging enquiry merely to make the database look clean. Its audit trail is part of the acceptance evidence.

## Step 9 — Public website browser acceptance

Test `/website/*` on:

- Desktop
- Tablet
- 360–430px mobile widths
- Slow network simulation
- Keyboard-only navigation

Verify:

- Header and footer navigation.
- Published Home, About and Contact content.
- Business divisions.
- FAQs.
- Public forms.
- Form confirmation reference codes.
- Enquiry Desk visibility.
- Draft and rejected content remains private.
- Expired and archived content is not public.
- Private media and internal records do not appear.
- Public website requests carry no staff token or workspace headers.
- Direct refreshes of `/website/pages/about` and other deep routes remain available.

## Step 10 — Content Studio browser acceptance

Test `/content-studio/*` with the author, reviewer and publisher accounts.

Verify:

- Anonymous users and unauthorized staff cannot open Content Studio.
- A direct refresh of `/content-studio` loads the staff surface rather than a frontend 404.
- Each role sees only its permitted actions.
- Exact version IDs are preserved across submit, approve and publish actions.
- Mobile layouts remain usable at 360–430px.
- Archive actions retain versions, approvals and audit history.

## Step 11 — Staff application regression

With both Release B flags enabled only in staging, verify the existing staff system:

- Login and session restoration
- Spare Parts sales and receipts
- Customer statements and debts
- Product and stock workflows
- Mining Operations
- Equipment Hire
- Equipment Installment Finance
- Accounting and audit pages
- SMS remains in mock/disabled mode
- Backup functions remain protected

No CHALIN ONE failure may prevent existing operational pages from loading.

## Step 12 — Complete browser evidence

Copy:

```text
docs/chalin-one/CHALIN_ONE_BROWSER_ACCEPTANCE.example.json
```

to:

```text
backend/artifacts/chalin-one-browser-acceptance.json
```

Fill the copied file with:

- The exact full candidate commit SHA.
- The isolated preview frontend and API URLs.
- `passed: true` only after every named gate passes.
- At least one concrete evidence reference for every gate.
- At least four screenshot references covering desktop, mobile and Content Studio.
- Different reviewer and publisher names.
- A valid acceptance timestamp.

The template is deliberately non-passing. Do not remove a required gate or invent evidence to make it pass.

## Step 13 — Generate final staging acceptance evidence

The following three files must describe the exact same candidate commit:

```text
backend/artifacts/chalin-one-release-evidence.json
backend/artifacts/chalin-one-staging-smoke.json
backend/artifacts/chalin-one-browser-acceptance.json
```

Run:

```bash
npm run evidence:chalin-one:staging
```

The offline aggregator:

- Makes no network or database calls.
- Rejects malformed or mismatched commit SHAs.
- Rejects production, credentialed and non-isolated URLs.
- Requires every automated release gate to be true.
- Requires the final published-content smoke and real staging enquiry reference.
- Requires every browser, mobile, permission and regression gate.
- Requires at least four screenshot references.
- Requires independent reviewer and publisher sign-off.

It writes:

```text
backend/artifacts/chalin-one-staging-acceptance.json
```

The only acceptable final result is:

```json
{
  "staging_ready": true,
  "commit_match": true,
  "failures": []
}
```

Any other result blocks integration. Generated evidence files remain outside source control.

## Step 14 — Acceptance record

Preserve:

- Git commit SHA
- Database name
- Migration start and completion timestamps
- Migration verifier output
- Second-run idempotency result
- Backend test result
- Frontend test result
- Production frontend build result
- Machine-readable release-evidence artifact
- Non-writing smoke report
- Final published-content smoke report
- Intentional staging enquiry reference code
- Browser and mobile acceptance screenshots
- Permission test matrix
- Final staging acceptance artifact
- Known non-blocking issues
- Reviewer and publisher sign-off

## Emergency shutdown

If staging behaves unexpectedly:

1. Set `FEATURE_PUBLIC_WEBSITE=false`.
2. Set `FEATURE_CONTENT_STUDIO=false`.
3. Stop the staging frontend and API.
4. Preserve logs, smoke reports and the staging database for investigation.
5. Do not apply the same change to production.

Because staging uses separate domains, database credentials and media storage, this shutdown has no production impact.

## Release gate

Release B is ready for integration only when:

- GitHub CI is genuinely green.
- MySQL acceptance passes.
- Staging migration and second-run idempotency pass.
- Both staging smoke modes pass.
- The intentional staging enquiry is visible in Enquiry Desk with an intact audit trail.
- All critical browser tests pass.
- Existing business workflows pass regression testing.
- Content is reviewed and approved.
- Backup and rollback evidence is complete.
- The final staging evidence says `staging_ready: true` for one exact commit.

Only then may Eugene separately authorize:

```text
chalin-one → main
```

Production remains a later, separately authorized release.
