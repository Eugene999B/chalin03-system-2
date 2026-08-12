import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const source = fs.readFileSync(path.join(root, "src/pages/BackupPage.jsx"), "utf8");

assert.match(source, /return `\/backups\$\{suffix\}`;/, "backup operations must use the trusted same-origin /api client base");
assert.doesNotMatch(source, /PRODUCTION_BACKUP_API_ROOT/, "browser backup code must not bypass the trusted edge/origin boundary");
assert.match(source, /BACKUP_DOWNLOAD_TIMEOUT_MS\s*=\s*900000/, "progressive full backup generation needs a long browser timeout");
assert.match(source, /BACKUP_VALIDATE_TIMEOUT_MS\s*=\s*180000/, "backup validation needs a long timeout");
assert.match(source, /BACKUP_RESTORE_TIMEOUT_MS\s*=\s*600000/, "full restore needs a long timeout");
assert.match(source, /axiosClient\.get\(backupRequestUrl\("\/download"\)/, "download must stay on same-origin progressive transport");
assert.match(source, /backupRequestUrl\("\/restore\/dry-run"\)/);
assert.match(source, /backupRequestUrl\("\/restore"\)/);
assert.match(source, /headers:\s*protectedHeaders/, "protected-action token headers must remain on backup requests");
assert.match(source, /responseType:\s*"blob"/, "backup download must remain a binary-safe browser download");
assert.match(source, /setTimeout\(\(\) => window\.URL\.revokeObjectURL\(fileUrl\), 1000\)/, "large backup Blob URLs should not be revoked synchronously after click");
assert.match(source, /Preparing the signed full-system backup/, "long backup preparation should be visible to the administrator");

console.log("Backup & Restore progressive same-origin transport contracts passed.");
