import { useCallback, useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import "../styles/installmentCompletionPhaseFour.css";

const API = "/equipment-catalogue/sales/completion-phase-four";
const CONFIRMATION = "RESET FINANCE TEST DATA";

function number(value) {
  return Number(value || 0).toLocaleString("en-GH");
}

function errorMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

export default function InstallmentCompletionPhaseFourPage() {
  const { user, effectivePermissions = [] } = useAuth();
  const [readiness, setReadiness] = useState(null);
  const [dryRun, setDryRun] = useState(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmation, setConfirmation] = useState("");

  const role = String(user?.role || "").toLowerCase();
  const originalAdministrator = Boolean(user?.is_original_system_administrator);
  const canManage =
    effectivePermissions.includes("fleet.assets.manage") ||
    ["admin", "administrator", "system_administrator", "super_admin"].includes(role);

  const loadReadiness = useCallback(async () => {
    setLoading(true);
    setProblem("");
    try {
      const response = await axiosClient.get(`${API}/readiness`);
      setReadiness(response.data?.readiness || null);
    } catch (error) {
      setProblem(errorMessage(error, "Could not verify the final Finance completion status."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadReadiness();
  }, [loadReadiness]);

  const counts = readiness?.portfolio_counts || {};
  const reset = readiness?.reset || {};
  const executeEnabled = Boolean(reset.enabled && originalAdministrator && canManage);
  const confirmationReady = confirmation.trim() === CONFIRMATION;

  const totalFinanceRows = useMemo(
    () =>
      Object.values(counts).reduce(
        (total, value) => total + (Number.isFinite(Number(value)) ? Number(value) : 0),
        0
      ),
    [counts]
  );

  async function runDryRun() {
    setWorking("dry-run");
    setProblem("");
    setNotice("");
    try {
      const response = await axiosClient.post(`${API}/reset/dry-run`);
      setDryRun(response.data?.dry_run || null);
      setNotice("Read-only Finance reset impact prepared. No data was changed.");
    } catch (error) {
      setProblem(errorMessage(error, "Could not prepare the Finance reset dry run."));
    } finally {
      setWorking("");
    }
  }

  async function executeTestReset() {
    if (!executeEnabled || !confirmationReady) return;
    setWorking("execute");
    setProblem("");
    setNotice("");
    try {
      const response = await axiosClient.post(`${API}/reset/execute`, { confirmation });
      setNotice(response.data?.message || "Finance test data reset completed.");
      setConfirmation("");
      setDryRun(null);
      await loadReadiness();
    } catch (error) {
      setProblem(errorMessage(error, "Finance test reset was blocked."));
    } finally {
      setWorking("");
    }
  }

  return (
    <main className="finance-completion-four">
      <section className="finance-completion-four__hero">
        <div>
          <p className="finance-completion-four__eyebrow">Installment Completion Phase 4</p>
          <h1>Final Operations & Reset Centre</h1>
          <p>
            Verify arrears, recovery, settings, permissions, completion documents and the
            full Finance lifecycle before any test-data cleanup is considered.
          </p>
        </div>
        <div className="finance-completion-four__seal" aria-label="Chalin 03 Finance completion">
          <strong>C03</strong>
          <span>FINANCE READY</span>
        </div>
      </section>

      {problem ? <div className="finance-completion-four__alert is-error">{problem}</div> : null}
      {notice ? <div className="finance-completion-four__alert is-success">{notice}</div> : null}

      <section className="finance-completion-four__production-lock">
        <div aria-hidden="true">🛡️</div>
        <div>
          <strong>Production reset is permanently blocked</strong>
          <p>
            This release does not delete Railway production Finance data. The execution route
            works only with <code>NODE_ENV=test</code>, an explicit test-reset flag and a database
            name containing <code>_test</code>.
          </p>
        </div>
      </section>

      {loading ? (
        <section className="finance-completion-four__loading" role="status">
          Verifying the complete Finance operating system…
        </section>
      ) : (
        <>
          <section className="finance-completion-four__summary">
            <article>
              <span>Operational controls</span>
              <strong>{number(readiness?.features?.filter((item) => item.complete).length)} / {number(readiness?.features?.length)}</strong>
              <small>verified complete</small>
            </article>
            <article>
              <span>Finance applications</span>
              <strong>{number(counts.applications)}</strong>
              <small>current database</small>
            </article>
            <article>
              <span>Active history footprint</span>
              <strong>{number(totalFinanceRows)}</strong>
              <small>rows represented in the dry run</small>
            </article>
            <article>
              <span>Database readiness</span>
              <strong>{readiness?.ready ? "READY" : "BLOCKED"}</strong>
              <small>{readiness?.database || "database unavailable"}</small>
            </article>
          </section>

          <section className="finance-completion-four__section">
            <div className="finance-completion-four__section-heading">
              <div>
                <p>Operational completion</p>
                <h2>Every promised Finance control</h2>
              </div>
              <button type="button" onClick={loadReadiness} disabled={loading || Boolean(working)}>
                Refresh verification
              </button>
            </div>
            <div className="finance-completion-four__feature-grid">
              {(readiness?.features || []).map((feature) => (
                <article key={feature.code} className={feature.complete ? "is-complete" : "is-blocked"}>
                  <span aria-hidden="true">{feature.complete ? "✓" : "!"}</span>
                  <div>
                    <h3>{feature.title}</h3>
                    <p>{feature.evidence}</p>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="finance-completion-four__section">
            <div className="finance-completion-four__section-heading">
              <div>
                <p>Read-only safety proof</p>
                <h2>Finance reset dry run</h2>
              </div>
              <button
                type="button"
                className="is-primary"
                onClick={runDryRun}
                disabled={!canManage || !originalAdministrator || Boolean(working)}
              >
                {working === "dry-run" ? "Preparing…" : "Prepare Dry Run"}
              </button>
            </div>

            {!originalAdministrator ? (
              <div className="finance-completion-four__note">
                Only the original System Administrator can produce reset evidence.
              </div>
            ) : null}

            {dryRun ? (
              <div className="finance-completion-four__dry-run">
                <div className="finance-completion-four__fingerprint">
                  <span>Dry-run fingerprint</span>
                  <code>{dryRun.fingerprint}</code>
                </div>
                <div className="finance-completion-four__table-list">
                  {(dryRun.table_impact || []).map((item) => (
                    <article key={item.table}>
                      <strong>{item.table}</strong>
                      <span>{number(item.total_rows)} rows</span>
                      <small>{String(item.reset_scope || "").replaceAll("_", " ")}</small>
                    </article>
                  ))}
                </div>
                <div className="finance-completion-four__preserves">
                  <strong>Always preserved</strong>
                  <ul>
                    {(dryRun.preserves || []).map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </div>
              </div>
            ) : (
              <div className="finance-completion-four__empty">
                The dry run reads table counts and scope only. It performs no delete, update,
                truncate or production reset.
              </div>
            )}
          </section>

          <section className="finance-completion-four__section is-danger-zone">
            <div className="finance-completion-four__section-heading">
              <div>
                <p>Disposable test database only</p>
                <h2>Controlled test reset</h2>
              </div>
              <span className={executeEnabled ? "is-enabled" : "is-locked"}>
                {executeEnabled ? "TEST RESET ENABLED" : "LOCKED"}
              </span>
            </div>
            <p className="finance-completion-four__reset-message">{reset.message}</p>
            <label>
              Exact confirmation phrase
              <input
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                placeholder={CONFIRMATION}
                autoComplete="off"
                disabled={!executeEnabled || Boolean(working)}
              />
            </label>
            <button
              type="button"
              className="is-danger"
              onClick={executeTestReset}
              disabled={!executeEnabled || !confirmationReady || Boolean(working)}
            >
              {working === "execute" ? "Resetting test data…" : "Reset Test Finance Data"}
            </button>
            <small>
              Railway production always returns <code>PRODUCTION_FINANCE_RESET_PERMANENTLY_BLOCKED</code>.
            </small>
          </section>

          <section className="finance-completion-four__fresh-proof">
            <div>
              <p>Final acceptance</p>
              <h2>Fresh installment journey</h2>
              <span>
                Customer → excavator → application → approval → agreement → deposit → payment →
                arrears follow-up → documents → settlement → ownership.
              </span>
            </div>
            <strong>PRODUCTION-SHAPED BROWSER PROOF REQUIRED</strong>
          </section>
        </>
      )}
    </main>
  );
}
