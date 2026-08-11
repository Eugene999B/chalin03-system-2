from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly 1 match, found {count}")
    return text.replace(old, new, 1)


def patch_sale_route():
    path = ROOT / "backend/routes/saleRoutes.js"
    text = path.read_text(encoding="utf-8")
    marker = "// GET /api/sales"
    if marker not in text:
        raise SystemExit("sale route GET marker not found")
    create_part, rest = text.split(marker, 1)

    create_part = replace_once(
        create_part,
        'const { validateSaleCreateRequest } = require("../validation/financialRequestValidators");\n',
        'const { validateSaleCreateRequest } = require("../validation/financialRequestValidators");\nconst {\n  lockSaleTraceabilitySelections,\n  markSaleUnitsSold,\n} = require("../services/inventorySaleTraceabilityService");\n',
        "sale traceability import",
    )

    create_part = replace_once(
        create_part,
        """          quantity,\n          is_active\n         FROM products""",
        """          quantity,\n          is_active,\n          inventory_tracking_mode,\n          inventory_traceability_state\n         FROM products""",
        "sale product tracking select",
    )

    create_part = replace_once(
        create_part,
        """      saleItems.push({\n        product_id: product.id,\n        product_name: product.name,\n        quantity,\n        unit_price: unitPrice,\n        line_total: lineTotal,\n        cost_price_at_sale: costPriceAtSale,\n      });""",
        """      saleItems.push({\n        product_id: product.id,\n        product_name: product.name,\n        quantity,\n        unit_price: unitPrice,\n        line_total: lineTotal,\n        cost_price_at_sale: costPriceAtSale,\n        inventory_tracking_mode: product.inventory_tracking_mode || \"quantity\",\n        inventory_traceability_state: product.inventory_traceability_state || \"off\",\n        unit_ids: Array.isArray(item.unit_ids) ? item.unit_ids : [],\n      });""",
        "sale item traceability fields",
    )

    create_part = replace_once(
        create_part,
        """    }\n\n    subtotal = Number(subtotal.toFixed(2));""",
        """    }\n\n    // Lock every selected physical identity before any sale/payment record is committed.\n    // Enforced serialized products require an exact one-ID-per-unit match here.\n    const saleTraceabilitySelections = await lockSaleTraceabilitySelections(connection, {\n      branchId,\n      saleItems,\n    });\n\n    subtotal = Number(subtotal.toFixed(2));""",
        "sale unit lock placement",
    )

    old_loop = """    for (const saleItem of saleItems) {\n      await connection.query(\n        `INSERT INTO sale_items (\n          sale_id,\n          product_id,\n          product_name,\n          quantity,\n          unit_price,\n          line_total,\n          cost_price_at_sale\n        )\n        VALUES (?, ?, ?, ?, ?, ?, ?)`,\n        [\n          saleId,\n          saleItem.product_id,\n          saleItem.product_name,\n          saleItem.quantity,\n          saleItem.unit_price,\n          saleItem.line_total,\n          saleItem.cost_price_at_sale,\n        ]\n      );\n\n      await connection.query(\n        `UPDATE products\n         SET quantity = quantity - ?\n         WHERE id = ?\n         AND branch_id = ?`,\n        [saleItem.quantity, saleItem.product_id, branchId]\n      );\n    }"""
    new_loop = """    for (const saleItem of saleItems) {\n      const [saleItemResult] = await connection.query(\n        `INSERT INTO sale_items (\n          sale_id,\n          product_id,\n          product_name,\n          quantity,\n          unit_price,\n          line_total,\n          cost_price_at_sale\n        )\n        VALUES (?, ?, ?, ?, ?, ?, ?)`,\n        [\n          saleId,\n          saleItem.product_id,\n          saleItem.product_name,\n          saleItem.quantity,\n          saleItem.unit_price,\n          saleItem.line_total,\n          saleItem.cost_price_at_sale,\n        ]\n      );\n\n      const traceabilitySelection = saleTraceabilitySelections.get(Number(saleItem.product_id));\n      const soldUnits = await markSaleUnitsSold(connection, {\n        branchId,\n        saleId,\n        saleItemId: saleItemResult.insertId,\n        productId: saleItem.product_id,\n        unitCodes: traceabilitySelection?.unit_codes || [],\n        actorUserId: req.user.id,\n        receiptNumber,\n        customerName: finalCustomerName,\n        requestId: req.requestId || req.id || null,\n      });\n      saleItem.unit_ids = soldUnits.map((unit) => unit.unit_code);\n\n      await connection.query(\n        `UPDATE products\n         SET quantity = quantity - ?\n         WHERE id = ?\n         AND branch_id = ?`,\n        [saleItem.quantity, saleItem.product_id, branchId]\n      );\n    }"""
    create_part = replace_once(create_part, old_loop, new_loop, "atomic sale item/unit commit loop")

    path.write_text(create_part + marker + rest, encoding="utf-8")


