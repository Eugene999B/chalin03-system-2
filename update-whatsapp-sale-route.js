const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const filePath = path.join(__dirname, "backend", "routes", "saleRoutes.js");
const backupPath = path.join(
  __dirname,
  "backend",
  "routes",
  `saleRoutes.backup-before-whatsapp-${Date.now()}.js`
);

let code = fs.readFileSync(filePath, "utf8");
fs.writeFileSync(backupPath, code);

if (!code.includes("../services/whatsappService")) {
  code = code.replace(
    `} = require("../services/smsAlertService");`,
    `} = require("../services/smsAlertService");
const { sendSaleReceiptWhatsApp } = require("../services/whatsappService");`
  );
}

if (!code.includes("const whatsappReceipt = await sendSaleReceiptWhatsApp")) {
  code = code.replace(
    `    await connection.commit();

    return res.status(201).json({`,
    `    await connection.commit();

    const whatsappReceipt = await sendSaleReceiptWhatsApp({
      phone: finalCustomerPhone,
      customerName: finalCustomerName,
      receiptNumber,
      total,
    });

    return res.status(201).json({`
  );
}

if (!code.includes("whatsapp_receipt: whatsappReceipt")) {
  code = code.replace(
    `        created_at: new Date().toISOString(),
      },`,
    `        created_at: new Date().toISOString(),
        whatsapp_receipt: whatsappReceipt,
      },`
  );
}

fs.writeFileSync(filePath, code);

try {
  execFileSync("node", ["--check", filePath], { stdio: "inherit" });
  console.log("saleRoutes.js updated successfully.");
  console.log(`Backup created: ${backupPath}`);
} catch (error) {
  fs.writeFileSync(filePath, fs.readFileSync(backupPath, "utf8"));
  console.error("Update failed. Original saleRoutes.js restored.");
  process.exit(1);
}