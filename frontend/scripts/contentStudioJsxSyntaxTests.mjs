import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transformWithEsbuild } from "vite";

const frontendRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const moduleRoot = path.join(
  frontendRoot,
  "src/chalin-one/content-studio"
);
const jsxFiles = [
  "ContentStudioDashboard.jsx",
  "ContentStudioWorkspace.jsx",
  "ContentStudioPageManager.jsx",
  "ContentStudioNewsroomManager.jsx",
];

for (const fileName of jsxFiles) {
  const source = fs.readFileSync(path.join(moduleRoot, fileName), "utf8");
  await transformWithEsbuild(source, fileName, {
    loader: "jsx",
    jsx: "automatic",
    sourcemap: false,
  });
  console.log(`✓ ${fileName} compiled as JSX`);
}

console.log(`\nContent Studio JSX syntax: ${jsxFiles.length}/${jsxFiles.length} files passed.`);
