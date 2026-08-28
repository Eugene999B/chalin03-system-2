(() => {
  const STYLE_ID = "chalin03-finance-machine-register-enhancements-v4";
  const ENHANCED_ATTR = "data-chalin03-finance-machine-enhanced";

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
      .finance-simple__machine-body > small { display:block !important; margin-top:.75rem !important; }
    `;
    document.head.appendChild(style);
  }

  function normalizeStatus(value) {
    return String(value || "").toLowerCase().replace(/[\\s_-]+/g, " ").trim();
  }

  function resolveLifecycle(card) {
    const facts = [...card.querySelectorAll(".finance-simple__facts > div")];
    const statusFact = facts.find((fact) => normalizeStatus(fact.querySelector("span")?.textContent) === "sale status");
    const status = normalizeStatus(statusFact?.querySelector("strong")?.textContent);
    const locked = /held by finance application|editing locked/i.test(card.textContent || "");
    if (status.includes("installment active") || status.includes("installment") || locked) return { text:"Under installment finance", className:"is-installment" };
    if (status === "available") return { text:"Available for installment", className:"is-available" };
    if (status.includes("completed")) return { text:"Installment completed", className:"is-completed" };
    if (status.includes("sold") || status.includes("unavailable")) return { text:"Not available for a new installment", className:"is-unavailable" };
    return { text:"Finance review required", className:"is-review" };
  }

  function enhanceCard(card) {
    const body = card.querySelector(".finance-simple__machine-body");
    if (!body) return;

    const oldBadge = body.querySelector(".finance-simple__card-head > span:last-child");
    if (oldBadge && !oldBadge.classList.contains("finance-simple__machine-lifecycle")) oldBadge.remove();

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
    card.setAttribute(ENHANCED_ATTR, "true");
  }

  function enhanceAll() {
    installStyles();
    document.querySelectorAll(".finance-simple__machine").forEach(enhanceCard);
  }

  function boot() {
    enhanceAll();
    const observer = new MutationObserver((mutations) => {
      const relevant = mutations.some((mutation) => [...mutation.addedNodes].some((node) => node.nodeType === 1 && (node.matches?.(".finance-simple__machine") || node.querySelector?.(".finance-simple__machine"))));
      if (relevant) window.setTimeout(enhanceAll, 50);
    });
    observer.observe(document.documentElement, { childList:true, subtree:true });
    window.setTimeout(() => observer.disconnect(), 300000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once:true });
  else boot();
})();
