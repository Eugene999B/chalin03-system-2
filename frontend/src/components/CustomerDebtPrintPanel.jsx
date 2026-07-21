import { useEffect, useMemo, useState } from "react";

import axiosClient from "../api/axiosClient";
import "../styles/customerDebtPrintPanel.css";

function dateInputValue(date) {
  return date.toISOString().slice(0, 10);
}

function defaultStartDate() {
  const date = new Date();
  date.setDate(date.getDate() - 30);
  return dateInputValue(date);
}

function customerKey(customer) {
  if (customer?.customer_id) return `id:${customer.customer_id}`;
  if (customer?.customer_phone) return `phone:${customer.customer_phone}`;
  return `name:${customer?.customer_name || ""}`;
}

function getDispositionFilename(response, fallback) {
  const disposition = response.headers?.["content-disposition"] || "";
  const match = disposition.match(/filename="?([^";]+)"?/i);
  return match?.[1] || fallback;
}

export default function CustomerDebtPrintPanel({
  currentStoreCode = "STORE",
  preferredCustomer = null,
}) {
  const [reportType, setReportType] = useState("statement");
  const [scope, setScope] = useState("selected");
  const [from, setFrom] = useState(defaultStartDate);
  const [to, setTo] = useState(() => dateInputValue(new Date()));
  const [customers, setCustomers] = useState([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const selectedCustomer = useMemo(
    () =>
      customers.find((customer) => customerKey(customer) === selectedKey) || null,
    [customers, selectedKey]
  );

  useEffect(() => {
    let cancelled = false;

    async function loadCustomers() {
      setLoadingCustomers(true);
      setError("");
      try {
        const response = await axiosClient.get(
          "/customer-debt-reports/customers",
          {
            params: {
              report_type: reportType,
              from,
              to,
            },
          }
        );

        if (cancelled) return;
        const nextCustomers = response.data.customers || [];
        setCustomers(nextCustomers);

        const preferredKey = preferredCustomer
          ? customerKey({
              customer_id: preferredCustomer.id || preferredCustomer.customer_id,
              customer_name:
                preferredCustomer.name || preferredCustomer.customer_name,
              customer_phone:
                preferredCustomer.phone || preferredCustomer.customer_phone,
            })
          : "";

        if (
          preferredKey &&
          nextCustomers.some(
            (customer) => customerKey(customer) === preferredKey
          )
        ) {
          setSelectedKey(preferredKey);
        } else {
          setSelectedKey((current) =>
            nextCustomers.some(
              (customer) => customerKey(customer) === current
            )
              ? current
              : customerKey(nextCustomers[0])
          );
        }
      } catch (requestError) {
        if (!cancelled) {
          setCustomers([]);
          setSelectedKey("");
          setError(
            requestError.response?.data?.message ||
              "Unable to load customers for the printable report."
          );
        }
      } finally {
        if (!cancelled) setLoadingCustomers(false);
      }
    }

    loadCustomers();

    return () => {
      cancelled = true;
    };
  }, [reportType, from, to, preferredCustomer]);

  async function openPrintablePdf() {
    setMessage("");
    setError("");

    if (from && to && from > to) {
      setError("The start date cannot be after the end date.");
      return;
    }

    if (scope === "selected" && !selectedCustomer) {
      setError(
        "Choose a customer or switch the customer scope to All Customers."
      );
      return;
    }

    setPrinting(true);

    try {
      const params = {
        report_type: reportType,
        scope,
        from,
        to,
      };

      if (scope === "selected" && selectedCustomer) {
        params.customer_id = selectedCustomer.customer_id || "";
        params.name = selectedCustomer.customer_name || "";
        params.phone = selectedCustomer.customer_phone || "";
      }

      const response = await axiosClient.get("/customer-debt-reports/pdf", {
        params,
        responseType: "blob",
      });

      const blobUrl = window.URL.createObjectURL(
        new Blob([response.data], { type: "application/pdf" })
      );
      const filename = getDispositionFilename(
        response,
        `chalin03-${String(currentStoreCode).toLowerCase()}-${reportType}-report.pdf`
      );
      const printWindow = window.open(blobUrl, "_blank", "noopener,noreferrer");

      if (!printWindow) {
        const link = document.createElement("a");
        link.href = blobUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setMessage(
          "Your browser blocked the print tab, so the PDF was downloaded. Open it and choose Print."
        );
      } else {
        setMessage(
          "Printable PDF opened. Use the PDF viewer's Print button to choose a printer."
        );
      }

      window.setTimeout(() => window.URL.revokeObjectURL(blobUrl), 120000);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Unable to generate the printable customer report."
      );
    } finally {
      setPrinting(false);
    }
  }

  return (
    <section className="customer-debt-print-panel">
      <div className="customer-debt-print-heading">
        <div>
          <p>Customer Financial Printing</p>
          <h2>Choose exactly what to print</h2>
          <span>
            Print a customer statement or debt report for a selected date range,
            one customer or all customers in {currentStoreCode}.
          </span>
        </div>
        <div className="customer-debt-print-badge">PDF / Printer Ready</div>
      </div>

      {message ? (
        <div className="customer-debt-print-message success">{message}</div>
      ) : null}
      {error ? (
        <div className="customer-debt-print-message error">{error}</div>
      ) : null}

      <div className="customer-debt-print-grid">
        <label>
          <span>Document Type</span>
          <select
            value={reportType}
            onChange={(event) => setReportType(event.target.value)}
          >
            <option value="statement">Customer Statement</option>
            <option value="debt">Debt Report</option>
          </select>
        </label>

        <label>
          <span>Customer Scope</span>
          <select
            value={scope}
            onChange={(event) => setScope(event.target.value)}
          >
            <option value="selected">Selected Customer</option>
            <option value="all">All Customers</option>
          </select>
        </label>

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

        <label className="customer-debt-print-customer">
          <span>Customer</span>
          <select
            value={selectedKey}
            disabled={scope === "all" || loadingCustomers}
            onChange={(event) => setSelectedKey(event.target.value)}
          >
            {customers.length === 0 ? (
              <option value="">
                {loadingCustomers
                  ? "Loading customers..."
                  : "No customers in this date range"}
              </option>
            ) : (
              customers.map((customer) => (
                <option
                  key={customerKey(customer)}
                  value={customerKey(customer)}
                >
                  {customer.customer_name || "Customer"}
                  {customer.customer_phone
                    ? ` — ${customer.customer_phone}`
                    : ""}
                </option>
              ))
            )}
          </select>
        </label>

        <button type="button" onClick={openPrintablePdf} disabled={printing}>
          {printing ? "Preparing PDF..." : "Open Printable PDF"}
        </button>
      </div>

      <small className="customer-debt-print-note">
        Customer Statements include every purchased item, quantity, unit price
        and line total. Debt Reports show debt value, payments, balance, status
        and due date.
      </small>
    </section>
  );
}
