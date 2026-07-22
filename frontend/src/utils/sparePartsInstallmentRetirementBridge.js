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

function hideElement(element) {
  if (!element || element.dataset.chalinInstallmentRetired === "1") return;
  element.dataset.chalinInstallmentRetired = "1";
  element.hidden = true;
  element.setAttribute("aria-hidden", "true");
  if ("disabled" in element) element.disabled = true;
  element.style.setProperty("display", "none", "important");
}

function retirePaymentButtons() {
  const buttons = document.querySelectorAll("button");
  let installmentWasActive = false;

  buttons.forEach((button) => {
    const text = normalizedText(button);
    if (text === "installment") {
      installmentWasActive =
        button.getAttribute("aria-pressed") === "true" ||
        /active|selected/i.test(button.className || "") ||
        /#1|rgb\(/i.test(button.style?.background || "");
      hideElement(button);
    }
  });

  document.querySelectorAll('option[value="installment"]').forEach((option) => {
    option.remove();
  });

  if (installmentWasActive) {
    const cashButton = [...document.querySelectorAll("button")].find(
      (button) => normalizedText(button) === "cash" && !button.hidden
    );
    cashButton?.click();
  }
}

function retireInstallmentForms() {
  document.querySelectorAll("strong, h2, h3, legend").forEach((heading) => {
    const text = normalizedText(heading);
    if (text !== "installment agreement") return;

    let container = heading.parentElement;
    while (container && container !== document.body) {
      const containerText = normalizedText(container);
      if (
        containerText.includes("payment frequency") &&
        containerText.includes("number of payments")
      ) {
        hideElement(container);
        break;
      }
      container = container.parentElement;
    }
  });
}

function retireNavigation() {
  document.querySelectorAll("a, button, [role='link']").forEach((element) => {
    const text = normalizedText(element);
    const href = String(element.getAttribute?.("href") || "");
    if (
      text === "installment sales" ||
      text === "installments" ||
      href === "/installments" ||
      href.endsWith("/installments")
    ) {
      const item = element.closest("li") || element;
      hideElement(item);
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
    "Heavy-equipment installment sales are now handled in Equipment Sales & Hire. Spare Parts continues with Cash, MoMo, Bank, Credit and Mixed sales.";
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
  retirePaymentButtons();
  retireInstallmentForms();
  retireNavigation();
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
    const observer = new MutationObserver(() => applyRetirementUi());
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
