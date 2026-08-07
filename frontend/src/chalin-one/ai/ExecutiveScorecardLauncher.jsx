import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { getAiStatus } from "./aiApi";

const linkStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  minHeight: 44,
  padding: "10px 14px",
  borderRadius: 999,
  background: "linear-gradient(135deg, #0d2748, #1768ad)",
  color: "#fff",
  fontSize: ".76rem",
  fontWeight: 900,
  textDecoration: "none",
  boxShadow: "0 14px 32px rgba(13,39,72,.26)",
  border: "1px solid rgba(255,255,255,.18)",
};

export default function ExecutiveScorecardLauncher() {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    getAiStatus({ signal: controller.signal })
      .then(setStatus)
      .catch(() => null);
    return () => controller.abort();
  }, []);

  const available = useMemo(() => {
    const permissions = new Set(
      Array.isArray(status?.permissions?.permissions)
        ? status.permissions.permissions
        : []
    );
    return (
      status?.flags?.chalinExecutive === true &&
      permissions.has("ai.executive.use")
    );
  }, [status]);

  if (!available) return null;

  return (
    <nav
      aria-label="Executive intelligence shortcuts"
      style={{
        position: "fixed",
        right: "max(12px, env(safe-area-inset-right))",
        bottom: "max(12px, env(safe-area-inset-bottom))",
        zIndex: 80,
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: 8,
        flexWrap: "wrap",
        maxWidth: "calc(100vw - 24px)",
      }}
    >
      <Link
        to="/intelligence/executive-scenarios"
        aria-label="Open Executive Scenario Comparison Engine"
        style={{ ...linkStyle, background: "linear-gradient(135deg, #145949, #1f8971)" }}
      >
        <span aria-hidden="true">SC</span>
        Scenarios
      </Link>
      <Link
        to="/intelligence/executive-scorecard"
        aria-label="Open Executive Intelligence Scorecard"
        style={linkStyle}
      >
        <span aria-hidden="true">EX</span>
        Executive scorecard
      </Link>
    </nav>
  );
}
