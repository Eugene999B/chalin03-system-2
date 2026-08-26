import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";

const EMPTY_FORM = {
  name: "",
  phone: "",
  location: "",
};

function normalizeName(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizePhone(value) {
  return String(value || "").trim();
}

function validateForm(form) {
  const name = normalizeName(form.name);
  const phone = normalizePhone(form.phone);
  const location = normalizeName(form.location);

  if (name.split(" ").filter(Boolean).length < 2) {
    return "Enter at least two separate customer names, for example Firstname Lastname.";
  }

  if (!/^[\p{L}][\p{L}'’.-]*(?:\s+[\p{L}][\p{L}'’.-]*)+$/u.test(name)) {
    return "Customer name must contain at least two clear names separated by spaces.";
  }

  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) {
    return "Enter a valid customer phone number with 7 to 15 digits.";
  }

  if (/[<>{}]/.test(location)) {
    return "Customer location contains invalid characters.";
  }

  return "";
}

function money(value) {
  const amount = Number(value || 0);
  return `GHS ${Number.isFinite(amount) ? amount.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) : "0.00"}`;
}

export default function CustomerIdentityEditor() {
  const location = useLocation();
  const { user } = useAuth();
  const role = String(user?.role || "").toLowerCase();
  const canEdit = role === "admin" || role === "manager";
  const visible = canEdit && (
    location.pathname === "/debts" ||
    location.pathname === "/customer-statement" ||
    location.pathname.startsWith("/customer-statement/")
  );

  const [open, setOpen] = useState(false);
  const [customers, setCustomers] = useState([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [query, setQuery] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const filteredCustomers = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return customers;

    return customers.filter((customer) =>
      [
        customer.customer_name,
        customer.customer_phone,
        customer.customer_location,
        customer.identity_source,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(term)
    );
  }, [customers, query]);

  const selected = useMemo(
    () => customers.find((customer) => customer.editor_key === selectedKey) || null,
    [customers, selectedKey]
  );

  async function loadCustomers() {
    setLoading(true);
    setError("");

    try {
      const response = await axiosClient.get("/customer-statements/identity-editor");
      const next = (response.data.customers || []).map((customer, index) => ({
        ...customer,
        editor_key:
          customer.identity_source === "linked"
            ? `customer-${customer.customer_id}`
            : `legacy-${customer.legacy_key || index}`,
      }));
      setCustomers(next);

      if (selectedKey) {
        const refreshed = next.find((customer) => customer.editor_key === selectedKey);
        if (refreshed) {
          setForm({
            name: refreshed.customer_name || "",
            phone: refreshed.customer_phone || "",
            location: refreshed.customer_location || "",
          });
        } else {
          setSelectedKey("");
          setForm(EMPTY_FORM);
        }
      }
    } catch (requestError) {
      setError(
        requestError?.response?.data?.message ||
          "Could not load customer identity records."
      );
    } finally {
      setLoading(false);
    }
  }

  function selectCustomer(customer) {
    setSelectedKey(customer.editor_key);
    setForm({
      name: customer.customer_name || "",
      phone: customer.customer_phone || "",
      location: customer.customer_location || "",
    });
    setError("");
    setMessage("");
  }

  async function saveCustomer() {
    const validation = validateForm(form);
    if (validation) {
      setError(validation);
      return;
    }

    if (!selected) return;

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const payload = {
        name: normalizeName(form.name),
        phone: normalizePhone(form.phone),
        location: normalizeName(form.location),
      };

      let response;
      if (selected.identity_source === "linked") {
        response = await axiosClient.put(
          `/customer-statements/identity-editor/customer/${selected.customer_id}`,
          payload
        );
      } else {
        response = await axiosClient.put(
          "/customer-statements/identity-editor/legacy",
          {
            ...payload,
            current_name: selected.customer_name,
            current_phone: selected.customer_phone || "",
          }
        );
      }

      setMessage(
        response.data?.message || "Customer identity updated successfully."
      );
      await loadCustomers();
      const nextCustomerId = response.data?.customer?.customer_id;
      const next = (customers || []).find((item) =>
        nextCustomerId
          ? item.customer_id === nextCustomerId
          : item.customer_name === payload.name && item.customer_phone === payload.phone
      );
      if (next) setSelectedKey(next.editor_key);
    } catch (requestError) {
      setError(
        requestError?.response?.data?.message ||
          "Could not save this customer identity."
      );
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    loadCustomers();
    // Load only when the user opens the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!visible) {
      setOpen(false);
    }
  }, [visible]);

  useEffect(() => {
    if (!open) return undefined;

    function handleKeyDown(event) {
      if (event.key === "Escape") setOpen(false);
    }

    window.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!visible) return null;

  return (
    <>
      <style>{`
        .customer-identity-tab {
          margin: 10px 14px 14px;
          width: calc(100% - 28px);
          border: 1px solid rgba(224,186,40,.35);
          border-radius: 14px;
          padding: 10px 12px;
          display: flex;
          align-items: center;
          gap: 9px;
          background: linear-gradient(135deg, rgba(224,186,40,.18), rgba(255,255,255,.06));
          color: #fff;
          font-weight: 900;
          font-size: 12px;
          cursor: pointer;
          text-align: left;
          box-shadow: 0 10px 24px rgba(0,0,0,.15);
        }
        .customer-identity-tab:hover { transform: translateY(-1px); }
        .customer-identity-tab__icon { font-size: 15px; }
        .customer-identity-modal {
          position: fixed;
          inset: 0;
          z-index: 5000;
          display: grid;
          place-items: center;
          padding: 20px;
          background: rgba(3, 10, 23, .72);
          backdrop-filter: blur(8px);
        }
        .customer-identity-card {
          width: min(1120px, 96vw);
          max-height: min(760px, 92vh);
          display: grid;
          grid-template-columns: minmax(0, 1fr) 380px;
          overflow: hidden;
          border-radius: 24px;
          background: #f7f9fc;
          color: #10233a;
          box-shadow: 0 40px 120px rgba(0,0,0,.38);
        }
        .customer-identity-list {
          min-width: 0;
          display: flex;
          flex-direction: column;
          border-right: 1px solid #e3e8f0;
        }
        .customer-identity-head {
          padding: 22px 24px 16px;
          background: linear-gradient(135deg, #07182c, #17487b);
          color: #fff;
        }
        .customer-identity-head h2 { margin: 0; font-size: 20px; }
        .customer-identity-head p { margin: 6px 0 0; color: rgba(255,255,255,.78); font-size: 12px; }
        .customer-identity-search {
          margin-top: 15px;
          width: 100%;
          border: 1px solid rgba(255,255,255,.22);
          border-radius: 13px;
          background: rgba(255,255,255,.1);
          color: #fff;
          padding: 11px 13px;
          outline: none;
        }
        .customer-identity-search::placeholder { color: rgba(255,255,255,.58); }
        .customer-identity-items {
          min-height: 0;
          overflow: auto;
          padding: 10px;
        }
        .customer-identity-row {
          width: 100%;
          border: 1px solid #e5eaf1;
          background: #fff;
          border-radius: 15px;
          padding: 13px 14px;
          text-align: left;
          cursor: pointer;
          margin-bottom: 8px;
          transition: .16s ease;
        }
        .customer-identity-row:hover { border-color: #b9c8da; transform: translateY(-1px); }
        .customer-identity-row.active { border-color: #17487b; box-shadow: 0 8px 22px rgba(23,72,123,.12); }
        .customer-identity-row__name { font-weight: 950; color: #10233a; }
        .customer-identity-row__meta { margin-top: 4px; color: #62738a; font-size: 11px; }
        .customer-identity-row__badge {
          display: inline-flex;
          margin-top: 8px;
          border-radius: 999px;
          padding: 4px 8px;
          font-size: 9px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: .06em;
          background: #edf3f9;
          color: #32516f;
        }
        .customer-identity-row__badge.legacy { background: #fff4db; color: #8a5a00; }
        .customer-identity-editor {
          min-width: 0;
          padding: 24px;
          display: flex;
          flex-direction: column;
          gap: 16px;
          background: #fff;
        }
        .customer-identity-editor h3 { margin: 0; font-size: 18px; }
        .customer-identity-editor p { margin: -8px 0 0; color: #66788f; font-size: 12px; }
        .customer-identity-fields { display: grid; gap: 13px; }
        .customer-identity-fields label { display: grid; gap: 6px; font-size: 11px; font-weight: 900; color: #4c6178; }
        .customer-identity-fields input {
          width: 100%;
          border: 1px solid #d9e0e9;
          border-radius: 12px;
          padding: 11px 12px;
          font: inherit;
          color: #10233a;
          background: #fbfcfe;
          outline: none;
        }
        .customer-identity-fields input:focus { border-color: #17487b; box-shadow: 0 0 0 3px rgba(23,72,123,.1); }
        .customer-identity-note {
          padding: 11px 12px;
          border-radius: 12px;
          background: #f1f6fb;
          color: #4d657f;
          font-size: 11px;
          line-height: 1.45;
        }
        .customer-identity-error, .customer-identity-success {
          border-radius: 12px;
          padding: 10px 12px;
          font-size: 11px;
          line-height: 1.4;
        }
        .customer-identity-error { background: #fff0ef; color: #9d2c24; border: 1px solid #f4c8c4; }
        .customer-identity-success { background: #edf9f1; color: #1f7040; border: 1px solid #caead6; }
        .customer-identity-actions { display: flex; gap: 9px; margin-top: auto; }
        .customer-identity-actions button { flex: 1; border: 0; border-radius: 12px; padding: 11px 12px; font-weight: 950; cursor: pointer; }
        .customer-identity-cancel { background: #edf1f6; color: #344b64; }
        .customer-identity-save { background: #102f51; color: #fff; }
        .customer-identity-save:disabled { opacity: .58; cursor: wait; }
        .customer-identity-close { position: absolute; top: 14px; right: 14px; border: 0; border-radius: 10px; padding: 8px 10px; cursor: pointer; background: rgba(255,255,255,.15); color: #fff; }
        @media (max-width: 850px) {
          .customer-identity-card { grid-template-columns: 1fr; max-height: 92vh; }
          .customer-identity-list { max-height: 43vh; border-right: 0; border-bottom: 1px solid #e3e8f0; }
          .customer-identity-editor { min-height: 330px; }
        }
      `}</style>

      <button
        type="button"
        className="customer-identity-tab"
        onClick={() => {
          setOpen(true);
          setError("");
          setMessage("");
        }}
        title="Correct customer names, phone numbers and locations"
      >
        <span className="customer-identity-tab__icon">✎</span>
        <span>Edit customer names</span>
      </button>

      {open ? (
        <div className="customer-identity-modal" role="dialog" aria-modal="true" aria-label="Edit customer names">
          <button type="button" className="customer-identity-close" onClick={() => setOpen(false)} aria-label="Close">
            ✕
          </button>

          <div className="customer-identity-card">
            <section className="customer-identity-list">
              <div className="customer-identity-head">
                <h2>Customer identity cleanup</h2>
                <p>Only the customer name, phone number and location can be changed here.</p>
                <input
                  className="customer-identity-search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search name or phone..."
                />
              </div>

              <div className="customer-identity-items">
                {loading ? <div className="customer-identity-note">Loading customer records…</div> : null}
                {!loading && filteredCustomers.length === 0 ? (
                  <div className="customer-identity-note">No customer identity records match this search.</div>
                ) : null}
                {filteredCustomers.map((customer) => (
                  <button
                    key={customer.editor_key}
                    type="button"
                    className={`customer-identity-row ${customer.editor_key === selectedKey ? "active" : ""}`}
                    onClick={() => selectCustomer(customer)}
                  >
                    <div className="customer-identity-row__name">
                      {customer.customer_name || "Unnamed Customer"}
                    </div>
                    <div className="customer-identity-row__meta">
                      {customer.customer_phone || "No phone number recorded"}
                    </div>
                    <div className="customer-identity-row__meta">
                      {customer.customer_location || "No location recorded"}
                    </div>
                    <span className={`customer-identity-row__badge ${customer.identity_source === "legacy" ? "legacy" : ""}`}>
                      {customer.identity_source === "legacy" ? "Needs cleanup" : "Customer master"}
                    </span>
                    <div className="customer-identity-row__meta">
                      {customer.sales_count || 0} sale records · {customer.debt_count || 0} debt records · {money(customer.outstanding_balance)} outstanding
                    </div>
                  </button>
                ))}
              </div>
            </section>

            <section className="customer-identity-editor">
              <div>
                <h3>{selected ? "Edit selected customer" : "Select a customer"}</h3>
                <p>
                  {selected
                    ? selected.identity_source === "legacy"
                      ? "Saving this record will create/link a proper customer master record and attach the existing sales and debt records to it."
                      : "Changes are reflected across the customer master and its sales/debt identity fields."
                    : "Choose a customer from the list to begin."}
                </p>
              </div>

              {error ? <div className="customer-identity-error">{error}</div> : null}
              {message ? <div className="customer-identity-success">{message}</div> : null}

              {selected ? (
                <>
                  <div className="customer-identity-fields">
                    <label>
                      Customer full name
                      <input
                        value={form.name}
                        onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                        placeholder="First name Last name"
                        autoComplete="off"
                      />
                    </label>
                    <label>
                      Phone / number
                      <input
                        value={form.phone}
                        onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
                        placeholder="024 xxx xxxx"
                        inputMode="tel"
                        autoComplete="off"
                      />
                    </label>
                    <label>
                      Location
                      <input
                        value={form.location}
                        onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))}
                        placeholder="Customer location"
                        autoComplete="off"
                      />
                    </label>
                  </div>

                  <div className="customer-identity-note">
                    The name must contain at least two separate names and the phone number is required. Financial amounts, payments, receipts and dates are not editable from this tool.
                  </div>
                </>
              ) : (
                <div className="customer-identity-note">
                  Start by choosing a record from the left. The editor is intentionally limited to identity fields only.
                </div>
              )}

              <div className="customer-identity-actions">
                <button type="button" className="customer-identity-cancel" onClick={() => setOpen(false)}>
                  Close
                </button>
                <button
                  type="button"
                  className="customer-identity-save"
                  disabled={!selected || saving}
                  onClick={saveCustomer}
                >
                  {saving ? "Saving…" : "Save identity"}
                </button>
              </div>
            </section>
          </div>
        </div>
      ) : null}
    </>
  );
}
