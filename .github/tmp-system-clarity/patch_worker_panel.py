from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def r(p): return (ROOT/p).read_text(encoding='utf-8')
def w(p,t): (ROOT/p).write_text(t,encoding='utf-8')
def rep(p,a,b):
    t=r(p); n=t.count(a)
    if n!=1: raise SystemExit(f'{p}: expected one match, got {n}: {a[:80]!r}')
    w(p,t.replace(a,b,1))
p='frontend/src/components/WorkerPayrollPanel.jsx'
rep(p,'''function errorMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}
''','''function errorMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

function todayText() {
  return new Date().toISOString().slice(0, 10);
}
''')
rep(p,'''  const auth = useAuth();
  const canIssuePayslip = auth.hasPermission("payroll.payslip.issue");
  const systemAdministrator = Boolean(auth.user?.is_original_system_administrator);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState("");
  const [payslipNotice, setPayslipNotice] = useState("");
  const [payslipBusy, setPayslipBusy] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
''','''  const auth = useAuth();
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
''')
rep(p,'''  async function issuePayslip(entry) {
''','''  function carriedForwardComponents() {
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
''')
rep(p,'''        <span>
          Visible only through explicit Payroll View permission. Salary history remains separate from the general worker profile and is scoped to {workspaceLabel || worker?.workspace_code || "this business category"}.
        </span>
''','''        <span>
          This is the salary record Payroll uses automatically for {workspaceLabel || worker?.workspace_code || "this business category"}. Create the worker once, then manage salary changes here without re-entering salary every month.
        </span>
''')
rep(p,'''      {payslipNotice ? <div className="worker-payroll__notice is-success">{payslipNotice}</div> : null}
      {problem ? <div className="worker-payroll__notice is-error" role="alert">{problem}</div> : null}
''','''      {salaryNotice ? <div className="worker-payroll__notice is-success">{salaryNotice}</div> : null}
      {payslipNotice ? <div className="worker-payroll__notice is-success">{payslipNotice}</div> : null}
      {problem ? <div className="worker-payroll__notice is-error" role="alert">{problem}</div> : null}
''')
rep(p,'''        <SectionHeader
          eyebrow="Authoritative compensation"
          title="Current salary setup"
          note="Approved, effective-dated history only"
        />
        {!currentCompensation ? (
''','''        <SectionHeader
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
''')
rep(p,'''              {profile.compensation_history.map((item) => (
                <article key={item.id}>
                  <div><strong>{money(item.basic_salary)}</strong><span>{label(item.status)}</span></div>
                  <p>{dateLabel(item.effective_from)} → {item.effective_to ? dateLabel(item.effective_to) : "Open ended"}</p>
                  <small>{item.change_reason}</small>
                </article>
              ))}
''','''              {profile.compensation_history.map((item) => {
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
''')

p='frontend/src/styles/workerPayrollPanel.css'
rep(p,'''.worker-payroll__two-column {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
''','''.worker-payroll__salary-actions { display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:14px; }
.worker-payroll__salary-actions span,
.worker-payroll__salary-form-footer span,
.worker-payroll__history-actions span { color:#65758a; font-size:.86rem; }
.worker-payroll__salary-form { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; margin-bottom:16px; border:1px solid #d9e3ed; border-radius:14px; background:#f8fbfe; padding:14px; }
.worker-payroll__salary-form label { display:grid; gap:6px; color:#40556c; font-size:.88rem; font-weight:700; }
.worker-payroll__salary-form input,
.worker-payroll__salary-form select,
.worker-payroll__salary-form textarea { width:100%; box-sizing:border-box; border:1px solid #cbd6e1; border-radius:10px; background:#fff; padding:9px 10px; color:#20364e; font:inherit; }
.worker-payroll__salary-form .is-wide { grid-column:1 / -1; }
.worker-payroll__salary-form-footer,
.worker-payroll__history-actions { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; }
.worker-payroll__history-actions { margin-top:10px; justify-content:flex-start; }

.worker-payroll__two-column {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
''')
rep(p,'''  .worker-payroll__metrics,
  .worker-payroll__current-grid,
  .worker-payroll__component-groups,
  .worker-payroll__two-column,
  .worker-payroll__loan-grid {
    grid-template-columns: 1fr;
  }
''','''  .worker-payroll__metrics,
  .worker-payroll__current-grid,
  .worker-payroll__component-groups,
  .worker-payroll__salary-form,
  .worker-payroll__two-column,
  .worker-payroll__loan-grid {
    grid-template-columns: 1fr;
  }
''')

p='frontend/scripts/payrollWorkerProfilePhaseThreeTests.mjs'
rep(p,'''// Phase 3 remains read-only for worker/payroll profile data. Phase 5 adds one
// narrowly scoped mutation: issuing an immutable payslip from a reconciled,
// fully paid payroll entry. Keep every other mutation method forbidden here.
const postCalls = [...payroll.matchAll(/axiosClient\.post\(/g)];
assert.equal(postCalls.length, 1, "worker payroll panel should expose only the Phase 5 payslip issuance POST");
assert.match(payroll, /axiosClient\.post\(`\/payroll\/payslips\/entries\/\$\{entry\.id\}\/issue`/);
assert.doesNotMatch(payroll, /axiosClient\.(put|delete|patch)\(/);
''','''// Salary management is intentionally available here: draft, submit and approve,
// plus immutable payslip issuance. Keep every other mutation method forbidden.
const postCalls = [...payroll.matchAll(/axiosClient\.post\(/g)];
assert.equal(postCalls.length, 4, "worker payroll panel should expose exactly salary create/submit/approve plus payslip issue");
assert.match(payroll, /\/payroll\/workers\/\$\{workerId\}\/compensation/);
assert.match(payroll, /\/payroll\/compensation\/\$\{profileId\}\/submit/);
assert.match(payroll, /\/payroll\/compensation\/\$\{item\.id\}\/approve/);
assert.match(payroll, /axiosClient\.post\(`\/payroll\/payslips\/entries\/\$\{entry\.id\}\/issue`/);
assert.match(payroll, /Change Salary/);
assert.match(payroll, /Save & Send for Approval/);
assert.doesNotMatch(payroll, /axiosClient\.(put|delete|patch)\(/);
''')
print('worker salary UI patched')
