import { useEffect, useMemo, useState } from "react";
import { useFeatureFlags } from "../context/FeatureFlagContext.jsx";

const USER_KEY = "chalin03_user";

function storedUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || "null");
  } catch {
    return null;
  }
}

function permissionSet(user) {
  return new Set(
    Array.isArray(user?.effective_permissions) ? user.effective_permissions : []
  );
}

export default function ChalinOneGatewayLinks() {
  const [user, setUser] = useState(() => storedUser());
  const { flags } = useFeatureFlags();
  const pathname = window.location.pathname;
  const isLogin = pathname === "/login";
  const permissions = useMemo(() => permissionSet(user), [user]);

  useEffect(() => {
    function refresh() {
      setUser(storedUser());
    }
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  if (!isLogin && !user) return null;
  if (
    pathname === "/website" ||
    pathname.startsWith("/website/") ||
    pathname === "/content-studio" ||
    pathname.startsWith("/content-studio/") ||
    pathname === "/intelligence" ||
    pathname.startsWith("/intelligence/")
  ) {
    return null;
  }

  const canShowStudio =
    isLogin || String(user?.role || "").toLowerCase() === "admin";
  const canShowIntelligence =
    !isLogin &&
    Boolean(user) &&
    flags?.aiEnabled === true &&
    permissions.has("workspace.view");

  return (
    <nav
      aria-label="CHALIN ONE quick access"
      style={{
        position: "fixed",
        right: "18px",
        bottom: "18px",
        zIndex: 9998,
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "flex-end",
        gap: "8px",
        maxWidth: "calc(100vw - 36px)",
        padding: "8px",
        border: "1px solid rgba(255,255,255,0.18)",
        borderRadius: "16px",
        background: "rgba(5, 22, 42, 0.94)",
        boxShadow: "0 14px 34px rgba(0,0,0,0.24)",
        backdropFilter: "blur(14px)",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      <a
        href="/website"
        style={{
          textDecoration: "none",
          color: "#07182c",
          background: "#f8c43a",
          borderRadius: "10px",
          padding: "10px 13px",
          fontWeight: 900,
          fontSize: "12px",
          letterSpacing: ".02em",
        }}
      >
        CHALIN ONE Website
      </a>
      {canShowIntelligence && (
        <a
          href="/intelligence"
          title="Open CHALIN ONE Intelligence"
          style={{
            textDecoration: "none",
            color: "#07182c",
            background: "#9ee7ff",
            borderRadius: "10px",
            padding: "10px 13px",
            fontWeight: 900,
            fontSize: "12px",
            letterSpacing: ".02em",
          }}
        >
          CHALIN AI
        </a>
      )}
      {canShowStudio && (
        <a
          href="/content-studio"
          title={isLogin ? "Sign in first, then open Content Studio." : "Open Content Studio"}
          style={{
            textDecoration: "none",
            color: "#ffffff",
            background: "rgba(255,255,255,0.1)",
            border: "1px solid rgba(255,255,255,0.18)",
            borderRadius: "10px",
            padding: "10px 13px",
            fontWeight: 800,
            fontSize: "12px",
          }}
        >
          Content Studio{isLogin ? " · staff" : ""}
        </a>
      )}
    </nav>
  );
}
