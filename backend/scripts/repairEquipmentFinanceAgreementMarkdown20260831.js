const mysql = require("mysql2/promise");
require("dotenv").config();

const RELEASE_ID = "20260831_CHALIN03_FINANCE_MARKDOWN_CLEANUP";
const TARGET_VERSION = "FIN-TERMS-20260831-LEGAL";

function connectionOptions() {
  const required = (primary, fallback) => {
    const value = process.env[primary] || process.env[fallback];
    if (!String(value || "").trim()) {
      throw new Error(`Missing required database variable ${primary}${fallback ? ` or ${fallback}` : ""}.`);
    }
    return value;
  };
  return {
    host: required("DB_HOST", "MYSQLHOST"),
    port: Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306),
    user: required("DB_USER", "MYSQLUSER"),
    password: required("DB_PASSWORD", "MYSQLPASSWORD"),
    database: required("DB_NAME", "MYSQLDATABASE"),
    ssl:
      String(process.env.DB_SSL || "").trim().toLowerCase() === "true"
        ? { rejectUnauthorized: String(process.env.DB_SSL_REJECT_UNAUTHORIZED || "true").trim().toLowerCase() !== "false" }
        : undefined,
    connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 15000),
    timezone: "Z",
  };
}

function cleanAgreementTerms(value) {
  let text = String(value || "").replace(/\r\n/g, "\n").trim();
  if (!text) return text;

  // Remove Markdown heading syntax while preserving the legal title.
  text = text.replace(/^\s*#{1,6}\s*(TERMS\s+AND\s+CONDITIONS)\s*$/im, "TERMS AND CONDITIONS");
  // Remove Markdown bold markers. Clause headings are already explicit and uppercase.
  text = text.replace(/\*\*/g, "");
  // Standardise the default fee wording to a currency-qualified amount.
  text = text.replace(/default fee of\s+GHS\s+50,000\b/gi, "default fee of GHS 50,000.00");
  text = text.replace(/default fee of\s+50,000\b/gi, "default fee of GHS 50,000.00");
  // Remove accidental Markdown headings left on clause title lines.
  text = text.replace(/^\s*#{1,6}\s+/gm, "");
  // Keep clean paragraph boundaries without changing legal wording.
  text = text.replace(/\n{3,}/g, "\n\n").trim();
  return text;
}

function hasMarkdownSyntax(value) {
  const text = String(value || "");
  return /(^|\n)\s*#{1,6}\s|\*\*/.test(text);
}

async function run() {
  const connection = await mysql.createConnection(connectionOptions());
  try {
    await connection.beginTransaction();

    const [rows] = await connection.query(
      "SELECT id, agreement_terms, terms_version FROM equipment_finance_settings WHERE id = 1 LIMIT 1 FOR UPDATE"
    );
    const current = rows[0];
    if (!current) throw new Error("equipment_finance_settings id=1 was not found.");

    const currentTerms = String(current.agreement_terms || "");
    const cleanedTerms = cleanAgreementTerms(currentTerms);

    if (!cleanedTerms || cleanedTerms.length < 500) {
      throw new Error("Cleaned Finance agreement terms are unexpectedly short; refusing to change production settings.");
    }

    if (!hasMarkdownSyntax(currentTerms) && currentTerms === cleanedTerms) {
      await connection.rollback();
      console.log(JSON.stringify({
        release_id: RELEASE_ID,
        status: "already_clean",
        terms_version: current.terms_version,
      }));
      return;
    }

    const oldSnapshot = JSON.stringify({
      id: 1,
      agreement_terms: currentTerms,
      terms_version: current.terms_version,
    });
    const newSnapshot = JSON.stringify({
      id: 1,
      agreement_terms: cleanedTerms,
      terms_version: TARGET_VERSION,
      legal_review_status: "draft",
    });

    await connection.query(
      `UPDATE equipment_finance_settings
       SET agreement_terms = ?, terms_version = ?, legal_review_status = 'draft',
           legal_reviewed_by = NULL, legal_review_date = NULL
       WHERE id = 1`,
      [cleanedTerms, TARGET_VERSION]
    );

    await connection.query(
      `INSERT INTO equipment_finance_settings_history
       (settings_id, old_snapshot_json, new_snapshot_json, change_reason, changed_by)
       VALUES (1, ?, ?, ?, NULL)`,
      [
        oldSnapshot,
        newSnapshot,
        `Removed Markdown formatting from CHALIN03 Finance agreement terms and standardised default fee wording (${RELEASE_ID}).`,
      ]
    );

    const [[verify]] = await connection.query(
      `SELECT agreement_terms, terms_version, legal_review_status
       FROM equipment_finance_settings WHERE id = 1 LIMIT 1`
    );
    const verifiedTerms = String(verify?.agreement_terms || "");
    if (hasMarkdownSyntax(verifiedTerms)) {
      throw new Error("Verification failed: Markdown syntax is still present in the saved Finance agreement terms.");
    }
    if (verifiedTerms !== cleanedTerms) throw new Error("Verification failed: saved agreement terms differ from cleaned terms.");
    if (String(verify?.terms_version || "") !== TARGET_VERSION) throw new Error("Verification failed: terms version was not updated.");

    await connection.commit();
    console.log(JSON.stringify({
      release_id: RELEASE_ID,
      status: "updated",
      terms_version: verify.terms_version,
      legal_review_status: verify.legal_review_status,
      markdown_removed: true,
      length: verifiedTerms.length,
    }));
  } catch (error) {
    try { await connection.rollback(); } catch {}
    throw error;
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error(`CHALIN03 Finance Markdown cleanup failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { RELEASE_ID, TARGET_VERSION, cleanAgreementTerms, hasMarkdownSyntax, run };
