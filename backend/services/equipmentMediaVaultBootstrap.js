const { installResponseMediaVault, startMediaVaultMaintenance } = require("./equipmentMediaVaultService");

try {
  installResponseMediaVault();
  startMediaVaultMaintenance();
  console.log("Chalin03 Media Vault response gateway loaded.");
} catch (error) {
  // The media gateway must never prevent the main API from starting.
  console.warn(`Chalin03 Media Vault bootstrap skipped: ${error?.message || error}`);
}
