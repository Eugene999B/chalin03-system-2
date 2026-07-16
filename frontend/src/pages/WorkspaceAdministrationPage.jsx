import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import "../styles/workspaceAdministration.css";

function apiMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

function label(value) {
  return String(value || "-")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatDateTime(value) {
  if (!value) return "-";
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

function toPositiveNumber(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function activeContext(context, isMining) {
  if (!Number(context?.is_active)) return false;
  return isMining ? context.status === "active" : true;
}

function isOriginalSystemAdministrator(user) {
  return (
    Number(user?.id) === 1 &&
    String(user?.username || "").toLowerCase() === "admin" &&
    String(user?.role || "").toLowerCase() === "admin"
  );
}

function strongPasswordError(password) {
  const text = String(password || "");

  if (text.length < 8) {
    return "Temporary password must be at least 8 characters.";
  }

  if (!/[a-z]/.test(text) || !/[A-Z]/.test(text)) {
    return "Temporary password must include uppercase and lowercase letters.";
  }

  if (!/\d/.test(text)) {
    return "Temporary password must include at least one number.";
  }

  if (!/[^A-Za-z0-9]/.test(text)) {
    return "Temporary password must include at least one symbol.";
  }

  return "";
}

function contextLabel(context) {
  return `${context.code || context.site_code || context.id} - ${
    context.name || context.site_name || "Unnamed"
  }`;
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

const emptyStaffForm = {
  id: null,
  full_name: "",
  username: "",
  phone: "",
  global_role: "staff",
  workspace_role: "",
  temporary_password: "",
  is_active: true,
  can_access: true,
  force_password_change: true,
  must_change_password: false,
  context_ids: [],
  default_context_id: "",
};

const emptyExistingForm = {
  user_id: "",
  query: "",
  workspace_role: "",
  context_ids: [],
  default_context_id: "",
};

const emptyPasswordResetForm = {
  temporary_password: "",
  confirm_password: "",
  force_password_change: true,
  show_passwords: false,
};

const GLOBAL_ROLE_OPTIONS = [
  { value: "staff", label: "Staff" },
  { value: "manager", label: "Manager" },
  { value: "auditor", label: "Auditor" },
  { value: "admin", label: "Administrator" },
];

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
          <span aria-hidden="true">Site</span>
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
                    {site.daily_target || "-"} {site.production_unit || ""}
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
            ? "Saving..."
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
        <span aria-hidden="true">Location</span>
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

function ContextPicker({
  contexts,
  selectedIds,
  defaultId,
  setForm,
  isMining,
  compact = false,
}) {
  const activeContexts = contexts.filter((context) => activeContext(context, isMining));

  function toggleContext(contextId, checked) {
    setForm((current) => {
      const currentIds = current.context_ids.map(Number);
      const nextIds = checked
        ? [...new Set([...currentIds, contextId])]
        : currentIds.filter((id) => id !== contextId);
      const nextDefault =
        Number(current.default_context_id) === contextId && !checked
          ? ""
          : current.default_context_id;

      return {
        ...current,
        context_ids: nextIds,
        default_context_id: nextDefault,
      };
    });
  }

  function makeDefault(contextId) {
    setForm((current) => ({
      ...current,
      context_ids: [...new Set([...current.context_ids.map(Number), contextId])],
      default_context_id: contextId,
    }));
  }

  if (activeContexts.length === 0) {
    return (
      <div className="workspace-admin-empty workspace-admin-empty--compact">
        <strong>{isMining ? "No active Mining sites" : "No active Hire locations"}</strong>
        <p>Create an active location before assigning staff to it.</p>
      </div>
    );
  }

  return (
    <div
      className={
        compact
          ? "workspace-staff-context-list is-compact"
          : "workspace-staff-context-list"
      }
    >
      {activeContexts.map((context) => {
        const contextId = Number(context.id);
        const assigned = selectedIds.map(Number).includes(contextId);
        const isDefault = Number(defaultId) === contextId;

        return (
          <div key={context.id} className="workspace-staff-context-row">
            <label className="workspace-admin-check">
              <input
                type="checkbox"
                checked={assigned}
                onChange={(event) => toggleContext(contextId, event.target.checked)}
              />
              <span>{contextLabel(context)}</span>
            </label>

            <button
              type="button"
              className={`workspace-context-default-toggle ${
                isDefault ? "is-default" : ""
              }`}
              disabled={!assigned || isDefault}
              onClick={() => makeDefault(contextId)}
            >
              {isDefault ? "Default" : "Make default"}
            </button>
          </div>
        );
      })}
    </div>
  );
}

function StaffEditorForm({
  form,
  setForm,
  saving,
  onSubmit,
  onCancel,
  workspaceRoles,
  contexts,
  isMining,
}) {
  return (
    <form className="workspace-admin-form workspace-staff-form" onSubmit={onSubmit}>
      <div className="workspace-admin-form-heading">
        <div>
          <p>Users & Staff</p>
          <h2>{form.id ? "Edit central user" : "Create central staff user"}</h2>
          <span>
            One central account can be granted Mining or Hire access without
            duplicating the person or touching Spare Parts branch access.
          </span>
        </div>
      </div>

      <div className="workspace-admin-form-grid">
        <label>
          <span>Full name</span>
          <input
            value={form.full_name}
            onChange={(event) =>
              setForm((current) => ({ ...current, full_name: event.target.value }))
            }
            placeholder="Employee full name"
            maxLength={150}
            required
          />
        </label>

        <label>
          <span>Username</span>
          <input
            value={form.username}
            onChange={(event) =>
              setForm((current) => ({ ...current, username: event.target.value }))
            }
            placeholder="unique.username"
            maxLength={80}
            required
          />
        </label>

        <label>
          <span>Phone</span>
          <input
            value={form.phone}
            onChange={(event) =>
              setForm((current) => ({ ...current, phone: event.target.value }))
            }
            placeholder="0240000000"
            maxLength={30}
          />
        </label>

        <label>
          <span>Global account class</span>
          <select
            value={form.global_role}
            onChange={(event) =>
              setForm((current) => ({ ...current, global_role: event.target.value }))
            }
          >
            {GLOBAL_ROLE_OPTIONS.map((role) => (
              <option key={role.value} value={role.value}>
                {role.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>{isMining ? "Mining role" : "Hire role"}</span>
          <select
            value={form.workspace_role}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                workspace_role: event.target.value,
              }))
            }
            required
          >
            {workspaceRoles.map((role) => (
              <option key={role} value={role}>
                {label(role)}
              </option>
            ))}
          </select>
        </label>

        {!form.id ? (
          <label>
            <span>Temporary password</span>
            <input
              type="password"
              value={form.temporary_password}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  temporary_password: event.target.value,
                }))
              }
              placeholder="8+ chars, upper/lower, number and symbol"
              minLength={8}
              autoComplete="new-password"
              required
            />
          </label>
        ) : null}

        <label className="workspace-admin-check">
          <input
            type="checkbox"
            checked={Boolean(form.is_active)}
            onChange={(event) =>
              setForm((current) => ({ ...current, is_active: event.target.checked }))
            }
          />
          <span>Account is active</span>
        </label>

        {form.id ? (
          <label className="workspace-admin-check">
            <input
              type="checkbox"
              checked={Boolean(form.can_access)}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  can_access: event.target.checked,
                }))
              }
            />
            <span>Can access this workspace</span>
          </label>
        ) : null}

        <label className="workspace-admin-check workspace-admin-form-wide">
          <input
            type="checkbox"
            checked={
              form.id
                ? Boolean(form.must_change_password)
                : Boolean(form.force_password_change)
            }
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                force_password_change: event.target.checked,
                must_change_password: event.target.checked,
              }))
            }
          />
          <span>Require password change at next login</span>
        </label>

        <div className="workspace-admin-form-wide">
          <span className="workspace-staff-field-label">
            {isMining ? "Assigned Mining sites" : "Assigned Hire locations"}
          </span>
          <ContextPicker
            contexts={contexts}
            selectedIds={form.context_ids}
            defaultId={form.default_context_id}
            setForm={setForm}
            isMining={isMining}
          />
        </div>
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
            ? "Saving..."
            : form.id
            ? "Update user"
            : "Create staff user"}
        </button>
      </div>
    </form>
  );
}

