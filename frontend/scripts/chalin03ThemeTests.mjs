import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(scriptDir, "..");
const themeCss = fs.readFileSync(path.join(frontendDir, "src/styles/systemTheme.css"), "utf8");
const workspaceLayout = fs.readFileSync(path.join(frontendDir, "src/components/BusinessWorkspaceLayout.jsx"), "utf8");
const entry = fs.readFileSync(path.join(frontendDir, "src/main.jsx"), "utf8");

assert.match(themeCss, /data-chalin-theme="dark"/);
assert.match(themeCss, /--chalin-bg:\s*#0b1118/);
assert.match(themeCss, /--chalin-surface:\s*#121a24/);
assert.match(themeCss, /--chalin-text:\s*#eef4f1/);
assert.match(themeCss, /bwl-topbar::after/);
assert.match(themeCss, /bwl-shell\.bwl-theme-finance-signature/);
assert.match(workspaceLayout, /localStorage\.getItem\("chalin03-theme"\)/);
assert.match(workspaceLayout, /setAttribute\("data-chalin-theme", themeMode\)/);
assert.match(workspaceLayout, /Dark mode/);
assert.match(workspaceLayout, /Light mode/);
assert.match(entry, /\.\/styles\/systemTheme\.css/);

console.log("✅ Chalin 03 theme foundation checks passed.");
