const express = require("express");
const PDFDocument = require("pdfkit");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { validateRequest } = require("../middleware/requestValidationMiddleware");
const {
  validateStockTransferActionRequest,
  validateStockTransferCreateRequest,
} = require("../validation/operationsRequestValidators");
const {
  assertLegacyQuantityTransferAllowed,
} = require("../services/inventoryTransferTraceabilityService");

const router = express.Router();

function asyncHandler(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      console.error("Stock transfer route error:", error);

      res.status(500).json({
        status: "error",
        message:
          error.message ||
          "Something went wrong while processing the stock transfer request.",
      });
    }
  };
}

function cleanText(value) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
}

function toPositiveInt(value) {
  const number = Number(value);

  if (!Number.isInteger(number) || number <= 0) {
    return null;
  }

  return number;
}

function toSafeLimit(value, fallback = 50) {
  const number = Number(value);

  if (!Number.isInteger(number) || number <= 0) {
    return fallback;
  }

  return Math.min(number, 200);
}

function getUserId(req) {
  return req.user?.id || req.user?.user_id || null;
}

function getUserRole(req) {
  return String(req.user?.role || "").toLowerCase();
}

function getSelectedBranchId(req) {
  const branchId = Number(
    req.user?.branch_id ||
      req.user?.default_branch_id ||
      req.user?.selected_branch_id ||
      req.headers["x-branch-id"] ||
      0
  );

  if (!Number.isInteger(branchId) || branchId <= 0) {
    return null;
  }

  return branchId;
}

function userCanAccessAllBranches(req) {
  const role = getUserRole(req);

  if (role === "admin") {
    return true;
  }

  return (
    req.user?.can_access_all_branches === true ||
    req.user?.canAccessAllBranches === true ||
    Number(req.user?.can_access_all_branches) === 1 ||
    Number(req.user?.canAccessAllBranches) === 1
  );
}

function requireAdminOrManager(req, res, next) {
  const role = getUserRole(req);

  if (!["admin", "manager"].includes(role)) {
    return res.status(403).json({
      status: "error",
      message: "Only admin or manager can manage stock transfers.",
    });
  }

  next();
}

function assertBranchAccess(req, res, branchIds) {
  if (userCanAccessAllBranches(req)) {
    return true;
  }

  const selectedBranchId = getSelectedBranchId(req);

  if (!selectedBranchId) {
    res.status(400).json({
      status: "error",
      message:
        "No store selected. Please logout, choose a store, and login again.",
    });

    return false;
  }

  const allowed = branchIds.some(
    (branchId) => Number(branchId) === selectedBranchId
  );

  if (!allowed) {
    res.status(403).json({
      status: "error",
      message:
        "You can only manage stock transfers connected to your selected store.",
    });

    return false;
  }

  return true;
}

function generateTransferNumber() {
  const now = new Date();

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hour = String(now.getHours()).padStart(2, "0");
  const minute = String(now.getMinutes()).padStart(2, "0");
  const second = String(now.getSeconds()).padStart(2, "0");
  const random = Math.floor(1000 + Math.random() * 9000);

  return `TRF-${year}${month}${day}-${hour}${minute}${second}-${random}`;
}

function getProductName(product) {
  return (
    cleanText(product?.name) ||
    cleanText(product?.product_name) ||
    cleanText(product?.item_name) ||
    `Product #${product?.id || ""}`
  );
}

function getProductCategory(product) {
  return cleanText(product?.category) || cleanText(product?.category_name);
}

function getProductSize(product) {
  return cleanText(product?.size) || cleanText(product?.product_size);
}

function getProductBarcode(product) {
  return cleanText(product?.barcode);
}

function getQuantity(product) {
  return Number(product?.quantity || 0);
}

function normalizeTransferItems(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item) => {
      const productId = toPositiveInt(
        item.source_product_id || item.product_id || item.id
      );

      const quantity = toPositiveInt(
        item.requested_quantity || item.quantity || item.transfer_quantity
      );

      return {
        source_product_id: productId,
        requested_quantity: quantity,
        item_note: cleanText(item.item_note || item.note),
      };
    })
    .filter((item) => item.source_product_id && item.requested_quantity);
}

