from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly 1 match, found {count}")
    return text.replace(old, new, 1)


# Backend pure configuration: Sales enforcement is now implemented. Keep ENFORCED
# exclusive to serialized products; physical-readiness is enforced transactionally
# by the repository service where current identity counts are available.
service_path = ROOT / "backend/services/inventoryTraceabilityService.js"
service = service_path.read_text(encoding="utf-8")
service = replace_once(
    service,
    '''  // Phase 1/2 deliberately cannot claim checkout protection. Server-side Sales\n  // enforcement is introduced only in Phase 3; until then every configured\n  // serialized/batch product remains in setup mode.\n  if (state === TRACEABILITY_STATES.ENFORCED) {\n    const error = new Error(\n      "Serialized enforcement is not available until the Sales & Scanning phase is enabled server-side. Keep this product in setup for now."\n    );\n    error.statusCode = 409;\n    error.code = "TRACEABILITY_ENFORCEMENT_NOT_RELEASED";\n    throw error;\n  }\n''',
    '''  // Exact-ID checkout enforcement is only meaningful for serialized products.\n  // The repository service separately verifies physical identity reconciliation\n  // before a product is allowed to enter ENFORCED for the first time.\n  if (\n    state === TRACEABILITY_STATES.ENFORCED &&\n    mode !== TRACKING_MODES.SERIALIZED\n  ) {\n    const error = new Error(\n      "Exact-ID enforcement is available only for serialized products."\n    );\n    error.statusCode = 409;\n    error.code = "TRACEABILITY_ENFORCEMENT_REQUIRES_SERIALIZED";\n    throw error;\n  }\n''',
    "release serialized enforcement in pure configuration",
)
service_path.write_text(service, encoding="utf-8")

repo_path = ROOT / "backend/services/inventoryTraceabilityRepositoryService.js"
repo = repo_path.read_text(encoding="utf-8")
repo = replace_once(
    repo,
    '''  // Kept as the future Phase 3 invariant. The pure configuration service\n  // currently rejects ENFORCED before this point until checkout integration is released.\n  if (\n    configuration.traceabilityState === TRACEABILITY_STATES.ENFORCED &&\n    configuration.trackingMode === TRACKING_MODES.SERIALIZED &&\n    !current.ready_for_serialized_enforcement\n  ) {''',
    '''  // Entering enforcement is an explicit admin action and is allowed only when\n  // every physical stock unit is represented by one active serialized identity.\n  // Once enforced, legitimate lifecycle states (sold, in transit, quarantine) must\n  // not prevent an admin from saving unrelated policy fields while keeping enforcement.\n  if (\n    configuration.traceabilityState === TRACEABILITY_STATES.ENFORCED &&\n    configuration.trackingMode === TRACKING_MODES.SERIALIZED &&\n    current.inventory_traceability_state !== TRACEABILITY_STATES.ENFORCED &&\n    !current.ready_for_serialized_enforcement\n  ) {''',
    "first-entry enforcement reconciliation invariant",
)
repo_path.write_text(repo, encoding="utf-8")

backend_test_path = ROOT / "backend/tests/inventoryTraceabilityFoundation20260810.test.js"
backend_test = backend_test_path.read_text(encoding="utf-8")
backend_test = replace_once(
    backend_test,
    'test("tracking configuration keeps quantity mode backward compatible and blocks premature enforcement", () => {',
    'test("tracking configuration keeps quantity mode backward compatible and reserves exact-ID enforcement for serialized products", () => {',
    "backend test title",
)
backend_test = replace_once(
    backend_test,
    '''  assert.throws(\n    () =>\n      assertTrackingConfiguration({\n        trackingMode: TRACKING_MODES.SERIALIZED,\n        traceabilityState: TRACEABILITY_STATES.ENFORCED,\n        productCode: "SO4L",\n      }),\n    (error) =>\n      error.code === "TRACEABILITY_ENFORCEMENT_NOT_RELEASED" &&\n      /Sales & Scanning/.test(error.message)\n  );''',
    '''  assert.deepEqual(\n    assertTrackingConfiguration({\n      trackingMode: TRACKING_MODES.SERIALIZED,\n      traceabilityState: TRACEABILITY_STATES.ENFORCED,\n      productCode: "SO4L",\n    }),\n    {\n      trackingMode: "serialized",\n      traceabilityState: "enforced",\n      productCode: "SO4L",\n    }\n  );\n\n  assert.throws(\n    () =>\n      assertTrackingConfiguration({\n        trackingMode: TRACKING_MODES.BATCH,\n        traceabilityState: TRACEABILITY_STATES.ENFORCED,\n        productCode: "SO4L",\n      }),\n    (error) =>\n      error.code === "TRACEABILITY_ENFORCEMENT_REQUIRES_SERIALIZED" &&\n      /only for serialized products/.test(error.message)\n  );''',
    "backend enforcement configuration contract",
)
backend_test_path.write_text(backend_test, encoding="utf-8")

