import { useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";

function dateTime(value) {
  if (!value) return "-";

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

function groupTitle(value) {
  return String(value || "other")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function ProtectedUnlock({ token, onToken }) {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const active =
    Boolean(token?.value) &&
    Number(token?.expiresAt || 0) > Date.now();

  async function unlock(event) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await axiosClient.post(
        "/release2-final/security/unlock",
        { password }
      );

      setPassword("");

      onToken({
        value: response.data.protected_action_token,
        expiresAt:
          Date.now() +
          Number(response.data.expires_in_minutes || 10) *
            60 *
            1000,
      });
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Protected Action Unlock failed."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="gcc-card gcc-unlock">
      <div>
        <span className="gcc-eyebrow">Protected administration</span>
        <h2>Unlock configuration changes</h2>
        <p>
          Viewing configuration is read-only. Saving any group setting or
          document sequence requires the current administrator password and
          creates audit and privileged-ledger evidence.
        </p>
      </div>

      {active ? (
        <div className="gcc-message success">
          Protected configuration changes are temporarily unlocked.
        </div>
      ) : (
        <form onSubmit={unlock}>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Current administrator password"
            autoComplete="current-password"
            required
          />
          <button type="submit" disabled={loading}>
            {loading ? "Unlocking..." : "Unlock Protected Changes"}
          </button>
        </form>
      )}

      {error ? <div className="gcc-message error">{error}</div> : null}
    </section>
  );
}

function SettingInput({ setting, value, onChange }) {
  if (setting.value_type === "boolean") {
    return (
      <select
        value={String(value)}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="true">Enabled</option>
        <option value="false">Disabled</option>
      </select>
    );
  }

  if (
    setting.value_type === "integer" ||
    setting.value_type === "decimal"
  ) {
    return (
      <input
        type="number"
        min="0"
        step={setting.value_type === "integer" ? "1" : "0.01"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  if (setting.value_type === "time") {
    return (
      <input
        type="time"
        value={String(value || "").slice(0, 5)}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  return (
    <input
      type="text"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      maxLength={1000}
    />
  );
}

export default function GroupConfigurationPage() {
  const [settings, setSettings] = useState([]);
  const [sequences, setSequences] = useState([]);
  const [history, setHistory] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [sequenceDrafts, setSequenceDrafts] = useState({});
  const [reason, setReason] = useState("");
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const groupedSettings = useMemo(
    () =>
      settings.reduce((result, setting) => {
        if (!result[setting.setting_group]) {
          result[setting.setting_group] = [];
        }

        result[setting.setting_group].push(setting);
        return result;
      }, {}),
    [settings]
  );

  const tokenReady =
    Boolean(token?.value) &&
    Number(token?.expiresAt || 0) > Date.now();

  async function load() {
    setLoading(true);
    setError("");

    try {
      const [
        configurationResponse,
        sequenceResponse,
        historyResponse,
      ] = await Promise.all([
        axiosClient.get("/group-configuration"),
        axiosClient.get("/group-configuration/sequences"),
        axiosClient.get("/group-configuration/history", {
          params: { limit: 80 },
        }),
      ]);

      const loadedSettings =
        configurationResponse.data?.settings || [];
      const loadedSequences =
        sequenceResponse.data?.sequences || [];

      setSettings(loadedSettings);
      setSequences(loadedSequences);
      setHistory(historyResponse.data?.history || []);

      setDrafts(
        Object.fromEntries(
          loadedSettings.map((setting) => [
            setting.setting_key,
            String(setting.value),
          ])
        )
      );

      setSequenceDrafts(
        Object.fromEntries(
          loadedSequences.map((sequence) => [
            sequence.sequence_code,
            {
              prefix: sequence.prefix,
              next_number: String(sequence.next_number),
              padding: String(sequence.padding),
              reset_policy: sequence.reset_policy,
              include_year: sequence.include_year,
              include_month: sequence.include_month,
              separator: sequence.separator,
              is_active: sequence.is_active,
            },
          ])
        )
      );
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Group Configuration could not be loaded."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function requireSaveAccess() {
    if (!tokenReady) {
      setError(
        "Unlock protected changes before saving configuration."
      );
      return false;
    }

    if (reason.trim().length < 5) {
      setError(
        "Enter a clear change reason of at least 5 characters."
      );
      return false;
    }

    return true;
  }

  async function saveSetting(setting) {
    setError("");
    setMessage("");

    if (!requireSaveAccess()) return;

    setSavingKey(setting.setting_key);

    try {
      const response = await axiosClient.put(
        `/group-configuration/settings/${encodeURIComponent(
          setting.setting_key
        )}`,
        {
          value: drafts[setting.setting_key],
          reason: reason.trim(),
        },
        {
          headers: {
            "X-Protected-Action-Token": token.value,
          },
        }
      );

      setMessage(response.data.message);
      await load();
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Configuration could not be saved."
      );
    } finally {
      setSavingKey("");
    }
  }

  async function saveSequence(sequence) {
    setError("");
    setMessage("");

    if (!requireSaveAccess()) return;

    const draft = sequenceDrafts[sequence.sequence_code];

    if (!draft) return;

    setSavingKey(`sequence:${sequence.sequence_code}`);

    try {
      const response = await axiosClient.put(
        `/group-configuration/sequences/${sequence.sequence_code}`,
        {
          ...draft,
          next_number: Number(draft.next_number),
          padding: Number(draft.padding),
          reason: reason.trim(),
        },
        {
          headers: {
            "X-Protected-Action-Token": token.value,
          },
        }
      );

      setMessage(response.data.message);
      await load();
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Document sequence could not be saved."
      );
    } finally {
      setSavingKey("");
    }
  }

  function updateSequenceDraft(code, key, value) {
    setSequenceDrafts((current) => ({
      ...current,
      [code]: {
        ...current[code],
        [key]: value,
      },
    }));
  }

  if (loading && settings.length === 0) {
    return (
      <div className="gcc-loading">
        Loading Group Configuration Centre...
      </div>
    );
  }

  return (
    <div className="gcc-page">
      <style>{`
        .gcc-page {
          display: grid;
          gap: 18px;
          color: #0f172a;
        }

        .gcc-page * {
          box-sizing: border-box;
        }

        .gcc-hero {
          border-radius: 30px;
          padding: 25px;
          color: #fff;
          background:
            radial-gradient(circle at 12% 10%, rgba(245, 190, 34, .27), transparent 32%),
            linear-gradient(135deg, #07182c, #123a66 62%, #111827);
          box-shadow: 0 26px 65px rgba(7, 24, 44, .22);
        }

        .gcc-eyebrow {
          display: block;
          margin-bottom: 7px;
          color: #f4cf50;
          font-size: 11px;
          font-weight: 950;
          letter-spacing: .1em;
          text-transform: uppercase;
        }

        .gcc-hero h1,
        .gcc-card h2,
        .gcc-card h3 {
          margin: 0;
        }

        .gcc-hero h1 {
          font-size: clamp(31px, 5vw, 53px);
          line-height: .98;
          letter-spacing: -.055em;
        }

        .gcc-hero p,
        .gcc-card p {
          line-height: 1.55;
        }

        .gcc-hero p {
          max-width: 850px;
          color: rgba(255,255,255,.76);
          font-weight: 750;
        }

        .gcc-card {
          border: 1px solid #e2e8f0;
          border-radius: 26px;
          padding: 19px;
          background: rgba(255,255,255,.96);
          box-shadow: 0 20px 55px rgba(15,23,42,.07);
        }

        .gcc-unlock {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(280px, 420px);
          gap: 18px;
          align-items: center;
        }

        .gcc-unlock form,
        .gcc-reason-row {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }

        .gcc-unlock input,
        .gcc-reason-row input,
        .gcc-setting input,
        .gcc-setting select,
        .gcc-sequence input,
        .gcc-sequence select {
          width: 100%;
          border: 1px solid #cbd5e1;
          border-radius: 14px;
          padding: 11px 12px;
          background: #fff;
          color: #0f172a;
          font-weight: 800;
        }

        .gcc-unlock form input {
          flex: 1 1 220px;
        }

        .gcc-page button {
          border: 0;
          border-radius: 14px;
          padding: 11px 14px;
          background: #0b3158;
          color: #fff;
          font-weight: 950;
          cursor: pointer;
        }

        .gcc-page button:disabled {
          opacity: .55;
          cursor: not-allowed;
        }

        .gcc-message {
          border-radius: 16px;
          padding: 13px 14px;
          font-weight: 850;
        }

        .gcc-message.success {
          background: #f0fdf4;
          color: #166534;
          border: 1px solid #bbf7d0;
        }

        .gcc-message.error {
          background: #fef2f2;
          color: #991b1b;
          border: 1px solid #fecaca;
        }

        .gcc-policy {
          background: #eff6ff;
          border-color: #bfdbfe;
          color: #1e3a8a;
        }

        .gcc-reason-row {
          align-items: center;
        }

        .gcc-reason-row input {
          flex: 1 1 380px;
        }

        .gcc-section-heading {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 15px;
          margin-bottom: 15px;
        }

        .gcc-section-heading span {
          color: #64748b;
          font-weight: 800;
        }

        .gcc-settings-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 13px;
        }

        .gcc-setting {
          border: 1px solid #e2e8f0;
          border-radius: 19px;
          padding: 14px;
          background: #f8fafc;
        }

        .gcc-setting header {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 11px;
        }

        .gcc-setting header strong {
          color: #0b3158;
        }

        .gcc-setting header span {
          color: #64748b;
          font-size: 11px;
          font-weight: 900;
          text-transform: uppercase;
        }

        .gcc-setting p {
          min-height: 42px;
          color: #64748b;
          font-size: 13px;
          font-weight: 750;
        }

        .gcc-setting footer {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          align-items: center;
          margin-top: 10px;
        }

        .gcc-setting footer small {
          color: #64748b;
          font-weight: 750;
        }

        .gcc-sequence-wrap,
        .gcc-history-wrap {
          overflow-x: auto;
        }

        .gcc-sequence-table,
        .gcc-history-table {
          width: 100%;
          min-width: 980px;
          border-collapse: separate;
          border-spacing: 0 9px;
        }

        .gcc-sequence-table th,
        .gcc-history-table th {
          padding: 0 10px 5px;
          color: #64748b;
          font-size: 11px;
          text-align: left;
          text-transform: uppercase;
        }

        .gcc-sequence-table td,
        .gcc-history-table td {
          padding: 10px;
          background: #f8fafc;
          border-top: 1px solid #e2e8f0;
          border-bottom: 1px solid #e2e8f0;
          vertical-align: top;
          font-weight: 750;
        }

        .gcc-sequence-table td:first-child,
        .gcc-history-table td:first-child {
          border-left: 1px solid #e2e8f0;
          border-radius: 15px 0 0 15px;
        }

        .gcc-sequence-table td:last-child,
        .gcc-history-table td:last-child {
          border-right: 1px solid #e2e8f0;
          border-radius: 0 15px 15px 0;
        }

        .gcc-loading {
          padding: 30px;
          text-align: center;
          font-weight: 900;
        }

        @media (max-width: 900px) {
          .gcc-unlock,
          .gcc-settings-grid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 650px) {
          .gcc-hero,
          .gcc-card {
            border-radius: 21px;
            padding: 15px;
          }

          .gcc-section-heading {
            display: block;
          }

          .gcc-setting footer {
            align-items: stretch;
            flex-direction: column;
          }

          .gcc-setting footer button {
            width: 100%;
          }
        }
      `}</style>

      <section className="gcc-hero">
        <span className="gcc-eyebrow">
          Release 3 Â· Group administration
        </span>
        <h1>Group Configuration Centre</h1>
        <p>
          Manage company identity, workspace names, operational units,
          Executive thresholds, feature readiness and database-backed document
          numbering. Secrets, API keys, passwords and credentials are never
          displayed or stored here.
        </p>
      </section>

      {message ? (
        <div className="gcc-message success">{message}</div>
      ) : null}

      {error ? (
        <div className="gcc-message error">{error}</div>
      ) : null}

      <ProtectedUnlock token={token} onToken={setToken} />

      <section className="gcc-card gcc-policy">
        <strong>Configuration safety policy</strong>
        <p>
          Every saved change requires Protected Action Unlock and a written
          reason. Changes are recorded in Activity Log, configuration history
          and the tamper-evident privileged ledger.
        </p>

        <div className="gcc-reason-row">
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Required reason for the next saved change"
            maxLength={500}
          />

          <button type="button" onClick={load}>
            Refresh Configuration
          </button>
        </div>
      </section>

      {Object.entries(groupedSettings).map(
        ([groupName, groupSettings]) => (
          <section className="gcc-card" key={groupName}>
            <div className="gcc-section-heading">
              <div>
                <span className="gcc-eyebrow">
                  Group configuration
                </span>
                <h2>{groupTitle(groupName)}</h2>
              </div>
              <span>{groupSettings.length} setting(s)</span>
            </div>

            <div className="gcc-settings-grid">
              {groupSettings.map((setting) => (
                <article
                  className="gcc-setting"
                  key={setting.setting_key}
                >
                  <header>
                    <strong>{setting.setting_label}</strong>
                    <span>{setting.value_type}</span>
                  </header>

                  <p>{setting.setting_description}</p>

                  <SettingInput
                    setting={setting}
                    value={drafts[setting.setting_key] ?? ""}
                    onChange={(value) =>
                      setDrafts((current) => ({
                        ...current,
                        [setting.setting_key]: value,
                      }))
                    }
                  />

                  <footer>
                    <small>
                      Updated {dateTime(setting.updated_at)}
                    </small>
                    <button
                      type="button"
                      disabled={
                        savingKey === setting.setting_key ||
                        !setting.is_editable
                      }
                      onClick={() => saveSetting(setting)}
                    >
                      {savingKey === setting.setting_key
                        ? "Saving..."
                        : "Save Setting"}
                    </button>
                  </footer>
                </article>
              ))}
            </div>
          </section>
        )
      )}

      <section className="gcc-card">
        <div className="gcc-section-heading">
          <div>
            <span className="gcc-eyebrow">
              Database-backed numbering
            </span>
            <h2>Document Sequences</h2>
          </div>
          <span>{sequences.length} sequence(s)</span>
        </div>

        <div className="gcc-sequence-wrap">
          <table className="gcc-sequence-table">
            <thead>
              <tr>
                <th>Document</th>
                <th>Prefix</th>
                <th>Next number</th>
                <th>Padding</th>
                <th>Reset</th>
                <th>Year</th>
                <th>Month</th>
                <th>Preview</th>
                <th>Action</th>
              </tr>
            </thead>

            <tbody>
              {sequences.map((sequence) => {
                const draft =
                  sequenceDrafts[sequence.sequence_code] || {};

                return (
                  <tr key={sequence.sequence_code}>
                    <td>
                      <strong>{sequence.sequence_code}</strong>
                      <br />
                      {sequence.document_name}
                      <br />
                      <small>{sequence.workspace_code}</small>
                    </td>
                    <td>
                      <input
                        value={draft.prefix || ""}
                        onChange={(event) =>
                          updateSequenceDraft(
                            sequence.sequence_code,
                            "prefix",
                            event.target.value.toUpperCase()
                          )
                        }
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="1"
                        value={draft.next_number || ""}
                        onChange={(event) =>
                          updateSequenceDraft(
                            sequence.sequence_code,
                            "next_number",
                            event.target.value
                          )
                        }
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="2"
                        max="10"
                        value={draft.padding || ""}
                        onChange={(event) =>
                          updateSequenceDraft(
                            sequence.sequence_code,
                            "padding",
                            event.target.value
                          )
                        }
                      />
                    </td>
                    <td>
                      <select
                        value={draft.reset_policy || "none"}
                        onChange={(event) =>
                          updateSequenceDraft(
                            sequence.sequence_code,
                            "reset_policy",
                            event.target.value
                          )
                        }
                      >
                        <option value="none">Never</option>
                        <option value="year">Yearly</option>
                        <option value="month">Monthly</option>
                      </select>
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={Boolean(draft.include_year)}
                        onChange={(event) =>
                          updateSequenceDraft(
                            sequence.sequence_code,
                            "include_year",
                            event.target.checked
                          )
                        }
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={Boolean(draft.include_month)}
                        onChange={(event) =>
                          updateSequenceDraft(
                            sequence.sequence_code,
                            "include_month",
                            event.target.checked
                          )
                        }
                      />
                    </td>
                    <td>
                      <strong>{sequence.preview_number}</strong>
                    </td>
                    <td>
                      <button
                        type="button"
                        disabled={
                          savingKey ===
                          `sequence:${sequence.sequence_code}`
                        }
                        onClick={() => saveSequence(sequence)}
                      >
                        {savingKey ===
                        `sequence:${sequence.sequence_code}`
                          ? "Saving..."
                          : "Save"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="gcc-card">
        <div className="gcc-section-heading">
          <div>
            <span className="gcc-eyebrow">Audit evidence</span>
            <h2>Recent Configuration History</h2>
          </div>
          <span>{history.length} recent change(s)</span>
        </div>

        <div className="gcc-history-wrap">
          <table className="gcc-history-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Setting</th>
                <th>Old value</th>
                <th>New value</th>
                <th>Reason</th>
                <th>Changed by</th>
                <th>Request ID</th>
              </tr>
            </thead>

            <tbody>
              {history.length === 0 ? (
                <tr>
                  <td colSpan="7">
                    No group configuration change has been recorded.
                  </td>
                </tr>
              ) : (
                history.map((item) => (
                  <tr key={item.id}>
                    <td>{dateTime(item.created_at)}</td>
                    <td>
                      <strong>{item.setting_label}</strong>
                      <br />
                      <small>{item.setting_key}</small>
                    </td>
                    <td>{String(item.old_value ?? "-")}</td>
                    <td>{String(item.new_value ?? "-")}</td>
                    <td>{item.change_reason}</td>
                    <td>{item.changed_by_name}</td>
                    <td>{item.request_id || "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}