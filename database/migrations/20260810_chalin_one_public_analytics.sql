-- CHALIN 03 PRODUCTION MIGRATION
-- ADDITIVE MIGRATION ONLY.
-- BACKUP REQUIRED: Professional Backup and separate SQL backup must be verified before production execution.
-- Adds aggregate public page-view counters only. No visitor identity, IP address, user agent, cookie or form data is stored here.

CREATE TABLE IF NOT EXISTS public_analytics_daily (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    metric_date DATE NOT NULL,
    route_path VARCHAR(220) NOT NULL,
    page_views BIGINT UNSIGNED NOT NULL DEFAULT 0,
    first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_public_analytics_daily_route (metric_date, route_path),
    KEY idx_public_analytics_daily_date_views (metric_date, page_views),
    CONSTRAINT chk_public_analytics_route_path CHECK (route_path LIKE '/%')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO schema_migrations (migration_name, description)
VALUES (
    '20260810_chalin_one_public_analytics',
    'Add privacy-first aggregate CHALIN ONE public page-view counters without visitor identifiers or staff data'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);
