import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import axiosClient from "../api/axiosClient";
import "./SparePartsBlindCountPage.css";

const API = "/spare-parts/stock-counts";
const money = value => "GH₵ " + Number(value || 0).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const whole = value => Number(value || 0).toLocaleString("en-GH", { maximumFractionDigits: 0 });
const statusLabel = { draft: "In progress", submitted: "Submitted", reviewed: "Reviewed" };
const filters = [
  { value: "all", label: "All items" },
  { value: "uncounted", label: "Not Counted" },
  { value: "shortage", label: "Shortages" },
  { value: "overage", label: "Overages" },
  { value: "matching", label: "Matching" },
];

async function errorText(error) {
  const data = error?.response?.data;
  if (data instanceof Blob) {
    try { return JSON.parse(await data.text()).message || "Request failed."; }
    catch { return "Request failed."; }
  }
  return data?.message || error?.message || "Request failed.";
}
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function validateQuantity(raw) {
  return raw === "" || (/^\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) && Number(raw) <= 1000000000);
}
function Stat({ label, value, tone }) {
  return <div className={"blind-stat " + (tone || "")}><span>{label}</span><strong>{value}</strong></div>;
}

export default function SparePartsBlindCountPage() {
  const { branchId, branchName, branchCode } = useAuth();
  const [sessions, setSessions] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [draft, setDraft] = useState({});
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);

  const loadSessions = useCallback(async () => {
    try {
      const result = (await axiosClient.get(API)).data;
      setSessions(result.sessions || []);
    } catch (err) { setError(await errorText(err)); }
    finally { setLoading(false); }
  }, []);
  const openCount = useCallback(async id => {
    if (!id) return;
    const result = (await axiosClient.get(API + "/" + id)).data;
    setActiveId(Number(id));
    setDetail(result);
    setDraft({});
  }, []);
  useEffect(() => {
    setActiveId(null);
    setDetail(null);
    setSessions([]);
    setLoading(true);
    setDraft({});
    loadSessions();
  }, [branchId, loadSessions]);

  const rows = detail?.items || [];
  const revealed = Boolean(detail && detail.session.status !== "draft");
  const reportRows = detail?.analysis?.lines || [];
  const reportByProduct = useMemo(() => new Map(reportRows.map(item => [String(item.product_id), item])), [reportRows]);
  const currentValue = row => Object.prototype.hasOwnProperty.call(draft, String(row.product_id))
    ? draft[String(row.product_id)] : String(row.counted_qty ?? "");
  const enteredCount = rows.filter(row => currentValue(row) !== "").length;
  const notCounted = rows.length - enteredCount;
  const changes = useMemo(() => Object.entries(draft).filter(([id, value]) => {
    const item = rows.find(row => String(row.product_id) === id);
    return item && value !== String(item.counted_qty ?? "");
  }), [draft, rows]);
  const visible = useMemo(() => rows.filter(row => {
    const term = query.trim().toLowerCase();
    if (term && ![row.name, row.barcode, row.category, row.product_id, row.size]
      .some(value => String(value || "").toLowerCase().includes(term))) return false;
    const result = reportByProduct.get(String(row.product_id));
    if (filter === "uncounted") return revealed ? !result?.counted : (Object.prototype.hasOwnProperty.call(draft, String(row.product_id))
      ? draft[String(row.product_id)] === "" : row.counted_qty === null);
    if (filter === "shortage") return result?.shortage_qty > 0;
    if (filter === "overage") return result?.excess_qty > 0;
    if (filter === "matching") return result?.counted && result?.variance === 0;
    return true;
  }), [rows, query, filter, reportByProduct, draft, revealed]);
  const summary = detail?.analysis?.summary;

  async function startCount() {
    setBusy("new"); setError(""); setNotice("");
    try {
      const name = "Stock Count - " + new Date().toLocaleDateString("en-GB");
      const response = (await axiosClient.post(API, { title: name })).data;
      await loadSessions();
      await openCount(response.count_id);
      setNotice("New blind count started. Just enter quantities; leave other items blank.");
    } catch (err) { setError(await errorText(err)); }
    finally { setBusy(""); }
  }
  function changeQuantity(id, value) {
    setDraft(prev => ({ ...prev, [String(id)]: value }));
    setError("");
  }
  function changedEntries() {
    const entries = [];
    for (const [id, value] of changes) {
      const raw = String(value).trim();
      if (!validateQuantity(raw)) throw new Error("Enter whole quantities only. Leave blank for Not Counted.");
      entries.push({ product_id: Number(id), counted_qty: raw === "" ? null : Number(raw) });
    }
    return entries;
  }
  async function persistEntries(entries) {
    for (let index = 0; index < entries.length; index += 250) {
      await axiosClient.put(API + "/" + activeId + "/entries", { entries: entries.slice(index, index + 250) });
    }
  }
  async function saveProgress() {
    setBusy("save"); setError(""); setNotice("");
    try {
      const entries = changedEntries();
      if (entries.length) await persistEntries(entries);
      await openCount(activeId);
      await loadSessions();
      setNotice("Quantities saved.");
    } catch (err) { setError(await errorText(err)); }
    finally { setBusy(""); }
  }
  async function finishCount() {
    let entries;
    try { entries = changedEntries(); }
    catch (err) { setError(err.message); return; }
    if (!window.confirm("Finish this count? " + notCounted + " item(s) will be marked Not Counted. Blank quantities will NOT be treated as zero or a shortage. You cannot edit after submission.")) return;
    setBusy("finish"); setError(""); setNotice("");
    try {
      // One click saves anything typed, then submits the frozen audit evidence.
      if (entries.length) await persistEntries(entries);
      const response = (await axiosClient.post(API + "/" + activeId + "/submit")).data;
      await openCount(activeId);
      await loadSessions();
      setNotice(response.message);
    } catch (err) { setError(await errorText(err)); }
    finally { setBusy(""); }
  }
  async function exportReport(format) {
    setBusy(format); setError(""); setNotice("");
    try {
      const response = await axiosClient.get(API + "/" + activeId + "/export", { params: { format }, responseType: "blob" });
      const ext = format === "word" ? "doc" : format;
      downloadBlob(response.data, "chalin03-blind-count-" + activeId + "." + ext);
      setNotice(format.toUpperCase() + " report downloaded.");
    } catch (err) { setError(await errorText(err)); }
    finally { setBusy(""); }
  }

  return <main className="blind-page blind-simple">
    <header className="blind-hero">
      <div>
        <span className="blind-eyebrow">SPARE PARTS</span>
        <h1>Blind Stock Count</h1>
        <p>Enter the physical quantity beside each item. Leave it blank if you have not counted it. Enter 0 only when you checked and found none.</p>
      </div>
      <div className="blind-store"><small>Current store</small><strong>{branchCode || "Store"} · {branchName || "Selected branch"}</strong></div>
    </header>
    {error && <div className="blind-alert error" role="alert">{error}</div>}
    {notice && <div className="blind-alert success" role="status">{notice}</div>}
    <section className="blind-workspace">
      <aside className="blind-aside">
        <div className="blind-pane-title"><span className="blind-eyebrow">COUNTS</span><h2>Choose a count</h2></div>
        <div className="blind-start">
          <button type="button" disabled={Boolean(busy)} onClick={startCount}>+ Start New Count</button>
        </div>
        <div className="blind-sessions">
          {loading && <p>Loading…</p>}
          {!loading && sessions.length === 0 && <p className="blind-empty">No counts yet.</p>}
          {sessions.map(session => <button key={session.id} type="button"
            className={"blind-session " + (Number(activeId) === Number(session.id) ? "active" : "")}
            disabled={Boolean(busy)}
            onClick={async () => {
              setBusy("open"); setError(""); setNotice("");
              try { await openCount(session.id); setFilter("all"); setQuery(""); }
              catch (err) { setError(await errorText(err)); }
              finally { setBusy(""); }
            }}>
            <strong>{session.title}</strong>
            <small>{new Date(session.created_at).toLocaleDateString("en-GH")} · {statusLabel[session.status] || session.status}</small>
            <span>{session.completed_items} counted · {session.total_items - session.completed_items} not counted</span>
          </button>)}
        </div>
      </aside>
      <section className="blind-content">
        {!detail ? <div className="blind-welcome">
          <h2>Ready to count?</h2>
          <p>Select a count or press Start New Count. You only need to enter quantities.</p>
        </div> : <>
          <div className="blind-section-head">
            <div>
              <span className="blind-eyebrow">COUNT #{detail.session.id} · {statusLabel[detail.session.status]?.toUpperCase()}</span>
              <h2>{detail.session.title}</h2>
              <p>{revealed ? "Your count is complete. Blank quantities are marked Not Counted in the report." : "One field per product. No notes required. The system stock remains hidden until submission."}</p>
            </div>
            <span className={"blind-stage " + (revealed ? "done" : "")}>{revealed ? "Report ready" : "Counting"}</span>
          </div>
          {!revealed ? <div className="blind-progress">
            <div className="blind-progress-head"><strong>{whole(enteredCount)} counted</strong><strong>{whole(notCounted)} not counted</strong></div>
            <div className="blind-progress-bar"><span style={{ width: (rows.length ? (100 * enteredCount / rows.length) : 0) + "%" }} /></div>
          </div> : <>
            <div className="blind-stats">
              <Stat label="Counted" value={whole(summary?.counted)} tone="positive" />
              <Stat label="Not Counted" value={whole(summary?.uncounted)} tone="warn" />
              <Stat label="Shortages" value={whole(summary?.shortage_items)} tone="negative" />
              <Stat label="Excesses" value={whole(summary?.excess_items)} tone="positive" />
              <Stat label="Shortage value" value={money(summary?.shortage_cost)} tone="negative" />
              <Stat label="Differences" value={whole(summary?.discrepancies)} />
            </div>
            <div className="blind-insights"><strong>Important</strong>
              <p>Uncounted items are excluded from shortage and difference totals. A blank is never treated as 0.</p>
            </div>
          </>}
          <div className="blind-toolbar">
            <label className="blind-search"><span>Find an item</span>
              <input type="search" placeholder="Search product or barcode…" value={query} onChange={e => setQuery(e.target.value)} />
            </label>
            <label className="blind-filter"><span>Show</span>
              <select value={filter} onChange={e => setFilter(e.target.value)}>
                {filters.filter(item => revealed || ["all", "uncounted"].includes(item.value)).map(item =>
                  <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <span className="blind-results">{visible.length} items</span>
          </div>
          <div className="blind-table-wrap">
            <table className="blind-table">
              <thead><tr><th>Spare Part</th>{revealed ? <><th>System Qty</th><th>Counted Qty</th><th>Difference</th><th>Status</th></> : <><th>Enter Quantity</th><th>Status</th></>}</tr></thead>
              <tbody>{visible.map(row => {
                const result = reportByProduct.get(String(row.product_id));
                const value = currentValue(row);
                const isCounted = value !== "";
                return <tr key={row.product_id} className={revealed && result?.shortage_qty > 0 ? "is-shortage" : ""}>
                  <td data-label="Spare Part"><strong>{row.name}</strong><small>{row.barcode || "No barcode"}{row.size ? " · " + row.size : ""}</small></td>
                  {revealed ? <>
                    <td data-label="System Qty">{whole(result?.expected)}</td>
                    <td data-label="Counted Qty">{result?.counted ? whole(result.actual) : "—"}</td>
                    <td data-label="Difference">{result?.counted ? <strong className={result.variance < 0 ? "blind-loss" : result.variance > 0 ? "blind-gain" : ""}>{result.variance > 0 ? "+" : ""}{whole(result.variance)}</strong> : "—"}</td>
                    <td data-label="Status"><span className={"blind-pill " + (result?.counted ? "counted" : "")}>{result?.status || "Not Counted"}</span></td>
                  </> : <>
                    <td data-label="Quantity"><input
                      type="number" inputMode="numeric" pattern="[0-9]*" min="0" max="1000000000" step="1"
                      value={value} placeholder="—" aria-label={"Physical quantity of " + row.name}
                      onChange={e => changeQuantity(row.product_id, e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.closest("tr")?.nextElementSibling?.querySelector('input[type="number"]')?.focus(); } }}
                    /></td>
                    <td data-label="Status"><span className={"blind-pill " + (isCounted ? "counted" : "")}>{isCounted ? "Counted" : "Not Counted"}</span></td>
                  </>}
                </tr>;
              })}</tbody>
            </table>
            {visible.length === 0 && <div className="blind-empty" style={{ padding: 24 }}>No matching items.</div>}
          </div>
          {!revealed ? <div className="blind-actions">
            <p>Blank = <strong>Not Counted</strong>. Zero (0) = checked, none found. You can finish even with blanks.</p>
            <button type="button" onClick={saveProgress} disabled={Boolean(busy) || !changes.length}>Save Progress</button>
            <button type="button" className="primary" onClick={finishCount} disabled={Boolean(busy)}>
              {busy === "finish" ? "Submitting…" : "Finish Count & View Results"}
            </button>
          </div> : <div className="blind-download">
            <div><h3>Download count report</h3><p>Counted items, Not Counted items and actual differences, in separate sections.</p></div>
            <div className="blind-download-buttons">{[["xlsx", "Excel"], ["pdf", "PDF"], ["word", "Word"], ["csv", "CSV"]].map(([format, label]) =>
              <button type="button" key={format} disabled={Boolean(busy)} onClick={() => exportReport(format)}>{busy === format ? "Preparing…" : label}</button>)}</div>
          </div>}
        </>}
      </section>
    </section>
  </main>;
}
