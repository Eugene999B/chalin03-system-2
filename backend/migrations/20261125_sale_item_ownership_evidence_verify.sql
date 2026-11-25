-- READ-ONLY VERIFICATION.
SELECT migration_name,applied_at FROM schema_migrations WHERE migration_name='20261125_sale_item_ownership_evidence';
SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('sale_item_ownership_classifications','sale_item_ownership_events') ORDER BY TABLE_NAME;
SELECT COUNT(*) AS invalid_classifications FROM sale_item_ownership_classifications WHERE owner_code<>'unclassified' AND (evidence_reference IS NULL OR TRIM(evidence_reference)='' OR classified_by IS NULL);
SELECT COALESCE(o.owner_code,'unclassified') AS owner_code,COUNT(*) AS line_count FROM sale_items si LEFT JOIN sale_item_ownership_classifications o ON o.sale_item_id=si.id GROUP BY COALESCE(o.owner_code,'unclassified');
