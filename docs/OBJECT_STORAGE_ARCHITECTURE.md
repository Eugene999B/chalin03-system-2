# Chalin 03 object storage architecture

Chalin 03 keeps business records and file metadata in Railway MySQL, while file bytes are intended for an S3-compatible object store.

## Storage responsibilities

- Railway MySQL: customers, equipment, agreements, payments, schedules, audit records, document metadata, storage keys, checksums and status.
- Object storage: PDFs, images, videos and other binary document/media payloads.
- Railway backend: authentication, authorization, upload/download orchestration, checksum validation and access auditing.

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

No production provider is activated by the foundation release itself. Provider activation should happen only after a real bucket is created, credentials are added to the Railway service, upload/download/delete probes pass, and the existing media/document regression journeys pass.
