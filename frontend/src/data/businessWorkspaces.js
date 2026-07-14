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
    route: "/mining-operations",
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
    name: "Equipment Hire",
    shortName: "Equipment Hire",
    icon: "🚜",
    route: "/equipment-hire",
    status: "Operational",
    statusTone: "live",
    openRoute: "/equipment-hire-operations",
    requiresBranch: false,
    loginContextTitle: "Independent Equipment Hire Workspace",
    loginContextMessage:
      "No Spare Parts store is used. Hire yards, offices and work locations will be created and managed by an administrator inside Equipment Hire.",
    rolloutMessage:
      "The Equipment Hire workspace is ready. Log in to open the protected workspace.",
    description:
      "Quotations, contracts, dispatch, job cards, invoices, payments and returns.",
    accent: "blue",
    headline: "Run excavator and heavy-equipment hiring professionally.",
    summary:
      "The Equipment Hire workspace will manage the full customer journey from enquiry and quotation to equipment return, invoicing and debt follow-up while using the same shared machine register as Mining Operations.",
    modules: [
      {
        icon: "👥",
        title: "Hire Customers",
        description:
          "Store customer contacts, payment terms, credit limits and account history.",
      },
      {
        icon: "📝",
        title: "Quotations",
        description:
          "Prepare hourly, daily, weekly, monthly or fixed-price hire quotations.",
      },
      {
        icon: "📅",
        title: "Availability & Booking",
        description:
          "See machine availability and prevent overlapping mining and hire assignments.",
      },
      {
        icon: "🤝",
        title: "Contracts",
        description:
          "Control rates, deposits, dates, fuel responsibility, operators and terms.",
      },
      {
        icon: "🚚",
        title: "Dispatch & Mobilization",
        description:
          "Record release inspection, meter, fuel level, attachments and destination.",
      },
      {
        icon: "⏱️",
        title: "Work Logs & Job Cards",
        description:
          "Capture billable hours, idle time, breakdowns and customer confirmation.",
      },
      {
        icon: "🧾",
        title: "Invoices & Payments",
        description:
          "Create invoices, receive deposits and payments, and track outstanding balances.",
      },
      {
        icon: "🔍",
        title: "Return Inspection",
        description:
          "Record return condition, damage, fuel, missing items and final account.",
      },
    ],
    workflow: [
      "Register customers and receive an equipment enquiry.",
      "Check shared-fleet availability and prepare a quotation.",
      "Approve the contract, deposit and equipment assignment.",
      "Dispatch the machine and record approved daily work logs.",
      "Invoice, receive payments, inspect the return and close the contract.",
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
