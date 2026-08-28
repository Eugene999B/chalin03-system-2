import { useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";

const normalize = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
const validName = (value) => normalize(value).split(" ").filter(Boolean).length >= 2;
const nameOf = (c) => c?.name || c?.customer_name || "Unnamed Customer";
const phoneOf = (c) => c?.phone || c?.customer_phone || "";
const locationOf = (c) => c?.location || c?.customer_location || "";
const debtsOf = (c) => Number(c?.debt_count || c?.active_debt_count || c?.activeDebtCount || 0);

export default function CustomerIdentityEditorPanel({ title = "Edit Customer Details", compact = true }) {
  const [enabled, setEnabled] = useState(true);
  const [open, setOpen] = useState(false);
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState({ name: "", phone: "", location: "" });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function loadControls() {
    try {
      const response = await axiosClient.get("/debt-customers/feature-controls");
      setEnabled(response.data.controls?.customer_identity_editing_enabled !== false);
    } catch { /* protected save route remains authoritative */ }
  }
  useEffect(() => { loadControls(); }, []);
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event) => { if (event.key === "Escape" && !saving) setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", onKey); };
  }, [open, saving]);

  async function openWorkspace() {
    setError(""); setMessage(""); await loadControls();
    if (!enabled) { setError("Customer identity editing is currently disabled by an administrator."); return; }
    setLoading(true);
    try {
      const response = await axiosClient.get("/debt-customers/directory", { params: { limit: 5000 } });
      setCustomers(response.data.customers || []); setOpen(true);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Could not load the customer directory.");
    } finally { setLoading(false); }
  }
  function selectCustomer(customer) {
    setSelectedId(String(customer.id || customer.customer_id || ""));
    setForm({ name: nameOf(customer), phone: phoneOf(customer), location: locationOf(customer) });
    setError(""); setMessage("");
  }
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return customers;
    return customers.filter((c) => [c.id, nameOf(c), phoneOf(c), locationOf(c)].some((v) => String(v ?? "").toLowerCase().includes(query)));
  }, [customers, search]);

  async function save(event) {
    event.preventDefault(); setError(""); setMessage("");
    const name = normalize(form.name); const phone = form.phone.trim(); const location = form.location.trim();
    if (!selectedId) return setError("Select a customer first.");
    if (!validName(name)) return setError("Customer name must contain at least two separate names, for example Appiah Eugene.");
    const selected = customers.find((c) => String(c.id || c.customer_id) === selectedId);
    if (debtsOf(selected) > 0 && !phone) return setError("This customer has debt records, so a phone number is required.");
    setSaving(true);
    try {
      const response = await axiosClient.patch(`/debt-customers/customer/${selectedId}/identity`, { name, phone, location });
      const updated = response.data.customer || { id: Number(selectedId), name, phone, location };
      setCustomers((current) => current.map((c) => String(c.id || c.customer_id) === selectedId ? { ...c, ...updated } : c));
      setForm({ name, phone, location }); setMessage("Customer details saved successfully.");
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Could not save the selected customer details.");
    } finally { setSaving(false); }
  }

  if (!enabled) return null;
  const selected = customers.find((c) => String(c.id || c.customer_id) === selectedId);
  return (
    <>
      <button type="button" onClick={openWorkspace} disabled={loading} style={{ display: "inline-flex", alignItems: "center", gap: 8, borderRadius: 12, padding: compact ? "9px 12px" : "11px 14px", border: "1px solid #dbe3ef", background: "#fff", color: "#0f172a", fontWeight: 850, cursor: "pointer" }}><span aria-hidden="true">✎</span>{title}</button>
      {open ? <div role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) setOpen(false); }} style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,.55)", display: "grid", placeItems: "center", padding: 18 }}>
        <section role="dialog" aria-modal="true" style={{ width: "min(1120px,100%)", maxHeight: "calc(100vh - 36px)", overflow: "hidden", borderRadius: 22, background: "#fff", boxShadow: "0 28px 80px rgba(15,23,42,.28)", display: "grid", gridTemplateRows: "auto 1fr" }}>
          <header style={{ padding: "18px 20px", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", gap: 16 }}><div><div style={{ fontSize: 11, fontWeight: 900, letterSpacing: ".08em", textTransform: "uppercase", color: "#a17a00" }}>Customer Data Desk</div><h2 style={{ margin: "4px 0", color: "#07182c" }}>Correct customer details</h2><p style={{ margin: 0, color: "#64748b" }}>Edit only the name, phone number and location. Names require two or more separate names.</p></div><button type="button" onClick={() => setOpen(false)} disabled={saving} style={{ width: 38, height: 38, borderRadius: 12, border: "1px solid #e2e8f0", background: "#fff", fontSize: 22 }}>×</button></header>
          <div style={{ minHeight: 0, overflow: "auto", padding: 18 }}>
            {message ? <div style={{ marginBottom: 12, padding: 10, borderRadius: 10, background: "#f0fdf4", color: "#166534" }}>{message}</div> : null}
            {error ? <div style={{ marginBottom: 12, padding: 10, borderRadius: 10, background: "#fef2f2", color: "#991b1b" }}>{error}</div> : null}
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.1fr) minmax(320px,.9fr)", gap: 16 }}>
              <section><label style={{ display: "block", fontWeight: 800 }}>Search customer<input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, phone, location or ID" style={{ display: "block", width: "100%", marginTop: 7, padding: 11, border: "1px solid #cbd5e1", borderRadius: 10 }} /></label>
                <div style={{ marginTop: 10, border: "1px solid #e2e8f0", borderRadius: 14, overflow: "auto", maxHeight: "52vh" }}>{loading ? <div style={{ padding: 20 }}>Loading customers…</div> : null}{filtered.map((customer) => { const id = customer.id || customer.customer_id; const chosen = String(id) === selectedId; return <button key={id} type="button" onClick={() => selectCustomer(customer)} style={{ width: "100%", textAlign: "left", display: "grid", gridTemplateColumns: "38px 1fr 20px", gap: 10, alignItems: "center", padding: 12, border: 0, borderBottom: "1px solid #f1f5f9", background: chosen ? "#eff6ff" : "#fff", cursor: "pointer" }}><span style={{ width: 34, height: 34, borderRadius: "50%", display: "grid", placeItems: "center", background: "#e2e8f0", fontWeight: 900 }}>{nameOf(customer).slice(0,1).toUpperCase()}</span><span><strong style={{ display: "block" }}>{nameOf(customer)}</strong><small style={{ display: "block", color: "#64748b" }}>{phoneOf(customer) || "No phone"} · {locationOf(customer) || "No location"}</small><small style={{ display: "block", color: "#64748b" }}>{debtsOf(customer)} debt record{debtsOf(customer) === 1 ? "" : "s"}</small></span><span>›</span></button>; })}{!filtered.length && !loading ? <div style={{ padding: 20, color: "#64748b" }}>No customers match this search.</div> : null}</div>
              </section>
              <form onSubmit={save} style={{ padding: 16, border: "1px solid #e2e8f0", borderRadius: 16, background: "#f8fafc" }}><div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 900, color: "#64748b" }}>Selected customer</div><h3 style={{ margin: "5px 0 8px" }}>{selected ? nameOf(selected) : "Choose a customer"}</h3>{[["Customer name","name","Appiah Eugene"],["Phone number","phone","0240000000"],["Location","location","Dunkwa"]].map(([label, field, placeholder]) => <label key={field} style={{ display: "block", marginTop: 12, fontWeight: 800 }}>{label}<input value={form[field]} onChange={(e) => setForm((current) => ({ ...current, [field]: e.target.value }))} placeholder={placeholder} disabled={!selected || saving} style={{ display: "block", width: "100%", marginTop: 6, padding: 11, border: "1px solid #cbd5e1", borderRadius: 10 }} /></label>)}<small style={{ display: "block", marginTop: 10, color: "#64748b" }}>Only these three fields can be changed. A phone number is required for customers with debt.</small><div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}><button type="button" onClick={() => setOpen(false)} disabled={saving}>Cancel</button><button type="submit" disabled={!selected || saving}>{saving ? "Saving…" : "Save customer details"}</button></div></form>
            </div>
          </div>
        </section>
      </div> : null}
    </>
  );
}