def patch_new_sale_page():
    path = ROOT / "frontend/src/pages/NewSalePage.jsx"
    text = path.read_text(encoding="utf-8")

    text = replace_once(
        text,
        'import AuditUnlockRequestBox from "../components/AuditUnlockRequestBox";\n',
        'import AuditUnlockRequestBox from "../components/AuditUnlockRequestBox";\nimport InventoryUnitScanner from "../components/InventoryUnitScanner";\n',
        "New Sale scanner import",
    )

    text = replace_once(
        text,
        """        {\n          ...product,\n          quantity: requestedQuantity,\n        },""",
        """        {\n          ...product,\n          quantity: requestedQuantity,\n          unit_ids: [],\n        },""",
        "new cart item unit list",
    )

    text = replace_once(
        text,
        """          ? {\n              ...item,\n              quantity: cleanQuantity,\n            }\n          : item""",
        """          ? {\n              ...item,\n              quantity: cleanQuantity,\n              unit_ids: Array.isArray(item.unit_ids)\n                ? item.unit_ids.slice(0, cleanQuantity)\n                : [],\n            }\n          : item""",
        "cart quantity trims unit IDs",
    )

    text = replace_once(
        text,
        """    if (cart.length === 0) {\n      setError(\"Add at least one item to the sale.\");\n      return;\n    }\n\n    const discount = Number(discountAmount || 0);""",
        """    if (cart.length === 0) {\n      setError(\"Add at least one item to the sale.\");\n      return;\n    }\n\n    const incompleteSerializedItem = cart.find((item) => {\n      const serialized = String(item.inventory_tracking_mode || \"quantity\").toLowerCase() === \"serialized\";\n      const enforced = String(item.inventory_traceability_state || \"off\").toLowerCase() === \"enforced\";\n      return serialized && enforced && Number(item.quantity) !== (item.unit_ids || []).length;\n    });\n    if (incompleteSerializedItem) {\n      setError(\n        `${incompleteSerializedItem.name} requires exactly ${incompleteSerializedItem.quantity} verified physical unit ID${Number(incompleteSerializedItem.quantity) === 1 ? \"\" : \"s\"} before checkout.`\n      );\n      return;\n    }\n\n    const discount = Number(discountAmount || 0);""",
        "frontend enforced-unit completeness check",
    )

    text = replace_once(
        text,
        """        items: cart.map((item) => ({\n          product_id: item.id,\n          quantity: item.quantity,\n        })),""",
        """        items: cart.map((item) => ({\n          product_id: item.id,\n          quantity: item.quantity,\n          unit_ids: Array.isArray(item.unit_ids) ? item.unit_ids : [],\n        })),""",
        "sale payload unit IDs",
    )

    text = replace_once(
        text,
        """                {cart.map((item) => {\n                  const lineTotal =\n                    Number(item.selling_price) * Number(item.quantity);\n\n                  return (""",
        """                {cart.map((item) => {\n                  const lineTotal =\n                    Number(item.selling_price) * Number(item.quantity);\n                  const serializedItem =\n                    String(item.inventory_tracking_mode || \"quantity\").toLowerCase() === \"serialized\";\n                  const unitIdsRequired =\n                    serializedItem &&\n                    String(item.inventory_traceability_state || \"off\").toLowerCase() === \"enforced\";\n\n                  return (""",
        "cart traceability policy variables",
    )

    text = replace_once(
        text,
        """                      <button\n                        type=\"button\"\n                        className=\"small-danger\"\n                        onClick={() => removeFromCart(item.id)}\n                      >\n                        Remove\n                      </button>\n                    </div>""",
        """                      <button\n                        type=\"button\"\n                        className=\"small-danger\"\n                        onClick={() => removeFromCart(item.id)}\n                      >\n                        Remove\n                      </button>\n\n                      {serializedItem ? (\n                        <div style={{ gridColumn: \"1 / -1\" }}>\n                          <InventoryUnitScanner\n                            product={item}\n                            requiredCount={item.quantity}\n                            selectedUnitCodes={item.unit_ids || []}\n                            required={unitIdsRequired}\n                            onChange={(unitIds) =>\n                              setCart((current) =>\n                                current.map((cartItem) =>\n                                  Number(cartItem.id) === Number(item.id)\n                                    ? { ...cartItem, unit_ids: unitIds }\n                                    : cartItem\n                                )\n                              )\n                            }\n                          />\n                        </div>\n                      ) : null}\n                    </div>""",
        "cart serialized scanner",
    )

    path.write_text(text, encoding="utf-8")


def restore_workflow_and_cleanup():
    workflow = ROOT / ".github/workflows/inventory-loss-prevention-feature.yml"
    previous = subprocess.run(
        ["git", "show", "HEAD^:.github/workflows/inventory-loss-prevention-feature.yml"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    workflow.write_text(previous, encoding="utf-8")
    this_file = Path(__file__)
    this_file.unlink()
    try:
        this_file.parent.rmdir()
    except OSError:
        pass


patch_sale_route()
patch_new_sale_page()
restore_workflow_and_cleanup()
print("Serialized sale transaction + New Sale scanner integration applied.")
