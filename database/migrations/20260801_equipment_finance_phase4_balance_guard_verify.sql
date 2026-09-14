SELECT migration_name, description
FROM schema_migrations
WHERE migration_name = 'equipment_finance_phase4_balance_guard';

SELECT TRIGGER_NAME, EVENT_MANIPULATION, ACTION_TIMING, EVENT_OBJECT_TABLE
FROM information_schema.TRIGGERS
WHERE TRIGGER_SCHEMA = DATABASE()
  AND TRIGGER_NAME = 'trg_equipment_finance_phase4_balance_guard_before_update';

SELECT COUNT(*) AS invalid_controlled_balances
FROM equipment_sale_agreements agreement
WHERE agreement.sale_type = 'installment'
  AND agreement.activation_source = 'approved_credit_application'
  AND ABS(
    agreement.outstanding_balance - GREATEST(
      ROUND(
        agreement.total_amount
        + COALESCE((
          SELECT SUM(schedule.late_charge_amount - schedule.waived_charge_amount)
          FROM equipment_installment_schedule schedule
          WHERE schedule.agreement_id = agreement.id
            AND schedule.schedule_status <> 'rescheduled'
        ), 0)
        + COALESCE((
          SELECT SUM(CASE WHEN ledger.direction = 'debit' THEN ledger.amount ELSE 0 END)
          FROM equipment_finance_ledger_entries ledger
          WHERE ledger.agreement_id = agreement.id
        ), 0)
        - COALESCE((
          SELECT SUM(CASE WHEN payment.is_voided = FALSE THEN payment.amount ELSE 0 END)
          FROM equipment_sale_payments payment
          WHERE payment.agreement_id = agreement.id
        ), 0)
        - COALESCE((
          SELECT SUM(CASE WHEN ledger.direction = 'credit' THEN ledger.amount ELSE 0 END)
          FROM equipment_finance_ledger_entries ledger
          WHERE ledger.agreement_id = agreement.id
        ), 0),
        2
      ),
      0.00
    )
  ) > 0.01;
