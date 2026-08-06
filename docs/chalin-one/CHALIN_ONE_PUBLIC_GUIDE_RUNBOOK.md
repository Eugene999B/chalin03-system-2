# CHALIN ONE Public Guide Runbook

**Feature flag:** `FEATURE_CHALIN_GUIDE`  
**Default:** `false`  
**Provider default:** `disabled`  
**Production impact:** None until separately integrated and enabled

## 1. Public-only boundary

Chalin Guide is not a staff assistant and is not a customer portal.

It may use only:

- Published public knowledge.
- Published public website content represented in the approved knowledge system.
- Public service descriptions.
- Public vacancies and tenders.
- Public locations and contact instructions.
- Governed public enquiry handoff.

It may not access:

- Customer records.
- Debts, payments, receipts or balances.
- Finance applications or decisions.
- Staff or payroll records.
- Supplier private records.
- Applicant private records.
- Mining production or site records.
- Equipment hire contracts or private availability.
- Operational stock or pricing records.
- Identity documents.
- Authentication or provider credentials.
- Registered staff AI tools.

## 2. Source package

Backend:

```text
backend/services/publicGuideService.js
backend/routes/publicGuideRoutes.js
backend/scripts/runChalinOnePublicGuideFoundationMigration.js
```

Database:

```text
database/migrations/20260806_chalin_one_public_guide_foundation.sql
database/migrations/20260806_chalin_one_public_guide_foundation_verify.sql
```

Frontend:

```text
frontend/src/chalin-one/public-site/publicGuideApi.js
frontend/src/chalin-one/public-site/PublicGuideWidget.jsx
frontend/src/chalin-one/public-site/publicGuide.css
```

## 3. Anonymous session privacy

A Guide session uses:

- A random raw token returned once.
- SHA-256 token hash stored server-side.
- HMAC IP hash using `PUBLIC_FORM_IP_HASH_SECRET`.
- No raw IP address.
- No user agent in Guide tables.
- No browser local storage, session storage or cookie.
- 30-minute sliding expiry.
- 30-message hard cap.
- Active/expired/blocked/closed status.

The in-memory browser token disappears when the page reloads or closes.

## 4. Separate migration

The Guide session tables are intentionally separate from the staff AI migration:

1. `ai_public_guide_sessions`
2. `ai_public_guide_messages`

Normal runtime gates remain closed:

```text
CHALIN_ONE_ALLOW_PUBLIC_GUIDE_SCHEMA_MIGRATION=false
CHALIN_ONE_PUBLIC_GUIDE_MIGRATION_CONFIRM=
```

For one isolated migration command:

```text
CHALIN_ONE_ALLOW_PUBLIC_GUIDE_SCHEMA_MIGRATION=true
CHALIN_ONE_PUBLIC_GUIDE_MIGRATION_CONFIRM=20260806_CHALIN_ONE_PUBLIC_GUIDE_FOUNDATION
```

Then run twice:

```bash
node scripts/runChalinOnePublicGuideFoundationMigration.js
node scripts/runChalinOnePublicGuideFoundationMigration.js
```

Immediately close the gates again.

Production additionally requires the signed Professional Backup and separate SQL backup confirmations.

## 5. Required integration

Before staging, mount the backend router only as:

```text
/api/public/guide
  → FEATURE_CHALIN_GUIDE
  → publicGuideRoutes
```

Do not place the public Guide below:

- `/api/ai`, because that is authenticated staff intelligence.
- A customer portal route.
- A Content Studio route.

Mount the widget in the public website shell only when the public Guide flag is effective.

The public website must continue working normally when the Guide flag is false or the provider fails.

## 6. Rate limits

Default source limits:

- Session creation: 10 per IP per hour.
- Messages: 20 per IP per 15 minutes.
- Handoffs: 3 per IP per hour.
- Session total: 30 stored messages.

Environment overrides must remain bounded.

## 7. Private-data handoff

Questions requesting a private lookup produce no private query and no staff tool call.

The response states that Guide cannot access the record and offers a governed handoff.

The handoff uses the published public contact form and requires:

- Enquiry message.
- Email or phone.
- Consent.
- Optional name/company/service/contact preference.

The accepted public form submission returns a traceable `WEB-...` reference and enters the protected Enquiry Desk.

The Guide session is then closed.

## 8. Provider behavior

The public Guide calls the provider with:

- Guide system instruction.
- Published public evidence.
- A short public conversation history.
- Current public question.
- Empty tool list.

If no published evidence exists, it does not invent an answer. It recommends the enquiry handoff.

If the provider is disabled or unavailable, the failure remains inside the Guide panel and the public website remains available.

## 9. Staging acceptance

Use an isolated staging database and domains.

Verify:

1. Guide flag false hides the API and widget.
2. Guide flag true exposes only anonymous Guide routes.
3. No staff token is sent by the Guide client.
4. Raw token is not stored in MySQL.
5. Raw IP and user agent are not stored in Guide tables.
6. Session expires.
7. Message cap blocks further messages.
8. Rate limits work.
9. Prompt injection is blocked.
10. Password/token requests are blocked.
11. Public evidence is cited.
12. Workspace/restricted/executive knowledge is never returned.
13. Private account questions create no business query.
14. Handoff requires consent.
15. Handoff creates one traceable public submission.
16. Desktop, tablet, 360px and 390px layouts remain usable.
17. Keyboard focus and close controls work.
18. Provider failure does not break the website.
19. Ordinary staff operations remain unaffected.

## 10. Current truthful state

The migration, verifier, guarded runner, service, anonymous routes, widget and source contracts are implemented on `chalin-one`.

The Guide is not mounted, migrated, enabled, browser-tested or production-authorized yet.