function safePdfText(value, fallback = "—") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function formatPdfDate(value) {
  if (!value) {
    return "—";
  }

  try {
    return new Date(value).toLocaleString("en-GB", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(value);
  }
}

function sanitizeFilename(value) {
  return String(value || "stock-transfer")
    .replace(/[^a-z0-9-_]/gi, "_")
    .slice(0, 80);
}

function drawLine(doc, y) {
  doc
    .moveTo(40, y)
    .lineTo(555, y)
    .strokeColor("#d1d5db")
    .lineWidth(1)
    .stroke()
    .strokeColor("#000000");
}

function drawTransferPdf(doc, transfer) {
  const status = String(transfer.status || "").toUpperCase();

  doc.fontSize(18).font("Helvetica-Bold").text("CHALIN 03 COMPANY LIMITED", {
    align: "center",
  });

  doc
    .fontSize(10)
    .font("Helvetica")
    .text("Sales & Inventory Management System", { align: "center" });

  doc.moveDown(0.8);

  doc
    .fontSize(15)
    .font("Helvetica-Bold")
    .text("STOCK TRANSFER NOTE", { align: "center" });

  doc.moveDown(0.5);
  drawLine(doc, doc.y);
  doc.moveDown(0.8);

  doc.fontSize(10).font("Helvetica-Bold").text("Transfer Details");
  doc.moveDown(0.4);

  const startY = doc.y;

  doc.fontSize(9);

  doc.font("Helvetica-Bold").text("Transfer No:", 40, startY);
  doc.font("Helvetica").text(safePdfText(transfer.transfer_number), 130, startY);

  doc.font("Helvetica-Bold").text("Status:", 350, startY);
  doc.font("Helvetica").text(status, 420, startY);

  doc.font("Helvetica-Bold").text("Requested:", 40, startY + 18);
  doc
    .font("Helvetica")
    .text(formatPdfDate(transfer.requested_at), 130, startY + 18);

  doc.font("Helvetica-Bold").text("Requested By:", 350, startY + 18);
  doc
    .font("Helvetica")
    .text(safePdfText(transfer.requested_by_name), 440, startY + 18);

  doc.font("Helvetica-Bold").text("Approved:", 40, startY + 36);
  doc
    .font("Helvetica")
    .text(formatPdfDate(transfer.approved_at), 130, startY + 36);

  doc.font("Helvetica-Bold").text("Approved By:", 350, startY + 36);
  doc
    .font("Helvetica")
    .text(safePdfText(transfer.approved_by_name), 440, startY + 36);

  doc.font("Helvetica-Bold").text("Dispatched:", 40, startY + 54);
  doc
    .font("Helvetica")
    .text(formatPdfDate(transfer.dispatched_at), 130, startY + 54);

  doc.font("Helvetica-Bold").text("Dispatched By:", 350, startY + 54);
  doc
    .font("Helvetica")
    .text(safePdfText(transfer.dispatched_by_name), 440, startY + 54);

  doc.font("Helvetica-Bold").text("Received:", 40, startY + 72);
  doc
    .font("Helvetica")
    .text(formatPdfDate(transfer.received_at), 130, startY + 72);

  doc.font("Helvetica-Bold").text("Received By:", 350, startY + 72);
  doc
    .font("Helvetica")
    .text(safePdfText(transfer.received_by_name), 440, startY + 72);

  doc.y = startY + 100;
  drawLine(doc, doc.y);
  doc.moveDown(0.8);

  doc.fontSize(10).font("Helvetica-Bold").text("Store Movement");
  doc.moveDown(0.4);

  doc.fontSize(9).font("Helvetica-Bold").text("From Store:");
  doc
    .font("Helvetica")
    .text(
      `${safePdfText(transfer.from_branch_code)} — ${safePdfText(
        transfer.from_branch_name
      )}`
    );

  if (transfer.from_branch_location) {
    doc.text(safePdfText(transfer.from_branch_location));
  }

  doc.moveDown(0.5);

  doc.font("Helvetica-Bold").text("To Store:");
  doc
    .font("Helvetica")
    .text(
      `${safePdfText(transfer.to_branch_code)} — ${safePdfText(
        transfer.to_branch_name
      )}`
    );

  if (transfer.to_branch_location) {
    doc.text(safePdfText(transfer.to_branch_location));
  }

  doc.moveDown(0.8);
  drawLine(doc, doc.y);
  doc.moveDown(0.8);

  doc.fontSize(10).font("Helvetica-Bold").text("Items Transferred");
  doc.moveDown(0.5);

  const tableTop = doc.y;
  const columns = {
    item: 40,
    requested: 300,
    dispatched: 370,
    received: 445,
    sourceStock: 505,
  };

  doc.fontSize(8).font("Helvetica-Bold");
  doc.text("Item", columns.item, tableTop);
  doc.text("Req", columns.requested, tableTop);
  doc.text("Disp", columns.dispatched, tableTop);
  doc.text("Rec", columns.received, tableTop);
  doc.text("Source", columns.sourceStock, tableTop);

  drawLine(doc, tableTop + 14);

  let y = tableTop + 22;

  const items = Array.isArray(transfer.items) ? transfer.items : [];

  if (items.length === 0) {
    doc.font("Helvetica").text("No items found.", 40, y);
    y += 18;
  }

  items.forEach((item, index) => {
    if (y > 710) {
      doc.addPage();

      y = 50;

      doc.fontSize(8).font("Helvetica-Bold");
      doc.text("Item", columns.item, y);
      doc.text("Req", columns.requested, y);
      doc.text("Disp", columns.dispatched, y);
      doc.text("Rec", columns.received, y);
      doc.text("Source", columns.sourceStock, y);

      drawLine(doc, y + 14);
      y += 22;
    }

    const itemTitle = `${index + 1}. ${safePdfText(item.product_name)}`;
    const itemSub = [item.category, item.size, item.barcode]
      .filter(Boolean)
      .join(" • ");

    doc.fontSize(8).font("Helvetica-Bold").fillColor("#000000");
    doc.text(itemTitle, columns.item, y, {
      width: 245,
    });

    if (itemSub) {
      doc
        .fontSize(7)
        .font("Helvetica")
        .fillColor("#475569")
        .text(itemSub, columns.item + 12, y + 11, { width: 235 })
        .fillColor("#000000");
    }

    doc.fontSize(8).font("Helvetica").fillColor("#000000");
    doc.text(String(item.requested_quantity || 0), columns.requested, y);
    doc.text(String(item.dispatched_quantity ?? "—"), columns.dispatched, y);
    doc.text(String(item.received_quantity ?? "—"), columns.received, y);

    const sourceStock =
      item.source_quantity_before !== null &&
      item.source_quantity_before !== undefined
        ? `${item.source_quantity_before} → ${item.source_quantity_after}`
        : "—";

    doc.text(sourceStock, columns.sourceStock, y, { width: 60 });

    y += itemSub ? 34 : 24;
  });

  doc.y = y + 8;
  drawLine(doc, doc.y);
  doc.moveDown(0.8);

  doc.fontSize(10).font("Helvetica-Bold").text("Notes");
  doc.moveDown(0.3);

  doc.fontSize(8).font("Helvetica");
  doc.text(`Request Note: ${safePdfText(transfer.request_note)}`);
  doc.text(`Approval Note: ${safePdfText(transfer.approval_note)}`);
  doc.text(`Dispatch Note: ${safePdfText(transfer.dispatch_note)}`);
  doc.text(`Receive Note: ${safePdfText(transfer.receive_note)}`);
  doc.text(`Cancel Note: ${safePdfText(transfer.cancel_note)}`);
  doc.text(`Reject Note: ${safePdfText(transfer.reject_note)}`);

  doc.moveDown(1.2);

  if (doc.y > 700) {
    doc.addPage();
  }

  doc.fontSize(9).font("Helvetica-Bold").text("Signatures");
  doc.moveDown(1);

  const signatureY = doc.y;

  doc.fontSize(8).font("Helvetica");
  doc.text("Source Store Officer", 40, signatureY + 30);
  doc.moveTo(40, signatureY + 25).lineTo(210, signatureY + 25).stroke();

  doc.text("Destination Store Officer", 310, signatureY + 30);
  doc.moveTo(310, signatureY + 25).lineTo(520, signatureY + 25).stroke();

  doc
    .fontSize(7)
    .fillColor("#64748b")
    .text(
      "This transfer note was generated by the Chalin 03 Sales & Inventory Management System.",
      40,
      780,
      { align: "center", width: 515 }
    )
    .fillColor("#000000");
}

async function getBranch(connection, branchId) {
  const [rows] = await connection.query(
    `
      SELECT id, branch_code, name, location
      FROM branches
      WHERE id = ?
      LIMIT 1
    `,
    [branchId]
  );

  return rows[0] || null;
}

async function requireBranch(connection, branchId, label) {
  const branch = await getBranch(connection, branchId);

  if (!branch) {
    throw new Error(`${label} store was not found.`);
  }

  return branch;
}

async function getSourceProduct(
  connection,
  productId,
  branchId,
  lockForUpdate = false
) {
  const lockSql = lockForUpdate ? "FOR UPDATE" : "";

  const [rows] = await connection.query(
    `
      SELECT *
      FROM products
      WHERE id = ?
        AND branch_id = ?
      LIMIT 1
      ${lockSql}
    `,
    [productId, branchId]
  );

  return rows[0] || null;
}

async function findDestinationProduct(connection, item, toBranchId) {
  if (item.destination_product_id) {
    const [directRows] = await connection.query(
      `
        SELECT *
        FROM products
        WHERE id = ?
          AND branch_id = ?
        LIMIT 1
        FOR UPDATE
      `,
      [item.destination_product_id, toBranchId]
    );

    if (directRows[0]) {
      return directRows[0];
    }
  }

  const barcode = cleanText(item.barcode);

  if (barcode) {
    const [barcodeRows] = await connection.query(
      `
        SELECT *
        FROM products
        WHERE branch_id = ?
          AND barcode = ?
        LIMIT 1
        FOR UPDATE
      `,
      [toBranchId, barcode]
    );

    if (barcodeRows[0]) {
      return barcodeRows[0];
    }
  }

  const productName = cleanText(item.product_name);
  const category = cleanText(item.category);
  const size = cleanText(item.size);

  const [nameRows] = await connection.query(
    `
      SELECT *
      FROM products
      WHERE branch_id = ?
        AND LOWER(name) = LOWER(?)
        AND IFNULL(category, '') = ?
        AND IFNULL(size, '') = ?
      LIMIT 1
      FOR UPDATE
    `,
    [toBranchId, productName, category, size]
  );

  return nameRows[0] || null;
}

async function createDestinationProductCopy(
  connection,
  sourceProduct,
  toBranchId
) {
  const [columns] = await connection.query("SHOW COLUMNS FROM products");

  const allowedFields = columns.map((column) => column.Field);
  const skipFields = new Set([
    "id",
    "quantity",
    "branch_id",
    "created_at",
    "updated_at",
    "deleted_at",
  ]);

  const insertFields = [];
  const insertValues = [];

  function pushField(field, value) {
    if (!allowedFields.includes(field)) {
      return;
    }

    insertFields.push(field);
    insertValues.push(value);
  }

  pushField("branch_id", toBranchId);
  pushField("quantity", 0);

  for (const field of allowedFields) {
    if (skipFields.has(field)) {
      continue;
    }

    if (sourceProduct[field] !== undefined) {
      insertFields.push(field);
      insertValues.push(sourceProduct[field]);
    }
  }

  if (!insertFields.includes("name") && allowedFields.includes("name")) {
    insertFields.push("name");
    insertValues.push(getProductName(sourceProduct));
  }

  if (!insertFields.includes("category") && allowedFields.includes("category")) {
    insertFields.push("category");
    insertValues.push(getProductCategory(sourceProduct));
  }

  if (!insertFields.includes("size") && allowedFields.includes("size")) {
    insertFields.push("size");
    insertValues.push(getProductSize(sourceProduct));
  }

  const placeholders = insertFields.map(() => "?").join(", ");

  try {
    const [result] = await connection.query(
      `
        INSERT INTO products (${insertFields.join(", ")})
        VALUES (${placeholders})
      `,
      insertValues
    );

    const [rows] = await connection.query(
      `
        SELECT *
        FROM products
        WHERE id = ?
        LIMIT 1
        FOR UPDATE
      `,
      [result.insertId]
    );

    return rows[0] || null;
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      throw new Error(
        "The destination store product could not be created because a duplicate product/barcode already exists. Create or fix the destination product first, then receive the transfer again."
      );
    }

    throw error;
  }
}

