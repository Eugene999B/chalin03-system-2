import InstallAppButton from "./InstallAppButton";
import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [isMobile, setIsMobile] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");

  const role = String(user?.role || "").toLowerCase();
  const canManage = role === "admin" || role === "manager";
  const isAdmin = role === "admin";

  const isSystemAdministrator =
    Number(user?.id) === 1 &&
    String(user?.username || "").toLowerCase() === "admin" &&
    role === "admin";

  const displayName = user?.full_name || user?.username || "User";

  const commandItems = useMemo(() => {
    const items = [
      {
        title: "Dashboard",
        description: "Open business command center",
        path: "/",
        icon: "🏠",
        keywords: "home dashboard business command center overview boss",
        group: "Main",
      },
      {
        title: "Products",
        description: "Add, edit and manage spare parts stock",
        path: "/products",
        icon: "📦",
        keywords:
          "products inventory stock spare parts excavator type barcode quantity",
        group: "Main",
      },
      {
        title: "New Sale",
        description: "Record a new cash, MoMo, bank, mixed or credit sale",
        path: "/new-sale",
        icon: "🛒",
        keywords: "sale sell receipt customer payment cash momo bank credit",
        group: "Main",
      },
      {
        title: "Sales History",
        description: "View previous sales and receipts",
        path: "/sales-history",
        icon: "🧾",
        keywords: "sales history receipt transaction old sale previous",
        group: "Main",
      },
      {
        title: "Debts",
        description: "Track debts and send WhatsApp reminders",
        path: "/debts",
        icon: "📞",
        keywords: "debt debts credit balance payment reminder whatsapp owing",
        group: "Main",
      },
      {
        title: "Change Password",
        description: "Update your login password",
        path: "/change-password",
        icon: "🔐",
        keywords: "password security change login",
        group: "Account",
      },
      {
        title: "Help / User Guide",
        description: "Open system usage guide",
        path: "/help",
        icon: "📘",
        keywords: "help guide manual learn support instructions",
        group: "Account",
      },
    ];

    if (canManage) {
      items.push(
        {
          title: "Customer Statement",
          description: "Check customer sales and debt records",
          path: "/customer-statement",
          icon: "👤",
          keywords: "customer statement account balance records history",
          group: "Management",
        },
        {
          title: "Reports",
          description: "View business reports and performance",
          path: "/reports",
          icon: "📊",
          keywords: "reports analytics sales profit business performance",
          group: "Management",
        },
        {
          title: "Audit & Accounting",
          description: "Review sales, cash, debts, expenses and audit warnings",
          path: "/audit-accounting",
          icon: "🧮",
          keywords:
            "audit accounting accountant auditor review cash sales expenses debts fuel discounts warnings",
          group: "Management",
        },
        {
          title: "Audit Sign-Off History",
          description: "View approved periods and saved audit sign-off records",
          path: "/audit-signoffs",
          icon: "✅",
          keywords:
            "audit signoff sign-off approval history approved period accountant auditor certificate prepared reviewed approved boss management",
          group: "Management",
        },
        {
          title: "Audit Unlock Requests",
          description: "View and manage audit unlock requests",
          path: "/audit-unlock-requests",
          icon: "🔓",
          keywords: "audit unlock requests approval management",
          group: "Management",
        },
        {
          title: "Low Stock / Restock",
          description: "View items that need restocking",
          path: "/low-stock",
          icon: "🚨",
          keywords: "low stock restock reorder shortage products inventory",
          group: "Management",
        },
        {
          title: "Expenses",
          description: "Record fuel, transport, rent, salary and other costs",
          path: "/expenses",
          icon: "⛽",
          keywords: "expenses fuel transport rent salary internet repairs cost",
          group: "Management",
        },
        {
          title: "Purchases",
          description: "Record stock purchases and supplier transactions",
          path: "/purchases",
          icon: "🚚",
          keywords: "purchases suppliers stock buying purchase payment",
          group: "Management",
        },
        {
          title: "Returns",
          description: "Record returned items",
          path: "/returns",
          icon: "↩️",
          keywords: "returns returned items refund exchange",
          group: "Management",
        },
        {
          title: "Daily Closing",
          description: "Close the day and check cash movement",
          path: "/daily-closing",
          icon: "🌙",
          keywords: "daily closing close day cash sales summary",
          group: "Management",
        },
        {
          title: "Exports",
          description: "Export business data",
          path: "/exports",
          icon: "📤",
          keywords: "exports excel download data report backup",
          group: "Management",
        }
      );
    }

    if (isAdmin) {
      items.push(
        {
          title: "Users & Settings",
          description: "Manage users, roles and business settings",
          path: "/users-settings",
          icon: "⚙️",
          keywords: "users settings roles admin cashier manager reset password",
          group: "Admin",
        },
        {
          title: "Activity Log",
          description: "Review staff and system activities",
          path: "/activity-log",
          icon: "🕵️",
          keywords: "activity log audit staff actions security",
          group: "Admin",
        },
        {
          title: "Backup & Restore",
          description: "Manage system backup and restore options",
          path: "/backup",
          icon: "💾",
          keywords: "backup restore database data safety",
          group: "Admin",
        }
      );
    }

    if (isSystemAdministrator) {
      items.push({
        title: "System Maintenance",
        description: "Clear test data and maintain the system",
        path: "/maintenance",
        icon: "🧰",
        keywords: "maintenance clear test data reset system administrator",
        group: "Admin",
      });
    }

    return items;
  }, [canManage, isAdmin, isSystemAdministrator]);

  const filteredCommandItems = useMemo(() => {
    const query = commandQuery.trim().toLowerCase();

    if (!query) {
      return commandItems;
    }

    return commandItems.filter((item) => {
      const searchableText = [
        item.title,
        item.description,
        item.keywords,
        item.group,
      ]
        .join(" ")
        .toLowerCase();

      return searchableText.includes(query);
    });
  }, [commandItems, commandQuery]);

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
    if ((isMobile && menuOpen) || commandOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }

    return () => {
      document.body.style.overflow = "";
    };
  }, [isMobile, menuOpen, commandOpen]);

  useEffect(() => {
    function handleKeyboard(event) {
      const isCommandShortcut = event.ctrlKey || event.metaKey;

      if (isCommandShortcut && String(event.key).toLowerCase() === "k") {
        event.preventDefault();
        openCommandCenter();
      }

      if (event.key === "Escape") {
        closeCommandCenter();
      }
    }

    window.addEventListener("keydown", handleKeyboard);

    return () => {
      window.removeEventListener("keydown", handleKeyboard);
    };
  }, []);

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

  function openCommandCenter() {
    setCommandOpen(true);
    setCommandQuery("");
    closeMobileMenu();
  }

  function closeCommandCenter() {
    setCommandOpen(false);
    setCommandQuery("");
  }

  function runCommand(path) {
    closeCommandCenter();
    closeMobileMenu();
    navigate(path);
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
    gridTemplateRows: "auto auto minmax(0, 1fr) auto",
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
            display: "grid",
            gridTemplateColumns: "auto minmax(0, 1fr) auto",
            alignItems: "center",
            gap: "8px",
            padding: "0 10px",
            boxShadow: "0 8px 20px rgba(0,0,0,0.18)",
          }}
        >
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            style={{
              border: "none",
              borderRadius: "9px",
              background: "#164777",
              color: "#ffffff",
              padding: "9px 10px",
              fontWeight: "900",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            Menu
          </button>

          <button
            type="button"
            onClick={openCommandCenter}
            style={{
              minWidth: 0,
              border: "1px solid rgba(224, 186, 40, 0.5)",
              borderRadius: "11px",
              background:
                "linear-gradient(135deg, rgba(22,71,119,0.9), rgba(7,24,44,0.9))",
              color: "#ffffff",
              padding: "8px 9px",
              fontWeight: "900",
              cursor: "pointer",
              textAlign: "left",
              overflow: "hidden",
              boxShadow: "0 6px 14px rgba(0,0,0,0.16)",
            }}
          >
            <span
              style={{
                display: "block",
                fontSize: "13px",
                lineHeight: 1.1,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              🔎 Smart Search
            </span>

            <small
              style={{
                display: "block",
                marginTop: "2px",
                color: "rgba(255,255,255,0.68)",
                fontSize: "10px",
                lineHeight: 1,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              Find pages fast
            </small>
          </button>

          <button
            type="button"
            onClick={handleLogout}
            style={{
              border: "none",
              borderRadius: "9px",
              background: "#c3261d",
              color: "#ffffff",
              padding: "9px 10px",
              fontWeight: "900",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            Out
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
            minWidth: 0,
          }}
        >
          <img
            src="/chalin03-logo.png"
            alt="Chalin 03 Logo"
            style={{
              width: "56px",
              height: "56px",
              borderRadius: "14px",
              objectFit: "cover",
              background: "#07182c",
              flexShrink: 0,
            }}
          />

          <div style={{ minWidth: 0 }}>
            <h2
              style={{
                margin: 0,
                fontSize: "22px",
                lineHeight: 1.1,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              Chalin 03
            </h2>
            <p
              style={{
                margin: "4px 0 0",
                color: "rgba(255,255,255,0.72)",
                fontSize: "13px",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
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
                flexShrink: 0,
              }}
            >
              Close
            </button>
          )}
        </div>

        <div
          style={{
            padding: "12px 14px",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <button
            type="button"
            onClick={openCommandCenter}
            style={{
              width: "100%",
              border: "1px solid rgba(224, 186, 40, 0.5)",
              borderRadius: "14px",
              background:
                "linear-gradient(135deg, rgba(22,71,119,0.95), rgba(7,24,44,0.95))",
              color: "#ffffff",
              padding: "12px",
              cursor: "pointer",
              textAlign: "left",
              boxShadow: "0 10px 24px rgba(0,0,0,0.18)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: !isMobile
                  ? "34px minmax(0, 1fr) auto"
                  : "34px minmax(0, 1fr)",
                gap: "10px",
                alignItems: "center",
                minWidth: 0,
              }}
            >
              <span
                style={{
                  width: "34px",
                  height: "34px",
                  borderRadius: "11px",
                  display: "grid",
                  placeItems: "center",
                  background: "rgba(224,186,40,0.18)",
                  flexShrink: 0,
                  fontSize: "18px",
                }}
              >
                🔎
              </span>

              <span style={{ minWidth: 0 }}>
                <strong
                  style={{
                    display: "block",
                    fontSize: "14px",
                    lineHeight: 1.2,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  Smart Command
                </strong>

                <small
                  style={{
                    display: "block",
                    marginTop: "3px",
                    color: "rgba(255,255,255,0.68)",
                    fontWeight: "700",
                    fontSize: "11px",
                    lineHeight: 1.2,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  Search pages fast
                </small>
              </span>

              {!isMobile && (
                <span
                  style={{
                    border: "1px solid rgba(255,255,255,0.22)",
                    borderRadius: "8px",
                    padding: "4px 6px",
                    color: "rgba(255,255,255,0.8)",
                    fontSize: "10px",
                    fontWeight: "950",
                    flexShrink: 0,
                    lineHeight: 1,
                  }}
                >
                  Ctrl K
                </span>
              )}
            </div>
          </button>
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

            <NavLink to="/help" style={linkStyle} onClick={closeMobileMenu}>
              Help / User Guide
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
                  to="/audit-accounting"
                  style={linkStyle}
                  onClick={closeMobileMenu}
                >
                  Audit & Accounting
                </NavLink>

                <NavLink
                  to="/audit-signoffs"
                  style={linkStyle}
                  onClick={closeMobileMenu}
                >
                  Audit Sign-Off History
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

                <NavLink
                  to="/audit-unlock-requests"
                  style={linkStyle}
                  onClick={closeMobileMenu}
                >
                  Audit Unlock Requests
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
            {displayName}
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

      {commandOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 3000,
            background: "rgba(7, 24, 44, 0.72)",
            backdropFilter: "blur(8px)",
            display: "grid",
            placeItems: isMobile ? "start center" : "center",
            padding: isMobile ? "78px 14px 20px" : "24px",
          }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeCommandCenter();
            }
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "760px",
              maxHeight: isMobile ? "calc(100dvh - 100px)" : "82vh",
              background: "#ffffff",
              borderRadius: isMobile ? "20px" : "26px",
              boxShadow: "0 30px 90px rgba(0,0,0,0.35)",
              overflow: "hidden",
              display: "grid",
              gridTemplateRows: "auto auto minmax(0, 1fr)",
            }}
          >
            <div
              style={{
                padding: isMobile ? "16px" : "20px",
                background:
                  "linear-gradient(135deg, #07182c 0%, #0d2f55 60%, #111827 100%)",
                color: "#ffffff",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) auto",
                  gap: "12px",
                  alignItems: "start",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <p
                    style={{
                      margin: 0,
                      color: "#e0ba28",
                      fontSize: "12px",
                      fontWeight: "950",
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                    }}
                  >
                    Smart Navigation
                  </p>

                  <h2
                    style={{
                      margin: "5px 0 0",
                      fontSize: isMobile ? "22px" : "28px",
                      fontWeight: "950",
                      lineHeight: 1.1,
                    }}
                  >
                    Smart Command Center
                  </h2>

                  <p
                    style={{
                      margin: "8px 0 0",
                      color: "rgba(255,255,255,0.75)",
                      lineHeight: 1.5,
                      fontSize: "14px",
                    }}
                  >
                    Search any page and jump there quickly. On desktop, press
                    Ctrl + K anytime.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={closeCommandCenter}
                  style={{
                    border: "none",
                    borderRadius: "11px",
                    background: "rgba(255,255,255,0.12)",
                    color: "#ffffff",
                    padding: "10px 12px",
                    cursor: "pointer",
                    fontWeight: "950",
                    flexShrink: 0,
                  }}
                >
                  ✕
                </button>
              </div>
            </div>

            <div
              style={{
                padding: isMobile ? "14px" : "16px",
                borderBottom: "1px solid #e2e8f0",
                background: "#f8fafc",
              }}
            >
              <input
                autoFocus
                value={commandQuery}
                onChange={(event) => setCommandQuery(event.target.value)}
                placeholder="Type sale, product, debt, expense, audit, report..."
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  border: "2px solid #dbe3ef",
                  borderRadius: "16px",
                  padding: "14px 16px",
                  fontSize: "16px",
                  fontWeight: "800",
                  outline: "none",
                  background: "#ffffff",
                  color: "#07182c",
                }}
              />

              <div
                style={{
                  display: "flex",
                  gap: "8px",
                  flexWrap: "wrap",
                  marginTop: "10px",
                }}
              >
                {["sale", "product", "debt", "expense", "audit", "report"].map(
                  (sample) => (
                    <button
                      key={sample}
                      type="button"
                      onClick={() => setCommandQuery(sample)}
                      style={{
                        border: "1px solid #dbe3ef",
                        background: "#ffffff",
                        color: "#164777",
                        borderRadius: "999px",
                        padding: "6px 10px",
                        cursor: "pointer",
                        fontWeight: "900",
                        fontSize: "12px",
                      }}
                    >
                      {sample}
                    </button>
                  )
                )}
              </div>
            </div>

            <div
              style={{
                minHeight: 0,
                overflowY: "auto",
                padding: isMobile ? "12px" : "14px",
                background: "#ffffff",
              }}
            >
              {filteredCommandItems.length === 0 ? (
                <div
                  style={{
                    padding: "24px",
                    borderRadius: "16px",
                    background: "#f8fafc",
                    color: "#64748b",
                    textAlign: "center",
                    fontWeight: "800",
                    border: "1px dashed #cbd5e1",
                  }}
                >
                  No matching command found.
                </div>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gap: "10px",
                  }}
                >
                  {filteredCommandItems.map((item) => (
                    <button
                      key={`${item.group}-${item.path}-${item.title}`}
                      type="button"
                      onClick={() => runCommand(item.path)}
                      style={{
                        width: "100%",
                        display: "grid",
                        gridTemplateColumns: isMobile
                          ? "42px minmax(0, 1fr)"
                          : "44px minmax(0, 1fr) auto",
                        gap: "12px",
                        alignItems: "center",
                        border: "1px solid #e2e8f0",
                        background: "#ffffff",
                        borderRadius: "16px",
                        padding: "12px",
                        textAlign: "left",
                        cursor: "pointer",
                        color: "#07182c",
                        boxShadow: "0 8px 20px rgba(15,23,42,0.05)",
                      }}
                    >
                      <span
                        style={{
                          width: isMobile ? "42px" : "44px",
                          height: isMobile ? "42px" : "44px",
                          borderRadius: "14px",
                          background: "#f1f5f9",
                          display: "grid",
                          placeItems: "center",
                          fontSize: "22px",
                        }}
                      >
                        {item.icon}
                      </span>

                      <span style={{ minWidth: 0 }}>
                        <strong
                          style={{
                            display: "block",
                            fontSize: "15px",
                            fontWeight: "950",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {item.title}
                        </strong>

                        <small
                          style={{
                            display: "block",
                            marginTop: "3px",
                            color: "#64748b",
                            fontWeight: "700",
                            lineHeight: 1.4,
                          }}
                        >
                          {item.description}
                        </small>
                      </span>

                      {!isMobile && (
                        <span
                          style={{
                            color: "#94a3b8",
                            fontWeight: "950",
                            fontSize: "18px",
                          }}
                        >
                          →
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}