const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");

const {
  assertDisposableTarget,
  connectionConfig,
} = require("./runRelease31DisposableDrill");

function evidencePath() {
  return path.resolve(
    process.env.RELEASE31_DRILL_EVIDENCE_PATH ||
      path.join(__dirname, "../release31-disposable-drill-evidence.json")
  );
}

function readEvidence(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Release 3.1 drill evidence was not created: ${filePath}`);
  }

  const evidence = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (evidence?.status !== "passed" || !evidence?.backup_id) {
    throw new Error("Release 3.1 drill evidence is incomplete or did not pass.");
  }
  if (!/^[a-f0-9]{64}$/i.test(String(evidence.backup_checksum_sha256 || ""))) {
    throw new Error("Release 3.1 drill evidence is missing the backup checksum.");
  }
  return evidence;
}

async function run() {
  const config = connectionConfig();
  assertDisposableTarget(config);
  const filePath = evidencePath();
  const evidence = readEvidence(filePath);
  const connection = await mysql.createConnection(config);

  try {
    const [rows] = await connection.query(
      `SELECT
         backup_id,
         manifest_version,
         schema_version,
         package_checksum_sha256,
         status,
         verification_status,
         verification_message,
         verified_at
       FROM backup_history
       WHERE backup_id = ?
       LIMIT 1`,
      [evidence.backup_id]
    );
    const record = rows[0];

    if (!record) {
      throw new Error("The successful drill restore has no backup_history record.");
    }
    if (String(record.status || "").toLowerCase() !== "restored") {
      throw new Error(`Expected backup_history status restored; found ${record.status}.`);
    }
    if (String(record.verification_status || "").toLowerCase() !== "verified") {
      throw new Error(
        `Expected backup_history verification_status verified; found ${record.verification_status}.`
      );
    }
    if (
      String(record.package_checksum_sha256 || "").toLowerCase() !==
      String(evidence.backup_checksum_sha256).toLowerCase()
    ) {
      throw new Error("backup_history checksum does not match the drill package.");
    }
    if (!record.verified_at) {
      throw new Error("backup_history restore completion is missing verified_at evidence.");
    }

    evidence.backup_history_recorded = true;
    evidence.backup_history_status = record.status;
    evidence.backup_history_verification_status = record.verification_status;
    evidence.backup_history_manifest_version = record.manifest_version;
    evidence.backup_history_schema_fingerprint_sha256 = record.schema_version;
    evidence.backup_history_verified_at = new Date(record.verified_at).toISOString();
    evidence.backup_history_verification_message =
      record.verification_message || null;

    fs.writeFileSync(filePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(evidence, null, 2));
    return evidence;
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error("Release 3.1 drill evidence verification failed:", error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  evidencePath,
  readEvidence,
  run,
};
