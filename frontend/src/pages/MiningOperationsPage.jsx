import { useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import { useWorkspaceContext } from "../context/WorkspaceContext";
import {
  MINING_ACTION_PERMISSIONS,
  canUseMiningAction,
} from "../security/permissionRules";
import "../styles/mining.css";

const TABS = [
  ["overview", "Overview", "📊"],
  ["sites", "Sites", "📍"],
  ["daily", "Daily Logs", "📋"],
  ["production", "Production", "⛏️"],
  ["equipment", "Equipment", "🚜"],
  ["fuel", "Fuel", "⛽"],
  ["expenses", "Expenses", "💳"],
  ["incidents", "Incidents", "🛡️"],
];

function localDate() {
  const date = new Date();
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10);
}

function localDateTime() {
  const date = new Date();
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 16);
}

function formatNumber(value, digits = 2) {
  const number = Number(value || 0);
  return new Intl.NumberFormat("en-GH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(number);
}

function formatMoney(value) {
  return `GHS ${formatNumber(value, 2)}`;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-GH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-GH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function label(value) {
  return String(value || "—")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function apiMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

function isOriginalSystemAdministrator(user) {
  return (
    Number(user?.id) === 1 &&
    String(user?.username || "").toLowerCase() === "admin" &&
    String(user?.role || "").toLowerCase() === "admin"
  );
}

function downloadCsv(filename, rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    window.alert("There are no visible records to export.");
    return;
  }

  const columns = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row || {}).forEach((key) => set.add(key));
      return set;
    }, new Set())
  );

  const escapeCell = (value) => {
    if (value === null || value === undefined) return "";
    const text = typeof value === "object" ? JSON.stringify(value) : String(value);
    return `"${text.replaceAll('"', '""')}"`;
  };

  const csv = [
    columns.map(escapeCell).join(","),
    ...rows.map((row) => columns.map((column) => escapeCell(row[column])).join(",")),
  ].join("\r\n");

  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function SiteSelect({ sites, value, onChange, required = false, includeAll = false }) {
  return (
    <select value={value} onChange={onChange} required={required}>
      <option value="">{includeAll ? "All mining sites" : "Choose mining site"}</option>
      {sites.map((site) => (
        <option key={site.id} value={site.id}>
          {site.site_code} — {site.site_name}
        </option>
      ))}
    </select>
  );
}

function StatusPill({ value, tone }) {
  const clean = String(tone || value || "neutral").toLowerCase();
  return <span className={`mining-pill mining-pill--${clean}`}>{label(value)}</span>;
}

