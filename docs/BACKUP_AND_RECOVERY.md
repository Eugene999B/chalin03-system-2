# Backup And Recovery

Backups are full-system JSON downloads with a manifest, table counts and SHA-256 checksum.

Restore safety:

- restore dry-run is available through `/api/backups/restore/dry-run`;
- web restore is disabled unless `ALLOW_WEB_RESTORE=true`;
- restore requires admin authentication and exact confirmation text;
- local destructive restore tests must use a database name ending in `_test`.

Keep private backups outside the project folder and never include them in deliverables.

