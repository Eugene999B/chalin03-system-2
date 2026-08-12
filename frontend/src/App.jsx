import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { WorkspaceContextProvider } from "./context/WorkspaceContext";
import ProtectedRoute from "./components/ProtectedRoute";
import PermissionRoute from "./components/PermissionRoute";
import RoleRoute from "./components/RoleRoute";
import WorkspaceRoute from "./components/WorkspaceRoute";
import SparePartsLayout from "./layouts/SparePartsLayout";
import MiningLayout from "./layouts/MiningLayout";
import EquipmentHireLayout from "./layouts/EquipmentHireLayout";
import InstallmentFinanceLayout from "./layouts/InstallmentFinanceLayout";
import GroupExecutiveLayout from "./layouts/GroupExecutiveLayout";
import PageErrorBoundary from "./components/PageErrorBoundary";

import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import ProductsPage from "./pages/ProductsPage";
import InventoryTraceabilityPage from "./pages/InventoryTraceabilityPage";
import NewSalePage from "./pages/NewSalePage";
import InstallmentsPage from "./pages/InstallmentsPage";
import SalesHistoryPage from "./pages/SalesHistoryPage";
import DebtsPage from "./pages/DebtsPage";
import ReportsPage from "./pages/ReportsPage";
import UsersSettingsPage from "./pages/UsersSettingsPage";
import UserPermissionManagerPage from "./pages/UserPermissionManagerPage";
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
import EquipmentHirePortalPage from "./pages/EquipmentHirePortalPage";
import OwnerRecoveryPage from "./pages/OwnerRecoveryPage";
import WorkspaceHelpPage from "./pages/WorkspaceHelpPage";
import {
  HIRE_SECTION_PERMISSIONS,
  MINING_SECTION_PERMISSIONS,
} from "./security/permissionRules";

const MiningOperationsPage = lazy(() => import("./pages/MiningOperationsPage"));
const MiningControlCentrePage = lazy(() => import("./pages/MiningControlCentrePage"));
const EquipmentHireOperationsPage = lazy(() =>
  import("./pages/EquipmentHireOperationsPage")
);
const EquipmentInstallmentCommandPage = lazy(() =>
  import("./pages/EquipmentInstallmentCommandPage")
);
const EquipmentSalesWorkspacePage = lazy(() =>
  import("./pages/EquipmentSalesWorkspacePage")
);
const EquipmentSalesReportsPage = lazy(() =>
  import("./pages/EquipmentSalesReportsPage")
);
const EquipmentBusinessWorkforcePage = lazy(() =>
  import("./pages/EquipmentBusinessWorkforcePage")
);
const HireCommercialControlPage = lazy(() =>
  import("./pages/HireCommercialControlPage")
);
const NotificationCentrePage = lazy(() => import("./pages/NotificationCentrePage"));
const SharedReportsDocumentsPage = lazy(() =>
  import("./pages/SharedReportsDocumentsPage")
);
const FleetAssetsPage = lazy(() => import("./pages/FleetAssetsPage"));
const OperationsDocumentsAccountingPage = lazy(() =>
  import("./pages/OperationsDocumentsAccountingPage")
);
const GroupExecutiveControlPage = lazy(() =>
  import("./pages/GroupExecutiveControlPage")
);
const GroupConfigurationPage = lazy(() => import("./pages/GroupConfigurationPage"));
const Release2FinalControlPage = lazy(() => import("./pages/Release2FinalControlPage"));
const WorkspaceAdministrationPage = lazy(() =>
  import("./pages/WorkspaceAdministrationPage")
);
const EmploymentDocumentsPage = lazy(() => import("./pages/EmploymentDocumentsPage"));
const DocumentSignatureSettingsPage = lazy(() =>
  import("./pages/DocumentSignatureSettingsPage")
);
const PayrollProcessingCentrePage = lazy(() =>
  import("./pages/PayrollProcessingCentrePage")
);

const businessWorkRoles = ["admin", "manager", "cashier"];
const adminManagerRoles = ["admin", "manager"];
const auditReadRoles = ["admin", "manager", "auditor"];
const adminOnlyRoles = ["admin"];

const SPARE_PARTS_WORKSPACE = ["spare_parts"];
const MINING_WORKSPACE = ["mining"];
const EQUIPMENT_HIRE_WORKSPACE = ["equipment_hire"];
const ALL_WORKSPACES = ["spare_parts", "mining", "equipment_hire"];

function RouteLoadingFallback() {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        minHeight: "12rem",
        display: "grid",
        placeItems: "center",
        padding: "2rem",
        fontWeight: 700,
      }}
    >
      Loading workspace…
    </div>
  );
}

