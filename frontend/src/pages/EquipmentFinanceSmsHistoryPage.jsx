import { useEffect, useState } from "react";
import axiosClient from "../api/axiosClient";

const dateOptions = { timeZone: "Africa/Accra" };

function SmsStatus({ value }) {
  const status = String(value || "Unknown");
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        minHeight: 28,
        padding: "4px 9px",
        borderRadius: 999,
        background: "#eef3ef",
        fontWeight: 700,
        fontSize: 12,
      }}
    >
      {status}
    </span>
  );
}

function SmsCard({ log }) {
  const when = new Date(log.submitted_at || log.created_at).toLocaleString("en-GB", dateOptions);
  return (
    <article
      style={{
        border: "1px solid #d9e2dc",
        borderRadius: 14,
        padding: 14,
        background: "#fff",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div>
          <strong style={{ display: "block", overflowWrap: "anywhere" }}>{log.recipient_phone || "—"}</strong>
          <span style={{ display: "block", marginTop: 4, color: "#647169", fontSize: 13 }}>{when}</span>
        </div>
        <SmsStatus value={log.status} />
      </div>
      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
        <div>
          <span style={{ display: "block", color: "#647169", fontSize: 12 }}>Type</span>
          <strong>{log.sms_type || "Finance"}</strong>
        </div>
        <div>
          <span style={{ display: "block", color: "#647169", fontSize: 12 }}>Message</span>
          <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{log.message || "—"}</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
          <div>
            <span style={{ display: "block", color: "#647169", fontSize: 12 }}>Provider</span>
            <span>{log.provider || "—"}</span>
          </div>
          <div>
            <span style={{ display: "block", color: "#647169", fontSize: 12 }}>Sent by</span>
            <span>{log.sent_by_name || log.sent_by_username || "System"}</span>
          </div>
        </div>
      </div>
    </article>
  );
}

export default function EquipmentFinanceSmsHistoryPage() {
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await axiosClient.get("/equipment-catalogue/sales/sms-history", { params: { limit: 200 } });
      setLogs(Array.isArray(response.data?.logs) ? response.data.logs : []);
    } catch (err) {
      setError(err?.response?.data?.message || "Could not load Installment SMS history.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <main style={{ padding: "clamp(14px, 3vw, 24px)", maxWidth: 1440, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", marginBottom: 20, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, color: "#66736b" }}>Equipment Installment Finance</p>
          <h1 style={{ margin: "6px 0 0", fontSize: "clamp(1.45rem, 5vw, 2rem)" }}>SMS History</h1>
          <p style={{ margin: "8px 0 0", color: "#647169" }}>Every Installment Finance SMS attempt and delivery result.</p>
        </div>
        <button type="button" onClick={load} disabled={loading} style={{ minHeight: 44, padding: "10px 14px" }}>
          {loading ? "Refreshing…" : "Refresh history"}
        </button>
      </div>
      {error ? <div role="alert" style={{ marginBottom: 16, padding: 14, borderRadius: 12, background: "#fff1f0", color: "#9c2d25", overflowWrap: "anywhere" }}>{error}</div> : null}

      <div style={{ display: "none" }} aria-hidden="true" />
      <div className="equipment-finance-sms-history-table" style={{ overflowX: "auto", border: "1px solid #d9e2dc", borderRadius: 14, background: "#fff" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>{["Date / Time", "Phone", "Type", "Message", "Status", "Provider", "Sent By"].map((heading) => <th key={heading} style={{ textAlign: "left", padding: 12, background: "#f5f8f6", borderBottom: "1px solid #d9e2dc", whiteSpace: "nowrap" }}>{heading}</th>)}</tr></thead>
          <tbody>{logs.map((log) => <tr key={log.id}>
            <td style={{ padding: 12, verticalAlign: "top", whiteSpace: "nowrap" }}>{new Date(log.submitted_at || log.created_at).toLocaleString("en-GB", dateOptions)}</td>
            <td style={{ padding: 12, verticalAlign: "top", overflowWrap: "anywhere" }}>{log.recipient_phone || "—"}</td>
            <td style={{ padding: 12, verticalAlign: "top" }}>{log.sms_type || "Finance"}</td>
            <td style={{ padding: 12, verticalAlign: "top", minWidth: 320, maxWidth: 520, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{log.message}</td>
            <td style={{ padding: 12, verticalAlign: "top", fontWeight: 700 }}>{log.status || "Unknown"}</td>
            <td style={{ padding: 12, verticalAlign: "top" }}>{log.provider || "—"}</td>
            <td style={{ padding: 12, verticalAlign: "top" }}>{log.sent_by_name || log.sent_by_username || "System"}</td>
          </tr>)}</tbody>
        </table>
      </div>

      <div className="equipment-finance-sms-history-cards" style={{ display: "grid", gap: 12 }}>
        {logs.map((log) => <SmsCard key={log.id} log={log} />)}
      </div>

      {!loading && logs.length === 0 ? <div style={{ marginTop: 12, padding: 28, textAlign: "center", color: "#6b766f", border: "1px dashed #c8d4cc", borderRadius: 14 }}>No Installment Finance SMS has been recorded yet.</div> : null}
      <style>{`@media (max-width: 760px) { .equipment-finance-sms-history-table { display: none !important; } .equipment-finance-sms-history-cards { display: grid !important; } } @media (min-width: 761px) { .equipment-finance-sms-history-cards { display: none !important; } .equipment-finance-sms-history-table { display: block; } }`}</style>
    </main>
  );
}
