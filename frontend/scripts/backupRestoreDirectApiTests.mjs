import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const source = fs.readFileSync(path.join(root, "src/pages/BackupPage.jsx"), "utf8");

assert.match(source, /return `\/backups\$\{suffix\}`;/, "backup operations should prefer the trusted same-origin /api client base");
assert.match(source, /PRODUCTION_BACKUP_API_ROOT\s*=\s*"https:\/\/api\.chalin03\.com\/api\/backups"/, "production download must have a direct API fallback when the Pages gateway fails");
assert.match(source, /BACKUP_DOWNLOAD_TIMEOUT_MS\s*=\s*300000/, "full backup generation needs a long download timeout");
assert.match(source, /BACKUP_VALIDATE_TIMEOUT_MS\s*=\s*180000/, "backup validation needs a long timeout");
assert.match(source, /BACKUP_RESTORE_TIMEOUT_MS\s*=\s*600000/, "full restore needs a long timeout");
assert.match(source, /function shouldRetryBackupDownloadDirectly/);
assert.match(source, /\[502, 504, 520, 521, 522, 523, 524\]\.includes\(status\)/, "only gateway-style HTTP failures should use the direct fallback");
assert.match(source, /errorCode === "ERR_NETWORK"/, "browser network failures may use the direct production fallback");
assert.match(source, /async function requestBackupDownload/);
assert.match(source, /backupRequestUrl\("\/download"\)/, "download must try same-origin first");
assert.match(source, /`\$\{PRODUCTION_BACKUP_API_ROOT\}\/download`/, "fallback must be limited to the backup download endpoint");
assert.match(source, /backupRequestUrl\("\/restore\/dry-run"\)/);
assert.match(source, /backupRequestUrl\("\/restore"\)/);
assert.doesNotMatch(source, /`\$\{PRODUCTION_BACKUP_API_ROOT\}\/restore/, "restore operations must never bypass the same-origin boundary");
assert.match(source, /headers:\s*protectedHeaders/, "protected-action token headers must remain on backup requests");
assert.match(source, /responseType:\s*"blob"/, "backup download must remain a binary-safe browser download");

console.log("Backup & Restore resilient download transport contracts passed.");
