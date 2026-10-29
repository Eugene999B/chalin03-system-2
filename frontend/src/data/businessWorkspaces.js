export const businessWorkspaces = [
  {
    code: "spare_parts",
    name: "Spare Parts",
    shortName: "Spare Parts",
    icon: "🧰",
    route: "/login",
    openRoute: "/",
    requiresBranch: true,
    loginContextTitle: "Choose Spare Parts Store",
    loginContextMessage:
      "Select Main Store or Second Store. These stores belong only to the Spare Parts business.",
    status: "Live",
    statusTone: "live",
    description:
      "Sales, inventory, customers, debts, reports and two-store operations.",
    accent: "gold",
  },
  {
    code: "mining",
    name: "Mining Operations",
    shortName: "Mining",
    icon: "⛏️",
    route: "/login?workspace=mining",
    status: "Operational",
    statusTone: "live",
    openRoute: "/mining",
    requiresBranch: false,
    loginContextTitle: "Independent Mining Workspace",
    loginContextMessage:
      "No Spare Parts store is used. Mining sites will be created and managed by an administrator inside Mining Operations.",
    rolloutMessage:
      "The Mining Operations workspace is ready. Log in to open the protected workspace.",
    description:
      "Sites, production, fuel, equipment, expenses and safety operations.",
    accent: "earth",
    headline: "Control every mining site from one operational workspace.",
    summary:
      "The Mining Operations workspace will connect daily site activity, production, machines, fuel, people, costs, incidents and management reporting without changing the live spare-parts system.",
    modules: [
      {
        icon: "📍",
        title: "Sites & Daily Logs",
        description:
          "Manage mining sites, supervisors, shifts, operating notes and daily approvals.",
      },
      {
        icon: "📦",
        title: "Production & Stockpiles",
        description:
          "Record output, units, quality, stockpiles, dispatch and material movement.",
      },
      {
        icon: "🚜",
        title: "Equipment Activity",
        description:
          "Track machine assignments, working hours, idle time, downtime and operators.",
      },
      {
        icon: "⛽",
        title: "Fuel Control",
        description:
          "Record fuel receipts and issues, then flag unusual consumption and variances.",
      },
      {
        icon: "👷",
        title: "Workforce & Contractors",
        description:
          "Manage workers, attendance, roles, contractors and site assignments.",
      },
      {
        icon: "🛡️",
        title: "Safety & Incidents",
        description:
          "Capture incidents, immediate action, investigation, corrective action and closure.",
      },
      {
        icon: "💳",
        title: "Expenses & Site Cost",
        description:
          "Assign fuel, wages, repairs, transport and other costs to the correct site.",
      },
      {
        icon: "📊",
        title: "Reports & Intelligence",
        description:
          "Compare production, targets, fuel, equipment utilization, downtime and costs.",
      },
    ],
    workflow: [
      "Create mining sites and grant staff access.",
      "Register shared machines and current meter readings.",
      "Record each shift, production, fuel, equipment hours and expenses.",
      "Approve daily logs and investigate warnings.",
      "Review site and group-level management reports.",
    ],
  },
  {
    code: "equipment_hire",
    name: "Equipment Hire & Installment Finance",
    shortName: "Equipment Business",
    icon: "🚜",
    route: "/login?workspace=equipment_hire",
    status: "Operational",
    statusTone: "live",
    openRoute: "/equipment-hire",
    requiresBranch: false,
    loginContextTitle: "Open Your Assigned Equipment Division",
    loginContextMessage:
      "Sign in once, then the gateway checks the staff member's assigned division. Hire employees open only Equipment Hire Operations. Finance employees open only Equipment Installment Finance. Ordinary staff roles cannot work in both.",
    rolloutMessage:
      "The Equipment gateway is ready. Log in to open only the division assigned to your staff role.",
    description:
      "Two hard-separated staff divisions for equipment hiring and installment-finance operations.",
    accent: "blue",
    headline: "Keep every Hire job and every Finance account in its own division.",
    summary:
      "Equipment Hire owns Hire enquiries, Hire quotations, Hire contracts, dispatch, job cards, Hire invoices and returns. Equipment Installment Finance owns credit applications, KYC, approvals, installment accounts, collections and ownership. A reference-only equipment identity may be recognised by both divisions, but their staff work, documents, balances and audit actions never merge.",
    modules: [
      {
        icon: "🏗️",
        title: "Equipment Hire Operations",
        description:
          "Hire-only staff manage Hire enquiries, availability, quotations, contracts, dispatch, job cards, invoices, payments and returns.",
      },
      {
        icon: "🏦",
        title: "Equipment Installment Finance",
        description:
          "Finance-only staff manage credit applications, KYC, approvals, installment accounts, collections and ownership transfer.",
      },
      {
        icon: "🚜",
        title: "Reference-Only Equipment Identity",
        description:
          "Each physical machine keeps one identity, picture and status reference without turning a Hire job into a Finance account or a Finance account into a Hire job.",
      },
      {
        icon: "👥",
        title: "Independent Customer Transactions",
        description:
          "A known customer may be identified consistently, but Hire contracts and Finance accounts remain separate commercial records.",
      },
      {
        icon: "👔",
        title: "Division-Specific Staff",
        description:
          "Hire officers, dispatchers and Hire accountants cannot open Finance work. Finance staff cannot open Hire jobs, dispatch, invoices or returns.",
      },
      {
        icon: "🧾",
        title: "Separate Commercial Evidence",
        description:
          "Hire documents remain Hire evidence. Finance applications, agreements, receipts and ownership evidence remain Finance evidence.",
      },
      {
        icon: "📊",
        title: "Independent Reporting",
        description:
          "Hire utilisation and Hire revenue are reported separately from Finance portfolio, aging, risk and expected collections.",
      },
      {
        icon: "🛡️",
        title: "Server-Enforced Division Boundary",
        description:
          "The browser, routes and API independently reject cross-division access even when a staff member knows the other division's URL.",
      },
    ],
    workflow: [
      "Sign in to the protected Equipment Business gateway.",
      "The system checks the staff member's Hire-only or Finance-only role.",
      "Open only the assigned division's navigation, records and reports.",
      "Return to the gateway without carrying a job or account into the other division.",
      "The protected System Administrator remains the only account allowed to supervise both divisions.",
    ],
  },
];

export function getBusinessWorkspace(code) {
  return businessWorkspaces.find((workspace) => workspace.code === code) || null;
}

export function getWorkspaceHomeRoute(code) {
  const workspace = getBusinessWorkspace(code);
  return workspace?.openRoute || "/";
}
