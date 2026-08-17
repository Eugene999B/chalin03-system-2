import { useCallback, useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import "../styles/installmentCompletionPhaseFour.css";

const API = "/equipment-catalogue/sales/completion-phase-four";
const CONFIRMATION = "RESET INSTALLMENT FINANCE";
function number(value) { return Number(value || 0).toLocaleString("en-GH"); }
function errorMessage(error, fallback) { return error?.response?.data?.message || error?.message || fallback; }

export default function InstallmentCompletionPhaseFourPage() {
  const { user, effectivePermissions = [] } = useAuth();
  const [readiness, setReadiness] = useState(null);
  const [dryRun, setDryRun] = useState(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");

  const role = String(user?.role || "").toLowerCase();
  const originalAdministrator = Boolean(user?.is_original_system_administrator);
  const canManage = effectivePermissions.includes("fleet.assets.manage") || ["admin", "administrator", "system_administrator", "super_admin"].includes(role);
  const confirmationReady = confirmation.trim() === CONFIRMATION;
  const resetReady = Boolean(dryRun?.fingerprint && password && confirmationReady && originalAdministrator && canManage);

  const loadReadiness = useCallback(async () => {
    setLoading(true); setProblem("");
    try { const response = await axiosClient.get(`${API}/readiness`); setReadiness(response.data?.readiness || null); }
    catch (error) { setProblem(errorMessage(error, "Could not verify the Finance workspace.")); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { loadReadiness(); }, [loadReadiness]);

  const counts = readiness?.portfolio_counts || {};
  const totalFinanceRows = useMemo(() => Object.values(counts).reduce((total, value) => total + Number(value || 0), 0), [counts]);

  async function runDryRun() {
    setWorking("dry-run"); setProblem(""); setNotice("");
    try { const response = await axiosClient.post(`${API}/reset/dry-run`); setDryRun(response.data?.dry_run || null); setNotice("Reset scope prepared. Nothing has been deleted."); }
    catch (error) { setProblem(errorMessage(error, "Could not prepare the reset scope.")); }
    finally { setWorking(""); }
  }

  async function executeReset() {
    if (!resetReady) return;
    setWorking("execute"); setProblem(""); setNotice("");
    try {
      const response = await axiosClient.post(`${API}/reset/execute`, { password, confirmation, dry_run_fingerprint: dryRun.fingerprint });
      setNotice(response.data?.message || "Installment Finance reset completed.");
      setPassword(""); setConfirmation(""); setDryRun(null); await loadReadiness();
    } catch (error) { setProblem(errorMessage(error, "Installment Finance reset was blocked.")); }
    finally { setWorking(""); }
  }

  return (
    <main className="finance-completion-four">
      <section className="finance-completion-four__hero"><div><p className="finance-completion-four__eyebrow">Installment Finance</p><h1>Reset Centre</h1><p>Clear Installment Finance trial data, including legacy customer and excavator records created or linked through Installment. Shared records used by other modules remain protected.</p></div><div className="finance-completion-four__seal" aria-label="Installment reset protection"><strong>C03</strong><span>PROTECTED</span></div></section>
      {problem ? <div className="finance-completion-four__alert is-error">{problem}</div> : null}
      {notice ? <div className="finance-completion-four__alert is-success">{notice}</div> : null}
      {!originalAdministrator ? <section className="finance-completion-four__production-lock"><div aria-hidden="true">🔒</div><div><strong>Original System Administrator required</strong><p>This destructive action is unavailable to other accounts.</p></div></section> : null}
      {loading ? <section className="finance-completion-four__loading" role="status">Checking Installment Finance…</section> : <>
        <section className="finance-completion-four__summary"><article><span>Finance applications</span><strong>{number(counts.applications)}</strong><small>current database</small></article><article><span>Agreements</span><strong>{number(counts.agreements)}</strong><small>Installment only</small></article><article><span>Payments</span><strong>{number(counts.payments)}</strong><small>Installment only</small></article><article><span>Rows represented</span><strong>{number(totalFinanceRows)}</strong><small>database readiness</small></article></section>
        <section className="finance-completion-four__section"><div className="finance-completion-four__section-heading"><div><p>Step 1</p><h2>Review exactly what will be reset</h2></div><button type="button" className="is-primary" onClick={runDryRun} disabled={!originalAdministrator || !canManage || Boolean(working)}>{working === "dry-run" ? "Preparing…" : "Prepare Reset Review"}</button></div>
          {dryRun ? <div className="finance-completion-four__dry-run">
            <div className="finance-completion-four__fingerprint"><span>Reset fingerprint</span><code>{dryRun.fingerprint}</code></div>
            <div className="finance-completion-four__table-list">
              <article><strong>Installment customers</strong><span>{number(dryRun.customers)}</span><small>trial master records in scope</small></article>
              <article><strong>Installment excavators</strong><span>{number(dryRun.excavators)}</span><small>trial master records in scope</small></article>
              <article><strong>Trial graphs</strong><span>{number(dryRun.items?.length)}</span><small>individual deletion graphs</small></article>
            </div>
            <div className="finance-completion-four__table-list">{(dryRun.items || []).map((item) => <article key={`${item.entity_type}-${item.entity_id}`}><strong>{item.entity_type === "asset" ? "Excavator" : "Customer"} #{item.entity_id}</strong><span>{item.master_delete_eligible ? "Master will delete" : "Master preserved"}</span><small>{item.message}</small></article>)}</div>
          </div> : <div className="finance-completion-four__empty">The review is read-only. No records are changed until you complete Step 2.</div>}
        </section>
        <section className="finance-completion-four__section is-danger-zone"><div className="finance-completion-four__section-heading"><div><p>Step 2</p><h2>Authorize the reset</h2></div><span className={resetReady ? "is-enabled" : "is-locked"}>{resetReady ? "READY" : "LOCKED"}</span></div><div className="finance-completion-four__reset-message">Enter your current account password and type the exact phrase below.</div><label>Current password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" disabled={!dryRun || !originalAdministrator || Boolean(working)} /></label><label>Type exactly: <code>{CONFIRMATION}</code><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder={CONFIRMATION} autoComplete="off" disabled={!dryRun || !originalAdministrator || Boolean(working)} /></label><button type="button" className="is-danger" onClick={executeReset} disabled={!resetReady || Boolean(working)}>{working === "execute" ? "Resetting…" : "Reset Installment Finance Data"}</button><small>Server-side protection requires the original System Administrator, valid current password, fresh reset fingerprint and exact confirmation.</small></section>
      </>}
    </main>
  );
}
