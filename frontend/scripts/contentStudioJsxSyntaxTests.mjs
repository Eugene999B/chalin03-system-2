import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transformWithEsbuild } from "vite";

const frontendRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const chalinOneRoot = path.join(frontendRoot, "src/chalin-one");
const jsxFiles = [
  "content-studio/ContentStudioDashboard.jsx",
  "content-studio/ContentStudioWorkspace.jsx",
  "content-studio/ContentStudioPageManager.jsx",
  "content-studio/ContentStudioNewsroomManager.jsx",
  "content-studio/ContentStudioLeadershipManager.jsx",
  "content-studio/ContentStudioGovernedManager.jsx",
  "content-studio/ContentStudioPortfolioManagers.jsx",
  "content-studio/ContentStudioCompanyInfoManager.jsx",
  "content-studio/ContentStudioMediaManager.jsx",
  "content-studio/ContentStudioFormManager.jsx",
  "content-studio/ContentStudioOperationalManagers.jsx",
  "ChalinOneStandaloneEntry.jsx",
  "public-site/PublicWebsiteApp.jsx",
  "public-site/PublicWebsiteStandaloneApp.jsx",
];

for (const fileName of jsxFiles) {
  const source = fs.readFileSync(path.join(chalinOneRoot, fileName), "utf8");
  await transformWithEsbuild(source, fileName, {
    loader: "jsx",
    jsx: "automatic",
    sourcemap: false,
  });
  console.log(`✓ ${fileName} compiled as JSX`);
}

console.log(
  `\nCHALIN ONE JSX syntax: ${jsxFiles.length}/${jsxFiles.length} files passed.`
);
