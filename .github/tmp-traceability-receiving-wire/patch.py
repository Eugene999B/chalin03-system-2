from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
path = ROOT / "backend/server.js"
text = path.read_text(encoding="utf-8")

old = 'const inventoryTraceabilityRoutes = require("./routes/inventoryTraceabilityRoutes");'
new = old + '\nconst inventoryTraceabilityReceivingRoutes = require("./routes/inventoryTraceabilityReceivingRoutes");'
if text.count(old) != 1:
    raise SystemExit("inventory traceability import marker mismatch")
text = text.replace(old, new, 1)

old = '''app.use(\n  "/api/inventory-traceability",\n  requireAuth,\n  sparePartsBoundary,\n  inventoryTraceabilityRoutes\n);'''
new = '''app.use(\n  "/api/inventory-traceability/receiving",\n  requireAuth,\n  sparePartsBoundary,\n  inventoryTraceabilityReceivingRoutes\n);\napp.use(\n  "/api/inventory-traceability",\n  requireAuth,\n  sparePartsBoundary,\n  inventoryTraceabilityRoutes\n);'''
if text.count(old) != 1:
    raise SystemExit("inventory traceability mount marker mismatch")
text = text.replace(old, new, 1)
path.write_text(text, encoding="utf-8")

contract = ROOT / "backend/tests/inventoryReceivingTraceability20260810.test.js"
source = contract.read_text(encoding="utf-8")
needle = '''const route = read("routes/inventoryTraceabilityReceivingRoutes.js");\n'''
replacement = needle + '''const server = read("server.js");\n'''
if source.count(needle) != 1:
    raise SystemExit("receiving contract import marker mismatch")
source = source.replace(needle, replacement, 1)
needle = '''test("serialized receiving queue is branch-isolated and only includes setup serialized products", () => {'''
replacement = '''test("serialized receiving API is mounted behind Spare Parts authentication", () => {\n  assert.match(server, /inventoryTraceabilityReceivingRoutes/);\n  assert.match(server, /"\\/api\\/inventory-traceability\\/receiving"/);\n  assert.match(server, /sparePartsBoundary/);\n});\n\n''' + needle
if source.count(needle) != 1:
    raise SystemExit("receiving contract test marker mismatch")
contract.write_text(source.replace(needle, replacement, 1), encoding="utf-8")

print("Serialized receiving API wiring applied.")
