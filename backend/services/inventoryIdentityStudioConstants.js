const STUDIO_PRINT_FORMATS = Object.freeze(["a4", "thermal", "sticker", "compact"]);
const STUDIO_LABEL_STYLES = Object.freeze(["compact", "standard", "detailed"]);
const STUDIO_MAX_SELECTION = 500;

function automaticProductCode(product) {
  if (product?.inventory_product_code) {
    return String(product.inventory_product_code).trim().toUpperCase();
  }

  const idSuffix = Math.max(Number(product?.id || 0), 1)
    .toString(36)
    .toUpperCase()
    .slice(-5);
  const source = `${product?.name || ""}${product?.size || ""}`
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "") || "PRD";
  const prefixLength = Math.max(3, 12 - idSuffix.length);
  let prefix = source.slice(0, prefixLength);
  if (prefix.length < 3) prefix = `${prefix}PRD`.slice(0, 3);
  return `${prefix}${idSuffix}`.slice(0, 12);
}

module.exports = {
  STUDIO_PRINT_FORMATS,
  STUDIO_LABEL_STYLES,
  STUDIO_MAX_SELECTION,
  automaticProductCode,
};
