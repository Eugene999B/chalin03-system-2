import fs from "node:fs";
import path from "node:path";

const frontendDir = path.resolve(process.cwd());
const packageJsonPath = path.join(frontendDir, "package.json");
const viteConfigPath = path.join(frontendDir, "vite.config.js");

function fail(message) {
  console.error(`Chalin One build environment verification failed: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(packageJsonPath)) {
  fail("frontend/package.json was not found from the Cloudflare Pages frontend root.");
}

if (!fs.existsSync(viteConfigPath)) {
  fail("frontend/vite.config.js was not found from the Cloudflare Pages frontend root.");
}

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
if (packageJson?.scripts?.build !== "vite build") {
  fail('frontend/package.json must keep the production build command as "vite build".');
}

// Production uses the same-origin /api path and therefore intentionally does
// not require VITE_API_URL in the Cloudflare Pages build environment. Keep this
// check deterministic so the Pages build command remains valid when Cloudflare
// provides no custom build-time variables.
console.log("Chalin One staging build environment verified.");
