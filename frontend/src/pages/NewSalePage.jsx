import { useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import AuditUnlockRequestBox from "../components/AuditUnlockRequestBox";
import InventoryUnitScanner from "../components/InventoryUnitScanner";
import { useAuth } from "../context/AuthContext";

export default function NewSalePage() {
  const { user, branchId, branchCode, branchName, branchLocation } = useAuth();

  const currentStoreCode =
    branchCode ||
    user?.branch_code ||
    user?.selected_branch?.branch_code ||
    user?.selected_branch?.code ||
    "STORE";

  const currentStoreName =
    branchName ||
    user?.branch_name ||
    user?.selected_branch?.branch_name ||
    user?.selected_branch?.name ||
    "Selected Store";

  const currentStoreLocation =
    branchLocation ||
    user?.branch_location ||
    user?.selected_branch?.branch_location ||
    user?.selected_branch?.location ||
    "";

  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);

  const [selectedProductId, setSelectedProductId] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [quantity, setQuantity] = useState(1);

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerLocation, setCustomerLocation] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerMatches, setCustomerMatches] = useState([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [paymentType, setPaymentType] = useState("cash");
  const [discountAmount, setDiscountAmount] = useState("");
  const [amountPaid, setAmountPaid] = useState("");
  const [paymentAllocations, setPaymentAllocations] = useState({
    cash: "",
    momo: "",
    bank: "",
    other: "",
  });
  const [installmentApprovalRequired, setInstallmentApprovalRequired] = useState(false);
  const [installmentPlan, setInstallmentPlan] = useState({
    frequency: "monthly",
    installment_count: 3,
    first_due_date: new Date(Date.now() + 30 * 86400000)
      .toISOString()
      .slice(0, 10),
    grace_days: 3,
    delivery_policy: "immediate",
    late_charge_type: "none",
    late_charge_value: 0,
    guarantor_name: "",
    guarantor_phone: "",
    guarantor_location: "",
    terms_accepted: false,
    notes: "",
    custom_due_dates_text: "",
  });

  const [receipt, setReceipt] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [lockedPeriod, setLockedPeriod] = useState(null);
  const [sendingReceiptSms, setSendingReceiptSms] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  const businessName = "CHALIN 03 COMPANY LIMITED";
  const businessAddress = "Dunkwa Police Barrier";
  const businessPhone = "0249469080 / 0249995510";
  const momoNumber = businessPhone;
  const receiptFooter = "Thank You For Coming";
  const policyText = "QUALITY PARTS. RELIABLE SERVICE. BUILT ON TRUST.";

  function getReceiptBusinessName(receiptData) {
    return receiptData?.business_name || businessName;
  }

  function getReceiptBusinessAddress(receiptData) {
    return (
      receiptData?.business_address ||
      receiptData?.branch_location ||
      currentStoreLocation ||
      businessAddress
    );
  }

  function getReceiptBusinessPhone(receiptData) {
    return receiptData?.business_phone || businessPhone;
  }

  function getReceiptMomoNumber(receiptData) {
    return receiptData?.momo_number || receiptData?.business_phone || momoNumber;
  }

  function getReceiptStoreName(receiptData) {
    return (
      receiptData?.branch_name || receiptData?.store_name || currentStoreName
    );
  }

  function getReceiptStoreCode(receiptData) {
    return (
      receiptData?.branch_code || receiptData?.store_code || currentStoreCode
    );
  }

  function cleanText(value) {
    if (value === undefined || value === null) {
      return "";
    }

    return String(value).trim();
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatMoney(value) {
    return Number(value || 0).toFixed(2);
  }

  function formatCompactMoney(value) {
    const number = Number(value || 0);

    if (number >= 1000000) {
      return `GHS ${(number / 1000000).toFixed(1)}M`;
    }

    if (number >= 1000) {
      return `GHS ${(number / 1000).toFixed(1)}K`;
    }

    return `GHS ${formatMoney(number)}`;
  }

  function formatReceiptDate(value) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "";
    }

    return date.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }

  function formatReceiptTime(value) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "";
    }

    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
  }

  function formatPaymentMethod(value) {
    const paymentMethods = {
      cash: "Cash",
      momo: "MoMo",
      bank: "Bank",
      credit: "Credit",
      mixed: "Mixed",
      installment: "Installment",
    };

    return paymentMethods[String(value || "").toLowerCase()] || value || "-";
  }

  function getFriendlyApiError(error, fallbackMessage) {
    const responseData = error?.response?.data;

    if (responseData?.code === "AUDIT_PERIOD_LOCKED") {
      const lockedPeriod = responseData.locked_period || {};
      const periodLabel =
        lockedPeriod.period_label || "Approved accounting period";
      const approvedBy = lockedPeriod.approved_by_name || "management";
      const reviewDate = lockedPeriod.review_date || "";

      return [
        "This sale cannot be recorded because the accounting period is locked.",
        `Locked Period: ${periodLabel}.`,
        `Reason: This period has already been approved by ${approvedBy}.`,
        reviewDate ? `Approval Date: ${reviewDate}.` : "",
        "Ask the admin or manager to review the audit sign-off before making changes inside this period.",
      ]
        .filter(Boolean)
        .join(" ");
    }

    return responseData?.message || fallbackMessage;
  }

  function rememberLockedPeriodFromError(error) {
    const responseData = error?.response?.data;

    if (responseData?.code === "AUDIT_PERIOD_LOCKED") {
      setLockedPeriod(responseData.locked_period || null);
      return;
    }

    setLockedPeriod(null);
  }

  function getReceiptCustomerName(receiptData) {
    return (
      receiptData?.customer?.name ||
      receiptData?.customer_name ||
      "Walk-in Customer"
    );
  }

  function getReceiptCustomerPhone(receiptData) {
    return receiptData?.customer?.phone || receiptData?.customer_phone || "-";
  }

  function formatPhoneForWhatsApp(phone) {
    const rawPhone = String(phone || "").trim();

    if (!rawPhone || rawPhone === "-") {
      return "";
    }

    let digits = rawPhone.replace(/\D/g, "");

    if (digits.startsWith("0")) {
      digits = `233${digits.slice(1)}`;
    }

    if (digits.startsWith("233")) {
      return digits;
    }

    if (digits.length === 9) {
      return `233${digits}`;
    }

    return digits;
  }

  function buildWhatsAppReceiptMessage(receiptData) {
    const customer = getReceiptCustomerName(receiptData);
    const phone = getReceiptCustomerPhone(receiptData);

    const itemsText = (receiptData.items || [])
      .map((item) => {
        return `- ${item.product_name} x${item.quantity} = GHS ${formatMoney(
          item.line_total
        )}`;
      })
      .join("\n");

    return `Hello ${customer},

Thank you for buying from ${getReceiptBusinessName(receiptData)}.

RECEIPT DETAILS
Store: ${getReceiptStoreCode(receiptData)} - ${getReceiptStoreName(receiptData)}
Receipt No: ${receiptData.receipt_number}
Customer: ${customer}
Phone: ${phone}
Payment: ${formatPaymentMethod(receiptData.payment_type)}

ITEMS
${itemsText}

TOTALS
Subtotal: GHS ${formatMoney(receiptData.subtotal)}
Discount: GHS ${formatMoney(receiptData.discount_amount)}
VAT: GHS ${formatMoney(receiptData.tax_amount)}
Amount Due: GHS ${formatMoney(receiptData.total)}
Amount Tendered: GHS ${formatMoney(receiptData.amount_tendered)}
Amount Paid: GHS ${formatMoney(receiptData.amount_paid)}
Change Due: GHS ${formatMoney(receiptData.change_due)}
Balance: GHS ${formatMoney(receiptData.balance)}

Served by: ${receiptData.staff?.full_name || "-"}

${receiptFooter}
${policyText}

Note: Your PDF receipt can also be attached manually on WhatsApp.`;
  }

  async function sendReceiptSms() {
    setMessage("");
    setError("");

    if (!receipt?.sale_id) {
      setError("Receipt ID is missing. Cannot send SMS receipt.");
      return;
    }

    setSendingReceiptSms(true);

    try {
      const response = await axiosClient.post(`/sms/receipt/${receipt.sale_id}`);
      setMessage(response.data.message || "Receipt SMS sent successfully.");
    } catch (error) {
      setError(getFriendlyApiError(error, "Failed to send receipt SMS."));
    } finally {
      setSendingReceiptSms(false);
    }
  }

  function sendReceiptWhatsApp() {
    setMessage("");
    setError("");

    if (!receipt) {
      setError("No receipt available to send.");
      return;
    }

    const customerPhone = getReceiptCustomerPhone(receipt);
    const whatsappPhone = formatPhoneForWhatsApp(customerPhone);

    if (!whatsappPhone) {
      setError("Customer phone number is missing. Add customer phone first.");
      return;
    }

    const messageText = buildWhatsAppReceiptMessage(receipt);

    const whatsappUrl = `https://wa.me/${whatsappPhone}?text=${encodeURIComponent(
      messageText
    )}`;

    window.open(whatsappUrl, "_blank", "noopener,noreferrer");
  }

  async function loadProducts() {
    setError("");

    try {
      const response = await axiosClient.get("/inventory-traceability/sale-products");
      setProducts(response.data.products || []);
    } catch (error) {
      setError(getFriendlyApiError(error, "Failed to load products."));
    }
  }

  function selectSavedCustomer(customer) {
    setSelectedCustomerId(String(customer.id));
    setSelectedCustomer(customer);
    setCustomerName(customer.name || "");
    setCustomerPhone(customer.phone || "");
    setCustomerLocation(customer.location || "");
    setCustomerSearch(customer.phone || customer.name || "");
    setCustomerMatches([]);
    setMessage(`Saved details loaded for ${customer.name}. Enter only this sale's items and payment.`);
    setError("");
  }

  function useNewCustomer() {
    setSelectedCustomerId("");
    setSelectedCustomer(null);
    setCustomerSearch("");
    setCustomerMatches([]);
    setCustomerName("");
    setCustomerPhone("");
    setCustomerLocation("");
    setMessage("Enter the new customer's details. The system will save them after the sale.");
  }

  function formatCustomerHistoryDate(value) {
    if (!value) return "No previous purchase";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Previous purchase recorded";
    return date.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }

  useEffect(() => {
    const query = customerSearch.trim();
    if (query.length < 2 || selectedCustomer) {
      setCustomerMatches([]);
      setLoadingCustomers(false);
      return undefined;
    }

    let active = true;
    const timer = window.setTimeout(async () => {
      setLoadingCustomers(true);
      try {
        const response = await axiosClient.get("/sales/customers", {
          params: { search: query },
        });
        if (active) setCustomerMatches(response.data.customers || []);
      } catch (searchError) {
        if (active) {
          setCustomerMatches([]);
          setError(getFriendlyApiError(searchError, "Could not search saved customers."));
        }
      } finally {
        if (active) setLoadingCustomers(false);
      }
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [customerSearch, selectedCustomer, branchId]);

  useEffect(() => {
    setSelectedCustomerId("");
    setSelectedCustomer(null);
    setCustomerSearch("");
    setCustomerMatches([]);
  }, [branchId]);

  useEffect(() => {
    loadProducts();
    // Reload available products when the selected store changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  useEffect(() => {
    let active = true;

    async function loadInstallmentDefaults() {
      try {
        const response = await axiosClient.get("/installments/settings");
        const value = response.data.settings || {};

        if (!active || !value) return;

        setInstallmentApprovalRequired(Boolean(value.require_manager_approval));

        setInstallmentPlan((current) => ({
          ...current,
          frequency: value.default_frequency || current.frequency,
          installment_count:
            Number(value.default_installment_count || 0) ||
            current.installment_count,
          grace_days:
            Number(value.default_grace_days ?? current.grace_days) ||
            0,
          delivery_policy:
            value.default_delivery_policy || current.delivery_policy,
          late_charge_type:
            value.late_charge_type || current.late_charge_type,
          late_charge_value:
            Number(value.late_charge_value ?? current.late_charge_value) || 0,
        }));
      } catch {
        // Installment defaults are optional while the page is used for ordinary sales.
      }
    }

    loadInstallmentDefaults();

    return () => {
      active = false;
    };
  }, [branchId]);

  useEffect(() => {
    function checkScreenSize() {
      setIsMobile(window.innerWidth <= 760);
    }

    checkScreenSize();
    window.addEventListener("resize", checkScreenSize);

    return () => {
      window.removeEventListener("resize", checkScreenSize);
    };
  }, []);

  const selectedProduct = useMemo(() => {
    return products.find(
      (product) => Number(product.id) === Number(selectedProductId)
    );
  }, [products, selectedProductId]);

  const filteredProducts = useMemo(() => {
    const searchText = productSearch.trim().toLowerCase();

    if (!searchText) {
      return [];
    }

    return products
      .filter((product) => {
        const searchableText = [
          product.name,
          product.barcode,
          product.category,
          product.size,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return searchableText.includes(searchText);
      })
      .slice(0, 15);
  }, [products, productSearch]);

  const subtotal = useMemo(() => {
    return cart.reduce((sum, item) => {
      return sum + Number(item.selling_price) * Number(item.quantity);
    }, 0);
  }, [cart]);

  const cleanDiscountAmount = Math.max(Number(discountAmount || 0), 0);
  const estimatedAmountDue = Math.max(subtotal - cleanDiscountAmount, 0);
  const immediatePayment = ["cash", "momo", "bank"].includes(paymentType);
  const allocationTotal = Object.values(paymentAllocations).reduce(
    (sum, value) => sum + Math.max(Number(value || 0), 0),
    0
  );
  const liveAmountTendered = immediatePayment
    ? Math.max(Number(amountPaid || 0), 0)
    : allocationTotal;
  const liveAppliedPayment = Math.min(liveAmountTendered, estimatedAmountDue);
  const liveChangeDue = immediatePayment
    ? Math.max(liveAmountTendered - estimatedAmountDue, 0)
    : 0;
  const expectedBalance = Math.max(estimatedAmountDue - liveAppliedPayment, 0);

  const saleProgress = useMemo(() => {
    let score = 0;

    if (cart.length > 0) score += 35;
    if (paymentType) score += 20;
    if (liveAmountTendered >= estimatedAmountDue && estimatedAmountDue > 0) {
      score += 25;
    } else if (liveAmountTendered > 0) {
      score += 15;
    }

    if (["credit", "mixed", "installment"].includes(paymentType)) {
      if (paymentType === "installment") {
        if (cleanText(customerName) && cleanText(customerPhone)) score += 20;
      } else if (cleanText(customerName) || cleanText(customerPhone)) {
        score += 20;
      }
    } else {
      score += 20;
    }

    return Math.min(score, 100);
  }, [cart.length, paymentType, liveAmountTendered, estimatedAmountDue, customerName, customerPhone]);

  const lowStockProducts = products.filter(
    (product) =>
      Number(product.quantity || 0) <= Number(product.low_stock_threshold || 0)
  );

  const outOfStockProducts = products.filter(
    (product) => Number(product.quantity || 0) <= 0
  );

  function selectProductForSale(product) {
    setError("");
    setMessage("");
    setSelectedProductId(String(product.id));
    setProductSearch(product.name || "");
  }

  function clearSelectedProduct() {
    setSelectedProductId("");
    setProductSearch("");
    setQuantity(1);
  }

  function addToCart() {
    setError("");
    setMessage("");

    const product = products.find(
      (product) => Number(product.id) === Number(selectedProductId)
    );

    if (!product) {
      setError("Search and select a product first.");
      return;
    }

    if (Number(product.quantity) <= 0) {
      setError("This product is out of stock.");
      return;
    }

    const requestedQuantity = Number(quantity);

    if (!Number.isInteger(requestedQuantity) || requestedQuantity <= 0) {
      setError("Quantity must be a whole number greater than zero.");
      return;
    }

    const existingItem = cart.find((item) => item.id === product.id);
    const existingQuantity = existingItem ? Number(existingItem.quantity) : 0;
    const finalQuantity = existingQuantity + requestedQuantity;

    if (finalQuantity > Number(product.quantity)) {
      setError(
        `Only ${product.quantity} in stock. You already added ${existingQuantity}.`
      );
      return;
    }

    if (existingItem) {
      setCart(
        cart.map((item) =>
          item.id === product.id
            ? {
                ...item,
                quantity: finalQuantity,
              }
            : item
        )
      );
    } else {
      setCart([
        ...cart,
        {
          ...product,
          quantity: requestedQuantity,
          unit_ids: [],
        },
      ]);
    }

    setSelectedProductId("");
    setProductSearch("");
    setQuantity(1);
  }

  function removeFromCart(productId) {
    setCart(cart.filter((item) => item.id !== productId));
  }

  function updateCartQuantity(productId, newQuantity) {
    const cleanQuantity = Number(newQuantity);

    if (!Number.isInteger(cleanQuantity) || cleanQuantity <= 0) {
      return;
    }

    const product = products.find(
      (productItem) => Number(productItem.id) === Number(productId)
    );

    if (product && cleanQuantity > Number(product.quantity || 0)) {
      setError(`Only ${product.quantity} in stock for ${product.name}.`);
      return;
    }

    setError("");
    setCart(
      cart.map((item) =>
        Number(item.id) === Number(productId)
          ? {
              ...item,
              quantity: cleanQuantity,
              unit_ids: Array.isArray(item.unit_ids)
                ? item.unit_ids.slice(0, cleanQuantity)
                : [],
            }
          : item
      )
    );
  }

  function clearSale() {
    const confirmed = cart.length
      ? window.confirm("Clear all current sale items and payment details?")
      : true;

    if (!confirmed) return;

    setCart([]);
    setSelectedProductId("");
    setProductSearch("");
    setQuantity(1);
    setCustomerName("");
    setCustomerPhone("");
    setCustomerLocation("");
    setCustomerSearch("");
    setCustomerMatches([]);
    setSelectedCustomerId("");
    setSelectedCustomer(null);
    setPaymentType("cash");
    setDiscountAmount("");
    setAmountPaid("");
    setPaymentAllocations({ cash: "", momo: "", bank: "", other: "" });
    setInstallmentPlan({
      frequency: "monthly",
      installment_count: 3,
      first_due_date: new Date(Date.now() + 30 * 86400000)
        .toISOString()
        .slice(0, 10),
      grace_days: 3,
      delivery_policy: "immediate",
      late_charge_type: "none",
      late_charge_value: 0,
      guarantor_name: "",
      guarantor_phone: "",
      guarantor_location: "",
      terms_accepted: false,
      notes: "",
    });
    setReceipt(null);
    setMessage("");
    setError("");
    setLockedPeriod(null);
  }

  async function completeSale(event) {
    event.preventDefault();

    setError("");
    setMessage("");
    setReceipt(null);
    setLockedPeriod(null);

    const cleanCustomerName = cleanText(customerName);
    const cleanCustomerPhone = cleanText(customerPhone);
    const cleanCustomerLocation = cleanText(customerLocation);

    if (cart.length === 0) {
      setError("Add at least one item to the sale.");
      return;
    }

    const incompleteSerializedItem = cart.find((item) => {
      const serialized = String(item.inventory_tracking_mode || "quantity").toLowerCase() === "serialized";
      const enforced = String(item.inventory_traceability_state || "off").toLowerCase() === "enforced";
      return serialized && enforced && Number(item.quantity) !== (item.unit_ids || []).length;
    });
    if (incompleteSerializedItem) {
      setError(
        `${incompleteSerializedItem.name} requires exactly ${incompleteSerializedItem.quantity} verified physical unit ID${Number(incompleteSerializedItem.quantity) === 1 ? "" : "s"} before checkout.`
      );
      return;
    }

    const discount = Number(discountAmount || 0);

    if (Number.isNaN(discount) || discount < 0) {
      setError("Discount must be a valid number and cannot be negative.");
      return;
    }

    if (discount > subtotal) {
      setError("Discount cannot be greater than subtotal.");
      return;
    }

    if (
      ["credit", "mixed", "installment"].includes(paymentType) &&
      !cleanCustomerName &&
      !cleanCustomerPhone
    ) {
      setError("Customer name or phone is required for credit, mixed or installment sales.");
      return;
    }

    if (
      paymentType === "installment" &&
      (!cleanCustomerName || !cleanCustomerPhone)
    ) {
      setError("Installment sales require both the customer name and phone number.");
      return;
    }

    if (
      paymentType === "installment" &&
      (!installmentPlan.first_due_date ||
        Number(installmentPlan.installment_count || 0) < 1)
    ) {
      setError("Choose the first payment date and number of installment payments.");
      return;
    }

    if (
      paymentType === "installment" &&
      installmentPlan.frequency === "custom"
    ) {
      const customDates = String(installmentPlan.custom_due_dates_text || "")
        .split(/[\n,]+/)
        .map((item) => item.trim())
        .filter(Boolean);
      if (customDates.length !== Number(installmentPlan.installment_count || 0)) {
        setError(
          "Custom schedules require one YYYY-MM-DD due date for every installment payment."
        );
        return;
      }
    }

    if (
      paymentType === "installment" &&
      installmentApprovalRequired &&
      liveAppliedPayment > 0.005
    ) {
      setError(
        "This store requires manager approval before collecting a deposit. Set all payment channels to zero, save the agreement, then collect the first payment after approval."
      );
      return;
    }

    if (paymentType === "installment" && !installmentPlan.terms_accepted) {
      setError("Confirm that the customer accepted the installment terms.");
      return;
    }

    if (
      paymentType === "installment" &&
      liveAmountTendered >= estimatedAmountDue
    ) {
      setError("An installment sale must leave an outstanding balance.");
      return;
    }

    try {
      const response = await axiosClient.post("/sales", {
        customer_id: selectedCustomerId ? Number(selectedCustomerId) : null,
        customer_name: cleanCustomerName,
        customer_phone: cleanCustomerPhone,
        customer_location: cleanCustomerLocation,
        payment_type: paymentType,
        discount_amount: discount,
        amount_tendered: Number(liveAmountTendered || 0),
        amount_paid: Number(liveAmountTendered || 0),
        payment_allocations: paymentAllocations,
        installment_plan:
          paymentType === "installment"
            ? {
                ...installmentPlan,
                customer_phone: cleanCustomerPhone,
                installment_count: Number(installmentPlan.installment_count || 0),
                grace_days: Number(installmentPlan.grace_days || 0),
                late_charge_value: Number(installmentPlan.late_charge_value || 0),
                custom_due_dates:
                  installmentPlan.frequency === "custom"
                    ? String(installmentPlan.custom_due_dates_text || "")
                        .split(/[\n,]+/)
                        .map((item) => item.trim())
                        .filter(Boolean)
                    : [],
              }
            : null,
        items: cart.map((item) => ({
          product_id: item.id,
          quantity: item.quantity,
          unit_ids: Array.isArray(item.unit_ids) ? item.unit_ids : [],
        })),
      });

      const savedReceipt = response.data.receipt || {};

      setReceipt({
        ...savedReceipt,
        installment: response.data.installment || null,
        branch_id: savedReceipt.branch_id || branchId,
        branch_code: savedReceipt.branch_code || currentStoreCode,
        branch_name: savedReceipt.branch_name || currentStoreName,
        branch_location:
          savedReceipt.branch_location ||
          savedReceipt.business_address ||
          currentStoreLocation,
        customer: {
          ...(savedReceipt.customer || {}),
          name:
            savedReceipt.customer?.name ||
            cleanCustomerName ||
            "Walk-in Customer",
          phone: savedReceipt.customer?.phone || cleanCustomerPhone || "",
          location:
            savedReceipt.customer?.location || cleanCustomerLocation || "",
        },
      });

      setMessage(
        paymentType === "installment"
          ? `Installment sale recorded successfully${
              response.data.installment?.agreement_number
                ? ` — ${response.data.installment.agreement_number}`
                : ""
            }.`
          : "Sale recorded successfully."
      );
      setLockedPeriod(null);

      setCart([]);
      setSelectedProductId("");
      setProductSearch("");
      setQuantity(1);
      setCustomerName("");
      setCustomerPhone("");
      setCustomerLocation("");
      setPaymentType("cash");
      setDiscountAmount("");
      setAmountPaid("");
      setPaymentAllocations({ cash: "", momo: "", bank: "", other: "" });
      setInstallmentPlan({
        frequency: "monthly",
        installment_count: 3,
        first_due_date: new Date(Date.now() + 30 * 86400000)
          .toISOString()
          .slice(0, 10),
        grace_days: 3,
        delivery_policy: "immediate",
        late_charge_type: "none",
        late_charge_value: 0,
        guarantor_name: "",
        guarantor_phone: "",
        guarantor_location: "",
        terms_accepted: false,
        notes: "",
        custom_due_dates_text: "",
      });

      await loadProducts();
    } catch (error) {
      rememberLockedPeriodFromError(error);
      setError(getFriendlyApiError(error, "Failed to record sale."));
    }
  }

  async function downloadReceiptPdf() {
    if (!receipt?.sale_id) {
      setError("Receipt ID is missing. Cannot download PDF.");
      return;
    }

    setMessage("");
    setError("");

    try {
      const response = await axiosClient.get(
        `/receipts/sales/${receipt.sale_id}/pdf`,
        {
          responseType: "blob",
        }
      );

      const pdfBlob = new Blob([response.data], {
        type: "application/pdf",
      });

      const fileUrl = window.URL.createObjectURL(pdfBlob);

      const link = document.createElement("a");
      link.href = fileUrl;
      link.download = `${receipt.receipt_number || "receipt"}.pdf`;
      link.style.display = "none";

      document.body.appendChild(link);
      link.click();

      setTimeout(() => {
        document.body.removeChild(link);
        window.URL.revokeObjectURL(fileUrl);
      }, 100);

      setMessage("Receipt PDF downloaded successfully.");
    } catch (error) {
      console.error("PDF download frontend error:", error);
      setError(getFriendlyApiError(error, "Failed to download receipt PDF."));
    }
  }

  function printReceipt() {
    if (!receipt) return;

    const receiptDiscount = Number(receipt.discount_amount || 0);
    const receiptCustomerName = getReceiptCustomerName(receipt);
    const receiptCustomerPhone = getReceiptCustomerPhone(receipt);
    const receiptBusinessName = getReceiptBusinessName(receipt);
    const receiptBusinessAddress = getReceiptBusinessAddress(receipt);
    const receiptBusinessPhone = getReceiptBusinessPhone(receipt);
    const receiptMomoNumber = getReceiptMomoNumber(receipt);
    const receiptStoreCode = getReceiptStoreCode(receipt);
    const receiptStoreName = getReceiptStoreName(receipt);

    const itemsHtml = receipt.items
      .map(
        (item) => `
          <tr>
            <td class="item-name">${escapeHtml(
              String(item.product_name || "").toUpperCase()
            )}</td>
            <td class="right">${formatMoney(item.unit_price)}</td>
            <td class="right">${escapeHtml(item.quantity)}</td>
            <td class="right">${formatMoney(item.line_total)}</td>
          </tr>
        `
      )
      .join("");

    const receiptHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Receipt ${escapeHtml(receipt.receipt_number)}</title>

          <style>
            @page {
              size: 80mm auto;
              margin: 4mm;
            }

            html,
            body {
              font-family: "Courier New", monospace;
              margin: 0;
              padding: 0;
              color: #000;
              background: #fff;
            }

            .receipt {
              width: 72mm;
              margin: 0 auto;
              font-size: 12px;
              font-weight: 700;
            }

            .center {
              text-align: center;
            }

            h1 {
              font-size: 15px;
              margin: 0 0 6px;
              text-align: center;
              font-weight: 900;
            }

            p {
              margin: 4px 0;
            }

            .dash {
              border-top: 1px dashed #000;
              margin: 8px 0;
            }

            .details-row {
              display: grid;
              grid-template-columns: 32mm 1fr;
              gap: 4px;
              margin: 4px 0;
            }

            table {
              width: 100%;
              border-collapse: collapse;
              font-size: 12px;
            }

            th,
            td {
              padding: 3px 0;
              vertical-align: top;
            }

            th {
              text-align: left;
            }

            .item-name {
              width: 34mm;
              word-break: break-word;
            }

            .right {
              text-align: right;
            }

            .totals-row {
              display: flex;
              justify-content: space-between;
              gap: 8px;
              margin: 6px 0;
            }

            .big {
              font-size: 13px;
              font-weight: 900;
            }

            .footer {
              text-align: center;
              margin-top: 18px;
              font-weight: 900;
            }

            .policy {
              text-align: center;
              font-style: italic;
              margin-top: 10px;
              font-weight: 900;
            }

            .powered {
              margin-top: 12px;
              text-align: center;
              font-size: 9px;
              font-weight: 500;
            }
          </style>
        </head>

        <body>
          <div class="receipt">
            <h1>${escapeHtml(receiptBusinessName)}</h1>

            <div class="center">
              <p>${escapeHtml(receiptBusinessAddress)}</p>
              <p>Tel: ${escapeHtml(receiptBusinessPhone)}</p>
              <p>MOMO #: ${escapeHtml(receiptMomoNumber)}</p>
              <p>Store: ${escapeHtml(receiptStoreCode)} - ${escapeHtml(
      receiptStoreName
    )}</p>
            </div>

            <div class="dash"></div>

            <div class="details-row">
              <span>Customer :</span>
              <span>${escapeHtml(receiptCustomerName)}</span>
            </div>

            <div class="details-row">
              <span>Phone :</span>
              <span>${escapeHtml(receiptCustomerPhone)}</span>
            </div>

            <div class="details-row">
              <span>Date :</span>
              <span>${escapeHtml(formatReceiptDate(receipt.created_at))}</span>
            </div>

            <div class="details-row">
              <span>Time :</span>
              <span>${escapeHtml(formatReceiptTime(receipt.created_at))}</span>
            </div>

            <div class="details-row">
              <span>Receipt No.:</span>
              <span>${escapeHtml(receipt.receipt_number)}</span>
            </div>

            <div class="details-row">
              <span>Payment :</span>
              <span>${escapeHtml(
                formatPaymentMethod(receipt.payment_type)
              )}</span>
            </div>

            <div class="dash"></div>

            <table>
              <thead>
                <tr>
                  <th>Item Description</th>
                  <th class="right">Px</th>
                  <th class="right">Qty</th>
                  <th class="right">Amt</th>
                </tr>
              </thead>

              <tbody>
                ${itemsHtml}
              </tbody>
            </table>

            <div class="dash"></div>

            <div class="totals-row">
              <span>Sub Total</span>
              <span>${formatMoney(receipt.subtotal)}</span>
            </div>

            <div class="totals-row">
              <span>Discount</span>
              <span>${formatMoney(receiptDiscount)}</span>
            </div>

            <div class="totals-row">
              <span>Vat</span>
              <span>${formatMoney(receipt.tax_amount)}</span>
            </div>

            <div class="dash"></div>

            <div class="totals-row big">
              <span>Amount Due</span>
              <span>${formatMoney(receipt.total)}</span>
            </div>

            <div class="totals-row">
              <span>Amount Tendered</span>
              <span>${formatMoney(receipt.amount_tendered)}</span>
            </div>

            <div class="totals-row">
              <span>Amount Paid</span>
              <span>${formatMoney(receipt.amount_paid)}</span>
            </div>

            <div class="totals-row ${Number(receipt.change_due || 0) > 0 ? "big" : ""}">
              <span>Change Due</span>
              <span>${formatMoney(receipt.change_due)}</span>
            </div>

            <div class="totals-row">
              <span>Balance Outstanding</span>
              <span>${formatMoney(receipt.balance)}</span>
            </div>

            <div class="dash"></div>

            <p>Served by&nbsp;&nbsp; ${escapeHtml(
              receipt.staff?.full_name || "-"
            )}</p>

            <div class="footer">${escapeHtml(receiptFooter)}</div>

            <div class="policy">${escapeHtml(policyText)}</div>

            <div class="powered">Powered by Chalin 03 System</div>
          </div>

          <script>
            window.onload = function () {
              window.focus();
              window.print();
            };
          </script>
        </body>
      </html>
    `;

    const printWindow = window.open("", "_blank", "width=420,height=700");

    if (!printWindow) {
      setError("Popup blocked. Please allow popups to print receipt.");
      return;
    }

    printWindow.document.open();
    printWindow.document.write(receiptHtml);
    printWindow.document.close();
  }

  const pageStyle = isMobile ? { ...styles.page, ...styles.pageMobile } : styles.page;
  const oneColumn = isMobile ? styles.oneColumn : {};
  const compactHero = isMobile ? styles.heroMobile : {};
  const compactHeroTitle = isMobile ? styles.heroTitleMobile : {};
  const compactHeroActions = isMobile ? styles.heroActionsMobile : {};
  const compactSearchGrid = isMobile ? styles.searchGridMobile : {};
  const compactReceiptActions = isMobile ? styles.receiptActionsMobile : {};

  return (
    <div style={pageStyle}>
      <div style={{ ...styles.hero, ...compactHero }}>
        <div style={styles.heroGlowOne} />
        <div style={styles.heroGlowTwo} />

        <div style={styles.heroContent}>
          <div style={styles.heroTop}>
            <div>
              <p style={styles.eyebrow}>Cashier Sales Center • {currentStoreCode}</p>
              <h1 style={{ ...styles.heroTitle, ...compactHeroTitle }}>
                New Sale
              </h1>
              <p style={styles.heroSubtitle}>
                Record cash, MoMo, bank, mixed and credit sales for{" "}
                <strong>{currentStoreName}</strong>
                {currentStoreLocation ? ` - ${currentStoreLocation}` : ""}.
                Stock will reduce immediately after a successful receipt.
              </p>
            </div>

            <div style={{ ...styles.heroActions, ...compactHeroActions }}>
              <button type="button" style={styles.heroButton} onClick={loadProducts}>
                Refresh Products
              </button>

              <button type="button" style={styles.heroDangerButton} onClick={clearSale}>
                Clear Sale
              </button>
            </div>
          </div>

          <div style={{ ...styles.heroMetrics, ...oneColumn }}>
            <HeroMetric label="Cart Items : " value={cart.length} />
            <HeroMetric label="Subtotal : " value={formatCompactMoney(subtotal)} />
            <HeroMetric label="Amount Due : " value={formatCompactMoney(estimatedAmountDue)} />
            <HeroMetric label="Expected Balance : " value={formatCompactMoney(expectedBalance)} />
          </div>
        </div>
      </div>

      {message && <div className="success-box">{message}</div>}
      {error && <div className="error-box">{error}</div>}

      {lockedPeriod && (
        <AuditUnlockRequestBox
          lockedPeriod={lockedPeriod}
          requestArea="sale"
          requestedAction="Record sale inside locked accounting period"
          onRequestSent={() => {
            setMessage(
              "Unlock request sent successfully. Wait for admin or manager review."
            );
          }}
        />
      )}

      <div style={styles.storeNotice}>
        <span style={styles.noticeIcon}>🏬</span>
        <div>
          <strong>
            {currentStoreCode} — {currentStoreName}
          </strong>
          <p>
            This sale will reduce stock, create receipt records and create debts
            only inside this selected store.
          </p>
        </div>
      </div>

      <div style={{ ...styles.commandGrid, ...oneColumn }}>
        <div style={styles.commandCard}>
          <span>📦</span>
          <div>
            <strong>{products.length}</strong>
            <small>available product records</small>
          </div>
        </div>

        <div style={styles.commandCard}>
          <span>🚨</span>
          <div>
            <strong>{lowStockProducts.length}</strong>
            <small>low-stock item(s)</small>
          </div>
        </div>

        <div style={styles.commandCard}>
          <span>⛔</span>
          <div>
            <strong>{outOfStockProducts.length}</strong>
            <small>out-of-stock item(s)</small>
          </div>
        </div>

        <div style={styles.commandCard}>
          <span>✅</span>
          <div>
            <strong>{saleProgress}%</strong>
            <small>sale readiness</small>
          </div>
        </div>
      </div>

      <form onSubmit={completeSale}>
        <div style={{ ...styles.mainGrid, ...oneColumn }}>
          <section style={styles.panelLarge}>
            <div style={styles.panelHeader}>
              <div>
                <p style={styles.eyebrowDark}>Step 1</p>
                <h2 style={styles.panelTitle}>Find Product & Build Cart</h2>
                <p style={styles.panelSubtitle}>
                  Search by product name, barcode, category or excavator type.
                </p>
              </div>

              <span style={styles.goldBadge}>{currentStoreCode}</span>
            </div>

            <div style={{ ...styles.searchGrid, ...compactSearchGrid }}>
              <div>
                <label>Search Product</label>
                <input
                  type="text"
                  value={productSearch}
                  onChange={(event) => {
                    setProductSearch(event.target.value);
                    setSelectedProductId("");
                  }}
                  placeholder="Example: filter, CAT 320, barcode..."
                />
              </div>

              <div>
                <label>Quantity</label>
                <input
                  type="number"
                  min="1"
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                />
              </div>

              <button type="button" style={styles.addButton} onClick={addToCart}>
                Add to Sale
              </button>
            </div>

            {productSearch.trim() && !selectedProduct && (
              <div style={styles.searchResults}>
                {filteredProducts.length === 0 ? (
                  <div style={styles.emptyState}>
                    No matching product found in this selected store.
                  </div>
                ) : (
                  filteredProducts.map((product) => {
                    const inStock = Number(product.quantity) > 0;
                    const lowStock =
                      Number(product.quantity || 0) <=
                      Number(product.low_stock_threshold || 0);

                    return (
                      <div key={product.id} style={styles.productResult}>
                        <div>
                          <div style={styles.productTitleRow}>
                            <strong>{product.name}</strong>
                            {lowStock && (
                              <span style={styles.lowBadge}>
                                {inStock ? "Low Stock" : "Out"}
                              </span>
                            )}
                          </div>

                          <p>
                            GHS {formatMoney(product.selling_price)} • Stock:{" "}
                            {product.quantity}
                            {product.barcode ? ` • Barcode: ${product.barcode}` : ""}
                            {product.size ? ` • Type: ${product.size}` : ""}
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => selectProductForSale(product)}
                          disabled={!inStock}
                          style={{
                            ...styles.selectButton,
                            ...(inStock ? {} : styles.disabledButton),
                          }}
                        >
                          {inStock ? "Select" : "Out"}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {selectedProduct && (
              <div style={styles.selectedProduct}>
                <div>
                  <p style={styles.eyebrowDark}>Selected Product</p>
                  <h3>{selectedProduct.name}</h3>
                  <span>
                    GHS {formatMoney(selectedProduct.selling_price)} • Stock:{" "}
                    {selectedProduct.quantity}
                    {selectedProduct.barcode
                      ? ` • Barcode: ${selectedProduct.barcode}`
                      : ""}
                  </span>
                </div>

                <button
                  type="button"
                  className="secondary-button"
                  onClick={clearSelectedProduct}
                >
                  Change
                </button>
              </div>
            )}

            <div style={styles.cartHeader}>
              <div>
                <h2 style={styles.panelTitle}>Sale Items</h2>
                <p style={styles.panelSubtitle}>
                  Review quantities before completing the sale.
                </p>
              </div>

              <span style={styles.goldBadge}>{cart.length} item(s)</span>
            </div>

            {cart.length === 0 ? (
              <div style={styles.emptyCart}>
                <span>🛒</span>
                <strong>No items added yet.</strong>
                <p>Search and select a product, then add it to the sale.</p>
              </div>
            ) : (
              <div style={styles.cartList}>
                {cart.map((item) => {
                  const lineTotal =
                    Number(item.selling_price) * Number(item.quantity);
                  const serializedItem =
                    String(item.inventory_tracking_mode || "quantity").toLowerCase() === "serialized";
                  const unitIdsRequired =
                    serializedItem &&
                    String(item.inventory_traceability_state || "off").toLowerCase() === "enforced";

                  return (
                    <div key={item.id} style={styles.cartItem}>
                      <div>
                        <strong>{item.name}</strong>
                        <span>
                          GHS {formatMoney(item.selling_price)} each
                          {item.size ? ` • ${item.size}` : ""}
                        </span>
                      </div>

                      <div style={styles.cartQuantity}>
                        <label>Qty</label>
                        <input
                          type="number"
                          min="1"
                          value={item.quantity}
                          onChange={(event) =>
                            updateCartQuantity(item.id, event.target.value)
                          }
                        />
                      </div>

                      <div style={styles.cartAmount}>
                        <small>Total</small>
                        <strong>GHS {formatMoney(lineTotal)}</strong>
                      </div>

                      <button
                        type="button"
                        className="small-danger"
                        onClick={() => removeFromCart(item.id)}
                      >
                        Remove
                      </button>

                      {serializedItem ? (
                        <div style={{ gridColumn: "1 / -1" }}>
                          <InventoryUnitScanner
                            product={item}
                            requiredCount={item.quantity}
                            selectedUnitCodes={item.unit_ids || []}
                            required={unitIdsRequired}
                            onChange={(unitIds) =>
                              setCart((current) =>
                                current.map((cartItem) =>
                                  Number(cartItem.id) === Number(item.id)
                                    ? { ...cartItem, unit_ids: unitIds }
                                    : cartItem
                                )
                              )
                            }
                          />
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section style={styles.stickySide}>
            <div style={styles.panel}>
              <div style={styles.panelHeader}>
                <div>
                  <p style={styles.eyebrowDark}>Step 2</p>
                  <h2 style={styles.panelTitle}>Customer & Payment</h2>
                  <p style={styles.panelSubtitle}>
                    Credit, mixed and installment sales require customer details.
                  </p>
                </div>
              </div>

              <label>Customer Name</label>
              <input
                value={customerName}
                onChange={(event) => setCustomerName(event.target.value)}
                placeholder="Enter customer name"
              />

              <label>Customer Phone</label>
              <input
                value={customerPhone}
                onChange={(event) => setCustomerPhone(event.target.value)}
                placeholder="Enter customer phone"
              />

              <label>Customer Location</label>
              <input
                value={customerLocation}
                onChange={(event) => setCustomerLocation(event.target.value)}
                placeholder="Enter customer location"
              />

              <div className="returning-customer-card">
                <div className="returning-customer-header">
                  <div>
                    <p className="returning-customer-eyebrow">Returning Customer Search</p>
                    <strong>Search saved customers</strong>
                    <small>
                      Type at least 2 letters or digits. Select a result to fill the customer details above.
                    </small>
                  </div>

                  {selectedCustomer ? (
                    <button
                      type="button"
                      className="secondary-button returning-customer-clear"
                      onClick={useNewCustomer}
                    >
                      Clear & Enter New Customer
                    </button>
                  ) : null}
                </div>

                <label htmlFor="existing-customer-search">Search Existing Customer</label>
                <input
                  id="existing-customer-search"
                  value={customerSearch}
                  onChange={(event) => {
                    setCustomerSearch(event.target.value);
                    setSelectedCustomer(null);
                    setSelectedCustomerId("");
                  }}
                  placeholder="Search by name, phone or location"
                  autoComplete="off"
                />

                <div className="returning-customer-status" role="status" aria-live="polite">
                  {loadingCustomers ? "Searching saved customers…" : null}
                  {!loadingCustomers &&
                  customerSearch.trim().length > 0 &&
                  customerSearch.trim().length < 2
                    ? "Enter at least 2 letters or digits."
                    : null}
                  {!loadingCustomers &&
                  !selectedCustomer &&
                  customerSearch.trim().length >= 2 &&
                  customerMatches.length === 0
                    ? `No saved customer found for “${customerSearch.trim()}”. You can continue with the details above as a new customer.`
                    : null}
                </div>

                {customerMatches.length > 0 ? (
                  <div
                    className="returning-customer-results"
                    role="listbox"
                    aria-label="Saved customer matches"
                  >
                    {customerMatches.map((customer) => (
                      <button
                        key={customer.id}
                        type="button"
                        className="returning-customer-result"
                        onClick={() => selectSavedCustomer(customer)}
                        role="option"
                        aria-selected={String(selectedCustomerId) === String(customer.id)}
                      >
                        <strong>{customer.name}</strong>
                        <span>
                          {customer.phone || "No phone"}
                          {customer.location ? ` · ${customer.location}` : ""}
                        </span>
                        <small>
                          {Number(customer.purchase_count || 0)} previous purchase(s) · {formatCustomerHistoryDate(customer.last_purchase_at)}
                        </small>
                      </button>
                    ))}
                  </div>
                ) : null}

                {selectedCustomer ? (
                  <div className="returning-customer-selected">
                    <strong>Saved customer selected: {selectedCustomer.name}</strong>
                    <span>
                      Name, phone and location were copied into the customer fields above. Confirm or correct them before completing the sale.
                    </span>
                    <small>
                      {Number(selectedCustomer.purchase_count || 0)} previous purchase(s) · Total recorded GHS {formatMoney(selectedCustomer.total_spent)} · Outstanding GHS {formatMoney(selectedCustomer.outstanding_balance)}
                    </small>
                  </div>
                ) : null}
              </div>

              <label>Payment Type</label>
              <div style={styles.paymentTypeGrid}>
                {["cash", "momo", "bank", "credit", "mixed", "installment"].map((method) => (
                  <button
                    key={method}
                    type="button"
                    style={{
                      ...styles.paymentTypeButton,
                      ...(paymentType === method
                        ? styles.paymentTypeButtonActive
                        : {}),
                    }}
                    onClick={() => setPaymentType(method)}
                  >
                    {formatPaymentMethod(method)}
                  </button>
                ))}
              </div>

              <label>Discount Amount</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={discountAmount}
                onChange={(event) => setDiscountAmount(event.target.value)}
                placeholder="Enter discount amount"
              />

              {immediatePayment ? (
                <>
                  <label>Amount Tendered</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={amountPaid}
                    onChange={(event) => setAmountPaid(event.target.value)}
                    placeholder={`Amount due is GHS ${formatMoney(estimatedAmountDue)}`}
                  />

                  <div style={styles.quickMoneyRow}>
                    <button
                      type="button"
                      onClick={() => setAmountPaid(String(estimatedAmountDue))}
                    >
                      Exact
                    </button>

                    <button type="button" onClick={() => setAmountPaid("")}>
                      Clear
                    </button>
                  </div>
                </>
              ) : (
                <div style={{ marginTop: "12px" }}>
                  <label>Amount Paid Now — Payment Channel Split</label>
                  <p style={{ margin: "4px 0 10px", color: "#64748b", fontSize: "13px" }}>
                    Record exactly how the customer paid. The channel total must equal the amount paid now.
                  </p>
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: "10px" }}>
                    {[
                      ["cash", "Cash"],
                      ["momo", "MoMo"],
                      ["bank", "Bank"],
                      ["other", "Other / Unallocated"],
                    ].map(([channel, label]) => (
                      <label key={channel} style={{ display: "grid", gap: "4px" }}>
                        {label}
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={paymentAllocations[channel]}
                          onChange={(event) =>
                            setPaymentAllocations((current) => ({
                              ...current,
                              [channel]: event.target.value,
                            }))
                          }
                          placeholder="0.00"
                        />
                      </label>
                    ))}
                  </div>
                  <div style={{ marginTop: "10px", fontWeight: 800 }}>
                    Paid now: GHS {formatMoney(allocationTotal)}
                  </div>
                </div>
              )}

              {paymentType === "installment" ? (
                <div
                  style={{
                    marginTop: "16px",
                    padding: "16px",
                    borderRadius: "14px",
                    border: "1px solid #d6c084",
                    background: "#fffaf0",
                    display: "grid",
                    gap: "10px",
                  }}
                >
                  <div>
                    <strong>Installment Agreement</strong>
                    <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: "13px" }}>
                      The amount paid now becomes the deposit. The remaining balance is divided into a controlled payment schedule.
                    </p>
                  </div>

                  {installmentApprovalRequired ? (
                    <div
                      style={{
                        padding: "10px 12px",
                        borderRadius: "10px",
                        background: "#fff4d6",
                        border: "1px solid #e7bd55",
                        color: "#713f12",
                        fontWeight: 700,
                      }}
                    >
                      Manager approval is required before any deposit is collected.
                      Leave all payment channels at zero, save the agreement, then
                      collect the first payment from Installment Sales after approval.
                    </div>
                  ) : null}

                  <label>Payment Frequency</label>
                  <select
                    value={installmentPlan.frequency}
                    onChange={(event) =>
                      setInstallmentPlan((current) => ({
                        ...current,
                        frequency: event.target.value,
                      }))
                    }
                  >
                    <option value="weekly">Weekly</option>
                    <option value="fortnightly">Every Two Weeks</option>
                    <option value="monthly">Monthly</option>
                    <option value="custom">Custom Dates</option>
                  </select>

                  <label>Number of Payments</label>
                  <input
                    type="number"
                    min="1"
                    max="120"
                    value={installmentPlan.installment_count}
                    onChange={(event) =>
                      setInstallmentPlan((current) => ({
                        ...current,
                        installment_count: event.target.value,
                      }))
                    }
                  />

                  {installmentPlan.frequency === "custom" ? (
                    <>
                      <label>Custom Due Dates</label>
                      <textarea
                        rows="4"
                        value={installmentPlan.custom_due_dates_text}
                        onChange={(event) =>
                          setInstallmentPlan((current) => ({
                            ...current,
                            custom_due_dates_text: event.target.value,
                          }))
                        }
                        placeholder={"2026-08-01, 2026-08-15, 2026-09-01"}
                      />
                      <small>
                        Enter one YYYY-MM-DD date per payment, separated by commas or new lines.
                      </small>
                    </>
                  ) : null}

                  <label>First Payment Date</label>
                  <input
                    type="date"
                    value={installmentPlan.first_due_date}
                    onChange={(event) =>
                      setInstallmentPlan((current) => ({
                        ...current,
                        first_due_date: event.target.value,
                      }))
                    }
                  />

                  <label>Grace Days</label>
                  <input
                    type="number"
                    min="0"
                    max="60"
                    value={installmentPlan.grace_days}
                    onChange={(event) =>
                      setInstallmentPlan((current) => ({
                        ...current,
                        grace_days: event.target.value,
                      }))
                    }
                  />

                  <label>Item Delivery Policy</label>
                  <select
                    value={installmentPlan.delivery_policy}
                    onChange={(event) =>
                      setInstallmentPlan((current) => ({
                        ...current,
                        delivery_policy: event.target.value,
                      }))
                    }
                  >
                    <option value="immediate">Deliver immediately</option>
                    <option value="after_full_payment">
                      Reserve now, deliver after full payment
                    </option>
                  </select>

                  <label>Late Charge Policy</label>
                  <select
                    value={installmentPlan.late_charge_type}
                    onChange={(event) =>
                      setInstallmentPlan((current) => ({
                        ...current,
                        late_charge_type: event.target.value,
                      }))
                    }
                  >
                    <option value="none">No late charge</option>
                    <option value="fixed">Fixed amount after grace period</option>
                    <option value="percentage">Percentage after grace period</option>
                  </select>

                  {installmentPlan.late_charge_type !== "none" ? (
                    <>
                      <label>
                        Late Charge{" "}
                        {installmentPlan.late_charge_type === "percentage"
                          ? "Percentage"
                          : "Amount"}
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={installmentPlan.late_charge_value}
                        onChange={(event) =>
                          setInstallmentPlan((current) => ({
                            ...current,
                            late_charge_value: event.target.value,
                          }))
                        }
                      />
                    </>
                  ) : null}

                  <label>Guarantor Name (Optional)</label>
                  <input
                    value={installmentPlan.guarantor_name}
                    onChange={(event) =>
                      setInstallmentPlan((current) => ({
                        ...current,
                        guarantor_name: event.target.value,
                      }))
                    }
                    placeholder="Guarantor or reference person"
                  />

                  <label>Guarantor Phone (Optional)</label>
                  <input
                    value={installmentPlan.guarantor_phone}
                    onChange={(event) =>
                      setInstallmentPlan((current) => ({
                        ...current,
                        guarantor_phone: event.target.value,
                      }))
                    }
                    placeholder="0240000000"
                  />

                  <label>Agreement Notes</label>
                  <textarea
                    value={installmentPlan.notes}
                    onChange={(event) =>
                      setInstallmentPlan((current) => ({
                        ...current,
                        notes: event.target.value,
                      }))
                    }
                    rows="3"
                    placeholder="Special terms, collector instructions or customer notes"
                  />

                  <label
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "10px",
                      fontWeight: 700,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={installmentPlan.terms_accepted}
                      onChange={(event) =>
                        setInstallmentPlan((current) => ({
                          ...current,
                          terms_accepted: event.target.checked,
                        }))
                      }
                      style={{ width: "18px", height: "18px", marginTop: "2px" }}
                    />
                    Customer has reviewed and accepted the installment payment and delivery terms.
                  </label>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "10px",
                      padding: "12px",
                      borderRadius: "10px",
                      background: "#fff",
                    }}
                  >
                    <span>Deposit</span>
                    <strong style={{ textAlign: "right" }}>
                      GHS {formatMoney(liveAppliedPayment)}
                    </strong>
                    <span>Financed Balance</span>
                    <strong style={{ textAlign: "right" }}>
                      GHS {formatMoney(expectedBalance)}
                    </strong>
                    <span>Estimated Payment</span>
                    <strong style={{ textAlign: "right" }}>
                      GHS{" "}
                      {formatMoney(
                        expectedBalance /
                          Math.max(Number(installmentPlan.installment_count || 1), 1)
                      )}
                    </strong>
                  </div>
                </div>
              ) : null}
            </div>

            <div style={styles.totalPanel}>
              <p>Sale Total</p>

              <div style={styles.totalLine}>
                <span>Subtotal</span>
                <strong>GHS {formatMoney(subtotal)}</strong>
              </div>

              <div style={styles.totalLine}>
                <span>Discount</span>
                <strong>GHS {formatMoney(cleanDiscountAmount)}</strong>
              </div>

              <div style={styles.totalDue}>
                <span>Amount Due</span>
                <strong>GHS {formatMoney(estimatedAmountDue)}</strong>
              </div>

              <div style={styles.totalLine}>
                <span>Change Due</span>
                <strong>GHS {formatMoney(liveChangeDue)}</strong>
              </div>

              <div style={styles.totalLine}>
                <span>Expected Balance</span>
                <strong>GHS {formatMoney(expectedBalance)}</strong>
              </div>

              <div style={styles.progressTrack}>
                <div
                  style={{
                    ...styles.progressFill,
                    width: `${saleProgress}%`,
                  }}
                />
              </div>

              <button type="submit" style={styles.completeButton}>
                Complete Sale & Generate Receipt
              </button>
            </div>
          </section>
        </div>
      </form>

      {receipt && (
        <section style={styles.receiptPanel}>
          <div style={styles.receiptPreview}>
            <div style={styles.receiptCenter}>
              <h2>{getReceiptBusinessName(receipt)}</h2>
              <p>{getReceiptBusinessAddress(receipt)}</p>
              <p>Tel: {getReceiptBusinessPhone(receipt)}</p>
              <p>MOMO #: {getReceiptMomoNumber(receipt)}</p>
              <p>
                Store: {getReceiptStoreCode(receipt)} —{" "}
                {getReceiptStoreName(receipt)}
              </p>
            </div>

            <div style={{ ...styles.receiptInfoGrid, ...oneColumn }}>
              <p>
                <strong>Store:</strong> {getReceiptStoreCode(receipt)} —{" "}
                {getReceiptStoreName(receipt)}
              </p>

              <p>
                <strong>Customer:</strong> {getReceiptCustomerName(receipt)}
              </p>

              <p>
                <strong>Phone:</strong> {getReceiptCustomerPhone(receipt)}
              </p>

              <p>
                <strong>Date:</strong> {formatReceiptDate(receipt.created_at)}
              </p>

              <p>
                <strong>Time:</strong> {formatReceiptTime(receipt.created_at)}
              </p>

              <p>
                <strong>Receipt No.:</strong> {receipt.receipt_number}
              </p>

              <p>
                <strong>Payment Method:</strong>{" "}
                {formatPaymentMethod(receipt.payment_type)}
              </p>

              <p>
                <strong>Served by:</strong> {receipt.staff?.full_name || "-"}
              </p>
            </div>

            <div style={styles.tableWrap}>
              <table>
                <thead>
                  <tr>
                    <th>Item Description</th>
                    <th>Px</th>
                    <th>Qty</th>
                    <th>Amt</th>
                  </tr>
                </thead>

                <tbody>
                  {receipt.items.map((item) => (
                    <tr key={item.product_id}>
                      <td>{item.product_name}</td>
                      <td>GHS {formatMoney(item.unit_price)}</td>
                      <td>{item.quantity}</td>
                      <td>GHS {formatMoney(item.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={styles.receiptTotals}>
              <p>
                <span>Sub Total</span>
                <strong>GHS {formatMoney(receipt.subtotal)}</strong>
              </p>

              <p>
                <span>Discount</span>
                <strong>GHS {formatMoney(receipt.discount_amount)}</strong>
              </p>

              <p>
                <span>VAT</span>
                <strong>GHS {formatMoney(receipt.tax_amount)}</strong>
              </p>

              <p style={styles.receiptGrandTotal}>
                <span>Amount Due</span>
                <strong>GHS {formatMoney(receipt.total)}</strong>
              </p>

              <p>
                <span>Amount Tendered</span>
                <strong>GHS {formatMoney(receipt.amount_tendered)}</strong>
              </p>

              <p>
                <span>Amount Paid</span>
                <strong>GHS {formatMoney(receipt.amount_paid)}</strong>
              </p>

              <p>
                <span>Payment Channels</span>
                <strong>
                  Cash {formatMoney(receipt.payment_allocations?.cash)} · MoMo {formatMoney(receipt.payment_allocations?.momo)} · Bank {formatMoney(receipt.payment_allocations?.bank)} · Other {formatMoney(receipt.payment_allocations?.other)}
                </strong>
              </p>

              <p>
                <span>Change Due</span>
                <strong>GHS {formatMoney(receipt.change_due)}</strong>
              </p>

              <p>
                <span>Balance Outstanding</span>
                <strong>GHS {formatMoney(receipt.balance)}</strong>
              </p>
            </div>

            {receipt.debt && (
              <div className="warning-box">
                Debt created: GHS {formatMoney(receipt.debt.balance)} —{" "}
                {receipt.debt.status}
              </div>
            )}

            <div style={styles.receiptCenter}>
              <h3>{receiptFooter}</h3>
              <p>
                <strong>{policyText}</strong>
              </p>
            </div>

            <div style={{ ...styles.receiptActions, ...compactReceiptActions }}>
              <button type="button" onClick={printReceipt}>
                Print Receipt
              </button>

              <button
                type="button"
                className="secondary-button"
                onClick={downloadReceiptPdf}
              >
                Download PDF
              </button>

              <button
                type="button"
                className="secondary-button"
                onClick={sendReceiptSms}
                disabled={sendingReceiptSms}
              >
                {sendingReceiptSms ? "Sending SMS..." : "Send SMS Receipt"}
              </button>

              <button
                type="button"
                onClick={sendReceiptWhatsApp}
                style={{
                  background: "#16a34a",
                  color: "#ffffff",
                  border: "none",
                }}
              >
                Send WhatsApp Message
              </button>
            </div>

            <div style={styles.whatsAppHelp}>
              To send the PDF receipt on WhatsApp, first click{" "}
              <strong>Download PDF</strong>, then click{" "}
              <strong>Send WhatsApp Message</strong>, and attach the downloaded
              PDF manually inside WhatsApp before sending.
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function HeroMetric({ label, value }) {
  return (
    <div style={styles.heroMetric}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

const styles = {
  page: {
    width: "100%",
    maxWidth: "1680px",
    margin: "0 auto",
    paddingBottom: "42px",
  },

  pageMobile: {
    paddingBottom: "24px",
  },

  oneColumn: {
    gridTemplateColumns: "1fr",
  },

  hero: {
    position: "relative",
    overflow: "hidden",
    borderRadius: "28px",
    padding: "26px",
    marginBottom: "18px",
    background:
      "linear-gradient(135deg, #07182c 0%, #0d2f55 48%, #111827 100%)",
    color: "#ffffff",
    boxShadow: "0 24px 60px rgba(7, 24, 44, 0.26)",
  },

  heroMobile: {
    padding: "18px 14px",
    borderRadius: "20px",
  },

  heroGlowOne: {
    position: "absolute",
    width: "260px",
    height: "260px",
    right: "-90px",
    top: "-90px",
    borderRadius: "50%",
    background: "rgba(224, 186, 40, 0.30)",
    filter: "blur(18px)",
  },

  heroGlowTwo: {
    position: "absolute",
    width: "180px",
    height: "180px",
    left: "35%",
    bottom: "-110px",
    borderRadius: "50%",
    background: "rgba(37, 99, 235, 0.34)",
    filter: "blur(18px)",
  },

  heroContent: {
    position: "relative",
    zIndex: 2,
  },

  heroTop: {
    display: "flex",
    justifyContent: "space-between",
    gap: "18px",
    alignItems: "flex-start",
    flexWrap: "wrap",
  },

  heroActions: {
    display: "flex",
    gap: "10px",
    flexWrap: "wrap",
  },

  heroActionsMobile: {
    display: "grid",
    gridTemplateColumns: "1fr",
    width: "100%",
  },

  heroButton: {
    border: "1px solid rgba(224, 186, 40, 0.62)",
    background: "rgba(224, 186, 40, 0.16)",
    color: "#ffffff",
    borderRadius: "14px",
    padding: "11px 14px",
    fontWeight: "950",
    cursor: "pointer",
  },

  heroDangerButton: {
    border: "1px solid rgba(254, 202, 202, 0.42)",
    background: "rgba(185, 28, 28, 0.72)",
    color: "#ffffff",
    borderRadius: "14px",
    padding: "11px 14px",
    fontWeight: "950",
    cursor: "pointer",
  },

  eyebrow: {
    margin: 0,
    color: "#e0ba28",
    fontWeight: "950",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    fontSize: "12px",
  },

  eyebrowDark: {
    margin: 0,
    color: "#b45309",
    fontWeight: "950",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    fontSize: "11px",
  },

  heroTitle: {
    margin: "6px 0 0",
    fontSize: "clamp(30px, 4vw, 50px)",
    lineHeight: 1.03,
    fontWeight: "950",
  },

  heroTitleMobile: {
    fontSize: "30px",
  },

  heroSubtitle: {
    margin: "10px 0 0",
    maxWidth: "820px",
    color: "rgba(255,255,255,0.78)",
    fontSize: "15px",
    lineHeight: 1.6,
  },

  heroMetrics: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
    gap: "12px",
    marginTop: "22px",
  },

  heroMetric: {
    padding: "14px",
    borderRadius: "18px",
    background: "rgba(255,255,255,0.10)",
    border: "1px solid rgba(255,255,255,0.15)",
  },

  storeNotice: {
    display: "flex",
    gap: "12px",
    alignItems: "flex-start",
    marginBottom: "18px",
    padding: "14px 16px",
    borderRadius: "18px",
    background: "linear-gradient(135deg, #eff6ff, #ffffff)",
    border: "1px solid #bfdbfe",
    color: "#1e3a8a",
    boxShadow: "0 12px 30px rgba(15, 23, 42, 0.06)",
  },

  noticeIcon: {
    fontSize: "22px",
  },

  commandGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: "12px",
    marginBottom: "18px",
  },

  commandCard: {
    display: "flex",
    gap: "12px",
    alignItems: "center",
    background: "#ffffff",
    borderRadius: "18px",
    padding: "14px",
    border: "1px solid #e2e8f0",
    boxShadow: "0 14px 34px rgba(15, 23, 42, 0.07)",
    minWidth: 0,
  },

  mainGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.45fr) minmax(340px, 0.75fr)",
    gap: "18px",
    alignItems: "start",
  },

  panelLarge: {
    background: "#ffffff",
    borderRadius: "24px",
    padding: "20px",
    border: "1px solid rgba(226, 232, 240, 0.95)",
    boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
    minWidth: 0,
  },

  panel: {
    background: "#ffffff",
    borderRadius: "24px",
    padding: "20px",
    border: "1px solid rgba(226, 232, 240, 0.95)",
    boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
    minWidth: 0,
  },

  stickySide: {
    display: "grid",
    gap: "18px",
    position: "sticky",
    top: "18px",
  },

  panelHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    alignItems: "flex-start",
    flexWrap: "wrap",
    marginBottom: "16px",
  },

  panelTitle: {
    margin: "4px 0 0",
    color: "#0f172a",
    fontSize: "22px",
    fontWeight: "950",
  },

  panelSubtitle: {
    margin: "5px 0 0",
    color: "#64748b",
    fontSize: "13px",
    lineHeight: 1.5,
  },

  goldBadge: {
    display: "inline-flex",
    alignItems: "center",
    borderRadius: "999px",
    padding: "7px 11px",
    background: "#fef3c7",
    color: "#92400e",
    fontWeight: "950",
    fontSize: "12px",
    whiteSpace: "nowrap",
  },

  searchGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 110px auto",
    gap: "12px",
    alignItems: "end",
  },

  searchGridMobile: {
    gridTemplateColumns: "1fr",
  },

  addButton: {
    border: "none",
    borderRadius: "14px",
    padding: "11px 14px",
    background: "#e0ba28",
    color: "#07182c",
    fontWeight: "950",
    cursor: "pointer",
    minHeight: "42px",
  },

  searchResults: {
    marginTop: "14px",
    marginBottom: "16px",
    border: "1px solid #dbe3ef",
    borderRadius: "18px",
    overflow: "hidden",
    background: "#ffffff",
  },

  productResult: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: "12px",
    alignItems: "center",
    padding: "13px",
    borderBottom: "1px solid #edf1f5",
  },

  productTitleRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexWrap: "wrap",
  },

  lowBadge: {
    borderRadius: "999px",
    padding: "5px 8px",
    background: "#fee2e2",
    color: "#991b1b",
    fontSize: "11px",
    fontWeight: "950",
  },

  selectButton: {
    border: "none",
    borderRadius: "12px",
    padding: "9px 12px",
    fontWeight: "900",
    cursor: "pointer",
    background: "#2563eb",
    color: "#ffffff",
  },

  disabledButton: {
    background: "#cbd5e1",
    cursor: "not-allowed",
  },

  selectedProduct: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    alignItems: "center",
    marginTop: "14px",
    marginBottom: "16px",
    padding: "14px",
    borderRadius: "18px",
    background: "linear-gradient(135deg, #ecfdf3, #ffffff)",
    border: "1px solid #bbf7d0",
    color: "#14532d",
    flexWrap: "wrap",
  },

  cartHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    alignItems: "flex-start",
    flexWrap: "wrap",
    marginTop: "20px",
    marginBottom: "14px",
  },

  emptyCart: {
    display: "grid",
    placeItems: "center",
    textAlign: "center",
    padding: "28px",
    borderRadius: "20px",
    background: "#f8fafc",
    border: "1px dashed #cbd5e1",
    color: "#64748b",
  },

  cartList: {
    display: "grid",
    gap: "10px",
  },

  cartItem: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 92px auto auto",
    gap: "12px",
    alignItems: "center",
    padding: "13px",
    borderRadius: "18px",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
  },

  cartQuantity: {
    display: "grid",
    gap: "4px",
  },

  cartAmount: {
    display: "grid",
    textAlign: "right",
    color: "#0f172a",
  },

  paymentTypeGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: "8px",
    marginBottom: "12px",
  },

  paymentTypeButton: {
    border: "1px solid #dbe3ef",
    borderRadius: "13px",
    background: "#ffffff",
    color: "#0f172a",
    padding: "10px",
    fontWeight: "900",
    cursor: "pointer",
  },

  paymentTypeButtonActive: {
    background: "#07182c",
    color: "#e0ba28",
    borderColor: "#07182c",
  },

  quickMoneyRow: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
    marginBottom: "4px",
  },

  totalPanel: {
    borderRadius: "24px",
    padding: "20px",
    background:
      "linear-gradient(135deg, #07182c 0%, #0d2f55 58%, #111827 100%)",
    color: "#ffffff",
    boxShadow: "0 20px 50px rgba(7, 24, 44, 0.25)",
  },

  totalLine: {
    display: "flex",
    justifyContent: "space-between",
    gap: "10px",
    padding: "9px 0",
    borderBottom: "1px solid rgba(255,255,255,0.12)",
  },

  totalDue: {
    display: "flex",
    justifyContent: "space-between",
    gap: "10px",
    margin: "12px 0",
    padding: "14px",
    borderRadius: "16px",
    background: "rgba(224, 186, 40, 0.16)",
    color: "#ffffff",
    fontSize: "18px",
  },

  progressTrack: {
    height: "12px",
    borderRadius: "999px",
    background: "rgba(255,255,255,0.16)",
    overflow: "hidden",
    marginTop: "14px",
  },

  progressFill: {
    height: "100%",
    borderRadius: "999px",
    background: "linear-gradient(90deg, #e0ba28, #22c55e)",
  },

  completeButton: {
    width: "100%",
    marginTop: "16px",
    border: "none",
    borderRadius: "16px",
    padding: "14px 16px",
    background: "#e0ba28",
    color: "#07182c",
    fontWeight: "950",
    cursor: "pointer",
    boxShadow: "0 12px 28px rgba(224, 186, 40, 0.22)",
  },

  receiptPanel: {
    marginTop: "20px",
    background: "#ffffff",
    borderRadius: "24px",
    padding: "20px",
    border: "1px solid rgba(226, 232, 240, 0.95)",
    boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
    maxWidth: "920px",
  },

  receiptPreview: {
    border: "1px solid #e5e7eb",
    borderRadius: "18px",
    padding: "20px",
  },

  receiptCenter: {
    textAlign: "center",
    borderBottom: "2px solid #07182c",
    paddingBottom: "14px",
    marginBottom: "16px",
  },

  receiptInfoGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "8px 20px",
    marginBottom: "16px",
  },

  tableWrap: {
    width: "100%",
    overflowX: "auto",
  },

  receiptTotals: {
    maxWidth: "360px",
    marginLeft: "auto",
    marginTop: "16px",
  },

  receiptGrandTotal: {
    borderTop: "2px solid #07182c",
    fontSize: "18px",
  },

  receiptActions: {
    marginTop: "18px",
    display: "flex",
    justifyContent: "flex-end",
    gap: "10px",
    flexWrap: "wrap",
  },

  receiptActionsMobile: {
    display: "grid",
    gridTemplateColumns: "1fr",
  },

  whatsAppHelp: {
    marginTop: "12px",
    padding: "12px",
    borderRadius: "12px",
    background: "#ecfdf3",
    border: "1px solid #bbf7d0",
    color: "#14532d",
    fontWeight: "700",
  },

  emptyState: {
    padding: "16px",
    color: "#64748b",
    fontWeight: "800",
    textAlign: "center",
  },
};
