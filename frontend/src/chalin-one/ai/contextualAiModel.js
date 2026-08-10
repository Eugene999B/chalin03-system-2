const CONTEXTS = Object.freeze({
  "spare_parts.operations": Object.freeze({
    key: "spare_parts.operations",
    title: "Spare Parts Operations",
    shortTitle: "Operations",
    accent: "Spare Parts",
    starters: Object.freeze([
      "What should I pay attention to in this branch right now?",
      "Explain the biggest operational signals and what they may mean.",
      "Compare the available sales, stock, expense and audit signals and highlight risks.",
    ]),
  }),
  "spare_parts.inventory": Object.freeze({
    key: "spare_parts.inventory",
    title: "Spare Parts Inventory",
    shortTitle: "Inventory",
    accent: "Spare Parts",
    starters: Object.freeze([
      "What inventory problems need attention right now?",
      "Which stock-control signals look unusual and why?",
      "Summarize low-stock, negative-stock and inventory-value health.",
    ]),
  }),
  "spare_parts.collections": Object.freeze({
    key: "spare_parts.collections",
    title: "Spare Parts Collections",
    shortTitle: "Collections",
    accent: "Spare Parts",
    starters: Object.freeze([
      "How healthy are collections and debt aging right now?",
      "What collection risks should management investigate?",
      "Explain the current collection-rate and overdue signals.",
    ]),
  }),
  "mining.operations": Object.freeze({
    key: "mining.operations",
    title: "Mining Operations",
    shortTitle: "Mining",
    accent: "Selected site",
    starters: Object.freeze([
      "What is happening at this mining site right now?",
      "Which operational signals should management investigate first?",
      "Summarize production, fuel, equipment, cost and incident health.",
    ]),
  }),
  "mining.stock_fuel": Object.freeze({
    key: "mining.stock_fuel",
    title: "Mining Stockpile & Fuel",
    shortTitle: "Stock & Fuel",
    accent: "Selected site",
    starters: Object.freeze([
      "What stockpile or fuel risks need attention now?",
      "Explain the current fuel and stockpile health signals.",
      "Where could stock or fuel constraints affect operations?",
    ]),
  }),
  "mining.production_cost": Object.freeze({
    key: "mining.production_cost",
    title: "Mining Production & Cost",
    shortTitle: "Production & Cost",
    accent: "Selected site",
    starters: Object.freeze([
      "How healthy are production and operating costs right now?",
      "What could explain the current production, utilization and cost signals?",
      "Which production or equipment indicators deserve investigation?",
    ]),
  }),
  "equipment_hire.operations": Object.freeze({
    key: "equipment_hire.operations",
    title: "Equipment Hire Operations",
    shortTitle: "Hire Operations",
    accent: "Selected location",
    starters: Object.freeze([
      "What needs attention in Equipment Hire right now?",
      "Summarize enquiries, contracts, fleet, work and closure health.",
      "Which operational risks should the Hire team investigate first?",
    ]),
  }),
  "equipment_hire.fleet": Object.freeze({
    key: "equipment_hire.fleet",
    title: "Equipment Hire Fleet",
    shortTitle: "Hire Fleet",
    accent: "Selected location",
    starters: Object.freeze([
      "How healthy is the hire fleet right now?",
      "Which utilization, maintenance or breakdown signals need attention?",
      "What could be reducing fleet availability or billable utilization?",
    ]),
  }),
  "equipment_hire.receivables": Object.freeze({
    key: "equipment_hire.receivables",
    title: "Equipment Hire Receivables",
    shortTitle: "Hire Receivables",
    accent: "Selected location",
    starters: Object.freeze([
      "How healthy are Hire collections and receivables right now?",
      "What overdue or uninvoiced-work risks need attention?",
      "Explain the current collection and outstanding-balance signals.",
    ]),
  }),
  "equipment_finance.portfolio": Object.freeze({
    key: "equipment_finance.portfolio",
    title: "Installment Finance Portfolio",
    shortTitle: "Finance Portfolio",
    accent: "Confidential aggregate",
    starters: Object.freeze([
      "How healthy is the installment portfolio right now?",
      "What portfolio risks should management investigate first?",
      "Summarize collections, balances, reconciliation and pipeline health.",
    ]),
  }),
  "equipment_finance.arrears": Object.freeze({
    key: "equipment_finance.arrears",
    title: "Installment Finance Arrears",
    shortTitle: "Finance Arrears",
    accent: "Confidential aggregate",
    starters: Object.freeze([
      "What does the current arrears position tell us?",
      "Which arrears-aging signals deserve management attention?",
      "Explain the overdue and outstanding-balance risk without exposing customers.",
    ]),
  }),
  "equipment_finance.cashflow": Object.freeze({
    key: "equipment_finance.cashflow",
    title: "Installment Finance Cash Flow",
    shortTitle: "Finance Cash Flow",
    accent: "Confidential aggregate",
    starters: Object.freeze([
      "How are actual collections tracking against expected cash flow?",
      "What cash-flow signals should management investigate?",
      "Summarize collection trends and scheduled payment expectations.",
    ]),
  }),
  "equipment_finance.sales_pipeline": Object.freeze({
    key: "equipment_finance.sales_pipeline",
    title: "Equipment Sales & Finance Pipeline",
    shortTitle: "Finance Pipeline",
    accent: "Confidential aggregate",
    starters: Object.freeze([
      "How healthy is the equipment sales and credit pipeline?",
      "Where are applications or sale-capable equipment getting stuck?",
      "Summarize KYC, affordability, risk and equipment-availability signals.",
    ]),
  }),
});

