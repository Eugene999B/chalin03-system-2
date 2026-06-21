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

  const linkStyle = ({ isActive }) => ({
    display: "block",
    width: "100%",
    boxSizing: "border-box",
    padding: "11px 13px",
    marginBottom: "6px",
    borderRadius: "10px",
    color: "#ffffff",
    textDecoration: "none",
    fontWeight: "800",
    fontSize: "15px",
    lineHeight: "1.25",
    background: isActive ? "#164777" : "transparent",
  });

  const sectionTitleStyle = {
    display: "block",
    margin: "16px 8px 8px",
    fontSize: "11px",
    fontWeight: "900",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "rgba(255, 255, 255, 0.5)",
  };

  return (
    <div
      style={{
        width: "100%",
        height: "100vh",
        display: "flex",
        overflow: "hidden",
        background: "#f4f7fb",
      }}
    >
      <aside
        style={{
          width: "270px",
          height: "100vh",
          background: "#07182c",
          color: "#ffffff",
          display: "grid",
          gridTemplateRows: "auto minmax(0, 1fr) auto",
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            padding: "22px",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <div
            style={{
              width: "52px",
              height: "52px",
              borderRadius: "13px",
              background: "#e0ba28",
              color: "#06172b",
              display: "grid",
              placeItems: "center",
              fontWeight: "900",
              fontSize: "22px",
              flexShrink: 0,
            }}
          >
            C3
          </div>

          <div>
            <h2 style={{ margin: 0, fontSize: "22px", lineHeight: 1.1 }}>
              Chalin 03
            </h2>
            <p
              style={{
                margin: "4px 0 0",
                color: "rgba(255,255,255,0.72)",
                fontSize: "13px",
              }}
            >
              Sales & Inventory
            </p>
          </div>
        </div>

        <div
          style={{
            minHeight: 0,
            overflowY: "auto",
            overflowX: "hidden",
            padding: "14px 16px",
          }}
        >
          <nav
            style={{
              display: "block",
              width: "100%",
            }}
          >
            <p style={sectionTitleStyle}>Main</p>

            <NavLink to="/" end style={linkStyle}>
              Dashboard
            </NavLink>
            <NavLink to="/products" style={linkStyle}>
              Products
            </NavLink>
            <NavLink to="/new-sale" style={linkStyle}>
              New Sale
            </NavLink>
            <NavLink to="/sales-history" style={linkStyle}>
              Sales History
            </NavLink>
            <NavLink to="/debts" style={linkStyle}>
              Debts
            </NavLink>

            {canManage && (
              <>
                <p style={sectionTitleStyle}>Management</p>

                <NavLink to="/customer-statement" style={linkStyle}>
                  Customer Statement
                </NavLink>
                <NavLink to="/reports" style={linkStyle}>
                  Reports
                </NavLink>
                <NavLink to="/low-stock" style={linkStyle}>
                  Low Stock / Restock
                </NavLink>
                <NavLink to="/expenses" style={linkStyle}>
                  Expenses
                </NavLink>
                <NavLink to="/purchases" style={linkStyle}>
                  Purchases
                </NavLink>
                <NavLink to="/returns" style={linkStyle}>
                  Returns
                </NavLink>
                <NavLink to="/daily-closing" style={linkStyle}>
                  Daily Closing
                </NavLink>
                <NavLink to="/exports" style={linkStyle}>
                  Exports
                </NavLink>
              </>
            )}

            {isAdmin && (
              <>
                <p style={sectionTitleStyle}>Admin</p>

                <NavLink to="/users-settings" style={linkStyle}>
                  Users & Settings
                </NavLink>
                <NavLink to="/activity-log" style={linkStyle}>
                  Activity Log
                </NavLink>
                <NavLink to="/backup" style={linkStyle}>
                  Backup & Restore
                </NavLink>
              </>
            )}
          </nav>
        </div>

        <div
          style={{
            padding: "14px 18px 18px",
            background: "#07182c",
            borderTop: "1px solid rgba(255,255,255,0.12)",
          }}
        >
          <p style={{ margin: 0, fontWeight: "900", color: "#ffffff" }}>
            {user?.full_name || "User"}
          </p>

          <span
            style={{
              display: "block",
              marginTop: "4px",
              marginBottom: "10px",
              fontSize: "13px",
              color: "rgba(255,255,255,0.65)",
              textTransform: "uppercase",
              fontWeight: "900",
            }}
          >
            {user?.role || "role"}
          </span>

          <button
            type="button"
            onClick={handleLogout}
            style={{
              width: "100%",
              border: "none",
              borderRadius: "9px",
              padding: "11px 12px",
              background: "#c3261d",
              color: "#ffffff",
              fontWeight: "900",
              cursor: "pointer",
            }}
          >
            Logout
          </button>
        </div>
      </aside>

      <main
        style={{
          flex: 1,
          minWidth: 0,
          height: "100vh",
          overflowY: "auto",
          padding: "32px",
        }}
      >
        <Outlet />
      </main>
    </div>
  );
}