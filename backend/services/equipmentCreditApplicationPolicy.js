const {
  intervalDaysFor,
  monthlyEquivalent: scheduleMonthlyEquivalent,
} = require("./equipmentFinanceScheduleService");

const POLICY = Object.freeze({
  standardDebtServiceRatioPercent: 40,
  manualReviewDebtServiceRatioPercent: 50,
  maximumDebtServiceRatioPercent: 60,
  minimumDepositRatioPercent: 20,
  minimumSurplusRatioPercent: 15,
  standardMaximumTermMonths: 36,
  extendedMaximumTermMonths: 60,
  guarantorRequiredFromAmount: 100000,
});

function numberValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function roundMoney(value) {
  return Number(numberValue(value).toFixed(2));
}

function roundSignedMoney(value, fallback = 0) {
  const number = Number(value);
  return Number((Number.isFinite(number) ? number : fallback).toFixed(2));
}

function roundPercent(value) {
  return Number(numberValue(value).toFixed(2));
}

function boolValue(value) {
  return [true, 1, "1", "true", "yes", "on"].includes(value);
}

function textValue(value) {
  return String(value ?? "").trim();
}

function periodicAmount(financedAmount, installmentCount) {
  const count = Math.max(1, Math.floor(numberValue(installmentCount, 1)));
  return roundMoney(numberValue(financedAmount) / count);
}

function monthlyEquivalent(periodic, frequency, intervalDays = null) {
  return scheduleMonthlyEquivalent(
    periodic,
    textValue(frequency).toLowerCase(),
    intervalDays
  );
}

function termMonths(count, frequency, intervalDays = null) {
  const installments = Math.max(1, Math.floor(numberValue(count, 1)));
  const normalized = textValue(frequency).toLowerCase();
  if (normalized === "weekly") {
    return Number(((installments * 12) / 52).toFixed(1));
  }
  if (normalized === "fortnightly") {
    return Number(((installments * 12) / 26).toFixed(1));
  }
  if (normalized === "custom") {
    const days = intervalDaysFor("custom", intervalDays) || 30;
    return Number(((installments * days) / 30.436875).toFixed(1));
  }
  return installments;
}

function hasRequiredIdentity(kyc = {}) {
  return Boolean(
    textValue(kyc.customer_name_snapshot) &&
      textValue(kyc.customer_phone_snapshot) &&
      textValue(kyc.residential_address || kyc.customer_address_snapshot) &&
      textValue(kyc.id_type) &&
      textValue(kyc.id_number) &&
      textValue(kyc.employment_type) &&
      textValue(kyc.occupation) &&
      boolValue(kyc.customer_consent_confirmed) &&
      boolValue(kyc.credit_assessment_consent_confirmed)
  );
}

function hasRequiredGuarantor(kyc = {}) {
  return Boolean(
    textValue(kyc.guarantor_name) &&
      textValue(kyc.guarantor_phone) &&
      textValue(kyc.guarantor_id_type) &&
      textValue(kyc.guarantor_id_number)
  );
}

function determineKycStatus(kyc = {}, financedAmount = 0) {
  const identityComplete = hasRequiredIdentity(kyc);
  const guarantorRequired =
    numberValue(financedAmount) >= POLICY.guarantorRequiredFromAmount;
  const guarantorComplete = !guarantorRequired || hasRequiredGuarantor(kyc);

  if (!identityComplete || !guarantorComplete) return "incomplete";
  if (
    boolValue(kyc.identity_verified) &&
    boolValue(kyc.address_verified) &&
    boolValue(kyc.income_verified) &&
    (!guarantorRequired || boolValue(kyc.guarantor_verified))
  ) {
    return "verified";
  }
  return "complete";
}

function riskBand(score) {
  const value = Math.max(0, Math.min(100, Math.round(numberValue(score))));
  if (value >= 75) return "critical";
  if (value >= 50) return "high";
  if (value >= 25) return "medium";
  return "low";
}

