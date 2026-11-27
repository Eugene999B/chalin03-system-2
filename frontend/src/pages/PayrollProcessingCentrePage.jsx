import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router";

import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";

import "../styles/payrollProcessingCentre.css";

const API = "/payroll";
const WORKFLOW = ["draft", "pending_approval", "approved", "locked", "paying", "reconciled"];

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

function currentMonthForm() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const end = new Date(year, now.getMonth() + 1, 0);
  const endText = `${year}-${month}-${String(end.getDate()).padStart(2, "0")}`;
  return {
    period_code: `${year}${month}`,
    period_start: `${year}-${month}-01`,
    period_end: endText,
    scheduled_pay_date: endText,
    notes: "",
  };
}

function paymentKey(entryId) {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (!uuid) throw new Error("Use a current browser before posting a salary payment.");
  return `payroll-payment:${entryId}:${uuid}`;
}

function workspaceLabel(code) {
  if (code === "mining") return "Mining Operations";
  if (code === "equipment_hire") return "Equipment Business";
  return "Spare Parts";
}

function Notice({ type = "info", children }) {
  return <div className={`payroll-centre__notice is-${type}`}>{children}</div>;
}

function Metric({ label: title, value, note, tone = "" }) {
  return (
    <article className={`payroll-centre__metric ${tone ? `is-${tone}` : ""}`}>
      <span>{title}</span>
      <strong>{value}</strong>
      {note ? <small>{note}</small> : null}
    </article>
  );
}

function Empty({ children }) {
  return <div className="payroll-centre__empty">{children}</div>;
}

function WorkflowStrip({ status }) {
  const activeIndex = WORKFLOW.indexOf(status);
  return (
    <div className="payroll-centre__workflow" aria-label="Payroll workflow status">
      {WORKFLOW.map((item, index) => (
        <div
          key={item}
          className={`${index < activeIndex ? "is-complete" : ""} ${index === activeIndex ? "is-current" : ""}`}
        >
          <b>{index < activeIndex ? "✓" : index + 1}</b>
          <span>{label(item)}</span>
        </div>
      ))}
    </div>
  );
}

function buildRuleConfiguration(form) {
  const base = {
    calculation_type: form.calculation_type,
    line_type: form.line_type,
    line_code: form.line_code || form.rule_code,
    line_name: form.line_name || form.rule_code,
    basis: form.basis,
  };
  if (form.calculation_type === "percentage") {
    return { ...base, rate_percent: Number(form.rate_percent || 0) };
  }
  if (form.calculation_type === "fixed") {
    return { ...base, amount: Number(form.fixed_amount || 0) };
  }
  let bands;
  try {
    bands = JSON.parse(form.bands_json || "[]");
  } catch {
    throw new Error("Progressive bands must be valid JSON.");
  }
  if (!Array.isArray(bands)) throw new Error("Progressive bands must be a JSON array.");
  return { ...base, bands };
}

