from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


readme_path = Path("README.md")
readme = readme_path.read_text()

readme = replace_once(
    readme,
    "| Production release deployed 25 July 2026 | `84c554e157c9439de12b12a65438ea440c79acc0` |\n| Integrated release candidate | `d71c3f1245d53fc6c636dbb6ef52ee3eaca69d2a` |",
    "| Initial 25 July production release | `84c554e157c9439de12b12a65438ea440c79acc0` |\n| Current production hardening commit | `96ab439931e2331a5a537207881c4467a64856af` |\n| Integrated release candidate | `d71c3f1245d53fc6c636dbb6ef52ee3eaca69d2a` |",
    "README production commit table",
)

readme = replace_once(
    readme,
    "The current production release was promoted through PR #76 after PR #75 completed the post-Phase-1 audit and PR #77 added the fail-closed Railway migration runner. Commit hashes above are release evidence, not permanent pointers.",
    "The 25 July release was promoted through PR #76 after PR #75 completed the post-Phase-1 audit and PR #77 added the fail-closed Railway migration runner. PR #83 later promoted the independently reviewed Owner-login and Daily Closing evidence hardening to production at `96ab439931e2331a5a537207881c4467a64856af`. Commit hashes above are release evidence, not permanent pointers.",
    "README production paragraph",
)

readme = replace_once(
    readme,
    "| Mining and Equipment help | `frontend/src/pages/WorkspaceHelpPage.jsx` |\n| Workspace navigation | `frontend/src/layouts/` |",
    "| Mining and Equipment help | `frontend/src/pages/WorkspaceHelpPage.jsx` |\n| Equipment Sales routing | `docs/EQUIPMENT_SALES_ROUTING_ARCHITECTURE.md` |\n| Workspace navigation | `frontend/src/layouts/` |",
    "README equipment sales source of truth",
)

readme = replace_once(
    readme,
    "Use development-only values locally. Never copy production secrets into source files.",
    "Run `npm ci` before any syntax check, test, lint or build on a fresh checkout. Missing-module failures before dependency installation are environment-setup errors, not application regressions.\n\nUse development-only values locally. Never copy production secrets into source files.",
    "README install-before-test note",
)

old_tail = """## 12. Current release status

As of the completed 25 July 2026 release:

- post-Phase-1 automated audit: **95 / 100**;
- open Critical findings: **0**;
- open High findings: **0**;
- PR #75 merged the audit corrections into `main`;
- PR #77 added the Railway production migration runner;
- a fresh signed Version 2 backup was downloaded before migration;
- both approved migrations were applied and verified before deployment;
- PR #76 promoted the release to `production`;
- Railway reported successful backend deployment;
- the authorised owner reported the live system and new features successful;
- existing production business data remained available;
- production release commit: `84c554e157c9439de12b12a65438ea440c79acc0`.

The next step is normal monitored operation. Preserve the backup and deployment logs, record any defect before changing code, and use `agent/* → main → production` for every future update.

---

## 13. Documentation maintenance

Every feature or control change must update the relevant in-app Help page, this README, the repository release/audit documents and the external Chalin 03 handbook where applicable.

Repository documentation is synchronized with the 25 July 2026 deployed release. The external Google Docs handbook still requires a separate consistency update and evidence check.
"""

