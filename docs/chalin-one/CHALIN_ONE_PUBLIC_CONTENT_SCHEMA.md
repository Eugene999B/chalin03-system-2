# CHALIN ONE — Public Content Database Contract

This document defines the Phase 2 database foundation for the CHALIN ONE public website and Chalin Content Studio.

## Permanent release rule

All work remains on `chalin-one` until the complete CHALIN ONE project is finished and accepted.

```text
chalin-one -> main verification -> production -> Cloudflare and Railway
```

No Phase 2 migration is applied to production merely because it exists in this branch.

## Design goals

The public-content foundation must:

- Keep public website data separate from operational sales, debt, mining, hire and finance records.
- Allow non-programmers to draft, review, approve, schedule, publish, expire and archive content.
- Preserve the currently published version while a new draft is being prepared.
- Record who created, reviewed, approved, published, restored or archived content.
- Keep public form uploads private until they pass validation and security review.
- Support desktop and mobile page composition without hard-coded frontend content.
- Remain additive and backward-compatible with the existing Chalin 03 application.
- Work when every CHALIN ONE feature flag is disabled.

## Publication lifecycle

All publishable records use this controlled lifecycle:

```text
draft
  -> in_review
  -> approved
  -> scheduled or published
  -> expired or archived
```

Rules:

1. Editors may create and change drafts.
2. A submitted draft receives a review/approval record.
3. The published record does not change until an authorized approval is executed.
4. Scheduled records are not public before `publish_at`.
5. Expired or archived records are not returned by public APIs.
6. Restoring an old version creates a new version; it does not erase history.

## Version model

### Pages

Pages use structured versions:

- `public_pages` stores the permanent page identity and publication state.
- `public_page_versions` stores titles, SEO, summary, settings and version metadata.
- `public_page_sections` stores ordered page-builder sections for one page version.

A published page may therefore keep serving its latest published version while a newer draft version is edited.

### Other content types

`public_content_versions` stores immutable JSON snapshots for news, announcements, leadership, divisions, projects, equipment, testimonials, locations, statistics, vacancies, tenders, FAQs, forms and other future content types.

The domain table remains the current approved/published record. Draft edits are saved as version snapshots until an authorized approval promotes them.

## Media boundaries

### Public media

`public_media_assets` contains assets approved for website or Content Studio use. It records:

- Storage provider and object key.
- MIME type, file size and dimensions.
- Accessibility alternative text.
- Caption and credit.
- SHA-256 checksum for duplicate detection.
- Visibility and processing status.
- Uploading user and timestamps.

A media record is not automatically public merely because it was uploaded. Public APIs must require both an allowed visibility and an active/ready processing status.

### Form-submission files

Public form uploads are stored in `public_form_submission_files`, not `public_media_assets`.

They remain private and use a security state such as:

- pending
- clean
- rejected
- quarantined

No public URL is stored for submission files.

## Public/private boundary

Anonymous public APIs may expose only:

- Published and currently effective content.
- Publicly visible media.
- Public site settings explicitly marked `is_public = 1`.
- Active public forms and their public field definitions.

Anonymous public APIs must never expose:

- Drafts or review comments.
- User IDs or internal approval details.
- Audit before/after snapshots.
- Private form submissions.
- Form-upload storage keys.
- Internal notification destinations.
- Unpublished equipment, vacancies, tenders or locations.

## Table groups

### Media and site configuration

- `public_media_folders`
- `public_media_assets`
- `public_site_settings`
- `public_navigation_items`

### Pages and reusable layout

- `public_pages`
- `public_page_versions`
- `public_page_sections`

### Company and editorial content

- `public_news_categories`
- `public_news_articles`
- `public_announcements`
- `public_business_divisions`
- `public_leadership_profiles`
- `public_projects`
- `public_project_media`
- `public_equipment_catalogue`
- `public_testimonials`
- `public_locations`
- `public_company_statistics`
- `public_job_vacancies`
- `public_tenders`
- `public_faqs`

### Public forms and enquiries

- `public_forms`
- `public_form_fields`
- `public_form_submissions`
- `public_form_submission_files`

### Governance and history

- `public_content_versions`
- `public_content_approvals`
- `public_content_audit_log`

## Core data rules

### Slugs and keys

- Public slugs are unique within their content table.
- Stable internal keys/codes are unique and are not silently changed after integrations depend on them.
- Slugs contain normalized lowercase URL-safe values at the API layer.

### User references

All staff actor references use nullable `INT` foreign keys to the existing `users(id)` column and use `ON DELETE SET NULL` so content history survives user deactivation or deletion.

### Deletion policy

Content Studio uses archive states instead of destructive deletion for published records.

- Page versions and page sections may cascade only when their unpublished parent page is intentionally removed through a separately controlled process.
- Form submissions are preserved even if a form is archived.
- Approval and audit history is never cascade-deleted through a generic entity relationship.

### Scheduling

Publishable tables include:

- `publish_at`
- `expires_at`
- `published_at`

Public APIs must check both publication status and effective dates.

### Forms and consent

Submissions record:

- A unique reference code.
- The originating form.
- Contact information supplied by the person.
- Structured response JSON.
- Consent state and consent timestamp.
- Source page/URL.
- Hashed network identifier rather than a plain IP address.
- Assignment, review and resolution information.

## Required indexes

The migration must index:

- Publication status plus publishing dates.
- Slugs and stable codes.
- Sort/display order.
- Parent/foreign-key columns.
- Form submission status and reference code.
- Approval status and entity identity.
- Audit entity identity and creation time.
- Media checksum and processing state.

## Migration rules

The Phase 2 migration must:

- Be named `20260805_chalin_one_public_content_foundation.sql`.
- Be additive and repeat-safe.
- Use `CREATE TABLE IF NOT EXISTS`.
- Include the required production migration header.
- Create no production records except its `schema_migrations` entry.
- Include a matching read-only verification file.
- Pass `backend/scripts/verifyMigrationSafety.js`.
- Leave every existing Chalin 03 table and business total unchanged.

## Phase 2 completion evidence

Phase 2 is complete only when:

- Every required table exists with the expected columns and indexes.
- Migration safety checks pass.
- The verification SQL is read-only.
- The migration runs twice safely on an isolated database.
- The migration succeeds on a recent safe production copy.
- Existing backend tests and frontend build remain green.
- The previous application version remains usable against the expanded schema.
- No branch is merged into `main` or `production` as part of Phase 2 development.
