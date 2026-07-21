import { useEffect, useRef, useState } from "react";

import InstallAppButton from "./InstallAppButton";

export default function SidebarAccountMenu({
  displayName,
  userInitials,
  role,
  currentStoreCode,
  currentStoreName,
  storeAccessLabel,
  onChangePassword,
  onLogout,
}) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);

  useEffect(() => {
    function closeOutside(event) {
      if (panelRef.current && !panelRef.current.contains(event.target)) setOpen(false);
    }
    function closeEscape(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", closeOutside);
    window.addEventListener("keydown", closeEscape);
    return () => {
      document.removeEventListener("mousedown", closeOutside);
      window.removeEventListener("keydown", closeEscape);
    };
  }, []);

  return (
    <div className="compact-account-shell" ref={panelRef}>
      {open ? (
        <div className="compact-account-menu">
          <div className="compact-account-store">
            <small>Working Store</small>
            <strong>{currentStoreCode} — {currentStoreName}</strong>
            <span>{storeAccessLabel}</span>
          </div>
          <InstallAppButton />
          <button
            type="button"
            className="compact-account-action password"
            onClick={() => {
              setOpen(false);
              onChangePassword();
            }}
          >
            🔐 Change Password
          </button>
          <button
            type="button"
            className="compact-account-action logout"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
          >
            ↪ Logout
          </button>
        </div>
      ) : null}

      <button
        type="button"
        className={`compact-account-trigger ${open ? "open" : ""}`}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <span className="premium-avatar">{userInitials}</span>
        <span className="compact-account-copy">
          <strong>{displayName}</strong>
          <small>{String(role || "role").toUpperCase()} • {currentStoreCode}</small>
        </span>
        <b>{open ? "▾" : "▴"}</b>
      </button>
    </div>
  );
}
