from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def replace(path, old, new, expected=1):
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"{path}: expected {expected}, found {count}: {old!r}")
    target.write_text(text.replace(old, new, expected), encoding="utf-8")


# Mount the purchase receiving bridge under the existing traceability namespace.
replace(
    "backend/server.js",
    'const inventoryTraceabilityRoutes = require("./routes/inventoryTraceabilityRoutes");',
    'const inventoryTraceabilityRoutes = require("./routes/inventoryTraceabilityRoutes");\nconst inventoryTraceabilityReceivingRoutes = require("./routes/inventoryTraceabilityReceivingRoutes");',
)
replace(
    "backend/server.js",
    '''app.use(\n  "/api/inventory-traceability",\n  requireAuth,\n  sparePartsBoundary,\n  inventoryTraceabilityRoutes\n);''',
    '''app.use(\n  "/api/inventory-traceability/receiving",\n  requireAuth,\n  sparePartsBoundary,\n  inventoryTraceabilityReceivingRoutes\n);\napp.use(\n  "/api/inventory-traceability",\n  requireAuth,\n  sparePartsBoundary,\n  inventoryTraceabilityRoutes\n);''',
)

# Expose product tracking policy to New Sale without changing quantity behavior.
replace(
    "backend/routes/productRoutes.js",
    '''        low_stock_threshold,\n        barcode,\n        image_url,\n        is_active,''',
    '''        low_stock_threshold,\n        barcode,\n        inventory_tracking_mode,\n        inventory_product_code,\n        inventory_risk_tier,\n        inventory_traceability_state,\n        image_url,\n        is_active,''',
)

# Accept exact physical unit IDs in the validated sale contract.
replace(
    "backend/validation/financialRequestValidators.js",
    'const DATE_ONLY_PATTERN = /^\\d{4}-\\d{2}-\\d{2}$/;',
    'const DATE_ONLY_PATTERN = /^\\d{4}-\\d{2}-\\d{2}$/;\nconst INVENTORY_UNIT_CODE_PATTERN = /^[A-Z0-9]{3,12}-[A-HJ-NP-Z2-9]{8}$/;',
)
replace(
    "backend/validation/financialRequestValidators.js",
    'rejectUnknownKeys(item, new Set(["product_id", "quantity"]), field, errors);',
    'rejectUnknownKeys(item, new Set(["product_id", "quantity", "unit_ids"]), field, errors);',
)
replace(
    "backend/validation/financialRequestValidators.js",
    '''      const productId = parsePositiveInteger(item.product_id);\n      const quantity = parsePositiveInteger(item.quantity);\n\n      if (productId === null) {''',
    '''      const productId = parsePositiveInteger(item.product_id);\n      const quantity = parsePositiveInteger(item.quantity);\n      const unitIds = [];\n      const seenUnitIds = new Set();\n\n      if (item.unit_ids !== undefined) {\n        if (!Array.isArray(item.unit_ids)) {\n          addError(\n            errors,\n            `${field}.unit_ids`,\n            "Physical unit IDs must be sent as a list.",\n            "INVALID_INVENTORY_UNIT_ID_LIST"\n          );\n        } else if (item.unit_ids.length > MAX_ITEMS_PER_SALE) {\n          addError(\n            errors,\n            `${field}.unit_ids`,\n            `A sale item cannot contain more than ${MAX_ITEMS_PER_SALE} physical unit IDs.`,\n            "TOO_MANY_INVENTORY_UNIT_IDS"\n          );\n        } else {\n          item.unit_ids.forEach((value, unitIndex) => {\n            const code = String(value || "").trim().toUpperCase();\n            if (!INVENTORY_UNIT_CODE_PATTERN.test(code)) {\n              addError(\n                errors,\n                `${field}.unit_ids[${unitIndex}]`,\n                "Physical unit ID format is invalid.",\n                "INVALID_INVENTORY_UNIT_ID"\n              );\n              return;\n            }\n            if (seenUnitIds.has(code)) {\n              addError(\n                errors,\n                `${field}.unit_ids[${unitIndex}]`,\n                "The same physical unit ID cannot appear twice in one sale item.",\n                "DUPLICATE_INVENTORY_UNIT_ID"\n              );\n              return;\n            }\n            seenUnitIds.add(code);\n            unitIds.push(code);\n          });\n        }\n      }\n\n      if (productId === null) {''',
)
replace(
    "backend/validation/financialRequestValidators.js",
    '      items.push({ product_id: productId, quantity });',
    '      items.push({ product_id: productId, quantity, unit_ids: unitIds });',
)

