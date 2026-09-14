const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const root = path.resolve(__dirname, "../..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const {
  FinanceProtectedImageError,
  normalizeStoredImage,
} = require("../services/equipmentFinanceProtectedImageService");
const {
  machineWithProtectedReferences,
  sendImage,
} = require("../routes/equipmentFinancePhaseTwoImageRoutes");

const independentRoutes = read(
  "backend",
  "routes",
  "equipmentFinanceIndependentRoutes.js"
);
const imageRoutes = read(
  "backend",
  "routes",
  "equipmentFinancePhaseTwoImageRoutes.js"
);
const bridge = read(
  "frontend",
  "src",
  "utils",
  "equipmentMediaCaptureBridge.js"
);
const component = read(
  "frontend",
  "src",
  "components",
  "ProtectedFinanceImage.jsx"
);

async function sampleBuffer(format) {
  const image = sharp({
    create: {
      width: 12,
      height: 8,
      channels: 3,
      background: { r: 40, g: 120, b: 180 },
    },
  });
  if (format === "jpeg") return image.jpeg().toBuffer();
  if (format === "png") return image.png().toBuffer();
  if (format === "webp") return image.webp().toBuffer();
  if (format === "tiff") return image.tiff().toBuffer();
  throw new Error(`Unsupported test format: ${format}`);
}

test("JPEG, PNG and WebP bytes remain browser-native after validation", async () => {
  const expectations = new Map([
    ["jpeg", "image/jpeg"],
    ["png", "image/png"],
    ["webp", "image/webp"],
  ]);
  for (const [format, mimeType] of expectations) {
    const source = await sampleBuffer(format);
    const image = await normalizeStoredImage(source);
    assert.equal(image.mimeType, mimeType);
    assert.equal(image.transcoded, false);
    assert.equal(image.width, 12);
    assert.equal(image.height, 8);
    assert.ok(image.buffer.length > 0);
  }
});

test("older valid TIFF evidence is converted to a browser-safe PNG", async () => {
  const source = await sampleBuffer("tiff");
  const image = await normalizeStoredImage(source);
  assert.equal(image.sourceFormat, "tiff");
  assert.equal(image.mimeType, "image/png");
  assert.equal(image.transcoded, true);
  assert.ok(image.buffer.length > 0);
  const metadata = await sharp(image.buffer).metadata();
  assert.equal(metadata.format, "png");
  assert.equal(metadata.width, 12);
  assert.equal(metadata.height, 8);
});

test("invalid bytes and SVG content fail closed", async () => {
  await assert.rejects(
    () => normalizeStoredImage(Buffer.from("not-an-image")),
    (error) =>
      error instanceof FinanceProtectedImageError &&
      error.code === "FINANCE_PROTECTED_IMAGE_INVALID_BYTES"
  );
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'
  );
  await assert.rejects(
    () => normalizeStoredImage(svg),
    (error) =>
      error instanceof FinanceProtectedImageError &&
      error.code === "FINANCE_PROTECTED_IMAGE_UNSUPPORTED_FORMAT"
  );
});

test("machine lists advertise protected references but never picture bytes", () => {
  const machine = machineWithProtectedReferences({
    id: 31,
    asset_name: "Protected Excavator",
    has_legacy_image: true,
    main_image_url: "data:image/png;base64,unsafe-list-bytes",
    media: [
      {
        id: 91,
        is_primary: true,
        file_url: "data:image/jpeg;base64,unsafe-list-bytes",
      },
    ],
  });
  assert.equal(
    machine.main_image_url,
    "/equipment-catalogue/sales/protected-images/assets/31/91"
  );
  assert.equal(machine.main_image_path, machine.main_image_url);
  assert.equal(machine.media[0].file_url, machine.main_image_url);
  assert.equal(machine.media[0].image_path, machine.main_image_url);
  assert.equal(JSON.stringify(machine).includes("base64"), false);
  assert.equal(machine.has_image, true);
});

test("protected image responses are HTTP 200 private image bytes", () => {
  const headers = {};
  const response = {
    statusCode: null,
    body: null,
    setHeader(name, value) {
      headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
  };
  const bytes = Buffer.from([137, 80, 78, 71]);
  sendImage(response, {
    buffer: bytes,
    mimeType: "image/png",
    width: 1,
    height: 1,
    transcoded: false,
  });
  assert.equal(response.statusCode, 200);
  assert.equal(headers["Content-Type"], "image/png");
  assert.equal(headers["Content-Length"], String(bytes.length));
  assert.equal(headers["Cache-Control"], "private, no-store");
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.ok(response.body.length > 0);
});

test("Phase 2 image authority owns protected routes before old handlers", () => {
  assert.match(
    independentRoutes,
    /require\("\.\/equipmentFinancePhaseTwoImageRoutes"\)/
  );
  const phaseTwoMount = independentRoutes.indexOf(
    "router.use(equipmentFinancePhaseTwoImageRoutes)"
  );
  const criticalMount = independentRoutes.indexOf(
    "router.use(equipmentFinanceCriticalEntryRoutes)"
  );
  const legacyReadMount = independentRoutes.indexOf(
    'router.use("/credit-applications", equipmentFinanceApplicationReadRoutes)'
  );
  assert.ok(phaseTwoMount >= 0);
  assert.ok(phaseTwoMount < criticalMount);
  assert.ok(phaseTwoMount < legacyReadMount);

  assert.match(imageRoutes, /"\/protected-images\/assets\/:assetId\/:photoId"/);
  assert.match(imageRoutes, /"\/protected-images\/applications\/:applicationId"/);
  assert.match(imageRoutes, /"\/credit-applications\/:applicationId\/image"/);
  assert.ok((imageRoutes.match(/requirePermission\(VIEW_PERMISSION\)/g) || []).length >= 5);
  assert.match(imageRoutes, /list_contains_image_bytes: false/);
  assert.match(imageRoutes, /application_transaction_contains_image_bytes: false/);
});

test("browser image loading uses authenticated Axios blobs and decoded dimensions", () => {
  assert.match(bridge, /axios\.get\(financeImageRequestUrl\(normalizedSource\)/);
  assert.match(bridge, /responseType: "blob"/);
  assert.match(bridge, /Authorization: `Bearer \$\{token\}`/);
  assert.match(bridge, /"X-Chalin03-Division": "installment_finance"/);
  assert.match(bridge, /response\.status !== 200/);
  assert.match(bridge, /contentType\.startsWith\("image\/"\)/);
  assert.match(bridge, /!blob\.size/);
  assert.match(bridge, /URL\.createObjectURL\(blob\)/);
  assert.match(bridge, /image\.naturalWidth > 0 && image\.naturalHeight > 0/);
  assert.match(bridge, /Photo unavailable/);

  assert.match(component, /responseType: "blob"/);
  assert.match(component, /URL\.createObjectURL\(blob\)/);
  assert.match(component, /image\.naturalWidth > 0/);
  assert.match(component, /data-image-state/);
  assert.match(component, /Photo unavailable/);
  assert.match(component, /Retry/);
});