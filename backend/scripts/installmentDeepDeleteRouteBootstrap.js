const Module = require("module");

const originalLoad = Module._load;
let installed = false;

Module._load = function installmentDeepDeleteBootstrap(request, parent, isMain) {
  const exported = originalLoad.apply(this, arguments);
  if (
    !installed &&
    request === "./routes/equipmentCatalogueRoutes" &&
    parent &&
    /[\\/]server\.js$/.test(parent.filename || "")
  ) {
    try {
      const deepRoutes = originalLoad("./routes/installmentDeepDeleteRoutesV10", parent, isMain);
      if (!exported || typeof exported.use !== "function") {
        throw new Error(
          "Installment deep-delete route bootstrap could not attach to the equipment catalogue router."
        );
      }
      exported.use(deepRoutes);
      installed = true;
      console.log("Installment deep-delete v10 routes mounted.");
    } catch (error) {
      if (error?.code !== "MODULE_NOT_FOUND") throw error;
      console.warn(
        "Installment deep-delete v10 routes are unavailable in this production build; continuing without optional deep-delete routes."
      );
    }
  }
  return exported;
};
