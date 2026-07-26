from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    source = file_path.read_text(encoding="utf-8")
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"Expected one match in {path}, found {count}: {old[:100]!r}")
    file_path.write_text(source.replace(old, new, 1), encoding="utf-8")


service_path = Path("backend/services/workspaceContextDeletionService.js")
service_path.write_text(
    '''function quoteIdentifier(value) {
  return `\\`${String(value || "").replaceAll("`", "``")}\\``;
}

async function loadForeignKeyDependencies(
  connection,
  parentTable,
  parentId,
  parentColumn = "id"
) {
  const [references] = await connection.query(
    `SELECT DISTINCT
       kcu.TABLE_NAME AS table_name,
       kcu.COLUMN_NAME AS column_name,
       COALESCE(rc.DELETE_RULE, 'RESTRICT') AS delete_rule
     FROM information_schema.KEY_COLUMN_USAGE kcu
     LEFT JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
       ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
      AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
      AND rc.TABLE_NAME = kcu.TABLE_NAME
     WHERE kcu.REFERENCED_TABLE_SCHEMA = DATABASE()
       AND kcu.REFERENCED_TABLE_NAME = ?
       AND kcu.REFERENCED_COLUMN_NAME = ?
     ORDER BY kcu.TABLE_NAME, kcu.COLUMN_NAME`,
    [parentTable, parentColumn]
  );

  const dependencies = [];

  for (const reference of references) {
    const tableName = String(reference.table_name || "");
    const columnName = String(reference.column_name || "");

    if (!tableName || !columnName) continue;

    const [rows] = await connection.query(
      `SELECT COUNT(*) AS total_count
       FROM ${quoteIdentifier(tableName)}
       WHERE ${quoteIdentifier(columnName)} = ?`,
      [parentId]
    );

    dependencies.push({
      table_name: tableName,
      column_name: columnName,
      delete_rule: String(reference.delete_rule || "RESTRICT").toUpperCase(),
      count: Number(rows[0]?.total_count || 0),
    });
  }

  return dependencies;
}

function findBlockingDependencies(dependencies, removableTables = []) {
  const removable = new Set(removableTables.map((value) => String(value)));

  return (dependencies || []).filter((dependency) => {
    if (Number(dependency.count || 0) < 1) return false;
    if (removable.has(String(dependency.table_name))) return false;
    return ["RESTRICT", "NO ACTION"].includes(
      String(dependency.delete_rule || "RESTRICT").toUpperCase()
    );
  });
}

function summarizeDependencies(dependencies) {
  return (dependencies || [])
    .filter((dependency) => Number(dependency.count || 0) > 0)
    .map((dependency) => ({
      table: dependency.table_name,
      records: Number(dependency.count || 0),
      delete_rule: dependency.delete_rule,
    }));
}

module.exports = {
  loadForeignKeyDependencies,
  findBlockingDependencies,
  summarizeDependencies,
};
''',
    encoding="utf-8",
)

# Mining backend imports.
replace_once(
    "backend/routes/miningRoutes.js",
    'const { writeAuditEvent } = require("../services/auditTrailService");\n',
    'const { writeAuditEvent } = require("../services/auditTrailService");\n'
    'const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");\n'
    'const {\n'
    '  loadForeignKeyDependencies,\n'
    '  findBlockingDependencies,\n'
    '  summarizeDependencies,\n'
    '} = require("../services/workspaceContextDeletionService");\n',
)