async function loadTransferDetails(connection, transferId) {
  const [transferRows] = await connection.query(
    `
      SELECT
        st.*,

        fb.branch_code AS from_branch_code,
        fb.name AS from_branch_name,
        fb.location AS from_branch_location,

        tb.branch_code AS to_branch_code,
        tb.name AS to_branch_name,
        tb.location AS to_branch_location,

        rb.full_name AS requested_by_name,
        ab.full_name AS approved_by_name,
        db.full_name AS dispatched_by_name,
        rcb.full_name AS received_by_name,
        cb.full_name AS cancelled_by_name,
        rjb.full_name AS rejected_by_name

      FROM stock_transfers st
      LEFT JOIN branches fb ON fb.id = st.from_branch_id
      LEFT JOIN branches tb ON tb.id = st.to_branch_id
      LEFT JOIN users rb ON rb.id = st.requested_by
      LEFT JOIN users ab ON ab.id = st.approved_by
      LEFT JOIN users db ON db.id = st.dispatched_by
      LEFT JOIN users rcb ON rcb.id = st.received_by
      LEFT JOIN users cb ON cb.id = st.cancelled_by
      LEFT JOIN users rjb ON rjb.id = st.rejected_by
      WHERE st.id = ?
      LIMIT 1
    `,
    [transferId]
  );

  const transfer = transferRows[0] || null;

  if (!transfer) {
    return null;
  }

  const [items] = await connection.query(
    `
      SELECT
        sti.*,
        sp.name AS source_product_name,
        sp.quantity AS current_source_quantity,
        dp.name AS destination_product_name,
        dp.quantity AS current_destination_quantity
      FROM stock_transfer_items sti
      LEFT JOIN products sp ON sp.id = sti.source_product_id
      LEFT JOIN products dp ON dp.id = sti.destination_product_id
      WHERE sti.transfer_id = ?
      ORDER BY sti.id ASC
    `,
    [transferId]
  );

  transfer.items = items;

  return transfer;
}

