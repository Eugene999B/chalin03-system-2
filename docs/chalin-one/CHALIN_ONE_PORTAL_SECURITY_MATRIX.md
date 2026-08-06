# CHALIN ONE External Portal Security Matrix

**Portals:** Customer, Supplier and Applicant  
**Default feature flags:** Disabled  
**Public self-registration:** Prohibited in the shared foundation  
**Production authorization:** Not granted

## 1. Portal isolation

Each external account belongs to exactly one portal type:

- `customer`
- `supplier`
- `applicant`

A session issued for one portal is invalid for another portal.

An external portal account is not a staff `users` account and does not receive staff permissions, workspace headers or staff JWTs.

## 2. Account creation

The shared foundation is invitation-only.

An invitation is created by an authorized internal workflow and contains:

- Portal type.
- External entity reference.
- Normalized email.
- Optional normalized phone.
- Expiry.
- One-time random token.
- SHA-256 token hash stored server-side.
- Internal requester and audit evidence.

The raw invitation token is returned once and is never stored.

The invitation may be accepted once.

## 3. Authentication

Portal authentication uses:

- Email and password.
- `bcrypt` password hash.
- Minimum strong password policy.
- Five failed attempts before timed lock.
- Random opaque session token.
- SHA-256 session-token hash stored server-side.
- Maximum 24-hour session lifetime.
- Revocation and last-use timestamps.
- HMAC network hash.
- SHA-256 user-agent hash.

No portal credential or raw session token is stored in audit metadata.

## 4. Data boundary

The shared account foundation does not expose business records.

A later portal-specific API must define an explicit resource grant such as:

```text
customer.statement.view
customer.receipt.download
supplier.tender.view
supplier.document.upload
applicant.vacancy.view
applicant.application.view
```

A grant contains:

- Portal account.
- Resource key.
- Permission key.
- Optional bounded entity reference.
- Active/revoked status.
- Granting staff user.
- Expiry.

Absence of a grant means denial.

## 5. Prohibited cross-access

A Customer account may not access:

- Another customer.
- Supplier records.
- Applicant records.
- Staff routes.
- Mining, hire or finance internal records not explicitly published to that customer.

A Supplier account may not access:

- Customer records.
- Other suppliers.
- Applicant records.
- Internal tender evaluations.
- Staff routes.

An Applicant account may not access:

- Other applicants.
- Internal hiring notes or scores.
- Customer or supplier records.
- Staff routes.

## 6. Consent and privacy

Portal activation records:

- Privacy notice version.
- Terms version.
- Consent timestamp.
- Account reference.
- Request ID.

Consent text itself is versioned outside the account row.

Private documents require a later dedicated encrypted/document storage contract. The shared foundation does not accept file uploads.

## 7. Audit events

Required events include:

- Invitation created.
- Invitation accepted.
- Invitation expired/revoked.
- Login succeeded.
- Login failed.
- Account locked.
- Session created.
- Session revoked/expired.
- Password changed/reset.
- Grant added/revoked.
- Account suspended/closed.

Audit records contain references and safe metadata, not passwords or raw tokens.

## 8. Feature gates

Portal routes must use their independent flags:

```text
FEATURE_CUSTOMER_PORTAL=false
FEATURE_SUPPLIER_PORTAL=false
FEATURE_APPLICANT_PORTAL=false
```

No portal becomes available because another portal is enabled.

## 9. Rate limits

Minimum controls:

- Invitation acceptance attempts.
- Login attempts by IP and normalized email hash.
- Session validation.
- Password reset requests.
- File upload and download when those later exist.

Rate limits do not replace account lockout.

## 10. Release order

1. Shared account/invitation/session foundation.
2. Isolated migration twice.
3. Unit and database acceptance.
4. Portal-specific resource grants.
5. Portal-specific read APIs.
6. Portal-specific UI.
7. Document and upload controls where needed.
8. Desktop/mobile/browser acceptance.
9. Independent security review.
10. Separate production authorization.

## 11. Current release boundary

The shared foundation may create and authenticate an invited external account and establish an empty, scoped portal session.

It does not expose customer statements, receipts, supplier tenders, applicant applications or private documents until their separate portal-specific APIs are approved.
