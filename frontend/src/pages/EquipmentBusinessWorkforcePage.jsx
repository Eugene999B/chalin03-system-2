import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import ExpandedWorkerProfilePage from "./ExpandedWorkerProfilePage";
import EmploymentDocumentsPage from "./EmploymentDocumentsPage";
import UserPermissionManagerPage from "./UserPermissionManagerPage";
import "../styles/equipmentBusinessWorkforce.css";

const API = "/workspace-context/equipment-divisions";
const TABS = new Set([
  "overview",
  "staff",
  "roles",
  "profiles",
  "documents",
  "permissions",
]);

const EMPTY_STAFF = {
  full_name: "",
  username: "",
  phone: "",
  temporary_password: "",
  workspace_role: "",
  force_password_change: true,
  is_active: true,
  location_ids: [],
  default_location_id: "",
};

function label(value) {
  return String(value || "Not assigned")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function errorMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

function strongPasswordError(password) {
  const text = String(password || "");
  if (text.length < 8) return "Use at least 8 characters.";
  if (!/[a-z]/.test(text) || !/[A-Z]/.test(text)) {
    return "Include uppercase and lowercase letters.";
  }
  if (!/\d/.test(text)) return "Include at least one number.";
  if (!/[^A-Za-z0-9]/.test(text)) return "Include at least one symbol.";
  return "";
}

function dateLabel(value) {
  if (!value) return "Not issued";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleDateString("en-GH", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}

function divisionTone(division) {
  if (division === "both") return "is-dual";
  return division === "finance" ? "is-finance" : "is-hire";
}

function Metric({ label: title, value, note }) {
  return (
    <article className="equipment-workforce__metric">
      <span>{title}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function RoleTemplateCard({ template, selected, onSelect }) {
  return (
    <article
      className={`equipment-workforce__role-card ${divisionTone(template.division)} ${
        selected ? "is-selected" : ""
      }`}
    >
      <div className="equipment-workforce__role-heading">
        <div>
          <span>{label(template.division)}</span>
          <h3>{template.label}</h3>
        </div>
        <strong>{template.permission_count} defaults</strong>
      </div>
      <p>{template.description}</p>
      <details>
        <summary>View default permissions</summary>
        <div className="equipment-workforce__permission-chips">
          {(template.permissions || []).map((permission) => (
            <span key={permission}>{permission}</span>
          ))}
        </div>
      </details>
      {onSelect ? (
        <button type="button" onClick={() => onSelect(template.code)}>
          {selected ? "Selected role" : "Use this role"}
        </button>
      ) : null}
    </article>
  );
}

function StaffCreateForm({
  form,
  setForm,
  roleTemplates,
  locations,
  saving,
  onSubmit,
}) {
  const selectedTemplate = roleTemplates.find(
    (item) => item.code === form.workspace_role
  );
  const locationsAllowed = selectedTemplate?.division !== "finance";
  const passwordProblem = form.temporary_password
    ? strongPasswordError(form.temporary_password)
    : "";

  function toggleLocation(locationId) {
    setForm((current) => {
      const selected = current.location_ids.includes(locationId);
      const locationIds = selected
        ? current.location_ids.filter((id) => id !== locationId)
        : [...current.location_ids, locationId];
      return {
        ...current,
        location_ids: locationIds,
        default_location_id: locationIds.includes(Number(current.default_location_id))
          ? current.default_location_id
          : "",
      };
    });
  }

  return (
    <form className="equipment-workforce__form" onSubmit={onSubmit}>
      <div className="equipment-workforce__section-heading">
        <div>
          <p>Protected System Administrator action</p>
          <h2>Create Staff Login</h2>
          <span>
            Create the login once, force a first-password change, then create or link the
            worker profile from the Worker Profiles tab.
          </span>
        </div>
      </div>

      <div className="equipment-workforce__form-grid">
        <label>
          <span>Full name</span>
          <input
            value={form.full_name}
            onChange={(event) =>
              setForm((current) => ({ ...current, full_name: event.target.value }))
            }
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
            autoCapitalize="none"
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
            inputMode="tel"
            placeholder="0241234567"
          />
        </label>
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
            autoComplete="new-password"
            required
          />
          <small className={passwordProblem ? "is-warning" : ""}>
            {passwordProblem || "Strong password ready."}
          </small>
        </label>
        <label className="is-wide">
          <span>Role template</span>
          <select
            value={form.workspace_role}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                workspace_role: event.target.value,
                location_ids:
                  roleTemplates.find((item) => item.code === event.target.value)
                    ?.division === "finance"
                    ? []
                    : current.location_ids,
                default_location_id:
                  roleTemplates.find((item) => item.code === event.target.value)
                    ?.division === "finance"
                    ? ""
                    : current.default_location_id,
              }))
            }
            required
          >
            <option value="">Choose Hire, Finance or dual role</option>
            {roleTemplates.map((template) => (
              <option key={template.code} value={template.code}>
                {template.label} — {label(template.division)}
              </option>
            ))}
          </select>
          {selectedTemplate ? <small>{selectedTemplate.description}</small> : null}
        </label>
      </div>

      {locationsAllowed ? (
        <fieldset className="equipment-workforce__locations">
          <legend>Hire-location access</legend>
          <p>
            Hire and dual roles may receive operational locations. Finance-only roles are
            company-wide and never receive Hire-location access.
          </p>
          <div>
            {locations.map((location) => (
              <label key={location.id}>
                <input
                  type="checkbox"
                  checked={form.location_ids.includes(Number(location.id))}
                  onChange={() => toggleLocation(Number(location.id))}
                />
                <span>
                  <strong>{location.code} — {location.name}</strong>
                  <small>{label(location.location_type)}</small>
                </span>
              </label>
            ))}
          </div>
          {form.location_ids.length ? (
            <label className="equipment-workforce__default-location">
              <span>Default Hire location</span>
              <select
                value={form.default_location_id}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    default_location_id: event.target.value,
                  }))
                }
              >
                <option value="">No default</option>
                {locations
                  .filter((location) =>
                    form.location_ids.includes(Number(location.id))
                  )
                  .map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.code} — {location.name}
                    </option>
                  ))}
              </select>
            </label>
          ) : null}
        </fieldset>
      ) : (
        <div className="equipment-workforce__notice is-info">
          Finance staff work across the company portfolio. No Hire location will be assigned.
        </div>
      )}

      <div className="equipment-workforce__checks">
        <label>
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
          <span>Require password change at first login</span>
        </label>
        <label>
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                is_active: event.target.checked,
              }))
            }
          />
          <span>Account is active immediately</span>
        </label>
      </div>

      <div className="equipment-workforce__sticky-actions">
        <span>Every creation is audit recorded.</span>
        <button type="submit" disabled={saving || Boolean(passwordProblem)}>
          {saving ? "Creating login…" : "Create Staff Login"}
        </button>
      </div>
    </form>
  );
}

