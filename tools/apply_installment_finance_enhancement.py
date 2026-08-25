from pathlib import Path
import re

ROOT = Path('.').resolve()

def replace_once(path, old, new, label):
    p = ROOT / path
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'{label}: expected source pattern not found in {path}')
    p.write_text(text.replace(old, new, 1))

# Passport photo browser crop.
p = 'frontend/src/utils/equipmentFinanceCustomerPhoto.js'
s = (ROOT / p).read_text()
if 'const PASSPORT_RATIO = 35 / 45;' not in s:
    s = s.replace('const MAX_DIMENSION = 1280;\n', 'const MAX_DIMENSION = 1400;\nconst PASSPORT_RATIO = 35 / 45;\nconst PASSPORT_HEIGHT = 900;\n', 1)
    old = '''  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;'''
    new = '''  const scaledWidth = Math.max(1, Math.round(image.naturalWidth * scale));
  const scaledHeight = Math.max(1, Math.round(image.naturalHeight * scale));
  const targetWidth = Math.round(PASSPORT_HEIGHT * PASSPORT_RATIO);
  const targetHeight = PASSPORT_HEIGHT;
  const sourceRatio = scaledWidth / scaledHeight;
  const cropWidth = sourceRatio > PASSPORT_RATIO ? Math.round(scaledHeight * PASSPORT_RATIO) : scaledWidth;
  const cropHeight = sourceRatio > PASSPORT_RATIO ? scaledHeight : Math.round(scaledWidth / PASSPORT_RATIO);
  const cropX = Math.max(0, Math.round((scaledWidth - cropWidth) / 2));
  const cropY = Math.max(0, Math.round((scaledHeight - cropHeight) / 2));
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;'''
    if old not in s:
        raise SystemExit('passport browser crop source pattern not found')
    s = s.replace(old, new, 1)
    s = s.replace('  context.drawImage(image, 0, 0, width, height);', '  context.drawImage(image, cropX / scale, cropY / scale, cropWidth / scale, cropHeight / scale, 0, 0, targetWidth, targetHeight);', 1)
    s = s.replace('    width,\n    height,\n', '    width: targetWidth,\n    height: targetHeight,\n', 1)
    s = s.replace('    compressed: true,\n', '    compressed: true,\n    passport_crop: true,\n    passport_ratio: "35:45",\n', 1)
(ROOT / p).write_text(s)

# Customer passport photo panel text.
p = 'frontend/src/components/EquipmentFinanceCustomerPhotoPanel.jsx'
s = (ROOT / p).read_text()
s = s.replace('No automatic cropping', 'Passport portrait crop 35:45')
s = s.replace('Full image preserved', 'Passport portrait normalized')
s = s.replace('keeps the complete frame visible', 'normalizes the portrait for agreement documents')
(ROOT / p).write_text(s)

# Server-side passport normalization.
p = 'backend/routes/equipmentFinanceCustomerPhotoCaptureRoutes.js'
s = (ROOT / p).read_text()
s = s.replace('const express = require("express");\n', 'const express = require("express");\nconst sharp = require("sharp");\n', 1)
marker = 'function successfulCreation(res, payload) {'
if 'async function normalizeCustomerPassportPhoto' not in s:
    fn = '''async function normalizeCustomerPassportPhoto(photo) {
  const source = Buffer.from(photo.content_base64, "base64");
  const oriented = await sharp(source, { failOn: "error" }).rotate().toBuffer();
  const metadata = await sharp(oriented).metadata();
  const width = Number(metadata.width || 0);
  const height = Number(metadata.height || 0);
  if (!width || !height) {
    const error = new Error("The customer picture is unreadable.");
    error.statusCode = 400;
    error.code = "FINANCE_CUSTOMER_PHOTO_UNREADABLE";
    throw error;
  }
  const ratio = 35 / 45;
  let cropWidth = width;
  let cropHeight = Math.round(width / ratio);
  if (cropHeight > height) {
    cropHeight = height;
    cropWidth = Math.round(height * ratio);
  }
  const left = Math.max(0, Math.floor((width - cropWidth) / 2));
  const top = Math.max(0, Math.floor((height - cropHeight) / 2));
  const output = await sharp(oriented)
    .extract({ left, top, width: cropWidth, height: cropHeight })
    .resize(700, 900, { fit: "cover", position: "centre" })
    .jpeg({ quality: 84, mozjpeg: true, chromaSubsampling: "4:2:0" })
    .toBuffer();
  if (output.length > MAX_CUSTOMER_PHOTO_BYTES) {
    const error = new Error("The normalized customer passport picture is too large.");
    error.statusCode = 413;
    error.code = "FINANCE_CUSTOMER_PHOTO_TOO_LARGE";
    throw error;
  }
  return {
    ...photo,
    mime_type: "image/jpeg",
    file_name: "customer-passport-photo.jpg",
    content_base64: output.toString("base64"),
    file_size_bytes: output.length,
    width: 700,
    height: 900,
    passport_normalized: true,
  };
}

'''
    s = s.replace(marker, fn + marker, 1)
