require("dotenv").config();

const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const { testDatabaseConnection } = require("./config/db");
const {
  validateStartupSecurity,
} = require("./config/startupSecurity");
const { requestContext } = require("./middleware/requestContext");
const {
  notFoundHandler,
  safeErrorResponseMiddleware,
  errorHandler,
} = require("./middleware/errorHandler");
const {
  buildSecurityMiddleware,
  loginLimiter,
  sensitiveAdminLimiter,
} = require("./middleware/securityMiddleware");
const { requireAuth } = require("./middleware/authMiddleware");
const {
  enforceEquipmentCatalogueWriteIntegrity,
} = require("./middleware/equipmentCatalogueIntegrityMiddleware");
const { requireWorkerCategoryRecord } = require("./middleware/workerCategoryMiddleware");
const {
  delegatedUserAdministrationGate,
  requireDelegatedCapability,
  requireDelegatedCapabilityForAdministrator,
} = require("./middleware/delegatedAdministrationMiddleware");
const {
  preventMiningSelfApproval,
  preventStockTransferSelfApproval,
} = require("./middleware/independentApprovalMiddleware");
const {
  requireSparePartsBranchContext,
} = require("./middleware/sparePartsBranchContextMiddleware");
const {
  reconcileCreditReturnDebts,
} = require("./middleware/creditReturnDebtReconciliationMiddleware");
const {
  requireWorkspaceCategory,
} = require("./services/categoryIsolationService");
const {
  validateProductionSchemaReadiness,
} = require("./services/productionSchemaReadinessService");

const authRoutes = require("./routes/authRoutes");
const passkeyRoutes = require("./routes/passkeyRoutes");
const productRoutes = require("./routes/productRoutesInventoryHardened");
const inventoryTraceabilityRoutes = require("./routes/inventoryTraceabilityRoutes");
const saleRoutes = require("./routes/saleRoutesInventoryHardened");
const debtRoutes = require("./routes/debtRoutes");
const customerDebtConsolidationRoutes = require("./routes/customerDebtConsolidationRoutes");
const debtReminderRoutes = require("./routes/debtReminderRoutes");
const reportRoutes = require("./routes/reportRoutes");
const userRoutes = require("./routes/userRoutes");
const userPermissionRoutes = require("./routes/userPermissionRoutes");
const delegatedAdministrationRoutes = require("./routes/delegatedAdministrationRoutes");
const settingsRoutes = require("./routes/settingsRoutes");
const expenseReversalRoutes = require("./routes/expenseReversalRoutes");
const expenseRoutes = require("./routes/expenseRoutes");
const purchaseRoutes = require("./routes/purchaseRoutes");
const returnRoutes = require("./routes/returnRoutes");
const exportRoutes = require("./routes/exportRoutes");
const activityRoutes = require("./routes/activityRoutes");
const receiptRoutes = require("./routes/receiptRoutes");
const delegatedBackupRoutes = require("./routes/delegatedBackupRoutes");
const backupOwnerStreamingRoutes = require("./routes/backupOwnerStreamingRoutes");
const backupRoutes = require("./routes/backupRoutes");
const dailyClosingRoutes = require("./routes/dailyClosingRoutes");
const customerStatementRoutes = require("./routes/customerStatementRoutes");
const customerDebtReportRoutes = require("./routes/customerDebtReportRoutes");
const customerStatementWorkspaceRoutes = require("./routes/customerStatementWorkspaceRoutes");
const maintenanceRoutes = require("./routes/maintenanceRoutes");
const auditSignoffRoutes = require("./routes/auditSignoffRoutes");
const auditUnlockRequestRoutes = require("./routes/auditUnlockRequestRoutes");
const branchRoutes = require("./routes/branchRoutes");
const smsRoutes = require("./routes/smsRoutes");
const accountingIntelligenceRoutes = require("./routes/accountingIntelligenceRoutes");
const stockTransferRoutes = require("./routes/stockTransferRoutes");
const fleetRoutes = require("./routes/fleetRoutes");
const miningRoutes = require("./routes/miningRoutes");
const miningControlRoutes = require("./routes/miningControlRoutes");
const equipmentHireRoutes = require("./routes/equipmentHireRoutes");
const hireCommercialRoutes = require("./routes/hireCommercialRoutes");
const equipmentCatalogueRoutes = require("./routes/equipmentCatalogueRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const sharedControlRoutes = require("./routes/sharedControlRoutes");
const operationsDocumentRoutes = require("./routes/operationsDocumentRoutes");
const groupExecutiveRoutes = require("./routes/groupExecutiveRoutes");
const ownerSecurityRoutes = require("./routes/ownerSecurityRoutes");
const release2FinalRoutes = require("./routes/release2FinalRoutes");
const groupConfigurationRoutes = require("./routes/groupConfigurationRoutes");
const workerProfileExpansionRoutes = require("./routes/workerProfileExpansionRoutes");
const workerPrintRoutes = require("./routes/workerPrintRoutes");
const workerHrLetterRoutes = require("./routes/workerHrLetterRoutes");
const workerHrPdfV2Routes = require("./routes/workerHrPdfV2Routes");
const standaloneHrDocumentRoutes = require("./routes/standaloneHrDocumentRoutes");
const documentSignatureRoutes = require("./routes/documentSignatureRoutes");
const workerCardVerificationRoutes = require("./routes/workerCardVerificationRoutes");
const workspaceAdminRoutes = require("./routes/workspaceAdminRoutes");
const workspaceContextRoutes = require("./routes/workspaceContextRoutes");
const systemRoutes = require("./routes/systemRoutes");
const installmentRoutes = require("./routes/installmentRoutes");
const payrollFoundationRoutes = require("./routes/payrollFoundationRoutes");
const payrollProcessingRoutes = require("./routes/payrollProcessingRoutes");
const { startInstallmentReminderScheduler } = require("./services/installmentReminderService");
const { startDebtReminderScheduler } = require("./services/debtReminderService");
const {
  startSmsDeliveryStatusSync,
} = require("./services/smsDeliveryStatusService");
const {
  startNotificationSyncScheduler,
} = require("./services/notificationSchedulerService");

const sparePartsBoundary = requireWorkspaceCategory("spare_parts");
const miningBoundary = requireWorkspaceCategory("mining");
const hireBoundary = requireWorkspaceCategory("equipment_hire");
const fleetBoundary = requireWorkspaceCategory("mining", "equipment_hire");
const payrollBoundary = requireWorkspaceCategory("spare_parts", "mining", "equipment_hire");

const app = express();

app.set("trust proxy", 1);
app.disable("x-powered-by");

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3000",
  "https://chalin03.com",
  "https://www.chalin03.com",
  process.env.FRONTEND_URL,
  process.env.FRONTEND_URL_ALT,
]
  .filter(Boolean)
  .map((origin) => String(origin).trim())
  .filter((origin, index, array) => array.indexOf(origin) === index);

