function storedUser() {
  try {
    return JSON.parse(localStorage.getItem("chalin03_user") || "null");
  } catch {
    return null;
  }
}

function activeWorkspaceCode() {
  const user = storedUser();
  return user?.workspace_code || user?.active_workspace?.code || "spare_parts";
}

function isSparePartsWorkspace() {
  return activeWorkspaceCode() === "spare_parts";
}

function normalizedText(element) {
  return String(element?.textContent || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const MAX_PANEL_REVEAL_ATTEMPTS = 6;

function hideExactRetiredControl(element) {
  if (!element || element.dataset.chalinInstallmentRetired === "1") return;
  element.dataset.chalinInstallmentRetired = "1";
  element.hidden = true;
  element.setAttribute("aria-hidden", "true");
  if ("disabled" in element) element.disabled = true;
  element.style.setProperty("display", "none", "important");
}

function retireInstallmentPaymentButton() {
  document.querySelectorAll("button").forEach((button) => {
    if (normalizedText(button) === "installment") {
      hideExactRetiredControl(button);
    }
  });

  document.querySelectorAll('option[value="installment"]').forEach((option) => {
    option.remove();
  });
}

function retireInstallmentNavigation() {
  document.querySelectorAll("a, button, [role='link']").forEach((element) => {
    const text = normalizedText(element);
    const href = String(element.getAttribute?.("href") || "");

    if (
      text === "installment sales" ||
      text === "installments" ||
      href === "/installments" ||
      href.endsWith("/installments")
    ) {
      hideExactRetiredControl(element.closest("li") || element);
    }
  });
}

function addRetirementNotice() {
  if (window.location.pathname !== "/new-sale") return;
  if (document.querySelector("[data-chalin-spare-parts-retirement-notice='1']")) return;

  const paymentLabel = [...document.querySelectorAll("label")].find(
    (label) => normalizedText(label) === "payment type"
  );
  if (!paymentLabel?.parentElement) return;

  const notice = document.createElement("div");
  notice.dataset.chalinSparePartsRetirementNotice = "1";
  notice.textContent =
    "Equipment installments are handled in Equipment Sales & Hire. Spare Parts supports Cash, MoMo, Bank, Credit and Mixed sales.";
  Object.assign(notice.style, {
    margin: "10px 0 4px",
    padding: "10px 12px",
    borderRadius: "12px",
    border: "1px solid #c9d7ee",
    background: "#eef4ff",
    color: "#183153",
    fontSize: "12px",
    fontWeight: "700",
    lineHeight: "1.45",
  });
  paymentLabel.parentElement.insertBefore(notice, paymentLabel.nextSibling);
}

function removeRetirementAttributes(element) {
  if (!element) return;
  element.hidden = false;
  element.removeAttribute("aria-hidden");
  element.removeAttribute("disabled");
  delete element.dataset.chalinInstallmentRetired;

  ["display", "visibility", "opacity", "height", "max-height", "overflow"].forEach(
    (property) => element.style.removeProperty(property)
  );
}

function showPaymentGuidance(method, messageOverride = "") {
  document.querySelector("[data-chalin-credit-mixed-guidance='1']")?.remove();

  const banner = document.createElement("div");
  banner.dataset.chalinCreditMixedGuidance = "1";
  banner.setAttribute("role", "status");
  banner.textContent =
    messageOverride ||
    (method === "credit"
      ? "Credit sale selected. Enter the customer details. Leave payment channels at 0.00 when nothing is collected now; the unpaid amount becomes the customer debt."
      : "Mixed payment selected. Enter the amount received under Cash, MoMo, Bank or Other. The channel total becomes the amount paid now and any remainder becomes customer debt.");

  const isError = Boolean(messageOverride);
  Object.assign(banner.style, {
    position: "fixed",
    left: "50%",
    bottom: "20px",
    transform: "translateX(-50%)",
    zIndex: "30000",
    width: "min(520px, calc(100% - 28px))",
    padding: "13px 15px",
    borderRadius: "14px",
    border: isError
      ? "1px solid #dc2626"
      : method === "credit"
      ? "1px solid #f59e0b"
      : "1px solid #2563eb",
    background: isError ? "#fef2f2" : method === "credit" ? "#fffbeb" : "#eff6ff",
    color: isError ? "#991b1b" : method === "credit" ? "#78350f" : "#1e3a8a",
    boxShadow: "0 18px 44px rgba(15, 23, 42, 0.22)",
    fontSize: "13px",
    fontWeight: "800",
    lineHeight: "1.45",
  });

  document.body.appendChild(banner);
  window.setTimeout(() => banner.remove(), 7000);
}

function revealCreditOrMixedPanel(method, attempt = 0) {
  if (!isSparePartsWorkspace() || window.location.pathname !== "/new-sale") return;
  if (!new Set(["credit", "mixed"]).has(method)) return;

  const splitLabel = [...document.querySelectorAll("label")].find((label) =>
    normalizedText(label).startsWith("amount paid now")
  );

  if (!splitLabel) {
    if (attempt < MAX_PANEL_REVEAL_ATTEMPTS) {
      window.setTimeout(() => revealCreditOrMixedPanel(method, attempt + 1), 80);
    } else {
      showPaymentGuidance(
        method,
        "The Credit or Mixed payment section did not open. Refresh New Sale once and try again."
      );
    }
    return;
  }

  const panel = splitLabel.parentElement;
  removeRetirementAttributes(panel);
  removeRetirementAttributes(panel?.parentElement);
  panel.dataset.chalinCreditMixedPanel = method;

  panel.scrollIntoView({ behavior: "smooth", block: "center" });
  const firstAmountInput = panel.querySelector('input[type="number"]');
  window.setTimeout(() => firstAmountInput?.focus({ preventScroll: true }), 180);
  showPaymentGuidance(method);
}

function paymentMethodFromClick(target) {
  const button = target?.closest?.("button");
  if (!button) return "";
  const method = normalizedText(button);
  return new Set(["cash", "momo", "bank", "credit", "mixed"]).has(method)
    ? method
    : "";
}

function handlePaymentMethodClick(event) {
  if (!isSparePartsWorkspace() || window.location.pathname !== "/new-sale") return;
  const method = paymentMethodFromClick(event.target);
  if (!method) return;

  if (method === "credit" || method === "mixed") {
    window.requestAnimationFrame(() => {
      window.setTimeout(() => revealCreditOrMixedPanel(method), 0);
    });
  } else {
    document.querySelector("[data-chalin-credit-mixed-guidance='1']")?.remove();
  }
}

function redirectRetiredRoute() {
  if (window.location.pathname !== "/installments") return false;
  sessionStorage.setItem(
    "chalin03_login_notice",
    "Spare Parts installments have moved to Equipment Sales & Hire."
  );
  window.location.replace("/new-sale");
  return true;
}

function applyRetirementUi() {
  if (!isSparePartsWorkspace()) return;
  if (redirectRetiredRoute()) return;
  retireInstallmentPaymentButton();
  retireInstallmentNavigation();
  addRetirementNotice();
}

export function assertSparePartsInstallmentRequestAllowed(config) {
  if (!isSparePartsWorkspace()) return config;

  const method = String(config?.method || "get").toLowerCase();
  const url = String(config?.url || "").replace(/\?.*$/, "");
  const paymentType = String(config?.data?.payment_type || "").toLowerCase();

  if (method === "post" && /(?:^|\/)sales$/.test(url) && paymentType === "installment") {
    const error = new Error(
      "Spare Parts installment sales have moved to Equipment Sales & Hire."
    );
    error.code = "SPARE_PARTS_INSTALLMENTS_RETIRED";
    throw error;
  }

  return config;
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  const start = () => {
    applyRetirementUi();
    document.addEventListener("click", handlePaymentMethodClick, true);

    // Observe only so newly rendered exact Installment controls can be retired.
    // Never hide or mutate a Credit or Mixed payment-form container.
    let scheduled = false;
    const observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(() => {
        scheduled = false;
        applyRetirementUi();
      });
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener("popstate", applyRetirementUi);
    window.addEventListener("storage", applyRetirementUi);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
}
