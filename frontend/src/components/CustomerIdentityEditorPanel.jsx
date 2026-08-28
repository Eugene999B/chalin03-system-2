import { useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";

function normalizeName(value) { return String(value || "").trim().replace(/\s+/g, " "); }
function nameIsValid(value) { return normalizeName(value).split(" ").filter(Boolean).length >= 2; }
function customerDebtCount(customer) { return Number(customer?.debt_count || customer?.active_debt_count || customer?.activeDebtCount || 0); }
function money(value) { return `GHS ${Number(value || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function customerLabel(customer) { return customer?.name || customer?.customer_name || "Unnamed Customer"; }
function customerPhone(customer) { return customer?.phone || customer?.customer_phone || ""; }
function customerLocation(customer) { return customer?.location || customer?.customer_location || ""; }

export default function CustomerIdentityEditorPanel({ title = "Edit customer details", compact = false }) {
  const [controls, setControls] = useState({ customer_identity_editing_enabled: true, customer_merge_enabled: true });
  const [open, setOpen] = useState(false);
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState({ name: "", phone: "", location: "" });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadControls() {
    try {
      const response = await axiosClient.get("/debt-customers/feature-controls");
      setControls(response.data.controls || {});
    } catch { /* The protected save API remains authoritative. */ }
  }
  async function loadCustomers() {
    setLoading(true); setError("");
    try {
      const response = await axiosClient.get("/debt-customers/directory", { params: { limit: 5000 } });
      setCustomers(response.data.customers || []);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Could not load the customer directory.");
    } finally { setLoading(false); }
  }
  useEffect(() => { loadControls(); }, []);
  useEffect(() => {
    if (!open || !controls.customer_identity_editing_enabled) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event) => { if (event.key === "Escape" && !saving) setOpen(false); };
    window.addEventListener("keydown", closeOnEscape);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", closeOnEscape); };
  }, [open, saving, controls.customer_identity_editing_enabled]);
  const filteredCustomers = useMemo(() => {
    const query = String(search || "").trim().toLowerCase();
    if (!query) return customers;
    return customers.filter((customer) => [customer?.id, customer?.customer_id, customerLabel(customer), customerPhone(customer), customerLocation(customer)].filter((value) => value !== undefined && value !== null).some((value) => String(value).toLowerCase().includes(query)));
  }, [customers, search]);
  function selectCustomer(customer) {
    const id = customer?.id || customer?.customer_id;
    setSelectedId(String(id || ""));
    setForm({ name: customerLabel(customer), phone: customerPhone(customer), location: customerLocation(customer) });
    setError(""); setMessage("");
  }
  function closeWorkspace() { if (saving) return; setOpen(false); setSelectedId(""); setSearch(""); setMessage(""); setError(""); }
  async function openWorkspace() {
    setMessage(""); setError(""); await loadControls();
    const enabled = controls.customer_identity_editing_enabled !== false;
    if (!enabled) { setError("Customer identity editing is currently disabled by an administrator."); return; }
    await loadCustomers(); setOpen(true);
  }
  async function saveCustomer(event) {
    event.preventDefault(); setError(""); setMessage("");
    const name = normalizeName(form.name); const phone = String(form.phone || "").trim(); const location = String(form.location || "").trim();
    if (!selectedId) return setError("Select a customer first.");
    if (!nameIsValid(name)) return setError("Customer name must contain at least two separate names, for example Appiah Eugene.");
    const selected = customers.find((customer) => String(customer.id || customer.customer_id) === selectedId);
    if (customerDebtCount(selected) > 0 && !phone) return setError("This customer has debt records, so a phone number is required.");
    setSaving(true);
    try {
      const response = await axiosClient.patch(`/debt-customers/customer/${selectedId}/identity`, { name, phone, location });
      const updatedCustomer = response.data.customer || { id: Number(selectedId), name, phone, location };
      setCustomers((current) => current.map((customer) => String(customer.id || customer.customer_id) === selectedId ? { ...customer, ...updatedCustomer } : customer));
      setForm({ name, phone, location });
      setMessage("Customer details saved. Debt and statement views will now use the corrected identity.");
    } catch (requestError) { setError(requestError.response?.data?.message || "Could not save the selected customer details."); }
    finally { setSaving(false); }
  }
  if (!controls.customer_identity_editing_enabled) return null;
  const selectedCustomer = customers.find((customer) => String(customer.id || customer.customer_id) === selectedId);
  return (
    <>
      <button type="button" className={`customer-identity-editor__launcher ${compact ? "is-compact" : ""}`} onClick={openWorkspace} title="Correct customer name, phone number and location"><span aria-hidden="true">✎</span><span>{title}</span></button>
      {open ? <div className="customer-identity-editor__backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) closeWorkspace(); }}>
        <section className="customer-identity-editor__dialog" role="dialog" aria-modal="true" aria-label="Customer identity editor">
          <header className="customer-identity-editor__header"><div><span>Customer Data Desk</span><h2>Correct customer details</h2><p>Edit only the customer name, phone number and location. Every name must contain at least two separate names.</p></div><button type="button" onClick={closeWorkspace} disabled={saving} aria-label="Close">×</button></header>
          <div className="customer-identity-editor__body">
            {message ? <div className="customer-identity-editor__notice is-success">{message}</div> : null}
            {error ? <div className="customer-identity-editor__notice is-error">{error}</div> : null}
            <div className="customer-identity-editor__summary"><span>Directory</span><strong>{customers.length.toLocaleString("en-GB")} customers</strong><small>{filteredCustomers.length.toLocaleString("en-GB")} shown · select one customer to edit</small></div>
            <div className="customer-identity-editor__layout">
              <section className="customer-identity-editor__directory"><label className="customer-identity-editor__search"><span>Search customer</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, phone, location or customer ID" /></label><div className="customer-identity-editor__list">
                {loading ? <div className="customer-identity-editor__empty">Loading customers…</div> : filteredCustomers.length === 0 ? <div className="customer-identity-editor__empty">No customers match this search.</div> : filteredCustomers.map((customer) => { const id = customer.id || customer.customer_id; const debtCount = customerDebtCount(customer); const selected = String(id) === selectedId; return <button key={id} type="button" className={`customer-identity-editor__customer ${selected ? "is-selected" : ""}`} onClick={() => selectCustomer(customer)}><span className="customer-identity-editor__avatar">{customerLabel(customer).slice(0,1).toUpperCase()}</span><span className="customer-identity-editor__customer-copy"><strong>{customerLabel(customer)}</strong><small>{customerPhone(customer) || "No phone"} · {customerLocation(customer) || "No location"}</small><small>{debtCount > 0 ? `${debtCount} debt record${debtCount === 1 ? "" : "s"}` : "No debt records"}{customer?.outstanding_balance !== undefined ? ` · ${money(customer.outstanding_balance)} outstanding` : ""}</small></span><span className="customer-identity-editor__chevron">›</span></button>; })}
              </div></section>
              <form className="customer-identity-editor__form" onSubmit={saveCustomer}><div className="customer-identity-editor__form-kicker">Selected customer</div><h3>{selectedCustomer ? customerLabel(selectedCustomer) : "Choose a customer"}</h3><p className="customer-identity-editor__form-note">{selectedCustomer && customerDebtCount(selectedCustomer) > 0 ? "This customer has debt records. A phone number is mandatory before saving." : "Name, phone and location are the only editable fields here."}</p>
                <label><span>Customer name</span><input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Appiah Eugene" disabled={!selectedCustomer || saving} /><small>Two or more separate names are required.</small></label>
                <label><span>Phone number{selectedCustomer && customerDebtCount(selectedCustomer) > 0 ? " *" : ""}</span><input value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} placeholder="0240000000" disabled={!selectedCustomer || saving} /><small>Required for any customer with debt records.</small></label>
                <label><span>Location</span><input value={form.location} onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))} placeholder="Dunkwa" disabled={!selectedCustomer || saving} /></label>
                <div className="customer-identity-editor__form-footer"><button type="button" onClick={closeWorkspace} disabled={saving}>Cancel</button><button type="submit" disabled={!selectedCustomer || saving}>{saving ? "Saving…" : "Save customer details"}</button></div>
              </form>
            </div>
          </div>
        </section>
      </div> : null}
    </>
  );
}
