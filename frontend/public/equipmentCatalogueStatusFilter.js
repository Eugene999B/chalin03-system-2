(() => {
  const STYLE_ID = "chalin03-equipment-status-filter-v2";
  const FIELD_MARKER = "data-chalin03-status-filter";
  const ROOT_SELECTOR = ".equipment-catalogue";
  const FILTER_SELECTOR = ".equipment-catalogue__filters";
  const STATUS_VALUES = new Set(["not_for_sale", "available", "reserved", "installment_active", "sold", "cancelled"]);

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
      .equipment-catalogue ${FILTER_SELECTOR} [data-chalin03-status-filter] {
        min-width: 0;
        padding: 10px 11px 11px;
        border: 1px solid rgba(11,132,87,.28);
        border-radius: 16px;
        background: linear-gradient(135deg, rgba(223,246,235,.96), rgba(255,255,255,.99));
      }
      .equipment-catalogue ${FILTER_SELECTOR} [data-chalin03-status-filter] > span {
        color: #086744;
        font-size: .76rem;
        font-weight: 900;
        letter-spacing: .055em;
        text-transform: uppercase;
      }
      .equipment-catalogue ${FILTER_SELECTOR} [data-chalin03-status-filter] select {
        display: block;
        width: 100%;
        min-height: 50px;
        margin-top: 7px;
        border: 1px solid rgba(11,132,87,.42);
        border-radius: 13px;
        color: #102239;
        background: #fff;
        font: inherit;
        font-weight: 820;
      }
      .equipment-catalogue ${FILTER_SELECTOR} [data-chalin03-status-filter] select:focus {
        border-color: #0b8457;
        outline: none;
        box-shadow: 0 0 0 3px rgba(11,132,87,.13);
      }
      .equipment-catalogue ${FILTER_SELECTOR} [data-chalin03-status-filter] small {
        display: block;
        margin-top: 5px;
        color: #4f6e61;
        font-size: .7rem;
        line-height: 1.35;
      }
    `;
    document.head.appendChild(style);
  }

  function normalize(value) {
    return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  }

  function findNativeStatusSelect(row) {
    return [...row.querySelectorAll("select")].find((select) =>
      [...select.options].some((option) => STATUS_VALUES.has(normalize(option.value)))
    ) || null;
  }

  function buildVisibleStatusFilter(row, nativeSelect) {
    let field = row.querySelector(`[${FIELD_MARKER}]`);
    if (!field) {
      field = document.createElement("label");
      field.setAttribute(FIELD_MARKER, "ready");
      const title = document.createElement("span");
      title.textContent = "Availability status";
      const select = document.createElement("select");
      select.setAttribute("aria-label", "Filter excavators by availability status");
      const hint = document.createElement("small");
      hint.textContent = "Excavator Catalogue only";
      field.append(title, select, hint);
      row.appendChild(field);
    }

    const visibleSelect = field.querySelector("select");
    if (!visibleSelect) return;

    const currentValue = nativeSelect?.value || visibleSelect.value || "";
    const options = ["", "available", "installment_active", "reserved", "sold", "not_for_sale"];
    visibleSelect.replaceChildren(
      ...options.map((value) => new Option(LABELS[value], value))
    );
    visibleSelect.value = options.includes(currentValue) ? currentValue : "";

    if (visibleSelect.dataset.bound !== "true") {
      visibleSelect.dataset.bound = "true";
      visibleSelect.addEventListener("change", () => {
        if (!nativeSelect) return;
        nativeSelect.value = visibleSelect.value;
        nativeSelect.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
  }

  function enhance() {
    const root = document.querySelector(ROOT_SELECTOR);
    if (!root) return;
    installStyles();

    const row = root.querySelector(FILTER_SELECTOR);
    if (!row) return;

    const nativeSelect = findNativeStatusSelect(row);
    if (!nativeSelect) return;

    buildVisibleStatusFilter(row, nativeSelect);

    const nativeField = nativeSelect.closest("label");
    if (nativeField) {
      nativeField.style.position = "absolute";
      nativeField.style.width = "1px";
      nativeField.style.height = "1px";
      nativeField.style.margin = "-1px";
      nativeField.style.padding = "0";
      nativeField.style.overflow = "hidden";
      nativeField.style.clip = "rect(0,0,0,0)";
      nativeField.style.whiteSpace = "nowrap";
      nativeField.setAttribute("aria-hidden", "true");
    }
  }

  function boot() {
    installStyles();
    enhance();
    const observer = new MutationObserver(() => window.setTimeout(enhance, 30));
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.setTimeout(() => observer.disconnect(), 300000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
