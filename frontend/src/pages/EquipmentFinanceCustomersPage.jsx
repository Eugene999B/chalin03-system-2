import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import axiosClient from "../api/axiosClient";
import "../styles/equipmentFinanceCustomers.css";

const API = "/equipment-catalogue/sales/finance-customers";
const STATUS_OPTIONS = [
  ["", "All Finance customers"],
  ["active", "Active accounts"],
  ["overdue", "Overdue accounts"],
  ["defaulted", "Defaulted accounts"],
  ["completed", "Completed accounts"],
  ["approved_application", "Approved applications"],
  ["application_only", "Application only"],
];
const DETAIL_TABS = [
  ["overview", "Overview"],
  ["applications", "Applications & KYC"],
  ["agreements", "Agreements"],
  ["schedule", "Schedule"],
  ["payments", "Receipts"],
  ["lifecycle", "Delivery & Ownership"],
];

const money = (value) =>
  `GHS ${Number(value || 0).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const label = (value) =>
  String(value || "Not available")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());

const dateLabel = (value, includeTime = false) => {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value).slice(0, 10);
  return parsed.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
};

const errorMessage = (error, fallback) =>
  error?.response?.data?.message || error?.message || fallback;

function StatusPill({ value, kind = "status" }) {
  return (
    <span
      className={`finance-customers__pill is-${kind}-${String(value || "unknown")}`}
    >
      {label(value)}
    </span>
  );
}

function Metric({ title, value, hint, tone = "neutral" }) {
  return (
    <article className={`finance-customers__metric is-${tone}`}>
      <span>{title}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </article>
  );
}

function InfoItem({ title, value, wide = false }) {
  return (
    <div className={`finance-customers__info ${wide ? "is-wide" : ""}`}>
      <span>{title}</span>
      <strong>{value || "—"}</strong>
    </div>
  );
}

function EmptyState({ children }) {
  return <div className="finance-customers__empty">{children}</div>;
}

function ApplicationPanel({ applications = [], decisions = [] }) {
  if (!applications.length) {
    return <EmptyState>No Finance credit application is recorded for this customer.</EmptyState>;
  }

  return (
    <div className="finance-customers__stack">
      {applications.map((application) => {
        const applicationDecisions = decisions.filter(
          (decision) => Number(decision.application_id) === Number(application.application_id)
        );
        return (
          <article
            key={application.application_id}
            className="finance-customers__record-card"
          >
            <header>
              <div>
                <small>Credit application</small>
                <h3>{application.application_number}</h3>
                <p>{dateLabel(application.application_date)}</p>
              </div>
              <div className="finance-customers__pill-row">
                <StatusPill value={application.application_status} />
                <StatusPill value={application.kyc_status} kind="kyc" />
                <StatusPill value={application.risk_band} kind="risk" />
              </div>
            </header>

            <div className="finance-customers__record-grid">
              <InfoItem title="Quoted total" value={money(application.quoted_total)} />
              <InfoItem title="Proposed deposit" value={money(application.proposed_deposit)} />
              <InfoItem title="Financed amount" value={money(application.financed_amount)} />
              <InfoItem
                title="Installment plan"
                value={`${label(application.proposed_frequency)} · ${Number(
                  application.proposed_installment_count || 0
                )} payments`}
              />
              <InfoItem
                title="Monthly income"
                value={money(application.total_monthly_income)}
              />
              <InfoItem
                title="Monthly commitments"
                value={money(application.total_monthly_commitments)}
              />
              <InfoItem
                title="Net monthly surplus"
                value={money(application.net_monthly_surplus)}
              />
              <InfoItem
                title="Debt-service ratio"
                value={`${Number(application.debt_service_ratio_percent || 0).toFixed(2)}%`}
              />
            </div>

            <div className="finance-customers__kyc-grid">
              <InfoItem title="ID type" value={application.id_type} />
              <InfoItem title="ID number" value={application.id_number} />
              <InfoItem title="Employment" value={label(application.employment_type)} />
              <InfoItem title="Occupation" value={application.occupation} />
              <InfoItem
                title="Employer / business"
                value={application.employer_business_name}
              />
              <InfoItem title="Guarantor" value={application.guarantor_name} />
              <InfoItem title="Guarantor phone" value={application.guarantor_phone} />
              <InfoItem
                title="KYC verified"
                value={application.verified_at ? dateLabel(application.verified_at, true) : "No"}
              />
              <InfoItem
                title="Assessment recommendation"
                value={application.assessment_recommendation}
                wide
              />
              <InfoItem
                title="Decision reason"
                value={application.decision_reason}
                wide
              />
            </div>

            {applicationDecisions.length ? (
              <div className="finance-customers__timeline">
                <h4>Decision history</h4>
                {applicationDecisions.map((decision) => (
                  <div key={decision.id}>
                    <span aria-hidden="true" />
                    <p>
                      <strong>{label(decision.action_type)}</strong>
                      <small>
                        {dateLabel(decision.decided_at, true)}
                        {decision.decided_by_name
                          ? ` · ${decision.decided_by_name}`
                          : ""}
                      </small>
                      {decision.notes ? <em>{decision.notes}</em> : null}
                    </p>
                  </div>
                ))}
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

function AgreementPanel({ agreements = [] }) {
  if (!agreements.length) {
    return <EmptyState>No active or completed Finance agreement is recorded.</EmptyState>;
  }

  return (
    <div className="finance-customers__stack">
      {agreements.map((agreement) => {
        const total = Number(agreement.total_amount || 0);
        const paid = Number(agreement.amount_paid || 0);
        const progress = total > 0 ? Math.min(100, (paid / total) * 100) : 0;
        return (
          <article key={agreement.id} className="finance-customers__record-card">
            <header>
              <div>
                <small>Finance agreement</small>
                <h3>{agreement.agreement_number}</h3>
                <p>
                  {agreement.asset_code_snapshot} · {agreement.asset_name_snapshot}
                </p>
              </div>
              <div className="finance-customers__pill-row">
                <StatusPill value={agreement.agreement_status} />
                <StatusPill value={agreement.risk_band} kind="risk" />
              </div>
            </header>

            <div className="finance-customers__progress" aria-label="Payment progress">
              <span style={{ width: `${progress}%` }} />
            </div>
            <p className="finance-customers__progress-copy">
              {progress.toFixed(1)}% collected · {money(agreement.outstanding_balance)} outstanding
            </p>

            <div className="finance-customers__record-grid">
              <InfoItem title="Total agreement" value={money(agreement.total_amount)} />
              <InfoItem title="Deposit required" value={money(agreement.deposit_required)} />
              <InfoItem title="Deposit received" value={money(agreement.deposit_received)} />
              <InfoItem title="Amount paid" value={money(agreement.amount_paid)} />
              <InfoItem title="Outstanding" value={money(agreement.outstanding_balance)} />
              <InfoItem title="Overdue" value={money(agreement.overdue_amount)} />
              <InfoItem title="Next due date" value={dateLabel(agreement.next_due_date)} />
              <InfoItem
                title="Installment plan"
                value={`${label(agreement.payment_frequency)} · ${Number(
                  agreement.installment_count || 0
                )} payments`}
              />
              <InfoItem
                title="Machine commitment"
                value={label(agreement.equipment_commitment_status)}
              />
              <InfoItem title="Delivery" value={label(agreement.delivery_status)} />
              <InfoItem title="Ownership" value={label(agreement.ownership_status)} />
              <InfoItem title="Days past due" value={String(agreement.days_past_due || 0)} />
            </div>
          </article>
        );
      })}
    </div>
  );
}

function SchedulePanel({ schedule = [], agreements = [] }) {
  if (!schedule.length) {
    return <EmptyState>No installment schedule has been created for this customer.</EmptyState>;
  }
  const agreementMap = new Map(
    agreements.map((agreement) => [Number(agreement.id), agreement.agreement_number])
  );

  return (
    <div className="finance-customers__table-wrap">
      <table>
        <thead>
          <tr>
            <th>Agreement</th>
            <th>Installment</th>
            <th>Due date</th>
            <th>Scheduled</th>
            <th>Paid</th>
            <th>Remaining</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {schedule.map((row) => {
            const remaining = Math.max(
              Number(row.scheduled_amount || 0) +
                Number(row.late_charge_amount || 0) -
                Number(row.waived_charge_amount || 0) -
                Number(row.amount_paid || 0),
              0
            );
            return (
              <tr key={row.id}>
                <td>{agreementMap.get(Number(row.agreement_id)) || row.agreement_id}</td>
                <td>#{row.sequence_number}</td>
                <td>{dateLabel(row.due_date)}</td>
                <td>{money(row.scheduled_amount)}</td>
                <td>{money(row.amount_paid)}</td>
                <td>{money(remaining)}</td>
                <td><StatusPill value={row.schedule_status} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PaymentPanel({ payments = [], agreements = [] }) {
  if (!payments.length) {
    return <EmptyState>No Finance receipt has been recorded for this customer.</EmptyState>;
  }
  const agreementMap = new Map(
    agreements.map((agreement) => [Number(agreement.id), agreement.agreement_number])
  );

  return (
    <div className="finance-customers__table-wrap">
      <table>
        <thead>
          <tr>
            <th>Receipt</th>
            <th>Agreement</th>
            <th>Date</th>
            <th>Category</th>
            <th>Method</th>
            <th>Amount</th>
            <th>Received by</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((payment) => (
            <tr key={payment.id} className={payment.is_voided ? "is-voided" : ""}>
              <td>
                <strong>{payment.receipt_number}</strong>
                {payment.is_voided ? <small>Voided</small> : null}
              </td>
              <td>{agreementMap.get(Number(payment.agreement_id)) || payment.agreement_id}</td>
              <td>{dateLabel(payment.payment_date, true)}</td>
              <td>{label(payment.payment_category)}</td>
              <td>{label(payment.payment_method)}</td>
              <td>{money(payment.amount)}</td>
              <td>{payment.received_by_name || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LifecyclePanel({ deliveries = [], ownershipTransfers = [] }) {
  if (!deliveries.length && !ownershipTransfers.length) {
    return (
      <EmptyState>
        No controlled delivery or ownership-transfer evidence is recorded yet.
      </EmptyState>
    );
  }

  return (
    <div className="finance-customers__lifecycle-grid">
      <section>
        <header>
          <span aria-hidden="true">🚜</span>
          <div>
            <small>Controlled lifecycle</small>
            <h3>Delivery handovers</h3>
          </div>
        </header>
        {deliveries.length ? deliveries.map((delivery) => (
          <article key={delivery.id}>
            <div>
              <strong>{delivery.delivery_number}</strong>
              <span>{delivery.asset_code} · {delivery.asset_name}</span>
            </div>
            <StatusPill value={delivery.status} />
            <p>{dateLabel(delivery.delivery_datetime, true)} · {delivery.destination || "No destination"}</p>
            <small>Received by {delivery.receiving_person || "—"}</small>
          </article>
        )) : <EmptyState>No delivery handover has been completed.</EmptyState>}
      </section>

      <section>
        <header>
          <span aria-hidden="true">📜</span>
          <div>
            <small>Final customer title</small>
            <h3>Ownership transfers</h3>
          </div>
        </header>
        {ownershipTransfers.length ? ownershipTransfers.map((transfer) => (
          <article key={transfer.id}>
            <div>
              <strong>{transfer.transfer_number}</strong>
              <span>{transfer.asset_code} · {transfer.asset_name}</span>
            </div>
            <StatusPill value={transfer.status} />
            <p>{dateLabel(transfer.transfer_date)}</p>
            <small>{transfer.registration_transfer_reference || "No registration reference"}</small>
          </article>
        )) : <EmptyState>No ownership transfer has been completed.</EmptyState>}
      </section>
    </div>
  );
}

function CustomerDrawer({ detail, loading, error, tab, setTab, onClose }) {
  const customer = detail?.customer;
  return (
    <div
      className="finance-customers__backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="finance-customers__drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Finance customer portfolio"
      >
        <header className="finance-customers__drawer-header">
          <div>
            <p>Equipment Installment Finance</p>
            <h2>{customer?.customer_name || "Customer portfolio"}</h2>
            <span>
              {customer?.phone || "No phone"}
              {customer?.latest_kyc?.id_number
                ? ` · ${customer.latest_kyc.id_type || "ID"} ${customer.latest_kyc.id_number}`
                : ""}
            </span>
          </div>
          <button type="button" onClick={onClose} aria-label="Close customer portfolio">
            ×
          </button>
        </header>

        {customer ? (
          <nav className="finance-customers__tabs" aria-label="Customer portfolio sections">
            {DETAIL_TABS.map(([value, title]) => (
              <button
                type="button"
                key={value}
                className={tab === value ? "is-active" : ""}
                onClick={() => setTab(value)}
              >
                {title}
              </button>
            ))}
          </nav>
        ) : null}

        <div className="finance-customers__drawer-body">
          {loading ? <EmptyState>Loading the complete Finance customer record…</EmptyState> : null}
          {error ? <div className="finance-customers__alert is-error">{error}</div> : null}

          {!loading && customer && tab === "overview" ? (
            <>
              <section className="finance-customers__profile-hero">
                <div>
                  <small>Portfolio status</small>
                  <StatusPill value={customer.portfolio_status} />
                  <h3>{money(customer.outstanding_balance)} outstanding</h3>
                  <p>
                    {money(customer.amount_paid)} collected from {money(customer.total_sales_value)}
                  </p>
                </div>
                <div className="finance-customers__profile-risk">
                  <span>Highest risk</span>
                  <strong>{label(customer.highest_risk_band)}</strong>
                  <small>Score {Number(customer.highest_risk_score || 0)}</small>
                </div>
              </section>

              <section className="finance-customers__profile-grid">
                <InfoItem title="Customer name" value={customer.customer_name} />
                <InfoItem title="Phone" value={customer.phone} />
                <InfoItem title="Email" value={customer.email} />
                <InfoItem title="Address" value={customer.address} wide />
                <InfoItem title="ID type" value={customer.latest_kyc?.id_type} />
                <InfoItem title="ID number" value={customer.latest_kyc?.id_number} />
                <InfoItem
                  title="Employment"
                  value={label(customer.latest_kyc?.employment_type)}
                />
                <InfoItem title="Occupation" value={customer.latest_kyc?.occupation} />
                <InfoItem
                  title="Employer / business"
                  value={customer.latest_kyc?.employer_business_name}
                />
                <InfoItem title="Guarantor" value={customer.latest_kyc?.guarantor_name} />
                <InfoItem
                  title="Guarantor phone"
                  value={customer.latest_kyc?.guarantor_phone}
                />
                <InfoItem title="Next due date" value={dateLabel(customer.next_due_date)} />
              </section>

              <section className="finance-customers__mini-metrics">
                <Metric
                  title="Applications"
                  value={customer.application_count}
                  hint={`${customer.approved_application_count} approved`}
                />
                <Metric
                  title="Agreements"
                  value={customer.agreement_count}
                  hint={`${customer.active_agreement_count} active`}
                />
                <Metric
                  title="Overdue"
                  value={money(customer.overdue_amount)}
                  hint={`${customer.overdue_agreement_count} overdue accounts`}
                  tone="danger"
                />
                <Metric
                  title="Ownership completed"
                  value={customer.ownership_transferred_count}
                  hint={`${customer.delivered_agreement_count} machines delivered`}
                  tone="success"
                />
              </section>

              <div className="finance-customers__boundary-note">
                <strong>Finance-only customer record</strong>
                <span>
                  This view reads the customer identity only as a protected reference. It does
                  not open or change Hire enquiries, Hire contracts, jobs, invoices, returns or
                  workers.
                </span>
              </div>
            </>
          ) : null}

          {!loading && customer && tab === "applications" ? (
            <ApplicationPanel
              applications={customer.applications}
              decisions={detail.decisions}
            />
          ) : null}
          {!loading && customer && tab === "agreements" ? (
            <AgreementPanel agreements={customer.agreements} />
          ) : null}
          {!loading && customer && tab === "schedule" ? (
            <SchedulePanel schedule={detail.schedule} agreements={customer.agreements} />
          ) : null}
          {!loading && customer && tab === "payments" ? (
            <PaymentPanel payments={detail.payments} agreements={customer.agreements} />
          ) : null}
          {!loading && customer && tab === "lifecycle" ? (
            <LifecyclePanel
              deliveries={detail.deliveries}
              ownershipTransfers={detail.ownership_transfers}
            />
          ) : null}
        </div>
      </section>
    </div>
  );
}

export default function EquipmentFinanceCustomersPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [customers, setCustomers] = useState([]);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailProblem, setDetailProblem] = useState("");
  const [tab, setTab] = useState("overview");

  const load = useCallback(async (nextSearch = "", nextStatus = "") => {
    setLoading(true);
    setProblem("");
    try {
      const response = await axiosClient.get(API, {
        params: {
          search: nextSearch || undefined,
          status: nextStatus || undefined,
          limit: 500,
        },
      });
      setCustomers(response.data?.customers || []);
      setSummary(response.data?.summary || {});
    } catch (error) {
      setProblem(errorMessage(error, "Could not load the Finance customer portfolio."));
      setCustomers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const totalExposure = useMemo(
    () => Number(summary.outstanding_balance || 0) + Number(summary.overdue_amount || 0),
    [summary]
  );

  async function openCustomer(customerId) {
    setSelectedId(customerId);
    setDetail(null);
    setDetailLoading(true);
    setDetailProblem("");
    setTab("overview");
    try {
      const response = await axiosClient.get(`${API}/${customerId}`);
      setDetail(response.data || null);
    } catch (error) {
      setDetailProblem(errorMessage(error, "Could not load this Finance customer."));
    } finally {
      setDetailLoading(false);
    }
  }

  function submitFilters(event) {
    event.preventDefault();
    load(search, status);
  }

  function clearFilters() {
    setSearch("");
    setStatus("");
    load("", "");
  }

  return (
    <main className="finance-customers">
      <header className="finance-customers__hero">
        <div>
          <p>Finance Customers & Portfolio Control</p>
          <h1>One complete customer record for every installment relationship</h1>
          <span>
            Review identity, KYC, credit decisions, agreements, schedules, receipts,
            delivery and ownership without entering Equipment Hire operations.
          </span>
        </div>
        <div className="finance-customers__hero-actions">
          <Link to="/equipment-installment-finance/applications">New credit application</Link>
          <Link to="/equipment-installment-finance">Finance Command Centre</Link>
        </div>
      </header>

      <section className="finance-customers__boundary">
        <span aria-hidden="true">🛡️</span>
        <p>
          <strong>Independent Finance customer logic</strong>
          Customers appear here only when they have a Finance application or installment
          agreement. This page cannot create Hire work, change balances or send automatic SMS.
        </p>
      </section>

      <section className="finance-customers__metrics">
        <Metric
          title="Finance customers"
          value={Number(summary.customers || 0)}
          hint={`${Number(summary.active_customers || 0)} with active agreements`}
        />
        <Metric
          title="Amount collected"
          value={money(summary.amount_paid)}
          hint={`Across ${Number(summary.completed_customers || 0)} completed customers`}
          tone="success"
        />
        <Metric
          title="Outstanding portfolio"
          value={money(summary.outstanding_balance)}
          hint={`${Number(summary.overdue_customers || 0)} customers currently overdue`}
          tone="warning"
        />
        <Metric
          title="Overdue exposure"
          value={money(summary.overdue_amount)}
          hint={`${Number(summary.defaulted_customers || 0)} defaulted customers`}
          tone="danger"
        />
      </section>

      <section className="finance-customers__control-panel">
        <div>
          <p>Customer portfolio</p>
          <h2>Find the person, agreement or machine you need</h2>
          <span>
            Total monitored exposure: <strong>{money(totalExposure)}</strong>
          </span>
        </div>
        <form onSubmit={submitFilters}>
          <label>
            <span>Search</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Customer, phone, ID, application, agreement or machine"
            />
          </label>
          <label>
            <span>Portfolio status</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              {STATUS_OPTIONS.map(([value, title]) => (
                <option value={value} key={value || "all"}>{title}</option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={loading}>
            {loading ? "Loading…" : "Apply filters"}
          </button>
          <button type="button" className="is-secondary" onClick={clearFilters}>
            Clear
          </button>
        </form>
      </section>

      {problem ? <div className="finance-customers__alert is-error">{problem}</div> : null}

      <section className="finance-customers__list" aria-live="polite">
        {loading ? <EmptyState>Loading the company-wide Finance customer portfolio…</EmptyState> : null}
        {!loading && !customers.length && !problem ? (
          <EmptyState>No Finance customers match the selected filters.</EmptyState>
        ) : null}

        {!loading
          ? customers.map((customer) => (
              <article key={customer.customer_id} className="finance-customers__customer-card">
                <header>
                  <div className="finance-customers__avatar" aria-hidden="true">
                    {String(customer.customer_name || "F").charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <small>Finance customer #{customer.customer_id}</small>
                    <h3>{customer.customer_name}</h3>
                    <p>{customer.phone || "No phone"} · {customer.email || "No email"}</p>
                  </div>
                  <div className="finance-customers__pill-row">
                    <StatusPill value={customer.portfolio_status} />
                    <StatusPill value={customer.highest_risk_band} kind="risk" />
                  </div>
                </header>

                <div className="finance-customers__customer-values">
                  <div>
                    <span>Applications</span>
                    <strong>{customer.application_count}</strong>
                  </div>
                  <div>
                    <span>Agreements</span>
                    <strong>{customer.agreement_count}</strong>
                  </div>
                  <div>
                    <span>Collected</span>
                    <strong>{money(customer.amount_paid)}</strong>
                  </div>
                  <div>
                    <span>Outstanding</span>
                    <strong>{money(customer.outstanding_balance)}</strong>
                  </div>
                  <div>
                    <span>Overdue</span>
                    <strong>{money(customer.overdue_amount)}</strong>
                  </div>
                  <div>
                    <span>Next due</span>
                    <strong>{dateLabel(customer.next_due_date)}</strong>
                  </div>
                </div>

                <footer>
                  <span>
                    {customer.latest_kyc?.id_number
                      ? `${customer.latest_kyc.id_type || "ID"}: ${customer.latest_kyc.id_number}`
                      : "KYC identity not yet recorded"}
                  </span>
                  <button type="button" onClick={() => openCustomer(customer.customer_id)}>
                    Open complete record →
                  </button>
                </footer>
              </article>
            ))
          : null}
      </section>

      {selectedId ? (
        <CustomerDrawer
          detail={detail}
          loading={detailLoading}
          error={detailProblem}
          tab={tab}
          setTab={setTab}
          onClose={() => {
            setSelectedId(null);
            setDetail(null);
            setDetailProblem("");
          }}
        />
      ) : null}
    </main>
  );
}
