import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import RoleRoute from "./components/RoleRoute";
import Layout from "./components/Layout";
import PageErrorBoundary from "./components/PageErrorBoundary";
import { useAuth } from "./context/AuthContext";

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

const businessWorkRoles = ["admin", "manager", "cashier"];
const adminManagerRoles = ["admin", "manager"];
const auditReadRoles = ["admin", "manager", "auditor"];
const adminOnlyRoles = ["admin"];

function SafePage({ children }) {
  return <PageErrorBoundary>{children}</PageErrorBoundary>;
}

function safe(page) {
  return <SafePage>{page}</SafePage>;
}

function businessWorkPage(page) {
  return <RoleRoute allowedRoles={businessWorkRoles}>{safe(page)}</RoleRoute>;
}

function adminManagerPage(page) {
  return <RoleRoute allowedRoles={adminManagerRoles}>{safe(page)}</RoleRoute>;
}

function auditReadPage(page) {
  return <RoleRoute allowedRoles={auditReadRoles}>{safe(page)}</RoleRoute>;
}

function adminOnlyPage(page) {
  return <RoleRoute allowedRoles={adminOnlyRoles}>{safe(page)}</RoleRoute>;
}

function HomePage() {
  const { user } = useAuth();
  const role = String(user?.role || "").toLowerCase();

  if (role === "auditor") {
    return <Navigate to="/audit-accounting" replace />;
  }

  return safe(<DashboardPage />);
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<HomePage />} />

            <Route path="products" element={businessWorkPage(<ProductsPage />)} />
            <Route path="new-sale" element={businessWorkPage(<NewSalePage />)} />
            <Route
              path="sales-history"
              element={businessWorkPage(<SalesHistoryPage />)}
            />
            <Route path="debts" element={businessWorkPage(<DebtsPage />)} />

            <Route
              path="change-password"
              element={safe(<ChangePasswordPage />)}
            />
            <Route path="help" element={safe(<HelpPage />)} />

            <Route
              path="customer-statement"
              element={auditReadPage(<CustomerStatementPage />)}
            />
            <Route path="reports" element={auditReadPage(<ReportsPage />)} />
            <Route
              path="audit-accounting"
              element={auditReadPage(<AuditAccountingPage />)}
            />
            <Route
              path="audit-signoffs"
              element={auditReadPage(<AuditSignoffHistoryPage />)}
            />
            <Route
              path="advanced-accounting-intelligence"
              element={auditReadPage(<AdvancedAccountingIntelligencePage />)}
            />
            <Route path="exports" element={auditReadPage(<ExportsPage />)} />

            <Route
              path="audit-unlock-requests"
              element={adminManagerPage(<AuditUnlockRequestsPage />)}
            />
            <Route path="low-stock" element={adminManagerPage(<LowStockPage />)} />
            <Route
              path="stock-transfers"
              element={adminManagerPage(<StockTransfersPage />)}
            />
            <Route path="expenses" element={adminManagerPage(<ExpensesPage />)} />
            <Route
              path="purchases"
              element={adminManagerPage(<PurchasesPage />)}
            />
            <Route path="returns" element={adminManagerPage(<ReturnsPage />)} />
            <Route
              path="daily-closing"
              element={adminManagerPage(<DailyClosingPage />)}
            />
            <Route path="sms" element={adminManagerPage(<SmsPage />)} />

            <Route
              path="users-settings"
              element={adminOnlyPage(<UsersSettingsPage />)}
            />
            <Route
              path="activity-log"
              element={adminOnlyPage(<ActivityLogPage />)}
            />
            <Route path="backup" element={adminOnlyPage(<BackupPage />)} />
            <Route
              path="backup-restore"
              element={<Navigate to="/backup" replace />}
            />
            <Route
              path="maintenance"
              element={adminOnlyPage(<MaintenancePage />)}
            />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