mining_delete_route = r'''

// DELETE /api/mining/sites/:id
// Empty sites are permanently removed. Sites with operational history are
// closed and hidden so immutable business evidence is never destroyed.
router.delete("/sites/:id", requirePermission("mining.sites.manage"), async (req, res) => {
  const connection = await pool.getConnection();

  try {
    if (!isOriginalSystemAdministrator(req.user)) {
      return res.status(403).json({
        status: "error",
        message: "Only the main System Administrator can remove a Mining site.",
      });
    }

    const siteId = toPositiveInt(req.params.id);
    const reason = cleanText(req.body?.reason, 1000);
    const confirmation = cleanText(req.body?.confirmation, 80).toUpperCase();

    if (!siteId) {
      return res.status(400).json({ status: "error", message: "Invalid site ID." });
    }

    if (!reason) {
      return res.status(400).json({
        status: "error",
        message: "A reason is required before removing a Mining site.",
      });
    }

    await connection.beginTransaction();

    const [sites] = await connection.query(
      `SELECT id, site_code, site_name, status, is_active
       FROM mining_sites
       WHERE id = ?
       LIMIT 1
       FOR UPDATE`,
      [siteId]
    );

    const site = sites[0];

    if (!site) {
      await connection.rollback();
      return res.status(404).json({ status: "error", message: "Mining site not found." });
    }

    if (confirmation !== String(site.site_code || "").toUpperCase()) {
      await connection.rollback();
      return res.status(400).json({
        status: "error",
        message: `Type the site code ${site.site_code} exactly to confirm.`,
      });
    }

    const dependencies = await loadForeignKeyDependencies(
      connection,
      "mining_sites",
      siteId
    );
    const blocking = findBlockingDependencies(dependencies, [
      "user_mining_site_access",
    ]);

    if (blocking.length > 0) {
      await connection.query(
        `UPDATE user_mining_site_access
         SET can_access = FALSE,
             is_default = FALSE,
             updated_at = CURRENT_TIMESTAMP
         WHERE site_id = ?`,
        [siteId]
      );
      await connection.query(
        `UPDATE mining_sites
         SET status = 'closed',
             is_active = FALSE,
             notes = CONCAT_WS('\n', NULLIF(notes, ''), ?),
             updated_by = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [`Archived by System Administrator. Reason: ${reason}`, req.user.id, siteId]
      );
      await connection.commit();

      await logActivity(
        pool,
        req,
        "ARCHIVE_MINING_SITE_WITH_HISTORY",
        `Archived mining site ${site.site_code} — ${site.site_name}. Reason: ${reason}. Linked records preserved: ${blocking
          .map((item) => `${item.table_name}=${item.count}`)
          .join(", ")}`
      );

      return res.json({
        status: "success",
        code: "MINING_SITE_ARCHIVED_WITH_HISTORY",
        message:
          "This Mining site contains operational history, so it was closed and hidden instead of deleting business evidence.",
        deleted: false,
        archived: true,
        dependencies: summarizeDependencies(dependencies),
      });
    }

    await connection.query(
      "DELETE FROM user_mining_site_access WHERE site_id = ?",
      [siteId]
    );
    await connection.query("DELETE FROM mining_sites WHERE id = ?", [siteId]);
    await connection.commit();

    await logActivity(
      pool,
      req,
      "DELETE_EMPTY_MINING_SITE",
      `Permanently deleted empty mining site ${site.site_code} — ${site.site_name}. Reason: ${reason}`
    );

    return res.json({
      status: "success",
      code: "EMPTY_MINING_SITE_DELETED",
      message: "The empty Mining site and its staff assignments were deleted successfully.",
      deleted: true,
      archived: false,
    });
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Ignore rollback failures after a connection error.
    }

    console.error("Remove mining site error:", error);
    if (sendMiningSiteScopeError(res, error)) return;
    if (sendMiningSetupError(res, error)) return;
    return res.status(500).json({
      status: "error",
      message: "Could not safely remove the Mining site.",
    });
  } finally {
    connection.release();
  }
});
'''

replace_once(
    "backend/routes/miningRoutes.js",
    '\n// GET /api/mining/daily-logs\n',
    mining_delete_route + '\n// GET /api/mining/daily-logs\n',
)

# Workspace administration backend imports.
replace_once(
    "backend/routes/workspaceAdminRoutes.js",
    'const {\n  isOriginalSystemAdministrator,\n} = require("../security/systemAdminIdentity");\n',
    'const {\n  isOriginalSystemAdministrator,\n} = require("../security/systemAdminIdentity");\n'
    'const {\n'
    '  loadForeignKeyDependencies,\n'
    '  findBlockingDependencies,\n'
    '  summarizeDependencies,\n'
    '} = require("../services/workspaceContextDeletionService");\n',
)