s = s.replace('  (req, res, next) => {\n    let photo;', '  async (req, res, next) => {\n    let photo;', 1)
s = s.replace('    if (!photo) return next();\n\n    const body = { ...(req.body || {}) };', '    if (!photo) return next();\n    photo = await normalizeCustomerPassportPhoto(photo);\n\n    const body = { ...(req.body || {}) };', 1)
(ROOT / p).write_text(s)

# Actual Excavators bootstrap payload used by the page.
p = 'backend/routes/equipmentFinanceIndependentRoutes.js'
s = (ROOT / p).read_text()
old = '''      const machines = await listProfessionalMachines({
        search: req.query.search,
        status: req.query.status,
        limit: req.query.limit,
      });
      return res.json({ status: "success", count: machines.length, machines });'''
new = '''      const machines = await listProfessionalMachines({
        search: req.query.search,
        status: req.query.status,
        limit: req.query.limit,
      });
      const normalizedMachines = machines.map((machine) => {
        if (machine.sale_status !== "installment_active") return machine;
        return {
          ...machine,
          workflow_status: "installment",
          workflow_status_label: "Under Installment",
          readiness: {
            ...(machine.readiness || {}),
            ready: true,
            missing: (machine.readiness?.missing || []).filter((item) => item !== "available sale status"),
          },
          editability: {
            ...(machine.editability || {}),
            editable: false,
            reason: "This excavator is protected under an active Finance installment workflow.",
          },
        };
      });
      return res.json({ status: "success", count: normalizedMachines.length, machines: normalizedMachines });'''
replace_once(p, old, new, 'phase-one bootstrap')
s = (ROOT / p).read_text()
if '  "/sms-history",' not in s:
    marker = 'router.get(\n  "/finance-customers",'
    route = '''router.get(
  "/sms-history",
  requirePermission("fleet.assets.view"),
  async (req, res, next) => {
    try {
      const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 200);
      const page = Math.max(Number(req.query.page || 1), 1);
      const offset = (page - 1) * limit;
      const filter = `WHERE sl.source_reference LIKE 'finance:%'
           OR sl.source_reference LIKE 'finance-payment-receipt:%'
           OR sl.source_reference LIKE 'equipment-finance-%'`;
      const [countRows] = await pool.query(`SELECT COUNT(*) AS total_count FROM sms_log sl ${filter}`);
      const [logs] = await pool.query(
        `SELECT sl.id, sl.recipient_phone, sl.message, sl.sms_type, sl.status,
                sl.provider, sl.provider_message_id, sl.provider_status,
                sl.status_reason, sl.segment_count, sl.estimated_credits,
                sl.sent_at, sl.submitted_at, sl.delivery_confirmed_at,
                sl.last_status_at, sl.source_reference, sl.created_at,
                u.full_name AS sent_by_name, u.username AS sent_by_username
           FROM sms_log sl
           LEFT JOIN users u ON u.id = sl.sent_by
          ${filter}
          ORDER BY sl.id DESC
          LIMIT ? OFFSET ?`,
        [limit, offset]
      );
      return res.json({ status: "success", page, limit, total_count: Number(countRows[0]?.total_count || 0), logs });
    } catch (error) {
      return next(error);
    }
  }
);

'''
    if marker not in s:
        raise SystemExit('sms history route marker not found')
    s = s.replace(marker, route + marker, 1)
(ROOT / p).write_text(s)

