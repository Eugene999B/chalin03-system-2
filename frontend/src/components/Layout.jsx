import InstallAppButton from "./InstallAppButton";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [isMobile, setIsMobile] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const role = String(user?.role || "").toLowerCase();
  const canManage = role === "admin" || role === "manager";
  const isAdmin = role === "admin";

  const isSystemAdministrator =
    Number(user?.id) === 1 &&
    String(user?.username || "").toLowerCase() === "admin" &&
    role === "admin";

  useEffect(() => {
    function checkScreenSize() {
      const mobile = window.innerWidth <= 900;
      setIsMobile(mobile);

      if (!mobile) {
        setMenuOpen(false);
      }
    }

    checkScreenSize();
    window.addEventListener("resize", checkScreenSize);

    return () => {
      window.removeEventListener("resize", checkScreenSize);
    };
  }, []);

  useEffect(() => {
    if (isMobile && menuOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }

    return () => {
      document.body.style.overflow = "";
    };
  }, [isMobile, menuOpen]);

  function handleLogout() {
    logout();
    navigate("/login");
  }

  function closeMobileMenu() {
    if (isMobile) {
      setMenuOpen(false);
    }
  }

  function goToChangePassword() {
    closeMobileMenu();
    navigate("/change-password");
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

  const sidebarStyle = {
    width: isMobile ? "100vw" : "270px",
    height: "100vh",
    height: "100dvh",
    background: "#07182c",
    color: "#ffffff",
    display: "grid",
    gridTemplateRows: "auto minmax(0, 1fr) auto",
    overflow: "hidden",
    flexShrink: 0,
    zIndex: 1000,
    transition: "transform 0.25s ease",
    ...(isMobile
      ? {
          position: "fixed",
          top: 0,
          left: 0,
          transform: menuOpen ? "translateX(0)" : "translateX(-100%)",
        }
      : {
          position: "relative",
          transform: "translateX(0)",
        }),
  };

  return (
    <div
      style={{
        width: "100%",
        height: "100vh",
        height: "100dvh",
        display: "flex",
        overflow: "hidden",
        background: "#f4f7fb",
      }}
    >
      {isMobile && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            height: "60px",
            background: "#07182c",
            color: "#ffffff",
            zIndex: 900,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 14px",
            boxShadow: "0 8px 20px rgba(0,0,0,0.18)",
          }}
        >
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            style={{
              border: "none",
              borderRadius: "8px",
              background: "#164777",
              color: "#ffffff",
              padding: "9px 12px",
              fontWeight: "900",
              cursor: "pointer",
            }}
          >
            Menu
          </button>

          <strong>Chalin 03</strong>

          <button
            type="button"
            onClick={handleLogout}
            style={{
              border: "none",
              borderRadius: "8px",
              background: "#c3261d",
              color: "#ffffff",
              padding: "9px 12px",
              fontWeight: "900",
              cursor: "pointer",
            }}
          >
            Logout
          </button>
        </div>
      )}

      <aside style={sidebarStyle}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            padding: "18px",
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

          {isMobile && (
            <button
              type="button"
              onClick={() => setMenuOpen(false)}
              style={{
                marginLeft: "auto",
                border: "none",
                borderRadius: "8px",
                background: "rgba(255,255,255,0.12)",
                color: "#ffffff",
                padding: "9px 12px",
                fontWeight: "900",
                cursor: "pointer",
              }}
            >
              Close
            </button>
          )}
        </div>

        <div
          style={{
            minHeight: 0,
            overflowY: "auto",
            overflowX: "hidden",
            padding: "14px 16px",
          }}
        >
          <nav style={{ display: "block", width: "100%" }}>
            <p style={sectionTitleStyle}>Main</p>

            <NavLink to="/" end style={linkStyle} onClick={closeMobileMenu}>
              Dashboard
            </NavLink>

            <NavLink to="/products" style={linkStyle} onClick={closeMobileMenu}>
              Products
            </NavLink>

            <NavLink to="/new-sale" style={linkStyle} onClick={closeMobileMenu}>
              New Sale
            </NavLink>

            <NavLink
              to="/sales-history"
              style={linkStyle}
              onClick={closeMobileMenu}
            >
              Sales History
            </NavLink>

            <NavLink to="/debts" style={linkStyle} onClick={closeMobileMenu}>
              Debts
            </NavLink>

            <NavLink
              to="/change-password"
              style={linkStyle}
              onClick={closeMobileMenu}
            >
              Change Password
            </NavLink>

            {canManage && (
              <>
                <p style={sectionTitleStyle}>Management</p>

                <NavLink
                  to="/customer-statement"
                  style={linkStyle}
                  onClick={closeMobileMenu}
                >
                  Customer Statement
                </NavLink>

                <NavLink
                  to="/reports"
                  style={linkStyle}
                  onClick={closeMobileMenu}
                >
                  Reports
                </NavLink>

                <NavLink
                  to="/low-stock"
                  style={linkStyle}
                  onClick={closeMobileMenu}
                >
                  Low Stock / Restock
                </NavLink>

                <NavLink
                  to="/expenses"
                  style={linkStyle}
                  onClick={closeMobileMenu}
                >
                  Expenses
                </NavLink>

                <NavLink
                  to="/purchases"
                  style={linkStyle}
                  onClick={closeMobileMenu}
                >
                  Purchases
                </NavLink>

                <NavLink
                  to="/returns"
                  style={linkStyle}
                  onClick={closeMobileMenu}
                >
                  Returns
                </NavLink>

                <NavLink
                  to="/daily-closing"
                  style={linkStyle}
                  onClick={closeMobileMenu}
                >
                  Daily Closing
                </NavLink>

                <NavLink
                  to="/exports"
                  style={linkStyle}
                  onClick={closeMobileMenu}
                >
                  Exports
                </NavLink>
              </>
            )}

            {isAdmin && (
              <>
                <p style={sectionTitleStyle}>Admin</p>

                <NavLink
                  to="/users-settings"
                  style={linkStyle}
                  onClick={closeMobileMenu}
                >
                  Users & Settings
                </NavLink>

                <NavLink
                  to="/activity-log"
                  style={linkStyle}
                  onClick={closeMobileMenu}
                >
                  Activity Log
                </NavLink>

                <NavLink
                  to="/backup"
                  style={linkStyle}
                  onClick={closeMobileMenu}
                >
                  Backup & Restore
                </NavLink>

                {isSystemAdministrator && (
                  <NavLink
                    to="/maintenance"
                    style={linkStyle}
                    onClick={closeMobileMenu}
                  >
                    System Maintenance
                  </NavLink>
                )}
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


          <InstallAppButton />

          <button
            type="button"
            onClick={goToChangePassword}
            style={{
              width: "100%",
              border: "none",
              borderRadius: "9px",
              padding: "11px 12px",
              background: "#164777",
              color: "#ffffff",
              fontWeight: "900",
              cursor: "pointer",
              marginBottom: "10px",
            }}
          >
            Change Password
          </button>

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
          width: "100%",
          height: "100vh",
          height: "100dvh",
          overflowY: "auto",
          overflowX: "auto",
          padding: isMobile ? "82px 14px 24px" : "32px",
        }}
      >
        <Outlet />
      </main>
    </div>
  );
}