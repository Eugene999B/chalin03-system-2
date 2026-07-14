# Laptop Handover Checklist

- Project path: `completed-source`
- Backend start: `cd backend; npm start`
- Frontend start: `cd frontend; npm run dev`
- Local test DB: `chalin03_full_test`
- Private backups: store outside the project folder
- Static/build verification: `tools\run_full_local_acceptance.ps1 -SkipDatabase`
- Full local DB/API verification: `tools\run_full_local_acceptance.ps1 -ConfirmLocalTestDatabase -DatabaseHost localhost -DatabaseName chalin03_full_test -DatabaseUser root`
- Restore verification: `tools\test_restore_on_local_test_db.ps1 -BackupPath C:\path\to\backup.json -ConfirmLocalTestDatabase -DatabaseName chalin03_restore_test`
- Git policy: do not commit this package automatically
- `main` remains live Spare Parts
- Final group release has not been deployed
- Rotate JWT, database, SMS and hosting secrets before any production release
