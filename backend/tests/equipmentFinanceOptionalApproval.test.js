const assert = require("node:assert/strict");
const test = require("node:test");

const {
  advisoryAssessment,
  hasAffordabilityInformation,
} = require("../routes/equipmentCreditOptionalDecisionRoutes");

function baseApplication(overrides = {}) {
  return {
    quoted_total: 500000,
    proposed_deposit: 100000,
    financed_amount: 400000,
    proposed_frequency: "monthly",
    proposed_installment_count: 12,
    proposed_installment_amount: 33333.33,
    monthly_salary_income: 0,
    monthly_business_income: 0,
    monthly_other_income: 0,
    monthly_business_costs: 0,
    monthly_household_expenses: 0,
    existing_monthly_debt: 0,
    ...overrides,
  };
}

test("blank optional affordability remains not assessed instead of becoming an approval blocker", () => {
  const application = baseApplication();
  const assessment = advisoryAssessment(application, {
    customer_name_snapshot: "Ama Mensah",
    customer_phone_snapshot: "0240000000",
  });

  assert.equal(hasAffordabilityInformation(application), false);
  assert.equal(assessment.affordability_status, "not_assessed");
  assert.equal(assessment.kyc_status, "complete");
  assert.match(assessment.assessment_recommendation, /does not block submission or approval/);
});

test("optional KYC fields do not prevent a reviewed core customer identity", () => {
  const assessment = advisoryAssessment(baseApplication(), {
    customer_name_snapshot: "Kofi Owusu",
    customer_phone_snapshot: "0200000000",
    identity_verified: true,
    id_type: null,
    id_number: null,
    residential_address: null,
    employment_type: null,
    occupation: null,
    guarantor_name: null,
    customer_consent_confirmed: false,
    credit_assessment_consent_confirmed: false,
  });

  assert.equal(assessment.kyc_status, "verified");
  assert.equal(assessment.affordability_status, "not_assessed");
});

test("entered high-risk affordability remains advisory rather than an approval prohibition", () => {
  const assessment = advisoryAssessment(
    baseApplication({
      monthly_salary_income: 5000,
      monthly_household_expenses: 4500,
      proposed_installment_amount: 33333.33,
    }),
    {
      customer_name_snapshot: "Yaw Boateng",
      customer_phone_snapshot: "0270000000",
    }
  );

  assert.equal(hasAffordabilityInformation(baseApplication({ monthly_salary_income: 5000 })), true);
  assert.equal(assessment.affordability_status, "ineligible");
  assert.match(assessment.assessment_recommendation, /authorised manager may still approve/);
});
