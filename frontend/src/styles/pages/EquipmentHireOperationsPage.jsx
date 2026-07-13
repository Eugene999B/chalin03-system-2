import { useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import { useWorkspaceContext } from "../context/WorkspaceContext";
import "../styles/equipmentHire.css";

const TABS = [
  ["overview", "Overview", "📊"],
  ["customers", "Customers", "👥"],
  ["enquiries", "Enquiries", "📨"],
  ["availability", "Availability", "📅"],
  ["quotations", "Quotations", "📝"],
  ["contracts", "Contracts", "🤝"],
  ["operations", "Operations", "🚜"],
  ["finance", "Finance", "💳"],
  ["returns", "Returns", "🔍"],
  ["reports", "Reports", "📈"],
];

function localDate() {
  const date = new Date();
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10);
}

function localDateTime() {
  const date = new Date();
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 16);
}

function plusDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10);
}

function formatNumber(value, digits = 2) {
  return new Intl.NumberFormat("en-GH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(Number(value || 0));
}

function formatMoney(value) {
  return `GHS ${formatNumber(value, 2)}`;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-GH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-GH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function dateInput(value) {
  return String(value || "").slice(0, 10);
}

function label(value) {
  return String(value || "—")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function apiMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

function downloadCsv(filename, rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    window.alert("There are no visible records to export.");
    return;
  }

  const columns = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row || {}).forEach((key) => set.add(key));
      return set;
    }, new Set())
  );

  const escapeCell = (value) => {
    if (value === null || value === undefined) return "";
    const text = typeof value === "object" ? JSON.stringify(value) : String(value);
    return `"${text.replaceAll('"', '""')}"`;
  };

  const csv = [
    columns.map(escapeCell).join(","),
    ...rows.map((row) => columns.map((column) => escapeCell(row[column])).join(",")),
  ].join("\r\n");

  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function StatusPill({ value }) {
  const tone = String(value || "neutral").toLowerCase().replaceAll("_", "-");
  return <span className={`hire-pill hire-pill--${tone}`}>{label(value)}</span>;
}

