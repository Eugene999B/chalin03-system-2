from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly 1 match, found {count}")
    return text.replace(old, new, 1)


page_path = ROOT / "frontend/src/pages/StockTransfersPage.jsx"
page = page_path.read_text(encoding="utf-8")

page = replace_once(
    page,
    'import { useAuth } from "../context/AuthContext";\n',
    'import { useAuth } from "../context/AuthContext";\nimport InventoryTransferIdentityPanel from "../components/InventoryTransferIdentityPanel";\n',
    "transfer identity panel import",
)

page = replace_once(
    page,
    '''  const [selectedTransfer, setSelectedTransfer] = useState(null);\n  const [actionNote, setActionNote] = useState("");\n''',
    '''  const [selectedTransfer, setSelectedTransfer] = useState(null);\n  const [actionNote, setActionNote] = useState("");\n  const [transferIdentityPolicy, setTransferIdentityPolicy] = useState("none");\n''',
    "transfer identity policy state",
)

page = replace_once(
    page,
    '''  async function loadTransferDetails(transferId) {\n    setError("");\n\n    try {\n''',
    '''  async function loadTransferDetails(transferId) {\n    setError("");\n    if (Number(selectedTransfer?.id) !== Number(transferId)) {\n      setTransferIdentityPolicy("loading");\n    }\n\n    try {\n''',
    "transfer policy loading gate",
)

page = replace_once(
    page,
    '''  function canApprove(transfer) {\n''',
    '''  async function handleSerializedTransferCompleted({ message, result }) {\n    setNotice(message || "Serialized stock transfer updated successfully.");\n    setError("");\n    setActionNote("");\n\n    if (result?.status && selectedTransfer) {\n      setSelectedTransfer((current) =>\n        current && Number(current.id) === Number(result.transfer_id)\n          ? { ...current, status: result.status }\n          : current\n      );\n    }\n\n    await Promise.all([loadTransfers(), loadProducts()]);\n    if (selectedTransfer?.id) {\n      await loadTransferDetails(selectedTransfer.id);\n    }\n  }\n\n  function canApprove(transfer) {\n''',
    "serialized transfer completion handler",
)

page = replace_once(
    page,
    '''                {canDispatch(selectedTransfer) && (\n''',
    '''                {(canDispatch(selectedTransfer) || canReceive(selectedTransfer)) &&\n                  transferIdentityPolicy === "loading" && (\n                    <div style={styles.info}>\n                      Checking physical-ID transfer policy…\n                    </div>\n                  )}\n\n                {canDispatch(selectedTransfer) &&\n                  transferIdentityPolicy === "quantity" && (\n''',
    "dispatch policy gate",
)

page = replace_once(
    page,
    '''                {canReceive(selectedTransfer) && (\n''',
    '''                {canReceive(selectedTransfer) &&\n                  transferIdentityPolicy === "quantity" && (\n''',
    "receive policy gate",
)

page = replace_once(
    page,
    '''              </div>\n\n              <div style={styles.detailItemList}>\n''',
    '''              </div>\n\n              <InventoryTransferIdentityPanel\n                transfer={selectedTransfer}\n                actionNote={actionNote}\n                disabled={Boolean(actionLoading)}\n                onPolicyChange={setTransferIdentityPolicy}\n                onCompleted={handleSerializedTransferCompleted}\n              />\n\n              <div style={styles.detailItemList}>\n''',
    "serialized transfer panel mount",
)

page_path.write_text(page, encoding="utf-8")

panel_path = ROOT / "frontend/src/components/InventoryTransferIdentityPanel.jsx"
panel = panel_path.read_text(encoding="utf-8")
panel = replace_once(
    panel,
    '''      const response = await axiosClient.post(\n        `/inventory-traceability/transfer-control/${transferId}/${phase === "dispatch" ? "dispatch" : "receive"}`,\n        payload\n      );\n      setScansByItem({});\n''',
    '''      const response = await axiosClient.post(\n        `/inventory-traceability/transfer-control/${transferId}/${phase === "dispatch" ? "dispatch" : "receive"}`,\n        payload\n      );\n      const nextPlan = response.data || null;\n      setPlan(nextPlan);\n      onPolicyChange?.(nextPlan?.serialized_identity_required ? "serialized" : "quantity");\n      setScansByItem({});\n''',
    "fresh post-action transfer plan",
)
panel_path.write_text(panel, encoding="utf-8")

package_path = ROOT / "frontend/package.json"
package = package_path.read_text(encoding="utf-8")
package = replace_once(
    package,
    'node scripts/inventoryTraceabilityFoundationTests.mjs",',
    'node scripts/inventoryTraceabilityFoundationTests.mjs && node scripts/inventorySerializedTransferTests.mjs",',
    "frontend serialized transfer contract registration",
)
package_path.write_text(package, encoding="utf-8")

print("Serialized transfer UI integration applied.")
