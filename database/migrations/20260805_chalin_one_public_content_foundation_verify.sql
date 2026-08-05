-- Read-only verification for 20260805_chalin_one_public_content_foundation.sql.

SELECT migration_name, applied_at, description
FROM schema_migrations
WHERE migration_name = '20260805_chalin_one_public_content_foundation';

SELECT expected.table_name AS missing_table
FROM (
    SELECT 'public_media_folders' AS table_name
    UNION ALL SELECT 'public_media_assets'
    UNION ALL SELECT 'public_site_settings'
    UNION ALL SELECT 'public_pages'
    UNION ALL SELECT 'public_page_versions'
    UNION ALL SELECT 'public_page_sections'
    UNION ALL SELECT 'public_navigation_items'
    UNION ALL SELECT 'public_news_categories'
    UNION ALL SELECT 'public_news_articles'
    UNION ALL SELECT 'public_announcements'
    UNION ALL SELECT 'public_business_divisions'
    UNION ALL SELECT 'public_leadership_profiles'
    UNION ALL SELECT 'public_projects'
    UNION ALL SELECT 'public_project_media'
    UNION ALL SELECT 'public_equipment_catalogue'
    UNION ALL SELECT 'public_testimonials'
    UNION ALL SELECT 'public_locations'
    UNION ALL SELECT 'public_company_statistics'
    UNION ALL SELECT 'public_job_vacancies'
    UNION ALL SELECT 'public_tenders'
    UNION ALL SELECT 'public_faqs'
    UNION ALL SELECT 'public_forms'
    UNION ALL SELECT 'public_form_fields'
    UNION ALL SELECT 'public_form_submissions'
    UNION ALL SELECT 'public_form_submission_files'
    UNION ALL SELECT 'public_content_versions'
    UNION ALL SELECT 'public_content_approvals'
    UNION ALL SELECT 'public_content_audit_log'
) AS expected
LEFT JOIN information_schema.tables AS actual
    ON actual.table_schema = DATABASE()
   AND actual.table_name = expected.table_name
WHERE actual.table_name IS NULL
ORDER BY expected.table_name;

SELECT table_name, engine, table_collation
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name LIKE 'public\_%'
ORDER BY table_name;

SELECT table_name, column_name, column_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND (
      (table_name = 'public_pages' AND column_name IN (
          'page_key', 'slug', 'publication_status', 'publish_at', 'expires_at',
          'created_by', 'approved_by', 'published_by'
      ))
      OR (table_name = 'public_page_versions' AND column_name IN (
          'page_id', 'version_number', 'version_status', 'body_json',
          'seo_title', 'meta_description', 'primary_media_asset_id'
      ))
      OR (table_name = 'public_page_sections' AND column_name IN (
          'page_version_id', 'section_key', 'section_type', 'content_json',
          'settings_json', 'sort_order', 'is_enabled'
      ))
      OR (table_name = 'public_media_assets' AND column_name IN (
          'asset_key', 'storage_key', 'visibility', 'processing_status',
          'checksum_sha256', 'alt_text'
      ))
      OR (table_name = 'public_form_submissions' AND column_name IN (
          'reference_code', 'submission_status', 'response_json',
          'consent_given', 'consent_at', 'ip_hash'
      ))
      OR (table_name = 'public_form_submission_files' AND column_name IN (
          'storage_key', 'security_status', 'checksum_sha256'
      ))
      OR (table_name = 'public_content_versions' AND column_name IN (
          'entity_type', 'entity_id', 'version_number', 'version_status',
          'snapshot_json'
      ))
      OR (table_name = 'public_content_approvals' AND column_name IN (
          'entity_type', 'entity_id', 'request_type', 'approval_status',
          'execution_token', 'executed_at'
      ))
      OR (table_name = 'public_content_audit_log' AND column_name IN (
          'entity_type', 'entity_id', 'action_key', 'before_json',
          'after_json', 'metadata_json'
      ))
  )
ORDER BY table_name, ordinal_position;

SELECT table_name, index_name, non_unique,
       GROUP_CONCAT(column_name ORDER BY seq_in_index SEPARATOR ',') AS indexed_columns
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name LIKE 'public\_%'
GROUP BY table_name, index_name, non_unique
ORDER BY table_name, index_name;

SELECT table_name, constraint_name, referenced_table_name, delete_rule, update_rule
FROM information_schema.referential_constraints
WHERE constraint_schema = DATABASE()
  AND table_name LIKE 'public\_%'
ORDER BY table_name, constraint_name;

SELECT 'public_media_folders' AS table_name, COUNT(*) AS record_count FROM public_media_folders
UNION ALL SELECT 'public_media_assets', COUNT(*) FROM public_media_assets
UNION ALL SELECT 'public_site_settings', COUNT(*) FROM public_site_settings
UNION ALL SELECT 'public_pages', COUNT(*) FROM public_pages
UNION ALL SELECT 'public_page_versions', COUNT(*) FROM public_page_versions
UNION ALL SELECT 'public_page_sections', COUNT(*) FROM public_page_sections
UNION ALL SELECT 'public_navigation_items', COUNT(*) FROM public_navigation_items
UNION ALL SELECT 'public_news_categories', COUNT(*) FROM public_news_categories
UNION ALL SELECT 'public_news_articles', COUNT(*) FROM public_news_articles
UNION ALL SELECT 'public_announcements', COUNT(*) FROM public_announcements
UNION ALL SELECT 'public_business_divisions', COUNT(*) FROM public_business_divisions
UNION ALL SELECT 'public_leadership_profiles', COUNT(*) FROM public_leadership_profiles
UNION ALL SELECT 'public_projects', COUNT(*) FROM public_projects
UNION ALL SELECT 'public_project_media', COUNT(*) FROM public_project_media
UNION ALL SELECT 'public_equipment_catalogue', COUNT(*) FROM public_equipment_catalogue
UNION ALL SELECT 'public_testimonials', COUNT(*) FROM public_testimonials
UNION ALL SELECT 'public_locations', COUNT(*) FROM public_locations
UNION ALL SELECT 'public_company_statistics', COUNT(*) FROM public_company_statistics
UNION ALL SELECT 'public_job_vacancies', COUNT(*) FROM public_job_vacancies
UNION ALL SELECT 'public_tenders', COUNT(*) FROM public_tenders
UNION ALL SELECT 'public_faqs', COUNT(*) FROM public_faqs
UNION ALL SELECT 'public_forms', COUNT(*) FROM public_forms
UNION ALL SELECT 'public_form_fields', COUNT(*) FROM public_form_fields
UNION ALL SELECT 'public_form_submissions', COUNT(*) FROM public_form_submissions
UNION ALL SELECT 'public_form_submission_files', COUNT(*) FROM public_form_submission_files
UNION ALL SELECT 'public_content_versions', COUNT(*) FROM public_content_versions
UNION ALL SELECT 'public_content_approvals', COUNT(*) FROM public_content_approvals
UNION ALL SELECT 'public_content_audit_log', COUNT(*) FROM public_content_audit_log
ORDER BY table_name;
