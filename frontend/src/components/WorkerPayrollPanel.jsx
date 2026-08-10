import { useEffect, useMemo, useState } from "react";

import axiosClient from "../api/axiosClient";

import "../styles/workerPayrollPanel.css";

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
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? String(value).slice(0, 10)
    : parsed.toLocaleDateString("en-GH", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
}

function errorMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

function tenureLabel(days) {
  if (days === null || days === undefined) return "Not recorded";
  const total = Math.max(0, Number(days || 0));
  const years = Math.floor(total / 365.2425);
  const remainingDays = Math.max(0, Math.round(total - years * 365.2425));
  const months = Math.floor(remainingDays / 30.44);
  if (years > 0) return `${years}y ${months}m`;
  if (months > 0) return `${months} month${months === 1 ? "" : "s"}`;
  return `${Math.round(total)} day${Math.round(total) === 1 ? "" : "s"}`;
}

function Metric({ title, value, note, tone = "" }) {
  return (
    <article className={`worker-payroll__metric ${tone ? `is-${tone}` : ""}`}>
      <span>{title}</span>
      <strong>{value}</strong>
      {note ? <small>{note}</small> : null}
    </article>
  );
}

function Empty({ children }) {
  return <div className="worker-payroll__empty">{children}</div>;
}

function SectionHeader({ eyebrow, title, note }) {
  return (
    <div className="worker-payroll__section-head">
      <div>
        <p>{eyebrow}</p>
        <h3>{title}</h3>
      </div>
      {note ? <span>{note}</span> : null}
    </div>
  );
}

