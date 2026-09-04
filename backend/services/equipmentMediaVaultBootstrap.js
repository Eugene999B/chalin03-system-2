const { installResponseMediaVault, startMediaVaultMaintenance } = require("./equipmentMediaVaultService");
const { run: runMediaMigration } = require("../scripts/migrateEquipmentMediaToObjectStorage");

try {
  installResponseMediaVault();
  startMediaVaultMaintenance();
  console.log("Chalin03 Media Vault response gateway loaded.");

  if (["1", "true", "yes", "on"].includes(String(process.env.CHALIN03_OBJECT_STORAGE_MIGRATION_ENABLED || "").trim().toLowerCase())) {
    void runMediaMigration().then((result) => {
      console.log(`Chalin03 media migration finished: ${JSON.stringify(result)}`);
    }).catch((error) => {
      // Migration failures must never prevent the main API from starting.
      console.warn(`Chalin03 media migration stopped safely: ${error?.message || error}`);
    });
  }
} catch (error) {
  // The media gateway must never prevent the main API from starting.
  console.warn(`Chalin03 Media Vault bootstrap skipped: ${error?.message || error}`);
}
