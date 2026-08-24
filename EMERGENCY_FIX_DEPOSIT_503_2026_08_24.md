# 🚨 EMERGENCY: 503 DEPOSIT ERROR - TROUBLESHOOTING & FIXES

**Last Updated**: 2026-08-24 18:36 UTC  
**Status**: CRITICAL - Migration Not Applied to Railway Database

---

## ⚠️ IMMEDIATE PROBLEM

Your production Railway database **has NOT applied** the Phase 4 deposit reservation migration.

```
❌ GET /api/equipment-catalogue/sales/deposit-reservations/candidates
   HTTP 503 Service Unavailable
   Reason: Schema migration missing from Railway MySQL
```

---

## 🔧 QUICK FIX (Choose One)

### Option 1: Force Railway Redeploy (Recommended)
Railway will automatically run the Phase 4 migration on next deploy:

**Steps:**
1. Go to Railway.app → Your Project → Your Backend Service
2. Click "Deploy" or make any commit to `production` branch
3. Railway will execute pre-deploy:
   ```bash
   npm run migrate:equipment-finance:phase4:production
   ```
4. Wait for deployment to complete
5. Test: `https://chalin03.com/api/equipment-catalogue/sales/deposit-reservations/readiness`
   - Should return 200 OK with `ready: true`

**Expected Time**: 5-10 minutes

---

### Option 2: Manual Database Execution (If Option 1 Fails)

If Railway deployment fails or migration doesn't run:

**Step 1: Connect to Railway MySQL**
```bash
# Use Railway's MySQL connection string
# Format: mysql -h <HOST> -u <USER> -p <PASSWORD> <DATABASE>
mysql -h <railway-host> -u <railway-user> -p<password> <railway-db>
```

**Step 2: Execute Migration SQL Directly**
```sql
-- Copy the entire contents of this file and paste into MySQL:
-- database/migrations/20260803_equipment_finance_phase4_deposit_reservation_integrity.sql

-- Then verify:
SELECT migration_name FROM schema_migrations 
WHERE migration_name = '20260803_equipment_finance_phase4_deposit_reservation_integrity';
-- Should return 1 row
```

**Step 3: Record Migration in schema_migrations**
```sql
INSERT INTO schema_migrations (migration_name, description, applied_at)
VALUES (
    '20260803_equipment_finance_phase4_deposit_reservation_integrity',
    'Phase 4 deposit reservation integrity controls',
    NOW()
)
ON DUPLICATE KEY UPDATE applied_at = NOW();
```

**Step 4: Verify**
```bash
curl https://chalin03.com/api/equipment-catalogue/sales/deposit-reservations/readiness
# Should return: { "status": "success", "readiness": { "ready": true } }
```

---

### Option 3: Restart Railway Pre-Deploy (Nuclear Option)

If the migration runner script itself has issues:

**Step 1**: SSH into Railway container or check logs
```bash
# Railway Console → Logs
# Look for any errors from:
# - forceEquipmentFinancePhaseFourMigration.js
# - runEquipmentFinancePhaseFourStartup.js
```

**Step 2**: Manually trigger migration in Railway bash
```bash
cd /app/backend
export CHALIN03_EXPECTED_DATABASE="<actual-db-name>"
node scripts/forceEquipmentFinancePhaseFourMigration.js
```

**Step 3**: Verify in logs
```
✅ Phase 4 migrations completed on [database_name]
   Applied: equipment_finance_phase4_corrections_settlements, 
            equipment_finance_phase4_balance_guard, 
            20260803_equipment_finance_phase4_deposit_reservation_integrity
```

---

## 🔍 DIAGNOSIS CHECKLIST

Before applying fixes, verify the problem:

### Check 1: Verify Migration File Exists
```bash
# File should exist at:
database/migrations/20260803_equipment_finance_phase4_deposit_reservation_integrity.sql
# If NOT found, migration file is missing from repository!
```

### Check 2: Check Railway Logs
```
Railway Console → Logs tab:
- Search for: "Phase 4 migration"
- Search for: "Equipment Finance Phase 4"
- Look for any "ERROR" messages
```

### Check 3: Verify Database Connection
```sql
-- Connect to Railway MySQL directly
SELECT 1;  -- Should return 1 if connection works
SHOW DATABASES;  -- Should show your chalin03 database
SELECT DATABASE();  -- Should show your database name
```

### Check 4: Verify Migration Record
```sql
-- Check if migration is already applied
SELECT * FROM schema_migrations 
WHERE migration_name LIKE '%deposit%' 
OR migration_name LIKE '%phase4%';
-- Should show multiple migration records
```

### Check 5: Test API Directly
```bash
# Test readiness endpoint
curl -i https://chalin03.com/api/equipment-catalogue/sales/deposit-reservations/readiness

# Expected response if FIXED:
# HTTP 200 OK
# { "status": "success", "readiness": { "ready": true } }

# Current response if NOT FIXED:
# HTTP 503 Service Unavailable
# { "status": "error", "code": "EQUIPMENT_FINANCE_DEPOSIT_FOUNDATION_REQUIRED" }
```