function ExistingUserAccessForm({
  form,
  setForm,
  eligibleUsers,
  saving,
  onSubmit,
  workspaceRoles,
  contexts,
  isMining,
}) {
  const filteredUsers = eligibleUsers.filter((user) => {
    const query = form.query.trim().toLowerCase();
    const haystack = `${user.full_name || ""} ${user.username || ""} ${
      user.phone || ""
    }`.toLowerCase();
    return !query || haystack.includes(query);
  });

  return (
    <form className="workspace-admin-form workspace-staff-existing-form" onSubmit={onSubmit}>
      <div className="workspace-admin-form-heading">
        <div>
          <p>Existing central user</p>
          <h2>Add user to this workspace</h2>
          <span>
            Grant access to a person who already has a central username. Their
            password and historical records remain unchanged.
          </span>
        </div>
      </div>

      <div className="workspace-admin-form-grid">
        <label>
          <span>Search</span>
          <input
            value={form.query}
            onChange={(event) =>
              setForm((current) => ({ ...current, query: event.target.value }))
            }
            placeholder="Name, username or phone"
          />
        </label>

        <label>
          <span>Central user</span>
          <select
            value={form.user_id}
            onChange={(event) =>
              setForm((current) => ({ ...current, user_id: event.target.value }))
            }
            required
          >
            <option value="">Choose user</option>
            {filteredUsers.map((user) => (
              <option key={user.id} value={user.id}>
                {user.full_name || user.username} (@{user.username}) - {label(user.role)}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>{isMining ? "Mining role" : "Hire role"}</span>
          <select
            value={form.workspace_role}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                workspace_role: event.target.value,
              }))
            }
            required
          >
            {workspaceRoles.map((role) => (
              <option key={role} value={role}>
                {label(role)}
              </option>
            ))}
          </select>
        </label>

        <div className="workspace-admin-form-wide">
          <span className="workspace-staff-field-label">
            {isMining ? "Assigned Mining sites" : "Assigned Hire locations"}
          </span>
          <ContextPicker
            contexts={contexts}
            selectedIds={form.context_ids}
            defaultId={form.default_context_id}
            setForm={setForm}
            isMining={isMining}
            compact
          />
        </div>
      </div>

      <div className="workspace-admin-form-actions">
        <button
          type="submit"
          className="workspace-admin-btn workspace-admin-btn--primary"
          disabled={saving || !form.user_id}
        >
          {saving ? "Adding..." : "Add to workspace"}
        </button>
      </div>
    </form>
  );
}


