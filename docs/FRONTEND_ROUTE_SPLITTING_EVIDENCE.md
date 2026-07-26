# Frontend Route-Splitting Evidence

- Baseline commit: `31d02405f14bce70d58764f2f5c781b7b3c7cf3a`
- Candidate branch: `agent/mining-hire-final-update`
- Measured at: `2026-07-26T23:20:36.280423+00:00`

## Production build comparison

| Metric | Previous main | Lazy-loaded branch | Change |
|---|---:|---:|---:|
| Initial `index` JavaScript | 1,779,882 bytes | 1,124,530 bytes | 655,352 bytes (36.8% smaller) |
| JavaScript chunk count | 1 | 16 | +15 |
| Total emitted JavaScript | 1,779,882 bytes | 1,783,334 bytes | +3,452 bytes |
| Largest JavaScript chunk | 1,779,882 bytes | 1,124,530 bytes | -655,352 bytes |

The initial entry reduction is the relevant first-load improvement. Total emitted JavaScript may remain similar or increase slightly because Vite creates independently cacheable route chunks instead of placing all workspace code in the initial bundle.

## Workspace chunks emitted

| Chunk | Bytes |
|---|---:|
| `EmploymentDocumentsPage-B6gR3WMW.js` | 20,617 |
| `EquipmentHireOperationsPage-Bg5BOyhf.js` | 88,666 |
| `FleetAssetsPage-rL0dsvtK.js` | 105,908 |
| `GroupExecutiveControlPage-BmBSgIMR.js` | 27,353 |
| `HireCommercialControlPage-DZCDPbVz.js` | 38,643 |
| `MiningControlCentrePage-D_orqnzg.js` | 52,422 |
| `MiningOperationsPage-DUMRl9sX.js` | 46,015 |
| `OperationsDocumentsAccountingPage-BCxxCutw.js` | 23,080 |
| `Release2FinalControlPage-CUTaAAoV.js` | 91,972 |
| `WorkspaceAdministrationPage-BZB1gd_N.js` | 36,322 |

## Acceptance

- Both builds completed from clean `npm ci` installations.
- Authentication, workspace, role and permission wrappers remain eagerly loaded.
- Heavy Mining, Equipment Sales & Hire, fleet, shared-report, administration and worker-document pages load on demand.
- Frontend tests, full lint and production build remain mandatory release gates.
