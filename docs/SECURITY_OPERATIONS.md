# Security Operations

Security controls added in this package:

- Helmet security headers;
- strict local CORS defaults;
- request IDs on API responses;
- centralized safe error shape;
- login rate limiting;
- failed-login lockout;
- token version revocation;
- disabled-user checks on authenticated requests;
- CSV formula escaping for audit exports;
- admin diagnostics with no secret values.

Rotate secrets before any future production release.

