from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PATH = ROOT / "backend/routes/stockTransferRoutes.js"
text = PATH.read_text(encoding="utf-8")

import_anchor = '''const {
  validateStockTransferActionRequest,
  validateStockTransferCreateRequest,
} = require("../validation/operationsRequestValidators");
'''
import_replacement = import_anchor + '''const {
  assertLegacyQuantityTransferAllowed,
} = require("../services/inventoryTransferTraceabilityService");
'''
if text.count(import_anchor) != 1:
    raise SystemExit(f"transfer guard import anchor expected 1 match, found {text.count(import_anchor)}")
text = text.replace(import_anchor, import_replacement, 1)

guard_anchor = '''      if (items.length === 0) {
        throw new Error("This transfer has no items.");
      }

      for (const item of items) {
'''
guard_replacement = '''      if (items.length === 0) {
        throw new Error("This transfer has no items.");
      }

      await assertLegacyQuantityTransferAllowed(connection, { transferId });

      for (const item of items) {
'''
count = text.count(guard_anchor)
if count != 2:
    raise SystemExit(f"dispatch/receive guard anchor expected 2 matches, found {count}")
text = text.replace(guard_anchor, guard_replacement)

if text.count("assertLegacyQuantityTransferAllowed(connection, { transferId });") != 2:
    raise SystemExit("serialized transfer legacy guards were not installed exactly twice")

PATH.write_text(text, encoding="utf-8")
print("Serialized transfer legacy dispatch/receive guards applied.")
