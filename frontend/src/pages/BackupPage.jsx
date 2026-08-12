import { useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";

const RESTORE_CONFIRMATION_TEXT = "RESTORE_FULL_SYSTEM_BACKUP";
const BACKUP_DOWNLOAD_TIMEOUT_MS = 300000;
const BACKUP_VALIDATE_TIMEOUT_MS = 180000;
const BACKUP_SCHEMA_PREPARE_TIMEOUT_MS = 180000;
const BACKUP_RESTORE_TIMEOUT_MS = 600000;

function backupRequestUrl(pathname) {
  const suffix = String(pathname || "").startsWith("/")
    ? String(pathname || "")
    : `/${String(pathname || "")}`;
  return `/backups${suffix}`;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-GH");
}

function formatFileSize(value) {
  const size = Number(value || 0);
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(2)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(2)} KB`;
  return `${size} bytes`;
}

function backupReportErrors(report) {
  const directErrors = Array.isArray(report?.errors) ? report.errors : [];
  const validationErrors = Array.isArray(report?.validation_errors)
    ? report.validation_errors.map((item) =>
        typeof item === "string" ? item : item?.message || item?.code || "Invalid backup data."
      )
    : [];
  return [...directErrors, ...validationErrors].filter(Boolean);
}

function backupReportWarnings(report) {
  return Array.isArray(report?.warnings) ? report.warnings.filter(Boolean) : [];
}

function sourceOnlyColumnCount(report) {
  return Object.values(report?.source_only_columns || {}).reduce(
    (total, columns) => total + (Array.isArray(columns) ? columns.length : 0),
    0
  );
}

function backupRequestErrorMessage(requestError, fallback) {
  const status = Number(requestError.response?.status || 0);
  const report = requestError.response?.data || null;
  const details = backupReportErrors(report?.validation || report);
  if (status === 413) {
    return "This backup is larger than the server restore upload limit. The server must allow a larger protected backup request before validation can run.";
  }
  if (details.length > 0) {
    return `${report?.message || fallback} ${details.join(" ")}`.trim();
  }
  return report?.message || fallback;
}

function protectedUnlockErrorMessage(requestError) {
  const responseMessage = requestError.response?.data?.message;
  if (responseMessage) return responseMessage;

  // A browser policy/network failure has no HTTP response. Do not tell the
  // Administrator that their password was rejected when the verification
  // request never reached CHALIN.
  if (!requestError.response) {
    return "CHALIN could not reach the protected-action verification service. Your password was not rejected; the verification request was blocked or could not connect.";
  }

  return "Your current Administrator password was not accepted.";
}

export default function BackupPage() {
  const { user, branchCode, branchName, branchLocation, hasPermission } = useAuth();
  const role = String(user?.role || "").toLowerCase();
  const canDownload = role === "admin" && hasPermission("backup.download");
  const canValidate = role === "admin" && hasPermission("backup.validate");
  const canRestorePermission = role === "admin" && hasPermission("backup.restore");

  const currentStoreCode = branchCode || user?.branch_code || "STORE";
  const currentStoreName = branchName || user?.branch_name || "Selected Store";
  const currentStoreLocation = branchLocation || user?.branch_location || "";

  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedBackupInfo, setSelectedBackupInfo] = useState(null);
  const [confirmText, setConfirmText] = useState("");
  const [dryRunReport, setDryRunReport] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [preparingSchema, setPreparingSchema] = useState(false);
  const [unlockPassword, setUnlockPassword] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [protectedToken, setProtectedToken] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const tokenReady = Boolean(
    protectedToken?.value && protectedToken.expiresAt > Date.now()
  );
  const protectedHeaders = tokenReady
    ? { "X-Protected-Action-Token": protectedToken.value }
    : {};

  function getDownloadFilename(response) {
    const disposition = response.headers?.["content-disposition"] || "";
    const match = disposition.match(/filename="?([^";]+)"?/i);
    return match?.[1] || `chalin03-full-system-backup-${Date.now()}.json`;
  }

  async function readErrorBlob(requestError) {
    try {
      if (requestError.response?.data instanceof Blob) {
        const parsed = JSON.parse(await requestError.response.data.text());
        return parsed.message || "";
      }
    } catch {
      return "";
    }
    return requestError.response?.data?.message || "";
  }

  async function unlockProtectedActions(event) {
    event.preventDefault();
    setUnlocking(true);
    setError("");
    setMessage("");
    try {
      const response = await axiosClient.post("/release2-final/security/unlock", {
        password: unlockPassword,
      });
      setUnlockPassword("");
      setProtectedToken({
        value: response.data.protected_action_token,
        expiresAt:
          Date.now() + Number(response.data.expires_in_minutes || 10) * 60 * 1000,
      });
      setMessage(
        response.data.message ||
          "Backup and restore actions are unlocked for this page session."
      );
    } catch (requestError) {
      setError(protectedUnlockErrorMessage(requestError));
    } finally {
      setUnlocking(false);
    }
  }

  async function downloadBackup() {
    if (!tokenReady) {
      setError("Unlock protected actions with your current password first.");
      return;
    }
    setDownloading(true);
    setError("");
    setMessage("");
    try {
      const response = await axiosClient.get(backupRequestUrl("/download"), {
        responseType: "blob",
        headers: protectedHeaders,
        timeout: BACKUP_DOWNLOAD_TIMEOUT_MS,
      });
      const fileUrl = window.URL.createObjectURL(
        new Blob([response.data], { type: "application/json" })
      );
      const link = document.createElement("a");
      link.href = fileUrl;
      link.download = getDownloadFilename(response);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(fileUrl);
      setMessage(
        "Full-system backup downloaded successfully. Keep it private; it contains sensitive business records and password hashes."
      );
    } catch (requestError) {
      setError((await readErrorBlob(requestError)) || "Backup download failed.");
    } finally {
      setDownloading(false);
    }
  }

  async function handleFileChange(event) {
    const file = event.target.files?.[0] || null;
    setSelectedFile(file);
    setSelectedBackupInfo(null);
    setDryRunReport(null);
    setConfirmText("");
    setError("");
    setMessage("");
    if (!file) return;

    try {
      const backup = JSON.parse(await file.text());
      const tableNames = backup?.tables ? Object.keys(backup.tables).sort() : [];
      const totalRows = tableNames.reduce(
        (sum, tableName) =>
          sum + (Array.isArray(backup.tables[tableName]) ? backup.tables[tableName].length : 0),
        0
      );
      setSelectedBackupInfo({
        app: backup.app || "Unknown app",
        backup_type: backup.backup_type || "Unknown type",
        version: backup.version || "Unknown version",
        created_at: backup.created_at || "Unknown time",
        table_count: tableNames.length,
        total_rows: totalRows,
        checksum: backup.checksum_sha256 || backup.manifest?.checksum_sha256 || "",
      });
    } catch {
      setError("Choose a valid Chalin 03 JSON backup file.");
    }
  }

  async function validateSelectedBackup() {
    if (!selectedFile) {
      setError("Choose a backup JSON file first.");
      return null;
    }
    if (!tokenReady) {
      setError("Unlock protected actions with your current password first.");
      return null;
    }
    const backup = JSON.parse(await selectedFile.text());
    const response = await axiosClient.post(
      backupRequestUrl("/restore/dry-run"),
      { backup },
      {
        headers: protectedHeaders,
        timeout: BACKUP_VALIDATE_TIMEOUT_MS,
      }
    );
    setDryRunReport(response.data);
    return { backup, report: response.data };
  }

  async function runValidation() {
    setRestoring(true);
    setError("");
    setMessage("");
    try {
      const validation = await validateSelectedBackup();
      if (!validation) return;
      setMessage(
        validation.report.recovery_schema_ready === false
          ? "Backup package validation passed. The page found a production-schema gap in the isolated trial database."
          : "Backup validation and restore preview completed. No data was changed."
      );
    } catch (requestError) {
      const report = requestError.response?.data || null;
      setError(
        backupRequestErrorMessage(
          requestError,
          "Backup validation failed. No data was changed."
        )
      );
      setDryRunReport(report);
    } finally {
      setRestoring(false);
    }
  }

  async function prepareTrialSchema() {
    if (!selectedFile) {
      setError("Choose the production backup JSON file first.");
      return;
    }
    if (!tokenReady) {
      setError("Unlock protected actions with your current password first.");
      return;
    }
    setPreparingSchema(true);
    setError("");
    setMessage("");
    try {
      const backup = JSON.parse(await selectedFile.text());
      const response = await axiosClient.post(
        backupRequestUrl("/restore/prepare-staging-schema"),
        { backup },
        {
          headers: protectedHeaders,
          timeout: BACKUP_SCHEMA_PREPARE_TIMEOUT_MS,
        }
      );
      setDryRunReport(response.data.validation || response.data);
      setMessage(
        response.data.message ||
          "The isolated trial schema was prepared safely for this backup."
      );
    } catch (requestError) {
      const report = requestError.response?.data || null;
      setDryRunReport(report?.validation || report);
      setError(
        backupRequestErrorMessage(
          requestError,
          "The isolated trial schema could not be prepared safely."
        )
      );
    } finally {
      setPreparingSchema(false);
    }
  }

  async function restoreBackup() {
    if (!selectedFile) {
      setError("Choose the production backup JSON file first.");
      return;
    }
    if (!tokenReady) {
      setError("Unlock protected actions with your current password first.");
      return;
    }
    if (confirmText !== RESTORE_CONFIRMATION_TEXT) {
      setError(`Type ${RESTORE_CONFIRMATION_TEXT} exactly before restoring.`);
      return;
    }

    setRestoring(true);
    setError("");
    setMessage("");
    try {
      const backup = JSON.parse(await selectedFile.text());
      const response = await axiosClient.post(
        backupRequestUrl("/restore"),
        { backup, confirmation: confirmText },
        {
          headers: protectedHeaders,
          timeout: BACKUP_RESTORE_TIMEOUT_MS,
        }
      );
      setDryRunReport(response.data);
      setMessage(
        response.data.message ||
          "Full-system restore completed and verification passed. Sign in again before continuing."
      );
      setProtectedToken(null);
      setConfirmText("");
    } catch (requestError) {
      const report = requestError.response?.data || null;
      setDryRunReport(report);
      setError(
        backupRequestErrorMessage(
          requestError,
          "Full-system restore failed. No unverified success was reported."
        )
      );
    } finally {
      setRestoring(false);
    }
  }

  if (!canDownload && !canValidate && !canRestorePermission) {
    return (
      <div className="settings-container">
        <h1>Backup & Restore</h1>
        <p className="settings-description">
          You do not have permission to access full-system backup controls.
        </p>
      </div>
    );
  }

  const sourceOnlyTables = Array.isArray(dryRunReport?.source_only_tables)
    ? dryRunReport.source_only_tables
    : [];
  const sourceOnlyColumns = sourceOnlyColumnCount(dryRunReport);
  const recoverySchemaReady =
    dryRunReport?.recovery_schema_ready !== false &&
    sourceOnlyTables.length === 0 &&
    sourceOnlyColumns === 0;

  return (
    <div className="settings-container backup-page">
      <h1>Backup & Restore</h1>
      <p className="settings-description">
        Validated, protected full-system disaster recovery.
      </p>

      {message && <div className="success-message">{message}</div>}
      {error && <div className="error-message">{error}</div>}

      <div className="backup-context-card">
        <strong>
          Current context: {currentStoreCode} — {currentStoreName}
          {currentStoreLocation ? ` — ${currentStoreLocation}` : ""}
        </strong>
        <p>
          Backup and restore remain system-wide across Spare Parts, Mining Operations,
          Equipment Hire, users, permissions and audit evidence.
        </p>
      </div>

      <section className="settings-card backup-protected-card">
        <h2>Protected Action Confirmation</h2>
        <p>
          Enter your current Administrator password before downloading, validating or
          restoring. Passwords are never recorded.
        </p>
        <form className="backup-unlock-form" onSubmit={unlockProtectedActions}>
          <input
            type="password"
            value={unlockPassword}
            onChange={(event) => setUnlockPassword(event.target.value)}
            placeholder="Current Administrator password"
            autoComplete="current-password"
            required
          />
          <button
            className="primary-button"
            type="submit"
            disabled={unlocking || !unlockPassword}
          >
            {unlocking ? "Unlocking…" : tokenReady ? "Unlock Again" : "Unlock Backup Actions"}
          </button>
        </form>
        {tokenReady && (
          <p className="backup-token-status">
            Protected backup actions are temporarily unlocked for this page.
          </p>
        )}
      </section>

      <section className="settings-card">
        <h2>1. Download Full Backup</h2>
        <p>
          Creates a point-in-time JSON snapshot of all durable Chalin 03 tables. Active
          sessions, OTPs and temporary recovery tokens are excluded by design.
        </p>
        <button
          className="primary-button"
          disabled={!canDownload || downloading || !tokenReady}
          onClick={downloadBackup}
        >
          {downloading ? "Preparing signed backup…" : "Download Signed Full Backup"}
        </button>
      </section>

      <section className="settings-card">
        <h2>2. Validation and Restore Preview</h2>
        <p>
          Choose a signed full-system backup. Chalin 03 verifies its checksum, signature,
          schema coverage and record counts before any restore is allowed.
        </p>
        <input
          type="file"
          accept="application/json,.json"
          onChange={handleFileChange}
        />

        {selectedFile && (
          <p className="backup-file-meta">
            {selectedFile.name} — {formatFileSize(selectedFile.size)}
          </p>
        )}

        {selectedBackupInfo && (
          <div className="backup-manifest-summary">
            <p>
              <strong>Application:</strong> {selectedBackupInfo.app}
            </p>
            <p>
              <strong>Backup type:</strong> {selectedBackupInfo.backup_type}
            </p>
            <p>
              <strong>Manifest version:</strong> {selectedBackupInfo.version}
            </p>
            <p>
              <strong>Created:</strong> {selectedBackupInfo.created_at}
            </p>
            <p>
              <strong>Tables:</strong> {formatNumber(selectedBackupInfo.table_count)}
            </p>
            <p>
              <strong>Records:</strong> {formatNumber(selectedBackupInfo.total_rows)}
            </p>
            {selectedBackupInfo.checksum && (
              <p className="backup-checksum">
                <strong>Checksum:</strong> {selectedBackupInfo.checksum}
              </p>
            )}
          </div>
        )}

        <button
          className="secondary-button"
          disabled={!canValidate || restoring || !selectedFile || !tokenReady}
          onClick={runValidation}
        >
          {restoring ? "Validating…" : "Run Restore Dry Run"}
        </button>

        {dryRunReport && (
          <div className="backup-validation-report">
            <h3>Dry-run report</h3>
            <p>
              <strong>Status:</strong> {dryRunReport.valid ? "Valid" : "Blocked"}
            </p>
            <p>
              <strong>Restore tables:</strong>{" "}
              {formatNumber((dryRunReport.restore_tables || []).length)}
            </p>
            <p>
              <strong>Preserved newer tables:</strong>{" "}
              {formatNumber((dryRunReport.preserved_current_only_tables || []).length)}
            </p>
            <p>
              <strong>Production tables missing in trial schema:</strong>{" "}
              {formatNumber(sourceOnlyTables.length)}
            </p>
            <p>
              <strong>Production columns missing in trial schema:</strong>{" "}
              {formatNumber(sourceOnlyColumns)}
            </p>
            <p>
              <strong>Compatibility mode:</strong>{" "}
              {dryRunReport.cross_environment_recovery
                ? "Signed production → isolated staging recovery"
                : dryRunReport.additive_schema_compatibility_applied
                  ? "Safe additive schema compatibility applied"
                  : "Exact/current schema"}
            </p>
            <p>
              <strong>Warnings:</strong>{" "}
              {formatNumber(backupReportWarnings(dryRunReport).length)}
            </p>
            <p>
              <strong>Errors:</strong>{" "}
              {formatNumber(backupReportErrors(dryRunReport).length)}
            </p>
            {sourceOnlyTables.length > 0 && (
              <div className="backup-error-list">
                <strong>Trial schema is missing these production tables:</strong>
                <ul>
                  {sourceOnlyTables.map((tableName) => (
                    <li key={`source-table-${tableName}`}>{tableName}</li>
                  ))}
                </ul>
              </div>
            )}
            {sourceOnlyColumns > 0 && (
              <div className="backup-error-list">
                <strong>Trial schema is missing production columns:</strong>
                <ul>
                  {Object.entries(dryRunReport.source_only_columns || {}).flatMap(
                    ([tableName, columns]) =>
                      (columns || []).map((columnName) => (
                        <li key={`source-column-${tableName}-${columnName}`}>
                          {tableName}.{columnName}
                        </li>
                      ))
                  )}
                </ul>
              </div>
            )}
            {backupReportWarnings(dryRunReport).length > 0 && (
              <div className="backup-warning-list">
                <strong>Warnings:</strong>
                <ul>
                  {backupReportWarnings(dryRunReport).map((warning, index) => (
                    <li key={`warning-${index}`}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}
            {backupReportErrors(dryRunReport).length > 0 && (
              <div className="backup-error-list">
                <strong>Errors:</strong>
                <ul>
                  {backupReportErrors(dryRunReport).map((reportError, index) => (
                    <li key={`error-${index}`}>{reportError}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {dryRunReport?.cross_environment_recovery && !recoverySchemaReady && (
          <button
            className="secondary-button"
            disabled={preparingSchema || !canRestorePermission || !tokenReady}
            onClick={prepareTrialSchema}
          >
            {preparingSchema ? "Preparing Trial Schema…" : "Prepare Trial Schema"}
          </button>
        )}
      </section>

      <section className="settings-card danger-zone">
        <h2>3. Full Restore</h2>
        <p>
          Restore is destructive. Durable tables are replaced from the validated backup,
          temporary authentication state is cleared, record counts are verified, and active
          users must sign in again afterward.
        </p>
        <label htmlFor="restore-confirmation">
          Type <strong>{RESTORE_CONFIRMATION_TEXT}</strong> to enable restore.
        </label>
        <input
          id="restore-confirmation"
          value={confirmText}
          onChange={(event) => setConfirmText(event.target.value)}
          placeholder={RESTORE_CONFIRMATION_TEXT}
        />
        <button
          className="danger-button"
          disabled={
            !canRestorePermission ||
            restoring ||
            !selectedFile ||
            !tokenReady ||
            confirmText !== RESTORE_CONFIRMATION_TEXT ||
            !dryRunReport?.valid ||
            !recoverySchemaReady
          }
          onClick={restoreBackup}
        >
          {restoring ? "Restoring…" : "Restore Full System Backup"}
        </button>
      </section>
    </div>
  );
}
