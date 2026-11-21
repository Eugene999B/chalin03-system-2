const equipmentSalesRoutes = require("../routes/equipmentSalesRoutes");
const equipmentCreditOptionalDecisionRoutes = require("../routes/equipmentCreditOptionalDecisionRoutes");

const INSTALL_FLAG = Symbol.for(
  "chalin03.equipmentCreditOptionalApprovalRoutesInstalled"
);

function installEquipmentCreditOptionalApprovalRoutes() {
  if (equipmentSalesRoutes[INSTALL_FLAG]) return false;

  equipmentSalesRoutes.use(
    "/credit-applications",
    equipmentCreditOptionalDecisionRoutes
  );

  Object.defineProperty(equipmentSalesRoutes, INSTALL_FLAG, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });

  return true;
}

installEquipmentCreditOptionalApprovalRoutes();

module.exports = {
  INSTALL_FLAG,
  installEquipmentCreditOptionalApprovalRoutes,
};
