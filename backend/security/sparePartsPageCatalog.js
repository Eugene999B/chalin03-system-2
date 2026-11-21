"use strict";
// Page availability is an additional condition; it never grants a financial action,
// changes branch access or bypasses an existing role/endpoint permission.
const SPARE_PARTS_PAGES = Object.freeze([
  {
    "id": "dashboard",
    "label": "Dashboard",
    "path": "/",
    "group": "Daily work",
    "roles": [
      "admin",
      "manager",
      "cashier",
      "staff"
    ],
    "gate": null,
    "permission": "page.spare_parts.dashboard.view"
  },
  {
    "id": "online_orders",
    "label": "Online Orders & Messages",
    "path": "/online-orders",
    "group": "Sales and stock",
    "roles": ["admin","manager","cashier","auditor","staff"],
    "gate": null,
    "permission": "page.spare_parts.online_orders.view"
  },
  {
    "id": "online_catalogue",
    "label": "Online Catalogue Control",
    "path": "/online-catalogue",
    "group": "Administration",
    "roles": ["admin"],
    "gate": null,
    "permission": "page.spare_parts.online_catalogue.view"
  },
  {
    "id": "products",
    "label": "Products",
    "path": "/products",
    "group": "Sales and stock",
    "roles": [
      "admin",
      "manager",
      "cashier",
      "auditor",
      "staff"
    ],
    "gate": null,
    "permission": "page.spare_parts.products.view"
  },
  {
    "id": "new_sale",
    "label": "New Sale",
    "path": "/new-sale",
    "group": "Sales and stock",
    "roles": [
      "admin",
      "manager",
      "cashier",
      "auditor"
    ],
    "gate": null,
    "permission": "page.spare_parts.new_sale.view"
  },
  {
    "id": "sales_history",
    "label": "Sales History",
    "path": "/sales-history",
    "group": "Sales and stock",
    "roles": [
      "admin",
      "manager",
      "cashier",
      "auditor"
    ],
    "gate": null,
    "permission": "page.spare_parts.sales_history.view"
  },
  {
    "id": "installments",
    "label": "Installment Sales",
    "path": "/installments",
    "group": "Sales and stock",
    "roles": [],
    "gate": "installments.view",
    "permission": "page.spare_parts.installments.view"
  },
  {
    "id": "debts",
    "label": "Debts",
    "path": "/debts",
    "group": "Sales and stock",
    "roles": [
      "admin",
      "manager",
      "cashier",
      "auditor"
    ],
    "gate": null,
    "permission": "page.spare_parts.debts.view"
  },
  {
    "id": "stock_transfers",
    "label": "Stock Transfers",
    "path": "/stock-transfers",
    "group": "Stock and purchases",
    "roles": [
      "admin",
      "manager",
      "auditor"
    ],
    "gate": null,
    "permission": "page.spare_parts.stock_transfers.view"
  },
  {
    "id": "low_stock",
    "label": "Low Stock / Restock",
    "path": "/low-stock",
    "group": "Stock and purchases",
    "roles": [
      "admin",
      "manager",
      "auditor"
    ],
    "gate": null,
    "permission": "page.spare_parts.low_stock.view"
  },
  {
    "id": "purchases",
    "label": "Purchases",
    "path": "/purchases",
    "group": "Stock and purchases",
    "roles": [
      "admin",
      "manager",
      "auditor"
    ],
    "gate": null,
    "permission": "page.spare_parts.purchases.view"
  },
  {
    "id": "returns",
    "label": "Returns",
    "path": "/returns",
    "group": "Stock and purchases",
    "roles": [
      "admin",
      "manager",
      "auditor"
    ],
    "gate": null,
    "permission": "page.spare_parts.returns.view"
  },
  {
    "id": "expenses",
    "label": "Expenses",
    "path": "/expenses",
    "group": "Finance and audit",
    "roles": [
      "admin",
      "manager",
      "auditor"
    ],
    "gate": null,
    "permission": "page.spare_parts.expenses.view"
  },
  {
    "id": "daily_closing",
    "label": "Daily Closing",
    "path": "/daily-closing",
    "group": "Finance and audit",
    "roles": [
      "admin",
      "manager",
      "auditor"
    ],
    "gate": null,
    "permission": "page.spare_parts.daily_closing.view"
  },
  {
    "id": "customer_statement",
    "label": "Customer Statement",
    "path": "/customer-statement",
    "group": "Finance and audit",
    "roles": [
      "admin",
      "manager",
      "auditor"
    ],
    "gate": null,
    "permission": "page.spare_parts.customer_statement.view"
  },
  {
    "id": "reports",
    "label": "Reports",
    "path": "/reports",
    "group": "Finance and audit",
    "roles": [
      "admin",
      "manager",
      "auditor"
    ],
    "gate": null,
    "permission": "page.spare_parts.reports.view"
  },
  {
    "id": "audit_accounting",
    "label": "Audit & Accounting",
    "path": "/audit-accounting",
    "group": "Finance and audit",
    "roles": [
      "admin",
      "manager",
      "auditor"
    ],
    "gate": null,
    "permission": "page.spare_parts.audit_accounting.view"
  },
  {
    "id": "audit_signoffs",
    "label": "Audit Sign-Off History",
    "path": "/audit-signoffs",
    "group": "Finance and audit",
    "roles": [
      "admin",
      "manager",
      "auditor"
    ],
    "gate": null,
    "permission": "page.spare_parts.audit_signoffs.view"
  },
  {
    "id": "advanced_accounting",
    "label": "Accounting Intelligence",
    "path": "/advanced-accounting-intelligence",
    "group": "Finance and audit",
    "roles": [
      "admin",
      "manager",
      "auditor"
    ],
    "gate": null,
    "permission": "page.spare_parts.advanced_accounting.view"
  },
  {
    "id": "stock_count",
    "label": "Blind Stock Count",
    "path": "/stock-count",
    "group": "Finance and audit",
    "roles": [
      "admin",
      "manager",
      "auditor"
    ],
    "gate": null,
    "permission": "page.spare_parts.stock_count.view"
  },
  {
    "id": "exports",
    "label": "Exports & Downloads",
    "path": "/exports",
    "group": "Finance and audit",
    "roles": [
      "admin",
      "manager",
      "auditor"
    ],
    "gate": null,
    "permission": "page.spare_parts.exports.view"
  },
  {
    "id": "activity_log",
    "label": "Activity Log",
    "path": "/activity-log",
    "group": "Finance and audit",
    "roles": [],
    "gate": "audit.view",
    "permission": "page.spare_parts.activity_log.view"
  },
  {
    "id": "shared_controls",
    "label": "Shared Reports & Documents",
    "path": "/shared-controls",
    "group": "Finance and audit",
    "roles": [],
    "gate": "shared.control.view",
    "permission": "page.spare_parts.shared_controls.view"
  },
  {
    "id": "workers",
    "label": "Worker Profiles",
    "path": "/workers",
    "group": "People and payroll",
    "roles": [],
    "gate": "workers.view",
    "permission": "page.spare_parts.workers.view"
  },
  {
    "id": "payroll",
    "label": "Payroll Processing",
    "path": "/payroll",
    "group": "People and payroll",
    "roles": [],
    "gate": "payroll.view",
    "permission": "page.spare_parts.payroll.view"
  },
  {
    "id": "employment_documents",
    "label": "Employment & HR Documents",
    "path": "/employment-documents",
    "group": "People and payroll",
    "roles": [],
    "gate": "workers.documents.view",
    "permission": "page.spare_parts.employment_documents.view"
  },
  {
    "id": "notifications",
    "label": "Notification Centre",
    "path": "/notifications",
    "group": "Everyday tools",
    "roles": [],
    "gate": "notifications.view",
    "permission": "page.spare_parts.notifications.view"
  },
  {
    "id": "change_password",
    "label": "Change Password",
    "path": "/change-password",
    "group": "Everyday tools",
    "roles": [
      "admin",
      "manager",
      "cashier",
      "auditor",
      "staff"
    ],
    "gate": null,
    "permission": "page.spare_parts.change_password.view"
  },
  {
    "id": "help",
    "label": "Help / User Guide",
    "path": "/help",
    "group": "Everyday tools",
    "roles": [
      "admin",
      "manager",
      "cashier",
      "auditor",
      "staff"
    ],
    "gate": null,
    "permission": "page.spare_parts.help.view"
  },
  {
    "id": "sms",
    "label": "SMS Centre",
    "path": "/sms",
    "group": "Administration",
    "roles": [
      "admin",
      "manager"
    ],
    "gate": null,
    "permission": "page.spare_parts.sms.view"
  },
  {
    "id": "audit_unlock",
    "label": "Audit Unlock Requests",
    "path": "/audit-unlock-requests",
    "group": "Administration",
    "roles": [
      "admin",
      "manager"
    ],
    "gate": null,
    "permission": "page.spare_parts.audit_unlock.view"
  },
  {
    "id": "users_settings",
    "label": "Users & Settings",
    "path": "/users-settings",
    "group": "Administration",
    "roles": [
      "admin"
    ],
    "gate": null,
    "permission": "page.spare_parts.users_settings.view"
  },
  {
    "id": "user_permissions",
    "label": "User Permissions",
    "path": "/user-permissions",
    "group": "Administration",
    "roles": [
      "admin"
    ],
    "gate": "users.permissions.manage",
    "permission": "page.spare_parts.user_permissions.view"
  },
  {
    "id": "backup",
    "label": "Backup & Restore",
    "path": "/backup",
    "group": "Administration",
    "roles": [
      "admin"
    ],
    "gate": "backup.download",
    "permission": "page.spare_parts.backup.view"
  },
  {
    "id": "professional_backups",
    "label": "Professional Backups",
    "path": "/professional-backups",
    "group": "Administration",
    "roles": [
      "admin"
    ],
    "gate": "backup.download",
    "permission": "page.spare_parts.professional_backups.view"
  },
  {
    "id": "security_centre",
    "label": "Security Centre",
    "path": "/security-centre",
    "group": "Administration",
    "roles": [
      "admin"
    ],
    "gate": "security.view",
    "permission": "page.spare_parts.security_centre.view"
  },
  {
    "id": "system_operations",
    "label": "System Operations",
    "path": "/system-operations",
    "group": "Administration",
    "roles": [
      "admin"
    ],
    "gate": "system.diagnostics",
    "permission": "page.spare_parts.system_operations.view"
  },
  {
    "id": "document_signature",
    "label": "Document Signature Settings",
    "path": "/document-signature-settings",
    "group": "Administration",
    "roles": [
      "admin"
    ],
    "gate": "security.admin",
    "permission": "page.spare_parts.document_signature.view"
  },
  {
    "id": "maintenance",
    "label": "System Maintenance",
    "path": "/maintenance",
    "group": "Administration",
    "roles": [
      "admin"
    ],
    "gate": null,
    "permission": "page.spare_parts.maintenance.view"
  }
]);
const SPARE_PARTS_PAGE_CODES = Object.freeze(SPARE_PARTS_PAGES.map(page => page.permission));
function defaultSparePartsPagePermissions(session, basePermissions = []) {
  const role = String(session?.role || "").trim().toLowerCase();
  const grants = new Set(basePermissions);
  return SPARE_PARTS_PAGES.filter(page =>
    (!page.roles.length || page.roles.includes(role)) &&
    (!page.gate || grants.has(page.gate))
  ).map(page => page.permission);
}
function sparePartsPageForPermission(code) {
  return SPARE_PARTS_PAGES.find(page => page.permission === code) || null;
}
module.exports = { SPARE_PARTS_PAGES, SPARE_PARTS_PAGE_CODES,
  defaultSparePartsPagePermissions, sparePartsPageForPermission };
