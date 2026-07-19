import { useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import "./DailyClosingPage.css";

const PAYMENT_ICONS = {
  cash: "💵",
  momo: "📱",
  bank: "🏦",
  mixed: "🔀",
  credit: "🧾",
};

const DENOMINATIONS = [
  ["note_200", "GHS 200", 200],
  ["note_100", "GHS 100", 100],
  ["note_50", "GHS 50", 50],
  ["note_20", "GHS 20", 20],
  ["note_10", "GHS 10", 10],
  ["note_5", "GHS 5", 5],
  ["note_2", "GHS 2", 2],
  ["note_1", "GHS 1", 1],
];

const EMPTY_DENOMINATIONS = Object.fromEntries(
  DENOMINATIONS.map(([key]) => [key, ""]).concat([["coins", ""]])
);

function denominationCounterHasEntries(values = {}) {
  return [...DENOMINATIONS.map(([key]) => key), "coins"].some((key) => {
    const value = values?.[key];
    return value !== undefined && value !== null && String(value).trim() !== "";
  });
}

function getTodayDate() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

function safeNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function formatMoney(value) {
  return `GHS ${safeNumber(value).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getBlobFilename(response, fallback) {
  const header = response.headers?.["content-disposition"] || "";
  const utfMatch = header.match(/filename\*=UTF-8''([^;]+)/i);
  const normalMatch = header.match(/filename="?([^";]+)"?/i);

  if (utfMatch?.[1]) return decodeURIComponent(utfMatch[1]);
  if (normalMatch?.[1]) return normalMatch[1];
  return fallback;
}

function downloadBlob(blob, filename) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 1500);
}

function StatusPill({ closing, difference }) {
  const alreadyClosed = Boolean(closing);
  const balanced = Math.abs(safeNumber(difference)) < 0.01;
  const stale = Number(closing?.stale_after_close || 0) === 1;
  const verified = closing?.verification_status === "verified";
  const legacyUnconfirmed = alreadyClosed && Number(closing?.counted_confirmed || 0) !== 1;

  const className = stale || legacyUnconfirmed
    ? "dc-status dc-status-variance"
    : alreadyClosed
      ? verified && balanced
        ? "dc-status dc-status-closed"
        : "dc-status dc-status-ready"
      : balanced
        ? "dc-status dc-status-draft"
        : "dc-status dc-status-variance";

  const text = stale
    ? "Closed · Changed After Closing"
    : legacyUnconfirmed
      ? "Closed · Legacy Count Unconfirmed"
      : alreadyClosed
      ? verified
        ? balanced
          ? "Closed · Independently Verified"
          : "Closed · Verified Variance"
        : balanced
          ? "Closed · Awaiting Verification"
          : "Closed · Variance Review"
      : "Draft · Manual Count Required";

  return <span className={className}>{text}</span>;
}

function MetricCard({ eyebrow, value, helper, tone = "navy", icon }) {
  return (
    <article className={`dc-metric dc-metric-${tone}`}>
      <div className="dc-metric-top">
        <span className="dc-metric-icon" aria-hidden="true">
          {icon}
        </span>
        <span className="dc-metric-eyebrow">{eyebrow}</span>
      </div>
      <strong>{value}</strong>
      {helper && <small>{helper}</small>}
    </article>
  );
}

function EmptyState({ title, text }) {
  return (
    <div className="dc-empty">
      <span aria-hidden="true">📭</span>
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

function formatSaleChannels(sale) {
  const channels = [
    ["Cash", sale.cash_received],
    ["MoMo", sale.momo_received],
    ["Bank", sale.bank_received],
    ["Other", sale.other_received],
  ]
    .filter(([, value]) => safeNumber(value) > 0)
    .map(([label, value]) => `${label} ${formatMoney(value)}`);

  return channels.length > 0 ? channels.join(" + ") : "No payment at sale";
}

function isCreditArrangement(groupKey) {
  return ["credit", "mixed"].includes(String(groupKey || "").toLowerCase());
}

function TransactionTable({ transactions }) {
  if (!transactions.length) {
    return (
      <EmptyState
        title="No transactions"
        text="No sales were recorded in this payment group for the selected date."
      />
    );
  }

  return (
    <>
      <div className="dc-table-wrap dc-desktop-table">
        <table className="dc-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Customer</th>
              <th>Receipt</th>
              <th className="dc-number">Gross</th>
              <th className="dc-number">Discount</th>
              <th className="dc-number">Net</th>
              <th className="dc-number">Received at Sale</th>
              <th>Received Via</th>
              <th className="dc-number">Credit Created</th>
              <th>Staff</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((sale) => (
              <tr key={sale.id}>
                <td>{formatTime(sale.created_at)}</td>
                <td>
                  <strong>{sale.customer_name || "CASH CUSTOMER"}</strong>
                </td>
                <td>{sale.receipt_number}</td>
                <td className="dc-number">
                  {formatMoney(sale.gross_before_discount)}
                </td>
                <td className="dc-number">
                  {formatMoney(sale.discount_amount)}
                </td>
                <td className="dc-number">{formatMoney(sale.total)}</td>
                <td className="dc-number">
                  {formatMoney(sale.amount_paid)}
                </td>
                <td>{formatSaleChannels(sale)}</td>
                <td className="dc-number">{formatMoney(sale.balance)}</td>
                <td>{sale.staff_name || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="dc-mobile-list">
        {transactions.map((sale) => (
          <article className="dc-mobile-transaction" key={sale.id}>
            <div className="dc-mobile-transaction-head">
              <div>
                <strong>{sale.customer_name || "CASH CUSTOMER"}</strong>
                <span>
                  {sale.receipt_number} · {formatTime(sale.created_at)}
                </span>
              </div>
              <b>{formatMoney(sale.total)}</b>
            </div>
            <div className="dc-mobile-facts">
              <span>
                Gross <b>{formatMoney(sale.gross_before_discount)}</b>
              </span>
              <span>
                Discount <b>{formatMoney(sale.discount_amount)}</b>
              </span>
              <span>
                Received at sale <b>{formatMoney(sale.amount_paid)}</b>
              </span>
              <span>
                Received via <b>{formatSaleChannels(sale)}</b>
              </span>
              <span>
                Credit created <b>{formatMoney(sale.balance)}</b>
              </span>
            </div>
            <small>Recorded by {sale.staff_name || "System"}</small>
          </article>
        ))}
      </div>
    </>
  );
}

function SavedClosingList({ closings, onOpenDate }) {
  if (!closings.length) {
    return (
      <EmptyState
        title="No saved closings"
        text="The first completed closing for this store will appear here."
      />
    );
  }

  return (
    <>
      <div className="dc-table-wrap dc-desktop-table">
        <table className="dc-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Status</th>
              <th className="dc-number">Expected</th>
              <th className="dc-number">Counted</th>
              <th className="dc-number">Difference</th>
              <th>Closed By</th>
              <th>Closed At</th>
              <th aria-label="Action" />
            </tr>
          </thead>
          <tbody>
            {closings.map((closing) => {
              const balanced =
                Math.abs(safeNumber(closing.difference_total)) < 0.01;
              return (
                <tr key={closing.id}>
                  <td>{formatDate(closing.closing_date)}</td>
                  <td>
                    <span
                      className={
                        balanced
                          ? "dc-mini-status dc-mini-status-ok"
                          : "dc-mini-status dc-mini-status-warning"
                      }
                    >
                      {balanced ? "Balanced" : "Variance"}
                    </span>
                  </td>
                  <td className="dc-number">
                    {formatMoney(closing.expected_total)}
                  </td>
                  <td className="dc-number">
                    {formatMoney(closing.total_counted)}
                  </td>
                  <td className="dc-number">
                    {formatMoney(closing.difference_total)}
                  </td>
                  <td>{closing.closed_by_name || "-"}</td>
                  <td>{formatDateTime(closing.closed_at)}</td>
                  <td>
                    <button
                      className="dc-link-button"
                      type="button"
                      onClick={() =>
                        onOpenDate(String(closing.closing_date).slice(0, 10))
                      }
                    >
                      Open
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="dc-mobile-list">
        {closings.map((closing) => {
          const balanced =
            Math.abs(safeNumber(closing.difference_total)) < 0.01;
          return (
            <article className="dc-saved-card" key={closing.id}>
              <div className="dc-saved-card-head">
                <div>
                  <strong>{formatDate(closing.closing_date)}</strong>
                  <span>{closing.closed_by_name || "System"}</span>
                </div>
                <span
                  className={
                    balanced
                      ? "dc-mini-status dc-mini-status-ok"
                      : "dc-mini-status dc-mini-status-warning"
                  }
                >
                  {balanced ? "Balanced" : "Variance"}
                </span>
              </div>
              <div className="dc-mobile-facts">
                <span>
                  Expected <b>{formatMoney(closing.expected_total)}</b>
                </span>
                <span>
                  Counted <b>{formatMoney(closing.total_counted)}</b>
                </span>
                <span>
                  Difference <b>{formatMoney(closing.difference_total)}</b>
                </span>
                <span>
                  Closed <b>{formatDateTime(closing.closed_at)}</b>
                </span>
              </div>
              <button
                className="dc-secondary-button"
                type="button"
                onClick={() =>
                  onOpenDate(String(closing.closing_date).slice(0, 10))
                }
              >
                Open Closing
              </button>
            </article>
          );
        })}
      </div>
    </>
  );
}

export default function DailyClosingPage() {
  const { user, branchId, branchCode, branchName, branchLocation } = useAuth();

  const currentStoreCode =
    branchCode ||
    user?.branch_code ||
    user?.selected_branch?.branch_code ||
    user?.selected_branch?.code ||
    "STORE";
  const currentStoreName =
    branchName ||
    user?.branch_name ||
    user?.selected_branch?.branch_name ||
    user?.selected_branch?.name ||
    "Selected Store";
  const currentStoreLocation =
    branchLocation ||
    user?.branch_location ||
    user?.selected_branch?.branch_location ||
    user?.selected_branch?.location ||
    "";

  const [closingDate, setClosingDate] = useState(getTodayDate());
  const [summary, setSummary] = useState(null);
  const [closings, setClosings] = useState([]);
  const [controlSummary, setControlSummary] = useState(null);
  const [existingClosing, setExistingClosing] = useState(null);
  const [closingRevisions, setClosingRevisions] = useState([]);
  const [currentVsSavedDifference, setCurrentVsSavedDifference] = useState(0);

  const [cashCounted, setCashCounted] = useState("");
  const [momoCounted, setMomoCounted] = useState("");
  const [bankCounted, setBankCounted] = useState("");
  const [otherCounted, setOtherCounted] = useState("");
  const [notes, setNotes] = useState("");
  const [denominations, setDenominations] = useState({ ...EMPTY_DENOMINATIONS });
  const [useDenominationCounter, setUseDenominationCounter] = useState(false);
  const [countedConfirmed, setCountedConfirmed] = useState(false);
  const [verificationPassword, setVerificationPassword] = useState("");
  const [verificationNotes, setVerificationNotes] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [reconcilePassword, setReconcilePassword] = useState("");
  const [reconcileNotes, setReconcileNotes] = useState("");
  const [reconciling, setReconciling] = useState(false);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const alreadyClosed = Boolean(existingClosing);

  const denominationTotal = useMemo(() => {
    const notesTotal = DENOMINATIONS.reduce(
      (sum, [key, , value]) => sum + Math.max(Math.floor(Number(denominations[key] || 0)), 0) * value,
      0
    );
    return notesTotal + Math.max(Number(denominations.coins || 0), 0);
  }, [denominations]);

  useEffect(() => {
    if (useDenominationCounter && !alreadyClosed) {
      setCashCounted(denominationTotal.toFixed(2));
    }
  }, [denominationTotal, useDenominationCounter, alreadyClosed]);

  const counted = useMemo(
    () => ({
      cash: safeNumber(cashCounted),
      momo: safeNumber(momoCounted),
      bank: safeNumber(bankCounted),
      other: safeNumber(otherCounted),
    }),
    [cashCounted, momoCounted, bankCounted, otherCounted]
  );

  const countedTotal = useMemo(
    () => counted.cash + counted.momo + counted.bank + counted.other,
    [counted]
  );

  const expectedSnapshot = useMemo(() => {
    if (existingClosing) {
      return {
        cash: safeNumber(existingClosing.expected_cash),
        momo: safeNumber(existingClosing.expected_momo),
        bank: safeNumber(existingClosing.expected_bank),
        other: safeNumber(existingClosing.expected_other),
        total: safeNumber(existingClosing.expected_total),
      };
    }

    const cash = safeNumber(summary?.expected_cash);
    const momo = safeNumber(summary?.expected_momo);
    const bank = safeNumber(summary?.expected_bank);
    const other = safeNumber(summary?.expected_other);
    return { cash, momo, bank, other, total: cash + momo + bank + other };
  }, [existingClosing, summary]);

  const differenceTotal = useMemo(
    () => countedTotal - expectedSnapshot.total,
    [countedTotal, expectedSnapshot]
  );

  const reconciliationRows = useMemo(
    () => [
      {
        key: "cash",
        label: "Cash",
        icon: "💵",
        expected: expectedSnapshot.cash,
        counted: counted.cash,
      },
      {
        key: "momo",
        label: "Mobile Money",
        icon: "📱",
        expected: expectedSnapshot.momo,
        counted: counted.momo,
      },
      {
        key: "bank",
        label: "Bank",
        icon: "🏦",
        expected: expectedSnapshot.bank,
        counted: counted.bank,
      },
      {
        key: "other",
        label: "Other / Unallocated",
        icon: "🔀",
        expected: expectedSnapshot.other,
        counted: counted.other,
      },
    ].map((row) => ({
      ...row,
      difference: row.counted - row.expected,
    })),
    [expectedSnapshot, counted]
  );

  function fillClosingAmounts(closing) {
    setCashCounted(safeNumber(closing.cash_counted).toFixed(2));
    setMomoCounted(safeNumber(closing.momo_counted).toFixed(2));
    setBankCounted(safeNumber(closing.bank_counted).toFixed(2));
    setOtherCounted(safeNumber(closing.other_counted).toFixed(2));
    try {
      const savedDenominations = JSON.parse(closing.denomination_json || "{}");
      setDenominations({ ...EMPTY_DENOMINATIONS, ...savedDenominations });
      setUseDenominationCounter(
        denominationCounterHasEntries(savedDenominations)
      );
    } catch {
      setDenominations({ ...EMPTY_DENOMINATIONS });
      setUseDenominationCounter(false);
    }
    setCountedConfirmed(Boolean(Number(closing.counted_confirmed || 0)));
    setNotes(closing.notes || "");
  }

  async function loadSummary(dateValue = closingDate) {
    setLoading(true);
    setMessage("");
    setError("");

    try {
      const response = await axiosClient.get("/daily-closing/summary", {
        params: { date: dateValue },
      });
      const summaryData = response.data.summary;
      const savedClosing = response.data.existing_closing || null;

      setSummary(summaryData);
      setExistingClosing(savedClosing);
      setCurrentVsSavedDifference(
        safeNumber(response.data.current_vs_saved_difference)
      );

      if (savedClosing) {
        fillClosingAmounts(savedClosing);
        try {
          const revisionsResponse = await axiosClient.get(
            `/daily-closing/${savedClosing.id}/revisions`
          );
          setClosingRevisions(revisionsResponse.data.revisions || []);
        } catch {
          setClosingRevisions([]);
        }
      } else {
        setClosingRevisions([]);
        setCashCounted("");
        setMomoCounted("");
        setBankCounted("");
        setOtherCounted("");
        setDenominations({ ...EMPTY_DENOMINATIONS });
        setUseDenominationCounter(false);
        setCountedConfirmed(false);
        setNotes("");
      }
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Failed to load the daily closing summary."
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadClosings() {
    try {
      const response = await axiosClient.get("/daily-closing");
      setClosings(response.data.closings || []);
      setControlSummary(response.data.control_summary || null);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Failed to load saved daily closings."
      );
    }
  }

  useEffect(() => {
    loadSummary(closingDate);
    loadClosings();
    // The selected store is supplied through authenticated branch context.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  async function openClosingDate(dateValue) {
    setClosingDate(dateValue);
    await loadSummary(dateValue);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleDateChange(event) {
    const newDate = event.target.value;
    setClosingDate(newDate);
    await loadSummary(newDate);
  }

  function reportParams() {
    return {
      date: closingDate,
      cash_counted: counted.cash,
      momo_counted: counted.momo,
      bank_counted: counted.bank,
      other_counted: counted.other,
      denominations: JSON.stringify(
        useDenominationCounter ? denominations : {}
      ),
      counted_confirmed: countedConfirmed ? 1 : 0,
      notes,
    };
  }

  async function exportExcel() {
    setExporting("excel");
    setError("");

    try {
      const response = await axiosClient.get("/daily-closing/export.xlsx", {
        params: reportParams(),
        responseType: "blob",
      });
      const fallback = `Chalin03-Daily-Closing-${currentStoreCode}-${closingDate}.xlsx`;
      downloadBlob(response.data, getBlobFilename(response, fallback));
      setMessage("Advanced Daily Closing Excel workbook downloaded.");
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Failed to export the Daily Closing workbook."
      );
    } finally {
      setExporting("");
    }
  }

  async function openPdfReport() {
    setExporting("pdf");
    setError("");

    try {
      const response = await axiosClient.get("/daily-closing/report.pdf", {
        params: reportParams(),
        responseType: "blob",
      });
      const blobUrl = window.URL.createObjectURL(response.data);
      const newWindow = window.open(blobUrl, "_blank", "noopener,noreferrer");

      if (!newWindow) {
        const fallback = `Chalin03-Daily-Closing-${currentStoreCode}-${closingDate}.pdf`;
        downloadBlob(response.data, getBlobFilename(response, fallback));
      } else {
        window.setTimeout(() => window.URL.revokeObjectURL(blobUrl), 60000);
      }
      setMessage("Daily Closing PDF report generated successfully.");
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Failed to generate the Daily Closing PDF report."
      );
    } finally {
      setExporting("");
    }
  }


  async function exportWordReport() {
    setExporting("word");
    setError("");

    try {
      const response = await axiosClient.get("/daily-closing/report.doc", {
        params: reportParams(),
        responseType: "blob",
      });
      const fallback = `Chalin03-Daily-Closing-${currentStoreCode}-${closingDate}.doc`;
      downloadBlob(response.data, getBlobFilename(response, fallback));
      setMessage("Daily Closing Word report downloaded successfully.");
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Failed to generate the Daily Closing Word report."
      );
    } finally {
      setExporting("");
    }
  }

  async function saveDailyClosing(event) {
    event.preventDefault();
    setMessage("");
    setError("");

    if (!summary) {
      setError("Load the summary before closing the day.");
      return;
    }

    if ([cashCounted, momoCounted, bankCounted, otherCounted].some((value) => value === "")) {
      setError("Enter every counted/confirmed channel manually. Blank values are not allowed.");
      return;
    }

    if (!countedConfirmed) {
      setError("Confirm that physical cash was counted and MoMo/bank balances were checked independently.");
      return;
    }

    if (
      useDenominationCounter &&
      Math.abs(denominationTotal - safeNumber(cashCounted)) >= 0.01
    ) {
      setError(
        "The optional denomination total must equal the physical Cash counted amount."
      );
      return;
    }

    if (Math.abs(differenceTotal) >= 0.01 && !notes.trim()) {
      setError(
        "Explain the variance in Closing Notes before saving a closing that does not balance."
      );
      return;
    }

    const confirmed = window.confirm(
      `Close ${currentStoreCode} for ${closingDate}?\n\nExpected: ${formatMoney(
        expectedSnapshot.total
      )}\nCounted: ${formatMoney(countedTotal)}\nDifference: ${formatMoney(
        differenceTotal
      )}`
    );

    if (!confirmed) return;

    setSaving(true);

    try {
      const response = await axiosClient.post("/daily-closing", {
        closing_date: closingDate,
        cash_counted: counted.cash,
        momo_counted: counted.momo,
        bank_counted: counted.bank,
        other_counted: counted.other,
        denominations: useDenominationCounter ? denominations : {},
        counted_confirmed: true,
        notes,
      });

      setMessage(response.data.message || "Daily closing saved successfully.");
      await loadSummary(closingDate);
      await loadClosings();
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Failed to save the daily closing."
      );
    } finally {
      setSaving(false);
    }
  }

  async function reconcileDailyClosing(event) {
    event.preventDefault();
    setMessage("");
    setError("");

    if (!existingClosing?.id) {
      setError("Open a saved Daily Closing before reconciling changes.");
      return;
    }

    if (!reconcileNotes.trim()) {
      setError("Enter management revision notes explaining which approved transaction changed and what was checked.");
      return;
    }

    if (!reconcilePassword) {
      setError("Enter your own password to confirm management reconciliation.");
      return;
    }

    setReconciling(true);
    try {
      const response = await axiosClient.post(
        `/daily-closing/${existingClosing.id}/reconcile`,
        {
          password: reconcilePassword,
          revision_notes: reconcileNotes,
        }
      );
      setReconcilePassword("");
      setReconcileNotes("");
      setMessage(response.data.message || "Post-closing changes reconciled successfully.");
      await loadSummary(closingDate);
      await loadClosings();
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Failed to reconcile the changed Daily Closing."
      );
    } finally {
      setReconciling(false);
    }
  }

  async function verifyDailyClosing(event) {
    event.preventDefault();
    setMessage("");
    setError("");

    if (!existingClosing?.id) {
      setError("Open a saved Daily Closing before verification.");
      return;
    }

    if (!verificationPassword) {
      setError("Enter your own password to confirm independent management verification.");
      return;
    }

    if (Math.abs(safeNumber(existingClosing.difference_total)) >= 0.01 && !verificationNotes.trim()) {
      setError("Verification notes are required because this closing contains a variance.");
      return;
    }

    setVerifying(true);
    try {
      const response = await axiosClient.post(
        `/daily-closing/${existingClosing.id}/verify`,
        {
          password: verificationPassword,
          verification_notes: verificationNotes,
        }
      );
      setVerificationPassword("");
      setVerificationNotes("");
      setMessage(response.data.message || "Daily Closing verified successfully.");
      await loadSummary(closingDate);
      await loadClosings();
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Failed to verify the Daily Closing."
      );
    } finally {
      setVerifying(false);
    }
  }

  const branchDisplayCode = summary?.branch?.code || currentStoreCode;
  const branchDisplayName = summary?.branch?.name || currentStoreName;
  const branchDisplayLocation =
    summary?.branch?.location || currentStoreLocation;

  return (
    <main className="dc-page">
      <section className="dc-hero">
        <div className="dc-hero-copy">
          <span className="dc-kicker">Spare Parts · Financial Control</span>
          <h1>Advanced Daily Closing</h1>
          <p>
            Reconcile sales, debt collections, expenses and counted money for
            one store and one business day.
          </p>
          <div className="dc-store-line">
            <span aria-hidden="true">🏪</span>
            <div>
              <strong>
                {branchDisplayCode} — {branchDisplayName}
              </strong>
              <small>
                {branchDisplayLocation || "Selected store"} · Store-only data
              </small>
            </div>
          </div>
        </div>

        <div className="dc-hero-control">
          <div className="dc-date-control">
            <label htmlFor="dc-closing-date">Closing date</label>
            <input
              id="dc-closing-date"
              type="date"
              value={closingDate}
              onChange={handleDateChange}
            />
          </div>
          <StatusPill
            closing={existingClosing}
            difference={differenceTotal}
          />
          <div className="dc-hero-actions">
            <button
              className="dc-secondary-button"
              type="button"
              onClick={() => loadSummary(closingDate)}
              disabled={loading}
            >
              {loading ? "Refreshing…" : "↻ Refresh"}
            </button>
            <button
              className="dc-secondary-button"
              type="button"
              onClick={exportExcel}
              disabled={!summary || Boolean(exporting)}
            >
              {exporting === "excel" ? "Preparing…" : "📊 Excel"}
            </button>
            <button
              className="dc-primary-button"
              type="button"
              onClick={openPdfReport}
              disabled={!summary || Boolean(exporting)}
            >
              {exporting === "pdf" ? "Generating…" : "🖨 PDF Report"}
            </button>
            <button
              className="dc-secondary-button"
              type="button"
              onClick={exportWordReport}
              disabled={!summary || Boolean(exporting)}
            >
              {exporting === "word" ? "Preparing…" : "📝 Word"}
            </button>
          </div>
        </div>
      </section>

      {message && <div className="dc-alert dc-alert-success">{message}</div>}
      {error && <div className="dc-alert dc-alert-error">{error}</div>}

      {controlSummary && (
        <section className="dc-panel dc-control-centre">
          <div className="dc-section-heading">
            <div>
              <span className="dc-section-kicker">Owner and auditor watch</span>
              <h2>30-day cash-control exceptions</h2>
              <p>These indicators flag records for review. They do not automatically accuse any staff member.</p>
            </div>
          </div>
          <div className="dc-control-centre-grid">
            <div><span>Shortage days</span><strong>{controlSummary.shortage_count || 0}</strong><small>{formatMoney(controlSummary.shortage_total)} total shortage</small></div>
            <div><span>Variance closings</span><strong>{controlSummary.variance_count || 0}</strong><small>Counted did not equal expected</small></div>
            <div><span>Changed after closing</span><strong>{controlSummary.changed_after_close_count || 0}</strong><small>Revision review required</small></div>
            <div><span>Legacy count unconfirmed</span><strong>{controlSummary.legacy_unconfirmed_count || 0}</strong><small>Historical closings were not independently counted</small></div>
            <div><span>Awaiting verification</span><strong>{controlSummary.awaiting_verification_count || 0}</strong><small>Independent manager check pending</small></div>
            <div><span>Protected sale changes</span><strong>{controlSummary.protected_sale_change_count || 0}</strong><small>{controlSummary.protected_void_count || 0} approved void(s)</small></div>
          </div>
        </section>
      )}

      {loading && !summary && (
        <section className="dc-panel dc-loading-panel">
          <span className="dc-spinner" aria-hidden="true" />
          <div>
            <strong>Building the closing report…</strong>
            <p>Loading sales, debt collections, expenses and exceptions.</p>
          </div>
        </section>
      )}

      {summary && (
        <>
          {alreadyClosed && (
            <section className="dc-alert dc-alert-info dc-closed-notice">
              <div>
                <strong>This store day is already closed.</strong>
                <span>
                  Closed by {existingClosing?.closed_by_name || "System"} on{" "}
                  {formatDateTime(existingClosing?.closed_at)}.
                </span>
                <span>
                  Verification: {existingClosing?.verification_status || "submitted"}
                  {existingClosing?.verified_by_name
                    ? ` · Verified by ${existingClosing.verified_by_name} on ${formatDateTime(existingClosing.verified_at)}`
                    : " · Independent manager verification pending"}
                </span>
                {Number(existingClosing?.counted_confirmed || 0) !== 1 && (
                  <b>Legacy closing: the saved counted amounts were not independently confirmed under the current control process. Preserve it for history, but do not treat it as proof of an independent physical count.</b>
                )}
              </div>
              {(Boolean(Number(existingClosing?.stale_after_close || 0)) || Math.abs(currentVsSavedDifference) >= 0.01) && (
                <b>
                  ⚠ Changed after closing — current records differ from the original saved snapshot by{" "}
                  {formatMoney(currentVsSavedDifference)}. Management review is required; the original closing remains preserved.
                </b>
              )}
            </section>
          )}

          {alreadyClosed &&
            Boolean(Number(existingClosing?.stale_after_close || 0)) &&
            Number(existingClosing?.closed_by || 0) !== Number(user?.id || 0) && (
              <section className="dc-panel dc-reconciliation-panel">
                <div className="dc-section-heading">
                  <div>
                    <span className="dc-section-kicker">Post-closing revision control</span>
                    <h2>Reconcile changed closing</h2>
                    <p>
                      Review the approved sale edit, void, return, expense or debt payment. The system will recalculate the expected channels, preserve the original count, add a new immutable version and require independent verification again.
                    </p>
                  </div>
                </div>
                <form className="dc-verification-form" onSubmit={reconcileDailyClosing}>
                  <label>
                    Management revision notes
                    <textarea
                      value={reconcileNotes}
                      onChange={(event) => setReconcileNotes(event.target.value)}
                      placeholder="Example: Receipt 2678594 was approved from Cash to MoMo. Compared the receipt, MoMo statement and sale change history."
                      rows="3"
                    />
                  </label>
                  <label>
                    Your password
                    <input
                      type="password"
                      value={reconcilePassword}
                      onChange={(event) => setReconcilePassword(event.target.value)}
                      autoComplete="current-password"
                      placeholder="Enter your own account password"
                    />
                  </label>
                  <button className="dc-primary-button" type="submit" disabled={reconciling}>
                    {reconciling ? "Reconciling…" : "↻ Create Revised Version"}
                  </button>
                </form>
              </section>
            )}

          {alreadyClosed &&
            existingClosing?.verification_status !== "verified" &&
            Number(existingClosing?.counted_confirmed || 0) === 1 &&
            Number(existingClosing?.closed_by || 0) !== Number(user?.id || 0) &&
            Number(existingClosing?.stale_after_close || 0) !== 1 && (
              <section className="dc-panel dc-verification-panel">
                <div className="dc-section-heading">
                  <div>
                    <span className="dc-section-kicker">Independent control</span>
                    <h2>Manager verification</h2>
                    <p>
                      A different manager or administrator must recount the cash, confirm MoMo and bank balances, and enter their own password.
                    </p>
                  </div>
                </div>
                <form className="dc-verification-form" onSubmit={verifyDailyClosing}>
                  <label>
                    Verification notes
                    <textarea
                      value={verificationNotes}
                      onChange={(event) => setVerificationNotes(event.target.value)}
                      placeholder="State what was recounted, checked, or explained. Required when there is a variance."
                      rows="3"
                    />
                  </label>
                  <label>
                    Your password
                    <input
                      type="password"
                      value={verificationPassword}
                      onChange={(event) => setVerificationPassword(event.target.value)}
                      autoComplete="current-password"
                      placeholder="Enter your own account password"
                    />
                  </label>
                  <button className="dc-primary-button" type="submit" disabled={verifying}>
                    {verifying ? "Verifying…" : "✓ Verify Closing"}
                  </button>
                </form>
              </section>
            )}

          {alreadyClosed && closingRevisions.length > 0 && (
            <section className="dc-panel dc-revision-panel">
              <div className="dc-section-heading">
                <div>
                  <span className="dc-section-kicker">Immutable evidence</span>
                  <h2>Closing revision history</h2>
                  <p>The original submission remains visible. Later sale edits, voids, expenses, debt payments, returns and manager verification create new evidence entries instead of erasing history.</p>
                </div>
              </div>
              <div className="dc-revision-list">
                {closingRevisions.map((revision) => {
                  let expected = {};
                  let countedSnapshot = {};
                  try { expected = JSON.parse(revision.expected_snapshot_json || "{}"); } catch {}
                  try { countedSnapshot = JSON.parse(revision.counted_snapshot_json || "{}"); } catch {}
                  return (
                    <article key={revision.id} className="dc-revision-item">
                      <div className="dc-revision-head">
                        <strong>Version {revision.revision_number}</strong>
                        <span>{String(revision.revision_type || "revision").replaceAll("_", " ")}</span>
                        <time>{formatDateTime(revision.created_at)}</time>
                      </div>
                      <p>{revision.reason || "No reason recorded."}</p>
                      <div className="dc-revision-values">
                        <span>Saved expected <b>{formatMoney(expected.total)}</b></span>
                        <span>Counted <b>{formatMoney(countedSnapshot.total)}</b></span>
                        <span>Variance <b>{formatMoney(revision.difference_total)}</b></span>
                      </div>
                      <small>
                        Changed by {revision.changed_by_name || "System"} · Approved by {revision.approved_by_name || "Pending"}
                        {revision.source_entity_type ? ` · Source: ${revision.source_entity_type} ${revision.source_entity_id || ""}` : ""}
                      </small>
                    </article>
                  );
                })}
              </div>
            </section>
          )}

          <section className="dc-metric-grid" aria-label="Closing summary">
            <MetricCard
              eyebrow="Gross before discount"
              value={formatMoney(summary.gross_before_discount)}
              helper={`${summary.sales_count} completed sale(s)`}
              icon="⚡"
              tone="navy"
            />
            <MetricCard
              eyebrow="Discounts"
              value={formatMoney(summary.discount_total)}
              helper="Deducted before net sales"
              icon="🏷️"
              tone="amber"
            />
            <MetricCard
              eyebrow="Net sales"
              value={formatMoney(summary.sales_total)}
              helper={`Tax: ${formatMoney(summary.tax_total)}`}
              icon="📈"
              tone="blue"
            />
            <MetricCard
              eyebrow="Received during sales"
              value={formatMoney(summary.sales_received)}
              helper="Money collected on today's sales"
              icon="💳"
              tone="green"
            />
            <MetricCard
              eyebrow="Credit created today"
              value={formatMoney(summary.credit_created)}
              helper="Outstanding from today's sales"
              icon="🧾"
              tone="red"
            />
            <MetricCard
              eyebrow="Old debt collected"
              value={formatMoney(summary.debt_payments_total)}
              helper={`${summary.debt_payment_count} debt payment(s)`}
              icon="🤝"
              tone="purple"
            />
            <MetricCard
              eyebrow="Expenses"
              value={formatMoney(summary.expenses_total)}
              helper={`${summary.expenses_count} record(s) · ${formatMoney(
                summary.closing_expenses_total
              )} affects closing`}
              icon="🧯"
              tone="orange"
            />
            <MetricCard
              eyebrow="Expected net settlement"
              value={formatMoney(expectedSnapshot.total)}
              helper={
                alreadyClosed
                  ? "Saved closing snapshot"
                  : "Receipts + collections − closing-funded expenses"
              }
              icon="🎯"
              tone="gold"
            />
          </section>

          <section className="dc-panel">
            <div className="dc-section-heading">
              <div>
                <span className="dc-section-kicker">Payment analysis</span>
                <h2>Sales grouped by sale classification</h2>
                <p>
                  Cash, MoMo and Bank identify direct sales. Credit and Mixed
                  are informational sale arrangements; any deposit is counted
                  only in its recorded Cash, MoMo, Bank or Other settlement
                  channel.
                </p>
              </div>
            </div>

            <div className="dc-payment-grid">
              {(summary.payment_groups || []).map((group) => (
                <article className="dc-payment-card" key={group.key}>
                  <div className="dc-payment-card-head">
                    <span aria-hidden="true">
                      {PAYMENT_ICONS[group.key] || "💳"}
                    </span>
                    <div>
                      <strong>{group.label}</strong>
                      <small>{group.transaction_count} transaction(s)</small>
                    </div>
                  </div>
                  <dl>
                    <div>
                      <dt>Gross</dt>
                      <dd>{formatMoney(group.gross_before_discount)}</dd>
                    </div>
                    <div>
                      <dt>Discount</dt>
                      <dd>{formatMoney(group.discount_total)}</dd>
                    </div>
                    <div>
                      <dt>Net</dt>
                      <dd>{formatMoney(group.net_sales)}</dd>
                    </div>
                    <div>
                      <dt>
                        {isCreditArrangement(group.key)
                          ? "Deposit received"
                          : "Received"}
                      </dt>
                      <dd>{formatMoney(group.amount_received)}</dd>
                    </div>
                    <div>
                      <dt>
                        {isCreditArrangement(group.key)
                          ? "Credit created"
                          : "Outstanding"}
                      </dt>
                      <dd>{formatMoney(group.outstanding_created)}</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
          </section>

          <section className="dc-panel">
            <div className="dc-section-heading">
              <div>
                <span className="dc-section-kicker">Transaction register</span>
                <h2>Grouped sales detail</h2>
                <p>
                  Open any group to review receipts, customers, discounts,
                  the amount received when the sale was created, its exact
                  settlement channel and the credit created.
                </p>
              </div>
            </div>

            <div className="dc-accordion-list">
              {(summary.payment_groups || []).map((group, index) => {
                const transactions = (summary.sales_transactions || []).filter(
                  (sale) => sale.payment_type === group.key
                );
                return (
                  <details
                    className="dc-accordion"
                    key={group.key}
                    defaultOpen={index === 0}
                  >
                    <summary>
                      <div className="dc-accordion-title">
                        <span aria-hidden="true">
                          {PAYMENT_ICONS[group.key] || "💳"}
                        </span>
                        <div>
                          <strong>{group.label}</strong>
                          <small>
                            {transactions.length} transaction(s) · Received{" "}
                            {formatMoney(group.amount_received)}
                          </small>
                        </div>
                      </div>
                      <div className="dc-accordion-total">
                        <span>Net subtotal</span>
                        <b>{formatMoney(group.net_sales)}</b>
                      </div>
                    </summary>
                    <div className="dc-accordion-content">
                      <TransactionTable transactions={transactions} />
                      <div className="dc-group-subtotal">
                        <span>
                          Gross <b>{formatMoney(group.gross_before_discount)}</b>
                        </span>
                        <span>
                          Discount <b>{formatMoney(group.discount_total)}</b>
                        </span>
                        <span>
                          Net <b>{formatMoney(group.net_sales)}</b>
                        </span>
                        <span>
                          {isCreditArrangement(group.key)
                            ? "Deposit received"
                            : "Received"}{" "}
                          <b>{formatMoney(group.amount_received)}</b>
                        </span>
                        <span>
                          {isCreditArrangement(group.key)
                            ? "Credit created"
                            : "Outstanding"}{" "}
                          <b>{formatMoney(group.outstanding_created)}</b>
                        </span>
                      </div>
                    </div>
                  </details>
                );
              })}
            </div>
          </section>

          <section className="dc-split-grid">
            <article className="dc-panel">
              <div className="dc-section-heading dc-section-heading-compact">
                <div>
                  <span className="dc-section-kicker">Collections</span>
                  <h2>Debt payments received</h2>
                  <p>
                    Money collected today against debts created on earlier
                    sales.
                  </p>
                </div>
                <strong className="dc-heading-total">
                  {formatMoney(summary.debt_payments_total)}
                </strong>
              </div>

              {(summary.debt_payments || []).length === 0 ? (
                <EmptyState
                  title="No debt collections"
                  text="No customer debt payment was recorded for this date."
                />
              ) : (
                <div className="dc-simple-list">
                  {summary.debt_payments.map((payment) => (
                    <div className="dc-simple-row" key={payment.id}>
                      <div className="dc-simple-row-icon">
                        {PAYMENT_ICONS[payment.payment_method] || "💳"}
                      </div>
                      <div className="dc-simple-row-main">
                        <strong>{payment.customer_name}</strong>
                        <span>
                          {payment.receipt_number} ·{" "}
                          {String(payment.payment_method || "").toUpperCase()} ·{" "}
                          {formatTime(payment.paid_at)}
                        </span>
                      </div>
                      <div className="dc-simple-row-value">
                        <b>{formatMoney(payment.amount)}</b>
                        <small>{payment.received_by_name || "System"}</small>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </article>

            <article className="dc-panel">
              <div className="dc-section-heading dc-section-heading-compact">
                <div>
                  <span className="dc-section-kicker">Cash outflow</span>
                  <h2>Expenses</h2>
                  <p>
                    Only expenses explicitly paid from today&apos;s sales
                    receipts reduce Cash, MoMo, Bank or Other. Petty cash,
                    owner-funded and other external expenses remain visible for
                    accounting without reducing today&apos;s expected settlement.
                  </p>
                </div>
                <div className="dc-expense-heading-totals">
                  <strong className="dc-heading-total">
                    {formatMoney(summary.expenses_total)}
                  </strong>
                  <small>
                    Closing deduction:{" "}
                    {formatMoney(summary.closing_expenses_total)}
                  </small>
                  <small>
                    Accounting only:{" "}
                    {formatMoney(summary.external_expenses_total)}
                  </small>
                </div>
              </div>

              {(summary.expenses || []).length === 0 ? (
                <EmptyState
                  title="No expenses"
                  text="No business expense was recorded for this date."
                />
              ) : (
                <div className="dc-simple-list">
                  {summary.expenses.map((expense) => (
                    <div className="dc-simple-row" key={expense.id}>
                      <div className="dc-simple-row-icon">🧾</div>
                      <div className="dc-simple-row-main">
                        <strong>{expense.category || "Other"}</strong>
                        <span>{expense.description || "No description"}</span>
                        <small className="dc-expense-source">
                          {String(expense.funding_source || "other")
                            .replaceAll("_", " ")
                            .replace(/\b\w/g, (letter) =>
                              letter.toUpperCase()
                            )}
                          {" · "}
                          {Number(expense.affects_daily_closing) === 1
                            ? `Deduct from ${String(
                                expense.payment_method || "other"
                              ).toUpperCase()} closing`
                            : "Accounting only — does not reduce closing"}
                        </small>
                      </div>
                      <div className="dc-simple-row-value">
                        <b>{formatMoney(expense.amount)}</b>
                        <small>{expense.recorded_by_name || "System"}</small>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </article>
          </section>

          <section className="dc-panel dc-reconciliation-panel">
            <div className="dc-section-heading">
              <div>
                <span className="dc-section-kicker">Control desk</span>
                <h2>Expected versus counted reconciliation</h2>
                <p>
                  Enter the amount physically counted or independently
                  confirmed for each payment channel.
                </p>
              </div>
              <div className="dc-security-badge">Manual count required · No automatic balancing</div>
            </div>

            <form onSubmit={saveDailyClosing}>
              <div className="dc-reconciliation-grid">
                {reconciliationRows.map((row) => (
                  <article className="dc-reconciliation-card" key={row.key}>
                    <div className="dc-reconciliation-card-head">
                      <span aria-hidden="true">{row.icon}</span>
                      <strong>{row.label}</strong>
                    </div>
                    <div className="dc-expected-line">
                      <span>System expected</span>
                      <b>{formatMoney(row.expected)}</b>
                    </div>
                    <label htmlFor={`dc-counted-${row.key}`}>
                      Counted / confirmed
                    </label>
                    <div className="dc-money-input">
                      <span>GHS</span>
                      <input
                        id={`dc-counted-${row.key}`}
                        type="number"
                        min="0"
                        step="0.01"
                        value={
                          row.key === "cash"
                            ? cashCounted
                            : row.key === "momo"
                              ? momoCounted
                              : row.key === "bank"
                                ? bankCounted
                                : otherCounted
                        }
                        disabled={alreadyClosed}
                        readOnly={row.key === "cash" && useDenominationCounter}
                        onChange={(event) => {
                          const value = event.target.value;
                          if (row.key === "cash") setCashCounted(value);
                          if (row.key === "momo") setMomoCounted(value);
                          if (row.key === "bank") setBankCounted(value);
                          if (row.key === "other") setOtherCounted(value);
                        }}
                      />
                    </div>
                    <div
                      className={
                        Math.abs(row.difference) < 0.01
                          ? "dc-channel-difference dc-channel-difference-ok"
                          : "dc-channel-difference dc-channel-difference-warning"
                      }
                    >
                      <span>Difference</span>
                      <b>{formatMoney(row.difference)}</b>
                    </div>
                  </article>
                ))}
              </div>

              <div className="dc-optional-counter">
                <div className="dc-optional-counter-head">
                  <div>
                    <span className="dc-section-kicker">Optional counting aid</span>
                    <h3>Cash Denomination Counter</h3>
                    <p>
                      Enter Cash directly above, or use this optional note-and-coin
                      counter to calculate it. Daily Closing can be saved without
                      using this tool.
                    </p>
                  </div>
                  <label className="dc-counter-switch">
                    <input
                      type="checkbox"
                      checked={useDenominationCounter}
                      disabled={alreadyClosed}
                      onChange={(event) => {
                        const enabled = event.target.checked;
                        if (!enabled) {
                          setCashCounted(denominationTotal.toFixed(2));
                          setDenominations({ ...EMPTY_DENOMINATIONS });
                        }
                        setUseDenominationCounter(enabled);
                      }}
                    />
                    <span>Use denomination counter</span>
                  </label>
                </div>

                {useDenominationCounter ? (
                  <div className="dc-denomination-section dc-denomination-section-optional">
                    <div className="dc-denomination-grid">
                      {DENOMINATIONS.map(([key, label, faceValue]) => (
                        <label key={key}>
                          <span>{label}</span>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={denominations[key]}
                            disabled={alreadyClosed}
                            onChange={(event) =>
                              setDenominations((current) => ({
                                ...current,
                                [key]: event.target.value,
                              }))
                            }
                          />
                          <small>
                            {formatMoney(
                              Math.max(
                                Math.floor(Number(denominations[key] || 0)),
                                0
                              ) * faceValue
                            )}
                          </small>
                        </label>
                      ))}
                      <label>
                        <span>Coins total</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={denominations.coins}
                          disabled={alreadyClosed}
                          onChange={(event) =>
                            setDenominations((current) => ({
                              ...current,
                              coins: event.target.value,
                            }))
                          }
                        />
                        <small>Enter the combined coin value</small>
                      </label>
                    </div>
                    <div className="dc-denomination-total">
                      Optional denomination total
                      <strong>{formatMoney(denominationTotal)}</strong>
                    </div>
                  </div>
                ) : (
                  <div className="dc-counter-disabled-note">
                    Cash is being entered manually. The denomination counter is not
                    required for this closing.
                  </div>
                )}
              </div>

              <div className="dc-closing-total-bar">
                <div>
                  <span>Expected total</span>
                  <strong>{formatMoney(expectedSnapshot.total)}</strong>
                </div>
                <div>
                  <span>Counted total</span>
                  <strong>{formatMoney(countedTotal)}</strong>
                </div>
                <div
                  className={
                    Math.abs(differenceTotal) < 0.01
                      ? "dc-total-difference dc-total-difference-ok"
                      : "dc-total-difference dc-total-difference-warning"
                  }
                >
                  <span>Total difference</span>
                  <strong>{formatMoney(differenceTotal)}</strong>
                </div>
              </div>

              <label className="dc-count-confirmation">
                <input
                  type="checkbox"
                  checked={countedConfirmed}
                  disabled={alreadyClosed}
                  onChange={(event) => setCountedConfirmed(event.target.checked)}
                />
                <span>
                  I confirm that physical cash was counted and the MoMo, bank and other balances were checked independently. I entered the actual figures and did not copy the system expected amounts.
                </span>
              </label>

              <div className="dc-notes-area">
                <label htmlFor="dc-closing-notes">
                  Closing notes
                  {Math.abs(differenceTotal) >= 0.01 && (
                    <b> · Required because there is a variance</b>
                  )}
                </label>
                <textarea
                  id="dc-closing-notes"
                  value={notes}
                  disabled={alreadyClosed}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Example: Cash is GHS 20 short. Manager confirmed a pending petty cash receipt that will be recorded before review."
                  rows={4}
                />
              </div>

              <div className="dc-submit-row">
                <div className="dc-submit-guidance">
                  <strong>
                    {Math.abs(differenceTotal) < 0.01
                      ? "✓ The closing balances"
                      : "⚠ The closing contains a variance"}
                  </strong>
                  <span>
                    {alreadyClosed
                      ? "This record is locked against duplicate closing."
                      : Math.abs(differenceTotal) < 0.01
                        ? "Review the grouped transactions, then save the closing."
                        : "Record a clear explanation before saving."}
                  </span>
                </div>
                <button
                  className="dc-close-button"
                  type="submit"
                  disabled={saving || alreadyClosed}
                >
                  {saving
                    ? "Saving Closing…"
                    : alreadyClosed
                      ? "Day Already Closed"
                      : "✓ Confirm and Save Daily Closing"}
                </button>
              </div>
            </form>
          </section>

          {(summary.exceptions || []).length > 0 && (
            <section className="dc-panel dc-exception-panel">
              <div className="dc-section-heading">
                <div>
                  <span className="dc-section-kicker">Exception review</span>
                  <h2>Voided, returned or cancelled sales</h2>
                  <p>
                    These records are excluded from completed-sales totals but
                    remain visible for management review.
                  </p>
                </div>
                <span className="dc-exception-count">
                  {summary.exception_count} exception(s)
                </span>
              </div>
              <div className="dc-simple-list">
                {summary.exceptions.map((item) => (
                  <div className="dc-simple-row" key={item.id}>
                    <div className="dc-simple-row-icon">🛡️</div>
                    <div className="dc-simple-row-main">
                      <strong>
                        {item.receipt_number} · {item.customer_name}
                      </strong>
                      <span>
                        {item.is_voided
                          ? "VOIDED"
                          : String(item.sale_status || "").toUpperCase()}
                        {item.void_reason ? ` · ${item.void_reason}` : ""}
                      </span>
                    </div>
                    <div className="dc-simple-row-value">
                      <b>{formatMoney(item.total)}</b>
                      <small>{formatTime(item.created_at)}</small>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {(summary.risk_flags || []).length > 0 && (
            <section className="dc-panel dc-risk-panel">
              <div className="dc-section-heading">
                <div>
                  <span className="dc-section-kicker">Clean-hands review</span>
                  <h2>Security and error indicators</h2>
                  <p>These indicators require review but do not automatically prove theft or wrongdoing.</p>
                </div>
                <span className="dc-exception-count">{summary.risk_flag_count} flag(s)</span>
              </div>
              <div className="dc-simple-list">
                {summary.risk_flags.map((item) => (
                  <div className="dc-simple-row" key={item.id}>
                    <div className="dc-simple-row-icon">{item.severity === "high" ? "🚨" : "🔎"}</div>
                    <div className="dc-simple-row-main">
                      <strong>{String(item.risk_type || "review").replaceAll("_", " ")} · {item.receipt_number || "No receipt"}</strong>
                      <span>{item.details}</span>
                    </div>
                    <div className="dc-simple-row-value">
                      <b>{formatMoney(item.amount)}</b>
                      <small>{formatDateTime(item.occurred_at)}</small>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="dc-panel dc-notes-panel">
            <div className="dc-section-heading dc-section-heading-compact">
              <div>
                <span className="dc-section-kicker">How totals are built</span>
                <h2>Calculation notes</h2>
              </div>
            </div>
            <ul className="dc-note-list">
              {(summary.calculation_notes || []).map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </section>
        </>
      )}

      <section className="dc-panel">
        <div className="dc-section-heading">
          <div>
            <span className="dc-section-kicker">Closing archive</span>
            <h2>Saved Daily Closings · {currentStoreCode}</h2>
            <p>
              Open a previous closing to review its reconciliation or generate
              the new grouped Excel and PDF reports.
            </p>
          </div>
        </div>
        <SavedClosingList closings={closings} onOpenDate={openClosingDate} />
      </section>
    </main>
  );
}
