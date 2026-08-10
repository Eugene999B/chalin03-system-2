from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def replace(path, old, new, expected=1):
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"{path}: expected {expected}, found {count}: {old!r}")
    target.write_text(text.replace(old, new, expected), encoding="utf-8")


replace(
    "backend/services/inventoryTraceabilityRepositoryService.js",
    '''  const activeIdentityCount = Number(counts.active || 0);\n  const pendingIdentityCount = Number(counts.label_pending || 0);\n  return {\n    ...products[0],\n    quantity: Number(products[0].quantity || 0),\n    unit_counts: counts,\n    active_identity_count: activeIdentityCount,\n    pending_identity_count: pendingIdentityCount,\n    identity_gap: Number(products[0].quantity || 0) - activeIdentityCount,\n    ready_for_serialized_enforcement:\n      products[0].inventory_tracking_mode === TRACKING_MODES.SERIALIZED &&\n      activeIdentityCount === Number(products[0].quantity || 0) &&\n      pendingIdentityCount === 0,\n  };''',
    '''  const activeIdentityCount = Number(counts.active || 0);\n  const pendingIdentityCount = Number(counts.label_pending || 0);\n  const inventoryIdentityCount = [\n    UNIT_STATUSES.LABEL_PENDING,\n    UNIT_STATUSES.ACTIVE,\n    UNIT_STATUSES.RESERVED_SALE,\n    UNIT_STATUSES.IN_TRANSIT,\n    UNIT_STATUSES.RETURNED_QUARANTINE,\n    UNIT_STATUSES.DAMAGED,\n    UNIT_STATUSES.MISSING,\n  ].reduce((sum, status) => sum + Number(counts[status] || 0), 0);\n  const systemQuantity = Number(products[0].quantity || 0);\n  const identityGap = systemQuantity - inventoryIdentityCount;\n  return {\n    ...products[0],\n    quantity: systemQuantity,\n    unit_counts: counts,\n    active_identity_count: activeIdentityCount,\n    pending_identity_count: pendingIdentityCount,\n    inventory_identity_count: inventoryIdentityCount,\n    identity_gap: identityGap,\n    ready_for_serialized_enforcement:\n      products[0].inventory_tracking_mode === TRACKING_MODES.SERIALIZED &&\n      activeIdentityCount === systemQuantity &&\n      inventoryIdentityCount === systemQuantity &&\n      pendingIdentityCount === 0,\n  };'''
)

replace(
    "backend/services/inventoryTraceabilityRepositoryService.js",
    '''  if (product.inventory_traceability_state === TRACEABILITY_STATES.OFF) {\n    const error = new Error("Put the product into traceability setup before generating labels.");\n    error.statusCode = 409;\n    error.code = "TRACEABILITY_SETUP_REQUIRED";\n    throw error;\n  }\n\n  const batchCode = generateBatchCode(''',
    '''  if (product.inventory_traceability_state === TRACEABILITY_STATES.OFF) {\n    const error = new Error("Put the product into traceability setup before generating labels.");\n    error.statusCode = 409;\n    error.code = "TRACEABILITY_SETUP_REQUIRED";\n    throw error;\n  }\n  if (product.identity_gap <= 0) {\n    const error = new Error(\n      "All current system stock is already covered by physical identity records. Resolve or void an existing identity before generating another label batch."\n    );\n    error.statusCode = 409;\n    error.code = "TRACEABILITY_NO_IDENTITY_GAP";\n    throw error;\n  }\n  if (quantity > product.identity_gap) {\n    const error = new Error(\n      `Cannot generate ${quantity} identities when only ${product.identity_gap} unit(s) of system stock remain without identity coverage.`\n    );\n    error.statusCode = 409;\n    error.code = "TRACEABILITY_BATCH_EXCEEDS_IDENTITY_GAP";\n    throw error;\n  }\n\n  const batchCode = generateBatchCode('''
)

replace(
    "database/migrations/20260810_inventory_traceability_foundation.sql",
    '''    UNIQUE KEY uq_inventory_label_batch_code (batch_code),\n    INDEX idx_inventory_label_batch_branch_product (branch_id, product_id, status),\n    INDEX idx_inventory_label_batch_source (source_type, source_id, source_item_id),''',
    '''    UNIQUE KEY uq_inventory_label_batch_code (batch_code),\n    UNIQUE KEY uq_inventory_label_batch_source_item (branch_id, source_type, source_id, source_item_id),\n    INDEX idx_inventory_label_batch_branch_product (branch_id, product_id, status),\n    INDEX idx_inventory_label_batch_source (source_type, source_id, source_item_id),'''
)

verifier = ROOT / "database/migrations/20260810_inventory_traceability_foundation_verify.sql"
text = verifier.read_text(encoding="utf-8")
marker = '''SELECT\n    COUNT(*) AS problem_count,\n    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result\nFROM inventory_label_batches\nWHERE status NOT IN ('draft', 'generated', 'printed', 'verification', 'activated', 'cancelled');\n'''
addition = marker + '''\nSELECT\n    COUNT(*) AS problem_count,\n    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result\nFROM (\n    SELECT branch_id, source_type, source_id, source_item_id\n    FROM inventory_label_batches\n    WHERE source_id IS NOT NULL AND source_item_id IS NOT NULL\n    GROUP BY branch_id, source_type, source_id, source_item_id\n    HAVING COUNT(*) > 1\n) duplicate_source_item_batches;\n'''
if text.count(marker) != 1:
    raise SystemExit("verifier marker mismatch")
verifier.write_text(text.replace(marker, addition, 1), encoding="utf-8")

integration = ROOT / "backend/tests/inventoryTraceabilityIntegrationContract20260810.test.js"
text = integration.read_text(encoding="utf-8")
marker = '''test("label batch finalization requires every generated identity to be activated or voided", () => {\n'''
addition = '''test("label generation cannot mint duplicate identities beyond uncovered physical stock", () => {\n  assert.match(repository, /inventory_identity_count/);\n  assert.match(repository, /TRACEABILITY_NO_IDENTITY_GAP/);\n  assert.match(repository, /TRACEABILITY_BATCH_EXCEEDS_IDENTITY_GAP/);\n  assert.match(migration, /uq_inventory_label_batch_source_item/);\n  assert.match(verifier, /duplicate_source_item_batches/);\n});\n\n''' + marker
if text.count(marker) != 1:
    raise SystemExit("integration marker mismatch")
integration.write_text(text.replace(marker, addition, 1), encoding="utf-8")

print("Identity coverage integrity patch applied.")