location_delete_route = r'''

// DELETE /api/workspace-admin/locations/:locationId
// Empty Hire locations are removed. Locations with commercial or operational
// records are archived so invoices, contracts, deliveries and audit evidence remain intact.
router.delete("/locations/:locationId", async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const workspace = await getActiveWorkspace(req, res);
    if (!workspace) return;

    if (workspace.code !== "equipment_hire") {
      throw clientError(400, "This action is available only in Equipment Hire.");
    }

    if (!isOriginalSystemAdministrator(req.user)) {
      throw clientError(
        403,
        "Only the main System Administrator can remove an Equipment Hire location."
      );
    }

    const locationId = positiveId(req.params.locationId);
    const reason = cleanText(req.body?.reason, 1000);
    const confirmation = cleanText(req.body?.confirmation, 80).toUpperCase();

    if (!locationId) throw clientError(400, "Invalid location ID.");
    if (!reason) {
      throw clientError(
        400,
        "A reason is required before removing an Equipment Hire location."
      );
    }

    await connection.beginTransaction();

    const [locations] = await connection.query(
      `SELECT id, code, name, location_type, is_active
       FROM business_locations
       WHERE id = ? AND business_unit_id = ?
       LIMIT 1
       FOR UPDATE`,
      [locationId, workspace.id]
    );
    const location = locations[0];

    if (!location) {
      await connection.rollback();
      throw clientError(404, "Equipment Hire location not found.");
    }

    if (confirmation !== String(location.code || "").toUpperCase()) {
      await connection.rollback();
      throw clientError(
        400,
        `Type the location code ${location.code} exactly to confirm.`
      );
    }

    const dependencies = await loadForeignKeyDependencies(
      connection,
      "business_locations",
      locationId
    );
    const blocking = findBlockingDependencies(dependencies, [
      "user_hire_location_access",
    ]);

    if (blocking.length > 0) {
      await connection.query(
        `UPDATE user_hire_location_access
         SET can_access = FALSE,
             is_default = FALSE,
             updated_at = CURRENT_TIMESTAMP
         WHERE location_id = ?`,
        [locationId]
      );
      await connection.query(
        `UPDATE business_locations
         SET is_active = FALSE,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND business_unit_id = ?`,
        [locationId, workspace.id]
      );
      await connection.commit();

      await logActivity(
        req,
        "ARCHIVE_HIRE_LOCATION_WITH_HISTORY",
        `Archived Equipment Hire location ${location.code} - ${location.name}. Reason: ${reason}. Linked records preserved: ${blocking
          .map((item) => `${item.table_name}=${item.count}`)
          .join(", ")}`
      );

      return res.json({
        status: "success",
        code: "HIRE_LOCATION_ARCHIVED_WITH_HISTORY",
        message:
          "This Hire location contains business history, so it was deactivated instead of deleting contracts, invoices or operational evidence.",
        deleted: false,
        archived: true,
        dependencies: summarizeDependencies(dependencies),
      });
    }

    await connection.query(
      "DELETE FROM user_hire_location_access WHERE location_id = ?",
      [locationId]
    );
    await connection.query(
      "DELETE FROM business_locations WHERE id = ? AND business_unit_id = ?",
      [locationId, workspace.id]
    );
    await connection.commit();

    await logActivity(
      req,
      "DELETE_EMPTY_HIRE_LOCATION",
      `Permanently deleted empty Equipment Hire location ${location.code} - ${location.name}. Reason: ${reason}`
    );

    return res.json({
      status: "success",
      code: "EMPTY_HIRE_LOCATION_DELETED",
      message:
        "The empty Equipment Hire location and its staff assignments were deleted successfully.",
      deleted: true,
      archived: false,
    });
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Ignore rollback failures after a connection error.
    }

    console.error("Remove Equipment Hire location error:", error);
    return sendRouteError(
      res,
      error,
      "Could not safely remove the Equipment Hire location."
    );
  } finally {
    connection.release();
  }
});
'''

