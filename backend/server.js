const express = require("express");
const cors = require("cors");
require("dotenv").config();

const { testDatabaseConnection } = require("./config/db");

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

const app = express();

app.set("trust proxy", 1);

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3000",
  process.env.FRONTEND_URL,
]
  .filter(Boolean)
  .map((origin) => origin.trim());

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Not allowed by CORS"));
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

app.use((req, res) => {
  res.status(404).json({
    status: "error",
    message: "API route not found.",
    path: req.originalUrl,
  });
});

app.use((error, req, res, next) => {
  console.error("Unhandled server error:", error);

  res.status(500).json({
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
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
}

startServer();