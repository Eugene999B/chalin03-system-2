const {
  assertAuditSchemaReady,
  sendAuditSchemaReadinessError,
} = require("../services/auditSchemaReadinessService");
const { loadAuditRoute } = require("./auditRouteReadinessLoader");

void assertAuditSchemaReady;
void sendAuditSchemaReadinessError;

module.exports = loadAuditRoute("signoff");
