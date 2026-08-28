(() => {
  const STYLE_ID = "chalin03-finance-machine-register-enhancements-v3";
  const ENHANCED_ATTR = "data-chalin03-finance-machine-enhanced";
  let inFlight = null;
  let refreshTimer = null;

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .finance-simple__machine { display:flex !important; flex-direction:column !important; overflow:hidden !important; }
      .finance-simple__machine-image { position:relative !important; display:flex !important; align-items:center !important; justify-content:center !important; width:100% !important; height:auto !important; min-height:0 !important; aspect-ratio:auto !important; padding:14px !important; background:#eef3ef !important; overflow:hidden !important; border:0 !important; }
      .finance-simple__machine-image img { display:block !important; width:100% !important; height:auto !important; max-height:390px !important; object-fit:contain !important; object-position:center !important; background:transparent !important; border-radius:12px !important; }
      .finance-simple__machine-body { position:static !important; display:block !important; clear:both !important; width:100% !important; background:#fff !important; padding:1rem !important; }
      .finance-simple__card-head { position:static !important; }
      .finance-simple__machine-status { display:inline-flex !important; position:static !important; width:fit-content !important; margin:.45rem 0 .6rem !important; padding:.38rem .65rem !important; border-radius:999px !important; color:#fff !important; font-size:.76rem !important; font-weight:850 !important; }
      .finance-simple__machine-status.is-available { background:#187148 !important; }
      .finance-simple__machine-status.is-installment { background:#235b8f !important; }
      .finance-simple__machine-status.is-unavailable { background:#8a5a1c !important; }
      .finance-simple__machine-status.is-completed { background:#56606f !important; }
      .finance-simple__machine-status.is-review { background:#99621a !important; }
      .finance-simple__machine-body > small { display:none !important; }
      .finance-simple__notice.is-info { display:none !important; }
    `;
    document.head.appendChild(style);
  }

  async function fetchJson(url) {
    try {
      const response = await fetch(url, { credentials:"include", headers:{Accept:"application/json"} });
      return response.ok ? await response.json() : null;
    } catch { return null; }
  }

  function statusFor(machine, accounts) {
    const code = String(machine?.asset_code || "").trim().toLowerCase();
    const account = accounts.find(item => String(item?.asset_code || "").trim().toLowerCase() === code);
    const accountStatus = String(account?.agreement_status || "").toLowerCase();
    const outstanding = Number(account?.outstanding_balance || 0);
    const saleStatus = String(machine?.sale_status || "").toLowerCase().replace(/[\s_-]+/g, " ");
    if (account && outstanding > 0.01 && !["cancelled","completed"].includes(accountStatus)) return {text:"Under installment finance",className:"is-installment"};
    if (accountStatus === "completed" || (account && outstanding <= 0.01)) return {text:"Installment completed",className:"is-completed"};
    if (saleStatus === "available") return {text:"Available for installment",className:"is-available"};
    if (saleStatus.includes("installment")) return {text:"Under installment finance",className:"is-installment"};
    if (saleStatus.includes("sold") || saleStatus.includes("unavailable")) return {text:"Not available for a new installment",className:"is-unavailable"};
    return {text:"Finance review required",className:"is-review"};
  }

  function enhanceCards(machines, accounts) {
    document.querySelectorAll(".finance-simple__machine").forEach(card => {
      const body = card.querySelector(".finance-simple__machine-body");
      if (!body) return;
      const codeNode = body.querySelector(".finance-simple__pill");
      const code = String(codeNode?.textContent || "").trim().toLowerCase();
      const machine = machines.find(item => String(item?.asset_code || "").trim().toLowerCase() === code);
      if (!machine) return;
      const oldReadinessPill = body.querySelector(".finance-simple__card-head > span:last-child");
      const header = body.querySelector(".finance-simple__card-head");
      let status = body.querySelector(".finance-simple__machine-status");
      if (!status) {
        status = document.createElement("span");
        if (header) header.insertAdjacentElement("afterend", status); else body.prepend(status);
      }
      const resolved = statusFor(machine, accounts);
      status.textContent = resolved.text;
      status.className = `finance-simple__machine-status ${resolved.className}`;
      if (oldReadinessPill && oldReadinessPill !== status) oldReadinessPill.remove();
      body.querySelector(".finance-simple__notice.is-info")?.remove();
      const imageButton = card.querySelector(".finance-simple__machine-image");
      if (imageButton) {
        imageButton.style.aspectRatio = "auto";
        imageButton.style.height = "auto";
        const image = imageButton.querySelector("img");
        if (image) { image.style.height="auto"; image.style.maxHeight="390px"; image.style.objectFit="contain"; }
      }
      card.setAttribute(ENHANCED_ATTR,"true");
    });
  }

  async function enhance() {
    installStyles();
    if (!document.querySelector(".finance-simple__machine")) return;
    if (inFlight) return inFlight;
    inFlight = Promise.all([
      fetchJson("/api/equipment-catalogue/sales/phase-one/bootstrap"),
      fetchJson("/api/equipment-catalogue/sales/finance-lifecycle/accounts")
    ]).then(([machinesData,accountsData]) => enhanceCards(Array.isArray(machinesData?.machines)?machinesData.machines:[], normalizeAccounts(accountsData))).finally(()=>{inFlight=null;});
    return inFlight;
  }

  function normalizeAccounts(data) { return Array.isArray(data?.accounts) ? data.accounts : []; }
  function scheduleEnhance(){ window.clearTimeout(refreshTimer); refreshTimer=window.setTimeout(enhance,150); }
  function boot(){ installStyles(); enhance(); const observer=new MutationObserver(mutations=>{ const relevant=mutations.some(m=>[...m.addedNodes].some(n=>n.nodeType===1 && (n.matches?.(".finance-simple__machine") || n.querySelector?.(".finance-simple__machine")))); if(relevant) scheduleEnhance(); }); observer.observe(document.documentElement,{childList:true,subtree:true}); window.setTimeout(()=>observer.disconnect(),120000); }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",boot,{once:true}); else boot();
})();
