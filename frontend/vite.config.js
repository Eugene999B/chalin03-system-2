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
            "./src/pages/EquipmentFinanceStartWizardOptionalPage.jsx",
            import.meta.url
          )
        );
      }

      if (
        source === "./EquipmentFinanceApplicationsPage" &&
        importer?.endsWith("/EquipmentSalesWorkspacePage.jsx")
      ) {
        return fileURLToPath(
          new URL(
            "./src/pages/EquipmentFinanceApplicationsOptionalPage.jsx",
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