async function safeLogActivity(connection, req, action, details, branchId = null) {
  try {
    await connection.query(
      `
        INSERT INTO activity_log (user_id, action, details, branch_id)
        VALUES (?, ?, ?, ?)
      `,
      [
        getUserId(req),
        action,
        JSON.stringify(details || {}),
        branchId || getSelectedBranchId(req),
      ]
    );
  } catch (error) {
    console.warn("Activity log skipped:", error.message);
  }
}

router.use(requireAuth);
router.use(requireAdminOrManager);

router.get(
  "/branches",
  asyncHandler(async (req, res) => {
    const [branches] = await pool.query(
      `
        SELECT id, branch_code, name, location
        FROM branches
        ORDER BY name ASC, id ASC
      `
    );

    res.json({
      status: "success",
      count: branches.length,
      branches,
    });
  })
);

router.get(
  "/products",
  asyncHandler(async (req, res) => {
    const branchId = toPositiveInt(req.query.branch_id);

    if (!branchId) {
      return res.status(400).json({
        status: "error",
        message: "Please select a store before searching products.",
      });
    }

    if (!assertBranchAccess(req, res, [branchId])) {
      return;
    }

    const search = cleanText(req.query.search);
    const limit = toSafeLimit(req.query.limit, 50);

    const params = [branchId];
    let searchSql = "";

    if (search) {
      searchSql = `
        AND (
          name LIKE ?
          OR barcode LIKE ?
          OR category LIKE ?
          OR size LIKE ?
        )
      `;

      const searchLike = `%${search}%`;
      params.push(searchLike, searchLike, searchLike, searchLike);
    }

    params.push(limit);

    const [products] = await pool.query(
      `
        SELECT
          id,
          branch_id,
          name,
          barcode,
          category,
          size,
          cost_price,
          selling_price,
          quantity,
          low_stock_threshold
        FROM products
        WHERE branch_id = ?
          ${searchSql}
        ORDER BY name ASC
        LIMIT ?
      `,
      params
    );

    res.json({
      status: "success",
      count: products.length,
      products,
    });
  })
);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const status = cleanText(req.query.status);
    const branchId = toPositiveInt(req.query.branch_id);
    const limit = toSafeLimit(req.query.limit, 80);
    const offset = Math.max(Number(req.query.offset || 0), 0);

    const where = [];
    const params = [];

    if (status && status !== "all") {
      where.push("st.status = ?");
      params.push(status);
    }

    if (branchId) {
      if (!assertBranchAccess(req, res, [branchId])) {
        return;
      }

      where.push("(st.from_branch_id = ? OR st.to_branch_id = ?)");
      params.push(branchId, branchId);
    } else if (!userCanAccessAllBranches(req)) {
      const selectedBranchId = getSelectedBranchId(req);

      if (!selectedBranchId) {
        return res.status(400).json({
          status: "error",
          message:
            "No store selected. Please logout, choose a store, and login again.",
        });
      }

      where.push("(st.from_branch_id = ? OR st.to_branch_id = ?)");
      params.push(selectedBranchId, selectedBranchId);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    params.push(limit, offset);

    const [transfers] = await pool.query(
      `
        SELECT
          st.*,

          fb.branch_code AS from_branch_code,
          fb.name AS from_branch_name,
          tb.branch_code AS to_branch_code,
          tb.name AS to_branch_name,

          u.full_name AS requested_by_name,

          COUNT(sti.id) AS item_count,
          COALESCE(SUM(sti.requested_quantity), 0) AS total_requested_quantity,
          COALESCE(SUM(sti.dispatched_quantity), 0) AS total_dispatched_quantity,
          COALESCE(SUM(sti.received_quantity), 0) AS total_received_quantity

        FROM stock_transfers st
        LEFT JOIN branches fb ON fb.id = st.from_branch_id
        LEFT JOIN branches tb ON tb.id = st.to_branch_id
        LEFT JOIN users u ON u.id = st.requested_by
        LEFT JOIN stock_transfer_items sti ON sti.transfer_id = st.id
        ${whereSql}
        GROUP BY st.id
        ORDER BY st.id DESC
        LIMIT ?
        OFFSET ?
      `,
      params
    );

    res.json({
      status: "success",
      count: transfers.length,
      transfers,
    });
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const transferId = toPositiveInt(req.params.id);

    if (!transferId) {
      return res.status(400).json({
        status: "error",
        message: "Invalid transfer ID.",
      });
    }

    const connection = await pool.getConnection();

    try {
      const transfer = await loadTransferDetails(connection, transferId);

      if (!transfer) {
        return res.status(404).json({
          status: "error",
          message: "Stock transfer was not found.",
        });
      }

      if (
        !assertBranchAccess(req, res, [
          transfer.from_branch_id,
          transfer.to_branch_id,
        ])
      ) {
        return;
      }

      res.json({
        status: "success",
        transfer,
      });
    } finally {
      connection.release();
    }
  })
);