function EmptyState({ icon = "📭", title, description }) {
  return (
    <div className="hire-empty">
      <span aria-hidden="true">{icon}</span>
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}

function SectionHeader({ eyebrow, title, description, action }) {
  return (
    <div className="hire-section-header">
      <div>
        {eyebrow ? <p>{eyebrow}</p> : null}
        <h2>{title}</h2>
        {description ? <span>{description}</span> : null}
      </div>
      {action}
    </div>
  );
}

function CustomerSelect({ customers, value, onChange, required = false }) {
  return (
    <select value={value} onChange={onChange} required={required}>
      <option value="">Choose hire customer</option>
      {customers
        .filter((customer) => Number(customer.is_active) !== 0)
        .map((customer) => (
          <option key={customer.id} value={customer.id}>
            {customer.customer_code} — {customer.customer_name}
          </option>
        ))}
    </select>
  );
}

function ContractSelect({ contracts, value, onChange, required = false, activeOnly = false }) {
  const allowed = activeOnly
    ? contracts.filter((contract) =>
        ["draft", "confirmed", "mobilizing", "active", "suspended"].includes(contract.status)
      )
    : contracts;

  return (
    <select value={value} onChange={onChange} required={required}>
      <option value="">Choose hire contract</option>
      {allowed.map((contract) => (
        <option key={contract.id} value={contract.id}>
          {contract.contract_number} — {contract.customer_name}
        </option>
      ))}
    </select>
  );
}

function AssignmentSelect({ assignments, value, onChange, required = false, openOnly = false }) {
  const allowed = openOnly
    ? assignments.filter((assignment) =>
        ["assigned", "dispatched", "active"].includes(assignment.status)
      )
    : assignments;

  return (
    <select value={value} onChange={onChange} required={required}>
      <option value="">Choose assigned equipment</option>
      {allowed.map((assignment) => (
        <option key={assignment.id} value={assignment.id}>
          {assignment.contract_number} — {assignment.asset_code} — {assignment.asset_name}
        </option>
      ))}
    </select>
  );
}

function FormActions({ saving, onCancel, submitLabel = "Save record" }) {
  return (
    <div className="hire-form-actions">
      <button type="button" className="hire-btn hire-btn--ghost" onClick={onCancel}>
        Cancel
      </button>
      <button type="submit" className="hire-btn hire-btn--primary" disabled={saving}>
        {saving ? "Saving…" : submitLabel}
      </button>
    </div>
  );
}

const createCustomerForm = () => ({
  customer_code: "",
  customer_name: "",
  customer_type: "individual",
  phone: "",
  whatsapp_phone: "",
  email: "",
  address: "",
  contact_person: "",
  payment_terms_days: "0",
  credit_limit: "0",
  risk_notes: "",
  is_active: true,
});

const createEnquiryForm = () => ({
  customer_id: "",
  enquiry_date: localDate(),
  equipment_type: "Excavator",
  work_location: "",
  requested_start_date: localDate(),
  expected_end_date: plusDays(7),
  preferred_charging_method: "hourly",
  estimated_quantity: "",
  notes: "",
});

const createQuotationForm = () => ({
  enquiry_id: "",
  customer_id: "",
  requested_asset_type: "Excavator",
  preferred_asset_id: "",
  work_location: "",
  requested_start_date: localDate(),
  expected_end_date: plusDays(7),
  charging_method: "hourly",
  rate: "",
  estimated_quantity: "",
  minimum_quantity: "0",
  mobilization_amount: "0",
  demobilization_amount: "0",
  operator_amount: "0",
  fuel_responsibility: "customer",
  discount_amount: "0",
  tax_rate: "0",
  validity_date: plusDays(14),
  terms: "",
  notes: "",
});

const createContractForm = () => ({
  quotation_id: "",
  customer_id: "",
  work_location: "",
  start_date: localDate(),
  expected_end_date: plusDays(7),
  charging_method: "hourly",
  rate: "",
  minimum_quantity: "0",
  mobilization_amount: "0",
  demobilization_amount: "0",
  operator_amount: "0",
  deposit_required: "0",
  fuel_responsibility: "customer",
  terms: "",
  notes: "",
});

const createAssignmentForm = () => ({
  contract_id: "",
  asset_id: "",
  operator_name: "",
  assigned_from: localDateTime(),
  assigned_to: "",
  opening_meter: "",
  notes: "",
});

const createDispatchForm = () => ({
  contract_asset_id: "",
  dispatch_datetime: localDateTime(),
  destination: "",
  opening_meter: "",
  fuel_level_percent: "",
  condition_status: "good",
  attachments_tools: "",
  transport_details: "",
  receiving_person: "",
  notes: "",
});

const createWorkLogForm = () => ({
  contract_asset_id: "",
  work_date: localDate(),
  start_meter: "",
  end_meter: "",
  billable_hours: "",
  idle_hours: "0",
  breakdown_hours: "0",
  fuel_litres: "0",
  work_description: "",
  customer_representative: "",
});

const createInvoiceForm = () => ({
  contract_id: "",
  invoice_date: localDate(),
  due_date: "",
  period_start: localDate(),
  period_end: localDate(),
  billable_quantity: "",
  work_log_ids: [],
  include_mobilization: false,
  include_demobilization: false,
  include_operator: false,
  other_amount: "0",
  discount_amount: "0",
  tax_rate: "0",
  notes: "",
});

const createPaymentForm = () => ({
  invoice_id: "",
  contract_id: "",
  payment_date: localDateTime(),
  payment_category: "invoice",
  amount: "",
  payment_method: "cash",
  reference_number: "",
  notes: "",
});

const createReturnForm = () => ({
  contract_asset_id: "",
  return_datetime: localDateTime(),
  closing_meter: "",
  fuel_level_percent: "",
  condition_status: "good",
  damage_details: "",
  missing_items: "",
  estimated_damage_amount: "0",
  customer_representative: "",
  notes: "",
});

const createReportsData = () => ({
  outstanding_invoices: [],
  customer_outstanding: [],
  aging_summary: {},
  aging_detail: [],
  overdue_alerts: { invoices: [], contracts: [] },
  payment_history: [],
  unpaid_closed_contracts: [],
  fleet_utilization: [],
});

export default function EquipmentHireOperationsPage({ section = "overview" }) {
  const { user } = useAuth();
  const {
    options: hireLocationOptions,
    selectedContextId,
    selectedContext,
    automaticAccess,
    loading: contextLoading,
  } = useWorkspaceContext();
  const role = String(user?.role || "").toLowerCase();
  const canEdit = role === "admin" || role === "manager";
  const requestedSection = TABS.some(([code]) => code === section)
    ? section
    : "overview";

  const [activeTab, setActiveTab] = useState(requestedSection);
  const [dashboard, setDashboard] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [enquiries, setEnquiries] = useState([]);
  const [assets, setAssets] = useState([]);
  const [quotations, setQuotations] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [dispatches, setDispatches] = useState([]);
  const [workLogs, setWorkLogs] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [payments, setPayments] = useState([]);
  const [returns, setReturns] = useState([]);
  const [financeSummary, setFinanceSummary] = useState(null);
  const [billableWorkLogs, setBillableWorkLogs] = useState([]);
  const [reports, setReports] = useState(createReportsData);

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formMode, setFormMode] = useState("");
  const [message, setMessage] = useState(null);

  const [customerForm, setCustomerForm] = useState(createCustomerForm);
  const [enquiryForm, setEnquiryForm] = useState(createEnquiryForm);
  const [quotationForm, setQuotationForm] = useState(createQuotationForm);
  const [contractForm, setContractForm] = useState(createContractForm);
  const [assignmentForm, setAssignmentForm] = useState(createAssignmentForm);
  const [dispatchForm, setDispatchForm] = useState(createDispatchForm);
  const [workLogForm, setWorkLogForm] = useState(createWorkLogForm);
  const [invoiceForm, setInvoiceForm] = useState(createInvoiceForm);
  const [paymentForm, setPaymentForm] = useState(createPaymentForm);
  const [returnForm, setReturnForm] = useState(createReturnForm);

  useEffect(() => {
    setActiveTab(requestedSection);
    setFormMode("");
    setMessage(null);
  }, [requestedSection]);

  const notify = (type, text) => {
    setMessage({ type, text });
    window.clearTimeout(window.__hireMessageTimer);
    window.__hireMessageTimer = window.setTimeout(() => setMessage(null), 5500);
  };

  const dateQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (dateFrom) params.set("from", dateFrom);
    if (dateTo) params.set("to", dateTo);
    const query = params.toString();
    return query ? `?${query}` : "";
  }, [dateFrom, dateTo]);

  async function loadDashboard() {
    const response = await axiosClient.get("/equipment-hire/dashboard");
    setDashboard(response.data.dashboard || null);
  }

  async function loadReferences() {
    const [customerResponse, quoteResponse, contractResponse, assetResponse, assignmentResponse, invoiceResponse] =
      await Promise.all([
        axiosClient.get("/equipment-hire/customers"),
        axiosClient.get("/equipment-hire/quotations"),
        axiosClient.get("/equipment-hire/contracts"),
        axiosClient.get(
          `/equipment-hire/availability?from=${encodeURIComponent(localDate())}&to=${encodeURIComponent(
            plusDays(30)
          )}`
        ),
        axiosClient.get("/equipment-hire/contract-assets"),
        axiosClient.get("/equipment-hire/invoices"),
      ]);

    setCustomers(customerResponse.data.customers || []);
    setQuotations(quoteResponse.data.quotations || []);
    setContracts(contractResponse.data.contracts || []);
    setAssets(assetResponse.data.assets || []);
    setAssignments(assignmentResponse.data.contract_assets || []);
    setInvoices(invoiceResponse.data.invoices || []);
  }

  async function loadTab(tab = activeTab) {
    setRecordsLoading(true);
    try {
      if (tab === "overview") {
        await loadDashboard();
      } else if (tab === "customers") {
        const params = search ? `?search=${encodeURIComponent(search)}` : "";
        const response = await axiosClient.get(`/equipment-hire/customers${params}`);
        setCustomers(response.data.customers || []);
      } else if (tab === "enquiries") {
        const response = await axiosClient.get(`/equipment-hire/enquiries${dateQuery}`);
        setEnquiries(response.data.enquiries || []);
      } else if (tab === "availability") {
        const from = dateFrom || localDate();
        const to = dateTo || plusDays(30);
        const response = await axiosClient.get(
          `/equipment-hire/availability?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
        );
        setAssets(response.data.assets || []);
      } else if (tab === "quotations") {
        const response = await axiosClient.get(`/equipment-hire/quotations${dateQuery}`);
        setQuotations(response.data.quotations || []);
      } else if (tab === "contracts") {
        const response = await axiosClient.get(`/equipment-hire/contracts${dateQuery}`);
        setContracts(response.data.contracts || []);
      } else if (tab === "operations") {
        const [assignmentResponse, dispatchResponse, logResponse] = await Promise.all([
          axiosClient.get("/equipment-hire/contract-assets"),
          axiosClient.get(`/equipment-hire/dispatches${dateQuery}`),
          axiosClient.get(`/equipment-hire/work-logs${dateQuery}`),
        ]);
        setAssignments(assignmentResponse.data.contract_assets || []);
        setDispatches(dispatchResponse.data.dispatches || []);
        setWorkLogs(logResponse.data.work_logs || []);
      } else if (tab === "finance") {
        const [invoiceResponse, paymentResponse, summaryResponse, billableResponse] = await Promise.all([
          axiosClient.get(`/equipment-hire/invoices${dateQuery}`),
          axiosClient.get(`/equipment-hire/payments${dateQuery}`),
          axiosClient.get("/equipment-hire/finance-summary"),
          axiosClient.get(`/equipment-hire/billable-work-logs${dateQuery}`),
        ]);
        setInvoices(invoiceResponse.data.invoices || []);
        setPayments(paymentResponse.data.payments || []);
        setFinanceSummary(summaryResponse.data || null);
        setBillableWorkLogs(billableResponse.data.work_logs || []);
      } else if (tab === "returns") {
        const response = await axiosClient.get(`/equipment-hire/returns${dateQuery}`);
        setReturns(response.data.returns || []);
      } else if (tab === "reports") {
        const response = await axiosClient.get(`/equipment-hire/reports${dateQuery}`);
        setReports(response.data.reports || createReportsData());
      }
    } catch (error) {
      notify("error", apiMessage(error, "Could not load Equipment Hire records."));
    } finally {
      setRecordsLoading(false);
    }
  }

  async function reloadAll(tab = activeTab) {
    await Promise.all([loadDashboard(), loadReferences()]);
    await loadTab(tab);
  }

  useEffect(() => {
    let cancelled = false;

    async function start() {
      if (contextLoading) return;

      if (!automaticAccess && !selectedContextId) {
        setDashboard(null);
        setEnquiries([]);
        setAssets([]);
        setQuotations([]);
        setContracts([]);
        setAssignments([]);
        setDispatches([]);
        setWorkLogs([]);
        setInvoices([]);
        setPayments([]);
        setReturns([]);
        setFinanceSummary(null);
        setBillableWorkLogs([]);
        setReports(createReportsData());
        setLoading(false);
        return;
      }

      setLoading(true);
      setFormMode("");
      try {
        await Promise.all([loadDashboard(), loadReferences()]);
        if (!cancelled) {
          await loadTab(activeTab);
        }
      } catch (error) {
        if (!cancelled) {
          notify(
            "error",
            apiMessage(error, "Could not start the Equipment Hire workspace.")
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    start();
    return () => {
      cancelled = true;
    };
    // Reload every Hire dataset when the active office, yard or depot changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextLoading, selectedContextId, automaticAccess]);

  useEffect(() => {
    if (
      !loading &&
      !contextLoading &&
      (automaticAccess || selectedContextId)
    ) {
      loadTab(activeTab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, dateQuery]);

  function closeForm() {
    setFormMode("");
  }

  async function performSave(saveFunction, successMessage) {
    setSaving(true);
    try {
      await saveFunction();
      notify("success", successMessage);
      closeForm();
      await reloadAll(activeTab);
    } catch (error) {
      notify("error", apiMessage(error, "Could not save the Equipment Hire record."));
    } finally {
      setSaving(false);
    }
  }

  async function submitCustomer(event) {
    event.preventDefault();
    await performSave(
      () => axiosClient.post("/equipment-hire/customers", customerForm),
      "Hire customer saved successfully."
    );
    setCustomerForm(createCustomerForm());
  }

  async function submitEnquiry(event) {
    event.preventDefault();
    const enquiryId = enquiryForm.id;
    await performSave(
      () =>
        enquiryId
          ? axiosClient.put(`/equipment-hire/enquiries/${enquiryId}`, enquiryForm)
          : axiosClient.post("/equipment-hire/enquiries", {
              ...enquiryForm,
              hire_location_id: selectedContextId || null,
            }),
      enquiryId
        ? "Equipment enquiry updated successfully."
        : "Equipment enquiry saved successfully."
    );
    setEnquiryForm(createEnquiryForm());
  }

  async function submitQuotation(event) {
    event.preventDefault();
    const quotationId = quotationForm.id;
    await performSave(
      () =>
        quotationId
          ? axiosClient.put(`/equipment-hire/quotations/${quotationId}`, quotationForm)
          : axiosClient.post("/equipment-hire/quotations", {
              ...quotationForm,
              hire_location_id: selectedContextId || null,
            }),
      quotationId
        ? "Hire quotation updated successfully."
        : "Hire quotation created successfully."
    );
    setQuotationForm(createQuotationForm());
  }

  async function submitContract(event) {
    event.preventDefault();
    await performSave(
      () =>
        axiosClient.post("/equipment-hire/contracts", {
          ...contractForm,
          hire_location_id: selectedContextId || null,
        }),
      "Hire contract created successfully."
    );
    setContractForm(createContractForm());
  }

  async function submitAssignment(event) {
    event.preventDefault();
    await performSave(
      () =>
        axiosClient.post(
          `/equipment-hire/contracts/${assignmentForm.contract_id}/assets`,
          assignmentForm
        ),
      "Equipment assigned to the contract."
    );
    setAssignmentForm(createAssignmentForm());
  }

  async function submitDispatch(event) {
    event.preventDefault();
    await performSave(
      () => axiosClient.post("/equipment-hire/dispatches", dispatchForm),
      "Equipment dispatch saved successfully."
    );
    setDispatchForm(createDispatchForm());
  }

  async function submitWorkLog(event) {
    event.preventDefault();
    await performSave(
      () => axiosClient.post("/equipment-hire/work-logs", workLogForm),
      "Hire work log saved successfully."
    );
    setWorkLogForm(createWorkLogForm());
  }

  async function submitInvoice(event) {
    event.preventDefault();
    await performSave(
      () => axiosClient.post("/equipment-hire/invoices", invoiceForm),
      "Hire invoice created successfully."
    );
    setInvoiceForm(createInvoiceForm());
  }

  async function submitPayment(event) {
    event.preventDefault();
    if (!window.confirm("Record this payment and update the invoice balance?")) return;
    await performSave(
      () => axiosClient.post("/equipment-hire/payments", paymentForm),
      "Hire payment recorded successfully."
    );
    setPaymentForm(createPaymentForm());
  }

  async function submitReturn(event) {
    event.preventDefault();
    if (!window.confirm("Complete this return inspection and update Fleet status?")) return;
    await performSave(
      () => axiosClient.post("/equipment-hire/returns", returnForm),
      "Return inspection saved and Fleet status updated."
    );
    setReturnForm(createReturnForm());
  }

  async function voidInvoice(invoice) {
    if (!window.confirm(`Void invoice ${invoice.invoice_number}?`)) return;
    setSaving(true);
    try {
      await axiosClient.patch(`/equipment-hire/invoices/${invoice.id}/void`);
      notify("success", "Hire invoice voided.");
      await reloadAll("finance");
    } catch (error) {
      notify("error", apiMessage(error, "Could not void the invoice."));
    } finally {
      setSaving(false);
    }
  }

  async function closeContract(contract) {
    const notes = window.prompt(
      `Close contract ${contract.contract_number}? Outstanding balances will remain visible.`,
      ""
    );
    if (notes === null) return;

    setSaving(true);
    try {
      await axiosClient.patch(`/equipment-hire/contracts/${contract.id}/close`, {
        closure_notes: notes,
      });
      notify("success", "Contract closed.");
      await reloadAll(activeTab);
    } catch (error) {
      notify("error", apiMessage(error, "Could not close the contract."));
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(path, status, confirmation) {
    if (!window.confirm(confirmation)) return;
    setSaving(true);
    try {
      await axiosClient.patch(path, { status });
      notify("success", `Status changed to ${label(status)}.`);
      await reloadAll(activeTab);
    } catch (error) {
      notify("error", apiMessage(error, "Could not update status."));
    } finally {
      setSaving(false);
    }
  }

  async function convertEnquiryToQuotation(enquiry) {
    if (!window.confirm(`Create a draft quotation from ${enquiry.enquiry_number}?`)) return;
    setSaving(true);
    try {
      await axiosClient.post(`/equipment-hire/enquiries/${enquiry.id}/convert-to-quotation`);
      notify("success", "Draft quotation created from the enquiry.");
      setActiveTab("quotations");
      await reloadAll("quotations");
    } catch (error) {
      notify("error", apiMessage(error, "Could not convert the enquiry."));
    } finally {
      setSaving(false);
    }
  }

  async function convertQuotationToContract(quote) {
    if (!window.confirm(`Create a hire contract from ${quote.quotation_number}?`)) return;
    setSaving(true);
    try {
      await axiosClient.post(`/equipment-hire/quotations/${quote.id}/convert-to-contract`);
      notify("success", "Approved quotation converted to a contract.");
      setActiveTab("contracts");
      await reloadAll("contracts");
    } catch (error) {
      notify("error", apiMessage(error, "Could not convert the quotation."));
    } finally {
      setSaving(false);
    }
  }

  async function removeAssignment(assignment) {
    if (!window.confirm(`Remove ${assignment.asset_code} before dispatch?`)) return;
    setSaving(true);
    try {
      await axiosClient.delete(`/equipment-hire/contract-assets/${assignment.id}`);
      notify("success", "Equipment assignment removed before dispatch.");
      await reloadAll("operations");
    } catch (error) {
      notify("error", apiMessage(error, "Could not remove the equipment assignment."));
    } finally {
      setSaving(false);
    }
  }

  function editEnquiry(enquiry) {
    openForm("enquiry", {
      id: enquiry.id,
      customer_id: String(enquiry.customer_id || ""),
      enquiry_date: dateInput(enquiry.enquiry_date) || localDate(),
      equipment_type: enquiry.equipment_type || "",
      work_location: enquiry.work_location || "",
      requested_start_date: dateInput(enquiry.requested_start_date),
      expected_end_date: dateInput(enquiry.expected_end_date),
      preferred_charging_method: enquiry.preferred_charging_method || "hourly",
      estimated_quantity: enquiry.estimated_quantity ?? "",
      notes: enquiry.notes || "",
    });
  }

  function editQuotation(quote) {
    openForm("quotation", {
      id: quote.id,
      enquiry_id: quote.enquiry_id ? String(quote.enquiry_id) : "",
      customer_id: String(quote.customer_id || ""),
      requested_asset_type: quote.requested_asset_type || "",
      preferred_asset_id: quote.preferred_asset_id ? String(quote.preferred_asset_id) : "",
      work_location: quote.work_location || "",
      requested_start_date: dateInput(quote.requested_start_date) || localDate(),
      expected_end_date: dateInput(quote.expected_end_date),
      charging_method: quote.charging_method || "hourly",
      rate: quote.rate ?? "",
      estimated_quantity: quote.estimated_quantity ?? "",
      minimum_quantity: quote.minimum_quantity ?? "0",
      mobilization_amount: quote.mobilization_amount ?? "0",
      demobilization_amount: quote.demobilization_amount ?? "0",
      operator_amount: quote.operator_amount ?? "0",
      fuel_responsibility: quote.fuel_responsibility || "customer",
      discount_amount: quote.discount_amount ?? "0",
      tax_rate: Number(quote.tax_amount || 0) > 0
        ? String(
            Number(
              (
                (Number(quote.tax_amount || 0) /
                  Math.max(
                    Number(quote.subtotal || 0) - Number(quote.discount_amount || 0),
                    1
                  )) *
                100
              ).toFixed(2)
            )
          )
        : "0",
      validity_date: dateInput(quote.validity_date),
      terms: quote.terms || "",
      notes: quote.notes || "",
    });
  }

  const reportExportRows = useMemo(() => {
    const agingRows = Object.entries(reports.aging_summary || {}).map(
      ([bucket, row]) => ({
        report_type: "aging_summary",
        aging_bucket: bucket,
        invoice_count: row.invoice_count,
        balance: row.balance,
      })
    );

    return [
      ...(reports.outstanding_invoices || []).map((row) => ({
        report_type: "outstanding_invoice",
        ...row,
      })),
      ...(reports.customer_outstanding || []).map((row) => ({
        report_type: "customer_outstanding",
        ...row,
      })),
      ...agingRows,
      ...(reports.payment_history || []).map((row) => ({
        report_type: "payment_history",
        ...row,
      })),
      ...(reports.unpaid_closed_contracts || []).map((row) => ({
        report_type: "unpaid_closed_contract",
        ...row,
      })),
      ...(reports.fleet_utilization || []).map((row) => ({
        report_type: "fleet_utilization",
        ...row,
      })),
    ];
  }, [reports]);

  const visibleRows = useMemo(() => {
    if (activeTab === "customers") return customers;
    if (activeTab === "enquiries") return enquiries;
    if (activeTab === "availability") return assets;
    if (activeTab === "quotations") return quotations;
    if (activeTab === "contracts") return contracts;
    if (activeTab === "operations") return workLogs;
    if (activeTab === "finance") return invoices;
    if (activeTab === "returns") return returns;
    if (activeTab === "reports") return reportExportRows;
    return [];
  }, [
    activeTab,
    customers,
    enquiries,
    assets,
    quotations,
    contracts,
    workLogs,
    invoices,
    returns,
    reportExportRows,
  ]);

  function openForm(mode, seed = {}) {
    const locationRequiredModes = new Set([
      "enquiry",
      "quotation",
      "contract",
      "assignment",
      "dispatch",
      "work_log",
      "invoice",
      "payment",
      "return",
    ]);

    if (locationRequiredModes.has(mode) && !selectedContextId) {
      notify(
        "error",
        "Choose an Equipment Hire location before creating an operational record."
      );
      return;
    }

    if (mode === "enquiry") {
      setEnquiryForm({ ...createEnquiryForm(), ...seed });
    } else if (mode === "quotation") {
      setQuotationForm({ ...createQuotationForm(), ...seed });
    } else if (mode === "contract") {
      setContractForm({ ...createContractForm(), ...seed });
    } else if (mode === "assignment") {
      setAssignmentForm({ ...createAssignmentForm(), ...seed });
    } else if (mode === "dispatch") {
      setDispatchForm({ ...createDispatchForm(), ...seed });
    } else if (mode === "work_log") {
      setWorkLogForm({ ...createWorkLogForm(), ...seed });
    } else if (mode === "payment") {
      setPaymentForm({ ...createPaymentForm(), ...seed });
    } else if (mode === "return") {
      setReturnForm({ ...createReturnForm(), ...seed });
    }
    setFormMode(mode);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderToolbarAction() {
    if (!canEdit || activeTab === "overview" || activeTab === "availability") return null;

    const actions = {
      customers: ["customer", "New customer"],
      enquiries: ["enquiry", "New enquiry"],
      quotations: ["quotation", "New quotation"],
      contracts: ["contract", "New contract"],
      operations: ["work_log", "New work log"],
      finance: ["invoice", "New invoice"],
      returns: ["return", "New return"],
    };

    const action = actions[activeTab];
    if (!action) return null;

    return (
      <button className="hire-btn hire-btn--primary" onClick={() => openForm(action[0])}>
        ＋ {action[1]}
      </button>
    );
  }

  if (loading) {
    return (
      <div className="hire-page">
        <div className="hire-loading">
          <span />
          <strong>Opening Equipment Hire workspace…</strong>
        </div>
      </div>
    );
  }

  return (
    <div className="hire-page">
      {message ? (
        <div className={`hire-message hire-message--${message.type}`}>
          <strong>{message.type === "success" ? "Saved" : "Attention"}</strong>
          <span>{message.text}</span>
          <button onClick={() => setMessage(null)}>×</button>
        </div>
      ) : null}

      {!automaticAccess && !contextLoading && hireLocationOptions.length === 0 ? (
        <div className="hire-message hire-message--error">
          <strong>No Hire location access</strong>
          <span>
            Ask an administrator to assign this account to an Equipment Hire office,
            yard or depot.
          </span>
        </div>
      ) : null}

      <section className="hire-hero">
        <div>
          <p>Chalin 03 Group Operations Platform</p>
          <h1>Equipment Hire Command Centre</h1>
          <span>
            Customers, quotations, contracts, shared Fleet assignments, daily hours,
            invoices, payments and returns in one workspace.
          </span>
        </div>
        <aside>
          <span className="hire-live-dot" />
          <div>
            <small>Active Hire location</small>
            <strong>
              {selectedContext
                ? `${selectedContext.code ? `${selectedContext.code} — ` : ""}${selectedContext.name}`
                : automaticAccess
                ? "All Hire locations"
                : "No location assigned"}
            </strong>
            <p>{canEdit ? "Operational access" : "Auditor read-only review"}</p>
          </div>
        </aside>
      </section>

      <nav className="hire-tabs" aria-label="Equipment Hire sections">
        {TABS.map(([code, title, icon]) => (
          <button
            key={code}
            className={activeTab === code ? "active" : ""}
            onClick={() => {
              setActiveTab(code);
              closeForm();
            }}
          >
            <span>{icon}</span>
            {title}
          </button>
        ))}
      </nav>

      <section className="hire-control-bar">
        <div className="hire-filter-group">
          {activeTab === "customers" ? (
            <label>
              Search
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Customer name, code or phone"
              />
            </label>
          ) : activeTab !== "overview" ? (
            <>
              <label>
                From
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(event) => setDateFrom(event.target.value)}
                />
              </label>
              <label>
                To
                <input
                  type="date"
                  value={dateTo}
                  onChange={(event) => setDateTo(event.target.value)}
                />
              </label>
            </>
          ) : (
            <div className="hire-control-note">
              <span>🚜</span>
              <p>
                One shared equipment register protects availability across Mining and Hire.
                {selectedContext ? ` Current base: ${selectedContext.name}.` : ""}
              </p>
            </div>
          )}
        </div>

        <div className="hire-control-actions">
          {activeTab === "customers" ? (
            <button className="hire-btn hire-btn--ghost" onClick={() => loadTab("customers")}>
              Search
            </button>
          ) : null}
          {activeTab !== "overview" ? (
            <button
              className="hire-btn hire-btn--ghost"
              onClick={() =>
                downloadCsv(
                  `chalin03-equipment-hire-${activeTab}-${localDate()}.csv`,
                  visibleRows
                )
              }
            >
              Export visible
            </button>
          ) : null}
          <button className="hire-btn hire-btn--ghost" onClick={() => reloadAll(activeTab)}>
            Refresh
          </button>
          {renderToolbarAction()}
        </div>
      </section>

      {formMode ? (
        <section className="hire-form-panel">
          {formMode === "customer" ? (
            <form onSubmit={submitCustomer}>
              <SectionHeader
                eyebrow="Customer register"
                title="Create hire customer"
                description="Create the customer account before enquiries, contracts and invoices."
              />
              <div className="hire-form-grid">
                <label>
                  Customer code
                  <input
                    value={customerForm.customer_code}
                    onChange={(event) =>
                      setCustomerForm({ ...customerForm, customer_code: event.target.value })
                    }
                    placeholder="Leave blank for automatic code"
                  />
                </label>
                <label>
                  Customer name *
                  <input
                    required
                    value={customerForm.customer_name}
                    onChange={(event) =>
                      setCustomerForm({ ...customerForm, customer_name: event.target.value })
                    }
                  />
                </label>
                <label>
                  Customer type
                  <select
                    value={customerForm.customer_type}
                    onChange={(event) =>
                      setCustomerForm({ ...customerForm, customer_type: event.target.value })
                    }
                  >
                    <option value="individual">Individual</option>
                    <option value="company">Company</option>
                    <option value="contractor">Contractor</option>
                    <option value="government">Government</option>
                  </select>
                </label>
                <label>
                  Phone
                  <input
                    value={customerForm.phone}
                    onChange={(event) =>
                      setCustomerForm({ ...customerForm, phone: event.target.value })
                    }
                  />
                </label>
                <label>
                  WhatsApp phone
                  <input
                    value={customerForm.whatsapp_phone}
                    onChange={(event) =>
                      setCustomerForm({ ...customerForm, whatsapp_phone: event.target.value })
                    }
                  />
                </label>
                <label>
                  Email
                  <input
                    type="email"
                    value={customerForm.email}
                    onChange={(event) =>
                      setCustomerForm({ ...customerForm, email: event.target.value })
                    }
                  />
                </label>
                <label>
                  Contact person
                  <input
                    value={customerForm.contact_person}
                    onChange={(event) =>
                      setCustomerForm({ ...customerForm, contact_person: event.target.value })
                    }
                  />
                </label>
                <label>
                  Payment terms (days)
                  <input
                    type="number"
                    min="0"
                    value={customerForm.payment_terms_days}
                    onChange={(event) =>
                      setCustomerForm({
                        ...customerForm,
                        payment_terms_days: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Credit limit
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={customerForm.credit_limit}
                    onChange={(event) =>
                      setCustomerForm({ ...customerForm, credit_limit: event.target.value })
                    }
                  />
                </label>
                <label className="hire-span-2">
                  Address
                  <input
                    value={customerForm.address}
                    onChange={(event) =>
                      setCustomerForm({ ...customerForm, address: event.target.value })
                    }
                  />
                </label>
                <label className="hire-span-2">
                  Risk / account notes
                  <textarea
                    value={customerForm.risk_notes}
                    onChange={(event) =>
                      setCustomerForm({ ...customerForm, risk_notes: event.target.value })
                    }
                  />
                </label>
              </div>
              <FormActions saving={saving} onCancel={closeForm} submitLabel="Save customer" />
            </form>
          ) : null}

          {formMode === "enquiry" ? (
            <form onSubmit={submitEnquiry}>
              <SectionHeader
                eyebrow="Customer demand"
                title={enquiryForm.id ? "Edit equipment enquiry" : "Record equipment enquiry"}
                description="Capture what the customer needs before preparing a quotation."
              />
              <div className="hire-form-grid">
                <label>
                  Customer *
                  <CustomerSelect
                    customers={customers}
                    value={enquiryForm.customer_id}
                    onChange={(event) =>
                      setEnquiryForm({ ...enquiryForm, customer_id: event.target.value })
                    }
                    required
                  />
                </label>
                <label>
                  Enquiry date *
                  <input
                    type="date"
                    required
                    value={enquiryForm.enquiry_date}
                    onChange={(event) =>
                      setEnquiryForm({ ...enquiryForm, enquiry_date: event.target.value })
                    }
                  />
                </label>
                <label>
                  Equipment type *
                  <input
                    required
                    value={enquiryForm.equipment_type}
                    onChange={(event) =>
                      setEnquiryForm({ ...enquiryForm, equipment_type: event.target.value })
                    }
                  />
                </label>
                <label>
                  Work location *
                  <input
                    required
                    value={enquiryForm.work_location}
                    onChange={(event) =>
                      setEnquiryForm({ ...enquiryForm, work_location: event.target.value })
                    }
                  />
                </label>
                <label>
                  Requested start
                  <input
                    type="date"
                    value={enquiryForm.requested_start_date}
                    onChange={(event) =>
                      setEnquiryForm({
                        ...enquiryForm,
                        requested_start_date: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Expected end
                  <input
                    type="date"
                    value={enquiryForm.expected_end_date}
                    onChange={(event) =>
                      setEnquiryForm({ ...enquiryForm, expected_end_date: event.target.value })
                    }
                  />
                </label>
                <label>
                  Preferred charging
                  <select
                    value={enquiryForm.preferred_charging_method}
                    onChange={(event) =>
                      setEnquiryForm({
                        ...enquiryForm,
                        preferred_charging_method: event.target.value,
                      })
                    }
                  >
                    <option value="hourly">Hourly</option>
                    <option value="daily">Daily</option>
                    <option value="shift">Per shift</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="fixed">Fixed project</option>
                  </select>
                </label>
                <label>
                  Estimated hours/days/quantity
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={enquiryForm.estimated_quantity}
                    onChange={(event) =>
                      setEnquiryForm({
                        ...enquiryForm,
                        estimated_quantity: event.target.value,
                      })
                    }
                  />
                </label>
                <label className="hire-span-2">
                  Notes
                  <textarea
                    value={enquiryForm.notes}
                    onChange={(event) =>
                      setEnquiryForm({ ...enquiryForm, notes: event.target.value })
                    }
                  />
                </label>
              </div>
              <FormActions
                saving={saving}
                onCancel={closeForm}
                submitLabel={enquiryForm.id ? "Update enquiry" : "Save enquiry"}
              />
            </form>
          ) : null}

          {formMode === "quotation" ? (
            <form onSubmit={submitQuotation}>
              <SectionHeader
                eyebrow="Commercial offer"
                title={quotationForm.id ? "Edit draft quotation" : "Prepare equipment quotation"}
                description="The backend calculates subtotal, tax and final quotation total."
              />
              <div className="hire-form-grid">
                <label>
                  Related enquiry
                  <select
                    value={quotationForm.enquiry_id}
                    onChange={(event) => {
                      const enquiry = enquiries.find(
                        (item) => Number(item.id) === Number(event.target.value)
                      );
                      setQuotationForm({
                        ...quotationForm,
                        enquiry_id: event.target.value,
                        customer_id: enquiry?.customer_id || quotationForm.customer_id,
                        requested_asset_type:
                          enquiry?.equipment_type || quotationForm.requested_asset_type,
                        work_location: enquiry?.work_location || quotationForm.work_location,
                        requested_start_date:
                          String(enquiry?.requested_start_date || "").slice(0, 10) ||
                          quotationForm.requested_start_date,
                        expected_end_date:
                          String(enquiry?.expected_end_date || "").slice(0, 10) ||
                          quotationForm.expected_end_date,
                        estimated_quantity:
                          enquiry?.estimated_quantity ?? quotationForm.estimated_quantity,
                      });
                    }}
                  >
                    <option value="">No linked enquiry</option>
                    {enquiries.map((enquiry) => (
                      <option key={enquiry.id} value={enquiry.id}>
                        {enquiry.enquiry_number} — {enquiry.customer_name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Customer *
                  <CustomerSelect
                    customers={customers}
                    value={quotationForm.customer_id}
                    onChange={(event) =>
                      setQuotationForm({ ...quotationForm, customer_id: event.target.value })
                    }
                    required
                  />
                </label>
                <label>
                  Requested equipment *
                  <input
                    required
                    value={quotationForm.requested_asset_type}
                    onChange={(event) =>
                      setQuotationForm({
                        ...quotationForm,
                        requested_asset_type: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Preferred machine
                  <select
                    value={quotationForm.preferred_asset_id}
                    onChange={(event) =>
                      setQuotationForm({
                        ...quotationForm,
                        preferred_asset_id: event.target.value,
                      })
                    }
                  >
                    <option value="">No specific machine</option>
                    {assets.map((asset) => (
                      <option key={asset.id} value={asset.id}>
                        {asset.asset_code} — {asset.asset_name} ({label(asset.availability_status)})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="hire-span-2">
                  Work location *
                  <input
                    required
                    value={quotationForm.work_location}
                    onChange={(event) =>
                      setQuotationForm({ ...quotationForm, work_location: event.target.value })
                    }
                  />
                </label>
                <label>
                  Start date
                  <input
                    type="date"
                    value={quotationForm.requested_start_date}
                    onChange={(event) =>
                      setQuotationForm({
                        ...quotationForm,
                        requested_start_date: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Expected end
                  <input
                    type="date"
                    value={quotationForm.expected_end_date}
                    onChange={(event) =>
                      setQuotationForm({
                        ...quotationForm,
                        expected_end_date: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Charging method *
                  <select
                    value={quotationForm.charging_method}
                    onChange={(event) =>
                      setQuotationForm({
                        ...quotationForm,
                        charging_method: event.target.value,
                      })
                    }
                  >
                    <option value="hourly">Hourly</option>
                    <option value="daily">Daily</option>
                    <option value="shift">Per shift</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="fixed">Fixed project</option>
                  </select>
                </label>
                <label>
                  Rate *
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={quotationForm.rate}
                    onChange={(event) =>
                      setQuotationForm({ ...quotationForm, rate: event.target.value })
                    }
                  />
                </label>
                <label>
                  Estimated quantity
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={quotationForm.estimated_quantity}
                    onChange={(event) =>
                      setQuotationForm({
                        ...quotationForm,
                        estimated_quantity: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Minimum quantity
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={quotationForm.minimum_quantity}
                    onChange={(event) =>
                      setQuotationForm({
                        ...quotationForm,
                        minimum_quantity: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Mobilization
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={quotationForm.mobilization_amount}
                    onChange={(event) =>
                      setQuotationForm({
                        ...quotationForm,
                        mobilization_amount: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Demobilization
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={quotationForm.demobilization_amount}
                    onChange={(event) =>
                      setQuotationForm({
                        ...quotationForm,
                        demobilization_amount: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Operator charge
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={quotationForm.operator_amount}
                    onChange={(event) =>
                      setQuotationForm({
                        ...quotationForm,
                        operator_amount: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Fuel responsibility
                  <select
                    value={quotationForm.fuel_responsibility}
                    onChange={(event) =>
                      setQuotationForm({
                        ...quotationForm,
                        fuel_responsibility: event.target.value,
                      })
                    }
                  >
                    <option value="customer">Customer</option>
                    <option value="owner">Chalin 03</option>
                    <option value="mixed">Mixed</option>
                  </select>
                </label>
                <label>
                  Discount
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={quotationForm.discount_amount}
                    onChange={(event) =>
                      setQuotationForm({
                        ...quotationForm,
                        discount_amount: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Tax rate %
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={quotationForm.tax_rate}
                    onChange={(event) =>
                      setQuotationForm({ ...quotationForm, tax_rate: event.target.value })
                    }
                  />
                </label>
                <label>
                  Valid until
                  <input
                    type="date"
                    value={quotationForm.validity_date}
                    onChange={(event) =>
                      setQuotationForm({
                        ...quotationForm,
                        validity_date: event.target.value,
                      })
                    }
                  />
                </label>
                <label className="hire-span-2">
                  Terms
                  <textarea
                    value={quotationForm.terms}
                    onChange={(event) =>
                      setQuotationForm({ ...quotationForm, terms: event.target.value })
                    }
                  />
                </label>
              </div>
              <FormActions
                saving={saving}
                onCancel={closeForm}
                submitLabel={quotationForm.id ? "Update quotation" : "Create quotation"}
              />
            </form>
          ) : null}

          {formMode === "contract" ? (
            <form onSubmit={submitContract}>
              <SectionHeader
                eyebrow="Hire agreement"
                title="Create hire contract"
                description="A contract can copy its main commercial terms from an approved quotation."
              />
              <div className="hire-form-grid">
                <label>
                  Source quotation
                  <select
                    value={contractForm.quotation_id}
                    onChange={(event) => {
                      const quote = quotations.find(
                        (item) => Number(item.id) === Number(event.target.value)
                      );
                      setContractForm({
                        ...contractForm,
                        quotation_id: event.target.value,
                        customer_id: quote?.customer_id || contractForm.customer_id,
                        work_location: quote?.work_location || contractForm.work_location,
                        start_date:
                          String(quote?.requested_start_date || "").slice(0, 10) ||
                          contractForm.start_date,
                        expected_end_date:
                          String(quote?.expected_end_date || "").slice(0, 10) ||
                          contractForm.expected_end_date,
                        charging_method: quote?.charging_method || contractForm.charging_method,
                        rate: quote?.rate ?? contractForm.rate,
                        minimum_quantity:
                          quote?.minimum_quantity ?? contractForm.minimum_quantity,
                        mobilization_amount:
                          quote?.mobilization_amount ?? contractForm.mobilization_amount,
                        demobilization_amount:
                          quote?.demobilization_amount ?? contractForm.demobilization_amount,
                        operator_amount:
                          quote?.operator_amount ?? contractForm.operator_amount,
                        fuel_responsibility:
                          quote?.fuel_responsibility || contractForm.fuel_responsibility,
                        terms: quote?.terms || contractForm.terms,
                      });
                    }}
                  >
                    <option value="">Create without quotation</option>
                    {quotations
                      .filter((quote) => ["approved", "accepted"].includes(quote.status))
                      .map((quote) => (
                        <option key={quote.id} value={quote.id}>
                          {quote.quotation_number} — {quote.customer_name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Customer *
                  <CustomerSelect
                    customers={customers}
                    value={contractForm.customer_id}
                    onChange={(event) =>
                      setContractForm({ ...contractForm, customer_id: event.target.value })
                    }
                    required
                  />
                </label>
                <label className="hire-span-2">
                  Work location *
                  <input
                    required
                    value={contractForm.work_location}
                    onChange={(event) =>
                      setContractForm({ ...contractForm, work_location: event.target.value })
                    }
                  />
                </label>
                <label>
                  Start date *
                  <input
                    type="date"
                    required
                    value={contractForm.start_date}
                    onChange={(event) =>
                      setContractForm({ ...contractForm, start_date: event.target.value })
                    }
                  />
                </label>
                <label>
                  Expected end
                  <input
                    type="date"
                    value={contractForm.expected_end_date}
                    onChange={(event) =>
                      setContractForm({
                        ...contractForm,
                        expected_end_date: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Charging method
                  <select
                    value={contractForm.charging_method}
                    onChange={(event) =>
                      setContractForm({
                        ...contractForm,
                        charging_method: event.target.value,
                      })
                    }
                  >
                    <option value="hourly">Hourly</option>
                    <option value="daily">Daily</option>
                    <option value="shift">Per shift</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="fixed">Fixed project</option>
                  </select>
                </label>
                <label>
                  Rate *
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={contractForm.rate}
                    onChange={(event) =>
                      setContractForm({ ...contractForm, rate: event.target.value })
                    }
                  />
                </label>
                <label>
                  Minimum quantity
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={contractForm.minimum_quantity}
                    onChange={(event) =>
                      setContractForm({
                        ...contractForm,
                        minimum_quantity: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Deposit required
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={contractForm.deposit_required}
                    onChange={(event) =>
                      setContractForm({
                        ...contractForm,
                        deposit_required: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Mobilization
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={contractForm.mobilization_amount}
                    onChange={(event) =>
                      setContractForm({
                        ...contractForm,
                        mobilization_amount: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Demobilization
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={contractForm.demobilization_amount}
                    onChange={(event) =>
                      setContractForm({
                        ...contractForm,
                        demobilization_amount: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Operator charge
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={contractForm.operator_amount}
                    onChange={(event) =>
                      setContractForm({
                        ...contractForm,
                        operator_amount: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Fuel responsibility
                  <select
                    value={contractForm.fuel_responsibility}
                    onChange={(event) =>
                      setContractForm({
                        ...contractForm,
                        fuel_responsibility: event.target.value,
                      })
                    }
                  >
                    <option value="customer">Customer</option>
                    <option value="owner">Chalin 03</option>
                    <option value="mixed">Mixed</option>
                  </select>
                </label>
                <label className="hire-span-2">
                  Terms
                  <textarea
                    value={contractForm.terms}
                    onChange={(event) =>
                      setContractForm({ ...contractForm, terms: event.target.value })
                    }
                  />
                </label>
              </div>
              <FormActions saving={saving} onCancel={closeForm} submitLabel="Create contract" />
            </form>
          ) : null}

          {formMode === "assignment" ? (
            <form onSubmit={submitAssignment}>
              <SectionHeader
                eyebrow="Shared Fleet"
                title="Assign equipment to contract"
                description="Only available or idle Fleet assets can be assigned."
              />
              <div className="hire-form-grid">
                <label>
                  Contract *
                  <ContractSelect
                    contracts={contracts}
                    value={assignmentForm.contract_id}
                    onChange={(event) =>
                      setAssignmentForm({
                        ...assignmentForm,
                        contract_id: event.target.value,
                      })
                    }
                    activeOnly
                    required
                  />
                </label>
                <label>
                  Available equipment *
                  <select
                    required
                    value={assignmentForm.asset_id}
                    onChange={(event) => {
                      const asset = assets.find(
                        (item) => Number(item.id) === Number(event.target.value)
                      );
                      setAssignmentForm({
                        ...assignmentForm,
                        asset_id: event.target.value,
                        opening_meter: asset?.current_meter ?? "",
                      });
                    }}
                  >
                    <option value="">Choose available machine</option>
                    {assets
                      .filter((asset) => asset.availability_status === "available")
                      .map((asset) => (
                        <option key={asset.id} value={asset.id}>
                          {asset.asset_code} — {asset.asset_name} — meter {asset.current_meter}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Operator
                  <input
                    value={assignmentForm.operator_name}
                    onChange={(event) =>
                      setAssignmentForm({
                        ...assignmentForm,
                        operator_name: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Opening meter
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={assignmentForm.opening_meter}
                    onChange={(event) =>
                      setAssignmentForm({
                        ...assignmentForm,
                        opening_meter: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Assigned from *
                  <input
                    type="datetime-local"
                    required
                    value={assignmentForm.assigned_from}
                    onChange={(event) =>
                      setAssignmentForm({
                        ...assignmentForm,
                        assigned_from: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Expected return
                  <input
                    type="datetime-local"
                    value={assignmentForm.assigned_to}
                    onChange={(event) =>
                      setAssignmentForm({
                        ...assignmentForm,
                        assigned_to: event.target.value,
                      })
                    }
                  />
                </label>
                <label className="hire-span-2">
                  Notes
                  <textarea
                    value={assignmentForm.notes}
                    onChange={(event) =>
                      setAssignmentForm({ ...assignmentForm, notes: event.target.value })
                    }
                  />
                </label>
              </div>
              <FormActions saving={saving} onCancel={closeForm} submitLabel="Assign equipment" />
            </form>
          ) : null}

          {formMode === "dispatch" ? (
            <form onSubmit={submitDispatch}>
              <SectionHeader
                eyebrow="Mobilization"
                title="Dispatch assigned equipment"
                description="Records opening condition and moves Fleet status to working."
              />
              <div className="hire-form-grid">
                <label>
                  Assigned equipment *
                  <AssignmentSelect
                    assignments={assignments.filter((item) => item.status === "assigned")}
                    value={dispatchForm.contract_asset_id}
                    onChange={(event) => {
                      const assignment = assignments.find(
                        (item) => Number(item.id) === Number(event.target.value)
                      );
                      setDispatchForm({
                        ...dispatchForm,
                        contract_asset_id: event.target.value,
                        destination: assignment?.work_location || dispatchForm.destination,
                        opening_meter: assignment?.current_meter ?? dispatchForm.opening_meter,
                      });
                    }}
                    required
                  />
                </label>
                <label>
                  Dispatch date/time *
                  <input
                    type="datetime-local"
                    required
                    value={dispatchForm.dispatch_datetime}
                    onChange={(event) =>
                      setDispatchForm({
                        ...dispatchForm,
                        dispatch_datetime: event.target.value,
                      })
                    }
                  />
                </label>
                <label className="hire-span-2">
                  Destination *
                  <input
                    required
                    value={dispatchForm.destination}
                    onChange={(event) =>
                      setDispatchForm({ ...dispatchForm, destination: event.target.value })
                    }
                  />
                </label>
                <label>
                  Opening meter *
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={dispatchForm.opening_meter}
                    onChange={(event) =>
                      setDispatchForm({ ...dispatchForm, opening_meter: event.target.value })
                    }
                  />
                </label>
                <label>
                  Fuel level %
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={dispatchForm.fuel_level_percent}
                    onChange={(event) =>
                      setDispatchForm({
                        ...dispatchForm,
                        fuel_level_percent: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Condition
                  <select
                    value={dispatchForm.condition_status}
                    onChange={(event) =>
                      setDispatchForm({
                        ...dispatchForm,
                        condition_status: event.target.value,
                      })
                    }
                  >
                    <option value="excellent">Excellent</option>
                    <option value="good">Good</option>
                    <option value="fair">Fair</option>
                    <option value="poor">Poor</option>
                    <option value="damaged">Damaged</option>
                  </select>
                </label>
                <label>
                  Receiving person
                  <input
                    value={dispatchForm.receiving_person}
                    onChange={(event) =>
                      setDispatchForm({
                        ...dispatchForm,
                        receiving_person: event.target.value,
                      })
                    }
                  />
                </label>
                <label className="hire-span-2">
                  Attachments / tools
                  <textarea
                    value={dispatchForm.attachments_tools}
                    onChange={(event) =>
                      setDispatchForm({
                        ...dispatchForm,
                        attachments_tools: event.target.value,
                      })
                    }
                  />
                </label>
                <label className="hire-span-2">
                  Transport details
                  <textarea
                    value={dispatchForm.transport_details}
                    onChange={(event) =>
                      setDispatchForm({
                        ...dispatchForm,
                        transport_details: event.target.value,
                      })
                    }
                  />
                </label>
              </div>
              <FormActions saving={saving} onCancel={closeForm} submitLabel="Save dispatch" />
            </form>
          ) : null}

          {formMode === "work_log" ? (
            <form onSubmit={submitWorkLog}>
              <SectionHeader
                eyebrow="Daily job card"
                title="Record machine work log"
                description="The ending meter is added to the Shared Fleet ledger."
              />
              <div className="hire-form-grid">
                <label className="hire-span-2">
                  Active equipment assignment *
                  <AssignmentSelect
                    assignments={assignments.filter((item) =>
                      ["dispatched", "active"].includes(item.status)
                    )}
                    value={workLogForm.contract_asset_id}
                    onChange={(event) => {
                      const assignment = assignments.find(
                        (item) => Number(item.id) === Number(event.target.value)
                      );
                      setWorkLogForm({
                        ...workLogForm,
                        contract_asset_id: event.target.value,
                        start_meter: assignment?.current_meter ?? "",
                      });
                    }}
                    openOnly
                    required
                  />
                </label>
                <label>
                  Work date *
                  <input
                    type="date"
                    required
                    value={workLogForm.work_date}
                    onChange={(event) =>
                      setWorkLogForm({ ...workLogForm, work_date: event.target.value })
                    }
                  />
                </label>
                <label>
                  Customer representative
                  <input
                    value={workLogForm.customer_representative}
                    onChange={(event) =>
                      setWorkLogForm({
                        ...workLogForm,
                        customer_representative: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Start meter *
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={workLogForm.start_meter}
                    onChange={(event) =>
                      setWorkLogForm({ ...workLogForm, start_meter: event.target.value })
                    }
                  />
                </label>
                <label>
                  End meter *
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={workLogForm.end_meter}
                    onChange={(event) =>
                      setWorkLogForm({ ...workLogForm, end_meter: event.target.value })
                    }
                  />
                </label>
                <label>
                  Billable hours
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={workLogForm.billable_hours}
                    onChange={(event) =>
                      setWorkLogForm({
                        ...workLogForm,
                        billable_hours: event.target.value,
                      })
                    }
                    placeholder="Blank = meter difference"
                  />
                </label>
                <label>
                  Idle hours
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={workLogForm.idle_hours}
                    onChange={(event) =>
                      setWorkLogForm({ ...workLogForm, idle_hours: event.target.value })
                    }
                  />
                </label>
                <label>
                  Breakdown hours
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={workLogForm.breakdown_hours}
                    onChange={(event) =>
                      setWorkLogForm({
                        ...workLogForm,
                        breakdown_hours: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Fuel litres
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={workLogForm.fuel_litres}
                    onChange={(event) =>
                      setWorkLogForm({ ...workLogForm, fuel_litres: event.target.value })
                    }
                  />
                </label>
                <label className="hire-span-2">
                  Work description
                  <textarea
                    value={workLogForm.work_description}
                    onChange={(event) =>
                      setWorkLogForm({
                        ...workLogForm,
                        work_description: event.target.value,
                      })
                    }
                  />
                </label>
              </div>
              <FormActions saving={saving} onCancel={closeForm} submitLabel="Save work log" />
            </form>
          ) : null}

          {formMode === "invoice" ? (
            <form onSubmit={submitInvoice}>
              <SectionHeader
                eyebrow="Customer billing"
                title="Create hire invoice"
                description="Approved work logs are totaled automatically when billable quantity is left blank."
              />
              <div className="hire-form-grid">
                <label className="hire-span-2">
                  Contract *
                  <ContractSelect
                    contracts={contracts}
                    value={invoiceForm.contract_id}
                    onChange={(event) =>
                      setInvoiceForm({
                        ...invoiceForm,
                        contract_id: event.target.value,
                        work_log_ids: [],
                        billable_quantity: "",
                      })
                    }
                    required
                  />
                </label>
                <label>
                  Invoice date *
                  <input
                    type="date"
                    required
                    value={invoiceForm.invoice_date}
                    onChange={(event) =>
                      setInvoiceForm({ ...invoiceForm, invoice_date: event.target.value })
                    }
                  />
                </label>
                <label>
                  Due date
                  <input
                    type="date"
                    value={invoiceForm.due_date}
                    onChange={(event) =>
                      setInvoiceForm({ ...invoiceForm, due_date: event.target.value })
                    }
                  />
                </label>
                <label>
                  Period start
                  <input
                    type="date"
                    value={invoiceForm.period_start}
                    onChange={(event) =>
                      setInvoiceForm({ ...invoiceForm, period_start: event.target.value })
                    }
                  />
                </label>
                <label>
                  Period end
                  <input
                    type="date"
                    value={invoiceForm.period_end}
                    onChange={(event) =>
                      setInvoiceForm({ ...invoiceForm, period_end: event.target.value })
                    }
                  />
                </label>
                <label>
                  Manual billable quantity
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={invoiceForm.billable_quantity}
                    onChange={(event) =>
                      setInvoiceForm({
                        ...invoiceForm,
                        billable_quantity: event.target.value,
                      })
                    }
                    placeholder="Blank = approved work logs"
                  />
                </label>
                <div className="hire-span-2 hire-checkbox-grid">
                  {billableWorkLogs
                    .filter((log) =>
                      invoiceForm.contract_id
                        ? Number(log.contract_id) === Number(invoiceForm.contract_id)
                        : false
                    )
                    .map((log) => (
                      <label key={log.id}>
                        <input
                          type="checkbox"
                          checked={invoiceForm.work_log_ids.includes(log.id)}
                          onChange={(event) => {
                            const current = invoiceForm.work_log_ids || [];
                            setInvoiceForm({
                              ...invoiceForm,
                              work_log_ids: event.target.checked
                                ? [...current, log.id]
                                : current.filter((id) => id !== log.id),
                              billable_quantity: "",
                            });
                          }}
                        />
                        {formatDate(log.work_date)} · {log.asset_code} · {formatNumber(log.billable_hours)} hrs
                      </label>
                    ))}
                  {invoiceForm.contract_id &&
                  !billableWorkLogs.some(
                    (log) => Number(log.contract_id) === Number(invoiceForm.contract_id)
                  ) ? (
                    <span>No approved uninvoiced work logs for this contract.</span>
                  ) : null}
                </div>
                <label>
                  Other charges
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={invoiceForm.other_amount}
                    onChange={(event) =>
                      setInvoiceForm({ ...invoiceForm, other_amount: event.target.value })
                    }
                  />
                </label>
                <label>
                  Discount
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={invoiceForm.discount_amount}
                    onChange={(event) =>
                      setInvoiceForm({
                        ...invoiceForm,
                        discount_amount: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Tax rate %
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={invoiceForm.tax_rate}
                    onChange={(event) =>
                      setInvoiceForm({ ...invoiceForm, tax_rate: event.target.value })
                    }
                  />
                </label>
                <div className="hire-span-2 hire-checkbox-grid">
                  <label>
                    <input
                      type="checkbox"
                      checked={invoiceForm.include_mobilization}
                      onChange={(event) =>
                        setInvoiceForm({
                          ...invoiceForm,
                          include_mobilization: event.target.checked,
                        })
                      }
                    />
                    Include mobilization
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={invoiceForm.include_demobilization}
                      onChange={(event) =>
                        setInvoiceForm({
                          ...invoiceForm,
                          include_demobilization: event.target.checked,
                        })
                      }
                    />
                    Include demobilization
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={invoiceForm.include_operator}
                      onChange={(event) =>
                        setInvoiceForm({
                          ...invoiceForm,
                          include_operator: event.target.checked,
                        })
                      }
                    />
                    Include operator charge
                  </label>
                </div>
                <label className="hire-span-2">
                  Notes
                  <textarea
                    value={invoiceForm.notes}
                    onChange={(event) =>
                      setInvoiceForm({ ...invoiceForm, notes: event.target.value })
                    }
                  />
                </label>
              </div>
              <FormActions saving={saving} onCancel={closeForm} submitLabel="Create invoice" />
            </form>
          ) : null}

          {formMode === "payment" ? (
            <form onSubmit={submitPayment}>
              <SectionHeader
                eyebrow="Money received"
                title="Record hire payment"
                description="Invoice payments update balance automatically. Deposits update the contract."
              />
              <div className="hire-form-grid">
                <label>
                  Payment category
                  <select
                    value={paymentForm.payment_category}
                    onChange={(event) =>
                      setPaymentForm({
                        ...paymentForm,
                        payment_category: event.target.value,
                      })
                    }
                  >
                    <option value="invoice">Invoice payment</option>
                    <option value="deposit">Contract deposit</option>
                    <option value="other">Other payment</option>
                  </select>
                </label>
                <label>
                  Invoice
                  <select
                    value={paymentForm.invoice_id}
                    onChange={(event) => {
                      const invoice = invoices.find(
                        (item) => Number(item.id) === Number(event.target.value)
                      );
                      setPaymentForm({
                        ...paymentForm,
                        invoice_id: event.target.value,
                        contract_id: invoice?.contract_id || paymentForm.contract_id,
                        amount:
                          invoice && Number(invoice.balance) > 0
                            ? String(invoice.balance)
                            : paymentForm.amount,
                      });
                    }}
                  >
                    <option value="">No invoice selected</option>
                    {invoices
                      .filter((invoice) => Number(invoice.balance) > 0 && invoice.status !== "void")
                      .map((invoice) => (
                        <option key={invoice.id} value={invoice.id}>
                          {invoice.invoice_number} — {invoice.customer_name} — {formatMoney(invoice.balance)}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="hire-span-2">
                  Contract *
                  <ContractSelect
                    contracts={contracts}
                    value={paymentForm.contract_id}
                    onChange={(event) =>
                      setPaymentForm({ ...paymentForm, contract_id: event.target.value })
                    }
                    required
                  />
                </label>
                <label>
                  Payment date/time *
                  <input
                    type="datetime-local"
                    required
                    value={paymentForm.payment_date}
                    onChange={(event) =>
                      setPaymentForm({ ...paymentForm, payment_date: event.target.value })
                    }
                  />
                </label>
                <label>
                  Amount *
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    value={paymentForm.amount}
                    onChange={(event) =>
                      setPaymentForm({ ...paymentForm, amount: event.target.value })
                    }
                  />
                </label>
                <label>
                  Payment method
                  <select
                    value={paymentForm.payment_method}
                    onChange={(event) =>
                      setPaymentForm({
                        ...paymentForm,
                        payment_method: event.target.value,
                      })
                    }
                  >
                    <option value="cash">Cash</option>
                    <option value="momo">MoMo</option>
                    <option value="bank">Bank</option>
                    <option value="cheque">Cheque</option>
                    <option value="other">Other</option>
                  </select>
                </label>
                <label>
                  Reference
                  <input
                    value={paymentForm.reference_number}
                    onChange={(event) =>
                      setPaymentForm({
                        ...paymentForm,
                        reference_number: event.target.value,
                      })
                    }
                  />
                </label>
                <label className="hire-span-2">
                  Notes
                  <textarea
                    value={paymentForm.notes}
                    onChange={(event) =>
                      setPaymentForm({ ...paymentForm, notes: event.target.value })
                    }
                  />
                </label>
              </div>
              <FormActions saving={saving} onCancel={closeForm} submitLabel="Record payment" />
            </form>
          ) : null}

          {formMode === "return" ? (
            <form onSubmit={submitReturn}>
              <SectionHeader
                eyebrow="End of assignment"
                title="Inspect and return equipment"
                description="Completes the assignment and releases the machine back to Shared Fleet."
              />
              <div className="hire-form-grid">
                <label className="hire-span-2">
                  Active equipment assignment *
                  <AssignmentSelect
                    assignments={assignments}
                    value={returnForm.contract_asset_id}
                    onChange={(event) => {
                      const assignment = assignments.find(
                        (item) => Number(item.id) === Number(event.target.value)
                      );
                      setReturnForm({
                        ...returnForm,
                        contract_asset_id: event.target.value,
                        closing_meter: assignment?.current_meter ?? "",
                      });
                    }}
                    openOnly
                    required
                  />
                </label>
                <label>
                  Return date/time *
                  <input
                    type="datetime-local"
                    required
                    value={returnForm.return_datetime}
                    onChange={(event) =>
                      setReturnForm({
                        ...returnForm,
                        return_datetime: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Closing meter *
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={returnForm.closing_meter}
                    onChange={(event) =>
                      setReturnForm({ ...returnForm, closing_meter: event.target.value })
                    }
                  />
                </label>
                <label>
                  Fuel level %
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={returnForm.fuel_level_percent}
                    onChange={(event) =>
                      setReturnForm({
                        ...returnForm,
                        fuel_level_percent: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Condition
                  <select
                    value={returnForm.condition_status}
                    onChange={(event) =>
                      setReturnForm({
                        ...returnForm,
                        condition_status: event.target.value,
                      })
                    }
                  >
                    <option value="excellent">Excellent</option>
                    <option value="good">Good</option>
                    <option value="fair">Fair</option>
                    <option value="poor">Poor</option>
                    <option value="damaged">Damaged</option>
                  </select>
                </label>
                <label>
                  Estimated damage cost
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={returnForm.estimated_damage_amount}
                    onChange={(event) =>
                      setReturnForm({
                        ...returnForm,
                        estimated_damage_amount: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Customer representative
                  <input
                    value={returnForm.customer_representative}
                    onChange={(event) =>
                      setReturnForm({
                        ...returnForm,
                        customer_representative: event.target.value,
                      })
                    }
                  />
                </label>
                <label className="hire-span-2">
                  Damage details
                  <textarea
                    value={returnForm.damage_details}
                    onChange={(event) =>
                      setReturnForm({
                        ...returnForm,
                        damage_details: event.target.value,
                      })
                    }
                  />
                </label>
                <label className="hire-span-2">
                  Missing items
                  <textarea
                    value={returnForm.missing_items}
                    onChange={(event) =>
                      setReturnForm({
                        ...returnForm,
                        missing_items: event.target.value,
                      })
                    }
                  />
                </label>
              </div>
              <FormActions saving={saving} onCancel={closeForm} submitLabel="Complete return" />
            </form>
          ) : null}
        </section>
      ) : null}

      {recordsLoading ? <div className="hire-inline-loading">Refreshing records…</div> : null}

      {activeTab === "overview" ? (
        <Overview dashboard={dashboard} onNavigate={setActiveTab} />
      ) : null}

      {activeTab === "customers" ? (
        <CustomersTable customers={customers} />
      ) : null}

      {activeTab === "enquiries" ? (
        <EnquiriesTable
          enquiries={enquiries}
          canEdit={canEdit}
          onEdit={editEnquiry}
          onConvert={convertEnquiryToQuotation}
          onStatus={(id, status) =>
            updateStatus(
              `/equipment-hire/enquiries/${id}/status`,
              status,
              `Change this enquiry to ${label(status)}?`
            )
          }
        />
      ) : null}

      {activeTab === "availability" ? <AvailabilityGrid assets={assets} /> : null}

      {activeTab === "quotations" ? (
        <QuotationsTable
          quotations={quotations}
          canEdit={canEdit}
          onEdit={editQuotation}
          onConvert={convertQuotationToContract}
          onStatus={(id, status) =>
            updateStatus(
              `/equipment-hire/quotations/${id}/status`,
              status,
              `Change this quotation to ${label(status)}?`
            )
          }
        />
      ) : null}

      {activeTab === "contracts" ? (
        <ContractsTable
          contracts={contracts}
          canEdit={canEdit}
          onAssign={(contract) =>
            openForm("assignment", { contract_id: String(contract.id) })
          }
          onStatus={(id, status) =>
            updateStatus(
              `/equipment-hire/contracts/${id}/status`,
              status,
              `Change this contract to ${label(status)}?`
            )
          }
        />
      ) : null}

      {activeTab === "operations" ? (
        <OperationsArea
          assignments={assignments}
          dispatches={dispatches}
          workLogs={workLogs}
          canEdit={canEdit}
          onAssign={() => openForm("assignment")}
          onDispatch={(assignment) =>
            openForm("dispatch", {
              contract_asset_id: String(assignment.id),
              destination: assignment.work_location || "",
              opening_meter: String(assignment.current_meter || ""),
            })
          }
          onWorkLog={(assignment) =>
            openForm("work_log", {
              contract_asset_id: String(assignment.id),
              start_meter: String(assignment.current_meter || ""),
            })
          }
          onRemoveAssignment={removeAssignment}
          onApprove={(id) =>
            updateStatus(
              `/equipment-hire/work-logs/${id}/approve`,
              "approved",
              "Approve this work log?"
            )
          }
        />
      ) : null}

      {activeTab === "finance" ? (
        <FinanceArea
          invoices={invoices}
          payments={payments}
          financeSummary={financeSummary}
          canEdit={canEdit}
          onInvoice={() => setFormMode("invoice")}
          onVoid={voidInvoice}
          onPayment={(invoice = null) =>
            openForm("payment", invoice
              ? {
                  invoice_id: String(invoice.id),
                  contract_id: String(invoice.contract_id),
                  amount: String(invoice.balance || ""),
                  payment_category: "invoice",
                }
              : {})
          }
        />
      ) : null}

      {activeTab === "returns" ? (
        <ReturnsTable
          returns={returns}
          assignments={assignments}
          contracts={contracts}
          canEdit={canEdit}
          onCloseContract={closeContract}
          onReturn={(assignment) =>
            openForm("return", {
              contract_asset_id: String(assignment.id),
              closing_meter: String(assignment.current_meter || ""),
            })
          }
        />
      ) : null}

      {activeTab === "reports" ? <ReportsArea reports={reports} /> : null}

    </div>
  );
}

function Overview({ dashboard, onNavigate }) {
  const kpis = dashboard?.kpis || {};
  const fleet = dashboard?.fleet || {};
  const contracts = dashboard?.contracts || {};
  const work = dashboard?.work || {};
  const invoices = dashboard?.invoices || {};
  const customers = dashboard?.customers || {};
  const aging = dashboard?.aging || {};

  const cards = [
    ["Active enquiries", kpis.active_enquiries, "Open or quoted customer requests", "enquiries", "📨"],
    ["Draft quotations", kpis.draft_quotations, "Pricing still being prepared", "quotations", "📝"],
    ["Approved quotations", kpis.approved_quotations, "Approved or accepted offers", "quotations", "✅"],
    ["Active contracts", kpis.active_contracts ?? contracts.active_contracts, "Confirmed, mobilizing or active", "contracts", "🤝"],
    ["Equipment on hire", kpis.equipment_on_hire ?? fleet.assets_on_hire, "Assigned, dispatched or active", "operations", "🚜"],
    ["Available equipment", kpis.available_assets ?? fleet.available_assets, "Shared Fleet ready for work", "availability", "🟢"],
    ["Maintenance", kpis.assets_in_maintenance ?? fleet.maintenance_assets, "Fleet assets unavailable", "availability", "🛠️"],
    ["Approved unbilled logs", kpis.approved_uninvoiced_work_logs ?? work.approved_uninvoiced_work_logs, "Ready for invoicing", "finance", "📋"],
    ["Outstanding invoices", kpis.outstanding_invoices ?? invoices.outstanding_invoices, "Invoices with open balances", "reports", "💳"],
    ["Overdue invoices", kpis.overdue_invoices ?? invoices.overdue_invoices, "Past due and not settled", "reports", "⚠️"],
    ["Outstanding balance", formatMoney(kpis.total_outstanding_balance ?? invoices.outstanding_amount), "Customer invoice balances", "reports", "💰"],
    ["Current aging", formatMoney(aging.current?.balance), "Not yet due", "reports", "📅"],
    ["1-30 days", formatMoney(aging["1_30"]?.balance), "Recently overdue", "reports", "1"],
    ["31-60 days", formatMoney(aging["31_60"]?.balance), "Collection follow-up", "reports", "2"],
    ["61-90 days", formatMoney(aging["61_90"]?.balance), "Management attention", "reports", "3"],
    ["Over 90 days", formatMoney(aging.over_90?.balance), "Priority collection", "reports", "90"],
    ["Returns due", kpis.returns_due_or_incomplete, "Ended hire still out", "returns", "🔍"],
    ["Ready for closure", kpis.contracts_ready_for_closure, "Returned and ready to close", "returns", "🔒"],
    ["Paid revenue", formatMoney(invoices.paid_amount), "Recorded invoice payments", "finance", "💵"],
    ["Hire customers", customers.active_customers, "Active customer accounts", "customers", "👥"],
  ];

  return (
    <div className="hire-overview">
      <div className="hire-metric-grid">
        {cards.map(([title, value, description, tab, icon]) => (
          <button key={title} className="hire-metric-card" onClick={() => onNavigate(tab)}>
            <span>{icon}</span>
            <div>
              <small>{title}</small>
              <strong>{value ?? 0}</strong>
              <p>{description}</p>
            </div>
          </button>
        ))}
      </div>

      <div className="hire-overview-grid">
        <section className="hire-card">
          <SectionHeader
            eyebrow="Latest agreements"
            title="Recent contracts"
            description="New and active customer hire work."
          />
          {(dashboard?.recent_contracts || []).length ? (
            <div className="hire-list">
              {dashboard.recent_contracts.map((contract) => (
                <article key={contract.id}>
                  <span>🤝</span>
                  <div>
                    <strong>{contract.contract_number}</strong>
                    <p>{contract.customer_name} · {contract.work_location}</p>
                    <small>
                      {formatDate(contract.start_date)} → {formatDate(contract.expected_end_date)}
                    </small>
                  </div>
                  <StatusPill value={contract.status} />
                </article>
              ))}
            </div>
          ) : (
            <EmptyState title="No hire contracts yet" description="Create a quotation and convert it into the first contract." />
          )}
        </section>

        <section className="hire-card">
          <SectionHeader
            eyebrow="Collections"
            title="Recent invoices"
            description="Invoice totals, payments and balances."
          />
          {(dashboard?.recent_invoices || []).length ? (
            <div className="hire-list">
              {dashboard.recent_invoices.map((invoice) => (
                <article key={invoice.id}>
                  <span>🧾</span>
                  <div>
                    <strong>{invoice.invoice_number}</strong>
                    <p>{invoice.customer_name} · {invoice.contract_number}</p>
                    <small>Balance {formatMoney(invoice.balance)}</small>
                  </div>
                  <StatusPill value={invoice.status} />
                </article>
              ))}
            </div>
          ) : (
            <EmptyState title="No invoices yet" description="Invoices will appear after contracts and approved work logs." />
          )}
        </section>
      </div>

      <section className="hire-card">
        <SectionHeader
          eyebrow="Forward planning"
          title="Contracts ending within 14 days"
          description="Prepare return inspections, final invoices and demobilization."
        />
        {(dashboard?.ending_contracts || []).length ? (
          <div className="hire-ending-grid">
            {dashboard.ending_contracts.map((contract) => (
              <article key={contract.id}>
                <strong>{contract.contract_number}</strong>
                <p>{contract.customer_name}</p>
                <span>{contract.work_location}</span>
                <small>Expected end: {formatDate(contract.expected_end_date)}</small>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState icon="✅" title="No contracts ending soon" description="There are no active hire contracts ending within the next 14 days." />
        )}
      </section>
    </div>
  );
}

function CustomersTable({ customers }) {
  return (
    <section className="hire-card">
      <SectionHeader
        eyebrow="Account register"
        title="Equipment Hire customers"
        description={`${customers.length} visible customer account${customers.length === 1 ? "" : "s"}.`}
      />
      {!customers.length ? (
        <EmptyState title="No hire customers" description="Create the first customer to begin enquiries and quotations." />
      ) : (
        <div className="hire-table-wrap">
          <table className="hire-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Contact</th>
                <th>Terms</th>
                <th>Credit limit</th>
                <th>Outstanding</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((customer) => (
                <tr key={customer.id}>
                  <td data-label="Customer">
                    <strong>{customer.customer_name}</strong>
                    <small>{customer.customer_code} · {label(customer.customer_type)}</small>
                  </td>
                  <td data-label="Contact">
                    {customer.phone || "—"}
                    <small>{customer.contact_person || customer.email || "No contact person"}</small>
                  </td>
                  <td data-label="Terms">{customer.payment_terms_days || 0} days</td>
                  <td data-label="Credit limit">{formatMoney(customer.credit_limit)}</td>
                  <td data-label="Outstanding">{formatMoney(customer.outstanding_balance)}</td>
                  <td data-label="Status">
                    <StatusPill value={Number(customer.is_active) ? "active" : "inactive"} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function EnquiriesTable({ enquiries, canEdit, onEdit, onConvert, onStatus }) {
  return (
    <section className="hire-card">
      <SectionHeader
        eyebrow="Sales pipeline"
        title="Equipment enquiries"
        description="Customer requests awaiting quotation, decision or closure."
      />
      {!enquiries.length ? (
        <EmptyState title="No equipment enquiries" description="Record a customer request to begin the hire workflow." />
      ) : (
        <div className="hire-table-wrap">
          <table className="hire-table">
            <thead>
              <tr>
                <th>Enquiry</th>
                <th>Customer</th>
                <th>Equipment / location</th>
                <th>Dates</th>
                <th>Status</th>
                {canEdit ? <th>Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {enquiries.map((enquiry) => (
                <tr key={enquiry.id}>
                  <td data-label="Enquiry">
                    <strong>{enquiry.enquiry_number}</strong>
                    <small>{formatDate(enquiry.enquiry_date)}</small>
                  </td>
                  <td data-label="Customer">{enquiry.customer_name}</td>
                  <td data-label="Equipment / location">
                    {enquiry.equipment_type}
                    <small>{enquiry.work_location}</small>
                  </td>
                  <td data-label="Dates">
                    {formatDate(enquiry.requested_start_date)}
                    <small>to {formatDate(enquiry.expected_end_date)}</small>
                  </td>
                  <td data-label="Status"><StatusPill value={enquiry.status} /></td>
                  {canEdit ? (
                    <td data-label="Actions">
                      <div className="hire-row-actions">
                        {enquiry.status === "open" ? (
                          <>
                            <button onClick={() => onEdit(enquiry)}>Edit</button>
                            <button onClick={() => onConvert(enquiry)}>Create draft quote</button>
                            <button onClick={() => onStatus(enquiry.id, "lost")}>Mark lost</button>
                          </>
                        ) : null}
                        {!["won", "cancelled"].includes(enquiry.status) ? (
                          <button onClick={() => onStatus(enquiry.id, "cancelled")}>Cancel</button>
                        ) : null}
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function AvailabilityGrid({ assets }) {
  return (
    <section className="hire-card">
      <SectionHeader
        eyebrow="Shared Fleet check"
        title="Equipment availability"
        description="Mining, maintenance and active hire assignments are considered."
      />
      {!assets.length ? (
        <EmptyState title="No Fleet assets" description="Create equipment in Fleet & Equipment first." />
      ) : (
        <div className="hire-asset-grid">
          {assets.map((asset) => (
            <article key={asset.id} className={`hire-asset-card hire-asset-card--${asset.availability_status}`}>
              <header>
                <span>🚜</span>
                <StatusPill value={asset.availability_status} />
              </header>
              <h3>{asset.asset_code}</h3>
              <strong>{asset.asset_name}</strong>
              <p>{asset.asset_type} · {asset.make || "Make not set"} {asset.model || ""}</p>
              <div>
                <span>Current meter</span>
                <b>{formatNumber(asset.current_meter)} {asset.meter_type === "odometer" ? "km" : "hrs"}</b>
              </div>
              <div>
                <span>Current location</span>
                <b>{asset.current_location || "Not set"}</b>
              </div>
              {asset.active_contract_number ? (
                <small>Booked under {asset.active_contract_number}</small>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function QuotationsTable({ quotations, canEdit, onEdit, onConvert, onStatus }) {
  return (
    <section className="hire-card">
      <SectionHeader
        eyebrow="Commercial offers"
        title="Hire quotations"
        description="Rates, estimated quantities, charges, discounts and approval."
      />
      {!quotations.length ? (
        <EmptyState title="No quotations" description="Prepare the first quotation from a customer enquiry." />
      ) : (
        <div className="hire-table-wrap">
          <table className="hire-table">
            <thead>
              <tr>
                <th>Quotation</th>
                <th>Customer</th>
                <th>Equipment</th>
                <th>Rate</th>
                <th>Total</th>
                <th>Status</th>
                {canEdit ? <th>Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {quotations.map((quote) => (
                <tr key={quote.id}>
                  <td data-label="Quotation">
                    <strong>{quote.quotation_number}</strong>
                    <small>{formatDateTime(quote.created_at)}</small>
                  </td>
                  <td data-label="Customer">
                    {quote.customer_name}
                    <small>{quote.work_location}</small>
                  </td>
                  <td data-label="Equipment">
                    {quote.requested_asset_type}
                    <small>{quote.preferred_asset_code || "Any suitable machine"}</small>
                  </td>
                  <td data-label="Rate">
                    {formatMoney(quote.rate)}
                    <small>{label(quote.charging_method)}</small>
                  </td>
                  <td data-label="Total"><strong>{formatMoney(quote.total_amount)}</strong></td>
                  <td data-label="Status"><StatusPill value={quote.status} /></td>
                  {canEdit ? (
                    <td data-label="Actions">
                      <div className="hire-row-actions">
                        {quote.status === "draft" ? (
                          <>
                            <button onClick={() => onEdit(quote)}>Edit</button>
                            <button onClick={() => onStatus(quote.id, "approved")}>Approve</button>
                            <button onClick={() => onStatus(quote.id, "rejected")}>Reject</button>
                          </>
                        ) : null}
                        {["approved", "accepted"].includes(quote.status) ? (
                          <button onClick={() => onConvert(quote)}>Create contract</button>
                        ) : null}
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ContractsTable({ contracts, canEdit, onAssign, onStatus }) {
  return (
    <section className="hire-card">
      <SectionHeader
        eyebrow="Customer agreements"
        title="Hire contracts"
        description="Equipment, deposits, dates, assignment readiness and status."
      />
      {!contracts.length ? (
        <EmptyState title="No hire contracts" description="Create a contract directly or from an approved quotation." />
      ) : (
        <div className="hire-table-wrap">
          <table className="hire-table">
            <thead>
              <tr>
                <th>Contract</th>
                <th>Customer / site</th>
                <th>Dates</th>
                <th>Equipment</th>
                <th>Deposit</th>
                <th>Outstanding</th>
                <th>Status</th>
                {canEdit ? <th>Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {contracts.map((contract) => (
                <tr key={contract.id}>
                  <td data-label="Contract">
                    <strong>{contract.contract_number}</strong>
                    <small>{label(contract.charging_method)} · {formatMoney(contract.rate)}</small>
                  </td>
                  <td data-label="Customer / site">
                    {contract.customer_name}
                    <small>{contract.work_location}</small>
                  </td>
                  <td data-label="Dates">
                    {formatDate(contract.start_date)}
                    <small>to {formatDate(contract.expected_end_date)}</small>
                  </td>
                  <td data-label="Equipment">
                    {contract.asset_count || 0}
                    <small>{contract.asset_codes || "No machine assigned"}</small>
                  </td>
                  <td data-label="Deposit">
                    {formatMoney(contract.deposit_received)}
                    <small>of {formatMoney(contract.deposit_required)}</small>
                  </td>
                  <td data-label="Outstanding">{formatMoney(contract.outstanding_balance)}</td>
                  <td data-label="Status"><StatusPill value={contract.status} /></td>
                  {canEdit ? (
                    <td data-label="Actions">
                      <div className="hire-row-actions">
                        {!["completed", "cancelled"].includes(contract.status) ? (
                          <button onClick={() => onAssign(contract)}>Assign machine</button>
                        ) : null}
                        {contract.status === "draft" ? (
                          <button onClick={() => onStatus(contract.id, "confirmed")}>Confirm</button>
                        ) : null}
                        {!["completed", "cancelled"].includes(contract.status) ? (
                          <button onClick={() => onStatus(contract.id, "cancelled")}>Cancel</button>
                        ) : null}
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function OperationsArea({
  assignments,
  dispatches,
  workLogs,
  canEdit,
  onAssign,
  onDispatch,
  onWorkLog,
  onRemoveAssignment,
  onApprove,
}) {
  return (
    <div className="hire-stack">
      <section className="hire-card">
        <SectionHeader
          eyebrow="Fleet assignments"
          title="Contract equipment"
          description="Current machine assignments and their operational status."
          action={
            canEdit ? (
              <button className="hire-btn hire-btn--primary" onClick={onAssign}>
                ＋ Assign equipment
              </button>
            ) : null
          }
        />
        {!assignments.length ? (
          <EmptyState title="No equipment assignments" description="Assign an available Fleet machine to a hire contract." />
        ) : (
          <div className="hire-assignment-grid">
            {assignments.map((assignment) => (
              <article key={assignment.id}>
                <header>
                  <span>🚜</span>
                  <StatusPill value={assignment.status} />
                </header>
                <h3>{assignment.asset_code} — {assignment.asset_name}</h3>
                <p>{assignment.contract_number} · {assignment.customer_name}</p>
                <dl>
                  <div><dt>Location</dt><dd>{assignment.work_location}</dd></div>
                  <div><dt>Operator</dt><dd>{assignment.operator_name || "Not assigned"}</dd></div>
                  <div><dt>Meter</dt><dd>{formatNumber(assignment.current_meter)}</dd></div>
                  <div><dt>From</dt><dd>{formatDateTime(assignment.assigned_from)}</dd></div>
                </dl>
                {canEdit && ["assigned", "dispatched", "active"].includes(assignment.status) ? (
                  <footer>
                    {assignment.status === "assigned" ? (
                      <>
                        <button onClick={() => onDispatch(assignment)}>Dispatch</button>
                        <button onClick={() => onRemoveAssignment(assignment)}>Remove</button>
                      </>
                    ) : null}
                    {["dispatched", "active"].includes(assignment.status) ? (
                      <button onClick={() => onWorkLog(assignment)}>Work log</button>
                    ) : null}
                  </footer>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="hire-card">
        <SectionHeader
          eyebrow="Mobilization history"
          title="Dispatch records"
          description={`${dispatches.length} visible dispatch record${dispatches.length === 1 ? "" : "s"}.`}
        />
        {!dispatches.length ? (
          <EmptyState title="No dispatch records" description="Dispatch details will appear after assigned equipment leaves the yard." />
        ) : (
          <div className="hire-table-wrap">
            <table className="hire-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Contract</th>
                  <th>Equipment</th>
                  <th>Destination</th>
                  <th>Opening meter</th>
                  <th>Condition</th>
                </tr>
              </thead>
              <tbody>
                {dispatches.map((dispatch) => (
                  <tr key={dispatch.id}>
                    <td data-label="Date">{formatDateTime(dispatch.dispatch_datetime)}</td>
                    <td data-label="Contract">
                      {dispatch.contract_number}
                      <small>{dispatch.customer_name}</small>
                    </td>
                    <td data-label="Equipment">{dispatch.asset_code} — {dispatch.asset_name}</td>
                    <td data-label="Destination">{dispatch.destination}</td>
                    <td data-label="Opening meter">{formatNumber(dispatch.opening_meter)}</td>
                    <td data-label="Condition"><StatusPill value={dispatch.condition_status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="hire-card">
        <SectionHeader
          eyebrow="Daily job cards"
          title="Work logs"
          description="Billable, idle and breakdown hours with customer acknowledgement."
        />
        {!workLogs.length ? (
          <EmptyState title="No work logs" description="Record daily meter readings and work completed for active equipment." />
        ) : (
          <div className="hire-table-wrap">
            <table className="hire-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Contract / equipment</th>
                  <th>Meter</th>
                  <th>Billable</th>
                  <th>Idle / breakdown</th>
                  <th>Status</th>
                  {canEdit ? <th>Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {workLogs.map((log) => (
                  <tr key={log.id}>
                    <td data-label="Date">{formatDate(log.work_date)}</td>
                    <td data-label="Contract / equipment">
                      <strong>{log.contract_number}</strong>
                      <small>{log.asset_code} · {log.customer_name}</small>
                    </td>
                    <td data-label="Meter">{formatNumber(log.start_meter)} → {formatNumber(log.end_meter)}</td>
                    <td data-label="Billable">{formatNumber(log.billable_hours)} hrs</td>
                    <td data-label="Idle / breakdown">
                      {formatNumber(log.idle_hours)} / {formatNumber(log.breakdown_hours)}
                    </td>
                    <td data-label="Status"><StatusPill value={log.status} /></td>
                    {canEdit ? (
                      <td data-label="Actions">
                        {log.status === "draft" ? (
                          <button className="hire-inline-action" onClick={() => onApprove(log.id)}>
                            Approve
                          </button>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function FinanceArea({
  invoices,
  payments,
  financeSummary,
  canEdit,
  onInvoice,
  onPayment,
  onVoid,
}) {
  const outstanding = invoices.reduce((sum, invoice) => sum + Number(invoice.balance || 0), 0);
  const paid = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const aging = financeSummary?.aging || {};
  const agingCards = [
    ["Current", aging.current?.balance || 0, aging.current?.invoice_count || 0],
    ["1-30 days", aging["1_30"]?.balance || 0, aging["1_30"]?.invoice_count || 0],
    ["31-60 days", aging["31_60"]?.balance || 0, aging["31_60"]?.invoice_count || 0],
    ["61-90 days", aging["61_90"]?.balance || 0, aging["61_90"]?.invoice_count || 0],
    ["Over 90 days", aging.over_90?.balance || 0, aging.over_90?.invoice_count || 0],
  ];

  return (
    <div className="hire-stack">
      <div className="hire-finance-summary">
        <article><span>🧾</span><div><small>Invoices</small><strong>{invoices.length}</strong></div></article>
        <article><span>💳</span><div><small>Outstanding</small><strong>{formatMoney(outstanding)}</strong></div></article>
        <article><span>💰</span><div><small>Visible payments</small><strong>{formatMoney(paid)}</strong></div></article>
      </div>

      <section className="hire-card">
        <SectionHeader
          eyebrow="Debt aging"
          title="Outstanding balances"
          description="Open invoice balances grouped by due date."
        />
        <div className="hire-finance-summary">
          {agingCards.map(([title, amount, count]) => (
            <article key={title}>
              <span>⏳</span>
              <div>
                <small>{title}</small>
                <strong>{formatMoney(amount)}</strong>
                <p>{count} invoice{Number(count) === 1 ? "" : "s"}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="hire-card">
        <SectionHeader
          eyebrow="Customer balances"
          title="Outstanding by customer"
          description="Customer totals reconcile with open invoice balances."
        />
        {financeSummary?.customer_balances?.length ? (
          <div className="hire-table-wrap">
            <table className="hire-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Invoices</th>
                  <th>Total</th>
                  <th>Paid</th>
                  <th>Outstanding</th>
                  <th>Overdue</th>
                </tr>
              </thead>
              <tbody>
                {financeSummary.customer_balances.map((customer) => (
                  <tr key={customer.id}>
                    <td data-label="Customer">
                      <strong>{customer.customer_name}</strong>
                      <small>{customer.customer_code}</small>
                    </td>
                    <td data-label="Invoices">{customer.invoice_count}</td>
                    <td data-label="Total">{formatMoney(customer.total_amount)}</td>
                    <td data-label="Paid">{formatMoney(customer.amount_paid)}</td>
                    <td data-label="Outstanding">
                      <strong>{formatMoney(customer.outstanding_balance)}</strong>
                    </td>
                    <td data-label="Overdue">{formatMoney(customer.overdue_balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No outstanding balances" description="Open customer balances will appear here." />
        )}
      </section>

      <section className="hire-card">
        <SectionHeader
          eyebrow="Customer billing"
          title="Hire invoices"
          description="Approved hours, contract charges, payments and balances."
          action={
            canEdit ? (
              <div className="hire-header-actions">
                <button className="hire-btn hire-btn--ghost" onClick={() => onPayment()}>
                  Record payment
                </button>
                <button className="hire-btn hire-btn--primary" onClick={onInvoice}>
                  ＋ New invoice
                </button>
              </div>
            ) : null
          }
        />
        {!invoices.length ? (
          <EmptyState title="No hire invoices" description="Approve work logs, then generate the first invoice." />
        ) : (
          <div className="hire-table-wrap">
            <table className="hire-table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Customer / contract</th>
                  <th>Dates</th>
                  <th>Total</th>
                  <th>Paid</th>
                  <th>Balance</th>
                  <th>Status</th>
                  {canEdit ? <th>Action</th> : null}
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td data-label="Invoice"><strong>{invoice.invoice_number}</strong></td>
                    <td data-label="Customer / contract">
                      {invoice.customer_name}
                      <small>{invoice.contract_number}</small>
                    </td>
                    <td data-label="Dates">
                      {formatDate(invoice.invoice_date)}
                      <small>Due {formatDate(invoice.due_date)}</small>
                    </td>
                    <td data-label="Total">{formatMoney(invoice.total_amount)}</td>
                    <td data-label="Paid">{formatMoney(invoice.amount_paid)}</td>
                    <td data-label="Balance"><strong>{formatMoney(invoice.balance)}</strong></td>
                    <td data-label="Status"><StatusPill value={invoice.status} /></td>
                    {canEdit ? (
                      <td data-label="Action">
                        <div className="hire-row-actions">
                          {Number(invoice.balance) > 0 && invoice.status !== "void" ? (
                            <button className="hire-inline-action" onClick={() => onPayment(invoice)}>
                              Receive
                            </button>
                          ) : null}
                          {Number(invoice.amount_paid || 0) === 0 && invoice.status !== "void" ? (
                            <button className="hire-inline-action" onClick={() => onVoid(invoice)}>
                              Void
                            </button>
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="hire-card">
        <SectionHeader
          eyebrow="Receipts"
          title="Hire payments"
          description={`${payments.length} visible payment record${payments.length === 1 ? "" : "s"}.`}
        />
        {!payments.length ? (
          <EmptyState title="No hire payments" description="Deposits and invoice payments will appear here." />
        ) : (
          <div className="hire-table-wrap">
            <table className="hire-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Contract / invoice</th>
                  <th>Category</th>
                  <th>Method</th>
                  <th>Amount</th>
                  <th>Reference</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id}>
                    <td data-label="Date">{formatDateTime(payment.payment_date)}</td>
                    <td data-label="Customer">{payment.customer_name}</td>
                    <td data-label="Contract / invoice">
                      {payment.contract_number}
                      <small>{payment.invoice_number || "No invoice"}</small>
                    </td>
                    <td data-label="Category">{label(payment.payment_category)}</td>
                    <td data-label="Method">{label(payment.payment_method)}</td>
                    <td data-label="Amount"><strong>{formatMoney(payment.amount)}</strong></td>
                    <td data-label="Reference">{payment.reference_number || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function ReportsArea({ reports }) {
  const agingEntries = [
    ["current", "Current/not due"],
    ["1_30", "1-30 days"],
    ["31_60", "31-60 days"],
    ["61_90", "61-90 days"],
    ["over_90", "Over 90 days"],
  ];
  const overdueInvoices = reports.overdue_alerts?.invoices || [];
  const overdueContracts = reports.overdue_alerts?.contracts || [];

  return (
    <div className="hire-report-space">
      <SectionHeader
        eyebrow="Final Equipment Hire reports"
        title="Outstanding, aging and Fleet utilization"
        description="All figures come from the backend for the active Hire location or admin all-location review."
      />

      <div className="hire-aging-grid">
        {agingEntries.map(([key, title]) => {
          const row = reports.aging_summary?.[key] || {};
          return (
            <article key={key} className="hire-aging-card">
              <small>{title}</small>
              <strong>{formatMoney(row.balance)}</strong>
              <span>{formatNumber(row.invoice_count, 0)} invoices</span>
            </article>
          );
        })}
      </div>

      <div className="hire-report-grid">
        <section className="hire-card">
          <SectionHeader
            eyebrow="Invoice-level outstanding"
            title="Open invoice balances"
            description="Paid and void invoices are excluded."
          />
          {reports.outstanding_invoices?.length ? (
            <div className="hire-table-wrap">
              <table className="hire-table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Customer</th>
                    <th>Due</th>
                    <th>Aging</th>
                    <th>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.outstanding_invoices.map((invoice) => (
                    <tr key={invoice.id}>
                      <td data-label="Invoice"><strong>{invoice.invoice_number}</strong></td>
                      <td data-label="Customer">{invoice.customer_name}</td>
                      <td data-label="Due">{formatDate(invoice.due_date)}</td>
                      <td data-label="Aging">{label(invoice.aging_bucket)}</td>
                      <td data-label="Balance">{formatMoney(invoice.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="No outstanding invoices" description="Open balances will appear here." />
          )}
        </section>

        <section className="hire-card">
          <SectionHeader
            eyebrow="Customer-level outstanding"
            title="Customer balances"
            description="Outstanding and overdue amounts by customer."
          />
          {reports.customer_outstanding?.length ? (
            <div className="hire-table-wrap">
              <table className="hire-table">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Invoices</th>
                    <th>Outstanding</th>
                    <th>Overdue</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.customer_outstanding.map((customer) => (
                    <tr key={customer.customer_id}>
                      <td data-label="Customer">
                        <strong>{customer.customer_name}</strong>
                        <small>{customer.customer_code}</small>
                      </td>
                      <td data-label="Invoices">{customer.invoice_count}</td>
                      <td data-label="Outstanding">{formatMoney(customer.outstanding_balance)}</td>
                      <td data-label="Overdue">{formatMoney(customer.overdue_balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="No customer balances" description="Customers with open invoices will appear here." />
          )}
        </section>
      </div>

      <div className="hire-report-grid">
        <section className="hire-card">
          <SectionHeader
            eyebrow="Alerts"
            title="Overdue invoices and contracts"
            description="Use this list for collection and return follow-up."
          />
          <div className="hire-alert-list">
            {overdueInvoices.map((invoice) => (
              <article key={`invoice-${invoice.id}`}>
                <strong>{invoice.invoice_number}</strong>
                <span>{invoice.customer_name} / {invoice.contract_number}</span>
                <small>Due {formatDate(invoice.due_date)} / {formatMoney(invoice.balance)}</small>
              </article>
            ))}
            {overdueContracts.map((contract) => (
              <article key={`contract-${contract.id}`}>
                <strong>{contract.contract_number}</strong>
                <span>{contract.customer_name} / {contract.work_location}</span>
                <small>Expected end {formatDate(contract.expected_end_date)}</small>
              </article>
            ))}
            {!overdueInvoices.length && !overdueContracts.length ? (
              <EmptyState title="No overdue alerts" description="Overdue invoices and ended active contracts will appear here." />
            ) : null}
          </div>
        </section>

        <section className="hire-card">
          <SectionHeader
            eyebrow="Closed contracts"
            title="Unpaid closed contracts"
            description="Operationally closed contracts with finance still outstanding."
          />
          {reports.unpaid_closed_contracts?.length ? (
            <div className="hire-table-wrap">
              <table className="hire-table">
                <thead>
                  <tr>
                    <th>Contract</th>
                    <th>Customer</th>
                    <th>Closed</th>
                    <th>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.unpaid_closed_contracts.map((contract) => (
                    <tr key={contract.id}>
                      <td data-label="Contract"><strong>{contract.contract_number}</strong></td>
                      <td data-label="Customer">{contract.customer_name}</td>
                      <td data-label="Closed">{formatDate(contract.closed_at)}</td>
                      <td data-label="Balance">{formatMoney(contract.outstanding_balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="No unpaid closed contracts" description="Closed contracts are financially settled or not yet closed." />
          )}
        </section>
      </div>

      <section className="hire-card">
        <SectionHeader
          eyebrow="Fleet utilization"
          title="Hire-specific equipment utilization"
          description="Uses the shared Fleet register with Equipment Hire assignments and work logs only."
        />
        {reports.fleet_utilization?.length ? (
          <div className="hire-table-wrap">
            <table className="hire-table">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Status</th>
                  <th>Current Hire</th>
                  <th>Hours</th>
                  <th>Meter</th>
                  <th>Availability</th>
                </tr>
              </thead>
              <tbody>
                {reports.fleet_utilization.map((asset) => (
                  <tr key={asset.asset_id}>
                    <td data-label="Asset">
                      <strong>{asset.asset_code}</strong>
                      <small>{asset.asset_name}</small>
                    </td>
                    <td data-label="Status"><StatusPill value={asset.current_status} /></td>
                    <td data-label="Current Hire">
                      {asset.current_contract_number ? (
                        <>
                          <strong>{asset.current_contract_number}</strong>
                          <small>{asset.current_customer_name}</small>
                        </>
                      ) : (
                        "No active hire"
                      )}
                    </td>
                    <td data-label="Hours">
                      {formatNumber(asset.billable_hours)} billable
                      <small>
                        {formatNumber(asset.idle_hours)} idle / {formatNumber(asset.breakdown_hours)} down
                      </small>
                    </td>
                    <td data-label="Meter">{formatNumber(asset.current_meter)}</td>
                    <td data-label="Availability">{formatDate(asset.upcoming_available_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No Fleet utilization records" description="Equipment utilization appears after assignments and work logs." />
        )}
      </section>

      <section className="hire-card">
        <SectionHeader
          eyebrow="Payment history"
          title="Receipts in the selected period"
          description="Deposits, invoice payments and other Hire receipts."
        />
        {reports.payment_history?.length ? (
          <div className="hire-table-wrap">
            <table className="hire-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Invoice</th>
                  <th>Method</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {reports.payment_history.map((payment) => (
                  <tr key={payment.id}>
                    <td data-label="Date">{formatDateTime(payment.payment_date)}</td>
                    <td data-label="Customer">{payment.customer_name}</td>
                    <td data-label="Invoice">{payment.invoice_number || payment.contract_number}</td>
                    <td data-label="Method">{label(payment.payment_method)}</td>
                    <td data-label="Amount">{formatMoney(payment.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No payment history" description="Receipts in the selected period will appear here." />
        )}
      </section>
    </div>
  );
}

function ReturnsTable({
  returns,
  assignments,
  contracts,
  canEdit,
  onReturn,
  onCloseContract,
}) {
  const openAssignments = assignments.filter((assignment) =>
    ["dispatched", "active"].includes(assignment.status)
  );
  const closureCandidates = contracts.filter(
    (contract) =>
      !["completed", "cancelled"].includes(contract.status) &&
      Number(contract.returned_asset_count || 0) > 0 &&
      Number(contract.open_asset_count || 0) === 0
  );

  return (
    <div className="hire-stack">
      {canEdit && openAssignments.length ? (
        <section className="hire-card">
          <SectionHeader
            eyebrow="Awaiting closure"
            title="Equipment still assigned"
            description="Complete a return inspection to release equipment back to Fleet."
          />
          <div className="hire-ending-grid">
            {openAssignments.map((assignment) => (
              <article key={assignment.id}>
                <strong>{assignment.asset_code} — {assignment.asset_name}</strong>
                <p>{assignment.contract_number} · {assignment.customer_name}</p>
                <span>{assignment.work_location}</span>
                <button className="hire-inline-action" onClick={() => onReturn(assignment)}>
                  Complete return
                </button>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {canEdit && closureCandidates.length ? (
        <section className="hire-card">
          <SectionHeader
            eyebrow="Contract closure"
            title="Returned contracts ready for closure check"
            description="Closure preserves outstanding finance and closes only the operational contract."
          />
          <div className="hire-ending-grid">
            {closureCandidates.map((contract) => (
              <article key={contract.id}>
                <strong>{contract.contract_number}</strong>
                <p>{contract.customer_name}</p>
                <span>{contract.work_location}</span>
                <small>
                  Returned equipment: {contract.returned_asset_count || 0}
                </small>
                <button className="hire-inline-action" onClick={() => onCloseContract(contract)}>
                  Close contract
                </button>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="hire-card">
        <SectionHeader
          eyebrow="Equipment close-out"
          title="Return inspections"
          description="Closing meter, fuel, condition, damage and release status."
        />
        {!returns.length ? (
          <EmptyState title="No return inspections" description="Returned equipment and final condition reports will appear here." />
        ) : (
          <div className="hire-table-wrap">
            <table className="hire-table">
              <thead>
                <tr>
                  <th>Return date</th>
                  <th>Contract / customer</th>
                  <th>Equipment</th>
                  <th>Closing meter</th>
                  <th>Condition</th>
                  <th>Damage estimate</th>
                </tr>
              </thead>
              <tbody>
                {returns.map((item) => (
                  <tr key={item.id}>
                    <td data-label="Return date">{formatDateTime(item.return_datetime)}</td>
                    <td data-label="Contract / customer">
                      {item.contract_number}
                      <small>{item.customer_name}</small>
                    </td>
                    <td data-label="Equipment">{item.asset_code} — {item.asset_name}</td>
                    <td data-label="Closing meter">{formatNumber(item.closing_meter)}</td>
                    <td data-label="Condition"><StatusPill value={item.condition_status} /></td>
                    <td data-label="Damage estimate">{formatMoney(item.estimated_damage_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
