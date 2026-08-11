from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly 1 match, found {count}")
    return text.replace(old, new, 1)


pilot_path = ROOT / "frontend/e2e/inventoryLossPreventionPilot.spec.js"
pilot = pilot_path.read_text(encoding="utf-8")
pilot = replace_once(
    pilot,
    '  await expect(singleReturn.getByText(/verified against this receipt/)).toBeVisible();\n',
    '''  await expect(\n    singleReturn.locator(".inventory-unit-scanner__message")\n  ).toContainText(`${UNIT_CODE} verified against this receipt`);\n''',
    "return scanner strict selector",
)
pilot = replace_once(
    pilot,
    '  await expect(page.getByText("CNT-PILOT-77")).toBeVisible();\n',
    '''  await expect(\n    page.getByRole("heading", { name: "CNT-PILOT-77", exact: true })\n  ).toBeVisible();\n''',
    "active blind count strict selector",
)
pilot_path.write_text(pilot, encoding="utf-8")

returns_path = ROOT / "frontend/src/pages/ReturnsPage.jsx"
returns = returns_path.read_text(encoding="utf-8")
returns = replace_once(
    returns,
    '''      setMessage(response.data.message || "Return processed successfully.");\n      setForm(EMPTY_FORM);\n      setReturnUnitIds([]);\n\n      if (isRefund) {\n        await Promise.all([loadSaleItems(selectedSaleId), loadSales()]);\n      } else {\n        await Promise.all([\n          loadSaleItems(selectedSaleId),\n          loadReturns(),\n          loadSales(),\n        ]);\n      }''',
    '''      const successMessage =\n        response.data.message || "Return processed successfully.";\n      setForm(EMPTY_FORM);\n      setReturnUnitIds([]);\n\n      if (isRefund) {\n        await Promise.all([loadSaleItems(selectedSaleId), loadSales()]);\n      } else {\n        await Promise.all([\n          loadSaleItems(selectedSaleId),\n          loadReturns(),\n          loadSales(),\n        ]);\n      }\n      // loadSaleItems intentionally clears stale messages when changing receipts.\n      // Restore this completed action's server message after the refresh so the\n      // operator keeps the quarantine/refund confirmation they need to see.\n      setMessage(successMessage);''',
    "single return success message survives data refresh",
)
returns = replace_once(
    returns,
    '''  async function handleMultiReturnResult(result) {\n    setMessage(result?.message || "");\n    setError(result?.error || "");\n\n    if (!result?.pendingApproval) {\n      await Promise.all([\n        loadSaleItems(selectedSaleId),\n        loadReturns(),\n        loadSales(),\n      ]);\n    } else {\n      await Promise.all([loadSaleItems(selectedSaleId), loadSales()]);\n    }\n  }''',
    '''  async function handleMultiReturnResult(result) {\n    setError(result?.error || "");\n\n    if (!result?.pendingApproval) {\n      await Promise.all([\n        loadSaleItems(selectedSaleId),\n        loadReturns(),\n        loadSales(),\n      ]);\n    } else {\n      await Promise.all([loadSaleItems(selectedSaleId), loadSales()]);\n    }\n    setMessage(result?.message || "");\n  }''',
    "multi return success message survives data refresh",
)
returns_path.write_text(returns, encoding="utf-8")

contract_path = ROOT / "frontend/scripts/inventorySerializedReturnsTests.mjs"
contract = contract_path.read_text(encoding="utf-8")
contract = replace_once(
    contract,
    '''assert.match(returnsPage, /Returned serialized units are quarantined/i);\n''',
    '''assert.match(returnsPage, /Returned serialized units are quarantined/i);\nassert.match(\n  returnsPage,\n  /const successMessage =[\\s\\S]*await Promise\\.all[\\s\\S]*setMessage\\(successMessage\\)/\n);\nassert.match(\n  returnsPage,\n  /async function handleMultiReturnResult[\\s\\S]*await Promise\\.all[\\s\\S]*setMessage\\(result\\?\\.message/\n);\n''',
    "persistent Returns success-message regression contract",
)
contract_path.write_text(contract, encoding="utf-8")

print("Inventory browser selectors and persistent Returns success-message fixes applied.")
