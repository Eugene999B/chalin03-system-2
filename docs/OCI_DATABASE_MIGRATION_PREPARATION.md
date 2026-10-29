# OCI database migration preparation — 11 October 2026

Status: inspection and preparation only. No production connection changed, no database exported by this task, no OCI resource provisioned, no database or volume retired. Owner has requested infrastructure setup first and will provide transfer instructions before data movement.

## Verified architecture
- Chalin03: Eugene999B/chalin03-system-2, production branch; Railway distinguished-compassion, chalin03-system-2, /backend, Node.js/Express/mysql2. API api.chalin03.com. Repository describes Cloudflare Pages frontend; live Pages project still needs verification.
- Chalin03 MySQL runtime logs confirm 9.7.1. Preserve that compatible series; 8.4 is a downgrade requiring a separately tested compatibility assessment. Current startup disables binary logging and performance_schema, buffer pool 96M, log buffer 16M, max connections 50. Service sleeps when idle.
- Chalin03 pool caps connections at 5 with bounded queue and idle eviction. Supports TLS with CA verification. Actual variable values and current grants not accessible through connected OAuth tool.
- KOFAD: Eugene999B/KOFAD, railway-release, Railway KOFAD, kofad-web and kofad-sms, Django/Python, PostgreSQL 16 image. settings.py explicitly rejects other engines. Preserve PostgreSQL 16; do not convert to MySQL. Server-rendered frontend remains on kofad-web; apex and wildcard company domains route to it.
- Both projects currently deploy in sfo. OCI home region and inter-cloud latency unknown.
- Railway connectors return variable names only. Never log or commit credentials.

## Sampled usage and preliminary cost
168-hour metrics, hourly samples; not an invoice or exact billing integration:
| Database | Mean RAM GB | Mean CPU cores | Mean used volume GB | Projected gross monthly usage |
|---|---:|---:|---:|---:|
| Chalin03 MySQL | 0.29772 | 0.002481 | 0.58923 | $3.12 |
| KOFAD PostgreSQL | 0.07681 | 0.001314 | 0.22826 | $0.83 |

Projection uses Railway RAM $10/GB-month, CPU $20/core-month and used volume $0.15/GB-month. Hourly samples can miss bursts, and sleeping-service zero samples affect averages. Allocated volume capacity is not used storage. Combined approximately $3.94/month before allowance, egress, backup charges, retained old database costs and OCI costs.

For Pro, estimated bill difference is max(20, U_before) - max(20, U_before - R + A), where U is full workspace metered usage, R is retired Railway usage, and A is added tunnel/backup/network usage. Taxes/add-ons/credits excluded. If both totals are below $20, bill reduction is zero. Actual workspace plan/invoice must be checked. Migration does not immediately remove costs because old databases remain for rollback.

## Existing backup evidence and gaps
Chalin03 backup function logs report latest export: 200 base tables, 29,415 rows, 39.76 MB; SHA-256 8c3f6e1e7b5a19a6e08b8ca5c4497680365cb9e47eb5288d03a11b7c645f862c. This is historical logged evidence, not a restoration test.
The function reads each whole table into memory, dumps base tables only, and omits views, triggers, routines and events. No compressed/encrypted off-server copy or scheduled daily restore-tested backup was demonstrated. Do not use it as the only migration backup.
Chalin03 has a separate backup volume and an unattached mysql-volume-AS22; preserve both until owner-approved retirement.
KOFAD weekly Google Drive documentation explicitly says prepared, not activated. App archive verification does not establish a native PostgreSQL recovery test.

## Performance baseline
Railway HTTP daily buckets over 168 hours:
- Chalin03 p50 21–60 ms; p95 89–291 ms in ordinary buckets, plus one 15,023 ms p95 outlier. Investigate the outlier before comparison.
- KOFAD p50 27–74 ms; p95 119–243 ms.
These include mixed routes/statuses and are not database RTT benchmarks. Use same routes, workloads, time windows and successful statuses for staging comparisons.

## OCI preparation gates
1. Owner completes Oracle sign-in privately. No OCI connector or local OCI CLI/config detected.
2. Verify tenancy home region, free-tier entitlement, current allocation and capacity. Preferred A1 2 OCPU/12 GB with 50 GB Always Free Ubuntu ARM64 image. No trial-only or paid fallback.
3. OCI documentation currently lists 2 OCPU/12 GB A1 and 200 GB combined boot/block volumes, but console entitlement must govern. Verify image/shape/version architecture compatibility.
4. Always Free instances can be reclaimed for idle usage. This is a material production reliability risk. Do not create artificial load to avoid reclamation. Off-server recovery and tested rebuild are mandatory.
5. Secure VM with key-only SSH, restricted administrative sources, OS firewall and updates. Expose no unrestricted MySQL/PostgreSQL listeners. Run isolated engines/accounts, not one shared privileged user.
6. Select an encrypted tunnel with restricted endpoints or TLS with verified CA/hostname and restricted network source. Railway outbound IP availability must be verified; never allow all IPs just because IPs are dynamic. Account for any tunnel RAM/CPU/egress and access approvals.
7. Configure restart policies, bounded logs, capacity alerts, disk watermarks and monitoring before any production connection.
8. Set memory budgets from actual load; leave OS/cache/backup headroom. Do not allocate all 12 GB to database caches.

## Transfer and staging gates — NOT authorized yet
Owner will provide transfer instructions. Before copying production data:
- Inventory exact SQL version, schema sizes, engine/collations, grants, tables/indexes/FKs/views/triggers/routines/events, migration versions and external object storage dependencies.
- Create native complete backup using matching-version tools. MySQL requires routines/events/triggers/views and consistent transaction handling; inspect non-InnoDB tables and prevent concurrent DDL. PostgreSQL needs native pg_dump plus securely handled role/grant definitions. Do not restore source superuser credentials wholesale.
- Encrypt before off-server storage. Separate keys from ciphertext, preserve application recovery secrets securely, and test actual restore into isolated databases.
- Compare exact counts, deterministic row content, constraints, object definitions, financial totals and privileged access without logging customer records.
- Staging must suppress all outbound SMS/email/WhatsApp/payment effects, use separate service/credentials and prohibit public access to customer data. Do not trigger production business jobs from copied data.
- Test critical workflows and response times. No target connection reaches production until evidence passes.

## Cutover and rollback — owner approval required
Arrange downtime; stop all writers including backend jobs, worker, callbacks, scripts and scheduled database events. Queue/reconcile provider callbacks safely. Capture final consistent native backups after write freeze. Validate final state, then update secrets and restart only with owner approval.
Keep old database fenced against writes. Before new writes, rollback can revert to validated old state. After new writes, reverting connection alone loses data: freeze target, preserve target changes, reconcile or reverse-sync into a validated database before reopening. Test this procedure in staging.
Retirement requires successful observation period, verified daily off-server backups/restores and explicit owner permission. Never delete audit or business history.

## Daily backup design to implement after OCI access
Separate per-engine directories, compressed encrypted daily native archives, atomic upload and checksum verification, stagger schedules, failure alerts, retention only after a newer verified recoverable copy exists. Keep off-server storage within verified free quota. Regular isolated native restore tests; compressed-file checksums alone are insufficient. Do not grant Google Drive or another provider new access without authorization.

## Sources
- https://docs.railway.com/pricing/plans
- https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
- https://dev.mysql.com/doc/refman/9.7/en/downgrading.html
