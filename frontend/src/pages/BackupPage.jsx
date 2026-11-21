import { useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";

const RESTORE_CONFIRMATION_TEXT = "RESTORE_FULL_SYSTEM_BACKUP";
const BACKUP_DOWNLOAD_TIMEOUT_MS = 900000;
const BACKUP_VALIDATE_TIMEOUT_MS = 180000;
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

function backupRequestErrorMessage(requestError, fallback) {
  const status = Number(requestError.response?.status || 0);
  const report = requestError.response?.data || null;
  const details = backupReportErrors(report);
  if (status === 413) {
    return "This backup is larger than the server restore upload limit. The server must allow a larger protected backup request before validation can run.";
  }
  if (details.length > 0) {
    return `${report?.message || fallback} ${details.join(" ")}`.trim();
  }
  return report?.message || fallback;
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
      setError(
        requestError.response?.data?.message ||
          "Your current Administrator password was not accepted."
      );
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
    setMessage("Preparing the signed full-system backup. Keep this page open while the database snapshot is streamed securely.");
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
      window.setTimeout(() => window.URL.revokeObjectURL(fileUrl), 1000);
      setMessage(
        "Full-system backup downloaded successfully. Keep it private; it contains sensitive business records and password hashes."
      );
    } catch (requestError) {
      setMessage("");
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
      setMessage("Backup validation and restore preview completed. No data was changed.");
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

  async function restoreBackup(event) {
    event.preventDefault();
    if (!canRestorePermission) {
      setError("Your account does not have Backup Restore permission.");
      return;
    }
    if (confirmText !== RESTORE_CONFIRMATION_TEXT) {
      setError(`Type ${RESTORE_CONFIRMATION_TEXT} exactly before restoring.`);
      return;
    }
    if (!window.confirm("This will replace the full current database. Continue only during an approved restore window?")) return;

    setRestoring(true);
    setError("");
    setMessage("");
    try {
      const validation = await validateSelectedBackup();
      if (!validation?.report?.valid) return;
      const response = await axiosClient.post(
        backupRequestUrl("/restore"),
        {
          confirmation: RESTORE_CONFIRMATION_TEXT,
          backup: validation.backup,
        },
        {
          headers: protectedHeaders,
          timeout: BACKUP_RESTORE_TIMEOUT_MS,
        }
      );
      setMessage(response.data.message || "Full-system restore completed.");
      setSelectedFile(null);
      setSelectedBackupInfo(null);
      setDryRunReport(null);
      setConfirmText("");
      setProtectedToken(null);
    } catch (requestError) {
      setError(
        backupRequestErrorMessage(
          requestError,
          "The full-system restore did not complete. Review the backend log before retrying."
        )
      );
    } finally {
      setRestoring(false);
    }
  }

  if (!canDownload && !canValidate && !canRestorePermission) {
    return <div><div className="page-header"><div><h1>Access Denied</h1><p>Backup & Restore requires explicit Administrator permissions.</p></div></div><div className="error-box">The original owner has not authorized this account for backup operations.</div></div>;
  }

  const reportErrors = backupReportErrors(dryRunReport);
  const reportWarnings = backupReportWarnings(dryRunReport);
  const preservedCurrentTables = Array.isArray(
    dryRunReport?.preserved_current_only_tables
  )
    ? dryRunReport.preserved_current_only_tables
    : [];

  return (
    <div>
      <div className="page-header"><div><h1>Backup & Restore</h1><p>Validated, protected full-system disaster recovery.</p></div></div>
      {message ? <div className="success-box">{message}</div> : null}
      {error ? <div className="error-box">{error}</div> : null}

      <div className="warning-box"><strong>Current context:</strong> {currentStoreCode} — {currentStoreName}{currentStoreLocation ? ` — ${currentStoreLocation}` : ""}<br /><small>Backup and restore remain system-wide across Spare Parts, Mining Operations, Equipment Hire, users, permissions and audit evidence.</small></div>

      <form className="section-card" onSubmit={unlockProtectedActions} autoComplete="off" style={{ marginBottom: 18 }}>
        <h2>Protected Action Confirmation</h2>
        <p>{tokenReady ? "Protected backup actions are unlocked for this page session." : "Enter your current Administrator password before downloading, validating or restoring. Passwords are never recorded."}</p>
        {!tokenReady ? <div className="form-row"><input type="password" value={unlockPassword} onChange={(event) => setUnlockPassword(event.target.value)} placeholder="Current Administrator password" autoComplete="new-password" required /><button type="submit" disabled={unlocking}>{unlocking ? "Unlocking…" : "Unlock Backup Actions"}</button></div> : <div className="success-box">Protected action window is active.</div>}
      </form>

      <div className="backup-grid">
        <div className="section-card backup-card">
          <h2>Download Full-System Backup</h2>
          <p>Creates one private JSON recovery package containing every current canonical application table.</p>
          <ul style={{ lineHeight: 1.8, fontWeight: 700 }}><li>All three independent business workspaces</li><li>Users, permissions and location access</li><li>Sales, finance, mining and hire records</li><li>Audit, security, SMS and system evidence</li><li>SHA-256 integrity checksum</li></ul>
          <button type="button" onClick={downloadBackup} disabled={!canDownload || !tokenReady || downloading}>{downloading ? "Preparing & Downloading…" : "Download Full-System Backup"}</button>
        </div>

        <form className="section-card backup-card" onSubmit={restoreBackup}>
          <h2>Validate and Restore</h2>
          <p>Validation is read-only. Restore is available only when Railway has <code>ALLOW_WEB_RESTORE=true</code> for an approved window.</p>
          <input type="file" accept=".json,application/json" onChange={handleFileChange} />
          {selectedFile ? <p className="selected-file"><strong>{selectedFile.name}</strong><br />{formatFileSize(selectedFile.size)}</p> : null}
          {selectedBackupInfo ? <div className="warning-box"><strong>Local file preview</strong><br />App: {selectedBackupInfo.app}<br />Type: {selectedBackupInfo.backup_type}<br />Version: {selectedBackupInfo.version}<br />Created: {selectedBackupInfo.created_at}<br />Tables: {formatNumber(selectedBackupInfo.table_count)}<br />Rows: {formatNumber(selectedBackupInfo.total_rows)}<br />Checksum: {selectedBackupInfo.checksum || "Not provided"}</div> : null}
          <button type="button" onClick={runValidation} disabled={!canValidate || !selectedFile || !tokenReady || restoring}>{restoring ? "Checking…" : "Run Validation and Restore Preview"}</button>
          {dryRunReport ? <div className={dryRunReport.valid ? "success-box" : "error-box"}><strong>{dryRunReport.valid ? "Validation passed" : "Validation failed"}</strong><br />Restore tables: {(dryRunReport.tables_to_restore || dryRunReport.restore_tables || []).length}<br />Preserved newer tables: {preservedCurrentTables.length}<br />Compatibility mode: {dryRunReport.additive_schema_compatibility_applied ? "Safe additive schema compatibility applied" : "Exact/current schema"}<br />Warnings: {reportWarnings.length}<br />Errors: {reportErrors.length}{reportWarnings.length ? <><br /><strong>Warnings:</strong> {reportWarnings.join(" ")}</> : null}{reportErrors.length ? <><br /><strong>Errors:</strong> {reportErrors.join(" ")}</> : null}</div> : null}
          <label>Type {RESTORE_CONFIRMATION_TEXT} to confirm</label>
          <input value={confirmText} onChange={(event) => setConfirmText(event.target.value)} placeholder={RESTORE_CONFIRMATION_TEXT} />
          <button type="submit" className="danger-button" disabled={!canRestorePermission || !dryRunReport?.valid || !tokenReady || confirmText !== RESTORE_CONFIRMATION_TEXT || restoring}>{restoring ? "Restoring…" : "Restore Full System Database"}</button>
        </form>
      </div>
    </div>
  );
}
