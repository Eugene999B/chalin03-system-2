import { useEffect, useState } from "react";
import axiosClient from "../api/axiosClient";

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
    <main style={{ padding: 24, maxWidth: 1440, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", marginBottom: 20, flexWrap: "wrap" }}>
        <div>
          <p style={{ margin: 0, color: "#66736b" }}>Equipment Installment Finance</p>
          <h1 style={{ margin: "6px 0 0" }}>SMS History</h1>
          <p style={{ margin: "8px 0 0", color: "#647169" }}>Every Installment Finance SMS attempt and delivery result.</p>
        </div>
        <button type="button" onClick={load} disabled={loading}>{loading ? "Refreshing…" : "Refresh history"}</button>
      </div>
      {error ? <div role="alert" style={{ marginBottom: 16, padding: 14, borderRadius: 12, background: "#fff1f0", color: "#9c2d25" }}>{error}</div> : null}
      <div style={{ overflowX: "auto", border: "1px solid #d9e2dc", borderRadius: 14, background: "#fff" }}>
        <table style={{ width: "100%", minWidth: 1000, borderCollapse: "collapse" }}>
          <thead><tr>{["Date / Time", "Phone", "Type", "Message", "Status", "Provider", "Sent By"].map((heading) => <th key={heading} style={{ textAlign: "left", padding: 12, background: "#f5f8f6", borderBottom: "1px solid #d9e2dc", whiteSpace: "nowrap" }}>{heading}</th>)}</tr></thead>
          <tbody>{logs.map((log) => <tr key={log.id}>
            <td style={{ padding: 12, verticalAlign: "top", whiteSpace: "nowrap" }}>{new Date(log.submitted_at || log.created_at).toLocaleString("en-GB", { timeZone: "Africa/Accra" })}</td>
            <td style={{ padding: 12, verticalAlign: "top" }}>{log.recipient_phone || "—"}</td>
            <td style={{ padding: 12, verticalAlign: "top" }}>{log.sms_type || "Finance"}</td>
            <td style={{ padding: 12, verticalAlign: "top", minWidth: 320, maxWidth: 520, whiteSpace: "pre-wrap" }}>{log.message}</td>
            <td style={{ padding: 12, verticalAlign: "top", fontWeight: 700 }}>{log.status || "Unknown"}</td>
            <td style={{ padding: 12, verticalAlign: "top" }}>{log.provider || "—"}</td>
            <td style={{ padding: 12, verticalAlign: "top" }}>{log.sent_by_name || log.sent_by_username || "System"}</td>
          </tr>)}</tbody>
        </table>
        {!loading && logs.length === 0 ? <div style={{ padding: 28, textAlign: "center", color: "#6b766f" }}>No Installment Finance SMS has been recorded yet.</div> : null}
      </div>
    </main>
  );
}
