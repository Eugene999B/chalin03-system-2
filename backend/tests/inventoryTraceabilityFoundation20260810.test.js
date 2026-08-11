const test = require("node:test");
const assert = require("node:assert/strict");

const {
  RISK_TIERS,
  TRACEABILITY_STATES,
  TRACKING_MODES,
  UNIT_STATUSES,
  assertTrackingConfiguration,
  assertUnitTransition,
  buildSignedLabelPayload,
  buildUnitEventHash,
  canTransitionUnit,
  generateBatchCode,
  generateUnitCode,
  normalizeProductCode,
  verifySignedLabelPayload,
} = require("../services/inventoryTraceabilityService");

// Constructed at runtime so source-control secret scanners never mistake this
// deterministic test-only value for a real credential.
const TEST_SECRET = ["traceability", "unit-test", "material", "x".repeat(40)].join("-");

test("product traceability codes remain human readable while random unit suffixes avoid ambiguity", () => {
  assert.equal(normalizeProductCode(" so4l "), "SO4L");
  assert.equal(normalizeProductCode("oil01"), "OIL01");
  assert.throws(() => normalizeProductCode("AB"), /3-12/);
  assert.throws(() => normalizeProductCode("STAR-OIL"), /letters\/numbers/);
});

test("unit codes are product-prefixed but use non-sequential random tokens", () => {
  assert.equal(generateUnitCode("SO4L", () => "K7M4Q9XD"), "SO4L-K7M4Q9XD");
  assert.throws(
    () => generateUnitCode("SO4L", () => "00000001"),
    /unit token is invalid/
  );
});

test("label batch codes include store/date plus unpredictable token", () => {
  const batch = generateBatchCode(
    "MAIN",
    new Date("2026-08-10T12:00:00Z"),
    () => "K7M4Q9"
  );
  assert.equal(batch, "LBL-MAIN-20260810-K7M4Q9");
});

test("tracking configuration keeps quantity mode backward compatible and reserves exact-ID enforcement for serialized products", () => {
  assert.deepEqual(
    assertTrackingConfiguration({
      trackingMode: TRACKING_MODES.QUANTITY,
      traceabilityState: TRACEABILITY_STATES.OFF,
      productCode: "",
    }),
    {
      trackingMode: "quantity",
      traceabilityState: "off",
      productCode: null,
    }
  );

  assert.deepEqual(
    assertTrackingConfiguration({
      trackingMode: TRACKING_MODES.SERIALIZED,
      traceabilityState: TRACEABILITY_STATES.SETUP,
      productCode: "SO4L",
    }),
    {
      trackingMode: "serialized",
      traceabilityState: "setup",
      productCode: "SO4L",
    }
  );

  assert.deepEqual(
    assertTrackingConfiguration({
      trackingMode: TRACKING_MODES.SERIALIZED,
      traceabilityState: TRACEABILITY_STATES.ENFORCED,
      productCode: "SO4L",
    }),
    {
      trackingMode: "serialized",
      traceabilityState: "enforced",
      productCode: "SO4L",
    }
  );

  assert.throws(
    () =>
      assertTrackingConfiguration({
        trackingMode: TRACKING_MODES.BATCH,
        traceabilityState: TRACEABILITY_STATES.ENFORCED,
        productCode: "SO4L",
      }),
    (error) =>
      error.code === "TRACEABILITY_ENFORCEMENT_REQUIRES_SERIALIZED" &&
      /only for serialized products/.test(error.message)
  );
});

test("serialized lifecycle prevents sold/voided/written-off identities from silently reappearing", () => {
  assert.equal(canTransitionUnit(UNIT_STATUSES.LABEL_PENDING, UNIT_STATUSES.ACTIVE), true);
  assert.equal(canTransitionUnit(UNIT_STATUSES.ACTIVE, UNIT_STATUSES.RESERVED_SALE), true);
  assert.equal(canTransitionUnit(UNIT_STATUSES.RESERVED_SALE, UNIT_STATUSES.SOLD), true);
  assert.equal(canTransitionUnit(UNIT_STATUSES.SOLD, UNIT_STATUSES.ACTIVE), false);
  assert.equal(canTransitionUnit(UNIT_STATUSES.SOLD, UNIT_STATUSES.RETURNED_QUARANTINE), true);
  assert.equal(canTransitionUnit(UNIT_STATUSES.RETURNED_QUARANTINE, UNIT_STATUSES.ACTIVE), true);
  assert.equal(canTransitionUnit(UNIT_STATUSES.VOIDED, UNIT_STATUSES.ACTIVE), false);
  assert.equal(canTransitionUnit(UNIT_STATUSES.WRITTEN_OFF, UNIT_STATUSES.ACTIVE), false);
  assert.throws(
    () => assertUnitTransition(UNIT_STATUSES.SOLD, UNIT_STATUSES.ACTIVE),
    /cannot move/
  );
});

test("signed QR payload detects tampering and copied payload remains the same identity", () => {
  const payload = buildSignedLabelPayload("SO4L-K7M4Q9XD", TEST_SECRET);
  assert.match(payload, /^C03U1\|SO4L-K7M4Q9XD\|/);

  const valid = verifySignedLabelPayload(payload, TEST_SECRET);
  assert.deepEqual(valid, {
    valid: true,
    unitCode: "SO4L-K7M4Q9XD",
    reason: null,
  });

  const tampered = verifySignedLabelPayload(
    payload.replace("SO4L-K7M4Q9XD", "SO4L-K7M4Q9XE"),
    TEST_SECRET
  );
  assert.equal(tampered.valid, false);
  assert.equal(tampered.reason, "signature");

  const copied = verifySignedLabelPayload(payload, TEST_SECRET);
  assert.equal(copied.unitCode, valid.unitCode);
});

test("unit event hash is deterministic and chained to the previous event", () => {
  const first = buildUnitEventHash({
    unitId: 11,
    eventSequence: 1,
    branchId: 1,
    eventType: "label_generated",
    toStatus: UNIT_STATUSES.LABEL_PENDING,
    actorUserId: 3,
    metadata: { batch: "LBL-MAIN-20260810-K7M4Q9", product: "SO4L" },
  });
  const firstAgain = buildUnitEventHash({
    unitId: 11,
    eventSequence: 1,
    branchId: 1,
    eventType: "label_generated",
    toStatus: UNIT_STATUSES.LABEL_PENDING,
    actorUserId: 3,
    metadata: { product: "SO4L", batch: "LBL-MAIN-20260810-K7M4Q9" },
  });
  assert.equal(first, firstAgain);
  assert.match(first, /^[a-f0-9]{64}$/);

  const second = buildUnitEventHash({
    unitId: 11,
    eventSequence: 2,
    branchId: 1,
    eventType: "unit_activated",
    fromStatus: UNIT_STATUSES.LABEL_PENDING,
    toStatus: UNIT_STATUSES.ACTIVE,
    actorUserId: 4,
    previousEventHash: first,
  });
  assert.notEqual(second, first);

  const changedPrevious = buildUnitEventHash({
    unitId: 11,
    eventSequence: 2,
    branchId: 1,
    eventType: "unit_activated",
    fromStatus: UNIT_STATUSES.LABEL_PENDING,
    toStatus: UNIT_STATUSES.ACTIVE,
    actorUserId: 4,
    previousEventHash: "0".repeat(64),
  });
  assert.notEqual(second, changedPrevious);
});

test("published risk tiers include critical loss-prevention treatment", () => {
  assert.deepEqual(Object.values(RISK_TIERS), [
    "standard",
    "elevated",
    "high",
    "critical",
  ]);
});
