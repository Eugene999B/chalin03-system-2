import { useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";

function MobilePageFix() {
  return (
    <style>{`
      @media (max-width: 820px) {
        .boss-mobile-fix {
          width: 100% !important;
          max-width: 100% !important;
          min-width: 0 !important;
          overflow-x: hidden !important;
          padding: 10px !important;
          margin: 0 !important;
        }

        .boss-mobile-fix,
        .boss-mobile-fix * {
          box-sizing: border-box !important;
        }

        .boss-mobile-fix * {
          max-width: 100% !important;
        }

        .boss-mobile-fix section,
        .boss-mobile-fix article,
        .boss-mobile-fix form,
        .boss-mobile-fix header,
        .boss-mobile-fix main,
        .boss-mobile-fix aside {
          width: 100% !important;
          max-width: 100% !important;
          min-width: 0 !important;
        }

        .boss-mobile-fix [style*="display: grid"],
        .boss-mobile-fix [style*="grid-template-columns"] {
          grid-template-columns: minmax(0, 1fr) !important;
        }

        .boss-mobile-fix [style*="display: flex"] {
          flex-wrap: wrap !important;
        }

        .boss-mobile-fix [style*="justify-content: space-between"] {
          justify-content: flex-start !important;
        }

        .boss-mobile-fix [style*="align-items: center"] {
          min-width: 0 !important;
        }

        .boss-mobile-fix [style*="width:"],
        .boss-mobile-fix [style*="min-width"],
        .boss-mobile-fix [style*="max-width"] {
          min-width: 0 !important;
        }

        .boss-mobile-fix [style*="width: 420"],
        .boss-mobile-fix [style*="width: 360"],
        .boss-mobile-fix [style*="width: 340"],
        .boss-mobile-fix [style*="width: 320"],
        .boss-mobile-fix [style*="width: 300"],
        .boss-mobile-fix [style*="width: 280"],
        .boss-mobile-fix [style*="width: 260"],
        .boss-mobile-fix [style*="width: 240"],
        .boss-mobile-fix [style*="min-width: 420"],
        .boss-mobile-fix [style*="min-width: 360"],
        .boss-mobile-fix [style*="min-width: 340"],
        .boss-mobile-fix [style*="min-width: 320"],
        .boss-mobile-fix [style*="min-width: 300"],
        .boss-mobile-fix [style*="min-width: 280"],
        .boss-mobile-fix [style*="min-width: 260"],
        .boss-mobile-fix [style*="min-width: 240"] {
          width: 100% !important;
          min-width: 0 !important;
        }

        .boss-mobile-fix [style*="padding: 34"],
        .boss-mobile-fix [style*="padding: 32"],
        .boss-mobile-fix [style*="padding: 30"],
        .boss-mobile-fix [style*="padding: 28"],
        .boss-mobile-fix [style*="padding: 26"],
        .boss-mobile-fix [style*="padding: 24"],
        .boss-mobile-fix [style*="padding: 22"],
        .boss-mobile-fix [style*="padding: 20"] {
          padding: 16px !important;
        }

        .boss-mobile-fix [style*="border-radius: 40"],
        .boss-mobile-fix [style*="border-radius: 36"],
        .boss-mobile-fix [style*="border-radius: 34"],
        .boss-mobile-fix [style*="border-radius: 32"],
        .boss-mobile-fix [style*="border-radius: 30"],
        .boss-mobile-fix [style*="border-radius: 28"] {
          border-radius: 22px !important;
        }

        .boss-mobile-fix h1,
        .boss-mobile-fix [style*="font-size: 56"],
        .boss-mobile-fix [style*="font-size: 54"],
        .boss-mobile-fix [style*="font-size: 52"],
        .boss-mobile-fix [style*="font-size: 50"],
        .boss-mobile-fix [style*="font-size: 48"],
        .boss-mobile-fix [style*="font-size: 46"],
        .boss-mobile-fix [style*="font-size: 44"],
        .boss-mobile-fix [style*="font-size: 42"],
        .boss-mobile-fix [style*="font-size: 40"] {
          font-size: 31px !important;
          line-height: 1.06 !important;
          letter-spacing: -0.04em !important;
        }

        .boss-mobile-fix h2,
        .boss-mobile-fix [style*="font-size: 32"],
        .boss-mobile-fix [style*="font-size: 30"],
        .boss-mobile-fix [style*="font-size: 28"] {
          font-size: 21px !important;
          line-height: 1.15 !important;
        }

        .boss-mobile-fix h3,
        .boss-mobile-fix [style*="font-size: 24"],
        .boss-mobile-fix [style*="font-size: 22"] {
          font-size: 18px !important;
          line-height: 1.2 !important;
        }

        .boss-mobile-fix p,
        .boss-mobile-fix span,
        .boss-mobile-fix small,
        .boss-mobile-fix strong,
        .boss-mobile-fix label,
        .boss-mobile-fix td,
        .boss-mobile-fix th {
          overflow-wrap: anywhere !important;
          word-break: normal !important;
        }

        .boss-mobile-fix input,
        .boss-mobile-fix select,
        .boss-mobile-fix textarea {
          width: 100% !important;
          max-width: 100% !important;
          min-width: 0 !important;
          font-size: 16px !important;
        }

        .boss-mobile-fix button {
          max-width: 100% !important;
          white-space: normal !important;
          overflow-wrap: anywhere !important;
        }

        .boss-mobile-fix table {
          width: 100% !important;
          min-width: 760px !important;
        }

        .boss-mobile-fix [style*="overflow-x: auto"],
        .boss-mobile-fix [style*="overflow: auto"],
        .boss-mobile-fix [style*="overflowX"] {
          width: 100% !important;
          max-width: 100% !important;
          overflow-x: auto !important;
          -webkit-overflow-scrolling: touch !important;
        }

        .boss-mobile-fix [style*="position: absolute"] {
          pointer-events: none !important;
        }
      }

      @media (max-width: 480px) {
        .boss-mobile-fix {
          padding: 8px !important;
        }

        .boss-mobile-fix [style*="gap: 24"],
        .boss-mobile-fix [style*="gap: 22"],
        .boss-mobile-fix [style*="gap: 20"],
        .boss-mobile-fix [style*="gap: 18"] {
          gap: 12px !important;
        }

        .boss-mobile-fix [style*="padding: 18"],
        .boss-mobile-fix [style*="padding: 16"] {
          padding: 13px !important;
        }

        .boss-mobile-fix h1 {
          font-size: 29px !important;
        }

        .boss-mobile-fix table {
          min-width: 720px !important;
        }
      }
    `}</style>
  );
}


export default function CustomerStatementPage() {
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

  const [query, setQuery] = useState("");
  const [customers, setCustomers] = useState([]);
  const [statement, setStatement] = useState(null);

  const [searching, setSearching] = useState(false);
  const [loadingStatement, setLoadingStatement] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");

  function formatMoney(value) {
    return `GHS ${Number(value || 0).toFixed(2)}`;
  }

  function formatCompactMoney(value) {
    const number = Number(value || 0);

    if (number >= 1000000) {
      return `GHS ${(number / 1000000).toFixed(1)}M`;
    }

    if (number >= 1000) {
      return `GHS ${(number / 1000).toFixed(1)}K`;
    }

    return formatMoney(number);
  }

  function formatDateTime(value) {
    if (!value) return "-";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "-";
    }

    return date.toLocaleString();
  }

  function formatDate(value) {
    if (!value) return "-";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "-";
    }

    return date.toLocaleDateString();
  }

  function formatPaymentMethod(value) {
    const methods = {
      cash: "Cash",
      momo: "MoMo",
      bank: "Bank",
      credit: "Credit",
      mixed: "Mixed",
    };

    return methods[String(value || "").toLowerCase()] || value || "-";
  }

  function formatStatus(value) {
    const statuses = {
      completed: "Completed",
      paid: "Paid",
      unpaid: "Unpaid",
      partial: "Partial",
      cancelled: "Cancelled",
      voided: "Voided",
    };

    return statuses[String(value || "").toLowerCase()] || value || "-";
  }

  function isVoidedSale(sale) {
    const status = String(sale?.sale_status || "").toLowerCase();

    return (
      Number(sale?.is_voided || 0) === 1 ||
      status === "cancelled" ||
      status === "voided"
    );
  }

  function makeSafeFileName(value) {
    return String(value || "customer")
      .replace(/[^a-z0-9]/gi, "-")
      .replace(/-+/g, "-")
      .toLowerCase();
  }

  function getRecordStoreCode(record) {
    return record?.branch_code || record?.store_code || currentStoreCode;
  }

  function getRecordStoreName(record) {
    return record?.branch_name || record?.store_name || currentStoreName;
  }

  function getCustomerInitials() {
    const name = statement?.customer?.name || statement?.customer?.phone || "Customer";

    return String(name)
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase();
  }

  useEffect(() => {
    setCustomers([]);
    setStatement(null);
    setError("");
  }, [branchId]);

  async function searchCustomers(event) {
    event.preventDefault();

    setError("");
    setStatement(null);

    if (!query.trim()) {
      setCustomers([]);
      setError("Enter customer name or phone number.");
      return;
    }

    setSearching(true);

    try {
      const response = await axiosClient.get("/customer-statements/search", {
        params: {
          query: query.trim(),
        },
      });

      setCustomers(response.data.customers || []);
    } catch (error) {
      setError(
        error.response?.data?.message || "Failed to search customer records."
      );
    } finally {
      setSearching(false);
    }
  }

  async function loadStatement(customer) {
    setError("");
    setLoadingStatement(true);

    try {
      const response = await axiosClient.get("/customer-statements", {
        params: {
          name: customer.customer_name || "",
          phone: customer.customer_phone || "",
        },
      });

      setStatement(response.data);
    } catch (error) {
      setError(
        error.response?.data?.message || "Failed to load customer statement."
      );
    } finally {
      setLoadingStatement(false);
    }
  }

  async function exportStatement() {
    setError("");

    if (!statement?.customer?.name && !statement?.customer?.phone) {
      setError("Load a customer statement before exporting.");
      return;
    }

    setExporting(true);

    try {
      const response = await axiosClient.get("/exports/customer-statement", {
        params: {
          name: statement.customer?.name || "",
          phone: statement.customer?.phone || "",
        },
        responseType: "blob",
      });

      const fileUrl = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");

      const safeName = makeSafeFileName(
        statement.customer?.phone || statement.customer?.name || "customer"
      );

      link.href = fileUrl;
      link.setAttribute(
        "download",
        `chalin03-${makeSafeFileName(
          currentStoreCode
        )}-customer-statement-${safeName}.xlsx`
      );

      document.body.appendChild(link);
      link.click();

      link.remove();
      window.URL.revokeObjectURL(fileUrl);
    } catch (error) {
      setError(
        "Failed to export customer statement. Make sure the backend export route is working."
      );
    } finally {
      setExporting(false);
    }
  }

  const statementHealth = useMemo(() => {
    const outstanding = Number(statement?.summary?.total_outstanding || 0);
    const totalSales = Number(statement?.summary?.total_sales || 0);
    const debtsCount = Number(statement?.summary?.debts_count || 0);

    if (!statement) {
      return {
        label: "No customer loaded",
        tone: "neutral",
        note: "Search and open a customer statement.",
        score: 0,
      };
    }

    if (outstanding <= 0) {
      return {
        label: "Clear",
        tone: "good",
        note: "No outstanding balance for this customer.",
        score: 100,
      };
    }

    const ratio = totalSales > 0 ? (outstanding / totalSales) * 100 : 100;

    if (ratio >= 50 || debtsCount >= 3) {
      return {
        label: "High Follow-up",
        tone: "danger",
        note: "Customer needs strong debt follow-up.",
        score: 35,
      };
    }

    if (ratio >= 20) {
      return {
        label: "Watch",
        tone: "warning",
        note: "Customer has some outstanding balance.",
        score: 65,
      };
    }

    return {
      label: "Stable",
      tone: "good",
      note: "Customer balance is manageable.",
      score: 82,
    };
  }, [statement]);

  const customerTimeline = useMemo(() => {
    if (!statement) return [];

    const saleRecords = (statement.sales || []).map((sale) => ({
      id: `sale-${sale.id}`,
      date: sale.created_at,
      type: "Sale",
      title: sale.receipt_number || "Sale receipt",
      amount: isVoidedSale(sale) ? 0 : Number(sale.total || 0),
      description: `${formatPaymentMethod(sale.payment_type)} • ${
        isVoidedSale(sale) ? "Voided/Cancelled" : formatStatus(sale.sale_status)
      }`,
      store: getRecordStoreCode(sale),
      status: isVoidedSale(sale) ? "voided" : "sale",
    }));

    const debtRecords = (statement.debts || []).map((debt) => ({
      id: `debt-${debt.id}`,
      date: debt.created_at,
      type: "Debt",
      title: debt.receipt_number || "Debt record",
      amount: Number(debt.balance || 0),
      description: `${formatStatus(debt.status)} • Due ${formatDate(
        debt.due_date
      )}`,
      store: getRecordStoreCode(debt),
      status: String(debt.status || "").toLowerCase(),
    }));

    const paymentRecords = (statement.debt_payments || []).map((payment) => ({
      id: `payment-${payment.id}`,
      date: payment.paid_at,
      type: "Debt Payment",
      title: payment.receipt_number || "Debt payment",
      amount: Number(payment.amount || 0),
      description: `${formatPaymentMethod(payment.payment_method)} • Received by ${
        payment.received_by_name || "-"
      }`,
      store: getRecordStoreCode(payment),
      status: "payment",
    }));

    return [...saleRecords, ...debtRecords, ...paymentRecords]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 12);
  }, [statement]);

  return (
    <div className="boss-mobile-fix" style={styles.page}>
      <MobilePageFix />
      <section style={styles.hero}>
        <div style={styles.heroPattern} />

        <div style={styles.heroContent}>
          <div>
            <p style={styles.eyebrow}>Customer Ledger Desk • {currentStoreCode}</p>

            <h1 style={styles.heroTitle}>Customer Statement</h1>

            <p style={styles.heroSubtitle}>
              Search one customer and review sales, debts, payments and
              outstanding balance for <strong>{currentStoreName}</strong>
              {currentStoreLocation ? ` - ${currentStoreLocation}` : ""}.
              This page is designed like a customer account file for management
              review.
            </p>
          </div>

          <div style={styles.fileCard}>
            <span>🗂️</span>
            <div>
              <strong>{statement ? "Statement Open " : "No File Open "}</strong>
              <small>{statement?.customer?.name || "Search customer first"}</small>
            </div>
          </div>
        </div>
      </section>

      <div style={styles.storeNotice}>
        <span style={styles.noticeIcon}>🏬</span>
        <div>
          <strong>
            Current selected store: {currentStoreCode} — {currentStoreName}
          </strong>
          {currentStoreLocation ? <p>{currentStoreLocation}</p> : null}
          <p>
            Customer search, statements, sales, debt records and exports are
            filtered to this selected store only.
          </p>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div style={styles.workspaceGrid}>
        <aside style={styles.searchPanel}>
          <div style={styles.panelHeader}>
            <div>
              <p style={styles.eyebrowDark}>Find Customer</p>
              <h2 style={styles.panelTitle}>Search Statement</h2>
              <p style={styles.panelSubtitle}>
                Search by customer name or phone number.
              </p>
            </div>
          </div>

          <form onSubmit={searchCustomers}>
            <label>Customer Name or Phone</label>
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Example: Ama or 024..."
            />

            <button type="submit" disabled={searching} style={styles.primaryButton}>
              {searching ? "Searching..." : "Search Customer"}
            </button>
          </form>

          <div style={styles.searchHint}>
            <strong>Tip</strong>
            <p>
              Use phone number when names are repeated. The statement will show
              sales, debts and debt payments for this selected store.
            </p>
          </div>

          {customers.length > 0 && (
            <div style={styles.customerResults}>
              <div style={styles.resultsHeader}>
                <strong>Search Results</strong>
                <span>{customers.length}</span>
              </div>

              {customers.map((customer, index) => (
                <button
                  type="button"
                  key={`${customer.customer_phone || "no-phone"}-${index}`}
                  onClick={() => loadStatement(customer)}
                  disabled={loadingStatement}
                  style={styles.customerResultCard}
                >
                  <div>
                    <strong>{customer.customer_name || "Customer"}</strong>
                    <span>{customer.customer_phone || "-"}</span>
                    <small>
                      {getRecordStoreCode(customer)} •{" "}
                      {Number(customer.sales_count || 0)} sale(s)
                    </small>
                  </div>

                  <b>{formatMoney(customer.sales_balance)}</b>
                </button>
              ))}
            </div>
          )}
        </aside>

        <main style={styles.statementArea}>
          {loadingStatement && (
            <div style={styles.loadingPanel}>
              Loading customer statement...
            </div>
          )}

          {!loadingStatement && !statement && (
            <div style={styles.emptyStatement}>
              <span>📄</span>
              <h2>No customer statement opened yet</h2>
              <p>
                Search for a customer on the left, then click a result to open
                their sales, debts and payment history.
              </p>
            </div>
          )}

          {statement && (
            <>
              <section style={styles.customerHeader}>
                <div style={styles.avatar}>{getCustomerInitials()}</div>

                <div style={styles.customerIdentity}>
                  <p style={styles.eyebrowDark}>Customer Account File</p>
                  <h2>{statement.customer?.name || "Customer"}</h2>
                  <p>
                    Phone: <strong>{statement.customer?.phone || "-"}</strong>
                    {" • "}
                    Store: <strong>{currentStoreCode}</strong>
                  </p>
                </div>

                <button
                  type="button"
                  onClick={exportStatement}
                  disabled={exporting}
                  style={styles.exportButton}
                >
                  {exporting ? "Exporting..." : "Export Statement"}
                </button>
              </section>

              <section style={styles.healthPanel}>
                <div>
                  <p style={styles.eyebrowDark}>Account Status</p>
                  <h2>{statementHealth.label}</h2>
                  <p>{statementHealth.note}</p>
                </div>

                <div style={styles.scoreCircle}>
                  <div
                    style={{
                      ...styles.scoreRing,
                      background: `conic-gradient(#0f766e 0deg ${
                        statementHealth.score * 3.6
                      }deg, #e2e8f0 ${
                        statementHealth.score * 3.6
                      }deg 360deg)`,
                    }}
                  >
                    <span>{statementHealth.score}%</span>
                  </div>
                </div>
              </section>

              <section style={styles.summaryGrid}>
                <SummaryCard
                  label={`${currentStoreCode} Total Sales`}
                  value={formatMoney(statement.summary?.total_sales)}
                  note="All valid sales for customer"
                  icon="🧾"
                />

                <SummaryCard
                  label="Paid on Sales"
                  value={formatMoney(statement.summary?.total_paid_on_sales)}
                  note="Amount paid during sales"
                  icon="💵"
                />

                <SummaryCard
                  label="Debt Payments"
                  value={formatMoney(statement.summary?.total_debt_payments)}
                  note="Later payments received"
                  icon="✅"
                />

                <SummaryCard
                  label="Total Received"
                  value={formatMoney(statement.summary?.total_received)}
                  note="All money collected"
                  icon="🏦"
                />

                <SummaryCard
                  label="Outstanding"
                  value={formatMoney(statement.summary?.total_outstanding)}
                  note="Balance still unpaid"
                  icon="⚠️"
                />

                <SummaryCard
                  label="Debt Records"
                  value={Number(statement.summary?.debts_count || 0)}
                  note="Customer debt entries"
                  icon="📌"
                />
              </section>

              <div style={styles.detailGrid}>
                <section style={styles.tablePanel}>
                  <SectionTitle
                    eyebrow="Sales"
                    title={`Sales History - ${currentStoreCode}`}
                    count={statement.sales?.length || 0}
                  />

                  {statement.sales?.length === 0 ? (
                    <EmptyLine text={`No sales found for this customer in ${currentStoreCode}.`} />
                  ) : (
                    <div style={styles.tableWrap}>
                      <table>
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Receipt</th>
                            <th>Store</th>
                            <th>Total</th>
                            <th>Paid</th>
                            <th>Balance</th>
                            <th>Payment</th>
                            <th>Status</th>
                            <th>Staff</th>
                          </tr>
                        </thead>

                        <tbody>
                          {statement.sales.map((sale) => {
                            const voided = isVoidedSale(sale);

                            return (
                              <tr key={sale.id}>
                                <td>{formatDateTime(sale.created_at)}</td>
                                <td>
                                  <strong>{sale.receipt_number}</strong>
                                  <br />
                                  <small>{getRecordStoreName(sale)}</small>
                                </td>
                                <td>{getRecordStoreCode(sale)}</td>
                                <td>{voided ? "VOIDED" : formatMoney(sale.total)}</td>
                                <td>
                                  {voided ? "VOIDED" : formatMoney(sale.amount_paid)}
                                </td>
                                <td>
                                  {voided ? "VOIDED" : formatMoney(sale.balance)}
                                </td>
                                <td>{formatPaymentMethod(sale.payment_type)}</td>
                                <td>
                                  <StatusPill
                                    status={
                                      voided ? "Voided/Cancelled" : sale.sale_status
                                    }
                                    danger={voided}
                                  />
                                </td>
                                <td>{sale.staff_name || "-"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                <section style={styles.tablePanel}>
                  <SectionTitle
                    eyebrow="Debts"
                    title={`Debt Records - ${currentStoreCode}`}
                    count={statement.debts?.length || 0}
                  />

                  {statement.debts?.length === 0 ? (
                    <EmptyLine text={`No debt records found for this customer in ${currentStoreCode}.`} />
                  ) : (
                    <div style={styles.tableWrap}>
                      <table>
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Receipt</th>
                            <th>Store</th>
                            <th>Amount Owed</th>
                            <th>Amount Paid</th>
                            <th>Balance</th>
                            <th>Status</th>
                            <th>Due Date</th>
                          </tr>
                        </thead>

                        <tbody>
                          {statement.debts.map((debt) => (
                            <tr key={debt.id}>
                              <td>{formatDateTime(debt.created_at)}</td>
                              <td>{debt.receipt_number || "-"}</td>
                              <td>{getRecordStoreCode(debt)}</td>
                              <td>{formatMoney(debt.amount_owed)}</td>
                              <td>{formatMoney(debt.amount_paid)}</td>
                              <td>
                                <strong>{formatMoney(debt.balance)}</strong>
                              </td>
                              <td>
                                <StatusPill status={formatStatus(debt.status)} />
                              </td>
                              <td>{formatDate(debt.due_date)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                <section style={styles.tablePanel}>
                  <SectionTitle
                    eyebrow="Payments"
                    title={`Debt Payment History - ${currentStoreCode}`}
                    count={statement.debt_payments?.length || 0}
                  />

                  {statement.debt_payments?.length === 0 ? (
                    <EmptyLine text={`No debt payments found for this customer in ${currentStoreCode}.`} />
                  ) : (
                    <div style={styles.tableWrap}>
                      <table>
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Receipt</th>
                            <th>Store</th>
                            <th>Amount</th>
                            <th>Method</th>
                            <th>Received By</th>
                            <th>Notes</th>
                          </tr>
                        </thead>

                        <tbody>
                          {statement.debt_payments.map((payment) => (
                            <tr key={payment.id}>
                              <td>{formatDateTime(payment.paid_at)}</td>
                              <td>{payment.receipt_number || "-"}</td>
                              <td>{getRecordStoreCode(payment)}</td>
                              <td>
                                <strong>{formatMoney(payment.amount)}</strong>
                              </td>
                              <td>{formatPaymentMethod(payment.payment_method)}</td>
                              <td>{payment.received_by_name || "-"}</td>
                              <td>{payment.notes || "-"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                <section style={styles.timelinePanel}>
                  <SectionTitle
                    eyebrow="Timeline"
                    title="Recent Customer Activity"
                    count={customerTimeline.length}
                  />

                  {customerTimeline.length === 0 ? (
                    <EmptyLine text="No timeline records found." />
                  ) : (
                    <div style={styles.timelineList}>
                      {customerTimeline.map((entry) => (
                        <div key={entry.id} style={styles.timelineItem}>
                          <div style={styles.timelineDot} />

                          <div>
                            <div style={styles.timelineTop}>
                              <strong>{entry.type}</strong>
                              <span>{formatDateTime(entry.date)}</span>
                            </div>

                            <p>
                              {entry.title} • {entry.store}
                            </p>

                            <small>
                              {entry.description} • {formatMoney(entry.amount)}
                            </small>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, note, icon }) {
  return (
    <div style={styles.summaryCard}>
      <span>{icon}</span>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        <small>{note}</small>
      </div>
    </div>
  );
}

function SectionTitle({ eyebrow, title, count }) {
  return (
    <div style={styles.sectionTitle}>
      <div>
        <p style={styles.eyebrowDark}>{eyebrow}</p>
        <h2>{title}</h2>
      </div>

      <span>{count} record(s)</span>
    </div>
  );
}

function EmptyLine({ text }) {
  return <div style={styles.emptyLine}>{text}</div>;
}

function StatusPill({ status, danger }) {
  return (
    <span style={{ ...styles.statusPill, ...(danger ? styles.statusDanger : {}) }}>
      {status || "-"}
    </span>
  );
}

const styles = {
  page: {
    width: "100%",
    maxWidth: "1720px",
    margin: "0 auto",
    paddingBottom: "44px",
  },

  hero: {
    position: "relative",
    overflow: "hidden",
    borderRadius: "30px",
    padding: "28px",
    marginBottom: "18px",
    background:
      "linear-gradient(135deg, #f8fafc 0%, #fff7ed 52%, #ecfeff 100%)",
    border: "1px solid rgba(203, 213, 225, 0.9)",
    boxShadow: "0 24px 70px rgba(15, 23, 42, 0.10)",
    color: "#0f172a",
  },

  heroPattern: {
    position: "absolute",
    inset: 0,
    background:
      "radial-gradient(circle at top right, rgba(224, 186, 40, 0.24), transparent 32%), radial-gradient(circle at 18% 80%, rgba(15, 118, 110, 0.14), transparent 32%)",
  },

  heroContent: {
    position: "relative",
    zIndex: 2,
    display: "flex",
    justifyContent: "space-between",
    gap: "18px",
    alignItems: "flex-start",
    flexWrap: "wrap",
  },

  eyebrow: {
    margin: 0,
    color: "#0f766e",
    fontWeight: "950",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    fontSize: "12px",
  },

  eyebrowDark: {
    margin: 0,
    color: "#b45309",
    fontWeight: "950",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    fontSize: "11px",
  },

  heroTitle: {
    margin: "7px 0 0",
    fontSize: "clamp(30px, 4vw, 52px)",
    lineHeight: 1.03,
    fontWeight: "950",
    color: "#0f172a",
  },

  heroSubtitle: {
    margin: "10px 0 0",
    maxWidth: "850px",
    color: "#475569",
    fontSize: "15px",
    lineHeight: 1.7,
  },

  fileCard: {
    display: "flex",
    gap: "12px",
    alignItems: "center",
    minWidth: "230px",
    padding: "15px",
    borderRadius: "22px",
    background: "rgba(255, 255, 255, 0.75)",
    border: "1px solid rgba(203, 213, 225, 0.9)",
    boxShadow: "0 14px 36px rgba(15, 23, 42, 0.08)",
  },

  storeNotice: {
    display: "flex",
    gap: "12px",
    alignItems: "flex-start",
    marginBottom: "18px",
    padding: "14px 16px",
    borderRadius: "18px",
    background: "linear-gradient(135deg, #eff6ff, #ffffff)",
    border: "1px solid #bfdbfe",
    color: "#1e3a8a",
    boxShadow: "0 12px 30px rgba(15, 23, 42, 0.06)",
  },

  noticeIcon: {
    fontSize: "22px",
  },

  workspaceGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(300px, 0.35fr) minmax(0, 1fr)",
    gap: "18px",
    alignItems: "start",
  },

  searchPanel: {
    position: "sticky",
    top: "18px",
    background: "#ffffff",
    borderRadius: "26px",
    padding: "20px",
    border: "1px solid rgba(226, 232, 240, 0.95)",
    boxShadow: "0 18px 45px rgba(15, 23, 42, 0.08)",
    minWidth: 0,
  },

  panelHeader: {
    marginBottom: "16px",
  },

  panelTitle: {
    margin: "4px 0 0",
    color: "#0f172a",
    fontSize: "22px",
    fontWeight: "950",
  },

  panelSubtitle: {
    margin: "5px 0 0",
    color: "#64748b",
    fontSize: "13px",
    lineHeight: 1.5,
  },

  primaryButton: {
    width: "100%",
    marginTop: "12px",
    border: "none",
    borderRadius: "15px",
    padding: "12px 14px",
    background: "#0f766e",
    color: "#ffffff",
    fontWeight: "950",
    cursor: "pointer",
    boxShadow: "0 12px 26px rgba(15, 118, 110, 0.22)",
  },

  searchHint: {
    marginTop: "16px",
    padding: "13px",
    borderRadius: "18px",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    color: "#475569",
  },

  customerResults: {
    display: "grid",
    gap: "10px",
    marginTop: "16px",
  },

  resultsHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: "10px",
    alignItems: "center",
    color: "#0f172a",
  },

  customerResultCard: {
    width: "100%",
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    alignItems: "center",
    textAlign: "left",
    border: "1px solid #e2e8f0",
    borderRadius: "18px",
    padding: "12px",
    background: "#ffffff",
    color: "#0f172a",
    cursor: "pointer",
  },

  statementArea: {
    minWidth: 0,
  },

  loadingPanel: {
    padding: "20px",
    borderRadius: "22px",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    color: "#475569",
    fontWeight: "850",
    boxShadow: "0 18px 45px rgba(15, 23, 42, 0.08)",
  },

  emptyStatement: {
    minHeight: "360px",
    display: "grid",
    placeItems: "center",
    textAlign: "center",
    padding: "30px",
    borderRadius: "28px",
    background: "#ffffff",
    border: "1px dashed #cbd5e1",
    color: "#64748b",
    boxShadow: "0 18px 45px rgba(15, 23, 42, 0.08)",
  },

  customerHeader: {
    display: "flex",
    alignItems: "center",
    gap: "16px",
    flexWrap: "wrap",
    background: "#ffffff",
    borderRadius: "26px",
    padding: "18px",
    border: "1px solid rgba(226, 232, 240, 0.95)",
    boxShadow: "0 18px 45px rgba(15, 23, 42, 0.08)",
    marginBottom: "18px",
  },

  avatar: {
    width: "74px",
    height: "74px",
    borderRadius: "24px",
    display: "grid",
    placeItems: "center",
    background: "#0f766e",
    color: "#ffffff",
    fontSize: "24px",
    fontWeight: "950",
    flexShrink: 0,
  },

  customerIdentity: {
    flex: 1,
    minWidth: "220px",
  },

  exportButton: {
    border: "none",
    borderRadius: "15px",
    padding: "12px 14px",
    background: "#e0ba28",
    color: "#07182c",
    fontWeight: "950",
    cursor: "pointer",
    boxShadow: "0 12px 26px rgba(224, 186, 40, 0.22)",
  },

  healthPanel: {
    display: "flex",
    justifyContent: "space-between",
    gap: "16px",
    alignItems: "center",
    flexWrap: "wrap",
    background:
      "linear-gradient(135deg, rgba(236, 253, 245, 0.95), rgba(255,255,255,0.98))",
    borderRadius: "26px",
    padding: "18px",
    border: "1px solid #bbf7d0",
    boxShadow: "0 18px 45px rgba(15, 23, 42, 0.08)",
    marginBottom: "18px",
    color: "#14532d",
  },

  scoreCircle: {
    width: "118px",
    height: "118px",
    display: "grid",
    placeItems: "center",
  },

  scoreRing: {
    width: "112px",
    height: "112px",
    borderRadius: "50%",
    display: "grid",
    placeItems: "center",
    color: "#0f172a",
    fontWeight: "950",
    boxShadow: "inset 0 0 0 1px rgba(15,23,42,0.08)",
  },

  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
    gap: "14px",
    marginBottom: "18px",
  },

  summaryCard: {
    display: "flex",
    gap: "12px",
    alignItems: "center",
    background: "#ffffff",
    borderRadius: "22px",
    padding: "16px",
    border: "1px solid #e2e8f0",
    boxShadow: "0 14px 34px rgba(15, 23, 42, 0.07)",
    minWidth: 0,
  },

  detailGrid: {
    display: "grid",
    gap: "18px",
  },

  tablePanel: {
    background: "#ffffff",
    borderRadius: "26px",
    padding: "18px",
    border: "1px solid rgba(226, 232, 240, 0.95)",
    boxShadow: "0 18px 45px rgba(15, 23, 42, 0.08)",
    minWidth: 0,
  },

  sectionTitle: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    alignItems: "flex-start",
    flexWrap: "wrap",
    marginBottom: "14px",
  },

  tableWrap: {
    width: "100%",
    overflowX: "auto",
  },

  statusPill: {
    display: "inline-flex",
    borderRadius: "999px",
    padding: "5px 8px",
    background: "#ecfdf3",
    color: "#166534",
    fontSize: "11px",
    fontWeight: "950",
    whiteSpace: "nowrap",
  },

  statusDanger: {
    background: "#fee2e2",
    color: "#991b1b",
  },

  emptyLine: {
    padding: "18px",
    borderRadius: "18px",
    background: "#f8fafc",
    border: "1px dashed #cbd5e1",
    color: "#64748b",
    fontWeight: "800",
    textAlign: "center",
  },

  timelinePanel: {
    background: "#ffffff",
    borderRadius: "26px",
    padding: "18px",
    border: "1px solid rgba(226, 232, 240, 0.95)",
    boxShadow: "0 18px 45px rgba(15, 23, 42, 0.08)",
  },

  timelineList: {
    display: "grid",
    gap: "12px",
  },

  timelineItem: {
    display: "grid",
    gridTemplateColumns: "16px minmax(0, 1fr)",
    gap: "12px",
    padding: "12px",
    borderRadius: "18px",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
  },

  timelineDot: {
    width: "12px",
    height: "12px",
    borderRadius: "50%",
    marginTop: "5px",
    background: "#0f766e",
  },

  timelineTop: {
    display: "flex",
    justifyContent: "space-between",
    gap: "10px",
    flexWrap: "wrap",
  },
};
