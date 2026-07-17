import { useCallback, useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import { useWorkspaceContext } from "../context/WorkspaceContext";
import "../styles/miningControlCentre.css";

const TABS = [
  ["dashboard", "Command Desk", "📊", ["mining.stockpiles.view", "mining.dispatch.view", "mining.fuel_control.view", "mining.workforce.view", "mining.closing.view"]],
  ["stockpiles", "Stockpiles", "🪨", ["mining.stockpiles.view"]],
  ["dispatch", "Dispatch & Haulage", "🚛", ["mining.dispatch.view"]],
  ["fuel", "Fuel Control", "⛽", ["mining.fuel_control.view"]],
  ["workforce", "Shift Workforce", "👷", ["mining.workforce.view"]],
  ["closing", "Site Closing", "✅", ["mining.closing.view"]],
];

function localDate(offsetDays = 0) {
  const date = new Date(Date.now() + offsetDays * 86400000);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10);
}

function localDateTime() {
  const date = new Date();
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 16);
}

function number(value, digits = 2) {
  const parsed = Number(value || 0);
  return new Intl.NumberFormat("en-GH", { maximumFractionDigits: digits }).format(parsed);
}

function money(value) {
  return `GHS ${number(value, 2)}`;
}

function dateText(value) {
  if (!value) return "—";
  const date = new Date(String(value).length <= 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("en-GH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(String(value).length > 10 ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

function label(value) {
  return String(value || "—").replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function apiMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

function Status({ value, warning = false }) {
  const tone = warning ? "warning" : String(value || "neutral").toLowerCase();
  return <span className={`mcc-status mcc-status--${tone}`}>{label(value)}</span>;
}

function Empty({ title, text }) {
  return <div className="mcc-empty"><span>📭</span><strong>{title}</strong><p>{text}</p></div>;
}

function Field({ label: fieldLabel, children, wide = false }) {
  return <label className={wide ? "mcc-field mcc-field--wide" : "mcc-field"}><span>{fieldLabel}</span>{children}</label>;
}

function FormPanel({ title, description, onClose, children }) {
  return (
    <section className="mcc-form-panel">
      <div className="mcc-form-head">
        <div><small>Controlled operational entry</small><h3>{title}</h3><p>{description}</p></div>
        <button type="button" onClick={onClose} aria-label="Close form">×</button>
      </div>
      {children}
    </section>
  );
}

function Submit({ saving, text = "Save Record" }) {
  return <div className="mcc-form-actions"><button className="mcc-button mcc-button--primary" disabled={saving}>{saving ? "Saving…" : text}</button></div>;
}

const stockpileInitial = {
  stockpile_code: "",
  stockpile_name: "",
  material_type: "",
  grade_quality: "",
  unit: "tonnes",
  physical_location: "",
  capacity_quantity: "",
  minimum_quantity: "0",
  opening_quantity: "0",
  opening_reference: "",
  notes: "",
};

const movementInitial = {
  movement_type: "production",
  stockpile_id: "",
  destination_stockpile_id: "",
  production_record_id: "",
  quantity: "",
  movement_datetime: localDateTime(),
  external_reference: "",
  evidence_reference: "",
  explanation: "",
};

const dispatchInitial = {
  stockpile_id: "",
  dispatch_datetime: localDateTime(),
  quantity: "",
  customer_name: "",
  destination: "",
  receiver_name: "",
  receiver_phone: "",
  haulage_company: "",
  vehicle_registration: "",
  driver_name: "",
  driver_phone: "",
  weighbridge_ticket: "",
  gross_weight: "",
  tare_weight: "",
  net_weight: "",
  evidence_reference: "",
  notes: "",
};

const tankInitial = {
  tank_code: "",
  tank_name: "",
  fuel_type: "diesel",
  physical_location: "",
  capacity_litres: "",
  minimum_level_litres: "0",
  opening_balance_litres: "0",
  opening_reference: "",
  notes: "",
};

const fuelTransactionInitial = {
  tank_id: "",
  destination_tank_id: "",
  asset_id: "",
  transaction_type: "issue",
  transaction_datetime: localDateTime(),
  quantity_litres: "",
  unit_cost: "0",
  meter_reading: "",
  supplier_or_source: "",
  recipient_name: "",
  reference_number: "",
  evidence_reference: "",
  notes: "",
};

const reconciliationInitial = {
  tank_id: "",
  reconciliation_datetime: localDateTime(),
  physical_balance_litres: "",
  dip_reference: "",
  evidence_reference: "",
  explanation: "",
};

const contractorInitial = {
  contractor_code: "",
  contractor_name: "",
  registration_number: "",
  service_type: "",
  contact_person: "",
  phone: "",
  email: "",
  address: "",
  agreement_reference: "",
  notes: "",
};

const crewInitial = {
  shift_date: localDate(),
  shift_code: "day",
  supervisor_worker_id: "",
  contractor_id: "",
  work_area: "",
  planned_headcount: "0",
  ppe_confirmed: false,
  licence_confirmed: false,
  toolbox_talk_confirmed: false,
  attendance_confirmed: false,
  notes: "",
  member_ids: [],
};

const closingInitial = {
  closing_type: "daily",
  period_start: localDate(),
  period_end: localDate(),
  production_complete: false,
  stockpile_reconciled: false,
  fuel_reconciled: false,
  equipment_logs_complete: false,
  workforce_confirmed: false,
  expenses_recorded: false,
  incidents_reviewed: false,
  corrective_actions_reviewed: false,
  management_notes: "",
  exceptions_notes: "",
};

export default function MiningControlCentrePage() {
  const { hasPermission, hasAnyPermission } = useAuth();
  const { selectedContextId, options, loading: contextLoading } = useWorkspaceContext();
  const selectedSite = options.find((option) => Number(option.id) === Number(selectedContextId));
  const visibleTabs = useMemo(() => TABS.filter(([, , , permissions]) => hasAnyPermission(permissions)), [hasAnyPermission]);
  const [tab, setTab] = useState("dashboard");
  const [period, setPeriod] = useState({ from: localDate(-29), to: localDate() });
  const [data, setData] = useState({
    dashboard: {},
    reference: { stockpiles: [], tanks: [], contractors: [], workers: [], assets: [] },
    stockpiles: [], movements: [], dispatches: [], tanks: [], fuelTransactions: [], reconciliations: [], consumption: [], contractors: [], crews: [], warnings: [], closings: [], intelligence: {},
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [formType, setFormType] = useState("");
  const [stockpileForm, setStockpileForm] = useState(stockpileInitial);
  const [movementForm, setMovementForm] = useState(movementInitial);
  const [dispatchForm, setDispatchForm] = useState(dispatchInitial);
  const [tankForm, setTankForm] = useState(tankInitial);
  const [fuelForm, setFuelForm] = useState(fuelTransactionInitial);
  const [reconciliationForm, setReconciliationForm] = useState(reconciliationInitial);
  const [contractorForm, setContractorForm] = useState(contractorInitial);
  const [crewForm, setCrewForm] = useState(crewInitial);
  const [closingForm, setClosingForm] = useState(closingInitial);

  const load = useCallback(async () => {
    if (!selectedContextId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    const requests = [];
    const bind = (key, promise, selector = (response) => response.data) => requests.push(
      promise.then((response) => [key, selector(response)]).catch((requestError) => {
        if (requestError?.response?.status === 403) return [key, null];
        throw requestError;
      })
    );
    bind("dashboard", axiosClient.get("/mining-control/dashboard", { params: period }), (response) => response.data.summary || {});
    bind("reference", axiosClient.get("/mining-control/reference-data"), (response) => response.data);
    if (hasPermission("mining.stockpiles.view")) {
      bind("stockpiles", axiosClient.get("/mining-control/stockpiles"), (response) => response.data.stockpiles || []);
      bind("movements", axiosClient.get("/mining-control/stockpile-movements"), (response) => response.data.movements || []);
    }
    if (hasPermission("mining.dispatch.view")) bind("dispatches", axiosClient.get("/mining-control/dispatches"), (response) => response.data.dispatches || []);
    if (hasPermission("mining.fuel_control.view")) {
      bind("tanks", axiosClient.get("/mining-control/fuel-tanks"), (response) => response.data.tanks || []);
      bind("fuelTransactions", axiosClient.get("/mining-control/fuel-transactions"), (response) => response.data.transactions || []);
      bind("reconciliations", axiosClient.get("/mining-control/fuel-reconciliations"), (response) => response.data.reconciliations || []);
      bind("consumption", axiosClient.get("/mining-control/fuel-consumption", { params: period }), (response) => response.data.consumption || []);
    }
    if (hasPermission("mining.workforce.view")) {
      bind("contractors", axiosClient.get("/mining-control/contractors"), (response) => response.data.contractors || []);
      bind("crews", axiosClient.get("/mining-control/crews"), (response) => response.data.crews || []);
      bind("warnings", axiosClient.get("/mining-control/workforce-warnings"), (response) => response.data.warnings || []);
    }
    if (hasPermission("mining.closing.view")) {
      bind("closings", axiosClient.get("/mining-control/closings"), (response) => response.data.closings || []);
      bind("intelligence", axiosClient.get("/mining-control/intelligence", { params: period }), (response) => response.data.intelligence || {});
    }
    try {
      const results = await Promise.all(requests);
      setData((current) => {
        const next = { ...current };
        for (const [key, value] of results) if (value !== null) next[key] = value;
        return next;
      });
    } catch (requestError) {
      setError(apiMessage(requestError, "Could not load the Mining Control Centre."));
    } finally {
      setLoading(false);
    }
  }, [selectedContextId, period, hasPermission]);

  useEffect(() => { load(); }, [load]);

  function notice(message) {
    setSuccess(message);
    setError("");
    window.setTimeout(() => setSuccess(""), 5000);
  }

  async function post(event, endpoint, payload, reset) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await axiosClient.post(endpoint, payload);
      notice(response.data.message || "Record saved successfully.");
      reset();
      setFormType("");
      await load();
    } catch (requestError) {
      setError(apiMessage(requestError, "Could not save the record."));
    } finally {
      setSaving(false);
    }
  }

  async function approve(endpoint, confirmation) {
    if (!window.confirm(confirmation)) return;
    setSaving(true);
    setError("");
    try {
      const response = await axiosClient.patch(endpoint);
      notice(response.data.message || "Record approved successfully.");
      await load();
    } catch (requestError) {
      setError(apiMessage(requestError, "Could not approve the record."));
    } finally {
      setSaving(false);
    }
  }

  async function cancelDispatch(record) {
    const reason = window.prompt(`Enter the cancellation reason for ${record.dispatch_number}:`);
    if (!reason) return;
    setSaving(true);
    try {
      const response = await axiosClient.patch(`/mining-control/dispatches/${record.id}/cancel`, { reason });
      notice(response.data.message);
      await load();
    } catch (requestError) {
      setError(apiMessage(requestError, "Could not cancel the dispatch."));
    } finally { setSaving(false); }
  }

  async function downloadDispatch(record) {
    try {
      const response = await axiosClient.get(`/mining-control/dispatches/${record.id}/pdf`, { responseType: "blob" });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${record.dispatch_number}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (requestError) {
      setError(apiMessage(requestError, "Could not download the dispatch note."));
    }
  }

  function toggleCrewMember(workerId) {
    setCrewForm((current) => ({
      ...current,
      member_ids: current.member_ids.includes(workerId)
        ? current.member_ids.filter((id) => id !== workerId)
        : [...current.member_ids, workerId],
    }));
  }

  if (contextLoading) return <div className="mcc-loading">Loading Mining site context…</div>;

  if (!selectedContextId) {
    return (
      <div className="mcc-page">
        <section className="mcc-context-required">
          <span>📍</span><h1>Choose a Mining Site</h1>
          <p>The Mining Control Centre is site-isolated. Select an administrator-created Mining site from the workspace header before continuing.</p>
        </section>
      </div>
    );
  }

  const summary = data.dashboard || {};
  const intelligence = data.intelligence || {};
  const reference = data.reference || {};

  return (
    <div className="mcc-page">
      <header className="mcc-hero">
        <div>
          <p>Release 3B · Operations Completion</p>
          <h1>Mining Control Centre</h1>
          <span>{selectedSite ? `${selectedSite.code || selectedSite.site_code || "SITE"} — ${selectedSite.name || selectedSite.site_name}` : "Selected Mining site"}</span>
        </div>
        <div className="mcc-period">
          <label><span>From</span><input type="date" value={period.from} onChange={(event) => setPeriod((current) => ({ ...current, from: event.target.value }))} /></label>
          <label><span>To</span><input type="date" value={period.to} onChange={(event) => setPeriod((current) => ({ ...current, to: event.target.value }))} /></label>
          <button type="button" onClick={load}>Refresh</button>
        </div>
      </header>

      {error ? <div className="mcc-alert mcc-alert--error">{error}</div> : null}
      {success ? <div className="mcc-alert mcc-alert--success">{success}</div> : null}

      <section className="mcc-summary-grid">
        <article><span>🪨</span><div><small>Stockpile Balance</small><strong>{number(summary.stockpile_quantity, 3)}</strong><p>{number(summary.stockpile_count, 0)} stockpiles · {number(summary.low_stockpiles, 0)} low</p></div></article>
        <article><span>🚛</span><div><small>Approved Dispatch</small><strong>{number(summary.dispatched_quantity, 3)}</strong><p>{number(summary.pending_dispatches, 0)} awaiting approval</p></div></article>
        <article><span>⛽</span><div><small>Fuel on Site</small><strong>{number(summary.fuel_balance_litres, 2)} L</strong><p>{number(summary.low_tanks, 0)} low-level tanks</p></div></article>
        <article><span>👷</span><div><small>Shift Headcount</small><strong>{number(summary.crew_headcount, 0)}</strong><p>{number(summary.pending_crews, 0)} crews awaiting approval</p></div></article>
        <article><span>📉</span><div><small>Cost per Unit</small><strong>{summary.cost_per_unit == null ? "—" : money(summary.cost_per_unit)}</strong><p>{number(summary.production_quantity, 3)} produced</p></div></article>
        <article className={Number(summary.serious_incidents || 0) > 0 ? "mcc-summary-danger" : ""}><span>🛡️</span><div><small>Open Incidents</small><strong>{number(summary.open_incidents, 0)}</strong><p>{number(summary.serious_incidents, 0)} high / critical</p></div></article>
      </section>

      <nav className="mcc-tabs">
        {visibleTabs.map(([code, title, icon]) => <button key={code} type="button" className={tab === code ? "active" : ""} onClick={() => { setTab(code); setFormType(""); }}><span>{icon}</span>{title}</button>)}
      </nav>

      {loading ? <div className="mcc-loading">Loading controlled Mining records…</div> : null}

      {!loading && tab === "dashboard" ? <DashboardTab summary={summary} intelligence={intelligence} warnings={data.warnings} consumption={data.consumption} /> : null}
      {!loading && tab === "stockpiles" ? (
        <StockpilesTab
          stockpiles={data.stockpiles}
          movements={data.movements}
          formType={formType}
          setFormType={setFormType}
          canManage={hasPermission("mining.stockpiles.manage")}
          saving={saving}
          stockpileForm={stockpileForm}
          setStockpileForm={setStockpileForm}
          movementForm={movementForm}
          setMovementForm={setMovementForm}
          onStockpile={(event) => post(event, "/mining-control/stockpiles", stockpileForm, () => setStockpileForm(stockpileInitial))}
          onMovement={(event) => post(event, "/mining-control/stockpile-movements", movementForm, () => setMovementForm({ ...movementInitial, movement_datetime: localDateTime() }))}
        />
      ) : null}
      {!loading && tab === "dispatch" ? (
        <DispatchTab
          records={data.dispatches}
          stockpiles={reference.stockpiles || data.stockpiles}
          formType={formType}
          setFormType={setFormType}
          canManage={hasPermission("mining.dispatch.manage")}
          canApprove={hasPermission("mining.dispatch.approve")}
          saving={saving}
          form={dispatchForm}
          setForm={setDispatchForm}
          onSubmit={(event) => post(event, "/mining-control/dispatches", dispatchForm, () => setDispatchForm({ ...dispatchInitial, dispatch_datetime: localDateTime() }))}
          onApprove={(record) => approve(`/mining-control/dispatches/${record.id}/approve`, `Approve dispatch ${record.dispatch_number} and deduct ${record.quantity} ${record.unit} from the stockpile?`)}
          onCancel={cancelDispatch}
          onDownload={downloadDispatch}
        />
      ) : null}
      {!loading && tab === "fuel" ? (
        <FuelTab
          tanks={data.tanks}
          transactions={data.fuelTransactions}
          reconciliations={data.reconciliations}
          consumption={data.consumption}
          assets={reference.assets || []}
          formType={formType}
          setFormType={setFormType}
          canManage={hasPermission("mining.fuel_control.manage")}
          canApprove={hasPermission("mining.fuel_control.approve")}
          saving={saving}
          tankForm={tankForm}
          setTankForm={setTankForm}
          fuelForm={fuelForm}
          setFuelForm={setFuelForm}
          reconciliationForm={reconciliationForm}
          setReconciliationForm={setReconciliationForm}
          onTank={(event) => post(event, "/mining-control/fuel-tanks", tankForm, () => setTankForm(tankInitial))}
          onTransaction={(event) => post(event, "/mining-control/fuel-transactions", fuelForm, () => setFuelForm({ ...fuelTransactionInitial, transaction_datetime: localDateTime() }))}
          onReconciliation={(event) => post(event, "/mining-control/fuel-reconciliations", reconciliationForm, () => setReconciliationForm({ ...reconciliationInitial, reconciliation_datetime: localDateTime() }))}
          onApprove={(record) => approve(`/mining-control/fuel-reconciliations/${record.id}/approve`, `Approve reconciliation ${record.reconciliation_number} and align the tank to ${record.physical_balance_litres} litres?`)}
        />
      ) : null}
      {!loading && tab === "workforce" ? (
        <WorkforceTab
          contractors={data.contractors}
          crews={data.crews}
          warnings={data.warnings}
          workers={reference.workers || []}
          formType={formType}
          setFormType={setFormType}
          canManage={hasPermission("mining.workforce.manage")}
          canApprove={hasPermission("mining.workforce.approve")}
          saving={saving}
          contractorForm={contractorForm}
          setContractorForm={setContractorForm}
          crewForm={crewForm}
          setCrewForm={setCrewForm}
          toggleCrewMember={toggleCrewMember}
          onContractor={(event) => post(event, "/mining-control/contractors", contractorForm, () => setContractorForm(contractorInitial))}
          onCrew={(event) => post(event, "/mining-control/crews", { ...crewForm, members: crewForm.member_ids.map((workerId) => ({ worker_id: workerId, attendance_status: "present", ppe_status: crewForm.ppe_confirmed ? "confirmed" : "pending", licence_status: crewForm.licence_confirmed ? "confirmed" : "pending" })) }, () => setCrewForm({ ...crewInitial, shift_date: localDate() }))}
          onApprove={(record) => approve(`/mining-control/crews/${record.id}/approve`, `Approve shift crew ${record.crew_number}?`)}
        />
      ) : null}
      {!loading && tab === "closing" ? (
        <ClosingTab
          records={data.closings}
          intelligence={intelligence}
          formType={formType}
          setFormType={setFormType}
          canManage={hasPermission("mining.closing.manage")}
          canApprove={hasPermission("mining.closing.approve")}
          saving={saving}
          form={closingForm}
          setForm={setClosingForm}
          onSubmit={(event) => post(event, "/mining-control/closings", closingForm, () => setClosingForm({ ...closingInitial, period_start: localDate(), period_end: localDate() }))}
          onApprove={(record) => approve(`/mining-control/closings/${record.id}/approve`, `Approve site closing ${record.closing_number}?`)}
        />
      ) : null}
    </div>
  );
}

function DashboardTab({ intelligence, warnings, consumption }) {
  return (
    <div className="mcc-dashboard-grid">
      <section className="mcc-panel mcc-panel--wide">
        <header><div><small>Management intelligence</small><h2>Site Period Performance</h2></div></header>
        <div className="mcc-intelligence-grid">
          <article><span>Production</span><strong>{number(intelligence.production_quantity, 3)}</strong></article>
          <article><span>Operating cost</span><strong>{money(intelligence.operating_cost)}</strong></article>
          <article><span>Fuel per unit</span><strong>{intelligence.fuel_per_production_unit == null ? "—" : `${number(intelligence.fuel_per_production_unit, 3)} L`}</strong></article>
          <article><span>Utilization</span><strong>{intelligence.equipment_utilization_percent == null ? "—" : `${number(intelligence.equipment_utilization_percent, 2)}%`}</strong></article>
          <article><span>Breakdown hours</span><strong>{number(intelligence.breakdown_hours, 2)}</strong></article>
          <article><span>Corrective actions</span><strong>{number(intelligence.open_corrective_actions, 0)}</strong></article>
        </div>
      </section>
      <section className="mcc-panel">
        <header><div><small>Compliance</small><h2>Licence Warnings</h2></div></header>
        {warnings.length ? <div className="mcc-list">{warnings.slice(0, 8).map((item) => <article key={`${item.worker_id}-${item.license_type}`}><div><strong>{item.full_name}</strong><Status value={item.warning_type} warning /></div><p>{item.license_type}</p><small>Expires {dateText(item.expiry_date)}</small></article>)}</div> : <Empty title="No expiry warnings" text="No assigned worker licence expires within 60 days." />}
      </section>
      <section className="mcc-panel">
        <header><div><small>Fuel intelligence</small><h2>Equipment Consumption</h2></div></header>
        {consumption.length ? <div className="mcc-list">{consumption.slice(0, 8).map((item) => <article key={item.asset_id}><div><strong>{item.asset_code}</strong>{item.abnormal ? <Status value="abnormal" warning /> : null}</div><p>{item.asset_name}</p><small>{item.litres_per_hour == null ? "No comparable hours" : `${number(item.litres_per_hour, 3)} L/hour`}</small></article>)}</div> : <Empty title="No fuel comparison" text="Post equipment fuel issues and working-hour logs to calculate consumption." />}
      </section>
    </div>
  );
}

function StockpilesTab({ stockpiles, movements, formType, setFormType, canManage, saving, stockpileForm, setStockpileForm, movementForm, setMovementForm, onStockpile, onMovement }) {
  const change = (setter, field) => (event) => setter((current) => ({ ...current, [field]: event.target.value }));
  return <section className="mcc-section">
    <div className="mcc-section-head"><div><small>Material control</small><h2>Stockpiles and Movement Ledger</h2><p>Opening balances, production additions, controlled transfers and adjustments.</p></div>{canManage ? <div><button className="mcc-button" onClick={() => setFormType("stockpile")}>＋ Stockpile</button><button className="mcc-button mcc-button--primary" onClick={() => setFormType("movement")}>＋ Movement</button></div> : null}</div>
    {formType === "stockpile" ? <FormPanel title="Register Stockpile" description="Creates a site-isolated stockpile and opening ledger entry." onClose={() => setFormType("")}><form className="mcc-form" onSubmit={onStockpile}>
      <div className="mcc-form-grid"><Field label="Stockpile code *"><input value={stockpileForm.stockpile_code} onChange={change(setStockpileForm, "stockpile_code")} required /></Field><Field label="Stockpile name *"><input value={stockpileForm.stockpile_name} onChange={change(setStockpileForm, "stockpile_name")} required /></Field><Field label="Material"><input value={stockpileForm.material_type} onChange={change(setStockpileForm, "material_type")} /></Field><Field label="Grade / quality"><input value={stockpileForm.grade_quality} onChange={change(setStockpileForm, "grade_quality")} /></Field><Field label="Unit *"><input value={stockpileForm.unit} onChange={change(setStockpileForm, "unit")} required /></Field><Field label="Physical location"><input value={stockpileForm.physical_location} onChange={change(setStockpileForm, "physical_location")} /></Field><Field label="Capacity"><input type="number" min="0.001" step="0.001" value={stockpileForm.capacity_quantity} onChange={change(setStockpileForm, "capacity_quantity")} /></Field><Field label="Minimum level"><input type="number" min="0" step="0.001" value={stockpileForm.minimum_quantity} onChange={change(setStockpileForm, "minimum_quantity")} /></Field><Field label="Opening quantity"><input type="number" min="0" step="0.001" value={stockpileForm.opening_quantity} onChange={change(setStockpileForm, "opening_quantity")} /></Field><Field label="Opening reference"><input value={stockpileForm.opening_reference} onChange={change(setStockpileForm, "opening_reference")} /></Field><Field label="Notes" wide><textarea rows="3" value={stockpileForm.notes} onChange={change(setStockpileForm, "notes")} /></Field></div><Submit saving={saving} text="Create Stockpile" /></form></FormPanel> : null}
    {formType === "movement" ? <FormPanel title="Post Stockpile Movement" description="Balance validation and capacity checks run automatically." onClose={() => setFormType("")}><form className="mcc-form" onSubmit={onMovement}><div className="mcc-form-grid"><Field label="Movement type *"><select value={movementForm.movement_type} onChange={change(setMovementForm, "movement_type")}><option value="production">Production addition</option><option value="transfer">Transfer</option><option value="adjustment_in">Adjustment in</option><option value="adjustment_out">Adjustment out</option></select></Field><Field label="Stockpile *"><select value={movementForm.stockpile_id} onChange={change(setMovementForm, "stockpile_id")} required><option value="">Choose stockpile</option>{stockpiles.filter((item) => item.status === "active").map((item) => <option key={item.id} value={item.id}>{item.stockpile_code} — {number(item.current_quantity, 3)} {item.unit}</option>)}</select></Field>{movementForm.movement_type === "transfer" ? <Field label="Destination stockpile *"><select value={movementForm.destination_stockpile_id} onChange={change(setMovementForm, "destination_stockpile_id")} required><option value="">Choose destination</option>{stockpiles.filter((item) => String(item.id) !== String(movementForm.stockpile_id)).map((item) => <option key={item.id} value={item.id}>{item.stockpile_code} — {item.stockpile_name}</option>)}</select></Field> : null}<Field label="Production record ID"><input type="number" min="1" value={movementForm.production_record_id} onChange={change(setMovementForm, "production_record_id")} /></Field><Field label="Quantity *"><input type="number" min="0.001" step="0.001" value={movementForm.quantity} onChange={change(setMovementForm, "quantity")} required /></Field><Field label="Date and time *"><input type="datetime-local" value={movementForm.movement_datetime} onChange={change(setMovementForm, "movement_datetime")} required /></Field><Field label="External reference"><input value={movementForm.external_reference} onChange={change(setMovementForm, "external_reference")} /></Field><Field label="Evidence reference"><input value={movementForm.evidence_reference} onChange={change(setMovementForm, "evidence_reference")} /></Field><Field label="Explanation" wide><textarea rows="3" value={movementForm.explanation} onChange={change(setMovementForm, "explanation")} /></Field></div><Submit saving={saving} text="Post Movement" /></form></FormPanel> : null}
    <div className="mcc-card-grid">{stockpiles.map((item) => <article className={item.is_low ? "mcc-balance-card mcc-balance-card--warning" : "mcc-balance-card"} key={item.id}><div><span>{item.stockpile_code}</span><Status value={item.is_low ? "low" : item.status} warning={item.is_low} /></div><h3>{item.stockpile_name}</h3><strong>{number(item.current_quantity, 3)} {item.unit}</strong><p>{item.material_type || "Material not classified"} · Minimum {number(item.minimum_quantity, 3)}</p></article>)}</div>
    <Table title="Movement Ledger" rows={movements} columns={[['movement_number','Movement'],['movement_datetime','Date',dateText],['stockpile_code','Stockpile'],['movement_type','Type',label],['direction','Direction',label],['quantity','Quantity',(value,row)=>`${number(value,3)} ${row.unit}`],['balance_after','Balance',(value,row)=>`${number(value,3)} ${row.unit}`],['created_by_name','Recorded By']]} />
  </section>;
}

function DispatchTab({ records, stockpiles, formType, setFormType, canManage, canApprove, saving, form, setForm, onSubmit, onApprove, onCancel, onDownload }) {
  const change = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  return <section className="mcc-section"><div className="mcc-section-head"><div><small>Controlled material release</small><h2>Dispatch, Haulage and Receiver Evidence</h2><p>Submitted dispatches require independent approval before stock is deducted.</p></div>{canManage ? <button className="mcc-button mcc-button--primary" onClick={() => setFormType("dispatch")}>＋ New Dispatch</button> : null}</div>
    {formType === "dispatch" ? <FormPanel title="Submit Material Dispatch" description="Available stock is checked again when an independent approver accepts the dispatch." onClose={() => setFormType("")}><form className="mcc-form" onSubmit={onSubmit}><div className="mcc-form-grid"><Field label="Stockpile *"><select value={form.stockpile_id} onChange={change("stockpile_id")} required><option value="">Choose stockpile</option>{stockpiles.map((item) => <option key={item.id} value={item.id}>{item.stockpile_code} — {number(item.current_quantity,3)} {item.unit}</option>)}</select></Field><Field label="Dispatch date and time *"><input type="datetime-local" value={form.dispatch_datetime} onChange={change("dispatch_datetime")} required /></Field><Field label="Quantity *"><input type="number" min="0.001" step="0.001" value={form.quantity} onChange={change("quantity")} required /></Field><Field label="Customer"><input value={form.customer_name} onChange={change("customer_name")} /></Field><Field label="Destination *"><input value={form.destination} onChange={change("destination")} required /></Field><Field label="Receiver"><input value={form.receiver_name} onChange={change("receiver_name")} /></Field><Field label="Receiver phone"><input value={form.receiver_phone} onChange={change("receiver_phone")} /></Field><Field label="Haulage company"><input value={form.haulage_company} onChange={change("haulage_company")} /></Field><Field label="Vehicle registration"><input value={form.vehicle_registration} onChange={change("vehicle_registration")} /></Field><Field label="Driver"><input value={form.driver_name} onChange={change("driver_name")} /></Field><Field label="Driver phone"><input value={form.driver_phone} onChange={change("driver_phone")} /></Field><Field label="Weighbridge ticket"><input value={form.weighbridge_ticket} onChange={change("weighbridge_ticket")} /></Field><Field label="Gross weight"><input type="number" min="0" step="0.001" value={form.gross_weight} onChange={change("gross_weight")} /></Field><Field label="Tare weight"><input type="number" min="0" step="0.001" value={form.tare_weight} onChange={change("tare_weight")} /></Field><Field label="Net weight"><input type="number" min="0" step="0.001" value={form.net_weight} onChange={change("net_weight")} /></Field><Field label="Evidence reference"><input value={form.evidence_reference} onChange={change("evidence_reference")} /></Field><Field label="Notes" wide><textarea rows="3" value={form.notes} onChange={change("notes")} /></Field></div><Submit saving={saving} text="Submit Dispatch" /></form></FormPanel> : null}
    {records.length ? <div className="mcc-record-grid">{records.map((record) => <article key={record.id} className="mcc-record-card"><div className="mcc-record-head"><div><small>{record.dispatch_number}</small><h3>{record.stockpile_code} → {record.destination}</h3></div><Status value={record.status} /></div><div className="mcc-facts"><span><b>Quantity</b>{number(record.quantity,3)} {record.unit}</span><span><b>Vehicle</b>{record.vehicle_registration || "—"}</span><span><b>Driver</b>{record.driver_name || "—"}</span><span><b>Receiver</b>{record.receiver_name || "—"}</span><span><b>Date</b>{dateText(record.dispatch_datetime)}</span><span><b>Ticket</b>{record.weighbridge_ticket || "—"}</span></div><div className="mcc-card-actions"><button onClick={() => onDownload(record)}>Download PDF</button>{canApprove && record.status === "submitted" ? <button className="approve" disabled={saving} onClick={() => onApprove(record)}>Approve</button> : null}{canManage && record.status === "submitted" ? <button className="danger" disabled={saving} onClick={() => onCancel(record)}>Cancel</button> : null}</div></article>)}</div> : <Empty title="No dispatches" text="Submitted and approved material dispatches will appear here." />}
  </section>;
}

function FuelTab({ tanks, transactions, reconciliations, consumption, assets, formType, setFormType, canManage, canApprove, saving, tankForm, setTankForm, fuelForm, setFuelForm, reconciliationForm, setReconciliationForm, onTank, onTransaction, onReconciliation, onApprove }) {
  const change = (setter, field) => (event) => setter((current) => ({ ...current, [field]: event.target.value }));
  return <section className="mcc-section"><div className="mcc-section-head"><div><small>Fuel custody and variance</small><h2>Fuel Tanks, Issues and Physical Reconciliation</h2><p>Every posted transaction changes a locked tank balance and remains in the ledger.</p></div>{canManage ? <div><button className="mcc-button" onClick={() => setFormType("tank")}>＋ Tank</button><button className="mcc-button" onClick={() => setFormType("fuel")}>＋ Transaction</button><button className="mcc-button mcc-button--primary" onClick={() => setFormType("reconciliation")}>＋ Physical Dip</button></div> : null}</div>
    {formType === "tank" ? <FormPanel title="Register Fuel Tank" description="Opening fuel creates the first immutable transaction." onClose={() => setFormType("")}><form className="mcc-form" onSubmit={onTank}><div className="mcc-form-grid"><Field label="Tank code *"><input value={tankForm.tank_code} onChange={change(setTankForm,"tank_code")} required /></Field><Field label="Tank name *"><input value={tankForm.tank_name} onChange={change(setTankForm,"tank_name")} required /></Field><Field label="Fuel type"><input value={tankForm.fuel_type} onChange={change(setTankForm,"fuel_type")} /></Field><Field label="Location"><input value={tankForm.physical_location} onChange={change(setTankForm,"physical_location")} /></Field><Field label="Capacity litres *"><input type="number" min="0.01" step="0.01" value={tankForm.capacity_litres} onChange={change(setTankForm,"capacity_litres")} required /></Field><Field label="Minimum level"><input type="number" min="0" step="0.01" value={tankForm.minimum_level_litres} onChange={change(setTankForm,"minimum_level_litres")} /></Field><Field label="Opening balance"><input type="number" min="0" step="0.01" value={tankForm.opening_balance_litres} onChange={change(setTankForm,"opening_balance_litres")} /></Field><Field label="Opening reference"><input value={tankForm.opening_reference} onChange={change(setTankForm,"opening_reference")} /></Field><Field label="Notes" wide><textarea rows="3" value={tankForm.notes} onChange={change(setTankForm,"notes")} /></Field></div><Submit saving={saving} text="Create Fuel Tank" /></form></FormPanel> : null}
    {formType === "fuel" ? <FormPanel title="Post Fuel Transaction" description="Receipts, issues, transfers and controlled adjustments update tank custody." onClose={() => setFormType("")}><form className="mcc-form" onSubmit={onTransaction}><div className="mcc-form-grid"><Field label="Transaction type *"><select value={fuelForm.transaction_type} onChange={change(setFuelForm,"transaction_type")}><option value="issue">Issue to equipment / recipient</option><option value="receipt">Receipt into tank</option><option value="transfer">Tank transfer</option><option value="adjustment_in">Adjustment in</option><option value="adjustment_out">Adjustment out</option></select></Field><Field label="Fuel tank *"><select value={fuelForm.tank_id} onChange={change(setFuelForm,"tank_id")} required><option value="">Choose tank</option>{tanks.map((item) => <option key={item.id} value={item.id}>{item.tank_code} — {number(item.current_balance_litres)} L</option>)}</select></Field>{fuelForm.transaction_type === "transfer" ? <Field label="Destination tank *"><select value={fuelForm.destination_tank_id} onChange={change(setFuelForm,"destination_tank_id")} required><option value="">Choose destination</option>{tanks.filter((item) => String(item.id)!==String(fuelForm.tank_id)).map((item) => <option key={item.id} value={item.id}>{item.tank_code} — {item.tank_name}</option>)}</select></Field> : null}<Field label="Equipment"><select value={fuelForm.asset_id} onChange={change(setFuelForm,"asset_id")}><option value="">No equipment</option>{assets.map((item) => <option key={item.id} value={item.id}>{item.asset_code} — {item.asset_name}</option>)}</select></Field><Field label="Date and time *"><input type="datetime-local" value={fuelForm.transaction_datetime} onChange={change(setFuelForm,"transaction_datetime")} required /></Field><Field label="Quantity litres *"><input type="number" min="0.01" step="0.01" value={fuelForm.quantity_litres} onChange={change(setFuelForm,"quantity_litres")} required /></Field><Field label="Unit cost"><input type="number" min="0" step="0.01" value={fuelForm.unit_cost} onChange={change(setFuelForm,"unit_cost")} /></Field><Field label="Meter reading"><input type="number" min="0" step="0.01" value={fuelForm.meter_reading} onChange={change(setFuelForm,"meter_reading")} /></Field><Field label="Supplier / source"><input value={fuelForm.supplier_or_source} onChange={change(setFuelForm,"supplier_or_source")} /></Field><Field label="Recipient"><input value={fuelForm.recipient_name} onChange={change(setFuelForm,"recipient_name")} /></Field><Field label="Reference number"><input value={fuelForm.reference_number} onChange={change(setFuelForm,"reference_number")} /></Field><Field label="Evidence reference"><input value={fuelForm.evidence_reference} onChange={change(setFuelForm,"evidence_reference")} /></Field><Field label="Notes" wide><textarea rows="3" value={fuelForm.notes} onChange={change(setFuelForm,"notes")} /></Field></div><Submit saving={saving} text="Post Fuel Transaction" /></form></FormPanel> : null}
    {formType === "reconciliation" ? <FormPanel title="Submit Physical Fuel Count" description="Variance is recorded now; an independent approver decides whether to align the system balance." onClose={() => setFormType("")}><form className="mcc-form" onSubmit={onReconciliation}><div className="mcc-form-grid"><Field label="Fuel tank *"><select value={reconciliationForm.tank_id} onChange={change(setReconciliationForm,"tank_id")} required><option value="">Choose tank</option>{tanks.map((item) => <option key={item.id} value={item.id}>{item.tank_code} — expected {number(item.current_balance_litres)} L</option>)}</select></Field><Field label="Dip date and time *"><input type="datetime-local" value={reconciliationForm.reconciliation_datetime} onChange={change(setReconciliationForm,"reconciliation_datetime")} required /></Field><Field label="Physical balance litres *"><input type="number" min="0" step="0.01" value={reconciliationForm.physical_balance_litres} onChange={change(setReconciliationForm,"physical_balance_litres")} required /></Field><Field label="Dip reference"><input value={reconciliationForm.dip_reference} onChange={change(setReconciliationForm,"dip_reference")} /></Field><Field label="Evidence reference"><input value={reconciliationForm.evidence_reference} onChange={change(setReconciliationForm,"evidence_reference")} /></Field><Field label="Variance explanation" wide><textarea rows="3" value={reconciliationForm.explanation} onChange={change(setReconciliationForm,"explanation")} /></Field></div><Submit saving={saving} text="Submit Reconciliation" /></form></FormPanel> : null}
    <div className="mcc-card-grid">{tanks.map((item) => <article className={item.is_low ? "mcc-balance-card mcc-balance-card--warning" : "mcc-balance-card"} key={item.id}><div><span>{item.tank_code}</span><Status value={item.is_low ? "low" : item.status} warning={item.is_low} /></div><h3>{item.tank_name}</h3><strong>{number(item.current_balance_litres)} L</strong><p>Capacity {number(item.capacity_litres)} L · Minimum {number(item.minimum_level_litres)} L</p></article>)}</div>
    <div className="mcc-two-column"><Table title="Fuel Ledger" rows={transactions.slice(0,200)} columns={[['transaction_number','Transaction'],['transaction_datetime','Date',dateText],['tank_code','Tank'],['transaction_type','Type',label],['direction','Direction',label],['quantity_litres','Litres',number],['balance_after_litres','Balance',number],['asset_code','Asset']]} /><section className="mcc-panel"><header><div><small>Consumption</small><h2>Equipment L/hour</h2></div></header>{consumption.length ? <div className="mcc-list">{consumption.map((item) => <article key={item.asset_id}><div><strong>{item.asset_code}</strong>{item.abnormal ? <Status value="abnormal" warning /> : null}</div><p>{item.asset_name}</p><small>{item.litres_per_hour == null ? "No working hours" : `${number(item.litres_per_hour,3)} L/hour`}</small></article>)}</div> : <Empty title="No comparison" text="Fuel issues and equipment hours are required." />}</section></div>
    <Table title="Physical Reconciliations" rows={reconciliations} actions={(record) => canApprove && record.status === "submitted" ? <button className="mcc-inline-approve" disabled={saving} onClick={() => onApprove(record)}>Approve</button> : null} columns={[['reconciliation_number','Number'],['reconciliation_datetime','Date',dateText],['tank_code','Tank'],['expected_balance_litres','Expected',number],['physical_balance_litres','Physical',number],['variance_litres','Variance',number],['variance_percent','Variance %',(value)=>`${number(value,2)}%`],['status','Status',(value)=><Status value={value} />]]} />
  </section>;
}

function WorkforceTab({ contractors, crews, warnings, workers, formType, setFormType, canManage, canApprove, saving, contractorForm, setContractorForm, crewForm, setCrewForm, toggleCrewMember, onContractor, onCrew, onApprove }) {
  const change = (setter, field) => (event) => setter((current) => ({ ...current, [field]: event.target.type === "checkbox" ? event.target.checked : event.target.value }));
  return <section className="mcc-section"><div className="mcc-section-head"><div><small>Shift readiness</small><h2>Contractors, Crews and Compliance</h2><p>This is operational workforce control only. It does not calculate salary or performance scores.</p></div>{canManage ? <div><button className="mcc-button" onClick={() => setFormType("contractor")}>＋ Contractor</button><button className="mcc-button mcc-button--primary" onClick={() => setFormType("crew")}>＋ Shift Crew</button></div> : null}</div>
    {formType === "contractor" ? <FormPanel title="Register Site Contractor" description="Links contractor identity and agreement evidence to the selected Mining site." onClose={() => setFormType("")}><form className="mcc-form" onSubmit={onContractor}><div className="mcc-form-grid"><Field label="Contractor code *"><input value={contractorForm.contractor_code} onChange={change(setContractorForm,"contractor_code")} required /></Field><Field label="Contractor name *"><input value={contractorForm.contractor_name} onChange={change(setContractorForm,"contractor_name")} required /></Field><Field label="Registration number"><input value={contractorForm.registration_number} onChange={change(setContractorForm,"registration_number")} /></Field><Field label="Service type"><input value={contractorForm.service_type} onChange={change(setContractorForm,"service_type")} /></Field><Field label="Contact person"><input value={contractorForm.contact_person} onChange={change(setContractorForm,"contact_person")} /></Field><Field label="Phone"><input value={contractorForm.phone} onChange={change(setContractorForm,"phone")} /></Field><Field label="Email"><input type="email" value={contractorForm.email} onChange={change(setContractorForm,"email")} /></Field><Field label="Agreement reference"><input value={contractorForm.agreement_reference} onChange={change(setContractorForm,"agreement_reference")} /></Field><Field label="Address" wide><input value={contractorForm.address} onChange={change(setContractorForm,"address")} /></Field><Field label="Notes" wide><textarea rows="3" value={contractorForm.notes} onChange={change(setContractorForm,"notes")} /></Field></div><Submit saving={saving} text="Create Contractor" /></form></FormPanel> : null}
    {formType === "crew" ? <FormPanel title="Submit Shift Crew" description="Only workers actively assigned to this Mining site can be selected." onClose={() => setFormType("")}><form className="mcc-form" onSubmit={onCrew}><div className="mcc-form-grid"><Field label="Shift date *"><input type="date" value={crewForm.shift_date} onChange={change(setCrewForm,"shift_date")} required /></Field><Field label="Shift *"><select value={crewForm.shift_code} onChange={change(setCrewForm,"shift_code")}><option value="day">Day</option><option value="night">Night</option><option value="morning">Morning</option><option value="afternoon">Afternoon</option><option value="custom">Custom</option></select></Field><Field label="Supervisor"><select value={crewForm.supervisor_worker_id} onChange={change(setCrewForm,"supervisor_worker_id")}><option value="">Choose supervisor</option>{workers.map((item) => <option key={item.id} value={item.id}>{item.employee_number} — {item.full_name}</option>)}</select></Field><Field label="Contractor"><select value={crewForm.contractor_id} onChange={change(setCrewForm,"contractor_id")}><option value="">Direct workforce</option>{contractors.filter((item)=>item.status==='active').map((item) => <option key={item.id} value={item.id}>{item.contractor_code} — {item.contractor_name}</option>)}</select></Field><Field label="Work area"><input value={crewForm.work_area} onChange={change(setCrewForm,"work_area")} /></Field><Field label="Planned headcount"><input type="number" min="0" value={crewForm.planned_headcount} onChange={change(setCrewForm,"planned_headcount")} /></Field></div><div className="mcc-check-grid"><label><input type="checkbox" checked={crewForm.ppe_confirmed} onChange={change(setCrewForm,"ppe_confirmed")} /> PPE confirmed</label><label><input type="checkbox" checked={crewForm.licence_confirmed} onChange={change(setCrewForm,"licence_confirmed")} /> Licences checked</label><label><input type="checkbox" checked={crewForm.toolbox_talk_confirmed} onChange={change(setCrewForm,"toolbox_talk_confirmed")} /> Toolbox talk completed</label><label><input type="checkbox" checked={crewForm.attendance_confirmed} onChange={change(setCrewForm,"attendance_confirmed")} /> Attendance confirmed</label></div><div className="mcc-worker-picker"><h4>Assigned Workers ({crewForm.member_ids.length} selected)</h4>{workers.length ? workers.map((worker) => <label key={worker.id} className={crewForm.member_ids.includes(worker.id) ? "selected" : ""}><input type="checkbox" checked={crewForm.member_ids.includes(worker.id)} onChange={() => toggleCrewMember(worker.id)} /><span><strong>{worker.full_name}</strong><small>{worker.employee_number} · {worker.job_title || "Worker"}</small></span>{worker.nearest_license_expiry ? <em>Licence {dateText(worker.nearest_license_expiry)}</em> : null}</label>) : <Empty title="No assigned workers" text="Assign worker profiles to this Mining site in Workforce Centre first." />}</div><Field label="Shift notes" wide><textarea rows="3" value={crewForm.notes} onChange={change(setCrewForm,"notes")} /></Field><Submit saving={saving} text="Submit Shift Crew" /></form></FormPanel> : null}
    <div className="mcc-two-column"><section className="mcc-panel"><header><div><small>Third parties</small><h2>Site Contractors</h2></div></header>{contractors.length ? <div className="mcc-list">{contractors.map((item) => <article key={item.id}><div><strong>{item.contractor_code}</strong><Status value={item.status} /></div><p>{item.contractor_name}</p><small>{item.service_type || "Service not classified"} · {item.phone || "No phone"}</small></article>)}</div> : <Empty title="No contractors" text="Direct and third-party shift crews can be controlled here." />}</section><section className="mcc-panel"><header><div><small>Expiry control</small><h2>Licence Warnings</h2></div></header>{warnings.length ? <div className="mcc-list">{warnings.map((item) => <article key={`${item.worker_id}-${item.license_type}`}><div><strong>{item.full_name}</strong><Status value={item.warning_type} warning /></div><p>{item.license_type}</p><small>{dateText(item.expiry_date)}</small></article>)}</div> : <Empty title="No warnings" text="No assigned worker licence is expired or due within 60 days." />}</section></div>
    {crews.length ? <div className="mcc-record-grid">{crews.map((record) => <article key={record.id} className="mcc-record-card"><div className="mcc-record-head"><div><small>{record.crew_number}</small><h3>{label(record.shift_code)} Shift · {dateText(record.shift_date)}</h3></div><Status value={record.status} /></div><div className="mcc-facts"><span><b>Supervisor</b>{record.supervisor_name || "—"}</span><span><b>Work area</b>{record.work_area || "—"}</span><span><b>Headcount</b>{number(record.actual_headcount,0)}</span><span><b>PPE</b>{record.ppe_confirmed ? "Confirmed" : "Pending"}</span><span><b>Licences</b>{record.licence_confirmed ? "Confirmed" : "Pending"}</span><span><b>Contractor</b>{record.contractor_name || "Direct"}</span></div>{record.members?.length ? <details><summary>View crew members</summary><ul>{record.members.map((member) => <li key={member.id}>{member.full_name || member.external_worker_name} — {member.role_or_task || "Crew member"}</li>)}</ul></details> : null}{canApprove && record.status === "submitted" ? <div className="mcc-card-actions"><button className="approve" disabled={saving} onClick={() => onApprove(record)}>Approve Crew</button></div> : null}</article>)}</div> : <Empty title="No shift crews" text="Shift crew submissions and approvals will appear here." />}
  </section>;
}

function ClosingTab({ records, intelligence, formType, setFormType, canManage, canApprove, saving, form, setForm, onSubmit, onApprove }) {
  const change = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.type === "checkbox" ? event.target.checked : event.target.value }));
  const checklist = [["production_complete","Production records complete"],["stockpile_reconciled","Stockpile balances checked"],["fuel_reconciled","Fuel physically reconciled"],["equipment_logs_complete","Equipment logs complete"],["workforce_confirmed","Workforce and attendance confirmed"],["expenses_recorded","Expenses recorded"],["incidents_reviewed","Incidents reviewed"],["corrective_actions_reviewed","Corrective actions reviewed"]];
  return <section className="mcc-section"><div className="mcc-section-head"><div><small>Management close</small><h2>Daily and Site-Period Closing</h2><p>Supervisor submission and independent approval preserve unfinished-work warnings.</p></div>{canManage ? <button className="mcc-button mcc-button--primary" onClick={() => setFormType("closing")}>＋ New Site Close</button> : null}</div>
    {formType === "closing" ? <FormPanel title="Submit Site-Period Close" description="Unchecked items remain visible as operational exceptions for management." onClose={() => setFormType("")}><form className="mcc-form" onSubmit={onSubmit}><div className="mcc-form-grid"><Field label="Closing type *"><select value={form.closing_type} onChange={change("closing_type")}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="period">Custom period</option></select></Field><Field label="Period start *"><input type="date" value={form.period_start} onChange={change("period_start")} required /></Field><Field label="Period end *"><input type="date" value={form.period_end} onChange={change("period_end")} required /></Field></div><div className="mcc-closing-checklist">{checklist.map(([field,title]) => <label key={field} className={form[field] ? "checked" : ""}><input type="checkbox" checked={form[field]} onChange={change(field)} /><span>{form[field] ? "✓" : "!"}</span><strong>{title}</strong></label>)}</div><div className="mcc-form-grid"><Field label="Management notes" wide><textarea rows="3" value={form.management_notes} onChange={change("management_notes")} /></Field><Field label="Exceptions / unfinished work" wide><textarea rows="3" value={form.exceptions_notes} onChange={change("exceptions_notes")} /></Field></div><Submit saving={saving} text="Submit Site Closing" /></form></FormPanel> : null}
    <div className="mcc-intelligence-grid mcc-intelligence-grid--standalone"><article><span>Production</span><strong>{number(intelligence.production_quantity,3)}</strong></article><article><span>Cost / unit</span><strong>{intelligence.cost_per_production_unit == null ? "—" : money(intelligence.cost_per_production_unit)}</strong></article><article><span>Fuel / unit</span><strong>{intelligence.fuel_per_production_unit == null ? "—" : `${number(intelligence.fuel_per_production_unit,3)} L`}</strong></article><article><span>Utilization</span><strong>{intelligence.equipment_utilization_percent == null ? "—" : `${number(intelligence.equipment_utilization_percent,2)}%`}</strong></article><article><span>Dispatch</span><strong>{number(intelligence.dispatched_quantity,3)}</strong></article><article><span>Open actions</span><strong>{number(intelligence.open_corrective_actions,0)}</strong></article></div>
    {records.length ? <div className="mcc-record-grid">{records.map((record) => { const complete = [record.production_complete,record.stockpile_reconciled,record.fuel_reconciled,record.equipment_logs_complete,record.workforce_confirmed,record.expenses_recorded,record.incidents_reviewed,record.corrective_actions_reviewed].filter(Boolean).length; return <article key={record.id} className="mcc-record-card"><div className="mcc-record-head"><div><small>{record.closing_number}</small><h3>{label(record.closing_type)} · {dateText(record.period_start)} to {dateText(record.period_end)}</h3></div><Status value={record.status} /></div><div className="mcc-close-progress"><span style={{width:`${complete/8*100}%`}} /></div><p>{complete}/8 completion controls confirmed</p>{record.exceptions_notes ? <blockquote>{record.exceptions_notes}</blockquote> : null}{canApprove && record.status === "submitted" ? <div className="mcc-card-actions"><button className="approve" disabled={saving} onClick={() => onApprove(record)}>Approve Closing</button></div> : null}</article>; })}</div> : <Empty title="No site closings" text="Daily, weekly and management-period closings will appear here." />}
  </section>;
}

function Table({ title, rows, columns, actions }) {
  return <section className="mcc-table-panel"><header><h2>{title}</h2><span>{rows.length} record(s)</span></header>{rows.length ? <div className="mcc-table-wrap"><table><thead><tr>{columns.map(([, heading]) => <th key={heading}>{heading}</th>)}{actions ? <th>Actions</th> : null}</tr></thead><tbody>{rows.map((row, index) => <tr key={row.id || `${title}-${index}`}>{columns.map(([key, heading, formatter]) => <td key={`${heading}-${key}`}>{formatter ? formatter(row[key], row) : row[key] ?? "—"}</td>)}{actions ? <td>{actions(row)}</td> : null}</tr>)}</tbody></table></div> : <Empty title={`No ${title.toLowerCase()}`} text="Records will appear here after the first controlled entry." />}</section>;
}
