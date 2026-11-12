(() => {
  const STYLE_ID = "chalin03-finance-machine-register-enhancements-v5";

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .finance-simple__machine {
        display:flex !important;
        flex-direction:column !important;
        align-items:stretch !important;
        overflow:hidden !important;
        border-radius:18px !important;
      }
      .finance-simple__machine-grid {
        grid-template-columns:repeat(auto-fit,minmax(320px,1fr)) !important;
        align-items:start !important;
      }
      .finance-simple__machine-image {
        display:flex !important;
        align-items:center !important;
        justify-content:center !important;
        width:100% !important;
        height:clamp(220px,24vw,330px) !important;
        min-height:220px !important;
        aspect-ratio:auto !important;
        padding:16px !important;
        background:#eef3ef !important;
        overflow:hidden !important;
        position:relative !important;
      }
      .finance-simple__machine-image img {
        display:block !important;
        width:auto !important;
        height:auto !important;
        max-width:100% !important;
        max-height:100% !important;
        object-fit:contain !important;
        object-position:center !important;
        background:transparent !important;
        border-radius:12px !important;
      }
      .finance-simple__machine-body {
        position:static !important;
        display:block !important;
        width:100% !important;
        clear:both !important;
        background:#fff !important;
        padding:1rem 1rem 1.1rem !important;
      }
      .finance-simple__card-head {
        display:block !important;
        position:static !important;
      }
      .finance-simple__card-head > div {
        width:100% !important;
      }
      .finance-simple__card-head > span:last-child {
        display:none !important;
      }
      .finance-simple__machine-lifecycle {
        display:inline-flex !important;
        align-items:center !important;
        width:max-content !important;
        max-width:100% !important;
        margin:.65rem 0 .8rem !important;
        padding:.42rem .72rem !important;
        border-radius:999px !important;
        color:#fff !important;
        font-size:.75rem !important;
        font-weight:850 !important;
      }
      .finance-simple__machine-lifecycle.is-available { background:#187148 !important; }
      .finance-simple__machine-lifecycle.is-installment { background:#245f91 !important; }
      .finance-simple__machine-lifecycle.is-completed { background:#596474 !important; }
      .finance-simple__machine-lifecycle.is-unavailable { background:#8a5a1c !important; }
      .finance-simple__machine-lifecycle.is-review { background:#99621a !important; }
      .finance-simple__notice.is-info { display:none !important; }
      .finance-simple__facts { margin-top:.8rem !important; }

      /* Register/Edit/Details sheets must be owned by the viewport, never the sidebar/content tree. */
      body.chalin03-modal-open { overflow:hidden !important; }
      body > .equipment-catalogue__sheet-backdrop,
      .equipment-catalogue__sheet-backdrop[data-chalin03-portal="true"] {
        position:fixed !important;
        inset:0 !important;
        z-index:2147483000 !important;
        width:100vw !important;
        min-width:100vw !important;
        height:100dvh !important;
        min-height:100dvh !important;
        margin:0 !important;
        padding:clamp(14px,3vw,28px) !important;
        display:grid !important;
        place-items:center !important;
        overflow:hidden !important;
        box-sizing:border-box !important;
      }
      body > .equipment-catalogue__sheet-backdrop .equipment-catalogue__sheet,
      .equipment-catalogue__sheet-backdrop[data-chalin03-portal="true"] .equipment-catalogue__sheet {
        width:min(1120px, calc(100vw - 32px)) !important;
        max-width:1120px !important;
        height:min(90dvh, 900px) !important;
        max-height:calc(100dvh - 32px) !important;
        min-height:0 !important;
        margin:0 !important;
        overflow:hidden !important;
        box-sizing:border-box !important;
      }
      body > .equipment-catalogue__sheet-backdrop .equipment-catalogue__sheet-body,
      .equipment-catalogue__sheet-backdrop[data-chalin03-portal="true"] .equipment-catalogue__sheet-body {
        min-height:0 !important;
        max-height:none !important;
        height:calc(100% - 104px) !important;
        overflow-y:auto !important;
        overflow-x:hidden !important;
        overscroll-behavior:contain !important;
        -webkit-overflow-scrolling:touch !important;
        scrollbar-gutter:stable !important;
      }
      @media (max-width:720px) {
        body > .equipment-catalogue__sheet-backdrop,
        .equipment-catalogue__sheet-backdrop[data-chalin03-portal="true"] {
          padding:0 !important;
          place-items:end center !important;
        }
        body > .equipment-catalogue__sheet-backdrop .equipment-catalogue__sheet,
        .equipment-catalogue__sheet-backdrop[data-chalin03-portal="true"] .equipment-catalogue__sheet {
          width:100vw !important;
          max-width:100vw !important;
          height:min(94dvh,880px) !important;
          max-height:94dvh !important;
          border-radius:22px 22px 0 0 !important;
        }
        body > .equipment-catalogue__sheet-backdrop .equipment-catalogue__sheet-body,
        .equipment-catalogue__sheet-backdrop[data-chalin03-portal="true"] .equipment-catalogue__sheet-body {
          height:calc(100% - 96px) !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function normalize(value) {
    return String(value || "").toLowerCase().replace(/[\s_-]+/g, " ").trim();
  }

  function resolveLifecycle(card) {
    const statusFact = [...card.querySelectorAll(".finance-simple__facts > div")].find(
      (fact) => normalize(fact.querySelector("span")?.textContent) === "sale status"
    );
    const status = normalize(statusFact?.querySelector("strong")?.textContent);
    const locked = /held by finance application|editing locked/i.test(card.textContent || "");
    if (status.includes("installment active") || status.includes("installment") || locked) {
      return { text:"Under installment finance", className:"is-installment" };
    }
    if (status === "available") return { text:"Available for installment", className:"is-available" };
    if (status.includes("completed")) return { text:"Installment completed", className:"is-completed" };
    if (status.includes("sold") || status.includes("unavailable")) return { text:"Not available for a new installment", className:"is-unavailable" };
    return { text:"Finance review required", className:"is-review" };
  }

  function enhanceCard(card) {
    const body = card.querySelector(".finance-simple__machine-body");
    if (!body) return;
    const oldBadge = body.querySelector(".finance-simple__card-head > span:last-child");
    if (oldBadge) oldBadge.remove();
    let lifecycle = body.querySelector(".finance-simple__machine-lifecycle");
    if (!lifecycle) {
      lifecycle = document.createElement("span");
      lifecycle.className = "finance-simple__machine-lifecycle";
      const header = body.querySelector(".finance-simple__card-head");
      if (header) header.insertAdjacentElement("afterend", lifecycle);
      else body.prepend(lifecycle);
    }
    const resolved = resolveLifecycle(card);
    lifecycle.textContent = resolved.text;
    lifecycle.className = `finance-simple__machine-lifecycle ${resolved.className}`;
    body.querySelector(".finance-simple__notice.is-info")?.remove();
    const imageButton = card.querySelector(".finance-simple__machine-image");
    const image = imageButton?.querySelector("img");
    if (imageButton && image) {
      imageButton.style.aspectRatio = "auto";
      imageButton.style.height = "clamp(220px,24vw,330px)";
      image.style.width = "auto";
      image.style.height = "auto";
      image.style.maxWidth = "100%";
      image.style.maxHeight = "100%";
      image.style.objectFit = "contain";
    }
  }

  function portalEquipmentSheets() {
    if (!document.body) return;
    document.querySelectorAll(".equipment-catalogue__sheet-backdrop").forEach((backdrop) => {
      if (backdrop.parentElement !== document.body) {
        backdrop.dataset.chalin03Portal = "true";
        document.body.appendChild(backdrop);
      } else {
        backdrop.dataset.chalin03Portal = "true";
      }
    });
  }

  function enhanceAll() {
    installStyles();
    portalEquipmentSheets();
    document.querySelectorAll(".finance-simple__machine").forEach(enhanceCard);
  }

  function boot() {
    enhanceAll();
    const observer = new MutationObserver(() => {
      window.setTimeout(enhanceAll, 20);
    });
    observer.observe(document.documentElement, { childList:true, subtree:true });
    window.setTimeout(() => observer.disconnect(), 300000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once:true });
  } else {
    boot();
  }
})();
