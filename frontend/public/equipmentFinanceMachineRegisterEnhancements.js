(() => {
  const STYLE_ID = "chalin03-finance-machine-register-enhancements-v1";

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .finance-pro__machine-image {
        min-height: 300px !important;
        height: auto !important;
        padding: 14px !important;
        align-items: center !important;
        justify-items: center !important;
        background: #eef2f7 !important;
      }
      .finance-pro__machine-image img {
        display: block !important;
        width: 100% !important;
        height: auto !important;
        max-height: 340px !important;
        object-fit: contain !important;
        object-position: center !important;
        background: transparent !important;
        border-radius: 10px !important;
      }
      .finance-pro__machine-body .finance-pro__machine-status {
        position: static !important;
        display: inline-flex !important;
        width: fit-content !important;
        margin: 10px 0 2px !important;
        padding: 6px 10px !important;
        border-radius: 999px !important;
        color: #fff !important;
        font-size: .72rem !important;
        font-weight: 800 !important;
        letter-spacing: .01em !important;
      }
      .finance-pro__machine-body .finance-pro__machine-status.is-available { background: #187148 !important; }
      .finance-pro__machine-body .finance-pro__machine-status.is-installment { background: #235b8f !important; }
      .finance-pro__machine-body .finance-pro__machine-status.is-unavailable { background: #8a5a1c !important; }
      .finance-pro__machine-body .finance-pro__machine-status.is-completed { background: #56606f !important; }
      .finance-pro__machine-body .finance-pro__machine-status.is-review { background: #99621a !important; }
    `;
    document.head.appendChild(style);
  }

  async function fetchJson(url) {
    try {
      const response = await fetch(url, { credentials: "include", headers: { Accept: "application/json" } });
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }

  function normalizeAccounts(data) {
    return Array.isArray(data?.accounts) ? data.accounts : [];
  }

  function statusFor(machine, accounts) {
    const code = String(machine?.asset_code || "").trim().toLowerCase();
    const account = accounts.find((item) => String(item?.asset_code || "").trim().toLowerCase() === code);
    const accountStatus = String(account?.agreement_status || "").toLowerCase();
    const outstanding = Number(account?.outstanding_balance || 0);

    if (account && outstanding > 0.01 && !["cancelled", "completed"].includes(accountStatus)) {
      return { text: "Under installment finance", className: "is-installment" };
    }
    if (accountStatus === "completed" || (account && outstanding <= 0.01)) {
      return { text: "Installment completed", className: "is-completed" };
    }
    if (String(machine?.sale_status || "").toLowerCase() === "available") {
      return { text: "Available for installment", className: "is-available" };
    }
    if (String(machine?.sale_status || "").trim()) {
      return { text: "Not available for a new installment", className: "is-unavailable" };
    }
    return { text: "Finance review required", className: "is-review" };
  }

  function enhanceCards(machines, accounts) {
    document.querySelectorAll(".finance-pro__machine-card").forEach((card) => {
      const body = card.querySelector(".finance-pro__machine-body");
      const codeNode = body?.querySelector(":scope > p");
      if (!body || !codeNode) return;
      const code = String(codeNode.textContent || "").trim().toLowerCase();
      const machine = machines.find((item) => String(item?.asset_code || "").trim().toLowerCase() === code);
      if (!machine) return;

      const image = card.querySelector(".finance-pro__machine-image");
      const oldStatus = image?.querySelector("b");
      let status = body.querySelector(".finance-pro__machine-status");
      if (!status) {
        status = document.createElement("span");
        status.className = "finance-pro__machine-status";
        body.insertBefore(status, body.querySelector("h3") || body.firstChild);
      }
      const resolved = statusFor(machine, accounts);
      status.textContent = resolved.text;
      status.className = `finance-pro__machine-status ${resolved.className}`;
      if (oldStatus) oldStatus.remove();

      const warning = body.querySelector("small");
      if (warning) {
        const cleaned = warning.textContent
          .replace(/Missing:\s*/i, "")
          .replace(/(^|,\s*)available sale status(,\s*|$)/gi, "")
          .replace(/\s+,/g, ",")
          .replace(/^\s*,\s*/, "")
          .trim();
        if (cleaned) warning.textContent = `Still needed: ${cleaned}`;
        else warning.remove();
      }
    });
  }

  async function enhance() {
    installStyles();
    if (!document.querySelector(".finance-pro__machine-card")) return;
    const [machinesData, accountsData] = await Promise.all([
      fetchJson("/api/equipment-catalogue/sales/professional/machine-register"),
      fetchJson("/api/equipment-catalogue/sales/finance-lifecycle/accounts"),
    ]);
    const machines = Array.isArray(machinesData?.machines) ? machinesData.machines : [];
    const accounts = normalizeAccounts(accountsData);
    enhanceCards(machines, accounts);
  }

  function boot() {
    enhance();
    const observer = new MutationObserver(() => enhance());
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.setTimeout(() => observer.disconnect(), 120000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
