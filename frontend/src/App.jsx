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

const adminManagerRoles = ["admin", "manager"];
const adminOnlyRoles = ["admin"];

function SafePage({ children }) {
  return <PageErrorBoundary>{children}</PageErrorBoundary>;
}

function safe(page) {
  return <SafePage>{page}</SafePage>;
}

function adminManagerPage(page) {
  return <RoleRoute allowedRoles={adminManagerRoles}>{safe(page)}</RoleRoute>;
}

function adminOnlyPage(page) {
  return <RoleRoute allowedRoles={adminOnlyRoles}>{safe(page)}</RoleRoute>;
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
            <Route index element={safe(<DashboardPage />)} />

            <Route path="products" element={safe(<ProductsPage />)} />
            <Route path="new-sale" element={safe(<NewSalePage />)} />
            <Route path="sales-history" element={safe(<SalesHistoryPage />)} />
            <Route path="debts" element={safe(<DebtsPage />)} />
            <Route
              path="change-password"
              element={safe(<ChangePasswordPage />)}
            />
            <Route path="help" element={safe(<HelpPage />)} />

            <Route
              path="customer-statement"
              element={adminManagerPage(<CustomerStatementPage />)}
            />
            <Route
              path="reports"
              element={adminManagerPage(<ReportsPage />)}
            />
            <Route
              path="audit-accounting"
              element={adminManagerPage(<AuditAccountingPage />)}
            />
            <Route
              path="audit-signoffs"
              element={adminManagerPage(<AuditSignoffHistoryPage />)}
            />
            <Route
              path="audit-unlock-requests"
              element={adminManagerPage(<AuditUnlockRequestsPage />)}
            />
            <Route
              path="low-stock"
              element={adminManagerPage(<LowStockPage />)}
            />
            <Route
              path="expenses"
              element={adminManagerPage(<ExpensesPage />)}
            />
            <Route
              path="purchases"
              element={adminManagerPage(<PurchasesPage />)}
            />
            <Route
              path="returns"
              element={adminManagerPage(<ReturnsPage />)}
            />
            <Route
              path="daily-closing"
              element={adminManagerPage(<DailyClosingPage />)}
            />
            <Route
              path="exports"
              element={adminManagerPage(<ExportsPage />)}
            />

            <Route
              path="users-settings"
              element={adminOnlyPage(<UsersSettingsPage />)}
            />
            <Route
              path="activity-log"
              element={adminOnlyPage(<ActivityLogPage />)}
            />
            <Route
              path="/sms"
              element={
               <ProtectedRoute>
                <SmsPage />
                </ProtectedRoute>
              }
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
