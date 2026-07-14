# Troubleshooting

Use `/api/health` for liveness and `/api/readiness` for database readiness.

Admins can open System Operations for diagnostics. Diagnostics display missing configuration names, database readiness and recent safe error counts without revealing secrets.

If backend startup fails, check `JWT_SECRET`, local DB connection values and frontend origin settings.

