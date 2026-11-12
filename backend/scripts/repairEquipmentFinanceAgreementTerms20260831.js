const mysql = require("mysql2/promise");
require("dotenv").config();

const RELEASE_ID = "20260831_CHALIN03_FINANCE_AGREEMENT_TERMS_FORMAT";

const LEGACY_TERMS = [
  "1. IDENTIFIED MACHINE. The Seller agrees to sell and the Buyer agrees to buy only the excavator or machine identified in this Agreement and its Machine Identity Annexure.",
  "2. PURCHASE PRICE AND INSTALLMENTS. The purchase price, deposit, financed balance, installment frequency, amounts and due dates are those shown in the approved commercial schedule attached to this Agreement. Payments are allocated to the oldest outstanding scheduled amount first unless an approved variation states otherwise.",
  "3. TITLE AND OWNERSHIP. Legal title remains with CHALIN 03 COMPANY LIMITED until the account is fully settled and the controlled ownership-transfer process is completed. Possession or delivery alone does not transfer title.",
  "4. LAWFUL USE. The Buyer shall not use or permit the machine to be used for illegal mining, unlawful activity or any purpose prohibited by the laws of Ghana.",
  "5. CARE, MAINTENANCE AND RISK. From delivery, the Buyer shall keep the machine secure, properly operated and maintained, promptly report loss or material damage and comply with any insurance, inspection and location obligations stated in the Delivery Annexure.",
  "6. LATE OR MISSED PAYMENTS. Grace days and any approved late charge are shown in the Agreement settings and schedule. A missed payment creates arrears evidence and may trigger reminders, notices, a promise-to-pay process, rescheduling review or default review.",
  "7. NOTICE, CURE AND RECOVERY. No automatic repossession or forfeiture occurs merely because a number of payments were missed. The Seller shall preserve payment evidence, issue the required notice and cure opportunity, record approvals and follow the lawful recovery route applicable in Ghana. The treatment of prior payments shall be governed by the legally reviewed Agreement and applicable law.",
  "8. DELIVERY AND CONDITION. Delivery is subject to the approved payment threshold. The Buyer shall inspect and sign the Delivery and Condition Report, including meter, attachments, visible condition and photo evidence.",
  "9. SERVICE. The Seller shall provide the number of complimentary services stated in this Agreement. Additional maintenance is the Buyer's responsibility unless separately agreed in writing.",
  "10. GUARANTOR. A named guarantor signs a separate undertaking where required and confirms that the information supplied is true.",
  "11. VARIATIONS AND WAIVERS. Rescheduling, waivers, discounts or amendments are valid only when recorded in a numbered written variation approved by authorised staff.",
  "12. SETTLEMENT AND OWNERSHIP TRANSFER. After full settlement and controlled delivery, the Seller shall prepare settlement and ownership-transfer evidence. Registration or authority transfers remain subject to the required external process and documents.",
  "13. COMMUNICATION AND DATA. The Buyer consents to lawful account communications and to the secure processing of identity, payment, machine and signature evidence for this transaction.",
  "14. GOVERNING LAW AND DISPUTES. This Agreement is governed by the laws of the Republic of Ghana. Parties should first attempt good-faith resolution before using the dispute process stated in the issued Agreement.",
  "15. ENTIRE AGREEMENT. This Agreement, its approved schedule, machine annexure, guarantor undertaking, delivery report and numbered written variations form the complete agreement. If a clause is invalid, the remaining clauses continue to apply.",
].join("\n\n");

