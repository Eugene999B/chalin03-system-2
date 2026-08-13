/*
  CHALIN ONE inventory trial route hardening.

  The main server remains untouched because it is shared with a large staging/public-content
  integration lane. This preload redirects only the two legacy route-module exports to the
  audited serialized-inventory wrappers. The wrappers capture the original routers first and
  delegate every non-serialized request back to them unchanged.
*/

const productRoutePath = require.resolve("../routes/productRoutes");
const saleRoutePath = require.resolve("../routes/saleRoutes");

const hardenedProductRoutes = require("../routes/productRoutesInventoryHardened");
const hardenedSaleRoutes = require("../routes/saleRoutesInventoryHardened");

if (!require.cache[productRoutePath] || !require.cache[saleRoutePath]) {
  throw new Error(
    "Inventory route hardening bootstrap could not resolve the established product/sale routers."
  );
}

require.cache[productRoutePath].exports = hardenedProductRoutes;
require.cache[saleRoutePath].exports = hardenedSaleRoutes;

module.exports = {
  productRoutePath,
  saleRoutePath,
};
