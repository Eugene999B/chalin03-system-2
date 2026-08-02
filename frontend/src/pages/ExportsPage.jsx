import { useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import "./ExportsPage.css";

const REPORTS = [
  {
    key: "products",
    title: "Products and Inventory",
    category: "Inventory",
    icon: "📦",
    endpoint: "/exports/products",
    description:
      "Product master list with categories, quantities, cost prices, selling prices, barcodes and status.",
    dateFilter: false,
  },
  {
    key: "low-stock-restock",
    title: "Low Stock and Restock Plan",
    category: "Inventory",
    icon: "🚨",
    endpoint: "/exports/low-stock",
    description:
      "Low-stock and out-of-stock items with suggested purchase quantities and estimated restock cost.",
    dateFilter: false,
  },
  {
    key: "stock-adjustments",
    title: "Stock Adjustments",
    category: "Inventory",
    icon: "🧮",
    endpoint: "/exports/stock-adjustments",
    description:
      "Stock corrections showing previous quantity, new quantity, adjustment reason and responsible staff.",
    dateFilter: true,
  },
  {
    key: "stock-transfers",
    title: "Stock Transfers",
    category: "Inventory",
    icon: "🔁",
    endpoint: "/exports/stock-transfers",
    description:
      "Transfer requests, approvals, dispatches, receiving records and item movement between stores.",
    dateFilter: true,
  },
  {
    key: "stock-movement-ledger",
    title: "Stock Movement Ledger",
    category: "Inventory",
    icon: "📚",
    endpoint: "/exports/stock-ledger",
    description:
      "Complete audit ledger for purchases, sales, returns, adjustments, transfers and running stock balances.",
    dateFilter: true,
  },
  {
    key: "daily-closings",
    title: "Daily Closings",
    category: "Finance",
    icon: "🧾",
    endpoint: "/exports/daily-closings",
    description:
      "Advanced period summary, sales mix, channel reconciliation, counted money, variances and closing controls.",
    dateFilter: true,
    featured: true,
  },
  {
    key: "sales",
    title: "Sales Transactions",
    category: "Sales",
    icon: "🛒",
    endpoint: "/exports/sales",
    description:
      "Sales history with receipts, customers, payment methods, discounts, paid amounts and outstanding balances.",
    dateFilter: true,
  },
  {
    key: "debts",
    title: "Customer Debts",
    category: "Finance",
    icon: "📒",
    endpoint: "/exports/debts",
    description:
      "Customer debt register showing original debt, payments received, outstanding balance and status.",
    dateFilter: false,
  },
  {
    key: "debt-payments",
    title: "Debt Payments",
    category: "Finance",
    icon: "💳",
    endpoint: "/exports/debt-payments",
    description:
      "Debt collection history grouped by customer, receipt, payment method, receiver and payment date.",
    dateFilter: true,
  },
  {
    key: "expenses",
    title: "Business Expenses",
    category: "Finance",
    icon: "💸",
    endpoint: "/exports/expenses",
    description:
      "Expense register for transport, utilities, rent, internet, operations and other business costs.",
    dateFilter: true,
  },
  {
    key: "purchases",
    title: "Purchases and Suppliers",
    category: "Purchasing",
    icon: "🚚",
    endpoint: "/exports/purchases",
    description:
      "Purchase records, supplier invoices, purchase items, payments and outstanding supplier balances.",
    dateFilter: true,
  },
  {
    key: "returns",
    title: "Customer Returns",
    category: "Sales",
    icon: "↩️",
    endpoint: "/exports/returns",
    description:
      "Returned items with receipt numbers, customer details, products, quantities, reasons and dates.",
    dateFilter: true,
  },
];

const FORMAT_OPTIONS = [
  { key: "xlsx", label: "Excel", icon: "📊", extension: "xlsx" },
  { key: "pdf", label: "PDF", icon: "📄", extension: "pdf" },
  { key: "doc", label: "Word", icon: "📝", extension: "doc" },
];

function toLocalIsoDate(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function extractFilename(headers, fallback) {
  const disposition = headers?.["content-disposition"] || "";
  const utfMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);

  if (utfMatch?.[1]) {
    return decodeURIComponent(utfMatch[1].replace(/["']/g, ""));
  }

  const normalMatch = disposition.match(/filename="?([^";]+)"?/i);
  return normalMatch?.[1] || fallback;
}

export default function ExportsPage() {
  const { user, branchCode, branchName, branchLocation } = useAuth();
  const role = String(user?.role || "").toLowerCase();

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

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const categories = useMemo(
    () => ["All", ...new Set(REPORTS.map((report) => report.category))],
    []
  );

  const visibleReports = useMemo(() => {
    const query = search.trim().toLowerCase();

    return REPORTS.filter((report) => {
      const matchesCategory = category === "All" || report.category === category;
      const matchesSearch =
        !query ||
        report.title.toLowerCase().includes(query) ||
        report.category.toLowerCase().includes(query) ||
        report.description.toLowerCase().includes(query);

      return matchesCategory && matchesSearch;
    });
  }, [category, search]);

  function makeSafeFileName(value) {
    return String(value || "store")
      .replace(/[^a-z0-9]/gi, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase();
  }

  function buildStoreFileName(reportKey, format) {
    const option = FORMAT_OPTIONS.find((item) => item.key === format);
    const extension = option?.extension || "xlsx";
    const periodPart =
      from || to
        ? `-${from || "earliest"}-to-${to || "latest"}`
        : "";

    return `chalin03-${makeSafeFileName(
      currentStoreCode
    )}-${reportKey}${periodPart}.${extension}`;
  }

  function validateDates() {
    if (from && to && from > to) {
      setError("The From Date cannot be later than the To Date.");
      return false;
    }

    return true;
  }

  async function readExportError(errorValue) {
    const data = errorValue?.response?.data;

    try {
      if (data instanceof Blob) {
        const text = await data.text();
        const parsed = JSON.parse(text);
        return parsed?.message || text;
      }

      return data?.message || errorValue?.message || "Export failed.";
    } catch {
      return errorValue?.message || "Export failed.";
    }
  }

  async function downloadReport(report, format) {
    if (!validateDates()) return;

    const requestKey = `${report.key}-${format}`;
    setBusyKey(requestKey);
    setError("");
    setNotice("");

    try {
      const response = await axiosClient.get(report.endpoint, {
        params: {
          format,
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
        },
        responseType: "blob",
      });

      const fallbackFilename = buildStoreFileName(report.key, format);
      const filename = extractFilename(response.headers, fallbackFilename);
      const fileUrl = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = fileUrl;
      link.setAttribute("download", filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(fileUrl);

      const formatLabel =
        FORMAT_OPTIONS.find((option) => option.key === format)?.label || format;
      const selectedPeriod =
        from || to
          ? ` for ${from || "the earliest available date"} to ${
              to || "the latest available date"
            }`
          : "";
      setNotice(
        `${report.title} ${formatLabel} export${selectedPeriod} downloaded successfully.`
      );
    } catch (downloadError) {
      const message = await readExportError(downloadError);
      setError(
        message ||
          "Export failed. Confirm your login, selected store and report permission."
      );
    } finally {
      setBusyKey("");
    }
  }

  function applyDatePreset(preset) {
    const today = new Date();

    if (preset === "today") {
      const value = toLocalIsoDate(today);
      setFrom(value);
      setTo(value);
      return;
    }

    if (preset === "yesterday") {
      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);
      const value = toLocalIsoDate(yesterday);
      setFrom(value);
      setTo(value);
      return;
    }

    if (preset === "month") {
      const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
      setFrom(toLocalIsoDate(firstDay));
      setTo(toLocalIsoDate(today));
      return;
    }

    setFrom("");
    setTo("");
  }

  if (!["admin", "manager", "auditor"].includes(role)) {
    return (
      <div className="export-center-v3">
        <div className="page-header">
          <div>
            <h1>Access Denied</h1>
            <p>
              You are not allowed to open Export Centre for {currentStoreCode} —{" "}
              {currentStoreName}.
            </p>
          </div>
        </div>

        <div className="error-box">
          Only admin, manager and auditor accounts can export business records.
        </div>
      </div>
    );
  }

  return (
    <div className="export-center-v3">
      <section className="ec-hero">
        <div>
          <span className="ec-eyebrow">REPORTING AND DOCUMENT CENTRE</span>
          <h1>Professional Export Centre</h1>
          <p>
            Download every business report as a professionally arranged Excel
            workbook, print-ready PDF or editable Microsoft Word document.
          </p>
        </div>

        <div className="ec-hero-badge" aria-label="Available export formats">
          <strong>3 formats</strong>
          <span>Excel • PDF • Word</span>
        </div>
      </section>

      <section className="ec-store-banner">
        <div className="ec-store-icon">🏪</div>
        <div>
          <span>Current selected store</span>
          <strong>
            {currentStoreCode} — {currentStoreName}
          </strong>
          {currentStoreLocation && <small>{currentStoreLocation}</small>}
        </div>
        <div className="ec-protection-pill">Store-protected export</div>
      </section>

      {error && <div className="error-box ec-message">{error}</div>}
      {notice && <div className="success-box ec-message">{notice}</div>}

      <section className="ec-controls-card">
        <div className="ec-control-heading">
          <div>
            <span className="ec-eyebrow">REPORT PERIOD</span>
            <h2>Choose the reporting dates</h2>
          </div>
          <p>
            Every download prints the exact selected From and To dates.
            Date-sensitive reports also filter their rows; products, low stock
            and open debts remain current snapshots prepared for that selected
            reporting period.
          </p>
        </div>

        <div className="ec-date-grid">
          <label>
            <span>From Date</span>
            <input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>

          <label>
            <span>To Date</span>
            <input
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </label>

          <div className="ec-presets" aria-label="Date shortcuts">
            <button type="button" onClick={() => applyDatePreset("today")}>Today</button>
            <button type="button" onClick={() => applyDatePreset("yesterday")}>Yesterday</button>
            <button type="button" onClick={() => applyDatePreset("month")}>This Month</button>
            <button type="button" onClick={() => applyDatePreset("clear")}>Clear</button>
          </div>
        </div>
      </section>

      <section className="ec-library-heading">
        <div>
          <span className="ec-eyebrow">REPORT LIBRARY</span>
          <h2>Select a report and format</h2>
          <p>{visibleReports.length} report(s) currently displayed.</p>
        </div>

        <div className="ec-library-filters">
          <label className="ec-search-box">
            <span aria-hidden="true">🔎</span>
            <input
              type="search"
              placeholder="Search reports..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>

          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            aria-label="Filter reports by category"
          >
            {categories.map((item) => (
              <option key={item} value={item}>
                {item === "All" ? "All categories" : item}
              </option>
            ))}
          </select>
        </div>
      </section>

      <div className="ec-report-grid">
        {visibleReports.map((report) => (
          <article
            key={report.key}
            className={`ec-report-card${report.featured ? " is-featured" : ""}`}
          >
            <div className="ec-report-topline">
              <div className="ec-report-icon" aria-hidden="true">{report.icon}</div>
              <div>
                <span className="ec-category">{report.category}</span>
                {report.featured && <span className="ec-featured">Advanced</span>}
              </div>
            </div>

            <h3>{report.title}</h3>
            <p>{report.description}</p>

            <div className="ec-report-meta">
              <span>
                {report.dateFilter
                  ? "Filters rows by selected dates"
                  : "Current snapshot • selected period shown"}
              </span>
              <span>{currentStoreCode}</span>
            </div>

            <div className="ec-format-actions">
              {FORMAT_OPTIONS.map((format) => {
                const requestKey = `${report.key}-${format.key}`;
                const isBusy = busyKey === requestKey;

                return (
                  <button
                    key={format.key}
                    type="button"
                    className={`ec-format-button format-${format.key}`}
                    disabled={Boolean(busyKey)}
                    onClick={() => downloadReport(report, format.key)}
                  >
                    <span aria-hidden="true">{format.icon}</span>
                    <strong>{isBusy ? "Preparing…" : format.label}</strong>
                  </button>
                );
              })}
            </div>
          </article>
        ))}
      </div>

      {visibleReports.length === 0 && (
        <div className="ec-empty-state">
          <span aria-hidden="true">🗂️</span>
          <h3>No reports match your search</h3>
          <p>Clear the search text or choose another category.</p>
        </div>
      )}

      <section className="ec-guidance">
        <div>
          <strong>Excel</strong>
          <span>Executive summary, organised worksheets, filters and print settings.</span>
        </div>
        <div>
          <strong>PDF</strong>
          <span>Print-ready pages with repeated headings, readable column groups and page numbers.</span>
        </div>
        <div>
          <strong>Word</strong>
          <span>Editable Microsoft Word document with cover page, summaries and detailed tables.</span>
        </div>
      </section>
    </div>
  );
}
