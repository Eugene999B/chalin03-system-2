# Security 4.0 infrastructure and recovery controls

## Supply-chain controls
Core audit, secret scan, production smoke, migration safety and recovery workflows use immutable action commits resolved from the upstream official tags. Dependabot remains responsible for updating these pins; review proposed changes and CI results before merging. Workflow pinning does not itself enforce repository branch protection.

Production and main branch protection must be configured by an authorized repository administrator: require pull requests, successful security/quality checks, no force pushes or deletions, and independent review where staffing permits. Existing release workflow requires production PRs from main. Do not claim the policy is enforced until repository settings confirm it.

## Recovery
Run the isolated synthetic signed-backup recovery drill every Sunday, and on relevant PRs. The drill refuses non-loopback DB hosts and Railway environments. It checks integrity, tamper rejection, representative records, binary files, and stale session invalidation. This is not proof of a successful restore of actual production backups.

Separate production recovery validation: encrypted off-site backup, immutable retention, separate recovery credentials, approved isolated restoration test, measured RPO/RTO, evidence retained without customer data. Never run destructive drills against a production database.

## DNS
Cloudflare WAF and login rate limiting are deployed separately. DNSSEC requires a correctly matched DS record at the Namecheap registrar and public chain validation. Do not change nameservers or mark DNSSEC complete before that validation.
