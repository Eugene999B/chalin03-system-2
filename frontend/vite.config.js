import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function restoreCompleteFinanceCustomerProfile() {
  return {
    name: "restore-complete-finance-customer-profile",
    enforce: "pre",
    resolveId(source, importer) {
      if (
        source === "./EquipmentFinanceStartWizardPage" &&
        importer?.endsWith("/EquipmentFinanceOperationalStartPage.jsx")
      ) {
        return fileURLToPath(
          new URL(
            "./src/pages/EquipmentFinanceStartWizardEnhancedPage.jsx",
            import.meta.url
          )
        );
      }

      return null;
    },
  };
}

export default defineConfig({
  plugins: [restoreCompleteFinanceCustomerProfile(), react()],
});