router.get(
  "/:id/pdf",
  asyncHandler(async (req, res) => {
    const transferId = toPositiveInt(req.params.id);

    if (!transferId) {
      return res.status(400).json({
        status: "error",
        message: "Invalid transfer ID.",
      });
    }

    const connection = await pool.getConnection();

    try {
      const transfer = await loadTransferDetails(connection, transferId);

      if (!transfer) {
        return res.status(404).json({
          status: "error",
          message: "Stock transfer was not found.",
        });
      }

      if (
        !assertBranchAccess(req, res, [
          transfer.from_branch_id,
          transfer.to_branch_id,
        ])
      ) {
        return;
      }

      const filename = `${sanitizeFilename(
        transfer.transfer_number
      )}_transfer_note.pdf`;

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`
      );

      const doc = new PDFDocument({
        size: "A4",
        margin: 40,
      });

      doc.pipe(res);
      drawTransferPdf(doc, transfer);
      doc.end();
    } finally {
      connection.release();
    }
  })
);

router.post(
  "/",
  validateRequest(validateStockTransferCreateRequest),
  asyncHandler(async (req, res) => {
    const {
      from_branch_id: fromBranchId,
      to_branch_id: toBranchId,
      request_note: requestNote,
      items,
    } = req.validated.body;

    if (!fromBranchId || !toBranchId) {
      return res.status(400).json({
        status: "error",
        message: "Please select both source store and destination store.",
      });
    }

    if (fromBranchId === toBranchId) {
      return res.status(400).json({
        status: "error",
        message: "Source store and destination store cannot be the same.",
      });
    }

    if (!assertBranchAccess(req, res, [fromBranchId, toBranchId])) {
      return;
    }

    if (items.length === 0) {
      return res.status(400).json({
        status: "error",
        message: "Please add at least one product to transfer.",
      });
    }

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      await requireBranch(connection, fromBranchId, "Source");
      await requireBranch(connection, toBranchId, "Destination");

      const transferNumber = generateTransferNumber();

      const [transferResult] = await connection.query(
        `
          INSERT INTO stock_transfers (
            transfer_number,
            from_branch_id,
            to_branch_id,
            status,
            requested_by,
            request_note
          )
          VALUES (?, ?, ?, 'requested', ?, ?)
        `,
        [
          transferNumber,
          fromBranchId,
          toBranchId,
          getUserId(req),
          requestNote || null,
        ]
      );

      const transferId = transferResult.insertId;

      for (const item of items) {
        const product = await getSourceProduct(
          connection,
          item.source_product_id,
          fromBranchId,
          false
        );

        if (!product) {
          throw new Error(
            `Product ID ${item.source_product_id} was not found in the source store.`
          );
        }

        const currentQuantity = getQuantity(product);

        if (currentQuantity < item.requested_quantity) {
          throw new Error(
            `${getProductName(product)} has only ${currentQuantity} in the source store. Requested quantity is ${item.requested_quantity}.`
          );
        }

        await connection.query(
          `
            INSERT INTO stock_transfer_items (
              transfer_id,
              source_product_id,
              product_name,
              barcode,
              category,
              size,
              requested_quantity,
              item_note
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            transferId,
            product.id,
            getProductName(product),
            getProductBarcode(product) || null,
            getProductCategory(product) || null,
            getProductSize(product) || null,
            item.requested_quantity,
            item.item_note || null,
          ]
        );
      }

      await safeLogActivity(
        connection,
        req,
        "stock_transfer_requested",
        {
          transfer_id: transferId,
          transfer_number: transferNumber,
          from_branch_id: fromBranchId,
          to_branch_id: toBranchId,
          item_count: items.length,
        },
        fromBranchId
      );

      await connection.commit();

      const transfer = await loadTransferDetails(connection, transferId);

      res.status(201).json({
        status: "success",
        message: "Stock transfer request created successfully.",
        transfer,
      });
    } catch (error) {
      await connection.rollback();

      res.status(400).json({
        status: "error",
        message: error.message,
      });
    } finally {
      connection.release();
    }
  })
);