replace_once(
    "backend/routes/workspaceAdminRoutes.js",
    '\n// GET /api/workspace-admin/context-access\n',
    location_delete_route + '\n// GET /api/workspace-admin/context-access\n',
)

# Mining frontend: original admin detection.
replace_once(
    "frontend/src/pages/MiningOperationsPage.jsx",
    'function apiMessage(error, fallback) {\n  return error?.response?.data?.message || error?.message || fallback;\n}\n',
    'function apiMessage(error, fallback) {\n  return error?.response?.data?.message || error?.message || fallback;\n}\n\n'
    'function isOriginalSystemAdministrator(user) {\n'
    '  return (\n'
    '    Number(user?.id) === 1 &&\n'
    '    String(user?.username || "").toLowerCase() === "admin" &&\n'
    '    String(user?.role || "").toLowerCase() === "admin"\n'
    '  );\n'
    '}\n',
)
replace_once(
    "frontend/src/pages/MiningOperationsPage.jsx",
    '  const { effectivePermissions, hasAnyPermission } = useAuth();\n',
    '  const { user: currentUser, effectivePermissions, hasAnyPermission } = useAuth();\n',
)
replace_once(
    "frontend/src/pages/MiningOperationsPage.jsx",
    '  const canManageSites = canUseMiningAction(effectivePermissions, "sites", "edit");\n',
    '  const canManageSites = canUseMiningAction(effectivePermissions, "sites", "edit");\n'
    '  const canDeleteSites = isOriginalSystemAdministrator(currentUser);\n',
)
replace_once(
    "frontend/src/pages/MiningOperationsPage.jsx",
    '  const [saving, setSaving] = useState(false);\n',
    '  const [saving, setSaving] = useState(false);\n'
    '  const [deletingSiteId, setDeletingSiteId] = useState(null);\n',
)

mining_delete_function = r'''

  async function deleteSite(site) {
    const confirmation = window.prompt(
      `Type ${site.site_code} to remove this Mining site. Empty sites are deleted; sites with operational history are closed and hidden.`
    );

    if (confirmation === null) return;

    const reason = window.prompt(
      "Enter the reason for removing this Mining site. This reason is written to the audit trail."
    );

    if (!String(reason || "").trim()) {
      setError("A reason is required before removing a Mining site.");
      return;
    }

    setDeletingSiteId(site.id);
    setError("");

    try {
      const response = await axiosClient.delete(`/mining/sites/${site.id}`, {
        data: {
          confirmation: String(confirmation || "").trim(),
          reason: String(reason).trim(),
        },
      });

      if (Number(selectedSiteId) === Number(site.id)) {
        selectContext("");
        setSelectedSiteId("");
      }

      setFormOpen(false);
      setSiteForm(initialSiteForm);
      setNotice(response.data?.message || "Mining site removed safely.");
      await Promise.all([loadSitesAndAssets(), loadDashboard()]);
    } catch (requestError) {
      setError(apiMessage(requestError, "Could not safely remove the Mining site."));
    } finally {
      setDeletingSiteId(null);
    }
  }
'''
replace_once(
    "frontend/src/pages/MiningOperationsPage.jsx",
    '\n  async function approveDailyLog(log) {\n',
    mining_delete_function + '\n  async function approveDailyLog(log) {\n',
)
replace_once(
    "frontend/src/pages/MiningOperationsPage.jsx",
    '              <SitesTable sites={sites} canEdit={canManageSites} onEdit={editSite} />\n',
    '              <SitesTable\n'
    '                sites={sites}\n'
    '                canEdit={canManageSites}\n'
    '                canDelete={canDeleteSites}\n'
    '                deletingSiteId={deletingSiteId}\n'
    '                onEdit={editSite}\n'
    '                onDelete={deleteSite}\n'
    '              />\n',
)
replace_once(
    "frontend/src/pages/MiningOperationsPage.jsx",
    'function SitesTable({ sites, canEdit, onEdit }) {\n',
    'function SitesTable({ sites, canEdit, canDelete, deletingSiteId, onEdit, onDelete }) {\n',
)
replace_once(
    "frontend/src/pages/MiningOperationsPage.jsx",
    '      {canEdit ? <button type="button" className="mining-button mining-button--ghost" onClick={() => onEdit(site)}>Edit Site</button> : null}\n',
    '      {canEdit || canDelete ? (\n'
    '        <div className="mining-inline-actions">\n'
    '          {canEdit ? <button type="button" className="mining-button mining-button--ghost" onClick={() => onEdit(site)}>Edit Site</button> : null}\n'
    '          {canDelete ? (\n'
    '            <button\n'
    '              type="button"\n'
    '              className="mining-button mining-button--danger"\n'
    '              disabled={Number(deletingSiteId) === Number(site.id)}\n'
    '              onClick={() => onDelete(site)}\n'
    '            >\n'
    '              {Number(deletingSiteId) === Number(site.id) ? "Removing…" : "Delete Site"}\n'
    '            </button>\n'
    '          ) : null}\n'
    '        </div>\n'
    '      ) : null}\n',
)