export default function PayrollProcessingCentrePage() {
  const auth = useAuth();
  const location = useLocation();
  const systemAdministrator = Boolean(auth.user?.is_original_system_administrator);
  const routeWorkspace = location.pathname.startsWith("/mining")
    ? "mining"
    : location.pathname.startsWith("/equipment-")
      ? "equipment_hire"
      : "spare_parts";
  const sessionWorkspace = auth.workspaceCode || auth.user?.workspace_code;
  const workspaceCode = ["spare_parts", "mining", "equipment_hire"].includes(sessionWorkspace)
    ? sessionWorkspace
    : routeWorkspace;
  const canPrepare = auth.hasPermission("payroll.prepare");
  const canApprove = auth.hasPermission("payroll.approve");
  const canPay = auth.hasPermission("payroll.pay");
  const canAdjust = auth.hasPermission("payroll.adjust");
  const canAudit = auth.hasPermission("payroll.audit");
  const canManage = auth.hasPermission("payroll.manage");

  const [periods, setPeriods] = useState([]);
  const [rules, setRules] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState(null);
  const [validation, setValidation] = useState(null);
  const [tab, setTab] = useState("periods");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");
  const [periodForm, setPeriodForm] = useState(currentMonthForm);
  const [ruleForm, setRuleForm] = useState({
    scope_code: workspaceCode,
    rule_code: "",
    version_label: "",
    effective_from: new Date().toISOString().slice(0, 10),
    change_reason: "",
    calculation_type: "percentage",
    line_type: "deduction",
    line_code: "",
    line_name: "",
    basis: "gross_earnings",
    rate_percent: "",
    fixed_amount: "",
    bands_json: '[{"up_to":1000,"rate_percent":0},{"up_to":null,"rate_percent":10}]',
  });
  const [selectedEntryId, setSelectedEntryId] = useState("");
  const [paymentForm, setPaymentForm] = useState({
    amount: "",
    payment_date: new Date().toISOString().slice(0, 10),
    payment_method: "bank",
    payment_reference: "",
    destination_masked: "",
    idempotency_key: "",
  });
  const [reversalPaymentId, setReversalPaymentId] = useState("");
  const [reversalForm, setReversalForm] = useState({ reason: "", evidence_reference: "" });
  const [decisions, setDecisions] = useState({});

  const apiParams = useMemo(
    () => (systemAdministrator ? { workspace_code: workspaceCode } : {}),
    [systemAdministrator, workspaceCode]
  );

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setProblem("");
    try {
      const [periodResponse, ruleResponse] = await Promise.all([
        axiosClient.get(`${API}/periods`, { params: apiParams }),
        axiosClient.get(`${API}/statutory-rules`, { params: apiParams }),
      ]);
      const nextPeriods = periodResponse.data?.periods || [];
      setPeriods(nextPeriods);
      setRules(ruleResponse.data?.rules || []);
      if (!selectedId && nextPeriods.length) setSelectedId(String(nextPeriods[0].id));
    } catch (error) {
      setProblem(errorMessage(error, "Payroll command data could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, [apiParams, selectedId]);

  const loadDetail = useCallback(async (periodId) => {
    if (!periodId) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    setProblem("");
    try {
      const response = await axiosClient.get(`${API}/processing/periods/${periodId}`, { params: apiParams });
      setDetail(response.data || null);
    } catch (error) {
      setProblem(errorMessage(error, "Payroll period details could not be loaded."));
    } finally {
      setDetailLoading(false);
    }
  }, [apiParams]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
  }, [loadDetail, selectedId]);

  const selectedEntry = useMemo(
    () => (detail?.entries || []).find((entry) => String(entry.id) === String(selectedEntryId)) || null,
    [detail, selectedEntryId]
  );

  async function refresh(periodId = selectedId) {
    await loadOverview();
    if (periodId) await loadDetail(periodId);
  }

  async function createPeriod(event) {
    event.preventDefault();
    setBusy("create-period");
    setProblem("");
    setNotice("");
    try {
      const response = await axiosClient.post(`${API}/periods`, { ...periodForm, ...apiParams });
      const created = response.data?.period;
      setNotice(response.data?.message || "Payroll period created.");
      setPeriodForm(currentMonthForm());
      if (created?.id) setSelectedId(String(created.id));
      await refresh(created?.id);
    } catch (error) {
      setProblem(errorMessage(error, "Payroll period could not be created."));
    } finally {
      setBusy("");
    }
  }

  async function validatePeriod() {
    if (!selectedId) return;
    setBusy("validate");
    setProblem("");
    setNotice("");
    setValidation(null);
    try {
      const response = await axiosClient.post(`${API}/processing/periods/${selectedId}/validate`, apiParams);
      setValidation(response.data?.validation || null);
      setNotice(response.data?.message || "Payroll validation passed.");
    } catch (error) {
      const nextValidation = error?.response?.data?.validation || error?.response?.data?.details || null;
      if (nextValidation) setValidation(nextValidation);
      setProblem(errorMessage(error, "Payroll validation found exceptions."));
    } finally {
      setBusy("");
    }
  }

  async function periodAction(action, successFallback) {
    if (!selectedId) return;
    setBusy(action);
    setProblem("");
    setNotice("");
    try {
      const response = await axiosClient.post(`${API}/processing/periods/${selectedId}/${action}`, apiParams);
      setNotice(response.data?.message || successFallback);
      setValidation(null);
      await refresh(selectedId);
    } catch (error) {
      const nextValidation = error?.response?.data?.details || null;
      if (nextValidation) setValidation(nextValidation);
      setProblem(errorMessage(error, `Payroll ${action} could not be completed.`));
    } finally {
      setBusy("");
    }
  }

  async function createRule(event) {
    event.preventDefault();
    setBusy("create-rule");
    setProblem("");
    setNotice("");
    try {
      const configuration = buildRuleConfiguration(ruleForm);
      const response = await axiosClient.post(`${API}/statutory-rules`, {
        ...apiParams,
        scope_code: ruleForm.scope_code,
        rule_code: ruleForm.rule_code,
        version_label: ruleForm.version_label,
        effective_from: ruleForm.effective_from,
        change_reason: ruleForm.change_reason,
        configuration,
      });
      setNotice(response.data?.message || "Statutory rule draft created.");
      setRuleForm((current) => ({ ...current, rule_code: "", version_label: "", line_code: "", line_name: "", rate_percent: "", fixed_amount: "", change_reason: "" }));
      await loadOverview();
    } catch (error) {
      setProblem(errorMessage(error, "Statutory rule draft could not be created."));
    } finally {
      setBusy("");
    }
  }

  async function ruleAction(ruleId, action) {
    setBusy(`rule:${ruleId}:${action}`);
    setProblem("");
    setNotice("");
    try {
      const response = await axiosClient.post(`${API}/processing/statutory-rules/${ruleId}/${action}`, apiParams);
      setNotice(response.data?.message || `Statutory rule ${action} completed.`);
      await loadOverview();
    } catch (error) {
      setProblem(errorMessage(error, `Statutory rule ${action} failed.`));
    } finally {
      setBusy("");
    }
  }

  function openPayment(entry) {
    setSelectedEntryId(String(entry.id));
    setPaymentForm({
      amount: String(entry.remaining_balance || ""),
      payment_date: new Date().toISOString().slice(0, 10),
      payment_method: "bank",
      payment_reference: "",
      destination_masked: "",
      idempotency_key: paymentKey(entry.id),
    });
  }

  async function postPayment(event) {
    event.preventDefault();
    if (!selectedEntry) return;
    setBusy(`pay:${selectedEntry.id}`);
    setProblem("");
    setNotice("");
    try {
      const response = await axiosClient.post(`${API}/processing/entries/${selectedEntry.id}/payments`, {
        ...paymentForm,
        ...apiParams,
      });
      setNotice(response.data?.message || "Salary payment posted.");
      setSelectedEntryId("");
      await refresh(selectedId);
    } catch (error) {
      setProblem(errorMessage(error, "Salary payment could not be posted."));
    } finally {
      setBusy("");
    }
  }

  async function requestReversal(event) {
    event.preventDefault();
    if (!reversalPaymentId) return;
    setBusy(`reverse:${reversalPaymentId}`);
    setProblem("");
    setNotice("");
    try {
      const response = await axiosClient.post(`${API}/processing/payments/${reversalPaymentId}/reversal-request`, {
        ...reversalForm,
        ...apiParams,
      });
      setNotice(response.data?.message || "Payment reversal requested.");
      setReversalPaymentId("");
      setReversalForm({ reason: "", evidence_reference: "" });
      await refresh(selectedId);
    } catch (error) {
      setProblem(errorMessage(error, "Payment reversal request could not be saved."));
    } finally {
      setBusy("");
    }
  }

  async function decideAdjustment(event, adjustment) {
    event.preventDefault();
    const form = decisions[adjustment.id] || { decision: "approve", reason: "" };
    setBusy(`decision:${adjustment.id}`);
    setProblem("");
    setNotice("");
    try {
      const response = await axiosClient.post(`${API}/processing/adjustments/${adjustment.id}/decision`, {
        ...form,
        ...apiParams,
      });
      setNotice(response.data?.message || "Payroll adjustment decision recorded.");
      setDecisions((current) => ({ ...current, [adjustment.id]: { decision: "approve", reason: "" } }));
      await refresh(selectedId);
    } catch (error) {
      setProblem(errorMessage(error, "Payroll adjustment decision could not be recorded."));
    } finally {
      setBusy("");
    }
  }

  const period = detail?.period;
  const summary = detail?.summary || {};
  const activeRules = rules.filter((rule) => rule.status === "approved");
  const pendingAdjustments = (detail?.adjustments || []).filter((item) => item.request_status === "pending");

  return (
    <main className="payroll-centre" data-testid="payroll-processing-centre">
      <header className="payroll-centre__hero">
        <div>
          <p>{workspaceLabel(workspaceCode)} · Simple monthly payroll</p>
          <h1>Run Monthly Payroll</h1>
          <span>
            Workers and salaries come automatically from Worker Profiles. Start the month, preview everyone,
            send the payroll for approval, record payments and reconcile when payment is complete.
          </span>
        </div>
        <div className="payroll-centre__hero-badge">
          <strong>{activeRules.length}</strong>
          <span>approved rule version(s)</span>
        </div>
      </header>

      <Notice>
        <strong>How monthly payroll works:</strong> Worker Profiles supply each employee and active salary → this page previews the month → approval confirms the calculation → payments and payslips are recorded from the approved payroll.
      </Notice>
      {notice ? <Notice type="success">{notice}</Notice> : null}
      {problem ? <Notice type="error">{problem}</Notice> : null}

      <nav className="payroll-centre__tabs" aria-label="Payroll centre sections">
        <button type="button" className={tab === "periods" ? "is-active" : ""} onClick={() => setTab("periods")}>Monthly Payroll</button>
        {(canManage || canApprove) ? <button type="button" className={tab === "rules" ? "is-active" : ""} onClick={() => setTab("rules")}>Payroll Settings</button> : null}
        <button type="button" className={tab === "approvals" ? "is-active" : ""} onClick={() => setTab("approvals")}>Corrections ({pendingAdjustments.length})</button>
      </nav>

      {tab === "rules" ? (
        <section className="payroll-centre__rule-layout">
          <div className="payroll-centre__card">
            <div className="payroll-centre__section-head"><div><p>Payroll settings</p><h2>Statutory rules</h2></div><span>{rules.length} version(s)</span></div>
            {loading ? <Empty>Loading statutory rule versions…</Empty> : null}
            {!loading && !rules.length ? <Empty>No statutory rule version has been recorded.</Empty> : null}
            <div className="payroll-centre__rule-list">
              {rules.map((rule) => (
                <article key={rule.id}>
                  <div>
                    <small>{rule.rule_code}</small>
                    <strong>{rule.version_label}</strong>
                    <span>{rule.scope_code} · from {dateLabel(rule.effective_from)}</span>
                  </div>
                  <div className="payroll-centre__rule-actions">
                    <b className={`is-${rule.status}`}>{label(rule.status)}</b>
                    {rule.status === "draft" && canPrepare ? <button type="button" disabled={busy.startsWith(`rule:${rule.id}:`)} onClick={() => ruleAction(rule.id, "submit")}>Submit</button> : null}
                    {rule.status === "pending_approval" && canApprove ? <button className="is-primary" type="button" disabled={busy.startsWith(`rule:${rule.id}:`)} onClick={() => ruleAction(rule.id, "approve")}>Approve</button> : null}
                  </div>
                </article>
              ))}
            </div>
          </div>

          {canManage ? (
            <form className="payroll-centre__card payroll-centre__form" onSubmit={createRule}>
              <div className="payroll-centre__section-head"><div><p>Maker step</p><h2>New rule version</h2></div><span>Rates remain data</span></div>
              {systemAdministrator ? (
                <label>Scope<select value={ruleForm.scope_code} onChange={(event) => setRuleForm((current) => ({ ...current, scope_code: event.target.value }))}><option value={workspaceCode}>Current category</option><option value="group">Group-wide</option></select></label>
              ) : null}
              <div className="payroll-centre__form-grid">
                <label>Rule code<input required value={ruleForm.rule_code} onChange={(event) => setRuleForm((current) => ({ ...current, rule_code: event.target.value }))} placeholder="paye or ssnit_employee" /></label>
                <label>Version label<input required value={ruleForm.version_label} onChange={(event) => setRuleForm((current) => ({ ...current, version_label: event.target.value }))} placeholder="2026-v1" /></label>
                <label>Effective from<input type="date" required value={ruleForm.effective_from} onChange={(event) => setRuleForm((current) => ({ ...current, effective_from: event.target.value }))} /></label>
                <label>Calculation<select value={ruleForm.calculation_type} onChange={(event) => setRuleForm((current) => ({ ...current, calculation_type: event.target.value }))}><option value="percentage">Percentage</option><option value="fixed">Fixed amount</option><option value="progressive_bands">Progressive bands</option></select></label>
                <label>Payroll effect<select value={ruleForm.line_type} onChange={(event) => setRuleForm((current) => ({ ...current, line_type: event.target.value }))}><option value="deduction">Employee deduction</option><option value="employer_contribution">Employer contribution</option></select></label>
                <label>Basis<select value={ruleForm.basis} onChange={(event) => setRuleForm((current) => ({ ...current, basis: event.target.value }))}><option value="basic_earned">Basic earned</option><option value="gross_earnings">Gross earnings</option><option value="taxable_gross">Taxable gross</option></select></label>
                <label>Line code<input value={ruleForm.line_code} onChange={(event) => setRuleForm((current) => ({ ...current, line_code: event.target.value }))} placeholder="Defaults to rule code" /></label>
                <label>Line name<input value={ruleForm.line_name} onChange={(event) => setRuleForm((current) => ({ ...current, line_name: event.target.value }))} placeholder="Displayed payroll line" /></label>
                {ruleForm.calculation_type === "percentage" ? <label>Rate %<input type="number" min="0" step="0.0001" required value={ruleForm.rate_percent} onChange={(event) => setRuleForm((current) => ({ ...current, rate_percent: event.target.value }))} /></label> : null}
                {ruleForm.calculation_type === "fixed" ? <label>Fixed amount<input type="number" min="0" step="0.01" required value={ruleForm.fixed_amount} onChange={(event) => setRuleForm((current) => ({ ...current, fixed_amount: event.target.value }))} /></label> : null}
              </div>
              {ruleForm.calculation_type === "progressive_bands" ? <label>Progressive bands JSON<textarea rows="5" value={ruleForm.bands_json} onChange={(event) => setRuleForm((current) => ({ ...current, bands_json: event.target.value }))} /></label> : null}
              <label>Change reason<textarea rows="3" required value={ruleForm.change_reason} onChange={(event) => setRuleForm((current) => ({ ...current, change_reason: event.target.value }))} placeholder="Why this version is being introduced and the source of the authorised rule." /></label>
              <button className="is-primary" type="submit" disabled={busy === "create-rule"}>{busy === "create-rule" ? "Saving…" : "Save Rule Draft"}</button>
            </form>
          ) : null}
        </section>
      ) : null}

      {tab === "periods" ? (
        <section className="payroll-centre__period-layout">
          <aside className="payroll-centre__period-sidebar">
            {canPrepare ? (
              <form className="payroll-centre__card payroll-centre__form is-compact" onSubmit={createPeriod}>
                <div className="payroll-centre__section-head"><div><p>New cycle</p><h2>Create payroll period</h2></div></div>
                <label>Period code<input required value={periodForm.period_code} onChange={(event) => setPeriodForm((current) => ({ ...current, period_code: event.target.value }))} /></label>
                <label>Start<input type="date" required value={periodForm.period_start} onChange={(event) => setPeriodForm((current) => ({ ...current, period_start: event.target.value }))} /></label>
                <label>End<input type="date" required value={periodForm.period_end} onChange={(event) => setPeriodForm((current) => ({ ...current, period_end: event.target.value }))} /></label>
                <label>Scheduled pay date<input type="date" value={periodForm.scheduled_pay_date} onChange={(event) => setPeriodForm((current) => ({ ...current, scheduled_pay_date: event.target.value }))} /></label>
                <button className="is-primary" type="submit" disabled={busy === "create-period"}>Start This Month&apos;s Payroll</button>
              </form>
            ) : null}

            <div className="payroll-centre__card">
              <div className="payroll-centre__section-head"><div><p>Choose cycle</p><h2>Payroll periods</h2></div><span>{periods.length}</span></div>
              {loading ? <Empty>Loading payroll periods…</Empty> : null}
              <div className="payroll-centre__period-list">
                {periods.map((item) => (
                  <button type="button" key={item.id} className={String(item.id) === String(selectedId) ? "is-active" : ""} onClick={() => { setSelectedId(String(item.id)); setValidation(null); }}>
                    <strong>{item.period_code}</strong><span>{dateLabel(item.period_start)} – {dateLabel(item.period_end)}</span><b className={`is-${item.status}`}>{label(item.status)}</b>
                  </button>
                ))}
                {!loading && !periods.length ? <Empty>No payroll period has been created.</Empty> : null}
              </div>
            </div>
          </aside>

          <div className="payroll-centre__period-file">
            {detailLoading ? <Empty>Opening payroll period…</Empty> : null}
            {!detailLoading && !period ? <Empty>Select or create a payroll period.</Empty> : null}
            {period ? (
              <>
                <section className="payroll-centre__card payroll-centre__period-head">
                  <div className="payroll-centre__section-head">
                    <div><p>Selected payroll cycle</p><h2>{period.period_code}</h2><span>{dateLabel(period.period_start)} – {dateLabel(period.period_end)} · Pay {dateLabel(period.scheduled_pay_date)}</span></div>
                    <b className={`payroll-centre__status is-${period.status}`}>{label(period.status)}</b>
                  </div>
                  <WorkflowStrip status={period.status} />
                  <div className="payroll-centre__actions">
                    {period.status === "draft" && canPrepare ? <button type="button" onClick={validatePeriod} disabled={busy === "validate"}>Preview Workers &amp; Salaries</button> : null}
                    {period.status === "draft" && canPrepare ? <button className="is-primary" type="button" onClick={() => periodAction("prepare", "Payroll sent for approval.")} disabled={busy === "prepare"}>Confirm &amp; Send for Approval</button> : null}
                    {period.status === "pending_approval" && canApprove ? <button className="is-primary" type="button" onClick={() => periodAction("approve", "Payroll approved.")} disabled={busy === "approve"}>Approve Payroll</button> : null}
                    {period.status === "approved" && canApprove ? <button className="is-primary" type="button" onClick={() => periodAction("lock", "Payroll locked.")} disabled={busy === "lock"}>Lock for Payment</button> : null}
                    {["locked", "paying", "reconciled"].includes(period.status) && canAudit ? <button type="button" onClick={() => periodAction("reconcile", "Payroll reconciled.")} disabled={busy === "reconcile"}>Reconcile Payments</button> : null}
                  </div>
                </section>

                {validation ? (
                  <section className={`payroll-centre__card payroll-centre__validation ${validation.valid ? "is-valid" : "is-invalid"}`}>
                    <div className="payroll-centre__section-head"><div><p>Pre-approval validation</p><h2>{validation.valid ? "Ready for review" : "Exceptions found"}</h2></div><span>{validation.issues?.length || 0} issue(s)</span></div>
                    {(validation.issues || []).length ? <div className="payroll-centre__issues">{validation.issues.map((issue, index) => <article key={`${issue.code}-${index}`}><b>{label(issue.code)}</b><span>{issue.worker_name ? `${issue.worker_name}: ` : ""}{issue.message}</span></article>)}</div> : <Notice type="success">Approved compensation and statutory inputs cover every payroll calculation.</Notice>}
                    <div className="payroll-centre__metrics is-four"><Metric label="Workers" value={validation.totals?.workers || 0} /><Metric label="Gross" value={money(validation.totals?.gross_earnings)} /><Metric label="Deductions" value={money(validation.totals?.deductions)} /><Metric label="Net payroll" value={money(validation.totals?.net_salary)} /></div>
                    {(validation.previews || []).length ? (
                      <div className="payroll-centre__table-wrap">
                        <table>
                          <thead><tr><th>Worker</th><th>Basic salary</th><th>Gross</th><th>Deductions</th><th>Net salary</th></tr></thead>
                          <tbody>
                            {validation.previews.map((worker) => (
                              <tr key={worker.worker_id}>
                                <td><strong>{worker.worker_name}</strong><small>{worker.employee_number} · {label(worker.pay_frequency)}</small></td>
                                <td>{money(worker.basic_salary)}</td>
                                <td>{money(worker.gross_earnings)}</td>
                                <td>{money(worker.total_deductions)}</td>
                                <td><strong>{money(worker.net_salary)}</strong></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                  </section>
                ) : null}

                <section className="payroll-centre__metrics">
                  <Metric label="Workers" value={summary.workers || 0} note={`${summary.paid_workers || 0} paid`} />
                  <Metric label="Gross payroll" value={money(summary.gross_earnings)} />
                  <Metric label="Deductions" value={money(summary.deductions)} />
                  <Metric label="Employer contributions" value={money(summary.employer_contributions)} />
                  <Metric label="Net payroll" value={money(summary.net_salary)} />
                  <Metric label="Amount paid" value={money(summary.amount_paid)} tone="success" />
                  <Metric label="Outstanding" value={money(summary.outstanding_balance)} tone={Number(summary.outstanding_balance || 0) > 0 ? "warning" : "success"} />
                </section>

                <section className="payroll-centre__card">
                  <div className="payroll-centre__section-head"><div><p>Locked worker balances</p><h2>Payroll entries</h2></div><span>{detail.entries?.length || 0} worker(s)</span></div>
                  {!(detail.entries || []).length ? <Empty>Worker calculations appear after the draft is prepared for review.</Empty> : (
                    <div className="payroll-centre__table-wrap"><table><thead><tr><th>Worker</th><th>Status</th><th>Gross</th><th>Deductions</th><th>Net</th><th>Paid</th><th>Balance</th><th>Action</th></tr></thead><tbody>{detail.entries.map((entry) => <tr key={entry.id}><td><strong>{entry.worker_name}</strong><small>{entry.employee_number} · {entry.job_title || "No job title"}</small></td><td><b className={`payroll-centre__row-status is-${entry.entry_status}`}>{label(entry.entry_status)}</b></td><td>{money(entry.gross_earnings)}</td><td>{money(entry.total_deductions)}</td><td>{money(entry.net_salary)}</td><td>{money(entry.amount_paid)}</td><td>{money(entry.remaining_balance)}</td><td>{canPay && ["locked", "paying", "reconciled"].includes(period.status) && Number(entry.remaining_balance || 0) > 0.01 ? <button type="button" onClick={() => openPayment(entry)}>Record Payment</button> : null}</td></tr>)}</tbody></table></div>
                  )}
                </section>

                {selectedEntry ? (
                  <form className="payroll-centre__card payroll-centre__form" onSubmit={postPayment}>
                    <div className="payroll-centre__section-head"><div><p>Salary payment</p><h2>{selectedEntry.worker_name}</h2></div><button type="button" onClick={() => setSelectedEntryId("")}>Close</button></div>
                    <Notice>Official remaining balance: <strong>{money(selectedEntry.remaining_balance)}</strong>. Partial salary payments are allowed; overpayment is blocked.</Notice>
                    <div className="payroll-centre__form-grid">
                      <label>Amount<input type="number" min="0.01" max={selectedEntry.remaining_balance} step="0.01" required value={paymentForm.amount} onChange={(event) => setPaymentForm((current) => ({ ...current, amount: event.target.value }))} /></label>
                      <label>Payment date<input type="date" required value={paymentForm.payment_date} onChange={(event) => setPaymentForm((current) => ({ ...current, payment_date: event.target.value }))} /></label>
                      <label>Method<select value={paymentForm.payment_method} onChange={(event) => setPaymentForm((current) => ({ ...current, payment_method: event.target.value }))}><option value="bank">Bank transfer</option><option value="momo">Mobile money</option><option value="cash">Cash</option><option value="cheque">Cheque</option><option value="other">Other</option></select></label>
                      <label>External reference<input required value={paymentForm.payment_reference} onChange={(event) => setPaymentForm((current) => ({ ...current, payment_reference: event.target.value }))} placeholder="Bank/MoMo/payment reference" /></label>
                      <label>Destination (masked)<input value={paymentForm.destination_masked} onChange={(event) => setPaymentForm((current) => ({ ...current, destination_masked: event.target.value }))} placeholder="e.g. ****1234" /></label>
                    </div>
                    <button className="is-primary" type="submit" disabled={busy === `pay:${selectedEntry.id}`}>{busy === `pay:${selectedEntry.id}` ? "Posting…" : "Post Salary Payment"}</button>
                  </form>
                ) : null}

                <section className="payroll-centre__card">
                  <div className="payroll-centre__section-head"><div><p>Payment evidence</p><h2>Posted salary payments</h2></div></div>
                  <div className="payroll-centre__payment-stack">
                    {(detail.entries || []).flatMap((entry) => (entry.payments || []).map((payment) => ({ ...payment, worker_name: entry.worker_name }))).map((payment) => (
                      <article key={payment.id}>
                        <div><strong>{payment.worker_name}</strong><span>{payment.payment_number || `Payment ${payment.id}`}</span></div>
                        <div><b>{money(payment.amount)}</b><span>{dateLabel(payment.payment_date)} · {label(payment.payment_status)}</span></div>
                        <small>{payment.payment_reference}</small>
                        {canAdjust && !payment.reversal_of_payment_id && payment.payment_status === "posted" ? <button type="button" onClick={() => setReversalPaymentId(String(payment.id))}>Request Reversal</button> : null}
                      </article>
                    ))}
                    {!(detail.entries || []).some((entry) => (entry.payments || []).length) ? <Empty>No salary payment has been posted for this period.</Empty> : null}
                  </div>
                </section>

                {reversalPaymentId ? (
                  <form className="payroll-centre__card payroll-centre__form" onSubmit={requestReversal}>
                    <div className="payroll-centre__section-head"><div><p>Independent correction</p><h2>Request payment reversal</h2></div><button type="button" onClick={() => setReversalPaymentId("")}>Close</button></div>
                    <Notice>The original payment remains financially active until a different authorised reviewer approves this request.</Notice>
                    <label>Detailed reason<textarea required rows="4" value={reversalForm.reason} onChange={(event) => setReversalForm((current) => ({ ...current, reason: event.target.value }))} /></label>
                    <label>Evidence reference<input value={reversalForm.evidence_reference} onChange={(event) => setReversalForm((current) => ({ ...current, evidence_reference: event.target.value }))} /></label>
                    <button className="is-primary" type="submit" disabled={busy === `reverse:${reversalPaymentId}`}>Submit Reversal Request</button>
                  </form>
                ) : null}
              </>
            ) : null}
          </div>
        </section>
      ) : null}

      {tab === "approvals" ? (
        <section className="payroll-centre__card">
          <div className="payroll-centre__section-head"><div><p>Checker queue</p><h2>Payment correction approvals</h2></div><span>{pendingAdjustments.length} pending</span></div>
          {!pendingAdjustments.length ? <Empty>No payroll correction is waiting for a decision in the selected period.</Empty> : null}
          <div className="payroll-centre__approval-stack">
            {pendingAdjustments.map((adjustment) => {
              const form = decisions[adjustment.id] || { decision: "approve", reason: "" };
              return (
                <form key={adjustment.id} onSubmit={(event) => decideAdjustment(event, adjustment)}>
                  <div><small>{label(adjustment.adjustment_type)}</small><strong>{money(adjustment.requested_amount)}</strong><span>Requested by {adjustment.requested_by_name || `user ${adjustment.requested_by}`}</span></div>
                  <p>{adjustment.reason}</p>
                  {canApprove ? <><select value={form.decision} onChange={(event) => setDecisions((current) => ({ ...current, [adjustment.id]: { ...form, decision: event.target.value } }))}><option value="approve">Approve</option><option value="reject">Reject</option></select><input required value={form.reason} onChange={(event) => setDecisions((current) => ({ ...current, [adjustment.id]: { ...form, reason: event.target.value } }))} placeholder="Independent decision reason" /><button className="is-primary" type="submit" disabled={busy === `decision:${adjustment.id}`}>Record Decision</button></> : <Notice type="warning">Payroll Approve permission is required to decide this request.</Notice>}
                </form>
              );
            })}
          </div>
        </section>
      ) : null}
    </main>
  );
}
