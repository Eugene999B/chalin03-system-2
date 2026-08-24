"use strict";

const express = require("express");
const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requirePermission } = require("../middleware/permissionMiddleware");
const candidateRoutes = require("../routes/equipmentFinanceOpeningDepositCandidateCompatibilityRoutes");

function columnExpression(columns, alias, column, fallback = "NULL", output = column) {
  return columns.has(column)
    ? `${alias}.\`${column}\` AS \`${output}\``
    : `${fallback} AS \`${output}\``;
}

async function listReadOnlyCandidates(connection) {
  const [agreementColumns, applicationColumns, customerColumns, assetColumns, locationColumns, lockColumns, hireColumns] =
    await Promise.all([
      candidateRoutes.tableColumns(connection, "equipment_sale_agreements"),
      candidateRoutes.tableColumns(connection, "equipment_credit_applications"),
      candidateRoutes.tableColumns(connection, "hire_customers"),
      candidateRoutes.tableColumns(connection, "fleet_assets"),
      candidateRoutes.tableColumns(connection, "business_locations"),
      candidateRoutes.tableColumns(connection, "equipment_asset_sale_locks"),
      candidateRoutes.tableColumns(connection, "hire_contract_assets"),
    ]);

  const requiredBase = [
    "id",
    "customer_id",
    "asset_id",
    "sale_type",
    "agreement_status",
    "credit_application_id",
    "activation_source",
  ];
  if (requiredBase.some((column) => !agreementColumns.has(column)) || !applicationColumns.has("id")) {
    return [];
  }

  const select = [
    columnExpression(agreementColumns, "agreement", "id", "NULL", "agreement_id"),
    columnExpression(agreementColumns, "agreement", "agreement_number"),
    columnExpression(agreementColumns, "agreement", "agreement_status"),
    columnExpression(agreementColumns, "agreement", "equipment_commitment_status"),
    columnExpression(agreementColumns, "agreement", "credit_application_id", "NULL", "application_id"),
    columnExpression(agreementColumns, "agreement", "customer_id"),
    columnExpression(agreementColumns, "agreement", "asset_id"),
    columnExpression(agreementColumns, "agreement", "deposit_required", "0"),
    columnExpression(agreementColumns, "agreement", "deposit_received", "0"),
    columnExpression(agreementColumns, "agreement", "total_amount", "0"),
    columnExpression(agreementColumns, "agreement", "financed_amount", "0"),
    columnExpression(agreementColumns, "agreement", "outstanding_balance", "0"),
    columnExpression(agreementColumns, "agreement", "payment_frequency"),
    columnExpression(agreementColumns, "agreement", "installment_count", "0"),
    columnExpression(agreementColumns, "agreement", "first_due_date"),
    columnExpression(agreementColumns, "agreement", "deposit_completed_at"),
    columnExpression(agreementColumns, "agreement", "reservation_activated_at"),
    columnExpression(agreementColumns, "agreement", "hire_location_id"),
    columnExpression(applicationColumns, "application", "application_number"),
    columnExpression(applicationColumns, "application", "application_status"),
    columnExpression(applicationColumns, "application", "kyc_status"),
    columnExpression(applicationColumns, "application", "affordability_status"),
    customerColumns.has("id") && customerColumns.has("customer_name")
      ? "customer.customer_name AS customer_name"
      : "NULL AS customer_name",
    customerColumns.has("id") && customerColumns.has("phone")
      ? "customer.phone AS customer_phone"
      : "NULL AS customer_phone",
    assetColumns.has("id") && assetColumns.has("asset_code")
      ? "asset.asset_code AS asset_code"
      : "NULL AS asset_code",
    assetColumns.has("id") && assetColumns.has("asset_name")
      ? "asset.asset_name AS asset_name"
      : "NULL AS asset_name",
    assetColumns.has("id") && assetColumns.has("main_image_url")
      ? "asset.main_image_url AS main_image_url"
      : "NULL AS main_image_url",
    assetColumns.has("id") && assetColumns.has("operational_purpose")
      ? "asset.operational_purpose AS operational_purpose"
      : "NULL AS operational_purpose",
    assetColumns.has("id") && assetColumns.has("sale_status")
      ? "asset.sale_status AS sale_status"
      : "NULL AS sale_status",
    assetColumns.has("id") && assetColumns.has("is_active")
      ? "asset.is_active AS asset_is_active"
      : "NULL AS asset_is_active",
    agreementColumns.has("customer_id") && customerColumns.has("id")
      ? "CASE WHEN customer.id IS NULL THEN 0 ELSE 1 END AS customer_linked"
      : "0 AS customer_linked",
    agreementColumns.has("asset_id") && assetColumns.has("id")
      ? "CASE WHEN asset.id IS NULL THEN 0 ELSE 1 END AS asset_linked"
      : "0 AS asset_linked",
    locationColumns.has("id") && locationColumns.has("name") && agreementColumns.has("hire_location_id")
      ? "location.name AS equipment_origin_name"
      : "NULL AS equipment_origin_name",
  ];

  const joins = [
    "INNER JOIN equipment_credit_applications application ON application.id = agreement.credit_application_id",
    customerColumns.has("id") ? "LEFT JOIN hire_customers customer ON customer.id = agreement.customer_id" : "",
    assetColumns.has("id") ? "LEFT JOIN fleet_assets asset ON asset.id = agreement.asset_id" : "",
    agreementColumns.has("hire_location_id") && locationColumns.has("id")
      ? "LEFT JOIN business_locations location ON location.id = agreement.hire_location_id"
      : "",
  ].filter(Boolean);

  const where = [
    "agreement.sale_type = 'installment'",
    "agreement.activation_source = 'approved_credit_application'",
    "agreement.agreement_status IN ('approved','active')",
  ];

  const [rows] = await connection.query(
    `SELECT ${select.join(", ")}
       FROM equipment_sale_agreements agreement
       ${joins.join("\n")}
      WHERE ${where.join("\n        AND ")}
      ORDER BY agreement.id DESC`
  );

  const assetIds = [...new Set(rows.map((row) => Number(row.asset_id)).filter(Boolean))];
  const [lockState, hireState] = await Promise.all([
    candidateRoutes.activeLockMap(connection, assetIds, lockColumns),
    candidateRoutes.activeHireMap(connection, assetIds, hireColumns),
  ]);

  return rows.map((row) =>
    candidateRoutes.candidateShape(
      {
        ...row,
        active_hire_count: hireState.result.get(Number(row.asset_id)) || 0,
        active_lock_agreement_ids: lockState.result.get(Number(row.asset_id)) || [],
      },
      { lockState, hireState }
    )
  );
}

