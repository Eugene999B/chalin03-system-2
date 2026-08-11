from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly 1 match, found {count}")
    return text.replace(old, new, 1)


def replace_first(text, old, new, label):
    if old not in text:
        raise SystemExit(f"{label}: expected at least 1 match, found 0")
    return text.replace(old, new, 1)


def patch_return_routes():
    path = ROOT / "backend/routes/returnRoutes.js"
    text = path.read_text(encoding="utf-8")

    text = replace_once(
        text,
        'const { validateReturnCreateRequest } = require("../validation/financialRequestValidators");\n',
        'const { validateReturnCreateRequest } = require("../validation/financialRequestValidators");\nconst {\n  lockReturnUnitSelection,\n  markReturnUnitsQuarantined,\n} = require("../services/inventoryReturnTraceabilityService");\n',
        "return traceability imports",
    )

    text = replace_once(
        text,
        """          MAX(si.unit_price) AS unit_price,\n          SUM(si.line_total) AS line_total,\n          COALESCE((""",
        """          MAX(si.unit_price) AS unit_price,\n          SUM(si.line_total) AS line_total,\n          MAX(p.inventory_tracking_mode) AS inventory_tracking_mode,\n          MAX(p.inventory_traceability_state) AS inventory_traceability_state,\n          MAX(p.inventory_product_code) AS inventory_product_code,\n          COALESCE((""",
        "return sale-item tracking fields",
    )
    # This join shape occurs again in the POST execution query. The first
    # occurrence is the GET /sales/:saleId/items query whose SELECT was just
    # expanded with p.inventory_* fields above.
    text = replace_first(
        text,
        """         FROM sale_items si\n         INNER JOIN sales s ON si.sale_id = s.id\n         WHERE si.sale_id = ?""",
        """         FROM sale_items si\n         INNER JOIN sales s ON si.sale_id = s.id\n         INNER JOIN products p ON p.id = si.product_id AND p.branch_id = s.branch_id\n         WHERE si.sale_id = ?""",
        "return sale-item product join",
    )
    text = replace_once(
        text,
        """          physical_remaining_quantity: physicalRemaining,\n          remaining_quantity: availableQuantity,\n        };""",
        """          physical_remaining_quantity: physicalRemaining,\n          remaining_quantity: availableQuantity,\n          inventory_tracking_mode: item.inventory_tracking_mode || \"quantity\",\n          inventory_traceability_state: item.inventory_traceability_state || \"off\",\n          inventory_product_code: item.inventory_product_code || null,\n          serialized_return_requires_unit_ids:\n            item.inventory_tracking_mode === \"serialized\" &&\n            item.inventory_traceability_state === \"enforced\",\n        };""",
        "return item response tracking policy",
    )

    text = replace_once(
        text,
        """        approver_username,\n        approver_password,\n      } = req.validated.body;""",
        """        approver_username,\n        approver_password,\n        unit_ids = [],\n      } = req.validated.body;""",
        "return request unit IDs",
    )

    text = replace_once(
        text,
        """        `SELECT id, branch_id, name\n         FROM products""",
        """        `SELECT\n          id, branch_id, name,\n          inventory_tracking_mode,\n          inventory_traceability_state,\n          inventory_product_code\n         FROM products""",
        "return product tracking select",
    )

    text = replace_once(
        text,
        """      if (cleanQuantity > remainingQuantity) {\n        await connection.rollback();\n\n        return res.status(400).json({\n          status: \"error\",\n          message: `You cannot return ${cleanQuantity}. Only ${remainingQuantity} remaining from this sale.`,\n        });\n      }\n\n      const estimatedReturnAmount""",
        """      if (cleanQuantity > remainingQuantity) {\n        await connection.rollback();\n\n        return res.status(400).json({\n          status: \"error\",\n          message: `You cannot return ${cleanQuantity}. Only ${remainingQuantity} remaining from this sale.`,\n        });\n      }\n\n      const returnTraceabilitySelection = await lockReturnUnitSelection(connection, {\n        branchId,\n        saleId: cleanSaleId,\n        product: products[0],\n        quantity: cleanQuantity,\n        unitCodes: unit_ids || [],\n      });\n\n      const estimatedReturnAmount""",
        "return exact identity lock",
    )

    text = replace_once(
        text,
        """      );\n\n      await connection.query(\n        `UPDATE products\n         SET quantity = quantity + ?""",
        """      );\n\n      const quarantinedUnits = await markReturnUnitsQuarantined(connection, {\n        branchId,\n        returnId: returnResult.insertId,\n        saleId: cleanSaleId,\n        productId: cleanProductId,\n        unitCodes: returnTraceabilitySelection.unit_codes,\n        actorUserId: req.user.id,\n        reason: cleanReason,\n        requestId: req.requestId || req.id || req.approvalExecution?.request_code || null,\n      });\n\n      await connection.query(\n        `UPDATE products\n         SET quantity = quantity + ?""",
        "return quarantine commit",
    )

    text = replace_once(
        text,
        """          refund_reference: cleanRefundReference || null,\n          approved_by: approver?.id || null,\n        },""",
        """          refund_reference: cleanRefundReference || null,\n          approved_by: approver?.id || null,\n          unit_ids: quarantinedUnits.map((unit) => unit.unit_code),\n          serialized_quarantine: quarantinedUnits.length > 0,\n        },""",
        "return audit identity metadata",
    )

    text = replace_once(
        text,
        """          refund_method: finalRefundMethod,\n          affected_closing_id: affectedClosing?.id || null,\n        };""",
        """          refund_method: finalRefundMethod,\n          unit_ids: quarantinedUnits.map((unit) => unit.unit_code),\n          serialized_quarantine: quarantinedUnits.length > 0,\n          affected_closing_id: affectedClosing?.id || null,\n        };""",
        "durable approval return identity result",
    )

    text = replace_once(
        text,
        """        message: \"Return recorded successfully. Stock has been increased.\",\n        return_record: {""",
        """        message:\n          quarantinedUnits.length > 0\n            ? \"Return recorded successfully. Physical serialized units are in quarantine and are not sellable until inspection clears them.\"\n            : \"Return recorded successfully. Stock has been increased.\",\n        return_record: {""",
        "serialized return response message",
    )
    text = replace_once(
        text,
        """          approval_request_id: req.approvalExecution?.request_id || null,\n        },""",
        """          approval_request_id: req.approvalExecution?.request_id || null,\n          unit_ids: quarantinedUnits.map((unit) => unit.unit_code),\n          serialized_quarantine: quarantinedUnits.length > 0,\n        },""",
        "serialized return response record",
    )

    text = replace_once(
        text,
        """      console.error(\"Create return error:\", error);\n\n      return res.status(500).json({\n        status: \"error\",\n        message: \"Something went wrong while recording return.\",\n      });""",
        """      console.error(\"Create return error:\", error);\n\n      const statusCode = Number(error.statusCode || 500);\n      return res.status(statusCode).json({\n        status: \"error\",\n        code: error.code || \"RETURN_CREATE_ERROR\",\n        message:\n          statusCode >= 500\n            ? \"Something went wrong while recording return.\"\n            : error.message,\n      });""",
        "return traceability error response",
    )

    path.write_text(text, encoding="utf-8")


