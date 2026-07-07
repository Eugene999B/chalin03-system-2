require("dotenv").config();

const express = require("express");
const cors = require("cors");

const { testDatabaseConnection } = require("./config/db");
const { getSmsConfig } = require("./services/smsService");

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

const app = express();

app.set("trust proxy", 1);

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

app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

app.get("/", (req, res) => {
  res.json({
    status: "success",
    message: "Chalin 03 backend is running",
    environment: process.env.NODE_ENV || "development",
    time: new Date().toISOString(),
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "success",
    message: "Chalin 03 API is healthy",
    environment: process.env.NODE_ENV || "development",
    time: new Date().toISOString(),
  });
});

app.get("/api/debug/sms-env", (req, res) => {
  const config = getSmsConfig();

  res.json({
    status: "success",
    message: "SMS environment check. API key value is hidden for safety.",
    sms: {
      enabled: config.enabled,
      provider: config.provider,
      sender_id: config.senderId,
      has_arkesel_key: Boolean(config.arkeselApiKey),
      arkesel_base_url: config.arkeselBaseUrl,
      timeout_ms: config.timeoutMs,
    },
    raw_env: {
      SMS_ENABLED: process.env.SMS_ENABLED || null,
      SMS_PROVIDER: process.env.SMS_PROVIDER || null,
      SMS_SENDER_ID: process.env.SMS_SENDER_ID || null,
      SMS_ARKESEL_API_KEY_EXISTS: Boolean(process.env.SMS_ARKESEL_API_KEY),
      SMS_ARKESEL_BASE_URL: process.env.SMS_ARKESEL_BASE_URL || null,
    },
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
      "/api/debug/sms-env",
    ],
  });
});

/*
  Branch routes are registered before auth and user routes because login needs
  to load the store list before the user has a token.
*/
app.use("/api/branches", branchRoutes);

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

app.use((req, res) => {
  res.status(404).json({
    status: "error",
    message: "API route not found.",
    path: req.originalUrl,
  });
});

app.use((error, req, res, next) => {
  console.error("Unhandled server error:", error);

  if (error.message && error.message.startsWith("Not allowed by CORS")) {
    return res.status(403).json({
      status: "error",
      message: error.message,
      allowed_origins: allowedOrigins,
    });
  }

  return res.status(500).json({
    status: "error",
    message: error.message || "Something went wrong on the server.",
  });
});

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    await testDatabaseConnection();

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

startServer();