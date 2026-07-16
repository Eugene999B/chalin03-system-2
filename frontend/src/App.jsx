import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { WorkspaceContextProvider } from "./context/WorkspaceContext";
import ProtectedRoute from "./components/ProtectedRoute";
import PermissionRoute from "./components/PermissionRoute";
import RoleRoute from "./components/RoleRoute";
import WorkspaceRoute from "./components/WorkspaceRoute";
import SparePartsLayout from "./layouts/SparePartsLayout";
import MiningLayout from "./layouts/MiningLayout";
import EquipmentHireLayout from "./layouts/EquipmentHireLayout";
import GroupExecutiveLayout from "./layouts/GroupExecutiveLayout";
import PageErrorBoundary from "./components/PageErrorBoundary";

import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import ProductsPage from "./pages/ProductsPage";
import NewSalePage from "./pages/NewSalePage";
import SalesHistoryPage from "./pages/SalesHistoryPage";
import DebtsPage from "./pages/DebtsPage";
import ReportsPage from "./pages/ReportsPage";
import UsersSettingsPage from "./pages/UsersSettingsPage";
import ExpensesPage from "./pages/ExpensesPage";
import PurchasesPage from "./pages/PurchasesPage";
import ReturnsPage from "./pages/ReturnsPage";
import ExportsPage from "./pages/ExportsPage";
import ActivityLogPage from "./pages/ActivityLogPage";
import BackupPage from "./pages/BackupPage";
import SystemOperationsPage from "./pages/SystemOperationsPage";
import DailyClosingPage from "./pages/DailyClosingPage";
import LowStockPage from "./pages/LowStockPage";
import CustomerStatementPage from "./pages/CustomerStatementPage";
import ChangePasswordPage from "./pages/ChangePasswordPage";
import MaintenancePage from "./pages/MaintenancePage";
import HelpPage from "./pages/HelpPage";
import AuditAccountingPage from "./pages/AuditAccountingPage";
import AuditSignoffHistoryPage from "./pages/AuditSignoffHistoryPage";
import AuditUnlockRequestsPage from "./pages/AuditUnlockRequestsPage";
import SmsPage from "./pages/SmsPage";
import AdvancedAccountingIntelligencePage from "./pages/AdvancedAccountingIntelligencePage";
import StockTransfersPage from "./pages/StockTransfersPage";
import MiningPortalPage from "./pages/MiningPortalPage";
import MiningOperationsPage from "./pages/MiningOperationsPage";
import EquipmentHirePortalPage from "./pages/EquipmentHirePortalPage";
import EquipmentHireOperationsPage from "./pages/EquipmentHireOperationsPage";
import FleetAssetsPage from "./pages/FleetAssetsPage";
import OperationsDocumentsAccountingPage from "./pages/OperationsDocumentsAccountingPage";
import GroupExecutiveControlPage from "./pages/GroupExecutiveControlPage";
import OwnerRecoveryPage from "./pages/OwnerRecoveryPage";
import Release2FinalControlPage from "./pages/Release2FinalControlPage";
import WorkspaceHelpPage from "./pages/WorkspaceHelpPage";
import WorkspaceAdministrationPage from "./pages/WorkspaceAdministrationPage";
import {
  HIRE_SECTION_PERMISSIONS,
  MINING_SECTION_PERMISSIONS,
} from "./security/permissionRules";

const businessWorkRoles = ["admin", "manager", "cashier"];
const adminManagerRoles = ["admin", "manager"];
const auditReadRoles = ["admin", "manager", "auditor"];
const adminOnlyRoles = ["admin"];

const SPARE_PARTS_WORKSPACE = ["spare_parts"];
const MINING_WORKSPACE = ["mining"];
const EQUIPMENT_HIRE_WORKSPACE = ["equipment_hire"];
const ALL_WORKSPACES = ["spare_parts", "mining", "equipment_hire"];

function SafePage({ children }) {
  return <PageErrorBoundary>{children}</PageErrorBoundary>;
}

function safe(page) {
  return <SafePage>{page}</SafePage>;
}

