SELECT migration_name
FROM schema_migrations
WHERE migration_name = 'equipment_finance_phase5_documents_delivery';

SELECT TABLE_NAME
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
    'equipment_finance_document_delivery_policy',
    'equipment_finance_document_delivery_policy_history',
    'equipment_finance_private_documents',
    'equipment_finance_delivery_authorizations',
    'equipment_finance_delivery_confirmations',
    'equipment_finance_case_activity'
  )
ORDER BY TABLE_NAME;

SELECT COUNT(*) AS policy_rows
FROM equipment_finance_document_delivery_policy
WHERE id = 1
  AND policy_version <> ''
  AND maximum_file_size_bytes BETWEEN 1 AND 10485760
  AND delivery_authorization_valid_hours BETWEEN 1 AND 720;

SELECT TABLE_NAME, COLUMN_NAME
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND (
    (TABLE_NAME = 'equipment_finance_private_documents' AND COLUMN_NAME IN (
      'agreement_id','document_category','encrypted_payload','encryption_iv','encryption_tag',
      'content_checksum','review_status','reviewed_by','approval_status','approved_by','uploaded_by'
    )) OR
    (TABLE_NAME = 'equipment_finance_delivery_authorizations' AND COLUMN_NAME IN (
      'agreement_id','authorization_status','document_snapshot_json','financial_snapshot_json',
      'requested_by','authorized_by','expires_at','consumed_by','delivery_id'
    )) OR
    (TABLE_NAME = 'equipment_finance_delivery_confirmations' AND COLUMN_NAME IN (
      'authorization_id','delivery_id','agreement_id','confirmation_snapshot_json','confirmed_by'
    )) OR
    (TABLE_NAME = 'equipment_finance_case_activity' AND COLUMN_NAME IN (
      'agreement_id','document_id','authorization_id','delivery_id','action_type','actor_id','metadata_json'
    ))
  )
ORDER BY TABLE_NAME, COLUMN_NAME;

SELECT
  (SELECT COUNT(*) FROM equipment_finance_private_documents
    WHERE review_status = 'verified' AND reviewed_by IS NULL)
  +
  (SELECT COUNT(*) FROM equipment_finance_private_documents
    WHERE approval_status = 'approved' AND approved_by IS NULL)
  +
  (SELECT COUNT(*) FROM equipment_finance_delivery_authorizations
    WHERE authorization_status = 'authorized' AND (authorized_by IS NULL OR authorized_at IS NULL))
  +
  (SELECT COUNT(*) FROM equipment_finance_delivery_authorizations
    WHERE authorization_status = 'consumed' AND (consumed_by IS NULL OR delivery_id IS NULL))
  +
  (SELECT COUNT(*) FROM equipment_finance_delivery_confirmations confirmation
    LEFT JOIN equipment_finance_delivery_authorizations authorization
      ON authorization.id = confirmation.authorization_id
    WHERE authorization.id IS NULL)
  AS invalid_control_rows;