new_tail = """## 12. Current release status

As of the completed 25 July 2026 release and subsequent independent-review hardening:

- post-Phase-1 automated audit: **95 / 100**;
- open Critical findings: **0**;
- open High findings: **0**;
- PR #75 merged the audit corrections into `main`;
- PR #77 added the Railway production migration runner;
- a fresh signed Version 2 backup was downloaded before migration;
- both approved migrations were applied and verified before deployment;
- PR #76 promoted the audited release to `production`;
- PR #82 removed the dormant password-only Owner route and aligned Daily Closing correction evidence across browser, PDF, Excel and Word;
- PR #83 promoted that hardening to production;
- Railway reported successful deployment of current production commit `96ab439931e2331a5a537207881c4467a64856af`;
- the external Google Docs handbook and frozen release PDF are synchronized;
- the sanitised source snapshot and SHA-256 checksum for the initial release commit are retained in the controlled Drive archive;
- existing production business data remained available.

A fresh independent scan confirmed the Equipment Sales routers are live through the mounted equipment-catalogue middleware rather than direct `server.js` mounts. Preserve that chain and its regression test. Frontend route-level code-splitting remains a measured performance backlog item, not an active incident.

The next step is normal monitored operation. Preserve release evidence, record any defect before changing code, and use `agent/* → main → production` for every future update.

---

## 13. Documentation maintenance

Every feature or control change must update the relevant in-app Help page, this README, the repository release/audit documents and the external Chalin 03 handbook where applicable.

Repository documentation, the external Google Docs handbook, the frozen handbook PDF and the controlled source-snapshot record are synchronized with the completed release and follow-up hardening.
"""

readme = replace_once(readme, old_tail, new_tail, "README current status tail")
readme_path.write_text(readme)

release_path = Path("docs/RELEASE_2026-07-25_PHASE1_POST_PHASE1.md")
release = release_path.read_text()
release_append = """

## Post-release production hardening

- Hardening PR #82 merged into `main` at `043bdccb7464c01bb2e3505403dba6cf9eace13c`.
- Production PR #83 merged at `96ab439931e2331a5a537207881c4467a64856af`.
- Railway reported a successful deployment for that exact production commit.
- No schema migration, reset or destructive production data operation was introduced.

## Equipment Sales routing clarification

A fresh independent scan initially described `equipmentSalesRoutes.js` and `equipmentSalesFinalizationRoutes.js` as unreachable because they are not directly imported by `server.js`. A deeper route-chain review proved they are active:

1. the frontend calls `/api/equipment-catalogue/sales/...`;
2. `server.js` mounts `/api/equipment-catalogue` with `enforceEquipmentCatalogueWriteIntegrity`;
3. that middleware detects `/sales`, strips the prefix and dispatches into `equipmentSalesRoutes.js`;
4. `equipmentSalesSchemaService.js` attaches `equipmentSalesFinalizationRoutes.js` to the same router.

The files must not be deleted or mounted a second time. Their indirect reachability is now documented and protected by a permanent regression test.

## Performance backlog

The production frontend build remains healthy. Route-level lazy loading for heavier reporting, accounting, Mining, Equipment Sales & Hire and Group Executive pages is tracked as a separate measured performance improvement so it cannot be mixed with security or financial-control changes.
"""
if "## Equipment Sales routing clarification" not in release:
    release = release.rstrip() + release_append + "\n"
release_path.write_text(release)

Path("docs/EQUIPMENT_SALES_ROUTING_ARCHITECTURE.md").write_text("""# Equipment Sales Routing Architecture

## Purpose

Equipment Sales is intentionally exposed as a protected sub-router of the shared Equipment Catalogue API. The absence of a direct `server.js` import for `equipmentSalesRoutes.js` does **not** mean the router is dead code.

## Live request chain

```text
EquipmentSalesWorkspacePage / EquipmentSalesReportsPage
        ↓
/api/equipment-catalogue/sales/...
        ↓
server.js
  /api/equipment-catalogue
  requireAuth
  hireBoundary
  enforceEquipmentCatalogueWriteIntegrity
  equipmentCatalogueRoutes
        ↓
equipmentCatalogueIntegrityMiddleware.js
  detects /^\/sales/
  validates Equipment Sales schema readiness
  removes the /sales prefix
  dispatches equipmentSalesRoutes.js
        ↓
equipmentSalesSchemaService.js
  attaches equipmentSalesFinalizationRoutes.js once
```

## Why the indirection exists

- Equipment Sales and Hire share the protected equipment catalogue.
- The catalogue middleware enforces sale/hire integrity before ordinary catalogue writes.
- Sales requests reuse the same authenticated Equipment Sales & Hire workspace and location boundary.
- Finalization/report/document endpoints extend the core sales router without creating a second public mount.

## Maintenance rules

1. Do not delete `equipmentSalesRoutes.js` or `equipmentSalesFinalizationRoutes.js` merely because `server.js` does not import them directly.
2. Do not add a second direct mount without a complete route-conflict, authentication, permission and location-scope review.
3. Preserve the `/api/equipment-catalogue/sales` frontend contract.
4. Preserve read-only schema readiness and fail-closed behaviour.
5. Run `backend/tests/equipmentSalesReachabilityContract.test.js` plus the complete backend suite after routing changes.
6. Register a physical machine once in the shared catalogue; sale and Hire controls must continue to coordinate through the same asset record.

## Canonical files

- `backend/server.js`
- `backend/middleware/equipmentCatalogueIntegrityMiddleware.js`
- `backend/services/equipmentSalesSchemaService.js`
- `backend/routes/equipmentSalesRoutes.js`
- `backend/routes/equipmentSalesFinalizationRoutes.js`
- `frontend/src/pages/EquipmentSalesWorkspacePage.jsx`
- `frontend/src/pages/EquipmentSalesReportsPage.jsx`
""")

