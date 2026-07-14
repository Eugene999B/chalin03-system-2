# Database Migrations

The active database root is now clean. Historical one-off migrations are not
kept here as executable files.

Use `schema.sql` for a deliberate clean reset through the reset runner, then
restore the private JSON backup and run `seed_reference_data.sql`.

Future migrations should be added here with a clear date, purpose, and rollback
note.