# Equipment Hire frontend.
replace_once(
    "frontend/src/pages/WorkspaceAdministrationPage.jsx",
    'function HireLocations({ locations, onEdit }) {\n',
    'function HireLocations({ locations, onEdit, onDelete, deletingLocationId }) {\n',
)
replace_once(
    "frontend/src/pages/WorkspaceAdministrationPage.jsx",
    '          <button\n            type="button"\n            className="workspace-admin-btn workspace-admin-btn--ghost"\n            onClick={() => onEdit(location)}\n          >\n            Edit location\n          </button>\n',
    '          <div className="workspace-staff-actions">\n'
    '            <button\n'
    '              type="button"\n'
    '              className="workspace-admin-btn workspace-admin-btn--ghost"\n'
    '              onClick={() => onEdit(location)}\n'
    '            >\n'
    '              Edit location\n'
    '            </button>\n'
    '            {onDelete ? (\n'
    '              <button\n'
    '                type="button"\n'
    '                className="workspace-admin-btn workspace-admin-btn--danger"\n'
    '                disabled={Number(deletingLocationId) === Number(location.id)}\n'
    '                onClick={() => onDelete(location)}\n'
    '              >\n'
    '                {Number(deletingLocationId) === Number(location.id)\n'
    '                  ? "Removing..."\n'
    '                  : "Delete location"}\n'
    '              </button>\n'
    '            ) : null}\n'
    '          </div>\n',
)
replace_once(
    "frontend/src/pages/WorkspaceAdministrationPage.jsx",
    '  const [savingLocation, setSavingLocation] = useState(false);\n',
    '  const [savingLocation, setSavingLocation] = useState(false);\n'
    '  const [deletingLocationId, setDeletingLocationId] = useState(null);\n',
)

location_delete_function = r'''

  async function deleteLocation(location) {
    const confirmation = window.prompt(
      `Type ${location.code} to remove this Equipment Hire location. Empty locations are deleted; locations with business history are deactivated.`
    );

    if (confirmation === null) return;

    const reason = window.prompt(
      "Enter the reason for removing this Equipment Hire location. This reason is written to the audit trail."
    );

    if (!String(reason || "").trim()) {
      setError("A reason is required before removing an Equipment Hire location.");
      return;
    }

    setDeletingLocationId(location.id);
    setError("");

    try {
      const response = await axiosClient.delete(
        `/workspace-admin/locations/${location.id}`,
        {
          data: {
            confirmation: String(confirmation || "").trim(),
            reason: String(reason).trim(),
          },
        }
      );

      if (Number(locationForm.id) === Number(location.id)) {
        setLocationForm(emptyLocationForm);
      }

      showSuccess(response.data?.message || "Hire location removed safely.");
      await loadOverview();
    } catch (requestError) {
      setError(
        apiMessage(
          requestError,
          "Could not safely remove the Equipment Hire location."
        )
      );
    } finally {
      setDeletingLocationId(null);
    }
  }
'''
replace_once(
    "frontend/src/pages/WorkspaceAdministrationPage.jsx",
    '\n  if (loading && !data) {\n',
    location_delete_function + '\n  if (loading && !data) {\n',
)
replace_once(
    "frontend/src/pages/WorkspaceAdministrationPage.jsx",
    '            <HireLocations locations={locations} onEdit={editLocation} />\n',
    '            <HireLocations\n'
    '              locations={locations}\n'
    '              onEdit={editLocation}\n'
    '              onDelete={canResetAccounts ? deleteLocation : null}\n'
    '              deletingLocationId={deletingLocationId}\n'
    '            />\n',
)

