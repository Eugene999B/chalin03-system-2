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

function isChalinOneCloudflareStagingBuild(environment = process.env) {
  const branch = String(
    environment.CF_PAGES_BRANCH || environment.CHALIN_ONE_STAGING_BRANCH || ""
  )
    .trim()
    .toLowerCase();
  return isCloudflarePagesBuild(environment) && branch === "chalin-one";
}

// Current production and CHALIN ONE staging both use a branch-owned
// Cloudflare Pages Function as the browser same-origin /api gateway.
if (isCloudflarePagesBuild()) {
  process.env.VITE_API_URL = "/api";
}

const chalin03BuildId = resolveBuildId();

export default defineConfig({
  plugins: [restoreCompleteFinanceCustomerProfile(), react()],
  define: {
    "import.meta.env.VITE_CHALIN03_BUILD_ID": JSON.stringify(
      chalin03BuildId
    ),
  },
  build: {
    // Phase 2J reads this manifest during postbuild to measure the exact public
    // static dependency graph, then removes it before deployment.
    manifest: true,
  },
});

export {
  isChalinOneCloudflareStagingBuild,
  isCloudflarePagesBuild,
  resolveBuildId,
};
