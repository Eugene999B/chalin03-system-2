from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PATH = ROOT / "frontend/e2e/inventoryLossPreventionPilot.spec.js"
text = PATH.read_text(encoding="utf-8")

old = '  await expect(singleReturn.getByText(/verified against this receipt/)).toBeVisible();\n'
new = '''  await expect(\n    singleReturn.locator(".inventory-unit-scanner__message")\n  ).toContainText(`${UNIT_CODE} verified against this receipt`);\n'''

count = text.count(old)
if count != 1:
    raise SystemExit(f"return scanner strict selector: expected exactly 1 match, found {count}")

PATH.write_text(text.replace(old, new, 1), encoding="utf-8")
print("Inventory browser pilot strict return-scanner selector fixed.")
