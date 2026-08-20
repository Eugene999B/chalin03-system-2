const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..", "..");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

const selectionCss = read(
  "frontend",
  "src",
  "styles",
  "equipmentFinanceCustomerSelectionPhoto.css"
);
const photoPanel = read(
  "frontend",
  "src",
  "components",
  "EquipmentFinanceCustomerPhotoPanel.jsx"
);
const photoUtility = read(
  "frontend",
  "src",
  "utils",
  "equipmentFinanceCustomerPhoto.js"
);
const startRedirect = read(
  "frontend",
  "src",
  "pages",
  "EquipmentFinancePhaseThreeStartRedirectPage.jsx"
);
const captureRoute = read(
  "backend",
  "routes",
  "equipmentFinanceCustomerPhotoCaptureRoutes.js"
);
const independentRoutes = read(
  "backend",
  "routes",
  "equipmentFinanceIndependentRoutes.js"
);
const renderer = read(
  "backend",
  "services",
  "equipmentFinanceCustomerPhotoRendererService.js"
);
const documentRenderer = read(
  "backend",
  "services",
  "equipmentFinanceDocumentRendererV2Service.js"
);
const documentFlow = read(
  "backend",
  "services",
  "equipmentFinancePdfV2FlowWidgetService.js"
);
const completionRoutes = read(
  "backend",
  "routes",
  "equipmentFinanceDocumentCompletionRoutes.js"
);

test("existing Finance customer cards have an unmistakable selected state", () => {
  assert.match(selectionCss, /finance-simple__customer-grid > button\.is-selected/);
  assert.match(selectionCss, /SELECTED CUSTOMER/);
  assert.match(selectionCss, /content: "✓"/);
  assert.match(selectionCss, /focus-visible/);
  assert.match(selectionCss, /@media \(max-width: 620px\)/);
  assert.match(startRedirect, /EquipmentFinanceOperationalStartImmediatePage/);
  assert.match(startRedirect, /EquipmentFinanceCustomerPhotoPanel/);
});

test("passport picture is compressed without cropping and bridged only to Finance start", () => {
  assert.match(photoPanel, /accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(photoPanel, /capture="user"/);
  assert.match(photoPanel, /Full image preserved/);
  assert.match(photoUtility, /MAX_DIMENSION = 1280/);
  assert.match(photoUtility, /TARGET_BYTES = 480 \* 1024/);
  assert.match(photoUtility, /context\.drawImage\(image, 0, 0, width, height\)/);
  assert.doesNotMatch(photoUtility, /drawImage\([^\n]*sourceX|crop/i);
  assert.match(selectionCss, /object-fit: contain/);
  assert.match(photoUtility, /START_INSTALLMENT_PATH/);
  assert.match(photoUtility, /customer_photo: photo/);
  assert.match(startRedirect, /installFinanceCustomerPhotoRequestBridge/);
  assert.match(startRedirect, /settleCommittedPhoto/);
});

test("customer photo is encrypted after the Finance application commits", () => {
  const captureIndex = independentRoutes.indexOf(
    "router.use(equipmentFinanceCustomerPhotoCaptureRoutes)"
  );
  const creationIndex = independentRoutes.indexOf(
    "router.use(equipmentFinanceImageSafeStartRoutes)"
  );
  assert.ok(captureIndex > 0 && creationIndex > captureIndex);
  assert.match(captureRoute, /res\.json = \(payload\) =>/);
  assert.match(captureRoute, /successfulCreation\(res, payload\)/);
  assert.match(captureRoute, /uploadDocument\(\{/);
  assert.match(captureRoute, /document_category: "kyc_identity"/);
  assert.match(captureRoute, /document_type: "customer_passport_photo"/);
  assert.match(captureRoute, /stored: true/);
  assert.match(captureRoute, /stored: false/);
  assert.doesNotMatch(captureRoute, /UPDATE\s+(?:equipment_sale_agreements|equipment_sale_payments|equipment_installment_schedule)/i);
  assert.doesNotMatch(captureRoute, /DELETE\s+FROM/i);
});

test("logo-led V3 Finance documents retain the full-frame encrypted identity annex", () => {
  assert.match(renderer, /AsyncLocalStorage/);
  assert.match(renderer, /decryptDocument/);
  assert.match(renderer, /customer_passport_photo/);
  assert.match(renderer, /PHOTO_DOCUMENT_TYPES/);
  assert.doesNotMatch(renderer, /payment_receipt",/);
  assert.match(documentRenderer, /latestCustomerPhoto/);
  assert.match(documentRenderer, /drawIdentityAnnex/);
  assert.match(documentFlow, /Protected customer identity annex/);
  assert.match(documentFlow, /fit: \[photoWidth - 24, photoHeight - 53\]/);
  assert.match(documentFlow, /ENCRYPTED FINANCE-VAULT IDENTITY EVIDENCE/);
  assert.match(completionRoutes, /equipmentFinanceDocumentRendererV2Service/);
  assert.match(completionRoutes, /const buffer = await renderCompletionWord\(document\)/);
  assert.match(completionRoutes, /customer_passport_photo_page: true/);
  assert.match(completionRoutes, /customer_photo_encrypted_at_rest: true/);
  assert.match(completionRoutes, /professional-logo-led-v3/);
});

test("scope remains Equipment Installment Finance only", () => {
  const combined = [
    selectionCss,
    photoPanel,
    photoUtility,
    startRedirect,
    captureRoute,
    renderer,
    documentRenderer,
    documentFlow,
    completionRoutes,
  ].join("\n");
  assert.doesNotMatch(combined, /\/api\/(?:mining|products|sales|debts)/);
  assert.doesNotMatch(combined, /mining_sites|stock_adjustments|spare_parts/i);
  assert.match(combined, /equipment_installment_finance|equipment-catalogue\/sales/);
});