def patch_operational_approval():
    path = ROOT / "backend/routes/operationalApprovalRoutes.js"
    text = path.read_text(encoding="utf-8")

    text = replace_once(
        text,
        'const router = express.Router();\n',
        'const { lockReturnUnitSelection } = require("../services/inventoryReturnTraceabilityService");\n\nconst router = express.Router();\n',
        "approval return traceability import",
    )

    text = replace_once(
        text,
        """    const refundReference = cleanText(req.body?.refund_reference, 180);\n""",
        """    const refundReference = cleanText(req.body?.refund_reference, 180);\n    const unitIds = Array.isArray(req.body?.unit_ids) ? req.body.unit_ids : [];\n""",
        "approval return unit IDs",
    )

    text = replace_once(
        text,
        """              MAX(si.unit_price) AS unit_price,\n              COALESCE((""",
        """              MAX(si.unit_price) AS unit_price,\n              MAX(p.inventory_tracking_mode) AS inventory_tracking_mode,\n              MAX(p.inventory_traceability_state) AS inventory_traceability_state,\n              MAX(p.inventory_product_code) AS inventory_product_code,\n              COALESCE((""",
        "approval item tracking fields",
    )
    text = replace_once(
        text,
        """       FROM sale_items si\n       WHERE si.sale_id = ? AND si.product_id = ?""",
        """       FROM sale_items si\n       INNER JOIN products p ON p.id = si.product_id AND p.branch_id = ?\n       WHERE si.sale_id = ? AND si.product_id = ?""",
        "approval item product join",
    )
    text = replace_once(
        text,
        """      [branchId, saleId, productId, saleId, productId]\n    );""",
        """      [branchId, saleId, productId, branchId, saleId, productId]\n    );""",
        "approval item query params",
    )

    text = replace_once(
        text,
        """    if (quantity > remaining) {\n      throw Object.assign(\n        new Error(`Only ${remaining} unit(s) remain available for return.`),\n        { statusCode: 409 }\n      );\n    }\n\n    const maximumRefund""",
        """    if (quantity > remaining) {\n      throw Object.assign(\n        new Error(`Only ${remaining} unit(s) remain available for return.`),\n        { statusCode: 409 }\n      );\n    }\n\n    const returnTraceabilitySelection = await lockReturnUnitSelection(connection, {\n      branchId,\n      saleId,\n      product: {\n        id: productId,\n        name: item.product_name,\n        inventory_tracking_mode: item.inventory_tracking_mode || \"quantity\",\n        inventory_traceability_state: item.inventory_traceability_state || \"off\",\n      },\n      quantity,\n      unitCodes: unitIds,\n    });\n\n    const maximumRefund""",
        "approval exact returned identity verification",
    )

    text = replace_once(
        text,
        """      refund_reference: refundReference,\n    };""",
        """      refund_reference: refundReference,\n      unit_ids: returnTraceabilitySelection.unit_codes,\n    };""",
        "approval payload exact unit IDs",
    )

    text = replace_once(
        text,
        """      refundReference ? `Reference ${refundReference}` : \"\",\n      `Requested by""",
        """      refundReference ? `Reference ${refundReference}` : \"\",\n      returnTraceabilitySelection.unit_codes.length\n        ? `Physical IDs ${returnTraceabilitySelection.unit_codes.join(\", \")}`\n        : \"\",\n      `Requested by""",
        "approval reason physical evidence",
    )

    path.write_text(text, encoding="utf-8")


patch_return_routes()
patch_operational_approval()
print("Serialized return execution and refund approval integration applied.")
