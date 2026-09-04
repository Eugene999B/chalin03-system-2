const { pool } = require("../config/db");
const {
  agingBucket,
  listInstallmentCollections,
} = require("./equipmentInstallmentReadModelService");
const {
  reconcileFinanceAgreement,
} = require("./equipmentFinanceReconciliationService");

const REQUIRED_TABLES = Object.freeze([
  "hire_customers",
  "equipment_credit_applications",
  "equipment_credit_application_kyc",
  "equipment_sale_agreements",
  "equipment_installment_schedule",
  "equipment_sale_payments",
  "equipment_deliveries",
  "equipment_ownership_transfers",
]);

function appError(message, statusCode = 503, code = "FINANCE_CUSTOMER_PORTFOLIO_UNAVAILABLE") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function positiveId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function cleanText(value, maxLength = 180) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function numberValue(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function dateValue(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function newestDate(...values) {
  return values
    .map(dateValue)
    .filter(Boolean)
    .sort()
    .at(-1) || null;
}

function oldestFutureDate(...values) {
  return values
    .map(dateValue)
    .filter(Boolean)
    .sort()[0] || null;
}

async function assertPortfolioReady(connection = pool) {
  const placeholders = REQUIRED_TABLES.map(() => "?").join(",");
  const [rows] = await connection.query(
    `SELECT TABLE_NAME
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN (${placeholders})`,
    REQUIRED_TABLES
  );
  const available = new Set(rows.map((row) => row.TABLE_NAME));
  const missing = REQUIRED_TABLES.filter((tableName) => !available.has(tableName));
  if (missing.length) {
    throw appError(
      `Finance customer portfolio storage is not ready. Missing: ${missing.join(", ")}.`,
      503,
      "FINANCE_CUSTOMER_PORTFOLIO_STORAGE_REQUIRED"
    );
  }
}

async function loadApplications(connection = pool, customerId = null) {
  const where = positiveId(customerId) ? "WHERE application.customer_id = ?" : "";
  const params = positiveId(customerId) ? [Number(customerId)] : [];
  const [rows] = await connection.query(
    `SELECT
       application.id AS application_id,
       application.application_number,
       application.customer_id,
       application.quotation_id,
       application.asset_id,
       application.application_date,
       application.application_status,
       application.kyc_status,
       application.affordability_status,
       application.risk_band,
       application.risk_score,
       application.quoted_total,
       application.proposed_deposit,
       application.financed_amount,
       application.proposed_frequency,
       application.proposed_installment_count,
       application.proposed_installment_amount,
       application.total_monthly_income,
       application.total_monthly_commitments,
       application.net_monthly_surplus,
       application.debt_service_ratio_percent,
       application.total_commitment_ratio_percent,
       application.assessment_recommendation,
       application.assessment_notes,
       application.decision_reason,
       application.agreement_id,
       application.agreement_activated_at,
       application.created_at AS application_created_at,
       application.updated_at AS application_updated_at,
       kyc.customer_name_snapshot,
       kyc.customer_phone_snapshot,
       kyc.customer_email_snapshot,
       kyc.customer_address_snapshot,
       kyc.id_type,
       kyc.id_number,
       kyc.date_of_birth,
       kyc.nationality,
       kyc.employment_type,
       kyc.occupation,
       kyc.employer_business_name,
       kyc.business_registration_number,
       kyc.residential_address,
       kyc.work_address,
       kyc.years_at_residence,
       kyc.years_in_employment_business,
       kyc.emergency_contact_name,
       kyc.emergency_contact_phone,
       kyc.emergency_contact_relationship,
       kyc.guarantor_name,
       kyc.guarantor_phone,
       kyc.guarantor_address,
       kyc.guarantor_id_type,
       kyc.guarantor_id_number,
       kyc.guarantor_relationship,
       kyc.identity_document_url,
       kyc.address_evidence_url,
       kyc.income_evidence_url,
       kyc.bank_statement_url,
       kyc.business_registration_url,
       kyc.guarantor_document_url,
       kyc.identity_verified,
       kyc.address_verified,
       kyc.income_verified,
       kyc.guarantor_verified,
       kyc.customer_consent_confirmed,
       kyc.credit_assessment_consent_confirmed,
       kyc.verified_at,
       kyc.verification_notes
     FROM equipment_credit_applications application
     LEFT JOIN equipment_credit_application_kyc kyc
       ON kyc.application_id = application.id
     ${where}
     ORDER BY application.created_at DESC, application.id DESC`,
    params
  );
  return rows;
}

async function loadCustomersByIds(ids, connection = pool) {
  const customerIds = [...new Set(ids.map(positiveId).filter(Boolean))];
  if (!customerIds.length) return [];
  const placeholders = customerIds.map(() => "?").join(",");
  const [rows] = await connection.query(
    `SELECT id, customer_name, phone, email, address
       FROM hire_customers
      WHERE id IN (${placeholders})`,
    customerIds
  );
  return rows;
}

function emptyCustomer(customerId) {
  return {
    customer_id: Number(customerId),
    customer_name: "Finance customer",
    phone: null,
    email: null,
    address: null,
    latest_kyc: null,
    latest_application: null,
    application_count: 0,
    approved_application_count: 0,
    declined_application_count: 0,
    agreement_count: 0,
    active_agreement_count: 0,
    completed_agreement_count: 0,
    overdue_agreement_count: 0,
    defaulted_agreement_count: 0,
    delivered_agreement_count: 0,
    ownership_transferred_count: 0,
    total_sales_value: 0,
    financed_amount: 0,
    amount_paid: 0,
    outstanding_balance: 0,
    overdue_amount: 0,
    next_due_date: null,
    last_payment_at: null,
    highest_risk_band: "low",
    highest_risk_score: 0,
    aging_bucket: "current",
    portfolio_status: "application_only",
    agreements: [],
    applications: [],
  };
}

const RISK_ORDER = Object.freeze({ low: 1, medium: 2, high: 3, critical: 4 });

function addApplication(customer, application) {
  customer.applications.push(application);
  customer.application_count += 1;
  if (application.application_status === "approved") customer.approved_application_count += 1;
  if (application.application_status === "declined") customer.declined_application_count += 1;

  if (!customer.latest_application) customer.latest_application = application;
  if (!customer.latest_kyc && application.customer_name_snapshot) {
    customer.latest_kyc = {
      application_id: application.application_id,
      customer_name: application.customer_name_snapshot,
      phone: application.customer_phone_snapshot,
      email: application.customer_email_snapshot,
      address:
        application.residential_address ||
        application.customer_address_snapshot ||
        null,
      id_type: application.id_type,
      id_number: application.id_number,
      employment_type: application.employment_type,
      occupation: application.occupation,
      employer_business_name: application.employer_business_name,
      guarantor_name: application.guarantor_name,
      guarantor_phone: application.guarantor_phone,
      kyc_status: application.kyc_status,
      verified_at: application.verified_at,
    };
  }

  const score = numberValue(application.risk_score);
  const band = String(application.risk_band || "low");
  if (
    score > customer.highest_risk_score ||
    (score === customer.highest_risk_score &&
      (RISK_ORDER[band] || 0) > (RISK_ORDER[customer.highest_risk_band] || 0))
  ) {
    customer.highest_risk_score = score;
    customer.highest_risk_band = band;
  }
}

function addAgreement(customer, agreement) {
  customer.agreements.push(agreement);
  customer.agreement_count += 1;
  customer.total_sales_value += numberValue(agreement.total_amount);
  customer.financed_amount += numberValue(agreement.financed_amount);
  customer.amount_paid += numberValue(agreement.amount_paid);
  customer.outstanding_balance += numberValue(agreement.outstanding_balance);
  customer.overdue_amount += numberValue(agreement.overdue_amount);
  customer.next_due_date = oldestFutureDate(
    customer.next_due_date,
    agreement.next_due_date
  );
  customer.last_payment_at = newestDate(
    customer.last_payment_at,
    agreement.last_payment_at
  );

  const status = String(agreement.agreement_status || "active");
  if (!["completed", "cancelled"].includes(status)) customer.active_agreement_count += 1;
  if (status === "completed") customer.completed_agreement_count += 1;
  if (status === "overdue") customer.overdue_agreement_count += 1;
  if (status === "defaulted") customer.defaulted_agreement_count += 1;
  if (agreement.delivery_status === "delivered" || agreement.controlled_delivery_completed_at) {
    customer.delivered_agreement_count += 1;
  }
  if (
    agreement.ownership_status === "transferred" ||
    agreement.controlled_ownership_completed_at
  ) {
    customer.ownership_transferred_count += 1;
  }

  const score = numberValue(agreement.risk_score);
  const band = String(agreement.risk_band || "low");
  if (
    score > customer.highest_risk_score ||
    (score === customer.highest_risk_score &&
      (RISK_ORDER[band] || 0) > (RISK_ORDER[customer.highest_risk_band] || 0))
  ) {
    customer.highest_risk_score = score;
    customer.highest_risk_band = band;
  }
}

function finaliseCustomer(customer) {
  const worstAgreement = customer.agreements
    .slice()
    .sort((left, right) => numberValue(right.days_past_due) - numberValue(left.days_past_due))[0];
  customer.aging_bucket = worstAgreement ? agingBucket(worstAgreement) : "current";

  if (customer.defaulted_agreement_count > 0) customer.portfolio_status = "defaulted";
  else if (customer.overdue_agreement_count > 0 || customer.overdue_amount > 0.01) {
    customer.portfolio_status = "overdue";
  } else if (customer.active_agreement_count > 0) customer.portfolio_status = "active";
  else if (customer.completed_agreement_count > 0) customer.portfolio_status = "completed";
  else if (customer.approved_application_count > 0) customer.portfolio_status = "approved_application";
  else customer.portfolio_status = "application_only";

  for (const field of [
    "total_sales_value",
    "financed_amount",
    "amount_paid",
    "outstanding_balance",
    "overdue_amount",
  ]) {
    customer[field] = Number(numberValue(customer[field]).toFixed(2));
  }

  return customer;
}

async function buildCustomerPortfolio(connection = pool) {
  await assertPortfolioReady(connection);
  const [{ accounts, readiness }, applications] = await Promise.all([
    listInstallmentCollections(),
    loadApplications(connection),
  ]);

  const customerIds = [
    ...applications.map((row) => row.customer_id),
    ...accounts.map((row) => row.customer_id),
  ];
  const masterCustomers = await loadCustomersByIds(customerIds, connection);
  const customers = new Map();

  function getCustomer(customerId) {
    const id = positiveId(customerId);
    if (!id) return null;
    if (!customers.has(id)) customers.set(id, emptyCustomer(id));
    return customers.get(id);
  }

  for (const master of masterCustomers) {
    const customer = getCustomer(master.id);
    Object.assign(customer, {
      customer_name: master.customer_name || customer.customer_name,
      phone: master.phone || null,
      email: master.email || null,
      address: master.address || null,
    });
  }

  for (const application of applications) {
    const customer = getCustomer(application.customer_id);
    if (!customer) continue;
    addApplication(customer, application);
    customer.customer_name =
      customer.customer_name === "Finance customer"
        ? application.customer_name_snapshot || customer.customer_name
        : customer.customer_name;
    customer.phone = customer.phone || application.customer_phone_snapshot || null;
    customer.email = customer.email || application.customer_email_snapshot || null;
    customer.address =
      customer.address ||
      application.residential_address ||
      application.customer_address_snapshot ||
      null;
  }

  for (const agreement of accounts) {
    const customer = getCustomer(agreement.customer_id);
    if (!customer) continue;
    addAgreement(customer, agreement);
    customer.customer_name =
      customer.customer_name === "Finance customer"
        ? agreement.customer_name_snapshot || customer.customer_name
        : customer.customer_name;
    customer.phone = customer.phone || agreement.customer_phone_snapshot || null;
    customer.address = customer.address || agreement.customer_location_snapshot || null;
  }

  return {
    readiness,
    customers: [...customers.values()].map(finaliseCustomer),
  };
}

async function listFinanceCustomers({ search = "", status = "", limit = 300 } = {}) {
  const { readiness, customers } = await buildCustomerPortfolio(pool);
  const term = cleanText(search).toLowerCase();
  const statusFilter = cleanText(status, 40).toLowerCase();
  const filtered = customers
    .filter((customer) => {
      if (statusFilter && customer.portfolio_status !== statusFilter) return false;
      if (!term) return true;
      return [
        customer.customer_name,
        customer.phone,
        customer.email,
        customer.latest_kyc?.id_number,
        customer.latest_kyc?.guarantor_name,
        ...customer.applications.map((row) => row.application_number),
        ...customer.agreements.map((row) => row.agreement_number),
        ...customer.agreements.map((row) => row.asset_code_snapshot),
        ...customer.agreements.map((row) => row.asset_name_snapshot),
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term));
    })
    .sort((left, right) => {
      const risk = (RISK_ORDER[right.highest_risk_band] || 0) - (RISK_ORDER[left.highest_risk_band] || 0);
      if (risk) return risk;
      if (right.overdue_amount !== left.overdue_amount) return right.overdue_amount - left.overdue_amount;
      return right.outstanding_balance - left.outstanding_balance;
    });

  const summary = customers.reduce(
    (result, customer) => {
      result.customers += 1;
      result.active_customers += customer.active_agreement_count > 0 ? 1 : 0;
      result.overdue_customers += customer.portfolio_status === "overdue" ? 1 : 0;
      result.defaulted_customers += customer.portfolio_status === "defaulted" ? 1 : 0;
      result.completed_customers += customer.portfolio_status === "completed" ? 1 : 0;
      result.application_only_customers += customer.agreement_count === 0 ? 1 : 0;
      result.total_sales_value += customer.total_sales_value;
      result.amount_paid += customer.amount_paid;
      result.outstanding_balance += customer.outstanding_balance;
      result.overdue_amount += customer.overdue_amount;
      return result;
    },
    {
      customers: 0,
      active_customers: 0,
      overdue_customers: 0,
      defaulted_customers: 0,
      completed_customers: 0,
      application_only_customers: 0,
      total_sales_value: 0,
      amount_paid: 0,
      outstanding_balance: 0,
      overdue_amount: 0,
    }
  );
  for (const field of ["total_sales_value", "amount_paid", "outstanding_balance", "overdue_amount"]) {
    summary[field] = Number(summary[field].toFixed(2));
  }

  return {
    generated_at: new Date().toISOString(),
    readiness,
    summary,
    count: filtered.length,
    customers: filtered.slice(0, Math.max(1, Math.min(Number(limit) || 300, 500))).map((customer) => ({
      ...customer,
      applications: undefined,
      agreements: undefined,
    })),
    policy: {
      division: "installment_finance",
      scope: "company_wide",
      customer_source: "finance_applications_and_agreements_only",
      master_identity_read_only: true,
      hire_customer_workflow_access: false,
      automatic_sms_enabled: false,
    },
  };
}

async function getFinanceCustomerPortfolio(customerId) {
  const id = positiveId(customerId);
  if (!id) throw appError("Invalid Finance customer ID.", 400, "INVALID_FINANCE_CUSTOMER_ID");

  const { customers } = await buildCustomerPortfolio(pool);
  const customer = customers.find((row) => Number(row.customer_id) === id);
  if (!customer) {
    throw appError(
      "Finance customer was not found in the company-wide installment portfolio.",
      404,
      "FINANCE_CUSTOMER_NOT_FOUND"
    );
  }

  const agreementIds = customer.agreements.map((row) => positiveId(row.id)).filter(Boolean);
  const applicationIds = customer.applications
    .map((row) => positiveId(row.application_id))
    .filter(Boolean);

  let schedule = [];
  let payments = [];
  let deliveries = [];
  let ownershipTransfers = [];
  let decisions = [];
  let reconciliations = [];

  if (agreementIds.length) {
    reconciliations = await Promise.all(
      agreementIds.map((agreementId) => reconcileFinanceAgreement(agreementId))
    );
    const agreementPlaceholders = agreementIds.map(() => "?").join(",");
    const [scheduleRows, paymentRows, deliveryRows, ownershipRows] = await Promise.all([
      pool.query(
        `SELECT *
           FROM equipment_installment_schedule
          WHERE agreement_id IN (${agreementPlaceholders})
          ORDER BY agreement_id, sequence_number`,
        agreementIds
      ),
      pool.query(
        `SELECT
           payment.*,
           receiver.full_name AS received_by_name,
           approver.full_name AS approved_by_name
         FROM equipment_sale_payments payment
         LEFT JOIN users receiver ON receiver.id = payment.received_by
         LEFT JOIN users approver ON approver.id = payment.approved_by
         WHERE payment.agreement_id IN (${agreementPlaceholders})
         ORDER BY payment.payment_date DESC, payment.id DESC`,
        agreementIds
      ),
      pool.query(
        `SELECT delivery.*, asset.asset_code, asset.asset_name
           FROM equipment_deliveries delivery
           LEFT JOIN fleet_assets asset ON asset.id = delivery.asset_id
          WHERE delivery.agreement_id IN (${agreementPlaceholders})
          ORDER BY delivery.delivery_datetime DESC, delivery.id DESC`,
        agreementIds
      ),
      pool.query(
        `SELECT ownership.*, asset.asset_code, asset.asset_name
           FROM equipment_ownership_transfers ownership
           LEFT JOIN fleet_assets asset ON asset.id = ownership.asset_id
          WHERE ownership.agreement_id IN (${agreementPlaceholders})
          ORDER BY ownership.transfer_date DESC, ownership.id DESC`,
        agreementIds
      ),
    ]);
    schedule = scheduleRows[0];
    payments = paymentRows[0];
    deliveries = deliveryRows[0];
    ownershipTransfers = ownershipRows[0];
  }

  if (applicationIds.length) {
    const applicationPlaceholders = applicationIds.map(() => "?").join(",");
    const [decisionRows] = await pool.query(
      `SELECT decision.*, user.full_name AS decided_by_name
         FROM equipment_credit_application_decisions decision
         LEFT JOIN users user ON user.id = decision.decided_by
        WHERE decision.application_id IN (${applicationPlaceholders})
        ORDER BY decision.decided_at DESC, decision.id DESC`,
      applicationIds
    );
    decisions = decisionRows;
  }

  return {
    generated_at: new Date().toISOString(),
    customer: {
      ...customer,
      applications: customer.applications,
      agreements: customer.agreements,
    },
    schedule,
    payments,
    deliveries,
    ownership_transfers: ownershipTransfers,
    decisions,
    reconciliations: reconciliations.map((entry) => ({
      agreement_id: entry.agreement_id,
      agreement_number: entry.agreement_number,
      consistent: entry.consistent,
      mismatches: entry.mismatches,
      calculated: entry.calculated,
    })),
    policy: {
      division: "installment_finance",
      scope: "company_wide",
      read_only_customer_identity: true,
      hire_records_created_or_changed: false,
      balances_changed: false,
      sms_sent: false,
    },
  };
}

module.exports = {
  REQUIRED_TABLES,
  assertPortfolioReady,
  getFinanceCustomerPortfolio,
  listFinanceCustomers,
};
