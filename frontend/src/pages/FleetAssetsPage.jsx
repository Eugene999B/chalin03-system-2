import { useCallback, useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import {
  FLEET_ACTION_PERMISSIONS,
  canUseFleetAction,
} from "../security/permissionRules";
import "../styles/fleet.css";

const STATUS_OPTIONS = [
  ["available", "Available"],
  ["assigned_mining", "Assigned to Mining"],
  ["assigned_hire", "Assigned to Hire"],
  ["mobilizing", "Mobilizing"],
  ["working", "Working"],
  ["idle", "Idle"],
  ["maintenance", "Maintenance"],
  ["breakdown", "Breakdown"],
  ["retired", "Retired"],
  ["sold", "Sold"],
];

const ASSET_TYPE_OPTIONS = [
  "excavator",
  "bulldozer",
  "wheel_loader",
  "backhoe_loader",
  "motor_grader",
  "tipper_truck",
  "water_tanker",
  "lowbed_truck",
  "pickup",
  "generator",
  "compressor",
  "drilling_rig",
  "other",
];

const OWNERSHIP_OPTIONS = [
  ["company_owned", "Company Owned"],
  ["leased", "Leased"],
  ["financed", "Financed"],
  ["third_party", "Third Party"],
  ["other", "Other"],
];

function nowLocalInput() {
  const date = new Date();
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

function createEmptyAssetForm() {
  return {
    asset_code: "",
    asset_name: "",
    asset_type: "excavator",
    make: "",
    model: "",
    serial_number: "",
    registration_number: "",
    ownership_type: "company_owned",
    current_status: "available",
    current_location: "",
    assigned_operator_name: "",
    meter_type: "hour_meter",
    current_meter: "0",
    fuel_type: "diesel",
    service_interval: "",
    next_service_meter: "",
    insurance_expiry: "",
    registration_expiry: "",
    notes: "",
  };
}

function formatLabel(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatNumber(value, digits = 2) {
  const number = Number(value || 0);
  return Number.isFinite(number)
    ? number.toLocaleString(undefined, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })
    : "0.00";
}

function formatMoney(value) {
  return `GHS ${formatNumber(value)}`;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString();
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function getErrorMessage(error, fallback) {
  return (
    error?.response?.data?.message ||
    error?.message ||
    fallback ||
    "Something went wrong."
  );
}

function statusClass(status) {
  return `fleet-status fleet-status-${String(status || "unknown")}`;
}

function Modal({ title, subtitle, onClose, children, wide = false }) {
  return (
    <div className="fleet-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className={`fleet-modal ${wide ? "fleet-modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="fleet-modal-header">
          <div>
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button type="button" className="fleet-icon-button" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="fleet-modal-body">{children}</div>
      </section>
    </div>
  );
}

function EmptyState({ title, description }) {
  return (
    <div className="fleet-empty-state">
      <div className="fleet-empty-icon">🚜</div>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}

export default function FleetAssetsPage() {
  const { effectivePermissions, hasAnyPermission } = useAuth();
  const canEdit = hasAnyPermission(Object.values(FLEET_ACTION_PERMISSIONS));
  const canManageAssets = canUseFleetAction(effectivePermissions, "asset");
  const canManageStatus = canUseFleetAction(effectivePermissions, "status");
  const canManageMeter = canUseFleetAction(effectivePermissions, "meter");
  const canManageFuel = canUseFleetAction(effectivePermissions, "fuel");
  const canManageMaintenance = canUseFleetAction(effectivePermissions, "maintenance");
  const canManageInspection = canUseFleetAction(effectivePermissions, "inspection");
  const isAdmin = canManageAssets;

  const [assets, setAssets] = useState([]);
  const [assetTypes, setAssetTypes] = useState([]);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [filters, setFilters] = useState({
    search: "",
    status: "",
    type: "",
    include_inactive: false,
  });

  const [assetModalOpen, setAssetModalOpen] = useState(false);
  const [editingAssetId, setEditingAssetId] = useState(null);
  const [assetForm, setAssetForm] = useState(createEmptyAssetForm);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [assetDetail, setAssetDetail] = useState(null);
  const [detailTab, setDetailTab] = useState("overview");

  const [statusForm, setStatusForm] = useState({
    status: "available",
    current_location: "",
    assigned_operator_name: "",
    reason: "",
  });

  const [meterForm, setMeterForm] = useState({
    reading_value: "",
    reading_datetime: nowLocalInput(),
    source_type: "manual",
    notes: "",
    correction_reason: "",
  });

  const [fuelForm, setFuelForm] = useState({
    quantity_litres: "",
    meter_reading: "",
    log_datetime: nowLocalInput(),
    supplier_or_source: "",
    reference_number: "",
    cost_amount: "",
    notes: "",
  });

  const [maintenanceForm, setMaintenanceForm] = useState({
    maintenance_type: "service",
    status: "open",
    reported_at: nowLocalInput(),
    completed_at: "",
    meter_reading: "",
    description: "",
    technician: "",
    cost_amount: "",
    next_service_meter: "",
    notes: "",
  });

  const [inspectionForm, setInspectionForm] = useState({
    inspection_type: "routine",
    inspection_datetime: nowLocalInput(),
    meter_reading: "",
    condition_status: "good",
    inspected_by_name: "",
    findings: "",
    action_required: "",
  });

  const loadFleet = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const params = {};
      if (filters.search.trim()) params.search = filters.search.trim();
      if (filters.status) params.status = filters.status;
      if (filters.type) params.type = filters.type;
      if (filters.include_inactive) params.include_inactive = "true";

      const [summaryResponse, assetsResponse] = await Promise.all([
        axiosClient.get("/fleet/summary"),
        axiosClient.get("/fleet/assets", { params }),
      ]);

      setSummary(summaryResponse.data.summary || {});
      setAssets(assetsResponse.data.assets || []);
      setAssetTypes(assetsResponse.data.asset_types || []);
    } catch (requestError) {
      setError(
        getErrorMessage(
          requestError,
          "Something went wrong while loading the shared fleet register."
        )
      );
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    loadFleet();
  }, [loadFleet]);

  useEffect(() => {
    if (!success) return undefined;
    const timer = window.setTimeout(() => setSuccess(""), 4500);
    return () => window.clearTimeout(timer);
  }, [success]);

  const summaryCards = useMemo(
    () => [
      {
        label: "Registered Equipment",
        value: Number(summary.total_assets || 0),
        icon: "🚜",
        tone: "navy",
      },
      {
        label: "Available",
        value: Number(summary.available_assets || 0),
        icon: "✅",
        tone: "green",
      },
      {
        label: "Mining / Working",
        value: Number(summary.mining_or_working_assets || 0),
        icon: "⛏️",
        tone: "blue",
      },
      {
        label: "On Hire",
        value: Number(summary.hired_assets || 0),
        icon: "🤝",
        tone: "purple",
      },
      {
        label: "Maintenance",
        value: Number(summary.maintenance_assets || 0),
        icon: "🔧",
        tone: "amber",
      },
      {
        label: "Breakdown",
        value: Number(summary.breakdown_assets || 0),
        icon: "⚠️",
        tone: "red",
      },
      {
        label: "Service Due",
        value: Number(summary.service_due_assets || 0),
        icon: "🧰",
        tone: "orange",
      },
      {
        label: "Documents Expiring",
        value: Number(summary.documents_expiring_soon || 0),
        icon: "📄",
        tone: "slate",
      },
    ],
    [summary]
  );

  function updateFilter(field, value) {
    setFilters((current) => ({ ...current, [field]: value }));
  }

  function resetFilters() {
    setFilters({ search: "", status: "", type: "", include_inactive: false });
  }

  function openCreateAsset() {
    setEditingAssetId(null);
    setAssetForm(createEmptyAssetForm());
    setError("");
    setAssetModalOpen(true);
  }

  function openEditAsset(asset) {
    setEditingAssetId(asset.id);
    setAssetForm({
      asset_code: asset.asset_code || "",
      asset_name: asset.asset_name || "",
      asset_type: asset.asset_type || "excavator",
      make: asset.make || "",
      model: asset.model || "",
      serial_number: asset.serial_number || "",
      registration_number: asset.registration_number || "",
      ownership_type: asset.ownership_type || "company_owned",
      current_status: asset.current_status || "available",
      current_location: asset.current_location || "",
      assigned_operator_name: asset.assigned_operator_name || "",
      meter_type: asset.meter_type || "hour_meter",
      current_meter: String(asset.current_meter ?? "0"),
      fuel_type: asset.fuel_type || "diesel",
      service_interval: asset.service_interval ?? "",
      next_service_meter: asset.next_service_meter ?? "",
      insurance_expiry: asset.insurance_expiry
        ? String(asset.insurance_expiry).slice(0, 10)
        : "",
      registration_expiry: asset.registration_expiry
        ? String(asset.registration_expiry).slice(0, 10)
        : "",
      notes: asset.notes || "",
    });
    setError("");
    setAssetModalOpen(true);
  }

  function updateAssetForm(field, value) {
    setAssetForm((current) => ({ ...current, [field]: value }));
  }

  async function saveAsset(event) {
    event.preventDefault();
    if (!canManageAssets) {
      setError("Your account cannot manage Fleet asset records.");
      return;
    }
    setSaving(true);
    setError("");

    try {
      const payload = {
        ...assetForm,
        current_meter: Number(assetForm.current_meter || 0),
        service_interval:
          assetForm.service_interval === ""
            ? null
            : Number(assetForm.service_interval),
        next_service_meter:
          assetForm.next_service_meter === ""
            ? null
            : Number(assetForm.next_service_meter),
      };

      const response = editingAssetId
        ? await axiosClient.put(`/fleet/assets/${editingAssetId}`, payload)
        : await axiosClient.post("/fleet/assets", payload);

      setSuccess(response.data.message || "Equipment record saved successfully.");
      setAssetModalOpen(false);
      await loadFleet();
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Unable to save the equipment record."));
    } finally {
      setSaving(false);
    }
  }

  async function loadAssetDetail(assetId, { open = true } = {}) {
    if (open) {
      setDetailOpen(true);
      setDetailTab("overview");
    }

    setDetailLoading(true);
    setError("");

    try {
      const response = await axiosClient.get(`/fleet/assets/${assetId}`);
      const detail = response.data;
      setAssetDetail(detail);

      const asset = detail.asset || {};
      setStatusForm({
        status: asset.current_status || "available",
        current_location: asset.current_location || "",
        assigned_operator_name: asset.assigned_operator_name || "",
        reason: "",
      });
      setMeterForm({
        reading_value: String(asset.current_meter ?? ""),
        reading_datetime: nowLocalInput(),
        source_type: "manual",
        notes: "",
        correction_reason: "",
      });
      setFuelForm((current) => ({
        ...current,
        meter_reading: String(asset.current_meter ?? ""),
        log_datetime: nowLocalInput(),
      }));
      setMaintenanceForm((current) => ({
        ...current,
        reported_at: nowLocalInput(),
        meter_reading: String(asset.current_meter ?? ""),
      }));
      setInspectionForm((current) => ({
        ...current,
        inspection_datetime: nowLocalInput(),
        meter_reading: String(asset.current_meter ?? ""),
      }));
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Unable to load equipment details."));
      if (open) setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  }

  async function runDetailAction(action, successFallback) {
    if (!assetDetail?.asset?.id) return false;

    setSaving(true);
    setError("");

    try {
      const response = await action(assetDetail.asset.id);
      setSuccess(response.data.message || successFallback);
      await Promise.all([
        loadAssetDetail(assetDetail.asset.id, { open: false }),
        loadFleet(),
      ]);
      return true;
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Unable to save this fleet record."));
      return false;
    } finally {
      setSaving(false);
    }
  }

  function submitStatus(event) {
    event.preventDefault();
    if (!canManageStatus) {
      setError("Your account cannot change equipment status.");
      return;
    }
    runDetailAction(
      (assetId) => axiosClient.patch(`/fleet/assets/${assetId}/status`, statusForm),
      "Equipment status updated."
    );
  }

  function submitMeter(event) {
    event.preventDefault();
    if (!canManageMeter) {
      setError("Your account cannot record meter readings.");
      return;
    }
    runDetailAction(
      (assetId) =>
        axiosClient.post(`/fleet/assets/${assetId}/meter-readings`, {
          ...meterForm,
          reading_value: Number(meterForm.reading_value),
        }),
      "Meter reading recorded."
    );
  }

  async function submitFuel(event) {
    event.preventDefault();
    if (!canManageFuel) {
      setError("Your account cannot record Fleet fuel entries.");
      return;
    }
    const saved = await runDetailAction(
      (assetId) =>
        axiosClient.post(`/fleet/assets/${assetId}/fuel-logs`, {
          ...fuelForm,
          quantity_litres: Number(fuelForm.quantity_litres),
          meter_reading:
            fuelForm.meter_reading === ""
              ? null
              : Number(fuelForm.meter_reading),
          cost_amount:
            fuelForm.cost_amount === "" ? 0 : Number(fuelForm.cost_amount),
        }),
      "Fuel entry recorded."
    );

    if (saved) {
      setFuelForm((current) => ({
        ...current,
        quantity_litres: "",
        cost_amount: "",
        reference_number: "",
        notes: "",
        log_datetime: nowLocalInput(),
      }));
    }
  }

  async function submitMaintenance(event) {
    event.preventDefault();
    if (!canManageMaintenance) {
      setError("Your account cannot manage maintenance records.");
      return;
    }
    const saved = await runDetailAction(
      (assetId) =>
        axiosClient.post(`/fleet/assets/${assetId}/maintenance`, {
          ...maintenanceForm,
          meter_reading:
            maintenanceForm.meter_reading === ""
              ? null
              : Number(maintenanceForm.meter_reading),
          cost_amount:
            maintenanceForm.cost_amount === ""
              ? 0
              : Number(maintenanceForm.cost_amount),
          next_service_meter:
            maintenanceForm.next_service_meter === ""
              ? null
              : Number(maintenanceForm.next_service_meter),
        }),
      "Maintenance record saved."
    );

    if (saved) {
      setMaintenanceForm((current) => ({
        ...current,
        reported_at: nowLocalInput(),
        completed_at: "",
        description: "",
        technician: "",
        cost_amount: "",
        notes: "",
      }));
    }
  }

  async function submitInspection(event) {
    event.preventDefault();
    if (!canManageInspection) {
      setError("Your account cannot record inspections.");
      return;
    }
    const saved = await runDetailAction(
      (assetId) =>
        axiosClient.post(`/fleet/assets/${assetId}/inspections`, {
          ...inspectionForm,
          meter_reading:
            inspectionForm.meter_reading === ""
              ? null
              : Number(inspectionForm.meter_reading),
        }),
      "Inspection recorded."
    );

    if (saved) {
      setInspectionForm((current) => ({
        ...current,
        inspection_datetime: nowLocalInput(),
        findings: "",
        action_required: "",
      }));
    }
  }

  async function archiveAsset(asset) {
    if (!canManageAssets) {
      setError("Your account cannot archive or restore Fleet assets.");
      return;
    }
    const reason = window.prompt(
      `${asset.is_active ? "Archive" : "Reactivate"} ${asset.asset_code}. Enter the reason:`
    );

    if (!reason?.trim()) return;

    setSaving(true);
    setError("");

    try {
      const response = await axiosClient.patch(`/fleet/assets/${asset.id}/active`, {
        is_active: !asset.is_active,
        reason: reason.trim(),
      });
      setSuccess(response.data.message || "Equipment activity status changed.");
      await loadFleet();
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Unable to archive the equipment record."));
    } finally {
      setSaving(false);
    }
  }

  const selectedAsset = assetDetail?.asset || null;

  return (
    <div className="fleet-page">
      <section className="fleet-hero">
        <div>
          <span className="fleet-eyebrow">CHALIN 03 GROUP OPERATIONS</span>
          <h1>Shared Fleet & Equipment Register</h1>
          <p>
            One source of truth for excavators, mining machines, hire equipment,
            meters, fuel, maintenance and inspections.
          </p>
        </div>
        <div className="fleet-hero-actions">
          <button type="button" className="fleet-button fleet-button-light" onClick={loadFleet}>
            ↻ Refresh
          </button>
          {canManageAssets ? (
            <button type="button" className="fleet-button fleet-button-gold" onClick={openCreateAsset}>
              ＋ Add Equipment
            </button>
          ) : null}
        </div>
      </section>

      {error ? <div className="fleet-alert fleet-alert-error">{error}</div> : null}
      {success ? <div className="fleet-alert fleet-alert-success">{success}</div> : null}

      {!canEdit ? (
        <div className="fleet-alert fleet-alert-info">
          Read-only view: you can review fleet records and histories, but this
          account cannot create or change Fleet records.
        </div>
      ) : null}

      <section className="fleet-summary-grid">
        {summaryCards.map((card) => (
          <article key={card.label} className={`fleet-summary-card fleet-tone-${card.tone}`}>
            <div className="fleet-summary-icon">{card.icon}</div>
            <div>
              <span>{card.label}</span>
              <strong>{card.value.toLocaleString()}</strong>
            </div>
          </article>
        ))}
      </section>

      <section className="fleet-panel">
        <div className="fleet-panel-heading">
          <div>
            <span className="fleet-kicker">CONTROL DESK</span>
            <h2>Equipment Register</h2>
            <p>{assets.length} record{assets.length === 1 ? "" : "s"} currently shown.</p>
          </div>
        </div>

        <div className="fleet-filter-grid">
          <label className="fleet-field fleet-field-search">
            <span>Search equipment</span>
            <input
              value={filters.search}
              onChange={(event) => updateFilter("search", event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") loadFleet();
              }}
              placeholder="Code, name, model, registration, location or operator"
            />
          </label>

          <label className="fleet-field">
            <span>Status</span>
            <select
              value={filters.status}
              onChange={(event) => updateFilter("status", event.target.value)}
            >
              <option value="">All statuses</option>
              {STATUS_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>

          <label className="fleet-field">
            <span>Equipment type</span>
            <select
              value={filters.type}
              onChange={(event) => updateFilter("type", event.target.value)}
            >
              <option value="">All types</option>
              {assetTypes.map((type) => (
                <option key={type} value={type}>{formatLabel(type)}</option>
              ))}
            </select>
          </label>

          {isAdmin ? (
            <label className="fleet-checkbox-field">
              <input
                type="checkbox"
                checked={filters.include_inactive}
                onChange={(event) => updateFilter("include_inactive", event.target.checked)}
              />
              <span>Include archived</span>
            </label>
          ) : null}

          <div className="fleet-filter-actions">
            <button type="button" className="fleet-button fleet-button-primary" onClick={loadFleet}>
              Apply Filters
            </button>
            <button type="button" className="fleet-button fleet-button-muted" onClick={resetFilters}>
              Clear
            </button>
          </div>
        </div>

        {loading ? (
          <div className="fleet-loading">Loading the shared fleet register…</div>
        ) : assets.length === 0 ? (
          <EmptyState
            title="No equipment found"
            description={
              filters.search || filters.status || filters.type
                ? "Clear or change the filters to search again."
                : "Register the first excavator or heavy-equipment asset to begin."
            }
          />
        ) : (
          <>
            <div className="fleet-table-wrap">
              <table className="fleet-table">
                <thead>
                  <tr>
                    <th>Equipment</th>
                    <th>Status</th>
                    <th>Location / Operator</th>
                    <th>Current Meter</th>
                    <th>Service</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {assets.map((asset) => (
                    <tr key={asset.id} className={!asset.is_active ? "fleet-row-archived" : ""}>
                      <td>
                        <div className="fleet-asset-identity">
                          <div className="fleet-machine-icon">🚜</div>
                          <div>
                            <strong>{asset.asset_name}</strong>
                            <span>{asset.asset_code} · {formatLabel(asset.asset_type)}</span>
                            <small>
                              {[asset.make, asset.model, asset.registration_number]
                                .filter(Boolean)
                                .join(" · ") || "Details not yet supplied"}
                            </small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={statusClass(asset.current_status)}>
                          {formatLabel(asset.current_status)}
                        </span>
                        {!asset.is_active ? <span className="fleet-archived-label">Archived</span> : null}
                      </td>
                      <td>
                        <strong className="fleet-table-primary">{asset.current_location || "Not assigned"}</strong>
                        <span className="fleet-table-secondary">{asset.assigned_operator_name || "No operator assigned"}</span>
                      </td>
                      <td>
                        <strong className="fleet-meter-value">{formatNumber(asset.current_meter)}</strong>
                        <span className="fleet-table-secondary">{formatLabel(asset.meter_type)}</span>
                      </td>
                      <td>
                        {asset.service_due ? (
                          <span className="fleet-warning-chip">Service due</span>
                        ) : (
                          <span className="fleet-ok-chip">On schedule</span>
                        )}
                        <span className="fleet-table-secondary">
                          Next: {asset.next_service_meter ? formatNumber(asset.next_service_meter) : "Not set"}
                        </span>
                        {asset.document_expiry_warning ? (
                          <span className="fleet-document-warning">Document expiry near</span>
                        ) : null}
                      </td>
                      <td>
                        <div className="fleet-action-row">
                          <button type="button" className="fleet-small-button fleet-small-primary" onClick={() => loadAssetDetail(asset.id)}>
                            View
                          </button>
                          {canManageAssets ? (
                            <button type="button" className="fleet-small-button" onClick={() => openEditAsset(asset)}>
                              Edit
                            </button>
                          ) : null}
                          {isAdmin ? (
                            <button type="button" className="fleet-small-button fleet-small-danger" onClick={() => archiveAsset(asset)} disabled={saving}>
                              {asset.is_active ? "Archive" : "Restore"}
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="fleet-mobile-list">
              {assets.map((asset) => (
                <article key={asset.id} className={`fleet-mobile-card ${!asset.is_active ? "fleet-mobile-card-archived" : ""}`}>
                  <div className="fleet-mobile-card-head">
                    <div className="fleet-asset-identity">
                      <div className="fleet-machine-icon">🚜</div>
                      <div>
                        <strong>{asset.asset_name}</strong>
                        <span>{asset.asset_code} · {formatLabel(asset.asset_type)}</span>
                      </div>
                    </div>
                    <span className={statusClass(asset.current_status)}>
                      {formatLabel(asset.current_status)}
                    </span>
                  </div>
                  <div className="fleet-mobile-facts">
                    <div><span>Location</span><strong>{asset.current_location || "Not assigned"}</strong></div>
                    <div><span>Operator</span><strong>{asset.assigned_operator_name || "Not assigned"}</strong></div>
                    <div><span>Meter</span><strong>{formatNumber(asset.current_meter)} {formatLabel(asset.meter_type)}</strong></div>
                    <div><span>Service</span><strong>{asset.service_due ? "Due now" : asset.next_service_meter ? `At ${formatNumber(asset.next_service_meter)}` : "Not set"}</strong></div>
                  </div>
                  <div className="fleet-action-row">
                    <button type="button" className="fleet-small-button fleet-small-primary" onClick={() => loadAssetDetail(asset.id)}>View</button>
                    {canManageAssets ? <button type="button" className="fleet-small-button" onClick={() => openEditAsset(asset)}>Edit</button> : null}
                    {isAdmin ? <button type="button" className="fleet-small-button fleet-small-danger" onClick={() => archiveAsset(asset)}>{asset.is_active ? "Archive" : "Restore"}</button> : null}
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </section>

      {assetModalOpen ? (
        <Modal
          title={editingAssetId ? "Edit Equipment" : "Register Equipment"}
          subtitle="Shared by Mining Operations and Equipment Hire."
          onClose={() => setAssetModalOpen(false)}
          wide
        >
          <form className="fleet-form" onSubmit={saveAsset}>
            <div className="fleet-form-section">
              <div className="fleet-form-section-heading">
                <h3>Equipment Identity</h3>
                <p>Use a permanent asset code that staff can recognize.</p>
              </div>
              <div className="fleet-form-grid fleet-form-grid-3">
                <label className="fleet-field">
                  <span>Asset code *</span>
                  <input value={assetForm.asset_code} onChange={(event) => updateAssetForm("asset_code", event.target.value.toUpperCase())} placeholder="EXC-001" required />
                </label>
                <label className="fleet-field">
                  <span>Asset name *</span>
                  <input value={assetForm.asset_name} onChange={(event) => updateAssetForm("asset_name", event.target.value)} placeholder="CAT Excavator 1" required />
                </label>
                <label className="fleet-field">
                  <span>Equipment type *</span>
                  <select value={assetForm.asset_type} onChange={(event) => updateAssetForm("asset_type", event.target.value)}>
                    {ASSET_TYPE_OPTIONS.map((type) => <option key={type} value={type}>{formatLabel(type)}</option>)}
                  </select>
                </label>
                <label className="fleet-field"><span>Make</span><input value={assetForm.make} onChange={(event) => updateAssetForm("make", event.target.value)} placeholder="Caterpillar" /></label>
                <label className="fleet-field"><span>Model</span><input value={assetForm.model} onChange={(event) => updateAssetForm("model", event.target.value)} placeholder="320D" /></label>
                <label className="fleet-field"><span>Serial number</span><input value={assetForm.serial_number} onChange={(event) => updateAssetForm("serial_number", event.target.value)} /></label>
                <label className="fleet-field"><span>Registration number</span><input value={assetForm.registration_number} onChange={(event) => updateAssetForm("registration_number", event.target.value)} /></label>
                <label className="fleet-field">
                  <span>Ownership</span>
                  <select value={assetForm.ownership_type} onChange={(event) => updateAssetForm("ownership_type", event.target.value)}>
                    {OWNERSHIP_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <label className="fleet-field">
                  <span>Current status</span>
                  <select value={assetForm.current_status} onChange={(event) => updateAssetForm("current_status", event.target.value)}>
                    {STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
              </div>
            </div>

            <div className="fleet-form-section">
              <div className="fleet-form-section-heading"><h3>Assignment & Meter</h3><p>Record its current position before Mining and Hire assignments begin.</p></div>
              <div className="fleet-form-grid fleet-form-grid-3">
                <label className="fleet-field"><span>Current location</span><input value={assetForm.current_location} onChange={(event) => updateAssetForm("current_location", event.target.value)} placeholder="Main Yard / Mining Site A" /></label>
                <label className="fleet-field"><span>Assigned operator</span><input value={assetForm.assigned_operator_name} onChange={(event) => updateAssetForm("assigned_operator_name", event.target.value)} /></label>
                <label className="fleet-field"><span>Fuel type</span><input value={assetForm.fuel_type} onChange={(event) => updateAssetForm("fuel_type", event.target.value)} placeholder="diesel" /></label>
                <label className="fleet-field"><span>Meter type</span><select value={assetForm.meter_type} onChange={(event) => updateAssetForm("meter_type", event.target.value)}><option value="hour_meter">Hour Meter</option><option value="odometer">Odometer</option></select></label>
                <label className="fleet-field"><span>Current meter *</span><input type="number" min="0" step="0.01" value={assetForm.current_meter} onChange={(event) => updateAssetForm("current_meter", event.target.value)} required /></label>
                <label className="fleet-field"><span>Service interval</span><input type="number" min="0" step="0.01" value={assetForm.service_interval} onChange={(event) => updateAssetForm("service_interval", event.target.value)} placeholder="500" /></label>
                <label className="fleet-field"><span>Next service meter</span><input type="number" min="0" step="0.01" value={assetForm.next_service_meter} onChange={(event) => updateAssetForm("next_service_meter", event.target.value)} /></label>
                <label className="fleet-field"><span>Insurance expiry</span><input type="date" value={assetForm.insurance_expiry} onChange={(event) => updateAssetForm("insurance_expiry", event.target.value)} /></label>
                <label className="fleet-field"><span>Registration expiry</span><input type="date" value={assetForm.registration_expiry} onChange={(event) => updateAssetForm("registration_expiry", event.target.value)} /></label>
              </div>
              <label className="fleet-field"><span>Notes</span><textarea rows="4" value={assetForm.notes} onChange={(event) => updateAssetForm("notes", event.target.value)} placeholder="Condition, attachments, ownership notes or special restrictions" /></label>
            </div>

            <div className="fleet-form-actions">
              <button type="button" className="fleet-button fleet-button-muted" onClick={() => setAssetModalOpen(false)}>Cancel</button>
              <button type="submit" className="fleet-button fleet-button-primary" disabled={saving}>{saving ? "Saving…" : editingAssetId ? "Save Changes" : "Register Equipment"}</button>
            </div>
          </form>
        </Modal>
      ) : null}

      {detailOpen ? (
        <Modal
          title={selectedAsset ? `${selectedAsset.asset_code} — ${selectedAsset.asset_name}` : "Equipment Details"}
          subtitle={selectedAsset ? `${formatLabel(selectedAsset.asset_type)} · ${selectedAsset.make || "Make not set"} ${selectedAsset.model || ""}` : "Loading equipment record…"}
          onClose={() => setDetailOpen(false)}
          wide
        >
          {detailLoading || !selectedAsset ? (
            <div className="fleet-loading">Loading equipment control record…</div>
          ) : (
            <div className="fleet-detail">
              <div className="fleet-detail-banner">
                <div>
                  <span className={statusClass(selectedAsset.current_status)}>{formatLabel(selectedAsset.current_status)}</span>
                  <h3>{selectedAsset.asset_name}</h3>
                  <p>{selectedAsset.current_location || "No location assigned"} · {selectedAsset.assigned_operator_name || "No operator assigned"}</p>
                </div>
                <div className="fleet-detail-meter">
                  <span>Current {formatLabel(selectedAsset.meter_type)}</span>
                  <strong>{formatNumber(selectedAsset.current_meter)}</strong>
                </div>
              </div>

              <div className="fleet-tabs" role="tablist">
                {["overview", "status", "meter", "fuel", "maintenance", "inspection", "history"].map((tab) => (
                  <button key={tab} type="button" className={detailTab === tab ? "active" : ""} onClick={() => setDetailTab(tab)}>
                    {formatLabel(tab)}
                  </button>
                ))}
              </div>

              {detailTab === "overview" ? (
                <div className="fleet-detail-grid">
                  {[
                    ["Asset code", selectedAsset.asset_code],
                    ["Equipment type", formatLabel(selectedAsset.asset_type)],
                    ["Make / model", [selectedAsset.make, selectedAsset.model].filter(Boolean).join(" ") || "—"],
                    ["Serial number", selectedAsset.serial_number || "—"],
                    ["Registration", selectedAsset.registration_number || "—"],
                    ["Ownership", formatLabel(selectedAsset.ownership_type)],
                    ["Fuel type", selectedAsset.fuel_type || "—"],
                    ["Service interval", selectedAsset.service_interval ? formatNumber(selectedAsset.service_interval) : "—"],
                    ["Next service", selectedAsset.next_service_meter ? formatNumber(selectedAsset.next_service_meter) : "—"],
                    ["Insurance expiry", formatDate(selectedAsset.insurance_expiry)],
                    ["Registration expiry", formatDate(selectedAsset.registration_expiry)],
                    ["Last updated", formatDateTime(selectedAsset.updated_at)],
                  ].map(([label, value]) => (
                    <div key={label} className="fleet-detail-fact"><span>{label}</span><strong>{value}</strong></div>
                  ))}
                  <div className="fleet-detail-notes"><span>Notes</span><p>{selectedAsset.notes || "No equipment notes recorded."}</p></div>
                </div>
              ) : null}

              {detailTab === "status" ? (
                canManageStatus ? (
                  <form className="fleet-form fleet-compact-form" onSubmit={submitStatus}>
                    <div className="fleet-form-section-heading"><h3>Change Assignment Status</h3><p>This updates the equipment’s current operational position and creates an activity-log entry.</p></div>
                    <div className="fleet-form-grid fleet-form-grid-2">
                      <label className="fleet-field"><span>Status *</span><select value={statusForm.status} onChange={(event) => setStatusForm((current) => ({ ...current, status: event.target.value }))}>{STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                      <label className="fleet-field"><span>Current location</span><input value={statusForm.current_location} onChange={(event) => setStatusForm((current) => ({ ...current, current_location: event.target.value }))} /></label>
                      <label className="fleet-field"><span>Assigned operator</span><input value={statusForm.assigned_operator_name} onChange={(event) => setStatusForm((current) => ({ ...current, assigned_operator_name: event.target.value }))} /></label>
                      <label className="fleet-field"><span>Reason / assignment note</span><input value={statusForm.reason} onChange={(event) => setStatusForm((current) => ({ ...current, reason: event.target.value }))} placeholder="Why is the status changing?" /></label>
                    </div>
                    <div className="fleet-form-actions"><button className="fleet-button fleet-button-primary" disabled={saving}>{saving ? "Saving…" : "Update Status"}</button></div>
                  </form>
                ) : <EmptyState title="Read-only access" description="This account cannot change equipment status." />
              ) : null}

              {detailTab === "meter" ? (
                canManageMeter ? (
                  <form className="fleet-form fleet-compact-form" onSubmit={submitMeter}>
                    <div className="fleet-form-section-heading"><h3>Record Meter Reading</h3><p>Lower readings are protected. Only an administrator can enter a correction, and a reason is compulsory.</p></div>
                    <div className="fleet-form-grid fleet-form-grid-2">
                      <label className="fleet-field"><span>Reading *</span><input type="number" min="0" step="0.01" value={meterForm.reading_value} onChange={(event) => setMeterForm((current) => ({ ...current, reading_value: event.target.value }))} required /></label>
                      <label className="fleet-field"><span>Date and time *</span><input type="datetime-local" value={meterForm.reading_datetime} onChange={(event) => setMeterForm((current) => ({ ...current, reading_datetime: event.target.value }))} required /></label>
                      <label className="fleet-field"><span>Source</span><select value={meterForm.source_type} onChange={(event) => setMeterForm((current) => ({ ...current, source_type: event.target.value }))}><option value="manual">Manual Check</option><option value="daily_log">Daily Log</option><option value="dispatch">Dispatch</option><option value="return">Return</option><option value="service">Service</option></select></label>
                      <label className="fleet-field"><span>Correction reason</span><input value={meterForm.correction_reason} onChange={(event) => setMeterForm((current) => ({ ...current, correction_reason: event.target.value }))} placeholder="Required only when lowering the meter" /></label>
                    </div>
                    <label className="fleet-field"><span>Notes</span><textarea rows="3" value={meterForm.notes} onChange={(event) => setMeterForm((current) => ({ ...current, notes: event.target.value }))} /></label>
                    <div className="fleet-form-actions"><button className="fleet-button fleet-button-primary" disabled={saving}>{saving ? "Saving…" : "Record Meter"}</button></div>
                  </form>
                ) : <EmptyState title="Read-only access" description="This account cannot record meter readings." />
              ) : null}

              {detailTab === "fuel" ? (
                canManageFuel ? (
                  <form className="fleet-form fleet-compact-form" onSubmit={submitFuel}>
                    <div className="fleet-form-section-heading"><h3>Record Fuel Entry</h3><p>Capture litres, meter and cost now; mining-site and hire-contract allocation will be linked in later phases.</p></div>
                    <div className="fleet-form-grid fleet-form-grid-3">
                      <label className="fleet-field"><span>Quantity (litres) *</span><input type="number" min="0.01" step="0.01" value={fuelForm.quantity_litres} onChange={(event) => setFuelForm((current) => ({ ...current, quantity_litres: event.target.value }))} required /></label>
                      <label className="fleet-field"><span>Meter reading</span><input type="number" min="0" step="0.01" value={fuelForm.meter_reading} onChange={(event) => setFuelForm((current) => ({ ...current, meter_reading: event.target.value }))} /></label>
                      <label className="fleet-field"><span>Date and time *</span><input type="datetime-local" value={fuelForm.log_datetime} onChange={(event) => setFuelForm((current) => ({ ...current, log_datetime: event.target.value }))} required /></label>
                      <label className="fleet-field"><span>Source / supplier</span><input value={fuelForm.supplier_or_source} onChange={(event) => setFuelForm((current) => ({ ...current, supplier_or_source: event.target.value }))} /></label>
                      <label className="fleet-field"><span>Reference</span><input value={fuelForm.reference_number} onChange={(event) => setFuelForm((current) => ({ ...current, reference_number: event.target.value }))} /></label>
                      <label className="fleet-field"><span>Cost amount</span><input type="number" min="0" step="0.01" value={fuelForm.cost_amount} onChange={(event) => setFuelForm((current) => ({ ...current, cost_amount: event.target.value }))} /></label>
                    </div>
                    <label className="fleet-field"><span>Notes</span><textarea rows="3" value={fuelForm.notes} onChange={(event) => setFuelForm((current) => ({ ...current, notes: event.target.value }))} /></label>
                    <div className="fleet-form-actions"><button className="fleet-button fleet-button-primary" disabled={saving}>{saving ? "Saving…" : "Record Fuel"}</button></div>
                  </form>
                ) : <EmptyState title="Read-only access" description="This account cannot record fuel entries." />
              ) : null}

              {detailTab === "maintenance" ? (
                canManageMaintenance ? (
                  <form className="fleet-form fleet-compact-form" onSubmit={submitMaintenance}>
                    <div className="fleet-form-section-heading"><h3>Maintenance or Breakdown Record</h3><p>Open records automatically place the machine in Maintenance or Breakdown status. Completed records return it to Available.</p></div>
                    <div className="fleet-form-grid fleet-form-grid-3">
                      <label className="fleet-field"><span>Type *</span><select value={maintenanceForm.maintenance_type} onChange={(event) => setMaintenanceForm((current) => ({ ...current, maintenance_type: event.target.value }))}><option value="service">Scheduled Service</option><option value="repair">Repair</option><option value="breakdown">Breakdown</option><option value="inspection_action">Inspection Action</option><option value="tyre_or_track">Tyre / Track</option><option value="other">Other</option></select></label>
                      <label className="fleet-field"><span>Status *</span><select value={maintenanceForm.status} onChange={(event) => setMaintenanceForm((current) => ({ ...current, status: event.target.value }))}><option value="open">Open</option><option value="in_progress">In Progress</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></label>
                      <label className="fleet-field"><span>Reported date/time *</span><input type="datetime-local" value={maintenanceForm.reported_at} onChange={(event) => setMaintenanceForm((current) => ({ ...current, reported_at: event.target.value }))} required /></label>
                      <label className="fleet-field"><span>Completed date/time</span><input type="datetime-local" value={maintenanceForm.completed_at} onChange={(event) => setMaintenanceForm((current) => ({ ...current, completed_at: event.target.value }))} /></label>
                      <label className="fleet-field"><span>Meter reading</span><input type="number" min="0" step="0.01" value={maintenanceForm.meter_reading} onChange={(event) => setMaintenanceForm((current) => ({ ...current, meter_reading: event.target.value }))} /></label>
                      <label className="fleet-field"><span>Technician</span><input value={maintenanceForm.technician} onChange={(event) => setMaintenanceForm((current) => ({ ...current, technician: event.target.value }))} /></label>
                      <label className="fleet-field"><span>Cost</span><input type="number" min="0" step="0.01" value={maintenanceForm.cost_amount} onChange={(event) => setMaintenanceForm((current) => ({ ...current, cost_amount: event.target.value }))} /></label>
                      <label className="fleet-field"><span>Next service meter</span><input type="number" min="0" step="0.01" value={maintenanceForm.next_service_meter} onChange={(event) => setMaintenanceForm((current) => ({ ...current, next_service_meter: event.target.value }))} /></label>
                    </div>
                    <label className="fleet-field"><span>Description *</span><textarea rows="4" value={maintenanceForm.description} onChange={(event) => setMaintenanceForm((current) => ({ ...current, description: event.target.value }))} required /></label>
                    <label className="fleet-field"><span>Notes</span><textarea rows="3" value={maintenanceForm.notes} onChange={(event) => setMaintenanceForm((current) => ({ ...current, notes: event.target.value }))} /></label>
                    <div className="fleet-form-actions"><button className="fleet-button fleet-button-primary" disabled={saving}>{saving ? "Saving…" : "Save Maintenance"}</button></div>
                  </form>
                ) : <EmptyState title="Read-only access" description="This account cannot record maintenance." />
              ) : null}

              {detailTab === "inspection" ? (
                canManageInspection ? (
                  <form className="fleet-form fleet-compact-form" onSubmit={submitInspection}>
                    <div className="fleet-form-section-heading"><h3>Inspection Record</h3><p>An Unsafe or Out of Service condition automatically places the machine in Maintenance status.</p></div>
                    <div className="fleet-form-grid fleet-form-grid-3">
                      <label className="fleet-field"><span>Inspection type *</span><select value={inspectionForm.inspection_type} onChange={(event) => setInspectionForm((current) => ({ ...current, inspection_type: event.target.value }))}><option value="routine">Routine</option><option value="pre_dispatch">Pre-Dispatch</option><option value="return">Return</option><option value="daily">Daily</option><option value="safety">Safety</option><option value="other">Other</option></select></label>
                      <label className="fleet-field"><span>Condition *</span><select value={inspectionForm.condition_status} onChange={(event) => setInspectionForm((current) => ({ ...current, condition_status: event.target.value }))}><option value="good">Good</option><option value="attention">Needs Attention</option><option value="unsafe">Unsafe</option><option value="out_of_service">Out of Service</option></select></label>
                      <label className="fleet-field"><span>Date/time *</span><input type="datetime-local" value={inspectionForm.inspection_datetime} onChange={(event) => setInspectionForm((current) => ({ ...current, inspection_datetime: event.target.value }))} required /></label>
                      <label className="fleet-field"><span>Meter reading</span><input type="number" min="0" step="0.01" value={inspectionForm.meter_reading} onChange={(event) => setInspectionForm((current) => ({ ...current, meter_reading: event.target.value }))} /></label>
                      <label className="fleet-field"><span>Inspected by</span><input value={inspectionForm.inspected_by_name} onChange={(event) => setInspectionForm((current) => ({ ...current, inspected_by_name: event.target.value }))} /></label>
                    </div>
                    <label className="fleet-field"><span>Findings</span><textarea rows="4" value={inspectionForm.findings} onChange={(event) => setInspectionForm((current) => ({ ...current, findings: event.target.value }))} /></label>
                    <label className="fleet-field"><span>Action required</span><textarea rows="3" value={inspectionForm.action_required} onChange={(event) => setInspectionForm((current) => ({ ...current, action_required: event.target.value }))} /></label>
                    <div className="fleet-form-actions"><button className="fleet-button fleet-button-primary" disabled={saving}>{saving ? "Saving…" : "Save Inspection"}</button></div>
                  </form>
                ) : <EmptyState title="Read-only access" description="This account cannot record inspections." />
              ) : null}

              {detailTab === "history" ? (
                <div className="fleet-history-grid">
                  <section className="fleet-history-section">
                    <h3>Meter Readings</h3>
                    {(assetDetail.meter_readings || []).length ? (assetDetail.meter_readings || []).map((item) => (
                      <article key={`meter-${item.id}`} className="fleet-history-item">
                        <div><strong>{formatNumber(item.reading_value)}</strong><span>{formatLabel(item.source_type)}</span></div>
                        <time>{formatDateTime(item.reading_datetime)}</time>
                        {item.is_correction ? <p className="fleet-history-warning">Correction: {item.correction_reason}</p> : item.notes ? <p>{item.notes}</p> : null}
                      </article>
                    )) : <p className="fleet-history-empty">No meter history.</p>}
                  </section>

                  <section className="fleet-history-section">
                    <h3>Fuel Logs</h3>
                    {(assetDetail.fuel_logs || []).length ? (assetDetail.fuel_logs || []).map((item) => (
                      <article key={`fuel-${item.id}`} className="fleet-history-item">
                        <div><strong>{formatNumber(item.quantity_litres)} L</strong><span>{formatMoney(item.cost_amount)}</span></div>
                        <time>{formatDateTime(item.log_datetime)}</time>
                        <p>{item.supplier_or_source || "Source not recorded"}{item.reference_number ? ` · ${item.reference_number}` : ""}</p>
                      </article>
                    )) : <p className="fleet-history-empty">No fuel history.</p>}
                  </section>

                  <section className="fleet-history-section">
                    <h3>Maintenance</h3>
                    {(assetDetail.maintenance_records || []).length ? (assetDetail.maintenance_records || []).map((item) => (
                      <article key={`maintenance-${item.id}`} className="fleet-history-item">
                        <div><strong>{formatLabel(item.maintenance_type)}</strong><span>{formatLabel(item.status)}</span></div>
                        <time>{formatDateTime(item.reported_at)}</time>
                        <p>{item.description}</p>
                        <small>{item.technician || "Technician not set"} · {formatMoney(item.cost_amount)}</small>
                      </article>
                    )) : <p className="fleet-history-empty">No maintenance history.</p>}
                  </section>

                  <section className="fleet-history-section">
                    <h3>Inspections</h3>
                    {(assetDetail.inspections || []).length ? (assetDetail.inspections || []).map((item) => (
                      <article key={`inspection-${item.id}`} className="fleet-history-item">
                        <div><strong>{formatLabel(item.inspection_type)}</strong><span>{formatLabel(item.condition_status)}</span></div>
                        <time>{formatDateTime(item.inspection_datetime)}</time>
                        <p>{item.findings || "No findings recorded."}</p>
                        {item.action_required ? <small>Action: {item.action_required}</small> : null}
                      </article>
                    )) : <p className="fleet-history-empty">No inspection history.</p>}
                  </section>
                </div>
              ) : null}
            </div>
          )}
        </Modal>
      ) : null}
    </div>
  );
}