# Lock exact serialized identities before the sale and mark them sold atomically.
replace(
    "backend/routes/saleRoutes.js",
    'const { validateSaleCreateRequest } = require("../validation/financialRequestValidators");',
    '''const { validateSaleCreateRequest } = require("../validation/financialRequestValidators");\nconst {\n  lockSaleTraceabilitySelections,\n  markSaleUnitsSold,\n} = require("../services/inventorySaleTraceabilityService");''',
)
replace(
    "backend/routes/saleRoutes.js",
    '''          barcode,\n          quantity,\n          cost_price,\n          selling_price''',
    '''          barcode,\n          quantity,\n          cost_price,\n          selling_price,\n          inventory_tracking_mode,\n          inventory_traceability_state,\n          inventory_product_code''',
)
replace(
    "backend/routes/saleRoutes.js",
    '''        saleItems.push({\n          product_id: product.id,\n          product_name: product.name,\n          quantity: item.quantity,\n          unit_price: Number(product.selling_price),\n          cost_price: Number(product.cost_price || 0),\n          line_total: lineTotal,\n        });''',
    '''        saleItems.push({\n          product_id: product.id,\n          product_name: product.name,\n          quantity: item.quantity,\n          unit_price: Number(product.selling_price),\n          cost_price: Number(product.cost_price || 0),\n          line_total: lineTotal,\n          unit_ids: item.unit_ids || [],\n          inventory_tracking_mode: product.inventory_tracking_mode || "quantity",\n          inventory_traceability_state: product.inventory_traceability_state || "off",\n          inventory_product_code: product.inventory_product_code || null,\n        });''',
)
replace(
    "backend/routes/saleRoutes.js",
    '      const requestedDiscount = Number(discountAmount || 0);',
    '''      const traceabilitySelections = await lockSaleTraceabilitySelections(connection, {\n        branchId,\n        saleItems,\n      });\n\n      const requestedDiscount = Number(discountAmount || 0);''',
)
replace(
    "backend/routes/saleRoutes.js",
    '''      for (const item of saleItems) {\n        await connection.query(\n          `INSERT INTO sale_items (\n            sale_id,\n            product_id,\n            product_name,\n            quantity,\n            unit_price,\n            cost_price,\n            line_total\n          )\n          VALUES (?, ?, ?, ?, ?, ?, ?)`,\n          [\n            saleId,\n            item.product_id,\n            item.product_name,\n            item.quantity,\n            item.unit_price,\n            item.cost_price,\n            item.line_total,\n          ]\n        );\n\n        await connection.query(\n          `UPDATE products\n           SET quantity = quantity - ?\n           WHERE id = ?\n           AND branch_id = ?`,\n          [item.quantity, item.product_id, branchId]\n        );\n      }''',
    '''      for (const item of saleItems) {\n        const [saleItemResult] = await connection.query(\n          `INSERT INTO sale_items (\n            sale_id,\n            product_id,\n            product_name,\n            quantity,\n            unit_price,\n            cost_price,\n            line_total\n          )\n          VALUES (?, ?, ?, ?, ?, ?, ?)`,\n          [\n            saleId,\n            item.product_id,\n            item.product_name,\n            item.quantity,\n            item.unit_price,\n            item.cost_price,\n            item.line_total,\n          ]\n        );\n\n        await connection.query(\n          `UPDATE products\n           SET quantity = quantity - ?\n           WHERE id = ?\n           AND branch_id = ?`,\n          [item.quantity, item.product_id, branchId]\n        );\n\n        const traceabilitySelection = traceabilitySelections.get(Number(item.product_id));\n        if (traceabilitySelection?.unit_codes?.length) {\n          await markSaleUnitsSold(connection, {\n            branchId,\n            saleId,\n            saleItemId: saleItemResult.insertId,\n            productId: item.product_id,\n            unitCodes: traceabilitySelection.unit_codes,\n            actorUserId: req.user.id,\n            receiptNumber,\n            customerName,\n            requestId: req.requestId || null,\n          });\n        }\n      }''',
)

# Strengthen permanent contracts for the receiving mount and coverage invariant.
receiving_test = ROOT / "backend/tests/inventoryReceivingTraceability20260810.test.js"
text = receiving_test.read_text(encoding="utf-8")
needle = 'const route = read("routes/inventoryTraceabilityReceivingRoutes.js");\n'
if text.count(needle) != 1:
    raise SystemExit("receiving test marker mismatch")
text = text.replace(needle, needle + 'const server = read("server.js");\n', 1)
needle = 'test("serialized receiving queue is branch-isolated and only includes setup serialized products", () => {'
insert = '''test("serialized receiving API is mounted behind the Spare Parts boundary", () => {\n  assert.match(server, /inventoryTraceabilityReceivingRoutes/);\n  assert.match(server, /"\\/api\\/inventory-traceability\\/receiving"/);\n  assert.match(server, /sparePartsBoundary/);\n});\n\n''' + needle
if text.count(needle) != 1:
    raise SystemExit("receiving test insertion marker mismatch")
receiving_test.write_text(text.replace(needle, insert, 1), encoding="utf-8")

integration = ROOT / "backend/tests/inventoryTraceabilityIntegrationContract20260810.test.js"
text = integration.read_text(encoding="utf-8")
needle = 'test("label batch finalization requires every generated identity to be activated or voided", () => {'
insert = '''test("label generation cannot mint identity replacements beyond uncovered system stock", () => {\n  assert.match(repository, /INVENTORY_BEARING_STATUSES/);\n  assert.match(repository, /inventory_identity_count/);\n  assert.match(repository, /TRACEABILITY_NO_IDENTITY_GAP/);\n  assert.match(repository, /TRACEABILITY_BATCH_EXCEEDS_IDENTITY_GAP/);\n  assert.match(migration, /uq_inventory_label_batch_source_item/);\n  assert.match(verifier, /duplicate_source_item_batches/);\n});\n\n''' + needle
if text.count(needle) != 1:
    raise SystemExit("integration coverage marker mismatch")
integration.write_text(text.replace(needle, insert, 1), encoding="utf-8")

print("Traceability receiving and serialized checkout core wiring applied.")