const generalApiLimiter = rateLimit({
  windowMs:
    Math.max(1, Number(process.env.API_RATE_LIMIT_WINDOW_MINUTES) || 15) *
    60 *
    1000,
  max: Math.max(100, Number(process.env.API_RATE_LIMIT_MAX) || 1500),
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === "/health",
  message: {
    status: "error",
    code: "API_RATE_LIMITED",
    message: "Too many API requests. Please wait briefly and try again.",
  },
});

app.use(requestContext);
app.use(buildSecurityMiddleware());

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error(`Not allowed by CORS: ${origin}`));
    },
    credentials: true,
  })
);

// A generous global ceiling protects ordinary database and reporting routes
// from denial-of-service abuse. Login and sensitive administration retain
// their tighter dedicated limiters below.
app.use("/api", generalApiLimiter);

const bodyLimit = process.env.API_BODY_LIMIT || "10mb";

app.use(express.json({ limit: bodyLimit }));
app.use(express.urlencoded({ extended: true, limit: bodyLimit }));
app.use(safeErrorResponseMiddleware);

app.get("/", (req, res) => {
  res.json({
    status: "success",
    message: "Chalin 03 backend is running",
    environment: process.env.NODE_ENV || "development",
    time: new Date().toISOString(),
  });
});

app.get("/api", (req, res) => {
  res.json({
    status: "success",
    message: "Chalin 03 API root is working",
    routes: [
      "/api/auth",
      "/api/auth/passkeys",
      "/api/branches",
      "/api/products",
      "/api/inventory-traceability",
      "/api/sales",
      "/api/debts",
      "/api/debt-customers",
      "/api/debt-reminders",
      "/api/reports",
      "/api/users",
      "/api/user-permissions",
      "/api/delegated-administration",
      "/api/settings",
      "/api/expenses",
      "/api/purchases",
      "/api/returns",
      "/api/exports",
      "/api/activity-log",
      "/api/receipts",
      "/api/backups",
      "/api/daily-closing",
      "/api/customer-statements",
      "/api/customer-debt-reports",
      "/api/customer-statement-workspace",
      "/api/maintenance",
      "/api/audit-signoffs",
      "/api/audit-unlock-requests",
      "/api/sms",
      "/api/fleet",
      "/api/mining",
      "/api/mining-control",
      "/api/equipment-hire",
      "/api/hire-commercial",
      "/api/equipment-catalogue",
      "/api/notifications",
      "/api/shared-control",
      "/api/operations-documents",
      "/api/group-executive",
      "/api/group-configuration",
      "/api/release2-final",
      "/api/release2-final/standalone-hr",
      "/api/release2-final/document-signature",
      "/api/workspace-admin",
      "/api/payroll",
    ],
  });
});