page_path = ROOT / "frontend/src/pages/InventoryTraceabilitySetupPage.jsx"
page = page_path.read_text(encoding="utf-8")
page = replace_once(
    page,
    '''  const metrics = useMemo(() => {\n    const unitRows = overview?.units || [];\n''',
    '''  const canEnableSerializedEnforcement =\n    config.tracking_mode === "serialized" &&\n    (Boolean(productDetail?.product?.ready_for_serialized_enforcement) ||\n      config.traceability_state === "enforced");\n\n  const metrics = useMemo(() => {\n    const unitRows = overview?.units || [];\n''',
    "serialized enforcement readiness state",
)
page = replace_once(
    page,
    '''      const payload = {\n        ...config,\n        // Until checkout enforcement is implemented, the operator-facing page\n        // deliberately exposes setup/off only.\n        traceability_state:\n          config.tracking_mode === "quantity" ? "off" : "setup",\n      };''',
    '''      const payload = {\n        ...config,\n        traceability_state:\n          config.tracking_mode === "quantity"\n            ? "off"\n            : config.tracking_mode === "serialized"\n            ? config.traceability_state\n            : "setup",\n      };''',
    "save actual serialized enforcement choice",
)
page = replace_once(
    page,
    '''                        onChange={(event) =>\n                          setConfig((current) => ({ ...current, tracking_mode: event.target.value }))\n                        }\n''',
    '''                        onChange={(event) => {\n                          const nextMode = event.target.value;\n                          setConfig((current) => ({\n                            ...current,\n                            tracking_mode: nextMode,\n                            traceability_state:\n                              nextMode === "quantity"\n                                ? "off"\n                                : nextMode === "serialized" && current.traceability_state === "enforced"\n                                ? "enforced"\n                                : "setup",\n                          }));\n                        }}\n''',
    "tracking mode preserves only valid rollout states",
)
page = replace_once(
    page,
    '''                    <label>\n                      Rollout state\n                      <input\n                        value={config.tracking_mode === "quantity" ? "Off" : "Setup — enforcement withheld"}\n                        readOnly\n                      />\n                    </label>''',
    '''                    <label>\n                      Rollout state\n                      <select\n                        value={\n                          config.tracking_mode === "quantity"\n                            ? "off"\n                            : config.tracking_mode === "serialized"\n                            ? config.traceability_state\n                            : "setup"\n                        }\n                        disabled={config.tracking_mode !== "serialized"}\n                        onChange={(event) =>\n                          setConfig((current) => ({\n                            ...current,\n                            traceability_state: event.target.value,\n                          }))\n                        }\n                      >\n                        <option value="off">Off — quantity tracking</option>\n                        <option value="setup">Setup — labels/history, no exact-ID checkout</option>\n                        <option\n                          value="enforced"\n                          disabled={!canEnableSerializedEnforcement}\n                        >\n                          Enforced — exact IDs required\n                        </option>\n                      </select>\n                      <small>\n                        {config.tracking_mode === "serialized"\n                          ? canEnableSerializedEnforcement\n                            ? "Identity reconciliation is complete. System Admin may enable exact-ID Sales enforcement."\n                            : "Enforcement unlocks only when active physical IDs exactly match system stock and no labels remain pending."\n                          : "Exact-ID enforcement applies only to serialized products."}\n                      </small>\n                    </label>''',
    "admin rollout state control",
)
page_path.write_text(page, encoding="utf-8")

frontend_test_path = ROOT / "frontend/scripts/inventoryTraceabilityFoundationTests.mjs"
frontend_test = frontend_test_path.read_text(encoding="utf-8")
frontend_test = replace_once(
    frontend_test,
    '''assert.match(setupPage, /traceability_state:\\s*config\\.tracking_mode === "quantity" \\? "off" : "setup"/s);\nassert.doesNotMatch(setupPage, /traceability_state:\\s*"enforced"/);''',
    '''assert.match(setupPage, /config\\.tracking_mode === "serialized"[\\s\\S]*config\\.traceability_state/);\nassert.match(setupPage, /Enforced — exact IDs required/);\nassert.match(setupPage, /canEnableSerializedEnforcement/);\nassert.doesNotMatch(setupPage, /Until checkout enforcement is implemented/);''',
    "frontend enforcement activation contract",
)
frontend_test_path.write_text(frontend_test, encoding="utf-8")

print("Serialized enforcement activation controls applied.")
