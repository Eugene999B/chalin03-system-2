# CHALIN ONE Staging Acceptance Runbook

**Status:** Development and staging only  
**Production impact:** None  
**Release scope:** Public Website and Content Studio (Release B)

## Purpose

This runbook creates a controlled CHALIN ONE preview without using the live Railway database, production media bucket or public production domains.

The staging preview is used to verify:

- The additive public-content migration.
- Content Studio permissions and independent approvals.
- The public website renderer.
- Public forms and the Enquiry Desk.
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

Keep migration gates closed:

```text
CHALIN_ONE_ALLOW_SCHEMA_MIGRATION=false
CHALIN_ONE_PUBLIC_CONTENT_MIGRATION_CONFIRM=
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

## Step 6 — Complete the real governed workflow

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

## Step 7 — Public website acceptance

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

## Step 8 — Staff application regression

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

## Step 9 — Acceptance evidence

Record:

- Git commit SHA
- Database name
- Migration start and completion timestamps
- Migration verifier output
- Second-run idempotency result
- Backend test result
- Frontend test result
- Production frontend build result
- Browser acceptance screenshots
- Mobile acceptance screenshots
- Permission test matrix
- Public form reference codes
- Known non-blocking issues
- Reviewer and publisher sign-off

## Emergency shutdown

If staging behaves unexpectedly:

1. Set `FEATURE_PUBLIC_WEBSITE=false`.
2. Set `FEATURE_CONTENT_STUDIO=false`.
3. Stop the staging frontend and API.
4. Preserve logs and the staging database for investigation.
5. Do not apply the same change to production.

Because staging uses separate domains, database credentials and media storage, this shutdown has no production impact.

## Release gate

Release B is ready for integration only when:

- GitHub CI is genuinely green.
- MySQL acceptance passes.
- Staging migration and second-run idempotency pass.
- All critical browser tests pass.
- Existing business workflows pass regression testing.
- Content is reviewed and approved.
- Backup and rollback evidence is complete.

Only then may Eugene separately authorize:

```text
chalin-one → main
```

Production remains a later, separately authorized release.
