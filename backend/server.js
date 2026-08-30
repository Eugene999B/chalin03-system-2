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
// Finance boss-alert delivery is intentionally required from server.js itself.
// Railway uses a custom Start Command, so this keeps the alert watcher active
// regardless of package.json or platform start-command overrides.
require("./services/equipmentFinanceBossAlertDeliveryBootstrap");

const authRoutes = require("./routes/authRoutes");
const passkeyRoutes = require("./routes/passkeyRoutes");
const productRoutes = require("./routes/productRoutes");
const saleRoutes = require("./routes/saleRoutes");
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