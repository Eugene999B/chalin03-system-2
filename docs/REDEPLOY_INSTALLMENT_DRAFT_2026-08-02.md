# Equipment Installment Draft Railway Redeploy

Date: 2 August 2026

Purpose: create a fresh controlled Railway production deployment for the already-reviewed installment draft repair.

This release marker does not change application logic, database records, migrations, permissions, or business workflows.

The production release being re-triggered includes:

- the Equipment Finance Phase 1 startup compatibility verifier and additive repair;
- protection against serving the installment draft API with missing schedule columns;
- the complete installment customer profile restoration;
- preserved Spare Parts, Mining, Equipment Hire, payment, document, audit, backup, and security boundaries.

The release must follow the repository's reviewed `main` to `production` promotion process. Railway deployment success and the new production commit status must be verified after promotion.
