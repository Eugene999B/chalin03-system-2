from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly 1 match, found {count}")
    return text.replace(old, new, 1)


setup_path = ROOT / "frontend/src/pages/InventoryTraceabilitySetupPage.jsx"
setup = setup_path.read_text(encoding="utf-8")
setup = replace_once(
    setup,
    '''      <div className="traceability-safety-banner">\n        <strong>Sales enforcement is not active yet.</strong> This phase prepares and reconciles\n        identities only. A product will not be represented as theft-protected at checkout until\n        the later Sales & Scanning phase rejects missing unit IDs server-side.\n      </div>''',
    '''      <div className="traceability-safety-banner">\n        <strong>Feature-branch Sales enforcement is active for enforced serialized products.</strong>{" "}\n        Exact physical IDs are required at checkout on this development branch. Production remains\n        unchanged until this draft feature is explicitly reviewed, released and deployed.\n      </div>''',
    "truthful feature-branch enforcement banner",
)
setup_path.write_text(setup, encoding="utf-8")

styles_path = ROOT / "frontend/src/styles/inventoryTraceabilityHub.css"
styles = styles_path.read_text(encoding="utf-8")
styles = replace_once(
    styles,
    "grid-template-columns: repeat(3, minmax(0, 1fr));",
    "grid-template-columns: repeat(4, minmax(0, 1fr));",
    "four-workspace hub grid",
)
styles_path.write_text(styles, encoding="utf-8")

test_path = ROOT / "frontend/scripts/inventoryTraceabilityFoundationTests.mjs"
test = test_path.read_text(encoding="utf-8")
test = replace_once(
    test,
    'const lossPage = read("src/pages/InventoryLossControlPage.jsx");\n',
    'const quarantinePage = read("src/pages/InventoryReturnQuarantinePage.jsx");\nconst lossPage = read("src/pages/InventoryLossControlPage.jsx");\n',
    "quarantine page test fixture",
)
test = replace_once(
    test,
    '''assert.match(hub, /Serialized Receiving/);\nassert.match(hub, /Blind Counts & Investigations/);\nassert.match(hub, /InventoryTraceabilitySetupPage/);\nassert.match(hub, /InventorySerializedReceivingPage/);\nassert.match(hub, /InventoryLossControlPage/);''',
    '''assert.match(hub, /Serialized Receiving/);\nassert.match(hub, /Return Quarantine/);\nassert.match(hub, /Blind Counts & Investigations/);\nassert.match(hub, /InventoryTraceabilitySetupPage/);\nassert.match(hub, /InventorySerializedReceivingPage/);\nassert.match(hub, /InventoryReturnQuarantinePage/);\nassert.match(hub, /InventoryLossControlPage/);''',
    "four-workspace hub contract",
)
test = replace_once(
    test,
    'assert.match(setupPage, /Sales enforcement is not active yet/);',
    'assert.match(setupPage, /Feature-branch Sales enforcement is active for enforced serialized products/);\nassert.match(setupPage, /Production remains/);',
    "truthful sales enforcement contract",
)
test = replace_once(
    test,
    '''assert.match(receivingStyles, /\\.serialized-receiving__card/);\n\nassert.match(lossPage, /Blind Counts & Investigations/);''',
    '''assert.match(receivingStyles, /\\.serialized-receiving__card/);\n\nassert.match(quarantinePage, /Return Quarantine/);\nassert.match(quarantinePage, /Quarantine is inventory, not sellable stock/);\nassert.match(quarantinePage, /Complete Inspection/);\n\nassert.match(lossPage, /Blind Counts & Investigations/);''',
    "return quarantine contract",
)
test = replace_once(
    test,
    'assert.match(hubStyles, /repeat\\(3, minmax\\(0, 1fr\\)\\)/);',
    'assert.match(hubStyles, /repeat\\(4, minmax\\(0, 1fr\\)\\)/);',
    "four-column hub style contract",
)
test = replace_once(
    test,
    'console.log("Inventory Traceability, Serialized Receiving + Loss Control frontend contract passed.");',
    'console.log("Inventory Traceability, Receiving, Return Quarantine + Loss Control frontend contract passed.");',
    "frontend contract completion message",
)
test_path.write_text(test, encoding="utf-8")

print("Inventory pilot clarity fixes applied.")
