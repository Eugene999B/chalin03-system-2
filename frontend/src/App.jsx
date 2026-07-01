import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import RoleRoute from "./components/RoleRoute";
import Layout from "./components/Layout";
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
import DailyClosingPage from "./pages/DailyClosingPage";
import LowStockPage from "./pages/LowStockPage";
import CustomerStatementPage from "./pages/CustomerStatementPage";
import ChangePasswordPage from "./pages/ChangePasswordPage";
import MaintenancePage from "./pages/MaintenancePage";
import HelpPage from "./pages/HelpPage";
import AuditAccountingPage from "./pages/AuditAccountingPage";
import AuditSignoffHistoryPage from "./pages/AuditSignoffHistoryPage";

const adminManagerRoles = ["admin", "manager"];
const adminOnlyRoles = ["admin"];

function SafePage({ children }) {
  return <PageErrorBoundary>{children}</PageErrorBoundary>;
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
            <Route index element={<SafePage><DashboardPage /></SafePage>} />
            <Route path="products" element={<SafePage><ProductsPage /></SafePage>} />
            <Route path="new-sale" element={<SafePage><NewSalePage /></SafePage>} />
            <Route path="sales-history" element={<SafePage><SalesHistoryPage /></SafePage>} />
            <Route path="debts" element={<SafePage><DebtsPage /></SafePage>} />
            <Route path="change-password" element={<SafePage><ChangePasswordPage /></SafePage>} />
            <Route path="help" element={<SafePage><HelpPage /></SafePage>} />

            <Route
              path="customer-statement"
              element={
                <RoleRoute allowedRoles={adminManagerRoles}>
                  <SafePage><CustomerStatementPage /></SafePage>
                </RoleRoute>
              }
            />

            <Route
              path="reports"
              element={
                <RoleRoute allowedRoles={adminManagerRoles}>
                  <SafePage><ReportsPage /></SafePage>
                </RoleRoute>
              }
            />

            <Route
              path="audit-accounting"
              element={
                <RoleRoute allowedRoles={adminManagerRoles}>
                  <SafePage><AuditAccountingPage /></SafePage>
                </RoleRoute>
              }
            />

            <Route
              path="audit-signoffs"
              element={
                <RoleRoute allowedRoles={adminManagerRoles}>
                  <SafePage><AuditSignoffHistoryPage /></SafePage>
                </RoleRoute>
              }
            />

            <Route
              path="low-stock"
              element={
                <RoleRoute allowedRoles={adminManagerRoles}>
                  <SafePage><LowStockPage /></SafePage>
                </RoleRoute>
              }
            />

            <Route
              path="expenses"
              element={
                <RoleRoute allowedRoles={adminManagerRoles}>
                  <SafePage><ExpensesPage /></SafePage>
                </RoleRoute>
              }
            />

            <Route
              path="purchases"
              element={
                <RoleRoute allowedRoles={adminManagerRoles}>
                  <SafePage><PurchasesPage /></SafePage>
                </RoleRoute>
              }
            />

            <Route
              path="returns"
              element={
                <RoleRoute allowedRoles={adminManagerRoles}>
                  <SafePage><ReturnsPage /></SafePage>
                </RoleRoute>
              }
            />

            <Route
              path="daily-closing"
              element={
                <RoleRoute allowedRoles={adminManagerRoles}>
                  <SafePage><DailyClosingPage /></SafePage>
                </RoleRoute>
              }
            />

            <Route
              path="exports"
              element={
                <RoleRoute allowedRoles={adminManagerRoles}>
                  <SafePage><ExportsPage /></SafePage>
                </RoleRoute>
              }
            />

            <Route
              path="users-settings"
              element={
                <RoleRoute allowedRoles={adminOnlyRoles}>
                  <SafePage><UsersSettingsPage /></SafePage>
                </RoleRoute>
              }
            />

            <Route
              path="activity-log"
              element={
                <RoleRoute allowedRoles={adminOnlyRoles}>
                  <SafePage><ActivityLogPage /></SafePage>
                </RoleRoute>
              }
            />

            <Route
              path="backup"
              element={
                <RoleRoute allowedRoles={adminOnlyRoles}>
                  <SafePage><BackupPage /></SafePage>
                </RoleRoute>
              }
            />

            <Route
              path="maintenance"
              element={
                <RoleRoute allowedRoles={adminOnlyRoles}>
                  <SafePage><MaintenancePage /></SafePage>
                </RoleRoute>
              }
            />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
