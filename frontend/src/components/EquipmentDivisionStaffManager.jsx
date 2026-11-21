import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import axiosClient from "../api/axiosClient";
import { isEquipmentAdministrator } from "../security/equipmentDivisionAccess";
import "../styles/equipmentDivisionStaffManager.css";

const API = "/workspace-context/equipment-divisions/staff";

function label(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function message(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

function RoleOptions({ title, roles }) {
  if (!roles?.length) return null;
  return (
    <optgroup label={title}>
      {roles.map((role) => (
        <option key={role} value={role}>
          {label(role)}
        </option>
      ))}
    </optgroup>
  );
}

export default function EquipmentDivisionStaffManager({ user }) {
  const allowed = isEquipmentAdministrator(user);
  const closeButtonRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [staff, setStaff] = useState([]);
  const [roles, setRoles] = useState({ hire: [], finance: [], both: [] });
  const [selections, setSelections] = useState({});
  const [savingId, setSavingId] = useState(null);
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");

  const allRoles = useMemo(
    () =>
      new Set([
        ...(roles.hire || []),
        ...(roles.finance || []),
        ...(roles.both || []),
      ]),
    [roles]
  );

  const load = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    setProblem("");

    try {
      const response = await axiosClient.get(API);
      const nextStaff = response.data?.staff || [];
      const nextRoles = response.data?.roles || {
        hire: [],
        finance: [],
        both: [],
      };
      setStaff(nextStaff);
      setRoles(nextRoles);
      setSelections(
        Object.fromEntries(
          nextStaff.map((person) => [
            person.id,
            person.workspace_role || nextRoles.hire?.[0] || "hire_officer",
          ])
        )
      );
    } catch (error) {
      setProblem(message(error, "Could not load Equipment division staff."));
    } finally {
      setLoading(false);
    }
  }, [allowed]);

  useEffect(() => {
    if (open) load();
  }, [load, open]);

  useEffect(() => {
    if (!open) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function onKeyDown(event) {
      if (event.key === "Escape" && !savingId) setOpen(false);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, savingId]);

  if (!allowed) return null;

  function divisionForSelection(workspaceRole) {
    if (roles.both.includes(workspaceRole)) return "both";
    if (roles.finance.includes(workspaceRole)) return "finance";
    return "hire";
  }

  async function save(person) {
    const workspaceRole = selections[person.id];

    if (!allRoles.has(workspaceRole)) {
      setProblem("Choose a valid Hire, Finance or dual Equipment Business role.");
      return;
    }

    const division = divisionForSelection(workspaceRole);
    setSavingId(person.id);
    setProblem("");
    setNotice("");

    try {
      const response = await axiosClient.put(`${API}/${person.id}`, {
        division,
        workspace_role: workspaceRole,
      });
      setNotice(response.data?.message || "Equipment staff assignment updated.");
      await load();
    } catch (error) {
      setProblem(message(error, "Could not update the Equipment staff assignment."));
    } finally {
      setSavingId(null);
    }
  }

  const manager = open ? (
    <div
      className="equipment-division-staff__backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !savingId) setOpen(false);
      }}
    >
      <section
        className="equipment-division-staff__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="equipment-division-staff-title"
      >
        <header>
          <div>
            <p>Protected System Administrator control</p>
            <h2 id="equipment-division-staff-title">Manage Division Staff</h2>
            <span>
              Assign Hire-only, Finance-only or approved dual-business roles. Every
              assignment change revokes the employee&apos;s existing sessions.
            </span>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={() => setOpen(false)}
            disabled={Boolean(savingId)}
            aria-label="Close Equipment staff manager"
          >
            ×
          </button>
        </header>

        <div className="equipment-division-staff__rules">
          <strong>One employee. One division.</strong>
          <span>
            Each assignment belongs to exactly one role family. Approved Equipment
            Business Manager, Accountant and Auditor roles are the controlled dual-family
            exception. Every API still checks the exact action permission.
          </span>
        </div>

        {problem ? (
          <div className="equipment-division-staff__alert is-error" role="alert">
            {problem}
          </div>
        ) : null}
        {notice ? (
          <div className="equipment-division-staff__alert is-success" role="status">
            {notice}
          </div>
        ) : null}

        <div className="equipment-division-staff__body">
          {loading ? (
            <div className="equipment-division-staff__empty">
              Loading staff assignments…
            </div>
          ) : null}

          {!loading && staff.length === 0 ? (
            <div className="equipment-division-staff__empty">
              No ordinary Equipment staff accounts are available yet.
            </div>
          ) : null}

          {!loading
            ? staff.map((person) => {
                const selection = selections[person.id] || "";
                const division = divisionForSelection(selection);

                return (
                  <article key={person.id} className="equipment-division-staff__card">
                    <div>
                      <span
                        className={`equipment-division-staff__division ${
                          division === "finance"
                            ? "is-finance"
                            : division === "both"
                              ? "is-both"
                              : "is-hire"
                        }`}
                      >
                        {division === "both"
                          ? "Hire + Finance"
                          : division === "finance"
                            ? "Finance-only"
                            : "Hire-only"}
                      </span>
                      <h3>{person.full_name || person.username}</h3>
                      <p>
                        @{person.username} · {label(person.global_role)}
                      </p>
                    </div>

                    <label>
                      <span>Assigned staff role</span>
                      <select
                        value={selection}
                        onChange={(event) =>
                          setSelections((current) => ({
                            ...current,
                            [person.id]: event.target.value,
                          }))
                        }
                      >
                        <RoleOptions
                          title="Equipment Business — Hire and Finance"
                          roles={roles.both}
                        />
                        <RoleOptions
                          title="Equipment Hire Operations"
                          roles={roles.hire}
                        />
                        <RoleOptions
                          title="Equipment Installment Finance"
                          roles={roles.finance}
                        />
                      </select>
                    </label>

                    <button
                      type="button"
                      disabled={Number(savingId) === Number(person.id)}
                      onClick={() => save(person)}
                    >
                      {Number(savingId) === Number(person.id)
                        ? "Applying permissions…"
                        : "Save Assignment"}
                    </button>
                  </article>
                );
              })
            : null}
        </div>
      </section>
    </div>
  ) : null;

  return (
    <>
      <button
        type="button"
        className="equipment-division-staff__open"
        onClick={() => setOpen(true)}
        aria-label="Manage Equipment Business staff"
      >
        <span className="equipment-division-staff__open-full">
          Manage Division Staff
        </span>
        <span className="equipment-division-staff__open-compact">Staff</span>
      </button>

      {typeof document !== "undefined" && manager
        ? createPortal(manager, document.body)
        : null}
    </>
  );
}
