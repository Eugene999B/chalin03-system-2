import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import { useWorkspaceContext } from "../context/WorkspaceContext";
import "../styles/equipmentFinanceAgreementActivation.css";

const API = "/equipment-catalogue/sales/agreement-activations";
const ACTIVATION_ROLES = new Set(["finance_manager", "finance_accountant"]);

const money = (value) =>
  `GHS ${Number(value || 0).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const label = (value) =>
  String(value || "Not available")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());

const errorMessage = (error, fallback) =>
  error?.response?.data?.message || error?.message || fallback;

const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Accra",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

function initialForm(candidate = {}) {
  return {
    first_due_date: candidate.proposed_first_due_date
      ? String(candidate.proposed_first_due_date).slice(0, 10)
      : today(),
    grace_days: "0",
    activation_notes: "",
    terms_accepted: false,
  };
}

function StatusPill({ value }) {
  return (
    <span className={`finance-activation__status is-${String(value || "unknown")}`}>
      {label(value)}
    </span>
  );
}

function Field({ title, hint, children, wide = false }) {
  return (
    <label className={`finance-activation__field ${wide ? "is-wide" : ""}`}>
      <span>{title}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function Drawer({ title, subtitle, onClose, children }) {
  return (
    <div
      className="finance-activation__backdrop"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className="finance-activation__drawer"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <p>Equipment Installment Finance</p>
            <h2>{title}</h2>
            <span>{subtitle}</span>
          </div>
          <button type="button" onClick={onClose} aria-label="Close activation dialog">
            ×
          </button>
        </header>
        <div className="finance-activation__drawer-body">{children}</div>
      </section>
    </div>
  );
}

export default function EquipmentFinanceAgreementActivationPage() {
  const { user, workspaceRole } = useAuth();
  const { selectedContext, selectedContextId, automaticAccess } = useWorkspaceContext();
  const activeRole = String(
    workspaceRole || user?.workspace_role || user?.access_role || user?.role || ""
  )
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const isSystemAdministrator = Boolean(user?.is_original_system_administrator);
  const canActivate = isSystemAdministrator || ACTIVATION_ROLES.has(activeRole);

  const [readiness, setReadiness] = useState({ ready: null });
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("awaiting");
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [form, setForm] = useState(() => initialForm());

  const locationName =
    selectedContext?.name ||
    (automaticAccess && !selectedContextId
      ? "All authorised Finance locations"
      : "Choose a Finance location");

  const load = useCallback(async () => {
    setLoading(true);
    setProblem("");
    try {
      const readinessResponse = await axiosClient.get(`${API}/readiness`);
      const nextReadiness = readinessResponse.data?.readiness || { ready: true };
      setReadiness(nextReadiness);
      if (!nextReadiness.ready || !selectedContextId) {
        setCandidates([]);
        return;
      }

      const response = await axiosClient.get(`${API}/candidates`);
      setCandidates(response.data?.candidates || []);
    } catch (error) {
      const responseReadiness = error?.response?.data?.readiness;
      if (
        error?.response?.data?.code ===
          "EQUIPMENT_FINANCE_ACTIVATION_FOUNDATION_REQUIRED" ||
        responseReadiness?.ready === false
      ) {
        setReadiness(responseReadiness || { ready: false });
        setCandidates([]);
        return;
      }
      setProblem(errorMessage(error, "Could not load approved Finance applications."));
    } finally {
      setLoading(false);
    }
  }, [selectedContextId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(""), 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const visibleCandidates = useMemo(() => {
    const term = search.trim().toLowerCase();
    return candidates.filter((candidate) => {
      const activated = Boolean(candidate.agreement_id);
      if (statusFilter === "awaiting" && activated) return false;
      if (statusFilter === "activated" && !activated) return false;
      if (!term) return true;
      return [
        candidate.application_number,
        candidate.customer_name,
        candidate.customer_phone,
        candidate.quotation_number,
        candidate.asset_code,
        candidate.asset_name,
      ].some((value) => String(value || "").toLowerCase().includes(term));
    });
  }, [candidates, search, statusFilter]);

  const summary = useMemo(
    () => ({
      awaiting: candidates.filter((candidate) => !candidate.agreement_id).length,
      activated: candidates.filter((candidate) => candidate.agreement_id).length,
      exposure: candidates
        .filter((candidate) => !candidate.agreement_id)
        .reduce((total, candidate) => total + Number(candidate.financed_amount || 0), 0),
    }),
    [candidates]
  );

  function openActivation(candidate) {
    if (!selectedContextId) {
      setProblem("Choose a specific Finance location before activating an agreement.");
      return;
    }
    if (!canActivate) {
      setProblem(
        "Only the Finance Manager, Finance Accountant or protected System Administrator can activate agreements."
      );
      return;
    }
    setProblem("");
    setSelectedCandidate(candidate);
    setForm(initialForm(candidate));
  }

  async function activateAgreement(event) {
    event.preventDefault();
    if (!selectedCandidate || !form.terms_accepted) {
      setProblem("Confirm the approved Finance agreement terms before activation.");
      return;
    }

    setSaving(true);
    setProblem("");
    try {
      const response = await axiosClient.post(`${API}/${selectedCandidate.id}`, form);
      setSelectedCandidate(null);
      setNotice(
        response.data?.message ||
          "Finance agreement and schedule activated without recording payment or reserving equipment."
      );
      await load();
    } catch (error) {
      setProblem(errorMessage(error, "Could not activate the Finance agreement."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="finance-activation">
      <section className="finance-activation__hero">
        <div>
          <p>Approved application to Finance agreement</p>
          <h1>Activate the agreement without crossing into Hire work</h1>
          <span>{locationName}</span>
        </div>
        <div className="finance-activation__hero-actions">
          <Link to="/equipment-installment-finance/applications">
            Credit applications
          </Link>
          <Link to="/equipment-installment-finance">Finance accounts</Link>
          <button type="button" onClick={load} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </section>

      <section className="finance-activation__boundary">
        <span aria-hidden="true">🔐</span>
        <div>
          <strong>Agreement activation is Finance-only</strong>
          <p>
            This stage creates one approved Finance agreement and its installment
            schedule. It does not collect money, reserve a machine, alter the fleet
            register, create a Hire job, create delivery evidence, transfer ownership or
            send SMS.
          </p>
        </div>
      </section>

      {problem ? <div className="finance-activation__alert is-error">{problem}</div> : null}
      {notice ? <div className="finance-activation__alert is-success">{notice}</div> : null}

      {!selectedContextId ? (
        <div className="finance-activation__alert is-warning">
          Choose one Finance location before loading or activating agreements. The
          administrator-wide location view is read-only for this action.
        </div>
      ) : null}

      {!canActivate ? (
        <div className="finance-activation__alert is-info">
          Your Finance role may review this queue but cannot activate agreements. A
          Finance Manager or Finance Accountant must complete this independent step.
        </div>
      ) : null}

      {readiness.ready === false ? (
        <section className="finance-activation__foundation">
          <span aria-hidden="true">🏗️</span>
          <div>
            <p>Activation foundation awaiting controlled migration</p>
            <h2>Finance agreement activation is not active in this database yet</h2>
            <span>
              Apply and verify the additive agreement-activation migration after the
              required backups. Until then, no agreement can be created from this page.
            </span>
            {readiness.missing_columns?.length ? (
              <small>Missing columns: {readiness.missing_columns.join(", ")}</small>
            ) : null}
            {readiness.missing_triggers?.length ? (
              <small>Missing triggers: {readiness.missing_triggers.join(", ")}</small>
            ) : null}
          </div>
        </section>
      ) : null}

      {readiness.ready === true ? (
        <>
          <section className="finance-activation__metrics">
            <article>
              <span>⏳</span>
              <div>
                <small>Awaiting activation</small>
                <strong>{summary.awaiting}</strong>
                <p>Approved applications without an agreement</p>
              </div>
            </article>
            <article>
              <span>✅</span>
              <div>
                <small>Activated</small>
                <strong>{summary.activated}</strong>
                <p>Applications already linked to an agreement</p>
              </div>
            </article>
            <article>
              <span>💼</span>
              <div>
                <small>Awaiting financed amount</small>
                <strong>{money(summary.exposure)}</strong>
                <p>Approved exposure not yet activated</p>
              </div>
            </article>
          </section>

          <section className="finance-activation__toolbar">
            <label>
              <span>Search approved applications</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Application, customer, quotation or machine"
              />
            </label>
            <label>
              <span>Queue</span>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
              >
                <option value="awaiting">Awaiting activation</option>
                <option value="activated">Already activated</option>
                <option value="all">All approved applications</option>
              </select>
            </label>
          </section>

          {loading ? (
            <div className="finance-activation__loading">Loading activation queue…</div>
          ) : null}

          {!loading && selectedContextId ? (
            <section className="finance-activation__queue" aria-label="Finance agreement activation queue">
              <header>
                <div>
                  <p>Controlled activation queue</p>
                  <h2>{visibleCandidates.length} approved application(s)</h2>
                </div>
                <small>Finance Manager or Finance Accountant approval step</small>
              </header>

              {!visibleCandidates.length ? (
                <div className="finance-activation__empty">
                  <span aria-hidden="true">📄</span>
                  <h3>No approved applications in this queue</h3>
                  <p>
                    Complete KYC, affordability and independent approval before an
                    application appears here.
                  </p>
                </div>
              ) : null}

              <div className="finance-activation__cards">
                {visibleCandidates.map((candidate) => (
                  <article className="finance-activation__card" key={candidate.id}>
                    <div className="finance-activation__card-top">
                      <div>
                        <small>{candidate.application_number}</small>
                        <h3>{candidate.customer_name}</h3>
                        <p>
                          {candidate.asset_code || "Equipment"} · {candidate.asset_name || "Machine"}
                        </p>
                      </div>
                      <StatusPill value={candidate.agreement_id ? "activated" : "approved"} />
                    </div>

                    <div className="finance-activation__statuses">
                      <span>KYC <StatusPill value={candidate.kyc_status} /></span>
                      <span>Affordability <StatusPill value={candidate.affordability_status} /></span>
                      <span>Risk <StatusPill value={candidate.risk_band} /></span>
                    </div>

                    <div className="finance-activation__facts">
                      <div><span>Quotation</span><strong>{candidate.quotation_number || "—"}</strong></div>
                      <div><span>Quoted total</span><strong>{money(candidate.quoted_total)}</strong></div>
                      <div><span>Approved deposit</span><strong>{money(candidate.approved_deposit)}</strong></div>
                      <div><span>Financed amount</span><strong>{money(candidate.financed_amount)}</strong></div>
                      <div><span>Frequency</span><strong>{label(candidate.payment_frequency)}</strong></div>
                      <div><span>Installments</span><strong>{candidate.installment_count || "—"}</strong></div>
                    </div>

                    <div className="finance-activation__safeguards">
                      <span>✓ No Hire job</span>
                      <span>✓ No payment</span>
                      <span>✓ No machine lock</span>
                      <span>✓ No SMS</span>
                    </div>

                    <div className="finance-activation__card-actions">
                      <Link to="/equipment-installment-finance/applications">
                        Review application file
                      </Link>
                      {candidate.agreement_id ? (
                        <Link to="/equipment-installment-finance">
                          Open Finance account
                        </Link>
                      ) : canActivate ? (
                        <button
                          className="is-primary"
                          type="button"
                          onClick={() => openActivation(candidate)}
                        >
                          Activate Finance agreement
                        </button>
                      ) : (
                        <button type="button" disabled>
                          Manager or accountant required
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      {selectedCandidate ? (
        <Drawer
          title="Activate Finance agreement"
          subtitle={`${selectedCandidate.application_number} · ${selectedCandidate.customer_name}`}
          onClose={() => setSelectedCandidate(null)}
        >
          <form className="finance-activation__form" onSubmit={activateAgreement}>
            <section className="finance-activation__review">
              <h3>Approved terms being activated</h3>
              <div>
                <span>Machine</span>
                <strong>
                  {selectedCandidate.asset_code} · {selectedCandidate.asset_name}
                </strong>
              </div>
              <div><span>Quoted total</span><strong>{money(selectedCandidate.quoted_total)}</strong></div>
              <div><span>Approved deposit</span><strong>{money(selectedCandidate.approved_deposit)}</strong></div>
              <div><span>Financed amount</span><strong>{money(selectedCandidate.financed_amount)}</strong></div>
              <div><span>Schedule</span><strong>{selectedCandidate.installment_count} × {label(selectedCandidate.payment_frequency)}</strong></div>
            </section>

            <div className="finance-activation__form-grid">
              <Field
                title="First installment due date"
                hint="Must be today or later and should match the approved quotation."
              >
                <input
                  required
                  type="date"
                  min={today()}
                  value={form.first_due_date}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      first_due_date: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field title="Grace days" hint="0 to 90 days after each due date.">
                <input
                  required
                  type="number"
                  min="0"
                  max="90"
                  value={form.grace_days}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      grace_days: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field
                title="Activation notes"
                hint="Record any approved operational clarification."
                wide
              >
                <textarea
                  rows="4"
                  value={form.activation_notes}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      activation_notes: event.target.value,
                    }))
                  }
                />
              </Field>
            </div>

            <label className="finance-activation__confirmation">
              <input
                type="checkbox"
                checked={form.terms_accepted}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    terms_accepted: event.target.checked,
                  }))
                }
              />
              <span>
                <strong>I confirm the approved Finance terms</strong>
                <small>
                  This creates the Finance agreement and schedule only. It records no
                  payment, reserves no machine and creates no Hire work.
                </small>
              </span>
            </label>

            <div className="finance-activation__warning">
              <strong>Machine remains unreserved</strong>
              <p>
                A later controlled deposit-and-reservation step must verify payment before
                the equipment is committed to this agreement.
              </p>
            </div>

            <div className="finance-activation__form-actions">
              <button type="button" onClick={() => setSelectedCandidate(null)}>
                Cancel
              </button>
              <button
                className="is-primary"
                type="submit"
                disabled={saving || !form.terms_accepted}
              >
                {saving ? "Activating…" : "Activate agreement and schedule"}
              </button>
            </div>
          </form>
        </Drawer>
      ) : null}
    </main>
  );
}
