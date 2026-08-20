import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import axiosClient from "../api/axiosClient";
import "../styles/equipmentFinanceAccountsCompletion.css";
import "../styles/equipmentFinanceSimplifiedWorkspace.css";

const API = "/equipment-catalogue/sales/finance-customers";

function money(value) {
  return `GHS ${Number(value || 0).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function label(value) {
  return String(value || "Not recorded")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function dateLabel(value) {
  if (!value) return "Not recorded";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? String(value).slice(0, 10)
    : parsed.toLocaleDateString("en-GH", {
        year: "numeric",
        month: "short",
        day: "2-digit",
      });
}

function errorMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

function agreementId(row) {
  return Number(row?.agreement_id || row?.id || 0) || null;
}

export default function EquipmentFinanceCustomerPortfolioPage() {
  const location = useLocation();
  const requestedCustomer = new URLSearchParams(location.search).get("customer");
  const [customers, setCustomers] = useState([]);
  const [summary, setSummary] = useState({});
  const [selectedId, setSelectedId] = useState("");
  const [profile, setProfile] = useState(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [problem, setProblem] = useState("");

  const clearSelection = useCallback(() => {
    setSelectedId("");
    setProfile(null);
  }, []);

  const loadProfile = useCallback(async (customerId) => {
    if (!customerId) return;
    setProfileLoading(true);
    setProblem("");
    try {
      const response = await axiosClient.get(`${API}/${customerId}`);
      setProfile(response.data || null);
      setSelectedId(String(customerId));
    } catch (error) {
      setProblem(errorMessage(error, "Could not load the customer installment profile."));
      clearSelection();
    } finally {
      setProfileLoading(false);
    }
  }, [clearSelection]);

  const load = useCallback(async () => {
    setLoading(true);
    setProblem("");
    try {
      const response = await axiosClient.get(API, { params: { limit: 500 } });
      setCustomers(response.data?.customers || []);
      setSummary(response.data?.summary || {});
      if (requestedCustomer) await loadProfile(requestedCustomer);
      else clearSelection();
    } catch (error) {
      setProblem(errorMessage(error, "Could not load Finance customer portfolios."));
    } finally {
      setLoading(false);
    }
  }, [clearSelection, loadProfile, requestedCustomer]);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return customers.filter((customer) => {
      if (status !== "all" && customer.portfolio_status !== status) return false;
      if (!term) return true;
      return [
        customer.customer_name,
        customer.phone,
        customer.email,
        customer.latest_kyc?.id_number,
        customer.latest_kyc?.guarantor_name,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term));
    });
  }, [customers, search, status]);

  const customer = profile?.customer;
  const scheduleByAgreement = useMemo(() => {
    const map = new Map();
    for (const row of profile?.schedule || []) {
      const key = Number(row.agreement_id || 0);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    }
    return map;
  }, [profile]);
  const paymentsByAgreement = useMemo(() => {
    const map = new Map();
    for (const row of profile?.payments || []) {
      const key = Number(row.agreement_id || 0);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    }
    return map;
  }, [profile]);

  return (
    <main className="finance-accounts finance-simplified" data-testid="finance-customer-portfolios">
      <header className="finance-accounts__hero">
        <div>
          <p>Search first, open only what you need</p>
          <h1>Customer Installment Profiles</h1>
          <span>
            Find a customer, select the correct record, then open the full installment history.
            No customer file opens automatically.
          </span>
        </div>
        <div className="finance-accounts__hero-actions">
          <Link className="is-primary" to="/equipment-installment-finance/applications?stage=collections">Payments Centre</Link>
          <Link to="/equipment-installment-finance/applications?stage=customers">Customer Register</Link>
        </div>
      </header>

      {problem ? <div className="finance-accounts__notice is-error" role="alert">{problem}</div> : null}

      <section className="finance-accounts__metrics">
        <article><span>Finance customers</span><strong>{summary.customers || customers.length}</strong></article>
        <article><span>Active customers</span><strong>{summary.active_customers || 0}</strong></article>
        <article className={(summary.overdue_customers || 0) > 0 ? "is-warning" : ""}><span>Overdue customers</span><strong>{summary.overdue_customers || 0}</strong></article>
        <article><span>Outstanding</span><strong>{money(summary.outstanding_balance)}</strong></article>
      </section>

      <section className="finance-accounts__split">
        <aside className="finance-accounts__customer-list">
          <div className="finance-accounts__toolbar is-stacked">
            <div><p>Choose customer</p><h2>{visible.length} result(s)</h2></div>
            <input
              aria-label="Search Finance customers"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, phone, ID or guarantor"
              autoComplete="off"
            />
            <select aria-label="Filter customer portfolio status" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="overdue">Overdue</option>
              <option value="defaulted">Defaulted</option>
              <option value="completed">Completed</option>
              <option value="approved_application">Approved application</option>
              <option value="application_only">Application only</option>
            </select>
          </div>
          {loading ? <div className="finance-accounts__empty">Loading customers…</div> : null}
          {!loading && !visible.length ? <div className="finance-accounts__empty">No customer matches this search.</div> : null}
          <div className="finance-accounts__customer-scroll">
            {visible.map((item) => (
              <button
                type="button"
                key={item.customer_id}
                className={String(item.customer_id) === selectedId ? "is-active" : ""}
                onClick={() => loadProfile(item.customer_id)}
              >
                <strong>{item.customer_name}</strong>
                <span>{item.phone || "No phone"}</span>
                <small>{label(item.portfolio_status)} · {money(item.outstanding_balance)}</small>
                {Number(item.overdue_amount || 0) > 0 ? <em>{money(item.overdue_amount)} overdue</em> : null}
              </button>
            ))}
          </div>
        </aside>

        <div className="finance-accounts__profile">
          {profileLoading ? <div className="finance-simplified__selection-panel"><div><strong>Opening customer profile…</strong><span>Please wait.</span></div></div> : null}
          {!profileLoading && !customer ? (
            <div className="finance-simplified__selection-panel">
              <div>
                <strong>No customer selected</strong>
                <span>Use the search box, then select one customer to see details.</span>
              </div>
            </div>
          ) : null}
          {!profileLoading && customer ? (
            <>
              <section className="finance-accounts__profile-hero">
                <div>
                  <p>{label(customer.portfolio_status)}</p>
                  <h2>{customer.customer_name}</h2>
                  <span>{customer.phone || "No phone"} · {customer.email || "No email"}</span>
                  <small>{customer.address || "No address recorded"}</small>
                </div>
                <div className="finance-accounts__profile-actions">
                  <button type="button" onClick={clearSelection}>Close profile</button>
                  <Link className="is-primary" to={`/equipment-installment-finance/applications?stage=start&customer=${customer.customer_id}`}>Start New Installment</Link>
                  {customer.active_agreement_count > 0 ? (
                    <Link to={`/equipment-installment-finance/applications?stage=collections&customer=${customer.customer_id}`}>Record Payment</Link>
                  ) : null}
                </div>
              </section>

              <div className="finance-accounts__summary">
                <article><span>Applications</span><strong>{customer.application_count || 0}</strong></article>
                <article><span>Agreements</span><strong>{customer.agreement_count || 0}</strong></article>
                <article><span>Total paid</span><strong>{money(customer.amount_paid)}</strong></article>
                <article><span>Outstanding</span><strong>{money(customer.outstanding_balance)}</strong></article>
                <article><span>Overdue</span><strong>{money(customer.overdue_amount)}</strong></article>
                <article><span>Next due</span><strong>{dateLabel(customer.next_due_date)}</strong></article>
              </div>

              <section className="finance-accounts__panel">
                <div className="finance-accounts__section-head"><div><p>Installment accounts</p><h2>{customer.agreements?.length || 0} agreement(s)</h2></div></div>
                <div className="finance-accounts__agreement-stack">
                  {(customer.agreements || []).map((agreement) => {
                    const id = agreementId(agreement);
                    const payments = paymentsByAgreement.get(id) || [];
                    const schedule = scheduleByAgreement.get(id) || [];
                    return (
                      <article key={id || agreement.agreement_number}>
                        <div className="finance-accounts__card-head">
                          <div>
                            <small>{agreement.agreement_number}</small>
                            <h3>{agreement.asset_code_snapshot || agreement.asset_code} — {agreement.asset_name_snapshot || agreement.asset_name}</h3>
                            <p>{label(agreement.agreement_status)} · {label(agreement.risk_band)}</p>
                          </div>
                          <span>{money(agreement.outstanding_balance)}</span>
                        </div>
                        <div className="finance-accounts__facts">
                          <div><span>Paid</span><strong>{money(agreement.amount_paid)}</strong></div>
                          <div><span>Overdue</span><strong>{money(agreement.overdue_amount)}</strong></div>
                          <div><span>Next due</span><strong>{dateLabel(agreement.next_due_date)}</strong></div>
                          <div><span>Payments</span><strong>{payments.length}</strong></div>
                        </div>
                        <div className="finance-accounts__actions">
                          {id ? <Link className="is-primary" to={`/equipment-installment-finance/applications?stage=collections&agreement=${id}`}>Record Payment</Link> : null}
                          {id ? <Link to={`/equipment-installment-finance/applications?stage=accounts&agreement=${id}`}>Open Account</Link> : null}
                          {id ? <Link to={`/equipment-installment-finance/applications?stage=case-operations&case_type=agreement&case_id=${id}`}>Case History</Link> : null}
                        </div>
                        {(payments.length || schedule.length) ? (
                          <details>
                            <summary>Show schedule and payment details</summary>
                            <p>{schedule.length} schedule line(s) · {payments.length} payment(s)</p>
                            {payments.length ? (
                              <div className="finance-accounts__rows">
                                {payments.map((payment) => (
                                  <article key={payment.id}>
                                    <span>{payment.receipt_number || payment.payment_number}</span>
                                    <strong>{dateLabel(payment.payment_date)}</strong>
                                    <b>{money(payment.amount)}</b>
                                    <small>{label(payment.payment_method)}</small>
                                  </article>
                                ))}
                              </div>
                            ) : null}
                          </details>
                        ) : null}
                      </article>
                    );
                  })}
                  {!(customer.agreements || []).length ? <div className="finance-accounts__empty">This customer does not yet have an activated installment account.</div> : null}
                </div>
              </section>

              <details>
                <summary>Show identity, KYC and assessment details</summary>
                {customer.latest_application?.application_id ? (
                  <section className="finance-accounts__identity">
                    <div className="finance-accounts__application-image">
                      <img src={`/equipment-catalogue/sales/credit-applications/${customer.latest_application.application_id}/image`} alt={`Excavator for ${customer.customer_name}`} />
                    </div>
                    <div>
                      <p>Latest identity and assessment snapshot</p>
                      <h3>{customer.latest_application.application_number}</h3>
                      <div className="finance-accounts__facts">
                        <div><span>ID</span><strong>{customer.latest_kyc?.id_type || "Not recorded"} · {customer.latest_kyc?.id_number || "Not recorded"}</strong></div>
                        <div><span>Occupation</span><strong>{customer.latest_kyc?.occupation || "Not recorded"}</strong></div>
                        <div><span>Employer / business</span><strong>{customer.latest_kyc?.employer_business_name || "Not recorded"}</strong></div>
                        <div><span>Guarantor</span><strong>{customer.latest_kyc?.guarantor_name || "Not recorded"}</strong></div>
                        <div><span>Risk</span><strong>{label(customer.highest_risk_band)}</strong></div>
                        <div><span>Aging</span><strong>{label(customer.aging_bucket)}</strong></div>
                      </div>
                    </div>
                  </section>
                ) : <div className="finance-accounts__empty">No application identity snapshot is available.</div>}
              </details>

              <details>
                <summary>Show application history ({customer.applications?.length || 0})</summary>
                <div className="finance-accounts__rows">
                  {(customer.applications || []).map((application) => (
                    <article key={application.application_id}>
                      <span>{application.application_number}</span>
                      <strong>{label(application.application_status)}</strong>
                      <b>{money(application.quoted_total)}</b>
                      <Link to={`/equipment-installment-finance/applications?application=${application.application_id}`}>Open application</Link>
                    </article>
                  ))}
                </div>
              </details>
            </>
          ) : null}
        </div>
      </section>
    </main>
  );
}
