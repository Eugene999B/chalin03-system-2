const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..", "..");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

const start = read("frontend", "src", "pages", "EquipmentFinanceStartInstallmentPage.jsx");
const startCss = read("frontend", "src", "styles", "equipmentFinanceStartInstallment.css");
const router = read("frontend", "src", "pages", "EquipmentSalesWorkspacePage.jsx");
const photo = read("frontend", "src", "components", "CustomerPortrait.jsx");
const photoUtility = read("frontend", "src", "utils", "equipmentFinanceCustomerPhoto.js");
const captureRoute = read("backend", "routes", "equipmentFinanceCustomerPhotoCaptureRoutes.js");
const renderer = read("backend", "services", "equipmentFinanceCustomerPhotoRendererService.js");
const documentRenderer = read("backend", "services", "equipmentFinanceDocumentRendererV2Service.js");
const documentFlow = read("backend", "services", "equipmentFinancePdfV2FlowWidgetService.js");
const completionRoutes = read("backend", "routes", "equipmentFinanceDocumentCompletionRoutes.js");

test("the live Start route uses the dedicated transaction studio", () => {
  assert.match(router, /stage === "start"\) return <EquipmentFinanceStartInstallmentPage \/>/);
  assert.match(start, /Customer identity photo/);
  assert.match(start, /CustomerPortraitPicker/);
  assert.match(start, /customer_photo:/);
  assert.match(start, /photoKey/);
  assert.match(startCss, /\.c03-start2-page/);
  assert.match(startCss, /\.c03-start2-photo-card/);
});

test("customer picture accepts normal browser image types and stays optional", () => {
  assert.match(photo, /accept="image\/\*"/);
  assert.match(photoUtility, /MAX_DIMENSION = 1280/);
  assert.match(photoUtility, /TARGET_BYTES = 480 \* 1024/);
  assert.match(photoUtility, /START_INSTALLMENT_PATH/);
  assert.match(photoUtility, /customer_photo: photo/);
});

test("only an explicitly supplied customer photo is committed to the current installment", () => {
  assert.match(captureRoute, /document_type: "customer_passport_photo"/);
  assert.match(captureRoute, /applicationId/);
  assert.doesNotMatch(renderer, /profilePhotoFallback/);
  assert.match(renderer, /if \(!applicationId\) return null/);
  assert.match(renderer, /document\.application_id = \?/);
});

test("customer photo appears only on designated customer-facing Finance documents", () => {
  assert.match(renderer, /PHOTO_DOCUMENT_TYPES/);
  assert.doesNotMatch(renderer, /payment_receipt",/);
  assert.match(documentRenderer, /latestCustomerPhoto/);
  assert.match(documentRenderer, /drawIdentityAnnex/);
  assert.match(documentFlow, /Protected customer identity annex/);
  assert.match(documentFlow, /fit: \[photoWidth - 24, photoHeight - 53\]/);
  assert.match(completionRoutes, /customer_passport_photo_page: true/);
  assert.match(completionRoutes, /customer_photo_encrypted_at_rest: true/);
});

test("the Finance photo flow remains isolated from unrelated business APIs", () => {
  const combined = [start, startCss, router, photo, photoUtility, captureRoute, renderer, documentRenderer, documentFlow, completionRoutes].join("\n");
  assert.doesNotMatch(combined, /\/api\/(?:mining|products|debts)/);
  assert.doesNotMatch(combined, /mining_sites|stock_adjustments|spare_parts/i);
  assert.match(combined, /equipment_installment_finance|equipment-catalogue\/sales/);
});
