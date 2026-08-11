from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly 1 match, found {count}")
    return text.replace(old, new, 1)


def patch_returns_page():
    path = ROOT / "frontend/src/pages/ReturnsPage.jsx"
    text = path.read_text(encoding="utf-8")

    text = replace_once(
        text,
        'import MultiItemReturnPanel from "../components/MultiItemReturnPanel";\n',
        'import MultiItemReturnPanel from "../components/MultiItemReturnPanel";\nimport InventoryReturnUnitScanner from "../components/InventoryReturnUnitScanner";\n',
        "return scanner import",
    )
    text = replace_once(
        text,
        '  const [error, setError] = useState("");\n',
        '  const [error, setError] = useState("");\n  const [returnUnitIds, setReturnUnitIds] = useState([]);\n',
        "returned unit state",
    )
    text = replace_once(
        text,
        """  const estimatedReturnAmount =\n    Number(selectedReturnItem?.unit_price || 0) * Number(form.quantity || 0);\n""",
        """  const estimatedReturnAmount =\n    Number(selectedReturnItem?.unit_price || 0) * Number(form.quantity || 0);\n  const serializedReturnRequired = Boolean(\n    selectedReturnItem?.serialized_return_requires_unit_ids ||\n      (selectedReturnItem?.inventory_tracking_mode === \"serialized\" &&\n        selectedReturnItem?.inventory_traceability_state === \"enforced\")\n  );\n""",
        "serialized return policy",
    )
    text = replace_once(
        text,
        """    if (!saleId) {\n      setSelectedSale(null);\n      setSaleItems([]);\n      return;\n    }""",
        """    if (!saleId) {\n      setSelectedSale(null);\n      setSaleItems([]);\n      setReturnUnitIds([]);\n      return;\n    }""",
        "clear IDs without sale",
    )
    text = replace_once(
        text,
        """      setSaleItems(response.data.items || []);\n      setForm(EMPTY_FORM);""",
        """      setSaleItems(response.data.items || []);\n      setForm(EMPTY_FORM);\n      setReturnUnitIds([]);""",
        "reset IDs after sale load",
    )
    text = replace_once(
        text,
        """  function handleSaleSelect(event) {\n    const saleId = event.target.value;\n    setSelectedSaleId(saleId);\n    loadSaleItems(saleId);\n  }\n\n  function handleFormChange(event) {\n    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));\n  }""",
        """  function handleSaleSelect(event) {\n    const saleId = event.target.value;\n    setSelectedSaleId(saleId);\n    setReturnUnitIds([]);\n    loadSaleItems(saleId);\n  }\n\n  function handleFormChange(event) {\n    const { name, value } = event.target;\n    setForm((current) => ({ ...current, [name]: value }));\n    if (name === \"product_id\") {\n      setReturnUnitIds([]);\n    }\n    if (name === \"quantity\") {\n      const nextQuantity = Number(value || 0);\n      setReturnUnitIds((current) =>\n        Number.isInteger(nextQuantity) && nextQuantity >= 0\n          ? current.slice(0, nextQuantity)\n          : []\n      );\n    }\n  }""",
        "form change unit reset",
    )
    text = replace_once(
        text,
        """    if (!form.reason.trim()) {\n      setError(\"Enter the reason for the return.\");\n      return;\n    }\n\n    const isRefund""",
        """    if (!form.reason.trim()) {\n      setError(\"Enter the reason for the return.\");\n      return;\n    }\n    if (\n      serializedReturnRequired &&\n      returnUnitIds.length !== Number(form.quantity)\n    ) {\n      setError(\n        `${selectedReturnItem?.product_name || \"This serialized product\"} requires exactly ${Number(form.quantity)} verified returned physical unit ID${Number(form.quantity) === 1 ? \"\" : \"s\"}.`\n      );\n      return;\n    }\n\n    const isRefund""",
        "frontend exact ID validation",
    )
    text = replace_once(
        text,
        """        refund_reference: isRefund ? form.refund_reference.trim() : \"\",\n      };\n\n      const response""",
        """        refund_reference: isRefund ? form.refund_reference.trim() : \"\",\n      };\n      if (serializedReturnRequired) {\n        payload.unit_ids = returnUnitIds;\n      }\n\n      const response""",
        "return exact ID payload",
    )
    text = replace_once(
        text,
        """      setMessage(response.data.message || \"Return processed successfully.\");\n      setForm(EMPTY_FORM);""",
        """      setMessage(response.data.message || \"Return processed successfully.\");\n      setForm(EMPTY_FORM);\n      setReturnUnitIds([]);""",
        "reset IDs after return",
    )
    text = replace_once(
        text,
        '<summary>Single Item Return — optional fallback</summary>',
        '<summary>Single Item Return — exact-ID returns / fallback</summary>',
        "single-item summary",
    )
    text = replace_once(
        text,
        """            <input\n              type=\"number\"\n              name=\"quantity\"\n              value={form.quantity}\n              onChange={handleFormChange}\n              min=\"1\"\n            />\n\n            <label>Reason</label>""",
        """            <input\n              type=\"number\"\n              name=\"quantity\"\n              value={form.quantity}\n              onChange={handleFormChange}\n              min=\"1\"\n            />\n\n            {serializedReturnRequired && selectedReturnItem ? (\n              <div style={{ marginTop: 10, marginBottom: 12 }}>\n                <InventoryReturnUnitScanner\n                  saleId={selectedSaleId}\n                  product={selectedReturnItem}\n                  requiredCount={Number(form.quantity || 0)}\n                  selectedUnitCodes={returnUnitIds}\n                  onChange={setReturnUnitIds}\n                  disabled={saving}\n                />\n                <div className=\"warning-box\" style={{ marginTop: 10 }}>\n                  Returned serialized units are quarantined first. They increase physical inventory but do not become sellable until an authorized inspection clears each exact ID.\n                </div>\n              </div>\n            ) : null}\n\n            <label>Reason</label>""",
        "return scanner render",
    )

    path.write_text(text, encoding="utf-8")