/*
  Branch routes are registered before auth and user routes because login needs
  to load the store list before the user has a token.
*/
app.use("/api/branches", branchRoutes);

app.use("/api/auth/login", loginLimiter);
app.use("/api/auth/passkeys/authentication", loginLimiter);
app.use("/api/auth/forgot-password", loginLimiter);
app.use("/api/auth/recovery", loginLimiter);
app.use("/api/backups/restore", sensitiveAdminLimiter);
app.use("/api/release2-final/owner", loginLimiter);
app.use("/api/release2-final/security", sensitiveAdminLimiter);
app.use("/api/release2-final/backups", sensitiveAdminLimiter);
app.use("/api/release2-final/workers", sensitiveAdminLimiter);
app.use("/api/release2-final/workers", requireAuth, requireWorkerCategoryRecord);
app.use("/api/release2-final/workers-expanded", requireAuth, requireWorkerCategoryRecord);
app.use("/api/users", sensitiveAdminLimiter);
app.use("/api/user-permissions", sensitiveAdminLimiter);
app.use("/api/delegated-administration", sensitiveAdminLimiter);
app.use("/api/workspace-admin", sensitiveAdminLimiter);
app.use("/api/group-configuration", sensitiveAdminLimiter);
app.use("/api/payroll", sensitiveAdminLimiter);

app.use(
  "/api/release2-final/backups/history",
  requireAuth,
  requireDelegatedCapabilityForAdministrator("backup_download")
);
app.use(
  "/api/release2-final/backups/download",
  requireAuth,
  requireDelegatedCapabilityForAdministrator("backup_download")
);
app.use(
  "/api/release2-final/backups/verify",
  requireAuth,
  requireDelegatedCapabilityForAdministrator("backup_validate")
);