const NO_CONTEXT_PREFIXES = Object.freeze([
  "/login",
  "/owner-recovery",
  "/intelligence",
  "/content-studio",
  "/group-executive-control",
]);

function cleanPath(pathname) {
  const path = String(pathname || "/").split(/[?#]/)[0] || "/";
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

function includesSegment(path, segments) {
  return segments.some((segment) => path === segment || path.startsWith(`${segment}/`));
}

export function contextualAiProfileForPath(pathname) {
  const path = cleanPath(pathname);
  if (NO_CONTEXT_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    return null;
  }

  if (path === "/mining" || path.startsWith("/mining/")) {
    if (includesSegment(path, ["/mining/fuel"])) return CONTEXTS["mining.stock_fuel"];
    if (
      includesSegment(path, [
        "/mining/production",
        "/mining/equipment",
        "/mining/expenses",
        "/mining/incidents",
      ])
    ) {
      return CONTEXTS["mining.production_cost"];
    }
    return CONTEXTS["mining.operations"];
  }

  if (
    path === "/equipment-hire-operations" ||
    path.startsWith("/equipment-hire-operations/")
  ) {
    if (/\/(fleet|assets|maintenance|breakdowns?|returns?)(?:\/|$)/i.test(path)) {
      return CONTEXTS["equipment_hire.fleet"];
    }
    if (/\/(invoices?|payments?|receivables?|collections?)(?:\/|$)/i.test(path)) {
      return CONTEXTS["equipment_hire.receivables"];
    }
    return CONTEXTS["equipment_hire.operations"];
  }

  if (
    path === "/equipment-installment-finance" ||
    path.startsWith("/equipment-installment-finance/")
  ) {
    if (/\/(arrears|recovery|overdue)(?:\/|$)/i.test(path)) {
      return CONTEXTS["equipment_finance.arrears"];
    }
    if (/\/(payments?|collections?|cash-?flow|reports?)(?:\/|$)/i.test(path)) {
      return CONTEXTS["equipment_finance.cashflow"];
    }
    if (/\/(start|applications?|approvals?|excavators?|machines?|sales)(?:\/|$)/i.test(path)) {
      return CONTEXTS["equipment_finance.sales_pipeline"];
    }
    return CONTEXTS["equipment_finance.portfolio"];
  }

  if (
    includesSegment(path, [
      "/products",
      "/low-stock",
      "/stock-transfers",
      "/purchases",
      "/returns",
    ])
  ) {
    return CONTEXTS["spare_parts.inventory"];
  }
  if (
    includesSegment(path, [
      "/debts",
      "/customer-statement",
      "/installments",
    ])
  ) {
    return CONTEXTS["spare_parts.collections"];
  }
  if (
    path === "/staff" ||
    includesSegment(path, [
      "/new-sale",
      "/sales-history",
      "/reports",
      "/audit-accounting",
      "/advanced-accounting-intelligence",
      "/expenses",
      "/daily-closing",
      "/exports",
    ])
  ) {
    return CONTEXTS["spare_parts.operations"];
  }

  return null;
}

export function allContextualAiProfiles() {
  return Object.freeze(Object.values(CONTEXTS));
}

export { CONTEXTS, NO_CONTEXT_PREFIXES, cleanPath };
