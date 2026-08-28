import { useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";

const nameOf = (c) => c?.name || c?.customer_name || "Unnamed Customer";
const phoneOf = (c) => c?.phone || c?.customer_phone || "";
const locationOf = (c) => c?.location || c?.customer_location || "";
const debtCountOf = (c) => Number(c?.debt_count || c?.active_debt_count || 0);
const normalize = (v) => String(v ?? "").trim().replace(/\s+/g, " ");

export default function CustomerIdentityEditorPanel({ title = "Edit Customer Details" }) {
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

  async function readControl() {
    try {
      const response = await axiosClient.get("/debt-customers/feature-controls");
      const nextEnabled = response.data.controls?.customer_identity_editing_enabled !== false;
      setEnabled(nextEnabled);
      return nextEnabled;
    } catch {
      return enabled;
    }
  }
  useEffect(() => { readControl(); }, []);

  async function openEditor() {
    setError(""); setMessage("");
    const allowed = await readControl();
    if (!allowed) { setError("Customer identity editing is currently disabled by an administrator."); return; }
    setLoading(true);
    try {
      const response = await axiosClient.get("/debt-customers/directory", { params: { limit: 5000 } });
      setCustomers(response.data.customers || []);
      setOpen(true);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Could not load the customer directory.");
    } finally { setLoading(false); }
  }

  function selectCustomer(customer) {
    setSelectedId(String(customer.id || customer.customer_id));
    setForm({ name: nameOf(customer), phone: phoneOf(customer), location: locationOf(customer) });
    setError(""); setMessage("");
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => [c.id, nameOf(c), phoneOf(c), locationOf(c)].some((v) => String(v ?? "").toLowerCase().includes(q)));
  }, [customers, search]);

  async function save(event) {
    event.preventDefault(); setError(""); setMessage("");
    const name = normalize(form.name); const phone = form.phone.trim(); const location = form.location.trim();
    if (!selectedId) return setError("Select a customer first.");
    if (name.split(" ").filter(Boolean).length < 2) return setError("Customer name must contain at least two separate names, for example Appiah Eugene.");
    const selected = customers.find((c) => String(c.id || c.customer_id) === selectedId);
    if (debtCountOf(selected) > 0 && !phone) return setError("This customer has debt records, so a phone number is required.");
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
      <button type="button" onClick={openEditor} disabled={loading}>{loading ? "Loading…" : `✎ ${title}`}</button>
      {open ? <div role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) setOpen(false); }} style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,.55)", display: "grid", placeItems: "center", padding: 18 }}>
        <section role="dialog" aria-modal="true" style={{ width: "min(1100px,100%)", maxHeight: "calc(100vh - 36px)", overflow: "auto", borderRadius: 22, background: "#fff", padding: 20, boxShadow: "0 28px 80px rgba(15,23,42,.28)" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><div><div style={{ fontSize: 11, fontWeight: 900, letterSpacing: ".08em", textTransform: "uppercase", color: "#a17a00" }}>Customer Data Desk</div><h2 style={{ margin: "4px 0" }}>Correct customer details</h2><p style={{ margin: 0, color: "#64748b" }}>Edit only name, phone and location.</p></div><button type="button" onClick={() => setOpen(false)} disabled={saving}>×</button></div>
          {message ? <div style={{ margin: "12px 0", padding: 10, background: "#f0fdf4", color: "#166534" }}>{message}</div> : null}
          {error ? <div style={{ margin: "12px 0", padding: 10, background: "#fef2f2", color: "#991b1b" }}>{error}</div> : null}
          <div style={{ display: "grid", gridTemplateColumns: "1.1fr .9fr", gap: 16 }}>
            <div><input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, phone, location or ID" style={{ width: "100%", padding: 11, boxSizing: "border-box" }} /><div style={{ marginTop: 10, maxHeight: 430, overflow: "auto", border: "1px solid #e2e8f0" }}>{filtered.map((customer) => { const id = customer.id || customer.customer_id; const chosen = String(id) === selectedId; return <button key={id} type="button" onClick={() => selectCustomer(customer)} style={{ display: "block", width: "100%", textAlign: "left", padding: 12, border: 0, borderBottom: "1px solid #f1f5f9", background: chosen ? "#eff6ff" : "#fff" }}><strong>{nameOf(customer)}</strong><div style={{ color: "#64748b" }}>{phoneOf(customer) || "No phone"} · {locationOf(customer) || "No location"}</div></button>; })}{!filtered.length ? <div style={{ padding: 16, color: "#64748b" }}>No customers match this search.</div> : null}</div></div>
            <form onSubmit={save} style={{ padding: 16, background: "#f8fafc", border: "1px solid #e2e8f0" }}><h3>{selected ? nameOf(selected) : "Choose a customer"}</h3>{[["Customer name","name","Appiah Eugene"],["Phone number","phone","0240000000"],["Location","location","Dunkwa"]].map(([label, field, placeholder]) => <label key={field} style={{ display: "block", marginTop: 12, fontWeight: 800 }}>{label}<input value={form[field]} onChange={(e) => setForm((current) => ({ ...current, [field]: e.target.value }))} placeholder={placeholder} disabled={!selectedId || saving} style={{ display: "block", width: "100%", marginTop: 6, padding: 11, boxSizing: "border-box" }} /></label>)}<small style={{ display: "block", marginTop: 10, color: "#64748b" }}>Customers with debt require a phone number.</small><div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}><button type="button" onClick={() => setOpen(false)} disabled={saving}>Cancel</button><button type="submit" disabled={!selectedId || saving}>{saving ? "Saving…" : "Save customer details"}</button></div></form>
          </div>
        </section>
      </div> : null}
    </>
  );
}
