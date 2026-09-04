import { useEffect, useMemo, useState } from "react";

import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";

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

function todayText() {
  return new Date().toISOString().slice(0, 10);
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
  const auth = useAuth();
  const canIssuePayslip = auth.hasPermission("payroll.payslip.issue");
  const canManageCompensation = auth.hasPermission("payroll.manage");
  const canPrepareCompensation = auth.hasPermission("payroll.prepare");
  const canApproveCompensation = auth.hasPermission("payroll.approve");
  const systemAdministrator = Boolean(auth.user?.is_original_system_administrator);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState("");
  const [payslipNotice, setPayslipNotice] = useState("");
  const [payslipBusy, setPayslipBusy] = useState("");
  const [salaryNotice, setSalaryNotice] = useState("");
  const [salaryBusy, setSalaryBusy] = useState("");
  const [salaryChangeOpen, setSalaryChangeOpen] = useState(false);
  const [salaryForm, setSalaryForm] = useState({
    basic_salary: "",
    pay_frequency: "monthly",
    effective_from: todayText(),
    change_reason: "",
  });
  const [reloadKey, setReloadKey] = useState(0);

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
  }, [workerId, reloadKey]);

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
  const payslips = profile?.payslips || [];
  const currentPayslipByPeriod = useMemo(() => {
    const map = new Map();
    for (const payslip of payslips) {
      if (payslip.issue_status !== "current") continue;
      const key = String(payslip.payroll_period_id || "");
      if (key && !map.has(key)) map.set(key, payslip);
    }
    return map;
  }, [payslips]);
  const eligiblePayslipEntries = useMemo(
    () => (profile?.payroll_timeline || []).filter(
      (entry) => entry.entry_status === "paid" && ["reconciled", "closed"].includes(entry.period_status)
    ),
    [profile?.payroll_timeline]
  );

  function payrollParams() {
    return systemAdministrator && worker?.workspace_code
      ? { workspace_code: worker.workspace_code }
      : {};
  }

  function carriedForwardComponents() {
    return (currentCompensation?.components || []).map((component) => ({
      component_code: component.component_code,
      component_name: component.component_name,
      component_type: component.component_type,
      calculation_type: component.calculation_type,
      amount_value: Number(component.amount_value || 0),
      taxable: Boolean(component.taxable),
      pensionable: Boolean(component.pensionable),
      display_order: Number(component.display_order || 0),
      notes: component.notes || "",
    }));
  }

  async function createSalaryChange(event) {
    event.preventDefault();
    setSalaryBusy("create");
    setProblem("");
    setSalaryNotice("");
    try {
      const created = await axiosClient.post(`/payroll/workers/${workerId}/compensation`, {
        ...payrollParams(),
        basic_salary: salaryForm.basic_salary,
        pay_frequency: salaryForm.pay_frequency,
        effective_from: salaryForm.effective_from,
        change_reason: salaryForm.change_reason,
        components: carriedForwardComponents(),
      });
      const profileId = created.data?.profile_id;
      let message = created.data?.message || "Salary change saved as a draft.";
      if (profileId && canPrepareCompensation) {
        const submitted = await axiosClient.post(`/payroll/compensation/${profileId}/submit`, payrollParams());
        message = submitted.data?.message || "Salary change sent for approval.";
      }
      setSalaryNotice(message);
      setSalaryForm({
        basic_salary: "",
        pay_frequency: currentCompensation?.pay_frequency || "monthly",
        effective_from: todayText(),
        change_reason: "",
      });
      setSalaryChangeOpen(false);
      setReloadKey((value) => value + 1);
    } catch (error) {
      setProblem(errorMessage(error, "Salary change could not be saved."));
    } finally {
      setSalaryBusy("");
    }
  }

  async function submitSalaryChange(item) {
    setSalaryBusy(`submit:${item.id}`);
    setProblem("");
    setSalaryNotice("");
    try {
      const response = await axiosClient.post(`/payroll/compensation/${item.id}/submit`, payrollParams());
      setSalaryNotice(response.data?.message || "Salary change sent for approval.");
      setReloadKey((value) => value + 1);
    } catch (error) {
      setProblem(errorMessage(error, "Salary change could not be sent for approval."));
    } finally {
      setSalaryBusy("");
    }
  }

  async function approveSalaryChange(item) {
    setSalaryBusy(`approve:${item.id}`);
    setProblem("");
    setSalaryNotice("");
    try {
      const response = await axiosClient.post(`/payroll/compensation/${item.id}/approve`, payrollParams());
      setSalaryNotice(response.data?.message || "Salary change approved.");
      setReloadKey((value) => value + 1);
    } catch (error) {
      setProblem(errorMessage(error, "Salary change could not be approved."));
    } finally {
      setSalaryBusy("");
    }
  }

  async function issuePayslip(entry) {
    setPayslipBusy(`issue:${entry.id}`);
    setProblem("");
    setPayslipNotice("");
    try {
      const response = await axiosClient.post(`/payroll/payslips/entries/${entry.id}/issue`, payrollParams());
      setPayslipNotice(response.data?.message || "Professional payslip issued.");
      setReloadKey((value) => value + 1);
    } catch (error) {
      setProblem(errorMessage(error, "Professional payslip could not be issued."));
    } finally {
      setPayslipBusy("");
    }
  }

  async function openPayslipPdf(payslip) {
    setPayslipBusy(`pdf:${payslip.id}`);
    setProblem("");
    try {
      const response = await axiosClient.get(`/payroll/payslips/${payslip.id}/pdf`, {
        params: payrollParams(),
        responseType: "blob",
      });
      const blob = response.data instanceof Blob
        ? response.data
        : new Blob([response.data], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.click();
      globalThis.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) {
      setProblem(errorMessage(error, "Payslip PDF could not be opened."));
    } finally {
      setPayslipBusy("");
    }
  }

  async function openVerification(payslip) {
    setPayslipBusy(`verify:${payslip.id}`);
    setProblem("");
    try {
      const response = await axiosClient.get(`/payroll/payslips/${payslip.id}`, {
        params: payrollParams(),
      });
      const verificationUrl = response.data?.payslip?.verification_url;
      if (!verificationUrl) throw new Error("Verification URL is unavailable for this payslip.");
      const link = document.createElement("a");
      link.href = verificationUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.click();
    } catch (error) {
      setProblem(errorMessage(error, "Payslip verification could not be opened."));
    } finally {
      setPayslipBusy("");
    }
  }

  if (loading) {
    return <div className="worker-payroll__loading">Loading confidential payroll history…</div>;
  }

  if (problem && !profile) {
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
          This is the salary record Payroll uses automatically for {workspaceLabel || worker?.workspace_code || "this business category"}. Create the worker once, then manage salary changes here without re-entering salary every month.
        </span>
      </div>
      {salaryNotice ? <div className="worker-payroll__notice is-success">{salaryNotice}</div> : null}
      {payslipNotice ? <div className="worker-payroll__notice is-success">{payslipNotice}</div> : null}
      {problem ? <div className="worker-payroll__notice is-error" role="alert">{problem}</div> : null}

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
          eyebrow="Salary"
          title="Current salary"
          note="Payroll uses this automatically"
        />
        {canManageCompensation ? (
          <div className="worker-payroll__salary-actions">
            <button
              type="button"
              className="worker-payroll__button is-primary"
              onClick={() => {
                setSalaryChangeOpen((value) => !value);
                setSalaryForm((current) => ({
                  ...current,
                  pay_frequency: currentCompensation?.pay_frequency || current.pay_frequency || "monthly",
                }));
              }}
            >
              {salaryChangeOpen ? "Close Salary Change" : "Change Salary"}
            </button>
            <span>Changing salary creates a new effective-dated record; the old salary history is never overwritten.</span>
          </div>
        ) : null}
        {salaryChangeOpen ? (
          <form className="worker-payroll__salary-form" onSubmit={createSalaryChange}>
            <label>New basic salary (GHS)<input type="number" min="0.01" step="0.01" required value={salaryForm.basic_salary} onChange={(event) => setSalaryForm((current) => ({ ...current, basic_salary: event.target.value }))} /></label>
            <label>Pay frequency<select value={salaryForm.pay_frequency} onChange={(event) => setSalaryForm((current) => ({ ...current, pay_frequency: event.target.value }))}><option value="monthly">Monthly</option><option value="weekly">Weekly</option><option value="biweekly">Every two weeks</option></select></label>
            <label>Effective from<input type="date" required value={salaryForm.effective_from} onChange={(event) => setSalaryForm((current) => ({ ...current, effective_from: event.target.value }))} /></label>
            <label className="is-wide">Reason for salary change<textarea rows="3" minLength="8" required value={salaryForm.change_reason} onChange={(event) => setSalaryForm((current) => ({ ...current, change_reason: event.target.value }))} placeholder="e.g. Annual salary review effective September 2026" /></label>
            <div className="worker-payroll__salary-form-footer is-wide">
              <span>Existing recurring allowances and deductions are carried forward automatically.</span>
              <button className="worker-payroll__button is-primary" type="submit" disabled={salaryBusy === "create"}>{salaryBusy === "create" ? "Saving…" : canPrepareCompensation ? "Save & Send for Approval" : "Save Salary Change"}</button>
            </div>
          </form>
        ) : null}
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

      <section className="worker-payroll__card" data-testid="worker-professional-payslips">
        <SectionHeader
          eyebrow="Professional documents"
          title="Payslips & verification"
          note={`${payslips.length} preserved version(s)`}
        />
        <div className="worker-payroll__notice is-neutral">
          Payslips are issued only after the worker is fully paid and the payroll period is reconciled. Each PDF contains an immutable checksum and a QR link to the public Chalin 03 Verification Centre.
        </div>
        {canIssuePayslip && eligiblePayslipEntries.some((entry) => !currentPayslipByPeriod.has(String(entry.payroll_period_id))) ? (
          <div className="worker-payroll__payslip-issue-list">
            {eligiblePayslipEntries
              .filter((entry) => !currentPayslipByPeriod.has(String(entry.payroll_period_id)))
              .map((entry) => (
                <article key={entry.id}>
                  <div>
                    <strong>{entry.period_code}</strong>
                    <span>{money(entry.net_salary)} net · reconciled</span>
                  </div>
                  <button
                    type="button"
                    className="worker-payroll__button is-primary"
                    disabled={payslipBusy === `issue:${entry.id}`}
                    onClick={() => issuePayslip(entry)}
                  >
                    {payslipBusy === `issue:${entry.id}` ? "Issuing…" : "Issue Payslip"}
                  </button>
                </article>
              ))}
          </div>
        ) : null}
        {!payslips.length ? (
          <Empty>No professional payslip has been issued for this worker yet.</Empty>
        ) : (
          <div className="worker-payroll__payslip-grid">
            {payslips.map((payslip) => (
              <article key={payslip.id}>
                <div className="worker-payroll__payslip-head">
                  <div>
                    <small>{payslip.period_code}</small>
                    <strong>{payslip.payslip_number}</strong>
                    <span>Version {payslip.issue_version} · issued {dateLabel(payslip.issued_at)}</span>
                  </div>
                  <b className={`worker-payroll__status is-${payslip.issue_status}`}>{label(payslip.issue_status)}</b>
                </div>
                <div className="worker-payroll__payslip-actions">
                  <button
                    type="button"
                    className="worker-payroll__button"
                    disabled={Boolean(payslipBusy)}
                    onClick={() => openPayslipPdf(payslip)}
                  >
                    {payslipBusy === `pdf:${payslip.id}` ? "Opening…" : "View PDF"}
                  </button>
                  <button
                    type="button"
                    className="worker-payroll__button"
                    disabled={Boolean(payslipBusy)}
                    onClick={() => openVerification(payslip)}
                  >
                    {payslipBusy === `verify:${payslip.id}` ? "Opening…" : "Verify QR Record"}
                  </button>
                </div>
              </article>
            ))}
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
              {profile.compensation_history.map((item) => {
                const ownChange = Number(item.created_by) === Number(auth.user?.id) || Number(item.submitted_by) === Number(auth.user?.id);
                return (
                  <article key={item.id}>
                    <div><strong>{money(item.basic_salary)}</strong><span>{label(item.status)}</span></div>
                    <p>{dateLabel(item.effective_from)} → {item.effective_to ? dateLabel(item.effective_to) : "Open ended"}</p>
                    <small>{item.change_reason}</small>
                    <div className="worker-payroll__history-actions">
                      {item.status === "draft" && canPrepareCompensation ? <button type="button" className="worker-payroll__button" disabled={Boolean(salaryBusy)} onClick={() => submitSalaryChange(item)}>{salaryBusy === `submit:${item.id}` ? "Sending…" : "Send for Approval"}</button> : null}
                      {item.status === "pending_approval" && canApproveCompensation && !ownChange ? <button type="button" className="worker-payroll__button is-primary" disabled={Boolean(salaryBusy)} onClick={() => approveSalaryChange(item)}>{salaryBusy === `approve:${item.id}` ? "Approving…" : "Approve Salary Change"}</button> : null}
                      {item.status === "pending_approval" && ownChange ? <span>Awaiting approval by another authorised user.</span> : null}
                    </div>
                  </article>
                );
              })}
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