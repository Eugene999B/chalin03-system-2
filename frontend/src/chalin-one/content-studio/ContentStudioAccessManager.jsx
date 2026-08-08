import { useCallback, useEffect, useMemo, useState } from "react";
import {
  contentStudioAccessError,
  createContentStudioAccount,
  listContentStudioAccounts,
  listContentStudioRoles,
  resetContentStudioAccountPassword,
  updateContentStudioAccount,
} from "./contentStudioAccessApi";
import "./contentStudioAccessManager.css";

const EMPTY_FORM = Object.freeze({
  full_name: "",
  username: "",
  phone: "",
  temporary_password: "",
  role_code: "editor",
});

function roleLabel(account) {
  return account.role_name || account.role_code || "Studio role";
}

export default function ContentStudioAccessManager() {
  const [roles, setRoles] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [creating, setCreating] = useState(false);
  const [resetTarget, setResetTarget] = useState(null);
  const [resetPassword, setResetPassword] = useState("");
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [nextRoles, nextAccounts] = await Promise.all([
        listContentStudioRoles(),
        listContentStudioAccounts(),
      ]);
      setRoles(Array.isArray(nextRoles) ? nextRoles : []);
      setAccounts(Array.isArray(nextAccounts) ? nextAccounts : []);
    } catch (loadError) {
      setError(contentStudioAccessError(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const activeCount = useMemo(
    () => accounts.filter((account) => account.access_active !== false).length,
    [accounts]
  );

  async function submitCreate(event) {
    event.preventDefault();
    setCreating(true);
    setError("");
    setNotice("");
    try {
      await createContentStudioAccount(form);
      setForm({ ...EMPTY_FORM });
      setNotice("Studio-only account created. No operational business access was assigned.");
      await load();
    } catch (createError) {
      setError(contentStudioAccessError(createError));
    } finally {
      setCreating(false);
    }
  }

  async function updateAccount(account, patch) {
    setBusyId(account.id);
    setError("");
    setNotice("");
    try {
      await updateContentStudioAccount(account.id, patch);
      setNotice(`${account.full_name || account.username} was updated and active sessions were revoked.`);
      await load();
    } catch (updateError) {
      setError(contentStudioAccessError(updateError));
    } finally {
      setBusyId(null);
    }
  }

  async function submitReset(event) {
    event.preventDefault();
    if (!resetTarget) return;
    setBusyId(resetTarget.id);
    setError("");
    setNotice("");
    try {
      await resetContentStudioAccountPassword(resetTarget.id, resetPassword);
      setNotice(`Temporary password reset for ${resetTarget.full_name || resetTarget.username}. The account must change it after login.`);
      setResetTarget(null);
      setResetPassword("");
      await load();
    } catch (resetError) {
      setError(contentStudioAccessError(resetError));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="cs-access-manager">
      <header className="cs-access-manager-hero">
        <div>
          <span>PHASE 2A / IDENTITY CONTROL</span>
          <h1>Studio Team & Access</h1>
          <p>
            Create dedicated publishing identities without granting Spare Parts, Mining or Equipment operational access.
            The original System Administrator remains the protected owner.
          </p>
        </div>
        <div className="cs-access-stats">
          <article><strong>{accounts.length}</strong><span>Studio identities</span></article>
          <article><strong>{activeCount}</strong><span>Active access</span></article>
          <article><strong>{roles.length}</strong><span>Governed roles</span></article>
        </div>
      </header>

      {error ? <div className="cs-access-message is-error" role="alert">{error}</div> : null}
      {notice ? <div className="cs-access-message is-success" role="status">{notice}</div> : null}

      <section className="cs-access-role-grid" aria-label="Content Studio role templates">
        {roles.map((role) => (
          <article key={role.role_code}>
            <span>{role.role_code.replaceAll("_", " ")}</span>
            <h2>{role.name}</h2>
            <p>{role.description}</p>
            <div><b>{role.permissions?.length || 0}</b> permissions · <b>{role.scopes?.length || 0}</b> Studio areas</div>
          </article>
        ))}
      </section>

      <section className="cs-access-create">
        <div>
          <span>CREATE / STUDIO ONLY</span>
          <h2>New publishing identity.</h2>
          <p>These accounts are deliberately created with global role <b>staff</b>, no default store and no business-unit assignment.</p>
        </div>
        <form onSubmit={submitCreate}>
          <label><span>Full name</span><input required value={form.full_name} onChange={(event) => setForm((value) => ({ ...value, full_name: event.target.value }))} /></label>
          <label><span>Username</span><input required autoComplete="off" value={form.username} onChange={(event) => setForm((value) => ({ ...value, username: event.target.value }))} /></label>
          <label><span>Registered phone <small>optional</small></span><input type="tel" value={form.phone} onChange={(event) => setForm((value) => ({ ...value, phone: event.target.value }))} /></label>
          <label><span>Studio role</span><select value={form.role_code} onChange={(event) => setForm((value) => ({ ...value, role_code: event.target.value }))}>{roles.map((role) => <option key={role.role_code} value={role.role_code}>{role.name}</option>)}</select></label>
          <label className="is-wide"><span>Temporary password</span><input type="password" required autoComplete="new-password" value={form.temporary_password} onChange={(event) => setForm((value) => ({ ...value, temporary_password: event.target.value }))} /><small>8+ characters with uppercase, lowercase, number and symbol. The user must change it after login.</small></label>
          <button type="submit" disabled={creating}>{creating ? "Creating isolated account…" : "Create Studio-only account"}<b>↗</b></button>
        </form>
      </section>

      <section className="cs-access-accounts">
        <header><div><span>ACTIVE DIRECTORY</span><h2>Who can enter Content Studio.</h2></div><button type="button" onClick={load} disabled={loading}>Refresh</button></header>
        {loading ? <div className="cs-access-empty">Loading Studio identities…</div> : accounts.length === 0 ? <div className="cs-access-empty">No Studio identities are configured.</div> : (
          <div className="cs-access-account-list">
            {accounts.map((account) => (
              <article key={`${account.protected_owner ? "owner" : "user"}-${account.id}`} className={account.protected_owner ? "is-owner" : ""}>
                <div className="cs-access-account-id">
                  <span>{account.protected_owner ? "OWNER" : account.access_mode === "studio_only" ? "STUDIO ONLY" : "HYBRID"}</span>
                  <h3>{account.full_name || account.username}</h3>
                  <p>@{account.username}</p>
                </div>
                <div className="cs-access-account-role">
                  <small>Role</small>
                  {account.protected_owner ? <strong>{roleLabel(account)}</strong> : (
                    <select
                      value={account.role_code || ""}
                      disabled={busyId === account.id}
                      onChange={(event) => updateAccount(account, { role_code: event.target.value, is_active: account.access_active !== false })}
                    >
                      {roles.map((role) => <option key={role.role_code} value={role.role_code}>{role.name}</option>)}
                    </select>
                  )}
                </div>
                <div className="cs-access-account-state">
                  <small>Access</small>
                  <strong>{account.access_active === false ? "Disabled" : "Active"}</strong>
                  {account.must_change_password ? <span>Password change required</span> : null}
                </div>
                <div className="cs-access-account-actions">
                  {account.protected_owner ? <span className="cs-owner-lock">Protected identity</span> : (
                    <>
                      <button type="button" onClick={() => setResetTarget(account)} disabled={busyId === account.id}>Reset password</button>
                      <button
                        type="button"
                        className={account.access_active === false ? "is-enable" : "is-disable"}
                        disabled={busyId === account.id}
                        onClick={() => updateAccount(account, { is_active: account.access_active === false, role_code: account.role_code })}
                      >
                        {account.access_active === false ? "Enable" : "Disable"}
                      </button>
                    </>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {resetTarget ? (
        <div className="cs-access-reset" role="dialog" aria-modal="true" aria-labelledby="cs-reset-title">
          <button type="button" className="cs-access-reset-backdrop" aria-label="Close reset password dialog" onClick={() => setResetTarget(null)} />
          <form onSubmit={submitReset}>
            <span>SECURITY / PASSWORD RESET</span>
            <h2 id="cs-reset-title">Reset {resetTarget.full_name || resetTarget.username}</h2>
            <p>All active sessions will be revoked. The new temporary password must be changed at the next Content Studio login.</p>
            <label><span>New temporary password</span><input autoFocus type="password" required autoComplete="new-password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} /></label>
            <div><button type="button" onClick={() => setResetTarget(null)}>Cancel</button><button type="submit" disabled={busyId === resetTarget.id}>Reset securely</button></div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
