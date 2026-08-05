-- CHALIN 03 PRODUCTION MIGRATION
-- ADDITIVE MIGRATION ONLY.
-- BACKUP REQUIRED: Professional Backup and separate SQL backup must be verified before production execution.
-- Do not run database/schema.sql against production.
-- This migration creates only the CHALIN ONE public-content foundation and preserves all existing business records.

CREATE TABLE IF NOT EXISTS schema_migrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    migration_name VARCHAR(150) NOT NULL UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    description TEXT NULL,
    INDEX idx_schema_migration_name (migration_name),
    INDEX idx_schema_migration_applied_at (applied_at)
);

CREATE TABLE IF NOT EXISTS public_media_folders (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    parent_id BIGINT UNSIGNED NULL,
    folder_key VARCHAR(120) NOT NULL,
    name VARCHAR(150) NOT NULL,
    description VARCHAR(500) NULL,
    sort_order INT NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_by INT NULL,
    updated_by INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_pub_media_folder_key (folder_key),
    KEY idx_pub_media_folder_parent (parent_id),
    KEY idx_pub_media_folder_active (is_active, sort_order),
    KEY idx_pub_media_folder_created_by (created_by),
    CONSTRAINT fk_pub_media_folder_parent
        FOREIGN KEY (parent_id) REFERENCES public_media_folders(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_media_folder_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_media_folder_updated_by
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS public_media_assets (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    folder_id BIGINT UNSIGNED NULL,
    asset_key VARCHAR(120) NOT NULL,
    storage_provider VARCHAR(50) NOT NULL DEFAULT 'cloudflare_r2',
    storage_key VARCHAR(500) NOT NULL,
    public_url TEXT NULL,
    original_filename VARCHAR(255) NOT NULL,
    display_name VARCHAR(180) NULL,
    media_type ENUM('image', 'video', 'document', 'audio', 'other') NOT NULL,
    mime_type VARCHAR(150) NOT NULL,
    file_extension VARCHAR(20) NULL,
    file_size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
    width_pixels INT UNSIGNED NULL,
    height_pixels INT UNSIGNED NULL,
    duration_seconds DECIMAL(12,3) NULL,
    alt_text VARCHAR(500) NULL,
    caption TEXT NULL,
    credit_text VARCHAR(255) NULL,
    checksum_sha256 CHAR(64) NULL,
    visibility ENUM('public', 'private', 'restricted') NOT NULL DEFAULT 'private',
    processing_status ENUM('pending', 'ready', 'failed', 'quarantined', 'archived') NOT NULL DEFAULT 'pending',
    metadata_json JSON NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    uploaded_by INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_pub_media_asset_key (asset_key),
    UNIQUE KEY uq_pub_media_storage_key (storage_key),
    KEY idx_pub_media_folder (folder_id),
    KEY idx_pub_media_type_status (media_type, processing_status),
    KEY idx_pub_media_visibility_active (visibility, is_active),
    KEY idx_pub_media_checksum (checksum_sha256),
    KEY idx_pub_media_uploaded_by (uploaded_by),
    CONSTRAINT fk_pub_media_asset_folder
        FOREIGN KEY (folder_id) REFERENCES public_media_folders(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_media_asset_uploaded_by
        FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS public_site_settings (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    setting_key VARCHAR(150) NOT NULL,
    setting_group VARCHAR(80) NOT NULL DEFAULT 'general',
    value_json JSON NULL,
    description VARCHAR(500) NULL,
    is_public TINYINT(1) NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_by INT NULL,
    updated_by INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_pub_site_setting_key (setting_key),
    KEY idx_pub_site_setting_group (setting_group, is_active),
    KEY idx_pub_site_setting_public (is_public, is_active),
    CONSTRAINT fk_pub_site_setting_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_site_setting_updated_by
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS public_pages (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    page_key VARCHAR(120) NOT NULL,
    slug VARCHAR(180) NOT NULL,
    page_type VARCHAR(80) NOT NULL DEFAULT 'standard',
    template_key VARCHAR(100) NOT NULL DEFAULT 'standard',
    menu_title VARCHAR(180) NULL,
    publication_status ENUM('draft', 'in_review', 'approved', 'scheduled', 'published', 'expired', 'archived') NOT NULL DEFAULT 'draft',
    publish_at DATETIME NULL,
    expires_at DATETIME NULL,
    published_at DATETIME NULL,
    is_homepage TINYINT(1) NOT NULL DEFAULT 0,
    show_in_search TINYINT(1) NOT NULL DEFAULT 1,
    show_in_sitemap TINYINT(1) NOT NULL DEFAULT 1,
    created_by INT NULL,
    updated_by INT NULL,
    submitted_by INT NULL,
    approved_by INT NULL,
    published_by INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_pub_page_key (page_key),
    UNIQUE KEY uq_pub_page_slug (slug),
    KEY idx_pub_page_status_schedule (publication_status, publish_at, expires_at),
    KEY idx_pub_page_homepage (is_homepage, publication_status),
    KEY idx_pub_page_updated_by (updated_by),
    CONSTRAINT fk_pub_page_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_page_updated_by
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_page_submitted_by
        FOREIGN KEY (submitted_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_page_approved_by
        FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_page_published_by
        FOREIGN KEY (published_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS public_page_versions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    page_id BIGINT UNSIGNED NOT NULL,
    version_number INT UNSIGNED NOT NULL,
    version_status ENUM('draft', 'in_review', 'approved', 'scheduled', 'published', 'superseded', 'archived') NOT NULL DEFAULT 'draft',
    title VARCHAR(220) NOT NULL,
    subtitle VARCHAR(255) NULL,
    summary TEXT NULL,
    body_json JSON NULL,
    seo_title VARCHAR(255) NULL,
    meta_description VARCHAR(500) NULL,
    canonical_url VARCHAR(500) NULL,
    robots_directive VARCHAR(120) NOT NULL DEFAULT 'index,follow',
    primary_media_asset_id BIGINT UNSIGNED NULL,
    settings_json JSON NULL,
    change_summary VARCHAR(500) NULL,
    publish_at DATETIME NULL,
    expires_at DATETIME NULL,
    published_at DATETIME NULL,
    created_by INT NULL,
    approved_by INT NULL,
    published_by INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_pub_page_version (page_id, version_number),
    KEY idx_pub_page_version_status (page_id, version_status, published_at),
    KEY idx_pub_page_version_schedule (version_status, publish_at, expires_at),
    KEY idx_pub_page_version_media (primary_media_asset_id),
    CONSTRAINT fk_pub_page_version_page
        FOREIGN KEY (page_id) REFERENCES public_pages(id) ON DELETE CASCADE,
    CONSTRAINT fk_pub_page_version_media
        FOREIGN KEY (primary_media_asset_id) REFERENCES public_media_assets(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_page_version_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_page_version_approved_by
        FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_page_version_published_by
        FOREIGN KEY (published_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS public_page_sections (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    page_version_id BIGINT UNSIGNED NOT NULL,
    section_key VARCHAR(120) NOT NULL,
    section_type VARCHAR(100) NOT NULL,
    heading VARCHAR(255) NULL,
    subheading VARCHAR(500) NULL,
    content_json JSON NULL,
    settings_json JSON NULL,
    primary_media_asset_id BIGINT UNSIGNED NULL,
    background_media_asset_id BIGINT UNSIGNED NULL,
    sort_order INT NOT NULL DEFAULT 0,
    is_enabled TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_pub_page_section_key (page_version_id, section_key),
    KEY idx_pub_page_section_order (page_version_id, is_enabled, sort_order),
    KEY idx_pub_page_section_primary_media (primary_media_asset_id),
    KEY idx_pub_page_section_bg_media (background_media_asset_id),
    CONSTRAINT fk_pub_page_section_version
        FOREIGN KEY (page_version_id) REFERENCES public_page_versions(id) ON DELETE CASCADE,
    CONSTRAINT fk_pub_page_section_primary_media
        FOREIGN KEY (primary_media_asset_id) REFERENCES public_media_assets(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_page_section_bg_media
        FOREIGN KEY (background_media_asset_id) REFERENCES public_media_assets(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS public_navigation_items (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    navigation_key VARCHAR(120) NOT NULL,
    parent_id BIGINT UNSIGNED NULL,
    page_id BIGINT UNSIGNED NULL,
    navigation_location ENUM('header', 'footer', 'mobile', 'utility') NOT NULL DEFAULT 'header',
    label VARCHAR(180) NOT NULL,
    url VARCHAR(500) NULL,
    icon_key VARCHAR(100) NULL,
    sort_order INT NOT NULL DEFAULT 0,
    opens_new_tab TINYINT(1) NOT NULL DEFAULT 0,
    is_visible TINYINT(1) NOT NULL DEFAULT 1,
    publication_status ENUM('draft', 'in_review', 'approved', 'scheduled', 'published', 'expired', 'archived') NOT NULL DEFAULT 'draft',
    publish_at DATETIME NULL,
    expires_at DATETIME NULL,
    created_by INT NULL,
    updated_by INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_pub_navigation_key (navigation_key),
    KEY idx_pub_navigation_parent (parent_id),
    KEY idx_pub_navigation_page (page_id),
    KEY idx_pub_navigation_display (navigation_location, publication_status, is_visible, sort_order),
    CONSTRAINT fk_pub_navigation_parent
        FOREIGN KEY (parent_id) REFERENCES public_navigation_items(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_navigation_page
        FOREIGN KEY (page_id) REFERENCES public_pages(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_navigation_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_navigation_updated_by
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS public_news_categories (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    category_key VARCHAR(120) NOT NULL,
    slug VARCHAR(160) NOT NULL,
    name VARCHAR(180) NOT NULL,
    description VARCHAR(500) NULL,
    sort_order INT NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_by INT NULL,
    updated_by INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_pub_news_category_key (category_key),
    UNIQUE KEY uq_pub_news_category_slug (slug),
    KEY idx_pub_news_category_active (is_active, sort_order),
    CONSTRAINT fk_pub_news_category_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_news_category_updated_by
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS public_business_divisions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    division_key VARCHAR(120) NOT NULL,
    slug VARCHAR(180) NOT NULL,
    name VARCHAR(200) NOT NULL,
    short_description VARCHAR(700) NULL,
    body_json JSON NULL,
    featured_media_asset_id BIGINT UNSIGNED NULL,
    contact_phone VARCHAR(50) NULL,
    contact_email VARCHAR(180) NULL,
    sort_order INT NOT NULL DEFAULT 0,
    publication_status ENUM('draft', 'in_review', 'approved', 'scheduled', 'published', 'expired', 'archived') NOT NULL DEFAULT 'draft',
    publish_at DATETIME NULL,
    expires_at DATETIME NULL,
    published_at DATETIME NULL,
    created_by INT NULL,
    updated_by INT NULL,
    approved_by INT NULL,
    published_by INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_pub_division_key (division_key),
    UNIQUE KEY uq_pub_division_slug (slug),
    KEY idx_pub_division_display (publication_status, sort_order),
    KEY idx_pub_division_schedule (publication_status, publish_at, expires_at),
    KEY idx_pub_division_media (featured_media_asset_id),
    CONSTRAINT fk_pub_division_media
        FOREIGN KEY (featured_media_asset_id) REFERENCES public_media_assets(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_division_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_division_updated_by
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_division_approved_by
        FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_division_published_by
        FOREIGN KEY (published_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS public_news_articles (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    article_key VARCHAR(120) NOT NULL,
    slug VARCHAR(200) NOT NULL,
    category_id BIGINT UNSIGNED NULL,
    title VARCHAR(255) NOT NULL,
    excerpt TEXT NULL,
    body_json JSON NULL,
    author_display_name VARCHAR(180) NULL,
    featured_media_asset_id BIGINT UNSIGNED NULL,
    is_featured TINYINT(1) NOT NULL DEFAULT 0,
    publication_status ENUM('draft', 'in_review', 'approved', 'scheduled', 'published', 'expired', 'archived') NOT NULL DEFAULT 'draft',
    publish_at DATETIME NULL,
    expires_at DATETIME NULL,
    published_at DATETIME NULL,
    seo_title VARCHAR(255) NULL,
    meta_description VARCHAR(500) NULL,
    created_by INT NULL,
    updated_by INT NULL,
    approved_by INT NULL,
    published_by INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_pub_news_article_key (article_key),
    UNIQUE KEY uq_pub_news_article_slug (slug),
    KEY idx_pub_news_category (category_id),
    KEY idx_pub_news_publish (publication_status, publish_at, expires_at),
    KEY idx_pub_news_featured (is_featured, publication_status, published_at),
    KEY idx_pub_news_media (featured_media_asset_id),
    CONSTRAINT fk_pub_news_category
        FOREIGN KEY (category_id) REFERENCES public_news_categories(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_news_media
        FOREIGN KEY (featured_media_asset_id) REFERENCES public_media_assets(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_news_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_news_updated_by
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_news_approved_by
        FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_news_published_by
        FOREIGN KEY (published_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS public_announcements (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    announcement_key VARCHAR(120) NOT NULL,
    title VARCHAR(255) NOT NULL,
    body_text TEXT NULL,
    link_label VARCHAR(120) NULL,
    link_url VARCHAR(500) NULL,
    display_style VARCHAR(50) NOT NULL DEFAULT 'info',
    priority INT NOT NULL DEFAULT 0,
    ticker_enabled TINYINT(1) NOT NULL DEFAULT 0,
    publication_status ENUM('draft', 'in_review', 'approved', 'scheduled', 'published', 'expired', 'archived') NOT NULL DEFAULT 'draft',
    publish_at DATETIME NULL,
    expires_at DATETIME NULL,
    published_at DATETIME NULL,
    created_by INT NULL,
    updated_by INT NULL,
    approved_by INT NULL,
    published_by INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_pub_announcement_key (announcement_key),
    KEY idx_pub_announcement_display (ticker_enabled, publication_status, priority),
    KEY idx_pub_announcement_schedule (publication_status, publish_at, expires_at),
    CONSTRAINT fk_pub_announcement_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_announcement_updated_by
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_announcement_approved_by
        FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_announcement_published_by
        FOREIGN KEY (published_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS public_leadership_profiles (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    profile_key VARCHAR(120) NOT NULL,
    slug VARCHAR(180) NOT NULL,
    full_name VARCHAR(200) NOT NULL,
    position_title VARCHAR(200) NOT NULL,
    professional_summary TEXT NULL,
    biography_json JSON NULL,
    portrait_media_asset_id BIGINT UNSIGNED NULL,
    signature_media_asset_id BIGINT UNSIGNED NULL,
    social_links_json JSON NULL,
    sort_order INT NOT NULL DEFAULT 0,
    publication_status ENUM('draft', 'in_review', 'approved', 'scheduled', 'published', 'expired', 'archived') NOT NULL DEFAULT 'draft',
    publish_at DATETIME NULL,
    expires_at DATETIME NULL,
    published_at DATETIME NULL,
    created_by INT NULL,
    updated_by INT NULL,
    approved_by INT NULL,
    published_by INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_pub_leadership_key (profile_key),
    UNIQUE KEY uq_pub_leadership_slug (slug),
    KEY idx_pub_leadership_display (publication_status, sort_order),
    KEY idx_pub_leadership_portrait (portrait_media_asset_id),
    CONSTRAINT fk_pub_leadership_portrait
        FOREIGN KEY (portrait_media_asset_id) REFERENCES public_media_assets(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_leadership_signature
        FOREIGN KEY (signature_media_asset_id) REFERENCES public_media_assets(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_leadership_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_leadership_updated_by
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_leadership_approved_by
        FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_leadership_published_by
        FOREIGN KEY (published_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS public_projects (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    project_key VARCHAR(120) NOT NULL,
    slug VARCHAR(200) NOT NULL,
    division_id BIGINT UNSIGNED NULL,
    title VARCHAR(255) NOT NULL,
    summary TEXT NULL,
    body_json JSON NULL,
    location_text VARCHAR(255) NULL,
    operational_status ENUM('planned', 'active', 'paused', 'completed', 'cancelled') NOT NULL DEFAULT 'planned',
    start_date DATE NULL,
    end_date DATE NULL,
    featured_media_asset_id BIGINT UNSIGNED NULL,
    sort_order INT NOT NULL DEFAULT 0,
    publication_status ENUM('draft', 'in_review', 'approved', 'scheduled', 'published', 'expired', 'archived') NOT NULL DEFAULT 'draft',
    publish_at DATETIME NULL,
    expires_at DATETIME NULL,
    published_at DATETIME NULL,
    created_by INT NULL,
    updated_by INT NULL,
    approved_by INT NULL,
    published_by INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_pub_project_key (project_key),
    UNIQUE KEY uq_pub_project_slug (slug),
    KEY idx_pub_project_division (division_id),
    KEY idx_pub_project_status (operational_status, publication_status),
    KEY idx_pub_project_schedule (publication_status, publish_at, expires_at),
    KEY idx_pub_project_media (featured_media_asset_id),
    CONSTRAINT fk_pub_project_division
        FOREIGN KEY (division_id) REFERENCES public_business_divisions(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_project_media
        FOREIGN KEY (featured_media_asset_id) REFERENCES public_media_assets(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_project_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_project_updated_by
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_project_approved_by
        FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_project_published_by
        FOREIGN KEY (published_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS public_project_media (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    project_id BIGINT UNSIGNED NOT NULL,
    media_asset_id BIGINT UNSIGNED NOT NULL,
    media_role VARCHAR(50) NOT NULL DEFAULT 'gallery',
    caption VARCHAR(500) NULL,
    sort_order INT NOT NULL DEFAULT 0,
    created_by INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_pub_project_media (project_id, media_asset_id, media_role),
    KEY idx_pub_project_media_order (project_id, sort_order),
    KEY idx_pub_project_media_asset (media_asset_id),
    CONSTRAINT fk_pub_project_media_project
        FOREIGN KEY (project_id) REFERENCES public_projects(id) ON DELETE CASCADE,
    CONSTRAINT fk_pub_project_media_asset
        FOREIGN KEY (media_asset_id) REFERENCES public_media_assets(id) ON DELETE CASCADE,
    CONSTRAINT fk_pub_project_media_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS public_equipment_catalogue (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    equipment_key VARCHAR(120) NOT NULL,
    slug VARCHAR(200) NOT NULL,
    division_id BIGINT UNSIGNED NULL,
    internal_reference_type VARCHAR(80) NULL,
    internal_reference_id BIGINT UNSIGNED NULL,
    name VARCHAR(220) NOT NULL,
    manufacturer VARCHAR(150) NULL,
    model VARCHAR(150) NULL,
    model_year SMALLINT UNSIGNED NULL,
    equipment_category VARCHAR(120) NULL,
    condition_label VARCHAR(80) NULL,
    availability_status ENUM('available', 'reserved', 'hired', 'sold', 'maintenance', 'unavailable', 'coming_soon') NOT NULL DEFAULT 'coming_soon',
    short_description TEXT NULL,
    specifications_json JSON NULL,
    features_json JSON NULL,
    currency_code CHAR(3) NOT NULL DEFAULT 'GHS',
    display_price DECIMAL(18,2) NULL,
    show_price TINYINT(1) NOT NULL DEFAULT 0,
    hire_available TINYINT(1) NOT NULL DEFAULT 0,
    finance_available TINYINT(1) NOT NULL DEFAULT 0,
    featured_media_asset_id BIGINT UNSIGNED NULL,
    sort_order INT NOT NULL DEFAULT 0,
    publication_status ENUM('draft', 'in_review', 'approved', 'scheduled', 'published', 'expired', 'archived') NOT NULL DEFAULT 'draft',
    publish_at DATETIME NULL,
    expires_at DATETIME NULL,
    published_at DATETIME NULL,
    created_by INT NULL,
    updated_by INT NULL,
    approved_by INT NULL,
    published_by INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_pub_equipment_key (equipment_key),
    UNIQUE KEY uq_pub_equipment_slug (slug),
    KEY idx_pub_equipment_division (division_id),
    KEY idx_pub_equipment_availability (availability_status, publication_status),
    KEY idx_pub_equipment_features (hire_available, finance_available, publication_status),
    KEY idx_pub_equipment_schedule (publication_status, publish_at, expires_at),
    KEY idx_pub_equipment_media (featured_media_asset_id),
    KEY idx_pub_equipment_internal_ref (internal_reference_type, internal_reference_id),
    CONSTRAINT fk_pub_equipment_division
        FOREIGN KEY (division_id) REFERENCES public_business_divisions(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_equipment_media
        FOREIGN KEY (featured_media_asset_id) REFERENCES public_media_assets(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_equipment_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_equipment_updated_by
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_equipment_approved_by
        FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_equipment_published_by
        FOREIGN KEY (published_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS public_testimonials (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    testimonial_key VARCHAR(120) NOT NULL,
    customer_display_name VARCHAR(180) NOT NULL,
    customer_title VARCHAR(180) NULL,
    company_name VARCHAR(180) NULL,
    quote_text TEXT NOT NULL,
    rating TINYINT UNSIGNED NULL,
    portrait_media_asset_id BIGINT UNSIGNED NULL,
    sort_order INT NOT NULL DEFAULT 0,
    publication_status ENUM('draft', 'in_review', 'approved', 'scheduled', 'published', 'expired', 'archived') NOT NULL DEFAULT 'draft',
    publish_at DATETIME NULL,
    expires_at DATETIME NULL,
    published_at DATETIME NULL,
    created_by INT NULL,
    updated_by INT NULL,
    approved_by INT NULL,
    published_by INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_pub_testimonial_key (testimonial_key),
    KEY idx_pub_testimonial_display (publication_status, sort_order),
    KEY idx_pub_testimonial_media (portrait_media_asset_id),
    CONSTRAINT fk_pub_testimonial_media
        FOREIGN KEY (portrait_media_asset_id) REFERENCES public_media_assets(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_testimonial_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_testimonial_updated_by
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_testimonial_approved_by
        FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_testimonial_published_by
        FOREIGN KEY (published_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS public_locations (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    location_key VARCHAR(120) NOT NULL,
    slug VARCHAR(180) NOT NULL,
    division_id BIGINT UNSIGNED NULL,
    name VARCHAR(220) NOT NULL,
    location_type VARCHAR(100) NOT NULL DEFAULT 'office',
    address_line VARCHAR(500) NULL,
    city VARCHAR(120) NULL,
    region VARCHAR(120) NULL,
    country VARCHAR(120) NOT NULL DEFAULT 'Ghana',
    latitude DECIMAL(10,7) NULL,
    longitude DECIMAL(10,7) NULL,
    phone VARCHAR(50) NULL,
    email VARCHAR(180) NULL,
    business_hours_json JSON NULL,
    map_url VARCHAR(700) NULL,
    featured_media_asset_id BIGINT UNSIGNED NULL,
    sort_order INT NOT NULL DEFAULT 0,
    publication_status ENUM('draft', 'in_review', 'approved', 'scheduled', 'published', 'expired', 'archived') NOT NULL DEFAULT 'draft',
    publish_at DATETIME NULL,
    expires_at DATETIME NULL,
    published_at DATETIME NULL,
    created_by INT NULL,
    updated_by INT NULL,
    approved_by INT NULL,
    published_by INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_pub_location_key (location_key),
    UNIQUE KEY uq_pub_location_slug (slug),
    KEY idx_pub_location_division (division_id),
    KEY idx_pub_location_display (publication_status, sort_order),
    KEY idx_pub_location_region (country, region, city),
    KEY idx_pub_location_media (featured_media_asset_id),
    CONSTRAINT fk_pub_location_division
        FOREIGN KEY (division_id) REFERENCES public_business_divisions(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_location_media
        FOREIGN KEY (featured_media_asset_id) REFERENCES public_media_assets(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_location_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_location_updated_by
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_location_approved_by
        FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_location_published_by
        FOREIGN KEY (published_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS public_company_statistics (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    statistic_key VARCHAR(120) NOT NULL,
    label VARCHAR(180) NOT NULL,
    display_value VARCHAR(120) NOT NULL,
    numeric_value DECIMAL(20,4) NULL,
    prefix_text VARCHAR(30) NULL,
    suffix_text VARCHAR(30) NULL,
    source_note VARCHAR(500) NULL,
    as_of_date DATE NULL,
    sort_order INT NOT NULL DEFAULT 0,
    publication_status ENUM('draft', 'in_review', 'approved', 'scheduled', 'published', 'expired', 'archived') NOT NULL DEFAULT 'draft',
    publish_at DATETIME NULL,
    expires_at DATETIME NULL,
    published_at DATETIME NULL,
    created_by INT NULL,
    updated_by INT NULL,
    approved_by INT NULL,
    published_by INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_pub_statistic_key (statistic_key),
    KEY idx_pub_statistic_display (publication_status, sort_order),
    KEY idx_pub_statistic_as_of (as_of_date),
    CONSTRAINT fk_pub_statistic_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_statistic_updated_by
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_statistic_approved_by
        FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_statistic_published_by
        FOREIGN KEY (published_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS public_job_vacancies (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    vacancy_key VARCHAR(120) NOT NULL,
    slug VARCHAR(200) NOT NULL,
    division_id BIGINT UNSIGNED NULL,
    location_id BIGINT UNSIGNED NULL,
    title VARCHAR(255) NOT NULL,
    employment_type VARCHAR(80) NULL,
    summary TEXT NULL,
    description_json JSON NULL,
    requirements_json JSON NULL,
    application_instructions_json JSON NULL,
    application_url VARCHAR(700) NULL,
    vacancies_count INT UNSIGNED NOT NULL DEFAULT 1,
    opens_at DATETIME NULL,
    closes_at DATETIME NULL,
    featured_media_asset_id BIGINT UNSIGNED NULL,
    publication_status ENUM('draft', 'in_review', 'approved', 'scheduled', 'published', 'expired', 'archived') NOT NULL DEFAULT 'draft',
    publish_at DATETIME NULL,
    expires_at DATETIME NULL,
    published_at DATETIME NULL,
    created_by INT NULL,
    updated_by INT NULL,
    approved_by INT NULL,
    published_by INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_pub_vacancy_key (vacancy_key),
    UNIQUE KEY uq_pub_vacancy_slug (slug),
    KEY idx_pub_vacancy_division (division_id),
    KEY idx_pub_vacancy_location (location_id),
    KEY idx_pub_vacancy_window (publication_status, opens_at, closes_at),
    KEY idx_pub_vacancy_schedule (publication_status, publish_at, expires_at),
    CONSTRAINT fk_pub_vacancy_division
        FOREIGN KEY (division_id) REFERENCES public_business_divisions(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_vacancy_location
        FOREIGN KEY (location_id) REFERENCES public_locations(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_vacancy_media
        FOREIGN KEY (featured_media_asset_id) REFERENCES public_media_assets(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_vacancy_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_vacancy_updated_by
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_vacancy_approved_by
        FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_vacancy_published_by
        FOREIGN KEY (published_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS public_tenders (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    tender_key VARCHAR(120) NOT NULL,
    slug VARCHAR(200) NOT NULL,
    division_id BIGINT UNSIGNED NULL,
    reference_number VARCHAR(120) NULL,
    title VARCHAR(255) NOT NULL,
    summary TEXT NULL,
    details_json JSON NULL,
    submission_instructions_json JSON NULL,
    opens_at DATETIME NULL,
    closes_at DATETIME NULL,
    document_media_asset_id BIGINT UNSIGNED NULL,
    publication_status ENUM('draft', 'in_review', 'approved', 'scheduled', 'published', 'expired', 'archived') NOT NULL DEFAULT 'draft',
    publish_at DATETIME NULL,
    expires_at DATETIME NULL,
    published_at DATETIME NULL,
    created_by INT NULL,
    updated_by INT NULL,
    approved_by INT NULL,
    published_by INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_pub_tender_key (tender_key),
    UNIQUE KEY uq_pub_tender_slug (slug),
    UNIQUE KEY uq_pub_tender_reference (reference_number),
    KEY idx_pub_tender_division (division_id),
    KEY idx_pub_tender_window (publication_status, opens_at, closes_at),
    KEY idx_pub_tender_schedule (publication_status, publish_at, expires_at),
    CONSTRAINT fk_pub_tender_division
        FOREIGN KEY (division_id) REFERENCES public_business_divisions(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_tender_document
        FOREIGN KEY (document_media_asset_id) REFERENCES public_media_assets(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_tender_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_tender_updated_by
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_tender_approved_by
        FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_tender_published_by
        FOREIGN KEY (published_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS public_faqs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    faq_key VARCHAR(120) NOT NULL,
    category_label VARCHAR(150) NULL,
    question VARCHAR(700) NOT NULL,
    answer_json JSON NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    publication_status ENUM('draft', 'in_review', 'approved', 'scheduled', 'published', 'expired', 'archived') NOT NULL DEFAULT 'draft',
    publish_at DATETIME NULL,
    expires_at DATETIME NULL,
    published_at DATETIME NULL,
    created_by INT NULL,
    updated_by INT NULL,
    approved_by INT NULL,
    published_by INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_pub_faq_key (faq_key),
    KEY idx_pub_faq_display (category_label, publication_status, sort_order),
    KEY idx_pub_faq_schedule (publication_status, publish_at, expires_at),
    CONSTRAINT fk_pub_faq_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_faq_updated_by
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_faq_approved_by
        FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_faq_published_by
        FOREIGN KEY (published_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS public_forms (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    form_key VARCHAR(120) NOT NULL,
    slug VARCHAR(180) NOT NULL,
    name VARCHAR(220) NOT NULL,
    form_type VARCHAR(100) NOT NULL DEFAULT 'general_enquiry',
    description TEXT NULL,
    confirmation_message TEXT NULL,
    settings_json JSON NULL,
    publication_status ENUM('draft', 'in_review', 'approved', 'scheduled', 'published', 'expired', 'archived') NOT NULL DEFAULT 'draft',
    publish_at DATETIME NULL,
    expires_at DATETIME NULL,
    published_at DATETIME NULL,
    created_by INT NULL,
    updated_by INT NULL,
    approved_by INT NULL,
    published_by INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_pub_form_key (form_key),
    UNIQUE KEY uq_pub_form_slug (slug),
    KEY idx_pub_form_type_status (form_type, publication_status),
    KEY idx_pub_form_schedule (publication_status, publish_at, expires_at),
    CONSTRAINT fk_pub_form_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_form_updated_by
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_form_approved_by
        FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_form_published_by
        FOREIGN KEY (published_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS public_form_fields (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    form_id BIGINT UNSIGNED NOT NULL,
    field_key VARCHAR(120) NOT NULL,
    field_type VARCHAR(80) NOT NULL,
    label VARCHAR(220) NOT NULL,
    placeholder VARCHAR(255) NULL,
    help_text VARCHAR(700) NULL,
    is_required TINYINT(1) NOT NULL DEFAULT 0,
    options_json JSON NULL,
    validation_json JSON NULL,
    sort_order INT NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_pub_form_field_key (form_id, field_key),
    KEY idx_pub_form_field_order (form_id, is_active, sort_order),
    CONSTRAINT fk_pub_form_field_form
        FOREIGN KEY (form_id) REFERENCES public_forms(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS public_form_submissions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    form_id BIGINT UNSIGNED NOT NULL,
    reference_code VARCHAR(50) NOT NULL,
    submission_status ENUM('new', 'in_review', 'awaiting_customer', 'resolved', 'rejected', 'spam', 'archived') NOT NULL DEFAULT 'new',
    full_name VARCHAR(200) NULL,
    email VARCHAR(180) NULL,
    phone VARCHAR(50) NULL,
    company_name VARCHAR(200) NULL,
    response_json JSON NOT NULL,
    consent_given TINYINT(1) NOT NULL DEFAULT 0,
    consent_text_version VARCHAR(80) NULL,
    consent_at DATETIME NULL,
    source_page_slug VARCHAR(180) NULL,
    source_url VARCHAR(700) NULL,
    ip_hash CHAR(64) NULL,
    user_agent VARCHAR(500) NULL,
    assigned_to INT NULL,
    reviewed_by INT NULL,
    review_notes TEXT NULL,
    reviewed_at DATETIME NULL,
    resolved_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_pub_submission_reference (reference_code),
    KEY idx_pub_submission_form_status (form_id, submission_status, created_at),
    KEY idx_pub_submission_contact (email, phone),
    KEY idx_pub_submission_assigned (assigned_to, submission_status),
    KEY idx_pub_submission_created (created_at),
    CONSTRAINT fk_pub_submission_form
        FOREIGN KEY (form_id) REFERENCES public_forms(id) ON DELETE RESTRICT,
    CONSTRAINT fk_pub_submission_assigned_to
        FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_submission_reviewed_by
        FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS public_form_submission_files (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    submission_id BIGINT UNSIGNED NOT NULL,
    field_key VARCHAR(120) NULL,
    storage_provider VARCHAR(50) NOT NULL DEFAULT 'cloudflare_r2',
    storage_key VARCHAR(500) NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    mime_type VARCHAR(150) NOT NULL,
    file_size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
    checksum_sha256 CHAR(64) NULL,
    security_status ENUM('pending', 'clean', 'rejected', 'quarantined') NOT NULL DEFAULT 'pending',
    scan_details_json JSON NULL,
    reviewed_by INT NULL,
    reviewed_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_pub_submission_file_storage (storage_key),
    KEY idx_pub_submission_file_submission (submission_id, security_status),
    KEY idx_pub_submission_file_checksum (checksum_sha256),
    CONSTRAINT fk_pub_submission_file_submission
        FOREIGN KEY (submission_id) REFERENCES public_form_submissions(id) ON DELETE CASCADE,
    CONSTRAINT fk_pub_submission_file_reviewed_by
        FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS public_content_versions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    entity_type VARCHAR(80) NOT NULL,
    entity_id BIGINT UNSIGNED NOT NULL,
    version_number INT UNSIGNED NOT NULL,
    version_status ENUM('draft', 'in_review', 'approved', 'published', 'superseded', 'archived') NOT NULL DEFAULT 'draft',
    snapshot_json JSON NOT NULL,
    change_summary VARCHAR(500) NULL,
    created_by INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_pub_content_version (entity_type, entity_id, version_number),
    KEY idx_pub_content_version_entity (entity_type, entity_id, version_status),
    KEY idx_pub_content_version_created (created_at),
    CONSTRAINT fk_pub_content_version_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS public_content_approvals (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    entity_type VARCHAR(80) NOT NULL,
    entity_id BIGINT UNSIGNED NOT NULL,
    content_version_id BIGINT UNSIGNED NULL,
    page_version_id BIGINT UNSIGNED NULL,
    request_type ENUM('review', 'publish', 'restore', 'archive', 'expire') NOT NULL DEFAULT 'review',
    approval_status ENUM('pending', 'approved', 'rejected', 'cancelled', 'expired') NOT NULL DEFAULT 'pending',
    requested_by INT NULL,
    assigned_to INT NULL,
    decided_by INT NULL,
    request_note TEXT NULL,
    decision_note TEXT NULL,
    execution_token CHAR(64) NULL,
    requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NULL,
    decided_at DATETIME NULL,
    executed_at DATETIME NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_pub_approval_execution_token (execution_token),
    KEY idx_pub_approval_entity (entity_type, entity_id, approval_status),
    KEY idx_pub_approval_assigned (assigned_to, approval_status, requested_at),
    KEY idx_pub_approval_content_version (content_version_id),
    KEY idx_pub_approval_page_version (page_version_id),
    CONSTRAINT fk_pub_approval_content_version
        FOREIGN KEY (content_version_id) REFERENCES public_content_versions(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_approval_page_version
        FOREIGN KEY (page_version_id) REFERENCES public_page_versions(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_approval_requested_by
        FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_approval_assigned_to
        FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_approval_decided_by
        FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS public_content_audit_log (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    entity_type VARCHAR(80) NOT NULL,
    entity_id BIGINT UNSIGNED NOT NULL,
    action_key VARCHAR(100) NOT NULL,
    actor_user_id INT NULL,
    approval_id BIGINT UNSIGNED NULL,
    request_id VARCHAR(80) NULL,
    before_json JSON NULL,
    after_json JSON NULL,
    metadata_json JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_pub_audit_entity (entity_type, entity_id, created_at),
    KEY idx_pub_audit_actor (actor_user_id, created_at),
    KEY idx_pub_audit_approval (approval_id),
    KEY idx_pub_audit_request (request_id),
    CONSTRAINT fk_pub_audit_actor
        FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_audit_approval
        FOREIGN KEY (approval_id) REFERENCES public_content_approvals(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO schema_migrations (
    migration_name,
    description
)
SELECT
    '20260805_chalin_one_public_content_foundation',
    'Adds the isolated, versioned and approval-controlled public website and Content Studio data foundation without changing existing business records.'
WHERE NOT EXISTS (
    SELECT 1
    FROM schema_migrations
    WHERE migration_name = '20260805_chalin_one_public_content_foundation'
);