function EmptyState({ icon = "📭", title, description }) {
  return (
    <div className="mining-empty">
      <span aria-hidden="true">{icon}</span>
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}

function SectionHeader({ eyebrow, title, description, action }) {
  return (
    <div className="mining-section-header">
      <div>
        {eyebrow ? <p>{eyebrow}</p> : null}
        <h2>{title}</h2>
        {description ? <span>{description}</span> : null}
      </div>
      {action}
    </div>
  );
}

const initialSiteForm = {
  id: null,
  site_code: "",
  site_name: "",
  location: "",
  material_type: "",
  production_unit: "tonnes",
  daily_target: "",
  manager_name: "",
  manager_phone: "",
  status: "active",
  notes: "",
  is_active: true,
};

const createDailyForm = () => ({
  site_id: "",
  log_date: localDate(),
  shift_code: "day",
  supervisor_name: "",
  weather_conditions: "",
  workforce_count: "0",
  opening_notes: "",
  closing_notes: "",
  status: "draft",
});

const createProductionForm = () => ({
  site_id: "",
  daily_log_id: "",
  production_datetime: localDateTime(),
  work_area: "",
  material_type: "",
  quantity: "",
  unit: "tonnes",
  grade_quality: "",
  destination: "",
  notes: "",
});

const createEquipmentForm = () => ({
  site_id: "",
  daily_log_id: "",
  asset_id: "",
  work_date: localDate(),
  shift_code: "day",
  operator_name: "",
  start_meter: "",
  end_meter: "",
  working_hours: "",
  idle_hours: "0",
  breakdown_hours: "0",
  fuel_litres: "0",
  task_description: "",
});

const createFuelForm = () => ({
  site_id: "",
  asset_id: "",
  log_datetime: localDateTime(),
  transaction_type: "issue",
  quantity_litres: "",
  storage_name: "",
  supplier_or_source: "",
  recipient_name: "",
  meter_reading: "",
  unit_cost: "0",
  total_cost: "",
  reference_number: "",
  notes: "",
});

const createExpenseForm = () => ({
  site_id: "",
  expense_date: localDate(),
  category: "Fuel",
  description: "",
  amount: "",
  payment_method: "cash",
  reference_number: "",
});

const createIncidentForm = () => ({
  site_id: "",
  incident_datetime: localDateTime(),
  incident_type: "Safety",
  severity: "low",
  exact_area: "",
  people_involved: "",
  description: "",
  immediate_action: "",
  corrective_action: "",
  responsible_officer: "",
});

export default function MiningOperationsPage({ section = "overview" }) {
  const { user: currentUser, effectivePermissions, hasAnyPermission } = useAuth();
  const {
    options: assignedSiteOptions,
    selectedContextId,
    automaticAccess,
    loading: contextLoading,
    selectContext,
  } = useWorkspaceContext();
  const miningMutationPermissions = Object.values(MINING_ACTION_PERMISSIONS)
    .flatMap((actions) => Object.values(actions))
    .filter(Boolean);
  const canEdit = hasAnyPermission(miningMutationPermissions);
  const canManageSites = canUseMiningAction(effectivePermissions, "sites", "edit");
  const canDeleteSites = isOriginalSystemAdministrator(currentUser);
  const requestedSection = TABS.some(([code]) => code === section)
    ? section
    : "overview";

  const [activeTab, setActiveTab] = useState(requestedSection);
  const [sites, setSites] = useState([]);
  const [assets, setAssets] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [records, setRecords] = useState([]);
  const [selectedSiteId, setSelectedSiteId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingSiteId, setDeletingSiteId] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [formOpen, setFormOpen] = useState(false);

  const [siteForm, setSiteForm] = useState(initialSiteForm);
  const [dailyForm, setDailyForm] = useState(createDailyForm);
  const [productionForm, setProductionForm] = useState(createProductionForm);
  const [equipmentForm, setEquipmentForm] = useState(createEquipmentForm);
  const [fuelForm, setFuelForm] = useState(createFuelForm);
  const [expenseForm, setExpenseForm] = useState(createExpenseForm);
  const [incidentForm, setIncidentForm] = useState(createIncidentForm);

  useEffect(() => {
    setActiveTab(requestedSection);
    setFormOpen(false);
    setError("");
  }, [requestedSection]);

  useEffect(() => {
    setSelectedSiteId(selectedContextId ? String(selectedContextId) : "");
  }, [selectedContextId]);

  const selectedSite = useMemo(
    () => sites.find((site) => Number(site.id) === Number(selectedSiteId)) || null,
    [sites, selectedSiteId]
  );

  const activeAssets = useMemo(
    () => assets.filter((asset) => Boolean(asset.is_active)),
    [assets]
  );

  const exportRows = activeTab === "sites" ? sites : records;
  const canCreateCurrent = canUseMiningAction(
    effectivePermissions,
    activeTab,
    "create"
  );
  const canApproveCurrent = canUseMiningAction(
    effectivePermissions,
    activeTab,
    "approve"
  );

  function setNotice(message) {
    setSuccess(message);
    setError("");
    window.setTimeout(() => setSuccess(""), 4500);
  }

  function defaultSiteValue() {
    return selectedSiteId || (sites.length === 1 ? String(sites[0].id) : "");
  }

  async function loadSitesAndAssets() {
    const [siteResponse, assetResponse] = await Promise.all([
      axiosClient.get("/mining/sites"),
      axiosClient.get("/fleet/assets"),
    ]);

    const loadedSites = siteResponse.data.sites || [];
    const assignedIds = new Set(
      assignedSiteOptions.map((option) => Number(option.id))
    );
    const visibleSites = automaticAccess
      ? loadedSites
      : loadedSites.filter((site) => assignedIds.has(Number(site.id)));

    setSites(visibleSites);
    setAssets(assetResponse.data.assets || []);
  }

  async function loadDashboard() {
    const response = await axiosClient.get("/mining/dashboard", {
      params: selectedSiteId ? { site_id: selectedSiteId } : {},
    });
    setDashboard(response.data);
  }

  function recordEndpoint(tab) {
    const map = {
      daily: ["/mining/daily-logs", "daily_logs"],
      production: ["/mining/production", "production_records"],
      equipment: ["/mining/equipment-logs", "equipment_logs"],
      fuel: ["/mining/fuel-logs", "fuel_logs"],
      expenses: ["/mining/expenses", "expenses"],
      incidents: ["/mining/incidents", "incidents"],
    };
    return map[tab] || null;
  }

  async function loadRecords(tab = activeTab) {
    if (tab === "overview" || tab === "sites") {
      setRecords([]);
      return;
    }

    const endpoint = recordEndpoint(tab);
    if (!endpoint) return;

    setRecordsLoading(true);
    try {
      const response = await axiosClient.get(endpoint[0], {
        params: {
          site_id: selectedSiteId || undefined,
          from: dateFrom || undefined,
          to: dateTo || undefined,
        },
      });
      setRecords(response.data[endpoint[1]] || []);
    } catch (requestError) {
      setError(apiMessage(requestError, "Could not load Mining records."));
    } finally {
      setRecordsLoading(false);
    }
  }

  async function loadPage() {
    setLoading(true);
    setError("");
    try {
      await loadSitesAndAssets();
      await loadDashboard();
    } catch (requestError) {
      setError(apiMessage(requestError, "Could not load the Mining Operations workspace."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!contextLoading) {
      loadPage();
    }
    // Reload when an administrator changes this account's assigned sites.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextLoading, automaticAccess, assignedSiteOptions.map((item) => item.id).join(",")]);

  useEffect(() => {
    if (!loading) {
      loadDashboard().catch((requestError) => {
        setError(apiMessage(requestError, "Could not refresh Mining summary."));
      });
      loadRecords(activeTab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSiteId, dateFrom, dateTo, activeTab]);

  function openNewForm() {
    const siteId = defaultSiteValue();
    setError("");
    setSuccess("");

    if (activeTab !== "sites" && !siteId) {
      setError("Choose a Mining site before creating an operational record.");
      return;
    }

    if (activeTab === "sites") setSiteForm(initialSiteForm);
    if (activeTab === "daily") setDailyForm({ ...createDailyForm(), site_id: siteId });
    if (activeTab === "production") {
      setProductionForm({
        ...createProductionForm(),
        site_id: siteId,
        unit: selectedSite?.production_unit || "tonnes",
        material_type: selectedSite?.material_type || "",
      });
    }
    if (activeTab === "equipment") setEquipmentForm({ ...createEquipmentForm(), site_id: siteId });
    if (activeTab === "fuel") setFuelForm({ ...createFuelForm(), site_id: siteId });
    if (activeTab === "expenses") setExpenseForm({ ...createExpenseForm(), site_id: siteId });
    if (activeTab === "incidents") setIncidentForm({ ...createIncidentForm(), site_id: siteId });
    setFormOpen(true);
  }

  async function afterSave(message) {
    setFormOpen(false);
    setNotice(message);
    await Promise.all([loadSitesAndAssets(), loadDashboard(), loadRecords(activeTab)]);
  }

  async function saveSite(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      if (siteForm.id) {
        const response = await axiosClient.put(`/mining/sites/${siteForm.id}`, siteForm);
        await afterSave(response.data.message || "Mining site updated.");
      } else {
        const response = await axiosClient.post("/mining/sites", siteForm);
        await afterSave(response.data.message || "Mining site created.");
      }
    } catch (requestError) {
      setError(apiMessage(requestError, "Could not save mining site."));
    } finally {
      setSaving(false);
    }
  }

  async function saveRecord(event, endpoint, form, resetForm) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await axiosClient.post(endpoint, form);
      resetForm();
      await afterSave(response.data.message || "Mining record saved.");
    } catch (requestError) {
      setError(apiMessage(requestError, "Could not save Mining record."));
    } finally {
      setSaving(false);
    }
  }

  function editSite(site) {
    setSiteForm({
      id: site.id,
      site_code: site.site_code || "",
      site_name: site.site_name || "",
      location: site.location || "",
      material_type: site.material_type || "",
      production_unit: site.production_unit || "tonnes",
      daily_target: site.daily_target ?? "",
      manager_name: site.manager_name || "",
      manager_phone: site.manager_phone || "",
      status: site.status || "active",
      notes: site.notes || "",
      is_active: Boolean(site.is_active),
    });
    setFormOpen(true);
  }


  async function deleteSite(site) {
    const confirmation = window.prompt(
      `Type ${site.site_code} to remove this Mining site. Empty sites are deleted; sites with operational history are closed and hidden.`
    );

    if (confirmation === null) return;

    const reason = window.prompt(
      "Enter the reason for removing this Mining site. This reason is written to the audit trail."
    );

    if (!String(reason || "").trim()) {
      setError("A reason is required before removing a Mining site.");
      return;
    }

    setDeletingSiteId(site.id);
    setError("");

    try {
      const response = await axiosClient.delete(`/mining/sites/${site.id}`, {
        data: {
          confirmation: String(confirmation || "").trim(),
          reason: String(reason).trim(),
        },
      });

      if (Number(selectedSiteId) === Number(site.id)) {
        selectContext("");
        setSelectedSiteId("");
      }

      setFormOpen(false);
      setSiteForm(initialSiteForm);
      setNotice(response.data?.message || "Mining site removed safely.");
      await Promise.all([loadSitesAndAssets(), loadDashboard()]);
    } catch (requestError) {
      setError(apiMessage(requestError, "Could not safely remove the Mining site."));
    } finally {
      setDeletingSiteId(null);
    }
  }

  async function approveDailyLog(log) {
    if (!window.confirm(`Approve the ${log.shift_code} log for ${log.site_code} on ${formatDate(log.log_date)}?`)) return;
    setSaving(true);
    try {
      const response = await axiosClient.patch(`/mining/daily-logs/${log.id}/approve`);
      setNotice(response.data.message || "Daily log approved.");
      await Promise.all([loadRecords("daily"), loadDashboard()]);
    } catch (requestError) {
      setError(apiMessage(requestError, "Could not approve daily log."));
    } finally {
      setSaving(false);
    }
  }

  async function approveOperationalRecord(tab, record) {
    const definitions = {
      production: {
        endpoint: `/mining/production/${record.id}/approve`,
        label: "production record",
      },
      equipment: {
        endpoint: `/mining/equipment-logs/${record.id}/approve`,
        label: "equipment log",
      },
      expenses: {
        endpoint: `/mining/expenses/${record.id}/approve`,
        label: "mining expense",
      },
    };

    const definition = definitions[tab];
    if (!definition) return;

    if (
      !window.confirm(
        `Approve this ${definition.label} for ${record.site_code}?`
      )
    ) {
      return;
    }

    setSaving(true);
    setError("");

    try {
      const response = await axiosClient.patch(definition.endpoint);
      setNotice(
        response.data.message ||
          `${label(definition.label)} approved successfully.`
      );
      await Promise.all([loadRecords(tab), loadDashboard()]);
    } catch (requestError) {
      setError(
        apiMessage(
          requestError,
          `Could not approve the ${definition.label}.`
        )
      );
    } finally {
      setSaving(false);
    }
  }

  async function changeIncidentStatus(incident, status) {
    if (!window.confirm(`Change incident ${incident.id} to ${label(status)}?`)) return;
    setSaving(true);
    try {
      const response = await axiosClient.patch(`/mining/incidents/${incident.id}/status`, { status });
      setNotice(response.data.message || "Incident status updated.");
      await Promise.all([loadRecords("incidents"), loadDashboard()]);
    } catch (requestError) {
      setError(apiMessage(requestError, "Could not update incident."));
    } finally {
      setSaving(false);
    }
  }

  const summary = dashboard?.summary || {};
  const productionText = (dashboard?.production_by_unit || []).length
    ? dashboard.production_by_unit
        .map((item) => `${formatNumber(item.total_quantity, 3)} ${item.unit}`)
        .join(" · ")
    : "No production today";

  if (loading) {
    return (
      <div className="mining-page">
        <div className="mining-loading">Loading Mining Operations…</div>
      </div>
    );
  }

  return (
    <div className="mining-page">
      <section className="mining-hero">
        <div className="mining-hero-copy">
          <div className="mining-kicker"><span>⛏️</span> Chalin 03 Group Operations</div>
          <h1>Mining Operations Command Centre</h1>
          <p>
            Sites, daily production, shared equipment, fuel, expenses and safety records in one controlled workspace.
          </p>
          <div className="mining-hero-tags">
            <span>{canEdit ? "Operational access" : "Auditor read-only review"}</span>
            <span>{sites.length} registered site{sites.length === 1 ? "" : "s"}</span>
            <span>{activeAssets.length} fleet asset{activeAssets.length === 1 ? "" : "s"}</span>
          </div>
        </div>

        <div className="mining-hero-controls">
          <label>
            <span>Review site</span>
            <SiteSelect
              sites={sites}
              value={selectedSiteId}
              onChange={(event) => {
                const value = event.target.value;
                if (selectContext(value)) {
                  setSelectedSiteId(value);
                }
              }}
              includeAll={automaticAccess}
            />
          </label>
          <button className="mining-button mining-button--light" type="button" onClick={loadPage}>
            ↻ Refresh Workspace
          </button>
        </div>
      </section>

      {error ? <div className="mining-alert mining-alert--error">{error}</div> : null}
      {success ? <div className="mining-alert mining-alert--success">{success}</div> : null}
      {!canEdit ? (
        <div className="mining-alert mining-alert--info">
          Auditor access is read-only. Administrators create Mining sites; administrators and managers can record daily Mining operations.
        </div>
      ) : null}
      {!automaticAccess && !contextLoading && assignedSiteOptions.length === 0 ? (
        <div className="mining-alert mining-alert--error">
          No Mining site is assigned to this account. Ask an administrator to grant site access in Mining Administration.
        </div>
      ) : null}
      {automaticAccess && !contextLoading && !selectedSiteId ? (
        <div className="mining-alert mining-alert--info">
          All-site review mode is active. Select one Mining site before creating or approving an operational record.
        </div>
      ) : null}

      <section className="mining-summary-grid">
        <article><span>📍</span><div><small>Active Sites</small><strong>{formatNumber(summary.active_sites, 0)}</strong><p>{formatNumber(summary.paused_sites, 0)} paused</p></div></article>
        <article><span>⛏️</span><div><small>Production Today</small><strong className="mining-summary-text">{productionText}</strong><p>{formatNumber(summary.daily_logs_today, 0)} daily logs</p></div></article>
        <article><span>🚜</span><div><small>Equipment Today</small><strong>{formatNumber(summary.equipment_used_today, 0)}</strong><p>{formatNumber(summary.working_hours_today)} working hours</p></div></article>
        <article><span>⛽</span><div><small>Fuel Issued Today</small><strong>{formatNumber(summary.fuel_issued_today)} L</strong><p>{formatNumber(summary.fuel_received_today)} L received</p></div></article>
        <article><span>💳</span><div><small>Site Expenses Today</small><strong>{formatMoney(summary.expenses_today)}</strong><p>{formatNumber(summary.expenses_today_count, 0)} entries</p></div></article>
        <article className={Number(summary.serious_open_incidents || 0) > 0 ? "mining-summary-danger" : ""}><span>🛡️</span><div><small>Open Incidents</small><strong>{formatNumber(summary.open_incidents, 0)}</strong><p>{formatNumber(summary.serious_open_incidents, 0)} high / critical</p></div></article>
      </section>

      <nav className="mining-tabs" aria-label="Mining Operations sections">
        {TABS.map(([code, title, icon]) => (
          <button
            key={code}
            type="button"
            className={activeTab === code ? "active" : ""}
            onClick={() => {
              setActiveTab(code);
              setFormOpen(false);
              setError("");
            }}
          >
            <span>{icon}</span>{title}
          </button>
        ))}
      </nav>

      <section className="mining-workspace">
        {activeTab === "overview" ? (
          <Overview dashboard={dashboard} />
        ) : (
          <>
            <SectionHeader
              eyebrow="Mining Operations"
              title={TABS.find(([code]) => code === activeTab)?.[1] || "Records"}
              description={selectedSite ? `${selectedSite.site_code} — ${selectedSite.site_name}` : "Showing all mining sites"}
              action={
                <div className="mining-heading-actions">
                  <button
                    className="mining-button mining-button--ghost"
                    type="button"
                    onClick={() =>
                      downloadCsv(
                        `chalin03-mining-${activeTab}-${localDate()}.csv`,
                        exportRows
                      )
                    }
                  >
                    ⇩ Export Visible
                  </button>
                  {canCreateCurrent ? (
                    <button className="mining-button mining-button--primary" type="button" onClick={openNewForm}>
                      ＋ New {activeTab === "sites" ? "Site" : "Record"}
                    </button>
                  ) : null}
                </div>
              }
            />

            {activeTab !== "sites" ? (
              <div className="mining-filter-bar">
                <label><span>From</span><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
                <label><span>To</span><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
                <button type="button" className="mining-button mining-button--ghost" onClick={() => { setDateFrom(""); setDateTo(""); }}>Clear Dates</button>
              </div>
            ) : null}

            {formOpen && canCreateCurrent ? (
              <MiningFormPanel title={siteForm.id && activeTab === "sites" ? "Edit Mining Site" : `New ${TABS.find(([code]) => code === activeTab)?.[1]}`} onClose={() => setFormOpen(false)}>
                {activeTab === "sites" ? <SiteForm form={siteForm} setForm={setSiteForm} onSubmit={saveSite} saving={saving} /> : null}
                {activeTab === "daily" ? <DailyForm sites={sites} form={dailyForm} setForm={setDailyForm} onSubmit={(event) => saveRecord(event, "/mining/daily-logs", dailyForm, () => setDailyForm(createDailyForm()))} saving={saving} /> : null}
                {activeTab === "production" ? <ProductionForm sites={sites} form={productionForm} setForm={setProductionForm} onSubmit={(event) => saveRecord(event, "/mining/production", productionForm, () => setProductionForm(createProductionForm()))} saving={saving} /> : null}
                {activeTab === "equipment" ? <EquipmentForm sites={sites} assets={activeAssets} form={equipmentForm} setForm={setEquipmentForm} onSubmit={(event) => saveRecord(event, "/mining/equipment-logs", equipmentForm, () => setEquipmentForm(createEquipmentForm()))} saving={saving} /> : null}
                {activeTab === "fuel" ? <FuelForm sites={sites} assets={activeAssets} form={fuelForm} setForm={setFuelForm} onSubmit={(event) => saveRecord(event, "/mining/fuel-logs", fuelForm, () => setFuelForm(createFuelForm()))} saving={saving} /> : null}
                {activeTab === "expenses" ? <ExpenseForm sites={sites} form={expenseForm} setForm={setExpenseForm} onSubmit={(event) => saveRecord(event, "/mining/expenses", expenseForm, () => setExpenseForm(createExpenseForm()))} saving={saving} /> : null}
                {activeTab === "incidents" ? <IncidentForm sites={sites} form={incidentForm} setForm={setIncidentForm} onSubmit={(event) => saveRecord(event, "/mining/incidents", incidentForm, () => setIncidentForm(createIncidentForm()))} saving={saving} /> : null}
              </MiningFormPanel>
            ) : null}

            {activeTab === "sites" ? (
              <SitesTable
                sites={sites}
                canEdit={canManageSites}
                canDelete={canDeleteSites}
                deletingSiteId={deletingSiteId}
                onEdit={editSite}
                onDelete={deleteSite}
              />
            ) : recordsLoading ? (
              <div className="mining-loading mining-loading--small">Loading records…</div>
            ) : (
              <RecordsTable
                tab={activeTab}
                records={records}
                canApprove={canApproveCurrent && Boolean(selectedSiteId)}
                saving={saving}
                onApproveDaily={approveDailyLog}
                onApproveRecord={approveOperationalRecord}
                onIncidentStatus={changeIncidentStatus}
              />
            )}
          </>
        )}
      </section>
    </div>
  );
}

function Overview({ dashboard }) {
  const performance = dashboard?.site_performance || [];
  const logs = dashboard?.recent_daily_logs || [];
  const incidents = dashboard?.recent_incidents || [];

  return (
    <div className="mining-overview-grid">
      <section className="mining-panel mining-panel--wide">
        <SectionHeader eyebrow="Today" title="Site Target Performance" description="Production recorded today against each site's configured target." />
        {performance.length ? (
          <div className="mining-performance-list">
            {performance.map((site) => {
              const percent = site.target_percent == null ? null : Math.max(0, Number(site.target_percent));
              return (
                <article key={site.site_id}>
                  <div className="mining-performance-head">
                    <div><strong>{site.site_code} — {site.site_name}</strong><span>{formatNumber(site.today_quantity, 3)} {site.production_unit}</span></div>
                    <b>{percent == null ? "No target" : `${formatNumber(percent, 1)}%`}</b>
                  </div>
                  <div className="mining-progress"><span style={{ width: `${Math.min(percent || 0, 100)}%` }} /></div>
                  <small>{site.daily_target ? `Daily target: ${formatNumber(site.daily_target, 3)} ${site.production_unit}` : "Set a daily target in Sites."}</small>
                </article>
              );
            })}
          </div>
        ) : <EmptyState icon="📍" title="No mining sites yet" description="Create the first mining site to begin daily operational tracking." />}
      </section>

      <section className="mining-panel">
        <SectionHeader eyebrow="Operations" title="Recent Daily Logs" />
        {logs.length ? <div className="mining-activity-list">{logs.map((log) => (
          <article key={log.id}><div><strong>{log.site_code}</strong><StatusPill value={log.status} /></div><p>{label(log.shift_code)} shift · {formatDate(log.log_date)}</p><small>{log.supervisor_name || "Supervisor not recorded"} · {formatNumber(log.workforce_count, 0)} workers</small></article>
        ))}</div> : <EmptyState title="No daily logs" description="Daily and shift logs will appear here." />}
      </section>

      <section className="mining-panel">
        <SectionHeader eyebrow="Safety" title="Recent Incidents" />
        {incidents.length ? <div className="mining-activity-list">{incidents.map((incident) => (
          <article key={incident.id}><div><strong>{incident.site_code}</strong><StatusPill value={incident.severity} tone={incident.severity} /></div><p>{incident.incident_type} · {formatDateTime(incident.incident_datetime)}</p><small>{label(incident.status)} · {incident.exact_area || "Area not recorded"}</small></article>
        ))}</div> : <EmptyState icon="🛡️" title="No incidents recorded" description="Open safety or operational incidents will appear here." />}
      </section>
    </div>
  );
}

function MiningFormPanel({ title, onClose, children }) {
  return (
    <section className="mining-form-panel">
      <div className="mining-form-panel-head"><div><p>Operational entry</p><h3>{title}</h3></div><button type="button" onClick={onClose} aria-label="Close form">×</button></div>
      {children}
    </section>
  );
}

function FormActions({ saving, labelText = "Save Record" }) {
  return <div className="mining-form-actions"><button className="mining-button mining-button--primary" disabled={saving}>{saving ? "Saving…" : labelText}</button></div>;
}

function SiteForm({ form, setForm, onSubmit, saving }) {
  const change = (name) => (event) => setForm((current) => ({ ...current, [name]: event.target.type === "checkbox" ? event.target.checked : event.target.value }));
  return <form className="mining-form" onSubmit={onSubmit}>
    <div className="mining-form-grid mining-form-grid--3">
      <label><span>Site code *</span><input value={form.site_code} onChange={change("site_code")} placeholder="MINE-01" required /></label>
      <label><span>Site name *</span><input value={form.site_name} onChange={change("site_name")} required /></label>
      <label><span>Status</span><select value={form.status} onChange={change("status")}><option value="active">Active</option><option value="paused">Paused</option><option value="closed">Closed</option></select></label>
      <label><span>Location</span><input value={form.location} onChange={change("location")} /></label>
      <label><span>Material / mineral</span><input value={form.material_type} onChange={change("material_type")} placeholder="Gold-bearing ore" /></label>
      <label><span>Production unit *</span><input value={form.production_unit} onChange={change("production_unit")} placeholder="tonnes" required /></label>
      <label><span>Daily target</span><input type="number" min="0" step="0.001" value={form.daily_target} onChange={change("daily_target")} /></label>
      <label><span>Site manager</span><input value={form.manager_name} onChange={change("manager_name")} /></label>
      <label><span>Manager phone</span><input value={form.manager_phone} onChange={change("manager_phone")} /></label>
    </div>
    <label><span>Notes</span><textarea rows="3" value={form.notes} onChange={change("notes")} /></label>
    {form.id ? <label className="mining-check"><input type="checkbox" checked={form.is_active} onChange={change("is_active")} /><span>Site remains active in the register</span></label> : null}
    <FormActions saving={saving} labelText={form.id ? "Update Mining Site" : "Create Mining Site"} />
  </form>;
}

function DailyForm({ sites, form, setForm, onSubmit, saving }) {
  const change = (name) => (event) => setForm((current) => ({ ...current, [name]: event.target.value }));
  return <form className="mining-form" onSubmit={onSubmit}>
    <div className="mining-form-grid mining-form-grid--3">
      <label><span>Mining site *</span><SiteSelect sites={sites} value={form.site_id} onChange={change("site_id")} required /></label>
      <label><span>Log date *</span><input type="date" value={form.log_date} onChange={change("log_date")} required /></label>
      <label><span>Shift *</span><select value={form.shift_code} onChange={change("shift_code")}><option value="day">Day</option><option value="night">Night</option><option value="morning">Morning</option><option value="afternoon">Afternoon</option><option value="custom">Custom</option></select></label>
      <label><span>Supervisor</span><input value={form.supervisor_name} onChange={change("supervisor_name")} /></label>
      <label><span>Weather / conditions</span><input value={form.weather_conditions} onChange={change("weather_conditions")} /></label>
      <label><span>Workers present</span><input type="number" min="0" step="1" value={form.workforce_count} onChange={change("workforce_count")} /></label>
      <label><span>Status</span><select value={form.status} onChange={change("status")}><option value="draft">Draft</option><option value="submitted">Submitted</option></select></label>
    </div>
    <div className="mining-form-grid mining-form-grid--2"><label><span>Opening notes</span><textarea rows="4" value={form.opening_notes} onChange={change("opening_notes")} /></label><label><span>Closing notes</span><textarea rows="4" value={form.closing_notes} onChange={change("closing_notes")} /></label></div>
    <FormActions saving={saving} labelText="Save Daily Log" />
  </form>;
}

function ProductionForm({ sites, form, setForm, onSubmit, saving }) {
  const change = (name) => (event) => {
    const value = event.target.value;
    if (name === "site_id") {
      const site = sites.find((item) => Number(item.id) === Number(value));
      setForm((current) => ({ ...current, site_id: value, unit: site?.production_unit || current.unit, material_type: site?.material_type || current.material_type }));
      return;
    }
    setForm((current) => ({ ...current, [name]: value }));
  };
  return <form className="mining-form" onSubmit={onSubmit}>
    <div className="mining-form-grid mining-form-grid--3">
      <label><span>Mining site *</span><SiteSelect sites={sites} value={form.site_id} onChange={change("site_id")} required /></label>
      <label><span>Date and time *</span><input type="datetime-local" value={form.production_datetime} onChange={change("production_datetime")} required /></label>
      <label><span>Work area / pit</span><input value={form.work_area} onChange={change("work_area")} /></label>
      <label><span>Material</span><input value={form.material_type} onChange={change("material_type")} /></label>
      <label><span>Quantity *</span><input type="number" min="0.001" step="0.001" value={form.quantity} onChange={change("quantity")} required /></label>
      <label><span>Unit *</span><input value={form.unit} onChange={change("unit")} required /></label>
      <label><span>Grade / quality</span><input value={form.grade_quality} onChange={change("grade_quality")} /></label>
      <label><span>Destination / stockpile</span><input value={form.destination} onChange={change("destination")} /></label>
    </div>
    <label><span>Notes</span><textarea rows="3" value={form.notes} onChange={change("notes")} /></label>
    <FormActions saving={saving} labelText="Record Production" />
  </form>;
}

function EquipmentForm({ sites, assets, form, setForm, onSubmit, saving }) {
  const change = (name) => (event) => setForm((current) => ({ ...current, [name]: event.target.value }));
  return <form className="mining-form" onSubmit={onSubmit}>
    <div className="mining-form-grid mining-form-grid--3">
      <label><span>Mining site *</span><SiteSelect sites={sites} value={form.site_id} onChange={change("site_id")} required /></label>
      <label><span>Equipment *</span><select value={form.asset_id} onChange={change("asset_id")} required><option value="">Choose equipment</option>{assets.map((asset) => <option value={asset.id} key={asset.id}>{asset.asset_code} — {asset.asset_name} ({formatNumber(asset.current_meter)})</option>)}</select></label>
      <label><span>Work date *</span><input type="date" value={form.work_date} onChange={change("work_date")} required /></label>
      <label><span>Shift</span><select value={form.shift_code} onChange={change("shift_code")}><option value="day">Day</option><option value="night">Night</option><option value="morning">Morning</option><option value="afternoon">Afternoon</option><option value="custom">Custom</option></select></label>
      <label><span>Operator</span><input value={form.operator_name} onChange={change("operator_name")} /></label>
      <label><span>Start meter *</span><input type="number" min="0" step="0.01" value={form.start_meter} onChange={change("start_meter")} required /></label>
      <label><span>End meter *</span><input type="number" min="0" step="0.01" value={form.end_meter} onChange={change("end_meter")} required /></label>
      <label><span>Working hours</span><input type="number" min="0" step="0.01" value={form.working_hours} onChange={change("working_hours")} placeholder="Calculated from meter if blank" /></label>
      <label><span>Idle hours</span><input type="number" min="0" step="0.01" value={form.idle_hours} onChange={change("idle_hours")} /></label>
      <label><span>Breakdown hours</span><input type="number" min="0" step="0.01" value={form.breakdown_hours} onChange={change("breakdown_hours")} /></label>
      <label><span>Fuel used (litres)</span><input type="number" min="0" step="0.01" value={form.fuel_litres} onChange={change("fuel_litres")} /></label>
    </div>
    <label><span>Task performed</span><textarea rows="3" value={form.task_description} onChange={change("task_description")} /></label>
    <FormActions saving={saving} labelText="Save Equipment Shift" />
  </form>;
}

function FuelForm({ sites, assets, form, setForm, onSubmit, saving }) {
  const change = (name) => (event) => setForm((current) => ({ ...current, [name]: event.target.value }));
  return <form className="mining-form" onSubmit={onSubmit}>
    <div className="mining-form-grid mining-form-grid--3">
      <label><span>Mining site *</span><SiteSelect sites={sites} value={form.site_id} onChange={change("site_id")} required /></label>
      <label><span>Transaction *</span><select value={form.transaction_type} onChange={change("transaction_type")}><option value="issue">Issue to equipment</option><option value="receipt">Fuel received</option><option value="adjustment_in">Adjustment in</option><option value="adjustment_out">Adjustment out</option></select></label>
      <label><span>Date and time *</span><input type="datetime-local" value={form.log_datetime} onChange={change("log_datetime")} required /></label>
      <label><span>Equipment</span><select value={form.asset_id} onChange={change("asset_id")}><option value="">No equipment / storage movement</option>{assets.map((asset) => <option value={asset.id} key={asset.id}>{asset.asset_code} — {asset.asset_name}</option>)}</select></label>
      <label><span>Litres *</span><input type="number" min="0.01" step="0.01" value={form.quantity_litres} onChange={change("quantity_litres")} required /></label>
      <label><span>Storage / tank</span><input value={form.storage_name} onChange={change("storage_name")} /></label>
      <label><span>Supplier / source</span><input value={form.supplier_or_source} onChange={change("supplier_or_source")} /></label>
      <label><span>Recipient</span><input value={form.recipient_name} onChange={change("recipient_name")} /></label>
      <label><span>Meter reading</span><input type="number" min="0" step="0.01" value={form.meter_reading} onChange={change("meter_reading")} /></label>
      <label><span>Unit cost</span><input type="number" min="0" step="0.01" value={form.unit_cost} onChange={change("unit_cost")} /></label>
      <label><span>Total cost</span><input type="number" min="0" step="0.01" value={form.total_cost} onChange={change("total_cost")} placeholder="Calculated if blank" /></label>
      <label><span>Reference</span><input value={form.reference_number} onChange={change("reference_number")} /></label>
    </div>
    <label><span>Notes</span><textarea rows="3" value={form.notes} onChange={change("notes")} /></label>
    <FormActions saving={saving} labelText="Save Fuel Transaction" />
  </form>;
}

function ExpenseForm({ sites, form, setForm, onSubmit, saving }) {
  const change = (name) => (event) => setForm((current) => ({ ...current, [name]: event.target.value }));
  return <form className="mining-form" onSubmit={onSubmit}>
    <div className="mining-form-grid mining-form-grid--3">
      <label><span>Mining site *</span><SiteSelect sites={sites} value={form.site_id} onChange={change("site_id")} required /></label>
      <label><span>Expense date *</span><input type="date" value={form.expense_date} onChange={change("expense_date")} required /></label>
      <label><span>Category *</span><select value={form.category} onChange={change("category")}><option>Fuel</option><option>Wages</option><option>Food</option><option>Transport</option><option>Accommodation</option><option>Repairs</option><option>Parts</option><option>Security</option><option>Permits</option><option>Environmental</option><option>Contractor</option><option>Other</option></select></label>
      <label><span>Amount *</span><input type="number" min="0.01" step="0.01" value={form.amount} onChange={change("amount")} required /></label>
      <label><span>Payment method</span><select value={form.payment_method} onChange={change("payment_method")}><option value="cash">Cash</option><option value="momo">MoMo</option><option value="bank">Bank</option><option value="credit">Credit</option><option value="other">Other</option></select></label>
      <label><span>Reference</span><input value={form.reference_number} onChange={change("reference_number")} /></label>
    </div>
    <label><span>Description</span><textarea rows="3" value={form.description} onChange={change("description")} /></label>
    <FormActions saving={saving} labelText="Record Site Expense" />
  </form>;
}

function IncidentForm({ sites, form, setForm, onSubmit, saving }) {
  const change = (name) => (event) => setForm((current) => ({ ...current, [name]: event.target.value }));
  return <form className="mining-form" onSubmit={onSubmit}>
    <div className="mining-form-grid mining-form-grid--3">
      <label><span>Mining site *</span><SiteSelect sites={sites} value={form.site_id} onChange={change("site_id")} required /></label>
      <label><span>Date and time *</span><input type="datetime-local" value={form.incident_datetime} onChange={change("incident_datetime")} required /></label>
      <label><span>Incident type *</span><input value={form.incident_type} onChange={change("incident_type")} required /></label>
      <label><span>Severity *</span><select value={form.severity} onChange={change("severity")}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></label>
      <label><span>Exact area</span><input value={form.exact_area} onChange={change("exact_area")} /></label>
      <label><span>Responsible officer</span><input value={form.responsible_officer} onChange={change("responsible_officer")} /></label>
    </div>
    <label><span>People involved</span><textarea rows="2" value={form.people_involved} onChange={change("people_involved")} /></label>
    <label><span>Description *</span><textarea rows="4" value={form.description} onChange={change("description")} required /></label>
    <div className="mining-form-grid mining-form-grid--2"><label><span>Immediate action</span><textarea rows="3" value={form.immediate_action} onChange={change("immediate_action")} /></label><label><span>Corrective action</span><textarea rows="3" value={form.corrective_action} onChange={change("corrective_action")} /></label></div>
    <FormActions saving={saving} labelText="Record Incident" />
  </form>;
}

function SitesTable({ sites, canEdit, canDelete, deletingSiteId, onEdit, onDelete }) {
  if (!sites.length) return <EmptyState icon="📍" title="No mining sites registered" description="Create the first site before recording daily operations." />;
  return <div className="mining-record-grid">{sites.map((site) => (
    <article className={`mining-site-card ${site.is_active ? "" : "mining-site-card--inactive"}`} key={site.id}>
      <div className="mining-card-head"><div><span>📍</span><div><small>{site.site_code}</small><h3>{site.site_name}</h3></div></div><StatusPill value={site.status} /></div>
      <dl><div><dt>Location</dt><dd>{site.location || "Not recorded"}</dd></div><div><dt>Material</dt><dd>{site.material_type || "Not set"}</dd></div><div><dt>Daily target</dt><dd>{site.daily_target ? `${formatNumber(site.daily_target, 3)} ${site.production_unit}` : "Not set"}</dd></div><div><dt>Manager</dt><dd>{site.manager_name || "Not assigned"}</dd></div></dl>
      {site.notes ? <p className="mining-card-note">{site.notes}</p> : null}
      {canEdit || canDelete ? (
        <div className="mining-inline-actions">
          {canEdit ? <button type="button" className="mining-button mining-button--ghost" onClick={() => onEdit(site)}>Edit Site</button> : null}
          {canDelete ? (
            <button
              type="button"
              className="mining-button mining-button--danger"
              disabled={Number(deletingSiteId) === Number(site.id)}
              onClick={() => onDelete(site)}
            >
              {Number(deletingSiteId) === Number(site.id) ? "Removing…" : "Delete Site"}
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  ))}</div>;
}

function RecordsTable({
  tab,
  records,
  canApprove,
  saving,
  onApproveDaily,
  onApproveRecord,
  onIncidentStatus,
}) {
  if (!records.length) {
    return (
      <EmptyState
        title="No records found"
        description="Create a record or change the selected site/date filters."
      />
    );
  }

  return (
    <div className="mining-record-list">
      {records.map((record) => {
        if (tab === "daily") {
          return (
            <article key={record.id} className="mining-record-card">
              <div className="mining-record-top">
                <div>
                  <small>
                    {record.site_code} · {formatDate(record.log_date)}
                  </small>
                  <h3>{label(record.shift_code)} Shift Daily Log</h3>
                </div>
                <StatusPill value={record.status} />
              </div>

              <div className="mining-record-facts">
                <span><b>Supervisor</b>{record.supervisor_name || "—"}</span>
                <span><b>Workforce</b>{formatNumber(record.workforce_count, 0)}</span>
                <span><b>Weather</b>{record.weather_conditions || "—"}</span>
                <span><b>Recorded by</b>{record.created_by_name || "—"}</span>
                {record.approved_by_name ? (
                  <span><b>Approved by</b>{record.approved_by_name}</span>
                ) : null}
              </div>

              {record.opening_notes || record.closing_notes ? (
                <p>{record.opening_notes || record.closing_notes}</p>
              ) : null}

              {canApprove && record.status !== "approved" ? (
                <button
                  disabled={saving}
                  type="button"
                  className="mining-button mining-button--success"
                  onClick={() => onApproveDaily(record)}
                >
                  Approve Daily Log
                </button>
              ) : null}
            </article>
          );
        }

        if (tab === "production") {
          return (
            <article key={record.id} className="mining-record-card">
              <div className="mining-record-top">
                <div>
                  <small>
                    {record.site_code} · {formatDateTime(record.production_datetime)}
                  </small>
                  <h3>
                    {formatNumber(record.quantity, 3)} {record.unit} —{" "}
                    {record.material_type || "Material"}
                  </h3>
                </div>
                <StatusPill value={record.status} />
              </div>

              <div className="mining-record-facts">
                <span><b>Work area</b>{record.work_area || "—"}</span>
                <span><b>Grade</b>{record.grade_quality || "—"}</span>
                <span><b>Destination</b>{record.destination || "—"}</span>
                <span><b>Recorded by</b>{record.created_by_name || "—"}</span>
                {record.approved_by_name ? (
                  <span><b>Approved by</b>{record.approved_by_name}</span>
                ) : null}
              </div>

              {record.notes ? <p>{record.notes}</p> : null}

              {canApprove && record.status !== "approved" ? (
                <button
                  disabled={saving}
                  type="button"
                  className="mining-button mining-button--success"
                  onClick={() => onApproveRecord("production", record)}
                >
                  Approve Production
                </button>
              ) : null}
            </article>
          );
        }

        if (tab === "equipment") {
          return (
            <article key={record.id} className="mining-record-card">
              <div className="mining-record-top">
                <div>
                  <small>
                    {record.site_code} · {formatDate(record.work_date)} ·{" "}
                    {label(record.shift_code)}
                  </small>
                  <h3>{record.asset_code} — {record.asset_name}</h3>
                </div>
                <StatusPill value={record.status} />
              </div>

              <div className="mining-record-facts">
                <span><b>Operator</b>{record.operator_name || "—"}</span>
                <span>
                  <b>Meter</b>
                  {formatNumber(record.start_meter)} → {formatNumber(record.end_meter)}
                </span>
                <span><b>Working</b>{formatNumber(record.working_hours)} hrs</span>
                <span>
                  <b>Idle / breakdown</b>
                  {formatNumber(record.idle_hours)} /{" "}
                  {formatNumber(record.breakdown_hours)} hrs
                </span>
                <span><b>Fuel</b>{formatNumber(record.fuel_litres)} L</span>
                {record.approved_by_name ? (
                  <span><b>Approved by</b>{record.approved_by_name}</span>
                ) : null}
              </div>

              {record.task_description ? <p>{record.task_description}</p> : null}

              {canApprove && record.status !== "approved" ? (
                <button
                  disabled={saving}
                  type="button"
                  className="mining-button mining-button--success"
                  onClick={() => onApproveRecord("equipment", record)}
                >
                  Approve Equipment Log
                </button>
              ) : null}
            </article>
          );
        }

        if (tab === "fuel") {
          return (
            <article key={record.id} className="mining-record-card">
              <div className="mining-record-top">
                <div>
                  <small>
                    {record.site_code} · {formatDateTime(record.log_datetime)}
                  </small>
                  <h3>
                    {label(record.transaction_type)} —{" "}
                    {formatNumber(record.quantity_litres)} L
                  </h3>
                </div>
                <StatusPill
                  value={record.transaction_type}
                  tone={
                    record.transaction_type === "issue" ||
                    record.transaction_type === "adjustment_out"
                      ? "medium"
                      : "active"
                  }
                />
              </div>

              <div className="mining-record-facts">
                <span>
                  <b>Equipment</b>
                  {record.asset_code
                    ? `${record.asset_code} — ${record.asset_name}`
                    : "Storage movement"}
                </span>
                <span><b>Storage</b>{record.storage_name || "—"}</span>
                <span>
                  <b>Source / recipient</b>
                  {record.supplier_or_source || record.recipient_name || "—"}
                </span>
                <span><b>Cost</b>{formatMoney(record.total_cost)}</span>
                <span><b>Reference</b>{record.reference_number || "—"}</span>
              </div>

              {record.notes ? <p>{record.notes}</p> : null}
            </article>
          );
        }

        if (tab === "expenses") {
          return (
            <article key={record.id} className="mining-record-card">
              <div className="mining-record-top">
                <div>
                  <small>
                    {record.site_code} · {formatDate(record.expense_date)}
                  </small>
                  <h3>{record.category} — {formatMoney(record.amount)}</h3>
                </div>
                <StatusPill value={record.status} />
              </div>

              <div className="mining-record-facts">
                <span><b>Method</b>{label(record.payment_method)}</span>
                <span><b>Reference</b>{record.reference_number || "—"}</span>
                <span><b>Recorded by</b>{record.created_by_name || "—"}</span>
                {record.approved_by_name ? (
                  <span><b>Approved by</b>{record.approved_by_name}</span>
                ) : null}
              </div>

              {record.description ? <p>{record.description}</p> : null}

              {canApprove && record.status !== "approved" ? (
                <button
                  disabled={saving}
                  type="button"
                  className="mining-button mining-button--success"
                  onClick={() => onApproveRecord("expenses", record)}
                >
                  Approve Expense
                </button>
              ) : null}
            </article>
          );
        }

        return (
          <article
            key={record.id}
            className={`mining-record-card mining-incident mining-incident--${record.severity}`}
          >
            <div className="mining-record-top">
              <div>
                <small>
                  {record.site_code} · {formatDateTime(record.incident_datetime)}
                </small>
                <h3>{record.incident_type}</h3>
              </div>
              <div className="mining-pill-stack">
                <StatusPill value={record.severity} tone={record.severity} />
                <StatusPill value={record.status} />
              </div>
            </div>

            <div className="mining-record-facts">
              <span><b>Area</b>{record.exact_area || "—"}</span>
              <span><b>Officer</b>{record.responsible_officer || "—"}</span>
              <span><b>People involved</b>{record.people_involved || "—"}</span>
            </div>

            <p>{record.description}</p>

            {record.immediate_action ? (
              <p className="mining-record-note">
                <b>Immediate action:</b> {record.immediate_action}
              </p>
            ) : null}

            {record.corrective_action ? (
              <p className="mining-record-note">
                <b>Corrective action:</b> {record.corrective_action}
              </p>
            ) : null}

            {canApprove && record.status !== "closed" ? (
              <div className="mining-inline-actions">
                <button
                  disabled={saving}
                  type="button"
                  className="mining-button mining-button--ghost"
                  onClick={() => onIncidentStatus(record, "investigating")}
                >
                  Investigating
                </button>
                <button
                  disabled={saving}
                  type="button"
                  className="mining-button mining-button--success"
                  onClick={() => onIncidentStatus(record, "closed")}
                >
                  Close Incident
                </button>
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