app.use(
  "/api/system/diagnostics",
  requireAuth,
  requireDelegatedCapability("system_operations")
);
app.use("/api", systemRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/auth/passkeys", passkeyRoutes);
app.use("/api/products", requireAuth, sparePartsBoundary, productRoutes);
app.use(
  "/api/inventory-traceability",
  requireAuth,
  sparePartsBoundary,
  inventoryTraceabilityRoutes
);
app.use("/api/sales", requireAuth, sparePartsBoundary, saleRoutes);
app.use("/api/installments", requireAuth, sparePartsBoundary, installmentRoutes);
app.use("/api/payroll", requireAuth, payrollBoundary, payrollFoundationRoutes);
app.use("/api/payroll", requireAuth, payrollBoundary, payrollProcessingRoutes);
app.use(
  "/api/debts",
  requireAuth,
  sparePartsBoundary,
  reconcileCreditReturnDebts,
  debtRoutes
);
app.use(
  "/api/debt-customers",
  requireAuth,
  sparePartsBoundary,
  reconcileCreditReturnDebts,
  customerDebtConsolidationRoutes
);
app.use(
  "/api/debt-reminders",
  requireAuth,
  sparePartsBoundary,
  reconcileCreditReturnDebts,
  debtReminderRoutes
);
app.use("/api/reports", requireAuth, sparePartsBoundary, reportRoutes);
app.use(
  "/api/users",
  requireAuth,
  sparePartsBoundary,
  delegatedUserAdministrationGate,
  userRoutes
);
app.use(
  "/api/user-permissions",
  requireAuth,
  requireDelegatedCapability("manage_permissions"),
  userPermissionRoutes
);
app.use("/api/delegated-administration", delegatedAdministrationRoutes);
app.use("/api/settings", requireAuth, sparePartsBoundary, settingsRoutes);
app.use(
  "/api/expenses",
  requireAuth,
  sparePartsBoundary,
  requireSparePartsBranchContext,
  expenseReversalRoutes,
  expenseRoutes
);
app.use("/api/purchases", requireAuth, sparePartsBoundary, purchaseRoutes);
app.use("/api/returns", requireAuth, sparePartsBoundary, returnRoutes);
app.use("/api/exports", exportRoutes);
app.use(
  "/api/activity-log",
  requireAuth,
  requireDelegatedCapabilityForAdministrator("audit_view"),
  activityRoutes
);
app.use("/api/receipts", requireAuth, sparePartsBoundary, receiptRoutes);
app.use("/api/backups", delegatedBackupRoutes);
app.use("/api/backups", backupOwnerStreamingRoutes);
app.use("/api/backups", backupRoutes);
app.use(
  "/api/daily-closing",
  requireAuth,
  sparePartsBoundary,
  requireSparePartsBranchContext,
  dailyClosingRoutes
);
app.use(
  "/api/customer-statements",
  requireAuth,
  sparePartsBoundary,
  reconcileCreditReturnDebts,
  customerStatementRoutes
);
app.use(
  "/api/customer-debt-reports",
  requireAuth,
  sparePartsBoundary,
  reconcileCreditReturnDebts,
  customerDebtReportRoutes
);
app.use(
  "/api/customer-statement-workspace",
  requireAuth,
  sparePartsBoundary,
  reconcileCreditReturnDebts,
  customerStatementWorkspaceRoutes
);
app.use("/api/maintenance", requireAuth, sparePartsBoundary, maintenanceRoutes);
app.use("/api/audit-signoffs", requireAuth, sparePartsBoundary, auditSignoffRoutes);
app.use("/api/audit-unlock-requests", requireAuth, sparePartsBoundary, auditUnlockRequestRoutes);
app.use("/api/sms", requireAuth, sparePartsBoundary, smsRoutes);
app.use("/api/accounting-intelligence", requireAuth, sparePartsBoundary, accountingIntelligenceRoutes);
app.use(
  "/api/stock-transfers",
  requireAuth,
  sparePartsBoundary,
  requireSparePartsBranchContext,
  preventStockTransferSelfApproval,
  stockTransferRoutes
);
app.use("/api/fleet", requireAuth, fleetBoundary, fleetRoutes);
app.use(
  "/api/mining",
  requireAuth,
  miningBoundary,
  preventMiningSelfApproval,
  miningRoutes
);
app.use("/api/mining-control", requireAuth, miningBoundary, miningControlRoutes);
app.use("/api/equipment-hire", requireAuth, hireBoundary, equipmentHireRoutes);
app.use("/api/hire-commercial", requireAuth, hireBoundary, hireCommercialRoutes);
app.use(
  "/api/equipment-catalogue",
  requireAuth,
  hireBoundary,
  enforceEquipmentCatalogueWriteIntegrity,
  equipmentCatalogueRoutes
);
app.use("/api/notifications", notificationRoutes);
app.use("/api/shared-control", sharedControlRoutes);
app.use("/api/operations-documents", operationsDocumentRoutes);
app.use("/api/group-executive", groupExecutiveRoutes);
app.use("/api/group-configuration", groupConfigurationRoutes);
app.use("/api/release2-final", workerCardVerificationRoutes);
app.use("/api/release2-final", workerProfileExpansionRoutes);
app.use("/api/release2-final", workerPrintRoutes);
// Register the compact signed-PDF and approval handlers before the legacy HR router.
app.use("/api/release2-final", workerHrPdfV2Routes);
app.use("/api/release2-final", standaloneHrDocumentRoutes);
app.use("/api/release2-final", documentSignatureRoutes);
app.use("/api/release2-final", workerHrLetterRoutes);
app.use("/api/release2-final", ownerSecurityRoutes);
app.use("/api/release2-final", release2FinalRoutes);
app.use(
  "/api/workspace-admin",
  requireAuth,
  fleetBoundary,
  delegatedUserAdministrationGate,
  workspaceAdminRoutes
);
app.use("/api/workspace-context", requireAuth, fleetBoundary, workspaceContextRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    await testDatabaseConnection();
    await runStartupSelfCheck();

    const schemaReadiness = await validateProductionSchemaReadiness();
    for (const warning of schemaReadiness.warnings) {
      console.warn(`Schema readiness warning: ${warning}`);
    }
    for (const warning of schemaReadiness.errors) {
      console.warn(`Development schema readiness warning: ${warning}`);
    }
    console.log(
      `Read-only schema readiness checked ${schemaReadiness.checked_tables.length} required table(s); runtime schema mutation is disabled.`
    );

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
      console.log(`Allowed frontend origins: ${allowedOrigins.join(", ")}`);
      startSmsDeliveryStatusSync();
      startInstallmentReminderScheduler();
      startDebtReminderScheduler();
      startNotificationSyncScheduler();
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

async function runStartupSelfCheck() {
  const result = validateStartupSecurity({
    env: process.env,
    allowedOrigins,
  });

  for (const warning of result.warnings) {
    console.warn(`Startup security warning: ${warning}`);
  }

  console.log(
    result.production
      ? result.strictProductionSecurity
        ? "Startup self-check passed: strict production secret enforcement is active."
        : "Startup self-check passed: production secret audit is in warning mode."
      : "Startup self-check passed: development configuration is usable."
  );

  return result;
}

module.exports = {
  app,
  startServer,
  runStartupSelfCheck,
};