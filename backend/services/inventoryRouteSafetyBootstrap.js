/*
  CHALIN ONE inventory trial route hardening.

  The shared server keeps importing the established product and sale routers. During
  Inventory Traceability startup this installer prepends only the audited serialized
  mutation guards to those same router objects. Existing non-serialized route layers
  remain unchanged and keep their original order.
*/

const INSTALL_FLAG = Symbol.for("chalin03.inventoryRouteSafetyInstalled");

function guardLayers(wrapper) {
  // Each hardened wrapper ends with router.use(legacyRouter). We need only the
  // guard layers; the original router already owns its established route stack.
  return wrapper.stack.slice(0, -1);
}

function installInventoryRouteSafety() {
  if (globalThis[INSTALL_FLAG]) return false;

  const productRoutes = require("../routes/productRoutes");
  const saleRoutes = require("../routes/saleRoutes");
  const originalProductStack = productRoutes.stack.slice();
  const originalSaleStack = saleRoutes.stack.slice();

  const hardenedProductRoutes = require("../routes/productRoutesInventoryHardened");
  const hardenedSaleRoutes = require("../routes/saleRoutesInventoryHardened");

  productRoutes.stack = [
    ...guardLayers(hardenedProductRoutes),
    ...originalProductStack,
  ];
  saleRoutes.stack = [
    ...guardLayers(hardenedSaleRoutes),
    ...originalSaleStack,
  ];

  Object.defineProperty(globalThis, INSTALL_FLAG, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
  return true;
}

module.exports = {
  INSTALL_FLAG,
  installInventoryRouteSafety,
};