export default function WorkerPayrollPanel({ workerId, worker, workspaceLabel }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    let active = true;

    async function load() {
      if (!workerId) return;
      setLoading(true);
      setProblem("");
      try {
        const response = await axiosClient.get(`/payroll/workers/${workerId}/profile`);
        if (active) setProfile(response.data || null);
      } catch (error) {
        if (active) {
          setProfile(null);
          setProblem(errorMessage(error, "Payroll profile could not be loaded."));
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [workerId]);

  const summary = profile?.summary || {};
  const currentCompensation = profile?.current_compensation || null;
  const components = currentCompensation?.components || [];
  const earnings = useMemo(
    () => components.filter((component) => component.component_type === "earning"),
    [components]
  );
  const deductions = useMemo(
    () => components.filter((component) => component.component_type === "deduction"),
    [components]
  );
  const employerContributions = useMemo(
    () => components.filter((component) => component.component_type === "employer_contribution"),
    [components]
  );

  if (loading) {
    return <div className="worker-payroll__loading">Loading confidential payroll history…</div>;
  }

  if (problem) {
    return (
      <section className="worker-payroll">
        <div className="worker-payroll__notice is-error" role="alert">{problem}</div>
      </section>
    );
  }

  return (
    <div className="worker-payroll" data-testid="worker-payroll-profile">
      <div className="worker-payroll__notice">
        <strong>Confidential payroll record</strong>
        <span>
          Visible only through explicit Payroll View permission. Salary history remains separate from the general worker profile and is scoped to {workspaceLabel || worker?.workspace_code || "this business category"}.
        </span>
      </div>

      <section className="worker-payroll__metrics">
        <Metric
          title="This month"
          value={label(summary.current_month_status || "not_processed")}
          note={summary.current_period_code || "No payroll entry yet"}
          tone={summary.current_month_status === "paid" ? "success" : summary.current_month_status === "part_paid" ? "warning" : ""}
        />
        <Metric title="Current basic salary" value={money(summary.current_basic_salary)} note={label(summary.current_pay_frequency)} />
        <Metric title="Tenure" value={tenureLabel(summary.tenure_days)} note={dateLabel(worker?.employment_start_date)} />
        <Metric title="Processed months" value={summary.processed_months || 0} note={`${summary.paid_months || 0} fully paid · ${summary.part_paid_months || 0} part-paid`} />
        <Metric title="YTD net salary" value={money(summary.ytd_net_salary)} note={`Gross ${money(summary.ytd_gross_earnings)}`} />
        <Metric title="YTD paid" value={money(summary.ytd_amount_paid)} note={`Deductions ${money(summary.ytd_total_deductions)}`} />
        <Metric
          title="Outstanding salary"
          value={money(summary.outstanding_salary)}
          note="Across preserved payroll entries"
          tone={Number(summary.outstanding_salary || 0) > 0 ? "warning" : ""}
        />
        <Metric
          title="Loans & advances"
          value={money(summary.loan_advance_outstanding)}
          note={`${summary.active_loan_count || 0} active record(s)`}
          tone={Number(summary.loan_advance_outstanding || 0) > 0 ? "warning" : ""}
        />
      </section>

      <section className="worker-payroll__card">
        <SectionHeader
          eyebrow="Authoritative compensation"
          title="Current salary setup"
          note="Approved, effective-dated history only"
        />
        {!currentCompensation ? (
          <Empty>No approved compensation profile is effective for this worker today.</Empty>
        ) : (
          <>
            <div className="worker-payroll__current-grid">
              <div><span>Basic salary</span><strong>{money(currentCompensation.basic_salary)}</strong></div>
              <div><span>Frequency</span><strong>{label(currentCompensation.pay_frequency)}</strong></div>
              <div><span>Effective from</span><strong>{dateLabel(currentCompensation.effective_from)}</strong></div>
              <div><span>Effective to</span><strong>{dateLabel(currentCompensation.effective_to) || "Open ended"}</strong></div>
              <div><span>Currency</span><strong>{currentCompensation.currency_code || "GHS"}</strong></div>
              <div><span>Status</span><strong>{label(currentCompensation.status)}</strong></div>
            </div>

            <div className="worker-payroll__component-groups">
              <div>
                <h4>Recurring earnings</h4>
                {earnings.length ? earnings.map((component) => (
                  <article key={component.id}>
                    <span>{component.component_name}</span>
                    <strong>{component.calculation_type === "percentage_of_basic" ? `${Number(component.amount_value || 0)}% of basic` : money(component.amount_value)}</strong>
                  </article>
                )) : <Empty>No recurring allowance or earning component.</Empty>}
              </div>
              <div>
                <h4>Recurring deductions</h4>
                {deductions.length ? deductions.map((component) => (
                  <article key={component.id}>
                    <span>{component.component_name}</span>
                    <strong>{component.calculation_type === "percentage_of_basic" ? `${Number(component.amount_value || 0)}% of basic` : money(component.amount_value)}</strong>
                  </article>
                )) : <Empty>No recurring deduction component.</Empty>}
              </div>
              <div>
                <h4>Employer contributions</h4>
                {employerContributions.length ? employerContributions.map((component) => (
                  <article key={component.id}>
                    <span>{component.component_name}</span>
                    <strong>{component.calculation_type === "percentage_of_basic" ? `${Number(component.amount_value || 0)}% of basic` : money(component.amount_value)}</strong>
                  </article>
                )) : <Empty>No recurring employer contribution.</Empty>}
              </div>
            </div>
          </>
        )}
      </section>

      <section className="worker-payroll__card">
        <SectionHeader eyebrow="Month-by-month" title="Payroll timeline" note={`${profile?.payroll_timeline?.length || 0} preserved period record(s)`} />
        {!(profile?.payroll_timeline || []).length ? (
          <Empty>No payroll month has been processed for this worker yet.</Empty>
        ) : (
          <div className="worker-payroll__table-wrap">
            <table>
              <thead>
                <tr><th>Period</th><th>Status</th><th>Gross</th><th>Deductions</th><th>Net</th><th>Paid</th><th>Balance</th></tr>
              </thead>
              <tbody>
                {profile.payroll_timeline.map((entry) => (
                  <tr key={entry.id}>
                    <td><strong>{entry.period_code}</strong><small>{dateLabel(entry.period_start)} – {dateLabel(entry.period_end)}</small></td>
                    <td><span className={`worker-payroll__status is-${entry.entry_status}`}>{label(entry.entry_status)}</span></td>
                    <td>{money(entry.gross_earnings)}</td>
                    <td>{money(entry.total_deductions)}</td>
                    <td>{money(entry.net_salary)}</td>
                    <td>{money(entry.amount_paid)}</td>
                    <td>{money(entry.remaining_balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="worker-payroll__two-column">
        <section className="worker-payroll__card">
          <SectionHeader eyebrow="History" title="Salary changes" note="Original effective periods remain preserved" />
          {!(profile?.compensation_history || []).length ? (
            <Empty>No compensation history has been recorded.</Empty>
          ) : (
            <div className="worker-payroll__stack">
              {profile.compensation_history.map((item) => (
                <article key={item.id}>
                  <div><strong>{money(item.basic_salary)}</strong><span>{label(item.status)}</span></div>
                  <p>{dateLabel(item.effective_from)} → {item.effective_to ? dateLabel(item.effective_to) : "Open ended"}</p>
                  <small>{item.change_reason}</small>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="worker-payroll__card">
          <SectionHeader eyebrow="Collections evidence" title="Salary payment history" note="Posted and reversal evidence is preserved" />
          {!(profile?.payment_history || []).length ? (
            <Empty>No salary payment has been posted.</Empty>
          ) : (
            <div className="worker-payroll__stack">
              {profile.payment_history.map((payment) => (
                <article key={payment.id}>
                  <div><strong>{money(payment.amount)}</strong><span>{label(payment.payment_status)}</span></div>
                  <p>{dateLabel(payment.payment_date)} · {label(payment.payment_method)}</p>
                  <small>{payment.payment_number || payment.payment_reference || payment.period_code}</small>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="worker-payroll__card">
        <SectionHeader eyebrow="Worker balances" title="Loans & salary advances" note="Outstanding balances are read from payroll loan records" />
        {!(profile?.loans || []).length ? (
          <Empty>No loan or salary-advance record exists for this worker.</Empty>
        ) : (
          <div className="worker-payroll__loan-grid">
            {profile.loans.map((loan) => (
              <article key={loan.id}>
                <div><strong>{loan.loan_number || label(loan.loan_type)}</strong><span>{label(loan.status)}</span></div>
                <p>{label(loan.loan_type)} · started {dateLabel(loan.start_date)}</p>
                <dl>
                  <div><dt>Approved</dt><dd>{money(loan.approved_amount)}</dd></div>
                  <div><dt>Outstanding</dt><dd>{money(loan.outstanding_balance)}</dd></div>
                  <div><dt>Repayment</dt><dd>{money(loan.repayment_amount)}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
