import process from "node:process";
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

function resolveBuildId(environment = process.env) {
  const supplied =
    environment.RAILWAY_GIT_COMMIT_SHA ||
    environment.CF_PAGES_COMMIT_SHA ||
    environment.GITHUB_SHA ||
    environment.VITE_CHALIN03_BUILD_ID;

  if (supplied) {
    return String(supplied)
      .trim()
      .replace(/[^A-Za-z0-9._-]/g, "-")
      .slice(0, 64);
  }

  return `local-${Date.now().toString(36)}`;
}

function isCloudflarePagesBuild(environment = process.env) {
  return (
    String(environment.CF_PAGES || "").trim() === "1" ||
    Boolean(String(environment.CF_PAGES_URL || "").trim())
  );
}

// The production browser must not depend on cross-origin preflight to reach the
// business API. Pages Functions owns /api/* and proxies it server-side to the
// protected api.chalin03.com origin. Force every Cloudflare Pages bundle,
// including code that still reads VITE_API_URL directly, to use that gateway.
if (isCloudflarePagesBuild()) {
  process.env.VITE_API_URL = "/api";
}

const chalin03BuildId = resolveBuildId();

export default defineConfig({
  plugins: [
    restoreCompleteFinanceCustomerProfile(),
    react(),
  ],
  define: {
    "import.meta.env.VITE_CHALIN03_BUILD_ID": JSON.stringify(
      chalin03BuildId
    ),
  },
});

export { isCloudflarePagesBuild, resolveBuildId };
