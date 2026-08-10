from pathlib import Path


def replace_once(path, old, new, label):
    text = path.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    path.write_text(text.replace(old, new, 1))

page = Path('frontend/src/pages/PayrollProcessingCentrePage.jsx')

replace_once(
    page,
    '''          <p>Payroll command centre · {workspaceLabel(workspaceCode)}</p>\n          <h1>Payroll Processing &amp; Approval</h1>\n          <span>\n            Validate salary inputs, freeze exact calculation evidence, separate maker and checker duties,\n            post controlled salary payments and reconcile every remaining balance.\n          </span>''',
    '''          <p>{workspaceLabel(workspaceCode)} · Simple monthly payroll</p>\n          <h1>Run Monthly Payroll</h1>\n          <span>\n            Workers and salaries come automatically from Worker Profiles. Start the month, preview everyone,\n            send the payroll for approval, record payments and reconcile when payment is complete.\n          </span>''',
    'payroll hero',
)

replace_once(
    page,
    '''      <Notice>\n        <strong>No statutory rate is hard-coded here.</strong> Payroll calculations use only approved, effective-dated rule configurations and approved worker compensation records.\n      </Notice>''',
    '''      <Notice>\n        <strong>How monthly payroll works:</strong> Worker Profiles supply each employee and active salary → this page previews the month → approval confirms the calculation → payments and payslips are recorded from the approved payroll.\n      </Notice>''',
    'workflow guide',
)

replace_once(
    page,
    '''      <nav className="payroll-centre__tabs" aria-label="Payroll centre sections">\n        <button type="button" className={tab === "periods" ? "is-active" : ""} onClick={() => setTab("periods")}>Payroll Periods</button>\n        <button type="button" className={tab === "rules" ? "is-active" : ""} onClick={() => setTab("rules")}>Statutory Rules</button>\n        <button type="button" className={tab === "approvals" ? "is-active" : ""} onClick={() => setTab("approvals")}>Correction Approvals ({pendingAdjustments.length})</button>\n      </nav>''',
    '''      <nav className="payroll-centre__tabs" aria-label="Payroll centre sections">\n        <button type="button" className={tab === "periods" ? "is-active" : ""} onClick={() => setTab("periods")}>Monthly Payroll</button>\n        {(canManage || canApprove) ? <button type="button" className={tab === "rules" ? "is-active" : ""} onClick={() => setTab("rules")}>Payroll Settings</button> : null}\n        <button type="button" className={tab === "approvals" ? "is-active" : ""} onClick={() => setTab("approvals")}>Corrections ({pendingAdjustments.length})</button>\n      </nav>''',
    'payroll tabs',
)

replace_once(
    page,
    '''                <button className="is-primary" type="submit" disabled={busy === "create-period"}>Create Draft Period</button>''',
    '''                <button className="is-primary" type="submit" disabled={busy === "create-period"}>Start This Month&apos;s Payroll</button>''',
    'create period button',
)

replace_once(
    page,
    '''                    {period.status === "draft" && canPrepare ? <button type="button" onClick={validatePeriod} disabled={busy === "validate"}>Validate</button> : null}\n                    {period.status === "draft" && canPrepare ? <button className="is-primary" type="button" onClick={() => periodAction("prepare", "Payroll prepared for review.")} disabled={busy === "prepare"}>Prepare for Review</button> : null}''',
    '''                    {period.status === "draft" && canPrepare ? <button type="button" onClick={validatePeriod} disabled={busy === "validate"}>Preview Workers &amp; Salaries</button> : null}\n                    {period.status === "draft" && canPrepare ? <button className="is-primary" type="button" onClick={() => periodAction("prepare", "Payroll sent for approval.")} disabled={busy === "prepare"}>Confirm &amp; Send for Approval</button> : null}''',
    'draft actions',
)

old_validation_end = '''                    <div className="payroll-centre__metrics is-four"><Metric label="Workers" value={validation.totals?.workers || 0} /><Metric label="Gross" value={money(validation.totals?.gross_earnings)} /><Metric label="Deductions" value={money(validation.totals?.deductions)} /><Metric label="Net payroll" value={money(validation.totals?.net_salary)} /></div>\n                  </section>'''
new_validation_end = '''                    <div className="payroll-centre__metrics is-four"><Metric label="Workers" value={validation.totals?.workers || 0} /><Metric label="Gross" value={money(validation.totals?.gross_earnings)} /><Metric label="Deductions" value={money(validation.totals?.deductions)} /><Metric label="Net payroll" value={money(validation.totals?.net_salary)} /></div>\n                    {(validation.previews || []).length ? (\n                      <div className="payroll-centre__table-wrap">\n                        <table>\n                          <thead><tr><th>Worker</th><th>Basic salary</th><th>Gross</th><th>Deductions</th><th>Net salary</th></tr></thead>\n                          <tbody>\n                            {validation.previews.map((worker) => (\n                              <tr key={worker.worker_id}>\n                                <td><strong>{worker.worker_name}</strong><small>{worker.employee_number} · {label(worker.pay_frequency)}</small></td>\n                                <td>{money(worker.basic_salary)}</td>\n                                <td>{money(worker.gross_earnings)}</td>\n                                <td>{money(worker.total_deductions)}</td>\n                                <td><strong>{money(worker.net_salary)}</strong></td>\n                              </tr>\n                            ))}\n                          </tbody>\n                        </table>\n                      </div>\n                    ) : null}\n                  </section>'''
replace_once(page, old_validation_end, new_validation_end, 'salary preview table')

replace_once(
    page,
    '''            <div className="payroll-centre__section-head"><div><p>Versioned data</p><h2>Statutory rule register</h2></div><span>{rules.length} version(s)</span></div>''',
    '''            <div className="payroll-centre__section-head"><div><p>Payroll settings</p><h2>Statutory rules</h2></div><span>{rules.length} version(s)</span></div>''',
    'rule settings heading',
)

test = Path('frontend/scripts/payrollProcessingPhaseFourTests.mjs')
replace_once(
    test,
    '''assert.match(page, /Payroll Processing &amp; Approval/);\nassert.match(page, /No statutory rate is hard-coded here/);\nassert.match(page, /Validate/);\nassert.match(page, /Prepare for Review/);''',
    '''assert.match(page, /Run Monthly Payroll/);\nassert.match(page, /Workers and salaries come automatically from Worker Profiles/);\nassert.match(page, /Preview Workers &amp; Salaries/);\nassert.match(page, /Confirm &amp; Send for Approval/);\nassert.match(page, /Payroll Settings/);\nassert.match(page, /Basic salary/);''',
    'payroll processing frontend contract',
)

print('Patched monthly payroll clarity UI and source contract.')