const NEW_TERMS = [
  "1. IDENTIFIED MACHINE. The Seller agrees to sell, and the Buyer agrees to purchase, only the excavator or machine specifically identified in this Agreement and its Machine Identity Annexure. The Buyer shall not substitute, transfer, sell, lease, pledge or otherwise dispose of the identified machine without the Seller's prior written approval.",
  "2. PURCHASE PRICE AND INSTALLMENTS. The purchase price, deposit, financed balance, installment frequency, installment amounts and due dates shall be those stated in the approved commercial schedule attached to this Agreement. Payments shall be applied to the oldest outstanding scheduled amount first, unless an approved written variation provides otherwise.",
  "3. TITLE AND OWNERSHIP. Legal title to the machine shall remain with CHALIN 03 COMPANY LIMITED until the purchase account has been fully settled and the applicable controlled ownership-transfer process has been completed. Delivery or possession of the machine shall not, by itself, constitute transfer of legal title.",
  "4. LAWFUL USE. The Buyer shall use the machine only for lawful purposes and shall not use, permit or facilitate its use for illegal mining, unlawful activities or any purpose prohibited under the laws of the Republic of Ghana.",
  "5. CARE, MAINTENANCE AND RISK. From the date of delivery, the Buyer shall keep the machine secure, properly operated and adequately maintained, promptly report any loss, theft or material damage, and comply with all applicable insurance, inspection and location requirements stated in this Agreement or its annexures.",
  "6. LATE, MISSED PAYMENTS AND DEFAULT FEE. The Buyer shall make all installment payments on or before their respective due dates. Where the Buyer fails to complete the installment obligation within the agreed payment period, the Buyer shall, in addition to any outstanding installment amount, be liable for a default fee of GHS 50,000.00. This fee shall become payable in accordance with the notice, cure and default procedures applicable under this Agreement. Any grace period or other approved late charge stated in the commercial schedule shall continue to apply where expressly provided.",
  "7. NOTICE, CURE AND RECOVERY. A missed or overdue payment shall be recorded as an arrear and may trigger reminders, notices, a promise-to-pay process, rescheduling review or default review. No automatic repossession or forfeiture shall arise solely from a missed payment. The Seller shall preserve the relevant payment records, issue any required notice and cure opportunity, obtain the necessary approvals and follow the lawful recovery process applicable in Ghana. Treatment of prior payments shall be governed by this Agreement and applicable law.",
  "8. DELIVERY AND CONDITION. Delivery shall be subject to the approved payment threshold. The Buyer shall inspect the machine and sign the Delivery and Condition Report, including the meter reading, attachments, visible condition and supporting photographic evidence.",
  "9. SERVICE. The Seller shall provide the number of complimentary services expressly stated in this Agreement. Any additional maintenance or servicing shall be the Buyer's responsibility unless otherwise agreed in writing.",
  "10. GUARANTOR. Where a guarantor is required, the named guarantor shall execute a separate undertaking and confirm that all information supplied by the guarantor is true and complete.",
  "11. VARIATIONS AND WAIVERS. Any rescheduling, waiver, discount, reduction, extension or amendment shall be valid only where recorded in a numbered written variation and approved by an authorised representative of the Seller.",
  "12. SETTLEMENT AND OWNERSHIP TRANSFER. Upon full settlement of all amounts due under this Agreement, including any applicable default fees, charges or other approved obligations, the Seller shall prepare the required settlement and ownership-transfer documentation. Any registration or authority transfer shall remain subject to the applicable external procedures and documentation.",
  "13. COMMUNICATION AND DATA. The Buyer consents to lawful account communications and to the secure processing and retention of identity, payment, machine, agreement and signature records for the purposes of administering and enforcing this transaction.",
  "14. GOVERNING LAW AND DISPUTES. This Agreement shall be governed by the laws of the Republic of Ghana. The parties shall first attempt to resolve any dispute in good faith before commencing any further dispute-resolution process provided for in the issued Agreement or permitted by law.",
  "15. ENTIRE AGREEMENT. This Agreement, its approved commercial schedule, Machine Identity Annexure, guarantor undertaking, Delivery and Condition Report and all numbered written variations constitute the entire agreement between the parties. If any provision is determined to be invalid or unenforceable, the remaining provisions shall continue in full force and effect to the extent permitted by law.",
].join("\n\n");

function connectionOptions() {
  const required = (primary, fallback) => {
    const value = process.env[primary] || process.env[fallback];
    if (!String(value || "").trim()) throw new Error(`Missing required database variable ${primary}${fallback ? ` or ${fallback}` : ""}.`);
    return value;
  };
  return {
    host: required("DB_HOST", "MYSQLHOST"),
    port: Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306),
    user: required("DB_USER", "MYSQLUSER"),
    password: required("DB_PASSWORD", "MYSQLPASSWORD"),
    database: required("DB_NAME", "MYSQLDATABASE"),
    ssl: String(process.env.DB_SSL || "").trim().toLowerCase() === "true"
      ? { rejectUnauthorized: String(process.env.DB_SSL_REJECT_UNAUTHORIZED || "true").trim().toLowerCase() !== "false" }
      : undefined,
    connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 15000),
    timezone: "Z",
  };
}

async function run() {
  const connection = await mysql.createConnection(connectionOptions());
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query("SELECT id, agreement_terms FROM equipment_finance_settings WHERE id = 1 LIMIT 1 FOR UPDATE");
    const current = rows[0];
    if (!current) throw new Error("equipment_finance_settings id=1 was not found.");

    const currentTerms = String(current.agreement_terms || "");
    if (currentTerms !== LEGACY_TERMS) {
      await connection.rollback();
      console.log(JSON.stringify({
        release_id: RELEASE_ID,
        status: "preserved_existing_edit",
        reason: "Finance Settings agreement terms differ from the legacy default; no existing edit was overwritten.",
      }));
      return;
    }

    const oldSnapshot = JSON.stringify({ id: 1, agreement_terms: currentTerms });
    const newSnapshot = JSON.stringify({ id: 1, agreement_terms: NEW_TERMS });
    await connection.query(
      "UPDATE equipment_finance_settings SET agreement_terms = ?, terms_version = ?, legal_review_status = 'draft', legal_reviewed_by = NULL, legal_review_date = NULL WHERE id = 1",
      [NEW_TERMS, "FIN-TERMS-20260831"]
    );
    await connection.query(
      `INSERT INTO equipment_finance_settings_history (settings_id, old_snapshot_json, new_snapshot_json, change_reason, changed_by)
       VALUES (1, ?, ?, ?, NULL)`,
      [oldSnapshot, newSnapshot, `CHALIN03 Finance agreement terms formatting and default-fee update ${RELEASE_ID}`]
    );

    const [[verify]] = await connection.query(
      "SELECT agreement_terms, terms_version, legal_review_status FROM equipment_finance_settings WHERE id = 1 LIMIT 1"
    );
    if (String(verify?.agreement_terms || "") !== NEW_TERMS) throw new Error("Agreement terms verification failed after update.");
    if (String(verify?.terms_version || "") !== "FIN-TERMS-20260831") throw new Error("Agreement terms version verification failed after update.");

    await connection.commit();
    console.log(JSON.stringify({
      release_id: RELEASE_ID,
      status: "updated",
      clauses: NEW_TERMS.split(/\n\s*\n/).length,
      terms_version: verify.terms_version,
      legal_review_status: verify.legal_review_status,
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
    console.error(`CHALIN03 Finance agreement terms repair failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { LEGACY_TERMS, NEW_TERMS, RELEASE_ID, connectionOptions, run };
