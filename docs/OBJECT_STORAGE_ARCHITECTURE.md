# Chalin 03 object storage architecture

Chalin 03 keeps business records and file metadata in Railway MySQL, while file bytes live in a private S3-compatible object store.

## Recommended production provider

Use a **Railway Storage Bucket** in the same Railway project as the Chalin 03 backend. Railway Buckets are private S3-compatible object storage and are designed for uploads, user-generated content, backups and other durable binary data. The backend should access the bucket with server-side credentials; files should not be made public directly.

This keeps the deployment topology simple:

- Railway MySQL: customers, equipment, agreements, payments, schedules, audit records, document metadata, storage keys, checksums and status.
- Railway Storage Bucket: PDFs, images, videos and other binary document/media payloads.
- Railway backend: authentication, authorization, upload/download orchestration, checksum validation and access auditing.
- Cloudflare Pages: frontend only.

## Safety boundary

Object storage is intentionally disabled unless `CHALIN03_OBJECT_STORAGE_ENABLED=true` and all required server-side credentials are configured. This prevents an incomplete provider configuration from taking production uploads offline.

Configuration names:

- `CHALIN03_OBJECT_STORAGE_ENABLED`
- `CHALIN03_OBJECT_STORAGE_ENDPOINT`
- `CHALIN03_OBJECT_STORAGE_REGION` (defaults to `auto`)
- `CHALIN03_OBJECT_STORAGE_BUCKET`
- `CHALIN03_OBJECT_STORAGE_ACCESS_KEY`
- `CHALIN03_OBJECT_STORAGE_SECRET_KEY`

Credentials must never be committed to GitHub or exposed to the frontend.

## Migration policy

The foundation migration is additive. It adds provider/bucket/key/status metadata and does not delete or rewrite existing database payloads. Existing media and Finance private-document payloads remain readable until a separately tested migration moves them to object storage.

Migration must be **copy-then-verify-then-cut-over**:

1. Read the existing payload.
2. Upload it to the object store under a deterministic, non-user-controlled key.
3. Verify size and SHA-256 checksum.
4. Record provider, bucket, storage key, ETag/status and stored timestamp in MySQL.
5. Verify the object can be read back.
6. Only then switch application reads to the object copy.
7. Keep the legacy database payload until the migration has been audited and the rollback window has closed.

No production provider is activated by the foundation release itself. Provider activation should happen only after a real Railway Bucket is created, credentials are securely connected to the Railway service, upload/download/delete probes pass, and the existing media/document regression journeys pass.
