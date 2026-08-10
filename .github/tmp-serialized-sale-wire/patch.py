from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def replace(path, old, new, expected=1):
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"{path}: expected {expected}, found {count}: {old!r}")
    target.write_text(text.replace(old, new, expected), encoding="utf-8")


validator = "backend/validation/financialRequestValidators.js"
replace(
    validator,
    'const DATE_ONLY_PATTERN = /^\\d{4}-\\d{2}-\\d{2}$/;',
    'const DATE_ONLY_PATTERN = /^\\d{4}-\\d{2}-\\d{2}$/;\nconst INVENTORY_UNIT_CODE_PATTERN = /^[A-Z0-9]{3,12}-[A-HJ-NP-Z2-9]{8}$/;',
)
replace(
    validator,
    'rejectUnknownKeys(item, new Set(["product_id", "quantity"]), field, errors);',
    'rejectUnknownKeys(item, new Set(["product_id", "quantity", "unit_ids"]), field, errors);',
)
replace(
    validator,
    '''      const productId = parsePositiveInteger(item.product_id);\n      const quantity = parsePositiveInteger(item.quantity);\n\n      if (productId === null) {''',
    '''      const productId = parsePositiveInteger(item.product_id);\n      const quantity = parsePositiveInteger(item.quantity);\n      const unitIds = [];\n      const seenUnitIds = new Set();\n\n      if (item.unit_ids !== undefined) {\n        if (!Array.isArray(item.unit_ids)) {\n          addError(\n            errors,\n            `${field}.unit_ids`,\n            "Physical unit IDs must be sent as a list.",\n            "INVALID_INVENTORY_UNIT_ID_LIST"\n          );\n        } else if (item.unit_ids.length > MAX_ITEMS_PER_SALE) {\n          addError(\n            errors,\n            `${field}.unit_ids`,\n            `A sale item cannot contain more than ${MAX_ITEMS_PER_SALE} physical unit IDs.`,\n            "TOO_MANY_INVENTORY_UNIT_IDS"\n          );\n        } else {\n          item.unit_ids.forEach((value, unitIndex) => {\n            const code = String(value || "").trim().toUpperCase();\n            if (!INVENTORY_UNIT_CODE_PATTERN.test(code)) {\n              addError(\n                errors,\n                `${field}.unit_ids[${unitIndex}]`,\n                "Physical unit ID format is invalid.",\n                "INVALID_INVENTORY_UNIT_ID"\n              );\n              return;\n            }\n            if (seenUnitIds.has(code)) {\n              addError(\n                errors,\n                `${field}.unit_ids[${unitIndex}]`,\n                "The same physical unit ID cannot appear twice in one sale item.",\n                "DUPLICATE_INVENTORY_UNIT_ID"\n              );\n              return;\n            }\n            seenUnitIds.add(code);\n            unitIds.push(code);\n          });\n        }\n      }\n\n      if (productId === null) {'''
)
replace(
    validator,
    '      items.push({ product_id: productId, quantity });',
    '      items.push({ product_id: productId, quantity, unit_ids: unitIds });',
)

sale = "backend/routes/saleRoutes.js"
replace(
    sale,
    'const { validateSaleCreateRequest } = require("../validation/financialRequestValidators");',
    '''const { validateSaleCreateRequest } = require("../validation/financialRequestValidators");\nconst {\n  lockSaleTraceabilitySelections,\n  markSaleUnitsSold,\n} = require("../services/inventorySaleTraceabilityService");''',
)
replace(
    sale,
    '''          barcode,\n          quantity,\n          cost_price,\n          selling_price''',
    '''          barcode,\n          quantity,\n          cost_price,\n          selling_price,\n          inventory_tracking_mode,\n          inventory_traceability_state,\n          inventory_product_code''',
)
replace(
    sale,
    '''        saleItems.push({\n          product_id: product.id,\n          product_name: product.name,\n          quantity: item.quantity,\n          unit_price: Number(product.selling_price),\n          cost_price: Number(product.cost_price || 0),\n          line_total: lineTotal,\n        });''',
    '''        saleItems.push({\n          product_id: product.id,\n          product_name: product.name,\n          quantity: item.quantity,\n          unit_price: Number(product.selling_price),\n          cost_price: Number(product.cost_price || 0),\n          line_total: lineTotal,\n          unit_ids: item.unit_ids || [],\n          inventory_tracking_mode: product.inventory_tracking_mode || "quantity",\n          inventory_traceability_state: product.inventory_traceability_state || "off",\n          inventory_product_code: product.inventory_product_code || null,\n        });''',
)
replace(
    sale,
    '''      const requestedDiscount = Number(discountAmount || 0);''',
    '''      const traceabilitySelections = await lockSaleTraceabilitySelections(connection, {\n        branchId,\n        saleItems,\n      });\n\n      const requestedDiscount = Number(discountAmount || 0);''',
)
replace(
    sale,
    '''      for (const item of saleItems) {\n        await connection.query(\n          `INSERT INTO sale_items (\n            sale_id,\n            product_id,\n            product_name,\n            quantity,\n            unit_price,\n            cost_price,\n            line_total\n          )\n          VALUES (?, ?, ?, ?, ?, ?, ?)`,\n          [\n            saleId,\n            item.product_id,\n            item.product_name,\n            item.quantity,\n            item.unit_price,\n            item.cost_price,\n            item.line_total,\n          ]\n        );\n\n        await connection.query(\n          `UPDATE products\n           SET quantity = quantity - ?\n           WHERE id = ?\n           AND branch_id = ?`,\n          [item.quantity, item.product_id, branchId]\n        );\n      }''',
    '''      for (const item of saleItems) {\n        const [saleItemResult] = await connection.query(\n          `INSERT INTO sale_items (\n            sale_id,\n            product_id,\n            product_name,\n            quantity,\n            unit_price,\n            cost_price,\n            line_total\n          )\n          VALUES (?, ?, ?, ?, ?, ?, ?)`,\n          [\n            saleId,\n            item.product_id,\n            item.product_name,\n            item.quantity,\n            item.unit_price,\n            item.cost_price,\n            item.line_total,\n          ]\n        );\n\n        await connection.query(\n          `UPDATE products\n           SET quantity = quantity - ?\n           WHERE id = ?\n           AND branch_id = ?`,\n          [item.quantity, item.product_id, branchId]\n        );\n\n        const traceabilitySelection = traceabilitySelections.get(Number(item.product_id));\n        if (traceabilitySelection?.unit_codes?.length) {\n          await markSaleUnitsSold(connection, {\n            branchId,\n            saleId,\n            saleItemId: saleItemResult.insertId,\n            productId: item.product_id,\n            unitCodes: traceabilitySelection.unit_codes,\n            actorUserId: req.user.id,\n            receiptNumber,\n            customerName,\n            requestId: req.requestId || null,\n          });\n        }\n      }''',
)

print("Serialized checkout integration patch applied.")
