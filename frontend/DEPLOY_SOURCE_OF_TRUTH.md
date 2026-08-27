# Chalin 03 deployment source of truth

Production application code lives on the `production` branch.

Cloudflare Pages must build the same `production` branch (or a deployment branch kept exactly synchronized with it). Railway backend must also deploy from `production`.

Do not let the frontend build from `main` while the backend builds from `production`; that creates split-brain releases where completed fixes appear to disappear.
