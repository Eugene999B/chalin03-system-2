from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]


def replace_once(relative_path: str, old: str, new: str) -> None:
    path = ROOT / relative_path
    source = path.read_text()
    count = source.count(old)
    if count != 1:
        raise RuntimeError(
            f"Expected one match in {relative_path}, found {count}: {old[:100]!r}"
        )
    path.write_text(source.replace(old, new, 1))


def replace_between(relative_path: str, start: str, end: str, replacement: str) -> None:
    path = ROOT / relative_path
    source = path.read_text()
    start_index = source.find(start)
    if start_index < 0:
        raise RuntimeError(f"Start marker missing in {relative_path}: {start!r}")
    end_index = source.find(end, start_index + len(start))
    if end_index < 0:
        raise RuntimeError(f"End marker missing in {relative_path}: {end!r}")
    path.write_text(source[:start_index] + replacement + source[end_index:])


def concatenate(output: str, parts: list[str]) -> None:
    destination = ROOT / output
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text("".join((ROOT / part).read_text() for part in parts))


concatenate(
    "backend/routes/customerStatementWorkspaceRoutes.js",
    [f".release-parts/customerStatementWorkspaceRoutes.part{index:02d}" for index in range(1, 9)],
)
concatenate(
    "frontend/src/pages/CustomerStatementWorkspacePage.jsx",
    [f".release-parts/CustomerStatementWorkspacePage.part{index}" for index in range(1, 5)],
)

replace_once(
    "backend/server.js",
    'const customerDebtReportRoutes = require("./routes/customerDebtReportRoutes");\n',
    'const customerDebtReportRoutes = require("./routes/customerDebtReportRoutes");\n'
    'const customerStatementWorkspaceRoutes = require("./routes/customerStatementWorkspaceRoutes");\n',
)
replace_once(
    "backend/server.js",
    '      "/api/customer-debt-reports",\n',
    '      "/api/customer-debt-reports",\n      "/api/customer-statement-workspace",\n',
)
replace_once(
    "backend/server.js",
    'app.use(\n'
    '  "/api/customer-debt-reports",\n'
    '  requireAuth,\n'
    '  sparePartsBoundary,\n'
    '  customerDebtReportRoutes\n'
    ');\n',
    'app.use(\n'
    '  "/api/customer-debt-reports",\n'
    '  requireAuth,\n'
    '  sparePartsBoundary,\n'
    '  customerDebtReportRoutes\n'
    ');\n'
    'app.use(\n'
    '  "/api/customer-statement-workspace",\n'
    '  requireAuth,\n'
    '  sparePartsBoundary,\n'
    '  customerStatementWorkspaceRoutes\n'
    ');\n',
)

replace_once(
    "frontend/src/components/Layout.jsx",
    'import InstallAppButton from "./InstallAppButton";\n'
    'import { useEffect, useMemo, useState } from "react";\n'
    'import { NavLink, Outlet, useNavigate } from "react-router-dom";\n'
    'import { useAuth } from "../context/AuthContext";\n',
    'import { useEffect, useMemo, useState } from "react";\n'
    'import { Outlet, useNavigate } from "react-router-dom";\n'
    'import CompactSidebarNavigation from "./CompactSidebarNavigation";\n'
    'import SidebarAccountMenu from "./SidebarAccountMenu";\n'
    'import "../styles/sidebarPolish.css";\n'
    'import { useAuth } from "../context/AuthContext";\n',
)

replace_between(
    "frontend/src/components/Layout.jsx",
    '        <div className="premium-sidebar-tools">\n',
    '\n        <div className="premium-nav-scroll">\n',
    '        <div className="premium-sidebar-tools">\n'
    '          <div className="premium-store-card premium-store-card-compact">\n'
    '            <label>{currentStoreCode}</label>\n'
    '            <div style={{ minWidth: 0 }}>\n'
    '              <h3>{currentStoreName}</h3>\n'
    '              <p>{storeAccessLabel}</p>\n'
    '            </div>\n'
    '          </div>\n'
    '        </div>\n',
)
replace_between(
    "frontend/src/components/Layout.jsx",
    '        <div className="premium-nav-scroll">\n',
    '\n        <div className="premium-user-panel">\n',
    '        <div className="premium-nav-scroll">\n'
    '          <CompactSidebarNavigation\n'
    '            sections={navigationSections}\n'
    '            onNavigate={closeMobileMenu}\n'
    '          />\n'
    '        </div>\n',
)
replace_between(
    "frontend/src/components/Layout.jsx",
    '        <div className="premium-user-panel">\n',
    '\n      </aside>\n',
    '        <div className="premium-user-panel">\n'
    '          <SidebarAccountMenu\n'
    '            displayName={displayName}\n'
    '            userInitials={userInitials}\n'
    '            role={user?.role}\n'
    '            currentStoreCode={currentStoreCode}\n'
    '            currentStoreName={currentStoreName}\n'
    '            storeAccessLabel={storeAccessLabel}\n'
    '            onChangePassword={goToChangePassword}\n'
    '            onLogout={handleLogout}\n'
    '          />\n'
    '        </div>\n',
)

replace_once(
    "frontend/src/pages/DebtsPage.jsx",
    '      <CustomerDebtPrintPanel\n'
    '        currentStoreCode={currentStoreCode}\n'
    '        preferredCustomer={selectedDebt}\n'
    '      />\n',
    '      <CustomerDebtPrintPanel\n'
    '        currentStoreCode={currentStoreCode}\n'
    '        preferredCustomer={selectedDebt}\n'
    '        reportType="debt"\n'
    '      />\n',
)

shutil.rmtree(ROOT / ".release-parts")
for relative_path in [
    ".github/workflows/temp-finalize-extraordinary-statements.yml",
    ".github/workflows/temp-finalize-extraordinary-statements-pr.yml",
    "scripts/finalizeExtraordinaryStatements.py",
]:
    path = ROOT / relative_path
    if path.exists():
        path.unlink()
