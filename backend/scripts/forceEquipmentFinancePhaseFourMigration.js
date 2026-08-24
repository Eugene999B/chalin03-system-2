const { runEquipmentFinancePhaseFourStartup } = require('./runEquipmentFinancePhaseFourStartup');

/**
 * Equipment Finance Phase 4 Migration Direct Executor
 * 
 * This script DIRECTLY runs Phase 4 migrations without relying on npm scripts.
 * It's synchronously called during Railway pre-deploy to ensure the deposit-reservation 
 * schema exists BEFORE the application starts.
 * 
 * Phase 4 migrations applied:
 * 1. equipment_finance_phase4_corrections_settlements
 * 2. equipment_finance_phase4_balance_guard
 * 3. 20260803_equipment_finance_phase4_deposit_reservation_integrity ← CRITICAL FOR DEPOSITS
 * 
 * Exit codes:
 * - 0: Success (all migrations applied or already applied)
 * - 1: Failure (migration could not complete)
 */

async function executePhase4Migration() {
  const startTime = Date.now();
  
  try {
    console.log('\n' + '='.repeat(70));
    console.log('🔧 EQUIPMENT FINANCE PHASE 4 MIGRATION EXECUTOR');
    console.log('='.repeat(70));
    console.log('Starting Equipment Finance Phase 4 migrations...\n');
    
    const result = await runEquipmentFinancePhaseFourStartup();
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log('\n✅ SUCCESS - All Phase 4 migrations completed!');
    console.log(`   Database: ${result.database_name}`);
    console.log(`   Releases applied:`);
    result.releases.forEach(release => {
      console.log(`     ✓ ${release}`);
    });
    console.log(`   Duration: ${duration}s`);
    console.log('\n🟢 Deposit reservations schema is ready.');
    console.log('='.repeat(70) + '\n');
    
    return { success: true, result };
  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.error('\n' + '='.repeat(70));
    console.error('❌ FAILED - Phase 4 migration did not complete!');
    console.error('='.repeat(70));
    console.error(`Error: ${error.message}`);
    console.error(`Duration: ${duration}s`);
    console.error('\n🔴 CRITICAL: Deposit reservations will NOT work until this is fixed!');
    console.error('\nThe following migration must be applied to the Railway MySQL database:');
    console.error('  File: database/migrations/20260803_equipment_finance_phase4_deposit_reservation_integrity.sql');
    console.error('\nAlternatively, manually run:');
    console.error('  npm run migrate:equipment-finance:phase4:production\n');
    console.error('='.repeat(70) + '\n');
    
    return { success: false, error: error.message };
  }
}

// Run if executed directly
if (require.main === module) {
  executePhase4Migration().then(result => {
    process.exit(result.success ? 0 : 1);
  });
}

module.exports = { executePhase4Migration };
