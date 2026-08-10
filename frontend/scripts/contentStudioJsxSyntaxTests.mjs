import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";

const frontendRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const jsxFiles = [
  "src/chalin-one/content-studio/ContentStudioDashboard.jsx",
  "src/chalin-one/content-studio/ContentStudioWorkspace.jsx",
  "src/chalin-one/content-studio/ContentStudioPageManager.jsx",
  "src/chalin-one/content-studio/ContentStudioNewsroomManager.jsx",
  "src/chalin-one/content-studio/ContentStudioLeadershipManager.jsx",
  "src/chalin-one/content-studio/ContentStudioGovernedManager.jsx",
  "src/chalin-one/content-studio/ContentStudioPortfolioManagers.jsx",
  "src/chalin-one/content-studio/ContentStudioCompanyInfoManager.jsx",
  "src/chalin-one/content-studio/ContentStudioMediaManager.jsx",
  "src/chalin-one/content-studio/ContentStudioFormManager.jsx",
  "src/chalin-one/content-studio/ContentStudioOperationalManagers.jsx",
  "src/chalin-one/content-studio/ContentStudioLaunchReadiness.jsx",
  "src/chalin-one/ChalinOneStandaloneEntry.jsx",
  "src/chalin-one/PublicChalinOneEntry.jsx",
  "src/chalin-one/ProtectedChalinOneEntry.jsx",
  "src/OperationalAppRoot.jsx",
  "src/public-site/PublicWebsiteApp.jsx",
  "src/chalin-one/public-site/PublicWebsiteStandaloneApp.jsx",
  "src/chalin-one/public-site/PublicNavigation.jsx",
].map((fileName) => fileName.replace("src/public-site/", "src/chalin-one/public-site/"));

for (const fileName of jsxFiles) {
  const source = fs.readFileSync(path.join(frontendRoot, fileName), "utf8");
  parse(source, {
    sourceType: "module",
    plugins: ["jsx"],
  });
  console.log(`✓ ${fileName} parsed as JSX`);
}

console.log(
  `\nCHALIN ONE JSX syntax: ${jsxFiles.length}/${jsxFiles.length} files passed.`
);
