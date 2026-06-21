import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const role = String(user?.role || "").toLowerCase();

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

        <nav className="nav-menu sidebar-scroll-area">
          <NavLink to="/" end>
            Dashboard
          </NavLink>

          <NavLink to="/products">Products</NavLink>
          <NavLink to="/new-sale">New Sale</NavLink>
          <NavLink to="/sales-history">Sales History</NavLink>
          <NavLink to="/debts">Debts</NavLink>

          {(role === "admin" || role === "manager") && (
            <>
              <NavLink to="/customer-statement">Customer Statement</NavLink>
              <NavLink to="/reports">Reports</NavLink>
              <NavLink to="/low-stock">Low Stock / Restock</NavLink>
              <NavLink to="/expenses">Expenses</NavLink>
              <NavLink to="/purchases">Purchases</NavLink>
              <NavLink to="/returns">Returns</NavLink>
              <NavLink to="/daily-closing">Daily Closing</NavLink>
              <NavLink to="/exports">Exports</NavLink>
            </>
          )}

          {role === "admin" && (
            <>
              <NavLink to="/users-settings">Users & Settings</NavLink>
              <NavLink to="/activity-log">Activity Log</NavLink>
              <NavLink to="/backup">Backup & Restore</NavLink>
            </>
          )}
        </nav>

        <div className="sidebar-user">
          <p>{user?.full_name}</p>
          <span>{user?.role}</span>
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