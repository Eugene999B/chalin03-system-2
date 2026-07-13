import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import axiosClient from "../api/axiosClient";
import "../styles/workspaceAdministration.css";

function apiMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

function label(value) {
  return String(value || "—")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
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

const emptyLocationForm = {
  id: null,
  code: "",
  name: "",
  location_type: "yard",
  address: "",
  phone: "",
  is_active: true,
};

function SummaryCard({ icon, label: cardLabel, value, detail }) {
  return (
    <article className="workspace-admin-summary-card">
      <span aria-hidden="true">{icon}</span>
      <div>
        <small>{cardLabel}</small>
        <strong>{value}</strong>
        <p>{detail}</p>
      </div>
    </article>
  );
}

function StaffAccessTable({ users, savingUserId, onToggle }) {
  return (
    <div className="workspace-admin-table-wrap">
      <table className="workspace-admin-table">
        <thead>
          <tr>
            <th>User</th>
            <th>System role</th>
            <th>Account</th>
            <th>Workspace access</th>
            <th>Control</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => {
            const disabled =
              user.automatic_access || !user.assignable || !Number(user.is_active);
            const isSaving = Number(savingUserId) === Number(user.id);

            return (
              <tr key={user.id}>
                <td data-label="User">
                  <strong>{user.full_name || user.username}</strong>
                  <span>@{user.username}</span>
                </td>
                <td data-label="System role">
                  <span className={`workspace-admin-role role-${user.role}`}>
                    {label(user.role)}
                  </span>
                </td>
                <td data-label="Account">
                  <span
                    className={`workspace-admin-status ${
                      Number(user.is_active) ? "is-active" : "is-inactive"
                    }`}
                  >
                    {Number(user.is_active) ? "Active" : "Disabled"}
                  </span>
                </td>
                <td data-label="Workspace access">
                  <strong>{user.effective_access ? "Allowed" : "Not allowed"}</strong>
                  <span>{user.access_reason}</span>
                </td>
                <td data-label="Control">
                  {user.automatic_access ? (
                    <span className="workspace-admin-auto">Automatic</span>
                  ) : user.assignable ? (
                    <button
                      type="button"
                      className={
                        user.effective_access
                          ? "workspace-admin-btn workspace-admin-btn--danger"
                          : "workspace-admin-btn workspace-admin-btn--primary"
                      }
                      disabled={disabled || isSaving}
                      onClick={() => onToggle(user, !user.effective_access)}
                    >
                      {isSaving
                        ? "Saving…"
                        : user.effective_access
                        ? "Revoke access"
                        : "Grant access"}
                    </button>
                  ) : (
                    <span className="workspace-admin-unavailable">Not supported</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MiningAdministration({ sites }) {
  return (
    <section className="workspace-admin-panel">
      <div className="workspace-admin-panel-heading">
        <div>
          <p>Mining structure</p>
          <h2>Administrator-created Mining sites</h2>
          <span>
            Mining sites are independent operational locations. Spare Parts stores are
            never copied into this list.
          </span>
        </div>
        <Link className="workspace-admin-btn workspace-admin-btn--primary" to="/mining/sites">
          Manage Mining Sites
        </Link>
      </div>

      {sites.length === 0 ? (
        <div className="workspace-admin-empty">
          <span aria-hidden="true">📍</span>
          <strong>No Mining sites created yet</strong>
          <p>Use Manage Mining Sites to create the first site as administrator.</p>
        </div>
      ) : (
        <div className="workspace-admin-location-grid">
          {sites.map((site) => (
            <article key={site.id} className="workspace-admin-location-card">
              <div>
                <span className="workspace-admin-code">{site.site_code}</span>
                <span
                  className={`workspace-admin-status ${
                    Number(site.is_active) && site.status === "active"
                      ? "is-active"
                      : "is-inactive"
                  }`}
                >
                  {Number(site.is_active) ? label(site.status) : "Inactive"}
                </span>
              </div>
              <h3>{site.site_name}</h3>
              <p>{site.location || "Location not recorded"}</p>
              <dl>
                <div>
                  <dt>Material</dt>
                  <dd>{site.material_type || "Not set"}</dd>
                </div>
                <div>
                  <dt>Manager</dt>
                  <dd>{site.manager_name || "Not assigned"}</dd>
                </div>
                <div>
                  <dt>Daily target</dt>
                  <dd>
                    {site.daily_target || "—"} {site.production_unit || ""}
                  </dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function HireLocationForm({ form, setForm, saving, onSubmit, onCancel }) {
  return (
    <form className="workspace-admin-form" onSubmit={onSubmit}>
      <div className="workspace-admin-form-heading">
        <div>
          <p>Equipment Hire structure</p>
          <h2>{form.id ? "Edit Hire location" : "Create Hire base or yard"}</h2>
          <span>
            These are Equipment Hire offices, yards, depots and workshops. They are
            not Spare Parts stores and do not appear in Spare Parts.
          </span>
        </div>
      </div>

      <div className="workspace-admin-form-grid">
        <label>
          <span>Location code</span>
          <input
            value={form.code}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                code: event.target.value.toUpperCase(),
              }))
            }
            placeholder="HIRE-YARD-01"
            maxLength={50}
            required
          />
        </label>

        <label>
          <span>Location name</span>
          <input
            value={form.name}
            onChange={(event) =>
              setForm((current) => ({ ...current, name: event.target.value }))
            }
            placeholder="Dunkwa Equipment Yard"
            maxLength={150}
            required
          />
        </label>

        <label>
          <span>Location type</span>
          <select
            value={form.location_type}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                location_type: event.target.value,
              }))
            }
          >
            <option value="yard">Equipment yard</option>
            <option value="office">Office</option>
            <option value="depot">Depot</option>
            <option value="workshop">Workshop</option>
            <option value="parking">Parking base</option>
            <option value="other">Other</option>
          </select>
        </label>

        <label>
          <span>Phone</span>
          <input
            value={form.phone}
            onChange={(event) =>
              setForm((current) => ({ ...current, phone: event.target.value }))
            }
            placeholder="0240000000"
            maxLength={50}
          />
        </label>

        <label className="workspace-admin-form-wide">
          <span>Address or location description</span>
          <textarea
            value={form.address}
            onChange={(event) =>
              setForm((current) => ({ ...current, address: event.target.value }))
            }
            placeholder="Town, landmark and directions"
            maxLength={255}
            rows={3}
          />
        </label>

        <label className="workspace-admin-check workspace-admin-form-wide">
          <input
            type="checkbox"
            checked={Boolean(form.is_active)}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                is_active: event.target.checked,
              }))
            }
          />
          <span>This Hire location is active</span>
        </label>
      </div>

      <div className="workspace-admin-form-actions">
        {form.id ? (
          <button
            type="button"
            className="workspace-admin-btn workspace-admin-btn--ghost"
            onClick={onCancel}
          >
            Cancel edit
          </button>
        ) : null}
        <button
          type="submit"
          className="workspace-admin-btn workspace-admin-btn--primary"
          disabled={saving}
        >
          {saving
            ? "Saving…"
            : form.id
            ? "Update Hire location"
            : "Create Hire location"}
        </button>
      </div>
    </form>
  );
}

function HireLocations({ locations, onEdit }) {
  if (locations.length === 0) {
    return (
      <div className="workspace-admin-empty">
        <span aria-hidden="true">🏗️</span>
        <strong>No Equipment Hire locations created yet</strong>
        <p>Create the first office, yard, depot or workshop above.</p>
      </div>
    );
  }

  return (
    <div className="workspace-admin-location-grid">
      {locations.map((location) => (
        <article key={location.id} className="workspace-admin-location-card">
          <div>
            <span className="workspace-admin-code">{location.code}</span>
            <span
              className={`workspace-admin-status ${
                Number(location.is_active) ? "is-active" : "is-inactive"
              }`}
            >
              {Number(location.is_active) ? "Active" : "Inactive"}
            </span>
          </div>
          <h3>{location.name}</h3>
          <p>{location.address || "Address not recorded"}</p>
          <dl>
            <div>
              <dt>Type</dt>
              <dd>{label(location.location_type)}</dd>
            </div>
            <div>
              <dt>Phone</dt>
              <dd>{location.phone || "Not recorded"}</dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>{formatDateTime(location.updated_at)}</dd>
            </div>
          </dl>
          <button
            type="button"
            className="workspace-admin-btn workspace-admin-btn--ghost"
            onClick={() => onEdit(location)}
          >
            Edit location
          </button>
        </article>
      ))}
    </div>
  );
}


function ContextAccessMatrix({
  contexts,
  users,
  assignments,
  savingKey,
  onUpdate,
  isMining,
}) {
  const assignmentMap = useMemo(() => {
    const map = new Map();
    assignments.forEach((assignment) => {
      map.set(
        `${Number(assignment.user_id)}:${Number(assignment.context_id)}`,
        assignment
      );
    });
    return map;
  }, [assignments]);

  const visibleUsers = users.filter(
    (user) => user.automatic_access || user.assignable
  );

  if (contexts.length === 0) {
    return (
      <div className="workspace-admin-empty">
        <span aria-hidden="true">{isMining ? "📍" : "🏗️"}</span>
        <strong>
          {isMining
            ? "Create a Mining site before assigning staff"
            : "Create a Hire location before assigning staff"}
        </strong>
        <p>
          Site and location assignments become available after the administrator
          creates the first active operating location.
        </p>
      </div>
    );
  }

  return (
    <div className="workspace-context-matrix-wrap">
      <table className="workspace-context-matrix">
        <thead>
          <tr>
            <th>Employee</th>
            {contexts.map((context) => (
              <th key={context.id}>
                <strong>{context.code}</strong>
                <span>{context.name}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visibleUsers.map((user) => (
            <tr key={user.id}>
              <th>
                <strong>{user.full_name || user.username}</strong>
                <span>
                  {label(user.role)} · @{user.username}
                </span>
              </th>
              {contexts.map((context) => {
                const key = `${Number(user.id)}:${Number(context.id)}`;
                const assignment = assignmentMap.get(key);
                const hasAccess = Boolean(Number(assignment?.can_access));
                const isDefault = hasAccess && Boolean(Number(assignment?.is_default));
                const isSaving = savingKey === key;
                const workspaceAllowed = Boolean(user.effective_access);

                if (user.automatic_access) {
                  return (
                    <td key={context.id}>
                      <span className="workspace-context-auto">Automatic</span>
                    </td>
                  );
                }

                return (
                  <td key={context.id}>
                    {!workspaceAllowed ? (
                      <span className="workspace-context-blocked">
                        Grant workspace first
                      </span>
                    ) : (
                      <div className="workspace-context-cell-actions">
                        <button
                          type="button"
                          className={`workspace-context-access-toggle ${
                            hasAccess ? "is-on" : ""
                          }`}
                          disabled={isSaving || !Number(user.is_active)}
                          onClick={() =>
                            onUpdate(user, context, !hasAccess, false)
                          }
                        >
                          {isSaving
                            ? "Saving…"
                            : hasAccess
                            ? "Assigned"
                            : "Assign"}
                        </button>
                        {hasAccess ? (
                          <button
                            type="button"
                            className={`workspace-context-default-toggle ${
                              isDefault ? "is-default" : ""
                            }`}
                            disabled={isSaving || isDefault}
                            onClick={() =>
                              onUpdate(user, context, true, true)
                            }
                          >
                            {isDefault ? "Default" : "Make default"}
                          </button>
                        ) : null}
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function WorkspaceAdministrationPage({ workspace }) {
  const isMining = workspace === "mining";
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [savingUserId, setSavingUserId] = useState(null);
  const [savingLocation, setSavingLocation] = useState(false);
  const [locationForm, setLocationForm] = useState(emptyLocationForm);
  const [contextAccess, setContextAccess] = useState({
    contexts: [],
    assignments: [],
    users: [],
  });
  const [savingContextKey, setSavingContextKey] = useState("");

  const title = isMining ? "Mining Administration" : "Equipment Hire Administration";

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const [overviewResponse, contextResponse] = await Promise.all([
        axiosClient.get("/workspace-admin/overview"),
        axiosClient.get("/workspace-admin/context-access"),
      ]);
      setData(overviewResponse.data);
      setContextAccess({
        contexts: contextResponse.data?.contexts || [],
        assignments: contextResponse.data?.assignments || [],
        users: contextResponse.data?.users || [],
      });
    } catch (requestError) {
      setError(
        apiMessage(requestError, "Could not load workspace administration.")
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  const users = useMemo(() => data?.users || [], [data]);
  const locations = useMemo(() => data?.locations || [], [data]);
  const sites = useMemo(() => data?.sites || [], [data]);

  function showSuccess(message) {
    setSuccess(message);
    setError("");
    window.setTimeout(() => setSuccess(""), 4500);
  }

  async function toggleAccess(user, canAccess) {
    const action = canAccess ? "grant" : "revoke";
    const confirmed = window.confirm(
      `Are you sure you want to ${action} ${title.replace(
        " Administration",
        ""
      )} access for ${user.full_name || user.username}?`
    );

    if (!confirmed) return;

    setSavingUserId(user.id);
    setError("");

    try {
      const response = await axiosClient.put(
        `/workspace-admin/users/${user.id}/access`,
        { can_access: canAccess }
      );
      showSuccess(response.data.message || "Workspace access updated.");
      await loadOverview();
    } catch (requestError) {
      setError(apiMessage(requestError, "Could not update workspace access."));
    } finally {
      setSavingUserId(null);
    }
  }


  async function updateContextAccess(user, context, canAccess, isDefault) {
    const action = canAccess
      ? isDefault
        ? "make this the default assignment"
        : "assign this location"
      : "remove this assignment";
    const confirmed = window.confirm(
      `Do you want to ${action} for ${user.full_name || user.username}?`
    );

    if (!confirmed) return;

    const key = `${Number(user.id)}:${Number(context.id)}`;
    setSavingContextKey(key);
    setError("");

    try {
      const response = await axiosClient.put(
        `/workspace-admin/users/${user.id}/contexts/${context.id}`,
        {
          can_access: canAccess,
          is_default: isDefault,
        }
      );
      showSuccess(response.data?.message || "Location assignment updated.");
      await loadOverview();
    } catch (requestError) {
      setError(
        apiMessage(requestError, "Could not update the site or location assignment.")
      );
    } finally {
      setSavingContextKey("");
    }
  }

  function editLocation(location) {
    setLocationForm({
      id: location.id,
      code: location.code || "",
      name: location.name || "",
      location_type: location.location_type || "yard",
      address: location.address || "",
      phone: location.phone || "",
      is_active: Boolean(location.is_active),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveLocation(event) {
    event.preventDefault();
    setSavingLocation(true);
    setError("");

    try {
      const response = locationForm.id
        ? await axiosClient.put(
            `/workspace-admin/locations/${locationForm.id}`,
            locationForm
          )
        : await axiosClient.post("/workspace-admin/locations", locationForm);

      showSuccess(response.data.message || "Hire location saved.");
      setLocationForm(emptyLocationForm);
      await loadOverview();
    } catch (requestError) {
      setError(apiMessage(requestError, "Could not save Hire location."));
    } finally {
      setSavingLocation(false);
    }
  }

  if (loading && !data) {
    return (
      <div className="workspace-admin-loading">
        <span>⏳</span>
        <strong>Loading {title}…</strong>
      </div>
    );
  }

  return (
    <div className={`workspace-admin-page ${isMining ? "is-mining" : "is-hire"}`}>
      <header className="workspace-admin-hero">
        <div>
          <p>{isMining ? "⛏️ Mining Operations" : "🚜 Equipment Hire"}</p>
          <h1>{title}</h1>
          <span>
            Create this business's own operating structure and control which staff
            accounts are allowed to enter it. Spare Parts branches remain completely
            separate.
          </span>
        </div>
        <button
          type="button"
          className="workspace-admin-btn workspace-admin-btn--light"
          onClick={loadOverview}
          disabled={loading}
        >
          {loading ? "Refreshing…" : "↻ Refresh"}
        </button>
      </header>

      {error ? <div className="workspace-admin-alert is-error">{error}</div> : null}
      {success ? (
        <div className="workspace-admin-alert is-success">{success}</div>
      ) : null}

      <section className="workspace-admin-summary">
        <SummaryCard
          icon="👥"
          label="Workspace users"
          value={data?.summary?.assigned_users || 0}
          detail={`${data?.summary?.assignable_users || 0} manager/auditor accounts can be assigned`}
        />
        <SummaryCard
          icon={isMining ? "📍" : "🏗️"}
          label={isMining ? "Active Mining sites" : "Active Hire locations"}
          value={
            isMining
              ? data?.summary?.active_sites || 0
              : data?.summary?.active_locations || 0
          }
          detail={
            isMining
              ? "Created only by an administrator"
              : "Offices, yards, depots and workshops"
          }
        />
        <SummaryCard
          icon="🛡️"
          label="Business separation"
          value="Protected"
          detail="No Spare Parts store is used in this workspace"
        />
      </section>

      {isMining ? (
        <MiningAdministration sites={sites} />
      ) : (
        <>
          <section className="workspace-admin-panel">
            <HireLocationForm
              form={locationForm}
              setForm={setLocationForm}
              saving={savingLocation}
              onSubmit={saveLocation}
              onCancel={() => setLocationForm(emptyLocationForm)}
            />
          </section>

          <section className="workspace-admin-panel">
            <div className="workspace-admin-panel-heading">
              <div>
                <p>Current Hire structure</p>
                <h2>Equipment Hire bases and yards</h2>
                <span>
                  These records belong only to Equipment Hire and are created by the
                  administrator.
                </span>
              </div>
            </div>
            <HireLocations locations={locations} onEdit={editLocation} />
          </section>
        </>
      )}

      <section className="workspace-admin-panel">
        <div className="workspace-admin-panel-heading">
          <div>
            <p>Operating-location assignments</p>
            <h2>
              {isMining ? "Employee Mining-site access" : "Employee Hire-location access"}
            </h2>
            <span>
              First grant business workspace access below, then assign each manager or
              auditor only to the sites or locations they are permitted to review.
              Administrators have automatic access to every active location.
            </span>
          </div>
        </div>

        <ContextAccessMatrix
          contexts={contextAccess.contexts}
          users={contextAccess.users.length ? contextAccess.users : users}
          assignments={contextAccess.assignments}
          savingKey={savingContextKey}
          onUpdate={updateContextAccess}
          isMining={isMining}
        />
      </section>

      <section className="workspace-admin-panel">
        <div className="workspace-admin-panel-heading">
          <div>
            <p>Staff control</p>
            <h2>Workspace access</h2>
            <span>
              Administrators have automatic access. Managers and auditors must be
              granted access here. Cashier accounts remain Spare Parts-only.
            </span>
          </div>
        </div>

        <StaffAccessTable
          users={users}
          savingUserId={savingUserId}
          onToggle={toggleAccess}
        />
      </section>
    </div>
  );
}