function rolePage(allowedRoles, page) {
  return <RoleRoute allowedRoles={allowedRoles}>{safe(page)}</RoleRoute>;
}

function permissionPage(rule, page) {
  return (
    <PermissionRoute
      permissions={rule?.all || []}
      anyPermissions={rule?.any || []}
    >
      {safe(page)}
    </PermissionRoute>
  );
}

function permissionOnlyPage(permission, page) {
  return (
    <PermissionRoute permissions={[permission]}>{safe(page)}</PermissionRoute>
  );
}

function WorkspaceShell({ allowedWorkspaces, children }) {
  return (
    <ProtectedRoute>
      <WorkspaceRoute allowedWorkspaces={allowedWorkspaces}>
        {children}
      </WorkspaceRoute>
    </ProtectedRoute>
  );
}

function SparePartsHomePage() {
  const { user } = useAuth();
  const role = String(user?.role || "").toLowerCase();

  if (role === "auditor") {
    return <Navigate to="/audit-accounting" replace />;
  }

  return safe(<DashboardPage />);
}

function LegacyWorkspaceRedirect({ target }) {
  const { workspaceCode } = useAuth();

  if (workspaceCode === "mining") {
    return <Navigate to={`/mining/${target}`} replace />;
  }

  if (workspaceCode === "equipment_hire") {
    return <Navigate to={`/equipment-hire-operations/${target}`} replace />;
  }

  return <Navigate to="/" replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <WorkspaceContextProvider>
        <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/owner-recovery" element={<OwnerRecoveryPage />} />
          <Route path="/mining-operations" element={<MiningPortalPage />} />
          <Route path="/equipment-hire" element={<EquipmentHirePortalPage />} />

          {/* Spare Parts keeps the original two-store layout and navigation. */}
          <Route
            path="/"
            element={
              <WorkspaceShell allowedWorkspaces={SPARE_PARTS_WORKSPACE}>
                <SparePartsLayout />
              </WorkspaceShell>
            }
          >
            <Route index element={<SparePartsHomePage />} />

            <Route
              path="products"
              element={rolePage(businessWorkRoles, <ProductsPage />)}
            />
            <Route
              path="new-sale"
              element={rolePage(businessWorkRoles, <NewSalePage />)}
            />
            <Route
              path="sales-history"
              element={rolePage(businessWorkRoles, <SalesHistoryPage />)}
            />
            <Route
              path="debts"
              element={rolePage(businessWorkRoles, <DebtsPage />)}
            />

            <Route path="change-password" element={safe(<ChangePasswordPage />)} />
            <Route path="help" element={safe(<HelpPage />)} />

            <Route
              path="customer-statement"
              element={rolePage(auditReadRoles, <CustomerStatementPage />)}
            />
            <Route
              path="reports"
              element={rolePage(auditReadRoles, <ReportsPage />)}
            />
            <Route
              path="audit-accounting"
              element={rolePage(auditReadRoles, <AuditAccountingPage />)}
            />
            <Route
              path="audit-signoffs"
              element={rolePage(auditReadRoles, <AuditSignoffHistoryPage />)}
            />
            <Route
              path="advanced-accounting-intelligence"
              element={rolePage(
                auditReadRoles,
                <AdvancedAccountingIntelligencePage />
              )}
            />
            <Route
              path="exports"
              element={rolePage(auditReadRoles, <ExportsPage />)}
            />

            <Route
              path="audit-unlock-requests"
              element={rolePage(adminManagerRoles, <AuditUnlockRequestsPage />)}
            />
            <Route
              path="low-stock"
              element={rolePage(adminManagerRoles, <LowStockPage />)}
            />
            <Route
              path="stock-transfers"
              element={rolePage(adminManagerRoles, <StockTransfersPage />)}
            />
            <Route
              path="expenses"
              element={rolePage(adminManagerRoles, <ExpensesPage />)}
            />
            <Route
              path="purchases"
              element={rolePage(adminManagerRoles, <PurchasesPage />)}
            />
            <Route
              path="returns"
              element={rolePage(adminManagerRoles, <ReturnsPage />)}
            />
            <Route
              path="daily-closing"
              element={rolePage(adminManagerRoles, <DailyClosingPage />)}
            />
            <Route path="sms" element={rolePage(adminManagerRoles, <SmsPage />)} />

            <Route
              path="users-settings"
              element={rolePage(adminOnlyRoles, <UsersSettingsPage />)}
            />
            <Route
              path="activity-log"
              element={permissionOnlyPage("audit.view", <ActivityLogPage />)}
            />
            <Route
              path="backup"
              element={permissionOnlyPage("backup.download", <BackupPage />)}
            />
            <Route
              path="security-centre"
              element={permissionOnlyPage(
                "security.view",
                <Release2FinalControlPage mode="security" />
              )}
            />
            <Route
              path="professional-backups"
              element={permissionOnlyPage(
                "backup.download",
                <Release2FinalControlPage mode="backups" />
              )}
            />
            <Route
              path="workers"
              element={permissionOnlyPage(
                "workers.view",
                <Release2FinalControlPage mode="workers" />
              )}
            />
            <Route
              path="system-operations"
              element={permissionOnlyPage("system.diagnostics", <SystemOperationsPage />)}
            />
            <Route
              path="backup-restore"
              element={<Navigate to="/backup" replace />}
            />
            <Route
              path="maintenance"
              element={rolePage(adminOnlyRoles, <MaintenancePage />)}
            />
          </Route>

          {/* Mining has its own layout, sidebar and route tree. */}
          <Route
            path="/mining"
            element={
              <WorkspaceShell allowedWorkspaces={MINING_WORKSPACE}>
                <MiningLayout />
              </WorkspaceShell>
            }
          >
            <Route
              index
              element={permissionPage(
                MINING_SECTION_PERMISSIONS.overview,
                <MiningOperationsPage section="overview" />
              )}
            />
            <Route
              path="sites"
              element={permissionPage(
                MINING_SECTION_PERMISSIONS.sites,
                <MiningOperationsPage section="sites" />
              )}
            />
            <Route
              path="daily-logs"
              element={permissionPage(
                MINING_SECTION_PERMISSIONS.daily,
                <MiningOperationsPage section="daily" />
              )}
            />
            <Route
              path="production"
              element={permissionPage(
                MINING_SECTION_PERMISSIONS.production,
                <MiningOperationsPage section="production" />
              )}
            />
            <Route
              path="equipment"
              element={permissionPage(
                MINING_SECTION_PERMISSIONS.equipment,
                <MiningOperationsPage section="equipment" />
              )}
            />
            <Route
              path="fuel"
              element={permissionPage(
                MINING_SECTION_PERMISSIONS.fuel,
                <MiningOperationsPage section="fuel" />
              )}
            />
            <Route
              path="expenses"
              element={permissionPage(
                MINING_SECTION_PERMISSIONS.expenses,
                <MiningOperationsPage section="expenses" />
              )}
            />
            <Route
              path="incidents"
              element={permissionPage(
                MINING_SECTION_PERMISSIONS.incidents,
                <MiningOperationsPage section="incidents" />
              )}
            />
            <Route
              path="fleet"
              element={permissionPage(MINING_SECTION_PERMISSIONS.fleet, <FleetAssetsPage />)}
            />
            <Route
              path="documents"
              element={permissionPage(
                MINING_SECTION_PERMISSIONS.documents,
                <OperationsDocumentsAccountingPage workspaceScope="mining" />
              )}
            />
            <Route
              path="workers"
              element={permissionOnlyPage(
                "workers.view",
                <Release2FinalControlPage mode="workers" />
              )}
            />
            <Route
              path="administration"
              element={permissionPage(
                MINING_SECTION_PERMISSIONS.administration,
                <WorkspaceAdministrationPage workspace="mining" />
              )}
            />
            <Route
              path="help"
              element={safe(<WorkspaceHelpPage workspace="mining" />)}
            />
            <Route
              path="change-password"
              element={safe(<ChangePasswordPage />)}
            />
          </Route>

          {/* Equipment Hire has its own layout, sidebar and route tree. */}
          <Route
            path="/equipment-hire-operations"
            element={
              <WorkspaceShell allowedWorkspaces={EQUIPMENT_HIRE_WORKSPACE}>
                <EquipmentHireLayout />
              </WorkspaceShell>
            }
          >
            <Route
              index
              element={permissionPage(
                HIRE_SECTION_PERMISSIONS.overview,
                <EquipmentHireOperationsPage section="overview" />
              )}
            />
            <Route
              path="customers"
              element={permissionPage(
                HIRE_SECTION_PERMISSIONS.customers,
                <EquipmentHireOperationsPage section="customers" />
              )}
            />
            <Route
              path="enquiries"
              element={permissionPage(
                HIRE_SECTION_PERMISSIONS.enquiries,
                <EquipmentHireOperationsPage section="enquiries" />
              )}
            />
            <Route
              path="availability"
              element={permissionPage(
                HIRE_SECTION_PERMISSIONS.availability,
                <EquipmentHireOperationsPage section="availability" />
              )}
            />
            <Route
              path="quotations"
              element={permissionPage(
                HIRE_SECTION_PERMISSIONS.quotations,
                <EquipmentHireOperationsPage section="quotations" />
              )}
            />
            <Route
              path="contracts"
              element={permissionPage(
                HIRE_SECTION_PERMISSIONS.contracts,
                <EquipmentHireOperationsPage section="contracts" />
              )}
            />
            <Route
              path="operations"
              element={permissionPage(
                HIRE_SECTION_PERMISSIONS.operations,
                <EquipmentHireOperationsPage section="operations" />
              )}
            />
            <Route
              path="finance"
              element={permissionPage(
                HIRE_SECTION_PERMISSIONS.finance,
                <EquipmentHireOperationsPage section="finance" />
              )}
            />
            <Route
              path="returns"
              element={permissionPage(
                HIRE_SECTION_PERMISSIONS.returns,
                <EquipmentHireOperationsPage section="returns" />
              )}
            />
            <Route
              path="reports"
              element={permissionPage(
                HIRE_SECTION_PERMISSIONS.reports,
                <EquipmentHireOperationsPage section="reports" />
              )}
            />
            <Route
              path="fleet"
              element={permissionPage(HIRE_SECTION_PERMISSIONS.fleet, <FleetAssetsPage />)}
            />
            <Route
              path="documents"
              element={permissionPage(
                HIRE_SECTION_PERMISSIONS.documents,
                <OperationsDocumentsAccountingPage workspaceScope="equipment_hire" />
              )}
            />
            <Route
              path="workers"
              element={permissionOnlyPage(
                "workers.view",
                <Release2FinalControlPage mode="workers" />
              )}
            />
            <Route
              path="administration"
              element={permissionPage(
                HIRE_SECTION_PERMISSIONS.administration,
                <WorkspaceAdministrationPage workspace="equipment_hire" />
              )}
            />
            <Route
              path="help"
              element={safe(<WorkspaceHelpPage workspace="equipment_hire" />)}
            />
            <Route
              path="change-password"
              element={safe(<ChangePasswordPage />)}
            />
          </Route>

          {/* Group Executive is a separate management shell, not a business sidebar. */}
          <Route
            path="/group-executive-control"
            element={
              <WorkspaceShell allowedWorkspaces={ALL_WORKSPACES}>
                <PermissionRoute permissions={["audit.view"]}>
                  <GroupExecutiveLayout />
                </PermissionRoute>
              </WorkspaceShell>
            }
          >
            <Route index element={safe(<GroupExecutiveControlPage />)} />
            <Route
              path="operations"
              element={permissionOnlyPage(
                "executive.operations.view",
                <Release2FinalControlPage mode="executive" />
              )}
            />
          </Route>

          {/* Old shared links now redirect into the active business workspace. */}
          <Route
            path="/fleet-assets"
            element={
              <ProtectedRoute>
                <LegacyWorkspaceRedirect target="fleet" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/operations-documents-accounting"
            element={
              <ProtectedRoute>
                <LegacyWorkspaceRedirect target="documents" />
              </ProtectedRoute>
            }
          />

          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
        </BrowserRouter>
      </WorkspaceContextProvider>
    </AuthProvider>
  );
}