router.post(
  "/:id/approve",
  validateRequest(validateStockTransferActionRequest("approve")),
  asyncHandler(async (req, res) => {
    const { id: transferId } = req.validated.params;
    const { approval_note: approvalNote } = req.validated.body;

    if (!transferId) {
      return res.status(400).json({
        status: "error",
        message: "Invalid transfer ID.",
      });
    }

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const [rows] = await connection.query(
        `
          SELECT *
          FROM stock_transfers
          WHERE id = ?
          LIMIT 1
          FOR UPDATE
        `,
        [transferId]
      );

      const transfer = rows[0];

      if (!transfer) {
        throw new Error("Stock transfer was not found.");
      }

      if (
        !assertBranchAccess(req, res, [
          transfer.from_branch_id,
          transfer.to_branch_id,
        ])
      ) {
        await connection.rollback();
        return;
      }

      if (transfer.status !== "requested") {
        throw new Error("Only requested transfers can be approved.");
      }

      await connection.query(
        `
          UPDATE stock_transfers
          SET
            status = 'approved',
            approved_by = ?,
            approval_note = ?,
            approved_at = NOW()
          WHERE id = ?
        `,
        [getUserId(req), approvalNote || null, transferId]
      );

      await safeLogActivity(
        connection,
        req,
        "stock_transfer_approved",
        {
          transfer_id: transferId,
          transfer_number: transfer.transfer_number,
        },
        transfer.from_branch_id
      );

      await connection.commit();

      const updatedTransfer = await loadTransferDetails(connection, transferId);

      res.json({
        status: "success",
        message: "Stock transfer approved successfully.",
        transfer: updatedTransfer,
      });
    } catch (error) {
      await connection.rollback();

      res.status(400).json({
        status: "error",
        message: error.message,
      });
    } finally {
      connection.release();
    }
  })
);

