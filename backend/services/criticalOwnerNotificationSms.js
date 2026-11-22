const { pool } = require("../config/db");
const { sendOwnerSmsAlert } = require("./smsAlertService");
const { getSmsConfig } = require("./smsService");

// Claim before submitting to the provider. Unknown outcomes require human review.
async function claimCriticalAlerts() {
  const connection = await pool.getConnection();
  let locked = false;
  try {
    const [[lock]] = await connection.query("SELECT GET_LOCK('chalin03_critical_owner_sms',0) AS acquired");
    locked = Number(lock.acquired) === 1;
    if (!locked) return [];
    const [rows] = await connection.query(
      `SELECT n.id,n.workspace_code,n.branch_id,n.title
       FROM notifications n JOIN notification_rules r ON r.id=n.rule_id
       WHERE n.workspace_code IN ('spare_parts','equipment_installment_finance')
         AND n.status='active' AND n.severity='critical' AND n.auto_generated=1
         AND n.first_detected_at >= NOW() - INTERVAL 24 HOUR
         AND r.is_enabled=1 AND r.sms_allowed=1
         AND NOT EXISTS (
           SELECT 1 FROM notification_escalations e
           WHERE e.notification_id=n.id AND e.escalation_channel IN ('sms','auto_owner_sms')
         )
       ORDER BY n.first_detected_at,n.id LIMIT 3`
    );
    const claims = [];
    for (const row of rows) {
      const [result] = await connection.query(
        "INSERT INTO notification_escalations (notification_id,escalation_channel,status) VALUES (?,'auto_owner_sms','pending')",
        [row.id]
      );
      claims.push({ ...row, escalationId: result.insertId });
    }
    return claims;
  } finally {
    try {
      if (locked) await connection.query("SELECT RELEASE_LOCK('chalin03_critical_owner_sms')");
    } finally {
      connection.release();
    }
  }
}

async function deliverCriticalOwnerAlerts({ env = process.env } = {}) {
  const config = getSmsConfig();
  if (String(env.NOTIFICATION_SMS_ENABLED || "").toLowerCase() !== "true" || !config.enabled || config.provider === "mock") {
    return { skipped: true };
  }
  const claims = await claimCriticalAlerts();
  for (const claim of claims) {
    const workspace = claim.workspace_code === "spare_parts" ? "Spare Parts" : "Installment Finance";
    const result = await sendOwnerSmsAlert({
      branchId: claim.branch_id || 1,
      ownerOnly: true,
      message: `CHALIN03 ${workspace}: critical alert #${claim.id}. ${String(claim.title || "").slice(0,100)}. Review the staff Notification Centre.`,
      sourceReference: `notification:${claim.id}`,
    });
    await pool.query(
      "UPDATE notification_escalations SET status=?,provider_reference=?,response_message=? WHERE id=?",
      [result.status || "delivery_unknown",result.provider_message_id || null,
       String(result.reason || result.message || "").slice(0,500) || null,claim.escalationId]
    );
  }
  return { attempted: claims.length };
}

module.exports = { deliverCriticalOwnerAlerts };