---

## 🐛 COMMON ERRORS & SOLUTIONS

### Error: "EQUIPMENT_FINANCE_DEPOSIT_FOUNDATION_REQUIRED"
**Cause**: Phase 4 migration not applied to database  
**Fix**: Run Option 1 or Option 2 above

### Error: "Could not acquire the Phase 4 migration lock"
**Cause**: Another migration is running or lock is stuck  
**Fix**: Wait 5 minutes and retry, or manually release in MySQL:
```sql
SELECT RELEASE_LOCK('chalin03:equipment-finance:phase4');
```

### Error: "Phase 4 migration failed at statement X"
**Cause**: SQL syntax error or table structure issue  
**Fix**: 
1. Check full error message in Railway logs
2. Ensure all prerequisite migrations are applied first
3. Contact database administrator

### Error: "The unique opening-deposit idempotency index is missing"
**Cause**: Migration didn't create required database index  
**Fix**: Re-run entire migration from Option 2

---

## 📊 WHAT GETS CREATED

When Phase 4 migration runs successfully:

**New Database Columns**:
- `equipment_sale_agreements.credit_application_id`
- `equipment_sale_agreements.equipment_commitment_status`
- `equipment_sale_agreements.deposit_completed_at`
- `equipment_sale_agreements.deposit_completed_by`
- `equipment_sale_agreements.reservation_activated_at`
- `equipment_sale_agreements.reservation_activated_by`
- `equipment_sale_payments.payment_stage`
- `equipment_sale_payments.reservation_effect`
- `equipment_sale_payments.idempotency_key`

**New Database Triggers**:
- `trg_equipment_finance_payment_gate_before_insert`
- `trg_equipment_finance_reservation_gate_before_insert`
- `trg_equipment_finance_commitment_gate_before_update`

**New Database Index**:
- Unique index on `equipment_sale_payments.idempotency_key`

**Migration Record**:
- Record in `schema_migrations` table with name: `20260803_equipment_finance_phase4_deposit_reservation_integrity`

---

## ✅ VERIFICATION AFTER FIX

After applying the migration, verify success:

```bash
# 1. Check API is responding
curl https://chalin03.com/api/equipment-catalogue/sales/deposit-reservations/readiness
# Response: HTTP 200 with ready: true

# 2. Try loading candidates
curl https://chalin03.com/api/equipment-catalogue/sales/deposit-reservations/candidates
# Response: HTTP 200 with candidates array

# 3. Check browser console
# Open: https://chalin03.com/equipment-finance/deposits
# No 503 errors should appear

# 4. Test in Application
# Go to: Equipment Finance → Opening Deposits
# Click "Open Deposits" button
# Should show list of candidates without error
```

---

## 🆘 STILL NOT WORKING?

If the error persists after trying all options:

1. **Check Railway Deployment Status**
   - Go to Railway → Your Service → Deployments
   - Verify latest deployment completed successfully
   - Check pre-deploy logs for errors

2. **Verify Environment Variables**
   - `DB_HOST` must be set
   - `DB_USER` must be set
   - `DB_PASSWORD` must be set
   - `DB_NAME` must be set
   - `CHALIN03_EXPECTED_DATABASE` must match actual database name

3. **Check Database Credentials**
   - Connect to Railway MySQL manually
   - Verify credentials work
   - Verify database exists and is accessible

4. **Force Complete Restart**
   - Go to Railway → Your Service → Settings
   - Click "Restart" button
   - Wait 5 minutes
   - Test again

5. **Contact Support**
   - Check Railway status page for outages
   - Review Railway logs for system errors
   - Contact GitHub Copilot with:
     - Full error message from Railway logs
     - Database connection details
     - Screenshot of error

---

## 🔗 RELATED FILES

- **Migration SQL**: `database/migrations/20260803_equipment_finance_phase4_deposit_reservation_integrity.sql`
- **Migration Runner**: `backend/scripts/forceEquipmentFinancePhaseFourMigration.js`
- **Railway Config**: `railway.json`
- **Phase 4 Startup**: `backend/scripts/runEquipmentFinancePhaseFourStartup.js`
- **Routes File**: `backend/routes/equipmentFinanceDepositReservationRoutes.js`

---

## 📝 NOTES

- This is an **ADDITIVE** migration - it only adds new columns and triggers
- Existing data is **NOT** affected or modified
- Migration is **IDEMPOTENT** - running it multiple times is safe
- Phase 4 must be applied **BEFORE** deposit features can be used

---

**🔴 STATUS**: AWAITING FIX  
**🟡 PRIORITY**: CRITICAL  
**🟢 EXPECTED RESOLUTION TIME**: 5-10 minutes (Option 1) or 15-30 minutes (Option 2)

---

For immediate help, try **Option 1** (Force Railway Redeploy) first.
