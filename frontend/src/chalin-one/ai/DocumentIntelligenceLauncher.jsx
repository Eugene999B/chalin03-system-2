import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { getAiStatus } from "./aiApi";

export default function DocumentIntelligenceLauncher() {
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
    return permissions.has("ai.knowledge.view");
  }, [status]);

  if (!available) return null;

  return (
    <Link
      to="/intelligence/documents"
      aria-label="Open Document Intelligence"
      style={{
        position: "fixed",
        left: "max(12px, env(safe-area-inset-left))",
        bottom: "max(12px, env(safe-area-inset-bottom))",
        zIndex: 80,
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        minHeight: 44,
        padding: "10px 14px",
        borderRadius: 999,
        background: "linear-gradient(135deg, #17365d, #2d7db8)",
        color: "#fff",
        fontSize: ".76rem",
        fontWeight: 900,
        textDecoration: "none",
        boxShadow: "0 14px 32px rgba(13,39,72,.22)",
        border: "1px solid rgba(255,255,255,.18)",
      }}
    >
      <span aria-hidden="true">DOC</span>
      Document intelligence
    </Link>
  );
}