# Finance SMS History page.
(ROOT / 'frontend/src/pages/EquipmentFinanceSmsHistoryPage.jsx').write_text('''import { useEffect, useState } from "react";
import axiosClient from "../api/axiosClient";

export default function EquipmentFinanceSmsHistoryPage() {
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await axiosClient.get("/equipment-catalogue/sales/sms-history", { params: { limit: 200 } });
      setLogs(Array.isArray(response.data?.logs) ? response.data.logs : []);
    } catch (err) {
      setError(err?.response?.data?.message || "Could not load Installment SMS history.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <main style={{ padding: 24, maxWidth: 1440, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", marginBottom: 20, flexWrap: "wrap" }}>
        <div>
          <p style={{ margin: 0, color: "#66736b" }}>Equipment Installment Finance</p>
          <h1 style={{ margin: "6px 0 0" }}>SMS History</h1>
          <p style={{ margin: "8px 0 0", color: "#647169" }}>Every Installment Finance SMS attempt and delivery result.</p>
        </div>
        <button type="button" onClick={load} disabled={loading}>{loading ? "Refreshing…" : "Refresh history"}</button>
      </div>
      {error ? <div role="alert" style={{ marginBottom: 16, padding: 14, borderRadius: 12, background: "#fff1f0", color: "#9c2d25" }}>{error}</div> : null}
      <div style={{ overflowX: "auto", border: "1px solid #d9e2dc", borderRadius: 14, background: "#fff" }}>
        <table style={{ width: "100%", minWidth: 1000, borderCollapse: "collapse" }}>
          <thead><tr>{["Date / Time", "Phone", "Type", "Message", "Status", "Provider", "Sent By"].map((heading) => <th key={heading} style={{ textAlign: "left", padding: 12, background: "#f5f8f6", borderBottom: "1px solid #d9e2dc", whiteSpace: "nowrap" }}>{heading}</th>)}</tr></thead>
          <tbody>{logs.map((log) => <tr key={log.id}>
            <td style={{ padding: 12, verticalAlign: "top", whiteSpace: "nowrap" }}>{new Date(log.submitted_at || log.created_at).toLocaleString("en-GB", { timeZone: "Africa/Accra" })}</td>
            <td style={{ padding: 12, verticalAlign: "top" }}>{log.recipient_phone || "—"}</td>
            <td style={{ padding: 12, verticalAlign: "top" }}>{log.sms_type || "Finance"}</td>
            <td style={{ padding: 12, verticalAlign: "top", minWidth: 320, maxWidth: 520, whiteSpace: "pre-wrap" }}>{log.message}</td>
            <td style={{ padding: 12, verticalAlign: "top", fontWeight: 700 }}>{log.status || "Unknown"}</td>
            <td style={{ padding: 12, verticalAlign: "top" }}>{log.provider || "—"}</td>
            <td style={{ padding: 12, verticalAlign: "top" }}>{log.sent_by_name || log.sent_by_username || "System"}</td>
          </tr>)}</tbody>
        </table>
        {!loading && logs.length === 0 ? <div style={{ padding: 28, textAlign: "center", color: "#6b766f" }}>No Installment Finance SMS has been recorded yet.</div> : null}
      </div>
    </main>
  );
}
''')

# Installment Finance route + navigation.
p = 'frontend/src/App.jsx'
s = (ROOT / p).read_text()
if 'EquipmentFinanceSmsHistoryPage' not in s:
    replace_once(p, 'import SmsPage from "./pages/SmsPage";', 'import SmsPage from "./pages/SmsPage";\nimport EquipmentFinanceSmsHistoryPage from "./pages/EquipmentFinanceSmsHistoryPage";', 'SMS page import')
    s = (ROOT / p).read_text()
    marker = '''            <Route
              path="reports"
              element={permissionOnlyPage(
                "fleet.assets.view",
                <EquipmentSalesReportsPage />
              )}
            />'''
    route = marker + '''
            <Route
              path="sms-history"
              element={permissionOnlyPage(
                "fleet.assets.view",
                <EquipmentFinanceSmsHistoryPage />
              )}
            />'''
    replace_once(p, marker, route, 'Installment SMS history route')

p = 'frontend/src/layouts/InstallmentFinanceLayout.jsx'
s = (ROOT / p).read_text()
if 'title: "SMS History"' not in s:
    marker = '''      {
        title: "Portfolio, SMS & Reports",
        description: "Statements, arrears, cash flow, accounting exports and thermal receipts",
        path: "/equipment-installment-finance/reports",
        icon: "📊",
        permissions: ["fleet.assets.view"],
      },'''
    item = marker + '''
      {
        title: "SMS History",
        description: "Installment Finance customer SMS attempts, provider status and delivery history",
        path: "/equipment-installment-finance/sms-history",
        icon: "✉️",
        permissions: ["fleet.assets.view"],
      },'''
    replace_once(p, marker, item, 'Installment SMS history navigation')

Path('backend/tests/equipmentFinanceInstallmentEnhancements.test.js').write_text('''const assert = require("assert");
const fs = require("fs");
const independent = fs.readFileSync("backend/routes/equipmentFinanceIndependentRoutes.js", "utf8");
const photo = fs.readFileSync("backend/routes/equipmentFinanceCustomerPhotoCaptureRoutes.js", "utf8");
const photoUi = fs.readFileSync("frontend/src/components/EquipmentFinanceCustomerPhotoPanel.jsx", "utf8");
const routeUi = fs.readFileSync("frontend/src/App.jsx", "utf8");
const navUi = fs.readFileSync("frontend/src/layouts/InstallmentFinanceLayout.jsx", "utf8");
assert.match(independent, /workflow_status_label: "Under Installment"/);
assert.match(independent, /\\/sms-history/);
assert.match(independent, /finance-payment-receipt:/);
assert.match(photo, /sharp/);
assert.match(photo, /resize\\(700, 900/);
assert.match(photoUi, /Passport portrait crop 35:45/);
assert.match(routeUi, /EquipmentFinanceSmsHistoryPage/);
assert.match(navUi, /title: "SMS History"/);
console.log("Installment Finance enhancement regression checks passed.");
''')
