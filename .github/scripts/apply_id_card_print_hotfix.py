from pathlib import Path

ROUTES_PATH = Path("backend/routes/workerPrintRoutes.js")
SERVICE_PATH = Path("backend/services/workerCardArtworkService.js")
TEST_PATH = Path("backend/tests/workerCardPrintLayout.test.js")

routes = ROUTES_PATH.read_text(encoding="utf-8")
service = SERVICE_PATH.read_text(encoding="utf-8")
tests = TEST_PATH.read_text(encoding="utf-8")

import_anchor = '''const {
  normalizePdfImageBuffer,
} = require("../services/pdfImageService");
'''
new_import = '''const {
  normalizePdfImageBuffer,
} = require("../services/pdfImageService");
const {
  buildA4ProofCardPdf,
  buildExactCr80CardPdf,
} = require("../services/workerCardArtworkService");
'''

if "workerCardArtworkService" not in routes:
    if import_anchor not in routes:
        raise RuntimeError("Could not locate the PDF image service import.")
    routes = routes.replace(import_anchor, new_import, 1)

old_builder = '''    const buffer =
      layout === "a4"
        ? await buildA4CardSheetPdf(data)
        : await buildExactCardPdf(data);'''
new_builder = '''    // Use complete 300-DPI artwork for each side. One artwork image is
    // placed on one physical page, preventing PDFKit text flow from creating
    // a blank page or a third page during CR80 printing.
    const buffer =
      layout === "a4"
        ? await buildA4ProofCardPdf(data)
        : await buildExactCr80CardPdf(data);'''

if old_builder not in routes:
    if "buildExactCr80CardPdf(data)" not in routes:
        raise RuntimeError("Could not locate the ID-card PDF builder selection.")
else:
    routes = routes.replace(old_builder, new_builder, 1)

service = service.replace(
    'sharp(Buffer.from(frontSvg(data)), { density: 300 })',
    'sharp(Buffer.from(frontSvg(data)))',
)
service = service.replace(
    'sharp(Buffer.from(backSvg(data)), { density: 300 })',
    'sharp(Buffer.from(backSvg(data)))',
)
tests = tests.replace(
    'assert.match(back, /Dunkwa Police Barrier/);',
    'assert.match(back, /DUNKWA POLICE BARRIER/i);',
)

if "density: 300" in service:
    raise RuntimeError("SVG density double scaling remains in the artwork service.")

ROUTES_PATH.write_text(routes, encoding="utf-8")
SERVICE_PATH.write_text(service, encoding="utf-8")
TEST_PATH.write_text(tests, encoding="utf-8")