Path("backend/tests/equipmentSalesReachabilityContract.test.js").write_text(r'''const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const server = read("backend/server.js");
const boundary = read(
  "backend/middleware/equipmentCatalogueIntegrityMiddleware.js"
);
const schemaService = read("backend/services/equipmentSalesSchemaService.js");
const salesRoutes = read("backend/routes/equipmentSalesRoutes.js");
const finalizationRoutes = read(
  "backend/routes/equipmentSalesFinalizationRoutes.js"
);
const workspacePage = read(
  "frontend/src/pages/EquipmentSalesWorkspacePage.jsx"
);
const reportsPage = read("frontend/src/pages/EquipmentSalesReportsPage.jsx");

test("Equipment Sales remains reachable through the protected catalogue router chain", () => {
  assert.match(
    server,
    /app\.use\(\s*["']\/api\/equipment-catalogue["'][\s\S]*requireAuth[\s\S]*hireBoundary[\s\S]*enforceEquipmentCatalogueWriteIntegrity[\s\S]*equipmentCatalogueRoutes/
  );
  assert.doesNotMatch(
    server,
    /require\(["']\.\/routes\/equipmentSalesRoutes["']\)/
  );
  assert.match(
    boundary,
    /const equipmentSalesRoutes = require\(["']\.\.\/routes\/equipmentSalesRoutes["']\)/
  );
  assert.match(boundary, /function isEquipmentSalesRequest/);
  assert.match(boundary, /\^\\\/sales/);
  assert.match(boundary, /function dispatchEquipmentSalesRouter/);
  assert.match(boundary, /req\.url = req\.url\.replace/);
  assert.match(boundary, /return equipmentSalesRoutes\(req, res/);
});

test("Equipment Sales finalization routes remain attached exactly once", () => {
  assert.match(
    schemaService,
    /const equipmentSalesRoutes = require\(["']\.\.\/routes\/equipmentSalesRoutes["']\)/
  );
  assert.match(
    schemaService,
    /const equipmentSalesFinalizationRoutes = require\(["']\.\.\/routes\/equipmentSalesFinalizationRoutes["']\)/
  );
  assert.match(
    schemaService,
    /if \(!equipmentSalesRoutes\.__chalin03FinalizationMounted\)/
  );
  assert.match(
    schemaService,
    /equipmentSalesRoutes\.use\(equipmentSalesFinalizationRoutes\)/
  );
  assert.match(salesRoutes, /router\.get\(["']\/summary["']/);
  assert.match(salesRoutes, /router\.post\(["']\/agreements["']/);
  assert.match(
    finalizationRoutes,
    /["']\/agreements\/:id\/documents\/:type\.pdf["']/
  );
  assert.match(finalizationRoutes, /["']\/reports\/management["']/);
});

test("frontend Equipment Sales pages use the protected catalogue sales path", () => {
  assert.match(
    workspacePage,
    /const API = ["']\/equipment-catalogue\/sales["']/
  );
  assert.match(
    reportsPage,
    /const API = ["']\/equipment-catalogue\/sales["']/
  );
});
''')
