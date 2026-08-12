import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const source = fs.readFileSync(path.join(root, "src/pages/BackupPage.jsx"), "utf8");

assert.doesNotMatch(source, /https:\/\/api\.chalin03\.com\/api\/backups/, "production backup operations must remain on the trusted same-origin API path");
assert.match(source, /return `\/backups\$\{suffix\}`;/, "backup operations should resolve through the same-origin /api client base");
assert.match(source, /BACKUP_DOWNLOAD_TIMEOUT_MS\s*=\s*300000/, "full backup generation needs a long download timeout");
assert.match(source, /BACKUP_VALIDATE_TIMEOUT_MS\s*=\s*180000/, "backup validation needs a long timeout");
assert.match(source, /BACKUP_RESTORE_TIMEOUT_MS\s*=\s*600000/, "full restore needs a long timeout");
assert.match(source, /backupRequestUrl\("\/download"\)/);
assert.match(source, /backupRequestUrl\("\/restore\/dry-run"\)/);
assert.match(source, /backupRequestUrl\("\/restore"\)/);
assert.match(source, /headers:\s*protectedHeaders/, "protected-action token headers must remain on backup requests");
assert.match(source, /responseType:\s*"blob"/, "backup download must remain a binary-safe browser download");
assert.doesNotMatch(source, /PRODUCTION_BACKUP_API_ROOT/, "browser backup code must not bypass the trusted same-origin API boundary");

console.log("Backup & Restore same-origin transport contracts passed.");
