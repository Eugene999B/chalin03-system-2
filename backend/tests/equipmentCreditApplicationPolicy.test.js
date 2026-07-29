const assert = require("node:assert/strict");
const test = require("node:test");

const {
  POLICY,
  determineKycStatus,
  evaluateCreditApplication,
  monthlyEquivalent,
  periodicAmount,
  termMonths,
} = require("../services/equipmentCreditApplicationPolicy");

function verifiedKyc(overrides = {}) {
  return {
    customer_name_snapshot: "Ama Customer",
    customer_phone_snapshot: "0240000000",
    customer_address_snapshot: "Dunkwa-on-Offin",
    residential_address: "Dunkwa-on-Offin",
    id_type: "Ghana Card",
    id_number: "GHA-000000000-0",
    employment_type: "self_employed",
    occupation: "Mining contractor",
    customer_consent_confirmed: true,
    credit_assessment_consent_confirmed: true,
    identity_verified: true,
    address_verified: true,
    income_verified: true,
    guarantor_verified: false,
    ...overrides,
  };
}

test("weekly and fortnightly installments are converted to monthly affordability burden", () => {
  assert.equal(periodicAmount(52000, 52), 1000);
  assert.equal(monthlyEquivalent(1000, "weekly"), 4333.33);
  assert.equal(monthlyEquivalent(1000, "fortnightly"), 2166.67);
  assert.equal(termMonths(52, "weekly"), 12);
  assert.equal(termMonths(26, "fortnightly"), 12);
});

test("verified standard application is eligible without changing quoted values", () => {
  const result = evaluateCreditApplication(
    {
      quoted_total: 120000,
      proposed_deposit: 30000,
      proposed_frequency: "monthly",
      proposed_installment_count: 12,
      monthly_salary_income: 25000,
      monthly_business_income: 0,
      monthly_other_income: 0,
      monthly_business_costs: 5000,
      monthly_household_expenses: 5000,
      existing_monthly_debt: 1000,
    },
    verifiedKyc()
  );

  assert.equal(result.quoted_total, 120000);
  assert.equal(result.proposed_deposit, 30000);
  assert.equal(result.financed_amount, 90000);
  assert.equal(result.periodic_installment_amount, 7500);
  assert.equal(result.proposed_installment_amount, 7500);
  assert.equal(result.total_monthly_income, 25000);
  assert.equal(result.net_monthly_surplus, 6500);
  assert.equal(result.debt_service_ratio_percent, 34);
  assert.equal(result.deposit_ratio_percent, 25);
  assert.equal(result.kyc_status, "verified");
  assert.equal(result.affordability_status, "eligible");
  assert.equal(result.risk_band, "low");
});

test("low deposit or elevated debt ratio requires manual review", () => {
  const result = evaluateCreditApplication(
    {
      quoted_total: 100000,
      proposed_deposit: 10000,
      proposed_frequency: "monthly",
      proposed_installment_count: 12,
      monthly_salary_income: 20000,
      monthly_business_costs: 1000,
      monthly_household_expenses: 4000,
      existing_monthly_debt: 1500,
    },
    verifiedKyc()
  );

  assert.equal(result.deposit_ratio_percent, 10);
  assert.ok(result.debt_service_ratio_percent > POLICY.standardDebtServiceRatioPercent);
  assert.equal(result.affordability_status, "manual_review");
  assert.ok(result.warnings.length > 0);
  assert.ok(["medium", "high"].includes(result.risk_band));
});

test("missing income, consent and identity information blocks submission policy", () => {
  const result = evaluateCreditApplication(
    {
      quoted_total: 150000,
      proposed_deposit: 0,
      proposed_frequency: "monthly",
      proposed_installment_count: 12,
      monthly_salary_income: 0,
      monthly_business_income: 0,
      monthly_other_income: 0,
      monthly_household_expenses: 3000,
      existing_monthly_debt: 500,
    },
    {}
  );

  assert.equal(result.kyc_status, "incomplete");
  assert.equal(result.affordability_status, "ineligible");
  assert.ok(result.net_monthly_surplus < 0);
  assert.ok(result.reasons.length >= 2);
  assert.equal(result.risk_band, "critical");
});

test("large financed amount requires complete and verified guarantor evidence", () => {
  const noGuarantor = verifiedKyc();
  const completeGuarantor = verifiedKyc({
    guarantor_name: "Kojo Guarantor",
    guarantor_phone: "0200000000",
    guarantor_id_type: "Ghana Card",
    guarantor_id_number: "GHA-111111111-1",
    guarantor_verified: true,
  });

  assert.equal(
    determineKycStatus(noGuarantor, POLICY.guarantorRequiredFromAmount),
    "incomplete"
  );
  assert.equal(
    determineKycStatus(completeGuarantor, POLICY.guarantorRequiredFromAmount),
    "verified"
  );
});
