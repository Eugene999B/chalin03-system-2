import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const role = String(user?.role || "").toLowerCase();
  const canManage = role === "admin" || role === "manager";
  const isAdmin = role === "admin";

  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo">C3</div>
          <div>
            <h2>Chalin 03</h2>
            <p>Sales & Inventory</p>
          </div>
        </div>

        <div className="sidebar-menu-wrapper">
          <nav className="nav-menu">
            <div className="nav-section">
              <p className="nav-section-title">Main</p>

              <NavLink to="/" end>
                Dashboard
              </NavLink>

              <NavLink to="/products">Products</NavLink>
              <NavLink to="/new-sale">New Sale</NavLink>
              <NavLink to="/sales-history">Sales History</NavLink>
              <NavLink to="/debts">Debts</NavLink>
            </div>

            {canManage && (
              <div className="nav-section">
                <p className="nav-section-title">Management</p>

                <NavLink to="/customer-statement">Customer Statement</NavLink>
                <NavLink to="/reports">Reports</NavLink>
                <NavLink to="/low-stock">Low Stock / Restock</NavLink>
                <NavLink to="/expenses">Expenses</NavLink>
                <NavLink to="/purchases">Purchases</NavLink>
                <NavLink to="/returns">Returns</NavLink>
                <NavLink to="/daily-closing">Daily Closing</NavLink>
                <NavLink to="/exports">Exports</NavLink>
              </div>
            )}

            {isAdmin && (
              <div className="nav-section">
                <p className="nav-section-title">Admin</p>

                <NavLink to="/users-settings">Users & Settings</NavLink>
                <NavLink to="/activity-log">Activity Log</NavLink>
                <NavLink to="/backup">Backup & Restore</NavLink>
              </div>
            )}
          </nav>
        </div>

        <div className="sidebar-user">
          <p>{user?.full_name || "User"}</p>
          <span>{user?.role || "role"}</span>
          <button type="button" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </aside>

      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}