async function directCandidatesHandler(req, res, next) {
  const connection = await pool.getConnection();
  try {
    const candidates = await listReadOnlyCandidates(connection);
    return res.json({
      status: "success",
      candidates,
      scope: "company_wide",
      hire_location_selection_required: false,
      compatibility_mode: true,
      safeguards: {
        hire_work_created: false,
        delivery_created: false,
        ownership_transferred: false,
        sms_sent: false,
      },
    });
  } catch (error) {
    console.error("Direct Finance deposit candidates query failed.", {
      code: String(error?.code || "").slice(0, 80),
      errno: Number(error?.errno || 0) || null,
    });
    return next(error);
  } finally {
    connection.release();
  }
}

function installDirectCandidateBoundary() {
  if (express.application.__chalin03DirectCandidateBoundaryInstalled) return;

  const originalUse = express.application.use;
  express.application.use = function patchedUse(firstArg, ...rest) {
    if (
      firstArg === "/api/equipment-catalogue" &&
      !this.__chalin03DirectCandidateRouteInserted
    ) {
      this.__chalin03DirectCandidateRouteInserted = true;
      const direct = function directCandidateBoundary(req, res, next) {
        const path = String(req.path || req.originalUrl || "").split("?")[0];
        if (
          String(req.method || "").toUpperCase() === "GET" &&
          /\/api\/equipment-catalogue\/sales\/deposit-reservations\/candidates$/.test(path)
        ) {
          return requireAuth(req, res, () =>
            requirePermission("fleet.assets.view")(req, res, () =>
              directCandidatesHandler(req, res, next)
            )
          );
        }
        return next();
      };
      return originalUse.call(this, firstArg, direct, ...rest);
    }
    return originalUse.call(this, firstArg, ...rest);
  };

  Object.defineProperty(express.application, "__chalin03DirectCandidateBoundaryInstalled", {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

installDirectCandidateBoundary();