# Mining danger button styling.
mining_css_path = Path("frontend/src/styles/mining.css")
mining_css = mining_css_path.read_text(encoding="utf-8")
if ".mining-button--danger" not in mining_css:
    mining_css += '''

.mining-button--danger {
  background: #b42318;
  border-color: #b42318;
  color: #fff;
}

.mining-button--danger:hover:not(:disabled) {
  background: #912018;
  border-color: #912018;
}
'''
    mining_css_path.write_text(mining_css, encoding="utf-8")

# Permanent regression test.
Path("backend/tests/workspaceContextSafeDelete.test.js").write_text(
    '''const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(...parts) {
  return fs.readFileSync(path.join(__dirname, "..", "..", ...parts), "utf8");
}

const miningRoute = read("backend", "routes", "miningRoutes.js");
const workspaceRoute = read("backend", "routes", "workspaceAdminRoutes.js");
const deletionService = read(
  "backend",
  "services",
  "workspaceContextDeletionService.js"
);
const miningPage = read("frontend", "src", "pages", "MiningOperationsPage.jsx");
const workspacePage = read(
  "frontend",
  "src",
  "pages",
  "WorkspaceAdministrationPage.jsx"
);

test("workspace context deletion discovers foreign-key blockers without disabling constraints", () => {
  assert.match(deletionService, /information_schema\.KEY_COLUMN_USAGE/);
  assert.match(deletionService, /REFERENTIAL_CONSTRAINTS/);
  assert.match(deletionService, /findBlockingDependencies/);
  assert.doesNotMatch(deletionService, /FOREIGN_KEY_CHECKS/i);
});

test("only the original System Administrator can remove sites and Hire locations", () => {
  assert.match(miningRoute, /router\.delete\("\/sites\/:id"/);
  assert.match(miningRoute, /isOriginalSystemAdministrator\(req\.user\)/);
  assert.match(workspaceRoute, /router\.delete\("\/locations\/:locationId"/);
  assert.match(workspaceRoute, /isOriginalSystemAdministrator\(req\.user\)/);
});

test("linked business history is archived while empty contexts can be deleted", () => {
  assert.match(miningRoute, /MINING_SITE_ARCHIVED_WITH_HISTORY/);
  assert.match(miningRoute, /EMPTY_MINING_SITE_DELETED/);
  assert.match(workspaceRoute, /HIRE_LOCATION_ARCHIVED_WITH_HISTORY/);
  assert.match(workspaceRoute, /EMPTY_HIRE_LOCATION_DELETED/);
  assert.match(miningRoute, /DELETE FROM user_mining_site_access/);
  assert.match(workspaceRoute, /DELETE FROM user_hire_location_access/);
});

test("administrator interfaces expose audited delete actions", () => {
  assert.match(miningPage, /Delete Site/);
  assert.match(miningPage, /axiosClient\.delete\(`\/mining\/sites\/\$\{site\.id\}`/);
  assert.match(workspacePage, /Delete location/);
  assert.match(
    workspacePage,
    /axiosClient\.delete\([\s\S]*`\/workspace-admin\/locations\/\$\{location\.id\}`/
  );
  assert.match(miningPage, /reason is written to the audit trail/);
  assert.match(workspacePage, /reason is written to the audit trail/);
});
''',
    encoding="utf-8",
)

print("Applied safe System Administrator deletion controls.")
