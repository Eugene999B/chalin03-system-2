import { useEffect, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";

export default function SecurityCentreBulkDelete() {
  const { hasPermission } = useAuth();
  const [securityPage, setSecurityPage] = useState(false);
  const [busy, setBusy] = useState(false);

  const canDelete = hasPermission("security.admin");

  useEffect(() => {
    const detect = () => {
      const path = window.location.pathname.toLowerCase();
      const body = document.body.innerText.toLowerCase();
      setSecurityPage(
        path.includes("release2-final") &&
          (body.includes("security centre") || body.includes("security center"))
      );
    };

    detect();
    const observer = new MutationObserver(detect);
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  async function deleteAllVisibleMessages() {
    if (!canDelete || busy) return;
    const password = window.prompt("Enter your current password to clear the visible Security Centre messages:");
    if (!password) return;

    setBusy(true);
    try {
      const unlockResponse = await axiosClient.post("/release2-final/security/unlock", {
        password,
      });
      const token = unlockResponse.data?.protected_action_token;
      if (!token) throw new Error("Protected security token was not returned.");

      const overviewResponse = await axiosClient.get("/release2-final/security/overview");
      const events = overviewResponse.data?.recent_security_events || [];
      const ids = events.map((item) => Number(item.id)).filter((id) => id > 0);

      if (!ids.length) {
        window.alert("There are no visible Security Centre messages to remove.");
        return;
      }

      const confirmed = window.confirm(
        `Remove all ${ids.length} visible Security Centre messages? The underlying audit evidence will remain in the system.`
      );
      if (!confirmed) return;

      await axiosClient.post(
        "/release2-final/security/events/dismiss",
        { event_ids: ids, reason: "Administrator cleared visible Security Centre messages." },
        { headers: { "X-Protected-Action-Token": token } }
      );

      window.location.reload();
    } catch (error) {
      window.alert(
        error.response?.data?.message || error.message || "The Security Centre messages could not be cleared."
      );
    } finally {
      setBusy(false);
    }
  }

  if (!canDelete || !securityPage) return null;

  return (
    <button
      type="button"
      onClick={deleteAllVisibleMessages}
      disabled={busy}
      style={{
        position: "fixed",
        right: 20,
        bottom: 76,
        zIndex: 1150,
        border: "1px solid #dc2626",
        background: "#fff",
        color: "#991b1b",
        borderRadius: 10,
        padding: "9px 12px",
        fontWeight: 800,
        cursor: busy ? "wait" : "pointer",
        boxShadow: "0 10px 24px rgba(127,29,29,.14)",
      }}
    >
      {busy ? "Clearing…" : "Delete all messages"}
    </button>
  );
}
