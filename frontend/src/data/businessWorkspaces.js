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
    name: "Equipment Hire & Installment Finance",
    shortName: "Equipment Business",
    icon: "🚜",
    route: "/equipment-hire",
    status: "Operational",
    statusTone: "live",
    openRoute: "/equipment-hire",
    requiresBranch: false,
    loginContextTitle: "Choose Hire or Installment Finance",
    loginContextMessage:
      "Sign in once, then choose the independent Equipment Hire Operations or Equipment Installment Finance division. Both use the same protected customer, machine and location foundation without mixing their workflows.",
    rolloutMessage:
      "The Equipment business gateway is ready. Log in and choose Hire Operations or Installment Finance.",
    description:
      "Two independent divisions for equipment hiring and installment-finance operations.",
    accent: "blue",
    headline: "Choose the right equipment division for every customer journey.",
    summary:
      "Equipment Hire manages quotations, contracts, dispatch, work, invoicing and returns. Equipment Installment Finance manages applications, agreements, scheduled payments, collections and ownership. Machines, customers and authorised locations remain consistent underneath both divisions.",
    modules: [
      {
        icon: "🏗️",
        title: "Equipment Hire Operations",
        description:
          "Manage hire enquiries, availability, quotations, contracts, dispatch, job cards, invoices, payments and returns.",
      },
      {
        icon: "🏦",
        title: "Equipment Installment Finance",
        description:
          "Manage finance applications, equipment sales agreements, schedules, collections, reminders and ownership transfer.",
      },
      {
        icon: "📅",
        title: "Shared Equipment Availability",
        description:
          "Register each machine once and prevent an active hire assignment from conflicting with a sale or installment reservation.",
      },
      {
        icon: "👥",
        title: "Protected Customer Identity",
        description:
          "Reuse verified customer identities while keeping Hire contracts and Installment Finance accounts operationally separate.",
      },
      {
        icon: "🧾",
        title: "Commercial Documents",
        description:
          "Produce the correct quotation, contract, agreement, invoice, receipt, delivery and ownership evidence for each division.",
      },
      {
        icon: "🔔",
        title: "Collections & Notifications",
        description:
          "Follow up hire balances and installment obligations through the correct division, permissions and audit trail.",
      },
      {
        icon: "📊",
        title: "Independent Reporting",
        description:
          "Review hire utilisation and revenue separately from installment portfolio, aging, risk and expected collections.",
      },
      {
        icon: "🛡️",
        title: "Location & Permission Control",
        description:
          "Staff work only within authorised equipment locations and actions granted to their accounts.",
      },
    ],
    workflow: [
      "Sign in to the protected Equipment business workspace.",
      "Choose Equipment Hire Operations or Equipment Installment Finance.",
      "Work inside the selected division's dedicated navigation and controls.",
      "Switch divisions through the gateway without creating duplicate records.",
      "Review separate reports while management retains one consistent equipment register.",
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
