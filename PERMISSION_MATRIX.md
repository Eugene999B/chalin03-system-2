# Permission Matrix

The executable permission matrix lives in `backend/security/permissionCatalog.js`.

Use `docs/ROLE_PERMISSION_MATRIX.md` for the human-readable handover version.

Important boundaries:

- Group admin: full local platform access.
- Cashier: Spare Parts only.
- Auditor: audit/report/export read-only posture.
- Mining and Hire roles: enforced by workspace role plus server-side site/location scope.
- Fleet officer: Fleet permissions only, no Hire finance mutation.

