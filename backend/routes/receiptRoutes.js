const express = require("express");
const PDFDocument = require("pdfkit");
const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");

const router = express.Router();

function formatMoney(value) {
  return Number(value || 0).toFixed(2);
}

function formatReceiptDate(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatReceiptTime(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

function formatPaymentMethod(value) {
  const paymentMethods = {
    cash: "Cash",
    momo: "MoMo",
    bank: "Bank",
    credit: "Credit",
    mixed: "Mixed",
  };

  return paymentMethods[String(value || "").toLowerCase()] || value || "-";
}

function safeText(value, fallback = "-") {
  if (value === undefined || value === null) {
    return fallback;
  }

  const text = String(value).trim();

  if (!text) {
    return fallback;
  }

  return text;
}

function isSaleVoided(sale) {
  return (
    Number(sale?.is_voided || 0) === 1 ||
    sale?.sale_status === "cancelled" ||
    sale?.sale_status === "voided"
  );
}

async function getSettings() {
  const [settingsRows] = await pool.query(
    `SELECT
      business_name,
      business_address,
      business_phone,
      owner_phone,
      receipt_footer
     FROM settings
     ORDER BY id ASC
     LIMIT 1`
  );

  if (settingsRows.length === 0) {
    return {
      business_name: "Chalin 03 Company Limited",
      business_address: "Dunkwa Police Barrier",
      business_phone: "0249469080 / 0249995510",
      owner_phone: "0543421127",
      receipt_footer: "Thank You For Coming",
    };
  }

  return settingsRows[0];
}

function addDashedLine(doc, y) {
  doc
    .moveTo(15, y)
    .lineTo(212, y)
    .dash(2, { space: 2 })
    .stroke()
    .undash();
}

function addRow(doc, label, value, y, options = {}) {
  const fontSize = options.fontSize || 8;
  const bold = options.bold || false;

  doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(fontSize);
  doc.text(label, 15, y, { width: 100 });
  doc.text(value, 115, y, { width: 95, align: "right" });
}

function addDetailRow(doc, label, value, y) {
  doc.font("Helvetica-Bold").fontSize(8).text(label, 15, y, { width: 70 });
  doc.font("Helvetica").fontSize(8).text(value, 85, y, { width: 125 });
}

// GET /api/receipts/sales/:id/pdf
router.get("/sales/:id/pdf", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const [sales] = await pool.query(
      `SELECT
        s.id,
        s.receipt_number,
        s.customer_name,
        s.customer_phone,
        s.subtotal,
        s.discount_amount,
        s.tax_amount,
        s.total,
        s.payment_type,
        s.amount_tendered,
        s.amount_paid,
        s.change_due,
        s.balance,
        s.sale_status,
        s.is_voided,
        s.void_reason,
        s.voided_at,
        s.created_at,
        u.full_name AS staff_name,
        vu.full_name AS voided_by_name
       FROM sales s
       LEFT JOIN users u ON s.staff_id = u.id
       LEFT JOIN users vu ON s.voided_by = vu.id
       WHERE s.id = ?
       LIMIT 1`,
      [id]
    );

    if (sales.length === 0) {
      return res.status(404).json({
        status: "error",
        message: "Sale not found.",
      });
    }

    const sale = sales[0];

    const [items] = await pool.query(
      `SELECT
        id,
        product_id,
        product_name,
        quantity,
        unit_price,
        line_total
       FROM sale_items
       WHERE sale_id = ?
       ORDER BY id ASC`,
      [id]
    );

    const settings = await getSettings();
    const voided = isSaleVoided(sale);

    const businessName =
      settings.business_name || "Chalin 03 Company Limited";
    const businessAddress =
      settings.business_address || "Dunkwa Police Barrier";
    const businessPhone =
      settings.business_phone || "0249469080 / 0249995510";
    const momoNumber = settings.owner_phone || "0543421127";
    const receiptFooter = settings.receipt_footer || "Thank You For Coming";

    const filename = `${sale.receipt_number || "receipt"}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename.replaceAll('"', "")}"`
    );

    const doc = new PDFDocument({
      size: [226.77, 700],
      margin: 10,
    });

    doc.pipe(res);

    let y = 15;

    doc
      .font("Helvetica-Bold")
      .fontSize(11)
      .text(String(businessName).toUpperCase(), 10, y, {
        width: 206,
        align: "center",
      });

    y += 18;

    doc.font("Helvetica").fontSize(8).text(businessAddress, 10, y, {
      width: 206,
      align: "center",
    });

    y += 12;

    doc.font("Helvetica").fontSize(8).text(`Tel: ${businessPhone}`, 10, y, {
      width: 206,
      align: "center",
    });

    y += 12;

    doc.font("Helvetica-Bold").fontSize(8).text(`MOMO #: ${momoNumber}`, 10, y, {
      width: 206,
      align: "center",
    });

    y += 16;

    if (voided) {
      doc.rect(15, y, 197, 55).stroke();

      doc
        .font("Helvetica-Bold")
        .fontSize(10)
        .text("VOIDED / CANCELLED SALE", 18, y + 7, {
          width: 191,
          align: "center",
        });

      doc
        .font("Helvetica")
        .fontSize(7)
        .text("This receipt is not counted as valid income.", 18, y + 22, {
          width: 191,
          align: "center",
        });

      doc
        .font("Helvetica")
        .fontSize(7)
        .text(`Reason: ${safeText(sale.void_reason)}`, 18, y + 34, {
          width: 191,
          align: "center",
        });

      y += 65;
    }

    addDashedLine(doc, y);
    y += 10;

    addDetailRow(
      doc,
      "Customer :",
      safeText(sale.customer_name, "Walk-in Customer"),
      y
    );
    y += 12;

    addDetailRow(doc, "Phone :", safeText(sale.customer_phone, "-"), y);
    y += 12;

    addDetailRow(doc, "Date :", formatReceiptDate(sale.created_at), y);
    y += 12;

    addDetailRow(doc, "Time :", formatReceiptTime(sale.created_at), y);
    y += 12;

    addDetailRow(doc, "Receipt No.:", safeText(sale.receipt_number), y);
    y += 12;

    addDetailRow(doc, "Payment :", formatPaymentMethod(sale.payment_type), y);
    y += 12;

    addDetailRow(doc, "Served by :", safeText(sale.staff_name), y);
    y += 14;

    addDashedLine(doc, y);
    y += 10;

    doc.font("Helvetica-Bold").fontSize(7);
    doc.text("Item Description", 15, y, { width: 85 });
    doc.text("Px", 103, y, { width: 35, align: "right" });
    doc.text("Qty", 140, y, { width: 25, align: "right" });
    doc.text("Amt", 167, y, { width: 45, align: "right" });

    y += 11;

    addDashedLine(doc, y);
    y += 8;

    doc.font("Helvetica").fontSize(7);

    for (const item of items) {
      const itemName = safeText(item.product_name).toUpperCase();

      const nameHeight = doc.heightOfString(itemName, {
        width: 85,
      });

      const rowHeight = Math.max(nameHeight, 10);

      if (y + rowHeight > 590) {
        doc.addPage({
          size: [226.77, 700],
          margin: 10,
        });

        y = 20;
      }

      doc.font("Helvetica").fontSize(7).text(itemName, 15, y, {
        width: 85,
      });

      doc.text(formatMoney(item.unit_price), 103, y, {
        width: 35,
        align: "right",
      });

      doc.text(String(item.quantity), 140, y, {
        width: 25,
        align: "right",
      });

      doc.text(formatMoney(item.line_total), 167, y, {
        width: 45,
        align: "right",
      });

      y += rowHeight + 4;
    }

    y += 3;
    addDashedLine(doc, y);
    y += 10;

    addRow(doc, "Sub Total", formatMoney(sale.subtotal), y);
    y += 12;

    addRow(doc, "Discount", formatMoney(sale.discount_amount), y);
    y += 12;

    addRow(doc, "Vat", formatMoney(sale.tax_amount), y);
    y += 12;

    addDashedLine(doc, y);
    y += 11;

    addRow(doc, "Amount Due", formatMoney(sale.total), y, {
      bold: true,
      fontSize: 9,
    });
    y += 13;

    addRow(doc, "Amount Tendered", formatMoney(sale.amount_tendered), y);
    y += 12;

    addRow(doc, "Amount Paid", formatMoney(sale.amount_paid), y);
    y += 12;

    addRow(doc, "Change Due", formatMoney(sale.change_due), y, {
      bold: Number(sale.change_due || 0) > 0,
      fontSize: Number(sale.change_due || 0) > 0 ? 9 : 8,
    });
    y += 12;

    addRow(doc, "Balance Outstanding", formatMoney(sale.balance), y);
    y += 14;

    if (voided) {
      addDashedLine(doc, y);
      y += 10;

      addRow(doc, "Valid Sales Total", "0.00", y, {
        bold: true,
        fontSize: 8,
      });

      y += 12;

      addRow(doc, "Valid Amount Paid", "0.00", y, {
        bold: true,
        fontSize: 8,
      });

      y += 14;

      if (sale.voided_by_name || sale.voided_at) {
        doc.font("Helvetica").fontSize(7);
        doc.text(`Voided by: ${safeText(sale.voided_by_name)}`, 15, y, {
          width: 197,
        });

        y += 10;

        doc.text(
          `Voided at: ${
            sale.voided_at ? new Date(sale.voided_at).toLocaleString() : "-"
          }`,
          15,
          y,
          {
            width: 197,
          }
        );

        y += 12;
      }
    }

    addDashedLine(doc, y);
    y += 18;

    doc
      .font("Helvetica-Bold")
      .fontSize(9)
      .text(receiptFooter, 15, y, {
        width: 197,
        align: "center",
      });

    y += 18;

    doc
      .font("Helvetica-BoldOblique")
      .fontSize(8)
      .text("IN GOD, WE TRUST", 15, y, {
        width: 197,
        align: "center",
      });

    y += 18;

    doc
      .font("Helvetica")
      .fontSize(6)
      .text("Powered by Chalin 03 System", 15, y, {
        width: 197,
        align: "center",
      });

    doc.end();
  } catch (error) {
    console.error("Receipt PDF error:", error);

    return res.status(500).json({
      status: "error",
      message: error.message || "Failed to generate receipt PDF.",
    });
  }
});

module.exports = router;
