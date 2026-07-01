import { useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";

export default function AuditSignoffHistoryPage() {
  const { user } = useAuth();

  const [signoffs, setSignoffs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [periodType, setPeriodType] = useState("");
  const [periodStatus, setPeriodStatus] = useState("");

  const isAdmin = String(user?.role || "").toLowerCase() === "admin";

  function cleanText(value) {
    return String(value ?? "").trim();
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatDate(value) {
    if (!value) return "-";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "-";
    }

    return date.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }

  function formatDateTime(value) {
    if (!value) return "-";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "-";
    }

    return date.toLocaleString("en-GB");
  }

  function getStatusLabel(status) {
    const value = String(status || "draft").toLowerCase();

    if (value === "approved") return "Approved";
    if (value === "reviewed") return "Reviewed";
    if (value === "rejected") return "Rejected";

    return "Draft";
  }

  function getStatusStyle(status) {
    const value = String(status || "draft").toLowerCase();

    if (value === "approved") {
      return {
        background: "#dcfce7",
        color: "#166534",
        borderColor: "#bbf7d0",
      };
    }

    if (value === "reviewed") {
      return {
        background: "#dbeafe",
        color: "#1d4ed8",
        borderColor: "#bfdbfe",
      };
    }

    if (value === "rejected") {
      return {
        background: "#fee2e2",
        color: "#991b1b",
        borderColor: "#fecaca",
      };
    }

    return {
      background: "#f8fafc",
      color: "#475569",
      borderColor: "#cbd5e1",
    };
  }

  function getScoreStyle(score) {
    const number = Number(score || 0);

    if (number >= 85) {
      return {
        background: "#dcfce7",
        color: "#166534",
      };
    }

    if (number >= 70) {
      return {
        background: "#dbeafe",
        color: "#1d4ed8",
      };
    }

    if (number >= 50) {
      return {
        background: "#ffedd5",
        color: "#9a3412",
      };
    }

    return {
      background: "#fee2e2",
      color: "#991b1b",
    };
  }

  async function loadSignoffs() {
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const params = {};

      if (periodType) {
        params.period_type = periodType;
      }

      if (periodStatus) {
        params.period_status = periodStatus;
      }

      if (cleanText(search)) {
        params.search = cleanText(search);
      }

      const response = await axiosClient.get("/audit-signoffs", { params });

      setSignoffs(response.data.signoffs || []);
    } catch (error) {
      setError(
        error.response?.data?.message ||
          "Failed to load audit sign-off history."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSignoffs();
  }, []);

  const summary = useMemo(() => {
    const total = signoffs.length;
    const approved = signoffs.filter(
      (item) => String(item.period_status).toLowerCase() === "approved"
    ).length;
    const reviewed = signoffs.filter(
      (item) => String(item.period_status).toLowerCase() === "reviewed"
    ).length;
    const draft = signoffs.filter(
      (item) => String(item.period_status).toLowerCase() === "draft"
    ).length;
    const rejected = signoffs.filter(
      (item) => String(item.period_status).toLowerCase() === "rejected"
    ).length;

    const averageScore =
      total > 0
        ? Math.round(
            signoffs.reduce(
              (sum, item) => sum + Number(item.audit_score || 0),
              0
            ) / total
          )
        : 0;

    return {
      total,
      approved,
      reviewed,
      draft,
      rejected,
      averageScore,
    };
  }, [signoffs]);

  function makeCsv(rows) {
    if (!rows || rows.length === 0) {
      return "";
    }

    const headers = Object.keys(rows[0]);

    const escapeCsv = (value) => {
      const text = String(value ?? "");
      const escaped = text.replaceAll('"', '""');
      return `"${escaped}"`;
    };

    return [
      headers.map(escapeCsv).join(","),
      ...rows.map((row) =>
        headers.map((header) => escapeCsv(row[header])).join(",")
      ),
    ].join("\n");
  }

  function downloadTextFile(filename, content, type = "text/plain") {
    const blob = new Blob([content], { type });
    const fileUrl = window.URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = fileUrl;
    link.download = filename;
    link.style.display = "none";

    document.body.appendChild(link);
    link.click();

    setTimeout(() => {
      document.body.removeChild(link);
      window.URL.revokeObjectURL(fileUrl);
    }, 150);
  }

  function exportHistoryCsv() {
    if (signoffs.length === 0) {
      setError("No sign-off history available to export.");
      return;
    }

    const rows = signoffs.map((item) => ({
      id: item.id,
      period_type: item.period_type,
      period_label: item.period_label,
      period_start: formatDate(item.period_start),
      period_end: formatDate(item.period_end),
      audit_score: item.audit_score,
      audit_status: item.audit_status,
      period_status: item.period_status,
      prepared_by_name: item.prepared_by_name || "",
      reviewed_by_name: item.reviewed_by_name || "",
      approved_by_name: item.approved_by_name || "",
      review_date: formatDate(item.review_date),
      created_by_name: item.created_by_name || "",
      approved_by_user_name: item.approved_by_user_name || "",
      updated_at: formatDateTime(item.updated_at),
    }));

    downloadTextFile(
      "chalin03_audit_signoff_history.csv",
      `\uFEFF${makeCsv(rows)}`,
      "text/csv;charset=utf-8"
    );

    setMessage("Audit sign-off history CSV downloaded successfully.");
  }

  function buildCertificateHtml(signoff) {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8" />
          <title>Audit Sign-Off Certificate</title>

          <style>
            @page {
              size: A4;
              margin: 16mm;
            }

            body {
              font-family: Arial, sans-serif;
              color: #111827;
              line-height: 1.5;
              font-size: 12px;
            }

            .certificate {
              border: 4px solid #07182c;
              padding: 24px;
              min-height: 92vh;
            }

            h1 {
              color: #07182c;
              text-align: center;
              margin: 0;
              font-size: 26px;
              text-transform: uppercase;
            }

            .subtitle {
              text-align: center;
              color: #64748b;
              margin-top: 8px;
            }

            .badge {
              margin: 22px auto;
              width: 150px;
              height: 150px;
              border-radius: 50%;
              border: 8px solid #e0ba28;
              display: grid;
              place-items: center;
              text-align: center;
              color: #07182c;
            }

            .badge strong {
              display: block;
              font-size: 30px;
            }

            .grid {
              display: grid;
              grid-template-columns: repeat(2, 1fr);
              gap: 10px;
              margin-top: 18px;
            }

            .box {
              border: 1px solid #dbe3ef;
              background: #f8fafc;
              border-radius: 10px;
              padding: 10px;
            }

            .box span {
              display: block;
              color: #64748b;
              font-size: 11px;
            }

            .box strong {
              display: block;
              margin-top: 4px;
              color: #07182c;
            }

            table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 20px;
            }

            th,
            td {
              border: 1px solid #dbe3ef;
              padding: 8px;
              text-align: left;
              vertical-align: top;
            }

            th {
              background: #07182c;
              color: #ffffff;
            }

            .notes {
              margin-top: 20px;
              border: 1px solid #dbe3ef;
              padding: 12px;
              border-radius: 10px;
            }

            .signature-grid {
              display: grid;
              grid-template-columns: repeat(3, 1fr);
              gap: 18px;
              margin-top: 60px;
            }

            .signature {
              border-top: 1px solid #111827;
              padding-top: 7px;
              text-align: center;
            }

            .footer {
              margin-top: 30px;
              color: #64748b;
              font-size: 10px;
              border-top: 1px solid #dbe3ef;
              padding-top: 8px;
            }
          </style>
        </head>

        <body>
          <div class="certificate">
            <h1>Chalin 03 Company Limited</h1>
            <p class="subtitle">Audit Sign-Off & Accounting Approval Certificate</p>

            <div class="badge">
              <div>
                <strong>${Number(signoff.audit_score || 0)}%</strong>
                <span>${escapeHtml(signoff.audit_status || "-")}</span>
              </div>
            </div>

            <div class="grid">
              <div class="box">
                <span>Period</span>
                <strong>${escapeHtml(signoff.period_label || "-")}</strong>
              </div>

              <div class="box">
                <span>Status</span>
                <strong>${escapeHtml(getStatusLabel(signoff.period_status))}</strong>
              </div>

              <div class="box">
                <span>Review Date</span>
                <strong>${escapeHtml(formatDate(signoff.review_date))}</strong>
              </div>

              <div class="box">
                <span>Saved By</span>
                <strong>${escapeHtml(signoff.created_by_name || "-")}</strong>
              </div>
            </div>

            <table>
              <thead>
                <tr>
                  <th>Prepared By</th>
                  <th>Reviewed By</th>
                  <th>Approved By</th>
                </tr>
              </thead>

              <tbody>
                <tr>
                  <td>${escapeHtml(signoff.prepared_by_name || "-")}</td>
                  <td>${escapeHtml(signoff.reviewed_by_name || "-")}</td>
                  <td>${escapeHtml(signoff.approved_by_name || "-")}</td>
                </tr>
              </tbody>
            </table>

            <table>
              <thead>
                <tr>
                  <th>Sales</th>
                  <th>Expenses</th>
                  <th>Debts</th>
                  <th>Stock</th>
                  <th>Warnings</th>
                  <th>Reports</th>
                </tr>
              </thead>

              <tbody>
                <tr>
                  <td>${signoff.sales_checked ? "Checked" : "Not Checked"}</td>
                  <td>${signoff.expenses_checked ? "Checked" : "Not Checked"}</td>
                  <td>${signoff.debts_checked ? "Checked" : "Not Checked"}</td>
                  <td>${signoff.stock_checked ? "Checked" : "Not Checked"}</td>
                  <td>${signoff.warnings_checked ? "Checked" : "Not Checked"}</td>
                  <td>${signoff.reports_checked ? "Checked" : "Not Checked"}</td>
                </tr>
              </tbody>
            </table>

            <div class="notes">
              <strong>Accountant / Auditor Notes</strong>
              <p>${escapeHtml(signoff.accountant_notes || "-")}</p>

              <strong>Boss / Management Notes</strong>
              <p>${escapeHtml(signoff.management_notes || "-")}</p>
            </div>

            <div class="signature-grid">
              <div class="signature">Prepared By</div>
              <div class="signature">Reviewed By</div>
              <div class="signature">Approved By</div>
            </div>

            <div class="footer">
              Generated from Chalin 03 Sales & Inventory Management System.
            </div>
          </div>
        </body>
      </html>
    `;
  }

  function printCertificate(signoff) {
    const printWindow = window.open("", "_blank", "width=1000,height=800");

    if (!printWindow) {
      setError("Popup blocked. Please allow popups and try again.");
      return;
    }

    printWindow.document.open();
    printWindow.document.write(buildCertificateHtml(signoff));
    printWindow.document.close();

    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 350);
  }

  function downloadCertificateWord(signoff) {
    const wordDocument = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office"
            xmlns:w="urn:schemas-microsoft-com:office:word"
            xmlns="http://www.w3.org/TR/REC-html40">
        <head>
          <meta charset="UTF-8" />
          <meta name="ProgId" content="Word.Document" />
          <meta name="Generator" content="Chalin 03 System" />
        </head>
        <body>
          ${buildCertificateHtml(signoff)}
        </body>
      </html>
    `;

    downloadTextFile(
      `chalin03_signoff_certificate_${signoff.id}.doc`,
      wordDocument,
      "application/msword;charset=utf-8"
    );

    setMessage("Sign-off certificate Word document downloaded.");
  }

  async function deleteSignoff(signoff) {
    if (!isAdmin) {
      setError("Only admin can delete audit sign-offs.");
      return;
    }

    const confirmDelete = window.confirm(
      `Delete audit sign-off for "${signoff.period_label}"? This cannot be undone.`
    );

    if (!confirmDelete) {
      return;
    }

    try {
      await axiosClient.delete(`/audit-signoffs/${signoff.id}`);

      setMessage("Audit sign-off deleted successfully.");
      await loadSignoffs();
    } catch (error) {
      setError(
        error.response?.data?.message ||
          "Failed to delete audit sign-off record."
      );
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.hero}>
        <div>
          <p style={styles.eyebrow}>Audit Control</p>
          <h1 style={styles.title}>Audit Sign-Off History</h1>
          <p style={styles.subtitle}>
            View saved accounting approvals, approved periods, audit scores,
            sign-off names, review dates and management records.
          </p>
        </div>

        <div style={styles.heroActions}>
          <button type="button" onClick={loadSignoffs} disabled={loading}>
            {loading ? "Loading..." : "Refresh"}
          </button>

          <button
            type="button"
            className="secondary-button"
            onClick={exportHistoryCsv}
          >
            Export History CSV
          </button>
        </div>
      </div>

      {message && <div className="success-box">{message}</div>}
      {error && <div className="error-box">{error}</div>}

      <div style={styles.summaryGrid}>
        <SummaryCard title="Total Sign-Offs" value={summary.total} />
        <SummaryCard title="Approved" value={summary.approved} />
        <SummaryCard title="Reviewed" value={summary.reviewed} />
        <SummaryCard title="Draft" value={summary.draft} />
        <SummaryCard title="Rejected" value={summary.rejected} />
        <SummaryCard title="Average Score" value={`${summary.averageScore}%`} />
      </div>

      <div style={styles.filterPanel}>
        <div>
          <label>Search</label>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search period, prepared by, reviewed by, approved by"
          />
        </div>

        <div>
          <label>Period Type</label>
          <select
            value={periodType}
            onChange={(event) => setPeriodType(event.target.value)}
          >
            <option value="">All Periods</option>
            <option value="all">All Records</option>
            <option value="today">Today</option>
            <option value="week">This Week</option>
            <option value="month">This Month</option>
            <option value="year">This Year</option>
            <option value="custom">Custom</option>
          </select>
        </div>

        <div>
          <label>Status</label>
          <select
            value={periodStatus}
            onChange={(event) => setPeriodStatus(event.target.value)}
          >
            <option value="">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="reviewed">Reviewed</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>

        <button type="button" onClick={loadSignoffs} disabled={loading}>
          Apply Filters
        </button>
      </div>

      <div style={styles.panel}>
        <h2>Saved Sign-Off Records</h2>
        <p style={styles.panelText}>
          These records come from the MySQL audit_signoffs table.
        </p>

        {loading ? (
          <div style={styles.emptyState}>Loading sign-off history...</div>
        ) : signoffs.length === 0 ? (
          <div style={styles.emptyState}>No audit sign-offs found yet.</div>
        ) : (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Period</th>
                  <th>Score</th>
                  <th>Status</th>
                  <th>Prepared</th>
                  <th>Reviewed</th>
                  <th>Approved</th>
                  <th>Review Date</th>
                  <th>Saved By</th>
                  <th>Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>
                {signoffs.map((item) => (
                  <tr key={item.id}>
                    <td>#{item.id}</td>

                    <td>
                      <strong>{item.period_label}</strong>
                      <br />
                      <small>{item.period_type}</small>
                    </td>

                    <td>
                      <span
                        style={{
                          ...styles.scoreBadge,
                          ...getScoreStyle(item.audit_score),
                        }}
                      >
                        {Number(item.audit_score || 0)}%
                      </span>
                    </td>

                    <td>
                      <span
                        style={{
                          ...styles.statusBadge,
                          ...getStatusStyle(item.period_status),
                        }}
                      >
                        {getStatusLabel(item.period_status)}
                      </span>
                    </td>

                    <td>{item.prepared_by_name || "-"}</td>
                    <td>{item.reviewed_by_name || "-"}</td>
                    <td>{item.approved_by_name || "-"}</td>
                    <td>{formatDate(item.review_date)}</td>
                    <td>{item.created_by_name || "-"}</td>
                    <td>{formatDateTime(item.updated_at)}</td>

                    <td>
                      <div style={styles.actionButtons}>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => printCertificate(item)}
                        >
                          Print
                        </button>

                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => downloadCertificateWord(item)}
                        >
                          Word
                        </button>

                        {isAdmin && (
                          <button
                            type="button"
                            style={styles.deleteButton}
                            onClick={() => deleteSignoff(item)}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={styles.disclaimer}>
        This page is for internal business control. It helps management track
        accounting review and audit approval history, but it does not replace a
        licensed accountant, tax consultant or external auditor.
      </div>
    </div>
  );
}

function SummaryCard({ title, value }) {
  return (
    <div style={styles.summaryCard}>
      <p>{title}</p>
      <strong>{value}</strong>
    </div>
  );
}

const styles = {
  page: {
    width: "100%",
    maxWidth: "1680px",
    margin: "0 auto",
    paddingBottom: "40px",
  },

  hero: {
    display: "flex",
    justifyContent: "space-between",
    gap: "18px",
    flexWrap: "wrap",
    alignItems: "flex-start",
    marginBottom: "18px",
    padding: "24px",
    borderRadius: "26px",
    background:
      "linear-gradient(135deg, #07182c 0%, #0d2f55 55%, #111827 100%)",
    color: "#ffffff",
    boxShadow: "0 22px 55px rgba(7, 24, 44, 0.24)",
  },

  eyebrow: {
    margin: 0,
    color: "#e0ba28",
    fontSize: "12px",
    fontWeight: "950",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },

  title: {
    margin: "6px 0 0",
    fontSize: "clamp(28px, 4vw, 44px)",
    fontWeight: "950",
    lineHeight: 1.05,
  },

  subtitle: {
    margin: "10px 0 0",
    color: "rgba(255,255,255,0.76)",
    maxWidth: "850px",
    lineHeight: 1.6,
  },

  heroActions: {
    display: "flex",
    flexWrap: "wrap",
    gap: "10px",
  },

  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: "14px",
    marginBottom: "18px",
  },

  summaryCard: {
    padding: "16px",
    borderRadius: "20px",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    boxShadow: "0 14px 30px rgba(15,23,42,0.07)",
  },

  filterPanel: {
    display: "grid",
    gridTemplateColumns: "minmax(240px, 1.6fr) minmax(180px, 1fr) minmax(180px, 1fr) auto",
    gap: "12px",
    alignItems: "end",
    padding: "18px",
    borderRadius: "22px",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    boxShadow: "0 18px 40px rgba(15,23,42,0.08)",
    marginBottom: "18px",
  },

  panel: {
    background: "#ffffff",
    borderRadius: "22px",
    padding: "20px",
    border: "1px solid #e2e8f0",
    boxShadow: "0 18px 40px rgba(15,23,42,0.08)",
    minWidth: 0,
  },

  panelText: {
    color: "#64748b",
    lineHeight: 1.6,
  },

  tableWrap: {
    width: "100%",
    overflowX: "auto",
    marginTop: "12px",
  },

  table: {
    width: "100%",
    borderCollapse: "collapse",
    minWidth: "1100px",
  },

  scoreBadge: {
    display: "inline-flex",
    padding: "6px 10px",
    borderRadius: "999px",
    fontWeight: "950",
    fontSize: "12px",
  },

  statusBadge: {
    display: "inline-flex",
    padding: "6px 10px",
    borderRadius: "999px",
    fontWeight: "950",
    fontSize: "12px",
    border: "1px solid",
  },

  actionButtons: {
    display: "flex",
    flexWrap: "wrap",
    gap: "7px",
  },

  deleteButton: {
    background: "#dc2626",
    color: "#ffffff",
    border: "none",
    borderRadius: "10px",
    padding: "8px 10px",
    fontWeight: "900",
    cursor: "pointer",
  },

  emptyState: {
    padding: "18px",
    borderRadius: "16px",
    background: "#f8fafc",
    color: "#64748b",
    border: "1px dashed #cbd5e1",
    textAlign: "center",
    fontWeight: "800",
  },

  disclaimer: {
    marginTop: "18px",
    padding: "14px",
    borderRadius: "16px",
    background: "#f8fafc",
    border: "1px dashed #cbd5e1",
    color: "#64748b",
    fontWeight: "800",
    lineHeight: 1.5,
  },
};