router.post(
  "/:id/reject",
  validateRequest(validateStockTransferActionRequest("reject")),
  asyncHandler(async (req, res) => {
    const { id: transferId } = req.validated.params;
    const { reject_note: rejectNote } = req.validated.body;

    if (!transferId) {
      return res.status(400).json({
        status: "error",
        message: "Invalid transfer ID.",
      });
    }

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const [rows] = await connection.query(
        `
          SELECT *
          FROM stock_transfers
          WHERE id = ?
          LIMIT 1
          FOR UPDATE
        `,
        [transferId]
      );

      const transfer = rows[0];

      if (!transfer) {
        throw new Error("Stock transfer was not found.");
      }

      if (
        !assertBranchAccess(req, res, [
          transfer.from_branch_id,
          transfer.to_branch_id,
        ])
      ) {
        await connection.rollback();
        return;
      }

      if (!["requested", "approved"].includes(transfer.status)) {
        throw new Error("Only requested or approved transfers can be rejected.");
      }

      await connection.query(
        `
          UPDATE stock_transfers
          SET
            status = 'rejected',
            rejected_by = ?,
            reject_note = ?,
            rejected_at = NOW()
          WHERE id = ?
        `,
        [getUserId(req), rejectNote || null, transferId]
      );

      await safeLogActivity(
        connection,
        req,
        "stock_transfer_rejected",
        {
          transfer_id: transferId,
          transfer_number: transfer.transfer_number,
        },
        transfer.from_branch_id
      );

      await connection.commit();

      const updatedTransfer = await loadTransferDetails(connection, transferId);

      res.json({
        status: "success",
        message: "Stock transfer rejected successfully.",
        transfer: updatedTransfer,
      });
    } catch (error) {
      await connection.rollback();

      res.status(400).json({
        status: "error",
        message: error.message,
      });
    } finally {
      connection.release();
    }
  })
);

router.post(
  "/:id/dispatch",
  validateRequest(validateStockTransferActionRequest("dispatch")),
  asyncHandler(async (req, res) => {
    const { id: transferId } = req.validated.params;
    const { dispatch_note: dispatchNote } = req.validated.body;

    if (!transferId) {
      return res.status(400).json({
        status: "error",
        message: "Invalid transfer ID.",
      });
    }

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const [transferRows] = await connection.query(
        `
          SELECT *
          FROM stock_transfers
          WHERE id = ?
          LIMIT 1
          FOR UPDATE
        `,
        [transferId]
      );

      const transfer = transferRows[0];

      if (!transfer) {
        throw new Error("Stock transfer was not found.");
      }

      if (
        !assertBranchAccess(req, res, [
          transfer.from_branch_id,
          transfer.to_branch_id,
        ])
      ) {
        await connection.rollback();
        return;
      }

      if (transfer.status !== "approved") {
        throw new Error("Only approved transfers can be dispatched.");
      }

      const [items] = await connection.query(
        `
          SELECT *
          FROM stock_transfer_items
          WHERE transfer_id = ?
          ORDER BY id ASC
          FOR UPDATE
        `,
        [transferId]
      );

      if (items.length === 0) {
        throw new Error("This transfer has no items.");
      }

      await assertLegacyQuantityTransferAllowed(connection, { transferId });

      for (const item of items) {
        const product = await getSourceProduct(
          connection,
          item.source_product_id,
          transfer.from_branch_id,
          true
        );

        if (!product) {
          throw new Error(
            `${item.product_name} was not found in the source store.`
          );
        }

        const beforeQuantity = getQuantity(product);
        const transferQuantity = Number(item.requested_quantity || 0);

        if (beforeQuantity < transferQuantity) {
          throw new Error(
            `${getProductName(product)} has only ${beforeQuantity} in the source store. Cannot dispatch ${transferQuantity}.`
          );
        }

        const afterQuantity = beforeQuantity - transferQuantity;

        await connection.query(
          `
            UPDATE products
            SET quantity = ?
            WHERE id = ?
          `,
          [afterQuantity, product.id]
        );

        await connection.query(
          `
            UPDATE stock_transfer_items
            SET
              dispatched_quantity = ?,
              source_quantity_before = ?,
              source_quantity_after = ?
            WHERE id = ?
          `,
          [transferQuantity, beforeQuantity, afterQuantity, item.id]
        );
      }

      await connection.query(
        `
          UPDATE stock_transfers
          SET
            status = 'dispatched',
            dispatched_by = ?,
            dispatch_note = ?,
            dispatched_at = NOW()
          WHERE id = ?
        `,
        [getUserId(req), dispatchNote || null, transferId]
      );

      await safeLogActivity(
        connection,
        req,
        "stock_transfer_dispatched",
        {
          transfer_id: transferId,
          transfer_number: transfer.transfer_number,
        },
        transfer.from_branch_id
      );

      await connection.commit();

      const updatedTransfer = await loadTransferDetails(connection, transferId);

      res.json({
        status: "success",
        message:
          "Stock transfer dispatched successfully. Source store stock has been reduced.",
        transfer: updatedTransfer,
      });
    } catch (error) {
      await connection.rollback();

      res.status(400).json({
        status: "error",
        message: error.message,
      });
    } finally {
      connection.release();
    }
  })
);

