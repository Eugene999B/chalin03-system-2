const { pool } = require("../config/db");
const {
  getConfigurationMap,
} = require("./groupConfigurationService");

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function wholeNumber(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function isCompatibilityError(error) {
  return [
    "ER_NO_SUCH_TABLE",
    "ER_BAD_FIELD_ERROR",
  ].includes(error?.code);
}

async function safeRows(sql, params = [], fallback = []) {
  try {
    const [rows] = await pool.query(sql, params);
    return rows;
  } catch (error) {
    if (isCompatibilityError(error)) {
      return fallback;
    }

    throw error;
  }
}

function buildReadiness(owner) {
  if (!owner?.id) {
    return {
      code: "not_configured",
      label: "Not configured",
      fully_protected: false,
    };
  }

  if (!Boolean(Number(owner.mfa_enabled))) {
    return {
      code: "configured_without_mfa",
      label: "MFA required",
      fully_protected: false,
    };
  }

  if (numeric(owner.unused_recovery_codes) < 1) {
    return {
      code: "recovery_codes_required",
      label: "Recovery codes required",
      fully_protected: false,
    };
  }

  return {
    code: "fully_protected",
    label: "Fully protected",
    fully_protected: true,
  };
}

function buildAlertCounts(alerts) {
  return alerts.reduce(
    (counts, alert) => {
      counts.total += 1;
      counts[alert.severity] =
        numeric(counts[alert.severity]) + 1;
      return counts;
    },
    {
      total: 0,
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    }
  );
}

async function loadGroupCommandCentreSummary() {
  let configuration = {};

  try {
    configuration = await getConfigurationMap();
  } catch (error) {
    if (!isCompatibilityError(error) && error?.statusCode !== 503) {
      throw error;
    }
  }

  const thresholds = {
    backup_max_age_hours: wholeNumber(
      configuration["threshold.backup_max_age_hours"],
      24
    ),
    document_expiry_days: wholeNumber(
      configuration["threshold.document_expiry_days"],
      30
    ),
    license_expiry_days: wholeNumber(
      configuration["threshold.license_expiry_days"],
      30
    ),
    property_return_grace_days: wholeNumber(
      configuration["threshold.property_return_grace_days"],
      0
    ),
    owner_failed_login_alert_count: wholeNumber(
      configuration["threshold.owner_failed_login_alert_count"],
      1
    ),
    application_error_alert_count: wholeNumber(
      configuration["threshold.application_error_alert_count"],
      1
    ),
  };

  const [
    ownerRows,
    accountRows,
    sessionRows,
    backupRows,
    workforceRows,
    documentRows,
    licenseRows,
    propertyRows,
    privilegedRows,
    ownerLoginRows,
    applicationErrorRows,
    configurationRows,
    notificationRows,
  ] = await Promise.all([
    safeRows(
      `SELECT
         oba.id,
         oba.username,
         oba.mfa_enabled,
         oba.mfa_confirmed_at,
         oba.last_login_at,
         oba.locked_until,
         (
           SELECT COUNT(*)
           FROM owner_break_glass_recovery_codes rc
           WHERE rc.owner_account_id = oba.id
             AND rc.used_at IS NULL
         ) AS unused_recovery_codes
       FROM owner_break_glass_accounts oba
       WHERE oba.is_active = TRUE
       ORDER BY oba.id DESC
       LIMIT 1`
    ),

    safeRows(
      `SELECT
         COUNT(*) AS total_accounts,
         COALESCE(SUM(is_active = TRUE), 0) AS active_accounts,
         COALESCE(
           SUM(
             is_login_locked = TRUE
             OR (
               locked_until IS NOT NULL
               AND locked_until > NOW()
             )
           ),
           0
         ) AS locked_accounts
       FROM users`
    ),

    safeRows(
      `SELECT
         COUNT(*) AS active_sessions,
         COUNT(DISTINCT user_id) AS users_with_active_sessions
       FROM auth_sessions
       WHERE revoked_at IS NULL
         AND expires_at > NOW()`
    ),

    safeRows(
      `SELECT
         COUNT(*) AS total_backups,
         COALESCE(SUM(status = 'failed'), 0) AS failed_backups,
         COALESCE(
           SUM(verification_status <> 'verified'),
           0
         ) AS unverified_backups,
         MAX(created_at) AS latest_backup_at,
         TIMESTAMPDIFF(
           HOUR,
           MAX(created_at),
           NOW()
         ) AS latest_backup_age_hours
       FROM backup_history`
    ),

    safeRows(
      `SELECT
         COUNT(*) AS total_workers,
         COALESCE(
           SUM(employment_status = 'active'),
           0
         ) AS active_workers,
         COALESCE(
           SUM(employment_status <> 'active'),
           0
         ) AS inactive_workers
       FROM worker_profiles`
    ),

    safeRows(
      `SELECT COUNT(*) AS expiring_documents
       FROM worker_documents
       WHERE expiry_date IS NOT NULL
         AND expiry_date <= DATE_ADD(
           CURDATE(),
           INTERVAL ? DAY
         )
         AND LOWER(COALESCE(status, 'valid'))
             NOT IN ('archived', 'cancelled')`,
      [thresholds.document_expiry_days]
    ),

    safeRows(
      `SELECT COUNT(*) AS expiring_licenses
       FROM worker_licenses
       WHERE expiry_date IS NOT NULL
         AND expiry_date <= DATE_ADD(
           CURDATE(),
           INTERVAL ? DAY
         )
         AND LOWER(COALESCE(status, 'valid'))
             NOT IN ('archived', 'cancelled')`,
      [thresholds.license_expiry_days]
    ),

    safeRows(
      `SELECT COUNT(*) AS overdue_property_returns
       FROM worker_property_assignments
       WHERE returned_at IS NULL
         AND expected_return_date IS NOT NULL
         AND expected_return_date < DATE_SUB(
           CURDATE(),
           INTERVAL ? DAY
         )
         AND LOWER(COALESCE(status, 'issued'))
             NOT IN ('returned', 'cancelled', 'written_off')`,
      [thresholds.property_return_grace_days]
    ),

    safeRows(
      `SELECT
         COUNT(*) AS privileged_actions_7d,
         COALESCE(
           SUM(LOWER(severity) = 'critical'),
           0
         ) AS critical_privileged_actions_7d,
         COALESCE(
           SUM(LOWER(outcome) = 'failure'),
           0
         ) AS failed_privileged_actions_7d
       FROM privileged_action_ledger
       WHERE created_at >= DATE_SUB(
         NOW(),
         INTERVAL 7 DAY
       )`
    ),

    safeRows(
      `SELECT
         COUNT(*) AS owner_login_events_24h,
         COALESCE(
           SUM(LOWER(outcome) <> 'success'),
           0
         ) AS failed_owner_logins_24h
       FROM owner_break_glass_login_history
       WHERE created_at >= DATE_SUB(
         NOW(),
         INTERVAL 24 HOUR
       )`
    ),

    safeRows(
      `SELECT COUNT(*) AS application_errors_24h
       FROM application_error_log
       WHERE created_at >= DATE_SUB(
         NOW(),
         INTERVAL 24 HOUR
       )
         AND status_code >= 500`
    ),

    safeRows(
      `SELECT
         (SELECT COUNT(*) FROM group_configuration)
           AS configuration_setting_count,
         (SELECT COUNT(*) FROM document_sequences)
           AS sequence_count,
         (
           SELECT COUNT(*)
           FROM document_sequences
           WHERE is_active = TRUE
         ) AS active_sequence_count`
    ),

    safeRows(
      `SELECT
         COUNT(*) AS active_notifications,
         COALESCE(SUM(severity = 'critical'), 0) AS critical_notifications,
         COALESCE(SUM(severity = 'high'), 0) AS high_notifications,
         COALESCE(SUM(workspace_code = 'spare_parts'), 0) AS spare_parts_notifications,
         COALESCE(SUM(workspace_code = 'mining'), 0) AS mining_notifications,
         COALESCE(SUM(workspace_code = 'equipment_hire'), 0) AS hire_notifications
       FROM notifications
       WHERE status = 'active'`
    ),
  ]);

  const owner = ownerRows[0] || {};
  const readiness = buildReadiness(owner);
  const accounts = accountRows[0] || {};
  const sessions = sessionRows[0] || {};
  const backups = backupRows[0] || {};
  const workforce = workforceRows[0] || {};
  const documents = documentRows[0] || {};
  const licenses = licenseRows[0] || {};
  const property = propertyRows[0] || {};
  const privileged = privilegedRows[0] || {};
  const ownerLogins = ownerLoginRows[0] || {};
  const applicationErrors = applicationErrorRows[0] || {};
  const configurationState = configurationRows[0] || {};
  const notificationState = notificationRows[0] || {};

  const summary = {
    generated_at: new Date().toISOString(),

    owner_security: {
      readiness_code: readiness.code,
      readiness_label: readiness.label,
      fully_protected: readiness.fully_protected,
      owner_username: owner.username || null,
      mfa_enabled: Boolean(Number(owner.mfa_enabled)),
      unused_recovery_codes: numeric(owner.unused_recovery_codes),
      last_login_at: owner.last_login_at || null,
      locked_until: owner.locked_until || null,
    },

    accounts: {
      total_accounts: numeric(accounts.total_accounts),
      active_accounts: numeric(accounts.active_accounts),
      locked_accounts: numeric(accounts.locked_accounts),
      active_sessions: numeric(sessions.active_sessions),
      users_with_active_sessions: numeric(
        sessions.users_with_active_sessions
      ),
    },

    backups: {
      total_backups: numeric(backups.total_backups),
      failed_backups: numeric(backups.failed_backups),
      unverified_backups: numeric(backups.unverified_backups),
      latest_backup_at: backups.latest_backup_at || null,
      latest_backup_age_hours:
        backups.latest_backup_age_hours === null ||
        backups.latest_backup_age_hours === undefined
          ? null
          : numeric(backups.latest_backup_age_hours),
      maximum_age_hours: thresholds.backup_max_age_hours,
    },

    workforce: {
      total_workers: numeric(workforce.total_workers),
      active_workers: numeric(workforce.active_workers),
      inactive_workers: numeric(workforce.inactive_workers),
      expiring_documents: numeric(documents.expiring_documents),
      expiring_licenses: numeric(licenses.expiring_licenses),
      overdue_property_returns: numeric(
        property.overdue_property_returns
      ),
    },

    security: {
      privileged_actions_7d: numeric(
        privileged.privileged_actions_7d
      ),
      critical_privileged_actions_7d: numeric(
        privileged.critical_privileged_actions_7d
      ),
      failed_privileged_actions_7d: numeric(
        privileged.failed_privileged_actions_7d
      ),
      owner_login_events_24h: numeric(
        ownerLogins.owner_login_events_24h
      ),
      failed_owner_logins_24h: numeric(
        ownerLogins.failed_owner_logins_24h
      ),
    },

    system: {
      application_errors_24h: numeric(
        applicationErrors.application_errors_24h
      ),
      configuration_setting_count: numeric(
        configurationState.configuration_setting_count
      ),
      sequence_count: numeric(configurationState.sequence_count),
      active_sequence_count: numeric(
        configurationState.active_sequence_count
      ),
    },

    notification_centre: {
      active_notifications: numeric(notificationState.active_notifications),
      critical_notifications: numeric(notificationState.critical_notifications),
      high_notifications: numeric(notificationState.high_notifications),
      spare_parts_notifications: numeric(notificationState.spare_parts_notifications),
      mining_notifications: numeric(notificationState.mining_notifications),
      hire_notifications: numeric(notificationState.hire_notifications),
    },

    thresholds,
    alerts: [],
    alert_counts: {},
    recommendations: [],
  };

  const addAlert = (
    severity,
    category,
    title,
    detail,
    path
  ) => {
    summary.alerts.push({
      severity,
      category,
      title,
      detail,
      path,
    });
  };

  if (!summary.owner_security.fully_protected) {
    addAlert(
      "critical",
      "Owner Security",
      "Complete Owner Break-Glass protection",
      `Owner readiness is ${summary.owner_security.readiness_label}.`,
      "/security-centre"
    );
  }

  if (summary.accounts.locked_accounts > 0) {
    addAlert(
      "high",
      "Account Security",
      "Review locked staff accounts",
      `${summary.accounts.locked_accounts} staff account(s) are locked.`,
      "/security-centre"
    );
  }

  if (
    summary.security.failed_owner_logins_24h >=
    thresholds.owner_failed_login_alert_count &&
    summary.security.failed_owner_logins_24h > 0
  ) {
    addAlert(
      "critical",
      "Owner Security",
      "Investigate failed Owner login attempts",
      `${summary.security.failed_owner_logins_24h} unsuccessful Owner login event(s) were recorded within 24 hours.`,
      "/security-centre"
    );
  }

  if (summary.backups.latest_backup_at === null) {
    addAlert(
      "critical",
      "Backups",
      "Create a professional backup",
      "No professional backup record is available.",
      "/professional-backups"
    );
  } else if (
    summary.backups.latest_backup_age_hours >
    thresholds.backup_max_age_hours
  ) {
    addAlert(
      "high",
      "Backups",
      "Professional backup is overdue",
      `The latest professional backup is ${summary.backups.latest_backup_age_hours} hour(s) old. The configured maximum is ${thresholds.backup_max_age_hours} hours.`,
      "/professional-backups"
    );
  }

  if (summary.backups.failed_backups > 0) {
    addAlert(
      "critical",
      "Backups",
      "Review failed backup attempts",
      `${summary.backups.failed_backups} failed backup record(s) exist.`,
      "/professional-backups"
    );
  }

  if (summary.backups.unverified_backups > 0) {
    addAlert(
      "high",
      "Backups",
      "Verify professional backups",
      `${summary.backups.unverified_backups} backup(s) have not been verified.`,
      "/professional-backups"
    );
  }

  if (summary.workforce.expiring_documents > 0) {
    addAlert(
      "medium",
      "Workforce",
      "Renew worker documents",
      `${summary.workforce.expiring_documents} worker document(s) are expired or within the configured warning period.`,
      "/workers"
    );
  }

  if (summary.workforce.expiring_licenses > 0) {
    addAlert(
      "high",
      "Workforce",
      "Renew worker licences",
      `${summary.workforce.expiring_licenses} worker licence(s) are expired or approaching expiry.`,
      "/workers"
    );
  }

  if (summary.workforce.overdue_property_returns > 0) {
    addAlert(
      "medium",
      "Workforce",
      "Recover overdue company property",
      `${summary.workforce.overdue_property_returns} company-property assignment(s) are overdue for return.`,
      "/workers"
    );
  }

  if (
    summary.system.application_errors_24h >=
      thresholds.application_error_alert_count &&
    summary.system.application_errors_24h > 0
  ) {
    addAlert(
      "high",
      "System Health",
      "Review recent server errors",
      `${summary.system.application_errors_24h} server error(s) were recorded within 24 hours.`,
      "/system-operations"
    );
  }

  if (summary.notification_centre.critical_notifications > 0) {
    addAlert(
      "critical",
      "Notification Centre",
      "Review critical group operations alerts",
      `${summary.notification_centre.critical_notifications} critical notification(s) are active across the group.`,
      "/group-executive-control/notifications"
    );
  } else if (summary.notification_centre.high_notifications > 0) {
    addAlert(
      "high",
      "Notification Centre",
      "Review high-priority operations alerts",
      `${summary.notification_centre.high_notifications} high-priority notification(s) are active across the group.`,
      "/group-executive-control/notifications"
    );
  }

  const rank = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };

  summary.alerts.sort(
    (left, right) =>
      (rank[left.severity] ?? 9) -
      (rank[right.severity] ?? 9)
  );

  summary.alert_counts = buildAlertCounts(summary.alerts);

  summary.recommendations = summary.alerts.map((alert) => ({
    priority: alert.severity,
    area: alert.category,
    title: alert.title,
    detail: alert.detail,
    path: alert.path,
  }));

  return summary;
}

module.exports = {
  loadGroupCommandCentreSummary,
};