function SafePage({ children }) {
  return (
    <PageErrorBoundary>
      <Suspense fallback={<RouteLoadingFallback />}>{children}</Suspense>
    </PageErrorBoundary>
  );
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

  return <Navigate to="/staff" replace />;
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
            <Route path="staff" element={<SparePartsHomePage />} />

            <Route
              path="products"
              element={rolePage(businessWorkRoles, <ProductsPage />)}
            />
            <Route
              path="inventory-traceability"
              element={rolePage(adminManagerRoles, <InventoryTraceabilityPage />)}
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
              path="installments"
              element={permissionOnlyPage("installments.view", <InstallmentsPage />)}
            />
            <Route
              path="debts"
              element={rolePage(businessWorkRoles, <DebtsPage />)}
            />

            <Route path="change-password" element={safe(<ChangePasswordPage />)} />
            <Route path="help" element={safe(<HelpPage />)} />
            <Route
              path="notifications"
              element={permissionOnlyPage(
                "notifications.view",
                <NotificationCentrePage />
              )}
            />
            <Route
              path="shared-controls"
              element={permissionOnlyPage(
                "shared.control.view",
                <SharedReportsDocumentsPage />
              )}
            />

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
              path="user-permissions"
              element={permissionOnlyPage(
                "users.permissions.manage",
                <UserPermissionManagerPage />
              )}
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
              path="payroll"
              element={permissionOnlyPage(
                "payroll.view",
                <PayrollProcessingCentrePage />
              )}
            />
            <Route
              path="employment-documents"
              element={permissionOnlyPage(
                "workers.documents.view",
                <EmploymentDocumentsPage />
              )}
            />
            <Route
              path="document-signature-settings"
              element={permissionOnlyPage(
                "security.admin",
                <DocumentSignatureSettingsPage />
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
              path="control-centre"
              element={permissionPage(
                MINING_SECTION_PERMISSIONS.control,
                <MiningControlCentrePage />
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
              path="shared-controls"
              element={permissionPage(
                MINING_SECTION_PERMISSIONS.shared,
                <SharedReportsDocumentsPage />
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
              path="payroll"
              element={permissionOnlyPage(
                "payroll.view",
                <PayrollProcessingCentrePage />
              )}
            />
            <Route
              path="employment-documents"
              element={permissionOnlyPage(
                "workers.documents.view",
                <EmploymentDocumentsPage />
              )}
            />
            <Route
              path="document-signature-settings"
              element={permissionOnlyPage(
                "security.admin",
                <DocumentSignatureSettingsPage />
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
              path="notifications"
              element={permissionOnlyPage(
                "notifications.view",
                <NotificationCentrePage />
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

          {/* Equipment Hire is an operational division with its own sidebar. */}
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
              path="commercial-control"
              element={permissionPage(
                HIRE_SECTION_PERMISSIONS.commercial,
                <HireCommercialControlPage />
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
              path="shared-controls"
              element={permissionPage(
                HIRE_SECTION_PERMISSIONS.shared,
                <SharedReportsDocumentsPage />
              )}
            />
            <Route
              path="workforce"
              element={permissionOnlyPage(
                "workers.view",
                <EquipmentBusinessWorkforcePage />
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
              path="payroll"
              element={permissionOnlyPage(
                "payroll.view",
                <PayrollProcessingCentrePage />
              )}
            />
            <Route
              path="employment-documents"
              element={permissionOnlyPage(
                "workers.documents.view",
                <EmploymentDocumentsPage />
              )}
            />
            <Route
              path="document-signature-settings"
              element={permissionOnlyPage(
                "security.admin",
                <DocumentSignatureSettingsPage />
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
              path="notifications"
              element={permissionOnlyPage(
                "notifications.view",
                <NotificationCentrePage />
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

          {/* Installment Finance is a separate division using the same protected equipment data. */}
          <Route
            path="/equipment-installment-finance"
            element={
              <WorkspaceShell allowedWorkspaces={EQUIPMENT_HIRE_WORKSPACE}>
                <InstallmentFinanceLayout />
              </WorkspaceShell>
            }
          >
            <Route
              index
              element={permissionOnlyPage(
                "fleet.assets.view",
                <EquipmentInstallmentCommandPage />
              )}
            />
            <Route
              path="applications"
              element={permissionOnlyPage(
                "fleet.assets.view",
                <EquipmentSalesWorkspacePage />
              )}
            />
            <Route
              path="reports"
              element={permissionOnlyPage(
                "fleet.assets.view",
                <EquipmentSalesReportsPage />
              )}
            />
            <Route
              path="catalogue"
              element={permissionPage(HIRE_SECTION_PERMISSIONS.fleet, <FleetAssetsPage />)}
            />
            <Route
              path="customers"
              element={permissionPage(
                HIRE_SECTION_PERMISSIONS.customers,
                <EquipmentHireOperationsPage section="customers" />
              )}
            />
            <Route
              path="documents"
              element={permissionPage(
                HIRE_SECTION_PERMISSIONS.documents,
                <OperationsDocumentsAccountingPage workspaceScope="equipment_hire" />
              )}
            />
            <Route
              path="shared-controls"
              element={permissionPage(
                HIRE_SECTION_PERMISSIONS.shared,
                <SharedReportsDocumentsPage />
              )}
            />
            <Route
              path="workforce"
              element={permissionOnlyPage(
                "workers.view",
                <EquipmentBusinessWorkforcePage />
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
              path="payroll"
              element={permissionOnlyPage(
                "payroll.view",
                <PayrollProcessingCentrePage />
              )}
            />
            <Route
              path="employment-documents"
              element={permissionOnlyPage(
                "workers.documents.view",
                <EmploymentDocumentsPage />
              )}
            />
            <Route
              path="document-signature-settings"
              element={permissionOnlyPage(
                "security.admin",
                <DocumentSignatureSettingsPage />
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
              path="notifications"
              element={permissionOnlyPage(
                "notifications.view",
                <NotificationCentrePage />
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
                <PermissionRoute permissions={["executive.operations.view"]}>
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
            <Route
              path="notifications"
              element={permissionOnlyPage(
                "notifications.view",
                <NotificationCentrePage executiveMode />
              )}
            />
            <Route
              path="shared-controls"
              element={permissionOnlyPage(
                "shared.control.view",
                <SharedReportsDocumentsPage executiveMode />
              )}
            />
            <Route
              path="configuration"
              element={permissionOnlyPage(
                "security.admin",
                <GroupConfigurationPage />
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