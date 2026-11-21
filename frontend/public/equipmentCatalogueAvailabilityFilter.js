(() => {
  const STYLE_ID = "chalin03-equipment-availability-filter-final-v1";

  const OPTIONS = [
    ["", "All excavators"],
    ["available", "Available for a new installment"],
    ["installment_active", "Under installment agreement"],
    ["reserved", "Reserved / held for a transaction"],
    ["sold", "Sold / completed sale"],
    ["not_for_sale", "Not offered for installment sale"],
  ];

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .equipment-catalogue__availability-filter {
        display: grid !important;
        gap: 7px !important;
        min-width: 0 !important;
        padding: 10px 12px 12px !important;
        border: 1px solid rgba(11,132,87,.28) !important;
        border-radius: 16px !important;
        background: linear-gradient(135deg, #effaf4, #ffffff) !important;
      }
      .equipment-catalogue__availability-filter > span {
        color: #086744 !important;
        font-size: .76rem !important;
        font-weight: 900 !important;
        letter-spacing: .055em !important;
        text-transform: uppercase !important;
      }
      .equipment-catalogue__availability-filter select {
        width: 100% !important;
        min-height: 50px !important;
        border: 1px solid rgba(11,132,87,.42) !important;
        border-radius: 13px !important;
        color: #102239 !important;
        background: #fff !important;
        font: inherit !important;
        font-weight: 820 !important;
      }
      .equipment-catalogue__availability-filter small {
        color: #4f6e61 !important;
        font-size: .7rem !important;
        line-height: 1.35 !important;
      }
    `;
    document.head.appendChild(style);
  }

  function run() {
    const root = document.querySelector(".equipment-catalogue");
    if (!root) return;

    installStyles();

    const row = root.querySelector(".equipment-catalogue__filters");
    if (!row) return;

    const native = [...row.querySelectorAll("select")].find((select) => {
      const values = [...select.options].map((option) => String(option.value || "").trim());
      return values.includes("installment_active") && values.includes("reserved") && values.includes("sold");
    });

    if (!native) return;

    const field = native.closest("label") || native.parentElement;
    if (!field) return;

    field.classList.add("equipment-catalogue__availability-filter");
    const label = field.querySelector(":scope > span");
    if (label) label.textContent = "Availability status";

    const currentValue = native.value || "";
    native.innerHTML = "";
    for (const [value, text] of OPTIONS) {
      native.appendChild(new Option(text, value));
    }
    native.value = OPTIONS.some(([value]) => value === currentValue) ? currentValue : "";
    native.setAttribute("aria-label", "Filter excavators by availability status");

    let hint = field.querySelector("small[data-availability-hint]");
    if (!hint) {
      hint = document.createElement("small");
      hint.dataset.availabilityHint = "true";
      field.appendChild(hint);
    }
    hint.textContent = "Catalogue only — this filter does not appear in Installment Finance.";
  }

  function boot() {
    run();
    const observer = new MutationObserver(() => window.setTimeout(run, 25));
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.setTimeout(() => observer.disconnect(), 300000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
