from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def replace(path, old, new, count=1):
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    actual = text.count(old)
    if actual != count:
        raise SystemExit(f"{path}: expected {count} occurrence(s), found {actual}: {old!r}")
    target.write_text(text.replace(old, new, count), encoding="utf-8")


replace(
    "frontend/src/App.jsx",
    'import ProductsPage from "./pages/ProductsPage";',
    'import ProductsPage from "./pages/ProductsPage";\nimport InventoryTraceabilityPage from "./pages/InventoryTraceabilityPage";',
)

replace(
    "frontend/src/App.jsx",
    '''            <Route\n              path="products"\n              element={rolePage(businessWorkRoles, <ProductsPage />)}\n            />\n            <Route\n              path="new-sale"''',
    '''            <Route\n              path="products"\n              element={rolePage(businessWorkRoles, <ProductsPage />)}\n            />\n            <Route\n              path="inventory-traceability"\n              element={rolePage(adminManagerRoles, <InventoryTraceabilityPage />)}\n            />\n            <Route\n              path="new-sale"''',
)

replace(
    "frontend/src/components/Layout.jsx",
    '''          {\n            title: "Stock Transfers",\n            description: "Request, approve, dispatch and receive stock",\n            path: "/stock-transfers",\n            icon: "🔁",\n            keywords:\n              "stock transfers transfer between stores branches move dispatch receive approve inventory",\n          },\n          {\n            title: "Low Stock / Restock",''',
    '''          {\n            title: "Stock Transfers",\n            description: "Request, approve, dispatch and receive stock",\n            path: "/stock-transfers",\n            icon: "🔁",\n            keywords:\n              "stock transfers transfer between stores branches move dispatch receive approve inventory",\n          },\n          {\n            title: "Inventory Control & Traceability",\n            description: "Physical unit IDs, controlled labels, exact-item lookup and loss prevention",\n            path: "/inventory-traceability",\n            icon: "🏷️",\n            keywords:\n              "inventory traceability loss prevention theft serialized serial unit id labels qr missing stock physical count",\n          },\n          {\n            title: "Low Stock / Restock",''',
)

replace(
    "frontend/package.json",
    'node scripts/returnIntegrityTests.mjs"',
    'node scripts/returnIntegrityTests.mjs && node scripts/inventoryTraceabilityFoundationTests.mjs"',
)

print("Inventory Traceability UI wiring applied.")