function evaluateCreditApplication(input = {}, kyc = {}) {
  const quotedTotal = roundMoney(input.quoted_total);
  const proposedDeposit = Math.min(roundMoney(input.proposed_deposit), quotedTotal);
  const financedAmount = roundMoney(
    input.financed_amount === undefined || input.financed_amount === null
      ? Math.max(quotedTotal - proposedDeposit, 0)
      : input.financed_amount
  );
  const installmentCount = Math.max(
    1,
    Math.floor(numberValue(input.proposed_installment_count, 12))
  );
  const frequency = textValue(
    input.proposed_frequency || "monthly"
  ).toLowerCase();
  const proposedIntervalDays =
    frequency === "monthly"
      ? null
      : intervalDaysFor(
          frequency,
          input.proposed_interval_days ??
            input.custom_interval_days ??
            input.payment_interval_days
        );
  const periodic = periodicAmount(financedAmount, installmentCount);
  const proposedMonthlyInstallment = monthlyEquivalent(
    periodic,
    frequency,
    proposedIntervalDays
  );
  const calculatedTermMonths = termMonths(
    installmentCount,
    frequency,
    proposedIntervalDays
  );

  const monthlySalary = roundMoney(input.monthly_salary_income);
  const monthlyBusiness = roundMoney(input.monthly_business_income);
  const monthlyOther = roundMoney(input.monthly_other_income);
  const monthlyBusinessCosts = roundMoney(input.monthly_business_costs);
  const monthlyHousehold = roundMoney(input.monthly_household_expenses);
  const existingDebt = roundMoney(input.existing_monthly_debt);

  const totalIncome = roundMoney(monthlySalary + monthlyBusiness + monthlyOther);
  const totalCommitments = roundMoney(
    monthlyBusinessCosts +
      monthlyHousehold +
      existingDebt +
      proposedMonthlyInstallment
  );
  const netSurplus = roundSignedMoney(totalIncome - totalCommitments);
  const debtServiceRatio = roundPercent(
    totalIncome > 0
      ? ((existingDebt + proposedMonthlyInstallment) / totalIncome) * 100
      : 100
  );
  const totalCommitmentRatio = roundPercent(
    totalIncome > 0 ? (totalCommitments / totalIncome) * 100 : 100
  );
  const depositRatio = roundPercent(
    quotedTotal > 0 ? (proposedDeposit / quotedTotal) * 100 : 0
  );
  const surplusRatio = roundPercent(
    totalIncome > 0 ? (Math.max(netSurplus, 0) / totalIncome) * 100 : 0
  );
  const kycStatus = determineKycStatus(kyc, financedAmount);
  const guarantorRequired = financedAmount >= POLICY.guarantorRequiredFromAmount;
  const reasons = [];
  const warnings = [];

  let riskScore = 0;
  if (kycStatus === "incomplete") {
    riskScore += 30;
    reasons.push(
      "Required customer identity, consent or guarantor information is incomplete."
    );
  } else if (kycStatus !== "verified") {
    riskScore += 15;
    warnings.push("KYC evidence is complete but has not been fully verified.");
  }

  if (!boolValue(kyc.income_verified)) {
    riskScore += 15;
    warnings.push("Income evidence has not been verified.");
  }

  if (totalIncome <= 0) {
    riskScore += 45;
    reasons.push("Verified monthly income must be greater than zero.");
  }

  if (netSurplus <= 0) {
    riskScore += 35;
    reasons.push("Monthly commitments leave no positive repayment surplus.");
  }

  if (debtServiceRatio > POLICY.maximumDebtServiceRatioPercent) {
    riskScore += 40;
    reasons.push(
      `Debt service ratio exceeds the internal ${POLICY.maximumDebtServiceRatioPercent}% maximum.`
    );
  } else if (debtServiceRatio > POLICY.manualReviewDebtServiceRatioPercent) {
    riskScore += 30;
    warnings.push("Debt service ratio requires senior manual review.");
  } else if (debtServiceRatio > POLICY.standardDebtServiceRatioPercent) {
    riskScore += 18;
    warnings.push("Debt service ratio exceeds the standard approval range.");
  } else if (debtServiceRatio > 30) {
    riskScore += 8;
  }

  if (totalCommitmentRatio > 90) riskScore += 20;
  else if (totalCommitmentRatio > 80) riskScore += 12;

  if (depositRatio < 10) riskScore += 20;
  else if (depositRatio < POLICY.minimumDepositRatioPercent) riskScore += 10;

  if (calculatedTermMonths > POLICY.extendedMaximumTermMonths) riskScore += 20;
  else if (calculatedTermMonths > POLICY.standardMaximumTermMonths) riskScore += 10;

  if (guarantorRequired && !hasRequiredGuarantor(kyc)) riskScore += 15;
  riskScore = Math.min(100, Math.round(riskScore));

  let affordabilityStatus = "eligible";
  let recommendation =
    "Eligible within the standard internal affordability policy.";

  if (
    reasons.length ||
    proposedMonthlyInstallment >
      Math.max(
        totalIncome - monthlyBusinessCosts - monthlyHousehold - existingDebt,
        0
      )
  ) {
    affordabilityStatus = "ineligible";
    recommendation =
      "Do not approve yet. Correct the failed KYC or affordability conditions and reassess.";
  } else if (
    warnings.length ||
    debtServiceRatio > POLICY.standardDebtServiceRatioPercent ||
    depositRatio < POLICY.minimumDepositRatioPercent ||
    surplusRatio < POLICY.minimumSurplusRatioPercent ||
    calculatedTermMonths > POLICY.standardMaximumTermMonths
  ) {
    affordabilityStatus = "manual_review";
    recommendation =
      "Senior finance review is required before an approval decision is recorded.";
  }

  return {
    policy: POLICY,
    quoted_total: quotedTotal,
    proposed_deposit: proposedDeposit,
    financed_amount: financedAmount,
    proposed_frequency: frequency,
    proposed_interval_days: proposedIntervalDays,
    proposed_installment_count: installmentCount,
    periodic_installment_amount: periodic,
    proposed_installment_amount: proposedMonthlyInstallment,
    term_months: calculatedTermMonths,
    monthly_salary_income: monthlySalary,
    monthly_business_income: monthlyBusiness,
    monthly_other_income: monthlyOther,
    monthly_business_costs: monthlyBusinessCosts,
    monthly_household_expenses: monthlyHousehold,
    existing_monthly_debt: existingDebt,
    total_monthly_income: totalIncome,
    total_monthly_commitments: totalCommitments,
    net_monthly_surplus: netSurplus,
    debt_service_ratio_percent: debtServiceRatio,
    total_commitment_ratio_percent: totalCommitmentRatio,
    deposit_ratio_percent: depositRatio,
    surplus_ratio_percent: surplusRatio,
    kyc_status: kycStatus,
    affordability_status: affordabilityStatus,
    risk_score: riskScore,
    risk_band: riskBand(riskScore),
    assessment_recommendation: recommendation,
    reasons,
    warnings,
    guarantor_required: guarantorRequired,
  };
}

module.exports = {
  POLICY,
  determineKycStatus,
  evaluateCreditApplication,
  monthlyEquivalent,
  periodicAmount,
  riskBand,
  termMonths,
};
