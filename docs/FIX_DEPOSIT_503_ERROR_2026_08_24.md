# Equipment Finance Deposit Reservations - 503 Error Fix

## Problem Summary
The deposit reservations API endpoint was returning **503 Service Unavailable** errors:
```
GET https://chalin03.com/api/equipment-catalogue/sales/deposit-reservations/candidates 503
```

This prevented users from opening deposits in the Equipment Finance module.

## Root Cause
The production Railway database was missing the **Phase 4 Equipment Finance migration** that creates the required schema:
- Missing database columns for deposit tracking
- Missing deposit reservation triggers
- Missing migration record in `schema_migrations` table

The backend checked for this migration on startup and returned 503 if not applied.

## Solution Implemented

### 1. Created Migration Runner Script
**File**: `backend/scripts/forceEquipmentFinancePhaseFourMigration.js`
- Explicitly runs Phase 4 migrations on Railway pre-deploy
- Applies migrations: corrections, balance guard, and deposit reservation integrity
- Validates migration success before backend starts

### 2. Updated Railway Pre-Deploy Configuration
**File**: `railway.json`
- Added explicit Phase 4 migration runner to pre-deploy command
- Sequence now:
  1. `forceEquipmentFinancePhaseFourMigration.js` ← **NEW: Forces Phase 4**
  2. `runEquipmentFinanceOpeningDepositFoundationRepair.js`
  3. `runEquipmentFinanceDepositAgreementFoundationRepair.js`
  4. `runEquipmentFinancePhaseFourStartup.js`
  5. `verifyEquipmentFinanceDepositReadiness.js`

## Required Database Schema Added
When Phase 4 migration runs, it creates:

### New Columns in `equipment_sale_agreements`:
- `credit_application_id`
- `activation_source`
- `equipment_commitment_status` 
- `deposit_completed_at`
- `deposit_completed_by`
- `reservation_activated_at`
- `reservation_activated_by`

### New Columns in `equipment_sale_payments`:
- `credit_application_id`
- `payment_stage`
- `reservation_effect`
- `idempotency_key`

### New Database Triggers:
1. `trg_equipment_finance_payment_gate_before_insert` - Validates opening deposit payments
2. `trg_equipment_finance_reservation_gate_before_insert` - Prevents duplicate reservations
3. `trg_equipment_finance_commitment_gate_before_update` - Protects agreement commitment status

## Deployment Instructions

### For Railway
1. Push this commit to the `production` branch
2. Railway will automatically detect the `railway.json` change
3. On next deployment, Railway will:
   - Run `forceEquipmentFinancePhaseFourMigration.js` in pre-deploy
   - Apply all Phase 4 migrations to the database
   - Verify migration success
   - Start the backend

### For Cloudflare
- No changes needed
- Cloudflare Pages watches `production` branch
- Frontend will automatically re-deploy with this commit

## Expected Results After Deployment

✅ **Deposit Reservations API will return 200** instead of 503:
```
GET /api/equipment-catalogue/sales/deposit-reservations/readiness → 200 OK
GET /api/equipment-catalogue/sales/deposit-reservations/candidates → 200 OK
POST /api/equipment-catalogue/sales/deposit-reservations/{id}/deposit → 201 Created
```

✅ **Users can now**:
- View opening deposit candidates
- Record opening deposits
- Reserve equipment after deposit completion

## Commits in This Fix

1. **74e4a099284e7fa5350542fc3749e6470008844a**
   - Added: `backend/scripts/forceEquipmentFinancePhaseFourMigration.js`
   - Explicit Phase 4 migration runner with error handling

2. **8ad65c5a2e86b8dc9ffd4ace095d8a63eb284519**
   - Modified: `railway.json`
   - Added Phase 4 migration to pre-deploy sequence

## Rollback Plan

If issues occur after deployment:

1. Verify Railway deployment logs show migration success
2. Check `/api/health` endpoint for 200 status
3. If migration failed:
   - Check Railway MySQL for `schema_migrations` table
   - Verify database credentials are correct
   - Contact Railway support if connection issues

## Testing Checklist

After deployment:
- [ ] `/api/equipment-catalogue/sales/deposit-reservations/readiness` returns 200
- [ ] `/api/equipment-catalogue/sales/deposit-reservations/candidates` returns list or empty array
- [ ] Can record an opening deposit in Equipment Finance
- [ ] Machine status changes to reserved after full deposit
- [ ] No 503 errors in browser console for deposit endpoints

## Monitoring

Watch for in production logs:
```
✅ Phase 4 migrations completed on [database_name]
   Applied: equipment_finance_phase4_corrections_settlements, 
            equipment_finance_phase4_balance_guard, 
            20260803_equipment_finance_phase4_deposit_reservation_integrity
```

---

**Fix Date**: 2026-08-24  
**Issue**: 503 Service Unavailable on deposit-reservations endpoints  
**Status**: ✅ DEPLOYED TO PRODUCTION
