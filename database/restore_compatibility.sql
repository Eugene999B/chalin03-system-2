-- CHALIN 03 RESTORE COMPATIBILITY REFERENCE
-- This file is intentionally non-destructive.
-- The JavaScript reset/restore runner performs the JSON restore.

SELECT 'Canonical restore tables use branches, user_branch_access, and activity_log.' AS restore_policy;

SELECT 'Ignored backup aliases: stores, user_store_access, activity_logs.' AS ignored_aliases;

SELECT 'Legacy sales conversion: amount_tendered=legacy amount_paid, amount_paid=LEAST(legacy amount_paid,total), change_due=GREATEST(legacy amount_paid-total,0).' AS sales_hotfix_mapping;

SELECT 'Stage 6A user defaults: must_change_password=false, password_changed_at=NULL, created_by=NULL.' AS stage6a_user_mapping;
