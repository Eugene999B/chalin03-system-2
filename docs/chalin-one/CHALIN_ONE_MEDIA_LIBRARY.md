# CHALIN ONE — Secure Media Library

## Status

Implemented on the `chalin-one` development branch. The Media Library remains unavailable unless `FEATURE_CONTENT_STUDIO=true`, and no production deployment or database migration has been performed.

## Storage policy

### Development

- `PUBLIC_MEDIA_STORAGE_PROVIDER=local` may be used for isolated local development.
- Local files are written under `backend/.local-public-media/` unless `PUBLIC_MEDIA_LOCAL_ROOT` is supplied.
- Local objects never receive public website URLs, even when a public-base variable is accidentally present.
- Local media bytes are excluded from Git.

### Production

Production uploads require:

- `PUBLIC_MEDIA_STORAGE_PROVIDER=r2`
- `CLOUDFLARE_R2_ACCOUNT_ID`
- `CLOUDFLARE_R2_BUCKET`
- `CLOUDFLARE_R2_ACCESS_KEY_ID`
- `CLOUDFLARE_R2_SECRET_ACCESS_KEY`
- `PUBLIC_MEDIA_PUBLIC_BASE_URL` using HTTPS

The adapter validates configuration before every storage operation and refuses production local storage.

## Image security

- Accepted decoded formats: JPEG, PNG and WebP only.
- Maximum request size: 12 MB.
- Maximum decoded pixel count: 40,000,000.
- Original bytes are never published.
- Sharp performs safe decoding, automatic orientation and WebP re-encoding.
- Responsive variants are generated up to 480, 960 and 1600 pixels without enlargement.
- SHA-256 duplicate detection prevents duplicate active image records.
- Newly stored variants are deleted if the database transaction fails.
- Uploaded images begin as private.
- A public image requires descriptive alternative text and a credential-free HTTPS public URL.

SVG and executable document formats are intentionally unsupported in this release.

## Video security

Videos are registered as external HTTPS sources rather than uploaded to Railway.

Default approved host families include YouTube, Vimeo and Cloudflare Stream. A controlled comma-separated allowlist may be supplied with `PUBLIC_MEDIA_VIDEO_HOSTS`.

URLs with HTTP, embedded credentials or unapproved hosts are rejected.

## Folders

Media folders support controlled parent-child organization.

The service blocks:

- invalid or duplicate folder keys;
- self-parenting;
- circular parent relationships;
- more than 20 levels of nesting;
- archiving folders that still contain active child folders;
- archiving folders that still contain active media assets.

## Archive behavior

A media asset cannot be archived while referenced by active or draft website content, including:

- pages and page sections;
- business divisions;
- leadership profiles and leadership draft versions;
- projects, project galleries and project draft versions;
- public equipment and equipment draft versions;
- news;
- vacancies;
- tenders;
- testimonials;
- public locations.

Archiving changes the record to private, archived and inactive. Stored objects are retained deliberately for audit and recovery; physical object deletion is a separate future retention workflow.

## Staff API surface

Mounted under `/api/content-studio/media` behind normal Content Studio authentication and feature gating.

- Read operations require `public_media.view`.
- Upload, metadata, folder and archive operations require `public_media.manage`.
- Image upload uses raw `image/jpeg`, `image/png` or `image/webp` bodies.
- External video registration and metadata updates use JSON.
- Every response is private and non-cacheable.
- Every mutation writes both Content Studio and platform audit evidence.

## Acceptance still pending

- Apply the Phase 2 migration on an isolated test database.
- Exercise real MySQL transactions and foreign keys.
- Exercise a dedicated test R2 bucket and custom media domain.
- Confirm production startup integration after final synchronization with current `main`.
- Complete Content Studio frontend upload, folder and usage interfaces.
