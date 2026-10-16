# Equipment Business Phase 2 — Staff and Workforce

Release scope: Equipment Hire and Equipment Installment Finance workforce administration.

## Delivered

- protected staff-login creation with a strong temporary password and first-login password change
- default permission templates for Hire, Finance and approved dual-division roles
- System Administrator allow/deny overrides with existing protected audit controls
- one Equipment Business workforce centre in Hire and Finance
- worker profiles, photographs, employment assignments and private personnel records
- professional CR80/A4 worker ID cards
- employment letters, documents, signatures and checksum evidence
- exact Hire, Finance and approved dual-division assignments
- Finance-only staff receive no Hire-location access
- active sessions are revoked after role or division changes
- the long Finance sidebar independence/lifecycle description is removed

## Safety

- no reset schema
- no destructive SQL
- no new database migration
- no Spare Parts or Mining category access changes
- original System Administrator identity protections remain in force
- explicit permission deny overrides every role default allow

## Release gate

The release must pass backend syntax/tests, frontend source contracts, full lint, production build, dependency audits, secret scanning and CodeQL before production promotion.
