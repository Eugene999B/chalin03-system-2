from pathlib import Path

ROUTES_PATH = Path("backend/routes/workerPrintRoutes.js")
routes = ROUTES_PATH.read_text(encoding="utf-8")

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

ROUTES_PATH.write_text(routes, encoding="utf-8")