def patch_multi_item():
    path = ROOT / "frontend/src/components/MultiItemReturnPanel.jsx"
    text = path.read_text(encoding="utf-8")

    text = replace_once(
        text,
        """    unit_price: Number(item.unit_price || 0),\n    selected: false,""",
        """    unit_price: Number(item.unit_price || 0),\n    serialized_return_requires_unit_ids: Boolean(\n      item.serialized_return_requires_unit_ids ||\n        (item.inventory_tracking_mode === \"serialized\" &&\n          item.inventory_traceability_state === \"enforced\")\n    ),\n    selected: false,""",
        "multi-item serialized policy",
    )
    text = replace_once(
        text,
        """    for (const line of selectedLines) {\n      const quantity""",
        """    for (const line of selectedLines) {\n      if (line.serialized_return_requires_unit_ids) {\n        return `${line.product_name}: serialized exact-ID returns cannot use the multi-item shortcut. Use Single Item Return to scan the physical IDs.`;\n      }\n\n      const quantity""",
        "multi-item serialized validation",
    )
    text = replace_once(
        text,
        """          const unavailable =\n            line.remaining_quantity <= 0 || line.active_refund_request_count > 0;""",
        """          const unavailable =\n            line.remaining_quantity <= 0 ||\n            line.active_refund_request_count > 0 ||\n            line.serialized_return_requires_unit_ids;""",
        "multi-item serialized unavailable",
    )
    text = replace_once(
        text,
        """                    {line.active_refund_request_codes.length > 0\n                      ? ` · ${line.active_refund_request_codes.join(\", \")}`\n                      : \"\"}\n                  </small>""",
        """                    {line.active_refund_request_codes.length > 0\n                      ? ` · ${line.active_refund_request_codes.join(\", \")}`\n                      : \"\"}\n                    {line.serialized_return_requires_unit_ids\n                      ? \" · Use Single Item Return to scan exact physical IDs\"\n                      : \"\"}\n                  </small>""",
        "multi-item serialized guidance",
    )
    text = replace_once(
        text,
        """      <p className=\"returns-batch-intro\">\n        Select every product the customer""",
        """      <p className=\"returns-batch-intro\">\n        Serialized exact-ID returns cannot use the multi-item shortcut; use Single Item Return so every physical ID is verified against the receipt and quarantined.\n        <br />\n        Select every other product the customer""",
        "multi-item intro guidance",
    )

    path.write_text(text, encoding="utf-8")


def patch_package():
    path = ROOT / "frontend/package.json"
    text = path.read_text(encoding="utf-8")
    old = "node scripts/inventoryTraceabilityFoundationTests.mjs\""
    new = "node scripts/inventoryTraceabilityFoundationTests.mjs && node scripts/inventorySerializedReturnsTests.mjs\""
    text = replace_once(text, old, new, "frontend test command")
    path.write_text(text, encoding="utf-8")


patch_returns_page()
patch_multi_item()
patch_package()
print("Serialized Returns frontend integration applied.")
