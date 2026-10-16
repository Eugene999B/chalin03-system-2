import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(scriptDir, "..");
const themeCss = fs.readFileSync(path.join(frontendDir, "src/styles/systemTheme.css"), "utf8");
const hardeningCss = fs.readFileSync(path.join(frontendDir, "src/styles/themeHardening.css"), "utf8");
const darkV4Css = fs.readFileSync(path.join(frontendDir, "src/styles/chalinDarkModeV4.css"), "utf8");
const darkCompatCss = fs.readFileSync(path.join(frontendDir, "src/styles/chalinDarkModeV4Compat.css"), "utf8");
const workspaceLayout = fs.readFileSync(path.join(frontendDir, "src/components/BusinessWorkspaceLayout.jsx"), "utf8");
const themeUtil = fs.readFileSync(path.join(frontendDir, "src/utils/chalinTheme.js"), "utf8");
const entry = fs.readFileSync(path.join(frontendDir, "src/main.jsx"), "utf8");
const html = fs.readFileSync(path.join(frontendDir, "index.html"), "utf8");

assert.match(themeCss, /data-chalin-theme="dark"/);
assert.match(themeCss, /--chalin-bg:\s*#0b1118/);
assert.match(themeCss, /--chalin-surface:\s*#121a24/);
assert.match(themeCss, /--chalin-text:\s*#eef4f1/);
assert.match(themeCss, /bwl-topbar::after/);
assert.match(themeCss, /bwl-shell\.bwl-theme-finance-signature/);

assert.match(themeUtil, /VALID_MODES = new Set\(\["light", "dark", "system"\]\)/);
assert.match(themeUtil, /localStorage\.getItem\(STORAGE_KEY\)/);
assert.match(themeUtil, /localStorage\.setItem\(STORAGE_KEY, normalized\)/);
assert.match(themeUtil, /prefers-color-scheme: dark/);
assert.match(themeUtil, /chalin03-theme-change/);

assert.match(workspaceLayout, /getChalinThemeMode/);
assert.match(workspaceLayout, /setChalinTheme/);
assert.match(workspaceLayout, /chalin03-theme-change/);
assert.match(workspaceLayout, /Dark mode/);
assert.match(workspaceLayout, /Light mode/);

assert.match(darkV4Css, /finance-simple__card/);
assert.match(darkV4Css, /finance-simple__facts div/);
assert.match(darkV4Css, /\[class\*="card"\] h1/);
assert.match(darkV4Css, /\[class\*="card"\] strong/);
assert.match(darkV4Css, /\[class\*="card"\] p/);
assert.match(darkV4Css, /\.bwl-content \.finance-simple__card/);
assert.match(darkV4Css, /filter: none !important/);

assert.match(darkCompatCss, /\[class\*="card"\]/);
assert.match(darkCompatCss, /finance-simple__card-head small/);
assert.match(darkCompatCss, /finance-simple__facts div span/);
assert.match(darkCompatCss, /background-color: #111c17 !important/);
assert.match(darkCompatCss, /color: #f4f8f6 !important/);

assert.match(hardeningCss, /\[role="dialog"\]/);
assert.match(hardeningCss, /input/);
assert.match(hardeningCss, /tbody tr:nth-child\(even\)/);

assert.match(entry, /\.\/styles\/systemTheme\.css/);
assert.match(entry, /\.\/styles\/themeHardening\.css/);
assert.match(entry, /\.\/styles\/chalinDarkModeV4\.css/);
assert.match(entry, /\.\/styles\/chalinDarkModeV4Compat\.css/);
assert.ok(entry.indexOf('./styles/chalinDarkModeV4Compat.css') > entry.indexOf('./styles/chalinDarkModeV4.css'));
assert.ok(entry.indexOf('./styles/chalinDarkModeV4Compat.css') > entry.indexOf('./styles/themeHardening.css'));
assert.doesNotMatch(html, /<script[^>]+src=["']\/darkMode\.js["']/);
assert.doesNotMatch(html, /c03-dark-mode/);

console.log("✅ Chalin 03 dark-mode V4 coverage and integration checks passed.");
