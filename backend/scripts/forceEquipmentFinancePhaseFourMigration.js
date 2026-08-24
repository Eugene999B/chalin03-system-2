const { runEquipmentFinancePhaseFourStartup } = require('./runEquipmentFinancePhaseFourStartup');

/**
 * Force Equipment Finance Phase 4 Migration Runner
 * 
 * This script explicitly applies all Phase 4 migrations if they haven't been applied.
 * It's called by railway.json pre-deploy to ensure the deposit-reservation schema exists
 * before the application starts.
 * 
 * Phase 4 includes:
 * - Corrections and settlements
 * - Balance guard triggers
 * - Deposit reservation integrity (the 503 fix)
 */

async function run() {
  try {
    console.log('🔧 Equipment Finance Phase 4 Migration Runner starting...');
    const result = await runEquipmentFinancePhaseFourStartup();
    console.log(`✅ Phase 4 migrations completed on ${result.database_name}`);
    console.log(`   Applied: ${result.releases.join(', ')}`);
    process.exit(0);
  } catch (error) {
    console.error('❌ Phase 4 migration failed:');
    console.error(error.message);
    console.error('\nDEPOSIT RESERVATIONS WILL NOT BE AVAILABLE UNTIL THIS IS FIXED.');
    console.error('Contact your database administrator to manually apply:');
    console.error('  - database/migrations/20260803_equipment_finance_phase4_deposit_reservation_integrity.sql');
    process.exit(1);
  }
}

if (require.main === module) {
  run();
}

module.exports = { run };
