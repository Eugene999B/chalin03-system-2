(() => {
  const STYLE_ID = "chalin03-equipment-status-filter-v1";
  const FIELD_MARKER = "data-chalin03-status-filter";

  const LABELS = {
    "": "All excavators",
    not_for_sale: "Not offered for installment sale",
    available: "Available for a new installment",
    reserved: "Reserved / held for a transaction",
    installment_active: "Under installment agreement",
    sold: "Sold / completed sale",
    cancelled: "Cancelled / unavailable",
  };

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .equipment-catalogue__filters [data-chalin03-status-filter] {
        min-width: 0;
      }
      .equipment-catalogue__filters [data-chalin03-status-filter] > span {
        color: #6b5510;
      }
      .equipment-catalogue__filters [data-chalin03-status-filter] select {
        font-weight: 760;
        background-image: linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%);
        background-position: calc(100% - 18px) 50%, calc(100% - 12px) 50%;
        background-size: 6px 6px, 6px 6px;
        background-repeat: no-repeat;
        padding-right: 34px;
      }
      .equipment-catalogue__filters [data-chalin03-status-filter] select:focus {
        border-color: #b28a12;
        box-shadow: 0 0 0 3px rgba(178, 138, 18, 0.13);
      }
      @media (max-width: 980px) {
        .equipment-catalogue__filters [data-chalin03-status-filter] {
          grid-column: span 1;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function normalize(value) {
    return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  }

  function findStatusSelect() {
    const candidates = [...document.querySelectorAll(".equipment-catalogue__filters select")];
    return candidates.find((select) => {
      const values = [...select.options].map((option) => normalize(option.value));
      return values.some((value) => ["not_for_sale", "available", "reserved", "installment_active", "sold", "cancelled"].includes(value));
    }) || null;
  }

  function enhance() {
    const root = document.querySelector(".equipment-catalogue");
    if (!root) return;
    installStyles();

    const select = findStatusSelect();
    if (!select) return;

    const field = select.closest("label") || select.parentElement;
    if (field?.dataset.chalin03StatusFilter === "ready") return;
    if (field) field.dataset.chalin03StatusFilter = "ready";

    const label = field?.querySelector(":scope > span");
    if (label) label.textContent = "Availability status";

    const existingEmpty = [...select.options].find((option) => option.value === "");
    if (!existingEmpty) {
      select.insertBefore(new Option(LABELS[""], ""), select.options[0] || null);
    }

    const known = new Set();
    [...select.options].forEach((option) => {
      const key = normalize(option.value);
      if (Object.prototype.hasOwnProperty.call(LABELS, key)) {
        option.textContent = LABELS[key];
        known.add(key);
      }
    });

    ["cancelled"].forEach((value) => {
      if (!known.has(value)) select.appendChild(new Option(LABELS[value], value));
    });

    if (!select.getAttribute("aria-label")) select.setAttribute("aria-label", "Availability status");
    if (!select.value) select.value = "";
  }

  function boot() {
    enhance();
    const observer = new MutationObserver(() => window.setTimeout(enhance, 25));
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.setTimeout(() => observer.disconnect(), 300000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
