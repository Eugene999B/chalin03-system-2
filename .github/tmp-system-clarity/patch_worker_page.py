from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def r(p): return (ROOT/p).read_text(encoding='utf-8')
def w(p,t): (ROOT/p).write_text(t,encoding='utf-8')
def rep(p,a,b):
    t=r(p); n=t.count(a)
    if n!=1: raise SystemExit(f'{p}: expected one match, got {n}: {a[:80]!r}')
    w(p,t.replace(a,b,1))
p='frontend/src/pages/ExpandedWorkerProfilePage.jsx'
rep(p,'''const emptyCreateForm = {
  full_name: "",
  preferred_name: "",
  phone: "",
  email: "",
  job_title: "",
  department: "",
  employment_type: "permanent",
  employment_start_date: today,
};
''','''const emptyCreateForm = {
  full_name: "",
  preferred_name: "",
  phone: "",
  email: "",
  job_title: "",
  department: "",
  employment_type: "permanent",
  employment_start_date: today,
  basic_salary: "",
  pay_frequency: "monthly",
};
''')
rep(p,'''  const canPayrollView = auth.hasPermission(
    "payroll.view"
  );
''','''  const canPayrollView = auth.hasPermission(
    "payroll.view"
  );

  const canPayrollManage = auth.hasPermission(
    "payroll.manage"
  );
''')
rep(p,'''          <p>Release 2D — Expanded Personnel Records</p>
          <h1>Worker Profiles</h1>
          <span>
            Central employee identity, photographs,
            national identification, family,
            emergency contacts, employment,
            assignments, licences, private documents,
            employment letters, disciplinary records
            and company property.
          </span>
''','''          <p>People &amp; Payroll</p>
          <h1>Worker Profiles</h1>
          <span>
            Create each worker once, record the starting salary at onboarding,
            and let Payroll use that salary automatically every month.
            Personal, employment, document and company-property history stays
            together in the same worker record.
          </span>
''')
rep(p,'''        {canManage ? (
          <button
            type="button"
            onClick={() =>
              setCreateOpen((current) => !current)
            }
''','''        {canManage && canPayrollManage ? (
          <button
            type="button"
            onClick={() =>
              setCreateOpen((current) => !current)
            }
''')
rep(p,'''      {createOpen ? (
        <section className="expanded-worker-card">
''','''      {canManage && !canPayrollManage ? (
        <Notice type="warning">
          Worker onboarding now includes the worker's starting salary. Ask a System Administrator to grant Payroll Manage permission before creating a new worker.
        </Notice>
      ) : null}

      {createOpen ? (
        <section className="expanded-worker-card">
''')
rep(p,'''            <Notice type="info">
              Employee number, card serial, issue date and expiry date are generated automatically from Business & ID Settings.
            </Notice>
''','''            <Notice type="info">
              Create the worker and starting salary together. Employee number and ID-card dates are generated automatically; the salary becomes active in Payroll from the employment start date.
            </Notice>
''')
rep(p,'''                  value={createForm[key]}
                  onChange={(event) =>
                    setCreateForm((current) => ({
                      ...current,
                      [key]: event.target.value,
                    }))
                  }
                  required={key === "full_name"}
''','''                  value={createForm[key]}
                  onChange={(event) =>
                    setCreateForm((current) => ({
                      ...current,
                      [key]: event.target.value,
                    }))
                  }
                  required={["full_name", "employment_start_date"].includes(key)}
''')
rep(p,'''            <Field label="Employment type">
''','''            <Field label="Basic salary (GHS)">
              <input
                type="number"
                min="0.01"
                step="0.01"
                required
                value={createForm.basic_salary}
                onChange={(event) =>
                  setCreateForm((current) => ({
                    ...current,
                    basic_salary: event.target.value,
                  }))
                }
                placeholder="e.g. 3500.00"
              />
              <small>Payroll will use this salary automatically from the employment start date.</small>
            </Field>

            <Field label="Pay frequency">
              <select
                value={createForm.pay_frequency}
                onChange={(event) =>
                  setCreateForm((current) => ({
                    ...current,
                    pay_frequency: event.target.value,
                  }))
                }
              >
                <option value="monthly">Monthly</option>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Every two weeks</option>
              </select>
            </Field>

            <Field label="Employment type">
''')
rep(p,'''      setCreateForm(emptyCreateForm);
      setCreateOpen(false);
      setMessage(
''','''      setCreateForm(emptyCreateForm);
      setCreateOpen(false);
      setActiveTab("payroll");
      setMessage(
''')
rep(p,'''                : "Create Worker Profile"}
''','''                : "Create Worker & Activate Salary"}
''')
print('worker onboarding UI patched')
