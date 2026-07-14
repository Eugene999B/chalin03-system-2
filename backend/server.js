require("dotenv").config();

const express = require("express");
const cors = require("cors");

const { testDatabaseConnection } = require("./config/db");
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

const authRoutes = require("./routes/authRoutes");
const productRoutes = require("./routes/productRoutes");
const saleRoutes = require("./routes/saleRoutes");
const debtRoutes = require("./routes/debtRoutes");
const reportRoutes = require("./routes/reportRoutes");
const userRoutes = require("./routes/userRoutes");
const settingsRoutes = require("./routes/settingsRoutes");
const expenseRoutes = require("./routes/expenseRoutes");
const purchaseRoutes = require("./routes/purchaseRoutes");
const returnRoutes = require("./routes/returnRoutes");
const exportRoutes = require("./routes/exportRoutes");
const activityRoutes = require("./routes/activityRoutes");
const receiptRoutes = require("./routes/receiptRoutes");
const backupRoutes = require("./routes/backupRoutes");
const dailyClosingRoutes = require("./routes/dailyClosingRoutes");
const customerStatementRoutes = require("./routes/customerStatementRoutes");
const maintenanceRoutes = require("./routes/maintenanceRoutes");
const auditSignoffRoutes = require("./routes/auditSignoffRoutes");
const auditUnlockRequestRoutes = require("./routes/auditUnlockRequestRoutes");
const branchRoutes = require("./routes/branchRoutes");
const smsRoutes = require("./routes/smsRoutes");
const accountingIntelligenceRoutes = require("./routes/accountingIntelligenceRoutes");
const stockTransferRoutes = require("./routes/stockTransferRoutes");
const fleetRoutes = require("./routes/fleetRoutes");
const miningRoutes = require("./routes/miningRoutes");
const equipmentHireRoutes = require("./routes/equipmentHireRoutes");
const operationsDocumentRoutes = require("./routes/operationsDocumentRoutes");
const groupExecutiveRoutes = require("./routes/groupExecutiveRoutes");
const workspaceAdminRoutes = require("./routes/workspaceAdminRoutes");
const workspaceContextRoutes = require("./routes/workspaceContextRoutes");
const systemRoutes = require("./routes/systemRoutes");

const app = express();

app.set("trust proxy", 1);
app.disable("x-powered-by");

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3000",
  process.env.FRONTEND_URL,
  process.env.FRONTEND_URL_ALT,
]
  .filter(Boolean)
  .map((origin) => String(origin).trim())
  .filter((origin, index, array) => array.indexOf(origin) === index);

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
      "/api/branches",
      "/api/products",
      "/api/sales",
      "/api/debts",
      "/api/reports",
      "/api/users",
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
      "/api/maintenance",
      "/api/audit-signoffs",
      "/api/audit-unlock-requests",
      "/api/sms",
      "/api/fleet",
      "/api/mining",
      "/api/equipment-hire",
      "/api/operations-documents",
      "/api/group-executive",
      "/api/workspace-admin",
    ],
  });
});

/*
  Branch routes are registered before auth and user routes because login needs
  to load the store list before the user has a token.
*/
app.use("/api/branches", branchRoutes);

app.use("/api/auth/login", loginLimiter);
app.use("/api/backups/restore", sensitiveAdminLimiter);
app.use("/api/users", sensitiveAdminLimiter);
app.use("/api/workspace-admin", sensitiveAdminLimiter);
app.use("/api", systemRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/products", productRoutes);
app.use("/api/sales", saleRoutes);
app.use("/api/debts", debtRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/users", userRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/expenses", expenseRoutes);
app.use("/api/purchases", purchaseRoutes);
app.use("/api/returns", returnRoutes);
app.use("/api/exports", exportRoutes);
app.use("/api/activity-log", activityRoutes);
app.use("/api/receipts", receiptRoutes);
app.use("/api/backups", backupRoutes);
app.use("/api/daily-closing", dailyClosingRoutes);
app.use("/api/customer-statements", customerStatementRoutes);
app.use("/api/maintenance", maintenanceRoutes);
app.use("/api/audit-signoffs", auditSignoffRoutes);
app.use("/api/audit-unlock-requests", auditUnlockRequestRoutes);
app.use("/api/sms", smsRoutes);
app.use("/api/accounting-intelligence", accountingIntelligenceRoutes);
app.use("/api/stock-transfers", stockTransferRoutes);
app.use("/api/fleet", fleetRoutes);
app.use("/api/mining", miningRoutes);
app.use("/api/equipment-hire", equipmentHireRoutes);
app.use("/api/operations-documents", operationsDocumentRoutes);
app.use("/api/group-executive", groupExecutiveRoutes);
app.use("/api/workspace-admin", workspaceAdminRoutes);
app.use("/api/workspace-context", workspaceContextRoutes);


app.use(notFoundHandler);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    await testDatabaseConnection();
    await runStartupSelfCheck();

    app.listen(PORT, () => {
      console.log(`✅ Server running on port ${PORT}`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
      console.log(`🔐 Allowed frontend origins: ${allowedOrigins.join(", ")}`);
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

async function runStartupSelfCheck() {
  const missing = [];

  if (!process.env.JWT_SECRET) {
    missing.push("JWT_SECRET");
  }

  if (allowedOrigins.length === 0) {
    missing.push("FRONTEND_URL or local frontend origin");
  }

  if (missing.length > 0) {
    throw new Error(`Startup safety check failed. Missing: ${missing.join(", ")}`);
  }

  console.log("Startup self-check passed: auth secret and CORS origins configured.");
}

module.exports = {
  app,
  startServer,
  runStartupSelfCheck,
};