function PasswordResetModal({
  user,
  form,
  setForm,
  saving,
  error,
  onSubmit,
  onClose,
}) {
  if (!user) return null;

  return (
    <div
      className="workspace-staff-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <section
        className="workspace-staff-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-password-reset-title"
      >
        <div className="workspace-staff-modal-heading">
          <div>
            <p>Account security</p>
            <h2 id="workspace-password-reset-title">Reset temporary password</h2>
            <span>
              Set a temporary password for {user.full_name || user.username}. The
              old password will never be displayed.
            </span>
          </div>
          <button
            type="button"
            className="workspace-staff-modal-close"
            onClick={onClose}
            disabled={saving}
            aria-label="Close password reset"
          >
            ×
          </button>
        </div>

        <form onSubmit={onSubmit}>
          {error ? (
            <div className="workspace-admin-alert is-error">{error}</div>
          ) : null}

          <label>
            <span>Temporary password</span>
            <input
              type={form.show_passwords ? "text" : "password"}
              value={form.temporary_password}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  temporary_password: event.target.value,
                }))
              }
              minLength={8}
              autoComplete="new-password"
              required
              autoFocus
            />
          </label>

          <label>
            <span>Confirm temporary password</span>
            <input
              type={form.show_passwords ? "text" : "password"}
              value={form.confirm_password}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  confirm_password: event.target.value,
                }))
              }
              minLength={8}
              autoComplete="new-password"
              required
            />
          </label>

          <label className="workspace-admin-check">
            <input
              type="checkbox"
              checked={form.show_passwords}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  show_passwords: event.target.checked,
                }))
              }
            />
            <span>Show passwords while typing</span>
          </label>

          <label className="workspace-admin-check">
            <input
              type="checkbox"
              checked={form.force_password_change}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  force_password_change: event.target.checked,
                }))
              }
            />
            <span>Require password change at next login</span>
          </label>

          <div className="workspace-staff-modal-actions">
            <button
              type="button"
              className="workspace-admin-btn workspace-admin-btn--ghost"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="workspace-admin-btn workspace-admin-btn--primary"
              disabled={saving}
            >
              {saving ? "Resetting..." : "Reset password"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function getAssignmentsForUser(userId, assignments, contexts) {
  const contextMap = new Map(contexts.map((context) => [Number(context.id), context]));

  const assigned = assignments
    .filter(
      (assignment) =>
        Number(assignment.user_id) === Number(userId) &&
        Number(assignment.can_access)
    )
    .map((assignment) => ({
      ...assignment,
      context: contextMap.get(Number(assignment.context_id)),
    }))
    .filter((assignment) => assignment.context);

  const defaultAssignment = assigned.find((assignment) =>
    Number(assignment.is_default)
  );

  return { assigned, defaultAssignment };
}

function StaffDirectory({
  users,
  assignments,
  contexts,
  filters,
  setFilters,
  workspaceRoles,
  savingActionId,
  onEdit,
  onResetPassword,
  onStatusChange,
  onWorkspaceAccess,
  canResetAccounts,
}) {
  const filteredUsers = users.filter((user) => {
    const query = filters.query.trim().toLowerCase();
    const haystack = `${user.full_name || ""} ${user.username || ""} ${
      user.phone || ""
    } ${user.role || ""} ${user.workspace_role || ""}`.toLowerCase();
    const matchesQuery = !query || haystack.includes(query);
    const matchesStatus =
      filters.status === "all" ||
      (filters.status === "active" && Number(user.is_active)) ||
      (filters.status === "inactive" && !Number(user.is_active)) ||
      (filters.status === "password" && Boolean(user.must_change_password));
    const matchesRole =
      filters.workspace_role === "all" ||
      user.workspace_role === filters.workspace_role ||
      (filters.workspace_role === "automatic" && user.automatic_access);

    return matchesQuery && matchesStatus && matchesRole;
  });

  return (
    <div className="workspace-staff-directory">
      <div className="workspace-staff-filters">
        <label>
          <span>Search users</span>
          <input
            value={filters.query}
            onChange={(event) =>
              setFilters((current) => ({ ...current, query: event.target.value }))
            }
            placeholder="Name, username, phone or role"
          />
        </label>

        <label>
          <span>Status</span>
          <select
            value={filters.status}
            onChange={(event) =>
              setFilters((current) => ({ ...current, status: event.target.value }))
            }
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="password">Password change required</option>
          </select>
        </label>

        <label>
          <span>Workspace role</span>
          <select
            value={filters.workspace_role}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                workspace_role: event.target.value,
              }))
            }
          >
            <option value="all">All roles</option>
            <option value="automatic">Automatic admins</option>
            {workspaceRoles.map((role) => (
              <option key={role} value={role}>
                {label(role)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {filteredUsers.length === 0 ? (
        <div className="workspace-admin-empty">
          <strong>No users match this view</strong>
          <p>Create a staff account or clear the filters.</p>
        </div>
      ) : (
        <div className="workspace-staff-card-grid">
          {filteredUsers.map((user) => {
            const { assigned, defaultAssignment } = getAssignmentsForUser(
              user.id,
              assignments,
              contexts
            );
            const actionSaving = Number(savingActionId) === Number(user.id);

            return (
              <article key={user.id} className="workspace-staff-card">
                <div className="workspace-staff-card-top">
                  <div>
                    <h3>{user.full_name || user.username}</h3>
                    <p>@{user.username}</p>
                  </div>
                  <span
                    className={`workspace-admin-status ${
                      Number(user.is_active) ? "is-active" : "is-inactive"
                    }`}
                  >
                    {Number(user.is_active) ? "Active" : "Inactive"}
                  </span>
                </div>

                <div className="workspace-staff-badges">
                  <span className={`workspace-admin-role role-${user.role}`}>
                    {label(user.role)}
                  </span>
                  <span className="workspace-admin-role">
                    {user.automatic_access
                      ? "Automatic admin"
                      : label(user.workspace_role)}
                  </span>
                  {user.must_change_password ? (
                    <span className="workspace-admin-status is-warning">
                      Password change required
                    </span>
                  ) : null}

                  {user.is_login_locked ? (
                    <span className="workspace-admin-status is-inactive">
                      Account locked
                    </span>
                  ) : null}
                </div>

                <dl className="workspace-staff-detail-list">
                  <div>
                    <dt>Phone</dt>
                    <dd>{user.phone || "Not recorded"}</dd>
                  </div>
                  <div>
                    <dt>Workspace access</dt>
                    <dd>{user.effective_access ? "Allowed" : "Revoked"}</dd>
                  </div>
                  <div>
                    <dt>Default assignment</dt>
                    <dd>
                      {defaultAssignment
                        ? contextLabel(defaultAssignment.context)
                        : user.automatic_access
                        ? "All active locations"
                        : "Not set"}
                    </dd>
                  </div>
                  <div>
                    <dt>Created</dt>
                    <dd>{formatDateTime(user.created_at)}</dd>
                  </div>
                  <div>
                    <dt>Updated</dt>
                    <dd>{formatDateTime(user.updated_at || user.access_updated_at)}</dd>
                  </div>
                </dl>

                <div className="workspace-staff-assignment-list">
                  {user.automatic_access ? (
                    <span>Administrator access covers every active site or location.</span>
                  ) : assigned.length > 0 ? (
                    assigned.map((assignment) => (
                      <span key={assignment.context_id}>
                        {contextLabel(assignment.context)}
                      </span>
                    ))
                  ) : (
                    <span>No active site or location assignment.</span>
                  )}
                </div>

                <div className="workspace-staff-actions">
                  <button
                    type="button"
                    className="workspace-admin-btn workspace-admin-btn--ghost"
                    onClick={() => onEdit(user)}
                  >
                    Edit
                  </button>
                  {canResetAccounts &&
                    !isOriginalSystemAdministrator(user) && (
                      <button
                        type="button"
                        className="workspace-admin-btn workspace-admin-btn--ghost"
                        onClick={() => onResetPassword(user)}
                        disabled={actionSaving}
                      >
                        {user.is_login_locked
                          ? "Unlock & reset"
                          : "Reset password"}
                      </button>
                    )}
                  <button
                    type="button"
                    className="workspace-admin-btn workspace-admin-btn--ghost"
                    onClick={() => onStatusChange(user, !Number(user.is_active))}
                    disabled={actionSaving}
                  >
                    {Number(user.is_active) ? "Deactivate" : "Activate"}
                  </button>
                  {!user.automatic_access ? (
                    <button
                      type="button"
                      className={
                        user.effective_access
                          ? "workspace-admin-btn workspace-admin-btn--danger"
                          : "workspace-admin-btn workspace-admin-btn--primary"
                      }
                      onClick={() => onWorkspaceAccess(user, !user.effective_access)}
                      disabled={actionSaving}
                    >
                      {user.effective_access ? "Revoke workspace" : "Grant workspace"}
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
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
        <span aria-hidden="true">{isMining ? "Site" : "Location"}</span>
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
                  {user.automatic_access ? "Administrator" : label(user.workspace_role)} - @
                  {user.username}
                </span>
              </th>
              {contexts.map((context) => {
                const key = `${Number(user.id)}:${Number(context.id)}`;
                const assignment = assignmentMap.get(key);
                const hasAccess = Boolean(Number(assignment?.can_access));
                const isDefault = hasAccess && Boolean(Number(assignment?.is_default));
                const isSaving = savingKey === key;
                const workspaceAllowed = Boolean(user.effective_access);
                const contextIsActive = activeContext(context, isMining);

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
                    ) : !contextIsActive && !hasAccess ? (
                      <span className="workspace-context-blocked">Inactive</span>
                    ) : (
                      <div className="workspace-context-cell-actions">
                        <button
                          type="button"
                          className={`workspace-context-access-toggle ${
                            hasAccess ? "is-on" : ""
                          }`}
                          disabled={isSaving || (!contextIsActive && !hasAccess)}
                          onClick={() =>
                            onUpdate(user, context, !hasAccess, false)
                          }
                        >
                          {isSaving
                            ? "Saving..."
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
                            disabled={isSaving || isDefault || !contextIsActive}
                            onClick={() => onUpdate(user, context, true, true)}
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
  const { user: currentUser } = useAuth();
  const isMining = workspace === "mining";
  const canResetAccounts =
    isOriginalSystemAdministrator(currentUser);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [savingUserId, setSavingUserId] = useState(null);
  const [savingLocation, setSavingLocation] = useState(false);
  const [savingStaff, setSavingStaff] = useState(false);
  const [savingExistingUser, setSavingExistingUser] = useState(false);
  const [locationForm, setLocationForm] = useState(emptyLocationForm);
  const [staffForm, setStaffForm] = useState(emptyStaffForm);
  const [existingForm, setExistingForm] = useState(emptyExistingForm);
  const [passwordResetUser, setPasswordResetUser] = useState(null);
  const [passwordResetForm, setPasswordResetForm] = useState(
    emptyPasswordResetForm
  );
  const [staffFilters, setStaffFilters] = useState({
    query: "",
    status: "all",
    workspace_role: "all",
  });
  const [contextAccess, setContextAccess] = useState({
    contexts: [],
    assignments: [],
    users: [],
  });
  const [savingContextKey, setSavingContextKey] = useState("");

  const title = isMining ? "Mining Administration" : "Equipment Hire Administration";

  const workspaceRoles = useMemo(() => {
    const roles = data?.workspace_roles || [];
    if (roles.length > 0) return roles;
    return isMining
      ? [
          "manager",
          "site_supervisor",
          "equipment_operator",
          "site_clerk",
          "accountant",
          "auditor",
        ]
      : [
          "manager",
          "hire_officer",
          "dispatcher",
          "fleet_officer",
          "accountant",
          "auditor",
        ];
  }, [data, isMining]);

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

  useEffect(() => {
    if (!staffForm.workspace_role && workspaceRoles[0]) {
      setStaffForm((current) => ({
        ...current,
        workspace_role: workspaceRoles[0],
      }));
    }

    if (!existingForm.workspace_role && workspaceRoles[0]) {
      setExistingForm((current) => ({
        ...current,
        workspace_role: workspaceRoles[0],
      }));
    }
  }, [existingForm.workspace_role, staffForm.workspace_role, workspaceRoles]);

  const users = useMemo(() => data?.users || [], [data]);
  const eligibleUsers = useMemo(() => data?.eligible_users || [], [data]);
  const locations = useMemo(() => data?.locations || [], [data]);
  const sites = useMemo(() => data?.sites || [], [data]);
  const activeContexts = useMemo(
    () =>
      contextAccess.contexts.filter((context) => activeContext(context, isMining)),
    [contextAccess.contexts, isMining]
  );

  function showSuccess(message) {
    setSuccess(message);
    setError("");
    window.setTimeout(() => setSuccess(""), 4500);
  }

  function resetStaffForm() {
    setStaffForm({
      ...emptyStaffForm,
      workspace_role: workspaceRoles[0] || "",
    });
  }

  function resetExistingForm() {
    setExistingForm({
      ...emptyExistingForm,
      workspace_role: workspaceRoles[0] || "",
    });
  }

  function editStaff(user) {
    const { assigned, defaultAssignment } = getAssignmentsForUser(
      user.id,
      contextAccess.assignments,
      contextAccess.contexts
    );

    setStaffForm({
      id: user.id,
      full_name: user.full_name || "",
      username: user.username || "",
      phone: user.phone || "",
      global_role: user.role === "cashier" ? "staff" : user.role || "staff",
      workspace_role:
        user.workspace_role && user.workspace_role !== "group_admin"
          ? user.workspace_role
          : workspaceRoles[0] || "",
      temporary_password: "",
      is_active: Boolean(Number(user.is_active)),
      can_access: Boolean(user.effective_access),
      force_password_change: Boolean(user.must_change_password),
      must_change_password: Boolean(user.must_change_password),
      context_ids: assigned.map((assignment) => Number(assignment.context_id)),
      default_context_id: defaultAssignment?.context_id || "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveStaff(event) {
    event.preventDefault();
    setSavingStaff(true);
    setError("");

    const payload = {
      full_name: staffForm.full_name,
      username: staffForm.username,
      phone: staffForm.phone,
      global_role: staffForm.global_role,
      workspace_role: staffForm.workspace_role,
      is_active: staffForm.is_active,
      can_access: staffForm.can_access,
      force_password_change: staffForm.force_password_change,
      must_change_password: staffForm.must_change_password,
      context_ids: staffForm.context_ids.map(Number),
      default_context_id: toPositiveNumber(staffForm.default_context_id),
    };

    if (!staffForm.id) {
      payload.temporary_password = staffForm.temporary_password;
    }

    try {
      const response = staffForm.id
        ? await axiosClient.put(`/workspace-admin/staff/${staffForm.id}`, payload)
        : await axiosClient.post("/workspace-admin/staff", payload);

      showSuccess(response.data?.message || "Staff account saved.");
      resetStaffForm();
      await loadOverview();
    } catch (requestError) {
      setError(apiMessage(requestError, "Could not save staff account."));
    } finally {
      setSavingStaff(false);
    }
  }

  async function addExistingUser(event) {
    event.preventDefault();
    setSavingExistingUser(true);
    setError("");

    try {
      const response = await axiosClient.post("/workspace-admin/staff/existing", {
        user_id: existingForm.user_id,
        workspace_role: existingForm.workspace_role,
        context_ids: existingForm.context_ids.map(Number),
        default_context_id: toPositiveNumber(existingForm.default_context_id),
      });

      showSuccess(response.data?.message || "Existing user added.");
      resetExistingForm();
      await loadOverview();
    } catch (requestError) {
      setError(apiMessage(requestError, "Could not add existing user."));
    } finally {
      setSavingExistingUser(false);
    }
  }

  function openPasswordReset(user) {
    setError("");

    if (!canResetAccounts) {
      setError(
        "Only the original System Administrator can unlock or reset user accounts."
      );
      return;
    }

    if (isOriginalSystemAdministrator(user)) {
      setError(
        "The original System Administrator requires Owner Break-Glass recovery in Release 2B."
      );
      return;
    }

    setPasswordResetUser(user);
    setPasswordResetForm(emptyPasswordResetForm);
  }

  function closePasswordReset() {
    if (savingUserId) return;
    setPasswordResetUser(null);
    setPasswordResetForm(emptyPasswordResetForm);
    setError("");
  }

  async function submitPasswordReset(event) {
    event.preventDefault();

    if (!passwordResetUser) return;

    const passwordPolicyError = strongPasswordError(
      passwordResetForm.temporary_password
    );

    if (passwordPolicyError) {
      setError(passwordPolicyError);
      return;
    }

    if (
      passwordResetForm.temporary_password !==
      passwordResetForm.confirm_password
    ) {
      setError("Temporary password and confirmation do not match.");
      return;
    }

    setSavingUserId(passwordResetUser.id);
    setError("");

    try {
      const response = await axiosClient.patch(
        `/workspace-admin/staff/${passwordResetUser.id}/password`,
        {
          temporary_password: passwordResetForm.temporary_password,
          force_password_change: passwordResetForm.force_password_change,
        }
      );

      showSuccess(response.data?.message || "Temporary password reset.");
      setPasswordResetUser(null);
      setPasswordResetForm(emptyPasswordResetForm);
      await loadOverview();
    } catch (requestError) {
      setError(apiMessage(requestError, "Could not reset temporary password."));
    } finally {
      setSavingUserId(null);
    }
  }

  async function changeStatus(user, isActive) {
    const confirmed = window.confirm(
      `Are you sure you want to ${isActive ? "activate" : "deactivate"} ${
        user.full_name || user.username
      }?`
    );

    if (!confirmed) return;

    setSavingUserId(user.id);
    setError("");

    try {
      const response = await axiosClient.patch(
        `/workspace-admin/staff/${user.id}/status`,
        { is_active: isActive }
      );

      showSuccess(response.data?.message || "User status updated.");
      await loadOverview();
    } catch (requestError) {
      setError(apiMessage(requestError, "Could not update user status."));
    } finally {
      setSavingUserId(null);
    }
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
        {
          can_access: canAccess,
          workspace_role:
            user.workspace_role && user.workspace_role !== "group_admin"
              ? user.workspace_role
              : workspaceRoles[0],
        }
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
        <span>Loading</span>
        <strong>Loading {title}...</strong>
      </div>
    );
  }

  return (
    <div className={`workspace-admin-page ${isMining ? "is-mining" : "is-hire"}`}>
      <header className="workspace-admin-hero">
        <div>
          <p>{isMining ? "Mining Operations" : "Equipment Hire"}</p>
          <h1>{title}</h1>
          <span>
            Create this business's own operating structure and control which
            central staff accounts are allowed to enter it. Spare Parts branches
            remain separate.
          </span>
        </div>
        <button
          type="button"
          className="workspace-admin-btn workspace-admin-btn--light"
          onClick={loadOverview}
          disabled={loading}
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </header>

      {error ? <div className="workspace-admin-alert is-error">{error}</div> : null}
      {success ? (
        <div className="workspace-admin-alert is-success">{success}</div>
      ) : null}

      <section className="workspace-admin-summary">
        <SummaryCard
          icon="Users"
          label="Workspace users"
          value={data?.summary?.assigned_users || 0}
          detail={`${data?.summary?.eligible_users || 0} existing central users can be added`}
        />
        <SummaryCard
          icon={isMining ? "Sites" : "Bases"}
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
          icon="Safe"
          label="Business separation"
          value="Protected"
          detail="No Spare Parts store is assigned here"
        />
      </section>

      <section className="workspace-admin-panel workspace-staff-panel">
        <div className="workspace-staff-admin-grid">
          <StaffEditorForm
            form={staffForm}
            setForm={setStaffForm}
            saving={savingStaff}
            onSubmit={saveStaff}
            onCancel={resetStaffForm}
            workspaceRoles={workspaceRoles}
            contexts={activeContexts}
            isMining={isMining}
          />

          <ExistingUserAccessForm
            form={existingForm}
            setForm={setExistingForm}
            eligibleUsers={eligibleUsers}
            saving={savingExistingUser}
            onSubmit={addExistingUser}
            workspaceRoles={workspaceRoles}
            contexts={activeContexts}
            isMining={isMining}
          />
        </div>
      </section>

      <section className="workspace-admin-panel">
        <div className="workspace-admin-panel-heading">
          <div>
            <p>Account detail summary</p>
            <h2>Users & Staff</h2>
            <span>
              Search, review, activate, deactivate, reset temporary passwords and
              manage this workspace without deleting central user records.
            </span>
          </div>
        </div>

        <StaffDirectory
          users={users}
          assignments={contextAccess.assignments}
          contexts={contextAccess.contexts}
          filters={staffFilters}
          setFilters={setStaffFilters}
          workspaceRoles={workspaceRoles}
          savingActionId={savingUserId}
          onEdit={editStaff}
          onResetPassword={openPasswordReset}
          onStatusChange={changeStatus}
          onWorkspaceAccess={toggleAccess}
          canResetAccounts={canResetAccounts}
        />
      </section>

      {canResetAccounts ? (
        <PasswordResetModal
          user={passwordResetUser}
          form={passwordResetForm}
          setForm={setPasswordResetForm}
          saving={
            Boolean(passwordResetUser) &&
            Number(savingUserId) === Number(passwordResetUser?.id)
          }
          error={passwordResetUser ? error : ""}
          onSubmit={submitPasswordReset}
          onClose={closePasswordReset}
        />
      ) : null}

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
              Assign active sites or locations and set one default. Administrators
              have automatic access to every active location.
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
    </div>
  );
}
