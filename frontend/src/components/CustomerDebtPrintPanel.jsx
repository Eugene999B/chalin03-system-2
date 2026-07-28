import { useEffect, useMemo, useState } from "react";

import axiosClient from "../api/axiosClient";
import "../styles/customerDebtPrintPanel.css";

function dateInputValue(date) {
  return date.toISOString().slice(0, 10);
}

function defaultFromDate() {
  const date = new Date();
  date.setDate(date.getDate() - 30);
  return dateInputValue(date);
}

function getDispositionFilename(response, fallback) {
  const disposition = response.headers?.["content-disposition"] || "";
  const match = disposition.match(/filename="?([^";]+)"?/i);
  return match?.[1] || fallback;
}

function downloadBlob(response, fallbackName) {
  const blob = new Blob([response.data], {
    type: response.headers?.["content-type"] || "application/octet-stream",
  });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = getDispositionFilename(response, fallbackName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 60000);
}

export default function CustomerDebtPrintPanel({
  currentStoreCode = "STORE",
  preferredCustomer = null,
  preferredCustomerId = null,
  reportType = "debt",
}) {
  const preferredSearch = useMemo(
    () =>
      preferredCustomer?.customer_phone ||
      preferredCustomer?.phone ||
      preferredCustomer?.customer_name ||
      preferredCustomer?.name ||
      "",
    [preferredCustomer]
  );

  const [filters, setFilters] = useState({
    from: defaultFromDate(),
    to: dateInputValue(new Date()),
    customer: preferredSearch,
    customer_id: preferredCustomerId ? String(preferredCustomerId) : "",
    debt_status: "",
  });
  const [exporting, setExporting] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!preferredSearch && !preferredCustomerId) return;
    setFilters((current) => ({
      ...current,
      customer: preferredSearch || current.customer,
      customer_id: preferredCustomerId ? String(preferredCustomerId) : "",
    }));
  }, [preferredSearch, preferredCustomerId]);

  async function createReport(format) {
    setError("");
    setMessage("");

    if (filters.from && filters.to && filters.from > filters.to) {
      setError("The start date cannot be after the end date.");
      return;
    }

    setExporting(format);
    try {
      const response = await axiosClient.get(
        `/customer-statement-workspace/export/${format}`,
        {
          params: {
            report_type: reportType,
            from: filters.from,
            to: filters.to,
            customer: filters.customer.trim(),
            customer_id: filters.customer_id,
            debt_status: reportType === "debt" ? filters.debt_status : "",
          },
          responseType: "blob",
        }
      );

      if (format === "print") {
        const url = window.URL.createObjectURL(
          new Blob([response.data], { type: "application/pdf" })
        );
        const printWindow = window.open(url, "_blank", "noopener,noreferrer");
        if (!printWindow) {
          downloadBlob(response, `chalin03-${reportType}-report.pdf`);
          setMessage(
            "The browser blocked the print tab, so the PDF was downloaded. Open it and choose Print."
          );
        } else {
          setMessage("The printer-ready filtered report opened in a new tab.");
        }
        window.setTimeout(() => window.URL.revokeObjectURL(url), 120000);
      } else {
        const extension = format === "word" ? "doc" : format === "excel" ? "xlsx" : "pdf";
        downloadBlob(
          response,
          `chalin03-${currentStoreCode.toLowerCase()}-${reportType}-report.${extension}`
        );
        setMessage(`${format.toUpperCase()} downloaded using the filters shown here.`);
      }
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Unable to generate the filtered customer report."
      );
    } finally {
      setExporting("");
    }
  }

  return (
    <section className="customer-debt-print-panel">
      <div className="customer-debt-print-heading">
        <div>
          <p>Filtered Financial Export</p>
          <h2>{reportType === "debt" ? "Debt Report" : "Customer Statement"}</h2>
          <span>
            Date only prints the whole date range. Adding a customer name or phone narrows that same result.
          </span>
        </div>
        <div className="customer-debt-print-badge">Screen Filters → Export</div>
      </div>

      {message ? <div className="customer-debt-print-message success">{message}</div> : null}
      {error ? <div className="customer-debt-print-message error">{error}</div> : null}

      <div className="customer-debt-print-grid customer-debt-print-grid-filtered">
        <label>
          <span>From Date</span>
          <input
            type="date"
            value={filters.from}
            onChange={(event) =>
              setFilters((current) => ({ ...current, from: event.target.value }))
            }
          />
        </label>

        <label>
          <span>To Date</span>
          <input
            type="date"
            value={filters.to}
            onChange={(event) =>
              setFilters((current) => ({ ...current, to: event.target.value }))
            }
          />
        </label>

        <label className="customer-debt-print-customer">
          <span>Customer Name or Phone</span>
          <input
            type="search"
            value={filters.customer}
            onChange={(event) =>
              setFilters((current) => ({ ...current, customer: event.target.value }))
            }
            placeholder="Leave blank for all customers"
          />
        </label>

        {reportType === "debt" ? (
          <label>
            <span>Debt Status</span>
            <select
              value={filters.debt_status}
              onChange={(event) =>
                setFilters((current) => ({ ...current, debt_status: event.target.value }))
              }
            >
              <option value="">All Statuses</option>
              <option value="unpaid">Unpaid</option>
              <option value="partial">Partial</option>
              <option value="paid">Paid</option>
              <option value="overdue">Overdue</option>
            </select>
          </label>
        ) : null}
      </div>

      <div className="customer-debt-export-actions">
        <button type="button" onClick={() => createReport("print")} disabled={Boolean(exporting)}>
          🖨️ {exporting === "print" ? "Opening..." : "Print"}
        </button>
        <button type="button" onClick={() => createReport("pdf")} disabled={Boolean(exporting)}>
          📄 {exporting === "pdf" ? "Preparing..." : "PDF"}
        </button>
        <button type="button" onClick={() => createReport("word")} disabled={Boolean(exporting)}>
          📝 {exporting === "word" ? "Preparing..." : "Word"}
        </button>
        <button type="button" onClick={() => createReport("excel")} disabled={Boolean(exporting)}>
          📊 {exporting === "excel" ? "Preparing..." : "Excel"}
        </button>
      </div>

      <small className="customer-debt-print-note">
        The generated file contains the exact selected store, date range, customer search and debt status shown above.
      </small>
    </section>
  );
}
