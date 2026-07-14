# Rollback Local Changes

This package is local-only and was not committed or deployed.

Rollback options:

1. Stop backend and frontend dev servers.
2. Keep or archive `completed-source` as needed.
3. Do not run restore against `chalin03_db` unless a human administrator has approved a local restore window.
4. To clean only the guarded test database, run:

`tools\cleanup_full_test_database.ps1 -ConfirmLocalTestDatabase`

Never run cleanup against a database name that does not end in `_test`.

