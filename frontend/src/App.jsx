import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import RoleRoute from "./components/RoleRoute";
import Layout from "./components/Layout";
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

const adminManagerRoles = ["admin", "manager"];
const adminOnlyRoles = ["admin"];

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
            <Route index element={<DashboardPage />} />
            <Route path="products" element={<ProductsPage />} />
            <Route path="new-sale" element={<NewSalePage />} />
            <Route path="sales-history" element={<SalesHistoryPage />} />
            <Route path="debts" element={<DebtsPage />} />
            <Route path="change-password" element={<ChangePasswordPage />} />

            <Route
              path="customer-statement"
              element={
                <RoleRoute allowedRoles={adminManagerRoles}>
                  <CustomerStatementPage />
                </RoleRoute>
              }
            />

            <Route
              path="reports"
              element={
                <RoleRoute allowedRoles={adminManagerRoles}>
                  <ReportsPage />
                </RoleRoute>
              }
            />

            <Route
              path="low-stock"
              element={
                <RoleRoute allowedRoles={adminManagerRoles}>
                  <LowStockPage />
                </RoleRoute>
              }
            />

            <Route
              path="expenses"
              element={
                <RoleRoute allowedRoles={adminManagerRoles}>
                  <ExpensesPage />
                </RoleRoute>
              }
            />

            <Route
              path="purchases"
              element={
                <RoleRoute allowedRoles={adminManagerRoles}>
                  <PurchasesPage />
                </RoleRoute>
              }
            />

            <Route
              path="returns"
              element={
                <RoleRoute allowedRoles={adminManagerRoles}>
                  <ReturnsPage />
                </RoleRoute>
              }
            />

            <Route
              path="daily-closing"
              element={
                <RoleRoute allowedRoles={adminManagerRoles}>
                  <DailyClosingPage />
                </RoleRoute>
              }
            />

            <Route
              path="exports"
              element={
                <RoleRoute allowedRoles={adminManagerRoles}>
                  <ExportsPage />
                </RoleRoute>
              }
            />

            <Route
              path="users-settings"
              element={
                <RoleRoute allowedRoles={adminOnlyRoles}>
                  <UsersSettingsPage />
                </RoleRoute>
              }
            />

            <Route
              path="activity-log"
              element={
                <RoleRoute allowedRoles={adminOnlyRoles}>
                  <ActivityLogPage />
                </RoleRoute>
              }
            />

            <Route
              path="backup"
              element={
                <RoleRoute allowedRoles={adminOnlyRoles}>
                  <BackupPage />
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