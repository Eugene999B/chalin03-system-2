import { useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";

function MobilePageFix() {
  return (
    <style>{`
      @media (max-width: 820px) {
        .boss-mobile-fix {
          width: 100% !important;
          max-width: 100% !important;
          min-width: 0 !important;
          overflow-x: hidden !important;
          padding: 10px !important;
          margin: 0 !important;
        }

        .boss-mobile-fix,
        .boss-mobile-fix * {
          box-sizing: border-box !important;
        }

        .boss-mobile-fix * {
          max-width: 100% !important;
        }

        .boss-mobile-fix section,
        .boss-mobile-fix article,
        .boss-mobile-fix form,
        .boss-mobile-fix header,
        .boss-mobile-fix main,
        .boss-mobile-fix aside {
          width: 100% !important;
          max-width: 100% !important;
          min-width: 0 !important;
        }

        .boss-mobile-fix [style*="display: grid"],
        .boss-mobile-fix [style*="grid-template-columns"] {
          grid-template-columns: minmax(0, 1fr) !important;
        }

        .boss-mobile-fix [style*="display: flex"] {
          flex-wrap: wrap !important;
        }

        .boss-mobile-fix [style*="justify-content: space-between"] {
          justify-content: flex-start !important;
        }

        .boss-mobile-fix [style*="align-items: center"] {
          min-width: 0 !important;
        }

        .boss-mobile-fix [style*="width:"],
        .boss-mobile-fix [style*="min-width"],
        .boss-mobile-fix [style*="max-width"] {
          min-width: 0 !important;
        }

        .boss-mobile-fix [style*="width: 420"],
        .boss-mobile-fix [style*="width: 360"],
        .boss-mobile-fix [style*="width: 340"],
        .boss-mobile-fix [style*="width: 320"],
        .boss-mobile-fix [style*="width: 300"],
        .boss-mobile-fix [style*="width: 280"],
        .boss-mobile-fix [style*="width: 260"],
        .boss-mobile-fix [style*="width: 240"],
        .boss-mobile-fix [style*="min-width: 420"],
        .boss-mobile-fix [style*="min-width: 360"],
        .boss-mobile-fix [style*="min-width: 340"],
        .boss-mobile-fix [style*="min-width: 320"],
        .boss-mobile-fix [style*="min-width: 300"],
        .boss-mobile-fix [style*="min-width: 280"],
        .boss-mobile-fix [style*="min-width: 260"],
        .boss-mobile-fix [style*="min-width: 240"] {
          width: 100% !important;
          min-width: 0 !important;
        }

        .boss-mobile-fix [style*="padding: 34"],
        .boss-mobile-fix [style*="padding: 32"],
        .boss-mobile-fix [style*="padding: 30"],
        .boss-mobile-fix [style*="padding: 28"],
        .boss-mobile-fix [style*="padding: 26"],
        .boss-mobile-fix [style*="padding: 24"],
        .boss-mobile-fix [style*="padding: 22"],
        .boss-mobile-fix [style*="padding: 20"] {
          padding: 16px !important;
        }

        .boss-mobile-fix [style*="border-radius: 40"],
        .boss-mobile-fix [style*="border-radius: 36"],
        .boss-mobile-fix [style*="border-radius: 34"],
        .boss-mobile-fix [style*="border-radius: 32"],
        .boss-mobile-fix [style*="border-radius: 30"],
        .boss-mobile-fix [style*="border-radius: 28"] {
          border-radius: 22px !important;
        }

        .boss-mobile-fix h1,
        .boss-mobile-fix [style*="font-size: 56"],
        .boss-mobile-fix [style*="font-size: 54"],
        .boss-mobile-fix [style*="font-size: 52"],
        .boss-mobile-fix [style*="font-size: 50"],
        .boss-mobile-fix [style*="font-size: 48"],
        .boss-mobile-fix [style*="font-size: 46"],
        .boss-mobile-fix [style*="font-size: 44"],
        .boss-mobile-fix [style*="font-size: 42"],
        .boss-mobile-fix [style*="font-size: 40"] {
          font-size: 31px !important;
          line-height: 1.06 !important;
          letter-spacing: -0.04em !important;
        }

        .boss-mobile-fix h2,
        .boss-mobile-fix [style*="font-size: 32"],
        .boss-mobile-fix [style*="font-size: 30"],
        .boss-mobile-fix [style*="font-size: 28"] {
          font-size: 21px !important;
          line-height: 1.15 !important;
        }

        .boss-mobile-fix h3,
        .boss-mobile-fix [style*="font-size: 24"],
        .boss-mobile-fix [style*="font-size: 22"] {
          font-size: 18px !important;
          line-height: 1.2 !important;
        }

        .boss-mobile-fix p,
        .boss-mobile-fix span,
        .boss-mobile-fix small,
        .boss-mobile-fix strong,
        .boss-mobile-fix label,
        .boss-mobile-fix td,
        .boss-mobile-fix th {
          overflow-wrap: anywhere !important;
          word-break: normal !important;
        }

        .boss-mobile-fix input,
        .boss-mobile-fix select,
        .boss-mobile-fix textarea {
          width: 100% !important;
          max-width: 100% !important;
          min-width: 0 !important;
          font-size: 16px !important;
        }

        .boss-mobile-fix input.restock-cost-checkbox {
          width: 18px !important;
          min-width: 18px !important;
          max-width: 18px !important;
          flex: 0 0 18px !important;
          min-height: 18px !important;
        }

        .boss-mobile-fix button {
          max-width: 100% !important;
          white-space: normal !important;
          overflow-wrap: anywhere !important;
        }

        .boss-mobile-fix table {
          width: 100% !important;
          min-width: 760px !important;
        }

        .boss-mobile-fix [style*="overflow-x: auto"],
        .boss-mobile-fix [style*="overflow: auto"],
        .boss-mobile-fix [style*="overflowX"] {
          width: 100% !important;
          max-width: 100% !important;
          overflow-x: auto !important;
          -webkit-overflow-scrolling: touch !important;
        }

        .boss-mobile-fix [style*="position: absolute"] {
          pointer-events: none !important;
        }
      }

      @media (max-width: 480px) {
        .boss-mobile-fix {
          padding: 8px !important;
        }

        .boss-mobile-fix [style*="gap: 24"],
        .boss-mobile-fix [style*="gap: 22"],
        .boss-mobile-fix [style*="gap: 20"],
        .boss-mobile-fix [style*="gap: 18"] {
          gap: 12px !important;
        }

        .boss-mobile-fix [style*="padding: 18"],
        .boss-mobile-fix [style*="padding: 16"] {
          padding: 13px !important;
        }

        .boss-mobile-fix h1 {
          font-size: 29px !important;
        }

        .boss-mobile-fix table {
          min-width: 720px !important;
        }
      }
    `}</style>
  );
}


const emptyForm = {
  name: "",
  size: "",
  category: "",
  cost_price: "",
  selling_price: "",
  quantity: "",
  low_stock_threshold: 5,
  barcode: "",
  image_url: "",
};

export default function ProductsPage() {
  const { user, branchId, branchCode, branchName, branchLocation } = useAuth();
  const role = String(user?.role || "").toLowerCase();

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

  const canAddOrEdit = role === "admin" || role === "manager";
  const canDelete = role === "admin";

  const [products, setProducts] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState("");

  const [isEditing, setIsEditing] = useState(false);
  const [editingProductId, setEditingProductId] = useState(null);

  const [restockProduct, setRestockProduct] = useState(null);
  const [restockQuantity, setRestockQuantity] = useState("");
  const [restockSource, setRestockSource] = useState("");
  const [restockReference, setRestockReference] = useState("");
  const [restockUnitCost, setRestockUnitCost] = useState("");
  const [restockDate, setRestockDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [restockNotes, setRestockNotes] = useState("");
  const [restockUpdateCost, setRestockUpdateCost] = useState(false);
  const [restockSaving, setRestockSaving] = useState(false);

  const [stockProduct, setStockProduct] = useState(null);
  const [stockAdjustmentType, setStockAdjustmentType] = useState("increase");
  const [stockMovementType, setStockMovementType] = useState("correction_increase");
  const [stockAdjustmentQuantity, setStockAdjustmentQuantity] = useState("");
  const [stockAdjustmentReason, setStockAdjustmentReason] = useState("");
  const [stockAdjustmentReference, setStockAdjustmentReference] = useState("");
  const [stockAdjustmentDate, setStockAdjustmentDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [stockAdjustmentNotes, setStockAdjustmentNotes] = useState("");
  const [stockAdjustments, setStockAdjustments] = useState([]);
  const [stockHistoryLoading, setStockHistoryLoading] = useState(false);
  const [stockSaving, setStockSaving] = useState(false);

  const [ledgerProduct, setLedgerProduct] = useState(null);
  const [stockLedger, setStockLedger] = useState([]);
  const [stockLedgerSummary, setStockLedgerSummary] = useState(null);
  const [stockLedgerWarnings, setStockLedgerWarnings] = useState([]);
  const [stockLedgerLoading, setStockLedgerLoading] = useState(false);

  const [recentAdjustments, setRecentAdjustments] = useState([]);
  const [recentAdjustmentsLoading, setRecentAdjustmentsLoading] =
    useState(false);

  const [productsLoading, setProductsLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function formatMoney(value) {
    return `GHS ${Number(value || 0).toLocaleString("en-GH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  function formatCompactMoney(value) {
    const number = Number(value || 0);

    if (number >= 1000000) {
      return `GHS ${(number / 1000000).toFixed(1)}M`;
    }

    if (number >= 1000) {
      return `GHS ${(number / 1000).toFixed(1)}K`;
    }

    return formatMoney(number);
  }

  function formatDateTime(value) {
    if (!value) return "-";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "-";
    }

    return date.toLocaleString("en-GB");
  }

  function formatAdjustmentType(value) {
    const types = {
      increase: "Increase",
      decrease: "Decrease",
      set: "Set Stock",
    };

    return types[String(value || "").toLowerCase()] || value || "-";
  }

  function formatMovementType(value, adjustmentType = "") {
    const types = {
      quick_restock: "Receive / Restock",
      correction_increase: "Correction Increase",
      correction_decrease: "Correction Decrease",
      damaged: "Damaged Stock",
      lost_missing: "Lost / Missing Stock",
      physical_count: "Physical Count",
      opening_balance: "Opening Balance",
      other: "Other Stock Movement",
    };

    return (
      types[String(value || "").toLowerCase()] ||
      formatAdjustmentType(adjustmentType)
    );
  }

  function getMovementOptions(adjustmentType) {
    if (adjustmentType === "increase") {
      return [
        ["correction_increase", "Correction Increase"],
        ["other", "Other Authorized Increase"],
      ];
    }

    if (adjustmentType === "decrease") {
      return [
        ["correction_decrease", "Correction Decrease"],
        ["damaged", "Damaged Stock"],
        ["lost_missing", "Lost / Missing Stock"],
        ["other", "Other Authorized Decrease"],
      ];
    }

    return [
      ["physical_count", "Authorized Physical Count"],
      ["other", "Other Exact Stock Update"],
    ];
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString("en-GH");
  }

  function formatChangeQuantity(value) {
    const number = Number(value || 0);

    if (number > 0) {
      return `+${formatNumber(number)}`;
    }

    return formatNumber(number);
  }

  function getChangeStyle(value) {
    const number = Number(value || 0);

    if (number > 0) {
      return {
        fontWeight: "950",
        color: "#047857",
      };
    }

    if (number < 0) {
      return {
        fontWeight: "950",
        color: "#b91c1c",
      };
    }

    return {
      fontWeight: "950",
      color: "#334155",
    };
  }

  function getProductStockStatus(product) {
    const quantity = Number(product.quantity || 0);
    const lowStockLevel = Number(product.low_stock_threshold || 0);

    if (quantity <= 0) {
      return {
        label: "Out of Stock",
        tone: "danger",
        style: styles.statusDanger,
      };
    }

    if (quantity <= lowStockLevel) {
      return {
        label: "Low Stock",
        tone: "warning",
        style: styles.statusWarning,
      };
    }

    return {
      label: "Healthy",
      tone: "success",
      style: styles.statusSuccess,
    };
  }

  function getProfitPerUnit(product) {
    return Number(product.selling_price || 0) - Number(product.cost_price || 0);
  }

  function getProfitMarginPercent(product) {
    const selling = Number(product.selling_price || 0);

    if (selling <= 0) return 0;

    return Math.round((getProfitPerUnit(product) / selling) * 100);
  }

  function calculateExpectedStock() {
    if (!stockProduct) return 0;

    const currentStock = Number(stockProduct.quantity || 0);
    const adjustmentQuantity = Number(stockAdjustmentQuantity || 0);

    if (Number.isNaN(adjustmentQuantity)) {
      return currentStock;
    }

    if (stockAdjustmentType === "increase") {
      return currentStock + adjustmentQuantity;
    }

    if (stockAdjustmentType === "decrease") {
      return Math.max(currentStock - adjustmentQuantity, 0);
    }

    if (stockAdjustmentType === "set") {
      return Math.max(adjustmentQuantity, 0);
    }

    return currentStock;
  }

  async function loadProducts() {
    setError("");
    setMessage("");
    setProductsLoading(true);

    try {
      const response = await axiosClient.get("/products", {
        params: {
          search,
        },
      });

      setProducts(response.data.products || []);
    } catch (error) {
      setError(error.response?.data?.message || "Failed to load products.");
    } finally {
      setProductsLoading(false);
    }
  }

  async function loadRecentStockAdjustments() {
    if (!canAddOrEdit) {
      setRecentAdjustments([]);
      return;
    }

    setRecentAdjustmentsLoading(true);

    try {
      const response = await axiosClient.get(
        "/products/stock-adjustments/recent",
        {
          params: {
            limit: 50,
          },
        }
      );

      setRecentAdjustments(response.data.adjustments || []);
    } catch (error) {
      setError(
        error.response?.data?.message ||
          "Failed to load recent stock adjustment records."
      );
    } finally {
      setRecentAdjustmentsLoading(false);
    }
  }

  async function refreshPageData() {
    await loadProducts();

    if (canAddOrEdit) {
      await loadRecentStockAdjustments();
    }
  }

  useEffect(() => {
    refreshPageData();
    // Reload products and recent stock adjustments when the selected store changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  function handleChange(event) {
    setForm({
      ...form,
      [event.target.name]: event.target.value,
    });
  }

  function startEdit(product) {
    setMessage("");
    setError("");

    setIsEditing(true);
    setEditingProductId(product.id);

    setForm({
      name: product.name || "",
      size: product.size || "",
      category: product.category || "",
      cost_price: product.cost_price || "",
      selling_price: product.selling_price || "",
      quantity: product.quantity || "",
      low_stock_threshold: product.low_stock_threshold || 5,
      barcode: product.barcode || "",
      image_url: product.image_url || "",
    });

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  function cancelEdit() {
    setIsEditing(false);
    setEditingProductId(null);
    setForm(emptyForm);
    setMessage("");
    setError("");
  }

  async function deleteProduct(productId, productName) {
    const confirmed = window.confirm(
      `Are you sure you want to delete/disable "${productName}"?`
    );

    if (!confirmed) return;

    setMessage("");
    setError("");

    try {
      const response = await axiosClient.delete(`/products/${productId}`);

      setProducts((currentProducts) =>
        currentProducts.filter(
          (product) => Number(product.id) !== Number(productId)
        )
      );

      if (editingProductId && Number(editingProductId) === Number(productId)) {
        cancelEdit();
      }

      if (stockProduct && Number(stockProduct.id) === Number(productId)) {
        closeStockAdjustment();
      }

      if (ledgerProduct && Number(ledgerProduct.id) === Number(productId)) {
        closeStockLedger();
      }

      setMessage(response.data.message || "Product deleted successfully.");

      if (canAddOrEdit) {
        await loadRecentStockAdjustments();
      }
    } catch (error) {
      setError(error.response?.data?.message || "Failed to delete product.");
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();

    setMessage("");
    setError("");

    const productData = {
      ...form,
      cost_price: Number(form.cost_price),
      selling_price: Number(form.selling_price),
      low_stock_threshold: Number(form.low_stock_threshold),
    };

    if (!isEditing) {
      productData.quantity = Number(form.quantity || 0);
    } else {
      delete productData.quantity;
    }

    try {
      if (isEditing) {
        const response = await axiosClient.put(
          `/products/${editingProductId}`,
          productData
        );
        setMessage(
          response.data.message ||
            "Product details updated successfully. Stock was not changed."
        );
      } else {
        await axiosClient.post("/products", productData);
        setMessage("Product added successfully.");
      }

      setForm(emptyForm);
      setIsEditing(false);
      setEditingProductId(null);
      await refreshPageData();
    } catch (error) {
      setError(
        error.response?.data?.message ||
          (isEditing ? "Failed to update product." : "Failed to add product.")
      );
    }
  }

  function openRestock(product) {
    setMessage("");
    setError("");
    setRestockProduct(product);
    setRestockQuantity("");
    setRestockSource("");
    setRestockReference("");
    setRestockUnitCost(product.cost_price || "");
    setRestockDate(new Date().toISOString().slice(0, 10));
    setRestockNotes("");
    setRestockUpdateCost(false);
  }

  function closeRestock() {
    setRestockProduct(null);
    setRestockQuantity("");
    setRestockSource("");
    setRestockReference("");
    setRestockUnitCost("");
    setRestockDate(new Date().toISOString().slice(0, 10));
    setRestockNotes("");
    setRestockUpdateCost(false);
    setRestockSaving(false);
  }

  async function saveRestock(event) {
    event.preventDefault();

    if (!restockProduct) return;

    setMessage("");
    setError("");

    const quantity = Number(restockQuantity);

    if (!Number.isInteger(quantity) || quantity <= 0) {
      setError("Restock quantity must be a whole number greater than zero.");
      return;
    }

    if (!restockSource.trim()) {
      setError("Supplier or stock source is required.");
      return;
    }

    if (!restockDate) {
      setError("Date received is required.");
      return;
    }

    setRestockSaving(true);

    try {
      const response = await axiosClient.post(
        `/products/${restockProduct.id}/restock`,
        {
          quantity,
          source_name: restockSource.trim(),
          reference_number: restockReference.trim(),
          unit_cost:
            restockUnitCost === "" ? null : Number(restockUnitCost),
          movement_date: restockDate,
          notes: restockNotes.trim(),
          update_cost_price: restockUpdateCost,
        }
      );

      setMessage(
        response.data.message || "Stock received and recorded successfully."
      );
      closeRestock();
      await refreshPageData();
    } catch (error) {
      setError(error.response?.data?.message || "Failed to receive stock.");
    } finally {
      setRestockSaving(false);
    }
  }

  async function openStockAdjustment(product) {
    setMessage("");
    setError("");
    setStockProduct(product);
    setStockAdjustmentType("increase");
    setStockMovementType("correction_increase");
    setStockAdjustmentQuantity("");
    setStockAdjustmentReason("");
    setStockAdjustmentReference("");
    setStockAdjustmentDate(new Date().toISOString().slice(0, 10));
    setStockAdjustmentNotes("");
    setStockAdjustments([]);
    setStockHistoryLoading(true);

    try {
      const response = await axiosClient.get(
        `/products/${product.id}/stock-adjustments`
      );

      setStockAdjustments(response.data.adjustments || []);
    } catch (error) {
      setError(error.response?.data?.message || "Failed to load stock history.");
    } finally {
      setStockHistoryLoading(false);
    }
  }

  function closeStockAdjustment() {
    setStockProduct(null);
    setStockAdjustmentType("increase");
    setStockMovementType("correction_increase");
    setStockAdjustmentQuantity("");
    setStockAdjustmentReason("");
    setStockAdjustmentReference("");
    setStockAdjustmentDate(new Date().toISOString().slice(0, 10));
    setStockAdjustmentNotes("");
    setStockAdjustments([]);
    setStockHistoryLoading(false);
    setStockSaving(false);
  }

  async function openStockLedger(product) {
    setMessage("");
    setError("");
    setLedgerProduct(product);
    setStockLedger([]);
    setStockLedgerSummary(null);
    setStockLedgerWarnings([]);
    setStockLedgerLoading(true);

    try {
      const response = await axiosClient.get(
        `/products/${product.id}/stock-ledger`
      );

      setLedgerProduct(response.data.product || product);
      setStockLedger(response.data.ledger || []);
      setStockLedgerSummary(response.data.summary || null);
      setStockLedgerWarnings(response.data.warnings || []);
    } catch (error) {
      setError(
        error.response?.data?.message ||
          "Failed to load stock movement ledger. Make sure the backend ledger route is installed."
      );
      setLedgerProduct(null);
    } finally {
      setStockLedgerLoading(false);
    }
  }

  function closeStockLedger() {
    setLedgerProduct(null);
    setStockLedger([]);
    setStockLedgerSummary(null);
    setStockLedgerWarnings([]);
    setStockLedgerLoading(false);
  }

  async function saveStockAdjustment(event) {
    event.preventDefault();

    if (!stockProduct) return;

    setMessage("");
    setError("");

    const quantity = Number(stockAdjustmentQuantity);

    if (!Number.isInteger(quantity) || quantity < 0) {
      setError("Quantity must be a whole number and cannot be negative.");
      return;
    }

    if (stockAdjustmentType !== "set" && quantity <= 0) {
      setError("Increase or decrease quantity must be greater than zero.");
      return;
    }

    if (!stockAdjustmentReason.trim()) {
      setError("Reason is required for stock adjustment.");
      return;
    }

    if (
      stockAdjustmentType === "decrease" &&
      quantity > Number(stockProduct.quantity || 0)
    ) {
      setError("You cannot reduce stock below zero.");
      return;
    }

    setStockSaving(true);

    try {
      const response = await axiosClient.patch(
        `/products/${stockProduct.id}/stock-adjustment`,
        {
          adjustment_type: stockAdjustmentType,
          movement_type: stockMovementType,
          quantity,
          reason: stockAdjustmentReason,
          reference_number: stockAdjustmentReference,
          movement_date: stockAdjustmentDate,
          notes: stockAdjustmentNotes,
        }
      );

      setMessage(response.data.message || "Stock adjusted successfully.");

      const updatedProduct = response.data.product;

      setStockProduct(updatedProduct);
      setStockAdjustmentQuantity("");
      setStockAdjustmentReason("");
      setStockAdjustmentReference("");
      setStockAdjustmentNotes("");

      const historyResponse = await axiosClient.get(
        `/products/${stockProduct.id}/stock-adjustments`
      );

      setStockAdjustments(historyResponse.data.adjustments || []);

      await refreshPageData();
    } catch (error) {
      setError(error.response?.data?.message || "Failed to adjust stock.");
    } finally {
      setStockSaving(false);
    }
  }

  const productSummary = useMemo(() => {
    const totalProducts = products.length;

    const lowStockProducts = products.filter((product) => {
      return (
        Number(product.quantity || 0) <=
        Number(product.low_stock_threshold || 0)
      );
    });

    const outOfStockProducts = products.filter(
      (product) => Number(product.quantity || 0) <= 0
    );

    const totalQuantity = products.reduce(
      (sum, product) => sum + Number(product.quantity || 0),
      0
    );

    const stockCostValue = products.reduce((sum, product) => {
      return (
        sum + Number(product.quantity || 0) * Number(product.cost_price || 0)
      );
    }, 0);

    const stockSellingValue = products.reduce((sum, product) => {
      return (
        sum +
        Number(product.quantity || 0) * Number(product.selling_price || 0)
      );
    }, 0);

    const expectedMargin = Math.max(stockSellingValue - stockCostValue, 0);

    const stockHealth =
      totalProducts === 0
        ? 100
        : Math.max(
            0,
            Math.round(
              ((totalProducts - lowStockProducts.length) / totalProducts) * 100
            )
          );

    const categories = new Set(
      products
        .map((product) => String(product.category || "").trim())
        .filter(Boolean)
    );

    const topValueProducts = [...products]
      .map((product) => ({
        ...product,
        stockValue:
          Number(product.quantity || 0) * Number(product.selling_price || 0),
      }))
      .sort((a, b) => b.stockValue - a.stockValue)
      .slice(0, 4);

    return {
      totalProducts,
      lowStockProducts,
      lowStockCount: lowStockProducts.length,
      outOfStockCount: outOfStockProducts.length,
      totalQuantity,
      stockCostValue,
      stockSellingValue,
      expectedMargin,
      stockHealth,
      categoryCount: categories.size,
      topValueProducts,
    };
  }, [products]);

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) return products;

    return products.filter((product) => {
      return [
        product.name,
        product.size,
        product.category,
        product.barcode,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [products, search]);

  return (
    <div className="boss-mobile-fix" style={styles.page}>
      <MobilePageFix />
      <div style={styles.hero}>
        <div style={styles.heroGlowOne} />
        <div style={styles.heroGlowTwo} />

        <div style={styles.heroContent}>
          <div style={styles.heroTop}>
            <div>
              <p style={styles.eyebrow}>Inventory Command Center</p>
              <h1 style={styles.heroTitle}>Products & Stock Control</h1>
              <p style={styles.heroSubtitle}>
                Manage spare parts, prices, stock quantities, low-stock alerts,
                stock adjustments and movement ledger records for{" "}
                <strong>
                  {currentStoreCode} — {currentStoreName}
                </strong>
                {currentStoreLocation ? ` - ${currentStoreLocation}` : ""}.
              </p>
            </div>

            <div style={styles.heroActions}>
              <button
                type="button"
                onClick={refreshPageData}
                disabled={productsLoading || recentAdjustmentsLoading}
                style={styles.heroButton}
              >
                {productsLoading ? "Refreshing..." : "Refresh Stock"}
              </button>

              {canAddOrEdit && (
                <button
                  type="button"
                  onClick={() => {
                    cancelEdit();
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  style={styles.heroButtonGold}
                >
                  + New Product
                </button>
              )}
            </div>
          </div>

          <div style={styles.heroMetrics}>
            <HeroMetric
              label="Products : "
              value={formatNumber(productSummary.totalProducts)}
            />
            <HeroMetric
              label="Stock Health : "
              value={`${productSummary.stockHealth}%`}
            />
            <HeroMetric
              label="Stock Value : "
              value={formatCompactMoney(productSummary.stockSellingValue)}
            />
            <HeroMetric
              label="Low Stock : "
              value={formatNumber(productSummary.lowStockCount)}
            />
          </div>
        </div>
      </div>

      <div style={styles.storeNotice}>
        <span>🏬</span>
        <div>
          <strong>
            Current selected store: {currentStoreCode} — {currentStoreName}
          </strong>
          <p>
            Product list, stock adjustments, stock movement ledger, low-stock
            warnings and barcode checks are filtered to this selected store only.
          </p>
        </div>
      </div>

      {message && <div className="success-box">{message}</div>}
      {error && <div className="error-box">{error}</div>}

      <div style={styles.summaryGrid}>
        <SummaryCard
          title="Total Products"
          value={formatNumber(productSummary.totalProducts)}
          note={`${productSummary.categoryCount} categor${
            productSummary.categoryCount === 1 ? "y" : "ies"
          } recorded`}
          icon="📦"
          tone="navy"
        />
        <SummaryCard
          title="Stock Quantity"
          value={formatNumber(productSummary.totalQuantity)}
          note="Total pieces currently recorded"
          icon="🏗️"
          tone="blue"
        />
        <SummaryCard
          title="Selling Stock Value"
          value={formatMoney(productSummary.stockSellingValue)}
          note="Estimated selling value"
          icon="💰"
          tone="green"
        />
        <SummaryCard
          title="Expected Margin"
          value={formatMoney(productSummary.expectedMargin)}
          note="Selling value minus cost value"
          icon="📈"
          tone="gold"
        />
        <SummaryCard
          title="Low Stock"
          value={formatNumber(productSummary.lowStockCount)}
          note={`${productSummary.outOfStockCount} out of stock`}
          icon="🚨"
          tone={productSummary.lowStockCount > 0 ? "danger" : "green"}
        />
      </div>

      <div style={styles.controlGrid}>
        {canAddOrEdit ? (
          <form style={styles.formPanel} onSubmit={handleSubmit}>
            <div style={styles.panelHeader}>
              <div>
                <p style={styles.eyebrowDark}>Stock Master Record</p>
                <h2 style={styles.panelTitle}>
                  {isEditing ? "Edit Product" : "Add New Product"}
                </h2>
                <p style={styles.panelSubtitle}>
                  Product will belong to {currentStoreCode} — {currentStoreName}.
                </p>
              </div>

              {isEditing && <span style={styles.editBadge}>Editing</span>}
            </div>

            {isEditing && (
              <div className="warning-box">
                Edit Product changes the name, category, prices and settings only.
                Stock stays at <strong>{form.quantity || 0}</strong>. Use Receive /
                Restock for new stock or Adjust / Correct for a verified correction.
              </div>
            )}

            <div style={styles.formGridTwo}>
              <label>
                Product Name
                <input
                  name="name"
                  value={form.name}
                  onChange={handleChange}
                  placeholder="Example: Hydraulic Pump"
                  required
                />
              </label>

              <label>
                Excavator Type
                <input
                  name="size"
                  value={form.size}
                  onChange={handleChange}
                  placeholder="Example: CAT 320, Komatsu PC200"
                />
              </label>
            </div>

            <label>
              Category
              <input
                name="category"
                value={form.category}
                onChange={handleChange}
                placeholder="Example: Filters, Engine, Undercarriage"
              />
            </label>

            <div style={styles.formGridTwo}>
              <label>
                Cost Price
                <input
                  name="cost_price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.cost_price}
                  onChange={handleChange}
                  required
                />
              </label>

              <label>
                Selling Price
                <input
                  name="selling_price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.selling_price}
                  onChange={handleChange}
                  required
                />
              </label>
            </div>

            <div style={styles.formGridTwo}>
              {!isEditing ? (
                <label>
                  Opening Quantity
                  <input
                    name="quantity"
                    type="number"
                    min="0"
                    value={form.quantity}
                    onChange={handleChange}
                    required
                  />
                  <small>
                    Used only when creating the product. It will be recorded as an
                    opening-balance stock movement.
                  </small>
                </label>
              ) : (
                <label>
                  Current Stock (read only)
                  <input type="number" value={form.quantity || 0} readOnly />
                  <small>Stock cannot be changed from Edit Product.</small>
                </label>
              )}

              <label>
                Low Stock Level
                <input
                  name="low_stock_threshold"
                  type="number"
                  min="0"
                  value={form.low_stock_threshold}
                  onChange={handleChange}
                />
              </label>
            </div>

            <label>
              Barcode
              <input
                name="barcode"
                value={form.barcode}
                onChange={handleChange}
                placeholder="Optional barcode"
              />
            </label>

            <label>
              Image URL
              <input
                name="image_url"
                value={form.image_url}
                onChange={handleChange}
                placeholder="Optional product image link"
              />
            </label>

            <div style={styles.formActions}>
              <button type="submit" style={styles.primaryButton}>
                {isEditing ? "Update Product" : "Save Product"}
              </button>

              {isEditing && (
                <button
                  type="button"
                  style={styles.secondaryButton}
                  onClick={cancelEdit}
                >
                  Cancel Edit
                </button>
              )}
            </div>
          </form>
        ) : (
          <div style={styles.formPanel}>
            <p style={styles.eyebrowDark}>View Only</p>
            <h2 style={styles.panelTitle}>Products</h2>
            <p style={styles.panelSubtitle}>
              You can view products, but only an admin or manager can add, edit
              or adjust products.
            </p>
          </div>
        )}

        <div style={styles.insightPanel}>
          <div style={styles.panelHeader}>
            <div>
              <p style={styles.eyebrowDark}>Inventory Intelligence</p>
              <h2 style={styles.panelTitle}>Stock Health Brief</h2>
              <p style={styles.panelSubtitle}>
                Quick view for the boss before restocking or transfer decisions.
              </p>
            </div>
          </div>

          <div style={styles.healthMeterBox}>
            <div
              style={{
                ...styles.healthRing,
                background: `conic-gradient(#e0ba28 0deg ${
                  productSummary.stockHealth * 3.6
                }deg, #e2e8f0 ${
                  productSummary.stockHealth * 3.6
                }deg 360deg)`,
              }}
            >
              <div style={styles.healthInner}>
                <strong>{productSummary.stockHealth}%</strong>
                <span>Healthy</span>
              </div>
            </div>

            <div style={styles.healthList}>
              <MiniInsight
                label="Cost Value"
                value={formatMoney(productSummary.stockCostValue)}
              />
              <MiniInsight
                label="Selling Value"
                value={formatMoney(productSummary.stockSellingValue)}
              />
              <MiniInsight
                label="Out of Stock"
                value={formatNumber(productSummary.outOfStockCount)}
              />
            </div>
          </div>

          <div style={styles.topValueList}>
            <h3 style={styles.smallTitle}>Top Stock Value Items</h3>
            {productSummary.topValueProducts.length === 0 ? (
              <div style={styles.emptyState}>No products yet.</div>
            ) : (
              productSummary.topValueProducts.map((product, index) => (
                <div key={product.id} style={styles.topValueItem}>
                  <span>{index + 1}</span>
                  <div>
                    <strong>{product.name}</strong>
                    <small>{formatMoney(product.stockValue)}</small>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <section style={styles.productPanel}>
        <div style={styles.productPanelTop}>
          <div>
            <p style={styles.eyebrowDark}>Product List</p>
            <h2 style={styles.panelTitle}>Products - {currentStoreCode}</h2>
            <p style={styles.panelSubtitle}>
              Search, edit, adjust stock, open stock ledger and review low-stock
              products quickly.
            </p>
          </div>

          <form
            style={styles.searchBar}
            onSubmit={(event) => {
              event.preventDefault();
              loadProducts();
            }}
          >
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search product, excavator type, category or barcode"
            />

            <button type="submit" style={styles.searchButton}>
              Search
            </button>

            <button
              type="button"
              style={styles.secondaryButton}
              onClick={() => {
                setSearch("");
                setTimeout(loadProducts, 0);
              }}
            >
              Clear
            </button>
          </form>
        </div>

        {productsLoading ? (
          <div style={styles.emptyState}>Loading products...</div>
        ) : filteredProducts.length === 0 ? (
          <div style={styles.emptyState}>
            No products found for {currentStoreCode} — {currentStoreName}.
          </div>
        ) : (
          <div style={styles.productGrid}>
            {filteredProducts.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                canAddOrEdit={canAddOrEdit}
                canDelete={canDelete}
                formatMoney={formatMoney}
                getProductStockStatus={getProductStockStatus}
                getProfitMarginPercent={getProfitMarginPercent}
                startEdit={startEdit}
                openRestock={openRestock}
                openStockAdjustment={openStockAdjustment}
                openStockLedger={openStockLedger}
                deleteProduct={deleteProduct}
              />
            ))}
          </div>
        )}
      </section>

      {canAddOrEdit && (
        <section style={styles.adjustmentPanel}>
          <div style={styles.productPanelTop}>
            <div>
              <p style={styles.eyebrowDark}>Audit Trail</p>
              <h2 style={styles.panelTitle}>
                Recent Stock Adjustment Records - {currentStoreCode}
              </h2>
              <p style={styles.panelSubtitle}>
                Latest damaged, lost, physical count, wrong entry and manual
                stock corrections for this selected store.
              </p>
            </div>

            <button
              type="button"
              onClick={loadRecentStockAdjustments}
              style={styles.secondaryButton}
            >
              Refresh Records
            </button>
          </div>

          {recentAdjustmentsLoading ? (
            <div style={styles.emptyState}>Loading recent stock records...</div>
          ) : recentAdjustments.length === 0 ? (
            <div style={styles.emptyState}>
              No recent stock adjustment records found for this store.
            </div>
          ) : (
            <div style={styles.tableWrap}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Product</th>
                    <th>Movement</th>
                    <th>Reference / Source</th>
                    <th>Qty</th>
                    <th>Old</th>
                    <th>New</th>
                    <th>Reason</th>
                    <th>By</th>
                  </tr>
                </thead>

                <tbody>
                  {recentAdjustments.map((adjustment) => (
                    <tr key={adjustment.id}>
                      <td>{formatDateTime(adjustment.adjusted_at)}</td>
                      <td>
                        <strong>{adjustment.product_name || "-"}</strong>
                        <br />
                        <small>
                          {[
                            adjustment.category,
                            adjustment.size,
                            adjustment.barcode,
                          ]
                            .filter(Boolean)
                            .join(" • ") || "-"}
                        </small>
                      </td>
                      <td>
                        {formatMovementType(
                          adjustment.movement_type,
                          adjustment.adjustment_type
                        )}
                      </td>
                      <td>
                        <strong>{adjustment.reference_number || "-"}</strong>
                        <br />
                        <small>{adjustment.source_name || "-"}</small>
                      </td>
                      <td>{adjustment.quantity}</td>
                      <td>{adjustment.old_quantity}</td>
                      <td>{adjustment.new_quantity}</td>
                      <td>{adjustment.reason}</td>
                      <td>{adjustment.adjusted_by_name || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {restockProduct && (
        <div className="modal-backdrop">
          <div className="receipt-modal" style={styles.modalWide}>
            <div className="modal-header">
              <div>
                <h2>Receive / Restock Product - {currentStoreCode}</h2>
                <p>
                  Product: <strong>{restockProduct.name}</strong>
                  <br />
                  Current stock: <strong>{restockProduct.quantity}</strong> • Store:{" "}
                  <strong>{currentStoreName}</strong>
                </p>
              </div>

              <button
                type="button"
                className="secondary-button"
                onClick={closeRestock}
              >
                Close
              </button>
            </div>

            <form className="receipt-preview" onSubmit={saveRestock}>
              <div className="warning-box">
                Use this for genuine stock received. A supplier purchase with an
                invoice should still use the Purchases page; this Quick Restock is
                for legitimate stock receipts that do not need a full purchase record.
              </div>

              <div className="receipt-info-grid">
                <p>
                  <strong>Current Stock:</strong> {restockProduct.quantity}
                </p>
                <p>
                  <strong>New Stock:</strong>{" "}
                  {Number(restockProduct.quantity || 0) + Number(restockQuantity || 0)}
                </p>
                <p>
                  <strong>Current Cost:</strong>{" "}
                  {formatMoney(restockProduct.cost_price)}
                </p>
                <p>
                  <strong>Category:</strong> {restockProduct.category || "-"}
                </p>
              </div>

              <div style={styles.formGridTwo}>
                <label>
                  Quantity Received
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={restockQuantity}
                    onChange={(event) => setRestockQuantity(event.target.value)}
                    placeholder="Example: 20"
                    required
                  />
                </label>

                <label>
                  Date Received
                  <input
                    type="date"
                    value={restockDate}
                    onChange={(event) => setRestockDate(event.target.value)}
                    required
                  />
                </label>
              </div>

              <div style={styles.formGridTwo}>
                <label>
                  Supplier or Stock Source
                  <input
                    value={restockSource}
                    onChange={(event) => setRestockSource(event.target.value)}
                    placeholder="Example: K. Boateng Parts Supplier"
                    required
                  />
                </label>

                <label>
                  Invoice / Reference Number
                  <input
                    value={restockReference}
                    onChange={(event) => setRestockReference(event.target.value)}
                    placeholder="Optional invoice, delivery note or reference"
                  />
                </label>
              </div>

              <label>
                Unit Cost
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={restockUnitCost}
                  onChange={(event) => setRestockUnitCost(event.target.value)}
                  placeholder="Optional received unit cost"
                />
              </label>

              <label style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <input
                  className="restock-cost-checkbox"
                  type="checkbox"
                  checked={restockUpdateCost}
                  onChange={(event) => setRestockUpdateCost(event.target.checked)}
                />
                Update the product cost price to this received unit cost
              </label>

              <label>
                Notes
                <textarea
                  value={restockNotes}
                  onChange={(event) => setRestockNotes(event.target.value)}
                  placeholder="Condition, delivery details or management note"
                />
              </label>

              <div className="modal-actions">
                <button type="submit" disabled={restockSaving}>
                  {restockSaving ? "Recording..." : "Record Stock Receipt"}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={closeRestock}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {stockProduct && (
        <div className="modal-backdrop">
          <div className="receipt-modal" style={styles.modalWide}>
            <div className="modal-header">
              <div>
                <h2>Stock Adjustment - {currentStoreCode}</h2>
                <p>
                  Product: <strong>{stockProduct.name}</strong>
                  <br />
                  Store: <strong>{currentStoreName}</strong>
                </p>
              </div>

              <button
                type="button"
                className="secondary-button"
                onClick={closeStockAdjustment}
              >
                Close
              </button>
            </div>

            <form className="receipt-preview" onSubmit={saveStockAdjustment}>
              <div className="receipt-info-grid">
                <p>
                  <strong>Current Stock:</strong> {stockProduct.quantity}
                </p>

                <p>
                  <strong>Low Stock Level:</strong>{" "}
                  {stockProduct.low_stock_threshold}
                </p>

                <p>
                  <strong>Expected New Stock:</strong> {calculateExpectedStock()}
                </p>

                <p>
                  <strong>Category:</strong> {stockProduct.category || "-"}
                </p>
              </div>

              <div className="warning-box">
                This form is for corrections, damage, loss and authorized stock
                counts. New stock received must use Receive / Restock.
              </div>

              <div style={styles.formGridTwo}>
                <label>
                  Adjustment Direction
                  <select
                    value={stockAdjustmentType}
                    onChange={(event) => {
                      const nextType = event.target.value;
                      setStockAdjustmentType(nextType);
                      setStockMovementType(
                        nextType === "increase"
                          ? "correction_increase"
                          : nextType === "decrease"
                            ? "correction_decrease"
                            : "physical_count"
                      );
                    }}
                  >
                    <option value="increase">Increase Stock</option>
                    <option value="decrease">Decrease Stock</option>
                    <option value="set">Set Exact Stock</option>
                  </select>
                </label>

                <label>
                  Movement Category
                  <select
                    value={stockMovementType}
                    onChange={(event) => setStockMovementType(event.target.value)}
                  >
                    {getMovementOptions(stockAdjustmentType).map(
                      ([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      )
                    )}
                  </select>
                </label>
              </div>

              <div style={styles.formGridTwo}>
                <label>
                  {stockAdjustmentType === "set"
                    ? "New Exact Quantity"
                    : "Adjustment Quantity"}
                  <input
                    type="number"
                    min={stockAdjustmentType === "set" ? "0" : "1"}
                    value={stockAdjustmentQuantity}
                    onChange={(event) =>
                      setStockAdjustmentQuantity(event.target.value)
                    }
                    placeholder={
                      stockAdjustmentType === "set"
                        ? "Example: 50"
                        : "Example: 5"
                    }
                    required
                  />
                </label>

                <label>
                  Movement Date
                  <input
                    type="date"
                    value={stockAdjustmentDate}
                    onChange={(event) =>
                      setStockAdjustmentDate(event.target.value)
                    }
                    required
                  />
                </label>
              </div>

              <label>
                Reference Number
                <input
                  value={stockAdjustmentReference}
                  onChange={(event) =>
                    setStockAdjustmentReference(event.target.value)
                  }
                  placeholder="Optional count sheet, incident or approval reference"
                />
              </label>

              <label>
                Reason
                <textarea
                  value={stockAdjustmentReason}
                  onChange={(event) =>
                    setStockAdjustmentReason(event.target.value)
                  }
                  placeholder="Explain exactly why stock is changing"
                  required
                />
              </label>

              <label>
                Additional Notes
                <textarea
                  value={stockAdjustmentNotes}
                  onChange={(event) =>
                    setStockAdjustmentNotes(event.target.value)
                  }
                  placeholder="Optional verification, damaged-item condition or authorization note"
                />
              </label>

              <div className="modal-actions">
                <button type="submit" disabled={stockSaving}>
                  {stockSaving ? "Saving..." : "Save Adjustment"}
                </button>

                <button
                  type="button"
                  className="secondary-button"
                  onClick={closeStockAdjustment}
                >
                  Cancel
                </button>
              </div>
            </form>

            <div className="receipt-preview">
              <h3>Stock Adjustment History</h3>

              {stockHistoryLoading ? (
                <p>Loading stock history...</p>
              ) : stockAdjustments.length === 0 ? (
                <p>No stock adjustments recorded for this product.</p>
              ) : (
                <div style={styles.tableWrap}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Movement</th>
                        <th>Reference / Source</th>
                        <th>Qty</th>
                        <th>Old</th>
                        <th>New</th>
                        <th>Reason</th>
                        <th>By</th>
                      </tr>
                    </thead>

                    <tbody>
                      {stockAdjustments.map((adjustment) => (
                        <tr key={adjustment.id}>
                          <td>
                            {formatDateTime(
                              adjustment.movement_date || adjustment.adjusted_at
                            )}
                          </td>
                          <td>
                            {formatMovementType(
                              adjustment.movement_type,
                              adjustment.adjustment_type
                            )}
                          </td>
                          <td>
                            <strong>{adjustment.reference_number || "-"}</strong>
                            <br />
                            <small>{adjustment.source_name || "-"}</small>
                          </td>
                          <td>{adjustment.quantity}</td>
                          <td>{adjustment.old_quantity}</td>
                          <td>{adjustment.new_quantity}</td>
                          <td>{adjustment.reason}</td>
                          <td>{adjustment.adjusted_by_name || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {ledgerProduct && (
        <div className="modal-backdrop">
          <div className="receipt-modal" style={{ maxWidth: "1180px" }}>
            <div className="modal-header">
              <div>
                <h2>Stock Movement Ledger - {currentStoreCode}</h2>
                <p>
                  Product: <strong>{ledgerProduct.name}</strong>
                  <br />
                  Store: <strong>{currentStoreName}</strong>
                </p>
              </div>

              <button
                type="button"
                className="secondary-button"
                onClick={closeStockLedger}
              >
                Close
              </button>
            </div>

            <div className="receipt-preview">
              <h3>Ledger Summary</h3>

              {stockLedgerLoading ? (
                <p>Loading stock movement ledger...</p>
              ) : (
                <>
                  <div className="receipt-info-grid">
                    <p>
                      <strong>Opening Stock:</strong>{" "}
                      {formatNumber(stockLedgerSummary?.opening_quantity)}
                    </p>

                    <p>
                      <strong>Current Stock:</strong>{" "}
                      {formatNumber(stockLedgerSummary?.current_quantity)}
                    </p>

                    <p>
                      <strong>Total Purchases:</strong>{" "}
                      {formatNumber(
                        stockLedgerSummary?.total_purchase_quantity
                      )}
                    </p>

                    <p>
                      <strong>Total Sales:</strong>{" "}
                      {formatNumber(stockLedgerSummary?.total_sales_quantity)}
                    </p>

                    <p>
                      <strong>Total Returns:</strong>{" "}
                      {formatNumber(stockLedgerSummary?.total_returns_quantity)}
                    </p>

                    <p>
                      <strong>Transfers Out:</strong>{" "}
                      {formatNumber(
                        stockLedgerSummary?.total_transfer_out_quantity
                      )}
                    </p>

                    <p>
                      <strong>Transfers In:</strong>{" "}
                      {formatNumber(
                        stockLedgerSummary?.total_transfer_in_quantity
                      )}
                    </p>

                    <p>
                      <strong>Adjustment Increase:</strong>{" "}
                      {formatNumber(
                        stockLedgerSummary?.total_adjustment_increase_quantity
                      )}
                    </p>

                    <p>
                      <strong>Adjustment Decrease:</strong>{" "}
                      {formatNumber(
                        stockLedgerSummary?.total_adjustment_decrease_quantity
                      )}
                    </p>

                    <p>
                      <strong>Movement Records:</strong>{" "}
                      {formatNumber(stockLedgerSummary?.total_movement_records)}
                    </p>
                  </div>

                  <div className="warning-box">
                    This ledger is calculated from stock adjustments, sales,
                    purchases, returns and stock transfers. It is shown newest
                    first for easier auditing.
                  </div>

                  {stockLedgerWarnings.length > 0 && (
                    <div className="warning-box">
                      <strong>Ledger warnings:</strong>
                      <ul style={{ marginBottom: 0 }}>
                        {stockLedgerWarnings.map((warning, index) => (
                          <li key={`${warning}-${index}`}>{warning}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="receipt-preview">
              <h3>Movement History</h3>

              {stockLedgerLoading ? (
                <p>Loading movement history...</p>
              ) : stockLedger.length === 0 ? (
                <p>No stock movement records found for this product.</p>
              ) : (
                <div style={styles.tableWrap}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Movement</th>
                        <th>Reference</th>
                        <th>Details</th>
                        <th>Change</th>
                        <th>Before</th>
                        <th>After</th>
                        <th>By</th>
                      </tr>
                    </thead>

                    <tbody>
                      {stockLedger.map((entry, index) => (
                        <tr
                          key={`${entry.source}-${entry.reference}-${entry.sort_id}-${index}`}
                        >
                          <td>{formatDateTime(entry.date)}</td>
                          <td>{entry.movement_type || "-"}</td>
                          <td>{entry.reference || "-"}</td>
                          <td>{entry.details || "-"}</td>
                          <td style={getChangeStyle(entry.change_quantity)}>
                            {formatChangeQuantity(entry.change_quantity)}
                          </td>
                          <td>{formatNumber(entry.quantity_before)}</td>
                          <td>{formatNumber(entry.quantity_after)}</td>
                          <td>{entry.recorded_by || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
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

function SummaryCard({ title, value, note, icon, tone }) {
  return (
    <div style={styles.summaryCard}>
      <div style={styles.summaryTop}>
        <div style={{ ...styles.summaryIcon, ...summaryTones[tone] }}>
          {icon}
        </div>
        <span style={{ ...styles.summaryPill, ...summaryTones[tone] }}>
          {tone === "danger" ? "Watch" : "Live"}
        </span>
      </div>
      <p>{title}</p>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

function MiniInsight({ label, value }) {
  return (
    <div style={styles.miniInsight}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ProductCard({
  product,
  canAddOrEdit,
  canDelete,
  formatMoney,
  getProductStockStatus,
  getProfitMarginPercent,
  startEdit,
  openRestock,
  openStockAdjustment,
  openStockLedger,
  deleteProduct,
}) {
  const stockStatus = getProductStockStatus(product);
  const quantity = Number(product.quantity || 0);
  const sellingPrice = Number(product.selling_price || 0);
  const stockValue = quantity * sellingPrice;

  return (
    <article style={styles.productCard}>
      <div style={styles.productCardTop}>
        <div style={styles.productImageBox}>
          {product.image_url ? (
            <img src={product.image_url} alt={product.name} />
          ) : (
            <span>📦</span>
          )}
        </div>

        <div style={{ minWidth: 0, flex: 1 }}>
          <h3 style={styles.productName}>{product.name}</h3>
          <p style={styles.productMeta}>
            {product.size || "No excavator type"} •{" "}
            {product.category || "No category"}
          </p>
          {product.barcode && (
            <span style={styles.barcodePill}>Barcode: {product.barcode}</span>
          )}
        </div>

        <span style={{ ...styles.stockPill, ...stockStatus.style }}>
          {stockStatus.label}
        </span>
      </div>

      <div style={styles.productStatsGrid}>
        <ProductMiniStat label="Stock" value={formatNumberSafe(product.quantity)} />
        <ProductMiniStat label="Low Level" value={formatNumberSafe(product.low_stock_threshold)} />
        <ProductMiniStat label="Cost" value={formatMoney(product.cost_price)} />
        <ProductMiniStat label="Selling" value={formatMoney(product.selling_price)} />
      </div>

      <div style={styles.productValueStrip}>
        <div>
          <span>Stock Value</span>
          <strong>{formatMoney(stockValue)}</strong>
        </div>
        <div>
          <span>Margin</span>
          <strong>{getProfitMarginPercent(product)}%</strong>
        </div>
      </div>

      {(canAddOrEdit || canDelete) && (
        <div style={styles.productActions}>
          {canAddOrEdit && (
            <>
              <button
                type="button"
                style={styles.smallSecondaryButton}
                onClick={() => startEdit(product)}
              >
                Edit
              </button>

              <button
                type="button"
                style={styles.smallPrimaryButton}
                onClick={() => openRestock(product)}
              >
                Receive / Restock
              </button>

              <button
                type="button"
                style={styles.smallSecondaryButton}
                onClick={() => openStockAdjustment(product)}
              >
                Adjust / Correct
              </button>

              <button
                type="button"
                style={styles.smallSecondaryButton}
                onClick={() => openStockLedger(product)}
              >
                Ledger
              </button>
            </>
          )}

          {canDelete && (
            <button
              type="button"
              style={styles.smallDangerButton}
              onClick={() => deleteProduct(product.id, product.name)}
            >
              Delete
            </button>
          )}
        </div>
      )}
    </article>
  );
}

function ProductMiniStat({ label, value }) {
  return (
    <div style={styles.productMiniStat}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatNumberSafe(value) {
  return Number(value || 0).toLocaleString("en-GH");
}

const summaryTones = {
  navy: { background: "#e2e8f0", color: "#0f172a" },
  blue: { background: "#dbeafe", color: "#1d4ed8" },
  green: { background: "#dcfce7", color: "#166534" },
  gold: { background: "#fef3c7", color: "#92400e" },
  danger: { background: "#fee2e2", color: "#991b1b" },
};

const styles = {
  page: {
    width: "100%",
    maxWidth: "1680px",
    margin: "0 auto",
    paddingBottom: "40px",
  },
  hero: {
    position: "relative",
    overflow: "hidden",
    borderRadius: "28px",
    padding: "26px",
    marginBottom: "18px",
    background:
      "linear-gradient(135deg, #07182c 0%, #0d2f55 52%, #111827 100%)",
    color: "#ffffff",
    boxShadow: "0 24px 60px rgba(7, 24, 44, 0.28)",
  },
  heroGlowOne: {
    position: "absolute",
    width: "260px",
    height: "260px",
    right: "-90px",
    top: "-100px",
    borderRadius: "50%",
    background: "rgba(224, 186, 40, 0.32)",
    filter: "blur(18px)",
  },
  heroGlowTwo: {
    position: "absolute",
    width: "200px",
    height: "200px",
    left: "42%",
    bottom: "-120px",
    borderRadius: "50%",
    background: "rgba(37, 99, 235, 0.36)",
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
    fontSize: "12px",
  },
  heroTitle: {
    margin: "6px 0 0",
    fontSize: "clamp(30px, 4vw, 50px)",
    lineHeight: 1.05,
    fontWeight: "950",
    letterSpacing: "-0.04em",
  },
  heroSubtitle: {
    margin: "10px 0 0",
    maxWidth: "860px",
    color: "rgba(255,255,255,0.78)",
    fontSize: "15px",
    lineHeight: 1.65,
  },
  heroButton: {
    border: "1px solid rgba(224, 186, 40, 0.65)",
    background: "rgba(224, 186, 40, 0.15)",
    color: "#ffffff",
    borderRadius: "14px",
    padding: "12px 16px",
    fontWeight: "950",
    cursor: "pointer",
  },
  heroButtonGold: {
    border: "none",
    background: "#e0ba28",
    color: "#07182c",
    borderRadius: "14px",
    padding: "12px 16px",
    fontWeight: "950",
    cursor: "pointer",
    boxShadow: "0 12px 24px rgba(224, 186, 40, 0.24)",
  },
  heroMetrics: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
    gap: "14px",
    marginTop: "24px",
  },
  heroMetric: {
    padding: "16px",
    borderRadius: "18px",
    background: "rgba(255,255,255,0.1)",
    border: "1px solid rgba(255,255,255,0.14)",
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
  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
    gap: "14px",
    marginBottom: "18px",
  },
  summaryCard: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "22px",
    padding: "17px",
    boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
    minWidth: 0,
  },
  summaryTop: {
    display: "flex",
    justifyContent: "space-between",
    gap: "10px",
    alignItems: "center",
  },
  summaryIcon: {
    width: "44px",
    height: "44px",
    borderRadius: "15px",
    display: "grid",
    placeItems: "center",
    fontSize: "22px",
  },
  summaryPill: {
    borderRadius: "999px",
    padding: "6px 9px",
    fontSize: "11px",
    fontWeight: "950",
  },
  controlGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(320px, 460px) minmax(0, 1fr)",
    gap: "18px",
    alignItems: "start",
    marginBottom: "18px",
  },
  formPanel: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "24px",
    padding: "20px",
    boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
    minWidth: 0,
  },
  insightPanel: {
    background:
      "linear-gradient(135deg, rgba(255,255,255,0.98), rgba(255,251,235,0.96))",
    border: "1px solid rgba(224, 186, 40, 0.38)",
    borderRadius: "24px",
    padding: "20px",
    boxShadow: "0 18px 45px rgba(15, 23, 42, 0.09)",
    minWidth: 0,
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
    color: "#07182c",
    fontSize: "22px",
    fontWeight: "950",
  },
  panelSubtitle: {
    margin: "6px 0 0",
    color: "#64748b",
    fontSize: "13px",
    lineHeight: 1.55,
  },
  editBadge: {
    borderRadius: "999px",
    padding: "8px 11px",
    background: "#fff7ed",
    color: "#9a3412",
    border: "1px solid #fed7aa",
    fontWeight: "950",
    fontSize: "12px",
  },
  formGridTwo: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: "12px",
  },
  formActions: {
    display: "flex",
    gap: "10px",
    flexWrap: "wrap",
    marginTop: "8px",
  },
  primaryButton: {
    border: "none",
    background: "#07182c",
    color: "#ffffff",
    borderRadius: "13px",
    padding: "11px 14px",
    fontWeight: "950",
    cursor: "pointer",
  },
  secondaryButton: {
    border: "1px solid #dbe3ef",
    background: "#ffffff",
    color: "#07182c",
    borderRadius: "13px",
    padding: "10px 13px",
    fontWeight: "950",
    cursor: "pointer",
  },
  healthMeterBox: {
    display: "grid",
    gridTemplateColumns: "170px minmax(0, 1fr)",
    gap: "18px",
    alignItems: "center",
  },
  healthRing: {
    width: "160px",
    height: "160px",
    borderRadius: "50%",
    display: "grid",
    placeItems: "center",
  },
  healthInner: {
    width: "104px",
    height: "104px",
    borderRadius: "50%",
    background: "#ffffff",
    display: "grid",
    placeItems: "center",
    textAlign: "center",
    boxShadow: "0 10px 24px rgba(15,23,42,0.12)",
  },
  healthList: {
    display: "grid",
    gap: "10px",
  },
  miniInsight: {
    padding: "12px",
    borderRadius: "16px",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
  },
  topValueList: {
    marginTop: "18px",
  },
  smallTitle: {
    margin: "0 0 10px",
    color: "#07182c",
    fontWeight: "950",
  },
  topValueItem: {
    display: "flex",
    gap: "10px",
    alignItems: "center",
    padding: "10px",
    borderRadius: "14px",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    marginBottom: "8px",
  },
  productPanel: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "24px",
    padding: "20px",
    boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
    marginBottom: "18px",
  },
  productPanelTop: {
    display: "flex",
    justifyContent: "space-between",
    gap: "14px",
    alignItems: "flex-start",
    flexWrap: "wrap",
    marginBottom: "16px",
  },
  searchBar: {
    display: "grid",
    gridTemplateColumns: "minmax(220px, 1fr) auto auto",
    gap: "8px",
    alignItems: "start",
    minWidth: "min(100%, 560px)",
  },
  searchButton: {
    border: "none",
    background: "#07182c",
    color: "#ffffff",
    borderRadius: "13px",
    padding: "10px 13px",
    fontWeight: "950",
    cursor: "pointer",
  },
  productGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: "14px",
  },
  productCard: {
    border: "1px solid #e2e8f0",
    borderRadius: "22px",
    background:
      "linear-gradient(180deg, rgba(255,255,255,1), rgba(248,250,252,0.95))",
    padding: "16px",
    boxShadow: "0 14px 30px rgba(15, 23, 42, 0.07)",
    minWidth: 0,
  },
  productCardTop: {
    display: "flex",
    gap: "12px",
    alignItems: "flex-start",
  },
  productImageBox: {
    width: "54px",
    height: "54px",
    borderRadius: "16px",
    background: "#eef2f7",
    display: "grid",
    placeItems: "center",
    overflow: "hidden",
    flexShrink: 0,
    fontSize: "24px",
  },
  productName: {
    margin: 0,
    color: "#07182c",
    fontSize: "17px",
    fontWeight: "950",
    lineHeight: 1.2,
  },
  productMeta: {
    margin: "4px 0 0",
    color: "#64748b",
    fontSize: "12px",
    fontWeight: "750",
    lineHeight: 1.4,
  },
  barcodePill: {
    display: "inline-flex",
    marginTop: "8px",
    padding: "5px 8px",
    borderRadius: "999px",
    background: "#eff6ff",
    color: "#1d4ed8",
    fontSize: "11px",
    fontWeight: "900",
  },
  stockPill: {
    display: "inline-flex",
    alignItems: "center",
    borderRadius: "999px",
    padding: "6px 9px",
    fontSize: "11px",
    fontWeight: "950",
    whiteSpace: "nowrap",
    border: "1px solid",
  },
  statusSuccess: {
    background: "#dcfce7",
    color: "#166534",
    borderColor: "#bbf7d0",
  },
  statusWarning: {
    background: "#ffedd5",
    color: "#9a3412",
    borderColor: "#fed7aa",
  },
  statusDanger: {
    background: "#fee2e2",
    color: "#991b1b",
    borderColor: "#fecaca",
  },
  productStatsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "8px",
    marginTop: "14px",
  },
  productMiniStat: {
    padding: "10px",
    borderRadius: "14px",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
  },
  productValueStrip: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "8px",
    marginTop: "10px",
    padding: "10px",
    borderRadius: "16px",
    background: "#07182c",
    color: "#ffffff",
  },
  productActions: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
    marginTop: "14px",
  },
  smallPrimaryButton: {
    border: "none",
    background: "#07182c",
    color: "#ffffff",
    borderRadius: "11px",
    padding: "8px 10px",
    fontSize: "12px",
    fontWeight: "950",
    cursor: "pointer",
  },
  smallSecondaryButton: {
    border: "1px solid #dbe3ef",
    background: "#ffffff",
    color: "#07182c",
    borderRadius: "11px",
    padding: "8px 10px",
    fontSize: "12px",
    fontWeight: "950",
    cursor: "pointer",
  },
  smallDangerButton: {
    border: "none",
    background: "#dc2626",
    color: "#ffffff",
    borderRadius: "11px",
    padding: "8px 10px",
    fontSize: "12px",
    fontWeight: "950",
    cursor: "pointer",
  },
  adjustmentPanel: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "24px",
    padding: "20px",
    boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
  },
  tableWrap: {
    width: "100%",
    overflowX: "auto",
  },
  table: {
    minWidth: "940px",
  },
  modalWide: {
    maxWidth: "980px",
  },
  emptyState: {
    padding: "18px",
    borderRadius: "16px",
    background: "#f8fafc",
    color: "#64748b",
    border: "1px dashed #cbd5e1",
    textAlign: "center",
    fontWeight: "800",
  },
};
