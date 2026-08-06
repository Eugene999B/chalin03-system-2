const PDFDocument = require("pdfkit");

const PATCH_SYMBOL = Symbol.for("chalin03.finance.pdfFooterBlankPageGuard");
const FINANCE_FOOTER_PREFIX = "CHALIN 03 COMPANY LIMITED |";

function isFinanceFooterText(value) {
  return String(value || "").startsWith(FINANCE_FOOTER_PREFIX);
}

function installFinancePdfBlankPageGuard() {
  if (PDFDocument.prototype[PATCH_SYMBOL]) return;

  const originalText = PDFDocument.prototype.text;
  Object.defineProperty(PDFDocument.prototype, PATCH_SYMBOL, {
    value: true,
    configurable: false,
  });

  PDFDocument.prototype.text = function guardedFinancePdfText(...args) {
    const [value, _x, y] = args;
    const page = this.page;
    const shouldProtect =
      isFinanceFooterText(value) &&
      typeof y === "number" &&
      page?.margins &&
      Number(page.margins.bottom || 0) > 0;

    if (!shouldProtect) {
      return originalText.apply(this, args);
    }

    // PDFKit treats the configured bottom margin as the automatic page-break
    // boundary. The Finance footer is intentionally drawn inside that margin;
    // without this narrow guard PDFKit can create a new trailing page while
    // writing the footer, leaving customers with an empty page in the PDF.
    const originalBottomMargin = page.margins.bottom;
    page.margins.bottom = 0;
    try {
      return originalText.apply(this, args);
    } finally {
      page.margins.bottom = originalBottomMargin;
    }
  };
}

installFinancePdfBlankPageGuard();

module.exports = {
  FINANCE_FOOTER_PREFIX,
  installFinancePdfBlankPageGuard,
  isFinanceFooterText,
};
