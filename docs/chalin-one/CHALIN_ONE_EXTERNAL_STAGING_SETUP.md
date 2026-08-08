# CHALIN ONE External Staging Setup

## Purpose

Deploy the `chalin-one` branch into a completely separate Railway + Cloudflare preview environment so Website + AI can be tested without touching current CHALIN 03 production.

## Isolation rules

- Branch: `chalin-one` only.
- Do not merge to `main` or `production`.
- Railway staging project must be separate from the production Railway project.
- Railway staging MySQL must be a separate database named `chalin_one_staging` or `chalin_one_staging_<name>`.
- Cloudflare Pages staging project must be separate from the production Pages project.
- Staging must never use `chalin03.com`, `www.chalin03.com`, `staff.chalin03.com` or `api.chalin03.com` as its frontend/API targets.
- Use staging-only secrets. Do not copy production JWT, MFA, backup-signing or privacy-hash secrets.
- Staging SMS must be disabled or mock only.
- Portals, AI Actions and Scheduled AI remain disabled for the first external trial.
- Production stays online and unchanged throughout acceptance.

## Staging profiles

Two staging profiles intentionally coexist:

- `backend/.env.chalin-one-staging.example` preserves the earlier Release B Website/Content-Studio-only acceptance profile and keeps AI disabled.
- `backend/.env.chalin-one-full-staging.example` is the external Website + AI trial profile and is the one used by this runbook.

Do not mix the two profiles.

## 1. Railway project

Create a separate Railway project named `CHALIN-ONE-STAGING`.

Add:

1. A Node service connected to `Eugene999B/chalin03-system-2`, branch `chalin-one`.
2. A separate Railway MySQL service.
3. Configure the Node service to use config-as-code path:
   `deploy/chalin-one/railway.staging.json`
4. Copy variable names from `backend/.env.chalin-one-full-staging.example` and replace all placeholders with staging-only values.
5. Set `DB_NAME=chalin_one_staging`.
6. Set `CHALIN_ONE_STAGING_API_URL` to the Railway staging public domain once generated.
7. Set `TRUSTED_API_HOSTS` to that staging Railway hostname.

The Railway start command runs the full staging safety verifier before the backend can start. It fails closed if production hosts, unsafe feature flags, weak secrets, live SMS, an unsafe DB name or open migration gates are detected.

## 2. Database restore and migrations

Before copying operational data, create the normal CHALIN application backup plus a raw SQL export from production.

Restore the chosen staging copy only into the separate Railway MySQL staging database.

Run CHALIN ONE migrations manually and one at a time using the existing guarded migration commands. Enable only the exact migration gate required for that command, verify it, run the migration twice to prove idempotency, then immediately close the gate again.

Required CHALIN ONE migration families currently include:

- public content
- AI foundation
- AI action governance schema
- scheduled AI governance schema
- public Guide foundation
- portal security foundation
- document intelligence

Do not leave any `CHALIN_ONE_ALLOW_*` migration flag enabled during runtime.

## 3. Cloudflare Pages project

Create a separate Pages project named `chalin-one-preview` connected to the same GitHub repository.

Use:

- Production branch for this preview project: `chalin-one`
- Root directory: `frontend`
- Build command: `node scripts/verifyChalinOneStagingBuildEnv.mjs && npm run build`
- Build output directory: `dist`
- Environment variable: `VITE_API_URL=https://<railway-staging-host>/api`

The build guard rejects production Chalin hosts and requires the `chalin-one` branch.

After Cloudflare creates the Pages URL, update Railway `FRONTEND_URL` to that exact HTTPS origin and redeploy the staging backend.

## 4. First infrastructure smoke

Keep `AI_PROVIDER=disabled` initially.

Verify:

- Railway backend `/` returns success and `environment: staging`.
- Cloudflare preview loads.
- Staff login uses only the staging backend/database.
- Public website loads from staging content tables.
- Content Studio opens for authorized users.
- Existing Spare Parts, Mining, Equipment Hire and Equipment Finance screens load against staging only.
- No SMS is sent.
- No production URL or database is contacted.

## 5. Website + Content Studio acceptance

Using the three different staging users configured as author/reviewer/publisher:

1. Change homepage copy.
2. Add news/announcement content.
3. Add/update leadership or equipment content.
4. Preview changes.
5. Submit exact versions for review.
6. Approve using a different user.
7. Publish using a third user where required.
8. Verify public-only endpoints never reveal drafts/rejected content.
9. Test desktop, tablet, 430px, 390px and 360px layouts.

Use a dedicated staging R2 bucket before final media-library acceptance because Railway local storage is ephemeral.

## 6. AI provider acceptance

Only after infrastructure and ordinary-business smoke tests are green:

1. Configure the chosen real AI provider secret in Railway staging only.
2. Set `AI_PROVIDER` to the approved provider.
3. Keep `AI_ALLOW_MOCK_PROVIDER=false`.
4. Run:
   `node backend/scripts/verifyChalinOneFullStagingEnvironment.js --mode=provider`
5. Test Copilot, Executive, Document Intelligence, DOCX retrieval, clickable citations and Guide.

Permission/adversarial acceptance must include:

- cashier denied executive/group profitability
- wrong Spare Parts branch denied
- wrong Mining site denied
- wrong Hire location denied
- Hire user denied Finance-only intelligence
- Finance user denied Hire-location intelligence
- public Guide denied customers, debts, staff records and workspace-only documents
- document citations reopen the exact governed chunk

## 7. Release evidence

Before any merge:

- capture desktop/mobile browser evidence
- run full frontend/backend CI
- run isolated/staging MySQL migration verification
- run ordinary-business regression testing
- verify full-system backup restore into a disposable database
- record the exact accepted `chalin-one` commit and staging URLs

Only after explicit management approval may `chalin-one` be considered for merge into `main`. Production remains a separate authorization step.
