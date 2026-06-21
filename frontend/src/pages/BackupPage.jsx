import { useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";

export default function BackupPage() {
  const { user } = useAuth();
  const role = String(user?.role || "").toLowerCase();

  const [selectedFile, setSelectedFile] = useState(null);
  const [confirmText, setConfirmText] = useState("");

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function downloadBackup() {
    setMessage("");
    setError("");

    try {
      const response = await axiosClient.get("/backups/download", {
        responseType: "blob",
      });

      const fileUrl = window.URL.createObjectURL(
        new Blob([response.data], { type: "application/json" })
      );

      const timestamp = new Date()
        .toISOString()
        .replaceAll(":", "-")
        .replaceAll(".", "-");

      const link = document.createElement("a");

      link.href = fileUrl;
      link.setAttribute("download", `chalin03-backup-${timestamp}.json`);

      document.body.appendChild(link);
      link.click();

      link.remove();
      window.URL.revokeObjectURL(fileUrl);

      setMessage("Backup downloaded successfully. Keep the file safe.");
    } catch (error) {
      setError("Failed to download backup.");
    }
  }

  function handleFileChange(event) {
    setSelectedFile(event.target.files[0] || null);
    setMessage("");
    setError("");
  }

  async function restoreBackup(event) {
    event.preventDefault();

    setMessage("");
    setError("");

    if (!selectedFile) {
      setError("Please select a backup JSON file.");
      return;
    }

    if (confirmText !== "RESTORE") {
      setError('Type RESTORE exactly before restoring.');
      return;
    }

    const confirmed = window.confirm(
      "This will replace the current database with the backup file. Continue?"
    );

    if (!confirmed) {
      return;
    }

    try {
      const fileText = await selectedFile.text();
      const backupData = JSON.parse(fileText);

      const response = await axiosClient.post("/backups/restore", backupData);

      setMessage(response.data.message);
      setSelectedFile(null);
      setConfirmText("");
    } catch (error) {
      if (error instanceof SyntaxError) {
        setError("Invalid JSON backup file.");
        return;
      }

      setError(error.response?.data?.message || "Failed to restore backup.");
    }
  }

  if (role !== "admin") {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1>Access Denied</h1>
            <p>You are not allowed to open Backup & Restore.</p>
          </div>
        </div>

        <div className="error-box">
          Only admin accounts can backup and restore the database.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Backup & Restore</h1>
          <p>Download or restore the system database</p>
        </div>
      </div>

      {message && <div className="success-box">{message}</div>}
      {error && <div className="error-box">{error}</div>}

      <div className="backup-grid">
        <div className="section-card backup-card">
          <h2>Download Backup</h2>

          <p>
            This creates a JSON backup of the current database including
            products, sales, debts, purchases, returns, users, settings and
            activity logs.
          </p>

          <div className="warning-box">
            The backup contains sensitive business data and password hashes.
            Keep it private.
          </div>

          <button type="button" onClick={downloadBackup}>
            Download Database Backup
          </button>
        </div>

        <form className="section-card backup-card" onSubmit={restoreBackup}>
          <h2>Restore Backup</h2>

          <p>
            Restore should only be used when you want to replace the current
            database with a saved backup file.
          </p>

          <div className="error-box">
            Warning: Restore will delete current records and replace them with
            the backup data.
          </div>

          <label>Select Backup JSON File</label>
          <input type="file" accept=".json" onChange={handleFileChange} />

          {selectedFile && (
            <p className="selected-file">
              Selected file: <strong>{selectedFile.name}</strong>
            </p>
          )}

          <label>Type RESTORE to confirm</label>
          <input
            value={confirmText}
            onChange={(event) => setConfirmText(event.target.value)}
            placeholder="RESTORE"
          />

          <button type="submit" className="danger-button">
            Restore Database
          </button>
        </form>
      </div>
    </div>
  );
}