router.post(
  "/:id/receive",
  validateRequest(validateStockTransferActionRequest("receive")),
  asyncHandler(async (req, res) => {
    const { id: transferId } = req.validated.params;
    const { receive_note: receiveNote } = req.validated.body;

    if (!transferId) {
      return res.status(400).json({
        status: "error",
        message: "Invalid transfer ID.",
      });
    }

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const [transferRows] = await connection.query(
        `
          SELECT *
          FROM stock_transfers
          WHERE id = ?
          LIMIT 1
          FOR UPDATE
        `,
        [transferId]
      );

      const transfer = transferRows[0];

      if (!transfer) {
        throw new Error("Stock transfer was not found.");
      }

      if (
        !assertBranchAccess(req, res, [
          transfer.from_branch_id,
          transfer.to_branch_id,
        ])
      ) {
        await connection.rollback();
        return;
      }

      if (transfer.status !== "dispatched") {
        throw new Error("Only dispatched transfers can be received.");
      }

      const [items] = await connection.query(
        `
          SELECT *
          FROM stock_transfer_items
          WHERE transfer_id = ?
          ORDER BY id ASC
          FOR UPDATE
        `,
        [transferId]
      );

      if (items.length === 0) {
        throw new Error("This transfer has no items.");
      }

      await assertLegacyQuantityTransferAllowed(connection, { transferId });

      for (const item of items) {
        const sourceProduct = await getSourceProduct(
          connection,
          item.source_product_id,
          transfer.from_branch_id,
          false
        );

        if (!sourceProduct) {
          throw new Error(
            `${item.product_name} source product was not found. Cannot create destination copy.`
          );
        }

        let destinationProduct = await findDestinationProduct(
          connection,
          item,
          transfer.to_branch_id
        );

        if (!destinationProduct) {
          destinationProduct = await createDestinationProductCopy(
            connection,
            sourceProduct,
            transfer.to_branch_id
          );
        }

        if (!destinationProduct) {
          throw new Error(
            `Could not find or create destination product for ${item.product_name}.`
          );
        }

        const beforeQuantity = getQuantity(destinationProduct);
        const receivedQuantity = Number(
          item.dispatched_quantity || item.requested_quantity || 0
        );
        const afterQuantity = beforeQuantity + receivedQuantity;

        await connection.query(
          `
            UPDATE products
            SET quantity = ?
            WHERE id = ?
          `,
          [afterQuantity, destinationProduct.id]
        );

        await connection.query(
          `
            UPDATE stock_transfer_items
            SET
              destination_product_id = ?,
              received_quantity = ?,
              destination_quantity_before = ?,
              destination_quantity_after = ?
            WHERE id = ?
          `,
          [
            destinationProduct.id,
            receivedQuantity,
            beforeQuantity,
            afterQuantity,
            item.id,
          ]
        );
      }

      await connection.query(
        `
          UPDATE stock_transfers
          SET
            status = 'received',
            received_by = ?,
            receive_note = ?,
            received_at = NOW()
          WHERE id = ?
        `,
        [getUserId(req), receiveNote || null, transferId]
      );

      await safeLogActivity(
        connection,
        req,
        "stock_transfer_received",
        {
          transfer_id: transferId,
          transfer_number: transfer.transfer_number,
        },
        transfer.to_branch_id
      );

      await connection.commit();

      const updatedTransfer = await loadTransferDetails(connection, transferId);

      res.json({
        status: "success",
        message:
          "Stock transfer received successfully. Destination store stock has been increased.",
        transfer: updatedTransfer,
      });
    } catch (error) {
      await connection.rollback();

      res.status(400).json({
        status: "error",
        message: error.message,
      });
    } finally {
      connection.release();
    }
  })
);

router.post(
  "/:id/cancel",
  validateRequest(validateStockTransferActionRequest("cancel")),
  asyncHandler(async (req, res) => {
    const { id: transferId } = req.validated.params;
    const { cancel_note: cancelNote } = req.validated.body;

    if (!transferId) {
      return res.status(400).json({
        status: "error",
        message: "Invalid transfer ID.",
      });
    }

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const [rows] = await connection.query(
        `
          SELECT *
          FROM stock_transfers
          WHERE id = ?
          LIMIT 1
          FOR UPDATE
        `,
        [transferId]
      );

      const transfer = rows[0];

      if (!transfer) {
        throw new Error("Stock transfer was not found.");
      }

      if (
        !assertBranchAccess(req, res, [
          transfer.from_branch_id,
          transfer.to_branch_id,
        ])
      ) {
        await connection.rollback();
        return;
      }

      if (!["requested", "approved"].includes(transfer.status)) {
        throw new Error(
          "Only requested or approved transfers can be cancelled. Dispatched transfers must be received or corrected with a separate adjustment."
        );
      }

      await connection.query(
        `
          UPDATE stock_transfers
          SET
            status = 'cancelled',
            cancelled_by = ?,
            cancel_note = ?,
            cancelled_at = NOW()
          WHERE id = ?
        `,
        [getUserId(req), cancelNote || null, transferId]
      );

      await safeLogActivity(
        connection,
        req,
        "stock_transfer_cancelled",
        {
          transfer_id: transferId,
          transfer_number: transfer.transfer_number,
        },
        transfer.from_branch_id
      );

      await connection.commit();

      const updatedTransfer = await loadTransferDetails(connection, transferId);

      res.json({
        status: "success",
        message: "Stock transfer cancelled successfully.",
        transfer: updatedTransfer,
      });
    } catch (error) {
      await connection.rollback();

      res.status(400).json({
        status: "error",
        message: error.message,
      });
    } finally {
      connection.release();
    }
  })
);

module.exports = router;