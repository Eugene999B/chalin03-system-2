// Installment deep-delete route compatibility shim.
// The production route is intentionally kept at this filename so the existing
// bootstrap and frontend URLs do not change, while the authoritative v12
// purge implementation supplies the handlers.
module.exports = require("./installmentDeepDeleteRoutesV12");