function StaffRegister({ staff, roleTemplates, savingId, onAssign, basePath }) {
  const [roleSelections, setRoleSelections] = useState({});

  return (
    <section className="equipment-workforce__section">
      <div className="equipment-workforce__section-heading">
        <div>
          <p>Login and division register</p>
          <h2>{staff.length} Staff Account(s)</h2>
          <span>
            Role changes revoke existing sessions. The worker profile remains a separate
            protected HR record linked to the same account.
          </span>
        </div>
      </div>

      {!staff.length ? (
        <div className="equipment-workforce__empty">No Equipment Business staff logins yet.</div>
      ) : null}

      <div className="equipment-workforce__staff-grid">
        {staff.map((person) => {
          const selectedRole = roleSelections[person.id] || person.workspace_role || "";
          const selectedTemplate = roleTemplates.find(
            (item) => item.code === selectedRole
          );
          return (
            <article className="equipment-workforce__staff-card" key={person.id}>
              <div className="equipment-workforce__staff-head">
                <div>
                  <span className={`equipment-workforce__division ${divisionTone(person.division)}`}>
                    {label(person.division)}
                  </span>
                  <h3>{person.full_name}</h3>
                  <p>@{person.username} · {person.phone || "No phone"}</p>
                </div>
                <span className={person.is_active && person.can_access ? "is-active" : "is-inactive"}>
                  {person.is_active && person.can_access ? "Active" : "Inactive"}
                </span>
              </div>

              <dl>
                <div><dt>Role</dt><dd>{selectedTemplate?.label || label(person.workspace_role)}</dd></div>
                <div><dt>Employee</dt><dd>{person.employee_number || "Profile pending"}</dd></div>
                <div><dt>Job title</dt><dd>{person.job_title || "Not recorded"}</dd></div>
                <div><dt>ID card expiry</dt><dd>{dateLabel(person.id_card_expiry_date)}</dd></div>
              </dl>

              {person.location_labels?.length ? (
                <div className="equipment-workforce__location-chips">
                  {person.location_labels.map((item) => <span key={item}>{item}</span>)}
                </div>
              ) : (
                <small>No Hire-location assignment</small>
              )}

              <label className="equipment-workforce__role-select">
                <span>Change role / division</span>
                <select
                  value={selectedRole}
                  onChange={(event) =>
                    setRoleSelections((current) => ({
                      ...current,
                      [person.id]: event.target.value,
                    }))
                  }
                >
                  {roleTemplates.map((template) => (
                    <option key={template.code} value={template.code}>
                      {template.label} — {label(template.division)}
                    </option>
                  ))}
                </select>
              </label>

              <div className="equipment-workforce__card-actions">
                <button
                  type="button"
                  disabled={savingId === person.id || selectedRole === person.workspace_role}
                  onClick={() => onAssign(person, selectedRole)}
                >
                  {savingId === person.id ? "Applying…" : "Apply Role"}
                </button>
                <Link to={`${basePath}/workforce?tab=profiles`}>
                  {person.worker_profile_linked ? "Open Worker Profiles" : "Create Worker Profile"}
                </Link>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export default function EquipmentBusinessWorkforcePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, effectivePermissions = [] } = useAuth();
  const financeMode = location.pathname.startsWith("/equipment-installment-finance");
  const basePath = financeMode
    ? "/equipment-installment-finance"
    : "/equipment-hire-operations";
  const requestedTab = new URLSearchParams(location.search).get("tab") || "overview";
  const tab = TABS.has(requestedTab) ? requestedTab : "overview";
  const isSystemAdministrator = Boolean(user?.is_original_system_administrator);
  const canViewProfiles = effectivePermissions.includes("workers.view");
  const canViewDocuments = effectivePermissions.includes("workers.documents.view");
  const canOverridePermissions = effectivePermissions.includes("users.permissions.manage");

  const [data, setData] = useState({
    staff: [],
    locations: [],
    role_templates: [],
    summary: {},
    policy: {},
  });
  const [form, setForm] = useState(EMPTY_STAFF);
  const [loading, setLoading] = useState(isSystemAdministrator);
  const [saving, setSaving] = useState(false);
  const [savingId, setSavingId] = useState(null);
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    if (!isSystemAdministrator) return;
    setLoading(true);
    setProblem("");
    try {
      const response = await axiosClient.get(`${API}/overview`);
      const next = response.data || {};
      setData({
        staff: next.staff || [],
        locations: next.locations || [],
        role_templates: next.role_templates || [],
        summary: next.summary || {},
        policy: next.policy || {},
      });
      setForm((current) => ({
        ...current,
        workspace_role:
          current.workspace_role || (financeMode ? "finance_manager" : "hire_officer"),
      }));
    } catch (error) {
      setProblem(errorMessage(error, "Could not load Equipment Business workforce."));
    } finally {
      setLoading(false);
    }
  }, [financeMode, isSystemAdministrator]);

  useEffect(() => {
    load();
  }, [load]);

  const visibleTabs = useMemo(
    () => [
      { code: "overview", label: "Overview", show: true },
      { code: "staff", label: "Staff Logins", show: isSystemAdministrator },
      { code: "roles", label: "Role Templates", show: isSystemAdministrator },
      { code: "profiles", label: "Worker Profiles & ID Cards", show: canViewProfiles },
      { code: "documents", label: "Employment Documents", show: canViewDocuments },
      { code: "permissions", label: "Permission Overrides", show: canOverridePermissions },
    ].filter((item) => item.show),
    [canOverridePermissions, canViewDocuments, canViewProfiles, isSystemAdministrator]
  );

  useEffect(() => {
    if (!visibleTabs.some((item) => item.code === tab)) {
      navigate(`${basePath}/workforce?tab=overview`, { replace: true });
    }
  }, [basePath, navigate, tab, visibleTabs]);

  function openTab(code) {
    navigate(`${basePath}/workforce?tab=${code}`);
  }

  async function createStaff(event) {
    event.preventDefault();
    const passwordProblem = strongPasswordError(form.temporary_password);
    if (passwordProblem) {
      setProblem(passwordProblem);
      return;
    }
    setSaving(true);
    setProblem("");
    setNotice("");
    try {
      const response = await axiosClient.post(`${API}/staff`, form);
      setNotice(response.data?.message || "Staff login created.");
      setForm({
        ...EMPTY_STAFF,
        workspace_role: financeMode ? "finance_manager" : "hire_officer",
      });
      await load();
    } catch (error) {
      setProblem(errorMessage(error, "Could not create the staff login."));
    } finally {
      setSaving(false);
    }
  }

  async function assignRole(person, workspaceRole) {
    const template = data.role_templates.find((item) => item.code === workspaceRole);
    if (!template) return;
    if (
      !window.confirm(
        `Assign ${person.full_name} as ${template.label}? Their active sessions will be revoked.`
      )
    ) {
      return;
    }
    setSavingId(person.id);
    setProblem("");
    setNotice("");
    try {
      const response = await axiosClient.put(`${API}/staff/${person.id}`, {
        workspace_role: workspaceRole,
        division: template.division,
      });
      setNotice(response.data?.message || "Staff assignment updated.");
      await load();
    } catch (error) {
      setProblem(errorMessage(error, "Could not update the staff assignment."));
    } finally {
      setSavingId(null);
    }
  }

  return (
    <main className="equipment-workforce">
      <header className="equipment-workforce__hero">
        <div>
          <p>Phase 2 — Staff and workforce</p>
          <h1>Equipment Business Staff & Workforce</h1>
          <span>
            One protected centre for staff logins, role defaults, System Administrator
            overrides, worker profiles, ID cards, employment documents and Hire/Finance
            assignments.
          </span>
        </div>
        <div className="equipment-workforce__hero-actions">
          <Link to="/equipment-hire">Back to Equipment Divisions</Link>
          {isSystemAdministrator ? (
            <button type="button" onClick={() => openTab("staff")}>+ Create Staff Login</button>
          ) : null}
        </div>
      </header>

      {problem ? <div className="equipment-workforce__notice is-error" role="alert">{problem}</div> : null}
      {notice ? <div className="equipment-workforce__notice is-success" role="status">{notice}</div> : null}

      <nav className="equipment-workforce__tabs" aria-label="Workforce sections">
        {visibleTabs.map((item) => (
          <button
            type="button"
            key={item.code}
            className={tab === item.code ? "is-active" : ""}
            onClick={() => openTab(item.code)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {loading ? <div className="equipment-workforce__empty">Loading workforce controls…</div> : null}

      {!loading && tab === "overview" ? (
        <>
          {isSystemAdministrator ? (
            <section className="equipment-workforce__metrics">
              <Metric label="Staff logins" value={data.summary.staff_logins || 0} note="Equipment Business accounts" />
              <Metric label="Active access" value={data.summary.active_logins || 0} note="Active login and workspace access" />
              <Metric label="Hire / Finance / Dual" value={`${data.summary.hire_staff || 0} / ${data.summary.finance_staff || 0} / ${data.summary.dual_staff || 0}`} note="Exact division assignments" />
              <Metric label="Worker profiles" value={data.summary.linked_worker_profiles || 0} note={`${data.summary.logins_without_worker_profiles || 0} login(s) still need profiles`} />
            </section>
          ) : (
            <div className="equipment-workforce__notice is-info">
              Your role grants access only to the workforce sections shown above. Staff-login
              creation and permission overrides remain protected System Administrator actions.
            </div>
          )}

          <section className="equipment-workforce__journey">
            {[
              ["1", "Create login", "System Administrator creates the username and temporary password."],
              ["2", "Choose role", "Apply one Hire, Finance or approved dual role template."],
              ["3", "Create worker profile", "Record legal identity, job, photograph and emergency details."],
              ["4", "Issue ID card", "Generate the protected CR80/A4 worker identification card."],
              ["5", "Employment documents", "Prepare, approve and retain employment letters and evidence."],
              ["6", "Override only when needed", "System Administrator records an explicit allow or deny with a reason."],
            ].map(([number, title, text]) => (
              <article key={number}>
                <span>{number}</span>
                <div><h3>{title}</h3><p>{text}</p></div>
              </article>
            ))}
          </section>

          <section className="equipment-workforce__quick-grid">
            {canViewProfiles ? (
              <button type="button" onClick={() => openTab("profiles")}>
                <span>👷</span><strong>Worker Profiles & ID Cards</strong><small>Identity, photos, assignments, cards and private documents</small>
              </button>
            ) : null}
            {canViewDocuments ? (
              <button type="button" onClick={() => openTab("documents")}>
                <span>📄</span><strong>Employment Documents</strong><small>Letters, approvals, signatures and PDF evidence</small>
              </button>
            ) : null}
            {isSystemAdministrator ? (
              <button type="button" onClick={() => openTab("roles")}>
                <span>🧩</span><strong>Role Templates</strong><small>Review exact default permissions before assignment</small>
              </button>
            ) : null}
            {canOverridePermissions ? (
              <button type="button" onClick={() => openTab("permissions")}>
                <span>🛡️</span><strong>Permission Overrides</strong><small>Protected allow/deny controls with audit history</small>
              </button>
            ) : null}
          </section>
        </>
      ) : null}

      {!loading && tab === "staff" && isSystemAdministrator ? (
        <>
          <StaffCreateForm
            form={form}
            setForm={setForm}
            roleTemplates={data.role_templates}
            locations={data.locations}
            saving={saving}
            onSubmit={createStaff}
          />
          <StaffRegister
            staff={data.staff}
            roleTemplates={data.role_templates}
            savingId={savingId}
            onAssign={assignRole}
            basePath={basePath}
          />
        </>
      ) : null}

      {!loading && tab === "roles" && isSystemAdministrator ? (
        <section className="equipment-workforce__section">
          <div className="equipment-workforce__section-heading">
            <div>
              <p>Least-privilege defaults</p>
              <h2>Role Templates & Default Permissions</h2>
              <span>
                Role defaults apply first. A recorded explicit deny always wins. Only the
                protected System Administrator can override another user.
              </span>
            </div>
          </div>
          <div className="equipment-workforce__role-grid">
            {data.role_templates.map((template) => (
              <RoleTemplateCard key={template.code} template={template} />
            ))}
          </div>
        </section>
      ) : null}

      {tab === "profiles" && canViewProfiles ? <ExpandedWorkerProfilePage /> : null}
      {tab === "documents" && canViewDocuments ? <EmploymentDocumentsPage /> : null}
      {tab === "permissions" && canOverridePermissions ? <UserPermissionManagerPage /> : null}
    </main>
  );
}